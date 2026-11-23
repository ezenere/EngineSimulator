// Peças dos modelos low poly da Passagem (three.js). Tudo no referencial do corpo: x para a frente, y para a esquerda,
// z para cima, em metros, com o chão em z = 0. Sombreamento plano, materiais difusos (Lambert) e opacos: os vidros são
// uma cor escura, nada translúcido. Cada modelo junta caixas, perfis laterais extrudados (a silhueta de lado é o que faz
// um carro parecer carro) e sólidos de revolução (fuselagens, caldeiras); as rodas e as pás ficam registradas para girar.
import * as THREE from 'three';

/** paleta curta, a mesma dos cenários */
export const COR = {
  vidro: 0x1d2733, pneu: 0x1f2124, aro: 0x9aa0a6, preto: 0x2a2d31, grafite: 0x3f444b, cinza: 0x8f949a, claro: 0xd7d9dc,
  branco: 0xeef0f2, farol: 0xf4efd2, lanterna: 0xb3261e, laranja: 0xe08a2a, amarelo: 0xe2b33a, vermelho: 0xb8322a,
  azul: 0x2f5aa8, azulEsc: 0x22406e, verde: 0x3f6b46, oliva: 0x5b6338, creme: 0xe6dcc0, marrom: 0x6e4a32, prata: 0xb9bcc0,
} as const;

export type Eixo = 'x' | 'y' | 'z';

/** material difuso, plano por padrão */
export const mat = (cor: number, plano = true) => new THREE.MeshLambertMaterial({ color: cor, flatShading: plano });

/** o que um modelo entrega: a malha por segmento do corpo e o que gira */
export interface Modelo {
  /** um grupo por segmento do corpo, no referencial do segmento (x = 0 no centro dele) */
  segmentos: THREE.Group[];
  /** rodas: o objeto gira em torno do próprio y local à razão v/r */
  rodas: { o: THREE.Object3D; r: number }[];
  /** pás e hélices: giram em torno do z local, a uma fração `k` da rotação (estroboscópico) */
  giros: { o: THREE.Object3D; k: number; fonte: 'rotor' | 'cauda' | 'helice' | 'drone' }[];
  /** chamado a cada quadro com a distância andada (m): as bielas da locomotiva a vapor seguem as rodas */
  animar?: (distancia: number) => void;
  /** objetos que o `animar` mexe (ficam de fora da malha fundida do segmento) */
  moveis?: THREE.Object3D[];
}

/** construtor de um grupo de peças com materiais reaproveitados por cor */
export class Pecas {
  g = new THREE.Group();
  private mats = new Map<string, THREE.Material>();
  m(cor: number, plano = true) {
    const k = `${cor}|${plano}`;
    let x = this.mats.get(k);
    if (!x) { x = mat(cor, plano); this.mats.set(k, x); }
    return x;
  }
  add<T extends THREE.Object3D>(o: T, pai: THREE.Object3D = this.g): T { pai.add(o); return o; }

