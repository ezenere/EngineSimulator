// Medidas do rotativo (ROTATIVO.md 3 e Apêndice A): porta em TypeScript de medir_w.py, picos.py e pops.py, os scripts do
// projetista (scratchpad/wankeltools/). Reaproveita a FFT, o Welch, a mediana, as bandas e o passa-faixa do radial.
//  - f_ign pela autocorrelação da envoltória 150–4 000 Hz em janelas de 1 s, refinada por pente de 4 harmônicos (±6%),
//    restrita a [fmin, fmax]; `vagar` = desvio/mediana das f_ign por janela (%);
//  - bandas em dB relativas a 150–400 Hz (Welch 8192), centroide 100–8 000 Hz, e a banda 1–4 kHz;
//  - linhas (dB de pico sobre a mediana de 61 pontos, Welch 32768, ±4%) nas ordens do eixo 1/3, 2/3, 1 e na ignição
//    (rotores·rpm/60), 2× e 3×;
//  - CVciclo (RMS por período de ignição) e CVlento (por 0,25 s) da banda 0,7–4·f_ign;
//  - p90/p10 da envoltória de 1–6 kHz (contraste do agudo) e estouros/s (picos isolados da envoltória 1–6 kHz mais de
//    10 dB sobre a mediana móvel de 0,3 s, espaçados ≥ 25 ms).
//
//   npx tsx tools/rotativo-bandas.ts "nome:arquivo.wav:t0:t1:rotores:fmin:fmax" ...
import { fft, welch, medfilt, bandas, passaFaixa, lerWavMono, BANDAS } from './radial-bandas';

export { lerWavMono, BANDAS };

/** passa-baixa Butterworth de ordem 2 em ida e volta (|H|² = 1/(1 + (f/fc)⁴)) no domínio da frequência */
function passaBaixa(x: Float64Array, sr: number, fc: number) {
  let n = 1; while (n < x.length) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  re.set(x); fft(re, im);
  for (let k = 0; k < n; k++) { const f = (Math.min(k, n - k) * sr) / n, g = 1 / (1 + Math.pow(f / fc, 4)); re[k] *= g; im[k] *= g; }
  fft(re, im, true);
  return re.slice(0, x.length);
}

/** módulo do sinal analítico (Hilbert pela FFT) */
function hilbertAbs(y: ArrayLike<number>) {
  let n = 1; while (n < y.length) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < y.length; i++) re[i] = y[i];
  fft(re, im);
  for (let k = 1; k < n / 2; k++) { re[k] *= 2; im[k] *= 2; }
  for (let k = n / 2 + 1; k < n; k++) { re[k] = 0; im[k] = 0; }
  fft(re, im, true);
  const e = new Float64Array(y.length);
  for (let i = 0; i < y.length; i++) e[i] = Math.hypot(re[i], im[i]);
  return e;
}

/** envoltória de uma banda (o `envelope` do medir_w.py) */
export function envoltoria(seg: Float64Array, sr: number, lo: number, hi: number, lp = 400) {
  const y = passaFaixa(seg, sr, lo, Math.min(hi, 0.45 * sr));
  const e = passaBaixa(hilbertAbs(y), sr, lp);
  for (let i = 0; i < e.length; i++) if (e[i] < 0) e[i] = 0;
  return e;
}

/** frequência pela autocorrelação da envoltória: o primeiro pico com ≥ 60% do maior em [fmin, fmax] */
function fAcf(env: Float64Array, sr: number, fmin: number, fmax: number) {
  const n = env.length; let m = 0; for (const v of env) m += v; m /= n;
  let N2 = 1; while (N2 < 2 * n) N2 <<= 1;
  const re = new Float64Array(N2), im = new Float64Array(N2);
  for (let i = 0; i < n; i++) re[i] = env[i] - m;
  fft(re, im);
  for (let k = 0; k < N2; k++) { re[k] = re[k] * re[k] + im[k] * im[k]; im[k] = 0; }
  fft(re, im, true);
  const a0 = re[0] + 1e-30, lmin = Math.floor(sr / fmax), lmax = Math.floor(sr / fmin);
  const seg = Float64Array.from({ length: Math.max(0, lmax - lmin) }, (_, i) => re[lmin + i] / a0);
  const pk: number[] = [];
  for (let i = 1; i < seg.length - 1; i++) if (seg[i] > seg[i - 1] && seg[i] >= seg[i + 1]) pk.push(i);
  if (!pk.length) return NaN;
  let best = pk[0]; for (const k of pk) if (seg[k] > seg[best]) best = k;
  for (const k of pk) if (seg[k] >= 0.6 * seg[best]) { best = k; break; }
  return sr / (best + lmin);
}

