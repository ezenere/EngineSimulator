// Motor radial (docs/RADIAL.md), como subclasse do EngineDSP do Ronco (o padrão do DieselDSP).
//
// O laço de amostra é o do Ronco: cilindro de zona única, válvulas com escoamento compressível, escape em guias de onda,
// virabrequim e ouvintes. O radial entra por três caminhos:
//  1. Geometria (src/engines/radial/geometria.ts): PMS reais das articuladas (a irregularidade de fase própria do radial),
//     ordens reais da P&W na dupla fileira e a ordem decorrente do R-4360; o curso das articuladas pesa no ar e na energia
//     de cada cilindro (gancho 2); a vibração sem a 1ª ordem, que o contrapeso anula (gancho 9).
//  2. Métodos sobrescritos inteiros: buildExhaust (anel coletor com k saídas, estaques, aranha, lados do Sherman, um
//     sistema por fileira, os dois anéis numa turbina no P-47, as fileiras aos pares no R-4360), buildFilters (o apito do
//     motor de arranque de inércia), calibrate/measurePower (sondas com um RadialDSP e o escape de referência), tune.
//  3. Os ganchos `if (this.av)` do EngineDSP, com as funções da aviação (src/engines/ronco/aviacao.ts: magnetos, mistura,
//     carga da hélice ou do rotor, som da hélice na página) trocadas aqui pelas do radial: encharque dos cilindros de
//     baixo e os "tosses" da partida, arranque de inércia (energizar → engatar), elétrico direto e a ar comprimido
//     (M-14P), contagem de pás, estouros da partida, refrigeração a ar das aletas expostas (gancho 12).
//
// Regra do DSP: nada do navegador; a taxa entra no construtor; RNG com semente.
import { TAU, DEG, P0, clamp, smooth, flow, RNG, Biquad, Line, Junction, TwoPort, Radiator, port } from '../../acoustics';
import { EngineDSP } from '../ronco/dsp';
import { T_MAN } from '../ronco/constantes';
import { AV, arranqueBase, paLw5 } from '../ronco/aviacao';
import type { EscapeRadial } from './geometria';

/** escape de referência da calibração (RADIAL.md 2.3): um anel de uma saída */
export const ESCAPE_REF: EscapeRadial = { tipo: 'anel', Danel: 1.1, Oanel: 80, Lp: 0.2, saidas: [{ L: 0.8, O: 80, phi: 180 }] };

/** rotação em que o arranque de inércia entrega o volante (s de energização, automático) */
const T_ENERGIZAR = 16;

export class RadialDSP extends EngineDSP {
  declare fase: any; declare tFase: any; declare tGiro: any; declare pas: any; declare magAuto: any; declare encharque: any; declare fumaca: any;
  declare radPhi: any; declare rotAng: any; declare apF: any; declare apPh: any; declare apHz: any; declare apAmp: any; declare apNz: any;
  declare Aar: any; declare blowerAlta: any; declare engateT: any; declare falhaMedia: any;
  // (da aviação, postos por instalarAviacao: src/engines/ronco/aviacao.ts)
  declare heliceSom: any; declare magnetos: any; declare mistura: any; declare partidaTipo: any; declare prime: any; declare cargaAv: any; declare falhaMix: any; declare nivelEscape: any;

  constructor(fs: number) {
    super(fs);
    this.av = true; this.radial = true;
    // os ganchos do EngineDSP chamam estas (propriedades da instância, como no DieselDSP)
    this.falhaAv = this.falhaRadial; this.torquePartida = this.torqueRadial; this.partidaAr = this.arRadial; this.somPartidaAv = this.somArranque;
    this.avControle = this.controleRadial; this.avMensagem = this.mensagemRadial; this.avTelemetria = this.telemetriaRadial; this.avSomExtra = this.somExtraRadial;
    this.fase = 'parado'; this.tFase = 0; this.tGiro = 0; this.pas = 0; this.magAuto = true; this.encharque = new Float64Array(1); this.fumaca = 0;
    this.apPh = 0; this.apHz = 0; this.apAmp = 0; this.engateT = -1; this.falhaMedia = 0; this.blowerAlta = false;
  }

