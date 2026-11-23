// O coletor dos obstáculos leves do cenário (troncos, postes, carros e vagões parados, cercas, água): enquanto mundo/
// monta o lugar, cada peça que segura quem anda a pé se anota aqui, nas coordenadas da via (s, m), e no fim o Lugar
// (lugar.ts) recebe a lista. O que se vê é o que segura: as medidas são as do desenho.
import { levesVazios, type Leves } from '../lugar';

let atual: Leves | null = null;

/** começa a anotar (montarMundo) */
export function iniciarLeves() { atual = levesVazios(); }
/** termina e devolve o que foi anotado */
export function fecharLeves(): Leves { const l = atual ?? levesVazios(); atual = null; return l; }

/** tronco, poste, mastro: um círculo de raio r em (s, m), de z0 a z0 + h */
export function leveCirculo(s: number, m: number, r: number, h = 10, z0 = 0) { atual?.circulos.push({ s, m, r, z0, h }); }
/** carro, vagão, água: uma caixa de s0 a s1 e de m0 a m1 */
export function leveCaixa(s0: number, s1: number, m0: number, m1: number, h = 3, z0 = 0) { atual?.caixas.push({ s0: Math.min(s0, s1), s1: Math.max(s0, s1), m0: Math.min(m0, m1), m1: Math.max(m0, m1), z0, h }); }
/** cerca ao longo da via em m, de s0 a s1, com o vão (a porteira) opcional */
export function leveLinha(s0: number, s1: number, m: number, h = 1.5, z0 = 0, vao?: [number, number]) { atual?.linhas.push({ s0, s1, m, z0, h, vao }); }
/** cerca atravessada na abscissa s, de m0 a m1 */
export function leveTravessa(s: number, m0: number, m1: number, h = 2, z0 = 0) { atual?.travessas.push({ s, m0, m1, z0, h }); }
/** água em elipse (o lago) */
export function leveElipse(s: number, m: number, rs: number, rm: number) { atual?.elipses.push({ s, m, rs, rm }); }
