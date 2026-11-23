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
// O que passa do portão é desvio declarado, com teto, no retrato do Diesel (`tools/diesel-desvios.json`, grupo `cpu`).
// O teto é sobre a razão entre o caso e a referência do DIESEL.md (o Chiron do Ronco, rodado alternado com o caso),
// não sobre o tempo de CPU sozinho: este quase dobra com a máquina ocupada por outros processos (cache, frequência,
// núcleos irmãos), a razão muda menos. A medida passa se a razão ficar abaixo do valor gravado mais a folga (+30 %, de um
// lado só: ficar mais barato nunca reprova). Acima do teto: falha, até `--atualizar` (regrava a razão dos que passam do
// portão; o que é novo entra com o motivo vazio e continua falhando até alguém escrever o motivo). Voltou para baixo do
// portão: aviso de desvio órfão, a não ser que a entrada esteja marcada `beira: true` (como no tools/desvios.ts): o caso
// fica perto do portão e passa ou não conforme a carga da máquina; passar é aceito sem aviso, e passar do portão cai no
// teto da razão. Rode sozinho, como o `npm run verificar -- --cpu` faz.
//
//   npx tsx tools/diesel-cpu.ts [--atualizar[=nome exato]]      (sai ≠ 0 se algum passar do teto, ou do portão fora do retrato)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DieselDSP } from '../src/engines/diesel/dsp';
import { configCalibrada } from '../src/engines/diesel/config';
import { preset, SR } from './diesel-comum';
import { EngineDSP } from '../src/engines/ronco/dsp';
import { configCalibrada as configRonco } from '../src/engines/ronco/config';
import { PRESETS as PRESETS_RONCO, ACESSORIOS_PADRAO } from '../src/engines/ronco/presets';
import { lerOpcoes, lerRetrato, mediana, fmtSementes } from './desvios';

const RETRATO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'diesel-desvios.json');
const PORTAO = 0.4, B = 128;
const f1 = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

// a referência do DIESEL.md 8.1: o Chiron (W16 como V16) do Ronco em plena carga travada a 5 000 rpm. Ele e o caso rodam
// alternados, em trechos de 0,25 s, e cada um soma o seu tempo de CPU: os dois passam pela mesma carga da máquina, e a
// razão entre eles muda bem menos que o tempo de cada um
const cfgV16 = configRonco({ ...ACESSORIOS_PADRAO, ...PRESETS_RONCO.find((p) => p.id === 'v16')! }, SR);
function novaReferencia() {
  const d: any = new EngineDSP(SR), rpm = 5000;
  d.setConfig(cfgV16);
  d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } });
  Object.assign(d, { state: 'run', ignition: true, runT: 100, lockOmega: true, omega: (rpm * Math.PI * 2) / 60, rpmAvg: rpm, thrTarget: 1, thr: 1 });
  return d;
}

function novoCaso(id: string, cfg: any) {
  const sp = preset(id), d: any = new DieselDSP(SR);
  d.params.listener = 'ext';
  d.setConfig(cfg);
  const loco = sp.portadores[0] === 'locomotiva';
  d.message({ type: 'diesel', portador: loco ? 'locomotiva' : 'carro' });
  d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } });
  if (loco) { d.message({ type: 'input', ignition: true }); d.message({ type: 'diesel', notch: 8 }); }
  else {
    // plena carga travada na rotação de potência (a sonda de potência do teste:diesel)
    const rpm = sp.rpmPotencia;
    Object.assign(d, { state: 'run', runT: 30, lockOmega: true, sonda: true, fuelCmd: 1, fuelM: 1, omega: (rpm * Math.PI * 2) / 60, rpmAvg: rpm, tw: 0.95, turboW: 0.95, tEsc: 500 });
    d.boostFixo = sp.boost + (d.soprador0 ? d.soprador0(rpm) : 0);
  }
  return { d, aquece: loco ? 12 : 2 };
}

function umaPassada(id: string, cfg: any) {
  const { d, aquece } = novoCaso(id, cfg), v = novaReferencia();
  const l = new Float32Array(B), r = new Float32Array(B);
  const rodar = (x: any, s: number) => { for (let i = 0; i < s * SR; i += B) x.process(l, r, B); };
  // (aquece o JIT, o turbo e a temperatura do escape antes de medir; na locomotiva, a subida até o notch 8)
  rodar(d, aquece); rodar(v, 2);
  let cd = 0, cv = 0;
  for (let k = 0; k < 40; k++) {
    let c0 = process.cpuUsage(); rodar(v, 0.25); let c = process.cpuUsage(c0); cv += c.user + c.system;
    c0 = process.cpuUsage(); rodar(d, 0.25); c = process.cpuUsage(c0); cd += c.user + c.system;
  }
  const fr = cd / 1e6 / 10, ref = cv / 1e6 / 10;
  return { fr, ref, raz: fr / ref, rpm: d.rpmAvg, tubos: d.lines.length, nos: d.nodes.length };
}

