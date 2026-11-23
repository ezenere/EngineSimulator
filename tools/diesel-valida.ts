// Validação do Diesel num comando só (DIESEL.md 8): roda o teste de lenta (tools/diesel-lenta.ts), a troca de preset
// (tools/diesel-troca.ts), os governadores (tools/diesel-governador.ts) e as medidas abaixo, em paralelo, e sai com
// código ≠ 0 se algo falhar. Cada medida tem o alvo do DIESEL.md (tabelas 2.5, 2.6 e 4.4, Apêndice A) ou do real3.
//
// Desvios com teto (tools/desvios.ts; AUDITORIA A1, T-DSL-01): uma medida fora do alvo só passa se estiver no retrato
// `tools/diesel-desvios.json` (chave = nome exato da medida; antes eram expressões regulares largas, e `/real3 ·
// gerador/` casava 16 medidas) e o valor de hoje ficar na folga do gravado lá (±1 dB nas medidas em dB, ±5 % nas
// outras, ou a folga da entrada), com o motivo de cada uma (docs/TECNICO.md → Diesel). Saiu da folga: falha até
// `--atualizar` (tudo o que mudou) ou `--atualizar=<nome exato>` (só essa). Voltou a passar: aviso de desvio órfão.
// Sementes (A2; T-DSL-02, T-DSL-09): os grupos com contagem, transiente, coeficiente de variação ou a dispersão de ciclo
// a ciclo das pressões (`SEMENTES` abaixo: pressões, a lenta no cofre, as classes do real3, a envoltória, a fumaça, o
// Jake, a arrancada carregada, o câmbio, os governadores e a lenta exterior dos pesados) rodam com as sementes base,
// base+1 e base+2, uma por processo, e cada medida fica com o caso mediano. O teste de NaN lê todas as amostras e roda
// um processo por preset (A7, T-DSL-12). A CPU fica em `npm run cpu:diesel` (A8).
//
//   npx tsx tools/diesel-valida.ts [grupos...] [--j 24] [--semente N] [--atualizar[=nome exato]]   (ou --so g1,g2)
//   grupos: pressoes-a … -c, bandas-a -b, real3-a … -g, real3-tom, envoltoria-a … -d, ar-a … -c, fumaca-a -b, jake,
//           potencia, veiculo-a -b, cambio-a … -c, nan-<preset> (e nan-<preset>-b nas locomotivas), governador-a … -d,
//           projeto-a … -c, lenta, troca;
//           o nome sem a letra (pressoes, real3, nan, governador…) roda todos os dele
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderizar, preset, media, trecho, casoMediano, filho, SR, type Cenario, type LinhaDiesel } from './diesel-comum';
import { analisar, welch, bandaEEnvoltoria, envoltoriaBanda } from './diesel-bandas';
import { PRESETS } from '../src/engines/diesel/presets';
import { render as renderTravado } from './diesel-ouvido-render';
import { lerOpcoes, iniciarSementes, sementeBase, avaliarDesvios, imprimirAvaliacao, type Medida } from './desvios';

const AQUI = fileURLToPath(import.meta.url);
const RAIZ = path.resolve(path.dirname(AQUI), '..');
const RETRATO = path.join(path.dirname(AQUI), 'diesel-desvios.json');
type Linha = LinhaDiesel;

const quente = (d) => d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } });
const liga = (d) => d.message({ type: 'input', ignition: true });
const faixa = (v: number, a: number, b: number) => v >= a && v <= b;
const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '—');

// rotação travada a plena carga (combustível 1 com o limite de fumaça, turbo cheio), como a sonda de potência
const plena = (rpm: number, boost: number, s = 3): Cenario => ({
  eventos: [[0, (d) => { quente(d); d.state = 'run'; d.runT = 30; d.lockOmega = true; d.sonda = true; d.fuelCmd = 1; d.fuelM = 1; d.omega = (rpm * Math.PI * 2) / 60; d.rpmAvg = rpm; d.tw = 0.95; d.turboW = 0.95; d.boostFixo = boost + (d.soprador0 ? d.soprador0(rpm) : 0); d.tEsc = 500; }], [s, null]],
  portador: 'nenhum0',
});
const lentaQ = (s = 30): Cenario => ({ eventos: [[0, (d) => { quente(d); liga(d); }], [s, null]], portador: 'nenhum0' });
const carga = (s: number): Cenario => ({ eventos: [[0, (d) => { quente(d); liga(d); }], [3, (d) => { d.message({ type: 'input', shift: 1 }); d.message({ type: 'input', throttle: 1 }); }], [s, null]], portador: 'carro' });
const loco = (n: number, s = 40): Cenario => ({ eventos: [[0, (d) => { quente(d); liga(d); }], [3, (d) => d.message({ type: 'diesel', notch: n })], [s, null]], portador: 'locomotiva' });
const ger = (g: number, a = 8, s = 24): Cenario => ({ eventos: [[0, (d) => { quente(d); liga(d); }], [a, (d) => d.message({ type: 'diesel', degrau: g })], [s, null]], portador: 'gerador' });
const mono = (r, t0: number, t1: number) => { const a = Math.floor(t0 * SR), b = Math.floor(t1 * SR), x = new Float64Array(b - a); for (let i = 0; i < x.length; i++) x[i] = 0.5 * (r.L[a + i] + r.R[a + i]); return x; };
const med = (tl, k) => media(tl.map((e) => e[k]));
/** bandas relativas a 150–400 Hz, centroide, curtose, p90/p10, tiques e CV de um trecho (tools/diesel-bandas.ts) */
const medir = (id: string, cen: Cenario, ouvinte: string, t0: number, t1: number, port?: string) => {
  const sp = preset(id), r = renderizar(sp, cen, { ouvinte, portador: port });
  const rpm = med(trecho(r.tele, t0, t1), 'rpm');
  return analisar(mono(r, t0, t1), SR, rpm, sp.cylinders, sp.tempos);
};

