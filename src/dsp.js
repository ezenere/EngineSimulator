// Síntese física do som do motor.
//
// Tudo roda amostra a amostra (48 kHz):
//  1. Cada cilindro é um volume de gás com pressão, massa e temperatura. O volume
//     segue a geometria biela/manivela; a combustão libera calor por uma curva de
//     Wiebe; as válvulas são orifícios com escoamento compressível (inclusive
//     blocado/sônico). A pressão no cilindro gera o torque no virabrequim.
//  2. A válvula de escape despeja massa no tubo primário, que é uma guia de onda
//     acústica. O escoamento depende da pressão que já está no tubo (resolvido de
//     forma implícita), então ondas refletidas ajudam ou atrapalham a exaustão
//     como num coletor real.
//  3. Coletores, X-pipe, H-pipe, turbina, abafador e ponteira formam uma rede de
//     guias de onda com junções de espalhamento.
//  4. Na ponteira: irradiação + ruído de jato proporcional à velocidade do gás.
//  5. Admissão (coletor com borboleta física), ruído mecânico, turbo e posição
//     do ouvinte são somados no final.
//
// Fica dentro de uma fábrica para poder ser serializado com toString() e
// injetado num AudioWorklet.

function EngineDSPFactory() {
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;
  const SOUND_SPEED = 520; // gás de escape quente (m/s)
  const P0 = 101325, RGAS = 287, GAM = 1.33, T_MAN = 310, T_BACK = 850, T_WALL = 430;
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

  // Função de escoamento compressível Ψ(p_jusante / p_montante), tabelada.
  // Perto de 1 vira linear para não endurecer a integração.
  const PSI_N = 4096;
  const PSI = new Float64Array(PSI_N + 2);
  {
    const crit = Math.pow(2 / (GAM + 1), GAM / (GAM - 1));
    const choked = Math.sqrt(GAM * Math.pow(2 / (GAM + 1), (GAM + 1) / (GAM - 1)));
    const at = (pr) => (pr <= crit ? choked : Math.sqrt(Math.max(0, (2 * GAM / (GAM - 1)) * (Math.pow(pr, 2 / GAM) - Math.pow(pr, (GAM + 1) / GAM)))));
    const LIN = 0.985, psiLin = at(LIN);
    for (let i = 0; i <= PSI_N + 1; i++) { const pr = Math.min(1, i / PSI_N); PSI[i] = pr > LIN ? (psiLin * (1 - pr)) / (1 - LIN) : at(pr); }
  }
  const psi = (pr) => { if (pr >= 1) return 0; if (pr <= 0) return PSI[0]; const x = pr * PSI_N, i = x | 0; return PSI[i] + (PSI[i + 1] - PSI[i]) * (x - i); };
  // vazão mássica com sinal de a para b através de área efetiva A
  const flow = (A, pa, Ta, pb, Tb) => (pa >= pb ? (A * pa * psi(pb / pa)) / Math.sqrt(RGAS * Ta) : (-A * pb * psi(pa / pb)) / Math.sqrt(RGAS * Tb));

  class RNG {
    constructor(seed) { this.s = seed >>> 0 || 0x9e3779b9; }
    next() { let x = this.s; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.s = x >>> 0; return this.s * 2.3283064365386963e-10; }
    bi() { return this.next() * 2 - 1; }
    gauss() { return (this.next() + this.next() + this.next() + this.next() - 2) * 1.7320508; }
  }

  class Biquad {
    constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0; }
    _set(b0, b1, b2, a0, a1, a2) { this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0; return this; }
    _w(fs, f, q) { const w = TAU * Math.min(f, fs * 0.45) / fs; return [Math.cos(w), Math.sin(w) / (2 * q)]; }
    lp(fs, f, q = 0.707) { const [c, al] = this._w(fs, f, q); return this._set((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al); }
    hp(fs, f, q = 0.707) { const [c, al] = this._w(fs, f, q); return this._set((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al); }
    bp(fs, f, q) { const [c, al] = this._w(fs, f, q); return this._set(al, 0, -al, 1 + al, -2 * c, 1 - al); }
    peak(fs, f, q, db) { const A = Math.pow(10, db / 40); const [c, al] = this._w(fs, f, q); return this._set(1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A); }
    hshelf(fs, f, db) {
      const A = Math.pow(10, db / 40), w = TAU * Math.min(f, fs * 0.45) / fs, c = Math.cos(w), s = Math.sin(w), al = (s / 2) * Math.SQRT2, k = 2 * Math.sqrt(A) * al;
      return this._set(A * ((A + 1) + (A - 1) * c + k), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - k), (A + 1) - (A - 1) * c + k, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - k);
    }
    run(x) { const y = this.b0 * x + this.z1; this.z1 = this.b1 * x - this.a1 * y + this.z2; this.z2 = this.b2 * x - this.a2 * y; return y; }
  }

  const onePole = (fs, f) => 1 - Math.exp(-TAU * f / fs);

  // Segmento de tubo: duas linhas de atraso (ida e volta) com perdas.
  // As ondas carregam pressão acústica em Pa (desvio em relação à ambiente).
  class Line {
    constructor(fs, length, Y, lossHz = 9000, damp = 1) {
      this.D = Math.max(1, (length / SOUND_SPEED) * fs);
      this.Dprev = this.D; this.kNL = 0;
      let size = 16; while (size < this.D * 1.8 + 8) size <<= 1;
      this.a = new Float32Array(size); this.b = new Float32Array(size);
      this.mask = size - 1; this.w = 0; this.Y = Y;
      // gradiente de temperatura e atrito nas paredes amortecem bastante os tubos reais
      this.g = Math.exp(-0.09 * length * damp);
      this.k = onePole(fs, lossHz);
      this.sa = 0; this.sb = 0;
      this.in0 = 0; this.in1 = 0; this.out0 = 0; this.out1 = 0;
    }
    read() {
      const m = this.mask;
      let pos = this.w - this.D, i = Math.floor(pos), f = pos - i;
      const b0 = this.b[i & m];
      this.in0 = b0 + (this.b[(i + 1) & m] - b0) * f;
      let a0 = this.a[i & m], v = a0 + (this.a[(i + 1) & m] - a0) * f;
      if (this.kNL) {
        // propagação não linear: a parte de alta pressão da onda viaja mais rápido
        // e alcança a frente, que se acentua até quase virar um choque. É isso que
        // dá o "rasgado" do escape em carga, sempre colado ao pulso.
        let De = this.D * (1 - this.kNL * clamp(v / P0, -0.6, 1.2));
        De = clamp(De, Math.max(1, this.Dprev - 4), this.Dprev + 0.9);
        this.Dprev = De;
        pos = this.w - De; i = Math.floor(pos); f = pos - i;
        a0 = this.a[i & m]; v = a0 + (this.a[(i + 1) & m] - a0) * f;
      }
      this.in1 = v;
    }
    write() {
      this.sa += this.k * (this.out0 * this.g - this.sa);
      this.sb += this.k * (this.out1 * this.g - this.sb);
      this.a[this.w] = this.sa; this.b[this.w] = this.sb;
      this.w = (this.w + 1) & this.mask;
    }
  }

  const port = (line, end) => ({ line, end });
  const pin = (p) => (p.end === 0 ? p.line.in0 : p.line.in1);
  const pout = (p, v) => { if (p.end === 0) p.line.out0 = v; else p.line.out1 = v; };

  class Junction {
    constructor(ports) { this.ports = ports; this.sumY = ports.reduce((s, p) => s + p.line.Y, 0); this.inj = 0; }
    step() {
      let acc = 0;
      for (const p of this.ports) acc += p.line.Y * pin(p);
      const P = (2 * acc) / this.sumY + this.inj;
      for (const p of this.ports) pout(p, P - pin(p));
      this.inj = 0;
    }
  }

  // Abafador / turbina: transmite filtrado, reflete parte para trás.
  class TwoPort {
    constructor(fs, a, b, kind) {
      this.A = a; this.B = b; this.chain = [];
      const q = (f) => this.chain.push(f);
      let lr = 1400;
      if (kind === 'straight') { this.gT = 0.96; this.rA = 0.04; this.rB = 0; this.x = 0; }
      // esportivo: tubo perfurado reto com lã; a lã come os agudos, o grave passa livre
      else if (kind === 'sport') { q(new Biquad().lp(fs, 3800, 0.6)); q(new Biquad().peak(fs, 120, 0.9, 2)); this.gT = 0.78; this.rA = 0.2; this.rB = 0.1; this.x = 0.06; }
      // original: câmaras de reflexão + ressonador. Elas matam o médio (onde mora o
      // "rasgado") e o agudo, mas o grave das explosões atravessa: fica baixo e encorpado
      else if (kind === 'stock') {
        q(new Biquad().peak(fs, 350, 0.9, -10)); q(new Biquad().peak(fs, 800, 0.9, -8)); q(new Biquad().lp(fs, 1200, 0.6)); q(new Biquad().lp(fs, 2400, 0.7)); q(new Biquad().peak(fs, 55, 1.0, 3));
        this.gT = 0.95; this.rA = 0.22; this.rB = 0.15; this.x = 0.06; lr = 500;
      }
      else {
        // turbina: o rotor quebra a frente dos pulsos (agudos caem uns 6 dB) e reforça um pouco o
        // grave do coletor, mas não é uma parede; um passa-baixa forte aqui soava "de longe"
        q(new Biquad().hshelf(fs, 1300, -6)); q(new Biquad().lp(fs, 4500, 0.6)); q(new Biquad().peak(fs, 150, 0.8, 2.5));
        this.gT = 0.74; this.rA = 0.24; this.rB = 0.12; this.x = 0.08;
      }
      this.k = onePole(fs, lr); this.s = 0;
    }
    step() {
      const inA = this.A.line.in1, inB = this.B.line.in0;
      let t = inA;
      for (let i = 0; i < this.chain.length; i++) t = this.chain[i].run(t);
      this.s += this.k * (inA - this.s);
      this.A.line.out1 = this.rA * this.s + this.x * inB;
      this.B.line.out0 = this.gT * t + this.rB * inB;
    }
  }

  // Extremidade aberta: reflete invertido em baixas frequências, irradia o resto.
  class Radiator {
    constructor(fs, line, panL, panR, fc = 1500, gain = 1) { this.line = line; this.k = onePole(fs, fc); this.s = 0; this.panL = panL; this.panR = panR; this.emit = 0; this.gain = gain; }
    step() {
      const x = this.line.in1;
      this.s += this.k * (x - this.s);
      const refl = -0.82 * this.s;
      this.line.out1 = refl;
      this.emit = (x - refl) * this.gain;
    }
  }

  // Válvula cutout ("escape aberto"): boca lateral antes do abafador. Fechada é um
  // toco tampado; aberta vira uma saída livre e o gás escolhe o caminho mais fácil.
  class Cutout extends Radiator {
    constructor(fs, line, panL, panR, fc, gain, valve) { super(fs, line, panL, panR, fc, gain); this.valve = valve; }
    step() {
      const x = this.line.in1, o = this.valve.v;
      this.s += this.k * (x - this.s);
      const open = -0.82 * this.s;
      this.line.out1 = o * open + (1 - o) * 0.96 * x;
      this.emit = o * (x - open) * this.gain;
    }
  }

  // Ponta fechada (tubo do ressonador): reflete a onda sem inverter.
  class ClosedEnd {
    constructor(line) { this.line = line; }
    step() { this.line.out1 = 0.96 * this.line.in1; }
  }

  // Comprimento da volta (m) em cada ambiente quando o observador está parado.
  const ENV_LOOP = { open: 800, street: 400, tunnel: 500, garage: 160, track: 1400, canyon: 1000 };

  // Diferencial padrão: motores de giro alto pedem redução maior para a mesma velocidade.
  const defaultFinal = (redline) => 3.55 * clamp(redline / 7000, 0.6, 3);

  // Relações de câmbio: progressão geométrica levemente "fechada" nas marchas altas.
  function gearRatios(n) {
    const first = { 4: 3.4, 5: 3.6, 6: 3.9, 7: 4.3, 8: 4.7, 9: 4.7, 10: 4.7 }[n] || 3.8;
    const last = { 4: 0.95, 5: 0.82, 6: 0.72, 7: 0.68, 8: 0.66, 9: 0.6, 10: 0.62 }[n] || 0.72;
    const r = [0];
    for (let i = 0; i < n; i++) r.push(first * Math.pow(last / first, Math.pow(i / (n - 1), 0.85)));
    return r;
  }

  class EngineDSP {
    constructor(fs) {
      this.fs = fs; this.dt = 1 / fs;
      this.rng = new RNG(12345);
      this.post = null;
      this.cfg = null;
      this.theta = 0; this.omega = 0; this.rpmAvg = 0;
      this.state = 'off'; this.crankT = 0;
      this.thr = 0; this.thrTarget = 0; this.brake = 0;
      this.iac = 0.004; this.iacI = 0.006; this.advTrim = 0; this.ePrev = 0; this.dash = 0;
      this.KP = 0.0015; this.KI = 0.0035; this.iacTrim = 1; this.KD = 0; this.KA = 40; this.KAD = 0; this.RG = 0.08;
      this.pMan = P0; this.boost = 0; this.turboW = 0; this.bovEnv = 0; this.bovAmp = 0;
      this.limiter = false; this.popWindow = 0; this.prevThrUser = 0;
      this.gear = 0; this.shiftT = 0; this.shifting = false; this.shiftCut = false; this.blip = false; this.clutch = 1; this.locked = false;
      this.shiftCool = 0; this.auto = false; this.ratios = gearRatios(6);
      this.v = 0; this.tqMean = 0; this.tqGas = 0;
      this.ignition = false;
      this.params = { listener: 'ext', env: 'open', roadDist: 6, exhaust: 1, intake: 1, mech: 1, master: 0.8, fanSound: true, saSound: true };
      this.wE = 1; this.wI = 0; this.wB = 0; this.wP = 0; this.wR = 0;
      // observador parado na via: propagação pelo ar com atraso variável (Doppler)
      let ps = 1024; while (ps < fs * 2.6) ps <<= 1;
      this.prop = new Float32Array(ps); this.propMask = ps - 1; this.propW = 0;
      this.carX = -12; this.airL = 0; this.gndL = 0; this.shade = 0; this.rDist = 12; this.vRad = 0;
      this.roadL = 0; this.roadR = 0; this.roadS = 0; this.panS = 0;
      this.amb = [new Biquad().lp(fs, 220, 0.7), new Biquad().lp(fs, 220, 0.7), new Biquad().bp(fs, 900, 0.7), new Biquad().bp(fs, 900, 0.7)];
      this.ambEnv = ''; this.ambMod = 0; this.phH = 0;
      this.ctrl = 0; this.telem = 0;
      this.pops = [];
      this.phW = 0; this.phT = 0; this.phS = 0;
      this.dcL = 0; this.dcR = 0; this.dcxL = 0; this.dcxR = 0;
      this.lockOmega = false; this.cfgGain = 1; this.mk = 1; this.fade = 1; this.jetGain = 900; this.valveNoise = 0.07; this.tzLP = 0; this.tzK = 0.15; this.revCd = 0.15; this.varScale = 1; this.solverIt = 6; this.spread = 1; this.boxerAsym = 0.15; this.valveState = { v: 0 }; this.valveMode = 'closed'; this.valveAuto = false; this.twoStep = false; this.twoStepMode = 'off'; this.lcI = 0.12; this.launching = false; this.boxerPan = [1.0, 0.5, 0.22, 0.55];
      // temperatura do líquido de arrefecimento (°C); começa frio, como numa manhã qualquer
      this.coolant = 20; this.ambientT = 20; this.tempMode = 'real'; this.tempSet = 90; this.warm = 0;
      this.fanOn = false; this.fanSpin = 0; this.secAir = 0; this.catRetard = 0; this.idleTarget = 0; this.phFan = 0; this.phSA = 0;
    }

    message(m) {
      if (m.type === 'config') this.setConfig(m.cfg);
      else if (m.type === 'tune') { if (this.cfg) this.tune(m.cfg); }
      else if (m.type === 'params') Object.assign(this.params, m.params);
      else if (m.type === 'input') {
        if (m.throttle !== undefined) this.thrTarget = clamp(m.throttle, 0, 1);
        if (m.brake !== undefined) this.brake = clamp(m.brake, 0, 1);
        if (m.ignition !== undefined) this.setIgnition(m.ignition);
        if (m.shift) this.requestShift(m.shift);
        if (m.temp) {
          if (m.temp.mode) this.tempMode = m.temp.mode;
          if (m.temp.value !== undefined) { this.coolant = clamp(m.temp.value, -20, 130); this.tempSet = this.coolant; }
        }
      }
    }

    setIgnition(on) {
      this.ignition = on;
      if (on && this.state === 'off') { this.state = 'crank'; this.crankT = 0; }
      if (!on) this.state = 'off';
    }

    requestShift(dir) {
      const target = clamp(this.gear + dir, 0, this.ratios.length - 1);
      if (target === this.gear) return;
      const up = target > this.gear;
      // proteção contra redução que estouraria o giro (como nos câmbios modernos)
      const after = (this.v / 0.33) * this.ratios[target] * this.final * 9.549;
      if (!up && target > 0 && after > this.redline * 1.02) { this.denied = 0.6; return; }
      this.shifting = true;
      // tempo de troca do carro: metade com a marcha em transição, metade soltando a embreagem
      const st = this.shiftTime;
      this.shiftT = this.gear === 0 || target === 0 ? 0.05 : Math.max(0.02, up ? 0.5 * st : 0.75 * st);
      this.shiftCut = up && this.thr > 0.5 && this.gear > 0;
      // troca rápida (dupla embreagem, automático, quickshifter): a central corta a ignição
      // e a borboleta fica aberta, então o turbo não despeja. Troca manual normal: o
      // motorista tira o pé e a válvula de alívio solta a pressão.
      this.ignCut = this.auto || this.shiftTime <= 0.2;
      this.shiftUp = up; this.sinceShift = 0;
      this.blip = !up && target > 0 && after > this.rpmAvg * 1.05;
      // automático (troca embreagem-a-embreagem): na subida a próxima marcha já vai
      // pegando enquanto a outra solta, então o motor é puxado para baixo e não dispara
      this.clutch = this.auto && up && this.gear > 0 ? 0.3 : 0;
      this.gear = target;
      this.shiftCool = Math.max(0.3, 1.5 * st + 0.2);
    }

    setConfig(cfg, calibrate = true) {
      const prevN = this.N;
      this.cfg = cfg;
      const N = cfg.N;
      this.N = N;
      this.fire = Float64Array.from(cfg.fire);
      this.tdcRel = Float64Array.from(cfg.tdcRel);
      this.ux = Float64Array.from(cfg.axis.map((a) => Math.sin(a * DEG)));
      this.uy = Float64Array.from(cfg.axis.map((a) => Math.cos(a * DEG)));
      const zc = cfg.z.reduce((s, x) => s + x, 0) / N;
      this.dz = Float64Array.from(cfg.z.map((x) => x - zc));
      this.turbo = cfg.aspiration === 'turbo';
      this.blower = cfg.aspiration === 'super'; // compressor mecânico, tocado por correia

      // geometria do cilindro (curso = diâmetro)
      const Vd = (cfg.displacement / N) * 1e-3;
      const bore = Math.cbrt((4 * Vd) / Math.PI);
      this.Vd = Vd; this.bore = bore;
      this.Ap = (Math.PI / 4) * bore * bore;
      this.rCrank = bore / 2; this.lRod = this.rCrank / 0.3;
      this.CR = this.turbo || this.blower ? 9.5 : 11;
      this.Vc = Vd / (this.CR - 1);
      this.Ar = 0.16 * bore * bore;           // seção do tubo primário
      this.Zr = SOUND_SPEED / this.Ar;         // impedância: Pa por kg/s
      this.hw = 900 * this.Ap * 2.5;           // perda de calor pelas paredes (W/K)
      this.Aleak = 1.2e-4 * bore * bore;       // folga equivalente dos anéis

      this.tune(cfg);

      // estado termodinâmico por cilindro
      const pinit = this.pMan;
      this.p = new Float64Array(N); this.m = new Float64Array(N); this.Vprev = new Float64Array(N);
      this.mEx = new Float64Array(N); this.mIn = new Float64Array(N);
      this.Q = new Float64Array(N); this.xb = new Float64Array(N); this.air = new Float64Array(N);
      this.armed = new Uint8Array(N); this.spk = new Float64Array(N);
      this.aPrev = new Float64Array(N);
      // nenhum cilindro é igual ao outro: distribuição de ar no coletor, sede de
      // válvula, injetor e câmara variam alguns por cento. Isso gera as ordens que
      // não são de ignição (0,5, 1, 2...) que dão o caráter "mecânico" dos motores reais.
      // carburador: a mistura se divide mal pelo coletor e cada cilindro recebe um pouco
      // diferente (e varia de explosão a explosão) — é o "galope" dos motores antigos
      const sr = new RNG(0x51ed27 + N * 7919), sp = this.spread * (cfg.fuel === 'carb' ? 2.6 : 1);
      this.cylIn = new Float64Array(N); this.cylEx = new Float64Array(N); this.cylQ = new Float64Array(N);
      for (let c = 0; c < N; c++) {
        this.cylIn[c] = 1 + 0.07 * sp * sr.bi();
        this.cylEx[c] = 1 + 0.1 * sp * sr.bi();
        this.cylQ[c] = 1 + 0.05 * sp * sr.bi();
      }
      for (let c = 0; c < N; c++) {
        const a = ((this.theta - this.fire[c]) % 720 + 720) % 720;
        this.aPrev[c] = a;
        const V = this.volume(a);
        this.Vprev[c] = V; this.p[c] = pinit; this.m[c] = (pinit * V) / (RGAS * T_MAN);
        this.xb[c] = 1;
      }
      this.buildExhaust(cfg);
      this.buildFilters(cfg);
      this.cfgGain = cfg.gain || (calibrate ? this.calibrate(cfg) : 1);
      this.fade = 0;
      // trocou de carro com o motor ligado: o motor novo dá a partida do zero. Herdar giro,
      // marcha e o controle de marcha lenta "aprendido" no outro motor deixava a lenta
      // instável e às vezes apagava (uma moto nascendo a 750 rpm de um V8, por exemplo)
      if ((this.state === 'run' || this.state === 'crank') && (cfg.fresh || prevN !== N)) this.freshStart();
    }

    freshStart() {
      this.state = 'crank'; this.crankT = 0; this.runT = 0;
      this.omega = 0; this.rpmAvg = 0;
      this.iacI = 0.006; this.iac = 0.004; this.dash = 0; this.ePrev = 0; this.advTrim = 0; this.lcI = 0.12; this.lcPrev = undefined;
      this.limiter = false; this.pops.length = 0; this.boost = 0; this.turboW = 0; this.bovEnv = 0; this.catRetard = 0;
      this.gear = 0; this.clutch = 1; this.locked = false; this.shifting = false; this.shiftCut = false; this.blip = false; this.v = 0;
      this.pMan = P0; this.thr = 0;
    }

    // Parâmetros escalares que podem mudar sem reconstruir a acústica.
    tune(cfg) {
      this.dispL = cfg.displacement;
      this.J = (0.05 + 0.045 * cfg.displacement) * cfg.inertia;
      this.Tmax = 95 * cfg.displacement * (this.turbo || this.blower ? 1 + 0.8 * cfg.boost : 1);
      this.mass = clamp(850 + 160 * cfg.displacement, 950, 1900);
      this.redline = cfg.redline; this.idle = cfg.idle;
      this.final = cfg.finalDrive || defaultFinal(cfg.redline);
      this.cam = cfg.cam;
      this.maxBoost = cfg.boost;
      this.popsLevel = cfg.pops;
      this.fuelVar = cfg.fuel === 'carb' ? 1.9 : 1;
      this.valveMode = cfg.valve || 'closed';
      // 2-step: 'cut' corta a ignição no limite; 'soft' (controle de largada) dosa o acelerador
      this.twoStepMode = cfg.twoStep === true ? 'cut' : cfg.twoStep || 'off';
      this.twoStep = this.twoStepMode !== 'off';
      this.launchRpm = cfg.launchRpm ? clamp(cfg.launchRpm, cfg.idle * 1.3, cfg.redline * 0.95) : clamp(cfg.redline * 0.5, cfg.idle * 2.2, cfg.redline * 0.8);
      const bore = this.bore || 0.08;
      const lift = 1 + 0.35 * cfg.cam + 0.25 * clamp((cfg.redline - 7000) / 7000, 0, 1.5);
      this.AexMax = 0.10 * bore * bore * lift;
      this.AinMax = 0.13 * bore * bore * lift;
      this.Athr = 1.6e-3 * cfg.displacement * clamp(cfg.redline / 7000, 0.8, 2.5) * (cfg.intake === 'itb' ? 1.3 : 1);
      this.Vman = (cfg.intake === 'itb' ? 0.35 : 1.0) * cfg.displacement * 1e-3;
      // eventos de válvula (graus após o PMS de ignição); comando bravo = mais cruzamento
      const cam = cfg.cam;
      this.evo = 132 - 28 * cam; this.evc = 372 + 34 * cam;
      this.ivo = 348 - 34 * cam; this.ivc = 572 + 34 * cam;
      if (cfg.gears) {
        this.ratios = cfg.ratios && cfg.ratios.length === cfg.gears ? [0, ...cfg.ratios] : gearRatios(cfg.gears);
        if (this.gear > cfg.gears) this.gear = cfg.gears;
      }
      if (cfg.transmission) this.auto = cfg.transmission === 'auto';
      this.shiftTime = clamp(cfg.shiftTime || (this.auto ? 0.36 : 0.26), 0.04, 1);
      this.driveMode = cfg.driveMode || 'auto';
      // corte de giro: tipo, faixa (quanto o giro cai antes de voltar) e tempo mínimo de cada corte
      this.limType = cfg.limiter || 'ign';
      this.limBand = clamp(cfg.limiterBand || 160, 30, 1000);
      this.limHold = clamp(cfg.limiterHold || 0, 0, 0.5);
    }

    volume(a) {
      const th = a * DEG, r = this.rCrank, l = this.lRod, s = Math.sin(th);
      return this.Vc + this.Ap * (r * (1 - Math.cos(th)) + l - Math.sqrt(l * l - r * r * s * s));
    }

    // Renderiza um trecho em carga total a rotação fixa para normalizar o volume
    // entre configurações (mantendo a diferença natural entre abafadores).
    calibrate(cfg) {
      const t = new EngineDSP(this.fs);
      t.setConfig({ ...cfg, muffler: 'sport', valve: 'none', pipeD: 2.5, reso: false, twoStep: false }, false);
      t.state = 'run'; t.lockOmega = true; t.tempMode = 'fixed'; t.tempSet = 90; t.coolant = 90;
      t.omega = (this.redline * 0.55 * TAU) / 60; t.rpmAvg = this.redline * 0.55;
      // turbo calibrado em pressão parcial: com a pressão cheia o motor sopra quase o dobro de ar e
      // o resto do tempo (sem pressão) ficaria baixo demais, como se o carro estivesse longe
      t.thrTarget = 1; t.thr = 1; t.turboW = 0.6; t.boost = cfg.boost * (this.blower ? 0.8 : 0.3);
      t.params.master = 0.02;
      const B = 256, L = new Float32Array(B), R = new Float32Array(B);
      let acc = 0, cnt = 0;
      for (let i = 0; i < 0.5 * this.fs; i += B) {
        t.process(L, R, B);
        if (i > 0.25 * this.fs) for (let k = 0; k < B; k++) { acc += L[k] * L[k] + R[k] * R[k]; cnt += 2; }
      }
      const rms = Math.sqrt(acc / Math.max(1, cnt)) / 0.01;
      const target = 0.32 * 0.82;
      return clamp(target / Math.max(rms, 1e-6), 0.05, 30);
    }

    buildExhaust(cfg) {
      const fs = this.fs, N = this.N;
      const lines = []; const nodes = []; const runners = new Array(N); const rads = [];
      const L = (len, Y, loss, damp = 1) => { const l = new Line(fs, len, Y, loss, damp); l.kNL = 0.6; lines.push(l); return l; };
      const pipe = cfg.pipeLen;
      // diâmetro do escape (referência 2,5"): área muda a impedância vista pelo coletor,
      // tubo fino atrita mais e acelera o gás (mais chiado de jato), ponta larga irradia mais grave
      const ds = clamp((cfg.pipeD || 2.5) / 2.5, 0.6, 1.6), A2 = ds * ds, dw = 1 / ds;
      this.pipeA = A2;
      const bankOut = []; this.bankJ = [];
      for (let b = 0; b < cfg.banks; b++) {
        const cyls = [];
        for (let c = 0; c < N; c++) if (cfg.bank[c] === b) cyls.push(c);
        const ports = [];
        for (const c of cyls) {
          const r = L(cfg.runners[c], 1, 12000);
          runners[c] = r;
          ports.push(port(r, 1));
        }
        const Yc = Math.max(1, cyls.length * 0.55);
        const extra = cfg.routing === 'dual' && cfg.banks === 2 ? pipe * 0.55 * (b ? 1.03 + (cfg.layout === 'boxer' ? this.boxerAsym : 0) : 1) : 0;
        const col = L(0.32 + (this.turbo ? 0 : extra), Yc * A2, 10000, dw);
        ports.push(port(col, 0));
        const j = new Junction(ports); nodes.push(j); this.bankJ.push(j);
        let out = col;
        if (this.turbo) {
          const t = L(0.22 + extra, Yc * A2, 9000, dw);
          nodes.push(new TwoPort(fs, port(col, 1), port(t, 0), 'turbo'));
          out = t;
        }
        bankOut.push(out);
      }
      const Ym = bankOut[0].Y;
      // ressonador: tubo lateral fechado de 1/4 de onda, afinado no ronco de cruzeiro (~2200 rpm)
      const resoLen = clamp(SOUND_SPEED / (4 * (N / 2) * (2200 / 60)), 0.25, 2.2);
      const addTail = (mid, panL, panR) => {
        let feed = mid;
        if (cfg.reso) {
          const br = L(resoLen, mid.Y * 0.6, 6000); br.kNL = 0;
          const m2 = L(0.15, mid.Y, 9000, dw);
          nodes.push(new Junction([port(mid, 1), port(br, 0), port(m2, 0)]), new ClosedEnd(br));
          feed = m2;
        }
        if (cfg.valve && cfg.valve !== 'none') {
          const stub = L(0.12, mid.Y * 0.9, 9000, dw), m3 = L(0.12, mid.Y, 9000, dw);
          nodes.push(new Junction([port(feed, 1), port(stub, 0), port(m3, 0)]));
          const cut = new Cutout(fs, stub, 0.5 + 0.3 * (panL - panR), 0.5 + 0.3 * (panR - panL), 1500 / ds, 1.25 * A2, this.valveState);
          nodes.push(cut); rads.push(cut);
          feed = m3;
        }
        const tail = L(pipe * 0.3, mid.Y, 9000, dw);
        // depois do abafador a onda já é fraca: quase não se afia de novo (senão refaz os agudos que ele tirou)
        tail.kNL = cfg.muffler === 'stock' ? 0.08 : 0.6;
        nodes.push(new TwoPort(fs, port(feed, 1), port(tail, 0), cfg.muffler));
        const r = new Radiator(fs, tail, panL, panR, 1500 / ds, A2); nodes.push(r); rads.push(r);
      };
      const routing = cfg.routing;
      if (routing === 'single') {
        const mid = L(pipe * 0.55, Ym * (cfg.banks === 2 ? 1.4 : 1), 9000, dw);
        nodes.push(new Junction([...bankOut.map((o) => port(o, 1)), port(mid, 0)]));
        addTail(mid, 0.62, 0.78);
      } else if (cfg.banks === 1 || routing === 'xpipe') {
        const mL = L(pipe * 0.55, Ym, 9000, dw), mR = L(pipe * 0.55 * 1.03, Ym, 9000, dw);
        nodes.push(new Junction([...bankOut.map((o) => port(o, 1)), port(mL, 0), port(mR, 0)]));
        addTail(mL, 0.95, 0.32); addTail(mR, 0.32, 0.95);
      } else if (routing === 'hpipe') {
        const mL = L(pipe * 0.55, Ym, 9000, dw), mR = L(pipe * 0.55 * 1.03, Ym, 9000, dw);
        const bal = L(0.28, Ym * 0.35, 6000); bal.kNL = 0;
        nodes.push(new Junction([port(bankOut[0], 1), port(mL, 0), port(bal, 0)]));
        nodes.push(new Junction([port(bankOut[1], 1), port(mR, 0), port(bal, 1)]));
        addTail(mL, 0.95, 0.32); addTail(mR, 0.32, 0.95);
      } else {
        // duplo: bancadas totalmente separadas até as ponteiras
        if (cfg.layout === 'boxer') {
          // boxer traseiro: o tubo da bancada B cruza por baixo do motor e cada
          // ponteira fica de um lado, mais perto de um ouvido. Assim a meia-ordem de
          // cada bancada (1,5ª num flat-6, que se anula quando as bancadas se somam
          // por igual) sobrevive: é ela que separa o "ronco de boxer" de um 6 em linha.
          const bp = this.boxerPan;
          addTail(bankOut[0], bp[0], bp[1]);
          addTail(bankOut[1], bp[2], bp[3]);
        } else {
          addTail(bankOut[0], 0.95, 0.28);
          addTail(bankOut[1], 0.28, 0.95);
        }
      }
      this.lines = lines; this.nodes = nodes; this.runners = runners; this.rads = rads;
      this.radHP = rads.map(() => new Biquad().hp(this.fs, 45, 0.7));
      this.radSh = rads.map(() => new Biquad().hshelf(this.fs, 900, 5));
      this.jetF = rads.map(() => [new Biquad().bp(this.fs, 450, 0.5), new Biquad().bp(this.fs, 1400, 0.6)]);
      this.jetEnv = rads.map(() => 0);
    }

    buildFilters(cfg) {
      const fs = this.fs;
      const intake = cfg.intake;
      if (intake === 'itb') {
        // o pulso da válvula percorre a corneta e se espalha; o que sai pela boca é
        // grave e encorpado. Sem esse corte o pulso derivado vira um "zzzz" metálico.
        this.inF = [new Biquad().hp(fs, 60), new Biquad().peak(fs, 600, 1.1, 6), new Biquad().lp(fs, 1700, 0.7), new Biquad().lp(fs, 3000, 0.6)];
        this.inGain = 1.6; this.hissF = new Biquad().bp(fs, 2400, 0.7); this.hissGain = 0.45;
      } else if (intake === 'sport') {
        this.inF = [new Biquad().hp(fs, 45), new Biquad().peak(fs, 280, 1.2, 6), new Biquad().lp(fs, 1300, 0.7), new Biquad().lp(fs, 2400, 0.6)];
        this.inGain = 1.1; this.hissF = new Biquad().bp(fs, 1700, 0.7); this.hissGain = 0.3;
      } else {
        this.inF = [new Biquad().hp(fs, 35), new Biquad().peak(fs, 160, 2.0, 8), new Biquad().lp(fs, 1000, 0.7)];
        this.inGain = 0.8; this.hissF = new Biquad().bp(fs, 1200, 0.8); this.hissGain = 0.2;
      }
      this.clickF = [new Biquad().bp(fs, 3600, 3), new Biquad().bp(fs, 7200, 4)];
      this.knockF = [new Biquad().bp(fs, 900, 3), new Biquad().bp(fs, 2100, 4), new Biquad().bp(fs, 4200, 5)];
      this.mechHP = new Biquad().hp(fs, 80);
      this.saF = new Biquad().bp(fs, 2600, 0.8);
      this.fanF = new Biquad().lp(fs, 900, 0.6);
      this.vibLP = new Biquad().lp(fs, 200, 0.7);
      this.starterLP = new Biquad().lp(fs, 2200, 0.8);
      this.turboHiss = new Biquad().bp(fs, 4800, 0.9);
      this.bovF = [new Biquad().bp(fs, 2300, 0.9), new Biquad().bp(fs, 5400, 1.3)];
      // cabine: a carroceria isola o médio e o agudo (lei da massa) e o habitáculo ressoa no grave
      this.cabL = [new Biquad().lp(fs, 420, 0.7), new Biquad().lp(fs, 1100, 0.6), new Biquad().peak(fs, 70, 1.1, 7)];
      this.cabR = [new Biquad().lp(fs, 420, 0.7), new Biquad().lp(fs, 1100, 0.6), new Biquad().peak(fs, 70, 1.1, 7)];
      this.cabIn = new Biquad().lp(fs, 900, 0.7);
      this.cabMech = new Biquad().lp(fs, 1200, 0.7);
      this.bayEx = new Biquad().lp(fs, 900, 0.7);
      this.inPrev = 0;
      this.clickEnv = 0; this.knockEnv = 0;
    }

    // Vazão de escape resolvida implicitamente contra a pressão do tubo primário.
    exhaustFlow(A, pc, Tc, pb, Z) {
      if (pb < 2000) pb = 2000;
      // refluxo pela válvula tem coeficiente de descarga bem menor que o fluxo direto
      if (pb > pc) A *= this.revCd;
      const F0 = flow(A, pc, Tc, pb, T_BACK);
      let lo, hi, glo, ghi;
      if (F0 >= 0) { lo = 0; glo = F0; hi = F0; ghi = flow(A, pc, Tc, pb + Z * F0, T_BACK) - F0; }
      else { hi = 0; ghi = F0; lo = F0; glo = flow(A, pc, Tc, Math.max(2000, pb + Z * F0), T_BACK) - F0; }
      if (glo - ghi < 1e-12) return F0;
      let side = 0, m = lo;
      for (let k = 0; k < this.solverIt; k++) {
        m = (lo * ghi - hi * glo) / (ghi - glo);
        const g = flow(A, pc, Tc, Math.max(2000, pb + Z * m), T_BACK) - m;
        if (g > 0) { lo = m; glo = g; if (side === 1) ghi *= 0.5; side = 1; }
        else { hi = m; ghi = g; if (side === -1) glo *= 0.5; side = -1; }
      }
      return m;
    }

    // Atualizações de controle (taxa reduzida).
    control(dtc) {
      const rpm = this.rpmAvg;
      const user = this.thrTarget;
      if (this.prevThrUser > 0.35 && user < 0.1 && rpm > this.redline * 0.42) this.popWindow = 1.3;
      this.popWindow = Math.max(0, this.popWindow - dtc);
      this.prevThrUser = user;

      this.runT = this.state === 'run' ? (this.runT || 0) + dtc : 0;
      // ---- temperatura do motor
      if (this.tempMode === 'fixed') this.coolant = this.tempSet;
      else {
        // calor que vai para a água cresce com giro e carga; a carcaça perde um pouco para o ar;
        // a válvula termostática abre perto de 90 °C e manda a água para o radiador
        const load = this.state === 'run' ? Math.sqrt(Math.max(0.2, (rpm * clamp(this.pMan / P0, 0.15, 2.5)) / 240)) : 0;
        let dT = 0.135 * load - 0.0008 * (this.coolant - this.ambientT);
        const air = 0.35 + clamp(this.v / 25, 0, 1.5) + (this.fanOn ? 1.2 : 0);
        dT -= smooth(86, 95, this.coolant) * 0.06 * (this.coolant - 80) * air;
        this.coolant += dT * dtc;
      }
      // ventoinha do radiador liga perto de 100 °C e desliga uns graus abaixo
      if (this.coolant > 99 && this.state === 'run') this.fanOn = true; else if (this.coolant < 93 || this.state === 'off') this.fanOn = false;
      this.fanSpin += ((this.fanOn ? 1 : 0) - this.fanSpin) * (1 - Math.exp(-dtc / (this.fanOn ? 1.5 : 4)));
      this.warm = smooth(15, 80, this.coolant);
      const cold = 1 - this.warm;
      // partida a frio: a central atrasa a ignição para esquentar o catalisador (ronco mais
      // rasgado) e liga a bomba de ar secundário por um minuto ou dois
      // (escape direto de corrida/moto não tem catalisador nem bomba de ar)
      const hasCat = this.cfg && this.cfg.muffler !== 'straight';
      this.catRetard = this.state === 'run' && hasCat ? 12 * (1 - smooth(30, 60, this.coolant)) * (1 - smooth(45, 80, this.runT)) * (user < 0.3 ? 1 : 0.4) : 0;
      const saWant = hasCat && this.state === 'run' && this.coolant < 45 && this.runT < 100 ? 1 : 0;
      this.secAir += (saWant - this.secAir) * (1 - Math.exp(-dtc / (saWant ? 0.8 : 1.5)));

      // controle de marcha lenta como numa ECU: válvula de ar (lenta) + avanço (rápido)
      if (this.state === 'run' || this.state === 'crank') {
        // motor frio: marcha lenta acelerada, e uma arrancada de giro logo depois de pegar
        const flare = this.state === 'run' && this.runT < 3 ? Math.exp(-this.runT / 1.2) * (200 + 450 * cold) : 0;
        this.idleTarget = this.idle * (1 + 0.42 * cold) + flare;
        const e = (this.idleTarget - rpm) / this.idleTarget;
        const active = user < 0.05 && !(this.shifting && this.blip);
        const de = (e - this.ePrev) / dtc; this.ePrev = e;
        // integra também para baixo quando o giro está parado acima do alvo (ex.: o motor esquentou
        // e a lenta acelerada acabou); só não integra enquanto o giro está despencando de uma acelerada
        // (bem devagar: puxar com força aqui fazia o controle exagerar e entrar num vai-e-vem que apagava o motor)
        if (active && (e > -0.15 || this.runT < 4)) this.iacI = clamp(this.iacI + clamp(e, -0.3, 0.3) * dtc * this.KI, 0, 0.05);
        else if (active && de < 0.08) this.iacI = clamp(this.iacI - 0.15 * dtc * this.KI * this.iacTrim, 0, 0.05);
        // resgate contra apagamento: só age quando a rotação cai abaixo da lenta
        const rescue = active && e > 0.15 ? e - 0.15 : 0;
        // "dashpot": mantém ar extra na desaceleração para o coletor não chegar vazio na lenta
        if (user > 0.08) this.dash = 0.006 * Math.min(1, user * 2);
        else this.dash *= Math.exp(-dtc / 1.5);
        const dash = this.dash;
        this.iac = clamp(this.iacI + (active ? Math.max(this.KP * e, -0.5 * this.iacI) + this.KD * de : 0) + rescue * this.RG + dash, 0, 0.1);
        this.advTrim = active && e > -0.3 ? clamp(this.KA * e + this.KAD * de + rescue * 60, -8, 16) : 0;
        if (this.state === 'crank') this.iac = Math.max(this.iac, 0.02);
      } else { this.advTrim = 0; }

      let want = user;
      if (this.shifting && this.blip) want = rpm < this.vehOmega() * 9.55 * 1.02 ? 0.85 : 0;
      if (this.shifting && this.shiftCut && !this.ignCut) want = 0;
      // câmbio automático corta torque na subida de marcha (sem isso o motor dispara no meio da troca)
      // automático com o pé pela metade: reduz torque atrasando a ignição, borboleta aberta
      // (e nas trocas rápidas, durante o escorregamento da embreagem, um pouco de atraso alisa a descida do giro)
      this.shiftRetard = this.shiftUp && this.gear > 1 && this.ignCut && (this.shifting || (!this.locked && this.sinceShift < 0.8)) && !(this.shifting && this.shiftCut);
      this.sinceShift = (this.sinceShift || 0) + dtc;
      // 2-step: parado e de pé embaixo
      // como no carro de verdade: só segura com a embreagem pisada (ponto morto) ou o freio apertado
      this.launching = this.twoStep && this.state === 'run' && this.v < 1 && user > 0.6 && (this.gear === 0 || this.brake > 0.5);
      if (this.launching && this.twoStepMode === 'soft') {
        // controle de largada: a ECU fecha a borboleta o quanto precisa para o giro ficar
        // parado na rotação escolhida — sem cortar ignição, sem estouro
        const e = (this.launchRpm - rpm) / this.launchRpm;
        const de = ((rpm - (this.lcPrev ?? rpm)) / dtc) / this.launchRpm; // subida relativa por segundo
        this.lcPrev = rpm;
        if (Math.abs(e) < 0.15) this.lcI = clamp(this.lcI + e * dtc * 4, -0.2, 0.7);
        want = Math.min(want, clamp(this.lcI + 1.6 * e - 0.09 * de, 0, 1));
        // borboleta já fechada e o giro ainda alto (motor de borboletas individuais solto):
        // atrasa a ignição, como as centrais de largada fazem
        this.dash = 0;
        if (e < 0) { this.advTrim = clamp(160 * e, -35, 0); this.iac = Math.min(this.iac, 0.004); }
      } else { this.lcI = 0.12; this.lcPrev = undefined; }
      // corte por borboleta (central eletrônica): fecha o acelerador chegando no limite, liso
      // (olha a velocidade com que o giro sobe para frear antes de chegar, sem passar do limite)
      const rpmRate = (rpm - (this.limPrev ?? rpm)) / dtc; this.limPrev = rpm;
      if (this.limType === 'throttle' && !this.launching) {
        // mesmo controlador do controle de largada (PI + amortecimento pela subida do giro),
        // mirando um pouco abaixo da faixa vermelha
        const tb = Math.max(this.limBand, 250), target = this.redline - 40;
        if (rpm > target - tb) {
          const e = (target - rpm) / target, de = rpmRate / target;
          if (this.limI === undefined) this.limI = Math.min(1, want);
          // ganhos altos: em giro alto a borboleta só tira ar de verdade quando está quase fechada
          if (Math.abs(e) < 0.08) this.limI = clamp(this.limI + e * dtc * 40, -0.3, 1);
          want = Math.min(want, clamp(this.limI + 12 * e - 0.25 * de, 0, 1));
          // a borboleta é lenta (o coletor demora a esvaziar): o atraso de ignição tira torque na hora
          const ahead = rpm + 0.08 * Math.max(0, rpmRate);
          this.limRetard = clamp((ahead - (target - 0.25 * tb)) / (0.3 * tb) * 30, 0, 32);
          // (o ar extra da marcha lenta e do dashpot também é cortado, senão sustenta o giro sozinho)
          if (this.limRetard > 0) { this.dash = 0; this.iac = Math.min(this.iac, 0.003); }
        } else { this.limI = undefined; this.limRetard = 0; }
      } else this.limRetard = 0;
      this.thr += (want - this.thr) * (1 - Math.exp(-dtc / 0.03));

      // turbo
      if (this.turbo) {
        const flowN = (rpm / this.redline) * (0.15 + 0.85 * clamp(this.pMan / P0, 0, 1.5)) * (this.state === 'run' ? 1 : 0.2);
        const target = clamp(flowN * 1.35, 0, 1);
        const tau = target > this.turboW ? 0.55 : 1.2;
        this.turboW += (target - this.turboW) * (1 - Math.exp(-dtc / tau));
        const avail = this.maxBoost * Math.pow(smooth(0.25, 0.85, this.turboW), 1.3);
        const boostWant = avail * smooth(0.35, 0.9, this.thr);
        const prev = this.boost;
        this.boost += (boostWant - this.boost) * (1 - Math.exp(-dtc / (boostWant > this.boost ? 0.12 : 0.05)));
        if (prev > 0.35 && this.thr < 0.25 && user < 0.2 && this.bovEnv < 0.2) { this.bovAmp = prev / Math.max(0.3, this.maxBoost); this.bovEnv = 1; }
      } else if (this.blower) {
        // compressor de deslocamento positivo: a pressão vem na hora, proporcional ao giro;
        // sem acelerar, a válvula de alívio abre e ele só gira em vazio
        const boostWant = this.maxBoost * Math.pow(clamp(rpm / (this.redline * 0.5), 0, 1), 0.6) * smooth(0.2, 0.9, this.thr);
        this.boost += (boostWant - this.boost) * (1 - Math.exp(-dtc / 0.05));
      } else this.boost = 0;
      this.bovEnv *= Math.exp(-dtc / 0.22);

      // 2-step com corte: a ECU segura o giro cortando a ignição (alguns estouros no escape)
      const lt = this.limType;
      if (this.launching && this.twoStepMode === 'cut') {
        if (this.rpmAvg > this.launchRpm) this.limiter = true;
        else if (this.rpmAvg < this.launchRpm - 260) this.limiter = false;
      } else if (lt === 'partial') {
        // corte parcial: corta uma fração das explosões, crescendo com o quanto passou do limite
        const start = this.redline - this.limBand * 0.5;
        this.limFrac = clamp((this.rpmAvg - start) / (this.limBand * 0.6), 0, 1);
        this.limiter = this.limFrac > 0;
      } else if (lt === 'ign' || lt === 'fuel') {
        // corte total com histerese e tempo mínimo: o giro bate no limite e volta
        if (!this.limiter && this.rpmAvg > this.redline) { this.limiter = true; this.limT = 0; }
        else if (this.limiter) {
          this.limT += dtc;
          if (this.limT >= this.limHold && this.rpmAvg < this.redline - this.limBand) this.limiter = false;
        }
      } else if (lt === 'throttle') {
        // a borboleta já segura; corta combustível só de segurança se passar muito
        if (this.rpmAvg > this.redline + 200) this.limiter = true; else if (this.rpmAvg < this.redline) this.limiter = false;
      } else this.limiter = false; // sem corte: as válvulas flutuam (ver combustão)

      // válvula do abafador (atuador leva ~0,15 s); no automático abre com carga ou giro alto
      if (this.valveMode === 'auto') {
        if (user > 0.55 && rpm > this.idle * 1.6 || rpm > this.redline * 0.62) this.valveAuto = true;
        else if (user < 0.3 && rpm < this.redline * 0.5) this.valveAuto = false;
      }
      const vt = this.valveMode === 'open' || (this.valveMode === 'auto' && this.valveAuto) ? 1 : 0;
      this.valveState.v += (vt - this.valveState.v) * (1 - Math.exp(-dtc / 0.15));

      if (this.state === 'crank') {
        this.crankT += dtc;
        if (this.crankT > 0.45 && rpm > Math.min(this.idle * 0.7, 550)) this.state = 'run';
        if (this.crankT > 5) this.state = 'off';
      }
      if (this.state === 'run' && rpm < 150 && this.omega < 15) this.state = 'off';

      // câmbio
      if (this.shifting) {
        this.shiftT -= dtc;
        if (this.shiftT <= 0) { this.shifting = false; this.shiftCut = false; this.blip = false; }
      } else this.clutch = Math.min(1, this.clutch + dtc / Math.max(this.shiftUp && this.gear > 1 ? 0.2 : 0.02, 0.5 * this.shiftTime));
      this.shiftCool -= dtc;
      this.denied = Math.max(0, (this.denied || 0) - dtc);
      if (this.auto && this.gear > 0 && !this.shifting && this.shiftCool <= 0) {
        const n = this.ratios.length - 1;
        const t = clamp(user, 0, 1);
        // sem acelerar o câmbio segura a marcha (freio-motor); só sobe para não estourar o giro
        // modo do câmbio: pista/esportivo/normal/econômico trocam em rotações fixas;
        // automático decide pelo quanto o acelerador está pisado
        const Rl = this.redline, I = this.idle, mode = this.driveMode;
        const FIXED = {
          track: [0.97 * Rl, 0.7 * Rl],
          sport: [0.85 * Rl, 0.5 * Rl],
          normal: [clamp(I * 3.6, 0.38 * Rl, 0.6 * Rl), I * 1.9],
          eco: [clamp(I * 2.6, 0.25 * Rl, 0.45 * Rl), I * 1.4],
        }[mode];
        const sp = 0.5, base = this.idle * (1.4 + 1.2 * sp);
        let up = FIXED ? FIXED[0] : base + (this.redline * 0.94 - base) * Math.pow(t, 2.2 - 1.8 * sp);
        if (t < 0.05) up = Math.max(up, this.redline * 0.94); // sem acelerar segura a marcha (freio-motor)
        // reduz desacelerando (antes de o giro cair na lenta) e no kickdown
        const down = FIXED ? FIXED[1] : this.idle * (1.3 + 0.8 * sp) + this.redline * 0.42 * t * t;
        if (this.v < 0.6 && this.gear > 1) {
          // parado: volta direto para a 1ª, pronto para sair
          this.gear = 1; this.shifting = true; this.shiftT = 0.15; this.clutch = 0; this.shiftCut = false; this.blip = false; this.shiftCool = 0.4;
        } else if (this.locked && rpm > up && this.gear < n) this.requestShift(1);
        else if (rpm < down && this.gear > 1) {
          const nextRpm = rpm * this.ratios[this.gear - 1] / this.ratios[this.gear];
          if (nextRpm < this.redline * 0.9 && (!FIXED || nextRpm < up * 0.92)) this.requestShift(-1);
        }
      }
    }

    vehOmega() { return this.gear ? (this.v / 0.33) * this.ratios[this.gear] * this.final : 0; }

    process(outL, outR, n, sendL, sendR) {
      if (!this.cfg) { outL.fill(0); if (outR !== outL) outR.fill(0); if (sendL) { sendL.fill(0); sendR.fill(0); } return; }
      const fs = this.fs, dt = this.dt, N = this.N, rng = this.rng;
      const fire = this.fire, aPrev = this.aPrev, pc_ = this.p, m_ = this.m;
      const P = this.params;
      const targetE = P.listener === 'ext' ? 1 : 0, targetI = P.listener === 'int' ? 1 : 0, targetB = P.listener === 'bay' ? 1 : 0;
      const targetP = P.listener === 'pipe' ? 1 : 0, targetR = P.listener === 'road' ? 1 : 0;
      if (this.ambEnv !== P.env) this.setAmbience(P.env);
      const loop = ENV_LOOP[P.env] || 800;
      const kw = 1 - Math.exp(-dt / 0.15);
      const evo = this.evo, evc = this.evc, ivo = this.ivo, ivc = this.ivc;
      const lines = this.lines, nodes = this.nodes, runners = this.runners, rads = this.rads;
      const nL = lines.length, nN = nodes.length, nR = rads.length;
      const r = this.rCrank, l = this.lRod, Ap = this.Ap, Vc = this.Vc, Zr = this.Zr, hw = this.hw;
      const g1 = GAM - 1;

      for (let s = 0; s < n; s++) {
        if (this.ctrl-- <= 0) { this.control(16 * dt); this.ctrl = 15; }
        const omega = this.omega;
        const rpm = omega * 9.549296585513721;
        this.rpmAvg += (rpm - this.rpmAvg) * Math.min(1, dt * Math.max(4, rpm / 60));
        const rpmFrac = rpm / this.redline;
        const running = this.state === 'run';
        const cranking = this.state === 'crank' && this.crankT > 0.25 && this.rpmAvg > 60;
        const dfco = running && this.thr < 0.02 && this.rpmAvg > this.idle + 450 && !this.shifting && !(this.launching && this.twoStepMode === 'soft');
        const cut = this.limiter || (this.shifting && this.shiftCut);
        const deg = (omega * dt) / DEG;
        const rf = clamp(rpmFrac, 0, 1.1);
        const adv = 10 + 24 * rf + this.advTrim - (this.shiftRetard ? 26 : 0) - this.catRetard - (this.limRetard || 0);
        const aSp = 720 - adv;
        const burn = 42 + 26 * rf;
        const hwr = hw * Math.max(0.06, rpm / 3000);

        // ---- coletor de admissão (borboleta + soma das válvulas)
        const pUp = P0 * (1 + this.boost);
        const thrA = this.Athr * (1 - Math.cos(this.thr * Math.PI / 2) + this.iac + 0.00005);
        const mThr = flow(thrA, pUp, T_MAN, this.pMan, T_MAN);
        const pMan = this.pMan;

        for (let i = 0; i < nL; i++) lines[i].read();

        const wn = rng.bi();
        this.tzLP += this.tzK * (wn - this.tzLP);
        const hiN = (wn - this.tzLP) * 1.4;
        let Tgas = 0, mInSum = 0, vib = 0, intake = 0;
        for (let c = 0; c < N; c++) {
          let a = this.theta - fire[c]; if (a < 0) a += 720;
          const ap = aPrev[c];
          // ---- centelha
          // a centelha é armada no curso de admissão e dispara uma única vez por ciclo,
          // mesmo que o avanço mude de repente
          if (a >= 360 && a < 540) this.armed[c] = 1;
          if (this.armed[c] && (a >= aSp || a < 180)) {
            this.armed[c] = 0;
            this.spk[c] = a;
            let cutNow = cut;
            if (this.limiter && this.limType === 'partial' && !this.launching) {
              // rodízio: acumula a fração de corte e corta a explosão quando passa de 1
              cutNow = this.shifting && this.shiftCut;
              this.lacc = (this.lacc || 0) + this.limFrac;
              if (this.lacc >= 1) { this.lacc -= 1; cutNow = true; }
            }
            const combust = (running || cranking) && !cutNow && !dfco;
            const idleness = clamp(1 - (this.rpmAvg - this.idle) / 1500, 0, 1);
            // frio: a mistura vaporiza mal e cada explosão sai um pouco diferente
            const sigma = (0.025 + idleness * (0.015 + 0.06 * this.cam * this.cam)) * (1 + 0.9 * (1 - this.warm));
            // sem limitador (motor antigo): passando da faixa vermelha as válvulas flutuam,
            // a mistura não entra direito e o motor falha e perde força
            const float = this.limType === 'none' ? clamp((this.rpmAvg - this.redline) / (0.08 * this.redline), 0, 1) : 0;
            const misfire = rng.next() < this.cam * this.cam * 0.02 * idleness + 0.6 * float;
            if (combust && !misfire) {
              this.Q[c] = Math.max(0, this.air[c]) * 2.6e6 * this.cylQ[c] * (1 - 0.7 * float) * clamp(1 + sigma * this.varScale * this.fuelVar * rng.gauss(), 0.3, 1.5);
              this.xb[c] = 0;
              this.knockEnv += 0.6 + 0.4 * rng.next();
            } else {
              this.Q[c] = 0; this.xb[c] = 1;
              const pl = this.popsLevel;
              if (pl > 0 && running && this.rpmAvg > this.idle * 1.4 && !combust) {
                let pr = 0;
                if (this.launching && this.limiter) pr = 0.12;
                // ignição cortada: o combustível passa e estoura no escape; corte de combustível é seco
                else if (this.limiter) pr = { ign: 0.4, fuel: 0.02, partial: 0.15, throttle: 0.02 }[this.limType] ?? 0;
                else if (this.shifting && this.shiftCut) pr = 0.55;
                else if (dfco) pr = 0.32 * (this.popWindow / 1.3);
                if (rng.next() < pr * pl && this.pops.length < 10) {
                  const delay = ((evo + adv + 30) / Math.max(600, rpm * 6)) * fs + rng.next() * 0.006 * fs;
                  this.pops.push({ d: delay | 0, t: 0, bank: this.cfg.bank[c], amp: (0.5 + 0.7 * rng.next()) * pl * 1.2e5 });
                }
              }
            }
          }
          // ---- válvulas (cliques do trem de válvulas)
          if ((ap < evo && a >= evo) || (ap < evc && a >= evc) || (ap < ivo && a >= ivo) || (ap < ivc && a >= ivc)) this.clickEnv += 0.5 + 0.5 * rng.next();
          if (ap < ivo && a >= ivo) this.air[c] = 0;
          aPrev[c] = a;

          // ---- volume
          const th = a * DEG, sn = Math.sin(th), cs = Math.cos(th);
          const q = Math.sqrt(l * l - r * r * sn * sn);
          const V = Vc + Ap * (r * (1 - cs) + l - q);
          const dxdth = r * sn * (1 + (r * cs) / q);
          const dV = V - this.Vprev[c];
          this.Vprev[c] = V;

          let p = pc_[c], m = m_[c];
          const T = clamp((p * V) / (m * RGAS), 220, 3200);

          // ---- combustão (Wiebe)
          let dQ = 0;
          if (this.xb[c] < 1) {
            let d = a - this.spk[c]; if (d < -360) d += 720;
            if (d < 0) d = 0;
            const u = d / burn;
            const x = u >= 1 || d > 360 ? 1 : 1 - Math.exp(-5 * u * u * u);
            dQ = this.Q[c] * (x - this.xb[c]);
            this.xb[c] = x;
          }
          dQ -= hwr * (T - T_WALL) * dt;

          // ---- válvula de escape -> tubo primário
          let mEx = 0;
          const run = runners[c];
          if (a > evo && a < evc) {
            const sv = Math.sin(Math.PI * (a - evo) / (evc - evo));
            const A = this.AexMax * this.cylEx[c] * Math.min(1, 1.5 * sv * sv);
            mEx = this.exhaustFlow(A, p, T, P0 + 2 * run.in0, Zr);
          }
          // turbulência no vão da válvula: só no "estouro" da abertura, quando o gás sai
          // engasgado (pressão no cilindro bem acima do tubo). No resto do curso o escoamento
          // é manso; deixar o chiado ligado o tempo todo vira um som de vento contínuo.
          // O jato engasgado chia em alta frequência (rasgado); grave e médio continuam tonais.
          let turb = 0;
          if (mEx > 0) turb = this.valveNoise * clamp((p / (P0 + 2 * run.in0) - 1.25) / 1.2, 0, 1);
          run.out0 = 0.985 * run.in0 + Zr * mEx * (1 + turb * hiN);
          this.mEx[c] = mEx;

          // ---- válvula de admissão
          let mIn = 0;
          if (a > ivo && a < ivc) {
            const sv = Math.sin(Math.PI * (a - ivo) / (ivc - ivo));
            const A = this.AinMax * this.cylIn[c] * Math.min(1, 1.5 * sv * sv);
            mIn = flow(A, pMan, T_MAN, p, T);
          }
          mInSum += mIn;
          intake += mIn;
          this.air[c] += mIn * dt;

          // ---- 1ª lei para volume de controle aberto
          const hIn = mIn >= 0 ? T_MAN : T, hEx = mEx >= 0 ? T : T_BACK;
          p += (g1 * dQ + GAM * RGAS * (hIn * mIn - hEx * mEx) * dt - GAM * p * dV) / V;
          // blow-by pelos anéis: relevante só em baixa rotação (partida)
          const mLk = p > P0 ? (this.Aleak * (p - P0) * 0.67) / Math.sqrt(RGAS * T) : 0;
          p -= (GAM * RGAS * T * mLk * dt) / V;
          m += (mIn - mEx - mLk) * dt;
          if (m < 1e-9) m = 1e-9;
          if (p < 3000) p = 3000;
          pc_[c] = p; m_[c] = m;

          Tgas += (p - P0) * Ap * dxdth;

          // ---- forças de inércia (vibração)
          const ph = (this.theta - this.tdcRel[c]) * DEG;
          const acc = Math.cos(ph) + 0.3 * Math.cos(2 * ph);
          vib += (0.6 * this.ux[c] + this.uy[c] + 0.35 * this.dz[c] * (this.ux[c] + this.uy[c])) * acc;
        }
        this.pMan = clamp(pMan + ((mThr - mInSum) * dt * RGAS * T_MAN) / this.Vman, 3000, pUp * 1.05);

        // ---- dinâmica: virabrequim + embreagem + veículo
        const nk = (rpm / this.redline) * 7;
        // óleo frio é grosso: mais atrito
        const fmep = (0.95e5 + 0.12e5 * nk + 0.02e5 * nk * nk) * (1 + 0.5 * (1 - this.warm));
        const Tfr = (fmep * this.dispL * 1e-3) / (4 * Math.PI) * (omega > 0.5 ? 1 : 0.6);
        let Tst = 0;
        if (this.state === 'crank') Tst = (70 * this.dispL / Math.sqrt(this.N) * 2 + 40) * Math.max(0, 1 - rpm / 330);
        let Tcl = 0;
        // segurando o 2-step a embreagem fica aberta (pedal pisado / dupla embreagem esperando)
        if (this.gear > 0 && this.clutch > 0 && !this.launching) {
          // embreagem automática: patina segurando o giro de arrancada, trava ao sincronizar
          const slip = omega - this.vehOmega();
          if (Math.abs(slip) < 12 && this.clutch >= 1 && this.rpmAvg > this.idle * 0.95) this.locked = true;
          else if (Math.abs(slip) > 40 || this.clutch < 1 || (this.rpmAvg < this.idle * 0.85 && this.thr < 0.1)) this.locked = false;
          const launch = Math.max(this.idle * 2.2, this.redline * 0.36);
          // sem acelerar e fora de sincronia, a embreagem fica aberta (como pisar no pedal)
          // embalado acima da lenta, ela acopla mesmo sem acelerar (como soltar o pedal
          // depois de trocar a marcha): o motor é puxado até o giro das rodas e segura
          const coast = this.clutch * this.Tmax * 0.6 * smooth(this.idle * 1.05, this.idle * 1.4, this.vehOmega() * 9.549);
          // depois de uma troca, com o carro andando, é uma embreagem normal sendo solta:
          // aguenta bem mais que o motor e sincroniza em décimos de segundo. A patinada
          // controlada (capacidade limitada) é só para sair do lugar.
          const moving = this.vehOmega() * 9.549 > this.idle * 1.1;
          const cap = this.locked
            ? this.Tmax * 2.6 * smooth(this.idle * 0.75, this.idle * 1.0, rpm)
            : moving
              ? Math.max(coast, (this.ignCut && this.shiftUp && this.clutch > 0
                ? 0.65 + 1.6 * this.clutch * this.clutch * (3 - 2 * this.clutch) // troca rápida: a embreagem nova já segura o motor desde o começo
                : 2.2 * this.clutch * this.clutch * (3 - 2 * this.clutch)) * this.Tmax * smooth(this.idle * 0.6, this.idle * 0.95, rpm))
              : Math.max(coast, this.clutch * this.Tmax * 1.15 * smooth(this.idle * 1.05, launch, rpm) * smooth(0.02, 0.12, this.thr));
          Tcl = clamp(220 * slip, -cap, cap);
        } else this.locked = false;
        const w = Math.max(0, omega + ((Tgas + Tst - Tfr - Tcl) / this.J) * dt);
        if (!this.lockOmega) this.omega = w;
        this.theta += deg; if (this.theta >= 720) this.theta -= 720;
        this.tqGas += (Tgas - this.tqGas) * 0.002;
        this.tqMean += (Tgas - Tfr - this.tqMean) * 0.0004;
        if (this.gear > 0) {
          const ratio = this.ratios[this.gear] * this.final;
          const F = (Tcl * ratio) / 0.33 - 0.42 * this.v * this.v - (this.v > 0.05 ? 165 : 0) - this.brake * 13000 * (this.v > 0.05 ? 1 : 0);
          this.v = Math.max(0, this.v + (F / this.mass) * dt);
        } else if (this.v > 0) {
          this.v = Math.max(0, this.v - ((0.42 * this.v * this.v + 165 + this.brake * 13000) / this.mass) * dt);
        }

        // ---- rede acústica do escape
        for (let i = this.pops.length - 1; i >= 0; i--) {
          const pp = this.pops[i];
          if (pp.d > 0) { pp.d--; continue; }
          const t = pp.t / fs;
          const v = pp.amp * (Math.exp(-t / 0.0006) * (1 + 0.6 * rng.bi()) + 0.55 * rng.bi() * Math.exp(-t / 0.0035));
          this.bankJ[Math.min(pp.bank, this.bankJ.length - 1)].inj += v;
          if (++pp.t > 0.03 * fs) this.pops.splice(i, 1);
        }
        for (let i = 0; i < nN; i++) nodes[i].step();
        for (let i = 0; i < nL; i++) lines[i].write();

        // ---- ponteira: irradiação + ruído de jato (escala com a velocidade do gás)
        let exL = 0, exR = 0;
        for (let i = 0; i < nR; i++) {
          const rd = rads[i];
          const e = rd.emit;
          let x = this.radSh[i].run(this.radHP[i].run(e));
          const vel = Math.max(0, e) / (2.5e4 * this.pipeA);
          this.jetEnv[i] += (vel - this.jetEnv[i]) * 0.15;
          const jv = this.jetEnv[i];
          const nz = rng.bi();
          x += (this.jetF[i][0].run(nz) + 0.8 * this.jetF[i][1].run(nz)) * jv * jv * this.jetGain;
          exL += x * rd.panL; exR += x * rd.panR;
        }

        // ---- admissão
        let inS;
        {
          const dIn = (intake - this.inPrev) * fs;
          this.inPrev = intake;
          let x = dIn * 0.9 / (this.N * 0.5 + 1) / Math.max(0.02, this.Vd * 1e3);
          for (let i = 0; i < this.inF.length; i++) x = this.inF[i].run(x);
          const air = clamp(mInSum / (this.Vd * N * 1.2 * Math.max(rpm, 600) / 120 + 1e-9), 0, 2);
          const hiss = this.hissF.run(rng.bi()) * air * air * this.hissGain * 0.25;
          inS = (x * this.inGain * 0.004 + hiss);
        }

        // ---- mecânico
        let mech = 0;
        {
          this.clickEnv *= 0.88;
          // frio: tuchos e pistão batem mais até o óleo esquentar e as folgas fecharem
          const coldN = 1 - this.warm;
          const cn = rng.bi() * this.clickEnv * (0.15 + rf) * (1 + 1.6 * coldN);
          mech += (this.clickF[0].run(cn) + 0.6 * this.clickF[1].run(cn)) * 0.05;
          this.knockEnv *= 0.93;
          const kn = rng.bi() * this.knockEnv * (0.3 + 0.7 * pMan / P0) * (1 + 1.2 * coldN);
          mech += (this.knockF[0].run(kn) + 0.7 * this.knockF[1].run(kn) + 0.4 * this.knockF[2].run(kn)) * 0.07;
          this.phW += omega * dt; if (this.phW > 1e4) this.phW -= TAU * 1000;
          mech += (Math.sin(this.phW * 23) * 0.6 + Math.sin(this.phW * 2.9 * 12) * 0.4) * 0.002 * rf * rf;
          if (this.state === 'crank') {
            this.phS += (omega * 11 * dt) / TAU; this.phS -= Math.floor(this.phS);
            mech += this.starterLP.run((this.phS * 2 - 1) * 0.05 + rng.bi() * 0.02) * (0.6 + 0.4 * Math.sin(this.phW * 2));
          }
          mech = this.mechHP.run(mech);
          // bomba de ar secundário (zumbido elétrico) e ventoinha do radiador
          if (this.secAir > 0.01 && P.saSound !== false) {
            this.phSA += 760 * dt; if (this.phSA > 1) this.phSA -= 1;
            mech += this.secAir * (0.012 * Math.sin(TAU * this.phSA) + 0.005 * Math.sin(2 * TAU * this.phSA) + 0.01 * this.saF.run(rng.bi()));
          }
          if (this.fanSpin > 0.01 && P.fanSound !== false) {
            this.phFan += 7 * 42 * this.fanSpin * dt; if (this.phFan > 1) this.phFan -= 1;
            mech += this.fanSpin * (0.006 * Math.sin(TAU * this.phFan) + 0.03 * this.fanF.run(rng.bi())) * this.fanSpin;
          }
          const ripple = (Tgas - this.tqGas) / (this.Tmax + 1);
          vib = this.vibLP.run(vib * 0.04 * rf * rf + ripple * 0.05);
        }

        // ---- turbo
        let tur = 0;
        if (this.turbo) {
          const tw = this.turboW;
          const f = 500 + 6200 * tw;
          this.phT += TAU * f * dt; if (this.phT > TAU) this.phT -= TAU;
          const lvl = tw * tw * (0.2 + 0.8 * clamp(pMan / pUp, 0, 1));
          tur += (Math.sin(this.phT) + 0.25 * Math.sin(2 * this.phT + 0.7)) * 0.02 * lvl;
          tur += this.turboHiss.run(rng.bi()) * 0.02 * lvl * (0.3 + this.boost);
          if (this.bovEnv > 0.002) {
            const nz = rng.bi();
            tur += (this.bovF[0].run(nz) + 0.6 * this.bovF[1].run(nz)) * this.bovEnv * this.bovAmp * 0.35;
          }
        }

        // ---- compressor mecânico: o "uivo" dos rotores, polia ~2,4× o virabrequim e
        // 6 passagens de lóbulo por volta do rotor; cresce com o giro e com a pressão
        if (this.blower) {
          const fb = (omega / TAU) * 2.4 * 6;
          this.phB = (this.phB || 0) + TAU * fb * dt; if (this.phB > TAU) this.phB -= TAU;
          const lv = Math.pow(rf, 1.5) * (0.25 + 0.75 * clamp(this.boost / Math.max(0.2, this.maxBoost), 0, 1));
          tur += (Math.sin(this.phB) + 0.45 * Math.sin(2 * this.phB + 0.4) + 0.2 * Math.sin(3 * this.phB + 1.1)) * 0.03 * lv;
          tur += this.turboHiss.run(rng.bi()) * 0.012 * lv;
        }

        // ---- ouvinte (exL/exR em Pa, o resto já em escala de áudio)
        const exScale = 3e-5;
        exL *= exScale * P.exhaust; exR *= exScale * P.exhaust;
        this.wE += (targetE - this.wE) * kw; this.wI += (targetI - this.wI) * kw; this.wB += (targetB - this.wB) * kw;
        this.wP += (targetP - this.wP) * kw; this.wR += (targetR - this.wR) * kw;
        inS *= P.intake; mech *= P.mech; vib *= P.mech;
        let L = 0, R = 0;
        if (this.wE > 1e-4) {
          L += this.wE * (exL + 0.18 * inS + 0.07 * mech + 0.2 * tur + 0.1 * vib);
          R += this.wE * (exR + 0.18 * inS + 0.07 * mech + 0.2 * tur + 0.1 * vib);
        }
        if (this.wP > 1e-4) {
          // microfone colado na ponteira esquerda: campo próximo, quase só escape
          L += this.wP * (1.6 * exL + 0.4 * exR + 0.06 * inS + 0.05 * mech + 0.1 * tur);
          R += this.wP * (1.1 * exL + 0.35 * exR + 0.06 * inS + 0.05 * mech + 0.1 * tur);
        }
        if (this.wI > 1e-4) {
          let cl = exL * 0.75 + exR * 0.25, cr = exR * 0.75 + exL * 0.25;
          for (let i = 0; i < 3; i++) { cl = this.cabL[i].run(cl); cr = this.cabR[i].run(cr); }
          // pela parede corta-fogo chegam admissão, mecânica e a vibração do bloco
          const common = 0.35 * this.cabIn.run(inS) + 0.2 * this.cabMech.run(mech) + 0.25 * tur + 1.2 * vib;
          L += this.wI * (cl * 0.6 + common); R += this.wI * (cr * 0.6 + common);
        }
        if (this.wB > 1e-4) {
          // cofre: o escape chega por baixo do carro, abafado; dominam admissão, comando e bloco
          const ex = this.bayEx.run((exL + exR) * 0.5);
          const b = 0.55 * ex + 1.0 * inS + 0.7 * mech + 0.8 * tur + 0.8 * vib;
          L += this.wB * b; R += this.wB * b;
        }
        // carro andando pela via (posição sempre atualizada; volta de "loop" metros)
        this.carX += this.v * dt;
        if (this.carX > loop / 2) this.carX -= loop;
        this.road((exL + exR) * 0.5, inS + 0.6 * mech + tur, P);
        if (this.wR > 1e-4) { L += this.wR * this.roadL; R += this.wR * this.roadR; }
        // bloqueio DC + compensação de loudness por rotação + saturação suave
        this.mk += (Math.min(3.5, Math.pow(0.3 + 0.7 * Math.min(1, rpmFrac), -1.3)) - this.mk) * 0.0005;
        if (this.fade < 1) this.fade = Math.min(1, this.fade + dt / 0.04);
        const gOut = P.master * 0.5 * this.cfgGain * this.mk * this.fade;
        this.dcL = L - this.dcxL + 0.9985 * this.dcL; this.dcxL = L;
        this.dcR = R - this.dcxR + 0.9985 * this.dcR; this.dcxR = R;
        // som de fundo do ambiente (independe do motor)
        this.ambience(this.wI);
        const gA = P.master * 0.5;
        outL[s] = Math.tanh(this.dcL * gOut + this.ambL * gA);
        if (outR !== outL) outR[s] = Math.tanh(this.dcR * gOut + this.ambR * gA);
        if (sendL) {
          // envio para a reverberação: de longe o som refletido pesa mais que o direto
          const onboard = 1 - this.wR;
          sendL[s] = (this.dcL * onboard + this.wR * this.roadS * (0.75 + 0.25 * this.panS)) * gOut;
          sendR[s] = (this.dcR * onboard + this.wR * this.roadS * (0.75 - 0.25 * this.panS)) * gOut;
        }
      }

      this.telem += n;
      if (this.post && this.telem >= 1024) {
        this.telem = 0;
        this.post(this.telemetry());
      }
    }

    // Propagação do carro até um observador parado a `roadDist` metros da via.
    road(ex, front, P) {
      const fs = this.fs, buf = this.prop;
      const x = this.carX, d = Math.max(1.5, P.roadDist || 6);
      const hs = 0.35, hl = 1.6;
      const h2 = x * x + d * d;
      const rh = Math.sqrt(h2);
      const r1 = Math.sqrt(h2 + (hl - hs) * (hl - hs)), r2 = Math.sqrt(h2 + (hl + hs) * (hl + hs));
      const cosT = -x / rh;              // >0: o observador está à frente do carro
      const rear = 0.5 - 0.5 * cosT;
      // o escape aponta para trás; à frente, a própria carroceria abafa os agudos
      this.shade += onePole(fs, 900 + 15000 * rear * rear) * (ex - this.shade);
      const src = this.shade * (0.3 + 0.8 * rear) + front * (0.5 + 0.3 * cosT);
      buf[this.propW] = src;
      const k = fs / 343;
      const direct = this.readProp(r1 * k), refl = this.readProp(r2 * k);
      this.propW = (this.propW + 1) & this.propMask;
      // absorção do ar e do asfalto
      this.gndL += onePole(fs, 4500) * (refl - this.gndL);
      const mix = (direct * 5) / Math.max(r1, 1.5) + (0.6 * this.gndL * 5) / Math.max(r2, 1.5);
      this.airL += onePole(fs, clamp(20000 * Math.exp(-r1 / 170), 800, 20000)) * (mix - this.airL);
      const pan = clamp(x / r1, -1, 1);
      this.panS = pan;
      const a = (pan + 1) * Math.PI / 4;
      this.roadL = this.airL * Math.cos(a) * Math.SQRT2;
      this.roadR = this.airL * Math.sin(a) * Math.SQRT2;
      this.roadS = (direct * 1.2) / Math.sqrt(Math.max(r1, 3));
      this.rDist = r1;
      this.vRad = (x * this.v) / rh;   // >0: afastando
    }

    // leitura com atraso fracionário (Hermite cúbica): o atraso variável é o Doppler
    readProp(D) {
      const buf = this.prop, m = this.propMask;
      D = Math.min(Math.max(D, 2), m - 4);
      const pos = this.propW - D, i = Math.floor(pos), f = pos - i;
      const y0 = buf[(i - 1) & m], y1 = buf[i & m], y2 = buf[(i + 1) & m], y3 = buf[(i + 2) & m];
      const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
      return ((c3 * f + c2) * f + c1) * f + y1;
    }

    setAmbience(env) {
      this.ambEnv = env;
      const fs = this.fs, a = this.amb;
      const lp = { open: 260, street: 160, tunnel: 380, garage: 300, track: 240, canyon: 200 }[env] || 260;
      const bp = { open: 2500, street: 900, tunnel: 700, garage: 1500, track: 650, canyon: 1600 }[env] || 900;
      a[0].lp(fs, lp, 0.7); a[1].lp(fs, lp, 0.7); a[2].bp(fs, bp, 0.6); a[3].bp(fs, bp, 0.6);
      this.ambSpec = {
        open: [0.05, 0.004, 0, 0], street: [0.045, 0.01, 0, 0], tunnel: [0.04, 0.006, 100, 0.004],
        garage: [0.02, 0.003, 120, 0.002], track: [0.05, 0.012, 0, 0], canyon: [0.06, 0.003, 0, 0],
      }[env] || [0.04, 0.004, 0, 0];
    }

    // vento, trânsito distante, ventilação do túnel, murmúrio da arquibancada...
    ambience(inside) {
      const [gl, gb, hz, gh] = this.ambSpec, rng = this.rng, a = this.amb;
      this.ambMod += (rng.bi() * 0.5 - this.ambMod) * 0.00002;
      const gust = 0.7 + 0.6 * Math.abs(this.ambMod) * 4;
      let l = a[0].run(rng.bi()) * gl * gust + a[2].run(rng.bi()) * gb;
      let r = a[1].run(rng.bi()) * gl * gust + a[3].run(rng.bi()) * gb;
      if (gh) {
        this.phH += TAU * hz * this.dt; if (this.phH > TAU) this.phH -= TAU;
        const h = (Math.sin(this.phH) + 0.4 * Math.sin(2 * this.phH)) * gh;
        l += h; r += h;
      }
      const g = 1 - 0.75 * inside;
      this.ambL = l * g; this.ambR = r * g;
    }

    telemetry() {
      return {
        type: 'telemetry', rpm: this.rpmAvg, theta: this.theta, kmh: this.v * 3.6, gear: this.gear,
        gears: this.ratios.length - 1, auto: this.auto,
        boost: this.boost, thr: this.thr, map: this.pMan / P0, limiter: this.limiter, state: this.state,
        torque: Math.max(0, this.tqMean), turbo: this.blower ? this.boost / Math.max(0.2, this.maxBoost) : this.turboW, denied: (this.denied || 0) > 0,
        valve: this.valveState.v, launch: this.launching && (this.twoStepMode === 'cut' ? this.limiter : this.rpmAvg > this.launchRpm * 0.92), launchSoft: this.twoStepMode === 'soft',
        coolant: this.coolant, fan: this.fanOn, secAir: this.secAir > 0.5, idleTarget: this.idleTarget,
        carX: this.carX, dist: this.rDist, vRad: this.vRad, loop: ENV_LOOP[this.params.env] || 800,
      };
    }
  }

  return { EngineDSP, gearRatios, defaultFinal };
}

if (typeof module !== 'undefined' && module.exports) module.exports = EngineDSPFactory;
