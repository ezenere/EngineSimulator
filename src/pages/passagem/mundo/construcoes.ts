// Casas, prédios, galpões, celeiros, hangares, escritório e torre de controle, das construções da planta (planta.ts),
// em instâncias por peça: paredes, telhado de duas águas, telhado plano com platibanda, telhado em arco, janelas e
// portas na fachada que dá para a via. Seis chamadas de desenho para um bairro inteiro.
import * as THREE from 'three';
import type { Lugar } from '../lugar';
import { repetir, type Inst } from './geo';
import type { Construcao } from './planta';
import { sorteio } from './planta';

const VIDRO = 0x2a3440, PORTA = 0x6a4a32;

let GEOS: { caixa: THREE.BufferGeometry; duas: THREE.BufferGeometry; arco: THREE.BufferGeometry } | null = null;
function geos() {
  if (GEOS) return GEOS;
  const caixa = new THREE.BoxGeometry(1, 1, 1); caixa.translate(0, 0, 0.5);
  // telhado de duas águas: a cumeeira ao longo de x, base de −0,5 a 0,5 em y, altura 1
  const sh = new THREE.Shape(); sh.moveTo(-0.5, 0); sh.lineTo(0.5, 0); sh.lineTo(0, 1); sh.closePath();
  const duas = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false });
  // (a forma no plano xy do three, extrudada em z: vira a seção y-z, extrudada em x)
  duas.rotateX(Math.PI / 2); duas.rotateZ(Math.PI / 2); duas.translate(0.5, 0, 0);
  // conferir: depois das rotações a extrusão vai de x = −0,5 a 0,5
  duas.computeBoundingBox();
  const bb = duas.boundingBox!; duas.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z);
  const arco = new THREE.CylinderGeometry(0.5, 0.5, 1, 14, 1, false, 0, Math.PI); arco.rotateZ(Math.PI / 2); arco.rotateX(Math.PI / 2);
  arco.computeBoundingBox(); const ba = arco.boundingBox!; arco.translate(-(ba.min.x + ba.max.x) / 2, -(ba.min.y + ba.max.y) / 2, -ba.min.z);
  GEOS = { caixa, duas, arco };
  return GEOS;
}

