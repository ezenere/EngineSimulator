// Troca de configuração com o motor funcionando (docs/TECNICO.md → Ronco → "Troca de configuração com o motor
// funcionando"). Cada controle estrutural do painel (diâmetro do escape, ponteira, abafador, comprimento…) manda a
// configuração inteira ao DSP (o `pushConfig` das páginas, sem `fresh`); a troca não pode afundar a rotação nem abrir um
// buraco ou um estalo no som.
//
//   npx tsx tools/troca.ts <ronco|diesel|radial|rotativo> [--so trecho] [--j N] [--wav]
//   npx tsx tools/troca.ts [família…] --hash          hash do render longo sem troca nenhuma (o "regime idêntico")
//   npx tsx tools/troca.ts <família> --perfil <caso> <troca>   nível e rotação a cada 50 ms, com e sem a troca
//   (pelo npm: npm run troca:ronco -- --hash, npm run troca:ronco -- --perfil 0 2)
//
// Para cada caso (preset × condição × troca): motor quente, na lenta ou em pé parcial (no Diesel, gerador com carga;
// no Radial, manete parcial contra a hélice), alguns segundos para assentar; em t0 a configuração com um controle de
// escape mudado, como a página manda; render até t0 + 5 s. Medidas (portões):
//   · rotação: a mínima de t0 a t0 + 2 s ≥ a mínima dos 2 s de antes − 5%;
//   · buraco: RMS em janelas de 50 ms (passo de 10 ms) em volta da troca, as que começam de t0 − 40 ms a t0 + 0,5 s (o
//     cruzamento da rede é de 60 ms; um ciclo sem queima na lenta dura 0,1 a 0,2 s; depois disso o que afunda é a rotação,
//     medida à parte, e numa lenta de galope, como a dos radiais, a janela mais baixa de 2 s é sorteio). A referência é a
//     janela mais baixa do regime: a dos 4 s de antes ou, se a configuração nova for mais silenciosa, a do regime dela
//     (t0 + 3 a t0 + 5 s). Nenhuma janela mais de 3 dB abaixo da referência. (4 s: na lenta do T-6 a janela mais baixa de
//     cada 2 s vai de −55 a −58 dB sem troca nenhuma);
//   · estalo: o maior salto amostra a amostra de t0 a t0 + 2 s ≤ 2× o maior do regime (o dos 4 s de antes ou o da nova, o
//     maior).
// No Diesel roda também a troca de preset e de portador (tools/diesel-troca.ts: `fresh`, o motor volta à lenta).
// `--wav` grava cada render em referencias/_sim/troca/ (fora do git). Sai com código ≠ 0 se algum caso falhar.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EngineDSP } from '../src/engines/ronco/dsp';
import { configCalibrada as cfgRonco } from '../src/engines/ronco/config';
import { PRESETS_PAGINA as PRESETS_RONCO, ACESSORIOS_PADRAO } from '../src/engines/ronco/presets';
import { DieselDSP } from '../src/engines/diesel/dsp';
import { configCalibrada as cfgDiesel } from '../src/engines/diesel/config';
import { PRESETS as PRESETS_DIESEL, PADRAO_DIESEL } from '../src/engines/diesel/presets';
import { RadialDSP } from '../src/engines/radial/dsp';
import { configCalibrada as cfgRadial } from '../src/engines/radial/config';
import { PRESETS_RADIAL, PADRAO_RADIAL } from '../src/engines/radial/presets';
import { RotativoDSP } from '../src/engines/rotativo/dsp';
import { configCalibrada as cfgRotativo } from '../src/engines/rotativo/config';
import { PRESETS_ROTATIVO, PADRAO_ROTATIVO } from '../src/engines/rotativo/presets';
import { gravarWav } from './wav';

const SR = 48000, B = 128;
const AQUI = fileURLToPath(import.meta.url);
const RAIZ = path.resolve(path.dirname(AQUI), '..');
const PASTA = path.join(RAIZ, 'referencias', '_sim', 'troca');
const args = process.argv.slice(2);
const opcao = (nome: string) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : undefined; };

// portões
const QUEDA_RPM = 0.05, BURACO_DB = 3, SALTO_X = 2;
const ANTES = 2, ANTES_NIVEL = 4, DEPOIS = 2, BURACO: [number, number] = [-0.04, 0.5], REGIME_NOVO: [number, number] = [3, 5], JANELA = 0.05, PASSO = 0.01;

