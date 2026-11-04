// Banco de linhas (ELETRICO.md 4.1, decisão de síntese): osciladores recursivos de 2ª ordem (rotação complexa), um
// por linha, com a frequência e a amplitude em rampa linear dentro do bloco de controle de 64 amostras. A cada bloco
// a fonte entrega uma lista (chave, f, a); o banco filtra (nada acima de 0,45·fs, rampa de −12 dB entre 18 kHz e
// 0,45·fs, nada abaixo de −60 dB da maior), fica com as L_max mais fortes e casa as chaves com os osciladores que já
// tocam: a mesma chave continua no mesmo oscilador (fase contínua), uma chave nova entra com rampa de 20 ms e uma que
// some sai com rampa de 20 ms. As rampas de entrada e saída são seno/cosseno (potência constante: a troca de modo do
// inversor, que muda as chaves, é um crossfade de 20 ms sem buraco).
//
// Frequência em rampa: o incremento de fase por amostra δ vai linearmente de δ₀ a δ₁ no bloco, então a rotação do
// incremento também é uma rotação (w ← w·dw): 2 multiplicações complexas por amostra. Sem variação (dδ = 0) o laço é o
// de 1 multiplicação. O estado (cos, sen) e o incremento são renormalizados no fim de cada bloco.
//
// Sem alocação no laço: estado em Float64Array, casamento de chaves por uma tabela de espalhamento em Int32Array.
import { RNG } from '../../acoustics/rng';
import { TAU, BLOCO, RAMPA_LINHA, F_MAX_REL, F_RAMPA_REL, RAMPA_TOPO_DB, PISO_LINHA_DB, F_MIN } from './constantes';

/** Lista de candidatas de um bloco (preenchida pela fonte; alocada uma vez). */
export class ListaLinhas {
  n = 0;
  cap: number;
  chave: Int32Array; f: Float64Array; a: Float64Array;
  constructor(cap = 256) { this.cap = cap; this.chave = new Int32Array(cap); this.f = new Float64Array(cap); this.a = new Float64Array(cap); }
  limpar() { this.n = 0; }
  /** f em Hz (o sinal é ignorado: |f|), a em Pa (amplitude de pico) */
  por(chave: number, f: number, a: number) {
    if (!(a > 0) || this.n >= this.cap) return;
    const i = this.n++;
    this.chave[i] = chave; this.f[i] = f < 0 ? -f : f; this.a[i] = a;
  }
}

/**
 * Passeio lento comum a todas as linhas de um eixo (4.1: ±0,05% a 0,3 Hz) e tremor de amplitude (±0,5 dB). Um por
 * unidade (eixo); o portador pode pedir mais (o ESC do drone oscila ±1,5%).
 */
export class JitterEixo {
  rng: RNG; fs: number;
  desvio: number; tremorDb: number;
  // passeio: alvo aleatório em ±1 suavizado por dois polos em 0,3 Hz
  p1 = 0; p2 = 0; t1 = 0; t2 = 0; kP: number; kT: number;
  fator = 1; ganho = 1;
  constructor(fs: number, semente: number, desvio = 5e-4, tremorDb = 0.5, fPasseio = 0.3) {
    this.fs = fs; this.rng = new RNG(semente); this.desvio = desvio; this.tremorDb = tremorDb;
    const dt = BLOCO / fs;
    this.kP = 1 - Math.exp(-TAU * fPasseio * dt);
    this.kT = 1 - Math.exp(-TAU * 3 * dt);
  }
  /** avança um bloco de controle */
  passo() {
    const r = this.rng;
    // ruído branco por bloco → dois polos: o desvio-padrão do resultado é ~√(k/4) do de entrada; a escala o leva a ±desvio
    this.p1 += this.kP * (r.gauss() * 3.2 - this.p1); this.p2 += this.kP * (this.p1 - this.p2);
    this.t1 += this.kT * (r.gauss() * 2.6 - this.t1); this.t2 += this.kT * (this.t1 - this.t2);
    const sP = 1 / Math.sqrt(this.kP), sT = 1 / Math.sqrt(this.kT);
    this.fator = 1 + this.desvio * Math.max(-1.5, Math.min(1.5, this.p2 * sP * 0.5));
    this.ganho = Math.pow(10, (this.tremorDb * Math.max(-1.5, Math.min(1.5, this.t2 * sT * 0.5))) / 20);
  }
}

