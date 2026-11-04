// Análise de sinais para a validação da Cena (sem dependências): FFT, espectrograma, bandas,
// envoltória por banda, nível A com constante 'F', convolução (reverberação offline), RT60.
import { Bq, PonderacaoA, k1 } from '../../src/scene/filtros';

/** FFT complexa radix-2 in-place (re, im de tamanho potência de 2) */
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

export const proxPot2 = (n: number) => { let p = 1; while (p < n) p <<= 1; return p; };

/** convolução linear por FFT (saída do tamanho de x) */
export function convoluir(x: Float32Array | Float64Array, h: Float32Array): Float64Array {
  const N = proxPot2(x.length + h.length);
  const ar = new Float64Array(N), ai = new Float64Array(N), br = new Float64Array(N), bi = new Float64Array(N);
  ar.set(x); br.set(h);
  fft(ar, ai); fft(br, bi);
  for (let i = 0; i < N; i++) { const r = ar[i] * br[i] - ai[i] * bi[i], m = ar[i] * bi[i] + ai[i] * br[i]; ar[i] = r; ai[i] = m; }
  fft(ar, ai, true);
  return ar.subarray(0, x.length);
}

/** espectro de potência (janela de Hann) de um trecho; devolve P[k] para f = k·sr/N */
export function espectro(x: ArrayLike<number>, ini: number, n: number, nfft = proxPot2(n)) {
  const re = new Float64Array(nfft), im = new Float64Array(nfft);
  for (let i = 0; i < n; i++) { const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)); re[i] = (x[ini + i] ?? 0) * w; }
  fft(re, im);
  const P = new Float64Array(nfft / 2);
  for (let k = 0; k < nfft / 2; k++) P[k] = re[k] * re[k] + im[k] * im[k];
  return P;
}

/** frequência do pico entre fMin e fMax num trecho de janela `jan` s centrado em t (interpolação parabólica) */
export function picoEm(x: ArrayLike<number>, sr: number, t: number, jan: number, fMin: number, fMax: number, zp = 8) {
  const n = Math.round(jan * sr), ini = Math.round(t * sr - n / 2);
  const nfft = proxPot2(n * zp);
  const P = espectro(x, ini, n, nfft);
  const k0 = Math.max(1, Math.floor((fMin * nfft) / sr)), k1_ = Math.min(P.length - 2, Math.ceil((fMax * nfft) / sr));
  let kb = k0;
  for (let k = k0; k <= k1_; k++) if (P[k] > P[kb]) kb = k;
  const a = Math.log(P[kb - 1] + 1e-30), b = Math.log(P[kb] + 1e-30), c = Math.log(P[kb + 1] + 1e-30);
  const d = (a - c) / (2 * (a - 2 * b + c) || 1);
  return ((kb + d) * sr) / nfft;
}

/**
 * Energia por banda num trecho (média de quadros de 4096 com sobreposição de 75%), como analyze.py.
 * Com mais de um canal, soma as potências (ouvidos): a soma mono de um sinal binaural cancela onde o ITD
 * dá meia volta de fase (0,65 ms → 770 Hz).
 */
export function bandas(x: ArrayLike<number> | ArrayLike<number>[], sr: number, ini: number, fim: number, faixas: readonly (readonly [number, number])[]) {
  const canais = Array.isArray(x) ? (x as ArrayLike<number>[]) : [x as ArrayLike<number>];
  const nseg = 4096, hop = 1024;
  const acc = new Float64Array(nseg / 2);
  let q = 0;
  for (const c of canais) for (let i = ini; i + nseg <= fim; i += hop) { const P = espectro(c, i, nseg, nseg); for (let k = 0; k < P.length; k++) acc[k] += P[k]; q++; }
  if (!q) for (const c of canais) { const P = espectro(c, ini, Math.max(64, fim - ini), nseg); for (let k = 0; k < P.length; k++) acc[k] += P[k]; q++; }
  return faixas.map(([a, b]) => {
    let s = 0;
    for (let k = 0; k < acc.length; k++) { const f = (k * sr) / nseg; if (f >= a && f < b) s += acc[k]; }
    return s / q;
  });
}

export const FAIXAS_PROJETO: readonly (readonly [number, number])[] = [[60, 150], [150, 400], [400, 1000], [1000, 2500], [2500, 6000], [6000, 12000]];

/** dB relativos à banda 150–400 Hz (tabela do projeto) e o centroide */
export function balanco(x: ArrayLike<number> | ArrayLike<number>[], sr: number, ini: number, fim: number) {
  const canais = Array.isArray(x) ? (x as ArrayLike<number>[]) : [x as ArrayLike<number>];
  const e = bandas(canais, sr, ini, fim, FAIXAS_PROJETO);
  const ref = e[1];
  const rel = e.map((v) => 10 * Math.log10(v / ref + 1e-30));
  // centroide
  const nseg = 4096; let num = 0, den = 0;
  for (const c of canais) for (let i = ini; i + nseg <= fim; i += 2048) { const P = espectro(c, i, nseg, nseg); for (let k = 1; k < P.length; k++) { const f = (k * sr) / nseg; if (f > 20) { num += f * P[k]; den += P[k]; } } }
  return { rel, centroide: num / (den || 1) };
}

