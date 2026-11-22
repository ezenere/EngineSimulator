// Forma do chuff de um WAV (gravação ou render), com as mesmas medidas da validação (tools/vapor-analise.ts →
// `analisarChuff`): taxa, ataque 10–90%, largura a −6 dB, decaimento a −10 dB, pico/vale total e por banda, bandas e
// centroide no pico e no vale. Sai em JSON (para tools/vapor-ouvido.py) ou em texto.
//
//   npx tsx tools/vapor-forma.ts <arquivo.wav> [--trecho a-b] [--chuffs f] [--json]
//   --chuffs f   impõe a taxa de chuffs (Hz); sem ela vale a linha mais alta da envoltória com autocorrelação > 0,25
import { lerMono, trecho, analisarChuff, textoChuff, cinco } from './vapor-analise';

const a = process.argv.slice(2);
const val = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
const arq = a.find((x, i) => !x.startsWith('--') && !(i > 0 && ['--trecho', '--chuffs'].includes(a[i - 1])));
if (!arq) { console.error('uso: tsx tools/vapor-forma.ts <arquivo.wav> [--trecho a-b] [--chuffs f] [--json]'); process.exit(2); }
const { x, fs } = lerMono(arq);
const tr = val('--trecho')?.split('-').map(Number);
const y = tr ? trecho(x, fs, tr[0], tr[1]) : x;
const m = analisarChuff(y, fs, val('--chuffs') ? +val('--chuffs')! : undefined);
if (a.includes('--json')) {
  const r = (v: number, d = 2) => (Number.isFinite(v) ? +v.toFixed(d) : null);
  console.log(JSON.stringify({
    nivel: r(m.nivel), fChuff: r(m.fChuff, 3), fCiclo: r(m.fCiclo, 3), taxaPicos: r(m.taxaPicos, 3), nPicos: m.picos.length,
    ataque: r(m.ataque.med, 1), largura: r(m.largura.med, 1), decaimento: r(m.decaimento.med, 1), pv: r(m.pv.med), cv: r(m.cv),
    pvBanda: [r(m.pvBanda['150-400']), r(m.pvBanda['400-1500']), r(m.pvBanda['1500-6000'])],
    pico: cinco(m.pico).map((v) => r(v, 1)), vale: cinco(m.vale).map((v) => r(v, 1)), trecho: cinco(m.trecho).map((v) => r(v, 1)),
    centroidePico: r(m.pico.centroide, 0), centroideVale: r(m.vale.centroide, 0), valePico: r(m.vale.centroide / m.pico.centroide, 3),
    candidatas: m.candidatas.map((c) => [r(c.f), r(c.prom, 1), r(c.ac)]),
  }));
} else console.log(textoChuff(m));
