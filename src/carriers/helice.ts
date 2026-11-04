// Portador hélice com redutor (CENA.md 4.2). A hélice gira a Ω_h = ω/i; torque refletido no motor
//   Q_motor = Q_h/i,  Q_h = c_Q(β, J)·ρ·n_h²·D⁵,  n_h = Ω_h/2π,  J_adv = v/(n_h·D)
//   c_Q(β) = cQ0·(1 + 6·(β − β_min)/(β_max − β_min)), menos 0,3·J_adv·c_Q de alívio com o avanço
//   inércia refletida J_hel/i²
// Governador de rotação constante: PI sobre β (K_p 0,02 rad por % de erro de rpm, K_i 0,01/s), limites
// de passo, taxa máxima de 5°/s; abaixo de 60% da nHelice o passo fica no mínimo. Passo fixo: β fixo.
//
// Fonte `helice` (Pa a 30 m, como a Turbina): BPF = B·n_h, harmônicos a_h = exp(−(h−1)·κ),
// κ = 0,1 + 2,6·(1 − M_t)^1,3, espessura ∝ M_t² e carga ∝ potência, a mesma tabela de `buildPropTab`
// do jet-dsp; ruído largo de pá em 900 + 900·M_t Hz; reverso: ruído largo ×3 (1 + 2·rv).
// Hélice idêntica à da Turbina: com um turboélice acoplado (src/engines/turbina/motor.ts) a hélice é a do próprio
// JetDSP (a fonte `helice.g` do motor substitui a `helice` daqui) e a física do portador só faz a telemetria; sem ele
// (ou com outro motor), a `FonteHelice` abaixo é a mesma aritmética do JetDSP, conferida amostra a amostra.
import type { Carga, Vec3 } from '../scene/tipos';
import type { TelemetriaPortador, Corpo } from './tipos';
import { PortadorComMotor, GovernadorPI, type GeradorCanal } from './base';
import { RNG, BiquadComPiso, C0, clamp, smooth } from '../acoustics';
import { sinr } from '../engines/turbina/constantes';
import { RHO, C_SOM } from '../scene/constantes';

export interface ConfigHelice {
  B: number; D: number; i: number; nHelice: number;   // pás, m, rpm motor/rpm hélice, rpm governada
  J_hel: number;                                      // kg·m²
  betaMin: number; betaMax: number;                   // rad
  cQ0: number;
  passoFixo: boolean;
  posCubo: Vec3; posMotor: Vec3;
  // (RADIAL.md 3.3; todos opcionais, com o padrão = o comportamento de antes: os turboélices não mudam)
  /** rpm da hélice com a manete de passo no mínimo (padrão `nHelice`): o alvo é nMin + (nHelice − nMin)·rpmAlvo */
  nMin?: number;
  /** passo fixo: β do preset (padrão βmin) */
  beta0?: number;
  /** piso da fonte na lenta (padrão 0): a fonte fica em max(onLenta, rampa de 5–30% da rotação) */
  onLenta?: number;
  /** fator no decaimento κ dos harmônicos (padrão 1) e no ruído largo de pá (padrão 1): as hélices metálicas de pá fina
   *  dos aviões a pistão (T-6, Yak) têm harmônicos até a 9ª e mais ruído largo que a do turboélice */
  kapK?: number; largoK?: number;
}

/** tabela de 4.2 (BPF e M_t estático conferidos em tools/cena/portadores.ts) */
export const HELICES: Record<string, Partial<ConfigHelice> & { nome: string; B: number; D: number; nHelice: number; i: number }> = {
  c172: { nome: 'Cessna 172 (O-320)', B: 2, D: 1.93, nHelice: 2700, i: 1, passoFixo: true },
  caravan: { nome: 'Cessna 208 Caravan (PT6A-114)', B: 3, D: 2.69, nHelice: 1900, i: 15.6 },
  atr72: { nome: 'ATR 72 (PW127)', B: 6, D: 3.93, nHelice: 1200, i: 17 },
  spitfire: { nome: 'Spitfire (Merlin)', B: 4, D: 3.27, nHelice: 1260, i: 2.38 },
  tu95: { nome: 'Tu-95 (NK-12, contrarrotativa 2×4)', B: 4, D: 5.6, nHelice: 750, i: 11 },
};

/** hélices dos radiais e da aviação a pistão (RADIAL.md 3.3; J_hel em kg·m², nHelice = rotação máxima da hélice). Tabela à
 * parte da HELICES, que tools/cena/portadores.ts confere linha a linha contra a 4.2 do CENA.md */
