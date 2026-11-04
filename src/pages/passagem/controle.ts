// Estado e lógica da página Passagem / modo de testes, fora do React (o padrão das páginas Ronco e
// Turbina): os componentes assinam tópicos e só renderizam de novo quando o tópico é avisado; a
// telemetria do worklet fica num campo e é desenhada no requestAnimationFrame (cena 3D e mostradores).
//
//   painel   → o painel inteiro (troca de portador, preset, "voltar ao padrão")
//   presets  → a barra de presets e de portadores
//   ouvinte  → sliders do gimbal, da posição e do local (o arrasto na cena 3D muda estes valores)
//   estado   → botão de disparar/parar e o rótulo
//
// Mensagens para o worklet (src/scene/dsp-cena.ts): 'portador' (monta, com as calibrações feitas aqui
// na thread principal), 'cena' (ambiente, trajetória e ouvinte; o worklet faz rampas de 20 ms),
// 'comando' (velocidade fixa, coletivo), 'params' (master, posição do corpo) e 'ar' (umidade, temperatura).
// Mudanças contínuas (arrasto, sliders) são juntadas e mandadas no máximo uma vez por quadro (`enviarPendentes`).
import { useSyncExternalStore } from 'react';
import type { CadeiaDeAudio } from '../../ui';
import type { Ambiente, Ouvinte, Trajetoria, FonteSonora, TelemetriaCena, LocalOuvinte, Solo, Vec3 } from '../../scene/tipos';
import type { Corpo, Portador, TelemetriaPortador, FamiliaMotor } from '../../carriers/tipos';
import { ambientePassagem } from '../../scene/ambientes';
import { Via, PontoVia } from '../../scene/trajetoria';
import { Trem, TREM_PADRAO, maxVagoes, type ConfigTrem } from '../../carriers/trem';
import { Rotor } from '../../carriers/rotor';
import {
  PRESETS_PASSAGEM, TREM_PAGINA_PADRAO, situacaoPortador, motoresProntos,
  type IdAmbientePagina, type IdPortadorPagina, type PresetPassagem, type TremPagina,
} from './presets';

