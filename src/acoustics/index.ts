// Pacote de acústica compartilhado: blocos que qualquer família de motor pode usar.
// Tudo aqui roda tanto no AudioWorklet quanto no Node (nada de DOM, nada de `sampleRate` global:
// a taxa de amostragem `fs` entra sempre como argumento).
export * from './constantes';
export * from './util';
export { RNG } from './rng';
export { Biquad, BiquadComPiso } from './biquad';
export { PSI_N, PSI, psi, flow } from './escoamento';
export { Line, Junction, TwoPort, Radiator, Cutout, ClosedEnd, port, pin, pout } from './guias';
export type { Porta } from './guias';
