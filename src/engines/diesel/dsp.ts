// Motor diesel (ignição por compressão), como subclasse do EngineDSP do Ronco (docs/DIESEL.md).
//
// O laço de amostra é o do Ronco: cilindro de zona única, válvulas com escoamento compressível, escape em guias
// de onda, virabrequim, câmbio e ouvintes. Com `cc = true` o laço chama, nos pontos da tabela 1.2, os métodos
// cc* daqui: injeção com atraso de Hardenberg–Hase, queima em Wiebe dupla (pré-misturada + difusão), knock
// estrutural pela taxa de subida de pressão medida no cilindro, tiques de injeção por tipo de bomba, freio-motor
// (borboleta no escape, VGT, Jake, VEB), ciclo de 2 tempos uniflow e turbo diesel. Não há borboleta: o coletor
// segue o turbo e a carga é o combustível por ciclo, que vem do governador (ou do portador, por `combustivel`).
//
// Regra do DSP (a mesma do Ronco): nada do navegador; a taxa entra no construtor; RNG com semente.
import {
  TAU, P0, RGAS, GAM, SOUND_SPEED, clamp, smooth, flow,
  RNG, Biquad, Line, Junction, TwoPort, Radiator, port,
} from '../../acoustics';
import { EngineDSP } from '../ronco/dsp';
import { T_MAN, T_EXREF } from '../ronco/constantes';
import { LHV, ESTEQ, CETANO_PADRAO, K_ATRASO, R_UNIV, BSFC, INJECAO, NOTCH_POT, K_MEC, K_VALV, K_FUNDO, K_VIB, K_CALOR, K_MISTURA, K_TURBINA, K_SOPRO, K_MOD_TURBO, K_CHOQUE } from './constantes';
import { DoisPortasDiesel } from './escape';

// Carga e comando vindos de um portador externo (CENA.md 1.2). TODO(integração carriers/): trocar por
// `import type { Carga } from '../../scene/tipos'` quando a camada de portadores entrar na branch.
export interface CargaExterna { torque(omega: number): number; inercia: number }

const enbw = (fs: number, f: number, q: number) => Math.sqrt(Math.min(1, (Math.PI / 2) * (f / q) / (fs / 2)));

export class DieselDSP extends EngineDSP {
  // estado próprio do diesel (declarados só para o TypeScript, como no EngineDSP)
  declare fuelCmd: any; declare mfMax: any; declare rpmMax: any; declare rpmNom: any; declare mPilMin: any; declare piloto: any; declare idi: any;
  declare eletronico: any; declare cetano: any; declare curso: any; declare limiteFumaca: any; declare injTipo: any; declare inj: any; declare qInj: any;
  declare advFixo: any; declare advInj: any; declare gov: any; declare droop: any; declare tauA: any; declare gI: any; declare gX: any; declare gV: any;
  declare fuelLenta: any; declare fuelPartida: any; declare sobre: any; declare sonda: any; declare combExterno: any; declare cargaExterna: any;
  declare mf: any; declare mPil: any; declare Qp: any; declare Qm: any; declare igP: any; declare igM: any; declare phiP: any; declare dthP: any; declare dthD: any;
  declare eRel: any; declare queima: any; declare etapa: any; declare lam: any; declare arPreso: any; declare pAnt: any; declare pPk: any; declare angPk: any;
  declare dpPk: any; declare fechaRel: any; declare cylK: any; declare knockSrc: any; declare kHP: any; declare kBank: any; declare kW8: any; declare kLP: any;
  declare kEnv: any; declare kPk: any; declare refKnock: any; declare kKnock: any; declare injEnv: any; declare injIn: any; declare injSobe: any; declare injF: any; declare injDec: any; declare injAmp: any;
  declare pumpEnv: any; declare pumpF: any; declare phPump: any; declare phRot: any; declare oilF: any; declare tw: any; declare nTurbo: any; declare turboTipo: any;
  declare turboRpmMax: any; declare turboPas: any; declare turboTau: any; declare gApito: any; declare iEng: any; declare boostR: any; declare soprador: any;
  declare phTT: any; declare tjit: any; declare mExM: any; declare wgAmt: any; declare wgF: any; declare fbF: any; declare freioTipo: any; declare freioOn: any;
  declare freioAtivo: any; declare pBack: any; declare jakeOn: any; declare jakeCil: any; declare kJake: any; declare nJake: any; declare fuelM: any;
  declare lamM: any; declare etaM: any; declare fumaca: any; declare fumacaBranca: any; declare pParcial: any; declare pMaxM: any; declare dpM: any; declare angM: any;
  declare tauM: any; declare tInjM: any; declare tEvoM: any; declare tEvoC: any; declare tEsc: any; declare glow: any; declare glowK: any; declare velas: any;
  declare manual: any; declare portador: any; declare notch: any; declare degrau: any; declare cargaBancada: any; declare rpmAlvoPainel: any; declare rpmAlvo: any;
  declare Pcarga: any; declare Tcarga: any; declare Jcarga: any; declare regCarga: any; declare fRede: any; declare gerCfg: any; declare locCfg: any;
  declare dinamico: any; declare ptBuf: any; declare ptUlt: any; declare ptI: any; declare telN: any; declare classe: any; declare boostAlvo: any; declare partida: any;
  declare gChiado: any; declare lamInst: any; declare subidaTq: any; declare gMec: any; declare g0Rad: any; declare govBancada: any; declare boostD: any; declare aquec: any; declare estadoAnt: any; declare lentaFixa: any; declare vF: any; declare vAmp: any; declare vDec: any; declare vEnv: any; declare fundoF: any; declare fundoAmp: any; declare fundoM: any; declare pumpAmp: any; declare oilAmp: any;
  declare wBuf: any; declare gwI: any; declare wSoma: any; declare wK: any; declare wSomaK: any; declare boostFixo: any; declare queimasBoas: any; declare cicloEv: any; declare lentaBaixa: any; declare kIdi: any; declare kPre: any; declare egtN: any; declare egtD: any; declare egtNs: any; declare egtDs: any; declare soiM: any; declare thInjM: any; declare thMix: any; declare eD: any; declare pInjMax: any; declare injK: any; declare tauK: any; declare injA: any; declare jTurb: any; declare turbNzF: any; declare linTurb: any; declare pTM: any; declare kModT: any; declare zTurb: any; declare uPonta: any; declare whooshF: any; declare turboLenta: any; declare mecLP: any; declare trocaT: any; declare trocaDir: any;

  constructor(fs: number) {
    super(fs);
    this.cc = true; this.tempos = 4; this.ciclo = 720;
    // os ramos cc do laço do EngineDSP chamam estes métodos (propriedades da instância: o EngineDSP só os declara)
    this.ccInjecao = this.injetar; this.ccValvulas = this.valvulas; this.ccQueima = this.queimar; this.ccEscape = this.escapar;
    this.ccAdmissao = this.admitir; this.ccMecanica = this.mecanica; this.ccTurbo = this.turboSom; this.ccDens = this.densidade;
    this.fmepK = 1; this.pmeCarga = 0; this.rpmPartida = 330; this.tParede = 430;
    this.fuelCmd = 0; this.gI = 0.1; this.gX = 0; this.gV = 0; this.sobre = false; this.sonda = false; this.combExterno = null; this.cargaExterna = null;
    this.knockSrc = 0; this.kEnv = 0; this.kPk = 0; this.refKnock = 0; this.injEnv = 0; this.pumpEnv = 0; this.phPump = 0; this.phRot = 0;
    this.tw = 0; this.nTurbo = 0; this.phTT = 0; this.tjit = 0; this.mExM = 1e-6; this.pTM = 1e-6; this.kModT = K_MOD_TURBO; this.wgAmt = 0; this.boostR = 0;
    this.freioOn = false; this.freioAtivo = false; this.pBack = 0; this.jakeOn = false; this.nJake = 6;
    this.fuelM = 0; this.lamM = 10; this.etaM = 0.98; this.fumaca = 0; this.fumacaBranca = 0; this.pParcial = 0;
    this.pMaxM = P0; this.dpM = 0; this.angM = 0; this.tauM = 0; this.tInjM = 0; this.tEvoM = 0; this.tEsc = 20;
    this.velas = 0; this.aquec = 0; this.manual = 0; this.portador = 'carro'; this.notch = 0; this.degrau = 0; this.cargaBancada = 0; this.rpmAlvoPainel = 0; this.rpmAlvo = 0;
    this.Pcarga = 0; this.Tcarga = 0; this.Jcarga = 0; this.regCarga = 1; this.dinamico = false; this.telN = 0; this.boostAlvo = 0;
    this.wBuf = new Float64Array(512); this.gwI = 0; this.wSoma = 0; this.wK = 0; this.wSomaK = 0;
    this.queimasBoas = 0; this.cicloEv = 0; this.egtN = 0; this.egtD = 0; this.egtNs = 0; this.egtDs = 0; this.lentaBaixa = false; this.fuelLenta = 0.1; this.fuelPartida = 0.5;
  }

  // ------------------------------------------------------------------ mensagens
  message(m) {
    if (m.type === 'diesel') return this.comando(m);
    // a troca de marcha só existe com o portador carro
    if (m.type === 'input' && m.shift && this.portador !== 'carro') { const r = { ...m }; delete r.shift; return super.message(r); }
    super.message(m);
  }

  // comandos próprios do diesel (painel ou portador)
  comando(m) {
    if (m.portador !== undefined) this.setPortador(m.portador);
    if (m.notch !== undefined) this.notch = clamp(Math.round(m.notch), 0, 8);
    if (m.lentaBaixa !== undefined) this.lentaBaixa = !!m.lentaBaixa;
    if (m.dinamico !== undefined) this.dinamico = !!m.dinamico;
    if (m.degrau !== undefined) this.degrau = clamp(m.degrau, 0, 1);
    if (m.cargaBancada !== undefined) this.cargaBancada = clamp(m.cargaBancada, 0, 1);
    if (m.rpmAlvo !== undefined) this.rpmAlvoPainel = m.rpmAlvo;
    if (m.freioMotor !== undefined) this.freioOn = !!m.freioMotor;
    if (m.jakeCilindros !== undefined) this.nJake = m.jakeCilindros;
    if (m.manual !== undefined) this.manual = clamp(m.manual, 0, 1);
    if (m.fRede !== undefined) this.fRede = m.fRede;
    if (m.governador !== undefined) this.gov = m.governador;
    if (m.govBancada !== undefined) this.govBancada = m.govBancada;
    if (m.droop !== undefined) this.droop = m.droop;
    // TODO(integração carriers/): ComandoMotor.combustivel do governador do portador (gerador, locomotiva, rotor)
    if (m.combustivel !== undefined) this.combExterno = m.combustivel === null ? null : clamp(m.combustivel, 0, 1);
    this.ajustaJake();
  }

  setPortador(p) {
    const prev = this.portador;
    this.portador = p === 'gerador' || p === 'locomotiva' || p === 'nenhum' ? p : 'carro';
    if (this.portador !== 'carro') { this.gear = 0; this.clutch = 1; this.locked = false; }
    if (prev !== this.portador && this.cfg) this.tune(this.cfg); // (inércia do alternador e governador mudam)
  }

  // portador externo (CENA.md 1.3, `Motor.acoplar`): o torque dele entra como pressão média de freio
  // TODO(integração carriers/): o adaptador motor.ts chama isto com a `Carga` do gerador/locomotiva
  acoplar(carga: CargaExterna | null) {
    this.cargaExterna = carga;
    if (this.cfg) this.tune(this.cfg);
  }

  setIgnition(on) {
    // velas de aquecimento: antes de girar, a espera (só o relé estala), mais longa quanto mais frio (2.8)
    if (on && this.state === 'off' && this.glow && this.velas <= 0 && this.coolant < 50) {
      const frio = clamp((20 - this.coolant) / 40, 0, 1);
      this.velas = (1 + 8 * frio) * this.glowK;
      this.ignition = true; this.clickEnv += 3;
      return;
    }
    if (!on) this.velas = 0;
    if (on && this.state === 'off') { this.gI = this.fuelLenta; this.gX = 0; this.gV = 0; this.rpmAlvo = 0; }
    super.setIgnition(on);
  }