// ------------------------------------------------------------------ grupos
// tabela 2.5: pressão de pico, ângulo, dp/dθ, temperatura na abertura do escape e gás no coletor (a dispersão de ciclo a
// ciclo é sorteada: 3 sementes, T-DSL-02). `pressoes-a`: picape, caminhão e Jake; `pressoes-b`: EMD; `pressoes-c`: GE
function pressoes(g: string): Linha[] {
  const L: Linha[] = [];
  const caso = (nome: string, id: string, cen: Cenario, t0: number, t1: number, al: { p: [number, number]; ang?: [number, number]; dp: [number, number]; tevo?: [number, number]; egt?: [number, number] }, port?: string) => {
    const r = renderizar(preset(id), cen, { portador: port });
    const tl = trecho(r.tele, t0, t1);
    const p = med(tl, 'pMax'), ang = med(tl, 'ang'), dp = med(tl, 'dpdth'), tevo = med(tl, 'tEvo'), egt = tl[tl.length - 1].exhT;
    L.push({ grupo: g, nome: `${nome}: p_max`, alvo: `${al.p[0]}–${al.p[1]} bar`, medido: `${f1(p)} bar`, ok: faixa(p, al.p[0], al.p[1]), valor: p, unidade: 'bar' });
    if (al.ang) L.push({ grupo: g, nome: `${nome}: ângulo do pico`, alvo: `${al.ang[0]}–${al.ang[1]}°`, medido: `${f1(ang)}°`, ok: faixa(ang, al.ang[0], al.ang[1]), valor: ang, unidade: '°' });
    L.push({ grupo: g, nome: `${nome}: dp/dθ máx`, alvo: `${al.dp[0]}–${al.dp[1]} bar/°`, medido: `${f1(dp)} bar/°`, ok: faixa(dp, al.dp[0], al.dp[1]), valor: dp, unidade: 'bar/°' });
    if (al.tevo) L.push({ grupo: g, nome: `${nome}: T na abertura do escape`, alvo: `${al.tevo[0]}–${al.tevo[1]} K`, medido: `${tevo.toFixed(0)} K`, ok: faixa(tevo, al.tevo[0], al.tevo[1]), valor: tevo, unidade: 'K' });
    if (al.egt) L.push({ grupo: g, nome: `${nome}: gás no coletor`, alvo: `${al.egt[0]}–${al.egt[1]} °C`, medido: `${egt.toFixed(0)} °C`, ok: faixa(egt, al.egt[0], al.egt[1]), valor: egt, unidade: '°C' });
    return r;
  };
  const n8: Cenario = { eventos: [[0, (d) => { quente(d); liga(d); }], [3, (d) => d.message({ type: 'diesel', notch: 8 })], [40, null]], portador: 'locomotiva' };
  if (g === 'pressoes-a') {
    caso('picape lenta quente (hilux28)', 'hilux28', lentaQ(30), 20, 30, { p: [45, 60], ang: [3, 8], dp: [3, 6], tevo: [600, 750], egt: [150, 250] });
    caso('picape lenta fria −10 °C (hilux28)', 'hilux28', { eventos: [[0, (d) => { d.lentaFixa = 800; d.message({ type: 'input', temp: { mode: 'fixed', value: -10 } }); liga(d); }], [30, null]], portador: 'nenhum0' }, 20, 30,
      { p: [40, 55], ang: [8, 15], dp: [5, 9], tevo: [550, 700], egt: [100, 180] });
    caso('picape plena 3000 rpm, 2,4 bar (hilux28)', 'hilux28', plena(3000, 1.4, 25), 20, 25, { p: [140, 180], ang: [10, 14], dp: [5, 8], tevo: [1100, 1300], egt: [550, 700] });
    caso('caminhão lenta 600 rpm (catc15)', 'catc15', lentaQ(30), 20, 30, { p: [50, 65], ang: [3, 8], dp: [3, 5], tevo: [600, 700], egt: [150, 200] });
    caso('caminhão plena 1900 rpm, 2,7 bar (catc15)', 'catc15', plena(1900, 1.7, 25), 20, 25, { p: [160, 200], ang: [10, 14], dp: [6, 9], tevo: [1150, 1300], egt: [550, 650] });
    // Jake a 1900 rpm sem combustível: o ar comprimido no PMS
    const rj = renderizar(preset('catc15'), { eventos: [[0, (d) => { quente(d); d.state = 'run'; d.runT = 30; d.lockOmega = true; d.omega = (1900 * Math.PI * 2) / 60; d.rpmAvg = 1900; d.message({ type: 'diesel', freioMotor: true }); }], [4, null]], portador: 'nenhum0' });
    const pj = media(trecho(rj.tele, 2, 4).map((e) => e.pMax));
    L.push({ grupo: g, nome: 'Jake a 1900 rpm (catc15): pressão no PMS', alvo: '35–50 bar', medido: `${f1(pj)} bar`, ok: faixa(pj, 35, 50), valor: pj, unidade: 'bar' });
  } else if (g === 'pressoes-b') {
    caso('EMD 710 lenta 269 rpm', 'emd710', lentaQ(30), 20, 30, { p: [40, 55], ang: [5, 10], dp: [2, 4], tevo: [650, 750], egt: [180, 250] }, 'locomotiva');
    caso('EMD 710 notch 8', 'emd710', n8, 32, 40, { p: [115, 135], ang: [10, 14], dp: [4, 7], tevo: [1050, 1200], egt: [480, 560] });
  } else {
    caso('GE 7FDL lenta 440 rpm', 'ge7fdl', lentaQ(30), 20, 30, { p: [35, 50], dp: [2, 4], egt: [150, 250] }, 'locomotiva');
    caso('GE 7FDL notch 8', 'ge7fdl', n8, 32, 40, { p: [125, 145], dp: [4, 7], egt: [480, 560] });
  }
  return L;
}

// bandas relativas a 150–400 Hz contra as referências internas do DIESEL.md (2.6, Apêndice A: vídeos do YouTube, vários
// lo-fi): cofre da picape, Cummins fria, escape do caminhão, faixa de nível dos leves. O alvo principal é o real3 (abaixo).
// `bandas-a`: o cofre da picape (curtose, p90/p10 e tiques são contagem e contraste: 3 sementes); `bandas-b`: o resto
function bandas(g: string): Linha[] {
  const L: Linha[] = [];
  const add = (nome: string, alvo: string, v: number, a: number, b: number, unidade = 'dB') => L.push({ grupo: g, nome, alvo, medido: f1(v), ok: faixa(v, a, b), valor: v, unidade });
  if (g === 'bandas-a') {
    // leve, cofre, lenta quente com piloto (Hilux 1GD/1KD)
    const h = medir('hilux28', lentaQ(12), 'bay', 6, 12);
    add('leve · cofre · hilux28 lenta: 1–2,5 kHz', '+4 ± 6 dB', h.b1k, -2, 10);
    add('leve · cofre · hilux28 lenta: 2,5–6 kHz', '−3 ± 3 dB', h.b25k, -6, 0);
    add('leve · cofre · hilux28 lenta: centroide', '1000–1500 Hz', h.cen, 1000, 1500, 'Hz');
    add('leve · cofre · hilux28 lenta: 1–4 kHz', '+5 ± 6 dB', h.k14, -1, 11);
    add('leve · cofre · hilux28 lenta: curtose 1–4 kHz', '6–9', h.curtose, 6, 9, '');
    add('leve · cofre · hilux28 lenta: p90/p10', '15 ± 3 dB', h.p9010, 12, 18);
    add('leve · cofre · hilux28 lenta: tiques por evento', '2–4', h.tiquesPorEvento, 2, 4, '');
    // frio: à mesma rotação, a banda 1–4 kHz sobe 8 ± 3 dB
    const hf = medir('hilux28', { eventos: [[0, (d) => { d.lentaFixa = 780; d.message({ type: 'input', temp: { mode: 'fixed', value: -10 } }); liga(d); }], [12, null]], portador: 'nenhum0' }, 'bay', 6, 12);
    const sobe = hf.ref + hf.k14 - (h.ref + h.k14);
    add('leve · cofre · hilux28 a −10 °C: 1–4 kHz sobe', '+8 ± 3 dB', sobe, 5, 11);
    return L;
  }
  // leve, exterior, lenta fria (Cummins 6.7 a −23 °C, 1000 rpm)
  const c = medir('ram67', { eventos: [[0, (d) => { d.ambientT = -23; d.message({ type: 'input', temp: { mode: 'fixed', value: -23 } }); liga(d); }], [12, null]], portador: 'nenhum0' }, 'ext', 6, 12);
  add('leve · exterior · ram67 lenta fria: 1–2,5 kHz', '−8 ± 4 dB', c.b1k, -12, -4);
  add('leve · exterior · ram67 lenta fria: centroide', '270–450 Hz', c.cen, 270, 450, 'Hz');
  add('leve · exterior · ram67 lenta fria: 1–4 kHz', '−8 ± 4 dB', c.k14, -12, -4);
  // pesado, atrás do escape (caminhão em lenta)
  const q = medir('catc15', lentaQ(12), 'pipe', 6, 12);
  add('pesado · escape · catc15 lenta: 60–150 Hz', '+11 ± 3 dB', q.b60, 8, 14);
  add('pesado · escape · catc15 lenta: 1–2,5 kHz', '≤ −18 dB', q.b1k, -40, -18);
  add('pesado · escape · catc15 lenta: centroide', '125–200 Hz', q.cen, 125, 200, 'Hz');
  // os 8 leves dentro de uma faixa de 12 dB em lenta (câmera atrás)
  const niveis = PRESETS.filter((p) => p.family === 'leve').map((p) => { const r = renderizar(preset(p.id), lentaQ(10), { ouvinte: 'ext' }); return analisar(mono(r, 6, 10), SR).nivel; });
  const fx = Math.max(...niveis) - Math.min(...niveis);
  L.push({ grupo: g, nome: 'os 8 leves em lenta (câmera atrás): faixa de nível', alvo: '≤ 12 dB', medido: `${f1(fx)} dB`, ok: fx <= 12, valor: fx, unidade: 'dB' });
  // ext em lenta → plena carga a 55%: +18 a +25 dB
  const hl = renderizar(preset('hilux28'), lentaQ(10), { ouvinte: 'ext' }), hp = renderizar(preset('hilux28'), plena(4400 * 0.55, 1.4 * 0.4, 6), { ouvinte: 'ext' });
  const dn = analisar(mono(hp, 3, 6), SR).nivel - analisar(mono(hl, 6, 10), SR).nivel;
  L.push({ grupo: g, nome: 'hilux28 câmera atrás: lenta → plena carga a 55%', alvo: '+18 a +25 dB', medido: `${f1(dn)} dB`, ok: faixa(dn, 18, 25), valor: dn, unidade: 'dB' });
  return L;
}

