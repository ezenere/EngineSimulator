// Veículos de estrada low poly: carros (sedã, cupê, esportivo, hatch, muscle), picape, caminhão com cavalo e carreta,
// ônibus, moto com o piloto, tanque, fórmula, protótipo de Le Mans e carro antigo. Medidas reais do tipo (o corpo do
// portador "carro" tem 4,6 m para todos: o modelo fica centrado nele). A silhueta de lado é um perfil extrudado; os
// vidros são uma faixa escura opaca; faróis, lanternas, para-choques e rodas que giram.
import { Pecas, COR, arco, type Modelo } from './kit';
import type { TipoCarro } from './tipos';

export type { TipoCarro };

/** perfil do vidro e do teto por tipo, em frações do comprimento: base do para-brisa, frente do teto, trás do teto, base do vidro de trás */
const ESTUFA: Record<'sedan' | 'cupe' | 'esportivo' | 'hatch' | 'muscle', [number, number, number, number]> = {
  sedan: [0.2, 0.04, -0.24, -0.38], cupe: [0.14, -0.02, -0.2, -0.4], esportivo: [0.18, -0.04, -0.2, -0.46], hatch: [0.22, 0.05, -0.44, -0.49], muscle: [0.08, -0.06, -0.24, -0.38],
};

/** monta o carro; `cor` é a cor da carroceria */
export function carro(tipo: TipoCarro, cor: number, rodas: Modelo['rodas']): Pecas {
  if (tipo === 'picape') return picape(cor, rodas);
  if (tipo === 'caminhao') return caminhao(cor, rodas);
  if (tipo === 'onibus') return onibus(cor, rodas);
  if (tipo === 'moto') return moto(cor, rodas);
  if (tipo === 'tanque') return tanque(rodas);
  if (tipo === 'formula') return formula(cor, rodas);
  if (tipo === 'prototipo') return prototipo(cor, rodas);
  if (tipo === 'antigo') return antigo(cor, rodas);
  if (tipo === 'gp-antigo') return gpAntigo(cor, rodas);
  return automovel(tipo, cor, rodas);
}

/** sedã, cupê, esportivo, hatch e muscle: a carroceria baixa com os para-lamas recortados, a estufa escura, o teto */
function automovel(tipo: keyof typeof ESTUFA, cor: number, rodas: Modelo['rodas']) {
  const p = new Pecas();
  const dims = { sedan: [4.7, 1.82, 1.45], cupe: [4.5, 1.85, 1.35], esportivo: [4.4, 1.9, 1.2], hatch: [4.3, 1.8, 1.5], muscle: [4.8, 1.9, 1.38] }[tipo];
  const [L, W, H] = dims, g = 0.16, r = tipo === 'esportivo' ? 0.34 : 0.33, entre = L * 0.31;
  const cint = g + (H - g) * (tipo === 'esportivo' ? 0.52 : 0.56), capo = cint - (tipo === 'muscle' ? 0.04 : 0.12);
  const ra = r + 0.06, a0 = Math.asin((g - r) / ra);
  // carroceria: frente, capô, cintura, traseira e o assoalho com os dois para-lamas recortados
  const corpo: [number, number][] = [
    [L / 2, g + 0.12], [L / 2, capo - 0.08], [L / 2 - 0.25, capo], [L * ESTUFA[tipo][0], cint], [-L / 2 + 0.2, cint + (tipo === 'muscle' ? 0.03 : 0)], [-L / 2, cint - 0.1], [-L / 2, g + 0.12],
    [-L / 2 + 0.25, g],
    ...arco(-entre, r, ra, Math.PI - a0, a0, 7),
    ...arco(entre, r, ra, Math.PI - a0, a0, 7),
    [L / 2 - 0.25, g],
  ];
  p.perfil(corpo, W, cor);
  // estufa (vidros) e o teto
  const [fp, ft, tt, tp] = ESTUFA[tipo];
  p.perfil([[L * fp, cint - 0.01], [L * ft, H - 0.05], [L * tt, H - 0.05], [L * tp, cint - 0.01]], W * 0.84, COR.vidro);
  p.perfil([[L * ft + 0.02, H - 0.07], [L * ft - 0.04, H], [L * tt + 0.04, H], [L * tt - 0.02, H - 0.07]], W * 0.86, cor);
  // coluna do meio, de lado
  p.caixa(0.1, W * 0.86, H - cint - 0.08, (L * ft + L * tt) / 2 + 0.05, 0, (H + cint) / 2 - 0.02, cor);
  // faróis, lanternas, grade e para-choques
  for (const s of [-1, 1]) {
    p.caixa(0.06, 0.34, 0.1, L / 2 - 0.02, s * (W / 2 - 0.28), capo - 0.12, COR.farol);
    p.caixa(0.06, 0.36, 0.1, -L / 2 + 0.01, s * (W / 2 - 0.26), cint - 0.18, COR.lanterna);
    p.caixa(0.12, 0.04, 0.08, L * 0.18, s * (W / 2 + 0.04), cint + 0.12, cor);   // retrovisor
  }
  p.caixa(0.05, W * 0.42, 0.14, L / 2 + 0.005, 0, capo - 0.2, COR.preto);
  p.caixa(0.12, W * 0.98, 0.16, L / 2 - 0.04, 0, g + 0.12, COR.preto);
  p.caixa(0.12, W * 0.98, 0.16, -L / 2 + 0.04, 0, g + 0.12, COR.preto);
  for (const x of [-entre, entre]) for (const s of [-1, 1]) p.roda(r, 0.24, x, s * (W / 2 - 0.14), r, rodas);
  return p;
}

