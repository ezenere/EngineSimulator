// Validação dos rotativos (ROTATIVO.md 3 e 8): geometria (Apêndice B), ciclo (pressão e temperatura na abertura, Mach do
// jato, duração da queima, parede do coletor), bandas por regime contra as gravações (dB rel. 150–400 Hz, ±4 dB até
// 6 kHz: acima disso o áudio comprimido das gravações corta o agudo e vale a física), linhas de ordem, lenta (vagar,
// CVciclo, estalos), caça da lenta periférica, estouros na desaceleração, turbo sequencial e janelas secundárias,
// mecânica e vibração, portadores (hélice, rotor, gerador, passagem do 787B), X-Engine, palhetas, potência e veículo.
//
// As gravações são as do Apêndice A (medidas com tools/rotativo-bandas.ts, a porta de medir_w.py) e, desde a rodada de
// som de 11/2026, as casadas de referencias/rotativo (fora do git; os números delas estão escritos aqui como alvo). O
// ouvinte da simulação é o `ext` da página (atrás do carro, a poucos metros), sem o som de fundo.
// Viés do dono (docs/PLANO.md): mais motor, menos ar. No agudo (1–6 kHz) a gravação é TETO: o simulado passa se ficar
// igual ou abaixo dela (+4 dB de folga); as bandas do tom (60–150 e 400–1k) seguem com tolerância dos dois lados.
//
// Desvios (tools/desvios.ts): uma medida fora do alvo só passa se estiver no retrato `tools/rotativo-desvios.json` e
// ficar na folga do valor gravado lá (±1 dB, ±5 %; o motivo físico de cada uma está no retrato e no TECNICO). Contagens,
// transientes, vagar e CV são a mediana de 3 sementes do ruído (base, base+1, base+2); a potência é a média de 2 s por
// ponto; a CPU saiu para `npm run cpu:rotativo` (tools/rotativo-cpu.ts). AUDITORIA A1, A2, A8 (T-ROT-06, T-ROT-10, G-11).
//
//   npx tsx tools/rotativo-valida.ts [grupos...] [--j 8] [--semente N] [--atualizar[=nome exato]]
//   grupos: geometria ciclo bandas bandas-b ar linhas lenta lenta-b estouros turbo mecanica portadores portadores-b xengine
//           palhetas potencia potencia-b veiculo niveis; sem grupo, todos em paralelo
// Sai ≠ 0 se houver falha (os desvios do retrato aparecem como "desv", com o teto).
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lerOpcoes, iniciarSementes, semear, porSementes, mediana, fmtSementes, avaliarDesvios, imprimirAvaliacao, type Medida } from './desvios';

export type Linha = Medida;
const AQUI = fileURLToPath(import.meta.url);
const RETRATO = path.join(path.dirname(AQUI), 'rotativo-desvios.json');
const f1 = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const sg = (x: number, d = 1) => (x >= 0 ? '+' : '') + f1(x, d);
const dentro = (x: number, a: number, b: number) => x >= a && x <= b;
/** mediana das 3 sementes e o texto "m (sementes a · b · c)" */
const m3 = (v: number[], d = 1) => ({ m: mediana(v), txt: `${f1(mediana(v), d)} (sementes ${fmtSementes(v, d)})` });
/** a mediana de cada campo de uma lista de resultados (um por semente): número → mediana; vetor de números do mesmo
 *  tamanho → mediana componente a componente; o resto (funções, vetores de tamanho variável) fica de fora */
function medianas<T extends Record<string, any>>(xs: T[]): T {
  const r: Record<string, any> = {};
  for (const k of Object.keys(xs[0])) {
    const v = xs.map((x) => x[k]);
    if (v.every((x) => typeof x === 'number')) r[k] = mediana(v);
    else if (v.every((x) => Array.isArray(x) && x.length === v[0].length && x.every((y: unknown) => typeof y === 'number'))) r[k] = v[0].map((_: number, i: number) => mediana(v.map((x) => x[i])));
  }
  return r as T;
}

