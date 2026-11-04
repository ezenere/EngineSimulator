// Medidas do radial (RADIAL.md 4 e Apêndice A): porta em TypeScript de medir2.py, o script do projetista.
//  - rpm e vagar: f_ign rastreada em janelas de 1 s (pente de 4 harmônicos a ±12% da âncora, Welch 16384, espectro
//    branqueado pela mediana de 41 pontos);
//  - bandas em dB relativas a 150–400 Hz (Welch 8192, Hann, 50%), centroide 100–8000 Hz;
//  - níveis de linha (Welch 32768, dB de pico sobre a mediana de 61 pontos, ±4%): BPF, 2·BPF, fileira (N/2/fileiras),
//    ignição (N/2) e 2×ignição;
//  - CVciclo (RMS por período de ignição) e CVlento (por 0,25 s) da banda 0,7–4·f_ign (Butterworth de ordem 4 em ida e
//    volta: o módulo ao quadrado, aplicado no domínio da frequência);
//  - fração periódica 1–6 kHz (energia nas linhas harmônicas da ignição, Welch 16384, ±1 bin).
//
//   npx tsx tools/radial-bandas.ts "nome:arquivo.wav:t0:t1:N:fileiras:f_ign:B:i" ...   (B = 0 sem hélice; i = rpm motor/hélice)
import fs from 'node:fs';

export const BANDAS: [number, number][] = [[60, 150], [150, 400], [400, 1000], [1000, 2500], [2500, 6000], [6000, 12000]];

export function fft(re: Float64Array, im: Float64Array, inversa = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inversa ? 2 : -2) * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inversa) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

/** Welch (Hann, 50%, média removida por segmento): [frequências, potência] */
export function welch(x: ArrayLike<number>, sr: number, nper = 8192): [Float64Array, Float64Array] {
  if (x.length < nper) { let n2 = 256; while (n2 * 2 <= x.length) n2 *= 2; nper = Math.max(256, n2); }
  const hop = nper / 2, P = new Float64Array(nper / 2 + 1), re = new Float64Array(nper), im = new Float64Array(nper);
  const w = Float64Array.from({ length: nper }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / nper));
  let nseg = 0;
  for (let s = 0; s + nper <= x.length; s += hop) {
    let m = 0; for (let i = 0; i < nper; i++) m += x[s + i]; m /= nper;
    for (let i = 0; i < nper; i++) { re[i] = (x[s + i] - m) * w[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k <= nper / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k];
    nseg++;
  }
  for (let k = 0; k <= nper / 2; k++) P[k] /= Math.max(1, nseg);
  return [Float64Array.from({ length: nper / 2 + 1 }, (_, k) => (k * sr) / nper), P];
}

/** filtro de mediana de `k` pontos (bordas com zeros, como o scipy.signal.medfilt) */
export function medfilt(x: Float64Array, k: number) {
  const h = (k - 1) / 2, out = new Float64Array(x.length), jan = new Float64Array(k);
  for (let i = 0; i < x.length; i++) {
    for (let j = -h; j <= h; j++) { const q = i + j; jan[j + h] = q >= 0 && q < x.length ? x[q] : 0; }
    jan.sort(); out[i] = jan[h];
  }
  return out;
}

const db = (v: number) => 10 * Math.log10(v + 1e-30);
const interp = (f: Float64Array, y: Float64Array, x: number) => {
  const df = f[1] - f[0], i = Math.floor(x / df);
  if (i < 0) return y[0]; if (i >= f.length - 1) return y[f.length - 1];
  const a = (x - f[i]) / df; return y[i] * (1 - a) + y[i + 1] * a;
};

export function bandas(x: ArrayLike<number>, sr: number) {
  const [f, P] = welch(x, sr, 8192);
  const soma = (a: number, b: number) => { let s = 0; for (let k = 0; k < f.length; k++) if (f[k] >= a && f[k] < b) s += P[k]; return s; };
  const ref = soma(150, 400) + 1e-30;
  const b = BANDAS.map(([a, c]) => 10 * Math.log10(soma(a, c) / ref + 1e-12));
  let n = 0, d = 0; for (let k = 0; k < f.length; k++) if (f[k] > 100 && f[k] < 8000) { n += f[k] * P[k]; d += P[k]; }
  return { b, cent: n / (d + 1e-30) };
}

