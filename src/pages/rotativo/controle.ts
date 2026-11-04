// Estado e ações da página Rotativos, fora do React (o padrão de src/pages/ronco/controle.ts e das páginas Diesel e
// Radial). O React lê um retrato imutável (`estado`) com useSyncExternalStore; a telemetria fica em `tele` e é desenhada
// no requestAnimationFrame (os mostradores do Ronco mais o anel de 1 080° e o traço p–α). Mensagens ao DSP: as do Ronco
// (params, config, tune, input), `{ type: 'av', … }` nos presets de aviação e `{ type: 'palhetas', … }` no motor de
// palhetas. O worklet é um só (RotativosDSP): a configuração escolhe o Wankel/X-Engine ou o sintetizador de palhetas.
import { montarRotativo, type MotorRotativo } from '../../engines/rotativo/geometria';
import { PRESETS_ROTATIVO, PADRAO_ROTATIVO, type PresetRotativo } from '../../engines/rotativo/presets';
import { configCalibrada, montarConfig } from '../../engines/rotativo/config';
import { gearRatios } from '../../engines/ronco/dsp';
import type { CadeiaDeAudio, Equalizacao } from '../../ui';
import { AV_PADRAO, proximoMagneto, type EstadoAv } from '../comum/Aviacao';

export type Spec = PresetRotativo & Record<string, any>;
export type ParamsRot = {
  listener: string; env: string; roadDist: number; exhaust: number; intake: number; mech: number;
  master: number; fanSound: boolean; saSound: boolean; ambSound: boolean; dynamics: 'real' | 'arcade'; air: number;
};
export type EstadoPalhetas = { modo: 'ferramenta' | 'arranque'; pIn: number; carga: number };
export type EstadoRot = {
  spec: Spec; motor: MotorRotativo | null; presetId: string | null; familia: string; params: ParamsRot; eq: Equalizacao;
  tempMode: 'real' | 'fixed'; observer: 'car' | 'road'; carMic: string; ignicao: boolean; av: EstadoAv; pal: EstadoPalhetas; rev: number;
};
export type Lento = { agua: number; escape: string };
export type Telemetria = Record<string, any> & { rpm: number; theta: number; state: string };

/** especificação completa de um preset: padrões do rotativo e o `redline` que os mostradores do Ronco leem */
export const specDe = (p: PresetRotativo): Spec => ({ ...PADRAO_ROTATIVO, ...p, redline: p.rpmMax } as Spec);
const geometria = (s: Spec) => (s.tipo === 'palhetas' ? null : montarRotativo(s));
const VALVE_MODES = ['closed', 'auto', 'sport', 'open'];

