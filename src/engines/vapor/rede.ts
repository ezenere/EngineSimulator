// Rede acústica do escape a vapor (docs/VAPOR.md 1.4): passagens de escape → junção → tubo de descarga → bico →
// caixa de fumaça (volume) → chaminé → boca, mais o ruído de jato do bico (Strouhal) e o de choque.
//
//   ext. 1 ─ Line(0,4 m) ┐
//   ext. 2 ─ Line(0,4 m) ├─ Junction ─ Line(descarga) ─ Bico ─ [caixa: volume V] ─ Line(chaminé, L_ch) ─ Radiator(D_ch)
//   ext. N ─ Line(0,4 m) ┘
//
// Reaproveita `Line`, `Junction`, `Radiator`, `Biquad`, `RNG` e `psi` de src/acoustics/ sem mudar nada. O que falta lá
// mora aqui (decisão 1 e 7.1 do VAPOR.md; relatado para subir ao pacote comum depois):
//   - `vazaoV` e `orificioImplicito`: o escoamento compressível com R do vapor (o `flow` do acoustics usa o R do ar) e a
//     solução implícita de um orifício entre uma ponta de linha e um volume (a do `exhaustFlow` do Ronco, genérica);
//   - `Caixa`: um volume acústico (capacitância C = V/(ρc²)) ligado à base de uma linha, integrado de forma implícita;
//   - as linhas com velocidade do som própria: `Line` usa a SOUND_SPEED 520 fixa, então os comprimentos entram
//     escalados por 520/c (c_v 480 no vapor do escape, c_q 450 na chaminé), como o diesel faz com o gás frio.
//
// Convenção das linhas (a do Ronco): as ondas levam pressão acústica em Pa; uma vazão mássica ṁ que entra pela ponta
// de uma linha de área A soma Z·ṁ à onda que sai, Z = c/A (Pa por kg/s), e a pressão na ponta é 2·in + Z·ṁ.
import { Line, Junction, Radiator, Biquad, RNG, PSI, PSI_N, port, onePole } from '../../acoustics';
import { P0 as P0_, C_V, C_Q, C_LINHA, CD_BICO } from './constantes';
// (cópias locais: no Node, via tsx, cada constante importada é um getter no laço)
const P0 = P0_;

const GAM = 1.33;
/** fração do fluxo de quantidade de movimento do jato que vira pressão na saia da chaminé (mistura e perdas) */
const ETA_JATO = 0.5;
/** desvio relativo da pressão turbulenta na mistura do jato (a parte que a chaminé ressoa) */
const SIGMA_TURB = 0.8;
/**
 * corte da reflexão na boca da chaminé, em múltiplos da meia onda: no grave a boca reflete −0,97 (fecha o Helmholtz),
 * na meia onda só ~40% (o jato saindo pela boca larga leva a onda embora): Q 2,5–3 e o toque decai em ~15–20 ms
 */
const K_REFL = 0.9;
const EXP_M = (GAM - 1) / GAM;
/**
 * amortecimento das linhas do escape (passagens e tubo de descarga): as `Line` do acoustics perdem
 * exp(−0,09·L·amortecimento) por passagem em todas as frequências. LIMITAÇÃO CONHECIDA: aqui a onda carrega também a
 * vazão média (bar, não pascal), e com este 1,5 cerca de 40% do vapor de cada descarga some entre o pórtico e o bico
 * (K4s a 4 chuffs/s, corte 70%: pico de 10 kg/s no pórtico e de 6 no bico). O cilindro esvazia como se o bico fosse
 * 1,3× mais largo. Com 0 a vazão se conserva, mas com os bicos das fichas o chuff dobra de largura (135 ms contra 70 a
 * 4/s); com o bico de catálogo da K4s (7", 0,178 m, contra os 0,15 da ficha) a forma volta à de hoje e as bandas no
 * pico melhoram. Trocar pede rever o bico das 14 fichas uma a uma: fica para uma passada própria (`ferramentas` abaixo)
 */
export let AMORT_ESCAPE = 1.5;
/** (ferramentas: medir com a vazão conservada, `definirAmortecimentoEscape(0)` antes de montar o DSP) */
export const definirAmortecimentoEscape = (v: number) => { AMORT_ESCAPE = v; };

