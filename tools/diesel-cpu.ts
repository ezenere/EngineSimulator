// CPU do Diesel, fora do `teste:diesel` (AUDITORIA A8, G-11), medida como na página (tools/cpu-pagina.ts): cada caso num
// processo só dele, com uma instância do DieselDSP, a configuração calibrada chegando por mensagem (a página calibra na
// thread principal) e o código empacotado pelo rolldown, o empacotador do Vite, sem os nomes das funções. O tempo de CPU
// do processo (`process.cpuUsage()`, não o de relógio) em 10 s de som, mediana de 3 passadas, nos três presets mais
// caros: a EMD e a GE em notch 8 sustentado (16 cilindros, o resolvedor implícito do escape em todas as válvulas
// abertas, o turbo cheio; 12 s para subir do notch 0 ao 8 e assentar, fora da medida) e a Duramax em plena carga
// travada na rotação de potência. Sem ruído sorteado: a semente de fábrica (o custo não depende dela).
//
// O portão é o do DIESEL.md 8.1: a EMD em notches a no máximo 40% do tempo real (vale para os três). A referência do
// DIESEL.md, o Chiron (W16 como V16) do Ronco em plena carga travada a 5 000 rpm, roda noutro processo, alternado com o
// caso em trechos de 0,25 s (os dois passam pela mesma carga da máquina): a razão sai na linha, e é sobre ela o teto dos
// desvios. (Até 23/11/2026 a medida era no processo do tsx, com a referência, a Hilux do aquecimento, as três passadas e
// as sondas juntas: o laço comum do EngineDSP ficava megamórfico e o `keepNames` do tsx custava um Object.defineProperty
// por função criada; ver docs/TECNICO.md → Diesel → CPU do laço de amostra.)
//
// O que passa do portão é desvio declarado, com teto, no retrato do Diesel (`tools/diesel-desvios.json`, grupo `cpu`):
// passa se a razão ao V16 ficar abaixo do valor gravado mais a folga (+30 %, de um lado só: ficar mais barato nunca
// reprova). Acima do teto: falha, até `--atualizar` (regrava a razão dos que passam do portão; o que é novo entra com o
// motivo vazio e continua falhando até alguém escrever o motivo). Voltou para baixo do portão: aviso de desvio órfão, a
// não ser que a entrada esteja marcada `beira: true` (como no tools/desvios.ts): passar é aceito sem aviso, e passar do
// portão cai no teto da razão. Entrada do grupo `cpu` com um nome que a ferramenta não mede mais: aviso, e
// `--atualizar=<nome>` a tira. Rode sozinho, como o `npm run verificar -- --cpu` faz.
//
//   npx tsx tools/diesel-cpu.ts [--atualizar[=nome exato]]      (sai ≠ 0 se algum passar do teto, ou do portão fora do retrato)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configCalibrada } from '../src/engines/diesel/config';
import { preset, SR } from './diesel-comum';
import { configCalibrada as configRonco } from '../src/engines/ronco/config';
import { PRESETS as PRESETS_RONCO, ACESSORIOS_PADRAO } from '../src/engines/ronco/presets';
import { lerOpcoes, lerRetrato, mediana, fmtSementes } from './desvios';
import { medirAlternados } from './cpu-pagina';

const RETRATO = path.join(path.dirname(fileURLToPath(import.meta.url)), 'diesel-desvios.json');
const PORTAO = 0.4;
const f1 = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

const op = lerOpcoes(process.argv.slice(2));
// `--atualizar` regrava todas as medidas; `--atualizar=<nome exato>` só essa (repetível), como no teste:diesel
const atualiza = (nome: string) => op.atualizar === true || (Array.isArray(op.atualizar) && op.atualizar.includes(nome));

(async () => {
  const v16 = { familia: 'ronco', caso: 'v16', dados: { cfg: configRonco({ ...ACESSORIOS_PADRAO, ...PRESETS_RONCO.find((p) => p.id === 'v16')! }, SR) } };
  const ret = lerRetrato(RETRATO), FOLGA = '+30 %';
  const casos: [string, string][] = [['emd710', 'EMD 16-710 (2 tempos, 16 cilindros) em notch 8'], ['ge7fdl', 'GE 7FDL-16 (4 tempos, 16 cilindros) em notch 8'], ['duramax66', 'Duramax 6.6 V8 em plena carga travada']];
  let falhas = 0, mudou = false;
  const avisos: string[] = [], nomes: string[] = [];
  for (const [id, rotulo] of casos) {
    const spec = preset(id), loco = spec.portadores[0] === 'locomotiva';
    const caso = { familia: 'diesel', caso: loco ? 'notch8' : 'plena', dados: { cfg: configCalibrada(spec, SR), spec } };
    const ps: { fr: number; ref: number; raz: number; info: any }[] = [];
    for (let k = 0; k < 3; k++) { const [r, c] = await medirAlternados([v16, caso]); ps.push({ fr: c.fr, ref: r.fr, raz: c.fr / r.fr, info: c.info }); }
    const fr = mediana(ps.map((x) => x.fr)), raz = mediana(ps.map((x) => x.raz)), v = +raz.toPrecision(3);
    const nome = `${rotulo}, 10 s como na página (processo próprio, empacotado; tempo de CPU, mediana de 3)`, alvo = `≤ ${f1(100 * PORTAO, 0)}% do tempo real (DIESEL.md 8.1)`;
    nomes.push(nome);
    const medido = `${f1(100 * fr)}% (${fmtSementes(ps.map((x) => 100 * x.fr))} %), ${f1(raz, 2)}× o V16 do Ronco (${fmtSementes(ps.map((x) => x.raz), 2)}; o V16 a ${f1(100 * mediana(ps.map((x) => x.ref)))}%); ${f1(ps[0].info.rpm, 0)} rpm; ${ps[0].info.tubos} tubos, ${ps[0].info.nos} nós`;
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
  // entradas de CPU com nomes que a ferramenta não mede mais (a medida mudou de nome)
  for (const [k, e] of Object.entries(ret)) {
    if ((e as any).grupo !== 'cpu' || nomes.includes(k)) continue;
    if (atualiza(k)) { delete ret[k]; mudou = true; avisos.push(`entrada sem medida retirada do retrato: "${k}"`); }
    else avisos.push(`entrada do grupo cpu sem medida (o nome mudou?): "${k}"; tire com --atualizar="${k}"`);
  }
  if (mudou) fs.writeFileSync(RETRATO, JSON.stringify(ret, null, 2) + '\n');
  if (avisos.length) { console.log('\navisos:'); for (const a of avisos) console.log(`  - ${a}`); }
  console.log(`\n${casos.length} medidas de CPU: ${falhas ? `${falhas} falhas` : 'sem falhas'} (portão ${f1(100 * PORTAO, 0)}%; os que passam dele estão no retrato com teto de ${FOLGA})`);
  process.exitCode = falhas ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(2); });
