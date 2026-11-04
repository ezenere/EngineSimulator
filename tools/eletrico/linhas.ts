// Medida de linhas (porte de doremi.py, ridges.py e ordens.py do projetista, eletrico-analise/): pico de uma faixa a
// cada passo com janela de Hann e interpolação parabólica no dB, patamares (frames seguidos dentro de 1,5%), picos de um
// trecho por proeminência. Os .py originais estão em tools/eletrico/analise/ (rodam com `python3 -I` sobre as gravações).
import { fft, SR } from './comum';

const pot2 = (n: number) => { let p = 1; while (p < n) p <<= 1; return p; };

export interface Quadro { t: number; f: number; rel: number }
/**
 * Pico entre fa e fb a cada `passo` s, janela de `jan` s (doremi.py: 170 ms, 50 ms), com o nível do tom relativo ao total
 * de 100 Hz–6 kHz (dB). NaN quando não há pico com proeminência de 6 dB.
 */
export function rastrear(x: ArrayLike<number>, t0: number, t1: number, fa: number, fb: number, jan = 8192 / 48000, passo = 0.05): Quadro[] {
  const n = Math.round(jan * SR), N = pot2(n), out: Quadro[] = [];
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  const re = new Float64Array(N), im = new Float64Array(N), P = new Float64Array(N / 2 + 1);
  for (let t = t0; t + jan <= t1; t += passo) {
    const i0 = Math.round(t * SR);
    re.fill(0); im.fill(0);
    for (let i = 0; i < n; i++) re[i] = (x[i0 + i] ?? 0) * w[i];
    fft(re, im);
    for (let k = 0; k <= N / 2; k++) P[k] = 10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-30);
    const ka = Math.ceil((fa * N) / SR), kb = Math.floor((fb * N) / SR);
    let best = -1, bv = -Infinity;
    for (let k = ka + 1; k < kb; k++) {
      if (P[k] <= P[k - 1] || P[k] < P[k + 1]) continue;
      // proeminência ≥ 6 dB: o menor dos vales dos dois lados até um ponto mais alto
      let l = P[k], r = P[k];
      for (let j = k - 1; j >= ka && P[j] <= P[k]; j--) l = Math.min(l, P[j]);
      for (let j = k + 1; j <= kb && P[j] <= P[k]; j++) r = Math.min(r, P[j]);
      if (P[k] - Math.max(l, r) < 6) continue;
      if (P[k] > bv) { bv = P[k]; best = k; }
    }
    let tot = 0;
    for (let k = Math.round((100 * N) / SR); k < Math.round((6000 * N) / SR); k++) tot += Math.pow(10, P[k] / 10);
    if (best < 0) { out.push({ t: t + jan / 2, f: NaN, rel: -99 }); continue; }
    const a = P[best - 1], b = P[best], c = P[best + 1], d = a - 2 * b + c !== 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
    out.push({ t: t + jan / 2, f: ((best + d) * SR) / N, rel: b - 10 * Math.log10(tot) });
  }
  return out;
}

export interface Patamar { f: number; t: number; dur: number; rel: number }
/** patamares: quadros seguidos dentro de 1,5% da mediana corrente, com pelo menos `min` quadros */
export function patamares(q: Quadro[], min = 4, passo = 0.05): Patamar[] {
  const med = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[s.length >> 1]; };
  const out: Patamar[] = [];
  let cur: Quadro[] = [];
  const fecha = () => { if (cur.length >= min) out.push({ f: med(cur.map((c) => c.f)), t: cur[0].t, dur: cur[cur.length - 1].t - cur[0].t + passo, rel: cur.reduce((a, c) => a + c.rel, 0) / cur.length }); cur = []; };
  for (const x of q) {
    if (!Number.isFinite(x.f)) { fecha(); continue; }
    if (cur.length && Math.abs(x.f - med(cur.map((c) => c.f))) / x.f > 0.015) fecha();
    cur.push(x);
  }
  fecha();
  return out;
}

/** picos de um espectro médio (Welch) entre fa e fb com proeminência ≥ `prom` dB: [f, dB rel. ao maior] */
export function picos(f: Float64Array, P: Float64Array, fa: number, fb: number, prom = 8, n = 18): [number, number][] {
  const L = Array.from(P, (p) => 10 * Math.log10(p + 1e-30));
  const idx: number[] = [];
  for (let k = 1; k < f.length - 1; k++) {
    if (f[k] < fa || f[k] > fb || L[k] <= L[k - 1] || L[k] < L[k + 1]) continue;
    let l = L[k], r = L[k];
    for (let j = k - 1; j > 0 && L[j] <= L[k] && f[j] >= fa; j--) l = Math.min(l, L[j]);
    for (let j = k + 1; j < f.length && L[j] <= L[k] && f[j] <= fb; j++) r = Math.min(r, L[j]);
    if (L[k] - Math.max(l, r) >= prom) idx.push(k);
  }
  const top = idx.sort((a, b) => L[b] - L[a]).slice(0, n);
  const mx = top.length ? L[top[0]] : 0;
  return top.sort((a, b) => a - b).map((k) => [f[k], L[k] - mx]);
}
