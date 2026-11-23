// Geometria dos cenários da Passagem ao longo da via (coordenadas s, m de lugar.ts levadas ao mundo): faixas, prismas,
// quadriláteros soltos, peças repetidas num InstancedMesh, terreno por grade de alturas. Tudo opaco e de sombreamento
// plano; o que fica deitado no chão (asfalto, faixas pintadas, canteiros) desenha à frente dele sem brigar pela
// profundidade (polygonOffset), em vez de subir uns centímetros que de longe se perdem.
import * as THREE from 'three';
import type { Lugar } from '../lugar';

/**
 * Material difuso (Lambert) com sombreamento plano: o "low poly" não pede brilho, e o Lambert custa bem menos que o PBR
 * no WebGL em software e nos celulares (o quadro pesa no olho, não no som).
 */
export const fosco = (cor: number, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color: cor, flatShading: true, ...extra });
/** material de uma camada deitada no chão: desenha por cima do chão sem disputar a profundidade; `nivel` empilha camadas */
export const pintura = (cor: number, nivel = 1) => fosco(cor, { polygonOffset: true, polygonOffsetFactor: -nivel, polygonOffsetUnits: -4 * nivel });

/** as mesmas peças repetidas num InstancedMesh (uma chamada de desenho), cada uma com posição, rumo, escala e cor */
export interface Inst { pos: readonly number[]; rumo?: number; esc?: readonly number[]; cor?: number; incl?: number; arf?: number }
export function repetir(geo: THREE.BufferGeometry, mat: THREE.Material, pontos: readonly Inst[]) {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, pontos.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p3 = new THREE.Vector3(), sc = new THREE.Vector3(), cor = new THREE.Color();
  const comCor = pontos.some((p) => p.cor != null);
  pontos.forEach((pt, i) => {
    e.set(pt.incl ?? 0, pt.arf ?? 0, pt.rumo ?? 0, 'ZYX'); q.setFromEuler(e); p3.set(pt.pos[0], pt.pos[1], pt.pos[2]);
    sc.set(pt.esc?.[0] ?? 1, pt.esc?.[1] ?? 1, pt.esc?.[2] ?? 1);
    im.setMatrixAt(i, m.compose(p3, q, sc));
    if (comCor) im.setColorAt(i, cor.set(pt.cor ?? 0xffffff));
  });
  im.count = pontos.length;
  im.computeBoundingSphere();
  return im;
}

/** faixa ao longo da via entre as abscissas s0 e s1: de (m0, altura z0) a (m1, z1), opaca */
export function faixa(lg: Lugar, s0: number, s1: number, passo: number, m0: number, m1: number, z0: number, z1: number, mat: THREE.Material) {
  const pos: number[] = [], idx: number[] = [], w: [number, number, number] = [0, 0, 0];
  const n = Math.max(1, Math.ceil((s1 - s0) / passo));
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n;
    lg.mundo(s, m0, z0, w); pos.push(w[0], w[1], w[2]);
    lg.mundo(s, m1, z1, w); pos.push(w[0], w[1], w[2]);
    if (i < n) { const a = 2 * i; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  // (a faixa é vista dos dois lados: a ordem dos vértices depende do sentido da via)
  if (mat instanceof THREE.MeshLambertMaterial) mat.side = THREE.DoubleSide;
  return new THREE.Mesh(g, mat);
}

/**
 * Prisma ao longo da via: a seção [m, z] (polígono, no sentido anti-horário visto de quem anda para s crescente)
 * extrudada de s0 a s1; `tampas` fecha as pontas; `aberta` não liga o último vértice ao primeiro (o túnel).
 */
export function prisma(lg: Lugar, s0: number, s1: number, passo: number, secao: readonly (readonly [number, number])[], mat: THREE.Material, tampas: boolean, aberta = false) {
  const pos: number[] = [], idx: number[] = [], w: [number, number, number] = [0, 0, 0];
  const n = Math.max(1, Math.ceil((s1 - s0) / passo)), K = secao.length;
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n;
    for (const [m, z] of secao) { lg.mundo(s, m, z, w); pos.push(w[0], w[1], w[2]); }
  }
  // A seção fechada (um sólido) fica com as faces para fora e só a frente é desenhada: a ordem dos vértices depende do
  // sentido da via e da volta, então ela é conferida aqui, pela normal da primeira face lateral contra o centro da seção
  // (as seções daqui são convexas). A aberta (as paredes do túnel) é vista dos dois lados.
  const P = (k: number) => new THREE.Vector3(pos[3 * k], pos[3 * k + 1], pos[3 * k + 2]);
  let vira = false, viraTampa0 = false, viraTampaN = false;
  if (!aberta && K >= 3) {
    const c0 = new THREE.Vector3(); for (let j = 0; j < K; j++) c0.add(P(j)); c0.multiplyScalar(1 / K);
    const a = P(0), b = P(1), c = P(K);
    const nrm = b.clone().sub(a).cross(c.clone().sub(a)), meio = a.clone().add(b).multiplyScalar(0.5).sub(c0);
    vira = nrm.dot(meio) < 0;
    if (tampas) {
      const cN = new THREE.Vector3(); for (let j = 0; j < K; j++) cN.add(P(n * K + j)); cN.multiplyScalar(1 / K);
      const fora0 = c0.clone().sub(cN), t0 = P(1).sub(P(0)).cross(P(2).sub(P(0)));
      viraTampa0 = t0.dot(fora0) < 0;
      const tN = P(n * K + 1).sub(P(n * K)).cross(P(n * K + 2).sub(P(n * K)));
      viraTampaN = tN.dot(fora0) > 0;
    }
  }
  const tri = (x: number, y: number, z: number, v: boolean) => (v ? idx.push(x, z, y) : idx.push(x, y, z));
  for (let i = 0; i < n; i++) for (let j = 0; j < (aberta ? K - 1 : K); j++) {
    const a = i * K + j, b = i * K + ((j + 1) % K), c = (i + 1) * K + j, d = (i + 1) * K + ((j + 1) % K);
    tri(a, b, c, vira); tri(b, d, c, vira);
  }
  if (tampas) for (const [i, v] of [[0, viraTampa0], [n, viraTampaN]] as const) for (let j = 1; j < K - 1; j++) tri(i * K, i * K + j, i * K + j + 1, v);
  // (geometria não indexada por face, para o sombreamento plano do "low poly")
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const ng = g.toNonIndexed(); ng.computeVertexNormals(); g.dispose();
  if (aberta && mat instanceof THREE.MeshLambertMaterial) mat.side = THREE.DoubleSide;
  return new THREE.Mesh(ng, mat);
}

