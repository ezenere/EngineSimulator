// Máquina elétrica (ELETRICO.md 1.1 e 1.4): mapa de torque, corrente, índice de modulação, fluxo, escorregamento e
// regeneração; e as forças eletromagnéticas na carcaça como lista de linhas (frequências exatas de f_rot e f_e, amplitudes
// pelas leis da tabela 1.1), com a curva da carcaça da família (decisão 1.1).
//
// Amplitudes em unidades relativas (o grupo de ranhuras m = 1, k = 0 da PMSM em carga nominal ≈ 1); o nível absoluto
// vem da sonda (`kAbs`, motor.ts) na condição de referência.
import type { PresetEletrico } from './dsp';
import type { ListaLinhas } from './linhas';
import { TAU, MEC, chave, hCarcaca, I_VAZIO, I_VAZIO_CC, F_CARC } from './constantes';

/** estado elétrico e mecânico da máquina, recalculado a cada bloco de controle */
export class EstadoMaquina {
  omega = 0;        // rad/s do rotor
  frot = 0;         // Hz
  fe = 0;           // Hz elétrica (com escorregamento na indução)
  fslip = 0;        // Hz
  T = 0;            // N·m entregue (negativo = regeneração)
  Tmax = 0;         // N·m disponível nesta rotação
  I = 0;            // I/I_n
  M = 0;            // índice de modulação (0..1)
  fluxo = 1;        // Φ/Φ_n
  P = 0;            // W
  D = 0;            // ciclo de trabalho do chopper (CC)
}

/** máquinas de escova com controle por tensão (bancada): curva linear T = T_st·(a − ω/ω₀) */
export const escovado = (p: PresetEletrico) => p.maquina === 'universal' || p.maquina === 'cc-serie';
export const linearTensao = (p: PresetEletrico) => !!p.curvaLinear;
/** indução ligada direto na rede (sem inversor) */
export const naRede = (p: PresetEletrico) => p.inversor === null && p.maquina === 'inducao';

const wBase = (p: PresetEletrico) => (p.rpmBase * TAU) / 60;
const wMax = (p: PresetEletrico) => (p.rpmMax * TAU) / 60;

/**
 * Torque disponível (1.4, decisão): T_n até a quina de potência, P_max/ω acima, e zero no limite de tensão ω_max
 * (rampa de 3%). Curva linear (ferramentas): T_st·(a − ω/ω₀) com T_st = T_n/(1 − ω_base/ω₀); rede: a reta do
 * escorregamento perto da síncrona, limitada a 2,5·T_n (conjugado máximo).
 */
export function torqueDisponivel(p: PresetEletrico, w: number, a: number) {
  const wa = Math.abs(w);
  if (naRede(p)) {
    const ws = (TAU * (p.fRede ?? 50)) / p.p, s = (ws - w) / ws, sn = p.escorregamentoNominal ?? 0.03;
    return a > 0 ? Math.max(-2.5 * p.Tn, Math.min(2.5 * p.Tn, (p.Tn * s) / sn)) : 0;
  }
  if (linearTensao(p)) {
    const w0 = wMax(p), tst = p.Tn / (1 - wBase(p) / w0);
    return Math.max(0, tst * (a - wa / w0));
  }
  const wm = wMax(p);
  let t = Math.min(p.Tn, p.Pmax / Math.max(wa, 1e-6));
  if (wa > wm) t *= Math.max(0, 1 - (wa - wm) / (0.03 * wm));
  return t;
}

/**
 * Atualiza o estado elétrico a partir de ω e do torque entregue (fora daqui, em dsp.ts, fica a integração do eixo).
 * Corrente: |T|/T_n até a quina de potência (P_max/T_n), |P|/P_max acima (enfraquecimento de campo: I_d ocupa o que
 * I_q libera, a corrente total fica perto da nominal em plena potência; contínua na quina).
 */
