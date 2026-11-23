// O interior do veículo, para quem embarca (tecla B): a cabine opaca vista do assento. Do lado de fora o modelo é uma
// casca (modelos/), e de dentro dela não se vê nada (as faces de fora não são desenhadas pelo avesso): embarcado, a
// cena troca a casca do segmento em que você está por este interior, que traz a cabine (painel, volante ou manche,
// moldura do para-brisa e das janelas, teto, bancos) e o que se vê do veículo pelas janelas (o capô, o nariz do trem, a
// caldeira, a asa, o tanque e o guidão da moto). Janela é vão: nada de vidro, nada translúcido.
//
// O assento é o de pontos.ts (o ponto de onde a Cena ouve, que não muda aqui); a cabine é montada em volta dele, com as
// medidas do tipo do veículo (as mesmas dos modelos de fora). Tudo no referencial do corpo (x para a frente, y para a
// esquerda, z para cima); a cena 3D põe o grupo no segmento do assento.
import * as THREE from 'three';
import type { ControlePassagem } from '../controle';
import type { FonteSonora } from '../../../scene/tipos';
import { Pecas, COR, type Modelo } from './kit';
import { fundir, fundirGeometria, soltarPecas } from './fundir';
import { tipoCarro, paramsHelice, paramsJato, olhoPilotoHelice, raioFuselagem, fuselagemTransporte, type TipoCarro, type ParamsHelice } from './tipos';
import { aviaoHelice, jato } from './ar';
import { centros, geometriaSegmento } from './trilhos';
import { assento } from '../pontos';

type V3 = [number, number, number];
export interface Caixa { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }

export interface Interior {
  /** no referencial do corpo */
  grupo: THREE.Group;
  /** o segmento do corpo em que fica (a casca dele some enquanto você está dentro) */
  seg: number;
  /** onde o olho tem de estar (no corpo) para o interior aparecer no lugar da casca */
  mostrar: Caixa;
  /** as rodas de fora (instâncias) somem junto: o interior traz as que se veem dele */
  escondeRodas: boolean;
  /** rodas do interior (giram com a distância andada, em torno do y local) */
  rodas: Modelo['rodas'];
}

// cores de dentro
const TRIM = 0x3a3d42, PAINEL = 0x24272b, TETO = 0xc9c5bb, BANCO = 0x33363b, PISO = 0x2c2e31, METAL = 0x6b7077, PAREDE = 0xd6d3cb, MADEIRA = 0x7a5a3c, COURO = 0x5a3a28;
const LUZ = 0xfff4dc;

// ------------------------------------------------------------------ peças
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const X = v3(1, 0, 0);
/** barra (caixa fina) de `a` até `b`, seção e × e2 */
function barra(p: Pecas, a: readonly number[], b: readonly number[], e: number, cor: number, e2 = e, pai?: THREE.Object3D) {
  const d = v3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), l = d.length();
  const o = p.caixa(l + e * 0.5, e, e2, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, cor, pai);
  o.quaternion.setFromUnitVectors(X, d.normalize());
  return o;
}
/** os retângulos que cobrem [a0, a1] × [b0, b1] menos os furos [a0, a1, b0, b1] */
function semFuros(a0: number, a1: number, b0: number, b1: number, furos: readonly (readonly number[])[]) {
  const cortes = (lo: number, hi: number, k: number) => [...new Set([lo, hi, ...furos.flatMap((f) => [f[k], f[k + 1]]).filter((v) => v > lo && v < hi)])].sort((x, y) => x - y);
  const as = cortes(a0, a1, 0), bs = cortes(b0, b1, 2), out: [number, number, number, number][] = [];
  for (let i = 0; i < as.length - 1; i++) {
    let ini = -1;
    for (let j = 0; j <= bs.length - 1; j++) {
      const livre = j < bs.length - 1 && !furos.some((f) => { const ca = (as[i] + as[i + 1]) / 2, cb = (bs[j] + bs[j + 1]) / 2; return ca > f[0] && ca < f[1] && cb > f[2] && cb < f[3]; });
      if (livre && ini < 0) ini = j;
      if (!livre && ini >= 0) { out.push([as[i], as[i + 1], bs[ini], bs[j]]); ini = -1; }
    }
  }
  return out;
}
/**
 * parede plana com vãos, em caixas de espessura `esp`: no plano y = c (a = x, b = z), x = c (a = y, b = z) ou z = c
 * (a = x, b = y). Caixa fechada: de dentro e de fora se vê a face certa
 */
function parede(p: Pecas, plano: 'x' | 'y' | 'z', c: number, a0: number, a1: number, b0: number, b1: number, furos: readonly (readonly number[])[], esp: number, cor: number) {
  for (const [x0, x1, y0, y1] of semFuros(a0, a1, b0, b1, furos)) {
    if (plano === 'y') p.caixa(x1 - x0, esp, y1 - y0, (x0 + x1) / 2, c, (y0 + y1) / 2, cor);
    else if (plano === 'x') p.caixa(esp, x1 - x0, y1 - y0, c, (x0 + x1) / 2, (y0 + y1) / 2, cor);
    else p.caixa(x1 - x0, y1 - y0, esp, (x0 + x1) / 2, (y0 + y1) / 2, c, cor);
  }
}
/** volante (anel com três raios e a coluna) no centro c, inclinado `incl` rad da vertical para trás */
function volante(p: Pecas, c: V3, r: number, incl: number, cor = PAINEL, coluna = true) {
  const g = new THREE.Group(); g.position.set(...c); g.rotation.y = incl; p.add(g);
  const anel = new THREE.Mesh(new THREE.TorusGeometry(r, Math.max(0.016, r * 0.12), 6, 20), p.m(cor)); anel.rotation.y = Math.PI / 2; g.add(anel);
  for (const a of [Math.PI / 2, Math.PI * 7 / 6, -Math.PI / 6]) { const raio = p.caixa(0.02, r, 0.03, 0, Math.cos(a) * r / 2, Math.sin(a) * r / 2, cor, g); raio.rotation.x = a; }
  p.cil(r * 0.22, 0.06, 'x', 0.01, 0, 0, cor, 10, g);
  if (coluna) { const col = p.cil(0.035, 0.5, 'x', 0.27, 0, 0, TRIM, 8, g); void col; }
  return g;
}
/** banco: assento e encosto (e o apoio de cabeça), virado para +x, com o pé em (x, y, z) */
function banco(p: Pecas, x: number, y: number, z: number, larg: number, cor = BANCO, alto = 0.62, cabeca = true) {
  p.caixa(0.5, larg, 0.12, x, y, z + 0.06, cor);
  const e = p.caixa(0.12, larg, alto, x - 0.27, y, z + 0.12 + alto / 2, cor); e.rotation.y = -0.18;
  if (cabeca) p.caixa(0.1, larg * 0.55, 0.2, x - 0.36, y, z + 0.2 + alto, cor);
}
/** mostradores claros num painel (discos virados para −x) */
function mostradores(p: Pecas, x: number, ys: readonly number[], z: number, r = 0.045) { for (const y of ys) { p.cil(r, 0.012, 'x', x, y, z, 0xd9d6cc, 12); p.cil(r * 1.15, 0.01, 'x', x + 0.004, y, z, TRIM, 12); } }
/** casco que se estende a `de` m em volta do olho, para a caixa de mostrar */
const emVolta = (o: V3, dx: number, dy: number, dz0: number, dz1: number): Caixa => ({ x0: o[0] - dx, x1: o[0] + dx, y0: o[1] - dy, y1: o[1] + dy, z0: o[2] - dz0, z1: o[2] + dz1 });

// ------------------------------------------------------------------ carros fechados (sedã, cupê, esportivo, hatch, muscle, picape, protótipo)
/** medidas da carroceria de estrada.ts (comprimento, largura, altura e o perfil do vidro) */
const DIMS: Partial<Record<TipoCarro, [number, number, number]>> = { sedan: [4.7, 1.82, 1.45], cupe: [4.5, 1.85, 1.35], esportivo: [4.4, 1.9, 1.2], hatch: [4.3, 1.8, 1.5], muscle: [4.8, 1.9, 1.38] };
const ESTUFA: Partial<Record<TipoCarro, [number, number, number, number]>> = { sedan: [0.2, 0.04, -0.24, -0.38], cupe: [0.14, -0.02, -0.2, -0.4], esportivo: [0.18, -0.04, -0.2, -0.46], hatch: [0.22, 0.05, -0.44, -0.49], muscle: [0.08, -0.06, -0.24, -0.38] };

/**
 * Cabine de carro: o capô e os para-lamas à frente, o porta-malas (ou a caçamba) atrás, as portas até a linha de
 * cintura, as colunas, o teto, o painel com o volante e os mostradores, os bancos, os retrovisores. A linha de cintura
 * fica abaixo do olho (o assento do carro é um só para todos os tipos: o interior se acomoda a ele).
 */
