// O lugar em volta da via, por cenário (planta.ts escolhe qual): o chão, os morros do horizonte, a via (linha férrea,
// rua, pista) e o que uma pessoa veria ali: a ferrovia no campo com a catenária ou o telégrafo, o pátio de manobras, o
// corte, a estação, o túnel no morro, o viaduto no vale, a rua de bairro, a estrada de terra, a reta arborizada, o
// aeródromo, o parque, o pátio do gerador, a fazenda e o rio. Tudo opaco, sombreamento plano, instâncias para o que se
// repete; as medidas em que se pisa são as de lugar.ts e planta.ts.
import * as THREE from 'three';
import type { ControlePassagem } from '../controle';
import { PONTE, CORTE, SEGUNDA_VIA } from '../lugar';
import type { Lugar } from '../lugar';
import { type Cenario, RUA_M, VALE, ESTACAO_OUTRA, AERO, construcoes, sorteio, alturaVale, alturaMorro } from './planta';
import { fosco, pintura, faixa, prisma, repetir, terreno, grade, type Inst } from './geo';
import { linhaFerrea, catenaria, telegrafo, cerca, defensa, postesDeLuz, redeEletrica, asfalto, calcada, type Dormentes } from './vias';
import { arvores, bosque, alameda, retalhos, morros, type Arvore } from './natureza';
import { construir } from './construcoes';
import { estacao } from './estacao';
import { tuboPorDentro, morroEEmboque } from './tunel';
import { carro, type TipoCarro } from '../modelos/estrada';
import { aviaoHelice } from '../modelos/ar';
import { fundir, soltarPecas } from '../modelos/fundir';
import { COR } from '../modelos/kit';
import type { FonteSonora } from '../../../scene/tipos';

export interface Mundo { grupo: THREE.Group; dormentes: Dormentes[]; relogio?: (d: Date) => void; cenario: Cenario; /** o morro do túnel (some quando você está dentro do tubo) */ morro?: THREE.Object3D }

const GRAMA = 0x5f7f40, BRITA = 0x8a7d68;
const LAVOURAS = [0x8f9a4a, 0xa89a5a, 0x6d8a3e, 0x7f6a4c, 0xb3a35f, 0x5f8a45];

/** material do lastro: a textura de brita CC0, se chegou; senão a cor lisa */
function lastro(brita: THREE.Texture | null) {
  if (!brita) return fosco(BRITA);
  const t = brita.clone(); t.needsUpdate = true; t.repeat.set(1, 1);
  const m = fosco(0xd8d4cc, { flatShading: false }); m.map = t; m.color.set(BRITA).lerp(new THREE.Color(0xffffff), 0.45);
  return m;
}

/**
 * O chão na cor dada: perto da via (até onde se anda), uma grade de células de 40 m; em volta dela, até o horizonte,
 * quatro placas grandes. (Um triângulo de quilômetros que passa rente à câmera perde a precisão da profundidade no
 * WebGL em software e cobre a calçada e o asfalto: perto do olho, só triângulos pequenos.) `buraco` [mA, mB]: a faixa
 * ao longo da reta onde o chão é outro (o vale da ponte, o rio).
 */
