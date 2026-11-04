// Estouros ("pipocos") e falhas do radial e da aviação a pistão, por regime (REVISAO-DE-SOM.md: curtose e picos por
// segundo do agudo; RADIAL.md 3.4). O mesmo detector do pops.py dos rotativos sobre a saída do DSP da página (ouvinte de
// fora, 5 m do cubo, sem o som de fundo), mais o que o DSP fez por dentro:
//  - est/s: picos isolados da envoltória 1–6 kHz mais de 10 dB sobre a mediana móvel de 0,3 s, espaçados ≥ 25 ms;
//    `fortes/s`: os picos acima de 16 dB; `hmax` o mais alto (dB) e `>20` quantos passam de 20 dB; `curt`: curtose de 2–6 kHz em blocos de 0,5 s (mediana e p90);
//  - inj/s: estouros injetados no escape (`pops` do EngineDSP); falha: fração das centelhas sem queima.
// Regimes: partida (a frio, 15 °C, janelas contadas de quando pegou), lenta quente, manete toda (subida), manete pela
// metade e corte da manete (desaceleração), e a desaceleração logo depois da partida (o motor ainda frio).
//
//   npx tsx tools/radial-estouros.ts [ids...]     (sem id: r1820 r1830 r2800 r2800turbo m14p r1340 c172)
import { preset, novoDSP, renderizar, mono, SR } from './radial-comum';
import { envoltoria } from './rotativo-bandas';
import { passaFaixa } from './radial-bandas';
import { EngineDSP } from '../src/engines/ronco/dsp';
import { configCalibrada } from '../src/engines/ronco/config';
import { ACESSORIOS_PADRAO, PRESETS_AVIACAO } from '../src/engines/ronco/presets';

export type MedidaEstouros = { est: number; alt: number; fortes: number; kmed: number; k90: number; hmax: number; n20: number };

function picos(x: Float64Array, h: number, dist: number) {
  const c: number[] = [];
  for (let i = 1; i < x.length - 1; i++) if (x[i] > x[i - 1] && x[i] >= x[i + 1] && x[i] >= h) c.push(i);
  c.sort((a, b) => x[b] - x[a]);
  const ok: number[] = [], usado = new Uint8Array(x.length);
  for (const i of c) { if (usado[i]) continue; ok.push(i); for (let j = Math.max(0, i - dist + 1); j < Math.min(x.length, i + dist); j++) usado[j] = 1; }
  return ok;
}
function medfilt(x: Float64Array, k: number) {
  const h = (k - 1) / 2, out = new Float64Array(x.length), jan = new Float64Array(k);
  for (let i = 0; i < x.length; i++) { for (let j = -h; j <= h; j++) { const q = i + j; jan[j + h] = q >= 0 && q < x.length ? x[q] : 0; } out[i] = Float64Array.from(jan).sort()[h]; }
  return out;
}
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.round((p / 100) * (s.length - 1)))] : NaN; };

/** o detector do pops.py e a curtose de 2–6 kHz em blocos de 0,5 s */
export function medirEstouros(seg: Float64Array, sr: number): MedidaEstouros {
  const dur = seg.length / sr;
  const e = envoltoria(seg, sr, 1000, 6000, 600);
  const d = Float64Array.from({ length: Math.floor(e.length / 48) }, (_, i) => e[i * 48]);
  const med = medfilt(d, 301), r = Float64Array.from(d, (v, i) => v / (med[i] + 1e-12));
  const pk = picos(r, 3.16, Math.round((0.025 * sr) / 48));
  const hs = pk.map((k) => r[k]);
  const y = passaFaixa(seg, sr, 2000, 6000), n = Math.floor(0.5 * sr), ks: number[] = [];
  for (let i = 0; i + n <= y.length; i += n) {
    let m = 0; for (let j = 0; j < n; j++) m += y[i + j]; m /= n;
    let v2 = 0, v4 = 0; for (let j = 0; j < n; j++) { const q = (y[i + j] - m) ** 2; v2 += q; v4 += q * q; }
    v2 /= n; v4 /= n; ks.push(v4 / (v2 * v2 + 1e-30));
  }
  return { est: pk.length / dur, alt: hs.length ? 20 * Math.log10(pct(hs, 50)) : 0, fortes: hs.filter((h) => h > 10 ** (16 / 20)).length / dur, hmax: hs.length ? 20 * Math.log10(Math.max(...hs)) : 0, n20: hs.filter((h) => h > 10).length, kmed: pct(ks, 50), k90: pct(ks, 90) };
}

type Contagem = { pops: number[]; centelhas: number[]; falhas: number[] };
/** conta estouros injetados e centelhas sem queima a cada bloco (tempo em s) */
function instrumentar(d: any): Contagem & { cada: (d: any, t: number) => void } {
  const c: Contagem = { pops: [], centelhas: [], falhas: [] };
  let tAgora = 0;
  const push = d.pops.push.bind(d.pops);
  d.pops.push = (...a: any[]) => { c.pops.push(tAgora); return push(...a); };
  let antes: Uint8Array | null = null;
  const cada = (dd: any, t: number) => {
    // (a centelha do bloco anterior: armado antes e desarmado depois)
    if (antes && dd.armed) for (let k = 0; k < dd.N; k++) if (antes[k] && !dd.armed[k] && dd.state === 'run') { c.centelhas.push(tAgora); if (!(dd.Q[k] > 0)) c.falhas.push(tAgora); }
    tAgora = t;
    if (dd.armed) antes = Uint8Array.from(dd.armed);
  };
  return { ...c, cada, pops: c.pops, centelhas: c.centelhas, falhas: c.falhas };
}