  /** caixa de comprimento l (x), largura w (y), altura h (z), com o centro em (x, y, z) */
  caixa(l: number, w: number, h: number, x: number, y: number, z: number, cor: number, pai?: THREE.Object3D) {
    const o = new THREE.Mesh(new THREE.BoxGeometry(l, w, h), this.m(cor));
    o.position.set(x, y, z);
    return this.add(o, pai);
  }
  /** cilindro de raio r e comprimento c ao longo do eixo dado, centro em (x, y, z) */
  cil(r: number, c: number, eixo: Eixo, x: number, y: number, z: number, cor: number, lados = 12, pai?: THREE.Object3D, r2 = r) {
    const geo = new THREE.CylinderGeometry(r2, r, c, lados);
    if (eixo === 'x') geo.rotateZ(-Math.PI / 2); else if (eixo === 'z') geo.rotateX(Math.PI / 2);
    const o = new THREE.Mesh(geo, this.m(cor));
    o.position.set(x, y, z);
    return this.add(o, pai);
  }
  /**
   * Perfil lateral (pontos [x, z], no sentido anti-horário visto de +y) extrudado na largura w, centrado em y0. A
   * silhueta de lado de carro, locomotiva, cabine, casco.
   */
  perfil(pts: readonly (readonly [number, number])[], w: number, cor: number, y0 = 0, pai?: THREE.Object3D) {
    const sh = new THREE.Shape();
    pts.forEach(([x, z], i) => (i ? sh.lineTo(x, z) : sh.moveTo(x, z)));
    sh.closePath();
    const geo = new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false, curveSegments: 4 });
    // (a forma fica no plano xy do three e é extrudada em z: vira o plano xz do corpo, extrudada em y)
    geo.rotateX(Math.PI / 2); geo.translate(0, w / 2 + y0, 0);
    const o = new THREE.Mesh(geo, this.m(cor));
    return this.add(o, pai);
  }
  /** placa horizontal: o contorno [x, y] (asa, empenagem, asa delta, convés) com espessura e, na altura z */
  placa(pts: readonly (readonly [number, number])[], e: number, z: number, cor: number, pai?: THREE.Object3D) {
    const sh = new THREE.Shape();
    pts.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
    sh.closePath();
    const geo = new THREE.ExtrudeGeometry(sh, { depth: e, bevelEnabled: false });
    geo.translate(0, 0, z - e / 2);
    return this.add(new THREE.Mesh(geo, this.m(cor)), pai);
  }
  /** sólido de revolução em torno do eixo x: pontos [x, raio] da ponta de trás à da frente */
  torno(pts: readonly (readonly [number, number])[], cor: number, lados = 12, y = 0, z = 0, pai?: THREE.Object3D, escalaZ = 1) {
    const geo = new THREE.LatheGeometry(pts.map(([x, r]) => new THREE.Vector2(Math.max(0.001, r), x)), lados);
    // (o torno do three gira em torno do y: deitado no x do corpo)
    geo.rotateZ(-Math.PI / 2);
    if (escalaZ !== 1) geo.scale(1, 1, escalaZ);
    const o = new THREE.Mesh(geo, this.m(cor));
    o.position.set(0, y, z);
    return this.add(o, pai);
  }
  /**
   * Roda de raio r e largura l com o eixo em y, em (x, y, z): pneu, aro e um traço no aro (para o giro aparecer). Gira em
   * torno do y local.
   */
  roda(r: number, l: number, x: number, y: number, z: number, lista: Modelo['rodas'], corPneu: number = COR.pneu, corAro: number = COR.aro, pai?: THREE.Object3D) {
    const g = new THREE.Group(); g.position.set(x, y, z);
    // (rodas pequenas, as dos truques que quase não se veem, com menos lados)
    this.cil(r, l, 'y', 0, 0, 0, corPneu, r < 0.5 ? 10 : 14, g);
    const lado = Math.sign(y) || 1;
    this.cil(r * 0.58, l * 1.04, 'y', 0, 0, 0, corAro, r < 0.5 ? 6 : 10, g);
    this.caixa(r * 1.0, l * 1.08, r * 0.16, 0, 0, 0, corPneu, g).position.y = 0.002 * lado;
    lista.push({ o: g, r });
    return this.add(g, pai);
  }
  /** pás: n pás de raio r e corda c em torno do z local, num grupo que gira; o cubo no centro */
  pas(n: number, r: number, c: number, cor: number, cubo = r * 0.08, pai?: THREE.Object3D) {
    const g = new THREE.Group();
    const geo = new THREE.BoxGeometry(r, c, Math.max(0.02, c * 0.12)); geo.translate(r / 2, 0, 0);
    for (let b = 0; b < n; b++) { const p = new THREE.Mesh(geo, this.m(cor)); p.rotation.z = (b * 2 * Math.PI) / n; p.rotation.x = 0.12; g.add(p); }
    const cb = new THREE.Mesh(new THREE.ConeGeometry(cubo, cubo * 2.2, 10), this.m(COR.grafite)); cb.rotation.x = Math.PI / 2; cb.position.z = cubo * 0.6; g.add(cb);
    return this.add(g, pai);
  }
  /** todas as malhas lançam e recebem a sombra do sol */
  sombras() { this.g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } }); return this.g; }
}

/** pontos de um arco (para recortes de para-lama e perfis arredondados) */
export function arco(cx: number, cz: number, r: number, a0: number, a1: number, n = 6): [number, number][] {
  const l: [number, number][] = [];
  for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; l.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]); }
  return l;
}
