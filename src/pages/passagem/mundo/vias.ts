// O que corre ao longo da via: a linha férrea (lastro, trilhos, dormentes perto de você), a catenária (postes, braços,
// fio de contato e mensageiro), a linha de telégrafo das ferrovias a vapor, a rua (asfalto, pintura, meio-fio e
// calçada), cercas, postes de luz e o guarda-corpo de estrada. Tudo em (s, m) de lugar.ts, em prismas, faixas e
// instâncias.
import * as THREE from 'three';
import type { Lugar } from '../lugar';
import { fosco, pintura, faixa, prisma, repetir, type Inst } from './geo';
import { leveCirculo, leveLinha } from './leves';

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
 * `flecha`: o quanto o fio cai no meio do vão entre dois postes (a cada `vao` m, alinhados em s = k·vao), em parábola,
 * até 700 m de quem chega (mais longe, reto): o fio que cai entre os postes é o que faz um fio parecer fio, e não uma
 * régua riscada no céu.
 */
export function fios(G: THREE.Group, lg: Lugar, s0: number, s1: number, l: readonly { m: number; z: number; flecha?: number; vao?: number }[], cor = 0x3a3d42) {
  const reta = lg.mundo(0, 0, 0)[1] === 0 && lg.mundo(100, 0, 0)[1] === 0, passo = reta ? 250 : 5;
  const pos: number[] = [], a: [number, number, number] = [0, 0, 0], b: [number, number, number] = [0, 0, 0];
  const seg = (sa: number, sb: number, m: number, za: number, zb: number) => { lg.mundo(sa, m, za, a); lg.mundo(sb, m, zb, b); pos.push(a[0], a[1], a[2], b[0], b[1], b[2]); };
  for (const f of l) {
    // os vãos perto (com a flecha), o resto reto
    const vao = f.vao ?? 50, perto = f.flecha ? [Math.max(s0, Math.ceil(-700 / vao) * vao), Math.min(s1, Math.floor(700 / vao) * vao)] : [0, 0];
    const retos: [number, number][] = f.flecha && perto[1] > perto[0] ? [[s0, perto[0]], [perto[1], s1]] : [[s0, s1]];
    for (const [ra, rb] of retos) { const n = Math.max(1, Math.ceil((rb - ra) / passo)); if (rb > ra) for (let i = 0; i < n; i++) seg(ra + ((rb - ra) * i) / n, ra + ((rb - ra) * (i + 1)) / n, f.m, f.z, f.z); }
    if (!f.flecha || perto[1] <= perto[0]) continue;
    for (let sv = perto[0]; sv < perto[1]; sv += vao) for (let k = 0; k < 8; k++) {
      const t0 = k / 8, t1 = (k + 1) / 8, zq = (t: number) => f.z - f.flecha! * 4 * t * (1 - t);
      seg(sv + vao * t0, sv + vao * t1, f.m, zq(t0), zq(t1));
    }
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
  // (o fio de contato fica reto, preso pelos pendurais; o mensageiro, em cima, cai entre os postes)
  fios(G, lg, s0, s1, vias.flatMap((m) => [{ m, z: zFio }, { m, z: zFio + 1.1, flecha: 0.7, vao }]), 0x3d4146);
  if (!postes) return;
  const mMin = Math.min(...vias, mPoste), mMax = Math.max(...vias, mPoste), larg = mMax - mMin + 0.6;
  const ps: Inst[] = [], bracos: Inst[] = [], pendurais: Inst[] = [];
  const w: [number, number, number] = [0, 0, 0];
  for (let s = Math.ceil(s0 / vao) * vao; s <= s1; s += vao) {
    if (pular(s)) continue;
    const r = lg.rumoVia(s);
    ps.push({ pos: lg.mundo(s, mPoste, (zFio + 1.6) / 2, w).slice(), rumo: r, esc: [1, 1, zFio + 1.6] });
    leveCirculo(s, mPoste, 0.2, zFio + 1.6);
    bracos.push({ pos: lg.mundo(s, (mMin + mMax) / 2, zFio + 1.4, w).slice(), rumo: r, esc: [1, larg, 1] });
    for (const mv of vias) pendurais.push({ pos: lg.mundo(s, mv, zFio + 0.7, w).slice(), rumo: r, esc: [1, 1, 1.4] });
  }
  G.add(repetir(new THREE.BoxGeometry(0.32, 0.32, 1), aco, ps), repetir(new THREE.BoxGeometry(0.12, 1, 0.16), aco, bracos), repetir(new THREE.BoxGeometry(0.05, 0.05, 1), fio, pendurais));
}

/**
 * linha de telégrafo ao lado da ferrovia (vapor): postes de madeira com a cruzeta e dois fios nos isoladores das pontas,
 * caindo entre os postes, num cinza mais claro que o da catenária (o fio de cobre fino, de longe, quase some no céu)
 */
export function telegrafo(G: THREE.Group, lg: Lugar, s0: number, s1: number, m: number, pular: (s: number) => boolean = () => false) {
  const madeira = fosco(0x6a5038);
  const ps: Inst[] = [], cz: Inst[] = [], w: [number, number, number] = [0, 0, 0];
  for (let s = Math.ceil(s0 / 50) * 50; s <= s1; s += 50) {
    if (pular(s)) continue;
    const r = lg.rumoVia(s);
    ps.push({ pos: lg.mundo(s, m, 3.6, w).slice(), rumo: r }); cz.push({ pos: lg.mundo(s, m, 6.7, w).slice(), rumo: r });
    leveCirculo(s, m, 0.14, 7.2);
  }
  G.add(repetir(new THREE.CylinderGeometry(0.11, 0.13, 7.2, 6).rotateX(Math.PI / 2), madeira, ps), repetir(new THREE.BoxGeometry(0.12, 1.7, 0.12), madeira, cz));
  const iso: Inst[] = [];
  for (let s = Math.ceil(s0 / 50) * 50; s <= s1; s += 50) if (!pular(s)) for (const d of [-0.7, 0.7]) iso.push({ pos: lg.mundo(s, m + d, 6.82, w).slice(), rumo: lg.rumoVia(s) });
  G.add(repetir(new THREE.CylinderGeometry(0.04, 0.05, 0.14, 6).rotateX(Math.PI / 2), fosco(0x5b8a6a), iso));
  fios(G, lg, s0, s1, [-0.7, 0.7].map((d) => ({ m: m + d, z: 6.88, flecha: 0.55, vao: 50 })), 0x6f757b);
}

/**
 * cerca de postes com fios (ou tela, `tela`) de s0 a s1 em m, altura h; `vao`: a porteira (de s a s), por onde se passa
 * para o lado da via; `z0`: a altura do chão em que ela está (o alto do corte)
 */
export function cerca(G: THREE.Group, lg: Lugar, s0: number, s1: number, m: number, h = 1.3, passo = 3, cor = 0x8a7a62, nFios = 3, tela = false, vao?: [number, number], z0 = 0) {
  if (z0 >= 0) leveLinha(s0, s1, m, h, z0, vao);
  if (vao) { cerca(G, lg, s0, vao[0], m, h, passo, cor, nFios, tela, undefined, -1); cerca(G, lg, vao[1], s1, m, h, passo, cor, nFios, tela, undefined, -1); return; }
  const mat = fosco(cor), ps: Inst[] = [], w: [number, number, number] = [0, 0, 0];
  for (let s = s0; s <= s1; s += passo) ps.push({ pos: lg.mundo(s, m, h / 2, w).slice(), rumo: lg.rumoVia(s) });
  G.add(repetir(new THREE.BoxGeometry(tela ? 0.06 : 0.1, tela ? 0.06 : 0.1, h), mat, ps));
  // (a de tela ganha o tubo de cima, sólido; os arames são linhas)
  if (tela) { const reta = lg.mundo(0, 0, 0)[1] === 0 && lg.mundo(100, 0, 0)[1] === 0; G.add(prisma(lg, s0, s1, reta ? 100 : 5, [[m - 0.03, h], [m + 0.03, h], [m + 0.03, h - 0.06], [m - 0.03, h - 0.06]], mat, false)); }
  fios(G, lg, s0, s1, Array.from({ length: nFios }, (_, i) => ({ m, z: (h * (i + 1)) / (nFios + (tela ? 1 : 0)) - 0.04 })), tela ? 0x7d838a : 0x5b5f63);
}

/** guarda-corpo de estrada (lâmina de aço em postes) */
export function defensa(G: THREE.Group, lg: Lugar, s0: number, s1: number, m: number, lado: 1 | -1, vao?: [number, number]) {
  leveLinha(s0, s1, m, 0.85, 0, vao);
  if (vao) { defensa(G, lg, s0, vao[0], m, lado); defensa(G, lg, vao[1], s1, m, lado); return; }
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
    leveCirculo(p.s, p.m, 0.14, alt);
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
    leveCirculo(s, m, 0.18, 9.5);
  }
  G.add(repetir(new THREE.CylinderGeometry(0.1, 0.16, 9.5, 6).rotateX(Math.PI / 2), conc, ps), repetir(new THREE.BoxGeometry(0.1, 1.9, 0.12), conc, cz));
  fios(G, lg, s0, s1, [-0.8, 0, 0.8].map((d) => ({ m: m + d, z: 9.0, flecha: 0.5, vao })), 0x3a3e43);
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
