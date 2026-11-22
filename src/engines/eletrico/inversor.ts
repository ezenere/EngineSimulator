// Inversor (ELETRICO.md 1.2): PWM senoidal por amostragem natural (Holmes & Lipo), grupos de portadora m·f_c com bandas
// laterais n·f_e (m + n ímpar) de amplitude |J_n(mπM/2)|/m (a tensão; a corrente leva mais 1/m), a força sonora
// proporcional a I/I_n (corrente × fluxo) e à curva da carcaça. Seis modos (decisão 3): assíncrona fixa, escada (o
// do-re-mi do Taurus por limiares de f_e), síncrona (f_c = N·f_e, N numa lista decrescente), auto (assíncrona até
// f_c/f_e < N_max, depois a lista síncrona), aleatória (ruído passa-banda em f_c e 2f_c com a energia da tabela de
// Bessel) e chopper de CC (f_ch fixa, ondulação ∝ D(1 − D)·I). Cada troca de modo, de N ou de nota muda a "geração"
// das chaves: o banco faz o crossfade de potência constante de 20 ms. O conversor auxiliar (`Auxiliar`) dá as linhas
// fixas do trem parado.
import type { PresetEletrico } from './dsp';
import type { EstadoMaquina } from './maquina';
import { pesoLaterais } from './maquina';
import type { ListaLinhas } from './linhas';
import { RNG } from '../../acoustics/rng';
import { Bq, rmsCadeia } from '../../scene/filtros';
import { TAU, MEC, chave, F_CARC, F_CARC_LP, I_VAZIO, ESCADA_F0, ESCADA_DELTA, NOTAS_TAURUS, PATAMAR_TAURUS, type Relevo } from './constantes';

export type ModoModulacao = 'assincrona' | 'escada' | 'sincrona' | 'auto' | 'aleatoria' | 'chopper';
/** modo que está tocando (com os casos que não são escolha do usuário) */
export type ModoEfetivo = ModoModulacao | 'csi' | 'bloco' | 'desligado';

// ---------------------------------------------------------------- Bessel
/** J_n(x) pela série (x ≤ 3π/2 + folga: 40 termos sobram) */
export function besselJ(n: number, x: number) {
  n = Math.abs(n);
  let termo = 1;
  for (let k = 1; k <= n; k++) termo *= x / 2 / k;
  let s = 0;
  const q = -(x * x) / 4;
  for (let k = 0; k < 40; k++) {
    s += termo;
    termo *= q / ((k + 1) * (k + 1 + n));
    if (Math.abs(termo) < 1e-16 * Math.abs(s)) break;
  }
  return s;
}
const NT = 512, XMAX = 2 * Math.PI;
/** tabela J_n(x) para n = 0..5, x de 0 a 2π */
const TAB_J: Float64Array[] = Array.from({ length: 6 }, (_, n) => { const t = new Float64Array(NT + 1); for (let i = 0; i <= NT; i++) t[i] = besselJ(n, (i / NT) * XMAX); return t; });
export function jTab(n: number, x: number) {
  const t = TAB_J[Math.abs(n)], u = Math.min(NT - 1e-9, Math.max(0, (x / XMAX) * NT)), i = u | 0, f = u - i;
  return t[i] + (t[i + 1] - t[i]) * f;
}
/** referência da tabela de 1.2: a linha f_c com M = 0,2 (J₀(0,1π)) */
export const J_REF = besselJ(0, 0.1 * Math.PI);
/** dB da tensão de uma linha (m, n) com índice M, como a tabela de 1.2 (sem o 1/m extra da corrente) */
export function dbTensao(m: number, n: number, M: number) { return 20 * Math.log10(Math.abs(jTab(n, (m * Math.PI * M) / 2)) / m / J_REF); }