function chao(G: THREE.Group, c: ControlePassagem, cor: number, buraco?: readonly [number, number]) {
  const via = c.via, reta = via.tipo === 'reta', W = 340, cel = 40, E = Math.max(via.comp, 6000) + 9000, larg = 9600;
  const x1 = reta ? via.comp / 2 + 600 : via.ls / 2 + via.R + W, y1 = reta ? W : via.R + W;
  const pos: number[] = [];
  const quad = (a: number, b: number, c2: number, d: number) => pos.push(a, c2, 0, b, c2, 0, b, d, 0, a, c2, 0, b, d, 0, a, d, 0);
  // (na reta m = −y: o buraco em m vira a faixa de y de −mB a −mA)
  const noBuraco = (y0: number, y2: number) => !!buraco && reta && y0 >= -buraco[1] - 1e-6 && y2 <= -buraco[0] + 1e-6;
  const nx = Math.ceil((2 * x1) / cel), ny = Math.ceil((2 * y1) / cel);
  const ys = [...new Set([...Array.from({ length: ny + 1 }, (_, j) => -y1 + (2 * y1 * j) / ny), ...(buraco && reta ? [-buraco[1], -buraco[0]] : [])].filter((y) => y >= -y1 && y <= y1))].sort((p, q) => p - q);
  for (let i = 0; i < nx; i++) {
    const a = -x1 + (2 * x1 * i) / nx, b = -x1 + (2 * x1 * (i + 1)) / nx;
    for (let j = 0; j < ys.length - 1; j++) if (!noBuraco(ys[j], ys[j + 1])) quad(a, b, ys[j], ys[j + 1]);
  }
  // as placas de fora (com o buraco, as de fora da faixa só)
  quad(-E / 2, E / 2, y1, larg / 2); quad(-E / 2, E / 2, -larg / 2, -y1);
  quad(-E / 2, -x1, -y1, y1); quad(x1, E / 2, -y1, y1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  const p = new THREE.Mesh(g, fosco(cor, { flatShading: false }));
  p.receiveShadow = true; G.add(p);
}

/** distância (ao longo da via) até o ponto de chegada (s = 0), na reta ou na volta */
function ateChegada(c: ControlePassagem, s: number) {
  if (c.via.tipo === 'reta') return Math.abs(s);
  const L = c.via.comp; let u = s % L; if (u < 0) u += L; return Math.min(u, L - u);
}

/** altura do fio de contato: a do pantógrafo levantado do trem (as fontes dele), ou nenhuma */
function alturaFio(c: ControlePassagem) {
  if (c.portador !== 'trem') return null;
  const z = c.fontes.filter((f) => f.tipo === 'pantografo').map((f) => f.pos[2]);
  return z.length ? Math.max(...z) : 5.5;
}

/** carro estacionado (modelo da estrada, fundido numa malha) */
function estacionado(lg: Lugar, s: number, m: number, tipo: TipoCarro, cor: number, contraMao: boolean) {
  const p = carro(tipo, cor, []), malha = fundir(p.g);
  soltarPecas(p.g);
  const w = lg.mundo(s, m, 0); malha.position.set(w[0], w[1], 0); malha.rotation.z = lg.rumoVia(s) + (contraMao ? Math.PI : 0);
  return malha;
}

export function montarMundo(c: ControlePassagem, brita: THREE.Texture | null): Mundo {
  const G = new THREE.Group(), dormentes: Dormentes[] = [];
  const lg = c.lugar(), via = c.via, cen = c.cenario(), reta = via.tipo === 'reta', Lv = via.comp;
  const s0 = reta ? -Lv / 2 : -Lv / 2, s1 = Lv / 2, passo = reta ? 40 : 4;
  const sorte = sorteio(0x77 + cen.length * 131);
  const w = c.corpo.segmentos[0]?.largura ?? 2, mCh = c.traj.lateral + w / 2;
  const longe = (s: number, d: number) => ateChegada(c, s) > d;
  const zFio = alturaFio(c);
  const ferro = c.portador === 'trem' || c.portador === 'locomotiva';
  const rodov = (c.portador === 'carro' || c.portador === 'trator') && c.traj.altitude <= 2;
  let relogio: Mundo['relogio'], morro: THREE.Object3D | undefined;
  const arv: Arvore[] = [];
  /** (s, m) livre de construções (com folga) */
  const cs = construcoes(cen, { tipo: via.tipo, comp: via.comp, R: via.R, ls: via.ls });
  const longeDasCasas = (s: number, m: number) => !cs.some((k) => Math.abs(s - k.s) < k.l / 2 + 4 && Math.abs(m - k.m) < k.p / 2 + 4);
  /** na volta, o miolo (m negativo) acaba no centro: nada passa de lá */
  const noMiolo = (m: number) => reta || m > -(via.R - 4);
  const livre = (mMin: number) => (s: number, m: number) => Math.abs(m) > mMin && longeDasCasas(s, m) && noMiolo(m) && Math.abs(m - mCh) + ateChegada(c, s) > 6;
  // faixas de árvores do horizonte próximo (os dois lados, um pouco de tudo), em quase todo cenário
  const matas = (mMin: number, por100 = 5) => {
    for (const sg of [-1, 1]) arv.push(...bosque(sorte, s0, s1, sg * mMin, sg * (mMin + 260), por100, { copa: 3, pinheiro: 1 }, [7, 15], livre(mMin * 0.9)));
  };
  /** lavouras em retalhos entre mA e mB (dos dois lados) */
  const lavouras = (mA: number, mB: number, z = 0) => {
    const l: { s0: number; s1: number; m0: number; m1: number; cor: number }[] = [];
    for (const sg of [-1, 1]) {
      let s = s0;
      while (s < s1) {
        const comp = 70 + sorte() * 120; let m = mA;
        while (m < mB) { const lg2 = 40 + sorte() * 90; if (noMiolo(-sg * 0 + sg * m)) l.push({ s0: s, s1: Math.min(s1, s + comp - 3), m0: sg * m, m1: sg * Math.min(mB, m + lg2 - 3), cor: LAVOURAS[Math.floor(sorte() * LAVOURAS.length)] }); m += lg2; }
        s += comp;
      }
    }
    G.add(retalhos(lg, l.filter((r) => reta || Math.min(r.m0, r.m1) > -(via.R - 4)), 1, z));
  };

  // ---------------------------------------------------------------- o chão e o horizonte
  // (no túnel, o que fica fora do tubo vai num grupo à parte: a cena o esconde quando você está lá dentro)
  const F = cen === 'tunel' ? new THREE.Group() : G;
  if (F !== G) { G.add(F); morro = F; }
  const corChao = cen === 'patio' ? GRAMA : cen === 'patio-ferro' ? 0x7f8a56 : GRAMA;
  const mRio = Math.max(7, mCh - 3);
  chao(F, c, corChao, cen === 'ponte' ? [-VALE.borda, VALE.borda] : cen === 'rio' ? [-95, mRio] : undefined);
  F.add(morros(via, cen === 'parque' ? 900 : 650, 3 + cen.length));

  // ---------------------------------------------------------------- a via que corre no lugar
  const lastroM = lastro(brita);
  const viasFerro: number[] = [];
  if (ferro || ['tunel', 'estacao', 'ponte', 'corte'].includes(cen) && !rodov) {
    viasFerro.push(0);
    if (cen === 'tunel' || (cen === 'ponte' && lg.segundaViaNaPonte)) viasFerro.push(-SEGUNDA_VIA);
    if (cen === 'estacao') viasFerro.push(ESTACAO_OUTRA.via);
    if (cen === 'ferrovia' && c.portador === 'trem') viasFerro.push(-4.5);
    if (cen === 'patio-ferro') viasFerro.push(-5, -10, -15, -20);
    for (const mv of viasFerro) linhaFerrea(G, lg, s0, s1, passo, mv, lastroM, dormentes, 0, cen === 'patio-ferro' && mv !== 0 ? 70 : undefined);
  }
  if (rodov && !['rua', 'estrada-rural', 'reta-arvores', 'fazenda'].includes(cen)) {
    // (o carro na estação, no túnel, na ponte, no corte: uma pista simples de duas faixas)
    asfalto(G, lg, s0, s1, passo, -5.25, 1.75, { centro: -1.75, bordas: [-5.1, 1.6] });
  }

  // ---------------------------------------------------------------- os cenários
  if (cen === 'tunel') {
    tuboPorDentro(G, lg, reta, zFio);
    if (reta && lg.tun) {
      morroEEmboque(F, lg);
      // árvores no alto do morro (na altura do terreno)
      const t = lg.tun, tubo = { ta: t.ta, tb: t.tb, mPerto: t.mPerto, mLonge: t.mLonge, h: t.h };
      for (const a of bosque(sorte, t.ta + 30, t.tb - 30, -90, 90, 9, { copa: 3, pinheiro: 2 }, [6, 12])) { const z = alturaMorro(tubo, a.s, a.m); if (z > t.h + 4) arv.push({ ...a, z }); }
    }
    // fora do morro: o campo dos dois lados, com a catenária nos trechos de fora
    if (zFio != null && lg.tun) for (const [a, b] of [[s0, lg.tun.ta - 40], [lg.tun.tb + 40, s1]] as const) if (b > a) catenaria(F, lg, a, b, viasFerro, zFio, -7.0);
    matas(130, 3);
  } else if (cen === 'estacao') {
    const e = estacao(lg, zFio); G.add(e.grupo); relogio = e.relogio;
    G.add(construir(lg, cs, 29));
    if (zFio != null) for (const [a, b] of [[s0, -170], [170, s1]] as const) if (b > a) catenaria(G, lg, a, b, viasFerro, zFio, -7.6);
    for (const [a, b] of [[s0, -165], [165, s1]] as const) if (b > a) { cerca(G, lg, a, b, 14, 1.4, 3); cerca(G, lg, a, b, -14, 1.4, 3); }
    matas(40, 4);
  } else if (cen === 'corte') {
    const sp = reta ? 50 : 5;
    // os taludes e o alto numa grade de alturas: o talude a 45° com o relevo de uns palmos (terra, capim seco, capim,
    // pedra, em manchas), o alto gramado até 700 m e descendo até o chão em 900 (fora do alcance de quem anda)
    const perfilCorte = (m: number) => { const a = Math.abs(m); return a <= CORTE.m0 ? 0 : a >= CORTE.m1 ? (a <= 700 ? CORTE.alto : Math.max(0, CORTE.alto * (1 - (a - 700) / 200))) : (a - CORTE.m0) * (CORTE.alto / (CORTE.m1 - CORTE.m0)); };
    const relevo = (s: number, m: number) => { const a = Math.abs(m); if (a <= CORTE.m0 + 0.5 || Math.abs(a - CORTE.m1) < 0.6) return 0; const k = a < CORTE.m1 ? 0.45 : 0.25; return k * (Math.sin(s / 6.3 + m * 0.7) + 0.6 * Math.cos(s / 2.9 - m * 1.3)); };
    const msC: number[] = [];
    for (const sg of [-1, 1]) for (const a of [CORTE.m0, 9.5, 11, 12.5, 14, 15.5, 17, 18.5, CORTE.m1, 24, 32, 50, 90, 160, 300, 500, 700, 800, 900]) msC.push(sg * a);
    // (grade fina perto do ponto de chegada, larga longe dele)
    const ssC = reta ? grade(s0, s1, 60, grade(Math.max(s0, -220), Math.min(s1, 220), 11)) : grade(s0, s1, 5);
    const manchas = [0x6b8a45, 0x8f8a55, 0x7e6a4c, 0x5f7f40, 0x8a8273, 0x77904a];
    G.add(terreno(lg, ssC, [...new Set(msC)].sort((p, q) => p - q), (s, m) => perfilCorte(m) + relevo(s, m), (z, s, m) => {
      const a = Math.abs(m);
      if (a > CORTE.m1 + 0.5) return [0x5f7f40, 0x648543, 0x5a7a3d][(Math.floor(s / 41) + Math.floor(a / 27)) % 3];
      return manchas[Math.abs(Math.floor(s / 5.5) * 7 + Math.floor(z / 2.2) * 3) % manchas.length];
    }));
    for (const sg of [-1, 1]) {
      // a canaleta de drenagem no pé do talude e a cerca lá em cima
      G.add(faixa(lg, s0, s1, sp, sg * (CORTE.m0 - 0.9), sg * (CORTE.m0 - 0.2), 0, 0, pintura(0x9a978f, 1)));
      const gAlto = new THREE.Group(); gAlto.position.z = CORTE.alto; G.add(gAlto);
      cerca(gAlto, lg, s0, s1, sg * (CORTE.m1 + 2.5), 1.3, 3, 0x8a7a62, 3);
    }
    if (zFio != null) catenaria(G, lg, s0, s1, [0], zFio, -5.2, 60, (s) => !longe(s, 10));
    const alto: Arvore[] = [];
    for (const sg of [-1, 1]) alto.push(...bosque(sorte, s0, s1, sg * (CORTE.m1 + 5), sg * 300, 7, { copa: 3, pinheiro: 1 }, [7, 15]));
    const ga = arvores(lg, alto, 31, [0, mCh]); ga.position.z = CORTE.alto; G.add(ga);
    // moitas no talude, na altura dele
    for (const sg of [-1, 1]) for (const a of bosque(sorte, s0, s1, sg * (CORTE.m0 + 1.5), sg * (CORTE.m1 - 1), 14, { arbusto: 1 }, [0.9, 2.2])) if (Math.abs(a.s) < 700 || (Math.round(a.s) & 3) === 0) arv.push({ ...a, z: perfilCorte(a.m) - 0.5 });
  } else if (cen === 'ponte') {
    ponteEVale(G, lg, c, s0, s1, reta, sorte, arv);
    if (zFio != null) catenaria(G, lg, s0, s1, viasFerro, zFio, PONTE.longe + 0.35, 60, (s) => !longe(s, 10));
  } else if (cen === 'ferrovia') {
    if (zFio != null) catenaria(G, lg, s0, s1, viasFerro, zFio, -7.6, 60, (s) => !longe(s, 12));
    else telegrafo(G, lg, s0, s1, -5.5, (s) => !longe(s, 10));
    cerca(G, lg, s0, s1, Math.max(13, mCh + 4), 1.3, 3); cerca(G, lg, s0, s1, -13, 1.3, 3);
    lavouras(Math.max(16, mCh + 7), 320);
    for (const sg of [-1, 1]) for (let m = 90; m < 330; m += 110 + sorte() * 60) arv.push(...alameda(sorte, s0, s1, sg * m, 14, [6, 12], 'copa', livre(15)));
    matas(340, 6);
    G.add(construir(lg, cs));
  } else if (cen === 'patio-ferro') {
    // o pátio: brita em volta das vias, o galpão das locomotivas, a torre de iluminação, o tanque de diesel, vagões parados
    G.add(retalhos(lg, [{ s0: -450, s1: 450, m0: -26, m1: 9, cor: 0x8d8573 }, { s0: -450, s1: 450, m0: mCh - 1.6, m1: mCh + 1.6, cor: 0x9a8f78 }], 1));
    G.add(construir(lg, cs));
    const vag: { s: number; m: number; tipo: number }[] = [];
    for (const [mv, ini, n] of [[-10, -160, 6], [-15, 40, 5], [-20, -90, 4]] as const) for (let i = 0; i < n; i++) vag.push({ s: ini + i * 16.5, m: mv, tipo: (i + Math.round(mv)) % 3 });
    G.add(vagoes(lg, vag));
    const torre = { pos: lg.mundo(35, -25, 11), rumo: lg.rumoVia(35) };
    G.add(repetir(new THREE.BoxGeometry(0.6, 0.6, 22), fosco(0x7d838a), [torre]), repetir(new THREE.BoxGeometry(1.8, 3.4, 1.4), fosco(0xf4efd2, { emissive: 0x6a6450 }), [{ pos: lg.mundo(35, -25, 22.4), rumo: lg.rumoVia(35) }]));
    const tq = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 7, 16).rotateX(Math.PI / 2), fosco(0xd9d5cc)); tq.position.set(...(lg.mundo(70, -45, 3.5) as [number, number, number])); G.add(tq);
    cerca(G, lg, s0, s1, 30, 1.8, 3, 0x8f949a, 3, true); cerca(G, lg, s0, s1, -95, 1.8, 3, 0x8f949a, 3, true);
    lavouras(110, 330);
    matas(120, 4);
  } else if (cen === 'rua') {
    rua(G, lg, c, s0, s1, passo, sorte, arv, cs);
  } else if (cen === 'estrada-rural' || cen === 'fazenda') {
    const fazenda = cen === 'fazenda';
    if (fazenda) G.add(faixa(lg, s0, s1, passo, -3, 3, 0, 0, pintura(0x9a7f58, 1)));
    else {
      asfalto(G, lg, s0, s1, passo, -5.25, 1.75, { tracejado: [-1.75], bordas: [-5.05, 1.55] });
      G.add(faixa(lg, s0, s1, passo, 1.75, 3.2, 0, 0, pintura(0x9a8f78, 1)), faixa(lg, s0, s1, passo, -6.7, -5.25, 0, 0, pintura(0x9a8f78, 1)));
      redeEletrica(G, lg, s0, s1, -8, 45, (s) => !longe(s, 10));
    }
    const mc = fazenda ? 4.5 : Math.max(11, mCh + 2.5);
    cerca(G, lg, s0, s1, mc, 1.3, 3.5, 0x8a6e4e, 3); cerca(G, lg, s0, s1, fazenda ? -4.5 : -9.5, 1.3, 3.5, 0x8a6e4e, 3);
    lavouras(mc + 2, 340);
    G.add(construir(lg, cs));
    // o silo do lado do celeiro e os fardos na lavoura
    const silo = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 14, 14).rotateX(Math.PI / 2), fosco(0xb9bcc0)); silo.position.set(...(lg.mundo(62, -70, 7) as [number, number, number])); silo.castShadow = true; G.add(silo);
    const fardos: Inst[] = [];
    for (let i = 0; i < 14; i++) fardos.push({ pos: lg.mundo(-60 + sorte() * 140, 30 + sorte() * 60, 0.75), rumo: sorte() * 3, cor: 0xcbb36a });
    G.add(repetir(new THREE.CylinderGeometry(0.75, 0.75, 1.2, 12), new THREE.MeshLambertMaterial({ flatShading: true }), fardos));
    for (const sg of [-1, 1]) arv.push(...alameda(sorte, s0, s1, sg * 120, 16, [6, 11], 'copa', livre(15)));
    matas(260, 5);
  } else if (cen === 'reta-arvores') {
    // a reta de Hunaudières: estrada de 9,5 m, guard-rail dos dois lados, alambrado do público, plátanos em fileira
    asfalto(G, lg, s0, s1, passo, -4.75, 4.75, { tracejado: [0], bordas: [-4.55, 4.55] });
    defensa(G, lg, s0, s1, 6.2, 1); defensa(G, lg, s0, s1, -6.2, -1);
    cerca(G, lg, s0, s1, Math.max(9, mCh - 1.2), 2.6, 3, 0x7d838a, 4, true);
    for (const m of [Math.max(20, mCh + 5), Math.max(27, mCh + 12), -14, -21]) arv.push(...alameda(sorte, s0, s1, m, 9, [15, 22], 'copa', (s, mm) => longeDasCasas(s, mm) && noMiolo(mm)));
    lavouras(Math.max(40, mCh + 25), 300);
    G.add(construir(lg, cs));
    matas(300, 4);
  } else if (cen === 'aerodromo') {
    aerodromo(G, lg, c, s0, s1, sorte, arv, cs);
  } else if (cen === 'parque') {
    parque(G, lg, c, s0, s1, passo, sorte, arv, cs);
  } else if (cen === 'patio') {
    G.add(retalhos(lg, [{ s0: -48, s1: 48, m0: -38, m1: 18, cor: 0xa9a69e }], 1));
    G.add(faixa(lg, -48, 48, 8, 4.2, 4.35, 0, 0, pintura(0xe2c23a, 2)), faixa(lg, -48, 48, 8, -4.35, -4.2, 0, 0, pintura(0xe2c23a, 2)));
    G.add(construir(lg, cs));
    const tq = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 6, 14).rotateZ(Math.PI / 2), fosco(0xd9d5cc)); tq.position.set(...(lg.mundo(-34, -6, 1.6) as [number, number, number])); tq.rotation.z = lg.rumoVia(-34); tq.castShadow = true; G.add(tq);
    cerca(G, lg, -48, 48, 18.5, 2.4, 3, 0x8f949a, 3, true); cerca(G, lg, -48, 48, -38.5, 2.4, 3, 0x8f949a, 3, true);
    postesDeLuz(G, lg, [{ s: -44, m: 16, lado: 1 }, { s: 44, m: 16, lado: 1 }, { s: -44, m: -36, lado: -1 }, { s: 44, m: -36, lado: -1 }], 11);
    lavouras(60, 300);
    matas(90, 4);
  } else if (cen === 'rio') {
    rio(G, lg, c, s0, s1, passo, sorte, arv);
    G.add(construir(lg, cs));
  }
  if (arv.length) F.add(arvores(lg, arv, 17, [0, mCh]));
  G.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.receiveShadow = true; });
  return { grupo: G, dormentes, relogio, cenario: cen, morro };
}

