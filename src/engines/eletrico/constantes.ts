// Constantes do Elétrico (docs/ELETRICO.md). Unidades do CENA: m, s, rad/s, N·m, Pa; 48 kHz, controle a cada 64 amostras.
import type { Diretividade } from '../../scene/tipos';

export const TAU = Math.PI * 2;
/** amostras entre recálculos das listas de linhas (decisão 1: a cada 64) */
export const BLOCO = 64;
/** s, rampa de entrada e saída de uma linha (e da troca de modo do inversor: crossfade de potência constante) */
export const RAMPA_LINHA = 0.02;
/** nenhuma linha acima de 0,45·fs (7.1: filtro na lista, não no sinal) */
export const F_MAX_REL = 0.45;
/** entre 18 kHz e 0,45·fs a linha entra com rampa de até −12 dB (7.1); a 48 kHz, 18/48 */
export const F_RAMPA_REL = 0.375;
export const RAMPA_TOPO_DB = -12;
/** linhas mais fracas que isto (dB da maior do banco) não entram */
export const PISO_LINHA_DB = -60;
/** abaixo disto uma linha não entra (infrassom: f_e ≈ 0 no arranque); entre F_MIN e 2·F_MIN entra em rampa */
export const F_MIN = 10;

/** L_max por fonte (4.1) */
export const LMAX = { motor: 96, inversor: 64, reducao: 32, escovas: 8, helice: 16, aux: 12, ventilador: 8, avas: 6 } as const;

/** curva da carcaça (1.1, decisão): passa-alta de 2 polos em f_carc + platô + passa-baixa de 1 polo em 8 kHz */
export const F_CARC = { carro: 400, trem: 250, pequena: 1000 } as const;
export const F_CARC_LP = 8000;
export function hCarcaca(f: number, fCarc: number) {
  const r = f / fCarc, r4 = r * r * r * r, q = f / F_CARC_LP;
  return Math.sqrt(r4 / (1 + r4)) / Math.sqrt(1 + q * q);
}

/** convenção dos motores novos: canal em Pa a 7,5 m (4.2) */
export const REF_DIST_ELETRICO = 7.5;

/** corrente equivalente em vazio (fração de I_n): ranhuras e inversor não somem com torque zero (ímã, magnetização) (≈) */
export const I_VAZIO = 0.1;
/** motores de escova (CC, universal) em vazio: atrito e ventilação puxam 30% da corrente nominal (≈) */
export const I_VAZIO_CC = 0.3;

/** diretividades (1.5 e 2) */
export const DIR_MOTOR: Diretividade['tabela'] = [0, 0, -1, -3, -5, -7, -8];
export const DIR_AVAS: Diretividade['tabela'] = [0, -1, -3, -6, -9, -12, -14];
export const DIR_HELICE: Diretividade['tabela'] = [-6, -2, 0, 0, -2, -6, -10];
export const OMNI: Diretividade['tabela'] = [0, 0, 0, 0, 0, 0, 0];

/**
 * Taurus ES64U2 (3.1): escala de dó maior de G3 a D5 (temperamento igual, A4 = 440 Hz) e o patamar medido.
 * Degrau k (0..11) vale para f_e ∈ [f₀ + kΔ, f₀ + (k + 1)Δ); acima, o patamar até a troca para síncrona.
 */
export const NOTAS_TAURUS = [196.0, 220.0, 246.94, 261.63, 293.66, 329.63, 349.23, 392.0, 440.0, 493.88, 523.25, 587.33];
export const NOMES_NOTAS = ['G3', 'A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5'];
export const PATAMAR_TAURUS = 598;
export const ESCADA_F0 = 0.25, ESCADA_DELTA = 0.4;

/** códigos de mecanismo (chave das linhas: mecanismo << 16 | índice); os nomes vão para a telemetria e o espectro anotado */
export const MEC = {
  f2e: 1, f6e: 2, ranhura: 3, barra: 4, excentr: 5, rot: 6, magnetostr: 7, extra: 8, bldc: 9,
  portadora: 11, chopper: 12, csi: 13, bloco: 14, aux: 15,
  engren: 16, ventilador: 17, escova: 18, helice: 19, avas: 20,
} as const;
export const NOME_MEC: Record<number, string> = {
  1: '2f_e', 2: '6f_e', 3: 'Z_s·f_rot', 4: 'Z_r·f_rot', 5: 'excentr.', 6: 'f_rot', 7: '2f_rede', 8: 'ordem', 9: 'k·f_e',
  11: 'f_c', 12: 'f_ch', 13: '6f_e', 14: 'N = 1', 15: 'aux',
  16: 'engren.', 17: 'BPF vent.', 18: 'Z_c·f_rot', 19: 'BPF', 20: 'AVAS',
};
export const chave = (mec: number, i: number) => (mec << 16) | (i & 0xffff);
