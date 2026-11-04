// Motores radiais (docs/RADIAL.md 5): um preset por motor, com a ficha (valores de manual onde públicos; "≈" estimados
// pela classe) e o portador onde ele foi usado de verdade (tabela 5.3). O que o preset não define vem de PADRAO_RADIAL.
//
// Campos (RADIAL.md 5.1): `rows`/`cylPerRow` (fileiras), `crank` ('mestra'; 'mestra4' no R-4360), `Lr` e `rkr` (biela-
// mestra: L/r e r_k/r), `order` (texto; ausente no R-4360 e no Trossi: ordem decorrente), `J` (kg·m² do motor sozinho),
// `rpmMax`, `power` (kW), `reducao` (rpm da hélice / rpm do motor), `helice` (B, D, J, passo fixo, nMin, nMax),
// `partida` ('inercia' | 'direta' | 'ar' | 'manivela'), `magnetosPadrao`, `misturaPadrao`, `superalimentador`
// (relação, pás, pressão, uivo, duas velocidades), `carburador` ('pressao' ×1 | 'boia' ×2,6 na dispersão), `escape`
// (2.1), `nivelEscape` (L_W dB re 1 pW em plena carga, 3.7), `portadores`, `aeronave`/`veiculo`, `tempos`, `rotativo`.
import type { PresetRonco } from '../ronco/presets';
import type { EscapeRadial } from './geometria';
import type { HelicePreset } from '../ronco/aviacao';

export type PortadorRadial = 'helice' | 'rotor' | 'carro' | 'nenhum';

export type PresetRadial = Partial<PresetRonco> & {
  id: string; family: string; name: string; tag: string;
  layout: 'radial'; cylinders: number; rows: number; cylPerRow: number; crank: string; Lr?: number; rkr?: number; order?: string;
  displacement: number; cr: number; idle: number; rpmMax: number; power: number; J: number; cam?: number;
  reducao?: number; helice?: HelicePreset;
  partida: 'inercia' | 'direta' | 'ar' | 'manivela';
  magnetosPadrao?: 'ambos' | 'esq' | 'dir' | 'desligado'; misturaPadrao?: number;
  superalimentador?: { relacao: number; pas: number; boost: number; uivoDb?: number; duasVelocidades?: { relacao: number; boost: number } };
  carburador: 'pressao' | 'boia';
  escape: EscapeRadial;
  nivelEscape: number;
  portadores: PortadorRadial[];
  aeronave?: { massa: number; comprimento: number; envergadura: number; motores?: number };
  veiculo?: { massa: number; comprimento: number; largura: number; altura: number };
  rotor?: Record<string, any>;
  tempos?: 2 | 4;
  rotativo?: { i: number };
  /** texto do painel: o que é aproximação */
  aproximacao?: string;
  /** volante (kg·m²) somado ao J do motor (Sherman) */
  volante?: number;
};

export type FamiliaRadial = { id: string; name: string };
export const FAMILIAS_RADIAL: FamiliaRadial[] = [
  { id: 'classicos', name: 'Clássicos americanos' },
  { id: 'sovieticos', name: 'Soviéticos' },
  { id: 'pequenos', name: 'Pequenos modernos' },
  { id: 'terra', name: 'Terra' },
  { id: 'helicoptero', name: 'Helicóptero' },
];

/** o que um preset radial não define (campos do Ronco sem efeito no radial ficam neutros: RADIAL.md 5.1) */
export const PADRAO_RADIAL: Partial<PresetRadial> = {
  cam: 0.15, Lr: 3.8, rkr: 1.0, magnetosPadrao: 'ambos', misturaPadrao: 0.8, cooling: 'air', intake: 'airbox', overrun: 'lean', cat: false,
  limiter: 'none', twoStep: 'off', valve: 'none', reso: false, breakout: 'old', gears: 0, transmission: 'manual', engine: 'front',
  header: 'short', routing: 'single', muffler: 'straight', pipeLen: 0.8, pipeD: 2.5,
};

