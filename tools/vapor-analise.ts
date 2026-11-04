// Medidas do vapor (VAPOR.md 3 e Apêndice A): porta em TypeScript dos scripts do projetista (`mapa.py`, `mapa2.py`,
// `chuff.py`, `chuff2.py`, `apito.py`, `bomba.py`, `bandas.py`), com a mesma aritmética do numpy/scipy onde ela decide
// o número (filtros de Butterworth em ida e volta com as bordas do `sosfiltfilt`, `find_peaks` com distância e
// proeminência, Welch com janela Hann periódica, tendência constante e escala de densidade, `np.convolve(..., 'same')`,
// `np.percentile` linear, `medfilt` com zeros nas bordas). Serve para as gravações e para os renders do simulador
// (qualquer `ArrayLike<number>` mono; a taxa vem como argumento).
//
//  - envoltória: RMS de 10 ms da banda 200–2500 Hz, decimada a 200 Hz, sem a tendência (média móvel de 1,5 s);
//  - linhas da envoltória: FFT com Hann (simétrica) e zeros até 4× o comprimento, 0,8–40 Hz, proeminência ≥ 6 dB, dB
//    sobre a mediana da faixa;
//  - chuff (`chuff2.py`): período = a linha mais alta com autocorrelação da envoltória > 0,25 no atraso 1/f; picos da
//    envoltória 150–3000 Hz (janela 0,08/f limitada a 4–12 ms) à distância 0,6/f e proeminência 3 dB; ataque 10–90%,
//    largura a −6 dB, decaimento a −10 dB, pico/vale total e por banda, CV entre picos; bandas (dB rel. 150–400 Hz,
//    Welch 4096) no pico e no vale (janelas de ±12% do período) e no trecho;
//  - linhas tonais (`apito.py`): Welch 32768, dB sobre a mediana de 301 pontos, picos > 18 dB a 8 Hz de distância;
//  - bomba e sino (`bomba.py`): periodicidades da envoltória (20 ms, detrend de 1,5 s) por banda e tons 0,5–6 kHz.
import { lerWav } from './wav';
import { fft } from './radial-bandas';

export const BANDAS: [number, number][] = [[60, 150], [150, 400], [400, 1000], [1000, 2500], [2500, 6000], [6000, 12000]];

// ------------------------------------------------------------------------------------------------- leitura

/** WAV para mono em double (média dos canais; PCM já vem em [-1, 1), como o `ler` de mapa.py) */
export function lerMono(arquivo: string): { x: Float64Array; fs: number } {
  const w = lerWav(arquivo), nc = w.canais.length, n = w.canais[0].length, x = new Float64Array(n);
  for (let c = 0; c < nc; c++) { const ch = w.canais[c]; for (let i = 0; i < n; i++) x[i] += ch[i]; }
  if (nc > 1) for (let i = 0; i < n; i++) x[i] /= nc;
  let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(x[i]));
  if (mx > 1.5) for (let i = 0; i < n; i++) x[i] /= 32768;
  return { x, fs: w.sr };
}

/** trecho [t0, t1) em segundos, com os índices `int(t·fs)` do Python */
export function trecho(x: ArrayLike<number>, fs: number, t0: number, t1: number): Float64Array {
  const a = Math.trunc(t0 * fs), b = Math.min(x.length, Math.trunc(t1 * fs));
  const y = new Float64Array(Math.max(0, b - a));
  for (let i = 0; i < y.length; i++) y[i] = x[a + i];
  return y;
}

/** nível RMS em dBFS (`20·log10(rms + 1e-9)`) */
export function nivelDb(x: ArrayLike<number>) { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return 20 * Math.log10(Math.sqrt(s / Math.max(1, x.length)) + 1e-9); }

// ------------------------------------------------------------------------------------------------- estatística

