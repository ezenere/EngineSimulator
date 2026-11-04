// Geradores das fontes próprias dos portadores: ruído com semente em ramos paralelos (cada ramo com o
// seu RNG e a sua cadeia de filtros), calibrados em NÍVEL DE POTÊNCIA SONORA L_W em dB(A) re 1 pW
// (CENA.md 4, "Níveis de referência"). O canal sai em Pa a `refDist` em campo livre:
//     L_p(refDist) = L_W − 20·log₁₀(refDist) − 11 dB          (fonte pontual, seção 2.2)
// e a lei de velocidade é L_W(v) = L_W(v_ref) + 10·n·log₁₀(v/v_ref), ou seja amplitude ∝ (v/v_ref)^(n/2).
// A calibração integra |H(f)|²·|A(f)|² da cadeia (sem render), na velocidade de referência.
import { RNG } from '../acoustics/rng';
import { Bq, k1, mag2Polo, ganhoA } from '../scene/filtros';
import { P_REF } from '../scene/constantes';

const TAU = Math.PI * 2;

/** um ramo: ruído uniforme → biquads em série → passa-baixa de 1 polo opcional → ganho */
export class Ramo {
  rng: RNG;
  bq: Bq[];
  kLp = 0; lp = 0; fLp = 0;
  g = 1;
  constructor(semente: number, bq: Bq[], fLp = 0, g = 1) { this.rng = new RNG(semente); this.bq = bq; this.fLp = fLp; this.g = g; }
  mag2(fs: number, f: number) {
    let h = 1;
    for (const b of this.bq) h *= b.mag2(fs, f);
    if (this.fLp > 0) h *= mag2Polo(fs, k1(fs, this.fLp), f);
    return h * this.g * this.g;
  }
}

/** pressão RMS (Pa) a refDist de uma fonte de potência L_W dB(A) */
export const paDeLw = (lw: number, refDist: number) => P_REF * Math.pow(10, (lw - 20 * Math.log10(refDist) - 11) / 20);

export interface EspecFonteRuido {
  lw: number;          // dB(A) re 1 pW na v_ref
  n: number;           // expoente da lei de velocidade
  vRef: number;        // m/s
  refDist: number;     // m
  modLenta?: number;   // dB de modulação lenta aleatória (±), 0,3–3 Hz (aero, 2.7)
}

/**
 * Fonte de ruído do portador. A subclasse monta os ramos (`montar(v)`) e pode modular a amplitude
 * por amostra (`modular`). `ajustar(v)` refaz os filtros que dependem da velocidade.
 */
export abstract class FonteRuido {
  fs: number; esp: EspecFonteRuido;
  ramos: Ramo[] = [];
  gCal = 1;            // Pa por unidade, na v_ref
  gV = 0;              // ganho da velocidade (v/v_ref)^(n/2)
  vAtual = -1;
  // modulação lenta: alvos aleatórios em ±modLenta dB, deslizando em 0,33–3 s
  mRng: RNG; mDe = 0; mPara = 0; mT = 0; mDur = 1; mG = 1;
  constructor(fs: number, esp: EspecFonteRuido, semente: number) {
    this.fs = fs; this.esp = esp; this.mRng = new RNG(semente ^ 0x51ed27);
    this.semente = semente;
  }
  semente: number;
  abstract montar(v: number): void;       // cria/ajusta os filtros para a velocidade v
  /** calibra na velocidade de referência (aloca; chamar na configuração) */
  calibrar() {
    this.montar(this.esp.vRef);
    const fs = this.fs, df = 2;
    let p = 0;
    for (let f = df / 2; f < fs / 2; f += df) {
      let h = 0;
      for (const r of this.ramos) h += r.mag2(fs, f);
      const a = ganhoA(f);
      p += h * a * a * df;
    }
    const rmsA = Math.sqrt((p / 3) / (fs / 2));     // ruído uniforme: variância 1/3
    this.gCal = paDeLw(this.esp.lw, this.esp.refDist) / rmsA;
    this.vAtual = -1;
    return rmsA;
  }
  ajustar(v: number) {
    const va = Math.abs(v);
    if (this.vAtual >= 0 && Math.abs(va - this.vAtual) <= 1e-3 * Math.max(1, this.vAtual)) return;
    this.vAtual = va;
    this.gV = va <= 1e-3 ? 0 : Math.pow(va / this.esp.vRef, this.esp.n / 2);
    if (va > 1e-3) this.montar(va);
  }
  /** multiplicador por amostra (sobrescrever) */
  protected modular(_k: number): number { return 1; }
  protected inicioBloco(_n: number) {}
  preencher(out: Float32Array, n: number) {
    const g0 = this.gCal * this.gV;
    if (g0 === 0) { out.fill(0, 0, n); return; }
    this.modLenta(n);
    this.inicioBloco(n);
    const R = this.ramos, nr = R.length;
    for (let k = 0; k < n; k++) out[k] = 0;
    for (let j = 0; j < nr; j++) {
      const r = R[j], rng = r.rng, bq = r.bq, nb = bq.length, kl = r.kLp, gr = r.g;
      let lp = r.lp;
      for (let k = 0; k < n; k++) {
        let x = rng.next() * 2 - 1;
        for (let b = 0; b < nb; b++) x = bq[b].run(x);
        if (kl > 0) { lp += kl * (x - lp); x = lp; }
        out[k] += gr * x;
      }
      r.lp = lp;
    }
    const gm = g0 * this.mG;
    for (let k = 0; k < n; k++) out[k] *= gm * this.modular(k);
  }
  private modLenta(n: number) {
    const amp = this.esp.modLenta || 0;
    if (amp <= 0) { this.mG = 1; return; }
    this.mT += n / this.fs;
    if (this.mT >= this.mDur) {
      this.mT = 0; this.mDe = this.mPara;
      this.mPara = (this.mRng.next() * 2 - 1) * amp;
      this.mDur = 0.33 + 2.7 * this.mRng.next();
    }
    const u = this.mT / this.mDur, db = this.mDe + (this.mPara - this.mDe) * (0.5 - 0.5 * Math.cos(Math.PI * u));
    this.mG = Math.pow(10, db / 20);
  }
  protected definirLp(r: Ramo, f: number) { r.fLp = f; r.kLp = k1(this.fs, Math.min(f, 0.45 * this.fs)); }
}

