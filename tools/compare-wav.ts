// Compara dois WAVs amostra a amostra.
//   npx tsx tools/compare-wav.ts <a.wav> <b.wav> [--limite -90]
// Informa se são idênticos (mesmos bits) e o erro máximo em dBFS (1,0 = 0 dBFS).
// Saída 0 se idênticos ou, com --limite, se o erro máximo ficar abaixo do limite; 1 caso contrário.
// Também aceita duas pastas: compara os .wav de mesmo nome.
import fs from 'node:fs';
import path from 'node:path';
import { lerWav } from './wav';

const dB = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const fmtDb = (x: number) => (Number.isFinite(x) ? `${x.toFixed(1)} dBFS` : '−∞ dBFS');

function comparar(a: string, b: string, limite: number | null) {
  const A = lerWav(a), B = lerWav(b);
  const avisos: string[] = [];
  if (A.sr !== B.sr) avisos.push(`taxa ${A.sr} ≠ ${B.sr}`);
  if (A.canais.length !== B.canais.length) avisos.push(`canais ${A.canais.length} ≠ ${B.canais.length}`);
  if (A.formato !== B.formato) avisos.push(`formato ${A.formato} ≠ ${B.formato}`);
  const na = A.canais[0].length, nb = B.canais[0].length;
  if (na !== nb) avisos.push(`comprimento ${na} ≠ ${nb} amostras`);
  const n = Math.min(na, nb), nc = Math.min(A.canais.length, B.canais.length);
  let max = 0, onde = -1, canal = -1, soma = 0, primeira = -1, picoA = 0;
  for (let c = 0; c < nc; c++) {
    const x = A.canais[c], y = B.canais[c];
    for (let i = 0; i < n; i++) {
      const d = Math.abs(x[i] - y[i]);
      // NaN conta como diferença máxima
      const dd = Number.isNaN(d) ? Infinity : d;
      if (dd > 0 && (primeira < 0 || i < primeira)) primeira = i;
      if (dd > max) { max = dd; onde = i; canal = c; }
      soma += d * d || 0;
      picoA = Math.max(picoA, Math.abs(x[i]));
    }
  }
  const identicos = max === 0 && !avisos.length;
  const rms = Math.sqrt(soma / Math.max(1, n * nc));
  const ok = identicos || (limite != null && !avisos.length && dB(max) < limite);
  const linha = identicos
    ? `IDÊNTICOS (${n} amostras × ${nc} canais, ${A.formato})`
    : `DIFERENTES · erro máximo ${fmtDb(dB(max))} (canal ${canal}, amostra ${onde}, ${(onde / A.sr).toFixed(4)} s) · erro RMS ${fmtDb(dB(rms))} · primeira diferença na amostra ${primeira}`;
  console.log(`${path.basename(a)}: ${linha}${avisos.length ? ` · ${avisos.join(', ')}` : ''} · pico ${fmtDb(dB(picoA))}${limite != null && !identicos ? (ok ? ` · abaixo de ${limite} dBFS` : ` · ACIMA de ${limite} dBFS`) : ''}`);
  return ok;
}

const args = process.argv.slice(2);
const iLim = args.indexOf('--limite');
const limite = iLim >= 0 ? +args[iLim + 1] : null;
const [a, b] = args.filter((x, i) => !x.startsWith('--') && (iLim < 0 || i !== iLim + 1));
if (!a || !b) { console.error('uso: tsx tools/compare-wav.ts <a.wav|pasta> <b.wav|pasta> [--limite -90]'); process.exit(2); }

let ok = true;
if (fs.statSync(a).isDirectory()) {
  const nomes = fs.readdirSync(a).filter((f) => f.endsWith('.wav')).sort();
  if (!nomes.length) { console.error(`${a}: nenhum .wav`); process.exit(2); }
  let iguais = 0;
  for (const f of nomes) {
    const outro = path.join(b, f);
    if (!fs.existsSync(outro)) { console.log(`${f}: falta em ${b}`); ok = false; continue; }
    const r = comparar(path.join(a, f), outro, limite);
    ok = r && ok; if (r) iguais++;
  }
  console.log(`${iguais}/${nomes.length} dentro do critério`);
} else ok = comparar(a, b, limite);
process.exit(ok ? 0 : 1);