  // ------------------------------------------------------------------ configuração
  setConfig(cfg, calibrate = true) {
    const N = cfg.N;
    const f64 = () => new Float64Array(N);
    this.mf = f64(); this.mPil = f64(); this.Qp = f64(); this.Qm = f64(); this.igP = f64(); this.igM = f64(); this.phiP = f64();
    this.dthP = f64(); this.dthD = f64(); this.soiM = f64(); this.thInjM = new Float64Array(N).fill(1); this.thMix = new Float64Array(N).fill(1); this.eD = f64(); this.eRel = f64(); this.queima = new Uint8Array(N); this.etapa = new Uint8Array(N);
    this.lam = new Float64Array(N).fill(10); this.arPreso = f64(); this.pAnt = new Float64Array(N).fill(P0); this.pPk = f64(); this.angPk = f64();
    this.dpPk = f64(); this.fechaRel = new Float64Array(N).fill(1e9); this.tEvoC = f64();
    // dispersão fixa entre cilindros do knock (±5%, 2.6)
    const sr = new RNG(0xd1e5e1 + N * 131);
    this.cylK = Float64Array.from({ length: N }, () => 1 + 0.05 * sr.bi());
    this.ptBuf = new Float32Array((cfg.tempos === 2 ? 360 : 720) / 4); this.ptUlt = new Float32Array(this.ptBuf.length);
    super.setConfig(cfg, calibrate);
    for (let c = 0; c < N; c++) this.aPrev[c] = ((this.theta - this.fire[c]) % this.ciclo + this.ciclo) % this.ciclo;
    // dispersão fixa entre injetores (DIESEL.md 6.2): vazão de cada injetor/elemento da bomba e o atraso de cada bico
    // (estado do bico, ângulo do jato). Bombas mecânicas calibradas à mão espalham mais que a central do common-rail
    const si = new RNG(0x1d1e5e1 + N * 977);
    const dq = this.injTipo === 'common-rail' ? 0.02 : this.eletronico ? 0.035 : 0.065;
    this.injK = Float64Array.from({ length: N }, () => 1 + dq * si.bi());
    this.tauK = Float64Array.from({ length: N }, () => 1 + 0.07 * si.bi());
    // (o erro de um injetor é em boa parte absoluto, em mg: ~0,3 mg num injetor de 81 mg de plena carga. Em lenta, com
    // 6–8 mg por injeção, isso vira 4–5% de diferença entre cilindros; nas bombas mecânicas, o dobro)
    // (a central eletrônica equaliza os cilindros em lenta pela roda fônica, a "compensação de cilindros": sobra ~1/3)
    const da = this.injTipo === 'common-rail' ? 0.0015 : this.eletronico ? 0.002 : 0.007;
    this.injA = Float64Array.from({ length: N }, () => da * si.bi());
    if (cfg.fuelLenta) this.fuelLenta = cfg.fuelLenta;
    if (cfg.refKnock) this.refKnock = cfg.refKnock;
    this.gI = this.fuelLenta;
  }

  freshStart() {
    super.freshStart();
    this.fuelCmd = 0; this.gI = this.fuelLenta; this.gX = 0; this.gV = 0; this.sobre = false; this.tw = 0; this.boostR = 0; this.boostD = 0; this.pBack = 0;
    this.Pcarga = 0; this.Tcarga = 0; this.regCarga = 1; this.tEsc = this.ambientT; this.rpmAlvo = 0; this.gX = this.gI; this.aquec = 0; this.velas = 0;
    // (troca de preset com o motor ligado: nada do governador, da carga ou do câmbio do motor anterior fica; a página manda
    // o estado de carga do novo preset logo depois)
    this.notch = 0; this.degrau = 0; this.cargaBancada = 0; this.rpmAlvoPainel = 0; this.dinamico = false; this.wgAmt = 0; this.tw = 0; this.nTurbo = 0;
    this.freioAtivo = false; this.jakeOn = false; this.trocaT = 0; this.trocaDir = 0; this.lockOmega = false; this.sonda = false;
  }

  tune(cfg) {
    // geometria da ficha (o Ronco usa curso = diâmetro): mesmo volume deslocado, diâmetro e curso reais
    if (cfg.diametro && this.Vd) {
      const B = cfg.diametro * 1e-3;
      this.bore = B; this.Ap = (Math.PI / 4) * B * B;
      this.curso = this.Vd / this.Ap;
      this.rCrank = this.curso / 2; this.lRod = this.rCrank / 0.3;
      this.Ar = 0.16 * B * B; this.Zr = SOUND_SPEED / this.Ar; this.hw = 900 * this.Ap * 2.5 * K_CALOR; this.Aleak = 1.2e-4 * B * B;
    } else this.curso = this.curso || 2 * (this.rCrank || 0.04);
    this.tempos = cfg.tempos === 2 ? 2 : 4; this.ciclo = this.tempos === 2 ? 360 : 720;
    super.tune(cfg);
    // sem borboleta: um duto aberto, o coletor acompanha o turbo com queda < 1% (1.2 item 3)
    this.Athr *= 8;
    if (this.tempos === 2) {
      const j = cfg.janelas || { evo: 100, ipo: 134, ipc: 226, evc: 232 };
      this.evo = j.evo; this.evc = j.evc; this.ivo = j.ipo; this.ivc = j.ipc;
      this.AexMax *= 1.3; this.AinMax *= 1.6; // 4 válvulas no cabeçote; janelas em volta da camisa
    } else {
      const cam = clamp(cfg.cam || 0, 0, 0.3);
      this.evo = 125 + 10 * cam; this.evc = 372 + 8 * cam; this.ivo = 350 - 8 * cam; this.ivc = 575 + 15 * cam;
    }
    this.classe = cfg.classe || 'leve';
    this.rpmMax = cfg.rpmMax || cfg.redline; this.redline = this.rpmMax;
    this.rpmNom = cfg.rpmPotencia || this.rpmMax * 0.85;
    // ficha: torque e inércia
    if (cfg.torque) this.Tmax = cfg.torque;
    if (cfg.J) this.J = cfg.J + this.Jtc;
    this.limType = 'governor'; this.limiter = false;
    // chiado do jato na abertura da válvula de escape (o "rasgado" do Ronco): no diesel a pressão na abertura é maior
    // em lenta (sem borboleta, 2–3 bar contra 1,5 no gasolina), o Mach do jato satura e o chiado contínuo de 1–2,5 kHz
    // ficava 7–10 dB acima das gravações da GE e dos caminhões em lenta; o diesel tem o gás mais frio e mais lento
    this.valveNoise = 0.02;
    this.hasCat = false; this.catNoise = 1; this.overrun = 'cut'; this.twoStep = false; this.twoStepMode = 'off';
    this.blower = !!cfg.soprador; this.soprador = cfg.soprador || null;
    // combustível máximo por ciclo e cilindro (2.2)
    const bsfc = cfg.bsfc || BSFC[this.classe === 'locomotiva' ? 'locomotiva' : this.classe] || 0.21;
    const injPorS = (this.N * this.rpmNom) / (60 * (this.tempos / 2));
    this.mfMax = ((cfg.power || 100) * bsfc / 3600) / injPorS;
    this.mPilMin = 1.5e-6 * this.mfMax / 81e-6;
    this.subidaTq = 1; // (a subida de torque da ficha nas bombas mecânicas, mesmo só no batente de plena carga, tirava a lenta
    // do F-1000 da janela de ±8% depois das aceleradas e ainda não levava o aspirado a λ < 1,3: fica desligada, ver TECNICO.md)
    this.gMec = Math.pow(10, (cfg.mecanica || 0) / 20);
    this.piloto = !!cfg.piloto; this.idi = !!cfg.idi; this.eletronico = !!cfg.eletronico;
    this.cetano = cfg.cetano || CETANO_PADRAO;
    this.limiteFumaca = cfg.limiteFumaca || 1.25;
    this.injTipo = cfg.injecao || 'common-rail'; this.inj = INJECAO[this.injTipo] || INJECAO['common-rail'];
    // vazão do injetor (mg/ms → kg/ms): common-rail q_max 40 mg/ms no 1GD, escalado pelo combustível máximo
    // (escalado para a injeção de plena carga durar ~32° na rotação de potência: 1GD 81 mg em 36° a 3000 rpm; nos
    // motores grandes e lentos a mesma vazão por mg dava 11° no EMD a 904 rpm, quase tudo pré-misturado)
    this.qInj = (this.mfMax * 0.006 * this.rpmNom) / 32 / (this.idi ? 0.6 : 1) * 1;
    this.kPre = this.piloto ? 0.45 : this.idi ? 0.6 : 1;
    this.pInjMax = ({ 'common-rail': 200, unitaria: 180, heui: 150, rotativa: 90, 'em-linha': 80, pld: 120 } as any)[this.injTipo] || 150;
    this.advFixo = cfg.avanco;
    this.gov = cfg.governador || 'min-max';
    this.droop = cfg.droop ?? 0.08;
    this.tauA = this.eletronico ? 0.02 : 0.15;
    this.rpmPartida = 0.45 * this.idle;
    this.fuelPartida = this.eletronico ? 0.45 : 0.45;
    // turbo
    this.turboTipo = cfg.turboTipo || (this.turbo ? 'wastegate' : 'nenhum');
    this.turboRpmMax = cfg.turboRpmMax || 0; this.turboPas = cfg.turboPas || 0; this.uPonta = cfg.turboPonta || 480; this.turboLenta = cfg.turboLenta || 0.15;
    this.turboTau = cfg.turboTau || [1, 2]; this.gApito = Math.pow(10, (cfg.turboApito || 0) / 20);
    this.iEng = cfg.turboEngrenagem || 0;
    this.gChiado = Math.pow(10, (cfg.turboChiado || 0) / 20);
    // freio-motor
    this.freioTipo = cfg.freioMotor || 'nenhum';
    this.kJake = this.freioTipo === 'veb' ? 0.2 : 0.35;
    if (cfg.jakeCilindros && !cfg.jakeCilindros.includes(this.nJake)) this.nJake = cfg.jakeCilindros[cfg.jakeCilindros.length - 1];
    this.ajustaJake();
    this.glow = !!cfg.glow; this.glowK = cfg.glowK || 1;
    // portador: o do preset, se o atual não servir para ele (tabela 6.3)
    if (cfg.portadores && !cfg.portadores.includes(this.portador)) this.portador = cfg.portadores[0];
    this.gerCfg = cfg.gerador || null; this.locCfg = cfg.locomotiva || null;
    if (this.gerCfg && !this.fRede) this.fRede = this.gerCfg.fRede;
    // inércia do que está no eixo: alternador do gerador (CENA 4.4) ou carga externa
    this.Jcarga = this.cargaExterna ? this.cargaExterna.inercia : this.portador === 'gerador' && this.gerCfg ? this.gerCfg.Jalt : 0;
    this.J += this.Jcarga;
  }

  // cilindros com a janela do Jake (rodízio fixo: 2 = 1 e 6; 4 = 1-2-5-6; 6 = todos) (3.4)
  ajustaJake() {
    const N = this.N || 6;
    const n = this.freioTipo === 'veb' ? N : this.nJake;
    const usa = n >= N ? Array.from({ length: N }, (_, i) => i)
      : n === 2 ? [0, N - 1] : n === 4 ? [0, 1, N - 2, N - 1] : Array.from({ length: Math.min(n, N) }, (_, i) => i);
    this.jakeCil = new Uint8Array(N);
    for (const i of usa) this.jakeCil[i] = 1;
  }

  // mapa de combustível: 1 abaixo da rotação de potência, 0,7 na rotação máxima (2.2)
  // (com a subida de torque da ficha: abaixo de 60% da rotação de potência a bomba entrega Tmax/T_nominal mais por ciclo;
  // sem isso nenhum aspirado mecânico chegava a λ < 1,3 e o torque máximo da ficha não existia)
  mapa(rpm) {
    if (rpm > this.rpmNom) return 1 - 0.3 * clamp((rpm - this.rpmNom) / Math.max(1, this.rpmMax - this.rpmNom), 0, 1.5);
    const r0 = 0.6 * this.rpmNom;
    return 1 + (this.subidaTq - 1) * clamp((this.rpmNom - rpm) / (this.rpmNom - r0), 0, 1);
  }

