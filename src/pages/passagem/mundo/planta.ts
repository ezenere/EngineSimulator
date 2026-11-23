// A planta de cada cenário da Passagem, sem three.js: qual cenário cada preset ganha, as medidas da rua, o morro do túnel
// com o emboque, o vale da ponte, a segunda plataforma da estação e as casas e galpões (as caixas que o observador não
// atravessa). O lugar (lugar.ts) pisa nestas medidas e a cena 3D (mundo/) desenha as mesmas: o que se vê é o que se pisa.
// Coordenadas da via, como em lugar.ts: `s` ao longo dela e `m` para o lado do ponto de chegada.

/** o cenário em volta da via */
export type Cenario = 'tunel' | 'estacao' | 'estacao-metro' | 'estacao-antiga' | 'ponte' | 'corte' | 'ferrovia' | 'patio-ferro' | 'rua' | 'estrada-rural' | 'reta-arvores'
  | 'aerodromo' | 'aero-pista' | 'aero-cabeceira' | 'aero-patio' | 'aero-cerca' | 'aero-campo' | 'parque' | 'patio' | 'fazenda' | 'rio';

/** os cenários de estação (a plataforma em que se pisa) e os de aeródromo */
export const ehEstacao = (c: Cenario | null | undefined) => c === 'estacao' || c === 'estacao-metro' || c === 'estacao-antiga';
export const ehAero = (c: Cenario | null | undefined) => !!c && (c === 'aerodromo' || c.startsWith('aero-'));

export interface EscolhaCenario { ambiente: string; portador: string; motor: string; motorPreset: string | null; altitude: number }

/**
 * O cenário de cada combinação: os ambientes com estrutura (túnel, estação, ponte, corte) são eles mesmos; a céu aberto,
 * o lugar onde aquele veículo passa de verdade (a rua do carro, a estrada de terra do Sherman, a reta de Hunaudières,
 * o aeródromo dos aviões, o parque do drone, o pátio do gerador, a ferrovia e o pátio de manobras, a fazenda, o rio).
 */
export function qualCenario(e: EscolhaCenario): Cenario {
  const p = e.portador, id = e.motorPreset ?? '';
  // a estação: a de superfície (o galpão de aço), a do metrô (subterrânea) e a antiga do interior (a da Maria Fumaça)
  if (e.ambiente === 'estacao') return p === 'locomotiva' && e.motor === 'vapor' ? 'estacao-antiga' : p === 'trem' && ['frotaa', 'metropolis'].includes(id) ? 'estacao-metro' : 'estacao';
  if (e.ambiente === 'tunel' || e.ambiente === 'ponte' || e.ambiente === 'corte') return e.ambiente;
  if (p === 'drone') return 'parque';
  if (p === 'helice' || p === 'aviao' || p === 'rotor' || e.altitude > 2) return qualAero(p, id, e.altitude);
  if (p === 'trem') return 'ferrovia';
  if (p === 'locomotiva') return e.motor === 'diesel' ? 'patio-ferro' : 'ferrovia';
  if (p === 'gerador') return 'patio';
  if (p === 'trator') return 'fazenda';
  if (p === 'barco') return 'rio';
  if (p === 'carro') {
    if (e.motor === 'radial') return id === 'r975' ? 'estrada-rural' : 'reta-arvores';
    if (id === 'r26b' || id === 'formulae' || ['v10f1', 'f1v8', 'f1v12', 'nascar', 'c8r'].includes(id)) return 'reta-arvores';
    return 'rua';
  }
  return 'ferrovia';
}

/**
 * O lugar de onde se vê cada avião passar (você fica sempre no mesmo ponto debaixo da trajetória: o que muda é o
 * aeródromo em volta): na beira da pista de um festival aéreo (o Corsair, o Yak-52), na cabeceira de um aeroporto
 * regional com o turboélice decolando por cima (o ATR), no gramado do pátio do aeroclube (o Cessna), na cerca de uma
 * base (o P-47, o caça), no campo, longe de tudo (o jato a 1 500 m, o VANT). O resto, o aeródromo genérico.
 */
