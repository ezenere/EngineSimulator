// Veículos sobre trilhos low poly, nas medidas dos segmentos do portador (comprimento, largura, altura, piso, vão):
// trem-bala com o nariz de bico de pato, unidade elétrica e metrô com a cabine rombuda, locomotiva elétrica, locomotiva
// diesel (capô longo, cabine, radiador, truques de três eixos), locomotiva a vapor (caldeira, chaminé, domos, cabine,
// limpa-trilhos, cilindros, rodas motrizes com as bielas andando), tênder, carro de passageiros antigo e vagão de carga.
// Os truques saem das fontes de rolamento do portador (onde o som do trilho nasce é onde a roda está).
import * as THREE from 'three';
import { Pecas, COR, type Modelo } from './kit';
import type { Corpo, Segmento } from '../../../carriers/tipos';
import type { FonteSonora } from '../../../scene/tipos';

export type TipoTrem = 'bala' | 'unidade' | 'metro' | 'eletrica';
export interface Pintura { corpo: number; faixa: number; teto: number; frente?: number }

/** casca de um segmento por seções (superelipse); o nariz afilado do trem-bala ou a cabine rombuda das unidades */
export function geometriaSegmento(comp: number, larg: number, alt: number, zPiso: number, nariz: number, cauda: number, forma: 'bala' | 'cabine' | 'heli' = 'bala') {
  const K = 20, secoes: { x: number; w: number; zb: number; zt: number }[] = [];
  const H = alt - zPiso, zb0 = forma === 'heli' ? 0.5 : zPiso;
  const perfil = (t: number) => forma === 'heli' ? { w: larg * (1 - 0.55 * t * t), zb: zb0 + 0.9 * t * t, zt: zb0 + (alt - zb0) * (1 - 0.55 * Math.pow(t, 1.5)) }
    // (a cabine rombuda inclina mais quanto mais longo o nariz: o regional de 6 m tem a testa deitada, o metrô quase reta)
    : forma === 'cabine' ? { w: larg * (1 - 0.12 * t * t), zb: zb0 + 0.08 * t, zt: zb0 + H * (1 - Math.min(0.42, 0.05 + 0.055 * Math.max(nariz, cauda)) * Math.pow(t, 1.6)) }
      : { w: larg * (1 - 0.45 * t * t), zb: zb0 + 0.25 * t * t, zt: zb0 + H * (1 - 0.75 * Math.pow(t, 1.3)) };
  const M = forma === 'cabine' ? 4 : 12;
  if (cauda > 0) for (let i = M; i > 0; i--) { const t = i / M; secoes.push({ x: -comp / 2 + cauda * (1 - t), ...perfil(t) }); }
  else secoes.push({ x: -comp / 2, w: larg, zb: zb0, zt: alt });
  if (cauda > 0) secoes.push({ x: -comp / 2 + cauda, w: larg, zb: zb0, zt: alt });
  if (nariz > 0) secoes.push({ x: comp / 2 - nariz, w: larg, zb: zb0, zt: alt });
  if (nariz > 0) for (let i = 1; i <= M; i++) { const t = i / M; secoes.push({ x: comp / 2 - nariz * (1 - t), ...perfil(t) }); }
  else secoes.push({ x: comp / 2, w: larg, zb: zb0, zt: alt });
  const pos: number[] = [], idx: number[] = [];
  const ex = forma === 'cabine' ? 0.25 : 0.4;
  for (const s of secoes) {
    const zc = (s.zb + s.zt) / 2, hh = (s.zt - s.zb) / 2;
    for (let j = 0; j < K; j++) {
      const a = (j / K) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      pos.push(s.x, (s.w / 2) * Math.sign(ca) * Math.pow(Math.abs(ca), ex), zc + hh * Math.sign(sa) * Math.pow(Math.abs(sa), ex));
    }
  }
  for (let i = 0; i < secoes.length - 1; i++) for (let j = 0; j < K; j++) {
    const a = i * K + j, b = i * K + ((j + 1) % K), cc = (i + 1) * K + j, d = (i + 1) * K + ((j + 1) % K);
    // (a face olha para fora: o ângulo j cresce no sentido anti-horário visto de +x, e x cresce de uma seção para a outra)
    idx.push(a, b, cc, b, d, cc);
  }
  const tampa = (i: number, frente: boolean) => {
    const s = secoes[i], c0 = pos.length / 3;
    pos.push(s.x, 0, (s.zb + s.zt) / 2);
    for (let j = 0; j < K; j++) { const a = i * K + j, b = i * K + ((j + 1) % K); if (frente) idx.push(c0, a, b); else idx.push(c0, b, a); }
  };
  tampa(0, false); tampa(secoes.length - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const ng = g.toNonIndexed(); ng.computeVertexNormals(); g.dispose();
  return ng;
}

/** centro (x) de cada segmento no referencial do corpo */
export function centros(corpo: Corpo) {
  const l: number[] = []; let frente = corpo.comprimento / 2;
  for (const s of corpo.segmentos) { l.push(frente - s.comprimento / 2); frente -= s.comprimento + s.vao; }
  return l;
}
/** segmento que contém x (índice) */
export const segmentoDe = (corpo: Corpo, xs: number[], x: number) => { let k = 0; for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - x) < Math.abs(xs[k] - x)) k = i; void corpo; return k; };