  // ------------------------------------------------------------------ escape e filtros
  buildExhaust(cfg) {
    const fs = this.fs, N = this.N;
    const esc = cfg.escape || { turbina: this.turbo, dpf: false, abafador: 'stock', comprimento: cfg.pipeLen || 3, diametro: cfg.pipeD || 2.5, chamine: null, tempGas: 470 };
    const kc = SOUND_SPEED / (esc.tempGas || 470); // comprimentos escalados pela velocidade do som do gás frio (2.5)
    const lines = [], nodes = [], runners = new Array(N), rads = [];
    const L = (len, Y, loss, damp = 1) => { const l = new Line(fs, len * kc, Y, loss, damp); l.kNL = 0.6; lines.push(l); return l; };
    const ds = clamp((esc.diametro || 2.5) / 2.5, 0.6, 3), A2 = ds * ds, dw = 1 / Math.min(ds, 1.6);
    this.pipeA = A2;
    this.bankJ = []; this.brkW = new Float64Array(N).fill(1);
    const bankOut = [];
    for (let b = 0; b < cfg.banks; b++) {
      const ports = [], cyls = [];
      for (let c = 0; c < N; c++) if (cfg.bank[c] === b) cyls.push(c);
      for (const c of cyls) { const r = L(cfg.runners[c], 1, 12000); r.runner = true; runners[c] = r; ports.push(port(r, 1)); }
      const Yc = Math.max(1, cyls.length * 0.55);
      const col = L(0.3 + 0.02 * cyls.length, Yc * Math.min(A2, 2), 10000, dw);
      ports.push(port(col, 0));
      const j = new Junction(ports); nodes.push(j); this.bankJ.push(j);
      bankOut.push(col);
    }
    // as bancadas se juntam antes da (única) turbina
    let cur;
    const Ym = Math.max(...bankOut.map((o) => o.Y)) * (cfg.banks === 2 ? 1.4 : 1);
    if (bankOut.length === 1) cur = bankOut[0];
    else { cur = L(0.25, Ym, 9000, dw); nodes.push(new Junction([...bankOut.map((o) => port(o, 1)), port(cur, 0)])); }
    const seg = (len, Y = cur.Y, loss = 9000) => L(len, Y, loss, dw);
    const tpart = (kind) => { const nx = seg(0.25); nodes.push(kind === 'turbo' ? new TwoPort(fs, port(cur, 1), port(nx, 0), 'turbo') : new DoisPortasDiesel(fs, port(cur, 1), port(nx, 0), kind)); cur = nx; };
    const Lt = Math.max(0.6, esc.comprimento || 3);
    if (esc.turbina && this.turbo) {
      this.linTurb = cur; // (entrada da turbina: a pressão instantânea dela modula o ruído do turbo)
      tpart('turbo');
      // saída da turbina: o ruído de banda larga do rotor (esteira das pás, escoamento turbulento) entra no tubo aqui e
      // segue o caminho do gás: nos carros e caminhões o DPF e o abafador o comem; na locomotiva só há a chaminé
      const nx = seg(0.15); const jt = new Junction([port(cur, 1), port(nx, 0)]); nodes.push(jt); cur = nx; this.jTurb = jt;
    } else { this.jTurb = null; this.linTurb = null; }
    if (esc.dpf) { const p = seg(0.35 * Lt); nodes.push(new Junction([port(cur, 1), port(p, 0)])); cur = p; tpart('dpf'); }
    // tubo até o abafador
    { const p = seg(esc.dpf ? 0.25 * Lt : 0.55 * Lt); nodes.push(new Junction([port(cur, 1), port(p, 0)])); cur = p; }
    const ab = esc.abafador || 'stock';
    const saidas = esc.saidas || 1;
    const fimComRadiador = (feed, panL, panR) => {
      let tail;
      const ch = esc.chamine;
      const tailLen = ch ? Math.max(0.3, ch.altura) : Math.max(0.3, 0.3 * Lt);
      const dch = ch ? clamp(ch.diametro / 2.5, 0.6, 8) : ds;
      if (ab === 'nenhum') { tail = L(tailLen, feed.Y, 9000, dw); nodes.push(new DoisPortasDiesel(fs, port(feed, 1), port(tail, 0), 'chamine')); }
      else if (ab === 'abafador-caminhao') { tail = L(tailLen, feed.Y, 9000, dw); nodes.push(new DoisPortasDiesel(fs, port(feed, 1), port(tail, 0), 'abafador-caminhao')); tail.kNL = 0.05; }
      else { tail = L(tailLen, feed.Y, 9000, dw); nodes.push(new TwoPort(fs, port(feed, 1), port(tail, 0), ab)); tail.kNL = ab === 'stock' ? 0.05 : 0.6; }
      // boca: ka = 1 em c/(2πa) com o gás já mais frio na ponta (~400 m/s): chaminé de 0,45 m → 283 Hz (5)
      const fRad = 400 / (TAU * 0.03175 * dch);
      const r = new Radiator(fs, tail, panL, panR, 1500 / Math.min(dch, 1.6), Math.min(dch * dch, 4), fRad); nodes.push(r); rads.push(r);
    };
    if (saidas === 2) {
      const a = seg(0.3), b = seg(0.3 * 1.04);
      nodes.push(new Junction([port(cur, 1), port(a, 0), port(b, 0)]));
      fimComRadiador(a, 0.95, 0.32); fimComRadiador(b, 0.32, 0.95);
    } else fimComRadiador(cur, 0.62, 0.78);
    this.lines = lines; this.nodes = nodes; this.runners = runners; this.rads = rads; this.g0Rad = null;
    this.zTurb = this.Zr * 0.7; // (a pressão do pulso no primário é Zr·ṁ; depois da junção das bancadas e da turbina, menos)
    // (o resto é igual ao fim do buildExhaust do Ronco: o laço de amostra usa estes campos)
    this.radHP = rads.map(() => new Biquad().hp(fs, 45, 0.7));
    this.radSh = rads.map(() => new Biquad().peak(fs, 110, 0.6, 0)); // (o +3 dB em 110 Hz do Ronco é voz de gasolina; as gravações diesel do real3 em lenta têm 60–150 só 5 dB acima de 150–400)
    let ib = 64; while (ib < fs * 0.0015) ib <<= 1;
    this.itdB = rads.map(() => new Float32Array(ib)); this.itdM = ib - 1; this.itdW = 0;
    this.itdD = rads.map((r) => { const p = (r.panR - r.panL) / (r.panR + r.panL + 1e-9), d = Math.round(Math.abs(p) * 0.0006 * fs); return p > 0 ? [d, 0] : [0, d]; });
    this.jetF = rads.map(() => [new Biquad().bp(fs, 450, 0.5), new Biquad().bp(fs, 1400, 0.6)]);
    this.jetEnv = rads.map(() => 0);
    const td = clamp((cfg.tipD || esc.diametro || 2.5) / 2.5, 0.5, 8); this.tipA = td * td;
  }

  buildFilters(cfg) {
    super.buildFilters(cfg);
    const fs = this.fs;
    // banco estrutural do knock (2.6): 3 modos do bloco que escalam com o diâmetro, tampa/cárter e a câmara
    const B = this.bore || 0.1, sb = Math.sqrt(0.1 / B);
    const fCam = (1.84 * 830) / (Math.PI * B);
    // (o passa-alta de 1 polo em 300 Hz do DIESEL.md deixava a subida lenta da pressão dominar 400–1000 Hz, +16 dB
    // sobre a gravação: aqui são dois de 2ª ordem em 700 Hz, que tiram o "empuxo" e deixam o que bate no bloco)
    this.kHP = [new Biquad().hp(fs, 700 * sb, 0.7), new Biquad().hp(fs, 700 * sb, 0.7)]; // (escala com o banco: 460 Hz no EMD)
    const banco: [number, number, number][] = [[1200 * sb, 4, 1.0], [1900 * sb, 5, 0.8], [2800 * sb, 6, 0.6], [4200, 6, 0.3], [fCam, 12, 0.2]];
    this.kBank = banco.map(([f, q]) => new Biquad().bp(fs, f, q));
    this.kW8 = banco.map(([, , w]) => w);
    this.kLP = new Biquad().lp(fs, 6000, 0.7);
    this.mecLP = new Biquad().lp(fs, Math.min(0.45 * fs, 7000 * Math.pow(0.1 / B, 0.8)), 0.7);
    this.kEnv = 0; this.kPk = 0; this.knockSrc = 0;
    // tiques de injeção (2.7)
    const ij = this.inj || INJECAO['common-rail'];
    this.injF = ij.bp.map(([f, q]) => new Biquad().bp(fs, f, q));
    this.injAmp = ij.bp.map(([f, q]) => 1 / enbw(fs, f, q));
    this.injDec = Math.exp(-1 / (ij.tau * 1e-3 * fs));
    this.injEnv = 0; this.injIn = 0; this.pumpEnv = 0; this.injSobe = 1 - Math.exp(-1 / (0.3e-3 * fs));
    this.pumpF = new Biquad().bp(fs, 1300, 6); this.pumpAmp = 1 / enbw(fs, 1300, 6);
    this.oilF = new Biquad().bp(fs, 1500, 1.2); this.oilAmp = 1 / enbw(fs, 1500, 1.2);
    // trem de válvulas e fundo mecânico
    this.vF = [new Biquad().bp(fs, 2000, 2), new Biquad().bp(fs, 4500, 2.5)]; this.vAmp = [1 / enbw(fs, 2000, 2), 1 / enbw(fs, 4500, 2.5)];
    this.vDec = Math.exp(-1 / (0.6e-3 * fs)); this.vEnv = 0;
    this.fundoF = [new Biquad().bp(fs, 1500, 0.7), new Biquad().bp(fs, 3500, 0.9)]; this.fundoAmp = [1 / enbw(fs, 1500, 0.7), 1 / enbw(fs, 3500, 0.9)]; this.fundoM = 0;
    this.wgF = new Biquad().bp(fs, 3000, 1.5);
    // vibração do bloco: o pico de torque do diesel é 2–3× o do gasolina e o `ripple` do Ronco (por N·m da ficha)
    // fazia o grave da vibração dominar o cofre e a cabine; o bloco de ferro pesado transmite menos por N·m
    const gv = K_VIB; this.vibLP.b0 *= gv; this.vibLP.b1 *= gv; this.vibLP.b2 *= gv;
    this.fbF = new Biquad().bp(fs, 2000, 1);
    // sem borboleta não há o chiado do ar passando pela fresta (o `hiss` da admissão do Ronco, que com o duto sempre
    // aberto virava um sopro contínuo): sobra o escoamento pelo filtro, bem mais fraco
    this.hissGain *= 0.1;
    // ruído de banda larga do compressor (o "whoosh" sob carga): médio-grave, largo; o 4,8 kHz do Ronco era o chiado
    // de um turbo de gasolina soprando contra a borboleta
    this.turboHiss = new Biquad().bp(fs, 1300, 0.55);
    this.turbNzF = [new Biquad().hp(fs, 350, 0.6), new Biquad().lp(fs, 14000, 0.6)];
    this.whooshF = [new Biquad().hp(fs, 250, 0.6), new Biquad().lp(fs, 1500, 0.6)];
  }

  // ------------------------------------------------------------------ ramos cc do laço de amostra
  // Atraso de ignição de Hardenberg–Hase (2.3), em graus de virabrequim; p em Pa, T em K
  atraso(p, T, rpm, k = 1) {
    const pb = Math.max(15, p / 1e5);
    const Sp = (2 * this.curso * Math.max(rpm, 30)) / 60;
    const EA = 618840 / (this.cetano + 25);
    const deg = k * K_ATRASO * (0.36 + 0.22 * Sp) * Math.exp(EA * (1 / (R_UNIV * Math.max(T, 250)) - 1 / 17190) * Math.pow(21.2 / (pb - 12.4), 0.63));
    return Math.min(deg, 8 * 0.006 * Math.max(rpm, 30)); // (acima de 8 ms é falha total)
  }

  // atraso de um evento: o da correlação × o do bico × a variação de ciclo a ciclo (turbulência e estratificação de
  // temperatura na câmara: ~16% quente, ~28% frio). É o que faz cada batida sair diferente da anterior: a fração
  // pré-misturada, e com ela o dp/dθ, segue o atraso
  atrasoEvento(c, p, T, rpm, k = 1) {
    // (os pesados, de câmara grande e injeção mais longa, variam menos: CV do knock das gravações 0,15–0,22 contra 0,17–0,29)
    const s = (this.classe === 'leve' ? 0.16 : 0.11) + 0.12 * (1 - this.warm);
    return this.atraso(p, T, rpm, k) * (this.tauK ? this.tauK[c] : 1) * Math.exp(clamp(s * this.rng.gauss(), -2.5 * s, 2.5 * s));
  }