/** vagões de carga parados no pátio: fechado, tanque e gôndola, com os truques */
function vagoes(lg: Lugar, l: readonly { s: number; m: number; tipo: number }[]) {
  const caixas: Inst[] = [], tanques: Inst[] = [], truques: Inst[] = [];
  for (const v of l) {
    const r = lg.rumoVia(v.s), P = (ds: number, z: number) => lg.mundo(v.s + ds, v.m, z);
    if (v.tipo === 1) tanques.push({ pos: P(0, 2.4), rumo: r, esc: [15, 1.5, 1.5], cor: 0x2b2e33 });
    else caixas.push({ pos: P(0, 1.2), rumo: r, esc: [15, 2.9, v.tipo === 0 ? 2.9 : 1.6], cor: v.tipo === 0 ? 0x8a3f2a : 0x5b5f63 });
    for (const d of [-5.5, 5.5]) truques.push({ pos: P(d, 0.75), rumo: r, esc: [2.6, 2.2, 0.6], cor: 0x2a2d31 });
  }
  const G = new THREE.Group(), mat = new THREE.MeshLambertMaterial({ flatShading: true });
  const caixa = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
  const cil = new THREE.CylinderGeometry(1, 1, 1, 14); cil.rotateZ(Math.PI / 2);
  if (caixas.length) G.add(repetir(caixa, mat, caixas));
  if (tanques.length) G.add(repetir(cil, mat, tanques));
  G.add(repetir(new THREE.BoxGeometry(1, 1, 1), mat, truques));
  G.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
  return G;
}