export function estadoEletrico(p: PresetEletrico, e: EstadoMaquina, w: number, T: number) {
  const wa = Math.abs(w), wb = wBase(p);
  e.omega = w; e.T = T;
  e.frot = wa / TAU;
  const wq = p.Pmax / p.Tn;
  e.I = wa <= wq ? Math.abs(T) / p.Tn : (Math.abs(T) * wa) / p.Pmax;
  e.M = Math.min(1, wa / wb);
  e.fluxo = Math.min(1, wb / Math.max(wa, 1e-6));
  e.P = T * w;
  e.D = e.M;
  if (p.maquina === 'inducao') {
    if (naRede(p)) { e.fe = p.fRede ?? 50; e.fslip = e.fe - p.p * e.frot; e.M = 1; e.fluxo = 1; }
    else {
      const feN = (p.p * p.rpmBase) / 60, sn = p.escorregamentoNominal ?? 0.02;
      e.fslip = sn * feN * (T / p.Tn) * (w < 0 ? -1 : 1);
      e.fe = p.p * e.frot + e.fslip;
    }
  } else { e.fslip = 0; e.fe = p.p * e.frot; }
  if (linearTensao(p)) { e.I = Math.abs(T) / p.Tn; e.fluxo = 1; }
}

/** peso das bandas laterais ±2k·f_e quando elas encostam na linha central (f_e → 0): a potência volta para o centro */
export function pesoLaterais(fe: number) { const x = (2 * Math.abs(fe) - 1.5) / 1.5; return x <= 0 ? 0 : x >= 1 ? 1 : x; }

const W_M = [1, Math.pow(10, -10 / 20), Math.pow(10, -18 / 20)];        // m = 1, 2, 3
const W_K = [1, 0.5, Math.pow(10, -14 / 20)];                            // k = 0, ±1, ±2

/**
 * Forças eletromagnéticas (tabela 1.1) na lista `L`. `fase` é a fase da modulação de escorregamento (2·s·f_e) da
 * indução, `det` o desvio de rotação da unidade (o mesmo motor numa roda de outro diâmetro).
 */
