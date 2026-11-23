// Estado e ações da página do Vapor (docs/VAPOR.md 6), fora do React (o padrão das páginas Diesel, Radial e Passagem):
// o React lê um retrato (`estado`) com useSyncExternalStore e só renderiza de novo quando ele muda; a telemetria do
// worklet fica em `tele` e é desenhada no requestAnimationFrame (mostradores.ts).
//
// Condução (maquinista.ts): ao ligar o som a máquina está em pressão, parada, regulador fechado, sentido Frente e corte
// automático (a página faz com a reversão o que o maquinista faria). O dono dirige pelo regulador (a alavanca do palco,
// W/S), pelo sentido (Frente, Ponto morto, Ré), pelo freio de segurar (Espaço) e pelo apito de segurar (H). Quem quiser
// a reversão à mão desliga o automático ou pega a alavanca (A/D, ou o controle do painel).
//
// Demonstrações (os roteiros que eram os "cenários"): programam os comandos no tempo e DEVOLVEM a máquina ao dono no fim
// ou quando ele mexe num controle de condução (regulador, sentido, reversão, corte automático, freio, apito): soltam a
// velocidade fixa, calam o apito, devolvem a reversão ao automático (ou à posição do dono) e restauram o que mudaram
// fora da condução (fogo, freio aplicado, sino, torneiras, auxiliares, rampa, ouvinte junto à via). O regulador fica
// onde a demonstração o deixou: a máquina segue andando, agora com o dono.
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
import { PRESETS_VAPOR, presetVapor, escapesPorVolta, vColetorPadrao, type PresetVapor, type FamiliaVapor, type PortadorVapor } from '../../engines/vapor/presets';
import { prepararMotorVapor } from '../../engines/vapor/motor';
import { T_CAUDA, NIVEL_CAUDA, DESAJUSTE_PAR, type ConfigVapor, type ComandoVapor, type TelemetriaVapor } from '../../engines/vapor/dsp';
import { configLocoVapor } from '../../carriers/locomotiva-vapor';
import { configTrator } from '../../carriers/trator';
import { configBarco } from '../../carriers/barco';
import { configCarroDireto } from '../../carriers/carro-direto';
import { CorteAutomatico, CORTE_MAX, CORTE_MIN, SUBIDA_FORTE, type Sentido } from './maquinista';

