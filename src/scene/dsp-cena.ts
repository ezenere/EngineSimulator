// DSP da Cena para o AudioWorklet (contrato de src/worklet/tipos.ts): portador + cena, 4 canais
// (0–1 direto binaural, 2–3 envio para o ConvolverNode do ambiente). A escala é absoluta
// (0 dBFS ≙ 124 dB SPL); por cima vão o `master` do usuário e o `tanh` como limitador suave.
//
// Mensagens:
//   { type: 'portador', tipo: 'trem', config?: Partial<ConfigTrem> }   monta o portador (aloca)
//   { type: 'cena', amb?, traj?, ouv? }                                configura/atualiza (rampas de 20 ms)
//   { type: 'comando', ...ComandoPortador }                            velocidade fixa etc.
//   { type: 'params', master?, posicao? }                              master e posição s do corpo
// Telemetria a cada 1024 amostras: { type: 'telemetria', cena: TelemetriaCena, portador: TelemetriaPortador }.
import type { DSPDeAudio } from '../worklet/tipos';
import type { Portador } from '../carriers/tipos';
import type { Ambiente, Trajetoria, Ouvinte } from './tipos';
import { CenaPassagem } from './cena';
import { Trem } from '../carriers/trem';
import { ambientePassagem } from './ambientes';

export const OUVINTE_PADRAO: Ouvinte = { modo: 'fixo', pos: [0, 0, 1.6], gimbal: { az: 90, el: 0, r: 5, alvo: 'corpo' }, local: 'fora', binaural: true };
export const TRAJ_TREM: Trajetoria = { tipo: 'reta', comprimento: 3000, raioCurva: 2000, lateral: 3, altitude: 0, sentido: 1 };

export class CenaDSP implements DSPDeAudio {
  fs: number;
  cena = new CenaPassagem();
  portador: Portador | null = null;
  canais: Float32Array[] = [];
  master = 0.8;
  post: ((m: any) => void) | null = null;
  nTele = 0;
  amb: Ambiente; traj: Trajetoria; ouv: Ouvinte;
  sL = new Float32Array(4096); sR = new Float32Array(4096);
  /** escreve sem tanh nem master (validação offline mede a pressão de verdade) */
  cru = false;

  constructor(fs: number) {
    this.fs = fs;
    this.amb = ambientePassagem('tunel'); this.traj = TRAJ_TREM; this.ouv = OUVINTE_PADRAO;
    this.cena.configurar(this.amb, this.traj, this.ouv, fs);
  }

  montar(p: Portador) {
    this.portador = p;
    this.canais = p.fontes().map(() => new Float32Array(4096));
  }

  message(m: any) {
    if (!m) return;
    if (m.type === 'portador') {
      if (m.tipo === 'trem') {
        const ladoOuvinte = (this.traj.sentido === 1 ? -1 : 1) as 1 | -1;
        this.montar(new Trem(this.fs, { ladoOuvinte, ...(m.config || {}) }));
      }
    } else if (m.type === 'cena') {
      if (m.amb) this.amb = m.amb; if (m.traj) this.traj = m.traj; if (m.ouv) this.ouv = m.ouv;
      this.cena.atualizar({ amb: m.amb, traj: m.traj, ouv: m.ouv });
    } else if (m.type === 'comando') {
      this.portador?.comandar(m);
    } else if (m.type === 'params') {
      if (typeof m.master === 'number') this.master = m.master;
      if (typeof m.posicao === 'number' && this.portador) (this.portador.cinematica as { s: number }).s = m.posicao;
    }
  }

  process(outL: Float32Array, outR: Float32Array, n: number, sendL?: Float32Array, sendR?: Float32Array) {
    if (!this.portador) { outL.fill(0, 0, n); outR.fill(0, 0, n); sendL?.fill(0, 0, n); sendR?.fill(0, 0, n); return; }
    const p = this.portador;
    p.processar(this.canais, n, 1 / this.fs);
    const sl = sendL ?? this.sL, sr = sendR ?? this.sR;
    this.cena.processar(p, this.canais, outL, outR, sl, sr, n);
    if (!this.cru) {
      const g = this.master;
      for (let k = 0; k < n; k++) { outL[k] = Math.tanh(outL[k] * g); outR[k] = Math.tanh(outR[k] * g); sl[k] *= g; sr[k] *= g; }
    }
    this.nTele += n;
    if (this.post && this.nTele >= 1024) {
      this.nTele = 0;
      this.post({ type: 'telemetria', cena: this.cena.telemetria(), portador: p.telemetria() });
    }
  }
}
