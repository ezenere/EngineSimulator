// O túnel: por dentro, a seção da Cena (secaoTunel) com a passarela de serviço do lado do observador, os nichos de
// refúgio com a luminária e a porta de emergência, o corrimão, as luminárias do teto; por fora, o morro que cobre o tubo
// (de dentro não se vê o lado de fora, só a luz das bocas) e o emboque em cada boca: a testa de concreto em volta da
// abertura, as alas descendo a 45° e o vale de acesso. As medidas são as de lugar.ts e planta.ts (o morro em que se pisa).
import * as THREE from 'three';
import type { Lugar } from '../lugar';
import { TUNEL } from '../lugar';
import { alturaMorro, emboque, MORRO, type TuboTunel } from './planta';
import { fosco, faixa, prisma, repetir, terreno, grade, Malha, type Inst } from './geo';
import { fios } from './vias';

/** o tubo por dentro (o que o observador vê do refúgio) */
export function tuboPorDentro(G: THREE.Group, lg: Lugar, reta: boolean, catenariaZ: number | null) {
  const t = lg.tun!, mP = t.mPerto, mL = t.mLonge, h = t.h, ta = t.ta, tb = t.tb, p = reta ? 25 : 5;
  const parede = fosco(0xb8b3a9, { flatShading: false, emissive: 0x2c2a26 });
  parede.side = THREE.DoubleSide;
  // a parede do outro lado e o teto até o alto da parede do lado do observador; essa, por trechos, com os nichos
  const pas = TUNEL.passarela, ni = TUNEL.nicho, topoNicho = pas + ni.altura, bo = t.borda;
  G.add(prisma(lg, ta, tb, p, [[mL, 0], [mL, h], [mL + 0.6, h + 0.5], [mP - 0.6, h + 0.5], [mP, h], [mP, topoNicho]], parede, false, true));
  const nichos = lg.nichos(), trechos: [number, number][] = [];
  let ini = ta;
  for (const c of nichos) { trechos.push([ini, c - ni.largura / 2]); ini = c + ni.largura / 2; }
  trechos.push([ini, tb]);
  for (const [a, b] of trechos) if (b > a) G.add(prisma(lg, a, b, p, [[mP, topoNicho], [mP, 0]], parede, false, true));
  // os nichos: fundo, laterais, teto e piso (uma malha só), cada um com a luminária e, a cada 100 m, a porta
  const nicho = new Malha(lg);
  for (const c of nichos) {
    const a = c - ni.largura / 2, b = c + ni.largura / 2, f = mP + ni.fundo;
    nicho.quad([a, f, pas], [b, f, pas], [b, f, topoNicho], [a, f, topoNicho]);
    nicho.quad([a, mP, pas], [a, f, pas], [a, f, topoNicho], [a, mP, topoNicho]);
    nicho.quad([b, mP, pas], [b, f, pas], [b, f, topoNicho], [b, mP, topoNicho]);
    nicho.quad([a, mP, topoNicho], [b, mP, topoNicho], [b, f, topoNicho], [a, f, topoNicho]);
    nicho.quad([a, mP, pas], [b, mP, pas], [b, f, pas], [a, f, pas]);
    // (o vão entre o piso do nicho e o chão da via, embaixo da passarela: fechado)
    nicho.quad([a, mP, 0], [b, mP, 0], [b, mP, pas], [a, mP, pas]);
  }
  if (!nicho.vazia) G.add(nicho.mesh(parede));
  const porta = new Malha(lg);
  for (const c of nichos) if (Math.round(c / ni.cada) % 2 === 0) { const f = mP + ni.fundo - 0.04; porta.quad([c - 0.5, f, pas], [c + 0.5, f, pas], [c + 0.5, f, pas + 2.05], [c - 0.5, f, pas + 2.05]); }
  if (!porta.vazia) G.add(porta.mesh(fosco(0x2f7d4f)));
  // a passarela de serviço, com a borda pintada e o corrimão na parede (por trechos, entre os nichos)
  G.add(prisma(lg, ta, tb, p, [[bo, 0], [bo, pas], [mP, pas], [mP, 0]], fosco(0x9c9a94), true));
  G.add(faixa(lg, ta, tb, p, bo + 0.05, bo + 0.2, pas + 0.006, pas + 0.006, fosco(0xe2c23a)));
  for (const [a, b] of trechos) if (b > a) G.add(prisma(lg, a, b, p, [[mP - 0.12, pas + TUNEL.corrimao], [mP - 0.05, pas + TUNEL.corrimao], [mP - 0.05, pas + TUNEL.corrimao - 0.06], [mP - 0.12, pas + TUNEL.corrimao - 0.06]], fosco(0xd9b04a), true));
  // piso da via, as luminárias do teto (a cada 25 m, dos dois lados) e uma em cada nicho
  G.add(faixa(lg, ta, tb, p, mL, bo, 0.01, 0.01, fosco(0x77746e)));
  const lum = fosco(0xfff4d6, { emissive: 0xfff0c8, emissiveIntensity: 1.2 }), pts: Inst[] = [];
  for (let s = ta + 10; s < tb; s += 25) for (const mm of [mL + 0.45, mP - 0.45]) pts.push({ pos: lg.mundo(s, mm, h - 0.4), rumo: lg.rumoVia(s) });
  for (const c of nichos) pts.push({ pos: lg.mundo(c, mP + ni.fundo / 2, topoNicho - 0.1), rumo: lg.rumoVia(c) });
  G.add(repetir(new THREE.BoxGeometry(1.2, 0.18, 0.08), lum, pts));
  // o fio de contato, preso no teto por pendurais a cada 50 m (os trens elétricos)
  if (catenariaZ != null) {
    const fio = fosco(0x4a4f55), pend: Inst[] = [];
    fios(G, lg, ta - 30, tb + 30, [{ m: 0, z: catenariaZ }, { m: -4.3, z: catenariaZ }], 0x34373b);
    for (const mv of [0, -4.3]) {
      for (let s = ta + 25; s < tb; s += 50) pend.push({ pos: lg.mundo(s, mv, (catenariaZ + h + 0.5) / 2), rumo: lg.rumoVia(s), esc: [0.05, 0.05, h + 0.5 - catenariaZ] });
    }
    G.add(repetir(new THREE.BoxGeometry(1, 1, 1), fio, pend));
  }
  // o teto e as paredes fazem sombra (o sol não entra pela pedra)
  G.traverse((o) => { o.receiveShadow = true; if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
}

/** o morro por cima do tubo e o emboque das duas bocas (na reta) */
export function morroEEmboque(G: THREE.Group, lg: Lugar): THREE.Object3D {
  const t = lg.tun!, tubo: TuboTunel = { ta: t.ta, tb: t.tb, mPerto: t.mPerto, mLonge: t.mLonge, h: t.h }, e = emboque(tubo);
  const largMorro = MORRO.topo + MORRO.crista / MORRO.rampaLado + 4;
  const subida = MORRO.crista - e.alto, alaFim = e.alto / MORRO.alas;
  const ss = grade(t.ta - e.alto - 30, t.tb + e.alto + 30, 30, [t.ta - e.alto, t.ta - 0.02, t.ta, t.ta + subida / 2, t.ta + subida, t.tb - subida, t.tb - subida / 2, t.tb, t.tb + 0.02, t.tb + e.alto]);
  const quinasM: number[] = [];
  for (const sg of [-1, 1]) quinasM.push(e.mc + sg * (e.meia - 0.02), e.mc + sg * e.meia, e.mc + sg * (e.meia + alaFim / 2), e.mc + sg * (e.meia + alaFim), e.mc + sg * MORRO.topo);
  quinasM.push(t.mLonge, t.mPerto);
  const ms = grade(e.mc - largMorro, e.mc + largMorro, 12, quinasM);
  const pedra = 0x8a8273, grama = [0x5d7f3e, 0x557838, 0x66884a, 0x4f7036];
  const cor = (z: number, s: number, m: number) => {
    const naFace = (Math.abs(s - t.ta) < 0.1 || Math.abs(s - t.tb) < 0.1) || (Math.abs(Math.abs(m - e.mc) - e.meia) < 0.1 && (s < t.ta || s > t.tb));
    if (naFace) return pedra;
    return grama[(Math.floor(s / 37) + Math.floor(m / 23) + (z > 18 ? 1 : 0)) & 3];
  };
  // (a face do emboque na frente da abertura do tubo não é desenhada: ali o tubo continua; a grade tem as quinas da
  // abertura nas linhas, e as células da face que caem dentro dela saem)
  const mor = terreno(lg, ss, ms, (s, m) => alturaMorro(tubo, s, m), cor);
  const morro = recortarAbertura(mor, lg, tubo); G.add(morro);
  // a testa de concreto: os dois pilares, a verga e os cantos chanfrados do teto; as alas na lateral do vale de acesso
  const conc = fosco(0x8d8a83), conc2 = fosco(0x76736c);
  for (const [sa, sb] of [[t.ta - 0.7, t.ta + 0.05], [t.tb - 0.05, t.tb + 0.7]] as const) {
    G.add(prisma(lg, sa, sb, 1, [[e.mc - e.meia, 0], [e.mc - e.meia, e.alto], [t.mLonge, e.alto], [t.mLonge, 0]], conc, true));
    G.add(prisma(lg, sa, sb, 1, [[t.mPerto, 0], [t.mPerto, e.alto], [e.mc + e.meia, e.alto], [e.mc + e.meia, 0]], conc, true));
    G.add(prisma(lg, sa, sb, 1, [[t.mLonge, t.h + 0.5], [t.mLonge, e.alto], [t.mPerto, e.alto], [t.mPerto, t.h + 0.5]], conc, true));
    G.add(prisma(lg, sa, sb, 1, [[t.mLonge, t.h], [t.mLonge, t.h + 0.5], [t.mLonge + 0.6, t.h + 0.5]], conc, true));
    G.add(prisma(lg, sa, sb, 1, [[t.mPerto - 0.6, t.h + 0.5], [t.mPerto, t.h + 0.5], [t.mPerto, t.h]], conc, true));
    // a cornija em cima da testa
    G.add(prisma(lg, sa - 0.25, sb + 0.25, 1, [[e.mc - e.meia - 0.3, e.alto], [e.mc - e.meia - 0.3, e.alto + 0.35], [e.mc + e.meia + 0.3, e.alto + 0.35], [e.mc + e.meia + 0.3, e.alto]], conc2, true));
  }
  const alas = new Malha(lg);
  for (const sg of [-1, 1]) {
    const m = e.mc + sg * (e.meia - 0.04);
    alas.quad([t.ta - e.alto, m, 0], [t.ta, m, 0], [t.ta, m, e.alto]);
    alas.quad([t.tb + e.alto, m, 0], [t.tb, m, 0], [t.tb, m, e.alto]);
  }
  G.add(alas.mesh(conc));
  G.traverse((o) => { o.receiveShadow = true; if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  // (a malha do morro: a cena esconde quando você está dentro do tubo, onde ela não se vê e só custaria pixels)
  return morro;
}

/** tira da malha do morro os triângulos da face das bocas que ficam na frente da abertura do tubo */
function recortarAbertura(mor: THREE.Mesh, lg: Lugar, t: TuboTunel) {
  const g = mor.geometry, p = g.attributes.position as THREE.BufferAttribute, c = g.attributes.color as THREE.BufferAttribute;
  const pos: number[] = [], cor: number[] = [], q = { s: 0, m: 0 };
  for (let i = 0; i < p.count; i += 3) {
    let sm = 0, mm = 0, zmax = 0, s0 = Infinity, s1 = -Infinity;
    for (let k = 0; k < 3; k++) { lg.projetar(p.getX(i + k), p.getY(i + k), q); sm += q.s / 3; mm += q.m / 3; zmax = Math.max(zmax, p.getZ(i + k)); s0 = Math.min(s0, q.s); s1 = Math.max(s1, q.s); }
    const naFace = (s1 - s0 < 0.1) && (Math.abs(sm - t.ta) < 0.1 || Math.abs(sm - t.tb) < 0.1);
    if (naFace && mm > t.mLonge - 0.1 && mm < t.mPerto + 0.1 && zmax <= emboque(t).alto + 1e-3) continue;
    for (let k = 0; k < 3; k++) { pos.push(p.getX(i + k), p.getY(i + k), p.getZ(i + k)); cor.push(c.getX(i + k), c.getY(i + k), c.getZ(i + k)); }
  }
  const ng = new THREE.BufferGeometry();
  ng.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); ng.setAttribute('color', new THREE.Float32BufferAttribute(cor, 3)); ng.computeVertexNormals();
  g.dispose(); mor.geometry = ng;
  return mor;
}
