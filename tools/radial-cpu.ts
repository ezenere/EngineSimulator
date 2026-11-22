// CPU do radial (RADIAL.md 8 passo 10), fora do `teste:radial` (AUDITORIA A8, T-RAD-03): o R-4360 (28 cilindros, 4
// anéis) subindo de giro por 10 s em Node. Mede o tempo de CPU do processo (`process.cpuUsage()`), não o de relógio, e
// tira a mediana de 3 passadas: com a máquina ocupada o tempo de relógio ia de 26% a 45%.
//
//   npx tsx tools/radial-cpu.ts         (sai ≠ 0 se passar do portão; o alvo do navegador, ≤ 50% do quantum, é o do
//                                         npm run navegador:radial)
import { preset, novoDSP, SR } from './radial-comum';
import { mediana, fmtSementes } from './desvios';

function umaPassada() {
  const d = novoDSP(preset('r4360'), { quente: true });
  const B = 128, l = new Float32Array(B), r = new Float32Array(B);
  // (aquece o JIT um segundo antes de medir)
  for (let i = 0; i < SR; i += B) d.process(l, r, B);
  const c0 = process.cpuUsage();
  for (let i = 0; i < 10 * SR; i += B) { if (i === SR) d.message({ type: 'input', throttle: 1 }); d.process(l, r, B); }
  const c = process.cpuUsage(c0);
  return { fr: (c.user + c.system) / 1e6 / 10, tubos: d.lines.length, nos: d.nodes.length };
}

const ps = [umaPassada(), umaPassada(), umaPassada()];
const fr = mediana(ps.map((p) => p.fr));
const ok = fr <= 0.6;
console.log(`${ok ? 'ok   ' : 'FALHA'} [cpu] R-4360 (28 cilindros, 4 anéis) subindo de giro, 10 s em Node (tempo de CPU, mediana de 3): alvo ≤ 60% do tempo real · medido ${(100 * fr).toFixed(1)}% (${fmtSementes(ps.map((p) => 100 * p.fr))} %; ${ps[0].tubos} tubos, ${ps[0].nos} nós)`);
process.exitCode = ok ? 0 : 1;
