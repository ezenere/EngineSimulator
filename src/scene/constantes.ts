// Constantes da Cena (docs/CENA.md). A velocidade do som é 343 m/s, a mesma do `road()` do Ronco:
// é com ela que saem os números-alvo do Doppler (1395/779 Hz a 350 km/h; 219/184 Hz a 30 m/s).
// (A Turbina legada usa 340; o resolvedor supersônico copiado de lá mantém C0 = 340.)

export const C_SOM = 343;            // m/s, ar a 20 °C
export const RHO = 1.2;              // kg/m³
export const P_REF = 2e-5;           // Pa, 0 dB SPL
/** Decisão 1.5: escala absoluta, 0 dBFS ≙ 124 dB SPL. */
export const PA_FS = P_REF * Math.pow(10, 124 / 20);   // 31,7 Pa
export const BLOCO_CONTROLE = 64;    // amostras entre atualizações da geometria
export const MAX_FONTES = 64;        // orçamento de fontes com anel de propagação (seção 5.1)
export const R_MIN = 0.5;            // m, distância mínima de emissão
export const RAMPA = 0.02;           // s, rampas de parâmetro (atualizar)
export const DIST_ANEL = 400;        // m, trecho do atraso guardado no anel de cada fonte (seção 5.1)
export const ITD_MAX = 0.65e-3;      // s, ITD a 90° (seção 3.3)
