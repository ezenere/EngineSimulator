// Árvores, arbustos, retalhos de lavoura e os morros do horizonte. As árvores são instâncias (tronco e copa: duas
// chamadas de desenho por espécie, centenas de árvores), com a cor da copa sorteada entre três verdes; os morros são uma
// grade de alturas longe da via, que a neblina tinge de azul (a perspectiva do ar) e que tira o horizonte da reta.
import * as THREE from 'three';
import type { Lugar } from '../lugar';
import type { Via } from '../../../scene/trajetoria';
import { repetir, type Inst } from './geo';
import { sorteio } from './planta';
import { leveCirculo } from './leves';

export const VERDES = [0x4f7a3a, 0x5d8a40, 0x3f6b35, 0x6b8f45] as const;
const TRONCO = 0x6a5038;

/** uma árvore no lugar: (s, m), altura total, espécie */
export interface Arvore { s: number; m: number; h: number; tipo: 'copa' | 'pinheiro' | 'arbusto'; z?: number }

/** m: até onde (ao longo da via, de cada lado do ponto de chegada) há árvores; além disso, os morros e a neblina */
export const ALCANCE_ARVORES = 1400;
/** m: além desta distância do ponto de chegada a árvore é só a copa, mais simples, e não faz sombra */
const LONGE = 260;

let GEOS: { tronco: THREE.BufferGeometry; troncoLonge: THREE.BufferGeometry; copa: THREE.BufferGeometry; copaLonge: THREE.BufferGeometry; cone: THREE.BufferGeometry; coneLonge: THREE.BufferGeometry } | null = null;
function geos() {
  if (GEOS) return GEOS;
  // (as geometrias do three têm o eixo em y: deitadas para o z do mundo, com o pé em z = 0)
  const tronco = new THREE.CylinderGeometry(0.6, 1, 1, 5, 1, true); tronco.rotateX(Math.PI / 2); tronco.translate(0, 0, 0.5);
  const troncoLonge = new THREE.CylinderGeometry(0.6, 1, 1, 3, 1, true); troncoLonge.rotateX(Math.PI / 2); troncoLonge.translate(0, 0, 0.5);
  const copa = new THREE.IcosahedronGeometry(1, 0);
  const copaLonge = new THREE.OctahedronGeometry(1, 0);
  const cone = new THREE.ConeGeometry(1, 1, 7); cone.rotateX(Math.PI / 2); cone.translate(0, 0, 0.5);
  const coneLonge = new THREE.ConeGeometry(1, 1, 4, 1, true); coneLonge.rotateX(Math.PI / 2); coneLonge.translate(0, 0, 0.5);
  GEOS = { tronco, troncoLonge, copa, copaLonge, cone, coneLonge };
  return GEOS;
}

/**
 * As árvores em instâncias: tronco, copa redonda, pinheiro, arbusto. Perto do ponto de chegada (`centro`, em s e m),
 * inteiras e fazendo sombra; longe, o tronco de 3 lados e a copa num sólido de 8 faces, sem sombra.
 */
