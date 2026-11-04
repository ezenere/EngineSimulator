// Peças comuns das ferramentas do radial (tools/radial-*.ts): presets, DSP calibrado, cenários e o laço de render.
//
// Cenários (RADIAL.md 8): `idle` (quente, 20 s), `cold` (a −5 °C ou 20 °C, partida e 30 s), `start` (partida completa, 30 s:
// energizar/engatar ou girar, contagem de pás, pegar, aquecer), `runup` (lenta → plena em 10 s com a hélice),
// `takeoff` (plena carga, passo no máximo), `magcheck` (1 700 rpm, um magneto de cada vez), `shutdown` (mistura em corte).
// O laço é o do tools/render.ts: eventos no começo de cada bloco de 128 amostras, telemetria a cada bloco.
import { RadialDSP } from '../src/engines/radial/dsp';
import { configCalibrada } from '../src/engines/radial/config';
import { PRESETS_RADIAL, PADRAO_RADIAL, type PresetRadial } from '../src/engines/radial/presets';

export const SR = 48000;
export type Evento = [number, ((d: RadialDSP) => void) | null];

export const preset = (id: string) => {
  const p = PRESETS_RADIAL.find((x) => x.id === id);
  if (!p) throw new Error(`preset radial ${id} não existe`);
  return { ...PADRAO_RADIAL, ...p } as PresetRadial & Record<string, any>;
};

const cache = new Map<string, any>();
export function cfgCalibrada(spec: any) {
  const k = JSON.stringify(spec);
  if (!cache.has(k)) cache.set(k, configCalibrada(spec, SR));
  return { ...cache.get(k) };
}

/** DSP com o preset calibrado, ouvinte e temperatura; `quente` põe o motor já funcionando na lenta (sem partida) */
export function novoDSP(spec: any, op: { ouvinte?: string; temp?: number; quente?: boolean; master?: number } = {}) {
  const d = new RadialDSP(SR);
  d.setConfig(cfgCalibrada(spec));
  d.message({ type: 'params', params: { listener: op.ouvinte || 'ext', master: op.master ?? 0.8, ambSound: false } });
  if (op.quente) {
    d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } });
    d.coolant = 90; d.ambientT = 20; d.state = 'run'; d.ignition = true; d.runT = 120; d.fase = 'pegou';
    d.omega = (spec.idle * 2 * Math.PI) / 60; d.rpmAvg = spec.idle; d.exhT = 320; d.warm = 1;
  } else {
    const t = op.temp ?? 20;
    d.ambientT = t; d.coolant = t; d.exhT = t;
  }
  return d;
}

export type Tele = Record<string, any> & { t: number };

/** renderiza `dur` s com os eventos; devolve o estéreo e a telemetria (a cada bloco de 1024) */
export function renderizar(d: RadialDSP, dur: number, eventos: Evento[] = [], cada?: (d: RadialDSP, t: number) => void) {
  const n = Math.round(dur * SR), B = 128;
  const L = new Float32Array(n), R = new Float32Array(n);
  const bl = new Float32Array(B), br = new Float32Array(B);
  const tele: Tele[] = [];
  const evs = [...eventos].sort((a, b) => a[0] - b[0]);
  let ei = 0;
  d.post = (m: any) => { tele.push({ ...m, t: pos / SR }); };
  let pos = 0;
  while (pos < n) {
    const t = pos / SR;
    while (ei < evs.length && evs[ei][0] <= t) { evs[ei][1]?.(d); ei++; }
    cada?.(d, t);
    const m = Math.min(B, n - pos);
    d.process(bl, br, m);
    L.set(bl.subarray(0, m), pos); R.set(br.subarray(0, m), pos);
    pos += m;
  }
  d.post = null;
  return { L, R, tele };
}

export const media = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
export const desvio = (xs: number[]) => { const m = media(xs); return Math.sqrt(media(xs.map((x) => (x - m) ** 2))); };
export const trecho = (tele: Tele[], t0: number, t1: number) => tele.filter((x) => x.t >= t0 && x.t < t1);

/** monofônico (média L/R) de um trecho */
export function mono(L: Float32Array, R: Float32Array, t0: number, t1: number) {
  const a = Math.round(t0 * SR), b = Math.min(L.length, Math.round(t1 * SR));
  const x = new Float64Array(Math.max(0, b - a));
  for (let i = 0; i < x.length; i++) x[i] = 0.5 * (L[a + i] + R[a + i]);
  return x;
}

export { PRESETS_RADIAL };
