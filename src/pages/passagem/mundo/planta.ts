// A planta de cada cenário da Passagem, sem three.js: qual cenário cada preset ganha, as medidas da rua, o morro do túnel
// com o emboque, o vale da ponte, a segunda plataforma da estação e as casas e galpões (as caixas que o observador não
// atravessa). O lugar (lugar.ts) pisa nestas medidas e a cena 3D (mundo/) desenha as mesmas: o que se vê é o que se pisa.
// Coordenadas da via, como em lugar.ts: `s` ao longo dela e `m` para o lado do ponto de chegada.

/** o cenário em volta da via */
export type Cenario = 'tunel' | 'estacao' | 'ponte' | 'corte' | 'ferrovia' | 'patio-ferro' | 'rua' | 'estrada-rural' | 'reta-arvores'
  | 'aerodromo' | 'parque' | 'patio' | 'fazenda' | 'rio';

export interface EscolhaCenario { ambiente: string; portador: string; motor: string; motorPreset: string | null; altitude: number }

/**
 * O cenário de cada combinação: os ambientes com estrutura (túnel, estação, ponte, corte) são eles mesmos; a céu aberto,
 * o lugar onde aquele veículo passa de verdade (a rua do carro, a estrada de terra do Sherman, a reta de Hunaudières,
 * o aeródromo dos aviões, o parque do drone, o pátio do gerador, a ferrovia e o pátio de manobras, a fazenda, o rio).
 */
export function qualCenario(e: EscolhaCenario): Cenario {
  if (e.ambiente === 'tunel' || e.ambiente === 'estacao' || e.ambiente === 'ponte' || e.ambiente === 'corte') return e.ambiente;
  const p = e.portador, id = e.motorPreset ?? '';
  if (p === 'drone') return 'parque';
  if (p === 'helice' || p === 'aviao' || p === 'rotor' || e.altitude > 2) return 'aerodromo';
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

// ------------------------------------------------------------------ aeródromo

/**
 * O aeródromo ao lado do voo: você fica no gramado de fora, junto da cerca; a pista corre paralela à trajetória do
 * avião a 70 m, depois o taxiway, o pátio de concreto e a fileira de hangares, o escritório e a torre.
 */
export const AERO = { pista: -70, meiaPista: 22.5, cerca: -32, taxi: [-127, -112] as const, patio: [-203, -135] as const, hangar: -205 } as const;

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
