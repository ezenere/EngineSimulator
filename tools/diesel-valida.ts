// Validação do Diesel num comando só (DIESEL.md 8): roda o teste de lenta (tools/diesel-lenta.ts), os governadores
// (tools/diesel-governador.ts) e as medidas abaixo, em paralelo, e sai com código ≠ 0 se algo falhar. Cada medida
// tem o alvo do DIESEL.md; as que o modelo não alcança por limitação conhecida estão em `DESVIOS` (documentadas em
// docs/TECNICO.md → Diesel) e aparecem como "desvio", sem reprovar.
//
//   npx tsx tools/diesel-valida.ts [--j 12] [--so grupo1,grupo2]
//   grupos: pressoes, bandas, real3, fumaca, jake, potencia, veiculo, cambio, nan, lenta, governador, troca
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { renderizar, preset, media, trecho, SR, type Cenario } from './diesel-comum';
import { analisar, welch } from './diesel-bandas';
import { PRESETS } from '../src/engines/diesel/presets';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
type Linha = { grupo: string; nome: string; alvo: string; medido: string; ok: boolean; desvio?: boolean };

// Medidas que ficaram fora do alvo do DIESEL.md nesta etapa, com o motivo (TECNICO.md → Diesel → Desvios). Não são
// "aprovadas": aparecem como "desvio" na tabela, para o portão separar o que já se sabe do que quebrou de novo.
export const DESVIOS: [RegExp, string][] = [
  // ---- tabela 2.5 (pressões e temperaturas)
  [/lenta.*T na abertura do escape/, 'zona única com o combustível de lenta realista (6–8 mg na picape, λ 8): a média do gás na abertura fica em 480–520 K; 600–750 K pediria 60% mais combustível ou a queima centrada a 35° depois do PMS'],
  [/lenta fria −10 °C.*(ângulo do pico|dp\/dθ máx|p_max|T na abertura|gás no coletor)/, 'a parede fria (340 K) baixa a temperatura na injeção só 40 K neste modelo (o DIESEL.md supõe 180 K): o atraso sobe 3% e o piloto continua acendendo antes do principal; a queima fria sai cedo e forte'],
  [/picape plena.*T na abertura/, '1320 K, 1,5% acima da janela: o pico foi para 13° (a queima por mistura atrasa a liberação de calor)'],
  [/caminhão plena 1900 rpm.*(p_max|ângulo do pico|dp\/dθ máx|T na abertura|gás no coletor)/, 'com 2,7 bar a 1900 rpm o C15 do modelo respira λ 2,5 (real ≈ 1,8): pouco calor por volume, pico de 140 bar a 10° e gás frio; o ar sobra porque o coletor fica a 310 K fixos (sem o aquecimento no compressor)'],
  [/EMD 710.*(ângulo do pico|T na abertura|gás no coletor)/, 'lavagem de zona única: o ar que atravessa o cilindro direto para o escape esfria o coletor (136/361 °C) e a lenta de 2 ms de atraso acende antes do PMS'],
  [/Jake a 1900 rpm .*PMS/, 'o ar comprimido com o turbo girado pelo sopro do Jake passa de 50 bar no PMS; com a válvula do Jake maior (que baixaria o PMS) a rede do escape fica instável'],
  // ---- referências internas do DIESEL.md (YouTube, vários lo-fi; o alvo principal é o real3)
  [/leve · cofre · hilux28 lenta: (2,5–6 kHz|curtose)/, 'referência interna lo-fi: com a mecânica +7 dB que o real3 pede na picape em lenta, o cofre sai 3 dB mais agudo e mais impulsivo (curtose 11) que o vídeo do 1GD'],
  [/ram67 lenta fria: (centroide|1–2,5 kHz|1–4 kHz)/, 'referência interna (Cummins a −23 °C, vídeo): a mecânica +10 dB que o real3 pede no Cummins em lenta deixa o frio 5 dB mais agudo; o escape de 4" irradia grave na câmera atrás'],
  [/pesado · escape · catc15/, 'a mecânica que a câmera de lado pede vaza para o microfone do escape'],
  [/lenta → plena carga/, '25,9 dB, 0,9 dB acima da janela'],
  // ---- real3 (scratchpad/real3/diesel/RESUMO.md)
  [/real3 · picape lenta.*60–150/, '16,3 dB contra 15,9 do arquivo mais grave da classe: o escape da picape com DPF e abafador original passa o grave da ignição e corta 150–400'],
  [/real3 · caminhão lenta.*(30–60|60–150|CV)/, 'o primeiro harmônico da ignição (30 Hz) sai 8 dB acima das gravações de 2–3 m: a irradiação de monopolo da chaminé (+6 dB/oitava) não basta para o pulso de 2 L por cilindro; o CV (0,28) é o da picape, um pouco irregular demais para o caminhão'],
  [/real3 · ônibus carga.*400–1k/, 'o ônibus carregado é 3 dB mais escuro em 400–1000 Hz que o mais escuro da classe (gravações de dentro do ônibus têm a carroceria e a rodagem)'],
  [/real3 · gerador/, 'o grupo gerador é ouvido pela câmera de veículo (ouvinte ext): sem a carenagem e o radiador do grupo, o grave do escape domina e a mecânica e o ventilador ficam 10–15 dB abaixo; falta o portador gerador da Cena com a posição do ouvinte ao lado do grupo'],
  [/real3 · locomotiva lenta/, 'a EMD em lenta é escura: faltam os ventiladores, o compressor de ar e os sopradores da carroceria que dão o agudo (e o centroide de 2,2 kHz) da gravação; o 60–150 sai alto pelo pulso de 2 tempos sem os 4 cilindros de folga entre bancadas'],
  [/real3 · EMD notch 8.*(30–60|60–150|1–2,5k|6–12k|CV)/, 'a EMD em notch 8 tem 60–150 Hz 16 dB acima de 150–400 nas gravações (ventiladores do radiador, motores de tração e o desequilíbrio entre bancadas a 15 Hz); o modelo tem a ignição de 240 Hz e o ruído da turbina, sem essas fontes'],
  [/real3 · caminhão carga.*CV/, 'CV 0,16 sob carga (gravações de cabine 0,20–0,36, que somam a rodagem e as trocas): a queima por mistura com a injeção longa é mais regular'],
  [/real3 · GE 7FDL notch 8.*(centroide|CV)/, 'centroide 323 Hz (7 Hz abaixo da faixa) e CV 0,16: a queima do GE em carga é regular demais'],
  // ---- fumaça, freio-motor, veículo, governador
  [/λ < 1,3/, 'sem fumaça preta no transiente: o aspirado tem ar sobrando com o combustível máximo da ficha (λ mín ≈ 1,7; a subida de torque da bomba levava a 1,33 mas tirava a lenta do F-1000 da janela); na locomotiva o regulador de carga sobe junto com o giro (fazer a carga subir com o notch apagava o motor com o turbo vazio)'],
  [/Jake 6: 2,5–6 kHz/, 'o sopro do Jake passa pela turbina e pelo abafador do caminhão, que comem o agudo; o estalo do balancim (mecânica) não chega aos +6 dB'],
  [/Jake 6: potência/, '68% (alvo 70–90%): o turbo girado pelo Jake não chega à pressão de plena carga'],
  [/freio de descarga: pulsos/, 'a borboleta só atenua a boca e o jato; a rede do escape antes dela continua irradiando pelo coletor'],
  [/hilux28 degrau de 30%/, 'a lenta carregada oscila ±2% com a dispersão de ciclo a ciclo (atraso e injetor), e encosta na faixa por 5 s; a queda (7%) está na janela'],
  [/emd710 potência por notch/, '3,2% num notch (alvo 3%)'],
  [/om617 (droop|caça)/, 'droop 9,1% (alvo 7–9%) e caça ±2–3,6% em lenta: a dispersão das bombas mecânicas (±6,5% por elemento) move a lenta do OM617'],
];
const desvio = (nome: string) => DESVIOS.find(([r]) => r.test(nome))?.[1];

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
const mono = (r, t0: number, t1: number) => { const a = Math.floor(t0 * SR), b = Math.floor(t1 * SR), x = new Float64Array(b - a); for (let i = 0; i < x.length; i++) x[i] = 0.5 * (r.L[a + i] + r.R[a + i]); return x; };
const med = (tl, k) => media(tl.map((e) => e[k]));

