// Os lugares de onde se vê cada avião passar (planta.ts escolhe qual): você fica sempre no mesmo ponto debaixo da
// trajetória (o som não muda), e o que muda é o aeródromo em volta: a beira da pista de um festival aéreo, a cabeceira de
// um aeroporto regional, o gramado do pátio do aeroclube, a cerca de uma base, o campo longe de tudo. A trajetória corre
// ao longo de s, o avião vem de s negativo; m cresce para o seu lado.
import * as THREE from 'three';
import type { ControlePassagem } from '../controle';
import type { Lugar } from '../lugar';
import { type Cenario, type Construcao, AERO_PISTA, AERO_CABECEIRA, AERO_PATIO, AERO_CERCA } from './planta';
import { fosco, pintura, faixa, prisma, repetir, type Inst } from './geo';
import { cerca, redeEletrica, fios } from './vias';
import { alameda, bosque, retalhos, type Arvore } from './natureza';
import { construir } from './construcoes';
import { leveLinha, leveTravessa, leveCirculo } from './leves';
import { aviaoHelice } from '../modelos/ar';
import { fundir, soltarPecas } from '../modelos/fundir';
import { COR } from '../modelos/kit';
import type { FonteSonora } from '../../../scene/tipos';

const LAVOURAS = [0x8f9a4a, 0xa89a5a, 0x6d8a3e, 0x7f6a4c, 0xb3a35f, 0x5f8a45];
const ASFALTO = 0x55585d;

/** pista: o asfalto de s0 a s1 em volta de mc, as faixas laterais, o eixo tracejado, as cabeceiras e as luzes de borda */
function pista(G: THREE.Group, lg: Lugar, s0: number, s1: number, mc: number, meia: number, cabeceiras: readonly number[], luzes = true) {
  G.add(faixa(lg, s0, s1, 100, mc - meia, mc + meia, 0, 0, pintura(ASFALTO, 1)));
  const branco = pintura(0xeceae4, 2), w: [number, number, number] = [0, 0, 0];
  G.add(faixa(lg, s0, s1, 100, mc - meia + 1, mc - meia + 1.5, 0, 0, branco), faixa(lg, s0, s1, 100, mc + meia - 1.5, mc + meia - 1, 0, 0, branco));
  const marcas: Inst[] = [];
  for (let s = s0 + 120; s < s1 - 120; s += 50) marcas.push({ pos: lg.mundo(s, mc, 0, w).slice(), rumo: lg.rumoVia(s), esc: [30, 0.9, 1] });
  for (const sx of cabeceiras) {
    const d = sx < (s0 + s1) / 2 ? 1 : -1;
    for (let k = -7; k <= 7; k++) if (k !== 0) marcas.push({ pos: lg.mundo(sx + d * 25, mc + k * 2.6, 0, w).slice(), rumo: lg.rumoVia(sx), esc: [45, 1.6, 1] });
    marcas.push({ pos: lg.mundo(sx + d * 300, mc - 9, 0, w).slice(), rumo: lg.rumoVia(sx), esc: [60, 6, 1] }, { pos: lg.mundo(sx + d * 300, mc + 9, 0, w).slice(), rumo: lg.rumoVia(sx), esc: [60, 6, 1] });
  }
  G.add(repetir(new THREE.PlaneGeometry(1, 1), branco, marcas));
  if (!luzes) return;
  // as luzes de borda (brancas, acesas) e as de cabeceira (verdes de um lado, vermelhas do outro)
  const borda: Inst[] = [], verdes: Inst[] = [], vermelhas: Inst[] = [];
  for (let s = s0 + 5; s < s1; s += 60) for (const sg of [-1, 1]) borda.push({ pos: lg.mundo(s, mc + sg * (meia + 1.2), 0.25, w).slice(), rumo: lg.rumoVia(s) });
  for (const sx of cabeceiras) for (let k = -8; k <= 8; k++) (sx < (s0 + s1) / 2 ? verdes : vermelhas).push({ pos: lg.mundo(sx, mc + k * 2.7, 0.2, w).slice(), rumo: lg.rumoVia(sx) });
  const geo = new THREE.BoxGeometry(0.3, 0.3, 0.3), poste = new THREE.CylinderGeometry(0.04, 0.04, 0.25, 6).rotateX(Math.PI / 2).translate(0, 0, -0.12);
  G.add(repetir(geo, new THREE.MeshBasicMaterial({ color: 0xfff4d0 }), borda), repetir(poste, fosco(0x5b5f63), borda));
  if (verdes.length) G.add(repetir(geo, new THREE.MeshBasicMaterial({ color: 0x5cff8a }), verdes));
  if (vermelhas.length) G.add(repetir(geo, new THREE.MeshBasicMaterial({ color: 0xff4a3a }), vermelhas));
}

