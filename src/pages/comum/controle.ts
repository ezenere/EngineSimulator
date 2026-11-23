// O comum das quatro páginas a pistão (Ronco, Diesel, Radial e Rotativos), fora do React: o estado que o React lê com
// useSyncExternalStore (um retrato imutável, `estado`, que só muda quando uma ação muda a especificação ou os
// parâmetros), a telemetria (~60 Hz, em `tele`, desenhada pelo laço dos mostradores sem passar pelo React), a cadeia de
// áudio, a escuta (ambiente, ouvinte, mistura, equalização), a temperatura, o pedal e a manete de potência, a ignição e o
// envio da configuração ao DSP. Cada página estende `ControlePistao` com o que é da família: a especificação e a
// geometria (`montar`), o que o DSP perde a cada configuração e tem de receber de novo (`depoisDaConfig`: aviação,
// carga do portador, palhetas), o preset, o câmbio e o "motor apagou" de cada uma.
//
// As mensagens ao DSP (params, config, tune, input) saem na ordem e com o conteúdo de src/app.js (o legado do Ronco,
// commit 02c185f); as famílias acrescentam as suas (`av`, `diesel`, `palhetas`).
import { segurarManete, type CadeiaDeAudio, type Equalizacao, type MarcaManete } from '../../ui';
import { gearRatios } from '../../engines/ronco/dsp';

export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/** parâmetros de escuta mandados ao DSP (`{ type: 'params' }`) */
export type ParamsPistao = {
  listener: string; env: string; roadDist: number; exhaust: number; intake: number; mech: number;
  master: number; fanSound: boolean; saSound: boolean; ambSound: boolean; dynamics: 'real' | 'arcade'; air: number;
};
export const PARAMS_PADRAO: ParamsPistao = { listener: 'ext', env: 'open', roadDist: 6, exhaust: 1, intake: 1, mech: 1, master: 0.8, fanSound: true, saSound: true, ambSound: true, dynamics: 'real', air: 1 };

/** leituras lentas da telemetria que aparecem no painel (só mudam quando o grau muda) */
export type Lento = { agua: number; escape: string };

export type TelemetriaPistao = Record<string, any> & { rpm: number; theta: number; state: string; t?: number };

export type EstadoPistao<S, M> = {
  spec: S;
  motor: M; // a geometria, para a leitura e os mostradores
  presetId: string | null; // null: o usuário mexeu em algo e nenhum preset está marcado
  familia: string;
  params: ParamsPistao;
  eq: Equalizacao;
  tempMode: 'real' | 'fixed';
  observer: 'car' | 'road';
  carMic: string;
  ignicao: boolean;
  // conta as vezes em que o legado chamaria renderControls(): campos com estado próprio (a ordem de ignição digitada)
  // voltam ao valor da especificação quando ela muda
  rev: number;
};

/** o estado de uma página que acabou de abrir: o primeiro preset, ouvinte junto do motor, temperatura de verdade */
export function estadoInicial<S, M>(spec: S, motor: M, preset: { id: string; family: string }, params: Partial<ParamsPistao> = {}): EstadoPistao<S, M> {
  return {
    spec, motor, presetId: preset.id, familia: preset.family, params: { ...PARAMS_PADRAO, ...params },
    eq: { lo: 0, mid: 0, hi: 0 }, tempMode: 'real', observer: 'car', carMic: 'ext', ignicao: false, rev: 0,
  };
}

// B: silencioso → normal → esportivo → pista (sem válvula instalada, instala aberta)
const VALVE_MODES = ['closed', 'auto', 'sport', 'open'];

/** manete de potência (aviões e helicópteros do Ronco e do Radial): as posições das teclas 1–4 e dos botões */
export const POSICOES_MANETE: [number, string, string][] = [[0, 'lenta', '1 · lenta'], [0.65, 'cruzeiro', '2 · cruzeiro'], [0.85, 'subida', '3 · subida'], [1, 'deco', '4 · decolagem']];
export const MARCAS_MANETE: MarcaManete[] = POSICOES_MANETE.map(([v, r]) => [v, r]);