export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const fmt = (x: number, d = 0) => (Number.isFinite(x) ? x.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');

export type Topico = 'painel' | 'presets' | 'ouvinte' | 'estado';

/** padrões do modo de testes por portador (CENA.md 3.1) */
export interface PadroesPortador { traj: Trajetoria; vKmh: number; ambiente: IdAmbientePagina; x0: number }
export const PADROES: Record<'trem' | 'rotor', PadroesPortador> = {
  trem: { traj: { tipo: 'reta', comprimento: 3000, raioCurva: 2000, lateral: 3, altitude: 0, sentido: 1 }, vKmh: 350, ambiente: 'tunel', x0: 600 },
  // helicóptero: o que o CENA dá para o avião (reta de 6000 m, altitude 150 m, passa por cima)
  rotor: { traj: { tipo: 'reta', comprimento: 6000, raioCurva: 2000, lateral: 0, altitude: 150, sentido: 1 }, vKmh: 150, ambiente: 'ceu', x0: 800 },
};
export const AR_PADRAO = { ur: 60, temperatura: 20 };
export const OUVINTE_PADRAO: Ouvinte = { modo: 'fixo', pos: [0, 0, 1.6], gimbal: { az: 90, el: 0, r: 8, alvo: 'corpo' }, local: 'auto', binaural: true };

/** Atalhos do gimbal (CENA.md 3.2), resolvidos para as fontes do portador atual. */
export interface Atalho { id: string; nome: string; titulo: string; ok: boolean; motivo?: string; aplicar?: () => Partial<Ouvinte> & { gimbal: Ouvinte['gimbal'] } }

/** Telemetria guardada da última mensagem, com o instante de chegada. */
export interface Tele { cena: TelemetriaCena; portador: TelemetriaPortador; pressao: { max: number; min: number; nariz: number; tunel: number }; lado: number; t: number }

export class ControlePassagem {
  // ------------------------------------------------------------ estado
  portador: IdPortadorPagina = 'trem';
  motor: FamiliaMotor = 'nenhum';
  trem: TremPagina = { ...TREM_PAGINA_PADRAO, pantografos: [...TREM_PAGINA_PADRAO.pantografos] };
  coletivo = 0.75;
  ambiente: IdAmbientePagina = 'tunel';
  solo: Solo['tipo'] | null = null;              // null = o do ambiente
  tunel = { area: 64, comprimento: 2000, xEntrada: -500 };
  rtFator = 1;                                   // escala do RT60 do ambiente (modo de testes)
  ar = { ...AR_PADRAO };
  traj: Trajetoria = { ...PADROES.trem.traj };
  vKmh = 350;
  x0 = 600;                                      // m: o nariz parte daqui antes do ouvinte
  repetir = false;
  ouv: Ouvinte = clonarOuvinte(OUVINTE_PADRAO);
  master = 0.8;
  presetId: string | null = 'trembala-tunel';
  /** fonte destacada (clique na cena ou alvo do gimbal) */
  fonteFicha: string | null = null;

  // derivados (sonda do portador na thread principal: geometria, fontes e calibrações)
  corpo!: Corpo;
  fontes: readonly FonteSonora[] = [];
  private calibracao: number[] = [];
  /** geometria do rotor (helicóptero) para a cena 3D */
  rotorCfg: { R: number; Rc: number; B: number; posRotor: Vec3; posCauda: Vec3 } | null = null;
  private fsSonda = 0;
  via = new Via();
  private pv = new PontoVia();

  // passagem
  andando = false;
  /** s do corpo na última posição mandada (até a telemetria confirmar) */
  private sMandado: number | null = null;
  private tMandado = 0;
  tele: Tele | null = null;

  audio: CadeiaDeAudio | null = null;
  iniciar: (() => Promise<CadeiaDeAudio>) | null = null;
  private promessa: Promise<CadeiaDeAudio> | null = null;
  erro: string | null = null;

  constructor() {
    this.via.configurar(this.traj);
    this.sondar();
  }

  // ---------------------------------------------------------- tópicos
  versao: Record<Topico, number> = { painel: 0, presets: 0, ouvinte: 0, estado: 0 };
  private ouvintes = new Set<() => void>();
  assinar = (fn: () => void) => { this.ouvintes.add(fn); return () => { this.ouvintes.delete(fn); }; };
  avisar(...ts: Topico[]) { for (const t of ts) this.versao[t]++; for (const fn of this.ouvintes) fn(); }

  // ------------------------------------------------------- portador
  configTrem(): Partial<ConfigTrem> {
    const t = this.trem;
    return {
      ...TREM_PADRAO, N: t.N, Lc: t.Lc, vao: t.vao, truqueExtremidade: t.truqueExtremidade, lNariz: t.lNariz, lCauda: t.lNariz,
      pantografos: t.pantografos.filter((p) => p >= 1 && p <= t.N), carenagem: t.carenagem, largura: t.largura, altura: t.altura, zPiso: t.zPiso,
      cpNariz: t.cpNariz, faces: 'duas', ladoOuvinte: this.traj.sentido === 1 ? -1 : 1,
    };
  }
  maxVagoes() { return maxVagoes({ pantografos: this.trem.pantografos, faces: 'duas', tom: null }); }

  /** monta o portador na thread principal: geometria, lista de fontes e calibrações (aloca; ~30 ms no trem) */
  private sondar(fs = this.audio?.ctx.sampleRate ?? 48000) {
    let p: Portador;
    this.rotorCfg = null;
    if (this.portador === 'rotor') { const r = new Rotor(fs); p = r; this.rotorCfg = { R: r.cfg.R, Rc: r.cfg.Rc, B: r.cfg.B, posRotor: r.cfg.posRotor, posCauda: r.cfg.posCauda }; }
    else {
      this.trem.N = Math.min(this.trem.N, this.maxVagoes());
      const t = new Trem(fs, this.configTrem());
      this.calibracao = t.calibracoes();
      p = t;
    }
    this.corpo = p.corpo;
    this.fontes = p.fontes();
    this.fsSonda = fs;
    if (this.ouv.gimbal.alvo !== 'corpo' && !this.fontes.some((f) => f.id === this.ouv.gimbal.alvo)) this.ouv.gimbal.alvo = 'corpo';
    if (this.fonteFicha && !this.fontes.some((f) => f.id === this.fonteFicha)) this.fonteFicha = null;
  }

  private mandarPortador() {
    const a = this.audio; if (!a) return;
    if (this.fsSonda !== a.ctx.sampleRate) this.sondar(a.ctx.sampleRate);
    if (this.portador === 'rotor') a.send({ type: 'portador', tipo: 'rotor' });
    else a.send({ type: 'portador', tipo: 'trem', config: { ...this.configTrem(), calibracao: this.calibracao } });
  }

  /** mudança estrutural no trem (N, passo, vão…): monta de novo e manda */
  setTrem(patch: Partial<TremPagina>) {
    Object.assign(this.trem, patch);
    this.presetId = null;
    this.sondar();
    this.mandarPortador();
    this.mandarCena();
    this.avisar('presets', 'painel');
  }

  setPortador(p: IdPortadorPagina) {
    if (!situacaoPortador(p).ok || p === this.portador) return;
    this.portador = p;
    this.motor = motoresProntos(p)[0] ?? 'nenhum';
    const d = PADROES[p as 'trem' | 'rotor'];
    this.traj = { ...d.traj }; this.vKmh = d.vKmh; this.ambiente = d.ambiente; this.x0 = d.x0; this.solo = p === 'rotor' ? 'grama' : null;
    this.via.configurar(this.traj);
    this.ouv.gimbal.alvo = 'corpo';
    this.presetId = null;
    this.sondar();
    this.mandarPortador();
    this.mandarCena(true);
    this.mandarComando();
    this.avisar('presets', 'painel', 'ouvinte');
  }

  // ------------------------------------------------------ ambiente
  ambienteCena(): Ambiente {
    const a = ambientePassagem(this.ambiente);
    if (this.solo) a.solo = { tipo: this.solo };
    if (a.tunel) a.tunel = { ...this.tunel };
    if (this.rtFator !== 1 && a.reverb.rt60) {
      const r = a.reverb.rt60, k = this.rtFator;
      a.reverb = { ...a.reverb, rt60: [r[0] * k, r[1] * k, r[2] * k, r[3] * k], len: a.reverb.len * Math.max(1, k) };
    }
    return a;
  }
  setAmbiente(id: IdAmbientePagina) {
    this.ambiente = id;
    this.presetId = null;
    this.mandarCena(true);
    this.avisar('presets', 'painel');
  }
  setSolo(s: Solo['tipo'] | null) { this.solo = s; this.presetId = null; this.mandarCena(true); this.avisar('painel', 'presets'); }
  setTunel(patch: Partial<ControlePassagem['tunel']>) { Object.assign(this.tunel, patch); this.mandarCena(false); }
  setRt(k: number) { this.rtFator = k; this.mandarCena(true); }

  // ---------------------------------------------------- trajetória
  setTraj(patch: Partial<Trajetoria>, estrutural = false) {
    const lado0 = this.traj.sentido;
    this.traj = { ...this.traj, ...patch };
    this.via.configurar(this.traj);
    this.presetId = null;
    this.pendCena = true;
    if (estrutural || lado0 !== this.traj.sentido) { this.mandarCena(false); this.avisar('painel', 'presets'); }
    else this.avisar('ouvinte', 'presets');   // sliders e placa acompanham o arrasto
  }
  setV(kmh: number) { this.vKmh = kmh; this.presetId = null; if (this.andando) this.mandarComando(); this.avisar('presets'); }
  setColetivo(c: number) { this.coletivo = c; this.mandarComando(); }
  setAr(patch: Partial<ControlePassagem['ar']>) { Object.assign(this.ar, patch); this.audio?.send({ type: 'ar', ...this.ar }); }
  setMaster(m: number) { this.master = m; this.audio?.send({ type: 'params', master: m }); }

  // ------------------------------------------------------- ouvinte
  setOuvinte(patch: Partial<Ouvinte>, gim?: Partial<Ouvinte['gimbal']>) {
    this.ouv = { ...this.ouv, ...patch, pos: [...(patch.pos ?? this.ouv.pos)] as unknown as Vec3, gimbal: { ...this.ouv.gimbal, ...(gim || {}) } };
    const g = this.ouv.gimbal;
    g.az = ((((g.az + 180) % 360) + 360) % 360) - 180; g.el = clamp(g.el, -20, 89); g.r = clamp(g.r, 0.3, 300);
    this.pendCena = true;
    this.avisar('ouvinte');
  }
  setLocal(l: Ouvinte['local']) { this.setOuvinte({ local: l }); this.enviarPendentes(); this.avisar('painel'); }
  setModo(m: Ouvinte['modo']) { this.setOuvinte({ modo: m }); this.enviarPendentes(); this.avisar('painel'); }
  escolherFonte(id: string | null) { this.fonteFicha = id; this.avisar('ouvinte'); }

  atalhos(): Atalho[] {
    const tem = (id: string) => this.fontes.some((f) => f.id === id);
    const primeira = (tipo: FonteSonora['tipo']) => this.fontes.find((f) => f.tipo === tipo)?.id;
    const L = this.corpo.comprimento;
    const frente = tem('nariz') ? 'nariz' : 'corpo', tras = tem('cauda') ? 'cauda' : 'corpo';
    const escape = this.fontes.find((f) => f.tipo === 'escape')?.id;
    const dentro = this.fontes.find((f) => f.dentro)?.id;
    const panto = primeira('pantografo') ?? (tem('rotor.principal') ? 'rotor.principal' : undefined);
    const semMotor = 'O portador não tem motor com escape: espera os adaptadores de motor';
    const g = (alvo: string, az: number, el: number, r: number, local: Ouvinte['local'] = 'fora') => () => ({ modo: 'gimbal' as const, local, gimbal: { alvo, az, el, r } });
    return [
      { id: 'escape', nome: 'Escape', titulo: '180°, −10°, 1,5 m da ponteira', ok: !!escape, motivo: semMotor, aplicar: escape ? g(escape, 180, -10, 1.5) : undefined },
      { id: 'ponteira', nome: 'Ponteira', titulo: 'a 0,3 m da ponteira; as outras fontes −20 dB', ok: !!escape, motivo: semMotor, aplicar: escape ? g(escape, 180, 0, 0.3, 'ponteira') : undefined },
      { id: 'frente', nome: 'Frente', titulo: '0°, 0°, 3 m à frente do nariz', ok: true, aplicar: g(frente, 0, 0, 3) },
      { id: 'lateral', nome: 'Lateral', titulo: '90°, 0°, 5 m do centro do corpo', ok: true, aplicar: g('corpo', 90, 0, 5) },
      { id: 'atras', nome: 'Câmera atrás', titulo: '180°, 5°, 4 m atrás', ok: true, aplicar: g(tras, 180, 5, 4) },
      { id: 'cabine', nome: 'Cabine', titulo: 'dentro do primeiro segmento: lei da massa e ressonância do habitáculo', ok: true,
        aplicar: g('corpo', 0, 0, Math.max(0.3, L / 2 - Math.min(8, L / 4)), 'auto') },
      { id: 'cofre', nome: 'Cofre', titulo: 'no compartimento do motor', ok: !!dentro, motivo: 'Nenhuma fonte dentro de compartimento (as do motor)', aplicar: dentro ? g(dentro, 90, 0, 0.5, 'cofre') : undefined },
      { id: 'topo', nome: panto?.startsWith('rotor') ? 'Sobre o rotor' : 'Sobre o pantógrafo', titulo: '0°, 89°, 1 m acima', ok: !!panto, motivo: 'Sem pantógrafo nem rotor',
        aplicar: panto ? g(panto, 0, 89, 1) : undefined },
    ].map((a) => ({ ...a, titulo: a.ok ? a.titulo : a.motivo! }));
  }
  aplicarAtalho(a: Atalho) {
    if (!a.ok || !a.aplicar) return;
    const p = a.aplicar();
    this.setOuvinte(p, p.gimbal);
    this.fonteFicha = p.gimbal.alvo === 'corpo' ? null : p.gimbal.alvo;
    this.enviarPendentes();
    this.avisar('painel');
  }

  // ----------------------------------------------------- passagem
  /** abscissa da via no ponto do ouvinte fixo */
  sOuvinte() { return this.via.abscissaDe(this.ouv.pos[0]); }
  /** quanto o nariz já passou do ouvinte (m), na via reduzida */
  xiNariz(s: number) {
    const L = this.corpo.comprimento, Lv = this.via.comp;
    let u = (s + L / 2 - this.sOuvinte()) % Lv;
    if (this.traj.tipo === 'reta') { u = (s + L / 2 - this.sOuvinte() + Lv / 2) % Lv; if (u < 0) u += Lv; return u - Lv / 2; }
    if (u > Lv / 2) u -= Lv; if (u < -Lv / 2) u += Lv; return u;
  }

  async disparar() {
    const a = await this.initAudio();
    await a.retomar();
    const s0 = this.sOuvinte() - this.x0 - this.corpo.comprimento / 2;
    a.send({ type: 'params', posicao: s0 });
    this.sMandado = s0; this.tMandado = performance.now();
    this.andando = true;
    this.mandarComando();
    this.avisar('estado');
  }
  parar() {
    this.andando = false;
    this.mandarComando();
    this.avisar('estado');
  }
  setRepetir(r: boolean) { this.repetir = r; this.avisar('estado', 'painel'); }
  /** arrasto do corpo ao longo da via (parado): muda s */
  moverCorpo(s: number) {
    this.sMandado = s; this.tMandado = performance.now();
    this.audio?.send({ type: 'params', posicao: s });
  }
  private mandarComando() {
    this.audio?.send({ type: 'comando', pedal: this.coletivo, velocidadeFixa: this.andando ? this.vKmh / 3.6 : 0 });
  }

  /** s e v estimados agora (telemetria interpolada linearmente; antes dela, a posição mandada) */
  estimativa(agora = performance.now()): { s: number; v: number } {
    const t = this.tele;
    const v = this.andando ? this.vKmh / 3.6 : 0;
    if (this.sMandado != null && (!t || t.t < this.tMandado)) return { s: this.sMandado + v * (agora - this.tMandado) / 1000, v };
    if (!t) return { s: this.sOuvinte() - this.x0 - this.corpo.comprimento / 2, v: 0 };
    return { s: t.portador.s + t.portador.v * Math.min(0.2, (agora - t.t) / 1000), v: t.portador.v };
  }

  onTelemetria = (m: any) => {
    if (!m || m.type !== 'telemetria') return;
    this.tele = { cena: m.cena, portador: m.portador, pressao: m.pressao, lado: m.lado, t: performance.now() };
    this.historico(m);
    // uma passagem só: depois de a cauda passar e se afastar, o corpo para longe (inaudível)
    if (this.andando && !this.repetir && m.portador.v > 0.1 && (this.sMandado == null || this.tele.t > this.tMandado + 300)) {
      const xiC = this.xiNariz(m.portador.s) - this.corpo.comprimento;
      const dParar = Math.min(800, this.via.comp / 2 - this.corpo.comprimento - 10);
      if (xiC > dParar) this.parar();
    }
  };

  // histórico curto para os mostradores (pressão a cada telemetria: 21 ms)
  readonly nHist = 512;
  histP = { max: new Float32Array(512), min: new Float32Array(512), nariz: new Float32Array(512), tunel: new Float32Array(512), spl: new Float32Array(512), k: 0 };
  private historico(m: any) {
    const h = this.histP, i = h.k++ % this.nHist;
    h.max[i] = m.pressao.max; h.min[i] = m.pressao.min; h.nariz[i] = m.pressao.nariz; h.tunel[i] = m.pressao.tunel; h.spl[i] = m.cena.splDbA;
  }

  // -------------------------------------------------------- áudio
  async initAudio(): Promise<CadeiaDeAudio> {
    if (this.audio) return this.audio;
    if (!this.promessa) {
      this.promessa = this.iniciar!().then((a) => {
        this.audio = a;
        a.send({ type: 'params', master: this.master });
        a.send({ type: 'ar', ...this.ar });
        this.mandarPortador();
        this.mandarCena(true);
        a.send({ type: 'params', posicao: this.estimativa().s });
        this.mandarComando();
        this.avisar('estado');
        return a;
      }, (e) => { this.promessa = null; this.erro = String(e?.message || e); this.avisar('estado'); throw e; });
    }
    return this.promessa;
  }

  private pendCena = false;
  private ambEnviado = '';
  /** manda ambiente, trajetória e ouvinte; com `ir`, gera a resposta ao impulso de novo */
  mandarCena(ir = false) {
    this.pendCena = false;
    const a = this.audio; if (!a) return;
    const amb = this.ambienteCena();
    a.send({ type: 'cena', amb, traj: this.traj, ouv: this.ouv });
    const chave = JSON.stringify([amb.id, amb.solo, amb.reverb.rt60]);
    if (ir || chave !== this.ambEnviado) { a.aplicarRespostaPorBanda(amb); this.ambEnviado = chave; }
  }
  /** chamado a cada quadro: manda o que o arrasto e os sliders mudaram (no máximo uma mensagem por quadro) */
  enviarPendentes() {
    if (!this.pendCena || !this.audio) return;
    this.pendCena = false;
    this.audio.send({ type: 'cena', traj: this.traj, ouv: this.ouv });
  }

  // ------------------------------------------------------ presets
  carregarPreset(p: PresetPassagem) {
    if (!situacaoPortador(p.portador).ok) return;
    const mudouPortador = p.portador !== this.portador;
    this.portador = p.portador; this.motor = p.motor;
    const d = PADROES[p.portador as 'trem' | 'rotor'];
    this.traj = { ...d.traj, lateral: p.lateral, altitude: p.altitude ?? d.traj.altitude };
    this.via.configurar(this.traj);
    this.vKmh = p.vKmh; this.ambiente = p.ambiente; this.solo = p.solo ?? null; this.x0 = d.x0;
    this.tunel = { area: 64, comprimento: 2000, xEntrada: -500 }; this.rtFator = 1;
    if (p.portador === 'trem') this.trem = { ...TREM_PAGINA_PADRAO, pantografos: [...TREM_PAGINA_PADRAO.pantografos], ...(p.trem || {}) };
    if (p.coletivo != null) this.coletivo = p.coletivo;
    this.ouv = clonarOuvinte(OUVINTE_PADRAO);
    this.presetId = p.id;
    this.sondar();
    this.mandarPortador();
    this.mandarCena(true);
    this.mandarComando();
    void mudouPortador;
    this.avisar('presets', 'painel', 'ouvinte', 'estado');
  }

  /** "voltar ao padrão": todos os parâmetros do modo de testes nos valores do CENA (3.1) para o portador atual */
  voltarAoPadrao() {
    const d = PADROES[this.portador as 'trem' | 'rotor'];
    this.traj = { ...d.traj }; this.via.configurar(this.traj);
    this.vKmh = d.vKmh; this.ambiente = d.ambiente; this.x0 = d.x0; this.solo = this.portador === 'rotor' ? 'grama' : null;
    this.tunel = { area: 64, comprimento: 2000, xEntrada: -500 }; this.rtFator = 1;
    this.ar = { ...AR_PADRAO };
    this.trem = { ...TREM_PAGINA_PADRAO, pantografos: [...TREM_PAGINA_PADRAO.pantografos] };
    this.coletivo = 0.75;
    this.ouv = clonarOuvinte(OUVINTE_PADRAO);
    this.presetId = this.portador === 'trem' ? 'trembala-tunel' : null;
    this.sondar();
    this.audio?.send({ type: 'ar', ...this.ar });
    this.mandarPortador();
    this.mandarCena(true);
    this.mandarComando();
    this.avisar('presets', 'painel', 'ouvinte', 'estado');
  }

  presetsVisiveis() { return PRESETS_PASSAGEM.map((p) => ({ ...p, situacao: situacaoPortador(p.portador) })); }

  // ---------------------------------------------------- geometria
  /** ponto do alvo do gimbal no referencial do corpo */
  alvoCorpo(): [number, number, number] {
    const a = this.ouv.gimbal.alvo;
    if (a !== 'corpo') { const f = this.fontes.find((x) => x.id === a); if (f) return [f.pos[0], f.pos[1], f.pos[2]]; }
    return [0, 0, (this.corpo.segmentos[0]?.altura ?? 2) / 2];
  }
  /** ouvinte no gimbal, no referencial do corpo (a mesma conta de CenaPassagem.posGimbalCorpo) */
  gimbalCorpo(): [number, number, number] {
    const g = this.ouv.gimbal, D = Math.PI / 180, [ax, ay, az] = this.alvoCorpo();
    const el = clamp(g.el, -20, 89) * D, a = g.az * D, r = clamp(g.r, 0.3, 300);
    return [ax + r * Math.cos(el) * Math.cos(a), ay + r * Math.cos(el) * Math.sin(a), az + r * Math.sin(el)];
  }
  /** ponto do corpo (referencial do corpo) no mundo, com o corpo em s */
  corpoNoMundo(s: number, b: readonly number[], out: [number, number, number] = [0, 0, 0]) {
    const p = this.via.ponto(s + b[0], this.pv);
    out[0] = p.x + b[1] * p.nx; out[1] = p.y + b[1] * p.ny; out[2] = this.traj.altitude + b[2];
    return out;
  }
  /** posição do ouvido no mundo com o corpo em s */
  ouvinteNoMundo(s: number): [number, number, number] {
    const largura = this.corpo.segmentos[0]?.largura ?? 2;
    if (this.ouv.modo === 'fixo') return [this.ouv.pos[0], this.via.yOuvinte - (this.traj.lateral + largura / 2), Math.max(0.2, this.ouv.pos[2])];
    const w = this.corpoNoMundo(s, this.gimbalCorpo());
    w[2] = Math.max(0.2, w[2]);
    return w;
  }
  /** local resolvido (o 'auto' do CENA 3.3: cabine se o ponto do gimbal cai dentro de um segmento) */
  localEfetivo(): LocalOuvinte {
    const o = this.ouv;
    if (o.local !== 'auto') return o.local;
    if (o.modo !== 'gimbal') return 'fora';
    const b = this.gimbalCorpo();
    let frente = this.corpo.comprimento / 2;
    for (const s of this.corpo.segmentos) {
      if (b[0] <= frente && b[0] >= frente - s.comprimento && Math.abs(b[1]) < s.largura / 2 && b[2] > s.zPiso && b[2] < s.altura) return 'cabine';
      frente -= s.comprimento + s.vao;
    }
    return 'fora';
  }

  // ---------------------------------------------------- teclado
  keydown = (e: KeyboardEvent) => {
    const alvo = e.target as HTMLElement | null;
    if (alvo && (alvo.tagName === 'INPUT' && (alvo as HTMLInputElement).type !== 'range' || alvo.tagName === 'SELECT' || alvo.tagName === 'TEXTAREA')) return;
    if (e.repeat) return;
    // num botão em foco o Espaço já é o clique dele
    if (e.code === 'Space' && alvo?.tagName === 'BUTTON') return;
    if (e.code === 'Space') { e.preventDefault(); if (this.andando) this.parar(); else this.disparar(); }
    else if (e.code === 'KeyR') this.setRepetir(!this.repetir);
    else if (e.code === 'KeyG') this.setModo(this.ouv.modo === 'fixo' ? 'gimbal' : 'fixo');
  };
}

export function clonarOuvinte(o: Ouvinte): Ouvinte { return { ...o, pos: [...o.pos] as unknown as Vec3, gimbal: { ...o.gimbal } }; }

// Assina um ou mais tópicos: o componente renderiza de novo quando algum deles é avisado.
export function useTopico(c: ControlePassagem, ...ts: Topico[]) {
  return useSyncExternalStore(c.assinar, () => ts.map((t) => c.versao[t]).join(','));
}
