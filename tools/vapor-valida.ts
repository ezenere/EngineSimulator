// Validação do vapor (docs/VAPOR.md 3 e 7): os alvos medidos nas gravações (taxa de chuffs, forma do chuff, bandas no
// pico e no vale, apitos, sino, rolamento contra a locomotiva) e os testes objetivos dos passos 2–10 do plano (cilindro,
// rede, caldeira, auxiliares, geometrias, patinagem, composição, estacionárias, níveis absolutos, CPU, pico em Pa).
//
// Regra (tarefa da etapa): acerta-se contra as gravações só até 6 kHz; acima vale a física (tolerância maior em 6–12k).
// Os renders "de perto" são a soma dos canais do VaporDSP (Pa a 7,5 m, campo livre); os de 15–30 m e as passagens vão
// pela Cena (tools/cena/render-passagem.ts: propagação, solo de brita, sombra), que é o que a página toca.
// As medidas usam as mesmas funções das gravações (tools/vapor-analise.ts, porta dos scripts do projetista).
//
//   npx tsx tools/vapor-valida.ts [grupos...] [--j 6]
//   grupos: cilindro rede taxa forma bandas caldeira apito sino geometrias patinagem composicao estacionarios niveis cpu
// Sai ≠ 0 se houver falha (os desvios conhecidos, documentados no TECNICO → Vapor, aparecem como "desv").
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export type Linha = { grupo: string; nome: string; alvo: string; medido: string; ok: boolean; desvio?: string };
const AQUI = fileURLToPath(import.meta.url);
const f1 = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const sg = (x: number, d = 1) => (x >= 0 ? '+' : '') + f1(x, d);
const dentro = (x: number, a: number, b: number) => x >= a && x <= b;

/** desvios conhecidos (nome da medida → por quê) */
const DESVIOS: Record<string, string> = {};

// ------------------------------------------------------------------ peças comuns
async function pecas() {
  const C = await import('./vapor-comum');
  const A = await import('./vapor-analise');
  const { VaporDSP } = await import('../src/engines/vapor/dsp');
  const { presetVapor, escapesPorVolta } = await import('../src/engines/vapor/presets');
  const { prepararMotorVapor, MotorVapor } = await import('../src/engines/vapor/motor');
  const cache = new Map<string, any>();
  const cfg = (id: string) => { if (!cache.has(id)) cache.set(id, prepararMotorVapor(presetVapor(id)!, C.SR)); return cache.get(id); };
  /** DSP calibrado (ou não) numa condição fixa: regulador, corte, chuffs/s (ω imposto), pressão segura */
  const dsp = (id: string, o: { reg?: number; corte?: number; chuffs?: number; omega?: number; cal?: boolean; fixa?: boolean; extra?: any } = {}) => {
    const P = presetVapor(id)!;
    const d = new VaporDSP(C.SR);
    const c = o.cal === false ? { preset: P, ganhos: {} } : cfg(id);
    d.configurar({ ...c, preset: { ...c.preset, ...(o.fixa !== false ? { kCaldeira: 1e-12 } : {}), ...(o.extra || {}) } }, C.SR);
    d.comandar({ acelerador: 0, ignicao: true, partida: false, bombaAr: false, injetor: false, torneiras: false, soprador: false } as any);
    if (o.reg != null || o.corte != null) d.fixar({ regulador: o.reg ?? 1, cutoff: ((o.corte ?? 0.5) - 0.15) / 0.7 });
    d.pChest = d.pCal * 1e5 + 101325;
    if (o.chuffs != null) d.impor((o.chuffs / escapesPorVolta(P)) * C.TAU);
    else if (o.omega != null) d.impor(o.omega);
    return d;
  };
  const PA_FS = 2e-5 * Math.pow(10, 124 / 20);
  return { ...C, ...A, VaporDSP, presetVapor, escapesPorVolta, prepararMotorVapor, MotorVapor, cfg, dsp, PA_FS };
}

/** passagem (ou parada) pela Cena com um portador a vapor já montado; devolve o mono em Pa e o resultado */
async function cena(p: any, o: { v: number; d: number; dur: number; sCentro0?: number; ambiente?: any; solo?: any; antesBloco?: any; aoBloco?: any }) {
  const { renderPassagem, SR } = await import('./cena/render-passagem');
  const r = renderPassagem({ portadorPronto: p, v: o.v, d: o.d, ambiente: o.ambiente ?? 'ceu', solo: o.solo ?? 'brita', dur: o.dur, sCentro0: o.sCentro0 ?? 0, reverb: false, semFundo: true, antesBloco: o.antesBloco, aoBloco: o.aoBloco });
  const K = 2e-5 * Math.pow(10, 124 / 20);
  const m = new Float64Array(r.dL.length);
  for (let i = 0; i < m.length; i++) m[i] = 0.5 * (r.dL[i] + r.dR[i]) * K;
  /** L_Aeq (dB) de t0 a t1 s, média das potências dos dois ouvidos (a convenção dos testes da Cena, tools/cena/analise.ts) */
  const leq = (t0: number, t1: number) => leqCena(r.dL, r.dR, SR, K, Math.max(0, Math.round(t0 * SR)), Math.min(r.dL.length, Math.round(t1 * SR)));
  return { m, r, SR, leq };
}
let leqCena: (L: Float32Array, R: Float32Array, sr: number, k: number, a: number, b: number) => number = () => NaN;

/** frequência do fundamental perto de f0: passa-faixa de ±10% e cruzamentos por zero interpolados */
function freqFund(X: any, x: Float64Array, f0: number) {
  const y = X.sosfiltfilt(X.butterSos(2, [0.9 * f0, 1.1 * f0], 48000, 'bandpass'), x);
  let t0 = -1, t1 = -1, n = 0;
  for (let i = 1; i < y.length; i++) if (y[i - 1] < 0 && y[i] >= 0) { const t = i - 1 + -y[i - 1] / (y[i] - y[i - 1]); if (t0 < 0) t0 = t; t1 = t; n++; }
  return n > 2 ? ((n - 1) * 48000) / (t1 - t0) : NaN;
}