function cabineCarro(p: Pecas, E: V3, tipo: TipoCarro, cor: number) {
  const picape = tipo === 'picape', proto = tipo === 'prototipo';
  const [L, W, H] = picape ? [5.3, 1.86, 1.82] : proto ? [4.8, 2.0, 1.1] : DIMS[tipo] ?? DIMS.sedan!;
  const [fp, ft, tt, tp] = picape ? [0.9 / 5.3, 0.35 / 5.3, -0.95 / 5.3, -1.0 / 5.3] : proto ? [0.75 / 4.8, 0.2 / 4.8, -0.6 / 4.8, -0.75 / 4.8] : ESTUFA[tipo] ?? ESTUFA.sedan!;
  const g = 0.16, cintFora = picape ? 1.12 : proto ? 0.8 : g + (H - g) * (tipo === 'esportivo' ? 0.52 : 0.56);
  // (a linha de cintura no máximo 25 cm abaixo do olho, o teto pelo menos 17 cm acima: o assento é o mesmo para todos)
  const Zc = Math.min(cintFora, E[2] - 0.27), Zr = Math.max(H, E[2] + 0.19) - 0.03, Zf = 0.3, Wi = W / 2 - 0.07;
  const xw = L * fp, xt = L * ft, xtt = L * tt, xtp = L * tp;
  const capo = Zc - (tipo === 'muscle' ? 0.03 : picape ? 0.02 : 0.1);
  // frente: capô e para-lamas (o perfil da carroceria do para-brisa ao nariz)
  p.perfil([[xw, g], [L / 2 - 0.25, g], [L / 2, g + 0.12], [L / 2, capo - 0.1], [L / 2 - 0.25, capo - 0.02], [xw + 0.1, Zc - 0.01], [xw, Zc - 0.01]], W, cor);
  if (tipo === 'muscle') p.caixa(L / 2 - xw - 0.6, 0.62, 0.07, (L / 2 + xw) / 2, 0, capo + 0.02, cor);   // o ressalto do capô
  if (proto) for (const s of [-1, 1]) p.perfil([[0.75, Zc - 0.06], [1.0, Zc + 0.05], [1.35, Zc + 0.1], [1.75, Zc + 0.06], [2.05, Zc - 0.08]], 0.44, cor, s * 0.7);   // as corcovas dos para-lamas
  p.caixa(0.08, W * 0.9, 0.05, xw + 0.08, 0, Zc + 0.005, PAINEL);   // a grade do ar, na base do para-brisa
  // trás: porta-malas (ou a caçamba aberta da picape)
  if (picape) {
    const piso = Zc - 0.3, xb = xtp - 0.02;
    p.perfil([[xb, g], [-L / 2, g], [-L / 2, piso], [xb, piso]], W, cor);
    for (const s of [-1, 1]) p.caixa(xb + L / 2, 0.06, 0.32, (xb - L / 2) / 2, s * (W / 2 - 0.03), piso + 0.16, cor);
    p.caixa(0.06, W, 0.32, -L / 2 + 0.03, 0, piso + 0.16, cor);
    p.caixa(xb + L / 2, W - 0.12, 0.03, (xb - L / 2) / 2, 0, piso + 0.02, COR.grafite);
  } else p.perfil([[xtp, g], [-L / 2 + 0.25, g], [-L / 2, g + 0.12], [-L / 2, Zc - 0.1], [-L / 2 + 0.2, Zc + (tipo === 'muscle' ? 0.02 : 0)], [xtp, Zc]], W, cor);
  // piso, portas (até a cintura), o friso de cima delas
  p.caixa(xw - xtp, W - 0.1, 0.04, (xw + xtp) / 2, 0, Zf, PISO);
  for (const s of [-1, 1]) {
    p.caixa(xw - xtp, 0.08, Zc - Zf, (xw + xtp) / 2, s * Wi, (Zc + Zf) / 2, TRIM);
    p.caixa(xw - xtp, 0.14, 0.03, (xw + xtp) / 2, s * (Wi - 0.03), Zc, cor);
  }
  // colunas: A (do pé do para-brisa à frente do teto), B (no meio) e C (do vidro de trás); o teto por dentro
  for (const s of [-1, 1]) {
    barra(p, [xw, s * (Wi - 0.02), Zc], [xt, s * (Wi - 0.08), Zr], 0.07, TRIM, 0.09);
    const xB = (xt + xtt) / 2 + 0.05;
    if (!proto && xt - xtt > 1.0) p.caixa(0.1, 0.07, Zr - Zc, xB, s * (Wi - 0.04), (Zr + Zc) / 2, TRIM);
    barra(p, [xtp, s * (Wi - 0.02), Zc], [xtt, s * (Wi - 0.08), Zr], tipo === 'hatch' || picape ? 0.08 : 0.16, TRIM, 0.09);
  }
  p.caixa(xt - xtt + 0.1, W - 0.12, 0.05, (xt + xtt) / 2, 0, Zr, TETO);
  p.caixa(0.08, W - 0.12, 0.08, xt, 0, Zr - 0.03, TRIM);                     // o friso de cima do para-brisa
  p.caixa(0.08, W - 0.12, 0.08, xtt, 0, Zr - 0.03, TRIM);
  // painel: a parte de cima, a frente baixa, o capuz dos mostradores na frente do motorista, o console do meio
  p.caixa(xw - E[0] - 0.55, W - 0.16, 0.1, (xw + E[0] + 0.55) / 2, 0, Zc + 0.01, PAINEL);
  p.caixa(0.35, W - 0.16, Zc - Zf - 0.25, E[0] + 0.72, 0, (Zc + Zf + 0.25) / 2 - 0.02, TRIM);
  p.caixa(0.22, 0.42, 0.1, E[0] + 0.72, E[1], Zc + 0.07, PAINEL);
  mostradores(p, E[0] + 0.6, [E[1] - 0.09, E[1] + 0.09], Zc + 0.02, 0.05);
  p.caixa(0.06, 0.3, 0.12, E[0] + 0.62, 0, Zc - 0.12, 0x1f2328);          // o rádio no meio do painel
  p.caixa(E[0] + 0.55 - (E[0] - 0.4), 0.24, 0.22, (E[0] + 0.55 + E[0] - 0.4) / 2, 0, Zf + 0.13, TRIM);
  // volante e alavanca de câmbio
  volante(p, [E[0] + 0.4, E[1], E[2] - 0.3], 0.19, proto ? 0.6 : picape ? 0.3 : 0.42, 0x1c1e21);
  p.cil(0.012, 0.22, 'z', E[0] + 0.2, 0, Zf + 0.34, TRIM, 6); p.cil(0.03, 0.05, 'z', E[0] + 0.2, 0, Zf + 0.46, PAINEL, 8);
  // bancos: o seu, o do lado e (nos de quatro lugares) o de trás
  banco(p, E[0] - 0.05, E[1], Zf + 0.12, 0.5);
  banco(p, E[0] - 0.05, -E[1], Zf + 0.12, 0.5);
  if (!proto && tipo !== 'esportivo' && xtp < E[0] - 0.95) banco(p, E[0] - 0.95, 0, Zf + 0.12, W - 0.3, BANCO, 0.55, false);
  else p.caixa(0.06, W - 0.14, Zr - Zf - 0.1, Math.max(xtp, E[0] - 0.7), 0, (Zr + Zf) / 2 - 0.05, TRIM);   // a parede atrás dos bancos
  // retrovisores: o de dentro e os de fora (na base da coluna A)
  p.caixa(0.04, 0.24, 0.07, xt - 0.12, 0, Zr - 0.1, PAINEL);
  for (const s of [-1, 1]) { p.caixa(0.12, 0.05, 0.12, xw - 0.15, s * (W / 2 + 0.08), Zc + 0.1, cor); p.caixa(0.03, 0.045, 0.1, xw - 0.21, s * (W / 2 + 0.08), Zc + 0.1, PAINEL); }
  return { mostrar: { x0: xtp - 0.2, x1: xw + 0.2, y0: -W / 2, y1: W / 2, z0: 0, z1: Zr + 0.2 } as Caixa };
}

/** caminhão e ônibus: cabine avançada, sem capô; o para-brisa grande, o volante quase deitado, os espelhos nos braços */
function cabineFrontal(p: Pecas, E: V3, onibus: boolean, cor: number) {
  const W = onibus ? 2.55 : 2.5, Wi = W / 2 - 0.06, xs = E[0] + (onibus ? 1.0 : 0.85), Zf = E[2] - 1.15, Zc = E[2] - 0.35, Zr = E[2] + (onibus ? 0.95 : 0.75);
  const xb = onibus ? E[0] - 10.5 : E[0] - 1.1;
  // frente: a parede baixa, o para-brisa (vão) com as colunas, o friso de cima
  p.caixa(0.08, W, Zc - Zf, xs, 0, (Zc + Zf) / 2, cor);
  for (const s of [-1, 1]) p.caixa(0.1, 0.16, Zr - Zc, xs - 0.02, s * (Wi - 0.04), (Zr + Zc) / 2, TRIM);
  p.caixa(0.1, W, onibus ? 0.3 : 0.2, xs - 0.02, 0, Zr - (onibus ? 0.15 : 0.1), cor);
  if (!onibus) p.caixa(0.08, 0.06, Zr - Zc, xs - 0.02, 0, (Zr + Zc) / 2, TRIM);
  // painel fundo (do para-brisa até 45 cm de você), os mostradores na frente do motorista, o volante grande quase deitado
  p.caixa(0.42, W - 0.12, 0.12, xs - 0.23, 0, Zc + 0.06, PAINEL);
  p.caixa(0.3, W - 0.12, Zc - Zf, xs - 0.17, 0, (Zc + Zf) / 2, TRIM);
  const cp = p.caixa(0.06, 0.6, 0.2, xs - 0.44, E[1], Zc + 0.06, PAINEL); cp.rotation.y = -0.35;
  mostradores(p, xs - 0.48, [E[1] - 0.16, E[1], E[1] + 0.16], Zc + 0.06, 0.045);
  volante(p, [E[0] + 0.4, E[1], E[2] - 0.42], 0.23, onibus ? 1.1 : 0.85);
  // laterais: a porta com o vidro (vão) e o resto da parede
  for (const s of [-1, 1]) {
    const furos = onibus ? [[xs - 1.3, xs - 0.2, Zc - 0.3, Zr - 0.2], ...Array.from({ length: 8 }, (_, i) => [xs - 2.4 - i * 1.15, xs - 1.55 - i * 1.15, Zc, Zr - 0.25])] : [[E[0] - 0.7, xs - 0.15, Zc, Zr - 0.15]];
    parede(p, 'y', s * Wi, xb, xs, Zf, Zr, furos, 0.07, s > 0 ? TRIM : TRIM);
    // o espelho grande no braço, fora
    barra(p, [xs - 0.1, s * (W / 2), Zr - 0.25], [xs + 0.25, s * (W / 2 + 0.35), Zr - 0.3], 0.03, PAINEL);
    p.caixa(0.06, 0.2, 0.45, xs + 0.28, s * (W / 2 + 0.38), Zr - 0.5, PAINEL);
  }
  p.caixa(xs - xb, W, 0.05, (xs + xb) / 2, 0, Zf, PISO);
  p.caixa(xs - xb, W - 0.1, 0.06, (xs + xb) / 2, 0, Zr, onibus ? TETO : TRIM);
  banco(p, E[0] - 0.05, E[1], Zf + 0.45, 0.55, BANCO, 0.7);
  if (onibus) {
    // o salão: fileiras de dois e dois, a catraca, os balaústres e as luzes do teto
    for (let x = E[0] - 1.6; x > xb + 0.6; x -= 0.85) for (const y of [0.85, 0.4, -0.4, -0.85]) banco(p, x, y, Zf + 0.42, 0.42, 0x2f4f6e, 0.55, false);
    for (let x = E[0] - 1.2; x > xb + 0.6; x -= 2.2) p.cil(0.02, Zr - Zf, 'z', x, 0.18, (Zr + Zf) / 2, METAL, 6);
    for (const y of [0.25, -0.25]) p.cil(0.016, xs - xb - 1.5, 'x', (xs + xb) / 2 - 0.5, y, Zr - 0.2, METAL, 6);
    p.caixa(0.06, W, Zr - Zf, xb, 0, (Zr + Zf) / 2, TRIM);
  } else {
    banco(p, E[0] - 0.05, -E[1], Zf + 0.45, 0.55, BANCO, 0.7);
    p.caixa(0.08, W, Zr - Zf, xb, 0, (Zr + Zf) / 2, TRIM);                   // a parede da cama
    p.caixa(0.6, W - 0.2, 0.08, xb + 0.35, 0, Zf + 0.95, 0x5b4a3a);
  }
  return { mostrar: { x0: xb - 0.1, x1: xs + 0.1, y0: -W / 2, y1: W / 2, z0: Zf - 0.5, z1: Zr + 0.3 } as Caixa };
}