/** nível A (ou Z) com constante de tempo 'F' (125 ms), em dB SPL, uma amostra a cada `passo` */
export function nivelF(L: Float32Array, R: Float32Array, sr: number, escala: number, ponderarA = true, passo = 480) {
  const fa = [new PonderacaoA(sr), new PonderacaoA(sr)], k = k1(sr, 1 / (2 * Math.PI * 0.125));
  let e = 0; const out: number[] = [];
  for (let i = 0; i < L.length; i++) {
    let l = L[i] * escala, r = R[i] * escala;
    if (ponderarA) { l = fa[0].run(l); r = fa[1].run(r); }
    e += k * (0.5 * (l * l + r * r) - e);
    if (i % passo === 0) out.push(10 * Math.log10(e / 4e-10 + 1e-30));
  }
  return out;
}

/** L_eq (dB SPL, A ou Z) num trecho [ini, fim) amostras */
export function leq(L: Float32Array, R: Float32Array, sr: number, escala: number, ini: number, fim: number, ponderarA = true) {
  const fa = [new PonderacaoA(sr), new PonderacaoA(sr)];
  let e = 0;
  // aquece os filtros 0,2 s antes
  for (let i = Math.max(0, ini - Math.round(0.2 * sr)); i < fim; i++) {
    let l = L[i] * escala, r = R[i] * escala;
    if (ponderarA) { l = fa[0].run(l); r = fa[1].run(r); }
    if (i >= ini) e += 0.5 * (l * l + r * r);
  }
  return 10 * Math.log10(e / (fim - ini) / 4e-10 + 1e-30);
}

/** envoltória dos dois ouvidos (média das potências), em dB */
export function envoltoriaEst(L: ArrayLike<number>, R: ArrayLike<number>, sr: number, fa: number, fb: number, jan = 0.02, passo = 0.005) {
  const a = envoltoria(L, sr, fa, fb, jan, passo), b = envoltoria(R, sr, fa, fb, jan, passo);
  return a.map((x, i) => 10 * Math.log10(0.5 * (Math.pow(10, x / 10) + Math.pow(10, b[i] / 10))));
}

/** envoltória RMS (dB) de janelas de `jan` s numa banda [fa, fb], uma amostra a cada `passo` s */
export function envoltoria(x: ArrayLike<number>, sr: number, fa: number, fb: number, jan = 0.02, passo = 0.005) {
  const f = [new Bq().hp(sr, fa, 0.7071), new Bq().hp(sr, fa, 0.7071), new Bq().lp(sr, fb, 0.7071), new Bq().lp(sr, fb, 0.7071)];
  const y = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) { let v = x[i]; for (const b of f) v = b.run(v); y[i] = v * v; }
  const n = Math.round(jan * sr), h = Math.round(passo * sr);
  const out: number[] = [];
  let s = 0;
  for (let i = 0; i < n && i < y.length; i++) s += y[i];
  for (let i = 0; i + n < y.length; i += h) {
    out.push(10 * Math.log10(s / n + 1e-30));
    for (let j = 0; j < h && i + j + n < y.length; j++) s += y[i + j + n] - y[i + j];
  }
  return out;   // out[m] cobre [m·passo, m·passo + jan]
}

export function percentil(v: number[], p: number) { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))]; }

/** pico do espectro de uma série (envoltória), em Hz, entre fMin e fMax */
export function picoDaSerie(v: number[], taxa: number, fMin: number, fMax: number) {
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  const x = v.map((a) => a - m);
  return picoEm(x, taxa, x.length / 2 / taxa, x.length / taxa, fMin, fMax, 16);
}

/**
 * RT60 por regressão na curva de Schroeder (T20 × 3: de −5 a −25 dB) de uma resposta filtrada em banda.
 * A geração separa as bandas em 250, 1k e 4k Hz (Butterworth de 8ª ordem).
 */
export function rt60(h: Float32Array, sr: number, fc: number) {
  // banda de 1 oitava em torno de fc, 8ª ordem de cada lado (as oitavas de 125, 500, 2k e 8k Hz caem
  // dentro das bandas de geração, longe dos cortes em 250, 1k e 4k)
  const fa = fc / Math.SQRT2, fb = Math.min(fc * Math.SQRT2, 0.45 * sr);
  const f: Bq[] = [];
  for (let i = 0; i < 4; i++) f.push(new Bq().hp(sr, fa), new Bq().lp(sr, fb));
  const y = new Float64Array(h.length);
  for (let i = 0; i < h.length; i++) { let v = h[i]; for (const b of f) v = b.run(v); y[i] = v * v; }
  const sch = new Float64Array(h.length);
  let acc = 0;
  for (let i = h.length - 1; i >= 0; i--) { acc += y[i]; sch[i] = acc; }
  const db = (i: number) => 10 * Math.log10(sch[i] / sch[0] + 1e-30);
  let i5 = -1, i25 = -1;
  for (let i = 0; i < h.length; i++) { const d = db(i); if (i5 < 0 && d <= -5) i5 = i; if (d <= -25) { i25 = i; break; } }
  if (i5 < 0 || i25 < 0) return NaN;
  // regressão linear entre i5 e i25
  let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
  for (let i = i5; i <= i25; i += 16) { const t = i / sr, d = db(i); sx += t; sy += d; sxx += t * t; sxy += t * d; n++; }
  const inc = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  return -60 / inc;
}