export function arvores(lg: Lugar, l: readonly Arvore[], semente = 7, centro: readonly [number, number] = [0, 0], zBase = 0): THREE.Group {
  const g = new THREE.Group(), sorte = sorteio(semente), G = geos();
  const troncos: Inst[] = [], copas: Inst[] = [], cones: Inst[] = [], troncosL: Inst[] = [], copasL: Inst[] = [], conesL: Inst[] = [];
  const w: [number, number, number] = [0, 0, 0];
  for (const a of l) {
    lg.mundo(a.s, a.m, 0, w);
    const longe = Math.hypot(a.s - centro[0], a.m - centro[1]) > LONGE;
    const z0 = a.z ?? 0, rumo = sorte() * 6.28, cor = VERDES[Math.floor(sorte() * VERDES.length)];
    // (o que segura o passo: o tronco; a moita, inteira)
    leveCirculo(a.s, a.m, a.tipo === 'arbusto' ? a.h * 0.32 : 0.14 + a.h * 0.018, a.h, zBase + z0);
    if (a.tipo === 'arbusto') { (longe ? copasL : copas).push({ pos: [w[0], w[1], z0 + a.h * 0.35], rumo, esc: [a.h * 0.7, a.h * 0.6, a.h * 0.55], cor }); continue; }
    const ht = a.tipo === 'pinheiro' ? a.h * 0.22 : a.h * 0.42, rt = 0.12 + a.h * 0.018;
    (longe ? troncosL : troncos).push({ pos: [w[0], w[1], z0], rumo, esc: [rt, rt, ht + (a.tipo === 'copa' ? a.h * 0.15 : 0)], cor: TRONCO });
    if (a.tipo === 'pinheiro') (longe ? conesL : cones).push({ pos: [w[0], w[1], z0 + ht], rumo, esc: [a.h * 0.24, a.h * 0.24, a.h - ht], cor: 0x3a5e34 });
    else { const r = (a.h - ht) * 0.55; (longe ? copasL : copas).push({ pos: [w[0], w[1], z0 + ht + r * 0.95], rumo, esc: [r * (0.9 + sorte() * 0.25), r * (0.9 + sorte() * 0.25), 1.05 * r], cor }); }
  }
  const mat = new THREE.MeshLambertMaterial({ flatShading: true });
  const perto = new THREE.Group(), deLonge = new THREE.Group();
  if (troncos.length) perto.add(repetir(G.tronco, mat, troncos));
  if (copas.length) perto.add(repetir(G.copa, mat, copas));
  if (cones.length) perto.add(repetir(G.cone, mat, cones));
  if (troncosL.length) deLonge.add(repetir(G.troncoLonge, mat, troncosL));
  if (copasL.length) deLonge.add(repetir(G.copaLonge, mat, copasL));
  if (conesL.length) deLonge.add(repetir(G.coneLonge, mat, conesL));
  perto.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
  deLonge.traverse((o) => { o.receiveShadow = true; });
  g.add(perto, deLonge);
  return g;
}

/**
 * Árvores espalhadas numa faixa ao longo da via (de s0 a s1, de m0 a m1, até ALCANCE_ARVORES do ponto de chegada), com
 * densidade por 100 m de via; `livre`: os trechos (s, m) onde não pode haver árvore (a via, as casas, o ponto de chegada).
 */
export function bosque(sorte: () => number, s0: number, s1: number, m0: number, m1: number, por100: number, tipos: Partial<Record<Arvore['tipo'], number>>, h: [number, number], livre: (s: number, m: number) => boolean = () => true): Arvore[] {
  const l: Arvore[] = [];
  s0 = Math.max(s0, -ALCANCE_ARVORES); s1 = Math.min(s1, ALCANCE_ARVORES);
  const n = Math.round((Math.max(0, s1 - s0) / 100) * por100);
  const pesos = Object.entries(tipos) as [Arvore['tipo'], number][], tot = pesos.reduce((a, [, p]) => a + p, 0);
  for (let i = 0; i < n; i++) {
    const s = s0 + sorte() * (s1 - s0), m = m0 + sorte() * (m1 - m0);
    if (!livre(s, m)) continue;
    let r = sorte() * tot, tipo: Arvore['tipo'] = pesos[0][0];
    for (const [t, p] of pesos) { r -= p; if (r <= 0) { tipo = t; break; } }
    l.push({ s, m, h: h[0] + sorte() * (h[1] - h[0]), tipo });
  }
  return l;
}

/** fileira de árvores ao longo da via, com o passo e a variação dados (até ALCANCE_ARVORES do ponto de chegada) */
export function alameda(sorte: () => number, s0: number, s1: number, m: number, passo: number, h: [number, number], tipo: Arvore['tipo'] = 'copa', livre: (s: number, m: number) => boolean = () => true): Arvore[] {
  const l: Arvore[] = [];
  s0 = Math.max(s0, -ALCANCE_ARVORES); s1 = Math.min(s1, ALCANCE_ARVORES);
  for (let s = s0 + sorte() * passo; s < s1; s += passo * (0.8 + sorte() * 0.4)) {
    const mm = m + (sorte() - 0.5) * 1.2;
    if (livre(s, mm)) l.push({ s, m: mm, h: h[0] + sorte() * (h[1] - h[0]), tipo });
  }
  return l;
}

