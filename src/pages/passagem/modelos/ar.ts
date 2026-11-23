// O que voa, low poly: avião de hélice (leve de asa alta ou baixa, treinador de motor radial, Corsair de asa de gaivota
// invertida, P-47, turboélice de transporte, VANT de hélice impulsora), jato de linha (2, 3 ou 4 motores), caça (uma
// ou duas derivas), Concorde, helicóptero e drone. O modelo fica ancorado nas fontes do portador: a hélice está onde
// a fonte da hélice está, as naceles nas fontes de admissão do jato, o rotor no `rotorCfg`. As medidas são as do tipo
// (o corpo do portador "hélice" tem 27 m para todos os aviões; o ATR, que tem esse tamanho, fica do tamanho dele).
import * as THREE from 'three';
import { Pecas, COR, type Modelo } from './kit';
import type { FonteSonora, Vec3 } from '../../../scene/tipos';

export type TipoHelice = 'leve-alta' | 'leve-baixa' | 'treinador' | 'corsair' | 'p47' | 'transporte-alta' | 'transporte-baixa' | 'vant';
export interface ParamsHelice { tipo: TipoHelice; L: number; env: number; cor: number; cor2: number; pas: number; rH: number; trem: boolean; tEm?: boolean }

/** hélice de n pás com o eixo no x do corpo, registrada para girar */
function helice(p: Pecas, n: number, r: number, x: number, y: number, z: number, giros: Modelo['giros'], cor: number = COR.preto, k = 0.03, empurra = false) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = empurra ? -Math.PI / 2 : Math.PI / 2; p.add(g);
  const pas = p.pas(n, r, Math.max(0.12, r * 0.14), cor, Math.max(0.1, r * 0.12), g);
  giros.push({ o: pas, k, fonte: 'helice' });
}

/** asa (ou empenagem) reta de envergadura e, corda c, enflechamento s (m de recuo na ponta), centrada em x na altura z */
function asa(p: Pecas, e: number, c: number, x: number, z: number, cor: number, s = 0, afina = 0.6, esp = 0.12, y0 = 0) {
  const ct = c * afina;
  p.placa([[x + c / 2, y0], [x + c / 2 - s, y0 + e / 2], [x + c / 2 - s - ct, y0 + e / 2], [x - c / 2, y0], [x + c / 2 - s - ct, y0 - e / 2], [x + c / 2 - s, y0 - e / 2]], esp, z, cor);
}

