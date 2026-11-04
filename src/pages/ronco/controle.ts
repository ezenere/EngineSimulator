// Estado e ações da página do Ronco, fora do React (o equivalente às variáveis e funções soltas de
// src/app.js). O React lê um retrato imutável (`estado`) com useSyncExternalStore e só re-renderiza
// quando uma ação muda a especificação ou os parâmetros; a telemetria (~60 Hz) fica em `tele` e é
// desenhada pelo laço de requestAnimationFrame (mostradores.ts), sem passar pelo React.
//
// As mensagens mandadas ao DSP (params, config, tune, input) saem na mesma ordem e com o mesmo
// conteúdo de src/app.js.
import { build, CRANKS, LAYOUTS, type MotorMontado } from '../../engines/ronco/geometria';
import { PRESETS, ACESSORIOS_PADRAO, type PresetRonco } from '../../engines/ronco/presets';
import { gearRatios } from '../../engines/ronco/dsp';
import { configCalibrada } from '../../engines/ronco/config';
import type { CadeiaDeAudio, Equalizacao } from '../../ui';

export type Spec = PresetRonco & Record<string, any>;

export type ParamsRonco = {
  listener: string; env: string; roadDist: number; exhaust: number; intake: number; mech: number;
  master: number; fanSound: boolean; saSound: boolean; ambSound: boolean; dynamics: 'real' | 'arcade'; air: number;
};

export type EstadoRonco = {
  spec: Spec;
  motor: MotorMontado; // G.build(spec): geometria para a leitura e os mostradores
  presetId: string | null; // null: o usuário mexeu em algo e nenhum preset está marcado
  familia: string;
  params: ParamsRonco;
  eq: Equalizacao;
  tempMode: 'real' | 'fixed';
  observer: 'car' | 'road';
  carMic: string;
  ignicao: boolean;
  // conta as vezes em que o legado chamaria renderControls(): campos com estado próprio (a ordem
  // de ignição digitada) voltam ao valor da especificação quando ela muda
  rev: number;
};

// leituras lentas da telemetria que aparecem no painel (só mudam quando o grau muda)
export type Lento = { agua: number; escape: string };

export type Telemetria = Record<string, any> & { rpm: number; theta: number; kmh: number; gear: number; boost: number; thr: number; limiter: boolean; state: string; torque: number; t?: number };

// B: silencioso → normal → esportivo → pista (sem válvula instalada, instala aberta)
const VALVE_MODES = ['closed', 'auto', 'sport', 'open'];

export const DRIVE_MODES: [string, string, string][] = [
  ['track', 'Pista', 'Sobe quase no corte e reduz cedo: o motor fica sempre cheio'],
  ['sport', 'Esportivo', 'Sobe alto e reduz em giro médio'],
  ['normal', 'Normal', 'Trocas em giro médio, como no dia a dia'],
  ['eco', 'Econômico', 'Sobe o mais cedo possível e reduz quase na lenta'],
  ['auto', 'Automático', 'Decide pelo quanto você pisa: pouco acelerador troca cedo, pé no fundo estica'],
];

export const familyFor = (layout: string, n: number) => CRANKS[`${layout}-${n}`];

export class ControleRonco {
  estado: EstadoRonco;
  lento: Lento = { agua: 20, escape: '' };
  audio: CadeiaDeAudio | null = null;
  // cria a cadeia (AudioShell.iniciar); a página preenche
  iniciarAudio: (() => Promise<CadeiaDeAudio>) | null = null;
  tele: Telemetria = { rpm: 0, theta: 0, kmh: 0, gear: 0, boost: 0, thr: 0, limiter: false, state: 'off', torque: 0 };
  input = { key: 0, half: false, pad: 0, brake: 0 };
  ignitionAt = 0;
  // pedal na tela (preenchimento e aria-valuenow), atualizado direto no DOM como no legado
  pedal: HTMLElement | null = null;
  pedalFill: HTMLElement | null = null;
  private rebuildTimer: ReturnType<typeof setTimeout> | undefined;
  private iniciando: Promise<CadeiaDeAudio> | null = null;
  private ouvintes = new Set<() => void>();
  private ouvintesLentos = new Set<() => void>();

