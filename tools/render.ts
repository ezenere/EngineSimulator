// Renderiza cenários do Ronco e da Turbina para WAV + telemetria JSON, fora do navegador.
// Adaptado dos harnesses render.js e jetrender.js usados na revisão do som.
//
//   npx tsx tools/render.ts ronco   <presets> <cenário> <pasta> [ouvinte] [--pcm16]
//   npx tsx tools/render.ts turbina <presets> <cenário> <pasta> [ouvinte] [--pcm16]
//   npx tsx tools/render.ts tom     <freq_Hz> <pasta>
//
//   presets: um id, vários separados por vírgula, ou "all"
//   cenários do Ronco: idle, cold, rev, wot, sweep · da Turbina: start, takeoff, flyby
//   ouvinte: Ronco ext (padrão), pipe, int, bay… · Turbina ground (padrão), cabin, cockpit…
//   --pcm16: grava PCM 16 bits como os harnesses antigos (o padrão é float 32, para comparar amostra a amostra)
//
//   DSP=<arquivo>  usa outro DSP: um legado CommonJS que exporta a fábrica (ex.: git show master:src/dsp.js > /tmp/dsp.master.js)
//                  ou um módulo TS/ES que exporta EngineDSP / JetDSP (ex.: src/engines/ronco/dsp.ts, depois da migração)
//   PRESETS=<arquivo>, GEOMETRY=<arquivo>  idem para os presets e a geometria
//
// Por padrão usa o DSP legado em src/dsp.js e src/jet-dsp.js.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { gravarWav } from './wav';
import { TomDSP } from '../src/worklet/tom';
import { ACESSORIOS_PADRAO as STOCK } from '../src/engines/ronco/presets';
import { montarConfig } from '../src/engines/ronco/config';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(import.meta.url);
const SR = 48000;
const B = 128; // bloco do AudioWorklet

// Carrega um módulo legado (fábrica CJS) ou novo (exports nomeados / default).
function carregar(arquivo: string, nome: string) {
  const m = req(path.resolve(RAIZ, arquivo));
  if (typeof m === 'function') return m(); // fábrica legada: EngineDSPFactory() / JetDSPFactory()
  if (m[nome]) return m;
  if (m.default) return typeof m.default === 'function' && !m.default.prototype?.process ? m.default() : m.default;
  throw new Error(`${arquivo}: não achei ${nome}`);
}
const lista = (arquivo: string) => { const m = req(path.resolve(RAIZ, arquivo)); return m.default ?? m.PRESETS ?? m; };

// ------------------------------------------------------------------ Ronco

type Evento = [number, (() => void) | null];
type Cenario = Evento[] & { autoShift?: boolean };

// Cenários: lista de [tempo (s), ação]; a última entrada marca o fim
const CEN_RONCO: Record<string, (d: any, spec: any) => Cenario> = {
  // marcha lenta quente, 12 s
  idle: (d) => [[0, () => { d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } }); d.message({ type: 'input', ignition: true }); }], [12, null]],
  // partida a frio real
  cold: (d) => [[0, () => { d.message({ type: 'input', temp: { mode: 'real', value: 20 } }); d.message({ type: 'input', ignition: true }); }], [12, null]],
  // em neutro: lenta, depois pé no fundo até o corte, segura, solta
  rev: (d) => [[0, () => { d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } }); d.message({ type: 'input', ignition: true }); }],
    [3, () => d.message({ type: 'input', throttle: 1 })], [6.5, () => d.message({ type: 'input', throttle: 0 })], [10, null]],
  // arrancada em 1ª-2ª-3ª com pé no fundo (troca perto do corte)
  wot: (d) => {
    const ev: Cenario = [[0, () => { d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } }); d.message({ type: 'input', ignition: true }); }],
      [2.5, () => { d.message({ type: 'input', shift: 1 }); d.message({ type: 'input', throttle: 1 }); }]];
    ev.push([16, () => d.message({ type: 'input', throttle: 0 })]);
    ev.push([20, null]);
    ev.autoShift = true; return ev;
  },
  // rotação travada em carga (como a calibração): 4 patamares de 1,5 s
  sweep: (d, spec) => {
    const ev: Cenario = [[0, () => { d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } }); d.state = 'run'; d.lockOmega = true; d.thrTarget = 1; d.thr = 1; }]];
    const steps = [0.25, 0.45, 0.65, 0.9];
    steps.forEach((f, i) => ev.push([i * 1.5, () => { d.omega = spec.redline * f * Math.PI * 2 / 60; d.rpmAvg = spec.redline * f; }]));
    ev.push([steps.length * 1.5, null]); return ev;
  },
};

