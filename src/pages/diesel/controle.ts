// Estado e ações da página do Diesel, fora do React (o mesmo padrão de src/pages/ronco/controle.ts). O React lê um
// retrato imutável (`estado`) com useSyncExternalStore; a telemetria fica em `tele` e é desenhada no
// requestAnimationFrame (mostradores.ts). As mensagens ao DSP são as do Ronco (params, config, tune, input) mais
// `{ type: 'diesel', … }` para portador, notch, degrau, dinamômetro, freio-motor, acelerador manual e governador.
import { buildDiesel, familiaDiesel } from '../../engines/diesel/geometria';
import { LAYOUTS, type MotorMontado } from '../../engines/ronco/geometria';
import { PRESETS, PADRAO_DIESEL, portadorAoTrocar, type PresetDiesel, type Portador } from '../../engines/diesel/presets';
import { gearRatios } from '../../engines/ronco/dsp';
import { configCalibrada, montarConfig } from '../../engines/diesel/config';
import type { CadeiaDeAudio, Equalizacao } from '../../ui';

export type Spec = PresetDiesel & Record<string, any>;

export type ParamsDiesel = {
  listener: string; env: string; roadDist: number; exhaust: number; intake: number; mech: number;
  master: number; fanSound: boolean; saSound: boolean; ambSound: boolean; dynamics: 'real' | 'arcade'; air: number;
};

export type Carga = { notch: number; degrau: number; dinamometro: number; rpmAlvo: number; freio: boolean; jake: number; manual: number; dinamico: boolean; lentaBaixa: boolean; fRede: number };

export type EstadoDiesel = {
  spec: Spec;
  motor: MotorMontado & { tempos: number };
  presetId: string | null;
  familia: string;
  params: ParamsDiesel;
  eq: Equalizacao;
  tempMode: 'real' | 'fixed';
  observer: 'car' | 'road';
  carMic: string;
  ignicao: boolean;
  portador: Portador;
  carga: Carga;
  rev: number;
};

export type Lento = { agua: number; escape: string };
export type Telemetria = Record<string, any> & { rpm: number; theta: number; state: string };

const VALVE_MODES = ['closed', 'auto', 'sport', 'open'];
export const DRIVE_MODES: [string, string, string][] = [
  ['track', 'Pista', 'Sobe quase na rotação máxima e reduz cedo'],
  ['sport', 'Esportivo', 'Sobe alto e reduz em giro médio'],
  ['normal', 'Normal', 'Trocas em giro médio, como no dia a dia'],
  ['eco', 'Econômico', 'Sobe o mais cedo possível (caminhões carregados)'],
  ['auto', 'Automático', 'Decide pelo quanto você pisa'],
];

export const familyFor = (layout: string, n: number, tempos = 4) => familiaDiesel(layout, n, tempos);
const CARGA0: Carga = { notch: 0, degrau: 0, dinamometro: 0, rpmAlvo: 0, freio: false, jake: 6, manual: 0, dinamico: false, lentaBaixa: false, fRede: 60 };

export class ControleDiesel {
  estado: EstadoDiesel;
  lento: Lento = { agua: 20, escape: '' };
  audio: CadeiaDeAudio | null = null;
  iniciarAudio: (() => Promise<CadeiaDeAudio>) | null = null;
  tele: Telemetria = { rpm: 0, theta: 0, state: 'off' };
  input = { key: 0, half: false, pad: 0, brake: 0 };
  ignitionAt = 0;
  pedal: HTMLElement | null = null;
  pedalFill: HTMLElement | null = null;
  private rebuildTimer: ReturnType<typeof setTimeout> | undefined;
  private iniciando: Promise<CadeiaDeAudio> | null = null;
  private ouvintes = new Set<() => void>();
  private ouvintesLentos = new Set<() => void>();

