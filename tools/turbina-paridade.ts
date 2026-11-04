// Prova de que a Turbina migrada (src/engines/turbina/) soa igual ao legado, amostra a amostra.
//
//   npx tsx tools/turbina-paridade.ts [ids separados por vírgula] [--legado <ref>] [--sem-render]
//
// 1. Presets: a lista nova tem de ser igual, objeto a objeto e na mesma ordem de chaves, à de
//    `git show <ref>:src/jet-presets.js` (ref padrão: master).
// 2. Cenários do harness (start, takeoff, flyby): roda tools/render.ts duas vezes por cenário, com
//    DSP=/PRESETS= do legado e do migrado, e compara as pastas com tools/compare-wav.ts e os JSON
//    de telemetria byte a byte.
// 3. Cenários extras, aqui mesmo (os dois DSPs lado a lado, os 4 canais de saída e cada mensagem
//    de telemetria comparados com Object.is): estrondo sônico, voo rasante supersônico, a bordo
//    (cabine, cockpit, câmera, reversor, ambientes), no solo (ângulo, distância, mistura, `tune`,
//    corte do motor), reconfiguração com calibração como a página faz, 44,1 kHz e bloco de 1024.
//
// Sai com código 0 só se tudo for idêntico.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JetDSP as JetNovo } from '../src/engines/turbina/dsp';
import { PRESETS_TURBINA } from '../src/engines/turbina/presets';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const iRef = argv.indexOf('--legado');
const REF = iRef >= 0 ? argv[iRef + 1] : 'master';
const semRender = argv.includes('--sem-render');
const ids = argv.filter((a, i) => !a.startsWith('--') && (iRef < 0 || i !== iRef + 1))[0];

// ------------------------------------------------------------- legado
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'turbina-paridade-'));
const LEG_DSP = path.join(TMP, 'jet-dsp.legado.js'), LEG_PRE = path.join(TMP, 'jet-presets.legado.js');
fs.writeFileSync(LEG_DSP, execFileSync('git', ['show', `${REF}:src/jet-dsp.js`], { cwd: RAIZ }));
fs.writeFileSync(LEG_PRE, execFileSync('git', ['show', `${REF}:src/jet-presets.js`], { cwd: RAIZ }));
const JetLegado = req(LEG_DSP)().JetDSP;
const PRESETS_LEG = req(LEG_PRE);
console.log(`legado: ${REF}:src/jet-dsp.js e ${REF}:src/jet-presets.js · temporários em ${TMP}\n`);

let falhas = 0;
const falha = (msg: string) => { falhas++; console.log(`FALHA ${msg}`); };

// --------------------------------------------------------- 1. presets
{
  const a = JSON.stringify(PRESETS_LEG), b = JSON.stringify(PRESETS_TURBINA);
  const fa = JSON.stringify(PRESETS_LEG.families), fb = JSON.stringify(PRESETS_TURBINA.families);
  if (a !== b) {
    const i = PRESETS_LEG.findIndex((p, k) => JSON.stringify(p) !== JSON.stringify(PRESETS_TURBINA[k]));
    falha(`presets diferentes (primeiro: ${PRESETS_LEG[i]?.id ?? i})`);
  } else if (fa !== fb) falha('famílias diferentes');
  else console.log(`presets: ${PRESETS_TURBINA.length} aviões e ${PRESETS_TURBINA.families.length} famílias IDÊNTICOS (valores e ordem das chaves)`);
}
const escolhidos = ids ? PRESETS_TURBINA.filter((p) => ids.split(',').includes(p.id)) : PRESETS_TURBINA;
if (!escolhidos.length) { console.error(`nenhum preset com id ${ids}`); process.exit(2); }
const listaIds = escolhidos.map((p) => p.id).join(',');

