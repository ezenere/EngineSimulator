// Testes dos governadores do Diesel (DIESEL.md 3.1, 3.2, 8 passos 5, 9 e 10): degraus de carga e de alvo; mede
// queda, tempo de recuperação, sobrepasso e oscilação a partir da telemetria (a cada 256 amostras).
//
// São transientes: cada teste roda com 3 sementes do ruído (base, base+1, base+2; tools/desvios.ts) e fica o caso
// mediano (AUDITORIA A2). Os desvios são os do retrato do `teste:diesel` (`tools/diesel-desvios.json`, grupos
// `governador-*`): rodado sozinho, este arquivo consulta o mesmo retrato e só sai com código ≠ 0 se houver falha de
// verdade (AUDITORIA A7, T-DSL-11; antes ele não conhecia a lista `DESVIOS` e saía com código 1 por duas medidas que
// o `teste:diesel` mostrava como desvio).
//
//   npx tsx tools/diesel-governador.ts [partes...] [--semente N] [--atualizar[=nome exato]]
//   partes: a (rev em neutro, OM617, degrau da Hilux), b (gen500), c (emd710), d (ge7fdl); sem parte, todas
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderizar, preset, media, casoMediano, filho, type Cenario, type LinhaDiesel } from './diesel-comum';
import { lerOpcoes, iniciarSementes, sementeBase, avaliarDesvios, imprimirAvaliacao, type Medida } from './desvios';

type Tele = any[];
type Teste = LinhaDiesel;
const AQUI = fileURLToPath(import.meta.url);
const RETRATO = path.join(path.dirname(AQUI), 'diesel-desvios.json');
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

/** uma passada (uma semente: a atual de tools/desvios.ts) dos testes de uma parte */
export function passadaGovernador(parte: string): Teste[] {
  const res: Teste[] = [];
  const g = `governador-${parte}`;
  const add = (nome: string, alvo: string, medido: string, ok: boolean, valor: number | number[], unidade = '', ordem?: number) => res.push({ grupo: g, nome, alvo, medido, ok, valor, unidade, ordem });
  if (parte === 'a') {
    // ---- rev em neutro: governador de máxima (min-max) segura rpmMax + 20 ± 30, oscilação < 1% p-p
    {
      const r = rodar('hilux28', { eventos: [[0, (d) => { quente(d); liga(d); }], [3, (d) => d.message({ type: 'input', throttle: 1 })], [9, null]], portador: 'carro' });
      const o = oscilacao(r.tele, 6, 9);
      add('hilux28 rev em neutro (governador de máxima)', '4420 ± 30 rpm, < 1% p-p', `${o.media.toFixed(0)} rpm, ${(o.pp * 100).toFixed(2)}% p-p`, Math.abs(o.media - 4420) <= 30 && o.pp < 0.01, [o.media, 100 * o.pp], '', Math.abs(o.media - 4420));
    }
    {
      const r = rodar('scaniav8', { eventos: [[0, (d) => { quente(d); liga(d); }], [2, (d) => d.message({ type: 'input', throttle: 1 })], [9, null]], portador: 'carro' });
      const o = oscilacao(r.tele, 6, 9);
      add('scaniav8 rev em neutro', '2120 ± 30 rpm, < 1% p-p', `${o.media.toFixed(0)} rpm, ${(o.pp * 100).toFixed(2)}% p-p`, Math.abs(o.media - 2120) <= 30 && o.pp < 0.01, [o.media, 100 * o.pp], '', Math.abs(o.media - 2120));
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
      add('om617 droop (pedal 1, vazio → combustível máximo)', '7–9%', `${(dr * 100).toFixed(1)}% (${vazio.toFixed(0)} → ${carga.toFixed(0)} rpm)`, dr >= 0.07 && dr <= 0.09, 100 * dr, '%');
      const r2 = rodar('om617', { eventos: [[0, (d) => { quente(d); liga(d); }], [14, null]], portador: 'carro' });
      const o = oscilacao(r2.tele, 6, 14);
      add('om617 caça em lenta', '±1–2% a 0,6–1,2 Hz', `±${(o.pp * 50).toFixed(1)}% a ${o.hz.toFixed(2)} Hz`, o.pp * 50 >= 0.5 && o.pp * 50 <= 2.5, [o.pp * 50, o.hz], '', o.pp * 50);
    }
    // ---- hilux28: degrau de carga de 30% do torque em lenta (min-max)
    {
      const r = rodar('hilux28', { eventos: [[0, (d) => { quente(d); liga(d); d.message({ type: 'diesel', portador: 'nenhum', govBancada: 'min-max' }); }],
        [5, (d) => d.message({ type: 'diesel', cargaBancada: 0.3 })], [11, null]], portador: 'nenhum' });
      const g = degrau(r.tele, 5, 11, 780);
      add('hilux28 degrau de 30% do torque em lenta', 'queda ≤ 8%, ±2% em < 2 s', `queda ${(g.queda * 100).toFixed(1)}%, recupera em ${g.recupera.toFixed(2)} s`, g.queda <= 0.08 && g.recupera < 2, [100 * g.queda, g.recupera], '', g.recupera);
    }
  }
  // ---- gen500: degrau 50% (queda 4–8%, < 3 s, sobrepasso ≤ 1%) e 100% (ISO 8528 G2: ≤ 10%, ≤ 5 s)
  if (parte === 'b') {
    const r = rodar('gen500', { eventos: [[0, (d) => { quente(d); liga(d); }], [8, (d) => d.message({ type: 'diesel', degrau: 0.5 })], [16, (d) => d.message({ type: 'diesel', degrau: 0 })],
      [24, (d) => d.message({ type: 'diesel', degrau: 1 })], [32, null]], portador: 'gerador' });
    const g = degrau(r.tele, 8, 16, 1800);
    add('gen500 degrau de 50%', 'queda 4–8%, < 3 s, sobrepasso ≤ 1%', `queda ${(g.queda * 100).toFixed(1)}%, ${g.recupera.toFixed(2)} s, sobrepasso ${(g.sobre * 100).toFixed(1)}%`, g.queda >= 0.04 && g.queda <= 0.08 && g.recupera < 3 && g.sobre <= 0.01, [100 * g.queda, g.recupera, 100 * g.sobre], '', 100 * g.queda);
    const g2 = degrau(r.tele, 24, 32, 1800);
    add('gen500 degrau de 100% (ISO 8528 G2)', 'queda ≤ 10%, ≤ 5 s', `queda ${(g2.queda * 100).toFixed(1)}%, ${g2.recupera.toFixed(2)} s`, g2.queda <= 0.1 && g2.recupera <= 5, [100 * g2.queda, g2.recupera], '', 100 * g2.queda);
  }
  // ---- locomotivas: rotação por notch ±1%, rampa de 100 rpm/s, potência ±3%
  for (const id of parte === 'c' ? ['emd710'] : parte === 'd' ? ['ge7fdl'] : []) {
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
    add(`${id} rotação por notch`, '±1%', `pior ${(pior * 100).toFixed(2)}% (N${piorN})`, pior <= 0.01, 100 * pior, '%');
    add(`${id} potência por notch`, '±3%', `pior ${(piorP * 100).toFixed(1)}%`, piorP <= 0.03, 100 * piorP, '%');
    add(`${id} rampa de rotação`, '100 rpm/s (±20%)', `${rampa.toFixed(0)} rpm/s`, rampa >= 80 && rampa <= 120, rampa, 'rpm/s');
  }
  return res;
}

