// Estado e ações da página do Vapor (docs/VAPOR.md 6), fora do React (o padrão das páginas Diesel, Radial e Passagem):
// o React lê um retrato (`estado`) com useSyncExternalStore e só renderiza de novo quando ele muda; a telemetria do
// worklet fica em `tele` e é desenhada no requestAnimationFrame (mostradores.ts).
//
// Áudio: a cadeia da Passagem (PERFIL_PASSAGEM, escala absoluta, reverberação da Cena por banda) com o processador
// `vapor` (src/worklet/processador-vapor.ts → CenaDSP). Mensagens ao worklet:
//   { type: 'portador', tipo, config, motor: { familia: 'vapor', cfg }, comando }   troca de preset ou de composição
//   { type: 'comando', ...ComandoVapor, rampa, marcha, cargaFracao, velocidadeFixa } comandos (no máximo 1 por quadro)
//   { type: 'cena', amb, traj, ouv }                                               ambiente e ouvinte
//   { type: 'params', master, posicao? }
// A sonda de nível (`prepararMotorVapor`, ~1–2 s) roda na thread principal e fica guardada por preset e taxa.
import type { CadeiaDeAudio } from '../../ui';
import type { Ambiente, Ouvinte, Trajetoria, Solo } from '../../scene/tipos';
import { ambientePassagem } from '../../scene/ambientes';
import { PRESETS_VAPOR, presetVapor, escapesPorVolta, type PresetVapor, type FamiliaVapor, type PortadorVapor } from '../../engines/vapor/presets';
import { prepararMotorVapor } from '../../engines/vapor/motor';
import type { ConfigVapor, ComandoVapor, TelemetriaVapor } from '../../engines/vapor/dsp';
import { configLocoVapor } from '../../carriers/locomotiva-vapor';
import { configTrator } from '../../carriers/trator';
import { configBarco } from '../../carriers/barco';
import { configCarroDireto } from '../../carriers/carro-direto';

