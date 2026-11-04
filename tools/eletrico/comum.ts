// Peças comuns das ferramentas do Elétrico (tools/eletrico/): presets calibrados, render do motor sozinho (canais) e do
// portador, render pela Cena (CenaDSP cru: pressão de verdade), FFT, medida de linhas e bandas.
import { PRESETS_ELETRICO } from '../../src/engines/eletrico/presets';
import { prepararMotorEletrico, MotorEletrico, type CfgEletrico } from '../../src/engines/eletrico/motor';
import { montarPortadorEletrico } from '../../src/engines/eletrico/portador';
import type { PresetEletrico, ComandoEletrico } from '../../src/engines/eletrico/dsp';
import type { Portador, ComandoPortador } from '../../src/carriers/tipos';
import type { ConfigTrem } from '../../src/carriers/trem';
import { CenaDSP } from '../../src/scene/dsp-cena';
import type { Ambiente, Trajetoria, Ouvinte } from '../../src/scene/tipos';
import { ambientePassagem } from '../../src/scene/ambientes';
import { PonderacaoA } from '../../src/scene/filtros';
import { PA_FS } from '../../src/scene/constantes';

export const SR = 48000;
const cache = new Map<string, CfgEletrico>();
export function preset(id: string): PresetEletrico {
  const p = PRESETS_ELETRICO.find((x) => x.id === id);
  if (!p) throw new Error(`preset elétrico desconhecido: ${id}`);
  return p;
}
/** preset calibrado (kAbs pela sonda), guardado */
export function cfg(id: string | PresetEletrico, mod: Partial<PresetEletrico> = {}): CfgEletrico {
  const p = typeof id === 'string' ? preset(id) : id;
  const chave = `${p.id}|${JSON.stringify(mod)}`;
  let c = cache.get(chave);
  if (!c) { c = prepararMotorEletrico({ ...p, ...mod } as PresetEletrico, SR); cache.set(chave, c); }
  return c;
}
export function motor(id: string | PresetEletrico, mod: Partial<PresetEletrico> = {}) { const m = new MotorEletrico(SR); m.configurar(cfg(id, mod), SR); return m; }
export function portador(id: string | PresetEletrico, mod: Partial<PresetEletrico> = {}, trem: Partial<ConfigTrem> = {}) { return montarPortadorEletrico(cfg(id, mod), SR, trem); }

export type Evento = [number, (t: number) => void];

/**
 * Render do motor sozinho: os canais em Pa a 7,5 m (eventos no início do bloco de 128); `cada(t)` depois do bloco.
 * Devolve os canais inteiros (Float32Array por fonte) e a soma.
 */
export function renderMotor(m: MotorEletrico, dur: number, eventos: Evento[] = [], cada?: (t: number) => void, bloco = 128) {
  const N = Math.round(dur * SR), n = m.fontes.length;
  const canais = Array.from({ length: n }, () => new Float32Array(N));
  const tmp = Array.from({ length: n }, () => new Float32Array(bloco));
  const ev = [...eventos].sort((a, b) => a[0] - b[0]);
  let e = 0;
  for (let k = 0; k < N; k += bloco) {
    const t = k / SR;
    while (e < ev.length && ev[e][0] <= t) ev[e++][1](t);
    const b = Math.min(bloco, N - k);
    m.processar(tmp, b);
    for (let i = 0; i < n; i++) canais[i].set(tmp[i].subarray(0, b), k);
    cada?.(t + b / SR);
  }
  const soma = new Float32Array(N);
  for (const c of canais) for (let j = 0; j < N; j++) soma[j] += c[j];
  return { canais, soma, ids: m.fontes.map((f) => f.id) };
}

/** render do portador (física + canais), sem a Cena */
export function renderPortador(p: Portador, dur: number, eventos: Evento[] = [], cada?: (t: number) => void, bloco = 128) {
  const N = Math.round(dur * SR), n = p.fontes().length;
  const tmp = Array.from({ length: n }, () => new Float32Array(bloco));
  const soma = new Float32Array(N);
  const ev = [...eventos].sort((a, b) => a[0] - b[0]);
  let e = 0;
  for (let k = 0; k < N; k += bloco) {
    const t = k / SR;
    while (e < ev.length && ev[e][0] <= t) ev[e++][1](t);
    const b = Math.min(bloco, N - k);
    p.processar(tmp, b, 1 / SR);
    for (let i = 0; i < n; i++) { const x = tmp[i]; for (let j = 0; j < b; j++) soma[k + j] += x[j]; }
    cada?.(t + b / SR);
  }
  return soma;
}