type Spec = Record<string, any>;
// `preparar`: mensagens do começo (motor quente, carga) e, por `agendar`, as que entram no meio do assentamento
type Agendar = (t: number, f: (d: any) => void) => void;
type Condicao = { nome: string; assentar: number; preparar: (d: any, spec: Spec, agendar: Agendar) => void; aposConfig?: (d: any) => void };
// `fora`: medida fora do portão (as câmaras mudam de geometria e recomeçam: o ciclo sem queima continua, ver TECNICO)
type Troca = { nome: string; muda: (s: Spec) => Spec; fora?: boolean };
type Caso = { preset: string; cond: Condicao; trocas: Troca[] };
type Familia = { novo: () => any; cfg: (s: Spec) => any; spec: (id: string) => Spec; casos: Caso[] };

const cache = new Map<string, any>();
const calibrada = (f: (s: Spec, sr: number) => any, s: Spec) => { const k = JSON.stringify(s); if (!cache.has(k)) cache.set(k, f(s, SR)); return cache.get(k); };
const quente = (d: any) => { d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } }); d.message({ type: 'input', ignition: true }); };
const pedal = (v: number) => (d: any) => d.message({ type: 'input', throttle: v });
const escape = (s: Spec, p: Spec) => ({ ...s, escape: { ...s.escape, ...p } });

// ------------------------------------------------------------------ famílias
const LENTA: Condicao = { nome: 'lenta', assentar: 10, preparar: quente };
// (em ponto morto com o pé parcial: o giro assenta onde a borboleta equilibra o atrito)
const parcial = (thr: number): Condicao => ({ nome: `pé ${Math.round(thr * 100)}%`, assentar: 8, preparar: (d, _s, agendar) => { quente(d); agendar(2, pedal(thr)); } });

const RONCO: Familia = {
  novo: () => new EngineDSP(SR),
  cfg: (s) => calibrada(cfgRonco, s),
  spec: (id) => ({ ...ACESSORIOS_PADRAO, ...PRESETS_RONCO.find((p) => p.id === id)! }),
  casos: [],
};
const trocasRonco: Troca[] = [
  { nome: 'diâmetro 2,5→2,0"', muda: (s) => ({ ...s, pipeD: (s.pipeD || 2.5) > 2.2 ? 2.0 : 2.5 }) },
  { nome: 'ponteira →1,75"', muda: (s) => ({ ...s, tipD: 1.75 }) },
  { nome: 'abafador', muda: (s) => ({ ...s, muffler: s.muffler === 'stock' ? 'sport' : 'stock' }) },
  { nome: 'comprimento +0,6 m', muda: (s) => ({ ...s, pipeLen: (s.pipeLen || 2.5) + 0.6 }) },
  { nome: 'ressonador', muda: (s) => ({ ...s, reso: !s.reso }) },
];
const CILINDRADA: Troca = { nome: 'cilindrada +10%', muda: (s) => ({ ...s, displacement: +(s.displacement * 1.1).toFixed(2) }), fora: true };
for (const id of ['mustang', 'fusca']) for (const cond of [LENTA, parcial(0.12)]) RONCO.casos.push({ preset: id, cond, trocas: trocasRonco });
RONCO.casos.push({ preset: 'supra', cond: LENTA, trocas: trocasRonco }, { preset: 'c172', cond: LENTA, trocas: trocasRonco });
RONCO.casos.push({ preset: 'mustang', cond: LENTA, trocas: [CILINDRADA] });