/** o viaduto: tabuleiro, passeio, guarda-corpos e pilares; embaixo, o vale com o rio, as lavouras e as árvores */
function ponteEVale(G: THREE.Group, lg: Lugar, c: ControlePassagem, s0: number, s1: number, reta: boolean, sorte: () => number, arv: Arvore[]) {
  const sp = reta ? 50 : 5, conc = fosco(0xa9a69e);
  G.add(prisma(lg, s0, s1, sp, [[PONTE.longe, 0], [PONTE.perto, 0], [PONTE.perto, -PONTE.espessura], [PONTE.longe, -PONTE.espessura]], conc, false));
  G.add(prisma(lg, s0, s1, sp, [[PONTE.longe + 0.6, -PONTE.espessura], [PONTE.perto - 0.6, -PONTE.espessura], [PONTE.perto - 1.6, -PONTE.espessura - 1.2], [PONTE.longe + 1.6, -PONTE.espessura - 1.2]], fosco(0x8f8c84), false));
  G.add(prisma(lg, s0, s1, sp, [[lg.passeio, 0], [lg.passeio, PONTE.meioFio], [PONTE.perto, PONTE.meioFio], [PONTE.perto, 0]], fosco(0xb0ada6), false));
  const guarda = fosco(0x8d9095);
  // do lado de lá, a barreira de concreto; do seu lado, o guarda-corpo de pedestre vazado (mureta, montantes a cada 2 m,
  // corrimão e travessa): dá para ver o vale por ele
  G.add(prisma(lg, s0, s1, sp, [[PONTE.longe, 0], [PONTE.longe, PONTE.guarda], [PONTE.longe + 0.25, PONTE.guarda], [PONTE.longe + 0.25, 0]], guarda, false));
  const zc = PONTE.meioFio, mg = PONTE.perto - 0.12;
  G.add(prisma(lg, s0, s1, sp, [[mg - 0.13, zc], [mg - 0.13, zc + 0.25], [mg + 0.12, zc + 0.25], [mg + 0.12, zc]], guarda, false));
  for (const z of [zc + PONTE.guarda - 0.06, zc + 0.62]) G.add(prisma(lg, s0, s1, sp, [[mg - 0.04, z], [mg - 0.04, z + 0.07], [mg + 0.04, z + 0.07], [mg + 0.04, z]], fosco(0x6b7077), false));
  const mont: Inst[] = [];
  for (let s = Math.ceil(Math.max(s0, -1500) / 2) * 2; s <= Math.min(s1, 1500); s += 2) mont.push({ pos: lg.mundo(s, mg, zc + 0.25), rumo: lg.rumoVia(s) });
  G.add(repetir(new THREE.BoxGeometry(0.07, 0.07, PONTE.guarda - 0.25).translate(0, 0, (PONTE.guarda - 0.25) / 2), fosco(0x6b7077), mont));
  // pilares a cada 40 m, com o capitel embaixo do tabuleiro, do fundo do vale ao tabuleiro
  const pils: Inst[] = [], caps: Inst[] = [], mc = (PONTE.perto + PONTE.longe) / 2;
  const base = reta ? alturaVale(mc, PONTE.vale) : PONTE.vale, h = -PONTE.espessura - 1.2 - base;
  for (let x = Math.ceil(Math.max(s0, -1200) / 40) * 40; x <= Math.min(s1, 1200); x += 40) {
    pils.push({ pos: lg.mundo(x, mc, base), rumo: lg.rumoVia(x), esc: [2.4, 4.2, h] });
    caps.push({ pos: lg.mundo(x, mc, -PONTE.espessura - 1.2 - 1.0), rumo: lg.rumoVia(x), esc: [3.0, PONTE.perto - PONTE.longe - 3.6, 1.0] });
  }
  const caixa = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
  G.add(repetir(caixa, fosco(0x8f8c84), pils), repetir(caixa, fosco(0x8f8c84), caps));
  if (!reta) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), fosco(0x6f7a4a)); p.position.z = PONTE.vale; G.add(p);
    return;
  }
  // o vale: o fundo plano e as encostas (grade de alturas), o rio correndo ao lado do viaduto
  const ss = grade(s0 - 600, s1 + 600, 120), ms = grade(-VALE.borda - 10, VALE.borda + 10, 20, [-VALE.borda, -VALE.fundo, VALE.fundo, VALE.borda]);
  const verdes = [0x6b8a45, 0x5f8040, 0x77924c, 0x62853f];
  G.add(terreno(lg, ss, ms, (_s, m) => alturaVale(m, PONTE.vale) - 0.02, (z, s, m) => verdes[(Math.floor(s / 90) + Math.floor(m / 45) + (z > -20 ? 2 : 0)) & 3]));
  const zr = PONTE.vale + 0.02;
  G.add(faixa(lg, s0 - 600, s1 + 600, 60, -VALE.rio - VALE.larguraRio / 2, -VALE.rio + VALE.larguraRio / 2, zr, zr, pintura(0x3d6f86, 2)));
  // lavouras no fundo do vale e árvores nas margens do rio e nas encostas
  const l: { s0: number; s1: number; m0: number; m1: number; cor: number }[] = [];
  for (let s = s0; s < s1; s += 90 + sorte() * 80) for (const [a, b] of [[15, 160], [-VALE.rio + VALE.larguraRio / 2 + 12, -15], [-160, -VALE.rio - VALE.larguraRio / 2 - 12]] as const) l.push({ s0: s, s1: s + 70 + sorte() * 40, m0: a, m1: b, cor: LAVOURAS[Math.floor(sorte() * LAVOURAS.length)] });
  G.add(retalhos(lg, l, 1, PONTE.vale + 0.01));
  const margens: Arvore[] = [];
  for (const m of [-VALE.rio - VALE.larguraRio / 2 - 4, -VALE.rio + VALE.larguraRio / 2 + 4]) margens.push(...alameda(sorte, s0, s1, m, 11, [8, 14]));
  const gm = arvores(lg, margens, 23, [0, c.traj.lateral]); gm.position.z = PONTE.vale; G.add(gm);
  for (const sg of [-1, 1]) arv.push(...bosque(sorte, s0, s1, sg * (VALE.borda + 5), sg * (VALE.borda + 260), 6, { copa: 3, pinheiro: 1 }, [7, 15]));
  void c;
}

