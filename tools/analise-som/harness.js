// Banco de testes offline: monta um preset como a página faz (geometria + calibração) e renderiza cenários.
// Carrega o DSP em TypeScript (src/engines/ronco/), o mesmo do site: o `tsx` (dependência de desenvolvimento do
// projeto, `npm install`) compila os .ts na hora, então `node render.js …` e `node regressao.js` continuam valendo.
// `use(arquivo)` troca o DSP, para comparar duas versões:
//   · 'legado'        o src/dsp.js de antes da reestruturação, lido do histórico do repositório (REF_LEGADO em
//                     tools/legado.ts);
//   · um arquivo .js  fábrica CommonJS como a do legado (uma cópia antiga de src/dsp.js guardada num arquivo);
//   · um arquivo .ts  módulo que exporta EngineDSP. Uma versão antiga do DSP em TypeScript importa `../../acoustics`,
//                     então precisa estar numa árvore completa (uma segunda cópia de trabalho do repositório naquele
//                     commit): DSP=../engine-antes/src/engines/ronco/dsp.ts
const path = require('path');
const fs = require('fs');
const os = require('os');
const tsx = require('tsx/cjs/api');
const ROOT = path.join(__dirname, '..', '..', 'src');
const ts = (arquivo) => tsx.require(arquivo, __filename);
const G = ts(path.join(ROOT, 'engines', 'ronco', 'geometria.ts'));
const { PRESETS, ACESSORIOS_PADRAO } = ts(path.join(ROOT, 'engines', 'ronco', 'presets.ts'));
let { EngineDSP } = ts(path.join(ROOT, 'engines', 'ronco', 'dsp.ts'));
function use(file) {
  if (file === 'legado') {
    const { lerLegado } = ts(path.join(__dirname, '..', 'legado.ts'));
    file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ronco-legado-')), 'dsp.js');
    fs.writeFileSync(file, lerLegado('src/dsp.js'));
  }
  const m = /\.tsx?$/.test(file) ? ts(path.resolve(file)) : require(path.resolve(file));
  EngineDSP = (typeof m === 'function' ? m() : m).EngineDSP; // fábrica legada ou módulo que exporta EngineDSP
  if (!EngineDSP) throw new Error(file + ': não achei EngineDSP');
  module.exports.EngineDSP = EngineDSP;
}

// acessórios que o preset não define: os mesmos da página (ACESSORIOS_PADRAO de src/engines/ronco/presets.ts)
const STOCK = ACESSORIOS_PADRAO;
const FS = 48000;

function config(id, patch = {}) {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error('preset ' + id);
  const spec = { ...STOCK, ...p, ...patch };
  const e = G.build(spec);
  const cfg = { ...spec, N: e.N, fire: e.fire, bank: e.bank, banks: e.banks, axis: e.axis, z: e.z, tdcRel: e.tdcRel, runners: e.runners };
  if (cfg.banks === 1 && (cfg.routing === 'xpipe' || cfg.routing === 'hpipe')) cfg.routing = 'dual';
  const probe = new EngineDSP(FS);
  probe.setConfig(cfg);
  cfg.gain = probe.cfgGain; cfg.mkIdle = probe.mkIdle;
  if (probe.powerModel) { cfg.powerModel = probe.powerModel; cfg.tqPeakModel = probe.tqPeakModel; cfg.frPeakModel = probe.frPeakModel; }
  return cfg;
}

// script: lista de [tempo_s, {throttle, ...}] ; mods: função aplicada ao dsp antes de rodar
function render(cfg, script, dur, { params = {}, mods, warm = true, onBlock } = {}) {
  const d = new EngineDSP(FS);
  d.setConfig(cfg);
  Object.assign(d.params, { master: 0.8 }, params);
  if (warm) { d.tempMode = 'fixed'; d.tempSet = 90; d.coolant = 90; }
  if (mods) mods(d);
  d.message({ type: 'input', ignition: true });
  const B = 128, n = Math.floor(dur * FS);
  const L = new Float32Array(n), R = new Float32Array(n);
  const bl = new Float32Array(B), br = new Float32Array(B);
  let si = 0;
  const rpm = [];
  for (let i = 0; i < n; i += B) {
    const t = i / FS;
    while (si < script.length && script[si][0] <= t) { d.message({ type: 'input', ...script[si][1] }); si++; }
    d.process(bl, br, B);
    L.set(bl.subarray(0, Math.min(B, n - i)), i); R.set(br.subarray(0, Math.min(B, n - i)), i);
    if ((i / B) % 32 === 0) rpm.push([t, d.rpmAvg, d.thr, d.limiter]);
    if (onBlock) onBlock(d, t, i);
  }
  return { L, R, rpm, d };
}

// FFT radix-2 simples
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

// potência média por banda (Welch, janela de Hann)
const BANDS = [[20, 150], [150, 400], [400, 1000], [1000, 2500], [2500, 6000], [6000, 12000]];
function bands(x, a, b, N = 4096) {
  const acc = new Float64Array(N / 2);
  let cnt = 0;
  for (let s = a; s + N <= b; s += N / 2) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = x[s + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
    fft(re, im);
    for (let k = 0; k < N / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
    cnt++;
  }
  const out = BANDS.map(([f0, f1]) => {
    let e = 0;
    for (let k = Math.ceil((f0 * N) / FS); k < Math.min(N / 2, (f1 * N) / FS); k++) e += acc[k];
    return e / Math.max(1, cnt);
  });
  let num = 0, den = 0;
  for (let k = 1; k < N / 2; k++) { const f = (k * FS) / N; num += f * acc[k]; den += acc[k]; }
  return { e: out, centroid: num / Math.max(den, 1e-30), total: den / Math.max(1, cnt) };
}
const db = (x) => 10 * Math.log10(Math.max(x, 1e-30));
const rms = (x, a, b) => { a = Math.floor(a); b = Math.min(x.length, Math.floor(b)); let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };

module.exports = { config, render, bands, BANDS, db, rms, FS, PRESETS, EngineDSP, use };
