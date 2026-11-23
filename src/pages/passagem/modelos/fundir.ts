// Junta as peças de um modelo numa malha só: cada caixa, perfil e torno vira triângulos soltos com a cor dela nos
// vértices, no referencial da raiz. Um segmento de trem passa de dezenas de chamadas de desenho para uma (o WebGL em
// software e o celular pagam por chamada). O que mexe (rodas, pás, bielas) fica de fora e segue como objeto próprio.
import * as THREE from 'three';

/** material de cor nos vértices, difuso e plano, para todas as malhas fundidas (um só programa de sombreamento) */
let MAT: THREE.MeshLambertMaterial | null = null;
export const materialFundido = () => (MAT ??= new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));

const cor = new THREE.Color(), m4 = new THREE.Matrix4(), mi = new THREE.Matrix4(), v = new THREE.Vector3();

/** triângulos de uma geometria (com ou sem índice) levados pela matriz, com a cor dada, acrescentados às listas */
function juntar(geo: THREE.BufferGeometry, mat: THREE.Matrix4, c: THREE.Color, pos: number[], cores: number[]) {
  const p = geo.attributes.position as THREE.BufferAttribute, idx = geo.index;
  const n = idx ? idx.count : p.count;
  // (matriz de determinante negativo espelha: a ordem dos vértices inverte para a face continuar olhando para fora)
  const espelha = mat.determinant() < 0;
  for (let t = 0; t + 2 < n; t += 3) {
    const tri = espelha ? [t, t + 2, t + 1] : [t, t + 1, t + 2];
    for (const k of tri) {
      const i = idx ? idx.getX(k) : k;
      v.fromBufferAttribute(p, i).applyMatrix4(mat);
      pos.push(v.x, v.y, v.z); cores.push(c.r, c.g, c.b);
    }
  }
}

/**
 * Funde tudo o que está debaixo de `raiz` (menos os objetos de `fora` e o que está debaixo deles) numa geometria de
 * cores nos vértices, no referencial da raiz.
 */
export function fundirGeometria(raiz: THREE.Object3D, fora: ReadonlySet<THREE.Object3D> = new Set()) {
  raiz.updateMatrixWorld(true);
  const inv = raiz.matrixWorld.clone().invert();
  const pos: number[] = [], cores: number[] = [];
  const andar = (o: THREE.Object3D) => {
    if (fora.has(o)) return;
    if (o instanceof THREE.InstancedMesh) {
      const base = (o.material as THREE.MeshLambertMaterial).color ?? cor.set(0xffffff);
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, mi);
        m4.multiplyMatrices(inv, o.matrixWorld).multiply(mi);
        if (o.instanceColor) o.getColorAt(i, cor); else cor.copy(base);
        juntar(o.geometry, m4, cor, pos, cores);
      }
    } else if ((o as THREE.Mesh).isMesh) {
      const me = o as THREE.Mesh, mat = me.material as THREE.MeshLambertMaterial;
      cor.copy(mat.color ?? cor.set(0xffffff));
      m4.multiplyMatrices(inv, me.matrixWorld);
      juntar(me.geometry, m4, cor, pos, cores);
    }
    for (const f of o.children) andar(f);
  };
  andar(raiz);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos.length ? pos : [0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cores.length ? cores : [0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** a malha fundida de `raiz` (sombra lançada e recebida) */
export function fundir(raiz: THREE.Object3D, fora: ReadonlySet<THREE.Object3D> = new Set()) {
  const m = new THREE.Mesh(fundirGeometria(raiz, fora), materialFundido());
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** libera as geometrias e os materiais de um grupo de peças que já foi fundido (as cópias originais) */
export function soltarPecas(raiz: THREE.Object3D) {
  raiz.traverse((o) => {
    const me = o as THREE.Mesh;
    if (me.geometry) me.geometry.dispose();
    if (o instanceof THREE.InstancedMesh) o.dispose();
    const mat = me.material as THREE.Material | undefined;
    if (mat && mat !== MAT) mat.dispose();
  });
}
