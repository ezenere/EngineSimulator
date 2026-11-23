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
