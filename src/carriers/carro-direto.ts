// Portador `CarroDireto` (docs/VAPOR.md 2.3 e 4.4, decisão 9): o carro do motor a vapor (Stanley), sem câmbio nem
// embreagem: o motor de 2 cilindros vai montado no eixo traseiro com uma relação fixa (a `reducao` do preset, que o
// VaporDSP já aplica entre a manivela e a roda). Massa 1,2 t, `cd` 0,6, pneus (ruído de rolamento do pneu ligado:
// passa-banda largo em 800 Hz·√(v/v_ref), L_W 92 dB(A) a 80 km/h, n 3,5; o CarroLegado do Ronco os deixa desligados).
//   torque = r·(m·g·(c_rr + rampa) + ½·ρ·cd·A·v² + freio)   inércia = m·r²
import type { Carga, Diretividade } from '../scene/tipos';
import type { TelemetriaPortador, Corpo, ComandoPortador } from './tipos';
import { PortadorComMotor } from './base';
import { FonteRuido, Ramo } from './ruido';
import { REF_DIST_PORTADOR } from './trem';
import { Bq } from '../scene/filtros';
import type { VaporDSP, ComandoVapor } from '../engines/vapor/dsp';
import type { PresetVapor } from '../engines/vapor/presets';

export interface ConfigCarroDireto { massa: number; dRoda: number; cd: number; area: number; crr: number; rampa: number }
export const configCarroDireto = (P: PresetVapor): ConfigCarroDireto => ({ massa: P.massa, dRoda: P.dRoda, cd: 0.6, area: 2.4, crr: 0.015, rampa: 0 });

/** pneu na estrada: passa-banda largo, sobe com √v */
export class FontePneu extends FonteRuido {
  constructor(fs: number, semente: number) { super(fs, { lw: 92, n: 3.5, vRef: 80 / 3.6, refDist: REF_DIST_PORTADOR }, semente); this.ramos = [new Ramo(semente, [new Bq()], 3000)]; }
  montar(v: number) { const k = Math.sqrt(Math.max(0.05, v / this.esp.vRef)); this.ramos[0].bq[0].bp(this.fs, 800 * k, 0.6); this.definirLp(this.ramos[0], 3000 * k); }
}

export class CargaCarro implements Carga {
  inercia: number; c: ConfigCarroDireto; r: number; rampa = 0; freio = 0;
  constructor(c: ConfigCarroDireto) { this.c = c; this.r = c.dRoda / 2; this.inercia = c.massa * 1000 * this.r * this.r; }
  torque(omega: number) {
    const c = this.c, v = omega * this.r, m = c.massa * 1000, s = Math.tanh(v / 0.05);
    return this.r * (s * (m * 9.81 * c.crr + 0.5 * 1.2 * c.cd * c.area * v * v + this.freio * 0.8 * m * 9.81) + m * 9.81 * this.rampa);
  }
}

const DIP: Diretividade = { tabela: [0, -1.2, -6, -20, -6, -1.2, 0], eixo: [0, 1, 0], expConv: 2 };

export class CarroDireto extends PortadorComMotor {
  readonly tipo = 'carro' as const;
  cfg: ConfigCarroDireto; cargaC: CargaCarro; pneus: FontePneu[] = [];
  constructor(fs: number, cfg: ConfigCarroDireto) {
    const corpo: Corpo = { segmentos: [{ comprimento: 4.2, vao: 0, altura: 1.8, largura: 1.7, zPiso: 0.25 }], comprimento: 4.2, nariz: 0, cauda: 0, areaFrontal: cfg.area, cd: cfg.cd, cpNariz: 0.05, massaSuperficial: 8, fCabine: 70 };
    super(fs, 'carro', corpo, { posMotor: [0, 0, 0], rotMotor: 'frente' });
    this.cfg = cfg; this.cargaC = new CargaCarro(cfg); this.cargaC.rampa = cfg.rampa;
    [[1.3, 0.75], [1.3, -0.75], [-1.3, 0.75], [-1.3, -0.75]].forEach(([x, y], k) => {
      const p = new FontePneu(fs, 0x9e0 + k);
      this.pneus.push(p);
      this.propria({ id: `pneu.${k}`, tipo: 'rolamento', pos: [x, y, 0.2], hCorpo: 0.2, dir: DIP, refDist: REF_DIST_PORTADOR, dentro: false }, p);
    });
  }
  carga() { return this.cargaC; }
  get vapor(): VaporDSP | null { return (this.motor as unknown as VaporDSP) ?? null; }
  comandar(c: ComandoPortador & Partial<ComandoVapor> & { rampa?: number }) {
    super.comandar(c);
    if (c.freio != null) this.cargaC.freio = c.freio;
    if (c.rampa != null) this.cargaC.rampa = c.rampa;
    const m = this.vapor;
    if (m) {
      const vc: any = { acelerador: 0, ignicao: c.ignicao !== false, partida: false };
      for (const k of ['regulador', 'cutoff', 'apito', 'fogo', 'freio', 'mixAr', 'mixMec']) if ((c as any)[k] !== undefined) vc[k] = (c as any)[k];
      // o Stanley se dirige pelo acelerador (a válvula de vapor) com o reverser adiante, em corte médio
      if (c.regulador === undefined && c.pedal !== undefined && (c as any).cutoff === undefined) { vc.regulador = c.pedal; vc.cutoff = 0.5; }
      m.comandar(vc);
    }
  }
  protected fisica(n: number, dt: number) {
    const m = this.vapor, k = this.cinematica, r = this.cfg.dRoda / 2, vf = this.cmd.velocidadeFixa;
    if (m) {
      m.impor(vf != null ? vf / r : null);
      if (vf == null) { const v = m.wTrem * r; k.a = (v - k.v) / (n * dt); k.v = v; }
    }
    for (const p of this.pneus) p.ajustar(vf ?? k.v);
  }
  telemetria(): TelemetriaPortador {
    const m = this.vapor, w = m ? m.eixo.omega : 0;
    return { v: this.cinematica.v, s: this.cinematica.s, rpmEixo: (w * 60) / (2 * Math.PI), torqueCarga: this.cargaC.torque(m ? m.wTrem : 0), motor: m ? m.telemetria() : null };
  }
}
