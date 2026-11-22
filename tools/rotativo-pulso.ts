// Sonda do pulso de escape dos Rotativos: onde nascem e onde se perdem os harmônicos da ignição. Roda um preset em giro
// travado e grava, amostra a amostra, a vazão da câmara 0 pela janela, a onda que entra no primário do rotor 0, a onda
// que chega à boca e o que a boca irradia; imprime o nível das linhas k·f_ign (k = 1…12) em cada ponto, relativo à
// fundamental, e a forma do pulso (tempo de subida 10–90% da frente de pressão no primário).
//
//   npx tsx tools/rotativo-pulso.ts <preset> --rpm R [--pedal x] [--campo JSON] [--csv arquivo.csv] [--dur s]
//
// Serve para separar "o pulso nasce mole" (a janela, a pressão na abertura) de "o caminho come os harmônicos" (turbo,
// catalisador, pré-silencioso, abafador, irradiação). Sem ruído: as fontes estocásticas ficam desligadas (params.air = 0,
// pós-queima sem a parte turbulenta, variação da queima 0), para as linhas saírem limpas.
import fs from 'node:fs';
import { RotativoDSP } from '../src/engines/rotativo/dsp';
import { preset, cfgCalibrada, SR } from './rotativo-comum';

const a = process.argv.slice(2);
const val = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
const id = a[0], rpm = +(val('--rpm') || 0), pedal = val('--pedal') !== undefined ? +val('--pedal')! : undefined, dur = +(val('--dur') || 1.5);
if (!id || !rpm) { console.error('uso: tsx tools/rotativo-pulso.ts <preset> --rpm R [--pedal x] [--campo JSON] [--csv arq] [--dur s]'); process.exit(2); }
const campo = JSON.parse(val('--campo') || '{}');
const p0 = preset(id);
if (campo.escape) campo.escape = { ...p0.escape, ...campo.escape };
if (campo.janelas) campo.janelas = { ...p0.janelas, ...campo.janelas };
const spec = { ...p0, ...campo };

const novo = (thr: number) => {
  const d: any = new RotativoDSP(SR);
  d.setConfig(cfgCalibrada(spec));
  d.message({ type: 'params', params: { listener: 'ext', master: 0.8, ambSound: false, env: 'open', air: 0 } });
  d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } });
  d.coolant = 90; d.ambientT = 20; d.state = 'run'; d.ignition = true; d.runT = 120; d.warm = 1; d.exhT = 450;
  d.omega = (rpm * 2 * Math.PI) / 60; d.rpmAvg = rpm; d.lockOmega = true; d.KI = 0; d.thrTarget = thr; d.thr = thr;
  d.varScale = 0; d.hcTurb = 0; d.kBoca = 0; d.valveNoise = 0;
  return d;
};
const B = 128, l = new Float32Array(B), r = new Float32Array(B);
let thr = pedal ?? 0.3;
if (pedal === undefined) {
  let lo = 0, hi = 0.6;
  for (let it = 0; it < 12; it++) { thr = 0.5 * (lo + hi); const x = novo(thr); for (let i = 0; i < 0.8 * SR; i += B) x.process(l, r, B); if (x.tqMean > 0) hi = thr; else lo = thr; }
}
const d = novo(thr);
for (let i = 0; i < 3 * SR; i += B) d.process(l, r, B); // assenta (turbo, coletor, parede)
const n = Math.round(dur * SR);
const s1 = new Float32Array(1), s2 = new Float32Array(1);
const mEx = new Float64Array(n), prim = new Float64Array(n), boca = new Float64Array(n), emit = new Float64Array(n), saida = new Float64Array(n), pc = new Float64Array(n);
for (let i = 0; i < n; i++) {
  d.process(s1, s2, 1);
  mEx[i] = d.mEx[0]; prim[i] = d.runRot[0].out0; boca[i] = d.rads[0].line.in1; emit[i] = d.rads[0].emit; saida[i] = 0.5 * (s1[0] + s2[0]); pc[i] = d.p[0];
}
const fIgn = (rpm / 60) * (d.N / (d.cyc / 360)), fRot = rpm / 60;
// nível de uma linha (DFT num número inteiro de períodos da volta do eixo, janela de Hann)
const linha = (x: Float64Array, f: number) => {
  const per = SR / fRot, m = Math.floor(x.length / per) * per | 0;
  let re = 0, im = 0, sw = 0;
  for (let i = 0; i < m; i++) { const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / m); re += w * x[i] * Math.cos((2 * Math.PI * f * i) / SR); im -= w * x[i] * Math.sin((2 * Math.PI * f * i) / SR); sw += w; }
  return 20 * Math.log10((2 * Math.hypot(re, im)) / sw + 1e-30);
};
const K = 12;
const tab = (nome: string, x: Float64Array) => {
  const ref = linha(x, fIgn);
  console.log(`${nome.padEnd(22)} ${ref.toFixed(1).padStart(7)} dB | ` + Array.from({ length: K }, (_, k) => (linha(x, (k + 1) * fIgn) - ref).toFixed(0).padStart(4)).join(' '));
};
console.log(`${id} a ${rpm} rpm, pedal ${thr.toFixed(3)}, coletor ${(d.pMan / 1e5).toFixed(2)} bar, abertura ${(d.pEO[0] / 1e5).toFixed(2)} bar, ignição ${fIgn.toFixed(1)} Hz`);
console.log(`linhas k·f_ign relativas à fundamental (dB)  | ` + Array.from({ length: K }, (_, k) => String(k + 1).padStart(4)).join(' '));
tab('vazão da câmara 0', mEx);
tab('onda no primário 0', prim);
tab('onda que chega à boca', boca);
tab('irradiado pela boca', emit);
tab('saída (ouvinte ext)', saida);
// frente do pulso no primário: tempo de subida 10–90% do maior degrau
let mx = -Infinity, mn = Infinity; for (let i = 0; i < n; i++) { if (prim[i] > mx) mx = prim[i]; if (prim[i] < mn) mn = prim[i]; }
let iPk = 0; for (let i = 0; i < n; i++) if (prim[i] === mx) { iPk = i; break; }
let i10 = iPk, i90 = iPk; const lo = mn + 0.1 * (mx - mn), hi = mn + 0.9 * (mx - mn);
while (i90 > 0 && prim[i90] > hi) i90--; i10 = i90; while (i10 > 0 && prim[i10] > lo) i10--;
console.log(`primário: pico ${(mx / 1e3).toFixed(1)} kPa, vale ${(mn / 1e3).toFixed(1)} kPa, subida 10–90% ${(((i90 - i10) / SR) * 1e3).toFixed(2)} ms · boca: pico ${(Math.max(...boca) / 1e3).toFixed(2)} kPa`);
if (val('--csv')) {
  const m = Math.min(n, Math.round((3 / fRot) * SR));
  const L = ['t_ms,mEx_gps,primario_kPa,boca_kPa,emit,saida,p_camara_bar'];
  for (let i = 0; i < m; i++) L.push(`${((i / SR) * 1e3).toFixed(3)},${(mEx[i] * 1e3).toFixed(3)},${(prim[i] / 1e3).toFixed(4)},${(boca[i] / 1e3).toFixed(4)},${emit[i].toFixed(3)},${saida[i].toFixed(6)},${(pc[i] / 1e5).toFixed(4)}`);
  fs.writeFileSync(val('--csv')!, L.join('\n') + '\n');
  console.log(`gravado ${val('--csv')} (${m} amostras: 3 voltas do eixo)`);
}