function picape(cor: number, rodas: Modelo['rodas']) {
  const p = new Pecas();
  const L = 5.3, W = 1.86, H = 1.82, g = 0.26, r = 0.39, cint = 1.12, eF = 1.65, eT = -1.55;
  const ra = r + 0.07, a0 = Math.asin((g - r) / ra);
  // (atrás da cabine a carroceria só vai até o piso da caçamba: as paredes dela são peças à parte, e o vão fica aberto)
  const piso = 0.82;
  p.perfil([
    [L / 2, g + 0.15], [L / 2, cint - 0.06], [L / 2 - 0.2, cint + 0.02], [0.9, cint + 0.04], [-1.02, cint + 0.04], [-1.02, piso], [-L / 2, piso], [-L / 2, g + 0.15],
    [-L / 2 + 0.3, g], ...arco(eT, r, ra, Math.PI - a0, a0, 7), ...arco(eF, r, ra, Math.PI - a0, a0, 7), [L / 2 - 0.3, g],
  ], W, cor);
  const cb = L / 2 - 1.02, xb = (-L / 2 - 1.02) / 2, hb = cint + 0.04 - piso;
  for (const s of [-1, 1]) p.caixa(cb, 0.06, hb, xb, s * (W / 2 - 0.03), piso + hb / 2, cor);
  p.caixa(0.06, W, hb, -L / 2 + 0.03, 0, piso + hb / 2, cor);
  // cabine dupla e a caçamba aberta atrás dela
  p.perfil([[0.9, cint + 0.03], [0.35, H - 0.05], [-0.95, H - 0.05], [-1.0, cint + 0.03]], W * 0.86, COR.vidro);
  p.perfil([[0.37, H - 0.07], [0.33, H], [-0.95, H], [-0.97, H - 0.07]], W * 0.88, cor);
  p.caixa(0.08, W * 0.86, H - cint - 0.1, -0.3, 0, (H + cint) / 2, cor);
  p.caixa(cb - 0.1, W - 0.12, 0.04, xb, 0, piso + 0.02, COR.grafite);   // piso da caçamba
  for (const s of [-1, 1]) {
    p.caixa(0.06, 0.34, 0.12, L / 2 - 0.02, s * (W / 2 - 0.3), cint - 0.18, COR.farol);
    p.caixa(0.06, 0.12, 0.3, -L / 2 + 0.01, s * (W / 2 - 0.1), cint - 0.2, COR.lanterna);
    p.caixa(0.14, 0.05, 0.12, 0.7, s * (W / 2 + 0.06), cint + 0.15, cor);
  }
  p.caixa(0.06, W * 0.6, 0.3, L / 2 + 0.005, 0, cint - 0.28, COR.grafite);
  p.caixa(0.14, W, 0.2, L / 2 - 0.05, 0, g + 0.16, COR.grafite);
  p.caixa(0.14, W, 0.18, -L / 2 + 0.05, 0, g + 0.16, COR.cinza);
  for (const x of [eT, eF]) for (const s of [-1, 1]) p.roda(r, 0.27, x, s * (W / 2 - 0.14), r, rodas);
  return p;
}