  // arma a injeção no curso de compressão e dispara piloto e principal (item 7)
  injetar(c, a, ap, running, cranking, cut, rpm) {
    const cyc = this.ciclo, h = cyc / 2;
    // fechamento do injetor (tique)
    const aRel = a < h ? a : a - cyc, apRel = ap < h ? ap : ap - cyc;
    if (apRel < this.fechaRel[c] && aRel >= this.fechaRel[c]) { this.fechaRel[c] = 1e9; if (this.inj.fecha) this.tique(0.7); }
    if (a >= h && a < 0.75 * cyc) {
      if (!this.armed[c]) { this.armed[c] = 1; this.fimDoCiclo(c); this.etapa[c] = this.piloto ? 0 : 1; }
      return;
    }
    if (!this.armed[c]) return;
    // (ângulos relativos ao PMS de ignição: o início da injeção pode cair depois do PMS)
    const soi = -this.advInj;
    if (this.etapa[c] === 0 && aRel >= soi - 12) {
      this.decide(c, (running || cranking) && !cut, rpm);
      // piloto: uma massa pequena e fixa (a mínima que o injetor dosa com repetição, ~1,5 mg no 1GD), não uma fração do
      // principal; a central a reduz em carga alta (com 8% de 81 mg o piloto da plena carga era de 6,5 mg e a queima
      // dele, em 5° em cima da compressão, dava o dp/dθ de 10 bar/°)
      const mp = this.mf[c] > 0 ? Math.min(this.mf[c] * 0.5, this.mPilMin * (1 - 0.5 * clamp(this.fuelCmd, 0, 1))) : 0;
      this.mPil[c] = mp;
      this.eRel[c] = 0; this.Qp[c] = 0; this.Qm[c] = 0;
      if (mp > 0) {
        const T = this.tCil(c), tau = this.atrasoEvento(c, this.p[c], T, rpm);
        this.igP[c] = soi - 12 + tau;
        this.Qp[c] = mp * LHV * this.etaC(this.lam[c]) * this.cylQ[c];
        this.queima[c] = 1; this.tique(1);
      }
      this.etapa[c] = 1;
    }
    if (this.etapa[c] === 1 && aRel >= soi) {
      this.armed[c] = 0;
      if (!this.piloto) { this.decide(c, (running || cranking) && !cut, rpm); this.mPil[c] = 0; this.eRel[c] = 0; this.Qp[c] = 0; }
      const mm = this.mf[c] - this.mPil[c];
      this.Qm[c] = 0;
      if (mm <= 0) { this.eventoInjecao(c, 0, 0, 0, 0); return; }
      const T = this.tCil(c), p = this.p[c];
      // o piloto só encurta o atraso do principal se já tiver acendido quando o principal começa (a chama dele aquece
      // a câmara); no frio o atraso do piloto passa do início do principal e o principal acende sozinho, tarde
      const kPil = this.piloto && this.Qp[c] > 0 ? 0.6 + 0.4 * clamp((this.igP[c] - soi + 2) / 4, 0, 1) : 1;
      let tau = this.atrasoEvento(c, p, T, rpm, kPil);
      const fuel = this.fuelCmd;
      // duração da injeção (2.2): common-rail pela pressão do trilho; bombas mecânicas pelo came
      let q;
      if (this.injTipo === 'common-rail') q = this.qInj * Math.sqrt((30 + 190 * Math.sqrt(clamp(fuel, 0, 1))) / 220);
      else if (this.eletronico) q = this.qInj * (0.55 + 0.45 * clamp(rpm / this.rpmNom, 0, 1.2));
      else q = this.qInj * 0.8 * clamp(rpm / this.rpmNom, 0.15, 1.2);
      const thInj = Math.max(1.5, (mm / q) * 0.006 * rpm); // (kg ÷ kg/ms = ms; ms × 0,006·rpm = graus)
      // pré-misturada: o que já está na câmara quando acende (2.4)
      const phi = clamp(tau / thInj, 0.08, 0.9) * this.kPre;
      let dP = Math.max(5, 5 + 3 * (tau / 3)) * (this.idi ? 1.6 : 1);
      let dD = Math.min(90, 40 + 25 * fuel + 0.006 * rpm);
      // frio (2.8): atraso longo ou ar frio na injeção → queima parcial, tarde, e sai fumaça branca
      const msTau = tau / (0.006 * Math.max(rpm, 30));
      let kQ = 1, lento = 1;
      // (a temperatura que decide é a que o ar alcança durante o atraso: a compressão segue até o PMS, então vale
      // a maior entre a da injeção e a estimada no PMS (politrópica n = 1,35), mais o ponto quente da vela)
      const Tef = Math.max(T, T * Math.pow(this.Vprev[c] / this.Vc, 0.35)) + this.aquec;
      if (msTau > 4 || Tef < 620) { kQ = clamp((Tef - 560) / 120, 0, 1) * (0.2 + 0.8 * this.rng.next()); dD *= 2; lento = 2; }
      else if (this.pParcial > 0 && this.rng.next() < this.pParcial) { kQ = 0.4 + 0.4 * this.rng.next(); dD *= 2; lento = 2; }
      const cold = 1 - this.warm, sigma = 0.02 + 0.025 * (1 - clamp(fuel, 0, 1)) + 0.05 * cold; // (σ da energia de cada queima: maior em carga leve, onde a mistura é mais desigual)
      this.Qm[c] = mm * LHV * this.etaC(this.lam[c]) * this.cylQ[c] * kQ * clamp(1 + sigma * this.rng.gauss(), 0.6, 1.4);
      if (this.Qp[c] > 0) this.Qp[c] *= kQ > 0.6 ? 1 : kQ;
      this.igM[c] = soi + tau; this.phiP[c] = phi; this.dthP[c] = dP; this.dthD[c] = dD;
      // queima por mistura (difusão): o combustível injetado e ainda não queimado queima com o tempo de mistura do jato,
      // que escala com o diâmetro (o caminho até a parede) e cai com a velocidade do jato, √(pressão de injeção)
      this.soiM[c] = soi; this.thInjM[c] = thInj; this.eD[c] = 0;
      // (a turbulência da câmara varia de ciclo a ciclo: a mistura, e com ela a subida de pressão, também)
      this.thMix[c] = this.tMistura(fuel, rpm) * 0.006 * Math.max(rpm, 30) * lento * Math.exp(clamp((0.18 + 0.35 * clamp(fuel, 0, 1)) * this.rng.gauss(), -0.9, 0.9));
      this.queima[c] = 1;
      this.fechaRel[c] = soi + thInj;
      this.queimasBoas = kQ > 0.6 ? this.queimasBoas + 1 : 0;
      this.tique(1);
      this.eventoInjecao(c, mm + this.mPil[c], msTau, T, kQ);
    }
  }

  // combustível do ciclo: comando × máximo × mapa, cortado pelo limite de fumaça se a bomba tiver (2.2)
  decide(c, combust, rpm) {
    let mf = 0;
    const ar = this.tempos === 2 ? this.arPreso[c] * 0.85 : Math.max(0, this.air[c]);
    if (combust) {
      // injetor: vazão própria do cilindro e a variação de tiro a tiro (maior nas bombas mecânicas e em lenta, onde o
      // débito é pequeno perto das folgas do êmbolo)
      const sq = (this.injTipo === 'common-rail' ? 0.01 : this.eletronico ? 0.015 : 0.02) * (1 + 1.5 * (1 - clamp(this.fuelCmd, 0, 1)));
      mf = Math.max(0, this.fuelCmd * this.mapa(rpm) * (this.injK ? this.injK[c] : 1) + (this.injA ? this.injA[c] : 0)) * this.mfMax * clamp(1 + sq * this.rng.gauss(), 0.85, 1.15);
      if (this.limiteFumaca > 1.0001) mf = Math.min(mf, ar / (ESTEQ * this.limiteFumaca));
    }
    this.mf[c] = mf;
    this.lam[c] = mf > 1e-12 ? ar / (ESTEQ * mf) : 20;
  }

  // pressão de injeção (MPa): common-rail pela pressão do trilho; as bombas e os injetores-bomba acionados pelo came
  // pela velocidade do êmbolo (∝ rotação), com o piso da pressão de abertura do bico (~20 MPa)
  pressaoInjecao(fuel, rpm) {
    const pm = this.pInjMax;
    if (this.injTipo === 'common-rail') return 30 + (pm - 30) * Math.sqrt(clamp(fuel, 0, 1));
    const r = clamp(rpm / this.rpmNom, 0, 1.2);
    return Math.max(20, pm * r * r * (0.6 + 0.4 * clamp(fuel, 0, 1)));
  }

  // tempo de mistura do jato (ms): ∝ diâmetro do cilindro / velocidade do jato (∝ √p_injeção)
  tMistura(fuel, rpm) {
    return K_MISTURA * (this.bore / 0.1) * Math.sqrt(200 / this.pressaoInjecao(fuel, rpm)) * (this.idi ? 1.5 : 1);
  }

  etaC(l) { return 0.98 * Math.pow(Math.min(1, l), 1.5); }
  tCil(c) { return clamp((this.p[c] * this.Vprev[c]) / (this.m[c] * RGAS), 220, 3200); }

  // estatísticas por injeção (telemetria): médias com τ ~0,5 s
  eventoInjecao(c, mf, msTau, T, kQ) {
    const rpm = Math.max(this.rpmAvg, 30);
    const dtEv = 60 / (rpm * this.N / (this.tempos / 2));
    const k = 1 - Math.exp(-dtEv / 0.5);
    const fr = mf / this.mfMax;
    this.fuelM += (fr - this.fuelM) * Math.min(1, 2.5 * k);
    if (mf > 0) {
      const l = Math.min(this.lam[c], 20);
      this.lamInst = l; this.lamM += (l - this.lamM) * k; this.etaM += (this.etaC(l) - this.etaM) * k;
      this.tauM += (msTau - this.tauM) * k; this.tInjM += (T - this.tInjM) * k;
    }
    this.cicloEv++;
  }

  // fim do ciclo de um cilindro (ao armar a injeção seguinte): pico de pressão e de dp/dθ para a telemetria
  fimDoCiclo(c) {
    if (this.pPk[c] > 0) {
      const rpm = Math.max(this.rpmAvg, 30), dtEv = 60 / (rpm * this.N / (this.tempos / 2)), k = 1 - Math.exp(-dtEv / 0.5);
      this.pMaxM += (this.pPk[c] - this.pMaxM) * k; this.dpM += (this.dpPk[c] - this.dpM) * k; this.angM += (this.angPk[c] - this.angM) * k;
    }
    if (c === 0 && this.ptBuf) { const t = this.ptUlt; this.ptUlt = this.ptBuf; this.ptBuf = t; }
    this.pPk[c] = 0; this.dpPk[c] = 0;
  }

  tique(k) {
    const ij = this.inj;
    this.injIn = (this.injIn || 0) + k * (ij.a + (1 - ij.a) * clamp(this.fuelCmd, 0, 1));
    // bomba em linha / PLD: o êmbolo bate junto, ∝ combustível·√(rpm/rpm_nom)
    if (this.injTipo === 'em-linha' || this.injTipo === 'pld') this.pumpEnv += k * clamp(this.fuelCmd, 0.1, 1) * Math.sqrt(clamp(this.rpmAvg / this.rpmNom, 0.1, 1.3));
  }

  // cliques do trem de válvulas (×1,5: válvulas maiores), ar por ciclo e massa presa nos 2T (itens 8 e 9)
  valvulas(c, a, ap) {
    const evo = this.evo, evc = this.evc, ivo = this.ivo, ivc = this.ivc, rng = this.rng;
    const cruza = (x) => ap < x && a >= x;
    if (this.tempos === 4) {
      if (cruza(evo) || cruza(evc) || cruza(ivo) || cruza(ivc)) { const k = 0.5 + 0.5 * rng.next(); this.clickEnv += 1.5 * k; this.vEnv += k; }
      if (cruza(ivo)) this.air[c] = 0;
      // (o pistão escravo do Jake abre a válvula contra 30–50 bar: a pancada no balancim é a metralhadora que se ouve do motor)
      if (this.jakeOn && this.jakeCil[c] && cruza(712)) { this.vEnv += 16; this.clickEnv += 6; }
    } else {
      if (cruza(evo) || cruza(evc)) { const k = 0.5 + 0.5 * rng.next(); this.clickEnv += 1.5 * k; this.vEnv += k; }
      if (cruza(ivo)) this.air[c] = 0;
      if (cruza(ivc)) this.arPreso[c] = this.m[c];
    }
    if (cruza(evo)) {
      const T = this.tCil(c);
      this.tEvoC[c] = T;
      const rpm = Math.max(this.rpmAvg, 30), dtEv = 60 / (rpm * this.N / (this.tempos / 2));
      this.tEvoM += (T - this.tEvoM) * (1 - Math.exp(-dtEv / 0.5));
    }
  }