/** vazão mássica (kg/s, com sinal de a para b) por uma área efetiva A, vapor de √(R·T) = `sRT` */
export function vazaoV(A: number, pa: number, pb: number, sRT: number) {
  // (a Ψ do acoustics/escoamento.ts, tabelada, com a interpolação aqui dentro: o laço chama isto ~20 vezes por amostra)
  let pr: number, s: number;
  if (pa >= pb) { pr = pb / pa; s = (A * pa) / sRT; } else { pr = pa / pb; s = (-A * pb) / sRT; }
  if (pr >= 1) return 0;
  const x = pr * PSI_N_, i = x | 0;
  return s * (PSI_[i] + (PSI_[i + 1] - PSI_[i]) * (x - i));
}
const PSI_ = PSI, PSI_N_ = PSI_N;

/**
 * Orifício entre uma ponta de linha e um lado fixo: resolve ṁ = vazaoV(A, pUp0 + kUp·ṁ, pDn, sRT) por regula falsi
 * (Illinois), como o `exhaustFlow` do Ronco. A explícita (pressão da linha sem o ṁ desta amostra) é instável perto do
 * equilíbrio: o ganho de malha Z·dṁ/dp passa de 1 com a Ψ linearizada. `kUp` é −Z (a vazão sai da linha) ou +Z
 * (entra na linha pelo lado de baixo: o pórtico do cilindro, em que a linha é o lado de baixo, usa `orificioParaLinha`).
 */
export function orificioDeLinha(A: number, pUp0: number, Z: number, pDn: number, sRT: number, it = 2) {
  // g(m) = F(pUp0 − Z·m) − m, decrescente em m
  const F0 = vazaoV(A, pUp0, pDn, sRT);
  let lo: number, hi: number, glo: number, ghi: number;
  if (F0 >= 0) { lo = 0; glo = F0; hi = F0; ghi = vazaoV(A, Math.max(2000, pUp0 - Z * F0), pDn, sRT) - F0; }
  else { hi = 0; ghi = F0; lo = F0; glo = vazaoV(A, Math.max(2000, pUp0 - Z * F0), pDn, sRT) - F0; }
  if (glo - ghi < 1e-12) return F0;
  let lado = 0, m = lo;
  for (let k = 0; k < it; k++) {
    m = (lo * ghi - hi * glo) / (ghi - glo);
    if (hi - lo < 1e-5 * (Math.abs(m) + 1e-3)) break;
    const g = vazaoV(A, Math.max(2000, pUp0 - Z * m), pDn, sRT) - m;
    if (g > 0) { lo = m; glo = g; if (lado === 1) ghi *= 0.5; lado = 1; }
    else { hi = m; ghi = g; if (lado === -1) glo *= 0.5; lado = -1; }
  }
  return m;
}

/** pórtico do cilindro (pressão pc, fixa na amostra) para a ponta de uma linha: ṁ = F(pc, pLinha0 + Z·ṁ) */
export function orificioParaLinha(A: number, pc: number, pL0: number, Z: number, sRT: number, it = 2) {
  const pb = Math.max(2000, pL0);
  const F0 = vazaoV(A, pc, pb, sRT);
  let lo: number, hi: number, glo: number, ghi: number;
  if (F0 >= 0) { lo = 0; glo = F0; hi = F0; ghi = vazaoV(A, pc, Math.max(2000, pb + Z * F0), sRT) - F0; }
  else { hi = 0; ghi = F0; lo = F0; glo = vazaoV(A, pc, Math.max(2000, pb + Z * F0), sRT) - F0; }
  if (glo - ghi < 1e-12) return F0;
  let lado = 0, m = lo;
  for (let k = 0; k < it; k++) {
    m = (lo * ghi - hi * glo) / (ghi - glo);
    if (hi - lo < 1e-5 * (Math.abs(m) + 1e-3)) break;
    const g = vazaoV(A, pc, Math.max(2000, pb + Z * m), sRT) - m;
    if (g > 0) { lo = m; glo = g; if (lado === 1) ghi *= 0.5; lado = 1; }
    else { hi = m; ghi = g; if (lado === -1) glo *= 0.5; lado = -1; }
  }
  return m;
}

