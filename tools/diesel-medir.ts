// Renderiza um cenário do Diesel e mede um trecho com a análise do Apêndice A (tools/diesel-bandas.ts).
//
//   npx tsx tools/diesel-medir.ts <preset> <cenário> <ouvinte> <t0> <t1> [--wav arquivo.wav]
import { renderizar, preset, trecho, media, SR } from './diesel-comum';
import { analisar, linha } from './diesel-bandas';
import { gravarWav } from './wav';

export function medir(id: string, cen: string, ouvinte: string, t0: number, t1: number, wav?: string) {
  const spec = preset(id);
  const r = renderizar(spec, cen, { ouvinte });
  const a = Math.floor(t0 * SR), b = Math.floor(t1 * SR);
  const x = new Float64Array(b - a);
  for (let i = 0; i < x.length; i++) x[i] = 0.5 * (r.L[a + i] + r.R[a + i]);
  const tl = trecho(r.tele, t0, t1);
  const rpm = media(tl.map((e) => e.rpm));
  if (wav) gravarWav(wav, r.L, r.R, SR);
  return { an: analisar(x, SR, rpm, spec.cylinders, spec.tempos), rpm, tele: tl, r, spec };
}

if (process.argv[1] && process.argv[1].endsWith('diesel-medir.ts')) {
  const args = process.argv.slice(2);
  const iw = args.indexOf('--wav'); const wav = iw >= 0 ? args[iw + 1] : undefined;
  const [id, cen, ouv, t0, t1] = args.filter((x, i) => !x.startsWith('--') && (iw < 0 || i !== iw + 1));
  const m = medir(id, cen, ouv || 'ext', +(t0 || 6), +(t1 || 12), wav);
  const tl = m.tele;
  console.log(`${id} ${cen} ${ouv} rpm ${m.rpm.toFixed(0)} pMax ${media(tl.map((e) => e.pMax)).toFixed(1)} dp ${media(tl.map((e) => e.dpdth)).toFixed(2)} τ ${media(tl.map((e) => e.tauId)).toFixed(2)} ms`);
  console.log(' 60-150 400-1k 1-2.5k 2.5-6k 6-12k   cen |   1-4k  curt p90/10 tq/cic tq/ev');
  console.log(linha(m.an));
}
