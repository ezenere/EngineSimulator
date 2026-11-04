// Peças comuns das ferramentas do vapor (tools/vapor-*.ts): montar o VaporDSP de um preset (com ou sem a sonda de
// nível), renderizar com eventos no tempo e guardar canais e telemetria.
import { VaporDSP, type ComandoVapor } from '../src/engines/vapor/dsp';
import { presetVapor, escapesPorVolta, type PresetVapor } from '../src/engines/vapor/presets';
import { prepararMotorVapor } from '../src/engines/vapor/motor';

export const SR = 48000;
export const TAU = Math.PI * 2;

/** DSP do preset; `calibrado` roda a sonda de nível (Pa a 7,5 m), senão os ganhos ficam 1 (unidades internas) */
export function novoVapor(id: string | PresetVapor, calibrado = true, fs = SR) {
  const P = typeof id === 'string' ? presetVapor(id)! : id;
  if (!P) throw new Error(`preset ${id} não existe`);
  const d = new VaporDSP(fs);
  d.configurar(calibrado ? prepararMotorVapor(P, fs) : { preset: P, ganhos: {} }, fs);
  return d;
}

export type Evento = [number, (d: VaporDSP) => void];
export interface Render { canais: Float32Array[]; ids: string[]; tele: any[]; dur: number }

/** renderiza `dur` s em blocos de 128, eventos no início do bloco, telemetria a cada 1024 amostras */
export function renderVapor(d: VaporDSP, dur: number, ev: Evento[] = [], canaisQuero?: string[], fs = SR): Render {
  const B = 128, N = Math.round(dur * fs);
  const ids = d.fontes.map((f) => f.id);
  const quero = canaisQuero ? ids.map((id) => canaisQuero.includes(id)) : ids.map(() => true);
  const canais = ids.map((_, i) => (quero[i] ? new Float32Array(N) : new Float32Array(0)));
  const tmp = ids.map(() => new Float32Array(B));
  const fila = [...ev].sort((a, b) => a[0] - b[0]);
  const tele: any[] = [];
  let nt = 0;
  for (let i = 0; i < N; i += B) {
    const t = i / fs;
    while (fila.length && fila[0][0] <= t) fila.shift()![1](d);
    const n = Math.min(B, N - i);
    d.processar(tmp, n);
    for (let c = 0; c < ids.length; c++) if (quero[c]) canais[c].set(tmp[c].subarray(0, n), i);
    nt += n;
    if (nt >= 1024) { nt = 0; tele.push({ t: (i + n) / fs, ...d.telemetria() }); }
  }
  return { canais, ids, tele, dur };
}

/** soma de canais (mono) */
export function soma(r: Render, ids?: string[]) {
  const out = new Float64Array(r.canais.find((c) => c.length)?.length ?? 0);
  r.ids.forEach((id, c) => { if ((!ids || ids.includes(id)) && r.canais[c].length) { const x = r.canais[c]; for (let i = 0; i < x.length; i++) out[i] += x[i]; } });
  return out;
}

export const trecho = (x: ArrayLike<number>, fs: number, t0: number, t1: number) => Float64Array.from({ length: Math.max(0, Math.floor(t1 * fs) - Math.floor(t0 * fs)) }, (_, i) => x[Math.floor(t0 * fs) + i]);
export const media = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
export const rms = (x: ArrayLike<number>) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, x.length)); };
export const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-12));

/** ω da roda para uma taxa de chuffs */
export function omegaPorChuffs(d: VaporDSP, chuffsPorS: number) {
  return (chuffsPorS / escapesPorVolta(d.P)) * TAU;
}
export const comando = (c: Partial<ComandoVapor>) => (d: VaporDSP) => d.comandar({ acelerador: 0, ignicao: true, partida: false, ...c } as any);
