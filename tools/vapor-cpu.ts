// CPU do vapor (VAPOR.md 7 passo 2: "CPU por amostra < 1/3 do Ronco"), fora do `teste:vapor` (AUDITORIA A8, T-VAP-12):
// o VaporDSP (K4s, UP 844 e Big Boy em marcha a 10 chuffs/s, regulador cheio, todos os canais) contra o Ronco (V8 em
// carga), em 3 passadas alternadas Ronco/vapor, com o tempo de CPU do processo (`process.cpuUsage()`), e a mediana das
// razões. Com o tempo de relógio e uma passada só o Big Boy ia de 0,34 a 0,40 com a máquina ocupada.
//
//   npx tsx tools/vapor-cpu.ts [--atualizar[=nome]]     (desvios no retrato tools/vapor-desvios.json, grupo `cpu`)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineDSP } from '../src/engines/ronco/dsp';
import { configCalibrada } from '../src/engines/ronco/config';
import { PRESETS, ACESSORIOS_PADRAO } from '../src/engines/ronco/presets';
import { VaporDSP } from '../src/engines/vapor/dsp';
import { presetVapor, escapesPorVolta } from '../src/engines/vapor/presets';
import { prepararMotorVapor } from '../src/engines/vapor/motor';
import { SR, TAU } from './vapor-comum';
import { lerOpcoes, mediana, fmtSementes, avaliarDesvios, imprimirAvaliacao, type Medida } from './desvios';

const RETRATO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'vapor-desvios.json');
const B = 128;
const cpu = (f: () => void) => { const c0 = process.cpuUsage(); f(); const c = process.cpuUsage(c0); return (c.user + c.system) / 1e6; };

function ronco() {
  const r = new EngineDSP(SR);
  r.setConfig(configCalibrada({ ...ACESSORIOS_PADRAO, ...PRESETS.find((p: any) => p.id === 'muscle')! }, SR));
  r.message({ type: 'input', ignition: true });
  const bl = new Float32Array(B), br = new Float32Array(B);
  for (let i = 0; i < 2 * SR; i += B) r.process(bl, br, B);
  r.message({ type: 'input', throttle: 1 });
  return cpu(() => { for (let i = 0; i < 10 * SR; i += B) r.process(bl, br, B); });
}
function vapor(id: string, tudo: boolean) {
  const P = presetVapor(id)!;
  const d = new VaporDSP(SR);
  d.configurar(prepararMotorVapor(P, SR), SR);
  d.comandar({ acelerador: 0, ignicao: true, partida: false, bombaAr: false, injetor: false, torneiras: false, soprador: false } as any);
  d.fixar({ regulador: 1, cutoff: (0.3 - 0.15) / 0.7 });
  d.pChest = d.pCal * 1e5 + 101325;
  d.impor((10 / escapesPorVolta(P)) * TAU);
  if (tudo) d.comandar({ acelerador: 0, ignicao: true, partida: false, apito: 1, sino: true, bombaAr: true, torneiras: true } as any);
  const tmp = d.fontes.map(() => new Float32Array(B));
  for (let i = 0; i < SR; i += B) d.processar(tmp, B);
  return cpu(() => { for (let i = 0; i < 10 * SR; i += B) d.processar(tmp, B); });
}

const op = lerOpcoes(process.argv.slice(2));
const casos: [string, boolean][] = [['k4s', false], ['up844', false], ['bigboy', false], ['bigboy', true]];
const raz: number[][] = casos.map(() => []), tR: number[] = [];
for (let k = 0; k < 3; k++) {
  const r = ronco(); tR.push(r);
  casos.forEach(([id, tudo], i) => raz[i].push(vapor(id, tudo) / r));
}
const L: Medida[] = [];
casos.forEach(([id, tudo], i) => {
  const q = mediana(raz[i]);
  if (tudo) L.push({ grupo: 'cpu', nome: 'CPU com apito, sino, bomba e torneiras ligados, Big Boy (informativo)', alvo: '—', medido: `${q.toFixed(2)} do Ronco (${fmtSementes(raz[i], 2)})`, ok: true, valor: q, unidade: '' });
  else L.push({ grupo: 'cpu', nome: `CPU por amostra, ${id} em marcha (10 chuffs/s, auxiliares no automático) / Ronco (V8 em carga)`, alvo: '< 1/3', medido: `${q.toFixed(2)} (passadas ${fmtSementes(raz[i], 2)}; Ronco ${(mediana(tR) * 10).toFixed(1)}% do tempo real)`, ok: q < 1 / 3, valor: q, unidade: '' });
});
const r = avaliarDesvios(RETRATO, L, { atualizar: op.atualizar, grupos: ['cpu'] });
imprimirAvaliacao(r, { motivo: true });
process.exitCode = r.contagem.falha ? 1 : 0;
