// Testes dos governadores do Diesel (DIESEL.md 3.1, 3.2, 8 passos 5, 9 e 10): degraus de carga e de alvo; mede
// queda, tempo de recuperação, sobrepasso e oscilação a partir da telemetria (a cada 256 amostras).
//
//   npx tsx tools/diesel-governador.ts
import { renderizar, preset, media, type Cenario } from './diesel-comum';

type Tele = any[];
const quente = (d) => d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } });
const liga = (d) => d.message({ type: 'input', ignition: true });
const rodar = (id: string, cen: Cenario) => renderizar(preset(id), cen, { tele: 256 });

// queda máxima depois de t0 (relativa a ref), tempo até voltar e ficar a ±tol de ref, sobrepasso
function degrau(tl: Tele, t0: number, t1: number, ref: number, tol = 0.02) {
  const x = tl.filter((e) => e.t >= t0 && e.t < t1);
  const min = Math.min(...x.map((e) => e.rpm)), max = Math.max(...x.filter((e) => e.t > t0 + 0.2).map((e) => e.rpm));
  let tRec = NaN;
  for (let i = x.length - 1; i >= 0; i--) if (Math.abs(x[i].rpm - ref) / ref > tol) { tRec = (i + 1 < x.length ? x[i + 1].t : x[i].t) - t0; break; }
  if (Number.isNaN(tRec)) tRec = 0;
  return { queda: (ref - min) / ref, recupera: tRec, sobre: Math.max(0, (max - ref) / ref) };
}
// oscilação: pico a pico relativo e frequência dominante (cruzamentos da média)
function oscilacao(tl: Tele, t0: number, t1: number) {
  // (rotação alisada em ~0,1 s: tira a ondulação de cada explosão, que não é caça do governador)
  const raw = tl.filter((e) => e.t >= t0 && e.t < t1).map((e) => e.rpm), W = 19;
  const x = raw.map((_, i) => media(raw.slice(Math.max(0, i - W), Math.min(raw.length, i + W + 1)))).slice(W, -W), m = media(x);
  let cruz = 0; for (let i = 1; i < x.length; i++) if ((x[i - 1] - m) * (x[i] - m) < 0) cruz++;
  return { pp: (Math.max(...x) - Math.min(...x)) / m, hz: cruz / 2 / (t1 - t0), media: m };
}

