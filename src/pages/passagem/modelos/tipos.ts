// Qual veículo cada preset de motor é (sem three.js): o tipo de carroceria do carro, o avião de hélice com as medidas
// do tipo, o jato. Os modelos (index.ts) desenham com isto; os assentos (pontos.ts) e o interior (interior.ts) acham
// a cabine com as mesmas medidas, para o que se vê do assento e o que se ouve dele serem o mesmo lugar.
import { COR } from './paleta';
import type { Vec3 } from '../../../scene/tipos';

export type TipoCarro = 'sedan' | 'cupe' | 'esportivo' | 'hatch' | 'muscle' | 'picape' | 'caminhao' | 'onibus' | 'moto' | 'tanque' | 'formula' | 'prototipo' | 'antigo' | 'gp-antigo';
export type TipoHelice = 'leve-alta' | 'leve-baixa' | 'treinador' | 'corsair' | 'p47' | 'transporte-alta' | 'transporte-baixa' | 'vant';
export interface ParamsHelice { tipo: TipoHelice; L: number; env: number; cor: number; cor2: number; pas: number; rH: number; trem: boolean; tEm?: boolean }
export interface ParamsJato { tipo: 'linha' | 'linha-cauda' | 'caca' | 'concorde'; L: number; env: number; motores: number; derivas: 1 | 2; cor: number; cor2: number }

/** tipo de carroceria de cada preset de motor que anda de carro */
export function tipoCarro(motor: string, id: string): { tipo: TipoCarro; cor: number } {
  const T = (tipo: TipoCarro, cor: number) => ({ tipo, cor });
  if (motor === 'diesel') {
    if (['scaniav8', 'volvod13', 'catc15'].includes(id)) return T('caminhao', id === 'scaniav8' ? 0xb8322a : id === 'volvod13' ? 0x2f5aa8 : 0xe2b33a);
    if (['onibusisl', 'dd6v92'].includes(id)) return T('onibus', id === 'dd6v92' ? 0x8a2a22 : 0x2f7d4f);
    if (id === 'om617') return T('sedan', 0xd9cbb0);
    if (id === 'tdi19') return T('hatch', 0x3f444b);
    return T('picape', id === 'hilux28' ? 0xb9bcc0 : id === 'f1000mwm' ? 0x2f5aa8 : 0x4a4f57);
  }
  if (motor === 'radial') return id === 'r975' ? T('tanque', 0) : id === 'megola' ? T('moto', 0x8a2a22) : T('gp-antigo', 0xb8322a);
  if (motor === 'rotativo') return id === 'r26b' ? T('prototipo', 0xe08a2a) : id === 'norton' ? T('moto', 0x2b2e33) : id === 'ro80' ? T('sedan', 0x5f7f9a) : T('esportivo', id.startsWith('rx7') ? 0xb8322a : 0x2f5aa8);
  if (motor === 'eletrico') return id === 'formulae' ? T('formula', 0xeef0f2) : id === 'trolebus' ? T('onibus', 0x2f5aa8) : id === 'leaf' ? T('hatch', 0xd7d9dc) : T('sedan', id === 'model3' ? 0xeef0f2 : 0x2f5aa8);
  if (motor === 'vapor') return T('antigo', 0x7a2a22);
  // Ronco (pistão): pela família do preset
  const fam = id;
  if (['r1', 'cbr', 'zx10r', 'h2', 'hayabusa', 'panigale', 'monster', 'vtwin', 'mt07', 'triumph', 'single'].includes(fam)) return T('moto', fam === 'zx10r' || fam === 'h2' ? 0x3d8a4a : fam === 'panigale' || fam === 'monster' ? 0xb8322a : 0x2f5aa8);
  if (['v10f1', 'f1v8', 'f1v12'].includes(fam)) return T('formula', 0xb8322a);
  if (['nascar', 'c8r'].includes(fam)) return T('esportivo', 0xe2b33a);
  if (['muscle', 'mustang', 'gt500', 'gt350', 'hellcat', 'chevelle', 'charger', 'maverick', 'v6odd'].includes(fam)) return T('muscle', fam === 'muscle' ? 0xe2b33a : fam === 'hellcat' ? 0x4a4f57 : 0xb8322a);
  if (['flatplane', 'f40', 'f812', 'laferrari', 'aventador', 'huracan', 'mclaren', 'zonda', 'carreragt', 'v16', 'jesko', 'valkyrie', 't50', 'amgone', 'lfa', 'corvette', 'viper', 'r8'].includes(fam)) return T('esportivo', 0xb8322a);
  if (['golfgti', 'i3', 'golgti', 'unoturbo', 'ek9', 'fusca'].includes(fam)) return T('hatch', fam === 'fusca' ? 0x5f8fb0 : 0xd7d9dc);
  if (['flat6', 'turbos', 'carrera32', 'brz', 'i4', 'supra', 'r34', 'gtr', 'mx5', 'i6', 'm3g80', 'quattro'].includes(fam)) return T('cupe', 0x2f5aa8);
  return T('sedan', 0x4a4f57);
}

