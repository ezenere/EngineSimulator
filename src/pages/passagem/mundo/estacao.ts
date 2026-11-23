// A estação: duas plataformas (a sua e a do outro lado da segunda via) debaixo de um galpão de cobertura com estrutura
// à mostra (pilares com base, vigas transversais, longarinas, mãos-francesas), o prédio da estação no fundo com portas
// e janelas, bancos, lixeiras, placas com o nome, relógio, luminárias; atrás da plataforma de lá, um muro e a cidade.
// As medidas em que se pisa são as de lugar.ts (ESTACAO, PLATAFORMA) e planta.ts (ESTACAO_OUTRA).
import * as THREE from 'three';
import type { Lugar } from '../lugar';
import { PLATAFORMA, ESTACAO } from '../lugar';
import { ESTACAO_OUTRA } from './planta';
import { fosco, pintura, faixa, prisma, repetir, type Inst } from './geo';
import { fios } from './vias';
import { leveCirculo } from './leves';
import { Pecas, COR } from '../modelos/kit';
import { fundirGeometria, materialFundido } from '../modelos/fundir';

/** placa com o nome da estação (textura de um canvas: letras brancas no azul, opaca) */
function texturaNome(nome: string) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 112;
  const x = cv.getContext('2d');
  if (x) {
    x.fillStyle = '#1f4f96'; x.fillRect(0, 0, 512, 112);
    x.fillStyle = '#f4f4f0'; x.fillRect(6, 6, 500, 4); x.fillRect(6, 102, 500, 4);
    x.font = 'bold 64px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(nome, 256, 60);
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** banco de plataforma (assento, encosto, pés) e lixeira, em geometria de cor nos vértices para instanciar */
function geometriaBanco() {
  const p = new Pecas();
  p.caixa(1.9, 0.42, 0.06, 0, 0, 0.46, 0x7a5a3c); p.caixa(1.9, 0.06, 0.42, 0, 0.2, 0.74, 0x7a5a3c);
  for (const x of [-0.8, 0.8]) { p.caixa(0.06, 0.42, 0.44, x, 0, 0.22, COR.grafite); p.caixa(0.06, 0.06, 0.5, x, 0.22, 0.7, COR.grafite); }
  return fundirGeometria(p.g);
}
function geometriaLixeira() {
  const p = new Pecas();
  p.cil(0.24, 0.8, 'z', 0, 0, 0.4, 0xe08a2a, 10); p.cil(0.26, 0.06, 'z', 0, 0, 0.83, COR.grafite, 10);
  return fundirGeometria(p.g);
}

export interface Estacao { grupo: THREE.Group; relogio: (d: Date) => void }

/**
 * A estação inteira. `bo`: a borda da sua plataforma (m), `fu`: a parede do fundo; `a`: a meia extensão ao longo da via.
 */
export function estacao(lg: Lugar, catenariaZ: number | null): Estacao {
  const G = new THREE.Group();
  const bo = lg.bordaPlataforma, fu = bo + ESTACAO.largura + ESTACAO.fundo, a = ESTACAO.meio, T = ESTACAO.teto;
  const O = ESTACAO_OUTRA, mT = O.telhado, mFim = fu + 0.4;
  const concreto = fosco(0xa9a69e), w: [number, number, number] = [0, 0, 0];
  const P = (s: number, m: number, z: number) => lg.mundo(s, m, z, w).slice();
  // plataformas: a sua e a de lá, com a faixa amarela e o piso tátil
  G.add(prisma(lg, -a, a, 10, [[bo, 0], [bo, PLATAFORMA], [fu, PLATAFORMA], [fu, 0]], concreto, true));
  G.add(prisma(lg, -a, a, 10, [[O.plataforma[0], 0], [O.plataforma[0], PLATAFORMA], [O.plataforma[1], PLATAFORMA], [O.plataforma[1], 0]], concreto, true));
  const amarelo = pintura(0xe2c23a, 1);
  G.add(faixa(lg, -a, a, 10, bo + 0.5, bo + 0.7, PLATAFORMA, PLATAFORMA, amarelo), faixa(lg, -a, a, 10, O.plataforma[1] - 0.7, O.plataforma[1] - 0.5, PLATAFORMA, PLATAFORMA, amarelo));
  G.add(faixa(lg, -a, a, 10, bo, bo + 0.12, PLATAFORMA, PLATAFORMA, pintura(0xd9d5cc, 1)), faixa(lg, -a, a, 10, O.plataforma[1] - 0.12, O.plataforma[1], PLATAFORMA, PLATAFORMA, pintura(0xd9d5cc, 1)));
  // entre as plataformas, debaixo da cobertura: brita, não grama
  G.add(faixa(lg, -a - 4, a + 4, 10, O.plataforma[1], bo, 0, 0, pintura(0x7d7466, 1)));
  // muro atrás da plataforma de lá
  G.add(prisma(lg, -a, a, 10, [[O.muro, 0], [O.muro, O.muroAlto], [O.plataforma[0], O.muroAlto], [O.plataforma[0], 0]], fosco(0xb5ab9a), true));
  // o prédio da estação no fundo (a parede em que a plataforma acaba é a fachada dele), dois andares acima da cobertura
  // (a fachada é a parede; o corpo do prédio atrás dela, uma caixa com a platibanda)
  G.add(prisma(lg, -a, a, 10, [[fu, 0], [fu, T + 3.2], [fu + 12, T + 3.2], [fu + 12, 0]], fosco(0xe3c7a0), true));
  G.add(prisma(lg, -a - 0.3, a + 0.3, 10, [[fu - 0.15, T + 3.2], [fu - 0.15, T + 3.7], [fu + 12.15, T + 3.7], [fu + 12.15, T + 3.2]], fosco(0x9a978f), true));
  {
    const vidros: Inst[] = [], portas: Inst[] = [];
    for (let s = -a + 6; s < a - 4; s += 5) {
      const porta = Math.round((s + a) / 5) % 3 === 1;
      if (porta) portas.push({ pos: P(s, fu - 0.04, PLATAFORMA), rumo: lg.rumoVia(s), esc: [1.8, 0.1, 2.6] });
      else vidros.push({ pos: P(s, fu - 0.04, PLATAFORMA + 1.0), rumo: lg.rumoVia(s), esc: [1.6, 0.1, 1.5] });
      vidros.push({ pos: P(s, fu - 0.04, T + 0.6), rumo: lg.rumoVia(s), esc: [1.4, 0.1, 1.6] });
    }
    const caixa = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
    G.add(repetir(caixa, fosco(0x2a3440), vidros), repetir(caixa, fosco(0x5a3c28), portas));
  }
  // cobertura: a telha, a testeira das bordas, as vigas transversais a cada 7,5 m, as longarinas sobre os pilares
  G.add(prisma(lg, -a - 4, a + 4, 10, [[mT, T], [mT, T + 0.22], [mFim, T + 0.22], [mFim, T]], fosco(0x7d838a), true));
  G.add(prisma(lg, -a - 4, a + 4, 10, [[mT - 0.05, T - 0.5], [mT - 0.05, T + 0.3], [mT + 0.1, T + 0.3], [mT + 0.1, T - 0.5]], fosco(0x9a3a2a), true));
  const aco = fosco(0x4f6a7a), mCol = [bo + 6, (O.plataforma[0] + O.plataforma[1]) / 2], vigas: Inst[] = [], pilares: Inst[] = [], bases: Inst[] = [], maos: Inst[] = [];
  for (let s = -a - 3.75; s <= a + 4; s += 7.5) vigas.push({ pos: P(s, (mT + fu) / 2, T - 0.28), rumo: lg.rumoVia(s), esc: [0.25, fu - mT, 0.56] });
  for (const mc of mCol) {
    G.add(prisma(lg, -a - 4, a + 4, 10, [[mc - 0.18, T - 0.56], [mc - 0.18, T], [mc + 0.18, T], [mc + 0.18, T - 0.56]], aco, true));
    for (let s = -a + 7.5; s <= a; s += 15) {
      const r = lg.rumoVia(s);
      pilares.push({ pos: P(s, mc, PLATAFORMA), rumo: r, esc: [0.34, 0.34, T - 0.56 - PLATAFORMA] });
      leveCirculo(s, mc, 0.4, T - PLATAFORMA, PLATAFORMA);
      bases.push({ pos: P(s, mc, PLATAFORMA), rumo: r, esc: [0.75, 0.75, 0.28] });
      for (const d of [-1, 1]) maos.push({ pos: P(s + d * 0.75, mc, T - 1.15), rumo: r, esc: [0.14, 0.14, 2.0], arf: d * 0.85 });
    }
  }
  const unid = new THREE.BoxGeometry(1, 1, 1), unidZ = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
  G.add(repetir(unid, aco, vigas), repetir(unidZ, aco, pilares), repetir(unidZ, fosco(0x8f8c84), bases), repetir(unid, aco, maos));
  // luminárias debaixo das vigas
  const lum: Inst[] = [];
  for (let s = -a; s <= a; s += 7.5) for (const m of [bo + 2.2, O.plataforma[1] - 2.2]) lum.push({ pos: P(s, m, T - 0.62), rumo: lg.rumoVia(s) });
  G.add(repetir(new THREE.BoxGeometry(1.3, 0.2, 0.08), fosco(0xfff4d6, { emissive: 0xfff0c8, emissiveIntensity: 0.9 }), lum));
  // bancos (encostados no prédio e de costas para os pilares) e lixeiras
  const bancos: Inst[] = [], lixo: Inst[] = [];
  for (let s = -a + 11; s < a - 5; s += 15) {
    const r = lg.rumoVia(s);
    bancos.push({ pos: P(s, fu - 0.5, PLATAFORMA), rumo: r + Math.PI });
    bancos.push({ pos: P(s - 3.6, mCol[0] + 0.55, PLATAFORMA), rumo: r + Math.PI });
    bancos.push({ pos: P(s, mCol[1] - 0.55, PLATAFORMA), rumo: r });
    lixo.push({ pos: P(s - 7.5 + 0.7, mCol[0] - 0.6, PLATAFORMA), rumo: r }, { pos: P(s - 7.5 + 0.7, mCol[1] + 0.6, PLATAFORMA), rumo: r });
  }
  G.add(repetir(geometriaBanco(), materialFundido(), bancos), repetir(geometriaLixeira(), materialFundido(), lixo));
  // placas com o nome penduradas nas vigas, dos dois lados
  const tex = texturaNome('PASSAGEM'), placa: Inst[] = [], hastes: Inst[] = [];
  for (let s = -a + 22.5; s < a; s += 45) for (const m of [bo + 3.4, O.plataforma[1] - 3.4]) {
    const r = lg.rumoVia(s);
    placa.push({ pos: P(s, m, 4.3), rumo: r });
    for (const d of [-1.3, 1.3]) hastes.push({ pos: P(s + d, m, (4.3 + T - 0.56) / 2 + 0.2), rumo: r, esc: [0.04, 0.04, T - 0.56 - 4.3] });
  }
  const mp = new THREE.MeshLambertMaterial({ map: tex });
  G.add(repetir(new THREE.BoxGeometry(3.2, 0.08, 0.7), mp, placa), repetir(unid, aco, hastes));
  // relógio de dois mostradores pendurado do lado de lá, de frente para você
  const rel = new THREE.Group(), sR = 6, mR = O.plataforma[1] - 3.0;
  rel.position.set(...(P(sR, mR, 4.9) as [number, number, number])); rel.rotation.z = lg.rumoVia(sR);
  const p = new Pecas();
  p.cil(0.5, 0.16, 'y', 0, 0, 0, 0x2b2e33, 24, rel); p.cil(0.44, 0.17, 'y', 0, 0, 0, 0xf4f2ea, 24, rel);
  p.caixa(0.05, 0.05, T - 0.56 - 5.4, 0, 0, (T - 0.56 - 5.4) / 2 + 0.5, 0x2b2e33, rel);
  const ponteiros: THREE.Object3D[] = [];
  for (const lado of [-1, 1]) for (const [comp, larg] of [[0.26, 0.05], [0.38, 0.03]] as const) {
    const eixo = new THREE.Group(); eixo.position.y = lado * 0.095; rel.add(eixo);
    const m = p.caixa(larg, 0.015, comp, 0, 0, comp / 2 - 0.04, 0x1d1f22, eixo); void m;
    ponteiros.push(eixo);
  }
  G.add(rel);
  const relogio = (d: Date) => {
    const h = (d.getHours() % 12) + d.getMinutes() / 60, mi = d.getMinutes() + d.getSeconds() / 60;
    // (cada mostrador vê os ponteiros do seu lado: o de trás gira ao contrário)
    ponteiros.forEach((e, i) => { const lado = i < 2 ? -1 : 1, ang = (i % 2 === 0 ? h / 12 : mi / 60) * Math.PI * 2; e.rotation.y = -lado * ang; });
  };
  relogio(new Date());
  // a catenária pendurada da cobertura (os trens elétricos)
  if (catenariaZ != null) {
    const fio = fosco(0x4a4f55);
    fios(G, lg, -a - 4, a + 4, [{ m: 0, z: catenariaZ }, { m: O.via, z: catenariaZ }], 0x34373b);
    const pend: Inst[] = [];
    for (let s = -a - 3.75; s <= a + 4; s += 7.5) for (const mv of [0, O.via]) pend.push({ pos: P(s, mv, (catenariaZ + T - 0.56) / 2), rumo: lg.rumoVia(s), esc: [0.05, 0.05, T - 0.56 - catenariaZ] });
    G.add(repetir(unid, fio, pend));
  }
  G.traverse((o) => { o.receiveShadow = true; if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return { grupo: G, relogio };
}

/**
 * A estação do metrô, subterrânea: a caixa de concreto ao longo da via toda (as paredes e o forro em que se esbarra são
 * os de lugar.ts, `est.caixa`), as duas plataformas laterais mais estreitas, a fileira de pilares entre as vias, as
 * paredes de azulejo com a faixa colorida, as placas com o nome, os painéis, as calhas de luz do forro; além das pontas
 * da estação, o túnel escuro (as luzes esparsas), de onde o trem chega com os faróis acesos.
 */
export function estacaoMetro(lg: Lugar, s0: number, s1: number): Estacao {
  const G = new THREE.Group(), e = lg.est!, cx = e.caixa!, O = e.outra!, bo = lg.bordaPlataforma, fu = bo + e.largura + e.fundo, a = e.meio, T = cx.teto;
  const w: [number, number, number] = [0, 0, 0], P = (s: number, m: number, z: number) => lg.mundo(s, m, z, w).slice();
  const reta = lg.mundo(0, 0, 0)[1] === 0 && lg.mundo(100, 0, 0)[1] === 0, passo = reta ? 20 : 4;
  // a caixa: o piso entre as plataformas, as paredes (azulejo na estação, concreto no túnel) e o forro
  const azulejo = fosco(0xe9e6dc, { emissive: 0x2a2924 }), concretoT = fosco(0x7e7b74, { emissive: 0x141312 }), forro = fosco(0xcfccc4, { emissive: 0x24231f });
  for (const [m0, m1] of [[cx.perto, cx.perto + 0.3], [cx.longe - 0.3, cx.longe]] as const) {
    for (const [a0, a1, mat] of [[s0, -a, concretoT], [-a, a, azulejo], [a, s1, concretoT]] as const) if (a1 > a0) G.add(prisma(lg, a0, a1, passo, [[m0, 0], [m0, T + 0.3], [m1, T + 0.3], [m1, 0]], mat, false));
  }
  for (const [a0, a1, mat] of [[s0, -a, concretoT], [-a, a, forro], [a, s1, concretoT]] as const) if (a1 > a0) G.add(prisma(lg, a0, a1, passo, [[cx.longe, T], [cx.longe, T + 0.3], [cx.perto, T + 0.3], [cx.perto, T]], mat, false));
  G.add(faixa(lg, s0, s1, passo, cx.longe, cx.perto, 0.005, 0.005, pintura(0x5a5650, 1)));
  // as plataformas (sem cobertura: o forro é a caixa), a faixa amarela, a faixa azul de azulejo nas paredes
  const concreto = fosco(0xa9a69e);
  G.add(prisma(lg, -a, a, 10, [[bo, 0], [bo, PLATAFORMA], [fu, PLATAFORMA], [fu, 0]], concreto, true));
  G.add(prisma(lg, -a, a, 10, [[O.plataforma[0], 0], [O.plataforma[0], PLATAFORMA], [O.plataforma[1], PLATAFORMA], [O.plataforma[1], 0]], concreto, true));
  const amarelo = pintura(0xe2c23a, 1);
  G.add(faixa(lg, -a, a, 10, bo + 0.45, bo + 0.65, PLATAFORMA, PLATAFORMA, amarelo), faixa(lg, -a, a, 10, O.plataforma[1] - 0.65, O.plataforma[1] - 0.45, PLATAFORMA, PLATAFORMA, amarelo));
  for (const [m0, sg] of [[cx.perto - 0.01, -1], [cx.longe + 0.01, 1]] as const) G.add(faixa(lg, -a, a, 10, m0, m0, PLATAFORMA + 1.5, PLATAFORMA + 2.0, fosco(0x2f5aa8, { emissive: 0x0a1630 })), faixa(lg, -a, a, 10, m0 + sg * 0.005, m0 + sg * 0.005, PLATAFORMA + 2.0, PLATAFORMA + 2.08, fosco(0x1d1f22)));
  // os pilares entre as vias, as vigas do forro sobre eles
  const pil: Inst[] = [], vig: Inst[] = [], mPil = O.via / 2;
  for (let s = Math.ceil(s0 / 10) * 10; s <= s1; s += 10) { pil.push({ pos: P(s, mPil, T / 2), rumo: lg.rumoVia(s) }); leveCirculo(s, mPil, 0.42, T); vig.push({ pos: P(s, (cx.longe + cx.perto) / 2, T - 0.25), rumo: lg.rumoVia(s), esc: [0.5, cx.perto - cx.longe, 0.5] }); }
  G.add(repetir(new THREE.BoxGeometry(0.6, 0.6, T), fosco(0x9c9a94, { emissive: 0x1a1917 }), pil), repetir(new THREE.BoxGeometry(1, 1, 1), fosco(0xa9a69e, { emissive: 0x1a1917 }), vig));
  // as calhas de luz (acesas) sobre as plataformas na estação, e as luzes esparsas do túnel
  const luz = new THREE.MeshBasicMaterial({ color: 0xfff6e2 }), lum: Inst[] = [];
  for (let s = -a + 2; s < a; s += 4) for (const m of [bo + 2.2, O.plataforma[1] - 1.8]) lum.push({ pos: P(s, m, T - 0.06), rumo: lg.rumoVia(s), esc: [3.2, 0.25, 0.08] });
  for (let s = Math.ceil(s0 / 25) * 25; s <= s1; s += 25) if (Math.abs(s) > a + 5) for (const m of [cx.perto - 0.1, cx.longe + 0.1]) lum.push({ pos: P(s, m, 3.2), rumo: lg.rumoVia(s), esc: [0.8, 0.12, 0.12] });
  G.add(repetir(new THREE.BoxGeometry(1, 1, 1), luz, lum));
  // as placas com o nome nas paredes e os painéis de anúncio, os bancos encostados na parede
  const tex = texturaNome('PASSAGEM'), placa: Inst[] = [], paineis: Inst[] = [];
  const corP = [0xd94a3a, 0x2f7d4f, 0xe2b33a, 0x7a3fa8, 0x2f5aa8];
  // (a placa é uma caixa com a textura nas duas faces largas: a da parede de cá gira meia volta para a face lida ficar
  // virada para a plataforma)
  for (let s = -a + 8; s < a - 4; s += 16) for (const [m, gira] of [[cx.perto - 0.06, Math.PI], [cx.longe + 0.06, 0]] as const) {
    placa.push({ pos: P(s, m, PLATAFORMA + 2.6), rumo: lg.rumoVia(s) + gira });
    paineis.push({ pos: P(s + 8, m, PLATAFORMA + 1.0), rumo: lg.rumoVia(s), cor: corP[Math.abs(Math.round(s / 16)) % corP.length] });
  }
  G.add(repetir(new THREE.BoxGeometry(3.0, 0.08, 0.65), new THREE.MeshBasicMaterial({ map: tex }), placa), repetir(new THREE.BoxGeometry(2.6, 0.06, 1.7), new THREE.MeshLambertMaterial({ emissive: 0x202020 }), paineis));
  const bancos: Inst[] = [];
  for (let s = -a + 12; s < a - 6; s += 16) bancos.push({ pos: P(s, cx.perto - 0.5, PLATAFORMA), rumo: lg.rumoVia(s) + Math.PI }, { pos: P(s, cx.longe + 0.5, PLATAFORMA), rumo: lg.rumoVia(s) });
  G.add(repetir(geometriaBanco(), materialFundido(), bancos));
  // as pontas da estação: a viga de testa e a mureta do fim das plataformas
  for (const sx of [-a, a]) {
    G.add(prisma(lg, sx - 0.4, sx + 0.4, 1, [[cx.longe, T - 1.0], [cx.longe, T], [cx.perto, T], [cx.perto, T - 1.0]], fosco(0x8f8c84, { emissive: 0x1a1917 }), true));
    for (const [m0, m1] of [[bo, fu], [O.plataforma[0], O.plataforma[1]]] as const) G.add(prisma(lg, sx - 0.1, sx + 0.1, 1, [[m0, PLATAFORMA], [m0, PLATAFORMA + 1.1], [m1, PLATAFORMA + 1.1], [m1, PLATAFORMA]], fosco(0xe2c23a), true));
  }
  G.traverse((o) => { o.receiveShadow = true; });
  return { grupo: G, relogio: () => {} };
}

/**
 * A estação antiga do interior (a da Maria Fumaça): a plataforma de pedra com a borda de tijolo, a gare de telha com as
 * colunas de ferro, as mãos-francesas e o lambrequim recortado, o prédio da estação (de planta.ts, com as portas para a
 * plataforma), a placa com o nome em dois postes, o sino, os lampiões, os bancos de madeira; mais adiante, a caixa-d'água
 * das locomotivas e o sinal de semáforo.
 */
export function estacaoAntiga(lg: Lugar): Estacao {
  const G = new THREE.Group(), e = lg.est!, bo = lg.bordaPlataforma, fu = bo + e.largura + e.fundo, a = e.meio, cob = e.cobre;
  const w: [number, number, number] = [0, 0, 0], P = (s: number, m: number, z: number) => lg.mundo(s, m, z, w).slice();
  // a plataforma: pedra, a borda de tijolo, a faixa branca
  G.add(prisma(lg, -a, a, 5, [[bo, 0], [bo, PLATAFORMA], [fu, PLATAFORMA], [fu, 0]], fosco(0xb3aa98), true));
  G.add(prisma(lg, -a, a, 5, [[bo - 0.02, 0], [bo - 0.02, PLATAFORMA - 0.03], [bo + 0.25, PLATAFORMA - 0.03], [bo + 0.25, 0]], fosco(0x9a4a32), true));
  G.add(faixa(lg, -a, a, 5, bo + 0.5, bo + 0.62, PLATAFORMA, PLATAFORMA, pintura(0xeeeae0, 1)));
  // a gare: o telhado de uma água (do prédio para a via), a testeira, o lambrequim, as colunas de ferro e as mãos-francesas
  const zA = e.teto + 0.35, zB = e.teto - 0.2, mB = bo - 0.6;
  G.add(prisma(lg, -cob, cob, 2, [[mB, zB], [fu + 0.3, zA], [fu + 0.3, zA + 0.08], [mB, zB + 0.08]], fosco(0x8f4a33), true));
  G.add(prisma(lg, -cob, cob, 2, [[mB - 0.02, zB - 0.3], [mB + 0.02, zB - 0.3], [mB + 0.02, zB + 0.02], [mB - 0.02, zB + 0.02]], fosco(0xe6dcc0), true));
  const dentes: Inst[] = [], cols: Inst[] = [], maos: Inst[] = [], mC = bo + 1.7;
  for (let s = -cob + 0.15; s < cob; s += 0.3) dentes.push({ pos: P(s, mB, zB - 0.3), rumo: lg.rumoVia(s), arf: Math.PI / 4, esc: [0.15, 0.03, 0.15] });
  G.add(repetir(new THREE.BoxGeometry(1, 1, 1), fosco(0xe6dcc0), dentes));
  const zCol = zB + (zA - zB) * ((mC - mB) / (fu + 0.3 - mB));
  for (let s = -cob + 3; s < cob; s += 6) {
    cols.push({ pos: P(s, mC, PLATAFORMA), rumo: lg.rumoVia(s), esc: [0.14, 0.14, zCol - PLATAFORMA] });
    leveCirculo(s, mC, 0.1, zCol - PLATAFORMA, PLATAFORMA);
    for (const d of [-1, 1]) maos.push({ pos: P(s + d * 0.4, mC, zCol - 0.35), rumo: lg.rumoVia(s), esc: [0.07, 0.07, 1.0], arf: d * 0.75 });
    maos.push({ pos: P(s, mC - 0.45, zCol - 0.35), rumo: lg.rumoVia(s), esc: [0.07, 0.07, 1.0], incl: 0.75 });
  }
  const ferro = fosco(0x2f4f3a), unidZ = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
  G.add(repetir(unidZ, ferro, cols), repetir(new THREE.BoxGeometry(1, 1, 1), ferro, maos));
  // a placa com o nome (branca, letras pretas) em dois postes, o sino na parede, os lampiões, os bancos de madeira
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 112;
  const x = cv.getContext('2d');
  if (x) { x.fillStyle = '#1d1f22'; x.fillRect(0, 0, 512, 112); x.fillStyle = '#f2efe4'; x.fillRect(8, 8, 496, 96); x.fillStyle = '#1d1f22'; x.font = 'bold 60px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('PASSAGEM', 256, 60); }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const sN = -26, mN = bo + 1.2;
  G.add(repetir(new THREE.BoxGeometry(3.4, 0.08, 0.75), new THREE.MeshLambertMaterial({ map: tex }), [{ pos: P(sN, mN, PLATAFORMA + 2.4), rumo: lg.rumoVia(sN) }]));
  G.add(repetir(unidZ, fosco(0x1d1f22), [{ pos: P(sN - 1.5, mN, PLATAFORMA), rumo: lg.rumoVia(sN), esc: [0.08, 0.08, 2.4] }, { pos: P(sN + 1.5, mN, PLATAFORMA), rumo: lg.rumoVia(sN), esc: [0.08, 0.08, 2.4] }]));
  const p = new Pecas(), lamp: Inst[] = [], bancos: Inst[] = [];
  p.cil(0.16, 0.24, 'z', 0, 0, 0, 0xb08a3a, 12); p.caixa(0.06, 0.4, 0.06, 0, -0.2, 0.18, 0x1d1f22);
  const sino = new THREE.Mesh(fundirGeometria(p.g), materialFundido()); sino.position.set(...(P(4, fu - 0.12, PLATAFORMA + 2.6) as [number, number, number])); sino.rotation.z = lg.rumoVia(4); G.add(sino);
  for (let s = -a + 6; s < a; s += 14) if (Math.abs(s - sN) > 3) { lamp.push({ pos: P(s, bo + 0.9, PLATAFORMA), rumo: lg.rumoVia(s) }); leveCirculo(s, bo + 0.9, 0.08, 3.6, PLATAFORMA); }
  for (const sx of [sN - 1.5, sN + 1.5]) leveCirculo(sx, mN, 0.06, 2.4, PLATAFORMA);
  G.add(repetir(new THREE.CylinderGeometry(0.05, 0.07, 3.2, 6).rotateX(Math.PI / 2).translate(0, 0, 1.6), fosco(0x1d1f22), lamp), repetir(new THREE.BoxGeometry(0.28, 0.28, 0.4).translate(0, 0, 3.4), new THREE.MeshBasicMaterial({ color: 0xf6e7b8 }), lamp));
  for (let s = -cob + 5; s < cob - 2; s += 9) bancos.push({ pos: P(s, fu - 0.55, PLATAFORMA), rumo: lg.rumoVia(s) + Math.PI });
  G.add(repetir(geometriaBanco(), materialFundido(), bancos));
  // a caixa-d'água das locomotivas (depois do fim da plataforma, de onde o trem vem) e o sinal de semáforo mais adiante
  const sT = -a - 16, mT = bo + 3.2, gT = new Pecas();
  for (const [dx, dy] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) gT.caixa(0.22, 0.22, 6, dx, dy, 3, 0x6a5038);
  gT.cil(2.2, 3.2, 'z', 0, 0, 7.6, 0x5b4a3a, 18); gT.cil(2.35, 0.3, 'z', 0, 0, 9.3, 0x3a3d42, 18);
  const bica = gT.cil(0.18, 2.6, 'y', 0, -2.4, 6.6, 0x3a3d42, 8); bica.rotation.x = 0.5;
  const torre = new THREE.Mesh(fundirGeometria(gT.g), materialFundido()); torre.position.set(...(P(sT, mT, 0) as [number, number, number])); torre.rotation.z = lg.rumoVia(sT); G.add(torre);
  const sS = -a - 70, gS = new Pecas();
  gS.cil(0.12, 8, 'z', 0, 0, 4, 0x8f949a, 8); gS.caixa(1.6, 0.08, 0.3, 0.7, 0, 7.2, 0xc8322a); gS.caixa(0.36, 0.1, 0.32, 1.2, 0, 7.2, 0xeeeae0);
  gS.cil(0.12, 0.06, 'x', -0.1, 0, 6.7, 0x1d1f22, 10);
  const sem = new THREE.Mesh(fundirGeometria(gS.g), materialFundido()); sem.position.set(...(P(sS, -2.6, 0) as [number, number, number])); sem.rotation.z = lg.rumoVia(sS) + Math.PI; G.add(sem);
  G.traverse((o) => { o.receiveShadow = true; if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return { grupo: G, relogio: () => {} };
}