/** Mach isentrópico do jato numa razão de pressões pr = p_montante/p_jusante (1 no engasgo) */
export function machJato(pr: number) {
  if (pr <= 1) return 0;
  if (pr >= PR_CRIT) return 1;
  const x = ((pr - 1) / (PR_CRIT - 1)) * (N_MACH - 1), i = x | 0;
  return TAB_MACH[i] + (TAB_MACH[i + 1] - TAB_MACH[i]) * (x - i);
}
/** (tabelado: o Math.pow por amostra pesava no laço) */
const PR_CRIT = 1.853, N_MACH = 512;
const TAB_MACH = new Float64Array(N_MACH + 1);
for (let i = 0; i <= N_MACH; i++) { const pr = 1 + ((PR_CRIT - 1) * Math.min(i, N_MACH - 1)) / (N_MACH - 1); TAB_MACH[i] = Math.min(1, Math.sqrt((2 / (GAM - 1)) * (Math.pow(pr, EXP_M) - 1))); }

/**
 * Mach do jato já expandido até a pressão de jusante (não o da garganta, que para em 1): cresce com a razão de
 * pressões (1,07 em 2:1; 1,6 em 4:1; 2,1 em 9:1). É ele que manda no ruído de um jato engasgado: a mistura cresce
 * com a velocidade do jato expandido, não com a da garganta. Tabelado de 1 a 16.
 */
export function machExpandido(pr: number) {
  if (pr <= 1) return 0;
  const x = (Math.min(pr, PR_MAX) - 1) * ((N_MACH - 1) / (PR_MAX - 1)), i = x | 0;
  return TAB_MEXP[i] + (TAB_MEXP[i + 1] - TAB_MEXP[i]) * (x - i);
}
const PR_MAX = 16;
const TAB_MEXP = new Float64Array(N_MACH + 1);
for (let i = 0; i <= N_MACH; i++) { const pr = 1 + ((PR_MAX - 1) * Math.min(i, N_MACH - 1)) / (N_MACH - 1); TAB_MEXP[i] = Math.sqrt((2 / (GAM - 1)) * (Math.pow(pr, EXP_M) - 1)); }

export interface GeometriaRede {
  nPassagens: number;     // extremidades que escapam pela chaminé
  aPortico: number;       // m², pórtico de escape de uma extremidade (área geométrica)
  dBico: number; lDescarga: number; vCaixa: number; lChamine: number; dChamine: number; kNL: number;
  /** m³: volume do coletor de escape, entre os pórticos e o tubo de descarga (0 = junção sem volume) */
  vColetor?: number;
  condensador: boolean;   // o escape vai ao condensador: a rede só recebe o resto abafado
}

/**
 * A rede inteira, uma amostra por chamada (sem alocação):
 *   1. `ler()`                       — todas as linhas leem as ondas que chegam
 *   2. `injetar(e, pc, A, sRT)`      — o pórtico aberto de cada extremidade (implícito contra a linha) → ṁ_e
 *      ou `fechar(e)`
 *   3. `passo(sRT)`                  — junção, bico, caixa, chaminé, boca e escrita das linhas; devolve a pressão
 *                                      irradiada (unidades da linha, antes da calibração) e deixa o estado do bico
 */
