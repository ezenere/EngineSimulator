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
// TODO (migração da Turbina): a CENA pede esta fonte idêntica amostra a amostra ao legado nos presets
// turboélice (`takeoff`, `flyby`, teste 5.10). Isso depende do adaptador do JetDSP (fase sincronizada
// entre motores, trim por motor, suavizações do `sources()`); aqui está a mesma física, não o mesmo WAV.
import type { Carga, Vec3 } from '../scene/tipos';
import type { TelemetriaPortador, Corpo } from './tipos';
import { PortadorComMotor, GovernadorPI, type GeradorCanal } from './base';
import { RNG } from '../acoustics/rng';
import { Bq } from '../scene/filtros';
import { RHO, C_SOM } from '../scene/constantes';

export interface ConfigHelice {
  B: number; D: number; i: number; nHelice: number;   // pás, m, rpm motor/rpm hélice, rpm governada
  J_hel: number;                                      // kg·m²
  betaMin: number; betaMax: number;                   // rad
  cQ0: number;
  passoFixo: boolean;
  posCubo: Vec3; posMotor: Vec3;
}

/** tabela de 4.2 (BPF e M_t estático conferidos em tools/cena/portadores.ts) */
export const HELICES: Record<string, Partial<ConfigHelice> & { nome: string; B: number; D: number; nHelice: number; i: number }> = {
  c172: { nome: 'Cessna 172 (O-320)', B: 2, D: 1.93, nHelice: 2700, i: 1, passoFixo: true },
  caravan: { nome: 'Cessna 208 Caravan (PT6A-114)', B: 3, D: 2.69, nHelice: 1900, i: 15.6 },
  atr72: { nome: 'ATR 72 (PW127)', B: 6, D: 3.93, nHelice: 1200, i: 17 },
  spitfire: { nome: 'Spitfire (Merlin)', B: 4, D: 3.27, nHelice: 1260, i: 2.38 },
  tu95: { nome: 'Tu-95 (NK-12, contrarrotativa 2×4)', B: 4, D: 5.6, nHelice: 750, i: 11 },
};

export const HELICE_PADRAO: ConfigHelice = {
  B: 6, D: 3.93, i: 17, nHelice: 1200, J_hel: 60, betaMin: 0.15, betaMax: 0.9, cQ0: 0.01, passoFixo: false, posCubo: [4, 0, 3], posMotor: [3, 0, 3],
};

export const bpfHelice = (B: number, nHelice: number) => (B * nHelice) / 60;
export const machPonta = (D: number, nHelice: number, v = 0) => Math.hypot((Math.PI * D * nHelice) / 60, v) / C_SOM;

