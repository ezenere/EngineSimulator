// Teste de lenta e de corte de giro do Ronco (o regressao.js / idletest.js / limtest.js do legado, em TypeScript):
//
//   npx tsx tools/ronco-lenta.ts [--so id,id] [--j 12] [--legado] [--dur 30] [--sem-corte] [--json saida.json]
//
// 1. LENTA: os 68 veículos dão a partida de verdade a 20 °C e a −5 °C (água esquentando de verdade) e ficam `--dur`
//    segundos na lenta, com o preset como a página o monta (ACESSORIOS_PADRAO + preset, calibrado). Falha se o motor
//    não pega em 5 s, apaga depois de pegar, gera NaN, satura a saída (pico ≥ 0,999) ou termina a mais de 12% do alvo
//    de lenta da central. Sai a tabela dos piores (giro mínimo depois de pegar, giro final ÷ alvo, oscilação).
// 2. CORTE DE GIRO: 8 presets (um de cada tipo de corte) quentes, em ponto morto, de pé embaixo por 5 s: frequência
//    do quique no limitador (entradas em corte por segundo), faixa do giro e o pico da saída. Falha se o giro passa de
//    8% acima da faixa vermelha (12% no corte 'none', que só tem a flutuação de válvulas) ou se a saída satura.
// `--legado` roda com os mecanismos novos no valor legado (MODO_LEGADO_RONCO de tools/legado.ts), para comparar: os
// mecanismos de médios só somam som na saída, então em motor quente a rotação tem de sair IGUAL amostra a amostra nos
// dois modos (o teste confere isso no corte de giro); a frio a bomba de ar muda o sorteio do ruído e a comparação é
// de resultado, não de amostra.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EngineDSP } from '../src/engines/ronco/dsp';
import { configCalibrada } from '../src/engines/ronco/config';
import { PRESETS, ACESSORIOS_PADRAO } from '../src/engines/ronco/presets';
import { MODO_LEGADO_RONCO } from './legado';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SR = 48000, B = 128;
const a = process.argv.slice(2);
const val = (k: string, d?: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : d; };
const LEGADO = a.includes('--legado');
const DUR = +val('--dur', '30')!;
const spec = (id: string): any => ({ ...ACESSORIOS_PADRAO, ...PRESETS.find((p) => p.id === id)!, ...(LEGADO ? MODO_LEGADO_RONCO : {}) });

type Lenta = { id: string; temp: number; ok: boolean; motivo: string; pegou: number; rpmMin: number; rpmFim: number; alvo: number; osc: number; pico: number };
function lenta(id: string, temp: number): Lenta {
  const s = spec(id), d: any = new EngineDSP(SR);
  d.params.ambSound = false;
  d.setConfig(configCalibrada(s, SR));
  d.ambientT = temp;
  d.message({ type: 'input', temp: { mode: 'real', value: temp } });
  d.message({ type: 'input', ignition: true });
  const l = new Float32Array(B), r = new Float32Array(B);
  let pegou = -1, apagou = false, nan = false, pico = 0, rpmMin = Infinity, lo = Infinity, hi = 0;
  const n = DUR * SR;
  for (let i = 0; i < n; i += B) {
    d.process(l, r, B);
    const t = i / SR;
    if (pegou < 0 && d.state === 'run') pegou = t;
    if (pegou >= 0 && d.state !== 'run') apagou = true;
    if (!Number.isFinite(l[0]) || !Number.isFinite(d.rpmAvg)) nan = true;
    for (let k = 0; k < B; k++) pico = Math.max(pico, Math.abs(l[k]), Math.abs(r[k]));
    if (pegou >= 0 && t > pegou + 4) rpmMin = Math.min(rpmMin, d.rpmAvg);
    if (t > DUR - 5) { lo = Math.min(lo, d.rpmAvg); hi = Math.max(hi, d.rpmAvg); }
  }
  const alvo = d.idleTarget || s.idle, rpmFim = d.rpmAvg;
  let motivo = '';
  if (pegou < 0 || pegou > 5) motivo = 'não pegou em 5 s';
  else if (apagou || d.state !== 'run') motivo = 'apagou';
  else if (nan) motivo = 'NaN';
  else if (pico >= 0.999) motivo = `saturou (pico ${pico.toFixed(3)})`;
  else if (Math.abs(rpmFim / alvo - 1) > 0.12) motivo = `giro final a ${(100 * (rpmFim / alvo - 1)).toFixed(0)}% do alvo`;
  return { id, temp, ok: !motivo, motivo, pegou: +pegou.toFixed(2), rpmMin: Math.round(rpmMin), rpmFim: Math.round(rpmFim), alvo: Math.round(alvo), osc: Math.round(hi - lo), pico: +pico.toFixed(3) };
}