/** malha montada por quadriláteros e triângulos dados em coordenadas da via ([s, m, z] nos cantos), num só desenho */
export class Malha {
  private pos: number[] = []; private w: [number, number, number] = [0, 0, 0];
  constructor(private lg: Lugar) {}
  quad(...c: [number, number, number][]) {
    const p = c.map(([s, m, z]) => [...this.lg.mundo(s, m, z, this.w)]);
    for (const i of c.length === 3 ? [0, 1, 2] : [0, 1, 2, 0, 2, 3]) this.pos.push(p[i][0], p[i][1], p[i][2]);
  }
  get vazia() { return this.pos.length === 0; }
  mesh(mat: THREE.Material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos.length ? this.pos : [0, 0, 0, 0, 0, 0, 0, 0, 0], 3)); g.computeVertexNormals();
    if (mat instanceof THREE.MeshLambertMaterial) mat.side = THREE.DoubleSide;
    return new THREE.Mesh(g, mat);
  }
}

/**
 * Terreno por grade de alturas em (s, m): `ss` e `ms` são as linhas da grade (com as quinas de propósito, para as
 * paredes verticais do emboque saírem retas), `alt(s, m)` a altura, `cor(z, s, m)` a cor do vértice. As células todas
 * em 0 não são desenhadas (lá fica o chão de baixo). Faces soltas, sombreamento plano.
 */
export function terreno(lg: Lugar, ss: readonly number[], ms: readonly number[], alt: (s: number, m: number) => number, cor: (z: number, s: number, m: number) => number, mat?: THREE.Material) {
  const S = ss.length, M = ms.length, z = new Float32Array(S * M), w: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < S; i++) for (let j = 0; j < M; j++) z[i * M + j] = alt(ss[i], ms[j]);
  const pos: number[] = [], cores: number[] = [], k = new THREE.Color();
  const v = (i: number, j: number, c: number) => { lg.mundo(ss[i], ms[j], z[i * M + j], w); pos.push(w[0], w[1], w[2]); k.set(c); cores.push(k.r, k.g, k.b); };
  for (let i = 0; i < S - 1; i++) for (let j = 0; j < M - 1; j++) {
    const a = z[i * M + j], b = z[(i + 1) * M + j], c = z[(i + 1) * M + j + 1], d = z[i * M + j + 1];
    if (Math.max(a, b, c, d) < 0.02 && Math.min(a, b, c, d) > -0.02) continue;
    // (uma cor por face: a da média das alturas, para o facetado do "low poly")
    const cf = cor((a + b + c + d) / 4, (ss[i] + ss[i + 1]) / 2, (ms[j] + ms[j + 1]) / 2);
    v(i, j, cf); v(i + 1, j, cf); v(i + 1, j + 1, cf); v(i, j, cf); v(i + 1, j + 1, cf); v(i, j + 1, cf);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos.length ? pos : [0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cores.length ? cores : [1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
  g.computeVertexNormals();
  const m = mat ?? new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  return new THREE.Mesh(g, m);
}

/** linhas de grade de a a b com o passo dado, mais as quinas pedidas (ordenadas, sem repetir) */
export function grade(a: number, b: number, passo: number, quinas: readonly number[] = []) {
  const l: number[] = [];
  for (let x = a; x < b; x += passo) l.push(x);
  l.push(b, ...quinas.filter((q) => q > a && q < b));
  return [...new Set(l.map((x) => Math.round(x * 1000) / 1000))].sort((x, y) => x - y);
}

/** libera geometrias e materiais de um grupo e o esvazia */
export function descartar(g: THREE.Object3D) {
  // (as texturas dos materiais são cópias, uma por material: vão junto; e as instâncias têm buffers próprios)
  const solta = (x: THREE.Material) => { (x as { map?: THREE.Texture | null }).map?.dispose(); x.dispose(); };
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    if (o instanceof THREE.InstancedMesh) o.dispose();
    const mat = (m as { material?: THREE.Material | THREE.Material[] }).material;
    if (Array.isArray(mat)) mat.forEach(solta); else if (mat) solta(mat);
  });
  if (g instanceof THREE.Scene) return;
  while (g.children.length) g.remove(g.children[0]);
}
