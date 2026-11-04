// Estrondo sônico (CENA.md 6: "copiado sem alteração para scene/estrondo.ts, acionado pelo mesmo critério"):
// `triggerBoom` e `boomSample` do JetDSP (src/engines/turbina/dsp.ts), com a mesma aritmética e um RNG próprio.
// Onda em N (choque de proa, expansão linear, choque de cauda), pico e duração pela regra de Carlson:
//   Δp ≈ 1,9·Ks·p0·(M²−1)^⅛·(l/h)^¾ ;  T ≈ 0,0042·l·M/(M²−1)^⅜·(h/300)^¼ (30–450 ms)
// A saída é em unidades de alto-falante (como no legado: o pico fica perto do máximo, mais fraco quanto mais alto o
// voo); Δp em Pa vai para a telemetria.
import { RNG, BiquadComPiso as Biquad, clamp, PREF } from '../acoustics';

export class Estrondo {
  fs: number;
  rng = new RNG(0xb00e5);
  T = -1; age = 99; dp = 0; dur = 0; dB = 0; amp = 0; s = 0; s2 = 0; k = 0; f = 1; r = 1;
  rumDecay = 0; rumLvl = 0; rumF: Biquad[] = [new Biquad(), new Biquad()]; rumN = 0; rum = 0; crk = 0; crkF = new Biquad();
  constructor(fs: number) { this.fs = fs; }
  get ativo() { return this.T >= 0; }

  disparar(M: number, h: number, l = 30, ks = 0.09) {
    const m2 = Math.max(0.02, M * M - 1), fs = this.fs, rng = this.rng;
    const dp = 1.9 * ks * 101325 * Math.pow(m2, 1 / 8) * Math.pow(l / h, 0.75);
    const T = clamp((0.0042 * l * M) / Math.pow(m2, 3 / 8) * Math.pow(h / 300, 0.25), 0.03, 0.45);
    this.dp = dp; this.dur = T; this.T = 0; this.age = 0;
    this.dB = 20 * Math.log10(dp / PREF);
    this.amp = 0.95 * clamp(Math.pow(dp / 600, 0.35), 0.3, 1);
    this.s = 0; this.s2 = 0;
    const rise = 0.0003 + 0.002 * Math.pow(h / 1000, 1.3);
    this.k = 1 - Math.exp(-3.4 / (rise * fs));
    this.f = 0.8 + 0.55 * rng.next(); this.r = 0.8 + 0.55 * rng.next();
    this.rumDecay = Math.exp(-1 / ((0.3 + 0.9 * Math.min(1, h / 1500)) * fs));
    this.rumLvl = 0.07 + 0.16 * Math.min(1, h / 1500);
    const fc = 70 + 110 * Math.pow(300 / h, 0.5);
    this.rumF = [new Biquad().lp(fs, fc, 0.7), new Biquad().lp(fs, fc * 1.6, 0.6)];
    this.rumN = 1.732 / Math.sqrt((1.11 * fc) / (fs / 2));
    this.rum = 0; this.crk = 0;
    this.crkF = new Biquad().hp(fs, 1200, 0.7);
  }

  amostra() {
    const fs = this.fs, n = this.T, t = n / fs, T = this.dur, rng = this.rng;
    let p = 0;
    if (t < T) p = this.f * (1 - t / T) - this.r * (t / T);
    if (n === 0 || n === Math.round(T * fs)) { this.rum += 1; this.crk = 0.6 + 0.6 * rng.next(); }
    this.crk *= 0.995;
    const tgt = p * this.amp;
    this.s += this.k * (tgt - this.s);
    this.s2 += this.k * (this.s - this.s2);
    this.rum *= this.rumDecay;
    const nz = rng.bi();
    const rum = this.rumF[1].run(this.rumF[0].run(nz)) * this.rumN * this.rum * this.rumLvl * this.amp;
    this.T++;
    if (t > T + 0.2 && this.rum < 1e-3) this.T = -1;
    const crk = this.crkF.run(rng.bi()) * this.crk * 0.14 * this.amp;
    return this.s2 + rum + crk;
  }
}
