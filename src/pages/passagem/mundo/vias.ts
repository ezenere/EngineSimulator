// O que corre ao longo da via: a linha férrea (lastro, trilhos, dormentes perto de você), a catenária (postes, braços,
// fio de contato e mensageiro), a linha de telégrafo das ferrovias a vapor, a rua (asfalto, pintura, meio-fio e
// calçada), cercas, postes de luz e o guarda-corpo de estrada. Tudo em (s, m) de lugar.ts, em prismas, faixas e
// instâncias.
import * as THREE from 'three';
import type { Lugar } from '../lugar';
import { fosco, pintura, faixa, prisma, repetir, type Inst } from './geo';

export const BITOLA = 0.7175;
/** o trecho de dormentes desenhado perto de você (o InstancedMesh anda junto: recentrar em cena3d.ts) */
export interface Dormentes { im: THREE.InstancedMesh; mv: number; s0: number; s1: number; z: number; raio: number }
export const DORMENTES_RAIO = 150;

/** uma linha férrea em m = mv, de s0 a s1: lastro, trilhos e os dormentes (posicionados depois, perto de quem olha) */
export function linhaFerrea(G: THREE.Group, lg: Lugar, s0: number, s1: number, passo: number, mv: number, lastro: THREE.Material, dormentes: Dormentes[], z0 = 0, raio = DORMENTES_RAIO) {
  G.add(prisma(lg, s0, s1, passo, [[mv - 2.4, z0], [mv - 1.6, z0 + 0.3], [mv + 1.6, z0 + 0.3], [mv + 2.4, z0]], lastro, false));
  const trilho = fosco(0x9a9fa6);
  for (const yo of [-BITOLA, BITOLA]) G.add(prisma(lg, s0, s1, passo, [[mv + yo - 0.035, z0 + 0.46], [mv + yo + 0.035, z0 + 0.46], [mv + yo + 0.035, z0 + 0.31], [mv + yo - 0.035, z0 + 0.31]], trilho, false));
  const dorm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.25, 2.6, 0.16), fosco(0x6b5f52), Math.ceil((2 * raio) / 0.6) + 1);
  dorm.receiveShadow = true;
  dormentes.push({ im: dorm, mv, s0, s1, z: z0 + 0.38, raio });
  G.add(dorm);
}

/**
 * Fios ao longo da via (catenária, telégrafo, rede elétrica, arame de cerca) como linhas de um pixel: um fio de 2 cm
 * desenhado como sólido some em pontilhado a 20 m; a linha fica contínua a qualquer distância. Todos num desenho só.
 */
export function fios(G: THREE.Group, lg: Lugar, s0: number, s1: number, l: readonly { m: number; z: number }[], cor = 0x3a3d42) {
  const reta = lg.mundo(0, 0, 0)[1] === 0 && lg.mundo(100, 0, 0)[1] === 0, passo = reta ? 250 : 5;
  const pos: number[] = [], a: [number, number, number] = [0, 0, 0], b: [number, number, number] = [0, 0, 0];
  const n = Math.max(1, Math.ceil((s1 - s0) / passo));
  for (const f of l) for (let i = 0; i < n; i++) {
    lg.mundo(s0 + ((s1 - s0) * i) / n, f.m, f.z, a); lg.mundo(s0 + ((s1 - s0) * (i + 1)) / n, f.m, f.z, b);
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  G.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: cor })));
}

/**
 * Catenária: postes de um lado (em mPoste) a cada `vao` m, um braço até além da via mais longe, o fio de contato na
 * altura do pantógrafo em cada via e o mensageiro 1,1 m acima dele. `pular`: trechos sem poste (o ponto de chegada).
 */
export function catenaria(G: THREE.Group, lg: Lugar, s0: number, s1: number, vias: readonly number[], zFio: number, mPoste: number, vao = 60, pular: (s: number) => boolean = () => false, postes = true) {
  const aco = fosco(0x7d838a), fio = fosco(0x4a4f55);
  fios(G, lg, s0, s1, vias.flatMap((m) => [{ m, z: zFio }, { m, z: zFio + 1.1 }]), 0x34373b);
  if (!postes) return;
  const mMin = Math.min(...vias, mPoste), mMax = Math.max(...vias, mPoste), larg = mMax - mMin + 0.6;
  const ps: Inst[] = [], bracos: Inst[] = [], pendurais: Inst[] = [];
  const w: [number, number, number] = [0, 0, 0];
  for (let s = Math.ceil(s0 / vao) * vao; s <= s1; s += vao) {
    if (pular(s)) continue;
    const r = lg.rumoVia(s);
    ps.push({ pos: lg.mundo(s, mPoste, (zFio + 1.6) / 2, w).slice(), rumo: r, esc: [1, 1, zFio + 1.6] });
    bracos.push({ pos: lg.mundo(s, (mMin + mMax) / 2, zFio + 1.4, w).slice(), rumo: r, esc: [1, larg, 1] });
    for (const mv of vias) pendurais.push({ pos: lg.mundo(s, mv, zFio + 0.7, w).slice(), rumo: r, esc: [1, 1, 1.4] });
  }
  G.add(repetir(new THREE.BoxGeometry(0.32, 0.32, 1), aco, ps), repetir(new THREE.BoxGeometry(0.12, 1, 0.16), aco, bracos), repetir(new THREE.BoxGeometry(0.05, 0.05, 1), fio, pendurais));
}