  constructor() {
    const spec = { ...PRESETS[0] } as Spec;
    this.estado = {
      spec, motor: build(spec), presetId: PRESETS[0].id, familia: PRESETS[0].family,
      params: { listener: 'ext', env: 'open', roadDist: 6, exhaust: 1, intake: 1, mech: 1, master: 0.8, fanSound: true, saSound: true, ambSound: true, dynamics: 'real', air: 1 },
      eq: { lo: 0, mid: 0, hi: 0 }, tempMode: 'real', observer: 'car', carMic: 'ext', ignicao: false, rev: 0,
    };
  }

  // ---------------------------------------------------------------- store
  assinar = (f: () => void) => { this.ouvintes.add(f); return () => { this.ouvintes.delete(f); }; };
  obter = () => this.estado;
  assinarLento = (f: () => void) => { this.ouvintesLentos.add(f); return () => { this.ouvintesLentos.delete(f); }; };
  obterLento = () => this.lento;
  private mudar(p: Partial<EstadoRonco>, render = false) {
    this.estado = { ...this.estado, ...p, rev: this.estado.rev + (render ? 1 : 0) };
    for (const f of this.ouvintes) f();
  }
  mudarLento(p: Partial<Lento>) {
    this.lento = { ...this.lento, ...p };
    for (const f of this.ouvintesLentos) f();
  }
  private get spec() { return this.estado.spec; }
  private get params() { return this.estado.params; }
  private enviarParams() { this.audio?.send({ type: 'params', params: this.params }); }

  // ---------------------------------------------------------------- áudio
  async initAudio(): Promise<CadeiaDeAudio> {
    if (this.audio) return this.audio;
    if (!this.iniciando) {
      this.iniciando = (async () => {
        if (!this.iniciarAudio) throw new Error('áudio ainda não disponível');
        // a cadeia já nasce com o ambiente e o ouvinte atuais (AudioShell lê as props da página)
        const a = await this.iniciarAudio();
        this.audio = a;
        a.aplicarEq(this.estado.eq);
        // setEnvironment(environment) do legado: a cadeia já trocou a resposta ao impulso
        this.enviarParams();
        a.send({ type: 'config', cfg: configCalibrada(this.spec, a.ctx.sampleRate) });
        this.enviarParams();
        a.send({ type: 'input', temp: { mode: this.estado.tempMode } });
        return a;
      })().catch((e) => { this.iniciando = null; throw e; });
    }
    return this.iniciando;
  }

  // troca o ambiente: params do DSP (som de fundo, comprimento da volta) e acústica da cadeia
  setEnvironment(kind: string) {
    this.mudar({ params: { ...this.params, env: kind } }, true);
    this.audio?.setAmbienteEParams(kind, this.params); // params, resposta ao impulso e acústica do ouvinte
  }

  setParams(p: Partial<ParamsRonco>, render = false) {
    this.mudar({ params: { ...this.params, ...p } }, render);
    this.enviarParams();
  }

  setEq(p: Partial<Equalizacao>, render = false) {
    const eq = { ...this.estado.eq, ...p };
    this.mudar({ eq }, render);
    this.audio?.aplicarEq(eq);
  }

  private setListener(observer = this.estado.observer, carMic = this.estado.carMic) {
    const params = { ...this.params, listener: observer === 'road' ? 'road' : carMic };
    this.mudar({ observer, carMic, params }, true);
    this.enviarParams();
    this.audio?.aplicarOuvinte(params.listener);
  }
  setObserver(v: 'car' | 'road') { this.setListener(v); }
  setCarMic(v: string) { this.setListener(this.estado.observer, v); }
  // C: próximo microfone junto ao carro
  nextMic() { const order = ['pipe', 'ext', 'int', 'bay']; this.setListener('car', order[(order.indexOf(this.estado.carMic) + 1) % 4]); }

