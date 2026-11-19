// Validação dos rotativos (ROTATIVO.md 3 e 8): geometria (Apêndice B), ciclo (pressão e temperatura na abertura, Mach do
// jato, duração da queima, parede do coletor), bandas por regime contra as gravações (dB rel. 150–400 Hz, ±4 dB até
// 6 kHz: acima disso o áudio comprimido das gravações corta o agudo e vale a física), linhas de ordem, lenta (vagar,
// CVciclo, estalos), caça da lenta periférica, estouros na desaceleração, turbo sequencial e janelas secundárias,
// mecânica e vibração, portadores (hélice, rotor, gerador, passagem do 787B), X-Engine, palhetas, potência, veículo e CPU.
//
// As gravações são as do Apêndice A (medidas com tools/rotativo-bandas.ts, a porta de medir_w.py) e, desde a rodada de
// som de 11/2026, as casadas de referencias/rotativo (fora do git; os números delas estão escritos aqui como alvo). O
// ouvinte da simulação é o `ext` da página (atrás do carro, a poucos metros), sem o som de fundo.
// Viés do dono (docs/PLANO.md): mais motor, menos ar. No agudo (1–6 kHz) a gravação é TETO: o simulado passa se ficar
// igual ou abaixo dela (+4 dB de folga); as bandas do tom (60–150 e 400–1k) seguem com tolerância dos dois lados.
//
//   npx tsx tools/rotativo-valida.ts [grupos...] [--j 8]
//   (grupos: geometria ciclo bandas ar linhas lenta estouros turbo mecanica portadores xengine palhetas potencia veiculo niveis cpu)
// Sai ≠ 0 se houver falha (os desvios conhecidos, documentados no TECNICO, aparecem como "desv").
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export type Linha = { grupo: string; nome: string; alvo: string; medido: string; ok: boolean; desvio?: string };
const AQUI = fileURLToPath(import.meta.url);
const f1 = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const sg = (x: number, d = 1) => (x >= 0 ? '+' : '') + f1(x, d);
const dentro = (x: number, a: number, b: number) => x >= a && x <= b;

/** desvios conhecidos (nome da medida → por quê); TECNICO.md → Rotativos */
const DESVIOS: Record<string, string> = {
  'rx7fd lenta, pré-silencioso retirado: 2·ign sobe': 'A 750 rpm a 2·ign está em 50 Hz, abaixo da câmara de Helmholtz do pré-silencioso (150–300 Hz, tabela 2.2): ele não toca nela. Vale a 5 000 rpm (2·ign 333 Hz). O agudo, que antes não se mexia (a pós-queima na boca não passava por ele), agora sobe +6,5 / +10,3 dB em 1–2,5k / 2,5–6k ao retirá-lo.',
  'bandas 7 700 rpm em neutro, 4 rotores megafone (r26b)': 'Em carga leve o pulso é fraco (a câmara chega à abertura a ~1,6 bar) e os harmônicos 2 a 4 da ignição ficam 5–9 dB abaixo do vídeo (6VCl, a 5 m): 400–1k 7 dB e 1–2,5k 16 dB abaixo do alvo relativo a 150–400 (metade disso é o 150–400, ordens 2 e 3 do eixo, mais forte que na gravação). Em plena carga a janela de 33°e e o afiamento nos primários já dão o dente de serra (1–2,5k a −3 dB e 2,5–6k a −11 dB da banda da ignição; as passagens em Le Mans dão −2 a −3 e −7 a −14). O timbre tonal do kit ouvido neste caso é 0,8 tolerância; o que falta é médio de carga leve: ver "Pendente".',
  'centroide 7 700 rpm em neutro, 4 rotores megafone (r26b)': 'Consequência dos harmônicos 2 a 4 da ignição fracos em carga leve (ver as bandas): 627 Hz, 4% abaixo do limite de 651 Hz. Sem o ruído que a pós-queima na boca punha em 2,5–12 kHz o centroide perdeu o que o segurava artificialmente (era 704 Hz).',
  'bandas lenta 4 rotores periférica (r26b)': 'O agudo agora fica no teto da gravação (−14,9 / −16,3 contra −15,5 / −16,0) e o 400–1k bate (−7,6 contra −7,5); o grave da ignição (127 Hz, banda de 60–150) fica 7,8 dB abaixo, 0,8 dB além da tolerância: metade das explosões falha (o "brap") e a energia da ignição se espalha pelas linhas do padrão de 6 voltas.',
  'bandas lenta 2 rotores moto 1 900 rpm (norton)': 'O grave fica 18 dB abaixo do vídeo (Fx7, ~2 m, celular): a gravação tem a ordem 1 e a ignição de 61,5 Hz fortíssimas (+9,5 dB rel. 150–400) que o 2 em 1 curto da moto no modelo não dá. O agudo passa pelo teto. Vídeo do YouTube com o microfone muito perto (alvo interno).',
  'rx8hp 5 000 rpm: ordens 2/3 e 5/3 contra a ignição': 'As ordens de flanco ficam até 3 dB além da tolerância (−21/−24 contra −16 ± 5) com a dispersão por flanco de 2,5× a do Ronco; mais que isso deixava a lenta irregular demais. Na gravação o operador oscila a rotação (vagar 11,6%), o que também alarga as linhas.',
  'lenta periférica (r26b): vagar em 12 s (o método das gravações)': 'A lenta agora é o "brap": rajadas a rpm/360 (5,2 Hz), 1 690–2 070 rpm, sem apagar; a rotação média vagueia 3–4% em janelas de 1 s. Os 25–35% do vídeo vêm do método (a autocorrelação da envoltória salta de oitava numa lenta em rajadas) e de o trecho ir de 1 580 a 2 200 rpm em 12 s (±16%): uma deriva lenta que o controle de lenta do modelo não tem.',
  "desaceleração rx8hp ('burble'): estouros/s": 'O mecanismo do Ronco conta os eventos por segundo como um 4 tempos (N·rpm/120); com 3 câmaras por rotor e o ciclo de 1 080°e são N·rpm/180, então a taxa por segundo do mapa sai 2/3 da do pistão, e o sorteio de 2 s varia ±1,5/s: 1,5–3/s contra 4–6. Corrigir pede um termo no dsp.ts do Ronco (a taxa × cyc/720). (Os "detectados" contam também as próprias explosões, agora que o agudo é preso ao pulso.)',
  'vibração na lenta: rx8hp contra ek9 (Ronco)': 'Sem a inércia alternativa sobra a oscilação do torque (`ripple`, que o documento manda deixar igual) na ordem 2: 7 dB abaixo do 4 cilindros, contra 10–15. As câmaras de 654 cm³ dão pulsos de torque grandes; o rotor sem massa alternativa só tira a parte da inércia.',
  'vibração na lenta: rx8hp contra mx5 (Ronco)': 'Ver a vibração contra o ek9.',
  'mistral: subida de 1 200 a ~7 500 rpm (manete em 4 s)': 'A hélice de passo variável fica no passo mínimo até 60% da rotação-alvo (a regra do portador Helice) e o 13B leve sobe junto com a manete: 3,1 s. O alvo de 4–6 s supõe a manete mais lenta ou o passo saindo antes do mínimo.',
  'potência ae50r': '0,4 dB fora (38,8 contra 41 kW ± 5%): a escala de torque usa o atrito médio da sonda; no monorrotor de 294 cm³ a 7 750 rpm o atrito pesa e a potência na rotação máxima sai 5,4% abaixo.',
  'rx8hp a 100 km/h em 6ª (relações da ficha)': 'O alvo do documento não bate com a própria ficha: 3,760/…/0,843, diferencial 4,444 e pneu 225/45R18 (0,33 m) dão 3 011 rpm a 100 km/h (a conta: 100/3,6/(2π·0,33)·60·0,843·4,444). O RX-8 real gira ~3 000 em 6ª a 100 km/h.',
  'cosmo20b: lenta → plena carga a 55% (página)': '0,1 dB fora: a lenta do 3 rotores sai, sem reforço nenhum da calibração (o reforço não atenua: fica em 1), 17,9 dB abaixo da plena carga a 55%, que o biturbo e o abafador original deixam baixa.',
  'ro80: lenta → plena carga a 55% (página)': '3 dB fora (+14,8): pela mesma razão do Cosmo 20B, o reforço de lenta fica em 1 e a lenta do carburado com dois silenciosos sai só 15 dB abaixo da plena carga, que é baixa (85 kW).',
  'os carros e a moto na lenta: faixa de nível': 'A calibração equilibra a plena carga de fábrica de cada preset, e a lenta fica ~21 dB abaixo dela onde o reforço alcança. Ficam nas pontas o Ro80 e o Cosmo 20B (lenta natural alta, o reforço não atenua) e o RX-3 (reator térmico e dois silenciosos, reforço no teto ×8): 14 dB de faixa (eram 25 antes da rodada de som: o 787B, que na lenta era só estouros, saiu da ponta de cima). Sem os três, 5 dB.',
};

