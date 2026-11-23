// Constantes físicas e de catálogo do vapor (docs/VAPOR.md, seções 1 e Apêndice B).
// As de `src/acoustics/constantes.ts` (SOUND_SPEED 520, GAM 1,33, P0) não mudam: as linhas de atraso do pacote
// comum são escaladas por 520/c do vapor, como o diesel faz com o gás frio.

export const P0 = 101325;             // Pa, pressão ambiente
export const BAR = 1e5;               // Pa
export const G = 9.81;                // m/s²
export const R_V = 461;               // J/(kg·K), constante do vapor d'água
export const T_SUPER = 620;           // K, vapor superaquecido na caixa de válvulas
export const T_SAT = 470;             // K, saturado a 13–14 bar
/** temperatura do vapor no escape, relativa à da admissão (expansão politrópica de ~14 para ~7 bar: 0,85–0,87) */
export const K_T_ESCAPE = 0.87;
export const N_SUPER = 1.3;           // expoente politrópico, superaquecido
export const N_SAT = 1.13;            // saturado
export const C_V = 480;               // m/s, som no vapor úmido do escape (120–150 °C)
export const C_Q = 450;               // m/s, mistura de vapor e gás de combustão na chaminé (200–300 °C)
export const C_LINHA = 520;           // m/s, a SOUND_SPEED das `Line` do acoustics (os comprimentos são escalados por 520/c)
export const RHO_AR = 1.2;            // kg/m³
export const RHO_AGUA = 1000;         // kg/m³

/** perda de carga nas passagens de admissão ("wire drawing", 1.2: 3–8%) */
export const PERDA_ADMISSAO = 0.92;
/** espaço nocivo (1.2: 8–12% de A·s) */
export const V_NOCIVO = 0.08;
/** área da haste sobre a área do pistão (a extremidade traseira perde 3–5%) */
export const HASTE = 0.04;
/** coeficiente de descarga do pórtico de escape (com 0,6 o esvaziamento do K4s dá os 30 ms de τ_bd, 1.2) */
export const CD_PORTICO = 0.6;
export const CD_BICO = 0.95;
/** abertura do pórtico em graus de manivela (1.2: 20°) */
export const ABERTURA_PORTICO = 20;
/** τ da admissão: a pressão da extremidade acompanha a da caixa de válvulas com 1ª ordem de 3 ms (4.1) */
export const TAU_ADMISSAO = 0.003;

/**
 * Eventos da distribuição por extremidade (1.2, Walschaerts com válvula de pistão; catálogo, não se ajusta pelo som):
 * corte c → avanço (graus antes do PM), release r e compressão k (fração do curso de volta já percorrida), interpolação
 * linear em c.
 */
export const EVENTOS: readonly (readonly [number, number, number, number])[] = [
  // c,    avanço°, r,    k
  [0.15, 4, 0.77, 0.70],
  [0.25, 4, 0.80, 0.74],
  [0.40, 5, 0.86, 0.80],
  [0.60, 5, 0.92, 0.87],
  [0.80, 6, 0.96, 0.93],
];

export function eventos(c: number): { avanco: number; r: number; k: number } {
  const E = EVENTOS;
  if (c <= E[0][0]) return { avanco: E[0][1], r: E[0][2], k: E[0][3] };
  for (let i = 1; i < E.length; i++) {
    if (c <= E[i][0]) {
      const u = (c - E[i - 1][0]) / (E[i][0] - E[i - 1][0]);
      return { avanco: E[i - 1][1] + u * (E[i][1] - E[i - 1][1]), r: E[i - 1][2] + u * (E[i][2] - E[i - 1][2]), k: E[i - 1][3] + u * (E[i][3] - E[i - 1][3]) };
    }
  }
  const u = Math.min(1, (c - 0.8) / 0.05), e = E[E.length - 1];
  return { avanco: e[1], r: Math.min(0.98, e[2] + 0.02 * u), k: Math.min(0.95, e[3] + 0.02 * u) };
}

/** corte pelo reverser (1.2): c = 0,15 + 0,70·|cutoff| */
export const cortePorReverser = (cutoff: number) => 0.15 + 0.7 * Math.min(1, Math.abs(cutoff));

/** adesão (1.7): μ seco, molhado, com areia (roda de aço no trilho) */
export const MU = { seco: 0.22, molhado: 0.12, areia: 0.3 } as const;

/**
 * Rodagem: onde a roda motriz apoia. A aderência (μ de pico, o limite da roda presa) vem dela, e não da família:
 *   - `trilho`: roda de aço no trilho (as locomotivas): `MU`, de 1.7; patinando, a curva de Polach (dsp.ts);
 *   - `pneu`: pneu na estrada (o Stanley): asfalto seco 0,8 e molhado 0,5, o lado de baixo das faixas de pico de Wong,
 *     "Theory of Ground Vehicles", tab. 1.3 (asfalto e concreto secos 0,8–0,9; asfalto molhado 0,5–0,7), para o pneu
 *     estreito de 1920; patinando sobra 0,88 (o valor de deslizamento sobre o de pico na mesma tabela: 0,75/0,85);
 *   - `ferro`: roda de ferro com garras na estrada (o trator): seca 0,40, entre a sapata de aço com garras no concreto
 *     (0,45, a tabela de tração do Caterpillar Performance Handbook, a mesma de Peurifoy) e o metal escorregando no
 *     asfalto da reconstituição de acidentes (0,3–0,5); molhada 0,22, a razão molhado/seco do aço no trilho (0,12/0,22).
 *     Patinando sobra 0,9 (o valor que o motor já usava). Sem areia (só a locomotiva tem areeiro).
 * Os números da tabela de Wong e da do Caterpillar estão escritos de memória (a tarefa não podia baixar nada): conferir.
 */
export type Rodagem = 'trilho' | 'pneu' | 'ferro';
export const ADERENCIA: Record<Rodagem, { seco: number; molhado: number; areia: number | null; desliza: number }> = {
  trilho: { seco: MU.seco, molhado: MU.molhado, areia: MU.areia, desliza: 1 },
  pneu: { seco: 0.8, molhado: 0.5, areia: null, desliza: 0.88 },
  ferro: { seco: 0.4, molhado: 0.22, areia: null, desliza: 0.9 },
};
/** a rodagem de cada família (o barco e a estacionária não têm roda motriz no chão: massa aderente 0) */
export const rodagemDe = (familia: string): Rodagem => (familia === 'carro' ? 'pneu' : familia === 'trator' ? 'ferro' : 'trilho');

/** Davis (Apêndice B): R = m·(6,4 + 0,13·v) + 0,0045·A·v² N, m em t, v em km/h, A em m² */
export const davis = (mT: number, vKmh: number, area: number) => mT * (6.4 + 0.13 * vKmh) + 0.0045 * area * vKmh * vKmh;

/** níveis de referência L_W dB(A) por fonte (4.6) */
export const LW_VAPOR = {
  apito: 145, apitoNavio: 150, apitoEstacionaria: 135, seguranca: 140, torneiras: 123, sino: 113,
  bombaAr: 104, bielas: 103, injetor: 94, queimador: 95, engrenagens: 100, correias: 95, soprador: 100,
  /** ejetor de vácuo pequeno, contínuo (o grande, ao soltar o freio, sopra +8 dB por ~2 s) */
  ejetor: 98,
} as const;
export const REF_DIST_VAPOR = 7.5;