const op = lerOpcoes(process.argv.slice(2));
// `--atualizar` regrava todas as medidas; `--atualizar=<nome exato>` só essa (repetível), como no teste:diesel. (Antes a
// lista de nomes contava como "sim" e o nome dado não era conferido: qualquer --atualizar=… regravava as três.)
const atualiza = (nome: string) => op.atualizar === true || (Array.isArray(op.atualizar) && op.atualizar.includes(nome));
// (aquecimento fora da medida: o V16 e um diesel alternados, para o JIT do laço comum do EngineDSP chegar ao estado de
// regime antes da primeira passada; sem isso a primeira razão da EMD saía 50% acima das outras duas)
{
  const v = novaReferencia(), { d } = novoCaso('hilux28', configCalibrada(preset('hilux28'), SR)), l = new Float32Array(B), r = new Float32Array(B);
  for (let k = 0; k < 8; k++) for (const x of [v, d]) for (let i = 0; i < 0.5 * SR; i += B) x.process(l, r, B);
}
const ret = lerRetrato(RETRATO), FOLGA = '+30 %';
const casos: [string, string][] = [['emd710', 'EMD 16-710 (2 tempos, 16 cilindros) em notch 8'], ['ge7fdl', 'GE 7FDL-16 (4 tempos, 16 cilindros) em notch 8'], ['duramax66', 'Duramax 6.6 V8 em plena carga travada']];
let falhas = 0, mudou = false;
const avisos: string[] = [];
for (const [id, rotulo] of casos) {
  const cfg = configCalibrada(preset(id), SR);
  const ps = [umaPassada(id, cfg), umaPassada(id, cfg), umaPassada(id, cfg)];
  const fr = mediana(ps.map((x) => x.fr)), raz = mediana(ps.map((x) => x.raz)), v = +raz.toPrecision(3);
  const nome = `${rotulo}, 10 s em Node (tempo de CPU, mediana de 3)`, alvo = `≤ ${f1(100 * PORTAO, 0)}% do tempo real (DIESEL.md 8.1)`;
  const medido = `${f1(100 * fr)}% (${fmtSementes(ps.map((x) => 100 * x.fr))} %), ${f1(raz, 2)}× o V16 do Ronco (${fmtSementes(ps.map((x) => x.raz), 2)}; o V16 a ${f1(100 * mediana(ps.map((x) => x.ref)))}%); ${f1(ps[0].rpm, 0)} rpm; ${ps[0].tubos} tubos, ${ps[0].nos} nós`;
  const e = ret[nome];
  let estado: string, nota = '';
  if (fr <= PORTAO) {
    estado = 'ok   ';
    if (e?.beira) { if (atualiza(nome)) { ret[nome] = { ...e, medido: v }; mudou = true; nota = `à beira do portão: retrato regravado (era ${e.medido}× o V16)`; } }
    else if (e) { if (atualiza(nome)) { delete ret[nome]; mudou = true; avisos.push(`desvio órfão retirado do retrato: "${nome}"`); } else avisos.push(`desvio órfão: "${nome}" passa no portão (${f1(100 * fr)}%); tire do retrato com --atualizar`); }
  } else if (atualiza(nome)) {
    ret[nome] = { ...(e ?? { grupo: 'cpu', unidade: '× V16', folga: FOLGA, alvo, motivo: '' }), medido: v };
    mudou = true; estado = e?.motivo?.trim() ? 'desv ' : 'FALHA'; nota = e ? `retrato regravado (era ${e.medido}× o V16)` : 'desvio novo gravado no retrato: escreva o motivo';
  } else if (!e) { estado = 'FALHA'; nota = 'fora do portão, fora do retrato'; }
  else {
    const teto = (e.medido as number) * (1 + parseFloat(String(e.folga ?? FOLGA).replace(/[^\d.,]/g, '').replace(',', '.')) / 100);
    if (!e.motivo?.trim()) { estado = 'FALHA'; nota = 'desvio sem motivo no retrato'; }
    else if (raz <= teto) { estado = 'desv '; nota = `retrato ${e.medido}× o V16 ${e.folga ?? FOLGA} (teto ${f1(teto, 2)}×)`; }
    else { estado = 'FALHA'; nota = `passou do teto do retrato: era ${e.medido}× o V16 ${e.folga ?? FOLGA} (teto ${f1(teto, 2)}×), agora ${f1(raz, 2)}× (se a mudança é a intenção: --atualizar)`; }
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