export abstract class ControlePistao<S extends Record<string, any>, M, E extends EstadoPistao<S, M>> {
  estado: E;
  lento: Lento = { agua: 20, escape: '' };
  audio: CadeiaDeAudio | null = null;
  // cria a cadeia (AudioShell.iniciar); a página preenche
  iniciarAudio: (() => Promise<CadeiaDeAudio>) | null = null;
  tele: TelemetriaPistao = { rpm: 0, theta: 0, state: 'off' };
  input = { key: 0, half: false, pad: 0, brake: 0 };
  /** manete de potência: fica onde foi deixada (como a da Turbina); W/S e ↑/↓ seguradas a movem aos poucos */
  manete = 0;
  teclas = { up: 0, down: 0 };
  ignitionAt = 0;
  // pedal na tela (preenchimento e aria-valuenow), atualizado direto no DOM como no legado
  pedal: HTMLElement | null = null;
  pedalFill: HTMLElement | null = null;
  /** marchas do escalonamento padrão quando a ficha não diz */
  protected marchasPadrao = 6;
  private rebuildTimer: ReturnType<typeof setTimeout> | undefined;
  // o "motor novo do zero" de um preset espera a configuração sair (ver pushConfig)
  private freshPendente = false;
  private iniciando: Promise<CadeiaDeAudio> | null = null;
  private ouvintes = new Set<() => void>();
  private ouvintesLentos = new Set<() => void>();
  private ouvintesManete = new Set<() => void>();

  constructor(estado: E) { this.estado = estado; }

  // ---------------------------------------------------------------- o que é da família
  /** a geometria da especificação (lança exceção se a combinação não existe) */
  protected abstract montar(spec: S): M;
  /** a configuração completa mandada ao DSP (`{ type: 'config' }`), sem o `fresh` */
  protected abstract configDoMotor(sr: number): Record<string, any>;
  /** a configuração leve (`{ type: 'tune' }`): só os parâmetros escalares, sem reconstruir a acústica */
  protected configLeve(): Record<string, any> { return { ...this.spec }; }
  /** o que o DSP perde a cada configuração e tem de receber de novo (aviação, carga do portador, palhetas) */
  protected depoisDaConfig() {}
  /** logo depois da cadeia nascer, com a configuração e a temperatura já no DSP */
  protected aoIniciarAudio() {}
  /** E / Q: sobe ou reduz a marcha, onde há câmbio (o veículo do portador) */
  abstract shift(dir: number): void;
  /** escolhe um preset da página: a especificação com os padrões da família e o estado que volta com ele; a configuração
   *  sai com `pushConfig(true, true)` (motor novo do zero) */
  abstract loadPreset(p: any): void;