/** retalhos de chão (lavouras, gramados, canteiros) num só desenho, cada um com a sua cor, por cima do chão */
export function retalhos(lg: Lugar, l: readonly { s0: number; s1: number; m0: number; m1: number; cor: number }[], nivel = 1, z = 0) {
  const pos: number[] = [], cores: number[] = [], k = new THREE.Color(), w: [number, number, number] = [0, 0, 0];
  for (const r of l) {
    k.set(r.cor);
    const passo = Math.max(4, (r.s1 - r.s0) / 8), n = Math.max(1, Math.ceil((r.s1 - r.s0) / passo));
    for (let i = 0; i < n; i++) {
      const a = r.s0 + ((r.s1 - r.s0) * i) / n, b = r.s0 + ((r.s1 - r.s0) * (i + 1)) / n;
      const q = [lg.mundo(a, r.m0, 0, [0, 0, 0]), lg.mundo(b, r.m0, 0, [0, 0, 0]), lg.mundo(b, r.m1, 0, [0, 0, 0]), lg.mundo(a, r.m1, 0, [0, 0, 0])];
      for (const j of [0, 1, 2, 0, 2, 3]) { pos.push(q[j][0], q[j][1], z); cores.push(k.r, k.g, k.b); }
    }
  }
  void w;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos.length ? pos : [0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cores.length ? cores : [0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -nivel, polygonOffsetUnits: -4 * nivel }));
  m.receiveShadow = true;
  return m;
}

/**
 * Os morros do horizonte, de `perto` m da via até uns 4 km, com a altura subindo de 0 (perto) até 60–230 m (longe):
 * na reta, duas faixas ao longo dela (uma de cada lado); na volta, um anel em torno dela. Fora do caminho do corpo e do
 * alcance de quem anda.
 */
export function morros(via: Via, perto = 650, semente = 3, cor = 0x56703f) {
  const sorte = sorteio(semente), f = [sorte() * 6, sorte() * 6, sorte() * 6, sorte() * 6];
  const alt = (x: number, y: number, d: number) => {
    const rampa = Math.min(1, Math.max(0, (d - perto) / 900));
    const n = 0.55 + 0.3 * Math.sin(x / 520 + f[0]) * Math.cos(y / 610 + f[1]) + 0.22 * Math.sin(x / 190 + y / 260 + f[2]) + 0.12 * Math.cos(x / 95 - y / 130 + f[3]);
    return Math.max(0, rampa * rampa * (230 * n));
  };
  const pos: number[] = [], cores: number[] = [], k = new THREE.Color(), base = new THREE.Color(cor), alto = new THREE.Color(0x6f7d52), escuro = new THREE.Color(0x45603a);
  const quad = (p: number[][]) => {
    const zm = (p[0][2] + p[1][2] + p[2][2] + p[3][2]) / 4;
    if (zm < 0.5) return;
    k.copy(base).lerp(zm > 120 ? alto : escuro, Math.min(1, Math.abs(zm - 90) / 140));
    for (const j of [0, 1, 2, 0, 2, 3]) { pos.push(p[j][0], p[j][1], p[j][2]); cores.push(k.r, k.g, k.b); }
  };
  if (via.tipo === 'reta') {
    const X = Math.max(via.comp / 2, 2500) + 2500, dx = 260, dy = 280;
    for (const sg of [-1, 1]) for (let x = -X; x < X; x += dx) for (let d = perto; d < perto + 3600; d += dy) {
      const P = (xx: number, dd: number) => [xx, sg * dd, alt(xx, sg * dd, dd)];
      quad(sg > 0 ? [P(x, d), P(x + dx, d), P(x + dx, d + dy), P(x, d + dy)] : [P(x, d), P(x, d + dy), P(x + dx, d + dy), P(x + dx, d)]);
    }
  } else {
    const R0 = via.ls / 2 + via.R + perto, N = 96;
    for (let i = 0; i < N; i++) for (let d = 0; d < 3600; d += 280) {
      const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
      const P = (a: number, dd: number) => { const r = R0 + dd, x = r * Math.cos(a), y = r * Math.sin(a); return [x, y, alt(x, y, perto + dd)]; };
      quad([P(a0, d), P(a1, d), P(a1, d + 280), P(a0, d + 280)]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos.length ? pos : [0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cores.length ? cores : [0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
}