/** f_ign por pente de 4 harmônicos a ±12% da âncora */
export function pente(seg: ArrayLike<number>, sr: number, fa: number, nh = 4) {
  const [f, P] = welch(seg, sr, 16384);
  const M = medfilt(P, 41), W = Float64Array.from(P, (p, k) => p / (M[k] + 1e-30));
  let best = -Infinity, bf = fa;
  for (let f0 = 0.88 * fa; f0 < 1.12 * fa; f0 += 0.1) {
    let s = 0; for (let h = 1; h <= nh; h++) s += Math.log(interp(f, W, h * f0) + 1e-9);
    if (s > best) { best = s; bf = f0; }
  }
  return bf;
}

/** passa-faixa Butterworth de ordem 4 (aprox. passa-alta × passa-baixa), em ida e volta, no domínio da frequência */
export function passaFaixa(x: ArrayLike<number>, sr: number, f1: number, f2: number) {
  let n = 1; while (n < x.length) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < x.length; i++) re[i] = x[i];
  fft(re, im);
  for (let k = 0; k < n; k++) {
    const f = (Math.min(k, n - k) * sr) / n;
    const g = f <= 0 ? 0 : 1 / ((1 + Math.pow(f1 / f, 8)) * (1 + Math.pow(f / f2, 8)));
    re[k] *= g; im[k] *= g;
  }
  fft(re, im, true);
  return re.subarray(0, x.length);
}

export type Medida = {
  rpm: number; vagar: number; fIgn: number; b: number[]; cent: number;
  BPF: number; BPF2: number; fil: number; ign: number; ign2: number; cvCiclo: number; cvLento: number; per: number;
  /** nível de linha numa frequência qualquer (dB sobre a mediana) */
  linha: (fx: number, tol?: number) => number;
  /** nível absoluto do pico (dB da densidade de Welch 32768) numa frequência: para comparar linhas entre si */
  pico: (fx: number, tol?: number) => number;
  bpf: number;
};

/** medida completa de um trecho (o `main` do medir2.py) */
export function medir(seg0: ArrayLike<number>, sr: number, op: { N: number; fileiras: number; fIgn: number; B?: number; i?: number; rastrear?: boolean }): Medida {
  const seg = Float64Array.from(seg0 as ArrayLike<number>); let m = 0; for (const v of seg) m += v; m /= seg.length; for (let k = 0; k < seg.length; k++) seg[k] -= m;
  const dur = seg.length / sr;
  const fsIgn: number[] = [];
  if (op.rastrear !== false) for (let t = 0; t + 1 <= dur + 1e-9; t += 1) fsIgn.push(pente(seg.subarray(Math.round(t * sr), Math.round((t + 1) * sr)), sr, op.fIgn));
  if (!fsIgn.length) fsIgn.push(op.fIgn);
  const fi = fsIgn.reduce((a, b) => a + b, 0) / fsIgn.length;
  const vagar = (100 * Math.sqrt(fsIgn.reduce((a, b) => a + (b - fi) ** 2, 0) / fsIgn.length)) / fi;
  const rpm = (fi * 120) / op.N;
  const { b, cent } = bandas(seg, sr);
  const [f2, P2] = welch(seg, sr, 32768);
  const M2 = medfilt(P2, 61), Wdb = Float64Array.from(P2, (p, k) => 10 * Math.log10(p / (M2[k] + 1e-30) + 1e-12));
  const linha = (fx: number, tol = 0.04) => { let mx = -Infinity; for (let k = 0; k < f2.length; k++) if (f2[k] > fx * (1 - tol) && f2[k] < fx * (1 + tol)) mx = Math.max(mx, Wdb[k]); return mx; };
  const pico = (fx: number, tol = 0.04) => { let mx = -Infinity; for (let k = 0; k < f2.length; k++) if (f2[k] > fx * (1 - tol) && f2[k] < fx * (1 + tol)) mx = Math.max(mx, 10 * Math.log10(P2[k] + 1e-30)); return mx; };
  const ord1 = rpm / 60, B = op.B || 0, gi = op.i || 1;
  const bpf = B ? (B * ord1) / gi : NaN;
  const y = passaFaixa(seg, sr, 0.7 * fi, Math.min(4 * fi, 0.45 * sr));
  const cv = (n: number) => { const q = Math.floor(y.length / n), r: number[] = []; for (let k = 0; k < q; k++) { let s = 0; for (let j = 0; j < n; j++) s += y[k * n + j] ** 2; r.push(Math.sqrt(s / n)); } const mm = r.reduce((a, c) => a + c, 0) / r.length; return Math.sqrt(r.reduce((a, c) => a + (c - mm) ** 2, 0) / r.length) / mm; };
  const [f3, P3] = welch(seg, sr, 16384);
  const df = f3[1] - f3[0];
  let tot = 0; for (let k = 0; k < f3.length; k++) if (f3[k] >= 1000 && f3[k] < 6000) tot += P3[k];
  let harm = 0; for (let h = Math.ceil(1000 / fi); h * fi < 6000; h++) { const i = Math.round((h * fi) / df); for (let j = Math.max(i - 1, 0); j < i + 2; j++) harm += P3[j]; }
  return {
    rpm, vagar, fIgn: fi, b, cent,
    BPF: B ? linha(bpf) : NaN, BPF2: B ? linha(2 * bpf) : NaN, fil: op.fileiras > 1 ? linha(fi / op.fileiras) : NaN, ign: linha(fi), ign2: linha(2 * fi),
    cvCiclo: cv(Math.max(8, Math.floor(sr / fi))), cvLento: cv(Math.floor(0.25 * sr)), per: harm / (tot + 1e-30), linha, pico, bpf,
  };
}

