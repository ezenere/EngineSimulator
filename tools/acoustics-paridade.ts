// Confere que os blocos de src/acoustics/ calculam exatamente o mesmo que as cópias de dentro de
// src/dsp.js e src/jet-dsp.js: mesmas entradas, saídas comparadas bit a bit (Object.is).
//   npx tsx tools/acoustics-paridade.ts
// As classes legadas ficam presas dentro das fábricas; aqui a fábrica é recompilada com um `return`
// que também as expõe. O arquivo legado não é alterado.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as A from '../src/acoustics';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function abrirFabrica(arquivo: string, nome: string, retornoOriginal: string, extras: string) {
  const src = fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');
  if (!src.includes(retornoOriginal)) throw new Error(`${arquivo}: não achei "${retornoOriginal}"`);
  const aberto = src.replace(retornoOriginal, retornoOriginal.replace(' };', `, ${extras} };`));
  return new Function(`${aberto}\nreturn ${nome};`)()();
}

const R = abrirFabrica('src/dsp.js', 'EngineDSPFactory', 'return { EngineDSP, gearRatios, defaultFinal };',
  'RNG, Biquad, Line, Junction, TwoPort, Radiator, Cutout, ClosedEnd, port, pin, pout, psi, flow, onePole, clamp, smooth, TAU, DEG, SOUND_SPEED, P0, RGAS, GAM');
const J = abrirFabrica('src/jet-dsp.js', 'JetDSPFactory', 'return { JetDSP };', 'RNG, Biquad, onePole, clamp, smooth, db, TAU, C0, PREF, R_REF');

let falhas = 0, verificados = 0;
function igual(rotulo: string, a: ArrayLike<number>, b: ArrayLike<number>) {
  verificados++;
  if (a.length !== b.length) { console.log(`FALHA ${rotulo}: comprimento ${a.length} ≠ ${b.length}`); falhas++; return; }
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) { console.log(`FALHA ${rotulo}: amostra ${i}: ${a[i]} ≠ ${b[i]}`); falhas++; return; }
  }
}
const N = 20000, FS = 48000;
// sinal de teste: ruído + impulsos + seno, com amplitude de pressão de escape (centenas a milhares de Pa)
const sinal = (seed: number, escala = 3000) => { const r = new A.RNG(seed); return Float64Array.from({ length: N }, (_, i) => escala * (r.bi() * 0.5 + (i % 997 === 0 ? 4 : 0) + Math.sin(i * 0.031))); };

// constantes
igual('constantes Ronco', [A.TAU, A.DEG, A.SOUND_SPEED, A.P0, A.RGAS, A.GAM], [R.TAU, R.DEG, R.SOUND_SPEED, R.P0, R.RGAS, R.GAM]);
igual('constantes Turbina', [A.TAU, A.C0, A.PREF, A.R_REF], [J.TAU, J.C0, J.PREF, J.R_REF]);

// RNG (Ronco tem gauss; a Turbina, só next/bi)
for (const [nome, L] of [['Ronco', R], ['Turbina', J]] as const) {
  for (const seed of [0, 1, 12345, 0xdeadbeef]) {
    const a = new A.RNG(seed), b = new L.RNG(seed), xa: number[] = [], xb: number[] = [];
    for (let i = 0; i < 5000; i++) { xa.push(a.next(), a.bi()); xb.push(b.next(), b.bi()); if (L === R) { xa.push(a.gauss()); xb.push(b.gauss()); } }
    igual(`RNG ${nome} semente ${seed}`, xa, xb);
  }
}

// utilitários
{
  const xs = Array.from({ length: 400 }, (_, i) => (i - 200) * 0.0137);
  igual('clamp/smooth Ronco', xs.flatMap((x) => [A.clamp(x, -1, 1.5), A.smooth(-0.5, 0.7, x)]), xs.flatMap((x) => [R.clamp(x, -1, 1.5), R.smooth(-0.5, 0.7, x)]));
  igual('smooth/db Turbina', xs.flatMap((x) => [A.smooth(-0.5, 0.7, x), A.db(x * 30)]), xs.flatMap((x) => [J.smooth(-0.5, 0.7, x), J.db(x * 30)]));
  const fs = [0, 1, 20, 440, 5000, 21000, 30000];
  igual('onePole', fs.map((f) => A.onePole(FS, f)), fs.map((f) => R.onePole(FS, f)));
  igual('onePole Turbina', fs.map((f) => A.onePole(FS, f)), fs.map((f) => J.onePole(FS, f)));
}

