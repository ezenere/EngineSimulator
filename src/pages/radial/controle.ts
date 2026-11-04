// Estado e ações da página do Radial, fora do React (o mesmo padrão de src/pages/ronco/controle.ts e da Diesel). O React
// lê um retrato imutável (`estado`) com useSyncExternalStore; a telemetria fica em `tele` e é desenhada no
// requestAnimationFrame (os mostradores do Ronco, mais as leituras de aviação). Mensagens ao DSP: as do Ronco (params,
// config, input) e `{ type: 'av', … }` (magnetos, mistura, passo, coletivo, embreagem, primer, partida, superalimentador).
import { buildRadial, type MotorRadial } from '../../engines/radial/geometria';
import { PRESETS_RADIAL, PADRAO_RADIAL, type PresetRadial } from '../../engines/radial/presets';
import { configCalibrada } from '../../engines/radial/config';
import { segurarManete, type CadeiaDeAudio, type Equalizacao, type MarcaManete } from '../../ui';
import { AV_PADRAO, proximoMagneto, type EstadoAv } from '../comum/Aviacao';

export type Spec = PresetRadial & Record<string, any>;
export type ParamsRadial = {
  listener: string; env: string; roadDist: number; exhaust: number; intake: number; mech: number;
  master: number; fanSound: boolean; saSound: boolean; ambSound: boolean; dynamics: 'real' | 'arcade'; air: number;
};
export type EstadoRadial = {
  spec: Spec; motor: MotorRadial; presetId: string | null; familia: string; params: ParamsRadial; eq: Equalizacao;
  tempMode: 'real' | 'fixed'; observer: 'car' | 'road'; carMic: string; ignicao: boolean; av: EstadoAv; rev: number;
  /** fase da partida e magnetos vindos da telemetria (o botão muda de rótulo: energizar → engatar → magnetos → desligar) */
  fase?: string; magnetosTele?: string;
};
export type Lento = { agua: number; escape: string };

/** posições da manete de um avião a pistão (teclas 1–4 e botões): lenta, cruzeiro (~65%), subida (~85%), decolagem */
export const POSICOES_MANETE: [number, string, string][] = [[0, 'lenta', '1 · lenta'], [0.65, 'cruzeiro', '2 · cruzeiro'], [0.85, 'subida', '3 · subida'], [1, 'deco', '4 · decolagem']];
export const MARCAS_MANETE: MarcaManete[] = POSICOES_MANETE.map(([v, r]) => [v, r]);
export type Telemetria = Record<string, any> & { rpm: number; theta: number; state: string };

/** especificação completa de um preset: padrões do radial, a ficha e o `redline` que os mostradores do Ronco leem */
export const specDe = (p: PresetRadial): Spec => ({ ...PADRAO_RADIAL, ...p, redline: p.rpmMax } as Spec);

export class ControleRadial {
  estado: EstadoRadial;
  lento: Lento = { agua: 20, escape: '' };
  audio: CadeiaDeAudio | null = null;
  iniciarAudio: (() => Promise<CadeiaDeAudio>) | null = null;
  tele: Telemetria = { rpm: 0, theta: 0, state: 'off' };
  input = { key: 0, half: false, pad: 0, brake: 0 };
  /** manete de potência (aviões e helicóptero): fica onde foi deixada; W/S e ↑/↓ seguradas a movem aos poucos */
  manete = 0;
  teclas = { up: 0, down: 0 };
  ignitionAt = 0;
  pedal: HTMLElement | null = null;
  pedalFill: HTMLElement | null = null;
  private rebuildTimer: ReturnType<typeof setTimeout> | undefined;
  private iniciando: Promise<CadeiaDeAudio> | null = null;
  private ouvintes = new Set<() => void>();
  private ouvintesLentos = new Set<() => void>();
  private ouvintesManete = new Set<() => void>();

  constructor() {
    const p = PRESETS_RADIAL[0];
    const spec = specDe(p);
    this.estado = {
      spec, motor: buildRadial(spec), presetId: p.id, familia: p.family,
      params: { listener: 'ext', env: 'open', roadDist: 12, exhaust: 1, intake: 1, mech: 1, master: 0.8, fanSound: true, saSound: true, ambSound: true, dynamics: 'real', air: 1 },
      eq: { lo: 0, mid: 0, hi: 0 }, tempMode: 'real', observer: 'car', carMic: 'ext', ignicao: false, av: { ...AV_PADRAO }, rev: 0,
    };
  }

