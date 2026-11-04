// Referências do legado para a tabela "não pode piorar" (CENA.md 2.11 e passo 12): renderiza o DSP de
// `master` (git show master:src/dsp.js, master:src/jet-dsp.js e os presets/geometria de lá), mede e grava
// em tools/cena/referencias/legado.json. `compararLegado()` refaz as medidas e confere que o JSON é
// reproduzido (o DSP legado é determinístico), e compara com o que a Cena nova já sabe fazer.
//
//   npx tsx tools/cena/legado.ts gravar     regrava o JSON
//   npx tsx tools/cena/valida.ts legado     confere
//
// Cenários (os harnesses de tools/render.ts não têm esses três; o laço é o mesmo: eventos no início
// de cada bloco de 128 amostras):
//   carro: Camaro SS (`muscle`), ouvinte `road` a 6 m, ambiente `open` (volta de 800 m), giro travado em
//          3000 rpm (ignição de V8 a 200 Hz), ponto morto, v forçada em 30 m/s a cada bloco, carX de −180 m
//   avião: 737-800 (`narrow`), `flyby` a 1500 m, 300 km/h, manete 0,85 (como o flyby do render.ts, mas alto)
//   estrondo: F-16 (`fighter`), `flyby` a 200 m, Mach 1,5 (1836 km/h), flyX de −1500 m
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as A from './analise';
import { corteAr, POLO_POR_CORTE } from '../../src/scene/ar';
import { mag2Polo, k1 } from '../../src/scene/filtros';
import type { Linha } from './medidas';
import { raizesEmissao, parametrosEstrondo } from '../../src/scene/supersonico';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '../..');
const ARQ = path.join(AQUI, 'referencias', 'legado.json');
const req = createRequire(import.meta.url);
const SR = 48000, B = 128;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** extrai os arquivos legados de master para uma pasta temporária e carrega */
function carregarMaster() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-legado-'));
  for (const f of ['dsp.js', 'jet-dsp.js', 'presets.js', 'jet-presets.js', 'geometry.js']) {
    const txt = execFileSync('git', ['show', `master:src/${f}`], { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 << 20 });
    fs.writeFileSync(path.join(dir, f), txt);
  }
  const L = (f: string) => req(path.join(dir, f));
  const commit = execFileSync('git', ['rev-parse', '--short', 'master'], { cwd: RAIZ, encoding: 'utf8' }).trim();
  return { EngineDSP: L('dsp.js')().EngineDSP, JetDSP: L('jet-dsp.js')().JetDSP, PRESETS: L('presets.js'), JPRESETS: L('jet-presets.js'), G: L('geometry.js'), commit };
}

const STOCK = { valve: 'none', pipeD: 2.5, reso: false, twoStep: 'off', launchRpm: undefined, fuel: 'efi', shiftTime: undefined, driveMode: 'auto', limiter: 'ign', limiterBand: 70, limiterHold: 0.07, power: undefined, mass: undefined, wheelR: undefined, drag: undefined, ratios: undefined, finalDrive: undefined, overrun: 'cut', cat: true, tipD: undefined, cooling: 'water', engine: undefined, breakout: 'sealed', compression: undefined, scType: undefined, scRatio: undefined, scLobes: undefined, scWhine: undefined };
function engineConfig(G: any, spec: any) {
  const e = G.build(spec);
  const cfg = { ...spec, N: e.N, fire: e.fire, bank: e.bank, banks: e.banks, axis: e.axis, z: e.z, tdcRel: e.tdcRel, runners: e.runners };
  if (cfg.banks === 1 && (cfg.routing === 'xpipe' || cfg.routing === 'hpipe')) cfg.routing = 'dual';
  return cfg;
}

