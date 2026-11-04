// Estado e lógica da página da Turbina, fora do React (porte de src/jet-app.js).
//
// As funções do legado viraram métodos com os mesmos nomes e a mesma ordem de mensagens para o
// DSP. Onde o legado redesenhava um pedaço do DOM, aqui se "avisa" um tópico, e só os componentes
// que assinam aquele tópico renderizam de novo:
//   painel   → renderControls() (painel inteiro, montado de novo como no legado)
//   presets  → renderPresets()/markPreset()
//   placa    → updatePlate()
//   manete   → paintLever()/paintDetents()
//   ignicao  → paintIgnition()
//   mapa     → sliders de ângulo e distância quando se arrasta no mapa
// Telemetria não avisa ninguém: fica em `tele` e é desenhada no requestAnimationFrame.
import { useSyncExternalStore } from 'react';
import type { CadeiaDeAudio } from '../../ui';
import { JetDSP } from '../../engines/turbina/dsp';
import { PRESETS_TURBINA, type PresetTurbina } from '../../engines/turbina/presets';

export const PRESETS = PRESETS_TURBINA;
export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const fmt = (x: number, d = 0) => x.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
export const ARCH: Record<string, string> = { turbojet: 'Turbojato', turbofan: 'Turbofan', geared: 'Turbofan com redutor', turboprop: 'Turboélice' };
export const MAXT = 1.3;

export type Topico = 'painel' | 'presets' | 'placa' | 'manete' | 'ignicao' | 'mapa';
export type Params = { listener: string; env: string; angle: number; dist: number; seat: string; alt: number; speed: number; fan: number; core: number; jet: number; master: number };

export class ControleTurbina {
  spec: any = { ...PRESETS[0] };
  presetId: string | null = PRESETS[0].id;
  family = PRESETS[0].family;
  environment = 'runway';
  params: Params = { listener: 'ground', env: 'runway', angle: 90, dist: 40, seat: 'wing', alt: 150, speed: 300, fan: 1, core: 1, jet: 1, master: 0.8 };
  observer = 'ground';
  board = 'cabin';
  groundMode = 'ground';

  audio: CadeiaDeAudio | null = null;
  running = false;
  tla = 0;
  tlaSent = -1;
  reverser = false;
  tele: any = { state: 'off', n1: 0, n2: 0, np: 0, egt: 20, ff: 0, thrust: 0, spl: 0, ph: 0, phP: 0, f1: 0, fp: 0, Mt: 0, ab: 0, rev: 0 };
  held = { up: 0, down: 0 };

  // AudioShell.iniciar(), entregue pelo componente da página
  iniciar: (() => Promise<CadeiaDeAudio>) | null = null;
  private promessa: Promise<CadeiaDeAudio> | null = null;
  private rebuildTimer: ReturnType<typeof setTimeout> | undefined;

  // ---------------------------------------------------------- tópicos
  versao: Record<Topico, number> = { painel: 0, presets: 0, placa: 0, manete: 0, ignicao: 0, mapa: 0 };
  private ouvintes = new Set<() => void>();
  assinar = (fn: () => void) => { this.ouvintes.add(fn); return () => { this.ouvintes.delete(fn); }; };
  avisar(...ts: Topico[]) { for (const t of ts) this.versao[t]++; for (const fn of this.ouvintes) fn(); }

  // ------------------------------------------------------------ áudio
  // calibra o volume aqui para não travar a thread de áudio
  engineConfig(sr: number) {
    const cfg = { ...this.spec };
    const probe = new JetDSP(sr);
    probe.setConfig(cfg);
    cfg.gain = probe.cfgGain;
    return cfg;
  }

  // initAudio(): a cadeia é criada pelo AudioShell; aqui vai a mesma sequência de mensagens do legado
  async initAudio(): Promise<CadeiaDeAudio> {
    if (this.audio) return this.audio;
    if (!this.promessa) {
      this.promessa = this.iniciar!().then((a) => {
        this.audio = a;
        // setEnvironment(environment): params, resposta do ambiente e acústica do ouvinte
        a.send({ type: 'params', params: this.params });
        if (a.ambiente !== this.environment) a.setAmbiente(this.environment);
        if (a.ouvinte !== this.params.listener) a.aplicarOuvinte(this.params.listener);
        a.send({ type: 'config', cfg: this.engineConfig(a.ctx.sampleRate) });
        a.send({ type: 'params', params: this.params });
        a.send({ type: 'input', tla: this.tla, reverser: this.reverser });
        this.avisar('ignicao');
        return a;
      }, (e) => { this.promessa = null; throw e; });
    }
    return this.promessa;
  }

