// Custo de CPU por bloco e alocação no laço (CENA.md 5.1, passo 3): trem 10×25 m no túnel, 10 s, só o
// laço do worklet (portador + cena, blocos de 128), sem nada do harness dentro do trecho medido.
//
//   npx tsx tools/cena/cpu.ts                         tempos por bloco
//   node --trace-gc --import tsx tools/cena/cpu.ts    + coletas de lixo entre os marcadores
// (medirAlocacao() roda a segunda forma num processo filho e conta as coletas.)
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CenaPassagem } from '../../src/scene/cena';
import { ambientePassagem } from '../../src/scene/ambientes';
import { Trem } from '../../src/carriers/trem';

const SR = 48000, B = 128;

export function laco(segundos = 10, imprimir = false) {
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
  if (imprimir) console.log('### INICIO');
  for (let k = 0; k < n; k++) {
    const t0 = performance.now();
    trem.processar(canais, B, 1 / SR);
    cena.processar(trem, canais, L, R, sL, sR, B);
    t[k] = performance.now() - t0;
  }
  if (imprimir) console.log('### FIM');
  const ord = Float64Array.from(t).sort();
  const soma = t.reduce((a, b) => a + b, 0);
  const quantum = (B / SR) * 1000;
  return { fontes: trem.fontes().length, mediaMs: soma / n, p99Ms: ord[Math.floor(0.99 * n)], maxMs: ord[n - 1], quantumMs: quantum, fracao: soma / n / quantum };
}

/** roda o laço num processo com --trace-gc e conta as coletas entre os marcadores */
export function medirAlocacao() {
  const r = spawnSync(process.execPath, ['--trace-gc', '--import', 'tsx', fileURLToPath(import.meta.url), '--gc'], { encoding: 'utf8', maxBuffer: 64 << 20, cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..') });
  const linhas = (r.stdout || '').split('\n');
  const i0 = linhas.findIndex((l) => l.includes('### INICIO')), i1 = linhas.findIndex((l) => l.includes('### FIM'));
  const gcs = i0 >= 0 && i1 > i0 ? linhas.slice(i0 + 1, i1).filter((l) => /Scavenge|Mark-Compact|Mark-sweep|MinorMS/i.test(l)) : null;
  const pausas = (gcs || []).map((l) => Number((/([0-9.]+) \/ [0-9.]+ ms/.exec(l) || [])[1])).filter((x) => Number.isFinite(x));
  const mb = (gcs || []).map((l) => { const m = /([0-9.]+) \([0-9.]+\) -> ([0-9.]+)/.exec(l); return m ? Number(m[1]) - Number(m[2]) : 0; }).reduce((a, b) => a + b, 0);
  return { coletas: gcs ? gcs.length : NaN, pausaMediaMs: pausas.length ? pausas.reduce((a, b) => a + b, 0) / pausas.length : 0, pausaMaxMs: pausas.length ? Math.max(...pausas) : 0, mbColetados: mb, erro: r.status !== 0 ? (r.stderr || '').slice(0, 300) : '' };
}

const ehCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (ehCli) {
  const gc = process.argv.includes('--gc');
  const r = laco(10, gc);
  if (!gc) console.log(`trem 10×25 m no túnel, ${r.fontes} fontes: média ${(r.mediaMs * 1000).toFixed(0)} µs, p99 ${(r.p99Ms * 1000).toFixed(0)} µs, máx ${(r.maxMs * 1000).toFixed(0)} µs por bloco de 128 (quantum ${(r.quantumMs * 1000).toFixed(0)} µs): ${(100 * r.fracao).toFixed(1)}%`);
}