function rodar(d: any, T: number, antes?: (t: number) => void, depois?: (t: number) => void) {
  const n = Math.round(T * SR), L = new Float32Array(n), R = new Float32Array(n), bl = new Float32Array(B), br = new Float32Array(B);
  for (let i = 0; i < n; i += B) { const t = i / SR; antes?.(t); d.process(bl, br, B); L.set(bl.subarray(0, Math.min(B, n - i)), i); R.set(br.subarray(0, Math.min(B, n - i)), i); depois?.(t); }
  return { L, R };
}

const FAIXAS = A.FAIXAS_PROJETO;

export function medirLegado() {
  const M = carregarMaster();
  // ------------------------------------------------------------ carro na rua a 6 m
  const carro = (() => {
    const spec = { ...STOCK, ...M.PRESETS.find((p: any) => p.id === 'muscle') };
    const d = new M.EngineDSP(SR);
    d.params.listener = 'road'; d.params.env = 'open'; d.params.roadDist = 6;
    d.setConfig(engineConfig(M.G, spec));
    d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } }); d.message({ type: 'input', ignition: true });
    const w = (3000 * 2 * Math.PI) / 60;
    d.state = 'run'; d.lockOmega = true; d.omega = w; d.rpmAvg = 3000; d.thrTarget = 0.5; d.thr = 0.5;
    d.carX = -180;
    const xs: number[] = [];
    const { L, R } = rodar(d, 12, () => { d.v = 30; d.omega = w; }, () => xs.push(d.carX));
    // instante (recepção) em que o carro está em x: t_e + r/c
    const tEm = (x: number) => { const i = xs.findIndex((v) => v >= x); return (i * B) / SR + Math.hypot(x, 6, 1.25) / 343; };
    const m = Float32Array.from(L, (v, i) => 0.5 * (v + R[i]));
    const fa = A.picoEm(m, SR, tEm(-90), 0.25, 170, 250), fi = A.picoEm(m, SR, tEm(90), 0.25, 160, 230);
    const t0 = tEm(0);
    const ban = A.balanco([L, R], SR, Math.round((t0 - 0.25) * SR), Math.round((t0 + 0.25) * SR)).rel.map(r3);
    const lf = A.nivelF(L, R, SR, 1, false, 480);
    const curva: [number, number][] = [];
    for (let k = 4; k * 0.25 < 11.9; k++) { const t = k * 0.25, i = Math.min(xs.length - 1, Math.round((t * SR) / B)); curva.push([r3(xs[i]), r3(lf[Math.round(t * 100)])]); }
    // espectro em 1/3 de oitava de 400 Hz a 2,5 kHz no instante abeam (região do nulo do solo)
    const terc = [400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500];
    const e = A.bandas([L, R], SR, Math.round((t0 - 0.25) * SR), Math.round((t0 + 0.25) * SR), terc.map((f) => [f / 1.122, f * 1.122] as const));
    const ref = e[0];
    return { cenario: 'muscle, road 6 m, open, 3000 rpm travado, ponto morto, v = 30 m/s, carX −180 → +180 (curva de nível a partir de 1 s)', dopplerChegando: r3(fa), dopplerIndo: r3(fi), teoria: [r3(200 / (1 - 30 / 343)), r3(200 / (1 + 30 / 343))],
      bandasAbeam: { faixas: FAIXAS, relDb: ban }, curvaNivelX: curva, terciosAbeam: { f: terc, relDb: e.map((v) => r3(10 * Math.log10(v / ref))) } };
  })();
  // ------------------------------------------------------------ avião a 1500 m
  const aviao = (() => {
    const spec = M.JPRESETS.find((p: any) => p.id === 'narrow');
    const d = new M.JetDSP(SR); d.params.listener = 'ground'; d.params.angle = 90; d.params.dist = 40;
    d.setConfig(spec);
    d.state = 'run'; d.lit = true; d.n2 = spec.n2Idle; d.u = 0; d.lightT = 10; d.params.listener = 'flyby'; d.params.alt = 1500; d.params.speed = 300; d.message({ type: 'input', tla: 0.85 });
    const fx: number[] = [];
    const { L, R } = rodar(d, 48, undefined, () => fx.push(d.flyX));
    const v = 300 / 3.6;
    const iA = fx.findIndex((x) => x >= 0);
    const tCima = (iA * B) / SR + 1500 / 340;
    const janela = (t: number) => A.balanco([L, R], SR, Math.round((t - 1) * SR), Math.round((t + 1) * SR)).rel.map(r3);
    const oit = (t: number, f: number) => A.bandas([L, R], SR, Math.round((t - 1) * SR), Math.round((t + 1) * SR), [[f / 1.414, f * 1.414]])[0];
    const abs = 10 * Math.log10(oit(tCima, 4000) / oit(tCima, 500));
    return { cenario: 'narrow (737-800), flyby 1500 m, 300 km/h, manete 0,85', tCima: r3(tCima), bandasCima: { faixas: FAIXAS, relDb: janela(tCima) }, bandas10sAntes: { faixas: FAIXAS, relDb: janela(tCima - 10) }, oitava4kRel500: r3(abs), v };
  })();
  // ------------------------------------------------------------ estrondo
  const estrondo = (() => {
    const spec = M.JPRESETS.find((p: any) => p.id === 'fighter');
    const d = new M.JetDSP(SR); d.params.listener = 'ground'; d.setConfig(spec);
    const M_ = 1.5, v = M_ * 340;
    d.state = 'run'; d.lit = true; d.n2 = spec.n2Idle; d.u = 0; d.lightT = 10; d.params.listener = 'flyby'; d.params.alt = 200; d.params.speed = v * 3.6; d.message({ type: 'input', tla: 1 });
    d.flyX = -1500;
    let tCone = NaN, dp = NaN, T = NaN;
    rodar(d, 6, undefined, (t) => { if (Number.isNaN(tCone) && d.inCone) { tCone = t + B / SR; dp = d.boomDp; T = d.boomDur; } });
    // teoria: o cone chega quando A = √(Q·(M² − 1)), A = flyX + bx (barramento da frente: x médio + 1,5)
    let bx = 0; for (let e = 0; e < d.E; e++) bx += d.ex[e]; bx = bx / d.E + 1.5;
    const Q = (200 - 1.7) ** 2;
    const tTeo = (1500 + Math.sqrt(Q * (M_ * M_ - 1)) - bx) / v;
    return { cenario: 'fighter (F-16), flyby 200 m, Mach 1,5, flyX −1500 m', tCone: r3(tCone), tTeoria: r3(tTeo), dpPa: r3(dp), duracaoS: r3(T), bx: r3(bx), comprimento: spec.length, forma: spec.shape };
  })();
  return { geradoEm: 'master@' + M.commit, carro, aviao, estrondo };
}