/** biruta (o cone laranja e branco no mastro) em (s, m) */
function biruta(G: THREE.Group, lg: Lugar, s: number, m: number, rumo = 2.3) {
  const bir = lg.mundo(s, m, 0), gb = new THREE.Group(); gb.position.set(bir[0], bir[1], 0);
  leveCirculo(s, m, 0.1, 6);
  const mastro = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 6, 6).rotateX(Math.PI / 2), fosco(0xd9d5cc)); mastro.position.z = 3; gb.add(mastro);
  for (let i = 0; i < 4; i++) { const k = new THREE.Mesh(new THREE.CylinderGeometry(0.42 - i * 0.07, 0.35 - i * 0.07, 0.9, 10).rotateZ(Math.PI / 2), fosco(i % 2 ? 0xeef0f2 : 0xe0702a)); k.position.set(0.5 + i * 0.9, 0, 5.75 - i * 0.12); gb.add(k); }
  gb.rotation.z = rumo; gb.traverse((o) => { o.castShadow = true; }); G.add(gb);
}

/** aviões leves parados (o Cessna de asa alta), em (s, m, giro em relação à via) */
function parados(G: THREE.Group, lg: Lugar, l: readonly (readonly [number, number, number])[]) {
  l.forEach(([s, m, r], i) => {
    const par = { tipo: 'leve-alta' as const, L: 8.3, env: 11, cor: COR.branco, cor2: [0x2f5aa8, 0xb8322a, 0x3f6b46, 0xe2b33a][i % 4], pas: 2, rH: 0.95, trem: true };
    const p = aviaoHelice(par, [{ tipo: 'pa', id: 'pa', pos: [3.2, 0, 1.6] } as unknown as FonteSonora], [], []);
    const malha = fundir(p.g); soltarPecas(p.g);
    const q = lg.mundo(s, m, 0); malha.position.set(q[0], q[1], 0); malha.rotation.z = lg.rumoVia(s) + r; G.add(malha);
  });
}

/** cerca de tela atravessando a via (de m0 a m1 na abscissa s), com os mourões e o arame de cima */
function cercaTransversal(G: THREE.Group, lg: Lugar, s: number, m0: number, m1: number, h = 2.4) {
  const ps: Inst[] = [], w: [number, number, number] = [0, 0, 0];
  for (let m = m0; m <= m1; m += 3) ps.push({ pos: lg.mundo(s, m, h / 2, w).slice(), rumo: lg.rumoVia(s) });
  leveTravessa(s, m0, m1, h);
  G.add(repetir(new THREE.BoxGeometry(0.07, 0.07, h), fosco(0x8f949a), ps));
  const pos: number[] = [], a: [number, number, number] = [0, 0, 0], b: [number, number, number] = [0, 0, 0];
  for (const z of [h * 0.2, h * 0.45, h * 0.7, h - 0.04, h + 0.2]) { lg.mundo(s, m0, z, a); lg.mundo(s, m1, z, b); pos.push(...a, ...b); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  G.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x7d838a })));
}

/** lavouras de um lado (m de mA a mB), com a semente do lugar */
function lavouras(G: THREE.Group, lg: Lugar, s0: number, s1: number, mA: number, mB: number, sorte: () => number) {
  const l: { s0: number; s1: number; m0: number; m1: number; cor: number }[] = [];
  const [a, b] = [Math.min(mA, mB), Math.max(mA, mB)];
  let s = s0;
  while (s < s1) { const comp = 80 + sorte() * 140; let m = a; while (m < b) { const lg2 = 30 + sorte() * 50; l.push({ s0: s, s1: Math.min(s1, s + comp - 3), m0: m, m1: Math.min(b, m + lg2 - 3), cor: LAVOURAS[Math.floor(sorte() * LAVOURAS.length)] }); m += lg2; } s += comp; }
  G.add(retalhos(lg, l, 1));
}

