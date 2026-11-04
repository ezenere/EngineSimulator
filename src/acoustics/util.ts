// Funções pequenas usadas por todo o DSP. Mesma aritmética do código legado.
import { TAU } from './constantes';

export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const smooth = (e0: number, e1: number, x: number) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
// coeficiente de um passa-baixa de 1ª ordem (y += k·(x − y)) com corte f
export const onePole = (fs: number, f: number) => 1 - Math.exp(-TAU * f / fs);
// dB → razão de amplitude
export const db = (x: number) => Math.pow(10, x / 20);