export function mediana(a: ArrayLike<number>) { return percentil(a, 50); }
/** `np.percentile` com interpolação linear (0 se vazio, como o `q` dos scripts) */
export function percentil(a: ArrayLike<number>, p: number) {
  const n = a.length; if (!n) return 0;
  const s = Float64Array.from(a).sort(), r = (p / 100) * (n - 1), i = Math.floor(r), f = r - i;
  return i + 1 < n ? s[i] + (s[i + 1] - s[i]) * f : s[i];
}
export function q3(a: ArrayLike<number>) { return { med: mediana(a), p10: percentil(a, 10), p90: percentil(a, 90) }; }
/** `np.std` (populacional) */
export function desvio(a: ArrayLike<number>) {
  const n = a.length; if (!n) return 0;
  let m = 0; for (let i = 0; i < n; i++) m += a[i]; m /= n;
  let s = 0; for (let i = 0; i < n; i++) s += (a[i] - m) ** 2;
  return Math.sqrt(s / n);
}
/** `np.corrcoef(a, b)[0, 1]` */
export function correlacao(a: ArrayLike<number>, b: ArrayLike<number>, n = Math.min(a.length, b.length), oa = 0, ob = 0) {
  let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[oa + i]; mb += b[ob + i]; } ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const x = a[oa + i] - ma, y = b[ob + i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return sab / Math.sqrt(saa * sbb);
}
/** `round` do Python (metade para o par) */
const roundPy = (x: number) => { const r = Math.round(x); return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r; };

// ------------------------------------------------------------------------------------------------- filtros

/** seções de 2ª ordem [b0, b1, b2, a0 = 1, a1, a2] */
export type Sos = number[][];

type C = [number, number];
const cmul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a: C, b: C): C => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const csqrt = (a: C): C => { const r = Math.hypot(a[0], a[1]), re = Math.sqrt((r + a[0]) / 2), im = Math.sqrt(Math.max(0, (r - a[0]) / 2)); return [re, a[1] < 0 ? -im : im]; };

/**
 * `scipy.signal.butter(ordem, f, btype, fs, output='sos')`: protótipo analógico, pré-distorção, `lp2bp`/`lp2lp`/`lp2hp`,
 * bilinear. As seções juntam cada polo com o conjugado; o par de zeros de cada seção vem dos zeros ±1 (passa-faixa),
 * −1 (passa-baixa) ou +1 (passa-alta). A divisão em seções não muda a resposta nem a saída do `sosfiltfilt` (o estado
 * inicial é o de regime da cascata inteira), só a ordem das contas.
 */
export function butterSos(ordem: number, f: number | [number, number], fs: number, tipo: 'lowpass' | 'highpass' | 'bandpass' = 'bandpass'): Sos {
  const N = ordem, fs2 = 4; // (o scipy normaliza para fs = 2 e usa 2·fs na bilinear)
  const warp = (x: number) => 2 * 2 * Math.tan((Math.PI * ((2 * x) / fs)) / 2);
  const pa: C[] = [];
  for (let m = -N + 1; m < N; m += 2) { const t = (Math.PI * m) / (2 * N); pa.push([-Math.cos(t), -Math.sin(t)]); }
  let pz: C[] = [], zs: C[] = [], k: number;
  const bil = (p: C): C => cdiv([fs2 + p[0], p[1]], [fs2 - p[0], -p[1]]);
  if (tipo === 'bandpass') {
    const [lo, hi] = f as [number, number], wl = warp(lo), wh = warp(hi), bw = wh - wl, wo2 = wl * wh;
    const pb: C[] = [];
    for (const p of pa) {
      const pl: C = [(p[0] * bw) / 2, (p[1] * bw) / 2], d = csqrt([pl[0] * pl[0] - pl[1] * pl[1] - wo2, 2 * pl[0] * pl[1]]);
      pb.push([pl[0] + d[0], pl[1] + d[1]], [pl[0] - d[0], pl[1] - d[1]]);
    }
    // k = bw^N · Re(∏(fs2 − z)/∏(fs2 − p)), z = N zeros em 0
    let num: C = [Math.pow(fs2, N), 0], den: C = [1, 0];
    for (const p of pb) den = cmul(den, [fs2 - p[0], -p[1]]);
    k = Math.pow(bw, N) * cdiv(num, den)[0];
    pz = pb.map(bil);
    for (let i = 0; i < N; i++) zs.push([1, 0], [-1, 0]);
  } else {
    const w = warp(f as number);
    const pl: C[] = tipo === 'lowpass' ? pa.map((p) => [p[0] * w, p[1] * w] as C) : pa.map((p) => cdiv([w, 0], p));
    let den: C = [1, 0]; for (const p of pl) den = cmul(den, [fs2 - p[0], -p[1]]);
    if (tipo === 'lowpass') k = Math.pow(w, N) * cdiv([1, 0], den)[0];
    else { let pr: C = [1, 0]; for (const p of pa) pr = cmul(pr, [-p[0], -p[1]]); k = cdiv([1, 0], pr)[0] * cdiv([Math.pow(fs2, N), 0], den)[0]; }
    pz = pl.map(bil);
    for (let i = 0; i < N; i++) zs.push([tipo === 'lowpass' ? -1 : 1, 0]);
  }
  // pares conjugados (os reais, se houver, aos pares)
  const usados = new Array(pz.length).fill(false), pares: [C, C][] = [];
  for (let i = 0; i < pz.length; i++) {
    if (usados[i]) continue; usados[i] = true;
    let j = -1, best = Infinity;
    for (let q = 0; q < pz.length; q++) if (!usados[q]) { const d = Math.hypot(pz[q][0] - pz[i][0], pz[q][1] + pz[i][1]); if (d < best) { best = d; j = q; } }
    usados[j] = true; pares.push([pz[i], pz[j]]);
  }
  const sos: Sos = [];
  for (let s = 0; s < pares.length; s++) {
    const [p1, p2] = pares[s], z1 = zs[2 * s][0], z2 = zs[2 * s + 1][0];
    const b = [1, -(z1 + z2), z1 * z2], a = [1, -(p1[0] + p2[0]), p1[0] * p2[0] - p1[1] * p2[1]];
    if (s === 0) { b[0] *= k; b[1] *= k; b[2] *= k; }
    sos.push([b[0], b[1], b[2], a[0], a[1], a[2]]);
  }
  return sos;
}

