// Máquinas que não são carro, trem nem aeronave: grupo gerador diesel (base, motor, radiador, alternador, silencioso),
// gerador rotativo pequeno, máquina a vapor Corliss de moinho (volante, cilindro, caldeira com chaminé), trator a vapor
// de estrada e vapor de rodas de pás. Nas medidas do corpo do portador.
import * as THREE from 'three';
import { Pecas, COR, type Modelo } from './kit';
import type { Segmento } from '../../../carriers/tipos';
import type { FonteSonora } from '../../../scene/tipos';

/** grupo gerador diesel aberto sobre a base (o Cummins de 500 kVA) */
export function geradorDiesel(seg: Segmento, fontes: readonly FonteSonora[], cor: number) {
  const p = new Pecas(), L = seg.comprimento, W = seg.largura;
  p.caixa(L + 0.2, W + 0.1, 0.22, 0, 0, 0.11, COR.preto);                     // base
  p.caixa(1.5, W * 0.72, 0.95, 0.35, 0, 0.75, cor);                           // bloco do motor
  p.caixa(1.3, W * 0.6, 0.3, 0.35, 0, 1.35, cor);                             // tampa de válvulas
  p.caixa(0.35, W * 0.95, 1.35, L / 2 - 0.25, 0, 0.9, COR.grafite);           // radiador
  p.caixa(0.04, W * 0.8, 1.1, L / 2 - 0.06, 0, 0.9, 0x5b6168);                // colmeia
  p.cil(0.42, 0.95, 'x', -0.85, 0, 0.75, cor, 14);                           // alternador
  p.caixa(0.45, 0.6, 0.8, -1.25, W / 2 - 0.25, 0.7, COR.claro);              // painel de controle
  const esc = fontes.find((f) => f.tipo === 'escape');
  const xe = esc?.pos[0] ?? 0.7, ze = esc?.pos[2] ?? 2.2;
  p.cil(0.2, 0.9, 'x', xe - 0.2, -0.25, 1.65, COR.prata, 10);                // silencioso
  p.cil(0.07, ze - 1.6, 'z', xe + 0.2, -0.25, 1.6 + (ze - 1.6) / 2, COR.prata, 8);
  p.cil(0.25, 0.35, 'x', 0.75, W * 0.35, 1.15, COR.preto, 10);               // filtro de ar
  return p.sombras();
}

/** máquina a vapor Corliss de moinho: base de alvenaria, cilindro horizontal, biela, volante grande e a caldeira com a chaminé */
export function corliss(seg: Segmento, fontes: readonly FonteSonora[], giros: Modelo['giros']) {
  const p = new Pecas(), L = seg.comprimento, W = seg.largura, tijolo = 0x8b4a36;
  p.caixa(L * 0.75, 1.6, 0.9, 0.5, 0, 0.45, tijolo);                         // base
  p.cil(0.55, 2.2, 'x', 2.8, 0, 1.45, COR.verde, 14);                        // cilindro
  p.caixa(3.2, 0.3, 0.3, 0.6, 0, 1.45, COR.prata);                           // barra e cruzeta
  const v = new THREE.Group(); v.position.set(-1.2, 0.9, 2.6); v.rotation.x = Math.PI / 2; p.add(v);
  p.cil(2.45, 0.35, 'z', 0, 0, 0, 0x2b2e33, 24, v);                          // volante
  for (let i = 0; i < 6; i++) { const r = p.caixa(4.6, 0.18, 0.14, 0, 0, 0.02, COR.verde, v); r.rotation.z = (i * Math.PI) / 6; }
  giros.push({ o: v, k: 1, fonte: 'helice' });
  // caldeira e chaminé atrás (a fonte da chaminé)
  const ch = fontes.find((f) => f.id === 'chamine');
  const xc = ch?.pos[0] ?? -4, zc = ch?.pos[2] ?? 5.8;
  p.cil(1.0, 3.2, 'x', -L / 2 + 1.8, -W / 2 + 1.2, 1.1, 0x5a4a3a, 14);
  p.cil(0.35, zc, 'z', xc - 4.5, -W / 2 + 1.2, zc / 2, tijolo, 10, undefined, 0.45);
  return p.sombras();
}

