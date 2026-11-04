// Teste de lenta do radial e da família aviação (RADIAL.md 8, passos 7 e 8): todos os presets radiais (menos a Megola,
// que não tem lenta) e os 10 de aviação do Ronco, a 20 °C e a −5 °C, com a partida de verdade (arranque, contagem de pás,
// magnetos no automático; o de inércia é engatado aos 0,5 s), acelerada aos 12 s (60% por 1,5 s) e 40 s no total.
// Passa com zero apagamentos depois de pegar, rotação final (35–40 s) a ±3% do alvo do controle de lenta e sem NaN.
// (A janela era 25–30 s: nos pequenos que pegam tarde, como o Verner 5S aos 7 s, as falhas da partida, 0,12·e^(−t/15),
// ainda são 3% aos 20 s de funcionamento, e o controle de lenta, que abriu ar para segurá-las, desce devagar de propósito:
// a lenta fica 3–6% acima do alvo até uns 30 s. Ela passava porque os estouros da partida, 20 dB acima do que as
// gravações têm, freavam o motor pela contrapressão no escape.)
//
//   npx tsx tools/radial-lenta.ts [ids...] [--j 8]
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PRESETS_RADIAL } from '../src/engines/radial/presets';
import { PRESETS_AVIACAO } from '../src/engines/ronco/presets';

const AQUI = fileURLToPath(import.meta.url);

type Resultado = { id: string; temp: number; ok: boolean; texto: string };

async function umCaso(id: string, temp: number): Promise<Resultado> {
  const { preset, novoDSP, renderizar, trecho, media, SR } = await import('./radial-comum');
  const { EngineDSP } = await import('../src/engines/ronco/dsp');
  const { configCalibrada } = await import('../src/engines/ronco/config');
  const { ACESSORIOS_PADRAO } = await import('../src/engines/ronco/presets');
  const av = PRESETS_AVIACAO.find((p) => p.id === id);
  let d: any;
  if (av) {
    d = new EngineDSP(SR);
    d.setConfig(configCalibrada({ ...ACESSORIOS_PADRAO, ...av }, SR));
    d.message({ type: 'params', params: { ambSound: false } });
    d.ambientT = temp; d.coolant = temp; d.exhT = temp;
  } else d = novoDSP(preset(id), { temp });
  const ev: [number, (x: any) => void][] = [
    [0, (x) => x.message({ type: 'input', ignition: true })],
    [0.5, (x) => { if (x.engatar) x.engatar(); }],
    [12, (x) => x.message({ type: 'input', throttle: 0.6 })],
    [13.5, (x) => x.message({ type: 'input', throttle: 0 })],
  ];
  const r = renderizar(d, 40, ev as any);
  let nan = false; for (let i = 0; i < r.L.length; i += 97) if (!Number.isFinite(r.L[i])) { nan = true; break; }
  const pegou = r.tele.findIndex((q) => q.state === 'run');
  const apagou = pegou >= 0 && r.tele.slice(pegou).some((q) => q.state === 'off');
  const fim = trecho(r.tele, 35, 40);
  const rpm = media(fim.map((q) => q.rpm)), alvo = media(fim.map((q) => q.idleTarget));
  const erro = alvo ? (100 * (rpm - alvo)) / alvo : 100;
  const tPega = pegou >= 0 ? r.tele[pegou].t : NaN;
  const ok = !nan && pegou >= 0 && !apagou && Math.abs(erro) <= 3;
  return { id, temp, ok, texto: `${ok ? 'ok   ' : 'FALHA'} ${id.padEnd(11)} ${String(temp).padStart(3)} °C · pegou em ${tPega.toFixed(1)} s · ${apagou ? 'APAGOU' : 'sem apagar'} · lenta ${rpm.toFixed(0)} rpm (alvo ${alvo.toFixed(0)}, ${erro >= 0 ? '+' : ''}${erro.toFixed(1)}%)${nan ? ' · NaN' : ''}` };
}

const args = process.argv.slice(2);
if (args[0] === '--um') {
  umCaso(args[1], +args[2]).then((r) => { process.stdout.write(JSON.stringify(r)); });
} else {
  const ji = args.indexOf('--j');
  const J = ji >= 0 ? +args[ji + 1] : Math.max(2, Math.floor(os.cpus().length * 0.6));
  const ids = args.filter((a, i) => !a.startsWith('--') && (ji < 0 || i !== ji + 1));
  const todos = ids.length ? ids : [...PRESETS_RADIAL.filter((p) => p.id !== 'megola').map((p) => p.id), ...PRESETS_AVIACAO.map((p) => p.id)];
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