/** truque de dois eixos (frame e quatro rodas que giram), no grupo do segmento */
function truque(p: Pecas, x: number, w: number, rodas: Modelo['rodas'], r = 0.43, eixos = 2, passo = 2.5) {
  p.caixa(passo + 0.9, w * 0.62, 0.42, x, 0, r + 0.05, COR.grafite);
  for (let e = 0; e < eixos; e++) {
    const xe = x - passo / 2 + (eixos > 1 ? (e * passo) / (eixos - 1) : passo / 2);
    for (const s of [-1, 1]) p.roda(r, 0.14, xe, s * 0.72, r, rodas, 0x3a3d42, 0x6b7077);
  }
}

/** janelas e portas de um lado e do outro, num InstancedMesh (uma chamada de desenho por segmento) */
function janelas(p: Pecas, L: number, w: number, z: number, alt: number, ini: number, fim: number, passo: number, portas: number[], zPorta: number, altPorta: number) {
  const pts: [number, number, number, number, number, number][] = [];   // x, z, comprimento, altura, lado, cor
  for (let x = ini; x <= fim + 1e-6; x += passo) if (!portas.some((xp) => Math.abs(xp - x) < 1.1)) for (const s of [-1, 1]) pts.push([x, z, passo * 0.62, alt, s, COR.vidro]);
  // as portas: a folha cinza com o vidro na metade de cima
  for (const xp of portas) for (const s of [-1, 1]) pts.push([xp, zPorta, 1.3, altPorta, s, 0x6b7077], [xp, zPorta + altPorta * 0.22, 0.9, altPorta * 0.42, s * 1.01, COR.vidro]);
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.04, 1), new THREE.MeshLambertMaterial({ flatShading: true }), pts.length);
  const m = new THREE.Matrix4(), cor = new THREE.Color();
  pts.forEach(([x, zz, l, a, s, k], i) => { im.setMatrixAt(i, m.makeScale(l, 1, a).setPosition(x, s * (w / 2 + 0.006), zz)); im.setColorAt(i, cor.set(k)); });
  void L;
  p.add(im);
}

/** pantógrafo em "Z" sobre o teto, com a base */
function pantografo(p: Pecas, x: number, alt: number, zTopo: number, carenagem: boolean) {
  const g = new THREE.Group(); g.position.x = x; p.add(g);
  const braco = (x0: number, z0: number, x1: number, z1: number) => { const l = Math.hypot(x1 - x0, z1 - z0); const o = p.caixa(l, 0.07, 0.07, (x0 + x1) / 2, 0, (z0 + z1) / 2, COR.grafite, g); o.rotation.y = -Math.atan2(z1 - z0, x1 - x0); };
  p.caixa(1.4, 1.2, 0.18, 0, 0, alt + 0.09, COR.grafite, g);
  braco(-0.9, alt + 0.2, 0.7, alt + 0.85); braco(0.7, alt + 0.85, -0.3, zTopo);
  p.caixa(0.14, 1.9, 0.06, -0.3, 0, zTopo, COR.grafite, g);
  if (carenagem) p.caixa(3.4, 1.2, 0.35, 0, 0, alt + 0.17, 0xc8ccd2, g);
}

