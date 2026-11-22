// Teste de lenta dos rotativos (ROTATIVO.md 8, passo 11): os 16 presets Wankel e X-Engine, a 20 °C e a −5 °C, com a
// partida de verdade (arranque elétrico, pegar, aquecer), acelerada aos 12 s (60% por 1,5 s) e 30 s no total. Passa com
// zero apagamentos depois de pegar, sem NaN e com a rotação final (25–30 s) a ±3% do alvo do controle de lenta; nas
// janelas de competição (sobreposição > 90°e: o 787B) o critério é o da caça: 0,75–1,2× o alvo, sem apagar (quente:
// 1 600–2 200, medido no grupo `lenta` do teste:rotativo).
// O motor de palhetas não tem lenta (é a ferramenta ou o arranque): fica de fora.
// Mais quatro casos de troca de configuração com o motor na lenta (ver `casoTroca`).
//
//   npx tsx tools/rotativo-lenta.ts [ids...] [--j 8]
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PRESETS_ROTATIVO } from '../src/engines/rotativo/presets';

const AQUI = fileURLToPath(import.meta.url);
type Resultado = { id: string; temp: number; ok: boolean; texto: string };

async function umCaso(id: string, temp: number): Promise<Resultado> {
  const { preset, novoDSP, renderizar, trecho, media } = await import('./rotativo-comum');
  const { sobreposicao } = await import('../src/engines/rotativo/config');
  const p = preset(id);
  const d = novoDSP(p, { temp });
  const ev: [number, (x: any) => void][] = [
    [0, (x) => x.message({ type: 'input', ignition: true })],
    [12, (x) => x.message({ type: 'input', throttle: 0.6 })],
    [13.5, (x) => x.message({ type: 'input', throttle: 0 })],
  ];
  const r = renderizar(d, 30, ev as any);
  let nan = false; for (let i = 0; i < r.L.length; i += 97) if (!Number.isFinite(r.L[i])) { nan = true; break; }
  const pegou = r.tele.findIndex((q) => q.state === 'run');
  const apagou = pegou >= 0 && r.tele.slice(pegou).some((q) => q.state === 'off');
  const fim = trecho(r.tele, 25, 30);
  const rpm = media(fim.map((q) => q.rpm)), alvo = media(fim.map((q) => q.idleTarget));
  const corrida = sobreposicao(p.janelas) > 90;
  const mn = Math.min(...fim.map((q) => q.rpm)), mx = Math.max(...fim.map((q) => q.rpm));
  const erro = alvo ? (100 * (rpm - alvo)) / alvo : 100;
  const tPega = pegou >= 0 ? r.tele[pegou].t : NaN;
  const ok = !nan && pegou >= 0 && !apagou && (corrida ? mn >= 0.75 * alvo && mx <= 1.2 * alvo : Math.abs(erro) <= 3);
  const lenta = corrida ? `caça ${mn.toFixed(0)}–${mx.toFixed(0)} rpm (alvo ${alvo.toFixed(0)}: 0,75–1,2× · quente 1 600–2 200)` : `lenta ${rpm.toFixed(0)} rpm (alvo ${alvo.toFixed(0)}, ${erro >= 0 ? '+' : ''}${erro.toFixed(1)}%)`;
  return { id, temp, ok, texto: `${ok ? 'ok   ' : 'FALHA'} ${id.padEnd(10)} ${String(temp).padStart(3)} °C · pegou em ${tPega.toFixed(1)} s · ${apagou ? 'APAGOU' : 'sem apagar'} · ${lenta}${nan ? ' · NaN' : ''}` };
}