// Diesel: a mensagem de carga que a página manda depois de cada config (enviarCarga)
const cargaDiesel = (portador: string, c: Partial<{ notch: number; degrau: number }> = {}) => ({
  type: 'diesel', portador, notch: c.notch ?? 0, degrau: c.degrau ?? 0, cargaBancada: 0, rpmAlvo: 0, freioMotor: false, jakeCilindros: 6, manual: 0,
  dinamico: false, lentaBaixa: false, fRede: 60,
});
const condDiesel = (nome: string, portador: string, c: Partial<{ notch: number; degrau: number }>, thr = 0, assentar = 10): Condicao => ({
  nome, assentar,
  preparar: (d, _s, agendar) => { d.message(cargaDiesel(portador)); quente(d); agendar(2, (x) => { x.message(cargaDiesel(portador, c)); if (thr) pedal(thr)(x); }); },
  aposConfig: (d) => d.message(cargaDiesel(portador, c)),
});
const DIESEL: Familia = {
  novo: () => new DieselDSP(SR),
  cfg: (s) => calibrada(cfgDiesel, s),
  spec: (id) => ({ ...PADRAO_DIESEL, ...PRESETS_DIESEL.find((p) => p.id === id)! }),
  casos: [],
};
const trocasDiesel: Troca[] = [
  { nome: 'diâmetro', muda: (s) => { const dm = s.escape.diametro || 2.5; return { ...escape(s, { diametro: dm > 3 ? dm - 1 : dm + 0.5 }), ponteira: s.ponteira ?? dm }; } },
  { nome: 'ponteira', muda: (s) => ({ ...s, ponteira: Math.max(1.5, (s.ponteira ?? s.escape.diametro ?? 2.5) - 0.75) }) },
  { nome: 'abafador', muda: (s) => escape(s, { abafador: s.escape.abafador === 'stock' ? 'sport' : 'stock' }) },
  { nome: 'comprimento +0,6 m', muda: (s) => escape(s, { comprimento: (s.escape.comprimento || 3) + 0.6 }) },
];
DIESEL.casos.push(
  { preset: 'hilux28', cond: condDiesel('lenta', 'carro', {}), trocas: trocasDiesel },
  { preset: 'hilux28', cond: condDiesel('pé 30%', 'carro', {}, 0.3), trocas: trocasDiesel },
  { preset: 'scaniav8', cond: condDiesel('lenta', 'carro', {}), trocas: trocasDiesel },
  { preset: 'gen500', cond: condDiesel('gerador 50%', 'gerador', { degrau: 0.5 }, 0, 12), trocas: trocasDiesel },
  { preset: 'hilux28', cond: condDiesel('lenta', 'carro', {}), trocas: [{ nome: 'taxa de compressão +1', muda: (s) => ({ ...s, cr: s.cr + 1 }), fora: true }] },
);

// Radial: motor quente já funcionando (a partida de um radial é um procedimento; tools/radial-comum.ts, `quente`)
const radialQuente = (d: any, spec: Spec) => {
  d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } });
  d.coolant = 90; d.ambientT = 20; d.state = 'run'; d.ignition = true; d.runT = 120; d.fase = 'pegou';
  d.omega = (spec.idle * 2 * Math.PI) / 60; d.rpmAvg = spec.idle; d.exhT = 320; d.warm = 1;
};
const RADIAL: Familia = {
  novo: () => new RadialDSP(SR),
  cfg: (s) => calibrada(cfgRadial, s),
  spec: (id) => ({ ...PADRAO_RADIAL, ...PRESETS_RADIAL.find((p) => p.id === id)! }),
  casos: [],
};
const trocasRadial: Troca[] = [
  { nome: 'Ø do anel', muda: (s) => escape(s, { Oanel: (s.escape.Oanel ?? 80) + 15 }) },
  { nome: 'Ø da saída', muda: (s) => escape(s, { saidas: s.escape.saidas.map((x: Spec) => ({ ...x, O: x.O - 15 })) }) },
  { nome: 'vedação', muda: (s) => ({ ...s, breakout: s.breakout === 'sealed' ? 'old' : 'sealed' }) },
  { nome: 'diâmetro do anel +0,2 m', muda: (s) => escape(s, { Danel: (s.escape.Danel ?? 1.1) + 0.2 }) },
  { nome: 'sopro +3 dB', muda: (s) => ({ ...s, sopro: (s.sopro || 0) + 3 }) },
];
for (const id of ['r1340', 'r1830']) {
  RADIAL.casos.push({ preset: id, cond: { nome: 'lenta', assentar: 16, preparar: radialQuente }, trocas: trocasRadial });
  RADIAL.casos.push({ preset: id, cond: { nome: 'manete 40%', assentar: 14, preparar: (d, s, agendar) => { radialQuente(d, s); agendar(1, pedal(0.4)); } }, trocas: trocasRadial });
}
RADIAL.casos.push({ preset: 'r1340', cond: { nome: 'lenta', assentar: 16, preparar: radialQuente }, trocas: [{ nome: 'taxa de compressão +0,5', muda: (s) => ({ ...s, cr: s.cr + 0.5 }), fora: true }] });

