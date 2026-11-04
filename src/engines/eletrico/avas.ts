// AVAS / VSP genérico (ELETRICO.md 2, decisão 6: nada que imite uma marca). UE/UNECE R138: de 0 a 20 km/h e em ré,
// 50 dB(A) a 10 km/h e 56 a 20 km/h a 2 m, deslocamento de frequência ≥ 0,8% por km/h; EUA FMVSS 141: até 30 km/h, ≥ 1%
// por km/h. Três componentes: tom composto de 3 parciais inarmônicas (f₁ = 250 Hz, 1,62·f₁, 2,41·f₁ a 0, −4, −8 dB) com
// f₁·(1 + 0,012·v) e vibrato de 0,15 Hz ±0,5%; ruído bp 1 kHz (Q 0,6) modulado a 0,8 Hz ±2 dB, +3 dB por 10 km/h; ritmo
// de um pulso por 2 m percorridos (60 ms, −6 dB). Nível no para-choque L_W = 74 + 0,6·v dB(A); liga com a ignição abaixo
// de 20 km/h (30 no `eua`) e desliga com rampa de 2 s acima. Em ré: f₁ = 200 Hz e um pulso a 1,5 Hz.
//
// Calibração analítica em L_W (sem sonda): a potência ponderada A das parciais (ganhoA) mais a do ruído (rmsCadeia com
// ponderação A), corrigida pelo fator de potência da diretividade do alto-falante (a fonte sobe no eixo pelo índice de
// diretividade, como as fontes dos portadores).
import { RNG } from '../../acoustics/rng';
import { Bq, ganhoA, rmsCadeia, fatorPotenciaDir } from '../../scene/filtros';
import { paDeLw } from '../../carriers/ruido';
import { TAU, MEC, chave, DIR_AVAS, REF_DIST_ELETRICO } from './constantes';
import type { ListaLinhas } from './linhas';

export type ModoAvas = 'ue' | 'eua' | null;
const dB = (x: number) => Math.pow(10, x / 20);
const PARC = [[1, 0], [1.62, -4], [2.41, -8]] as const;

export class Avas {
  fs: number; modo: ModoAvas;
  ruidoBq: Bq; norm: number; rmsRuidoA: number; rng: RNG;
  env = 0;          // 0..1 (liga/desliga com rampas)
  fVib = 0; fMod = 0; fRit = 0; ritmo = 0; ritmoRest = 0; nRit: number;
  re = false;
  /** Pa RMS do tom e do ruído no bloco (no eixo, a refDist) */
  aTom = 0; gRuido = 0; gRuido0 = 0;
  f1 = 250;
  fp: number;
  constructor(fs: number, modo: ModoAvas, semente = 0xa7a5) {
    this.fs = fs; this.modo = modo; this.rng = new RNG(semente);
    this.ruidoBq = new Bq().bp(fs, 1000, 0.6);
    this.norm = 1 / rmsCadeia(fs, [this.ruidoBq], 1 / 3, false, 4);
    this.rmsRuidoA = rmsCadeia(fs, [this.ruidoBq], 1 / 3, true, 4) * this.norm;   // RMS A do ruído normalizado a RMS 1
    this.nRit = Math.round(0.06 * fs);
    this.fp = 1 / Math.sqrt(fatorPotenciaDir(DIR_AVAS));
  }
  /** limite de velocidade em que o AVAS desliga (km/h) */
  limite() { return this.modo === 'eua' ? 30 : 20; }
  /**
   * Um bloco de controle: velocidade (m/s, com sinal: ré < 0 ou `re`), ignição, dt. Preenche as parciais na lista e
   * acerta o nível do ruído; o ritmo é aplicado no `processar`.
   */
  linhas(v: number, ignicao: boolean, dt: number, L: ListaLinhas) {
    const kmh = Math.abs(v) * 3.6, re = this.re || v < -0.05;
    const on = this.modo !== null && ignicao && (re || kmh < this.limite());
    // liga em 0,2 s, desliga em 2 s
    this.env += on ? dt / 0.2 : -dt / 2;
    this.env = Math.max(0, Math.min(1, this.env));
    this.fVib += 0.15 * dt; if (this.fVib >= 1) this.fVib -= 1;
    this.fMod += 0.8 * dt; if (this.fMod >= 1) this.fMod -= 1;
    const vib = 1 + 0.005 * Math.sin(TAU * this.fVib);
    const f1 = (re ? 200 : 250 * (1 + 0.012 * kmh)) * vib;
    this.f1 = f1;
    // nível no eixo: L_W = 74 + 0,6·v dB(A), dividido entre tom (−1 dB) e ruído (−7 dB) (≈)
    const paA = paDeLw(74 + 0.6 * kmh, REF_DIST_ELETRICO) * this.fp * this.env;
    let eA = 0;
    for (const [r, d] of PARC) { const a = dB(d) * Math.max(0.00316, ganhoA(r * f1)); eA += a * a; }
    const gTom = (paA * dB(-1)) / Math.sqrt(eA);
    this.aTom = gTom;
    for (let i = 0; i < PARC.length; i++) L.por(chave(MEC.avas, i + 1), PARC[i][0] * f1, gTom * dB(PARC[i][1]) * Math.SQRT2);
    const mod = dB(2 * Math.sin(TAU * this.fMod)) * dB(3 * Math.min(2, kmh / 10));
    this.gRuido0 = this.gRuido;
    this.gRuido = ((paA * dB(-7)) / this.rmsRuidoA) * mod * this.norm;
    // ritmo: um pulso por 2 m percorridos (em ré, a 1,5 Hz)
    this.fRit = re ? 1.5 : Math.abs(v) / 2;
  }
  /** soma o ruído e o pulso do ritmo (uma senoide de f₁ com janela de 60 ms, −6 dB) */
  processar(out: Float32Array, off: number, n: number, pos: number, tot: number) {
    if (this.env <= 0 && this.gRuido0 === 0) return;
    const r = this.rng, b = this.ruidoBq, g0 = this.gRuido0, dg = (this.gRuido - this.gRuido0) / tot;
    const dr = this.fRit / this.fs, w = (TAU * this.f1) / this.fs, aP = this.aTom * Math.SQRT2 * dB(-6);
    for (let k = 0; k < n; k++) {
      let y = (g0 + dg * (pos + k + 1)) * b.run(r.bi());
      this.ritmo += dr;
      if (this.ritmo >= 1) { this.ritmo -= 1; this.ritmoRest = this.nRit; }
      if (this.ritmoRest > 0) { const t = 1 - this.ritmoRest / this.nRit; y += aP * Math.sin(Math.PI * t) * Math.sin(w * this.ritmoRest); this.ritmoRest--; }
      out[off + k] += y;
    }
  }
}
