// Duas-portas do escape dos rotativos (ROTATIVO.md 2.1 e 2.2), como o TwoPort de src/acoustics/guias.ts (nada muda lá):
// a onda que chega pela porta A passa filtrada para B (gT), parte reflete (rA, passa-baixa) e parte da onda de volta
// atravessa (x, rB).
//
//  - 'presilencioso': o silencioso intermediário grande dos Mazda de rua (RX-7 FD ~0,5 m Ø 150; RX-8 ~0,6 m), câmara de
//    expansão com tubo perfurado e lã: −6 dB em 150–300 Hz (Helmholtz da câmara), −3 dB plano de 300 Hz a 1 kHz, −10 dB
//    acima de 1,5 kHz, reflexão 0,3 (câmara grande, pouca onda de volta). É ele que tira a energia dos primeiros
//    harmônicos da ignição, que no rotativo são tão fortes quanto a fundamental;
//  - 'cat': a colmeia do catalisador (perda suave acima de 2 kHz, pouca reflexão);
//  - 'reator': o reator térmico do RX-3/RX-4 (REAPS): câmara de 2 L a 900 °C no lugar do coletor: −4 dB acima de 800 Hz,
//    reflexão 0,5.
// A boca do megafone (787B) não é duas-portas: é a boca aberta com a reflexão de boca larga (−0,6 abaixo de 300 Hz), montada
// em dsp.ts. A boca de todos os rotativos é a `BocaRot` (abaixo): o Radiator do Ronco mais a ponteira como orifício.
import { Biquad, TwoPort, Radiator, GAM, P0, onePole } from '../../acoustics';

export type TipoDoisPortasRot = 'presilencioso' | 'cat' | 'reator';

export class DoisPortasRotativo extends TwoPort {
  declare tipo: TipoDoisPortasRot;
  constructor(fs: number, a: any, b: any, tipo: TipoDoisPortasRot) {
    super(fs, a, b, 'straight');
    this.tipo = tipo;
    const ch: Biquad[] = [];
    let lr = 1400;
    if (tipo === 'presilencioso') {
      // Helmholtz da câmara (−6 dB em 150–300 Hz) + câmara (−3 dB de 300 Hz a 1 kHz, no gT) + lã (−10 dB acima de 1,5 kHz)
      ch.push(new Biquad().peak(fs, 210, 0.9, -4.5), new Biquad().hshelf(fs, 1500, -7), new Biquad().lp(fs, 5000, 0.6));
      this.gT = 0.71; this.rA = 0.3; this.rB = 0.08; this.x = 0.04; lr = 600;
    } else if (tipo === 'cat') {
      ch.push(new Biquad().hshelf(fs, 2000, -3));
      this.gT = 0.94; this.rA = 0.08; this.rB = 0.04; this.x = 0.03; lr = 1200;
    } else {
      ch.push(new Biquad().hshelf(fs, 800, -4), new Biquad().peak(fs, 120, 0.8, 1.5));
      this.gT = 0.85; this.rA = 0.5; this.rB = 0.12; this.x = 0.06; lr = 500;
    }
    this.chain = ch;
    this.k = onePole(fs, lr); this.s = 0;
  }
}

/** γ·p₀ = ρ·c² do gás (Pa): a pressão de onda que corresponde a Mach 1 de velocidade de partícula */
const GAM_P0 = GAM * P0;
/** velocidade que não passa da do som: ≈ x até Mach 0,5, 0,84 em Mach 1, teto 1 */
export const satSonica = (x: number) => x / Math.sqrt(Math.sqrt(1 + x * x * x * x));

/**
 * Boca do escape com ponteira. É o Radiator do Ronco (ponta aberta: reflete invertido o grave, irradia a derivada da
 * vazão) e mais duas coisas que o Ronco não tem:
 *
 *  1. Saída mais fina que o resto do escape = orifício. Quando a ponteira ou o tubo da saída é mais fino que a seção de
 *     referência (o tubo de antes: o downpipe), a vazão que sai passa a custar pressão: Δp = ½ρ·v²·(1/σ² − 1), com
 *     σ = menor área da saída ÷ área de referência. Com o gás já escoando (Mach médio M₀ na seção de referência) isso é,
 *     para a onda, uma resistência r = M₀·(1/σ² − 1) em unidades de ρc, mais o termo do próprio pulso (κ·u²,
 *     κ = (1/σ² − 1)/(2γp₀)). A vazão pulsante cai para u/(1 + r + …) e o que não sai volta pelo tubo como
 *     contrapressão: a saída fina não acelera o pulso sem limite, ela o AMOLECE. Na lenta (M₀ ≈ 0,004) quase não muda;
 *     em carga (M₀ ≈ 0,14), com a saída na metade do diâmetro, o pulso que sai cai ~12 dB.
 *  2. O chiado do jato lê a velocidade do gás NA PONTEIRA: a do tubo da saída × área do tubo ÷ área da ponteira (a
 *     ponteira mais larga que o tubo é um difusor: o jato desacelera), com o pulso já amolecido, e ela não passa da do
 *     som: com o escoamento médio perto de Mach 1 não sobra folga para o pulso acelerar o jato. Só a parte PULSANTE
 *     entra no chiado (o "puf" de cada explosão); o sopro contínuo do escoamento médio fica de fora de propósito (decisão
 *     do dono: mais motor, menos ar). E o chiado tem teto: a sua amplitude não passa de `tetoJato` × a envoltória do
 *     pulso que a mesma boca irradia (ele vive do pulso; em posição nenhuma dos controles vira a fonte dominante).
 *     Antes o chiado crescia com 1/área² sem limite (+24 dB com a ponteira no mínimo) e em plena carga era 75–99% do som
 *     ("papel rasgando").
 *
 * O `u` que o laço do Ronco lê para o chiado (`rd.u`) sai daqui já como velocidade na ponteira, na escala que ele espera
 * (pressão de onda equivalente), por isso o RotativoDSP deixa `tipA` = 1.
 */
