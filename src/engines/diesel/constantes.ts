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
  // (4ª passada: +6 → 0 dB. Com +6 o tique do injetor-bomba era 56–62% de 1–6 kHz na lenta do caminhão, à frente da
  // batida da queima, e deixava 2,5–6 kHz 4–10 dB acima da gravação do Cat C15 de fora)
  unitaria: { fecha: true, nivel: 0, bp: [[2200, 2], [3500, 2]], tau: 1.2, a: 0.4 },
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

// ---- Estrutura do motor (4ª passada: "mais motor, menos ar"; TECNICO.md → Diesel → Quarta passada) ----------------
// O que se ouve de um diesel de 400 Hz a 6 kHz é o bloco, o cabeçote, o cárter e as tampas respondendo a pancadas: a
// subida de pressão de cada queima, a agulha de cada injetor, cada válvula assentando. A resposta de uma estrutura a
// uma pancada é sempre a mesma forma de onda (por isso um motor real tem linhas até vários kHz) e demora a morrer (por
// isso entre uma explosão e outra o motor real não fica mudo). Até a 3ª passada isso era ruído branco filtrado, com a
// envoltória de cada evento: rajadas de chiado separadas por silêncio. Agora é um banco de modos (ressonadores),
// excitado pela taxa de subida de pressão que a queima produz, (γ−1)·dQ/V por unidade de tempo, e por impulsos nos
// impactos; cada cilindro chega a quem ouve por um caminho próprio (peso e sinal por modo), então cada um tem a sua
// "voz" e um deles domina, como nas gravações.
//   modos            quantos ressonadores (espalhados em escala logarítmica, com um desvio sorteado e fixo)
//   fMin, fMax       Hz num cilindro de 100 mm (o de baixo escala com √(100 mm/diâmetro); o de cima, com a raiz quarta)
//   qMin, qMax       fator de qualidade do modo mais grave e do mais agudo (perda 7–11%: motor montado, com óleo e juntas)
//   espalha          desvio relativo das frequências
//   caminho, modo    dB: desvio-padrão do ganho do caminho de cada cilindro (todos os modos) e de cada modo
//   jitter           ms: desvio-padrão do instante de cada impacto mecânico (a queima já varia pelo atraso de ignição)
//   ampJitter        desvio relativo da força de cada impacto
//   ganho            escala do banco (deixa o K_MEC na ordem de grandeza de antes)
export const EST = { modos: 30, fMin: 150, fMax: 7000, qMin: 9, qMax: 15, espalha: 0.055, caminho: 2, modo: 3, jitter: 0.06, ampJitter: 0.25, ganho: 0.004 };
// peso por frequência de cada fonte (pares [Hz, peso], interpolados em log f). A queima: a atenuação estrutural de um
// motor (da pressão no cilindro ao som irradiado) cai ~10 dB por oitava até ~1,5 kHz e fica plana daí até 3–4 kHz
// (a curva clássica dos medidores de ruído de combustão): abaixo de 1 kHz o bloco é rígido e irradia mal, e é em
// 1–3 kHz que a batida vive (gravações de perto: 1–2,5 kHz 4 a 6 dB acima de 400–1000 Hz). As válvulas batem no
// cabeçote e na tampa (agudo)
export const EST_COMB: [number, number][] = [[250, 0.04], [500, 0.14], [1000, 0.55], [1600, 1.0], [3200, 0.75], [5000, 0.45], [8000, 0.25]];
export const EST_VALV: [number, number][] = [[800, 0.1], [1600, 0.6], [3000, 1.0], [6000, 0.8]];
// a saia do pistão bate na camisa logo depois do PMS de queima, quando a força lateral da biela troca de lado: a
// camisa e a parede do bloco irradiam em 1–3 kHz
export const EST_SAIA: [number, number][] = [[400, 0.2], [900, 0.8], [1800, 1.0], [3600, 0.6], [7000, 0.3]];
// batida de saia: pico relativo ao da batida da queima de lenta quente, com a pressão no cilindro de `p0` bar no
// instante da troca de lado (8° depois do PMS); cresce com a pressão (carga) e com a folga do pistão frio
export const SAIA = { nivel: 0.3, p0: 55, angulo: 8, frio: 1.5 };
// Engrenagens da distribuição. O virabrequim de um diesel acelera a cada explosão e freia a cada compressão; na lenta,
// sem carga que mantenha os dentes encostados, as engrenagens da frente do motor (virabrequim, intermediária, comando,
// bomba) atravessam a folga e batem dos dois lados várias vezes entre uma explosão e a seguinte. É o chocalho de lenta
// do diesel, e é o que enche o intervalo entre as batidas com som do próprio motor (a auditoria mediu a falta dele:
// no cofre, 1–4 kHz caía 32 dB entre uma batida e a próxima; nas gravações, 15 a 16,5). São pancadas na estrutura,
// pelo caminho da tampa da distribuição, num padrão fixo por motor com o instante variando; somem com a carga, que
// mantém os dentes encostados. `nivel`: pico relativo ao da batida de lenta; `porCiclo`: pancadas por ciclo do motor
// (repartidas pelas explosões, no mínimo 2 por explosão); `carga`: quanto a carga as apaga (1/(1 + carga·combustível))
export const ENGRENAGENS = { nivel: 0.25, porCiclo: 24, carga: 4, frio: 0.5 };
export const EST_ENG: [number, number][] = [[400, 0.15], [800, 0.55], [1500, 1.0], [3000, 1.0], [6000, 0.5]];
// a força nos injetores, nos balancins e na bomba cresce com a pressão de injeção (injetor-bomba e bomba em linha:
// ∝ rotação²; common-rail: a pressão do trilho, que a central sobe com a carga): expoente do tique sobre a razão
// entre a pressão de injeção e a da lenta
export const EXP_TIQUE = 0.7;
// Aspereza da queima. A liberação de calor do modelo (Wiebe) é lisa: a subida de pressão que ela dá não tem nada
// acima de ~1 kHz (cai 60–80 dB por década), e a de um motor real cai só 10–20 dB por década até vários kHz, porque a
// chama pré-misturada acende em vários pontos, aos trancos, e a câmara ressoa. Essa aspereza entra como uma
// modulação da taxa de subida, amostra a amostra, de valor eficaz K_ASPEREZA/√3 vezes a própria taxa. Uma parte dela
// se repete igual em todo ciclo de cada cilindro (a geometria do jato e da câmara: a fração ASPEREZA_FIXA da energia,
// uma assinatura sorteada uma vez por cilindro), o resto muda a cada queima (a turbulência: o "chocalho")
export const K_ASPEREZA = 3.0;
export const ASPEREZA_FIXA = 0.5;
// a aspereza não é branca: a chama de um cilindro grande muda mais devagar (as escalas da turbulência crescem com o
// diâmetro). Corte (passa-baixa de 1 polo) em F_ASPEREZA·(100 mm/diâmetro): 2,7 kHz na picape, 1,8 kHz no caminhão de
// 137 mm, 1,1 kHz na locomotiva. É o que deixa a batida de um motor grande mais grave que a de um pequeno
export const F_ASPEREZA = 2500;