/**
 * Rolamento roda-trilho (CENA.md 4.6): 1/3 de oitava relativo ao pico (2 kHz a 300 km/h, sobe com v^0,5):
 * 250 Hz −15, 500 −8, 1k −3, 2k 0, 4k −2, 8k −10. Realização: passa-banda Q 0,5 em 1,5 kHz·√(v/v_ref)
 * mais 1 polo em 2,5 kHz·√(v/v_ref), que em potência por 1/3 de oitava dá −16/−8/−2/0/−4/−11 (a anterior,
 * passa-banda em 2,2 kHz e polo em 7 kHz, punha o pico de 1/3 de oitava em 3,2 kHz, com 4k −0,3 e 8k −4).
 * As gravações de passagem com rolamento claro (E5, Tohoku, Velaro, CRH, AVE S-103; docs/TECNICO.md) têm o
 * pico do rolamento recebido em 1,6–2,5 kHz e caem 6–9 dB até 4 kHz e 10–16 dB até 8 kHz; esta forma, com
 * a propagação até 3 m, erra 0,7 dB (rms) contra a média delas de 500 Hz a 8 kHz. Modulação dos dormentes
 * a v/dormente com 2 dB (±1 dB) e, com `achatamento` > 0, um pulso por volta da roda (v/πD).
 */
export class FonteRolamento extends FonteRuido {
  dormente: number; achatamento: number; diametro: number;
  fD = 0; faseD = 0; faseR = 0; fR = 0;
  constructor(fs: number, esp: EspecFonteRuido, semente: number, dormente = 0.6, achatamento = 0, diametro = 0.86) {
    super(fs, esp, semente);
    this.dormente = dormente; this.achatamento = achatamento; this.diametro = diametro;
    this.ramos = [new Ramo(semente, [new Bq()], 2500)];
  }
  montar(v: number) {
    const r = this.ramos[0], k = Math.sqrt(v / this.esp.vRef);
    r.bq[0].bp(this.fs, 1500 * k, 0.5);
    this.definirLp(r, 2500 * k);
    // a forma inteira escala com k: a potência do ruído filtrado cresce com a largura de banda (∝ k);
    // o ganho 1/√k a mantém, e a lei de velocidade fica só no gV (30·log v, não 35·log v)
    r.g = 1 / Math.sqrt(k);
    this.fD = v / this.dormente; this.fR = v / (Math.PI * this.diametro);
  }
  protected modular(_k: number) {
    this.faseD += this.fD / this.fs; if (this.faseD >= 1) this.faseD -= 1;
    let m = 1 + 0.122 * Math.sin(TAU * this.faseD);
    if (this.achatamento > 0) {
      this.faseR += this.fR / this.fs; if (this.faseR >= 1) this.faseR -= 1;
      m *= 1 + 3 * this.achatamento * Math.exp(-this.faseR / (0.003 * this.fR));
    }
    return m;
  }
}

/**
 * Ruído aerodinâmico (2.7). O texto descreve o espectro em 1/3 de oitava: pico em 200–500 Hz, caindo
 * 3 dB/oitava até 2 kHz e mais depressa acima, e 6 dB/oitava para baixo abaixo de 100 Hz. A realização
 * sugerida na mesma seção (passa-banda Q 0,5 + passa-baixa de 2,5 kHz) põe o pico de 1/3 de oitava em
 * ~600 Hz e sobe 9 dB/oitava abaixo de 175 Hz; aqui vale o espectro descrito:
 *   passa-alta de 1 polo em f_p/5 · passa-baixa de 1 polo em f_p · passa-baixa de 1 polo em 2,5 kHz
 * (1/3 de oitava: pico em f_p, −4 dB em 100 Hz para f_p = 350, −3 dB/oitava de f_p a 2,5 kHz, −9 acima).
 * Modulação lenta de ±2 dB. Pico: corpo 350 Hz, truque 160 Hz (cavidade), nariz/cauda 300 Hz.
 * `forma: 'bp'` mantém a realização literal do CENA.md (para comparação).
 */
