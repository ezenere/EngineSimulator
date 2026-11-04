// Prova de que o Ronco migrado (src/engines/ronco/) soa igual ao legado de `master`.
//
//   npx tsx tools/ronco-paridade.ts [--ref master] [--rapido] [--j 16] [--dist] [--manter]
//
// 1. Dados: os presets e a geometria em TypeScript são comparados campo a campo com os legados
//    (todos os 68 presets; build() de cada virabrequim × ordem × coletor × ângulo do V).
// 2. Som: renderiza com tools/render.ts os mesmos cenários com o DSP legado (git show <ref>:src/dsp.js,
//    geometry.js, presets.js) e com o migrado, e compara com tools/compare-wav.ts (amostra a amostra)
//    e a telemetria JSON byte a byte:
//      · idle, rev, wot e sweep em 22 presets variados (todas as arquiteturas, aspirações, abafadores,
//        traçados, cortes de giro, mapas de desaceleração, câmbios, carburador, motos);
//      · idle e rev em todos os 68;
//      · rev com cada ouvinte (pipe, int, bay, road) e partida a frio (cold) em alguns.
//    --rapido: só os 22 presets variados em idle e rev.
// 3. --dist: carrega o bundle do worklet gerado por `npm run build` (dist/assets/processador-ronco-*.js)
//    com os globais do AudioWorklet simulados, faz a calibração como a página (sonda fora da thread de
//    áudio, `config` com gain/mkIdle/powerModel) e confere que ele toca igual ao DSP em TypeScript.
//
// Sai com código 0 só se tudo for idêntico. --manter não apaga a pasta temporária com os WAVs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { isDeepStrictEqual } from 'node:util';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as G from '../src/engines/ronco/geometria';
import { PRESETS, ACESSORIOS_PADRAO } from '../src/engines/ronco/presets';
import { EngineDSP, gearRatios, defaultFinal } from '../src/engines/ronco/dsp';
import { configCalibrada } from '../src/engines/ronco/config';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(import.meta.url);
const args = process.argv.slice(2);
const opcao = (nome: string, padrao: string) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : padrao; };
const REF = opcao('--ref', 'master');
const J = Math.max(1, +opcao('--j', String(Math.max(2, Math.floor(os.cpus().length * 0.75)))));
const RAPIDO = args.includes('--rapido');

let falhas = 0;
const falha = (msg: string) => { falhas++; console.log(`FALHA ${msg}`); };

// ------------------------------------------------------------------ legado
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ronco-paridade-'));
const refDir = path.join(tmp, 'ref');
fs.mkdirSync(refDir);
for (const [orig, dest] of [['src/dsp.js', 'dsp.js'], ['src/geometry.js', 'geometry.js'], ['src/presets.js', 'presets.js']]) {
  fs.writeFileSync(path.join(refDir, dest), execFileSync('git', ['show', `${REF}:${orig}`], { cwd: RAIZ }));
}
const LG = req(path.join(refDir, 'geometry.js'));
const LP = req(path.join(refDir, 'presets.js'));
const LD = req(path.join(refDir, 'dsp.js'))();
console.log(`referência: ${REF} · temporários em ${tmp}`);

