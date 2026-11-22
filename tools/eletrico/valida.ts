// Validação do Elétrico (ELETRICO.md 7, passos 1–12, e a tabela 3.7 do projeto). Tolerâncias de 3 (decisão):
// linhas ±1% (patamar do Taurus ±2%), bandas ±4 dB de 150 Hz a 6 kHz e ±6 dB em 20–150 Hz, razões ±0,05, Bessel ±1 dB;
// acima de 6 kHz só a física (as gravações são comprimidas).
//
// O grupo `alvos-3.7` (antes `gravacoes`) não abre gravação nenhuma: compara os renders com os números da tabela 3.7, que
// o projetista mediu nas gravações (AUDITORIA T-ELE-02); a furadeira de rede, o drone 2 e o MP 73 são variantes montadas
// só aqui, não presets. Desvios (tools/desvios.ts): uma medida fora do alvo só passa se estiver no retrato
// `tools/eletrico-desvios.json` e ficar na folga do valor gravado (±1 dB, ±5 %). As medidas que mudavam de estado com a
// semente do ruído (T-ELE-03) são a mediana de 3 sementes. CPU e coletas de lixo: `npm run cpu:eletrico`.
//
//   npx tsx tools/eletrico/valida.ts [grupos...] [--semente N] [--atualizar[=nome exato]]
//   grupos: linhas maquina magneticas inversor modos mecanica avas niveis auxiliares portadores alvos-3.7 cena passagem
// Sai ≠ 0 se houver falha (os desvios do retrato aparecem como "desv", com o teto).
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { lerOpcoes, iniciarSementes, semear, porSementes, mediana, fmtSementes, avaliarDesvios, imprimirAvaliacao, type Medida } from '../desvios';
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

type Linha = Medida;
const RETRATO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'eletrico-desvios.json');
const f1 = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
/** mediana das 3 sementes e o texto "m (sementes a · b · c)" */
const m3 = (v: number[], d = 1) => ({ m: mediana(v), txt: `${f1(mediana(v), d)} (sementes ${fmtSementes(v, d)})` });
const sg = (x: number, d = 1) => (x >= 0 ? '+' : '') + f1(x, d);
const dB = (x: number) => 20 * Math.log10(Math.max(x, 1e-30));
const dentro = (x: number, a: number, b: number) => x >= a && x <= b;
const perto = (x: number, alvo: number, tol: number) => Math.abs(x - alvo) <= tol;
const rel = (x: number, alvo: number) => Math.abs(x / alvo - 1);
const wDe = (rpm: number) => (rpm * TAU) / 60;

const linhas: Linha[] = [];
let grupoAtual = '';
function caso(nome: string, alvo: string, medido: string, ok: boolean, valor?: number | number[], unidade?: string) { linhas.push({ grupo: grupoAtual, nome, alvo, medido, ok, valor, unidade }); }

/** canal de um motor por id (ou o primeiro que começa com o prefixo) */
const canal = (r: { canais: Float32Array[]; ids: string[] }, id: string) => { const i = r.ids.findIndex((x) => x === id || x.startsWith(id + '.')); return r.canais[i]; };
/** soma dos canais de uma lista de prefixos */
function somaCanais(r: { canais: Float32Array[]; ids: string[] }, prefixos: string[]) {
  const n = r.canais[0].length, s = new Float32Array(n);
  r.ids.forEach((id, i) => { if (prefixos.some((p) => id === p || id.startsWith(p + '.'))) { const c = r.canais[i]; for (let j = 0; j < n; j++) s[j] += c[j]; } });
  return s;
}
/**
 * Nível de um GRUPO de linhas em volta de f (dB re 20 µPa): a potência de ±larg·f. É a medida de um tom que tem vida:
 * o par f ± f_e do inversor, que bate, ou uma ordem de uma ferramenta cuja rotação passeia. O pico de uma raia (`nivelEm`)
 * lê 3 a 8 dB a menos num tom assim e depende da fase da batida.
 */
function nivelGrupo(x: ArrayLike<number>, t0: number, t1: number, f: number, larg: number) {
  const [fw, P] = welch(x, Math.round(t0 * SR), Math.round(t1 * SR), 8192);
  return 10 * Math.log10(potFaixa(fw, P, f * (1 - larg), f * (1 + larg)) / 4e-10 + 1e-30);
}
/** as medidas das leis de 1.1 e 1.3 são com a carcaça lisa (sem o relevo dos modos, que muda cada linha de ±2 dB) */
const LISO = { jitter: 0, ressonancia: 0 };

/** nível de uma linha corrigido pela curva da carcaça (para conferir as leis da tabela 1.1) */
const semH = (dBv: number, f: number, fc: number) => dBv - dB(hCarcaca(f, fc));

// =============================================================================================== 1. banco de linhas
function gLinhas() {
  const nL = 200, b = new BancoDeLinhas(SR, nL, 7), L = new ListaLinhas(256);
  const fq = Array.from({ length: nL }, (_, k) => 50 * Math.pow(20000 / 50, k / (nL - 1)));
  const am = fq.map((_, k) => 0.002 * (1 + (k % 5)));
  const N = 10 * SR, out = new Float32Array(N);
  for (let k = 0; k < N; k += 64) { L.limpar(); for (let i = 0; i < nL; i++) L.por(i, fq[i], am[i]); b.atualizar(L); b.processar(out, k, Math.min(64, N - k)); }
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
  caso('200 linhas de 50 Hz a 20 kHz: frequência', '±0,01%', `máx ${f1(eF * 100, 4)}%`, eF <= 1e-4, eF * 100, '%');
  caso('200 linhas: nível (com a rampa de −12 dB acima de 18 kHz)', '±0,1 dB', `máx ${f1(eA, 3)} dB`, eA <= 0.1, eA, 'dB');
  caso('nada acima de 21,6 kHz', '< −100 dB da maior', `${f1(dB(cima / top))} dB`, dB(cima / top) < -100, dB(cima / top), 'dB');
  // (a CPU de 200 linhas e as coletas do --trace-gc estão em tools/eletrico/cpu.ts)
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
    caso('troca de 100 linhas de uma vez: estalo (acima de 16 kHz)', '< 0,05 FS', `${f1(pk, 5)} FS (fora da troca ${f1(pk0, 5)})`, pk < 0.05, pk, '');
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
  caso('Model 3 LR AWD: 0–100 km/h (plano, aderência 0,75 g)', '4,7 ± 0,5 s', `${f1(t3, 2)} s`, perto(t3, 4.7, 0.5), t3, 's');
  const tl = zeroA('leaf', 100, 14);
  caso('Leaf: 0–100 km/h', '8,0 ± 0,8 s', `${f1(tl, 2)} s`, perto(tl, 8, 0.8), tl, 's');
  // Metropolis: o alvo do passo 2 é a conta do plano ("1,0 m/s² até o limite de potência, depois potência constante", sem
  // resistência ao avanço nem massa girante), não uma medida. Refeita com a ficha real (AUDITORIA F-ELE-03, T-ELE-07):
  // P na roda = n_motores·P_max·η = 24 × 180 kW × 0,96 = 4,15 MW; a 1,0 m/s² o limite de potência chega em
  // v₁ = P/(m·a) = 4,15 MW/(240 t × 1 m/s²) = 17,3 m/s (62 km/h), em t₁ = v₁/a = 17,3 s; de v₁ a v₂ = 80 km/h (22,2 m/s) a
  // potência constante leva t₂ = m·(v₂² − v₁²)/(2P) = 240 t × (493,8 − 298,6)/(2 × 4,15 MW) = 5,6 s; 0–80 em 22,9 s. (Os
  // 36 s de antes eram essa conta com 1,0 m/s² só até 40 km/h, P = 2,67 MW, e nem ela dá 36: dá 27,7 s.)
  const pm = preset('metropolis'), ptm = pm.portador as { carrosMotores: number[]; motoresPorTruque: number; massaTotal: number };
  const nMotM = ptm.carrosMotores.length * 2 * ptm.motoresPorTruque, Pr = nMotM * pm.Pmax * pm.reducao.eta, mM = ptm.massaTotal;
  const v2 = 80 / 3.6, v1 = Math.min(v2, Pr / (mM * 1.0)), tAlvo = v1 / 1.0 + (v2 > v1 ? (mM * (v2 * v2 - v1 * v1)) / (2 * Pr) : 0);
  const tm = zeroA('metropolis', 80, 60);
  caso('metrô de 6 carros (Metropolis, 240 t): 0–80 km/h', `${f1(tAlvo, 1)} ± 4 s (conta do plano com ${nMotM} × ${f1(pm.Pmax / 1000, 0)} kW)`, `${f1(tm, 1)} s`, perto(tm, tAlvo, 4), tm, 's');
  {
    const p = portador('model3');
    p.comandar({ pedal: 0, ignicao: true, velocidadeFixa: 100 / 3.6 }); renderPortador(p, 0.2);
    p.comandar({ velocidadeFixa: null, freio: 1, pedal: 0 });
    let t = -1; renderPortador(p, 20, [], (tt) => { if (t < 0 && p.cinematica.v * 3.6 <= 20) t = tt; });
    caso('regeneração 100 → 20 km/h a 0,3·T_n (Model 3)', '9 ± 1 s', `${f1(t, 2)} s`, perto(t, 9, 1), t, 's');
  }
  {
    const p = preset('taurus'), m = motor('taurus');
    m.comandar({ acelerador: 1, ignicao: true, partida: false, omegaImposta: wDe(p.rpmBase), torqueFixo: p.Tn } as never);
    renderMotor(m, 0.1);
    const t: any = m.telemetria(), esp = (p.escorregamentoNominal ?? 0.02) * (p.p * p.rpmBase) / 60;
    const s = t.fE - p.p * t.fRot;
    caso('indução: f_e = p·f_rot + s·f_e (Taurus em T_n)', 's_n·f_e,n ±5%', `${f1(s, 3)} Hz (esperado ${f1(esp, 3)})`, rel(s, esp) <= 0.05, s, 'Hz');
  }
}