/** avião de hélice de cada preset (tipo, medidas reais, cores, pás) */
export function paramsHelice(motor: string, id: string): ParamsHelice {
  const P = (tipo: ParamsHelice['tipo'], L: number, env: number, cor: number, cor2: number, pas: number, rH: number, trem = false, tEm = false): ParamsHelice => ({ tipo, L, env, cor, cor2, pas, rH, trem, tEm });
  if (motor === 'turboelice') {
    if (id === 'c130') return P('transporte-alta', 29.8, 40.4, 0x7a8068, 0x6b7158, 6, 2.05);
    if (id === 'kingair') return P('transporte-baixa', 14.2, 17.6, COR.branco, 0x2f5aa8, 4, 1.25);
    if (id === 'single' || id === 'pc12') return P('leve-alta', 11.5, 15.9, COR.branco, 0x2f5aa8, 3, 1.3, true);
    if (id === 'stucano') return P('treinador', 11.4, 11.1, 0x5b6338, 0x3f444b, 5, 1.2);
    return P('transporte-alta', id === 'q400' ? 32.8 : 27.2, id === 'q400' ? 28.4 : 27.1, COR.branco, 0x2f5aa8, 6, 1.95, false, true);
  }
  if (motor === 'radial') {
    if (id === 'r2800') return P('corsair', 10.3, 12.5, 0x22406e, 0x22406e, 4, 2.0);
    if (id === 'r2800turbo') return P('p47', 11.0, 12.4, 0x8f949a, 0x2b2e33, 4, 1.9);
    if (id === 'r1830' || id === 'r4360') return P('transporte-baixa', id === 'r1830' ? 19.7 : 30.2, id === 'r1830' ? 29 : 43, 0xb9bcc0, 0x2f5aa8, 3, 1.75);
    if (id === 'm14p' || id === 'm14pf') return P('treinador', 7.7, 9.3, COR.branco, 0xb8322a, id === 'm14pf' ? 3 : 2, 1.2);
    if (id === 'r1340' || id === 'r1820') return P('treinador', 8.8, 12.8, 0xe2b33a, 0x2f5aa8, id === 'r1820' ? 3 : 2, 1.4);
    return P('leve-alta', 6.5, 9.8, COR.creme, 0xb8322a, 2, 0.9, true);
  }
  if (motor === 'rotativo') return id === 'ar741' ? P('vant', 3.4, 6.2, 0x8f949a, 0x6b7077, 2, 0.45) : P('leve-baixa', 6.8, 8.5, COR.branco, 0x2f5aa8, 2, 0.85, true);
  // pistão de aviação do Ronco
  if (id === 'c172' || id === 'o200') return P('leve-alta', id === 'c172' ? 8.3 : 7.3, id === 'c172' ? 11 : 10.2, COR.branco, 0x2f5aa8, 2, 0.95, true);
  return P('leve-baixa', id === 'io550' ? 7.9 : 7.6, id === 'io550' ? 11.7 : 9.6, COR.branco, id === 'io550' ? 0xb8322a : 0x2f5aa8, id === 'io540' || id === 'io550' ? 3 : 2, 0.95, true);
}