/** o aeródromo da variante `cen` */
export function aero(G: THREE.Group, lg: Lugar, c: ControlePassagem, cen: Cenario, s0: number, s1: number, sorte: () => number, arv: Arvore[], cs: readonly Construcao[]) {
  const a = Math.max(s0 + 50, -1500), b = Math.min(s1 - 50, 1500);
  const longeCasa = (s: number, m: number) => !cs.some((k) => Math.abs(s - k.s) < k.l / 2 + 5 && Math.abs(m - k.m) < k.p / 2 + 5);
  if (c.via.tipo !== 'reta') { G.add(construir(lg, cs)); return; }
  if (cen === 'aero-pista') {
    // festival aéreo: você no gramado da beira da pista, o público atrás do alambrado; do outro lado, os hangares e a torre
    const P = AERO_PISTA;
    pista(G, lg, a, b, P.pista, P.meia, [a + 10, b - 10]);
    G.add(faixa(lg, a + 60, b - 60, 100, P.pista - 90, P.pista - 75, 0, 0, pintura(0x5d6065, 1)));
    G.add(retalhos(lg, [{ s0: -480, s1: -120, m0: P.pista - 170, m1: P.pista - 95, cor: 0xa9a69e }], 1));
    G.add(construir(lg, cs));
    // o alambrado baixo do público (as grades), as bandeirolas, a placa do festival
    // (grade de metal vazada: os pés e as duas barras)
    const pes: Inst[] = [];
    leveLinha(-200, 200, P.publico, 1.1);
    for (let s = -200; s <= 200; s += 2.4) pes.push({ pos: lg.mundo(s, P.publico, 0.55), rumo: lg.rumoVia(s) });
    G.add(repetir(new THREE.BoxGeometry(0.05, 0.05, 1.1), fosco(0x9aa0a6), pes));
    for (const z of [0.25, 1.05]) G.add(prisma(lg, -200, 200, 100, [[P.publico - 0.025, z], [P.publico + 0.025, z], [P.publico + 0.025, z + 0.05], [P.publico - 0.025, z + 0.05]], fosco(0x9aa0a6), false));
    const band: Inst[] = [];
    for (let s = -190; s <= 190; s += 12) band.push({ pos: lg.mundo(s, P.publico + 0.3, 3.2), rumo: lg.rumoVia(s), cor: [0xd94a3a, 0xe2b33a, 0x2f5aa8, 0xeef0f2][Math.abs(Math.round(s / 12)) % 4] });
    G.add(repetir(new THREE.CylinderGeometry(0.04, 0.04, 3.2, 5).rotateX(Math.PI / 2).translate(0, 0, -1.6), fosco(0xd9d5cc), band), repetir(new THREE.BoxGeometry(0.02, 0.6, 0.9).translate(0, 0.3, -0.5), new THREE.MeshLambertMaterial({ flatShading: true }), band));
    biruta(G, lg, -60, P.pista + P.meia + 18, 2.6);
    parados(G, lg, [[-120, P.pista - 110, 1.4], [-90, P.pista - 112, 1.7], [-60, P.pista - 108, 1.5]]);
    lavouras(G, lg, s0, s1, 40, 300, sorte);
    for (let m = 60; m < 280; m += 60 + sorte() * 40) arv.push(...alameda(sorte, s0, s1, m, 15, [6, 12], 'copa', (s, mm) => longeCasa(s, mm)));
    arv.push(...bosque(sorte, s0, s1, P.pista - 250, -700, 6, { copa: 3, pinheiro: 2 }, [8, 16]));
    return;
  }
  if (cen === 'aero-cabeceira') {
    // a cabeceira: a pista no eixo da trajetória, à sua frente, acabando em `fim`; a antena do localizador, a cerca
    // atravessada, o aeroporto lá no fim; o avião decola sobre a pista e vem subindo por cima de você
    const K = AERO_CABECEIRA, ini = -2700;
    pista(G, lg, ini, K.fim, 0, K.meia, [ini + 10, K.fim]);
    G.add(faixa(lg, K.fim, K.fim + 120, 40, -K.meia - 3, K.meia + 3, 0, 0, pintura(0x7c8a54, 1)));   // a área de escape, de grama rasteira
    // o localizador: a fileira de antenas na armação, de frente para a pista
    const ant: Inst[] = [], w: [number, number, number] = [0, 0, 0];
    for (let m = -14; m <= 14; m += 2) ant.push({ pos: lg.mundo(K.localizador, m, 1.6, w).slice(), rumo: lg.rumoVia(K.localizador) });
    G.add(repetir(new THREE.BoxGeometry(0.12, 0.6, 3.2), fosco(0xd9d5cc), ant));
    G.add(prisma(lg, K.localizador - 0.15, K.localizador + 0.15, 1, [[-15, 0.2], [-15, 0.45], [15, 0.45], [15, 0.2]], fosco(0xc8322a), true));
    // as luzes de aproximação da outra cabeceira (a barra no eixo a cada 30 m, nos postes, acesas) até a cerca
    const barras: Inst[] = [], postes: Inst[] = [];
    for (let s = K.fim + 26; s <= K.cerca - 10; s += 26) { const z = 1.6 + (s - K.cerca) * -0.004; barras.push({ pos: lg.mundo(s, 0, z, w).slice(), rumo: lg.rumoVia(s), esc: [0.3, 6, 0.25] }); postes.push({ pos: lg.mundo(s, 0, z / 2, w).slice(), rumo: lg.rumoVia(s), esc: [0.12, 0.12, z] }); }
    G.add(repetir(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xfff4d0 }), barras), repetir(new THREE.BoxGeometry(1, 1, 1), fosco(0xd94a3a), postes));
    cercaTransversal(G, lg, K.cerca, -300, 300, 2.4);
    G.add(faixa(lg, K.cerca + 3, K.cerca + 8, 1, -300, 300, 0, 0, pintura(0x9a8a6a, 1)));   // a estradinha de serviço ao longo da cerca
    G.add(construir(lg, cs));
    biruta(G, lg, -420, 60, 2.2);
    // o campo em volta: lavouras dos dois lados, a estrada de terra por onde se chega
    G.add(faixa(lg, -40, 600, 40, -2.5, 2.5, 0, 0, pintura(0x9a8a6a, 1)));
    lavouras(G, lg, s0, s1, 45, 330, sorte); lavouras(G, lg, s0, s1, -330, -45, sorte);
    redeEletrica(G, lg, -40, s1, 45, 40);
    arv.push(...bosque(sorte, K.cerca + 20, s1, 15, 250, 7, { copa: 3, pinheiro: 1 }, [6, 14], (s, m) => Math.abs(m) > 8 && Math.hypot(s, m - 1.4) > 10));
    arv.push(...bosque(sorte, K.cerca + 20, s1, -250, -15, 7, { copa: 3, pinheiro: 1 }, [6, 14]));
    return;
  }
  if (cen === 'aero-patio') {
    // o aeroclube: você no gramado na beira do pátio, os aviões parados à sua frente, os hangares, o clube e a torrinha
    const P = AERO_PATIO;
    G.add(retalhos(lg, [{ s0: -110, s1: 70, m0: P.patio[0], m1: P.patio[1], cor: 0xa9a69e }], 1));
    G.add(faixa(lg, -110, 70, 10, P.patio[1] - 0.3, P.patio[1], 0, 0, pintura(0xe2b33a, 2)));
    pista(G, lg, a, b, P.pista, 15, [a + 10, b - 10]);
    G.add(faixa(lg, -40, -18, 2, P.pista + 15, P.patio[0], 0, 0, pintura(0x5d6065, 1)));
    G.add(construir(lg, cs));
    parados(G, lg, [[-42, -14, 1.3], [-28, -16, 1.9], [-14, -15, 1.6], [-60, -34, 1.2], [8, -30, 2.0]]);
    biruta(G, lg, -20, P.pista + 26, 2.0);
    // a bomba de combustível e o tambor, a cerca baixa do clube atrás de você
    G.add(repetir(new THREE.BoxGeometry(0.8, 0.6, 1.6).translate(0, 0, 0.8), fosco(0xd94a3a), [{ pos: lg.mundo(24, -10, 0), rumo: lg.rumoVia(24) }]));
    cerca(G, lg, -120, 80, 12, 1.2, 3, 0xeeeae0, 2);
    lavouras(G, lg, s0, s1, 40, 300, sorte);
    arv.push(...bosque(sorte, s0, s1, 14, 40, 5, { copa: 3, arbusto: 2 }, [5, 11], (s, m) => Math.abs(s) > 12 || m > 25));
    for (let m = 60; m < 280; m += 55 + sorte() * 40) arv.push(...alameda(sorte, s0, s1, m, 15, [6, 12], 'copa'));
    arv.push(...bosque(sorte, s0, s1, P.pista - 60, -600, 6, { copa: 3, pinheiro: 2 }, [8, 16]));
    return;
  }
  if (cen === 'aero-cerca') {
    // a cerca da base: você do lado de fora, na estradinha, a tela com o arame farpado logo ali; lá dentro, a pista
    const P = AERO_CERCA;
    cerca(G, lg, a - 100, b + 100, P.cerca, 2.6, 3, 0x8f949a, 4, true);
    const farpa: { m: number; z: number }[] = [{ m: P.cerca - 0.15, z: 2.85 }, { m: P.cerca - 0.3, z: 3.0 }];
    fios(G, lg, a - 100, b + 100, farpa, 0x6b7077);
    const braco: Inst[] = [];
    for (let s = a - 100; s <= b + 100; s += 3) braco.push({ pos: lg.mundo(s, P.cerca - 0.15, 2.78), rumo: lg.rumoVia(s), incl: -0.7 });
    G.add(repetir(new THREE.BoxGeometry(0.04, 0.45, 0.04), fosco(0x8f949a), braco));
    G.add(faixa(lg, s0, s1, 100, 0.5, 5.0, 0, 0, pintura(0x9a8a6a, 1)));
    pista(G, lg, a, b, P.pista, 22.5, [a + 10, b - 10]);
    G.add(faixa(lg, a + 60, b - 60, 100, P.pista - 55, P.pista - 40, 0, 0, pintura(0x5d6065, 1)));
    G.add(construir(lg, cs));
    G.add(prisma(lg, 36, 40, 1, [[4.6, 0], [4.6, 0.15], [9.4, 0.15], [9.4, 0]], fosco(0xa9a69e), true));
    // a placa da área militar presa na tela
    G.add(repetir(new THREE.BoxGeometry(1.2, 0.03, 0.8), fosco(0xd94a3a), [{ pos: lg.mundo(-14, P.cerca + 0.05, 1.6), rumo: lg.rumoVia(-14) }, { pos: lg.mundo(-74, P.cerca + 0.05, 1.6), rumo: lg.rumoVia(-74) }]));
    biruta(G, lg, -260, P.pista + 30, 2.5);
    lavouras(G, lg, s0, s1, 14, 320, sorte);
    arv.push(...bosque(sorte, s0, s1, 8, 30, 5, { copa: 2, arbusto: 3 }, [2, 5], (s) => Math.abs(s) > 15));
    for (let m = 70; m < 300; m += 60 + sorte() * 40) arv.push(...alameda(sorte, s0, s1, m, 14, [6, 13], 'copa'));
    arv.push(...bosque(sorte, s0, s1, P.pista - 200, -700, 5, { copa: 2, pinheiro: 3 }, [8, 16]));
    return;
  }
  // o campo, longe de qualquer aeródromo: a estrada de terra, as lavouras, a vila, a linha de energia, o sítio
  G.add(faixa(lg, s0, s1, 100, -2.0, 2.6, 0, 0, pintura(0x9a8a6a, 1)));
  G.add(construir(lg, cs));
  cerca(G, lg, s0, s1, 4.2, 1.3, 3.5, 0x8a6e4e, 3); cerca(G, lg, s0, s1, -3.6, 1.3, 3.5, 0x8a6e4e, 3);
  redeEletrica(G, lg, s0, s1, 32, 45);
  lavouras(G, lg, s0, s1, 6, 140, sorte); lavouras(G, lg, s0, s1, -330, -6, sorte);
  arv.push(...alameda(sorte, s0, s1, -6.5, 18, [8, 14], 'copa', (s, m) => Math.abs(s) > 20 && longeCasa(s, m)));
  arv.push(...bosque(sorte, s0, s1, 140, 380, 6, { copa: 4, pinheiro: 1 }, [6, 12], longeCasa));
  arv.push(...bosque(sorte, s0, s1, -380, -60, 4, { copa: 3, pinheiro: 2 }, [7, 15], longeCasa));
}