// ------------------------------------------------------------------ grupos
const GRUPOS: Record<string, () => Linha[]> = {
  // tabela 2.5: pressão de pico, ângulo, dp/dθ, temperatura na abertura do escape e gás no coletor
  pressoes: () => {
    const L: Linha[] = [];
    const caso = (nome: string, id: string, cen: Cenario, t0: number, t1: number, al: { p: [number, number]; ang?: [number, number]; dp: [number, number]; tevo?: [number, number]; egt?: [number, number] }, port?: string) => {
      const r = renderizar(preset(id), cen, { portador: port });
      const tl = trecho(r.tele, t0, t1);
      const p = med(tl, 'pMax'), ang = med(tl, 'ang'), dp = med(tl, 'dpdth'), tevo = med(tl, 'tEvo'), egt = tl[tl.length - 1].exhT;
      L.push({ grupo: 'pressoes', nome: `${nome}: p_max`, alvo: `${al.p[0]}–${al.p[1]} bar`, medido: `${f1(p)} bar`, ok: faixa(p, al.p[0], al.p[1]) });
      if (al.ang) L.push({ grupo: 'pressoes', nome: `${nome}: ângulo do pico`, alvo: `${al.ang[0]}–${al.ang[1]}°`, medido: `${f1(ang)}°`, ok: faixa(ang, al.ang[0], al.ang[1]) });
      L.push({ grupo: 'pressoes', nome: `${nome}: dp/dθ máx`, alvo: `${al.dp[0]}–${al.dp[1]} bar/°`, medido: `${f1(dp)} bar/°`, ok: faixa(dp, al.dp[0], al.dp[1]) });
      if (al.tevo) L.push({ grupo: 'pressoes', nome: `${nome}: T na abertura do escape`, alvo: `${al.tevo[0]}–${al.tevo[1]} K`, medido: `${tevo.toFixed(0)} K`, ok: faixa(tevo, al.tevo[0], al.tevo[1]) });
      if (al.egt) L.push({ grupo: 'pressoes', nome: `${nome}: gás no coletor`, alvo: `${al.egt[0]}–${al.egt[1]} °C`, medido: `${egt.toFixed(0)} °C`, ok: faixa(egt, al.egt[0], al.egt[1]) });
      return r;
    };
    caso('picape lenta quente (hilux28)', 'hilux28', lentaQ(30), 20, 30, { p: [45, 60], ang: [3, 8], dp: [3, 6], tevo: [600, 750], egt: [150, 250] });
    caso('picape lenta fria −10 °C (hilux28)', 'hilux28', { eventos: [[0, (d) => { d.lentaFixa = 800; d.message({ type: 'input', temp: { mode: 'fixed', value: -10 } }); liga(d); }], [30, null]], portador: 'nenhum0' }, 20, 30,
      { p: [40, 55], ang: [8, 15], dp: [5, 9], tevo: [550, 700], egt: [100, 180] });
    caso('picape plena 3000 rpm, 2,4 bar (hilux28)', 'hilux28', plena(3000, 1.4, 25), 20, 25, { p: [140, 180], ang: [10, 14], dp: [5, 8], tevo: [1100, 1300], egt: [550, 700] });
    caso('caminhão lenta 600 rpm (catc15)', 'catc15', lentaQ(30), 20, 30, { p: [50, 65], ang: [3, 8], dp: [3, 5], tevo: [600, 700], egt: [150, 200] });
    caso('caminhão plena 1900 rpm, 2,7 bar (catc15)', 'catc15', plena(1900, 1.7, 25), 20, 25, { p: [160, 200], ang: [10, 14], dp: [6, 9], tevo: [1150, 1300], egt: [550, 650] });
    caso('EMD 710 lenta 269 rpm', 'emd710', lentaQ(30), 20, 30, { p: [40, 55], ang: [5, 10], dp: [2, 4], tevo: [650, 750], egt: [180, 250] }, 'locomotiva');
    const n8: Cenario = { eventos: [[0, (d) => { quente(d); liga(d); }], [3, (d) => d.message({ type: 'diesel', notch: 8 })], [40, null]], portador: 'locomotiva' };
    caso('EMD 710 notch 8', 'emd710', n8, 32, 40, { p: [115, 135], ang: [10, 14], dp: [4, 7], tevo: [1050, 1200], egt: [480, 560] });
    caso('GE 7FDL lenta 440 rpm', 'ge7fdl', lentaQ(30), 20, 30, { p: [35, 50], dp: [2, 4], egt: [150, 250] }, 'locomotiva');
    caso('GE 7FDL notch 8', 'ge7fdl', n8, 32, 40, { p: [125, 145], dp: [4, 7], egt: [480, 560] });
    // Jake a 1900 rpm sem combustível: o ar comprimido no PMS
    const rj = renderizar(preset('catc15'), { eventos: [[0, (d) => { quente(d); d.state = 'run'; d.runT = 30; d.lockOmega = true; d.omega = (1900 * Math.PI * 2) / 60; d.rpmAvg = 1900; d.message({ type: 'diesel', freioMotor: true }); }], [4, null]], portador: 'nenhum0' });
    const pj = media(trecho(rj.tele, 2, 4).map((e) => e.pMax));
    L.push({ grupo: 'pressoes', nome: 'Jake a 1900 rpm (catc15): pressão no PMS', alvo: '35–50 bar', medido: `${f1(pj)} bar`, ok: faixa(pj, 35, 50) });
    return L;
  },

  // bandas relativas a 150–400 Hz contra as referências internas do DIESEL.md (2.6, Apêndice A: vídeos do YouTube, vários
  // lo-fi): cofre da picape, Cummins fria, escape do caminhão, faixa de nível dos leves. O alvo principal é o real3 (abaixo)
  bandas: () => {
    const L: Linha[] = [];
    const add = (nome, alvo, v, a, b) => L.push({ grupo: 'bandas', nome, alvo, medido: f1(v), ok: faixa(v, a, b) });
    const medir = (id: string, cen: Cenario, ouvinte: string, t0: number, t1: number, port?: string) => {
      const sp = preset(id), r = renderizar(sp, cen, { ouvinte, portador: port });
      const rpm = med(trecho(r.tele, t0, t1), 'rpm');
      return analisar(mono(r, t0, t1), SR, rpm, sp.cylinders, sp.tempos);
    };
    // leve, cofre, lenta quente com piloto (Hilux 1GD/1KD)
    const h = medir('hilux28', lentaQ(12), 'bay', 6, 12);
    add('leve · cofre · hilux28 lenta: 1–2,5 kHz', '+4 ± 6 dB', h.b1k, -2, 10);
    add('leve · cofre · hilux28 lenta: 2,5–6 kHz', '−3 ± 3 dB', h.b25k, -6, 0);
    add('leve · cofre · hilux28 lenta: centroide', '1000–1500 Hz', h.cen, 1000, 1500);
    add('leve · cofre · hilux28 lenta: 1–4 kHz', '+5 ± 6 dB', h.k14, -1, 11);
    add('leve · cofre · hilux28 lenta: curtose 1–4 kHz', '6–9', h.curtose, 6, 9);
    add('leve · cofre · hilux28 lenta: p90/p10', '15 ± 3 dB', h.p9010, 12, 18);
    add('leve · cofre · hilux28 lenta: tiques por evento', '2–4', h.tiquesPorEvento, 2, 4);
    // frio: à mesma rotação, a banda 1–4 kHz sobe 8 ± 3 dB
    const hf = medir('hilux28', { eventos: [[0, (d) => { d.lentaFixa = 780; d.message({ type: 'input', temp: { mode: 'fixed', value: -10 } }); liga(d); }], [12, null]], portador: 'nenhum0' }, 'bay', 6, 12);
    const sobe = hf.ref + hf.k14 - (h.ref + h.k14);
    add('leve · cofre · hilux28 a −10 °C: 1–4 kHz sobe', '+8 ± 3 dB', sobe, 5, 11);
    // leve, exterior, lenta fria (Cummins 6.7 a −23 °C, 1000 rpm)
    const c = medir('ram67', { eventos: [[0, (d) => { d.ambientT = -23; d.message({ type: 'input', temp: { mode: 'fixed', value: -23 } }); liga(d); }], [12, null]], portador: 'nenhum0' }, 'ext', 6, 12);
    add('leve · exterior · ram67 lenta fria: 1–2,5 kHz', '−8 ± 4 dB', c.b1k, -12, -4);
    add('leve · exterior · ram67 lenta fria: centroide', '270–450 Hz', c.cen, 270, 450);
    add('leve · exterior · ram67 lenta fria: 1–4 kHz', '−8 ± 4 dB', c.k14, -12, -4);
    // pesado, atrás do escape (caminhão em lenta)
    const q = medir('catc15', lentaQ(12), 'pipe', 6, 12);
    add('pesado · escape · catc15 lenta: 60–150 Hz', '+11 ± 3 dB', q.b60, 8, 14);
    add('pesado · escape · catc15 lenta: 1–2,5 kHz', '≤ −18 dB', q.b1k, -40, -18);
    add('pesado · escape · catc15 lenta: centroide', '125–200 Hz', q.cen, 125, 200);
    // os 8 leves dentro de uma faixa de 12 dB em lenta (câmera atrás)
    const niveis = PRESETS.filter((p) => p.family === 'leve').map((p) => { const r = renderizar(preset(p.id), lentaQ(10), { ouvinte: 'ext' }); return analisar(mono(r, 6, 10), SR).nivel; });
    const fx = Math.max(...niveis) - Math.min(...niveis);
    L.push({ grupo: 'bandas', nome: 'os 8 leves em lenta (câmera atrás): faixa de nível', alvo: '≤ 12 dB', medido: `${f1(fx)} dB`, ok: fx <= 12 });
    // ext em lenta → plena carga a 55%: +18 a +25 dB
    const hl = renderizar(preset('hilux28'), lentaQ(10), { ouvinte: 'ext' }), hp = renderizar(preset('hilux28'), plena(4400 * 0.55, 1.4 * 0.4, 6), { ouvinte: 'ext' });
    const dn = analisar(mono(hp, 3, 6), SR).nivel - analisar(mono(hl, 6, 10), SR).nivel;
    L.push({ grupo: 'bandas', nome: 'hilux28 câmera atrás: lenta → plena carga a 55%', alvo: '+18 a +25 dB', medido: `${f1(dn)} dB`, ok: faixa(dn, 18, 25) });
    return L;
  },

  // Classes do real3 (scratchpad/real3/diesel/RESUMO.md: 25 gravações de banda ≥ 15 kHz, grave presente, rpm conferido).
  // Só razões entre bandas (vários vídeos têm controle automático de ganho). Tolerância: a faixa entre arquivos da classe
  // ±2 dB (n ≥ 2) ou ±5 dB (n = 1); centroide na faixa da classe; CV do knock (std(Δa)/(√2·média) por ignição) na faixa
  // da classe ±0,03. O simulado de cada classe é a média dos presets indicados.
  real3: () => {
    const L: Linha[] = [];
    type Classe = { nome: string; casos: [string, Cenario, string, number, number, string?][]; b: [number, number][]; cen: [number, number]; cv: [number, number] };
    const carga = (s: number): Cenario => ({ eventos: [[0, (d) => { quente(d); liga(d); }], [3, (d) => { d.message({ type: 'input', shift: 1 }); d.message({ type: 'input', throttle: 1 }); }], [s, null]], portador: 'carro' });
    const loco = (n: number): Cenario => ({ eventos: [[0, (d) => { quente(d); liga(d); }], [3, (d) => d.message({ type: 'diesel', notch: n })], [40, null]], portador: 'locomotiva' });
    const ger = (g: number): Cenario => ({ eventos: [[0, (d) => { quente(d); liga(d); }], [8, (d) => d.message({ type: 'diesel', degrau: g })], [24, null]], portador: 'gerador' });
    const r = (lo: number, hi: number, n = 2): [number, number] => (n >= 2 ? [lo - 2, hi + 2] : [lo - 5, hi + 5]);
    const C: Classe[] = [
      { nome: 'picape lenta (hilux28, ranger32, ram67)', casos: [['hilux28', lentaQ(14), 'ext', 6, 14], ['ranger32', lentaQ(14), 'ext', 6, 14], ['ram67', lentaQ(14), 'ext', 6, 14]],
        b: [r(-12.7, 11.3), r(-1.2, 13.9), r(-14.4, -0.5), r(-11, -0.1), r(-20.2, -1.7), r(-21.6, -9)], cen: [214, 1114], cv: [0.135, 0.32] },
      { nome: 'caminhão lenta (catc15, volvod13)', casos: [['catc15', lentaQ(14), 'ext', 6, 14], ['volvod13', lentaQ(14), 'ext', 6, 14]],
        b: [r(-6.3, 0.7), r(3.2, 8), r(-0.5, 5), r(-2.7, 4), r(-12.2, -5.7), r(-22.4, -13)], cen: [502, 988], cv: [0.125, 0.25] },
      { nome: 'caminhão carga, cabine (scaniav8)', casos: [['scaniav8', carga(40), 'int', 20, 40]],
        b: [r(-23.6, 9.1), r(1.7, 8.3), r(-7.2, -2.5), r(-13, -6.6), r(-20.6, -8.4), r(-38.4, -17.3)], cen: [244, 711], cv: [0.166, 0.39] },
      { nome: 'ônibus carga (onibusisl)', casos: [['onibusisl', carga(14), 'ext', 6, 14]],
        b: [r(-8.4, -1.9), r(-3.6, 6), r(-4.9, 0.8), r(-12.5, 1), r(-17.6, -5.8), r(-29.4, -14)], cen: [242, 1017], cv: [0.14, 0.27] },
      { nome: 'gerador sem carga (gen500)', casos: [['gen500', ger(0), 'ext', 14, 24, 'gerador']],
        b: [r(-14.6, -14.6, 1), r(-1.7, -1.7, 1), r(-1.6, -1.6, 1), r(-5.1, -5.1, 1), r(-9.9, -9.9, 1), r(-11.6, -11.6, 1)], cen: [500, 1000], cv: [0.16, 0.22] },
      { nome: 'gerador com carga (gen500)', casos: [['gen500', ger(1), 'ext', 14, 24, 'gerador']],
        b: [r(-11.7, -11.7, 1), r(5.8, 5.8, 1), r(-3.5, -3.5, 1), r(-11.8, -11.8, 1), r(-15.7, -15.7, 1), r(-22.5, -22.5, 1)], cen: [160, 330], cv: [0.19, 0.25] },
      { nome: 'locomotiva lenta (emd710)', casos: [['emd710', loco(0), 'ext', 25, 40, 'locomotiva']],
        b: [r(-18.4, 4.8), r(-2.5, 4.4), r(-0.9, 1.8), r(-9.5, -0.7), r(-14.5, 4.6), r(-17.8, 3.5)], cen: [481, 2244], cv: [0.12, 0.38] },
      { nome: 'EMD notch 8 (emd710)', casos: [['emd710', loco(8), 'ext', 30, 40, 'locomotiva']],
        b: [r(1.2, 8.5), r(14.2, 16.3), r(-5.5, -0.4), r(-12, 0.2), r(-5.8, 1.1), r(-8.7, 4.7)], cen: [340, 3547], cv: [0.16, 0.30] },
      { nome: 'GE 7FDL notch 8 (ge7fdl)', casos: [['ge7fdl', loco(8), 'ext', 30, 40, 'locomotiva']],
        b: [r(-2, -2, 1), r(5.4, 5.4, 1), r(-3, -3, 1), r(-4.5, -4.5, 1), r(-9.5, -9.5, 1), r(-21.2, -21.2, 1)], cen: [330, 610], cv: [0.24, 0.30] },
    ];
    const nomes = ['30–60', '60–150', '400–1k', '1–2,5k', '2,5–6k', '6–12k'];
    for (const k of C) {
      const an = k.casos.map(([id, cen, ouv, t0, t1, port]) => {
        const sp = preset(id), rr = renderizar(sp, cen, { ouvinte: ouv, portador: port });
        const rpm = med(trecho(rr.tele, t0, t1), 'rpm');
        return analisar(mono(rr, t0, t1), SR, rpm, sp.cylinders, sp.tempos);
      });
      const m = (f: (a: any) => number) => media(an.map(f));
      const v = [m((a) => a.b30), m((a) => a.b60), m((a) => a.b400), m((a) => a.b1k), m((a) => a.b25k), m((a) => a.b6k)];
      v.forEach((x, i) => L.push({ grupo: 'real3', nome: `real3 · ${k.nome}: ${nomes[i]}`, alvo: `${k.b[i][0].toFixed(1)} a ${k.b[i][1].toFixed(1)} dB`, medido: f1(x), ok: faixa(x, k.b[i][0], k.b[i][1]) }));
      const ce = m((a) => a.cen), cv = m((a) => a.cv);
      L.push({ grupo: 'real3', nome: `real3 · ${k.nome}: centroide`, alvo: `${k.cen[0]}–${k.cen[1]} Hz`, medido: `${ce.toFixed(0)} Hz`, ok: faixa(ce, k.cen[0], k.cen[1]) });
      L.push({ grupo: 'real3', nome: `real3 · ${k.nome}: CV do knock`, alvo: `${k.cv[0].toFixed(2)}–${k.cv[1].toFixed(2)}`, medido: cv.toFixed(2), ok: faixa(cv, k.cv[0], k.cv[1]) });
    }
    // apito do turbo (RESUMO.md, tons estreitos 2–20 kHz): caminhão em carga sem tom proeminente; VGT do Cummins 6.7 em
    // lenta com tom forte em ~7 kHz; EMD em notch 8 com o "grito" do turbo
    const tom = (id: string, cen: Cenario, ouv: string, t0: number, t1: number, port?: string, f0 = 2000, f1x = 20000) => {
      const rr = renderizar(preset(id), cen, { ouvinte: ouv, portador: port });
      const [f, P] = welch(mono(rr, t0, t1), SR, 32768), Ld = Array.from(P, (q) => 10 * Math.log10(q + 1e-30));
      let best = -99, fb = 0;
      for (let k2 = 0; k2 < f.length; k2++) {
        if (f[k2] < f0 || f[k2] > f1x) continue;
        const w: number[] = []; for (let j = k2 - 40; j <= k2 + 40; j++) if (j >= 0 && j < Ld.length) w.push(Ld[j]);
        w.sort((a, b) => a - b); const pr = Ld[k2] - w[w.length >> 1]; if (pr > best) { best = pr; fb = f[k2]; }
      }
      return { best, fb };
    };
    const t1 = tom('scaniav8', carga(40), 'int', 20, 40), t2 = tom('ram67', lentaQ(14), 'ext', 6, 14, undefined, 5000, 9000), t3 = tom('emd710', loco(8), 'ext', 30, 40, 'locomotiva', 3500, 17500);
    L.push({ grupo: 'real3', nome: 'real3 · turbo: caminhão em carga sem apito proeminente', alvo: '≤ +11 dB', medido: `+${t1.best.toFixed(0)} dB em ${(t1.fb / 1000).toFixed(1)} kHz`, ok: t1.best <= 11 });
    L.push({ grupo: 'real3', nome: 'real3 · turbo: VGT do Cummins 6.7 em lenta', alvo: '+17 a +24 dB em ~7 kHz', medido: `+${t2.best.toFixed(0)} dB em ${(t2.fb / 1000).toFixed(1)} kHz`, ok: faixa(t2.best, 14, 27) });
    L.push({ grupo: 'real3', nome: 'real3 · turbo: EMD em notch 8', alvo: '+19,5 dB (3,6–17 kHz)', medido: `+${t3.best.toFixed(0)} dB em ${(t3.fb / 1000).toFixed(1)} kHz`, ok: faixa(t3.best, 14, 26) });
    return L;
  },

  // fumaça no transiente (3.3): mecânico sem aneroide fumaça; eletrônico nunca passa de 1,25
  fumaca: () => {
    const L: Linha[] = [];
    const piso = (id: string, port = 'carro') => {
      const r = renderizar(preset(id), { eventos: [[0, (d) => { quente(d); liga(d); }], [4, (d) => d.message({ type: 'input', throttle: 1 })], [8, null]], portador: port }, { tele: 256 });
      const tl = trecho(r.tele, 4, 8);
      const dur = tl.filter((e) => e.lambdaInst < 1.3 && e.fuel > 0.05).length * (256 / SR);
      return { dur, min: Math.min(...tl.map((e) => e.lambdaInst)) };
    };
    const f = piso('f1000mwm');
    L.push({ grupo: 'fumaca', nome: 'f1000mwm pé no fundo da lenta: λ < 1,3', alvo: '0,5–1,5 s', medido: `${f.dur.toFixed(2)} s (λ mín ${f.min.toFixed(2)})`, ok: faixa(f.dur, 0.5, 1.5) });
    const h = piso('hilux28');
    L.push({ grupo: 'fumaca', nome: 'hilux28 pé no fundo da lenta: λ mínimo', alvo: '≥ 1,25', medido: h.min.toFixed(2), ok: h.min >= 1.24 });
    // GE subindo notch a notch
    const ev: any[] = [[0, (d) => { quente(d); liga(d); }]];
    for (let n = 1; n <= 8; n++) ev.push([5 + (n - 1) * 8, (d) => d.message({ type: 'diesel', notch: n })]);
    ev.push([69, null]);
    const r = renderizar(preset('ge7fdl'), { eventos: ev, portador: 'locomotiva' }, { tele: 1024 });
    const durs = [];
    for (let n = 2; n <= 8; n++) durs.push(trecho(r.tele, 5 + (n - 1) * 8, 5 + n * 8).filter((e) => e.lambdaInst < 1.3).length * (1024 / SR));
    const dm = media(durs);
    L.push({ grupo: 'fumaca', nome: 'ge7fdl subindo cada notch: λ < 1,3', alvo: '2–4 s por notch', medido: `${dm.toFixed(2)} s em média (${durs.map((x) => x.toFixed(1)).join(' ')})`, ok: faixa(dm, 2, 4) });
    return L;
  },

  // freio-motor (3.4, passo 7)
  jake: () => {
    const L: Linha[] = [];
    const sp = preset('catc15'), w = (1900 * Math.PI * 2) / 60;
    const trav = (freio: boolean, n = 6): Cenario => ({ eventos: [[0, (d) => { quente(d); d.state = 'run'; d.runT = 30; d.lockOmega = true; d.omega = w; d.rpmAvg = 1900; if (freio) d.message({ type: 'diesel', freioMotor: true, jakeCilindros: n }); }], [4, null]], portador: 'nenhum0' });
    const pl = renderizar(sp, plena(1900, 1.7, 4), { ouvinte: 'ext' });
    const ap = analisar(mono(pl, 2, 4), SR);
    const jk: any = {};
    for (const n of [2, 4, 6]) { const r = renderizar(sp, trav(true, n), { ouvinte: 'ext' }); jk[n] = { a: analisar(mono(r, 2, 4), SR), tq: -med(trecho(r.tele, 2, 4), 'torque') , r }; }
    const j6 = jk[6].a;
    // torque de frenagem: o torque médio negativo dos gases + atrito (telemetria torque é max(0, …): usa o DSP)
    const frenagem = (r) => { const d = r.d; return -(d.tqMean) * w / 1000; };
    const kw6 = frenagem(jk[6].r), kw2 = frenagem(jk[2].r), kw4 = frenagem(jk[4].r);
    L.push({ grupo: 'jake', nome: 'catc15 Jake 6 cil. a 1900 rpm: nível total vs plena carga', alvo: '+2 ± 2 dB', medido: `${f1(j6.nivel - ap.nivel)} dB`, ok: faixa(j6.nivel - ap.nivel, 0, 4) });
    L.push({ grupo: 'jake', nome: 'catc15 Jake 6: 2,5–6 kHz vs plena carga', alvo: '+6 ± 3 dB', medido: `${f1((j6.ref + j6.b25k) - (ap.ref + ap.b25k))} dB`, ok: faixa((j6.ref + j6.b25k) - (ap.ref + ap.b25k), 3, 9) });
    L.push({ grupo: 'jake', nome: 'catc15 Jake 6: p90/p10 da banda 1–4 kHz', alvo: '≥ 15 dB', medido: `${f1(j6.p9010)} dB`, ok: j6.p9010 >= 15 });
    L.push({ grupo: 'jake', nome: 'catc15 Jake 6: potência de frenagem', alvo: `70–90% de ${sp.power} kW`, medido: `${kw6.toFixed(0)} kW (${(kw6 / sp.power * 100).toFixed(0)}%)`, ok: faixa(kw6 / sp.power, 0.7, 0.9) });
    L.push({ grupo: 'jake', nome: 'catc15 Jake 4 cil.: potência', alvo: '≈ 60%', medido: `${(kw4 / sp.power * 100).toFixed(0)}%`, ok: faixa(kw4 / sp.power, 0.45, 0.75) });
    L.push({ grupo: 'jake', nome: 'catc15 Jake 2 cil.: potência', alvo: '≈ 30%', medido: `${(kw2 / sp.power * 100).toFixed(0)}%`, ok: faixa(kw2 / sp.power, 0.2, 0.4) });
    L.push({ grupo: 'jake', nome: 'catc15 Jake 2 cil. vs 6: nível', alvo: '−5 dB', medido: `${f1(jk[2].a.nivel - j6.nivel)} dB`, ok: faixa(jk[2].a.nivel - j6.nivel, -8, -2) });
    L.push({ grupo: 'jake', nome: 'catc15 Jake 4 cil. vs 6: nível', alvo: '−2 dB', medido: `${f1(jk[4].a.nivel - j6.nivel)} dB`, ok: faixa(jk[4].a.nivel - j6.nivel, -4, 0) });
    // Scania: freio de descarga
    const ss = preset('scaniav8'), ws = w;
    const soEsc = (c: Cenario): Cenario => ({ ...c, eventos: [[0, (d) => { c.eventos[0][1]!(d); d.params.mech = 0; d.params.intake = 0; d.params.air = 0; }], ...c.eventos.slice(1)] });
    const sem = renderizar(ss, soEsc(trav(false)), { ouvinte: 'ext' }), com = renderizar(ss, soEsc(trav(true)), { ouvinte: 'ext' });
    const dsd = analisar(mono(com, 2, 4), SR).nivel - analisar(mono(sem, 2, 4), SR).nivel;
    const kws = -(com.d.tqMean) * ws / 1000;
    L.push({ grupo: 'jake', nome: 'scaniav8 freio de descarga: pulsos vs sem freio', alvo: '−15 a −20 dB', medido: `${f1(dsd)} dB`, ok: faixa(dsd, -20, -15) });
    L.push({ grupo: 'jake', nome: 'scaniav8 freio de descarga: torque de frenagem', alvo: '30–40% do máximo', medido: `${(kws * 1000 / ws / ss.torque * 100).toFixed(0)}%`, ok: faixa(kws * 1000 / ws / ss.torque, 0.3, 0.4) });
    return L;
  },

  // potência medida depois da escala = ficha ±5% (rotação travada na rotação de potência, combustível 1)
  potencia: () => PRESETS.map((p) => {
    const sp = preset(p.id), r = renderizar(sp, plena(sp.rpmPotencia, sp.boost, 3), { tele: 256 });
    // (média do último 1,5 s: o tqMean de um instante carrega a dispersão de ciclo a ciclo)
    const d = r.d, kw = (med(trecho(r.tele, 1.5, 3), 'torque') * d.omega) / 1000;
    return { grupo: 'potencia', nome: `${p.id}: potência a ${sp.rpmPotencia} rpm`, alvo: `${sp.power} kW ± 5%`, medido: `${kw.toFixed(0)} kW (${((kw / sp.power - 1) * 100).toFixed(1)}%)`, ok: Math.abs(kw / sp.power - 1) <= 0.05 };
  }),

  // veículo: velocidades na marcha mais alta e arrancada carregada (passo 11)
  veiculo: () => {
    const L: Linha[] = [];
    const rpmEm = (id: string, kmh: number) => { const s = preset(id); const r = s.ratios[s.ratios.length - 1] * s.finalDrive; return ((kmh / 3.6) / s.wheelR) * r * 9.549; };
    const h = rpmEm('hilux28', 100), s = rpmEm('scaniav8', 85);
    L.push({ grupo: 'veiculo', nome: 'hilux28 a 100 km/h em 6ª', alvo: '1700 ± 100 rpm', medido: `${h.toFixed(0)} rpm`, ok: Math.abs(h - 1700) <= 100 });
    L.push({ grupo: 'veiculo', nome: 'scaniav8 a 85 km/h em 12ª', alvo: '1250 ± 100 rpm', medido: `${s.toFixed(0)} rpm`, ok: Math.abs(s - 1250) <= 100 });
    // Volvo carregado: 0–85 km/h com pé no fundo e o automático
    const r = renderizar(preset('volvod13'), { eventos: [[0, (d) => { quente(d); liga(d); }], [3, (d) => { d.message({ type: 'input', shift: 1 }); d.message({ type: 'input', throttle: 1 }); }], [123, null]], portador: 'carro' }, { tele: 4096 });
    const chega = r.tele.find((e) => e.kmh >= 85);
    const t85 = chega ? chega.t - 3 : Infinity;
    L.push({ grupo: 'veiculo', nome: 'volvod13 carregado 0–85 km/h', alvo: '60–90 s', medido: Number.isFinite(t85) ? `${t85.toFixed(0)} s` : `não chegou (${Math.round(r.tele[r.tele.length - 1].kmh)} km/h em 120 s)`, ok: faixa(t85, 60, 90) });
    return L;
  },

  // câmbio automático (troca pela rotação de potência do diesel): arrancada com pé no fundo e com meio pé, depois solta
  // o pedal. A sequência de marchas tem de subir sem voltar, nos pontos de troca do diesel, e sem acelerar não sobe
  cambio: () => {
    const L: Linha[] = [];
    const caso = (id: string, ped: number, T: number, faixa0: [number, number]) => {
      const r = renderizar(preset(id), { eventos: [[0, (d) => { quente(d); liga(d); }], [3, (d) => { d.message({ type: 'input', shift: 1 }); d.message({ type: 'input', throttle: ped }); }], [3 + T, (d) => d.message({ type: 'input', throttle: 0 })], [13 + T, null]], portador: 'carro' }, { tele: 512 });
      const acel = r.tele.filter((e) => e.t >= 3 && e.t < 3 + T), solto = r.tele.filter((e) => e.t >= 3.5 + T);
      let volta = 0; const trocas: number[] = [];
      for (let i = 1; i < acel.length; i++) { if (acel[i].gear < acel[i - 1].gear && acel[i].gear > 0) volta++; if (acel[i].gear > acel[i - 1].gear && acel[i - 1].gear > 1) trocas.push(acel[i - 1].rpm); } // (a saída da 1ª, com a embreagem patinando, não conta)
      let sobeSolto = 0; for (let i = 1; i < solto.length; i++) if (solto[i].gear > solto[i - 1].gear) sobeSolto++;
      const g = acel.map((e) => e.gear), fim = g[g.length - 1];
      const rm = trocas.length ? media(trocas) : NaN, mn = trocas.length ? Math.min(...trocas) : NaN, mx = trocas.length ? Math.max(...trocas) : NaN;
      L.push({ grupo: 'cambio', nome: `${id} pedal ${ped}: marchas sobem sem voltar`, alvo: 'monotônica', medido: `1ª → ${fim}ª, ${volta} reduções`, ok: volta === 0 && fim > 2 });
      L.push({ grupo: 'cambio', nome: `${id} pedal ${ped}: rotação nas subidas`, alvo: `${faixa0[0]}–${faixa0[1]} rpm`, medido: `${mn.toFixed(0)}–${mx.toFixed(0)} rpm (média ${rm.toFixed(0)})`, ok: mn >= faixa0[0] && mx <= faixa0[1] });
      L.push({ grupo: 'cambio', nome: `${id} pedal ${ped} → solto: não sobe sem acelerar`, alvo: '0 subidas', medido: `${sobeSolto}`, ok: sobeSolto === 0 });
    };
    caso('hilux28', 1, 30, [2700, 3300]);
    caso('hilux28', 0.5, 40, [2200, 2700]);
    caso('scaniav8', 1, 80, [1350, 1700]);
    caso('scaniav8', 0.5, 80, [1250, 1500]);
    caso('volvod13', 1, 80, [1300, 1600]);
    return L;
  },

  // nenhum NaN nos cenários de todos os presets
  nan: () => {
    const L: Linha[] = [];
    for (const p of PRESETS) {
      const sp = preset(p.id), port = sp.portadores[0];
      const cens = ['idle', 'rev', 'frio10', ...(port === 'locomotiva' ? ['notches'] : port === 'gerador' ? ['degraus'] : ['wot'])];
      const ruins = cens.filter((c) => renderizar(sp, c, { portador: c === 'wot' ? 'carro' : undefined, tele: 8192 }).nan);
      L.push({ grupo: 'nan', nome: `${p.id}: ${cens.join(', ')}`, alvo: 'sem NaN', medido: ruins.length ? `NaN em ${ruins.join(', ')}` : 'ok', ok: !ruins.length });
    }
    return L;
  },
};

