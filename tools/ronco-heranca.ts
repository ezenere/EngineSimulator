// Prova de que uma mudança no motor-base (EngineDSP, src/engines/ronco/dsp.ts) não mudou o som das famílias que
// herdam dele: Diesel, Radial, Rotativos e a aviação a pistão do Ronco. Renderiza três presets de cada família num
// cenário curto (lenta, acelerada, solta), com a calibração da página, e imprime o SHA-256 das amostras float 32 dos
// dois canais. Rode antes e depois da mudança e compare:
//
//   npx tsx tools/ronco-heranca.ts --gravar <arquivo.json>      grava os hashes
//   npx tsx tools/ronco-heranca.ts --conferir <arquivo.json>    sai com código ≠ 0 se algum hash mudou
//   npx tsx tools/ronco-heranca.ts                              só imprime
//
// Os mecanismos novos do motor-base (docs/TECNICO.md → Ronco: "Médios" e "Jato da ponteira") nascem desligados: sem
// os campos no preset, o EngineDSP toca como antes. Quem liga é o preset de cada família.
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as D from './diesel-comum';
import * as R from './radial-comum';
import * as W from './rotativo-comum';
import { EngineDSP } from '../src/engines/ronco/dsp';
import { configCalibrada } from '../src/engines/ronco/config';
import { ACESSORIOS_PADRAO, PRESETS_AVIACAO } from '../src/engines/ronco/presets';

const SR = 48000, B = 128;
const sha = (...xs: Float32Array[]) => { const h = crypto.createHash('sha256'); for (const x of xs) h.update(Buffer.from(x.buffer, x.byteOffset, x.byteLength)); return h.digest('hex'); };
const pico = (x: Float32Array) => { let m = 0; for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i])); return m; };

type Caso = { familia: string; id: string; render: () => { L: Float32Array; R: Float32Array } };
const casos: Caso[] = [];

// Diesel: cenário `rev` (lenta, pé no fundo até o governador, solta), 11 s
for (const id of ['hilux28', 'om617', 'scaniav8']) casos.push({ familia: 'diesel', id, render: () => D.renderizar(D.preset(id), 'rev') });
// Radial: motor quente na lenta, manete a 60% aos 2 s, volta aos 5 s
for (const id of ['r1830', 'm14p', 'rotec2800']) casos.push({ familia: 'radial', id, render: () => {
  const d = R.novoDSP(R.preset(id), { quente: true });
  return R.renderizar(d, 8, [[2, (x) => x.message({ type: 'input', throttle: 0.6 })], [5, (x) => x.message({ type: 'input', throttle: 0 })]]);
} });
// Rotativos: idem
for (const id of ['rx7fd', 'r26b', 'ro80']) casos.push({ familia: 'rotativo', id, render: () => {
  const d = W.novoDSP(W.preset(id), { quente: true });
  return W.renderizar(d, 8, [[2, (x) => x.message({ type: 'input', throttle: 0.6 })], [5, (x) => x.message({ type: 'input', throttle: 0 })]]);
} });
// Aviação a pistão do Ronco (EngineDSP com `aviation: true`): partida de verdade, manete a 60% aos 6 s
for (const id of ['c172', 'r44', 'rotax912']) casos.push({ familia: 'aviacao', id, render: () => {
  const d: any = new EngineDSP(SR);
  d.setConfig(configCalibrada({ ...ACESSORIOS_PADRAO, ...PRESETS_AVIACAO.find((p) => p.id === id)! }, SR));
  d.message({ type: 'params', params: { listener: 'ext', ambSound: false } });
  d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } });
  d.message({ type: 'input', ignition: true });
  const n = 10 * SR, L = new Float32Array(n), Rr = new Float32Array(n), bl = new Float32Array(B), br = new Float32Array(B);
  for (let i = 0; i < n; i += B) {
    if (i === 6 * SR) d.message({ type: 'input', throttle: 0.6 });
    d.process(bl, br, B);
    L.set(bl.subarray(0, Math.min(B, n - i)), i); Rr.set(br.subarray(0, Math.min(B, n - i)), i);
  }
  return { L, R: Rr };
} });

const args = process.argv.slice(2);
const opcao = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const so = opcao('--so')?.split(',');
const saida: Record<string, { sha: string; pico: number }> = {};
for (const c of casos) {
  if (so && !so.includes(c.familia) && !so.includes(c.id)) continue;
  const t0 = Date.now();
  const r = c.render();
  const k = `${c.familia}/${c.id}`;
  saida[k] = { sha: sha(r.L, r.R), pico: +pico(r.L).toFixed(6) };
  console.log(`${k.padEnd(22)} ${saida[k].sha}  pico ${saida[k].pico.toFixed(4)}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
const gravar = opcao('--gravar'), conferir = opcao('--conferir');
if (gravar) { fs.writeFileSync(gravar, JSON.stringify(saida, null, 1)); console.log(`gravado em ${gravar}`); }
if (conferir) {
  const ref = JSON.parse(fs.readFileSync(conferir, 'utf8'));
  let dif = 0;
  for (const [k, v] of Object.entries(saida)) {
    if (!ref[k]) { console.log(`SEM REFERÊNCIA ${k}`); dif++; }
    else if (ref[k].sha !== v.sha) { console.log(`MUDOU ${k}: pico ${ref[k].pico} → ${v.pico}`); dif++; }
  }
  for (const [k, v] of Object.entries(saida)) if (!(v.pico > 0.005)) { console.log(`NÃO TOCOU ${k} (pico ${v.pico})`); dif++; }
  console.log(dif ? `${dif} diferença(s)` : `HERANÇA OK: ${Object.keys(saida).length} renders idênticos aos de ${conferir}`);
  process.exit(dif ? 1 : 0);
}