// ------------------------------------- 2. cenários do harness (render.ts)
const tabela: [string, string, string][] = []; // cenário, wav, json
if (!semRender) {
  const tsx = path.join(RAIZ, 'node_modules', '.bin', 'tsx');
  for (const scen of ['start', 'takeoff', 'flyby']) {
    const dA = path.join(TMP, `${scen}-legado`), dB = path.join(TMP, `${scen}-migrado`);
    for (const [d, dsp, pre] of [[dA, LEG_DSP, LEG_PRE], [dB, 'src/engines/turbina/dsp.ts', 'src/engines/turbina/presets.ts']]) {
      const r = spawnSync(tsx, ['tools/render.ts', 'turbina', listaIds, scen, d], { cwd: RAIZ, env: { ...process.env, DSP: dsp, PRESETS: pre }, encoding: 'utf8' });
      if (r.status !== 0) { falha(`render ${scen} (${dsp}): ${r.stderr}`); continue; }
    }
    const c = spawnSync(tsx, ['tools/compare-wav.ts', dA, dB], { cwd: RAIZ, encoding: 'utf8' });
    const linhas = c.stdout.trim().split('\n');
    const iguais = linhas.filter((l) => l.includes('IDÊNTICOS')).length;
    for (const l of linhas) if (!l.includes('IDÊNTICOS') && !l.includes('dentro do critério')) console.log(`  ${l}`);
    if (c.status !== 0) falha(`compare-wav ${scen}: ${linhas[linhas.length - 1]}`);
    // telemetria do harness (n1, n2, estado, SPL, compensação, Mach na ponta), byte a byte
    let jsonIguais = 0;
    for (const f of fs.readdirSync(dA).filter((x) => x.endsWith('.json'))) {
      const ja = fs.readFileSync(path.join(dA, f), 'utf8'), jb = fs.existsSync(path.join(dB, f)) ? fs.readFileSync(path.join(dB, f), 'utf8') : '';
      if (ja === jb) jsonIguais++; else falha(`telemetria ${f}`);
    }
    tabela.push([scen, `${iguais}/${escolhidos.length}`, `${jsonIguais}/${escolhidos.length}`]);
    console.log(`render.ts ${scen.padEnd(8)} WAV idênticos ${iguais}/${escolhidos.length} · JSON idênticos ${jsonIguais}/${escolhidos.length}`);
  }
}

// ------------------------------------------------ 3. cenários extras
type Ev = [number, (d: any) => void];
type Extra = { nome: string; fs?: number; bloco?: number; fim: number; eventos: (spec: any, fs: number, D: any) => Ev[] };
const emRegime = (d: any, spec: any) => { d.state = 'run'; d.lit = true; d.n2 = spec.n2Idle; d.u = 0; d.lightT = 10; };
const params = (p: any): ((d: any) => void) => (d) => d.message({ type: 'params', params: p });
const input = (m: any): ((d: any) => void) => (d) => d.message({ type: 'input', ...m });
const maxTla = (spec: any) => (spec.ab && spec.arch !== 'turboprop' ? 1.3 : 1);

const EXTRAS: Extra[] = [
  // passagem supersônica a 300 m: silêncio, estrondo quando o cone chega, ronco de trás para frente
  { nome: 'estrondo', fim: 14, eventos: (s) => [[0, (d) => { emRegime(d, s); params({ listener: 'flyby', alt: 300, speed: 2000 })(d); input({ tla: maxTla(s) })(d); }]] },
  // rasante pouco acima de Mach 1 (cáustica perto do chão), com troca de velocidade e altura no meio
  { nome: 'rasante', fim: 16, eventos: (s) => [[0, (d) => { emRegime(d, s); params({ listener: 'flyby', alt: 60, speed: 1300, env: 'valley' })(d); input({ tla: 1 })(d); }],
    [9, params({ speed: 900, alt: 120 })]] },
  // a bordo: cabine (assentos), cockpit, câmera na asa; reversor; ambientes com zumbido
  { nome: 'bordo', fim: 16, eventos: (s) => [[0, (d) => { emRegime(d, s); params({ listener: 'cabin', seat: 'fwd' })(d); }],
    [2, input({ tla: 1 })], [3, params({ env: 'hangar' })], [5, params({ seat: 'aft' })], [6, params({ seat: 'wing' })], [7, params({ listener: 'cockpit' })],
    [9, params({ listener: 'wingcam' })], [10, params({ env: 'testcell' })], [11, input({ reverser: true, tla: 0.6 })], [14, input({ reverser: false, tla: 0 })]] },
  // no solo: volta ao redor do motor, mistura das fontes, `tune` ao vivo e corte do motor
  { nome: 'solo', fim: 18, eventos: (s) => {
    const ev: Ev[] = [[0, (d) => { emRegime(d, s); params({ listener: 'ground', angle: 0, dist: 10, env: 'apron' })(d); input({ tla: maxTla(s) })(d); }]];
    for (let k = 1; k <= 12; k++) ev.push([k * 0.5, params({ angle: k * 15, dist: 10 + k * 20 })]);
    ev.push([4, params({ fan: 0.5, core: 1.5, jet: 2, master: 1.2, env: 'carrier' })]);
    ev.push([6, (d) => d.message({ type: 'tune', cfg: { ...s, jetV: s.jetV * 1.1, nozD: s.nozD * 0.9, liners: !s.liners, suppressor: 'chevrons', sync: !s.sync } })]);
    ev.push([8, input({ reverser: true })]); ev.push([10, input({ reverser: false, tla: 0 })]);
    ev.push([11, input({ start: false })]);
    return ev;
  } },
  // reconfiguração estrutural no meio do giro, com o ganho calibrado numa cópia como a página faz
  { nome: 'config', fim: 12, eventos: (s, fs, D) => [[0, (d) => { emRegime(d, s); input({ tla: 0.9 })(d); }],
    [4, (d) => { const cfg = { ...s, engines: s.engines > 1 ? 1 : 2, span: s.span || 6, sync: true, spools: 3, nozzle: 'conv' }; const p = new D(fs); p.setConfig(cfg); d.message({ type: 'config', cfg: { ...cfg, gain: p.cfgGain } }); }],
    [8, input({ tla: 0.2 })]] },
  // partida e aceleração a 44,1 kHz (taxa comum no navegador)
  { nome: 'start44k', fs: 44100, fim: 26, eventos: (s) => [[0, input({ start: true })], [18, input({ tla: maxTla(s) })]] },
  // reserva do ScriptProcessorNode: blocos de 1024 amostras
  { nome: 'bloco1024', bloco: 1024, fim: 12, eventos: (s) => [[0, (d) => { emRegime(d, s); input({ tla: 1 })(d); }], [6, input({ tla: 0 })]] },
];

