// Validação do Elétrico (ELETRICO.md 7, passos 1–12, e a tabela 3.7 contra as gravações). Tolerâncias de 3 (decisão):
// linhas ±1% (patamar do Taurus ±2%), bandas ±4 dB de 150 Hz a 6 kHz, razões ±0,05, Bessel ±1 dB; acima de 6 kHz só a
// física (as gravações são comprimidas).
//
//   npx tsx tools/eletrico/valida.ts [grupos...]     (linhas maquina magneticas inversor modos mecanica avas niveis
//                                                     portadores gravacoes cena passagem cpu; sem grupo, todos)
// Sai ≠ 0 se houver falha sem desvio documentado (os desvios aparecem como "desv" e estão no TECNICO → Elétrico).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  SR, preset, cfg, motor, portador, renderMotor, renderPortador, renderCena, welch, potFaixa, bandas, linha, nivelEm, dBA, lafMax, mono, fft,
} from './comum';
import { rastrear, patamares, picos } from './linhas';
import { BancoDeLinhas, ListaLinhas } from '../../src/engines/eletrico/linhas';
import { Inversor, dbTensao } from '../../src/engines/eletrico/inversor';
import { EstadoMaquina } from '../../src/engines/eletrico/maquina';
import { hCarcaca, F_CARC, NOTAS_TAURUS, TAU, REF_DIST_ELETRICO } from '../../src/engines/eletrico/constantes';
import { HARM_MAVIC } from '../../src/engines/eletrico/mecanica';
import { PRESETS_ELETRICO } from '../../src/engines/eletrico/presets';
import type { PresetEletrico } from '../../src/engines/eletrico/dsp';
import { Bq, PonderacaoA } from '../../src/scene/filtros';
import { Trem } from '../../src/carriers/trem';
import { CarroEletrico } from '../../src/carriers/carro-eletrico';
import { Multirrotor } from '../../src/carriers/multirrotor';
import { ambientePassagem } from '../../src/scene/ambientes';
import { paDeLw } from '../../src/carriers/ruido';
import { PA_FS, MAX_FONTES } from '../../src/scene/constantes';
import { Acumulador } from '../../src/engines/ronco/motor';
import { CenaDSP } from '../../src/scene/dsp-cena';

type Linha = { grupo: string; nome: string; alvo: string; medido: string; ok: boolean; desvio?: string };
const f1 = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const sg = (x: number, d = 1) => (x >= 0 ? '+' : '') + f1(x, d);
const dB = (x: number) => 20 * Math.log10(Math.max(x, 1e-30));
const dentro = (x: number, a: number, b: number) => x >= a && x <= b;
const perto = (x: number, alvo: number, tol: number) => Math.abs(x - alvo) <= tol;
const rel = (x: number, alvo: number) => Math.abs(x / alvo - 1);
const wDe = (rpm: number) => (rpm * TAU) / 60;

/** desvios conhecidos (nome da medida → por quê); também em docs/TECNICO.md → Elétrico */
const DESVIOS: Record<string, string> = {
  'pneus do carro a 80 km/h, a 7,5 m (só pneus, campo livre, CENA 4.1)': 'Os 73 dB(A) do CENA 4.1 somam as 4 rodas como se as 4 estivessem a 7,5 m; no corpo de 4,6 × 1,85 m o par do lado de lá fica 1,55 m mais longe e os eixos a ±1,4 m: 70,7 dB(A) no máximo da passagem em campo livre, com os 95 dB(A) por roda do CENA à letra (no asfalto a imagem da fonte no chão soma +5 dB).',
  'N700 de 16 carros (14 motores)': 'O trem de 16 vagões não cabe nas 64 fontes da Cena nem sem motor (2 truques + corpo + vão por vagão: 67 com uma face; maxVagoes dá 15). O orçamento é da Cena (CENA 5.1) e do trem sem motor, que esta etapa não muda; o N700 entra no trem-bala de 10 vagões da Passagem (8 carros motores, 63 fontes, agrupado por carro).',
};

const linhas: Linha[] = [];
let grupoAtual = '';
function caso(nome: string, alvo: string, medido: string, ok: boolean) { linhas.push({ grupo: grupoAtual, nome, alvo, medido, ok, desvio: ok ? undefined : DESVIOS[nome] }); }

/** canal de um motor por id (ou o primeiro que começa com o prefixo) */
const canal = (r: { canais: Float32Array[]; ids: string[] }, id: string) => { const i = r.ids.findIndex((x) => x === id || x.startsWith(id + '.')); return r.canais[i]; };
/** soma dos canais de uma lista de prefixos */
function somaCanais(r: { canais: Float32Array[]; ids: string[] }, prefixos: string[]) {
  const n = r.canais[0].length, s = new Float32Array(n);
  r.ids.forEach((id, i) => { if (prefixos.some((p) => id === p || id.startsWith(p + '.'))) { const c = r.canais[i]; for (let j = 0; j < n; j++) s[j] += c[j]; } });
  return s;
}
/** nível de uma linha corrigido pela curva da carcaça (para conferir as leis da tabela 1.1) */
const semH = (dBv: number, f: number, fc: number) => dBv - dB(hCarcaca(f, fc));

// =============================================================================================== 1. banco de linhas
function gLinhas() {
  const nL = 200, b = new BancoDeLinhas(SR, nL, 7), L = new ListaLinhas(256);
  const fq = Array.from({ length: nL }, (_, k) => 50 * Math.pow(20000 / 50, k / (nL - 1)));
  const am = fq.map((_, k) => 0.002 * (1 + (k % 5)));
  const N = 10 * SR, out = new Float32Array(N);
  const t0 = performance.now();
  for (let k = 0; k < N; k += 64) { L.limpar(); for (let i = 0; i < nL; i++) L.por(i, fq[i], am[i]); b.atualizar(L); b.processar(out, k, Math.min(64, N - k)); }
  const cpu = (performance.now() - t0) / 1000 / 10;
  // FFT de 2²⁰ com Hann sobre 9 s (o primeiro segundo fica de fora: rampas de entrada)
  const n = 9 * SR, NF = 1 << 20, re = new Float64Array(NF), im = new Float64Array(NF);
  let sw = 0;
  for (let i = 0; i < n; i++) { const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n); re[i] = out[SR + i] * w; sw += w; }
  fft(re, im);
  const mag = (k: number) => Math.hypot(re[k], im[k]);
  let eF = 0, eA = 0;
  const fMax = 0.45 * SR, fR = 0.375 * SR;
  for (let i = 0; i < nL; i++) {
    const k0 = Math.round((fq[i] * NF) / SR);
    let kb = k0; for (let k = k0 - 4; k <= k0 + 4; k++) if (mag(k) > mag(kb)) kb = k;
    const a = Math.log(mag(kb - 1)), bb = Math.log(mag(kb)), c = Math.log(mag(kb + 1)), d = (0.5 * (a - c)) / (a - 2 * bb + c);
    const f = ((kb + d) * SR) / NF, amp = (2 * Math.exp(bb - 0.25 * (a - c) * d)) / sw;
    let esp = am[i];
    if (fq[i] > fR) esp *= Math.pow(10, (-12 * (fq[i] - fR) / (fMax - fR)) / 20);
    eF = Math.max(eF, rel(f, fq[i])); eA = Math.max(eA, Math.abs(dB(amp / esp)));
  }
  let top = 0, cima = 0;
  for (let k = 1; k < NF / 2; k++) { const f = (k * SR) / NF, m = mag(k); if (m > top) top = m; if (f > 21700 && m > cima) cima = m; }
  caso('200 linhas de 50 Hz a 20 kHz: frequência', '±0,01%', `máx ${f1(eF * 100, 4)}%`, eF <= 1e-4);
  caso('200 linhas: nível (com a rampa de −12 dB acima de 18 kHz)', '±0,1 dB', `máx ${f1(eA, 3)} dB`, eA <= 0.1);
  caso('nada acima de 21,6 kHz', '< −100 dB da maior', `${f1(dB(cima / top))} dB`, dB(cima / top) < -100);
  caso('CPU de 200 linhas', '< 3% do tempo real', `${f1(cpu * 100, 2)}%`, cpu < 0.03);
  // troca de 100 linhas de uma vez: nenhum estalo (passa-alta de 16 kHz no trecho da troca; as linhas vão até 2 kHz)
  {
    const b2 = new BancoDeLinhas(SR, 128, 9), L2 = new ListaLinhas(256), M = 2 * SR, x = new Float32Array(M);
    for (let k = 0; k < M; k += 64) {
      L2.limpar();
      const B = k >= SR ? 100 : 0;
      for (let i = 0; i < 100; i++) L2.por(B + i, 60 + 19.5 * i + (B ? 7 : 0), 0.004);
      b2.atualizar(L2); b2.processar(x, k, 64);
    }
    const h1 = new Bq().hp(SR, 16000, 0.54), h2 = new Bq().hp(SR, 16000, 1.31);
    let pk = 0, pk0 = 0;
    for (let i = 0; i < M; i++) { const y = h2.run(h1.run(x[i])); if (i > SR - 2000 && i < SR + 4000) pk = Math.max(pk, Math.abs(y)); else if (i > 0.5 * SR && i < 0.9 * SR) pk0 = Math.max(pk0, Math.abs(y)); }
    caso('troca de 100 linhas de uma vez: estalo (acima de 16 kHz)', '< 0,05 FS', `${f1(pk, 5)} FS (fora da troca ${f1(pk0, 5)})`, pk < 0.05);
  }
  // sem alocação: --trace-gc num processo à parte (10 s do banco de 200 linhas e do motor do N700 com 4 unidades)
  {
    const aqui = path.dirname(fileURLToPath(import.meta.url));
    const r = spawnSync(process.execPath, ['--trace-gc', '--import', 'tsx', path.join(aqui, 'gc.ts')], { encoding: 'utf8', cwd: path.join(aqui, '../..') });
    const txt = r.stdout || '';
    const conta = (a: string, b: string) => { const i = txt.indexOf(a), j = txt.indexOf(b); if (i < 0 || j < 0) return NaN; return (txt.slice(i, j).match(/Scavenge|Mark-Compact|Mark-sweep/g) || []).length; };
    const nb = conta('INICIO-BANCO', 'FIM-BANCO'), nm = conta('INICIO-MOTOR', 'FIM-MOTOR');
    caso('sem alocação: 10 s do banco de 200 linhas', 'zero coletas', `${nb} coletas`, nb === 0);
    caso('quase sem alocação: 10 s do motor do N700 (4 unidades, 4 bancos cada)', '≤ 6 coletas jovens (a Cena aceita 14)', `${nm} coletas`, nm <= 6);
  }
}

