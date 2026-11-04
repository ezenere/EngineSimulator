// Máquina elétrica (ELETRICO.md 1.1 e 1.4): mapa de torque, corrente, índice de modulação, fluxo, escorregamento e
// regeneração; e as forças eletromagnéticas na carcaça como lista de linhas (frequências exatas de f_rot e f_e, amplitudes
// pelas leis da tabela 1.1), com a curva da carcaça da família (decisão 1.1).
//
// Amplitudes em unidades relativas (o grupo de ranhuras m = 1, k = 0 da PMSM em carga nominal ≈ 1); o nível absoluto
// vem da sonda (`kAbs`, motor.ts) na condição de referência.
import type { PresetEletrico } from './dsp';
import type { ListaLinhas } from './linhas';
import { TAU, MEC, chave, I_VAZIO, I_VAZIO_CC, F_CARC, F_CARC_LP } from './constantes';

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
const DOBRA = 2 * (W_K[1] * W_K[1] + W_K[2] * W_K[2]);

/** categorias de amplitude (uma por mecanismo; o fator é calculado uma vez por bloco) */
const C2E = 0, C6E = 1, CRAN = 2, CBAR = 3, CCC = 4, CMAG = 5, CBLDC = 6, CEXT = 7;
const LAT = 1, CENTRO = 2, SEMH = 4;

/**
 * Forças eletromagnéticas (tabela 1.1) como um gabarito montado uma vez por preset: cada linha é f = a·f_rot + b·f_e + c,
 * amplitude = fator da categoria × peso × curva da carcaça; as laterais ±2k·f_e levam o peso √w (f_e → 0: a potência
 * delas volta para o centro, `CENTRO`). Um bloco de controle só percorre os Float64Array (sem alocação nem fecho).
 */
export class ForcasMotor {
  n = 0;
  chave: Int32Array; cr: Float64Array; ce: Float64Array; c0: Float64Array; cat: Uint8Array; w: Float64Array; fl: Uint8Array;
  /** fatores por categoria do bloco */
  amp = new Float64Array(8);
  fc: number;
  constructor(p: PresetEletrico) {
    const L: [number, number, number, number, number, number, number][] = [];
    const exc = Math.pow(10, (-20 + 12 * (p.excentricidade ?? 0.2)) / 20);
    const add = (k: number, cr: number, ce: number, c0: number, cat: number, w: number, fl: number, laterais: boolean) => {
      L.push([k, cr, ce, c0, cat, w, fl]);
      if (laterais) {
        L.push([k + 0x1000, cr + 1, ce, c0, cat, w * exc, fl]); L.push([k + 0x2000, cr - 1, ce, c0, cat, w * exc, fl]);
        L.push([k + 0x3000, cr + 2, ce, c0, cat, 0.5 * w * exc, fl]); L.push([k + 0x4000, cr - 2, ce, c0, cat, 0.5 * w * exc, fl]);
      }
    };
    const grupo = (mec: number, Z: number, cat: number) => {
      for (let m = 1; m <= 3; m++) {
        add(chave(mec, m * 16 + 8), m * Z, 0, 0, cat, W_M[m - 1], CENTRO, m === 1);
        for (let k = 1; k <= 2; k++) {
          add(chave(mec, m * 16 + 8 + k), m * Z, 2 * k, 0, cat, W_M[m - 1] * W_K[k], LAT, false);
          add(chave(mec, m * 16 + 8 - k), m * Z, -2 * k, 0, cat, W_M[m - 1] * W_K[k], LAT, false);
        }
      }
    };
    if (escovado(p)) {
      // CC e universal: desbalanceamento e ranhuras da armadura em ordens de f_rot; o comutador vai nas escovas
      if (p.Zs > 0) { add(chave(MEC.ranhura, 1), p.Zs, 0, 0, CCC, 1, 0, true); add(chave(MEC.ranhura, 2), 2 * p.Zs, 0, 0, CCC, W_M[1], 0, false); }
      // o desbalanceamento sacode a ferramenta inteira (carcaça, mandril, a mão): não passa pela curva da carcaça
      const ge = Math.max(exc * 5, 0.3);
      add(chave(MEC.rot, 1), 1, 0, 0, CCC, 0.7 * ge, SEMH, false);
      add(chave(MEC.rot, 2), 2, 0, 0, CCC, 0.5 * ge, SEMH, false);
      (p.linhasExtras ?? []).forEach(([o, db], i) => add(chave(MEC.extra, i), o, 0, 0, CCC, Math.pow(10, db / 20), 0, false));
    } else {
      if (naRede(p)) {
        // magnetostrição e forças de 2·f da rede: 2f, 4f, 6f, 8f a −6 dB por harmônico, +8 dB em plena carga (como o alternador)
        const fR = p.fRede ?? 50;
        for (let h = 1; h <= 4; h++) add(chave(MEC.magnetostr, h), 0, 0, 2 * h * fR, CMAG, Math.pow(10, (-6 * (h - 1)) / 20), 0, false);
      } else if (p.maquina !== 'bldc') add(chave(MEC.f2e, 0), 0, 2, 0, C2E, 1, 0, true);
      if (p.maquina === 'bldc') {
        // BLDC com ESC de 6 passos: a comutação põe a força em ordens de f_e (padrão 6f_e 0 dB, 12f_e −8 dB; o preset mede)
        (p.ordensEletricas ?? [[6, 0], [12, -8]]).forEach(([o, db], i) => add(chave(MEC.bldc, i), 0, o, 0, CBLDC, Math.pow(10, db / 20), 0, i === 0));
      } else {
        // ondulação de torque: 6f_e, 12f_e −8, 18f_e −16
        add(chave(MEC.f6e, 6), 0, 6, 0, C6E, 1, 0, false);
        add(chave(MEC.f6e, 12), 0, 12, 0, C6E, Math.pow(10, -8 / 20), 0, false);
        add(chave(MEC.f6e, 18), 0, 18, 0, C6E, Math.pow(10, -16 / 20), 0, false);
      }
      if (p.Zs > 0) grupo(MEC.ranhura, p.Zs, CRAN);
      if (p.maquina === 'inducao' && p.Zr) grupo(MEC.barra, p.Zr, CBAR);
      // excentricidade: f_rot e 2f_rot
      add(chave(MEC.excentr, 1), 1, 0, 0, C2E, exc, 0, false);
      add(chave(MEC.excentr, 2), 2, 0, 0, C2E, 0.5 * exc, 0, false);
      (p.linhasExtras ?? []).forEach(([o, db], i) => add(chave(MEC.extra, i), o, 0, 0, CEXT, Math.pow(10, db / 20), 0, false));
    }
    const n = (this.n = L.length);
    this.chave = new Int32Array(n); this.cr = new Float64Array(n); this.ce = new Float64Array(n); this.c0 = new Float64Array(n);
    this.cat = new Uint8Array(n); this.w = new Float64Array(n); this.fl = new Uint8Array(n);
    L.forEach((x, i) => { this.chave[i] = x[0]; this.cr[i] = x[1]; this.ce[i] = x[2]; this.c0[i] = x[3]; this.cat[i] = x[4]; this.w[i] = x[5]; this.fl[i] = x[6]; });
    this.fc = F_CARC[p.carcaca];
  }