export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const fmtPct = (x: number) => `${x.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} %`;
export const fmt = (x: number, d = 0) => (Number.isFinite(x) ? x.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
/** reverser (−1..1) do corte desejado (fração do curso, 15–85%) */
export const revDeCorte = (c: number, sentido = 1) => sentido * clamp((c - CORTE_MIN) / (CORTE_MAX - CORTE_MIN), 0, 1);
/** corte (fração do curso) de uma posição da reversão */
export const corteDeRev = (r: number) => CORTE_MIN + (CORTE_MAX - CORTE_MIN) * Math.min(1, Math.abs(r));

export type IdAmbienteVapor = 'ceu' | 'corte' | 'estacao' | 'tunel' | 'ponte';
export const AMBIENTES_VAPOR: { id: IdAmbienteVapor; nome: string }[] = [
  { id: 'ceu', nome: 'Céu aberto' }, { id: 'corte', nome: 'Corte' }, { id: 'estacao', nome: 'Estação' }, { id: 'tunel', nome: 'Túnel' }, { id: 'ponte', nome: 'Ponte' },
];
export type IdCenario = 'parada' | 'arrancada' | 'cruzeiro60' | 'cruzeiro100' | 'drifting' | 'lickey' | 'apito' | 'passagem';
/** as demonstrações: `nome` no botão, `titulo` na dica, `estado` na linha de estado enquanto rodam */
export const CENARIOS: { id: IdCenario; nome: string; titulo: string; estado: string }[] = [
  { id: 'parada', nome: 'Parada', titulo: 'pressão e auxiliares, 60 s: bomba de ar, injetor, segurança, sino e apito', estado: 'parada em pressão (bomba de ar, injetor, segurança, sino e apito)' },
  { id: 'arrancada', nome: 'Arrancada', titulo: 'reversão a 80%, regulador de 20% a 60% em 5 s, torneiras no automático (patina no trilho molhado), 40 s', estado: 'arrancada com a reversão à mão (80 %, 60 %, 45 %)' },
  { id: 'cruzeiro60', nome: 'Cruzeiro a 60', titulo: 'velocidade fixa a 60 km/h, corte 25%, 30 s', estado: 'cruzeiro a 60 km/h (velocidade fixa)' },
  { id: 'cruzeiro100', nome: 'Cruzeiro a 100', titulo: 'velocidade fixa a 100 km/h, corte 20%, 30 s', estado: 'cruzeiro a 100 km/h (velocidade fixa)' },
  { id: 'drifting', nome: 'Regulador fechado', titulo: 'regulador fechado a 60 km/h: rolamento, bielas e o bufo dos cilindros, 30 s', estado: 'regulador fechado a 60 km/h (velocidade fixa)' },
  { id: 'lickey', nome: 'Subida forte', titulo: `a rampa de Lickey: ${fmtPct(SUBIDA_FORTE.rampa)} com ${SUBIDA_FORTE.vagoes} vagões, regulador abrindo até o fim em ${SUBIDA_FORTE.regulador[SUBIDA_FORTE.regulador.length - 1][0]} s, areia e corte automático, ${SUBIDA_FORTE.dur} s`, estado: `subida forte (rampa de ${fmtPct(SUBIDA_FORTE.rampa)}, ${SUBIDA_FORTE.vagoes} vagões, areia)` },
  { id: 'apito', nome: 'Toque de apito', titulo: 'longo, longo, curto, longo (passagem de nível)', estado: 'toque de apito (longo, longo, curto, longo)' },
  { id: 'passagem', nome: 'Passagem', titulo: 'a composição passando a 40 km/h pelo ouvinte parado junto à via', estado: 'passagem a 40 km/h pelo ouvinte parado junto à via (velocidade fixa)' },
];

/** comando da máquina (o que vai ao motor pelo portador) */
export type ComandoPagina = {
  /** regulador pedido pelo dono (a alavanca), 0..1 */
  regulador: number;
  /** reversão à mão (−1..1): vale com o corte automático desligado */
  reverser: number;
  apitoAbertura: number; sino: boolean; areia: boolean;
  torneiras: boolean | 'auto';
  /** freio aplicado que fica (painel); o de segurar é `freando` */
  freio: number;
  fogo: number; fogoAuto: boolean;
  injetor: boolean | 'auto'; bombaAr: boolean | 'auto'; soprador: boolean | 'auto'; simplificacao: boolean;
  trilho: 'seco' | 'molhado'; mixAr: number; mixMec: number;
};

/**
 * campos do escape do preset que o painel muda (docs/REVISAO-DE-SOM.md: todo campo de preset tem controle): o volume do
 * coletor (m³), a cauda de cada chuff (tempo de queda da caixa de fumaça, s, e nível, dB), a tiragem (× o padrão) e, nas
 * de 4 cilindros, o desajuste das válvulas de fora (graus). Ficam fora da sonda de nível: mudam o som, não a calibração
 */
export type EscapePagina = { vColetor: number; tCauda: number; nivelCauda: number; tiragem: number; desajuste: number };
export const escapeDoPreset = (P: PresetVapor): EscapePagina => ({
  vColetor: P.escape.vColetor ?? vColetorPadrao(P), tCauda: P.escape.tCauda ?? T_CAUDA, nivelCauda: P.escape.nivelCauda ?? NIVEL_CAUDA,
  tiragem: P.escape.tiragem ?? 1, desajuste: P.cilindros.desajuste ?? DESAJUSTE_PAR,
});
/** o escape vai para a chaminé (as de condensador e abafador não têm coletor, cauda nem tiragem) */
export const temChamine = (P: PresetVapor) => !P.escape.destino || P.escape.destino === 'chamine';
/** 4 cilindros em pares a 180° (King): a válvula de fora vai por balancim */
export const temPares = (P: PresetVapor) => !P.compound && P.cilindros.n === 4 && !!P.cilindros.angulo && Math.abs(P.cilindros.angulo[1] - P.cilindros.angulo[0]) === 180;

export type EstadoVapor = {
  presetId: string; familia: FamiliaVapor;
  cmd: ComandoPagina;
  escape: EscapePagina;
  vagoes: number; massaVagao: number; rampa: number;   // rampa em %
  marcha: number; carga: number;
  ambiente: IdAmbienteVapor; distancia: number; master: number;
  /** sentido de marcha (vale com o corte automático) */
  sentido: Sentido;
  /** corte automático: a página move a reversão pela velocidade (maquinista.ts) */
  corteAuto: boolean;
  /** demonstração em curso */
  cenario: IdCenario | null;
  calibrando: boolean; erro: string | null;
  /** o que está seguro agora (tecla, botão ou demonstração), para os botões acompanharem */
  apitando: boolean; freando: boolean;
};

export const CMD_PADRAO: ComandoPagina = {
  regulador: 0, reverser: revDeCorte(0.6), apitoAbertura: 1, sino: false, areia: false, torneiras: 'auto', freio: 0, fogo: 0.5, fogoAuto: true,
  injetor: 'auto', bombaAr: 'auto', soprador: 'auto', simplificacao: false, trilho: 'seco', mixAr: 1, mixMec: 1,
};

/** portador do preset (o primeiro dos de uso real) */
export const portadorDe = (P: PresetVapor): Exclude<PortadorVapor, 'nenhum'> => (P.portadores.find((p) => p !== 'nenhum') ?? 'locomotiva') as Exclude<PortadorVapor, 'nenhum'>;
/** o portador tem freio (o trator para no atrito da estrada; o barco, na água ou dando ré) */
export const temFreio = (t: PortadorVapor) => t === 'locomotiva' || t === 'carro';
/** o portador passa ao motor o sino, a areia e as torneiras */
export const temSino = (P: PresetVapor) => portadorDe(P) === 'locomotiva' && !!P.sino;
export const temAreia = (P: PresetVapor) => portadorDe(P) === 'locomotiva';
export const temTorneiras = (P: PresetVapor) => portadorDe(P) === 'locomotiva' || portadorDe(P) === 'trator';

/** Telemetria guardada (a da mensagem 'telemetria' do worklet) */
export interface Tele { cena: any; portador: any; motor: TelemetriaVapor | null; t: number }

/** o que a demonstração mudou fora da condução e volta como estava no fim */
type Retrato = Pick<ComandoPagina, 'fogo' | 'fogoAuto' | 'freio' | 'sino' | 'torneiras' | 'injetor' | 'bombaAr' | 'soprador' | 'areia'> & { rampa: number };

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
  /** velocidade fixa (m/s) das demonstrações de cruzeiro; null = o motor integra a velocidade */
  vFixa: number | null = null;
  /** ouvinte fixo junto à via (demonstração passagem) em vez de acompanhar a máquina */
  fixo = false;
  /** teclas de rampa seguradas: W/S regulador, A/D reverser */
  teclas = { w: false, s: false, a: false, d: false };
  /** a lei do corte automático (refeita a cada preset) */
  auto: CorteAutomatico;
  /** a reversão que foi ao motor por último (o automático só manda quando ela muda) */
  private revEnviada = NaN;
  /** quem segura o apito: o dono (tecla ou botão) e a demonstração */
  private apitoDono = false; private apitoDemo = false;
  /** reversão imposta pela demonstração (null: a do dono, automática ou à mão) */
  private revDemo: number | null = null;
  /** a demonstração deixa a reversão com o corte automático, mesmo com o dono na reversão à mão ("Subida forte") */
  private autoDemo = false;
  /** freio de estacionamento automático: parada na rampa com o regulador fechado */
  freioAuto = 0;
  private tAbriu = 0;
  /** linha do tempo da demonstração: [instante (ms de performance.now), ação], o fim e o retrato a devolver */
  private agenda: [number, () => void][] = [];
  fimDemo = 0;
  private retrato: Retrato | null = null;
  private relogio: ReturnType<typeof setInterval> | undefined;
  private tUlt = 0;
  /** a máquina já andou desde o último preset (a linha de estado diz "Parada" em vez de "Pronta para partir") */
  jaAndou = false;
  /** desde quando está parada com o regulador aberto (ms; 0 = não está) */
  paradaAberta = 0;

  constructor() {
    const P = PRESETS_VAPOR[0];
    this.estado = {
      presetId: P.id, familia: P.familia, cmd: { ...CMD_PADRAO }, escape: escapeDoPreset(P), vagoes: 8, massaVagao: P.vagao?.massa ?? 40, rampa: 0, marcha: 1, carga: 0.5,
      ambiente: 'ceu', distancia: 10, master: 0.8, sentido: 1, corteAuto: true, cenario: null, calibrando: false, erro: null, apitando: false, freando: false,
    };
    this.auto = new CorteAutomatico(P);
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
  /** um controle de condução mexido antes de ligar o som liga o som (o gesto do usuário vale para o AudioContext) */
  private acender() { if (!this.audio) void this.ligar().catch((err) => console.error('Vapor: áudio não iniciou', err)); }

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
    return { rpmNominal: P.rpmNominal ?? P.rpmGovernado ?? 75, potenciaNominal: P.potenciaGerador ?? 500, eta: 0.95, J_alt: 50, semFontes: true, posMotor: [0, 0, 0], corpo: { comprimento: 12, largura: 6, altura: 6, massaSuperficial: 30 } };
  }
  /** monta o portador com o motor no worklet (aloca lá; a sonda roda aqui antes). `parar`: a máquina nova começa parada
   *  (troca de preset, som ligado); senão segue na velocidade de agora (vagões, escape, a marcha do trator) */
  async mandarPortador(parar = false) {
    const a = this.audio; if (!a) return;
    const fs = a.ctx.sampleRate;
    const chave = `${this.estado.presetId}|${fs}`;
    if (!this.cache.has(chave)) {
      this.mudar({ calibrando: true });
      // (deixa o "calibrando…" aparecer antes de ocupar a thread principal com a sonda)
      await new Promise((r) => setTimeout(r, 30));
    }
    let cfg: ConfigVapor;
    try { cfg = this.cfgMotor(fs); } catch (e: any) { this.ignorarAte = 0; this.mudar({ calibrando: false, erro: String(e?.message || e) }); return; }
    // (os campos do escape que o painel muda entram no preset depois da sonda: os ganhos são os da ficha)
    const P = cfg.preset, x = this.estado.escape;
    cfg = { ...cfg, preset: { ...P, escape: { ...P.escape, vColetor: x.vColetor, tCauda: x.tCauda, nivelCauda: x.nivelCauda, tiragem: x.tiragem }, cilindros: { ...P.cilindros, desajuste: x.desajuste } } };
    const c = this.comando();
    a.send({ type: 'portador', tipo: this.portador, config: this.configPortador(), motor: { familia: 'vapor', cfg }, comando: c });
    // O CenaDSP monta o portador novo com a velocidade do anterior imposta (`velocidadeFixa`); se um bloco de áudio rodar
    // antes da próxima mensagem, o motor sai nessa velocidade, senão parado: dependia da sorte (um preset trocado com o
    // trem andando nascia andando ou não). A página impõe a velocidade que quer: ao trocar de máquina, 0, e a segura
    // parada até o regulador abrir (soltar por tempo não basta: montar a máquina no worklet leva às vezes mais de 100 ms,
    // e a ordem de soltar chegava junto com a de parar, depois de um bloco já rodado na velocidade da anterior); ao
    // remontar a mesma (vagões, escape, marcha), a de agora, solta 500 ms depois
    const v = parar ? 0 : (this.tele?.portador?.v as number) ?? 0;
    a.send({ type: 'comando', ...c, velocidadeFixa: this.vFixa ?? v });
    if (this.vFixa == null) {
      if (parar && this.portador !== 'gerador') { this.presaParada = true; this.soltarVEm = 0; }
      else this.soltarVEm = performance.now() + 500;
    }
    if (parar) this.ignorarAte = performance.now() + 150;
    this.revEnviada = c.cutoff as number;
    this.mudar({ calibrando: false, erro: null });
  }

  // ---------------------------------------------------------------- comando
  /** o regulador que vai ao motor: em ponto morto (com o automático) a reversão no meio ainda admite vapor (corte de
   *  15 %), então a página manda o regulador fechado; a alavanca fica onde o dono a deixou (maquinista.ts) */
  reguladorEfetivo() { const e = this.estado; return e.corteAuto && e.sentido === 0 && this.revDemo == null ? 0 : e.cmd.regulador; }
  /** a reversão que vai ao motor: a da demonstração, a do automático ou a do dono */
  reversaoEfetiva() { const e = this.estado; return this.revDemo ?? (e.corteAuto || this.autoDemo ? this.auto.reversao(e.sentido) : e.cmd.reverser); }
  /** o comando completo da máquina e do portador */
  comando(): Partial<ComandoVapor> & Record<string, unknown> {
    const c = this.estado.cmd, e = this.estado, reg = this.reguladorEfetivo();
    return {
      pedal: reg, regulador: reg, cutoff: this.reversaoEfetiva(), apito: e.apitando ? c.apitoAbertura : 0, sino: c.sino, areia: c.areia,
      torneiras: c.torneiras, fogo: c.fogoAuto ? 'auto' : c.fogo, injetor: c.injetor, bombaAr: c.bombaAr, soprador: c.soprador,
      freio: e.freando ? 1 : Math.max(c.freio, this.freioAuto), simplificacao: c.simplificacao, trilho: c.trilho, mixAr: c.mixAr, mixMec: c.mixMec,
      rampa: e.rampa / 100, marcha: this.portador === 'trator' ? e.marcha : undefined, cargaFracao: this.portador === 'gerador' ? e.carga : undefined,
    };
  }
  private mandarComando(agora = false) { if (agora) this.enviarPendente(true); else this.pend = true; }
  /** quando soltar a velocidade imposta ao remontar o portador (mandarPortador) */
  private soltarVEm = 0;
  /** a máquina nova está segura parada (velocidade imposta 0) até o regulador abrir */
  presaParada = false;
  /** até quando a telemetria que chega ainda é a da máquina anterior (ms) */
  private ignorarAte = 0;
  private enviarPendente(forcar = false) {
    const a = this.audio;
    if (a && this.soltarVEm && performance.now() >= this.soltarVEm) { this.soltarVEm = 0; if (this.vFixa == null) a.send({ type: 'comando', velocidadeFixa: null }); }
    // (o regulador abriu: a máquina segura parada sai; a ordem de soltar vai antes do comando com o regulador)
    if (a && this.presaParada && this.reguladorEfetivo() > 0.02) { this.presaParada = false; if (this.vFixa == null) a.send({ type: 'comando', velocidadeFixa: null }); }
    if (!(this.pend || forcar) || !this.audio) return;
    this.pend = false;
    const c = this.comando();
    this.revEnviada = c.cutoff as number;
    this.audio.send({ type: 'comando', ...c });
  }

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

  // ---------------------------------------------------------------- condução (o dono; cada uma devolve a máquina se uma demonstração estiver rodando)
  /** o regulador (a alavanca do palco, W/S, o controle do painel) */
  moverRegulador(v: number, agora = false) {
    this.assumir(); this.acender();
    const r = clamp(v, 0, 1);
    if (r !== this.estado.cmd.regulador) this.setCmd({ regulador: r }, agora);
  }
  fecharRegulador() { this.moverRegulador(0, true); }
  /** sentido de marcha (com o corte automático); escolher um sentido com o automático desligado o liga de novo */
  escolherSentido(s: Sentido) {
    this.assumir(); this.acender();
    this.mudar({ sentido: s, corteAuto: true });
    this.auto.zerar();
    this.mandarComando(true);
  }
  /** liga ou desliga o corte automático; desligado, a reversão à mão começa onde o automático estava */
  setCorteAuto(on: boolean) {
    this.assumir(); this.acender();
    if (on === this.estado.corteAuto) return;
    if (on) { const r = this.estado.cmd.reverser; this.mudar({ corteAuto: true, sentido: Math.abs(r) < 0.02 ? 0 : r > 0 ? 1 : -1 }); this.auto.zerar(); }
    else this.mudar({ corteAuto: false, cmd: { ...this.estado.cmd, reverser: this.auto.reversao(this.estado.sentido) } });
    this.mandarComando(true);
  }
  /** a reversão à mão (A/D, o controle do palco e o do painel): pegar a alavanca desliga o automático */
  moverReversao(v: number, agora = false) {
    this.assumir(); this.acender();
    const r = clamp(v, -1, 1);
    this.mudar({ corteAuto: false, cmd: { ...this.estado.cmd, reverser: r } });
    this.mandarComando(agora);
  }
  /** freio de segurar (Espaço, botão do palco) */
  frear(on: boolean) {
    if (on) { this.assumir(); this.acender(); }
    if (on === this.estado.freando) return;
    this.mudar({ freando: on }); this.mandarComando(true);
  }
  /** freio aplicado que fica (painel) */
  setFreioFixo(v: number) { this.assumir(); this.setCmd({ freio: clamp(v, 0, 1) }); }
  /** apito de segurar (H, botão do palco): soa enquanto seguro */
  apitar(on: boolean) {
    if (on) { this.assumir(); this.acender(); }
    if (on === this.apitoDono) return;
    this.apitoDono = on; this.aplicarApito();
  }
  private aplicarApito() {
    const a = this.apitoDono || this.apitoDemo;
    if (a !== this.estado.apitando) { this.mudar({ apitando: a }); this.mandarComando(true); }
  }
  /** solta tudo o que estava seguro (a janela perdeu o foco, a aba sumiu) */
  soltarTudo() {
    this.teclas.w = this.teclas.s = this.teclas.a = this.teclas.d = false;
    this.apitar(false); this.frear(false); this.areia(false);
  }
  areia(on: boolean) { if (on) this.acender(); if (on === this.estado.cmd.areia) return; this.setCmd({ areia: on }, true); }
  alternarSino() { this.acender(); this.setCmd({ sino: !this.estado.cmd.sino }, true); }
  /** torneiras de purga: automático → abertas → fechadas → automático */
  alternarTorneiras() { this.acender(); const t = this.estado.cmd.torneiras; this.setCmd({ torneiras: t === 'auto' ? true : t === true ? false : 'auto' }, true); }
  alternarInjetor() { const t = this.estado.cmd.injetor; this.setCmd({ injetor: t === true ? false : true }, true); }

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
    this.auto = new CorteAutomatico(P); this.auto.marcha = this.estado.marcha;
    this.jaAndou = false; this.paradaAberta = 0; this.freioAuto = 0; this.tele = null; this.presaParada = false;
    // (a telemetria da máquina anterior fica de fora até a nova estar montada: mandarPortador)
    if (this.audio) this.ignorarAte = Infinity;
    this.mudar({
      presetId: id, familia: P.familia, massaVagao: P.vagao?.massa ?? 40, escape: escapeDoPreset(P), sentido: 1, corteAuto: true,
      cmd: { ...CMD_PADRAO, reverser: P.familia === 'estacionaria' ? revDeCorte(0.3) : CMD_PADRAO.reverser },
    });
    if (this.audio) { this.mandarCena(); void this.mandarPortador(true); }
  }
  setCmd(p: Partial<ComandoPagina>, agora = false) { this.mudar({ cmd: { ...this.estado.cmd, ...p } }); this.mandarComando(agora); }
  setVagoes(n: number) { this.mudar({ vagoes: n }); this.remontar(); }
  /** campos do escape (coletor, cauda, tiragem, desajuste): remonta o motor com o preset mudado */
  setEscape(p: Partial<EscapePagina>) { this.mudar({ escape: { ...this.estado.escape, ...p } }); this.remontar(); }
  setMassaVagao(t: number) { this.mudar({ massaVagao: t }); this.remontar(); }
  private remontarT: ReturnType<typeof setTimeout> | undefined;
  private remontar() { clearTimeout(this.remontarT); this.remontarT = setTimeout(() => void this.mandarPortador(), 150); }
  setRampa(pct: number) { this.mudar({ rampa: pct }); this.mandarComando(); }
  /** marcha do trator (é condução: devolve a máquina). O motor cuida do resto: no N liga o governador de esferas (a
   *  lenta), engatado o desliga e devolve o regulador do dono, e a embreagem engata com a manivela girando
   *  (`VaporDSP.acoplar` e `engatar`; antes o governador ficava ligado e a página montava o motor de novo) */
  setMarcha(m: number) {
    this.assumir(); this.acender();
    if (m === this.estado.marcha) return;
    this.mudar({ marcha: m }); this.auto.marcha = m;
    this.mandarComando(true);
  }
  setCarga(f: number) { this.acender(); this.mudar({ carga: f }); this.mandarComando(true); }
  setAmbiente(a: IdAmbienteVapor) { this.mudar({ ambiente: a }); this.mandarCena(); }
  setDistancia(d: number) { this.mudar({ distancia: d }); this.pendCena = true; }
  setMaster(m: number) { this.mudar({ master: m }); this.audio?.send({ type: 'params', master: m }); }
  private pendCena = false;

  // ---------------------------------------------------------------- a cada quadro
  /** rampas das teclas seguradas, corte automático, freio de estacionamento, agenda da demonstração, envio do pendente */
  quadro(agora: number) {
    const dt = this.tUlt ? Math.min(0.1, (agora - this.tUlt) / 1000) : 0;
    this.tUlt = agora;
    const t = this.teclas, c = this.estado.cmd;
    if (t.w !== t.s) this.moverRegulador(c.regulador + (t.w ? 1 : -1) * dt);
    if (t.a !== t.d) this.moverReversao((this.estado.corteAuto ? this.auto.reversao(this.estado.sentido) : c.reverser) + (t.d ? 1 : -1) * 0.8 * dt);
    this.conduzir(dt, agora);
    this.agendar(agora);
    this.enviarPendente();
    if (this.pendCena && this.audio) { this.pendCena = false; this.audio.send({ type: 'cena', traj: this.trajetoria(), ouv: this.ouvinte() }); }
  }
  /** o corte automático e o freio de estacionamento, pela telemetria */
  private conduzir(dt: number, agora: number) {
    const m = this.tele?.motor, p = this.tele?.portador, e = this.estado;
    if (!m || !p || this.portador === 'gerador') return;
    const v = p.v as number, reg = this.reguladorEfetivo();
    // (com a velocidade imposta pela demonstração a lei não mede aceleração de verdade: recomeça quando ela solta)
    if (this.vFixa == null) this.auto.passo(dt, { voltasRoda: m.voltasPorS as number, v, sentido: e.sentido, regulador: reg, rampa: e.rampa, freando: e.freando || e.cmd.freio > 0.05, patinando: m.patinando });
    // (presa parada, a telemetria com velocidade ainda é a da máquina anterior)
    if (Math.abs(v) > 1 / 3.6 && !this.presaParada) this.jaAndou = true;
    const parada = Math.abs(v) < 0.5 / 3.6;
    this.paradaAberta = parada && reg > 0.02 && !e.freando ? this.paradaAberta || agora : 0;
    // freio de estacionamento: parada na rampa com o regulador fechado, a página segura a máquina no freio; solta 1 s
    // depois que o regulador abre (o vapor leva esse tempo para encher a caixa de válvulas)
    if (reg <= 0.02) this.tAbriu = 0; else if (!this.tAbriu) this.tAbriu = agora;
    const segura = temFreio(this.portador) && Math.abs(e.rampa) > 0.1 && this.vFixa == null && !e.cenario && (parada || this.freioAuto > 0) && (reg <= 0.02 || agora - this.tAbriu < 1000);
    const fa = segura ? 0.5 : 0;
    if (fa !== this.freioAuto) { this.freioAuto = fa; this.pend = true; }
    const r = this.reversaoEfetiva();
    if (!(Math.abs(r - this.revEnviada) < 0.004)) this.pend = true;
  }

  // ---------------------------------------------------------------- demonstrações
  /** processa a agenda (do quadro e, com a aba escondida, de um relógio de 250 ms: o requestAnimationFrame para) */
  private agendar(agora: number) {
    while (this.agenda.length && this.agenda[0][0] <= agora) this.agenda.shift()![1]();
    if (this.estado.cenario && agora >= this.fimDemo) this.terminarDemo();
  }
  /** o dono mexeu num controle de condução: a demonstração acaba e devolve a máquina */
  assumir() { if (this.estado.cenario) this.terminarDemo(); }
  /** para a demonstração (o botão dela de novo, outro preset) */
  pararCenario() { if (this.estado.cenario) this.terminarDemo(); }
  /** devolve a máquina: solta a velocidade fixa, cala o apito da demonstração, devolve a reversão e o que foi mudado */
  private terminarDemo() {
    this.agenda = []; clearInterval(this.relogio); this.relogio = undefined;
    const a = this.audio;
    if (this.vFixa != null) { this.vFixa = null; a?.send({ type: 'comando', velocidadeFixa: null }); }
    this.apitoDemo = false; this.revDemo = null; this.autoDemo = false; this.auto.zerar();
    if (this.fixo) { this.fixo = false; this.mandarCena(); }
    const r = this.retrato;
    this.retrato = null;
    if (r) {
      const { rampa, ...cmd } = r;
      this.mudar({ cmd: { ...this.estado.cmd, ...cmd }, rampa });
    }
    this.mudar({ cenario: null });
    this.aplicarApito();
    this.mandarComando(true);
  }
  /** ações das demonstrações (não contam como o dono mexendo) */
  private demoCmd(p: Partial<ComandoPagina>) { this.mudar({ cmd: { ...this.estado.cmd, ...p } }); this.mandarComando(true); }
  private demoApito(on: boolean) { this.apitoDemo = on; this.aplicarApito(); }
  private demoCorte(c: number) { this.revDemo = revDeCorte(c, this.estado.sentido === -1 ? -1 : 1); this.mandarComando(true); }

  async cenario(id: IdCenario) {
    await this.ligar();
    this.pararCenario();
    const c0 = this.estado.cmd;
    this.retrato = { fogo: c0.fogo, fogoAuto: c0.fogoAuto, freio: c0.freio, sino: c0.sino, torneiras: c0.torneiras, injetor: c0.injetor, bombaAr: c0.bombaAr, soprador: c0.soprador, areia: c0.areia, rampa: this.estado.rampa };
    const t0 = performance.now(), em = (s: number, f: () => void) => this.agenda.push([t0 + s * 1000, f]);
    const P = this.P, a = this.audio!;
    const livre = () => { this.vFixa = null; this.presaParada = false; a.send({ type: 'comando', velocidadeFixa: null }); };
    const fixar = (kmh: number) => { this.vFixa = kmh / 3.6; this.presaParada = false; a.send({ type: 'comando', velocidadeFixa: this.vFixa }); };
    // (um sentido escolhido: a demonstração anda para a frente se o dono deixou em ponto morto)
    if (this.estado.sentido === 0) this.mudar({ sentido: 1 });
    let dur = 30;
    if (id === 'parada') {
      this.demoCmd({ regulador: 0, freio: 0.5, torneiras: 'auto', fogoAuto: false, fogo: 1, injetor: 'auto', bombaAr: 'auto', soprador: 'auto', sino: false });
      fixar(0); em(0.5, livre);
      em(8, () => this.demoCmd({ sino: true })); em(16, () => this.demoCmd({ sino: false }));
      em(25, () => this.demoApito(true)); em(27, () => this.demoApito(false));
      dur = 60;
    } else if (id === 'arrancada') {
      fixar(0); em(0.3, livre);
      this.demoCmd({ regulador: 0, torneiras: 'auto', freio: 0, areia: false }); this.demoCorte(0.8);
      for (let k = 0; k <= 10; k++) em(1 + k * 0.5, () => this.demoCmd({ regulador: 0.2 + 0.04 * k }));
      em(15, () => this.demoCorte(0.6));
      em(25, () => this.demoCorte(0.45));
      dur = 40;
    } else if (id === 'cruzeiro60' || id === 'cruzeiro100') {
      const v = id === 'cruzeiro60' ? 60 : 100;
      fixar(Math.min(v, P.vMax));
      this.demoCmd({ regulador: 0.9, torneiras: false, freio: 0 }); this.demoCorte(v === 60 ? 0.25 : 0.2);
    } else if (id === 'drifting') {
      fixar(Math.min(60, P.vMax));
      this.demoCmd({ regulador: 0, torneiras: false, freio: 0 }); this.demoCorte(0.4);
    } else if (id === 'lickey') {
      // o roteiro está em maquinista.ts (SUBIDA_FORTE), o mesmo que o teste roda offline: segura parada enquanto o vapor
      // enche os cilindros, abre o regulador aos poucos, areia a subida toda e o corte com o automático
      const S = SUBIDA_FORTE;
      if (this.portador === 'locomotiva' && this.estado.vagoes !== S.vagoes) { this.mudar({ vagoes: S.vagoes }); await this.mandarPortador(); }
      this.mudar({ rampa: S.rampa, sentido: 1 });
      fixar(0); em(S.segura, livre);
      this.auto.zerar();
      if (S.corte === 'auto') this.autoDemo = true; else this.demoCorte(S.corte);
      this.demoCmd({ regulador: S.regulador[0][1], torneiras: 'auto', freio: 0, areia: S.areia });
      for (const [t, r] of S.regulador.slice(1)) em(t, () => this.demoCmd({ regulador: r }));
      dur = S.dur;
    } else if (id === 'apito') {
      let t = 0.2;
      for (const d of [1.6, 1.6, 0.5, 2.6]) { em(t, () => this.demoApito(true)); em(t + d, () => this.demoApito(false)); t += d + 0.45; }
      dur = t + 0.5;
    } else if (id === 'passagem') {
      // a composição parte 120 m antes do ouvinte parado e passa a 40 km/h
      this.fixo = true; this.mandarCena();
      const L = this.comprimentoComposicao();
      a.send({ type: 'params', posicao: -120 - L / 2 });
      fixar(Math.min(40, P.vMax));
      this.demoCmd({ regulador: 1, torneiras: false, freio: 0 }); this.demoCorte(0.4);
      dur = (L + 260) / (Math.min(40, P.vMax) / 3.6);
    }
    this.fimDemo = t0 + dur * 1000;
    this.mudar({ cenario: id });
    // (a agenda anda também com a aba escondida, quando o requestAnimationFrame para: o apito não fica preso)
    clearInterval(this.relogio);
    this.relogio = setInterval(() => { this.agendar(performance.now()); this.enviarPendente(); }, 250);
  }
  /** segundos que faltam da demonstração */
  restanteDemo() { return this.estado.cenario ? Math.max(0, (this.fimDemo - performance.now()) / 1000) : 0; }
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
    // (a telemetria do portador antigo ainda chega por uns quadros depois de trocar de máquina: fica de fora)
    if (performance.now() < this.ignorarAte) return;
    this.tele = { cena: m.cena, portador: m.portador, motor: m.portador?.motor ?? null, t: performance.now() };
  };
}