  // ---------------------------------------------------------------- store
  assinar = (f: () => void) => { this.ouvintes.add(f); return () => { this.ouvintes.delete(f); }; };
  obter = () => this.estado;
  assinarLento = (f: () => void) => { this.ouvintesLentos.add(f); return () => { this.ouvintesLentos.delete(f); }; };
  obterLento = () => this.lento;
  protected mudar(p: Partial<E>, render = false) {
    this.estado = { ...this.estado, ...p, rev: this.estado.rev + (render ? 1 : 0) } as E;
    for (const f of this.ouvintes) f();
  }
  mudarLento(p: Partial<Lento>) {
    this.lento = { ...this.lento, ...p };
    for (const f of this.ouvintesLentos) f();
  }
  get spec() { return this.estado.spec; }
  protected get params() { return this.estado.params; }
  protected enviarParams() { this.audio?.send({ type: 'params', params: this.params }); }

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
        a.send({ type: 'config', cfg: this.configDoMotor(a.ctx.sampleRate) });
        this.enviarParams();
        this.depoisDaConfig();
        a.send({ type: 'input', temp: { mode: this.estado.tempMode } });
        this.aoIniciarAudio();
        return a;
      })().catch((e) => { this.iniciando = null; throw e; });
    }
    return this.iniciando;
  }

  // troca o ambiente: params do DSP (som de fundo, comprimento da volta) e acústica da cadeia
  setEnvironment(kind: string) {
    this.mudar({ params: { ...this.params, env: kind } } as Partial<E>, true);
    this.audio?.setAmbienteEParams(kind, this.params); // params, resposta ao impulso e acústica do ouvinte
  }

  setParams(p: Partial<ParamsPistao>, render = false) {
    this.mudar({ params: { ...this.params, ...p } } as Partial<E>, render);
    this.enviarParams();
  }

  setEq(p: Partial<Equalizacao>, render = false) {
    const eq = { ...this.estado.eq, ...p };
    this.mudar({ eq } as Partial<E>, render);
    this.audio?.aplicarEq(eq);
  }

  protected setListener(observer = this.estado.observer, carMic = this.estado.carMic) {
    const params = { ...this.params, listener: observer === 'road' ? 'road' : carMic };
    this.mudar({ observer, carMic, params } as Partial<E>, true);
    this.enviarParams();
    this.audio?.aplicarOuvinte(params.listener);
  }
  setObserver(v: 'car' | 'road') { this.setListener(v); }
  setCarMic(v: string) { this.setListener(this.estado.observer, v); }
  // C: próximo microfone junto ao motor
  nextMic() { const order = ['pipe', 'ext', 'int', 'bay']; this.setListener('car', order[(order.indexOf(this.estado.carMic) + 1) % 4]); }

  // ---------------------------------------------------------------- motor
  /**
   * Manda a especificação ao DSP. A estrutural (escape, cilindros, preset) sai 60 ms depois, para o arrasto de um
   * controle virar uma configuração só; a leve (`tune`) sai na hora. `fresh` é o "motor novo do zero" de um preset
   * (o DSP recomeça as câmaras e, se o motor estava ligado, dá a partida de novo): fica pendente até a configuração
   * sair, para um controle mexido nesses 60 ms remarcar o envio sem desfazê-lo (sem isso o motor novo herdava o giro
   * do anterior e podia apagar: da EMD de 2 tempos para o OM 617 de 4).
   */
  protected pushConfig(structural: boolean, fresh = false) {
    // (a geometria já foi refeita junto com a especificação)
    const audio = this.audio;
    if (!audio) return;
    if (structural) {
      clearTimeout(this.rebuildTimer);
      this.freshPendente ||= fresh;
      this.rebuildTimer = setTimeout(() => {
        const novo = this.freshPendente;
        this.freshPendente = false;
        audio.send({ type: 'config', cfg: { ...this.configDoMotor(audio.ctx.sampleRate), fresh: novo } });
        this.depoisDaConfig();
      }, 60);
    } else {
      audio.send({ type: 'tune', cfg: this.configLeve() });
    }
  }

  setSpec(patch: Partial<S>, { structural = true, render = true } = {}) {
    const spec = { ...this.spec, ...patch } as S;
    // (as fichas do Diesel, do Radial e dos Rotativos dão a rotação máxima em `rpmMax`; os mostradores leem `redline`)
    if (patch.rpmMax) (spec as Record<string, any>).redline = patch.rpmMax;
    // uma combinação que não existe (fileiras, cilindros, geometria do rotor) não muda nada
    let motor: M;
    try { motor = this.montar(spec); } catch { return; }
    this.mudar({ spec, motor, presetId: null } as Partial<E>, render);
    this.pushConfig(structural);
  }

  // muda a especificação só na tela (o ângulo do V enquanto o controle é arrastado)
  previewSpec(patch: Partial<S>) {
    const spec = { ...this.spec, ...patch } as S;
    this.mudar({ spec, motor: this.montar(spec) } as Partial<E>);
  }

  // cilindrada arrastando: só os parâmetros escalares (tune), sem reconstruir a acústica
  tuneSpec(patch: Partial<S>) {
    const spec = { ...this.spec, ...patch } as S;
    this.mudar({ spec, motor: this.montar(spec) } as Partial<E>);
    this.pushConfig(false);
  }

  setFamilia(id: string) { this.mudar({ familia: id } as Partial<E>); }

  // trocar entre fechada/automática/aberta é só comando; instalar ou tirar muda o escape
  setValve(v: string) {
    const was = this.spec.valve || 'none';
    this.setSpec({ valve: v } as unknown as Partial<S>, { structural: (was === 'none') !== (v === 'none') });
  }
  cycleValve() {
    const v = this.spec.valve || 'none';
    this.setValve(v === 'none' ? 'open' : VALVE_MODES[(VALVE_MODES.indexOf(v) + 1) % VALVE_MODES.length]);
  }

  // relações atuais (as do preset/escalonamento padrão até o usuário mexer)
  currentRatios(): number[] {
    const s = this.spec;
    return s.ratios && s.ratios.length === s.gears ? s.ratios.slice() : gearRatios(s.gears || this.marchasPadrao).slice(1);
  }

  // ---------------------------------------------------------------- temperatura
  setTempMode(v: 'real' | 'fixed') {
    this.mudar({ tempMode: v } as Partial<E>, true);
    this.audio?.send({ type: 'input', temp: { mode: v, value: this.tele.coolant ?? 20 } });
  }
  setCoolant(v: number) { this.audio?.send({ type: 'input', temp: { value: v } }); }

  // ---------------------------------------------------------------- condução: pedal ou manete
  /** com hélice ou rotor o comando de potência é a manete; no resto, o pedal */
  get comManete() { return false; }

  sendInput() {
    if (!this.audio) return;
    const i = this.input;
    const thr = this.comManete ? this.manete : Math.max(i.key * (i.half ? 0.4 : 1), i.pad);
    this.audio.send({ type: 'input', throttle: thr, brake: i.brake });
    if (this.comManete) return;
    if (this.pedalFill) this.pedalFill.style.height = `${thr * 100}%`;
    this.pedal?.setAttribute('aria-valuenow', String(Math.round(thr * 100)));
  }

  assinarManete = (f: () => void) => { this.ouvintesManete.add(f); return () => { this.ouvintesManete.delete(f); }; };
  obterManete = () => this.manete;
  /** a posição fica até o usuário mudar (como a da Turbina) */
  setManete(v: number) {
    const m = clamp(v, 0, 1);
    if (m === this.manete) return;
    this.manete = m;
    for (const f of this.ouvintesManete) f();
    this.sendInput();
  }
  /** a cada quadro: W/S e ↑/↓ seguradas movem a manete aos poucos */
  segurar(dt: number) {
    if (!this.comManete) return;
    const v = segurarManete(this.teclas, this.manete, dt);
    if (v !== null) this.setManete(v);
  }

  // ---------------------------------------------------------------- ignição
  async setIgnition(on: boolean) {
    const audio = await this.initAudio();
    if (audio.ctx.state !== 'running') await audio.ctx.resume();
    this.mudar({ ignicao: on } as Partial<E>);
    audio.send({ type: 'input', ignition: on });
  }
  toggleIgnition() { this.ignitionAt = performance.now(); return this.setIgnition(!this.estado.ignicao); }

  // ---------------------------------------------------------------- telemetria
  aoTelemetria = (m: any) => {
    if (m.type !== 'telemetry') return;
    this.telemetria(m);
  };
  /** cada leitura do DSP; a família acrescenta o que lê dela (e o "motor apagou") */
  protected telemetria(m: any) {
    this.tele = m; this.tele.t = performance.now();
  }
  /** o motor parou sozinho (morreu, ou a mistura foi cortada): o botão volta a "Ligar". `carencia`, em ms: o tempo depois
   *  do botão em que o motor ainda está parado porque a partida não começou */
  protected apagou(m: any, carencia: number) {
    return this.estado.ignicao && m.state === 'off' && m.rpm < 50 && performance.now() - this.ignitionAt > carencia;
  }
}