  // ------------------------------------------------------------------ configuração
  setConfig(cfg, calibrate = true) {
    // encharque (3.4): óleo nos cilindros de baixo com o motor parado; 1 no de baixo, 0 nos de cima
    this.encharque = Float64Array.from(cfg.phi || cfg.axis, (p: number) => Math.max(0, -Math.cos(p * DEG)));
    super.setConfig(cfg, calibrate);
    if (this.heliceSom) this.heliceSom.pasLentas = true; // (contagem de pás: o "vuff" de cada pá passando devagar)
    this.rotAng = cfg.rotativo ? 0 : undefined;
  }

  tune(cfg) {
    super.tune(cfg);
    // tanque: a rolagem das esteiras (0,06·m·g) no lugar da do pneu
    if (cfg.rolagem) this.roll = cfg.rolagem * this.mass * 9.81;
    // vazamento do anel de chapa e das juntas (breakout do Ronco), com o acerto da instalação em dB (`vazamento`, RADIAL.md 2.1)
    this.breakK = ({ sealed: 0, old: 1, leaky: 2.2 }[cfg.breakout] || 0) * Math.pow(10, (cfg.vazamento || 0) / 20);
    // superalimentador de duas velocidades (R-2800): a relação e a pressão da marcha alta
    const sa = cfg.superalimentador;
    if (sa?.duasVelocidades && this.blowerAlta) { this.scOrder = sa.duasVelocidades.relacao * sa.pas; this.maxBoost = sa.duasVelocidades.boost; }
    // ar de partida (3.4): orifício que dá ṁ = 0,02·(Vd/0,5 L) kg/s engasgado a 20 bar
    this.Aar = (0.3 * 0.02 * ((this.Vd || 1e-3) / 0.5e-3)) / (0.0404 * 20e5 / Math.sqrt(T_MAN)); // (×0,3: com a vazão do RADIAL.md o motor saía a 300 rpm em 0,7 s)
  }

