// Geometria do radial contra as tabelas conferidas do RADIAL.md (1.2, 1.4 e Apêndice B; porta de geom.py/geom3.py):
//  - ΔPMS e curso das articuladas (9 cilindros nos três jogos de L/r e r_k/r de 1.2; 3, 5, 7 e 9 do B.1) a ±0,05°;
//  - intervalos exatos (±1e-6) com as ordens reais e PMS nominais: 80° (9), 51,43° (14), 40° (18), 25,714° (28);
//  - ordem sequencial do 18 inválida; ordem decorrente do R-4360 igual à de 1.4; fire[] do B.2;
//  - balance: f1 = N/2 e f2 = 0 (N ≥ 5) sem ΔPMS; 9 cilindros com 3,6/1,2: f1 4,583 e f2 0,433 ± 0,02.
//
//   npx tsx tools/radial-geometria.ts        (sai ≠ 0 se algo falhar)
import { buildRadial, pmsArticulada, ordemDecorrente } from '../src/engines/radial/geometria';
import { schedule, intervals, balance } from '../src/engines/ronco/geometria';

let falhas = 0;
export const resultados: { nome: string; alvo: string; medido: string; ok: boolean }[] = [];
function conf(nome: string, alvo: string, medido: string, ok: boolean) {
  resultados.push({ nome, alvo, medido, ok });
  if (!ok) falhas++;
  console.log(`${ok ? 'ok   ' : 'FALHA'} ${nome}: alvo ${alvo} · medido ${medido}`);
}
const f2 = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(2);

// 1.2: 9 cilindros
const T12: [number, number, number[]][] = [
  [3.8, 1.0, [0.60, 3.45, 4.95, 2.20, -2.20, -4.95, -3.45, -0.60]],
  [3.6, 1.2, [0.90, 5.05, 6.80, 2.95, -2.95, -6.80, -5.05, -0.90]],
  [3.4, 1.3, [1.20, 6.50, 8.30, 3.50, -3.50, -8.30, -6.50, -1.20]],
];
for (const [Lr, rkr, alvo] of T12) {
  const med = alvo.map((_, k) => pmsArticulada(40 * (k + 1), Lr, rkr).dPMS);
  const erro = Math.max(...med.map((m, k) => Math.abs(m - alvo[k])));
  conf(`ΔPMS 9 cil., L/r ${Lr}, r_k/r ${rkr}`, alvo.map(f2).join(' '), `${med.map(f2).join(' ')} (erro máx ${erro.toFixed(3)}°)`, erro <= 0.05 + 0.005);
}
{
  const alvo = [1.0001, 1.0029, 1.0086, 1.003, 1.003, 1.0086, 1.0029, 1.0001];
  const med = alvo.map((_, k) => pmsArticulada(40 * (k + 1), 3.8, 1.0).curso);
  const erro = Math.max(...med.map((m, k) => Math.abs(m - alvo[k])));
  conf('curso relativo 9 cil. (3,8/1,0)', alvo.join(' '), med.map((x) => x.toFixed(4)).join(' '), erro <= 0.0006);
}
// B.1: 3, 5, 7, 9 com 3,6/1,2
const B1: Record<number, number[]> = {
  3: [6.78, -6.78], 5: [4.12, 4.96, -4.96, -4.12], 7: [1.83, 6.79, 3.71, -3.71, -6.79, -1.83], 9: [0.91, 5.04, 6.78, 2.95, -2.95, -6.78, -5.04, -0.91],
};
for (const [N, alvo] of Object.entries(B1)) {
  const n = +N, med = alvo.map((_, k) => pmsArticulada((360 * (k + 1)) / n, 3.6, 1.2).dPMS);
  const erro = Math.max(...med.map((m, k) => Math.abs(m - alvo[k])));
  conf(`B.1 ΔPMS ${n} cil. (3,6/1,2)`, alvo.map(f2).join(' '), `${med.map(f2).join(' ')} (erro ${erro.toFixed(3)}°)`, erro <= 0.05 + 0.005);
}