/** `lfilter_zi` de uma seção (forma direta II transposta) */
function ziSecao(s: number[]): [number, number] {
  const [b0, b1, b2, , a1, a2] = s, B0 = b1 - a1 * b0, B1 = b2 - a2 * b0;
  // [[1 + a1, −1], [a2, 1]]·zi = [B0, B1]
  const det = (1 + a1) + a2, z0 = (B0 + B1) / det, z1 = B1 - a2 * z0;
  return [z0, z1];
}

/** `sosfilt` com estado inicial (aloca a saída) */
function sosfilt(sos: Sos, x: Float64Array, zi: Float64Array): Float64Array {
  const y = Float64Array.from(x), n = y.length;
  for (let s = 0; s < sos.length; s++) {
    const [b0, b1, b2, , a1, a2] = sos[s];
    let z0 = zi[2 * s], z1 = zi[2 * s + 1];
    for (let i = 0; i < n; i++) { const v = y[i], o = b0 * v + z0; z0 = b1 * v - a1 * o + z1; z1 = b2 * v - a2 * o; y[i] = o; }
  }
  return y;
}

/** `scipy.signal.sosfiltfilt(sos, x)` (padtype 'odd', padlen = 3·(2·nseções + 1 − nº de seções com b2 = 0 ou a2 = 0)) */
export function sosfiltfilt(sos: Sos, x: ArrayLike<number>): Float64Array {
  const n = x.length, ns = sos.length;
  const nz = Math.min(sos.filter((s) => s[2] === 0).length, sos.filter((s) => s[5] === 0).length);
  const edge = Math.min(3 * (2 * ns + 1 - nz), n - 1);
  const ext = new Float64Array(n + 2 * edge);
  for (let i = 0; i < edge; i++) ext[i] = 2 * x[0] - x[edge - i];
  for (let i = 0; i < n; i++) ext[edge + i] = x[i];
  for (let i = 0; i < edge; i++) ext[edge + n + i] = 2 * x[n - 1] - x[n - 2 - i];
  // sosfilt_zi: o regime de cada seção, escalado pelo ganho DC das anteriores
  const zi = new Float64Array(2 * ns); let esc = 1;
  for (let s = 0; s < ns; s++) {
    const z = ziSecao(sos[s]); zi[2 * s] = esc * z[0]; zi[2 * s + 1] = esc * z[1];
    esc *= (sos[s][0] + sos[s][1] + sos[s][2]) / (sos[s][3] + sos[s][4] + sos[s][5]);
  }
  const z0 = zi.map((v) => v * ext[0]);
  let y = sosfilt(sos, ext, z0);
  const y0 = y[y.length - 1];
  y.reverse();
  y = sosfilt(sos, y, zi.map((v) => v * y0));
  y.reverse();
  return y.slice(edge, edge + n);
}

