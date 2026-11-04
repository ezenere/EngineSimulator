// Constantes específicas do Ronco (motor a pistão). As físicas gerais (P0, RGAS, GAM, SOUND_SPEED…)
// ficam em src/acoustics/constantes.ts. Valores iguais aos de src/dsp.js: não mude sem rodar
// tools/ronco-paridade.ts (e, se for de propósito, a revisão de som).

// temperaturas de referência (K): ar no coletor de admissão, gás que volta do escape para o
// cilindro e parede do cilindro
export const T_MAN = 310;
export const T_BACK = 850;
export const T_WALL = 430;

// temperatura do gás na abertura da válvula de escape em carga total (referência da densidade)
export const T_EXREF = 1650;

// harmônicos do uivo do compressor de duplo parafuso (amplitude, fundamental = 1): o 2º igual ao fundamental, como na
// desaceleração de um Hellcat gravado; do 3º em diante a gravação só dá um teto (ruído de fundo), e eles caem mais
export const SCREW_H = [1, 1, 0.3, 0.25, 0.15, 0.12, 0.07, 0.05];

// Comprimento da volta (m) em cada ambiente quando o observador está parado.
export const ENV_LOOP = { open: 800, street: 400, tunnel: 500, garage: 160, track: 1400, canyon: 1000 };