/** avião de hélice ancorado nas hélices (as fontes `pa` do portador) */
export function aviaoHelice(par: ParamsHelice, helices: readonly FonteSonora[], giros: Modelo['giros'], rodas: Modelo['rodas']) {
  const p = new Pecas(), { L, env, cor, cor2 } = par;
  const transporte = par.tipo === 'transporte-alta' || par.tipo === 'transporte-baixa';
  const h0: Vec3 = helices[0]?.pos ?? [3.3, 0, 1.5];
  if (par.tipo === 'vant') {
    // RQ-7 Shadow: casulo à frente da hélice impulsora, asa alta, duas vigas até a cauda em V invertido
    const xh = h0[0], z = h0[2];
    p.torno([[xh + 0.1, 0.12], [xh + 0.6, 0.3], [xh + 1.6, 0.32], [xh + 2.3, 0.18], [xh + 2.5, 0.04]], cor, 10, 0, z);
    asa(p, env, 0.65, xh + 1.2, z + 0.32, cor, 0, 0.9, 0.08);
    for (const s of [-1, 1]) { p.caixa(2.6, 0.08, 0.08, xh - 0.2, s * 0.9, z + 0.3, cor); const v = p.caixa(0.5, 0.05, 0.6, xh - 1.4, s * 0.62, z + 0.1, cor); v.rotation.x = -s * 0.75; }
    helice(p, 2, par.rH, xh - 0.05, 0, z, giros, COR.preto, 0.03, true);
    return p;
  }
  if (transporte) {
    // turboélice de transporte (ATR, Q400, C-130, DC-3): fuselagem do tamanho do tipo, naceles nas hélices
    const zP = h0[2], alta = par.tipo === 'transporte-alta', rf = Math.max(1.0, L * 0.05), zf = alta ? zP - rf * 0.75 : zP + rf * 0.4;
    const xn = Math.max(...helices.map((h) => h.pos[0]), h0[0]) + L * 0.33;   // nariz à frente das hélices
    p.torno([[xn - L, 0.25], [xn - L + 0.18 * L, rf * 0.85], [xn - L * 0.75, rf], [xn - 2.5, rf], [xn - 0.8, rf * 0.7], [xn, 0.15]], cor, 14, 0, zf);
    p.caixa(1.2, rf * 1.3, 0.5, xn - 1.4, 0, zf + rf * 0.55, COR.vidro).rotation.y = 0.25;   // cabine de comando
    const xa = (helices.length ? helices[0].pos[0] : h0[0]) - 1.6;
    asa(p, env, L * 0.09, xa, alta ? zf + rf * 0.95 : zf - rf * 0.6, cor2, 0.4, 0.55, 0.3);
    for (const h of helices.length ? helices : [{ pos: h0 } as FonteSonora]) {
      const [x, y] = h.pos;
      p.cil(0.6, 4.2, 'x', x - 2.1, y, zP - 0.1, cor, 10, undefined, 0.45);
      helice(p, par.pas, par.rH, x + 0.05, y, zP, giros, COR.grafite, 0.025);
    }
    // deriva e estabilizador (em T no ATR e no Q400)
    const xt = xn - L + 1.3, zt = par.tEm ? zf + rf + L * 0.17 : zf + rf * 0.6;
    p.perfil([[xt + 2.5, zf + rf * 0.7], [xt + 0.8, zf + rf + L * 0.18], [xt - 0.4, zf + rf + L * 0.18], [xt - 0.6, zf + rf * 0.7]], 0.25, cor);
    asa(p, env * 0.32, 2.2, xt + 0.2, zt, cor, 0.5, 0.6, 0.15);
    p.caixa(L * 0.75, 0.04, 0.4, xn - L * 0.45, rf + 0.004, zf + rf * 0.25, cor2);   // janelas (faixa) da cabine de passageiros: um lado
    p.caixa(L * 0.75, 0.04, 0.4, xn - L * 0.45, -rf - 0.004, zf + rf * 0.25, cor2);
    return p;
  }
  // monomotor: a hélice no nariz, a fuselagem para trás dela
  const [xh, , zh] = h0, rf = par.tipo === 'p47' ? 0.78 : par.tipo === 'corsair' || par.tipo === 'treinador' ? 0.66 : 0.6;
  const radial = par.tipo === 'treinador' || par.tipo === 'corsair' || par.tipo === 'p47';
  p.torno([[xh - L, 0.08], [xh - L + 0.4 * L, rf * 0.75], [xh - 0.55 * L, rf], [xh - 0.15 * L, rf], [xh - 0.25, radial ? rf * 1.05 : rf * 0.6], [xh - 0.05, radial ? rf * 0.7 : 0.2]], cor, 12, 0, zh);
  if (radial) p.cil(rf * 1.08, 0.9, 'x', xh - 0.6, 0, zh, cor2, 14);    // capô do motor radial
  const xa = xh - L * 0.3, cA = L * (par.tipo === 'corsair' ? 0.2 : 0.17);
  if (par.tipo === 'leve-alta') {
    asa(p, env, cA, xa - 0.3, zh + rf + 0.1, cor, 0, 0.95, 0.12);
    for (const s of [-1, 1]) { const m = p.caixa(0.06, 1.9, 0.06, xa - 0.2, s * 1.0, zh + 0.1, COR.cinza); m.rotation.x = -s * 0.55; }
    p.caixa(1.3, rf * 1.6, 0.5, xh - 1.7, 0, zh + rf * 0.6, COR.vidro);
  } else if (par.tipo === 'corsair') {
    // asa de gaivota invertida: o trecho de dentro desce, o de fora sobe
    for (const s of [-1, 1]) {
      const g = new THREE.Group(); g.position.set(xa, s * 0.3, zh - rf * 0.2); g.rotation.x = s * 0.38; p.add(g);
      p.caixa(cA, 1.8, 0.2, 0, s * 0.9, 0, cor, g);
      const g2 = new THREE.Group(); g2.position.set(xa, s * 1.95, zh - rf * 0.85); g2.rotation.x = -s * 0.14; p.add(g2);
      p.placa([[cA / 2, 0], [cA / 2 - 0.3, s * (env / 2 - 2.0)], [-cA / 2 + 0.6, s * (env / 2 - 2.0)], [-cA / 2, 0]], 0.18, 0, cor, g2);
    }
    p.torno([[xh - 0.45 * L, 0.05], [xh - 0.4 * L, 0.4], [xh - 0.3 * L, 0.42], [xh - 0.22 * L, 0.05]], COR.vidro, 10, 0, zh + rf * 0.75);
  } else {
    asa(p, env, cA, xa, zh - rf * 0.55, par.tipo === 'p47' ? cor : cor, 0.2, par.tipo === 'p47' ? 0.75 : 0.55, 0.16);
    const lc = par.tipo === 'treinador' ? 2.2 : 1.4;
    p.torno([[xa - lc / 2, 0.05], [xa - lc / 2 + 0.3, 0.42], [xa + lc / 2 - 0.3, 0.44], [xa + lc / 2, 0.05]], COR.vidro, 10, 0, zh + rf * 0.75);
  }
  // cauda: estabilizador e deriva
  const xt = xh - L + 0.7;
  asa(p, env * 0.34, 1.2, xt + 0.2, zh + 0.1, cor, 0.2, 0.6, 0.1);
  p.perfil([[xt + 1.3, zh + rf * 0.5], [xt + 0.2, zh + rf + 1.1], [xt - 0.4, zh + rf + 1.1], [xt - 0.65, zh + rf * 0.2]], 0.12, cor);
  p.caixa(L * 0.6, rf * 2 + 0.04, 0.16, xh - L * 0.5, 0, zh - 0.05, cor2);   // faixa (atravessa a fuselagem: aparece dos dois lados)
  if (par.trem) {
    for (const s of [-1, 1]) { p.roda(0.24, 0.12, xa - 0.4, s * 1.1, zh - rf - 0.75, rodas); p.caixa(0.08, 0.08, 0.7, xa - 0.4, s * 0.9, zh - rf - 0.35, COR.cinza).rotation.x = s * 0.3; }
    p.roda(0.2, 0.1, xh - 0.8, 0, zh - rf - 0.78, rodas);
  }
  helice(p, par.pas, par.rH, xh + 0.02, 0, zh, giros);
  return p;
}