  // ------------------------------------------------------------------ escape (2.1)
  buildExhaust(cfg) {
    const fs = this.fs, N = this.N, e: EscapeRadial = cfg.escape || ESCAPE_REF;
    const lines: Line[] = [], nodes: any[] = [], runners = new Array(N), rads: Radiator[] = [], radPhi: number[] = [];
    const L = (len: number, Y: number, loss: number, damp = 1) => { const l = new Line(fs, Math.max(0.02, len), Y, loss, damp); l.kNL = 0.6; lines.push(l); return l; };
    const ds = (mm: number) => clamp(mm / 63.5, 0.4, 2.4);
    const phi: number[] = cfg.phi || cfg.axis, grupo: number[] = cfg.bank, nG: number = cfg.banks, fil: number[] = cfg.fileira || new Array(N).fill(0);
    this.brkW = new Float64Array(N);
    for (let c = 0; c < N; c++) {
      const r = L(cfg.runners[c], 1, 12000); r.runner = true; runners[c] = r;
      this.brkW[c] = 1 + 0.2 * new RNG(0x7a11 + 977 * c + 31 * N).bi();
    }
    this.bankJ = new Array(nG).fill(null);
    const radiar = (line: Line, ph: number, O: number) => {
      const d = ds(O), A2 = d * d, p = Math.sin(ph * DEG);
      const r = new Radiator(fs, line, 0.62 - 0.34 * p, 0.62 + 0.34 * p, 1500 / d, A2, 400 / (TAU * 0.03175 * d));
      nodes.push(r); rads.push(r); radPhi.push(ph);
    };
    const angMedio = (cs: number[]) => Math.atan2(cs.reduce((s, c) => s + Math.sin(phi[c] * DEG), 0), cs.reduce((s, c) => s + Math.cos(phi[c] * DEG), 0)) / DEG;
    const distAng = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
    let A2out = 1;
    if (e.tipo === 'tubos') {
      // estaques: cada grupo (um cilindro, ou os vizinhos de uma fileira) numa junção (onde os estouros entram) → boca
      const O = e.Ot ?? 40; A2out = ds(O) ** 2;
      for (let g = 0; g < nG; g++) {
        const cs = []; for (let c = 0; c < N; c++) if (grupo[c] === g) cs.push(c);
        if (!cs.length) continue;
        const sh = L(0.05, cs.length, 12000);
        const j = new Junction([...cs.map((c) => port(runners[c], 1)), port(sh, 0)]);
        nodes.push(j); this.bankJ[g] = j;
        radiar(sh, angMedio(cs), O);
      }
    } else if (e.tipo === 'aranha') {
      const s = e.saidas?.[0] ?? { L: 0.5, O: 70, phi: 180 }, A2 = ds(s.O) ** 2; A2out = A2;
      const out = L(s.L, 0.55 * Math.sqrt(N) * A2, 9000, 1 / ds(s.O));
      const j = new Junction([...runners.map((r) => port(r, 1)), port(out, 0)]);
      nodes.push(j); this.bankJ[0] = j;
      radiar(out, s.phi, s.O);
    } else if (e.tipo === 'lados') {
      // Sherman: dois meio-anéis (coletores em cadeia, um por lado) → dois tubos de saída na traseira
      for (let g = 0; g < nG; g++) {
        const cs = []; for (let c = 0; c < N; c++) if (grupo[c] === g) cs.push(c);
        cs.sort((a, b) => phi[a] - phi[b]);
        const s = e.saidas?.[g] ?? { L: 1.5, O: 90, phi: g ? 200 : 160 }, A2 = ds(s.O) ** 2, Ya = 0.55 * Math.sqrt(cs.length) * A2; A2out = A2;
        const segs = cs.slice(1).map((_, k) => L(Math.max(0.08, ((Math.PI * (e.Danel ?? 1.0)) / N) * (distAng(phi[cs[k + 1]], phi[cs[k]]) / (360 / N))), Ya, 9000, 1 / ds(s.O)));
        const out = L(s.L, Ya, 9000, 1 / ds(s.O));
        cs.forEach((c, k) => {
          const ps = [port(runners[c], 1)];
          if (k > 0) ps.push(port(segs[k - 1], 1));
          if (k < cs.length - 1) ps.push(port(segs[k], 0)); else ps.push(port(out, 0));
          const j = new Junction(ps); nodes.push(j);
          if (k === cs.length - 1) this.bankJ[g] = j;
        });
        radiar(out, s.phi, s.O);
      }
    } else {
      // anel coletor: N_f primários → junções em laço (segmentos de π·D/N_f); nas junções das saídas, a 4ª porta
      const rows = Math.max(...fil) + 1;
      const sistemas: number[][] = e.juntar ? e.juntar : e.porFileira || e.turbina ? Array.from({ length: rows }, (_, r) => [r]) : [Array.from({ length: rows }, (_, r) => r)];
      const Oa = e.Oanel ?? 80, A2a = ds(Oa) ** 2, dwa = 1 / ds(Oa);
      const saidas = e.saidas?.length ? e.saidas : [{ L: 0.8, O: 80, phi: 180 }];
      const pontasTurbo: Line[] = [];
      // um anel sobre os cilindros dados; `toco` = tubo que sai da junção mais perto de `ph` (pares de fileiras, turbina)
      const anel = (cs: number[], toco: { ph: number; linha: Line } | null) => {
        cs.sort((a, b) => phi[a] - phi[b]);
        const n = cs.length, Ya = 0.55 * Math.sqrt(n) * A2a;
        const seg = cs.map(() => L((Math.PI * (e.Danel ?? 1.1)) / n, Ya, 9000, dwa));
        const ports: any[][] = cs.map((c, k) => [port(runners[c], 1), port(seg[k], 0), port(seg[(k - 1 + n) % n], 1)]);
        const perto = (ph: number) => { let kb = 0; cs.forEach((c, k) => { if (distAng(phi[c], ph) < distAng(phi[cs[kb]], ph)) kb = k; }); return kb; };
        let jOut = 0;
        if (toco) { jOut = perto(toco.ph); ports[jOut].push(port(toco.linha, 0)); }
        else saidas.forEach((sd, si) => {
          const k = perto(sd.phi), A2 = ds(sd.O) ** 2;
          const out = L(sd.L, Ya * (A2 / A2a), 9000, 1 / ds(sd.O));
          ports[k].push(port(out, 0)); if (si === 0) jOut = k;
          radiar(out, sd.phi, sd.O); A2out = A2;
        });
        const js = ports.map((ps) => new Junction(ps));
        nodes.push(...js);
        return js[jOut];
      };
      const daFileira = (rs: number[]) => { const cs = []; for (let c = 0; c < N; c++) if (rs.includes(fil[c])) cs.push(c); return cs; };
      sistemas.forEach((rs, si) => {
        if (!e.juntar && !e.turbina) { this.bankJ[si] = anel(daFileira(rs), null); return; }
        const sd = saidas[Math.min(si, saidas.length - 1)];
        const tocos: Line[] = [];
        for (const r of rs) {
          const cs = daFileira([r]), n = cs.length;
          const t = e.turbina ? L(e.turbina.Lantes, 0.55 * Math.sqrt(n) * ds(e.turbina.Oantes) ** 2, 9000, 1 / ds(e.turbina.Oantes)) : L(0.3, 0.55 * Math.sqrt(n) * A2a, 9000, dwa);
          const jr = anel(cs, { ph: sd.phi, linha: t });
          tocos.push(t);
          if (e.turbina) this.bankJ[r] = jr;
        }
        if (e.juntar) {
          const A2 = ds(sd.O) ** 2;
          const out = L(sd.L, 0.55 * Math.sqrt(N / sistemas.length) * A2, 9000, 1 / ds(sd.O));
          const j = new Junction([...tocos.map((t) => port(t, 1)), port(out, 0)]);
          nodes.push(j); this.bankJ[si] = j;
          radiar(out, sd.phi, sd.O); A2out = A2;
        } else pontasTurbo.push(...tocos);
      });
      if (e.turbina && pontasTurbo.length) {
        // P-47: os dois tubos se juntam antes da turbina (TwoPort 'turbo' do Ronco) e a cauda leva à boca
        const t = e.turbina, A2 = ds(t.Oantes) ** 2, Ym = 0.55 * Math.sqrt(N) * A2;
        const mid = L(0.3, Ym, 9000, 1 / ds(t.Oantes));
        nodes.push(new Junction([...pontasTurbo.map((x) => port(x, 1)), port(mid, 0)]));
        const tail = L(t.Ldepois, 0.55 * Math.sqrt(N) * ds(t.Odepois) ** 2, 9000, 1 / ds(t.Odepois));
        nodes.push(new TwoPort(fs, port(mid, 1), port(tail, 0), 'turbo'));
        radiar(tail, 180, t.Odepois); A2out = ds(t.Odepois) ** 2;
      }
    }
    for (let g = 0; g < nG; g++) if (!this.bankJ[g]) this.bankJ[g] = this.bankJ.find((x) => x) || nodes.find((x) => x instanceof Junction);
    this.pipeA = A2out;
    this.lines = lines; this.nodes = nodes; this.runners = runners; this.rads = rads; this.radPhi = radPhi;
    this.radHP = rads.map(() => new Biquad().hp(fs, 45, 0.7));
    this.radSh = rads.map(() => new Biquad().peak(fs, 110, 0.6, 3));
    let ib = 64; while (ib < fs * 0.0015) ib <<= 1;
    this.itdB = rads.map(() => new Float32Array(ib)); this.itdM = ib - 1; this.itdW = 0;
    this.itdD = rads.map((r) => {
      const p = (r.panR - r.panL) / (r.panR + r.panL + 1e-9), d = Math.round(Math.abs(p) * 0.0006 * fs);
      return p > 0 ? [d, 0] : [0, d];
    });
    this.jetF = rads.map(() => [new Biquad().bp(fs, 450, 0.5), new Biquad().bp(fs, 1400, 0.6)]);
    this.jetEnv = rads.map(() => 0);
    this.tipA = A2out;
  }