const ROTATIVO: Familia = {
  novo: () => new RotativoDSP(SR),
  cfg: (s) => calibrada(cfgRotativo, s),
  spec: (id) => ({ ...PADRAO_ROTATIVO, ...PRESETS_ROTATIVO.find((p) => p.id === id)! }),
  casos: [],
};
const trocasRotativo: Troca[] = [
  { nome: 'Ø do primário', muda: (s) => escape(s, { Dp: (s.escape.Dp ?? 50) + 8 }) },
  { nome: 'ponteira', muda: (s) => escape(s, { ponteira: 40 }) },
  { nome: 'abafador', muda: (s) => ({ ...s, muffler: s.muffler === 'sport' ? 'stock' : 'sport' }) },
  { nome: 'pré-silencioso', muda: (s) => escape(s, { presilencioso: !s.escape.presilencioso }) },
];
for (const id of ['rx7fc', 'rx8hp']) for (const cond of [LENTA, parcial(0.12)]) ROTATIVO.casos.push({ preset: id, cond, trocas: trocasRotativo });

const FAMILIAS: Record<string, Familia> = { ronco: RONCO, diesel: DIESEL, radial: RADIAL, rotativo: ROTATIVO };

// ------------------------------------------------------------------ render e medidas
type Medida = {
  familia: string; preset: string; cond: string; troca: string;
  rpmAntes: number; rpmDepois: number; rpmRegime: number;
  nivelAntes: number; nivelNova: number; refAntes: number; refNova: number; minDepois: number; tMin: number;
  saltoAntes: number; saltoNova: number; saltoDepois: number; tSalto: number;
  estado: string; nan: number; falhas: string[]; fora?: boolean;
};

function renderizar(fam: Familia, spec: Spec, cond: Condicao, t0: number, troca: Spec | null, dur: number) {
  const d = fam.novo();
  d.message({ type: 'params', params: { listener: 'ext', ambSound: false, master: 0.8 } });
  d.message({ type: 'config', cfg: { ...fam.cfg(spec) } });
  const ev: [number, (d: any) => void][] = [], agendar: Agendar = (t, f) => { ev.push([t, f]); };
  cond.preparar(d, spec, agendar);
  if (troca) agendar(t0, (x) => { x.message({ type: 'config', cfg: { ...fam.cfg(troca) } }); cond.aposConfig?.(x); });
  ev.sort((a, b) => a[0] - b[0]);
  const n = Math.round(dur * SR), L = new Float32Array(n), R = new Float32Array(n), rpm = new Float32Array(Math.ceil(n / B));
  const bl = new Float32Array(B), br = new Float32Array(B);
  let ei = 0;
  for (let pos = 0, k = 0; pos < n; pos += B, k++) {
    const t = pos / SR;
    while (ei < ev.length && ev[ei][0] <= t) ev[ei++][1](d);
    const m = Math.min(B, n - pos);
    d.process(bl, br, m);
    L.set(bl.subarray(0, m), pos); R.set(br.subarray(0, m), pos);
    rpm[k] = d.rpmAvg;
  }
  return { L, R, rpm, estado: d.state };
}

/** RMS (dB) em janelas de 50 ms com passo de 10 ms que começam em [a, b) s */
function janelas(L: Float32Array, R: Float32Array, a: number, b: number) {
  const w = Math.round(JANELA * SR), h = Math.round(PASSO * SR), out: { t: number; db: number }[] = [];
  for (let i = Math.round(a * SR); i + w <= Math.min(L.length, Math.round(b * SR) + w); i += h) {
    let e = 0; for (let k = i; k < i + w; k++) e += L[k] * L[k] + R[k] * R[k];
    out.push({ t: i / SR, db: 10 * Math.log10(e / (2 * w) + 1e-20) });
  }
  return out;
}
function salto(L: Float32Array, R: Float32Array, a: number, b: number) {
  let mx = 0, t = a;
  for (let i = Math.max(1, Math.round(a * SR)); i < Math.min(L.length, Math.round(b * SR)); i++) {
    const s = Math.max(Math.abs(L[i] - L[i - 1]), Math.abs(R[i] - R[i - 1]));
    if (s > mx) { mx = s; t = i / SR; }
  }
  return { mx, t };
}
const minRpm = (rpm: Float32Array, a: number, b: number) => { let m = Infinity; for (let k = Math.round((a * SR) / B); k < Math.min(rpm.length, Math.round((b * SR) / B)); k++) m = Math.min(m, rpm[k]); return m; };
const mediaRpm = (rpm: Float32Array, a: number, b: number) => { let s = 0, c = 0; for (let k = Math.round((a * SR) / B); k < Math.min(rpm.length, Math.round((b * SR) / B)); k++) { s += rpm[k]; c++; } return s / Math.max(1, c); };

