// Motores diesel: um preset por motor/veículo, com a ficha técnica de docs/DIESEL.md 6.2.
//
// `PresetDiesel` = os campos do Ronco (`PresetRonco`, que o EngineDSP lê: arranjo, cilindrada, câmbio, carro) mais
// os de ignição por compressão (6.1). `redline` do Ronco é a rotação governada sem carga (`rpmMax`), que é o fundo
// do conta-giros e a referência dos mapas. Campos do Ronco sem efeito no diesel (o painel não os mostra):
// `limiter*`, `overrun`, `cat`, `twoStep`, `launchRpm`, `fuel`, `scWhine` direto (vem de `soprador`).
//
// Para adicionar um motor: copie um preset parecido e mude os números. Onde a ficha não é pública o valor foi
// estimado pela classe do motor (marcado "≈" no DIESEL.md).
import type { PresetRonco } from '../ronco/presets';
import type { TipoInjecao } from './constantes';

export type Governador = 'min-max' | 'todas-as-rotacoes' | 'isocrono';
export type TipoTurbo = 'vgt' | 'wastegate' | 'fixo' | 'engrenado' | 'nenhum';
export type FreioMotor = 'nenhum' | 'descarga' | 'vgt' | 'jake' | 'veb';
export type Portador = 'carro' | 'gerador' | 'locomotiva' | 'nenhum';
export type Abafador = 'stock' | 'sport' | 'straight' | 'abafador-caminhao' | 'nenhum';

export type EscapeDiesel = {
  turbina: boolean; dpf: boolean; abafador: Abafador;
  comprimento: number; // m, do coletor à saída (sem a chaminé)
  diametro: number; // polegadas
  chamine: { altura: number; diametro: number } | null; // m, polegadas (vertical de caminhão, chaminé de locomotiva)
  saidas?: 1 | 2; // ponteiras/chaminés (Cat C15: dupla vertical)
  tempGas: number; // velocidade do som no gás do escape (m/s): 470 leves, 500 pesados, 560 locomotivas
};

export type PresetDiesel = PresetRonco & {
  classe: 'leve' | 'pesado' | 'locomotiva';
  tempos: 2 | 4;
  cr: number; // taxa de compressão (vai para `compression` do EngineDSP)
  diametro: number; curso: number; // mm (o Ronco usa curso = diâmetro; o diesel usa os da ficha)
  ordemReal?: string; // ordem de ignição na numeração do fabricante (a `order` está na numeração do Ronco)
  injecao: TipoInjecao; piloto: boolean; idi: boolean; cetano?: number;
  eletronico: boolean; // avanço e combustível pela central (common-rail, injetor-bomba eletrônico, HEUI)
  avanco?: number; // início de injeção fixo (graus antes do PMS), sobrepõe o mapa (EMD 10, GE 14)
  governador: Governador; droop?: number;
  rpmMax: number; rpmPotencia: number; torque: number; power: number; bsfc?: number;
  limiteFumaca: number; // λ mínimo: 1,25 eletrônico, 1,10 mecânico com aneroide, 1,0 sem aneroide
  turboTipo: TipoTurbo; turboRpmMax: number; turboPas: number; turboApito: number; turboTau: [number, number];
  soprador?: { relacao: number; lobulos: number; uivo: number; pressao: number }; // Roots (2T); `pressao` = manométrica a rpmMax
  turboEngrenagem?: number; // relação do turbo engrenado (EMD 18,3)
  turboLenta?: number; // VGT: rotação mínima do turbo em lenta (fração da máxima; palhetas fechadas), padrão 0,15
  turboPonta?: number; // m/s, velocidade de ponta do rotor na rotação máxima (ruído de banda larga da turbina; padrão 480)
  freioMotor: FreioMotor; jakeCilindros?: number[];
  escape: EscapeDiesel;
  janelas?: { evo: number; ipo: number; ipc: number; evc: number }; // só 2T
  J?: number; // kg·m² (sobrepõe a fórmula do Ronco)
  // (engine: 'rear' nos grupos geradores e locomotivas: sem carroceria entre o motor e quem ouve de fora, a mecânica chega
  // sem o passa-baixa da carroceria do carro, como no motor traseiro do Ronco)
  glow: boolean; glowK?: number;
  turboChiado?: number; // dB no chiado do turbo
  mecanica?: number; // dB sobre a mecânica referida ao knock do próprio motor (acerto contra as gravações) // velas: espera = (1 s + 8 s·frio)·glowK (moderno 0,3)
  portadores: Portador[];
  gerador?: { fRede: number; polos: number; eta: number; Jalt: number; pas: number; kWe: number };
  locomotiva?: { notchRpm: number[]; kW: number; lentaBaixa: number; eta: number };
};

