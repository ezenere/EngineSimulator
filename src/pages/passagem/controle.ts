// Estado e lógica da página Passagem / modo de testes, fora do React (o padrão das páginas Ronco e
// Turbina): os componentes assinam tópicos e só renderizam de novo quando o tópico é avisado; a
// telemetria do worklet fica num campo e é desenhada no requestAnimationFrame (cena 3D e mostradores).
//
//   painel   → o painel inteiro (troca de portador, preset, "voltar ao padrão")
//   presets  → a barra de presets e de portadores
//   ouvinte  → a seção "Você" e a trajetória (modo do observador, pontos de vista, local)
//   estado   → botão de disparar/parar e o rótulo
//
// O ouvinte é o observador em primeira pessoa (observador.ts): a câmera da cena 3D é o olho dele e o ouvinte da Cena é
// o ouvido (modo 'livre' da Cena), com a cabeça para onde ele olha. As teclas (andar, voar, embarcar, pontos de vista)
// são tratadas aqui; o mouse e o toque, em entrada.ts, sobre o canvas. As ferramentas (teste:passagem) podem pedir o
// ouvinte fixo de antes (`ouvinteFixo`), ao lado da via na lateral do preset.
//
// Mensagens para o worklet (src/scene/dsp-cena.ts): 'portador' (monta, com as calibrações feitas aqui
// na thread principal), 'cena' (ambiente, trajetória e ouvinte; o worklet faz rampas de 20 ms e segue o ouvinte
// livre entre as amostras), 'comando' (velocidade fixa, coletivo), 'params' (master, posição do corpo) e 'ar'
// (umidade, temperatura). O ouvinte que anda vai no máximo a cada INTERVALO_OUVINTE ms; sliders, no máximo um por quadro.
import { useSyncExternalStore } from 'react';
import type { CadeiaDeAudio } from '../../ui';
import type { Ambiente, Ouvinte, Trajetoria, FonteSonora, TelemetriaCena, LocalOuvinte, Solo, Vec3 } from '../../scene/tipos';
import { Observador, OUVIDO_ABAIXO, type Destino, type ModoObservador } from './observador';
import { Lugar } from './lugar';
import { qualCenario, type Cenario } from './mundo/planta';
import { pontoDeChegada, pontosDeVista, assento, type PontoDeVista } from './pontos';
import type { Corpo, Portador, TelemetriaPortador, FamiliaMotor } from '../../carriers/tipos';
import { ambientePassagem } from '../../scene/ambientes';
import { Via, PontoVia } from '../../scene/trajetoria';
import { Trem, TREM_PADRAO, maxVagoes, type ConfigTrem } from '../../carriers/trem';
import { Rotor, type CargaRotor } from '../../carriers/rotor';
import { CarroLegado, configCarroLegado } from '../../carriers/carro';
import { montarMotor, montarPortadorComMotor } from '../../scene/dsp-cena';
import { PRESETS_RADIAL } from '../../engines/radial/presets';
import { PRESETS_ROTATIVO } from '../../engines/rotativo/presets';
import { PRESETS_AVIACAO } from '../../engines/ronco/presets';
import { configHelice, configRotor } from '../../engines/ronco/aviacao';
import { PRESETS as PRESETS_RONCO } from '../../engines/ronco/presets';
import { PRESETS as PRESETS_DIESEL } from '../../engines/diesel/presets';
import { PRESETS_TURBINA } from '../../engines/turbina/presets';
// Elétrico (etapa 6)
import { PRESETS_ELETRICO } from '../../engines/eletrico/presets';
// (vapor, etapa 5)
import { presetVapor } from '../../engines/vapor/presets';
import { calibrarMotor, calibracaoInstantanea, type PedidoCalibracao } from './calibracao';
export { configPortadorVapor };
import type { ComandoVapor } from '../../engines/vapor/dsp';
import { configPortadorVapor } from '../../carriers/portadores-vapor';
import {
  PRESETS_PASSAGEM, TREM_PAGINA_PADRAO, situacaoPortador, motoresProntos, presetsDoMotor, MOTOR_PADRAO,
  type IdAmbientePagina, type IdPortadorPagina, type PresetPassagem, type TremPagina,
} from './presets';

