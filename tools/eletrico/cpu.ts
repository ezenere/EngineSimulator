// CPU e coleta de lixo do Elétrico (ELETRICO.md 7, passos 1 e 12), fora do `teste:eletrico` (AUDITORIA A8, T-ELE-10):
// o banco de 200 linhas (< 3% do tempo real), o motor do N700 com 4 unidades (≤ 5%), o N700 no túnel pela Cena (< 40% do
// quantum por bloco) e as coletas do `--trace-gc` (tools/eletrico/gc.ts: zero no banco, ≤ 6 jovens no motor). As três
// de CPU com o tempo de CPU do processo (`process.cpuUsage()`) e a mediana de 3 passadas: com o tempo de relógio e a
// máquina ocupada elas falhavam sozinhas (4,1–7,4% no banco); as coletas, mediana de 3 processos.
//
//   npx tsx tools/eletrico/cpu.ts         (sai ≠ 0 se algum portão falhar)
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SR, motor, portador } from './comum';
import { BancoDeLinhas, ListaLinhas } from '../../src/engines/eletrico/linhas';
import { TAU } from '../../src/engines/eletrico/constantes';
import { ambientePassagem } from '../../src/scene/ambientes';
import { CenaDSP } from '../../src/scene/dsp-cena';
import type { Trem } from '../../src/carriers/trem';
import { mediana, fmtSementes } from '../desvios';

const f1 = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const cpu = (f: () => void) => { const c0 = process.cpuUsage(); f(); const c = process.cpuUsage(c0); return (c.user + c.system) / 1e6; };
let falhas = 0;
const caso = (nome: string, alvo: string, medido: string, ok: boolean) => { if (!ok) falhas++; console.log(`${ok ? 'ok   ' : 'FALHA'} [cpu] ${nome}: alvo ${alvo} · medido ${medido}`); };

// banco de 200 linhas de 50 Hz a 20 kHz, 10 s
const banco = () => {
  const nL = 200, b = new BancoDeLinhas(SR, nL, 7), L = new ListaLinhas(256), out = new Float32Array(10 * SR);
  const fq = Array.from({ length: nL }, (_, k) => 50 * Math.pow(20000 / 50, k / (nL - 1))), am = fq.map((_, k) => 0.002 * (1 + (k % 5)));
  return cpu(() => { for (let k = 0; k < out.length; k += 64) { L.limpar(); for (let i = 0; i < nL; i++) L.por(i, fq[i], am[i]); b.atualizar(L); b.processar(out, k, Math.min(64, out.length - k)); } }) / 10;
};
const bs = [banco(), banco(), banco()];
caso('CPU de 200 linhas (tempo de CPU, mediana de 3)', '< 3% do tempo real', `${f1(100 * mediana(bs), 2)}% (${fmtSementes(bs.map((x) => 100 * x), 2)} %)`, mediana(bs) < 0.03);

// motor do N700, 4 unidades, 10 s
const n700 = () => {
  const m = motor('n700');
  m.comandar({ acelerador: 0.6, ignicao: true, partida: false, omegaImposta: (2500 * TAU) / 60 } as never);
  const S = m.fontes.map(() => new Float32Array(128));
  for (let k = 0; k < 0.5 * SR; k += 128) m.processar(S, 128);
  let nos = 0; for (const U of m.uni) for (const b of [U.bMotor, U.bInv, U.bRed, U.bVen]) nos += b ? b.Lmax : 0;
  return { c: cpu(() => { for (let k = 0; k < 10 * SR; k += 128) m.processar(S, 128); }) / 10, nos };
};
const ms = [n700(), n700(), n700()], mc = mediana(ms.map((x) => x.c));
caso('motor do N700, 4 unidades (≤ 800 osciladores; tempo de CPU, mediana de 3)', '≈ 3% do tempo real (≤ 5%)', `${f1(100 * mc, 2)}% (${fmtSementes(ms.map((x) => 100 * x.c), 2)} %; ${ms[0].nos} osciladores no máximo)`, mc <= 0.05);

// N700 no túnel pela Cena: CPU por bloco de 128 contra o quantum (2,67 ms)
const tunel = () => {
  const t = portador('n700', {}, { N: 10, faces: 'duas' }) as Trem;
  t.comandar({ pedal: 0.6, ignicao: true, velocidadeFixa: 120 / 3.6 });
  const d = new CenaDSP(SR); d.cru = true;
  d.message({ type: 'cena', amb: ambientePassagem('tunel'), traj: { tipo: 'reta', comprimento: 3000, raioCurva: 2000, lateral: 3, altitude: 0, sentido: 1 }, ouv: { modo: 'fixo', pos: [0, 0, 1.6], gimbal: { az: 90, el: 0, r: 5, alvo: 'corpo' }, local: 'fora', binaural: true } });
  d.montar(t); d.message({ type: 'params', posicao: -200 });
  const B = 128, l = new Float32Array(B), r = new Float32Array(B), sl = new Float32Array(B), sr = new Float32Array(B);
  for (let k = 0; k < SR; k += B) d.process(l, r, B, sl, sr);
  const n = Math.round((6 * SR) / B);
  const c = cpu(() => { for (let k = 0; k < n; k++) d.process(l, r, B, sl, sr); });
  return { q: c / n / (B / SR), fontes: t.fontes().length };
};
const ts = [tunel(), tunel(), tunel()], tq = mediana(ts.map((x) => x.q));
caso(`N700 no túnel pela Cena (${ts[0].fontes} fontes, 4 unidades): CPU por bloco (tempo de CPU, mediana de 3)`, '< 40% do quantum', `${f1(100 * tq)}% (${fmtSementes(ts.map((x) => 100 * x.q))} %)`, tq < 0.4);

// sem alocação: --trace-gc num processo à parte (10 s do banco de 200 linhas e do motor do N700), mediana de 3 processos
const aqui = path.dirname(fileURLToPath(import.meta.url));
const coletas = () => {
  const r = spawnSync(process.execPath, ['--trace-gc', '--import', 'tsx', path.join(aqui, 'gc.ts')], { encoding: 'utf8', cwd: path.join(aqui, '../..') });
  const txt = r.stdout || '';
  const conta = (a: string, b: string) => { const i = txt.indexOf(a), j = txt.indexOf(b); if (i < 0 || j < 0) return NaN; return (txt.slice(i, j).match(/Scavenge|Mark-Compact|Mark-sweep/g) || []).length; };
  return [conta('INICIO-BANCO', 'FIM-BANCO'), conta('INICIO-MOTOR', 'FIM-MOTOR')];
};
const gs = [coletas(), coletas(), coletas()];
const nb = mediana(gs.map((g) => g[0])), nm = mediana(gs.map((g) => g[1]));
caso('sem alocação: 10 s do banco de 200 linhas', 'zero coletas', `${nb} coletas (${fmtSementes(gs.map((g) => g[0]), 0)})`, nb === 0);
caso('quase sem alocação: 10 s do motor do N700 (4 unidades, 4 bancos cada)', '≤ 6 coletas jovens (a Cena aceita 14)', `${nm} coletas (${fmtSementes(gs.map((g) => g[1]), 0)})`, nm <= 6);

console.log(`\n${falhas ? `${falhas} falhas` : 'sem falhas'}`);
process.exitCode = falhas ? 1 : 0;