/** trem de passageiros: trem-bala, unidade elétrica, metrô ou locomotiva elétrica com carros */
export function trem(tipo: TipoTrem, corpo: Corpo, fontes: readonly FonteSonora[], pint: Pintura, carenagem: boolean, rodas: Modelo['rodas']): THREE.Group[] {
  const xs = centros(corpo), n = corpo.segmentos.length, out: Pecas[] = [];
  corpo.segmentos.forEach((s, k) => {
    const p = new Pecas(); out.push(p);
    const loco = tipo === 'eletrica' && k === 0;
    const nar = k === 0 ? Math.min(corpo.nariz, s.comprimento * 0.6) : 0, cau = k === n - 1 ? Math.min(corpo.cauda, s.comprimento * 0.6) : 0;
    const forma = tipo === 'bala' ? 'bala' : 'cabine';
    const corCasca = loco ? (pint.frente ?? COR.vermelho) : pint.corpo;
    p.add(new THREE.Mesh(geometriaSegmento(s.comprimento, s.largura, s.altura, s.zPiso, loco ? Math.max(nar, 1.6) : nar, loco ? 0 : cau, forma), p.m(corCasca)));
    const H = s.altura - s.zPiso, zJan = s.zPiso + H * 0.56;
    const x0 = -s.comprimento / 2 + cau + 1.0, x1 = s.comprimento / 2 - nar - 1.0;
    // faixa (atravessa o corpo: aparece dos dois lados) e teto
    if (x1 > x0) p.caixa(x1 - x0 + 1.6, s.largura + 0.02, H * 0.06, (x0 + x1) / 2, 0, s.zPiso + H * 0.3, pint.faixa);
    if (loco) {
      p.caixa(s.comprimento * 0.7, s.largura + 0.02, 0.25, 0, 0, s.zPiso + H * 0.42, COR.branco);
      for (const s2 of [-1, 1]) p.caixa(2.2, 0.04, 0.7, s2 * 1.5, s.largura / 2 + 0.006, zJan, COR.vidro);
      p.caixa(2.2, 0.04, 0.7, 1.5, -s.largura / 2 - 0.006, zJan, COR.vidro);
    } else if (x1 > x0) {
      const passo = tipo === 'metro' ? 1.9 : 2.3;
      const portas = tipo === 'metro' ? [x0 + 2.5, (x0 + x1) / 2, x1 - 2.5] : tipo === 'unidade' ? [x0 + 1.4, x1 - 1.4] : [x1 - 0.8];
      janelas(p, s.comprimento, s.largura, zJan, H * (tipo === 'metro' ? 0.28 : 0.2), x0 + 1.4, x1 - 1.4, passo, portas, s.zPiso + H * 0.42, H * 0.62);
    }
    // para-brisa nas cabines (a frente do primeiro e o fim do último)
    const cabine = (frente: boolean) => {
      const L = frente ? (loco ? 1.6 : nar) : cau, xs0 = frente ? s.comprimento / 2 - L : -s.comprimento / 2;
      if (tipo === 'bala') { const o = p.caixa(L * 0.32, s.largura * 0.5, 0.5, frente ? xs0 + L * 0.33 : xs0 + L * 0.67, 0, s.zPiso + H * 0.68, COR.vidro); o.rotation.y = frente ? 0.42 : -0.42; }
      else if (!loco && L > 1.5) {
        // a testa deitada (o perfil 'cabine' de geometriaSegmento): o para-brisa deitado sobre ela, na metade do nariz
        const kk = Math.min(0.42, 0.05 + 0.055 * Math.max(nar, cau)), t = 0.5, zt = s.zPiso + H * (1 - kk * Math.pow(t, 1.6));
        const ang = Math.atan((H * kk * 1.6 * Math.pow(t, 0.6)) / L), x = frente ? s.comprimento / 2 - L * (1 - t) : -s.comprimento / 2 + L * (1 - t);
        const o = p.caixa((L * 0.4) / Math.cos(ang), s.largura * 0.8, 0.06, x, 0, zt + 0.02, COR.vidro); o.rotation.y = frente ? ang : -ang;
        for (const ss of [-1, 1]) p.caixa(0.06, 0.3, 0.14, frente ? s.comprimento / 2 - 0.02 : -s.comprimento / 2 + 0.02, ss * s.largura * 0.3, s.zPiso + H * 0.22, frente ? COR.farol : COR.lanterna);
      } else { const o = p.caixa(0.08, s.largura * 0.82, H * 0.28, frente ? s.comprimento / 2 - 0.06 : -s.comprimento / 2 + 0.06, 0, s.zPiso + H * 0.66, COR.vidro); o.rotation.y = frente ? 0.18 : -0.18;
        for (const ss of [-1, 1]) p.caixa(0.06, 0.3, 0.14, frente ? s.comprimento / 2 - 0.02 : -s.comprimento / 2 + 0.02, ss * s.largura * 0.32, s.zPiso + H * 0.22, frente ? COR.farol : COR.lanterna); }
    };
    if (k === 0) cabine(true);
    if (k === n - 1 && cau > 0) cabine(false);
    // teto (equipamentos) e a sanfona no vão até o próximo
    if (tipo !== 'bala' && !loco) p.caixa(s.comprimento * 0.5, s.largura * 0.5, 0.25, 0, 0, s.altura + 0.05, pint.teto);
    if (k < n - 1 && s.vao > 0) p.caixa(s.vao + 0.1, s.largura * 0.8, H * 0.82, -s.comprimento / 2 - s.vao / 2, 0, s.zPiso + H * 0.45, COR.grafite);
  });
  // truques e pantógrafos, nas fontes do portador
  for (const f of fontes) {
    const k = segmentoDe(corpo, xs, f.pos[0]), s = corpo.segmentos[k], x = f.pos[0] - xs[k];
    if (f.tipo === 'rolamento' && f.id.startsWith('truque')) truque(out[k], x, s.largura, rodas, tipo === 'metro' ? 0.4 : 0.43);
    else if (f.tipo === 'pantografo') pantografo(out[k], x, s.altura, f.pos[2], carenagem);
  }
  return out.map((p) => p.sombras());
}