/** moto: o tanque entre os joelhos, o guidão com as mãos, o painel, a carenagem, os espelhos, o garfo e a roda da frente */
function motoPiloto(p: Pecas, E: V3, cor: number, rodas: Modelo['rodas']) {
  const [x, y, z] = E, r = 0.31;
  // tanque (o perfil de lado) e o banco
  p.perfil([[x + 0.08, z - 0.62], [x + 0.08, z - 0.48], [x + 0.25, z - 0.4], [x + 0.55, z - 0.42], [x + 0.62, z - 0.55], [x + 0.55, z - 0.7]], 0.38, cor, y);
  p.caixa(0.5, 0.3, 0.1, x - 0.2, y, z - 0.68, PAINEL);
  // carenagem da frente (a bolha é vão: só a borda), o painel com os mostradores
  p.perfil([[x + 0.58, z - 0.46], [x + 0.68, z - 0.2], [x + 0.78, z - 0.12], [x + 0.84, z - 0.38], [x + 0.75, z - 0.7]], 0.46, cor, y);
  p.caixa(0.1, 0.24, 0.12, x + 0.6, y, z - 0.25, PAINEL);
  mostradores(p, x + 0.55, [y - 0.05, y + 0.05], z - 0.22, 0.035);
  // guidão, as manoplas, as mãos (luvas) e os espelhos
  for (const s of [-1, 1]) {
    barra(p, [x + 0.52, y + s * 0.08, z - 0.32], [x + 0.42, y + s * 0.33, z - 0.3], 0.03, METAL);
    p.cil(0.022, 0.12, 'y', x + 0.42, y + s * 0.36, z - 0.3, PAINEL, 8);
    p.caixa(0.11, 0.1, 0.07, x + 0.41, y + s * 0.35, z - 0.27, 0x2b3a55);
    barra(p, [x + 0.56, y + s * 0.2, z - 0.15], [x + 0.6, y + s * 0.33, z - 0.02], 0.015, PAINEL);
    p.caixa(0.03, 0.13, 0.07, x + 0.6, y + s * 0.35, z, PAINEL);
    // os joelhos dos lados do tanque
    p.caixa(0.22, 0.12, 0.16, x + 0.12, y + s * 0.25, z - 0.62, 0x2b3a55);
  }
  // garfo até a roda da frente, o para-lama
  const xr = x + 1.05;
  for (const s of [-1, 1]) barra(p, [x + 0.55, y + s * 0.1, z - 0.38], [xr, y + s * 0.1, r], 0.045, COR.prata);
  p.caixa(0.5, 0.16, 0.04, xr, y, r * 2 + 0.08, cor);
  p.roda(r, 0.14, xr, y, r, rodas);
  return { mostrar: emVolta(E, 1.2, 0.8, 1.5, 0.6) };
}

/**
 * Sherman, do motorista com a cabeça para fora da escotilha: a chapa de cima do casco em volta do pescoço, o glacis
 * descendo à frente com os ganchos e a buzina, os para-lamas das lagartas dos lados, a torre atrás e à direita com o
 * cano do canhão por cima, a tampa da escotilha aberta
 */
function tanqueMotorista(p: Pecas, E: V3) {
  const [x, y, z] = E, oliva = 0x5a6136, escuro = 0x33362a, Zt = z - 0.42, yc = y - 0.55;
  // o teto do casco, com o anel da escotilha, e o glacis inclinado à frente
  parede(p, 'z', Zt, x - 1.6, x + 0.35, yc - 1.25, yc + 1.25, [[x - 0.32, x + 0.3, y - 0.3, y + 0.3]], 0.08, oliva);
  for (const [a, b] of [[[x - 0.32, y - 0.32], [x + 0.3, y - 0.32]], [[x - 0.32, y + 0.32], [x + 0.3, y + 0.32]], [[x - 0.32, y - 0.32], [x - 0.32, y + 0.32]], [[x + 0.3, y - 0.32], [x + 0.3, y + 0.32]]] as const) barra(p, [a[0], a[1], Zt + 0.06], [b[0], b[1], Zt + 0.06], 0.07, escuro);
  p.perfil([[x + 0.35, Zt + 0.04], [x + 2.0, Zt - 0.85], [x + 2.15, Zt - 1.2], [x + 0.35, Zt - 1.2]], 2.5, oliva, yc);
  for (const sg of [-1, 1]) { p.cil(0.09, 0.12, 'x', x + 1.9, yc + sg * 0.85, Zt - 0.72, COR.farol, 8); p.caixa(0.08, 0.3, 0.06, x + 1.6, yc + sg * 0.5, Zt - 0.55, escuro); }
  // as lagartas: os para-lamas e a esteira por fora, dos dois lados
  for (const sg of [-1, 1]) {
    p.caixa(4.2, 0.55, 0.05, x - 0.4, yc + sg * 1.5, Zt - 0.3, oliva);
    p.caixa(4.0, 0.5, 0.5, x - 0.4, yc + sg * 1.5, Zt - 0.6, escuro);
  }
  // a tampa da escotilha aberta, a torre e o canhão por cima de você, à direita
  const t = p.caixa(0.6, 0.06, 0.55, x - 0.05, y + 0.62, Zt + 0.3, oliva); t.rotation.x = 0.35;
  p.perfil([[x + 0.1, Zt], [x - 0.05, Zt + 0.65], [x - 1.6, Zt + 0.7], [x - 1.95, Zt + 0.4], [x - 1.9, Zt]], 1.9, oliva, yc - 0.85);
  p.cil(0.2, 0.5, 'x', x + 0.25, yc - 0.85, Zt + 0.35, oliva, 10);
  p.cil(0.075, 2.6, 'x', x + 1.7, yc - 0.85, Zt + 0.35, escuro, 8);
  p.cil(0.3, 0.12, 'z', x - 1.0, yc - 0.55, Zt + 0.77, escuro, 10);
  // por dentro (olhando para baixo): o banco, as duas alavancas
  for (const sg of [-1, 1]) barra(p, [x + 0.15, y + sg * 0.15, Zt - 0.9], [x + 0.25, y + sg * 0.15, Zt - 0.25], 0.03, PAINEL);
  p.caixa(0.6, 0.6, 0.05, x, y, Zt - 1.0, 0xc8c3a8);
  return { mostrar: emVolta(E, 1.3, 1.4, 1.2, 0.8) };
}