/** linha de telégrafo ao lado da ferrovia (vapor): postes de madeira com a cruzeta e quatro fios */
export function telegrafo(G: THREE.Group, lg: Lugar, s0: number, s1: number, m: number, pular: (s: number) => boolean = () => false) {
  const madeira = fosco(0x6a5038);
  const ps: Inst[] = [], cz: Inst[] = [], w: [number, number, number] = [0, 0, 0];
  for (let s = Math.ceil(s0 / 50) * 50; s <= s1; s += 50) {
    if (pular(s)) continue;
    const r = lg.rumoVia(s);
    ps.push({ pos: lg.mundo(s, m, 3.6, w).slice(), rumo: r }); cz.push({ pos: lg.mundo(s, m, 6.7, w).slice(), rumo: r });
  }
  G.add(repetir(new THREE.CylinderGeometry(0.11, 0.13, 7.2, 6).rotateX(Math.PI / 2), madeira, ps), repetir(new THREE.BoxGeometry(0.12, 1.7, 0.12), madeira, cz));
  fios(G, lg, s0, s1, [-0.7, -0.25, 0.25, 0.7].map((d) => ({ m: m + d, z: 6.8 })));
}

/** cerca de postes com fios (ou tela, `tela`) de s0 a s1 em m, altura h */
export function cerca(G: THREE.Group, lg: Lugar, s0: number, s1: number, m: number, h = 1.3, passo = 3, cor = 0x8a7a62, nFios = 3, tela = false) {
  const mat = fosco(cor), ps: Inst[] = [], w: [number, number, number] = [0, 0, 0];
  for (let s = s0; s <= s1; s += passo) ps.push({ pos: lg.mundo(s, m, h / 2, w).slice(), rumo: lg.rumoVia(s) });
  G.add(repetir(new THREE.BoxGeometry(tela ? 0.06 : 0.1, tela ? 0.06 : 0.1, h), mat, ps));
  // (a de tela ganha o tubo de cima, sólido; os arames são linhas)
  if (tela) { const reta = lg.mundo(0, 0, 0)[1] === 0 && lg.mundo(100, 0, 0)[1] === 0; G.add(prisma(lg, s0, s1, reta ? 100 : 5, [[m - 0.03, h], [m + 0.03, h], [m + 0.03, h - 0.06], [m - 0.03, h - 0.06]], mat, false)); }
  fios(G, lg, s0, s1, Array.from({ length: nFios }, (_, i) => ({ m, z: (h * (i + 1)) / (nFios + (tela ? 1 : 0)) - 0.04 })), tela ? 0x7d838a : 0x5b5f63);
}

/** guarda-corpo de estrada (lâmina de aço em postes) */
export function defensa(G: THREE.Group, lg: Lugar, s0: number, s1: number, m: number, lado: 1 | -1) {
  const aco = fosco(0xa9adb2), ps: Inst[] = [], w: [number, number, number] = [0, 0, 0];
  for (let s = s0; s <= s1; s += 4) ps.push({ pos: lg.mundo(s, m + lado * 0.15, 0.4, w).slice(), rumo: lg.rumoVia(s) });
  G.add(repetir(new THREE.BoxGeometry(0.12, 0.12, 0.8), fosco(0x6b6e73), ps));
  const reta = lg.mundo(0, 0, 0)[1] === 0 && lg.mundo(100, 0, 0)[1] === 0;
  G.add(prisma(lg, s0, s1, reta ? 100 : 5, [[m - 0.05, 0.85], [m + 0.05, 0.85], [m + 0.05, 0.55], [m - 0.05, 0.55]], aco, true));
}