type Corte = { id: string; tipo: string; ok: boolean; motivo: string; quique: number; rpmLo: number; rpmHi: number; redline: number; pico: number; rpm: number[] };
function corte(id: string): Corte {
  const s = spec(id), d: any = new EngineDSP(SR);
  d.params.ambSound = false;
  d.setConfig(configCalibrada(s, SR));
  d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } });
  d.message({ type: 'input', ignition: true });
  const l = new Float32Array(B), r = new Float32Array(B);
  let entradas = 0, antes = false, lo = Infinity, hi = 0, pico = 0;
  const rpm: number[] = [];
  const n = 10 * SR;
  for (let i = 0; i < n; i += B) {
    const t = i / SR;
    if (i === 4 * SR) d.message({ type: 'input', throttle: 1 });
    d.process(l, r, B);
    if (t > 6) {
      if (d.limiter && !antes) entradas++;
      lo = Math.min(lo, d.rpmAvg); hi = Math.max(hi, d.rpmAvg);
      for (let k = 0; k < B; k++) pico = Math.max(pico, Math.abs(l[k]), Math.abs(r[k]));
    }
    antes = !!d.limiter;
    if ((i / B) % 8 === 0) rpm.push(d.rpmAvg);
  }
  const tipo = s.limiter || 'ign', teto = s.redline * (tipo === 'none' ? 1.12 : 1.08);
  let motivo = '';
  if (d.state !== 'run') motivo = 'apagou';
  else if (hi > teto) motivo = `giro a ${Math.round(hi)} rpm (faixa vermelha ${s.redline})`;
  else if (hi < s.redline * 0.9) motivo = `não chegou ao corte (${Math.round(hi)} rpm)`;
  else if (pico >= 0.999) motivo = `saturou (pico ${pico.toFixed(3)})`;
  return { id, tipo, ok: !motivo, motivo, quique: +(entradas / 4).toFixed(1), rpmLo: Math.round(lo), rpmHi: Math.round(hi), redline: s.redline, pico: +pico.toFixed(3), rpm };
}

// ---- filho: roda uma lista de trabalhos e devolve JSON (um por linha)
if (a.includes('--filho')) {
  for (const t of JSON.parse(val('--filho')!)) console.log(JSON.stringify(t.k === 'lenta' ? lenta(t.id, t.temp) : corte(t.id)));
  process.exit(0);
}