export const PARTES_GOVERNADOR = ['a', 'b', 'c', 'd'];

const args = process.argv.slice(2);
if (args[0] === '--parte') {
  // (um processo por parte e por semente; a semente vem do ambiente)
  iniciarSementes();
  try { process.stdout.write(JSON.stringify(passadaGovernador(args[1]))); } catch (e: any) { process.stdout.write(JSON.stringify([{ grupo: `governador-${args[1]}`, nome: 'execução do grupo', alvo: 'sem erro', medido: String(e?.stack || e).slice(0, 400), ok: false }])); }
} else if (process.argv[1] && process.argv[1].endsWith('diesel-governador.ts')) {
  const op = lerOpcoes(args);
  iniciarSementes(op.semente);
  for (const p of op.resto) if (!PARTES_GOVERNADOR.includes(p)) { console.error(`parte desconhecida: ${p} (${PARTES_GOVERNADOR.join(' ')})`); process.exit(2); }
  const partes = op.resto.length ? op.resto : PARTES_GOVERNADOR;
  const t0 = Date.now(), base = sementeBase();
  const umaSemente = async (p: string, k: number): Promise<LinhaDiesel[]> => {
    const { saida } = await filho(AQUI, ['--parte', p], { semente: k });
    try { return JSON.parse(saida); } catch { return [{ grupo: `governador-${p}`, nome: 'execução do grupo', alvo: 'sem erro', medido: saida.slice(-300), ok: false }]; }
  };
  (async () => {
    // (as 3 sementes de cada parte em paralelo; cada medida fica com o caso mediano)
    const porParte = await Promise.all(partes.map((p) => Promise.all([0, 1, 2].map((i) => umaSemente(p, base + i)))));
    const linhas: Medida[] = porParte.flatMap((ls) => { try { return casoMediano(ls); } catch (e: any) { return [{ grupo: ls[0][0]?.grupo ?? 'governador', nome: 'execução do grupo', alvo: 'sem erro', medido: String(e?.message || e), ok: false }]; } });
    const r = avaliarDesvios(RETRATO, linhas, { atualizar: op.atualizar, grupos: partes.map((p) => `governador-${p}`) });
    console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    imprimirAvaliacao(r, { motivo: true });
    process.exitCode = r.contagem.falha ? 1 : 0;
  })();
}
