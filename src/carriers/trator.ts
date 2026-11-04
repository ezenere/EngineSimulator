// Portador trator a vapor (docs/VAPOR.md 2.2 e 4.4; `TipoPortador` 'trator' é extensão): Aveling & Porter, Fowler,
// Burrell. Corpo de 6,5 × 2,4 × 3,5 m, rodas de ferro na estrada (ruído largo 100–800 Hz, L_W 95 dB(A) a 8 km/h, n 3),
// marcha 1/2 pelas engrenagens de dentes retos (a redução é do motor: `VaporDSP.definirReducao`), marcha 0 = embreagem
// solta e a manivela em lenta no governador (70–80 rpm).
//   carga = r·m·g·(c_rr + rampa), c_rr 0,05 em terra;  inércia = m·r²
import type { Carga } from '../scene/tipos';
import type { TelemetriaPortador, Corpo, ComandoPortador, Motor } from './tipos';
import { PortadorComMotor } from './base';
import { FonteRuido, Ramo } from './ruido';
import { REF_DIST_PORTADOR } from './trem';
import { Bq } from '../scene/filtros';
import type { VaporDSP, ComandoVapor } from '../engines/vapor/dsp';
import type { PresetVapor } from '../engines/vapor/presets';

/** rodas de ferro no chão: largo, 100–800 Hz */
export class FonteFerro extends FonteRuido {
  constructor(fs: number, lw: number, vRef: number, refDist: number, semente: number) {
    super(fs, { lw, n: 3, vRef, refDist }, semente);
    this.ramos = [new Ramo(semente, [new Bq(), new Bq()])];
  }
  montar() { this.ramos[0].bq[0].hp(this.fs, 100, 0.7071); this.ramos[0].bq[1].lp(this.fs, 800, 0.7071); }
}

export interface ConfigTrator { massa: number; dRoda: number; reducoes: [number, number]; crr: number; rampa: number }
export const configTrator = (P: PresetVapor): ConfigTrator => ({ massa: P.massa, dRoda: P.dRoda, reducoes: [P.reducao ?? 12, P.reducao2 ?? (P.reducao ?? 12) / 2], crr: 0.05, rampa: 0 });

export class CargaTrator implements Carga {
  inercia: number; r: number; m: number; crr: number; rampa = 0;
  constructor(c: ConfigTrator) { this.r = c.dRoda / 2; this.m = c.massa * 1000; this.crr = c.crr; this.inercia = this.m * this.r * this.r; }
  torque(omega: number) { const v = omega * this.r; return this.r * this.m * 9.81 * (this.crr * Math.tanh(v / 0.05) + this.rampa); }
}

export class Trator extends PortadorComMotor {
  readonly tipo = 'trator' as const;
  cfg: ConfigTrator; cargaT: CargaTrator; rodas: FonteFerro; marcha = 1;
  constructor(fs: number, cfg: ConfigTrator) {
    const corpo: Corpo = { segmentos: [{ comprimento: 6.5, vao: 0, altura: 3.5, largura: 2.4, zPiso: 0.3 }], comprimento: 6.5, nariz: 0, cauda: 0, areaFrontal: 7, cd: 1.0, cpNariz: 0, massaSuperficial: 10, fCabine: 60 };
    super(fs, 'trator', corpo, { posMotor: [0, 0, 0], rotMotor: 'frente' });
    this.cfg = cfg; this.cargaT = new CargaTrator(cfg); this.cargaT.rampa = cfg.rampa;
    this.rodas = new FonteFerro(fs, 95, 8 / 3.6, REF_DIST_PORTADOR, 0xfe77);
    this.propria({ id: 'rodas', tipo: 'rolamento', pos: [-1.5, 0, 0.3], dir: { tabela: [0, 0, 0, 0, 0, 0, 0], eixo: [0, 1, 0], expConv: 2 }, refDist: REF_DIST_PORTADOR, dentro: false }, this.rodas);
  }
  carga() { return this.marcha > 0 ? this.cargaT : null; }
  get vapor(): VaporDSP | null { return (this.motor as unknown as VaporDSP) ?? null; }
  acoplar(m: Motor | null) { super.acoplar(m); this.aplicarMarcha(); }
  private aplicarMarcha() {
    const m = this.vapor; if (!m) return;
    if (this.marcha > 0) m.definirReducao(this.cfg.reducoes[this.marcha - 1]);
    m.acoplar(this.carga());
  }
  comandar(c: ComandoPortador & Partial<ComandoVapor> & { rampa?: number }) {
    super.comandar(c);
    if (typeof c.marcha === 'number' && c.marcha !== this.marcha) { this.marcha = Math.max(0, Math.min(2, c.marcha | 0)); this.aplicarMarcha(); }
    if (c.rampa != null) this.cargaT.rampa = c.rampa;
    const m = this.vapor;
    if (m) {
      const vc: any = { acelerador: 0, ignicao: c.ignicao !== false, partida: false };
      for (const k of ['regulador', 'cutoff', 'apito', 'fogo', 'injetor', 'torneiras', 'freio', 'mixAr', 'mixMec']) if ((c as any)[k] !== undefined) vc[k] = (c as any)[k];
      if (c.regulador === undefined && c.pedal !== undefined && (c as any).cutoff === undefined) vc.regulador = c.pedal;
      m.comandar(vc);
    }
  }
  protected fisica(n: number, dt: number) {
    const m = this.vapor, k = this.cinematica, r = this.cfg.dRoda / 2, vf = this.cmd.velocidadeFixa;
    if (m) {
      m.impor(vf != null && this.marcha > 0 ? vf / r : null);
      if (vf == null) { const v = this.marcha > 0 ? m.wTrem * r : Math.max(0, k.v - 0.5 * n * dt); k.a = (v - k.v) / (n * dt); k.v = v; }
    }
    this.rodas.ajustar(vf ?? k.v);
  }
  telemetria(): TelemetriaPortador {
    const m = this.vapor, w = m ? m.eixo.omega : 0;
    return { v: this.cinematica.v, s: this.cinematica.s, rpmEixo: (w * 60) / (2 * Math.PI), torqueCarga: this.carga()?.torque(w) ?? 0, marcha: this.marcha, motor: m ? m.telemetria() : null };
  }
}
