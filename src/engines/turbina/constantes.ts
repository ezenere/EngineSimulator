// Constantes e tabelas próprias da Turbina (estavam dentro de JetDSPFactory em src/jet-dsp.js).
// Mesma aritmética do legado: não mude sem rodar `npx tsx tools/turbina-paridade.ts`.
import { TAU, clamp, db } from '../../acoustics';

// tabela de seno de uma volta, lida por fase em revoluções
export const TN = 8192, TM = TN - 1;
export const SIN = new Float32Array(TN);
for (let i = 0; i < TN; i++) SIN[i] = Math.sin((TAU * i) / TN);
export const sinr = (rev: number) => SIN[((rev * TN) | 0) & TM]; // seno de uma fase em revoluções (≥ 0)

// Diretividade (dB) a 0°, 30°, ... 180° do eixo da entrada de ar (0° = de frente para o motor).
export const DIR = {
  inlet: [-6, -2, 0, -3, -10, -20, -26],
  fanAft: [-22, -16, -9, -3, 0, -2, -8],
  jetL: [-24, -22, -18, -14, -8, 0, -6],
  jetF: [-8, -5, -3, -1, 0, -2, -6],
  core: [-16, -14, -10, -5, -1, 0, -5],
  shock: [-6, -2, 0, -2, -5, -9, -14],
  crackle: [-26, -24, -20, -14, -5, 0, -4],
  prop: [-18, -8, -3, 0, -1, -6, -18],
  rev: [-4, 0, -1, -3, -6, -9, -12],
};
export const dir = (tab: number[], th: number) => { const x = clamp(th / 30, 0, 5.999), i = x | 0; return db(tab[i] + (tab[i + 1] - tab[i]) * (x - i)); };

// Volta (m) da passagem: o avião some num lado e volta pelo outro.
export const PASS_LOOP = 6000;
