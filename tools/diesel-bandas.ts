// Análise de bandas do Diesel (DIESEL.md 2.6, 2.7, Apêndice A): porta em TypeScript de analyze2.py/ticks.py, os
// scripts que geraram as medidas das gravações. Mesmo método: Welch de 8192 pontos (Hann, 50%), bandas em dB
// relativas a 150–400 Hz, centroide de 100–8000 Hz, banda 1–4 kHz relativa, envoltória de Hilbert da banda 1–4 kHz
// (passa-faixa Butterworth de ordem 4 em ida e volta) com passa-baixa de 500 Hz, curtose da banda, p90/p10 da
// envoltória e tiques por ciclo (picos da envoltória: altura no percentil 60, distância mínima de 4 ms,
// proeminência 25% de p95 − limiar). Os filtros em ida e volta são feitos no domínio da frequência (o mesmo módulo
// do filtfilt; a diferença é só nas bordas).
//
//   npx tsx tools/diesel-bandas.ts <arquivo.wav> <t0> <t1> [N tempos rpm]   (imprime a linha da tabela)
import fs from 'node:fs';

export const BANDAS: [number, number][] = [[60, 150], [150, 400], [400, 1000], [1000, 2500], [2500, 6000], [6000, 12000], [30, 60]];

// FFT radix-2 complexa, no lugar
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

// densidade espectral de Welch (escala relativa): devolve [frequências, potência]
export function welch(x: Float64Array | Float32Array, sr: number, nper = 8192): [Float64Array, Float64Array] {
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
  const f = Float64Array.from({ length: nper / 2 + 1 }, (_, k) => (k * sr) / nper);
  return [f, P];
}

const db = (v: number) => 10 * Math.log10(v + 1e-12);

export function bandas(x: Float64Array | Float32Array, sr: number) {
  const [f, P] = welch(x, sr);
  const soma = (a: number, b: number) => { let s = 0; for (let k = 0; k < f.length; k++) if (f[k] >= a && f[k] < b) s += P[k]; return s; };
  const e = BANDAS.map(([a, b]) => soma(a, b));
  const ref = e[1] + 1e-20;
  let num = 0, den = 0;
  for (let k = 0; k < f.length; k++) if (f[k] > 100 && f[k] < 8000) { num += f[k] * P[k]; den += P[k]; }
  let tot = 0; for (let k = 1; k < f.length; k++) tot += P[k];
  let ms = 0; for (let i = 0; i < x.length; i++) ms += x[i] * x[i]; ms /= Math.max(1, x.length);
  return { b: e.map((v) => db(v / ref)), cen: num / (den + 1e-20), k14: db(soma(1000, 4000) / ref), nivel: db(ms), ref: db(ms * ref / (tot + 1e-30)) };
}

// passa-faixa Butterworth de ordem n (por borda) em ida e volta, mais a envoltória de Hilbert; tudo pela FFT
export function bandaEEnvoltoria(x: Float64Array | Float32Array, sr: number, lo: number, hi: number, lpEnv = 500) {
  const n0 = x.length; let n = 1; while (n < n0) n <<= 1;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n0; i++) re[i] = x[i];
  fft(re, im);
  const w0 = Math.sqrt(lo * hi), B = hi - lo;
  const yR = new Float64Array(n), yI = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const fk = (k <= n / 2 ? k : n - k) * sr / n;
    const Om = fk > 0 ? (fk * fk - w0 * w0) / (fk * B) : 1e9;
    const H2 = 1 / (1 + Math.pow(Om, 8)); // |H|² de uma passada = módulo da ida e volta
    // sinal filtrado (real) e analítico (só frequências positivas, dobradas)
    yR[k] = re[k] * H2; yI[k] = im[k] * H2;
    const g = k === 0 || k === n / 2 ? 1 : k < n / 2 ? 2 : 0;
    re[k] *= H2 * g; im[k] *= H2 * g;
  }
  fft(yR, yI, true); fft(re, im, true);
  const y = new Float64Array(n0), e = new Float64Array(n);
  for (let i = 0; i < n0; i++) { y[i] = yR[i]; e[i] = Math.hypot(re[i], im[i]); }
  // passa-baixa de 2ª ordem (ida e volta) na envoltória
  const eI = new Float64Array(n);
  fft(e, eI);
  for (let k = 0; k < n; k++) { const fk = (k <= n / 2 ? k : n - k) * sr / n; const g = 1 / (1 + Math.pow(fk / lpEnv, 4)); e[k] *= g; eI[k] *= g; }
  fft(e, eI, true);
  return { y, env: e.subarray(0, n0) };
}