  buildFilters(cfg) {
    super.buildFilters(cfg);
    // apito do volante do arranque de inércia (3.4): ruído em banda estreita (Q 25) em volta do tom
    this.apF = new Biquad().bp(this.fs, 300, 25); this.apNz = new RNG(0xa917);
  }

  // ------------------------------------------------------------------ sondas (2.3)
  private sonda(cfg, rpm: number) {
    const ref = { ...cfg, escape: ESCAPE_REF, bank: new Array(cfg.N).fill(0), banks: 1, runners: cfg.runners.map((_: number, c: number) => 0.2 * (1 + 0.03 * Math.sin(c * 2.3))),
      gain: undefined, powerModel: undefined, scWhine: 0, breakout: 'sealed', rotativo: undefined };
    const t = new RadialDSP(this.fs);
    t.setConfig(ref, false);
    t.state = 'run'; t.lockOmega = true; t.tempMode = 'fixed'; t.tempSet = 90; t.coolant = 90; t.runT = 100;
    t.omega = (rpm * TAU) / 60; t.rpmAvg = rpm; t.magnetos = 'ambos'; t.mistura = 0.8;
    return t;
  }

  calibrate(cfg) {
    const B = 256, L = new Float32Array(B), R = new Float32Array(B), fs = this.fs;
    const t = this.sonda(cfg, this.redline * 0.55);
    t.thrTarget = 1; t.thr = 1; t.boost = cfg.boost * 0.8; t.maxBoost = cfg.boost * 0.8; t.params.master = 0.02;
    let acc = 0, cnt = 0, pk = 0;
    for (let i = 0; i < 0.5 * fs; i += B) {
      t.process(L, R, B);
      if (i > 0.25 * fs) for (let k = 0; k < B; k++) { acc += L[k] * L[k] + R[k] * R[k]; cnt += 2; pk = Math.max(pk, Math.abs(L[k]), Math.abs(R[k])); }
    }
    const rms = Math.sqrt(acc / Math.max(1, cnt)) / 0.01, target = 0.17;
    const gWot = Math.min(target / Math.max(rms, 1e-6), 0.9 / Math.max(pk / 0.01, 1e-6));
    const ti = this.sonda(cfg, this.idle);
    ti.runT = 60; ti.thrTarget = 0; ti.thr = 0; ti.params.master = 0.02; ti.dash = 0;
    let acc2 = 0, cnt2 = 0;
    for (let i = 0; i < 1.2 * fs; i += B) {
      ti.process(L, R, B);
      ti.dash = 0; ti.iacI = clamp(ti.iacI - 5e-4 * ti.tqMean * (B / fs), 0, 0.05);
      if (i > 0.8 * fs) for (let k = 0; k < B; k++) { acc2 += L[k] * L[k] + R[k] * R[k]; cnt2 += 2; }
    }
    const rmsIdle = Math.sqrt(acc2 / Math.max(1, cnt2)) / 0.01;
    const gIdle = (target * 0.09) / Math.max(rmsIdle, 1e-6);
    const gain = clamp(gWot, 0.05, 40);
    return { gain, idle: clamp(gIdle / gain, 1, 8) };
  }