export class ControleRotativo {
  estado: EstadoRot;
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
    const p = PRESETS_ROTATIVO[0];
    const spec = specDe(p);
    this.estado = {
      spec, motor: geometria(spec), presetId: p.id, familia: p.family,
      params: { listener: 'ext', env: 'open', roadDist: 6, exhaust: 1, intake: 1, mech: 1, master: 0.8, fanSound: true, saSound: true, ambSound: true, dynamics: 'real', air: 1 },
      eq: { lo: 0, mid: 0, hi: 0 }, tempMode: 'real', observer: 'car', carMic: 'ext', ignicao: false, av: { ...AV_PADRAO }, pal: palDe(spec), rev: 0,
    };
  }

  // ---------------------------------------------------------------- store
  assinar = (f: () => void) => { this.ouvintes.add(f); return () => { this.ouvintes.delete(f); }; };
  obter = () => this.estado;
  assinarLento = (f: () => void) => { this.ouvintesLentos.add(f); return () => { this.ouvintesLentos.delete(f); }; };
  obterLento = () => this.lento;
  private mudar(p: Partial<EstadoRot>, render = false) { this.estado = { ...this.estado, ...p, rev: this.estado.rev + (render ? 1 : 0) }; for (const f of this.ouvintes) f(); }
  mudarLento(p: Partial<Lento>) { this.lento = { ...this.lento, ...p }; for (const f of this.ouvintesLentos) f(); }
  get spec() { return this.estado.spec; }
  get palhetas() { return this.spec.tipo === 'palhetas'; }
  private get params() { return this.estado.params; }
  private enviarParams() { this.audio?.send({ type: 'params', params: this.params }); }
  private enviarAv() { if (this.spec.aviation) this.audio?.send({ type: 'av', ...this.estado.av }); }
  private enviarPal() { if (this.palhetas) this.audio?.send({ type: 'palhetas', ...this.estado.pal }); }
  /** configuração para o worklet: Wankel/X calibrado na thread principal; palhetas, o preset cru */
  private cfgPara(sr: number, fresh = false) {
    if (this.palhetas) return { ...this.spec, modoPalhetas: this.estado.pal.modo, fresh };
    return { ...configCalibrada(this.spec, sr), fresh };
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
        a.send({ type: 'config', cfg: this.cfgPara(a.ctx.sampleRate) });
        this.enviarParams(); this.enviarAv(); this.enviarPal();
        a.send({ type: 'input', temp: { mode: this.estado.tempMode } });
        return a;
      })().catch((e) => { this.iniciando = null; throw e; });
    }
    return this.iniciando;
  }
  setEnvironment(kind: string) { this.mudar({ params: { ...this.params, env: kind } }, true); this.audio?.setAmbienteEParams(kind, this.params); }
  setParams(p: Partial<ParamsRot>, render = false) { this.mudar({ params: { ...this.params, ...p } }, render); this.enviarParams(); }
  setEq(p: Partial<Equalizacao>, render = false) { const eq = { ...this.estado.eq, ...p }; this.mudar({ eq }, render); this.audio?.aplicarEq(eq); }
  private setListener(observer = this.estado.observer, carMic = this.estado.carMic) {
    const params = { ...this.params, listener: observer === 'road' ? 'road' : carMic };
    this.mudar({ observer, carMic, params }, true);
    this.enviarParams(); this.audio?.aplicarOuvinte(params.listener);
  }
  setObserver(v: 'car' | 'road') { this.setListener(v); }
  setCarMic(v: string) { this.setListener(this.estado.observer, v); }
  nextMic() { const o = ['pipe', 'ext', 'int', 'bay']; this.setListener('car', o[(o.indexOf(this.estado.carMic) + 1) % 4]); }

  // ---------------------------------------------------------------- motor
  private pushConfig(structural: boolean, fresh = false) {
    const audio = this.audio;
    if (!audio) return;
    if (structural || this.palhetas) {
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = setTimeout(() => { audio.send({ type: 'config', cfg: this.cfgPara(audio.ctx.sampleRate, fresh) }); this.enviarAv(); this.enviarPal(); }, 60);
    } else audio.send({ type: 'tune', cfg: montarConfig(this.spec) });
  }
  setSpec(patch: Partial<Spec>, { structural = true, render = true } = {}) {
    const spec = { ...this.spec, ...patch } as Spec;
    if (patch.rpmMax) spec.redline = patch.rpmMax;
    let motor: MotorRotativo | null;
    try { motor = geometria(spec); } catch { return; }
    this.mudar({ spec, motor, presetId: null }, render);
    this.pushConfig(structural);
  }
  setGeo(p: Partial<{ R: number; e: number; b: number }>) { this.setSpec({ geo: { ...(this.spec.geo || { R: 105, e: 15, b: 80 }), ...p } }); }
  setJanelas(p: Partial<Spec['janelas']>) { this.setSpec({ janelas: { ...this.spec.janelas, ...p } as Spec['janelas'] }); }
  setEscape(p: Record<string, any>) { this.setSpec({ escape: { ...this.spec.escape, ...p } }); }
  setTurbo(p: Record<string, any>) { const t = { sequencial: false, boost: 0.6, ...(this.spec.turbo || {}), ...p }; this.setSpec({ turbo: t, aspiration: 'turbo', boost: t.boost }); }
  semTurbo() { this.setSpec({ turbo: undefined, aspiration: 'na', boost: 0 }); }
  loadPreset(p: PresetRotativo) {
    const spec = specDe(p);
    const av = { ...AV_PADRAO };
    this.mudar({ spec, motor: geometria(spec), presetId: p.id, av, pal: palDe(spec) }, true);
    this.pushConfig(true, true);
  }
  setFamilia(id: string) { this.mudar({ familia: id }); }
  setValve(v: string) { const was = this.spec.valve || 'none'; this.setSpec({ valve: v }, { structural: (was === 'none') !== (v === 'none') }); }
  cycleValve() { const v = this.spec.valve || 'none'; this.setValve(v === 'none' ? 'open' : VALVE_MODES[(VALVE_MODES.indexOf(v) + 1) % VALVE_MODES.length]); }
  currentRatios(): number[] { const s = this.spec; return s.ratios && s.ratios.length === s.gears ? s.ratios.slice() : gearRatios(s.gears || 5).slice(1); }

  // ---------------------------------------------------------------- aviação e palhetas
  setAv(p: Partial<EstadoAv>) { this.mudar({ av: { ...this.estado.av, ...p } }, true); this.audio?.send({ type: 'av', ...p }); }
  cycleMagnetos() { if (this.spec.aviation) this.setAv({ magnetos: proximoMagneto(this.estado.av.magnetos) }); }
  setPal(p: Partial<EstadoPalhetas>) {
    const pal = { ...this.estado.pal, ...p };
    if (p.modo && p.modo !== this.estado.pal.modo) {
      const k = this.spec.palhetas![p.modo];
      pal.pIn = k.pIn; pal.carga = 0;
      this.mudar({ pal, spec: { ...this.spec, rpmMax: k.nLivre, redline: k.nLivre } as Spec }, true);
      this.audio?.send({ type: 'input', ignition: false }); this.mudar({ ignicao: false });
    } else this.mudar({ pal }, true);
    this.audio?.send({ type: 'palhetas', ...p });
  }

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
  shift(dir: number) { if ((this.spec.portadores || []).includes('carro')) this.audio?.send({ type: 'input', shift: dir }); }

  aoTelemetria = (m: any) => {
    if (m.type !== 'telemetry') return;
    this.tele = m; this.tele.t = performance.now();
    if (this.estado.ignicao && !this.palhetas && m.state === 'off' && m.rpm < 50 && performance.now() - this.ignitionAt > 3000) this.mudar({ ignicao: false });
  };
}

function palDe(spec: Spec): EstadoPalhetas {
  const pa = spec.palhetas;
  if (!pa) return { modo: 'ferramenta', pIn: 6.3, carga: 0 };
  return { modo: pa.modo, pIn: pa[pa.modo].pIn, carga: 0 };
}