/** bandas laterais por grupo: m ímpar → n par; m par → n ímpar (|n| ≤ 4) */
const LAT_N = [[0, 0], [2, 4], [1, 3], [2, 4]];
const dB20 = (x: number) => Math.pow(10, x / 20);
const DB_CSI = [1, dB20(-8), dB20(-16)];
const DB_HARM = [1, dB20(-4), dB20(-8), dB20(-12), dB20(-16)];
const BLOCO_N = [6, 12, 5, 7], BLOCO_A = [1, dB20(-8), dB20(-14), dB20(-14)];
/**
 * A força que soa é o produto da ondulação de corrente do chaveamento pelo fluxo fundamental (1.2: "mais ± f_e"): cada
 * harmônico de tensão em f vira, na carcaça, o par f − f_e e f + f_e, com um resto no centro (o que a ondulação faz
 * sozinha: reatores, barramentos). O par bate a 2·f_e: é o tremor do tom do inversor, que acelera com a velocidade (medido
 * no patamar do Taurus: a envoltória de 560–640 Hz pulsa a 8–14 Hz, com vales de 15–25 dB, onde uma senoide parada dava
 * 3 dB). O fluxo é um só: o par de cada harmônico nasce com as fases θ − ψ e θ + ψ, ψ = a fase do fluxo fundamental, e
 * todos os harmônicos da portadora pulsam JUNTOS (um tremor do tom inteiro, não um vaivém entre harmônicos). Com
 * f_e → 0 os três caem na mesma frequência e o banco os soma em potência (sem salto). Potência média conservada:
 * K_CENTRO² + 2·K_PAR² = 1.
 */
const K_CENTRO = 0.15, K_PAR = Math.sqrt((1 - K_CENTRO * K_CENTRO) / 2);
/** fase da portadora de uma linha (rad), fixa pela chave: mistura de 32 bits */
function faseDe(k: number, sem: number) { let h = Math.imul(k ^ sem, 0x9e3779b1); h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; return ((h >>> 0) * 2.3283064365386963e-10) * TAU; }

export class Inversor {
  p: PresetEletrico; fs: number;
  modo: ModoEfetivo = 'desligado';
  fc = 0; N = 0; nota = -1; gen = 0;
  /** modo pedido pelo comando (null = o do preset) */
  pedido: ModoModulacao | null = null;
  // ruído do random PWM e o clique do chopper
  private rng: RNG;
  private bq = [new Bq(), new Bq()];
  private norm = [0, 0];
  private gR = [0, 0]; private gR0 = [0, 0];
  private fcRuido = -1; private qRuido = -1;
  private clique = 0; private gClique = 0; private bqC = new Bq();
  private dAnt = 0; private aChopAnt = 0;
  /** soma de a² dos grupos 1 e 2 (para o ruído do random PWM) */
  private eG = [0, 0];

  private permitidosP: ModoModulacao[];
  /** relevo da carcaça (modos) nas linhas que varrem; null = curva lisa */
  relevo: Relevo | null;
  constructor(p: PresetEletrico, fs: number, semente: number, relevo: Relevo | null = null) {
    this.p = p; this.fs = fs; this.rng = new RNG(semente); this.relevo = relevo;
    const sf = (semente * 2654435761) >>> 0;
    for (let k = 0; k < 4096; k++) this.tabFase[k] = faseDe(k, sf);
    this.permitidosP = Inversor.permitidos(p);
    this.bqC.bp(fs, 800, 1);
  }

  /** modos que o preset permite (chips da página) */
  static permitidos(p: PresetEletrico): ModoModulacao[] {
    const inv = p.inversor;
    if (!inv) return [];
    if (inv.tipo === 'chopper' || inv.modo === 'chopper') return ['chopper'];
    if (inv.tipo === 'csi') return [inv.modo];
    const m: ModoModulacao[] = ['auto', 'assincrona'];
    if (inv.escada) m.push('escada');
    if (inv.sincrona?.length) m.push('sincrona');
    m.push('aleatoria');
    return m;
  }

  private fcMax() { const inv = this.p.inversor!; return inv.fcMax ?? inv.fc * 1.2; }
  /** N da lista síncrona para esta f_e: o maior N com N·f_e ≤ f_c,max (histerese de 1%) */
  private escolherN(fe: number) {
    const lista = this.p.inversor!.sincrona ?? [1], fm = this.fcMax();
    if (this.modo === 'sincrona' && this.N > 0 && lista.includes(this.N)) {
      // fica no N atual enquanto couber e enquanto o anterior (maior) não couber com folga
      const i = lista.indexOf(this.N);
      const cabe = this.N * fe <= fm * 1.01;
      const maior = i > 0 && lista[i - 1] * fe <= fm * 0.99;
      if (cabe && !maior) return this.N;
    }
    for (const N of lista) if (N * fe <= fm) return N;
    return lista[lista.length - 1];
  }