export const HELICES_PISTAO: Record<string, Partial<ConfigHelice> & { nome: string; B: number; D: number; nHelice: number; i: number }> = {
  hamilton3: { nome: 'Hamilton Standard 3 pás (T-28)', B: 3, D: 3.05, nHelice: 1520, i: 1.778, J_hel: 45 },
  hamilton3dc3: { nome: 'Hamilton Standard 3 pás (DC-3)', B: 3, D: 3.5, nHelice: 1520, i: 1.778, J_hel: 55 },
  hamilton4f4u: { nome: 'Hamilton 4 pás (F4U-4)', B: 4, D: 4.01, nHelice: 1225, i: 2.286, J_hel: 120 },
  curtiss4: { nome: 'Curtiss Electric 4 pás (P-47D)', B: 4, D: 3.96, nHelice: 1350, i: 2, J_hel: 110 },
  hamilton4b50: { nome: 'Hamilton 4 pás (B-50, R-4360)', B: 4, D: 5.08, nHelice: 1012, i: 2.667, J_hel: 300 },
  v530: { nome: 'V530TA-D35 (Yak-52)', B: 2, D: 2.4, nHelice: 1908, i: 1.52, J_hel: 7 },
  mtv9: { nome: 'MTV-9 (Su-31)', B: 3, D: 2.5, nHelice: 1940, i: 1.52, J_hel: 5 },
  hamilton12d40: { nome: 'Hamilton 12D40 (T-6)', B: 2, D: 2.74, nHelice: 2250, i: 1, J_hel: 16, nMin: 1800 },
  hamilton2: { nome: 'Hamilton 2 pás (Trimotor)', B: 2, D: 2.6, nHelice: 2300, i: 1, J_hel: 12, passoFixo: true },
  madeira: { nome: 'Madeira/compósito (Rotec)', B: 2, D: 1.75, nHelice: 3600, i: 1, J_hel: 1.5, passoFixo: true },
};

export const HELICE_PADRAO: ConfigHelice = {
  B: 6, D: 3.93, i: 17, nHelice: 1200, J_hel: 60, betaMin: 0.15, betaMax: 0.9, cQ0: 0.01, passoFixo: false, posCubo: [4, 0, 3], posMotor: [3, 0, 3],
};

export const bpfHelice = (B: number, nHelice: number) => (B * nHelice) / 60;
export const machPonta = (D: number, nHelice: number, v = 0) => Math.hypot((Math.PI * D * nHelice) / 60, v) / C_SOM;

export class CargaHelice implements Carga {
  cfg: ConfigHelice; beta: number; v = 0; inercia: number;
  constructor(c: ConfigHelice) { this.cfg = c; this.beta = c.passoFixo && c.beta0 != null ? c.beta0 : c.betaMin; this.inercia = c.J_hel / (c.i * c.i); }
  cQ(nh: number) {
    const c = this.cfg;
    const b = Math.abs(this.beta);
    let cq = c.cQ0 * (1 + (6 * (b - c.betaMin)) / (c.betaMax - c.betaMin));
    const J = nh > 0.1 ? this.v / (nh * c.D) : 0;
    cq -= 0.3 * J * cq;
    return Math.max(0.1 * c.cQ0, cq);
  }
  torque(omega: number) {
    const c = this.cfg, nh = omega / c.i / (2 * Math.PI);
    return (this.cQ(nh) * RHO * nh * nh * Math.pow(c.D, 5)) / c.i;
  }
}

/**
 * Uma passagem de pá da hélice: espessura (pulso negativo) + carga (dipolo), exatamente o `buildPropTab` do JetDSP
 * (src/engines/turbina/dsp.ts), com a mesma tabela de seno (`sinr`): mesma aritmética, mesma tabela de 1024 pontos.
 */
export function tabelaPassagemPa(tab: Float32Array, Mh: number, load: number, kapK = 1) {
  const N = 1024;
  const kap = (0.1 + 2.6 * Math.pow(Math.max(0.02, 1 - Mh), 1.3)) * kapK;
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
}

/**
 * Fonte da hélice (Pa a 30 m), a mesma do turboélice da Turbina, amostra a amostra: a cada 64 amostras o tique de
 * controle de `JetDSP.sources()` (Mach na ponta com o avanço, carga `(0,3 + 0,7·u)(1 + 0,8·reverso)`, amplitudes
 * `9·(M/0,75)⁴` e `0,55·(M/0,75)⁵`, tabela refeita a cada 8 tiques) e, por amostra, a fase da hélice, a leitura da
 * tabela com o desbalanceamento de 1ª e 2ª ordem e o ruído largo de pá (passa-banda em 900 + 900·M, Q 0,7,
 * normalizado pela banda). A prova é `tools/cena/motores.ts` (hélice idêntica). Entradas por tique: `np` (fração
 * da rotação governada `propRpm`), `u` (potência), `rv` (reverso), `vFly` (m/s), `dprop` (diretividade; 1 na Cena).
 */