// Trocas de configuração com o motor funcionando na lenta. A página manda `{ type: 'config', cfg }` com a configuração
// calibrada a cada troca estrutural (abafador, pré-silencioso, janela). Três trocas de escape seguidas, 0,4 s entre
// elas, não podem afundar a lenta (mínimo depois das trocas ≥ o mínimo dos 6 s de antes − 8% do alvo) nem apagar o motor;
// a troca da janela de admissão para a periférica, com a lenta que a página põe junto (1 800 rpm), também não.
// (Antes de novembro de 2026 cada troca recomeçava as câmaras do zero: um ciclo sem queimar, 750 → ~600 rpm com as
// janelas de fábrica; com a janela periférica as câmaras passavam a falhar todas juntas e o motor às vezes apagava.)
const TROCAS: Record<string, { id: string; extra?: Record<string, any>; janela?: boolean }> = {
  'fabrica': { id: 'rx7fd' },
  'periferica': { id: 'rx7fd', extra: { janelas: { admissao: 'periferica', escape: 'periferico' }, idle: 1800 } },
  '787b': { id: 'r26b' },
  'janela': { id: 'rx7fd', janela: true },
};
async function casoTroca(nome: string): Promise<Resultado> {
  const { preset, novoDSP, cfgCalibrada, SR } = await import('./rotativo-comum');
  const t = TROCAS[nome];
  let spec: any = preset(t.id, t.extra || {});
  const d: any = novoDSP(spec, { quente: true });
  const B = 128, L = new Float32Array(B), R = new Float32Array(B);
  let apagou = false, nan = false;
  const rodar = (s: number) => {
    let mn = Infinity, mx = 0;
    for (let i = 0; i < s * SR; i += B) { d.process(L, R, B); mn = Math.min(mn, d.rpmAvg); mx = Math.max(mx, d.rpmAvg); if (d.state !== 'run') apagou = true; if (!Number.isFinite(L[0])) nan = true; }
    return [mn, mx];
  };
  const trocar = (patch: Record<string, any>) => {
    spec = { ...spec, ...patch, escape: { ...spec.escape, ...(patch.escape || {}) }, janelas: { ...spec.janelas, ...(patch.janelas || {}) } };
    d.message({ type: 'config', cfg: cfgCalibrada(spec) });
  };
  rodar(8);
  const [mn0, mx0] = rodar(6);
  let mn: number, mx: number, alvo: number, ok: boolean, criterio: string;
  if (t.janela) {
    trocar({ janelas: { admissao: 'periferica' }, idle: 1800 });
    rodar(5);
    [mn, mx] = rodar(4); alvo = d.idleTarget ?? 1800;
    ok = !apagou && !nan && mn >= 0.75 * alvo && mx <= 1.2 * alvo;
    criterio = `depois da troca de janela ${mn.toFixed(0)}–${mx.toFixed(0)} rpm (alvo ${alvo.toFixed(0)}: 0,75–1,2×)`;
  } else {
    alvo = d.idleTarget ?? spec.idle;
    trocar({ muffler: spec.muffler === 'sport' ? 'stock' : 'sport' }); const a = rodar(0.4);
    trocar({ escape: { presilencioso: !spec.escape.presilencioso } }); const b = rodar(0.4);
    trocar({ muffler: spec.muffler === 'sport' ? 'stock' : 'sport' }); const c = rodar(3);
    mn = Math.min(a[0], b[0], c[0]); mx = Math.max(a[1], b[1], c[1]);
    const piso = mn0 - 0.08 * alvo;
    ok = !apagou && !nan && mn >= piso;
    criterio = `antes ${mn0.toFixed(0)}–${mx0.toFixed(0)} rpm · nas trocas ${mn.toFixed(0)}–${mx.toFixed(0)} (mínimo aceito ${piso.toFixed(0)})`;
  }
  return { id: `troca:${nome}`, temp: 90, ok, texto: `${ok ? 'ok   ' : 'FALHA'} ${('troca ' + nome).padEnd(16)} 90 °C · ${t.id} · ${apagou ? 'APAGOU' : 'sem apagar'} · ${criterio}${nan ? ' · NaN' : ''}` };
}

const args = process.argv.slice(2);
if (args[0] === '--um') {
  umCaso(args[1], +args[2]).then((r) => { process.stdout.write(JSON.stringify(r)); });
} else if (args[0] === '--troca') {
  casoTroca(args[1]).then((r) => { process.stdout.write(JSON.stringify(r)); });
} else {
  const ji = args.indexOf('--j');
  const J = ji >= 0 ? +args[ji + 1] : Math.max(2, Math.floor(os.cpus().length * 0.6));
  const ids = args.filter((a, i) => !a.startsWith('--') && (ji < 0 || i !== ji + 1));
  const todos = ids.length ? ids : PRESETS_ROTATIVO.filter((p) => p.tipo !== 'palhetas').map((p) => p.id);
  const fila: (readonly [string, number | null])[] = todos.flatMap((id) => [20, -5].map((t) => [id, t] as const));
  const nTrocas = ids.length ? 0 : Object.keys(TROCAS).length;
  if (!ids.length) for (const n of Object.keys(TROCAS)) fila.push([n, null]);
  const res: Resultado[] = [];
  const t0 = Date.now();
  const rodar = (id: string, t: number | null) => new Promise<Resultado>((ok) => {
    const p = spawn(process.execPath, ['--import', 'tsx', AQUI, ...(t === null ? ['--troca', id] : ['--um', id, String(t)])], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = ''; p.stdout.on('data', (b) => { out += b; });
    p.on('close', () => { try { ok(JSON.parse(out)); } catch { ok({ id, temp: t ?? 90, ok: false, texto: `FALHA ${id} ${t ?? 'troca'} · erro no render` }); } });
  });
  (async () => {
    await Promise.all(Array.from({ length: J }, async () => { while (fila.length) { const [id, t] = fila.shift()!; const r = await rodar(id, t); res.push(r); console.log(r.texto); } }));
    const f = res.filter((r) => !r.ok).length;
    console.log(`\n${res.length} casos (${todos.length} presets × 2 temperaturas${nTrocas ? ` + ${nTrocas} de troca de configuração` : ''}) em ${((Date.now() - t0) / 1000).toFixed(0)} s: ${res.length - f} ok, ${f} falhas`);
    process.exitCode = f ? 1 : 0;
  })();
}
