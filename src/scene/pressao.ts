// Campo próximo aerodinâmico (CENA.md 2.6, 2.8 e 2.10): onda de nariz e cauda, onda de compressão do
// túnel, vento induzido no ouvinte e vento do pistão. Nada disto passa pelo anel de propagação: viaja
// com o corpo (nariz/cauda), ou é uma onda plana no túnel, ou está no próprio ouvinte (vento).
//
// Dois destinos (decisão 2.6): a pressão inteira vai para a telemetria (`pressaoPa`); para o alto-falante
// só o resíduo acima de 20 Hz (passa-alta de 2 polos), mais o ruído do vento.
import { RHO, C_SOM } from './constantes';
import { Bq, k1 } from './filtros';
import { RNG } from '../acoustics/rng';

/** pico a pico de x·e^(−x²/2): 2·e^(−1/2) */
const PP_GAUSS = 2 * Math.exp(-0.5);

/**
 * Onda de nariz/cauda: p_n = −Δp·x·e^(−x²/2), x = (t − t_n)/σ, σ = L_nariz/(3v), positivo antes
 * (o nariz chegando empurra o ar) e negativo depois; a cauda repete com o sinal trocado e 70%.
 * Com ξ = quanto o nariz já passou do ouvinte (m), x = ξ/(σv) = 3ξ/L_nariz: só geometria.
 *   Δp_pp = c_p·½ρv²·(1 m/d)^1,5, d = distância do ouvinte à lateral do corpo.
 */
export function ondaNariz(xiNariz: number, xiCauda: number, v: number, d: number, cp: number, lNariz: number, lCauda: number) {
  if (v <= 0.1) return 0;
  const q = 0.5 * RHO * v * v;
  const pp = cp * q * Math.pow(1 / Math.max(d, 0.5), 1.5);
  const A = pp / PP_GAUSS;
  const xn = (3 * xiNariz) / Math.max(lNariz, 1), xc = (3 * xiCauda) / Math.max(lCauda, 1);
  return -A * xn * Math.exp(-0.5 * xn * xn) + 0.7 * A * xc * Math.exp(-0.5 * xc * xc);
}

/** Pressão de pico a pico prevista pela fórmula de 2.6 (para os testes e o mostrador). */
export const pressaoPP = (v: number, d: number, cp: number) => cp * 0.5 * RHO * v * v * Math.pow(1 / Math.max(d, 0.5), 1.5);

/**
 * Onda de compressão do túnel (Hara, baixo Mach), 2.10:
 *   Δp_e ≈ 0,75·½ρv²·(1 − (1−β)²)/(1−β)², β = areaFrontal/area
 * gerada quando o nariz entra na boca; chega ao ouvinte a (x_O − x_entrada)/c, reflete na outra boca
 * com sinal invertido e volta (período 2L/c), perdendo 20% por reflexão. Subida de L_nariz/v (meio cosseno).
 */
export class OndaTunel {
  tEntrada = -1;          // s, instante em que o nariz entrou (−1: ainda não)
  dp = 0;                 // Pa
  subida = 0.15;          // s
  dist = 500;             // m da boca ao ouvinte
  comp = 2000;            // m do túnel
  beta = 0;
  uFrente = 0;            // m/s, ar empurrado à frente pela onda: Δp/(ρc)
  zerar() { this.tEntrada = -1; this.dp = 0; }

  /** marca a entrada do nariz no túnel */
  entrar(t: number, v: number, areaFrontal: number, area: number, lNariz: number, dist: number, comp: number) {
    const b = Math.min(0.6, areaFrontal / area), u = 1 - b;
    this.beta = b;
    this.dp = 0.75 * 0.5 * RHO * v * v * (1 - u * u) / (u * u);
    this.subida = Math.max(0.02, lNariz / Math.max(v, 1));
    this.tEntrada = t; this.dist = dist; this.comp = comp;
    this.uFrente = this.dp / (RHO * C_SOM);
  }