// =============================================================================================== 3. forças magnéticas
function gMagneticas() {
  const fc = F_CARC.carro;
  const leaf = preset('leaf');
  const m = motor('leaf', LISO);
  const T = 0.6 * leaf.Tn;
  m.comandar({ acelerador: 1, ignicao: true, partida: false, omegaImposta: wDe(5000), torqueFixo: T } as never);
  const r = renderMotor(m, 1.6), x = canal(r, 'motor');
  const fr = 5000 / 60, fe = 4 * fr;
  const L = (f: number) => nivelEm(x, 0.5, 1.6, f, 0.003);
  const alvos: [string, number][] = [['2f_e', 2 * fe], ['6f_e', 6 * fe], ['48·f_rot', 48 * fr], ['48·f_rot + 2f_e', 48 * fr + 2 * fe], ['48·f_rot − 2f_e', 48 * fr - 2 * fe]];
  let eF = 0;
  for (const [, f] of alvos) eF = Math.max(eF, rel(L(f).f, f));
  caso('Leaf a 5000 rpm: 666,7, 2000, 4000, 4000 ± 666,7 Hz', '±0,5%', `máx ${f1(eF * 100, 3)}%`, eF <= 0.005, eF * 100, '%');
  {
    // as leis do grupo de ranhuras num Leaf com Z_s = 46: com Z_s/p inteiro (48/4) a linha m = 1, k = 0 cai em 12·f_e e
    // soma em potência com a ondulação de torque (linhas.ts funde as frequências iguais), o que mascara a lei
    const mv = motor('leaf', { ...LISO, Zs: 46 });
    mv.comandar({ acelerador: 1, ignicao: true, partida: false, omegaImposta: wDe(5000), torqueFixo: T } as never);
    const xv = canal(renderMotor(mv, 1.6), 'motor'), Lv = (f: number) => nivelEm(xv, 0.5, 1.6, f, 0.003);
    const c0 = semH(Lv(46 * fr).dB, 46 * fr, fc);
    const k1 = semH(Lv(46 * fr + 2 * fe).dB, 46 * fr + 2 * fe, fc) - c0, k1m = semH(Lv(46 * fr - 2 * fe).dB, 46 * fr - 2 * fe, fc) - c0;
    const k2 = semH(Lv(46 * fr + 4 * fe).dB, 46 * fr + 4 * fe, fc) - c0;
    const m2 = semH(Lv(92 * fr).dB, 92 * fr, fc) - c0;
    caso('ranhuras k = ±1 contra k = 0 (Z_s 46, curva da carcaça descontada)', '−6 ± 1 dB', `${sg(k1)} / ${sg(k1m)} dB`, perto(k1, -6, 1) && perto(k1m, -6, 1), [k1, k1m], 'dB');
    caso('ranhuras k = ±2 contra k = 0', '−14 ± 1 dB', `${sg(k2)} dB`, perto(k2, -14, 1), k2, 'dB');
    caso('ranhuras m = 2 contra m = 1', '−10 ± 1 dB', `${sg(m2)} dB`, perto(m2, -10, 1), m2, 'dB');
  }
  const t: any = m.telemetria(), I = t.corrente;
  const a6 = semH(L(6 * fe).dB, 6 * fe, fc) - semH(L(2 * fe).dB, 2 * fe, fc), esp6 = Math.min(0, -20 + 20 * Math.log10(Math.max(I, 0.1) / 0.1));
  caso('6f_e contra 2f_e: −20 dB em vazio + 20·log(I/I_vazio)', `${sg(esp6)} ± 1 dB (I/I_n ${f1(I, 2)})`, `${sg(a6)} dB`, perto(a6, esp6, 1), a6, 'dB');
  // indução com escorregamento: barras em (1 − s)·Z_r·f_e/p
  {
    const pd = (PRESETS_ELETRICO[0].segundo)!;
    const mi = motor(pd, LISO);
    mi.comandar({ acelerador: 1, ignicao: true, partida: false, omegaImposta: wDe(3000), torqueFixo: pd.Tn } as never);
    const ri = renderMotor(mi, 1.4), xi = canal(ri, 'motor'), ti: any = mi.telemetria();
    const s = (ti.fE - pd.p * ti.fRot) / ti.fE, esp = ((1 - s) * pd.Zr! * ti.fE) / pd.p;
    const med = nivelEm(xi, 0.4, 1.4, esp, 0.004).f;
    caso('indução: barras em (1 − s)·Z_r·f_e/p', `±0,5% (s ${f1(s * 100, 2)}%)`, `${f1(med, 1)} Hz (esperado ${f1(esp, 1)})`, rel(med, esp) <= 0.005, med, 'Hz');
  }
  // fluxo: 2f_e cai 6 dB/oitava acima da base
  {
    const lv = (rpm: number) => {
      const mm = motor('leaf', LISO);
      mm.comandar({ acelerador: 1, ignicao: true, partida: false, omegaImposta: wDe(rpm), torqueFixo: 0.2 * leaf.Tn } as never);
      const rr = renderMotor(mm, 1.2), f = (2 * 4 * rpm) / 60;
      return semH(nivelEm(canal(rr, 'motor'), 0.4, 1.2, f, 0.003).dB, f, fc);
    };
    const d = lv(2 * leaf.rpmBase) - lv(leaf.rpmBase);
    caso('Φ: 2f_e entre 1× e 2× a rotação de base', '−6 ± 0,5 dB', `${sg(d)} dB`, perto(d, -6, 0.5), d, 'dB');
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
    caso(`Bessel, M = ${M}: f_c ± 2f_e`, `${f1(a)} ± 1 dB (fórmula ${f1(ta)})`, `${f1(r.s2)} / ${f1(r.s2m)} dB`, perto(r.s2, a, 1) && perto(r.s2m, a, 1), [r.s2, r.s2m], 'dB');
    caso(`Bessel, M = ${M}: 2f_c ± f_e`, `${f1(b)} ± 1 dB (fórmula ${f1(tb)})`, `${f1(r.g2)} / ${f1(r.g2m)} dB`, perto(r.g2, b, 1) && perto(r.g2m, b, 1), [r.g2, r.g2m], 'dB');
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
    caso('f_e → 0: f_c, 2f_c, 3f_c sem salto de nível', '≤ 0,5 dB', `passo máx ${f1(salto, 3)} dB; 4 Hz → 0: ${f1(tot, 3)} dB`, salto <= 0.5 && tot <= 0.5, [salto, tot], 'dB');
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
    caso(`do-re-mi a ${acel} m/s²: 12 patamares nas notas, em ordem`, '12 de 12, ±1%', `${achados.length} (${achados.map((p) => f1(p.f, 0)).join(' ')})`, achados.length === 12, achados.length, '');
    caso(`do-re-mi a ${acel} m/s²: duração de cada degrau`, acel === 0.35 ? '0,3–1,2 s' : '0,2–1,2 s', `${f1(Math.min(...durs), 2)}–${f1(Math.max(...durs), 2)} s`, durs.length === 12 && Math.min(...durs) >= (acel === 0.35 ? 0.3 : 0.2) - 0.051 && Math.max(...durs) <= 1.2, [Math.min(...durs), Math.max(...durs)], 's');
    caso(`do-re-mi a ${acel} m/s²: escala inteira (G3 → D5)`, `${f1(alvo)} ± ${f1(tol)} s`, `${f1(escala, 2)} s`, perto(escala, alvo, tol), escala, 's');
    caso(`do-re-mi a ${acel} m/s²: patamar final mantido`, '598 ± 12 Hz até a troca', fin.length ? `${f1(fin[0].f)} Hz por ${f1(fin.reduce((a, p) => a + p.dur, 0), 1)} s` : 'não achado', fin.length > 0 && perto(fin[0].f, 598, 12), fin.length ? fin[0].f : NaN, 'Hz');
    if (acel === 0.35) {
      // harmônicos no patamar (3.1, D 21–26 s): 2f_c −4..−9, 3f_c −5..−15, 4f_c −3..−10
      const t0 = fin.length ? fin[0].t + 0.2 : 9;
      // (o grupo inteiro de cada harmônico: o par m·f_c ± f_e, a ±24 Hz)
      const l1 = nivelGrupo(r.inv, t0, t0 + 1.5, 598, 0.04);
      const h = [2, 3, 4].map((m) => nivelGrupo(r.inv, t0, t0 + 1.5, 598 * m, 0.04 / m) - l1);
      caso('Taurus, patamar: 2f_c / 3f_c / 4f_c contra f_c', '−4..−9 / −5..−15 / −3..−10 dB', h.map((x) => sg(x)).join(' / '), dentro(h[0], -9, -4) && dentro(h[1], -15, -5) && dentro(h[2], -10, -3), h, 'dB');
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
    caso('síncrona: f_c = N·f_e', '±0,1%', `${f1(eN * 100, 4)}% (${trocas.length} trocas de modo/N)`, eN <= 1e-3, eN * 100, '%');
    caso('síncrona: trocas de N sem estalo (acima de 16 kHz)', '< 0,1 FS', `${f1(est / pkx, 4)} FS`, est / pkx < 0.1, est / pkx, '');
  }
  // aleatória δ 0,15 contra a fixa, mesma energia
  {
    const base = preset('model3');
    const roda = (modo: string) => {
      const m = motor(base, { inversor: { tipo: 'sic', fc: 6000, modo: modo as never, delta: 0.15 }, ...LISO });
      m.comandar({ acelerador: 1, ignicao: true, partida: false, omegaImposta: wDe(3000), torqueFixo: base.Tn } as never);
      return canal(renderMotor(m, 2.2), 'inversor');
    };
    const xa = roda('assincrona'), xr = roda('aleatoria');
    const [fA, PA] = welch(xa, SR / 2, 2.2 * SR, 8192), [, PR] = welch(xr, SR / 2, 2.2 * SR, 8192);
    const eFix = potFaixa(fA, PA, 3600, 8400), eAle = potFaixa(fA, PR, 3600, 8400);
    let pf = 0, pr = 0; for (let i = 0; i < fA.length; i++) if (fA[i] > 5500 && fA[i] < 6500) { pf = Math.max(pf, PA[i]); pr = Math.max(pr, PR[i]); }
    caso('aleatória δ 0,15: energia do grupo f_c igual à da fixa', '±1 dB', `${sg(10 * Math.log10(eAle / eFix))} dB`, Math.abs(10 * Math.log10(eAle / eFix)) <= 1, 10 * Math.log10(eAle / eFix), 'dB');
    caso('aleatória δ 0,15: pico em f_c abaixo do da fixa', '≥ 12 dB', `${f1(10 * Math.log10(pf / pr))} dB`, 10 * Math.log10(pf / pr) >= 12, 10 * Math.log10(pf / pr), 'dB');
  }
  // chopper: ∝ D(1 − D), máximo em 0,5, some em D = 1
  {
    const p = preset('frotaa');
    const lv = (D: number) => {
      const m = motor('frotaa', LISO);
      m.comandar({ acelerador: 1, ignicao: true, partida: false, omegaImposta: D * wDe(p.rpmBase), torqueFixo: p.Tn } as never);
      return nivelEm(canal(renderMotor(m, 1.2), 'inversor'), 0.4, 1.2, 350, 0.005).dB;
    };
    const a25 = lv(0.25), a50 = lv(0.5), a75 = lv(0.75), a100 = lv(1.0);
    caso('chopper: D 0,25 e 0,75 iguais', '±0,5 dB', `${sg(a25 - a75, 2)} dB`, Math.abs(a25 - a75) <= 0.5, a25 - a75, 'dB');
    caso('chopper: máximo em D = 0,5', 'acima de 0,25 e 0,75', `${sg(a50 - a25)} dB`, a50 > a25 && a50 > a75, a50 - a25, 'dB');
    caso('chopper: some em D = 1', '< −60 dB de D = 0,5', `${sg(a100 - a50)} dB`, a100 - a50 < -60, a100 - a50, 'dB');
  }
}

// =============================================================================================== 6. mecânica
function gMecanica() {
  const p = preset('model3');
  const roda = (T: number, rpm = 7700, dur = 1.4) => {
    const m = motor('model3', LISO);
    m.comandar({ acelerador: 1, ignicao: true, partida: false, omegaImposta: wDe(rpm), torqueFixo: T } as never);
    return canal(renderMotor(m, dur), 'reducao');
  };
  const fr = 7700 / 60, x = roda(0.5 * p.Tn);
  const f1e = nivelEm(x, 0.4, 1.4, 27 * fr, 0.006), f2e = nivelEm(x, 0.4, 1.4, (23 * fr * 27) / 75, 0.006);
  caso('Tesla a 7700 rpm: engrenamento 27·f_rot e 23·f_rot/2,78', '3465 e 1062 Hz ±0,5%', `${f1(f1e.f)} e ${f1(f2e.f)} Hz`, rel(f1e.f, 3465) <= 0.005 && rel(f2e.f, 1062) <= 0.005, [f1e.f, f2e.f], 'Hz');
  const lb = nivelEm(x, 0.4, 1.4, 27 * fr + fr, 0.004).dB - f1e.dB, lbm = nivelEm(x, 0.4, 1.4, 27 * fr - fr, 0.004).dB - f1e.dB;
  caso('bandas laterais ±f_rot do engrenamento', '−10 ± 2 dB', `${sg(lb)} / ${sg(lbm)} dB`, perto(lb, -10, 2) && perto(lbm, -10, 2), [lb, lbm], 'dB');
  const x2 = roda(p.Tn), d = nivelEm(x2, 0.4, 1.4, 27 * fr, 0.006).dB - f1e.dB;
  caso('engrenamento ao dobrar o torque', '+6 ± 0,5 dB', `${sg(d, 2)} dB`, perto(d, 6, 0.5), d, 'dB');
  // torque ≈ 0: some o engrenamento, entra o chocalho (impulsivo)
  {
    // (o chocalho é ruído: o nível em 27·f_rot muda com a semente, −39,7 a −41,5 dB; mediana de 3, T-ELE-03)
    const x0 = roda(0.01 * p.Tn, 7700, 2.4);
    const l0 = m3(porSementes(() => nivelEm(roda(0.01 * p.Tn, 7700, 2.4), 0.6, 2.4, 27 * fr, 0.006).dB - f1e.dB));
    caso('|T| < 3% de T_n: engrenamento', '< −40 dB do de carga', `${l0.txt} dB`, l0.m < -40, l0.m, 'dB');
    const b1 = new Bq().bp(SR, 2000, 0.7);
    const y: number[] = []; for (let i = Math.round(0.6 * SR); i < 2.4 * SR; i++) y.push(b1.run(x0[i]));
    const mu = y.reduce((a, b) => a + b, 0) / y.length, m2 = y.reduce((a, b) => a + (b - mu) ** 2, 0) / y.length, m4 = y.reduce((a, b) => a + (b - mu) ** 4, 0) / y.length;
    caso('|T| < 3%: chocalho no bp de 1–4 kHz (curtose)', '> 4', f1(m4 / (m2 * m2), 2), m4 / (m2 * m2) > 4, m4 / (m2 * m2), '');
  }
  // furadeira: comutador em 12 e 24·f_rot, e o faiscamento modulado em Z_c·f_rot
  {
    const m = motor('furadeira', LISO);
    m.comandar({ acelerador: 1, ignicao: true, partida: false, omegaImposta: null } as never);
    const r = renderMotor(m, 2.5), xe = canal(r, 'escovas'), t: any = m.telemetria();
    const l12 = nivelEm(xe, 1, 2.5, 12 * t.fRot, 0.004).f, l24 = nivelEm(xe, 1, 2.5, 24 * t.fRot, 0.004).f;
    caso('furadeira: 247,5 × 12 e × 24', '2970 e 5940 Hz ±1%', `${f1(l12)} e ${f1(l24)} Hz (f_rot ${f1(t.fRot, 1)})`, rel(l12, 2970) <= 0.01 && rel(l24, 5940) <= 0.01, [l12, l24], 'Hz');
    // faiscamento sozinho (sem os tons): envoltória de 2–10 kHz
    const m2 = motor('furadeira', LISO);
    const U = m2.uni[0], orig = U.esc!.linhas.bind(U.esc!);
    U.esc!.linhas = (e, L, det) => orig(e, L, det, true);
    m2.comandar({ acelerador: 1, ignicao: true, partida: false, omegaImposta: null } as never);
    const xf = canal(renderMotor(m2, 2.5), 'escovas'), env = new Float32Array(xf.length);
    for (let i = 0; i < xf.length; i++) env[i] = xf[i] * xf[i];
    const pk = linha(env, 1, 2.5, 1500, 8000), fm = 12 * (m2.telemetria() as any).fRot;
    caso('faiscamento: pico da envoltória (2–10 kHz) em Z_c·f_rot', `${f1(fm, 0)} Hz ±1%`, `${f1(pk.f)} Hz`, rel(pk.f, fm) <= 0.01, pk.f, 'Hz');
  }
}

// =============================================================================================== 7. AVAS
function gAvas() {
  const nivel = (kmh: number, solo: string, re = false) => {
    const c = new CarroEletrico(SR, { ...(preset('model3').portador as any), pneusAero: false });
    const m = motor('model3'); c.acoplar(m); semear(c);
    c.comandar({ pedal: 0, ignicao: true, velocidadeFixa: kmh / 3.6, marcha: re ? -1 : 1 });
    // o ouvinte a 2 m da lateral, à altura do para-choque dianteiro, o carro parado ali (ou passando a v). O passo 7 pede
    // "Cena, céu aberto, solo asfalto" (AUDITORIA T-ELE-04): no asfalto, a 2 m, a reflexão no chão cancela parte do tom de
    // 250 Hz (Δ ≈ 0,56 m) e não o ruído de 1 kHz; em campo livre, ao lado, só informativo
    const { L, R } = renderCena(c, { amb: { ...ambientePassagem('ceu'), solo: { tipo: solo } as any }, traj: { lateral: 2 - 0.925, comprimento: 4000 }, ouv: { pos: [0, 0, 1.2] }, dur: 3, s0: -2.2 + (kmh > 0 ? -kmh / 3.6 * 1.5 : 0) });
    // o mesmo ponto de medida nos três casos: 125 ms com o alto-falante no través (parado: 2 s)
    return { la: kmh > 0 ? dBA(mono(L, R), 1.5 - 0.0625 - 0.05, 1.5 + 0.0625) : dBA(mono(L, R), 1, 3), c, m };
  };
  const alvo: [number, number][] = [[0, 55], [10, 61], [20, 67]];
  for (const [v, a] of alvo) {
    // (mediana de 3 sementes: a 20 km/h o nível em campo livre ia de 68,3 a 68,6 com a semente, T-ELE-03)
    const n = m3(porSementes(() => nivel(v, 'asfalto').la)), nl = nivel(v, 'nenhum').la;
    caso(`AVAS a 2 m, ${v} km/h (asfalto)`, `${a} ± 1,5 dB(A)`, `${n.txt} dB(A) (campo livre ${f1(nl)})`, perto(n.m, a, 1.5), n.m, 'dB');
  }
  // estouro ao sair de parado (AUDITORIA P-02, B6): parado com o AVAS ligado e, de uma vez, 108 km/h. O AVAS desliga com
  // rampa de 2 s; nessa rampa o nível tem de ficar no do limite (20 km/h no modo UE), não seguir a lei L_W = 74 + 0,6·v
  {
    const lafAvas = (kmh0: number, kmh1: number) => {
      const m = motor('model3');
      m.comandar({ acelerador: 0, ignicao: true, partida: false, v: kmh0 / 3.6 } as never);
      const r = renderMotor(m, 4, [[1, () => m.comandar({ acelerador: 0, ignicao: true, partida: false, v: kmh1 / 3.6 } as never)]]);
      return lafMax(canal(r, 'avas'));
    };
    const pulo = lafAvas(0, 108), lim = lafAvas(20, 20);
    caso('AVAS de parado direto a 108 km/h: L_AFmax do canal no desligamento contra o de 20 km/h', '≤ +1 dB', `${sg(pulo - lim)} dB (${f1(pulo)} contra ${f1(lim)} dB(A) a 7,5 m no eixo)`, pulo - lim <= 1, pulo - lim, 'dB');
  }
  // deslocamento de frequência
  {
    const f = (kmh: number) => { const m = motor('model3'); m.comandar({ acelerador: 0, ignicao: true, partida: false, v: kmh / 3.6 } as never); let s = 0, n = 0; renderMotor(m, 6.7, [], () => { s += m.avas!.f1; n++; }); return s / n; };
    const d = (f(20) / f(0) - 1) / 20 * 100;
    caso('AVAS: f₁ sobe com a velocidade', '1,2 ± 0,1 %/km/h', `${f1(d, 3)} %/km/h`, perto(d, 1.2, 0.1), d, '%');
  }
  {
    const m = motor('model3');
    m.comandar({ acelerador: 0, ignicao: true, partida: false, v: 19 / 3.6 } as never);
    const r = renderMotor(m, 5, [[1, () => m.comandar({ acelerador: 0, ignicao: true, partida: false, v: 25 / 3.6 } as never)]]);
    const x = canal(r, 'avas'), rms = (a: number, b: number) => { let s = 0; for (let i = Math.round(a * SR); i < b * SR; i++) s += x[i] * x[i]; return Math.sqrt(s / ((b - a) * SR)); };
    const d = dB(rms(3.2, 5) / rms(0.4, 1));
    caso('AVAS a 25 km/h (UE), 2 s depois', '< −40 dB', `${f1(d)} dB`, d < -40, d, 'dB');
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
    caso('AVAS em ré: pulso', '1,5 Hz', `${f1(bf, 2)} Hz`, perto(bf, 1.5, 0.05), bf, 'Hz');
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
        // (compressor, ventilação e transformador têm calibração própria: fora da sonda, como em motor.ts)
        if (m.auxi) m.auxi.mudo = true;
        let uRef = 0; m.uni.forEach((U, i) => { if (Math.abs(U.det - 1) < Math.abs(m.uni[uRef].det - 1)) uRef = i; });
        // (3 s de medida: as linhas têm vida, e o nível de um instante sobe e desce com ela)
        const r = renderMotor(m, 3.25);
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
  caso('sonda: cada fonte no L_W do preset (todos os presets)', '±1 dB', `pior ${sg(pior, 2)} dB (${quem})`, Math.abs(pior) <= 1, pior, 'dB');
  caso('todos os presets, 4 estados × 2 s: sem NaN, abaixo de −1 dBFS a 7,5 m', 'nenhum', nanOuAlto.length ? nanOuAlto.join('; ') : 'nenhum', nanOuAlto.length === 0, nanOuAlto.length, '');
}

// =============================================================================================== 8b. auxiliares do trem parado
function gAuxiliares() {
  // o compressor liga e desliga (pressostato): 90 s do metrô parado; o estado sai do próprio modelo e o nível, do canal `aux`
  {
    const m = motor('cptm9500');
    m.comandar({ acelerador: 0, ignicao: true, partida: false, v: 0 } as never);
    const est: { t: number; on: boolean }[] = [];
    const r = renderMotor(m, 90, [], (t) => est.push({ t, on: m.auxi!.ligadoComp }));
    const x = canal(r, 'aux');
    const trocas: number[] = []; for (let i = 1; i < est.length; i++) if (est[i].on !== est[i - 1].on) trocas.push(est[i].t);
    const liga = trocas.length >= 1 ? trocas[0] : NaN, para = trocas.length >= 2 ? trocas[1] - trocas[0] : NaN;
    caso('compressor do metrô parado: liga e desliga em 90 s', '≥ 3 trocas; 13–19 s ligado, 27–41 s parado', `${trocas.length} trocas (aos ${trocas.map((t) => f1(t, 0)).join(', ')} s): ${f1(liga, 1)} s ligado, ${f1(para, 1)} s parado`, trocas.length >= 3 && dentro(liga, 13, 19) && dentro(para, 27, 41), [trocas.length, liga, para], '');
    // nível de 20–150 Hz (onde moram as ordens do compressor) ligado contra parado
    const nv = (t0: number, t1: number) => { const [fw, P] = welch(x, Math.round(t0 * SR), Math.round(t1 * SR), 16384); return 10 * Math.log10(potFaixa(fw, P, 20, 150) / 4e-10 + 1e-30); };
    const on = nv(2, liga - 1), off = nv(liga + 2, liga + para - 1);
    caso('compressor: 20–150 Hz do canal auxiliar, ligado contra parado', '≥ +4 dB', `${sg(on - off)} dB (${f1(on)} e ${f1(off)} dB SPL a 7,5 m)`, on - off >= 4, on - off, 'dB');
  }
  // parado contra partindo, na plataforma (3 m da lateral, ao lado do 1º truque motor, estação sem o murmúrio): nas
  // gravações de plataforma (Frota J, Frota L, CPTM 9500) o trem parado fica 4 a 11 dB abaixo dele mesmo partindo ou
  // chegando; o simulado tem de ficar nesse nível ou abaixo, e não em silêncio
  for (const id of ['cptm9500', 'metropolis', 'frotaa']) {
    const nivel = (parte: boolean) => {
      const t = portador(id, {}, { faces: 'uma', ladoOuvinte: 1 }) as Trem;
      t.comandar(parte ? { pedal: 1, ignicao: true, velocidadeFixa: null } : { pedal: 0, ignicao: true, velocidadeFixa: 0 });
      const f = t.fontes().find((q) => /^(motor|tracao)/.test(q.id))!, larg = t.corpo.segmentos[0].largura, alt = t.corpo.segmentos[0].altura;
      const y = larg / 2 + 3, z = 1.6 - alt / 2, rr = Math.hypot(f.pos[0], y, z);
      const { L, R } = renderCena(t, { amb: { ...ambientePassagem('estacao'), fundo: { vento: 0, ventilacao: 0, murmurio: 0 } }, traj: { tipo: 'volta', comprimento: 20000, raioCurva: 3000, lateral: 3 },
        ouv: { modo: 'gimbal', gimbal: { az: (Math.atan2(y, f.pos[0]) * 180) / Math.PI, el: (Math.asin(z / rr) * 180) / Math.PI, r: rr, alvo: 'corpo' }, local: 'fora', binaural: false }, dur: parte ? 8 : 14 });
      const x = mono(L, R), [fw, P] = welch(x, Math.round((parte ? 3 : 6) * SR), Math.round((parte ? 8 : 14) * SR), 8192);
      return 10 * Math.log10(potFaixa(fw, P, 20, 12000) / 4e-10);
    };
    const par = nivel(false), arr = nivel(true);
    caso(`${id} na plataforma: parado contra partindo`, '−4 a −20 dB (gravações −4 a −11)', `${sg(par - arr)} dB (${f1(par)} e ${f1(arr)} dB SPL a 3 m)`, dentro(par - arr, -20, -4), par - arr, 'dB');
  }
}

// =============================================================================================== 9. portadores
function gPortadores() {
  {
    const t = portador('cptm9500', {}, { faces: 'duas' }) as Trem;
    caso('metrô de 8 carros com 4 carros motores (CPTM 9500, duas faces): fontes', `≤ ${MAX_FONTES}`, `${t.fontes().length} (${t.tracao!.grupo})`, t.fontes().length <= MAX_FONTES, t.fontes().length, '');
    const n = portador('n700', {}, { N: 10, faces: 'duas' }) as Trem;
    caso('N700 no trem-bala da Passagem (10 carros, 8 motores, duas faces): fontes', `≤ ${MAX_FONTES}`, `${n.fontes().length} (${n.tracao!.grupo})`, n.fontes().length <= MAX_FONTES, n.fontes().length, '');
    let erro = '';
    try { portador('n700', {}, { N: 16, faces: 'uma' }); } catch (e) { erro = String((e as Error).message).slice(0, 60); }
    caso('N700 de 16 carros (14 motores)', `≤ ${MAX_FONTES} fontes`, erro ? `o trem sem motor já não cabe: ${erro}…` : 'cabe', !erro, erro ? 1 : 0, '');
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
    caso('drone: 4 BPF distintas pelos detune', '±0,5%', `${med.join(', ')} Hz (pior ${f1(pior * 100, 2)}%)`, pior <= 0.005, pior * 100, '%');
  }
  {
    // pneus do carro a 80 km/h, só os pneus, a 7,5 m
    const c = portador('model3') as CarroEletrico;
    c.comandar({ pedal: 0, ignicao: false, velocidadeFixa: 80 / 3.6 });
    const prop = (c as any).proprias as { f: { id: string }; g: { gCal: number } }[];
    for (const p of prop) if (!p.f.id.startsWith('pneu')) p.g.gCal = 0;
    // o alvo do CENA 4.1 (4 × 95 dB(A) de L_W a 7,5 m) é com o carro no asfalto, que é onde a página o toca (AUDITORIA
    // T-ELE-04); em campo livre, ao lado, só informativo (a imagem da fonte no chão, z 0,02, soma até +5 dB)
    const pneus = (tipo: string) => {
      const c2 = portador('model3') as CarroEletrico;
      c2.comandar({ pedal: 0, ignicao: false, velocidadeFixa: 80 / 3.6 });
      for (const p of (c2 as any).proprias as { f: { id: string }; g: { gCal: number } }[]) if (!p.f.id.startsWith('pneu')) p.g.gCal = 0;
      const { L, R } = renderCena(c2, { amb: { ...ambientePassagem('ceu'), solo: { tipo } as any }, traj: { lateral: 7.5 - 0.925 }, ouv: { pos: [0, 0, 1.2] }, dur: 8, s0: -80 / 3.6 * 4 });
      return lafMax(mono(L, R));
    };
    void prop;
    const n = pneus('asfalto'), nl = pneus('nenhum');
    caso('pneus do carro a 80 km/h, a 7,5 m (só pneus, asfalto, CENA 4.1)', '73 ± 2 dB(A)', `${f1(n)} dB(A) (campo livre ${f1(nl)})`, perto(n, 73, 2), n, 'dB');
  }
}

// =============================================================================================== 10. alvos da tabela 3.7
// (os números que o projetista mediu nas gravações, copiados para cá: este grupo não abre gravação nenhuma)
function gAlvos37() {
  // Taurus parado: linhas fixas a −8..−12 dB do tom do inversor em escada. Medido no ouvido, como a gravação: ao lado do
  // meio da locomotiva, a 7,5 m, primeiro parada (as linhas) e depois arrancando (o tom); sem chão e sem fundo, para a
  // interferência do solo num ponto só não decidir a medida (a 4 m no concreto ela tira 10 dB de 688 Hz). As linhas de
  // 176 e 527 Hz são dos sopradores (3ª ordem e passagem de pá, 9 × 58,5 Hz) e do auxiliar; antes a medida era só do canal
  // `aux` contra o canal do inversor de um truque, e contra a nota mais longa, que é a primeira (G3, com o torque ainda
  // subindo: 9 dB abaixo das outras). O tom é a potência do grupo f_c ± f_e (o par bate: numa nota só o nível depende da
  // fase da batida), em média de potência sobre as notas dos 4 primeiros segundos.
  {
    const t = portador('taurus', {}, { faces: 'uma', ladoOuvinte: -1 }) as Trem;
    t.comandar({ pedal: 0, ignicao: true, velocidadeFixa: 0 });
    const { L, R } = renderCena(t, { amb: { ...ambientePassagem('ceu'), solo: { tipo: 'nenhum' } as any, fundo: { vento: 0, ventilacao: 0, murmurio: 0 } }, traj: { lateral: 7.5, comprimento: 4000 }, ouv: { pos: [0, 0, 1.6], binaural: false }, dur: 14, s0: -t.corpo.comprimento / 2 + 12.5,
      eventos: [[10, () => t.comandar({ pedal: 0.63, velocidadeFixa: null })]] });
    const x = mono(L, R);
    const pts = patamares(rastrear(x, 10, 14, 150, 800)).filter((p) => NOTAS_TAURUS.some((n) => rel(p.f, n) <= 0.01));
    const nota = (p: { f: number; t: number; dur: number }) => { const [fw, P] = welch(x, Math.round(p.t * SR), Math.round((p.t + p.dur) * SR), 4096); return potFaixa(fw, P, p.f * 0.94, p.f * 1.06); };
    const lt = 10 * Math.log10((pts.length ? pts.reduce((a, p) => a + nota(p), 0) / pts.length : 1e-30) / 4e-10);
    const ls = [176, 527, 688].map((f) => nivelGrupo(x, 5, 10, f, 0.012) - lt);
    caso('Taurus parado: 176, 527, 688 Hz contra o tom em escada', '−8..−12 dB', `${ls.map((v) => sg(v)).join(' / ')} (no ouvido, a 7,5 m; tom ${f1(lt)} dB SPL em ${pts.length} notas)`, ls.every((v) => dentro(v, -12, -8)), ls, 'dB');
  }
  // CPTM 9500: razão das famílias e o SIV
  {
    const m = motor('cptm9500', LISO), p = preset('cptm9500');
    m.comandar({ acelerador: 0.6, ignicao: true, partida: false, omegaImposta: (60 / 3.6) * 6.3125 / 0.43 } as never);
    const r = renderMotor(m, 1.5), x = somaCanais(r, ['motor', 'reducao']);
    const fr = (m.telemetria() as any).fRot;
    const a = linha(x, 0.4, 1.5, 14 * fr, 18 * fr), b = linha(x, 0.4, 1.5, 33 * fr, 39 * fr);
    caso('CPTM 9500: razão entre as duas famílias', '2,24 ± 0,05', f1(b.f / a.f, 3), perto(b.f / a.f, 2.24, 0.05), b.f / a.f, '');
    const xa = canal(r, 'aux');
    const s1 = nivelEm(xa, 0.4, 1.5, 1333, 0.01).f, s2 = nivelEm(xa, 0.4, 1.5, 2666, 0.01).f, sb = nivelEm(xa, 0.4, 1.5, 1333 + 60, 0.01).f;
    caso('CPTM 9500: SIV', '1333 e 2666 Hz, laterais ±60 Hz', `${f1(s1)} / ${f1(s2)} Hz, lateral ${f1(sb - s1)} Hz`, rel(s1, 1333) <= 0.01 && rel(s2, 2666) <= 0.01 && perto(sb - s1, 60, 2), [s1, s2, sb - s1], 'Hz');
    void p;
  }
  // CPTM 9000: 1 : 1,44 : 2,45
  {
    const m = motor('cptm9000', LISO);
    m.comandar({ acelerador: 0.6, ignicao: true, partida: false, omegaImposta: (50 / 3.6) * 6.5 / 0.43 } as never);
    const r = renderMotor(m, 1.5), x = somaCanais(r, ['motor', 'reducao']), fr = (m.telemetria() as any).fRot;
    const a = linha(x, 0.4, 1.5, 16 * fr, 20 * fr).f, b = linha(x, 0.4, 1.5, 24 * fr, 28 * fr).f, c = linha(x, 0.4, 1.5, 42 * fr, 46 * fr).f;
    caso('CPTM 9000: razões das três ordens', '1 : 1,44 : 2,45 (±0,05)', `1 : ${f1(b / a, 3)} : ${f1(c / a, 3)}`, perto(b / a, 1.44, 0.05) && perto(c / a, 2.45, 0.05), [b / a, c / a], '');
  }
  // Leaf: famílias agudas e a linha máxima a 85 km/h (mediana de 3 sementes; T-ELE-03: com uma semente o detector pegava
  // outra linha, 9 215 Hz, e a razão caía para 1,305)
  {
    // o motor e a redução sozinhos (a gravação é de dentro: os pneus chegam pela casca, sem o agudo)
    const pl = preset('leaf'), iL = pl.reducao.estagios.reduce((a, s) => (a * s.Zc) / s.Zp, 1), rwL = (pl.portador as { rw: number }).rw;
    const ls = porSementes(() => {
      const m = motor('leaf');
      m.comandar({ acelerador: 1, ignicao: true, partida: false, omegaImposta: ((85 / 3.6) * iL) / rwL } as never);
      const rr = renderMotor(m, 1.5), r = somaCanais(rr, ['motor', 'reducao', 'inversor']);
      const fr = (m.telemetria() as any).fRot;
      // a família que sobe, fora da portadora fixa (9,8–10,2 kHz, que a gravação também tem, fraca): a linha mais forte a
      // ±1% de 96·f_rot, a tolerância do alvo (a janela de 8–11 kHz de antes deixava o detector pular para a lateral
      // f_c − 2f_e do inversor, a −1,4%)
      // a segunda família: a linha mais forte na janela de ordens do alvo (96/1,51 a 96/1,41, com 2% de folga: 62,3 a 69,4·f_rot).
      // A janela de 5,5–7,5 kHz deixava entrar 72·f_rot = 18·f_e, que com o relevo da carcaça passa as outras
      const top = linha(r, 0.4, 1.5, 96 * fr * 0.99, Math.min(9800, 96 * fr * 1.01)), seg = linha(r, 0.4, 1.5, (96 * fr) / 1.54, (96 * fr) / 1.383);
      return { f: top.f, fr, raz: top.f / seg.f };
    });
    const fTop = m3(ls.map((l) => l.f), 0), fr = mediana(ls.map((l) => l.fr)), raz = m3(ls.map((l) => l.raz), 3);
    caso('Leaf a 85 km/h: 96·f_rot', '9,5 kHz ±1%', `${fTop.txt} Hz (96·f_rot = ${f1(96 * fr, 0)})`, rel(fTop.m, 9500) <= 0.01 && rel(fTop.m, 96 * fr) <= 0.01, fTop.m, 'Hz');
    caso('Leaf: razão das duas famílias agudas', '1,46 ± 0,05', raz.txt, perto(raz.m, 1.46, 0.05), raz.m, '');
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
    caso('Tesla: portadora na cabine', '≈ 10 kHz, ≥ 40 dB abaixo do grave', `${f1(fpk, 0)} Hz, ${f1(d)} dB`, perto(fpk, 10000, 300) && d <= -40, [fpk, d], '');
  }
  // bonde IGBT: f_c fixa 2,0–2,5 kHz, 2f_c ≥ f_c
  {
    const m = motor('flexity', LISO);
    m.comandar({ acelerador: 0.6, ignicao: true, partida: false, omegaImposta: (20 / 3.6) * 6 / 0.3 } as never);
    const x = canal(renderMotor(m, 1.5), 'inversor');
    // a portadora soa como o par f_c ± f_e (e o leque das laterais): f_c é o centro de potência do grupo de 2,0–2,5 kHz, e
    // os níveis são os dos grupos inteiros (±8% de f_c e de 2f_c)
    const [fw, Pw] = welch(x, Math.round(0.4 * SR), Math.round(1.5 * SR), 8192);
    let sp = 0, sf = 0; for (let i = 0; i < fw.length; i++) if (fw[i] > 2000 && fw[i] < 2500) { sp += Pw[i]; sf += Pw[i] * fw[i]; }
    const fcM = sf / sp, g1 = 10 * Math.log10(potFaixa(fw, Pw, fcM * 0.92, fcM * 1.08)), g2 = 10 * Math.log10(potFaixa(fw, Pw, 2 * fcM * 0.92, 2 * fcM * 1.08));
    caso('bonde IGBT (Flexity): f_c fixa e 2f_c', '2,0–2,5 kHz, 2f_c ≥ f_c', `${f1(fcM, 0)} Hz, 2f_c ${sg(g2 - g1)} dB`, dentro(fcM, 2000, 2500) && g2 >= g1, [fcM, g2 - g1], '');
  }
  // furadeira sem fio
  {
    const fs3 = porSementes(() => {
      const m = motor('furadeira');
      m.comandar({ acelerador: 1, ignicao: true, partida: false } as never);
      const r = renderMotor(m, 3), x = r.soma, fr = (m.telemetria() as any).fRot;
      // (potência em ±1,5% de cada ordem, como no Mavic: a rotação de uma ferramenta de mão passeia e a k-ésima ordem
      // espalha k vezes mais; o pico de uma raia lia a ×12 até 8 dB abaixo)
      const L = [1, 2, 3, 5, 6, 8, 12, 24].map((o) => nivelGrupo(x, 1, 3, o * fr, 0.015)), mx = Math.max(...L);
      return { fr, d: [L[5] - mx, L[6] - mx, L[7] - L[6]], b: bandas(x, 1, 3).b };
    });
    const fr = mediana(fs3.map((f) => f.fr)), d = [0, 1, 2].map((k) => mediana(fs3.map((f) => f.d[k])));
    caso('furadeira sem fio: f_rot em vazio', '247,5 Hz ±1%', `${f1(fr, 1)} Hz`, rel(fr, 247.5) <= 0.01, fr, 'Hz');
    caso('furadeira sem fio: ×8 e ×12 contra o máximo; ×24 contra ×12', '≥ −3 / ≥ −3 / −10 ± 4 dB', `${sg(d[0])} / ${sg(d[1])} / ${sg(d[2])} dB`, d[0] >= -3 && d[1] >= -3 && perto(d[2], -10, 4), d, 'dB');
    bandasCaso('furadeira sem fio', fs3.map((f) => f.b), [-25.4, -23.5, 0, 4.9, 17.0, 16.7]);
  }
  // furadeira de rede (variante: universal, Z_c 10, 23 200 rpm; comutador de rede, que faísca mais: escovas 109 e
  // faiscamento 3, redução folgada. Até a etapa de som a banda era segurada pelo tom do ventilador em 10·f_rot)
  {
    const base = preset('furadeira');
    const rede = { ...base, id: 'furadeira-rede', Zc: 10, Zs: 10, rpmMax: 23500, rpmBase: 11750, Tn: 0.9, Pmax: 1100, escovas: { Zc: 10, desgaste: 0.8 }, linhasExtras: [[2, 0], [4, -2]] as [number, number][], faiscamento: 3, reducao: { estagios: [{ Zp: 9, Zc: 30 }, { Zp: 12, Zc: 27 }], eta: 0.8, folga: 1 }, niveis: { ...base.niveis, escovas: 109 } } as PresetEletrico;
    const m = motor(rede);
    m.comandar({ acelerador: 1, ignicao: true, partida: false } as never);
    const r = renderMotor(m, 3), x = r.soma, fr = (m.telemetria() as any).fRot;
    const a10 = nivelEm(x, 1, 3, 10 * fr, 0.005).f, a20 = nivelEm(x, 1, 3, 20 * fr, 0.005).f;
    caso('furadeira de rede: ×10 e ×20 de f_rot', '3870 e 7740 Hz ±1% (387 Hz)', `${f1(a10, 0)} e ${f1(a20, 0)} Hz (f_rot ${f1(fr, 1)})`, rel(a10, 3870) <= 0.01 && rel(a20, 7740) <= 0.01, [a10, a20], 'Hz');
    const bd = bandas(x, 1, 3);
    caso('furadeira de rede: banda 2,5–6 kHz', '+22,7 ± 4 dB', sg(bd.b[5]), perto(bd.b[5], 22.7, 4), bd.b[5], 'dB');
  }
  // Mavic e drone 2
  {
    const d = portador('mavic') as Multirrotor;
    d.comandar({ pedal: 0.5, ignicao: true });
    const x = renderPortador(d, 4), fr = d.motor!.eixo.omega / TAU, fb = 2 * fr;
    const bpf = nivelEm(x, 1.5, 4, 209, 0.01);
    caso('Mavic pairado: BPF (a dos rotores de detune 0 e +1%)', '209 Hz ±1%', `${f1(bpf.f, 1)} Hz (os 4: ${[0, 1, 2, 3].map((k) => f1(2 * fr * (1 + preset('mavic').helice!.detune[k]), 0)).join(', ')})`, rel(bpf.f, 209) <= 0.01, bpf.f, 'Hz');
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
    caso('Mavic: harmônicos 1–7 da BPF', 'tabela 3.6 ±3 dB', d0.map((v) => sg(v, 0)).join(' '), err.every((e) => Math.abs(e) <= 3), d0, 'dB');
    const l63 = pl(Pm, 63 * fr) - a[0];
    caso('Mavic: motor em 63·f_rot = 9·f_e contra a BPF', '−13 ± 4 dB', sg(l63), perto(l63, -13, 4), l63, 'dB');
    bandasCaso('Mavic pairado', porSementes(() => { const dd = portador('mavic') as Multirrotor; dd.comandar({ pedal: 0.5, ignicao: true }); return bandas(renderPortador(dd, 4), 1.5, 4).b; }), [-28.7, -16.6, 0, 0.8, 0.7, -2.3]);
    const dr2 = { ...preset('mavic'), id: 'drone2', rpmBase: 11460, rpmMax: 15000, Tn: 0.05, Pmax: 60, ordensEletricas: [[6, 0], [8, -3], [12, -14]] as [number, number][], helice: { ...preset('mavic').helice!, D: 0.13, harmonicos: [0, -12, -6, -11, -15, -16, -20, -24], largoDb: -6 } } as PresetEletrico;
    const d2 = new Multirrotor({ massa: 0.25, cQ: 0.012 }); d2.acoplar(motor(dr2)); semear(d2); d2.comandar({ pedal: 0.5, ignicao: true });
    const x2 = renderPortador(d2, 3), fr2 = d2.motor!.eixo.omega / TAU;
    const b2 = nivelEm(x2, 1, 3, 382, 0.01);
    // 6f_e: o centro de potência de 7,6–8,6 kHz (a linha, espalhada pelo passeio do ESC, e as laterais ±f_rot)
    const [f2, P2] = welch(x2, SR, 3 * SR, 16384);
    let sp = 0, sf = 0; for (let i = 0; i < f2.length; i++) if (f2[i] > 7600 && f2[i] < 8600) { sp += P2[i]; sf += P2[i] * f2[i]; }
    caso('drone 2: BPF e 6f_e', '382 Hz; 6f_e em 8,0–8,3 kHz', `${f1(b2.f, 1)} Hz; ${f1(sf / sp, 0)} Hz (42·f_rot ${f1(42 * fr2, 0)})`, rel(b2.f, 382) <= 0.01 && dentro(sf / sp, 8000, 8300), [b2.f, sf / sp], 'Hz');
  }
  // MP 73 (CC reostático): corcova 300 → 700 Hz com a velocidade, nenhuma linha fixa forte (mediana de 3 sementes: o
  // centro a toda a velocidade ia de 896 a 932 Hz com a semente, T-ELE-03)
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
    const c0 = m3(porSementes(() => centro(0.05)), 0), c1 = m3(porSementes(() => centro(1)), 0);
    caso('MP 73 (CC reostático): centro da corcova com a velocidade', '230–400 → 550–900 Hz (≈ 300 → 700 da gravação)', `${c0.txt} → ${c1.txt} Hz`, dentro(c0.m, 230, 400) && dentro(c1.m, 550, 900), [c0.m, c1.m], 'Hz');
  }
  // bandas de casos (±6 dB em 20–60 e 60–150 Hz, ±4 dB de 400 Hz a 6 kHz): Taurus no patamar (A) e CPTM 9500 parado, pela
  // Cena. O vetor de alvos estava deslocado uma casa (o −11,5 de 20–60 Hz caía em 60–150) e o grave não entrava no
  // critério (AUDITORIA T-ELE-05); mediana de 3 sementes (o 1–2,5k do Taurus e da CPTM mudava de estado, T-ELE-03)
  {
    const bs = porSementes(() => {
      const t = portador('taurus', {}, { faces: 'uma', ladoOuvinte: -1 }) as Trem;
      t.comandar({ pedal: 0.63, ignicao: true, velocidadeFixa: 12 / 3.6 });
      const { L, R } = renderCena(t, { amb: ambientePassagem('estacao'), traj: { lateral: 4, comprimento: 4000 }, ouv: { pos: [0, 0, 1.6], binaural: false }, dur: 6, s0: -t.corpo.comprimento / 2 + 2 });
      return bandas(mono(L, R), 2, 6);
    });
    bandasCaso('Taurus no patamar (A, estação, 4 m)', bs.map((b) => b.b), [-11.5, -1.8, 0, 3.2, -2.0, -12.4]);
    const ce = m3(bs.map((b) => b.centroide), 0);
    caso('Taurus no patamar: centroide', '622 Hz ±25%', `${ce.txt} Hz`, rel(ce.m, 622) <= 0.25, ce.m, 'Hz');
  }
  {
    const bs = porSementes(() => {
      const t = portador('cptm9500', {}, { faces: 'uma', ladoOuvinte: -1 }) as Trem;
      t.comandar({ pedal: 0, ignicao: true, velocidadeFixa: 0 });
      // de dentro do carro (as gravações da CPTM são de dentro)
      const { L, R } = renderCena(t, { amb: ambientePassagem('ceu'), traj: { lateral: 3, comprimento: 4000 }, ouv: { modo: 'gimbal', gimbal: { az: 0, el: 0, r: 0.5, alvo: 'corpo' }, local: 'cabine', binaural: false }, dur: 5, s0: 0 });
      return bandas(mono(L, R), 2, 5).b;
    });
    bandasCaso('CPTM 9500 parado (de dentro)', bs, [-5.5, -1.3, 0, 0.9, -4.3, -18.7]);
  }
}

/** um caso de bandas da tabela 3.7: as cinco bandas (20–60 e 60–150 a ±6 dB; 400–1k, 1–2,5k, 2,5–6k a ±4 dB), mediana
 *  das sementes banda a banda; `alvo` na ordem de BANDAS (20–60, 60–150, 150–400 = 0, 400–1k, 1–2,5k, 2,5–6k) */
function bandasCaso(nome: string, bs: number[][], alvo: number[]) {
  const K = [0, 1, 3, 4, 5], tol = [6, 6, 4, 4, 4];
  const b = K.map((k) => mediana(bs.map((x) => x[k])));
  const erro = b.map((v, i) => Math.abs(v - alvo[K[i]]) - tol[i]);
  caso(`${nome}: bandas 20–60 / 60–150 / 400–1k / 1–2,5k / 2,5–6k`, `${K.map((k) => sg(alvo[k])).join(' / ')} (±6 / ±6 / ±4 / ±4 / ±4 dB)`, `${b.map((v) => sg(v)).join(' / ')} (6–12k ${sg(mediana(bs.map((x) => x[6])))}; ${bs.length} sementes)`, erro.every((e) => e <= 0), b, 'dB');
}

// =============================================================================================== 11. Passagem e Cena
function gCena() {
  // Taurus a 7,5 m na estação: o tom do inversor acima do fundo do ambiente (mediana de 3 sementes: o patamar mais longo
  // da escada entre 3 e 7 s muda com a semente, 247 ou 294 Hz, e a diferença ia de +12,4 a +13,7 dB)
  {
    // fundo: o ambiente da estação sozinho (sem trem): o murmúrio, dB SPL sem ponderação
    const d = new CenaDSP(SR); d.cru = true; d.message({ type: 'cena', amb: ambientePassagem('estacao'), traj: { tipo: 'reta', comprimento: 4000, raioCurva: 2000, lateral: 6, altitude: 0, sentido: 1 }, ouv: { modo: 'fixo', pos: [0, 0, 1.6], gimbal: { az: 90, el: 0, r: 5, alvo: 'corpo' }, local: 'fora', binaural: false } });
    const vazio = new Trem(SR, { N: 1, faces: 'uma' }); vazio.comandar({ pedal: 0, velocidadeFixa: 0 }); d.montar(vazio);
    const B = 128, l = new Float32Array(B), r = new Float32Array(B), sl = new Float32Array(B), sr = new Float32Array(B), fundo = new Float32Array(2 * SR);
    for (let k = 0; k < 2 * SR; k += B) { d.process(l, r, B, sl, sr); for (let j = 0; j < B; j++) fundo[k + j] = 0.5 * (l[j] + r[j]) * PA_FS; }
    const [f2, P2] = welch(fundo, SR / 2, 2 * SR, 8192);
    const fundoDb = 10 * Math.log10(potFaixa(f2, P2, 20, 20000) / 4e-10);
    // o tom: o patamar da escada mais longo entre 3 e 7 s (as notas a ±1%), a linha em dB SPL no próprio trecho
    const ts = porSementes(() => {
      const t = portador('taurus', {}, { faces: 'uma', ladoOuvinte: -1 }) as Trem;
      t.comandar({ pedal: 0.63, ignicao: true, velocidadeFixa: 0 });
      const { L, R } = renderCena(t, { amb: ambientePassagem('estacao'), traj: { lateral: 7.5 - 1.5, comprimento: 4000 }, ouv: { pos: [0, 0, 1.6], binaural: false }, dur: 7, s0: -t.corpo.comprimento / 2 + 5, eventos: [[3, () => t.comandar({ pedal: 0.63, velocidadeFixa: null })]] });
      const x = mono(L, R);
      const pts = patamares(rastrear(x, 3, 7, 150, 800)).filter((p) => NOTAS_TAURUS.some((n) => rel(p.f, n) <= 0.01)).sort((a, b) => b.dur - a.dur);
      const pt = pts[0] ?? { f: 300, t: 4.2, dur: 0.5 }, ft = pt.f;
      const [f, P] = welch(x, Math.round(pt.t * SR), Math.round((pt.t + pt.dur) * SR), 8192);
      let pk = 0; for (let i = 0; i < f.length; i++) if (Math.abs(f[i] - ft) < 4) pk = Math.max(pk, P[i]);
      return { ft, tomDb: 10 * Math.log10(pk * (f[1] - f[0]) * 1.5 / 4e-10) };
    });
    const dt = m3(ts.map((q) => q.tomDb - fundoDb));
    caso('Taurus a 7,5 m arrancando: tom do inversor acima do fundo da estação', '10 ± 3 dB', `${dt.txt} dB (tons ${fmtSementes(ts.map((q) => q.ft), 0)} Hz, fundo ${f1(fundoDb)} dB SPL)`, perto(dt.m, 10, 3), dt.m, 'dB');
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
    caso('Tesla a 6 m e 30 km/h (AVAS UE desliga a 20; pneus): L_AFmax', '62 ± 3 dB(A)', `${f1(n30)} dB(A)`, perto(n30, 62, 3), n30, 'dB');
    const tot = passa(100, 0.25, false, false), mot = passa(100, 0.25, true, false);
    caso('Tesla a 100 km/h: trem de força contra o total', '≤ −8 dB', `${sg(mot - tot)} dB (total ${f1(tot)} dB(A))`, mot - tot <= -8, mot - tot, 'dB');
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
    caso(`Passagem: "${nome}" monta pela mensagem e soa`, 'sem NaN, motor ligado', `${d.portador!.fontes().length} fontes, ${f1(nivel)} dB, ${f1(t.rpm ?? 0, 0)} rpm, v ${f1(d.portador!.cinematica.v * 3.6)} km/h, modo ${t.modo}`, nan === 0 && (t.rpm ?? 0) > 0 && nivel > 20, nivel, 'dB');
  }
}

// (CPU e coletas de lixo: tools/eletrico/cpu.ts, `npm run cpu:eletrico`)

// ---------------------------------------------------------------------------------------------- execução
const GRUPOS: Record<string, () => void> = { linhas: gLinhas, maquina: gMaquina, magneticas: gMagneticas, inversor: gInversor, modos: gModos, mecanica: gMecanica, avas: gAvas, niveis: gNiveis, auxiliares: gAuxiliares, portadores: gPortadores, 'alvos-3.7': gAlvos37, cena: gCena, passagem: gPassagem };
const op = lerOpcoes(process.argv.slice(2));
iniciarSementes(op.semente);
const rodar = op.resto.length ? op.resto : Object.keys(GRUPOS);
for (const g of rodar) {
  if (!GRUPOS[g]) { console.error(`grupo desconhecido: ${g} (${Object.keys(GRUPOS).join(' ')}; a CPU está em npm run cpu:eletrico)`); process.exit(2); }
  grupoAtual = g;
  const t0 = performance.now();
  try { GRUPOS[g](); } catch (e) { caso(`${g}: exceção`, '—', String((e as Error).stack || e).slice(0, 400), false); }
  console.error(`(${g}: ${f1((performance.now() - t0) / 1000, 1)} s)`);
}
const r = avaliarDesvios(RETRATO, linhas, { atualizar: op.atualizar, grupos: rodar });
imprimirAvaliacao(r, { motivo: true, cabecalhoGrupo: true });
process.exit(r.contagem.falha ? 1 : 0);
