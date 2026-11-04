// Gerador pseudoaleatório xorshift32 com semente: é ele que torna a renderização determinística
// (mesma semente, mesmo WAV, amostra a amostra).
export class RNG {
  declare s: number;
  constructor(seed: number) { this.s = seed >>> 0 || 0x9e3779b9; }
  next() { let x = this.s; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.s = x >>> 0; return this.s * 2.3283064365386963e-10; }
  bi() { return this.next() * 2 - 1; }
  // aproximação de gaussiana (soma de 4 uniformes), variância 1
  gauss() { return (this.next() + this.next() + this.next() + this.next() - 2) * 1.7320508; }
}