/** a rua de bairro: asfalto com a pintura, meio-fio e calçadas, casas e prédios baixos, árvores, postes, carros parados */
function rua(G: THREE.Group, lg: Lugar, c: ControlePassagem, s0: number, s1: number, passo: number, sorte: () => number, arv: Arvore[], cs: ReturnType<typeof construcoes>) {
  const R = RUA_M, h = 0.15, reta = c.via.tipo === 'reta';
  asfalto(G, lg, s0, s1, passo, R.longe, R.perto, { centro: -1.75, bordas: [1.75, -5.25] });
  calcada(G, lg, s0, s1, passo, R.perto, R.calcadaPerto, h);
  calcada(G, lg, s0, s1, passo, R.longe, R.calcadaLonge, h);
  G.add(construir(lg, cs, 13));
  // jardins da frente: grama mais viva entre a calçada e as casas (o chão em volta), muretas baixas nas divisas
  const ate = (s: number) => ateChegada(c, s);
  const longeCasa = (s: number, m: number) => !cs.some((k) => Math.abs(s - k.s) < k.l / 2 + 1.5 && Math.abs(m - k.m) < k.p / 2 + 1.5);
  // árvores na calçada (no canteiro junto do meio-fio de lá e no fundo da calçada de cá) e postes de luz
  for (const [m, lado] of [[R.calcadaPerto - 0.8, 1], [R.calcadaLonge + 0.8, -1]] as const) {
    for (let s = s0 + 8; s < s1 - 8; s += 16 + sorte() * 8) if (ate(s) > 7 && (reta || m > -(c.via.R - 6))) arv.push({ s, m, h: 6 + sorte() * 4, tipo: 'copa' });
    void lado;
  }
  const postes: { s: number; m: number; lado: 1 | -1 }[] = [];
  for (let s = s0 + 20; s < s1 - 10; s += 34) if (ate(s) > 9) postes.push({ s, m: R.perto + 0.45, lado: 1 });
  postesDeLuz(G, lg, postes, 8);
  redeEletrica(G, lg, s0, s1, R.longe - 0.5, 34, (s) => ate(s) < 9);
  // árvores nos quintais (atrás e entre as casas)
  for (const sg of [-1, 1]) arv.push(...bosque(sorte, s0, s1, sg * 14, sg * 60, 9, { copa: 4, pinheiro: 1 }, [5, 11], (s, m) => longeCasa(s, m) && (reta || m > -(c.via.R - 8))));
  // carros parados na faixa de estacionar (do lado de lá, e alguns do lado de cá, longe de você)
  const tipos: TipoCarro[] = ['sedan', 'hatch', 'picape', 'cupe', 'hatch', 'sedan'], cores = [0xb9bcc0, 0x2b2e33, 0x8a2a22, 0xeef0f2, 0x2f5aa8, 0x5f7f9a, 0x3f6b46];
  let n = 0;
  for (let s = s0 + 30; s < s1 - 30 && n < 9; s += 28 + sorte() * 40) {
    const deCa = sorte() < 0.35;
    if (deCa && ate(s) < 25) continue;
    const m = deCa ? 1.75 + 1.1 : -5.25 - 1.1;
    if (!reta && m < -(c.via.R - 6)) continue;
    G.add(estacionado(lg, s, m, tipos[n % tipos.length], cores[Math.floor(sorte() * cores.length)], !deCa)); n++;
  }
}