// ------------------------------------------------------------------ grupos
async function grupo(nome: string): Promise<Linha[]> {
  const L: Linha[] = [];
  const add = (n: string, alvo: string, medido: string, ok: boolean, valor?: number | number[], unidade?: string) => L.push({ grupo: nome, nome: n, alvo, medido, ok, valor, unidade });
  const C = await import('./rotativo-comum');
  const { SR, preset, renderizar, trecho, media, mono, travar, sustentar } = C;
  /** o DSP da página com o ruído na semente atual (depois da calibração, que fica com a de fábrica) */
  const novoDSP = (spec: any, op: Parameters<typeof C.novoDSP>[1] = {}) => semear(C.novoDSP(spec, op));
  const B = await import('./rotativo-bandas');
  const banda = (b: number[], i: number) => b[i];
  /** bandas 60–150, 400–1k, 1–2,5k, 2,5–6k (dB rel. 150–400) e centroide contra o alvo ±tol */
  const conferirBandas = (n: string, m: any, alvo: number[], cent: [number, number], tol = 4) => {
    const med = [banda(m.b, 0), banda(m.b, 2), banda(m.b, 3), banda(m.b, 4)];
    const ok = med.every((v, i) => Number.isNaN(alvo[i]) || Math.abs(v - alvo[i]) <= tol);
    add(`bandas ${n}`, `${alvo.map((x) => (Number.isNaN(x) ? '—' : sg(x))).join(' / ')} ±${tol}`, `${med.map((x) => sg(x)).join(' / ')} (6–12k ${sg(m.b[5])}: física)`, ok, med, 'dB');
    add(`centroide ${n}`, `${cent[0]}–${cent[1]} Hz ±30%`, `${f1(m.cent, 0)} Hz`, dentro(m.cent, cent[0] * 0.7, cent[1] * 1.3), m.cent, 'Hz');
  };
  /** contra uma gravação casada, com o viés do dono: 60–150 e 400–1k (o tom) a ±`tol` dB; 1–2,5k e 2,5–6k (onde mora o
   *  chiado) no máximo `folga` dB acima da gravação, que é teto de ruído: mais limpo que ela passa */
  const conferirTeto = (n: string, m: any, alvo: number[], tol = 7, folga = 4) => {
    const med = [banda(m.b, 0), banda(m.b, 2), banda(m.b, 3), banda(m.b, 4)];
    const ok = Math.abs(med[0] - alvo[0]) <= tol && Math.abs(med[1] - alvo[1]) <= tol && med[2] <= alvo[2] + folga && med[3] <= alvo[3] + folga;
    // (no retrato vai o que o critério olha: no agudo, abaixo do teto vale o teto, porque mais limpo passa; sem isso o
    // agudo da moto, 13 dB abaixo do teto e solto conforme a semente, derrubava o desvio do grave)
    const ret = [med[0], med[1], Math.max(med[2], alvo[2] + folga), Math.max(med[3], alvo[3] + folga)];
    add(`bandas ${n}`, `${sg(alvo[0])} / ${sg(alvo[1])} ±${tol}; agudo ≤ ${sg(alvo[2])} / ${sg(alvo[3])} +${folga} (teto)`, `${med.map((x) => sg(x)).join(' / ')}`, ok, ret, 'dB');
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
  /** 8 s na rotação da lenta com o eixo travado e o torque médio zerado (para as linhas finas da medida de meia-ordem) */
  const meiaLenta = (id: string, extra: Record<string, any> = {}, ouvinte = 'ext') => {
    const p = preset(id, extra), d = novoDSP(p, { quente: true, ouvinte, rpm: p.idle });
    const r = renderizar(d, 10, [], sustentar(d, p.idle, 0.02));
    return mono(r.L, r.R, 2, 10);
  };
  /** as medidas de bandas e linhas de uma lenta ou de um giro sustentado pela mediana de 3 sementes (a explosão a
   *  explosão mexe nas linhas e no agudo: com uma semente só, o 2·ign do pré-silencioso ia de −1,1 a +1,0 dB e a ordem 1
   *  do RX-8 de −19 a −22 conforme a base) */
  const lenta3 = (id: string, extra: Record<string, any> = {}, op: Parameters<typeof lenta>[2] = {}) => medianas(porSementes(() => lenta(id, extra, op).m));
  const sustentado3 = (id: string, rpm: number, extra: (m: any) => Record<string, number> = () => ({})) => medianas<any>(porSementes(() => { const m = sustentado(id, rpm).m; return { ...m, ...extra(m) }; }));
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
    for (const [n, g, alvo] of casos) { const v = volumeCamara(g.R, g.e, g.b); add(`V_cam ${n} = 3√3·e·R·b`, `${alvo} cm³ ± 0,5%`, `${f1(v, 1)} cm³ (${sg((100 * (v - alvo)) / alvo, 2)}%)`, Math.abs(v / alvo - 1) <= 0.005, v, 'cm³'); }
    const m = montarRotativo({ rotores: 2, geo: GEOMETRIAS['13B'], cr: 9 });
    const v0 = volumeAngulo(m, 0).V, v270 = volumeAngulo(m, 270).V, v540 = volumeAngulo(m, 540).V;
    add('V(0) = V_min, V(270°e) = V_min + V_cam, V(540°e) = V_min (13B, CR 9)', '±1e-9', `${f1(v0 - m.Vmin, 12)} / ${f1(v270 - m.Vmin - m.Vcam, 12)} / ${f1(v540 - m.Vmin, 12)}`, Math.abs(v0 - m.Vmin) < 1e-9 && Math.abs(v270 - m.Vmin - m.Vcam) < 1e-9 && Math.abs(v540 - m.Vmin) < 1e-9, [v0 - m.Vmin, v270 - m.Vmin - m.Vcam, v540 - m.Vmin], 'cm³');
    add('V_min do 13B com CR 9,0 / 9,4 / 10,0', '81,8 / 77,9 / 72,7 cm³', [9, 9.4, 10].map((cr) => f1(montarRotativo({ rotores: 2, geo: GEOMETRIAS['13B'], cr }).Vmin, 1)).join(' / '), [9, 9.4, 10].every((cr, i) => Math.abs(montarRotativo({ rotores: 2, geo: GEOMETRIAS['13B'], cr }).Vmin - [81.8, 77.9, 72.7][i]) < 0.15), [9, 9.4, 10].map((cr) => montarRotativo({ rotores: 2, geo: GEOMETRIAS['13B'], cr }).Vmin), 'cm³');
    const dVmax = Math.max(...Array.from({ length: 1081 }, (_, a) => volumeAngulo(m, a).dV));
    add('dV/dα máximo do 13B (a 135°e)', '218 cm³/rad', `${f1(dVmax, 1)} cm³/rad`, Math.abs(dVmax - m.Vcam / 3) < 0.5, dVmax, 'cm³/rad');
    // ∮ p dV de um ciclo motorizado sem queima (politrópico, sem troca de gás): a função volume fecha o ciclo
    let w = 0, wa = 0; const g = 1.35, p0 = 1e5;
    for (let a = 0; a < 1080; a += 0.05) { const V1 = volumeAngulo(m, a).V, V2 = volumeAngulo(m, a + 0.05).V, pm = p0 * Math.pow(m.Vmin / (0.5 * (V1 + V2)), g); w += pm * (V2 - V1); wa += Math.abs(pm * (V2 - V1)); }
    add('∮ p dV de um ciclo motorizado (sem queima)', '0 ± 1%', `${sg((100 * w) / wa, 4)}%`, Math.abs(w / wa) < 0.01, (100 * w) / wa, '%');
    for (const [r, alvo] of [[1, [360]], [2, [180]], [3, [120]], [4, [90]]] as [number, number[]][]) {
      const mm = montarRotativo({ rotores: r, geo: GEOMETRIAS['13B'], cr: 9 });
      add(`fases de ${r} rotor(es): intervalo de ignição`, `${alvo[0]}°e exatos`, `${[...new Set(mm.intervalos)].join(' / ')}°e · fire ${mm.fire.join(' ')}`, mm.intervalos.every((x) => Math.abs(x - alvo[0]) < 1e-9), Math.max(...mm.intervalos.map((x) => Math.abs(x - alvo[0]))), '°e');
    }
    // f_ign no render = rotores·rpm/60 ± 0,5%
    for (const [id, rpm] of [['ae50r', 4000], ['rx8hp', 5000], ['cosmo20b', 4000], ['r26b', 6000], ['xmini', 12000]] as [string, number][]) {
      const s = sustentado(id, rpm), ev = s.p.tipo === 'x' ? 1.5 : s.p.rotores, alvo = (ev * rpm) / 60;
      const A = await import('./cena/analise');
      // (f_ign pelo pente de 4 harmônicos do rotativo-bandas, o método das gravações; o pico da FFT puxa para as bandas laterais)
      const f = B.medirRot(mono(s.r.L, s.r.R, 2, 6), SR, { rotores: s.p.rotores, fmin: alvo * 0.8, fmax: alvo * 1.25 }).fIgn; void A;
      add(`f_ign no render, ${id} a ${rpm} rpm`, `${f1(alvo, 2)} Hz ± 0,5% (${ev} por volta)`, `${f1(f, 2)} Hz (${sg((100 * (f - alvo)) / alvo, 2)}%)`, Math.abs(f / alvo - 1) <= 0.005, f, 'Hz');
    }
  }

  if (nome === 'ciclo') {
    const l = lenta('rx7fd', {}, { dur: 12, med: 6 });
    const tl = l.tl;
    add('rx7fd lenta 750 rpm quente: pressão na abertura do escape', '1,5–2,5 bar', `${f1(media(tl.map((q) => q.pAbertura)) / 1e5, 2)} bar`, dentro(media(tl.map((q) => q.pAbertura)) / 1e5, 1.5, 2.5), media(tl.map((q) => q.pAbertura)) / 1e5, 'bar');
    add('rx7fd lenta: 10–90% da queima', '≈ 100°e (90–110)', `${f1(media(tl.map((q) => q.queima1090)), 0)}°e`, dentro(media(tl.map((q) => q.queima1090)), 90, 110), media(tl.map((q) => q.queima1090)), '°e');
    // plena carga a 55% (eixo travado), com o turbo a 40% da pressão (a condição da calibração) e aspirado
    for (const [id, ex, rotulo, fr] of [['rx7fd', {}, 'rx7fd (turbo 0,7 bar)', 0.55], ['rx8hp', {}, 'rx8hp (aspirado)', 0.55], ['rx8hp', {}, 'rx8hp a 80% de rpmMax', 0.8]] as [string, any, string, number][]) {
      const p = preset(id, ex), d = novoDSP(p, { quente: true, rpm: p.rpmMax * fr });
      travar(d, p.rpmMax * fr, 1);
      d.exhT = 300;
      const r = renderizar(d, 14, []);
      const t = trecho(r.tele, 2, 14), t2 = trecho(r.tele, 12, 14);
      const pEO = media(t.map((q) => q.pAbertura)) / 1e5;
      add(`${rotulo} plena carga: pressão na abertura`, 'aspirado a 55%: 3–5,5 bar (≈ 4 no projeto); nos outros > 3 bar', `${f1(pEO, 2)} bar · boost ${f1(media(t.map((q) => q.boost)), 2)} bar`, id === 'rx8hp' && fr < 0.6 ? dentro(pEO, 3, 5.5) : pEO > 3, pEO, 'bar');
      add(`${rotulo} plena carga: Mach do jato no 1º terço da rampa`, 'Mach 1', f1(media(t.map((q) => q.machAbertura)), 2), media(t.map((q) => q.machAbertura)) > 0.97, media(t.map((q) => q.machAbertura)), '');
      add(`${rotulo} plena carga: 10–90% da queima`, '46–62°e (o projeto dá 50–60; a 55% a fórmula dá 48)', `${f1(media(t.map((q) => q.queima1090)), 0)}°e`, dentro(media(t.map((q) => q.queima1090)), 46, 62), media(t.map((q) => q.queima1090)), '°e');
      if (rotulo !== 'rx8hp (aspirado)') add(`${rotulo} plena carga: parede do coletor (tEscape) depois de 12 s`, '880–1 050 °C (o projeto dá 900–1 000)', `${f1(media(t2.map((q) => q.tEscape)), 0)} °C`, dentro(media(t2.map((q) => q.tEscape)), 880, 1050), media(t2.map((q) => q.tEscape)), '°C');
      add(`${rotulo} plena carga: gás na abertura e o fator de densidade`, 'fator < teto 1,8 (o 1,3 do Ronco achataria)', `${f1(media(t.map((q) => q.tAbertura)), 0)} K · máx. ${f1(t[t.length - 1].densMax, 2)}`, t[t.length - 1].densMax < 1.8, t[t.length - 1].densMax, '');
    }
    add('rx7fd lenta: parede do coletor (tEscape)', '400–500 °C', `${f1(media(tl.map((q) => q.tEscape)), 0)} °C`, dentro(media(tl.map((q) => q.tEscape)), 400, 500), media(tl.map((q) => q.tEscape)), '°C');
  }

  if (nome === 'bandas') {
    // RX-7 FC 13B turbo na lenta, da traseira (referencias/rotativo/rx7-fc3s-13b-turbo-lenta-aceleradas 27–37 s, 750 rpm
    // conferidos pela dobra: +8,9 / −17,2 / −35,2 / −41,0). O alvo antigo (RX-7 do Commons, −1 / −11 / −10,5, microfone
    // desconhecido) pedia 24–30 dB a mais de agudo: era ele que o modelo perseguia com ruído puro na boca, o "apenas ar"
    const lc = lenta3('rx7fc');
    conferirTeto('lenta 2 rotores de rua 750 rpm (rx7fc, ext) contra o FC3S casado', lc, [8.9, -17.2, -35.2, -41]);
    // o FD (abafador esportivo) na mesma régua: o agudo não passa do teto da gravação do FC com folga de 8 dB; e o
    // pré-silencioso retirado, com a mesma semente nos dois (a diferença é a do pré-silencioso, não a do sorteio)
    const ps = porSementes(() => {
      const l = lenta('rx7fd').m, sp = lenta('rx7fd', { escape: { ...preset('rx7fd').escape, presilencioso: false } }).m;
      return { b3: l.b[3], b4: l.b[4], d3: sp.abs[3] - l.abs[3], d4: sp.abs[4] - l.abs[4], di2: sp.ign2 - l.ign2 };
    });
    const q = medianas(ps);
    add('rx7fd lenta: 1–2,5 kHz e 2,5–6 kHz (rel. 150–400)', '≤ −27 / ≤ −33 dB (teto do FC3S + 8)', `${sg(q.b3)} / ${sg(q.b4)} dB`, q.b3 <= -27 && q.b4 <= -33, [q.b3, q.b4], 'dB');
    add('rx7fd lenta, pré-silencioso retirado: 1–2,5 kHz e 2,5–6 kHz sobem (absoluto)', '≥ 6 dB', `${sg(q.d3)} / ${sg(q.d4)} dB`, q.d3 >= 6 && q.d4 >= 6, [q.d3, q.d4], 'dB');
    add('rx7fd lenta, pré-silencioso retirado: 2·ign sobe', '≥ 4 dB', `${sg(q.di2)} dB (linha sobre a mediana; sementes ${fmtSementes(ps.map((x) => x.di2))})`, q.di2 >= 4, q.di2, 'dB');
    // "som de ar" no Ø mínimo da saída (REVISAO-DE-SOM): fração da potência abaixo de 1 kHz que é o ruído de jato da ponta
    // (diferença exata com o jato desligado, a mesma semente nos dois), no Ø de fábrica e no mínimo do painel (25 mm), com
    // a ponteira de fábrica
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
    add('rx7fd lenta: ruído de jato da ponta em 150 Hz–1 kHz (Ø de fábrica / Ø 25 mm com a ponteira de fábrica)', '≤ 10% / ≤ 10%', `${f1(j76)}% / ${f1(j25)}%`, j76 <= 10 && j25 <= 10, [j76, j25], '%');
    // RX-8 a 5 000 rpm sustentados (Commons u-Lc2 20–24 s)
    const r8 = sustentado3('rx8hp', 5000);
    conferirTeto('5 000 rpm sustentados, Renesis (rx8hp, ext) contra o RX-8 do Commons', r8, [-8, -10, -11, -10.5]);
  }

  if (nome === 'bandas-b') {
    // 787B a 7 700 rpm em neutro (6VCl 89–92 s, 5 m)
    const b7 = sustentado3('r26b', 7700);
    conferirBandas('7 700 rpm em neutro, 4 rotores megafone (r26b)', b7, [-6.5, 20, 19, 6.7], [930, 930]);
    // lenta do 787B (6VCl, 5 m: −2 … +5 / −5 … −10 / −11 … −20 / −14 … −18), quente, depois de 20 s
    const b0 = lenta3('r26b', {}, { dur: 30, med: 12 });
    conferirTeto('lenta 4 rotores periférica (r26b)', b0, [3.5, -7.5, -15.5, -16]);
    // Norton na lenta aquecendo (Fx7, 2 m: +7 … +12 / −2 … −3 / −3 … −6 / −12 … −13), 1 900 rpm
    const nt = lenta3('norton', { idle: 1900 }, { dur: 14, med: 6 });
    conferirTeto('lenta 2 rotores moto 1 900 rpm (norton)', nt, [9.5, -2.5, -4.5, -12.5]);
    // Ro80 frio a 1 600 rpm (1JOt: −2 / −10 / −12 / −20)
    const ro = lenta3('ro80', { idle: 1600 }, { dur: 14, med: 6 });
    conferirTeto('lenta fria carburada 1 600 rpm (ro80)', ro, [-2, -10, -12, -20]);
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
        add(`${id} ${rot}: jato, chiado de admissão, vedações e chiado do turbo desligados juntos`, 'muda o nível ponderado A em < 1,5 dB', `${sg(a - b, 2)} dB`, Math.abs(a - b) < 1.5, a - b, 'dB');
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
        add(`rx7fc ${cond}, ${nome2}: chiado do jato no nível ponderado A`, '≤ 35% (em posição nenhuma é a fonte dominante)', `${f1(fr, 0)}%`, fr <= 35, fr, '%');
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
    add('rx7fc, ponteira no mínimo (20 mm num escape de 70): o pulso, sem o chiado, na lenta / em plena carga a 5 000 rpm', 'cai nos dois, e pelo menos 6 dB a mais em carga (a contrapressão amolece o pulso com o escoamento)', `${sg(dl)} / ${sg(dc)} dB`, dl <= 0.5 && dc <= dl - 6, [dl, dc], 'dB');
  }

  if (nome === 'linhas') {
    // (as linhas de uma lenta e de um giro sustentado pela mediana de 3 sementes)
    const l = lenta3('rx7fd');
    const h = [l.ign, l.ign2, l.ign3];
    add('rx7fd lenta: harmônicos 1–3 da ignição', 'dentro de 6 dB (gravação +19 / +17 / +24)', h.map((x) => sg(x)).join(' / '), Math.max(...h) - Math.min(...h) <= 6, h, 'dB');
    // meia-ordem (o ciclo de 720° do pistão): banda lateral a ±rpm/120 em volta de 2·ign e 3·ign, sobre o piso; e o controle,
    // o mesmo trecho com 30% de modulação a rpm/120, para a medida provar que enxerga a linha quando ela existe. Com o eixo
    // travado na rotação da lenta e o torque médio zerado: na lenta solta a rotação passeia e borra as linhas (a portadora
    // fica a 4 dB do piso e nem o controle aparece)
    const mos = porSementes(() => {
      const segL = meiaLenta('rx7fd'), mo = B.meiaOrdem(segL, SR, preset('rx7fd').idle, 2);
      const wm = (2 * Math.PI * mo.rpm) / 120 / SR, ctl = B.meiaOrdem(Float64Array.from(segL, (v, i) => v * (1 + 0.3 * Math.cos(wm * i))), SR, preset('rx7fd').idle, 2);
      return { db: mo.db, portadora: mo.portadora, rpm: mo.rpm, ctl: ctl.db };
    });
    const mo = medianas(mos);
    add('rx7fd na rotação da lenta, eixo travado: banda lateral de meia-ordem (±rpm/120 em volta de 2·ign e 3·ign)', '≤ +3 dB sobre o piso, com a portadora ≥ 15 dB acima dele (o Wankel não tem o ciclo de 720°)', `${sg(mo.db)} dB (portadora ${sg(mo.portadora)} dB, ${f1(mo.rpm, 0)} rpm; sementes ${fmtSementes(mos.map((x) => x.db))})`, mo.db <= 3 && mo.portadora >= 15, [mo.db, mo.portadora], 'dB');
    add('rx7fd na rotação da lenta: a mesma medida no trecho modulado em 720° (controle: 30% a rpm/120)', '≥ +8 dB (a medida enxerga a meia-ordem quando ela existe)', `${m3(mos.map((x) => x.ctl)).txt} dB`, mo.ctl >= 8, mo.ctl, 'dB');
    const r8 = sustentado3('rx8hp', 5000, (m) => ({ o53: m.linha((5 * 5000) / 180) }));
    add('rx8hp 5 000 rpm: ignição sobre a mediana', '+27 ± 4 dB', `${sg(r8.ign)} dB`, Math.abs(r8.ign - 27) <= 4, r8.ign, 'dB');
    add('rx8hp 5 000 rpm: ordem 1 contra a ignição', '−15 ± 5 dB', `${sg(r8.o1 - r8.ign)} dB`, Math.abs(r8.o1 - r8.ign + 15) <= 5, r8.o1 - r8.ign, 'dB');
    add('rx8hp 5 000 rpm: ordens 2/3 e 5/3 contra a ignição', '−16 ± 5 dB', `${sg(r8.o23 - r8.ign)} / ${sg(r8.o53 - r8.ign)} dB`, Math.abs(r8.o23 - r8.ign + 16) <= 5 && Math.abs(r8.o53 - r8.ign + 16) <= 5, [r8.o23 - r8.ign, r8.o53 - r8.ign], 'dB');
    const b7 = sustentado3('r26b', 7700);
    add('r26b 7 700 rpm: ignição sobre a mediana', '≥ +22 dB', `${sg(b7.ign)} dB`, b7.ign >= 22, b7.ign, 'dB');
    add('r26b 7 700 rpm: ordem 1 contra a ignição', '≤ −10 dB (na gravação casada a banda de 60–150 Hz inteira fica 27 dB abaixo da ignição)', `${sg(b7.o1 - b7.ign)} dB`, b7.o1 - b7.ign <= -10, b7.o1 - b7.ign, 'dB');
    add('r26b 7 700 rpm: 2·ign contra a ignição', '−6 dB (±4)', `${sg(b7.ign2 - b7.ign)} dB`, Math.abs(b7.ign2 - b7.ign + 6) <= 4, b7.ign2 - b7.ign, 'dB');
  }

  if (nome === 'lenta') {
    // (vagar, CV, estalos e a forma da envoltória dependem da explosão a explosão: tudo pela mediana de 3 sementes)
    const ls = porSementes(() => {
      const l = lenta('rx7fd', {}, { dur: 20, med: 12 });
      // (o detector conta picos de 1–6 kHz 10 dB acima da mediana: com o agudo preso ao pulso ele conta as próprias
      // explosões, uma por ignição; estalo é o que passar disso)
      const fi0 = (l.rpm * 2) / 60;
      // (o outro critério do ROTATIVO 8.1 contra a pós-queima virando chiado contínuo: desvio/média da envoltória de 1–6 kHz)
      const e16 = B.envoltoria(mono(l.r.L, l.r.R, 8, 20), SR, 1000, 6000, 600);
      let me = 0; for (const v of e16) me += v; me /= e16.length;
      let ve = 0; for (const v of e16) ve += (v - me) ** 2;
      return { vagar: l.m.vagar, cv: l.m.cvCiclo, pops: l.m.pops, fi0, estalos: l.m.pops - fi0, p9010: l.m.p9010, dm: Math.sqrt(ve / e16.length) / me };
    });
    const vg = m3(ls.map((x) => x.vagar)), cv = m3(ls.map((x) => x.cv), 2), es = m3(ls.map((x) => x.estalos)), pp = m3(ls.map((x) => x.p9010)), dm = m3(ls.map((x) => x.dm), 2);
    add('lenta original quente (rx7fd): vagar', '≤ 3%', `${vg.txt} %`, vg.m <= 3, vg.m, '%');
    add('lenta original quente (rx7fd): CVciclo', '0,20–0,30', cv.txt, dentro(cv.m, 0.2, 0.3), cv.m, '');
    add('lenta original quente (rx7fd): estalos/s além das próprias explosões', '≤ 1,5 (o detector conta até um pico por ignição)', `${f1(Math.max(0, es.m))} (${es.txt}; ${f1(mediana(ls.map((x) => x.pops)))} picos/s; ignição ${f1(mediana(ls.map((x) => x.fi0)))}/s)`, es.m <= 1.5, es.m, '/s');
    add('lenta original quente (rx7fd): p90/p10 de 1–6 kHz (o agudo preso ao pulso)', '≥ 7 dB (a gravação é piso de pulso)', `${pp.txt} dB`, pp.m >= 7, pp.m, 'dB');
    add('lenta original quente (rx7fd): desvio/média da envoltória de 1–6 kHz (o agudo preso ao pulso)', '≥ 0,5', dm.txt, dm.m >= 0.5, dm.m, '');
    const sts = porSementes(() => { const st = lenta('rx7fd', { janelas: { admissao: 'street', escape: 'periferico' } }, { dur: 20, med: 12 }); return { vagar: st.m.vagar, rpm: st.rpm }; });
    const sv = m3(sts.map((x) => x.vagar));
    add('street port (rx7fd, sobreposição 28°e): lenta estável', 'vagar ≤ 3%', `${sv.txt} % · ${f1(mediana(sts.map((x) => x.rpm)), 0)} rpm`, sv.m <= 3, sv.m, '%');
  }

  if (nome === 'lenta-b') {
    // 787B: caça da lenta periférica, quente (44 s; mede 24 s depois de 20 s), pela mediana de 3 sementes; "sem apagar" vale
    // para as três
    const rs = porSementes(() => {
      const p = preset('r26b'), d = novoDSP(p, { quente: true });
      const seq: number[] = []; let tSeq = 0;
      (d as any).sondaEv = (_c: number, q: boolean) => { if (tSeq > 20) seq.push(q ? 1 : 0); };
      const r = renderizar(d, 44, [], (_x, t) => { tSeq = t; });
      const t = trecho(r.tele, 20, 44), rpms = t.map((q) => q.rpm);
      const m = B.medirRot(mono(r.L, r.R, 26, 38), SR, { rotores: 4, fmin: (1300 * 4) / 60, fmax: (2600 * 4) / 60 });
      const jan: number[] = []; for (let s = 20; s < 44; s++) jan.push(media(trecho(r.tele, s, s + 1).map((q) => q.rpm)));
      const vt = (100 * Math.sqrt(media(jan.map((x) => (x - media(jan)) ** 2)))) / media(jan);
      // o "brap": cada câmara alterna queima e falha (a diluição pela sobreposição), o padrão se repete a cada ~6 voltas do eixo
      const mu = media(seq), vr = media(seq.map((x) => (x - mu) ** 2));
      const ac = (voltas: number) => { const k = voltas * 4; let a = 0; for (let i = 0; i + k < seq.length; i++) a += (seq[i] - mu) * (seq[i + k] - mu); return a / Math.max(vr * (seq.length - k), 1e-12); };
      return { min: Math.min(...rpms), max: Math.max(...rpms), apagou: t.every((q) => q.state === 'run') ? 0 : 1, vagar: m.vagar, vt, cv: m.cvCiclo, pops: m.pops, soltos: media(t.map((q) => q.estouros)), mu, ac3: ac(3), ac6: ac(6) };
    });
    const r = medianas(rs), apagou = rs.some((x) => x.apagou);
    add('lenta periférica (r26b): faixa da caça', '1 450–2 350 rpm, sem apagar (a gravação caça de 1 600 a 2 200)', `${f1(r.min, 0)}–${f1(r.max, 0)} rpm (sementes ${rs.map((x) => `${f1(x.min, 0)}–${f1(x.max, 0)}`).join(' · ')})${apagou ? ' · APAGOU' : ''}`, r.min >= 1450 && r.max <= 2350 && !apagou, [r.min, r.max], 'rpm');
    add('lenta periférica (r26b): vagar em 12 s (o método das gravações)', '≥ 20%', `${m3(rs.map((x) => x.vagar)).txt} % (pela telemetria, janelas de 1 s: ${f1(r.vt)}%)`, r.vagar >= 20, r.vagar, '%');
    add('lenta periférica (r26b): CVciclo', '≥ 0,40', m3(rs.map((x) => x.cv), 2).txt, r.cv >= 0.4, r.cv, '');
    add('lenta periférica (r26b): estalos/s', '5–16 (as rajadas do "brap" a ~5 Hz, com um a três picos cada)', `${m3(rs.map((x) => x.pops)).txt} (estouros soltos criados: ${f1(r.soltos)}/s)`, dentro(r.pops, 5, 16), r.pops, '/s');
    add('lenta periférica (r26b): fração das explosões que queimam', '35–70% (rajadas, não falhas soltas)', `${m3(rs.map((x) => 100 * x.mu), 0).txt} %`, dentro(r.mu, 0.35, 0.7), 100 * r.mu, '%');
    add('lenta periférica (r26b): ritmo do "brap" (autocorrelação da sequência queimou/falhou a 3 e a 6 voltas do eixo)', '≤ −0,5 a 3 voltas e ≥ +0,4 a 6 (rpm/360: 5,2 Hz na gravação)', `${sg(r.ac3, 2)} / ${sg(r.ac6, 2)} (sementes ${rs.map((x) => `${sg(x.ac3, 2)}/${sg(x.ac6, 2)}`).join(' · ')})`, r.ac3 <= -0.5 && r.ac6 >= 0.4, [r.ac3, r.ac6], '');
    // bridge port (sobreposição ~100°e): a lenta em rajadas, sem apagar
    const bs = porSementes(() => {
      const pb = preset('rx7fc', { janelas: { admissao: 'bridge', escape: 'periferico' }, idle: 1950 }), db = novoDSP(pb, { quente: true });
      const sb: number[] = []; let tb = 0;
      (db as any).sondaEv = (_c: number, q: boolean) => { if (tb > 10) sb.push(q ? 1 : 0); };
      const rb = renderizar(db, 30, [], (_x, t) => { tb = t; });
      const tlb = trecho(rb.tele, 10, 30), rb2 = tlb.map((q) => q.rpm);
      return { q: media(sb), min: Math.min(...rb2), max: Math.max(...rb2), apagou: tlb.every((q) => q.state === 'run') ? 0 : 1 };
    });
    const b = medianas(bs), bApagou = bs.some((x) => x.apagou);
    add('bridge port (rx7fc, sobreposição 98°e, lenta a 1 950): em rajadas, sem apagar', '40–75% das explosões queimam; 1 450–2 350 rpm', `${f1(100 * b.q, 0)}% · ${f1(b.min, 0)}–${f1(b.max, 0)} rpm (sementes ${bs.map((x) => `${f1(100 * x.q, 0)}% ${f1(x.min, 0)}–${f1(x.max, 0)}`).join(' · ')})${bApagou ? ' · APAGOU' : ''}`, dentro(b.q, 0.4, 0.75) && b.min >= 1450 && b.max <= 2350 && !bApagou, [100 * b.q, b.min, b.max], '');
    // janelas de fábrica: nenhuma falha por diluição
    const fs = porSementes(() => {
      const pf = preset('rx7fc'), df = novoDSP(pf, { quente: true });
      const sf: number[] = []; (df as any).sondaEv = (_c: number, q: boolean) => { sf.push(q ? 1 : 0); };
      renderizar(df, 12, []);
      return 100 * media(sf);
    });
    const fq = m3(fs);
    add('janelas de fábrica (rx7fc): a mistura acende sempre', '≥ 99% das explosões', `${fq.txt} %`, fq.m >= 99, fq.m, '%');
  }

  if (nome === 'estouros') {
    // desaceleração em ponto morto (como o 787B do 6VCl, 98–102 s): pé no fundo até 70% de rpmMax, pé fora; estouros nos 2 s seguintes
    const decel = (id: string) => {
      const p = preset(id), d = novoDSP(p, { quente: true, rpm: p.idle });
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
    // (são ~13 estouros em 2 s, sorteados: a conta de uma semente só varia ±2/s; mediana de 3 sementes, AUDITORIA T-ROT-10)
    const as = porSementes(() => decel('rx8hp')), a = medianas(as);
    add("desaceleração rx8hp ('burble'): estouros/s", '4–6', `${m3(as.map((x) => x.criados)).txt} criados · ${f1(a.detect)} detectados (altura ${f1(a.alt)} dB) a ${f1(a.rpm, 0)} rpm`, dentro(a.criados, 4, 6), a.criados, '/s');
    const bs = porSementes(() => decel('r26b')), b = medianas(bs);
    add("desaceleração r26b ('burble', periférico): estouros/s (criados, mediana de 3 sementes)", '3,5–7,5', `${m3(bs.map((x) => x.criados)).txt} criados · ${f1(b.detect)} detectados (altura ${f1(b.alt)} dB) a ${f1(b.rpm, 0)} rpm`, dentro(b.criados, 3.5, 7.5), b.criados, '/s');
  }

  if (nome === 'turbo') {
    // sweep do FD no dinamômetro (rotação imposta de 2 500 a 8 000 rpm em 8 s, pé no fundo): a troca do turbo e o soluço
    // (um transiente: mediana de 3 sementes)
    const ss = porSementes(() => {
      const p = preset('rx7fd'), d = novoDSP(p, { quente: true, rpm: 2500 });
      travar(d, 2500, 1);
      const serie: { t: number; rpm: number; boost: number }[] = [];
      renderizar(d, 9, [], (x, t) => { const rpm = Math.min(8000, 2500 + (5500 * t) / 8); x.omega = (rpm * Math.PI) / 30; x.rpmAvg = rpm; if (Math.round(t * SR) % 256 < 128) serie.push({ t, rpm: x.rpmAvg, boost: x.boost }); });
      const troca = serie.find((q) => q.rpm >= 4500);
      const antes = serie.filter((q) => troca && q.t > troca.t - 0.3 && q.t < troca.t), depois = serie.filter((q) => troca && q.t >= troca.t && q.t < troca.t + 0.5);
      const bAntes = Math.max(...antes.map((q) => q.boost)), bMin = Math.min(...depois.map((q) => q.boost));
      const fundo = depois.filter((q) => q.boost < bAntes - 0.05);
      const faixa = serie.filter((q) => q.rpm > 3000 && q.rpm < 7800 && !(troca && q.t > troca.t - 0.05 && q.t < troca.t + 0.45));
      return { queda: bAntes - bMin, durac: fundo.length ? fundo[fundo.length - 1].t - fundo[0].t : 0, rpmTroca: troca?.rpm ?? NaN, n: faixa.length, bmin: Math.min(...faixa.map((q) => q.boost)), bmax: Math.max(...faixa.map((q) => q.boost)) };
    });
    const t = medianas(ss);
    add('rx7fd sweep: queda do boost na troca do turbo (4 500 ± 100 rpm)', '0,1–0,2 bar por 0,15–0,4 s', `${f1(t.queda, 2)} bar · ${f1(t.durac, 2)} s (em ${f1(t.rpmTroca, 0)} rpm; sementes ${ss.map((x) => `${f1(x.queda, 2)}/${f1(x.durac, 2)}`).join(' · ')})`, dentro(t.queda, 0.1, 0.2) && dentro(t.durac, 0.15, 0.4), [t.queda, t.durac], '');
    add('rx7fd sweep: boost de 3 000 a 8 000 rpm (fora do soluço)', '0,60–0,78 bar (a ficha dá 0,7)', `${f1(t.bmin, 2)}–${f1(t.bmax, 2)} bar`, t.n > 5 && t.bmin >= 0.6 && t.bmax <= 0.78, [t.bmin, t.bmax], 'bar');
    // RX-8: degraus de AinMax nas janelas secundária e auxiliar (grade de 50 rpm; o meio do degrau por interpolação linear
    // entre os dois pontos da grade que o cercam: sem ela a medida caía sempre no ponto seguinte, 50 rpm acima, no limite
    // exato da tolerância; AUDITORIA T-ROT-07)
    const q8 = preset('rx8hp'), d8 = novoDSP(q8, { quente: true, rpm: 3000 });
    const pts: { rpm: number; ain: number; tq: number }[] = [];
    for (let rpm = 3500; rpm <= 6700; rpm += 50) {
      travar(d8, rpm, 1); const r = renderizar(d8, 0.08, []);
      pts.push({ rpm, ain: r.tele.length ? r.tele[r.tele.length - 1].janelas.ainRel : d8.AinMaxRpm / d8.AinPrim, tq: d8.tqMean });
    }
    const meio = (lo: number, hi: number, desde = 0) => {
      const alvo = (lo + hi) / 2, i = pts.findIndex((q) => q.rpm > desde && q.ain > alvo);
      if (i <= 0) return NaN;
      const a = pts[i - 1], b = pts[i];
      return a.rpm + ((b.rpm - a.rpm) * (alvo - a.ain)) / (b.ain - a.ain || 1e-12);
    };
    const a1 = pts[0].ain, a2 = pts.find((q) => q.rpm === 5000)!.ain, a3 = pts[pts.length - 1].ain;
    const g1 = meio(a1, a2), g2 = meio(a2, a3, 5500);
    add('rx8hp: degraus das janelas secundária e auxiliar', '3 750 e 6 250 ± 50 rpm', `${f1(g1, 0)} e ${f1(g2, 0)} rpm (AinMax ×${f1(a1, 2)} → ×${f1(a2, 2)} → ×${f1(a3, 2)})`, Math.abs(g1 - 3750) <= 50 && Math.abs(g2 - 6250) <= 50, [g1, g2], 'rpm');
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
      const e = new EngineDSP(SR); e.setConfig(configCalibrada(pc, SR)); semear(e);
      e.message({ type: 'input', temp: { mode: 'fixed', value: 90 } }); e.coolant = 90; e.state = 'run'; e.ignition = true; e.runT = 120; e.warm = 1; e.omega = (pc.idle * Math.PI) / 30; e.rpmAvg = pc.idle;
      const vp = vibDe(e, pc.idle);
      add(`vibração na lenta: rx8hp contra ${id} (Ronco)`, '10–15 dB abaixo', `${f1(vr - vp)} dB`, dentro(vp - vr, 10, 15), vr - vp, 'dB');
    }
    // tiques do ápice: sem cliques contáveis em lenta (p90/p10 de 2–6 kHz da mecânica; mediana de 3 sementes)
    const pp = m3(porSementes(() => {
      const l = lenta('rx8hp', { kHC: 0 }, { dur: 10, med: 6, ouvinte: 'bay' });
      const env = B.envoltoria(mono(l.r.L, l.r.R, 4, 10), SR, 2000, 6000, 600);
      const s = Float64Array.from(env).sort();
      return 20 * Math.log10(s[Math.round(0.9 * (s.length - 1))] / (s[Math.round(0.1 * (s.length - 1))] + 1e-12));
    }));
    add('tiques das vedações em lenta (rx8hp no cofre, sem pós-queima): p90/p10 de 2–6 kHz', '≤ 12 dB (fundidos, sem cliques contáveis)', `${pp.txt} dB`, pp.m <= 12, pp.m, 'dB');
    const mos = porSementes(() => B.meiaOrdem(meiaLenta('rx8hp', { kHC: 0 }, 'bay'), SR, preset('rx8hp').idle, 2)), mo = medianas(mos);
    add('rx8hp no cofre, eixo travado na rotação da lenta: banda lateral de meia-ordem (±rpm/120 em volta de 2·ign e 3·ign)', '≤ +3 dB sobre o piso, com a portadora ≥ 15 dB acima dele', `${sg(mo.db)} dB (portadora ${sg(mo.portadora)} dB; sementes ${fmtSementes(mos.map((x) => x.db))})`, mo.db <= 3 && mo.portadora >= 15, [mo.db, mo.portadora], 'dB');
  }

  if (nome.startsWith('portadores')) {
    const R = await import('./rotativo-cena');
    const A = await import('./cena/analise');
    /** ouvirRot com o ruído do portador e do motor na semente atual (antes do primeiro bloco) */
    const ouvirRot = (id: string, o: Parameters<typeof R.ouvirRot>[1]) => {
      let semeado = false;
      return R.ouvirRot(id, { ...o, aoBloco: (t, p, m) => { if (!semeado) { semear(p); semear(m); semeado = true; } o.aoBloco?.(t, p, m); } });
    };
    if (nome === 'portadores') {
      // AR741 no Shadow: decolagem (hélice direta de 2 pás: a ignição é metade da BPF), no chão a 30 m/s
      const a = ouvirRot('ar741', { d: 20, pedal: 1, dur: 8, t0: 5, v: 40, s0: -40 });
      const ta = a.tele.slice(-12), rpmA = media(ta.map((q) => q.rpm)), bpf = media(ta.map((q) => q.bpf)), mt = media(ta.map((q) => q.machPonta));
      add('ar741 em voo, plena (40 m/s): passagem de pá', '≈ 260 Hz (7 800 rpm)', `${f1(bpf, 1)} Hz (${f1(rpmA, 0)} rpm)`, Math.abs(bpf / 260 - 1) <= 0.06, bpf, 'Hz');
      add('ar741: Mach na ponta', '0,88 (a 7 800 rpm)', f1(mt, 3), Math.abs(mt - 0.88) <= 0.05, mt, '');
      add('ar741: f_ign/BPF (1 rotor, 2 pás, direto)', '0,5', f1(rpmA / 60 / bpf, 3), Math.abs(rpmA / 60 / bpf - 0.5) <= 0.005, rpmA / 60 / bpf, '');
      // XTS-210 no gerador: o governador do portador segura a rotação com 50% de carga (mediana de 3 sementes)
      const gs = porSementes(() => {
        const g = ouvirRot('xts210', { d: 7.5, dur: 24, t0: 2, comando: { cargaFracao: 0.5 } });
        const tg = g.tele.filter((q) => q.t > 18);
        return { rpm: media(tg.map((q) => q.rpm)), carga: media(tg.map((q) => q.cargaFracao ?? 0)) };
      });
      const g = medianas(gs);
      add('xts210 no gerador (inversor, 6 000 rpm nominal), 50% de carga', '±3% da nominal', `${m3(gs.map((x) => x.rpm), 0).txt} rpm · carga ${f1(g.carga, 2)}`, Math.abs(g.rpm / 6000 - 1) <= 0.03, g.rpm, 'rpm');
      // 787B em Hunaudières: passagem a 340 km/h em 5ª, ouvinte a 15 m (razão Doppler da ignição)
      const v = 340 / 3.6, dlat = 15;
      const pb = ouvirRot('r26b', { d: dlat, pedal: 1, dur: 4, t0: 0, v, s0: -2 * v, solo: 'asfalto', comando: { marcha: 5, velocidadeFixa: v } });
      const x = pb.x, rpm = media(pb.tele.map((q) => q.rpm)), fi = (rpm * 4) / 60;
      const cosA = 0.79, xa = (cosA * dlat) / Math.sqrt(1 - cosA * cosA);
      const tA = (2 * v - xa) / v + Math.hypot(xa, dlat) / 343, tB = (2 * v + xa) / v + Math.hypot(xa, dlat) / 343;
      const fa = A.picoEm(x, SR, tA, 0.15, fi * 1.1, fi * 1.45), fr = A.picoEm(x, SR, tB, 0.15, fi * 0.65, fi * 0.9);
      const M = v / 343, teo = (1 + M * cosA) / (1 - M * cosA);
      add('787B passagem a 340 km/h (15 m): razão da ignição chegando/indo', `1,555 ± 5% (teoria ${f1(teo, 3)} com M ${f1(M, 3)})`, `${f1(fa / fr, 3)} (${f1(fa, 0)} / ${f1(fr, 0)} Hz; ${f1(rpm, 0)} rpm)`, Math.abs(fa / fr / 1.555 - 1) <= 0.05, fa / fr, '');
    } else {
      // AE50R no Camcopter: Nr e droop (coletivo 0,45 → 0,6 em 1 s); transientes: mediana de 3 sementes
      const hs = porSementes(() => {
        const h = ouvirRot('ae50r', { d: 20, pedal: 0.45, dur: 16, t0: 2, aoBloco: (t, p) => { (p as any).cmd.pedal = t < 10 ? 0.45 : t < 11 ? 0.45 + 0.15 * (t - 10) : 0.6; } });
        const nr = h.tele.map((q) => [q.t, q.Nr]);
        const est = media(nr.filter(([t]) => t > 8 && t < 10).map(([, v]) => v)), min = Math.min(...nr.filter(([t]) => t >= 10 && t < 13).map(([, v]) => v));
        return { est, droop: (100 * (est - min)) / est, fim: media(nr.filter(([t]) => t > 14).map(([, v]) => v)) };
      });
      const h = medianas(hs);
      add('ae50r com o rotor (S-100): Nr no pairado', '1 070 ± 2%', `${f1(h.est, 0)} rpm (no fim ${f1(h.fim, 0)})`, Math.abs(h.est / 1070 - 1) <= 0.02, h.est, 'rpm');
      add('ae50r: droop ao puxar o coletivo (0,45 → 0,6 em 1 s)', '≤ 3%', `${m3(hs.map((x) => x.droop), 2).txt} %`, h.droop <= 3, h.droop, '%');
      // Mistral: da lenta à plena (manete em 4 s) com o governador da hélice a 2 930 rpm
      const ms = porSementes(() => {
        const mi = ouvirRot('mistral', { d: 20, pedal: 0, dur: 14, t0: 1, aoBloco: (t, p) => { (p as any).cmd.pedal = t < 3 ? 0 : Math.min(1, (t - 3) / 4); } });
        const t75 = mi.tele.find((q) => q.t > 3 && q.rpm >= 0.95 * 7500 * 0.98)?.t;
        return { subida: (t75 ?? NaN) - 3, hel: media(mi.tele.filter((q) => q.t > 11).map((q) => q.rpmHelice)) };
      });
      const mi = medianas(ms);
      add('mistral: subida de 1 200 a ~7 500 rpm (manete em 4 s)', '4–6 s', `${m3(ms.map((x) => x.subida)).txt} s`, dentro(mi.subida, 4, 6), mi.subida, 's');
      add('mistral: governador da hélice', '2 930 ± 2%', `${m3(ms.map((x) => x.hel), 0).txt} rpm`, Math.abs(mi.hel / 2930 - 1) <= 0.02, mi.hel, 'rpm');
    }
    void B;
  }

  if (nome === 'xengine') {
    const s = sustentado('xmini', 12000);
    const A = await import('./cena/analise');
    const f = A.picoEm(mono(s.r.L, s.r.R, 2, 6), SR, 4, 3.5, 270, 330, 4);
    add('xmini a 12 000 rpm: f_ign (1,5 por volta, 3 câmaras, ciclo de 720°)', '300 Hz ± 0,5%', `${f1(f, 2)} Hz · cyc ${s.tl[0].cyc} · ${s.d.N} câmaras`, Math.abs(f / 300 - 1) <= 0.005 && s.tl[0].cyc === 720 && s.d.N === 3, f, 'Hz');
    for (const id of ['xmini', 'xts210']) {
      const p = preset(id), d = novoDSP(p, { quente: true, rpm: p.rpmMax * 0.55 });
      travar(d, p.rpmMax * 0.55, 1);
      const r = renderizar(d, 3, []);
      let nan = false; for (const v of r.L) if (!Number.isFinite(v)) { nan = true; break; }
      const t = trecho(r.tele, 1, 3), pEO = media(t.map((q) => q.pAbertura)) / 1e5;
      add(`${id} plena carga: pressão na abertura (expansão prolongada)`, '1,3–1,6 bar', `${f1(pEO, 2)} bar${id === 'xts210' ? ` · CR ${d.CR}` : ''}`, dentro(pEO, 1.3, 1.6), pEO, 'bar');
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
      semear(d);
      const tele: any[] = []; let pos = 0; d.post = (m) => tele.push({ ...m, t: pos / SR });
      const N = dur * SR, L = new Float32Array(N), R = new Float32Array(N), B2 = 128;
      d.message({ type: 'input', ignition: true, throttle: 1 });
      for (; pos < N; pos += B2) { if (op.carga !== undefined && pos === 4 * SR) d.message({ type: 'palhetas', carga: op.carga }); d.process(L.subarray(pos, pos + B2), R.subarray(pos, pos + B2), B2); }
      return { L, tele };
    };
    // (transientes e o jato, que é ruído: mediana de 3 sementes; o jato contra o tom passava por 0,2 dB, AUDITORIA T-ROT-10)
    const ps = porSementes(() => {
      const a = roda({ carga: 1 });
      const at = (t: number) => a.tele.find((q) => q.t >= t)!;
      const n0 = at(3.5).rpm, fp = (8 * n0) / 60;
      const fpm = A.picoEm(a.L, SR, 3, 1.5, fp * 0.95, fp * 1.05, 4);
      const seg = Float64Array.from(a.L.subarray(2 * SR, 4 * SR));
      const m = B.medirRot(seg, SR, { rotores: 1, fmin: 1, fmax: 2, fIgn: fp });
      const t90 = a.tele.find((q) => q.rpm > 0.9 * n0)!.t;
      const caiu = a.tele.find((q) => q.t > 4 && q.rpm < 0.7 * n0);
      // jato contra o tom em 2,5–6 kHz: com o ar (jato e descarga) desligado sobra o tom
      const sem = roda({ ar: 0 }, 4);
      const banda = (x: Float32Array) => { const s = Float64Array.from(x.subarray(2 * SR, 4 * SR)); const mm = B.medirRot(s, SR, { rotores: 1, fmin: 1, fmax: 2, fIgn: fp }); return mm.abs[4]; };
      const tot = banda(a.L), tom = banda(sem.L), jato = 10 * Math.log10(Math.max(1e-30, 10 ** (tot / 10) - 10 ** (tom / 10)));
      return { n0, fp, fpm, ign: m.ign, t90, queda: 100 * (1 - at(5.5).rpm / n0), t30: (caiu?.t ?? 99) - 4, jato, tom };
    });
    const q = medianas(ps);
    add('palhetas livre (8 palhetas): tom em z·n/60', `${f1(q.fp, 0)} Hz ± 1% (${f1(q.n0, 0)} rpm; 20 000 → 2 667 Hz)`, `${f1(q.fpm, 0)} Hz (${sg((100 * (q.fpm - q.fp)) / q.fp, 2)}%)`, Math.abs(q.fpm / q.fp - 1) <= 0.01, q.fpm / q.fp - 1, '');
    add('palhetas: tom sobre a mediana', '≥ 15 dB', `${m3(ps.map((x) => x.ign)).txt} dB`, q.ign >= 15, q.ign, 'dB');
    add('palhetas: da parada à rotação livre (90%)', '0,3–0,6 s', `${m3(ps.map((x) => x.t90), 2).txt} s`, dentro(q.t90, 0.3, 0.6), q.t90, 's');
    add('palhetas com 100% de carga: a rotação cai ≥ 30% em ≤ 1 s', '≥ 30% em ≤ 1 s', `${f1(q.queda, 0)}% · 30% em ${f1(q.t30, 2)} s`, q.t30 <= 1 && q.queda > 30, [q.queda, q.t30], '');
    const dj = m3(ps.map((x) => x.jato - x.tom), 2);
    add('palhetas: jato contra o tom em 2,5–6 kHz', 'jato ≥ tom', `jato − tom ${dj.txt} dB (jato ${f1(q.jato)} · tom ${f1(q.tom)} dB)`, dj.m >= 0, dj.m, 'dB');
    // arranque a ar: o hospedeiro (diesel) a 0,45 da lenta em 1–2 s
    const ar = porSementes(() => {
      const d = new PalhetasDSP(SR); d.message({ type: 'config', cfg: { ...p, modoPalhetas: 'arranque' } }); semear(d);
      const t2: any[] = []; let pos = 0; d.post = (mm) => t2.push({ ...mm, t: pos / SR });
      d.message({ type: 'input', ignition: true });
      const l = new Float32Array(128), r = new Float32Array(128);
      for (; pos < 5 * SR; pos += 128) d.process(l, r, 128);
      return { t: t2.find((q) => q.rpmHospedeiro >= 0.45 * 600)?.t ?? NaN, pegou: t2.find((q) => q.pegou)?.t ?? NaN };
    });
    const h = medianas(ar);
    add('palhetas, arranque a ar (Cat C15): o hospedeiro a 0,45·lenta', '1–2 s', `${m3(ar.map((x) => x.t), 2).txt} s (pega e solta o pinhão em ${f1(h.pegou, 2)} s)`, dentro(h.t, 1, 2), h.t, 's');
  }

  if (nome.startsWith('potencia')) {
    const { RotativoDSP } = await import('../src/engines/rotativo/dsp');
    const { PRESETS_ROTATIVO } = await import('../src/engines/rotativo/presets');
    // (o `tqMean` do DSP é uma média exponencial curta: a potência de cada ponto é a média de 2 s dele, depois de 0,25 s
    // de acomodação; com 0,6 s por ponto a potência do ae50r ia de 38,8 a 39,8 kW conforme a semente, AUDITORIA A2)
    const todos = PRESETS_ROTATIVO.filter((x) => x.tipo !== 'palhetas'), meio = Math.ceil(todos.length / 2);
    for (const s0 of nome === 'potencia' ? todos.slice(0, meio) : todos.slice(meio)) {
      const s = preset(s0.id), cfg = { ...C.cfgCalibrada(s), limiter: 'none' };
      const d = new RotativoDSP(SR); d.setConfig(cfg); semear(d);
      d.state = 'run'; d.lockOmega = true; d.tempMode = 'fixed'; d.coolant = 90; d.runT = 100; d.thrTarget = 1; d.thr = 1; d.turboW = 1; d.boost = cfg.boost; d.maxBoost = cfg.boost; d.carga = null;
      let mx = 0, fmx = 0;
      for (const f of [0.7, 0.8, 0.9, 1.0]) {
        d.omega = (s.rpmMax * f * 2 * Math.PI) / 60; d.rpmAvg = s.rpmMax * f; d.tqMean = 0;
        const B2 = 256, l = new Float32Array(B2), r = new Float32Array(B2);
        let sq = 0, n = 0;
        for (let i = 0; i < 2.25 * SR; i += B2) { d.process(l, r, B2); if (i >= 0.25 * SR) { sq += d.tqMean; n++; } }
        const kw = ((sq / n) * d.omega) / 1000; if (kw > mx) { mx = kw; fmx = f; }
      }
      add(`potência ${s0.id}`, `${s.power} kW ± 5%`, `${f1(mx, 1)} kW a ${f1(fmx * 100, 0)}% de rpmMax`, Math.abs(mx / s.power - 1) <= 0.05, mx, 'kW');
    }
  }

  if (nome === 'veiculo') {
    const kmhRpm = (id: string, marcha: number, kmh: number) => { const s = preset(id); return ((kmh / 3.6 / (2 * Math.PI * (s.wheelR || 0.33))) * 60 * s.ratios![marcha - 1] * (s.finalDrive || 4)); };
    const r1 = kmhRpm('rx7fd', 5, 100), r2 = kmhRpm('rx8hp', 6, 100);
    add('rx7fd a 100 km/h em 5ª (caixa do Type RS: 5ª 0,762, diferencial 4,3)', '2 750 ± 100 rpm', `${f1(r1, 0)} rpm`, Math.abs(r1 - 2750) <= 100, r1, 'rpm');
    add('rx8hp a 100 km/h em 6ª (relações da ficha)', '2 750 ± 100 rpm', `${f1(r2, 0)} rpm`, Math.abs(r2 - 2750) <= 100, r2, 'rpm');
    const s = preset('r26b'), v = (8500 / 60 / (s.ratios![4] * s.finalDrive!)) * 2 * Math.PI * s.wheelR! * 3.6;
    add('r26b em 5ª a 8 500 rpm', '340 ± 10 km/h', `${f1(v, 0)} km/h`, Math.abs(v - 340) <= 10, v, 'km/h');
    // Ro80 0–100 km/h com o semiautomático (um transiente: mediana de 3 sementes)
    const ts = porSementes(() => {
      const p = preset('ro80'), d = novoDSP(p, { quente: true });
      const ev: [number, (x: any) => void][] = [[0.2, (x) => x.message({ type: 'input', shift: 1 })], [0.5, (x) => x.message({ type: 'input', throttle: 1 })]];
      let t100 = NaN;
      renderizar(d, 25, ev as any, (x, t) => { if (Number.isNaN(t100) && x.v * 3.6 >= 100) t100 = t - 0.5; });
      return t100;
    });
    const t = m3(ts);
    add('ro80 0–100 km/h', '12–15 s', `${t.txt} s`, dentro(t.m, 12, 15), t.m, 's');
  }

  if (nome === 'niveis') {
    // lenta → plena carga a 55% (calibração da página) e a faixa das lentas dos carros e da moto. A lenta tem estalos e
    // falhas sorteados: os dois níveis pela mediana de 3 sementes (com uma só, o norton e o rx8std ficavam 0,1–0,2 dB
    // de um lado ou do outro do limite conforme a semente, AUDITORIA T-ROT desvios 25 e 26)
    const { PRESETS_ROTATIVO } = await import('../src/engines/rotativo/presets');
    const lentas: [string, number][] = [];
    for (const s0 of PRESETS_ROTATIVO.filter((x) => (x.portadores as string[]).includes('carro'))) {
      const p = preset(s0.id);
      const ns = porSementes(() => {
        const di = novoDSP(p, { quente: true }); const ri = renderizar(di, 6, []);
        const xi = mono(ri.L, ri.R, 3, 6); let ei = 0; for (const v of xi) ei += v * v;
        const dw = novoDSP(p, { quente: true, rpm: p.rpmMax * 0.55 }); travar(dw, p.rpmMax * 0.55, 1); const rw = renderizar(dw, 3, []);
        const xw = mono(rw.L, rw.R, 1.5, 3); let ew = 0; for (const v of xw) ew += v * v;
        return { li: 10 * Math.log10(ei / xi.length), lw: 10 * Math.log10(ew / xw.length) };
      });
      const li = mediana(ns.map((x) => x.li)), d = m3(ns.map((x) => x.lw - x.li));
      lentas.push([s0.id, li]);
      add(`${s0.id}: lenta → plena carga a 55% (página)`, '+18 a +25 dB', `${sg(d.m)} dB (sementes ${ns.map((x) => sg(x.lw - x.li)).join(' · ')})`, dentro(d.m, 18, 25), d.m, 'dB');
    }
    const vs = lentas.map(([, v]) => v);
    add('os carros e a moto na lenta: faixa de nível', '≤ 12 dB', `${f1(Math.max(...vs) - Math.min(...vs))} dB (${lentas.map(([k, v]) => `${k} ${f1(v)}`).join(', ')})`, Math.max(...vs) - Math.min(...vs) <= 12, Math.max(...vs) - Math.min(...vs), 'dB');
  }
  return L;
}

