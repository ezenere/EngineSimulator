// CPU do vapor (VAPOR.md 7 passo 2: "CPU por amostra < 1/3 do Ronco"), fora do `teste:vapor` (AUDITORIA A8, T-VAP-12):
// o VaporDSP (K4s, UP 844 e Big Boy em marcha a 10 chuffs/s, regulador cheio, todos os canais) contra o Ronco (V8 em
// carga), com o tempo de CPU do processo (`process.cpuUsage()`), e a mediana das razões de 3 passadas. Com o tempo de
// relógio e uma passada só o Big Boy ia de 0,34 a 0,40 com a máquina ocupada. Medido como na página
// (tools/cpu-pagina.ts): o vapor e o Ronco, cada um num processo só dele, alternados em trechos de 0,25 s, com a
// configuração calibrada chegando por mensagem e o código empacotado pelo rolldown, o empacotador do Vite, sem os nomes
// das funções (até 23/11/2026 os dois rodavam no processo do tsx, um depois do outro; ver docs/TECNICO.md → Diesel →
// CPU do laço de amostra). É o motor (o que o MotorVapor entrega à Cena), sem o portador nem a Cena.
//
//   npx tsx tools/vapor-cpu.ts [--atualizar[=nome]]     (desvios no retrato tools/vapor-desvios.json, grupo `cpu`)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configCalibrada } from '../src/engines/ronco/config';
import { PRESETS, ACESSORIOS_PADRAO } from '../src/engines/ronco/presets';
import { presetVapor } from '../src/engines/vapor/presets';
import { prepararMotorVapor } from '../src/engines/vapor/motor';
import { SR } from './vapor-comum';
import { lerOpcoes, mediana, fmtSementes, avaliarDesvios, imprimirAvaliacao, type Medida } from './desvios';
import { medirAlternados } from './cpu-pagina';

const RETRATO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'vapor-desvios.json');

(async () => {
  const op = lerOpcoes(process.argv.slice(2));
  const ronco = { familia: 'ronco', caso: 'muscle', dados: { cfg: configCalibrada({ ...ACESSORIOS_PADRAO, ...PRESETS.find((p: any) => p.id === 'muscle')! }, SR) } };
  const casos: [string, boolean][] = [['k4s', false], ['up844', false], ['bigboy', false], ['bigboy', true]];
  const L: Medida[] = [];
  for (const [id, tudo] of casos) {
    const vapor = { familia: 'vapor', caso: tudo ? 'tudo' : 'marcha', dados: { cfg: prepararMotorVapor(presetVapor(id)!, SR) } };
    const raz: number[] = [], tR: number[] = [];
    for (let k = 0; k < 3; k++) { const [r, v] = await medirAlternados([ronco, vapor]); raz.push(v.fr / r.fr); tR.push(r.fr); }
    const q = mediana(raz);
    if (tudo) L.push({ grupo: 'cpu', nome: 'CPU com apito, sino, bomba e torneiras ligados, Big Boy (informativo)', alvo: '—', medido: `${q.toFixed(2)} do Ronco (${fmtSementes(raz, 2)})`, ok: true, valor: q, unidade: '' });
    else L.push({ grupo: 'cpu', nome: `CPU por amostra, ${id} em marcha (10 chuffs/s, auxiliares no automático) / Ronco (V8 em carga)`, alvo: '< 1/3', medido: `${q.toFixed(2)} (passadas ${fmtSementes(raz, 2)}; Ronco ${(mediana(tR) * 100).toFixed(1)}% do tempo real; como na página: processos próprios, empacotados)`, ok: q < 1 / 3, valor: q, unidade: '' });
  }
  const r = avaliarDesvios(RETRATO, L, { atualizar: op.atualizar, grupos: ['cpu'] });
  imprimirAvaliacao(r, { motivo: true });
  process.exitCode = r.contagem.falha ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(2); });
