// Filtro biquad (transposta direta II), fórmulas do "Audio EQ Cookbook".
import { TAU } from './constantes';
import { clamp } from './util';

// Versão do Ronco (src/dsp.js): a frequência só é limitada por cima (0,45·fs).
export class Biquad {
  declare b0: number; declare b1: number; declare b2: number; declare a1: number; declare a2: number; declare z1: number; declare z2: number;
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0; }
  _set(b0, b1, b2, a0, a1, a2) { this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0; return this; }
  _w(fs, f, q) { const w = TAU * Math.min(f, fs * 0.45) / fs; return [Math.cos(w), Math.sin(w) / (2 * q)]; }
  lp(fs, f, q = 0.707) { const [c, al] = this._w(fs, f, q); return this._set((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al); }
  hp(fs, f, q = 0.707) { const [c, al] = this._w(fs, f, q); return this._set((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al); }
  bp(fs, f, q) { const [c, al] = this._w(fs, f, q); return this._set(al, 0, -al, 1 + al, -2 * c, 1 - al); }
  peak(fs, f, q, db) { const A = Math.pow(10, db / 40); const [c, al] = this._w(fs, f, q); return this._set(1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A); }
  hshelf(fs, f, db) {
    const A = Math.pow(10, db / 40), w = TAU * Math.min(f, fs * 0.45) / fs, c = Math.cos(w), s = Math.sin(w), al = (s / 2) * Math.SQRT2, k = 2 * Math.sqrt(A) * al;
    return this._set(A * ((A + 1) + (A - 1) * c + k), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - k), (A + 1) - (A - 1) * c + k, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - k);
  }
  run(x) { const y = this.b0 * x + this.z1; this.z1 = this.b1 * x - this.a1 * y + this.z2; this.z2 = this.b2 * x - this.a2 * y; return y; }
}

// Versão da Turbina (src/jet-dsp.js): a frequência também tem piso de 5 Hz, porque lá os cortes
// seguem a rotação e podem chegar a zero com o motor parado. A Turbina não usa hshelf.
export class BiquadComPiso extends Biquad {
  _w(fs, f, q) { const w = TAU * clamp(f, 5, fs * 0.45) / fs; return [Math.cos(w), Math.sin(w) / (2 * q)]; }
}
