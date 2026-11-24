// CPU do radial (RADIAL.md 8 passo 10), fora do `teste:radial` (AUDITORIA A8, T-RAD-03): o R-4360 (28 cilindros, 4
// anéis) subindo de giro por 10 s, medido como na página (tools/cpu-pagina.ts: um processo só para o caso, com uma
// instância do RadialDSP, a configuração calibrada chegando por mensagem e o código empacotado pelo rolldown, o
// empacotador do Vite, sem os nomes das funções). Mede o tempo de CPU do processo (`process.cpuUsage()`), não o de
// relógio, e tira a mediana de 3 passadas: com a máquina ocupada o tempo de relógio ia de 26% a 45%. (Até 23/11/2026 a
// medida era no processo do tsx, que põe um Object.defineProperty em cada função criada; ver docs/TECNICO.md → Diesel →
// CPU do laço de amostra.)
//
//   npx tsx tools/radial-cpu.ts         (sai ≠ 0 se passar do portão; o alvo do navegador, ≤ 50% do quantum, é o do
//                                         npm run navegador:radial)
import { preset, SR } from './radial-comum';
import { configCalibrada } from '../src/engines/radial/config';
import { mediana, fmtSementes } from './desvios';
import { medirSozinho } from './cpu-pagina';

(async () => {
  const spec = preset('r4360'), caso = { familia: 'radial', caso: 'subida', dados: { cfg: configCalibrada(spec, SR), spec } };
  const ps = [await medirSozinho(caso), await medirSozinho(caso), await medirSozinho(caso)];
  const fr = mediana(ps.map((p) => p.fr));
  const ok = fr <= 0.6;
  console.log(`${ok ? 'ok   ' : 'FALHA'} [cpu] R-4360 (28 cilindros, 4 anéis) subindo de giro, 10 s como na página (processo próprio, empacotado; tempo de CPU, mediana de 3): alvo ≤ 60% do tempo real · medido ${(100 * fr).toFixed(1)}% (${fmtSementes(ps.map((p) => 100 * p.fr))} %; ${ps[0].info.tubos} tubos, ${ps[0].info.nos} nós)`);
  process.exitCode = ok ? 0 : 1;
})().catch((e) => { console.error(e); process.exit(2); });