// Classes do real3 (o RESUMO.md das 25 gravações de banda ≥ 15 kHz, grave presente, rpm conferido, se perdeu com a pasta
// de rascunho: AUDITORIA T-DSL-03; os números ficam aqui). Só razões entre bandas (vários vídeos têm controle automático
// de ganho). Tolerância: a faixa entre arquivos da classe ±2 dB (n ≥ 2) ou ±5 dB (n = 1); centroide na faixa da
// classe; CV do knock (std(Δa)/(√2·média) por ignição) na faixa da classe ±0,03. O simulado de cada classe é a média
// dos presets indicados. Uma classe por grupo (`real3-a` … `real3-h`), 3 sementes (o CV); os tons do turbo em `real3-tom`
type Classe = { nome: string; casos: [string, Cenario, string, number, number, string?][]; b: [number, number][]; cen: [number, number]; cv: [number, number] };
const r3 = (lo: number, hi: number, n = 2): [number, number] => (n >= 2 ? [lo - 2, hi + 2] : [lo - 5, hi + 5]);
const CLASSES: Record<string, Classe[]> = {
  'real3-a': [
    { nome: 'picape lenta (hilux28, ranger32, ram67)', casos: [['hilux28', lentaQ(14), 'ext', 6, 14], ['ranger32', lentaQ(14), 'ext', 6, 14], ['ram67', lentaQ(14), 'ext', 6, 14]],
      b: [r3(-12.7, 11.3), r3(-1.2, 13.9), r3(-14.4, -0.5), r3(-11, -0.1), r3(-20.2, -1.7), r3(-21.6, -9)], cen: [214, 1114], cv: [0.135, 0.32] },
  ],
  'real3-b': [
    { nome: 'caminhão lenta (catc15, volvod13)', casos: [['catc15', lentaQ(14), 'ext', 6, 14], ['volvod13', lentaQ(14), 'ext', 6, 14]],
      b: [r3(-6.3, 0.7), r3(3.2, 8), r3(-0.5, 5), r3(-2.7, 4), r3(-12.2, -5.7), r3(-22.4, -13)], cen: [502, 988], cv: [0.125, 0.25] },
  ],
  'real3-c': [
    { nome: 'caminhão carga, cabine (scaniav8)', casos: [['scaniav8', carga(40), 'int', 20, 40]],
      b: [r3(-23.6, 9.1), r3(1.7, 8.3), r3(-7.2, -2.5), r3(-13, -6.6), r3(-20.6, -8.4), r3(-38.4, -17.3)], cen: [244, 711], cv: [0.166, 0.39] },
    { nome: 'ônibus carga (onibusisl)', casos: [['onibusisl', carga(14), 'ext', 6, 14]],
      b: [r3(-8.4, -1.9), r3(-3.6, 6), r3(-4.9, 0.8), r3(-12.5, 1), r3(-17.6, -5.8), r3(-29.4, -14)], cen: [242, 1017], cv: [0.14, 0.27] },
  ],
  'real3-d': [
    { nome: 'gerador sem carga (gen500)', casos: [['gen500', ger(0), 'ext', 14, 24, 'gerador']],
      b: [r3(-14.6, -14.6, 1), r3(-1.7, -1.7, 1), r3(-1.6, -1.6, 1), r3(-5.1, -5.1, 1), r3(-9.9, -9.9, 1), r3(-11.6, -11.6, 1)], cen: [500, 1000], cv: [0.16, 0.22] },
    { nome: 'gerador com carga (gen500)', casos: [['gen500', ger(1), 'ext', 14, 24, 'gerador']],
      b: [r3(-11.7, -11.7, 1), r3(5.8, 5.8, 1), r3(-3.5, -3.5, 1), r3(-11.8, -11.8, 1), r3(-15.7, -15.7, 1), r3(-22.5, -22.5, 1)], cen: [160, 330], cv: [0.19, 0.25] },
  ],
  'real3-e': [
    { nome: 'locomotiva lenta (emd710)', casos: [['emd710', loco(0), 'ext', 25, 40, 'locomotiva']],
      b: [r3(-18.4, 4.8), r3(-2.5, 4.4), r3(-0.9, 1.8), r3(-9.5, -0.7), r3(-14.5, 4.6), r3(-17.8, 3.5)], cen: [481, 2244], cv: [0.12, 0.38] },
  ],
  'real3-f': [
    { nome: 'EMD notch 8 (emd710)', casos: [['emd710', loco(8), 'ext', 30, 40, 'locomotiva']],
      b: [r3(1.2, 8.5), r3(14.2, 16.3), r3(-5.5, -0.4), r3(-12, 0.2), r3(-5.8, 1.1), r3(-8.7, 4.7)], cen: [340, 3547], cv: [0.16, 0.30] },
  ],
  'real3-g': [
    { nome: 'GE 7FDL notch 8 (ge7fdl)', casos: [['ge7fdl', loco(8), 'ext', 30, 40, 'locomotiva']],
      b: [r3(-2, -2, 1), r3(5.4, 5.4, 1), r3(-3, -3, 1), r3(-4.5, -4.5, 1), r3(-9.5, -9.5, 1), r3(-21.2, -21.2, 1)], cen: [330, 610], cv: [0.24, 0.30] },
  ],
};
function real3(g: string): Linha[] {
  const L: Linha[] = [];
  const nomes = ['30–60', '60–150', '400–1k', '1–2,5k', '2,5–6k', '6–12k'];
  for (const k of CLASSES[g]) {
    const an = k.casos.map(([id, cen, ouv, t0, t1, port]) => medir(id, cen, ouv, t0, t1, port));
    const m = (f: (a: any) => number) => media(an.map(f));
    const v = [m((a) => a.b30), m((a) => a.b60), m((a) => a.b400), m((a) => a.b1k), m((a) => a.b25k), m((a) => a.b6k)];
    v.forEach((x, i) => L.push({ grupo: g, nome: `real3 · ${k.nome}: ${nomes[i]}`, alvo: `${k.b[i][0].toFixed(1)} a ${k.b[i][1].toFixed(1)} dB`, medido: f1(x), ok: faixa(x, k.b[i][0], k.b[i][1]), valor: x, unidade: 'dB' }));
    const ce = m((a) => a.cen), cv = m((a) => a.cv);
    L.push({ grupo: g, nome: `real3 · ${k.nome}: centroide`, alvo: `${k.cen[0]}–${k.cen[1]} Hz`, medido: `${ce.toFixed(0)} Hz`, ok: faixa(ce, k.cen[0], k.cen[1]), valor: ce, unidade: 'Hz' });
    L.push({ grupo: g, nome: `real3 · ${k.nome}: CV do knock`, alvo: `${k.cv[0].toFixed(2)}–${k.cv[1].toFixed(2)}`, medido: cv.toFixed(2), ok: faixa(cv, k.cv[0], k.cv[1]), valor: cv, unidade: '' });
  }
  return L;
}
// apito do turbo (RESUMO.md, tons estreitos 2–20 kHz): caminhão em carga sem tom proeminente; VGT do Cummins 6.7 em
// lenta com tom forte em ~7 kHz; EMD em notch 8 com o "grito" do turbo. 3 sementes: a saliência de um tom sobre a mediana
// em volta segue a realização do ruído (com uma semente só, o apito do caminhão ia de −49 a −36 dB)
function real3Tom(g: string): Linha[] {
  const tom = (id: string, cen: Cenario, ouv: string, t0: number, t1: number, port?: string, f0 = 2000, f1x = 20000) => {
    const rr = renderizar(preset(id), cen, { ouvinte: ouv, portador: port });
    const [f, P] = welch(mono(rr, t0, t1), SR, 32768), Ld = Array.from(P, (q) => 10 * Math.log10(q + 1e-30));
    let best = -99, fb = 0;
    for (let k2 = 0; k2 < f.length; k2++) {
      if (f[k2] < f0 || f[k2] > f1x) continue;
      const w: number[] = []; for (let j = k2 - 40; j <= k2 + 40; j++) if (j >= 0 && j < Ld.length) w.push(Ld[j]);
      w.sort((a, b) => a - b); const pr = Ld[k2] - w[w.length >> 1]; if (pr > best) { best = pr; fb = f[k2]; }
    }
    // nível do tom relativo à banda das ordens (150–400 Hz), como no índice do acervo: potência em ±2% do pico
    let pt = 0, pb = 0;
    for (let k2 = 0; k2 < f.length; k2++) { if (f[k2] >= 0.98 * fb && f[k2] <= 1.02 * fb) pt += P[k2]; if (f[k2] >= 150 && f[k2] < 400) pb += P[k2]; }
    return { best, fb, rel: 10 * Math.log10(pt / (pb + 1e-30) + 1e-30) };
  };
  const t1 = tom('scaniav8', carga(40), 'int', 20, 40), t2 = tom('ram67', lentaQ(14), 'ext', 6, 14, undefined, 5000, 9000), t3 = tom('emd710', loco(8), 'ext', 30, 40, 'locomotiva', 3500, 17500);
  // (4ª passada: o caminhão em carga tem o apito, um tom fino; o que não pode é passar do da gravação do Cat C15 na
  // cabine, 20 dB abaixo da banda das ordens. Ver também o grupo `ar`)
  return [
    { grupo: g, nome: 'real3 · turbo: apito do caminhão em carga, na cabine', alvo: '≤ −20 dB re 150–400 Hz', medido: `${t1.rel.toFixed(0)} dB em ${(t1.fb / 1000).toFixed(1)} kHz`, ok: t1.rel <= -20, valor: t1.rel, unidade: 'dB' },
    { grupo: g, nome: 'real3 · turbo: VGT do Cummins 6.7 em lenta', alvo: '+17 a +24 dB em ~7 kHz', medido: `+${t2.best.toFixed(0)} dB em ${(t2.fb / 1000).toFixed(1)} kHz`, ok: faixa(t2.best, 14, 27), valor: t2.best, unidade: 'dB' },
    { grupo: g, nome: 'real3 · turbo: EMD em notch 8', alvo: '+19,5 dB (3,6–17 kHz)', medido: `+${t3.best.toFixed(0)} dB em ${(t3.fb / 1000).toFixed(1)} kHz`, ok: faixa(t3.best, 14, 26), valor: t3.best, unidade: 'dB' },
  ];
}