// =============================================================================================== 2. eixo, torque, carga
function zeroA(id: string, vAlvo: number, durMax: number) {
  const p = portador(id);
  p.comandar({ pedal: 1, ignicao: true, velocidadeFixa: null });
  let t = -1;
  renderPortador(p, durMax, [], (tt) => { if (t < 0 && p.cinematica.v * 3.6 >= vAlvo) t = tt; });
  return t;
}
function gMaquina() {
  const t3 = zeroA('model3', 100, 8);
  caso('Model 3 LR AWD: 0–100 km/h (plano, aderência 0,75 g)', '4,7 ± 0,5 s', `${f1(t3, 2)} s`, perto(t3, 4.7, 0.5));
  const tl = zeroA('leaf', 100, 14);
  caso('Leaf: 0–100 km/h', '8,0 ± 0,8 s', `${f1(tl, 2)} s`, perto(tl, 8, 0.8));
  const tm = zeroA('metropolis', 80, 60);
  caso('metrô de 6 carros (Metropolis, 240 t): 0–80 km/h', '36 ± 4 s', `${f1(tm, 1)} s`, perto(tm, 36, 4));
  {
    const p = portador('model3');
    p.comandar({ pedal: 0, ignicao: true, velocidadeFixa: 100 / 3.6 }); renderPortador(p, 0.2);
    p.comandar({ velocidadeFixa: null, freio: 1, pedal: 0 });
    let t = -1; renderPortador(p, 20, [], (tt) => { if (t < 0 && p.cinematica.v * 3.6 <= 20) t = tt; });
    caso('regeneração 100 → 20 km/h a 0,3·T_n (Model 3)', '9 ± 1 s', `${f1(t, 2)} s`, perto(t, 9, 1));
  }
  {
    const p = preset('taurus'), m = motor('taurus');
    m.comandar({ acelerador: 1, ignicao: true, partida: false, omegaImposta: wDe(p.rpmBase), torqueFixo: p.Tn } as never);
    renderMotor(m, 0.1);
    const t: any = m.telemetria(), esp = (p.escorregamentoNominal ?? 0.02) * (p.p * p.rpmBase) / 60;
    const s = t.fE - p.p * t.fRot;
    caso('indução: f_e = p·f_rot + s·f_e (Taurus em T_n)', 's_n·f_e,n ±5%', `${f1(s, 3)} Hz (esperado ${f1(esp, 3)})`, rel(s, esp) <= 0.05);
  }
}

// =============================================================================================== 3. forças magnéticas
function gMagneticas() {
  const fc = F_CARC.carro;
  const leaf = preset('leaf');
  const m = motor('leaf', { jitter: 0 });
  const T = 0.6 * leaf.Tn;
  m.comandar({ acelerador: 1, ignicao: true, partida: false, omegaImposta: wDe(5000), torqueFixo: T } as never);
  const r = renderMotor(m, 1.6), x = canal(r, 'motor');
  const fr = 5000 / 60, fe = 4 * fr;
  const L = (f: number) => nivelEm(x, 0.5, 1.6, f, 0.003);
  const alvos: [string, number][] = [['2f_e', 2 * fe], ['6f_e', 6 * fe], ['48·f_rot', 48 * fr], ['48·f_rot + 2f_e', 48 * fr + 2 * fe], ['48·f_rot − 2f_e', 48 * fr - 2 * fe]];
  let eF = 0;
  for (const [, f] of alvos) eF = Math.max(eF, rel(L(f).f, f));
  caso('Leaf a 5000 rpm: 666,7, 2000, 4000, 4000 ± 666,7 Hz', '±0,5%', `máx ${f1(eF * 100, 3)}%`, eF <= 0.005);
  {
    // as leis do grupo de ranhuras num Leaf com Z_s = 46: com Z_s/p inteiro (48/4) a linha m = 1, k = 0 cai em 12·f_e e
    // soma em potência com a ondulação de torque (linhas.ts funde as frequências iguais), o que mascara a lei
    const mv = motor('leaf', { jitter: 0, Zs: 46 });
    mv.comandar({ acelerador: 1, ignicao: true, partida: false, omegaImposta: wDe(5000), torqueFixo: T } as never);
    const xv = canal(renderMotor(mv, 1.6), 'motor'), Lv = (f: number) => nivelEm(xv, 0.5, 1.6, f, 0.003);
    const c0 = semH(Lv(46 * fr).dB, 46 * fr, fc);
    const k1 = semH(Lv(46 * fr + 2 * fe).dB, 46 * fr + 2 * fe, fc) - c0, k1m = semH(Lv(46 * fr - 2 * fe).dB, 46 * fr - 2 * fe, fc) - c0;
    const k2 = semH(Lv(46 * fr + 4 * fe).dB, 46 * fr + 4 * fe, fc) - c0;
    const m2 = semH(Lv(92 * fr).dB, 92 * fr, fc) - c0;
    caso('ranhuras k = ±1 contra k = 0 (Z_s 46, curva da carcaça descontada)', '−6 ± 1 dB', `${sg(k1)} / ${sg(k1m)} dB`, perto(k1, -6, 1) && perto(k1m, -6, 1));
    caso('ranhuras k = ±2 contra k = 0', '−14 ± 1 dB', `${sg(k2)} dB`, perto(k2, -14, 1));
    caso('ranhuras m = 2 contra m = 1', '−10 ± 1 dB', `${sg(m2)} dB`, perto(m2, -10, 1));
  }
  const t: any = m.telemetria(), I = t.corrente;
  const a6 = semH(L(6 * fe).dB, 6 * fe, fc) - semH(L(2 * fe).dB, 2 * fe, fc), esp6 = Math.min(0, -20 + 20 * Math.log10(Math.max(I, 0.1) / 0.1));
  caso('6f_e contra 2f_e: −20 dB em vazio + 20·log(I/I_vazio)', `${sg(esp6)} ± 1 dB (I/I_n ${f1(I, 2)})`, `${sg(a6)} dB`, perto(a6, esp6, 1));
  // indução com escorregamento: barras em (1 − s)·Z_r·f_e/p
  {
    const pd = (PRESETS_ELETRICO[0].segundo)!;
    const mi = motor(pd, { jitter: 0 });
    mi.comandar({ acelerador: 1, ignicao: true, partida: false, omegaImposta: wDe(3000), torqueFixo: pd.Tn } as never);
    const ri = renderMotor(mi, 1.4), xi = canal(ri, 'motor'), ti: any = mi.telemetria();
    const s = (ti.fE - pd.p * ti.fRot) / ti.fE, esp = ((1 - s) * pd.Zr! * ti.fE) / pd.p;
    const med = nivelEm(xi, 0.4, 1.4, esp, 0.004).f;
    caso('indução: barras em (1 − s)·Z_r·f_e/p', `±0,5% (s ${f1(s * 100, 2)}%)`, `${f1(med, 1)} Hz (esperado ${f1(esp, 1)})`, rel(med, esp) <= 0.005);
  }
  // fluxo: 2f_e cai 6 dB/oitava acima da base
  {
    const lv = (rpm: number) => {
      const mm = motor('leaf', { jitter: 0 });
      mm.comandar({ acelerador: 1, ignicao: true, partida: false, omegaImposta: wDe(rpm), torqueFixo: 0.2 * leaf.Tn } as never);
      const rr = renderMotor(mm, 1.2), f = (2 * 4 * rpm) / 60;
      return semH(nivelEm(canal(rr, 'motor'), 0.4, 1.2, f, 0.003).dB, f, fc);
    };
    const d = lv(2 * leaf.rpmBase) - lv(leaf.rpmBase);
    caso('Φ: 2f_e entre 1× e 2× a rotação de base', '−6 ± 0,5 dB', `${sg(d)} dB`, perto(d, -6, 0.5));
  }
}

