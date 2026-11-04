// Peças comuns das ferramentas do rotativo (tools/rotativo-*.ts): presets, DSP calibrado, cenários e o laço de render.
//
// Cenários (ROTATIVO.md 8): `idle` (quente, na lenta), `cold` (partida a −5 °C ou 20 °C), `rev` (sustentado numa rotação),
// `wot` (pé no fundo em ponto morto), `sweep` (subida em carga numa marcha), `decel` (plena carga → pé fora), `start`.
// O laço é o do tools/render.ts: eventos no começo de cada bloco de 128 amostras, telemetria a cada 1 024 amostras.
import { RotativoDSP } from '../src/engines/rotativo/dsp';
import { configCalibrada } from '../src/engines/rotativo/config';
import { PRESETS_ROTATIVO, PADRAO_ROTATIVO, type PresetRotativo } from '../src/engines/rotativo/presets';

export const SR = 48000;
export type Evento = [number, ((d: RotativoDSP) => void) | null];

export const preset = (id: string, extra: Record<string, any> = {}) => {
  const p = PRESETS_ROTATIVO.find((x) => x.id === id);
  if (!p) throw new Error(`preset rotativo ${id} não existe`);
  return { ...PADRAO_ROTATIVO, ...p, ...extra } as PresetRotativo & Record<string, any>;
};

const cache = new Map<string, any>();
export function cfgCalibrada(spec: any) {
  const k = JSON.stringify(spec);
  if (!cache.has(k)) cache.set(k, configCalibrada(spec, SR));
  return { ...cache.get(k) };
}

/** DSP com o preset calibrado, ouvinte e temperatura; `quente` põe o motor já funcionando na lenta (sem partida) */
export function novoDSP(spec: any, op: { ouvinte?: string; temp?: number; quente?: boolean; master?: number; rpm?: number; env?: string } = {}) {
  const d = new RotativoDSP(SR);
  d.setConfig(cfgCalibrada(spec));
  d.message({ type: 'params', params: { listener: op.ouvinte || 'ext', master: op.master ?? 0.8, ambSound: false, env: op.env || 'open' } });
  if (op.quente) {
    d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } });
    const rpm = op.rpm ?? spec.idle;
    d.coolant = 90; d.ambientT = 20; d.state = 'run'; d.ignition = true; d.runT = 120; d.warm = 1;
    d.omega = (rpm * 2 * Math.PI) / 60; d.rpmAvg = rpm; d.exhT = 450;
  } else {
    const t = op.temp ?? 20;
    d.ambientT = t; d.coolant = t; d.exhT = t;
  }
  return d;
}

export type Tele = Record<string, any> & { t: number };

/** renderiza `dur` s com os eventos; devolve o estéreo e a telemetria */
export function renderizar(d: RotativoDSP, dur: number, eventos: Evento[] = [], cada?: (d: RotativoDSP, t: number) => void) {
  const n = Math.round(dur * SR), B = 128;
  const L = new Float32Array(n), R = new Float32Array(n);
  const bl = new Float32Array(B), br = new Float32Array(B);
  const tele: Tele[] = [];
  const evs = [...eventos].sort((a, b) => a[0] - b[0]);
  let ei = 0, pos = 0;
  d.post = (m: any) => { tele.push({ ...m, t: pos / SR }); };
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

/** rotação travada (dinamômetro): o eixo fica em `rpm` e o acelerador em `thr` */
export function travar(d: RotativoDSP, rpm: number, thr: number) {
  d.lockOmega = true; d.omega = (rpm * 2 * Math.PI) / 60; d.rpmAvg = rpm; d.thrTarget = thr; d.thr = thr;
}

/** giro sustentado em ponto morto: eixo travado em `rpm` e o acelerador ajustado até o torque médio zerar (o motor solto
 *  segurando a rotação, como o operador no vídeo); devolve o `cada` para o renderizar */
export function sustentar(d: RotativoDSP, rpm: number, thr0 = 0.15) {
  travar(d, rpm, thr0);
  return (x: RotativoDSP) => { const k = clamp01(x.thrTarget - (2e-4 * x.tqMean) / Math.max(1, x.Tmax / 100)); x.thrTarget = k; };
}
const clamp01 = (v: number) => Math.min(1, Math.max(0.005, v));

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

export { PRESETS_ROTATIVO };