/** cavalo mecânico de cabine avançada e a carreta baú: 16,5 m, três eixos em cada */
function caminhao(cor: number, rodas: Modelo['rodas']) {
  const p = new Pecas();
  const xc = 6.6, r = 0.52;   // frente do cavalo em x = 8,25
  // cabine
  p.caixa(2.3, 2.5, 2.5, xc + 0.5, 0, 2.35, cor);
  p.caixa(0.06, 2.3, 1.0, xc + 1.66, 0, 2.75, COR.vidro);                 // para-brisa
  for (const s of [-1, 1]) p.caixa(0.9, 0.04, 0.8, xc + 1.1, s * 1.26, 2.75, COR.vidro);
  p.caixa(1.6, 2.5, 0.7, xc + 0.2, 0, 3.95, cor);                          // teto alto (defletor)
  p.caixa(0.06, 1.6, 0.6, xc + 1.66, 0, 1.55, COR.grafite);               // grade
  for (const s of [-1, 1]) p.caixa(0.06, 0.4, 0.18, xc + 1.66, s * 0.95, 1.3, COR.farol);
  p.caixa(0.25, 2.5, 0.3, xc + 1.62, 0, 0.95, COR.grafite);               // para-choque
  // chassi, tanques, quinta roda e o escape vertical atrás da cabine
  p.caixa(7.0, 1.0, 0.3, 4.6, 0, 1.0, COR.preto);
  for (const s of [-1, 1]) p.cil(0.33, 1.2, 'x', 5.0, s * 1.0, 1.05, COR.prata, 10);
  p.cil(0.09, 1.6, 'z', xc - 0.75, 0.95, 3.3, COR.prata, 8);
  for (const x of [xc + 0.8, 2.6, 1.3]) for (const s of [-1, 1]) p.roda(r, 0.32, x, s * 1.05, r, rodas);
  // carreta baú
  p.caixa(13.4, 2.6, 2.75, -1.25, 0, 2.62, COR.branco);
  p.caixa(13.4, 2.62, 0.25, -1.25, 0, 1.35, cor);                         // faixa da cor do cavalo
  p.caixa(12.0, 1.0, 0.3, -1.5, 0, 1.08, COR.preto);
  for (const x of [-5.6, -6.9, -8.2 + 0.4]) for (const s of [-1, 1]) p.roda(r, 0.32, x, s * 1.05, r, rodas);
  for (const s of [-1, 1]) p.caixa(0.06, 0.25, 0.12, -7.96, s * 1.1, 1.3, COR.lanterna);
  return p;
}

function onibus(cor: number, rodas: Modelo['rodas']) {
  const p = new Pecas();
  const L = 12.2, W = 2.55, H = 3.15, g = 0.35, r = 0.5, eF = L / 2 - 2.6, eT = -L / 2 + 3.2;
  const ra = r + 0.08, a0 = Math.asin((g - r) / ra);
  p.perfil([
    [L / 2, g + 0.1], [L / 2 + 0.05, 1.2], [L / 2 - 0.12, H - 0.1], [L / 2 - 0.3, H], [-L / 2 + 0.15, H], [-L / 2, H - 0.15], [-L / 2, g + 0.1],
    [-L / 2 + 0.4, g], ...arco(eT, r, ra, Math.PI - a0, a0, 7), ...arco(eF, r, ra, Math.PI - a0, a0, 7), [L / 2 - 0.4, g],
  ], W, COR.branco);
  // faixa de janelas, para-brisa, portas e a faixa da cor da empresa
  p.caixa(L - 2.4, W + 0.02, 1.05, -0.6, 0, 2.15, COR.vidro);
  p.caixa(0.05, W * 0.92, 1.4, L / 2 + 0.04, 0, 2.05, COR.vidro);
  p.caixa(L - 0.2, W + 0.03, 0.35, 0, 0, 1.15, cor);
  for (const x of [L / 2 - 1.2, 0.3]) p.caixa(1.1, W + 0.04, 2.1, x, 0, 1.45, COR.vidro);   // portas (as duas faces)
  for (const s of [-1, 1]) { p.caixa(0.05, 0.35, 0.14, L / 2 + 0.05, s * (W / 2 - 0.35), 0.75, COR.farol); p.caixa(0.05, 0.2, 0.4, -L / 2 - 0.01, s * (W / 2 - 0.2), 1.0, COR.lanterna); }
  for (const x of [eT, eF]) for (const s of [-1, 1]) p.roda(r, 0.3, x, s * (W / 2 - 0.2), r, rodas);
  return p;
}