/** locomotiva diesel-elétrica de capô longo (SD70ACe, C30-7): estrado, truques de três eixos, tanque, capô, radiador, cabine, nariz curto */
export function locomotivaDiesel(seg: Segmento, fontes: readonly FonteSonora[], cor: number, rodas: Modelo['rodas']): THREE.Group {
  const p = new Pecas(), L = seg.comprimento, W = seg.largura, H = seg.altura, deck = 1.5;
  p.caixa(L, W, 0.3, 0, 0, deck - 0.15, COR.grafite);                            // estrado
  p.caixa(L - 0.2, W + 0.02, 0.12, 0, 0, deck - 0.3, cor);                      // faixa da cor na borda do estrado
  for (const s of [-1, 1]) p.caixa(L - 1.2, 0.05, 0.05, -0.3, s * (W / 2 - 0.08), deck + 1.0, COR.amarelo);   // corrimão
  const r = 0.53;
  for (const xt of [L / 2 - 4.0, -L / 2 + 4.0]) {
    p.caixa(4.4, W * 0.82, 0.6, xt, 0, 0.82, COR.preto);
    for (let e = -1; e <= 1; e++) for (const s of [-1, 1]) p.roda(r, 0.16, xt + e * 1.65, s * 0.74, r, rodas, 0x34373b, 0x6b7077);
  }
  p.caixa(6.5, W * 0.85, 1.05, 0, 0, 0.92, COR.preto);                          // tanque
  const xCab = L / 2 - 4.3;
  p.caixa(L - 7.2, W * 0.76, H - deck - 0.25, -3.1, 0, deck + (H - deck - 0.25) / 2, cor);   // capô longo
  p.caixa(3.2, W * 0.92, H - deck - 0.1, -L / 2 + 2.0, 0, deck + (H - deck - 0.1) / 2, cor);   // radiador
  for (const s of [-1, 1]) p.caixa(2.8, 0.04, 1.0, -L / 2 + 2.0, s * (W * 0.46 + 0.01), H - 0.8, COR.grafite);
  for (const x of [-L / 2 + 1.2, -L / 2 + 2.8]) p.cil(0.55, 0.08, 'z', x, 0, H + 0.02, COR.grafite, 12);
  p.caixa(3.0, W * 0.98, H - deck, xCab, 0, deck + (H - deck) / 2, cor);         // cabine
  p.caixa(3.0, W, 0.12, xCab, 0, H + 0.06, COR.cinza);
  p.caixa(0.05, W * 0.8, 0.8, xCab + 1.52, 0, H - 0.75, COR.vidro);
  for (const s of [-1, 1]) p.caixa(1.6, 0.04, 0.75, xCab, s * (W * 0.49 + 0.01), H - 0.75, COR.vidro);
  p.perfil([[L / 2 - 0.35, deck], [L / 2 - 0.35, deck + 1.0], [L / 2 - 0.9, deck + 1.45], [xCab + 1.5, deck + 1.45], [xCab + 1.5, deck]], W * 0.8, cor);   // nariz curto
  for (const s of [-1, 1]) p.caixa(0.06, 0.3, 0.2, L / 2 - 0.3, s * 0.6, deck + 0.55, COR.farol);
  for (const x of [L / 2 - 0.3, -L / 2 + 0.3]) p.perfil([[x, 0.3], [x + Math.sign(x) * 0.4, 0.35], [x + Math.sign(x) * 0.4, 0.6], [x, deck - 0.3]], W * 0.9, COR.preto);   // limpa-trilhos
  const esc = fontes.find((f) => f.tipo === 'escape');
  if (esc) p.caixa(0.6, 0.5, 0.45, esc.pos[0], 0, H + 0.2, COR.grafite);       // chaminé
  return p.sombras();
}