// ------------------------------------------------------------------ 1. dados
{
  if (!isDeepStrictEqual(LP.families, PRESETS.families)) falha('famílias diferentes');
  if (LP.length !== PRESETS.length) falha(`${LP.length} presets no legado, ${PRESETS.length} no migrado`);
  let iguais = 0;
  for (let i = 0; i < LP.length; i++) {
    const a = LP[i], b = PRESETS[i];
    // mesma ordem de campos também (é a ordem em que o painel e o DSP os veem)
    if (!b || !isDeepStrictEqual(a, b) || JSON.stringify(Object.keys(a)) !== JSON.stringify(Object.keys(b))) falha(`preset ${a.id} difere`);
    else iguais++;
  }
  console.log(`presets: ${iguais}/${LP.length} iguais campo a campo`);

  if (!isDeepStrictEqual(LG.LAYOUTS, G.LAYOUTS)) falha('LAYOUTS diferentes');
  if (!isDeepStrictEqual(LG.CRANKS, G.CRANKS)) falha('CRANKS diferentes');
  let n = 0;
  for (const [chave, fam] of Object.entries(G.CRANKS)) {
    const [layout, cyl] = chave.split('-');
    for (const crank of fam) {
      const ordens = [...crank.orders.map((o) => o[0]), 'inválida', Array.from({ length: +cyl }, (_, i) => +cyl - i).join('-')];
      const angulos = layout === 'v' ? [crank.bank, 60, 72, 90, 120] : [undefined];
      for (const order of ordens) for (const bankAngle of angulos) for (const header of ['equal', 'unequal', 'short', 'heater']) {
        const spec = { layout, cylinders: +cyl, crank: crank.id, order, bankAngle, header };
        const a = LG.build(spec), b = G.build(spec);
        n++;
        if (!isDeepStrictEqual(a, b)) falha(`geometria ${JSON.stringify(spec)}`);
        if (!isDeepStrictEqual(LG.parseOrder(order, +cyl), G.parseOrder(order, +cyl))) falha(`parseOrder ${order}`);
      }
    }
  }
  for (const p of PRESETS) { n++; if (!isDeepStrictEqual(LG.build(p), G.build(p))) falha(`geometria do preset ${p.id}`); }
  console.log(`geometria: ${n} montagens comparadas`);
  for (let k = 1; k <= 12; k++) if (!isDeepStrictEqual(LD.gearRatios(k), gearRatios(k))) falha(`gearRatios(${k})`);
  for (const r of [3000, 4600, 6600, 9000, 14000, 20000]) if (!Object.is(LD.defaultFinal(r), defaultFinal(r))) falha(`defaultFinal(${r})`);
}

// ------------------------------------------------------------------ 2. som
const VARIADOS = ['muscle', 'mustang', 'gt500', 'chevelle', 'v6odd', 'flatplane', 'f812', 'flat6', 'i4', 'supra', 'evo', 'quattro',
  'golfgti', 'v10f1', 'v16', 'fusca', 'i3', 'r1', 'h2', 'hayabusa', 'vtwin', 'single'];
for (const id of VARIADOS) if (!PRESETS.some((p) => p.id === id)) throw new Error(`preset ${id} não existe`);
type Trabalho = { preset: string; cen: string; ouvinte: string };
const trabalhos: Trabalho[] = [];
const add = (preset: string, cen: string, ouvinte = 'ext') => { if (!trabalhos.some((t) => t.preset === preset && t.cen === cen && t.ouvinte === ouvinte)) trabalhos.push({ preset, cen, ouvinte }); };
if (RAPIDO) for (const id of VARIADOS) { add(id, 'idle'); add(id, 'rev'); }
else {
  for (const id of VARIADOS) for (const cen of ['idle', 'rev', 'wot', 'sweep']) add(id, cen);
  for (const p of PRESETS) { add(p.id, 'idle'); add(p.id, 'rev'); }
  for (const id of ['muscle', 'fusca', 'flat6', 'evo']) for (const o of ['pipe', 'int', 'bay', 'road']) add(id, 'rev', o);
  for (const id of ['muscle', 'fusca', 'i4', 'r1']) add(id, 'cold');
}

const tsx = path.join(RAIZ, 'node_modules', '.bin', 'tsx');
function executar(argv: string[], env: Record<string, string>): Promise<{ codigo: number; saida: string }> {
  return new Promise((resolve) => {
    const p = spawn(tsx, argv, { cwd: RAIZ, env: { ...process.env, ...env } });
    let saida = '';
    p.stdout.on('data', (d) => (saida += d)); p.stderr.on('data', (d) => (saida += d));
    p.on('close', (codigo) => resolve({ codigo: codigo ?? 1, saida }));
  });
}
const LADOS = {
  ref: { DSP: path.join(refDir, 'dsp.js'), PRESETS: path.join(refDir, 'presets.js'), GEOMETRY: path.join(refDir, 'geometry.js') },
  novo: { DSP: 'src/engines/ronco/dsp.ts', PRESETS: 'src/engines/ronco/presets.ts', GEOMETRY: 'src/engines/ronco/geometria.ts' },
};