/** render pela Cena (CenaDSP cru: Pa no ouvido, sem tanh nem master); devolve L, R */
export function renderCena(p: Portador, op: { amb?: Ambiente; traj?: Partial<Trajetoria>; ouv?: Partial<Ouvinte>; dur: number; s0?: number; eventos?: Evento[]; cada?: (t: number, d: CenaDSP) => void }) {
  const d = new CenaDSP(SR);
  d.cru = true;
  const amb = op.amb ?? ambientePassagem('ceu');
  const traj: Trajetoria = { tipo: 'reta', comprimento: 4000, raioCurva: 2000, lateral: 7.5, altitude: 0, sentido: 1, ...(op.traj || {}) };
  const ouv: Ouvinte = { modo: 'fixo', pos: [0, 0, 1.6], gimbal: { az: 90, el: 0, r: 7.5, alvo: 'corpo' }, local: 'fora', binaural: false, ...(op.ouv || {}) } as Ouvinte;
  d.message({ type: 'cena', amb, traj, ouv });
  d.montar(p);
  if (op.s0 !== undefined) d.message({ type: 'params', posicao: op.s0 });
  const N = Math.round(op.dur * SR), B = 128;
  const L = new Float32Array(N), R = new Float32Array(N), l = new Float32Array(B), r = new Float32Array(B), sl = new Float32Array(B), sr = new Float32Array(B);
  const ev = [...(op.eventos || [])].sort((a, b) => a[0] - b[0]);
  let e = 0;
  for (let k = 0; k < N; k += B) {
    const t = k / SR;
    while (e < ev.length && ev[e][0] <= t) ev[e++][1](t);
    const b = Math.min(B, N - k);
    d.process(l, r, b, sl, sr);
    // a Cena escreve em unidades do alto-falante (0 dBFS ≙ 124 dB SPL): volta para Pa
    for (let j = 0; j < b; j++) { L[k + j] = l[j] * PA_FS; R[k + j] = r[j] * PA_FS; }
    op.cada?.(t + b / SR, d);
  }
  return { L, R, d };
}

// ---------------------------------------------------------------- análise
export function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
const pot2 = (n: number) => { let p = 1; while (p < n) p <<= 1; return p; };

/** espectro de potência (Welch, Hann, 50%), PSD em Pa²/Hz por raia; devolve [f, P] */
export function welch(x: ArrayLike<number>, ini: number, fim: number, nper = 16384): [Float64Array, Float64Array] {
  const n = Math.min(nper, pot2(Math.max(16, fim - ini)) >> 0);
  const w = new Float64Array(n);
  let sw = 0;
  for (let i = 0; i < n; i++) { w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n); sw += w[i] * w[i]; }
  const P = new Float64Array(n / 2 + 1), re = new Float64Array(n), im = new Float64Array(n);
  let k = 0;
  for (let a = ini; a + n <= fim; a += n / 2, k++) {
    for (let i = 0; i < n; i++) { re[i] = x[a + i] * w[i]; im[i] = 0; }
    fft(re, im);
    for (let i = 0; i <= n / 2; i++) P[i] += ((re[i] * re[i] + im[i] * im[i]) / (sw * SR)) * (i > 0 && i < n / 2 ? 2 : 1);
  }
  if (k > 0) for (let i = 0; i <= n / 2; i++) P[i] /= k;
  const f = new Float64Array(n / 2 + 1);
  for (let i = 0; i <= n / 2; i++) f[i] = (i * SR) / n;
  return [f, P];
}