function medir(nomeFam: string, caso: Caso, troca: Troca, wav: boolean): Medida {
  const fam = FAMILIAS[nomeFam], spec = fam.spec(caso.preset), t0 = caso.cond.assentar;
  const { L, R, rpm, estado } = renderizar(fam, spec, caso.cond, t0, troca.muda(spec), t0 + REGIME_NOVO[1]);
  let nan = 0; for (let i = 0; i < L.length; i++) if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) nan++;
  if (wav) { fs.mkdirSync(PASTA, { recursive: true }); gravarWav(path.join(PASTA, `${nomeFam}-${caso.preset}-${caso.cond.nome}-${troca.nome}.wav`.replace(/[^\w.,+→-]+/g, '_')), L, R, SR); }
  const jA = janelas(L, R, t0 - ANTES_NIVEL, t0 - JANELA), jD = janelas(L, R, t0 + BURACO[0], t0 + BURACO[1]), jN = janelas(L, R, t0 + REGIME_NOVO[0], t0 + REGIME_NOVO[1] - JANELA);
  const min = (j: { t: number; db: number }[]) => j.reduce((m, x) => (x.db < m.db ? x : m), { t: 0, db: Infinity });
  const pot = (j: { db: number }[]) => 10 * Math.log10(j.reduce((s, x) => s + 10 ** (x.db / 10), 0) / Math.max(1, j.length));
  const sA = salto(L, R, t0 - ANTES_NIVEL, t0), sD = salto(L, R, t0, t0 + DEPOIS), sN = salto(L, R, t0 + REGIME_NOVO[0], t0 + REGIME_NOVO[1]);
  const m: Medida = {
    familia: nomeFam, preset: caso.preset, cond: caso.cond.nome, troca: troca.nome,
    rpmAntes: minRpm(rpm, t0 - ANTES, t0), rpmDepois: minRpm(rpm, t0, t0 + DEPOIS), rpmRegime: mediaRpm(rpm, t0 - ANTES, t0),
    nivelAntes: pot(jA), nivelNova: pot(jN), refAntes: min(jA).db, refNova: min(jN).db, minDepois: min(jD).db, tMin: min(jD).t - t0,
    saltoAntes: sA.mx, saltoNova: sN.mx, saltoDepois: sD.mx, tSalto: sD.t - t0, estado, nan, falhas: [],
  };
  const ref = Math.min(m.refAntes, m.refNova), sRef = Math.max(m.saltoAntes, m.saltoNova);
  m.fora = !!troca.fora;
  if (estado !== 'run') m.falhas.push(`motor ${estado} depois da troca`);
  if (nan) m.falhas.push(`${nan} amostras NaN`);
  if (m.rpmDepois < m.rpmAntes * (1 - QUEDA_RPM)) m.falhas.push(`rotação caiu a ${m.rpmDepois.toFixed(0)} rpm (antes ${m.rpmAntes.toFixed(0)}; mínimo aceito ${(m.rpmAntes * (1 - QUEDA_RPM)).toFixed(0)})`);
  if (m.minDepois < ref - BURACO_DB) m.falhas.push(`buraco de ${(m.minDepois - ref).toFixed(1)} dB a ${(m.tMin * 1000).toFixed(0)} ms (limite −${BURACO_DB} dB)`);
  if (m.saltoDepois > SALTO_X * sRef) m.falhas.push(`estalo: salto ${(m.saltoDepois / sRef).toFixed(2)}× o do regime a ${(m.tSalto * 1000).toFixed(0)} ms (limite ${SALTO_X}×)`);
  return m;
}