// bases por arquitetura (o preset só sobrescreve o que muda)
const R3 = { layout: 'radial' as const, cylinders: 3, rows: 1, cylPerRow: 3, crank: 'mestra', order: '1-3-2' };
const R5 = { layout: 'radial' as const, cylinders: 5, rows: 1, cylPerRow: 5, crank: 'mestra', order: '1-3-5-2-4' };
const R7 = { layout: 'radial' as const, cylinders: 7, rows: 1, cylPerRow: 7, crank: 'mestra', order: '1-3-5-7-2-4-6' };
const R9 = { layout: 'radial' as const, cylinders: 9, rows: 1, cylPerRow: 9, crank: 'mestra', order: '1-3-5-7-9-2-4-6-8' };
const R14 = { layout: 'radial' as const, cylinders: 14, rows: 2, cylPerRow: 7, crank: 'mestra', order: '1-10-5-14-9-4-13-8-3-12-7-2-11-6' };
const R16 = { layout: 'radial' as const, cylinders: 16, rows: 2, cylPerRow: 8, crank: 'mestra' };
const R18 = { layout: 'radial' as const, cylinders: 18, rows: 2, cylPerRow: 9, crank: 'mestra', order: '1-12-5-16-9-2-13-6-17-10-3-14-7-18-11-4-15-8' };
const R28 = { layout: 'radial' as const, cylinders: 28, rows: 4, cylPerRow: 7, crank: 'mestra4' };
const aviao = { portadores: ['helice', 'nenhum'] as PortadorRadial[] };