export function lerWavMono(arq: string): { x: Float64Array; sr: number } {
  const b = fs.readFileSync(arq);
  let p = 12, sr = 48000, ch = 1, bits = 16, fmt = 1, dados: Buffer | null = null;
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4), n = b.readUInt32LE(p + 4);
    if (id === 'fmt ') { fmt = b.readUInt16LE(p + 8); ch = b.readUInt16LE(p + 10); sr = b.readUInt32LE(p + 12); bits = b.readUInt16LE(p + 22); }
    if (id === 'data') { dados = b.subarray(p + 8, p + 8 + n); break; }
    p += 8 + n + (n & 1);
  }
  if (!dados) throw new Error('WAV sem dados');
  const bps = bits / 8, n = Math.floor(dados.length / (bps * ch)), x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < ch; c++) {
      const o = (i * ch + c) * bps;
      s += fmt === 3 ? dados.readFloatLE(o) : bits === 16 ? dados.readInt16LE(o) / 32768 : dados.readInt32LE(o) / 2147483648;
    }
    x[i] = s / ch;
  }
  return { x, sr };
}

export const linhaTabela = (nome: string, r: Medida) => {
  const v = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : 'nan');
  return `${nome.padEnd(36)} ${v(r.rpm, 0).padStart(5)} ${v(r.vagar).padStart(5)} ${v(r.fIgn).padStart(6)} | ${[r.b[0], r.b[2], r.b[3], r.b[4], r.b[5]].map((x) => v(x).padStart(6)).join(' ')} ${v(r.cent, 0).padStart(5)} | ${[r.BPF, r.BPF2, r.fil, r.ign, r.ign2].map((x) => v(x).padStart(5)).join(' ')} | ${v(r.cvCiclo, 2)} ${v(r.cvLento, 2)} ${v(r.per, 2)}`;
};

const ehCli = process.argv[1] && process.argv[1].endsWith('radial-bandas.ts');
if (ehCli) {
  console.log(`${'trecho'.padEnd(36)}   rpm vagar  f_ign | 60-150 400-1k 1-2.5k 2.5-6k  6-12k  cent |   BPF  2BPF   fil   ign  2ign | CVcic CVlen per`);
  for (const spec of process.argv.slice(2)) {
    const [nome, arq, t0, t1, N, rows, fa, B, gi] = spec.split(':');
    const { x, sr } = lerWavMono(arq);
    const seg = x.subarray(Math.round(+t0 * sr), Math.round(+t1 * sr));
    console.log(linhaTabela(nome, medir(seg, sr, { N: +N, fileiras: +rows, fIgn: +fa, B: +B, i: +gi })));
  }
}