  /**
   * Fatores do bloco pelas leis de 1.1. `fase` = fase da modulação de escorregamento (2·s·f_e) da indução.
   *   2f_e ∝ Φ (6 dB/oitava acima da base), +6 dB sobre o grupo de ranhuras, quase não depende do torque;
   *   6f_e: −20 dB de 2f_e em vazio, +20·log(I/I_vazio) com a carga (até 0 dB);
   *   ranhuras ∝ Φ·√I (20·log(I/I_n)·0,5), barras da indução +3,5 dB (o grupo mais forte), ±1,5 dB em 2·s·f_e.
   */
  fatores(p: PresetEletrico, e: EstadoMaquina, fase: number) {
    const a = this.amp, phi = e.fluxo;
    if (escovado(p)) { a[CCC] = Math.sqrt(Math.max(e.I, I_VAZIO_CC)); return; }
    const Ie = Math.max(e.I, I_VAZIO), gI = Math.sqrt(Ie), A2 = 2 * phi;
    const mod = p.maquina === 'inducao' ? 1 + 0.19 * Math.sin(fase) : 1;
    a[C2E] = A2;
    a[C6E] = Math.min(A2, A2 * 0.1 * (Ie / I_VAZIO));
    a[CRAN] = (p.maquina === 'inducao' ? 0.6 : 1) * phi * gI * mod;
    a[CBAR] = 1.5 * phi * gI * mod;
    a[CMAG] = A2 * 0.4 * (1 + 1.51 * Math.max(e.I, 0));
    a[CBLDC] = 2 * gI;
    a[CEXT] = phi * gI;
  }

  /** linhas do bloco na lista; `fr`, `fe` já com o desvio da unidade */
  emitir(L: ListaLinhas, fr: number, fe: number) {
    const wl = pesoLaterais(fe), sl = Math.sqrt(wl), F = Math.sqrt(1 + (1 - wl) * DOBRA), fc = this.fc;
    const A = this.amp, K = this.chave, CR = this.cr, CE = this.ce, C0 = this.c0, CT = this.cat, W = this.w, FL = this.fl;
    for (let i = 0; i < this.n; i++) {
      const fl = FL[i];
      if (fl === LAT && sl === 0) continue;
      let f = CR[i] * fr + CE[i] * fe + C0[i];
      if (f < 0) f = -f;
      const r = f / fc, r4 = r * r * r * r, q = f * (1 / F_CARC_LP);
      let a = A[CT[i]] * W[i] * (fl === SEMH ? 1 : Math.sqrt(r4 / (1 + r4)) / Math.sqrt(1 + q * q));
      if (fl === LAT) a *= sl; else if (fl === CENTRO) a *= F;
      L.por(K[i], f, a);
    }
  }
}
