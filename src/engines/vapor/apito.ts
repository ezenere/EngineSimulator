// Apito e sino (docs/VAPOR.md 1.8, decisão 5).
//
// Apito: cada tubo (sino do apito) é um ressonador FECHADO no topo e soprado por um anel de vapor na boca. É uma guia
// de onda realimentada: a onda que sai da boca vai ao topo e volta (ida e volta 2L/c, sem inversão no topo fechado) e
// na boca reflete invertida; a malha fecha com período 4L/c, então só os modos ímpares existem: f, 3f, 5f (o 2º
// harmônico fica abaixo de −15 dB por simetria). O jato do anel injeta na malha um termo não linear g(p_s)·tanh(·)
// sobre a onda que volta: abaixo do limiar (apito < 0,15) a malha não oscila e só sobra o chiado do anel filtrado
// pelo tubo (o "quilling"); acima, a oscilação nasce do chiado e cresce até o tanh segurar (ataque de 100–300 ms).
// Passa-baixa na malha (polo em 4·f) favorece o fundamental; saturação em 1,3× o regime.
//
//   f = c_v/(4·(L + 0,3·D)), c_v ≈ 480 m/s; a afinação sobe com a pressão de sopro (de −60 cents a 0) e com o
//   aquecimento do tubo (c_v parte de 0,90× com o tubo frio, τ 13 s soprado; volta a 0,95 em 60 s parado)
//
// O tamanho do tubo sai da nota a quente pela fórmula; a linha de atraso é a ida e volta (2·L_eff/c), lida com
// interpolação linear (atraso fracionário que muda com a afinação, sem estalo).
import { Biquad, RNG, onePole } from '../../acoustics';

const MAX_ATRASO = 2048;

export class TuboApito {
  fs: number; f0: number;
  buf = new Float64Array(MAX_ATRASO); w = 0; mask = MAX_ATRASO - 1;
  lp = 0; kLp: number;
  rng: RNG; ruido = new Biquad();
  /** atraso de ida e volta em amostras a quente, sem a afinação */
  D0: number;
  fAtual = 0;
  saida = 0; hpS = 0; kHp: number; sai = 0;
  constructor(fs: number, f0: number, semente: number) {
    this.fs = fs; this.f0 = f0; this.rng = new RNG(semente);
    // malha: inversão na boca e ida e volta D → f = fs/(2D). O passa-baixa da malha (polo em 4·f) atrasa a fase em f e
    // abaixaria a nota ~4%: o atraso de grupo dele em f sai da linha (D = fs/(2f) − τ_lp)
    this.kLp = onePole(fs, Math.min(0.4 * fs, 4 * f0));
    const w = (2 * Math.PI * f0) / fs, pl = 1 - this.kLp;
    const fase = Math.atan2(pl * Math.sin(w), 1 - pl * Math.cos(w));   // atraso de fase do y += k(x − y) em f
    this.D0 = fs / (2 * f0) - fase / w;
    // a malha saturada (onda quase quadrada, os harmônicos passando pelo passa-baixa com atrasos diferentes) não oscila
    // exatamente na ressonância linear: afina-se o tubo uma vez, soprando-o 0,3 s a quente e corrigindo D pela nota medida
    // (é o "afinar o apito" do fabricante; a nota a quente fica a ±0,2% da do catálogo)
    for (let it = 0; it < 2; it++) {
      const f = this.soprarMedir();
      if (f > 0) this.D0 *= f / f0;
    }
    this.buf.fill(0); this.lp = 0; this.hpS = 0; this.saida = 0;
    // chiado do anel: largo em torno do tubo
    this.ruido.bp(fs, Math.min(0.4 * fs, 3 * f0), 0.6);
    this.kHp = onePole(fs, 1500);
  }
  /** sopra a quente com a válvula toda aberta e mede a frequência pelos cruzamentos por zero (na construção) */
  private soprarMedir() {
    this.buf.fill(0); this.lp = 0; this.hpS = 0;
    const n = Math.round(0.3 * this.fs);
    let ant = 0, t0 = -1, t1 = -1, k = 0;
    for (let i = 0; i < n; i++) {
      this.amostra(1, 1, 4);
      const y = this.sai;
      if (i > n / 2 && ant < 0 && y >= 0) { const t = i - 1 + -ant / (y - ant); if (t0 < 0) t0 = t; t1 = t; k++; }
      ant = y;
    }
    return k > 3 ? ((k - 1) * this.fs) / (t1 - t0) : 0;
  }
  /**
   * uma amostra. `ps` 0..1 (pressão de sopro relativa), `afina` (fator de frequência: aquecimento × pressão), `g`
   * ganho de realimentação do jato (o limiar fica em g·perdas ≈ 1)
   */
  amostra(ps: number, afina: number, g: number) {
    const D = Math.min(MAX_ATRASO - 4, this.D0 / afina);
    const pos = this.w - D, i = Math.floor(pos), fr = pos - i, m = this.mask;
    const a = this.buf[i & m], b = this.buf[(i + 1) & m];
    let volta = a + (b - a) * fr;
    // perdas e passa-baixa na malha
    this.lp += this.kLp * (volta - this.lp);
    volta = 0.985 * this.lp;
    // na boca: reflexão invertida mais o jato do anel (não linear, satura) e o chiado
    const chiado = ps * this.ruido.run(this.rng.next() * 2 - 1);
    const jato = Math.tanh(g * -volta * 1.6) / 1.6;
    const sai = -0.55 * volta + 0.6 * jato + 0.05 * chiado;
    this.buf[this.w] = sai; this.sai = sai;
    this.w = (this.w + 1) & m;
    // irradiado pela boca: a vazão que sai (onda que sai menos a que volta), sem o DC
    // (monopolo pequeno: a pressão é a derivada da vazão abaixo de c/(2πa) ≈ 1,5 kHz, o que põe o 3º harmônico a −3…−8 dB)
    const u = sai - volta;
    this.hpS += this.kHp * (u - this.hpS);
    this.saida = u - this.hpS;
    return this.saida;
  }
}