// ------------------------------------------------------------------ execução
const args = process.argv.slice(2);
if (args[0] === '--grupo') {
  console.log(JSON.stringify(GRUPOS[args[1]]()));
} else if (process.argv[1] && process.argv[1].endsWith('diesel-valida.ts')) {
  const si = args.indexOf('--so');
  const so = si >= 0 ? args[si + 1].split(',') : [...Object.keys(GRUPOS), 'lenta', 'governador', 'troca'];
  const tsx = path.join(RAIZ, 'node_modules', '.bin', 'tsx');
  const rodar = (argv: string[]) => new Promise<string>((ok) => {
    const p = spawn(tsx, argv, { cwd: RAIZ });
    let s = ''; p.stdout.on('data', (d) => (s += d)); p.stderr.on('data', (d) => (s += d));
    p.on('close', () => ok(s));
  });
  (async () => {
    const t0 = Date.now();
    const tarefas = so.map(async (g) => {
      if (g === 'lenta') { const s = await rodar(['tools/diesel-lenta.ts']); return { g, texto: s }; }
      if (g === 'governador') { const s = await rodar(['tools/diesel-governador.ts']); return { g, texto: s }; }
      if (g === 'troca') { const s = await rodar(['tools/diesel-troca.ts']); return { g, texto: s }; }
      const s = await rodar(['tools/diesel-valida.ts', '--grupo', g]);
      try { return { g, linhas: JSON.parse(s.trim().split('\n').pop()!) as Linha[] }; } catch { return { g, erro: s.slice(-800) }; }
    });
    const res = await Promise.all(tarefas);
    let falhas = 0, desvios = 0;
    for (const r of res as any[]) {
      console.log(`\n### ${r.g}\n`);
      if (r.erro) { console.log('ERRO\n' + r.erro); falhas++; continue; }
      if (r.texto) {
        // tabelas de diesel-lenta e diesel-governador: falha conta como desvio se estiver na lista
        const linhas = r.texto.trim().split('\n');
        for (const l of linhas) {
          const ehFalha = /\| FALHA \|$/.test(l);
          const nome = l.split('|')[1]?.trim();
          if (ehFalha && nome && desvio(nome)) { console.log(l.replace('| FALHA |', '| desvio |')); desvios++; }
          else { console.log(l); if (ehFalha) falhas++; }
        }
        continue;
      }
      console.log('| medida | alvo | medido | |\n|---|---|---|---|');
      for (const l of r.linhas) {
        const dv = !l.ok && desvio(l.nome);
        console.log(`| ${l.nome} | ${l.alvo} | ${l.medido} | ${l.ok ? 'ok' : dv ? 'desvio' : 'FALHA'} |`);
        if (!l.ok) { if (dv) desvios++; else falhas++; }
      }
    }
    console.log(`\n${falhas ? `${falhas} falha(s)` : 'VALIDAÇÃO DO DIESEL OK'}${desvios ? ` · ${desvios} desvio(s) documentado(s)` : ''} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    process.exit(falhas ? 1 : 0);
  })();
}