function novoAv(id: string, temp: number, quente: boolean) {
  const d: any = new EngineDSP(SR);
  const spec = { ...ACESSORIOS_PADRAO, ...PRESETS_AVIACAO.find((p) => p.id === id)! };
  d.setConfig(configCalibrada(spec, SR));
  d.message({ type: 'params', params: { listener: 'ext', master: 0.8, ambSound: false } });
  if (quente) {
    d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } });
    d.coolant = 90; d.ambientT = 20; d.state = 'run'; d.ignition = true; d.runT = 120;
    d.omega = (spec.idle * 2 * Math.PI) / 60; d.rpmAvg = spec.idle; d.exhT = 320; d.warm = 1;
  } else { d.ambientT = temp; d.coolant = temp; d.exhT = temp; }
  return d;
}
const eAv = (id: string) => PRESETS_AVIACAO.some((p) => p.id === id);
const criar = (id: string, quente: boolean) => (eAv(id) ? novoAv(id, 15, quente) : novoDSP(preset(id), quente ? { quente: true } : { temp: 15 }));

export type Regime = { regime: string; t0: number; t1: number; m: MedidaEstouros; inj: number; falha: number; rpm: number };

/** um cenário: eventos, duração e as janelas medidas (relativas ao início, ou a quando pegou com `dePega`) */
export function cenario(id: string, quente: boolean, dur: number, eventos: [number, (d: any) => void][], janelas: [string, number, number][], dePega = false): Regime[] {
  const d = criar(id, quente);
  const k = instrumentar(d);
  const r = renderizar(d, dur, eventos as any, k.cada);
  const tp = dePega ? (r.tele.find((q) => q.state === 'run')?.t ?? NaN) : 0;
  return janelas.map(([nome, a0, b0]) => {
    const a = tp + a0, b = Math.min(dur, tp + b0);
    const conta = (xs: number[]) => xs.filter((t) => t >= a && t < b).length;
    const cs = conta(k.centelhas), tl = r.tele.filter((q) => q.t >= a && q.t < b);
    return { regime: nome, t0: a, t1: b, m: medirEstouros(mono(r.L, r.R, a, b), SR), inj: conta(k.pops) / (b - a), falha: cs ? conta(k.falhas) / cs : NaN, rpm: tl.reduce((s, q) => s + q.rpm, 0) / Math.max(1, tl.length) };
  });
}

export const ign = (d: any) => d.message({ type: 'input', ignition: true });
export const eng = (d: any) => { if (d.engatar) d.engatar(); };
export const thr = (v: number) => (d: any) => d.message({ type: 'input', throttle: v });

/** todos os regimes de um preset */
export function regimes(id: string): Regime[] {
  return [
    ...cenario(id, false, 50, [[0, ign], [0.5, eng]], [['partida 0–3 s', 0, 3], ['partida 3–10 s', 3, 10], ['partida 10–20 s', 10, 20], ['partida 0–20 s', 0, 20], ['lenta fria 20–40 s', 20, 40]], true),
    // (motor recém-pegado: aos 12 s a manete vai toda por 6 s e volta à lenta, a desaceleração que o usuário faz logo de cara)
    ...cenario(id, false, 40, [[0, ign], [0.5, eng], [14, thr(1)], [20, thr(0)]], [['subida a frio (14–20 s)', 14.5, 20], ['desaceleração a frio (20–26 s)', 20, 26]]),
    ...cenario(id, true, 14, [], [['lenta quente', 3, 14]]),
    ...cenario(id, true, 10, [[2, thr(1)]], [['manete toda', 2.5, 10]]),
    ...cenario(id, true, 10, [[2, thr(0.5)]], [['manete na metade', 4, 10]]),
    ...cenario(id, true, 16, [[1, thr(1)], [8, thr(0)]], [['corte da manete (8–14 s)', 8, 14]]),
  ];
}

export const CAB = `${'preset'.padEnd(11)} ${'regime'.padEnd(32)} ${'rpm'.padStart(5)} ${'falha'.padStart(6)} ${'inj/s'.padStart(6)} | ${'est/s'.padStart(6)} ${'alt'.padStart(5)} ${'fortes'.padStart(6)} ${'curt'.padStart(5)} ${'c90'.padStart(5)} ${'hmax'.padStart(5)} ${'>20'.padStart(4)}`;
export const linhaRegime = (id: string, r: Regime) => {
  const f = (x: number, d = 1, w = 5) => (Number.isFinite(x) ? x.toFixed(d) : 'nan').padStart(w);
  return `${id.padEnd(11)} ${r.regime.padEnd(32)} ${f(r.rpm, 0)} ${f(100 * r.falha, 1, 5)}% ${f(r.inj, 2, 6)} | ${f(r.m.est, 2, 6)} ${f(r.m.alt)} ${f(r.m.fortes, 2, 6)} ${f(r.m.kmed)} ${f(r.m.k90)} ${f(r.m.hmax)} ${f(r.m.n20, 0, 4)}`;
};

if (process.argv[1] && process.argv[1].endsWith('radial-estouros.ts')) {
  const ids = process.argv.slice(2);
  console.log(CAB);
  for (const id of ids.length ? ids : ['r1820', 'r1830', 'r2800', 'r2800turbo', 'm14p', 'r1340', 'c172']) for (const r of regimes(id)) console.log(linhaRegime(id, r));
}
