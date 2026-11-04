// Som de fundo do ambiente (o que hoje é setAmbience nos apps legados): vento, ventilação do túnel,
// murmúrio de gente na estação. Independe do corpo, não passa pela propagação, é independente em cada
// ouvido. Níveis em dB SPL (EspecFundo). A ventilação é ruído estreito em 100 e 120 Hz (Q ≈ 7) e no
// dobro (Q ≈ 9), como o `tunnel` do Ronco depois da revisão (era um seno parado).
import type { EspecFundo } from './tipos';
import { RNG } from '../acoustics/rng';
import { Bq, rmsCadeia } from './filtros';
import { P_REF } from './constantes';

const pa = (db: number) => (db > 0 ? P_REF * Math.pow(10, db / 20) : 0);

export class FundoAmbiente {
  fs: number;
  r: RNG[];
  vento: Bq[][]; vent: Bq[][]; mur: Bq[][];
  gV = 0; gVe = 0; gM = 0;
  nV: number; nVe: number; nM: number;
  constructor(fs: number, semente = 0xf0d0) {
    this.fs = fs;
    this.r = [new RNG(semente), new RNG(semente + 101), new RNG(semente + 202), new RNG(semente + 303)];
    const v = () => [new Bq().lp(fs, 260, 0.6), new Bq().hp(fs, 40, 0.6)];
    const ve = () => [new Bq().bp(fs, 100, 7), new Bq().bp(fs, 120, 7), new Bq().bp(fs, 200, 9)];
    const mu = () => [new Bq().bp(fs, 450, 0.7), new Bq().lp(fs, 2500, 0.7)];
    this.vento = [v(), v()]; this.vent = [ve(), ve()]; this.mur = [mu(), mu()];
    this.nV = 1 / rmsCadeia(fs, this.vento[0]);
    const b = this.vent[0];
    this.nVe = 1 / Math.sqrt(rmsCadeia(fs, [b[0]]) ** 2 + rmsCadeia(fs, [b[1]]) ** 2 + 0.25 * rmsCadeia(fs, [b[2]]) ** 2);
    this.nM = 1 / rmsCadeia(fs, this.mur[0]);
  }
  definir(f: EspecFundo) { this.gV = pa(f.vento); this.gVe = pa(f.ventilacao); this.gM = pa(f.murmurio); }
  /** soma n amostras (Pa) em L e R (filtros em bloco: nada é alocado) */
  somar(L: Float64Array, R: Float64Array, n: number) {
    if (!this.gV && !this.gVe && !this.gM) return;
    const r = this.r, gV = this.gV * this.nV, gVe = this.gVe * this.nVe, gM = this.gM * this.nM, dt = 1 / this.fs;
    const e = this.est, a = this.tA, b = this.tB, c = this.tC, m = this.tM;
    // envoltórias (rajada e murmúrio) por amostra, num buffer
    let t = e[0], raf = e[1], alvo = e[2], fase = e[3];
    for (let k = 0; k < n; k++) {
      t += dt;
      if (t > 2) { t = 0; alvo = r[3].next(); }
      raf += 0.00005 * (alvo - raf);
      fase += 0.7 * dt; if (fase > 1) fase -= 1;
      m[k] = raf; m[2048 + k] = fase;
    }
    e[0] = t; e[1] = raf; e[2] = alvo; e[3] = fase;
    for (let ch = 0; ch < 2; ch++) {
      const O = ch === 0 ? L : R, r0 = r[ch], r1 = r[ch === 0 ? 1 : 2];
      if (gV || gM) {
        for (let k = 0; k < n; k++) { const v = r0.bi(); a[k] = v; c[k] = v; }
        if (gV) { const f = this.vento[ch]; f[0].bloco(a, n); f[1].bloco(a, n); for (let k = 0; k < n; k++) O[k] += gV * (0.6 + 0.8 * m[k]) * a[k]; }
        if (gM) { const f = this.mur[ch]; f[0].bloco(c, n); f[1].bloco(c, n); for (let k = 0; k < n; k++) O[k] += gM * (0.8 + 0.2 * Math.sin(6.2832 * m[2048 + k] + ch)) * c[k]; }
      }
      if (gVe) {
        const f = this.vent[ch];
        for (let k = 0; k < n; k++) { const v = r1.bi(); a[k] = v; b[k] = v; c[k] = v; }
        f[0].bloco(a, n); f[1].bloco(b, n); f[2].bloco(c, n);
        for (let k = 0; k < n; k++) O[k] += gVe * (a[k] + b[k] + 0.5 * c[k]);
      }
    }
  }
  /** [t, rajada, alvo da rajada, fase do murmúrio] */
  est = new Float64Array(4);
  tA = new Float64Array(2048); tB = new Float64Array(2048); tC = new Float64Array(2048); tM = new Float64Array(4096);
}
