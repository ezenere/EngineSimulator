// Rotativos (docs/ROTATIVO.md 6): 14 Wankel, 2 X-Engine e o motor de palhetas, com as fichas da tabela 6.2 (valores de
// manual onde públicos; "≈" estimados pela classe) e os portadores onde cada um foi usado de verdade (tabela 6.3). O que
// o preset não define vem de PADRAO_ROTATIVO.
//
// Campos novos (6.1): `tipo` ('wankel' | 'x' | 'palhetas'), `rotores` (1–4), `geo` ({ R, e, b } em mm: V_cam = 3√3·e·R·b,
// conferido com `cilindradaCamara`), `Vcam` (X-Engine: cm³ por câmara), `cr`, `janelas` ({ admissao, escape, apv }),
// `velas` (1–3) e `trailingOn`, `rpmMax`, `power` (kW), `torque` (N·m), `J` (kg·m² do motor sozinho), `turbo`
// ({ sequencial, boost, trocaRpm }), `escape` (2.1), `fHCextra`, `vedacoes`, `nivelEscape` (L_W dB re 1 pW: aviação, UAV,
// gerador), `reducao`/`helice`/`rotor` (como no radial), `portadores`, `aproximacao`, `palhetas` (5.3), `gerador`.
// `displacement` é a cilindrada NOMINAL (Mazda: uma câmara por rotor; 13B = 1,308 L): o Ronco a usa para escalar
// dinâmica e atrito; o volume termodinâmico vem de (R, e, b).
import type { PresetRonco } from '../ronco/presets';
import type { HelicePreset } from '../ronco/aviacao';
import type { TipoAdmissao, TipoEscape } from './constantes';
import { GEOMETRIAS } from './constantes';

export type PortadorRotativo = 'carro' | 'helice' | 'rotor' | 'gerador' | 'nenhum' | 'ferramenta';

export type EscapeRotativo = {
  tipo: 'serie' | 'megafone' | '2em1' | 'duplo';
  /** primário por rotor: comprimento (m) e diâmetro (mm) */
  Lp: number; Dp?: number;
  presilencioso: boolean; reator?: boolean; cat?: boolean;
  /** downpipe (m, mm) */
  downpipe?: { L: number; D: number };
  /** megafone (787B): comprimento total e boca (mm) */
  megafone?: { L: number; Dboca: number };
  /** saídas: comprimento até a boca (m), diâmetro (mm), lado (°: 0 = esquerda … 180 = direita, como o pan) */
  saidas: { L: number; D: number; phi: number }[];
  /** ponteira (mm): a peça da ponta onde o gás acelera e chia (o ruído de jato, como a `tipD` do Ronco); sem ela, o Ø da
   *  boca. Separada do Ø da saída (que muda o tubo e a irradiação do tom), a lição do Fusca no REVISAO-DE-SOM.md */
  ponteira?: number;
};

export type PalhetasPreset = {
  /** modo padrão do painel */
  modo: 'ferramenta' | 'arranque';
  ferramenta: { z: number; pIn: number; nLivre: number; J: number; potencia: number };
  arranque: { z: number; pIn: number; nLivre: number; J: number; potencia: number; reducao: number; hospedeiro: { id: string; nome: string; idle: number; eventosPorVolta: number; J: number; Tcomp: number } };
};

