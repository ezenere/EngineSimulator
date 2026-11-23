// CPU do Diesel, fora do `teste:diesel` (AUDITORIA A8, G-11): o tempo de CPU do processo (`process.cpuUsage()`, não o
// de relógio) para 10 s de render em Node, mediana de 3 passadas, nos três presets mais caros da tabela de CPU por
// família da AUDITORIA (frente de robustez: `ge7fdl` 59 % e `emd710` 59 % do quantum no navegador, `duramax66` 35 %).
// O portão é o do DIESEL.md 8.1: o render da EMD em notches em Node a no máximo 40% do tempo real (o Chiron V16 do Ronco
// é a referência). As locomotivas são medidas em notch 8 sustentado, o trecho mais caro do cenário `notches` (16
// cilindros, o resolvedor implícito do escape em todas as válvulas abertas, o turbo cheio): 12 s para subir do
// notch 0 ao 8 e assentar, fora da medida, e 10 s medidos; a picape, em plena carga travada na rotação de potência. A
// configuração calibrada sai antes do relógio (a sonda roda fora da thread de áudio, como na página). Sem ruído sorteado:
// a semente de fábrica (o custo não depende dela).
//
// O que passa do portão é desvio declarado, com teto, no retrato do Diesel (`tools/diesel-desvios.json`, grupo `cpu`):
// a medida passa se ficar abaixo do valor gravado lá mais a folga (+30 %, de um lado só: ficar mais barato nunca reprova;
// o tempo de CPU sobe com a máquina ocupada por outros processos, por cache, frequência e núcleos irmãos). Acima do
// teto: falha, até `--atualizar` (regrava o valor dos que passam do portão; o que é novo entra com o motivo vazio e
// continua falhando até alguém escrever o motivo). Voltou para baixo do portão: aviso de desvio órfão. Rode sozinho, como
// o `npm run verificar -- --cpu` faz.
//
//   npx tsx tools/diesel-cpu.ts [--atualizar]      (sai ≠ 0 se algum passar do teto, ou do portão fora do retrato)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DieselDSP } from '../src/engines/diesel/dsp';
import { configCalibrada } from '../src/engines/diesel/config';
import { preset, SR } from './diesel-comum';
import { lerOpcoes, lerRetrato, mediana, fmtSementes } from './desvios';

const RETRATO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'diesel-desvios.json');
const PORTAO = 0.4, B = 128;
const f1 = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

function umaPassada(id: string, cfg: any) {
  const sp = preset(id), d: any = new DieselDSP(SR);
  d.params.listener = 'ext';
  d.setConfig(cfg);
  const loco = sp.portadores[0] === 'locomotiva';
  d.message({ type: 'diesel', portador: loco ? 'locomotiva' : 'carro' });
  d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } });
  const l = new Float32Array(B), r = new Float32Array(B);
  let aquece = 2;
  if (loco) { d.message({ type: 'input', ignition: true }); d.message({ type: 'diesel', notch: 8 }); aquece = 12; }
  else {
    // plena carga travada na rotação de potência (a sonda de potência do teste:diesel)
    const rpm = sp.rpmPotencia;
    Object.assign(d, { state: 'run', runT: 30, lockOmega: true, sonda: true, fuelCmd: 1, fuelM: 1, omega: (rpm * Math.PI * 2) / 60, rpmAvg: rpm, tw: 0.95, turboW: 0.95, tEsc: 500 });
    d.boostFixo = sp.boost + (d.soprador0 ? d.soprador0(rpm) : 0);
  }
  // (aquece o JIT, o turbo e a temperatura do escape antes de medir; na locomotiva, a subida até o notch 8)
  for (let i = 0; i < aquece * SR; i += B) d.process(l, r, B);
  const c0 = process.cpuUsage();
  for (let i = 0; i < 10 * SR; i += B) d.process(l, r, B);
  const c = process.cpuUsage(c0);
  return { fr: (c.user + c.system) / 1e6 / 10, rpm: d.rpmAvg, tubos: d.lines.length, nos: d.nodes.length };
}