  measurePower(cfg) {
    const B = 256, L = new Float32Array(B), R = new Float32Array(B), fs = this.fs;
    const t = this.sonda({ ...cfg, limiter: 'none', power: undefined }, this.redline * 0.6);
    t.thrTarget = 1; t.thr = 1; t.boost = cfg.boost; t.maxBoost = cfg.boost; t.params.master = 0;
    let kw = 0, tq = 0, fr = 0;
    for (const f of [0.6, 0.75, 0.9]) {
      t.omega = (this.redline * f * TAU) / 60; t.rpmAvg = this.redline * f; t.tqMean = 0; t.frMean = 0;
      for (let i = 0; i < 0.35 * fs; i += B) t.process(L, R, B);
      const k = (t.tqMean * t.omega) / 1000;
      if (k > kw) { kw = k; tq = t.tqMean; fr = t.frMean; }
    }
    return { kw: Math.max(kw, 1), tq: Math.max(tq, 1), fr: Math.max(fr, 0) };
  }

  // ------------------------------------------------------------------ partida (3.4)
  setIgnition(on) {
    if (!on) { this.fase = 'parado'; this.engateT = -1; super.setIgnition(false); return; }
    if (this.state !== 'off') return super.setIgnition(true);
    const tipo = this.partidaTipo;
    this.pas = 0; this.tGiro = 0; this.tFase = 0;
    if (this.magAuto) this.magnetos = tipo === 'ar' || tipo === 'manivela' ? 'ambos' : 'desligado';
    if (tipo === 'inercia') { this.fase = 'energizar'; this.ignition = true; return; }
    this.fase = 'girar';
    if (tipo === 'manivela') { this.gear = Math.max(1, this.gear); this.v = Math.max(this.v, 2); this.clutch = 1; }
    super.setIgnition(true);
  }

