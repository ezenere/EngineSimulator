// CPU e alocação no laço da Cena (CENA.md 5.1, passo 3), fora do `teste:cena` (AUDITORIA A8, G-11, T-CEN-04, T-CEN-05):
// o laço do worklet (portador + cena, blocos de 128, sem nada do harness no trecho medido) com o trem 10×25 m no túnel,
// 48 fontes de ruído em movimento e o trem renderizado inteiro pela passagem offline. Medido com o tempo de CPU do
// processo (`process.cpuUsage()`, não o de relógio: com a máquina ocupada o relógio dava 54% num portão de 50%), mediana
// de 3 passadas; no laço do worklet também o p99 por bloco (o critério era só a média: um p99 de 80% do quantum passava).
// A alocação conta as coletas do `--trace-gc` num processo à parte, mediana de 3 processos; ela é um desvio com teto no
// retrato tools/cena-desvios.json (grupo `cpu`): o alvo do CENA é "sem alocação".
//
//   npx tsx tools/cena/cpu.ts [--atualizar[=nome]]     (sai ≠ 0 se algum portão falhar)
//   node --trace-gc --import tsx tools/cena/cpu.ts --gc     (só o laço entre os marcadores, para contar as coletas)
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CenaPassagem } from '../../src/scene/cena';
import { ambientePassagem } from '../../src/scene/ambientes';
import { Trem } from '../../src/carriers/trem';
import type { FonteTeste } from '../../src/carriers/teste';
import { renderPassagem } from './render-passagem';
import { lerOpcoes, mediana, fmtSementes, avaliarDesvios, imprimirAvaliacao, type Medida } from '../desvios';

const SR = 48000, B = 128, QUANTUM_MS = (B / SR) * 1000;
const AQUI = fileURLToPath(import.meta.url);
const RETRATO = path.resolve(path.dirname(AQUI), '..', 'cena-desvios.json');
const f1 = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

/** o laço do worklet por `segundos`: tempo de CPU de cada bloco (ms) */
export function laco(segundos = 10, marcar = false) {
  const trem = new Trem(SR, { ladoOuvinte: -1 });
  trem.cinematica.s = -600 - trem.corpo.comprimento / 2;
  trem.comandar({ pedal: 0, velocidadeFixa: 350 / 3.6 });
  const cena = new CenaPassagem();
  cena.configurar(ambientePassagem('tunel'), { tipo: 'reta', comprimento: 3000, raioCurva: 2000, lateral: 3, altitude: 0, sentido: 1 }, { modo: 'fixo', pos: [0, 0, 1.6], gimbal: { az: 90, el: 0, r: 5, alvo: 'corpo' }, local: 'fora', binaural: true }, SR);
  const canais = trem.fontes().map(() => new Float32Array(B));
  const L = new Float32Array(B), R = new Float32Array(B), sL = new Float32Array(B), sR = new Float32Array(B);
  // aquecimento (JIT e anéis): 1 s
  for (let i = 0; i < SR; i += B) { trem.processar(canais, B, 1 / SR); cena.processar(trem, canais, L, R, sL, sR, B); }
  const n = Math.round((segundos * SR) / B);
  const t = new Float64Array(n);
  if (marcar) console.log('### INICIO');
  for (let k = 0; k < n; k++) {
    const c0 = process.cpuUsage();
    trem.processar(canais, B, 1 / SR);
    cena.processar(trem, canais, L, R, sL, sR, B);
    const c = process.cpuUsage(c0);
    t[k] = (c.user + c.system) / 1000;
  }
  if (marcar) console.log('### FIM');
  const ord = Float64Array.from(t).sort();
  const soma = t.reduce((a, b) => a + b, 0);
  return { fontes: trem.fontes().length, mediaMs: soma / n, p99Ms: ord[Math.floor(0.99 * n)], maxMs: ord[n - 1], fracao: soma / n / QUANTUM_MS };
}

/** roda o laço num processo com --trace-gc e conta as coletas entre os marcadores */
export function medirAlocacao() {
  const r = spawnSync(process.execPath, ['--trace-gc', '--import', 'tsx', AQUI, '--gc'], { encoding: 'utf8', maxBuffer: 64 << 20, cwd: path.resolve(path.dirname(AQUI), '../..') });
  const linhas = (r.stdout || '').split('\n');
  const i0 = linhas.findIndex((l) => l.includes('### INICIO')), i1 = linhas.findIndex((l) => l.includes('### FIM'));
  const gcs = i0 >= 0 && i1 > i0 ? linhas.slice(i0 + 1, i1).filter((l) => /Scavenge|Mark-Compact|Mark-sweep|MinorMS/i.test(l)) : null;
  const pausas = (gcs || []).map((l) => Number((/([0-9.]+) \/ [0-9.]+ ms/.exec(l) || [])[1])).filter((x) => Number.isFinite(x));
  const mb = (gcs || []).map((l) => { const m = /([0-9.]+) \([0-9.]+\) -> ([0-9.]+)/.exec(l); return m ? Number(m[1]) - Number(m[2]) : 0; }).reduce((a, b) => a + b, 0);
  return { coletas: gcs ? gcs.length : NaN, pausaMaxMs: pausas.length ? Math.max(...pausas) : 0, mbPorS: mb / 10 };
}