// compara dois valores de telemetria (números com Object.is, objetos campo a campo)
function mesmo(a: any, b: any): boolean {
  if (typeof a === 'number' || typeof b === 'number') return Object.is(a, b);
  if (a && b && typeof a === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && mesmo(a[k], b[k]));
  }
  return a === b;
}

function rodarExtra(D: any, spec: any, x: Extra) {
  const fs = x.fs ?? 48000, B = x.bloco ?? 128, n = Math.round(x.fim * fs);
  const d = new D(fs);
  d.params.angle = 90; d.params.dist = 40;
  const tele: any[] = [];
  d.post = (m: any) => tele.push(m);
  d.setConfig({ ...spec });
  const ev = x.eventos(spec, fs, D).sort((a, b) => a[0] - b[0]);
  const out = [0, 1, 2, 3].map(() => new Float32Array(n));
  const bl = [0, 1, 2, 3].map(() => new Float32Array(B));
  let ei = 0;
  for (let i = 0; i < n; i += B) {
    const t = i / fs;
    while (ei < ev.length && ev[ei][0] <= t) ev[ei++][1](d);
    d.process(bl[0], bl[1], B, bl[2], bl[3]);
    for (let c = 0; c < 4; c++) out[c].set(bl[c].subarray(0, Math.min(B, n - i)), i);
  }
  return { out, tele, boom: d.boomDb };
}

const dBFS = (x: number) => (x > 0 ? `${(20 * Math.log10(x)).toFixed(1)} dBFS` : '−∞');
const tabelaExtra: [string, string, string, string][] = [];
for (const x of EXTRAS) {
  let iguais = 0, teleIguais = 0, estrondos = 0, piorErro = 0, nTele = 0;
  for (const spec of escolhidos) {
    const a = rodarExtra(JetLegado, spec, x), b = rodarExtra(JetNovo, spec, x);
    let erro = 0, primeira = -1;
    for (let c = 0; c < 4; c++) for (let i = 0; i < a.out[c].length; i++) {
      const e = Math.abs(a.out[c][i] - b.out[c][i]);
      const ee = Number.isNaN(e) ? Infinity : e;
      if (ee > 0 && primeira < 0) primeira = i;
      if (ee > erro) erro = ee;
    }
    if (erro === 0) iguais++; else falha(`${x.nome} ${spec.id}: erro máximo ${dBFS(erro)}, primeira diferença na amostra ${primeira}`);
    piorErro = Math.max(piorErro, erro);
    const tOk = a.tele.length === b.tele.length && a.tele.every((m, i) => mesmo(m, b.tele[i]));
    if (tOk) teleIguais++; else falha(`${x.nome} ${spec.id}: telemetria diferente`);
    nTele += a.tele.length;
    if (b.boom > 0) estrondos++;
  }
  const extra = x.nome === 'estrondo' || x.nome === 'rasante' ? ` · estrondo em ${estrondos}/${escolhidos.length}` : '';
  tabelaExtra.push([x.nome, `${iguais}/${escolhidos.length}`, `${teleIguais}/${escolhidos.length}`, piorErro ? dBFS(piorErro) : 'zero']);
  console.log(`extra ${x.nome.padEnd(10)} 4 canais idênticos ${iguais}/${escolhidos.length} · telemetria idêntica ${teleIguais}/${escolhidos.length} (${nTele} mensagens)${extra}`);
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(falhas ? `\n${falhas} FALHA(S)` : `\nTUDO IDÊNTICO (${escolhidos.length} aviões, ${tabela.length} cenários do render.ts + ${tabelaExtra.length} extras)`);
process.exit(falhas ? 1 : 0);
