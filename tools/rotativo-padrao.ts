// Padrão de queima da lenta dos Rotativos: a sequência queimou/falhou de cada explosão, o ritmo que ela faz e a diluição
// (fração de gás queimado na carga presa). É a sonda do "brap" das janelas de competição: com sobreposição grande, o gás
// queimado que volta pela janela dilui a carga seguinte até ela não acender; a câmara que falha manda mistura crua ao
// escape, o que volta passa a ser mistura e a queima recomeça. O ritmo esperado nas gravações (787B, bridgeport, RX-7
// preparado) é de uma rajada a cada ~6 voltas do eixo (rpm/360: ~5 Hz).
//
//   npx tsx tools/rotativo-padrao.ts <preset> [--campo JSON] [--dur s] [--rpm R]   (--rpm trava o giro; sem ele, lenta livre)
import { RotativoDSP } from '../src/engines/rotativo/dsp';
import { preset, cfgCalibrada, SR } from './rotativo-comum';

const a = process.argv.slice(2);
const val = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
const id = a[0], dur = +(val('--dur') || 12), campo = JSON.parse(val('--campo') || '{}'), rpmFixo = val('--rpm') ? +val('--rpm')! : 0;
if (!id) { console.error('uso: tsx tools/rotativo-padrao.ts <preset> [--campo JSON] [--dur s] [--rpm R]'); process.exit(2); }
const p0 = preset(id);
if (campo.janelas) campo.janelas = { ...p0.janelas, ...campo.janelas };
if (campo.escape) campo.escape = { ...p0.escape, ...campo.escape };
const spec = { ...p0, ...campo };
const d: any = new RotativoDSP(SR);
d.setConfig(cfgCalibrada(spec));
d.message({ type: 'params', params: { listener: 'ext', master: 0.8, ambSound: false } });
d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } });
const rpm0 = rpmFixo || spec.idle;
d.coolant = 90; d.state = 'run'; d.ignition = true; d.runT = 120; d.warm = 1; d.omega = (rpm0 * Math.PI) / 30; d.rpmAvg = rpm0; d.exhT = 450;
if (rpmFixo) { d.lockOmega = true; d.KI = 0; }
const ev: { t: number; c: number; q: boolean; x: number; p: number }[] = [];
let t = 0;
d.sondaEv = (c: number, q: boolean, x: number, p: number) => ev.push({ t, c, q, x, p });
const B = 128, l = new Float32Array(B), r = new Float32Array(B);
const rpms: number[] = [], blocos: number[][] = [];
for (let i = 0; i < dur * SR; i += B) { t = i / SR; d.process(l, r, B); if (t > 4) rpms.push(d.rpmAvg); (blocos[Math.floor(t / 5)] ||= []).push(d.rpmAvg); }
const todos = ev.filter((e) => e.t > 4), fim = ev.filter((e) => e.t > dur - 2.5);
const media = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length);
console.log(`${id} ${JSON.stringify(campo)}: ${Math.min(...rpms).toFixed(0)}–${Math.max(...rpms).toFixed(0)} rpm (média ${media(rpms).toFixed(0)}), coletor ${(d.pMan / 1e5).toFixed(2)} bar, ar de lenta ${d.iac.toFixed(4)}, estouros ${(d.estourosTotal / dur).toFixed(1)}/s`);
console.log('rpm médio a cada 5 s: ' + blocos.map((b) => media(b).toFixed(0)).join(' '));
console.log(`últimos 2,5 s (X = queimou, . = falhou):\n${fim.map((e) => (e.q ? 'X' : '.')).join('')}`);
const q = todos.filter((e) => e.q);
console.log(`queima em ${((100 * q.length) / todos.length).toFixed(0)}% das explosões · gás queimado na carga presa: ${media(todos.map((e) => e.x)).toFixed(2)} (nas que queimaram ${media(q.map((e) => e.x)).toFixed(2)}) · pressão na abertura das que queimaram ${(media(q.map((e) => e.p)) / 1e5).toFixed(2)} bar`);
// ritmo: autocorrelação da sequência queimou/falhou, com a defasagem em voltas do eixo
const sq = todos.map((e) => (e.q ? 1 : 0)), mu = media(sq), vr = media(sq.map((x) => (x - mu) ** 2));
const ac = (k: number) => { let s = 0; for (let i = 0; i + k < sq.length; i++) s += (sq[i] - mu) * (sq[i + k] - mu); return s / Math.max(vr * (sq.length - k), 1e-12); };
const porVolta = d.N / (d.cyc / 360);
if (vr > 1e-6) console.log('autocorrelação da sequência por defasagem em voltas do eixo:  ' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 12].map((v) => `${v}: ${ac(Math.round(v * porVolta)).toFixed(2)}`).join('  '));
else console.log('sequência regular (todas queimam ou todas falham)');