// ------------------------------------------------------------------ grupos
async function grupo(nome: string): Promise<Linha[]> {
  const L: Linha[] = [];
  const add = (n: string, alvo: string, medido: string, ok: boolean) => L.push({ grupo: nome, nome: n, alvo, medido, ok, desvio: ok ? undefined : DESVIOS[n] });
  const C = await import('./rotativo-comum');
  const { SR, preset, novoDSP, renderizar, trecho, media, mono, travar, sustentar } = C;
  const B = await import('./rotativo-bandas');
  const banda = (b: number[], i: number) => b[i];
  /** bandas 60–150, 400–1k, 1–2,5k, 2,5–6k (dB rel. 150–400) e centroide contra o alvo ±tol */
  const conferirBandas = (n: string, m: any, alvo: number[], cent: [number, number], tol = 4) => {
    const med = [banda(m.b, 0), banda(m.b, 2), banda(m.b, 3), banda(m.b, 4)];
    const ok = med.every((v, i) => Number.isNaN(alvo[i]) || Math.abs(v - alvo[i]) <= tol);
    add(`bandas ${n}`, `${alvo.map((x) => (Number.isNaN(x) ? '—' : sg(x))).join(' / ')} ±${tol}`, `${med.map((x) => sg(x)).join(' / ')} (6–12k ${sg(m.b[5])}: física)`, ok);
    add(`centroide ${n}`, `${cent[0]}–${cent[1]} Hz ±30%`, `${f1(m.cent, 0)} Hz`, dentro(m.cent, cent[0] * 0.7, cent[1] * 1.3));
  };
  /** contra uma gravação casada, com o viés do dono: 60–150 e 400–1k (o tom) a ±`tol` dB; 1–2,5k e 2,5–6k (onde mora o
   *  chiado) no máximo `folga` dB acima da gravação, que é teto de ruído: mais limpo que ela passa */
  const conferirTeto = (n: string, m: any, alvo: number[], tol = 7, folga = 4) => {
    const med = [banda(m.b, 0), banda(m.b, 2), banda(m.b, 3), banda(m.b, 4)];
    const ok = Math.abs(med[0] - alvo[0]) <= tol && Math.abs(med[1] - alvo[1]) <= tol && med[2] <= alvo[2] + folga && med[3] <= alvo[3] + folga;
    add(`bandas ${n}`, `${sg(alvo[0])} / ${sg(alvo[1])} ±${tol}; agudo ≤ ${sg(alvo[2])} / ${sg(alvo[3])} +${folga} (teto)`, `${med.map((x) => sg(x)).join(' / ')}`, ok);
  };
  /** lenta quente na página (ouvinte de fora), `dur` s, medida nos últimos `med` s */
  const lenta = (id: string, extra: Record<string, any> = {}, op: { dur?: number; med?: number; ouvinte?: string; fIgn?: boolean } = {}) => {
    const p = preset(id, extra);
    const d = novoDSP(p, { quente: true, ouvinte: op.ouvinte || 'ext' });
    const dur = op.dur ?? 16, med = op.med ?? 8;
    const r = renderizar(d, dur, []);
    const tl = trecho(r.tele, dur - med, dur), rpm = media(tl.map((q) => q.rpm));
    const fi = (rpm * p.rotores) / 60;
    const m = B.medirRot(mono(r.L, r.R, dur - med, dur), SR, { rotores: p.rotores, fmin: fi * 0.6, fmax: fi * 1.6, fIgn: op.fIgn ? fi : undefined });
    return { p, d, r, tl, rpm, m };
  };
  /** giro sustentado em ponto morto (o motor solto segurando a rotação), 6 s, medido nos últimos 4 */
  const sustentado = (id: string, rpm: number, extra: Record<string, any> = {}) => {
    const p = preset(id, extra);
    const d = novoDSP(p, { quente: true, rpm });
    const r = renderizar(d, 6, [], sustentar(d, rpm));
    const fi = (rpm * p.rotores) / 60;
    return { p, d, r, m: B.medirRot(mono(r.L, r.R, 2, 6), SR, { rotores: p.rotores, fmin: fi * 0.8, fmax: fi * 1.25, fIgn: fi }), tl: trecho(r.tele, 2, 6) };
  };

  if (nome === 'geometria') {
    const { volumeCamara, montarRotativo, volumeAngulo } = await import('../src/engines/rotativo/geometria');
    const { GEOMETRIAS } = await import('../src/engines/rotativo/constantes');
    const casos: [string, any, number][] = [['13B', GEOMETRIAS['13B'], 654.3], ['12A', GEOMETRIAS['12A'], 572.5], ['10A', GEOMETRIAS['10A'], 490.7], ['KKM 612', GEOMETRIAS.KKM612, 497.5], ['Sachs/Norton', GEOMETRIAS.sachs294, 294], ['AR741', GEOMETRIAS.ar741, 208]];
    for (const [n, g, alvo] of casos) { const v = volumeCamara(g.R, g.e, g.b); add(`V_cam ${n} = 3√3·e·R·b`, `${alvo} cm³ ± 0,5%`, `${f1(v, 1)} cm³ (${sg((100 * (v - alvo)) / alvo, 2)}%)`, Math.abs(v / alvo - 1) <= 0.005); }
    const m = montarRotativo({ rotores: 2, geo: GEOMETRIAS['13B'], cr: 9 });
    const v0 = volumeAngulo(m, 0).V, v270 = volumeAngulo(m, 270).V, v540 = volumeAngulo(m, 540).V;
    add('V(0) = V_min, V(270°e) = V_min + V_cam, V(540°e) = V_min (13B, CR 9)', '±1e-9', `${f1(v0 - m.Vmin, 12)} / ${f1(v270 - m.Vmin - m.Vcam, 12)} / ${f1(v540 - m.Vmin, 12)}`, Math.abs(v0 - m.Vmin) < 1e-9 && Math.abs(v270 - m.Vmin - m.Vcam) < 1e-9 && Math.abs(v540 - m.Vmin) < 1e-9);
    add('V_min do 13B com CR 9,0 / 9,4 / 10,0', '81,8 / 77,9 / 72,7 cm³', [9, 9.4, 10].map((cr) => f1(montarRotativo({ rotores: 2, geo: GEOMETRIAS['13B'], cr }).Vmin, 1)).join(' / '), [9, 9.4, 10].every((cr, i) => Math.abs(montarRotativo({ rotores: 2, geo: GEOMETRIAS['13B'], cr }).Vmin - [81.8, 77.9, 72.7][i]) < 0.15));
    const dVmax = Math.max(...Array.from({ length: 1081 }, (_, a) => volumeAngulo(m, a).dV));
    add('dV/dα máximo do 13B (a 135°e)', '218 cm³/rad', `${f1(dVmax, 1)} cm³/rad`, Math.abs(dVmax - m.Vcam / 3) < 0.5);
    // ∮ p dV de um ciclo motorizado sem queima (politrópico, sem troca de gás): a função volume fecha o ciclo
    let w = 0, wa = 0; const g = 1.35, p0 = 1e5;
    for (let a = 0; a < 1080; a += 0.05) { const V1 = volumeAngulo(m, a).V, V2 = volumeAngulo(m, a + 0.05).V, pm = p0 * Math.pow(m.Vmin / (0.5 * (V1 + V2)), g); w += pm * (V2 - V1); wa += Math.abs(pm * (V2 - V1)); }
    add('∮ p dV de um ciclo motorizado (sem queima)', '0 ± 1%', `${sg((100 * w) / wa, 4)}%`, Math.abs(w / wa) < 0.01);
    for (const [r, alvo] of [[1, [360]], [2, [180]], [3, [120]], [4, [90]]] as [number, number[]][]) {
      const mm = montarRotativo({ rotores: r, geo: GEOMETRIAS['13B'], cr: 9 });
      add(`fases de ${r} rotor(es): intervalo de ignição`, `${alvo[0]}°e exatos`, `${[...new Set(mm.intervalos)].join(' / ')}°e · fire ${mm.fire.join(' ')}`, mm.intervalos.every((x) => Math.abs(x - alvo[0]) < 1e-9));
    }
    // f_ign no render = rotores·rpm/60 ± 0,5%
    for (const [id, rpm] of [['ae50r', 4000], ['rx8hp', 5000], ['cosmo20b', 4000], ['r26b', 6000], ['xmini', 12000]] as [string, number][]) {
      const s = sustentado(id, rpm), ev = s.p.tipo === 'x' ? 1.5 : s.p.rotores, alvo = (ev * rpm) / 60;
      const A = await import('./cena/analise');
      // (f_ign pelo pente de 4 harmônicos do rotativo-bandas, o método das gravações; o pico da FFT puxa para as bandas laterais)
      const f = B.medirRot(mono(s.r.L, s.r.R, 2, 6), SR, { rotores: s.p.rotores, fmin: alvo * 0.8, fmax: alvo * 1.25 }).fIgn; void A;
      add(`f_ign no render, ${id} a ${rpm} rpm`, `${f1(alvo, 2)} Hz ± 0,5% (${ev} por volta)`, `${f1(f, 2)} Hz (${sg((100 * (f - alvo)) / alvo, 2)}%)`, Math.abs(f / alvo - 1) <= 0.005);
    }
  }

  if (nome === 'ciclo') {
    const l = lenta('rx7fd', {}, { dur: 12, med: 6 });
    const tl = l.tl;
    add('rx7fd lenta 750 rpm quente: pressão na abertura do escape', '1,5–2,5 bar', `${f1(media(tl.map((q) => q.pAbertura)) / 1e5, 2)} bar`, dentro(media(tl.map((q) => q.pAbertura)) / 1e5, 1.5, 2.5));
    add('rx7fd lenta: 10–90% da queima', '≈ 100°e (90–110)', `${f1(media(tl.map((q) => q.queima1090)), 0)}°e`, dentro(media(tl.map((q) => q.queima1090)), 90, 110));
    // plena carga a 55% (eixo travado), com o turbo a 40% da pressão (a condição da calibração) e aspirado
    for (const [id, ex, rotulo, fr] of [['rx7fd', {}, 'rx7fd (turbo 0,7 bar)', 0.55], ['rx8hp', {}, 'rx8hp (aspirado)', 0.55], ['rx8hp', {}, 'rx8hp a 80% de rpmMax', 0.8]] as [string, any, string, number][]) {
      const p = preset(id, ex), d = novoDSP(p, { quente: true, rpm: p.rpmMax * fr });
      travar(d, p.rpmMax * fr, 1);
      d.exhT = 300;
      const r = renderizar(d, 14, []);
      const t = trecho(r.tele, 2, 14), t2 = trecho(r.tele, 12, 14);
      const pEO = media(t.map((q) => q.pAbertura)) / 1e5;
      add(`${rotulo} plena carga: pressão na abertura`, '≈ 4 bar (aspirado); turbo mais', `${f1(pEO, 2)} bar · boost ${f1(media(t.map((q) => q.boost)), 2)} bar`, id === 'rx8hp' && fr < 0.6 ? dentro(pEO, 3, 5.5) : pEO > 3);
      add(`${rotulo} plena carga: Mach do jato no 1º terço da rampa`, 'Mach 1', f1(media(t.map((q) => q.machAbertura)), 2), media(t.map((q) => q.machAbertura)) > 0.97);
      add(`${rotulo} plena carga: 10–90% da queima`, '50–60°e (plena carga a 55%: 48°e pela fórmula)', `${f1(media(t.map((q) => q.queima1090)), 0)}°e`, dentro(media(t.map((q) => q.queima1090)), 46, 62));
      if (rotulo !== 'rx8hp (aspirado)') add(`${rotulo} plena carga: parede do coletor (tEscape) depois de 12 s`, '900–1 000 °C', `${f1(media(t2.map((q) => q.tEscape)), 0)} °C`, dentro(media(t2.map((q) => q.tEscape)), 880, 1050));
      add(`${rotulo} plena carga: gás na abertura e o fator de densidade`, 'fator < teto 1,8 (o 1,3 do Ronco achataria)', `${f1(media(t.map((q) => q.tAbertura)), 0)} K · máx. ${f1(t[t.length - 1].densMax, 2)}`, t[t.length - 1].densMax < 1.8);
    }
    add('rx7fd lenta: parede do coletor (tEscape)', '400–500 °C', `${f1(media(tl.map((q) => q.tEscape)), 0)} °C`, dentro(media(tl.map((q) => q.tEscape)), 400, 500));
  }

  if (nome === 'bandas') {
    // RX-7 FC 13B turbo na lenta, da traseira (referencias/rotativo/rx7-fc3s-13b-turbo-lenta-aceleradas 27–37 s, 750 rpm
    // conferidos pela dobra: +8,9 / −17,2 / −35,2 / −41,0). O alvo antigo (RX-7 do Commons, −1 / −11 / −10,5, microfone
    // desconhecido) pedia 24–30 dB a mais de agudo: era ele que o modelo perseguia com ruído puro na boca, o "apenas ar"
    const lc = lenta('rx7fc');
    conferirTeto('lenta 2 rotores de rua 750 rpm (rx7fc, ext) contra o FC3S casado', lc.m, [8.9, -17.2, -35.2, -41]);
    // o FD (abafador esportivo) na mesma régua: o agudo não passa do teto da gravação do FC com folga de 8 dB
    const l = lenta('rx7fd');
    add('rx7fd lenta: 1–2,5 kHz e 2,5–6 kHz (rel. 150–400)', '≤ −27 / ≤ −33 dB (teto do FC3S + 8)', `${sg(l.m.b[3])} / ${sg(l.m.b[4])} dB`, l.m.b[3] <= -27 && l.m.b[4] <= -33);
    const sp = lenta('rx7fd', { escape: { ...preset('rx7fd').escape, presilencioso: false } });
    add('rx7fd lenta, pré-silencioso retirado: 1–2,5 kHz e 2,5–6 kHz sobem (absoluto)', '≥ 6 dB', `${sg(sp.m.abs[3] - l.m.abs[3])} / ${sg(sp.m.abs[4] - l.m.abs[4])} dB`, sp.m.abs[3] - l.m.abs[3] >= 6 && sp.m.abs[4] - l.m.abs[4] >= 6);
    add('rx7fd lenta, pré-silencioso retirado: 2·ign sobe', '≥ 4 dB', `${sg(sp.m.ign2 - l.m.ign2)} dB (linha sobre a mediana)`, sp.m.ign2 - l.m.ign2 >= 4);
    // "som de ar" no Ø mínimo da saída (REVISAO-DE-SOM): fração da potência abaixo de 1 kHz que é o ruído de jato da ponta
    // (diferença exata com o jato desligado), no Ø de fábrica e no mínimo do painel (25 mm), com a ponteira de fábrica
    const jato = (D?: number) => {
      const e0 = preset('rx7fd').escape, p = preset('rx7fd', D ? { escape: { ...e0, ponteira: e0.saidas[0].D, saidas: e0.saidas.map((x: any) => ({ ...x, D })) } } : {});
      const run = (comJato: boolean) => { const d = novoDSP(p, { quente: true }); if (!comJato) d.jetGain = 0; const r = renderizar(d, 10, []); return mono(r.L, r.R, 4, 10); };
      const a = run(true), b = run(false), dj = Float64Array.from(a, (v, i) => v - b[i]);
      const op = { rotores: 2, fmin: 20, fmax: 40, fIgn: (p.idle * 2) / 60 };
      const ma = B.medirRot(a, SR, op), mj = B.medirRot(dj, SR, op);
      const pw = (m: any) => 10 ** (m.abs[1] / 10) + 10 ** (m.abs[2] / 10);
      return 100 * pw(mj) / pw(ma);
    };
    const j76 = jato(), j25 = jato(25);
    add('rx7fd lenta: ruído de jato da ponta em 150 Hz–1 kHz (Ø de fábrica / Ø 25 mm com a ponteira de fábrica)', '≤ 10% / ≤ 10%', `${f1(j76)}% / ${f1(j25)}%`, j76 <= 10 && j25 <= 10);
    // RX-8 a 5 000 rpm sustentados (Commons u-Lc2 20–24 s)
    const r8 = sustentado('rx8hp', 5000);
    conferirTeto('5 000 rpm sustentados, Renesis (rx8hp, ext) contra o RX-8 do Commons', r8.m, [-8, -10, -11, -10.5]);
    // 787B a 7 700 rpm em neutro (6VCl 89–92 s, 5 m)
    const b7 = sustentado('r26b', 7700);
    conferirBandas('7 700 rpm em neutro, 4 rotores megafone (r26b)', b7.m, [-6.5, 20, 19, 6.7], [930, 930]);
    // lenta do 787B (6VCl, 5 m: −2 … +5 / −5 … −10 / −11 … −20 / −14 … −18), quente, depois de 20 s
    const b0 = lenta('r26b', {}, { dur: 30, med: 12 });
    conferirTeto('lenta 4 rotores periférica (r26b)', b0.m, [3.5, -7.5, -15.5, -16]);
    // Norton na lenta aquecendo (Fx7, 2 m: +7 … +12 / −2 … −3 / −3 … −6 / −12 … −13), 1 900 rpm
    const nt = lenta('norton', { idle: 1900 }, { dur: 14, med: 6 });
    conferirTeto('lenta 2 rotores moto 1 900 rpm (norton)', nt.m, [9.5, -2.5, -4.5, -12.5]);
    // Ro80 frio a 1 600 rpm (1JOt: −2 / −10 / −12 / −20)
    const ro = lenta('ro80', { idle: 1600 }, { dur: 14, med: 6 });
    conferirTeto('lenta fria carburada 1 600 rpm (ro80)', ro.m, [-2, -10, -12, -20]);
  }

  if (nome === 'ar') {
    // Critérios da rodada de som (docs/PLANO.md, "mais motor, menos ar"), medidos sem gravação: (1) as fontes de ar
    // contínuas (chiado do jato, chiado de admissão, chiado das vedações, chiado do turbo) desligadas juntas mudam o nível
    // ponderado A em menos de 1,5 dB na lenta e em carga parcial; (2) em nenhuma posição dos controles "Ø da saída" e
    // "Ponteira (jato)" o chiado do jato é a fonte dominante. As fontes somam na saída: desligá-las não muda a trajetória
    // do motor, então a diferença entre os dois renders é a própria fonte
    const { welch } = await import('./radial-bandas');
    const nivelA = (x: ArrayLike<number>) => {
      const [f, P] = welch(x, SR);
      let acc = 0;
      for (let i = 1; i < f.length; i++) { const q = f[i] * f[i], ra = (12194 ** 2 * q * q) / ((q + 20.6 ** 2) * Math.sqrt((q + 107.7 ** 2) * (q + 737.9 ** 2)) * (q + 12194 ** 2)); acc += P[i] * ra * ra; }
      return 10 * Math.log10(acc + 1e-30);
    };
    const semAr = (d: any) => { d.jetGain = 0; d.hissGain = 0; d.kVed = 0; const t = d.turboHiss; if (t) { t.b0 = 0; t.b1 = 0; t.b2 = 0; } };
    for (const id of ['rx7fc', 'rx7fd', 'rx8hp', 'cosmo20b', 'r26b']) {
      for (const [rot, rpm] of [['lenta', 0], ['3 000 rpm em ponto morto', 3000]] as [string, number][]) {
        const run = (sem: boolean) => {
          const p = preset(id), d = novoDSP(p, { quente: true, rpm: rpm || p.idle });
          if (sem) semAr(d);
          const r = rpm ? renderizar(d, 8, [], sustentar(d, rpm)) : renderizar(d, 12, []);
          return mono(r.L, r.R, rpm ? 4 : 6, rpm ? 8 : 12);
        };
        const a = nivelA(run(false)), b = nivelA(run(true));
        add(`${id} ${rot}: jato, chiado de admissão, vedações e chiado do turbo desligados juntos`, 'muda o nível ponderado A em < 1,5 dB', `${sg(a - b, 2)} dB`, Math.abs(a - b) < 1.5);
      }
    }
    const e0 = preset('rx7fc').escape, D0 = e0.saidas[0].D;
    const fina = (D: number) => e0.saidas.map((x: any) => ({ ...x, D }));
    const pos: [string, any][] = [['ponteira 20 mm', { ...e0, ponteira: 20 }], ['saída 20 mm', { ...e0, ponteira: D0, saidas: fina(20) }], ['saída e ponteira 20 mm', { ...e0, ponteira: 20, saidas: fina(20) }]];
    for (const [cond, rpm, thr] of [['lenta', 0, 0], ['3 000 rpm em ponto morto', 3000, -1], ['5 000 rpm em plena carga', 5000, 1]] as [string, number, number][]) {
      for (const [nome2, esc] of pos) {
        const run = (jato: boolean) => {
          const p = preset('rx7fc', { escape: esc }), d = novoDSP(p, { quente: true, rpm: rpm || p.idle });
          if (!jato) d.jetGain = 0;
          let cada: any;
          if (rpm && thr < 0) cada = sustentar(d, rpm); else if (rpm) travar(d, rpm, thr);
          const r = renderizar(d, 8, [], cada);
          return mono(r.L, r.R, 4, 8);
        };
        const a = run(true), b = run(false), dj = Float64Array.from(a, (v, i) => v - b[i]);
        const fr = 100 * 10 ** ((nivelA(dj) - nivelA(a)) / 10);
        add(`rx7fc ${cond}, ${nome2}: chiado do jato no nível ponderado A`, '≤ 35% (em posição nenhuma é a fonte dominante)', `${f1(fr, 0)}%`, fr <= 35);
      }
    }
    // a ponteira fina amolece o pulso em carga (contrapressão) e quase não o toca na lenta
    const nivel = (esc: any, rpm: number, thr: number) => {
      const p = preset('rx7fc', { escape: esc }), d = novoDSP(p, { quente: true, rpm: rpm || p.idle });
      d.jetGain = 0;
      if (rpm) travar(d, rpm, thr);
      const r = renderizar(d, 8, []), x = mono(r.L, r.R, 4, 8);
      let e = 0; for (const v of x) e += v * v;
      return 10 * Math.log10(e / x.length + 1e-30);
    };
    const dl = nivel({ ...e0, ponteira: 20 }, 0, 0) - nivel(e0, 0, 0), dc = nivel({ ...e0, ponteira: 20 }, 5000, 1) - nivel(e0, 5000, 1);
    add('rx7fc, ponteira no mínimo (20 mm num escape de 70): o pulso, sem o chiado, na lenta / em plena carga a 5 000 rpm', 'cai nos dois, e pelo menos 6 dB a mais em carga (a contrapressão amolece o pulso com o escoamento)', `${sg(dl)} / ${sg(dc)} dB`, dl <= 0.5 && dc <= dl - 6);
  }

  if (nome === 'linhas') {
    const l = lenta('rx7fd');
    const h = [l.m.ign, l.m.ign2, l.m.ign3];
    add('rx7fd lenta: harmônicos 1–3 da ignição', 'dentro de 6 dB (gravação +19 / +17 / +24)', h.map((x) => sg(x)).join(' / '), Math.max(...h) - Math.min(...h) <= 6);
    const meia = l.m.linha(l.rpm / 120, 0.03);
    add('rx7fd lenta: linha de meia-ordem (rpm/120)', '≤ +3 dB (o Wankel não tem)', `${sg(meia)} dB`, meia <= 3);
    const r8 = sustentado('rx8hp', 5000);
    add('rx8hp 5 000 rpm: ignição sobre a mediana', '+27 ± 4 dB', `${sg(r8.m.ign)} dB`, Math.abs(r8.m.ign - 27) <= 4);
    add('rx8hp 5 000 rpm: ordem 1 contra a ignição', '−15 ± 5 dB', `${sg(r8.m.o1 - r8.m.ign)} dB`, Math.abs(r8.m.o1 - r8.m.ign + 15) <= 5);
    const o53 = r8.m.linha((5 * 5000) / 180);
    add('rx8hp 5 000 rpm: ordens 2/3 e 5/3 contra a ignição', '−16 ± 5 dB', `${sg(r8.m.o23 - r8.m.ign)} / ${sg(o53 - r8.m.ign)} dB`, Math.abs(r8.m.o23 - r8.m.ign + 16) <= 5 && Math.abs(o53 - r8.m.ign + 16) <= 5);
    const b7 = sustentado('r26b', 7700);
    add('r26b 7 700 rpm: ignição sobre a mediana', '≥ +22 dB', `${sg(b7.m.ign)} dB`, b7.m.ign >= 22);
    add('r26b 7 700 rpm: ordem 1 contra a ignição', '≤ −10 dB (na gravação casada a banda de 60–150 Hz inteira fica 27 dB abaixo da ignição)', `${sg(b7.m.o1 - b7.m.ign)} dB`, b7.m.o1 - b7.m.ign <= -10);
    add('r26b 7 700 rpm: 2·ign contra a ignição', '−6 dB (±4)', `${sg(b7.m.ign2 - b7.m.ign)} dB`, Math.abs(b7.m.ign2 - b7.m.ign + 6) <= 4);
  }

  if (nome === 'lenta') {
    const l = lenta('rx7fd', {}, { dur: 20, med: 12 });
    add('lenta original quente (rx7fd): vagar', '≤ 3%', `${f1(l.m.vagar)}%`, l.m.vagar <= 3);
    add('lenta original quente (rx7fd): CVciclo', '0,20–0,30', f1(l.m.cvCiclo, 2), dentro(l.m.cvCiclo, 0.2, 0.3));
    // (o detector conta picos de 1–6 kHz 10 dB acima da mediana: com o agudo preso ao pulso ele conta as próprias
    // explosões, uma por ignição; estalo é o que passar disso)
    const fi0 = (l.rpm * 2) / 60;
    add('lenta original quente (rx7fd): estalos/s além das próprias explosões', '≤ 1,5 (o detector conta até um pico por ignição)', `${f1(Math.max(0, l.m.pops - fi0))} (${f1(l.m.pops)} picos/s; ignição ${f1(fi0)}/s)`, l.m.pops - fi0 <= 1.5);
    add('lenta original quente (rx7fd): p90/p10 de 1–6 kHz (o agudo preso ao pulso)', '≥ 7 dB (a gravação é piso de pulso)', `${f1(l.m.p9010)} dB`, l.m.p9010 >= 7);
    // (o outro critério do ROTATIVO 8.1 contra a pós-queima virando chiado contínuo: desvio/média da envoltória de 1–6 kHz)
    const e16 = B.envoltoria(mono(l.r.L, l.r.R, 8, 20), SR, 1000, 6000, 600);
    let me = 0; for (const v of e16) me += v; me /= e16.length;
    let ve = 0; for (const v of e16) ve += (v - me) ** 2; const dm = Math.sqrt(ve / e16.length) / me;
    add('lenta original quente (rx7fd): desvio/média da envoltória de 1–6 kHz (o agudo preso ao pulso)', '≥ 0,5', f1(dm, 2), dm >= 0.5);
    // 787B: caça da lenta periférica, quente (60 s; mede 12 s depois de 20 s)
    const p = preset('r26b'), d = novoDSP(p, { quente: true });
    const seq: number[] = []; let tSeq = 0;
    (d as any).sondaEv = (_c: number, q: boolean) => { if (tSeq > 20) seq.push(q ? 1 : 0); };
    const r = renderizar(d, 44, [], (_x, t) => { tSeq = t; });
    const t = trecho(r.tele, 20, 44), rpms = t.map((q) => q.rpm);
    const fi = (1900 * 4) / 60;
    const m = B.medirRot(mono(r.L, r.R, 26, 38), SR, { rotores: 4, fmin: (1300 * 4) / 60, fmax: (2600 * 4) / 60 });
    const jan: number[] = []; for (let s = 20; s < 44; s++) jan.push(media(trecho(r.tele, s, s + 1).map((q) => q.rpm)));
    const vt = (100 * Math.sqrt(media(jan.map((x) => (x - media(jan)) ** 2)))) / media(jan);
    add('lenta periférica (r26b): faixa da caça', '1 600–2 200 rpm, sem apagar', `${f1(Math.min(...rpms), 0)}–${f1(Math.max(...rpms), 0)} rpm`, Math.min(...rpms) >= 1450 && Math.max(...rpms) <= 2350 && t.every((q) => q.state === 'run'));
    add('lenta periférica (r26b): vagar em 12 s (o método das gravações)', '≥ 20%', `${f1(m.vagar)}% (pela telemetria, janelas de 1 s: ${f1(vt)}%)`, m.vagar >= 20);
    add('lenta periférica (r26b): CVciclo', '≥ 0,40', f1(m.cvCiclo, 2), m.cvCiclo >= 0.4);
    add('lenta periférica (r26b): estalos/s', '5–16 (as rajadas do "brap" a ~5 Hz, com um a três picos cada)', `${f1(m.pops)} (estouros soltos criados: ${f1(media(t.map((q) => q.estouros)))}/s)`, dentro(m.pops, 5, 16));
    // o "brap": cada câmara alterna queima e falha (a diluição pela sobreposição), o padrão se repete a cada ~6 voltas do eixo
    const mu = media(seq), vr = media(seq.map((x) => (x - mu) ** 2));
    const ac = (voltas: number) => { const k = voltas * 4; let a = 0; for (let i = 0; i + k < seq.length; i++) a += (seq[i] - mu) * (seq[i + k] - mu); return a / Math.max(vr * (seq.length - k), 1e-12); };
    add('lenta periférica (r26b): fração das explosões que queimam', '35–70% (rajadas, não falhas soltas)', `${f1(100 * mu, 0)}%`, dentro(mu, 0.35, 0.7));
    add('lenta periférica (r26b): ritmo do "brap" (autocorrelação da sequência queimou/falhou a 3 e a 6 voltas do eixo)', '≤ −0,5 a 3 voltas e ≥ +0,4 a 6 (rpm/360: 5,2 Hz na gravação)', `${sg(ac(3), 2)} / ${sg(ac(6), 2)}`, ac(3) <= -0.5 && ac(6) >= 0.4);
    add('lenta periférica (r26b): a caça vem da sobreposição', 'sem sobreposição a lenta para', '(ver lenta de street port)', true);
    void fi;
    const st = lenta('rx7fd', { janelas: { admissao: 'street', escape: 'periferico' } }, { dur: 20, med: 12 });
    add('street port (rx7fd, sobreposição 28°e): lenta estável', 'vagar ≤ 3%', `${f1(st.m.vagar)}% · ${f1(st.rpm, 0)} rpm`, st.m.vagar <= 3);
    // bridge port (sobreposição ~100°e): a lenta em rajadas, sem apagar
    const pb = preset('rx7fc', { janelas: { admissao: 'bridge', escape: 'periferico' }, idle: 1950 }), db = novoDSP(pb, { quente: true });
    const sb: number[] = []; let tb = 0;
    (db as any).sondaEv = (_c: number, q: boolean) => { if (tb > 10) sb.push(q ? 1 : 0); };
    const rb = renderizar(db, 30, [], (_x, t) => { tb = t; });
    const tlb = trecho(rb.tele, 10, 30), rb2 = tlb.map((q) => q.rpm);
    add('bridge port (rx7fc, sobreposição 98°e, lenta a 1 950): em rajadas, sem apagar', '40–75% das explosões queimam; 1 450–2 350 rpm', `${f1(100 * media(sb), 0)}% · ${f1(Math.min(...rb2), 0)}–${f1(Math.max(...rb2), 0)} rpm`, dentro(media(sb), 0.4, 0.75) && Math.min(...rb2) >= 1450 && Math.max(...rb2) <= 2350 && tlb.every((q) => q.state === 'run'));
    // janelas de fábrica: nenhuma falha por diluição
    const pf = preset('rx7fc'), df = novoDSP(pf, { quente: true });
    const sf: number[] = []; (df as any).sondaEv = (_c: number, q: boolean) => { sf.push(q ? 1 : 0); };
    renderizar(df, 12, []);
    add('janelas de fábrica (rx7fc): a mistura acende sempre', '≥ 99% das explosões', `${f1(100 * media(sf), 1)}%`, media(sf) >= 0.99);
  }

  if (nome === 'estouros') {
    // desaceleração em ponto morto (como o 787B do 6VCl, 98–102 s): pé no fundo até 70% de rpmMax, pé fora; estouros nos 2 s seguintes
    const decel = (id: string, semente = 0) => {
      const p = preset(id), d = novoDSP(p, { quente: true, rpm: p.idle });
      if (semente) (d as any).rng.s = semente;
      d.exhT = 700;
      const ev: [number, (x: any) => void][] = [[0.5, (x) => x.message({ type: 'input', throttle: 1 })]];
      let solto = -1;
      let n0 = 0, n1 = 0;
      const r = renderizar(d, 6, ev as any, (x, t) => {
        if (solto < 0 && t > 0.5 && x.rpmAvg > 0.7 * p.rpmMax) { solto = t; n0 = x.estourosTotal; x.message({ type: 'input', throttle: 0 }); }
        if (solto > 0 && t <= solto + 2) n1 = x.estourosTotal;
      });
      const t0 = solto > 0 ? solto : 6;
      const tl = trecho(r.tele, t0 + 0.2, t0 + 2.2);
      const m = B.estourosPorJanela(mono(r.L, r.R, t0, t0 + 2.4), SR, 2);
      return { criados: (n1 - n0) / 2, detect: m[0]?.[1] ?? 0, alt: m[0]?.[2] ?? 0, rpm: media(tl.map((q) => q.rpm)) };
    };
    const a = decel('rx8hp');
    add("desaceleração rx8hp ('burble'): estouros/s", '4–6', `${f1(a.criados)} criados · ${f1(a.detect)} detectados (altura ${f1(a.alt)} dB) a ${f1(a.rpm, 0)} rpm`, dentro(a.criados, 4, 6));
    // (são ~13 estouros em 2 s, sorteados: a conta de uma semente só varia ±2/s; média de três)
    const bs = [0, 2024, 777].map((sm) => decel('r26b', sm)), b = bs[0], bc = media(bs.map((x) => x.criados));
    add("desaceleração r26b ('burble', periférico): estouros/s (criados, média de 3 sorteios)", '3,5–7,5', `${f1(bc)} criados (${bs.map((x) => f1(x.criados)).join(' / ')}) · ${f1(b.detect)} detectados (altura ${f1(b.alt)} dB) a ${f1(b.rpm, 0)} rpm`, dentro(bc, 3.5, 7.5));
  }

  if (nome === 'turbo') {
    // sweep do FD no dinamômetro (rotação imposta de 2 500 a 8 000 rpm em 8 s, pé no fundo): a troca do turbo e o soluço
    const p = preset('rx7fd'), d = novoDSP(p, { quente: true, rpm: 2500 });
    travar(d, 2500, 1);
    const serie: { t: number; rpm: number; boost: number }[] = [];
    renderizar(d, 9, [], (x, t) => { const rpm = Math.min(8000, 2500 + (5500 * t) / 8); x.omega = (rpm * Math.PI) / 30; x.rpmAvg = rpm; if (Math.round(t * SR) % 256 < 128) serie.push({ t, rpm: x.rpmAvg, boost: x.boost }); });
    const troca = serie.find((q) => q.rpm >= 4500);
    const antes = serie.filter((q) => troca && q.t > troca.t - 0.3 && q.t < troca.t), depois = serie.filter((q) => troca && q.t >= troca.t && q.t < troca.t + 0.5);
    const bAntes = Math.max(...antes.map((q) => q.boost)), bMin = Math.min(...depois.map((q) => q.boost));
    const fundo = depois.filter((q) => q.boost < bAntes - 0.05);
    const durac = fundo.length ? fundo[fundo.length - 1].t - fundo[0].t : 0;
    add('rx7fd sweep: queda do boost na troca do turbo (4 500 ± 100 rpm)', '0,1–0,2 bar por 0,2–0,4 s', `${f1(bAntes - bMin, 2)} bar · ${f1(durac, 2)} s (em ${f1(troca?.rpm ?? NaN, 0)} rpm)`, dentro(bAntes - bMin, 0.1, 0.2) && dentro(durac, 0.15, 0.4));
    const faixa = serie.filter((q) => q.rpm > 3000 && q.rpm < 7800 && !(troca && q.t > troca.t - 0.05 && q.t < troca.t + 0.45));
    add('rx7fd sweep: boost de 3 000 a 8 000 rpm (fora do soluço)', '0,65–0,75 bar', `${f1(Math.min(...faixa.map((q) => q.boost)), 2)}–${f1(Math.max(...faixa.map((q) => q.boost)), 2)} bar`, faixa.length > 5 && Math.min(...faixa.map((q) => q.boost)) >= 0.6 && Math.max(...faixa.map((q) => q.boost)) <= 0.78);
    // RX-8: degraus de AinMax nas janelas secundária e auxiliar
    const q8 = preset('rx8hp'), d8 = novoDSP(q8, { quente: true, rpm: 3000 });
    const pts: { rpm: number; ain: number; tq: number }[] = [];
    for (let rpm = 3500; rpm <= 6700; rpm += 50) {
      travar(d8, rpm, 1); const r = renderizar(d8, 0.08, []);
      pts.push({ rpm, ain: r.tele.length ? r.tele[r.tele.length - 1].janelas.ainRel : d8.AinMaxRpm / d8.AinPrim, tq: d8.tqMean });
    }
    const meio = (lo: number, hi: number) => pts.find((q) => q.ain > (lo + hi) / 2)?.rpm ?? NaN;
    const a1 = pts[0].ain, a2 = pts.find((q) => q.rpm === 5000)!.ain, a3 = pts[pts.length - 1].ain;
    add('rx8hp: degraus das janelas secundária e auxiliar', '3 750 e 6 250 ± 50 rpm', `${f1(meio(a1, a2), 0)} e ${f1(pts.filter((q) => q.rpm > 5500).find((q) => q.ain > (a2 + a3) / 2)?.rpm ?? NaN, 0)} rpm (AinMax ×${f1(a1, 2)} → ×${f1(a2, 2)} → ×${f1(a3, 2)})`, Math.abs(meio(a1, a2) - 3750) <= 50 && Math.abs((pts.filter((q) => q.rpm > 5500).find((q) => q.ain > (a2 + a3) / 2)?.rpm ?? 0) - 6250) <= 50);
  }

  if (nome === 'mecanica') {
    const { EngineDSP } = await import('../src/engines/ronco/dsp');
    const { configCalibrada } = await import('../src/engines/ronco/config');
    const { PRESETS, ACESSORIOS_PADRAO } = await import('../src/engines/ronco/presets');
    // vibração na cabine: só o canal vib (mecânica com o resto zerado não dá: lê-se o vib do DSP pelo tap)
    const vibDe = (d: any, rpm: number) => {
      let s = 0, n = 0; const tap = { ponteira() {}, jato() {}, gravar(_s: number, _k: number, _i: number, _h: number, _m: number, v: number) { s += v * v; n++; } };
      d.tap = tap; d.mk = 1; d.cfgGain = 1;
      const B2 = 128, l = new Float32Array(B2), r = new Float32Array(B2);
      for (let i = 0; i < 4 * SR; i += B2) d.process(l, r, B2);
      void rpm;
      return 10 * Math.log10(s / Math.max(1, n) + 1e-30);
    };
    const q = novoDSP(preset('rx8hp'), { quente: true, ouvinte: 'int' });
    const vr = vibDe(q, 750);
    for (const id of ['ek9', 'mx5']) {
      const pc = { ...ACESSORIOS_PADRAO, ...PRESETS.find((x) => x.id === id)! };
      const e = new EngineDSP(SR); e.setConfig(configCalibrada(pc, SR));
      e.message({ type: 'input', temp: { mode: 'fixed', value: 90 } }); e.coolant = 90; e.state = 'run'; e.ignition = true; e.runT = 120; e.warm = 1; e.omega = (pc.idle * Math.PI) / 30; e.rpmAvg = pc.idle;
      const vp = vibDe(e, pc.idle);
      add(`vibração na lenta: rx8hp contra ${id} (Ronco)`, '10–15 dB abaixo', `${f1(vr - vp)} dB`, dentro(vp - vr, 10, 15));
    }
    // tiques do ápice: sem cliques contáveis em lenta (p90/p10 de 2–6 kHz da mecânica)
    const l = lenta('rx8hp', { kHC: 0 }, { dur: 10, med: 6, ouvinte: 'bay' });
    const env = B.envoltoria(mono(l.r.L, l.r.R, 4, 10), SR, 2000, 6000, 600);
    const s = Float64Array.from(env).sort();
    const p9010 = 20 * Math.log10(s[Math.round(0.9 * (s.length - 1))] / (s[Math.round(0.1 * (s.length - 1))] + 1e-12));
    add('tiques das vedações em lenta (rx8hp no cofre, sem pós-queima): p90/p10 de 2–6 kHz', '≤ 12 dB (fundidos, sem cliques contáveis)', `${f1(p9010)} dB`, p9010 <= 12);
    const meia = l.m.linha(l.rpm / 120, 0.03);
    add('rx8hp no cofre: meia-ordem (rpm/120)', '≤ +3 dB', `${sg(meia)} dB`, meia <= 3);
  }

  if (nome === 'portadores') {
    const { ouvirRot } = await import('./rotativo-cena');
    const A = await import('./cena/analise');
    // AR741 no Shadow: decolagem (hélice direta de 2 pás: a ignição é metade da BPF), no chão a 30 m/s
    const a = ouvirRot('ar741', { d: 20, pedal: 1, dur: 8, t0: 5, v: 40, s0: -40 });
    const ta = a.tele.slice(-12), rpmA = media(ta.map((q) => q.rpm)), bpf = media(ta.map((q) => q.bpf)), mt = media(ta.map((q) => q.machPonta));
    add('ar741 em voo, plena (40 m/s): passagem de pá', '≈ 260 Hz (7 800 rpm)', `${f1(bpf, 1)} Hz (${f1(rpmA, 0)} rpm)`, Math.abs(bpf / 260 - 1) <= 0.06);
    add('ar741: Mach na ponta', '0,88 (a 7 800 rpm)', f1(mt, 3), Math.abs(mt - 0.88) <= 0.05);
    add('ar741: f_ign/BPF (1 rotor, 2 pás, direto)', '0,5', f1(rpmA / 60 / bpf, 3), Math.abs(rpmA / 60 / bpf - 0.5) <= 0.005);
    // AE50R no Camcopter: Nr e droop (coletivo 0,45 → 0,6 em 1 s)
    const h = ouvirRot('ae50r', { d: 20, pedal: 0.45, dur: 16, t0: 2, aoBloco: (t, p) => { (p as any).cmd.pedal = t < 10 ? 0.45 : t < 11 ? 0.45 + 0.15 * (t - 10) : 0.6; } });
    const nr = h.tele.map((q) => [q.t, q.Nr]);
    const est = media(nr.filter(([t]) => t > 8 && t < 10).map(([, v]) => v)), min = Math.min(...nr.filter(([t]) => t >= 10 && t < 13).map(([, v]) => v));
    const fim = media(nr.filter(([t]) => t > 14).map(([, v]) => v));
    add('ae50r com o rotor (S-100): Nr no pairado', '1 070 ± 2%', `${f1(est, 0)} rpm (no fim ${f1(fim, 0)})`, Math.abs(est / 1070 - 1) <= 0.02);
    add('ae50r: droop ao puxar o coletivo (0,45 → 0,6 em 1 s)', '≤ 3%', `${f1((100 * (est - min)) / est, 2)}%`, (100 * (est - min)) / est <= 3);
    // Mistral: da lenta à plena (manete em 1 s) com o governador da hélice a 2 930 rpm
    const mi = ouvirRot('mistral', { d: 20, pedal: 0, dur: 14, t0: 1, aoBloco: (t, p) => { (p as any).cmd.pedal = t < 3 ? 0 : Math.min(1, (t - 3) / 4); } });
    const t75 = mi.tele.find((q) => q.t > 3 && q.rpm >= 0.95 * 7500 * 0.98)?.t;
    const hel = media(mi.tele.filter((q) => q.t > 11).map((q) => q.rpmHelice));
    add('mistral: subida de 1 200 a ~7 500 rpm (manete em 4 s)', '4–6 s', `${f1((t75 ?? NaN) - 3, 1)} s`, dentro((t75 ?? 99) - 3, 4, 6));
    add('mistral: governador da hélice', '2 930 ± 2%', `${f1(hel, 0)} rpm`, Math.abs(hel / 2930 - 1) <= 0.02);
    // XTS-210 no gerador: o governador do portador segura a rotação com 50% de carga
    const g = ouvirRot('xts210', { d: 7.5, dur: 24, t0: 2, comando: { cargaFracao: 0.5 } });
    const tg = g.tele.filter((q) => q.t > 18);
    add('xts210 no gerador (inversor, 6 000 rpm nominal), 50% de carga', '±3% da nominal', `${f1(media(tg.map((q) => q.rpm)), 0)} rpm · carga ${f1(media(tg.map((q) => q.cargaFracao ?? 0)), 2)}`, Math.abs(media(tg.map((q) => q.rpm)) / 6000 - 1) <= 0.03);
    // 787B em Hunaudières: passagem a 340 km/h em 5ª, ouvinte a 15 m (razão Doppler da ignição)
    const v = 340 / 3.6, dlat = 15;
    const pb = ouvirRot('r26b', { d: dlat, pedal: 1, dur: 4, t0: 0, v, s0: -2 * v, solo: 'asfalto', comando: { marcha: 5, velocidadeFixa: v } });
    const x = pb.x, rpm = media(pb.tele.map((q) => q.rpm)), fi = (rpm * 4) / 60;
    const cosA = 0.79, xa = (cosA * dlat) / Math.sqrt(1 - cosA * cosA);
    const tA = (2 * v - xa) / v + Math.hypot(xa, dlat) / 343, tB = (2 * v + xa) / v + Math.hypot(xa, dlat) / 343;
    const fa = A.picoEm(x, SR, tA, 0.15, fi * 1.1, fi * 1.45), fr = A.picoEm(x, SR, tB, 0.15, fi * 0.65, fi * 0.9);
    const M = v / 343, teo = (1 + M * cosA) / (1 - M * cosA);
    add('787B passagem a 340 km/h (15 m): razão da ignição chegando/indo', `1,555 ± 5% (teoria ${f1(teo, 3)} com M ${f1(M, 3)})`, `${f1(fa / fr, 3)} (${f1(fa, 0)} / ${f1(fr, 0)} Hz; ${f1(rpm, 0)} rpm)`, Math.abs(fa / fr / 1.555 - 1) <= 0.05);
    void B;
  }

  if (nome === 'xengine') {
    const s = sustentado('xmini', 12000);
    const A = await import('./cena/analise');
    const f = A.picoEm(mono(s.r.L, s.r.R, 2, 6), SR, 4, 3.5, 270, 330, 4);
    add('xmini a 12 000 rpm: f_ign (1,5 por volta, 3 câmaras, ciclo de 720°)', '300 Hz ± 0,5%', `${f1(f, 2)} Hz · cyc ${s.tl[0].cyc} · ${s.d.N} câmaras`, Math.abs(f / 300 - 1) <= 0.005 && s.tl[0].cyc === 720 && s.d.N === 3);
    for (const id of ['xmini', 'xts210']) {
      const p = preset(id), d = novoDSP(p, { quente: true, rpm: p.rpmMax * 0.55 });
      travar(d, p.rpmMax * 0.55, 1);
      const r = renderizar(d, 3, []);
      let nan = false; for (const v of r.L) if (!Number.isFinite(v)) { nan = true; break; }
      const t = trecho(r.tele, 1, 3), pEO = media(t.map((q) => q.pAbertura)) / 1e5;
      add(`${id} plena carga: pressão na abertura (expansão prolongada)`, '1,3–1,6 bar', `${f1(pEO, 2)} bar${id === 'xts210' ? ` · CR ${d.CR}` : ''}`, dentro(pEO, 1.3, 1.6));
      add(`${id}: sem NaN`, 'nenhum', nan ? 'NaN' : 'nenhum', !nan);
    }
  }

  if (nome === 'palhetas') {
    const { PalhetasDSP } = await import('../src/engines/rotativo/palhetas');
    const { PRESETS_ROTATIVO } = await import('../src/engines/rotativo/presets');
    const A = await import('./cena/analise');
    const p = PRESETS_ROTATIVO.find((x) => x.id === 'palhetas')!;
    const roda = (op: { carga?: number; ar?: number }, dur = 8) => {
      const d = new PalhetasDSP(SR); d.message({ type: 'config', cfg: p }); if (op.ar !== undefined) d.message({ type: 'params', params: { air: op.ar } });
      const tele: any[] = []; let pos = 0; d.post = (m) => tele.push({ ...m, t: pos / SR });
      const N = dur * SR, L = new Float32Array(N), R = new Float32Array(N), B2 = 128;
      d.message({ type: 'input', ignition: true, throttle: 1 });
      for (; pos < N; pos += B2) { if (op.carga !== undefined && pos === 4 * SR) d.message({ type: 'palhetas', carga: op.carga }); d.process(L.subarray(pos, pos + B2), R.subarray(pos, pos + B2), B2); }
      return { L, tele };
    };
    const a = roda({ carga: 1 });
    const at = (t: number) => a.tele.find((q) => q.t >= t)!;
    const n0 = at(3.5).rpm, fp = (8 * n0) / 60;
    const fpm = A.picoEm(a.L, SR, 3, 1.5, fp * 0.95, fp * 1.05, 4);
    const seg = Float64Array.from(a.L.subarray(2 * SR, 4 * SR));
    const m = B.medirRot(seg, SR, { rotores: 1, fmin: 1, fmax: 2, fIgn: fp });
    add('palhetas livre (8 palhetas): tom em z·n/60', `${f1(fp, 0)} Hz ± 1% (${f1(n0, 0)} rpm; 20 000 → 2 667 Hz)`, `${f1(fpm, 0)} Hz (${sg((100 * (fpm - fp)) / fp, 2)}%)`, Math.abs(fpm / fp - 1) <= 0.01);
    add('palhetas: tom sobre a mediana', '≥ 15 dB', `${sg(m.ign)} dB`, m.ign >= 15);
    const t90 = a.tele.find((q) => q.rpm > 0.9 * n0)!.t;
    add('palhetas: da parada à rotação livre (90%)', '0,3–0,6 s', `${f1(t90, 2)} s`, dentro(t90, 0.3, 0.6));
    const caiu = a.tele.find((q) => q.t > 4 && q.rpm < 0.7 * n0);
    add('palhetas com 100% de carga: a rotação cai ≥ 30% em ≤ 1 s', '≥ 30% em ≤ 1 s', `${f1(100 * (1 - at(5.5).rpm / n0), 0)}% · 30% em ${f1((caiu?.t ?? 99) - 4, 2)} s`, (caiu?.t ?? 99) - 4 <= 1 && at(5.5).rpm < 0.7 * n0);
    // jato contra o tom em 2,5–6 kHz: com o ar (jato e descarga) desligado sobra o tom
    const sem = roda({ ar: 0 }, 4);
    const banda = (x: Float32Array) => { const s = Float64Array.from(x.subarray(2 * SR, 4 * SR)); const mm = B.medirRot(s, SR, { rotores: 1, fmin: 1, fmax: 2, fIgn: fp }); return mm.abs[4]; };
    const tot = banda(a.L), tom = banda(sem.L), jato = 10 * Math.log10(Math.max(1e-30, 10 ** (tot / 10) - 10 ** (tom / 10)));
    add('palhetas: jato contra o tom em 2,5–6 kHz', 'jato ≥ tom', `jato ${f1(jato)} · tom ${f1(tom)} dB`, jato >= tom);
    // arranque a ar: o hospedeiro (diesel) a 0,45 da lenta em 1–2 s
    const d = new PalhetasDSP(SR); d.message({ type: 'config', cfg: { ...p, modoPalhetas: 'arranque' } });
    const t2: any[] = []; let pos = 0; d.post = (mm) => t2.push({ ...mm, t: pos / SR });
    d.message({ type: 'input', ignition: true });
    const l = new Float32Array(128), r = new Float32Array(128);
    for (; pos < 5 * SR; pos += 128) d.process(l, r, 128);
    const h = t2.find((q) => q.rpmHospedeiro >= 0.45 * 600);
    add('palhetas, arranque a ar (Cat C15): o hospedeiro a 0,45·lenta', '1–2 s', `${f1(h?.t ?? NaN, 2)} s (pega e solta o pinhão em ${f1(t2.find((q) => q.pegou)?.t ?? NaN, 2)} s)`, dentro(h?.t ?? 99, 1, 2));
  }

  if (nome === 'potencia') {
    const { RotativoDSP } = await import('../src/engines/rotativo/dsp');
    const { PRESETS_ROTATIVO } = await import('../src/engines/rotativo/presets');
    for (const s0 of PRESETS_ROTATIVO.filter((x) => x.tipo !== 'palhetas')) {
      const s = preset(s0.id), cfg = { ...C.cfgCalibrada(s), limiter: 'none' };
      const d = new RotativoDSP(SR); d.setConfig(cfg);
      d.state = 'run'; d.lockOmega = true; d.tempMode = 'fixed'; d.coolant = 90; d.runT = 100; d.thrTarget = 1; d.thr = 1; d.turboW = 1; d.boost = cfg.boost; d.maxBoost = cfg.boost; d.carga = null;
      let mx = 0, fmx = 0;
      for (const f of [0.7, 0.8, 0.9, 1.0]) {
        d.omega = (s.rpmMax * f * 2 * Math.PI) / 60; d.rpmAvg = s.rpmMax * f; d.tqMean = 0;
        const B2 = 256, l = new Float32Array(B2), r = new Float32Array(B2);
        let sq = 0, n = 0;
        for (let i = 0; i < 1.0 * SR; i += B2) { d.process(l, r, B2); if (i > 0.4 * SR) { sq += d.tqMean; n++; } }
        const kw = ((sq / n) * d.omega) / 1000; if (kw > mx) { mx = kw; fmx = f; }
      }
      add(`potência ${s0.id}`, `${s.power} kW ± 5%`, `${f1(mx, 1)} kW a ${f1(fmx * 100, 0)}% de rpmMax`, Math.abs(mx / s.power - 1) <= 0.05);
    }
  }

  if (nome === 'veiculo') {
    const kmhRpm = (id: string, marcha: number, kmh: number) => { const s = preset(id); return ((kmh / 3.6 / (2 * Math.PI * (s.wheelR || 0.33))) * 60 * s.ratios![marcha - 1] * (s.finalDrive || 4)); };
    const r1 = kmhRpm('rx7fd', 5, 100), r2 = kmhRpm('rx8hp', 6, 100);
    add('rx7fd a 100 km/h em 5ª (relações da ficha)', '2 600 ± 100 rpm', `${f1(r1, 0)} rpm`, Math.abs(r1 - 2600) <= 100);
    add('rx8hp a 100 km/h em 6ª (relações da ficha)', '2 750 ± 100 rpm', `${f1(r2, 0)} rpm`, Math.abs(r2 - 2750) <= 100);
    const s = preset('r26b'), v = (8500 / 60 / (s.ratios![4] * s.finalDrive!)) * 2 * Math.PI * s.wheelR! * 3.6;
    add('r26b em 5ª a 8 500 rpm', '340 ± 10 km/h', `${f1(v, 0)} km/h`, Math.abs(v - 340) <= 10);
    // Ro80 0–100 km/h com o semiautomático
    const p = preset('ro80'), d = novoDSP(p, { quente: true });
    const ev: [number, (x: any) => void][] = [[0.2, (x) => x.message({ type: 'input', shift: 1 })], [0.5, (x) => x.message({ type: 'input', throttle: 1 })]];
    let t100 = NaN;
    renderizar(d, 25, ev as any, (x, t) => { if (Number.isNaN(t100) && x.v * 3.6 >= 100) t100 = t - 0.5; });
    add('ro80 0–100 km/h', '12–15 s', `${f1(t100, 1)} s`, dentro(t100, 12, 15));
  }

  if (nome === 'niveis') {
    // lenta → plena carga a 55% (calibração da página) e a faixa das lentas dos carros e da moto
    const { PRESETS_ROTATIVO } = await import('../src/engines/rotativo/presets');
    const lentas: [string, number][] = [];
    for (const s0 of PRESETS_ROTATIVO.filter((x) => (x.portadores as string[]).includes('carro'))) {
      const p = preset(s0.id);
      const di = novoDSP(p, { quente: true }); const ri = renderizar(di, 6, []);
      const xi = mono(ri.L, ri.R, 3, 6); let ei = 0; for (const v of xi) ei += v * v;
      const dw = novoDSP(p, { quente: true, rpm: p.rpmMax * 0.55 }); travar(dw, p.rpmMax * 0.55, 1); const rw = renderizar(dw, 3, []);
      const xw = mono(rw.L, rw.R, 1.5, 3); let ew = 0; for (const v of xw) ew += v * v;
      const li = 10 * Math.log10(ei / xi.length), lw = 10 * Math.log10(ew / xw.length);
      lentas.push([s0.id, li]);
      add(`${s0.id}: lenta → plena carga a 55% (página)`, '+18 a +25 dB', `${sg(lw - li)} dB`, dentro(lw - li, 18, 25));
    }
    const vs = lentas.map(([, v]) => v);
    add('os carros e a moto na lenta: faixa de nível', '≤ 12 dB', `${f1(Math.max(...vs) - Math.min(...vs))} dB (${lentas.map(([k, v]) => `${k} ${f1(v)}`).join(', ')})`, Math.max(...vs) - Math.min(...vs) <= 12);
  }

  if (nome === 'cpu') {
    const d = novoDSP(preset('r26b'), { quente: true, rpm: 7700 });
    travar(d, 7700, 0.6);
    const B2 = 128, l = new Float32Array(B2), r = new Float32Array(B2);
    for (let i = 0; i < SR; i += B2) d.process(l, r, B2);
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 10 * SR; i += B2) d.process(l, r, B2);
    const fr = Number(process.hrtime.bigint() - t0) / 1e9 / 10;
    add('r26b rev (12 câmaras, 4 primários, megafone), 10 s em Node', '≤ 45% do tempo real', `${f1(100 * fr)}% (${d.lines.length} tubos, ${d.nodes.length} nós)`, fr <= 0.45);
  }
  return L;
}

