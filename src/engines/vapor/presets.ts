// Presets do vapor (docs/VAPOR.md, seção 5): fichas de catálogo, um objeto por máquina. "≈" nos comentários marca
// estimativa por classe. Medidas anglo-americanas em polegadas e psi convertidas aqui (`pol`, `psi`); japonesas e
// métricas em mm. `lwChuff` e os níveis das outras fontes estão em 4.6 (constantes.ts → LW_VAPOR).

export type FamiliaVapor = 'locomotiva' | 'estacionaria' | 'trator' | 'carro' | 'barco';
export type PortadorVapor = 'locomotiva' | 'gerador' | 'carro' | 'trator' | 'barco' | 'nenhum';

export interface PresetVapor {
  id: string; nome: string; familia: FamiliaVapor;
  /** linha curta para o chip (máquina, ano, rodeiro) */
  tag: string;
  rodeiro?: string;                      // '4-6-2', '2-8-8-4'…
  /** cilindros simples (ou o conjunto inteiro de uma articulada: `motores` 2 duplica) */
  cilindros: { n: number; diametro: number; curso: number; angulo?: number[] };   // m; ângulos das manivelas em graus
  motores?: 1 | 2;                       // articulada: 2
  derivaFase?: number;                   // articulada: diferença de rotação entre os motores (0,5–2%)
  compound?: { ap: { n: number; diametro: number }; bp: { n: number; diametro: number }; receptor: number /* m³ */ };
  reducao?: number;                      // rev da manivela por rev da roda (Shay 2,6; Aveling 12 / 6; Stanley 1,5)
  reducao2?: number;                     // 2ª marcha (trator)
  dRoda: number;                         // m (estacionária: 0)
  pNominal: number;                      // bar manométrico
  superaquecido: boolean;
  evaporacaoMax: number;                 // kg/s
  kCaldeira?: number;                    // bar/kg (padrão 1/(10·evaporacaoMax))
  massa: number; massaAderente: number;  // t
  tender?: { massa: number; eixos: number; comprimento: number };
  vMax: number;                          // km/h (estacionária: rpm governado)
  escape: { dBico: number; lDescarga: number; vCaixa: number; lChamine: number; dChamine: number; kNL?: number; destino?: 'chamine' | 'condensador' | 'abafador'; pCondensador?: number /* Pa abs */ };
  apito: { tubos: number[]; nivelDb?: number; tipo?: 'chime' | 'simples' | 'navio' };
  sino?: { f: number; batidasPorS: number };
  bombaAr?: { n: 1 | 2; cursosPorMin: number };
  folga: number;
  geometria: { comprimento: number; largura: number; altura: number; xCilindros: number; yCilindros?: number; xChamine: number; xDomo: number; xCabine: number; zTopo: number };
  lwChuff: number;
  semente: number;
  portadores: PortadorVapor[];
  /** (extensões) */
  J?: number;                            // kg·m² do motor (rodeiro + bielas, ou volante), no eixo da roda
  rpmGovernado?: number;                 // estacionária / trator parado: alvo do governador de esferas
  engrenagens?: { z: number };
  correias?: { dVolante: number; dPolia: number };
  queimador?: boolean;
  pas?: { n: number; D: number };        // barco de rodas de pás
  vagao?: { massa: number };             // massa padrão do vagão (t)
  potenciaGerador?: number;              // kW (estacionária no portador gerador)
  hunting?: number;                      // governador mal ajustado (± fração), 0 por padrão
  /** nota da ficha (o que conferir antes de nomear uma máquina específica) */
  nota?: string;
}

const pol = (x: number) => x * 0.0254;
const psi = (x: number) => x * 0.0689476;
const mm = (x: number) => x / 1000;

const BOMBA1 = { n: 1 as const, cursosPorMin: 70 };
const BOMBA2 = { n: 2 as const, cursosPorMin: 60 };