export type FamiliaDiesel = { id: string; name: string };

export const FAMILIAS: FamiliaDiesel[] = [
  { id: 'leve', name: 'Picapes e carros' },
  { id: 'pesado', name: 'Caminhões e ônibus' },
  { id: 'gerador', name: 'Geradores' },
  { id: 'locomotiva', name: 'Locomotivas' },
];

// Portador ao trocar de preset com a página aberta: o do próprio preset (o primeiro da lista), a não ser que se esteja na
// bancada e o preset também tenha bancada. (Manter o portador anterior sempre que o preset o aceitava levava um
// caminhão escolhido depois do gerador a nascer como grupo gerador, isócrono a 1800 rpm: "acelerado constante".)
export function portadorAoTrocar(p: { portadores: Portador[] }, atual: Portador): Portador {
  return atual === 'nenhum' && p.portadores.includes('nenhum') ? 'nenhum' : p.portadores[0];
}

// valores que a página volta ao escolher um preset (o que ele não define)
export const PADRAO_DIESEL: Partial<PresetDiesel> = {
  valve: 'none', pipeD: 2.5, reso: false, twoStep: 'off', launchRpm: undefined, fuel: 'efi', shiftTime: undefined, driveMode: 'auto',
  limiter: 'none', limiterBand: 70, limiterHold: 0, overrun: 'cut', cat: false, tipD: undefined, cooling: 'water', engine: undefined,
  breakout: 'sealed', scType: undefined, scRatio: undefined, scLobes: undefined, scWhine: undefined, cetano: 48, droop: 0.08,
  jakeCilindros: undefined, soprador: undefined, janelas: undefined, J: undefined, glowK: 1, bsfc: undefined, avanco: undefined,
  turboEngrenagem: undefined, ordemReal: undefined, gerador: undefined, locomotiva: undefined, ratios: undefined, finalDrive: undefined,
  wheelR: undefined, drag: undefined, mass: undefined,
};

// bases
const I4 = { layout: 'inline', cylinders: 4, crank: 'flat', order: '1-3-4-2' };
const I5 = { layout: 'inline', cylinders: 5, crank: '144', order: '1-2-4-5-3' };
const I6 = { layout: 'inline', cylinders: 6, crank: '120', order: '1-5-3-6-2-4' };
// V8 cross-plane, todos com o virabrequim do Ronco (moentes 0-90-270-180, pares 2k+1/2k+2 no mesmo moente). As ordens
// reais vêm em numerações diferentes; levadas à do Ronco (ímpares na bancada A, a que vai à frente na rotação):
//  - Scania DC16 1-5-4-2-6-3-7-8 (1–4 numa bancada, 5–8 na outra; pares 1/5, 2/6…) → 1-8-4-3-6-5-7-2
//  - Power Stroke 1-2-7-3-4-5-6-8 (Navistar: ímpares à direita, a bancada que atrasa) → 1-8-4-3-6-5-7-2
//  - Duramax 1-2-7-8-4-5-6-3 (Isuzu: ímpares à direita) → 1-8-7-3-6-5-4-2, outra ordem válida do mesmo virabrequim:
//    o mesmo ritmo por bancada (90-180-270-180) mas em outra sequência de cilindros ao longo de cada bancada
//    (conferido em build(): intervalos de 90° e ordem válida para os moentes do Ronco)
const V8 = { layout: 'v', cylinders: 8, crank: 'cross', bankAngle: 90, order: '1-8-4-3-6-5-7-2' };
const CARRO = { header: 'equal', routing: 'single', intake: 'airbox', cam: 0.1 };
const leve = (comprimento: number, diametro = 2.5, dpf = true): EscapeDiesel => ({ turbina: true, dpf, abafador: 'stock', comprimento, diametro, chamine: null, tempGas: 470 });