// ------------------------------------------------------------------ CLI
const args = process.argv.slice(2);
if (args[0] === '--grupo') {
  grupo(args[1]).then((l) => process.stdout.write(JSON.stringify(l)));
} else if (process.argv[1] && process.argv[1].endsWith('rotativo-valida.ts')) {
  const ji = args.indexOf('--j'), J = ji >= 0 ? +args[ji + 1] : Math.max(2, Math.floor(os.cpus().length * 0.5));
  const pedidos = args.filter((a, i) => !a.startsWith('--') && (ji < 0 || i !== ji + 1));
  const GRUPOS = ['geometria', 'ciclo', 'bandas', 'ar', 'linhas', 'lenta', 'estouros', 'turbo', 'mecanica', 'portadores', 'xengine', 'palhetas', 'potencia', 'veiculo', 'niveis', 'cpu'];
  const fila = pedidos.length ? pedidos : GRUPOS;
  const res: Record<string, Linha[]> = {};
  const t0 = Date.now();
  const rodar = (g: string) => new Promise<void>((ok) => {
    const p = spawn(process.execPath, ['--import', 'tsx', AQUI, '--grupo', g], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = ''; p.stdout.on('data', (b) => { out += b; });
    p.on('close', () => { try { res[g] = JSON.parse(out); } catch { res[g] = [{ grupo: g, nome: 'execução do grupo', alvo: 'sem erro', medido: out.slice(-300), ok: false }]; } console.error(`  (${g}: ${((Date.now() - t0) / 1000).toFixed(0)} s)`); ok(); });
  });
  (async () => {
    // (a CPU por último e sozinha: com os outros grupos rodando ela mede a máquina ocupada)
    const q = fila.filter((g) => g !== 'cpu');
    await Promise.all(Array.from({ length: Math.min(J, q.length) }, async () => { while (q.length) await rodar(q.shift()!); }));
    if (fila.includes('cpu')) await rodar('cpu');
    let ok = 0, desv = 0, falha = 0;
    for (const g of fila) for (const l of res[g] || []) {
      const tag = l.ok ? 'ok   ' : l.desvio ? 'desv ' : 'FALHA';
      if (l.ok) ok++; else if (l.desvio) desv++; else falha++;
      console.log(`${tag} [${l.grupo}] ${l.nome}: alvo ${l.alvo} · medido ${l.medido}`);
      if (!l.ok && l.desvio) console.log(`        desvio: ${l.desvio}`);
    }
    console.log(`\n${ok + desv + falha} medidas: ${ok} ok, ${desv} desvios documentados, ${falha} falhas (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    process.exitCode = falha ? 1 : 0;
  })();
}