  // ---------------------------------------------------------------- store
  assinar = (f: () => void) => { this.ouvintes.add(f); return () => { this.ouvintes.delete(f); }; };
  obter = () => this.estado;
  assinarLento = (f: () => void) => { this.ouvintesLentos.add(f); return () => { this.ouvintesLentos.delete(f); }; };
  obterLento = () => this.lento;
  private mudar(p: Partial<EstadoRadial>, render = false) { this.estado = { ...this.estado, ...p, rev: this.estado.rev + (render ? 1 : 0) }; for (const f of this.ouvintes) f(); }
  mudarLento(p: Partial<Lento>) { this.lento = { ...this.lento, ...p }; for (const f of this.ouvintesLentos) f(); }
  assinarManete = (f: () => void) => { this.ouvintesManete.add(f); return () => { this.ouvintesManete.delete(f); }; };
  obterManete = () => this.manete;
  get spec() { return this.estado.spec; }
  /** com hélice ou rotor o comando de potência é a manete; no tanque, no carro e na moto, o pedal */
  get comManete() { return !(this.spec.portadores || []).includes('carro'); }
  private get params() { return this.estado.params; }
  private enviarParams() { this.audio?.send({ type: 'params', params: this.params }); }
  // (os magnetos ficam no automático, que liga na 9ª pá, até o usuário mexer neles)
  private enviarAv() { this.audio?.send({ type: 'av', ...this.estado.av, magAuto: true }); }

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
        this.enviarAv();
        a.send({ type: 'input', temp: { mode: this.estado.tempMode } });
        this.sendInput();
        return a;
      })().catch((e) => { this.iniciando = null; throw e; });
    }
    return this.iniciando;
  }
  setEnvironment(kind: string) { this.mudar({ params: { ...this.params, env: kind } }, true); this.audio?.setAmbienteEParams(kind, this.params); }
  setParams(p: Partial<ParamsRadial>, render = false) { this.mudar({ params: { ...this.params, ...p } }, render); this.enviarParams(); }
  setEq(p: Partial<Equalizacao>, render = false) { const eq = { ...this.estado.eq, ...p }; this.mudar({ eq }, render); this.audio?.aplicarEq(eq); }
  setCarMic(v: string) {
    const params = { ...this.params, listener: v };
    this.mudar({ carMic: v, observer: 'car', params }, true);
    this.enviarParams(); this.audio?.aplicarOuvinte(v);
  }
  nextMic() { const o = ['pipe', 'ext', 'int', 'bay']; this.setCarMic(o[(o.indexOf(this.estado.carMic) + 1) % 4]); }

  // ---------------------------------------------------------------- motor
  private pushConfig(fresh = false) {
    const audio = this.audio;
    if (!audio) return;
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => { audio.send({ type: 'config', cfg: { ...configCalibrada(this.spec, audio.ctx.sampleRate), fresh } }); this.enviarAv(); }, 60);
  }
  setSpec(patch: Partial<Spec>) {
    const spec = { ...this.spec, ...patch } as Spec;
    if (patch.rpmMax) spec.redline = patch.rpmMax;
    let motor: MotorRadial;
    try { motor = buildRadial(spec); } catch { return; }
    this.mudar({ spec, motor, presetId: null }, true);
    this.pushConfig();
  }
  setEscape(patch: Record<string, any>) { this.setSpec({ escape: { ...this.spec.escape, ...patch } } as Partial<Spec>); }
  /** fileiras × cilindros: 1 × 3/5/7/9, 2 × 7/9 (14, 18), 4 × 7 (28) */
  setArranjo(rows: number, porFileira: number) {
    const N = rows * porFileira;
    const ordens: Record<number, string | undefined> = { 3: '1-3-2', 5: '1-3-5-2-4', 7: '1-3-5-7-2-4-6', 9: '1-3-5-7-9-2-4-6-8', 14: '1-10-5-14-9-4-13-8-3-12-7-2-11-6', 18: '1-12-5-16-9-2-13-6-17-10-3-14-7-18-11-4-15-8' };
    const esc = { ...this.spec.escape };
    if (rows === 1) { delete esc.porFileira; delete esc.juntar; delete esc.turbina; }
    if (rows === 4 && esc.tipo === 'anel') esc.juntar = [[0, 1], [2, 3]];
    this.setSpec({ cylinders: N, rows, cylPerRow: porFileira, crank: rows === 4 ? 'mestra4' : 'mestra', order: ordens[N], escape: esc } as Partial<Spec>);
  }
  loadPreset(p: PresetRadial) {
    const spec = specDe(p);
    const av = { ...AV_PADRAO, magnetos: p.magnetosPadrao || 'ambos', mistura: p.misturaPadrao ?? 0.8 };
    // (motor novo começa parado: a partida de um radial é um procedimento, não um giro automático)
    this.audio?.send({ type: 'input', ignition: false });
    this.mudar({ spec, motor: buildRadial(spec), presetId: p.id, av, ignicao: false }, true);
    this.pushConfig(true);
    // (do avião para o tanque e de volta: o comando de potência muda de manete para pedal)
    this.sendInput();
  }
  setFamilia(id: string) { this.mudar({ familia: id }); }

  // ---------------------------------------------------------------- aviação
  setAv(p: Partial<EstadoAv>) { this.mudar({ av: { ...this.estado.av, ...p } }, true); this.audio?.send({ type: 'av', ...p }); }
  cycleMagnetos() { this.setAv({ magnetos: proximoMagneto(this.estado.av.magnetos) }); }
  stepMistura(d: number) { this.setAv({ mistura: Math.min(1, Math.max(0, Math.round((this.estado.av.mistura + d) * 100) / 100)) }); }
  /** liga os magnetos à mão durante a partida (tecla I com o motor girando) */
  ligarMagnetos() { this.setAv({ magnetos: 'ambos' }); }

  // ---------------------------------------------------------------- temperatura e condução
  setTempMode(v: 'real' | 'fixed') { this.mudar({ tempMode: v }, true); this.audio?.send({ type: 'input', temp: { mode: v, value: this.tele.coolant ?? 20 } }); }
  setCoolant(v: number) { this.audio?.send({ type: 'input', temp: { value: v } }); }
  sendInput() {
    if (!this.audio) return;
    const i = this.input;
    const thr = this.comManete ? this.manete : Math.max(i.key * (i.half ? 0.4 : 1), i.pad);
    this.audio.send({ type: 'input', throttle: thr, brake: i.brake });
    if (this.comManete) return;
    if (this.pedalFill) this.pedalFill.style.height = `${thr * 100}%`;
    this.pedal?.setAttribute('aria-valuenow', String(Math.round(thr * 100)));
  }
  /** manete de potência: a posição fica até o usuário mudar (como a da Turbina) */
  setManete(v: number) {
    const m = Math.min(1, Math.max(0, v));
    if (m === this.manete) return;
    this.manete = m;
    for (const f of this.ouvintesManete) f();
    this.sendInput();
  }
  /** a cada quadro: W/S e ↑/↓ seguradas movem a manete aos poucos */
  segurar(dt: number) {
    const v = segurarManete(this.teclas, this.manete, dt);
    if (v !== null) this.setManete(v);
  }
  async setIgnition(on: boolean) {
    const audio = await this.initAudio();
    if (audio.ctx.state !== 'running') await audio.ctx.resume();
    this.mudar({ ignicao: on });
    audio.send({ type: 'input', ignition: on });
  }
  /** botão de partida em fases: ENERGIZAR (inércia) → ENGATAR; ou GIRAR; com o motor girando sem magnetos, liga os magnetos */
  toggleIgnition() {
    this.ignitionAt = performance.now();
    const f = this.tele.fase;
    if (this.estado.ignicao && f === 'energizar') { this.audio?.send({ type: 'av', partida: 'engatar' }); return Promise.resolve(); }
    if (this.estado.ignicao && f === 'girar' && this.tele.magnetos === 'desligado') { this.ligarMagnetos(); return Promise.resolve(); }
    return this.setIgnition(!this.estado.ignicao);
  }
  shift(dir: number) { if ((this.spec.portadores || []).includes('carro')) this.audio?.send({ type: 'input', shift: dir }); }

  aoTelemetria = (m: any) => {
    if (m.type !== 'telemetry') return;
    this.tele = m; this.tele.t = performance.now();
    if (m.fase !== this.estado.fase || m.magnetos !== this.estado.magnetosTele) this.mudar({ fase: m.fase, magnetosTele: m.magnetos });
    if (this.estado.ignicao && m.state === 'off' && m.fase !== 'energizar' && m.rpm < 50 && performance.now() - this.ignitionAt > 3000) this.mudar({ ignicao: false });
  };
}
