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
// fundo mecânico contínuo (engrenagens, bomba, correias), na mesma escala. 0,02 na 1ª passada; 0,1 na 2ª, para a lenta
// do cofre chegar ao p90/p10 de 15–17 dB de um vídeo lo-fi (cujo vão é o ruído da gravação). Mas é ruído branco em 1,5
// e 3,5 kHz, liso, que não segue as explosões: na lenta era 80–100% da energia do vão entre elas de 1 a 4 kHz, o "som
// de ar" da lenta. 3ª passada: 0,012, o maior valor em que ele é no máximo metade do vão de 1–4 kHz também nos
// caminhões (teste:diesel → envoltoria; TECNICO.md → Diesel)
export const K_FUNDO = 0.012;
export const K_VIB = 0.1;
// perda de calor para a parede no diesel, sobre a do Ronco: a mistura pobre da lenta (λ 4–8) queima mais fria e a
// perda ×1 deixava o gás a 480–520 K na abertura do escape em lenta (alvo 600–750 K)
export const K_CALOR = 0.6;

// tempo de mistura do jato na queima por difusão (ms) para um cilindro de 100 mm com 200 MPa de injeção; escala com o
// diâmetro e com 1/√(pressão de injeção) (DieselDSP.tMistura). Acertado para a plena carga da tabela 2.5 (pico a 10–14°,
// dp/dθ 5–8 bar/° na picape)
export const K_MISTURA = 0.5;

// ruído aerodinâmico de banda larga da turbina, em fração de Zr·ṁ (pressão de um pulso) com a ponta do rotor a 500 m/s;
// acertado na banda 1–6 kHz do EMD 710 em notch 8 (gravação do SD70ACe, DIESEL.md 4.4)
export const K_TURBINA = 0.0045;

// banda larga do compressor sob carga (DieselDSP.turboSom), na escala do canal do turbo. A 2ª passada acertou 4,5 nas
// bandas de 1–12 kHz dos caminhões, ônibus e gerador em carga do real3, mas liso (modulado ±15% pela média): era 60–95%
// do som ponderado A em carga e enchia o vão entre as explosões (o "mar"). Agora segue o pulso na entrada da turbina e
// fica 6 dB abaixo (3ª passada, TECNICO.md → Diesel)
export const K_SOPRO = 2.25;

// profundidade da modulação do ruído do turbo (sopro do compressor e banda larga da turbina) pela pressão instantânea
// na entrada da turbina: 0 = liso, 1 = segue o pulso inteiro
export const K_MOD_TURBO = 1;

// ruído de choque do jato subexpandido do Jake (fração de Zr·ṁ por (M² − 1)); acertado no agudo do Jake (DIESEL.md 3.4)
export const K_CHOQUE = 0.025;