/** moto com o piloto (a silhueta de alguém montado é o que faz uma moto parecer moto de longe) */
function moto(cor: number, rodas: Modelo['rodas']) {
  const p = new Pecas();
  const r = 0.31, e = 0.72;
  p.roda(r, 0.16, e, 0, r, rodas); p.roda(r, 0.19, -e, 0, r, rodas);
  // carenagem, tanque, banco, garfo e escape
  p.perfil([[e + 0.25, 0.55], [e + 0.1, 1.0], [0.25, 1.02], [0.1, 0.62], [0.45, 0.42]], 0.5, cor);
  p.perfil([[0.25, 0.95], [-0.45, 0.88], [-0.72, 0.95], [-0.75, 0.82], [-0.2, 0.7], [0.15, 0.7]], 0.32, COR.preto);
  p.caixa(0.06, 0.08, 0.5, e - 0.05, 0, 0.62, COR.prata).rotation.y = -0.4;
  p.cil(0.06, 0.8, 'x', -0.4, -0.18, 0.42, COR.prata, 8);
  p.caixa(0.05, 0.16, 0.1, e + 0.24, 0, 0.82, COR.farol);
  // piloto: pernas, tronco inclinado, braços e o capacete
  const piloto = 0x2b3a55;
  p.caixa(0.5, 0.42, 0.22, -0.15, 0, 1.0, piloto);
  p.caixa(0.55, 0.38, 0.28, 0.1, 0, 1.25, piloto).rotation.y = -0.6;
  for (const s of [-1, 1]) { p.caixa(0.45, 0.09, 0.09, 0.42, s * 0.2, 1.22, piloto).rotation.y = 0.35; p.caixa(0.12, 0.1, 0.42, 0.05, s * 0.2, 0.75, piloto); }
  p.cil(0.15, 0.3, 'x', 0.38, 0, 1.47, cor, 10);
  p.cil(0.14, 0.05, 'x', 0.53, 0, 1.47, COR.vidro, 10);
  return p;
}

/** tanque M4 Sherman: casco de glacis inclinado, lagartas com as rodas de apoio, torre e canhão */
function tanque(rodas: Modelo['rodas']) {
  const p = new Pecas(), oliva = 0x5a6136, escuro = 0x33362a;
  const L = 5.9, W = 2.62;
  p.perfil([[L / 2, 0.75], [L / 2 - 0.15, 1.15], [1.35, 1.95], [-L / 2 + 0.3, 1.95], [-L / 2, 1.6], [-L / 2, 0.9], [-L / 2 + 0.4, 0.55], [L / 2 - 0.4, 0.55]], W - 0.8, oliva);
  for (const s of [-1, 1]) {
    p.perfil([[L / 2 - 0.05, 0.8], [L / 2 - 0.45, 1.05], [-L / 2 + 0.3, 1.05], [-L / 2, 0.8], [-L / 2 + 0.35, 0.05], [L / 2 - 0.45, 0.05]], 0.5, escuro, s * (W / 2 - 0.25));
    for (let i = 0; i < 6; i++) p.roda(0.26, 0.54, -2.0 + i * 0.8, s * (W / 2 - 0.25), 0.33, rodas, escuro, 0x6b6f5a);
    p.caixa(L - 0.5, 0.55, 0.06, 0, s * (W / 2 - 0.25), 1.1, oliva);   // para-lama
  }
  p.perfil([[0.9, 1.95], [0.75, 2.6], [-0.9, 2.65], [-1.25, 2.35], [-1.2, 1.95]], 1.9, oliva);   // torre
  p.cil(0.08, 2.6, 'x', 2.1, 0, 2.3, escuro, 8);
  p.cil(0.2, 0.5, 'x', 0.95, 0, 2.3, oliva, 8);
  p.cil(0.3, 0.12, 'z', -0.3, 0.4, 2.72, escuro, 10);   // escotilha
  return p;
}

function formula(cor: number, rodas: Modelo['rodas']) {
  const p = new Pecas(), r = 0.33;
  p.torno([[-2.3, 0.28], [-1.6, 0.35], [-0.3, 0.38], [0.8, 0.28], [2.2, 0.12], [2.6, 0.05]], cor, 10, 0, 0.42, undefined, 0.75);
  p.caixa(1.6, 1.5, 0.4, -0.7, 0, 0.38, cor);                     // pontões
  p.caixa(0.5, 1.9, 0.05, 2.55, 0, 0.12, COR.preto);              // asa dianteira
  p.caixa(0.45, 1.0, 0.06, -2.55, 0, 0.98, COR.preto);            // asa traseira
  for (const s of [-1, 1]) p.caixa(0.5, 0.04, 0.55, -2.55, s * 0.5, 0.72, COR.preto);
  p.cil(0.13, 0.26, 'z', 0.1, 0, 0.72, COR.amarelo, 10);          // capacete
  for (const x of [1.65, -1.55]) for (const s of [-1, 1]) p.roda(r, x > 0 ? 0.3 : 0.4, x, s * 0.82, r, rodas);
  return p;
}