/** arranjo de rodas de cada locomotiva a vapor: guia, motrizes (uma ou duas máquinas), arrasto, raio da motriz */
const RODEIROS: Record<string, { guia: number; motrizes: number[]; arrasto: number; r: number }> = {
  k4s: { guia: 2, motrizes: [3], arrasto: 1, r: 1.0 }, a4: { guia: 2, motrizes: [3], arrasto: 1, r: 1.0 }, king: { guia: 2, motrizes: [3], arrasto: 0, r: 0.98 },
  d51: { guia: 1, motrizes: [4], arrasto: 1, r: 0.7 }, up844: { guia: 2, motrizes: [4], arrasto: 2, r: 0.97 }, bigboy: { guia: 2, motrizes: [4, 4], arrasto: 2, r: 0.86 },
  y6b: { guia: 1, motrizes: [4, 4], arrasto: 1, r: 0.73 }, maria_fumaca: { guia: 1, motrizes: [4], arrasto: 0, r: 0.56 }, pannier: { guia: 0, motrizes: [3], arrasto: 0, r: 0.7 },
  shay: { guia: 0, motrizes: [4], arrasto: 0, r: 0.45 },
};

/**
 * Locomotiva a vapor (segmento 0), tênder (1) e a composição (2…): caldeira, caixa de fumaça, chaminé, domos, cabine,
 * limpa-trilhos, cilindros, rodas motrizes com a biela de acoplamento e a biela principal, que andam com o ângulo da roda.
 */