  // queima em Wiebe dupla + pico de pressão + dp/dθ medido → excitação do knock (itens 10, 2.4–2.6)
  queimar(c, a, p, V, deg) {
    const cyc = this.ciclo, aRel = a < cyc / 2 ? a : a - cyc;
    if (p > this.pPk[c]) { this.pPk[c] = p; this.angPk[c] = aRel; }
    if (c === 0 && this.ptBuf) { const i = Math.floor(a / 4); if (i < this.ptBuf.length) this.ptBuf[i] = p; }
    let dQ = 0;
    if (this.queima[c]) {
      let E = 0;
      const Qp = this.Qp[c], Qm = this.Qm[c];
      if (Qp > 0) { const u = (aRel - this.igP[c]) / 5; E += Qp * (u <= 0 ? 0 : u >= 1 ? 1 : 1 - Math.exp(-6.9 * u * u * u)); }
      if (Qm > 0) {
        const d = aRel - this.igM[c];
        if (d > 0) {
          const up = d / this.dthP[c], f = this.phiP[c];
          // difusão: o que já foi injetado e não está na parte pré-misturada queima na taxa da mistura
          const fi = clamp((aRel - this.soiM[c]) / this.thInjM[c], 0, 1), av = Qm * (fi - f) - this.eD[c];
          // (a chama de difusão se estabelece enquanto a pré-misturada queima: a taxa cresce de 0 em Δθ_p; começando cheia
          // no instante da ignição ela era um degrau na taxa de calor, um estalo seco que dava curtose 30–45 no knock)
          const g = up >= 1 ? 1 : up * up * (3 - 2 * up);
          if (av > 0) this.eD[c] += av * Math.min(1, (g * deg) / this.thMix[c]);
          E += Qm * f * (up >= 1 ? 1 : 1 - Math.exp(-6.9 * up * up * up)) + this.eD[c];
        }
      }
      dQ = E - this.eRel[c];
      // (Euler explícito: no máximo 6 bar por amostra; o resto sai na amostra seguinte)
      const dQmax = (6e5 * V) / (GAM - 1);
      if (dQ > dQmax) dQ = dQmax;
      if (dQ < 0) dQ = 0;
      this.eRel[c] += dQ;
      const ig = Qp > 0 ? Math.min(this.igP[c], this.igM[c]) : this.igM[c];
      if (aRel > ig) {
        const dp = (p - this.pAnt[c]) / 1e5 / Math.max(deg, 1e-6);
        if (dp > this.dpPk[c]) this.dpPk[c] = dp;
        if (dp > 0) this.knockSrc += dp * this.cylK[c];
      }
      if ((aRel > this.igM[c] + this.dthP[c] && this.eD[c] >= 0.997 * (1 - this.phiP[c]) * this.Qm[c]) || aRel > 0.45 * cyc) this.queima[c] = 0;
    }
    this.pAnt[c] = p;
    return dQ;
  }

  // válvula de escape, Jake e contrapressão do freio de descarga (item 11)
  escapar(c, a, p, T, run, Zr) {
    const pb = P0 + this.pBack + 2 * run.in0;
    const evo = this.evo, evc = this.evc;
    if (a > evo && a < evc) {
      const sv = Math.sin(Math.PI * (a - evo) / (evc - evo));
      const A = this.AexMax * this.cylEx[c] * Math.min(1, 2.5 * sv * sv);
      // (limite numérico de 10% da massa do cilindro por amostra nos dois sentidos: nunca atua no escape normal, mas segura
      // o refluxo quando a onda do Jake de outro cilindro chega pelo coletor)
      const ml = (0.1 * this.m[c]) / this.dt, mx = clamp(this.exhaustFlow(A, p, T, pb, Zr), -ml, ml);
      if (mx > 0) { this.egtN += mx * T; this.egtD += mx; }
      return mx;
    }
    if (this.jakeOn && this.jakeCil[c]) {
      // Jake: abre o escape perto do PMS de compressão (de −20° a +30°) e solta o ar comprimido (3.4)
      const aj = a >= this.ciclo - 25 ? a - this.ciclo : a;
      if (aj > -8 && aj < 40) {
        const sv = Math.sin(Math.PI * (aj + 8) / 48);
        const A = this.kJake * this.AexMax * this.cylEx[c] * Math.min(1, 2.5 * sv * sv);
        // (Euler explícito: com a válvula grande perto do PMS o volume é pequeno; no máximo 10% da massa por amostra, nos dois sentidos)
        const mlim = (0.1 * this.m[c]) / this.dt, mx = clamp(this.exhaustFlow(A, p, T, pb, Zr), -mlim, mlim);
        // o ar a 30–50 bar sai como jato subexpandido (razão de pressão 20–40, Mach de expansão completa 2–2,6): além do
        // chiado do jato engasgado que o laço já põe (Mach limitado a 1), o ruído de choque cresce com (M² − 1); é o
        // estalo rasgado do Jake. Entra na junção do coletor, como os estouros do Ronco
        const pr = clamp(p / Math.max(pb, 0.5 * P0), 1, 60);
        if (mx > 0 && pr > 1.9) {
          const M2 = (2 / (GAM - 1)) * (Math.pow(pr, (GAM - 1) / GAM) - 1);
          this.bankJ[Math.min(this.cfg.bank[c], this.bankJ.length - 1)].inj += Zr * mx * K_CHOQUE * Math.min(M2 - 1, 6) * this.rng.bi();
        }
        return mx;
      }
    }
    return 0;
  }

  // Fator do pulso que entra no tubo na abertura do escape. O Ronco usa T/1650 K ("vazão volumétrica"), acertado no
  // gasolina em carga; mas a pressão acústica que uma vazão de massa ṁ põe num tubo cheio do próprio gás é p' = c·ṁ/A,
  // e c ∝ √T. Com o linear, o gás do diesel (500–750 K em lenta, ~1000 K em carga) entrava 6–10 dB mais fraco que
  // um pulso gasolina da mesma massa, e a calibração de volume subia junto o chiado, o turbo e a mecânica
  densidade(T) { return clamp(Math.sqrt(T / T_EXREF), 0.1, 1.3); }

  // válvula de admissão (4T) ou janelas na camisa (2T, perfil quadrado: o pistão descobre a janela em ~15°) (item 13)
  admitir(c, a, pMan, p, T) {
    const ivo = this.ivo, ivc = this.ivc;
    if (a > ivo && a < ivc) {
      const sv = Math.sin(Math.PI * (a - ivo) / (ivc - ivo));
      const A = this.AinMax * this.cylIn[c] * Math.min(1, (this.tempos === 2 ? 2.5 : 1.5) * sv * sv);
      return flow(A, pMan, T_MAN, p, T);
    }
    return 0;
  }

  // mecânica do diesel: knock estrutural, tiques de injeção, trem de válvulas, bombas e o fundo mecânico (item 22).
  // Tudo é referido ao pico do knock de lenta quente do próprio motor (medido na sonda de calibração, `refKnock`) e
  // escalado por K_MEC: o nível relativo entre as fontes é o do DIESEL.md 2.7 e o absoluto foi acertado nas bandas
  // do ouvinte `bay` contra as gravações (Apêndice A)
  mecanica(rf, coldN, pMan) {
    const rng = this.rng;
    // knock: dp/dθ do próprio cilindro → passa-alta → banco estrutural → parede (passa-baixa 6 kHz) (2.6)
    let x = this.knockSrc; this.knockSrc = 0;
    for (let i = 0; i < this.kHP.length; i++) x = this.kHP[i].run(x);
    let s = 0;
    for (let i = 0; i < this.kBank.length; i++) s += this.kBank[i].run(x) * this.kW8[i];
    s = this.kLP.run(s);
    this.kEnv += (Math.abs(s) - this.kEnv) * 0.01;
    // 70% determinístico + 30% "chocalho" (ruído modulado pela mesma envoltória); as folgas do frio transmitem mais
    let y = (0.7 * s + 0.3 * 1.4 * this.kEnv * rng.bi()) * (1 + 0.5 * coldN); // (0,3 do DIESEL.md dava +4,9 dB a −10 °C; o alvo é +8 ± 3)
    const ay = Math.abs(y); if (ay > this.kPk) this.kPk = ay; else this.kPk *= 0.99995;
    const ref = (this.refKnock || 0.5), kr = ref * K_MEC * this.gMec;
    y *= K_MEC * this.gMec;
    const ij = this.inj;
    let m = 0;
    // tiques de injeção: nível relativo ao pico do knock de lenta quente (2.7)
    // (o tique sobe em ~0,3 ms, o tempo da agulha abrir e a estrutura responder, e cai com o τ do tipo; um degrau na
    // envoltória era um estalo de um amostra só, curtose 30 na banda 1–4 kHz contra 6–9 nas gravações)
    if (this.injIn > 1e-6) { const d = this.injIn * this.injSobe; this.injEnv += d; this.injIn -= d; }
    if (this.injEnv > 1e-5) {
      const nz = rng.bi() * this.injEnv;
      m += (this.injF[0].run(nz) * this.injAmp[0] + 0.6 * this.injF[1].run(nz) * this.injAmp[1]) * kr * Math.pow(10, ij.nivel / 20) * 0.6;
      this.injEnv *= this.injDec;
    }
    if (this.pumpEnv > 1e-5) { m += this.pumpF.run(rng.bi() * this.pumpEnv) * this.pumpAmp * kr * 0.6; this.pumpEnv *= this.injDec; }
    // trem de válvulas: cada abertura e fechamento bate (válvulas maiores, folga hidráulica ou mecânica)
    if (this.vEnv > 1e-5) {
      const nz = rng.bi() * this.vEnv;
      m += (this.vF[0].run(nz) * this.vAmp[0] + 0.5 * this.vF[1].run(nz) * this.vAmp[1]) * kr * K_VALV * (1 + 1.6 * coldN);
      this.vEnv *= this.vDec;
    }
    // fundo mecânico: engrenagens da distribuição, bomba, correias e o chocalho contínuo da combustão (entre as
    // explosões o bloco não fica mudo: é o que dá o p90/p10 de 9–17 dB das gravações em vez de silêncio)
    const fl = clamp(this.fuelCmd, 0, 1);
    this.fundoM += (1 - this.fundoM) * 0.0002;
    m += (this.fundoF[0].run(rng.bi()) * this.fundoAmp[0] + 0.6 * this.fundoF[1].run(rng.bi()) * this.fundoAmp[1]) * kr * K_FUNDO * (0.5 + 0.8 * rf + 0.4 * fl) * (1 + 0.5 * coldN);
    const dt = this.dt, rpm = this.omega * 9.549296585513721;
    if (this.injTipo === 'common-rail') {
      // bomba de alta (CP3/HP4): 3 lóbulos a meia rotação → pulsos fracos a 1,5·rpm/60 Hz, −20 dB
      this.phPump += 1.5 * rpm / 60 * dt;
      if (this.phPump >= 1) { this.phPump -= 1; this.pumpEnv += 0.1; }
    } else if (this.injTipo === 'rotativa') {
      // anel de roletes da VP37: harmônicos k·N·rpm/120, k = 8–12, −26 dB
      this.phRot += (this.N * rpm / 120) * dt; if (this.phRot > 1e3) this.phRot -= 1e3;
      let w = 0; for (let k = 8; k <= 12; k++) w += Math.sin(TAU * k * this.phRot);
      m += w * 0.2 * kr * 0.05 * (0.3 + 0.7 * rf);
    } else if (this.injTipo === 'heui') {
      // bomba de óleo de alta: chiado 1–2 kHz, −18 dB, ∝ combustível
      m += this.oilF.run(rng.bi()) * this.oilAmp * kr * 0.125 * clamp(this.fuelCmd, 0.05, 1);
    }
    // parede do bloco: quanto maior o cilindro, mais grossa a parede e mais pesado o bloco; o agudo da mecânica cai
    // (passa-baixa de 2ª ordem em 7,5 kHz na picape de 92 mm, 5,4 kHz no caminhão de 137 mm, 3,6 kHz na locomotiva)
    return this.mecLP.run(y + m);
  }