const percentil = (x: ArrayLike<number>, p: number) => { const s = Float64Array.from(x).sort(); const i = (p / 100) * (s.length - 1), a = Math.floor(i); return s[a] + (s[Math.min(s.length - 1, a + 1)] - s[a]) * (i - a); };

export function curtose(y: Float64Array) {
  let m = 0; for (const v of y) m += v; m /= y.length;
  let v2 = 0, v4 = 0; for (const v of y) { const d = v - m; v2 += d * d; v4 += d * d * d * d; }
  v2 /= y.length; v4 /= y.length;
  return v4 / (v2 * v2 + 1e-30);
}

// scipy.signal.find_peaks com height, distance e prominence (mesma semântica)
export function acharPicos(x: Float64Array, altura: number, dist: number, prom: number) {
  let pk: number[] = [];
  for (let i = 1; i < x.length - 1; i++) {
    if (x[i] > x[i - 1]) {
      let j = i; while (j + 1 < x.length && x[j + 1] === x[i]) j++;
      if (j + 1 < x.length && x[j + 1] < x[i]) { pk.push((i + j) >> 1); i = j; }
    }
  }
  pk = pk.filter((i) => x[i] >= altura);
  // distância: mantém os mais altos, tira os vizinhos a menos de `dist`
  if (dist > 1 && pk.length) {
    const ordem = pk.map((_, k) => k).sort((a, b) => x[pk[b]] - x[pk[a]]);
    const fora = new Uint8Array(pk.length);
    for (const k of ordem) {
      if (fora[k]) continue;
      for (let j = k - 1; j >= 0 && pk[k] - pk[j] < dist; j--) fora[j] = 1;
      for (let j = k + 1; j < pk.length && pk[j] - pk[k] < dist; j++) fora[j] = 1;
    }
    pk = pk.filter((_, k) => !fora[k]);
  }
  // proeminência: altura sobre o mais alto dos dois mínimos até um pico mais alto (ou a borda)
  return pk.filter((i) => {
    let mL = x[i]; for (let j = i - 1; j >= 0 && x[j] <= x[i]; j--) mL = Math.min(mL, x[j]);
    let mR = x[i]; for (let j = i + 1; j < x.length && x[j] <= x[i]; j++) mR = Math.min(mR, x[j]);
    return x[i] - Math.max(mL, mR) >= prom;
  });
}

