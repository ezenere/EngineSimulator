// Constantes dos rotativos (docs/ROTATIVO.md): geometrias da tabela 1.1, janelas da tabela 1.3, velas (1.4), fases dos
// rotores (1.2) e as do X-Engine (4.1). Ângulos em graus do eixo excêntrico (°e) depois do PMS de ignição da câmara:
// PMI em 270, PMS de escape/admissão em 540, PMI de admissão em 810 (ciclo de 1 080°e); no X-Engine, ciclo de 720°.

/** geometria (mm) por família de motor: raio gerador R, excentricidade e, largura b (tabela 1.1; "ajustado" = b para fechar a ficha) */
export const GEOMETRIAS = {
  '10A': { R: 105, e: 15, b: 60 },
  '12A': { R: 105, e: 15, b: 70 },
  '13B': { R: 105, e: 15, b: 80 },
  KKM612: { R: 100, e: 14, b: 68.4 },
  sachs294: { R: 70, e: 10.5, b: 77.0 },
  ar741: { R: 62, e: 9.3, b: 69.4 },
} as const;

/** fases dos rotores (°e) por número de rotores (1.2) */
export const FASES_ROTORES: Record<number, number[]> = { 1: [0], 2: [0, 180], 3: [0, 120, 240], 4: [0, 90, 180, 270] };

export type TipoAdmissao = 'lateral4' | 'lateral6' | 'street' | 'bridge' | 'periferica' | 'sachs' | 'x';
export type TipoEscape = 'periferico' | 'lateral' | 'x';

/** uma janela: abre e fecha (°e), rampas de abertura e fechamento (fração da duração) e área máxima em boreEq² */
export type Janela = { abre: number; fecha: number; ra: number; rf: number; area: number };

/**
 * Admissão (tabela 1.3). `area` em boreEq² (13B: boreEq = 94,1 mm, boreEq² = 88,6 cm²): primária lateral 9 cm² = 0,10;
 * secundária +6 cm² = 0,068; auxiliar do Renesis +5 cm² = 0,056; street 11 cm² = 0,124; bridge 14 = 0,158; periférica 18 = 0,203.
 * Sachs (Norton, MidWest, Austro, UEL): periférica de admissão pequena, a conferir (IO ≈ 540, IC ≈ 870).
 * X-Engine: canais do rotor (IO 350, IC 560 num ciclo de 720°: documentação de patentes, aproximação).
 */
export const ADMISSAO: Record<TipoAdmissao, Janela & { sec?: number; aux?: number }> = {
  lateral4: { abre: 572, fecha: 850, ra: 0.25, rf: 0.2, area: 0.1, sec: 0.068 },
  lateral6: { abre: 543, fecha: 850, ra: 0.25, rf: 0.2, area: 0.1, sec: 0.068, aux: 0.056 },
  street: { abre: 560, fecha: 870, ra: 0.2, rf: 0.2, area: 0.124 },
  bridge: { abre: 490, fecha: 880, ra: 0.15, rf: 0.2, area: 0.158 },
  periferica: { abre: 460, fecha: 890, ra: 0.1, rf: 0.2, area: 0.203 },
  sachs: { abre: 540, fecha: 870, ra: 0.12, rf: 0.2, area: 0.15 },
  x: { abre: 350, fecha: 560, ra: 0.2, rf: 0.2, area: 0.12 },
};

/**
 * Escape (tabela 1.3). Periférico: EO 195 (75° antes do PMI), EC 588; rampa de abertura 0,12 (≈ 47°e: 40 mm de janela a
 * 0,61 mm/°e), área 15 cm² = 0,17·boreEq². Lateral (Renesis, 2 janelas por rotor): EO ≈ 220, EC ≈ 537, rampa 2× mais
 * lenta, 2 × 7 cm². Sachs: EO ≈ 200, EC ≈ 580. X-Engine: EO 170 (só 10° antes do PMI: expansão prolongada), EC 380.
 */
export const ESCAPE: Record<TipoEscape | 'sachs', Janela> = {
  periferico: { abre: 195, fecha: 588, ra: 0.12, rf: 0.15, area: 0.17 },
  sachs: { abre: 200, fecha: 580, ra: 0.12, rf: 0.15, area: 0.17 },
  lateral: { abre: 220, fecha: 537, ra: 0.25, rf: 0.2, area: 0.158 },
  x: { abre: 170, fecha: 380, ra: 0.2, rf: 0.2, area: 0.12 },
};

/** fator da duração da queima pelo número de velas (1.4): uma 1,35, duas 1,15, três 1,05 */
export const K_VELAS: Record<number, number> = { 1: 1.35, 2: 1.15, 3: 1.05 };

/** temperatura de referência da densidade do pulso no rotativo (K): ver `rotDens` no dsp.ts e TECNICO → Rotativos */
export const T_EXREF_ROT = 1650;
/** teto do fator de densidade (o do Ronco é 1,3, que o gás do Wankel em plena carga alcançaria) */
export const DENS_TETO_ROT = 1.8;

/** dentes da engrenagem fixa / coroa do rotor (1.5; 13B: 34/51, a conferir) */
export const DENTES_ENGRENAGEM = 34;