// Envoltória do agudo (REVISAO-DE-SOM.md: "ruído contínuo que sobe com o giro e enche o silêncio entre as explosões
// soa como mar: exigir modulação"; 3ª passada do Diesel, TECNICO.md). Em carga: o contraste p90/p10 da envoltória de
// 2–6 kHz (envoltoriaBanda) não pode ficar abaixo do das gravações do real3 da mesma classe, −1 dB (ruído liso pela
// mesma cadeia: 6,1 dB). Desde a 4ª passada o critério é de um lado só: a gravação é piso de pulso (viés do dono, "mais
// motor, menos ar"; o tools/ouvido trata igual), e ficar mais pulsado que ela não reprova. Na lenta: o fundo mecânico
// (ruído liso) não pode ser o que enche o vão entre as explosões em 1–4 kHz (amostras abaixo do p30 da envoltória de
// 1–4 kHz do motor inteiro): no máximo metade da energia ali. 3 sementes; `envoltoria-a`: carga dos veículos e do
// gerador; `envoltoria-b`: GE; `envoltoria-c`: EMD; `envoltoria-d`: o fundo da lenta
function envoltoria(g: string): Linha[] {
  const L: Linha[] = [];
  // [nome, preset, cenário, ouvinte, t0, t1, faixa, portador]; faixas: as gravações da classe (real3), ±1 dB
  const C: [string, string, Cenario, string, number, number, [number, number], string?][] = ({
    'envoltoria-a': [
      ['picape acelerando (ram67; Cummins 6.7 11,6, TDI 13,4)', 'ram67', carga(14), 'ext', 9, 14, [10.6, 14.4]],
      ['caminhão carga, cabine (scaniav8; ERF 11,1, FH16 10,1, Scania 18,3)', 'scaniav8', carga(14), 'int', 9, 14, [9.1, 19.3]],
      ['ônibus carga (onibusisl; Bedford 8,1, K360 9,3, OF-1519 12,2)', 'onibusisl', carga(14), 'ext', 9, 14, [7.1, 13.2]],
      ['gerador com carga (gen500; Cummins 2500 kW 8,3)', 'gen500', ger(1, 6, 16), 'ext', 10, 16, [7.3, 9.3], 'gerador'],
    ],
    'envoltoria-b': [['GE 7FDL notch 8 (ge7fdl; U23B 9,7)', 'ge7fdl', loco(8, 30), 'ext', 22, 30, [8.7, 10.7], 'locomotiva']],
    'envoltoria-c': [['EMD notch 8 (emd710; SD70ACe 7,6 e 9,9)', 'emd710', loco(8, 30), 'ext', 22, 30, [6.6, 10.9], 'locomotiva']],
  } as Record<string, [string, string, Cenario, string, number, number, [number, number], string?][]>)[g] ?? [];
  for (const [nome, id, cen, ouv, t0, t1, fx, port] of C) {
    const sp = preset(id), rr = renderizar(sp, cen, { ouvinte: ouv, portador: port });
    const rpm = med(trecho(rr.tele, t0, t1), 'rpm'), fIgn = (rpm / 60) * sp.cylinders * (2 / sp.tempos);
    const e = envoltoriaBanda(mono(rr, t0, t1), SR, 2000, 6000, fIgn);
    L.push({ grupo: g, nome: `envoltória · ${nome}: p90/p10 de 2–6 kHz`, alvo: `≥ ${fx[0].toFixed(1)} dB (gravações até ${fx[1].toFixed(1)})`, medido: `${f1(e.p9010)} dB`, ok: e.p9010 >= fx[0], valor: e.p9010, unidade: 'dB' });
  }
  if (g !== 'envoltoria-d') return L;
  // lenta: parte do vão de 1–4 kHz que é o fundo mecânico liso (motor inteiro − motor sem o fundo; a semente do ruído
  // segue igual, então a diferença é o fundo)
  for (const id of ['hilux28', 'catc15']) {
    const sp = preset(id);
    const a = renderizar(sp, lentaQ(14)), b = renderizar(sp, { eventos: [[0, (d) => { quente(d); liga(d); (d as any).fundoAmp = [0, 0]; }], [14, null]], portador: 'nenhum0' });
    const x = mono(a, 6, 14), y = mono(b, 6, 14);
    const ea = bandaEEnvoltoria(x, SR, 1000, 4000, 150), yb = bandaEEnvoltoria(y, SR, 1000, 4000, 150).y;
    const ord = Float64Array.from(ea.env).sort(), lim = ord[Math.floor(0.3 * (ord.length - 1))];
    let et = 0, ef = 0;
    for (let i = 0; i < x.length; i++) if (ea.env[i] < lim) { et += ea.y[i] * ea.y[i]; const df = ea.y[i] - yb[i]; ef += df * df; }
    const fr = 10 * Math.log10(ef / (et + 1e-30) + 1e-30);
    L.push({ grupo: g, nome: `envoltória · ${id} lenta: fundo mecânico liso no vão de 1–4 kHz`, alvo: '≤ −3 dB', medido: `${f1(fr)} dB`, ok: fr <= -3, valor: fr, unidade: 'dB' });
  }
  return L;
}