/**
 * Apito com 1–6 tubos soprados pela mesma válvula. `abertura` 0..1 (tecla segurável ou o slider); a válvula abre
 * com τ 150 ms; a pressão de sopro p_s = abertura·p_cal/p_nom. Nível ∝ p_s^1,5 até saturar. Ao soltar, decai em 150–250 ms
 * com a afinação caindo 30 cents (a pressão de sopro cai antes da oscilação morrer).
 */
export class Apito {
  fs: number; tubos: TuboApito[]; notas: number[];
  ps = 0; kAbre: number; kFecha: number;
  /** aquecimento: fator de c_v (0,90 frio → 1,0 quente) */
  aq = 0.9;
  ganho = 1;
  /** fator de frequência atual (para a telemetria) */
  afinaAtual = 1;
  constructor(fs: number, notas: number[], semente: number) {
    this.fs = fs; this.notas = notas;
    this.tubos = notas.map((f, k) => new TuboApito(fs, f, semente + 7919 * k));
    // (válvula: 1ª ordem de 200 ms abrindo, o que dá o ataque de 100–300 ms do nível; 80 ms fechando)
    this.kAbre = onePole(fs, 1 / (2 * Math.PI * 0.2));
    this.kFecha = onePole(fs, 1 / (2 * Math.PI * 0.08));
  }
  /** a cada bloco de controle (dt s): aquecimento */
  controle(dt: number) {
    if (this.ps > 0.15) this.aq += (1 - this.aq) * (dt / 13);
    else this.aq += (0.95 - this.aq) * (dt / 60);
  }
  /** soma dos tubos numa amostra; `alvo` 0..1 é a abertura × pressão relativa da caldeira */
  amostra(alvo: number) {
    this.ps += (alvo > this.ps ? this.kAbre : this.kFecha) * (alvo - this.ps);
    const ps = this.ps;
    if (ps < 1e-5 && Math.abs(this.tubos[0].saida) < 1e-7) return 0;
    // afinação: −60 cents com sopro fraco → 0 cheio (2^(−0,05·x) ≈ 1 − 0,0341·x); × aquecimento
    const afina = this.aq * (1 - 0.0341 * Math.max(0, 1 - ps / 0.6));
    this.afinaAtual = afina;
    // ganho de realimentação: o limiar da malha é g ≈ 0,83 (0,955·(0,55 + 0,6·g) = 1); abaixo de ps 0,1 o jato não
    // realimenta (quilling: só o chiado do anel, ressoado de leve pelo tubo), de 0,1 a 0,15 chega ao limiar, acima sobe até 4
    const g = ps < 0.1 ? 0 : ps < 0.15 ? (0.83 * (ps - 0.1)) / 0.05 : 0.9 + 3.1 * Math.min(1, (ps - 0.15) / 0.5);
    let s = 0;
    const T = this.tubos;
    for (let k = 0; k < T.length; k++) s += T[k].amostra(ps, afina, g);
    // nível ∝ p_s^1,5 até saturar
    return (s * Math.min(1, Math.pow(ps / 0.6, 1.5)) * this.ganho) / Math.sqrt(T.length);
  }
  frequencias(): number[] { return this.ps > 0.15 ? this.notas.map((f) => f * this.afinaAtual) : this.notas.map(() => 0); }
}