// =============================================================================================== 4. inversor
function gInversor() {
  const p = { ...preset('leaf'), inversor: { tipo: 'igbt', fc: 3000, modo: 'assincrona' } } as PresetEletrico;
  const medir = (M: number) => {
    const inv = new Inversor(p, SR, 3), e = new EstadoMaquina(), b = new BancoDeLinhas(SR, 64, 5), L = new ListaLinhas(128);
    e.M = M; e.fe = 60; e.I = 1;
    const N = SR, x = new Float32Array(N);
    for (let k = 0; k < N; k += 64) { inv.atualizar(e, true); L.limpar(); inv.linhas(e, L, 1, true); b.atualizar(L); b.processar(x, k, 64); }
    const lv = (f: number) => nivelEm(x, 0.2, 1, f, 0.002).amp;
    return { s2: dB(lv(3000 + 120)), s2m: dB(lv(3000 - 120)), g2: dB(lv(6000 + 60)), g2m: dB(lv(6000 - 60)) };
  };
  const ref = { 0.2: [-38.0, -16.3], 0.6: [-19.4, -10.5], 1.0: [-11.8, -16.7] } as Record<number, [number, number]>;
  for (const M of [0.2, 0.6, 1.0]) {
    const r = medir(M), [a, b] = ref[M];
    const ta = dbTensao(1, 2, M), tb = dbTensao(2, 1, M);
    caso(`Bessel, M = ${M}: f_c ± 2f_e`, `${f1(a)} ± 1 dB (fórmula ${f1(ta)})`, `${f1(r.s2)} / ${f1(r.s2m)} dB`, perto(r.s2, a, 1) && perto(r.s2m, a, 1));
    caso(`Bessel, M = ${M}: 2f_c ± f_e`, `${f1(b)} ± 1 dB (fórmula ${f1(tb)})`, `${f1(r.g2)} / ${f1(r.g2m)} dB`, perto(r.g2, b, 1) && perto(r.g2m, b, 1));
  }
  // f_e → 0: as laterais colapsam em f_c, 2f_c, 3f_c sem salto de potência
  {
    const inv = new Inversor(p, SR, 4), e = new EstadoMaquina(), L = new ListaLinhas(128);
    e.M = 0.6; e.I = 1;
    const grupoPot = () => { const s = [0, 0, 0]; for (let i = 0; i < L.n; i++) { const f = L.f[i], g = Math.round(f / 3000); if (g >= 1 && g <= 3) s[g - 1] += L.a[i] * L.a[i]; } return s; };
    let salto = 0, ant: number[] | null = null, ini: number[] | null = null, fim: number[] = [];
    for (let fe = 4; fe >= 0; fe -= 0.01) {
      e.fe = fe; inv.atualizar(e, true); L.limpar(); inv.linhas(e, L, 1, true);
      const s = grupoPot();
      if (ant) for (let g = 0; g < 3; g++) salto = Math.max(salto, Math.abs(10 * Math.log10(s[g] / ant[g])));
      if (!ini) ini = s;
      ant = s; fim = s;
    }
    let tot = 0; for (let g = 0; g < 3; g++) tot = Math.max(tot, Math.abs(10 * Math.log10(fim[g] / ini![g])));
    caso('f_e → 0: f_c, 2f_c, 3f_c sem salto de nível', '≤ 0,5 dB', `passo máx ${f1(salto, 3)} dB; 4 Hz → 0: ${f1(tot, 3)} dB`, salto <= 0.5 && tot <= 0.5);
  }
}

// =============================================================================================== 5. modos
/** do-re-mi: Taurus rebocando 400 t com a aceleração dada; devolve os patamares do canal do inversor (unidade 0) */
function doremi(acel: number, dur = 14) {
  const t = portador('taurus') as Trem, tr = t.tracao!;
  const F = 1.06 * tr.massa * acel + tr.davis.A;
  const ped = Math.min(1, (F * tr.rw) / (tr.i * tr.eta * tr.nMot) / tr.motor.p.Tn);
  const iInv = tr.motor.canais.findIndex((c) => c.base === 'inversor' && c.u === 0);
  const N = Math.round(dur * SR), B = 128, S = t.fontes().map(() => new Float32Array(B)), inv = new Float32Array(N);
  t.comandar({ pedal: 0, ignicao: true, velocidadeFixa: 0 });
  for (let k = 0; k < SR / 2; k += B) t.processar(S, B, 1 / SR);
  t.comandar({ pedal: ped, velocidadeFixa: null });
  const tele: { t: number; fc: number; modo: string; nota: number }[] = [];
  for (let k = 0; k < N; k += B) {
    t.processar(S, B, 1 / SR);
    inv.set(tr.canais[iInv].subarray(0, B), k);
    const tl: any = t.telemetria(); tele.push({ t: k / SR, fc: tl.fC, modo: tl.modo, nota: tl.nota });
  }
  return { pt: patamares(rastrear(inv, 0, dur, 150, 800)), tele, inv, v: t.cinematica.v, ped };
}
function gModos() {
  for (const [acel, alvo, tol] of [[0.35, 6.2, 1], [0.6, 3.6, 0.7]] as const) {
    const r = doremi(acel);
    // os 12 patamares das notas, na ordem, e o patamar final
    const achados: { f: number; t: number; dur: number }[] = [];
    let j = 0;
    for (const p of r.pt) { if (j < 12 && rel(p.f, NOTAS_TAURUS[j]) <= 0.01) { achados.push(p); j++; } }
    const fin = r.pt.filter((p) => rel(p.f, 598) <= 0.02 && (achados.length ? p.t > achados[achados.length - 1].t : true));
    const durs = achados.map((p) => p.dur);
    const escala = achados.length === 12 ? achados[11].t - achados[0].t + 0 : NaN;
    // a escala: do começo do G3 ao começo do D5
    caso(`do-re-mi a ${acel} m/s²: 12 patamares nas notas, em ordem`, '12 de 12, ±1%', `${achados.length} (${achados.map((p) => f1(p.f, 0)).join(' ')})`, achados.length === 12);
    caso(`do-re-mi a ${acel} m/s²: duração de cada degrau`, acel === 0.35 ? '0,3–1,2 s' : '0,2–1,2 s', `${f1(Math.min(...durs), 2)}–${f1(Math.max(...durs), 2)} s`, durs.length === 12 && Math.min(...durs) >= (acel === 0.35 ? 0.3 : 0.2) - 0.051 && Math.max(...durs) <= 1.2);
    caso(`do-re-mi a ${acel} m/s²: escala inteira (G3 → D5)`, `${f1(alvo)} ± ${f1(tol)} s`, `${f1(escala, 2)} s`, perto(escala, alvo, tol));
    caso(`do-re-mi a ${acel} m/s²: patamar final mantido`, '598 ± 12 Hz até a troca', fin.length ? `${f1(fin[0].f)} Hz por ${f1(fin.reduce((a, p) => a + p.dur, 0), 1)} s` : 'não achado', fin.length > 0 && perto(fin[0].f, 598, 12));
    if (acel === 0.35) {
      // harmônicos no patamar (3.1, D 21–26 s): 2f_c −4..−9, 3f_c −5..−15, 4f_c −3..−10
      const t0 = fin.length ? fin[0].t + 0.2 : 9;
      const l1 = nivelEm(r.inv, t0, t0 + 1.5, 598, 0.01).dB;
      const h = [2, 3, 4].map((m) => nivelEm(r.inv, t0, t0 + 1.5, 598 * m, 0.01).dB - l1);
      caso('Taurus, patamar: 2f_c / 3f_c / 4f_c contra f_c', '−4..−9 / −5..−15 / −3..−10 dB', h.map((x) => sg(x)).join(' / '), dentro(h[0], -9, -4) && dentro(h[1], -15, -5) && dentro(h[2], -10, -3));
    }
  }
  // síncrona: f_c = N·f_e e trocas sem estalo (Metropolis acelerando no auto)
  {
    const p = portador('metropolis') as Trem, tr = p.tracao!;
    const iInv = tr.motor.canais.findIndex((c) => c.base === 'inversor' && c.u === 0);
    p.comandar({ pedal: 1, ignicao: true, velocidadeFixa: null });
    const dur = 40, N = dur * SR, B = 128, S = p.fontes().map(() => new Float32Array(B)), x = new Float32Array(N);
    let eN = 0, trocas: number[] = [], Nant = -1;
    for (let k = 0; k < N; k += B) {
      p.processar(S, B, 1 / SR); x.set(tr.canais[iInv].subarray(0, B), k);
      const t: any = p.telemetria();
      if (t.modo === 'sincrona') eN = Math.max(eN, Math.abs(t.fC - t.N * t.fE) / t.fC);
      if (t.N !== Nant) { if (Nant >= 0) trocas.push(k); Nant = t.N; }
    }
    let pkx = 0; for (let i = 0; i < N; i++) pkx = Math.max(pkx, Math.abs(x[i]));
    const h1 = new Bq().hp(SR, 16000, 0.54), h2 = new Bq().hp(SR, 16000, 1.31), y = new Float32Array(N);
    for (let i = 0; i < N; i++) y[i] = h2.run(h1.run(x[i]));
    let est = 0; for (const k of trocas) for (let i = Math.max(0, k - 2000); i < Math.min(N, k + 3000); i++) est = Math.max(est, Math.abs(y[i]));
    caso('síncrona: f_c = N·f_e', '±0,1%', `${f1(eN * 100, 4)}% (${trocas.length} trocas de modo/N)`, eN <= 1e-3);
    caso('síncrona: trocas de N sem estalo (acima de 16 kHz)', '< 0,1 FS', `${f1(est / pkx, 4)} FS`, est / pkx < 0.1);
  }
  // aleatória δ 0,15 contra a fixa, mesma energia
  {
    const base = preset('model3');
    const roda = (modo: string) => {
      const m = motor(base, { inversor: { tipo: 'sic', fc: 6000, modo: modo as never, delta: 0.15 }, jitter: 0 });
      m.comandar({ acelerador: 1, ignicao: true, partida: false, omegaImposta: wDe(3000), torqueFixo: base.Tn } as never);
      return canal(renderMotor(m, 2.2), 'inversor');
    };
    const xa = roda('assincrona'), xr = roda('aleatoria');
    const [fA, PA] = welch(xa, SR / 2, 2.2 * SR, 8192), [, PR] = welch(xr, SR / 2, 2.2 * SR, 8192);
    const eFix = potFaixa(fA, PA, 3600, 8400), eAle = potFaixa(fA, PR, 3600, 8400);
    let pf = 0, pr = 0; for (let i = 0; i < fA.length; i++) if (fA[i] > 5500 && fA[i] < 6500) { pf = Math.max(pf, PA[i]); pr = Math.max(pr, PR[i]); }
    caso('aleatória δ 0,15: energia do grupo f_c igual à da fixa', '±1 dB', `${sg(10 * Math.log10(eAle / eFix))} dB`, Math.abs(10 * Math.log10(eAle / eFix)) <= 1);
    caso('aleatória δ 0,15: pico em f_c abaixo do da fixa', '≥ 12 dB', `${f1(10 * Math.log10(pf / pr))} dB`, 10 * Math.log10(pf / pr) >= 12);
  }
  // chopper: ∝ D(1 − D), máximo em 0,5, some em D = 1
  {
    const p = preset('frotaa');
    const lv = (D: number) => {
      const m = motor('frotaa', { jitter: 0 });
      m.comandar({ acelerador: 1, ignicao: true, partida: false, omegaImposta: D * wDe(p.rpmBase), torqueFixo: p.Tn } as never);
      return nivelEm(canal(renderMotor(m, 1.2), 'inversor'), 0.4, 1.2, 350, 0.005).dB;
    };
    const a25 = lv(0.25), a50 = lv(0.5), a75 = lv(0.75), a100 = lv(1.0);
    caso('chopper: D 0,25 e 0,75 iguais', '±0,5 dB', `${sg(a25 - a75, 2)} dB`, Math.abs(a25 - a75) <= 0.5);
    caso('chopper: máximo em D = 0,5', 'acima de 0,25 e 0,75', `${sg(a50 - a25)} dB`, a50 > a25 && a50 > a75);
    caso('chopper: some em D = 1', '< −60 dB de D = 0,5', `${sg(a100 - a50)} dB`, a100 - a50 < -60);
  }
}