function qualAero(p: string, id: string, alt: number): Cenario {
  if (p === 'aviao') return alt > 600 ? 'aero-campo' : 'aero-cerca';
  if (p === 'helice') {
    if (id === 'r2800' || id === 'm14p') return 'aero-pista';
    if (id === 'regional') return 'aero-cabeceira';
    if (id === 'c172') return 'aero-patio';
    if (id === 'r2800turbo') return 'aero-cerca';
    if (id === 'ar741') return 'aero-campo';
  }
  return 'aerodromo';
}

// ------------------------------------------------------------------ rua

/**
 * Rua de bairro com mão dupla: a faixa do carro centrada na via (m = 0), a faixa de lá, a faixa de estacionar de cada
 * lado, meio-fio de 15 cm e calçada de 3,5 m; os lotes começam depois da calçada (jardim da frente e a casa).
 */
export const RUA = { faixa: 3.5, estacionar: 2.2, meioFio: 0.15, calcada: 3.5, recuo: 4 } as const;
/** bordas do asfalto (m) e das calçadas */
export const RUA_M = (() => {
  const perto = RUA.faixa / 2 + RUA.estacionar, longe = -(RUA.faixa * 1.5 + RUA.estacionar);
  return { perto, longe, calcadaPerto: perto + RUA.calcada, calcadaLonge: longe - RUA.calcada };
})();

// ------------------------------------------------------------------ estação

/** a segunda via da estação e a plataforma do outro lado, debaixo da mesma cobertura (o galpão cobre as duas) */
export const ESTACAO_OUTRA = { via: -4.6, plataforma: [-14.6, -6.4] as const, muro: -15.2, muroAlto: 2.6, telhado: -15.6 } as const;

/**
 * As medidas de cada estação (em m; a borda da plataforma fica a 0,35 m da lateral do trem, em lugar.ts): meia extensão
 * da plataforma ao longo da via, largura dela e o fundo até a parede (ou o prédio), a altura do teto (a cobertura, o
 * forro do metrô, a gare), a plataforma do outro lado (ou nenhuma) e, no metrô, a caixa inteira: as paredes de lá e de
 * cá e o teto valem para a via toda (lá embaixo não há céu)
 */
export interface MedidasEstacao { meio: number; /** meia extensão da cobertura */ cobre: number; largura: number; fundo: number; teto: number; outra: { via: number; plataforma: readonly [number, number]; telhado: number } | null; caixa: { longe: number; perto: number; teto: number } | null }
export function medidasEstacao(c: Cenario | null | undefined, borda: number): MedidasEstacao {
  if (c === 'estacao-metro') return { meio: 80, cobre: 80, largura: 5.2, fundo: 0.4, teto: 5.4, outra: { via: -4.4, plataforma: [-10.0, -6.2], telhado: -10.6 }, caixa: { longe: -10.6, perto: borda + 5.6, teto: 5.4 } };
  if (c === 'estacao-antiga') return { meio: 55, cobre: 30, largura: 5.5, fundo: 0.5, teto: 4.1, outra: null, caixa: null };
  return { meio: 160, cobre: 160, largura: 8, fundo: 2, teto: 7, outra: { via: ESTACAO_OUTRA.via, plataforma: ESTACAO_OUTRA.plataforma, telhado: ESTACAO_OUTRA.telhado }, caixa: null };
}

// ------------------------------------------------------------------ aeródromo

/**
 * O aeródromo ao lado do voo: você fica no gramado de fora, junto da cerca; a pista corre paralela à trajetória do
 * avião a 70 m, depois o taxiway, o pátio de concreto e a fileira de hangares, o escritório e a torre.
 */