export type PresetRotativo = Partial<PresetRonco> & {
  id: string; family: string; name: string; tag: string;
  tipo: 'wankel' | 'x' | 'palhetas';
  rotores: number;
  geo?: { R: number; e: number; b: number };
  Vcam?: number;
  cilindradaCamara: number;
  cr: number;
  janelas: { admissao: TipoAdmissao; escape: TipoEscape | 'sachs'; apv?: number[] };
  velas: number; trailingOn?: boolean;
  idle: number; rpmMax: number; power: number; torque?: number; J: number;
  turbo?: { sequencial: boolean; boost: number; trocaRpm?: number };
  escape: EscapeRotativo;
  fHCextra?: number;
  vedacoes?: 'novas' | 'gastas';
  nivelEscape?: number;
  reducao?: number; helice?: HelicePreset; rotor?: Record<string, any>;
  portadores: PortadorRotativo[];
  aproximacao?: string;
  palhetas?: PalhetasPreset;
  /** portador gerador (X-Engine): polos, frequência da rede (o inversor deixa a rotação livre), kWe, rendimento, J do alternador */
  gerador?: { polos: number; fRede: number; kWe: number; eta: number; J: number };
  aeronave?: { massa: number; comprimento: number; envergadura: number };
  /** dispersão por flanco (× a do Ronco) e por rotor (× ±4% energia, ±6% janela); 1 e 1,5 por padrão */
  dispersao?: number; dispersaoRotor?: number;
  /** carro de corrida / passagem: velocidade na passagem da Cena (km/h) */
  vPassagem?: number;
};

export type FamiliaRotativo = { id: string; name: string };
export const FAMILIAS_ROTATIVO: FamiliaRotativo[] = [
  { id: 'mazda', name: 'Mazda de rua' },
  { id: 'multi', name: 'Mazda 3 e 4 rotores' },
  { id: 'europeus', name: 'Europeus' },
  { id: 'aviacao', name: 'Aviação e UAV' },
  { id: 'x', name: 'X-Engine (aproximação)' },
  { id: 'palhetas', name: 'Palhetas (aproximação)' },
];

/** o que um preset rotativo não define (campos do Ronco sem efeito no rotativo ficam neutros: 6.1) */
export const PADRAO_ROTATIVO: Partial<PresetRotativo> = {
  layout: 'rotativo', crank: 'excentrico', order: '', cam: 0.2, header: 'equal', routing: 'single', pipeLen: 3, pipeD: 2.5,
  intake: 'airbox', aspiration: 'na', boost: 0, cooling: 'water', engine: 'front', fuel: 'efi', valve: 'none', reso: false,
  twoStep: 'off', breakout: 'sealed', overrun: 'cut', cat: true, limiter: 'fuel', limiterBand: 70, limiterHold: 0.07,
  gears: 5, transmission: 'manual', velas: 2, trailingOn: true, vedacoes: 'novas', fHCextra: 0, muffler: 'stock',
};

const G = GEOMETRIAS;
const carro: PortadorRotativo[] = ['carro', 'nenhum'];
const aviao: PortadorRotativo[] = ['helice', 'nenhum'];
const pol = (mm: number) => mm / 25.4;