export const fmt = (x: number, d = 0) => (Number.isFinite(x) ? x.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');

export type Topico = 'painel' | 'presets' | 'ouvinte' | 'estado';

/** padrões do modo de testes por portador (CENA.md 3.1) */
export interface PadroesPortador { traj: Trajetoria; vKmh: number; ambiente: IdAmbientePagina; x0: number }
export const PADROES: Record<IdPortadorPagina, PadroesPortador> = {
  trem: { traj: { tipo: 'reta', comprimento: 3000, raioCurva: 2000, lateral: 3, altitude: 0, sentido: 1 }, vKmh: 350, ambiente: 'tunel', x0: 600 },
  // helicóptero: o que o CENA dá para o avião (reta de 6000 m, altitude 150 m, passa por cima)
  rotor: { traj: { tipo: 'reta', comprimento: 6000, raioCurva: 2000, lateral: 0, altitude: 150, sentido: 1 }, vKmh: 150, ambiente: 'ceu', x0: 800 },
  // carro: volta de 800 m com curvas de 60 m, 6 m do eixo (CENA 3.1), velocidade "do motor" (aqui a da passagem)
  carro: { traj: { tipo: 'volta', comprimento: 800, raioCurva: 60, lateral: 5.1, altitude: 0, sentido: 1 }, vKmh: 108, ambiente: 'ceu', x0: 150 },
  helice: { traj: { tipo: 'reta', comprimento: 6000, raioCurva: 2000, lateral: 0, altitude: 150, sentido: 1 }, vKmh: 300, ambiente: 'ceu', x0: 1500 },
  aviao: { traj: { tipo: 'reta', comprimento: 6000, raioCurva: 2000, lateral: 0, altitude: 150, sentido: 1 }, vKmh: 300, ambiente: 'ceu', x0: 2000 },
  gerador: { traj: { tipo: 'reta', comprimento: 400, raioCurva: 2000, lateral: 7.5, altitude: 0, sentido: 1 }, vKmh: 0, ambiente: 'ceu', x0: 0 },
  locomotiva: { traj: { tipo: 'volta', comprimento: 2000, raioCurva: 400, lateral: 5, altitude: 0, sentido: 1 }, vKmh: 60, ambiente: 'ceu', x0: 300 },
  // (vapor: trator numa estrada de terra a 8 km/h; barco num canal a 20 m)
  trator: { traj: { tipo: 'reta', comprimento: 600, raioCurva: 2000, lateral: 5, altitude: 0, sentido: 1 }, vKmh: 6, ambiente: 'ceu', x0: 40 },
  barco: { traj: { tipo: 'reta', comprimento: 2000, raioCurva: 2000, lateral: 20, altitude: 0, sentido: 1 }, vKmh: 20, ambiente: 'ceu', x0: 200 },
  // Elétrico: o drone passa devagar a 10 m de altura
  drone: { traj: { tipo: 'reta', comprimento: 1000, raioCurva: 2000, lateral: 0, altitude: 10, sentido: 1 }, vKmh: 20, ambiente: 'ceu', x0: 60 },
};
export const AR_PADRAO = { ur: 60, temperatura: 20 };
/** o ouvinte fixo de antes (as ferramentas: `ouvinteFixo`), e de onde saem binaural e alvo do ouvinte livre */
export const OUVINTE_PADRAO: Ouvinte = { modo: 'fixo', pos: [0, 0, 1.6], gimbal: { az: 90, el: 0, r: 8, alvo: 'corpo' }, local: 'auto', binaural: true };
/** ms: intervalo mínimo entre duas amostras do ouvinte que anda (a Cena segue entre elas) */
export const INTERVALO_OUVINTE = 33;

/** teclas do observador (o mapa da ajuda na tela) */
export const TECLAS: readonly (readonly [string, string])[] = [
  ['W A S D / setas', 'andar'], ['Shift', 'correr (voar mais rápido)'], ['mouse', 'olhar (clique na cena; Esc solta)'],
  ['V', 'voar ou voltar a pé'], ['E / Q', 'subir / descer (voando)'], ['B', 'embarcar / desembarcar'],
  ['1–9', 'pontos de vista'], ['Espaço', 'disparar a passagem'], ['R', 'repetir'], ['T', 'vista técnica'], ['H', 'esta ajuda'],
];

/** Telemetria guardada da última mensagem, com o instante de chegada. */
export interface Tele { cena: TelemetriaCena; portador: TelemetriaPortador; pressao: { max: number; min: number; nariz: number; tunel: number }; lado: number; t: number }

export class ControlePassagem {
  // ------------------------------------------------------------ estado
  portador: IdPortadorPagina = 'trem';
  motor: FamiliaMotor = 'nenhum';
  trem: TremPagina = { ...TREM_PAGINA_PADRAO, pantografos: [...TREM_PAGINA_PADRAO.pantografos] };
  coletivo = 0.75;
  // motor (portadores com motor): preset da família e comando
  motorPreset: string | null = null;
  pedal = 1;
  marcha = 3;
  notch = 8;
  cargaFracao = 0.5;
  /** (Elétrico) freio elétrico na passagem e partida parada (a velocidade vem do motor) */
  freio = 0; partida = false;
  /** (vapor) comando da máquina e vagões da composição */
  vapor: Partial<ComandoVapor> & { vagoes?: number } = { regulador: 1, cutoff: 0.3, vagoes: 8 };
  /** mensagem do motor para o worklet: o cfg calibrado (1–9 s de sonda, guardado por preset, portador e taxa) */
  private motorMsg: { familia: FamiliaMotor; cfg: Record<string, any> } | null = null;
  private cacheMotor = new Map<string, Record<string, any>>();
  /**
   * (AUDITORIA.md P-07) Calibração fora da thread principal: a página põe aqui o Web Worker (calibracao.worker.ts).
   * Com ele, um motor ainda não calibrado é pedido ao worker e o portador só é montado (aqui e no worklet) quando o cfg
   * chega; enquanto isso fica o de antes e `calibrando` é verdadeiro. Sem ele (Node: os testes), calibra na hora.
   */
  calibrador: ((p: PedidoCalibracao) => Promise<Record<string, any>>) | null = null;
  /** o motor pedido ainda está calibrando no worker (o portador montado é o anterior) */
  calibrando = false;
  private pedidos = new Set<string>();
  /** o ajuste dos padrões ao motor (C-03) espera o cfg chegar */
  private ajustarPendente = false;
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
  /** fonte destacada (a do Doppler nas leituras; null = a mais próxima) */
  fonteFicha: string | null = null;
  /** o observador em primeira pessoa: a câmera da cena 3D e o ouvinte da Cena */
  obs = new Observador();
  /**
   * (ferramentas) manda à Cena o ouvinte fixo de antes, parado ao lado da via na lateral do preset e de frente para ela,
   * em vez do observador: `npm run teste:passagem` mede os presets com ele, e os números continuam os mesmos
   */
  ouvinteFixo = false;
  /** relógio da página (s): o instante de cada amostra do observador, para a Cena descontar a demora da mensagem */
  relogio = () => performance.now() / 1000;
  /** vista técnica (cena 3D): marcadores das fontes e a linha da trajetória; desligada por padrão */
  vistaTecnica = false;
  /** ajuda das teclas na tela: o instante (ms) em que foi pedida (some sozinha) */
  ajudaDesde = 0;

  // derivados (sonda do portador na thread principal: geometria, fontes e calibrações)
  corpo!: Corpo;
  fontes: readonly FonteSonora[] = [];
  private calibracao: number[] = [];
  /** (C-03) câmbio do carro com motor de câmbio, carga do rotor e potência do motor (W) do helicóptero */
  private cambio: { ratios: number[]; final: number; rw: number; redline: number } | null = null;
  private rotorCarga: CargaRotor | null = null;
  private motorPotencia: number | null = null;
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
    this.irParaChegada();
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
    this.calibrando = false;
    // o motor (e o cfg calibrado dele) primeiro: se ainda calibra no worker, fica tudo como estava (o portador de antes)
    const trem = this.portador === 'trem', semMotor = (this.portador === 'rotor' && this.motor === 'nenhum') || (trem && this.motor !== 'eletrico');
    let cfg: Record<string, any> | null = null;
    if (!semMotor) {
      const fam = this.motor, id = trem ? (this.motorPreset ?? MOTOR_PADRAO.eletrico?.trem ?? 'n700') : (this.motorPreset ?? MOTOR_PADRAO[fam]?.[this.portador] ?? presetsDoMotor(this.portador, fam)[0]?.id ?? null);
      this.motorPreset = id;
      if (id) { cfg = this.cfgMotor(fam, id, fs); if (!cfg) return; }
    }
    this.rotorCfg = null;
    this.motorMsg = null;
    this.cambio = null; this.rotorCarga = null; this.motorPotencia = null;
    if (this.portador === 'rotor' && this.motor === 'nenhum') { const r = new Rotor(fs); p = r; this.rotorCfg = { R: r.cfg.R, Rc: r.cfg.Rc, B: r.cfg.B, posRotor: r.cfg.posRotor, posCauda: r.cfg.posCauda }; }
    else if (this.portador !== 'trem') {
      // portador com motor: o mesmo que o worklet monta (geometria e fontes), com o motor calibrado
      this.motorMsg = cfg ? { familia: this.motor, cfg } : null;
      p = montarPortadorComMotor(this.portador, this.configPortador(), montarMotor(this.motorMsg ?? undefined, fs), fs)!;
      if (p instanceof Rotor) this.rotorCfg = { R: p.cfg.R, Rc: p.cfg.Rc, B: p.cfg.B, posRotor: p.cfg.posRotor, posCauda: p.cfg.posCauda };
      // (C-03) câmbio do carro e carga do rotor, para ajustar os padrões ao motor (ajustarAoMotor)
      const d = p instanceof CarroLegado ? (p.motor?.dsp as unknown as { ratios: number[]; final: number; rw: number; redline: number } | undefined) : undefined;
      this.cambio = d && d.ratios?.length > 1 ? { ratios: [...d.ratios], final: d.final, rw: d.rw, redline: d.redline } : null;
      this.rotorCarga = p instanceof Rotor ? p.cargaR : null;
      this.motorPotencia = p instanceof Rotor && Number.isFinite(this.motorMsg?.cfg.power) ? this.motorMsg!.cfg.power * 1000 : null;
    } else if (this.motor === 'eletrico') {
      // trem com o motor elétrico (etapa 6): o mesmo que o worklet monta (montarPortadorComMotor), com as calibrações dele
      this.trem.N = Math.min(this.trem.N, this.maxVagoes());
      this.motorMsg = { familia: 'eletrico', cfg: cfg! };
      const t = montarPortadorComMotor('trem', this.configTrem(), montarMotor(this.motorMsg, fs), fs) as Trem;
      this.calibracao = t.calibracoes();
      p = t;
    } else {
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
    if (this.fsSonda !== a.ctx.sampleRate || this.calibrando) this.sondar(a.ctx.sampleRate);
    if (this.calibrando) return;   // o worker ainda não devolveu o cfg: manda quando chegar (calibrou)
    if (this.portador === 'rotor' && this.motor === 'nenhum') a.send({ type: 'portador', tipo: 'rotor' });
    else if (this.portador === 'trem') a.send({ type: 'portador', tipo: 'trem', config: { ...this.configTrem(), calibracao: this.calibracao }, ...(this.motorMsg ? { motor: this.motorMsg, comando: this.comandoMotor() } : {}) });
    else a.send({ type: 'portador', tipo: this.portador, config: this.configPortador(), motor: this.motorMsg, comando: this.comandoMotor() });
  }

  /**
   * cfg do motor pronto para o worklet: geometria, calibração e nível absoluto (caro: guardado por preset, portador e
   * taxa). Com o worker: devolve null e pede; quando chega, `calibrou()` monta de novo.
   */
  private cfgMotor(fam: FamiliaMotor, id: string, fs: number): Record<string, any> | null {
    const pedido: PedidoCalibracao = { fam, id, portador: this.portador, fs };
    const chave = `${fam}|${id}|${this.portador}|${fs}`;
    const cfg = this.cacheMotor.get(chave);
    if (cfg) return cfg;
    if (!this.calibrador || calibracaoInstantanea(fam)) { const c = calibrarMotor(pedido); this.cacheMotor.set(chave, c); return c; }
    this.calibrando = true;
    if (!this.pedidos.has(chave)) {
      this.pedidos.add(chave);
      this.calibrador(pedido).then(
        (c) => { this.cacheMotor.set(chave, c); this.pedidos.delete(chave); this.calibrou(); },
        // (o worker falhou: calibra aqui, como antes; trava, mas toca)
        () => { this.pedidos.delete(chave); this.calibrador = null; this.calibrou(); },
      );
    }
    return null;
  }
  /** o cfg chegou do worker: monta o portador com ele, se ainda é o motor pedido (senão o sondar pede o novo) */
  private calibrou() {
    this.sondar();
    if (this.calibrando) { this.avisar('estado'); return; }
    if (this.ajustarPendente) { this.ajustarAoMotor(); this.ajustarPendente = false; }
    // (o ponto de chegada foi calculado com o corpo de antes: refeito com o novo, se o observador não saiu dele)
    if (this.chegadaPendente) this.irParaChegada(true);
    this.mandarPortador();
    this.mandarComando();
    this.avisar('presets', 'painel', 'ouvinte', 'estado');
  }
  /** (C-03) ajusta os padrões ao motor agora, ou quando o cfg chegar */
  private ajustarSePronto() {
    if (this.calibrando) this.ajustarPendente = true;
    else { this.ajustarAoMotor(); this.ajustarPendente = false; }
  }
  /** configuração do portador que vem do preset do motor (hélice do turboélice, alternador, tabela de notches) */
  configPortador(): Record<string, any> {
    const id = this.motorPreset;
    if (this.motor === 'vapor') return configPortadorVapor(this.portador, id, this.vapor.vagoes ?? 8);
    // hélice e rotor dos motores a pistão (radial, aviação do Ronco): a do preset (RADIAL.md 3.3 e 5.2), no nariz do avião
    const pist: any = this.motor === 'radial' ? PRESETS_RADIAL.find((x) => x.id === id) : this.motor === 'pistao' ? PRESETS_AVIACAO.find((x) => x.id === id) : this.motor === 'rotativo' ? PRESETS_ROTATIVO.find((x) => x.id === id) : null;
    if (pist && this.portador === 'helice' && pist.helice) return { ...configHelice(pist), posMotor: [2.5, 0, 1.5], posCubo: [3.3, 0, 1.5] };
    if (pist && this.portador === 'rotor' && pist.rotor) return configRotor(pist);
    if (this.portador === 'helice') { const t = PRESETS_TURBINA.find((x) => x.id === id); return t ? { B: t.propB, D: t.propD, nHelice: t.propRpm } : {}; }
    if (this.portador === 'gerador' && this.motor === 'rotativo') { const g = (PRESETS_ROTATIVO.find((x) => x.id === id) as any)?.gerador; return g ? { polos: g.polos, fRede: g.fRede, potenciaNominal: g.kWe, eta: g.eta, J_alt: g.J, ventilador: { B: 8, D: 0.15 }, ranhuras: 24, posMotor: [0, 0, 0.6] } : {}; }
    if (this.portador === 'gerador') { const g = (PRESETS_DIESEL.find((x) => x.id === id) as any)?.gerador; return g ? { polos: g.polos, fRede: g.fRede, potenciaNominal: g.kWe, eta: g.eta } : {}; }
    // (locomotiva: a tabela por notch e a potência são as da ficha do motor, que o portador lê do MotorDiesel; aqui só o
    // rendimento do gerador de tração, e o nome da tabela para o caso sem motor)
    if (this.portador === 'locomotiva') { const l = (PRESETS_DIESEL.find((x) => x.id === id) as any)?.locomotiva; return { motor: id === 'ge7fdl' ? 'ge7fdl' : 'emd710', ...(l ? { etaGer: l.eta } : {}) }; }
    // carro com motor de câmbio: pneus e vento pela ficha (AUDITORIA.md C-06/K-12; src/carriers/carro.ts)
    if (this.portador === 'carro' && (this.motor === 'pistao' || this.motor === 'diesel' || this.motor === 'radial' || this.motor === 'rotativo')) {
      const L: readonly any[] = this.motor === 'pistao' ? PRESETS_RONCO : this.motor === 'diesel' ? PRESETS_DIESEL : this.motor === 'radial' ? PRESETS_RADIAL : PRESETS_ROTATIVO;
      return configCarroLegado(L.find((x) => x.id === id));
    }
    return {};
  }
  /** comando do motor pelo portador (CENA 1.6): o carro parado fica em ponto morto e em lenta */
  comandoMotor() {
    if (this.motor === 'vapor') return { pedal: this.vapor.regulador ?? 1, ...this.vapor, marcha: this.portador === 'trator' ? 1 : undefined, cargaFracao: this.portador === 'gerador' ? this.cargaFracao : undefined };
    if (this.portador === 'carro') return this.andando ? { pedal: this.pedal, marcha: this.marcha } : { pedal: 0, marcha: 0 };
    if (this.portador === 'locomotiva') return { pedal: 0, notch: this.notch as 0 };
    if (this.portador === 'gerador') return { pedal: 0, cargaFracao: this.cargaFracao };
    if (this.portador === 'rotor') return { pedal: this.coletivo };
    // (Elétrico) freio elétrico da passagem (o metrô chegando)
    if (this.motor === 'eletrico') return { pedal: this.pedal, freio: this.freio, ignicao: true };
    return { pedal: this.pedal };
  }
  /** família do motor (no carro: pistão ou diesel) */
  setMotor(f: FamiliaMotor) {
    if (f === this.motor || !motoresProntos(this.portador).includes(f)) return;
    this.motor = f; this.motorPreset = MOTOR_PADRAO[f]?.[this.portador] ?? presetsDoMotor(this.portador, f)[0]?.id ?? null;
    this.presetId = null;
    this.sondar(); this.ajustarSePronto(); this.mandarPortador(); this.mandarComando();
    this.avisar('presets', 'painel', 'estado');
  }
  setMotorPreset(id: string) {
    if (id === this.motorPreset) return;
    this.motorPreset = id; this.presetId = null;
    this.sondar(); this.ajustarSePronto(); this.mandarPortador(); this.mandarComando();
    this.avisar('presets', 'painel', 'estado');
  }

  /**
   * (AUDITORIA.md C-03) Os padrões do portador (PADROES) ajustados ao motor escolhido, no modo de testes: sem isso o carro
   * passava a 108 km/h em 3ª com qualquer motor preso às rodas (um Scania a 11 773 rpm, o Fusca acima do corte) e o trem a
   * 350 km/h com o metrô de 90. A partir da velocidade padrão do portador:
   *  - carro com câmbio (Ronco, Diesel, radial, rotativo): a marcha mais curta que deixe o motor, pé no fundo, abaixo de
   *    70% do corte (o Camaro do preset fica em 61%); se nem a última deixa, a velocidade baixa até a última dar os 70%;
   *  - veículo com velocidade máxima na ficha (elétricos `vMaxKmh`, vapor `vMax`): a velocidade fica abaixo dela;
   *  - helicóptero: o coletivo de pairado (0,75) se o motor tem potência para ele; senão, o que pede 90% da potência.
   * Os presets de passagem trazem os valores deles e não passam por aqui.
   */
  private ajustarAoMotor() {
    const p = this.portador, cb = this.cambio;
    let v = PADROES[p].vKmh;
    const vMax = this.vMaxMotor();
    if (vMax && v > vMax) v = vMax;
    if (p === 'carro' && cb) {
      const rpm = (kmh: number, g: number) => (kmh / 3.6 / cb.rw) * cb.ratios[g] * cb.final * 9.549;
      const teto = 0.7 * cb.redline, nG = cb.ratios.length - 1;
      let g = 1;
      while (g < nG && rpm(v, g) > teto) g++;
      if (rpm(v, g) > teto) v = Math.floor(teto / rpm(1, g));
      this.marcha = g;
    }
    this.vKmh = Math.max(1, Math.round(v));
    if (p === 'rotor') this.coletivo = 0.75;
    if (p === 'rotor' && this.motorPotencia && this.rotorCarga) {
      // potência pedida pelo rotor no coletivo c (a conta da CargaRotor), contra a do motor
      const r = this.rotorCarga!, alvo = 0.9 * this.motorPotencia;
      let c = 0.75;
      r.c = c;
      while (c > 0.3 && r.potencias((r.cfg.Nr * 2 * Math.PI) / 60).total > alvo) { c -= 0.01; r.c = c; }
      this.coletivo = Math.round(c * 100) / 100;
    }
  }
  /** velocidade máxima do veículo na ficha do motor (km/h), quando há */
  private vMaxMotor(): number | null {
    const id = this.motorPreset;
    if (!id) return null;
    if (this.motor === 'eletrico') return (PRESETS_ELETRICO.find((x) => x.id === id) as { vMaxKmh?: number } | undefined)?.vMaxKmh ?? null;
    if (this.motor === 'vapor') { const P = presetVapor(id); return P && P.familia !== 'estacionaria' ? (P.vMax ?? null) : null; }
    return null;
  }
  setPedal(v: number) { this.pedal = v; this.mandarComando(); }
  setMarcha(n: number) { this.marcha = n; this.mandarComando(); }
  setNotch(n: number) { this.notch = n; this.mandarComando(); }
  setCarga(f: number) { this.cargaFracao = f; this.mandarComando(); }
  setFreio(f: number) { this.freio = f; this.mandarComando(); }

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
    this.motorPreset = MOTOR_PADRAO[this.motor]?.[p] ?? null;
    this.freio = 0; this.partida = false;
    const d = PADROES[p];
    this.traj = { ...d.traj }; this.vKmh = d.vKmh; this.ambiente = d.ambiente; this.x0 = d.x0; this.solo = soloPadrao(p);
    this.via.configurar(this.traj);
    this.ouv.gimbal.alvo = 'corpo';
    this.presetId = null;
    this.sondar();
    this.ajustarSePronto();
    this.irParaChegada();
    this.mandarPortador();
    this.mandarCena(true);
    this.mandarComando();
    this.avisar('presets', 'painel', 'ouvinte', 'estado');
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
    // (o lugar mudou: paredes, plataforma e tabuleiro são outros; o observador volta ao ponto de chegada)
    this.irParaChegada();
    this.mandarCena(true);
    this.avisar('presets', 'painel', 'ouvinte');
  }
  setSolo(s: Solo['tipo'] | null) { this.solo = s; this.presetId = null; this.mandarCena(true); this.avisar('painel', 'presets'); }
  setTunel(patch: Partial<ControlePassagem['tunel']>) { Object.assign(this.tunel, patch); if (this.obs.modo !== 'embarcado') this.irParaChegada(); this.mandarCena(false); }
  setRt(k: number) { this.rtFator = k; this.mandarCena(true); }

  // ---------------------------------------------------- trajetória
  setTraj(patch: Partial<Trajetoria>, estrutural = false) {
    const lado0 = this.traj.sentido;
    this.traj = { ...this.traj, ...patch };
    this.via.configurar(this.traj);
    this.presetId = null;
    this.pendCena = true;
    // a via mudou de forma ou a lateral do ponto de chegada mudou: o observador vai para o ponto de chegada novo
    if (estrutural || patch.lateral != null) this.irParaChegada();
    if (estrutural || lado0 !== this.traj.sentido) { this.mandarCena(false); this.avisar('painel', 'presets', 'ouvinte'); }
    else this.avisar('ouvinte', 'presets');   // sliders e placa acompanham
  }
  setV(kmh: number) { this.vKmh = kmh; this.presetId = null; if (this.andando) this.mandarComando(); this.avisar('presets'); }
  setColetivo(c: number) { this.coletivo = c; this.mandarComando(); }
  setAr(patch: Partial<ControlePassagem['ar']>) { Object.assign(this.ar, patch); this.audio?.send({ type: 'ar', ...this.ar }); }
  setMaster(m: number) { this.master = m; this.audio?.send({ type: 'params', master: m }); }

  // ------------------------------------------------------- ouvinte
  /** binaural e o fixo das ferramentas (o ouvinte livre leva a cabeça do observador) */
  setOuvinte(patch: Partial<Ouvinte>) {
    this.ouv = { ...this.ouv, ...patch, pos: [...(patch.pos ?? this.ouv.pos)] as unknown as Vec3, gimbal: { ...this.ouv.gimbal, ...(patch.gimbal || {}) } };
    this.pendCena = true;
    this.avisar('ouvinte');
  }
  /** filtro do local no ponto em que o observador está ('auto': cabine dentro do corpo, senão fora) */
  setLocal(l: Ouvinte['local']) { this.obs.local = l; this.ouv.local = l; this.obs.mudou = true; this.pendOuv = true; this.enviarPendentes(); this.avisar('ouvinte'); }
  escolherFonte(id: string | null) { this.fonteFicha = id; this.avisar('ouvinte'); }

  /** o ouvinte que vai para a Cena: o ouvido do observador (modo 'livre') ou, nas ferramentas, o fixo de antes */
  ouvinte(): Ouvinte {
    if (this.ouvinteFixo) return this.ouv;
    const o = this.obs, D = 180 / Math.PI;
    return {
      modo: 'livre', pos: this.ouv.pos, gimbal: { ...this.ouv.gimbal, alvo: o.alvo }, local: o.local, binaural: this.ouv.binaural,
      livre: {
        ref: o.modo === 'embarcado' ? 'corpo' : 'mundo', pos: [o.pos[0], o.pos[1], o.pos[2] - OUVIDO_ABAIXO],
        vel: [o.velReal[0], o.velReal[1], o.velReal[2]], rumo: o.rumo * D, salto: o.salto, t: this.relogio(),
      },
    };
  }

  // ---------------------------------------------------- observador
  private lugarCache: { chave: string; l: Lugar } | null = null;
  /** o lugar onde o observador anda (paredes, plataforma, tabuleiro), refeito quando ambiente, via ou corpo mudam */
  lugar(): Lugar {
    const amb = this.ambienteCena(), w = this.corpo.segmentos[0]?.largura ?? 2, mChegada = this.traj.lateral + w / 2, cenario = this.cenario();
    const chave = JSON.stringify([amb.id, amb.tunel, this.traj.tipo, this.traj.comprimento, this.traj.raioCurva, this.traj.sentido, w, mChegada, cenario]);
    if (this.lugarCache?.chave !== chave) this.lugarCache = { chave, l: new Lugar({ ambiente: amb.id, via: this.via, tunel: amb.tunel, larguraCorpo: w, mChegada, cenario }) };
    return this.lugarCache.l;
  }
  /** o cenário em volta da via (mundo/planta.ts): a rua do carro, o aeródromo, a ferrovia, o pátio… */
  cenario(): Cenario {
    return qualCenario({ ambiente: this.ambiente, portador: this.portador, motor: this.motor, motorPreset: this.motorPreset, altitude: this.traj.altitude });
  }
  /** o ponto de chegada do preset (ou do portador), recalculado agora */
  pontoDeChegada(): Destino { return pontoDeChegada(this); }
  private chegadaPendente = false; private chegadaSalto = -1;
  /**
   * põe o observador no ponto de chegada (a pé, olhando o veículo chegar). `seNaoSaiu`: só se ele ainda está no ponto em
   * que a última chegada o pôs (a calibração do motor terminou e o corpo mudou de medida)
   */
  irParaChegada(seNaoSaiu = false) {
    if (seNaoSaiu && this.obs.salto !== this.chegadaSalto) { this.chegadaPendente = false; return; }
    this.obs.ir(pontoDeChegada(this)); this.obs.volta = null;
    this.chegadaSalto = this.obs.salto; this.chegadaPendente = this.calibrando;
    this.pendOuv = true;
    this.avisar('ouvinte');
  }
  /** os pontos de vista do painel e das teclas 1–9 (os que existem neste portador e neste lugar) */
  pontosDeVista(): PontoDeVista[] { return pontosDeVista(this).filter((p) => p.ok); }
  irPara(p: PontoDeVista) {
    if (!p.ok || !p.ir) return;
    const d = p.ir();
    if (d.modo === 'embarcado' && this.obs.modo === 'embarcado') { const v = this.obs.volta; this.obs.ir(d); this.obs.volta = v; }
    else this.obs.ir(d);
    if (p.id === 'chegada') this.chegadaSalto = this.obs.salto;
    this.pendOuv = true;
    this.enviarPendentes();
    this.avisar('ouvinte');
  }
  /** a pé ↔ voo (embarcado: desembarca para voar) */
  alternarVoo() {
    const o = this.obs;
    if (o.modo === 'embarcado') { this.desembarcar(); }
    o.modo = o.modo === 'voo' ? 'pe' : 'voo';
    if (o.modo === 'voo') o.pos[2] += 0.3;   // sai do chão
    o.mudou = true; this.pendOuv = true;
    this.avisar('ouvinte');
  }
  setModoObservador(m: ModoObservador) {
    if (m === this.obs.modo) return;
    if (m === 'embarcado') { this.embarcar(); return; }
    if (this.obs.modo === 'embarcado') this.desembarcar();
    if (this.obs.modo !== m) this.alternarVoo();
  }
  /** embarca no assento (ou junto do motor); de novo, desembarca */
  embarcar() {
    if (this.obs.modo === 'embarcado') { this.desembarcar(); return; }
    this.obs.ir(assento(this));
    this.pendOuv = true; this.enviarPendentes();
    this.avisar('ouvinte');
  }
  desembarcar() {
    this.obs.desembarcar(pontoDeChegada(this));
    this.pendOuv = true; this.enviarPendentes();
    this.avisar('ouvinte');
  }

  /** teclas e toque somados na entrada do observador */
  private teclas = new Set<string>();
  toque = { frente: 0, lado: 0, sobe: 0 };
  atualizarEntrada() {
    const t = this.teclas, e = this.obs.entrada, k = (...c: string[]) => c.some((x) => t.has(x));
    const cl = (x: number) => Math.max(-1, Math.min(1, x));
    e.frente = cl((k('KeyW', 'ArrowUp') ? 1 : 0) - (k('KeyS', 'ArrowDown') ? 1 : 0) + this.toque.frente);
    e.lado = cl((k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0) + this.toque.lado);
    e.sobe = cl((k('KeyE', 'PageUp') ? 1 : 0) - (k('KeyQ', 'PageDown') ? 1 : 0) + this.toque.sobe);
    e.correr = k('ShiftLeft', 'ShiftRight');
  }
  /** avança o observador (o quadro da página) e marca o ouvinte para mandar se ele andou ou olhou */
  passoObservador(dt: number) {
    const o = this.obs;
    o.passo(dt, o.modo === 'embarcado' ? null : this.lugar());
    if (o.mudou) { o.mudou = false; this.pendOuv = true; }
  }
  /** olho no mundo e para onde olha (rumo no mundo, arfagem), com o corpo em s: a câmera da cena 3D */
  olhoNoMundo(s: number, out = { pos: [0, 0, 0] as [number, number, number], rumo: 0, arfagem: 0 }) {
    const o = this.obs;
    if (o.modo === 'embarcado') {
      this.corpoNoMundo(s, o.pos, out.pos);
      const p = this.via.ponto(s + o.pos[0], this.pv);
      out.rumo = Math.atan2(p.ty, p.tx) + o.rumo;
    } else { out.pos[0] = o.pos[0]; out.pos[1] = o.pos[1]; out.pos[2] = o.pos[2]; out.rumo = o.rumo; }
    out.arfagem = o.arfagem;
    return out;
  }
  /** distância (m) do olho do observador ao corpo (à caixa do segmento mais perto), com o corpo em s; 0 dentro */
  distanciaAoCorpo(s: number) {
    const o = this.obs, k = this.corpo, alt = this.traj.altitude;
    let melhor = Infinity, frente = k.comprimento / 2;
    const w = this.olhoNoMundo(s).pos;
    for (const sg of k.segmentos) {
      const xc = frente - sg.comprimento / 2;
      let bx: number, by: number, bz: number;
      if (o.modo === 'embarcado') { bx = o.pos[0] - xc; by = o.pos[1]; bz = o.pos[2]; }
      else { const q = this.via.ponto(s + xc, this.pv), dx = w[0] - q.x, dy = w[1] - q.y; bx = dx * q.tx + dy * q.ty; by = dx * q.nx + dy * q.ny; bz = w[2] - alt; }
      const ex = Math.max(0, Math.abs(bx) - sg.comprimento / 2), ey = Math.max(0, Math.abs(by) - sg.largura / 2), ez = Math.max(0, sg.zPiso - bz, bz - sg.altura);
      melhor = Math.min(melhor, Math.hypot(ex, ey, ez));
      frente -= sg.comprimento + sg.vao;
    }
    return melhor;
  }

  // ----------------------------------------------------- passagem
  /** abscissa da via no ponto do ouvinte: o do observador (embarcado, o do último ponto fora), ou o do fixo */
  sOuvinte() {
    if (this.ouvinteFixo) return this.via.abscissaDe(this.ouv.pos[0]);
    const o = this.obs, p = o.modo === 'embarcado' ? (o.volta?.pos ?? pontoDeChegada(this).pos) : o.pos;
    return this.lugar().projetar(p[0], p[1]).s;
  }
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
  /** põe o corpo em s, ao longo da via (parado) */
  moverCorpo(s: number) {
    this.sMandado = s; this.tMandado = performance.now();
    this.audio?.send({ type: 'params', posicao: s });
  }
  /** onde o nariz está em relação ao observador (m; negativo: ainda antes dele) */
  narizParado() { return Math.round(this.xiNariz(this.estimativa().s)); }
  /** o veículo parado com o nariz a `xi` m do observador (o slider do painel: era o arrasto do corpo na cena) */
  pararCorpoEm(xi: number) {
    if (this.andando) return;
    this.moverCorpo(this.sOuvinte() + xi - this.corpo.comprimento / 2);
  }
  /** campo "onde estou" do painel (o quadro escreve nele) */
  leituraOnde: HTMLElement | null = null;
  private mandarComando() {
    // (Elétrico) partida: andando, a velocidade é a do motor (o Taurus arrancando); parado, presa em 0
    this.audio?.send({ type: 'comando', ...this.comandoMotor(), velocidadeFixa: this.andando ? (this.partida ? null : this.vKmh / 3.6) : 0 });
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
  /** o ouvinte mudou (o observador andou, olhou, saltou) desde a última amostra mandada */
  private pendOuv = false;
  private tOuv = -Infinity; private saltoEnviado = -1;
  private ambEnviado = '';
  /** manda ambiente, trajetória e ouvinte; com `ir`, gera a resposta ao impulso de novo */
  mandarCena(ir = false) {
    this.pendCena = false;
    const a = this.audio; if (!a) return;
    const amb = this.ambienteCena();
    this.pendOuv = false; this.tOuv = performance.now(); this.saltoEnviado = this.obs.salto;
    a.send({ type: 'cena', amb, traj: this.traj, ouv: this.ouvinte() });
    const chave = JSON.stringify([amb.id, amb.solo, amb.reverb.rt60]);
    if (ir || chave !== this.ambEnviado) { a.aplicarRespostaPorBanda(amb); this.ambEnviado = chave; }
  }
  /**
   * chamado a cada quadro: manda o que os sliders mudaram (trajetória e ouvinte) e a amostra do observador, no máximo a
   * cada INTERVALO_OUVINTE ms enquanto ele anda (um salto vai na hora)
   */
  enviarPendentes(agora = performance.now()) {
    const a = this.audio; if (!a) return;
    if (this.pendCena) {
      this.pendCena = false; this.pendOuv = false; this.tOuv = agora; this.saltoEnviado = this.obs.salto;
      a.send({ type: 'cena', traj: this.traj, ouv: this.ouvinte() });
      return;
    }
    if (this.pendOuv && (this.saltoEnviado !== this.obs.salto || agora - this.tOuv >= INTERVALO_OUVINTE)) {
      this.pendOuv = false; this.tOuv = agora; this.saltoEnviado = this.obs.salto;
      a.send({ type: 'cena', ouv: this.ouvinte() });
    }
  }

  // ------------------------------------------------------ presets
  carregarPreset(p: PresetPassagem) {
    if (!situacaoPortador(p.portador).ok) return;
    const mudouPortador = p.portador !== this.portador;
    this.portador = p.portador; this.motor = p.motor;
    this.motorPreset = p.motorPreset ?? MOTOR_PADRAO[p.motor]?.[p.portador] ?? null;
    if (p.pedal != null) this.pedal = p.pedal;
    if (p.marcha != null) this.marcha = p.marcha;
    if (p.notch != null) this.notch = p.notch;
    if (p.cargaFracao != null) this.cargaFracao = p.cargaFracao;
    this.freio = p.freio ?? 0; this.partida = !!p.partida;
    if (p.vapor) this.vapor = { ...p.vapor };
    const d = PADROES[p.portador];
    // (presets de passagem andam numa reta: o corpo vem de longe, passa e some)
    this.traj = { ...d.traj, tipo: p.portador === 'trem' || p.portador === 'rotor' ? d.traj.tipo : 'reta', comprimento: p.portador === 'carro' ? 800 : p.portador === 'locomotiva' ? 2000 : d.traj.comprimento, lateral: p.lateral, altitude: p.altitude ?? d.traj.altitude };
    this.via.configurar(this.traj);
    this.vKmh = p.vKmh; this.ambiente = p.ambiente; this.solo = p.solo ?? null; this.x0 = p.x0 ?? d.x0;
    this.tunel = { area: 64, comprimento: 2000, xEntrada: -500 }; this.rtFator = 1;
    if (p.portador === 'trem') this.trem = { ...TREM_PAGINA_PADRAO, pantografos: [...TREM_PAGINA_PADRAO.pantografos], ...(p.trem || {}) };
    if (p.coletivo != null) this.coletivo = p.coletivo;
    this.ouv = clonarOuvinte(OUVINTE_PADRAO);
    this.presetId = p.id;
    this.ajustarPendente = false;   // (o preset traz os valores dele)
    this.sondar();
    this.irParaChegada();
    this.mandarPortador();
    this.mandarCena(true);
    this.mandarComando();
    void mudouPortador;
    this.avisar('presets', 'painel', 'ouvinte', 'estado');
  }

  /** "voltar ao padrão": todos os parâmetros do modo de testes nos valores do CENA (3.1) para o portador atual */
  voltarAoPadrao() {
    const d = PADROES[this.portador];
    this.traj = { ...d.traj }; this.via.configurar(this.traj);
    this.vKmh = d.vKmh; this.ambiente = d.ambiente; this.x0 = d.x0; this.solo = soloPadrao(this.portador);
    this.tunel = { area: 64, comprimento: 2000, xEntrada: -500 }; this.rtFator = 1;
    this.ar = { ...AR_PADRAO };
    this.trem = { ...TREM_PAGINA_PADRAO, pantografos: [...TREM_PAGINA_PADRAO.pantografos] };
    this.coletivo = 0.75;
    this.ouv = clonarOuvinte(OUVINTE_PADRAO);
    this.presetId = this.portador === 'trem' ? 'trembala-tunel' : null;
    this.ajustarPendente = false;
    this.sondar();
    this.irParaChegada();
    this.audio?.send({ type: 'ar', ...this.ar });
    this.mandarPortador();
    this.mandarCena(true);
    this.mandarComando();
    this.avisar('presets', 'painel', 'ouvinte', 'estado');
  }

  presetsVisiveis() { return PRESETS_PASSAGEM.map((p) => ({ ...p, situacao: situacaoPortador(p.portador) })); }

  // ---------------------------------------------------- geometria
  /** ponto do corpo (referencial do corpo) no mundo, com o corpo em s */
  corpoNoMundo(s: number, b: readonly number[], out: [number, number, number] = [0, 0, 0]) {
    const p = this.via.ponto(s + b[0], this.pv);
    out[0] = p.x + b[1] * p.nx; out[1] = p.y + b[1] * p.ny; out[2] = this.traj.altitude + b[2];
    return out;
  }
  /**
   * local resolvido (o 'auto' do CENA 3.3, como a Cena faz com o ouvinte livre: cabine se o ouvido cai dentro de um
   * segmento, senão fora), com o corpo onde está agora
   */
  localEfetivo(): LocalOuvinte {
    if (this.ouvinteFixo) return this.ouv.local === 'auto' ? 'fora' : this.ouv.local;
    const o = this.obs;
    if (o.local !== 'auto') return o.local;
    const s = this.estimativa().s, k = this.corpo, alt = this.traj.altitude, ouvido = this.olhoNoMundo(s).pos;
    ouvido[2] -= OUVIDO_ABAIXO;
    let frente = k.comprimento / 2;
    for (const sg of k.segmentos) {
      const xc = frente - sg.comprimento / 2;
      let bx: number, by: number, bz: number;
      if (o.modo === 'embarcado') { bx = o.pos[0] - xc; by = o.pos[1]; bz = o.pos[2] - OUVIDO_ABAIXO; }
      else { const q = this.via.ponto(s + xc, this.pv), dx = ouvido[0] - q.x, dy = ouvido[1] - q.y; bx = dx * q.tx + dy * q.ty; by = dx * q.nx + dy * q.ny; bz = ouvido[2] - alt; }
      if (Math.abs(bx) < sg.comprimento / 2 && Math.abs(by) < sg.largura / 2 && bz > sg.zPiso && bz < sg.altura) return 'cabine';
      frente -= sg.comprimento + sg.vao;
    }
    return 'fora';
  }

  // ---------------------------------------------------- teclado
  /** teclas que andam (ficam apertadas) */
  private static ANDA = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'KeyE', 'KeyQ', 'PageUp', 'PageDown']);
  keydown = (e: KeyboardEvent) => {
    const alvo = e.target as HTMLElement | null;
    // (num campo, num seletor ou num slider as teclas são dele: as setas mexem no slider, não no observador)
    if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'SELECT' || alvo.tagName === 'TEXTAREA')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (ControlePassagem.ANDA.has(e.code)) {
      if (e.code.startsWith('Arrow') || e.code.startsWith('Page')) e.preventDefault();
      this.teclas.add(e.code); this.atualizarEntrada();
      return;
    }
    if (e.repeat) return;
    // num botão em foco o Espaço já é o clique dele
    if (e.code === 'Space' && alvo?.tagName === 'BUTTON') return;
    if (e.code === 'Space') { e.preventDefault(); if (this.andando) this.parar(); else this.disparar(); }
    else if (e.code === 'KeyR') this.setRepetir(!this.repetir);
    else if (e.code === 'KeyV') this.alternarVoo();
    else if (e.code === 'KeyB') this.embarcar();
    else if (e.code === 'KeyH') { this.ajudaDesde = performance.now(); this.avisar('ouvinte'); }
    else if (e.code === 'KeyT') { this.vistaTecnica = !this.vistaTecnica; this.avisar('ouvinte'); }
    else if (/^Digit[1-9]$/.test(e.code)) { const p = this.pontosDeVista()[+e.code.slice(5) - 1]; if (p) this.irPara(p); }
  };
  keyup = (e: KeyboardEvent) => { if (this.teclas.delete(e.code)) this.atualizarEntrada(); };
  /** a janela perdeu o foco: nenhuma tecla fica presa */
  soltarTeclas = () => { if (this.teclas.size) { this.teclas.clear(); this.atualizarEntrada(); } };
}

/** solo padrão por portador (null = o do ambiente): asfalto na rua, grama sob o que voa, brita na via, concreto na bancada */
export function soloPadrao(p: IdPortadorPagina): Solo['tipo'] | null {
  return p === 'carro' ? 'asfalto' : p === 'rotor' || p === 'helice' || p === 'aviao' || p === 'drone' ? 'grama' : p === 'gerador' ? 'concreto' : p === 'locomotiva' ? 'brita' : p === 'barco' ? 'agua' : p === 'trator' ? 'grama' : null;
}


export function clonarOuvinte(o: Ouvinte): Ouvinte { return { ...o, pos: [...o.pos] as unknown as Vec3, gimbal: { ...o.gimbal } }; }

// Assina um ou mais tópicos: o componente renderiza de novo quando algum deles é avisado.
export function useTopico(c: ControlePassagem, ...ts: Topico[]) {
  return useSyncExternalStore(c.assinar, () => ts.map((t) => c.versao[t]).join(','));
}