// ---------------------------------------------------------------- Turbina
const CEN_TURBINA: Record<string, (d: any, spec: any) => Cenario> = {
  // partida completa + lenta
  start: (d) => [[0, () => d.message({ type: 'input', start: true })], [26, null]],
  // já em lenta (estado forçado): lenta 4 s, manete 100% por 12 s (aceleração), volta à lenta 6 s
  takeoff: (d, spec) => [[0, () => { d.state = 'run'; d.lit = true; d.n2 = spec.n2Idle; d.u = 0; d.lightT = 10; }],
    [4, () => d.message({ type: 'input', tla: spec.ab ? 1.3 : 1 })], [16, () => d.message({ type: 'input', tla: 0 })], [22, null]],
  // passagem a 150 m, 300 km/h, potência 85%
  flyby: (d, spec) => [[0, () => { d.state = 'run'; d.lit = true; d.n2 = spec.n2Idle; d.u = 0; d.lightT = 10; d.params.listener = 'flyby'; d.params.alt = 150; d.params.speed = 300; d.message({ type: 'input', tla: 0.85 }); }], [40, null]],
};

// Laço comum: eventos no início de cada bloco de 128 amostras, como no AudioWorklet.
// `antes` roda depois dos eventos e antes do bloco (troca automática); `depois`, com o bloco já
// processado (telemetria), na mesma ordem dos harnesses antigos.
function rodar(d: any, ev: Cenario, antes?: (t: number, i: number) => void, depois?: (t: number, i: number) => void) {
  const T = ev[ev.length - 1][0];
  const n = Math.round(T * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const bl = new Float32Array(B), br = new Float32Array(B);
  let ei = 0;
  for (let i = 0; i < n; i += B) {
    const t = i / SR;
    while (ei < ev.length && ev[ei][0] <= t) { if (ev[ei][1]) ev[ei][1](); ei++; }
    antes?.(t, i);
    d.process(bl, br, B);
    L.set(bl.subarray(0, Math.min(B, n - i)), i); R.set(br.subarray(0, Math.min(B, n - i)), i);
    depois?.(t, i);
  }
  return { L, R };
}

function renderRonco(EngineDSP, G, spec, scen: string, outdir: string, listener: string, formato) {
  const d = new EngineDSP(SR);
  d.params.listener = listener;
  d.setConfig(montarConfig(spec));
  const ev = CEN_RONCO[scen](d, spec);
  const tele: any[] = [];
  const { L, R } = rodar(d, ev, () => {
    if (ev.autoShift && d.gear > 0 && d.locked && d.rpmAvg > spec.redline * 0.96 && d.gear < 3 && !d.shifting) d.message({ type: 'input', shift: 1 });
  }, (t, i) => {
    if ((i / B) % 8 === 0) tele.push([+t.toFixed(4), Math.round(d.rpmAvg), d.gear, +d.thr.toFixed(2), d.state, d.limiter ? 1 : 0, +(d.pMan / 101325).toFixed(2), Math.round(d.coolant)]);
  });
  const base = path.join(outdir, `${spec.id}_${scen}_${listener}`);
  const peak = gravarWav(base + '.wav', L, R, SR, formato);
  fs.writeFileSync(base + '.json', JSON.stringify({ id: spec.id, scen, listener, gain: d.cfgGain, peak, tele }));
  return `gain=${d.cfgGain.toFixed(3)} peak=${peak.toFixed(3)} rpmEnd=${Math.round(d.rpmAvg)} ${d.state}`;
}

function renderTurbina(JetDSP, spec, scen: string, outdir: string, listener: string, formato) {
  const d = new JetDSP(SR); d.params.listener = listener; d.params.angle = 90; d.params.dist = 40;
  d.setConfig(spec);
  const ev = CEN_TURBINA[scen](d, spec);
  const tele: any[] = [];
  const { L, R } = rodar(d, ev, undefined, (t, i) => {
    if ((i / B) % 16 === 0) tele.push([+t.toFixed(3), +(d.n1[0] * 100).toFixed(1), +(d.n2 * 100).toFixed(1), d.state, +(d.spl || 0).toFixed(1), +(d.mk).toFixed(2), +(d.Mt || 0).toFixed(2)]);
  });
  const base = path.join(outdir, `jet_${spec.id}_${scen}_${listener}`);
  const peak = gravarWav(base + '.wav', L, R, SR, formato);
  fs.writeFileSync(base + '.json', JSON.stringify({ id: spec.id, scen, listener, gain: d.cfgGain, peak, tele }));
  return `gain=${d.cfgGain.toExponential(2)} peak=${peak.toFixed(3)} n1=${(d.n1[0] * 100).toFixed(0)} n2=${(d.n2 * 100).toFixed(0)} spl=${(d.spl || 0).toFixed(0)} ${d.state}`;
}

// prova de que o DSP do worklet (TypeScript) roda no Node: 1 s liga, troca de nota, desliga
function renderTom(f: number, outdir: string, formato) {
  const d = new TomDSP(SR);
  const ev: Cenario = [[0, () => d.message({ type: 'tom', ligado: true, f, amp: 0.2 })], [1, () => d.message({ type: 'tom', f: f * 1.5 })],
    [2, () => d.message({ type: 'tom', ligado: false })], [2.5, null]];
  const { L, R } = rodar(d, ev);
  const arq = path.join(outdir, `tom_${f}.wav`);
  const peak = gravarWav(arq, L, R, SR, formato);
  return `${arq} peak=${peak.toFixed(3)} f=${d.f.toFixed(1)}`;
}

// --------------------------------------------------------------------- CLI
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const formato = process.argv.includes('--pcm16') ? 'pcm16' : 'float32';
const [familia, which, scen, outdir, listener] = args;
const uso = () => { console.error('uso: tsx tools/render.ts ronco|turbina <presets|all> <cenário> <pasta> [ouvinte] [--pcm16]  ·  tsx tools/render.ts tom <freq> <pasta>'); process.exit(2); };

if (familia === 'tom') {
  if (!which || !scen) uso();
  fs.mkdirSync(scen, { recursive: true });
  console.log(renderTom(+which, scen, formato));
} else if (familia === 'ronco' || familia === 'turbina') {
  if (!which || !scen || !outdir) uso();
  const ronco = familia === 'ronco';
  const tabela = ronco ? CEN_RONCO : CEN_TURBINA;
  if (!tabela[scen]) { console.error(`cenário desconhecido: ${scen} (${Object.keys(tabela).join(', ')})`); process.exit(2); }
  fs.mkdirSync(outdir, { recursive: true });
  const dspArq = process.env.DSP || (ronco ? 'src/dsp.js' : 'src/jet-dsp.js');
  const M = carregar(dspArq, ronco ? 'EngineDSP' : 'JetDSP');
  const PRESETS = lista(process.env.PRESETS || (ronco ? 'src/presets.js' : 'src/jet-presets.js'));
  const G = ronco ? lista(process.env.GEOMETRY || 'src/geometry.js') : null;
  const escolhidos = which === 'all' ? PRESETS : PRESETS.filter((p) => which.split(',').includes(p.id));
  if (!escolhidos.length) { console.error(`nenhum preset com id ${which}`); process.exit(2); }
  console.log(`DSP: ${dspArq} · ${formato}`);
  for (const p of escolhidos) {
    const t0 = Date.now();
    const r = ronco
      ? renderRonco(M.EngineDSP, G, { ...STOCK, ...p }, scen, outdir, listener || 'ext', formato)
      : renderTurbina(M.JetDSP, p, scen, outdir, listener || 'ground', formato);
    console.log(`${p.id.padEnd(12)} ${scen.padEnd(7)} ${r} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
} else uso();