/** fórmula: o cockpit estreito, as rodas da frente à vista, o bico, a asa, o volante pequeno, os espelhos */
function formulaPiloto(p: Pecas, E: V3, cor: number, rodas: Modelo['rodas'], antigoGP: boolean) {
  const [x, y, z] = E, r = antigoGP ? 0.4 : 0.33, xr = x + (antigoGP ? 1.75 : 1.75), bit = antigoGP ? 0.72 : 0.82;
  const borda = z - 0.28;
  // o monobloco: as bordas do cockpit, o bico (torno) até a frente
  for (const s of [-1, 1]) p.caixa(1.3, 0.12, 0.42, x - 0.2, y + s * 0.34, borda - 0.21, cor);
  p.caixa(0.7, 0.8, 0.06, x - 0.75, y, borda - 0.02, cor);
  const g = new THREE.Group(); g.position.set(0, y, 0); p.add(g);
  p.torno(antigoGP ? [[x + 0.3, 0.4], [x + 1.2, 0.36], [x + 2.1, 0.25], [x + 2.4, 0.1]] : [[x + 0.3, 0.34], [x + 0.9, 0.26], [x + 2.0, 0.14], [x + 2.6, 0.05]], cor, 12, 0, borda - (antigoGP ? 0.36 : 0.3), g, 0.75);
  if (!antigoGP) {
    p.caixa(0.45, 1.85, 0.04, x + 2.55, y, 0.14, COR.preto);
    for (const s of [-1, 1]) { barra(p, [x + 0.9, y + s * 0.2, borda - 0.2], [xr, y + s * bit, r], 0.03, COR.preto); p.caixa(0.12, 0.06, 0.06, x + 0.25, y + s * 0.48, borda + 0.05, COR.preto); }
    p.caixa(0.1, 0.32, 0.18, x + 0.3, y, borda + 0.02, PAINEL);
  } else {
    for (const [a, b] of [[[-0.21, 0.01], [0.21, 0.01]], [[-0.21, 0.01], [-0.19, 0.2]], [[0.21, 0.01], [0.19, 0.2]], [[-0.19, 0.2], [0.19, 0.2]]] as const) barra(p, [x + 0.3, y + a[0], borda + a[1]], [x + 0.3, y + b[0], borda + b[1]], 0.015, COR.prata);   // o para-brisa pequeno (a moldura)
    for (const s of [-1, 1]) barra(p, [x + 1.4, y + s * 0.25, borda - 0.3], [xr, y + s * bit, r], 0.04, COR.preto);
  }
  volante(p, [x + 0.3, y, z - 0.33], antigoGP ? 0.21 : 0.13, antigoGP ? 0.35 : 0.25, antigoGP ? MADEIRA : PAINEL, false);
  for (const s of [-1, 1]) p.roda(r, antigoGP ? 0.14 : 0.3, xr, y + s * bit, r, rodas, COR.pneu, antigoGP ? COR.prata : COR.aro);
  return { mostrar: emVolta(E, 1.0, 0.6, 1.2, 0.6) };
}

/** carro antigo (o Stanley): banco alto, volante de madeira, o capô curto, os para-lamas soltos e os faróis de latão */
function antigoMotorista(p: Pecas, E: V3, cor: number, rodas: Modelo['rodas']) {
  const [x, y, z] = E, Zf = z - 1.0, borda = z - 0.42, r = 0.43, xr = x + 1.55;
  const yc = 0;
  p.caixa(1.6, 1.4, 0.05, x - 0.2, yc, Zf, MADEIRA);
  for (const s of [-1, 1]) p.caixa(1.6, 0.06, borda - Zf, x - 0.2, yc + s * 0.7, (borda + Zf) / 2, cor);
  p.caixa(0.08, 1.4, borda - Zf + 0.1, x + 0.62, yc, (borda + Zf) / 2 + 0.05, MADEIRA);   // o painel de madeira
  mostradores(p, x + 0.575, [y - 0.2], borda - 0.1, 0.05);
  // a moldura do para-brisa (o vidro é vão), o capô curto, os para-lamas e os faróis
  for (const s of [-1, 1]) p.cil(0.018, 0.5, 'z', x + 0.64, yc + s * 0.45, borda + 0.25, COR.prata, 6);
  p.cil(0.016, 0.9, 'y', x + 0.64, yc, borda + 0.5, COR.prata, 6);
  p.perfil([[x + 0.66, borda - 0.05], [x + 1.6, borda - 0.1], [x + 1.6, Zf], [x + 0.66, Zf]], 0.9, cor, yc);
  for (const s of [-1, 1]) {
    p.perfil([[xr - 0.6, r + 0.25], [xr - 0.2, r * 2 + 0.06], [xr + 0.35, r * 2 + 0.06], [xr + 0.6, r + 0.2], [xr + 0.6, r + 0.15], [xr + 0.32, r * 2], [xr - 0.17, r * 2], [xr - 0.6, r + 0.2]], 0.32, COR.preto, yc + s * 0.72);
    p.cil(0.11, 0.08, 'x', x + 1.65, yc + s * 0.45, borda - 0.05, 0xc9a24a, 10);
    p.roda(r, 0.1, xr, yc + s * 0.72, r, rodas, COR.pneu, 0xc9b27a);
  }
  volante(p, [x + 0.42, y, z - 0.3], 0.21, 0.55, MADEIRA);
  banco(p, x - 0.1, yc, Zf + 0.35, 1.3, COURO, 0.55, false);
  return { mostrar: emVolta(E, 1.0, 1.0, 1.2, 0.8) };
}

// ------------------------------------------------------------------ trens
/**
 * o nariz do trem visto da cabine: a casca do modelo (trilhos.ts) só à frente de `xMin` (no segmento), achatada na
 * vertical para o topo dela em `xMin` ficar em `zTopo` (a base do para-brisa: o assento é o da Cena, mais baixo que o
 * olho do maquinista de verdade)
 */