export class RedeEscape {
  fs: number; g: GeometriaRede;
  pass: Line[]; Zp: number;
  desc: Line; Zd: number; jun: Junction;
  cham: Line; Zc: number; rad: Radiator;
  aBico: number; kCaixa: number;
  /** coletor de escape: volume na junção das passagens com o tubo de descarga (Pa manométrico, e c/(V·fs)) */
  pColetor = 0; kColetor = 0; sumYJun = 0;
  linhas: Line[];
  /** estado do bico e da caixa (telemetria e jato) */
  pCaixa = 0;            // Pa manométrico na caixa de fumaça (o Helmholtz de 9–14 Hz, inteiro)
  mJato = 0;             // kg/s pelo bico
  prBico = 1;            // p_descarga/p_caixa
  mach = 0;
  pDesc = 0;             // Pa manométrico na ponta do tubo de descarga
  dPJato = 0;            // Pa, fonte de pressão do jato na base da chaminé
  aCham: number; kMix: number; mix1 = 0; mix2 = 0;
  rngT = new RNG(0x7b0e); kT: number; tb1 = 0; tb2 = 0; lpT = new Biquad();
  /** variação de chuff a chuff (água arrastada, turbulência): o DSP sorteia ±1,3 dB em cada abertura de escape */
  gAlvo = 1; gVar = 1; kVar: number;
  /** desvio relativo da turbulência da mistura (as ferramentas o zeram para isolar o "hoot" do pulso) */
  sigmaTurb = SIGMA_TURB;
  /** (ferramentas) impulso de pressão na base da chaminé e de vazão na caixa, numa amostra */
  impulso = 0; massaExtra = 0;
  // passa-alta de 4 polos em 20 Hz no canal (7.1: o Helmholtz só na telemetria; com 2 polos sobravam −29 dB dele)
  hp = new Biquad(); hp2 = new Biquad();
  constructor(fs: number, g: GeometriaRede) {
    this.fs = fs; this.g = g;
    const esc = (l: number, c: number) => (l * C_LINHA) / c;
    const aP = 1.3 * g.aPortico;
    this.Zp = C_V / aP;
    this.pass = [];
    for (let k = 0; k < g.nPassagens; k++) {
      // (comprimentos levemente diferentes por extremidade: as passagens de cada lado não são iguais)
      const l = new Line(fs, esc(0.4 * (1 + 0.06 * ((k % 4) - 1.5)), C_V), aP, 8000, AMORT_ESCAPE);
      this.pass.push(l);
    }
    this.aBico = (Math.PI / 4) * g.dBico * g.dBico;
    const aD = 1.7 * this.aBico;
    this.Zd = C_V / aD;
    this.desc = new Line(fs, esc(g.lDescarga, C_V), aD * Math.max(1, g.nPassagens / 4), 6000, AMORT_ESCAPE);
    this.desc.kNL = g.kNL;
    this.jun = new Junction([...this.pass.map((l) => port(l, 1)), port(this.desc, 0)]);
    this.sumYJun = this.jun.sumY;
    this.definirColetor(g.vColetor ?? 0);
    const aC = (Math.PI / 4) * g.dChamine * g.dChamine;
    this.aCham = aC;
    this.kMix = onePole(fs, Math.min(400, 300 / Math.max(0.5, g.dChamine / 0.5)));
    this.kT = onePole(fs, 900); this.kVar = onePole(fs, 30); this.lpT.lp(fs, 2500, 0.7071);
    this.Zc = C_Q / aC;
    // chaminé: meia onda c_q/(2·L_ch) (125–190 Hz), Q 2–3 (boca larga e perdas nas paredes: o toque decai em 15–25 ms).
    // A boca reflete quase tudo no grave (R 0,9: é ela que fecha o Helmholtz com a caixa) e o passa-baixa da reflexão
    // (fRad) mais o das paredes atrasam a fase na meia onda; a linha sai encurtada por esse atraso, para a nota ficar
    // em c_q/(2L) como o 1.4 escreve
    const fRad = C_Q / (2 * Math.PI * (g.dChamine / 2));
    const fCh = C_Q / (2 * g.lChamine), w = (2 * Math.PI * fCh) / fs;
    const lag = (fc: number) => { const pl = 1 - onePole(fs, fc); return Math.atan2(pl * Math.sin(w), 1 - pl * Math.cos(w)); };
    // (a perda que dá o Q é a da boca, não a das paredes: uma perda plana nas paredes amortecia também o Helmholtz de
    // 10 Hz, que dá ~13 idas e voltas por período, e ele sumia; a das paredes cresce com √f e é pequena no grave)
    const fRefl = K_REFL * fCh;
    const fi = lag(fRefl) + 2 * lag(5000);
    this.cham = new Line(fs, esc(g.lChamine * (1 - fi / (2 * Math.PI)), C_Q), aC, 5000, 0.2);
    this.rad = new Radiator(fs, this.cham, 1, 1, fRefl, 1, fRad);
    this.rad.R = 0.97;
    // caixa de fumaça: dp/dt = (c_q²/V)·(ṁ_entra − ṁ_chaminé). (O Helmholtz caixa + chaminé, f = c/(2π)·√(A/(V·L_ef)),
    // usa o comprimento com a correção de boca, L + 0,85·D; a guia de onda da chaminé tem só L, que é o que dá a meia
    // onda c/(2L) de 1.4. A correção entra no volume: V·(L + 0,85·D)/L dá o mesmo produto V·L_ef, e a caixa continua
    // um curto para o tom da chaminé)
    this.kCaixa = (C_Q * C_Q) / (g.vCaixa * ((g.lChamine + 0.85 * g.dChamine) / g.lChamine) * fs);
    this.linhas = [...this.pass, this.desc, this.cham];
    this.hp.hp(fs, 20, 0.7071); this.hp2.hp(fs, 20, 0.7071);
  }
  /**
   * Coletor de escape: as passagens dos cilindros não dão direto no tubo de descarga; juntam-se no bloco de escape da
   * sela (e, nas articuladas, nos tubos compridos até a caixa de fumaça), um volume da ordem de meio cilindro. O bico é
   * mais estreito que o pórtico aberto, então cada descarga primeiro enche esse volume e depois ele esvazia pelo bico:
   * o chuff abre menos seco e ganha corpo (dp/dt = (c²/V)·Σ ṁ, integrado de forma implícita na junção; V = 0 dá a
   * junção sem volume do acoustics).
   */
  definirColetor(v: number) { this.kColetor = v > 1e-6 ? C_V / (v * this.fs) : 0; }
  ler() { const L = this.linhas; for (let i = 0; i < L.length; i++) L[i].read(); }
  /** pórtico aberto: área efetiva A (m²), pressão do cilindro pc (Pa abs); devolve ṁ (kg/s, + = sai do cilindro) */
  injetar(e: number, pc: number, A: number, sRT: number) {
    const l = this.pass[e];
    const m = orificioParaLinha(A, pc, P0 + 2 * l.in0, this.Zp, sRT);
    l.out0 = l.in0 + this.Zp * m;
    return m;
  }
  /** vazão imposta (condensador: a rede só recebe o pulso, sem acoplamento) */
  injetarFixo(e: number, m: number) { const l = this.pass[e]; l.out0 = 0.985 * l.in0 + this.Zp * m; }
  fechar(e: number) { const l = this.pass[e]; l.out0 = 0.985 * l.in0; }
  /** pressão na ponta do cilindro de uma passagem (Pa abs), antes da injeção desta amostra */
  pPassagem(e: number) { return P0 + 2 * this.pass[e].in0; }
  passo(sRT: number) {
    if (this.kColetor > 0) {
      const ps = this.pass, d0 = this.desc, k = this.kColetor;
      let acc = d0.Y * d0.in0;
      for (let i = 0; i < ps.length; i++) acc += ps[i].Y * ps[i].in1;
      const P = (this.pColetor + 2 * k * acc) / (1 + k * this.sumYJun);
      this.pColetor = P;
      for (let i = 0; i < ps.length; i++) ps[i].out1 = P - ps[i].in1;
      d0.out0 = P - d0.in0;
    } else this.jun.step();
    // bico: ponta do tubo de descarga → caixa (implícito)
    const d = this.desc, pDn = P0 + this.pCaixa;
    const m = orificioDeLinha(CD_BICO * this.aBico, P0 + 2 * d.in1, this.Zd, pDn, sRT);
    d.out1 = d.in1 - this.Zd * m;
    const pUp = P0 + d.in1 + d.out1;
    this.pDesc = pUp - P0;
    this.mJato = m;
    this.prBico = pUp / pDn;
    this.mach = machJato(this.prBico);
    // jato na saia da chaminé: o fluxo de quantidade de movimento ṁ·U_j/A_ch é uma fonte de PRESSÃO em série na base
    // da chaminé (a bomba de jato que faz a tiragem: o vácuo médio na caixa). É ela que sopra o "hoot" da chaminé; a
    // caixa sozinha, um volume de 2–8 m³, é quase um curto para o tubo e só dá o Helmholtz de 9–14 Hz
    // (a troca de quantidade de movimento se dá ao longo do comprimento de mistura, ~D_ch: passa-baixa de 2 polos em
    // U/(π·D_ch) ≈ 250–300 Hz; sem isso a fonte levava à boca o agudo dos choques do tubo de descarga, 30 dB acima)
    const U = this.mach * C_V, dP0 = m > 0 ? (ETA_JATO * m * U) / this.aCham : 0;
    this.mix1 += this.kMix * (dP0 - this.mix1); this.mix2 += this.kMix * (this.mix1 - this.mix2);
    // turbulência da mistura: a pressão do jato flutua (∝ ρU², Lighthill) e excita os modos da chaminé: é o "hoot"
    // largo de cada chuff, ruído colorido pela meia onda c_q/2L e harmônicos, não um seno
    const t = this.rngT.next() * 2 - 1;
    this.tb1 += this.kT * (t - this.tb1); this.tb2 += this.kT * (this.tb1 - this.tb2);
    const tb = this.lpT.run(this.tb2);
    this.gVar += this.kVar * (this.gAlvo - this.gVar);
    const dP = this.mix2 * (1 + this.sigmaTurb * 3 * tb) * this.gVar + this.impulso;
    this.impulso = 0;
    this.dPJato = dP;
    // caixa (volume) ligada à base da chaminé, implícita: a vazão na chaminé é (p + ΔP − 2·in0)/Z;
    // p(1 + K/Z) = p_ant + K·ṁ − K·(ΔP − 2·in0)/Z
    const c = this.cham, K = this.kCaixa, Z = this.Zc;
    const p = (this.pCaixa + K * (m + this.massaExtra) - (K * (dP - 2 * c.in0)) / Z) / (1 + K / Z);
    this.massaExtra = 0;
    this.pCaixa = p;
    c.out0 = p + dP - c.in0;
    this.rad.step();
    const L = this.linhas; for (let i = 0; i < L.length; i++) L[i].write();
    return this.hp2.run(this.hp.run(this.rad.emit));
  }
}