  setEnvironment(kind: string) {
    this.environment = kind;
    this.params.env = kind;
    // params, resposta ao impulso e acústica do ouvinte
    this.audio?.setAmbienteEParams(kind, this.params);
  }

  // A bordo o lugar lá fora chega abafado pela fuselagem (perfil da Turbina na CadeiaDeAudio).
  applyListenerAcoustics() {
    this.audio?.aplicarOuvinte(this.params.listener);
  }

  pushConfig(structural: boolean) {
    this.updatePlate();
    const audio = this.audio;
    if (!audio) return;
    if (structural) {
      clearTimeout(this.rebuildTimer);
      this.rebuildTimer = setTimeout(() => audio.send({ type: 'config', cfg: this.engineConfig(audio.ctx.sampleRate) }), 60);
    } else {
      audio.send({ type: 'tune', cfg: { ...this.spec } });
    }
  }

  sendParams() { this.audio?.send({ type: 'params', params: this.params }); }
  // muda parâmetros do ouvinte/mistura e manda ao DSP (o objeto é o mesmo, como no legado)
  setParam(patch: Partial<Params>) { Object.assign(this.params, patch); this.sendParams(); }

  setTla(v: number) {
    const s = this.spec;
    this.tla = clamp(v, 0, s.ab && s.arch !== 'turboprop' ? 1.3 : 1);
    this.paintLever();
    if (this.audio && Math.abs(this.tla - this.tlaSent) > 1e-4) { this.audio.send({ type: 'input', tla: this.tla }); this.tlaSent = this.tla; }
  }

  setReverser(on: boolean) {
    this.reverser = on;
    this.avisar('manete');
    this.audio?.send({ type: 'input', reverser: on });
  }

  async setRunning(on: boolean) {
    const audio = await this.initAudio();
    if (audio.ctx.state !== 'running') await audio.ctx.resume();
    this.running = on;
    audio.send({ type: 'input', start: on, tla: this.tla });
    this.paintIgnition();
  }

  paintIgnition() { this.avisar('ignicao'); }
  rotuloIgnicao() {
    const st = this.tele.state;
    return !this.running ? (st === 'stop' ? 'Desacelerando…' : 'Dar partida') : st === 'start' ? 'Partida em curso…' : 'Cortar motor';
  }

  onTelemetry = (m: any) => {
    if (m.type !== 'telemetry') return;
    const prev = this.tele.state;
    this.tele = m; this.tele.t = performance.now();
    if (prev !== m.state) this.paintIgnition();
  };

  // ------------------------------------------------------------ controles
  setSpec(patch: any, { structural = false, render = true } = {}) {
    Object.assign(this.spec, patch);
    this.presetId = null;
    this.markPreset();
    this.pushConfig(structural);
    if (render) this.renderControls();
  }
  // parâmetro escalar: atualiza o som ao arrastar, sem redesenhar o painel
  live = (key: string, structural = false) => (v: number) => this.setSpec({ [key]: v }, { structural, render: false });

  renderControls() { this.avisar('painel', 'manete'); }

  // Mach relativo na ponta do fan a 100% e situação do tom de passagem de pá (Tyler-Sofrin)
  fanFacts(s = this.spec) {
    const Ut = (Math.PI * s.fanD * s.n1Max) / 60;
    const Mt = Math.hypot(Ut / 340, 0.5);
    let m = Infinity;
    for (let k = -6; k <= 6; k++) m = Math.min(m, Math.abs(s.fanB - k * s.vanes));
    const bpf = (s.fanB * s.n1Max) / 60;
    return { Mt, m, bpf, cutSub: m > s.fanB };
  }

  setListener() {
    this.params.listener = this.observer === 'board' ? this.board : this.groundMode;
    this.sendParams();
    this.applyListenerAcoustics();
    this.renderControls();
  }