export const PRESETS_VAPOR: readonly PresetVapor[] = [
  {
    id: 'k4s', nome: 'PRR K4s', familia: 'locomotiva', tag: 'Pacific 4-6-2 · 1914–28', rodeiro: '4-6-2',
    cilindros: { n: 2, diametro: pol(27), curso: pol(28) }, dRoda: pol(80), pNominal: psi(205), superaquecido: true, evaporacaoMax: 6.0,
    massa: 141, massaAderente: 92, tender: { massa: 95, eixos: 8, comprimento: 16 }, vMax: 150,
    escape: { dBico: 0.15, lDescarga: 0.8, vCaixa: 5, lChamine: 1.6, dChamine: 0.5 },
    apito: { tubos: [520], tipo: 'simples' }, sino: { f: 650, batidasPorS: 2.0 }, bombaAr: BOMBA1, folga: 0.3,
    geometria: { comprimento: 18.5, largura: 3.1, altura: 4.7, xCilindros: 6.9, xChamine: 6.4, xDomo: 2.2, xCabine: -6.6, zTopo: 4.5 },
    lwChuff: 124, semente: 0x4b45, portadores: ['locomotiva', 'nenhum'],
  },
  {
    id: 'a4', nome: 'LNER A4 Mallard', familia: 'locomotiva', tag: 'Pacific 3 cil. · 1938', rodeiro: '4-6-2',
    cilindros: { n: 3, diametro: pol(18.5), curso: pol(26), angulo: [0, 120, 240] }, dRoda: pol(80), pNominal: psi(250), superaquecido: true, evaporacaoMax: 5.5,
    massa: 103, massaAderente: 67, tender: { massa: 64, eixos: 8, comprimento: 9 }, vMax: 160,
    // chaminé dupla Kylchap (2 bicos de 0,12, 2 chaminés 0,45 × 1,5): bico equivalente de 0,17 e uma chaminé
    escape: { dBico: 0.17, lDescarga: 0.7, vCaixa: 4.5, lChamine: 1.5, dChamine: 0.45 },
    apito: { tubos: [311, 370, 466], tipo: 'chime' }, bombaAr: BOMBA1, folga: 0.2,
    geometria: { comprimento: 21.5, largura: 2.8, altura: 4.0, xCilindros: 8, xChamine: 7.4, xDomo: 3.0, xCabine: -6.0, zTopo: 3.9 },
    lwChuff: 124, semente: 0xa4a4, portadores: ['locomotiva', 'nenhum'],
  },
  {
    id: 'd51', nome: 'JNR D51 498', familia: 'locomotiva', tag: 'Mikado 2-8-2 · Japão', rodeiro: '2-8-2',
    cilindros: { n: 2, diametro: mm(550), curso: mm(660) }, dRoda: mm(1400), pNominal: 13.7, superaquecido: true, evaporacaoMax: 4.0,
    massa: 78, massaAderente: 59, tender: { massa: 47, eixos: 6, comprimento: 8.3 }, vMax: 85,
    escape: { dBico: 0.13, lDescarga: 0.7, vCaixa: 3.5, lChamine: 1.3, dChamine: 0.4 },
    apito: { tubos: [360, 465, 548], tipo: 'chime' }, bombaAr: BOMBA1, folga: 0.3,
    geometria: { comprimento: 11.5, largura: 2.9, altura: 3.9, xCilindros: 4.4, xChamine: 4.0, xDomo: 1.2, xCabine: -4.2, zTopo: 3.8 },
    lwChuff: 124, semente: 0xd51, portadores: ['locomotiva', 'nenhum'],
  },
  {
    id: 'up844', nome: 'UP 844', familia: 'locomotiva', tag: 'Northern 4-8-4 · 1944', rodeiro: '4-8-4',
    cilindros: { n: 2, diametro: pol(25), curso: pol(32) }, dRoda: pol(80), pNominal: psi(300), superaquecido: true, evaporacaoMax: 7.0,
    massa: 220, massaAderente: 120, tender: { massa: 196, eixos: 14, comprimento: 20 }, vMax: 130,
    escape: { dBico: 0.16, lDescarga: 0.9, vCaixa: 6, lChamine: 1.7, dChamine: 0.55 },
    // medido em Kosse: 281 · 344 · 408/420 (os dois tubos quase iguais batem a 13 Hz), e o 3º par ≈ 494
    apito: { tubos: [281, 344, 407, 420, 494], tipo: 'chime' }, sino: { f: 600, batidasPorS: 1.0 }, bombaAr: BOMBA2, folga: 0.3,
    geometria: { comprimento: 21, largura: 3.2, altura: 4.9, xCilindros: 8.2, xChamine: 7.6, xDomo: 2.5, xCabine: -7.5, zTopo: 4.75 },
    lwChuff: 128, semente: 0x844, portadores: ['locomotiva', 'nenhum'],
  },
  {
    id: 'bigboy', nome: 'UP 4014 Big Boy', familia: 'locomotiva', tag: 'articulada 4-8-8-4 · 1941', rodeiro: '4-8-8-4',
    cilindros: { n: 2, diametro: pol(23.75), curso: pol(32) }, motores: 2, derivaFase: 0.01, dRoda: pol(68), pNominal: psi(300), superaquecido: true, evaporacaoMax: 12.0,
    massa: 350, massaAderente: 245, tender: { massa: 198, eixos: 14, comprimento: 21 }, vMax: 110,
    escape: { dBico: 0.18, lDescarga: 1.0, vCaixa: 8, lChamine: 1.8, dChamine: 0.6 },
    apito: { tubos: [294, 349, 392, 440, 523, 587], tipo: 'chime' }, sino: { f: 606, batidasPorS: 2.24 }, bombaAr: BOMBA2, folga: 0.3,
    geometria: { comprimento: 26.5, largura: 3.3, altura: 4.95, xCilindros: 10.5, xChamine: 9.6, xDomo: 3, xCabine: -10, zTopo: 4.8 },
    lwChuff: 130, semente: 0x4014, portadores: ['locomotiva', 'nenhum'],
  },
  {
    id: 'y6b', nome: 'N&W Y6b', familia: 'locomotiva', tag: 'Mallet compound 2-8-8-2 · 1948', rodeiro: '2-8-8-2',
    // AP 2 × 25" (motor traseiro), BP 2 × 39" (dianteiro), curso 32"; receptor 1,2 m³
    cilindros: { n: 2, diametro: pol(39), curso: pol(32) }, motores: 2, derivaFase: 0.008,
    compound: { ap: { n: 2, diametro: pol(25) }, bp: { n: 2, diametro: pol(39) }, receptor: 1.2 },
    dRoda: pol(58), pNominal: psi(300), superaquecido: true, evaporacaoMax: 9.0,
    massa: 275, massaAderente: 275, tender: { massa: 160, eixos: 12, comprimento: 16 }, vMax: 80,
    escape: { dBico: 0.17, lDescarga: 0.9, vCaixa: 7, lChamine: 1.6, dChamine: 0.55 },
    apito: { tubos: [196, 233, 294], tipo: 'chime' }, sino: { f: 640, batidasPorS: 2.0 }, bombaAr: BOMBA2, folga: 0.3,
    geometria: { comprimento: 25, largura: 3.3, altura: 4.9, xCilindros: 10, xChamine: 9, xDomo: 2.5, xCabine: -9.5, zTopo: 4.75 },
    lwChuff: 128, semente: 0x76b, portadores: ['locomotiva', 'nenhum'],
  },
  {
    id: 'shay', nome: 'Shay classe C (Lima)', familia: 'locomotiva', tag: 'engrenada 3 truques · 70 t', rodeiro: 'B-B-B',
    cilindros: { n: 3, diametro: pol(12), curso: pol(15), angulo: [0, 120, 240] }, reducao: 2.6, dRoda: pol(36), pNominal: psi(200), superaquecido: false, evaporacaoMax: 1.6,
    massa: 64, massaAderente: 64, vMax: 25,
    escape: { dBico: 0.1, lDescarga: 0.6, vCaixa: 1.8, lChamine: 1.2, dChamine: 0.35 },
    apito: { tubos: [440], tipo: 'simples' }, bombaAr: BOMBA1, folga: 0.4,
    geometria: { comprimento: 14, largura: 2.9, altura: 4.1, xCilindros: 1.5, yCilindros: 1.3, xChamine: 5.2, xDomo: 2, xCabine: -2.5, zTopo: 3.6 },
    lwChuff: 118, semente: 0x5a7, portadores: ['locomotiva', 'nenhum'], engrenagens: { z: 14 },
  },
  {
    id: 'maria_fumaca', nome: 'Maria Fumaça (Baldwin 2-8-0 métrica)', familia: 'locomotiva', tag: 'Consolidation · bitola métrica', rodeiro: '2-8-0',
    cilindros: { n: 2, diametro: pol(17), curso: pol(22) }, dRoda: pol(44), pNominal: psi(180), superaquecido: false, evaporacaoMax: 1.8,
    massa: 55, massaAderente: 48, tender: { massa: 30, eixos: 4, comprimento: 7 }, vMax: 50,
    escape: { dBico: 0.1, lDescarga: 0.6, vCaixa: 1.6, lChamine: 1.2, dChamine: 0.33 },
    apito: { tubos: [480], tipo: 'simples' }, sino: { f: 700, batidasPorS: 2.0 }, bombaAr: BOMBA1, folga: 0.6,
    geometria: { comprimento: 11, largura: 2.6, altura: 3.7, xCilindros: 4.2, xChamine: 3.8, xDomo: 1.0, xCabine: -3.8, zTopo: 3.4 },
    lwChuff: 118, semente: 0xabf, portadores: ['locomotiva', 'nenhum'], vagao: { massa: 15 },
    nota: 'Ficha por classe: as Consolidation métricas Baldwin dos anos 1910–40 (17" × 22", roda de 44", 180 psi ≈, 55/48/30 t ≈). A VFCJ (Campinas–Jaguariúna) só diz que são "locomotivas a vapor oriundas de várias estradas de ferro brasileiras" e cita a nº 505: conferir no acervo da ABPF antes de nomear uma máquina específica.',
  },
  {
    id: 'pannier', nome: 'GWR 57xx (pannier)', familia: 'locomotiva', tag: '0-6-0PT de manobra', rodeiro: '0-6-0T',
    cilindros: { n: 2, diametro: pol(17.5), curso: pol(24) }, dRoda: pol(55.5), pNominal: psi(200), superaquecido: false, evaporacaoMax: 1.5,
    massa: 50, massaAderente: 50, vMax: 70,
    escape: { dBico: 0.1, lDescarga: 0.6, vCaixa: 1.5, lChamine: 1.2, dChamine: 0.33 },
    apito: { tubos: [660], tipo: 'simples' }, bombaAr: BOMBA1, folga: 0.3,
    // cilindros internos (entre as rodas): `cilindro.*` em y ±0,6
    geometria: { comprimento: 9.6, largura: 2.6, altura: 3.8, xCilindros: 3.2, yCilindros: 0.6, xChamine: 3.3, xDomo: 0.8, xCabine: -2.8, zTopo: 3.7 },
    // (4.6 põe "0-6-0T" em 118 e "57xx" em 124: a 57xx é uma 0-6-0T pequena, fica 118)
    lwChuff: 118, semente: 0x57, portadores: ['locomotiva', 'nenhum'],
  },
  {
    id: 'king', nome: 'GWR King 6024', familia: 'locomotiva', tag: '4-6-0 de 4 cilindros · Lickey', rodeiro: '4-6-0',
    // manivelas internas a 180° das externas: 4 batidas duplas por volta
    cilindros: { n: 4, diametro: pol(16.25), curso: pol(28), angulo: [0, 180, 90, 270] }, dRoda: pol(78), pNominal: psi(250), superaquecido: true, evaporacaoMax: 5.0,
    massa: 91, massaAderente: 69, tender: { massa: 47, eixos: 6, comprimento: 8 }, vMax: 145,
    escape: { dBico: 0.14, lDescarga: 0.7, vCaixa: 4, lChamine: 1.5, dChamine: 0.45 },
    apito: { tubos: [600], tipo: 'simples' }, bombaAr: BOMBA1, folga: 0.3,
    geometria: { comprimento: 13, largura: 2.8, altura: 4.0, xCilindros: 5.0, xChamine: 4.6, xDomo: 1.5, xCabine: -4.6, zTopo: 3.9 },
    lwChuff: 124, semente: 0x6024, portadores: ['locomotiva', 'nenhum'],
  },
  {
    id: 'corliss', nome: 'Corliss de moinho (1 cil., ≈ 1 000 hp)', familia: 'estacionaria', tag: 'horizontal · 75 rpm · condensador',
    cilindros: { n: 1, diametro: pol(30), curso: pol(60) }, dRoda: 0, pNominal: psi(120), superaquecido: false, evaporacaoMax: 1.5,
    massa: 120, massaAderente: 0, vMax: 75, J: 3e4, rpmGovernado: 75, potenciaGerador: 700,
    // (lwChuff: 105 dB(A) à atmosfera; com o condensador, o padrão, a vazão vai para 0,2 bar abs e a boca fica muda: 80)
    escape: { dBico: 0.2, lDescarga: 1.2, vCaixa: 2, lChamine: 2.5, dChamine: 0.4, destino: 'condensador', pCondensador: 0.2e5 },
    apito: { tubos: [250], tipo: 'simples', nivelDb: 135 }, folga: 0.3,
    geometria: { comprimento: 12, largura: 6, altura: 6, xCilindros: 2, yCilindros: 0, xChamine: 0, xDomo: 0, xCabine: -3, zTopo: 5.5 },
    lwChuff: 80, semente: 0xc0, portadores: ['gerador', 'nenhum'], correias: { dVolante: 7, dPolia: 1.5 },
  },
  {
    id: 'aveling', nome: 'Aveling & Porter 8 nhp', familia: 'trator', tag: 'trator de estrada · nº 11630 ≈',
    cilindros: { n: 1, diametro: pol(8), curso: pol(10) }, reducao: 12, reducao2: 6, dRoda: 1.6, pNominal: psi(150), superaquecido: false, evaporacaoMax: 0.3,
    massa: 10, massaAderente: 10, vMax: 8, J: 60, rpmGovernado: 75,
    escape: { dBico: 0.05, lDescarga: 0.4, vCaixa: 0.3, lChamine: 1.4, dChamine: 0.3 },
    apito: { tubos: [700], tipo: 'simples', nivelDb: 135 }, folga: 0.6,
    geometria: { comprimento: 6.5, largura: 2.4, altura: 3.5, xCilindros: 1.4, yCilindros: 0, xChamine: 2.6, xDomo: 0.8, xCabine: -2.4, zTopo: 2.4 },
    lwChuff: 108, semente: 0xa7e, portadores: ['trator', 'gerador', 'nenhum'], engrenagens: { z: 12 }, potenciaGerador: 15,
  },
  {
    id: 'stanley', nome: 'Stanley Steamer 735', familia: 'carro', tag: '20 hp · 1920 · condensador',
    cilindros: { n: 2, diametro: pol(4), curso: pol(5) }, reducao: 1.5, dRoda: 0.91, pNominal: psi(600), superaquecido: true, evaporacaoMax: 0.12,
    massa: 1.2, massaAderente: 0.7, vMax: 100, J: 4,
    escape: { dBico: 0.03, lDescarga: 0.8, vCaixa: 0.02, lChamine: 0.6, dChamine: 0.05, destino: 'condensador', pCondensador: 1.0e5 },
    apito: { tubos: [800], tipo: 'simples', nivelDb: 120 }, folga: 0.3,
    geometria: { comprimento: 4.2, largura: 1.7, altura: 1.8, xCilindros: -1.3, yCilindros: 0.25, xChamine: -1.6, xDomo: 1.4, xCabine: -0.3, zTopo: 0.9 },
    lwChuff: 85, semente: 0x57a, portadores: ['carro', 'nenhum'], queimador: true,
  },
  {
    id: 'vapor_pas', nome: 'Vapor de rodas de pás', familia: 'barco', tag: 'compound diagonal · 13 nós',
    cilindros: { n: 2, diametro: 0.9, curso: 1.2, angulo: [0, 90] },
    compound: { ap: { n: 1, diametro: 0.6 }, bp: { n: 1, diametro: 0.9 }, receptor: 0.8 },
    dRoda: 4.0, pNominal: psi(150), superaquecido: false, evaporacaoMax: 2.0,
    massa: 400, massaAderente: 0, vMax: 25, J: 6e4, pas: { n: 10, D: 4.0 },
    escape: { dBico: 0.2, lDescarga: 1.5, vCaixa: 3, lChamine: 8, dChamine: 1.0, destino: 'condensador', pCondensador: 0.2e5 },
    apito: { tubos: [180], tipo: 'navio', nivelDb: 150 }, folga: 0.3,
    geometria: { comprimento: 50, largura: 9, altura: 6, xCilindros: 0, yCilindros: 1.5, xChamine: 4, xDomo: 2, xCabine: 8, zTopo: 9 },
    lwChuff: 100, semente: 0xba7c0, portadores: ['barco', 'nenhum'],
  },
];