  /** decide o modo, f_c, N e a nota do bloco (e muda a geração das chaves numa troca) */
  atualizar(e: EstadoMaquina, ligado: boolean) {
    const inv = this.p.inversor;
    const ant = this.modo, antN = this.N, antNota = this.nota, antFc = this.fc;
    if (!inv || !ligado) { this.modo = 'desligado'; this.fc = 0; this.N = 0; this.nota = -1; }
    else if (inv.tipo === 'csi') { this.modo = 'csi'; this.fc = 0; this.N = 6; this.nota = -1; }
    else {
      const pedido = this.pedido && this.permitidosP.includes(this.pedido) ? this.pedido : inv.modo;
      const fe = Math.abs(e.fe), lista = inv.sincrona ?? [];
      const Nmax = lista.length ? lista[0] : Infinity;
      this.nota = -1;
      if (pedido === 'chopper') { this.modo = 'chopper'; this.fc = inv.fc; this.N = 0; }
      else if (pedido === 'aleatoria') { this.modo = 'aleatoria'; this.fc = inv.fc; this.N = 0; }
      else if (pedido === 'assincrona') { this.modo = 'assincrona'; this.fc = inv.fc; this.N = 0; }
      else if (pedido === 'sincrona') { this.modo = 'sincrona'; this.N = this.escolherN(fe); this.fc = this.N * fe; }
      else {
        // escada (do-re-mi) e auto: assíncrona (por degraus ou fixa) até f_c/f_e < N_max, depois a lista síncrona
        let fcA = inv.fc, nota = -1;
        if (pedido === 'escada' && inv.escada) {
          const es = inv.escada, f0 = es.f0 ?? ESCADA_F0, d = es.delta ?? ESCADA_DELTA, notas = es.notas ?? NOTAS_TAURUS;
          let k = Math.floor((fe - f0) / d);
          // histerese de 0,02 Hz nos limiares
          if (antNota >= 0 && k !== antNota && Math.abs(fe - (f0 + Math.max(k, antNota) * d)) < 0.02) k = antNota;
          if (k < notas.length) { nota = Math.max(0, k); fcA = notas[nota]; }
          else { nota = notas.length; fcA = es.patamar ?? PATAMAR_TAURUS; }
        }
        const sinc = lista.length > 0 && (ant === 'sincrona' ? fcA / fe < Nmax * 1.01 : fcA / fe < Nmax);
        if (sinc) { this.modo = 'sincrona'; this.N = this.escolherN(fe); this.fc = this.N * fe; }
        else { this.modo = pedido === 'escada' && inv.escada ? 'escada' : 'assincrona'; this.fc = fcA; this.N = 0; this.nota = nota; }
      }
      if (this.modo === 'sincrona' && this.N === 1) this.modo = 'bloco';
    }
    if (this.modo !== ant || this.N !== antN || this.nota !== antNota || (this.modo !== 'sincrona' && this.modo !== 'bloco' && Math.abs(this.fc - antFc) > 0.5)) this.gen = (this.gen + 1) & 15;
    // clique do chopper ao chegar em D = 1 (série plena) e ao sair
    if (this.modo === 'chopper') {
      const D = e.D;
      if ((D >= 0.999) !== (this.dAnt >= 0.999) && this.aChopAnt > 0) { this.clique = Math.round(0.02 * this.fs); this.gClique = this.aChopAnt; }
      this.dAnt = D;
    }
  }