  // apito e chiado do turbo, wastegate e a fresta da borboleta do freio de descarga (item 23, 5)
  turboSom(pMan, pUp, P) {
    let tur = 0;
    const dt = this.dt, rng = this.rng;
    if (this.turbo && this.turboRpmMax) {
      const tn = this.nTurbo / this.turboRpmMax, f = this.turboPas * this.nTurbo / 60;
      this.tjit += 0.003 * (rng.bi() * 1.7 - this.tjit);
      this.phTT += TAU * f * (1 + 0.003 * this.tjit) * dt; if (this.phTT > TAU) this.phTT -= TAU;
      let lvl = tn * tn * (0.2 + 0.8 * clamp(pMan / pUp, 0, 1)) * this.gApito;
      if (f > 16000) lvl *= (16000 / f) * (16000 / f);
      if (f > 0.45 * this.fs) lvl = 0;
      const h2 = 2 * f < 0.45 * this.fs ? 0.25 * (2 * f > 16000 ? (16000 / (2 * f)) ** 2 : 1) : 0;
      tur += (Math.sin(this.phTT) + h2 * Math.sin(2 * this.phTT + 0.7)) * 0.02 * lvl;
      // a turbina não recebe um fluxo contínuo: recebe o pulso de cada abertura do escape. O ruído de banda larga dela e o
      // sopro que se ouve de fora seguem a pressão instantânea na entrada da turbina (onda que chega + onda que volta),
      // relativa à média (~40 ms): forte no pulso, quase nada entre as explosões. (Modulado só ±15%, pela média, era um
      // chiado liso que subia com o giro e enchia o vão entre as explosões: o "mar" do REVISAO-DE-SOM.md)
      let mx = 0; for (let c = 0; c < this.N; c++) mx += this.mEx[c] > 0 ? this.mEx[c] : 0;
      this.mExM += (mx - this.mExM) * 0.0005;
      const lt = this.linTurb, pt = lt ? Math.max(0, lt.in1 + lt.out1) : mx;
      this.pTM += (pt - this.pTM) * 0.0005;
      const am = clamp(1 + this.kModT * (pt / Math.max(this.pTM, 1e-9) - 1), 0, 4);
      // whoosh: segue a vazão de ar comprimido (pressão de alimentação) e a rotação do turbo, que tem constante de tempo
      // de segundos; sem carga (turbo girando à toa, coletor sem pressão) quase some
      const carga = clamp(this.boost / Math.max(0.2, this.maxBoost), 0, 1.2);
      tur += this.turboHiss.run(rng.bi()) * 0.02 * tn * tn * (0.08 + carga) * am * P.air * this.gChiado;
      // banda larga do compressor e do escoamento do ar comprimido sob carga (potência ∝ vazão·U⁵: some em lenta), bem
      // abaixo do escape: de fora ele chega pela caixa do filtro e pelo cofre
      const w5 = tn * tn * tn * tn * tn;
      tur += this.whooshF[1].run(this.whooshF[0].run(rng.bi())) * K_SOPRO * w5 * (0.05 + carga) * am * P.air * this.gChiado;
      if (this.wgAmt > 0.01) tur += this.wgF.run(rng.bi()) * 0.002 * this.wgAmt * P.air;
      // ruído aerodinâmico da turbina, que sai pela chaminé: pressão ∝ impedância do tubo × vazão média de gás × Mach de
      // ponta³ (a potência de banda larga de um rotor cresce com ~U⁶); entra na rede do escape depois da turbina
      if (this.jTurb) {
        const nz = this.turbNzF[1].run(this.turbNzF[0].run(rng.bi()));
        const u = tn * this.uPonta / 500; // (velocidade de ponta do rotor, referida a 500 m/s)
        this.jTurb.inj += nz * K_TURBINA * this.zTurb * this.mExM * am * u * u * u * P.air; // (vazão instantânea = média × pulso)
      }
    }
    if (this.pBack > 2000) tur += this.fbF.run(rng.bi()) * 0.006 * (this.pBack / 3e5) * P.air;
    return tur;
  }

  // ------------------------------------------------------------------ controle (a cada 16 amostras)
  control(dtc) {
    // velas: a espera conta antes de girar
    if (this.velas > 0) {
      this.velas -= dtc;
      if (this.velas <= 0) { this.velas = 0; this.clickEnv += 3; this.aquec = 150; if (this.ignition) { this.gI = this.fuelLenta; this.rpmAlvo = 0; super.setIgnition(true); } }
    }
    // câmbio automático: o do Ronco troca em frações da faixa vermelha e em múltiplos da lenta (no modo econômico de um
    // caminhão, a 945 rpm), pontos que num diesel de faixa estreita caem fora da potência; aqui a lógica é a do diesel
    const au = this.auto && this.portador === 'carro';
    if (au) this.auto = false;
    super.control(dtc);
    if (au) this.auto = true;
    this.ccDepois(dtc);
    if (au) this.cambio(dtc);
  }

  // Câmbio automático do diesel. Pontos de troca pela rotação de potência (rpmNom), não pela máxima: o caminhão com
  // caixa automatizada (Opticruise, I-Shift) sobe em ~1400–1600 rpm com o pé no fundo e volta em ~1000–1100; a picape
  // automática sobe de 2000 a 3000 conforme o pedal. Sem acelerar segura a marcha (freio-motor) e só sobe para não
  // passar da máxima. A condição tem de durar um pouco (a rotação do diesel ondula com o governador e a embreagem) e
  // depois de cada troca há uma espera, para não subir em cascata com 12 marchas.
  cambio(dtc) {
    if (this.gear <= 0 || this.shifting || this.state !== 'run') { this.trocaT = 0; return; }
    // marcha de saída: parado, a picape sai em 1ª; o caminhão com caixa automatizada de 10–12 marchas escolhe uma
    // marcha de saída (2ª–4ª, conforme a carga: com o conjunto carregado, a 3ª) e pula as de baixo
    const pesG = this.classe !== 'leve' && this.ratios.length - 1 >= 8, g0 = pesG ? Math.round((this.ratios.length - 1) / 4) : 1;
    if (this.v < 0.6 && this.gear !== g0) {
      this.gear = g0; this.shifting = true; this.shiftT = 0.15; this.clutch = 0; this.shiftCut = false; this.blip = false; this.shiftCool = 0.4; this.trocaT = 0;
      return;
    }
    if (this.shiftCool > 0) { this.trocaT = 0; return; }
    const n = this.ratios.length - 1, g = this.gear, rpm = this.rpmAvg, nom = this.rpmNom, I = this.idle;
    const t = clamp(this.thrTarget, 0, 1), pes = this.classe !== 'leve';
    const solto = t < 0.05;
    let up = solto ? 0.97 * this.rpmMax : nom * (pes ? 0.62 + 0.18 * t : 0.58 + 0.30 * t);
    // (governador de todas as rotações: o pedal escolhe a rotação, e com carga o motor fica abaixo dela pelo droop)
    if (!solto && this.gov === 'todas-as-rotacoes' && this.rpmAlvo > 0) up = Math.min(up, 0.9 * this.rpmAlvo);
    const down = Math.min(0.8 * up, solto ? Math.max(1.3 * I, 0.36 * nom) : nom * (pes ? 0.53 + 0.06 * t : 0.40 + 0.12 * t));
    const r = this.ratios;
    let quer = 0;
    if ((this.locked || rpm > 1.05 * up) && g < n && rpm > up && (rpm * r[g + 1]) / r[g] > Math.max(1.1 * I, 0.85 * down)) {
      // caixa automatizada de caminhão pula marchas quando a de cima ainda deixa o motor acima do ponto de troca
      quer = 1;
      if (pes) while (g + quer < n && (rpm * r[g + quer + 1]) / r[g] > Math.max(down * 1.15, 0.92 * up)) quer++;
    }
    else if (this.locked && g > g0 && rpm < down && (rpm * r[g - 1]) / r[g] < Math.min(up * 0.92, 0.9 * this.rpmMax)) quer = -1;
    if (Math.sign(quer) !== Math.sign(this.trocaDir || 0)) { this.trocaDir = quer; this.trocaT = 0; }
    if (!quer) return;
    this.trocaT = (this.trocaT || 0) + dtc;
    if (this.trocaT < (quer > 0 ? (rpm > 1.05 * up ? 0 : 0.15) : 0.4)) return;
    this.requestShift(quer);
    this.trocaT = 0;
    // (o requestShift do Ronco espera 1,5× o tempo de troca; com 12 marchas curtas o motor chegava à máxima antes)
    this.shiftCool = 0.5 * this.shiftTime + 0.2;
  }

  ccDepois(dtc) {
    const rpm = this.rpmAvg, run = this.state === 'run';
    // escala de torque (ficha ÷ modelo): o Ronco a faz entrar entre 1,5× e 3× a lenta; no gerador a "lenta" de
    // aquecimento (1200 rpm) é 2/3 da rotação nominal e a escala nunca chegava aos 1800 rpm (potência 10% acima)
    if (this.tqScale !== 1 && 3 * this.idle > 0.9 * this.rpmNom) this.tqS = 1 + (this.tqScale - 1) * smooth(0.5 * this.rpmNom, 0.8 * this.rpmNom, rpm);
    // parede do cilindro segue a água (2.3); a temperatura usada pelo laço é esta
    this.tParede = 430 + 0.9 * (this.coolant - 90);
    const cold = 1 - this.warm;
    // aquecimento: em lenta o diesel esquenta devagar (pouco combustível): o termo de carga usa o combustível (2.8)
    if (this.tempMode !== 'fixed' && run) {
      const lg = Math.sqrt(Math.max(0.2, (rpm * clamp(this.pMan / P0, 0.15, 2.5)) / 240));
      const ld = Math.sqrt(Math.max(0.2, (rpm * (0.3 + 2 * this.fuelM)) / 240));
      this.coolant += 0.135 * (ld - lg) * dtc;
    }
    // lenta: eletrônico sobe a lenta no frio; mecânico não (o motorista puxa o acelerador manual) (item 18)
    const coldAdd = this.eletronico ? cold * Math.min(0.35 * this.idle, 300) : 0;
    let idleT = this.lentaFixa || this.idle + coldAdd; // (lentaFixa: só as ferramentas de medida, para comparar à mesma rotação)
    if (this.portador === 'locomotiva' && this.lentaBaixa && this.locCfg) idleT = this.locCfg.lentaBaixa;
    this.idleTarget = idleT;
    // temperatura do gás no coletor (°C): a média, ponderada pela massa, da temperatura do gás que sai pelas válvulas
    // de escape (o sopro da abertura sai quente, o resto do curso já expandido), com a inércia térmica do coletor.
    // (O DIESEL.md, item 16, dava uma fórmula pelo combustível e pela rotação; a média do que sai do cilindro segue a
    // queima de verdade: a fumaçada, a queima tarde do frio e o ar de lavagem dos 2 tempos aparecem sozinhos)
    const kd = Math.exp(-dtc / 0.5);
    this.egtNs = this.egtNs * kd + this.egtN; this.egtDs = this.egtDs * kd + this.egtD; this.egtN = 0; this.egtD = 0;
    const tPorta = this.egtDs > 1e-9 ? this.egtNs / this.egtDs - 273.15 : this.ambientT;
    const tWant = run ? tPorta : this.ambientT;
    this.tEsc += (tWant - this.tEsc) * (1 - Math.exp(-dtc / (tWant > this.tEsc ? 4 : 20)));
    this.exhT = this.tEsc;
    // frio: queimas parciais nos primeiros segundos (2.8)
    this.pParcial = run ? 0.3 * cold * Math.exp(-(this.runT || 0) / 40) : 0;
    // ponto quente das velas: ajuda a acender nos primeiros segundos e some com a pós-incandescência (~40 s)
    this.aquec = (this.aquec || 0) * Math.exp(-dtc / (run ? 40 : 120));
    this.fumaca = clamp((1.3 - this.lamM) / 0.3, 0, 1) * (this.fuelM > 0.02 ? 1 : 0);
    this.fumacaBranca = clamp(this.pParcial + 0.5 * (1 - this.etaM / 0.98), 0, 1);
    // início da injeção (graus antes do PMS) (2.2)
    const rfi = clamp(rpm / this.rpmMax, 0, 1.2);
    this.advInj = this.advFixo ?? (this.idi ? 10 + 4 * rfi : this.eletronico ? 2 + 2 * clamp(this.fuelCmd, 0, 1) + 0.006 * rpm * 0.15 : 12 + 6 * rfi);
    // partida e apagamento (item 21): liga acima de 0,7·lenta, apaga abaixo de 0,4·lenta
    if (this.state === 'crank' && this.crankT > 0.45 && rpm > 0.7 * this.idle) this.state = 'run';
    // pegou: o governador começa do combustível de lenta (com o atrito do frio), sem o tranco da integral zerada
    if (this.state === 'run' && this.estadoAnt !== 'run') { this.gI = this.gX = this.fuelLenta * (1 + 0.6 * cold); }
    this.estadoAnt = this.state;
    if (run && (this.runT || 0) > 1 && rpm < 0.4 * this.idle && this.omega < 0.45 * this.idle / 9.55) this.state = 'off';
    this.cargas(dtc);
    this.turboDiesel(dtc);
    this.freio(dtc);
    if (!this.sonda) this.governar(dtc);
    this.bovEnv = 0; this.limiter = false;
  }

