// Auxiliares do trem (o que se ouve de um trem PARADO): compressor de ar, ventilação e ar-condicionado, transformador.
// Um trem na plataforma não fica em silêncio: as gravações de plataforma (Frota J e Frota L do Metrô de SP, CPTM 9500,
// Taurus parado) mostram, abaixo de 400 Hz, pentes de linhas que são as ordens de rotação dos motores de indução dos
// auxiliares, alimentados a 60 Hz pelo conversor estático: 58,6 Hz (2 polos, 3 500 rpm), 29,3 Hz (4 polos), 19,6 Hz
// (6 polos), sempre 2–3% abaixo da síncrona (o escorregamento), e linhas que ligam e desligam em ciclos de 10–20 s (o
// compressor enchendo os reservatórios). Por cima, o ruído largo da ventilação, que é grave: a densidade medida de dentro
// da CPTM 9500 parada é plana até 250 Hz e cai 6 dB por oitava acima.
//
//   compressor     motor de 4 polos com redução 3:1, virabrequim a ~9,8 Hz: ordens 1 a 36 com o perfil medido na Frota J
//                  (fortes em 58,8 e 78,4 Hz). Liga e desliga pelo pressostato: ~16 s ligado, ~34 s parado (com folga
//                  sorteada); liga ao energizar o trem. O giro cai ~1,2% enquanto a pressão sobe (mais torque, mais
//                  escorregamento) e a pulsação cresce; ao parar, o alívio da válvula (um sopro curto e baixo).
//   ventilacao     motores de 2 polos dos ventiladores e bombas: ordens 1, 2, 3, 4, 6… da rotação (perfil da CPTM 9500 na
//                  plataforma: 116,5 e 233 Hz as mais fortes) e o ruído largo do ar (RuidoVentilador com f_b 250 Hz).
//   transformador  corrente alternada: zumbido de magnetostrição em 2·f da rede de tração e harmônicos (33,4 Hz e
//                  múltiplos em 16,7 Hz; 100 ou 120 Hz em 50 ou 60 Hz), +8 dB em plena carga.
//
// Tudo no canal `aux` do motor (o trem o põe no carro do conversor). Níveis em L_W dB(A) por fonte, calibrados aqui
// mesmo (ponderação A das linhas e do ruído, sem sonda: como o AVAS), para o compressor poder ciclar sem mexer na
// calibração do resto. Como as linhas são graves, o nível sem ponderação fica 10–20 dB acima do número em dB(A).
// Sem alocação no laço: um banco de linhas, um ruído de ventilador e um passa-banda do alívio, montados uma vez.
import { RNG } from '../../acoustics/rng';
import { Bq, ganhoA, rmsCadeia } from '../../scene/filtros';
import { paDeLw } from '../../carriers/ruido';
import { BancoDeLinhas, ListaLinhas, JitterEixo } from './linhas';
import { RuidoVentilador } from './mecanica';
import { BLOCO, MEC, chave, REF_DIST_ELETRICO } from './constantes';

export interface PresetAuxiliares {
  /** compressor de ar (freios, portas, suspensão): L_W dB(A) ligado; ausente ou 0 = não tem */
  compressor?: number;
  /** ventilação e ar-condicionado (motores de 60 Hz dos auxiliares e o ar): L_W dB(A) */
  ventilacao?: number;
  /** zumbido do transformador principal (só em corrente alternada): L_W dB(A) em vazio */
  transformador?: number;
  /** frequência da rede de tração em corrente alternada, Hz (16,7, 50 ou 60) */
  fTracao?: number;
}
export const temAuxiliares = (a: PresetAuxiliares | undefined) => !!a && ((a.compressor ?? 0) > 0 || (a.ventilacao ?? 0) > 0 || (a.transformador ?? 0) > 0);

const dB = (x: number) => Math.pow(10, x / 20);
/** ordens do virabrequim do compressor e o nível de cada uma, dB (Frota J parada na plataforma, 0–6 s) */
const ORD_COMP: [number, number][] = [[1, -22], [2, -14], [3, -15], [4, -12], [5, -20], [6, -4], [7, -18], [8, 0], [9, -9], [10, -13], [12, -12], [14, -15], [16, -17], [18, -12], [20, -18], [24, -18], [27, -12], [32, -16], [36, -18]];
/** ordens de rotação dos motores de 2 polos da ventilação, dB (CPTM 9500 parada na plataforma, 60–120 s; a 1ª da Frota L) */
const ORD_VENT: [number, number][] = [[1, -6], [2, 0], [3, -6], [4, 1], [6, -4], [8, -13], [10, -12], [12, -14], [14, -16]];
/** harmônicos do zumbido do transformador (2·f·h), dB */
const HARM_TRAFO = [0, -6, -10, -14, -18, -22];
/** escorregamento dos motores dos auxiliares (medido: 58,3–58,7 Hz para 60 de alimentação) */
const ESCORREGAMENTO = 0.025;
/** s ligado e s parado do compressor (medido na Frota L: a linha de 58,6 Hz fica 10–19 s e some 4–8 s; em serviço o
 *  intervalo é maior) */