export class FonteHelice implements GeradorCanal {
  fs: number; B: number; D: number; propHz: number;
  tab = new Float32Array(1024); tabB = new Float32Array(1024); propBuild = 0; ctrl = 0;
  pp = 0; np = 0; u = 0; rv = 0; vFly = 0; fan = 1; dprop = 1;
  aProp = 0; aPbb = 0; fPbb = 1000; nPbb = 1; Mh = 0;
  pbb = new BiquadComPiso(); rng = new RNG(0x4e11c3);
  /** sem o ruído largo (teste da parte tonal) */
  semRuido = false;
  /** piso da fonte na lenta (RADIAL.md 3.3; 0 = como no JetDSP), decaimento dos harmônicos e ruído largo (1 = JetDSP) */
  onLenta = 0; kapK = 1; largoK = 1;
  /** abaixo de 10% da rotação, a contagem de pás (pulso de 20 ms de ruído grave por pá; RADIAL.md 3.3) */
  pasLentas = false; pPa = 0; envPa = 0; lpPa = 0; kPa = 0;
  constructor(fs: number, B: number, D: number, propRpm: number) { this.fs = fs; this.B = B; this.D = D; this.propHz = propRpm / 60; }
  tique() {
    const fs = this.fs;
    const tipU = Math.PI * this.D * this.np * this.propHz;
    const Mh = Math.hypot(tipU, this.vFly) / C0;
    this.Mh = Mh;
    const rv = this.rv;
    const pload = (0.3 + 0.7 * this.u) * (1 + 0.8 * rv);
    const on = Math.max(this.onLenta, smooth(0.05, 0.3, this.np));
    this.aProp = 9 * Math.pow(Mh / 0.75, 4) * pload * (this.D / 3.9) * on * this.fan;
    this.aPbb = 0.55 * Math.pow(Mh / 0.75, 5) * (1 + 2 * rv) * (this.D / 3.9) * on * this.fan;
    // (o ruído largo extra das pás finas é o do escoamento quase sônico na ponta: entra de M 0,5 a 0,85)
    if (this.largoK !== 1) this.aPbb *= 1 + (this.largoK - 1) * smooth(0.5, 0.85, Mh);
    this.fPbb = 900 + 900 * Mh;
    if (++this.propBuild >= 8) { this.propBuild = 0; tabelaPassagemPa(this.tabB, Mh, pload, this.kapK); const t = this.tab; this.tab = this.tabB; this.tabB = t; }
    this.pbb.bp(fs, this.fPbb, 0.7);
    this.nPbb = 1.732 / Math.sqrt(clamp(1.57 * (this.fPbb || 1000) / 0.7, 5, fs / 2) / (fs / 2));
  }
  preencher(out: Float32Array, n: number) {
    const dt = 1 / this.fs;
    for (let i = 0; i < n; i++) {
      if (this.ctrl-- <= 0) { this.tique(); this.ctrl = 63; }
      const fp = this.np * this.propHz;
      let pp = this.pp + fp * dt; if (pp >= 1) pp -= 1; this.pp = pp;
      const x = ((pp * this.B) % 1) * 1024, k = x | 0, f = x - k, tb = this.tab;
      const v = tb[k] + (tb[(k + 1) & 1023] - tb[k]) * f;
      const imb = 0.06 * sinr(pp) + 0.04 * sinr(2 * pp + 0.3);
      let y = this.aProp * (v + imb) * this.dprop;
      if (!this.semRuido && this.aPbb > 1e-4) y += this.pbb.run(this.rng.bi()) * this.aPbb * this.nPbb * this.dprop;
      if (this.pasLentas) y += this.passagemDePa(pp, fp);
      out[i] = y;
    }
  }
  /** contagem de pás (só com `pasLentas`): cada pá que passa abaixo de 10% da rotação dá um sopro curto e grave */
  passagemDePa(pp: number, fp: number) {
    const pa = Math.floor(pp * this.B);
    if (pa !== this.pPa) { this.pPa = pa; if (fp > 0.05 && this.np < 0.1) this.envPa = 1; }
    if (this.envPa < 1e-3) return 0;
    this.envPa *= Math.exp(-1 / (0.007 * this.fs));
    if (!this.kPa) this.kPa = 1 - Math.exp((-2 * Math.PI * 300) / this.fs);
    this.lpPa += this.kPa * (this.rng.bi() - this.lpPa);
    // (pulso de ~20 ms de ruído abaixo de 300 Hz: o "vuff" da pá passando devagar; perto do avião se ouve)
    return 0.6 * this.lpPa * this.envPa * (this.D / 3);
  }
}