/** as construções em instâncias, com a fachada para a via */
export function construir(lg: Lugar, cs: readonly Construcao[], semente = 11): THREE.Group {
  const G = new THREE.Group(), g = geos(), sorte = sorteio(semente);
  const paredes: Inst[] = [], duas: Inst[] = [], arcos: Inst[] = [], vidros: Inst[] = [], portas: Inst[] = [];
  const w: [number, number, number] = [0, 0, 0];
  for (const k of cs) {
    const r = lg.rumoVia(k.s), P = (s: number, m: number, z: number) => lg.mundo(s, m, z, w).slice();
    // (a fachada fica do lado da via: em m − frente·p/2)
    const mf = k.m - k.frente * (k.p / 2 + 0.04);
    if (k.tipo === 'torre') {
      paredes.push({ pos: P(k.s, k.m, 0), rumo: r, esc: [k.l, k.p, k.h], cor: k.cor });
      paredes.push({ pos: P(k.s, k.m, k.h), rumo: r, esc: [k.l + 2.4, k.p + 2.4, 0.4], cor: 0x6b6e73 });
      vidros.push({ pos: P(k.s, k.m, k.h + 0.4), rumo: r, esc: [k.l + 2.2, k.p + 2.2, 2.4] });
      paredes.push({ pos: P(k.s, k.m, k.h + 2.8), rumo: r, esc: [k.l + 2.8, k.p + 2.8, 0.4], cor: 0x6b6e73 });
      continue;
    }
    if (k.tipo === 'conteiner') {
      // (o de cima de uma pilha: a caixa começa onde a de baixo acaba)
      const z0 = k.h > 2.7 ? k.h - 2.6 : 0;
      paredes.push({ pos: P(k.s, k.m, z0), rumo: r, esc: [k.l, k.p, 2.6], cor: k.cor });
      portas.push({ pos: P(k.s + k.l / 2 + 0.02, k.m, z0 + 0.1), rumo: r, esc: [0.06, k.p - 0.2, 2.4], cor: 0x5b5f63 });
      for (let x = -k.l / 2 + 0.5; x < k.l / 2; x += 1.0) for (const sg of [-1, 1]) portas.push({ pos: P(k.s + x, k.m + sg * (k.p / 2 + 0.01), z0 + 0.1), rumo: r, esc: [0.12, 0.04, 2.4], cor: k.cor });
      continue;
    }
    paredes.push({ pos: P(k.s, k.m, 0), rumo: r, esc: [k.l, k.p, k.h], cor: k.cor });
    if (k.telhado === 'duas-aguas') {
      const alto = k.tipo === 'celeiro' ? k.p * 0.42 : k.p * 0.28;
      duas.push({ pos: P(k.s, k.m, k.h), rumo: r, esc: [k.l + 0.6, k.p + 0.7, alto], cor: k.corTelhado });
    } else if (k.telhado === 'arco') arcos.push({ pos: P(k.s, k.m, k.h), rumo: r, esc: [k.l + 0.4, k.p + 0.2, k.p * 0.3 * 2], cor: k.corTelhado });
    else paredes.push({ pos: P(k.s, k.m, k.h), rumo: r, esc: [k.l + 0.2, k.p + 0.2, 0.5], cor: 0x9a978f });   // platibanda
    // portas e janelas na fachada
    if (k.tipo === 'hangar' || k.tipo === 'galpao' || k.tipo === 'celeiro') {
      const lp = k.tipo === 'hangar' ? k.l * 0.85 : k.l * 0.35, hp = k.tipo === 'hangar' ? k.h * 0.85 : Math.min(5, k.h * 0.7);
      portas.push({ pos: P(k.s, mf, 0), rumo: r, esc: [lp, 0.12, hp], cor: k.tipo === 'celeiro' ? 0xe6dcc0 : 0x6b7077 });
      if (k.tipo === 'celeiro') portas.push({ pos: P(k.s, mf - k.frente * 0.02, 0.15), rumo: r, esc: [lp - 0.5, 0.12, hp - 0.4], cor: 0x7a2e22 });
      if (k.tipo === 'galpao') for (let x = -k.l / 2 + 3; x < k.l / 2 - 2; x += 4.5) if (Math.abs(x) > lp / 2 + 1) vidros.push({ pos: P(k.s + x, mf, k.h - 2.0), rumo: r, esc: [2.6, 0.12, 1.0] });
      continue;
    }
    const nJ = Math.max(1, Math.floor((k.l - 2) / 3.2)), passo = (k.l - 1.5) / nJ;
    const xPorta = k.tipo === 'casa' ? (sorte() - 0.5) * (k.l - 3) : 0;
    for (let a = 0; a < k.andares; a++) for (let j = 0; j < nJ; j++) {
      const x = -k.l / 2 + 0.75 + passo * (j + 0.5);
      if (a === 0 && Math.abs(x - xPorta) < 1.3) continue;
      vidros.push({ pos: P(k.s + x, mf, a * 3 + 1.0), rumo: r, esc: [Math.min(1.6, passo * 0.55), 0.12, 1.3] });
    }
    portas.push({ pos: P(k.s + xPorta, mf, 0), rumo: r, esc: [k.tipo === 'casa' ? 1.0 : 2.2, 0.12, 2.15], cor: k.tipo === 'casa' ? PORTA : VIDRO });
  }
  const mat = new THREE.MeshLambertMaterial({ flatShading: true });
  if (paredes.length) G.add(repetir(g.caixa, mat, paredes));
  if (duas.length) G.add(repetir(g.duas, mat, duas));
  if (arcos.length) G.add(repetir(g.arco, mat, arcos));
  if (vidros.length) G.add(repetir(g.caixa, new THREE.MeshLambertMaterial({ color: VIDRO, flatShading: true }), vidros));
  if (portas.length) G.add(repetir(g.caixa, mat, portas));
  G.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
  return G;
}