// =============================================================================================== 6. mecânica
function gMecanica() {
  const p = preset('model3');
  const roda = (T: number, rpm = 7700, dur = 1.4) => {
    const m = motor('model3', { jitter: 0 });
    m.comandar({ acelerador: 1, ignicao: true, partida: false, omegaImposta: wDe(rpm), torqueFixo: T } as never);
    return canal(renderMotor(m, dur), 'reducao');
  };
  const fr = 7700 / 60, x = roda(0.5 * p.Tn);
  const f1e = nivelEm(x, 0.4, 1.4, 27 * fr, 0.006), f2e = nivelEm(x, 0.4, 1.4, (23 * fr * 27) / 75, 0.006);
  caso('Tesla a 7700 rpm: engrenamento 27·f_rot e 23·f_rot/2,78', '3465 e 1062 Hz ±0,5%', `${f1(f1e.f)} e ${f1(f2e.f)} Hz`, rel(f1e.f, 3465) <= 0.005 && rel(f2e.f, 1062) <= 0.005);
  const lb = nivelEm(x, 0.4, 1.4, 27 * fr + fr, 0.004).dB - f1e.dB, lbm = nivelEm(x, 0.4, 1.4, 27 * fr - fr, 0.004).dB - f1e.dB;
  caso('bandas laterais ±f_rot do engrenamento', '−10 ± 2 dB', `${sg(lb)} / ${sg(lbm)} dB`, perto(lb, -10, 2) && perto(lbm, -10, 2));
  const x2 = roda(p.Tn), d = nivelEm(x2, 0.4, 1.4, 27 * fr, 0.006).dB - f1e.dB;
  caso('engrenamento ao dobrar o torque', '+6 ± 0,5 dB', `${sg(d, 2)} dB`, perto(d, 6, 0.5));
  // torque ≈ 0: some o engrenamento, entra o chocalho (impulsivo)
  {
    const x0 = roda(0.01 * p.Tn, 7700, 2.4), l0 = nivelEm(x0, 0.6, 2.4, 27 * fr, 0.006).dB - f1e.dB;
    caso('|T| < 3% de T_n: engrenamento', '< −40 dB do de carga', `${sg(l0)} dB`, l0 < -40);
    const b1 = new Bq().bp(SR, 2000, 0.7);
    const y: number[] = []; for (let i = Math.round(0.6 * SR); i < 2.4 * SR; i++) y.push(b1.run(x0[i]));
    const mu = y.reduce((a, b) => a + b, 0) / y.length, m2 = y.reduce((a, b) => a + (b - mu) ** 2, 0) / y.length, m4 = y.reduce((a, b) => a + (b - mu) ** 4, 0) / y.length;
    caso('|T| < 3%: chocalho no bp de 1–4 kHz (curtose)', '> 4', f1(m4 / (m2 * m2), 2), m4 / (m2 * m2) > 4);
  }
  // furadeira: comutador em 12 e 24·f_rot, e o faiscamento modulado em Z_c·f_rot
  {
    const m = motor('furadeira', { jitter: 0 });
    m.comandar({ acelerador: 1, ignicao: true, partida: false, omegaImposta: null } as never);
    const r = renderMotor(m, 2.5), xe = canal(r, 'escovas'), t: any = m.telemetria();
    const l12 = nivelEm(xe, 1, 2.5, 12 * t.fRot, 0.004).f, l24 = nivelEm(xe, 1, 2.5, 24 * t.fRot, 0.004).f;
    caso('furadeira: 247,5 × 12 e × 24', '2970 e 5940 Hz ±1%', `${f1(l12)} e ${f1(l24)} Hz (f_rot ${f1(t.fRot, 1)})`, rel(l12, 2970) <= 0.01 && rel(l24, 5940) <= 0.01);
    // faiscamento sozinho (sem os tons): envoltória de 2–10 kHz
    const m2 = motor('furadeira', { jitter: 0 });
    const U = m2.uni[0], orig = U.esc!.linhas.bind(U.esc!);
    U.esc!.linhas = (e, L, det) => orig(e, L, det, true);
    m2.comandar({ acelerador: 1, ignicao: true, partida: false, omegaImposta: null } as never);
    const xf = canal(renderMotor(m2, 2.5), 'escovas'), env = new Float32Array(xf.length);
    for (let i = 0; i < xf.length; i++) env[i] = xf[i] * xf[i];
    const pk = linha(env, 1, 2.5, 1500, 8000), fm = 12 * (m2.telemetria() as any).fRot;
    caso('faiscamento: pico da envoltória (2–10 kHz) em Z_c·f_rot', `${f1(fm, 0)} Hz ±1%`, `${f1(pk.f)} Hz`, rel(pk.f, fm) <= 0.01);
  }
}

// =============================================================================================== 7. AVAS
function gAvas() {
  const nivel = (kmh: number, re = false) => {
    const c = new CarroEletrico(SR, { ...(preset('model3').portador as any), pneusAero: false });
    const m = motor('model3'); c.acoplar(m);
    c.comandar({ pedal: 0, ignicao: true, velocidadeFixa: kmh / 3.6, marcha: re ? -1 : 1 });
    // o ouvinte a 2 m da lateral, à altura do para-choque dianteiro, o carro parado ali (ou passando a v)
    // campo livre: no asfalto a 2 m a reflexão no chão cancela parte do tom de 250 Hz (Δ ≈ 0,56 m) e não o ruído de 1 kHz,
    // e o nível passaria a depender da mistura tom/ruído, que muda com a velocidade
    const { L, R } = renderCena(c, { amb: { ...ambientePassagem('ceu'), solo: { tipo: 'nenhum' } }, traj: { lateral: 2 - 0.925, comprimento: 4000 }, ouv: { pos: [0, 0, 1.2] }, dur: 3, s0: -2.2 + (kmh > 0 ? -kmh / 3.6 * 1.5 : 0) });
    // o mesmo ponto de medida nos três casos: 125 ms com o alto-falante no través (parado: 2 s)
    return { la: kmh > 0 ? dBA(mono(L, R), 1.5 - 0.0625 - 0.05, 1.5 + 0.0625) : dBA(mono(L, R), 1, 3), c, m };
  };
  const alvo: [number, number][] = [[0, 55], [10, 61], [20, 67]];
  for (const [v, a] of alvo) { const n = nivel(v).la; caso(`AVAS a 2 m, ${v} km/h`, `${a} ± 1,5 dB(A)`, `${f1(n)} dB(A)`, perto(n, a, 1.5)); }
  // deslocamento de frequência
  {
    const f = (kmh: number) => { const m = motor('model3'); m.comandar({ acelerador: 0, ignicao: true, partida: false, v: kmh / 3.6 } as never); let s = 0, n = 0; renderMotor(m, 6.7, [], () => { s += m.avas!.f1; n++; }); return s / n; };
    const d = (f(20) / f(0) - 1) / 20 * 100;
    caso('AVAS: f₁ sobe com a velocidade', '1,2 ± 0,1 %/km/h', `${f1(d, 3)} %/km/h`, perto(d, 1.2, 0.1));
  }
  {
    const m = motor('model3');
    m.comandar({ acelerador: 0, ignicao: true, partida: false, v: 19 / 3.6 } as never);
    const r = renderMotor(m, 5, [[1, () => m.comandar({ acelerador: 0, ignicao: true, partida: false, v: 25 / 3.6 } as never)]]);
    const x = canal(r, 'avas'), rms = (a: number, b: number) => { let s = 0; for (let i = Math.round(a * SR); i < b * SR; i++) s += x[i] * x[i]; return Math.sqrt(s / ((b - a) * SR)); };
    const d = dB(rms(3.2, 5) / rms(0.4, 1));
    caso('AVAS a 25 km/h (UE), 2 s depois', '< −40 dB', `${f1(d)} dB`, d < -40);
  }
  {
    const m = motor('model3');
    m.comandar({ acelerador: 0, ignicao: true, partida: false, v: 1, re: true } as never);
    const r = renderMotor(m, 6.5), x = canal(r, 'avas.re');
    const env = new Float32Array(x.length); for (let i = 0; i < x.length; i++) env[i] = x[i] * x[i];
    const k = 480, dec = new Float32Array(Math.floor(env.length / k)); for (let i = 0; i < dec.length; i++) { let s = 0; for (let j = 0; j < k; j++) s += env[i * k + j]; dec[i] = s; }
    // espectro da envoltória (100 Hz de amostragem)
    let best = 0, bf = 0; const n = dec.length, mu = dec.reduce((a, b) => a + b, 0) / n;
    for (let f = 0.5; f <= 5; f += 0.01) { let re = 0, im = 0; for (let i = 50; i < n; i++) { re += (dec[i] - mu) * Math.cos((TAU * f * i) / 100); im += (dec[i] - mu) * Math.sin((TAU * f * i) / 100); } const p = re * re + im * im; if (p > best) { best = p; bf = f; } }
    caso('AVAS em ré: pulso', '1,5 Hz', `${f1(bf, 2)} Hz`, perto(bf, 1.5, 0.05));
  }
}