export class BocaRot extends Radiator {
  /** σ da restrição (≤ 1), razão de áreas ponteira/tubo do jato, áreas de referência e da ponteira (m²) */
  declare sig: number; declare sigJ: number; declare aRef: number; declare aTip: number;
  /** resistência do escoamento médio (ρc), coeficiente do termo do pulso (1/Pa), Mach médio na ponteira e a sua saturação */
  declare rMed: number; declare kOr: number; declare m0: number; declare sat0: number;
  /** envoltória do pulso irradiado (ataque de 1 ms, queda de 8 ms) e o teto do chiado relativo a ela */
  declare env: number; declare ka: number; declare kd: number; declare teto: number;
  constructor(fs: number, line: any, panL: number, panR: number, fc: number, gain: number, fRad: number, Dtubo: number, Dponteira: number, Dref: number, tetoJato = 0.1) {
    super(fs, line, panL, panR, fc, gain, fRad);
    const area = (D: number) => (Math.PI / 4) * (D / 1000) ** 2;
    this.aRef = area(Math.max(Dref, 1)); this.aTip = area(Math.max(Dponteira, 1));
    // (jato: a ponteira não acelera mais que 5× nem desacelera mais que 16× a velocidade do tubo da saída)
    this.sigJ = Math.min(16, Math.max(0.2, (Dponteira / Dtubo) ** 2));
    // (restrição: a menor seção da saída contra a de referência; abaixo de 1/10 da área o motor nem funcionaria)
    this.sig = Math.min(1, Math.max(0.1, (Math.min(Dponteira, Dtubo) / Dref) ** 2));
    this.kOr = (1 / (this.sig * this.sig) - 1) / (2 * GAM_P0);
    this.rMed = 0; this.m0 = 0; this.sat0 = 0;
    this.env = 0; this.ka = 1 - Math.exp(-1 / (0.001 * fs)); this.kd = 1 - Math.exp(-1 / (0.008 * fs)); this.teto = tetoJato;
  }
  /** escoamento médio por esta boca (kg/s), a cada passo de controle: gás a ~600 K na ponta (ρ·c ≈ 281 kg/m²s) */
  fluxo(m: number) {
    const q = Math.max(0, m) / 281;
    this.rMed = Math.min(q / this.aRef, 1) * (1 / (this.sig * this.sig) - 1);
    this.m0 = q / this.aTip; this.sat0 = satSonica(this.m0);
  }
  step() {
    const x = this.line.in1;
    this.s += this.k * (x - this.s);
    let u = x + this.R * this.s; // (boca aberta: o que chega menos o que reflete)
    if (this.kOr > 0) {
      // orifício: κ·u² + (1 + r)·u = u_aberta
      const b = 1 + this.rMed, ur = (Math.sqrt(b * b + 4 * this.kOr * Math.abs(u)) - b) / (2 * this.kOr);
      u = u < 0 ? -ur : ur;
    }
    this.line.out1 = x - u; // (o que não sai pela ponteira volta: contrapressão)
    const e = this.radiate(u);
    this.emit = e;
    // velocidade pulsante na ponteira para o chiado do jato, saturada na do som junto com o escoamento médio…
    const mp = u > 0 ? u / (GAM_P0 * this.sigJ) : 0;
    let uj = GAM_P0 * (satSonica(this.m0 + mp) - this.sat0);
    // …e com teto: o laço do Ronco faz chiado = (uj/2,5e4)²·jetGain·ruído (o ruído filtrado tem ~0,4 rms; jetGain 500)
    const ae = e < 0 ? -e : e;
    this.env += (ae - this.env) * (ae > this.env ? this.ka : this.kd);
    const ut = 2.5e4 * Math.sqrt((this.teto * this.env) / 200);
    if (uj > ut) uj = ut;
    this.u = uj;
  }
}