export interface ParamsJato { tipo: 'linha' | 'linha-cauda' | 'caca' | 'concorde'; L: number; env: number; motores: number; derivas: 1 | 2; cor: number; cor2: number }

/** jato de linha, caça ou Concorde, ancorado nas fontes de admissão (naceles) do portador */
export function jato(par: ParamsJato, fontes: readonly FonteSonora[], zc: number) {
  const p = new Pecas(), { L, env, cor, cor2 } = par;
  const adm = fontes.filter((f) => f.id.startsWith('admissao'));
  if (par.tipo === 'caca' || par.tipo === 'concorde') {
    const rf = par.tipo === 'concorde' ? 1.45 : 0.62;
    p.torno([[-L / 2, rf * 0.75], [-L / 2 + 0.2 * L, rf], [L * 0.1, rf], [L * 0.38, rf * 0.55], [L / 2, 0.03]], cor, 12, 0, zc);
    p.cil(rf * 0.62, 1.2, 'x', -L / 2 - 0.3, 0, zc, COR.grafite, 12, undefined, rf * 0.7);   // bocal
    if (par.tipo === 'concorde') {
      p.placa([[L * 0.25, 0], [-L * 0.42, env / 2], [-L * 0.48, env / 2], [-L * 0.44, 0], [-L * 0.48, -env / 2], [-L * 0.42, -env / 2]], 0.25, zc - rf * 0.6, cor);
      for (const s of [-1, 1]) p.caixa(9, 2.2, 1.2, -L * 0.3, s * 3.2, zc - rf - 0.4, COR.claro);
      p.perfil([[-L * 0.3, zc + rf * 0.6], [-L * 0.44, zc + rf + 7.5], [-L * 0.5, zc + rf + 7.5], [-L * 0.5, zc + rf * 0.6]], 0.3, cor);
      p.caixa(3, 1.4, 0.4, L * 0.38, 0, zc + rf * 0.5, COR.vidro);
    } else {
      p.placa([[L * 0.15, 0], [-L * 0.2, env / 2], [-L * 0.3, env / 2], [-L * 0.3, 0], [-L * 0.3, -env / 2], [-L * 0.2, -env / 2]], 0.15, zc - 0.1, cor);
      asa(p, env * 0.6, 2.0, -L / 2 + 1.6, zc, cor, 0.9, 0.4, 0.1);
      for (const k of par.derivas === 2 ? [-1, 1] : [0]) {
        const g = new THREE.Group(); g.position.set(0, k * 1.1, 0); g.rotation.x = k * 0.3; p.add(g);
        p.perfil([[-L / 2 + 3.2, zc + rf * 0.6], [-L / 2 + 1.0, zc + rf + 2.9], [-L / 2 + 0.1, zc + rf + 2.9], [-L / 2 + 0.2, zc + rf * 0.6]], 0.12, cor, 0, g);
      }
      p.torno([[L * 0.12, 0.05], [L * 0.17, 0.42], [L * 0.27, 0.42], [L * 0.33, 0.05]], COR.vidro, 10, 0, zc + rf * 0.7);   // bolha da cabine
      p.caixa(3.0, 1.0, 0.8, L * 0.05, 0, zc - rf * 0.8, COR.grafite);   // entrada de ar ventral
    }
    return p;
  }
  // jato de linha: fuselagem do corpo, asa baixa enflechada, naceles, deriva e estabilizadores enflechados
  const rf = Math.min(3.2, Math.max(1.8, L * 0.05));
  p.torno([[-L / 2, 0.3], [-L / 2 + 0.16 * L, rf * 0.85], [-L * 0.3, rf], [L * 0.38, rf], [L * 0.47, rf * 0.6], [L / 2, 0.1]], cor, 16, 0, zc);
  p.caixa(1.4, rf * 1.1, 0.5, L * 0.45, 0, zc + rf * 0.45, COR.vidro).rotation.y = 0.3;
  for (const s of [-1, 1]) p.caixa(L * 0.72, 0.04, 0.32, -L * 0.02, s * (rf + 0.002), zc + rf * 0.32, COR.vidro);   // janelas
  asa(p, env, L * 0.2, -L * 0.04, zc - rf * 0.55, COR.claro, L * 0.18, 0.3, 0.35);
  const ys = adm.length ? [...new Set(adm.map((a) => Math.abs(a.pos[1])))] : [env * 0.16];
  const xEng = (adm[0]?.pos[0] ?? L * 0.05) - 2.0;
  const motores = par.tipo === 'linha-cauda' ? [] : par.motores >= 4 ? [ys[0], ys[0] * 1.85] : [ys[0]];
  for (const y of motores) for (const s of [-1, 1]) p.cil(rf * 0.42, 4.2, 'x', xEng - (y > ys[0] ? 1.5 : 0) , s * y, zc - rf * 0.75, cor2, 12, undefined, rf * 0.36);
  if (par.tipo === 'linha-cauda') for (const y of [-1.8, 0, 1.8]) p.cil(0.75, 4.0, 'x', -L / 2 + 4.5, y, zc + rf * (y === 0 ? 1.1 : 0.5), cor2, 10);
  const xt = -L / 2 + 2.5;
  p.perfil([[xt + 6.0, zc + rf * 0.8], [xt + 1.6, zc + rf + L * 0.22], [xt - 0.6, zc + rf + L * 0.22], [xt - 1.4, zc + rf * 0.6]], 0.35, cor2);
  asa(p, env * 0.36, 4.0, xt + 0.8, par.tipo === 'linha' ? zc + rf * 0.15 : zc + rf + L * 0.2, COR.claro, 2.6, 0.4, 0.2);
  return p;
}