// =============================================================================================== 8. níveis e todos os presets
function gNiveis() {
  let pior = 0, quem = '';
  const nanOuAlto: string[] = [];
  for (const p0 of PRESETS_ELETRICO) {
    const c = cfg(p0.id);
    const ps = [c, ...(c.segundo ? [c.segundo] : [])];
    for (const p of ps) {
      // sonda de novo, com o kAbs: cada canal no L_W
      const chopper = p.inversor?.tipo === 'chopper';
      for (const frac of chopper ? [1, 0.5] : [1]) {
        const m = motor(p);
        m.comandar({ acelerador: 1, ignicao: true, partida: false, omegaImposta: wDe(p.rpmBase) * frac, torqueFixo: p.Tn, v: 20 } as never);
        for (const U of m.uni) if (U.ven && p.ventilacao?.forcada) U.ven.wv = U.ven.fRef();
        let uRef = 0; m.uni.forEach((U, i) => { if (Math.abs(U.det - 1) < Math.abs(m.uni[uRef].det - 1)) uRef = i; });
        const r = renderMotor(m, 0.5);
        m.canais.forEach((ch, i) => {
          if ((ch.u !== uRef && ch.u !== -1) || ch.base === 'avas') return;
          if (chopper && ((frac === 1) === (ch.base === 'inversor'))) return;
          const lw = (p.niveis as Record<string, number>)[ch.base];
          if (!lw) return;
          const a = new Acumulador(SR), x = r.canais[i];
          for (let j = Math.round(0.25 * SR); j < x.length; j++) a.somar(x[j]);
          const d = dB(a.rmsA() / paDeLw(lw, REF_DIST_ELETRICO));
          if (Math.abs(d) > Math.abs(pior)) { pior = d; quem = `${p.id}/${ch.id}`; }
        });
      }
    }
    // 2 s em cada estado (parado ligado, arrancada, cruzeiro, regeneração): sem NaN e abaixo de −1 dBFS a 7,5 m
    const est = [
      { acelerador: 0, freio: 0 }, { acelerador: 1, freio: 0, omegaImposta: 0.3 * wDe(p0.rpmBase) },
      { acelerador: 0.4, freio: 0, omegaImposta: 1.5 * wDe(p0.rpmBase) }, { acelerador: 0, freio: 1, omegaImposta: 0.8 * wDe(p0.rpmBase), v: 20 },
    ];
    for (const e of est) {
      const m = motor(p0.id);
      m.comandar({ ignicao: true, partida: false, v: 10, ...e } as never);
      const r = renderMotor(m, 2);
      let pk = 0, nan = false;
      for (let j = 0; j < r.soma.length; j++) { const v = r.soma[j]; if (!Number.isFinite(v)) nan = true; else pk = Math.max(pk, Math.abs(v)); }
      if (nan || pk > PA_FS * Math.pow(10, -1 / 20)) nanOuAlto.push(`${p0.id} ${JSON.stringify(e)}: ${nan ? 'NaN' : f1(dB(pk / PA_FS)) + ' dBFS'}`);
    }
  }
  caso('sonda: cada fonte no L_W do preset (todos os presets)', '±1 dB', `pior ${sg(pior, 2)} dB (${quem})`, Math.abs(pior) <= 1);
  caso('todos os presets, 4 estados × 2 s: sem NaN, abaixo de −1 dBFS a 7,5 m', 'nenhum', nanOuAlto.length ? nanOuAlto.join('; ') : 'nenhum', nanOuAlto.length === 0);
}

// =============================================================================================== 9. portadores
function gPortadores() {
  {
    const t = portador('cptm9500', {}, { faces: 'duas' }) as Trem;
    caso('metrô de 8 carros com 4 carros motores (CPTM 9500, duas faces): fontes', `≤ ${MAX_FONTES}`, `${t.fontes().length} (${t.tracao!.grupo})`, t.fontes().length <= MAX_FONTES);
    const n = portador('n700', {}, { N: 10, faces: 'duas' }) as Trem;
    caso('N700 no trem-bala da Passagem (10 carros, 8 motores, duas faces): fontes', `≤ ${MAX_FONTES}`, `${n.fontes().length} (${n.tracao!.grupo})`, n.fontes().length <= MAX_FONTES);
    let erro = '';
    try { portador('n700', {}, { N: 16, faces: 'uma' }); } catch (e) { erro = String((e as Error).message).slice(0, 60); }
    caso('N700 de 16 carros (14 motores)', `≤ ${MAX_FONTES} fontes`, erro ? `o trem sem motor já não cabe: ${erro}…` : 'cabe', !erro);
  }
  {
    const d = portador('mavic') as Multirrotor;
    d.comandar({ pedal: 0.5, ignicao: true });
    const N = 11 * SR, B = 128, S = d.fontes().map(() => new Float32Array(B)), H = d.fontes().map(() => new Float32Array(N));
    for (let k = 0; k < N; k += B) { d.processar(S, B, 1 / SR); S.forEach((s, i) => H[i].set(s.subarray(0, B), k)); }
    const det = preset('mavic').helice!.detune, frH = preset('mavic').rpmBase / 60;
    let pior = 0; const med: string[] = [];
    d.fontes().forEach((f, i) => {
      if (!f.id.startsWith('helice')) return;
      const k = Number(f.id.split('.')[1]), esp = 2 * frH * (1 + det[k]);
      const r = linha(H[i], 1, 11, esp * 0.97, esp * 1.03);
      pior = Math.max(pior, rel(r.f, esp)); med.push(f1(r.f, 1));
    });
    caso('drone: 4 BPF distintas pelos detune', '±0,5%', `${med.join(', ')} Hz (pior ${f1(pior * 100, 2)}%)`, pior <= 0.005);
  }
  {
    // pneus do carro a 80 km/h, só os pneus, a 7,5 m
    const c = portador('model3') as CarroEletrico;
    c.comandar({ pedal: 0, ignicao: false, velocidadeFixa: 80 / 3.6 });
    const prop = (c as any).proprias as { f: { id: string }; g: { gCal: number } }[];
    for (const p of prop) if (!p.f.id.startsWith('pneu')) p.g.gCal = 0;
    // campo livre (sem solo): o 73 dB(A) do CENA 4.1 é a conversão de 4 × 95 dB(A) de L_W a 7,5 m; com o asfalto a imagem
    // da fonte (no chão, z 0,02) soma +3 dB
    const { L, R } = renderCena(c, { amb: { ...ambientePassagem('ceu'), solo: { tipo: 'nenhum' } }, traj: { lateral: 7.5 - 0.925 }, ouv: { pos: [0, 0, 1.2] }, dur: 8, s0: -80 / 3.6 * 4 });
    const n = lafMax(mono(L, R));
    caso('pneus do carro a 80 km/h, a 7,5 m (só pneus, campo livre, CENA 4.1)', '73 ± 2 dB(A)', `${f1(n)} dB(A)`, perto(n, 73, 2));
  }
}