export function testesGovernador() {
  const res: { nome: string; alvo: string; medido: string; ok: boolean }[] = [];
  const add = (nome, alvo, medido, ok) => res.push({ nome, alvo, medido, ok });
  // ---- rev em neutro: governador de máxima (min-max) segura rpmMax + 20 ± 30, oscilação < 1% p-p
  {
    const r = rodar('hilux28', { eventos: [[0, (d) => { quente(d); liga(d); }], [3, (d) => d.message({ type: 'input', throttle: 1 })], [9, null]], portador: 'carro' });
    const o = oscilacao(r.tele, 6, 9);
    add('hilux28 rev em neutro (governador de máxima)', '4420 ± 30 rpm, < 1% p-p', `${o.media.toFixed(0)} rpm, ${(o.pp * 100).toFixed(2)}% p-p`, Math.abs(o.media - 4420) <= 30 && o.pp < 0.01);
  }
  {
    const r = rodar('scaniav8', { eventos: [[0, (d) => { quente(d); liga(d); }], [2, (d) => d.message({ type: 'input', throttle: 1 })], [9, null]], portador: 'carro' });
    const o = oscilacao(r.tele, 6, 9);
    add('scaniav8 rev em neutro', '2120 ± 30 rpm, < 1% p-p', `${o.media.toFixed(0)} rpm, ${(o.pp * 100).toFixed(2)}% p-p`, Math.abs(o.media - 2120) <= 30 && o.pp < 0.01);
  }
  // ---- om617 (todas-as-rotações): droop entre pedal 1 em vazio e com carga de 100% do torque; caça em lenta
  {
    // (a carga do dinamômetro sobe devagar até o governador chegar ao combustível máximo: a rotação nesse ponto é a de
    // plena carga; 100% do torque da ficha só existe a 2400 rpm, longe da rotação governada)
    const r = rodar('om617', { eventos: [[0, (d) => { quente(d); liga(d); d.message({ type: 'diesel', portador: 'nenhum', govBancada: 'todas-as-rotacoes' }); }],
      [3, (d) => d.message({ type: 'input', throttle: 1 })], [16, null]], portador: 'nenhum',
      antes: (d, t) => { if (t > 8) d.message({ type: 'diesel', cargaBancada: Math.min(1.2, (t - 8) * 0.12) }); } });
    const vazio = media(r.tele.filter((e) => e.t > 6.5 && e.t < 8).map((e) => e.rpm));
    const cheio = r.tele.find((e) => e.t > 8 && e.fuel >= 0.97);
    const carga = cheio ? media(r.tele.filter((e) => e.t >= cheio.t - 0.1 && e.t <= cheio.t + 0.1).map((e) => e.rpm)) : 0;
    const dr = (vazio - carga) / vazio;
    add('om617 droop (pedal 1, vazio → combustível máximo)', '7–9%', `${(dr * 100).toFixed(1)}% (${vazio.toFixed(0)} → ${carga.toFixed(0)} rpm)`, dr >= 0.07 && dr <= 0.09);
    const r2 = rodar('om617', { eventos: [[0, (d) => { quente(d); liga(d); }], [14, null]], portador: 'carro' });
    const o = oscilacao(r2.tele, 6, 14);
    add('om617 caça em lenta', '±1–2% a 0,6–1,2 Hz', `±${(o.pp * 50).toFixed(1)}% a ${o.hz.toFixed(2)} Hz`, o.pp * 50 >= 0.5 && o.pp * 50 <= 2.5);
  }
  // ---- hilux28: degrau de carga de 30% do torque em lenta (min-max)
  {
    const r = rodar('hilux28', { eventos: [[0, (d) => { quente(d); liga(d); d.message({ type: 'diesel', portador: 'nenhum', govBancada: 'min-max' }); }],
      [5, (d) => d.message({ type: 'diesel', cargaBancada: 0.3 })], [11, null]], portador: 'nenhum' });
    const g = degrau(r.tele, 5, 11, 780);
    add('hilux28 degrau de 30% do torque em lenta', 'queda ≤ 8%, ±2% em < 2 s', `queda ${(g.queda * 100).toFixed(1)}%, recupera em ${g.recupera.toFixed(2)} s`, g.queda <= 0.08 && g.recupera < 2);
  }
  // ---- gen500: degrau 50% (queda 4–8%, < 3 s, sobrepasso ≤ 1%) e 100% (ISO 8528 G2: ≤ 10%, ≤ 5 s)
  {
    const r = rodar('gen500', { eventos: [[0, (d) => { quente(d); liga(d); }], [8, (d) => d.message({ type: 'diesel', degrau: 0.5 })], [16, (d) => d.message({ type: 'diesel', degrau: 0 })],
      [24, (d) => d.message({ type: 'diesel', degrau: 1 })], [32, null]], portador: 'gerador' });
    const g = degrau(r.tele, 8, 16, 1800);
    add('gen500 degrau de 50%', 'queda 4–8%, < 3 s, sobrepasso ≤ 1%', `queda ${(g.queda * 100).toFixed(1)}%, ${g.recupera.toFixed(2)} s, sobrepasso ${(g.sobre * 100).toFixed(1)}%`, g.queda >= 0.04 && g.queda <= 0.08 && g.recupera < 3 && g.sobre <= 0.01);
    const g2 = degrau(r.tele, 24, 32, 1800);
    add('gen500 degrau de 100% (ISO 8528 G2)', 'queda ≤ 10%, ≤ 5 s', `queda ${(g2.queda * 100).toFixed(1)}%, ${g2.recupera.toFixed(2)} s`, g2.queda <= 0.1 && g2.recupera <= 5);
  }
  // ---- locomotivas: rotação por notch ±1%, rampa de 100 rpm/s, potência ±3%
  for (const id of ['emd710', 'ge7fdl']) {
    const ev: any[] = [[0, (d) => { quente(d); liga(d); }]];
    for (let n = 1; n <= 8; n++) ev.push([5 + (n - 1) * 8, (d) => d.message({ type: 'diesel', notch: n })]);
    ev.push([5 + 64, null]);
    const r = rodar(id, { eventos: ev, portador: 'locomotiva' });
    const sp = preset(id).locomotiva!;
    let pior = 0, piorP = 0, piorN = 0;
    for (let n = 1; n <= 8; n++) {
      const x = r.tele.filter((e) => e.t > 5 + (n - 1) * 8 + 6 && e.t < 5 + n * 8);
      const rpm = media(x.map((e) => e.rpm)), kW = media(x.map((e) => e.cargaKW));
      const er = Math.abs(rpm - sp.notchRpm[n]) / sp.notchRpm[n];
      if (er > pior) { pior = er; piorN = n; }
      const kWa = [0, 0.05, 0.12, 0.23, 0.35, 0.48, 0.64, 0.82, 1][n] * sp.kW;
      piorP = Math.max(piorP, Math.abs(kW - kWa) / kWa);
    }
    // rampa: notch 1 → 8 de uma vez, inclinação entre 20% e 80% da subida
    const r2 = rodar(id, { eventos: [[0, (d) => { quente(d); liga(d); d.message({ type: 'diesel', notch: 1 }); }], [6, (d) => d.message({ type: 'diesel', notch: 8 })], [18, null]], portador: 'locomotiva' });
    const a = sp.notchRpm[1], b = sp.notchRpm[8];
    const x = r2.tele.filter((e) => e.t > 6);
    const ta = x.find((e) => e.rpm > a + 0.2 * (b - a))?.t, tb = x.find((e) => e.rpm > a + 0.8 * (b - a))?.t;
    const rampa = ta && tb ? (0.6 * (b - a)) / (tb - ta) : 0;
    add(`${id} rotação por notch`, '±1%', `pior ${(pior * 100).toFixed(2)}% (N${piorN})`, pior <= 0.01);
    add(`${id} potência por notch`, '±3%', `pior ${(piorP * 100).toFixed(1)}%`, piorP <= 0.03);
    add(`${id} rampa de rotação`, '100 rpm/s (±20%)', `${rampa.toFixed(0)} rpm/s`, rampa >= 80 && rampa <= 120);
  }
  return res;
}

if (process.argv[1] && process.argv[1].endsWith('diesel-governador.ts')) {
  const res = testesGovernador();
  console.log('| teste | alvo | medido | |\n|---|---|---|---|');
  for (const r of res) console.log(`| ${r.nome} | ${r.alvo} | ${r.medido} | ${r.ok ? 'ok' : 'FALHA'} |`);
  const f = res.filter((r) => !r.ok).length;
  console.log(f ? `${f} falha(s)` : 'GOVERNADORES OK');
  process.exit(f ? 1 : 0);
}