export class CargaHelice implements Carga {
  cfg: ConfigHelice; beta: number; v = 0; inercia: number;
  constructor(c: ConfigHelice) { this.cfg = c; this.beta = c.betaMin; this.inercia = c.J_hel / (c.i * c.i); }
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

/** tabela de forma de onda da passagem de pá (buildPropTab) + ruído largo de pá */
class FonteHelice implements GeradorCanal {
  fs: number; B: number; tab = new Float32Array(1024); tabB = new Float32Array(1024); fase = 0; fp = 0;
  a = 0; aBB = 0; fBB = 900; bb = new Bq(); rng = new RNG(0x4e11c3); n = 0;
  constructor(fs: number, B: number) { this.fs = fs; this.B = B; }
  montar(Mh: number, load: number) {
    const N = 1024, tab = this.tabB;
    const kap = 0.1 + 2.6 * Math.pow(Math.max(0.02, 1 - Mh), 1.3);
    tab.fill(0);
    for (let h = 1; h <= 16; h++) {
      const a = Math.exp(-(h - 1) * kap);
      if (a < 1e-4) break;
      const th = 0.35 * Mh * Mh;
      for (let i = 0; i < N; i++) { const ph = (h * i) / N; tab[i] += a * (load * Math.sin(2 * Math.PI * ph) - th * Math.sin(2 * Math.PI * (ph + 0.25))); }
    }
    let m = 0; for (let i = 0; i < N; i++) m += tab[i] * tab[i];
    const nrm = 1 / Math.sqrt(m / N + 1e-12);
    for (let i = 0; i < N; i++) tab[i] *= nrm;
    this.tabB = this.tab; this.tab = tab;
    this.bb.bp(this.fs, this.fBB, 0.7);
  }
  preencher(out: Float32Array, n: number) {
    const d = this.fp / this.fs, tb = this.tab;
    for (let k = 0; k < n; k++) {
      this.fase += d; if (this.fase >= 1) this.fase -= 1;
      const x = ((this.fase * this.B) % 1) * 1024, i = x | 0, f = x - i;
      const y = tb[i] + (tb[(i + 1) & 1023] - tb[i]) * f;
      out[k] = this.a * y + this.aBB * this.bb.run(this.rng.bi());
    }
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
  nTab = 0;
  constructor(fs: number, cfg: Partial<ConfigHelice> = {}) {
    const c = { ...HELICE_PADRAO, ...cfg };
    const corpo: Corpo = { segmentos: [{ comprimento: 27, vao: 0, altura: 3, largura: 2.8, zPiso: 1 }], comprimento: 27, nariz: 3, cauda: 6, areaFrontal: 8, cd: 0.03, cpNariz: 0.05, massaSuperficial: 8, fCabine: 110 };
    super(fs, 'helice', corpo, { posMotor: c.posMotor, rotMotor: 'frente' });
    this.cfg = c;
    this.cargaH = new CargaHelice(c);
    // β em rad; saída do PI em rad, K_p 0,02 rad/%, K_i 0,01 rad/(%·s), 5°/s
    this.gov = new GovernadorPI(0.02, 0.01, c.betaMin, c.betaMax, (5 * Math.PI) / 180, c.betaMin);
    this.omegaLivre = (c.nHelice * c.i * 2 * Math.PI) / 60;
    this.fonte = new FonteHelice(fs, c.B);
    this.propria({ id: 'helice', tipo: 'pa', pos: c.posCubo, dir: { tabela: [-18, -8, -3, 0, -1, -6, -18], eixo: [1, 0, 0], expConv: 3 }, refDist: 30, dentro: false }, this.fonte);
  }
  carga() { return this.cargaH; }

  protected fisica(n: number, dt: number) {
    const c = this.cfg, tb = n * dt, m = this.motor;
    this.cargaH.v = this.cinematica.v;
    const w = m ? m.eixo.omega : this.omegaLivre;
    const nh = (w / c.i) * 60 / (2 * Math.PI);    // rpm da hélice
    if (m) m.comandar({ acelerador: this.cmd.pedal, ignicao: this.cmd.ignicao !== false, partida: !!this.cmd.partida });
    // governador: erro positivo = rápida demais → mais passo
    if (!c.passoFixo) {
      if (nh < 0.6 * c.nHelice) { this.gov.saida = c.betaMin; this.gov.i = c.betaMin; }
      else this.gov.passo((100 * (nh - c.nHelice)) / c.nHelice, tb);
      this.cargaH.beta = this.reverso > 0 ? -this.gov.saida * this.reverso : this.gov.saida;
    }
    // fonte: tabela refeita a cada ~20 ms (8 blocos de controle, como o legado)
    const Mh = machPonta(c.D, nh, this.cinematica.v);
    const pload = (0.3 + 0.7 * this.cmd.pedal) * (1 + 0.8 * this.reverso);
    const on = Math.min(1, Math.max(0, (nh / c.nHelice - 0.05) / 0.25));
    this.fonte.fp = nh / 60;
    this.fonte.a = 9 * Math.pow(Mh / 0.75, 4) * pload * (c.D / 3.9) * on;
    this.fonte.aBB = 0.55 * Math.pow(Mh / 0.75, 5) * (1 + 2 * this.reverso) * (c.D / 3.9) * on * 1.7;
    this.fonte.fBB = 900 + 900 * Mh;
    if (++this.nTab >= Math.max(1, Math.round(0.02 / tb))) { this.nTab = 0; this.fonte.montar(Mh, pload); }
  }

  telemetria(): TelemetriaPortador {
    const c = this.cfg, w = this.motor ? this.motor.eixo.omega : this.omegaLivre, nh = ((w / c.i) * 60) / (2 * Math.PI);
    return { v: this.cinematica.v, s: this.cinematica.s, rpmEixo: (w * 60) / (2 * Math.PI), torqueCarga: this.cargaH.torque(w), rpmHelice: nh, beta: this.cargaH.beta, bpf: (c.B * nh) / 60, machPonta: machPonta(c.D, nh, this.cinematica.v) };
  }
}