// =============================================================================================== 10. gravações (3.7)
function gGravacoes() {
  // Taurus parado: linhas fixas a −8..−12 dB do tom do inversor em escada
  {
    const t = portador('taurus') as Trem, tr = t.tracao!;
    const B = 128, S = t.fontes().map(() => new Float32Array(B)), N = 4 * SR;
    const iAux = tr.motor.canais.findIndex((c) => c.base === 'aux'), iInv = tr.motor.canais.findIndex((c) => c.base === 'inversor' && c.u === 0);
    const aux = new Float32Array(N), inv = new Float32Array(N);
    t.comandar({ pedal: 0, ignicao: true, velocidadeFixa: 0 });
    for (let k = 0; k < N; k += B) { t.processar(S, B, 1 / SR); aux.set(tr.canais[iAux].subarray(0, B), k); }
    t.comandar({ pedal: 0.63, velocidadeFixa: null });
    for (let k = 0; k < N; k += B) { t.processar(S, B, 1 / SR); inv.set(tr.canais[iInv].subarray(0, B), k); }
    // o tom do inversor: o patamar mais longo da escada nos primeiros 4 s (pico do canal do inversor dentro dele)
    const pts = patamares(rastrear(inv, 0, 4, 150, 800)).filter((p) => NOTAS_TAURUS.some((n) => rel(p.f, n) <= 0.01)).sort((a, b) => b.dur - a.dur);
    const pt = pts[0] ?? { f: 262, t: 2, dur: 0.4 };
    const lt = linha(inv, pt.t, pt.t + pt.dur - 0.05, pt.f * 0.98, pt.f * 1.02).dB;
    const ls = [176, 527, 688].map((f) => nivelEm(aux, 1, 4, f, 0.01).dB - lt);
    caso('Taurus parado: 176, 527, 688 Hz contra o tom em escada', '−8..−12 dB', ls.map((x) => sg(x)).join(' / '), ls.every((x) => dentro(x, -12, -8)));
  }
  // CPTM 9500: razão das famílias e o SIV
  {
    const m = motor('cptm9500', { jitter: 0 }), p = preset('cptm9500');
    m.comandar({ acelerador: 0.6, ignicao: true, partida: false, omegaImposta: (60 / 3.6) * 6.3125 / 0.43 } as never);
    const r = renderMotor(m, 1.5), x = somaCanais(r, ['motor', 'reducao']);
    const fr = (m.telemetria() as any).fRot;
    const a = linha(x, 0.4, 1.5, 14 * fr, 18 * fr), b = linha(x, 0.4, 1.5, 33 * fr, 39 * fr);
    caso('CPTM 9500: razão entre as duas famílias', '2,24 ± 0,05', f1(b.f / a.f, 3), perto(b.f / a.f, 2.24, 0.05));
    const xa = canal(r, 'aux');
    const s1 = nivelEm(xa, 0.4, 1.5, 1333, 0.01).f, s2 = nivelEm(xa, 0.4, 1.5, 2666, 0.01).f, sb = nivelEm(xa, 0.4, 1.5, 1333 + 60, 0.01).f;
    caso('CPTM 9500: SIV', '1333 e 2666 Hz, laterais ±60 Hz', `${f1(s1)} / ${f1(s2)} Hz, lateral ${f1(sb - s1)} Hz`, rel(s1, 1333) <= 0.01 && rel(s2, 2666) <= 0.01 && perto(sb - s1, 60, 2));
    void p;
  }
  // CPTM 9000: 1 : 1,44 : 2,45
  {
    const m = motor('cptm9000', { jitter: 0 });
    m.comandar({ acelerador: 0.6, ignicao: true, partida: false, omegaImposta: (50 / 3.6) * 6.5 / 0.43 } as never);
    const r = renderMotor(m, 1.5), x = somaCanais(r, ['motor', 'reducao']), fr = (m.telemetria() as any).fRot;
    const a = linha(x, 0.4, 1.5, 16 * fr, 20 * fr).f, b = linha(x, 0.4, 1.5, 24 * fr, 28 * fr).f, c = linha(x, 0.4, 1.5, 42 * fr, 46 * fr).f;
    caso('CPTM 9000: razões das três ordens', '1 : 1,44 : 2,45 (±0,05)', `1 : ${f1(b / a, 3)} : ${f1(c / a, 3)}`, perto(b / a, 1.44, 0.05) && perto(c / a, 2.45, 0.05));
  }
  // Leaf: famílias agudas e a linha máxima a 85 km/h
  {
    // o motor e a redução sozinhos (a gravação é de dentro: os pneus chegam pela casca, sem o agudo)
    const m = motor('leaf');
    const pl = preset('leaf'), iL = pl.reducao.estagios.reduce((a, s) => (a * s.Zc) / s.Zp, 1), rwL = (pl.portador as { rw: number }).rw;
    m.comandar({ acelerador: 1, ignicao: true, partida: false, omegaImposta: ((85 / 3.6) * iL) / rwL } as never);
    const rr = renderMotor(m, 1.5), r = somaCanais(rr, ['motor', 'reducao', 'inversor']);
    const fr = (m.telemetria() as any).fRot;
    // a família que sobe, fora da portadora fixa (9,8–10,2 kHz, que a gravação também tem, fraca)
    const t1 = linha(r, 0.4, 1.5, 8000, 9800), t2 = linha(r, 0.4, 1.5, 10200, 11000), top = t1.dB >= t2.dB ? t1 : t2, seg = linha(r, 0.4, 1.5, 5500, 7500);
    caso('Leaf a 85 km/h: 96·f_rot', '9,5 kHz ±1%', `${f1(top.f, 0)} Hz (96·f_rot = ${f1(96 * fr, 0)})`, rel(top.f, 9500) <= 0.01 && rel(top.f, 96 * fr) <= 0.01);
    caso('Leaf: razão das duas famílias agudas', '1,46 ± 0,05', f1(top.f / seg.f, 3), perto(top.f / seg.f, 1.46, 0.05));
  }
  // Tesla: portadora ≈ 10 kHz, ≥ 40 dB abaixo do grave na cabine
  {
    const c = portador('model3') as CarroEletrico;
    c.comandar({ pedal: 0.15, ignicao: true, velocidadeFixa: 20 / 3.6 });
    const { L, R } = renderCena(c, { amb: { ...ambientePassagem('ceu'), solo: { tipo: 'asfalto' } }, traj: { lateral: 3, tipo: 'volta', comprimento: 20000, raioCurva: 3000 }, ouv: { modo: 'gimbal', gimbal: { az: 0, el: 0, r: 0.3, alvo: 'corpo' }, local: 'cabine' }, dur: 3, s0: 0 });
    const x = mono(L, R), [f, P] = welch(x, SR, 3 * SR, 8192);
    const grave = potFaixa(f, P, 20, 400);
    let pk = 0, fpk = 0; for (let i = 0; i < f.length; i++) if (f[i] > 9000 && f[i] < 11000 && P[i] > pk) { pk = P[i]; fpk = f[i]; }
    const df = f[1] - f[0], d = 10 * Math.log10((pk * df * 600) / grave);
    caso('Tesla: portadora na cabine', '≈ 10 kHz, ≥ 40 dB abaixo do grave', `${f1(fpk, 0)} Hz, ${f1(d)} dB`, perto(fpk, 10000, 300) && d <= -40);
  }
  // bonde IGBT: f_c fixa 2,0–2,5 kHz, 2f_c ≥ f_c
  {
    const m = motor('flexity', { jitter: 0 });
    m.comandar({ acelerador: 0.6, ignicao: true, partida: false, omegaImposta: (20 / 3.6) * 6 / 0.3 } as never);
    const x = canal(renderMotor(m, 1.5), 'inversor');
    const a = linha(x, 0.4, 1.5, 2000, 2500), b = nivelEm(x, 0.4, 1.5, 2 * a.f, 0.005);
    caso('bonde IGBT (Flexity): f_c fixa e 2f_c', '2,0–2,5 kHz, 2f_c ≥ f_c', `${f1(a.f, 0)} Hz, 2f_c ${sg(b.dB - a.dB)} dB`, dentro(a.f, 2000, 2500) && b.dB >= a.dB);
  }
  // furadeira sem fio
  {
    const m = motor('furadeira');
    m.comandar({ acelerador: 1, ignicao: true, partida: false } as never);
    const r = renderMotor(m, 3), x = r.soma, fr = (m.telemetria() as any).fRot;
    caso('furadeira sem fio: f_rot em vazio', '247,5 Hz ±1%', `${f1(fr, 1)} Hz`, rel(fr, 247.5) <= 0.01);
    const L = [1, 2, 3, 5, 6, 8, 12, 24].map((o) => nivelEm(x, 1, 3, o * fr, 0.005).dB), mx = Math.max(...L);
    const d8 = L[5] - mx, d12 = L[6] - mx, d24 = L[7] - L[6];
    caso('furadeira sem fio: ×8 e ×12 contra o máximo; ×24 contra ×12', '≥ −3 / ≥ −3 / −10 ± 4 dB', `${sg(d8)} / ${sg(d12)} / ${sg(d24)} dB`, d8 >= -3 && d12 >= -3 && perto(d24, -10, 4));
    const bd = bandas(x, 1, 3);
    const alvo = [-25.4, -23.5, 0, 4.9, 17.0, 16.7];
    const desv = [3, 4, 5].map((k) => bd.b[k] - alvo[k]);
    caso('furadeira sem fio: bandas 400–1k / 1–2,5k / 2,5–6k', '+4,9 / +17,0 / +16,7 ± 4 dB', bd.b.slice(3, 6).map((v) => sg(v)).join(' / '), desv.every((x) => Math.abs(x) <= 4));
  }
  // furadeira de rede (variante: universal, Z_c 10, 23 200 rpm)
  {
    const base = preset('furadeira');
    const rede = { ...base, id: 'furadeira-rede', Zc: 10, Zs: 10, rpmMax: 23500, rpmBase: 11750, Tn: 0.9, Pmax: 1100, escovas: { Zc: 10, desgaste: 0.8 }, linhasExtras: [[2, 0], [4, -2]] as [number, number][], faiscamento: 1.5, reducao: { estagios: [{ Zp: 9, Zc: 30 }, { Zp: 12, Zc: 27 }], eta: 0.9 } } as PresetEletrico;
    const m = motor(rede);
    m.comandar({ acelerador: 1, ignicao: true, partida: false } as never);
    const r = renderMotor(m, 3), x = r.soma, fr = (m.telemetria() as any).fRot;
    const a10 = nivelEm(x, 1, 3, 10 * fr, 0.005).f, a20 = nivelEm(x, 1, 3, 20 * fr, 0.005).f;
    caso('furadeira de rede: ×10 e ×20 de f_rot', '3870 e 7740 Hz ±1% (387 Hz)', `${f1(a10, 0)} e ${f1(a20, 0)} Hz (f_rot ${f1(fr, 1)})`, rel(a10, 3870) <= 0.01 && rel(a20, 7740) <= 0.01);
    const bd = bandas(x, 1, 3);
    caso('furadeira de rede: banda 2,5–6 kHz', '+22,7 ± 4 dB', sg(bd.b[5]), perto(bd.b[5], 22.7, 4));
  }
  // Mavic e drone 2
  {
    const d = portador('mavic') as Multirrotor;
    d.comandar({ pedal: 0.5, ignicao: true });
    const x = renderPortador(d, 4), fr = d.motor!.eixo.omega / TAU, fb = 2 * fr;
    const bpf = nivelEm(x, 1.5, 4, 209, 0.01);
    caso('Mavic pairado: BPF (a dos rotores de detune 0 e +1%)', '209 Hz ±1%', `${f1(bpf.f, 1)} Hz (os 4: ${[0, 1, 2, 3].map((k) => f1(2 * fr * (1 + preset('mavic').helice!.detune[k]), 0)).join(', ')})`, rel(bpf.f, 209) <= 0.01);
    // harmônicos do rotor de detune 0 (o 3º): medidos no canal dele
    const i3 = d.fontes().findIndex((f) => f.id === 'helice.2');
    const B = 128, S = d.fontes().map(() => new Float32Array(B)), N = 3 * SR, h = new Float32Array(N), mo = new Float32Array(N);
    const i3m = d.fontes().findIndex((f) => f.id === 'motor.2');
    for (let k = 0; k < N; k += B) { d.processar(S, B, 1 / SR); h.set(S[i3].subarray(0, B), k); mo.set(S[i3m].subarray(0, B), k); }
    // potência em ±1,5% de cada harmônico (o passeio da rotação do ESC espalha o k-ésimo harmônico k vezes mais)
    const [fw, Pw] = welch(h, Math.round(0.5 * SR), N, 16384), [, Pm] = welch(mo, Math.round(0.5 * SR), N, 16384);
    const pl = (P: Float64Array, f: number) => 10 * Math.log10(potFaixa(fw, P, f * 0.985, f * 1.015));
    const a = [1, 2, 3, 4, 5, 6, 7].map((k) => pl(Pw, k * fb)), d0 = a.map((v) => v - a[0]);
    const err = d0.map((v, k) => v - HARM_MAVIC[k]);
    caso('Mavic: harmônicos 1–7 da BPF', 'tabela 3.6 ±3 dB', d0.map((v) => sg(v, 0)).join(' '), err.every((e) => Math.abs(e) <= 3));
    const l63 = pl(Pm, 63 * fr) - a[0];
    caso('Mavic: motor em 63·f_rot = 9·f_e contra a BPF', '−13 ± 4 dB', sg(l63), perto(l63, -13, 4));
    const bd = bandas(x, 1.5, 4), alvo = [-28.7, -16.6, 0, 0.8, 0.7, -2.3];
    caso('Mavic pairado: bandas 400–1k / 1–2,5k / 2,5–6k', '+0,8 / +0,7 / −2,3 ± 4 dB', bd.b.slice(3, 6).map((v) => sg(v)).join(' / '), [3, 4, 5].every((k) => Math.abs(bd.b[k] - alvo[k]) <= 4));
    const dr2 = { ...preset('mavic'), id: 'drone2', rpmBase: 11460, rpmMax: 15000, Tn: 0.05, Pmax: 60, ordensEletricas: [[6, 0], [8, -3], [12, -14]] as [number, number][], helice: { ...preset('mavic').helice!, D: 0.13, harmonicos: [0, -12, -6, -11, -15, -16, -20, -24], largoDb: -6 } } as PresetEletrico;
    const d2 = new Multirrotor({ massa: 0.25, cQ: 0.012 }); d2.acoplar(motor(dr2)); d2.comandar({ pedal: 0.5, ignicao: true });
    const x2 = renderPortador(d2, 3), fr2 = d2.motor!.eixo.omega / TAU;
    const b2 = nivelEm(x2, 1, 3, 382, 0.01);
    // 6f_e: o centro de potência de 7,6–8,6 kHz (a linha, espalhada pelo passeio do ESC, e as laterais ±f_rot)
    const [f2, P2] = welch(x2, SR, 3 * SR, 16384);
    let sp = 0, sf = 0; for (let i = 0; i < f2.length; i++) if (f2[i] > 7600 && f2[i] < 8600) { sp += P2[i]; sf += P2[i] * f2[i]; }
    caso('drone 2: BPF e 6f_e', '382 Hz; 6f_e em 8,0–8,3 kHz', `${f1(b2.f, 1)} Hz; ${f1(sf / sp, 0)} Hz (42·f_rot ${f1(42 * fr2, 0)})`, rel(b2.f, 382) <= 0.01 && dentro(sf / sp, 8000, 8300));
  }
  // MP 73 (CC reostático): corcova 300 → 700 Hz com a velocidade, nenhuma linha fixa forte
  {
    const mp = { ...preset('frotaa'), id: 'mp73', inversor: null, escovas: { Zc: 139, desgaste: 0.1 }, niveis: { ...preset('frotaa').niveis, escovas: 80 } } as PresetEletrico;
    const centro = (frac: number) => {
      const m = motor(mp);
      m.comandar({ acelerador: 0.5, ignicao: true, partida: false, omegaImposta: frac * wDe(mp.rpmMax) } as never);
      const x = canal(renderMotor(m, 2), 'motor'), [f, P] = welch(x, SR / 2, 2 * SR, 8192);
      // centro da corcova: mediana da potência entre 150 e 2000 Hz
      let tot = 0; for (let i = 0; i < f.length; i++) if (f[i] > 150 && f[i] < 2000) tot += P[i];
      let s = 0; for (let i = 0; i < f.length; i++) { if (f[i] <= 150) continue; s += P[i]; if (s >= tot / 2) return f[i]; }
      return NaN;
    };
    const c0 = centro(0.05), c1 = centro(1);
    caso('MP 73 (CC reostático): centro da corcova com a velocidade', '≈ 300 → 700 Hz', `${f1(c0, 0)} → ${f1(c1, 0)} Hz`, dentro(c0, 230, 400) && dentro(c1, 550, 900));
  }
  // bandas de casos (±4 dB de 150 Hz a 6 kHz): Taurus no patamar (A) e CPTM 9500 parado, pela Cena
  {
    const t = portador('taurus', {}, { faces: 'uma', ladoOuvinte: -1 }) as Trem;
    t.comandar({ pedal: 0.63, ignicao: true, velocidadeFixa: 12 / 3.6 });
    const { L, R } = renderCena(t, { amb: ambientePassagem('estacao'), traj: { lateral: 4, comprimento: 4000 }, ouv: { pos: [0, 0, 1.6], binaural: false }, dur: 6, s0: -t.corpo.comprimento / 2 + 2 });
    const bd = bandas(mono(L, R), 2, 6), alvo = [NaN, -11.5, 0, 3.2, -2.0, -12.4];
    caso('Taurus no patamar (A, estação, 4 m): bandas 60–150 / 400–1k / 1–2,5k / 2,5–6k', '−11,5 / +3,2 / −2,0 / −12,4 ± 4 dB', [1, 3, 4, 5].map((k) => sg(bd.b[k])).join(' / '), [3, 4, 5].every((k) => Math.abs(bd.b[k] - alvo[k]) <= 4));
    caso('Taurus no patamar: centroide', '622 Hz ±25%', `${f1(bd.centroide, 0)} Hz`, rel(bd.centroide, 622) <= 0.25);
  }
  {
    const t = portador('cptm9500', {}, { faces: 'uma', ladoOuvinte: -1 }) as Trem;
    t.comandar({ pedal: 0, ignicao: true, velocidadeFixa: 0 });
    // de dentro do carro (as gravações da CPTM são de dentro)
    const { L, R } = renderCena(t, { amb: ambientePassagem('ceu'), traj: { lateral: 3, comprimento: 4000 }, ouv: { modo: 'gimbal', gimbal: { az: 0, el: 0, r: 0.5, alvo: 'corpo' }, local: 'cabine', binaural: false }, dur: 5, s0: 0 });
    const bd = bandas(mono(L, R), 2, 5), alvo = [NaN, -5.5, 0, 0.9, -4.3, -18.7];
    caso('CPTM 9500 parado (de dentro): bandas 400–1k / 1–2,5k / 2,5–6k', '+0,9 / −4,3 / −18,7 ± 4 dB', [3, 4, 5].map((k) => sg(bd.b[k])).join(' / '), [3, 4, 5].every((k) => Math.abs(bd.b[k] - alvo[k]) <= 4));
  }
}

