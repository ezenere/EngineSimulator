// Estado e ações da página do Elétrico, fora do React (o padrão da Passagem e do Diesel): os componentes assinam tópicos
// e só renderizam de novo quando o tópico é avisado; a telemetria fica num campo e é desenhada no requestAnimationFrame.
//
//   painel   → o painel inteiro (troca de preset, de ouvinte, de ambiente, chaves)
//   presets  → a barra de famílias e presets e a placa
//   estado   → botão de ignição, acelerador e freio (o teclado mexe neles)
//
// Mensagens para o worklet (src/engines/eletrico/pagina.ts, `eletrico-engine`): 'preset' (o cfg calibrado aqui na thread
// principal, com as calibrações do trem), 'input' (acelerador, freio, ignição), 'eletrico' (modulação, AVAS, carga,
// velocidade imposta, ré), 'cena' (ambiente, trajetória e ouvinte) e 'params' (master).
import { useSyncExternalStore } from 'react';
import type { CadeiaDeAudio } from '../../ui';
import type { Ouvinte, Trajetoria, FonteSonora, TelemetriaCena } from '../../scene/tipos';
import type { TelemetriaPortador, Corpo } from '../../carriers/tipos';
import { Trem, type ConfigTrem } from '../../carriers/trem';
import { PRESETS_ELETRICO, FAMILIAS_ELETRICO } from '../../engines/eletrico/presets';
import { prepararMotorEletrico, type CfgEletrico } from '../../engines/eletrico/motor';
import { montarPortadorEletrico } from '../../engines/eletrico/portador';
import { Inversor, type ModoModulacao } from '../../engines/eletrico/inversor';
import type { PresetEletrico } from '../../engines/eletrico/dsp';
import { ambienteEletrico, type IdAmbienteEletrico } from './ambientes';