async function renderizarTudo() {
  const fila: (() => Promise<void>)[] = [];
  for (const [lado, env] of Object.entries(LADOS)) {
    const pasta = path.join(tmp, lado);
    fs.mkdirSync(pasta, { recursive: true });
    for (const t of trabalhos) fila.push(async () => {
      const r = await executar(['tools/render.ts', 'ronco', t.preset, t.cen, pasta, t.ouvinte], env);
      if (r.codigo !== 0) falha(`render ${lado} ${t.preset} ${t.cen} ${t.ouvinte}:\n${r.saida}`);
    });
  }
  const t0 = Date.now();
  let feitos = 0;
  await Promise.all(Array.from({ length: J }, async () => {
    while (fila.length) {
      await fila.shift()!();
      if (++feitos % 50 === 0) console.log(`  ${feitos}/${trabalhos.length * 2} renderizações (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
  }));
  console.log(`renderizações: ${trabalhos.length} cenários × 2 lados em ${((Date.now() - t0) / 1000).toFixed(0)} s (${J} em paralelo)`);
}

async function compararTudo() {
  const r = await executar(['tools/compare-wav.ts', path.join(tmp, 'ref'), path.join(tmp, 'novo')], {});
  const linhas = r.saida.split('\n').filter((l) => l.includes('.wav:'));
  // tabela por cenário: arquivos, idênticos, pior erro
  const tabela = new Map<string, { n: number; iguais: number; pior: number }>();
  for (const t of trabalhos) {
    const nome = `${t.preset}_${t.cen}_${t.ouvinte}`;
    const chave = t.ouvinte === 'ext' ? t.cen : `${t.cen} (${t.ouvinte})`;
    const e = tabela.get(chave) ?? { n: 0, iguais: 0, pior: -Infinity };
    e.n++;
    const l = linhas.find((x) => x.startsWith(nome + '.wav:'));
    const jsonA = path.join(tmp, 'ref', nome + '.json'), jsonB = path.join(tmp, 'novo', nome + '.json');
    const jsonIgual = fs.existsSync(jsonA) && fs.existsSync(jsonB) && fs.readFileSync(jsonA).equals(fs.readFileSync(jsonB));
    if (l && l.includes('IDÊNTICOS') && jsonIgual) e.iguais++;
    else {
      falha(`${nome}: ${l ?? 'sem comparação'}${jsonIgual ? '' : ' · telemetria JSON diferente'}`);
      const m = l?.match(/erro máximo (\S+) dBFS/);
      e.pior = Math.max(e.pior, m ? +m[1] : Infinity); // (sem número: comparação faltando ou só a telemetria difere)
    }
    tabela.set(chave, e);
  }
  console.log('\n| Cenário | Arquivos | Idênticos (WAV + JSON) | Pior erro |\n|---|---|---|---|');
  for (const [k, e] of tabela) console.log(`| ${k} | ${e.n} | ${e.iguais} | ${e.iguais === e.n ? 'zero' : Number.isFinite(e.pior) ? `${e.pior.toFixed(1)} dBFS` : '?'} |`);
  console.log('');
}

// ------------------------------------------------------------------ 3. bundle do worklet
// Laço igual ao de tools/render.ts: eventos no início de cada bloco de 128 amostras.
function tocar(d: any, eventos: [number, (() => void) | null][]) {
  const SR = 48000, B = 128, T = eventos[eventos.length - 1][0], n = Math.round(T * SR);
  const L = new Float32Array(n), R = new Float32Array(n), sL = new Float32Array(n), sR = new Float32Array(n);
  const bl = new Float32Array(B), br = new Float32Array(B), el = new Float32Array(B), er = new Float32Array(B);
  let ei = 0;
  for (let i = 0; i < n; i += B) {
    const t = i / SR;
    while (ei < eventos.length && eventos[ei][0] <= t) { eventos[ei][1]?.(); ei++; }
    d.process(bl, br, B, el, er);
    const k = Math.min(B, n - i);
    L.set(bl.subarray(0, k), i); R.set(br.subarray(0, k), i); sL.set(el.subarray(0, k), i); sR.set(er.subarray(0, k), i);
  }
  return [L, R, sL, sR];
}

function conferirDist() {
  const pasta = path.join(RAIZ, 'dist', 'assets');
  const arq = fs.existsSync(pasta) && fs.readdirSync(pasta).find((f) => /^processador-ronco-.*\.js$/.test(f));
  if (!arq) { falha('dist/assets/processador-ronco-*.js não existe (rode npm run build)'); return; }
  // globais do AudioWorkletGlobalScope simulados; o bundle é ES module, então tira os export finais
  const codigo = fs.readFileSync(path.join(pasta, arq), 'utf8').replace(/^export\s*\{[^}]*\};?\s*$/m, '');
  const registrados: Record<string, any> = {};
  class AudioWorkletProcessor { port = { postMessage: () => {}, onmessage: null as any }; }
  const ctx = vm.createContext({ AudioWorkletProcessor, registerProcessor: (n: string, c: any) => (registrados[n] = c), sampleRate: 48000, Math, Float32Array, Float64Array, Uint8Array, Object, Array, Number, String, Set, Map, JSON, Error, console, globalThis: undefined as any });
  ctx.globalThis = ctx;
  vm.runInContext(codigo, ctx, { filename: arq });
  const P = registrados['ronco-engine'];
  if (!P) { falha(`${arq} não registrou ronco-engine`); return; }
  let iguais = 0;
  const ids = ['muscle', 'fusca', 'evo', 'v10f1', 'h2', 'gt500'];
  for (const id of ids) {
    const spec = { ...ACESSORIOS_PADRAO, ...PRESETS.find((p) => p.id === id) };
    const cfg = configCalibrada(spec, 48000);
    const proc = new P();
    // mensagens pela porta, como a página manda (params, config, temperatura, ignição, acelerador)
    const msg = (m: any) => proc.port.onmessage({ data: JSON.parse(JSON.stringify(m)) });
    const ref = new EngineDSP(48000);
    const evs = (enviar: (m: any) => void): [number, (() => void) | null][] => [
      [0, () => { enviar({ type: 'params', params: { listener: 'ext', env: 'street' } }); enviar({ type: 'config', cfg }); enviar({ type: 'input', temp: { mode: 'fixed', value: 90 } }); enviar({ type: 'input', ignition: true }); }],
      [3, () => enviar({ type: 'input', throttle: 1 })], [5.5, () => enviar({ type: 'input', throttle: 0 })], [8, null]];
    const a = tocar(proc.d, evs(msg));
    const b = tocar(ref, evs((m) => ref.message(JSON.parse(JSON.stringify(m)))));
    const ok = a.every((x, c) => x.every((v, i) => Object.is(v, b[c][i])));
    // (e tocou de verdade: dois silêncios também seriam iguais)
    const pico = a[0].reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    if (ok && pico > 0.01) iguais++; else falha(`bundle ${arq}: ${id} ${ok ? `não tocou (pico ${pico})` : 'difere do DSP em TypeScript'}`);
  }
  console.log(`bundle do worklet (${arq}): ${iguais}/${ids.length} presets idênticos ao DSP em TypeScript (4 canais, com a calibração da página)`);
}

(async () => {
  await renderizarTudo();
  await compararTudo();
  if (args.includes('--dist')) conferirDist();
  if (!args.includes('--manter')) fs.rmSync(tmp, { recursive: true, force: true });
  console.log(falhas ? `${falhas} falha(s)` : 'PARIDADE OK: tudo idêntico ao legado');
  process.exit(falhas ? 1 : 0);
})();