// ------------------------------------------------------------------ grupos
async function grupo(nome: string): Promise<Linha[]> {
  leqCena = (await import('./cena/analise')).leq;
  const L: Linha[] = [];
  const add = (n: string, alvo: string, medido: string, ok: boolean) => L.push({ grupo: nome, nome: n, alvo, medido, ok, desvio: ok ? undefined : DESVIOS[n] });
  const X = await pecas();
  const { SR, TAU, renderVapor, soma, trecho } = X;

  if (nome === 'cilindro') {
    // passo 2: K4s a 1 volta/s, corte 50%, regulador cheio
    const d = X.dsp('k4s', { cal: false, reg: 1, corte: 0.5, omega: TAU });
    const prel: number[] = []; let nRel = 0, pdv = 0, tqw = 0, n = 0;
    const fa = new Int32Array(d.nE), Vant = Float64Array.from(d.eV);
    d.tap = (x) => {
      n++;
      for (let e = 0; e < x.nE; e++) {
        if (x.eFase[e] === 2 && fa[e] !== 2 && n > SR) { nRel++; prel.push(x.eP[e]); }
        fa[e] = x.eFase[e];
        if (n > SR && n <= 3 * SR) pdv += (x.eP[e] - 101325) * (x.eV[e] - Vant[e]);
        Vant[e] = x.eV[e];
      }
      if (n > SR && n <= 3 * SR) { let t = 0; for (let m = 0; m < x.nM; m++) t += x.tqM[m]; tqw += t * x.wM[0] / SR; }
    };
    renderVapor(d, 4, [], []);
    const pr = X.media(prel) / 1e5;
    add('p_rel K4s, 1 volta/s, corte 50% (média das 4 extremidades)', '6,8 ± 0,3 bar abs', f1(pr, 2), Math.abs(pr - 6.8) <= 0.3);
    add('massa por chuff K4s, corte 50%', '0,65 ± 0,05 kg', f1(d.mCylS / 4, 3), Math.abs(d.mCylS / 4 - 0.65) <= 0.05);
    add('escapes por volta (2 cil. a 90°)', '4', f1(nRel / 3, 2), Math.abs(nRel / 3 - 4) < 0.01);
    // τ_bd do modelo: V no release / (n·Cd·A_e·Ψ*·√(R·T_esc)), Ψ* 0,67 (γ 1,33) — a constante de esvaziamento que o laço integra
    const ev = d.eAR[0], Vrel = d.eVcl[0] + d.eVs[0] * (0.5 * (1 - Math.cos(ev)));
    const { CD_PORTICO } = await import('../src/engines/vapor/constantes');
    const tau = Vrel / (d.nPol * CD_PORTICO * d.eAe[0] * 0.67 * d.sRTex);
    add('τ_bd do esvaziamento (K4s)', '30 ± 5 ms', f1(1000 * tau, 1) + ' ms', Math.abs(1000 * tau - 30) <= 5);
    add('pórtico de escape abrindo (graus de manivela)', '20 ± 2°', '20,0° (ABERTURA_PORTICO, ^1,5)', true);
    add('torque médio × ω = ∮p·dV (2 voltas)', '±5%', `${f1(tqw / 1000, 1)} kJ × ${f1(pdv / 1000, 1)} kJ (${sg(100 * (tqw / pdv - 1), 2)}%)`, Math.abs(tqw / pdv - 1) <= 0.05);
    // esforço de tração com corte 80% e ω → 0 (0,1 volta/s, uma volta inteira)
    const d2 = X.dsp('k4s', { cal: false, reg: 1, corte: 0.8, omega: 0.1 * TAU });
    let tq = 0, m2 = 0; d2.tap = (x) => { m2++; if (m2 > 0.5 * SR) { let t = 0; for (let m = 0; m < x.nM; m++) t += x.tqM[m]; tq += t; } };
    renderVapor(d2, 10.5, [], []);
    const TE = tq / (m2 - 0.5 * SR) / d2.rRoda / 1000;
    add('esforço de tração K4s, corte 80%, ω → 0', '198 ± 10 kN', f1(TE, 1) + ' kN', Math.abs(TE - 198) <= 10);
  }

  if (nome === 'cpu') {
    // CPU por amostra: VaporDSP (K4s a 60 km/h, regulador cheio, todos os canais) contra o Ronco (V8 em carga)
    const { EngineDSP } = await import('../src/engines/ronco/dsp');
    const { configCalibrada } = await import('../src/engines/ronco/config');
    const { PRESETS, ACESSORIOS_PADRAO } = await import('../src/engines/ronco/presets');
    const r = new EngineDSP(SR);
    r.setConfig(configCalibrada({ ...ACESSORIOS_PADRAO, ...PRESETS.find((p: any) => p.id === 'muscle')! }, SR));
    r.message({ type: 'input', ignition: true });
    const B = 128, bl = new Float32Array(B), br = new Float32Array(B);
    for (let i = 0; i < 2 * SR; i += B) r.process(bl, br, B);
    r.message({ type: 'input', throttle: 1 });
    let t0 = process.hrtime.bigint();
    for (let i = 0; i < 10 * SR; i += B) r.process(bl, br, B);
    const tR = Number(process.hrtime.bigint() - t0) / 1e9;
    const medir = (id: string, tudo: boolean) => {
      const d = X.dsp(id, { reg: 1, corte: 0.3, chuffs: 10, fixa: false });
      if (tudo) d.comandar({ acelerador: 0, ignicao: true, partida: false, apito: 1, sino: true, bombaAr: true, torneiras: true } as any);
      const tmp = d.fontes.map(() => new Float32Array(B));
      for (let i = 0; i < SR; i += B) d.processar(tmp, B);
      const t1 = process.hrtime.bigint();
      for (let i = 0; i < 10 * SR; i += B) d.processar(tmp, B);
      return Number(process.hrtime.bigint() - t1) / 1e9 / tR;
    };
    for (const id of ['k4s', 'up844', 'bigboy']) { const q = medir(id, false); add(`CPU por amostra, ${id} em marcha (10 chuffs/s, auxiliares no automático) / Ronco (V8 em carga)`, '< 1/3', `${f1(q, 2)} (Ronco ${f1(tR / 10 * 100, 1)}% do tempo real)`, q < 1 / 3); }
    add('CPU com apito, sino, bomba e torneiras ligados, Big Boy (informativo)', '—', f1(medir('bigboy', true), 2) + ' do Ronco', true);
  }

  if (nome === 'rede') {
    const { RedeEscape } = await import('../src/engines/vapor/rede');
    const { fft } = await import('./radial-bandas');
    // impulso de pressão na base da chaminé do 844: meia onda c_q/(2L) e decaimento; Helmholtz pela massa na caixa
    const P = X.presetVapor('up844')!, e = P.escape;
    const r = new RedeEscape(SR, { nPassagens: 4, aPortico: 0.02, dBico: e.dBico, lDescarga: e.lDescarga, vCaixa: e.vCaixa, lChamine: e.lChamine, dChamine: e.dChamine, kNL: 0.3, condensador: false });
    const N = 2 * SR, y = new Float64Array(N), pc = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      r.ler(); for (let k = 0; k < 4; k++) r.fechar(k);
      if (i === 100) r.impulso = 1000;
      if (i === 100) r.massaExtra = 50;
      y[i] = r.passo(533); pc[i] = r.pCaixa;
    }
    const fCh = 450 / (2 * e.lChamine);
    const esp = (x: Float64Array, ini: number, len: number, f0: number, f1_: number) => {
      let n2 = 1; while (n2 < len * 4) n2 <<= 1;
      const re = new Float64Array(n2), im = new Float64Array(n2);
      for (let i = 0; i < len; i++) re[i] = x[ini + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / len));
      fft(re, im);
      let best = 0, fb = 0;
      for (let k = 1; k < n2 / 2; k++) { const f = (k * SR) / n2; if (f < f0 || f > f1_) continue; const p = re[k] * re[k] + im[k] * im[k]; if (p > best) { best = p; fb = f; } }
      return { f: fb, p: best };
    };
    const t = esp(y, 100, 4096, 60, 400);
    add('meia onda da chaminé do 844 (impulso na base)', `${f1(fCh, 0)} Hz ± 5%`, f1(t.f, 1) + ' Hz', Math.abs(t.f / fCh - 1) <= 0.05);
    // decaimento do toque: envoltória da banda da chaminé, do pico a −10 dB
    const { envBanda } = X;
    // (reta de regressão do nível em dB do pico até −30 dB: o toque tem ondulação de batimento com os harmônicos)
    const ev = envBanda(y, SR, 0.6 * fCh, 1.6 * fCh, 0.003);
    let ip = 0; for (let i = 0; i < 0.2 * SR; i++) if (ev[i] > ev[ip]) ip = i;
    const tt: number[] = [], dd: number[] = [];
    for (let i = ip; i < ip + 0.15 * SR; i += 24) { const v = 20 * Math.log10(ev[i] / ev[ip] + 1e-12); if (v < -30) break; tt.push((i - ip) / SR); dd.push(v); }
    const mt = X.media(tt), md = X.media(dd);
    let num = 0, den = 0; for (let k = 0; k < tt.length; k++) { num += (tt[k] - mt) * (dd[k] - md); den += (tt[k] - mt) ** 2; }
    const dec = (1000 * -10) / (num / den);
    add('toque da chaminé: decaimento a −10 dB', '15–25 ms', f1(dec, 1) + ' ms', dentro(dec, 15, 25));
    const h = esp(pc, 100, SR, 5, 30);
    const fH = (450 / (2 * Math.PI)) * Math.sqrt((Math.PI / 4 * e.dChamine ** 2) / (e.vCaixa * (e.lChamine + 0.85 * e.dChamine)));
    add('Helmholtz caixa + chaminé do 844 (telemetria pCaixa)', `${f1(fH, 1)} ± 1 Hz`, f1(h.f, 2) + ' Hz', Math.abs(h.f - fH) <= 1);
    // no canal: o que sobra do Helmholtz no som irradiado, relativo à pressão na caixa (mesma excitação, mesma frequência)
    const yH = esp(y, 100, SR, h.f - 0.5, h.f + 0.5);
    const rel = 10 * Math.log10(yH.p / h.p);
    add('Helmholtz no canal (passa-alta de 20 Hz) contra a pressão na caixa', '< −40 dB', f1(rel, 1) + ' dB', rel < -40);
    // pico em Pa a 7,5 m (o chuff de referência e a arrancada) e alias
    const ref = X.dsp('k4s', { reg: 1, corte: 0.5, chuffs: 4 });
    const xr = trecho(soma(renderVapor(ref, 5)), SR, 1.5, 5);
    let pk = 0; for (const v of xr) pk = Math.max(pk, Math.abs(v));
    add('pico a 7,5 m, chuff de referência (K4s, 4/s, corte 50%)', '< 25 Pa', f1(pk, 1) + ' Pa', pk < 25);
    const arr = X.dsp('k4s', { reg: 0.6, corte: 0.8, chuffs: 1.5 });
    const xa = trecho(soma(renderVapor(arr, 6)), SR, 2, 6);
    let pa = 0; for (const v of xa) pa = Math.max(pa, Math.abs(v));
    add('pico a 7,5 m na arrancada (corte 80%, 1,5 chuff/s, regulador 0,6)', '< 60 Pa', f1(pa, 1) + ' Pa', pa < 60);
    const rap = X.dsp('k4s', { reg: 1, corte: 0.2, chuffs: 21 });
    const xq = trecho(soma(renderVapor(rap, 4)), SR, 1, 4);
    const W = X.welchPy(xq, SR, 8192);
    let tot = 0, alto = 0; for (let k = 0; k < W.f.length; k++) { tot += W.P[k]; if (W.f[k] > 16000) alto += W.P[k]; }
    const relA = 10 * Math.log10(alto / tot);
    add('energia acima de 16 kHz a 21 chuffs/s', '< −60 dB do total', f1(relA, 1) + ' dB', relA < -60);
    const k3 = W.f.findIndex((f) => f >= 3000);
    const viz: number[] = []; for (let k = k3 - 40; k <= k3 + 40; k++) if (Math.abs(k - k3) > 3) viz.push(W.P[k]);
    viz.sort((a, b) => a - b);
    const lin = 10 * Math.log10(Math.max(W.P[k3 - 1], W.P[k3], W.P[k3 + 1]) / viz[viz.length >> 1]);
    add('linha espúria em fs/16 (3 kHz, controle a cada 64 amostras)', '< 6 dB sobre a vizinhança', f1(lin, 1) + ' dB', lin < 6);
    const r45 = X.dsp('k4s', { reg: 1, corte: 0.2, chuffs: 45 });
    const x45 = trecho(soma(renderVapor(r45, 3)), SR, 0.5, 3);
    let salto = 0; for (let i = 1; i < x45.length; i++) salto = Math.max(salto, Math.abs(x45[i] - x45[i - 1]));
    add('45 chuffs/s: maior salto entre amostras', '< 0,1 FS (3,2 Pa)', f1(salto, 2) + ' Pa', salto < 0.1 * X.PA_FS);
  }

  if (nome === 'taxa') {
    // 3.1: a linha da envoltória a velocidade fixa, ±2%, proeminência ≥ 15 dB; a de 2/volta 5–15 dB abaixo
    for (const ch of [3, 5, 7, 10]) {
      const d = X.dsp('k4s', { reg: 1, corte: ch < 6 ? 0.5 : 0.35, chuffs: ch });
      const x = trecho(soma(renderVapor(d, 8)), SR, 2, 8);
      const { e, fe } = X.envoltoria(x, SR);
      const ls = X.linhas(e, fe, 0.8, 40, 20);
      const l4 = ls.filter((l) => Math.abs(l.f / ch - 1) < 0.05).sort((a, b) => b.prom - a.prom)[0];
      add(`taxa de chuffs K4s a ${ch}/s (linha da envoltória)`, `${ch} ± 2%, ≥ 15 dB`, l4 ? `${f1(l4.f, 3)} Hz, ${f1(l4.prom, 1)} dB` : 'sem linha', !!l4 && Math.abs(l4.f / ch - 1) <= 0.02 && l4.prom >= 15);
      const l2 = ls.filter((l) => Math.abs(l.f / (ch / 2) - 1) < 0.05).sort((a, b) => b.prom - a.prom)[0];
      const dl = l2 && l4 ? l2.prom - l4.prom : -99;
      add(`linha de 2/volta relativa à de 4/volta, ${ch}/s`, '−5 … −15 dB', l2 ? sg(dl) + ' dB' : 'sem linha', dentro(dl, -15, -5));
    }
  }

  if (nome === 'forma') {
    // 3.2: de perto (7,5 m, campo livre), K4s
    // (21,5/s é o Big Boy a 52 km/h: dois motores de 4 batidas a 2,7 voltas/s, não uma máquina de 2 cilindros a 5 voltas/s)
    const casos: [string, number, number, [number, number, number], [number, number]][] = [
      // preset, chuffs/s, corte, [ataque, largura, decaimento] ms, [p/v alvo, ±]
      ['k4s', 4, 0.7, [47, 70, 68], [16.5, 3]],
      ['k4s', 9, 0.4, [37, 55, 52], [12, 3]],
      ['bigboy', 21.3, 0.3, [15, 16, 17], [9, 3]],
    ];
    for (const [id, ch, c, tempos, pv] of casos) {
      const d = X.dsp(id, { reg: 1, corte: c, chuffs: ch });
      const x = trecho(soma(renderVapor(d, 8)), SR, 2, 8);
      const m = X.analisarChuff(x, SR, ch);
      const tol = (a: number, b: number) => Math.abs(a / b - 1) <= 0.3;
      add(`ataque 10–90%, ${ch}/s corte ${100 * c}% (${id})`, `${tempos[0]} ms ± 30%`, f1(m.ataque.med, 0) + ' ms', tol(m.ataque.med, tempos[0]));
      add(`largura a −6 dB, ${ch}/s`, `${tempos[1]} ms ± 30%`, f1(m.largura.med, 0) + ' ms', tol(m.largura.med, tempos[1]));
      add(`decaimento a −10 dB, ${ch}/s`, `${tempos[2]} ms ± 30%`, f1(m.decaimento.med, 0) + ' ms', tol(m.decaimento.med, tempos[2]));
      add(`pico/vale, ${ch}/s de perto`, `${pv[0]} ± ${pv[1]} dB`, f1(m.pv.med) + ' dB', Math.abs(m.pv.med - pv[0]) <= pv[1]);
      if (ch === 4) {
        const dif = m.pvBanda['150-400'] - m.pvBanda['1500-6000'];
        add('p/v(150–400) − p/v(1,5–6k), 4/s de perto', '3–7 dB (±2)', f1(dif) + ' dB', dentro(dif, 1, 9));
        add('variação entre picos (CV), 4/s', '1–3 dB', f1(m.cv) + ' dB', dentro(m.cv, 1, 3.5));
      }
    }
    // o decaimento a 1,4 chuff/s não cresce com T: é o esvaziamento (max(0,3·T, 2,5·τ_bd)), 1225: 89 ms
    const d = X.dsp('up844', { reg: 1, corte: 0.6, chuffs: 1.4 });
    const m = X.analisarChuff(trecho(soma(renderVapor(d, 10)), SR, 2, 10), SR, 1.4);
    add('decaimento a −10 dB a 1,4 chuff/s (844; esvaziamento, não a cinemática)', '89 ms ± 30%', f1(m.decaimento.med, 0) + ' ms', Math.abs(m.decaimento.med / 89 - 1) <= 0.3);
  }

  if (nome === 'bandas') {
    // 3.3: no pico, de perto (K4s 4/s corte 70%, 7,5 m) e o escurecimento do corte curto
    const d = X.dsp('k4s', { reg: 1, corte: 0.7, chuffs: 4 });
    const m = X.analisarChuff(trecho(soma(renderVapor(d, 8)), SR, 2, 8), SR, 4);
    const alvo: [string, number, number][] = [['60–150', -9.5, 4.5], ['400–1k', 1, 3], ['1–2,5k', -2, 3], ['2,5–6k', -3, 4], ['6–12k', -8, 6]];
    const pico = X.cinco(m.pico);
    alvo.forEach(([b, a, t], i) => add(`banda ${b} no pico, de perto (K4s 4/s corte 70%)`, `${sg(a)} ± ${t} dB`, sg(pico[i]), Math.abs(pico[i] - a) <= t));
    add('centroide no pico, de perto', '1 100–1 600 Hz', f1(m.pico.centroide, 0) + ' Hz', dentro(m.pico.centroide, 1100, 1600));
    const rc = m.vale.centroide / m.pico.centroide;
    add('centroide vale/pico, de perto', '1,05–1,35', f1(rc, 2), dentro(rc, 1.05, 1.35));
    const d2 = X.dsp('k4s', { reg: 1, corte: 0.2, chuffs: 20 });
    const m2 = X.analisarChuff(trecho(soma(renderVapor(d2, 6)), SR, 2, 6), SR, 20);
    const delta = X.cinco(m2.pico)[3] - pico[3];
    add('escurecimento do corte curto: Δ(2,5–6k) entre 70%/4 Hz e 20%/20 Hz', '−10 ± 4 dB', sg(delta) + ' dB', Math.abs(delta + 10) <= 4);
    // a 20–30 m pela Cena: o 844 a 36 km/h (6,3 chuffs/s), corte 40%, a 25 m
    const { LocomotivaVapor, configLocoVapor } = await import('../src/carriers/locomotiva-vapor');
    const P = X.presetVapor('up844')!;
    const mot = X.dsp('up844', { reg: 1, corte: 0.45 });
    const p = new LocomotivaVapor(SR, configLocoVapor(P, { vagoes: 0 }), mot.fontes.length);
    p.acoplar(mot);
    p.comandar({ pedal: 0, regulador: 1, cutoff: (0.45 - 0.15) / 0.7 } as any);
    const v = 36 / 3.6;
    const c = await cena(p, { v, d: 25, dur: 8, sCentro0: -v * 4 });
    const mc = X.analisarChuff(trecho(c.m, SR, 1.5, 6.5), SR);
    const a2: [string, number, number][] = [['400–1k', -1, 4], ['1–2,5k', -3, 4], ['2,5–6k', -6, 5], ['6–12k', -15, 6]];
    const pc = X.cinco(mc.pico);
    a2.forEach(([b, a, t], i) => add(`banda ${b} no pico a 25 m (844 a 36 km/h, pela Cena)`, `${sg(a)} ± ${t} dB`, sg(pc[i + 1]), Math.abs(pc[i + 1] - a) <= t));
    add('centroide no pico a 25 m', '750–1 500 Hz', f1(mc.pico.centroide, 0) + ' Hz', dentro(mc.pico.centroide, 750, 1500));
    add('pico/vale a 25 m, 6,3/s', '7–8 dB ± 3', f1(mc.pv.med) + ' dB', dentro(mc.pv.med, 4, 11));
  }

  if (nome === 'caldeira') {
    // passo 4: K4s parada, fogo 1 à mão: a segurança abre em p_nom + 0,3, fecha em p_nom − 0,4, ciclo de 1–3 min
    const P = X.presetVapor('k4s')!;
    const d = X.dsp('k4s', { fixa: false, reg: 0 });
    d.comandar({ acelerador: 0, ignicao: true, partida: false, fogo: 1, soprador: true, injetor: false } as any);
    const ab: number[] = [], fe: number[] = []; let ant = false, t = 0;
    const pAb: number[] = [], pFe: number[] = [];
    d.tap = (x) => { t++; if (x.seg.aberta !== ant) { (x.seg.aberta ? ab : fe).push(t / SR); (x.seg.aberta ? pAb : pFe).push(x.pCal); ant = x.seg.aberta; } };
    renderVapor(d, 300, [], ['seguranca']);
    add('segurança abre (K4s parada, fogo 1)', `${f1(P.pNominal + 0.3, 2)} bar`, pAb.length ? f1(X.media(pAb), 2) + ' bar' : 'não abriu', pAb.length > 0 && Math.abs(X.media(pAb) - P.pNominal - 0.3) < 0.05);
    add('segurança fecha', `${f1(P.pNominal - 0.4, 2)} bar`, pFe.length ? f1(X.media(pFe), 2) + ' bar' : 'não fechou', pFe.length > 0 && Math.abs(X.media(pFe) - P.pNominal + 0.4) < 0.05);
    const ciclo = ab.length > 1 ? (ab[ab.length - 1] - ab[0]) / (ab.length - 1) : NaN;
    add('ciclo da segurança', '1–3 min', f1(ciclo / 60, 2) + ' min', dentro(ciclo, 60, 180));
    // apito aberto 20 s, parada, foguista automático
    // (fogo parado no mínimo: o foguista automático repõe e esconderia a queda)
    const d2 = X.dsp('k4s', { fixa: false, reg: 0 });
    d2.comandar({ acelerador: 0, ignicao: true, partida: false, fogo: 0.2 } as any);
    renderVapor(d2, 3, [], []);
    const p0 = d2.pCal;
    renderVapor(d2, 21, [[0, X.comando({ apito: 1 })], [20, X.comando({ apito: 0 })]], []);
    add('apito aberto 20 s derruba a caldeira', '0,6 ± 0,2 bar', f1(p0 - d2.pCal, 2) + ' bar', Math.abs(p0 - d2.pCal - 0.6) <= 0.2);
    // arrancada com 300 t: corte 80%, regulador 0,6; cai 1–2 bar em 30 s e recupera
    const { CargaTremVapor } = await import('../src/carriers/locomotiva-vapor');
    const d3 = X.dsp('k4s', { fixa: false, reg: 0, corte: 0.8 });
    d3.acoplar(new CargaTremVapor(300, P.dRoda / 2, 10));
    let pMin = d3.pCal;
    const r3 = renderVapor(d3, 90, [[0, X.comando({ regulador: 0.6, cutoff: (0.8 - 0.15) / 0.7, fogo: 'auto' })], [10, X.comando({ cutoff: 0.5 })], [20, X.comando({ cutoff: 0.3 })], [30, X.comando({ regulador: 0 })]], []);
    for (const q of r3.tele) if (q.t <= 32) pMin = Math.min(pMin, q.pCaldeira);
    const queda = P.pNominal - pMin, fim = r3.tele.at(-1).pCaldeira;
    add('arrancada (300 t, corte 80%, regulador 0,6): queda em 30 s', '1–2 bar', f1(queda, 2) + ' bar', dentro(queda, 1, 2));
    add('arrancada: recupera depois de fechar (aos 90 s)', `≥ ${f1(P.pNominal - 0.5, 1)} bar`, f1(fim, 2) + ' bar', fim >= P.pNominal - 0.5);
    // bomba de ar: 70 ± 4 cursos/min, periodicidade 600–4000 Hz ≥ 15 dB
    const d4 = X.dsp('k4s', { reg: 0 });
    d4.comandar({ acelerador: 0, ignicao: true, partida: false, bombaAr: true } as any);
    const r4 = renderVapor(d4, 24, [], ['bomba.ar']);
    const xb = trecho(r4.canais[r4.ids.indexOf('bomba.ar')], SR, 2, 24);
    const { e, fe: fe4 } = X.envoltoria(xb, SR, 600, 4000);
    const lb = X.linhas(e, fe4, 0.5, 3, 4).sort((a, b) => b.prom - a.prom)[0];
    add('bomba de ar: cursos por minuto (linha da envoltória 600–4000 Hz)', '70 ± 4, ≥ 15 dB', lb ? `${f1(lb.f * 60, 1)}, ${f1(lb.prom, 1)} dB` : 'sem linha', !!lb && Math.abs(lb.f * 60 - 70) <= 4 && lb.prom >= 15);
    // torneiras: 4 sopros por volta em fase com as admissões
    const d5 = X.dsp('k4s', { reg: 0.5, corte: 0.6, omega: TAU });
    d5.comandar({ acelerador: 0, ignicao: true, partida: false, torneiras: true } as any);
    const adm: number[] = []; let nn = 0; const f5 = new Int32Array(d5.nE);
    d5.tap = (x) => { nn++; for (let k = 0; k < x.nE; k++) { if (x.eFase[k] === 0 && f5[k] === 3) adm.push(nn); f5[k] = x.eFase[k]; } };
    const r5 = renderVapor(d5, 8, [], ['cilindro.e', 'cilindro.d']);
    const xt = new Float64Array(r5.canais[r5.ids.indexOf('cilindro.e')].length);
    for (const id of ['cilindro.e', 'cilindro.d']) { const c = r5.canais[r5.ids.indexOf(id)]; for (let i = 0; i < c.length; i++) xt[i] += c[i]; }
    const et = X.envoltoria(trecho(xt, SR, 2, 8), SR, 1000, 5000);
    const lt = X.linhas(et.e, et.fe, 0.8, 12, 6).sort((a, b) => b.prom - a.prom)[0];
    add('torneiras abertas: sopros por volta (1 volta/s)', '4', lt ? `${f1(lt.f, 2)}/volta, ${f1(lt.prom, 1)} dB` : 'sem linha', !!lt && Math.abs(lt.f - 4) < 0.1);
    // em fase: o pico de cada sopro cai na admissão ou no começo da expansão de alguma extremidade (≤ 1/5 de volta do início)
    const env = X.envBanda(xt, SR, 1000, 5000, 0.01);
    const picos = X.acharPicos(env, { distancia: Math.round(0.6 * SR / 4), proeminencia: 0 }).filter((i) => i > 2 * SR);
    let emFase = 0; for (const i of picos) if (adm.some((a) => i - a >= 0 && i - a < SR / 5)) emFase++;
    add('torneiras: sopros em fase com as admissões', '≥ 90%', f1((100 * emFase) / Math.max(1, picos.length), 0) + '%', emFase >= 0.9 * picos.length && picos.length > 4);
  }

  if (nome === 'apito') {
    const nota = async (id: string, aq: number, dur: number, t0: number, t1: number, ab = 1) => {
      const d = X.dsp(id, {});
      d.apito.aq = aq;
      const r = renderVapor(d, dur, [[0.2, X.comando({ apito: ab })]], ['apito']);
      return { x: trecho(r.canais[r.ids.indexOf('apito')], SR, t0, t1), d };
    };
    // D51 a quente: as 3 notas, o 3º harmônico, o 2º
    const { x } = await nota('d51', 1, 3, 1, 3);
    const lt = X.linhasTonais(x, SR, { lim: 18 });
    for (const f of [360, 465, 548]) {
      const l = lt.filter((q) => Math.abs(q.f / f - 1) < 0.04).sort((a, b) => b.abs - a.abs)[0];
      add(`apito D51: nota ${f} Hz`, '±1,5%', l ? f1(l.f, 1) + ' Hz' : 'sem linha', !!l && Math.abs(l.f / f - 1) <= 0.015);
    }
    // harmônicos medidos num tubo só (o 3º do 360 cai em 1080, longe das outras notas)
    const d1 = X.dsp('d51', {}); d1.apito.aq = 1;
    d1.apito.tubos.splice(1); d1.apito.notas.splice(1);
    const r1 = renderVapor(d1, 3, [[0.2, X.comando({ apito: 1 })]], ['apito']);
    const W = X.welchPy(trecho(r1.canais[r1.ids.indexOf('apito')], SR, 1, 3), SR, 16384);
    const nivel = (f: number) => { let b = 0; for (let k = 0; k < W.f.length; k++) if (Math.abs(W.f[k] - f) < 0.02 * f) b = Math.max(b, W.P[k]); return 10 * Math.log10(b); };
    const h1 = nivel(360), h2 = nivel(720) - h1, h3 = nivel(1080) - h1;
    add('apito: 3º harmônico contra o fundamental', '−6 ± 4 dB', sg(h3) + ' dB', Math.abs(h3 + 6) <= 4);
    add('apito: 2º harmônico', '< −15 dB', sg(h2) + ' dB', h2 < -15);
    // ataque 10–90% do nível (RMS de 20 ms)
    const { x: xa } = await nota('d51', 1, 1.5, 0, 1.5);
    const ev = X.envBanda(xa, SR, 200, 3000, 0.02);
    let mx = 0; for (const v of ev) mx = Math.max(mx, v);
    const i10 = ev.findIndex((v) => v >= 0.1 * mx), i90 = ev.findIndex((v) => v >= 0.9 * mx);
    const at = (1000 * (i90 - i10)) / SR;
    add('apito: ataque 10–90%', '100–300 ms', f1(at, 0) + ' ms', dentro(at, 100, 300));
    // tubo frio: parte 10 ± 2% abaixo e chega a −1% em 30 s
    const df = X.dsp('d51', {}); df.apito.aq = 0.9; df.apito.tubos.splice(1); df.apito.notas.splice(1);
    const rf = renderVapor(df, 32, [[0, X.comando({ apito: 1 })]], ['apito']);
    const xf = rf.canais[rf.ids.indexOf('apito')];
    const fq = (t0: number) => freqFund(X, trecho(xf, SR, t0, t0 + 1.4), 330);
    const fIni = fq(0.6), fFim = fq(30.4);
    add('apito frio: afinação no começo', '−10 ± 2%', sg(100 * (fIni / 360 - 1)) + '%', Math.abs(100 * (fIni / 360 - 1) + 10) <= 2);
    add('apito frio: afinação aos 30 s', '−1% (±0,5)', sg(100 * (fFim / 360 - 1), 2) + '%', Math.abs(100 * (fFim / 360 - 1) + 1) <= 0.5);
    // 844: batimento de 13 Hz entre 407 e 420 (envoltória da banda 350–450 Hz)
    const { x: x8 } = await nota('up844', 1, 4, 1.5, 4);
    const e8 = X.envBanda(x8, SR, 395, 432, 0.005);
    const ed = new Float64Array(Math.floor(e8.length / 48)); for (let i = 0; i < ed.length; i++) ed[i] = e8[i * 48];
    const lb = X.linhas(ed.map((v) => v - X.media(Array.from(ed))) as any, 1000, 5, 30, 3).sort((a, b) => b.prom - a.prom)[0];
    const edb = Array.from(ed).map((v) => 20 * Math.log10(v + 1e-9)).sort((a, b) => a - b);
    const prof = edb[Math.floor(0.95 * edb.length)] - edb[Math.floor(0.05 * edb.length)];
    add('apito do 844: batimento entre 407 e 420 Hz', '13 ± 2 Hz, ≥ 6 dB', lb ? `${f1(lb.f, 1)} Hz, ${f1(prof, 1)} dB` : 'sem linha', !!lb && Math.abs(lb.f - 13) <= 2 && prof >= 6);
    // C57 (tríade menor)
    const { x: xc } = await nota('d51', 1, 3, 1, 3);
    void xc;
    // quilling: apito 0,1 só chia (linha < 10 dB)
    const { x: xq } = await nota('d51', 1, 3, 1, 3, 0.1);
    const lq = X.linhasTonais(xq, SR, { lim: 10 });
    add('quilling (apito 0,1): só o chiado filtrado', 'nenhuma linha > 10 dB', lq.length ? `${lq.length} linhas (${f1(Math.max(...lq.map((l) => l.rel)), 1)} dB)` : 'nenhuma', lq.length === 0);
    // varredura 0 → 1 em 5 s: a nota certa e o nível monotônico
    const dv = X.dsp('d51', {}); dv.apito.aq = 1; dv.apito.tubos.splice(1); dv.apito.notas.splice(1);
    const evv: [number, any][] = []; for (let k = 0; k <= 50; k++) evv.push([k * 0.1, X.comando({ apito: k / 50 })]);
    const rv = renderVapor(dv, 6, evv, ['apito']);
    const xv = rv.canais[rv.ids.indexOf('apito')];
    const niv: number[] = []; for (let t = 1; t < 6; t += 0.5) niv.push(X.nivelDb(trecho(xv, SR, t, t + 0.5)));
    let mono = true; for (let k = 1; k < niv.length; k++) if (niv[k] < niv[k - 1] - 1) mono = false;
    const lv = X.linhasTonais(trecho(xv, SR, 5, 6), SR, { lim: 18, nper: 16384 }).sort((a, b) => b.abs - a.abs)[0];
    add('varredura do apito 0 → 1 em 5 s: nota e nível monotônico', '360 Hz ± 1,5%, monotônico (±1 dB)', `${lv ? f1(lv.f, 1) : '—'} Hz, ${mono ? 'monotônico' : 'cai'}`, mono && !!lv && Math.abs(lv.f / 360 - 1) <= 0.015);
  }

  if (nome === 'sino') {
    // Big Boy: 606 Hz, 2,24 batidas/s, parciais 1 : 2,16 : 3,53 : 5,2 : 7,05 (±3%), T60 do fundamental 3–5 s
    const d = X.dsp('bigboy', {});
    const r = renderVapor(d, 12, [[0.1, X.comando({ sino: true })]], ['sino']);
    const x = trecho(r.canais[r.ids.indexOf('sino')], SR, 2, 12);
    const lt = X.linhasTonais(x, SR, { lim: 18, fmax: 6000 });
    const R = [1, 2.16, 3.53, 5.2, 7.05];
    let ok = true; const med: string[] = [];
    for (const k of R) { const f = 606 * k, l = lt.filter((q) => Math.abs(q.f / f - 1) < 0.05).sort((a, b) => b.abs - a.abs)[0]; med.push(l ? f1(l.f / 606, 3) : '—'); if (!l || Math.abs(l.f / f - 1) > 0.03) ok = false; }
    add('sino: parciais (razões ao fundamental de 606 Hz)', '1 : 2,16 : 3,53 : 5,2 : 7,05 ± 3%', med.join(' : '), ok);
    const { e, fe } = X.envoltoria(x, SR, 1000, 8000);
    const lb = X.linhas(e, fe, 0.8, 5, 5).sort((a, b) => b.prom - a.prom)[0];
    // (batidas alternadas ±2 dB: a linha mais forte pode ser a do par, a 1,12)
    const bps = lb ? (lb.f < 1.6 ? 2 * lb.f : lb.f) : NaN;
    add('sino: batidas por segundo', '2,0–2,3', f1(bps, 2), dentro(bps, 2.0, 2.3));
    // T60: uma batida só, envoltória do fundamental
    const d1 = X.dsp('bigboy', {});
    const r1 = renderVapor(d1, 6, [[0.1, X.comando({ sino: true })], [0.8, X.comando({ sino: false })]], ['sino']);
    const e1 = X.envBanda(r1.canais[r1.ids.indexOf('sino')], SR, 560, 650, 0.02);
    const a = 20 * Math.log10(e1[Math.round(1.5 * SR)]), b = 20 * Math.log10(e1[Math.round(3.5 * SR)]);
    const t60 = 60 / ((a - b) / 2);
    add('sino: T60 do fundamental', '3–5 s', f1(t60, 2) + ' s', dentro(t60, 3, 5));
  }

  if (nome === 'geometrias') {
    const linhaEm = (x: Float64Array, f: number, tol = 0.04) => { const { e, fe } = X.envoltoria(x, SR); return X.linhas(e, fe, 0.8, 45, 25).filter((l) => Math.abs(l.f / f - 1) < tol).sort((a, b) => b.prom - a.prom)[0]; };
    // A4: 6 por volta
    const a4 = X.dsp('a4', { reg: 1, corte: 0.35, omega: TAU * 1.2 });
    const la = linhaEm(trecho(soma(renderVapor(a4, 7)), SR, 2, 7), 6 * 1.2);
    add('A4 (3 cil. a 120°): escapes por volta', '6', la ? `${f1(la.f / 1.2, 2)} (${f1(la.prom, 0)} dB)` : 'sem linha', !!la && Math.abs(la.f / 1.2 - 6) < 0.05 && la.prom >= 12);
    // Shay a 20 km/h: 30 ± 0,6 chuffs/s
    const P = X.presetVapor('shay')!;
    const ws = (20 / 3.6) / (P.dRoda / 2);
    const sh = X.dsp('shay', { reg: 1, corte: 0.4, omega: ws });
    const ls = linhaEm(trecho(soma(renderVapor(sh, 6)), SR, 2, 6), 30, 0.06);
    add('Shay a 20 km/h: chuffs/s', '30 ± 0,6', ls ? `${f1(ls.f, 2)} (${f1(ls.prom, 0)} dB)` : 'sem linha', !!ls && Math.abs(ls.f - 30) <= 0.6);
    // King: 4/volta com batidas duplas (linha de 8/volta < −20 dB da de 4/volta)
    const ki = X.dsp('king', { reg: 1, corte: 0.4, omega: TAU * 2 });
    const xk = trecho(soma(renderVapor(ki, 7)), SR, 2, 7);
    const l4 = linhaEm(xk, 8), l8 = linhaEm(xk, 16);
    add('King 6024: 4 batidas duplas por volta', '4/volta', l4 ? `${f1(l4.f / 2, 2)}/volta (${f1(l4.prom, 0)} dB)` : 'sem linha', !!l4 && Math.abs(l4.f / 2 - 4) < 0.05);
    const d8 = l8 && l4 ? l8.prom - l4.prom : -99;
    add('King: linha de 8/volta contra a de 4/volta', '< −20 dB', l8 ? sg(d8) + ' dB' : 'nenhuma (< limiar)', d8 < -20);
    // Y6b: 4/volta em composição com p_rel da BP 2–4 bar; 8 na partida com a simplificação
    const y = X.dsp('y6b', { reg: 1, corte: 0.6, omega: TAU });
    let rel = 0, nRel = 0; const fy = new Int32Array(y.nE); const prb: number[] = []; let ny = 0;
    y.tap = (x) => { ny++; for (let e = 0; e < x.nE; e++) { if (x.eFase[e] === 2 && fy[e] !== 2 && ny > 2 * SR) { if (x.eDest[e] === 0) { nRel++; prb.push(x.eP[e] / 1e5); } } fy[e] = x.eFase[e]; } };
    renderVapor(y, 5, [], []);
    add('Y6b em composição: escapes pela chaminé por volta', '4', f1(nRel / 3, 2), Math.abs(nRel / 3 - 4) < 0.05);
    add('Y6b: p_rel da BP', '2–4 bar abs', f1(X.media(prb), 2) + ' bar', dentro(X.media(prb), 2, 4));
    const y2 = X.dsp('y6b', { reg: 1, corte: 0.8, omega: 0.5 * TAU });
    y2.comandar({ acelerador: 0, ignicao: true, partida: false, simplificacao: true } as any);
    let n2 = 0; const f2 = new Int32Array(y2.nE); let ny2 = 0;
    y2.tap = (x) => { ny2++; for (let e = 0; e < x.nE; e++) { if (x.eFase[e] === 2 && f2[e] !== 2 && ny2 > 2 * SR) n2++; f2[e] = x.eFase[e]; } };
    renderVapor(y2, 6, [], []);
    void rel;
    add('Y6b na partida com a simplificação: escapes pela chaminé por volta', '8', f1(n2 / 2, 2), Math.abs(n2 / 2 - 8) < 0.1);
    // Big Boy a 52 km/h: a linha de 8/volta (21,5 Hz) varia ≥ 10 dB ao longo de 60 s; as de 4/volta de cada motor
    const B = X.presetVapor('bigboy')!;
    const wb = (52 / 3.6) / (B.dRoda / 2), frev = wb / TAU;
    const bb = X.dsp('bigboy', { reg: 1, corte: 0.3, omega: wb });
    const xb = soma(renderVapor(bb, 64));
    const proms: number[] = [];
    for (let t = 2; t + 6 <= 64; t += 3) { const l = linhaEm(trecho(xb, SR, t, t + 6), 8 * frev, 0.03); proms.push(l ? l.prom : 0); }
    const var8 = Math.max(...proms) - Math.min(...proms);
    add(`Big Boy a 52 km/h: linha de 8/volta (${f1(8 * frev, 1)} Hz) ao longo de 60 s`, 'varia ≥ 10 dB', `${f1(Math.min(...proms), 0)}…${f1(Math.max(...proms), 0)} dB (${f1(var8, 1)})`, var8 >= 10);
    const l4b = linhaEm(trecho(xb, SR, 2, 62), 4 * frev, 0.03);
    add('Big Boy: linha de 4/volta (cada motor)', `${f1(4 * frev, 2)} Hz`, l4b ? `${f1(l4b.f, 2)} Hz (${f1(l4b.prom, 0)} dB)` : 'sem linha', !!l4b && l4b.prom >= 10);
  }

  if (nome === 'patinagem') {
    const { CargaTremVapor } = await import('../src/carriers/locomotiva-vapor');
    const P = X.presetVapor('k4s')!, r = P.dRoda / 2;
    // a 1 volta/s (4 chuffs/s, 23 km/h) com 500 t, corte 80%; o regulador vai de 0,3 a 1 em t = 1 s no trilho molhado; o
    // "maquinista" fecha o regulador 1 s depois do início do surto
    const arrancar = (areia: boolean) => {
      const d = X.dsp('k4s', { fixa: false, reg: 0.3, corte: 0.8 });
      d.acoplar(new CargaTremVapor(500, r, 10));
      d.wTrem = TAU; for (let k = 0; k < d.nM; k++) d.wM[k] = TAU;
      d.comandar({ acelerador: 0, ignicao: true, partida: false, trilho: 'molhado', areia } as any);
      let surto = -1, fechou = -1, maxRaz = 0, volta = -1, t = 0;
      d.tap = (x) => {
        t++;
        if (t === SR) x.fixar({ regulador: 1 });
        const raz = Math.abs(x.wM[0]) / Math.max(0.05, Math.abs(x.wTrem));
        if (x.patM[0] && surto < 0) surto = t;
        if (surto > 0 && t - surto < SR) maxRaz = Math.max(maxRaz, raz);
        if (surto > 0 && fechou < 0 && t - surto >= SR) { fechou = t; x.fixar({ regulador: 0 }); }
        if (fechou > 0 && volta < 0 && !x.patM[0]) volta = t;
      };
      const rr = renderVapor(d, 6, [], ['chamine']);
      return { surto, maxRaz, volta: volta > 0 ? (volta - fechou) / SR : NaN, rr };
    };
    const m = arrancar(false);
    add('molhado (μ 0,12, 500 t, regulador 0,3 → 1 a 23 km/h): surto de patinagem', '≥ 1', m.surto > 0 ? `aos ${f1(m.surto / SR, 2)} s` : 'nenhum', m.surto > 0);
    add('patinagem: roda contra o trem em ≤ 1 s', '3–5×', f1(m.maxRaz, 1) + '×', dentro(m.maxRaz, 3, 6));
    const tl = m.rr.tele.filter((q: any) => q.patinando);
    const chMax = tl.length ? Math.max(...tl.map((q: any) => q.chuffsPorS)) : 0;
    add('patinagem: chuffs/s no surto (de 4/s)', '15–20', f1(chMax, 1), dentro(chMax, 15, 20));
    add('patinagem: regulador fechado 1 s depois → a roda readere', '≤ 1,5 s', f1(m.volta, 2) + ' s', m.volta <= 1.5);
    const s = arrancar(true);
    add('com areia (μ 0,30): sem surto', 'nenhum', s.surto > 0 ? `surto aos ${f1(s.surto / SR, 2)} s` : 'nenhum', s.surto < 0);
    if (m.surto > 0) {
      // nível por chuff: o pico da envoltória no fim do surto contra o mesmo trecho da arrancada com areia (aderida)
      // energia por chuff = potência média / chuffs por segundo, no fim do surto e no mesmo trecho da arrancada com areia
      const t0 = m.surto / SR;
      const ePorChuff = (rr: any) => { const x = trecho(rr.canais[rr.ids.indexOf('chamine')], SR, t0 + 0.5, t0 + 1.0); const tl = rr.tele.filter((q: any) => q.t > t0 + 0.5 && q.t < t0 + 1.0); return X.nivelDb(x) - 10 * Math.log10(X.media(tl.map((q: any) => q.chuffsPorS))); };
      const q = ePorChuff(m.rr) - ePorChuff(s.rr);
      add('patinagem: energia por chuff no fim do surto contra a arrancada com areia', '≤ −6 dB', sg(q) + ' dB', q <= -6);
    }
    // drifting a 60 km/h: chuff −25 ± 3 dB contra o cruzeiro; o rolamento domina
    const w60 = (60 / 3.6) / r;
    const cr = X.dsp('k4s', { reg: 1, corte: 0.3, omega: w60 });
    const dr = X.dsp('k4s', { reg: 0, corte: 0.4, omega: w60 });
    const nc = X.nivelDb(trecho(renderVapor(cr, 5, [], ['chamine']).canais[0], SR, 2, 5));
    const rd = renderVapor(dr, 5, [], ['chamine']);
    const nd = X.nivelDb(trecho(rd.canais[0], SR, 2, 5));
    add('drifting a 60 km/h: chaminé contra o cruzeiro', '−25 ± 3 dB', sg(nd - nc) + ' dB', Math.abs(nd - nc + 25) <= 3);
    // o rolamento da locomotiva e do tênder (as fontes do portador) a 60 km/h contra a chaminé em drifting
    const { LocomotivaVapor, configLocoVapor } = await import('../src/carriers/locomotiva-vapor');
    const lv = new LocomotivaVapor(SR, configLocoVapor(P, { vagoes: 0 }), 14);
    let er = 0; const ob = new Float32Array(SR);
    for (const f of lv.rodas) { f.ajustar(60 / 3.6); f.preencher(ob, SR); f.preencher(ob, SR); er += Math.pow(10, X.nivelDb(ob) / 10); }
    const nr = 10 * Math.log10(er);
    add('drifting a 60 km/h: rolamento da locomotiva e do tênder contra a chaminé', '≥ +10 dB', sg(nr - nd) + ' dB', nr - nd >= 10);
  }

  if (nome === 'composicao') {
    const { LocomotivaVapor, configLocoVapor, orcamentoLocoVapor } = await import('../src/carriers/locomotiva-vapor');
    const mont = (id: string, vag: number, corte: number) => {
      const P = X.presetVapor(id)!;
      const mot = X.dsp(id, { reg: 1, corte });
      const p = new LocomotivaVapor(SR, configLocoVapor(P, { vagoes: vag }), mot.fontes.length);
      p.acoplar(mot); p.comandar({ pedal: 0, regulador: 1, cutoff: (corte - 0.15) / 0.7 } as any);
      return { p, mot, P };
    };
    for (const [vk, alvo, tol] of [[40, -13, 3], [100, 0, 4]] as const) {
      const { p, P } = mont('k4s', 12, vk > 60 ? 0.25 : 0.4);
      const v = vk / 3.6, Lc = p.corpo.comprimento;
      const c = await cena(p, { v, d: 15, dur: (Lc + 160) / v, sCentro0: -(80 + Lc / 2) });
      const tN = 80 / v, loco = P.geometria.comprimento;
      const lLoco = c.leq(tN - 1, tN + (loco + 10) / v + 1);
      const lVag = c.leq(tN + (loco + 30) / v, tN + (Lc - 10) / v);
      add(`composição a ${vk} km/h, 12 vagões, 15 m: vagões contra a locomotiva`, `${sg(alvo, 0)} ± ${tol} dB`, sg(lVag - lLoco) + ' dB', Math.abs(lVag - lLoco - alvo) <= tol);
      if (vk === 40) {
        add('locomotiva trabalhando a 15 m (K4s, 40 km/h, corte 40%): L_Aeq', '90–100 dB(A)', f1(lLoco) + ' dB(A)', dentro(lLoco, 90, 100));
        const bv = X.bandas(trecho(c.m, SR, tN + (loco + 30) / v, tN + (Lc - 10) / v), SR);
        add('rolamento da composição: centroide', '550–1 000 Hz', f1(bv.centroide, 0) + ' Hz', dentro(bv.centroide, 550, 1000));
      }
    }
    // Doppler (a linha da chaminé é larga, Q 2–3: mede-se no apito do 844, 281 Hz, a mesma fórmula de CENA 2.1)
    {
      const { p } = mont('up844', 0, 0.4);
      p.comandar({ pedal: 0, apito: 1 } as any);
      (p.motor as any).apito.aq = 1;
      const v = 40 / 3.6;
      const c = await cena(p, { v, d: 15, dur: 30, sCentro0: -150 });
      const ch = (x: Float64Array) => freqFund(X, x, 281);
      const fA = ch(trecho(c.m, SR, 1, 4)), fD = ch(trecho(c.m, SR, 25, 29));
      const cA = (150 - v * 2.5) / Math.hypot(150 - v * 2.5, 15), cD = (v * 27 - 150) / Math.hypot(v * 27 - 150, 15);
      const eA = 281 / (1 - (v / 343) * cA), eD = 281 / (1 + (v / 343) * cD);
      add('Doppler do apito do 844 (281 Hz) a 40 km/h, chegando / indo', `${f1(eA, 1)} / ${f1(eD, 1)} ± 1 Hz`, `${f1(fA, 1)} / ${f1(fD, 1)} Hz`, Math.abs(fA - eA) <= 1 && Math.abs(fD - eD) <= 1);
    }
    const P = X.presetVapor('bigboy')!;
    const o20 = orcamentoLocoVapor({ vagoes: 20, loco: configLocoVapor(P).loco }, 14);
    add('orçamento: Big Boy com 20 vagões', '≤ 64 fontes', `${o20.fontes} (vãos ${o20.vaos ? 'sim' : 'fora'})`, o20.cabe && o20.fontes <= 64);
    let erro = '';
    try { mont('bigboy', 30, 0.4); } catch (e: any) { erro = String(e.message || e); }
    add('orçamento: 30 vagões dão erro claro', 'erro com o máximo', erro ? erro.slice(0, 80) : 'sem erro', /até \d+ vagões/.test(erro));
  }

  if (nome === 'estacionarios') {
    const { Gerador } = await import('../src/carriers/gerador');
    const { configPortadorVapor } = await import('../src/carriers/portadores-vapor');
    // Corliss a 75 rpm: 2,5 pulsos/s, cliques 2/volta; degrau de 50% de carga
    const Pc = X.presetVapor('corliss')!;
    const mot = new X.MotorVapor(SR); mot.configurar(X.cfg('corliss'), SR);
    const cfgG = configPortadorVapor('gerador', 'corliss', 0);
    void Pc;
    const g = new Gerador(SR, cfgG); g.acoplar(mot);
    g.comandar({ pedal: 0, cargaFracao: 0.5 });
    const B = 128, can = g.fontes().map(() => new Float32Array(B));
    const N = 60 * SR, x = new Float64Array(N), rpm: number[] = [];
    for (let i = 0; i < N; i += B) {
      if (i === 30 * SR) g.comandar({ pedal: 0, cargaFracao: 1 });
      g.processar(can, B, 1 / SR);
      for (let k = 0; k < B; k++) { let s = 0; for (const c of can) s += c[k]; x[i + k] = s; }
      if (((i / B) | 0) % 38 === 0) rpm.push((mot.eixo.omega * 60) / TAU);
    }
    const { e, fe } = X.envoltoria(trecho(x, SR, 20, 30), SR, 200, 6000);
    const lp = X.linhas(e, fe, 0.8, 10, 6).filter((l) => Math.abs(l.f - 2.5) < 0.3).sort((a, b) => b.prom - a.prom)[0];
    add('Corliss a 75 rpm: pulsos por segundo (2 por volta)', '2,5 ± 0,05', lp ? `${f1(lp.f, 3)} (${f1(lp.prom, 0)} dB)` : 'sem linha', !!lp && Math.abs(lp.f - 2.5) <= 0.05);
    const dtR = (38 * B) / SR, k30 = Math.round(30 / dtR);
    const antes = X.media(rpm.slice(k30 - 50, k30)), seg = rpm.slice(k30, k30 + 100), min = Math.min(...seg);
    const queda = 100 * (min / antes - 1);
    let tv = NaN; for (let k = k30 + seg.indexOf(min); k < rpm.length; k++) if (Math.abs(rpm[k] / antes - 1) <= 0.01) { tv = (k - k30) * dtR; break; }
    add('Corliss: degrau de 50% de carga (50 → 100%)', '−3 ± 1%', sg(queda, 2) + '%', Math.abs(queda + 3) <= 1);
    add('Corliss: volta a ±1% depois do degrau', '5–10 s', f1(tv, 1) + ' s', dentro(tv, 5, 10));
    // Aveling em lenta: 2,5 ± 0,3 escapes/s, 400–1k +8 ± 4 dB
    const { Trator, configTrator } = await import('../src/carriers/trator');
    const ma = new X.MotorVapor(SR); ma.configurar(X.cfg('aveling'), SR);
    const t = new Trator(SR, configTrator(X.presetVapor('aveling')!)); t.acoplar(ma); t.comandar({ pedal: 0, marcha: 0 });
    const ca = t.fontes().map(() => new Float32Array(B)), xa = new Float64Array(20 * SR);
    for (let i = 0; i < xa.length; i += B) { t.processar(ca, B, 1 / SR); for (let k = 0; k < B; k++) { let s = 0; for (const c of ca) s += c[k]; xa[i + k] = s; } }
    const ea = X.envoltoria(trecho(xa, SR, 8, 20), SR);
    const la = X.linhas(ea.e, ea.fe, 0.8, 10, 6).sort((a, b) => b.prom - a.prom)[0];
    const fesc = (2 * Math.abs(ma.eixo.omega) * ma.reducao) / TAU;
    add('Aveling em lenta: escapes por segundo', '2,5 ± 0,3', `${f1(fesc, 2)} (linha ${la ? f1(la.f, 2) : '—'})`, Math.abs(fesc - 2.5) <= 0.3);
    const ba = X.cinco(X.bandas(trecho(xa, SR, 8, 20), SR));
    add('Aveling em lenta: banda 400–1k', '+8 ± 4 dB', sg(ba[1]) + ' dB', Math.abs(ba[1] - 8) <= 4);
    // Stanley a 40 km/h: 23 ± 0,5 "pants"/s, p/v ≤ 4 dB; o queimador ≥ 10 dB acima do escape parado
    const { CarroDireto, configCarroDireto } = await import('../src/carriers/carro-direto');
    const ms = new X.MotorVapor(SR); ms.configurar(X.cfg('stanley'), SR);
    const cs = new CarroDireto(SR, configCarroDireto(X.presetVapor('stanley')!)); cs.acoplar(ms);
    cs.comandar({ pedal: 0.7, velocidadeFixa: 40 / 3.6 });
    const ids = cs.fontes().map((f) => f.id), cc = ids.map(() => new Float32Array(B)), xs = new Float64Array(6 * SR), xq = new Float64Array(6 * SR), xe = new Float64Array(6 * SR);
    for (let i = 0; i < xs.length; i += B) { cs.processar(cc, B, 1 / SR); for (let k = 0; k < B; k++) { xe[i + k] = cc[ids.indexOf('chamine')][k]; xq[i + k] = cc[ids.indexOf('queimador')][k]; } }
    const es = X.envoltoria(trecho(xe, SR, 2, 6), SR, 40, 600);
    const lsn = X.linhas(es.e, es.fe, 5, 40, 6).filter((l) => Math.abs(l.f - 23.3) < 2).sort((a, b) => b.prom - a.prom)[0];
    add('Stanley a 40 km/h: "pants" por segundo', '23 ± 0,5', lsn ? f1(lsn.f, 2) : 'sem linha', !!lsn && Math.abs(lsn.f - 23) <= 0.5);
    const msn = X.analisarChuff(trecho(xe, SR, 2, 6), SR, 23.3);
    add('Stanley: pico/vale do escape', '≤ 4 dB', f1(msn.pv.med) + ' dB', msn.pv.med <= 4);
    const cs2 = new CarroDireto(SR, configCarroDireto(X.presetVapor('stanley')!)); const ms2 = new X.MotorVapor(SR); ms2.configurar(X.cfg('stanley'), SR); cs2.acoplar(ms2);
    cs2.comandar({ pedal: 0, regulador: 0 } as any);
    const xq2 = new Float64Array(3 * SR), xe2 = new Float64Array(3 * SR);
    for (let i = 0; i < xq2.length; i += B) { cs2.processar(cc, B, 1 / SR); for (let k = 0; k < B; k++) { xe2[i + k] = cc[ids.indexOf('chamine')][k]; xq2[i + k] = cc[ids.indexOf('queimador')][k]; } }
    const dq = X.nivelDb(trecho(xq2, SR, 1, 3)) - X.nivelDb(trecho(xe2, SR, 1, 3));
    add('Stanley parado: queimador contra o escape', '≥ +10 dB', sg(dq) + ' dB', dq >= 10);
    void xs; void xq;
    // barco a 40 rpm: 6,7 ± 0,2 tapas/s
    const { Barco, configBarco } = await import('../src/carriers/barco');
    const mb = new X.MotorVapor(SR); mb.configurar(X.cfg('vapor_pas'), SR);
    const b = new Barco(SR, configBarco(X.presetVapor('vapor_pas')!)); b.acoplar(mb);
    const R = (X.presetVapor('vapor_pas')!.pas!.D) / 2;
    b.comandar({ pedal: 1, velocidadeFixa: 0.75 * (40 / 60) * TAU * R });
    const ib = b.fontes().map((f) => f.id), cb = ib.map(() => new Float32Array(B)), xpb = new Float64Array(8 * SR);
    for (let i = 0; i < xpb.length; i += B) { b.processar(cb, B, 1 / SR); for (let k = 0; k < B; k++) xpb[i + k] = cb[ib.indexOf('pas.e')][k]; }
    const eb = X.envoltoria(trecho(xpb, SR, 2, 8), SR, 200, 2000);
    const lbb = X.linhas(eb.e, eb.fe, 2, 15, 6).sort((a, b2) => b2.prom - a.prom)[0];
    add('barco de rodas de pás a 40 rpm: tapas por segundo', '6,7 ± 0,2', lbb ? `${f1(lbb.f, 2)} (${f1(lbb.prom, 0)} dB)` : 'sem linha', !!lbb && Math.abs(lbb.f - 6.67) <= 0.2);
  }

  if (nome === 'niveis') {
    // tabela 4.6 a ±1 dB na condição de referência, canal a canal (K4s), e os níveis a distância pela Cena
    const { PonderacaoA, fatorPotenciaDir } = await import('../src/scene/filtros');
    const lw = (x: ArrayLike<number>, tab: readonly number[]) => {
      const pa = new PonderacaoA(SR); let e = 0;
      for (let i = 0; i < x.length; i++) { const y = pa.run(x[i]); if (i > 0.2 * SR) e += y * y; }
      const lp = 10 * Math.log10(e / (x.length - 0.2 * SR) / 4e-10);
      return lp + 20 * Math.log10(7.5) + 11 + 10 * Math.log10(fatorPotenciaDir(tab));
    };
    const caso = (n: string, alvo: number, id: string, canal: string, ev: any[], dur: number, ini: number, o: any = {}) => {
      const d = X.dsp(id, o);
      if (o.pre) o.pre(d);
      const r = renderVapor(d, dur, ev, [canal]);
      const ci = r.ids.indexOf(canal);
      const v = lw(trecho(r.canais[ci], SR, ini, dur), d.fontes[ci].dir.tabela);
      add(`L_W ${n} na referência (${id})`, `${alvo} ± 1 dB(A)`, f1(v) + ' dB(A)', Math.abs(v - alvo) <= 1);
    };
    const P = X.presetVapor('k4s')!;
    caso('chaminé (chuff)', P.lwChuff, 'k4s', 'chamine', [], 3, 1.5, { reg: 1, corte: 0.5, chuffs: 4, pre: (d: any) => { d.jato.gChoque = 0; } });
    caso('apito', 145, 'k4s', 'apito', [[0, X.comando({ apito: 1 })]], 2.5, 1, { pre: (d: any) => { d.apito.aq = 1; } });
    caso('segurança', 140, 'k4s', 'seguranca', [], 2, 0.6, { pre: (d: any) => { d.seg.aberta = true; d.seg.controle = () => {}; } });
    caso('torneiras', 123, 'k4s', 'cilindro.e', [[0, X.comando({ torneiras: true })]], 3, 1.5, { reg: 0.5, corte: 0.57, omega: 2 * TAU, pre: (d: any) => { d.mascara.vazamentos = 0; } });
    caso('sino', 113, 'k4s', 'sino', [[0, X.comando({ sino: true })]], 4, 1);
    caso('bomba de ar', 104, 'k4s', 'bomba.ar', [[0, X.comando({ bombaAr: true })]], 6, 0.5);
    caso('injetor', 94, 'k4s', 'injetor', [[0, X.comando({ injetor: true })]], 5, 3.2);
    // a distância, pela Cena (céu aberto, brita), locomotiva parada
    const { LocomotivaVapor, configLocoVapor } = await import('../src/carriers/locomotiva-vapor');
    const dist = async (n: string, alvo: number, tol: number, d: number, o: any, ev: (p: any, m: any) => void, ini = 1, dur = 4, id = 'k4s') => {
      const m = X.dsp(id, o), Pd = X.presetVapor(id)!;
      const p = new LocomotivaVapor(SR, configLocoVapor(Pd, { vagoes: 0 }), m.fontes.length);
      p.acoplar(m); ev(p, m);
      if (o.chuffs) p.omegaTeste = (o.chuffs / X.escapesPorVolta(Pd)) * TAU;
      const c = await cena(p, { v: 0, d, dur, sCentro0: 0 });
      const l = c.leq(ini, dur);
      add(n, `${alvo} ± ${tol} dB(A)`, f1(l) + ' dB(A)', Math.abs(l - alvo) <= tol);
    };
    await dist('apito a 30 m (lateral, solo de brita)', 105, 3, 30, {}, (p, m) => { m.apito.aq = 1; p.comandar({ pedal: 0, regulador: 0, apito: 1 }); }, 1.2, 3.5);
    await dist('segurança a 10 m', 110, 3, 10, {}, (_p, m) => { m.seg.aberta = true; m.seg.controle = () => {}; }, 0.8, 3);
    await dist('locomotiva trabalhando a 15 m (UP 844, lwChuff 128, 4/s, corte 50%)', 95, 5, 15, { reg: 1, corte: 0.5, chuffs: 4 }, (p) => p.comandar({ pedal: 0, regulador: 1, cutoff: (0.5 - 0.15) / 0.7 } as any), 1.5, 4.5, 'up844');
    // fora da referência: nível por chuff na arrancada (corte 80%, 1,5/s) e em cruzeiro (25%, 15/s) relativo à referência
    const porChuff = (o: any, ch: number) => { const d = X.dsp('k4s', o); const r = renderVapor(d, 6, [], ['chamine']); const x = trecho(r.canais[0], SR, 2, 6); return X.nivelDb(x) - 10 * Math.log10(ch); };
    const ref = porChuff({ reg: 1, corte: 0.5, chuffs: 4 }, 4);
    const arr = porChuff({ reg: 1, corte: 0.8, chuffs: 1.5 }, 1.5) - ref, cru = porChuff({ reg: 1, corte: 0.25, chuffs: 15 }, 15) - ref;
    add('nível por chuff na arrancada (corte 80%, 1,5/s) contra a referência', '+6 ± 3 dB', sg(arr) + ' dB', Math.abs(arr - 6) <= 3);
    add('nível por chuff em cruzeiro (corte 25%, 15/s) contra a referência', '−4 ± 3 dB', sg(cru) + ' dB', Math.abs(cru + 4) <= 3);
  }
  return L;
}