/** `np.convolve(x, ones(w)/w, mode='same')` (média móvel com zeros fora) */
export function mediaMovel(x: ArrayLike<number>, w: number): Float64Array {
  const n = x.length, c = new Float64Array(n + 1), y = new Float64Array(n), off = Math.floor((w - 1) / 2);
  for (let i = 0; i < n; i++) c[i + 1] = c[i] + x[i];
  for (let i = 0; i < n; i++) {
    // same[i] = full[i + off] = Σ x[i + off − j], j = 0..w−1
    const hi = Math.min(n - 1, i + off), lo = Math.max(0, i + off - w + 1);
    y[i] = hi >= lo ? (c[hi + 1] - c[lo]) / w : 0;
  }
  return y;
}

/** envoltória RMS (sem decimar) da banda lo–hi com janela de `w` s (`env` de chuff.py) */
export function envBanda(x: ArrayLike<number>, fs: number, lo: number, hi: number, w = 0.005): Float64Array {
  const y = sosfiltfilt(butterSos(4, [lo, hi], fs), x);
  for (let i = 0; i < y.length; i++) y[i] *= y[i];
  const e = mediaMovel(y, Math.trunc(w * fs));
  for (let i = 0; i < e.length; i++) e[i] = Math.sqrt(Math.max(0, e[i]));
  return e;
}

/** `envoltoria` de mapa2.py: RMS de `jan` s da banda lo–hi, decimada a `fe`, sem a tendência (média móvel de `tLenta` s), normalizada */
export function envoltoria(x: ArrayLike<number>, fs: number, lo = 200, hi = 2500, fe = 200, jan = 0.01, tLenta = 1.5): { e: Float64Array; fe: number } {
  const full = envBanda(x, fs, lo, hi, jan), passo = Math.floor(fs / fe);
  const e = new Float64Array(Math.ceil(full.length / passo));
  for (let i = 0; i < e.length; i++) e[i] = full[i * passo];
  const lenta = mediaMovel(e, Math.trunc(tLenta * fe));
  let m = 0; for (let i = 0; i < lenta.length; i++) m += lenta[i]; m /= lenta.length;
  for (let i = 0; i < e.length; i++) e[i] = (e[i] - lenta[i]) / (m + 1e-9);
  return { e, fe };
}

// ------------------------------------------------------------------------------------------------- picos

/** `scipy.signal.find_peaks` com `height`, `distance` e `prominence` (só os mínimos); devolve os índices em ordem */
export function acharPicos(x: ArrayLike<number>, op: { altura?: number; distancia?: number; proeminencia?: number } = {}): number[] {
  const n = x.length;
  let p: number[] = [];
  // _local_maxima_1d: meio de cada platô
  for (let i = 1, imax = n - 1; i < imax; i++) {
    if (x[i - 1] < x[i]) {
      let ia = i + 1;
      while (ia < imax && x[ia] === x[i]) ia++;
      if (x[ia] < x[i]) { p.push(Math.floor((i + ia - 1) / 2)); i = ia; }
    }
  }
  if (op.altura != null) p = p.filter((i) => x[i] >= op.altura!);
  if (op.distancia != null && op.distancia > 1 && p.length > 1) {
    const d = Math.ceil(op.distancia), keep = new Uint8Array(p.length).fill(1);
    const ordem = p.map((_, j) => j).sort((a, b) => x[p[a]] - x[p[b]] || a - b);
    for (let r = ordem.length - 1; r >= 0; r--) {
      const j = ordem[r]; if (!keep[j]) continue;
      for (let k = j - 1; k >= 0 && p[j] - p[k] < d; k--) keep[k] = 0;
      for (let k = j + 1; k < p.length && p[k] - p[j] < d; k++) keep[k] = 0;
    }
    p = p.filter((_, j) => keep[j]);
  }
  if (op.proeminencia != null) p = p.filter((i) => proeminencia(x, i) >= op.proeminencia!);
  return p;
}

/** proeminência de um pico (`peak_prominences` sem `wlen`) */
export function proeminencia(x: ArrayLike<number>, pk: number) {
  const v = x[pk];
  let lmin = v, i = pk; while (i >= 0 && x[i] <= v) { if (x[i] < lmin) lmin = x[i]; i--; }
  let rmin = v; i = pk; while (i < x.length && x[i] <= v) { if (x[i] < rmin) rmin = x[i]; i++; }
  return v - Math.max(lmin, rmin);
}