const op = lerOpcoes(process.argv.slice(2));
const ret = lerRetrato(RETRATO), FOLGA = '+30 %';
const casos: [string, string][] = [['emd710', 'EMD 16-710 (2 tempos, 16 cilindros) em notch 8'], ['ge7fdl', 'GE 7FDL-16 (4 tempos, 16 cilindros) em notch 8'], ['duramax66', 'Duramax 6.6 V8 em plena carga travada']];
let falhas = 0, mudou = false;
const avisos: string[] = [];
for (const [id, rotulo] of casos) {
  const cfg = configCalibrada(preset(id), SR);
  const ps = [umaPassada(id, cfg), umaPassada(id, cfg), umaPassada(id, cfg)];
  const fr = mediana(ps.map((x) => x.fr)), v = +(100 * fr).toPrecision(4);
  const nome = `${rotulo}, 10 s em Node (tempo de CPU, mediana de 3)`, alvo = `≤ ${f1(100 * PORTAO, 0)}% do tempo real (DIESEL.md 8.1)`;
  const medido = `${f1(100 * fr)}% (${fmtSementes(ps.map((x) => 100 * x.fr))} %; ${f1(ps[0].rpm, 0)} rpm; ${ps[0].tubos} tubos, ${ps[0].nos} nós)`;
  const e = ret[nome];
  let estado: string, nota = '';
  if (fr <= PORTAO) {
    estado = 'ok   ';
    if (e) { if (op.atualizar) { delete ret[nome]; mudou = true; avisos.push(`desvio órfão retirado do retrato: "${nome}"`); } else avisos.push(`desvio órfão: "${nome}" passa no portão (${f1(100 * fr)}%); tire do retrato com --atualizar`); }
  } else if (op.atualizar) {
    ret[nome] = { ...(e ?? { grupo: 'cpu', unidade: '%', folga: FOLGA, alvo, motivo: '' }), medido: v };
    mudou = true; estado = e?.motivo?.trim() ? 'desv ' : 'FALHA'; nota = e ? `retrato regravado (era ${e.medido}%)` : 'desvio novo gravado no retrato: escreva o motivo';
  } else if (!e) { estado = 'FALHA'; nota = 'fora do portão, fora do retrato'; }
  else {
    const teto = (e.medido as number) * (1 + parseFloat(String(e.folga ?? FOLGA).replace(/[^\d.,]/g, '').replace(',', '.')) / 100);
    if (!e.motivo?.trim()) { estado = 'FALHA'; nota = 'desvio sem motivo no retrato'; }
    else if (fr * 100 <= teto) { estado = 'desv '; nota = `retrato ${e.medido}% ${e.folga ?? FOLGA} (teto ${f1(teto)}%)`; }
    else { estado = 'FALHA'; nota = `passou do teto do retrato: era ${e.medido}% ${e.folga ?? FOLGA} (teto ${f1(teto)}%), agora ${f1(100 * fr)}% (se a mudança é a intenção: --atualizar)`; }
  }
  if (estado === 'FALHA') falhas++;
  console.log(`${estado} [cpu] ${nome}: alvo ${alvo} · medido ${medido}`);
  if (nota) console.log(`        ${nota}`);
  if (estado === 'desv ' && e?.motivo) console.log(`        desvio: ${e.motivo}`);
}
if (mudou) fs.writeFileSync(RETRATO, JSON.stringify(ret, null, 2) + '\n');
if (avisos.length) { console.log('\navisos:'); for (const a of avisos) console.log(`  - ${a}`); }
console.log(`\n${casos.length} medidas de CPU: ${falhas ? `${falhas} falhas` : 'sem falhas'} (portão ${f1(100 * PORTAO, 0)}%; os que passam dele estão no retrato com teto de ${FOLGA})`);
process.exitCode = falhas ? 1 : 0;