  setObserver(v: string) {
    this.observer = v;
    this.setListener();
  }

  // ------------------------------------------------------------ presets
  setFamily(f: string) { this.family = f; this.avisar('presets'); }
  markPreset() { this.avisar('presets'); }
  loadPreset(p: PresetTurbina) {
    this.spec = { ...p };
    if (this.tla > 1 && !this.spec.ab) this.setTla(1);
    if (this.spec.mount === 'fuselage' && this.board === 'cabin') {
      this.board = 'cockpit'; this.params.listener = this.observer === 'board' ? this.board : this.groundMode; this.sendParams();
      // a cadeia guarda o ouvinte (cabine e cockpit têm a mesma acústica: não muda o som)
      this.applyListenerAcoustics();
    }
    this.pushConfig(true);
    this.presetId = p.id;
    this.markPreset();
    this.renderControls();
    this.paintLever();
  }

  placa() {
    const s = this.spec, prop = s.arch === 'turboprop';
    const parts = [ARCH[s.arch], `${s.engines}×`];
    if (prop) parts.push(`hélice ${s.propB} pás`, `${fmt(s.propRpm)} rpm`);
    else parts.push(`${s.fanB} pás`, s.bpr > 0.2 && s.arch !== 'turbojet' ? `bypass ${fmt(s.bpr, 1)}` : 'sem bypass');
    parts.push(`${fmt(s.thrust)} kN${prop ? ' eq.' : ''}`);
    if (s.ab && !prop) parts.push('pós-combustão');
    return parts.join(' · ');
  }
  updatePlate() { this.avisar('placa'); }

  // ------------------------------------------------------------ manete
  paintLever() { this.avisar('manete'); }
  // posição da manete a partir do ponteiro sobre o trilho
  tlaFrom(e: { clientY: number }, trilho: HTMLElement) { const r = trilho.getBoundingClientRect(); return clamp(1 - (e.clientY - r.top) / r.height, 0, 1) * MAXT; }

  // ------------------------------------------------------------ entrada
  // manete segura: avança/recua enquanto a tecla estiver apertada (chamado a cada quadro)
  segurar(dt: number) {
    if (this.held.up || this.held.down) this.setTla(this.tla + (this.held.up - this.held.down) * dt * 0.45);
  }

  keydown = (e: KeyboardEvent) => {
    const alvo = e.target as HTMLInputElement | null;
    if (alvo && alvo.tagName === 'INPUT' && alvo.type === 'text') return;
    if (e.code === 'KeyW' || e.code === 'ArrowUp') { e.preventDefault(); this.held.up = 1; }
    else if (e.code === 'KeyS' || e.code === 'ArrowDown') { e.preventDefault(); this.held.down = 1; }
    else if (e.repeat) return;
    else if (e.code === 'Digit1') this.setTla(0);
    else if (e.code === 'Digit2') this.setTla(0.8);
    else if (e.code === 'Digit3') this.setTla(1);
    else if (e.code === 'Digit4') this.setTla(1.3);
    else if (e.code === 'KeyR') this.setReverser(!this.reverser);
    else if (e.code === 'KeyI') this.setRunning(!this.running);
    else if (e.code === 'KeyC') {
      if (this.observer === 'board') { const o = ['cabin', 'cockpit', 'wingcam']; this.board = o[(o.indexOf(this.board) + 1) % 3]; }
      else this.groundMode = this.groundMode === 'ground' ? 'flyby' : 'ground';
      this.setListener();
    } else if (e.code === 'KeyV') this.setObserver(this.observer === 'board' ? 'ground' : 'board');
  };
  keyup = (e: KeyboardEvent) => {
    if (e.code === 'KeyW' || e.code === 'ArrowUp') this.held.up = 0;
    else if (e.code === 'KeyS' || e.code === 'ArrowDown') this.held.down = 0;
  };
  blur = () => { this.held.up = 0; this.held.down = 0; };
}

// Assina um ou mais tópicos: o componente renderiza de novo quando algum deles é avisado.
export function useTopico(c: ControleTurbina, ...ts: Topico[]) {
  return useSyncExternalStore(c.assinar, () => ts.map((t) => c.versao[t]).join(','));
}