function prototipo(cor: number, rodas: Modelo['rodas']) {
  const p = new Pecas(), L = 4.8, W = 2.0, r = 0.33, g = 0.08, ra = r + 0.05, a0 = Math.asin((g - r) / ra);
  p.perfil([
    [L / 2, 0.2], [L / 2 - 0.1, 0.5], [0.8, 0.8], [-1.4, 0.86], [-L / 2, 0.92], [-L / 2, 0.35], [-L / 2 + 0.2, g],
    ...arco(-1.45, r, ra, Math.PI - a0, a0, 6), ...arco(1.4, r, ra, Math.PI - a0, a0, 6), [L / 2 - 0.2, g],
  ], W, cor);
  p.perfil([[0.75, 0.78], [0.2, 1.08], [-0.6, 1.08], [-0.75, 0.84]], 0.95, COR.vidro);
  p.caixa(0.06, 0.6, 0.35, -1.2, 0, 1.1, 0x3d8a4a);              // barbatana
  p.caixa(0.45, W, 0.05, -L / 2 + 0.2, 0, 1.12, COR.preto);       // asa
  for (const s of [-1, 1]) { p.caixa(0.4, 0.04, 0.3, -L / 2 + 0.2, s * (W / 2 - 0.04), 0.95, COR.preto); p.caixa(0.05, 0.3, 0.1, L / 2 - 0.06, s * 0.65, 0.4, COR.farol); }
  p.caixa(L * 0.9, W + 0.02, 0.12, 0, 0, 0.55, 0x3d8a4a);         // faixa verde da pintura
  for (const x of [-1.45, 1.4]) for (const s of [-1, 1]) p.roda(r, 0.32, x, s * (W / 2 - 0.18), r, rodas);
  return p;
}

/** carro dos anos 1920 (o Stanley): capô curto, para-lamas soltos, bancos abertos, rodas grandes e finas */
function antigo(cor: number, rodas: Modelo['rodas']) {
  const p = new Pecas(), r = 0.43;
  p.caixa(3.4, 1.4, 0.35, -0.1, 0, 0.75, COR.preto);               // chassi
  p.perfil([[1.6, 0.9], [1.6, 1.25], [0.8, 1.3], [0.8, 0.9]], 0.9, cor);   // capô
  p.perfil([[0.8, 0.9], [0.8, 1.35], [-1.5, 1.35], [-1.6, 1.2], [-1.6, 0.9]], 1.4, cor);   // carroceria aberta
  p.caixa(0.6, 1.3, 0.5, 0.3, 0, 1.45, COR.marrom); p.caixa(0.6, 1.3, 0.5, -0.9, 0, 1.45, COR.marrom);   // bancos
  p.caixa(0.05, 0.9, 0.45, 0.82, 0, 1.6, COR.vidro);               // para-brisa
  for (const s of [-1, 1]) {
    p.caixa(3.0, 0.32, 0.04, 0.0, s * 0.85, 0.95, COR.preto);     // estribo e para-lamas
    p.cil(0.11, 0.06, 'x', 1.65, s * 0.45, 1.2, COR.farol, 10);
  }
  for (const x of [1.25, -1.25]) for (const s of [-1, 1]) p.roda(r, 0.1, x, s * 0.72, r, rodas, COR.pneu, 0xc9b27a);
  return p;
}

/** carro de Grand Prix dos anos 1930 (Monaco-Trossi): charuto, rodas expostas */
function gpAntigo(cor: number, rodas: Modelo['rodas']) {
  const p = new Pecas(), r = 0.4;
  p.torno([[-2.0, 0.05], [-1.6, 0.4], [0.0, 0.45], [1.5, 0.38], [2.0, 0.25]], cor, 10, 0, 0.62);
  p.cil(0.13, 0.25, 'z', -0.4, 0, 1.05, COR.marrom, 10);
  for (const x of [1.3, -1.3]) for (const s of [-1, 1]) p.roda(r, 0.14, x, s * 0.72, r, rodas, COR.pneu, COR.prata);
  return p;
}
