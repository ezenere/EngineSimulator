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
import { Line, Junction, Radiator, Biquad, RNG, psi, port, onePole } from '../../acoustics';
import { P0, C_V, C_Q, C_LINHA, CD_BICO } from './constantes';

const GAM = 1.33;
/** fração do fluxo de quantidade de movimento do jato que vira pressão na saia da chaminé (mistura e perdas) */
const ETA_JATO = 0.5;
/** desvio relativo da pressão turbulenta na mistura do jato (a parte que a chaminé ressoa) */
const SIGMA_TURB = 0.8;
const EXP_M = (GAM - 1) / GAM;

/** vazão mássica (kg/s, com sinal de a para b) por uma área efetiva A, vapor de √(R·T) = `sRT` */
export function vazaoV(A: number, pa: number, pb: number, sRT: number) {
  if (pa >= pb) return (A * pa * psi(pb / pa)) / sRT;
  return (-A * pb * psi(pa / pb)) / sRT;
}

/**
 * Orifício entre uma ponta de linha e um lado fixo: resolve ṁ = vazaoV(A, pUp0 + kUp·ṁ, pDn, sRT) por regula falsi
 * (Illinois), como o `exhaustFlow` do Ronco. A explícita (pressão da linha sem o ṁ desta amostra) é instável perto do
 * equilíbrio: o ganho de malha Z·dṁ/dp passa de 1 com a Ψ linearizada. `kUp` é −Z (a vazão sai da linha) ou +Z
 * (entra na linha pelo lado de baixo: o pórtico do cilindro, em que a linha é o lado de baixo, usa `orificioParaLinha`).
 */
export function orificioDeLinha(A: number, pUp0: number, Z: number, pDn: number, sRT: number, it = 6) {
  // g(m) = F(pUp0 − Z·m) − m, decrescente em m
  const F0 = vazaoV(A, pUp0, pDn, sRT);
  let lo: number, hi: number, glo: number, ghi: number;
  if (F0 >= 0) { lo = 0; glo = F0; hi = F0; ghi = vazaoV(A, Math.max(2000, pUp0 - Z * F0), pDn, sRT) - F0; }
  else { hi = 0; ghi = F0; lo = F0; glo = vazaoV(A, Math.max(2000, pUp0 - Z * F0), pDn, sRT) - F0; }
  if (glo - ghi < 1e-12) return F0;
  let lado = 0, m = lo;
  for (let k = 0; k < it; k++) {
    m = (lo * ghi - hi * glo) / (ghi - glo);
    const g = vazaoV(A, Math.max(2000, pUp0 - Z * m), pDn, sRT) - m;
    if (g > 0) { lo = m; glo = g; if (lado === 1) ghi *= 0.5; lado = 1; }
    else { hi = m; ghi = g; if (lado === -1) glo *= 0.5; lado = -1; }
  }
  return m;
}

/** pórtico do cilindro (pressão pc, fixa na amostra) para a ponta de uma linha: ṁ = F(pc, pLinha0 + Z·ṁ) */
export function orificioParaLinha(A: number, pc: number, pL0: number, Z: number, sRT: number, it = 6) {
  const pb = Math.max(2000, pL0);
  const F0 = vazaoV(A, pc, pb, sRT);
  let lo: number, hi: number, glo: number, ghi: number;
  if (F0 >= 0) { lo = 0; glo = F0; hi = F0; ghi = vazaoV(A, pc, Math.max(2000, pb + Z * F0), sRT) - F0; }
  else { hi = 0; ghi = F0; lo = F0; glo = vazaoV(A, pc, Math.max(2000, pb + Z * F0), sRT) - F0; }
  if (glo - ghi < 1e-12) return F0;
  let lado = 0, m = lo;
  for (let k = 0; k < it; k++) {
    m = (lo * ghi - hi * glo) / (ghi - glo);
    const g = vazaoV(A, pc, Math.max(2000, pb + Z * m), sRT) - m;
    if (g > 0) { lo = m; glo = g; if (lado === 1) ghi *= 0.5; lado = 1; }
    else { hi = m; ghi = g; if (lado === -1) glo *= 0.5; lado = -1; }
  }
  return m;
}

/** Mach isentrópico do jato numa razão de pressões pr = p_montante/p_jusante (1 no engasgo) */
export function machJato(pr: number) {
  if (pr <= 1) return 0;
  if (pr >= 1.853) return 1;
  return Math.sqrt((2 / (GAM - 1)) * (Math.pow(pr, EXP_M) - 1));
}