  /** fase do fluxo fundamental (rad), integrada a cada bloco de controle */
  private psi = 0;
  /** fase da portadora de cada linha (rad), fixa pela chave: tabela montada uma vez (nada é calculado por linha no laço) */
  private tabFase = new Float64Array(4096);
  /** potência das laterais que encostaram no centro e potência total das laterais, por grupo (rascunho do bloco) */
  private potM = new Float64Array(16); private potLatM = new Float64Array(16);
  /** uma linha de tensão em f: sozinha (testes de tensão) ou o par acústico f ± f_e com o resto no centro. Só a amplitude
   *  de tensão: a curva da carcaça e o relevo entram depois, de uma vez (`carcaca` e `Relevo.aplicar`) */
  private par(L: ListaLinhas, k: number, acustico: boolean) {
    // (frequência, amplitude e f_e vêm em campos, não em argumentos: um número passado a uma chamada não embutida vai
    // para uma caixa, e isto roda ~15 vezes por unidade a cada bloco de controle)
    const f = this.pF, a = this.pA, fe = this.pFe;
    if (!(a > 0)) return;
    const lc = L.chave, lf = L.f, la = L.a, lz = L.fase;
    let n = L.n;
    if (!acustico) { if (n < L.cap) { lc[n] = chave(MEC.portadora, k); lf[n] = f < 0 ? -f : f; la[n] = a; lz[n] = NaN; L.n = n + 1; } return; }
    if (n + 3 > L.cap) return;
    const th = this.tabFase[k & 0xfff], ps = this.psi, fm = f - fe, fp = f + fe;
    lc[n] = chave(MEC.portadora, k); lf[n] = f < 0 ? -f : f; la[n] = a * K_CENTRO; lz[n] = f < 0 ? Math.PI - th : th; n++;
    lc[n] = chave(MEC.portadora, k | 0x1000); lf[n] = fm < 0 ? -fm : fm; la[n] = a * K_PAR; lz[n] = fm < 0 ? Math.PI - (th - ps) : th - ps; n++;
    lc[n] = chave(MEC.portadora, k | 0x2000); lf[n] = fp < 0 ? -fp : fp; la[n] = a * K_PAR; lz[n] = fp < 0 ? Math.PI - (th + ps) : th + ps; n++;
    L.n = n;
  }
  private pF = 0; private pA = 0; private pFe = 0;
  /** multiplica as linhas [de, ate) pela curva da carcaça (um laço, sem chamada por linha) */
  private carcaca(L: ListaLinhas, de: number, ate: number, fcar: number) {
    if (fcar === 0) return;
    const f = L.f, a = L.a, iq = 1 / F_CARC_LP;
    for (let i = de; i < ate; i++) { const r = f[i] / fcar, r4 = r * r * r * r, q = f[i] * iq; a[i] *= Math.sqrt(r4 / (1 + r4)) / Math.sqrt(1 + q * q); }
  }