// =============================================================================================== 11. Passagem e Cena
function gCena() {
  // Taurus a 7,5 m na estação: o tom do inversor acima do fundo do ambiente
  {
    const t = portador('taurus', {}, { faces: 'uma', ladoOuvinte: -1 }) as Trem;
    t.comandar({ pedal: 0.63, ignicao: true, velocidadeFixa: 0 });
    const { L, R } = renderCena(t, { amb: ambientePassagem('estacao'), traj: { lateral: 7.5 - 1.5, comprimento: 4000 }, ouv: { pos: [0, 0, 1.6], binaural: false }, dur: 7, s0: -t.corpo.comprimento / 2 + 5, eventos: [[3, () => t.comandar({ pedal: 0.63, velocidadeFixa: null })]] });
    const x = mono(L, R);
    // fundo: o trem parado ligado (aux) entra também; o fundo do ambiente é o da estação (murmúrio): mede-se 1 s antes de arrancar
    // o tom: o patamar da escada mais longo entre 3 e 7 s (as notas a ±1%), medido no próprio trecho
    const pts = patamares(rastrear(x, 3, 7, 150, 800)).filter((p) => NOTAS_TAURUS.some((n) => rel(p.f, n) <= 0.01)).sort((a, b) => b.dur - a.dur);
    const pt = pts[0] ?? { f: 300, t: 4.2, dur: 0.5 }, ft = pt.f;
    const [f, P] = welch(x, Math.round(pt.t * SR), Math.round((pt.t + pt.dur) * SR), 8192);
    let pk = 0; for (let i = 0; i < f.length; i++) if (Math.abs(f[i] - ft) < 4) pk = Math.max(pk, P[i]);
    // fundo na mesma faixa de 1/3 de oitava, no ambiente sozinho (sem trem)
    const d = new CenaDSP(SR); d.cru = true; d.message({ type: 'cena', amb: ambientePassagem('estacao'), traj: { tipo: 'reta', comprimento: 4000, raioCurva: 2000, lateral: 6, altitude: 0, sentido: 1 }, ouv: { modo: 'fixo', pos: [0, 0, 1.6], gimbal: { az: 90, el: 0, r: 5, alvo: 'corpo' }, local: 'fora', binaural: false } });
    const vazio = new Trem(SR, { N: 1, faces: 'uma' }); vazio.comandar({ pedal: 0, velocidadeFixa: 0 }); d.montar(vazio);
    const B = 128, l = new Float32Array(B), r = new Float32Array(B), sl = new Float32Array(B), sr = new Float32Array(B), fundo = new Float32Array(2 * SR);
    for (let k = 0; k < 2 * SR; k += B) { d.process(l, r, B, sl, sr); for (let j = 0; j < B; j++) fundo[k + j] = 0.5 * (l[j] + r[j]) * PA_FS; }
    const [f2, P2] = welch(fundo, SR / 2, 2 * SR, 8192);
    const fb = potFaixa(f2, P2, ft / 1.122, ft * 1.122) / (f2[1] - f2[0]) / ((ft * 1.122 - ft / 1.122) / (f2[1] - f2[0]));
    const dd = 10 * Math.log10(pk / Math.max(fb, 1e-30)) - 10 * Math.log10(1);
    // o tom (a linha, em dB SPL) contra o fundo da estação inteiro (o murmúrio, dB SPL sem ponderação)
    const tomDb = 10 * Math.log10(pk * (f[1] - f[0]) * 1.5 / 4e-10), fundoDb = 10 * Math.log10(potFaixa(f2, P2, 20, 20000) / 4e-10);
    void dd;
    caso('Taurus a 7,5 m arrancando: tom do inversor acima do fundo da estação', '10 ± 3 dB', `${sg(tomDb - fundoDb)} dB (tom ${f1(ft, 0)} Hz a ${f1(tomDb)} dB SPL, fundo ${f1(fundoDb)} dB SPL)`, perto(tomDb - fundoDb, 10, 3));
  }
  // Tesla a 6 m e 30 km/h (AVAS + pneus) e a 100 km/h (trem de força contra o total)
  {
    const passa = (kmh: number, ped: number, soMotor: boolean, semMotor: boolean) => {
      const c = portador('model3') as CarroEletrico;
      if (semMotor) c.comandar({ pedal: 0, ignicao: false });
      c.comandar({ pedal: ped, ignicao: !semMotor, velocidadeFixa: kmh / 3.6 });
      if (soMotor) for (const p of (c as any).proprias as { g: { gCal: number } }[]) p.g.gCal = 0;
      const dur = 2 * (40 / (kmh / 3.6));
      const { L, R } = renderCena(c, { amb: { ...ambientePassagem('ceu'), solo: { tipo: 'asfalto' } }, traj: { lateral: 6 - 0.925, comprimento: 4000 }, ouv: { pos: [0, 0, 1.2] }, dur, s0: -40 });
      return lafMax(mono(L, R));
    };
    const n30 = passa(30, 0.1, false, false);
    caso('Tesla a 6 m e 30 km/h (AVAS UE desliga a 20; pneus): L_AFmax', '62 ± 3 dB(A)', `${f1(n30)} dB(A)`, perto(n30, 62, 3));
    const tot = passa(100, 0.25, false, false), mot = passa(100, 0.25, true, false);
    caso('Tesla a 100 km/h: trem de força contra o total', '≤ −8 dB', `${sg(mot - tot)} dB (total ${f1(tot)} dB(A))`, mot - tot <= -8);
  }
}