// a linha da tabela do Apêndice A para um trecho mono
export function analisar(x: Float64Array | Float32Array, sr: number, rpm = 0, N = 4, tempos = 4) {
  const { b, cen, k14, nivel, ref } = bandas(x, sr);
  const { y, env } = bandaEEnvoltoria(x, sr, 1000, 4000, 500);
  const k = curtose(y);
  const p90 = percentil(env, 90), p10 = percentil(env, 10);
  // tiques: envoltória decimada por 4, como em ticks() de analyze2.py
  const dec = 4, es = new Float64Array(Math.floor(env.length / dec));
  for (let i = 0; i < es.length; i++) es[i] = env[i * dec];
  const fse = sr / dec, thr = percentil(es, 60);
  const idx = acharPicos(es, thr, Math.floor(0.004 * fse), 0.25 * (percentil(es, 95) - thr));
  const porS = idx.length / (es.length / fse);
  const fCiclo = rpm / 60 / (tempos / 2);
  // CV do knock (real3/RESUMO.md): altura da envoltória 1–4 kHz em cada intervalo de ignição a[i]; em janelas de 3 s,
  // std(a[i+1] − a[i])/(√2·média(a)); a mediana das janelas
  let cv = NaN;
  if (fCiclo > 0) {
    const Lg = Math.max(8, Math.round(sr / (fCiclo * N))), a: number[] = [];
    for (let i = 0; i + Lg <= env.length; i += Lg) { let m = 0; for (let k = i; k < i + Lg; k++) if (env[k] > m) m = env[k]; a.push(m); }
    const porJ = Math.max(4, Math.round((3 * sr) / Lg)), cvs: number[] = [];
    for (let j = 0; j + porJ <= a.length || (j === 0 && a.length >= 4); j += porJ) {
      const w = a.slice(j, j + porJ); if (w.length < 4) break;
      const d = w.slice(1).map((v, k) => v - w[k]), md = d.reduce((x, y) => x + y, 0) / d.length;
      const sd = Math.sqrt(d.reduce((x, y) => x + (y - md) * (y - md), 0) / d.length), mw = w.reduce((x, y) => x + y, 0) / w.length;
      cvs.push(sd / (Math.SQRT2 * mw + 1e-30));
      if (j + porJ > a.length) break;
    }
    cvs.sort((x, y) => x - y); if (cvs.length) cv = cvs[Math.floor(cvs.length / 2)];
  }
  return {
    nivel, ref, b30: b[6], b60: b[0], b400: b[2], b1k: b[3], b25k: b[4], b6k: b[5], cen, k14, curtose: k, p9010: 20 * Math.log10(p90 / (p10 + 1e-12)),
    tiquesPorS: porS, tiquesPorCiclo: fCiclo ? porS / fCiclo : 0, tiquesPorEvento: fCiclo ? porS / fCiclo / N : 0, cv,
  };
}

// Envoltória de uma banda (REVISAO-DE-SOM.md: "ruído contínuo que sobe com o giro e enche o silêncio entre as
// explosões soa como mar: exigir modulação"). Passa-faixa Butterworth de ordem 4 em ida e volta, |Hilbert|, passa-baixa
// de 600 Hz, decimada a 2,4 kHz. Devolve o contraste p90/p10 (dB), a modulação na ignição m1 (amplitude da linha da
// envoltória em f_ign ±3%, menos o piso vizinho, sobre a média: 0 = ruído liso, 1 = 100%), o p10 relativo à banda
// 150–400 Hz (o "vão" entre as explosões) e o nível da banda relativo a 150–400 Hz. É a mesma conta do script de
// análise das gravações do real3 (modul.py, na pasta de rascunho da revisão).
export function envoltoriaBanda(x: Float64Array | Float32Array, sr: number, lo: number, hi: number, fIgn: number) {
  const { y, env } = bandaEEnvoltoria(x, sr, lo, hi, 600);
  const r = bandaEEnvoltoria(x, sr, 150, 400, 600).y;
  let er = 0, eb = 0; for (let i = 0; i < y.length; i++) { er += r[i] * r[i]; eb += y[i] * y[i]; }
  const lref = 10 * Math.log10(er / y.length + 1e-30);
  const q = Math.max(1, Math.round(sr / 2400)), fe = sr / q, e = new Float64Array(Math.floor(env.length / q));
  for (let i = 0; i < e.length; i++) e[i] = env[i * q];
  const p90 = percentil(e, 90), p10 = percentil(e, 10);
  let m = 0; for (const v of e) m += v; m /= e.length;
  // Welch da envoltória sem a média (Hann, 8192 pontos ≈ 3,4 s, 50%): a linha de amplitude A soma A²·N·Σw²/4 no lóbulo
  const nper = 8192, hop = nper / 2, w = Float64Array.from({ length: nper }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / nper));
  let sw2 = 0; for (const v of w) sw2 += v * v;
  const P = new Float64Array(nper / 2 + 1), re = new Float64Array(nper), im = new Float64Array(nper);
  let ns = 0;
  for (let s = 0; s + nper <= e.length; s += hop) {
    for (let i = 0; i < nper; i++) { re[i] = (e[s + i] - m) * w[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k <= nper / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k];
    ns++;
  }
  let m1 = NaN;
  if (ns && fIgn > 0 && fIgn < 550) {
    const df = fe / nper, sel: number[] = [], viz: number[] = [];
    for (let k = 0; k <= nper / 2; k++) {
      const f = k * df;
      if (f >= fIgn * 0.97 && f <= fIgn * 1.03) sel.push(P[k] / ns);
      else if ((f >= fIgn * 0.85 && f < fIgn * 0.93) || (f > fIgn * 1.07 && f <= fIgn * 1.15)) viz.push(P[k] / ns);
    }
    const piso = viz.length ? percentil(viz, 50) : 0;
    const lin = sel.reduce((a, b) => a + b, 0) - piso * sel.length;
    m1 = Math.sqrt(Math.max(0, (4 * lin) / (nper * sw2))) / (m + 1e-30);
  }
  return { p9010: 20 * Math.log10(p90 / (p10 + 1e-30)), m1, p10ref: 20 * Math.log10(p10 + 1e-30) - lref, rel: 10 * Math.log10(eb / y.length + 1e-30) - lref };
}