export const FAMILIAS_VAPOR: readonly { id: FamiliaVapor; nome: string }[] = [
  { id: 'locomotiva', nome: 'Locomotivas' }, { id: 'estacionaria', nome: 'Estacionárias' }, { id: 'trator', nome: 'Trator' },
  { id: 'carro', nome: 'Carro' }, { id: 'barco', nome: 'Barco' },
];

export const presetVapor = (id: string) => PRESETS_VAPOR.find((p) => p.id === id);

/** escapes por volta da roda (1.3): extremidades × motores × redução (compound: só as BP escapam pela chaminé) */
export function escapesPorVolta(p: PresetVapor, simplificacao = false) {
  const nEsc = p.compound ? (simplificacao ? p.compound.ap.n + p.compound.bp.n : p.compound.bp.n) * 2 : p.cilindros.n * 2 * (p.motores ?? 1);
  // GWR King: as manivelas internas a 180° das externas somam as batidas duas a duas
  const duplas = p.cilindros.angulo && p.cilindros.n === 4 && p.cilindros.angulo[1] === 180 ? 2 : 1;
  return (nEsc / duplas) * (p.reducao ?? 1);
}

/** eixos do rodeiro (Whyte: '4-6-2' → 2 + 3 + 1; tanque 'T' ignorado; Shay 'B-B-B' → 6 motrizes) */
export function eixosRodeiro(r?: string): { guia: number; motrizes: number; arrasto: number } {
  if (!r) return { guia: 0, motrizes: 2, arrasto: 0 };
  if (/^[A-Z](-[A-Z])+$/.test(r)) return { guia: 0, motrizes: r.split('-').length * 2, arrasto: 0 };
  const n = r.replace(/T$/, '').split('-').map((x) => parseInt(x, 10) / 2);
  if (n.length === 3) return { guia: n[0], motrizes: n[1], arrasto: n[2] };
  if (n.length === 4) return { guia: n[0], motrizes: n[1] + n[2], arrasto: n[3] };
  return { guia: 0, motrizes: 2, arrasto: 0 };
}