export const PRESETS: PresetDiesel[] & { families: FamiliaDiesel[] } = Object.assign([
  // ------------------------------------------------------------- picapes e carros
  {
    id: 'hilux28', family: 'leve', name: 'Toyota Hilux 2.8', tag: '1GD-FTV · I4 common-rail · 2016',
    ...I4, ...CARRO, classe: 'leve', tempos: 4, displacement: 2.755, diametro: 92, curso: 103.6, cr: 15.6,
    idle: 780, redline: 4400, rpmMax: 4400, rpmPotencia: 3400, power: 150, torque: 500, inertia: 1.6,
    injecao: 'common-rail', piloto: true, idi: false, eletronico: true, governador: 'min-max', limiteFumaca: 1.25,
    aspiration: 'turbo', boost: 1.4, turboTipo: 'vgt', turboRpmMax: 190000, turboPas: 12, turboApito: -36, turboTau: [0.8, 1.5],
    freioMotor: 'nenhum', escape: leve(4.2), muffler: 'stock', pipeLen: 4.2, glow: true, mecanica: 7, glowK: 0.3,
    gears: 6, transmission: 'auto', shiftTime: 0.5, ratios: [3.6, 2.09, 1.49, 1.0, 0.69, 0.58], finalDrive: 3.909, wheelR: 0.375, mass: 2200, drag: 0.72, // (raio dinâmico do 265/65 R17 carregado: 0,388 m livre × 0,967)
    portadores: ['carro', 'nenhum'],
  },
  {
    id: 'ranger32', family: 'leve', name: 'Ford Ranger 3.2', tag: 'Duratorq TDCi · I5 common-rail',
    ...I5, ...CARRO, classe: 'leve', tempos: 4, displacement: 3.198, diametro: 89.9, curso: 100.8, cr: 15.7,
    idle: 750, redline: 4000, rpmMax: 4000, rpmPotencia: 3000, power: 147, torque: 470, inertia: 1.6,
    injecao: 'common-rail', piloto: true, idi: false, eletronico: true, governador: 'min-max', limiteFumaca: 1.25,
    aspiration: 'turbo', boost: 1.3, turboTipo: 'vgt', turboRpmMax: 180000, turboPas: 12, turboApito: -36, turboTau: [0.8, 1.5],
    freioMotor: 'nenhum', escape: leve(4.3), muffler: 'stock', pipeLen: 4.3, glow: true, mecanica: 7, glowK: 0.3,
    gears: 6, transmission: 'auto', shiftTime: 0.5, ratios: [4.17, 2.34, 1.52, 1.14, 0.87, 0.69], finalDrive: 3.73, wheelR: 0.39, mass: 2250, drag: 0.74,
    portadores: ['carro', 'nenhum'],
  },
  {
    id: 'ram67', family: 'leve', name: 'Ram 2500 6.7 Cummins', tag: 'ISB 6.7 · I6 common-rail · 2013',
    ...I6, ...CARRO, classe: 'leve', tempos: 4, displacement: 6.69, diametro: 107, curso: 124, cr: 17.3,
    idle: 750, redline: 3200, rpmMax: 3200, rpmPotencia: 2800, power: 276, torque: 1152, inertia: 1.3,
    injecao: 'common-rail', piloto: true, idi: false, eletronico: true, governador: 'min-max', limiteFumaca: 1.25,
    aspiration: 'turbo', boost: 1.9, turboTipo: 'vgt', turboRpmMax: 130000, turboPas: 14, turboApito: -20, turboLenta: 0.24, turboTau: [1.0, 1.8],
    freioMotor: 'vgt', escape: leve(4.6, 4), muffler: 'stock', pipeLen: 4.6, pipeD: 4, glow: true, glowK: 0.3, mecanica: 10,
    gears: 6, transmission: 'auto', shiftTime: 0.55, ratios: [3.23, 1.84, 1.41, 1.0, 0.82, 0.63], finalDrive: 3.73, wheelR: 0.4, mass: 3500, drag: 0.85,
    portadores: ['carro', 'nenhum'],
  },
  {
    id: 'duramax66', family: 'leve', name: 'Silverado 2500HD 6.6 Duramax', tag: 'L5P · V8 common-rail',
    ...V8, ...CARRO, order: '1-8-7-3-6-5-4-2', ordemReal: '1-2-7-8-4-5-6-3', classe: 'leve', tempos: 4, displacement: 6.6, diametro: 103, curso: 99, cr: 16.0,
    idle: 680, redline: 3450, rpmMax: 3450, rpmPotencia: 2800, power: 332, torque: 1234, inertia: 1.2,
    injecao: 'common-rail', piloto: true, idi: false, eletronico: true, governador: 'min-max', limiteFumaca: 1.25,
    aspiration: 'turbo', boost: 1.9, turboTipo: 'vgt', turboRpmMax: 140000, turboPas: 14, turboApito: -26, turboLenta: 0.3, turboTau: [1.0, 1.8],
    freioMotor: 'vgt', escape: leve(4.8, 4), muffler: 'stock', pipeLen: 4.8, pipeD: 4, glow: true, mecanica: 8, glowK: 0.3,
    gears: 10, transmission: 'auto', shiftTime: 0.45, ratios: [4.54, 2.86, 2.06, 1.72, 1.38, 1.14, 1.0, 0.85, 0.68, 0.63], finalDrive: 3.42, wheelR: 0.4, mass: 3600, drag: 0.88,
    portadores: ['carro', 'nenhum'],
  },
  {
    id: 'psd73', family: 'leve', name: 'Ford F-250 7.3 Power Stroke', tag: 'Navistar T444E · V8 HEUI · 1999',
    ...V8, ...CARRO, ordemReal: '1-2-7-3-4-5-6-8', classe: 'leve', tempos: 4, displacement: 7.3, diametro: 104.4, curso: 106.2, cr: 17.5,
    idle: 680, redline: 3300, rpmMax: 3300, rpmPotencia: 2600, power: 186, torque: 678, inertia: 1.3,
    injecao: 'heui', piloto: false, idi: false, eletronico: true, governador: 'min-max', limiteFumaca: 1.15,
    aspiration: 'turbo', boost: 1.3, turboTipo: 'wastegate', turboRpmMax: 120000, turboPas: 14, turboApito: -24, turboTau: [1.2, 2.0],
    freioMotor: 'nenhum', escape: leve(4.6, 4, false), muffler: 'sport', pipeLen: 4.6, pipeD: 4, glow: true, mecanica: 6, glowK: 0.6,
    gears: 4, transmission: 'auto', shiftTime: 0.6, ratios: [2.71, 1.54, 1.0, 0.71], finalDrive: 3.73, wheelR: 0.4, mass: 3400, drag: 0.9,
    portadores: ['carro', 'nenhum'],
  },
  {
    id: 'om617', family: 'leve', name: 'Mercedes 300D W123', tag: 'OM617.912 · I5 pré-câmara · aspirado',
    ...I5, ...CARRO, classe: 'leve', tempos: 4, displacement: 3.005, diametro: 91, curso: 92.4, cr: 21.0,
    idle: 750, redline: 5100, rpmMax: 5100, rpmPotencia: 4000, power: 59, torque: 172, inertia: 1.4,
    injecao: 'em-linha', piloto: false, idi: true, eletronico: false, governador: 'todas-as-rotacoes', droop: 0.08, limiteFumaca: 1.0,
    aspiration: 'na', boost: 0, turboTipo: 'nenhum', turboRpmMax: 0, turboPas: 0, turboApito: 0, turboTau: [1, 1],
    freioMotor: 'nenhum', escape: { turbina: false, dpf: false, abafador: 'stock', comprimento: 3.8, diametro: 2, chamine: null, tempGas: 470 }, muffler: 'stock', pipeLen: 3.8, pipeD: 2,
    glow: true, mecanica: 4, glowK: 2.2,
    gears: 4, transmission: 'auto', shiftTime: 0.7, ratios: [3.68, 2.41, 1.44, 1.0], finalDrive: 3.46, wheelR: 0.31, mass: 1700, drag: 0.5,
    portadores: ['carro', 'nenhum'],
  },
  {
    id: 'tdi19', family: 'leve', name: 'VW Golf IV 1.9 TDI', tag: 'ALH · I4 bomba rotativa VP37',
    ...I4, ...CARRO, classe: 'leve', tempos: 4, displacement: 1.896, diametro: 79.5, curso: 95.5, cr: 19.5,
    idle: 900, redline: 4800, rpmMax: 4800, rpmPotencia: 3750, power: 66, torque: 210, inertia: 1.1,
    injecao: 'rotativa', piloto: false, idi: false, eletronico: true, governador: 'min-max', limiteFumaca: 1.2,
    aspiration: 'turbo', boost: 1.0, turboTipo: 'vgt', turboRpmMax: 200000, turboPas: 12, turboApito: -36, turboTau: [0.7, 1.3],
    freioMotor: 'nenhum', escape: leve(3.6, 2, false), muffler: 'stock', pipeLen: 3.6, pipeD: 2, glow: true, mecanica: 4, glowK: 0.5,
    gears: 5, transmission: 'manual', ratios: [3.78, 2.12, 1.36, 0.97, 0.76], finalDrive: 3.39, wheelR: 0.3, mass: 1300, drag: 0.42,
    portadores: ['carro', 'nenhum'],
  },
  {
    id: 'f1000mwm', family: 'leve', name: 'Ford F-1000 MWM 229', tag: 'MWM D229-4 · I4 bomba em linha · aspirado',
    ...I4, ...CARRO, classe: 'leve', tempos: 4, displacement: 3.92, diametro: 102, curso: 120, cr: 17.0,
    idle: 750, redline: 3000, rpmMax: 3000, rpmPotencia: 2800, power: 66, torque: 274, inertia: 1.8,
    injecao: 'em-linha', piloto: false, idi: false, eletronico: false, governador: 'todas-as-rotacoes', droop: 0.08, limiteFumaca: 1.0,
    aspiration: 'na', boost: 0, turboTipo: 'nenhum', turboRpmMax: 0, turboPas: 0, turboApito: 0, turboTau: [1, 1],
    freioMotor: 'nenhum', escape: { turbina: false, dpf: false, abafador: 'stock', comprimento: 4.2, diametro: 2.25, chamine: null, tempGas: 470 }, muffler: 'stock', pipeLen: 4.2, pipeD: 2.25,
    glow: false, mecanica: 4,
    gears: 5, transmission: 'manual', ratios: [4.56, 2.47, 1.47, 1.0, 0.78], finalDrive: 4.1, wheelR: 0.38, mass: 2200, drag: 0.8,
    portadores: ['carro', 'nenhum'],
  },
  // ------------------------------------------------------------- caminhões e ônibus
  {
    id: 'scaniav8', family: 'pesado', name: 'Scania R500 V8', tag: 'DC16.03 PDE · V8 injetor-bomba · Euro 3',
    ...V8, ...CARRO, ordemReal: '1-5-4-2-6-3-7-8', classe: 'pesado', tempos: 4, displacement: 15.6, diametro: 127, curso: 154, cr: 17.0,
    idle: 500, redline: 2100, rpmMax: 2100, rpmPotencia: 1900, power: 368, torque: 2400, inertia: 1, J: 3.6,
    injecao: 'unitaria', piloto: false, idi: false, eletronico: true, governador: 'min-max', limiteFumaca: 1.25,
    aspiration: 'turbo', boost: 1.6, turboTipo: 'wastegate', turboRpmMax: 110000, turboPas: 14, turboApito: -20, turboTau: [1.5, 2.5],
    freioMotor: 'descarga', escape: { turbina: true, dpf: false, abafador: 'abafador-caminhao', comprimento: 3.5, diametro: 5, chamine: { altura: 0.8, diametro: 5 }, tempGas: 500 },
    muffler: 'stock', pipeLen: 3.5, pipeD: 5, glow: false, mecanica: 17, engine: 'mid',
    gears: 12, transmission: 'auto', shiftTime: 1.0, driveMode: 'eco', ratios: [11.32, 9.14, 7.19, 5.8, 4.63, 3.74, 3.02, 2.44, 1.92, 1.55, 1.24, 1.0], finalDrive: 3.08, wheelR: 0.52, mass: 40000, drag: 3.6,
    portadores: ['carro', 'gerador', 'nenhum'],
    gerador: { fRede: 60, polos: 4, eta: 0.95, Jalt: 10, pas: 10, kWe: 300 },
  },
  {
    id: 'volvod13', family: 'pesado', name: 'Volvo FH D13', tag: 'D13A 480 · I6 injetor-bomba · VEB',
    ...I6, ...CARRO, classe: 'pesado', tempos: 4, displacement: 12.8, diametro: 131, curso: 158, cr: 17.0,
    idle: 600, redline: 2100, rpmMax: 2100, rpmPotencia: 1800, power: 353, torque: 2400, inertia: 1, J: 3.2,
    injecao: 'unitaria', piloto: false, idi: false, eletronico: true, governador: 'min-max', limiteFumaca: 1.25,
    aspiration: 'turbo', boost: 1.7, turboTipo: 'wastegate', turboRpmMax: 110000, turboPas: 14, turboApito: -20, turboTau: [1.5, 2.5],
    freioMotor: 'veb', escape: { turbina: true, dpf: false, abafador: 'abafador-caminhao', comprimento: 3.2, diametro: 5, chamine: { altura: 1.0, diametro: 5 }, tempGas: 500 },
    muffler: 'stock', pipeLen: 3.2, pipeD: 5, glow: false, mecanica: 17, engine: 'mid',
    gears: 12, transmission: 'auto', shiftTime: 0.9, driveMode: 'eco', ratios: [14.94, 11.73, 9.04, 7.09, 5.54, 4.35, 3.44, 2.7, 2.08, 1.63, 1.27, 1.0], finalDrive: 2.85, wheelR: 0.52, mass: 40000, drag: 3.6,
    portadores: ['carro', 'gerador', 'nenhum'],
    gerador: { fRede: 60, polos: 4, eta: 0.95, Jalt: 10, pas: 10, kWe: 300 },
  },
  {
    id: 'catc15', family: 'pesado', name: 'Cat C15', tag: 'C15 6NZ · I6 MEUI · Jake brake · 2003',
    ...I6, ...CARRO, classe: 'pesado', tempos: 4, displacement: 15.2, diametro: 137, curso: 171, cr: 17.0,
    idle: 600, redline: 2100, rpmMax: 2100, rpmPotencia: 2100, power: 410, torque: 2510, inertia: 1, J: 3.8,
    injecao: 'unitaria', piloto: false, idi: false, eletronico: true, governador: 'min-max', limiteFumaca: 1.25,
    aspiration: 'turbo', boost: 1.7, turboTipo: 'wastegate', turboRpmMax: 110000, turboPas: 14, turboApito: -20, turboTau: [1.5, 2.5],
    freioMotor: 'jake', jakeCilindros: [2, 4, 6],
    escape: { turbina: true, dpf: false, abafador: 'abafador-caminhao', comprimento: 2.6, diametro: 5, chamine: { altura: 3.5, diametro: 5 }, saidas: 2, tempGas: 500 },
    muffler: 'stock', pipeLen: 2.6, pipeD: 5, glow: false, mecanica: 17, engine: 'mid',
    gears: 10, transmission: 'auto', shiftTime: 1.1, driveMode: 'eco', ratios: [14.4, 8.56, 6.05, 4.38, 3.2, 1.95, 1.38, 1.0, 0.86, 0.73], finalDrive: 3.55, wheelR: 0.52, mass: 36000, drag: 3.8,
    portadores: ['carro', 'gerador', 'nenhum'],
    gerador: { fRede: 60, polos: 4, eta: 0.95, Jalt: 10, pas: 10, kWe: 350 },
  },
  {
    id: 'onibusisl', family: 'pesado', name: 'Ônibus urbano Cummins ISL9', tag: 'ISL9 280 · I6 common-rail · motor traseiro',
    ...I6, ...CARRO, classe: 'pesado', tempos: 4, displacement: 8.9, diametro: 114, curso: 144.5, cr: 16.6, engine: 'rear',
    idle: 650, redline: 2300, rpmMax: 2300, rpmPotencia: 2100, power: 206, torque: 1017, inertia: 1, J: 2.4,
    injecao: 'common-rail', piloto: false, idi: false, eletronico: true, governador: 'min-max', limiteFumaca: 1.25,
    aspiration: 'turbo', boost: 1.6, turboTipo: 'vgt', turboRpmMax: 110000, turboPas: 14, turboApito: -20, turboTau: [1.5, 2.5],
    freioMotor: 'vgt', escape: { turbina: true, dpf: true, abafador: 'abafador-caminhao', comprimento: 6, diametro: 5, chamine: null, tempGas: 500 },
    muffler: 'stock', pipeLen: 6, pipeD: 5, glow: false, mecanica: 23,
    gears: 6, transmission: 'auto', shiftTime: 0.8, driveMode: 'eco', ratios: [3.36, 1.91, 1.42, 1.0, 0.72, 0.62], finalDrive: 5.74, wheelR: 0.51, mass: 18000, drag: 3.2,
    portadores: ['carro', 'gerador', 'nenhum'],
    gerador: { fRede: 60, polos: 4, eta: 0.95, Jalt: 8, pas: 10, kWe: 180 },
  },
  {
    id: 'dd6v92', family: 'pesado', name: 'Detroit Diesel 6V92TA (MCI MC-9)', tag: '6V92TA · V6 2 tempos · Roots + turbo',
    layout: 'v', cylinders: 6, crank: 'dd6v', bankAngle: 63.5, order: 'pms', header: 'short', routing: 'single', intake: 'airbox', cam: 0, engine: 'rear',
    classe: 'pesado', tempos: 2, displacement: 9.05, diametro: 123.8, curso: 127, cr: 17.0,
    idle: 550, redline: 2100, rpmMax: 2100, rpmPotencia: 2100, power: 224, torque: 1180, inertia: 1, J: 2.6,
    injecao: 'unitaria', piloto: false, idi: false, eletronico: false, governador: 'todas-as-rotacoes', droop: 0.07, limiteFumaca: 1.1,
    aspiration: 'turbo', boost: 1.2, turboTipo: 'fixo', turboRpmMax: 90000, turboPas: 14, turboApito: -20, turboTau: [1.5, 2.5],
    soprador: { relacao: 1.95, lobulos: 3, uivo: 0, pressao: 0.45 },
    freioMotor: 'nenhum', escape: { turbina: true, dpf: false, abafador: 'abafador-caminhao', comprimento: 3.0, diametro: 4, chamine: null, tempGas: 500 },
    janelas: { evo: 95, ipo: 130, ipc: 230, evc: 225 },
    muffler: 'stock', pipeLen: 3, pipeD: 4, glow: false, mecanica: 12,
    gears: 4, transmission: 'auto', shiftTime: 0.9, driveMode: 'eco', ratios: [3.69, 2.01, 1.36, 1.0], finalDrive: 4.11, wheelR: 0.5, mass: 16000, drag: 3.0,
    portadores: ['carro', 'nenhum'],
  },
  // ------------------------------------------------------------- geradores
  {
    id: 'gen500', family: 'gerador', name: 'Gerador Cummins 500 kVA', tag: 'QSX15-G8 · I6 HPI · 1800 rpm, 60 Hz',
    ...I6, ...CARRO, classe: 'pesado', tempos: 4, displacement: 15.0, diametro: 137, curso: 169, cr: 17.0,
    idle: 1200, redline: 1890, rpmMax: 1890, rpmPotencia: 1800, power: 455, torque: 2415, inertia: 1, J: 4,
    injecao: 'unitaria', piloto: false, idi: false, eletronico: true, governador: 'isocrono', limiteFumaca: 1.25,
    aspiration: 'turbo', boost: 1.6, turboTipo: 'wastegate', turboRpmMax: 110000, turboPas: 14, turboApito: -16, turboTau: [1.5, 2.5],
    freioMotor: 'nenhum', escape: { turbina: true, dpf: false, abafador: 'stock', comprimento: 2.0, diametro: 6, chamine: null, tempGas: 500 },
    muffler: 'stock', pipeLen: 2, pipeD: 6, glow: false, mecanica: 20, engine: 'rear',
    gears: 0, transmission: 'manual', mass: 5000,
    portadores: ['gerador', 'nenhum'],
    gerador: { fRede: 60, polos: 4, eta: 0.95, Jalt: 12, pas: 10, kWe: 400 },
  },
  // ------------------------------------------------------------- locomotivas
  {
    id: 'emd710', family: 'locomotiva', name: 'Locomotiva EMD SD70ACe', tag: '16-710G3C-T2 · V16 2 tempos · turbo engrenado',
    layout: 'v', cylinders: 16, crank: 'emd16', bankAngle: 45, order: 'pms', ordemReal: '1-8-9-16-3-6-11-14-4-5-12-13-2-7-10-15',
    header: 'short', routing: 'single', intake: 'airbox', cam: 0,
    classe: 'locomotiva', tempos: 2, displacement: 186, diametro: 230.2, curso: 279.4, cr: 16.0,
    idle: 269, redline: 904, rpmMax: 904, rpmPotencia: 904, power: 3356, torque: 35400, inertia: 1, J: 400,
    injecao: 'unitaria', piloto: false, idi: false, eletronico: true, avanco: 8, governador: 'isocrono', limiteFumaca: 1.2,
    aspiration: 'turbo', boost: 1.4, turboTipo: 'engrenado', turboEngrenagem: 18.3, turboRpmMax: 18000, turboPas: 27, turboApito: 5, turboPonta: 560, turboChiado: -10, turboTau: [3, 5], // (chiado −10: o compressor fica dentro da caixa de filtros da carroceria)
    freioMotor: 'nenhum', escape: { turbina: true, dpf: false, abafador: 'nenhum', comprimento: 1.2, diametro: 17.7, chamine: { altura: 0.8, diametro: 17.7 }, tempGas: 560 },
    janelas: { evo: 100, ipo: 134, ipc: 226, evc: 227 }, // (EVC 5° antes do DIESEL.md, como ele manda se o p_max de N8 sair da janela: mais ar preso)
    muffler: 'straight', pipeLen: 1.2, pipeD: 17.7, glow: false, mecanica: 18, engine: 'rear',
    gears: 0, transmission: 'manual', mass: 190000,
    portadores: ['locomotiva', 'nenhum'],
    locomotiva: { notchRpm: [269, 269, 343, 490, 568, 651, 729, 820, 904], kW: 3356, lentaBaixa: 200, eta: 0.93 },
  },
  {
    id: 'ge7fdl', family: 'locomotiva', name: 'Locomotiva GE C30-7', tag: '7FDL-16 · V16 4 tempos · turbo livre',
    layout: 'v', cylinders: 16, crank: '90', bankAngle: 45, order: '1-8-7-4-3-6-5-2-15-10-9-14-13-12-11-16',
    header: 'short', routing: 'single', intake: 'airbox', cam: 0.1,
    classe: 'locomotiva', tempos: 4, displacement: 175, diametro: 228.6, curso: 266.7, cr: 12.7,
    idle: 440, redline: 1050, rpmMax: 1050, rpmPotencia: 1050, power: 2240, torque: 20400, inertia: 1, J: 380,
    injecao: 'em-linha', piloto: false, idi: false, eletronico: false, avanco: 19, governador: 'isocrono', limiteFumaca: 1.0,
    aspiration: 'turbo', boost: 1.6, turboTipo: 'fixo', turboRpmMax: 15500, turboPas: 20, turboApito: -16, turboPonta: 400, turboChiado: -10, turboTau: [4, 6],
    freioMotor: 'nenhum', escape: { turbina: true, dpf: false, abafador: 'nenhum', comprimento: 4.0, diametro: 17.7, chamine: { altura: 0.8, diametro: 17.7 }, tempGas: 560 },
    muffler: 'straight', pipeLen: 4.0, pipeD: 17.7, glow: false, mecanica: -14, engine: 'rear',
    gears: 0, transmission: 'manual', mass: 180000,
    portadores: ['locomotiva', 'nenhum'],
    locomotiva: { notchRpm: [440, 440, 511, 585, 672, 764, 846, 950, 1050], kW: 2240, lentaBaixa: 440, eta: 0.93 },
  },
] as PresetDiesel[], { families: FAMILIAS });

export default PRESETS;