/** o aeródromo: a pista paralela ao voo, o taxiway, o pátio com os hangares e a torre, a biruta, a cerca, aviões parados */
function aerodromo(G: THREE.Group, lg: Lugar, c: ControlePassagem, s0: number, s1: number, sorte: () => number, arv: Arvore[], cs: ReturnType<typeof construcoes>) {
  const A = AERO, a = Math.max(s0 + 50, -1500), b = Math.min(s1 - 50, 1500), mP = A.pista, mh = A.meiaPista, reta = c.via.tipo === 'reta';
  if (!reta) { G.add(construir(lg, cs)); return; }
  // a pista com as faixas laterais, a linha de centro tracejada e as "teclas de piano" das cabeceiras
  G.add(faixa(lg, a, b, 100, mP - mh, mP + mh, 0, 0, pintura(0x55585d, 1)));
  const branco = pintura(0xeceae4, 2), w: [number, number, number] = [0, 0, 0];
  G.add(faixa(lg, a, b, 100, mP - mh + 1, mP - mh + 1.5, 0, 0, branco), faixa(lg, a, b, 100, mP + mh - 1.5, mP + mh - 1, 0, 0, branco));
  const marcas: Inst[] = [];
  for (let s = a + 120; s < b - 120; s += 50) marcas.push({ pos: lg.mundo(s, mP, 0, w).slice(), rumo: lg.rumoVia(s), esc: [30, 0.9, 1] });
  for (const [sx, d] of [[a + 10, 1], [b - 10, -1]] as const) for (let k = -7; k <= 7; k++) if (k !== 0) marcas.push({ pos: lg.mundo(sx + d * 25, mP + k * 2.6, 0, w).slice(), rumo: lg.rumoVia(sx), esc: [45, 1.6, 1] });
  G.add(repetir(new THREE.PlaneGeometry(1, 1), branco, marcas));
  // o taxiway paralelo e as ligações com a pista, o pátio de concreto
  G.add(faixa(lg, a + 60, b - 60, 100, A.taxi[0], A.taxi[1], 0, 0, pintura(0x5d6065, 1)), faixa(lg, a + 60, b - 60, 100, (A.taxi[0] + A.taxi[1]) / 2 - 0.2, (A.taxi[0] + A.taxi[1]) / 2 + 0.2, 0, 0, pintura(0xe2b33a, 2)));
  const lig: { s0: number; s1: number; m0: number; m1: number; cor: number }[] = [];
  for (const s of [a + 80, -400, 300, b - 100]) lig.push({ s0: s - 11, s1: s + 11, m0: A.taxi[1], m1: mP - mh, cor: 0x5d6065 });
  lig.push({ s0: -220, s1: 120, m0: A.patio[0], m1: A.patio[1], cor: 0xa9a69e });
  G.add(retalhos(lg, lig, 1));
  G.add(construir(lg, cs));
  // biruta (opaca: o cone laranja e branco no mastro) do lado de cá da pista, a cerca do aeroporto
  const bir = lg.mundo(35, A.cerca - 8, 0), gb = new THREE.Group(); gb.position.set(bir[0], bir[1], 0);
  const mastro = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 6, 6).rotateX(Math.PI / 2), fosco(0xd9d5cc)); mastro.position.z = 3; gb.add(mastro);
  for (let i = 0; i < 4; i++) { const k = new THREE.Mesh(new THREE.CylinderGeometry(0.42 - i * 0.07, 0.35 - i * 0.07, 0.9, 10).rotateZ(Math.PI / 2), fosco(i % 2 ? 0xeef0f2 : 0xe0702a)); k.position.set(0.5 + i * 0.9, 0, 5.75 - i * 0.12); gb.add(k); }
  gb.rotation.z = 2.3; gb.traverse((o) => { o.castShadow = true; }); G.add(gb);
  cerca(G, lg, a - 100, b + 100, A.cerca, 2.2, 3, 0x8f949a, 3, true);
  // a estradinha de terra junto da cerca, por onde se chega a pé
  G.add(faixa(lg, s0, s1, 100, -2.2, 2.2, 0, 0, pintura(0x9a8a6a, 1)));
  // aviões leves parados no pátio
  for (const [s, m, r] of [[-30, A.patio[1] - 22, 0.5], [-5, A.patio[1] - 26, -0.3], [20, A.patio[1] - 20, 0.2]] as const) {
    const par = { tipo: 'leve-alta' as const, L: 8.3, env: 11, cor: COR.branco, cor2: [0x2f5aa8, 0xb8322a, 0x3f6b46][Math.abs(Math.round(s)) % 3], pas: 2, rH: 0.95, trem: true };
    const p = aviaoHelice(par, [{ tipo: 'pa', id: 'pa', pos: [3.2, 0, 1.6] } as unknown as FonteSonora], [], []);
    const malha = fundir(p.g); soltarPecas(p.g);
    const q = lg.mundo(s, m, 0); malha.position.set(q[0], q[1], 0); malha.rotation.z = lg.rumoVia(s) + Math.PI / 2 + r; G.add(malha);
  }
  // do lado de cá: lavouras, árvores em fileiras e soltas perto de você; do lado de lá, o mato depois dos hangares
  lavouras(G, lg, s0, s1, 22, 95, sorte);
  for (let m = 12; m < 280; m += 55 + sorte() * 40) arv.push(...alameda(sorte, s0, s1, m, 15, [6, 12], 'copa', (s) => Math.abs(s) > 10));
  arv.push(...bosque(sorte, s0, s1, 4, 20, 6, { copa: 3, arbusto: 2 }, [4, 10], (s) => Math.abs(s) > 6));
  arv.push(...bosque(sorte, s0, s1, 300, 600, 8, { copa: 3, pinheiro: 2 }, [8, 16]));
  arv.push(...bosque(sorte, s0, s1, A.hangar - 60, -700, 6, { copa: 3, pinheiro: 2 }, [8, 16], (s, m) => !(Math.abs(s) < 260 && m > A.hangar - 70)));
}