  /** engata o volante (inércia) ou começa a girar */
  engatar() {
    if (this.fase !== 'energizar') return;
    this.fase = 'girar'; this.tGiro = 0; this.engateT = 0; this.clickEnv += 4; // (o estalo do engate)
    super.setIgnition(true);
  }

  falhaRadial(c: number) {
    if (this.magnetos === 'desligado') return 1;
    const rt = this.runT || 0, en = this.encharque[c] * (1 + 0.3 * (this.prime || 0));
    const umMag = this.magnetos === 'esq' || this.magnetos === 'dir' ? 0.02 * en : 0;
    // 0,55·encharque·e^(−t/8) nos de baixo; 0,12·e^(−t/15) em todos (menos com o primer nos de cima)
    return 0.55 * en * Math.exp(-rt / 8) + 0.12 * Math.exp(-rt / 15) * (1 - 0.15 * (this.prime || 0) * (1 - this.encharque[c])) + this.falhaMix + umMag;
  }

  torqueRadial(rpm: number) {
    if (this.state !== 'crank') return 0;
    const tipo = this.partidaTipo, T0 = arranqueBase(this);
    // inércia: a energia do volante vai acabando em ~7 s (o motor gira a 60–100 rpm); a ar e a manivela: sem motor
    if (tipo === 'inercia') return 1.15 * T0 * Math.max(0, 1 - this.tGiro / 7) * Math.max(0, 1 - rpm / 250);
    if (tipo === 'direta') return T0 * Math.max(0, 1 - rpm / 220);
    return 0;
  }

  /** ar comprimido (M-14P): o distribuidor manda ar ao cilindro depois do PMS, por ~3 s. O RADIAL.md diz de 5° a 60°;
   *  com 9 cilindros a 80° isso deixa buracos de 25° em que nenhum cilindro recebe ar e o motor parado não sai do lugar:
   *  aqui de 3° a 100° (o distribuidor real tem a janela larga para isso) */
  arRadial(c: number, a: number) {
    if (a < 3 || a >= 100) return 0;
    return Math.max(0, flow(this.Aar, 20e5, T_MAN, this.p[c], T_MAN));
  }

  somArranque(rng) {
    if (this.state !== 'crank') return 0;
    return this.partidaTipo === 'direta' ? AV.somDireta.call(this, rng) : 0;
  }

