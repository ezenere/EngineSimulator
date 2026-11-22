// Teste de periodicidade dos Rotativos (a lição da Fórmula 1 no REVISAO-DE-SOM.md): com os ruídos e a variação entre
// explosões desligados e o giro travado, um motor simulado tem de ser periódico. Fração da energia que se repete igual a
// cada ciclo da câmara (3 voltas do eixo no Wankel, 2 no X-Engine) abaixo de ~0,9 é instabilidade do modelo (o afiamento
// não linear da onda nos primários entrando em ressonância: sub-harmônicos e caos), não som. Varre os presets em 50, 70,
// 85 e 95% da rotação máxima, em plena carga e em carga leve (o pedal que zera o torque).
//
//   npx tsx tools/rotativo-periodico.ts [ids...] [--limite 0.9]
// Sai ≠ 0 se algum ponto ficar abaixo do limite.
import { RotativoDSP } from '../src/engines/rotativo/dsp';
import { preset, cfgCalibrada, SR, PRESETS_ROTATIVO } from './rotativo-comum';

const args = process.argv.slice(2);
const li = args.indexOf('--limite'), limite = li >= 0 ? +args[li + 1] : 0.9;
const ids = args.filter((a, i) => !a.startsWith('--') && (li < 0 || i !== li + 1));
const todos = ids.length ? ids : PRESETS_ROTATIVO.filter((p) => p.tipo !== 'palhetas').map((p) => p.id);
const B = 128, l = new Float32Array(B), r = new Float32Array(B);

function novo(spec: any, rpm: number, thr: number) {
  const d: any = new RotativoDSP(SR);
  d.setConfig(cfgCalibrada(spec));
  d.message({ type: 'params', params: { listener: 'ext', master: 0.8, ambSound: false, env: 'open', air: 0, mech: 0 } });
  d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } });
  d.coolant = 90; d.ambientT = 20; d.state = 'run'; d.ignition = true; d.runT = 120; d.warm = 1; d.exhT = 450;
  d.omega = (rpm * 2 * Math.PI) / 60; d.rpmAvg = rpm; d.lockOmega = true; d.KI = 0; d.thrTarget = thr; d.thr = thr;
  d.varScale = 0; d.carbVar = 0; d.carbMis = 0; d.hcTurb = 0; d.kBoca = 0; d.valveNoise = 0; d.xF0 = 9; d.xF1 = 10; // (a dispersão fixa entre câmaras fica: é periódica; as falhas por diluição ficam de fora)
  if (d.av) { d.magnetos = 'ambos'; d.mistura = 0.8; }
  return d;
}

/** fração da energia que se repete a cada período de P amostras (média síncrona com interpolação cúbica) */
function fracaoPeriodica(x: Float32Array, P: number) {
  const K = Math.max(64, Math.round(P)), nc = Math.floor((x.length - 4) / P) - 1;
  if (nc < 4) return NaN;
  const med = new Float64Array(K);
  const at = (t: number) => { const i = Math.floor(t), f = t - i, a = x[i - 1], b = x[i], c = x[i + 1], e = x[i + 2]; return b + 0.5 * f * (c - a + f * (2 * a - 5 * b + 4 * c - e + f * (3 * (b - c) + e - a))); };
  let tot = 0;
  const amostras: Float64Array[] = [];
  for (let c = 0; c < nc; c++) { const v = new Float64Array(K); for (let k = 0; k < K; k++) { v[k] = at(1 + (c + k / K) * P); med[k] += v[k] / nc; tot += v[k] * v[k]; } amostras.push(v); }
  let m0 = 0; for (let k = 0; k < K; k++) m0 += med[k] / K;
  let per = 0, dc = 0; for (let k = 0; k < K; k++) per += (med[k] - m0) ** 2;
  for (const v of amostras) for (let k = 0; k < K; k++) dc += m0 * m0;
  return (per * nc) / Math.max(tot - dc, 1e-30);
}

let ruins = 0;
console.log('fração periódica no ciclo da câmara (ruídos e variação desligados, giro travado): plena carga / carga leve');
console.log('preset      ' + [50, 70, 85, 95].map((f) => `${f}% rpmMáx`.padStart(18)).join(''));
for (const id of todos) {
  const spec = preset(id);
  let linha = id.padEnd(12);
  for (const fr of [0.5, 0.7, 0.85, 0.95]) {
    const rpm = spec.rpmMax * fr;
    const medir = (thr: number) => {
      const d = novo(spec, rpm, thr);
      for (let i = 0; i < 2.5 * SR; i += B) d.process(l, r, B);
      const n = Math.round(2 * SR), x = new Float32Array(n);
      for (let i = 0; i < n; i += B) { d.process(l, r, B); for (let k = 0; k < B && i + k < n; k++) x[i + k] = 0.5 * (l[k] + r[k]); }
      return fracaoPeriodica(x, (SR * 60 * (d.cyc / 360)) / rpm);
    };
    let lo = 0, hi = 0.6, thr = 0.3;
    for (let it = 0; it < 9; it++) { thr = 0.5 * (lo + hi); const x = novo(spec, rpm, thr); for (let i = 0; i < 0.6 * SR; i += B) x.process(l, r, B); if (x.tqMean > 0) hi = thr; else lo = thr; }
    const a = medir(1), b = medir(thr);
    if (!(a >= limite) || !(b >= limite)) ruins++;
    linha += `${a.toFixed(3)}${a >= limite ? ' ' : '!'} / ${b.toFixed(3)}${b >= limite ? ' ' : '!'}`.padStart(18);
  }
  console.log(linha);
}
console.log(ruins ? `\n${ruins} ponto(s) abaixo de ${limite}: instabilidade do modelo` : `\ntodos os pontos ≥ ${limite}`);
process.exitCode = ruins ? 1 : 0;