export function gravarLegado() {
  const ref = medirLegado();
  fs.mkdirSync(path.dirname(ARQ), { recursive: true });
  fs.writeFileSync(ARQ, JSON.stringify(ref, null, 1) + '\n');
  return ref;
}

/** confere o JSON guardado e compara com a Cena nova onde ela já cobre o caso */
export function compararLegado(): Linha[] {
  const out: Linha[] = [];
  if (!fs.existsSync(ARQ)) return [{ passo: '12', nome: 'referências do legado', alvo: 'tools/cena/referencias/legado.json', medido: 'não existe (rode `npx tsx tools/cena/legado.ts gravar`)', ok: false }];
  const guardado = JSON.parse(fs.readFileSync(ARQ, 'utf8'));
  const agora = medirLegado();
  const igual = JSON.stringify({ ...agora, geradoEm: '' }) === JSON.stringify({ ...guardado, geradoEm: '' });
  out.push({ passo: '12', nome: 'referências do legado reproduzidas (JSON idêntico)', alvo: 'idêntico', medido: igual ? `idêntico (${guardado.geradoEm})` : 'DIFERENTE', ok: igual });
  const c = guardado.carro;
  out.push({ passo: '2.11', nome: 'legado: carro a 6 m, Doppler da ignição de 200 Hz', alvo: 'registro (216/183 Hz no TECNICO.md)', medido: `${c.dopplerChegando} / ${c.dopplerIndo} Hz (teoria ${c.teoria.join(' / ')})`, ok: true });
  const a = guardado.aviao;
  out.push({ passo: '2.11', nome: 'legado: avião a 1500 m, 4 kHz rel. 500 Hz no ponto mais próximo', alvo: '≤ −20 dB', medido: `${a.oitava4kRel500} dB`, ok: a.oitava4kRel500 <= -20 });
  const e = guardado.estrondo;
  out.push({ passo: '2.11', nome: 'legado: instante do cone (M 1,5, 200 m)', alvo: '3,37 s (teoria 3,38)', medido: `${e.tCone} s (teoria ${e.tTeoria} s), Δp ${e.dpPa} Pa, T ${e.duracaoS} s`, ok: Math.abs(e.tCone - 3.37) <= 0.01 });
  // Cena nova: absorção do ar a 1500 m (os dois polos), contra o critério do legado
  const fs_ = 48000, kp = k1(fs_, Math.min(0.45 * fs_, corteAr(1500) * POLO_POR_CORTE));
  const at = (f: number) => -20 * Math.log10(mag2Polo(fs_, kp, f));   // dois polos: 2 × 10·log
  const dCena = -(at(4000) - at(500));
  out.push({ passo: '5 #4', nome: 'Cena nova: ar a 1500 m, 4 kHz rel. 500 Hz (só a absorção)', alvo: '≤ −20 dB (critério do legado)', medido: `${dCena.toFixed(1)} dB`, ok: dCena <= -20 });
  // resolvedor supersônico da Cena (cópia do legado): instante do cone com os mesmos tiques de 64 amostras
  {
    const v = 1.5 * 340, Q = (200 - 1.7) ** 2, raiz = new Float64Array(2);
    let tCone = NaN;
    for (let j = 0; j < 10000; j++) {
      const flyX = -1500 + (v * (j + 1) * 64) / 48000;
      if (raizesEmissao(flyX + e.bx, v, Q, raiz).cone) { tCone = ((Math.floor(j / 2) + 1) * 128) / 48000; break; }
    }
    const pe = parametrosEstrondo(1.5, 200, e.comprimento, e.forma);
    out.push({ passo: '5 #4', nome: 'Cena nova (supersonico.ts): instante do cone, Δp e T de Carlson', alvo: `${e.tCone} s ± 1 ms; Δp e T idênticos`, medido: `${tCone.toFixed(4)} s; Δp ${pe.dp.toFixed(3)} Pa, T ${pe.T.toFixed(3)} s`, ok: Math.abs(tCone - e.tCone) <= 0.001 && Math.abs(pe.dp - e.dpPa) < 0.001 && Math.abs(pe.T - e.duracaoS) < 0.001 });
  }
  out.push({ passo: '5 #4', nome: 'Cena nova: bandas do avião a 1500 m (±2 dB) e do carro a 6 m (±1,5 dB) pela Cena', alvo: '±2 / ±1,5 dB por banda', medido: 'TODO: precisa dos adaptadores do Ronco e da Turbina (fontes separadas)', ok: false, desvio: 'Depende das migrações do Ronco e da Turbina (outras frentes): sem as fontes do EngineDSP/JetDSP separadas não há o que propagar. As referências estão gravadas no JSON para a comparação quando a Cena assumir esses casos.' });
  return out;
}

const ehCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (ehCli) {
  if (process.argv[2] === 'gravar') { const r = gravarLegado(); console.log(JSON.stringify(r, null, 1)); }
  else for (const l of compararLegado()) console.log(`${l.ok ? 'ok  ' : 'FALHA'} ${l.nome}: ${l.medido}`);
}