/** potência numa faixa (Pa²) */
export function potFaixa(f: Float64Array, P: Float64Array, a: number, b: number) { let s = 0; const df = f[1] - f[0]; for (let i = 0; i < f.length; i++) if (f[i] >= a && f[i] < b) s += P[i] * df; return s; }
export const BANDAS: [number, number][] = [[20, 60], [60, 150], [150, 400], [400, 1000], [1000, 2500], [2500, 6000], [6000, 12000]];
/** bandas em dB relativos a 150–400 Hz e centroide até 6 kHz (a convenção de 3) */
export function bandas(x: ArrayLike<number>, t0: number, t1: number) {
  const [f, P] = welch(x, Math.round(t0 * SR), Math.round(t1 * SR), 32768);
  const ref = potFaixa(f, P, 150, 400);
  const b = BANDAS.map(([a, c]) => 10 * Math.log10(potFaixa(f, P, a, c) / ref));
  let s = 0, sp = 0; for (let i = 0; i < f.length; i++) if (f[i] < 6000) { s += f[i] * P[i]; sp += P[i]; }
  return { b, centroide: s / sp };
}

/**
 * Linha mais forte entre fa e fb: frequência (FFT com zero-padding e interpolação parabólica no log) e nível (dB re
 * amplitude RMS de um seno, Pa). Janela de Hann sobre [t0, t1].
 */
export function linha(x: ArrayLike<number>, t0: number, t1: number, fa: number, fb: number, zp = 4) {
  const i0 = Math.round(t0 * SR), n = Math.round((t1 - t0) * SR), N = pot2(n * zp);
  const re = new Float64Array(N), im = new Float64Array(N);
  let sw = 0;
  for (let i = 0; i < n; i++) { const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n); re[i] = x[i0 + i] * w; sw += w; }
  fft(re, im);
  const ka = Math.max(1, Math.floor((fa * N) / SR)), kb = Math.min(N / 2 - 2, Math.ceil((fb * N) / SR));
  let kb2 = ka, m = -1;
  const mag = (k: number) => Math.hypot(re[k], im[k]);
  for (let k = ka; k <= kb; k++) { const v = mag(k); if (v > m) { m = v; kb2 = k; } }
  const a = Math.log(mag(kb2 - 1) + 1e-30), b = Math.log(mag(kb2) + 1e-30), c = Math.log(mag(kb2 + 1) + 1e-30);
  const d = a - 2 * b + c !== 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
  const f = ((kb2 + d) * SR) / N;
  const amp = (2 * Math.exp(b - 0.25 * (a - c) * d)) / sw;   // amplitude de pico
  return { f, amp, dB: 20 * Math.log10(amp / Math.SQRT2 / 2e-5) };
}

/** nível de uma linha em f (dB re Pa RMS) pela mesma janela, sem procurar (±0,5% de f) */
export function nivelEm(x: ArrayLike<number>, t0: number, t1: number, f: number, larg = 0.005) { return linha(x, t0, t1, f * (1 - larg), f * (1 + larg)); }

/** dB(A) RMS de um trecho (Pa) */
export function dBA(x: ArrayLike<number>, t0: number, t1: number) {
  const pa = new PonderacaoA(SR), i0 = Math.round(t0 * SR), i1 = Math.round(t1 * SR);
  const b = new Float64Array(i1 - i0);
  for (let i = 0; i < b.length; i++) b[i] = x[i0 + i];
  pa.bloco(b, b.length);
  let s = 0; const cut = Math.min(b.length >> 2, Math.round(0.05 * SR));
  for (let i = cut; i < b.length; i++) s += b[i] * b[i];
  return 10 * Math.log10(s / (b.length - cut) / 4e-10);
}
/** L_AF (rápido, 125 ms) máximo, dB(A) */
export function lafMax(x: ArrayLike<number>) {
  const pa = new PonderacaoA(SR), b = new Float64Array(x.length);
  for (let i = 0; i < b.length; i++) b[i] = x[i];
  pa.bloco(b, b.length);
  const k = 1 - Math.exp(-1 / (0.125 * SR));
  let e = 0, m = 0;
  for (let i = 0; i < b.length; i++) { e += k * (b[i] * b[i] - e); if (i > SR * 0.2 && e > m) m = e; }
  return 10 * Math.log10(m / 4e-10);
}
export const mono = (L: Float32Array, R: Float32Array) => { const m = new Float32Array(L.length); for (let i = 0; i < L.length; i++) m[i] = 0.5 * (L[i] + R[i]); return m; };
export type { ComandoEletrico, ComandoPortador };