/** pente de 4 harmônicos a ±6% (passo 0,05 Hz) sobre o espectro branqueado pela mediana de 41 pontos */
function pente(seg: Float64Array, sr: number, f0: number, nh = 4, tol = 0.06) {
  const [f, P] = welch(seg, sr, 16384);
  const M = medfilt(P, 41), df = f[1] - f[0];
  const W = (x: number) => { const i = Math.floor(x / df); if (i < 0 || i >= f.length - 1) return 1e-9; const a = x / df - i; return (P[i] / (M[i] + 1e-30)) * (1 - a) + (P[i + 1] / (M[i + 1] + 1e-30)) * a; };
  let best = -Infinity, bf = f0;
  for (let fc = (1 - tol) * f0; fc < (1 + tol) * f0; fc += 0.05) {
    let s = 0; for (let h = 1; h <= nh; h++) s += Math.log(W(h * fc) + 1e-9);
    if (s > best) { best = s; bf = fc; }
  }
  return bf;
}

/** picos com altura mínima e distância mínima (o `find_peaks` do scipy: os mais altos primeiro) */
function picos(x: Float64Array, h: number, dist: number) {
  const c: number[] = [];
  for (let i = 1; i < x.length - 1; i++) if (x[i] > x[i - 1] && x[i] >= x[i + 1] && x[i] >= h) c.push(i);
  c.sort((a, b) => x[b] - x[a]);
  const ok: number[] = [], usado = new Uint8Array(x.length);
  for (const i of c) {
    if (usado[i]) continue;
    ok.push(i);
    for (let j = Math.max(0, i - dist + 1); j < Math.min(x.length, i + dist); j++) usado[j] = 1;
  }
  return ok.sort((a, b) => a - b);
}

const pct = (x: Float64Array, p: number) => { const s = Float64Array.from(x).sort(); return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))]; };

export type MedidaRot = {
  rpm: number; vagar: number; fIgn: number; fs: number[];
  /** bandas dB rel. 150–400: 60–150, 150–400, 400–1k, 1–2,5k, 2,5–6k, 6–12k, e 1–4k */
  b: number[]; b14: number; cent: number;
  /** potência absoluta de cada banda (dB, 60–150 … 6–12k) */
  abs: number[];
  o13: number; o23: number; o1: number; ign: number; ign2: number; ign3: number;
  cvCiclo: number; cvLento: number; p9010: number; pops: number;
  linha: (fx: number, tol?: number) => number;
};

/** medida completa de um trecho (o `main` do medir_w.py). `fIgn` fixa a ignição (pula o rastreio). */
export function medirRot(seg0: ArrayLike<number>, sr: number, op: { rotores: number; fmin: number; fmax: number; fIgn?: number }): MedidaRot {
  const seg = Float64Array.from(seg0 as ArrayLike<number>); let m = 0; for (const v of seg) m += v; m /= seg.length; for (let k = 0; k < seg.length; k++) seg[k] -= m;
  const dur = seg.length / sr;
  const fsIgn: number[] = [];
  if (!op.fIgn) {
    const env = envoltoria(seg, sr, 150, 4000);
    for (let t = 0; t + 1 <= dur + 1e-9; t += 1) {
      const a = Math.round(t * sr), b = Math.round((t + 1) * sr);
      const fa = fAcf(env.subarray(a, b), sr, op.fmin, op.fmax);
      if (Number.isFinite(fa)) fsIgn.push(pente(seg.subarray(a, b), sr, fa));
    }
  }
  const ord = [...fsIgn].sort((a, b) => a - b);
  const nf = ord.length;
  const fi = op.fIgn ?? (nf ? (nf % 2 ? ord[(nf - 1) / 2] : 0.5 * (ord[nf / 2 - 1] + ord[nf / 2])) : NaN);
  const mu = fsIgn.reduce((a, b) => a + b, 0) / Math.max(1, fsIgn.length);
  const vagar = fsIgn.length > 1 ? (100 * Math.sqrt(fsIgn.reduce((a, b) => a + (b - mu) ** 2, 0) / fsIgn.length)) / fi : NaN;
  const rpm = (fi * 60) / op.rotores;
  const { b, cent } = bandas(seg, sr);
  // (1–4 kHz, como a 7ª banda do medir_w)
  const [f8, P8] = welch(seg, sr, 8192);
  let r0 = 0, r14 = 0; for (let k = 0; k < f8.length; k++) { if (f8[k] >= 150 && f8[k] < 400) r0 += P8[k]; if (f8[k] >= 1000 && f8[k] < 4000) r14 += P8[k]; }
  const b14 = 10 * Math.log10(r14 / (r0 + 1e-30) + 1e-12);
  const abs = BANDAS.map(([lo, hi]) => { let q = 0; for (let k = 0; k < f8.length; k++) if (f8[k] >= lo && f8[k] < hi) q += P8[k]; return 10 * Math.log10(q + 1e-30); });
  const [f2, P2] = welch(seg, sr, 32768);
  const M2 = medfilt(P2, 61), Wdb = Float64Array.from(P2, (p, k) => 10 * Math.log10(p / (M2[k] + 1e-30) + 1e-12));
  const linha = (fx: number, tol = 0.04) => { let mx = -Infinity; for (let k = 0; k < f2.length; k++) if (f2[k] > fx * (1 - tol) && f2[k] < fx * (1 + tol)) mx = Math.max(mx, Wdb[k]); return mx; };
  const o1 = fi / op.rotores;
  const y = passaFaixa(seg, sr, 0.7 * fi, Math.min(4 * fi, 0.45 * sr));
  const cv = (n: number) => { const q = Math.floor(y.length / n), r: number[] = []; for (let k = 0; k < q; k++) { let s = 0; for (let j = 0; j < n; j++) s += y[k * n + j] ** 2; r.push(Math.sqrt(s / n)); } const mm = r.reduce((a, c) => a + c, 0) / r.length; return Math.sqrt(r.reduce((a, c) => a + (c - mm) ** 2, 0) / r.length) / mm; };
  // contraste do agudo e estouros
  const e16 = envoltoria(seg, sr, 1000, 6000, 600);
  const p9010 = 20 * Math.log10((pct(e16, 90) + 1e-12) / (pct(e16, 10) + 1e-12));
  const dec = Float64Array.from({ length: Math.floor(e16.length / 48) }, (_, i) => e16[i * 48]);
  const med = medfilt(dec, 301);
  const ratio = Float64Array.from(dec, (v, i) => v / (med[i] + 1e-12));
  const pk = picos(ratio, 3.16, Math.round((0.025 * sr) / 48));
  return {
    rpm, vagar, fIgn: fi, fs: fsIgn, b, b14, cent, abs,
    o13: linha(o1 / 3), o23: linha((2 * o1) / 3), o1: linha(o1), ign: linha(fi), ign2: linha(2 * fi), ign3: linha(3 * fi),
    cvCiclo: cv(Math.max(8, Math.floor(sr / fi))), cvLento: cv(Math.floor(0.25 * sr)), p9010, pops: pk.length / dur, linha,
  };
}