/** 48 fontes de ruído em movimento, 10 s, pela passagem offline: fração do tempo real */
function quarentaEOito() {
  const fontes: FonteTeste[] = [];
  for (let i = 0; i < 48; i++) fontes.push({ pos: [-i * 2, (i % 2) * 0.8 - 0.4, 0.3 + (i % 5) * 0.5], sinal: 'ruido', paRms: 0.5 });
  const r = renderPassagem({ portador: 'teste', fontesTeste: fontes, corpoTeste: { largura: 3, altura: 3.5, zPiso: 0.4, comprimento: 100 }, v: 97.2, d: 3, ambiente: 'ceu', dur: 10, x0: 500, reverb: false, medirCpu: true });
  return { frac: r.cpuFracao!, us: r.cpuMsPorBloco! * 1000 };
}
/** o trem 10×25 m no túnel pela passagem offline (63 fontes + campo próximo): fração do quantum por bloco */
function tremTunel() {
  const r = renderPassagem({ portador: 'trem', v: 350 / 3.6, d: 3, ambiente: 'tunel', dur: 12, x0: 600, reverb: false, medirCpu: true });
  return { frac: r.cpuFracao!, us: r.cpuMsPorBloco! * 1000 };
}

const ehCli = process.argv[1] && path.resolve(process.argv[1]) === AQUI;
if (ehCli && process.argv.includes('--gc')) {
  laco(10, true);
} else if (ehCli) {
  const op = lerOpcoes(process.argv.slice(2));
  const L: Medida[] = [];
  const add = (nome: string, alvo: string, medido: string, ok: boolean, valor?: number | number[], unidade?: string) => L.push({ grupo: 'cpu', nome, alvo, medido, ok, valor, unidade });
  const la = [laco(10), laco(10), laco(10)];
  const fr = mediana(la.map((x) => x.fracao)), p99 = mediana(la.map((x) => x.p99Ms)), mx = mediana(la.map((x) => x.maxMs));
  add('CPU por bloco no laço do worklet (trem no túnel, só portador + cena; tempo de CPU, mediana de 3): média', '< 50% do quantum de 2,67 ms', `${f1(100 * fr)}% (${fmtSementes(la.map((x) => 100 * x.fracao))} %; média ${f1(fr * QUANTUM_MS * 1000, 0)} µs, ${la[0].fontes} fontes)`, fr < 0.5, fr, '');
  add('CPU por bloco no laço do worklet: p99', '< 75% do quantum (2,0 ms)', `${f1(p99 * 1000, 0)} µs (${f1((100 * p99) / QUANTUM_MS)}%; ${fmtSementes(la.map((x) => x.p99Ms * 1000), 0)} µs; máximo ${f1(mx * 1000, 0)} µs)`, p99 < 0.75 * QUANTUM_MS, p99, 'ms');
  const q = [quarentaEOito(), quarentaEOito(), quarentaEOito()], qf = mediana(q.map((x) => x.frac));
  add('CPU: 48 fontes, 10 s (Node, render offline; tempo de CPU, mediana de 3)', '< 25% do tempo real', `${f1(100 * qf)}% (${fmtSementes(q.map((x) => 100 * x.frac))} %; ${f1(mediana(q.map((x) => x.us)), 0)} µs por bloco de 128)`, qf < 0.25, qf, '');
  const t = [tremTunel(), tremTunel(), tremTunel()], tf = mediana(t.map((x) => x.frac));
  add('CPU: trem 10×25 m no túnel (63 fontes + campo próximo; tempo de CPU, mediana de 3)', '< 50% do quantum (5.1)', `${f1(100 * tf)}% (${fmtSementes(t.map((x) => 100 * x.frac))} %; ${f1(mediana(t.map((x) => x.us)), 0)} µs por bloco)`, tf < 0.5, tf, '');
  const gc = [medirAlocacao(), medirAlocacao(), medirAlocacao()];
  const mbs = mediana(gc.map((x) => x.mbPorS)), nc = mediana(gc.map((x) => x.coletas)), pm = mediana(gc.map((x) => x.pausaMaxMs));
  add('alocação no laço (--trace-gc, 10 s; mediana de 3 processos): MB coletados por segundo', 'sem alocação', `${f1(mbs, 1)} MB/s (${fmtSementes(gc.map((x) => x.mbPorS))}; ${nc} coletas jovens)`, nc === 0, mbs, 'MB/s');
  add('alocação no laço: pausa máxima de coleta', '≤ 1 ms (o quantum é 2,67 ms)', `${f1(pm, 2)} ms (${fmtSementes(gc.map((x) => x.pausaMaxMs), 2)})`, pm <= 1, pm, 'ms');
  const r = avaliarDesvios(RETRATO, L, { atualizar: op.atualizar, grupos: ['cpu'] });
  imprimirAvaliacao(r, { motivo: true });
  process.exitCode = r.contagem.falha ? 1 : 0;
}