  constructor() {
    const p = PRESETS[0];
    const spec = { ...PADRAO_DIESEL, ...p } as Spec;
    this.estado = {
      spec, motor: buildDiesel(spec), presetId: p.id, familia: p.family,
      params: { listener: 'ext', env: 'open', roadDist: 6, exhaust: 1, intake: 1, mech: 1, master: 0.8, fanSound: true, saSound: true, ambSound: true, dynamics: 'real', air: 1 },
      eq: { lo: 0, mid: 0, hi: 0 }, tempMode: 'real', observer: 'car', carMic: 'ext', ignicao: false,
      portador: p.portadores[0], carga: { ...CARGA0, jake: p.jakeCilindros?.[p.jakeCilindros.length - 1] ?? 6, fRede: p.gerador?.fRede ?? 60 }, rev: 0,
    };
  }

  // ---------------------------------------------------------------- store
  assinar = (f: () => void) => { this.ouvintes.add(f); return () => { this.ouvintes.delete(f); }; };
  obter = () => this.estado;
  assinarLento = (f: () => void) => { this.ouvintesLentos.add(f); return () => { this.ouvintesLentos.delete(f); }; };
  obterLento = () => this.lento;
  private mudar(p: Partial<EstadoDiesel>, render = false) {
    this.estado = { ...this.estado, ...p, rev: this.estado.rev + (render ? 1 : 0) };
    for (const f of this.ouvintes) f();
  }
  mudarLento(p: Partial<Lento>) { this.lento = { ...this.lento, ...p }; for (const f of this.ouvintesLentos) f(); }
  private get spec() { return this.estado.spec; }
  private get params() { return this.estado.params; }
  private enviarParams() { this.audio?.send({ type: 'params', params: this.params }); }
  // estado de carga e portador inteiro para o DSP (depois de cada config, o DSP volta ao do preset)
  private enviarCarga() {
    const c = this.estado.carga;
    this.audio?.send({ type: 'diesel', portador: this.estado.portador, notch: c.notch, degrau: c.degrau, cargaBancada: c.dinamometro, rpmAlvo: c.rpmAlvo,
      freioMotor: c.freio, jakeCilindros: c.jake, manual: c.manual, dinamico: c.dinamico, lentaBaixa: c.lentaBaixa, fRede: c.fRede });
  }

  // ---------------------------------------------------------------- áudio
  async initAudio(): Promise<CadeiaDeAudio> {
    if (this.audio) return this.audio;
    if (!this.iniciando) {
      this.iniciando = (async () => {
        if (!this.iniciarAudio) throw new Error('áudio ainda não disponível');
        const a = await this.iniciarAudio();
        this.audio = a;
        a.aplicarEq(this.estado.eq);
        this.enviarParams();
        a.send({ type: 'config', cfg: configCalibrada(this.spec, a.ctx.sampleRate) });
        this.enviarParams();
        this.enviarCarga();
        a.send({ type: 'input', temp: { mode: this.estado.tempMode } });
        return a;
      })().catch((e) => { this.iniciando = null; throw e; });
    }
    return this.iniciando;
  }

  setEnvironment(kind: string) {
    this.mudar({ params: { ...this.params, env: kind } }, true);
    this.audio?.setAmbienteEParams(kind, this.params);
  }
  setParams(p: Partial<ParamsDiesel>, render = false) { this.mudar({ params: { ...this.params, ...p } }, render); this.enviarParams(); }
  setEq(p: Partial<Equalizacao>, render = false) { const eq = { ...this.estado.eq, ...p }; this.mudar({ eq }, render); this.audio?.aplicarEq(eq); }
  private setListener(observer = this.estado.observer, carMic = this.estado.carMic) {
    const params = { ...this.params, listener: observer === 'road' ? 'road' : carMic };
    this.mudar({ observer, carMic, params }, true);
    this.enviarParams();
    this.audio?.aplicarOuvinte(params.listener);
  }
  setObserver(v: 'car' | 'road') { this.setListener(v); }
  setCarMic(v: string) { this.setListener(this.estado.observer, v); }
  nextMic() { const order = ['pipe', 'ext', 'int', 'bay']; this.setListener('car', order[(order.indexOf(this.estado.carMic) + 1) % 4]); }