/** estouros por janela (pops.py): [início (s), estouros/s, altura mediana (dB)] */
export function estourosPorJanela(seg: Float64Array, sr: number, jan = 2) {
  const e = envoltoria(seg, sr, 1000, 6000, 600);
  const dec = Float64Array.from({ length: Math.floor(e.length / 48) }, (_, i) => e[i * 48]);
  const med = medfilt(dec, 301), r = Float64Array.from(dec, (v, i) => v / (med[i] + 1e-12));
  const pk = picos(r, 3.16, Math.round((0.025 * sr) / 48));
  const out: [number, number, number][] = [];
  for (let t = 0; t + jan <= seg.length / sr + 1e-9; t += jan) {
    const sel = pk.filter((k) => (k * 48) / sr >= t && (k * 48) / sr < t + jan).map((k) => r[k]).sort((a, b) => a - b);
    out.push([t, sel.length / jan, sel.length ? 20 * Math.log10(sel[Math.floor(sel.length / 2)]) : 0]);
  }
  return out;
}

export const linhaRot = (nome: string, r: MedidaRot) => {
  const v = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : 'nan');
  return `${nome.padEnd(34)} ${v(r.rpm, 0).padStart(5)} ${v(r.vagar).padStart(5)} ${v(r.fIgn).padStart(6)} | ${[r.b[0], r.b[2], r.b[3], r.b[4], r.b[5], r.b14].map((x) => v(x).padStart(6)).join(' ')} ${v(r.cent, 0).padStart(5)} | ${[r.o13, r.o23, r.o1, r.ign, r.ign2, r.ign3].map((x) => v(x).padStart(5)).join(' ')} | ${v(r.cvCiclo, 2)} ${v(r.cvLento, 2)} ${v(r.p9010).padStart(5)} ${v(r.pops).padStart(5)}`;
};
export const CABECALHO = `${'trecho'.padEnd(34)}   rpm vagar  f_ign | 60-150 400-1k 1-2.5k 2.5-6k  6-12k   1-4k  cent |  o1/3  o2/3    o1   ign  2ign  3ign | CVc  CVl  p9010 pop/s`;

const ehCli = process.argv[1] && process.argv[1].endsWith('rotativo-bandas.ts');
if (ehCli) {
  console.log(CABECALHO);
  for (const spec of process.argv.slice(2)) {
    const [nome, arq, t0, t1, R, fmin, fmax] = spec.split(':');
    const { x, sr } = lerWavMono(arq);
    console.log(linhaRot(nome, medirRot(x.subarray(Math.round(+t0 * sr), Math.round(+t1 * sr)), sr, { rotores: +R, fmin: +fmin, fmax: +fmax })));
  }
}
