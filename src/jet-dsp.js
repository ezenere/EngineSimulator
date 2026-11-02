// Síntese física do som de motores a jato.
//
// Cada fonte de ruído de um motor real é gerada à parte, com a lei de escala, o
// espectro e a diretividade medidos em bancos de prova:
//  1. Fan: tons de passagem de pá (BPF) da interação rotor-estator. Eles só saem do
//     duto se o modo girante estiver acima do corte (regra de Tyler-Sofrin): com
//     palhetas ≥ 2× pás e ponta subsônica, o BPF morre dentro do duto.
//  2. Ponta supersônica: cada pá carrega uma onda de choque. Pás nunca são idênticas,
//     então os choques ficam desiguais e espalham energia por todas as ordens do
//     eixo: o "buzz-saw" (tons múltiplos puros) que se ouve na frente na decolagem.
//  3. Compressor, turbina e caixa de acessórios: tons agudos, espalhados pelo fan.
//  4. Jato: ruído de mistura turbulenta (Lighthill, potência ~V⁸). Estruturas grandes
//     irradiam para trás com pico em Strouhal ~0,2; as pequenas, largas, para o lado.
//  5. Jato supersônico: células de choque (ruído de choque e screech) e o "crackle".
//  6. Combustão e pós-combustão: ronco grave do núcleo.
//  7. Hélice (turboélice): harmônicos que enriquecem com o Mach na ponta da pá.
//  8. Propagação: diretividade de cada fonte, distância, absorção do ar, reflexão no
//     chão, Doppler e amplificação convectiva na passagem, fuselagem para quem está a bordo.
//
// As fontes são calculadas em Pa a 30 m e somadas em barramentos "frente" (entrada
// de ar, hélice) e "trás" (jato, núcleo) de cada lado da aeronave, que é o que dá
// largura estéreo e o vai-e-vem frente/trás quando a posição do ouvinte muda.