export class FonteAero extends FonteRuido {
  fPico: number; forma: 'descrita' | 'bp';
  constructor(fs: number, esp: EspecFonteRuido, semente: number, fPico = 350, forma: 'descrita' | 'bp' = 'descrita') {
    super(fs, { modLenta: 2, ...esp }, semente);
    this.fPico = fPico; this.forma = forma;
    this.ramos = [new Ramo(semente, forma === 'bp' ? [new Bq()] : [new Bq(), new Bq()], 2500)];
  }
  montar(_v: number) {
    const r = this.ramos[0], fs = this.fs, fp = this.fPico;
    if (this.forma === 'bp') r.bq[0].bp(fs, fp, 0.5);
    else { polo1(r.bq[0], fs, fp / 5, 'hp'); polo1(r.bq[1], fs, fp, 'lp'); }
    this.definirLp(r, 2500);
  }
}

/** biquad degenerado num filtro de 1ª ordem (transformação bilinear com pré-distorção) */
export function polo1(b: Bq, fs: number, f: number, tipo: 'lp' | 'hp') {
  const K = Math.tan(Math.PI * Math.min(f, 0.45 * fs) / fs), a0 = 1 + K;
  if (tipo === 'lp') b.coef(K / a0, K / a0, 0, (K - 1) / a0, 0);
  else b.coef(1 / a0, -1 / a0, 0, (K - 1) / a0, 0);
  return b;
}

/**
 * Cavidade do vão entre vagões (2.9): corcova em 50–400 Hz (1 polo em 50 e 1 polo em 400 Hz) mais os
 * picos de Rossiter f_m = (v/W)·(m − 0,25)/(1/κ + M), κ = 0,57, Q 5, −6 dB por ordem.
 */
export class FonteVao extends FonteRuido {
  W: number;
  constructor(fs: number, esp: EspecFonteRuido, semente: number, W = 0.5) {
    super(fs, { modLenta: 2, ...esp }, semente);
    this.W = W;
    this.ramos = [new Ramo(semente, [new Bq(), new Bq()]), new Ramo(semente + 1, [new Bq()], 0, 1), new Ramo(semente + 2, [new Bq()], 0, 0.5), new Ramo(semente + 3, [new Bq()], 0, 0.25)];
  }
  static rossiter(v: number, W: number, m: number, c = 343) { return (v / W) * (m - 0.25) / (1 / 0.57 + v / c); }
  montar(v: number) {
    // corcova de 50 a 400 Hz (1/3 de oitava): passa-alta de 1 polo em 50 Hz e passa-baixa de 1 polo em 400 Hz
    polo1(this.ramos[0].bq[0], this.fs, 50, 'hp'); polo1(this.ramos[0].bq[1], this.fs, 400, 'lp');
    for (let m = 1; m <= 3; m++) this.ramos[m].bq[0].bp(this.fs, FonteVao.rossiter(v, this.W, m), 5);
  }
}

/**
 * Pantógrafo (4.6): tons de Strouhal (eólios) f = 0,2·v/d: cabeça d 0,04 m (Q 4), braços d 0,12 m;
 * ruído largo de 200 Hz a 3 kHz. A carenagem tira 10 dB (vem no L_W: 125 → 115).
 */
export class FontePantografo extends FonteRuido {
  constructor(fs: number, esp: EspecFonteRuido, semente: number) {
    super(fs, { modLenta: 1.5, ...esp }, semente);
    this.ramos = [new Ramo(semente, [new Bq()], 0, 1), new Ramo(semente + 1, [new Bq()], 0, 0.7), new Ramo(semente + 2, [new Bq(), new Bq()], 0, 0.5)];
  }
  montar(v: number) {
    this.ramos[0].bq[0].bp(this.fs, (0.2 * v) / 0.04, 4);
    this.ramos[1].bq[0].bp(this.fs, (0.2 * v) / 0.12, 4);
    this.ramos[2].bq[0].hp(this.fs, 200, 0.7071); this.ramos[2].bq[1].lp(this.fs, 3000, 0.7071);
  }
}

/** Tom de teste (Doppler, 1/r): seno de amplitude fixa em Pa a refDist, independente da velocidade. */
export class FonteTom {
  fs: number; f: number; a: number; fase = 0;
  constructor(fs: number, f: number, paRms: number) { this.fs = fs; this.f = f; this.a = paRms * Math.SQRT2; }
  preencher(out: Float32Array, n: number) {
    const d = this.f / this.fs;
    for (let k = 0; k < n; k++) { out[k] = this.a * Math.sin(TAU * this.fase); this.fase += d; if (this.fase >= 1) this.fase -= 1; }
  }
}