// Biquad: todos os tipos, inclusive frequências fora da faixa (o piso de 5 Hz só existe na Turbina)
function biquads(B, comShelf: boolean) {
  const out: number[] = [];
  const x = sinal(7, 1);
  const filtros = [];
  for (const f of [0, 2, 40, 900, 4000, 23000, 40000]) {
    filtros.push(new B().lp(FS, f), new B().lp(FS, f, 2.3), new B().hp(FS, f), new B().bp(FS, f, 0.9), new B().peak(FS, f, 1.4, -7.5), new B().peak(FS, f, 0.8, 4));
    if (comShelf) filtros.push(new B().hshelf(FS, f, -6), new B().hshelf(FS, f, 3.5));
  }
  for (const flt of filtros) { out.push(flt.b0, flt.b1, flt.b2, flt.a1, flt.a2); for (let i = 0; i < 2000; i++) out.push(flt.run(x[i])); }
  return out;
}
igual('Biquad (Ronco)', biquads(A.Biquad, true), biquads(R.Biquad, true));
igual('BiquadComPiso (Turbina)', biquads(A.BiquadComPiso, false), biquads(J.Biquad, false));

// escoamento compressível
{
  const ps = Array.from({ length: 3000 }, (_, i) => -0.1 + i * 0.0004);
  igual('psi', ps.map((p) => A.psi(p)), ps.map((p) => R.psi(p)));
  const va: number[] = [], vb: number[] = [];
  for (let i = 0; i < 2000; i++) { const pa = 60000 + i * 97, pb = 101325 + Math.sin(i) * 40000, ta = 300 + i, tb = 900 - i * 0.2; va.push(A.flow(3e-4, pa, ta, pb, tb)); vb.push(R.flow(3e-4, pa, ta, pb, tb)); }
  igual('flow', va, vb);
}

// rede de guias de onda: primário (com não linearidade e atrito) → junção → abafador → ponteira,
// com ressonador (ponta fechada) e cutout, para cada tipo de abafador. Mesma rede montada com os
// blocos novos e com os legados; compara a pressão irradiada e o estado dos tubos amostra a amostra.
function rede(L, kind: string) {
  const prim = new L.Line(FS, 0.78, 1, 9000, 1); prim.kNL = 0.35; prim.runner = true;
  const prim2 = new L.Line(FS, 0.65, 1, 8000, 1.2); prim2.kNL = 0.2; prim2.runner = true;
  const col = new L.Line(FS, 0.4, 2.2, 7000, 1);
  const reso = new L.Line(FS, 0.3, 0.8);
  const mid = new L.Line(FS, 1.2, 1.6, 6000, 0.8);
  const cut = new L.Line(FS, 0.2, 1.4);
  const tail = new L.Line(FS, 0.9, 1.5);
  const j = new L.Junction([L.port(prim, 1), L.port(prim2, 1), L.port(col, 0)]);
  const j2 = new L.Junction([L.port(col, 1), L.port(reso, 0), L.port(mid, 0), L.port(cut, 0)]);
  const tp = new L.TwoPort(FS, L.port(mid, 1), L.port(tail, 0), kind);
  const end = new L.ClosedEnd(reso);
  const valve = { v: 0 };
  const cutout = new L.Cutout(FS, cut, 0.7, 0.3, 1800, 0.9, valve, 2200);
  const rad = new L.Radiator(FS, tail, 0.5, 0.5, 1500, 1, 2000);
  const x = sinal(99), x2 = sinal(5);
  const out: number[] = [];
  const linhas = [prim, prim2, col, reso, mid, cut, tail];
  for (let i = 0; i < N; i++) {
    if (i === 6000) valve.v = 1; // abre o cutout no meio
    for (const l of linhas) l.read();
    prim.out0 = x[i]; prim2.out0 = x2[i];
    j.inj = i % 500 === 0 ? 50 : 0;
    j.step(); j2.step(); tp.step(); end.step(); cutout.step(); rad.step();
    for (const l of linhas) l.write();
    out.push(rad.emit, cutout.emit, prim.in1, col.in0, tail.in1, tp.s, cutout.o, L.pin(L.port(mid, 0)));
  }
  return out;
}
for (const kind of ['straight', 'sport', 'stock', 'classic', 'turbo']) igual(`guias de onda (${kind})`, rede(A, kind), rede(R, kind));

console.log(falhas ? `${falhas} de ${verificados} verificações FALHARAM` : `${verificados} verificações: tudo idêntico bit a bit`);
process.exit(falhas ? 1 : 0);