// ------------------------------------------------------------------------------------------------- espectros

const ehPot2 = (n: number) => (n & (n - 1)) === 0;
function dftPot(re: Float64Array, im: Float64Array) {
  if (ehPot2(re.length)) { fft(re, im); return; }
  // comprimento qualquer (trecho mais curto que o nperseg): DFT direta, só acontece com trechos curtos
  const n = re.length, r2 = new Float64Array(n), i2 = new Float64Array(n);
  for (let k = 0; k <= n / 2; k++) { let a = 0, b = 0; for (let t = 0; t < n; t++) { const ang = (-2 * Math.PI * k * t) / n; a += re[t] * Math.cos(ang) - im[t] * Math.sin(ang); b += re[t] * Math.sin(ang) + im[t] * Math.cos(ang); } r2[k] = a; i2[k] = b; }
  re.set(r2); im.set(i2);
}

/**
 * `scipy.signal.welch(x, fs, nperseg)`: Hann periódica, 50%, tendência constante por segmento, média, escala de
 * densidade (V²/Hz) unilateral. Com o trecho mais curto que `nperseg`, nperseg = comprimento (como o scipy).
 */
export function welchPy(x: ArrayLike<number>, fs: number, nperseg = 256): { f: Float64Array; P: Float64Array } {
  const nper = Math.min(nperseg, x.length), hop = nper - Math.floor(nper / 2), nf = Math.floor(nper / 2) + 1;
  const w = Float64Array.from({ length: nper }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / nper));
  let s2 = 0; for (let i = 0; i < nper; i++) s2 += w[i] * w[i];
  const P = new Float64Array(nf), re = new Float64Array(nper), im = new Float64Array(nper);
  let nseg = 0;
  for (let s = 0; s + nper <= x.length; s += hop) {
    let m = 0; for (let i = 0; i < nper; i++) m += x[s + i]; m /= nper;
    for (let i = 0; i < nper; i++) { re[i] = (x[s + i] - m) * w[i]; im[i] = 0; }
    dftPot(re, im);
    for (let k = 0; k < nf; k++) P[k] += re[k] * re[k] + im[k] * im[k];
    nseg++;
  }
  const esc = 1 / (fs * s2 * Math.max(1, nseg));
  for (let k = 0; k < nf; k++) P[k] *= esc * (k === 0 || (nper % 2 === 0 && k === nf - 1) ? 1 : 2);
  return { f: Float64Array.from({ length: nf }, (_, k) => (k * fs) / nper), P };
}

/** `scipy.signal.medfilt(x, k)` (zeros nas bordas) */
export function medfiltPy(x: Float64Array, k: number) {
  const h = (k - 1) / 2, out = new Float64Array(x.length), jan = new Float64Array(k);
  for (let i = 0; i < x.length; i++) {
    for (let j = -h; j <= h; j++) { const q = i + j; jan[j + h] = q >= 0 && q < x.length ? x[q] : 0; }
    jan.sort(); out[i] = jan[h];
  }
  return out;
}

export interface Bandas { db: number[]; centroide: number }
/** `bandas` de chuff.py: Welch 4096, energia por banda (f ∈ [a, b)) em dB relativa a 150–400 Hz, centroide 100–8000 Hz */
export function bandas(x: ArrayLike<number>, fs: number, nper = 4096): Bandas {
  const { f, P } = welchPy(x, fs, nper);
  const e = BANDAS.map(([a, b]) => { let s = 0; for (let k = 0; k < f.length; k++) if (f[k] >= a && f[k] < b) s += P[k]; return s; });
  const ref = e[1] + 1e-20;
  let num = 0, den = 0; for (let k = 0; k < f.length; k++) if (f[k] > 100 && f[k] < 8000) { num += f[k] * P[k]; den += P[k]; }
  return { db: e.map((v) => 10 * Math.log10(v / ref + 1e-12)), centroide: num / (den + 1e-20) };
}
/** as 5 bandas do relatório (60–150, 400–1k, 1–2,5k, 2,5–6k, 6–12k), sem a de referência */
export const cinco = (b: Bandas) => [b.db[0], b.db[2], b.db[3], b.db[4], b.db[5]];

// ------------------------------------------------------------------------------------------------- linhas da envoltória