// Corpo da batida (5ª passada: os médios; TECNICO.md → Diesel → Quinta passada). Os modos do bloco não irradiam todos
// por igual: de 400 a 2500 Hz quem irradia são as chapas grandes e finas presas a ele (o cárter, a tampa da
// distribuição, as tampas de válvulas, a carcaça do volante), que respondem às mesmas pancadas e têm os seus modos
// justamente aí. Os perfis das fontes (EST_COMB e os outros) são os de um bloco nu; com eles os médios de cada batida
// ficavam 3 a 5 dB abaixo das gravações de fora em relação ao total, na lenta, e mais que isso acelerando. `corpo` (dB,
// campo do preset; 0 = como era) é quanto essas chapas somam à irradiação de cada modo: um sino em escala
// logarítmica, centrado em `f` Hz num cilindro de 100 mm (desce com a raiz do diâmetro, como os modos graves) e com
// `largura` oitavas de desvio-padrão. Medido com +4 dB, com meio pedal: +2,3 a +3,4 dB em 400–1000 Hz, +2,6 a +3,2 dB
// em 1–2,5 kHz, 0,0 a +0,5 dB em 150–400 Hz e, em 2,5–6 kHz, +0,5 a +1,0 dB nos caminhões e +1,2 a +1,6 dB nas
// picapes (o sino delas fica mais alto). O grave do escape fica onde estava. Vale para tudo o que excita a estrutura
// (a queima e os impactos), porque é a saída dela; a referência dos impactos (`refKnock`) é medida antes dos pesos, e
// não muda
export const CORPO = { f: 950, largura: 1.0 };