// os presets elétricos da Passagem pela mensagem `portador` do CenaDSP (o caminho da página)
function gPassagem() {
  const casos: [string, string, string, Record<string, unknown>, number | null][] = [
    ['Tesla na rua', 'carro', 'model3', { pedal: 0.15 }, 30 / 3.6],
    ['Taurus partindo do-re-mi', 'trem', 'taurus', { pedal: 0.63 }, null],
    ['Metrô chegando na estação', 'trem', 'metropolis', { pedal: 0, freio: 0.6 }, 35 / 3.6],
    ['Trem-bala N700 no túnel', 'trem', 'n700', { pedal: 0.8 }, 150 / 3.6],
    ['Drone pairando', 'drone', 'mavic', { pedal: 0.5 }, 5 / 3.6],
  ];
  for (const [nome, tipo, id, cmd, v] of casos) {
    const d = new CenaDSP(SR); d.cru = true;
    d.message({ type: 'cena', amb: ambientePassagem(tipo === 'trem' && id === 'n700' ? 'tunel' : 'ceu'), traj: { tipo: 'reta', comprimento: 3000, raioCurva: 2000, lateral: 4, altitude: tipo === 'drone' ? 10 : 0, sentido: 1 }, ouv: { modo: 'fixo', pos: [0, 0, 1.6], gimbal: { az: 90, el: 0, r: 5, alvo: 'corpo' }, local: 'fora', binaural: true } });
    d.message({ type: 'portador', tipo, config: tipo === 'trem' ? { N: 10, faces: 'duas' } : {}, motor: { familia: 'eletrico', cfg: cfg(id) }, comando: cmd });
    d.message({ type: 'params', posicao: -40 });
    d.message({ type: 'comando', ...cmd, velocidadeFixa: v });
    const B = 128, l = new Float32Array(B), r = new Float32Array(B), sl = new Float32Array(B), sr = new Float32Array(B);
    let nan = 0, e = 0;
    for (let k = 0; k < 4 * SR; k += B) { d.process(l, r, B, sl, sr); for (let j = 0; j < B; j++) { if (!Number.isFinite(l[j])) nan++; e += l[j] * l[j]; } }
    const t: any = d.portador!.telemetria();
    const nivel = 10 * Math.log10((e / (4 * SR)) * PA_FS * PA_FS / 4e-10);
    caso(`Passagem: "${nome}" monta pela mensagem e soa`, 'sem NaN, motor ligado', `${d.portador!.fontes().length} fontes, ${f1(nivel)} dB, ${f1(t.rpm ?? 0, 0)} rpm, v ${f1(d.portador!.cinematica.v * 3.6)} km/h, modo ${t.modo}`, nan === 0 && (t.rpm ?? 0) > 0 && nivel > 20);
  }
}

// =============================================================================================== 12. CPU
function gCpu() {
  {
    const m = motor('n700');
    m.comandar({ acelerador: 0.6, ignicao: true, partida: false, omegaImposta: wDe(2500) } as never);
    renderMotor(m, 0.5);
    const t0 = performance.now(); renderMotor(m, 10); const c = (performance.now() - t0) / 10000;
    let nos = 0; for (const U of m.uni) for (const b of [U.bMotor, U.bInv, U.bRed, U.bVen]) nos += b ? b.Lmax : 0;
    caso('motor do N700, 4 unidades (≤ 800 osciladores)', '≈ 3% do tempo real (≤ 5%)', `${f1(c * 100, 2)}% (${nos} osciladores no máximo)`, c <= 0.05);
  }
  {
    const t = portador('n700', {}, { N: 10, faces: 'duas' }) as Trem;
    t.comandar({ pedal: 0.6, ignicao: true, velocidadeFixa: 120 / 3.6 });
    const d = new CenaDSP(SR); d.cru = true;
    d.message({ type: 'cena', amb: ambientePassagem('tunel'), traj: { tipo: 'reta', comprimento: 3000, raioCurva: 2000, lateral: 3, altitude: 0, sentido: 1 }, ouv: { modo: 'fixo', pos: [0, 0, 1.6], gimbal: { az: 90, el: 0, r: 5, alvo: 'corpo' }, local: 'fora', binaural: true } });
    d.montar(t); d.message({ type: 'params', posicao: -200 });
    const B = 128, l = new Float32Array(B), r = new Float32Array(B), sl = new Float32Array(B), sr = new Float32Array(B);
    for (let k = 0; k < SR; k += B) d.process(l, r, B, sl, sr);
    const ts: number[] = [];
    for (let k = 0; k < 6 * SR; k += B) { const a = performance.now(); d.process(l, r, B, sl, sr); ts.push(performance.now() - a); }
    ts.sort((a, b) => a - b);
    const q = (B / SR) * 1000, med = ts.reduce((a, b) => a + b, 0) / ts.length, p99 = ts[Math.floor(ts.length * 0.99)];
    caso(`N700 no túnel pela Cena (${t.fontes().length} fontes, 4 unidades): CPU por bloco`, '< 40% do quantum', `${f1((med / q) * 100)}% (p99 ${f1((p99 / q) * 100)}%)`, med / q < 0.4);
  }
}

// ---------------------------------------------------------------------------------------------- execução
const GRUPOS: Record<string, () => void> = { linhas: gLinhas, maquina: gMaquina, magneticas: gMagneticas, inversor: gInversor, modos: gModos, mecanica: gMecanica, avas: gAvas, niveis: gNiveis, portadores: gPortadores, gravacoes: gGravacoes, cena: gCena, passagem: gPassagem, cpu: gCpu };
const pedidos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const rodar = pedidos.length ? pedidos : Object.keys(GRUPOS);
for (const g of rodar) {
  if (!GRUPOS[g]) { console.error(`grupo desconhecido: ${g}`); process.exit(2); }
  grupoAtual = g;
  const t0 = performance.now();
  try { GRUPOS[g](); } catch (e) { caso(`${g}: exceção`, '—', String((e as Error).stack || e).slice(0, 400), false); }
  console.error(`(${g}: ${f1((performance.now() - t0) / 1000, 1)} s)`);
}
let ok = 0, desv = 0, falha = 0;
let gAnt = '';
for (const l of linhas) {
  if (l.grupo !== gAnt) { console.log(`\n## ${l.grupo}`); gAnt = l.grupo; }
  const st = l.ok ? 'ok  ' : l.desvio ? 'desv' : 'FALHA';
  if (l.ok) ok++; else if (l.desvio) desv++; else falha++;
  console.log(`${st} ${l.nome}: alvo ${l.alvo} · medido ${l.medido}`);
}
console.log(`\n${linhas.length} medidas: ${ok} ok, ${desv} desvios documentados, ${falha} falhas`);
process.exit(falha ? 1 : 0);