export const PRESETS_ROTATIVO: PresetRotativo[] & { families: FamiliaRotativo[] } = Object.assign([
  // ---- Mazda de rua (1–5)
  { id: 'rx7fd', family: 'mazda', name: 'Mazda RX-7 FD 13B-REW', tag: '1992–2002 · 2 rotores · biturbo sequencial · 280 ps',
    tipo: 'wankel', rotores: 2, geo: G['13B'], cilindradaCamara: 654, displacement: 1.308, cr: 9.0,
    janelas: { admissao: 'lateral4', escape: 'periferico', apv: [3750] }, velas: 2, idle: 750, rpmMax: 8000, power: 206, torque: 314, J: 0.25,
    aspiration: 'turbo', boost: 0.7, turbo: { sequencial: true, boost: 0.7, trocaRpm: 4500 },
    escape: { tipo: 'serie', Lp: 0.3, Dp: 55, presilencioso: true, cat: true, downpipe: { L: 1.0, D: 76 }, saidas: [{ L: 3.4, D: 76, phi: 30 }] },
    muffler: 'sport', pipeD: pol(76), gears: 5, ratios: [3.483, 2.015, 1.391, 1.0, 0.761], finalDrive: 4.1, mass: 1300, wheelR: 0.316, drag: 0.37,
    overrun: 'burble', cat: true, limiter: 'fuel', limiterBand: 70, limiterHold: 0.07, portadores: carro },
  { id: 'rx7fc', family: 'mazda', name: 'Mazda RX-7 FC 13B-T', tag: 'S5 1989–91 · 2 rotores · turbo HT-18 · 200 hp',
    tipo: 'wankel', rotores: 2, geo: G['13B'], cilindradaCamara: 654, displacement: 1.308, cr: 9.0,
    janelas: { admissao: 'lateral4', escape: 'periferico', apv: [3750] }, velas: 2, idle: 750, rpmMax: 7000, power: 147, torque: 265, J: 0.25,
    aspiration: 'turbo', boost: 0.5, turbo: { sequencial: false, boost: 0.5 },
    escape: { tipo: 'serie', Lp: 0.3, Dp: 52, presilencioso: true, cat: true, downpipe: { L: 1.0, D: 70 }, saidas: [{ L: 3.2, D: 70, phi: 30 }] },
    muffler: 'stock', pipeD: pol(70), gears: 5, ratios: [3.483, 2.015, 1.391, 1.0, 0.762], finalDrive: 4.1, mass: 1280, wheelR: 0.31,
    overrun: 'cut', cat: true, limiter: 'fuel', portadores: carro },
  { id: 'rx3', family: 'mazda', name: 'Mazda RX-3 12A', tag: 'Savanna 1972–78 · 2 rotores · carburador 4 corpos · reator térmico',
    tipo: 'wankel', rotores: 2, geo: G['12A'], cilindradaCamara: 573, displacement: 1.146, cr: 9.4,
    janelas: { admissao: 'lateral4', escape: 'periferico' }, velas: 2, idle: 850, rpmMax: 7000, power: 81, torque: 150, J: 0.22, fuel: 'carb',
    escape: { tipo: 'serie', Lp: 0.3, Dp: 45, presilencioso: false, reator: true, cat: false, downpipe: { L: 1.2, D: 50 }, saidas: [{ L: 3.6, D: 50, phi: 30 }] },
    muffler: 'classic', pipeD: pol(50), gears: 4, ratios: [3.683, 2.263, 1.397, 1.0], finalDrive: 3.9, mass: 900, wheelR: 0.3,
    overrun: 'lean', cat: false, limiter: 'fuel', limiterBand: 120, portadores: carro, aproximacao: 'corte de giro (o carro só tinha a cigarra de aviso)' },
  { id: 'rx8hp', family: 'mazda', name: 'Mazda RX-8 Renesis 6 janelas', tag: '2003–12 · 13B-MSP Hi-Power · 231 hp a 8 200 rpm',
    tipo: 'wankel', rotores: 2, geo: G['13B'], cilindradaCamara: 654, displacement: 1.308, cr: 10.0,
    janelas: { admissao: 'lateral6', escape: 'lateral', apv: [3750, 6250] }, velas: 2, idle: 750, rpmMax: 9000, power: 170, torque: 211, J: 0.22,
    escape: { tipo: 'serie', Lp: 0.35, Dp: 50, presilencioso: true, cat: true, downpipe: { L: 1.0, D: 60 }, saidas: [{ L: 4.2, D: 60, phi: 20 }, { L: 4.25, D: 60, phi: 160 }] },
    muffler: 'stock', pipeD: pol(60), gears: 6, ratios: [3.76, 2.269, 1.645, 1.187, 1.0, 0.843], finalDrive: 4.444, mass: 1390, wheelR: 0.33,
    overrun: 'burble', cat: true, limiter: 'fuel', limiterBand: 60, limiterHold: 0.05, portadores: carro },
  { id: 'rx8std', family: 'mazda', name: 'Mazda RX-8 Renesis 4 janelas', tag: '2003–08 · 13B-MSP Standard · 189 hp',
    tipo: 'wankel', rotores: 2, geo: G['13B'], cilindradaCamara: 654, displacement: 1.308, cr: 10.0,
    janelas: { admissao: 'lateral4', escape: 'lateral', apv: [3750] }, velas: 2, idle: 750, rpmMax: 7500, power: 141, torque: 222, J: 0.22,
    escape: { tipo: 'serie', Lp: 0.35, Dp: 50, presilencioso: true, cat: true, downpipe: { L: 1.0, D: 60 }, saidas: [{ L: 4.2, D: 60, phi: 20 }, { L: 4.25, D: 60, phi: 160 }] },
    muffler: 'stock', pipeD: pol(60), gears: 5, ratios: [3.815, 2.26, 1.64, 1.177, 0.832], finalDrive: 4.444, mass: 1340, wheelR: 0.327,
    overrun: 'burble', cat: true, limiter: 'fuel', limiterBand: 60, limiterHold: 0.05, portadores: carro },
  // ---- Mazda 3 e 4 rotores (6–7)
  { id: 'cosmo20b', family: 'multi', name: 'Eunos Cosmo 20B-REW', tag: '1990–96 · 3 rotores · biturbo sequencial · automático',
    tipo: 'wankel', rotores: 3, geo: G['13B'], cilindradaCamara: 654, displacement: 1.962, cr: 9.0,
    janelas: { admissao: 'lateral4', escape: 'periferico', apv: [3750] }, velas: 2, idle: 700, rpmMax: 7000, power: 206, torque: 403, J: 0.38,
    aspiration: 'turbo', boost: 0.6, turbo: { sequencial: true, boost: 0.6, trocaRpm: 4200 },
    escape: { tipo: 'serie', Lp: 0.3, Dp: 55, presilencioso: true, cat: true, downpipe: { L: 1.0, D: 70 }, saidas: [{ L: 3.8, D: 70, phi: 20 }, { L: 3.85, D: 70, phi: 160 }] },
    muffler: 'stock', pipeD: pol(70), gears: 4, transmission: 'auto', shiftTime: 0.5, ratios: [2.784, 1.545, 1.0, 0.694], finalDrive: 3.909, mass: 1640, wheelR: 0.32,
    overrun: 'cut', cat: true, limiter: 'throttle', portadores: carro },
  { id: 'r26b', family: 'multi', name: 'Mazda 787B R26B', tag: 'Le Mans 1991 · 4 rotores · admissão periférica · megafone · 700 hp',
    tipo: 'wankel', rotores: 4, geo: G['13B'], cilindradaCamara: 654, displacement: 2.616, cr: 10.0,
    janelas: { admissao: 'periferica', escape: 'periferico' }, velas: 3, idle: 1900, rpmMax: 9000, power: 522, torque: 608, J: 0.3,
    escape: { tipo: 'megafone', Lp: 0.9, Dp: 60, presilencioso: false, cat: false, megafone: { L: 0.5, Dboca: 120 }, saidas: [{ L: 0.5, D: 120, phi: 5 }] },
    muffler: 'straight', pipeD: pol(60), intake: 'sport', engine: 'mid', gears: 5, ratios: [2.8, 1.96, 1.53, 1.24, 1.04], finalDrive: 3.0, mass: 900, wheelR: 0.33, drag: 0.3,
    overrun: 'burble', cat: false, limiter: 'fuel', limiterBand: 60, limiterHold: 0.05, portadores: carro, vPassagem: 340, dispersao: 1, dispersaoRotor: 3 },
  // ---- Europeus (8–10)
  { id: 'ro80', family: 'europeus', name: 'NSU Ro80 KKM 612', tag: '1967–77 · 2 rotores · uma vela · semiautomático',
    tipo: 'wankel', rotores: 2, geo: G.KKM612, cilindradaCamara: 497.5, displacement: 0.995, cr: 9.0,
    janelas: { admissao: 'lateral4', escape: 'periferico' }, velas: 1, idle: 900, rpmMax: 6500, power: 85, torque: 162, J: 0.2, fuel: 'carb',
    escape: { tipo: 'duplo', Lp: 0.3, Dp: 45, presilencioso: false, cat: false, downpipe: { L: 1.5, D: 50 }, saidas: [{ L: 1.5, D: 50, phi: 30 }] },
    muffler: 'stock', pipeD: pol(50), gears: 3, transmission: 'auto', shiftTime: 0.6, ratios: [2.13, 1.21, 0.81], finalDrive: 4.86, mass: 1280, wheelR: 0.31,
    overrun: 'lean', cat: false, limiter: 'fuel', limiterBand: 120, portadores: carro, aproximacao: 'corte de giro (carburado, sem central)' },
  { id: 'norton', family: 'europeus', name: 'Norton F1 / Commander', tag: 'moto 1988–92 · 2 rotores refrigerados pela carga · 95 hp',
    tipo: 'wankel', rotores: 2, geo: G.sachs294, cilindradaCamara: 294, displacement: 0.588, cr: 9.0,
    janelas: { admissao: 'sachs', escape: 'sachs' }, velas: 1, idle: 1200, rpmMax: 10000, power: 70, torque: 76, J: 0.04, fuel: 'carb',
    escape: { tipo: '2em1', Lp: 0.5, Dp: 42, presilencioso: false, cat: false, saidas: [{ L: 0.6, D: 50, phi: 120 }] },
    muffler: 'sport', pipeD: pol(50), engine: 'mid', gears: 5, ratios: [2.846, 1.947, 1.545, 1.333, 1.153], finalDrive: 5.0, mass: 272, wheelR: 0.32, drag: 0.3,
    overrun: 'lean', cat: false, limiter: 'fuel', limiterBand: 60, limiterHold: 0.05, portadores: carro },
  { id: 'cosmo110s', family: 'europeus', name: 'Mazda Cosmo 110S 10A', tag: '1967–72 · o primeiro Mazda rotativo · 110 PS',
    tipo: 'wankel', rotores: 2, geo: G['10A'], cilindradaCamara: 491, displacement: 0.982, cr: 9.4,
    janelas: { admissao: 'lateral4', escape: 'periferico' }, velas: 2, idle: 900, rpmMax: 7000, power: 81, torque: 130, J: 0.18, fuel: 'carb',
    escape: { tipo: 'duplo', Lp: 0.3, Dp: 40, presilencioso: false, cat: false, downpipe: { L: 1.4, D: 45 }, saidas: [{ L: 3.6, D: 45, phi: 20 }, { L: 3.65, D: 45, phi: 160 }] },
    muffler: 'classic', pipeD: pol(45), gears: 4, ratios: [3.683, 2.263, 1.397, 1.0], finalDrive: 4.111, mass: 940, wheelR: 0.3,
    overrun: 'lean', cat: false, limiter: 'fuel', limiterBand: 120, portadores: carro, aproximacao: 'corte de giro (carburado, sem central)' },
  // ---- Aviação e UAV (11–14)
  { id: 'mistral', family: 'aviacao', name: 'Mistral G-200', tag: 'aviação leve (Suíça) · 2 rotores 13B · redutor 2,56:1 · 200 hp',
    tipo: 'wankel', rotores: 2, geo: G['13B'], cilindradaCamara: 654, displacement: 1.308, cr: 9.0,
    janelas: { admissao: 'lateral4', escape: 'periferico' }, velas: 2, idle: 1200, rpmMax: 7500, power: 149, J: 0.25,
    escape: { tipo: '2em1', Lp: 0.5, Dp: 50, presilencioso: false, cat: false, saidas: [{ L: 1.0, D: 50, phi: 120 }] },
    muffler: 'stock', pipeD: pol(50), gears: 0, overrun: 'lean', cat: false, limiter: 'fuel', limiterBand: 100,
    aviation: true, reducao: 1 / 2.56, helice: { B: 3, D: 1.9, J: 1.8 }, nivelEscape: 136, portadores: aviao,
    aeronave: { massa: 1100, comprimento: 7.5, envergadura: 10 }, aproximacao: 'programa encerrado: redutor e hélice estimados' },
  { id: 'ae110', family: 'aviacao', name: 'MidWest AE110', tag: 'aviação leve (Reino Unido) · 2 rotores Norton · 110 hp',
    tipo: 'wankel', rotores: 2, geo: G.sachs294, cilindradaCamara: 294, displacement: 0.588, cr: 9.0,
    janelas: { admissao: 'sachs', escape: 'sachs' }, velas: 1, idle: 1400, rpmMax: 7800, power: 82, J: 0.05,
    escape: { tipo: '2em1', Lp: 0.45, Dp: 40, presilencioso: false, cat: false, saidas: [{ L: 0.6, D: 45, phi: 120 }] },
    muffler: 'stock', pipeD: pol(45), gears: 0, overrun: 'lean', cat: false, limiter: 'fuel', limiterBand: 100,
    aviation: true, reducao: 1 / 2.95, helice: { B: 2, D: 1.7, J: 1.0 }, nivelEscape: 133, portadores: aviao,
    aeronave: { massa: 600, comprimento: 6.5, envergadura: 9 } },
  { id: 'ae50r', family: 'aviacao', name: 'Austro Engine AE50R', tag: 'Schiebel Camcopter S-100 · monorrotor · 55 hp',
    tipo: 'wankel', rotores: 1, geo: G.sachs294, cilindradaCamara: 294, displacement: 0.294, cr: 9.0,
    janelas: { admissao: 'sachs', escape: 'sachs' }, velas: 1, idle: 2000, rpmMax: 7750, power: 41, J: 0.03,
    escape: { tipo: '2em1', Lp: 0.4, Dp: 38, presilencioso: false, cat: false, saidas: [{ L: 0.5, D: 40, phi: 90 }] },
    muffler: 'stock', pipeD: pol(40), gears: 0, overrun: 'cut', cat: false, limiter: 'fuel', limiterBand: 100,
    aviation: true, nivelEscape: 128, portadores: ['rotor', 'nenhum'],
    rotor: { B: 3, R: 1.7, Nr: 1070, sigma: 0.06, cd0: 0.0105, J_rot: 15, Bc: 2, Rc: 0.3, ic: 4.6, icx: 6.66, massa: 200,
      engrenagens: [{ z: 23, rpm: 7130 / 2.95 }, { z: 11, rpm: 1070 * 4 }], posRotor: [0, 0, 1.1], posCauda: [-1.9, 0, 0.9], posCaixa: [0, 0, 0.8], posMotor: [-0.3, 0, 0.6],
      corpo: { comprimento: 3.11, largura: 0.62, altura: 1.12 } } },
  { id: 'ar741', family: 'aviacao', name: 'UEL AR741', tag: 'AAI RQ-7 Shadow 200 · monorrotor · hélice impulsora direta · 38 hp',
    tipo: 'wankel', rotores: 1, geo: G.ar741, cilindradaCamara: 208, displacement: 0.208, cr: 9.0,
    janelas: { admissao: 'sachs', escape: 'sachs' }, velas: 1, idle: 2500, rpmMax: 7800, power: 28, J: 0.02, fuel: 'carb',
    escape: { tipo: '2em1', Lp: 0.4, Dp: 35, presilencioso: false, cat: false, saidas: [{ L: 0.15, D: 35, phi: 90 }] },
    muffler: 'straight', pipeD: pol(35), gears: 0, overrun: 'lean', cat: false, limiter: 'fuel', limiterBand: 100,
    aviation: true, reducao: 1, helice: { B: 2, D: 0.74, J: 0.05, passoFixo: true }, nivelEscape: 128, portadores: aviao,
    aeronave: { massa: 170, comprimento: 3.4, envergadura: 4.3 } },
  // ---- X-Engine (15–16), aproximação
  { id: 'xmini', family: 'x', name: 'LiquidPiston X Mini', tag: 'protótipo · rotor de 2 lobos em alojamento de 3 · 70 cm³ · 3 kW',
    tipo: 'x', rotores: 1, Vcam: 23.3, cilindradaCamara: 23.3, displacement: 0.07, cr: 9.0,
    janelas: { admissao: 'x', escape: 'x' }, velas: 1, idle: 3000, rpmMax: 15000, power: 3, J: 0.002, fuel: 'carb',
    escape: { tipo: '2em1', Lp: 0.15, Dp: 20, presilencioso: false, cat: false, saidas: [{ L: 0.15, D: 20, phi: 90 }] },
    muffler: 'stock', pipeD: pol(20), gears: 0, overrun: 'cut', cat: false, limiter: 'fuel', limiterBand: 150,
    nivelEscape: 108, portadores: ['nenhum', 'gerador'], gerador: { polos: 2, fRede: 200, kWe: 1.5, eta: 0.85, J: 0.002 },
    aproximacao: 'X-Engine: sem gravação; geometria e janelas da documentação pública' },
  { id: 'xts210', family: 'x', name: 'LiquidPiston XTS-210', tag: 'grupo gerador / protótipos militares · HEHC · 210 cm³ · 25 hp',
    tipo: 'x', rotores: 1, Vcam: 70, cilindradaCamara: 70, displacement: 0.21, cr: 18,
    janelas: { admissao: 'x', escape: 'x' }, velas: 1, idle: 2500, rpmMax: 7500, power: 19, J: 0.01,
    escape: { tipo: '2em1', Lp: 0.5, Dp: 35, presilencioso: false, cat: false, saidas: [{ L: 0.4, D: 35, phi: 90 }] },
    muffler: 'stock', pipeD: pol(35), gears: 0, overrun: 'cut', cat: false, limiter: 'fuel', limiterBand: 150,
    nivelEscape: 118, portadores: ['gerador', 'nenhum'], gerador: { polos: 2, fRede: 100, kWe: 15, eta: 0.9, J: 0.08 },
    aproximacao: 'X-Engine diesel (HEHC) feito a centelha com CR 18: aproximação do ciclo SI' },
  // ---- Palhetas (17), aproximação
  { id: 'palhetas', family: 'palhetas', name: 'Motor pneumático de palhetas', tag: 'retífica / parafusadeira · motor de arranque a ar',
    tipo: 'palhetas', rotores: 1, cilindradaCamara: 0, displacement: 0.01, cr: 1, janelas: { admissao: 'lateral4', escape: 'periferico' },
    velas: 0, idle: 0, rpmMax: 20000, power: 0.7, J: 1e-5, gears: 0,
    escape: { tipo: '2em1', Lp: 0.05, presilencioso: false, saidas: [{ L: 0.05, D: 10, phi: 90 }] },
    portadores: ['nenhum', 'ferramenta'],
    palhetas: {
      modo: 'ferramenta',
      ferramenta: { z: 8, pIn: 6.3, nLivre: 20000, J: 1e-5, potencia: 0.7 },
      arranque: { z: 7, pIn: 8, nLivre: 4000, J: 5e-4, potencia: 8, reducao: 10,
        hospedeiro: { id: 'catc15', nome: 'Cat C15 (diesel 6 cil.)', idle: 600, eventosPorVolta: 3, J: 6, Tcomp: 250 } },
    },
    aproximacao: 'palhetas: sintetizador próprio, sem gravação de referência no acervo; hospedeiro do arranque simplificado' },
] as PresetRotativo[], { families: FAMILIAS_ROTATIVO });

export default PRESETS_ROTATIVO;