  // ---------------------------------------------------------------- motor
  private pushConfig(structural: boolean, fresh = false) {
    // (a geometria já foi refeita junto com a especificação)
    const audio = this.audio;
    if (!audio) return;
    if (structural) {
      clearTimeout(this.rebuildTimer);
      // carro novo com o motor ligado: ele dá a partida do zero
      this.rebuildTimer = setTimeout(() => audio.send({ type: 'config', cfg: { ...configCalibrada(this.spec, audio.ctx.sampleRate), fresh } }), 60);
    } else {
      audio.send({ type: 'tune', cfg: { ...this.spec } });
    }
  }

  setSpec(patch: Partial<Spec>, { structural = true, render = true } = {}) {
    const spec = { ...this.spec, ...patch } as Spec;
    this.mudar({ spec, motor: build(spec), presetId: null }, render);
    this.pushConfig(structural);
  }

  // muda a especificação só na tela (o ângulo do V enquanto o controle é arrastado)
  previewSpec(patch: Partial<Spec>) {
    const spec = { ...this.spec, ...patch } as Spec;
    this.mudar({ spec, motor: build(spec) });
  }

  // cilindrada arrastando: só os parâmetros escalares (tune), sem reconstruir a acústica
  tuneSpec(patch: Partial<Spec>) {
    const spec = { ...this.spec, ...patch } as Spec;
    this.mudar({ spec, motor: build(spec) });
    this.pushConfig(false);
  }

  loadPreset(p: PresetRonco) {
    // cada carro vem com o próprio escape: acessórios que ele não define voltam ao padrão
    const spec = { ...ACESSORIOS_PADRAO, ...p } as Spec;
    this.mudar({ spec, motor: build(spec), presetId: p.id }, true);
    this.pushConfig(true, true);
  }

  setFamilia(id: string) { this.mudar({ familia: id }); }

  // trocar entre fechada/automática/aberta é só comando; instalar ou tirar muda o escape
  setValve(v: string) {
    const was = this.spec.valve || 'none';
    this.setSpec({ valve: v }, { structural: (was === 'none') !== (v === 'none') });
  }
  cycleValve() {
    const v = this.spec.valve || 'none';
    this.setValve(v === 'none' ? 'open' : VALVE_MODES[(VALVE_MODES.indexOf(v) + 1) % VALVE_MODES.length]);
  }

  // M: próximo modo do câmbio automático
  cycleDriveMode() {
    const i = DRIVE_MODES.findIndex(([v]) => v === (this.spec.driveMode || 'auto'));
    this.setSpec({ driveMode: DRIVE_MODES[(i + 1) % DRIVE_MODES.length][0] }, { structural: false });
  }

  // relações atuais (as do preset/escalonamento padrão até o usuário mexer)
  currentRatios(): number[] {
    const s = this.spec;
    return s.ratios && s.ratios.length === s.gears ? s.ratios.slice() : gearRatios(s.gears).slice(1);
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

  // ---------------------------------------------------------------- temperatura
  setTempMode(v: 'real' | 'fixed') {
    this.mudar({ tempMode: v }, true);
    this.audio?.send({ type: 'input', temp: { mode: v, value: this.tele.coolant ?? 20 } });
  }
  setCoolant(v: number) { this.audio?.send({ type: 'input', temp: { value: v } }); }

  // ---------------------------------------------------------------- condução
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

  shift(dir: number) { this.audio?.send({ type: 'input', shift: dir }); }

  aoTelemetria = (m: any) => {
    if (m.type !== 'telemetry') return;
    this.tele = m; this.tele.t = performance.now();
    if (this.estado.ignicao && m.state === 'off' && m.rpm < 50 && performance.now() - this.ignitionAt > 1500) {
      // motor morreu
      this.mudar({ ignicao: false });
    }
  };
}
