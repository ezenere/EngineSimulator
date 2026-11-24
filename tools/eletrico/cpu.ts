// CPU e coleta de lixo do Elétrico (ELETRICO.md 7, passos 1 e 12), fora do `teste:eletrico` (AUDITORIA A8, T-ELE-10):
// o banco de 200 linhas (< 3% do tempo real), o motor do N700 com 4 unidades (≤ 5%), o N700 no túnel pela Cena (< 40% do
// quantum por bloco) e as coletas de lixo em 10 s (zero no banco, ≤ 6 no motor). As três de CPU com o tempo de CPU do
// processo (`process.cpuUsage()`) e a mediana de 3 passadas: com o tempo de relógio e a máquina ocupada elas falhavam
// sozinhas (4,1–7,4% no banco); as coletas, mediana de 3 processos. Medido como na página (tools/cpu-pagina.ts): cada
// caso num processo só dele, a configuração calibrada (a sonda de nível) chegando por mensagem e o código empacotado
// pelo rolldown, o empacotador do Vite, sem os nomes das funções; as coletas contadas pelo `PerformanceObserver` do
// próprio processo. (Até 23/11/2026 os três casos rodavam no processo do tsx, que põe um Object.defineProperty em cada
// função criada, e as coletas eram as do `--trace-gc` de um tools/eletrico/gc.ts, também pelo tsx, que saiu; ver docs/TECNICO.md →
// Diesel → CPU do laço de amostra.)
//
// O motor do N700 é medido em regime: os primeiros AQUECER s de som de cada processo não contam. Num processo novo o V8
// ainda compila o laço e a geração jovem começa pequena, então os primeiros 10 s custam mais e coletam mais do que o
// motor em regime, que é o que os portões do ELETRICO.md descrevem (medido em 23/11/2026, trechos seguidos de 10 s no
// mesmo processo: 5,0–5,3 % e 6–9 coletas no primeiro, 4,5–5,0 % e 2–4 coletas nos seguintes). No processo do tsx de
// antes o banco de 200 linhas já tinha rodado quando o motor era medido, e o aquecimento vinha de graça.
//
//   npx tsx tools/eletrico/cpu.ts         (sai ≠ 0 se algum portão falhar)
import { cfg } from './comum';
import { mediana, fmtSementes } from '../desvios';
import { medirSozinho, Filho } from '../cpu-pagina';

const f1 = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
let falhas = 0;
const caso = (nome: string, alvo: string, medido: string, ok: boolean) => { if (!ok) falhas++; console.log(`${ok ? 'ok   ' : 'FALHA'} [cpu] ${nome}: alvo ${alvo} · medido ${medido}`); };
const tres = async (f: () => Promise<any>) => [await f(), await f(), await f()];
const AQUECER = 10; // (s de som antes da medida do motor do N700: ver o cabeçalho)

(async () => {
  const n700 = cfg('n700');
  // banco de 200 linhas de 50 Hz a 20 kHz, 10 s
  const bs = (await tres(() => medirSozinho({ familia: 'eletrico', caso: 'banco' }))).map((x) => x.fr);
  caso('CPU de 200 linhas (como na página; tempo de CPU, mediana de 3)', '< 3% do tempo real', `${f1(100 * mediana(bs), 2)}% (${fmtSementes(bs.map((x) => 100 * x), 2)} %)`, mediana(bs) < 0.03);
  // motor do N700, 4 unidades, 10 s
  const ms = await tres(() => medirSozinho({ familia: 'eletrico', caso: 'n700', dados: { cfg: n700 } }, 10, AQUECER)), mc = mediana(ms.map((x) => x.fr));
  caso(`motor do N700, 4 unidades (≤ 800 osciladores; como na página, em regime: depois de ${AQUECER} s; tempo de CPU, mediana de 3)`, '≈ 3% do tempo real (≤ 5%)', `${f1(100 * mc, 2)}% (${fmtSementes(ms.map((x) => 100 * x.fr), 2)} %; ${ms[0].info.nos} osciladores no máximo)`, mc <= 0.05);
  // N700 no túnel pela Cena: CPU por bloco de 128 contra o quantum (2,67 ms) = o tempo de CPU por segundo de som
  const ts = await tres(() => medirSozinho({ familia: 'eletrico', caso: 'tunel', dados: { cfg: n700 } }, 6)), tq = mediana(ts.map((x) => x.fr));
  caso(`N700 no túnel pela Cena (${ts[0].info.fontes} fontes, 4 unidades): CPU por bloco (como na página; tempo de CPU, mediana de 3)`, '< 40% do quantum', `${f1(100 * tq)}% (${fmtSementes(ts.map((x) => 100 * x.fr))} %)`, tq < 0.4);
  // sem alocação: as coletas em 10 s do banco e do motor do N700 com carga, num processo de cada vez, mediana de 3
  const coletas = async (c: string, dados?: any, aquecer = 0) => { const f = await Filho.abrir({ familia: 'eletrico', caso: c, dados }); try { if (aquecer > 0) await f.rodar(aquecer); return (await f.alocacao(10, false)).coletas; } finally { f.fechar(); } };
  const gb = await tres(() => coletas('banco')), gm = await tres(() => coletas('motorCarga', { cfg: n700 }, AQUECER));
  const nb = mediana(gb), nm = mediana(gm);
  caso('sem alocação: 10 s do banco de 200 linhas', 'zero coletas', `${nb} coletas (${fmtSementes(gb, 0)})`, nb === 0);
  caso(`quase sem alocação: 10 s do motor do N700 em regime (4 unidades, 4 bancos cada; depois de ${AQUECER} s)`, '≤ 6 coletas jovens (a Cena aceita 14)', `${nm} coletas (${fmtSementes(gm, 0)})`, nm <= 6);
  console.log(`\n${falhas ? `${falhas} falhas` : 'sem falhas'}`);
  process.exitCode = falhas ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(2); });