// "Mais motor, menos ar" (viés do dono, docs/PLANO.md; 4ª passada do Diesel, TECNICO.md). Com o giro travado e a mesma
// semente do gerador de ruído, o motor inteiro e o motor sem uma fonte diferem só pela fonte:
//  · as fontes de ar contínuas (jato da boca, chiado da admissão, sopro do compressor, banda larga da turbina,
//    wastegate, fundo mecânico) juntas mudam o nível ponderado A em menos de 1,5 dB na lenta e em carga parcial (`ar-a`:
//    picapes, 300D e Cat C15; `ar-c`: Scania, ônibus, gerador e EMD);
//  · enquanto o turbo enche (degrau de carga com o giro travado; na locomotiva, da lenta ao notch 8), a banda larga do
//    turbo não sobe o total ponderado A em mais de 1 dB em nenhuma janela de 0,25 s (`ar-b`, 3 sementes: é transiente);
//  · o apito do turbo é um componente estreito: em carga, o pico dele fica 10 dB ou mais acima do fundo em volta (`ar-b`;
//    a saliência do tom sobre a mediana em volta muda até 4 dB com a semente).
function ar(g: string): Linha[] {
  const L: Linha[] = [];
  const pondA = (x: Float32Array | Float64Array, n = 8192) => {
    const [f, P] = welch(x, SR, n);
    let s = 0;
    for (let k = 1; k < f.length; k++) { const q = f[k] * f[k], ra = (12194 ** 2 * q * q) / ((q + 20.6 ** 2) * Math.sqrt((q + 107.7 ** 2) * (q + 737.9 ** 2)) * (q + 12194 ** 2)); s += P[k] * ra * ra * 1.585; }
    return 10 * Math.log10(s + 1e-30);
  };
  const op = (o: any) => ({ dur: 6, ouvinte: 'ext', ambiente: false, campo: {}, sem: [] as string[], escala: [] as [string, number][], ...o });
  if (g === 'ar-a' || g === 'ar-c') {
    const CONT = ['jato', 'chiadoAdm', 'sopro', 'turbina', 'wastegate', 'fundo'];
    // [preset, rotação de carga parcial, combustível]
    const C: [string, number, number][] = g === 'ar-a' ? [['hilux28', 2200, 0.35], ['ram67', 1800, 0.35], ['om617', 2500, 0.4], ['catc15', 1400, 0.35]]
      : [['scaniav8', 1300, 0.35], ['onibusisl', 1500, 0.35], ['gen500', 1800, 0.4], ['emd710', 680, 0.5]];
    for (const [id, rpm, comb] of C) {
      const sp = preset(id);
      for (const [nome, o] of [['lenta', { rpm: sp.idle }], [`${rpm} rpm com ${Math.round(comb * 100)}% de carga`, { rpm, comb }]] as [string, any][]) {
        const a = renderTravado(id, op(o)), b = renderTravado(id, op({ ...o, comb: a.info.comb, sem: CONT }));
        const d = pondA(a.m) - pondA(b.m);
        L.push({ grupo: g, nome: `ar · ${id} ${nome}: fontes de ar contínuas no nível ponderado A`, alvo: '< 1,5 dB', medido: `${f1(d)} dB`, ok: Math.abs(d) < 1.5, valor: d, unidade: 'dB' });
      }
    }
    return L;
  }
  // enchimento do turbo
  const T: [string, any][] = [['catc15 de fora', { id: 'catc15', rpm: 1400, degrau: [0.12, 1, 2], dur: 8 }], ['catc15 na cabine', { id: 'catc15', rpm: 1400, degrau: [0.12, 1, 2], dur: 8, ouvinte: 'int' }],
    ['scaniav8', { id: 'scaniav8', rpm: 1300, degrau: [0.12, 1, 2], dur: 8 }], ['hilux28', { id: 'hilux28', rpm: 2400, degrau: [0.08, 1, 2], dur: 7 }], ['ram67', { id: 'ram67', rpm: 2000, degrau: [0.08, 1, 2], dur: 7 }],
    ['gen500', { id: 'gen500', rpm: 1800, degrau: [0.1, 0.9, 2], dur: 8 }], ['emd710 da lenta ao notch 8', { id: 'emd710', cenario: 'n8', de: 0, ate: 24 }]];
  for (const [nome, { id, ...o }] of T) {
    const a = renderTravado(id, op(o)), b = renderTravado(id, op({ ...o, sem: ['turboLargo'] }));
    const jan = Math.round(0.25 * SR), t0 = Math.round(((o.degrau ? o.degrau[2] : 3)) * SR);
    let pior = -99;
    for (let i = t0; i + jan <= a.m.length; i += jan >> 1) pior = Math.max(pior, pondA(a.m.subarray(i, i + jan), 4096) - pondA(b.m.subarray(i, i + jan), 4096));
    L.push({ grupo: g, nome: `ar · turbo enchendo (${nome}): a banda larga do turbo no total ponderado A`, alvo: '≤ 1 dB', medido: `${f1(pior)} dB`, ok: pior <= 1, valor: pior, unidade: 'dB' });
    // o apito no fim do transitório: pico entre 1,5 e 16 kHz sobre a mediana em volta
    const fim = a.m.subarray(a.m.length - Math.round(1.5 * SR));
    const [f, P] = welch(fim, SR, 8192), Ld = Array.from(P, (q) => 10 * Math.log10(q + 1e-30));
    let best = -99, fb = 0;
    for (let k = 0; k < f.length; k++) {
      if (f[k] < 1500 || f[k] > 16000) continue;
      const w: number[] = []; for (let j = k - 40; j <= k + 40; j++) if (j >= 0 && j < Ld.length) w.push(Ld[j]);
      w.sort((x, y) => x - y); const pr = Ld[k] - w[w.length >> 1]; if (pr > best) { best = pr; fb = f[k]; }
    }
    L.push({ grupo: g, nome: `ar · turbo cheio (${nome}): o apito é um tom fino`, alvo: '≥ 10 dB sobre o fundo em volta', medido: `+${best.toFixed(0)} dB em ${(fb / 1000).toFixed(1)} kHz`, ok: best >= 10, valor: best, unidade: 'dB' });
  }
  return L;
}

// fumaça no transiente (3.3): mecânico sem aneroide fumaça; eletrônico nunca passa de 1,25. 3 sementes; `fumaca-a`: os
// leves; `fumaca-b`: a GE
// subindo notch a notch
function fumaca(g: string): Linha[] {
  const L: Linha[] = [];
  if (g === 'fumaca-a') {
    const piso = (id: string, port = 'carro') => {
      const r = renderizar(preset(id), { eventos: [[0, (d) => { quente(d); liga(d); }], [4, (d) => d.message({ type: 'input', throttle: 1 })], [8, null]], portador: port }, { tele: 256 });
      const tl = trecho(r.tele, 4, 8);
      const dur = tl.filter((e) => e.lambdaInst < 1.3 && e.fuel > 0.05).length * (256 / SR);
      return { dur, min: Math.min(...tl.map((e) => e.lambdaInst)) };
    };
    const f = piso('f1000mwm');
    L.push({ grupo: g, nome: 'f1000mwm pé no fundo da lenta: λ < 1,3', alvo: '0,5–1,5 s', medido: `${f.dur.toFixed(2)} s (λ mín ${f.min.toFixed(2)})`, ok: faixa(f.dur, 0.5, 1.5), valor: f.dur, unidade: 's' });
    const h = piso('hilux28');
    L.push({ grupo: g, nome: 'hilux28 pé no fundo da lenta: λ mínimo', alvo: '≥ 1,25', medido: h.min.toFixed(2), ok: h.min >= 1.24, valor: h.min, unidade: '' });
    return L;
  }
  // GE subindo notch a notch
  const ev: any[] = [[0, (d) => { quente(d); liga(d); }]];
  for (let n = 1; n <= 8; n++) ev.push([5 + (n - 1) * 8, (d) => d.message({ type: 'diesel', notch: n })]);
  ev.push([69, null]);
  const r = renderizar(preset('ge7fdl'), { eventos: ev, portador: 'locomotiva' }, { tele: 1024 });
  const durs: number[] = [];
  for (let n = 2; n <= 8; n++) durs.push(trecho(r.tele, 5 + (n - 1) * 8, 5 + n * 8).filter((e) => e.lambdaInst < 1.3).length * (1024 / SR));
  const dm = media(durs);
  L.push({ grupo: g, nome: 'ge7fdl subindo cada notch: λ < 1,3', alvo: '2–4 s por notch', medido: `${dm.toFixed(2)} s em média (${durs.map((x) => x.toFixed(1)).join(' ')})`, ok: faixa(dm, 2, 4), valor: dm, unidade: 's' });
  return L;
}