  /** linhas do bloco (tensão → corrente → força × curva da carcaça), em unidades relativas (sem alocação: sem fechos) */
  linhas(e: EstadoMaquina, L: ListaLinhas, det = 1, soTensao = false) {
    const inv = this.p.inversor;
    this.eG[0] = this.eG[1] = 0;
    if (!inv || this.modo === 'desligado') return;
    const fcar = soTensao ? 0 : F_CARC[this.p.carcaca];
    const gI = soTensao ? 1 : Math.max(e.I, I_VAZIO);
    const fe = e.fe * det, g = this.gen << 8;
    const rv = soTensao ? null : this.relevo;
    const n0 = L.n;
    // fase do fluxo (um bloco de controle por chamada): o par f ± f_e de cada harmônico nasce amarrado a ela
    this.psi += (TAU * fe * 64) / this.fs; if (this.psi > TAU) this.psi -= TAU; else if (this.psi < 0) this.psi += TAU;
    if (this.modo === 'csi') {
      // inversor de corrente (TGV): sem portadora; 6f_e dominante, 12f_e −8, 18f_e −16, e o chopper de entrada
      for (let h = 1; h <= 3; h++) L.por(chave(MEC.csi, h), 6 * h * fe, gI * DB_CSI[h - 1]);
      const n1 = L.n;
      const fch = inv.fcEntrada ?? 300;
      for (let h = 1; h <= 3; h++) L.por(chave(MEC.chopper, h), h * fch, 0.3 * gI * DB_HARM[h - 1]);
      this.carcaca(L, n0, L.n, fcar);
      if (rv !== null) rv.aplicar(L, n0, n1);
      return;
    }
    if (this.modo === 'chopper') {
      // ondulação ΔI ∝ D(1 − D)·I (máxima em D = 0,5), f_ch … 5f_ch a −4 dB por harmônico; some em D = 1
      const D = e.D;
      const a = D >= 0.999 ? 0 : 4 * D * (1 - D) * gI;
      this.aChopAnt = a;
      if (a > 0) for (let h = 1; h <= 5; h++) L.por(chave(MEC.chopper, (this.gen << 4) | h), h * inv.fc, a * DB_HARM[h - 1]);
      this.carcaca(L, n0, L.n, fcar);
      return;
    }
    if (this.modo === 'bloco') {
      // onda quadrada (N = 1): sem portadora; 6f_e da 5ª e 7ª da corrente, 12f_e −8, 5f_e e 7f_e −14 (≈ a f_c com M = 1)
      const a0 = (Math.abs(jTab(0, Math.PI / 2)) / J_REF) * gI;
      for (let i = 0; i < BLOCO_N.length; i++) { const o = BLOCO_N[i]; L.por(chave(MEC.bloco, (this.gen << 6) | o), o * fe, a0 * BLOCO_A[i]); }
      this.carcaca(L, n0, L.n, fcar);
      if (rv !== null) rv.aplicar(L, n0, L.n);
      return;
    }
    const M = e.M, fc = this.fc, ac = !soTensao;
    const perfil = inv.perfilGrupos;
    // o perfil medido (Taurus, bonde) já é acústico: traz o relevo da carcaça de verdade, e a portadora não varre
    const rvP = perfil && this.modo !== 'sincrona' ? null : rv;
    const mMax = perfil ? Math.max(3, perfil.length) : 3;
    const a10 = Math.abs(jTab(0, (Math.PI * M) / 2)) / J_REF;    // f_c (tensão)
    const PM = this.potM, PL = this.potLatM;
    // 1) as laterais m·f_c ± n·f_e (m + n ímpar): cada uma com a curva da carcaça na própria frequência
    for (let m = 1; m <= mMax; m++) {
      const fm = m * fc;
      // linha central (n = 0 só existe com m ímpar)
      const centro = m % 2 === 1 && m <= 3 ? Math.abs(jTab(0, (m * Math.PI * M) / 2)) / m / J_REF : 0;
      let pot = centro * centro, potLat = 0;
      const corr = soTensao ? 1 : 1 / m;          // corrente: mais 1/m
      if (m <= 3) for (let q = 0; q < 2; q++) {
        const n = LAT_N[m][q];
        const av = Math.abs(jTab(n, (m * Math.PI * M) / 2)) / m / J_REF;
        const w = pesoLaterais((n * fe) / 2);
        potLat += 2 * av * av;
        if (w > 0) {
          this.pA = av * Math.sqrt(w) * corr * gI; this.pFe = fe;
          this.pF = fm + n * fe; this.par(L, g | (m << 4) | (n + 8), ac);
          this.pF = fm - n * fe; this.par(L, g | (m << 4) | (8 - n), ac);
        }
        pot += 2 * av * av * (1 - w);
      }
      PM[m] = pot; PL[m] = potLat;
    }
    const n1 = L.n;
    this.carcaca(L, n0, n1, fcar);
    // 2) os centros dos grupos, com a curva da carcaça do grupo (f_e é pequeno perto de m·f_c)
    const rc = fc / (fcar || 1), rc4 = rc * rc * rc * rc, qc = fc / F_CARC_LP, hFc = fcar === 0 ? 1 : Math.sqrt(rc4 / (1 + rc4)) / Math.sqrt(1 + qc * qc);
    for (let m = 1; m <= mMax; m++) {
      const fm = m * fc, corr = soTensao ? 1 : 1 / m;
      let acm = Math.sqrt(PM[m]) * corr;
      // perfil medido (GTO em escada, Taurus; bonde): os grupos m·f_c ficam no nível das gravações (a tabela de Bessel com
      // M ≈ 0,1 dá 2f_c a −22 dB e nenhum 4f_c, contra −4..−9 e −3..−10 dB medidos: o padrão de pulsos do GTO com poucos
      // pulsos por período não é o PWM senoidal). O perfil é acústico, como foi medido: relativo à linha f_c já com a carcaça.
      const rm = fm / (fcar || 1), rm4 = rm * rm * rm * rm, qm = fm / F_CARC_LP;
      let hm = fcar === 0 ? 1 : Math.sqrt(rm4 / (1 + rm4)) / Math.sqrt(1 + qm * qm);
      if (perfil && m <= perfil.length) {
        const ap = a10 * Math.pow(10, perfil[m - 1] / 20);
        if (ap * hFc > acm * hm) hm = hFc;
        if (ap > acm) acm = ap;
      }
      if (acm > 0) { this.pF = fm; this.pA = acm * gI * hm; this.pFe = fe; this.par(L, g | (m << 4) | 8, ac); }
      if (m <= 2) this.eG[m - 1] = (acm * acm + PL[m] * corr * corr) * gI * gI * hm * hm * 0.5;
    }
    if (rvP !== null) rvP.aplicar(L, n0, L.n);
  }