// O cofre: a mecânica não chega a quem ouve só pelo caminho direto. O som do bloco bate no capô, no chão, na
// carroceria e sai por baixo e pelas grades: cada pancada chega várias vezes ao longo de ~50 ms, e é isso (com as
// válvulas e os injetores espalhados pelo ciclo) que impede o motor real de ficar mudo entre uma explosão e outra.
// É uma rede de 4 atrasos realimentados (2,3 a 6,7 ms num motor de 100 mm; cresce com √diâmetro), determinística:
// o que ela devolve é a própria batida, não ruído. `t60` em ms, `corte` do agudo nas reflexões em Hz, `nivel` em dB
// (o padrão do campo `cofre` do preset)
export const COFRE = { atrasos: [2.3, 3.4, 4.9, 6.7], t60: 40, corte: 3500, nivel: -10 };
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
// 4ª passada: 0,0045 → 0,00035 (−22 dB). Com 0,0045 a banda larga da turbina era 77% (notch intermediário) a 94% (notch
// 8) do som ponderado A do EMD, a fonte dominante em toda banda de 400 Hz a 6 kHz, e as linhas do 2 tempos (240 Hz e
// múltiplos) ficavam enterradas (HNR de 400–1k: −8 dB contra +9 da gravação)
export const K_TURBINA = 0.00035;

// banda larga do compressor sob carga (DieselDSP.turboSom), na escala do canal do turbo. A 2ª passada acertou 4,5 nas
// bandas de 1–12 kHz dos caminhões, ônibus e gerador em carga do real3, mas liso (modulado ±15% pela média): era 60–95%
// do som ponderado A em carga e enchia o vão entre as explosões (o "mar"). Agora segue o pulso na entrada da turbina e
// fica 6 dB abaixo (3ª passada, TECNICO.md → Diesel)
// 4ª passada: 2,25 → 0,07 (−30 dB), e o chiado de 1,3 kHz junto (K_CHIADO_TURBO). Mesmo modulado, o sopro ainda era a
// fonte dominante de 400 Hz a 6 kHz em carga (75–100% de cada banda na cabine do caminhão, 46–48% do total ponderado
// A) e, no enchimento do turbo, subia em 6,5 (de fora) a 10,9 dB (cabine) o que há acima de 1 kHz: o "som de mar
// quando o turbo sobe". O compressor fica dentro da tubulação de admissão, atrás da caixa do filtro, que é um
// silenciador (câmara de expansão e elemento de papel: 20–30 dB acima de 500 Hz): de fora quase não se ouve o sopro. O
// que se ouve do turbo é o apito das pás, um tom fino (gravação do Cat C15 na cabine: 14 dB sobre o fundo local e 20 dB
// abaixo da banda das ordens, e só em carga)
export const K_SOPRO = 0.07;
export const K_CHIADO_TURBO = 0.0006;

// Jato livre na boca do escape. A potência acústica de um jato subsônico cresce com U⁸ (Lighthill); o Ronco usa U⁴
// (amplitude ∝ v² com a velocidade de cada pulso), afinado de ouvido para os "pufs" de um motor a gasolina. No diesel
// isso superestimava o jato em lenta e em carga parcial em 30–50 dB: no 300D aspirado ele era 76–88% do som ponderado
// A em qualquer condição, e na Hilux 40–96% de 2,5–6 kHz ("soavam como vento"). Aqui o ganho do jato segue a
// velocidade média do gás na boca ao quadrado até V0 (com a do pulso ao quadrado, do Ronco, dá a quarta potência na
// amplitude, U⁸ na potência) e satura acima de V1 (boca pequena demais: o escoamento engasga, não rasga)
export const K_JATO = 0.1;
export const JATO_V0 = 1.0;
export const JATO_V1 = 1.5;

// profundidade da modulação do ruído do turbo (sopro do compressor e banda larga da turbina) pela pressão instantânea
// na entrada da turbina: 0 = liso, 1 = segue o pulso inteiro
export const K_MOD_TURBO = 1;

// ruído de choque do jato subexpandido do Jake (fração de Zr·ṁ por (M² − 1)); acertado no agudo do Jake (DIESEL.md 3.4)
export const K_CHOQUE = 0.025;
