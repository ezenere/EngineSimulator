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
// A boca do megafone (787B) não é duas-portas: é o Radiator com a reflexão de boca larga (−0,6 abaixo de 300 Hz), montado
// em dsp.ts.
import { Biquad, TwoPort, onePole } from '../../acoustics';

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
