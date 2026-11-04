// Escoamento compressível através de um orifício (válvulas, borboleta, vazamentos).
// Copiado de src/dsp.js sem mudar a aritmética.
import { GAM, RGAS } from './constantes';

// Função de escoamento compressível Ψ(p_jusante / p_montante), tabelada.
// Perto de 1 vira linear para não endurecer a integração.
export const PSI_N = 4096;
export const PSI = new Float64Array(PSI_N + 2);
{
  const crit = Math.pow(2 / (GAM + 1), GAM / (GAM - 1));
  const choked = Math.sqrt(GAM * Math.pow(2 / (GAM + 1), (GAM + 1) / (GAM - 1)));
  const at = (pr: number) => (pr <= crit ? choked : Math.sqrt(Math.max(0, (2 * GAM / (GAM - 1)) * (Math.pow(pr, 2 / GAM) - Math.pow(pr, (GAM + 1) / GAM)))));
  const LIN = 0.985, psiLin = at(LIN);
  for (let i = 0; i <= PSI_N + 1; i++) { const pr = Math.min(1, i / PSI_N); PSI[i] = pr > LIN ? (psiLin * (1 - pr)) / (1 - LIN) : at(pr); }
}
export const psi = (pr: number) => { if (pr >= 1) return 0; if (pr <= 0) return PSI[0]; const x = pr * PSI_N, i = x | 0; return PSI[i] + (PSI[i + 1] - PSI[i]) * (x - i); };
// vazão mássica com sinal de a para b através de área efetiva A
export const flow = (A: number, pa: number, Ta: number, pb: number, Tb: number) => (pa >= pb ? (A * pa * psi(pb / pa)) / Math.sqrt(RGAS * Ta) : (-A * pb * psi(pa / pb)) / Math.sqrt(RGAS * Tb));