export interface Linha { f: number; prom: number }
/** `linhas` de mapa2.py: as `k` linhas mais fortes do espectro da envoltória entre fmin e fmax (dB sobre a mediana) */
export function linhas(e: ArrayLike<number>, fe: number, fmin = 0.8, fmax = 40, k = 3): Linha[] {
  const n = e.length, nf = 1 << Math.ceil(Math.log2(n * 4));
  const re = new Float64Array(nf), im = new Float64Array(nf);
  for (let i = 0; i < n; i++) re[i] = e[i] * (n > 1 ? 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) : 1);
  fft(re, im);
  const fm: number[] = [], Em: number[] = [];
  for (let q = 0; q <= nf / 2; q++) { const f = (q * fe) / nf; if (f >= fmin && f <= fmax) { fm.push(f); Em.push(re[q] * re[q] + im[q] * im[q]); } }
  const med = mediana(Em) + 1e-12, db = Em.map((v) => 10 * Math.log10(v / med));
  const p = acharPicos(db, { proeminencia: 6 }).sort((a, b) => Em[b] - Em[a]).slice(0, k);
  return p.map((i) => ({ f: fm[i], prom: 10 * Math.log10(Em[i] / med) }));
}

/** autocorrelação da envoltória no atraso 1/f (`ac_em` de chuff2.py); −1 fora da faixa */
export function acEm(e: ArrayLike<number>, fe: number, f: number) {
  const k = roundPy(fe / f);
  if (k < 1 || k >= Math.floor(e.length / 2)) return -1;
  return correlacao(e, e, e.length - k, 0, k);
}

// ------------------------------------------------------------------------------------------------- chuff

export interface Candidata { f: number; prom: number; ac: number }
export interface Quartis { med: number; p10: number; p90: number }
export interface MedidaChuff {
  nivel: number;                 // dBFS do trecho
  candidatas: Candidata[];       // linhas da envoltória com proeminência > 9 dB, em ordem de frequência
  fChuff: number;                // Hz: a linha mais alta com ac > 0,25 (ou a mais proeminente; ou a imposta)
  fCiclo: number;                // Hz: a mais baixa com ac > 0,5 (ou fChuff)
  taxaPicos: number;             // picos achados por segundo
  picos: number[];               // índices dos picos (amostras)
  ataque: Quartis;               // ms, 10–90% do vale ao pico
  largura: Quartis;              // ms, a −6 dB do pico
  decaimento: Quartis;           // ms, até −10 dB do pico
  pv: Quartis;                   // dB, pico/vale na envoltória 150–3000 Hz
  pvBanda: { '150-400': number; '400-1500': number; '1500-6000': number };   // medianas, dB
  cv: number;                    // dB, desvio do nível dos picos
  pico: Bandas; vale: Bandas; trecho: Bandas;   // dB rel. 150–400 (6 bandas) e centroide
}

