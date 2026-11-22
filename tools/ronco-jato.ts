// Varredura dos controles "Diâmetro do escape" (pipeD) e "Ponteira (saída)" (tipD) do Ronco, do mínimo ao máximo:
// quanto do som é o chiado de jato da ponteira (o "papel rasgando") e o do vão da válvula de escape.
//
//   npx tsx tools/ronco-jato.ts <pasta/> [--presets muscle,i4,golfgti,fusca] [--campo JSON] [--j 12] [--dur 4] [--so lenta,parcial,plena]
//
// Para cada preset, três condições com o giro travado (como o tools/ouvido/render.ts): `lenta` (na lenta do preset,
// pedal que zera o torque), `parcial` (40% da faixa vermelha, 12% de pedal: coletor a ~0,5 bar) e `plena` (85% da faixa vermelha, pé
// embaixo). Em cada uma varre:
//   · o diâmetro do escape em 1,5 · 2 · 2,5 · 3 · 4" com a ponteira acompanhando o tubo (como o painel faz);
//   · a ponteira em 1,25 · 2 · 4" com o tubo do preset;
//   · o canto: tubo de 1,5" com ponteira de 1,25" (os dois controles no mínimo).
// De cada ponto grava três renders com a MESMA semente: <ponto>_tudo.wav, <ponto>_sem-jato.wav e
// <ponto>_sem-valvula.wav (o jato só soma na saída: tudo − sem é o jato, exato; o da válvula entra na rede de tubos e
// vale a diferença de energia). O tools/ronco-jato.py mede o conjunto: fração do nível ponderado A, leito e `ar`.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PRESETS, ACESSORIOS_PADRAO } from '../src/engines/ronco/presets';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const a = process.argv.slice(2);
const val = (k: string, d?: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
const pasta = a[0];
if (!pasta || pasta.startsWith('--')) { console.error('uso: tsx tools/ronco-jato.ts <pasta/> [--presets a,b] [--campo JSON] [--j 12] [--dur 4] [--so lenta,parcial,plena]'); process.exit(2); }
const ids = (val('--presets', 'muscle,i4,golfgti,fusca')!).split(',');
const campo = JSON.parse(val('--campo', '{}')!);
const J = +val('--j', '12')!, dur = val('--dur', '4')!;
const so = val('--so')?.split(',');
fs.mkdirSync(pasta, { recursive: true });

type Ponto = { preset: string; cond: string; nome: string; pipeD: number; tipD: number | null; args: string[] };
const pontos: Ponto[] = [];
for (const id of ids) {
  const p: any = { ...ACESSORIOS_PADRAO, ...PRESETS.find((x) => x.id === id) };
  if (!p.id) throw new Error(`preset desconhecido: ${id}`);
  const d0 = p.pipeD || 2.5;
  const conds: [string, string[]][] = [
    ['lenta', ['--rpm', String(p.idle)]],
    ['parcial', ['--rpm', String(Math.round(p.redline * 0.4)), '--pedal', '0.12']],
    ['plena', ['--rpm', String(Math.round(p.redline * 0.85)), '--pedal', '1']],
  ];
  const grade: [number, number | null][] = [[1.5, null], [2, null], [2.5, null], [3, null], [4, null], [d0, 1.25], [d0, 2], [d0, 4], [1.5, 1.25]];
  for (const [cond, args] of conds) {
    if (so && !so.includes(cond)) continue;
    for (const [pd, td] of grade) pontos.push({ preset: id, cond, nome: `${id}_${cond}_tubo${pd}_ponta${td ?? 'tubo'}`, pipeD: pd, tipD: td, args });
  }
}

const tsx = path.join(RAIZ, 'node_modules', '.bin', 'tsx');
function rodar(argv: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(tsx, argv, { cwd: RAIZ });
    let s = '';
    p.stdout.on('data', (d) => (s += d)); p.stderr.on('data', (d) => (s += d));
    p.on('close', (c) => (c === 0 ? resolve(s) : reject(new Error(`${argv.join(' ')}\n${s}`))));
  });
}
async function ponto(pt: Ponto) {
  const cf = JSON.stringify({ ...campo, pipeD: pt.pipeD, tipD: pt.tipD ?? undefined });
  const base = path.join(pasta, pt.nome);
  const comum = ['tools/ouvido/render.ts', pt.preset];
  const fim = [...pt.args, '--dur', dur, '--campo', cf];
  await rodar([...comum, `${base}_tudo.wav`, ...fim]);
  // (o pedal que zera o torque é o do render completo: desligar o chiado não pode mudar a carga)
  const info = JSON.parse(fs.readFileSync(`${base}_tudo.json`, 'utf8'));
  const fixo = fim.includes('--pedal') ? fim : [...fim, '--pedal', String(info.pedal)];
  await Promise.all([rodar([...comum, `${base}_sem-jato.wav`, ...fixo, '--sem', 'jato']), rodar([...comum, `${base}_sem-valvula.wav`, ...fixo, '--sem', 'valvula'])]);
  fs.writeFileSync(`${base}.json`, JSON.stringify({ ...pt, f0: info.f0, rpm: info.rpm, pedal: info.pedal, ev: info.eventosPorCiclo, coletorBar: info.coletorBar, pico: info.pico }, null, 1));
}
(async () => {
  const fila = [...pontos];
  const t0 = Date.now();
  let feitos = 0;
  await Promise.all(Array.from({ length: Math.min(J, fila.length) }, async () => {
    while (fila.length) { await ponto(fila.shift()!); if (++feitos % 12 === 0) console.log(`  ${feitos}/${pontos.length} pontos (${((Date.now() - t0) / 1000).toFixed(0)} s)`); }
  }));
  console.log(`${pontos.length} pontos (${ids.join(', ')}) em ${pasta} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
})().catch((e) => { console.error(String(e)); process.exit(1); });