export function trensVapor(id: string, corpo: Corpo, fontes: readonly FonteSonora[], rodas: Modelo['rodas']): { segs: THREE.Group[]; animar: (d: number) => void; moveis: THREE.Object3D[] } {
  const xs = centros(corpo), segs: THREE.Group[] = [];
  const s0 = corpo.segmentos[0], L = s0.comprimento, W = s0.largura, H = s0.altura;
  const p = new Pecas(), preto = 0x24272b, vermelho = 0x8a2a22;
  const rd = RODEIROS[id] ?? { guia: 2, motrizes: [3], arrasto: 1, r: Math.min(0.9, 0.2 * H) };
  const rel = (f?: FonteSonora) => (f ? f.pos[0] - xs[0] : NaN);
  const chamine = fontes.find((f) => f.id === 'chamine'), motriz = fontes.find((f) => f.id.startsWith('rolamento.motriz')), guia = fontes.find((f) => f.id === 'rolamento.guia');
  const board = Math.max(1.2, rd.r * 2 + 0.15), rb = Math.min(0.44 * W, 0.22 * H + 0.1), zb = Math.max(board + rb - 0.1, H - rb - 0.95);
  const xCab = -L / 2 + 1.5, xFrente = L / 2 - 0.4;
  p.caixa(L - 0.4, W * 0.98, 0.18, 0, 0, board, preto);                           // estrado
  p.cil(rb, L - 3.6, 'x', 0.5, 0, zb, preto, 16);                                // caldeira
  p.cil(rb + 0.04, 1.5, 'x', xFrente - 0.8, 0, zb, COR.grafite, 16);              // caixa de fumaça
  p.cil(rb * 0.75, 0.06, 'x', xFrente - 0.02, 0, zb, 0x3a3d42, 16);               // porta
  const xCh = Number.isFinite(rel(chamine)) ? rel(chamine) : xFrente - 0.9;
  p.cil(0.28, H - zb - rb + 0.05, 'z', xCh, 0, zb + rb + (H - zb - rb) / 2 - 0.05, preto, 10, undefined, 0.34);
  p.cil(0.34, 0.5, 'z', 0.4, 0, zb + rb + 0.2, preto, 12); p.cil(0.3, 0.4, 'z', -1.2, 0, zb + rb + 0.15, preto, 12);   // domos
  p.cil(0.12, 0.2, 'z', xFrente - 0.1, 0, zb + 0.55 * rb, COR.farol, 10);         // farol
  p.caixa(3.0, W, H - board, xCab, 0, board + (H - board) / 2, preto);            // cabine
  p.caixa(3.3, W + 0.2, 0.12, xCab - 0.1, 0, H + 0.06, preto);
  for (const s of [-1, 1]) p.caixa(1.1, 0.04, 0.75, xCab + 0.4, s * (W / 2 + 0.006), H - 0.85, COR.vidro);
  p.perfil([[L / 2 - 0.1, 0.12], [L / 2 + 0.75, 0.12], [L / 2 - 0.1, Math.min(board, 1.15)]], W * 0.7, 0x3a3d42);   // limpa-trilhos
  p.caixa(0.25, W * 0.95, 0.35, L / 2 - 0.15, 0, Math.min(board, 1.15) + 0.1, vermelho);   // travessa dos para-choques
  // cilindros na frente, dos dois lados
  const xCil = xFrente - 1.8, zCil = Math.max(0.75, rd.r * 0.9);
  for (const s of [-1, 1]) p.cil(0.33, 1.3, 'x', xCil, s * (W / 2 - 0.3), zCil, preto, 12);
  // rodas: guia, motrizes (uma ou duas máquinas) e arrasto
  const passoM = rd.r * 2 + 0.18, nM = rd.motrizes.reduce((a, b) => a + b, 0);
  const xM0 = Number.isFinite(rel(motriz)) ? rel(motriz) + ((rd.motrizes[0] - 1) * passoM) / 2 : 0;
  const xsMot: number[][] = [];
  let x = xM0;
  rd.motrizes.forEach((nm, gi) => { const l: number[] = []; for (let i = 0; i < nm; i++) { l.push(x); x -= passoM; } xsMot.push(l); if (gi < rd.motrizes.length - 1) x -= 0.6; });
  void nM;
  const rG = Math.min(0.48, rd.r * 0.55), xG = Number.isFinite(rel(guia)) ? rel(guia) : xFrente - 1.0;
  for (let i = 0; i < rd.guia; i++) for (const s of [-1, 1]) p.roda(rG, 0.14, xG - i * (rG * 2 + 0.2), s * (W / 2 - 0.45), rG, rodas, preto, vermelho);
  for (const l of xsMot) for (const xm of l) for (const s of [-1, 1]) p.roda(rd.r, 0.16, xm, s * (W / 2 - 0.35), rd.r, rodas, preto, vermelho);
  const xA = x - 0.2;
  for (let i = 0; i < rd.arrasto; i++) for (const s of [-1, 1]) p.roda(0.5, 0.14, xA - i * 1.1, s * (W / 2 - 0.45), 0.5, rodas, preto, vermelho);
  // bielas: a de acoplamento liga os pinos das motrizes; a principal vai da cruzeta (atrás do cilindro) ao pino da 2ª
  const rc = rd.r * 0.42, bielas: { acop: THREE.Mesh; princ: THREE.Mesh; lado: number; grupo: number[]; xCruz: number }[] = [];
  xsMot.forEach((l, gi) => {
    // (na articulada, a segunda máquina tem os cilindros dela, logo à frente das suas rodas)
    const xCruz = gi === 0 ? xCil - 0.9 : l[0] + rd.r + 0.7;
    if (gi > 0) for (const s of [-1, 1]) p.cil(0.3, 1.1, 'x', xCruz + 0.8, s * (W / 2 - 0.3), zCil, preto, 12);
    for (const s of [-1, 1]) {
      const y = s * (W / 2 - 0.15);
      const acop = p.caixa(1, 0.06, 0.1, 0, y, 0, COR.prata); acop.scale.x = Math.max(0.5, l[0] - l[l.length - 1] + 0.3);
      const princ = p.caixa(1, 0.07, 0.12, 0, y + s * 0.07, 0, COR.prata);
      bielas.push({ acop, princ, lado: s, grupo: l, xCruz });
    }
  });
  segs.push(p.sombras());
  // tênder e composição
  corpo.segmentos.forEach((s, k) => {
    if (k === 0) return;
    const q = new Pecas();
    if (k === 1) {
      q.caixa(s.comprimento, s.largura, s.altura - 1.4, 0, 0, 1.25 + (s.altura - 1.4) / 2, preto);
      q.perfil([[s.comprimento / 2 - 0.4, s.altura - 0.15], [s.comprimento / 2 - 1.5, s.altura + 0.3], [-s.comprimento / 2 + 2.0, s.altura + 0.3], [-s.comprimento / 2 + 1.0, s.altura - 0.15]], s.largura * 0.8, 0x1a1b1d);   // carvão
    } else if (id === 'bigboy' || id === 'y6b' || id === 'shay') {
      q.caixa(s.comprimento, s.largura, s.altura - 1.2, 0, 0, 1.15 + (s.altura - 1.2) / 2, 0x6e3b2a);   // vagão fechado de carga
      q.caixa(s.comprimento + 0.1, s.largura + 0.1, 0.1, 0, 0, s.altura, 0x4a3328);
      for (const ss of [-1, 1]) q.caixa(2.2, 0.03, s.altura - 1.6, 0, ss * (s.largura / 2 + 0.01), 1.15 + (s.altura - 1.2) / 2, 0x4a3328);
    } else {
      const corCarro = id === 'maria_fumaca' ? 0x3f6b46 : 0x7b3326;
      q.caixa(s.comprimento, s.largura, s.altura - 1.5, 0, 0, 1.1 + (s.altura - 1.5) / 2, corCarro);   // carro de passageiros
      q.perfil([[s.comprimento / 2, s.altura - 0.42], [s.comprimento / 2 - 0.6, s.altura], [-s.comprimento / 2 + 0.6, s.altura], [-s.comprimento / 2, s.altura - 0.42]], s.largura * 0.96, 0x4b4f55);   // teto em arco
      janelas(q, s.comprimento, s.largura, 1.1 + (s.altura - 1.5) * 0.62, 0.65, -s.comprimento / 2 + 1.4, s.comprimento / 2 - 1.4, 1.5, [], 0, 0);
    }
    for (const xt of [s.comprimento / 2 - 2.2, -s.comprimento / 2 + 2.2]) truque(q, xt, s.largura, rodas, 0.42, 2, 1.8);
    if (s.vao > 0) q.caixa(s.vao + 0.1, 0.4, 0.3, -s.comprimento / 2 - s.vao / 2, 0, 1.0, COR.preto);
    segs.push(q.sombras());
  });
  // (a roda gira em torno do y do corpo: andando para a frente, o pino desce na frente; o ângulo do pino é −d/r)
  const animar = (d: number) => {
    const ang = -d / rd.r;
    for (const b of bielas) {
      const a = ang + (b.lado > 0 ? 0 : Math.PI / 2), cx = Math.cos(a) * rc, cz = Math.sin(a) * rc;
      const l = b.grupo, xm = (l[0] + l[l.length - 1]) / 2;
      b.acop.position.set(xm + cx, b.acop.position.y, rd.r + cz);
      // a principal: da cruzeta (no eixo do cilindro, andando com o curso) ao pino da segunda motriz
      const xp = (l[1] ?? l[0]) + cx, zp = rd.r + cz, xcz = b.xCruz + cx * 0.5, zcz = zCil;
      const dx = xp - xcz, dz = zp - zcz;
      b.princ.position.set((xp + xcz) / 2, b.princ.position.y, (zp + zcz) / 2);
      b.princ.scale.x = Math.hypot(dx, dz); b.princ.rotation.y = -Math.atan2(dz, dx);
    }
  };
  animar(0);
  return { segs, animar, moveis: bielas.flatMap((b) => [b.acop, b.princ]) };
}