/** helicóptero: cabine em gota, cauda afilada com a deriva, esquis, rotor principal e de cauda que giram */
export function helicoptero(rc: { R: number; Rc: number; B: number; posRotor: Vec3; posCauda: Vec3 }, cor: number, cor2: number, bolha: boolean, giros: Modelo['giros']) {
  const p = new Pecas();
  const xm = rc.posRotor[0], zm = rc.posRotor[2], xc = rc.posCauda[0], zc = rc.posCauda[2];
  const zCab = Math.max(1.1, zm - 1.75), L = Math.max(2.6, rc.R * 0.55);
  if (bolha) p.torno([[xm - 0.8, 0.2], [xm - 0.5, 0.8], [xm + 0.6, 0.9], [xm + 1.4, 0.6], [xm + 1.7, 0.1]], COR.vidro, 14, 0, zCab, undefined, 1.15);
  else {
    p.torno([[xm - 1.2, 0.35], [xm - 0.7, 0.75], [xm + 0.5, 0.82], [xm + L * 0.55, 0.7], [xm + L * 0.75, 0.35], [xm + L * 0.82, 0.08]], cor, 14, 0, zCab, undefined, 1.25);
    p.torno([[xm + L * 0.3, 0.6], [xm + L * 0.55, 0.74], [xm + L * 0.76, 0.38], [xm + L * 0.83, 0.05]], COR.vidro, 14, 0, zCab + 0.12, undefined, 1.25);
    p.caixa(L * 0.5, 1.4, 0.12, xm, 0, zCab - 0.15, cor2);   // faixa
  }
  p.torno([[xc - 0.2, 0.08], [xc + 1.0, 0.14], [xm - 1.0, 0.3]], bolha ? COR.amarelo : cor, 8, 0, (zCab + zc) / 2 + 0.1);   // cauda
  p.perfil([[xc + 0.6, zc - 0.2], [xc + 0.15, zc + 0.6], [xc - 0.25, zc + 0.6], [xc - 0.2, zc - 0.5]], 0.08, cor2);
  p.cil(0.08, zm - zCab - 0.4, 'z', xm, 0, (zm + zCab) / 2 + 0.2, COR.grafite, 8);   // mastro
  p.caixa(1.0, 0.7, 0.4, xm - 0.4, 0, zCab + 0.85, cor);   // capô da transmissão
  for (const s of [-1, 1]) {
    p.caixa(Math.max(2.8, L * 1.05), 0.08, 0.08, xm + 0.3, s * 0.95, 0.06, COR.grafite);
    for (const x of [xm - 0.5, xm + 1.0]) p.caixa(0.08, 0.08, zCab - 0.55, x, s * 0.8, zCab / 2 - 0.2, COR.grafite).rotation.x = -s * 0.25;
  }
  const rp = new THREE.Group(); rp.position.set(xm, 0, zm + 0.05); p.add(rp);
  giros.push({ o: p.pas(rc.B, rc.R, Math.max(0.18, rc.R * 0.05), COR.grafite, 0.18, rp), k: 0.08, fonte: 'rotor' });
  const rcg = new THREE.Group(); rcg.position.set(xc, 0.25, zc); rcg.rotation.x = -Math.PI / 2; p.add(rcg);
  giros.push({ o: p.pas(2, rc.Rc, Math.max(0.06, rc.Rc * 0.12), COR.grafite, 0.06, rcg), k: 0.05, fonte: 'cauda' });
  return p;
}

/** drone de quatro hélices (Mavic): corpo, braços até os motores, hélices nas fontes `pa`, pernas */
export function drone(fontes: readonly FonteSonora[], giros: Modelo['giros']) {
  const p = new Pecas(), cinza = 0x6b7077;
  p.caixa(0.2, 0.09, 0.07, 0, 0, 0.04, cinza);
  p.caixa(0.05, 0.05, 0.04, 0.11, 0, 0.03, COR.preto);
  for (const f of fontes.filter((x) => x.tipo === 'pa')) {
    const [x, y, z] = f.pos, l = Math.hypot(x, y);
    const b = p.caixa(l, 0.02, 0.015, x / 2, y / 2, 0.04, cinza); b.rotation.z = Math.atan2(y, x);
    p.cil(0.018, 0.03, 'z', x, y, z - 0.01, COR.preto, 8);
    const g = new THREE.Group(); g.position.set(x, y, z + 0.01); p.add(g);
    giros.push({ o: p.pas(2, 0.12, 0.022, COR.claro, 0.01, g), k: 0.02, fonte: 'drone' });
    p.caixa(0.015, 0.015, 0.05, x * 0.7, y * 0.7, 0.0, cinza);
  }
  return p;
}
