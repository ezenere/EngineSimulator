// CPU dos rotativos (ROTATIVO.md 8 passo 12), fora do `teste:rotativo` (AUDITORIA A8, G-11): o tempo de CPU do processo
// (`process.cpuUsage()`, não o de relógio) para 10 s de render em Node, mediana de 3 passadas, nos três presets mais caros:
// o 787B (R26B, 12 câmaras, 4 primários e megafone) e os dois biturbo sequenciais, o RX-7 FD e o Cosmo 20B, que a rodada
// de som mediu a 1,8× e 2,3× o 787B (o teste antigo só media o 787B, com o relógio: falhava com a máquina ocupada, 59,9%
// contra o portão de 45% no dia 22/11/2026). Cada um sustentado em ponto morto a 85% de rpmMax com o acelerador a 0,6
// (o cenário `rev` de antes) e em plena carga a 70% de rpmMax (os dois turbos cheios). Sem ruído sorteado: a semente de
// fábrica (o custo não depende dela).
//
//   npx tsx tools/rotativo-cpu.ts       (sai ≠ 0 se algum passar do portão de 45% do tempo real)
import { SR, preset, novoDSP, travar, sustentar } from './rotativo-comum';
import { mediana, fmtSementes } from './desvios';

const PORTAO = 0.45, B = 128;
const f1 = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

function umaPassada(id: string, cenario: 'rev' | 'carga') {
  const p = preset(id), rpm = p.rpmMax * (cenario === 'rev' ? 0.85 : 0.7);
  const d = novoDSP(p, { quente: true, rpm });
  const cada = cenario === 'rev' ? sustentar(d, rpm, 0.6) : (travar(d, rpm, 1), null);
  const l = new Float32Array(B), r = new Float32Array(B);
  // (aquece o JIT, os turbos e a temperatura do escape por 2 s antes de medir)
  for (let i = 0; i < 2 * SR; i += B) { cada?.(d); d.process(l, r, B); }
  const c0 = process.cpuUsage();
  for (let i = 0; i < 10 * SR; i += B) { cada?.(d); d.process(l, r, B); }
  const c = process.cpuUsage(c0);
  return { fr: (c.user + c.system) / 1e6 / 10, rpm, boost: d.boost ?? 0, tubos: d.lines.length, nos: d.nodes.length };
}

const casos: [string, string][] = [['r26b', '787B (R26B, 12 câmaras, 4 primários, megafone)'], ['rx7fd', 'RX-7 FD (13B-REW, biturbo sequencial)'], ['cosmo20b', 'Cosmo 20B-REW (3 rotores, biturbo sequencial)']];
let falhas = 0;
const ref: Record<string, number> = {};
for (const cenario of ['rev', 'carga'] as const) {
  for (const [id, rotulo] of casos) {
    const ps = [umaPassada(id, cenario), umaPassada(id, cenario), umaPassada(id, cenario)];
    const fr = mediana(ps.map((x) => x.fr)), ok = fr <= PORTAO;
    if (!ok) falhas++;
    if (id === 'r26b') ref[cenario] = fr;
    const raz = id === 'r26b' ? '' : `; ${f1(fr / ref[cenario], 2)}× o 787B`;
    const cond = cenario === 'rev' ? `sustentado em ponto morto a ${f1(ps[0].rpm, 0)} rpm` : `plena carga a ${f1(ps[0].rpm, 0)} rpm (boost ${f1(ps[0].boost, 2)} bar)`;
    console.log(`${ok ? 'ok   ' : 'FALHA'} [cpu] ${rotulo}, ${cond}, 10 s em Node (tempo de CPU, mediana de 3): alvo ≤ ${f1(100 * PORTAO, 0)}% do tempo real · medido ${f1(100 * fr)}% (${fmtSementes(ps.map((x) => 100 * x.fr))} %; ${ps[0].tubos} tubos, ${ps[0].nos} nós${raz})`);
  }
}
console.log(`\n${2 * casos.length} medidas de CPU: ${falhas ? `${falhas} falhas` : 'sem falhas'}`);
process.exitCode = falhas ? 1 : 0;