function narizAchatado(comp: number, larg: number, alt: number, zPiso: number, nariz: number, forma: 'bala' | 'cabine', zTopo: number, xMin: number) {
  const H = alt - zPiso, t = Math.max(0, Math.min(1, (xMin - (comp / 2 - nariz)) / nariz));
  const zt = forma === 'bala' ? zPiso + H * (1 - 0.75 * Math.pow(t, 1.3)) : zPiso + H * (1 - Math.min(0.42, 0.05 + 0.055 * nariz) * Math.pow(t, 1.6));
  const f = Math.min(1, (zTopo - zPiso) / Math.max(0.1, zt - zPiso));
  const g = geometriaSegmento(comp, larg, alt, zPiso, nariz, 0, forma), pos = g.attributes.position as THREE.BufferAttribute;
  const out: number[] = [];
  for (let i = 0; i < pos.count; i += 3) {
    if ((pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3 < xMin) continue;
    for (let k = 0; k < 3; k++) out.push(pos.getX(i + k), pos.getY(i + k), zPiso + (pos.getZ(i + k) - zPiso) * f);
  }
  g.dispose();
  const ng = new THREE.BufferGeometry(); ng.setAttribute('position', new THREE.Float32BufferAttribute(out.length ? out : [0, 0, 0, 0, 0, 0, 0, 0, 0], 3)); ng.computeVertexNormals();
  return ng;
}

/** janelas do segmento como em trilhos.ts (x no segmento), e as portas */
function janelasTrem(tipo: string, comp: number, nar: number, cau: number) {
  const x0 = -comp / 2 + cau + 1.0, x1 = comp / 2 - nar - 1.0, passo = tipo === 'metro' ? 1.9 : 2.3;
  const portas = tipo === 'metro' ? [x0 + 2.5, (x0 + x1) / 2, x1 - 2.5] : tipo === 'unidade' ? [x0 + 1.4, x1 - 1.4] : [x1 - 0.8];
  const jan: number[] = [];
  if (x1 > x0) for (let x = x0 + 1.4; x <= x1 - 1.4 + 1e-6; x += passo) if (!portas.some((xp) => Math.abs(xp - x) < 1.1)) jan.push(x);
  return { jan, portas: x1 > x0 ? portas : [], passo };
}

/**
 * Trem: a cabine do maquinista (o pupitre, o para-brisa, as janelinhas de lado, o banco) e, atrás da divisória com a
 * porta, o salão do primeiro carro (bancos em fileiras, ou os bancos de lado do metrô com os balaústres, os bagageiros,
 * as luzes do teto) ou, na locomotiva elétrica, a sala de máquinas. À frente do para-brisa, o nariz do trem (o do modelo,
 * achatado para ficar abaixo do olho).
 */
function interiorTrem(p: Pecas, luz: Pecas, c: ControlePassagem, E: V3, tipo: 'bala' | 'unidade' | 'metro' | 'eletrica', corCasca: number) {
  const k = c.corpo, s = k.segmentos[0], n = k.segmentos.length, xc = centros(k)[0], comp = s.comprimento, W = s.largura, H = s.altura - s.zPiso;
  const nar = Math.min(k.nariz, comp * 0.6), cau = n === 1 ? Math.min(k.cauda, comp * 0.6) : 0;
  const zP = s.zPiso, Zr = s.altura - 0.28, Wi = W / 2 - 0.08, frente = xc + comp / 2, tras = xc - comp / 2;
  const loco = tipo === 'eletrica';
  // a cabine: do para-brisa (embaixo, xs) até a divisória (xb)
  const longo = nar >= 4 || tipo === 'bala';
  const xs = longo ? E[0] + 1.7 : frente - 0.12, rake = longo ? 1.25 : 0.3, zs = E[2] - (longo ? 0.42 : 0.32), xb = E[0] - 1.15;
  // nariz por fora, à frente do para-brisa (o do modelo, achatado: o topo dele em xs fica na base do para-brisa)
  if (longo) p.add(new THREE.Mesh(narizAchatado(comp, W, s.altura, zP, loco ? Math.max(nar, 1.6) : nar, tipo === 'bala' ? 'bala' : 'cabine', zs, xs - xc), p.m(corCasca))).position.x = xc;
  // para-brisa: o painel baixo até zs, as colunas, o friso de cima (deitado: do pé em xs ao topo em xs − rake)
  p.caixa(0.6, W - 0.1, zs - zP, xs - 0.3, 0, (zs + zP) / 2, TRIM);
  p.caixa(0.6, W - 0.1, 0.06, xs - 0.3, 0, zs, PAINEL);
  for (const sg of [-1, 1]) barra(p, [xs, sg * (Wi - 0.1), zs], [xs - rake, sg * (Wi - 0.1), Zr], 0.13, TRIM, 0.08);
  barra(p, [xs - rake, -Wi, Zr - 0.05], [xs - rake, Wi, Zr - 0.05], 0.18, TRIM);
  // por cima e dos lados da cabine
  p.caixa(xs - rake - xb, W - 0.1, 0.06, (xs - rake + xb) / 2, 0, Zr, TRIM);
  for (const sg of [-1, 1]) {
    parede(p, 'y', sg * Wi, xb, xs - rake * 0.5, zP, Zr, [[xb + 0.35, xs - rake - 0.15, E[2] - 0.2, E[2] + 0.32]], 0.07, TRIM);
    // o triângulo entre a coluna deitada e a parede (a parede de lado acaba no pé dela)
    p.perfil([[xs - rake * 0.5, zs], [xs, zs], [xs - rake, Zr], [xs - rake * 0.5, Zr]], 0.07, TRIM, sg * Wi);
  }
  p.caixa(xs - xb, W - 0.1, 0.05, (xs + xb) / 2, 0, zP, PISO);
  // o pupitre: a mesa inclinada com os mostradores, o manipulador, o banco
  const mesa = p.caixa(0.55, 1.4, 0.06, E[0] + 0.6, E[1], E[2] - 0.55, PAINEL); mesa.rotation.y = 0.35;
  p.caixa(0.5, 1.4, E[2] - 0.55 - zP, E[0] + 0.62, E[1], (E[2] - 0.55 + zP) / 2, TRIM);
  p.caixa(0.08, 1.2, 0.18, E[0] + 0.88, E[1], E[2] - 0.53, PAINEL);
  mostradores(p, E[0] + 0.835, [E[1] - 0.4, E[1] - 0.22, E[1] + 0.22, E[1] + 0.4], E[2] - 0.52, 0.045);
  luz.caixa(0.01, 0.24, 0.12, E[0] + 0.835, E[1], E[2] - 0.52, 0x6fb890);   // a tela do meio
  p.cil(0.02, 0.18, 'z', E[0] + 0.45, E[1] - 0.35, E[2] - 0.38, METAL, 6);
  banco(p, E[0] - 0.1, E[1], zP + 0.4, 0.55, BANCO, 0.7);
  // a divisória com a porta (vão)
  parede(p, 'x', xb, -Wi, Wi, zP, Zr, [[-0.4, 0.4, zP, zP + 2.0]], 0.08, PAREDE);
  // o resto do segmento: o salão (ou a sala de máquinas), até a ponta de trás
  const fim = n === 1 && cau > 0 ? tras + cau + 0.2 : tras + 0.05;
  if (loco) {
    for (const sg of [-1, 1]) {
      parede(p, 'y', sg * Wi, fim, xb, zP, Zr, [[fim + 3, fim + 4, zP + 1.4, zP + 2.0]], 0.07, 0x8a8f94);
      for (let x = fim + 0.5; x < xb - 0.8; x += 1.4) p.caixa(1.2, 0.7, Zr - zP - 0.3, x + 0.6, sg * (Wi - 0.4), (Zr + zP) / 2 - 0.15, x % 2.8 < 1.4 ? 0x7d838a : 0x6b7077);
    }
    p.caixa(xb - fim, W - 0.1, 0.06, (xb + fim) / 2, 0, Zr, 0x8a8f94);
    for (let x = fim + 1; x < xb; x += 3) luz.caixa(0.8, 0.12, 0.03, x, 0, Zr - 0.04, LUZ);
  } else {
    const jt = janelasTrem(tipo, comp, nar, cau), zJan = zP + H * 0.56, hJan = H * (tipo === 'metro' ? 0.28 : 0.2);
    const furos = [...jt.jan.map((xj) => [xc + xj - jt.passo * 0.31, xc + xj + jt.passo * 0.31, zJan - hJan / 2, zJan + hJan / 2]), ...jt.portas.map((xp) => [xc + xp - 0.45, xc + xp + 0.45, zP + 0.42 + H * 0.62 * 0.22 - H * 0.62 * 0.21, zP + 0.42 + H * 0.62 * 0.22 + H * 0.62 * 0.21])];
    for (const sg of [-1, 1]) {
      parede(p, 'y', sg * Wi, fim, xb, zP, Zr, furos.filter((f) => f[1] < xb && f[0] > fim), 0.07, PAREDE);
      // portas (a folha, por dentro) e os bagageiros
      for (const xp of jt.portas) if (xc + xp < xb) p.caixa(1.3, 0.04, H * 0.62, xc + xp, sg * (Wi - 0.05), zP + 0.42 + H * 0.31 - 0.4, 0x8f949a);
      if (tipo !== 'metro') p.caixa(xb - fim, 0.4, 0.04, (xb + fim) / 2, sg * (Wi - 0.25), zJan + hJan / 2 + 0.3, METAL);
    }
    p.caixa(xb - fim, W - 0.1, 0.06, (xb + fim) / 2, 0, Zr, TETO);
    p.caixa(xb - fim, W - 0.1, 0.05, (xb + fim) / 2, 0, zP, 0x4a4d52);
    for (let x = fim + 1; x < xb - 0.5; x += 2.5) for (const y of tipo === 'metro' ? [0] : [-0.55, 0.55]) luz.caixa(1.6, 0.14, 0.03, x + 0.8, y, Zr - 0.04, LUZ);
    if (tipo === 'metro') {
      // bancos de lado entre as portas, os balaústres e as barras do teto
      const ps = jt.portas.map((xp) => xc + xp).sort((a, b) => a - b), trechos: [number, number][] = [];
      let a = fim + 0.3; for (const xp of ps) { if (xp < xb) { trechos.push([a, xp - 0.8]); a = xp + 0.8; } } trechos.push([a, xb - 0.3]);
      for (const [a0, a1] of trechos) if (a1 - a0 > 0.8) for (const sg of [-1, 1]) {
        p.caixa(a1 - a0, 0.45, 0.08, (a0 + a1) / 2, sg * (Wi - 0.3), zP + 0.45, 0x2f5aa8);
        p.caixa(a1 - a0, 0.08, 0.5, (a0 + a1) / 2, sg * (Wi - 0.08), zP + 0.75, 0x2f5aa8);
      }
      for (const xp of ps) if (xp < xb) for (const sg of [-1, 1]) p.cil(0.02, Zr - zP, 'z', xp + sg * 0.75, 0, (Zr + zP) / 2, METAL, 6);
      for (const y of [-0.45, 0.45]) p.cil(0.016, xb - fim, 'x', (xb + fim) / 2, y, Zr - 0.25, METAL, 6);
    } else {
      const larg = tipo === 'bala' ? 0.48 : 0.5, ys = tipo === 'bala' ? [-1.2, -0.72, -0.24, 0.55, 1.05] : [-1.0, -0.5, 0.5, 1.0];
      for (let x = xb - 0.7; x > fim + 0.8; x -= 1.02) for (const y of ys) if (Math.abs(y) + larg / 2 < Wi) banco(p, x, y, zP + 0.42, larg - 0.04, tipo === 'bala' ? 0x2f4f8e : 0x7b3326, 0.62);
    }
  }
  // a parede do fim, com a porta para o carro de trás
  parede(p, 'x', fim, -Wi, Wi, zP, Zr, n > 1 ? [[-0.45, 0.45, zP, zP + 2.0]] : [], 0.08, PAREDE);
  return { mostrar: { x0: tras - 0.3, x1: frente + 0.3, y0: -W / 2 - 0.2, y1: W / 2 + 0.2, z0: -0.5, z1: s.altura + 0.5 } as Caixa };
}

// ------------------------------------------------------------------ locomotivas
/** locomotiva diesel: a cabine com o pupitre do maquinista, as duas metades do para-brisa, o nariz curto à frente, o capô longo atrás */
function cabineDiesel(p: Pecas, luz: Pecas, c: ControlePassagem, E: V3, cor: number) {
  const s = c.corpo.segmentos[0], L = s.comprimento, W = s.largura, H = s.altura, deck = 1.5;
  const xs = E[0] + 0.85, xb = E[0] - 1.7, Zr = H - 0.15, Wi = W / 2 - 0.05, zs = E[2] - 0.3;
  p.caixa(xs - xb, W - 0.1, 0.05, (xs + xb) / 2, 0, deck, PISO);
  p.caixa(xs - xb, W - 0.1, 0.06, (xs + xb) / 2, 0, Zr, 0xa9a69e);
  for (const sg of [-1, 1]) parede(p, 'y', sg * Wi, xb, xs, deck, Zr, [[xb + 0.35, xs - 0.25, E[2] - 0.35, E[2] + 0.45]], 0.07, 0x9aa0a6);
  parede(p, 'x', xs, -Wi, Wi, deck, Zr, [[-Wi + 0.25, -0.08, zs, E[2] + 0.5], [0.08, Wi - 0.25, zs, E[2] + 0.5]], 0.08, 0x9aa0a6);
  parede(p, 'x', xb, -Wi, Wi, deck, Zr, [], 0.08, 0x9aa0a6);
  p.caixa(0.04, 0.8, 1.9, xb + 0.05, -0.6, deck + 0.95, 0x6b7077);               // a porta da sala do motor
  // o pupitre do maquinista do lado dele, o banco, o rádio
  p.caixa(0.55, 0.75, E[2] - 0.5 - deck, E[0] + 0.5, E[1] + 0.05, (E[2] - 0.5 + deck) / 2, 0x4a4f55);
  const m = p.caixa(0.5, 0.75, 0.05, E[0] + 0.5, E[1] + 0.05, E[2] - 0.48, PAINEL); m.rotation.y = 0.3;
  mostradores(p, E[0] + 0.76, [E[1] - 0.15, E[1] + 0.15], E[2] - 0.38, 0.05);
  p.cil(0.018, 0.25, 'z', E[0] + 0.35, E[1] - 0.25, E[2] - 0.35, METAL, 6);
  banco(p, E[0] - 0.25, E[1], deck + 0.45, 0.5, BANCO, 0.6);
  banco(p, E[0] - 0.25, -E[1], deck + 0.45, 0.5, BANCO, 0.6);
  luz.caixa(0.4, 0.2, 0.03, (xs + xb) / 2, 0, Zr - 0.04, LUZ);
  // por fora: o nariz curto com os faróis e a placa do número, o estrado com o corrimão amarelo, o capô longo atrás
  p.caixa(L / 2 - 0.35 - xs, W * 0.8, zs - 0.15 - deck, (L / 2 - 0.35 + xs) / 2, 0, (zs - 0.15 + deck) / 2, cor);
  for (const sg of [-1, 1]) p.caixa(0.06, 0.25, 0.18, L / 2 - 0.33, sg * 0.5, zs - 0.4, COR.farol);
  p.caixa(0.3, 0.7, 0.18, L / 2 - 0.6, 0, zs - 0.06, 0x2a2d31);
  p.caixa(L, W, 0.3, 0, 0, deck - 0.15, COR.grafite);
  for (const sg of [-1, 1]) {
    p.caixa(L - 1.2, 0.05, 0.05, -0.3, sg * (W / 2 - 0.08), deck + 1.0, COR.amarelo);
    for (let x = -L / 2 + 1; x < L / 2 - 0.6; x += 2) p.caixa(0.04, 0.04, 1.0, x, sg * (W / 2 - 0.08), deck + 0.5, COR.amarelo);
  }
  p.caixa(L - 7.2, W * 0.76, H - deck - 0.25, -3.1, 0, deck + (H - deck - 0.25) / 2, cor);
  p.caixa(3.2, W * 0.92, H - deck - 0.1, -L / 2 + 2.0, 0, deck + (H - deck - 0.1) / 2, cor);
  const esc = c.fontes.find((f) => f.tipo === 'escape');
  if (esc) p.caixa(0.6, 0.5, 0.45, esc.pos[0], 0, H + 0.2, COR.grafite);
  return { mostrar: { x0: xb - 0.2, x1: xs + 0.2, y0: -W / 2, y1: W / 2, z0: deck - 0.3, z1: H + 0.2 } as Caixa };
}

/**
 * locomotiva a vapor, do estrado: a cabine com a frente da caldeira (a porta da fornalha acesa, os manômetros, os
 * visores de água, o regulador), as janelas da frente dos dois lados da caldeira e, por elas, a caldeira até a caixa de
 * fumaça com os domos e a chaminé; atrás, o tênder (o de fora)
 */
function cabineVapor(p: Pecas, luz: Pecas, c: ControlePassagem, E: V3) {
  const k = c.corpo, s0 = k.segmentos[0], xc = centros(k)[0], L = s0.comprimento, W = s0.largura, H = s0.altura, preto = 0x24272b;
  const Zf = E[2] - 1.65, Zr = E[2] + 0.6, xf = E[0] + 1.45, x0 = E[0] - 0.45, Wi = W / 2 - 0.05, frente = xc + L / 2 - 0.4;
  const rb = Math.min(0.44 * W, 0.22 * H + 0.1), zb = Math.min(E[2] - 0.12 - rb, Math.max(Zf + rb + 0.3, H - rb - 0.95));
  // piso, teto (sai para trás sobre o estrado), os lados com a janela, a frente em volta da caldeira com as duas janelas
  p.caixa(xf - x0 + 0.3, W, 0.06, (xf + x0) / 2, 0, Zf, MADEIRA);
  p.caixa(xf - x0 + 0.6, W + 0.2, 0.08, (xf + x0) / 2 - 0.1, 0, Zr, preto);
  for (const sg of [-1, 1]) parede(p, 'y', sg * Wi, x0 + 0.1, xf, Zf, Zr, [[x0 + 0.1, x0 + 0.55, Zf, Zr - 0.25], [x0 + 0.8, xf - 0.25, E[2] - 0.25, E[2] + 0.35]], 0.06, preto);
  parede(p, 'x', xf, -Wi, Wi, zb, Zr, [[-Wi + 0.15, -rb * 0.45, zb + rb * 0.55, E[2] + 0.38], [rb * 0.45, Wi - 0.15, zb + rb * 0.55, E[2] + 0.38]], 0.06, preto);
  for (const sg of [-1, 1]) p.caixa(0.06, Wi - rb * 0.85, zb - Zf, xf, sg * (Wi + rb * 0.85) / 2, (zb + Zf) / 2, preto);
  // a frente da caldeira (o espelho), a porta da fornalha acesa, os manômetros, os visores, o regulador, a alavanca de reversão
  p.cil(rb, 0.08, 'x', xf - 0.03, 0, zb, 0x45484d, 18);
  for (const [y0, y1, z0, z1] of [[-0.35, -0.6, zb + rb * 0.7, zb - 0.2], [0.35, 0.65, zb + rb * 0.7, zb - 0.1], [-0.1, 0.1, zb + rb * 0.9, zb + rb * 0.9]] as const) barra(p, [xf - 0.1, y0, z0], [xf - 0.1, y1, z1], 0.035, 0xb87333);
  p.caixa(0.06, 0.62, 0.48, xf - 0.08, 0, Zf + 0.75, 0x1a1b1d);
  luz.caixa(0.02, 0.44, 0.3, xf - 0.115, 0, Zf + 0.75, 0xff8a2a);
  mostradores(p, xf - 0.09, [-0.25, 0.25], zb + rb * 0.55, 0.08);
  for (const sg of [-1, 1]) { p.caixa(0.05, 0.05, 0.38, xf - 0.1, sg * 0.5, zb + 0.1, 0x9ab0b8); p.caixa(0.06, 0.07, 0.04, xf - 0.1, sg * 0.5, zb + 0.32, COR.prata); p.caixa(0.06, 0.07, 0.04, xf - 0.1, sg * 0.5, zb - 0.12, COR.prata); }
  barra(p, [xf - 0.1, 0.1, zb + rb * 0.85], [xf - 0.55, 0.45, zb + rb * 0.9], 0.04, COR.prata);
  barra(p, [E[0] + 0.7, -0.55, Zf], [E[0] + 0.55, -0.6, Zf + 1.0], 0.05, COR.prata);
  // os bancos de lado (maquinista e foguista)
  for (const sg of [-1, 1]) p.caixa(0.45, 0.4, 0.08, E[0] + 0.6, sg * (Wi - 0.25), E[2] - 1.0, MADEIRA);
  // por fora: a caldeira, a caixa de fumaça, os domos, a chaminé, os estrados com o corrimão
  const xCh = c.fontes.find((f) => f.id === 'chamine')?.pos[0] ?? frente - 0.9;
  p.cil(rb, frente - xf - 1.4, 'x', (frente - 1.4 + xf) / 2, 0, zb, preto, 18);
  p.cil(rb + 0.04, 1.5, 'x', frente - 0.75, 0, zb, COR.grafite, 18);
  p.cil(rb * 0.75, 0.06, 'x', frente + 0.02, 0, zb, 0x3a3d42, 16);
  p.cil(0.28, 0.75, 'z', xCh, 0, zb + rb + 0.3, preto, 10, undefined, 0.34);
  for (const x of [xf + (frente - xf) * 0.3, xf + (frente - xf) * 0.6]) p.cil(0.3, 0.45, 'z', x, 0, zb + rb + 0.12, preto, 12);
  for (const sg of [-1, 1]) {
    p.caixa(frente - xf, 0.5, 0.05, (frente + xf) / 2, sg * (W / 2 - 0.25), zb - rb * 0.35, preto);
    p.cil(0.02, frente - xf - 0.5, 'x', (frente + xf) / 2, sg * (rb + 0.12), zb + rb * 0.4, COR.prata, 6);
  }
  luz.caixa(0.02, 0.2, 0.08, frente + 0.07, 0, zb + 0.55 * rb, 0xfff1c8);
  return { mostrar: { x0: x0 - 0.6, x1: xf + 0.3, y0: -W / 2 - 0.3, y1: W / 2 + 0.3, z0: Zf - 0.5, z1: Zr + 0.5 } as Caixa };
}

// ------------------------------------------------------------------ aviões
/** o avião de fora com a cabine aberta, sem a hélice e as rodas (as de fora continuam girando no lugar delas) */
function semGiros(f: typeof aviaoHelice, par: ParamsHelice, pas: readonly FonteSonora[], cab: { x0: number; x1: number; topoFrente?: number }) {
  const giros: Modelo['giros'] = [], rodas: Modelo['rodas'] = [], m = f(par, pas, giros, rodas, cab);
  for (const o of [...giros.map((g) => g.o), ...rodas.map((r) => r.o)]) { o.parent?.remove(o); soltarPecas(o); }
  return m.g;
}
/**
 * Avião de hélice: o modelo de fora sem o vidro da cabine e com a fuselagem aberta em volta dela (ar.ts, `cabine`), e a
 * cabine: as paredes até o peitoril, o painel com os mostradores, o manche, o banco, a moldura do para-brisa e do canopi.
 * A hélice é a do modelo de fora, girando à frente.
 */
function cabineHelice(p: Pecas, luz: Pecas, par: ParamsHelice, pas: readonly FonteSonora[], E: V3) {
  const transporte = par.tipo === 'transporte-alta' || par.tipo === 'transporte-baixa', alta = par.tipo === 'leve-alta';
  const h0 = pas[0]?.pos ?? [3.3, 0, 1.5];
  if (transporte) {
    const t = fuselagemTransporte(par, pas.map((f) => f.pos));
    const x0 = E[0] - 1.5, x1 = t.xn - 0.5;
    const Zf = E[2] - 1.05, Zr = E[2] + 0.5, Wi = t.rf * 0.92, zs = E[2] - 0.22, xs = E[0] + 0.95, xt = E[0] + 0.35;
    p.add(semGiros(aviaoHelice, par, pas, { x0, x1, topoFrente: Zf + (zs - Zf) * 0.35 }));
    p.caixa(x1 - x0, 2 * Wi, 0.05, (x0 + x1) / 2, 0, Zf, PISO);
    p.caixa(xt - x0, 2 * Wi, 0.06, (xt + x0) / 2, 0, Zr, TETO);
    for (const sg of [-1, 1]) parede(p, 'y', sg * Wi, x0, xs, Zf, Zr, [[E[0] - 0.3, E[0] + 0.55, E[2] - 0.12, E[2] + 0.3]], 0.06, 0xb9bcc0);
    // o para-brisa: dois vidros (vãos) com a coluna do meio; embaixo, o nariz descendo até a ponta
    for (const yy of [-Wi + 0.05, 0, Wi - 0.05]) barra(p, [xs, yy, zs], [xt, yy * 0.95, Zr], 0.07, TRIM);
    p.perfil([[xs, Zf], [xs, zs], [x1, Zf + (zs - Zf) * 0.35], [x1, Zf]], 2 * Wi, par.cor);
    p.caixa(0.3, 2 * Wi - 0.1, 0.06, xs - 0.2, 0, zs - 0.03, PAINEL);
    p.caixa(0.06, 2 * Wi - 0.1, zs - Zf, xs - 0.32, 0, (zs + Zf) / 2, PAINEL);
    mostradores(p, xs - 0.36, [-0.65, -0.45, -0.25, 0.25, 0.45, 0.65], zs - 0.18, 0.045);
    for (const sg of [-1, 1]) { volante(p, [E[0] + 0.42, sg * E[1], E[2] - 0.38], 0.14, 0.3, PAINEL); banco(p, E[0] - 0.05, sg * E[1], Zf + 0.42, 0.5, BANCO, 0.65); }
    p.caixa(0.6, 0.3, 0.25, E[0] + 0.45, 0, Zf + 0.35, PAINEL);
    parede(p, 'x', x0, -Wi, Wi, Zf, Zr, [[-0.35, 0.35, Zf, Zf + 1.8]], 0.06, 0xb9bcc0);
    return { mostrar: emVolta(E, 1.2, 1.2, 1.2, 0.7) };
  }
  // monomotor: a fuselagem aberta em volta da cabine
  const rf = raioFuselagem(par.tipo), zh = h0[2];
  const x0 = E[0] - (alta ? 1.25 : 0.95), x1 = E[0] + (alta ? 0.85 : 0.72);
  p.add(semGiros(aviaoHelice, par, pas, { x0, x1, topoFrente: alta ? E[2] - 0.12 : undefined }));
  const sill = alta ? E[2] - 0.22 : E[2] - 0.3, Zf = zh - rf * 0.7, Wi = rf * 0.92;
  for (const sg of [-1, 1]) p.caixa(x1 - x0, 0.06, sill - Zf, (x0 + x1) / 2, sg * Wi, (sill + Zf) / 2, par.cor);
  p.caixa(x1 - x0, 2 * Wi, 0.05, (x0 + x1) / 2, 0, Zf, PISO);
  // o painel (a tampa da frente) com o capuz, os mostradores; o manche (ou o volante do Cessna), o banco
  p.caixa(0.1, 2 * Wi - 0.04, 0.06, x1 - 0.08, 0, E[2] - 0.16, PAINEL);
  p.caixa(0.06, 2 * Wi - 0.04, E[2] - 0.16 - Zf, x1 - 0.06, 0, (E[2] - 0.16 + Zf) / 2, PAINEL);
  mostradores(p, x1 - 0.1, alta ? [E[1] - 0.12, E[1] + 0.06, E[1] + 0.22, -0.2] : [-0.16, 0, 0.16], E[2] - 0.32, 0.04);
  if (alta) { volante(p, [E[0] + 0.45, E[1], E[2] - 0.37], 0.13, 0.15, PAINEL); volante(p, [E[0] + 0.45, -E[1], E[2] - 0.37], 0.13, 0.15, PAINEL); }
  else { barra(p, [E[0] + 0.35, 0, Zf + 0.05], [E[0] + 0.28, 0, E[2] - 0.55], 0.035, PAINEL); p.caixa(0.05, 0.12, 0.05, E[0] + 0.28, 0, E[2] - 0.53, PAINEL); }
  banco(p, E[0] - 0.12, E[1], Zf + 0.1, 0.48, BANCO, 0.62);
  if (alta) banco(p, E[0] - 0.12, -E[1], Zf + 0.1, 0.48, BANCO, 0.62);
  p.caixa(0.06, 2 * Wi, sill - Zf + (alta ? 0.4 : 0.2), x0 + 0.04, 0, (sill + Zf) / 2 + (alta ? 0.2 : 0.1), TRIM);
  if (alta) {
    // o Cessna: a cabine fechada sob a asa (o teto), as portas com a janela (vão), o para-brisa com a coluna do meio
    const Zr = zh + rf + 0.06;
    p.caixa(x1 - x0, 2 * Wi, 0.06, (x0 + x1) / 2, 0, Zr, TETO);
    for (const sg of [-1, 1]) {
      p.caixa(0.08, 0.05, Zr - sill, x0 + 0.45, sg * Wi, (Zr + sill) / 2, TRIM);
      barra(p, [x1, sg * (Wi - 0.04), sill], [x1 - 0.45, sg * (Wi - 0.04), Zr], 0.06, TRIM);
      p.caixa(x1 - x0, 0.05, 0.05, (x0 + x1) / 2, sg * Wi, Zr - 0.03, TRIM);
    }
    barra(p, [x1, 0, sill], [x1 - 0.45, 0, Zr], 0.03, TRIM);
  } else {
    // canopi: a moldura do para-brisa e os arcos (o vidro é vão)
    const top = E[2] + 0.3, arco = (x: number, rr: number) => { const a = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.025, 4, 12, Math.PI), p.m(TRIM)); a.position.set(x, 0, sill); a.rotation.x = Math.PI / 2; p.add(a); };
    for (const sg of [-1, 1]) barra(p, [x1 - 0.05, sg * (Wi - 0.04), sill], [x1 - 0.3, sg * 0.18, top], 0.028, TRIM);
    barra(p, [x1 - 0.3, -0.2, top], [x1 - 0.3, 0.2, top], 0.028, TRIM);
    arco(E[0] - 0.55, Math.max(Wi, top - sill));
  }
  return { mostrar: emVolta(E, 1.2, 0.9, 1.0, 0.7) };
}