// ------------------------------------------------------------------ hash do regime (render longo, sem troca nenhuma)
const REGIMES: Record<string, { preset: string; ev: [number, (d: any) => void][]; dur: number; preparar?: (d: any, s: Spec) => void }> = {
  ronco: { preset: 'mustang', ev: [[0, quente], [5, pedal(0.6)], [6, pedal(0)], [9, pedal(0.15)], [12, pedal(0)]], dur: 15 },
  diesel: { preset: 'hilux28', ev: [[0, (d) => { d.message(cargaDiesel('carro')); quente(d); }], [5, pedal(0.6)], [6.5, pedal(0)], [9, pedal(0.3)], [12, pedal(0)]], dur: 15 },
  radial: { preset: 'r1340', ev: [[1, pedal(0.4)], [7, pedal(0.8)], [10, pedal(0)]], dur: 15, preparar: radialQuente },
  rotativo: { preset: 'rx7fc', ev: [[0, quente], [5, pedal(0.6)], [6, pedal(0)], [9, pedal(0.15)], [12, pedal(0)]], dur: 15 },
};
function hashRegime(nomeFam: string) {
  const fam = FAMILIAS[nomeFam], r = REGIMES[nomeFam], spec = fam.spec(r.preset);
  const d = fam.novo();
  d.message({ type: 'params', params: { listener: 'ext', master: 0.8 } });
  d.message({ type: 'config', cfg: { ...fam.cfg(spec) } });
  r.preparar?.(d, spec);
  const n = Math.round(r.dur * SR), bl = new Float32Array(B), br = new Float32Array(B), h = crypto.createHash('sha256');
  let ei = 0;
  for (let pos = 0; pos < n; pos += B) {
    while (ei < r.ev.length && r.ev[ei][0] <= pos / SR) r.ev[ei++][1](d);
    d.process(bl, br, B);
    h.update(Buffer.from(bl.buffer)); h.update(Buffer.from(br.buffer));
  }
  return `${nomeFam} ${r.preset} ${r.dur} s: ${h.digest('hex')}`;
}

// ------------------------------------------------------------------ execução
const dB = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;
function linha(m: Medida) {
  const ref = Math.min(m.refAntes, m.refNova), sRef = Math.max(m.saltoAntes, m.saltoNova);
  return `| ${m.preset} ${m.cond} · ${m.troca} | ${m.rpmRegime.toFixed(0)} | ${m.rpmAntes.toFixed(0)} → ${m.rpmDepois.toFixed(0)} (${dB((100 * (m.rpmDepois - m.rpmAntes)) / m.rpmAntes)}%) | ` +
    `${dB(m.nivelNova - m.nivelAntes)} | ${dB(m.minDepois - ref)} a ${(m.tMin * 1000).toFixed(0)} ms | ${(m.saltoDepois / sRef).toFixed(2)}× | ${m.fora ? `fora do portão${m.falhas.length ? ` (${m.falhas.length} acima)` : ''}` : m.falhas.length ? 'FALHA' : 'ok'} |`;
}