/** lavouras de um lado só (m de mA a mB, positivo) */
function lavouras(G: THREE.Group, lg: Lugar, s0: number, s1: number, mA: number, mB: number, sorte: () => number) {
  const l: { s0: number; s1: number; m0: number; m1: number; cor: number }[] = [];
  let s = s0;
  while (s < s1) { const comp = 80 + sorte() * 140; let m = mA; while (m < mB) { const lg2 = 30 + sorte() * 50; l.push({ s0: s, s1: Math.min(s1, s + comp - 3), m0: m, m1: Math.min(mB, m + lg2 - 3), cor: LAVOURAS[Math.floor(sorte() * LAVOURAS.length)] }); m += lg2; } s += comp; }
  G.add(retalhos(lg, l, 1));
}

/** o parque: o caminho de pedestres, bancos, postes baixos, o lago, canteiros, árvores e a cidade em volta */
function parque(G: THREE.Group, lg: Lugar, c: ControlePassagem, s0: number, s1: number, passo: number, sorte: () => number, arv: Arvore[], cs: ReturnType<typeof construcoes>) {
  const caminho = pintura(0xcdbf9f, 1);
  G.add(faixa(lg, s0, s1, passo, -1.6, 1.6, 0, 0, caminho));
  for (let s = -360; s <= 360; s += 120) G.add(faixa(lg, s - 1.4, s + 1.4, 1, -140, 140, 0, 0, caminho));
  G.add(construir(lg, cs, 19));
  const w: [number, number, number] = [0, 0, 0], bancos: Inst[] = [];
  for (let s = -300; s <= 300; s += 30) if (Math.abs(s) > 4) bancos.push({ pos: lg.mundo(s + 8, 2.4, 0, w).slice(), rumo: lg.rumoVia(s) + Math.PI });
  const pb = new THREE.Group();
  const banco = new THREE.BoxGeometry(1.9, 0.45, 0.08).translate(0, 0, 0.46), encosto = new THREE.BoxGeometry(1.9, 0.08, 0.45).translate(0, 0.22, 0.74);
  pb.add(repetir(banco, fosco(0x7a5a3c), bancos), repetir(encosto, fosco(0x7a5a3c), bancos));
  G.add(pb);
  const postes: { s: number; m: number; lado: 1 | -1 }[] = [];
  for (let s = -310; s <= 310; s += 25) if (Math.abs(s) > 5) postes.push({ s, m: -2.6, lado: -1 });
  postesDeLuz(G, lg, postes, 4.2);
  // o lago (um polígono de água no chão) e os canteiros de flores
  const lago = new THREE.Shape(), centro = lg.mundo(60, -38, 0);
  for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI * 2, r = 1 + 0.12 * Math.sin(3 * a + 1); const x = 42 * r * Math.cos(a), y = 17 * r * Math.sin(a); i ? lago.lineTo(x, y) : lago.moveTo(x, y); }
  const ml = new THREE.Mesh(new THREE.ShapeGeometry(lago), pintura(0x3d6f86, 2)); ml.position.set(centro[0], centro[1], 0); ml.rotation.z = lg.rumoVia(60); G.add(ml);
  const can: { s0: number; s1: number; m0: number; m1: number; cor: number }[] = [];
  for (let s = -300; s < 300; s += 55 + sorte() * 40) { const lado = sorte() < 0.5 ? 1 : -1; can.push({ s0: s, s1: s + 6 + sorte() * 6, m0: lado * 4, m1: lado * (6.5 + sorte() * 2), cor: [0xc0453a, 0xe2b33a, 0xd9d5cc, 0x9a5aa8][Math.floor(sorte() * 4)] }); }
  G.add(retalhos(lg, can, 2));
  const livre = (s: number, m: number) => Math.abs(m) > 3.5 && !(Math.abs(s - 60) < 50 && m < -15 && m > -62) && !cs.some((k) => Math.abs(s - k.s) < k.l / 2 + 4 && Math.abs(m - k.m) < k.p / 2 + 4) && !(Math.abs(s % 120) < 3);
  for (const sg of [-1, 1]) arv.push(...bosque(sorte, s0, s1, sg * 4, sg * 140, 16, { copa: 5, pinheiro: 1, arbusto: 2 }, [5, 13], livre));
  void c;
}