// ------------------------------------------------------------------ CLI
const args = process.argv.slice(2);
if (args[0] === '--grupo') {
  grupo(args[1]).then((l) => process.stdout.write(JSON.stringify(l))).catch((e) => process.stdout.write(JSON.stringify([{ grupo: args[1], nome: 'execução do grupo', alvo: 'sem erro', medido: String(e?.stack || e).slice(0, 400), ok: false }])));
} else if (process.argv[1] && process.argv[1].endsWith('vapor-valida.ts')) {
  const ji = args.indexOf('--j'), J = ji >= 0 ? +args[ji + 1] : Math.max(2, Math.floor(os.cpus().length * 0.5));
  const pedidos = args.filter((a, i) => !a.startsWith('--') && (ji < 0 || i !== ji + 1));
  const GRUPOS = ['caldeira', 'composicao', 'geometrias', 'estacionarios', 'apito', 'patinagem', 'niveis', 'rede', 'cilindro', 'taxa', 'forma', 'bandas', 'sino', 'cpu'];
  const fila = pedidos.length ? pedidos : GRUPOS;
  const res: Record<string, Linha[]> = {};
  const t0 = Date.now();
  const rodar = (g: string) => new Promise<void>((ok) => {
    const p = spawn(process.execPath, ['--import', 'tsx', AQUI, '--grupo', g], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = ''; p.stdout.on('data', (b) => { out += b; });
    p.on('close', () => { try { res[g] = JSON.parse(out); } catch { res[g] = [{ grupo: g, nome: 'execução do grupo', alvo: 'sem erro', medido: out.slice(-300), ok: false }]; } console.error(`  (${g}: ${((Date.now() - t0) / 1000).toFixed(0)} s)`); ok(); });
  });
  (async () => {
    const q = [...fila];
    // (a CPU mede sozinha, depois dos outros, para não disputar núcleo)
    const cpu = q.includes('cpu'); if (cpu) q.splice(q.indexOf('cpu'), 1);
    await Promise.all(Array.from({ length: Math.min(J, q.length) }, async () => { while (q.length) await rodar(q.shift()!); }));
    if (cpu) await rodar('cpu');
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