export const AERO = { pista: -70, meiaPista: 22.5, cerca: -32, taxi: [-127, -112] as const, patio: [-203, -135] as const, hangar: -205 } as const;
/**
 * As variantes (m: para o seu lado; s: ao longo da trajetória, o avião vem de s negativo): a beira da pista (a pista de cá
 * da trajetória, o alambrado do público atrás de você), a cabeceira (a pista no eixo, à sua frente, acabando em `fim`),
 * o pátio do aeroclube (o concreto até 4 m de você, os hangares a 66 m), a cerca da base (a tela a 1 m da trajetória, a
 * pista a 85 m lá dentro)
 */
export const AERO_PISTA = { pista: -24, meia: 22.5, publico: 5.5 } as const;
export const AERO_CABECEIRA = { meia: 22.5, fim: -210, cerca: -24, localizador: -105 } as const;
export const AERO_PATIO = { patio: [-62, -4] as const, hangar: -66, pista: -150 } as const;
export const AERO_CERCA = { cerca: -1.0, pista: -85 } as const;

// ------------------------------------------------------------------ túnel: o morro e o emboque

/** o morro em cima do túnel: crista, meia largura do alto, rampas, e o emboque (testa de concreto com as alas) */
export const MORRO = { crista: 28, topo: 22, rampaLado: 0.38, rampaFrente: 1.0, alas: 0.85, folgaTesta: 2.6, sobreTesta: 2.4 } as const;

export interface TuboTunel { ta: number; tb: number; mPerto: number; mLonge: number; h: number }
/** medidas do emboque: o centro do tubo, a meia largura da testa e a altura dela */
export function emboque(t: TuboTunel) {
  const mc = (t.mPerto + t.mLonge) / 2, meio = (t.mPerto - t.mLonge) / 2 + 0.5;
  return { mc, meia: meio + MORRO.folgaTesta, alto: t.h + 0.5 + MORRO.sobreTesta };
}
/**
 * Altura do morro em (s, m): a crista em cima do tubo descendo em rampa dos dois lados; nas bocas, a testa vertical do
 * emboque (até `alto`) com o terreno subindo a 45° para dentro do morro, e as alas: o vale de acesso na frente da boca
 * (fundo em 0) com as paredes laterais descendo a 45° para fora. Fora do trecho do túnel e longe dele, 0.
 */
export function alturaMorro(t: TuboTunel, s: number, m: number) {
  const e = emboque(t), d = Math.abs(m - e.mc);
  const lado = MORRO.crista - MORRO.rampaLado * Math.max(0, d - MORRO.topo);
  if (lado <= 0) return 0;
  const face = (dentro: number) => {
    if (dentro < 0 && d < e.meia) return 0;                     // o vale de acesso, na frente da boca
    return e.alto + MORRO.rampaFrente * dentro - MORRO.alas * Math.max(0, d - e.meia);
  };
  return Math.max(0, Math.min(lado, face(s - t.ta), face(t.tb - s)));
}

// ------------------------------------------------------------------ ponte: o vale

/** o vale debaixo do viaduto: o fundo em PONTE.vale até `fundo` m da via, as encostas subindo até 0 em `borda` */
export const VALE = { fundo: 170, borda: 330, rio: 85, larguraRio: 26 } as const;
export function alturaVale(m: number, fundoZ: number) {
  const a = Math.abs(m);
  if (a <= VALE.fundo) return fundoZ;
  if (a >= VALE.borda) return 0;
  const t = (a - VALE.fundo) / (VALE.borda - VALE.fundo);
  return fundoZ * (1 - t * t * (3 - 2 * t));
}

// ------------------------------------------------------------------ casas e galpões (sorteio fixo)