/**
 * Ruído de jato do bico (1.4): nível ∝ ṁ_j·M_j³ (como a turbulência da válvula do Ronco), envoltória lenta (passa-baixa
 * de 2 kHz: modulado, não multiplicado amostra a amostra pela pressão crua, 7.1); espectro de mistura por Strouhal
 * f = 0,2·U_j/D_bico, passa-banda largo (Q 0,5) que desce dentro do chuff conforme U_j cai, mais dois polos em 7 kHz e
 * um biquad em 9 kHz (o 1.4 pede um polo em 6 kHz; com um só a energia acima de 16 kHz ficava a −37 dB do total, e o
 * teste de aliasing de 7.1 pede < −60).
 * Choque (p_bp/p_cx > 1,9): banda 2–6 kHz (Q 1 em 3,5 kHz) com peso (pr − 1,9) ≤ 1 e um guincho fraco (Q 8 em
 * 1,5·0,2·c_v/D_bico) 12 dB abaixo.
 */
export class JatoBico {
  fs: number; dBico: number;
  rng: RNG; rng2: RNG;
  bp = new Biquad(); kLp: number; lp = 0; lp2 = 0; lpF = new Biquad();
  bpC = new Biquad(); pk = new Biquad();
  kEnv: number; env = 0; wChoque = 0; kCh: number;
  uSuave = 0; fAtual = 0;
  /** amplitude do ruído de mistura e do choque (o choque fica fora da calibração; "Ar" da página) */
  gMistura = 1; gChoque = 1;
  constructor(fs: number, dBico: number, semente: number) {
    this.fs = fs; this.dBico = dBico; this.rng = new RNG(semente); this.rng2 = new RNG(semente ^ 0x3c6ef372);
    this.kLp = onePole(fs, 7000); this.kEnv = onePole(fs, 2000); this.kCh = onePole(fs, 200);
    this.bpC.bp(fs, 3500, 1);
    this.lpF.lp(fs, 9000, 0.7071);
    this.pk.bp(fs, Math.min(0.45 * fs, (1.5 * 0.2 * C_V) / dBico), 8);
    this.ajustar(200);
  }
  ajustar(U: number) {
    const f = Math.max(80, Math.min(9000, (0.2 * U) / this.dBico));
    if (Math.abs(f - this.fAtual) > 0.02 * this.fAtual) { this.fAtual = f; this.bp.bp(this.fs, f, 0.5); }
  }
  /** a cada 64 amostras, com a velocidade do jato média do bloco */
  controle(U: number) { this.uSuave = U; if (this.env > 1e-6) this.ajustar(U); }
  /** uma amostra: m (kg/s), M (Mach), pr (razão de pressões do bico) */
  amostra(m: number, M: number, pr: number) {
    const alvo = m > 0 ? m * M * M * M : 0;
    this.env += this.kEnv * (alvo - this.env);
    const ch = pr > 1.9 ? Math.min(1, pr - 1.9) : 0;
    this.wChoque += this.kCh * (ch - this.wChoque);
    const x = this.rng.next() * 2 - 1;
    let s = this.gMistura * this.bp.run(x);
    if (this.wChoque > 1e-4) {
      const z = this.rng2.next() * 2 - 1;
      s += this.gChoque * this.wChoque * (this.bpC.run(z) + 0.25 * this.pk.run(z));
    }
    // (os dois pelo mesmo corte: 2 polos em 7 kHz e um biquad em 9 kHz; a envoltória multiplica depois do filtro)
    this.lp += this.kLp * (s - this.lp); this.lp2 += this.kLp * (this.lp - this.lp2);
    return this.env * this.lpF.run(this.lp2);
  }
}