const T_LIGA = 16, T_DESLIGA = 34;
/** potência do ruído largo da ventilação relativa à do pente de ordens */
const K_LARGO_VENT = 1.45;

export class Auxiliares {
  fs: number;
  banco: BancoDeLinhas; lista = new ListaLinhas(64);
  private rng: RNG;
  private jit: JitterEixo;
  // compressor
  private temComp: boolean; private fK: number; private aComp = new Float64Array(ORD_COMP.length);
  ligadoComp = false; private tComp = 0; private wComp = 0; private pressao = 0;
  private alivio: Bq; private gAlivio = 0; private nAlivio = 0; private restAlivio = 0; private kAlivio = 0;
  // ventilação
  private temVent: boolean; private fV: number; private aVent = new Float64Array(ORD_VENT.length);
  private largo: RuidoVentilador | null = null; private rmsLargo = 0; private wVent = 0;
  // transformador
  private temTrafo: boolean; private fT: number; private aTrafo = new Float64Array(HARM_TRAFO.length);
  /** a sonda do nível (motor.ts) mede o canal sem os auxiliares: eles têm calibração própria */
  mudo = false;
  /** multiplicadores por fonte (as ferramentas de orçamento desligam por aqui) */
  ganhos = { compressor: 1, ventilacao: 1, transformador: 1 };

  constructor(a: PresetAuxiliares, fs: number, fAux: number, semente: number) {
    this.fs = fs;
    this.banco = new BancoDeLinhas(fs, 40, semente + 1);
    this.rng = new RNG(semente + 2);
    this.jit = new JitterEixo(fs, semente + 3, 1.5e-3, 0.8, 0.25);
    const refPa = (lw: number) => paDeLw(lw, REF_DIST_ELETRICO);
    /** amplitudes (pico) de um pente para a soma ponderada A dar `pa` (Pa RMS) */
    const pente = (ord: readonly (readonly [number, number])[], f0: number, pa: number, out: Float64Array) => {
      let e = 0;
      for (const [o, d] of ord) { const g = dB(d) * Math.max(1e-3, ganhoA(o * f0)); e += 0.5 * g * g; }
      const k = pa / Math.sqrt(e);
      ord.forEach(([, d], i) => { out[i] = k * dB(d); });
    };
    // compressor: motor de 4 polos com redução 3:1
    this.temComp = (a.compressor ?? 0) > 0;
    this.fK = ((fAux / 2) * (1 - ESCORREGAMENTO)) / 3;
    if (this.temComp) pente(ORD_COMP, this.fK, refPa(a.compressor!), this.aComp);
    this.alivio = new Bq().bp(fs, 2500, 0.7);
    this.nAlivio = Math.round(0.4 * fs);
    // o alívio: 12 dB abaixo do compressor em nível A
    this.kAlivio = this.temComp ? (refPa(a.compressor!) * dB(-12)) / rmsCadeia(fs, [this.alivio], 1 / 3, true, 8) : 0;
    // ventilação: pente das ordens dos motores de 2 polos mais o largo do ar, juntos no L_W pedido
    this.temVent = (a.ventilacao ?? 0) > 0;
    this.fV = fAux * (1 - ESCORREGAMENTO);
    if (this.temVent) {
      pente(ORD_VENT, this.fV, 1, this.aVent);                       // pente com 1 Pa RMS ponderado A
      let pot = 0; for (let i = 0; i < this.aVent.length; i++) pot += 0.5 * this.aVent[i] * this.aVent[i];
      this.largo = new RuidoVentilador(fs, semente + 4, 250, 14, 10);
      const rmsL = Math.sqrt(K_LARGO_VENT * pot);                     // RMS do largo (sem ponderação) para o pente de 1 Pa(A)
      const rmsLA = rmsL * rmsCadeia(fs, this.largo.bq, 1 / 3, true, 2) * this.largo.norm;   // … e o que ele vale em A
      const k = refPa(a.ventilacao!) / Math.sqrt(1 + rmsLA * rmsLA);
      for (let i = 0; i < this.aVent.length; i++) this.aVent[i] *= k;
      this.rmsLargo = rmsL * k;
    }
    // transformador
    this.temTrafo = (a.transformador ?? 0) > 0;
    this.fT = 2 * (a.fTracao ?? 50);
    if (this.temTrafo) pente(HARM_TRAFO.map((d, i) => [i + 1, d] as const), this.fT, refPa(a.transformador!), this.aTrafo);
  }