  // governadores (3.1)
  // Rotação medida pelo governador: média do ω no último intervalo de ignição (como a central conta os dentes da
  // roda fônica entre duas explosões). Tira a ondulação da ignição sem o atraso de uma volta inteira do rpmAvg.
  medirRotacao() {
    const buf = this.wBuf, M = buf.length;
    const w = this.omega;
    this.wSoma += w - buf[this.gwI]; buf[this.gwI] = w; this.gwI = (this.gwI + 1) % M;
    const rpm = Math.max(this.rpmAvg, 60);
    const K = clamp(Math.round(((this.ciclo / this.N) / (rpm * 6)) * this.fs / 16), 1, M - 2);
    // soma das K últimas (a janela muda com o giro: refaz a soma quando K muda)
    if (K !== this.wK) {
      this.wK = K; let s = 0;
      for (let k = 1; k <= K; k++) s += buf[(this.gwI - k + M) % M];
      this.wSomaK = s;
    } else this.wSomaK += w - buf[(this.gwI - K - 1 + M) % M];
    return (this.wSomaK / K) * 9.549296585513721;
  }

  // Governadores (3.1). Os ganhos do DIESEL.md (Kp 6, Ki 1,5/s na lenta; Kp 5, Ki 0,5/s no gerador; Kp 6, Ki 0,3/s na
  // locomotiva) dão, neste modelo, um laço instável nos motores leves: com o atraso de meio intervalo de ignição na
  // medida, mais a injeção que só muda na próxima explosão, a lenta caçava ±12% a 2,4 Hz. Aqui os ganhos são
  // normalizados por motor: P = Kt/(J·ω) é a aceleração relativa por unidade de combustível, e Kp = ω_c/P põe o
  // laço na mesma banda ω_c em qualquer motor (picape a 780 rpm ou locomotiva a 904). Ki é a fração ω_c/4 de Kp.
  // (Na locomotiva EMD em N8 isso dá Kp ≈ 6,3, o do DIESEL.md.)
  governar(dtc) {
    const rpmG = this.medirRotacao();
    const rpm = this.rpmAvg, ped = clamp(this.thr, 0, 1), it = this.idleTarget || this.idle;
    // ganho da planta (aceleração relativa por unidade de combustível) na rotação de referência
    const Kt = (this.mfMax * LHV * 0.4 * this.N) / (TAU * this.tempos) * Math.max(1, this.tqS || 1);
    const P = (w0) => Kt / (Math.max(this.J, 1e-3) * Math.max(w0, 5));
    let f;
    let semAtuador = false;
    if (this.combExterno !== null) f = this.combExterno;
    else if (this.state === 'crank') f = this.fuelPartida;
    else if (this.state !== 'run') f = 0;
    else {
      // carro: o do preset (ou o escolhido no painel); gerador e locomotiva: isócrono; bancada: isócrono ou o escolhido
      const gov = this.portador === 'carro' ? this.gov : this.portador === 'nenhum' ? (this.govBancada || 'isocrono') : 'isocrono';
      if (gov === 'todas-as-rotacoes') {
        // contrapesos contra a mola: proporcional puro em regime (droop), realizado com ganho alto lento e baixo rápido
        // (a "ligação" contrapesos-mola-cremalheira de 2ª ordem do DIESEL.md com ζ 0,25 deixava o laço instável na
        // lenta: aqui a parte lenta é um atraso de 1ª ordem de 0,35 s, que dá a caça leve de ~1 Hz)
        // (a mola de lenta é regulada para a lenta quente sair na rotação da ficha: alvo = lenta·(1 + droop·combustível de lenta))
        const itM = it * (1 + 0.15 * this.fuelLenta);
        const alvo = itM + clamp(ped + this.manual, 0, 1) * (this.rpmMax - itM);
        const pw = smooth(0, 0.15, ped + this.manual);
        const dr = this.droop + (0.15 - this.droop) * (1 - pw);
        const e = (alvo - rpmG) / (alvo);
        // O droop da ficha é medido entre a rotação sem carga e a de plena carga com a alavanca no mesmo lugar: a mola é
        // regulada para que o curso da cremalheira de "sem carga" (o combustível que só vence o atrito, ~50% na rotação
        // máxima) até "cheio" corresponda ao droop. Com o ganho 1/droop sobre o curso inteiro, metade do droop ia embora
        // no atrito (3,6% medidos no OM617 contra 7–9%). Em lenta (alavanca solta) nada muda
        const fNL = pw * clamp(this.atritoNm(alvo) / Math.max(1, Kt * 1.15), 0, 0.8);
        const K0 = (1 - fNL) / dr, Pa = P((alvo * TAU) / 60);
        const Kh = Math.min(K0, 11 / Pa);
        this.gX += ((K0 - Kh) * e - this.gX) * (1 - Math.exp(-dtc / 0.5));
        this.gX = clamp(this.gX, -0.2, 1);
        f = clamp(fNL + Kh * e + this.gX, 0, 1);
        this.rpmAlvo = alvo;
      } else if (gov === 'isocrono') {
        const alvoBruto = this.alvoIsocrono();
        // alvo em rampa (locomotiva 100 rpm/s; gerador e bancada 200 rpm/s)
        const rampa = this.portador === 'locomotiva' ? 100 : 200;
        if (!this.rpmAlvo) this.rpmAlvo = Math.max(rpm, it);
        this.rpmAlvo += clamp(alvoBruto - this.rpmAlvo, -rampa * dtc, rampa * dtc);
        const e = (this.rpmAlvo - rpmG) / this.rpmAlvo;
        // (gerador: ω_c 3,7 rad/s, o que dá o Kp 5 do DIESEL.md no QSX15; locomotiva 2,5; bancada 8)
        const wc = this.portador === 'locomotiva' ? 2.5 : this.portador === 'gerador' ? 2.7 : 8;
        const Kp = wc / P((this.rpmAlvo * TAU) / 60), Ki = Kp * wc / (this.portador === 'locomotiva' && this.tempos === 2 && this.rpmAlvo < 250 ? 6 : 4);
        this.gI = clamp(this.gI + Ki * e * dtc, 0, 1);
        f = clamp(Kp * e + this.gI, 0, 1);
      } else {
        // min-max: pedal manda combustível; PI de lenta isócrono; governador de máxima com rampa de 120 rpm
        const e = (it - rpmG) / it;
        const ativo = ped < 0.05 || rpmG < 1.05 * it;
        const Kp = 9 / P((it * TAU) / 60), Ki = Kp * 9 / 2.5;
        if (ativo && rpmG < 1.3 * it) this.gI = clamp(this.gI + Ki * e * dtc, 0, 0.6);
        const fIdle = ativo ? clamp(Kp * e + this.gI, 0, 1) : 0;
        f = Math.max(ped, fIdle) * clamp((this.rpmMax + 60 - rpmG) / 120, 0, 1);
        this.rpmAlvo = it;
      }
    }
    // troca de marcha para cima no automático: a central corta o torque enquanto as embreagens trocam (sem isso o motor
    // disparava até o governador de máxima a cada troca, com 12 marchas curtas e 40 t)
    if (this.shifting && this.shiftUp && this.auto && this.portador === 'carro' && this.combExterno === null) f = Math.min(f, Math.max(this.fuelLenta * 1.3, 0.35 * f));
    // proteção de sobrevelocidade (3.2)
    if (rpm > 1.12 * this.rpmMax) this.sobre = true; else if (rpm < 1.05 * this.rpmMax) this.sobre = false;
    if (this.sobre) f = 0;
    if (semAtuador && this.combExterno === null && this.state === 'run') this.fuelCmd = f;
    else this.fuelCmd += (f - this.fuelCmd) * (1 - Math.exp(-dtc / this.tauA));
  }

  // torque de atrito do modelo numa rotação (N·m): o polinômio do Ronco mais o acréscimo do diesel (ver cargas())
  atritoNm(rpm) {
    const nk = (rpm / this.redline) * 7, frio = 1 + 0.5 * (1 - this.warm);
    const fmep = (0.95e5 + 0.12e5 * nk + 0.02e5 * nk * nk) * frio + 0.6 * 0.95e5 * frio;
    return (fmep * this.dispL * 1e-3) / (4 * Math.PI);
  }

  // rotação-alvo do isócrono conforme o portador interno ("bancada")
  alvoIsocrono() {
    const it = this.idleTarget || this.idle;
    if (this.portador === 'gerador' && this.gerCfg) return Math.min(this.rpmMax, (120 * (this.fRede || this.gerCfg.fRede)) / this.gerCfg.polos);
    if (this.portador === 'locomotiva' && this.locCfg) {
      const n = this.dinamico ? 8 : this.notch;
      return n === 0 ? it : this.locCfg.notchRpm[n];
    }
    // bancada (dinamômetro) e carro sem governador próprio: pedal ou rotação-alvo do painel
    return Math.max(it, this.rpmAlvoPainel || 0, it + clamp(this.thr, 0, 1) * (this.rpmMax - it));
  }

  // carga no eixo pelos portadores internos ("bancada") ou externo; entra como pressão média de freio
  cargas(dtc) {
    const w = Math.max(this.omega, 1);
    let T = 0;
    if (this.cargaExterna) T = this.cargaExterna.torque(this.omega);
    else if (this.state === 'run') {
      if (this.portador === 'gerador' && this.gerCfg) {
        // alternador: P = fração·P_elétrica/η, aplicada em 0,1 s; T = P/ω (CENA 4.4)
        const Pw = (this.degrau * this.gerCfg.kWe * 1000) / this.gerCfg.eta;
        this.Pcarga += (Pw - this.Pcarga) * (1 - Math.exp(-dtc / 0.1));
        const w0 = (this.alvoIsocrono() * TAU) / 60;
        // (regulador de tensão com queda por subfrequência, como nos AVR reais: abaixo de 97% da rotação a tensão cai com
        // a frequência e a potência com o quadrado dela; sem isso um degrau de 100% com o turbo ainda vazio apagava o motor)
        const rf = clamp(w / w0 / 0.97, 0, 1);
        T = (this.Pcarga * rf * rf) / Math.max(w, 0.3 * w0);
      } else if (this.portador === 'locomotiva' && this.locCfg) {
        // gerador de tração: potência do notch com 1,5 s de atraso; o regulador de carga alivia se o motor não acompanha
        const n = this.dinamico ? 0 : this.notch;
        const alvoRpm = this.alvoIsocrono();
        const pronto = this.rpmAvg > 0.97 * alvoRpm;
        if (this.fuelCmd > 0.97 && !pronto) this.regCarga = Math.max(0.3, this.regCarga - 0.3 * dtc);
        else this.regCarga = Math.min(1, this.regCarga + 0.2 * dtc);
        // (o regulador de carga segue a rotação que o motor já alcançou: a potência pedida é a da tabela na rotação
        // atual, nunca mais que a do notch; assim o motor sobe de giro antes de receber a carga toda)
        const nr = this.locCfg.notchRpm, rr = this.rpmAvg;
        let pRpm = 0;
        for (let k = 1; k < 8; k++) if (rr >= nr[k]) pRpm = NOTCH_POT[k] + (NOTCH_POT[k + 1] - NOTCH_POT[k]) * clamp((rr - nr[k]) / Math.max(1, nr[k + 1] - nr[k]), 0, 1);
        const Pw = Math.min(NOTCH_POT[n], Math.max(pRpm, NOTCH_POT[1])) * this.locCfg.kW * 1000 * this.regCarga;
        this.Pcarga += (Pw - this.Pcarga) * (1 - Math.exp(-dtc / 1.5));
        T = this.Pcarga / Math.max(w, (0.5 * alvoRpm * TAU) / 60);
      } else if (this.portador === 'nenhum') {
        // dinamômetro: torque de carga em fração do torque nominal, em rampa de 0,3 s
        const Tw = this.cargaBancada * (this.Tmax || 100) * smooth(this.idle * 0.6, this.idle * 0.95, this.rpmAvg);
        this.Tcarga += (Tw - this.Tcarga) * (1 - Math.exp(-dtc / 0.3));
        T = this.Tcarga;
      }
    } else { this.Pcarga = 0; this.Tcarga = 0; }
    this.Tcarga = T;
    let Tm = T;
    // motor de partida do diesel: o do Ronco (feito para taxa 10:1) mal gira um 15 L a 17:1 com o óleo frio
    // (30–60 rpm); o de redução do diesel (24 V nos pesados) tem torque de travamento ~2,5× o atrito frio e gira
    // o motor a 150–250 rpm (locomotiva ~100) (2.8). Entra como pressão média negativa (empurra)
    if (this.state === 'crank') {
      const livre = 0.9 * this.idle, Tstall = 46 * this.dispL * (this.tempos === 2 ? 1.6 : 1);
      Tm -= Tstall * Math.max(0, 1 - this.rpmAvg / livre) / (this.omega > 0.5 ? 1 : 0.6);
    }
    // atrito do diesel: +0,57 bar sobre o do Ronco (×1,6 só no termo constante: 1,8 bar em lenta, como pede o DIESEL.md;
    // o ×1,6 no polinômio inteiro dava 4,4 bar na rotação máxima e o motor em vazio precisava de 63% do combustível)
    const pmeAtrito = 0.6 * 0.95e5 * (1 + 0.5 * (1 - this.warm));
    this.pmeCarga = (Tm * 4 * Math.PI) / (this.dispL * 1e-3) + pmeAtrito;
  }