// freio-motor (3.4, passo 7); 3 sementes (o p90/p10 e a frenagem seguem a dispersão de ciclo a ciclo)
function jake(g: string): Linha[] {
  const L: Linha[] = [];
  const add = (nome: string, alvo: string, medido: string, ok: boolean, valor: number, unidade = 'dB') => L.push({ grupo: g, nome, alvo, medido, ok, valor, unidade });
  const sp = preset('catc15'), w = (1900 * Math.PI * 2) / 60;
  const trav = (freio: boolean, n = 6): Cenario => ({ eventos: [[0, (d) => { quente(d); d.state = 'run'; d.runT = 30; d.lockOmega = true; d.omega = w; d.rpmAvg = 1900; if (freio) d.message({ type: 'diesel', freioMotor: true, jakeCilindros: n }); }], [4, null]], portador: 'nenhum0' });
  const pl = renderizar(sp, plena(1900, 1.7, 4), { ouvinte: 'ext' });
  const ap = analisar(mono(pl, 2, 4), SR);
  const jk: any = {};
  for (const n of [2, 4, 6]) { const r = renderizar(sp, trav(true, n), { ouvinte: 'ext' }); jk[n] = { a: analisar(mono(r, 2, 4), SR), r }; }
  const j6 = jk[6].a;
  // torque de frenagem: o torque médio negativo dos gases + atrito (telemetria torque é max(0, …): usa o DSP)
  const frenagem = (r) => -(r.d.tqMean) * w / 1000;
  const kw6 = frenagem(jk[6].r), kw2 = frenagem(jk[2].r), kw4 = frenagem(jk[4].r);
  const d6 = j6.nivel - ap.nivel, a6 = (j6.ref + j6.b25k) - (ap.ref + ap.b25k);
  add('catc15 Jake 6 cil. a 1900 rpm: nível total vs plena carga', '+2 ± 2 dB', `${f1(d6)} dB`, faixa(d6, 0, 4), d6);
  add('catc15 Jake 6: 2,5–6 kHz vs plena carga', '+6 ± 3 dB', `${f1(a6)} dB`, faixa(a6, 3, 9), a6);
  add('catc15 Jake 6: p90/p10 da banda 1–4 kHz', '≥ 15 dB', `${f1(j6.p9010)} dB`, j6.p9010 >= 15, j6.p9010);
  add('catc15 Jake 6: potência de frenagem', `70–90% de ${sp.power} kW`, `${kw6.toFixed(0)} kW (${(kw6 / sp.power * 100).toFixed(0)}%)`, faixa(kw6 / sp.power, 0.7, 0.9), (100 * kw6) / sp.power, '%');
  add('catc15 Jake 4 cil.: potência', '≈ 60%', `${(kw4 / sp.power * 100).toFixed(0)}%`, faixa(kw4 / sp.power, 0.45, 0.75), (100 * kw4) / sp.power, '%');
  add('catc15 Jake 2 cil.: potência', '≈ 30%', `${(kw2 / sp.power * 100).toFixed(0)}%`, faixa(kw2 / sp.power, 0.2, 0.4), (100 * kw2) / sp.power, '%');
  const d2 = jk[2].a.nivel - j6.nivel, d4 = jk[4].a.nivel - j6.nivel;
  add('catc15 Jake 2 cil. vs 6: nível', '−5 dB', `${f1(d2)} dB`, faixa(d2, -8, -2), d2);
  add('catc15 Jake 4 cil. vs 6: nível', '−2 dB', `${f1(d4)} dB`, faixa(d4, -4, 0), d4);
  // Scania: freio de descarga
  const ss = preset('scaniav8'), ws = w;
  const soEsc = (c: Cenario): Cenario => ({ ...c, eventos: [[0, (d) => { c.eventos[0][1]!(d); d.params.mech = 0; d.params.intake = 0; d.params.air = 0; }], ...c.eventos.slice(1)] });
  const sem = renderizar(ss, soEsc(trav(false)), { ouvinte: 'ext' }), com = renderizar(ss, soEsc(trav(true)), { ouvinte: 'ext' });
  const dsd = analisar(mono(com, 2, 4), SR).nivel - analisar(mono(sem, 2, 4), SR).nivel;
  const kws = -(com.d.tqMean) * ws / 1000, fr = kws * 1000 / ws / ss.torque;
  add('scaniav8 freio de descarga: pulsos vs sem freio', '−15 a −20 dB', `${f1(dsd)} dB`, faixa(dsd, -20, -15), dsd);
  add('scaniav8 freio de descarga: torque de frenagem', '30–40% do máximo', `${(fr * 100).toFixed(0)}%`, faixa(fr, 0.3, 0.4), 100 * fr, '%');
  return L;
}

// potência medida depois da escala = ficha ±5% (rotação travada na rotação de potência, combustível 1)
function potencia(g: string): Linha[] {
  return PRESETS.map((p) => {
    const sp = preset(p.id), r = renderizar(sp, plena(sp.rpmPotencia, sp.boost, 3), { tele: 256 });
    // (média do último 1,5 s: o tqMean de um instante carrega a dispersão de ciclo a ciclo)
    const d = r.d, kw = (med(trecho(r.tele, 1.5, 3), 'torque') * d.omega) / 1000;
    return { grupo: g, nome: `${p.id}: potência a ${sp.rpmPotencia} rpm`, alvo: `${sp.power} kW ± 5%`, medido: `${kw.toFixed(0)} kW (${((kw / sp.power - 1) * 100).toFixed(1)}%)`, ok: Math.abs(kw / sp.power - 1) <= 0.05, valor: kw, unidade: 'kW' };
  });
}

// veículo: velocidades na marcha mais alta (`veiculo-a`, conta da ficha) e arrancada carregada (`veiculo-b`, 3 sementes;
// passo 11)
function veiculo(g: string): Linha[] {
  const L: Linha[] = [];
  if (g === 'veiculo-a') {
    const rpmEm = (id: string, kmh: number) => { const s = preset(id); const r = s.ratios[s.ratios.length - 1] * s.finalDrive; return ((kmh / 3.6) / s.wheelR) * r * 9.549; };
    const h = rpmEm('hilux28', 100), s = rpmEm('scaniav8', 85);
    L.push({ grupo: g, nome: 'hilux28 a 100 km/h em 6ª', alvo: '1700 ± 100 rpm', medido: `${h.toFixed(0)} rpm`, ok: Math.abs(h - 1700) <= 100, valor: h, unidade: 'rpm' });
    L.push({ grupo: g, nome: 'scaniav8 a 85 km/h em 12ª', alvo: '1250 ± 100 rpm', medido: `${s.toFixed(0)} rpm`, ok: Math.abs(s - 1250) <= 100, valor: s, unidade: 'rpm' });
    return L;
  }
  // Volvo carregado: 0–85 km/h com pé no fundo e o automático
  const r = renderizar(preset('volvod13'), { eventos: [[0, (d) => { quente(d); liga(d); }], [3, (d) => { d.message({ type: 'input', shift: 1 }); d.message({ type: 'input', throttle: 1 }); }], [123, null]], portador: 'carro' }, { tele: 4096 });
  const chega = r.tele.find((e) => e.kmh >= 85);
  const t85 = chega ? chega.t - 3 : Infinity;
  L.push({ grupo: g, nome: 'volvod13 carregado 0–85 km/h', alvo: '60–90 s', medido: Number.isFinite(t85) ? `${t85.toFixed(0)} s` : `não chegou (${Math.round(r.tele[r.tele.length - 1].kmh)} km/h em 120 s)`, ok: faixa(t85, 60, 90), valor: t85, unidade: 's' });
  return L;
}