function JetDSPFactory() {
  const TAU = Math.PI * 2;
  const C0 = 340;          // som no ar (m/s)
  const PREF = 2e-5;       // 0 dB SPL
  const R_REF = 30;        // distância em que as fontes são definidas
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const db = (x) => Math.pow(10, x / 20);

  const TN = 8192, TM = TN - 1;
  const SIN = new Float32Array(TN);
  for (let i = 0; i < TN; i++) SIN[i] = Math.sin((TAU * i) / TN);
  const sinr = (rev) => SIN[((rev * TN) | 0) & TM]; // seno de uma fase em revoluções (≥ 0)

  class RNG {
    constructor(seed) { this.s = seed >>> 0 || 0x9e3779b9; }
    next() { let x = this.s; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.s = x >>> 0; return this.s * 2.3283064365386963e-10; }
    bi() { return this.next() * 2 - 1; }
  }

  class Biquad {
    constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0; }
    _set(b0, b1, b2, a0, a1, a2) { this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0; return this; }
    _w(fs, f, q) { const w = TAU * clamp(f, 5, fs * 0.45) / fs; return [Math.cos(w), Math.sin(w) / (2 * q)]; }
    lp(fs, f, q = 0.707) { const [c, al] = this._w(fs, f, q); return this._set((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al); }
    hp(fs, f, q = 0.707) { const [c, al] = this._w(fs, f, q); return this._set((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al); }
    bp(fs, f, q) { const [c, al] = this._w(fs, f, q); return this._set(al, 0, -al, 1 + al, -2 * c, 1 - al); }
    peak(fs, f, q, g) { const A = Math.pow(10, g / 40); const [c, al] = this._w(fs, f, q); return this._set(1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A); }
    run(x) { const y = this.b0 * x + this.z1; this.z1 = this.b1 * x - this.a1 * y + this.z2; this.z2 = this.b2 * x - this.a2 * y; return y; }
  }
  const onePole = (fs, f) => 1 - Math.exp(-TAU * f / fs);

  // Diretividade (dB) a 0°, 30°, ... 180° do eixo da entrada de ar (0° = de frente para o motor).
  const DIR = {
    inlet: [-6, -2, 0, -3, -10, -20, -26],
    fanAft: [-22, -16, -9, -3, 0, -2, -8],
    jetL: [-24, -22, -18, -14, -8, 0, -6],
    jetF: [-8, -5, -3, -1, 0, -2, -6],
    core: [-16, -14, -10, -5, -1, 0, -5],
    shock: [-6, -2, 0, -2, -5, -9, -14],
    crackle: [-26, -24, -20, -14, -5, 0, -4],
    prop: [-18, -8, -3, 0, -1, -6, -18],
    rev: [-4, 0, -1, -3, -6, -9, -12],
  };
  const dir = (tab, th) => { const x = clamp(th / 30, 0, 5.999), i = x | 0; return db(tab[i] + (tab[i + 1] - tab[i]) * (x - i)); };

  // Volta (m) da passagem em cada ambiente e altura do motor sobre o chão.
  const PASS_LOOP = 6000;

  class JetDSP {
    constructor(fs) {
      this.fs = fs;
      this.rng = new RNG(0x7e7a11);
      this.params = { listener: 'ground', env: 'runway', angle: 90, dist: 40, seat: 'wing', alt: 150, speed: 300, fan: 1, core: 1, jet: 1, master: 0.8 };
      this.tla = 0; this.revCmd = 0; this.state = 'off';
      this.post = null; this.telem = 0; this.ctrl = 0;
      this.cfgGain = 1; this.mk = 1; this.fade = 1; this.lvl = 0; this.splAcc = 0; this.splN = 0; this.spl = 0;
      this.flyX = -PASS_LOOP / 2; this.vFly = 0; this.ab = 0; this.abWhump = 0; this.rev = 0; this.lvl2 = 0; this.clickE = 0; this.ignT = 0; this.boomT = -1; this.boomAge = 99; this.starterW = 0; this.starterAir = 0; this.fuelOn = false; this.boomDb = 0; this.inCone = false;
      this.ambL = 0; this.ambR = 0;
      this.ambF = [new Biquad(), new Biquad(), new Biquad(), new Biquad()];
      this.gust = 0; this.ambPh = 0;
      this.sendL = 0; this.sendR = 0;
    }

    message(m) {
      if (m.type === 'config') this.setConfig(m.cfg);
      else if (m.type === 'tune') { if (this.cfg) this.tune(m.cfg); }
      else if (m.type === 'params') Object.assign(this.params, m.params);
      else if (m.type === 'input') {
        if (m.tla !== undefined) this.tla = clamp(m.tla, 0, 1.3);
        if (m.reverser !== undefined) this.revCmd = m.reverser ? 1 : 0;
        if (m.start !== undefined) this.setRunning(m.start);
      }
    }

    setRunning(on) {
      if (on && (this.state === 'off' || this.state === 'stop')) { this.state = 'start'; this.startT = 0; this.fuelOn = this.lit = false; }
      if (!on && this.state !== 'off') this.state = 'stop';
    }

    setConfig(cfg, calibrate = true) {
      this.cfg = cfg;
      const fs = this.fs, E = clamp(cfg.engines | 0, 1, 4);
      this.E = E;
      this.prop = cfg.arch === 'turboprop';
      // posição de cada motor: x para frente, y para a esquerda, z para cima (m)
      const s = cfg.span || 0;
      const ys = cfg.mount === 'rear' || cfg.mount === 'fuselage' || cfg.mount === 'nose'
        ? { 1: [0], 2: [s || 0.7, -(s || 0.7)], 3: [s, 0, -s], 4: [s, s * 0.5, -s * 0.5, -s] }[E]
        : { 1: [0], 2: [s, -s], 3: [s, 0, -s], 4: [s, s * 0.55, -s * 0.55, -s] }[E];
      const zE = { wing: this.prop ? 3.2 : 2.6, rear: 3.4, fuselage: 2.1, nose: 2.2 }[cfg.mount] || 2.6;
      const xE = { rear: -9, nose: 4.5 }[cfg.mount] || 0;
      this.ex = new Float64Array(E).fill(xE);
      this.ey = Float64Array.from(ys);
      this.ez = new Float64Array(E).fill(zE);
      if (E === 3) { this.ex[1] = xE - 14; this.ez[1] = zE + 3; } // o do meio fica na cauda
      // até dois grupos (lado esquerdo/direito), cada um com ruído largo próprio
      this.G = E === 1 ? 1 : 2;
      this.grp = Int8Array.from(this.ey, (y) => (this.G === 1 || y >= 0 ? 0 : 1));
      this.gN = [0, 0]; for (let e = 0; e < E; e++) this.gN[this.grp[e]]++;
      // cada motor tem pás ligeiramente diferentes: posição e força de cada choque
      this.buildRotorTables(cfg);
      // estado de rotação
      this.n2 = this.n2 || 0; this.u = 0; this.n1 = new Float64Array(E); this.np = this.np || 0;
      this.phF = new Float64Array(E); this.phH = new Float64Array(E); this.phI = new Float64Array(E); this.phP = new Float64Array(E); this.phS = 0;
      this.hay = new Float64Array(E); this.hay2 = new Float64Array(E);
      const tr = new RNG(0x51ed + E * 31);
      this.trim1 = Float64Array.from({ length: E }, (_, e) => (e ? 1 + 0.0035 * tr.bi() : 1));
      this.trim2 = Float64Array.from({ length: E }, (_, e) => (e ? 1 + 0.003 * tr.bi() : 1));
      this.trimP = Float64Array.from({ length: E }, (_, e) => (e ? 1 + 0.004 * tr.bi() : 1));
      for (let e = 0; e < E; e++) { this.phF[e] = tr.next(); this.phH[e] = tr.next(); this.phP[e] = tr.next(); }
      // ruído largo e barramentos
      const mk = () => ({
        fan: [new Biquad(), new Biquad()], jcL: [new Biquad(), new Biquad()], jcF: [new Biquad(), new Biquad()],
        jbL: [new Biquad(), new Biquad()], jbF: [new Biquad(), new Biquad()], comb: [new Biquad(), new Biquad()], shock: [new Biquad(), new Biquad()],
        crk: new Biquad(), ab: [new Biquad(), new Biquad()], rev: new Biquad(), pbb: new Biquad(),
        am: 0, crkE: 0, crkS: 0, scrPh: 0, scrA: 0,
      });
      this.gs = [mk(), mk()];
      this.buses = [];
      for (let b = 0; b < 2 * this.G; b++) {
        // 4 caminhos por barramento: [direto a, direto b, chão a, chão b]. Acima do som
        // existem duas soluções para o tempo de emissão (a = emitido chegando, b = indo).
        this.buses.push({ buf: new Float32Array(1 << 19), w: 0, d0: new Float64Array(4), d1: new Float64Array(4), g0: new Float64Array(4), g1: new Float64Array(4),
          rf: new Float64Array(4), lpk: 0.5, tlpk: 0.5, s1: 0, s2: 0, pL: 0.7, pR: 0.7, tpL: 0.7, tpR: 0.7, snd: 0, tsnd: 0 });
      }
      this.busIn = new Float64Array(4);
      // fuselagem: lei da massa (perda cresce com a frequência) + ressonância dos painéis
      this.cab = [0, 1].flatMap(() => [new Biquad().lp(fs, 380, 0.7), new Biquad().lp(fs, 900, 0.6), new Biquad().peak(fs, 110, 1, 5)]);
      this.clickF = new Biquad().bp(fs, 3200, 1.2);
      this.startAirF = new Biquad().hp(fs, 1800, 0.7);
      this.cabHiss = [new Biquad().lp(fs, 1800, 0.6), new Biquad().hp(fs, 180, 0.6)];
      this.fanTabMix = 0;
      this.propTab = new Float32Array(1024); this.propTabB = new Float32Array(1024); this.propBuild = 0;
      this.tune(cfg);
      this.cfgGain = cfg.gain || (calibrate ? this.calibrate(cfg) : 1);
      this.geom(true);
      this.fade = 0;
    }

    // Tabelas de uma volta do fan com o trem de choques irregular de cada motor.
    // A série de Fourier de choques desiguais tem energia em todas as ordens do eixo;
    // a versão "evoluída" imita a propagação não linear no duto, em que choques fortes
    // engolem os fracos e a energia escorre do BPF para as ordens baixas.
    buildRotorTables(cfg) {
      const E = this.E, B = Math.max(2, cfg.fanB | 0), N = 4096, K = Math.min(3 * B, 400);
      this.rotLo = []; this.rotHi = [];
      for (let e = 0; e < E; e++) {
        const r = new RNG(0xb1ade + e * 977 + B * 13);
        const re = new Float64Array(K + 1), im = new Float64Array(K + 1);
        for (let j = 0; j < B; j++) {
          const pos = (j + 0.07 * r.bi()) / B, a = 1 + 0.04 * r.bi();
          for (let k = 1; k <= K; k++) { const ph = TAU * k * pos; re[k] += a * Math.cos(ph); im[k] -= a * Math.sin(ph); }
        }
        const lo = new Float32Array(N + 1), hi = new Float32Array(N + 1);
        for (let k = 1; k <= K; k++) {
          const mag = Math.hypot(re[k], im[k]) / (TAU * k), ph = Math.atan2(im[k], re[k]);
          const x = k / B;
          const wLo = Math.exp(-0.5 * (x - 1) * (x - 1) / 0.6) * 0.7 + 0.3;  // perto da pá: ainda é BPF
          const wHi = (x < 1 ? 0.25 + 1.3 * Math.exp(-((x - 0.42) * (x - 0.42)) / 0.08) : 0.5 / Math.pow(x, 1.5)) * (Math.abs(x - Math.round(x)) < 1e-6 ? 0.5 : 1); // longe: corcova nas ordens médias
          for (let i = 0; i < N; i++) {
            const v = mag * Math.cos((TAU * k * i) / N + ph);
            lo[i] += v * wLo; hi[i] += v * wHi;
          }
        }
        let mL = 0, mH = 0;
        for (let i = 0; i < N; i++) { mL += lo[i] * lo[i]; mH += hi[i] * hi[i]; }
        const nL = 1 / Math.sqrt(mL / N + 1e-12), nH = 1 / Math.sqrt(mH / N + 1e-12);
        for (let i = 0; i < N; i++) { lo[i] *= nL; hi[i] *= nH; }
        lo[N] = lo[0]; hi[N] = hi[0];
        this.rotLo.push(lo); this.rotHi.push(hi);
      }
    }

    tune(cfg) {
      this.cfg = { ...this.cfg, ...cfg };
      const c = this.cfg;
      this.B = Math.max(2, c.fanB | 0); this.V = Math.max(1, c.vanes | 0);
      this.D = c.fanD; this.n1Hz = c.n1Max / 60; this.n2Hz = c.n2Max / 60;
      this.hpcB = c.hpcB; this.lptB = c.lptB; this.gearR = c.arch === 'geared' ? c.gear || 3 : 1;
      this.bpr = c.arch === 'turbojet' || this.prop ? 0 : c.bpr;
      this.Vj = c.jetV; this.Dj = c.nozD;
      this.Vb = this.bpr > 0.2 ? clamp(c.jetV * (0.92 - 0.028 * this.bpr), 140, c.jetV) : 0;
      this.Db = this.bpr > 0.2 ? c.nozD * Math.sqrt(1 + this.bpr) * 0.85 : 0;
      this.n1i = c.n1Idle; this.n2i = c.n2Idle; this.T = c.spoolTime;
      this.abOn = !!c.ab && !this.prop;
      this.cd = c.nozzle === 'cd';
      this.sup = c.suppressor || 'none';
      this.liner = c.liners ? 1 : 0;
      this.sync = !!c.sync;
      this.thrust100 = c.thrust;
      this.propHz = (c.propRpm || 0) / 60; this.propB = c.propB || 4; this.propD = c.propD || 2.5;
    }

    // Normaliza o volume em potência máxima com o ouvinte na referência (90°, 40 m).
    calibrate(cfg) {
      const t = new JetDSP(this.fs);
      t.setConfig(cfg, false);
      t.state = 'run'; t.lit = true; t.u = 1; t.n2 = 1; t.tla = 1; t.np = 1; t.ctrlLock = true;
      t.params = { ...t.params, listener: 'ground', angle: 90, dist: 40, master: 1 };
      t.geom(true);
      const B = 256, L = new Float32Array(B), R = new Float32Array(B);
      for (let i = 0; i < 0.6 * this.fs; i += B) t.process(L, R, B);
      const pa = t.spl;
      return clamp(0.22 / Math.max(1e-3, Math.pow(10, pa / 20) * PREF), 1e-5, 10);
    }

    // ---------------------------------------------------------------- dinâmica
    control(dtc) {
      const st = this.state;
      // rotação do gerador de gás (u = 0 na marcha lenta, 1 em 100%)
      // Partida (comprimida para ~20 s; num avião real leva 40 a 60 s):
      //  1. o ar de sangria gira o motor de partida, que arrasta N2 até uns 25%;
      //  2. perto de 20% a FADEC abre o combustível e liga os ignitores;
      //  3. a chama pega 1,5 a 3 s depois, sem explosão: a EGT sobe e o ronco cresce;
      //  4. motor e motor de partida aceleram juntos até ~50%, quando ele desacopla.
      const engaged = st === 'start' && this.n2 < 0.5;
      if (engaged) this.starterW = this.n2;
      else this.starterW *= Math.exp(-dtc / 2.5); // o motor de partida desacoplado vai parando
      this.starterAir += ((engaged ? 1 : 0) - this.starterAir) * (1 - Math.exp(-dtc / (engaged ? 0.4 : 0.8)));
      if (st === 'start') {
        this.startT += dtc;
        let acc = engaged ? (0.27 - this.n2) * 0.22 : 0;
        if (!this.fuelOn && this.n2 > 0.2) { this.fuelOn = true; this.fuelT = 0; this.lightDelay = 1.5 + 1.5 * this.rng.next(); }
        if (this.fuelOn) {
          this.fuelT += dtc;
          if (!this.lit && this.fuelT > this.lightDelay) { this.lit = true; this.lightT = 0; }
        }
        // com chama: o motor de partida ainda ajuda (torque caindo até ~55%) e a turbina assume
        if (this.lit) acc = (engaged ? Math.max(0, 0.55 - this.n2) * 0.06 : 0) + (0.02 + 0.06 * smooth(0.25, 0.5, this.n2)) * smooth(0, 2.5, this.lightT);
        this.n2 = Math.min(this.n2i, this.n2 + acc * dtc);
        if (this.n2 >= this.n2i - 0.002) { this.state = 'run'; this.u = 0; }
      } else if (st === 'stop' || st === 'off') {
        this.lit = false; this.fuelOn = false;
        this.n2 = Math.max(0, this.n2 - dtc * (0.012 + this.n2 * 0.09));
        if (this.n2 < 0.004) { this.n2 = 0; this.state = 'off'; }
        this.u = 0;
      } else if (st === 'run' && !this.ctrlLock) {
        const dry = clamp(this.tla, 0, 1);
        const target = Math.pow(dry, 1.1);
        // aceleração limitada pela FADEC: lenta perto da marcha lenta, rápida no meio
        const up = (0.24 + 2.4 * this.u) / this.T, down = (0.5 + 2.2 * this.u) / this.T;
        const du = clamp((target - this.u) * 5 / this.T, -down, up);
        this.u = clamp(this.u + du * dtc, 0, 1.02);
        this.n2 = this.n2i + (1 - this.n2i) * this.u;
      }
      if (this.lit) this.lightT = (this.lightT || 0) + dtc;
      // ignitores estalando durante a partida (~1 por segundo)
      if (st === 'start' && this.fuelOn && this.n2 < 0.5) { this.ignT -= dtc; if (this.ignT <= 0) { this.ignT = 0.9; this.clickE = 1; } }
      // compensação lenta de volume
      const lv = Math.sqrt(this.lvl2), want = clamp(Math.pow((0.22 / this.cfgGain) / Math.max(1e-5, lv), 0.45), 0.2, 6);
      this.mk += (want - this.mk) * (1 - Math.exp(-dtc / 2.5));
      const n2 = this.n2;
      // fan (N1) segue o gerador de gás
      const n1 = st === 'run' ? this.n1i + (1 - this.n1i) * Math.pow(this.u, 1.35) : this.n1i * Math.pow(n2 / this.n2i, 2);
      for (let e = 0; e < this.E; e++) this.n1[e] = n1 * (this.sync ? 1 : this.trim1[e]);
      // hélice: governador mantém a rotação; a potência muda o passo (carga)
      if (this.prop) {
        const npT = this.lit ? (0.74 + 0.26 * smooth(0.05, 0.55, this.tla)) * smooth(0.3, 0.5, n2) : 0;
        const k = npT > this.np ? 0.6 : 0.12;
        this.np += (npT - this.np) * (1 - Math.exp(-dtc * k));
      }
      // pós-combustão
      const abT = this.abOn && st === 'run' && this.tla > 1.001 && this.u > 0.9 ? clamp((this.tla - 1) / 0.3, 0.2, 1) : 0;
      if (abT > 0 && !(this.ab > 0.05)) this.abWhump = 1;
      this.ab = (this.ab || 0) + (abT - (this.ab || 0)) * (1 - Math.exp(-dtc / (abT > this.ab ? 0.35 : 0.2)));
      this.abWhump = (this.abWhump || 0) * Math.exp(-dtc / 0.25);
      // reversor
      const revT = this.revCmd && st === 'run' ? 1 : 0;
      this.rev = (this.rev || 0) + clamp(revT - (this.rev || 0), -dtc / 1.2, dtc / 1.5);
      // passagem: avião voando em linha reta sobre o observador
      const P = this.params;
      this.vFly = P.listener === 'flyby' ? P.speed / 3.6 : 0;
      this.boomAge += dtc;
      if (P.listener === 'flyby') { this.flyX += this.vFly * dtc; if (this.flyX > PASS_LOOP / 2) this.flyX -= PASS_LOOP; }
      this.geom(false);
      this.sources(dtc);
    }

    // Geometria ouvinte × motores: ângulo e distância de cada barramento.
    geom(snap) {
      const P = this.params, E = this.E, c = this.cfg;
      let O, face, refl = true, cabin = 0;
      const e0 = 0;
      if (P.listener === 'ground') {
        const th = (P.angle * Math.PI) / 180, r = Math.max(3, P.dist);
        O = [this.ex[e0] + r * Math.cos(th), this.ey[e0] + r * Math.sin(th), 1.7];
        face = [this.ex[e0] - O[0], this.ey[e0] - O[1], 0];
      } else if (P.listener === 'flyby') {
        const h = Math.max(15, P.alt);
        O = [-this.flyX, 0, 1.7 - h]; // referencial da aeronave: o observador passa por baixo
        face = [0, -1, 0];
        for (let e = 0; e < E; e++) this.ez[e] = 0;
      } else {
        refl = false;
        const cx = c.cockpitX || 12;
        if (P.listener === 'cockpit') { O = [cx, 0.4, 2.6]; cabin = 2; }
        else if (P.listener === 'wingcam') { O = [this.ex[0] - 4, Math.max(1.9, this.ey[0] - 2.5), this.ez[0] + 0.6]; cabin = 0; }
        else {
          const x = { fwd: cx * 0.55, wing: this.ex[0] * 0.3, aft: -cx * 0.65 }[P.seat] ?? 0;
          O = [x, 1.8, 2.8]; cabin = 1;
        }
        face = [1, 0, 0];
      }
      if (P.listener !== 'flyby') { const zE = this.cfg.mount === 'rear' ? 3.4 : this.cfg.mount === 'fuselage' ? 2.1 : this.prop ? 3.2 : 2.6; for (let e = 0; e < E; e++) this.ez[e] = this.E === 3 && e === 1 ? zE + 3 : zE; }
      this.cabin = cabin;
      const fl = Math.hypot(face[0], face[1]) || 1, rx = face[1] / fl, ry = -face[0] / fl;
      // por motor: distância e ângulo a partir do eixo da entrada de ar
      this.th = this.th || new Float64Array(4); this.re = this.re || new Float64Array(4);
      for (let e = 0; e < E; e++) {
        const dx = O[0] - this.ex[e], dy = O[1] - this.ey[e], dz = O[2] - this.ez[e];
        const r = Math.max(1, Math.hypot(dx, dy, dz));
        this.re[e] = r; this.th[e] = (Math.acos(clamp(dx / r, -1, 1)) * 180) / Math.PI;
      }
      // barramentos: frente (entrada de ar) e trás (jato) de cada grupo
      const jetOff = 3 + 4 * (this.Dj || 0.6);
      const fs = this.fs, v = this.vFly, M = v / C0, fly = P.listener === 'flyby';
      const maxD = (this.buses[0]?.buf.length || 1 << 19) - 256;
      this.gTh = [0, 0]; this.gR = [1, 1];
      const h = Math.max(15, P.alt);
      let boomNow = false;
      for (let g = 0; g < this.G; g++) {
        let x = 0, y = 0, z = 0, n = 0;
        for (let e = 0; e < E; e++) if (this.grp[e] === g) { x += this.ex[e]; y += this.ey[e]; z += this.ez[e]; n++; }
        x /= n; y /= n; z /= n;
        for (let k = 0; k < 2; k++) {
          const bx = k === 0 ? x + 1.5 : x - jetOff;
          const dx = O[0] - bx, dy = O[1] - y, dz = O[2] - z;
          const r1 = Math.max(1, Math.hypot(dx, dy, dz));
          const bus = this.buses[g * 2 + k];
          if (k === 0) { this.gR[g] = r1; this.gTh[g] = (Math.acos(clamp(dx / r1, -1, 1)) * 180) / Math.PI; }
          const tD = [0, 0, 0, 0], tG = [0, 0, 0, 0];
          let rNear = r1, panX = -dx, panY = -dy, panZ = -dz;
          if (fly) {
            // tempo de emissão exato: c·s = |posição da fonte em (t − s) − observador|
            // (c² − v²)s² + 2·A·v·s − (A² + Q) = 0, A = posição atual ao longo da rota
            const A = this.flyX + bx;
            for (let path = 0; path < 2; path++) {
              const Q = y * y + (path === 0 ? (h - 1.7) * (h - 1.7) : (h + 1.7) * (h + 1.7));
              const a = C0 * C0 - v * v, b = 2 * A * v, cq = -(A * A + Q);
              const roots = [];
              if (Math.abs(a) < 1e-3) { if (b > 0) roots.push(-cq / b); }
              else {
                const disc = b * b - 4 * a * cq;
                if (disc >= 0) {
                  const sq = Math.sqrt(disc);
                  for (const sr of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) if (sr > 0) roots.push(sr);
                }
                if (path === 0 && g === 0 && k === 0 && M > 1) boomNow = disc >= 0 && A > 0;
              }
              roots.sort((p1, p2) => p2 - p1); // maior atraso primeiro (emitido chegando)
              const slots = roots.length === 2 ? [0, 1] : [1];
              roots.forEach((sr, j) => {
                const re = C0 * sr, Xe = A - v * sr;
                if (sr * fs > maxD || re < 1) return;
                const cth = -Xe / re; // >0: emitido com o ouvinte à frente
                const th = (Math.acos(clamp(cth, -1, 1)) * 180) / Math.PI;
                // amplificação de fonte em movimento; na cáustica (cone de Mach) é limitada
                const dop = Math.min(4, Math.pow(Math.max(0.05, Math.abs(1 - M * cth)), -1.4));
                const dg = k === 0 ? (this.prop ? dir(DIR.prop, th) : dir(DIR.inlet, th)) : Math.max(dir(DIR.jetL, th), 0.55 * dir(DIR.jetF, th), 0.5 * dir(DIR.shock, th));
                const slot = slots[j] + path * 2;
                tD[slot] = sr * fs; tG[slot] = (path ? 0.8 : 1) * Math.min(4, R_REF / re) * dop * dg;
                if (path === 0 && re < rNear + 1e9 && j === roots.length - 1) { rNear = re; panX = Xe; panY = -y; panZ = h; }
              });
            }
          } else {
            const r2 = refl ? Math.hypot(dx, dy, O[2] + z) : r1;
            tD[1] = cabin ? 0.002 * fs : (r1 / C0) * fs; tG[1] = Math.min(4, R_REF / r1);
            if (refl) { tD[3] = (r2 / C0) * fs; tG[3] = 0.8 * Math.min(4, R_REF / r2); }
          }
          // rampa linear até o próximo tique; fora da passagem o atraso muda devagar (sem estalos ao arrastar)
          for (let t = 0; t < 4; t++) {
            const had = bus.g1[t] > 0;
            bus.d0[t] = bus.d1[t]; bus.g0[t] = bus.g1[t];
            if (tG[t] > 0) {
              if (!had || snap) { bus.d0[t] = tD[t]; if (snap) bus.g0[t] = tG[t]; }
              bus.d1[t] = fly || snap ? tD[t] : bus.d0[t] + clamp(tD[t] - bus.d0[t], -32, 32);
            }
            bus.g1[t] = tG[t];
          }
          // absorção do ar: corta agudos cada vez mais com a distância
          const fc = clamp(14000 * Math.pow(60 / (rNear + 60), 0.85), 900, 14000);
          bus.tlpk = onePole(fs, fc);
          // posição estéreo e quanto vai para a acústica do ambiente
          const hl = Math.hypot(panX, panY, panZ) || 1;
          const pan = cabin ? clamp((y - O[1]) * -0.12, -0.8, 0.8) : fly ? clamp(-panX / hl, -1, 1) : clamp(-(panX * rx + panY * ry) / hl, -1, 1);
          const a = ((pan + 1) * Math.PI) / 4;
          bus.tpL = Math.cos(a); bus.tpR = Math.sin(a);
          bus.tsnd = cabin ? 0.25 : clamp(Math.sqrt(R_REF / rNear), 0.35, 1.6);
          if (snap) { bus.lpk = bus.tlpk; bus.pL = bus.tpL; bus.pR = bus.tpR; bus.snd = bus.tsnd; }
        }
      }
      // estrondo sônico: o cone de Mach acabou de alcançar o observador
      if (fly && boomNow && !this.inCone && !snap) this.triggerBoom(M, h);
      this.inCone = fly && boomNow;
      this.O = O;
    }

    // Amplitudes (Pa a 30 m) e frequências de cada fonte para o próximo trecho.
    sources(dtc) {
      const fs = this.fs, P = this.params, E = this.E, lit = this.lit, n2 = this.n2, u = this.u;
      const run = this.state === 'run';
      const n1 = this.n1[0];
      // fan: Mach relativo na ponta (rotação + escoamento axial)
      const Ut = Math.PI * this.D * n1 * this.n1Hz;
      const Ma = clamp(0.5 * n1 + this.vFly / C0 * 0.6, 0, 0.75);
      const Mt = Math.hypot(Ut / C0, Ma);
      this.Mt = Mt; this.Ma = Ma;
      const fanScale = (this.D / 1.5) * (1 - 0.6 * this.liner) * P.fan;
      // tons de interação: harmônico h corta ou propaga conforme o modo de Tyler-Sofrin
      const B = this.B, V = this.V, beta = Math.sqrt(1 - Ma * Ma);
      this.cut = this.cut || new Float64Array(5);
      for (let h = 1; h <= 4; h++) {
        let m = Infinity;
        for (let k = -6; k <= 6; k++) { const mm = Math.abs(h * B - k * V); if (mm < m) m = mm; }
        const zeta = m === 0 ? 9 : ((h * B) / m) * (Ut / C0) / beta;
        this.cut[h] = zeta >= 1 ? 1 : Math.exp(-7 * Math.sqrt(1 - zeta * zeta));
      }
      const load = Math.pow(n1, 3);
      this.aInt = this.prop ? 0 : 7 * load * fanScale * (this.vFly > 30 ? 0.6 : 1);
      // choques na ponta: só existem com ponta supersônica
      const shock = smooth(0.97, 1.12, Mt) * Math.pow(Math.max(0, Mt - 0.95), 0.7);
      this.aBuzz = this.prop ? 0 : 32 * shock * fanScale;
      this.buzzMix = smooth(1.05, 1.45, Mt);
      this.aFanBB = this.prop ? 0 : 1.6 * Math.pow(Mt, 4) * fanScale;
      // compressor e turbina
      const hpcScale = (0.3 + 0.7 * this.D / 1.5) * (1 - 0.5 * this.liner) * P.core;
      this.aHpc = (lit || n2 > 0.05 ? 3.0 * Math.pow(n2, 3) : 0) * hpcScale;
      this.aLpt = 1.5 * Math.pow(n1, 2.2) * hpcScale;
      // assobio do motor de partida (segue a rotação dele) e chiado do ar de sangria entrando
      this.aStarter = 0.45 * smooth(0, 0.12, this.starterW) * P.core;
      this.aStartAir = 0.12 * this.starterAir * P.core;
      // a chama cresce aos poucos depois de pegar (na partida); em regime ela já está toda lá
      const litR = lit ? (this.state === 'start' ? smooth(0, 3, this.lightT || 0) : 1) : 0;
      this.litR = litR;
      // combustão
      // w: quanto o motor já chegou na marcha lenta (partida); u: lenta → máxima
      const w = Math.pow(clamp(n2 / this.n2i, 0, 1), 3);
      const ff = (0.18 * w + 0.82 * Math.pow(u, 1.5)) * litR;
      this.ff = ff;
      // acendimento: um "vum" grave e curto, bem mais fraco que o motor em marcha lenta
      const lt = this.lightT || 0;
      const whoomp = this.state === 'start' && lit ? 0.35 * Math.exp(-((lt - 0.7) * (lt - 0.7)) / 0.25) : 0;
      this.aComb = (0.9 * ff + 1.2 * this.ab + whoomp) * (this.Dj / 0.8) * P.core;
      // jatos: velocidade relativa ao ar (em voo o jato "empurra menos" o ar parado)
      const sup = this.sup;
      const Vc0 = this.Vj * (0.05 * n2 + litR * (0.32 * w + 0.68 * Math.pow(u, 1.2) - 0.05 * n2));
      const Vc = Vc0 * (1 + 0.42 * this.ab);
      const Vb = this.Vb * n1;
      const vf = this.vFly * 0.75;
      const lh = (V) => { const x = Math.max(0, V) / 300; return (x * x * x * x) / (1 + Math.pow(x / 2, 2.5)); };
      const supL = sup === 'chevrons' ? 0.72 : sup === 'hushkit' ? 0.5 : 1, supF = sup === 'chevrons' ? 1.12 : sup === 'hushkit' ? 0.8 : 1;
      const fShift = sup === 'chevrons' ? 1.25 : sup === 'hushkit' ? 1.5 : 1;
      const VcRel = Math.max(0, Vc - (this.bpr > 0.2 ? 0.55 * Vb : 0) - vf);
      this.aJcL = 9 * lh(VcRel) * this.Dj * supL * P.jet;
      this.aJcF = 3.2 * lh(VcRel) * this.Dj * supF * P.jet;
      // jato anular do bypass: a camada de mistura tem a espessura do anel (Db − Dj)/2, não o diâmetro
      // equivalente. Com o diâmetro cheio o pico caía em ~30 Hz (só tremor); o pico real de um CFM56 fica
      // em algumas centenas de Hz. Divide em estruturas grandes (para trás) e pequenas (para o lado).
      const Hb = Math.max(0.15, 0.5 * (this.Db - this.Dj));
      this.aJbL = this.bpr > 0.2 ? 7 * lh(Vb - vf) * this.Db * supL * P.jet : 0;
      this.aJbF = this.bpr > 0.2 ? 4.5 * lh(Vb - vf) * this.Db * supF * P.jet : 0;
      this.fJbF = this.bpr > 0.2 ? (0.5 * Math.max(30, Vb - vf) / Hb) * fShift : 300;
      this.fJcL = (0.18 * Math.max(40, VcRel) / this.Dj) * fShift;
      this.fJcF = (0.65 * Math.max(40, VcRel) / this.Dj) * fShift;
      this.fJbL = this.bpr > 0.2 ? (0.2 * Math.max(30, Vb - vf) / Math.max(0.3, this.Db - this.Dj)) * fShift : 100;
      // jato supersônico: Mach do jato (som no jato quente), células de choque
      const cj = 560 + 330 * this.ab;
      const Mj = Vc / cj;
      this.Mj = Mj; this.VcOut = Vc;
      const over = Math.max(0, Mj * Mj - 1);
      const shockS = this.cd ? 0.25 * Math.abs(Mj - 1.45 * (0.85 + 0.15 * this.ab)) * smooth(0.95, 1.1, Mj) : Math.sqrt(over);
      const Ls = 1.1 * this.Dj * Math.sqrt(Math.max(0.05, over));
      const uc = 0.7 * Vc;
      this.fShock = clamp(uc / Ls, 150, 8000);
      this.aShock = 5 * shockS * this.Dj * Math.pow(Vc / 600, 2) * P.jet;
      this.fScreech = clamp(uc / (Ls * (1 + uc / C0)), 100, 7000);
      this.aScreech = this.cd ? 0 : 0.35 * this.aShock * smooth(1.05, 1.2, Mj);
      // crackle: jatos quentes com convecção supersônica (pós-combustão)
      const Mc = uc / C0;
      this.crackRate = smooth(1.05, 1.5, Mc) * (900 + 1500 * this.ab);
      this.aCrack = 0.5 * this.aJcL * smooth(1.05, 1.6, Mc);
      this.aAB = 0.45 * this.ab * this.aJcL + this.abWhump * 2.5 * this.Dj * P.jet;
      // reversor: o jato frio é jogado para frente pelas cascatas
      const rv = this.rev || 0;
      this.aRev = rv * 1.4 * (this.aJbL + 0.5 * this.aJcL + 0.6 * this.aFanBB);
      this.revCut = 1 - 0.75 * rv;
      // hélice
      if (this.prop) {
        const tipU = Math.PI * this.propD * this.np * this.propHz;
        const Mh = Math.hypot(tipU, this.vFly) / C0;
        this.Mh = Mh;
        const pload = (0.3 + 0.7 * u) * (1 + 0.8 * rv);
        this.aProp = 9 * Math.pow(Mh / 0.75, 4) * pload * (this.propD / 3.9) * smooth(0.05, 0.3, this.np) * P.fan;
        this.aPbb = 0.55 * Math.pow(Mh / 0.75, 5) * (1 + 2 * rv) * (this.propD / 3.9) * smooth(0.05, 0.3, this.np) * P.fan;
        this.fPbb = 900 + 900 * Mh;
        if (++this.propBuild >= 8) { this.propBuild = 0; this.buildPropTab(Mh, pload); }
      }
      // atualização dos filtros de ruído largo (frequências seguem a rotação)
      const BPF = B * n1 * this.n1Hz;
      for (let g = 0; g < this.G; g++) {
        const s = this.gs[g];
        s.fan[0].bp(fs, clamp(0.8 * BPF, 120, 9000), 0.55); s.fan[1].hp(fs, 90, 0.6);
        s.jcL[0].hp(fs, this.fJcL * 0.45, 0.6); s.jcL[1].lp(fs, this.fJcL * 1.7, 0.6);
        s.jcF[0].hp(fs, this.fJcF * 0.3, 0.55); s.jcF[1].lp(fs, this.fJcF * 2.8, 0.5);
        s.jbL[0].hp(fs, this.fJbL * 0.45, 0.6); s.jbL[1].lp(fs, this.fJbL * 2.2, 0.6);
        s.jbF[0].hp(fs, this.fJbF * 0.3, 0.55); s.jbF[1].lp(fs, this.fJbF * 2.8, 0.5);
        s.comb[0].bp(fs, 420 + 200 * this.ab, 0.7); s.comb[1].bp(fs, 110, 0.9);
        s.shock[0].bp(fs, this.fShock, 1.6); s.shock[1].bp(fs, this.fShock * 2, 3);
        s.ab[0].lp(fs, 260, 0.7); s.ab[1].bp(fs, 85, 1.1);
        s.rev.bp(fs, 900, 0.6); s.crk.hp(fs, 600, 0.7);
        if (this.prop) s.pbb.bp(fs, this.fPbb, 0.7);
      }
      // ruído branco uniforme (rms 0,577) passando num filtro perde energia na proporção
      // da banda: normaliza para que cada amplitude acima seja o rms em Pa
      const nz = (enbw) => 1.732 / Math.sqrt(clamp(enbw, 5, fs / 2) / (fs / 2));
      const lb = (fa, fb) => 1.11 * fb - 0.9 * fa;
      this.nFan = nz(1.57 * clamp(0.8 * BPF, 120, 9000) / 0.55);
      this.nJcL = nz(lb(this.fJcL * 0.45, this.fJcL * 1.7)); this.nJcF = nz(lb(this.fJcF * 0.3, this.fJcF * 2.8));
      this.nJbL = nz(lb(this.fJbL * 0.45, this.fJbL * 2.2)); this.nJbF = nz(lb(this.fJbF * 0.3, this.fJbF * 2.8));
      this.nComb = nz(1.57 * 420 / 0.7) * 0.7; this.nShock = nz(1.57 * this.fShock / 1.6);
      this.nAB = nz(1.57 * 85 / 1.1) * 0.6; this.nRev = nz(1.57 * 900 / 0.6); this.nPbb = nz(1.57 * (this.fPbb || 1000) / 0.7);
      // diretividade de cada fonte para cada grupo e motor
      this.dg = this.dg || [{}, {}];
      const fly = this.params.listener === 'flyby';
      const D1 = fly ? () => 1 : dir;
      for (let g = 0; g < this.G; g++) {
        const th = this.gTh[g], d = this.dg[g];
        d.inlet = D1(DIR.inlet, th); d.fanAft = D1(DIR.fanAft, th); d.jetL = D1(DIR.jetL, th) * this.revCut;
        d.jetF = D1(DIR.jetF, th); d.core = D1(DIR.core, th); d.shock = D1(DIR.shock, th);
        d.crackle = D1(DIR.crackle, th); d.prop = D1(DIR.prop, th); d.rev = D1(DIR.rev, th);
        d.n = Math.sqrt(this.gN[g]);
      }
      this.de = this.de || [];
      for (let e = 0; e < E; e++) {
        const g = this.grp[e], th = this.th[e], rr = clamp(this.gR[g] / this.re[e], 0.2, 3);
        // motor do outro lado da fuselagem fica na sombra dela
        const shade = this.cfg.mount === 'wing' && this.O && Math.sign(this.O[1]) !== Math.sign(this.ey[e]) && Math.abs(this.O[1]) > 2 && this.params.listener !== 'flyby' ? 0.45 : 1;
        this.de[e] = { inlet: D1(DIR.inlet, th) * rr * shade, aft: D1(DIR.fanAft, th) * rr * shade, core: D1(DIR.core, th) * rr * shade, prop: D1(DIR.prop, th) * rr * shade };
      }
    }

    // Uma passagem de pá da hélice: espessura (pulso negativo) + carga (dipolo).
    // Com o Mach na ponta subindo o pulso estreita e os harmônicos se espalham.
    buildPropTab(Mh, load) {
      const N = 1024, tab = this.propTabB;
      const kap = 0.1 + 2.6 * Math.pow(Math.max(0.02, 1 - Mh), 1.3);
      tab.fill(0);
      for (let h = 1; h <= 16; h++) {
        const a = Math.exp(-(h - 1) * kap);
        if (a < 1e-4) break;
        const th = 0.35 * Mh * Mh, ld = load;
        for (let i = 0; i < N; i++) {
          const ph = (h * i) / N;
          tab[i] += a * (ld * sinr(ph) - th * sinr(ph + 0.25));
        }
      }
      let m = 0; for (let i = 0; i < N; i++) m += tab[i] * tab[i];
      const nrm = 1 / Math.sqrt(m / N + 1e-12);
      for (let i = 0; i < N; i++) tab[i] *= nrm;
      const t = this.propTab; this.propTab = tab; this.propTabB = t;
    }

    // ---------------------------------------------------------------- áudio
    process(outL, outR, n, sendL, sendR) {
      if (!this.cfg) { outL.fill(0); outR.fill(0); if (sendL) { sendL.fill(0); sendR.fill(0); } return; }
      const fs = this.fs, dt = 1 / fs, rng = this.rng, P = this.params, E = this.E, G = this.G;
      const n1Hz = this.n1Hz, n2Hz = this.n2Hz, B = this.B, hpcB = this.hpcB, lptB = this.lptB;
      const gs = this.gs, buses = this.buses, nb = buses.length;
      const kHay = onePole(fs, 14), kAm = onePole(fs, 3), kMk = onePole(fs, 0.5), kAmb = onePole(fs, 0.3);
      for (let i = 0; i < n; i++) {
        if (this.ctrl-- <= 0) { this.control(64 * dt); this.ctrl = 63; }
        const bi = this.busIn; bi[0] = bi[1] = bi[2] = bi[3] = 0;
        // ---- tons por motor (cada um com sua rotação: daí o batimento entre motores)
        const fanOn = !this.prop;
        for (let e = 0; e < E; e++) {
          const g = this.grp[e], de = this.de[e];
          const f1 = this.n1[e] * n1Hz, f2 = this.n2 * n2Hz * (this.sync ? 1 : this.trim2[e]);
          let ph = this.phF[e] + f1 * dt; if (ph >= 1) ph -= 1; this.phF[e] = ph;
          let ph2 = this.phH[e] + f2 * dt; if (ph2 >= 1) ph2 -= 1; this.phH[e] = ph2;
          if (this.cfg.spools === 1) { ph2 = (ph * n2Hz / n1Hz) % 1; this.phH[e] = ph2; }
          // turbulência ingerida modula os tons do fan (no chão ela é bem mais forte)
          this.hay[e] += kHay * (rng.bi() * 3 - this.hay[e]);
          this.hay2[e] += kHay * (rng.bi() * 3 - this.hay2[e]);
          let front = 0, rear = 0;
          if (fanOn) {
            const hd = this.vFly > 30 ? 0.25 : 0.7;
            const pB = ph * B;
            const it = this.aInt * (1 + hd * this.hay[e]);
            const tones = it * (this.cut[1] * sinr(pB) + 0.55 * this.cut[2] * sinr(2 * pB + 0.1) + 0.3 * this.cut[3] * sinr(3 * pB + 0.3) + 0.18 * this.cut[4] * sinr(4 * pB + 0.6));
            let buzz = 0;
            if (this.aBuzz > 1e-4) {
              const x = ph * 4096, k = x | 0, f = x - k, lo = this.rotLo[e], hi = this.rotHi[e], w = this.buzzMix;
              const vl = lo[k] + (lo[k + 1] - lo[k]) * f, vh = hi[k] + (hi[k + 1] - hi[k]) * f;
              buzz = this.aBuzz * (vl + (vh - vl) * w) * (1 + 0.2 * hd * this.hay2[e]);
            }
            front += (tones + buzz) * de.inlet;
            rear += tones * 0.8 * de.aft;
            // turbina de baixa (no redutor gira gearR vezes mais rápido que o fan)
            const pl = (ph * this.gearR) % 1;
            rear += this.aLpt * (sinr(pl * lptB) + 0.35 * sinr(2 * pl * lptB + 0.2)) * de.core;
          }
          // compressor de alta, espalhado pelo fan (bandas laterais ± BPF)
          const ph2B = ph2 * hpcB;
          let hpc = sinr(ph2B) + 0.3 * sinr(2 * ph2B + 0.4);
          if (fanOn) hpc += 0.28 * (sinr(ph2B + ph * B) + sinr(ph2B + 10 - ph * B));
          front += this.aHpc * hpc * (1 + 0.3 * this.hay2[e]) * de.inlet;
          if (this.cfg.spools === 3) {
            let phi = this.phI[e] + Math.sqrt(f1 * f2) * dt; if (phi >= 1) phi -= 1; this.phI[e] = phi;
            front += 0.6 * this.aHpc * sinr(phi * Math.round(hpcB * 0.8)) * de.inlet;
          }
          // motor de partida a ar: assobio que sobe junto com N2 até desacoplar
          if (this.aStarter > 1e-4 && e === 0) {
            this.phS += this.starterW * n2Hz * 5.2 * 23 * dt; if (this.phS > 1e4) this.phS -= 1e4;
            front += (this.aStarter * sinr(this.phS) + this.aStartAir * this.startAirF.run(rng.bi()) * 3) * de.inlet;
          }
          // hélice
          if (this.prop) {
            const fp = this.np * this.propHz * (this.sync ? 1 : this.trimP[e]);
            let pp = this.phP[e] + fp * dt; if (pp >= 1) pp -= 1; this.phP[e] = pp;
            const x = ((pp * this.propB) % 1) * 1024, k = x | 0, f = x - k, tb = this.propTab;
            const v = tb[k] + (tb[(k + 1) & 1023] - tb[k]) * f;
            // pás nunca são idênticas: um pouco de 1ª e 2ª ordem do eixo
            const imb = 0.06 * sinr(pp) + 0.04 * sinr(2 * pp + 0.3);
            front += this.aProp * (v + imb) * de.prop;
          }
          bi[g * 2] += front; bi[g * 2 + 1] += rear;
        }
        if (this.clickE > 1e-3) { bi[0] += this.clickF.run(rng.bi() * this.clickE) * 1.5; this.clickE *= 0.993; }
        // ---- ruído largo por grupo
        for (let g = 0; g < G; g++) {
          const s = gs[g], d = this.dg[g], nn = d.n;
          s.am += kAm * (rng.bi() * 2.2 - s.am);
          const am = 1 + 0.28 * s.am;
          let front = 0, rear = 0;
          if (this.aFanBB > 1e-4) {
            const x = s.fan[1].run(s.fan[0].run(rng.bi())) * this.aFanBB * this.nFan;
            front += x * d.inlet; rear += 0.7 * x * d.fanAft;
          }
          const jl = s.jcL[1].run(s.jcL[0].run(rng.bi())) * this.aJcL * this.nJcL * am;
          const jf = s.jcF[1].run(s.jcF[0].run(rng.bi())) * this.aJcF * this.nJcF;
          let jet = jl * d.jetL + jf * d.jetF;
          if (this.aJbL > 1e-4) jet += s.jbL[1].run(s.jbL[0].run(rng.bi())) * this.aJbL * this.nJbL * am * d.jetL + s.jbF[1].run(s.jbF[0].run(rng.bi())) * this.aJbF * this.nJbF * d.jetF;
          rear += jet;
          if (this.aComb > 1e-4) { const nz = rng.bi(); rear += (s.comb[0].run(nz) + s.comb[1].run(nz) * 1.4) * this.aComb * this.nComb * d.core; }
          if (this.aShock > 1e-3) {
            const nz = rng.bi();
            rear += (s.shock[0].run(nz) + 0.5 * s.shock[1].run(nz)) * this.aShock * this.nShock * d.shock;
            if (this.aScreech > 1e-3) {
              s.scrPh += this.fScreech * dt; if (s.scrPh >= 1) s.scrPh -= 1;
              s.scrA = clamp(s.scrA + 0.002 * rng.bi(), 0, 1); // screech de jato quente é intermitente
              rear += this.aScreech * (0.4 + s.scrA) * (sinr(s.scrPh) + 0.4 * sinr(2 * s.scrPh)) * d.shock;
            }
          }
          if (this.crackRate > 1) {
            // crackle: pulsos de compressão íngremes e aleatórios (forma de onda assimétrica)
            if (rng.next() < this.crackRate * dt) s.crkE += (0.3 + Math.pow(rng.next(), 3) * 2.5);
            s.crkS += (s.crkE - s.crkS) * 0.7; s.crkE *= 0.86;
            rear += s.crk.run(s.crkS) * this.aCrack * 3 * d.crackle;
          }
          if (this.aAB > 1e-3) { const nz = rng.bi(); rear += (s.ab[0].run(nz) * 0.5 + s.ab[1].run(nz)) * this.aAB * this.nAB * am * d.core; }
          if (this.aRev > 1e-3) front += s.rev.run(rng.bi()) * this.aRev * this.nRev * d.rev;
          if (this.prop && this.aPbb > 1e-4) front += s.pbb.run(rng.bi()) * this.aPbb * this.nPbb * d.prop;
          bi[g * 2] += front * nn; bi[g * 2 + 1] += rear * nn;
        }
        // ---- propagação de cada barramento até o ouvinte
        let L = 0, R = 0, SL = 0, SR = 0;
        const prog = (63 - this.ctrl) / 64;
        for (let b = 0; b < nb; b++) {
          const bs = buses[b], buf = bs.buf, M = buf.length - 1;
          buf[bs.w] = bi[b];
          bs.lpk += (bs.tlpk - bs.lpk) * 0.001;
          bs.pL += (bs.tpL - bs.pL) * 0.001; bs.pR += (bs.tpR - bs.pR) * 0.001; bs.snd += (bs.tsnd - bs.snd) * 0.001;
          let x = 0;
          for (let t = 0; t < 4; t++) {
            const g0 = bs.g0[t], g1 = bs.g1[t];
            if (g0 <= 0 && g1 <= 0) continue;
            const D = bs.d0[t] + (bs.d1[t] - bs.d0[t]) * prog;
            const p = bs.w - Math.min(D, M - 4), k = Math.floor(p), f = p - k;
            const a = buf[k & M], c = buf[(k + 1) & M];
            let y = (a + (c - a) * f) * (g0 + (g1 - g0) * prog);
            if (t >= 2) { bs.rf[t] += 0.35 * (y - bs.rf[t]); y = bs.rf[t]; } // o chão absorve um pouco dos agudos
            x += y;
          }
          bs.s1 += bs.lpk * (x - bs.s1); bs.s2 += bs.lpk * (bs.s1 - bs.s2);
          bs.w = (bs.w + 1) & M;
          const y = bs.s2;
          L += y * bs.pL; R += y * bs.pR;
          SL += y * bs.pL * bs.snd; SR += y * bs.pR * bs.snd;
        }
        // ---- a bordo: a fuselagem deixa passar quase só o grave
        if (this.cabin) {
          const cb = this.cab;
          const tl = this.cabin === 2 ? 0.06 : 0.12;
          L = cb[2].run(cb[1].run(cb[0].run(L))) * tl; R = cb[5].run(cb[4].run(cb[3].run(R))) * tl;
          SL *= 0.1; SR *= 0.1;
          // ar-condicionado da cabine (em Pa)
          const h = this.cabHiss[1].run(this.cabHiss[0].run(rng.bi())) * (this.cabin === 2 ? 0.05 : 0.035);
          L += h; R += h;
        }
        // nível físico no ouvido (Pa) para o mostrador
        this.splAcc += 0.5 * (L * L + R * R); this.splN++;
        this.lvl2 += (0.5 * (L * L + R * R) - this.lvl2) * kMk;
        if (this.fade < 1) this.fade = Math.min(1, this.fade + dt / 0.05);
        const gOut = P.master * this.cfgGain * this.mk * this.fade;
        this.ambience(rng, kAmb);
        let bm = 0;
        if (this.boomT >= 0) bm = this.boomSample(rng);
        outL[i] = Math.tanh(L * gOut + this.ambL + bm);
        outR[i] = Math.tanh(R * gOut + this.ambR + bm * 0.97);
        if (sendL) { sendL[i] = SL * gOut + bm * 0.6; sendR[i] = SR * gOut + bm * 0.6; }
      }
      this.telem += n;
      if (this.splN >= 4096) { this.spl = 10 * Math.log10(this.splAcc / this.splN / (PREF * PREF) + 1e-12); this.splAcc = 0; this.splN = 0; }
      if (this.post && this.telem >= 1024) { this.telem = 0; this.post(this.telemetry()); }
    }

    // Estrondo sônico: onda em N (choque de proa, expansão linear, choque de cauda).
    // Pico e duração pela regra de Carlson para o campo distante:
    //   Δp ≈ 1,9·Ks·p0·(M²−1)^⅛·(l/h)^¾  (1,9 = reflexão no chão)
    //   T ≈ l·M/(M²−1)^⅜ · (h)^¼, escalado para aeronaves conhecidas
    triggerBoom(M, h) {
      const c = this.cfg, l = c.length || 30, ks = c.shape || 0.09, m2 = Math.max(0.02, M * M - 1), fs = this.fs, rng = this.rng;
      const dp = 1.9 * ks * 101325 * Math.pow(m2, 1 / 8) * Math.pow(l / h, 0.75);
      const T = clamp((0.0042 * l * M) / Math.pow(m2, 3 / 8) * Math.pow(h / 300, 0.25), 0.03, 0.45);
      this.boomDp = dp; this.boomDur = T; this.boomT = 0; this.boomAge = 0;
      this.boomDb = 20 * Math.log10(dp / PREF);
      // no alto-falante o pico fica perto do máximo; mais fraco quanto mais alto o voo
      this.boomAmp = 0.95 * clamp(Math.pow(dp / 600, 0.35), 0.3, 1);
      this.boomS = 0; this.boomS2 = 0;
      // tempo de subida do choque: absorção e relaxação molecular do ar arredondam a frente
      // da onda ao longo do caminho (≈1 ms a 300 m, ≈5 ms a 1,5 km)
      const rise = 0.0003 + 0.002 * Math.pow(h / 1000, 1.3);
      this.boomK = 1 - Math.exp(-3.4 / (rise * fs));
      // turbulência perto do chão: cada choque chega mais pontudo ou mais redondo
      this.boomF = 0.8 + 0.55 * rng.next(); this.boomR = 0.8 + 0.55 * rng.next();
      // trovão: reflexões no terreno e espalhamento na turbulência, mais longo de longe
      this.boomRumDecay = Math.exp(-1 / ((0.3 + 0.9 * Math.min(1, h / 1500)) * fs));
      this.boomRumLvl = 0.07 + 0.16 * Math.min(1, h / 1500);
      const fc = 70 + 110 * Math.pow(300 / h, 0.5);
      this.boomRumF = [new Biquad().lp(fs, fc, 0.7), new Biquad().lp(fs, fc * 1.6, 0.6)];
      this.boomRumN = 1.732 / Math.sqrt((1.11 * fc) / (fs / 2));
      this.boomRum = 0; this.boomCrk = 0;
      this.boomCrkF = new Biquad().hp(fs, 1200, 0.7);
    }

    boomSample(rng) {
      const fs = this.fs, n = this.boomT, t = n / fs, T = this.boomDur;
      // onda em N: choque de proa, expansão linear, choque de cauda
      let p = 0;
      if (t < T) p = this.boomF * (1 - t / T) - this.boomR * (t / T);
      // cada choque também chega com um estalo curto e picado (turbulência)
      if (n === 0 || n === Math.round(T * fs)) { this.boomRum += 1; this.boomCrk = 0.6 + 0.6 * rng.next(); }
      this.boomCrk *= 0.995;
      const tgt = p * this.boomAmp;
      this.boomS += this.boomK * (tgt - this.boomS);
      this.boomS2 += this.boomK * (this.boomS - this.boomS2);
      this.boomRum *= this.boomRumDecay;
      const nz = rng.bi();
      const rum = this.boomRumF[1].run(this.boomRumF[0].run(nz)) * this.boomRumN * this.boomRum * this.boomRumLvl * this.boomAmp;
      this.boomT++;
      if (t > T + 0.2 && this.boomRum < 1e-3) this.boomT = -1;
      const crk = this.boomCrkF.run(rng.bi()) * this.boomCrk * 0.14 * this.boomAmp;
      return this.boomS2 + rum + crk;
    }

    // Som de fundo de cada ambiente (vento, pátio, ventilação), fraco e constante.
    ambience(rng, k) {
      const env = this.params.env;
      if (env !== this.ambEnv) {
        this.ambEnv = env; const fs = this.fs, f = this.ambF;
        const spec = { runway: [500, 0.6, 120, 0.004], apron: [900, 0.5, 200, 0.006], hangar: [300, 0.6, 60, 0.004], testcell: [700, 0.6, 140, 0.009], valley: [400, 0.5, 90, 0.005], carrier: [600, 0.4, 70, 0.009] }[env] || [500, 0.6, 100, 0.004];
        f[0].lp(fs, spec[0], spec[1]); f[1].hp(fs, 40, 0.6); f[2].bp(fs, spec[2], 2); f[3].lp(fs, 2500, 0.6);
        this.ambLvl = spec[3];
      }
      this.gust += k * ((rng.next() < 0.5 ? -1 : 1) * 1.6 - this.gust) * 0.02;
      const f = this.ambF, a = this.ambLvl * (this.cabin ? 0.15 : 1);
      const wind = f[1].run(f[0].run(rng.bi())) * (0.6 + 0.4 * Math.abs(this.gust));
      let hum = 0;
      if (this.ambEnv === 'hangar' || this.ambEnv === 'testcell') { this.ambPh += 120 / this.fs; if (this.ambPh > 1) this.ambPh -= 1; hum = 0.25 * sinr(this.ambPh); }
      const far = f[2].run(rng.bi()) * 0.8;
      this.ambL = (wind + hum + far) * a; this.ambR = (wind * 0.8 + hum + far * 1.1) * a;
    }

    telemetry() {
      const n1 = this.n1[0], u = this.u;
      const thrust = this.state === 'run' ? this.thrust100 * (0.04 + 0.96 * Math.pow(u, 1.6)) * (1 + 0.55 * this.ab) * (1 - 1.2 * (this.rev || 0)) : 0;
      // EGT: sobe com a chama, passa do ponto na partida e assenta na marcha lenta
      const peak = this.state === 'start' ? 170 * smooth(0, 4, this.lightT || 0) * (1 - smooth(0.42, 0.6, this.n2)) : 0;
      const egt = 20 + 60 * this.n2 + (this.litR || 0) * (340 + 520 * Math.pow(this.n2, 4) + peak);
      return {
        type: 'telemetry', state: this.state, n1: n1 * 100, n2: this.n2 * 100, np: this.np * 100, tla: this.tla,
        ph: this.phF[0], phH: this.phH[0], phP: this.phP[0], f1: n1 * this.n1Hz, f2: this.n2 * this.n2Hz, fp: this.np * this.propHz,
        Mt: this.Mt || 0, Mh: this.Mh || 0, cut1: this.cut ? this.cut[1] : 0, bpf: this.B * n1 * this.n1Hz, hpcF: this.hpcB * this.n2 * this.n2Hz,
        vj: this.VcOut || 0, vb: this.Vb * n1, mj: this.Mj || 0, fJet: this.bpr > 0.2 ? this.fJbL : this.fJcL, fShock: this.aShock > 0.05 ? this.fShock : 0,
        ab: this.ab || 0, rev: this.rev || 0, lit: !!this.lit, fuel: !!this.fuelOn, starter: this.starterAir > 0.5, ff: this.ff * this.E, thrust: thrust * this.E, egt,
        spl: this.spl, flyX: this.flyX, mach: this.vFly / C0, boomDb: this.boomDb, boomAge: this.boomAge, inCone: this.inCone, alt: this.params.alt, gTh: this.gTh[0], gR: this.gR[0],
        buzz: this.aBuzz > 0.05, crackle: this.crackRate > 100,
      };
    }
  }

  return { JetDSP };
}

if (typeof module !== 'undefined' && module.exports) module.exports = JetDSPFactory;