  /** um bloco de controle: `ligado` = trem energizado; `corrente` = I/I_n da tração (o transformador sobe com a carga) */
  controle(dt: number, ligado: boolean, corrente: number) {
    const L = this.lista, G = this.ganhos;
    L.limpar();
    this.jit.passo();
    const jf = this.jit.fator;
    const on = ligado && !this.mudo;
    // ---- compressor: pressostato
    if (this.temComp) {
      if (!on) { this.ligadoComp = false; this.tComp = 0; }
      else {
        this.tComp -= dt;
        if (this.tComp <= 0) {
          const era = this.ligadoComp;
          // (energizado agora: liga para encher os reservatórios; depois alterna)
          this.ligadoComp = !era;
          this.tComp = this.ligadoComp ? T_LIGA * (0.85 + 0.3 * this.rng.next()) : T_DESLIGA * (0.8 + 0.4 * this.rng.next());
          if (era && !this.ligadoComp) { this.restAlivio = this.nAlivio; this.gAlivio = this.kAlivio * G.compressor; }
          if (this.ligadoComp) this.pressao = 0;
        }
      }
      // partida direta: ~0,3 s para chegar ao giro; parada: o pistão freia em ~0,5 s
      this.wComp += ((this.ligadoComp ? 1 : 0) - this.wComp) * Math.min(1, dt / (this.ligadoComp ? 0.12 : 0.18));
      if (this.ligadoComp) this.pressao = Math.min(1, this.pressao + dt / T_LIGA);
      const w = this.wComp;
      if (w > 0.02) {
        const f0 = this.fK * w * (1 - 0.012 * this.pressao) * jf, a = w * w * (0.7 + 0.3 * this.pressao) * G.compressor;
        for (let i = 0; i < ORD_COMP.length; i++) L.por(chave(MEC.aux, 64 + i), ORD_COMP[i][0] * f0, a * this.aComp[i]);
      }
    }
    // ---- ventilação: sobe em ~1 s ao energizar
    if (this.temVent) {
      this.wVent += ((on ? 1 : 0) - this.wVent) * Math.min(1, dt / 0.6);
      const w = this.wVent;
      this.largo!.alvo(w * w * this.rmsLargo * G.ventilacao);
      if (w > 0.02) {
        const f0 = this.fV * w * jf, a = w * w * this.jit.ganho * G.ventilacao;
        for (let i = 0; i < ORD_VENT.length; i++) L.por(chave(MEC.aux, 96 + i), ORD_VENT[i][0] * f0, a * this.aVent[i]);
      }
    }
    // ---- transformador: 2·f da rede, +8 dB em plena carga (a rede não passeia como um eixo: só ±0,05%)
    if (this.temTrafo && on) {
      const a = (1 + 1.51 * Math.min(1.5, Math.max(0, corrente))) * G.transformador, fj = 1 + (jf - 1) / 3;
      for (let i = 0; i < HARM_TRAFO.length; i++) L.por(chave(MEC.aux, 128 + i), (i + 1) * this.fT * fj, a * this.aTrafo[i]);
    }
    this.banco.atualizar(L, 1, 1);
  }

  /** soma n amostras do bloco corrente no canal */
  processar(out: Float32Array, off: number, n: number, pos: number) {
    this.banco.processar(out, off, n);
    this.largo?.processar(out, off, n, pos, BLOCO, 1);
    if (this.restAlivio > 0) {
      const m = Math.min(n, this.restAlivio), r = this.rng, b = this.alivio, N = this.nAlivio, g = this.gAlivio;
      for (let k = 0; k < m; k++) {
        const t = (N - this.restAlivio + k) / N;
        // sopro que abre de uma vez e morre em ~0,15 s
        out[off + k] += g * Math.exp(-t * 2.7) * (t < 0.02 ? t / 0.02 : 1) * b.run(r.bi());
      }
      this.restAlivio -= m;
    }
  }
}