/** jato: o caça (a cabine com o nariz à frente, a asa dos lados) ou a janela do avião de linha (o corredor, as poltronas, a asa lá fora) */
function cabineJato(p: Pecas, luz: Pecas, c: ControlePassagem, E: V3) {
  const k = c.corpo, s0 = k.segmentos[0], par = paramsJato(c.motorPreset ?? '', k.comprimento, c.vKmh > 1100), zc = s0.zPiso + (s0.altura - s0.zPiso) / 2;
  if (par.tipo === 'caca') {
    const x0 = E[0] - 1.1, x1 = E[0] + 0.85;
    p.add(jato(par, c.fontes, zc, { x0, x1 }).g);
    const rf = 0.62, sill = E[2] - 0.3, Zf = zc - rf * 0.6, Wi = 0.45;
    for (const sg of [-1, 1]) p.caixa(x1 - x0, 0.06, sill - Zf, (x0 + x1) / 2, sg * Wi, (sill + Zf) / 2, par.cor);
    p.caixa(x1 - x0, 2 * Wi, 0.05, (x0 + x1) / 2, 0, Zf, PISO);
    p.caixa(0.25, 2 * Wi, 0.06, x1 - 0.1, 0, E[2] - 0.2, PAINEL);
    p.caixa(0.06, 2 * Wi, E[2] - 0.2 - Zf, x1 - 0.2, 0, (E[2] - 0.2 + Zf) / 2, PAINEL);
    mostradores(p, x1 - 0.24, [-0.18, 0.18], E[2] - 0.38, 0.05);
    luz.caixa(0.01, 0.16, 0.12, x1 - 0.235, 0, E[2] - 0.36, 0x7fd0a0);
    // o HUD (a moldura; o vidro é vão), o manche lateral, o assento ejetável, o arco do canopi
    for (const sg of [-1, 1]) p.caixa(0.04, 0.02, 0.16, x1 - 0.15, sg * 0.08, E[2] - 0.1, TRIM);
    barra(p, [E[0] + 0.15, -0.32, sill - 0.25], [E[0] + 0.2, -0.32, sill - 0.05], 0.04, PAINEL);
    banco(p, E[0] - 0.1, 0, Zf + 0.15, 0.5, 0x4a4f3a, 0.85);
    for (const sg of [-1, 1]) barra(p, [x1 - 0.05, sg * Wi, sill], [x1 - 0.35, sg * 0.12, E[2] + 0.28], 0.04, TRIM);
    const a = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.03, 4, 12, Math.PI), p.m(TRIM)); a.position.set(E[0] - 0.4, 0, sill); a.rotation.x = Math.PI / 2; p.add(a);
    return { mostrar: emVolta(E, 1.2, 0.8, 1.0, 0.7) };
  }
  // avião de linha (e o Concorde): o salão em volta da janela
  const rf = par.tipo === 'concorde' ? 1.45 : Math.min(3.2, Math.max(1.8, k.comprimento * 0.05));
  const x0 = E[0] - 7, x1 = E[0] + 7;
  p.add(jato(par, c.fontes, zc, { x0, x1 }).g);
  const Zf = E[2] - 1.1, Zr = Math.min(zc + rf * 0.82, E[2] + 1.05), Wi = Math.abs(E[1]) + 0.42, zJ = E[2] + 0.05, wJ = 0.27, hJ = 0.36;
  const furos: number[][] = [];
  for (let x = x0 + 0.3; x < x1 - 0.3; x += 0.53) furos.push([x - wJ / 2, x + wJ / 2, zJ - hJ / 2, zJ + hJ / 2]);
  for (const sg of [-1, 1]) {
    parede(p, 'y', sg * Wi, x0, x1, Zf, E[2] + 0.42, furos, 0.06, 0xebe8e1);
    // os bagageiros e o teto curvo
    p.caixa(x1 - x0, 0.5, 0.42, (x0 + x1) / 2, sg * (Wi - 0.25), E[2] + 0.63, 0xd8d5cd);
    barra(p, [x0, sg * (Wi - 0.5), E[2] + 0.84], [x0, sg * 0.4, Zr], 0.04, TETO).scale.set(1, 1, 1);
  }
  p.caixa(x1 - x0, 2 * Wi, 0.05, (x0 + x1) / 2, 0, Zf, 0x5b5f66);
  p.caixa(x1 - x0, 1.2, 0.05, (x0 + x1) / 2, 0, Zr, TETO);
  for (const sg of [-1, 1]) { const t = p.caixa(x1 - x0, Wi - 0.9, 0.05, (x0 + x1) / 2, sg * (Wi * 0.5 + 0.1), (Zr + E[2] + 0.84) / 2, TETO); t.rotation.x = sg * 0.35; }
  for (let x = x0 + 0.5; x < x1; x += 1.0) luz.caixa(0.6, 0.06, 0.02, x, 0, Zr - 0.03, LUZ);
  // as poltronas, três de cada lado do corredor
  const ys: number[] = []; for (const sg of [-1, 1]) for (let i = 0; i < (par.tipo === 'concorde' ? 2 : 3); i++) ys.push(sg * (0.45 + i * 0.47));
  for (let x = x1 - 0.6; x > x0 + 0.4; x -= 0.8) for (const y of ys) if (Math.abs(y) + 0.22 < Wi) banco(p, x, y, Zf + 0.42, 0.43, 0x2f4f6e, 0.68);
  for (const x of [x0, x1]) parede(p, 'x', x, -Wi, Wi, Zf, Zr, [], 0.06, 0xd8d5cd);
  return { mostrar: { x0: x0 - 0.2, x1: x1 + 0.2, y0: -Wi - 0.2, y1: Wi + 0.2, z0: Zf - 0.3, z1: Zr + 0.3 } as Caixa };
}

