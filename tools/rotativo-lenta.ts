// Teste de lenta dos rotativos (ROTATIVO.md 8, passo 11): os 16 presets Wankel e X-Engine, a 20 °C e a −5 °C, com a
// partida de verdade (arranque elétrico, pegar, aquecer), acelerada aos 12 s (60% por 1,5 s) e 30 s no total. Passa com
// zero apagamentos depois de pegar, sem NaN e com a rotação final (25–30 s) a ±3% do alvo do controle de lenta; nas
// janelas de competição (sobreposição > 90°e: o 787B) o critério é o da caça: 0,75–1,2× o alvo, sem apagar (quente:
// 1 600–2 200, medido no grupo `lenta` do teste:rotativo).
// O motor de palhetas não tem lenta (é a ferramenta ou o arranque): fica de fora.
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

const args = process.argv.slice(2);
if (args[0] === '--um') {
  umCaso(args[1], +args[2]).then((r) => { process.stdout.write(JSON.stringify(r)); });
} else {
  const ji = args.indexOf('--j');
  const J = ji >= 0 ? +args[ji + 1] : Math.max(2, Math.floor(os.cpus().length * 0.6));
  const ids = args.filter((a, i) => !a.startsWith('--') && (ji < 0 || i !== ji + 1));
  const todos = ids.length ? ids : PRESETS_ROTATIVO.filter((p) => p.tipo !== 'palhetas').map((p) => p.id);
  const fila = todos.flatMap((id) => [20, -5].map((t) => [id, t] as const));
  const res: Resultado[] = [];
  const t0 = Date.now();
  const rodar = (id: string, t: number) => new Promise<Resultado>((ok) => {
    const p = spawn(process.execPath, ['--import', 'tsx', AQUI, '--um', id, String(t)], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = ''; p.stdout.on('data', (b) => { out += b; });
    p.on('close', () => { try { ok(JSON.parse(out)); } catch { ok({ id, temp: t, ok: false, texto: `FALHA ${id} ${t} °C · erro no render` }); } });
  });
  (async () => {
    await Promise.all(Array.from({ length: J }, async () => { while (fila.length) { const [id, t] = fila.shift()!; const r = await rodar(id, t); res.push(r); console.log(r.texto); } }));
    const f = res.filter((r) => !r.ok).length;
    console.log(`\n${res.length} casos (${todos.length} presets × 2 temperaturas) em ${((Date.now() - t0) / 1000).toFixed(0)} s: ${res.length - f} ok, ${f} falhas`);
    process.exitCode = f ? 1 : 0;
  })();
}