export class Helice extends PortadorComMotor {
  readonly tipo = 'helice' as const;
  cfg: ConfigHelice;
  cargaH: CargaHelice;
  gov: GovernadorPI;
  fonte: FonteHelice;
  omegaLivre: number;
  reverso = 0;
  constructor(fs: number, cfg: Partial<ConfigHelice> = {}) {
    const c = { ...HELICE_PADRAO, ...cfg };
    const corpo: Corpo = { segmentos: [{ comprimento: 27, vao: 0, altura: 3, largura: 2.8, zPiso: 1 }], comprimento: 27, nariz: 3, cauda: 6, areaFrontal: 8, cd: 0.03, cpNariz: 0.05, massaSuperficial: 8, fCabine: 110 };
    super(fs, 'helice', corpo, { posMotor: c.posMotor, rotMotor: 'frente' });
    this.cfg = c;
    this.cargaH = new CargaHelice(c);
    // β em rad; saída do PI em rad, K_p 0,02 rad/%, K_i 0,01 rad/(%·s), 5°/s
    this.gov = new GovernadorPI(0.02, 0.01, c.betaMin, c.betaMax, (5 * Math.PI) / 180, c.betaMin);
    this.omegaLivre = (c.nHelice * c.i * 2 * Math.PI) / 60;
    this.fonte = new FonteHelice(fs, c.B, c.D, c.nHelice);
    this.fonte.onLenta = c.onLenta ?? 0; this.fonte.kapK = c.kapK ?? 1; this.fonte.largoK = c.largoK ?? 1; this.fonte.pasLentas = !!c.nMin || !!c.onLenta;
    this.propria({ id: 'helice', tipo: 'pa', pos: c.posCubo, dir: { tabela: [-18, -8, -3, 0, -1, -6, -18], eixo: [1, 0, 0], expConv: 3 }, refDist: 30, dentro: false }, this.fonte);
  }
  carga() { return this.cargaH; }
  /** o motor traz a hélice (turboélice do JetDSP: fonte `helice.g`) */
  get heliceDoMotor() { return !!this.motor && this.motor.fontes.some((f) => f.id.startsWith('helice.')); }

  protected fisica(n: number, dt: number) {
    const c = this.cfg, tb = n * dt, m = this.motor;
    this.cargaH.v = this.cinematica.v;
    if (m && this.heliceDoMotor) {
      // turboélice: o governador de rotação e a hélice são os do JetDSP (o `np` dele); o portador passa a manete e a velocidade
      (m as unknown as { velocidade: number }).velocidade = this.cinematica.v;
      m.comandar({ acelerador: this.cmd.pedal, ignicao: this.cmd.ignicao !== false, partida: !!this.cmd.partida });
      return;
    }
    const w = m ? m.eixo.omega : this.omegaLivre;
    const nh = (w / c.i) * 60 / (2 * Math.PI);    // rpm da hélice
    if (m) m.comandar({ acelerador: this.cmd.pedal, ignicao: this.cmd.ignicao !== false, partida: !!this.cmd.partida });
    // governador: erro positivo = rápida demais → mais passo. A manete de passo (`rpmAlvo`, 0..1) escolhe o alvo entre
    // nMin e nHelice; sem ela (turboélices) o alvo é nHelice
    if (!c.passoFixo) {
      const ra = this.cmd.rpmAlvo, nAlvo = ra === undefined || c.nMin === undefined ? c.nHelice : c.nMin + (c.nHelice - c.nMin) * ra;
      if (nh < 0.6 * nAlvo) { this.gov.saida = c.betaMin; this.gov.i = c.betaMin; }
      else this.gov.passo((100 * (nh - nAlvo)) / nAlvo, tb);
      this.cargaH.beta = this.reverso > 0 ? -this.gov.saida * this.reverso : this.gov.saida;
    }
    // fonte: as entradas do tique de controle da Turbina (fração da rotação governada, potência, reverso, avanço)
    const f = this.fonte;
    f.np = nh / c.nHelice; f.u = this.cmd.pedal; f.rv = this.reverso; f.vFly = this.cinematica.v;
  }

  telemetria(): TelemetriaPortador {
    const c = this.cfg;
    if (this.heliceDoMotor) {
      const m = this.motor as unknown as { rpmHelice: number; dsp: { propB: number; propD: number } }, nh = m.rpmHelice;
      return { v: this.cinematica.v, s: this.cinematica.s, rpmEixo: nh * c.i, torqueCarga: 0, rpmHelice: nh, beta: 0, bpf: (m.dsp.propB * nh) / 60, machPonta: machPonta(m.dsp.propD, nh, this.cinematica.v) };
    }
    const w = this.motor ? this.motor.eixo.omega : this.omegaLivre, nh = ((w / c.i) * 60) / (2 * Math.PI);
    return { v: this.cinematica.v, s: this.cinematica.s, rpmEixo: (w * 60) / (2 * Math.PI), torqueCarga: this.cargaH.torque(w), rpmHelice: nh, beta: this.cargaH.beta, bpf: (c.B * nh) / 60, machPonta: machPonta(c.D, nh, this.cinematica.v) };
  }
}
