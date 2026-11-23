// Estado e ações da página do Diesel, fora do React. O comum das páginas a pistão está em src/pages/comum/controle.ts;
// aqui fica o que é do diesel: a geometria de 2 e 4 tempos, o portador (veículo, gerador, locomotiva, bancada) e a carga
// dele, que vão ao DSP em `{ type: 'diesel', … }` (notch, degrau, dinamômetro, freio-motor, acelerador manual e
// governador), e o "apagou" que espera as velas.
import { buildDiesel, familiaDiesel } from '../../engines/diesel/geometria';
import type { MotorMontado } from '../../engines/ronco/geometria';
import { PRESETS, PADRAO_DIESEL, portadorAoTrocar, type PresetDiesel, type Portador } from '../../engines/diesel/presets';
import { configCalibrada, montarConfig } from '../../engines/diesel/config';
import { ControlePistao, estadoInicial, type EstadoPistao, type Lento, type ParamsPistao } from '../comum/controle';

export type Spec = PresetDiesel & Record<string, any>;
export type ParamsDiesel = ParamsPistao;
export type { Lento };

export type Carga = { notch: number; degrau: number; dinamometro: number; rpmAlvo: number; freio: boolean; jake: number; manual: number; dinamico: boolean; lentaBaixa: boolean; fRede: number };

type MotorDiesel = MotorMontado & { tempos: number };
export type EstadoDiesel = EstadoPistao<Spec, MotorDiesel> & { portador: Portador; carga: Carga };

export type Telemetria = Record<string, any> & { rpm: number; theta: number; state: string };

export const DRIVE_MODES: [string, string, string][] = [
  ['track', 'Pista', 'Sobe quase na rotação máxima e reduz cedo'],
  ['sport', 'Esportivo', 'Sobe alto e reduz em giro médio'],
  ['normal', 'Normal', 'Trocas em giro médio, como no dia a dia'],
  ['eco', 'Econômico', 'Sobe o mais cedo possível (caminhões carregados)'],
  ['auto', 'Automático', 'Decide pelo quanto você pisa'],
];

export const familyFor = (layout: string, n: number, tempos = 4) => familiaDiesel(layout, n, tempos);
const CARGA0: Carga = { notch: 0, degrau: 0, dinamometro: 0, rpmAlvo: 0, freio: false, jake: 6, manual: 0, dinamico: false, lentaBaixa: false, fRede: 60 };

export class ControleDiesel extends ControlePistao<Spec, MotorDiesel, EstadoDiesel> {
  constructor() {
    const p = PRESETS[0];
    const spec = { ...PADRAO_DIESEL, ...p } as Spec;
    super({
      ...estadoInicial(spec, buildDiesel(spec), p),
      portador: p.portadores[0], carga: { ...CARGA0, jake: p.jakeCilindros?.[p.jakeCilindros.length - 1] ?? 6, fRede: p.gerador?.fRede ?? 60 },
    });
  }

  protected montar(spec: Spec) { return buildDiesel(spec); }
  protected configDoMotor(sr: number) { return configCalibrada(this.spec, sr); }
  protected configLeve() { return montarConfig(this.spec); }
  protected depoisDaConfig() { this.enviarCarga(); }

  // estado de carga e portador inteiro para o DSP (depois de cada config, o DSP volta ao do preset)
  private enviarCarga() {
    const c = this.estado.carga;
    this.audio?.send({ type: 'diesel', portador: this.estado.portador, notch: c.notch, degrau: c.degrau, cargaBancada: c.dinamometro, rpmAlvo: c.rpmAlvo,
      freioMotor: c.freio, jakeCilindros: c.jake, manual: c.manual, dinamico: c.dinamico, lentaBaixa: c.lentaBaixa, fRede: c.fRede });
  }

  loadPreset(p: PresetDiesel) {
    const spec = { ...PADRAO_DIESEL, ...p } as Spec;
    const portador = portadorAoTrocar(p, this.estado.portador);
    const carga = { ...this.estado.carga, notch: 0, degrau: 0, dinamometro: 0, rpmAlvo: 0, jake: p.jakeCilindros?.[p.jakeCilindros.length - 1] ?? 6, fRede: p.gerador?.fRede ?? 60, freio: false };
    this.mudar({ spec, motor: buildDiesel(spec), presetId: p.id, portador, carga }, true);
    this.pushConfig(true, true);
  }

  cycleDriveMode() { const i = DRIVE_MODES.findIndex(([v]) => v === (this.spec.driveMode || 'auto')); this.setSpec({ driveMode: DRIVE_MODES[(i + 1) % DRIVE_MODES.length][0] }, { structural: false }); }

  pickCylinders(n: number) {
    let layout = this.spec.layout;
    if (!familyFor(layout, n, this.spec.tempos).length) layout = familyFor('v', n, this.spec.tempos).length ? 'v' : 'inline';
    this.applyFamily(layout, n);
  }
  applyFamily(layout: string, n: number, crankId?: string, tempos = this.spec.tempos) {
    let fam = familyFor(layout, n, tempos);
    if (!fam.length) { tempos = 4; fam = familyFor(layout, n, 4); }
    if (!fam.length) return;
    const crank = fam.find((k) => k.id === crankId) || fam[0];
    const patch: Partial<Spec> = { layout, cylinders: n, crank: crank.id, order: crank.orders[0][0], tempos: tempos as 2 | 4 };
    if (layout === 'v') patch.bankAngle = crank.bank;
    if (tempos === 2 && !this.spec.janelas) patch.janelas = { evo: 100, ipo: 134, ipc: 226, evc: 232 };
    this.setSpec(patch);
  }
  // tempos: o 2T só existe nos virabrequins de 2 tempos (EMD, Detroit)
  setTempos(t: 2 | 4) { const s = this.spec; this.applyFamily(s.layout, s.cylinders, undefined, t); }

  // ---------------------------------------------------------------- portador e carga
  setPortador(p: Portador) {
    if (!this.spec.portadores.includes(p)) return;
    this.mudar({ portador: p, carga: { ...this.estado.carga, notch: 0, degrau: 0, dinamometro: 0 } }, true);
    this.enviarCarga();
  }
  setCarga(p: Partial<Carga>, render = true) {
    this.mudar({ carga: { ...this.estado.carga, ...p } }, render);
    this.enviarCarga();
  }
  setNotch(n: number) { if (this.estado.portador === 'locomotiva') this.setCarga({ notch: Math.max(0, Math.min(8, n)) }); }
  setDegrau(v: number) { if (this.estado.portador === 'gerador') this.setCarga({ degrau: v }); }
  toggleFreio() { if (this.spec.freioMotor !== 'nenhum') this.setCarga({ freio: !this.estado.carga.freio }); }

  shift(dir: number) { if (this.estado.portador === 'carro') this.audio?.send({ type: 'input', shift: dir }); }

  protected telemetria(m: any) {
    // (a leitura que não traz o traço p–θ mantém o último)
    const pt = m.ptheta || this.tele.ptheta;
    super.telemetria(m);
    this.tele.ptheta = pt;
    // apagou (as velas contam como ligado)
    if (!(m.velas > 0) && this.apagou(m, 1500)) this.mudar({ ignicao: false });
  }
}