/** helicóptero: a bolha (a moldura; o vidro é vão), o teto com a janela, o console do meio, o cíclico, o coletivo, os bancos */
function cabineHeli(p: Pecas, E: V3, bolha: boolean, cor: number) {
  const [x, , z] = E, Zf = z - 0.95, Zr = z + 0.5, Wi = 0.62, xn = x + 1.05;
  p.caixa(1.9, 2 * Wi, 0.05, x - 0.05, 0, Zf, PISO);
  // a moldura: os arcos da bolha (do teto ao pé do nariz), as portas, o teto (com a janela do teto, vão)
  for (const yy of [-Wi, -0.02, Wi]) { const yb = yy * (bolha ? 1 : 0.95); barra(p, [x + 0.3, yb * 0.85, Zr], [xn, yb, z - 0.1], 0.04, bolha ? COR.grafite : TRIM); barra(p, [xn, yb, z - 0.1], [x + 0.85, yb * 0.9, Zf], 0.04, bolha ? COR.grafite : TRIM); }
  for (const sg of [-1, 1]) for (const xx of [x - 0.25, x - 0.95]) p.caixa(0.05, 0.05, Zr - Zf, xx, sg * Wi, (Zr + Zf) / 2, bolha ? COR.grafite : TRIM);
  if (!bolha) {
    parede(p, 'z', Zr, x - 1.0, x + 0.32, -Wi, Wi, [[x - 0.6, x + 0.1, -0.45, 0.45]], 0.05, cor);
    for (const sg of [-1, 1]) p.caixa(0.75, 0.04, 0.4, x - 0.6, sg * Wi, Zf + 0.2, cor);
    parede(p, 'x', x - 1.0, -Wi, Wi, Zf, Zr, [], 0.05, TRIM);
  } else {
    p.caixa(0.06, 2 * Wi, 0.7, x - 1.0, 0, Zf + 0.35, 0x8f949a);
    p.cil(0.05, 1.2, 'z', x - 1.0, 0, Zr + 0.3, COR.grafite, 8);
  }
  // o console no meio, com os mostradores; o cíclico, o coletivo, os bancos
  const cons = p.caixa(0.4, 0.34, 0.5, x + 0.55, 0, Zf + 0.3, PAINEL); cons.rotation.y = -0.25;
  mostradores(p, x + 0.33, [-0.08, 0.08], Zf + 0.5, 0.04);
  barra(p, [x + 0.2, 0, Zf + 0.05], [x + 0.25, E[1] * 0.7, z - 0.4], 0.03, PAINEL);
  p.caixa(0.04, 0.35, 0.04, x + 0.25, E[1] * 0.4, z - 0.4, PAINEL);
  barra(p, [x - 0.2, E[1] + 0.25, Zf + 0.15], [x + 0.2, E[1] + 0.25, Zf + 0.35], 0.03, PAINEL);
  for (const sg of [-1, 1]) banco(p, x - 0.15, sg * Math.abs(E[1]), Zf + 0.15, 0.45, BANCO, 0.6);
  return { mostrar: emVolta(E, 1.2, 0.9, 1.0, 0.7) };
}