// câmbio automático (troca pela rotação de potência do diesel): arrancada com pé no fundo e com meio pé, depois solta
// o pedal. A sequência de marchas tem de subir sem voltar, nos pontos de troca do diesel, e sem acelerar não sobe.
// 3 sementes; `cambio-a`: Hilux; `cambio-b`: Scania; `cambio-c`: Volvo
function cambio(g: string): Linha[] {
  const L: Linha[] = [];
  const caso = (id: string, ped: number, T: number, faixa0: [number, number]) => {
    const r = renderizar(preset(id), { eventos: [[0, (d) => { quente(d); liga(d); }], [3, (d) => { d.message({ type: 'input', shift: 1 }); d.message({ type: 'input', throttle: ped }); }], [3 + T, (d) => d.message({ type: 'input', throttle: 0 })], [13 + T, null]], portador: 'carro' }, { tele: 512 });
    const acel = r.tele.filter((e) => e.t >= 3 && e.t < 3 + T), solto = r.tele.filter((e) => e.t >= 3.5 + T);
    let volta = 0; const trocas: number[] = [];
    for (let i = 1; i < acel.length; i++) { if (acel[i].gear < acel[i - 1].gear && acel[i].gear > 0) volta++; if (acel[i].gear > acel[i - 1].gear && acel[i - 1].gear > 1) trocas.push(acel[i - 1].rpm); } // (a saída da 1ª, com a embreagem patinando, não conta)
    let sobeSolto = 0; for (let i = 1; i < solto.length; i++) if (solto[i].gear > solto[i - 1].gear) sobeSolto++;
    const gg = acel.map((e) => e.gear), fim = gg[gg.length - 1];
    const rm = trocas.length ? media(trocas) : NaN, mn = trocas.length ? Math.min(...trocas) : NaN, mx = trocas.length ? Math.max(...trocas) : NaN;
    L.push({ grupo: g, nome: `${id} pedal ${ped}: marchas sobem sem voltar`, alvo: 'monotônica', medido: `1ª → ${fim}ª, ${volta} reduções`, ok: volta === 0 && fim > 2, valor: [volta, fim], unidade: '', ordem: volta });
    // (o caso mediano é o da subida mais longe da faixa, para um lado ou para o outro)
    L.push({ grupo: g, nome: `${id} pedal ${ped}: rotação nas subidas`, alvo: `${faixa0[0]}–${faixa0[1]} rpm`, medido: `${mn.toFixed(0)}–${mx.toFixed(0)} rpm (média ${rm.toFixed(0)})`, ok: mn >= faixa0[0] && mx <= faixa0[1], valor: [mn, mx], unidade: 'rpm', ordem: Math.max(faixa0[0] - mn, mx - faixa0[1]) });
    L.push({ grupo: g, nome: `${id} pedal ${ped} → solto: não sobe sem acelerar`, alvo: '0 subidas', medido: `${sobeSolto}`, ok: sobeSolto === 0, valor: sobeSolto, unidade: '' });
  };
  if (g === 'cambio-a') { caso('hilux28', 1, 30, [2700, 3300]); caso('hilux28', 0.5, 40, [2200, 2700]); }
  if (g === 'cambio-b') { caso('scaniav8', 1, 80, [1350, 1700]); caso('scaniav8', 0.5, 80, [1250, 1500]); }
  if (g === 'cambio-c') caso('volvod13', 1, 80, [1300, 1600]);
  return L;
}

// nenhum NaN (nem Infinity) nos cenários de cada preset, em todas as amostras dos dois canais (tools/diesel-comum.ts); um
// processo por preset (`nan-<preset>`; AUDITORIA A7, T-DSL-12: o grupo inteiro num processo só era o que fazia o
// `teste:diesel` levar 11 a 20 min). O pico de saída vai na tabela, sem critério
// (nas locomotivas o cenário `notches`, 80 s, fica num processo à parte: `nan-<preset>-b`)
const NAN = PRESETS.flatMap((p) => (p.portadores[0] === 'locomotiva' ? [`nan-${p.id}`, `nan-${p.id}-b`] : [`nan-${p.id}`]));
function nan(g: string): Linha[] {
  const b = g.endsWith('-b'), id = g.slice(4, b ? -2 : undefined), sp = preset(id), port = sp.portadores[0];
  const cens = b ? ['notches'] : ['idle', 'rev', 'frio10', ...(port === 'locomotiva' ? [] : port === 'gerador' ? ['degraus'] : ['wot'])];
  const rs = cens.map((c) => renderizar(sp, c, { portador: c === 'wot' ? 'carro' : undefined, tele: 8192 }));
  const ruins = cens.filter((_, i) => rs[i].nan), pico = Math.max(...rs.map((r) => r.pico));
  return [{ grupo: g, nome: `${id}: ${cens.join(', ')}`, alvo: 'sem NaN', medido: ruins.length ? `NaN em ${ruins.join(', ')}` : `ok (pico ${pico.toFixed(2)})`, ok: !ruins.length, valor: ruins.length, unidade: '' }];
}

// Alvo do projeto (DIESEL.md, tabela 2.6, linha 3, e tabela 4.4) que o commit 3c0718a tirou do teste quando as classes do
// real3 entraram (AUDITORIA A6, T-DSL-04): o caminhão e o ônibus em lenta, de fora e de lado, e as duas locomotivas
// em lenta e em notch 8 contra as bandas do projeto (±4 dB por banda, centroide ±30%). Voltam como medidas, e o que
// não passa é desvio declarado no retrato; o real3 contradiz a tabela 4.4 nas locomotivas (T-DSL-03). `projeto-a`: os
// pesados (tiques por evento é contagem: 3 sementes); `projeto-b`: EMD; `projeto-c`: GE
function projeto(g: string): Linha[] {
  const L: Linha[] = [];
  const add = (nome: string, alvo: string, v: number, a: number, b: number, unidade = 'dB') => L.push({ grupo: g, nome, alvo, medido: f1(v), ok: faixa(v, a, b), valor: v, unidade });
  if (g === 'projeto-a') {
    // pesado, exterior de lado, lenta (C15, ônibus)
    for (const id of ['catc15', 'onibusisl']) {
      const p = medir(id, lentaQ(12), 'ext', 6, 12);
      add(`pesado · exterior · ${id} lenta: 1–2,5 kHz`, '−2,5 ± 2 dB', p.b1k, -4.5, -0.5);
      add(`pesado · exterior · ${id} lenta: 2,5–6 kHz`, '−5 a −18 dB', p.b25k, -18, -5);
      add(`pesado · exterior · ${id} lenta: centroide`, '600–900 Hz', p.cen, 600, 900, 'Hz');
      add(`pesado · exterior · ${id} lenta: 1–4 kHz`, '−2 ± 2 dB', p.k14, -4, 0);
      add(`pesado · exterior · ${id} lenta: tiques por evento`, '2–3 (±1)', p.tiquesPorEvento, 1, 4, '');
    }
    return L;
  }
  // locomotivas: lenta e notch 8 contra a tabela 4.4 (±4 dB por banda, centroide ±30%)
  const lc = (id: string, rotulo: string, notch: number, t: [number, number, number, number, number, number]) => {
    const a = medir(id, loco(notch), 'ext', 30, 40, 'locomotiva');
    const nomes = ['60–150', '400–1k', '1–2,5k', '2,5–6k', '6–12k'], v = [a.b60, a.b400, a.b1k, a.b25k, a.b6k];
    nomes.forEach((n, i) => add(`${rotulo}: ${n}`, `${t[i] > 0 ? '+' : ''}${t[i]} ± 4 dB`, v[i], t[i] - 4, t[i] + 4));
    add(`${rotulo}: centroide`, `${t[5]} Hz ± 30%`, a.cen, t[5] * 0.7, t[5] * 1.3, 'Hz');
  };
  if (g === 'projeto-b') {
    lc('emd710', 'EMD · lenta', 0, [8.4, 3.3, -6.6, -5.8, -13.3, 700]);
    lc('emd710', 'EMD · notch 8', 8, [2.7, 2.5, -4.2, -4.0, -10.5, 840]);
  } else {
    lc('ge7fdl', 'GE · lenta', 0, [13.0, -1.7, -11.0, -19.5, -28, 415]);
    lc('ge7fdl', 'GE · notch 8', 8, [15.8, -0.7, -7.6, -13.5, -23, 300]);
  }
  return L;
}

// ------------------------------------------------------------------ tabela dos grupos
const GOV = ['a', 'b', 'c', 'd'].map((p) => `governador-${p}`);
const GRUPOS: Record<string, (g: string) => Linha[] | Promise<Linha[]>> = {
  'pressoes-a': pressoes, 'pressoes-b': pressoes, 'pressoes-c': pressoes,
  'bandas-a': bandas, 'bandas-b': bandas,
  ...Object.fromEntries(Object.keys(CLASSES).map((g) => [g, real3])), 'real3-tom': real3Tom,
  'envoltoria-a': envoltoria, 'envoltoria-b': envoltoria, 'envoltoria-c': envoltoria, 'envoltoria-d': envoltoria,
  'ar-a': ar, 'ar-b': ar, 'ar-c': ar, 'fumaca-a': fumaca, 'fumaca-b': fumaca, jake, potencia, 'veiculo-a': veiculo, 'veiculo-b': veiculo,
  'cambio-a': cambio, 'cambio-b': cambio, 'cambio-c': cambio,
  ...Object.fromEntries(NAN.map((g) => [g, nan])),
  ...Object.fromEntries(GOV.map((g) => [g, async (gg: string) => (await import('./diesel-governador')).passadaGovernador(gg.slice('governador-'.length))])),
  'projeto-a': projeto, 'projeto-b': projeto, 'projeto-c': projeto,
};
/** contagem, transiente, CV e a dispersão de ciclo a ciclo: 3 sementes, uma por processo, e o caso mediano */
const SEMENTES = new Set(['pressoes-a', 'pressoes-b', 'pressoes-c', 'bandas-a', ...Object.keys(CLASSES), 'envoltoria-a', 'envoltoria-b', 'envoltoria-c', 'envoltoria-d',
  'real3-tom', 'ar-b', 'fumaca-a', 'fumaca-b', 'jake', 'veiculo-b', 'cambio-a', 'cambio-b', 'cambio-c', ...GOV, 'projeto-a']);