// leitura de WAV (PCM 16/24/32 ou float 32), mono pela média dos canais
export function lerWavMono(arq: string): { x: Float64Array; sr: number } {
  const buf = fs.readFileSync(arq);
  let p = 12, sr = 48000, ch = 1, bits = 16, fmt = 1, dados: Buffer | null = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4), sz = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') { fmt = buf.readUInt16LE(p + 8); ch = buf.readUInt16LE(p + 10); sr = buf.readUInt32LE(p + 12); bits = buf.readUInt16LE(p + 22); }
    else if (id === 'data') { dados = buf.subarray(p + 8, p + 8 + sz); break; }
    p += 8 + sz + (sz & 1);
  }
  if (!dados) throw new Error(`${arq}: sem dados`);
  const bps = bits / 8, n = Math.floor(dados.length / (bps * ch)), x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < ch; c++) {
      const o = (i * ch + c) * bps;
      s += fmt === 3 ? dados.readFloatLE(o) : bits === 16 ? dados.readInt16LE(o) / 32768 : bits === 24 ? dados.readIntLE(o, 3) / 8388608 : dados.readInt32LE(o) / 2147483648;
    }
    x[i] = s / ch;
  }
  return { x, sr };
}

const fmt = (v: number, c = 1) => v.toFixed(c).padStart(6);
export const linha = (r: ReturnType<typeof analisar>) =>
  `${fmt(r.nivel)} ${fmt(r.ref)} | ${fmt(r.b30)} ${fmt(r.b60)} ${fmt(r.b400)} ${fmt(r.b1k)} ${fmt(r.b25k)} ${fmt(r.b6k)} ${fmt(r.cen, 0)} | ${fmt(r.k14)} ${fmt(r.curtose)} ${fmt(r.p9010)} ${fmt(r.tiquesPorCiclo)} ${fmt(r.tiquesPorEvento, 2)} ${fmt(r.cv, 2)}`;

if (process.argv[1] && process.argv[1].endsWith('diesel-bandas.ts')) {
  const [arq, t0, t1, N, tempos, rpm] = process.argv.slice(2);
  if (!arq) { console.error('uso: tsx tools/diesel-bandas.ts <arquivo.wav> <t0> <t1> [N tempos rpm]'); process.exit(2); }
  const { x, sr } = lerWavMono(arq);
  const seg = x.subarray(Math.floor(+(t0 || 0) * sr), t1 ? Math.floor(+t1 * sr) : x.length);
  console.log(' nivel    ref |  30-60 60-150 400-1k 1-2.5k 2.5-6k 6-12k   cen |   1-4k  curt p90/10 tq/cic tq/ev    CV');
  console.log(linha(analisar(seg, sr, +(rpm || 0), +(N || 4), +(tempos || 4))));
}
