// Estado e ações da página do Ronco, fora do React (o equivalente às variáveis e funções soltas de src/app.js). O comum
// das páginas a pistão (store, áudio, escuta, temperatura, pedal e manete, ignição, envio da configuração) está em
// src/pages/comum/controle.ts; aqui fica o que é do Ronco: a geometria e a ficha do carro, o câmbio automático, a família
// aviação (RADIAL.md 7.2: magnetos, mistura, manete de passo, coletivo e embreagem do rotor) e o "motor morreu".
import { build, CRANKS, LAYOUTS, type MotorMontado } from '../../engines/ronco/geometria';
import { PRESETS, ACESSORIOS_PADRAO, type PresetRonco } from '../../engines/ronco/presets';
import { configCalibrada } from '../../engines/ronco/config';
import { AV_PADRAO, passoDaMistura, proximoMagneto, type EstadoAv } from '../comum/Aviacao';
import { ControlePistao, estadoInicial, type EstadoPistao, type Lento, type ParamsPistao } from '../comum/controle';

export type Spec = PresetRonco & Record<string, any>;
export type ParamsRonco = ParamsPistao;
export type { Lento };

export type EstadoRonco = EstadoPistao<Spec, MotorMontado> & {
  // aviação (RADIAL.md 7.2): magnetos, mistura, manete de passo, coletivo e embreagem do rotor
  av: EstadoAv;
};

export type Telemetria = Record<string, any> & { rpm: number; theta: number; kmh: number; gear: number; boost: number; thr: number; limiter: boolean; state: string; torque: number; t?: number };

export const DRIVE_MODES: [string, string, string][] = [
  ['track', 'Pista', 'Sobe quase no corte e reduz cedo: o motor fica sempre cheio'],
  ['sport', 'Esportivo', 'Sobe alto e reduz em giro médio'],
  ['normal', 'Normal', 'Trocas em giro médio, como no dia a dia'],
  ['eco', 'Econômico', 'Sobe o mais cedo possível e reduz quase na lenta'],
  ['auto', 'Automático', 'Decide pelo quanto você pisa: pouco acelerador troca cedo, pé no fundo estica'],
];

export const familyFor = (layout: string, n: number) => CRANKS[`${layout}-${n}`];

// cada carro vem com o próprio escape: acessórios que ele não define voltam ao padrão
const specDe = (p: PresetRonco) => ({ ...ACESSORIOS_PADRAO, ...p } as Spec);

export class ControleRonco extends ControlePistao<Spec, MotorMontado, EstadoRonco> {
  tele: Telemetria = { rpm: 0, theta: 0, kmh: 0, gear: 0, boost: 0, thr: 0, limiter: false, state: 'off', torque: 0 };

  constructor() {
    const spec = specDe(PRESETS[0]);
    super({ ...estadoInicial(spec, build(spec), PRESETS[0]), av: { ...AV_PADRAO } });
  }

  protected montar(spec: Spec) { return build(spec); }
  protected configDoMotor(sr: number) { return configCalibrada(this.spec, sr); }
  protected depoisDaConfig() { this.enviarAv(); }
  // (a posição da manete de um avião vai ao DSP junto com a cadeia: ela fica onde foi deixada)
  protected aoIniciarAudio() { if (this.comManete) this.sendInput(); }

  loadPreset(p: PresetRonco) {
    const spec = specDe(p);
    const av = { ...AV_PADRAO, magnetos: p.magnetosPadrao || 'ambos', mistura: p.misturaPadrao ?? 0.8 };
    const eraManete = this.comManete;
    this.mudar({ spec, motor: build(spec), presetId: p.id, av }, true);
    this.pushConfig(true, true);
    // (do carro para o avião e de volta: o comando de potência muda de pedal para manete)
    if (eraManete || this.comManete) this.sendInput();
  }

  // M: próximo modo do câmbio automático
  cycleDriveMode() {
    const i = DRIVE_MODES.findIndex(([v]) => v === (this.spec.driveMode || 'auto'));
    this.setSpec({ driveMode: DRIVE_MODES[(i + 1) % DRIVE_MODES.length][0] }, { structural: false });
  }

  pickCylinders(n: number) {
    let layout = this.spec.layout;
    if (!LAYOUTS[layout].counts.includes(n)) layout = LAYOUTS.v.counts.includes(n) ? 'v' : 'inline';
    this.applyFamily(layout, n);
  }

  applyFamily(layout: string, n: number, crankId?: string) {
    const fam = familyFor(layout, n);
    const crank = fam.find((k) => k.id === crankId) || fam[0];
    const patch: Partial<Spec> = { layout, cylinders: n, crank: crank.id, order: crank.orders[0][0] };
    if (layout === 'v') patch.bankAngle = crank.bank;
    if (layout === 'inline' && (this.spec.routing === 'xpipe' || this.spec.routing === 'hpipe')) patch.routing = 'dual';
    this.setSpec(patch);
  }

  /** avião e helicóptero: o comando de potência é a manete; nos carros, o pedal */
  get comManete() { return !!this.spec.aviation; }

  shift(dir: number) { if (!this.spec.aviation) this.audio?.send({ type: 'input', shift: dir }); }

  // ---------------------------------------------------------------- aviação (RADIAL.md 7.2)
  private enviarAv() { if (this.spec.aviation) this.audio?.send({ type: 'av', ...this.estado.av }); }
  setAv(p: Partial<EstadoAv>) { this.mudar({ av: { ...this.estado.av, ...p } }, true); this.audio?.send({ type: 'av', ...p }); }
  cycleMagnetos() { if (this.spec.aviation) this.setAv({ magnetos: proximoMagneto(this.estado.av.magnetos) }); }
  stepMistura(d: number) { if (this.spec.aviation) this.setAv({ mistura: passoDaMistura(this.estado.av.mistura, d) }); }

  // motor morreu
  protected telemetria(m: any) {
    super.telemetria(m);
    if (this.apagou(m, 1500)) this.mudar({ ignicao: false });
  }
}