  // turbo diesel (5): rotação pela energia do escape (combustível × giro), τ do preset, VGT, wastegate, engrenado
  turboDiesel(dtc) {
    const rpm = this.rpmAvg, rf = clamp(rpm / this.rpmMax, 0, 1.3);
    // Roots: pressão proporcional ao giro, sem atraso
    this.boostR = this.soprador ? this.soprador.pressao * Math.min(1, rf) * (this.state === 'off' ? 0 : 1) : 0;
    if (!this.turbo) { this.boost = this.sonda ? this.boostFixo : this.boostR; this.turboW = 0; this.tw = 0; this.nTurbo = 0; return; }
    if (this.sonda) { this.nTurbo = this.tw * this.turboRpmMax; this.turboW = this.tw; this.boost = this.boostFixo; return; }
    const fl = this.state === 'run' ? clamp(this.fuelM, 0, 1.2) : 0.02;
    let alvo = clamp(1.05 * Math.sqrt(rf * (0.08 + 0.92 * fl)), 0, 1);
    if (this.turboTipo === 'vgt') alvo = Math.max(alvo, this.state === 'run' ? this.turboLenta : 0);
    if (this.freioAtivo && this.freioTipo === 'descarga') alvo *= 0.3;
    if (this.freioAtivo && this.freioTipo === 'vgt') alvo = 0.8;
    // (o ar que o Jake solta a 35–50 bar gira a turbina como uma carga média: sem isso o coletor ficava em ~1,3 bar e a
    // frenagem em 46% da potência; com a pressão do turbo ela sobe para perto dos 70–90% medidos)
    if (this.jakeOn) alvo = Math.max(alvo, 0.8 * Math.sqrt(rf));
    const tau = alvo > this.tw ? this.turboTau[0] : this.turboTau[1];
    this.tw += (alvo - this.tw) * (1 - Math.exp(-dtc / tau));
    let n = this.tw;
    if (this.turboTipo === 'engrenado' && this.iEng) n = Math.max(n, (rpm * this.iEng) / this.turboRpmMax);
    this.turboW = n; this.nTurbo = n * this.turboRpmMax;
    const turboMax = Math.max(0, this.maxBoost - (this.soprador ? this.soprador.pressao : 0));
    const ex = this.turboTipo === 'vgt' ? 1.3 : 1.6;
    let b = turboMax * Math.pow(clamp((n - 0.1) / 0.85, 0, 1.2), ex);
    this.boostAlvo = turboMax;
    // wastegate: abre na pressão máxima e chia
    if (this.turboTipo === 'wastegate' && b > turboMax) { this.wgAmt += (clamp((b - turboMax) / (0.15 * turboMax + 1e-9), 0, 1) - this.wgAmt) * 0.05; b = turboMax; }
    else this.wgAmt *= 0.98;
    b = Math.min(b, turboMax * 1.05);
    // (estado próprio: o controle do Ronco também mexe em this.boost antes deste passo)
    this.boostD = (this.boostD || 0) + (b + this.boostR - (this.boostD || 0)) * (1 - Math.exp(-dtc / 0.08));
    this.boost = this.boostD;
  }

  // freio-motor (3.4): ativo com a chave ligada, sem pedal e acima de 1,3× a lenta
  freio(dtc) {
    const t = this.freioTipo;
    this.freioAtivo = t !== 'nenhum' && this.freioOn && this.state === 'run' && this.thr < 0.05 && this.fuelCmd < 0.03 && this.rpmAvg > 1.3 * this.idle;
    const alvo = !this.freioAtivo ? 0 : t === 'descarga' ? 3e5 : t === 'vgt' ? 2.5e5 : t === 'veb' ? 2e5 : 0;
    this.pBack += (alvo - this.pBack) * (1 - Math.exp(-dtc / 0.3));
    this.jakeOn = this.freioAtivo && (t === 'jake' || t === 'veb');
    // a borboleta do freio de descarga (e as palhetas fechadas do VGT, menos) refletem o pulso: a ponteira quase não
    // irradia (−15 a −20 dB com a borboleta fechada)
    if (!this.g0Rad) this.g0Rad = this.rads.map((r) => r.gain);
    const fecha = t === 'descarga' || t === 'veb' ? 0.88 : t === 'vgt' ? 0.5 : 0;
    const kb = 1 - fecha * clamp(this.pBack / 2.5e5, 0, 1);
    for (let i = 0; i < this.rads.length; i++) this.rads[i].gain = this.g0Rad[i] * kb;
    this.jetGain = 500 * kb * kb;
  }

  // ------------------------------------------------------------------ calibração e potência
  // Sonda como a do Ronco: plena carga (combustível 1 com o limite de fumaça) a 55% da rotação máxima, turbo a
  // 40% da pressão, e lenta com o combustível ajustado até o torque médio zerar. Mede também o pico do knock
  // de lenta quente (referência do nível dos tiques de injeção) e o combustível de lenta (início do integrador).
  sonda0(cfg, rpm, fuel, tw, boost) {
    const t = new DieselDSP(this.fs);
    t.setConfig({ ...cfg, valve: 'none', reso: false, breakout: 'sealed', freioMotor: 'nenhum', gain: undefined, powerModel: undefined, fuelLenta: undefined, refKnock: undefined }, false);
    t.state = 'run'; t.lockOmega = true; t.tempMode = 'fixed'; t.tempSet = 90; t.coolant = 90; t.runT = 100; t.warm = 1;
    t.omega = (rpm * TAU) / 60; t.rpmAvg = rpm; t.sonda = true; t.fuelCmd = fuel; t.thr = 0; t.thrTarget = 0;
    t.tw = tw; t.turboW = tw; t.nTurbo = tw * t.turboRpmMax;
    t.boostR = t.soprador0(rpm);
    t.boost = t.boostFixo = boost + t.boostR; t.pMan = P0 * (1 + t.boost);
    t.portador = 'nenhum'; t.fuelM = fuel; t.refKnock = this.refKnock || 0;
    return t;
  }

  soprador0(rpm) { return this.soprador ? this.soprador.pressao * Math.min(1, rpm / this.rpmMax) : 0; }

  calibrate(cfg) {
    const fs = this.fs, B = 256, L = new Float32Array(B), R = new Float32Array(B);
    const target = 0.17;
    // lenta primeiro: combustível ajustado até o torque médio zerar (o análogo do iacI do Ronco) e o pico do knock, que
    // é a referência de toda a mecânica (a sonda o usa já enquanto mede: a referência converge junto)
    const ti = this.sonda0(cfg, this.idle, 0.1, this.turboTipo === 'vgt' ? 0.16 : 0.12, 0);
    ti.params.master = 0.02;
    const kf = 1 / (Math.max(50, this.Tmax || 300) * 0.25);
    let acc2 = 0, cnt2 = 0, kmax = 0;
    const Tidle = 1.6 + (this.tempos === 2 ? 0.4 : 0);
    for (let i = 0; i < Tidle * fs; i += B) {
      ti.process(L, R, B);
      ti.fuelCmd = clamp(ti.fuelCmd - kf * ti.tqMean * (B / fs), 0.01, 0.6); ti.fuelM = ti.fuelCmd;
      if (ti.kPk > 0) ti.refKnock = ti.kPk;
      if (i > (Tidle - 0.5) * fs) { for (let k = 0; k < B; k++) { acc2 += L[k] * L[k] + R[k] * R[k]; cnt2 += 2; } kmax = Math.max(kmax, ti.kPk); }
    }
    this.fuelLenta = ti.fuelCmd; this.refKnock = kmax;
    // plena carga a 55% da rotação máxima, turbo a 40% da pressão
    const sop = cfg.soprador ? cfg.soprador.pressao : 0;
    const t = this.sonda0(cfg, this.rpmMax * 0.55, 1, 0.6, Math.max(0, (cfg.boost || 0) - sop) * 0.4);
    t.params.master = 0.02;
    let acc = 0, cnt = 0, pk = 0;
    for (let i = 0; i < 0.5 * fs; i += B) {
      t.process(L, R, B);
      if (i > 0.25 * fs) for (let k = 0; k < B; k++) { acc += L[k] * L[k] + R[k] * R[k]; cnt += 2; pk = Math.max(pk, Math.abs(L[k]), Math.abs(R[k])); }
    }
    const rms = Math.sqrt(acc / Math.max(1, cnt)) / 0.01;
    const gWot = Math.min(target / Math.max(rms, 1e-6), 0.9 / Math.max(pk / 0.01, 1e-6));
    const rmsIdle = Math.sqrt(acc2 / Math.max(1, cnt2)) / 0.01;
    const gIdle = (target * 0.09) / Math.max(rmsIdle, 1e-6);
    const gain = clamp(gWot, 0.05, 40);
    return { gain, idle: clamp(gIdle / gain, 1, 8) };
  }

  measurePower(cfg) {
    const fs = this.fs, B = 256, L = new Float32Array(B), R = new Float32Array(B);
    const t = this.sonda0({ ...cfg, power: cfg.power, limiter: 'none' }, this.rpmNom, 1, 1, cfg.boost || 0);
    t.tqScale = 1; t.tqS = 1; t.params.master = 0;
    let kw = 0, tq = 0, fr = 0;
    for (const f of [0.8, 1.0]) {
      const rpm = Math.min(this.rpmMax, this.rpmNom * f);
      t.omega = (rpm * TAU) / 60; t.rpmAvg = rpm; t.tqMean = 0; t.frMean = 0;
      t.boostFixo = Math.max(0, (cfg.boost || 0) - (cfg.soprador ? cfg.soprador.pressao : 0)) * (f < 0.9 ? 0.9 : 1) + t.soprador0(rpm);
      // (média do torque na segunda metade da janela: o tqMean do laço é uma média de ~50 ms, que num 4 cilindros a
      // 3000 rpm ainda carrega a dispersão de ciclo a ciclo; a leitura de um instante errava a potência em até 15%)
      let sq = 0, sf = 0, nq = 0;
      const Tj = 1.0 * fs;
      for (let i = 0; i < Tj; i += B) { t.process(L, R, B); if (i >= Tj / 2) { sq += t.tqMean; sf += t.frMean; nq++; } }
      const tqm = sq / Math.max(1, nq), k = (tqm * t.omega) / 1000;
      if (k > kw) { kw = k; tq = tqm; fr = sf / Math.max(1, nq); }
    }
    return { kw: Math.max(kw, 1), tq: Math.max(tq, 1), fr: Math.max(fr, 0) };
  }

  // ------------------------------------------------------------------ telemetria (item 24)
  telemetry() {
    const base: any = super.telemetry();
    const torque = Math.max(0, this.tqMean + this.Tcarga);
    base.torque = torque;
    base.pMax = this.pMaxM / 1e5; base.dpdth = this.dpM; base.angPk = this.angM; base.tauId = this.tauM; base.tInj = this.tInjM;
    base.lambda = this.lamM; base.lambdaInst = this.lamInst; base.fumaca = this.fumaca; base.fumacaBranca = this.fumacaBranca; base.fuel = this.fuelCmd; base.fuelInj = this.fuelM;
    base.pBack = this.pBack / 1e5; base.jake = this.jakeOn; base.freio = this.freioAtivo; base.notch = this.notch; base.portador = this.portador;
    base.kW = (torque * this.omega) / 1000; base.cargaKW = (this.Tcarga * this.omega) / 1000;
    base.turboRpm = this.nTurbo; base.tEvo = this.tEvoM; base.exhT = this.tEsc; base.velas = this.velas; base.rpmAlvo = this.rpmAlvo;
    base.hz = this.gerCfg ? (this.rpmAvg * this.gerCfg.polos) / 120 : 0; base.tempos = this.tempos; base.idleTarget = this.idleTarget;
    base.sobre = this.sobre; base.limiter = false; base.turbo = this.turboW;
    // traço p–θ do último ciclo do cilindro 1, a cada 4 telemetrias
    if (++this.telN % 4 === 0) base.ptheta = Array.from(this.ptUlt, (v: number) => +(v / 1e5).toFixed(2));
    return base;
  }
}