/**
 * A caixa de fumaça como cavidade (1.4). Para a vazão média e o grave ela é um volume (a capacitância da `RedeEscape`,
 * o Helmholtz de 9–14 Hz); acima dos primeiros modos (c/L, 250–400 Hz) é um tambor de aço de 1,5–8 m³ com o bico
 * dentro: parte do ruído do jato sobe direto pela chaminé e parte fica batendo entre o espelho dos tubos, a porta e o
 * casco, e pelos tubos de fogo até a fornalha e de volta, e sai pela chaminé depois. É a cauda de cada chuff: o resto
 * do próprio escape, que cai entre uma descarga e a seguinte, e não um sopro ligado o tempo todo.
 *
 * Quatro linhas de atraso realimentadas por uma matriz de Householder (sem perda própria), com os comprimentos tirados
 * do tamanho da caixa (ida e volta 2·∛V/c e múltiplos não inteiros, até a ida e volta dos tubos), um polo de perda no
 * agudo por passagem (12 kHz: aço nu, o agudo dura quase tanto quanto o médio) e o ganho por passagem que dá o tempo de
 * queda `t60` (s, −60 dB).
 * `nivel` (dB) é a potência do campo da cavidade relativa à do som direto para um ruído estacionário. Custo: 4 leituras,
 * 4 polos e 4 escritas por amostra, sem alocação.
 */