  /** pressão (Pa) no ouvinte no instante t */
  pressao(t: number) {
    if (this.tEntrada < 0) return 0;
    const t0 = t - this.tEntrada, per = (2 * this.comp) / C_SOM;
    const tA = this.dist / C_SOM;                            // frente direta
    const tB = (2 * this.comp - this.dist) / C_SOM;          // refletida na boca de saída (invertida)
    let p = 0, a = 1;
    for (let k = 0; k < 12; k++) {
      const ta = tA + k * per, tb = tB + k * per;
      if (t0 < ta) break;
      p += a * this.degrau(t0 - ta);
      a *= 0.8;
      if (t0 < tb) break;
      p -= a * this.degrau(t0 - tb);
      a *= 0.8;
    }
    return p * this.dp;
  }
  /** instante (s, desde a entrada) em que a frente direta chega ao ouvinte */
  chegada() { return this.dist / C_SOM; }
  private degrau(x: number) { return x >= this.subida ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * x) / this.subida); }
}

/**
 * Ruído do vento nos ouvidos (2.8): L = 70 + 60·log₁₀(u/10) dB, passa-baixa de 150 Hz e um ombro
 * a −12 dB em 1 kHz, independente em cada ouvido, com passa-alta de 20 Hz. Sem propagação.
 */
export class RuidoVento {
  fs: number;
  rL: RNG; rR: RNG;
  lp: Bq[]; om: Bq[]; hp: Bq[];
  norma: number;            // 1/rms do ruído formatado para entrada uniforme
  u = 0; uAlvo = 0; kU: number;
  constructor(fs: number, semente = 0x5e17a) {
    this.fs = fs;
    this.rL = new RNG(semente); this.rR = new RNG(semente ^ 0x9e3779b9);
    this.lp = [new Bq().lp(fs, 150, 0.6), new Bq().lp(fs, 150, 0.6)];
    this.om = [new Bq().bp(fs, 1000, 0.8), new Bq().bp(fs, 1000, 0.8)];
    this.hp = [new Bq().hp(fs, 20, 0.7071), new Bq().hp(fs, 20, 0.7071)];
    this.kU = k1(fs, 4);
    // rms do ruído formatado (uniforme de variância 1/3): integra |H|² na frequência
    let p = 0; const df = 2, s3 = Math.pow(10, -12 / 20);   // ombro: bp de pico 1 com −12 dB
    const lp = new Bq().lp(fs, 150, 0.6), om = new Bq().bp(fs, 1000, 0.8), hp = new Bq().hp(fs, 20, 0.7071);
    for (let f = df / 2; f < fs / 2; f += df) {
      const h = hp.mag2(fs, f);
      p += (lp.mag2(fs, f) + s3 * s3 * om.mag2(fs, f)) * h * df;
    }
    const varU = 1 / 3;
    this.norma = 1 / Math.sqrt((p * varU) / (fs / 2));
  }
  /** pressão RMS (Pa) do vento a u m/s */
  static rms(u: number) { if (u < 0.3) return 0; return 2e-5 * Math.pow(10, (70 + 60 * Math.log10(u / 10)) / 20); }
  /** soma n amostras do vento em L e R (Pa) */
  somar(L: Float64Array, R: Float64Array, n: number) {
    const s3 = Math.pow(10, -12 / 20);
    for (let k = 0; k < n; k++) {
      this.u += this.kU * (this.uAlvo - this.u);
      const g = RuidoVento.rms(this.u) * this.norma;
      if (g === 0) continue;
      const nl = this.rL.bi(), nr = this.rR.bi();
      L[k] += g * this.hp[0].run(this.lp[0].run(nl) + s3 * this.om[0].run(nl));
      R[k] += g * this.hp[1].run(this.lp[1].run(nr) + s3 * this.om[1].run(nr));
    }
  }
}

/** Vento induzido a céu aberto (2.8): u = u₀·(v/v_ref)·(1 m/d)^0,7·w(t), u₀ = 10 m/s a 300 km/h. */
export function ventoInduzido(v: number, d: number) { return 10 * (Math.abs(v) / (300 / 3.6)) * Math.pow(1 / Math.max(d, 0.5), 0.7); }

/** Vento do pistão no túnel durante a passagem do corpo: u_a = v·β/(1−β)·0,75 */
export function ventoPistao(v: number, beta: number) { return Math.abs(v) * beta / (1 - beta) * 0.75; }