export function linhasMotor(p: PresetEletrico, e: EstadoMaquina, L: ListaLinhas, fase: number, det = 1) {
  const fc = F_CARC[p.carcaca];
  const fr = e.frot * det, fe = e.fe * det, phi = e.fluxo;
  const H = (f: number) => hCarcaca(Math.abs(f), fc);
  const wl = pesoLaterais(fe), sl = Math.sqrt(wl), cl = 1 - wl;
  const exc = Math.pow(10, (-20 + 12 * (p.excentricidade ?? 0.2)) / 20);
  const add = (k: number, f: number, a: number, laterais: boolean) => {
    L.por(k, f, a * H(f));
    if (laterais && fr > 0) {
      L.por(k + 0x1000, f + fr, a * exc * H(f + fr)); L.por(k + 0x2000, f - fr, a * exc * H(f - fr));
      L.por(k + 0x3000, f + 2 * fr, 0.5 * a * exc * H(f + 2 * fr)); L.por(k + 0x4000, f - 2 * fr, 0.5 * a * exc * H(f - 2 * fr));
    }
  };
  /** grupo de ranhuras/barras: m·Z·f_rot ± 2k·f_e, com a potência das laterais voltando ao centro quando f_e → 0 */
  const grupo = (mec: number, Z: number, G: number) => {
    for (let m = 1; m <= 3; m++) {
      const f0 = m * Z * fr, am = G * W_M[m - 1];
      let a0 = am;
      if (cl > 0) a0 = Math.sqrt(am * am + cl * 2 * am * am * (W_K[1] * W_K[1] + W_K[2] * W_K[2]));
      add(chave(mec, m * 16 + 8), f0, a0, m === 1);
      if (sl > 0) for (let k = 1; k <= 2; k++) {
        const ak = am * W_K[k] * sl;
        add(chave(mec, m * 16 + 8 + k), f0 + 2 * k * fe, ak, false);
        add(chave(mec, m * 16 + 8 - k), f0 - 2 * k * fe, ak, false);
      }
    }
  };
  if (escovado(p)) {
    // CC e universal: desbalanceamento e ranhuras da armadura em ordens de f_rot; o comutador vai nas escovas
    const Ie = Math.max(e.I, I_VAZIO_CC), g = Math.sqrt(Ie);
    if (p.Zs > 0) { add(chave(MEC.ranhura, 1), p.Zs * fr, g, true); add(chave(MEC.ranhura, 2), 2 * p.Zs * fr, g * W_M[1], false); }
    add(chave(MEC.rot, 1), fr, 0.7 * g * Math.max(exc * 5, 0.3), false);
    add(chave(MEC.rot, 2), 2 * fr, 0.5 * g * Math.max(exc * 5, 0.3), false);
    if (p.linhasExtras) for (let i = 0; i < p.linhasExtras.length; i++) { const [o, db] = p.linhasExtras[i]; add(chave(MEC.extra, i), o * fr, g * Math.pow(10, db / 20), false); }
    return;
  }
  const Ie = Math.max(e.I, I_VAZIO);
  const gI = Math.sqrt(Ie);
  // fundamental (onda de 2p polos): 2·f_e, ∝ Φ (6 dB/oitava acima da base), +6 dB sobre o grupo de ranhuras
  const A2 = 2 * phi;
  if (naRede(p)) {
    // magnetostrição e forças de 2·f da rede: 2f, 4f, 6f, 8f a −6 dB por harmônico, +8 dB em plena carga (como o alternador)
    const fRede = p.fRede ?? 50;
    for (let h = 1; h <= 4; h++) add(chave(MEC.magnetostr, h), 2 * h * fRede, A2 * 0.4 * (1 + 1.51 * Math.max(e.I, 0)) * Math.pow(10, (-6 * (h - 1)) / 20), false);
  } else if (p.maquina !== 'bldc') add(chave(MEC.f2e, 0), 2 * fe, A2, true);
  if (p.maquina === 'bldc') {
    // BLDC com ESC de 6 passos: a comutação põe a força em ordens de f_e (padrão 6f_e 0 dB, 12f_e −8 dB; o preset mede)
    const ords = p.ordensEletricas ?? [[6, 0], [12, -8]];
    for (let i = 0; i < ords.length; i++) add(chave(MEC.bldc, i), ords[i][0] * fe, 2 * gI * Math.pow(10, ords[i][1] / 20), i === 0);
  } else {
    // ondulação de torque: 6f_e −20 dB de 2f_e em vazio, +20·log(I/I_vazio) com a carga (até 0 dB), 12f_e −8, 18f_e −16
    const A6 = Math.min(A2, A2 * 0.1 * (Ie / I_VAZIO));
    add(chave(MEC.f6e, 6), 6 * fe, A6, false);
    add(chave(MEC.f6e, 12), 12 * fe, A6 * Math.pow(10, -8 / 20), false);
    add(chave(MEC.f6e, 18), 18 * fe, A6 * Math.pow(10, -16 / 20), false);
  }
  // escorregamento: o grupo de ranhuras/barras da indução oscila ±1,5 dB em 2·s·f_e
  const mod = p.maquina === 'inducao' ? 1 + 0.19 * Math.sin(fase) : 1;
  const ind = p.maquina === 'inducao';
  if (p.Zs > 0) grupo(MEC.ranhura, p.Zs, (ind ? 0.6 : 1) * phi * gI * mod);
  if (ind && p.Zr) grupo(MEC.barra, p.Zr, 1.5 * phi * gI * mod);
  // excentricidade: f_rot e 2f_rot
  add(chave(MEC.excentr, 1), fr, A2 * exc, false);
  add(chave(MEC.excentr, 2), 2 * fr, 0.5 * A2 * exc, false);
  if (p.linhasExtras) for (let i = 0; i < p.linhasExtras.length; i++) { const [o, db] = p.linhasExtras[i]; add(chave(MEC.extra, i), o * fr, phi * gI * Math.pow(10, db / 20), false); }
}
