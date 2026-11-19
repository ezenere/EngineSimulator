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

// ---- Médios e jato da ponteira (docs/TECNICO.md → Ronco → "Médios" e "Jato da ponteira"; tools/ronco-estagios.ts mede)
// Carcaça do escape: a ressonância da parede dos tubos e do abafador (Hz num escape de 2,5"; cai com o diâmetro) e o
// seu amortecimento (Q), o corte da massa da parede acima dela, o ganho de referência (0 dB no controle `carcaca`, num
// escape de 3 m com abafador esportivo), o quanto cada abafador irradia e o piso do controle (desligada)
export const CARCACA = { f0: 950, q: 2.2, fMassa: 2600, ref: 0.25, piso: -30, abafador: { straight: 0.3, sport: 1, stock: 0.6, classic: 1.25 } };
// Batida periódica da mecânica: modos do bloco excitados pelo pistão (f1, f2) e do cabeçote pelas válvulas (fV), o peso
// de cada um, o corte acima deles (a estrutura não irradia o agudo do impacto), o ganho de referência (0 dB no controle
// `batida`) e o piso do controle
export const BATIDA = { f1: 750, q1: 1.8, f2: 1500, q2: 2.0, fV: 2100, qV: 1.8, peso2: 0.7, pesoV: 0.3, fCorte: 2200, ref: 3.2, piso: -30 };
// Mach na ponteira por unidade da velocidade normalizada do jato: 25 kPa de onda num tubo de 2,5" são ~100 m/s de gás
// (ρc ≈ 250 Pa·s/m), com o som a ~400 m/s na ponta
export const JATO_MACH = 0.25;
// bomba de ar secundário (`bombaAr`): sem o campo, 'tom' (os dois senos parados de antes)
export const BOMBA_AR = { tom: 0, larga: 1, sem: 2 };
