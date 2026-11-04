// Banco de testes offline: monta um preset como o app.js faz (geometria + calibração) e renderiza cenários.
// `use(arquivo)` troca o dsp.js (ex.: a versão do git HEAD, para comparar).
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', 'src');
const G = require(path.join(ROOT, 'geometry.js'));
const PRESETS = require(path.join(ROOT, 'presets.js'));
const Factory = require(path.join(ROOT, 'dsp.js'));
let { EngineDSP } = Factory();
function use(file) { EngineDSP = require(file)().EngineDSP; module.exports.EngineDSP = EngineDSP; }

const STOCK = { valve: 'none', pipeD: 2.5, reso: false, twoStep: 'off', launchRpm: undefined, fuel: 'efi', shiftTime: undefined, driveMode: 'auto', limiter: 'ign', limiterBand: 70, limiterHold: 0.07, power: undefined, mass: undefined, wheelR: undefined, drag: undefined, ratios: undefined, finalDrive: undefined };
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