export class BancoDeLinhas {
  fs: number; Lmax: number;
  // estado por oscilador
  ativo: Uint8Array; chave: Int32Array;
  c: Float64Array; s: Float64Array;       // fase (cos, sen)
  d: Float64Array;                         // incremento de fase por amostra (rad) no fim do bloco
  a: Float64Array;                         // amplitude aplicada no fim do bloco
  alvoA: Float64Array;                     // amplitude pedida (sem o envelope)
  env: Float64Array; sai: Uint8Array;      // envelope de entrada/saída (0..1) e se está saindo
  // rampas do bloco corrente
  d0: Float64Array; dd: Float64Array; a0: Float64Array; da: Float64Array;
  // seleção e casamento
  private sel: Int32Array; private tab: Int32Array; private mascara: number;
  private visto: Uint8Array;
  private rng: RNG;
  passoEnv: number;
  /** quantas amostras do bloco corrente já saíram (blocos parciais) */
  pos = 0;
  /** soma de a² das linhas ativas (telemetria e testes) */
  nAtivas = 0;

  constructor(fs: number, Lmax: number, semente = 0x11ae) {
    this.fs = fs; this.Lmax = Lmax;
    this.ativo = new Uint8Array(Lmax); this.chave = new Int32Array(Lmax);
    this.c = new Float64Array(Lmax).fill(1); this.s = new Float64Array(Lmax); this.d = new Float64Array(Lmax);
    this.a = new Float64Array(Lmax); this.alvoA = new Float64Array(Lmax); this.env = new Float64Array(Lmax); this.sai = new Uint8Array(Lmax);
    this.d0 = new Float64Array(Lmax); this.dd = new Float64Array(Lmax); this.a0 = new Float64Array(Lmax); this.da = new Float64Array(Lmax);
    this.sel = new Int32Array(1024);
    let h = 16; while (h < 4 * Lmax) h <<= 1;
    this.tab = new Int32Array(h); this.mascara = h - 1;
    this.visto = new Uint8Array(Lmax);
    this.rng = new RNG(semente);
    this.passoEnv = BLOCO / (RAMPA_LINHA * fs);
  }

  zerar() { this.ativo.fill(0); this.a.fill(0); this.env.fill(0); this.nAtivas = 0; }

  private procurar(k: number) {
    const t = this.tab, m = this.mascara;
    let h = Math.imul(k, 0x9e3779b1) >>> 0 & m;
    for (;;) { const j = t[h]; if (j < 0) return -1; if (this.chave[j] === k) return j; h = (h + 1) & m; }
  }
  private inserir(k: number, j: number) {
    const t = this.tab, m = this.mascara;
    let h = Math.imul(k, 0x9e3779b1) >>> 0 & m;
    while (t[h] >= 0) h = (h + 1) & m;
    t[h] = j;
  }