/** `analisar` de chuff2.py sobre um trecho já cortado (mono, `fs`); `fch` impõe a frequência do chuff */
export function analisarChuff(x: ArrayLike<number>, fs: number, fch?: number): MedidaChuff {
  const dur = x.length / fs;
  const { e, fe } = envoltoria(x, fs);
  const L = linhas(e, fe, 0.8, 40, 8).filter((l) => l.prom > 9);
  const cand: Candidata[] = L.map((l) => ({ f: l.f, prom: l.prom, ac: acEm(e, fe, l.f) })).sort((a, b) => a.f - b.f || a.prom - b.prom);
  if (fch == null) {
    const ok = cand.filter((c) => c.ac > 0.25);
    fch = ok.length ? ok.reduce((a, b) => (b.f > a.f ? b : a)).f : cand.length ? cand.reduce((a, b) => (b.prom > a.prom ? b : a)).f : 2;
  }
  const ciclo = cand.filter((c) => c.ac > 0.5);
  const fCiclo = ciclo.length ? ciclo.reduce((a, b) => (b.f < a.f ? b : a)).f : fch;
  const w = Math.max(0.004, Math.min(0.012, 0.08 / fch));
  const E = envBanda(x, fs, 150, 3000, w);
  const Edb = E.map((v) => 20 * Math.log10(v + 1e-9));
  const p = acharPicos(Edb, { distancia: Math.trunc((0.6 * fs) / fch), proeminencia: 3 });
  const Eb = { '150-400': envBanda(x, fs, 150, 400, w), '400-1500': envBanda(x, fs, 400, 1500, w), '1500-6000': envBanda(x, fs, 1500, 6000, w) };
  const at: number[] = [], dec: number[] = [], pv: number[] = [], larg: number[] = [];
  const pvb: Record<string, number[]> = { '150-400': [], '400-1500': [], '1500-6000': [] };
  const argmin = (a: number, b: number) => { let j = a; for (let i = a; i < b; i++) if (E[i] < E[j]) j = i; return j; };
  const d10 = Math.trunc(0.01 * fs);
  const maxF = (A: Float64Array, a: number, b: number) => { let m = -Infinity; for (let i = Math.max(0, a); i < Math.min(A.length, b); i++) m = Math.max(m, A[i]); return m; };
  const minF = (A: Float64Array, a: number, b: number) => { let m = Infinity; for (let i = Math.max(0, a); i < Math.min(A.length, b); i++) m = Math.min(m, A[i]); return m; };
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i - 1], b = p[i], c = p[i + 1];
    const v0 = argmin(a, b), v1 = argmin(b, c), pk = E[b], vl = E[v0];
    pv.push(20 * Math.log10(pk / (vl + 1e-9)));
    for (const kk of Object.keys(Eb) as (keyof typeof Eb)[]) {
      const EE = Eb[kk];
      pvb[kk].push(20 * Math.log10((maxF(EE, Math.max(0, b - d10), b + d10) + 1e-9) / (minF(EE, Math.max(0, v0 - d10), v0 + d10) + 1e-9)));
    }
    // ataque: primeiras amostras de E[v0:b] acima de 10% e de 90% do caminho vale → pico (0 se nenhuma, como o argmax)
    const lo = vl + 0.1 * (pk - vl), hi = vl + 0.9 * (pk - vl);
    const primeiro = (a0: number, b0: number, cond: (v: number) => boolean) => { for (let q = a0; q < b0; q++) if (cond(E[q])) return q - a0; return -1; };
    const iHi = primeiro(v0, b, (v) => v >= hi), iLo = primeiro(v0, b, (v) => v >= lo);
    at.push(((Math.max(0, iHi) - Math.max(0, iLo)) / fs) * 1000);
    const lim = pk * Math.pow(10, -10 / 20);
    const jd = primeiro(b, v1, (v) => v <= lim);
    dec.push(((jd >= 0 ? jd : v1 - b) / fs) * 1000);
    const lim6 = pk * Math.pow(10, -6 / 20);
    let l = v0;
    if (primeiro(v0, b, (v) => v <= lim6) >= 0) { let q = b; while (q >= 0 && !(E[q] <= lim6)) q--; l = q < 0 ? b : q; }
    const jr = primeiro(b, v1, (v) => v <= lim6);
    const r = b + (jr >= 0 ? jr : v1 - b);
    larg.push(((r - l) / fs) * 1000);
  }
  // espectros: janelas de ±12% do período em torno dos picos e dos vales
  const hw = Math.trunc((0.12 * fs) / fch);
  const juntar = (centros: number[]) => {
    const ok = centros.filter((b) => b - hw > 0 && b + hw < x.length);
    const y = new Float64Array(ok.length * 2 * hw);
    ok.forEach((b, j) => { for (let q = 0; q < 2 * hw; q++) y[j * 2 * hw + q] = x[b - hw + q]; });
    return y;
  };
  let sp = p.length > 2 ? juntar(p.slice(1, -1)) : Float64Array.from(x);
  if (!sp.length) sp = Float64Array.from(x);
  const vales: number[] = []; for (let i = 1; i < p.length; i++) vales.push(argmin(p[i - 1], p[i]));
  let sv = juntar(vales); if (!sv.length) sv = Float64Array.from(x);
  return {
    nivel: nivelDb(x), candidatas: cand, fChuff: fch, fCiclo, taxaPicos: p.length / dur, picos: p,
    ataque: q3(at), largura: q3(larg), decaimento: q3(dec), pv: q3(pv),
    pvBanda: { '150-400': mediana(pvb['150-400']), '400-1500': mediana(pvb['400-1500']), '1500-6000': mediana(pvb['1500-6000']) },
    cv: desvio(p.map((i) => Edb[i])),
    pico: bandas(sp, fs), vale: bandas(sv, fs), trecho: bandas(x, fs),
  };
}