/** gerador pseudoaleatório com semente (o mesmo lugar toda vez) */
export function sorteio(semente: number) {
  let a = semente >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** uma construção: o pé dela em (s, m) (centro), comprimento ao longo da via, fundo, altura das paredes, telhado */
export interface Construcao {
  s: number; m: number; l: number; p: number; h: number;
  telhado: 'duas-aguas' | 'plano' | 'arco'; cor: number; corTelhado: number; andares: number;
  /** de frente para a via (+1: a fachada olha para m menor; −1: para m maior) */
  frente: 1 | -1;
  tipo: 'casa' | 'predio' | 'galpao' | 'celeiro' | 'hangar' | 'torre' | 'escritorio' | 'conteiner';
}
/** caixa que o observador não atravessa (a pé nem voando abaixo de h) */
export interface Obstaculo { s0: number; s1: number; m0: number; m1: number; h: number }

const CORES_CASA = [0xe6dcc0, 0xf0ece2, 0xe8d48a, 0xc9d6d8, 0xd9a58a, 0xb9c8a8, 0xe3c7a0, 0xd0cfc9];
const CORES_TELHA = [0xa4553a, 0x8f4a33, 0x6b6e73, 0xb46a45, 0x5b5f63];

/** comprimento e raio da via (para as construções saberem até onde ir e não cruzarem o miolo da volta) */
export interface ViaPlanta { tipo: 'reta' | 'volta'; comp: number; R: number; ls: number }

/** fileira de casas de um lado da via, do s0 ao s1, com o recuo dado; na volta, só nas retas do lado de dentro */
function fileira(sorte: () => number, v: ViaPlanta, s0: number, s1: number, mFrente: number, lado: 1 | -1, predios = 0): Construcao[] {
  const l: Construcao[] = [];
  let s = s0 + sorte() * 6;
  while (s < s1) {
    const predio = sorte() < predios, larg = predio ? 14 + sorte() * 10 : 8 + sorte() * 5, fundo = predio ? 12 + sorte() * 6 : 8 + sorte() * 4;
    const sc = s + larg / 2;
    if (sc + larg / 2 > s1) break;
    // (na volta, do lado de dentro, as casas ficam nas retas: nas curvas elas se espremeriam)
    const naCurva = v.tipo === 'volta' && lado < 0 && !(dentroDaReta(v, sc - larg / 2) && dentroDaReta(v, sc + larg / 2));
    if (!naCurva) {
      const andares = predio ? 3 + Math.floor(sorte() * 4) : sorte() < 0.3 ? 2 : 1;
      l.push({ s: sc, m: lado * (mFrente + fundo / 2 + sorte() * 1.5), l: larg, p: fundo, h: andares * 3 + (predio ? 0.6 : 0.4), andares,
        telhado: predio || sorte() < 0.25 ? 'plano' : 'duas-aguas', cor: CORES_CASA[Math.floor(sorte() * CORES_CASA.length)], corTelhado: CORES_TELHA[Math.floor(sorte() * CORES_TELHA.length)],
        frente: lado, tipo: predio ? 'predio' : 'casa' });
    }
    s += larg + 2.5 + sorte() * 5;
  }
  return l;
}
/** s está numa das retas da volta (fora das curvas) */
function dentroDaReta(v: ViaPlanta, s: number) {
  if (v.tipo === 'reta') return true;
  // (a volta começa no meio da reta de baixo: s = 0 é o meio dela; a de cima fica meia volta adiante)
  const L = v.comp; let u = s % L; if (u < 0) u += L;
  const h = v.ls / 2, arco = Math.PI * v.R;
  return u <= h - 2 || (u >= h + arco + 2 && u <= h + arco + v.ls - 2) || u >= L - h + 2;
}

/** extensão (s) onde o cenário põe construções: a volta inteira, ou um trecho da reta em volta do ponto de chegada */
function trecho(v: ViaPlanta, meia: number): [number, number] {
  if (v.tipo === 'volta') return [-v.comp / 2, v.comp / 2];
  return [Math.max(-v.comp / 2 + 10, -meia), Math.min(v.comp / 2 - 10, meia)];
}

/** as construções de cada cenário (as mesmas para o desenho e para os obstáculos) */
export function construcoes(c: Cenario, v: ViaPlanta): Construcao[] {
  const sorte = sorteio(0x5a55 + c.length * 977);
  const out: Construcao[] = [];
  const C = (o: Partial<Construcao> & Pick<Construcao, 's' | 'm' | 'l' | 'p' | 'h' | 'tipo'>): Construcao => ({ telhado: 'duas-aguas', cor: 0xd0cfc9, corTelhado: 0x6b6e73, andares: 1, frente: 1, ...o });
  if (c === 'rua') {
    const [a, b] = trecho(v, 650);
    const recuo = RUA.recuo;
    out.push(...fileira(sorte, v, a, b, RUA_M.calcadaPerto + recuo, 1, 0.12));
    // (na volta pequena, o lado de dentro só tem as retas; o fundo dos lotes não passa do meio do quarteirão)
    out.push(...fileira(sorte, v, a, b, -RUA_M.calcadaLonge + recuo, -1, 0.2).filter((k) => v.tipo === 'reta' || Math.abs(k.m) + k.p / 2 < v.R - 6));
  } else if (c === 'estrada-rural' || c === 'fazenda') {
    out.push(C({ s: 45, m: -62, l: 22, p: 14, h: 6.5, tipo: 'celeiro', cor: 0x9a3a2a, corTelhado: 0x5b5f63, frente: -1 }));
    out.push(C({ s: 10, m: -58, l: 11, p: 9, h: 3.2, tipo: 'casa', cor: 0xf0ece2, corTelhado: 0xa4553a, frente: -1 }));
    out.push(C({ s: -230, m: 140, l: 18, p: 12, h: 5.5, tipo: 'celeiro', cor: 0x8a3a2a, corTelhado: 0x6b6e73, frente: 1 }));
  } else if (c === 'aerodromo') {
    const A = AERO;
    for (const [s, l] of [[-170, 46], [-112, 46], [-54, 46]] as const) out.push(C({ s, m: A.hangar - 20, l, p: 40, h: 11, tipo: 'hangar', telhado: 'arco', cor: 0xb9bcc0, corTelhado: 0x8f949a, frente: -1 }));
    out.push(C({ s: 40, m: A.hangar - 7, l: 26, p: 14, h: 7, tipo: 'escritorio', telhado: 'plano', cor: 0xe6e2d8, andares: 2, frente: -1 }));
    out.push(C({ s: 78, m: A.hangar - 3, l: 6, p: 6, h: 22, tipo: 'torre', telhado: 'plano', cor: 0xe6e2d8, frente: -1 }));
  } else if (c === 'aero-pista') {
    // do outro lado da pista: os hangares e a torre; atrás do público, as tendas do festival
    for (const [s, l] of [[-420, 46], [-360, 46], [-300, 46]] as const) out.push(C({ s, m: AERO_PISTA.pista - 150, l, p: 40, h: 11, tipo: 'hangar', telhado: 'arco', cor: 0xb9bcc0, corTelhado: 0x8f949a, frente: -1 }));
    out.push(C({ s: -180, m: AERO_PISTA.pista - 120, l: 6, p: 6, h: 22, tipo: 'torre', telhado: 'plano', cor: 0xe6e2d8, frente: -1 }));
    for (let s = -70; s <= 70; s += 14) if (Math.abs(s) > 6) out.push(C({ s, m: 17, l: 8, p: 6, h: 2.6, tipo: 'casa', telhado: 'duas-aguas', cor: s % 28 === 0 ? 0xeef0f2 : 0xe2c23a, corTelhado: s % 28 === 0 ? 0xeef0f2 : 0xd94a3a, frente: 1 }));
  } else if (c === 'aero-cabeceira') {
    // o aeroporto lá no fim da pista: o terminal, os hangares e a torre; o abrigo dos equipamentos do localizador
    out.push(C({ s: -1250, m: -160, l: 90, p: 30, h: 12, tipo: 'escritorio', telhado: 'plano', cor: 0xe6e2d8, andares: 3, frente: -1 }));
    for (const s of [-1050, -980]) out.push(C({ s, m: -150, l: 52, p: 44, h: 13, tipo: 'hangar', telhado: 'arco', cor: 0xb9bcc0, corTelhado: 0x8f949a, frente: -1 }));
    out.push(C({ s: -1150, m: -120, l: 7, p: 7, h: 28, tipo: 'torre', telhado: 'plano', cor: 0xe6e2d8, frente: -1 }));
    out.push(C({ s: AERO_CABECEIRA.localizador + 8, m: -28, l: 4, p: 3, h: 2.6, tipo: 'escritorio', telhado: 'plano', cor: 0xe6e2d8, frente: 1 }));
  } else if (c === 'aero-patio') {
    for (const [s, l] of [[-75, 30], [-40, 30], [-5, 30]] as const) out.push(C({ s, m: AERO_PATIO.hangar - 12, l, p: 24, h: 7, tipo: 'hangar', telhado: 'arco', cor: [0xb9bcc0, 0x9aa7b4, 0xc9c5b8][Math.abs(s) % 3], corTelhado: 0x8f949a, frente: -1 }));
    out.push(C({ s: 34, m: AERO_PATIO.hangar - 6, l: 16, p: 10, h: 3.4, tipo: 'escritorio', telhado: 'plano', cor: 0xeee6d2, frente: -1 }));
    out.push(C({ s: 50, m: AERO_PATIO.hangar - 4, l: 4, p: 4, h: 12, tipo: 'torre', telhado: 'plano', cor: 0xeee6d2, frente: -1 }));
  } else if (c === 'aero-cerca') {
    for (const [s, l] of [[-380, 60], [-310, 60]] as const) out.push(C({ s, m: AERO_CERCA.pista - 120, l, p: 50, h: 14, tipo: 'hangar', telhado: 'arco', cor: 0x8f9a86, corTelhado: 0x6b7560, frente: -1 }));
    out.push(C({ s: -200, m: AERO_CERCA.pista - 95, l: 7, p: 7, h: 20, tipo: 'torre', telhado: 'plano', cor: 0xd9d5c9, frente: -1 }));
    out.push(C({ s: 38, m: 7, l: 4, p: 3.5, h: 2.6, tipo: 'escritorio', telhado: 'plano', cor: 0xd9d5c9, frente: 1 }));
  } else if (c === 'aero-campo') {
    // a vila longe, do seu lado, e um sítio do outro
    const [a, b] = trecho(v, 900);
    out.push(...fileira(sorte, v, a, b, 160, 1, 0.1).filter((k) => Math.abs(k.s) < 500));
    out.push(C({ s: -120, m: -90, l: 20, p: 12, h: 6, tipo: 'celeiro', cor: 0x9a3a2a, corTelhado: 0x5b5f63, frente: -1 }));
    out.push(C({ s: -150, m: -82, l: 11, p: 9, h: 3.2, tipo: 'casa', cor: 0xf0ece2, corTelhado: 0xa4553a, frente: -1 }));
  } else if (c === 'estacao-antiga') {
    // o prédio da estação atrás da plataforma, o armazém, e a vila do outro lado da via
    out.push(C({ s: -6, m: 1.9 + 6.0 + 5, l: 22, p: 10, h: 4.6, tipo: 'casa', telhado: 'duas-aguas', cor: 0xe8d48a, corTelhado: 0xa4553a, frente: 1 }));
    out.push(C({ s: 34, m: 1.9 + 6.0 + 6, l: 16, p: 12, h: 5.2, tipo: 'galpao', telhado: 'duas-aguas', cor: 0xb9876a, corTelhado: 0x8f4a33, frente: 1 }));
    const [a, b] = trecho(v, 300);
    out.push(...fileira(sorte, v, a, b, 26, -1, 0.05).filter((k) => v.tipo === 'reta' || Math.abs(k.m) + k.p / 2 < v.R - 6));
  } else if (c === 'patio') {
    out.push(C({ s: -6, m: -26, l: 30, p: 16, h: 8, tipo: 'galpao', cor: 0xb9bcc0, corTelhado: 0x6b6e73, frente: -1 }));
    out.push(C({ s: -34, m: 22, l: 10, p: 7, h: 3.2, tipo: 'escritorio', telhado: 'plano', cor: 0xe6dcc0, frente: 1 }));
    // contêineres de 40 pés (um em cima do outro) e um de 20
    for (const [s, m, z, l, cor] of [[24, -11, 0, 12.2, 0x2f5aa8], [24, -11, 2.6, 12.2, 0xb8322a], [24, -14, 0, 12.2, 0x3f6b46], [-28, -11, 0, 6.1, 0xe08a2a]] as const)
      out.push(C({ s, m, l, p: 2.44, h: 2.6 + z, tipo: 'conteiner', telhado: 'plano', cor, frente: -1 }));
  } else if (c === 'patio-ferro') {
    out.push(C({ s: -30, m: -62, l: 70, p: 24, h: 10, tipo: 'galpao', cor: 0x9a5a44, corTelhado: 0x5b5f63, frente: -1 }));
    out.push(C({ s: -26, m: 24, l: 9, p: 6, h: 3.3, tipo: 'escritorio', telhado: 'plano', cor: 0xe3c7a0, frente: 1 }));
  } else if (c === 'parque') {
    const [a, b] = trecho(v, 450);
    for (const lado of [1, -1] as const) {
      let s = a;
      while (s < b) { const l = 18 + sorte() * 16, h = 10 + Math.floor(sorte() * 8) * 3.2; out.push(C({ s: s + l / 2, m: lado * (150 + sorte() * 10), l, p: 16 + sorte() * 8, h, andares: Math.round(h / 3.2), tipo: 'predio', telhado: 'plano', cor: CORES_CASA[Math.floor(sorte() * CORES_CASA.length)], frente: lado })); s += l + 6 + sorte() * 10; }
    }
  } else if (c === 'estacao') {
    // a cidade atrás do muro do outro lado
    const [a, b] = trecho(v, 260);
    out.push(...fileira(sorte, v, a, b, 24, -1, 0.75).filter((k) => v.tipo === 'reta' || Math.abs(k.m) + k.p / 2 < v.R - 6));
  } else if (c === 'ferrovia' || c === 'reta-arvores' || c === 'rio') {
    // uma casa de sítio aqui e ali, longe da via
    const [a, b] = trecho(v, 1500);
    for (let s = a + 120 + sorte() * 200; s < b; s += 260 + sorte() * 300) {
      const lado = sorte() < 0.5 ? 1 : -1, m = lado * ((c === 'rio' ? 130 : 70) + sorte() * 160);
      if (v.tipo === 'volta' && lado < 0 && Math.abs(m) > v.R - 20) continue;
      out.push(C({ s, m, l: 10 + sorte() * 4, p: 8 + sorte() * 3, h: 3.2, tipo: 'casa', cor: CORES_CASA[Math.floor(sorte() * CORES_CASA.length)], corTelhado: CORES_TELHA[Math.floor(sorte() * 3)], frente: lado as 1 | -1 }));
    }
  }
  return out;
}

/** caixas que o observador não atravessa, das construções */
export function obstaculos(cs: readonly Construcao[]): Obstaculo[] {
  return cs.map((k) => ({ s0: k.s - k.l / 2, s1: k.s + k.l / 2, m0: k.m - k.p / 2, m1: k.m + k.p / 2, h: k.h + (k.telhado === 'duas-aguas' ? k.p * 0.25 : k.telhado === 'arco' ? k.p * 0.3 : 0) }));
}
