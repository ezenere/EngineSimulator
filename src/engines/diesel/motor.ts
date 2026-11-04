// Adaptador `Motor` (CENA.md 1.3) sobre o DieselDSP, para os portadores de src/carriers/ (gerador, locomotiva).
// TODO(integração carriers/): os tipos abaixo são cópia dos de CENA.md 1.2/1.3; trocar pelos de
// src/scene/tipos.ts e src/engines/motor.ts quando a camada de portadores entrar na branch, e separar as fontes
// (escape.k, admissao, bloco, compressor) em vez do estéreo legado. Níveis absolutos de gerador e locomotiva
// (DIESEL.md 6.3: L_W 118 dB(A) no grupo gerador de 500 kVA, 128 dB(A) na locomotiva em N8) também ficam para lá.
import { DieselDSP, type CargaExterna } from './dsp';
import { configCalibrada } from './config';

export interface ComandoMotor { acelerador: number; ignicao: boolean; partida: boolean; combustivel?: number }
export type EstadoMotor = 'desligado' | 'partida' | 'funcionando' | 'parando';

export class MotorDiesel {
  readonly familia = 'diesel';
  dsp: DieselDSP;
  private ign = false;
  constructor(fs: number) { this.dsp = new DieselDSP(fs); }
  get params() { return this.dsp.params; }
  get estado(): EstadoMotor { const s = this.dsp.state; return s === 'run' ? 'funcionando' : s === 'crank' ? 'partida' : 'desligado'; }
  get eixo() { return { omega: this.dsp.omega, torque: Math.max(0, this.dsp.tqMean + this.dsp.Tcarga), inercia: this.dsp.J }; }

  configurar(preset: object, fs: number) {
    this.dsp.setConfig(configCalibrada(preset as any, fs));
    // o governador passa a ser o do portador: `combustivel` manda direto no combustível
    this.dsp.message({ type: 'diesel', portador: 'nenhum' });
  }
  comandar(c: ComandoMotor) {
    if (c.ignicao !== this.ign) { this.ign = c.ignicao; this.dsp.message({ type: 'input', ignition: c.ignicao }); }
    this.dsp.message({ type: 'input', throttle: c.acelerador });
    this.dsp.message({ type: 'diesel', combustivel: c.combustivel ?? null });
  }
  acoplar(carga: CargaExterna | null) { this.dsp.acoplar(carga); }
  processarLegado(outL: Float32Array, outR: Float32Array, sendL: Float32Array, sendR: Float32Array, n: number) { this.dsp.process(outL, outR, n, sendL, sendR); }
  telemetria() { const t = this.dsp.telemetry(); return { ...t, potencia: t.kW, estado: this.estado }; }
}