  /**
   * Recebe a lista do bloco e prepara as rampas das próximas BLOCO amostras. `fatorF` (jitter do eixo) multiplica
   * todas as frequências; `ganho` todas as amplitudes. Não aloca.
   */
  atualizar(L: ListaLinhas, fatorF = 1, ganho = 1) {
    const fs = this.fs, fMax = F_MAX_REL * fs, fR = F_RAMPA_REL * fs, n = L.n;
    // 1) filtra e acha a maior
    let aMax = 0, ns = 0;
    const sel = this.sel, lf = L.f, la = L.a;
    for (let i = 0; i < n; i++) {
      const f = lf[i] * fatorF;
      if (f >= fMax || f < F_MIN) continue;
      let a = la[i] * ganho;
      if (f > fR) a *= Math.pow(10, (RAMPA_TOPO_DB * (f - fR) / (fMax - fR)) / 20);
      if (f < 2 * F_MIN) a *= (f - F_MIN) / F_MIN;
      la[i] = a; lf[i] = f;
      if (a > aMax) aMax = a;
      if (ns < sel.length) sel[ns++] = i;
    }
    // linhas na mesma frequência (|Δf| < 0,1 Hz: duas ordens de mecanismos diferentes que coincidem, como 12·f_e e as
    // ranhuras de uma PMSM com Z_s/p inteiro) somam em potência numa só: com fases sorteadas, a soma de duas senoides de
    // mesma frequência daria qualquer nível entre a diferença e a soma
    this.fundir(sel, ns, lf, la);
    const piso = aMax * Math.pow(10, PISO_LINHA_DB / 20);
    let m = 0;
    for (let j = 0; j < ns; j++) { const i = sel[j]; if (la[i] >= piso && la[i] > 0) sel[m++] = i; }
    // 2) as Lmax mais fortes (seleção parcial: quickselect pelo valor de amplitude)
    if (m > this.Lmax) { this.selecionar(sel, m, this.Lmax, la); m = this.Lmax; }
    // 3) tabela de espalhamento das chaves ativas
    this.tab.fill(-1);
    const A = this.ativo, K = this.chave, V = this.visto;
    for (let j = 0; j < this.Lmax; j++) { V[j] = 0; if (A[j]) this.inserir(K[j], j); }
    // 4) casa: mesma chave = mesmo oscilador; chave nova entra num oscilador livre
    const ds = TAU / fs;
    for (let q = 0; q < m; q++) {
      const i = sel[q], k = L.chave[i];
      let j = this.procurar(k);
      if (j < 0) {
        j = this.livre();
        if (j < 0) continue;
        A[j] = 1; K[j] = k; this.env[j] = 0; this.a[j] = 0;
        const ph = this.rng.next() * TAU; this.c[j] = Math.cos(ph); this.s[j] = Math.sin(ph);
        this.d[j] = lf[i] * ds;
        this.inserir(k, j);
      }
      V[j] = 1; this.sai[j] = 0;
      this.alvoA[j] = la[i];
      this.d0[j] = this.d[j]; this.dd[j] = (lf[i] * ds - this.d[j]) / BLOCO; this.d[j] = lf[i] * ds;
    }
    // 5) envelopes: as vistas sobem, as outras descem; amplitude aplicada = alvo·sen(env·π/2)
    let na = 0;
    const pe = this.passoEnv;
    for (let j = 0; j < this.Lmax; j++) {
      if (!A[j]) continue;
      if (!V[j]) { this.sai[j] = 1; this.d0[j] = this.d[j]; this.dd[j] = 0; }
      let e = this.env[j] + (V[j] ? pe : -pe);
      if (e > 1) e = 1;
      if (e <= 0) { e = 0; if (!V[j]) { A[j] = 0; this.a[j] = 0; this.env[j] = 0; this.da[j] = 0; this.a0[j] = 0; continue; } }
      this.env[j] = e;
      const alvo = this.alvoA[j] * Math.sin(e * Math.PI * 0.5);
      this.a0[j] = this.a[j]; this.da[j] = (alvo - this.a[j]) / BLOCO; this.a[j] = alvo;
      na++;
    }
    this.nAtivas = na;
    this.pos = 0;
  }