export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const fmt = (x: number, d = 0) => (Number.isFinite(x) ? x.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');

export type Topico = 'painel' | 'presets' | 'estado';
export type IdOuvinte = 'fora' | 'cabine' | 'cofre' | 'gimbal';
export type IdCarga = 'plano' | 'sub3' | 'sub6' | 'lotacao';
export type ModoAvasPagina = 'desligado' | 'ue' | 'eua';

/** edições do painel avançado (sobre uma cópia do preset) */
export interface Avancado { fc?: number; delta?: number; Zs?: number; Zp?: number; excentricidade?: number; desgaste?: number; detune?: number }

/** telemetria do portador com a do motor (rpm, f_e, f_c, N, modo, nota, linhas…) */
export type TeleMotor = TelemetriaPortador & {
  rpm?: number; torque?: number; potencia?: number; corrente?: number; fE?: number; fRot?: number; fC?: number; N?: number; modo?: string;
  M?: number; fluxo?: number; nota?: number; notaNome?: string; D?: number; avas?: number; linhas?: { id: string; f: number; dB: number }[];
};
export interface Tele { cena: TelemetriaCena; portador: TeleMotor; t: number }

export const CARGAS: { id: IdCarga; nome: string; titulo: string }[] = [
  { id: 'plano', nome: 'Plano', titulo: 'Via plana, sem carga extra' },
  { id: 'sub3', nome: 'Subida 3%', titulo: 'Rampa de 3%' },
  { id: 'sub6', nome: 'Subida 6%', titulo: 'Rampa de 6%' },
  { id: 'lotacao', nome: 'Lotação', titulo: '+20% de massa (reboque, trem lotado)' },
];
export const TRAJ_PAGINA: Trajetoria = { tipo: 'volta', comprimento: 20000, raioCurva: 3000, lateral: 3, altitude: 0, sentido: 1 };

export class ControleEletrico {
  // ------------------------------------------------------------ estado
  base: PresetEletrico = PRESETS_ELETRICO[0];
  presetId = PRESETS_ELETRICO[0].id;
  familia = PRESETS_ELETRICO[0].family;
  avancado: Avancado = {};
  ign = false;
  acel = 0;
  freio = 0;
  modulacao: ModoModulacao | null = null;
  avas: ModoAvasPagina = 'ue';
  carga: IdCarga = 'plano';
  cargaBancada = 0;
  vKmh = 0;
  impor = false;
  pneusAero = true;
  re = false;
  ouvinte: IdOuvinte = 'fora';
  gimbal = { az: 90, el: 10, r: 10 };
  ambiente: IdAmbienteEletrico = 'ceu';
  master = 0.8;

  // derivados (o portador montado na thread principal: corpo e fontes)
  corpo!: Corpo;
  fontes: readonly FonteSonora[] = [];
  private cache = new Map<string, CfgEletrico>();
  private tremCfg: Partial<ConfigTrem> | null = null;
  private cfgAtual: CfgEletrico | null = null;
  private fsSonda = 0;

  tele: Tele | null = null;
  audio: CadeiaDeAudio | null = null;
  iniciar: (() => Promise<CadeiaDeAudio>) | null = null;
  private promessa: Promise<CadeiaDeAudio> | null = null;
  erro: string | null = null;
  /** mensagens mandadas (teste do navegador) */
  enviadas: any[] = [];

  constructor() { this.sondar(48000); }

  // ---------------------------------------------------------- tópicos
  versao: Record<Topico, number> = { painel: 0, presets: 0, estado: 0 };
  private ouvintes = new Set<() => void>();
  assinar = (fn: () => void) => { this.ouvintes.add(fn); return () => { this.ouvintes.delete(fn); }; };
  avisar(...ts: Topico[]) { for (const t of ts) this.versao[t]++; for (const fn of this.ouvintes) fn(); }

  private send(m: any) { const a = this.audio; if (!a) return; this.enviadas.push(m.type === 'preset' ? { type: 'preset', id: m.cfg?.id, trem: !!m.trem, pneusAero: m.pneusAero } : m); if (this.enviadas.length > 400) this.enviadas.splice(0, 200); a.send(m); }

  // ---------------------------------------------------------- preset
  /** o preset com as edições do painel avançado */
  preset(): PresetEletrico {
    const b = this.base, a = this.avancado;
    if (!Object.keys(a).length) return b;
    const p: PresetEletrico = { ...b };
    if (b.inversor) p.inversor = { ...b.inversor, ...(a.fc !== undefined ? { fc: a.fc } : {}), ...(a.delta !== undefined ? { delta: a.delta } : {}) };
    if (a.Zs !== undefined) p.Zs = a.Zs;
    if (a.Zp !== undefined && b.reducao.estagios.length) p.reducao = { ...b.reducao, estagios: [{ ...b.reducao.estagios[0], Zp: a.Zp }, ...b.reducao.estagios.slice(1)] };
    if (a.excentricidade !== undefined) p.excentricidade = a.excentricidade;
    if (a.desgaste !== undefined && b.escovas) p.escovas = { ...b.escovas, desgaste: a.desgaste };
    if (a.detune !== undefined) {
      if (b.helice) p.helice = { ...b.helice, detune: b.helice.detune.map((d) => d * a.detune!) };
      else p.detune = a.detune;
    }
    return p;
  }
  get tipoPortador() { return this.base.portador.tipo; }
  modosPermitidos(): ModoModulacao[] { return Inversor.permitidos(this.base); }
  modoAtual(): ModoModulacao | null { return this.modulacao ?? this.base.inversor?.modo ?? null; }
  vMax() { return this.base.vMaxKmh ?? (this.tipoPortador === 'trem' ? 120 : 160); }
  massaPortador() { const p = this.base.portador; return p.tipo === 'carro' ? p.massa : p.tipo === 'trem' ? p.massaTotal : 0; }

  /** cfg calibrado (sonda do nível: ~10–50 ms), guardado por preset, edições e taxa */
  cfg(fs: number): CfgEletrico {
    const p = this.preset();
    const chave = `${p.id}|${JSON.stringify(this.avancado)}|${fs}`;
    let c = this.cache.get(chave);
    if (!c) { c = prepararMotorEletrico(p, fs); this.cache.set(chave, c); if (this.cache.size > 24) this.cache.delete(this.cache.keys().next().value!); }
    return c;
  }

  /** monta o portador aqui também: corpo, fontes e as calibrações do trem (para não calibrar no worklet) */
  private sondar(fs: number) {
    const cfg = this.cfg(fs);
    this.cfgAtual = cfg;
    let base: Partial<ConfigTrem> = { faces: 'duas', ladoOuvinte: 1 };
    const p = montarPortadorEletrico(cfg, fs, base, undefined, { pneusAero: this.pneusAero });
    if (p instanceof Trem) {
      base = { ...base, calibracao: p.calibracoes() };
      this.tremCfg = base;
    } else this.tremCfg = null;
    this.corpo = p.corpo; this.fontes = p.fontes();
    this.fsSonda = fs;
  }
  private mandarPreset() {
    const a = this.audio; if (!a) return;
    const fs = a.ctx.sampleRate;
    if (this.fsSonda !== fs || !this.cfgAtual || this.cfgAtual !== this.cfg(fs)) this.sondar(fs);
    this.send({ type: 'preset', cfg: this.cfgAtual, trem: this.tremCfg ?? undefined, pneusAero: this.pneusAero });
  }

  carregarPreset(p: PresetEletrico) {
    this.base = p; this.presetId = p.id; this.familia = p.family; this.avancado = {};
    this.modulacao = null;
    this.avas = p.avas === undefined ? 'desligado' : p.avas ?? 'desligado';
    this.carga = 'plano'; this.cargaBancada = 0;
    this.re = false; this.impor = false; this.vKmh = 0; this.freio = 0;
    if (p.portador.tipo === 'drone') this.acel = 0.5;
    else this.acel = 0;
    if ((this.ouvinte === 'cabine') && !this.temCabine()) this.ouvinte = 'fora';
    this.ambiente = p.portador.tipo === 'bancada' ? 'hangar' : p.portador.tipo === 'trem' && p.family === 'trens' && this.ambiente === 'hangar' ? 'estacao' : this.ambiente;
    this.sondar(this.audio?.ctx.sampleRate ?? 48000);
    this.mandarPreset();
    this.mandarInput();
    this.mandarEletrico();
    this.mandarCena(true);
    this.avisar('painel', 'presets', 'estado');
  }
  setFamilia(id: string) {
    if (id === this.familia) return;
    const p = PRESETS_ELETRICO.find((x) => x.family === id);
    if (p) this.carregarPreset(p);
  }
  private tAvancado: ReturnType<typeof setTimeout> | undefined;
  editarAvancado(patch: Avancado) {
    Object.assign(this.avancado, patch);
    this.presetId = '';
    clearTimeout(this.tAvancado);
    this.tAvancado = setTimeout(() => { this.sondar(this.audio?.ctx.sampleRate ?? 48000); this.mandarPreset(); this.mandarEletrico(); }, 300);
    this.avisar('presets');
  }

  // ---------------------------------------------------------- comando
  async ligar() {
    const a = await this.initAudio();
    await a.retomar();
    this.ign = !this.ign;
    this.mandarInput();
    this.avisar('estado');
  }
  setAcel(v: number) { this.acel = clamp(v, 0, 1); this.mandarInput(); this.avisar('estado'); }
  setFreio(v: number) { this.freio = clamp(v, 0, 1); this.mandarInput(); this.avisar('estado'); }
  setModulacao(m: ModoModulacao) { this.modulacao = m; this.mandarEletrico(); this.avisar('painel'); }
  ciclarModo() { const ms = this.modosPermitidos(); if (!ms.length) return; const i = ms.indexOf(this.modoAtual()!); this.setModulacao(ms[(i + 1) % ms.length]); }
  setAvas(m: ModoAvasPagina) { this.avas = m; this.mandarEletrico(); this.avisar('painel'); }
  setCarga(c: IdCarga) { this.carga = c; this.mandarEletrico(); this.avisar('painel'); }
  setCargaBancada(f: number) { this.cargaBancada = f; this.mandarEletrico(); this.avisar('painel'); }
  setV(kmh: number) { this.vKmh = kmh; if (this.impor) this.mandarEletrico(); }
  setImpor(b: boolean) { this.impor = b; this.mandarEletrico(); this.avisar('painel'); }
  setRe(b: boolean) { this.re = b; this.mandarEletrico(); this.avisar('painel'); }
  setPneus(b: boolean) {
    this.pneusAero = b;
    if (this.tipoPortador === 'carro') { this.sondar(this.audio?.ctx.sampleRate ?? 48000); this.mandarPreset(); this.mandarEletrico(); this.mandarCena(false); }
    this.avisar('painel');
  }
  setMaster(m: number) { this.master = m; this.send({ type: 'params', master: m }); }

  private mandarInput() { this.send({ type: 'input', acelerador: this.acel, freio: this.freio, ignicao: this.ign }); }
  comandoEletrico() {
    const c: Record<string, unknown> = { modulacao: this.modulacao, avas: this.avas };
    if (this.tipoPortador === 'bancada') c.cargaFracao = this.cargaBancada;
    else if (this.tipoPortador === 'carro' || this.tipoPortador === 'trem') {
      c.inclinacao = this.carga === 'sub3' ? 0.03 : this.carga === 'sub6' ? 0.06 : 0;
      c.massaExtra = this.carga === 'lotacao' ? 0.2 * this.massaPortador() : 0;
    }
    c.velocidadeImposta = this.impor && this.tipoPortador !== 'bancada' && this.tipoPortador !== 'drone' ? this.vKmh / 3.6 : null;
    if (this.tipoPortador === 'carro') c.re = this.re;
    return c;
  }
  private mandarEletrico() { this.send({ type: 'eletrico', ...this.comandoEletrico() }); }

  // ---------------------------------------------------------- cena
  temCabine() { return this.tipoPortador === 'carro' || this.tipoPortador === 'trem'; }
  /** fonte do motor para o ouvinte "cofre/sob o assoalho" */
  fonteMotor() { return this.fontes.find((f) => /^(motor|tracao)/.test(f.id))?.id ?? this.fontes[0]?.id ?? 'corpo'; }
  ouvinteCena(): Ouvinte {
    const larg = this.corpo.segmentos[0]?.largura ?? 2, L = this.corpo.comprimento;
    const base = { modo: 'gimbal' as const, pos: [0, 0, 1.6] as const, binaural: true };
    if (this.ouvinte === 'cabine' && this.temCabine()) return { ...base, gimbal: { az: 0, el: 0, r: Math.max(0.3, L / 2 - Math.min(8, L / 4)), alvo: 'corpo' }, local: 'cabine' };
    if (this.ouvinte === 'cofre') return { ...base, gimbal: { az: 90, el: 0, r: 0.5, alvo: this.fonteMotor() }, local: 'cofre' };
    if (this.ouvinte === 'gimbal') return { ...base, gimbal: { az: this.gimbal.az, el: this.gimbal.el, r: this.gimbal.r, alvo: 'corpo' }, local: 'fora' };
    return { ...base, gimbal: { az: 90, el: 0, r: 7.5 + larg / 2, alvo: 'corpo' }, local: 'fora' };
  }
  trajCena(): Trajetoria { return { ...TRAJ_PAGINA, altitude: this.tipoPortador === 'drone' ? 10 : 0 }; }
  setOuvinte(o: IdOuvinte) { this.ouvinte = o; this.mandarCena(false); this.avisar('painel'); }
  setGimbal(g: Partial<ControleEletrico['gimbal']>) { Object.assign(this.gimbal, g); if (this.ouvinte === 'gimbal') this.mandarCena(false); }
  setAmbiente(a: IdAmbienteEletrico) { this.ambiente = a; this.mandarCena(true); this.avisar('painel'); }
  private ambEnviado = '';
  mandarCena(ir = false) {
    const a = this.audio; if (!a) return;
    const amb = ambienteEletrico(this.ambiente);
    this.send({ type: 'cena', amb, traj: this.trajCena(), ouv: this.ouvinteCena() });
    if (ir || amb.id !== this.ambEnviado) { a.aplicarRespostaPorBanda(amb); this.ambEnviado = amb.id; }
  }

  // ---------------------------------------------------------- áudio
  async initAudio(): Promise<CadeiaDeAudio> {
    if (this.audio) return this.audio;
    if (!this.promessa) {
      this.promessa = this.iniciar!().then((a) => {
        this.audio = a;
        this.send({ type: 'params', master: this.master });
        this.mandarCena(true);
        this.mandarPreset();
        this.mandarInput();
        this.mandarEletrico();
        this.avisar('estado');
        return a;
      }, (e) => { this.promessa = null; this.erro = String(e?.message || e); this.avisar('estado'); throw e; });
    }
    return this.promessa;
  }
  onTelemetria = (m: any) => {
    if (!m || m.type !== 'telemetria') return;
    this.tele = { cena: m.cena, portador: m.portador, t: performance.now() };
  };

  // ---------------------------------------------------------- teclado
  keydown = (e: KeyboardEvent) => {
    const alvo = e.target as HTMLElement | null;
    if (alvo && ((alvo.tagName === 'INPUT' && (alvo as HTMLInputElement).type !== 'range') || alvo.tagName === 'SELECT' || alvo.tagName === 'TEXTAREA')) return;
    if (e.code === 'Space') { if (alvo?.tagName === 'BUTTON' || e.repeat) return; e.preventDefault(); this.ligar(); }
    else if (e.code === 'ArrowUp') { e.preventDefault(); this.setAcel(this.acel + 0.1); }
    else if (e.code === 'ArrowDown') { e.preventDefault(); this.setAcel(this.acel - 0.1); }
    else if (e.code === 'KeyR' && !e.repeat) this.setFreio(1);
    else if (e.code === 'KeyM' && !e.repeat) this.ciclarModo();
  };
  keyup = (e: KeyboardEvent) => { if (e.code === 'KeyR') this.setFreio(0); };
}

export const FAMILIAS = FAMILIAS_ELETRICO;
export function useTopico(c: ControleEletrico, ...ts: Topico[]) {
  return useSyncExternalStore(c.assinar, () => ts.map((t) => c.versao[t]).join(','));
}