  /** o random PWM troca as linhas de f_c e 2f_c por ruído: devolve true se o banco não deve receber as linhas */
  get ruidoso() { return this.modo === 'aleatoria'; }

  /**
   * Ruído do bloco (random PWM e o clique do chopper), somado em `out`. `escala` = kAbs do canal. Recalcula os
   * passa-bandas só quando f_c ou δ mudam (fora do caminho normal: na troca de preset ou no painel avançado).
   */
  ruido(out: Float32Array, off: number, n: number, escala: number, inicioBloco: boolean) {
    const inv = this.p.inversor;
    if (inicioBloco) {
      this.gR0[0] = this.gR[0]; this.gR0[1] = this.gR[1];
      if (this.modo === 'aleatoria' && inv) {
        const d = inv.delta ?? 0.1, q = 1 / (2 * d);
        if (this.fcRuido !== this.fc || this.qRuido !== q) {
          this.fcRuido = this.fc; this.qRuido = q;
          for (let m = 0; m < 2; m++) { this.bq[m].bp(this.fs, (m + 1) * this.fc, q); this.norm[m] = 1 / Math.max(1e-9, rmsCadeia(this.fs, [this.bq[m]], 1 / 3, false, 8)); }
        }
        // mesma energia das linhas da tabela de Bessel (grupos m = 1 e 2), nada acima de 0,45·fs
        for (let m = 0; m < 2; m++) this.gR[m] = (m + 1) * this.fc < 0.45 * this.fs ? Math.sqrt(this.eG[m]) * this.norm[m] * escala : 0;
      } else { this.gR[0] = 0; this.gR[1] = 0; }
    }
    const r = this.rng;
    for (let m = 0; m < 2; m++) {
      const g1 = this.gR[m], g0 = this.gR0[m];
      if (g1 === 0 && g0 === 0) continue;
      const b = this.bq[m];
      for (let k = 0; k < n; k++) { const t = (k + 1) / n; out[off + k] += (g0 + (g1 - g0) * t) * b.run(r.bi()); }
      this.gR0[m] = g1;
    }
    if (this.clique > 0) {
      const tau = 0.006 * this.fs, a = this.gClique * escala * 2;
      for (let k = 0; k < n && this.clique > 0; k++, this.clique--) out[off + k] += a * Math.exp(-(0.02 * this.fs - this.clique) / tau) * this.bqC.run(r.bi());
    }
  }
}

/**
 * Conversor auxiliar (1.2): o inversor estático dos ventiladores e do ar-condicionado. Linhas fixas em f_c,aux e 2f_c,aux
 * com bandas laterais ±f_rede e ±2f_rede, mais as linhas fixas medidas do preset (`auxLinhas`: Taurus 176/527/688 Hz,
 * Citadis 167/1942/3879/5473, CPTM 542/656). Constante, independente da tração.
 */
export function linhasAux(p: PresetEletrico, L: ListaLinhas) {
  const inv = p.inversor;
  if (inv?.fcAux) {
    const f = inv.fcAux, fr = inv.fRede ?? 60;
    L.por(chave(MEC.aux, 1), f, 1);
    L.por(chave(MEC.aux, 2), f - fr, Math.pow(10, -6 / 20)); L.por(chave(MEC.aux, 3), f + fr, Math.pow(10, -8 / 20));
    L.por(chave(MEC.aux, 4), f - 2 * fr, Math.pow(10, -14 / 20)); L.por(chave(MEC.aux, 5), f + 2 * fr, Math.pow(10, -14 / 20));
    L.por(chave(MEC.aux, 6), 2 * f, Math.pow(10, -28 / 20));
    for (let k = 1; k <= 3; k++) { L.por(chave(MEC.aux, 6 + 2 * k - 1), 2 * f - k * fr, Math.pow(10, (-30 - 2 * k) / 20)); L.por(chave(MEC.aux, 6 + 2 * k), 2 * f + k * fr, Math.pow(10, (-30 - 2 * k) / 20)); }
  }
  const ex = p.auxLinhas;
  if (ex) for (let i = 0; i < ex.length; i++) L.por(chave(MEC.aux, 32 + i), ex[i][0], Math.pow(10, ex[i][1] / 20));
}