/** texto de uma linha da medida (formato do chuff2.py) */
export function textoChuff(m: MedidaChuff) {
  const f1 = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1);
  return [
    `candidatas ${m.candidatas.map((c) => `${c.f.toFixed(2)}(${c.prom.toFixed(0)},${c.ac >= 0 ? '+' : ''}${c.ac.toFixed(2)})`).join(' ')}`,
    `chuff ${m.fChuff.toFixed(2)} Hz, ciclo ${m.fCiclo.toFixed(2)} | picos ${m.taxaPicos.toFixed(2)}/s | ataque ${m.ataque.med.toFixed(0)} ms | largura ${m.largura.med.toFixed(0)} | decai ${m.decaimento.med.toFixed(0)} | p/v ${m.pv.med.toFixed(1)} · ${m.pvBanda['150-400'].toFixed(1)} · ${m.pvBanda['400-1500'].toFixed(1)} · ${m.pvBanda['1500-6000'].toFixed(1)} | CV ${m.cv.toFixed(1)}`,
    `pico ${cinco(m.pico).map(f1).join(' ')} cen ${m.pico.centroide.toFixed(0)} | vale ${cinco(m.vale).map(f1).join(' ')} cen ${m.vale.centroide.toFixed(0)} | trecho ${cinco(m.trecho).map(f1).join(' ')} cen ${m.trecho.centroide.toFixed(0)}`,
  ].join('\n   ');
}

// ------------------------------------------------------------------------------------------------- linhas tonais

export interface LinhaTonal { f: number; rel: number; abs: number }   // Hz, dB sobre a mediana local, dB absoluto (densidade)
/**
 * `linhas` de apito.py: Welch `nper`, dB sobre a mediana de 301 pontos, picos acima de `lim` dB entre fmin e fmax, a
 * pelo menos 8 Hz uns dos outros. `max` > 0: só os `max` de maior nível absoluto (o `main` do apito.py mostra 8), em
 * ordem de frequência.
 */
export function linhasTonais(x: ArrayLike<number>, fs: number, op: { nper?: number; fmin?: number; fmax?: number; lim?: number; max?: number; mediana?: number; distanciaBins?: number } = {}): LinhaTonal[] {
  const nper = op.nper ?? 32768, fmin = op.fmin ?? 120, fmax = op.fmax ?? 3500, lim = op.lim ?? 18;
  const { f, P } = welchPy(x, fs, nper);
  const Pdb = P.map((v) => 10 * Math.log10(v + 1e-20));
  const base = medfiltPy(Pdb, op.mediana ?? 301);
  const idx: number[] = []; for (let k = 0; k < f.length; k++) if (f[k] >= fmin && f[k] <= fmax) idx.push(k);
  const rel = idx.map((k) => Pdb[k] - base[k]);
  const dist = op.distanciaBins != null ? op.distanciaBins : Math.trunc(8 / (fs / nper));
  let L = acharPicos(rel, { altura: lim, distancia: dist }).map((j) => ({ f: f[idx[j]], rel: rel[j], abs: Pdb[idx[j]] }));
  if (op.max) L = L.sort((a, b) => b.abs - a.abs).slice(0, op.max).sort((a, b) => a.f - b.f);
  return L;
}

// ------------------------------------------------------------------------------------------------- bomba e sino

export interface MedidaBomba { nivel: number; bandas: { lo: number; hi: number; linhas: Linha[] }[]; tons: LinhaTonal[] }
/** bomba.py: periodicidades 0,4–12 Hz da envoltória (20 ms, sem a tendência de 1,5 s) em 5 bandas e tons tonais 0,5–6 kHz */
export function analisarBomba(x: ArrayLike<number>, fs: number, faixas: [number, number][] = [[60, 200], [100, 600], [600, 1500], [1000, 4000], [3000, 8000]]): MedidaBomba {
  const bandasOut = faixas.map(([lo, hi]) => {
    const { e } = envoltoria(x, fs, lo, hi, 200, 0.02, 1.5);
    return { lo, hi, linhas: linhas(e, 200, 0.4, 12, 4) };
  });
  const tons = linhasTonais(x, fs, { nper: 32768, fmin: 500, fmax: 6000, lim: 15, distanciaBins: 40, mediana: 301 }).filter((t) => t.f > 500 && t.f < 6000)
    .sort((a, b) => b.abs - a.abs).slice(0, 8).sort((a, b) => a.f - b.f);
  return { nivel: nivelDb(x), bandas: bandasOut, tons };
}