if (args[0] === '--trabalhador') {
  // filho: um caso (família, índice do caso, índice da troca) → JSON
  const [, fam, ic, it, w] = args;
  const c = FAMILIAS[fam].casos[+ic];
  process.stdout.write(JSON.stringify(medir(fam, c, c.trocas[+it], w === '1')) + '\n');
} else if (args.includes('--hash')) {
  const fams = args.filter((a) => FAMILIAS[a]);
  for (const f of fams.length ? fams : Object.keys(FAMILIAS)) console.log(hashRegime(f));
} else if (args.includes('--perfil')) {
  // um caso, a cada 50 ms: nível e rotação com a troca, e o mesmo render já com a configuração nova desde o começo
  const fam = args.find((a) => FAMILIAS[a])!, i = args.indexOf('--perfil'), ic = args[i + 1], it = args[i + 2];
  const c = FAMILIAS[fam].casos[+ic], t = c.trocas[+it], f = FAMILIAS[fam], s = f.spec(c.preset), t0 = c.cond.assentar, dur = t0 + REGIME_NOVO[1];
  const a = renderizar(f, s, c.cond, t0, t.muda(s), dur), b = renderizar(f, t.muda(s), c.cond, t0, null, dur);
  console.log(`${c.preset} ${c.cond.nome} · ${t.nome} (t0 = ${t0} s)\n   t (s) | com a troca: dB · rpm | só a nova: dB · rpm`);
  const ja = janelas(a.L, a.R, t0 - 4, dur - JANELA), jb = janelas(b.L, b.R, t0 - 4, dur - JANELA);
  for (let i = 0; i < ja.length; i += 5) {
    const k = Math.round((ja[i].t * SR) / B);
    console.log(`${(ja[i].t - t0).toFixed(2).padStart(8)} | ${ja[i].db.toFixed(1).padStart(6)} · ${a.rpm[k].toFixed(0).padStart(5)} | ${jb[i].db.toFixed(1).padStart(6)} · ${b.rpm[k].toFixed(0).padStart(5)}`);
  }
} else {
  const fam = args[0];
  if (!FAMILIAS[fam]) { console.error('uso: tools/troca.ts <ronco|diesel|radial|rotativo> [--so trecho] [--j N] [--wav] | [família…] --hash | <família> --perfil <caso> <troca>'); process.exit(2); }
  const so = opcao('--so'), wav = args.includes('--wav');
  const J = Math.max(1, +(opcao('--j') || Math.min(12, Math.max(2, Math.floor(os.cpus().length * 0.5)))));
  const tarefas: [number, number][] = [];
  FAMILIAS[fam].casos.forEach((c, ic) => c.trocas.forEach((t, it) => { if (!so || `${c.preset} ${c.cond.nome} ${t.nome}`.includes(so)) tarefas.push([ic, it]); }));
  const tsx = path.join(RAIZ, 'node_modules', '.bin', 'tsx');
  const filho = (ic: number, it: number) => new Promise<Medida>((ok, erro) => {
    const p = spawn(tsx, [AQUI, '--trabalhador', fam, String(ic), String(it), wav ? '1' : '0'], { cwd: RAIZ });
    let s = '', e = ''; p.stdout.on('data', (x) => (s += x)); p.stderr.on('data', (x) => (e += x));
    p.on('close', (cod) => { try { ok(JSON.parse(s.trim().split('\n').pop()!)); } catch { erro(new Error(`caso ${ic}/${it} (código ${cod}): ${e.slice(-600)}`)); } });
  });
  (async () => {
    const t0 = Date.now(), fila = [...tarefas], res: Medida[] = [];
    await Promise.all(Array.from({ length: J }, async () => { while (fila.length) { const [ic, it] = fila.shift()!; res.push(await filho(ic, it)); } }));
    const ordem = (m: Medida) => tarefas.findIndex(([ic, it]) => { const c = FAMILIAS[fam].casos[ic]; return c.preset === m.preset && c.cond.nome === m.cond && c.trocas[it].nome === m.troca; });
    res.sort((a, b) => ordem(a) - ordem(b));
    console.log(`Troca de configuração com o motor funcionando: ${fam} (portões: rotação mínima ≥ antes − ${QUEDA_RPM * 100}%, janela de 50 ms ≥ regime − ${BURACO_DB} dB, salto ≤ ${SALTO_X}× o do regime)\n`);
    console.log('| caso | rpm (regime) | rpm mínima: 2 s antes → 2 s depois | nível médio da nova − antes (dB) | pior janela de 50 ms em volta da troca − a mais baixa do regime (dB) | maior salto / regime | |\n|---|---|---|---|---|---|---|');
    for (const m of res) console.log(linha(m));
    const ruins = res.filter((m) => m.falhas.length && !m.fora);
    for (const m of ruins) console.log(`FALHA ${m.preset} ${m.cond} · ${m.troca}: ${m.falhas.join(' · ')}`);
    for (const m of res.filter((x) => x.fora && x.falhas.length)) console.log(`(fora do portão) ${m.preset} ${m.cond} · ${m.troca}: ${m.falhas.join(' · ')}`);
    let falhasPreset = 0;
    if (fam === 'diesel' && !so) {
      // troca de preset e de portador (a página manda `fresh`: o motor recomeça do zero e volta à lenta do novo preset)
      const { trocaDePresetDiesel } = await import('./diesel-troca');
      console.log('');
      falhasPreset = trocaDePresetDiesel();
    }
    const nf = res.filter((m) => m.fora).length;
    console.log(`\n${res.length - nf} trocas de configuração${nf ? ` (e ${nf} fora do portão)` : ''} em ${((Date.now() - t0) / 1000).toFixed(0)} s: ${res.length - nf - ruins.length} ok, ${ruins.length} falhas${fam === 'diesel' && !so ? `; troca de preset: ${falhasPreset} falha(s)` : ''}`);
    if (!ruins.length && !falhasPreset) console.log('TROCA OK');
    process.exit(ruins.length || falhasPreset ? 1 : 0);
  })().catch((e) => { console.error(e); process.exit(2); });
}