  // ---------------------------------------------------------------- motor
  private pushConfig(structural: boolean, fresh = false) {
    const audio = this.audio;
    if (!audio) return;
    if (structural) {
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = setTimeout(() => { audio.send({ type: 'config', cfg: { ...configCalibrada(this.spec, audio.ctx.sampleRate), fresh } }); this.enviarCarga(); }, 60);
    } else audio.send({ type: 'tune', cfg: montarConfig(this.spec) });
  }
  setSpec(patch: Partial<Spec>, { structural = true, render = true } = {}) {
    const spec = { ...this.spec, ...patch } as Spec;
    this.mudar({ spec, motor: buildDiesel(spec), presetId: null }, render);
    this.pushConfig(structural);
  }
  previewSpec(patch: Partial<Spec>) { const spec = { ...this.spec, ...patch } as Spec; this.mudar({ spec, motor: buildDiesel(spec) }); }
  tuneSpec(patch: Partial<Spec>) { const spec = { ...this.spec, ...patch } as Spec; this.mudar({ spec, motor: buildDiesel(spec) }); this.pushConfig(false); }

  loadPreset(p: PresetDiesel) {
    const spec = { ...PADRAO_DIESEL, ...p } as Spec;
    const portador = portadorAoTrocar(p, this.estado.portador);
    const carga = { ...this.estado.carga, notch: 0, degrau: 0, dinamometro: 0, rpmAlvo: 0, jake: p.jakeCilindros?.[p.jakeCilindros.length - 1] ?? 6, fRede: p.gerador?.fRede ?? 60, freio: false };
    this.mudar({ spec, motor: buildDiesel(spec), presetId: p.id, portador, carga }, true);
    this.pushConfig(true, true);
  }
  setFamilia(id: string) { this.mudar({ familia: id }); }

  setValve(v: string) { const was = this.spec.valve || 'none'; this.setSpec({ valve: v }, { structural: (was === 'none') !== (v === 'none') }); }
  cycleValve() { const v = this.spec.valve || 'none'; this.setValve(v === 'none' ? 'open' : VALVE_MODES[(VALVE_MODES.indexOf(v) + 1) % VALVE_MODES.length]); }
  cycleDriveMode() { const i = DRIVE_MODES.findIndex(([v]) => v === (this.spec.driveMode || 'auto')); this.setSpec({ driveMode: DRIVE_MODES[(i + 1) % DRIVE_MODES.length][0] }, { structural: false }); }
  currentRatios(): number[] { const s = this.spec; return s.ratios && s.ratios.length === s.gears ? s.ratios.slice() : gearRatios(s.gears || 6).slice(1); }

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

  // ---------------------------------------------------------------- temperatura e condução
  setTempMode(v: 'real' | 'fixed') { this.mudar({ tempMode: v }, true); this.audio?.send({ type: 'input', temp: { mode: v, value: this.tele.coolant ?? 20 } }); }
  setCoolant(v: number) { this.audio?.send({ type: 'input', temp: { value: v } }); }
  sendInput() {
    if (!this.audio) return;
    const i = this.input;
    const thr = Math.max(i.key * (i.half ? 0.4 : 1), i.pad);
    this.audio.send({ type: 'input', throttle: thr, brake: i.brake });
    if (this.pedalFill) this.pedalFill.style.height = `${thr * 100}%`;
    this.pedal?.setAttribute('aria-valuenow', String(Math.round(thr * 100)));
  }
  async setIgnition(on: boolean) {
    const audio = await this.initAudio();
    if (audio.ctx.state !== 'running') await audio.ctx.resume();
    this.mudar({ ignicao: on });
    audio.send({ type: 'input', ignition: on });
  }
  toggleIgnition() { this.ignitionAt = performance.now(); return this.setIgnition(!this.estado.ignicao); }
  shift(dir: number) { if (this.estado.portador === 'carro') this.audio?.send({ type: 'input', shift: dir }); }

  aoTelemetria = (m: any) => {
    if (m.type !== 'telemetry') return;
    const pt = m.ptheta || this.tele.ptheta;
    this.tele = m; this.tele.ptheta = pt; this.tele.t = performance.now();
    // apagou (as velas contam como ligado)
    if (this.estado.ignicao && m.state === 'off' && !(m.velas > 0) && m.rpm < 50 && performance.now() - this.ignitionAt > 1500) this.mudar({ ignicao: false });
  };
}

export { LAYOUTS };
