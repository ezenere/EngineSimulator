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

/**
 * Relevo da carcaça: a carcaça e a estrutura têm modos, e a resposta de verdade não é a curva lisa de 1.1: sobe e desce
 * alguns dB a cada fração de oitava. Um relevo fixo por máquina (semente da unidade), em dB sobre o log da frequência:
 * soma de 10 cossenos de 3 a 12 ciclos por oitava (picos e vales de 1/12 a 1/3 de oitava de largura), com desvio-padrão
 * `prof` dB (padrão 2: picos e vales de ±4 a ±5 dB). É o que dá vida às linhas sem ruído: uma ordem que varre na aceleração acende e apaga ao cruzar os modos, e
 * com a rotação passeando cada linha ganha a sua própria respiração (as linhas deixam de subir e descer todas juntas).
 * Tabela de 1024 pontos de 20 Hz a 24 kHz, montada uma vez; `ganho(f)` só interpola (sem alocação).
 */
export class Relevo {
  private t = new Float64Array(N_RELEVO + 2);
  readonly prof: number;
  constructor(semente: number, prof: number) {
    this.prof = prof;
    if (!(prof > 0)) { this.t.fill(1); return; }
    // (gerador próprio, sem estado fora daqui: um xorshift de 32 bits)
    let s = (semente >>> 0) || 0x9e3779b9;
    const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s * 2.3283064365386963e-10; };
    const K = 10, cp = new Float64Array(K), fa = new Float64Array(K);
    for (let k = 0; k < K; k++) { cp[k] = 3 * Math.pow(4, rnd()); fa[k] = TAU * rnd(); }
    const g = (prof * Math.SQRT2) / Math.sqrt(K);
    for (let i = 0; i < N_RELEVO + 2; i++) {
      const x = (i / N_RELEVO) * OITAVAS_RELEVO;
      let d = 0;
      for (let k = 0; k < K; k++) d += Math.cos(TAU * cp[k] * x + fa[k]);
      this.t[i] = Math.pow(10, (g * d) / 20);
    }
  }
  /** fator linear do relevo em f (Hz) */
  ganho(f: number) {
    if (this.prof <= 0) return 1;
    const u = Math.log2(f < 20 ? 1 : f * 0.05) * (N_RELEVO / OITAVAS_RELEVO), t = this.t;
    if (u >= N_RELEVO) return t[N_RELEVO];
    const i = u | 0, fr = u - i;
    return t[i] + (t[i + 1] - t[i]) * fr;
  }
}
const N_RELEVO = 1024, OITAVAS_RELEVO = Math.log2(24000 / 20);
/** profundidade padrão do relevo da carcaça (dB de desvio-padrão; o preset muda em `ressonancia`) */
export const RELEVO_PADRAO = 2;

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