// ------------------------------------------------------------------ CLI
const GRUPOS = ['geometria', 'ciclo', 'bandas', 'bandas-b', 'ar', 'linhas', 'lenta', 'lenta-b', 'estouros', 'turbo', 'mecanica', 'portadores', 'portadores-b', 'xengine', 'palhetas', 'potencia', 'potencia-b', 'veiculo', 'niveis'];
const args = process.argv.slice(2);
if (args[0] === '--grupo') {
  iniciarSementes();
  grupo(args[1]).then((l) => process.stdout.write(JSON.stringify(l))).catch((e) => process.stdout.write(JSON.stringify([{ grupo: args[1], nome: 'execução do grupo', alvo: 'sem erro', medido: String(e?.stack || e).slice(0, 400), ok: false }])));
} else if (process.argv[1] && process.argv[1].endsWith('rotativo-valida.ts')) {
  const op = lerOpcoes(args);
  iniciarSementes(op.semente);
  const J = op.j ?? Math.max(2, Math.floor(os.cpus().length * 0.5));
  for (const g of op.resto) if (!GRUPOS.includes(g)) { console.error(`grupo desconhecido: ${g} (${GRUPOS.join(' ')}; a CPU saiu para npm run cpu:rotativo)`); process.exit(2); }
  const fila = op.resto.length ? op.resto : GRUPOS;
  const res: Record<string, Linha[]> = {};
  const t0 = Date.now();
  const rodar = (g: string) => new Promise<void>((ok) => {
    const p = spawn(process.execPath, ['--import', 'tsx', AQUI, '--grupo', g], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = ''; p.stdout.on('data', (b) => { out += b; });
    p.on('close', () => { try { res[g] = JSON.parse(out); } catch { res[g] = [{ grupo: g, nome: 'execução do grupo', alvo: 'sem erro', medido: out.slice(-300), ok: false }]; } console.error(`  (${g}: ${((Date.now() - t0) / 1000).toFixed(0)} s)`); ok(); });
  });
  (async () => {
    // (os grupos mais longos primeiro)
    const longos = ['bandas-b', 'niveis', 'ar', 'bandas', 'lenta-b', 'linhas', 'lenta', 'portadores', 'portadores-b', 'potencia', 'potencia-b'];
    const q = [...fila].sort((a, b) => (longos.includes(a) ? longos.indexOf(a) : 99) - (longos.includes(b) ? longos.indexOf(b) : 99));
    await Promise.all(Array.from({ length: Math.min(J, q.length) }, async () => { while (q.length) await rodar(q.shift()!); }));
    const linhas = fila.flatMap((g) => res[g] || []);
    const r = avaliarDesvios(RETRATO, linhas, { atualizar: op.atualizar, grupos: fila });
    // (o tempo antes da contagem: o verificar mostra a última linha)
    console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    imprimirAvaliacao(r, { motivo: true });
    process.exitCode = r.contagem.falha ? 1 : 0;
  })();
}