export class CaixaRessonante {
  fs: number; mask: number; w = 0;
  buf: Float32Array[]; at: Int32Array; g = new Float64Array(4); s = new Float64Array(4); kLp: number;
  hp = new Biquad(); ganho = 0; t60 = 0; nivel = 0;
  constructor(fs: number, vCaixa: number, t60: number, nivelDb: number) {
    this.fs = fs;
    const L = Math.cbrt(Math.max(0.01, vCaixa));
    // ida e volta na caixa (K4s: 7,6 ms) × 1 · 1,37 · 1,83 · 2,41 (o último ≈ a ida e volta dos tubos de fogo)
    const T0 = (2 * L) / C_Q, razoes = [1, 1.37, 1.83, 2.41];
    this.at = Int32Array.from(razoes, (r, i) => Math.max(8, Math.round(r * T0 * fs) | 1) + 2 * i);
    let size = 64; while (size < this.at[3] + 4) size <<= 1;
    this.mask = size - 1;
    this.buf = [0, 1, 2, 3].map(() => new Float32Array(size));
    this.kLp = onePole(fs, 12000);
    // abaixo do primeiro modo (c/2L, 130 Hz na K4s) a caixa não é cavidade, é volume, e isso já está na rede
    this.hp.hp(fs, Math.min(400, (1.2 * C_Q) / (2 * L)), 0.7071);
    this.definir(t60, nivelDb);
  }
  /** tempo de queda (s) e nível do campo da cavidade (dB re o som direto); t60 ≤ 0 ou nível ≤ −60 desligam */
  definir(t60: number, nivelDb: number) {
    this.t60 = t60; this.nivel = nivelDb;
    if (!(t60 > 0.01) || nivelDb <= -60) { this.ganho = 0; return; }
    for (let i = 0; i < 4; i++) this.g[i] = Math.pow(10, (-3 * this.at[i]) / (t60 * this.fs));
    // normalização: energia da resposta ao impulso (ruído branco na entrada dá essa razão de potência na saída)
    this.zerar();
    this.ganho = 1;
    let e = 0;
    const n = Math.min(4 * this.fs, Math.ceil(1.6 * t60 * this.fs));
    for (let i = 0; i < n; i++) { const y = this.passo(i === 0 ? 1 : 0); e += y * y; }
    this.zerar();
    this.ganho = Math.pow(10, nivelDb / 20) / Math.sqrt(e + 1e-30);
  }
  zerar() { for (const b of this.buf) b.fill(0); this.s.fill(0); this.w = 0; }
  private passo(x: number) {
    const m = this.mask, w = this.w, b = this.buf, at = this.at, s = this.s, g = this.g, k = this.kLp;
    s[0] += k * (b[0][(w - at[0]) & m] - s[0]); s[1] += k * (b[1][(w - at[1]) & m] - s[1]);
    s[2] += k * (b[2][(w - at[2]) & m] - s[2]); s[3] += k * (b[3][(w - at[3]) & m] - s[3]);
    const h = 0.5 * (s[0] + s[1] + s[2] + s[3]);
    b[0][w] = g[0] * (s[0] - h) + x; b[1][w] = g[1] * (s[1] - h) + x; b[2][w] = g[2] * (s[2] - h) + x; b[3][w] = g[3] * (s[3] - h) + x;
    this.w = (w + 1) & m;
    return (s[0] - s[1] + s[2] - s[3]) * this.ganho;
  }
  /** uma amostra: `x` = o ruído do jato (som direto); devolve só a cauda da cavidade */
  amostra(x: number) { return this.ganho === 0 ? 0 : this.passo(this.hp.run(x)); }
}