export interface GeometriaRede {
  nPassagens: number;     // extremidades que escapam pela chaminé
  aPortico: number;       // m², pórtico de escape de uma extremidade (área geométrica)
  dBico: number; lDescarga: number; vCaixa: number; lChamine: number; dChamine: number; kNL: number;
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
  linhas: Line[];
  /** estado do bico e da caixa (telemetria e jato) */
  pCaixa = 0;            // Pa manométrico na caixa de fumaça (o Helmholtz de 9–14 Hz, inteiro)
  mJato = 0;             // kg/s pelo bico
  prBico = 1;            // p_descarga/p_caixa
  mach = 0;
  pDesc = 0;             // Pa manométrico na ponta do tubo de descarga
  dPJato = 0;            // Pa, fonte de pressão do jato na base da chaminé
  aCham: number; kMix: number; mix1 = 0; mix2 = 0;
  rngT = new RNG(0x7b0e); kT: number; tb1 = 0; tb2 = 0;
  /** variação de chuff a chuff (água arrastada, turbulência): o DSP sorteia ±1,3 dB em cada abertura de escape */
  gAlvo = 1; gVar = 1; kVar: number;
  // passa-alta de 2 polos em 20 Hz no canal (7.1: o Helmholtz só na telemetria)
  hp = new Biquad();
  constructor(fs: number, g: GeometriaRede) {
    this.fs = fs; this.g = g;
    const esc = (l: number, c: number) => (l * C_LINHA) / c;
    const aP = 1.3 * g.aPortico;
    this.Zp = C_V / aP;
    this.pass = [];
    for (let k = 0; k < g.nPassagens; k++) {
      // (comprimentos levemente diferentes por extremidade: as passagens de cada lado não são iguais)
      const l = new Line(fs, esc(0.4 * (1 + 0.06 * ((k % 4) - 1.5)), C_V), aP, 8000, 1.5);
      this.pass.push(l);
    }
    this.aBico = (Math.PI / 4) * g.dBico * g.dBico;
    const aD = 1.7 * this.aBico;
    this.Zd = C_V / aD;
    this.desc = new Line(fs, esc(g.lDescarga, C_V), aD * Math.max(1, g.nPassagens / 4), 6000, 1.5);
    this.desc.kNL = g.kNL;
    this.jun = new Junction([...this.pass.map((l) => port(l, 1)), port(this.desc, 0)]);
    const aC = (Math.PI / 4) * g.dChamine * g.dChamine;
    this.aCham = aC;
    this.kMix = onePole(fs, Math.min(400, 300 / Math.max(0.5, g.dChamine / 0.5)));
    this.kT = onePole(fs, 900); this.kVar = onePole(fs, 30);
    this.Zc = C_Q / aC;
    // chaminé: meia onda c_q/(2·L_ch) (125–190 Hz), Q 2–3 (boca larga e perdas: o toque decai em 15–20 ms)
    this.cham = new Line(fs, esc(g.lChamine, C_Q), aC, 5000, 2.2);
    // boca: monopolo com fRad = c/(2πa); reflexão fraca (o jato sai pela boca: a onda volta pouco)
    const fRad = C_Q / (2 * Math.PI * (g.dChamine / 2));
    this.rad = new Radiator(fs, this.cham, 1, 1, fRad, 1, fRad);
    this.rad.R = 0.4;
    // caixa de fumaça: dp/dt = (c_q²/V)·(ṁ_entra − ṁ_chaminé)
    this.kCaixa = (C_Q * C_Q) / (g.vCaixa * fs);
    this.linhas = [...this.pass, this.desc, this.cham];
    this.hp.hp(fs, 20, 0.7071);
  }
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
    this.jun.step();
    // bico: ponta do tubo de descarga → caixa (implícito)
    const d = this.desc, pDn = P0 + this.pCaixa;
    const m = orificioDeLinha(CD_BICO * this.aBico, P0 + 2 * d.in1, this.Zd, pDn, sRT, 5);
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
    this.gVar += this.kVar * (this.gAlvo - this.gVar);
    const dP = this.mix2 * (1 + SIGMA_TURB * 3 * this.tb2) * this.gVar;
    this.dPJato = dP;
    // caixa (volume) ligada à base da chaminé, implícita: a vazão na chaminé é (p + ΔP − 2·in0)/Z;
    // p(1 + K/Z) = p_ant + K·ṁ − K·(ΔP − 2·in0)/Z
    const c = this.cham, K = this.kCaixa, Z = this.Zc;
    const p = (this.pCaixa + K * m - (K * (dP - 2 * c.in0)) / Z) / (1 + K / Z);
    this.pCaixa = p;
    c.out0 = p + dP - c.in0;
    this.rad.step();
    const L = this.linhas; for (let i = 0; i < L.length; i++) L[i].write();
    return this.hp.run(this.rad.emit);
  }
}

/**
 * Ruído de jato do bico (1.4): nível ∝ ṁ_j·M_j³ (como a turbulência da válvula do Ronco), envoltória lenta (passa-baixa
 * de 2 kHz: modulado, não multiplicado amostra a amostra pela pressão crua, 7.1); espectro de mistura por Strouhal
 * f = 0,2·U_j/D_bico, passa-banda largo (Q 0,5) que desce dentro do chuff conforme U_j cai, mais um polo em 6 kHz.
 * Choque (p_bp/p_cx > 1,9): banda 2–6 kHz (Q 1 em 3,5 kHz) com peso (pr − 1,9) ≤ 1 e um guincho fraco (Q 8 em
 * 1,5·0,2·c_v/D_bico) 12 dB abaixo.
 */
export class JatoBico {
  fs: number; dBico: number;
  rng: RNG; rng2: RNG;
  bp = new Biquad(); kLp: number; lp = 0;
  bpC = new Biquad(); pk = new Biquad();
  kEnv: number; env = 0; wChoque = 0; kCh: number;
  uSuave = 0; fAtual = 0;
  /** amplitude do ruído de mistura e do choque (o choque fica fora da calibração; "Ar" da página) */
  gMistura = 1; gChoque = 1;
  constructor(fs: number, dBico: number, semente: number) {
    this.fs = fs; this.dBico = dBico; this.rng = new RNG(semente); this.rng2 = new RNG(semente ^ 0x3c6ef372);
    this.kLp = onePole(fs, 6000); this.kEnv = onePole(fs, 2000); this.kCh = onePole(fs, 200);
    this.bpC.bp(fs, 3500, 1);
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
    let y = this.bp.run(x);
    this.lp += this.kLp * (y - this.lp); y = this.lp;
    let s = this.gMistura * this.env * y;
    if (this.wChoque > 1e-4) {
      const z = this.rng2.next() * 2 - 1;
      s += this.gChoque * this.env * this.wChoque * (this.bpC.run(z) + 0.25 * this.pk.run(z));
    }
    return s;
  }
}