export function paramsJato(id: string, L: number, caca: boolean): ParamsJato {
  if (id === 'sst') return { tipo: 'concorde', L, env: 25.6, motores: 4, derivas: 1, cor: COR.branco, cor2: COR.claro };
  if (caca || ['fighter', 'twin', 'f22', 'f35', 'fa18', 'su27', 'gripen'].includes(id)) return { tipo: 'caca', L, env: ['twin', 'su27'].includes(id) ? 13.5 : 10, motores: 1, derivas: ['twin', 'f22', 'f35', 'fa18', 'su27'].includes(id) ? 2 : 1, cor: 0x8a929b, cor2: 0x6b7077 };
  if (id === 'b727') return { tipo: 'linha-cauda', L, env: 32.9, motores: 3, derivas: 1, cor: COR.branco, cor2: 0x2f5aa8 };
  const quatro = ['a380', 'b744', 'jumbo', 'turbojet', 'b707b'].includes(id);
  return { tipo: 'linha', L, env: Math.max(28, L * 0.92), motores: quatro ? 4 : 2, derivas: 1, cor: COR.branco, cor2: id.startsWith('a') ? 0x22406e : 0x2f5aa8 };
}

/** raio da fuselagem do monomotor por tipo (o mesmo de ar.ts) */
export function raioFuselagem(tipo: TipoHelice) { return tipo === 'p47' ? 0.78 : tipo === 'corsair' || tipo === 'treinador' ? 0.66 : 0.6; }

/** o transporte de hélice: raio e centro da fuselagem, a ponta do nariz (as medidas de ar.ts) */
export function fuselagemTransporte(par: ParamsHelice, helices: readonly Vec3[]) {
  const h0 = helices[0] ?? [3.3, 0, 1.5];
  const zP = h0[2], alta = par.tipo === 'transporte-alta', rf = Math.max(1.0, par.L * 0.05), zf = alta ? zP - rf * 0.75 : zP + rf * 0.4;
  const xn = Math.max(...helices.map((h) => h[0]), h0[0]) + par.L * 0.33;
  return { rf, zf, xn, alta };
}

/**
 * O olho do piloto do avião de hélice, no referencial do corpo: na cabine do modelo (ar.ts), atrás da hélice, à altura
 * do vidro. O corpo do portador "hélice" tem 27 m para todos os aviões e o modelo fica ancorado na hélice: a cabine é a
 * do modelo, não a do meio do corpo. Sem cabine (o VANT), null.
 */
export function olhoPilotoHelice(par: ParamsHelice, helices: readonly Vec3[]): Vec3 | null {
  if (par.tipo === 'vant') return null;
  if (par.tipo === 'transporte-alta' || par.tipo === 'transporte-baixa') {
    const t = fuselagemTransporte(par, helices);
    return [t.xn - 2.3, 0.48, t.zf + t.rf * 0.3];
  }
  const [xh, , zh] = helices[0] ?? [3.3, 0, 1.5], L = par.L, rf = raioFuselagem(par.tipo), xa = xh - L * 0.3;
  if (par.tipo === 'leve-alta') return [xh - 2.05, 0.27, zh + rf * 0.55];
  // (canopi: o olho uns 17 cm abaixo do topo do vidro, acima da fuselagem, para ver por cima do nariz)
  if (par.tipo === 'corsair') return [xh - 0.36 * L, 0, zh + rf * 0.75 + 0.26];
  if (par.tipo === 'treinador') return [xa + 0.45, 0, zh + rf * 0.75 + 0.26];
  return [xa - 0.1, par.tipo === 'leve-baixa' ? 0.25 : 0, zh + rf * 0.75 + 0.26];
}