/**
 * A tiragem que cada chuff induz (1.4): o jato do bico arrasta o gás da caixa de fumaça, e quem repõe esse gás é a
 * coluna que vem da fornalha pelos tubos de fogo. Ela tem inércia (ρ·L/A dos tubos) e resistência quadrática (grelha,
 * leito de fogo, tubos): τ·dq/dt = m − q², com `m` a quantidade de movimento do jato e `q` a vazão do gás, as duas
 * relativas ao regime de referência, e τ ≈ 50 ms (12 m⁻¹ de tubos, 6 kg/s de gás, 1,5 kPa de depressão). Em regime
 * q² = m: o sopro do escoamento (∝ U², ou seja, ∝ q²) acompanha a quantidade de movimento. Depois de cada descarga a
 * coluna segue por inércia e cai como 1/(1 + q₀·t/τ)²: é o sopro que respira com o chuff e morre entre um e outro em
 * baixa velocidade, e que se funde num rugido quando os chuffs vêm a menos de τ um do outro.
 */
export class ColunaDeGas {
  q = 0; k: number;
  constructor(fs: number, tau = 0.05) { this.k = 1 / (tau * fs); }
  /** `m` = quantidade de movimento do jato relativa à de referência; devolve q² (a amplitude relativa do sopro) */
  amostra(m: number) {
    const q = this.q;
    this.q = Math.max(0, q + this.k * ((m > 0 ? m : 0) - q * q));
    return q * q;
  }
}

/**
 * O ataque do chuff: o jato na fresta do pórtico de escape. Quando a válvula descobre o pórtico o cilindro ainda tem
 * 5–10 bar e a passagem está na atmosfera: o vapor passa pela fresta à velocidade do som (engasgado enquanto
 * p_cil/p_passagem > 1,85) e chia dentro da passagem até as pressões se igualarem, o que leva a abertura do pórtico e
 * mais uns 10 ms. É um ruído agudo (a fresta tem centímetros: Strouhal 0,2·c/h de 1,5 kHz para cima), curto, que vem
 * ANTES do pico do jato do bico e some com ele: o "tch" do chuff. Nível ∝ ṁ_pórtico·M³, como o ruído de mistura, com o
 * Mach do jato expandido (`machExpandido`): a 9:1 (corte longo, 8 bar no escape) o estalo é forte; a 2:1 (corte curto)
 * quase não existe, e é por isso que a máquina em velocidade escurece.
 */
export class RuidoPortico {
  rng: RNG; bp = new Biquad(); lp = new Biquad(); lp2 = new Biquad(); env = 0; kEnv: number;
  constructor(fs: number, semente: number) {
    this.rng = new RNG(semente); this.kEnv = onePole(fs, 2000);
    // (4 polos em 7 kHz: a passagem, o tubo de descarga e a chaminé comem o agudo, e com 2 só a energia acima de 16 kHz
    // passava de −60 dB do total a 21 chuffs/s, o teste de aliasing de 7.1)
    this.bp.bp(fs, 3000, 0.6); this.lp.lp(fs, 7000, 0.7071); this.lp2.lp(fs, 7000, 0.7071);
  }
  /** `n` = Σ ṁ·M³ dos pórticos abertos (kg/s) */
  amostra(n: number) {
    this.env += this.kEnv * (n - this.env);
    const x = this.rng.next() * 2 - 1;
    return this.env * this.lp2.run(this.lp.run(this.bp.run(x)));
  }
}