  private tq = new Int32Array(2048); private ti = new Int32Array(2048);
  /** funde as candidatas de frequências iguais (±0,1 Hz) em potência, na primeira delas */
  private fundir(sel: Int32Array, ns: number, lf: Float64Array, la: Float64Array) {
    const TQ = this.tq, TI = this.ti, M = TQ.length - 1;
    TI.fill(-1);
    for (let j = 0; j < ns; j++) {
      const i = sel[j], f = lf[i], q = Math.round(f * 10);
      let achou = -1;
      for (let d = -1; d <= 1 && achou < 0; d++) {
        const qq = q + d;
        let h = Math.imul(qq, 0x9e3779b1) >>> 0 & M;
        while (TI[h] >= 0) { if (TQ[h] === qq && Math.abs(lf[TI[h]] - f) < 0.1) { achou = TI[h]; break; } h = (h + 1) & M; }
      }
      if (achou >= 0) { la[achou] = Math.sqrt(la[achou] * la[achou] + la[i] * la[i]); la[i] = 0; continue; }
      let h = Math.imul(q, 0x9e3779b1) >>> 0 & M;
      while (TI[h] >= 0) h = (h + 1) & M;
      TQ[h] = q; TI[h] = i;
    }
  }

  /** oscilador livre (inativo); se não houver, o que está saindo com menor amplitude */
  private livre() {
    const A = this.ativo;
    for (let j = 0; j < this.Lmax; j++) if (!A[j]) return j;
    let b = -1, ba = Infinity;
    for (let j = 0; j < this.Lmax; j++) if (this.sai[j] && !this.visto[j] && this.a[j] < ba) { ba = this.a[j]; b = j; }
    return b;
  }

  /** quickselect: deixa em sel[0..k) os índices das k maiores amplitudes */
  private selecionar(sel: Int32Array, n: number, k: number, a: Float64Array) {
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const piv = a[sel[(lo + hi) >> 1]];
      let i = lo, j = hi;
      while (i <= j) {
        while (a[sel[i]] > piv) i++;
        while (a[sel[j]] < piv) j--;
        if (i <= j) { const t = sel[i]; sel[i] = sel[j]; sel[j] = t; i++; j--; }
      }
      if (k - 1 <= j) hi = j; else if (k - 1 >= i) lo = i; else break;
    }
  }

  /**
   * Soma `n` amostras do bloco corrente em `out[off…]` (n ≤ BLOCO − pos). Chamar depois de `atualizar`; vários
   * `processar` seguidos continuam as rampas do mesmo bloco.
   */
  processar(out: Float32Array, off: number, n: number) {
    const p0 = this.pos, L = this.Lmax, A = this.ativo;
    const C = this.c, S = this.s, D0 = this.d0, DD = this.dd, A0 = this.a0, DA = this.da;
    for (let j = 0; j < L; j++) {
      if (!A[j]) continue;
      let c = C[j], s = S[j];
      const dd = DD[j], da = DA[j];
      let a = A0[j] + da * p0;
      const del = D0[j] + dd * p0;
      if (a === 0 && da === 0) { // linha muda: só avança a fase
        const ph = Math.atan2(s, c) + del * n + dd * n * (n - 1) * 0.5; C[j] = Math.cos(ph); S[j] = Math.sin(ph); continue;
      }
      let wc = Math.cos(del), ws = Math.sin(del);
      if (dd === 0) {
        for (let k = 0; k < n; k++) {
          out[off + k] += a * s;
          const c2 = c * wc - s * ws; s = s * wc + c * ws; c = c2;
          a += da;
        }
      } else {
        const dc = Math.cos(dd), dsn = Math.sin(dd);
        for (let k = 0; k < n; k++) {
          out[off + k] += a * s;
          const c2 = c * wc - s * ws; s = s * wc + c * ws; c = c2;
          const w2 = wc * dc - ws * dsn; ws = ws * dc + wc * dsn; wc = w2;
          a += da;
        }
      }
      if (p0 + n >= BLOCO) { const g = 1 / Math.sqrt(c * c + s * s); c *= g; s *= g; }
      C[j] = c; S[j] = s;
    }
    this.pos = p0 + n;
  }

  /** soma de a²/2 (potência das linhas, em Pa²) e a maior amplitude: telemetria */
  potencia() { let p = 0; for (let j = 0; j < this.Lmax; j++) if (this.ativo[j]) p += 0.5 * this.a[j] * this.a[j]; return p; }
}