/** os que não devolvem medidas: tabelas próprias, em que falha é falha (não há desvio aceito nelas) */
const TEXTO: Record<string, [string, string[]]> = { lenta: [path.join(RAIZ, 'tools/diesel-lenta.ts'), ['--j', '6']], troca: [path.join(RAIZ, 'tools/diesel-troca.ts'), []] };
/** os nomes de antes (um grupo por nome) valem pelos grupos em que cada um foi partido */
const ALIAS: Record<string, string[]> = {
  ...Object.fromEntries(['pressoes', 'bandas', 'real3', 'envoltoria', 'ar', 'fumaca', 'veiculo', 'cambio', 'nan', 'governador', 'projeto'].map((p) => [p, Object.keys(GRUPOS).filter((g) => g.startsWith(`${p}-`))])),
};
/** tempo de uma semente do grupo (s, medido em 23/11/2026 com a máquina ocupada), para pôr os longos primeiro na fila;
 *  o que não está aqui conta como 40 */
const PESO: Record<string, number> = {
  'ar-b': 240, troca: 220, 'cambio-b': 195, 'ar-a': 180, 'ar-c': 175, 'projeto-b': 160, 'projeto-c': 157, 'governador-c': 154, 'governador-d': 154,
  'pressoes-b': 148, 'pressoes-c': 148, 'real3-tom': 144, 'bandas-b': 144, 'pressoes-a': 129, lenta: 124, 'nan-ge7fdl': 120, 'nan-emd710': 118,
  'veiculo-b': 112, potencia: 105, 'fumaca-b': 104, 'nan-gen500': 101, 'nan-scaniav8': 90, 'nan-duramax66': 85, 'nan-psd73': 85, 'cambio-c': 82,
  'nan-catc15': 78, 'nan-volvod13': 77, 'nan-ram67': 77, 'nan-emd710-b': 76, 'nan-ge7fdl-b': 75, 'envoltoria-a': 74, 'nan-ranger32': 73,
  'cambio-a': 70, 'nan-om617': 69, 'real3-e': 66, 'real3-f': 67, 'real3-g': 67, 'nan-hilux28': 65, 'nan-dd6v92': 61, 'nan-onibusisl': 59,
  'envoltoria-d': 58, jake: 54, 'nan-tdi19': 54, 'envoltoria-b': 53, 'envoltoria-c': 51, 'nan-f1000mwm': 51, 'governador-a': 50,
};

async function rodarGrupo(g: string): Promise<Linha[]> {
  return await GRUPOS[g](g);
}

// ------------------------------------------------------------------ execução
const args = process.argv.slice(2);
if (args[0] === '--grupo') {
  // (um processo por grupo e por semente; a semente vem do ambiente, SEMENTE)
  iniciarSementes();
  rodarGrupo(args[1]).then((l) => process.stdout.write(JSON.stringify(l)))
    .catch((e) => process.stdout.write(JSON.stringify([{ grupo: args[1], nome: 'execução do grupo', alvo: 'sem erro', medido: String(e?.stack || e).slice(0, 400), ok: false }])));
} else if (process.argv[1] && process.argv[1].endsWith('diesel-valida.ts')) {
  const op = lerOpcoes(args);
  // (compatível com o `--so g1,g2` de antes)
  const pedidos0: string[] = [];
  for (let i = 0; i < op.resto.length; i++) { if (op.resto[i] === '--so') pedidos0.push(...op.resto[++i].split(',')); else pedidos0.push(op.resto[i]); }
  const base = iniciarSementes(op.semente);
  const pedidos = [...new Set(pedidos0.flatMap((g) => ALIAS[g] ?? [g]))];
  const todos = [...Object.keys(GRUPOS), ...Object.keys(TEXTO)];
  for (const g of pedidos) if (!GRUPOS[g] && !TEXTO[g]) { console.error(`grupo desconhecido: ${g} (${todos.join(' ')}; apelidos ${Object.keys(ALIAS).join(' ')}; a CPU saiu para npm run cpu:diesel)`); process.exit(2); }
  const fila = pedidos.length ? pedidos : todos;
  const J = op.j ?? Math.max(2, Math.floor(os.cpus().length * 0.75));
  const t0 = Date.now();
  // tarefas: um processo por grupo e por semente (as tabelas de lenta e troca são um processo cada; a de lenta abre os
  // seus 6 filhos)
  type Tarefa = { g: string; k: number; peso: number };
  const tarefas: Tarefa[] = fila.flatMap((g) => (TEXTO[g] || !SEMENTES.has(g) ? [0] : [0, 1, 2]).map((i) => ({ g, k: base + i, peso: PESO[g] ?? 40 })));
  const res: Record<string, [number, Linha[]][]> = {}, textos: Record<string, { saida: string; codigo: number }> = {};
  const rodar = async (t: Tarefa) => {
    const t1 = Date.now();
    if (TEXTO[t.g]) { textos[t.g] = await filho(TEXTO[t.g][0], TEXTO[t.g][1], { semente: t.k, erro: true }); }
    else {
      const { saida } = await filho(AQUI, ['--grupo', t.g], { semente: t.k });
      let l: Linha[];
      try { l = JSON.parse(saida); } catch { l = [{ grupo: t.g, nome: 'execução do grupo', alvo: 'sem erro', medido: saida.slice(-300), ok: false }]; }
      (res[t.g] ??= []).push([t.k, l]);
    }
    console.error(`  (${t.g}${SEMENTES.has(t.g) ? ` semente ${t.k}` : ''}: ${((Date.now() - t1) / 1000).toFixed(0)} s, fim aos ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  };
  (async () => {
    // (os mais longos primeiro)
    const q = [...tarefas].sort((a, b) => b.peso - a.peso);
    await Promise.all(Array.from({ length: Math.min(J, q.length) }, async () => { while (q.length) await rodar(q.shift()!); }));
    // as tabelas do teste de lenta e da troca de preset: falha é falha
    let falhasTexto = 0;
    for (const g of Object.keys(TEXTO)) {
      if (!textos[g]) continue;
      console.log(`\n### ${g}\n`);
      let f = 0;
      for (const l of textos[g].saida.trim().split('\n')) { console.log(l); if (/\| (FALHA|ERRO)/.test(l)) f++; }
      if (textos[g].codigo && !f) f = 1; // (o processo saiu com erro sem nenhuma linha de falha: conta uma)
      falhasTexto += f;
    }
    // as medidas: o caso mediano dos grupos com 3 sementes (a mesma ordem de linhas em todas, senão o grupo falha)
    const linhas: Medida[] = fila.filter((g) => !TEXTO[g]).flatMap((g) => {
      const ls = (res[g] || []).sort((a, b) => a[0] - b[0]).map(([, l]) => l); // (na ordem das sementes)
      if (ls.length <= 1) return (ls[0] || []).map(({ ordem: _o, ...l }) => l);
      if (ls.some((l) => l.length === 1 && l[0].nome === 'execução do grupo')) return ls.find((l) => l.length === 1 && l[0].nome === 'execução do grupo')!;
      try { return casoMediano(ls); } catch (e: any) { return [{ grupo: g, nome: 'execução do grupo', alvo: 'sem erro', medido: String(e?.message || e), ok: false }]; }
    });
    const r = avaliarDesvios(RETRATO, linhas, { atualizar: op.atualizar, grupos: fila.filter((g) => !TEXTO[g]) });
    console.log(`\n### medidas\n`);
    // (o tempo antes da contagem: o verificar mostra a última linha)
    const nTexto = Object.keys(textos).length;
    console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s${nTexto ? `; tabelas de ${Object.keys(textos).join(' e ')}: ${falhasTexto ? `${falhasTexto} falha(s)` : 'sem falhas'}` : ''})`);
    imprimirAvaliacao(r, { motivo: true });
    if (falhasTexto) console.log(`${falhasTexto} falha(s) nas tabelas de ${Object.keys(textos).join(' e ')} (acima)`);
    process.exitCode = r.contagem.falha || falhasTexto ? 1 : 0;
  })();
}
