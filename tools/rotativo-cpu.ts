// CPU dos rotativos (ROTATIVO.md 8 passo 12), fora do `teste:rotativo` (AUDITORIA A8, G-11): o tempo de CPU do processo
// (`process.cpuUsage()`, não o de relógio) para 10 s de som, mediana de 3 passadas, nos três presets mais caros:
// o 787B (R26B, 12 câmaras, 4 primários e megafone) e os dois biturbo sequenciais, o RX-7 FD e o Cosmo 20B, que a rodada
// de som mediu a 1,8× e 2,3× o 787B (o teste antigo só media o 787B, com o relógio: falhava com a máquina ocupada, 59,9%
// contra o portão de 45% no dia 22/11/2026). Cada um sustentado em ponto morto a 85% de rpmMax com o acelerador a 0,6
// (o cenário `rev` de antes) e em plena carga a 70% de rpmMax (os dois turbos cheios). Sem ruído sorteado: a semente de
// fábrica (o custo não depende dela). Medido como na página (tools/cpu-pagina.ts): cada caso num processo só dele, com o
// RotativosDSP da página, a configuração calibrada chegando por mensagem e o código empacotado pelo rolldown, o
// empacotador do Vite, sem os nomes das funções (até 23/11/2026 era no processo do tsx, os seis casos juntos; ver
// docs/TECNICO.md → Diesel → CPU do laço de amostra).
//
//   npx tsx tools/rotativo-cpu.ts       (sai ≠ 0 se algum passar do portão de 45% do tempo real)
import { SR, preset } from './rotativo-comum';
import { configCalibrada } from '../src/engines/rotativo/config';
import { mediana, fmtSementes } from './desvios';
import { medirSozinho } from './cpu-pagina';

const PORTAO = 0.45;
const f1 = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

(async () => {
  const casos: [string, string][] = [['r26b', '787B (R26B, 12 câmaras, 4 primários, megafone)'], ['rx7fd', 'RX-7 FD (13B-REW, biturbo sequencial)'], ['cosmo20b', 'Cosmo 20B-REW (3 rotores, biturbo sequencial)']];
  let falhas = 0;
  const ref: Record<string, number> = {};
  for (const cenario of ['rev', 'carga'] as const) {
    for (const [id, rotulo] of casos) {
      const p = preset(id), caso = { familia: 'rotativo', caso: cenario, dados: { cfg: configCalibrada(p, SR), spec: p } };
      const ps = [await medirSozinho(caso), await medirSozinho(caso), await medirSozinho(caso)];
      const fr = mediana(ps.map((x) => x.fr)), ok = fr <= PORTAO, i0 = ps[0].info;
      if (!ok) falhas++;
      if (id === 'r26b') ref[cenario] = fr;
      const raz = id === 'r26b' ? '' : `; ${f1(fr / ref[cenario], 2)}× o 787B`;
      const cond = cenario === 'rev' ? `sustentado em ponto morto a ${f1(p.rpmMax * 0.85, 0)} rpm` : `plena carga a ${f1(p.rpmMax * 0.7, 0)} rpm (boost ${f1(i0.boost, 2)} bar)`;
      console.log(`${ok ? 'ok   ' : 'FALHA'} [cpu] ${rotulo}, ${cond}, 10 s como na página (processo próprio, empacotado; tempo de CPU, mediana de 3): alvo ≤ ${f1(100 * PORTAO, 0)}% do tempo real · medido ${f1(100 * fr)}% (${fmtSementes(ps.map((x) => 100 * x.fr))} %; ${i0.tubos} tubos, ${i0.nos} nós${raz})`);
    }
  }
  console.log(`\n${2 * casos.length} medidas de CPU: ${falhas ? `${falhas} falhas` : 'sem falhas'}`);
  process.exitCode = falhas ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(2); });