export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const fmt = (x: number, d = 0) => (Number.isFinite(x) ? x.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
/** reverser (−1..1) do corte desejado (fração do curso, 15–85%) */
export const revDeCorte = (c: number, sentido = 1) => sentido * clamp((c - 0.15) / 0.7, 0, 1);

export type IdAmbienteVapor = 'ceu' | 'corte' | 'estacao' | 'tunel' | 'ponte';
export const AMBIENTES_VAPOR: { id: IdAmbienteVapor; nome: string }[] = [
  { id: 'ceu', nome: 'Céu aberto' }, { id: 'corte', nome: 'Corte' }, { id: 'estacao', nome: 'Estação' }, { id: 'tunel', nome: 'Túnel' }, { id: 'ponte', nome: 'Ponte' },
];
export type IdCenario = 'parada' | 'arrancada' | 'cruzeiro60' | 'cruzeiro100' | 'drifting' | 'lickey' | 'apito' | 'passagem';
export const CENARIOS: { id: IdCenario; nome: string; titulo: string }[] = [
  { id: 'parada', nome: 'Parada', titulo: 'pressão e auxiliares, 60 s: bomba de ar, injetor, segurança, sino e apito' },
  { id: 'arrancada', nome: 'Arrancada', titulo: 'reverser 80%, regulador 0,2 → 0,6 em 5 s, torneiras no automático (patina no trilho molhado)' },
  { id: 'cruzeiro60', nome: 'Cruzeiro 60', titulo: 'velocidade fixa a 60 km/h, corte 25%' },
  { id: 'cruzeiro100', nome: 'Cruzeiro 100', titulo: 'velocidade fixa a 100 km/h, corte 20%' },
  { id: 'drifting', nome: 'Drifting', titulo: 'regulador fechado a 60 km/h: rolamento, bielas e o bufo dos cilindros' },
  { id: 'lickey', nome: 'Lickey', titulo: 'subida de 2,65% com 10 vagões, corte 55%, regulador cheio' },
  { id: 'apito', nome: 'Apito', titulo: 'longo, longo, curto, longo' },
  { id: 'passagem', nome: 'Passagem', titulo: 'a composição passando a 40 km/h pelo ouvinte parado junto à via' },
];

/** comando da máquina (o que vai ao motor pelo portador) */
export type ComandoPagina = {
  regulador: number; reverser: number; apitoAbertura: number; sino: boolean; areia: boolean;
  torneiras: boolean | 'auto'; freio: number; fogo: number; fogoAuto: boolean;
  injetor: boolean | 'auto'; bombaAr: boolean | 'auto'; soprador: boolean | 'auto'; simplificacao: boolean;
  trilho: 'seco' | 'molhado'; mixAr: number; mixMec: number;
};

export type EstadoVapor = {
  presetId: string; familia: FamiliaVapor;
  cmd: ComandoPagina;
  vagoes: number; massaVagao: number; rampa: number;   // rampa em %
  marcha: number; carga: number;
  ambiente: IdAmbienteVapor; distancia: number; master: number;
  cenario: IdCenario | null;
  calibrando: boolean; erro: string | null;
  /** teclas seguradas (para os botões acompanharem) */
  apitando: boolean; freando: boolean;
};

export const CMD_PADRAO: ComandoPagina = {
  regulador: 0, reverser: revDeCorte(0.6), apitoAbertura: 1, sino: false, areia: false, torneiras: 'auto', freio: 0, fogo: 0.5, fogoAuto: true,
  injetor: 'auto', bombaAr: 'auto', soprador: 'auto', simplificacao: false, trilho: 'seco', mixAr: 1, mixMec: 1,
};

/** portador do preset (o primeiro dos de uso real) */
export const portadorDe = (P: PresetVapor): Exclude<PortadorVapor, 'nenhum'> => (P.portadores.find((p) => p !== 'nenhum') ?? 'locomotiva') as Exclude<PortadorVapor, 'nenhum'>;

/** Telemetria guardada (a da mensagem 'telemetria' do worklet) */
export interface Tele { cena: any; portador: any; motor: TelemetriaVapor | null; t: number }

export class ControleVapor {
  estado: EstadoVapor;
  tele: Tele | null = null;
  audio: CadeiaDeAudio | null = null;
  iniciar: (() => Promise<CadeiaDeAudio>) | null = null;
  private promessa: Promise<CadeiaDeAudio> | null = null;
  private cache = new Map<string, ConfigVapor>();
  private ouvintes = new Set<() => void>();
  /** comando pendente (juntado e mandado no máximo uma vez por quadro) */
  private pend = false;
  /** velocidade fixa (m/s) dos cenários de cruzeiro; null = o motor integra a velocidade */
  vFixa: number | null = null;
  /** ouvinte fixo junto à via (cenário passagem) em vez de acompanhar a máquina */
  fixo = false;
  /** teclas de rampa seguradas: W/S regulador, A/D reverser */
  teclas = { w: false, s: false, a: false, d: false };
  /** linha do tempo do cenário: [instante (ms de performance.now), ação] */
  private agenda: [number, () => void][] = [];
  private tUlt = 0;

  constructor() {
    const P = PRESETS_VAPOR[0];
    this.estado = {
      presetId: P.id, familia: P.familia, cmd: { ...CMD_PADRAO }, vagoes: 8, massaVagao: P.vagao?.massa ?? 40, rampa: 0, marcha: 1, carga: 0.5,
      ambiente: 'ceu', distancia: 10, master: 0.8, cenario: null, calibrando: false, erro: null, apitando: false, freando: false,
    };
  }

  // ---------------------------------------------------------------- store
  assinar = (f: () => void) => { this.ouvintes.add(f); return () => { this.ouvintes.delete(f); }; };
  obter = () => this.estado;
  private mudar(p: Partial<EstadoVapor>) { this.estado = { ...this.estado, ...p }; for (const f of this.ouvintes) f(); }
  get P() { return presetVapor(this.estado.presetId)!; }
  get portador() { return portadorDe(this.P); }

  // ---------------------------------------------------------------- áudio
  async initAudio(): Promise<CadeiaDeAudio> {
    if (this.audio) return this.audio;
    if (!this.promessa) {
      this.promessa = this.iniciar!().then(async (a) => {
        this.audio = a;
        a.send({ type: 'params', master: this.estado.master });
        this.mandarCena();
        await this.mandarPortador();
        return a;
      }).catch((e) => { this.promessa = null; this.mudar({ erro: String(e?.message || e) }); throw e; });
    }
    return this.promessa;
  }
  /** botão "ligar o som" (gesto do usuário) */
  async ligar() { const a = await this.initAudio(); await a.retomar(); }

  /** cfg do motor (sonda de nível, cara: guardada por preset e taxa) */
  private cfgMotor(fs: number): ConfigVapor {
    const chave = `${this.estado.presetId}|${fs}`;
    let c = this.cache.get(chave);
    if (!c) { c = prepararMotorVapor(this.P, fs); this.cache.set(chave, c); }
    return c;
  }
  /** configuração do portador pelo preset (VAPOR.md 4.4; a mesma regra de configPortadorVapor da Passagem) */
  configPortador(): Record<string, any> {
    const P = this.P, e = this.estado, t = this.portador;
    if (t === 'locomotiva') return configLocoVapor(P, { vagoes: e.vagoes, massaVagao: e.massaVagao, rampa: e.rampa / 100 });
    if (t === 'trator') return { ...configTrator(P), rampa: e.rampa / 100 };
    if (t === 'barco') return configBarco(P);
    if (t === 'carro') return { ...configCarroDireto(P), rampa: e.rampa / 100 };
    return { rpmNominal: P.rpmGovernado ?? 75, potenciaNominal: P.potenciaGerador ?? 500, eta: 0.95, J_alt: 50, semFontes: true, posMotor: [0, 0, 0], corpo: { comprimento: 12, largura: 6, altura: 6, massaSuperficial: 30 } };
  }
  /** monta o portador com o motor no worklet (aloca lá; a sonda roda aqui antes) */
  async mandarPortador() {
    const a = this.audio; if (!a) return;
    const fs = a.ctx.sampleRate;
    const chave = `${this.estado.presetId}|${fs}`;
    if (!this.cache.has(chave)) {
      this.mudar({ calibrando: true });
      // (deixa o "calibrando…" aparecer antes de ocupar a thread principal com a sonda)
      await new Promise((r) => setTimeout(r, 30));
    }
    let cfg: ConfigVapor;
    try { cfg = this.cfgMotor(fs); } catch (e: any) { this.mudar({ calibrando: false, erro: String(e?.message || e) }); return; }
    a.send({ type: 'portador', tipo: this.portador, config: this.configPortador(), motor: { familia: 'vapor', cfg }, comando: this.comando() });
    // o CenaDSP herda a velocidade do portador anterior como velocidade fixa: o vapor parado anda solto
    a.send({ type: 'comando', ...this.comando(), velocidadeFixa: this.vFixa });
    this.mudar({ calibrando: false, erro: null });
  }

  /** o comando completo da máquina e do portador */
  comando(): Partial<ComandoVapor> & Record<string, unknown> {
    const c = this.estado.cmd, e = this.estado;
    return {
      pedal: c.regulador, regulador: c.regulador, cutoff: c.reverser, apito: e.apitando ? c.apitoAbertura : 0, sino: c.sino, areia: c.areia,
      torneiras: c.torneiras, fogo: c.fogoAuto ? 'auto' : c.fogo, injetor: c.injetor, bombaAr: c.bombaAr, soprador: c.soprador,
      freio: e.freando ? 1 : c.freio, simplificacao: c.simplificacao, trilho: c.trilho, mixAr: c.mixAr, mixMec: c.mixMec,
      rampa: e.rampa / 100, marcha: this.portador === 'trator' ? e.marcha : undefined, cargaFracao: this.portador === 'gerador' ? e.carga : undefined,
    };
  }
  private mandarComando(agora = false) { if (agora) { this.pend = false; this.audio?.send({ type: 'comando', ...this.comando() }); } else this.pend = true; }

  // ---------------------------------------------------------------- cena
  ambienteCena(): Ambiente {
    const a = ambientePassagem(this.estado.ambiente);
    const solo: Solo['tipo'] | null = this.portador === 'barco' ? 'agua' : this.portador === 'carro' || this.portador === 'trator' ? 'asfalto' : this.portador === 'gerador' ? 'concreto' : null;
    if (solo) a.solo = { tipo: solo };
    return a;
  }
  trajetoria(): Trajetoria { return { tipo: 'reta', comprimento: 20000, raioCurva: 2000, lateral: this.estado.distancia, altitude: 0, sentido: 1 }; }
  ouvinte(): Ouvinte {
    const r = this.estado.distancia;
    if (this.fixo) return { modo: 'fixo', pos: [0, 0, 1.6], gimbal: { az: 90, el: 0, r, alvo: 'corpo' }, local: 'fora', binaural: true };
    // acompanha a máquina: de lado, nos cilindros (z 0,6 m), com o ouvido a ~1,6 m do chão
    const el = (Math.asin(clamp(1 / r, -1, 1)) * 180) / Math.PI;
    return { modo: 'gimbal', pos: [0, 0, 1.6], gimbal: { az: 90, el, r, alvo: 'cilindro.e' }, local: 'fora', binaural: true };
  }
  mandarCena() {
    const a = this.audio; if (!a) return;
    const amb = this.ambienteCena();
    a.send({ type: 'cena', amb, traj: this.trajetoria(), ouv: this.ouvinte() });
    a.aplicarRespostaPorBanda(amb);
  }

  // ---------------------------------------------------------------- ações do painel
  setFamilia(f: FamiliaVapor) {
    if (f === this.estado.familia) return;
    const p = PRESETS_VAPOR.find((x) => x.familia === f);
    this.mudar({ familia: f });
    if (p) this.setPreset(p.id);
  }
  setPreset(id: string) {
    const P = presetVapor(id); if (!P) return;
    this.pararCenario();
    this.vFixa = null; this.fixo = false;
    this.mudar({ presetId: id, familia: P.familia, massaVagao: P.vagao?.massa ?? 40, cmd: { ...CMD_PADRAO, reverser: P.familia === 'estacionaria' ? revDeCorte(0.3) : CMD_PADRAO.reverser } });
    if (this.audio) { this.mandarCena(); void this.mandarPortador(); }
  }
  setCmd(p: Partial<ComandoPagina>, agora = false) { this.mudar({ cmd: { ...this.estado.cmd, ...p } }); this.mandarComando(agora); }
  setVagoes(n: number) { this.mudar({ vagoes: n }); this.remontar(); }
  setMassaVagao(t: number) { this.mudar({ massaVagao: t }); this.remontar(); }
  private remontarT: ReturnType<typeof setTimeout> | undefined;
  private remontar() { clearTimeout(this.remontarT); this.remontarT = setTimeout(() => void this.mandarPortador(), 150); }
  setRampa(pct: number) { this.mudar({ rampa: pct }); this.mandarComando(); }
  setMarcha(m: number) { this.mudar({ marcha: m }); this.mandarComando(true); }
  setCarga(f: number) { this.mudar({ carga: f }); this.mandarComando(true); }
  setAmbiente(a: IdAmbienteVapor) { this.mudar({ ambiente: a }); this.mandarCena(); }
  setDistancia(d: number) { this.mudar({ distancia: d }); this.pendCena = true; }
  setMaster(m: number) { this.mudar({ master: m }); this.audio?.send({ type: 'params', master: m }); }
  private pendCena = false;

  // apito e freio seguráveis (tecla ou botão)
  apitar(on: boolean) { if (on === this.estado.apitando) return; this.mudar({ apitando: on }); this.mandarComando(true); }
  frear(on: boolean) { if (on === this.estado.freando) return; this.mudar({ freando: on }); this.mandarComando(true); }
  areia(on: boolean) { if (on === this.estado.cmd.areia) return; this.setCmd({ areia: on }, true); }
  alternarSino() { this.setCmd({ sino: !this.estado.cmd.sino }, true); }
  alternarTorneiras() { const t = this.estado.cmd.torneiras; this.setCmd({ torneiras: t === true ? false : true }, true); }
  alternarInjetor() { const t = this.estado.cmd.injetor; this.setCmd({ injetor: t === true ? false : true }, true); }
  fecharRegulador() { this.setCmd({ regulador: 0 }, true); }

  /** a cada quadro: rampas das teclas seguradas, agenda do cenário, envio do que ficou pendente */
  quadro(agora: number) {
    const dt = this.tUlt ? Math.min(0.1, (agora - this.tUlt) / 1000) : 0;
    this.tUlt = agora;
    const t = this.teclas, c = this.estado.cmd;
    if (t.w || t.s) this.setCmd({ regulador: clamp(c.regulador + (t.w ? 1 : -1) * dt, 0, 1) });
    if (t.a || t.d) this.setCmd({ reverser: clamp(c.reverser + (t.d ? 1 : -1) * 0.8 * dt, -1, 1) });
    while (this.agenda.length && this.agenda[0][0] <= agora) this.agenda.shift()![1]();
    if (this.estado.cenario && !this.agenda.length) this.mudar({ cenario: null });
    if (this.pend && this.audio) { this.pend = false; this.audio.send({ type: 'comando', ...this.comando() }); }
    if (this.pendCena && this.audio) { this.pendCena = false; this.audio.send({ type: 'cena', traj: this.trajetoria(), ouv: this.ouvinte() }); }
  }

  // ---------------------------------------------------------------- cenários
  pararCenario() { this.agenda = []; if (this.estado.cenario) this.mudar({ cenario: null }); }
  async cenario(id: IdCenario) {
    await this.ligar();
    this.pararCenario();
    const t0 = performance.now(), em = (s: number, f: () => void) => this.agenda.push([t0 + s * 1000, f]);
    const P = this.P, a = this.audio!;
    const livre = () => { this.vFixa = null; a.send({ type: 'comando', velocidadeFixa: null }); };
    const fixar = (kmh: number) => { this.vFixa = kmh / 3.6; a.send({ type: 'comando', velocidadeFixa: this.vFixa }); };
    if (this.fixo && id !== 'passagem') { this.fixo = false; this.mandarCena(); }
    this.mudar({ cenario: id });
    if (id === 'parada') {
      this.setCmd({ regulador: 0, freio: 0.5, torneiras: 'auto', fogoAuto: false, fogo: 1, injetor: 'auto', bombaAr: 'auto', soprador: 'auto', sino: false }, true);
      fixar(0); em(0.5, livre);
      em(8, () => this.setCmd({ sino: true }, true)); em(16, () => this.setCmd({ sino: false }, true));
      em(25, () => this.apitar(true)); em(27, () => this.apitar(false));
      em(60, () => this.setCmd({ fogoAuto: true }, true));
    } else if (id === 'arrancada') {
      fixar(0); em(0.3, livre);
      this.setCmd({ regulador: 0, reverser: revDeCorte(0.8), torneiras: 'auto', freio: 0, areia: false }, true);
      for (let k = 0; k <= 10; k++) em(1 + k * 0.5, () => this.setCmd({ regulador: 0.2 + 0.04 * k }, true));
      em(15, () => this.setCmd({ reverser: revDeCorte(0.6) }, true));
      em(25, () => this.setCmd({ reverser: revDeCorte(0.45) }, true));
      em(40, () => {});
    } else if (id === 'cruzeiro60' || id === 'cruzeiro100') {
      const v = id === 'cruzeiro60' ? 60 : 100;
      fixar(Math.min(v, P.vMax));
      this.setCmd({ regulador: 0.9, reverser: revDeCorte(v === 60 ? 0.25 : 0.2), torneiras: false, freio: 0 }, true);
      em(30, () => {});
    } else if (id === 'drifting') {
      fixar(Math.min(60, P.vMax));
      this.setCmd({ regulador: 0, reverser: revDeCorte(0.4), torneiras: false, freio: 0 }, true);
      em(30, () => {});
    } else if (id === 'lickey') {
      if (this.portador === 'locomotiva' && this.estado.vagoes !== 10) { this.mudar({ vagoes: 10 }); await this.mandarPortador(); }
      this.mudar({ rampa: 2.65 });
      fixar(0); em(0.3, livre);
      this.setCmd({ regulador: 1, reverser: revDeCorte(0.55), torneiras: 'auto', freio: 0, areia: false }, true);
      em(60, () => {});
    } else if (id === 'apito') {
      let t = 0.2;
      for (const d of [1.6, 1.6, 0.5, 2.6]) { em(t, () => this.apitar(true)); em(t + d, () => this.apitar(false)); t += d + 0.45; }
      em(t + 0.5, () => {});
    } else if (id === 'passagem') {
      // a composição parte 120 m antes do ouvinte parado e passa a 40 km/h
      this.fixo = true; this.mandarCena();
      const L = this.comprimentoComposicao();
      a.send({ type: 'params', posicao: -120 - L / 2 });
      fixar(Math.min(40, P.vMax));
      this.setCmd({ regulador: 1, reverser: revDeCorte(0.4), torneiras: false, freio: 0 }, true);
      em((L + 260) / (Math.min(40, P.vMax) / 3.6), () => { this.fixo = false; this.mandarCena(); });
    }
  }
  /** comprimento aproximado da composição (m), para a passagem */
  comprimentoComposicao() {
    const P = this.P, g = P.geometria;
    if (this.portador !== 'locomotiva') return g.comprimento;
    return g.comprimento + 1 + (P.tender ? P.tender.comprimento + 1 : 0) + this.estado.vagoes * 20;
  }
  /** escapes por volta de cada motor (a fita de luzes) */
  escapesPorMotor() { const P = this.P; return escapesPorVolta(P, this.estado.cmd.simplificacao) / (P.motores ?? 1) / (P.reducao ?? 1); }

  // ---------------------------------------------------------------- telemetria
  onTelemetria = (m: any) => {
    if (!m || m.type !== 'telemetria') return;
    this.tele = { cena: m.cena, portador: m.portador, motor: m.portador?.motor ?? null, t: performance.now() };
  };
}
