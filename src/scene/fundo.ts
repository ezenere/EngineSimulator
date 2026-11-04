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
  rafada = 0; rafAlvo = 0; t = 0; mFase = 0;
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
  /** soma n amostras (Pa) em L e R */
  somar(L: Float64Array, R: Float64Array, n: number) {
    if (!this.gV && !this.gVe && !this.gM) return;
    const r = this.r;
    for (let k = 0; k < n; k++) {
      // rajadas: alvo aleatório a cada ~2 s
      this.t += 1 / this.fs;
      if (this.t > 2) { this.t = 0; this.rafAlvo = r[3].next(); }
      this.rafada += 0.00005 * (this.rafAlvo - this.rafada);
      this.mFase += 0.7 / this.fs; if (this.mFase > 1) this.mFase -= 1;
      for (let ch = 0; ch < 2; ch++) {
        const n0 = r[ch].bi(), n1 = r[ch + 1 === 2 ? 2 : ch + 1].bi();
        let y = 0;
        if (this.gV) { const v = this.vento[ch]; y += this.gV * this.nV * (0.6 + 0.8 * this.rafada) * v[1].run(v[0].run(n0)); }
        if (this.gVe) { const v = this.vent[ch]; y += this.gVe * this.nVe * (v[0].run(n1) + v[1].run(n1) + 0.5 * v[2].run(n1)); }
        if (this.gM) { const v = this.mur[ch]; y += this.gM * this.nM * (0.8 + 0.2 * Math.sin(6.2832 * this.mFase + ch)) * v[1].run(v[0].run(n0)); }
        if (ch === 0) L[k] += y; else R[k] += y;
      }
    }
  }
}