/**
 * Sino de bronze (1.8): síntese modal, 5 parciais medidos no Big Boy (1 : 2,16 : 3,53 : 5,2 : 7,05; amplitudes 0 / −2 /
 * −5 / −4 / −8 dB; T60 4 / 2,5 / 1,5 / 1 / 0,7 s), batidas a `batidasPorS`, alternadas (lado a lado ±2 dB) com ±3% de
 * ritmo. Cada parcial é um ressonador de 2ª ordem excitado por um impulso filtrado (o badalo).
 */
export class Sino {
  fs: number; f: number; bps: number;
  a1: Float64Array; a2: Float64Array; y1: Float64Array; y2: Float64Array; amp: Float64Array;
  fase = 0; lado = 0; rng: RNG; ritmo = 1;
  ligado = false;
  constructor(fs: number, f: number, bps: number, semente: number) {
    this.fs = fs; this.f = f; this.bps = bps; this.rng = new RNG(semente);
    const R = [1, 2.16, 3.53, 5.2, 7.05], A = [0, -2, -5, -4, -8], T60 = [4, 2.5, 1.5, 1, 0.7];
    const n = R.length;
    this.a1 = new Float64Array(n); this.a2 = new Float64Array(n); this.y1 = new Float64Array(n); this.y2 = new Float64Array(n); this.amp = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const fk = Math.min(0.45 * fs, f * R[k]), r = Math.exp(-6.91 / (T60[k] * fs)), w = (2 * Math.PI * fk) / fs;
      this.a1[k] = 2 * r * Math.cos(w); this.a2[k] = -r * r; this.amp[k] = Math.pow(10, A[k] / 20) * Math.sin(w);
    }
  }
  quieto = true;
  amostra() {
    let ex = 0;
    if (!this.ligado && this.quieto) return 0;
    if (this.ligado) {
      this.fase += (this.bps * this.ritmo) / this.fs;
      if (this.fase >= 1) {
        this.fase -= 1; this.lado ^= 1;
        ex = this.lado ? 1 : 0.79;                      // ±2 dB entre os lados
        this.ritmo = 1 + 0.03 * (this.rng.next() * 2 - 1);
      }
    }
    let s = 0, e = 0;
    for (let k = 0; k < 5; k++) {
      const y = this.a1[k] * this.y1[k] + this.a2[k] * this.y2[k] + ex * this.amp[k];
      this.y2[k] = this.y1[k]; this.y1[k] = y; s += y; e += y * y;
    }
    // (desligado e já abaixo de −100 dB: para de calcular)
    this.quieto = !this.ligado && e < 1e-10;
    return s;
  }
}
