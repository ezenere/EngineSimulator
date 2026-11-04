// Constantes do motor diesel (ignição por compressão). Os números são os de docs/DIESEL.md; a seção
// do documento vai ao lado de cada um.

// poder calorífico inferior do diesel (J/kg) e relação ar/combustível estequiométrica (2.2)
export const LHV = 42.5e6;
export const ESTEQ = 14.5;

// número de cetano padrão (S10 brasileiro ≥ 48) e o fator único de calibração do atraso de
// Hardenberg–Hase (2.3): não é por preset
export const CETANO_PADRAO = 48;
export const K_ATRASO = 1.6;
export const R_UNIV = 8.3143;

// consumo específico na potência nominal (kg/kWh) por classe (2.2)
export const BSFC = { leve: 0.22, pesado: 0.195, locomotiva: 0.215, maritimo: 0.17 };

// velocidade do som no gás do escape por classe (m/s), para escalar os comprimentos da `Line` (que usa 520) (2.5)
export const C_GAS = { leve: 470, pesado: 500, locomotiva: 560 };

// Ruído de injeção por tipo (2.7): tiques por evento de injeção (além do principal), nível em dB relativo ao pico do
// knock de lenta quente do mesmo motor, dois passa-faixas [f, Q], decaimento (ms) e a fração `a` da amplitude que não
// depende da carga (amplitude ∝ a + (1 − a)·fuel)
export type TipoInjecao = 'common-rail' | 'rotativa' | 'em-linha' | 'unitaria' | 'heui' | 'pld';
export const INJECAO: Record<TipoInjecao, { fecha: boolean; nivel: number; bp: [number, number][]; tau: number; a: number }> = {
  'common-rail': { fecha: true, nivel: -8, bp: [[4500, 3], [7000, 3]], tau: 0.4, a: 0.6 },
  rotativa: { fecha: true, nivel: -4, bp: [[3000, 2], [5000, 2]], tau: 0.6, a: 0.5 },
  'em-linha': { fecha: false, nivel: 2, bp: [[2500, 2], [1300, 6]], tau: 1.0, a: 0.3 },
  unitaria: { fecha: true, nivel: 6, bp: [[2200, 2], [3500, 2]], tau: 1.2, a: 0.4 },
  heui: { fecha: true, nivel: 4, bp: [[2000, 2], [3000, 2]], tau: 1.5, a: 0.4 },
  pld: { fecha: false, nivel: 3, bp: [[2500, 2], [2500, 2]], tau: 1.0, a: 0.35 },
};

// Tabelas por notch das locomotivas (4.4): rotação e potência bruta (fração da nominal)
export const NOTCH_POT = [0, 0.05, 0.12, 0.23, 0.35, 0.48, 0.64, 0.82, 1.0];
export const NOTCH_RPM = {
  emd710: [269, 269, 343, 490, 568, 651, 729, 820, 904],
  ge7fdl: [440, 440, 511, 585, 672, 764, 846, 950, 1050],
};

// Escala da mecânica diesel (knock, tiques, válvulas, fundo) sobre o pico do knock de lenta quente do motor, e o
// peso do trem de válvulas e do fundo mecânico; acertados nas bandas do ouvinte `bay` (DIESEL.md 2.6, Apêndice A)
export const K_MEC = 0.045;
export const K_VALV = 0.3;
export const K_FUNDO = 0.02;
export const K_VIB = 0.1;
// perda de calor para a parede no diesel, sobre a do Ronco: a mistura pobre da lenta (λ 4–8) queima mais fria e a
// perda ×1 deixava o gás a 480–520 K na abertura do escape em lenta (alvo 600–750 K)
export const K_CALOR = 0.6;