/** o rio do vapor de rodas: a água com as margens, o trapiche de onde você vê, as árvores das duas margens */
function rio(G: THREE.Group, lg: Lugar, c: ControlePassagem, s0: number, s1: number, passo: number, sorte: () => number, arv: Arvore[]) {
  const mCh = c.traj.lateral + (c.corpo.segmentos[0]?.largura ?? 9) / 2, perto = Math.max(7, mCh - 3), longe = -95, zA = -0.6;
  // a água e as margens (a água fica abaixo do chão: o chão daqui some no barranco)
  G.add(faixa(lg, s0, s1, passo, longe, perto, zA, zA, fosco(0x3d6f86)));
  G.add(faixa(lg, s0, s1, passo, perto, perto + 1.6, zA - 0.1, 0.05, fosco(0x8a7656)), faixa(lg, s0, s1, passo, longe - 1.6, longe, 0.05, zA - 0.1, fosco(0x8a7656)));
  // trapiche de madeira: o deque até a água e as estacas
  const sT = 0, a = perto - 3.5, b = perto + 4;
  G.add(prisma(lg, sT - 3, sT + 3, 1, [[a, 0.05], [a, 0.25], [b, 0.25], [b, 0.05]], fosco(0x8a6a48), true));
  const est: Inst[] = [];
  for (const ds of [-2.7, 2.7]) for (const m of [a + 0.2, (a + b) / 2, b - 0.2]) est.push({ pos: lg.mundo(sT + ds, m, -0.5), rumo: 0 });
  G.add(repetir(new THREE.CylinderGeometry(0.14, 0.14, 1.6, 6).rotateX(Math.PI / 2), fosco(0x6a5038), est));
  for (const m of [perto + 3, longe - 6]) arv.push(...alameda(sorte, s0, s1, Math.sign(m) * Math.abs(m), 10, [7, 14], 'copa', (s) => ateChegada(c, s) > 6 || m < 0));
  arv.push(...bosque(sorte, s0, s1, perto + 8, 300, 6, { copa: 3, pinheiro: 1 }, [7, 14], (s, m) => ateChegada(c, s) + Math.abs(m - mCh) > 8));
  arv.push(...bosque(sorte, s0, s1, longe - 10, -320, 8, { copa: 3, pinheiro: 1 }, [7, 14]));
}