// B.2: escalonamento com PMS nominais
const casos: [string, any, number, number[] | null][] = [
  ['9, 1-3-5-7-9-2-4-6-8', { cylinders: 9, order: '1-3-5-7-9-2-4-6-8' }, 80, [0, 400, 80, 480, 160, 560, 240, 640, 320]],
  ['14, P&W', { cylinders: 14, order: '1-10-5-14-9-4-13-8-3-12-7-2-11-6' }, 720 / 14, [0, 565.7, 411.4, 257.1, 102.9, 668.6, 514.3, 360, 205.7, 51.4, 617.1, 462.9, 308.6, 154.3]],
  ['18, P&W', { cylinders: 18, order: '1-12-5-16-9-2-13-6-17-10-3-14-7-18-11-4-15-8' }, 40, [0, 200, 400, 600, 80, 280, 480, 680, 160, 360, 560, 40, 240, 440, 640, 120, 320, 520]],
  ['28, decorrente', { cylinders: 28 }, 720 / 28, [0, 411.43, 102.86, 514.29, 205.71, 617.14, 308.57, 282.86, 694.29, 385.71, 77.14, 488.57, 180, 591.43, 565.71, 257.14, 668.57, 360, 51.43, 462.86, 154.29, 128.57, 540, 231.43, 642.86, 334.29, 25.71, 437.14]],
  ['7', { cylinders: 7 }, 720 / 7, null], ['5', { cylinders: 5 }, 144, null], ['3', { cylinders: 3 }, 240, null],
];
for (const [nome, spec, iv, fireRef] of casos) {
  const m = buildRadial({ ...spec, ideal: true });
  const erro = Math.max(...m.intervals.map((x) => Math.abs(x - iv)));
  conf(`intervalos ${nome}`, `${iv.toFixed(3)}° (±1e-6), válida`, `${[...new Set(m.intervals.map((x) => x.toFixed(6)))].join(' ')} · válida ${m.valid}`, m.valid && erro < 1e-6);
  if (fireRef) {
    const e = Math.max(...fireRef.map((f, c) => Math.abs(m.fire[c] - f)));
    conf(`fire[] ${nome} (B.2)`, 'tabela B.2 ±0,05°', `erro máx ${e.toFixed(3)}°`, e < 0.05);
  }
  if (m.rows > 1) {
    const pb = m.perBank.map((b) => [...new Set(b.map((x) => x.toFixed(2)))].join('/'));
    const primeiro = Math.min(...m.fire.filter((_, c) => m.fileira[c] === 1));
    conf(`por fileira ${nome}`, `${(720 / (m.N / m.rows)).toFixed(2)}° e a 2ª fileira começa em ${iv.toFixed(2)}° (dupla)`, `${pb.join(' · ')} · 2ª fileira em ${primeiro.toFixed(2)}°`,
      m.perBank.every((b) => b.every((x) => Math.abs(x - 720 / (m.N / m.rows)) < 1e-6)) && (m.rows !== 2 || Math.abs(primeiro - iv) < 1e-6));
  }
}
{
  const m = buildRadial({ cylinders: 18, order: Array.from({ length: 18 }, (_, i) => i + 1).join('-'), ideal: true });
  conf('18, ordem 1-2-…-18', 'inválida', `válida ${m.valid}`, !m.valid);
  const m28 = buildRadial({ cylinders: 28, ideal: true });
  const alvo = '1-27-19-11-3-22-21-13-5-24-16-8-7-26-18-10-2-28-20-12-4-23-15-14-6-25-17-9';
  conf('ordem decorrente do R-4360', alvo, m28.ordemTexto, m28.ordemTexto === alvo);
  const seqFil = m28.order.slice(0, 8).map((c) => m28.fileira[c - 1]).join('-');
  conf('R-4360: fileiras nos disparos', '0-3-2-1-0-3-2-1', seqFil, seqFil === '0-3-2-1-0-3-2-1');
  // outros moentes não fecham (duas fileiras na mesma fase)
  for (const pins of [[0, 180, 90, 270], [0, 270, 180, 90]]) {
    const per = 7, tdc = Array.from({ length: 28 }, (_, c) => { const r = Math.floor(c / per); return ((((c % per) * 360) / per + (r * 360) / 28 - pins[r]) % 360 + 360) % 360; });
    const o = ordemDecorrente(tdc, tdc.map((_, c) => Math.floor(c / per)), 4);
    conf(`R-4360 com moentes ${pins.join('/')}`, 'sem ordem uniforme', o ? 'achou' : 'nenhuma', !o);
  }
  void schedule;
}

// B.3: balanço
for (const N of [3, 5, 7, 9]) {
  const m = buildRadial({ cylinders: N, ideal: true });
  const b = m.balance;
  conf(`balance ${N} cil. ideal`, `f1 ${N / 2}, f2 ${N === 3 ? 1.5 : 0}`, `f1 ${b.f1.toFixed(3)}, f2 ${b.f2.toFixed(3)}`, Math.abs(b.f1 - N / 2) < 0.01 && Math.abs(b.f2 - (N === 3 ? 1.5 : 0)) < 0.01);
}
{
  const m = buildRadial({ cylinders: 9, Lr: 3.6, rkr: 1.2 });
  const b = m.balance;
  conf('balance 9 cil. com ΔPMS (3,6/1,2)', 'f1 4,583 · f2 0,43 ± 0,02', `f1 ${b.f1.toFixed(3)} · f2 ${b.f2.toFixed(3)}`, Math.abs(b.f1 - 4.583) < 0.02 && Math.abs(b.f2 - 0.433) <= 0.02);
  const m9 = buildRadial({ cylinders: 9 });
  // (o RADIAL.md 1.2 diz "80 ± 5°"; com os ΔPMS da própria tabela 1.2 os vizinhos na ordem somam até 7,2°: 120° (+4,95) seguido de 200° (−2,20))
  conf('9 cil. com ΔPMS (3,8/1,0): intervalos', '80 ± 7,2° (os ΔPMS da tabela 1.2 somados nos vizinhos da ordem)', `${Math.min(...m9.intervals).toFixed(2)}–${Math.max(...m9.intervals).toFixed(2)}°`, Math.min(...m9.intervals) > 72.7 && Math.max(...m9.intervals) < 87.3);
  const m18 = buildRadial({ cylinders: 18, order: '1-12-5-16-9-2-13-6-17-10-3-14-7-18-11-4-15-8' });
  conf('18 dupla: momento de 1ª ordem entre fileiras', 'm1 > 0, f1 ≈ 0', `m1 ${m18.balance.m1.toFixed(3)}, f1 ${m18.balance.f1.toFixed(3)}`, m18.balance.m1 > 0.1 && m18.balance.f1 < 0.5);
  void balance; void intervals;
}

console.log(`\n${resultados.length} medidas: ${resultados.length - falhas} ok, ${falhas} falhas`);
if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = falhas ? 1 : 0;