// ------------------------------------------------------------------ o interior do portador atual
/**
 * Monta o interior do veículo do portador atual em volta do assento (pontos.ts). Sem interior (o gerador, o drone, o
 * trator, o barco, o VANT), null.
 */
export function montarInterior(c: ControlePassagem): Interior | null {
  const a = assento(c);
  if (a.modo !== 'embarcado') return null;
  const E = a.pos as V3, id = c.motorPreset ?? '', p = new Pecas(), luz = new Pecas(), rodas: Modelo['rodas'] = [];
  let r: { mostrar: Caixa } | null = null, seg = 0, escondeRodas = false;
  if (c.portador === 'carro') {
    const t = tipoCarro(c.motor, id);
    escondeRodas = true;
    if (t.tipo === 'caminhao' || t.tipo === 'onibus') r = cabineFrontal(p, E, t.tipo === 'onibus', t.cor);
    else if (t.tipo === 'moto') r = motoPiloto(p, E, t.cor, rodas);
    else if (t.tipo === 'tanque') r = tanqueMotorista(p, E);
    else if (t.tipo === 'formula' || t.tipo === 'gp-antigo') r = formulaPiloto(p, E, t.cor, rodas, t.tipo === 'gp-antigo');
    else if (t.tipo === 'antigo') r = antigoMotorista(p, E, t.cor, rodas);
    else r = cabineCarro(p, E, t.tipo, t.cor);
  } else if (c.portador === 'trem') {
    const tipo = ['taurus', 'vectron'].includes(id) && c.motor === 'eletrico' ? 'eletrica' : c.corpo.nariz >= 8 ? 'bala' : ['frotaa', 'metropolis', 'flexity'].includes(id) ? 'metro' : 'unidade';
    const corCasca = tipo === 'bala' ? COR.branco : tipo === 'eletrica' ? COR.vermelho : tipo === 'metro' ? COR.prata : id.startsWith('cptm') ? COR.prata : COR.branco;
    r = interiorTrem(p, luz, c, E, tipo, corCasca);
  } else if (c.portador === 'locomotiva' && c.motor === 'vapor') r = cabineVapor(p, luz, c, E);
  else if (c.portador === 'locomotiva') r = cabineDiesel(p, luz, c, E, id === 'ge7fdl' ? 0xd9d2c0 : 0xd9a520);
  else if (c.portador === 'helice') {
    const par = paramsHelice(c.motor, id), pas = c.fontes.filter((f) => f.tipo === 'pa');
    if (olhoPilotoHelice(par, pas.map((f) => f.pos))) r = cabineHelice(p, luz, par, pas, E);
  } else if (c.portador === 'aviao') r = cabineJato(p, luz, c, E);
  else if (c.portador === 'rotor') r = cabineHeli(p, E, id === 'bell47', id === 's55' ? 0x5b6338 : id === 'ae50r' ? 0x8f949a : COR.branco);
  if (!r) { soltarPecas(p.g); soltarPecas(luz.g); return null; }
  // uma malha para a cabine (cores nos vértices), uma para as luzes (sem sombreamento), cada roda à parte (gira)
  const grupo = new THREE.Group();
  const fora = new Set<THREE.Object3D>(rodas.map((x) => x.o));
  const casco = fundir(p.g, fora); casco.castShadow = true; casco.receiveShadow = true; grupo.add(casco);
  if (luz.g.children.length) grupo.add(new THREE.Mesh(fundirGeometria(luz.g), new THREE.MeshBasicMaterial({ vertexColors: true })));
  const rodasI: Modelo['rodas'] = [];
  for (const rd of rodas) { const m = fundir(rd.o); m.position.copy(rd.o.position); grupo.add(m); rodasI.push({ o: m, r: rd.r }); }
  soltarPecas(p.g); soltarPecas(luz.g);
  if (c.portador === 'trem') seg = 0;
  return { grupo, seg, mostrar: r.mostrar, escondeRodas, rodas: rodasI };
}

/** o olho (no corpo) está dentro da caixa */
export const dentroDe = (b: Caixa, p: readonly number[]) => p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1 && p[2] >= b.z0 && p[2] <= b.z1;