export const PRESETS_RADIAL: PresetRadial[] & { families: FamiliaRadial[] } = Object.assign([
  // ---- Clássicos americanos
  { ...R9, id: 'r1820', family: 'classicos', name: 'Wright R-1820 Cyclone', tag: 'T-28B Trojan · 9 cil. · 29,9 L · 1 425 hp',
    displacement: 29.9, cr: 6.7, idle: 600, rpmMax: 2700, power: 1063, J: 2.2, reducao: 0.5625, helice: { B: 3, D: 3.05, J: 45, nMax: 1520 },
    carburador: 'pressao', superalimentador: { relacao: 7.2, pas: 12, boost: 0.35 }, partida: 'direta',
    escape: { tipo: 'anel', Danel: 1.25, Oanel: 95, Lp: 0.2, saidas: [{ L: 0.6, O: 90, phi: 135 }, { L: 0.6, O: 90, phi: 225 }] }, breakout: 'old',
    nivelEscape: 145, ...aviao, aeronave: { massa: 3850, comprimento: 10.2, envergadura: 12.2 } },
  { ...R14, id: 'r1830', family: 'classicos', name: 'P&W R-1830 Twin Wasp', tag: 'DC-3 / C-47 · 14 cil. em 2 fileiras · 30 L · 1 200 hp',
    displacement: 30.0, cr: 6.7, idle: 600, rpmMax: 2700, power: 895, J: 2.3, reducao: 0.5625, helice: { B: 3, D: 3.5, J: 55, nMax: 1520 },
    carburador: 'pressao', superalimentador: { relacao: 7.15, pas: 12, boost: 0.3 }, partida: 'inercia',
    escape: { tipo: 'anel', Danel: 1.15, Oanel: 90, Lp: 0.18, saidas: [{ L: 1.2, O: 100, phi: 180 }] }, breakout: 'old',
    nivelEscape: 145, ...aviao, aeronave: { massa: 11800, comprimento: 19.4, envergadura: 29, motores: 2 } },
  { ...R18, id: 'r2800', family: 'classicos', name: 'P&W R-2800-18W Double Wasp', tag: 'F4U-4 Corsair · 18 cil. · 45,9 L · 2 100 hp',
    displacement: 45.9, cr: 6.75, idle: 650, rpmMax: 2800, power: 1566, J: 3.2, reducao: 0.4375, helice: { B: 4, D: 4.01, J: 120, nMax: 1225 },
    carburador: 'pressao', superalimentador: { relacao: 7.6, pas: 16, boost: 0.5, duasVelocidades: { relacao: 9.5, boost: 0.7 } }, partida: 'inercia',
    escape: { tipo: 'tubos', Lt: [0.55, 0.8], Ot: 70, agrupar: 3, porFileira: true }, breakout: 'old',
    nivelEscape: 148, ...aviao, aeronave: { massa: 5600, comprimento: 10.3, envergadura: 12.5 } },
  { ...R18, id: 'r2800turbo', family: 'classicos', name: 'P&W R-2800-59 (turbo)', tag: 'P-47D Thunderbolt · 18 cil. · coletor único e turbina',
    displacement: 45.9, cr: 6.65, idle: 650, rpmMax: 2700, power: 1490, J: 3.2, reducao: 0.5, helice: { B: 4, D: 3.96, J: 110, nMax: 1350 },
    carburador: 'pressao', superalimentador: { relacao: 7.6, pas: 16, boost: 0.5 }, partida: 'direta',
    escape: { tipo: 'anel', Danel: 1.3, Oanel: 100, Lp: 0.2, saidas: [{ L: 0.3, O: 100, phi: 180 }], turbina: { Lantes: 3.8, Oantes: 90, Ldepois: 1.0, Odepois: 110 } }, breakout: 'sealed',
    nivelEscape: 148, ...aviao, aeronave: { massa: 6600, comprimento: 11, envergadura: 12.4 } },
  { ...R28, id: 'r4360', family: 'classicos', name: 'P&W R-4360 Wasp Major', tag: 'B-50 / C-124 · 28 cil. em 4 fileiras · 71,5 L · 3 500 hp',
    displacement: 71.5, cr: 6.7, idle: 700, rpmMax: 2700, power: 2610, J: 5.5, reducao: 0.375, helice: { B: 4, D: 5.08, J: 300, nMax: 1012 },
    carburador: 'pressao', superalimentador: { relacao: 6.37, pas: 18, boost: 0.6 }, partida: 'direta',
    escape: { tipo: 'anel', Danel: 1.35, Oanel: 100, Lp: 0.2, juntar: [[0, 1], [2, 3]], saidas: [{ L: 1.5, O: 110, phi: 90 }, { L: 1.5, O: 110, phi: 270 }] }, breakout: 'sealed',
    nivelEscape: 151, ...aviao, aeronave: { massa: 80000, comprimento: 40, envergadura: 53, motores: 4 } },
  { ...R9, id: 'r1340', family: 'classicos', name: 'P&W R-1340 Wasp', tag: 'T-6 Texan · 9 cil. · 22 L · 600 hp · direto',
    displacement: 22.0, cr: 6.0, idle: 600, rpmMax: 2250, power: 447, J: 1.6, reducao: 1, helice: { B: 2, D: 2.74, J: 16, nMin: 1800, nMax: 2250 },
    carburador: 'boia', superalimentador: { relacao: 10, pas: 12, boost: 0.2 }, partida: 'direta',
    escape: { tipo: 'anel', Danel: 1.1, Oanel: 76, Lp: 0.18, saidas: [{ L: 1.0, O: 76, phi: 90 }] }, breakout: 'leaky',
    nivelEscape: 142, ...aviao, aeronave: { massa: 2550, comprimento: 8.8, envergadura: 12.8 } },
  { ...R9, id: 'r985', family: 'classicos', name: 'P&W R-985 Wasp Junior', tag: 'Ford Trimotor · 9 cil. · 16,1 L · 450 hp · passo fixo',
    displacement: 16.1, cr: 6.0, idle: 600, rpmMax: 2300, power: 336, J: 1.1, reducao: 1, helice: { B: 2, D: 2.6, J: 12, passoFixo: true, nMax: 2300 },
    carburador: 'boia', superalimentador: { relacao: 10, pas: 12, boost: 0.2 }, partida: 'inercia',
    escape: { tipo: 'anel', Danel: 1.0, Oanel: 70, Lp: 0.15, saidas: [{ L: 0.8, O: 70, phi: 180 }] }, breakout: 'old',
    nivelEscape: 142, ...aviao, aeronave: { massa: 6100, comprimento: 15.3, envergadura: 23.7, motores: 3 } },
  // ---- Soviéticos
  { ...R9, id: 'm14p', family: 'sovieticos', name: 'Vedeneyev M-14P', tag: 'Yak-52 · 9 cil. · 10,2 L · 360 hp · partida a ar',
    displacement: 10.16, cr: 6.3, idle: 760, rpmMax: 2900, power: 265, J: 0.7, reducao: 0.658, helice: { B: 2, D: 2.4, J: 7, nMax: 1908 },
    carburador: 'boia', superalimentador: { relacao: 8.26, pas: 14, boost: 0.25 }, partida: 'ar',
    escape: { tipo: 'anel', Danel: 0.9, Oanel: 60, Lp: 0.15, saidas: [{ L: 0.4, O: 60, phi: 120 }, { L: 0.4, O: 60, phi: 240 }] }, breakout: 'old',
    nivelEscape: 140, ...aviao, aeronave: { massa: 1300, comprimento: 7.7, envergadura: 9.3 } },
  { ...R9, id: 'm14pf', family: 'sovieticos', name: 'Vedeneyev M-14PF', tag: 'Su-31 / Yak-55M · 400 hp · estaques acrobáticos',
    displacement: 10.16, cr: 6.3, idle: 700, rpmMax: 2950, power: 294, J: 0.7, reducao: 0.658, helice: { B: 3, D: 2.5, J: 5, nMax: 1940 },
    carburador: 'boia', superalimentador: { relacao: 8.26, pas: 14, boost: 0.3 }, partida: 'ar',
    escape: { tipo: 'tubos', Lt: 0.35, Ot: 45 }, breakout: 'old',
    nivelEscape: 140, ...aviao, aeronave: { massa: 780, comprimento: 6.8, envergadura: 7.8 } },
  // ---- Pequenos modernos
  { ...R7, id: 'rotec2800', family: 'pequenos', name: 'Rotec R2800', tag: 'Kitfox, Pietenpol · 7 cil. · 2,8 L · 110 hp',
    displacement: 2.8, cr: 8.5, idle: 1000, rpmMax: 3600, power: 82, J: 0.15, reducao: 1, helice: { B: 2, D: 1.75, J: 1.5, passoFixo: true, nMax: 3600 },
    carburador: 'boia', partida: 'direta', escape: { tipo: 'tubos', Lt: 0.6, Ot: 38 }, breakout: 'leaky',
    nivelEscape: 130, ...aviao, aeronave: { massa: 550, comprimento: 5.8, envergadura: 9.8 } },
  { ...R9, id: 'rotec3600', family: 'pequenos', name: 'Rotec R3600', tag: 'Pietenpol, réplicas · 9 cil. · 3,6 L · 150 hp',
    displacement: 3.6, cr: 8.5, idle: 950, rpmMax: 3600, power: 112, J: 0.2, reducao: 1, helice: { B: 3, D: 1.8, J: 1.8, passoFixo: true, nMax: 3600 },
    carburador: 'boia', partida: 'direta', escape: { tipo: 'tubos', Lt: 0.6, Ot: 38 }, breakout: 'leaky',
    nivelEscape: 130, ...aviao, aeronave: { massa: 700, comprimento: 6, envergadura: 9 } },
  { ...R3, id: 'verner3', family: 'pequenos', name: 'Verner Scarlett 3V', tag: 'ultraleves · 3 cil. · 1,6 L · 42 hp',
    displacement: 1.6, cr: 8.0, idle: 700, rpmMax: 2500, power: 31, J: 0.05, reducao: 1, helice: { B: 2, D: 1.7, J: 1.0, passoFixo: true, nMax: 2500 },
    carburador: 'boia', partida: 'direta', escape: { tipo: 'tubos', Lt: 0.45, Ot: 35 }, breakout: 'leaky',
    nivelEscape: 124, ...aviao, aeronave: { massa: 380, comprimento: 5.6, envergadura: 9.1 } },
  { ...R5, id: 'verner5', family: 'pequenos', name: 'Verner Scarlett 5S', tag: 'Savage, Kitfox · 5 cil. · 2,3 L · 103 hp',
    displacement: 2.3, cr: 8.0, idle: 720, rpmMax: 2600, power: 77, J: 0.08, reducao: 1, helice: { B: 2, D: 1.9, J: 1.2, passoFixo: true, nMax: 2600 },
    carburador: 'boia', partida: 'direta', escape: { tipo: 'tubos', Lt: 0.45, Ot: 35 }, breakout: 'leaky',
    nivelEscape: 124, ...aviao, aeronave: { massa: 550, comprimento: 6.6, envergadura: 9.4 } },
  // ---- Terra
  { ...R9, id: 'r975', family: 'terra', name: 'Continental R-975 (M4 Sherman)', tag: 'M4A1 Sherman · 9 cil. · 15,9 L · 400 hp · 5 marchas',
    displacement: 15.9, cr: 5.7, idle: 600, rpmMax: 2400, power: 298, J: 1.4, volante: 2.5,
    carburador: 'boia', superalimentador: { relacao: 10, pas: 12, boost: 0.15 }, partida: 'direta',
    escape: { tipo: 'lados', Lp: 0.2, saidas: [{ L: 1.5, O: 90, phi: 160 }, { L: 1.5, O: 90, phi: 200 }] }, breakout: 'sealed',
    gears: 5, ratios: [7.56, 3.11, 1.78, 1.11, 0.73], finalDrive: 2.84, wheelR: 0.32, mass: 30300, drag: 4.5,
    nivelEscape: 138, portadores: ['carro', 'nenhum'], veiculo: { massa: 30300, comprimento: 5.9, largura: 2.6, altura: 2.7 },
    aproximacao: 'sem o ruído da esteira' },
  { ...R16, id: 'trossi', family: 'terra', name: 'Monaco-Trossi', tag: 'carro de GP 1935 · 16 cil. em 2 fileiras · 4 L',
    displacement: 3.98, cr: 6.5, idle: 1200, rpmMax: 6000, power: 186, J: 0.4,
    carburador: 'boia', superalimentador: { relacao: 1.2, pas: 8, boost: 0.6, uivoDb: -12 }, partida: 'direta',
    escape: { tipo: 'tubos', Lt: 0.3, Ot: 40 }, breakout: 'leaky',
    gears: 4, ratios: [2.9, 1.9, 1.35, 1.0], finalDrive: 3.4, wheelR: 0.36, mass: 1000, drag: 0.5,
    nivelEscape: 146, portadores: ['carro', 'nenhum'], veiculo: { massa: 1000, comprimento: 4.2, largura: 1.6, altura: 1.1 },
    aproximacao: '2 tempos tratado como 4 tempos (o ciclo de 360° do EngineDSP só existe com ignição por compressão)' },
  { ...R5, id: 'megola', family: 'terra', name: 'Megola', tag: 'moto 1921 · 5 cil. na roda dianteira · 0,64 L',
    displacement: 0.64, cr: 5.0, idle: 450, rpmMax: 4800, power: 10, J: 0.02,
    carburador: 'boia', partida: 'manivela', escape: { tipo: 'tubos', Lt: 0.25, Ot: 30 }, breakout: 'leaky',
    gears: 1, ratios: [6], finalDrive: 1, wheelR: 0.33, mass: 200, drag: 0.35,
    nivelEscape: 118, portadores: ['carro'], rotativo: { i: 6 }, veiculo: { massa: 200, comprimento: 2.1, largura: 0.7, altura: 1.1 },
    aproximacao: 'motor girando com a roda (panorâmica); a "lenta" é a roda empurrada' },
  // ---- Helicóptero
  { ...R9, id: 's55', family: 'helicoptero', name: 'Sikorsky S-55 / H-19', tag: 'R-1340-57 · 600 hp · rotor de 3 pás',
    displacement: 22.0, cr: 6.0, idle: 1000, rpmMax: 2250, power: 447, J: 1.6,
    carburador: 'boia', superalimentador: { relacao: 10, pas: 12, boost: 0.2 }, partida: 'direta',
    escape: { tipo: 'anel', Danel: 1.1, Oanel: 76, Lp: 0.18, saidas: [{ L: 0.5, O: 76, phi: 135 }, { L: 0.5, O: 76, phi: 225 }] }, breakout: 'old',
    nivelEscape: 142, portadores: ['rotor', 'nenhum'],
    rotor: { B: 3, R: 8.075, Nr: 245, sigma: 0.048, cd0: 0.01, J_rot: 2400, Bc: 2, Rc: 1.32, ic: 1440 / 245, icx: 9.18, massa: 3000,
      engrenagens: [{ z: 47, rpm: 2250 }, { z: 11, rpm: 245 * 9 }], posRotor: [0, 0, 4.0], posCauda: [-10, 0, 2.5], posCaixa: [0, 0, 3.2], posMotor: [2.2, 0, 1.4],
      corpo: { comprimento: 12.9, largura: 2.4, altura: 4.1 } },
    veiculo: { massa: 3000, comprimento: 12.9, largura: 2.4, altura: 4.1 } },
] as PresetRadial[], { families: FAMILIAS_RADIAL });

export default PRESETS_RADIAL;