const ids = val('--so') ? val('--so')!.split(',') : PRESETS.map((p) => p.id);
const CORTES = ['muscle', 'mustang', 'i4', 'flat6', 'v10f1', 'fusca', 'golfgti', 'r1'].filter((id) => !val('--so') || ids.includes(id));
const trabalhos: any[] = [];
for (const id of ids) for (const temp of [20, -5]) trabalhos.push({ k: 'lenta', id, temp });
if (!a.includes('--sem-corte')) for (const id of CORTES) trabalhos.push({ k: 'corte', id });
const J = Math.max(1, +val('--j', String(Math.max(2, Math.floor(os.cpus().length * 0.5))))!);
const tsx = path.join(RAIZ, 'node_modules', '.bin', 'tsx');
function filho(lote: any[]): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const p = spawn(tsx, ['tools/ronco-lenta.ts', ...(LEGADO ? ['--legado'] : []), '--dur', String(DUR), '--filho', JSON.stringify(lote)], { cwd: RAIZ });
    let s = '', e = '';
    p.stdout.on('data', (x) => (s += x)); p.stderr.on('data', (x) => (e += x));
    p.on('close', (c) => (c === 0 ? resolve(s.trim().split('\n').filter(Boolean).map((x) => JSON.parse(x))) : reject(new Error(e || s))));
  });
}
(async () => {
  const t0 = Date.now();
  const fila = trabalhos.map((t) => [t]);
  const res: any[] = [];
  await Promise.all(Array.from({ length: Math.min(J, fila.length) }, async () => { while (fila.length) res.push(...(await filho(fila.shift()!))); }));
  const L: Lenta[] = res.filter((x) => 'temp' in x), C: Corte[] = res.filter((x) => 'quique' in x);
  L.sort((x, y) => ids.indexOf(x.id) - ids.indexOf(y.id) || y.temp - x.temp);
  console.log(`LENTA (${LEGADO ? 'mecanismos novos no valor LEGADO' : 'padrões do produto'}): ${ids.length} veículos × 20 °C e −5 °C, ${DUR} s cada`);
  const falhasL = L.filter((x) => !x.ok);
  for (const x of falhasL) console.log(`  FALHA ${x.id} a ${x.temp} °C: ${x.motivo} (pegou ${x.pegou} s, mínimo ${x.rpmMin}, final ${x.rpmFim}, alvo ${x.alvo})`);
  const pior = [...L].sort((x, y) => Math.abs(y.rpmFim / y.alvo - 1) - Math.abs(x.rpmFim / x.alvo - 1)).slice(0, 5);
  console.log(`  ${L.length - falhasL.length}/${L.length} ok · apagamentos: ${L.filter((x) => x.motivo === 'apagou' || x.motivo.startsWith('não pegou')).length} · pico máximo ${Math.max(...L.map((x) => x.pico)).toFixed(3)} · partida mais lenta ${Math.max(...L.map((x) => x.pegou)).toFixed(2)} s`);
  console.log(`  mais longe do alvo: ${pior.map((x) => `${x.id} ${x.temp}° ${x.rpmFim}/${x.alvo}`).join(' · ')}`);
  console.log(`  maior oscilação nos últimos 5 s: ${[...L].sort((x, y) => y.osc / y.alvo - x.osc / x.alvo).slice(0, 5).map((x) => `${x.id} ${x.temp}° ±${Math.round(x.osc / 2)} rpm`).join(' · ')}`);
  if (C.length) {
    console.log('CORTE DE GIRO (quente, ponto morto, pé embaixo): preset · tipo · quique (Hz) · faixa do giro · pico');
    for (const x of C.sort((p, q) => CORTES.indexOf(p.id) - CORTES.indexOf(q.id))) console.log(`  ${x.ok ? 'ok   ' : 'FALHA'} ${x.id.padEnd(8)} ${x.tipo.padEnd(8)} ${String(x.quique).padStart(5)} Hz · ${x.rpmLo}–${x.rpmHi} rpm (faixa vermelha ${x.redline}) · pico ${x.pico}${x.motivo ? ' · ' + x.motivo : ''}`);
  }
  const falhas = falhasL.length + C.filter((x) => !x.ok).length;
  if (val('--json')) fs.writeFileSync(val('--json')!, JSON.stringify({ legado: LEGADO, lenta: L, corte: C }, null, 1));
  console.log(`${falhas ? `${falhas} FALHA(S)` : 'LENTA E CORTE OK'} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(String(e)); process.exit(1); });