  controleRadial(dtc: number) {
    AV.controleAv.call(this, dtc);
    const tipo = this.partidaTipo;
    if (this.fase === 'energizar') {
      this.tFase += dtc;
      if (this.tFase >= T_ENERGIZAR) this.engatar();
    }
    if (this.state === 'crank') {
      this.tGiro += dtc;
      // contagem de pás (o painel conta; os magnetos ligam na 9ª pá no automático)
      const c = this.cargaAv?.hcfg ?? (this.carga?.cfg?.nHelice ? this.carga.cfg : null);
      if (c) this.pas += ((this.omega / c.i) / TAU) * c.B * dtc;
      else this.pas += ((this.omega / TAU) * 3) * dtc;
      if (this.magAuto && this.magnetos === 'desligado' && this.pas >= 9) this.magnetos = 'ambos';
    }
    if (this.state === 'run' && this.fase === 'girar') this.fase = 'pegou';
    if (this.state === 'off' && (this.fase === 'girar' || this.fase === 'pegou')) this.fase = 'parado';
    this.arPartida = tipo === 'ar' && this.state === 'crank' && this.tGiro < 3;
    if (this.engateT >= 0) { this.engateT += dtc; if (this.engateT > 3) this.engateT = -1; }
    // apito do volante: sobe de 290 a 390 Hz em 18 s energizando; no engate cai em ~2 s
    if (this.fase === 'energizar') { this.apHz = 290 + 100 * Math.min(1, this.tFase / 18); this.apAmp = smooth(0, 1.5, this.tFase); }
    else if (this.engateT >= 0) { this.apHz *= Math.exp(-dtc / 1.5); this.apAmp *= Math.exp(-dtc / 0.8); }
    else this.apAmp *= Math.exp(-dtc / 0.3);
    if (this.apAmp > 1e-3) this.apF.bp(this.fs, Math.max(60, this.apHz), 25);
    // fumaça: fração esperada de falhas
    let f = 0; for (let k = 0; k < this.N; k++) f += Math.min(1, this.falhaRadial(k));
    this.falhaMedia = this.state === 'run' || this.state === 'crank' ? f / this.N : 0;
    this.fumaca += (this.falhaMedia - this.fumaca) * (1 - Math.exp(-dtc / 2));
    // Megola: os estaques giram com a roda (rpm/i): a panorâmica de cada boca gira junto
    if (this.rotAng !== undefined && this.rads) {
      this.rotAng = (this.rotAng + (this.omega / this.cfg.rotativo.i) * dtc) % TAU;
      for (let k = 0; k < this.rads.length; k++) {
        const p = Math.sin(this.radPhi[k] * DEG + this.rotAng);
        this.rads[k].panL = 0.62 - 0.34 * p; this.rads[k].panR = 0.62 + 0.34 * p;
      }
    }
  }

  mensagemRadial(m: any) {
    if (m.magnetos !== undefined) this.magAuto = false;
    AV.mensagemAv.call(this, m);
    if (m.magAuto !== undefined) this.magAuto = !!m.magAuto;
    if (m.partida === 'energizar' && this.state === 'off') this.setIgnition(true);
    else if (m.partida === 'engatar') this.engatar();
    else if (m.partida === 'parar') this.setIgnition(false);
    if (m.blower !== undefined && this.cfg?.superalimentador?.duasVelocidades) { this.blowerAlta = m.blower === 'alta'; this.tune(this.cfg); }
  }

  telemetriaRadial(t: any) {
    AV.telemetriaAv.call(this, t);
    const rt = this.runT || 0;
    t.fase = this.fase; t.pas = this.pas; t.fumaca = this.fumaca; t.apito = this.apAmp > 0.01 ? this.apHz : 0; t.blower = this.blowerAlta ? 'alta' : 'baixa';
    t.encharque = Array.from(this.encharque, (x: number) => +(x * (1 + 0.3 * (this.prime || 0)) * Math.exp(-rt / 8)).toFixed(2));
    t.cht = this.coolant;
  }

  /** hélice (aviacao.ts) + apito do arranque de inércia (0,02 Pa a 5 m, tom + 2º harmônico −12 dB + banda estreita) */
  somExtraRadial() {
    let x = AV.somExtraAv.call(this);
    if (this.apAmp > 1e-3 && !this.lockOmega) {
      this.apPh += this.apHz / this.fs; if (this.apPh > 1) this.apPh -= 1;
      const kPa = 0.17 / (paLw5(this.nivelEscape) * Math.max(1e-6, this.cfgGain * this.mk));
      const tom = Math.sin(TAU * this.apPh) + 0.25 * Math.sin(2 * TAU * this.apPh) + 2 * this.apF.run(this.apNz.bi());
      x += 0.02 * Math.SQRT2 * kPa * this.apAmp * tom * (this.wE + 0.3 * this.wI + 0.6 * this.wB + 0.2 * this.wP);
    }
    return x;
  }
}

void P0;