/** trator a vapor de estrada (Aveling & Porter): rodas de ferro grandes atrás, caldeira, chaminé, toldo, volante */
export function tratorVapor(seg: Segmento, fontes: readonly FonteSonora[], rodas: Modelo['rodas']) {
  const p = new Pecas(), L = seg.comprimento, W = seg.largura, H = seg.altura, verde = 0x2f5a3a, vermelho = 0x9a2a22, preto = 0x24272b;
  p.cil(0.5, L * 0.5, 'x', 0.6, 0, 1.45, verde, 14);                          // caldeira
  p.cil(0.56, 0.6, 'x', L / 2 - 0.9, 0, 1.45, preto, 14);                     // caixa de fumaça
  const ch = fontes.find((f) => f.id === 'chamine');
  p.cil(0.15, 1.5, 'z', ch?.pos[0] ?? 2.6, 0, 2.25, preto, 10);               // chaminé
  p.caixa(1.4, W, 0.9, -L / 2 + 1.1, 0, 1.2, verde);                         // tênder / plataforma
  p.caixa(L * 0.75, W * 0.9, 0.06, -0.3, 0, H - 0.05, preto);                // toldo
  for (const sx of [-1, 1]) for (const s of [-1, 1]) p.caixa(0.06, 0.06, H - 1.7, -0.3 + sx * L * 0.33, s * (W / 2 - 0.15), 1.7 + (H - 1.7) / 2, preto);
  p.cil(0.65, 0.12, 'y', 0.2, W / 2 + 0.05, 1.9, preto, 18);                  // volante
  p.cil(0.25, 0.6, 'x', 1.5, 0, 2.1, verde, 10);                              // cilindro em cima da caldeira
  for (const s of [-1, 1]) p.roda(0.95, 0.42, -1.5, s * (W / 2 - 0.2), 0.95, rodas, preto, vermelho);   // rodas motrizes
  for (const s of [-1, 1]) p.roda(0.6, 0.26, L / 2 - 1.0, s * (W / 2 - 0.35), 0.6, rodas, preto, vermelho);
  return p.sombras();
}

/** vapor de rodas de pás: casco com a proa afilada, convés, casa de convés, chaminé alta, caixas das rodas */
export function barcoVapor(seg: Segmento, fontes: readonly FonteSonora[], rodas: Modelo['rodas']) {
  const p = new Pecas(), L = seg.comprimento, W = seg.largura, branco = 0xf0eee8, vermelho = 0x9a2a22;
  // casco (de lado: borda livre de 2 m, calado abaixo da água) e o convés
  p.placa([[L / 2, 0], [L / 2 - 8, W / 2], [-L / 2 + 2, W / 2], [-L / 2, W / 2 - 1], [-L / 2, -W / 2 + 1], [-L / 2 + 2, -W / 2], [L / 2 - 8, -W / 2]], 2.6, 0.7, 0x2b3440);
  p.placa([[L / 2 - 0.3, 0], [L / 2 - 8.2, W / 2 - 0.3], [-L / 2 + 2.2, W / 2 - 0.3], [-L / 2 + 0.3, W / 2 - 1.2], [-L / 2 + 0.3, -W / 2 + 1.2], [-L / 2 + 2.2, -W / 2 + 0.3], [L / 2 - 8.2, -W / 2 + 0.3]], 0.15, 2.05, 0x8a6a48);
  p.caixa(L * 0.55, W * 0.7, 2.4, -2, 0, 3.3, branco);                       // casa de convés
  p.caixa(L * 0.3, W * 0.55, 2.0, -4, 0, 5.5, branco);
  for (const s of [-1, 1]) p.caixa(L * 0.5, 0.04, 0.8, -2, s * (W * 0.35 + 0.01), 3.6, COR.vidro);
  const ch = fontes.find((f) => f.id === 'chamine');
  p.cil(0.6, (ch?.pos[2] ?? 10.3) - 6.5, 'z', ch?.pos[0] ?? 4, 0, 6.5 + ((ch?.pos[2] ?? 10.3) - 6.5) / 2, 0x24272b, 14);
  p.cil(0.65, 0.5, 'z', ch?.pos[0] ?? 4, 0, (ch?.pos[2] ?? 10.3) - 0.2, vermelho, 14);
  for (const s of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(0, s * (W / 2 + 0.6), 1.6); p.add(g);
    p.cil(2.6, 1.1, 'y', 0, 0, 0, vermelho, 16, g);                           // caixa da roda de pás (meia lua de fora)
    rodas.push({ o: g.children[0], r: 2.6 });
  }
  p.caixa(1.0, 0.15, 3.0, L / 2 - 4, 0, 3.5, 0x8a6a48);                       // mastro curto de proa
  return p.sombras();
}