/** postes de luz de rua: haste, braço para o lado da via e a luminária */
export function postesDeLuz(G: THREE.Group, lg: Lugar, l: readonly { s: number; m: number; lado: 1 | -1 }[], alt = 8) {
  const aco = fosco(0x7d838a), lum = fosco(0xf4efd2, { emissive: 0x6a6450 });
  const hs: Inst[] = [], bs: Inst[] = [], ls: Inst[] = [], w: [number, number, number] = [0, 0, 0];
  for (const p of l) {
    const r = lg.rumoVia(p.s);
    hs.push({ pos: lg.mundo(p.s, p.m, alt / 2, w).slice(), rumo: r });
    bs.push({ pos: lg.mundo(p.s, p.m - p.lado * 0.9, alt - 0.1, w).slice(), rumo: r });
    ls.push({ pos: lg.mundo(p.s, p.m - p.lado * 1.7, alt - 0.25, w).slice(), rumo: r });
  }
  G.add(repetir(new THREE.CylinderGeometry(0.07, 0.11, alt, 6).rotateX(Math.PI / 2), aco, hs), repetir(new THREE.BoxGeometry(0.08, 1.9, 0.08), aco, bs), repetir(new THREE.BoxGeometry(0.35, 0.7, 0.15), lum, ls));
}

/** poste de rede elétrica (madeira ou concreto) com a cruzeta, e os fios entre eles */
export function redeEletrica(G: THREE.Group, lg: Lugar, s0: number, s1: number, m: number, vao = 35, pular: (s: number) => boolean = () => false) {
  const conc = fosco(0xa7a49c), ps: Inst[] = [], cz: Inst[] = [], w: [number, number, number] = [0, 0, 0];
  for (let s = Math.ceil(s0 / vao) * vao; s <= s1; s += vao) {
    if (pular(s)) continue;
    const r = lg.rumoVia(s);
    ps.push({ pos: lg.mundo(s, m, 4.75, w).slice(), rumo: r }); cz.push({ pos: lg.mundo(s, m, 8.9, w).slice(), rumo: r });
  }
  G.add(repetir(new THREE.CylinderGeometry(0.1, 0.16, 9.5, 6).rotateX(Math.PI / 2), conc, ps), repetir(new THREE.BoxGeometry(0.1, 1.9, 0.12), conc, cz));
  fios(G, lg, s0, s1, [-0.8, 0, 0.8].map((d) => ({ m: m + d, z: 9.0 })), 0x2f3236);
}

/** asfalto entre m0 e m1, com a pintura: linha central dupla amarela em mc e bordas brancas (opcionais) */
export function asfalto(G: THREE.Group, lg: Lugar, s0: number, s1: number, passo: number, m0: number, m1: number, pint: { centro?: number; bordas?: number[]; tracejado?: number[] } = {}) {
  G.add(faixa(lg, s0, s1, passo, m0, m1, 0, 0, pintura(0x46494e, 1)));
  const amarelo = pintura(0xe2b33a, 2), branco = pintura(0xe8e6df, 2);
  if (pint.centro != null) for (const d of [-0.12, 0.12]) G.add(faixa(lg, s0, s1, passo, pint.centro + d - 0.06, pint.centro + d + 0.06, 0, 0, amarelo));
  for (const b of pint.bordas ?? []) G.add(faixa(lg, s0, s1, passo, b - 0.08, b + 0.08, 0, 0, branco));
  // tracejados: retângulos curtos num InstancedMesh
  if (pint.tracejado?.length) {
    const ps: Inst[] = [], w: [number, number, number] = [0, 0, 0];
    for (const mt of pint.tracejado) for (let s = Math.ceil(s0 / 12) * 12; s < s1; s += 12) ps.push({ pos: lg.mundo(s + 2, mt, 0.005, w).slice(), rumo: lg.rumoVia(s) });
    const geo = new THREE.PlaneGeometry(4, 0.14);
    G.add(repetir(geo, branco, ps));
  }
}

/** calçada com meio-fio: de m0 (o meio-fio, do lado da rua) a m1, na altura h; o meio-fio de concreto mais claro */
export function calcada(G: THREE.Group, lg: Lugar, s0: number, s1: number, passo: number, m0: number, m1: number, h: number) {
  const dir = Math.sign(m1 - m0);
  G.add(prisma(lg, s0, s1, passo, dir > 0 ? [[m0, 0], [m0, h], [m1, h], [m1, 0]] : [[m1, 0], [m1, h], [m0, h], [m0, 0]], fosco(0xbdb8ae), false));
  G.add(faixa(lg, s0, s1, passo, m0, m0 + dir * 0.18, h, h, pintura(0xd9d5cc, 1)));
}
