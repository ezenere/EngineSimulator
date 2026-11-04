// Reflexão do solo por fonte-imagem (CENA.md 2.4): segunda leitura no mesmo anel com o atraso do
// caminho até o ouvinte espelhado (z → −z). O solo é um passa-baixa de 1 polo mais um ganho.
import type { Solo } from './tipos';

export interface EspecSolo { ganho: number; fc: number }

export const SOLOS: Record<Solo['tipo'], EspecSolo> = {
  asfalto: { ganho: 0.95, fc: 4500 },    // o `road` de hoje: 0,6 de mistura e 4,5 kHz; o 0,6 incluía o espalhamento, aqui ele vai para a geometria
  concreto: { ganho: 0.97, fc: 8000 },   // concreto / laje
  brita: { ganho: 0.55, fc: 800 },       // via ferroviária
  grama: { ganho: 0.7, fc: 1500 },
  agua: { ganho: 0.99, fc: 12000 },
  nenhum: { ganho: 0, fc: 20000 },       // ponte, a bordo
};

/** Primeiro nulo do pente de interferência: c/(2Δr) */
export const primeiroNulo = (dr: number, c = 343) => c / (2 * dr);
