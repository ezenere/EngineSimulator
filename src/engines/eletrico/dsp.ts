// EletricoDSP (ELETRICO.md 4.1): DSP novo de síntese espectral. Determinístico (RNG com semente por fonte); um objeto por
// motor físico modelado; para n_unidades motores iguais (trem, drone) guarda até 4 unidades com desvios próprios de
// rotação e sementes próprias, cada uma preenchendo os seus canais. Implementa o `Motor` do CENA direto (eixo + fontes):
// o adaptador da Passagem (motor.ts) só acrescenta a calibração do nível absoluto.
//
// A cada bloco de controle de 64 amostras: torque pedido (acelerador, regeneração, creep), integração do eixo contra a
// `Carga` do portador (ou ω imposta: dinamômetro), estado elétrico (I/I_n, M, Φ, f_e com escorregamento), modo do
// inversor, e as listas de linhas de cada fonte, entregues aos bancos (linhas.ts). Entre os blocos os bancos e os ruídos
// rendem as amostras com rampas lineares.
//
// Canais (fontes do Motor, ordem fixa): motor, inversor, reducao, ventilador, escovas, helice (por unidade, com sufixo
// `.u` quando há mais de uma), aux, avas, avas.re.
import type { FonteSonora, EixoSaida, Carga, ComandoMotor, Vec3, Diretividade } from '../../scene/tipos';
import type { Motor, EstadoMotor, TelemetriaMotor, FamiliaMotor } from '../../carriers/tipos';
import { BancoDeLinhas, ListaLinhas, JitterEixo } from './linhas';
import { EstadoMaquina, estadoEletrico, ForcasMotor, torqueDisponivel, naRede, escovado } from './maquina';
import { Inversor, linhasAux, type ModoModulacao, type ModoEfetivo } from './inversor';
import { Reducao, Ventilador, Escovas, Helice, RuidoBanda } from './mecanica';
import { Avas, type ModoAvas } from './avas';
import { Bq } from '../../scene/filtros';
import {
  TAU, BLOCO, LMAX, REF_DIST_ELETRICO, DIR_MOTOR, DIR_AVAS, DIR_HELICE, OMNI, NOME_MEC, NOMES_NOTAS,
} from './constantes';

// ---------------------------------------------------------------- preset (4.1, com as extensões anotadas)
export type IdCanalEletrico = 'motor' | 'inversor' | 'reducao' | 'ventilador' | 'escovas' | 'helice' | 'aux' | 'avas';

export interface PresetEletrico {
  // navegação da página (PresetNav)
  id: string; name: string; tag: string; family: string;
  nome: string; familia: 'eletrico';
  maquina: 'pmsm' | 'pmsrm' | 'inducao' | 'sincrona-excitada' | 'cc-serie' | 'universal' | 'bldc';
  p: number;              // pares de polos
  Zs: number; Zr?: number; Zc?: number;
  Tn: number; Pmax: number; rpmBase: number; rpmMax: number; J: number;
  escorregamentoNominal?: number;
  inversor: null | {
    tipo: 'igbt' | 'gto' | 'sic' | 'chopper' | 'csi';
    fc: number;
    modo: ModoModulacao;
    escada?: { f0: number; delta: number; notas: number[]; patamar?: number };
    sincrona?: number[];
    delta?: number;
    fcAux?: number; fRede?: number;
    /** (extensão) f_c,max do semicondutor para a escolha do N síncrono (padrão 1,2·f_c) */
    fcMax?: number;
    /** (extensão) dB dos grupos m·f_c relativos a f_c, medidos (GTO em escada: o padrão de pulsos não é o PWM senoidal) */
    perfilGrupos?: number[];
    /** (extensão) chopper de entrada do CSI (TGV em 1,5 kV CC), Hz */
    fcEntrada?: number;
  };
  reducao: { estagios: { Zp: number; Zc: number }[]; eta: number; retos?: boolean };
  ventilacao: null | { forcada: boolean; B: number; rpm?: number };
  escovas?: { Zc: number; desgaste: number };
  helice?: { B: number; D: number; rotores: number; detune: number[]; harmonicos?: number[]; largoDb?: number; largoCarga?: boolean };
  carcaca: 'carro' | 'trem' | 'pequena';
  niveis: { motor: number; inversor: number; reducao: number; ventilador: number; escovas?: number; helice?: number; aux?: number };
  avas?: ModoAvas;
  creep?: boolean;
  nUnidades?: number; detune?: number;
  fontes: Record<string, { pos: Vec3; dentro: boolean }>;
  // ---- extensões (anotadas no relatório)
  /** frequência da rede (indução direto na rede, magnetostrição) */
  fRede?: number;
  /** curva T = T_st·(a − ω/ω₀) (ferramentas: o gatilho é tensão) */
  curvaLinear?: boolean;
  /** 0 (máquina boa, −20 dB) a 1 (gasta, −8 dB) */
  excentricidade?: number;
  /** linhas medidas em ordens de f_rot [ordem, dB rel. ao grupo de ranhuras]: CPTM 9000 (1,44·Z_p), furadeira */
  linhasExtras?: [number, number][];
  /** BLDC: ordens de f_e e dB (padrão 6f_e 0, 12f_e −8; Mavic mede 9f_e) */
  ordensEletricas?: [number, number][];
  /** linhas fixas do conversor auxiliar e da ventilação do trem parado [Hz, dB] */
  auxLinhas?: [number, number][];
  /** ruído largo dos ventiladores do auxiliar (ar-condicionado, ventilação), dB relativos à potência das linhas do aux */
  auxRuido?: number;
  /** torque de regeneração (fração de T_n) e velocidade mínima da regeneração (m/s) */
  Tregen?: number; vRegenMin?: number;
  /** escovas: nível do faiscamento relativo aos tons (≈) */
  faiscamento?: number;
  /** desvio do passeio de frequência do eixo (padrão 0,05%; o ESC do drone oscila ±1,5%) */
  jitter?: number;
  /** campos de catálogo aproximados (decisão 8: ficam marcados) */
  aprox?: string[];
  /** segundo motor (Tesla AWD: dianteiro de indução) */
  segundo?: PresetEletrico;
  /** portador e a configuração dele (carro-eletrico.ts, trem.ts, teste.ts, multirrotor.ts) */
  portador: ConfigPortadorEletrico;
  /** velocidade máxima (km/h; informativo) */
  vMaxKmh?: number;
}

/** onde o preset roda e com que corpo e carga (4.3) */
export type ConfigPortadorEletrico =
  | { tipo: 'carro'; massa: number; CdA: number; Crr: number; rw: number; corpo?: 'carro' | 'onibus'; pneus?: number; trole?: boolean }
  | { tipo: 'trem'; config: Record<string, unknown>; carrosMotores: number[]; motoresPorTruque: number; rw: number; massaTotal: number;
      davis: { A: number; B: number; C: number }; carroAux?: number; bonde?: boolean }
  | { tipo: 'bancada'; carga: 'constante' | 'quadratica' | 'degrau'; Tcarga: number; inercia: number; rpmRef?: number }
  | { tipo: 'drone'; massa: number; cQ: number };

/** extensões do comando (4.2), no espírito de `rpmAlvo`; portadores que não as conhecem as ignoram */
export interface ComandoEletrico extends ComandoMotor {
  freio?: number; modulacao?: ModoModulacao | null; avas?: ModoAvas | 'desligado';
  v?: number;                     // m/s do portador (AVAS, regeneração, chocalho)
  omegaImposta?: number | null;   // dinamômetro: ω travada
  re?: boolean;                   // marcha à ré (AVAS de ré)
  torqueFixo?: number | null;     // (sonda e testes) torque imposto, N·m
}

// ---------------------------------------------------------------- unidade
interface Canal { id: string; base: IdCanalEletrico; u: number; out: number }

class Unidade {
  det: number;
  jit: JitterEixo;
  inv: Inversor | null;
  red: Reducao | null; ven: Ventilador | null; esc: Escovas | null; hel: Helice | null;
  bMotor: BancoDeLinhas; bInv: BancoDeLinhas | null; bRed: BancoDeLinhas | null; bVen: BancoDeLinhas | null; bEsc: BancoDeLinhas | null; bHel: BancoDeLinhas | null;
  lMotor = new ListaLinhas(320); lInv = new ListaLinhas(128); lRed = new ListaLinhas(64); lVen = new ListaLinhas(8); lEsc = new ListaLinhas(8); lHel = new ListaLinhas(16);
  lVazia = new ListaLinhas(1);
  corcova: RuidoBanda | null = null; bqCorc: Bq | null = null; normCorc = 1; fCorc0 = 300;
  cMotor = -1; cInv = -1; cRed = -1; cVen = -1; cEsc = -1; cHel = -1;
  faseSlip = 0;
  forcas: ForcasMotor;
  constructor(p: PresetEletrico, fs: number, u: number, det: number, sem: number) {
    this.det = det;
    this.forcas = new ForcasMotor(p);
    this.jit = new JitterEixo(fs, sem ^ 0x31, p.jitter ?? 5e-4, 0.5, p.jitter && p.jitter > 2e-3 ? 2 : 0.3);
    this.bMotor = new BancoDeLinhas(fs, LMAX.motor, sem + 1);
    this.inv = p.inversor ? new Inversor(p, fs, sem + 2) : null;
    this.bInv = p.inversor ? new BancoDeLinhas(fs, LMAX.inversor, sem + 3) : null;
    const temRed = p.reducao.estagios.length > 0;
    this.red = new Reducao(p, fs, sem + 4);
    this.bRed = temRed ? new BancoDeLinhas(fs, LMAX.reducao, sem + 5) : null;
    this.ven = p.ventilacao ? new Ventilador(p, fs, sem + 6) : null;
    this.bVen = p.ventilacao ? new BancoDeLinhas(fs, LMAX.ventilador, sem + 7) : null;
    this.esc = p.escovas ? new Escovas(p, fs, sem + 8) : null;
    this.bEsc = p.escovas ? new BancoDeLinhas(fs, LMAX.escovas, sem + 9) : null;
    this.hel = p.helice ? new Helice(p, fs, sem + 10) : null;
    this.bHel = p.helice ? new BancoDeLinhas(fs, LMAX.helice, sem + 11) : null;
    if (escovado(p) && p.inversor === null && p.maquina === 'cc-serie') {
      // CC reostático (MP 73): corcova larga de motor + redução + pneus, bp em 300 + 400·(v/v_max) Hz, Q 0,7
      this.bqCorc = new Bq().bp(fs, 300, 0.7);
      this.corcova = new RuidoBanda(fs, sem + 12, [this.bqCorc]);
      this.normCorc = this.corcova.norm;
    }
    void u;
  }
}

/** desvios de rotação das unidades (trem: rodas de diâmetros diferentes; ±detune) */
const DESVIOS = [0, 0.6, -0.6, 1];

export class EletricoDSP implements Motor {
  readonly familia: FamiliaMotor = 'eletrico';
  fontes: FonteSonora[] = [];
  eixo: EixoSaida = { omega: 0, torque: 0, inercia: 0 };
  estado: EstadoMotor = 'desligado';
  readonly governadorProprio = false;
  fs: number;
  p!: PresetEletrico;
  kAbs: Record<string, number> = {};
  uni: Unidade[] = [];
  canais: Canal[] = [];
  e = new EstadoMaquina();
  carga: Carga | null = null;
  // comando
  acel = 0; freio = 0; ign = false; v = 0; vConhecida = false; re = false;
  omegaImposta: number | null = null; torqueFixo: number | null = null;
  modoAvas: ModoAvas = null;
  private regen = 0; private Tf = 0;
  // fontes compartilhadas
  bAux: BancoDeLinhas | null = null; lAux = new ListaLinhas(32); cAux = -1; ruidoAux: RuidoBanda | null = null; rmsAux = 0;
  avas: Avas | null = null; bAvas: BancoDeLinhas | null = null; lAvas = new ListaLinhas(8); cAvas = -1; cAvasRe = -1;
  private pos = 0;           // amostra dentro do bloco de controle
  private semente = 0x5e1e;
  /** canais de rascunho para `processar` sem saída pedida (sonda) */
  constructor(fs: number) { this.fs = fs; }

  /** cfg: o preset, com `kAbs` (motor.ts) opcional */
  configurar(preset: object, fs: number) {
    this.fs = fs;
    const p = preset as PresetEletrico & { kAbs?: Record<string, number>; semente?: number };
    this.p = p;
    this.kAbs = { motor: 1, inversor: 1, reducao: 1, ventilador: 1, escovas: 1, helice: 1, aux: 1, avas: 1, ...(p.kAbs || {}) };
    this.semente = p.semente ?? 0x5e1e;
    const nU = p.helice ? Math.min(4, p.helice.rotores) : Math.max(1, Math.min(4, p.nUnidades ?? 1));
    this.uni = [];
    for (let u = 0; u < nU; u++) {
      const det = p.helice ? 1 + (p.helice.detune[u] ?? 0) : 1 + (p.detune ?? 0.003) * DESVIOS[u] * (nU > 1 ? 1 : 0);
      this.uni.push(new Unidade(p, fs, u, det, (this.semente + 0x1000 * (u + 1)) >>> 0));
    }
    // canais e fontes
    this.canais = [];
    const suf = (u: number) => (nU > 1 ? `.${u}` : '');
    this.uni.forEach((U, u) => {
      const add = (base: IdCanalEletrico) => { this.canais.push({ id: base + suf(u), base, u, out: this.canais.length }); return this.canais.length - 1; };
      U.cMotor = add('motor');
      if (U.bInv) U.cInv = add('inversor');
      if (U.bRed) U.cRed = add('reducao');
      if (U.bVen) U.cVen = add('ventilador');
      if (U.bEsc) U.cEsc = add('escovas');
      if (U.bHel) U.cHel = add('helice');
    });
    const inv = p.inversor;
    if ((inv && inv.fcAux) || p.auxLinhas?.length) {
      this.bAux = new BancoDeLinhas(fs, LMAX.aux, this.semente + 77); this.canais.push({ id: 'aux', base: 'aux', u: -1, out: this.canais.length }); this.cAux = this.canais.length - 1;
      // ventiladores do auxiliar: largo de 60 Hz a 1 kHz (passa-baixa suave, Q 0,5), na potência relativa do preset
      if (p.auxRuido !== undefined) {
        this.lAux.limpar(); linhasAux(p, this.lAux);
        let e = 0; for (let i = 0; i < this.lAux.n; i++) e += 0.5 * this.lAux.a[i] * this.lAux.a[i];
        this.rmsAux = Math.sqrt(e) * Math.pow(10, p.auxRuido / 20);
        this.ruidoAux = new RuidoBanda(fs, this.semente + 79, [new Bq().hp(fs, 60, 0.7071), new Bq().lp(fs, 1000, 0.5)]);
      } else this.ruidoAux = null;
    } else { this.bAux = null; this.ruidoAux = null; }
    if (p.avas !== undefined) {
      this.avas = new Avas(fs, p.avas ?? null, this.semente + 99);
      this.bAvas = new BancoDeLinhas(fs, LMAX.avas, this.semente + 98);
      this.canais.push({ id: 'avas', base: 'avas', u: -1, out: this.canais.length }); this.cAvas = this.canais.length - 1;
      this.canais.push({ id: 'avas.re', base: 'avas', u: -1, out: this.canais.length }); this.cAvasRe = this.canais.length - 1;
      this.modoAvas = p.avas ?? null;
    } else { this.avas = null; this.bAvas = null; }
    this.fontes = this.canais.map((c) => this.fonte(c));
    this.eixo = { omega: 0, torque: 0, inercia: p.J };
    this.e = new EstadoMaquina();
    this.pos = 0;
  }

  private fonte(c: Canal): FonteSonora {
    const p = this.p;
    const chaves = [c.id, c.base, c.base === 'avas' && c.id === 'avas.re' ? 'avas.re' : c.base];
    let f = p.fontes[c.id] ?? p.fontes[c.base];
    if (c.id === 'avas.re') f = p.fontes['avas.re'] ?? { pos: [-2.31, 0, 0.4], dentro: false };
    void chaves;
    const pos: Vec3 = f ? f.pos : [0, 0, 0];
    const dentro = f ? f.dentro : false;
    let dir: Diretividade;
    if (c.base === 'avas') dir = { tabela: DIR_AVAS, eixo: c.id === 'avas.re' ? [-1, 0, 0] : [1, 0, 0], expConv: 2 };
    else if (c.base === 'helice') dir = { tabela: DIR_HELICE, eixo: [0, 0, 1], expConv: 3 };
    else if (c.base === 'ventilador' || c.base === 'aux') dir = { tabela: OMNI, eixo: [1, 0, 0], expConv: 2 };
    else dir = { tabela: DIR_MOTOR, eixo: p.helice ? [0, 0, 1] : [0, 1, 0], expConv: 2 };
    const tipo = c.base === 'helice' || c.base === 'ventilador' ? 'pa' : c.base === 'reducao' || c.base === 'escovas' ? 'mecanica' : 'eletrica';
    const fonte: FonteSonora = { id: c.id, tipo, pos, dir, refDist: REF_DIST_ELETRICO, dentro };
    if (dentro) fonte.vias = { cabine: { ganho: 0.6, fc: 6000 }, cofre: { ganho: 1, fc: 0 } };
    return fonte;
  }

  comandar(c: ComandoMotor) {
    const x = c as ComandoEletrico;
    this.acel = Math.max(0, Math.min(1, x.combustivel ?? x.acelerador ?? 0));
    if (x.ignicao !== undefined) this.ign = !!x.ignicao;
    if (x.freio !== undefined) this.freio = Math.max(0, Math.min(1, x.freio));
    if (x.v !== undefined) { this.v = x.v; this.vConhecida = true; }
    if (x.re !== undefined) { this.re = !!x.re; if (this.avas) this.avas.re = this.re; }
    if (x.omegaImposta !== undefined) this.omegaImposta = x.omegaImposta;
    if (x.torqueFixo !== undefined) this.torqueFixo = x.torqueFixo;
    if (x.modulacao !== undefined) for (const U of this.uni) if (U.inv) U.inv.pedido = x.modulacao;
    if (x.avas !== undefined && this.avas) { this.modoAvas = x.avas === 'desligado' ? null : x.avas; this.avas.modo = this.modoAvas; }
    this.estado = this.ign ? 'funcionando' : 'desligado';
  }
  acoplar(carga: Carga | null) { this.carga = carga; }

  /** velocidade do portador para a regeneração (sem portador que informe: a do eixo) */
  private vPortador() { return this.vConhecida ? Math.abs(this.v) : 0; }

  // ------------------------------------------------------------ controle
  private controle() {
    const p = this.p, dt = BLOCO / this.fs, e = this.e;
    const w = this.eixo.omega;
    // torque pedido
    let Treq = 0;
    if (this.ign) {
      const vR = p.vRegenMin ?? 5 / 3.6, vp = this.vConhecida ? this.vPortador() : Infinity;
      const querRegen = this.freio > 0.001 && vp > vR && !naRede(p);
      this.regen += ((querRegen ? this.freio : 0) - this.regen) * Math.min(1, dt / 0.3);
      if (this.regen > 0.002) {
        const Tr = -this.regen * (p.Tregen ?? 0.3) * p.Tn;
        Treq = Math.max(Tr, -Math.min(p.Tn, p.Pmax / Math.max(Math.abs(w), 1e-3)));
      } else if (naRede(p) || p.curvaLinear) Treq = torqueDisponivel(p, w, naRede(p) ? (this.acel > 0.02 ? 1 : 0) : this.acel);
      else {
        Treq = this.acel * torqueDisponivel(p, w, 1);
        if (p.creep && this.acel < 0.03 && this.freio < 0.01 && this.vPortador() < 5 / 3.6) Treq = Math.max(Treq, 0.03 * p.Tn);
      }
    } else this.regen = 0;
    if (this.torqueFixo != null) Treq = this.torqueFixo;
    // o controle de torque é rápido (≈ 10 ms), sem degrau
    this.Tf += (Treq - this.Tf) * Math.min(1, dt / 0.01);
    const T = this.torqueFixo != null ? Treq : this.Tf;
    // eixo
    if (this.omegaImposta != null) this.eixo.omega = Math.max(0, this.omegaImposta);
    else {
      const J = p.J + (this.carga ? this.carga.inercia : 0), h = dt / 4;
      let ww = w;
      for (let s = 0; s < 4; s++) {
        const at = 0.01 * p.Tn * (ww / ((p.rpmBase * TAU) / 60)) + (ww > 0 ? 0.002 * p.Tn : 0);
        const Tc = this.carga ? this.carga.torque(ww) : 0;
        ww += ((T - Tc - at) / J) * h;
        if (ww < 0) ww = 0;
      }
      this.eixo.omega = ww;
    }
    this.eixo.torque = T;
    estadoEletrico(p, e, this.eixo.omega, T);
    const ligado = this.ign && (Math.abs(T) > 0.01 * p.Tn || e.frot > 0.3);
    const fBase = p.rpmBase / 60;
    const vp = this.vPortador();
    // unidades
    for (let ui = 0; ui < this.uni.length; ui++) {
      const U = this.uni[ui];
      U.jit.passo();
      const jf = U.jit.fator, jg = U.jit.ganho;
      // motor
      U.lMotor.limpar();
      if (this.ign || e.frot > 0.3) {
        if (p.maquina === 'inducao') { U.faseSlip += TAU * 2 * Math.abs(e.fslip) * U.det * dt; if (U.faseSlip > TAU) U.faseSlip -= TAU; }
        U.forcas.fatores(p, e, U.faseSlip);
        U.forcas.emitir(U.lMotor, e.frot * U.det, e.fe * U.det);
      }
      U.bMotor.atualizar(U.lMotor, jf, jg * this.kAbs.motor);
      if (U.corcova) {
        const nRel = Math.min(1, e.frot / (p.rpmMax / 60));
        const f = 300 + 400 * nRel;
        U.bqCorc!.bp(this.fs, f, 0.7);
        U.corcova.norm = U.normCorc * Math.sqrt(300 / f);
        U.corcova.alvo((0.3 + 0.7 * Math.min(1.5, e.I)) * nRel * 1.5);
      }
      // inversor
      if (U.inv && U.bInv) {
        U.inv.atualizar(e, ligado);
        U.lInv.limpar();
        U.inv.linhas(e, U.lInv, U.det);
        U.bInv.atualizar(U.inv.ruidoso ? U.lVazia : U.lInv, 1, jg * this.kAbs.inversor);
      }
      // redução (engrenamento e ruídos)
      if (U.red) {
        U.lRed.limpar();
        U.red.linhas(e, U.lRed, U.det, fBase);
        U.red.inicio(e, U.det, fBase);
        U.bRed?.atualizar(U.lRed, jf, jg * this.kAbs.reducao);
      }
      if (U.ven && U.bVen) { U.lVen.limpar(); U.ven.linhas(e, U.lVen, U.det, dt, this.ign); U.bVen.atualizar(U.lVen, jf, jg * this.kAbs.ventilador); }
      if (U.esc && U.bEsc) { U.lEsc.limpar(); U.esc.linhas(e, U.lEsc, U.det); U.bEsc.atualizar(U.lEsc, jf, jg * this.kAbs.escovas); }
      if (U.hel && U.bHel) { U.lHel.limpar(); U.hel.linhas(e, U.lHel, U.det, fBase); U.bHel.atualizar(U.lHel, jf, jg * this.kAbs.helice); }
    }
    // auxiliar (constante, com a ignição) e AVAS
    if (this.bAux) { this.lAux.limpar(); if (this.ign) linhasAux(p, this.lAux); this.bAux.atualizar(this.lAux, 1, this.kAbs.aux); this.ruidoAux?.alvo(this.ign ? this.rmsAux : 0); }
    if (this.avas && this.bAvas) {
      this.lAvas.limpar();
      const vS = this.re ? -vp : vp;
      this.avas.linhas(vS, this.ign, dt, this.lAvas);
      this.bAvas.atualizar(this.lAvas, 1, this.kAbs.avas);
    }
  }

  // ------------------------------------------------------------ áudio
  processar(saidas: Float32Array[], n: number) {
    for (let i = 0; i < this.canais.length; i++) if (saidas[i]) saidas[i].fill(0, 0, n);
    let k = 0;
    while (k < n) {
      if (this.pos === 0) this.controle();
      const m = Math.min(BLOCO - this.pos, n - k), pos = this.pos;
      const ini = pos === 0;
      for (let ui = 0; ui < this.uni.length; ui++) {
        const U = this.uni[ui];
        const oM = saidas[U.cMotor];
        if (oM) { U.bMotor.processar(oM, k, m); U.corcova?.processar(oM, k, m, pos, BLOCO, this.kAbs.motor); }
        if (U.bInv) { const o = saidas[U.cInv]; if (o) { U.bInv.processar(o, k, m); U.inv!.ruido(o, k, m, this.kAbs.inversor, ini); } }
        if (U.red) {
          const o = U.bRed ? saidas[U.cRed] : oM;
          if (o) { U.bRed?.processar(o, k, m); U.red.ruido(o, k, m, pos, BLOCO, U.bRed ? this.kAbs.reducao : this.kAbs.motor); }
        }
        if (U.bVen) { const o = saidas[U.cVen]; if (o) { U.bVen.processar(o, k, m); U.ven!.ruido.processar(o, k, m, pos, BLOCO, this.kAbs.ventilador); } }
        if (U.bEsc) { const o = saidas[U.cEsc]; if (o) { U.bEsc.processar(o, k, m); U.esc!.ruido(o, k, m, pos, BLOCO, this.kAbs.escovas); } }
        if (U.bHel) { const o = saidas[U.cHel]; if (o) { U.bHel.processar(o, k, m); U.hel!.largo.processar(o, k, m, pos, BLOCO, this.kAbs.helice); } }
      }
      if (this.bAux && saidas[this.cAux]) { this.bAux.processar(saidas[this.cAux], k, m); this.ruidoAux?.processar(saidas[this.cAux], k, m, pos, BLOCO, this.kAbs.aux); }
      if (this.bAvas) {
        const o = saidas[this.re ? this.cAvasRe : this.cAvas];
        if (o) { this.bAvas.processar(o, k, m); this.avas!.processar(o, k, m, pos, BLOCO); }
      }
      this.pos = (pos + m) % BLOCO;
      k += m;
    }
  }

  telemetria(): TelemetriaMotor {
    const e = this.e, U = this.uni[0], inv = U?.inv;
    const rpm = (this.eixo.omega * 60) / TAU;
    return {
      rpm, torque: e.T, potencia: e.P, estado: this.estado,
      corrente: e.I * Math.sign(e.T || 1), fE: e.fe, fRot: e.frot, fC: inv ? inv.fc : 0, N: inv ? inv.N : 0,
      modo: (inv ? inv.modo : 'desligado') as ModoEfetivo, M: e.M, fluxo: e.fluxo, v: this.v,
      nota: inv && inv.modo === 'escada' && inv.nota >= 0 ? inv.nota : -1,
      notaNome: inv && inv.modo === 'escada' && inv.nota >= 0 && inv.nota < NOMES_NOTAS.length ? NOMES_NOTAS[inv.nota] : inv && inv.modo === 'escada' ? 'patamar' : '',
      D: e.D, avas: this.avas ? this.avas.env : 0, linhas: this.linhasTelemetria(),
    };
  }

  /** as 12 maiores linhas da unidade 0 (com aux e AVAS), em dB SPL a 7,5 m, para o espectro anotado */
  linhasTelemetria(max = 12) {
    const out: { id: string; f: number; dB: number }[] = [];
    const U = this.uni[0];
    if (!U) return out;
    const bancos = [U.bMotor, U.bInv, U.bRed, U.bVen, U.bEsc, U.bHel, this.bAux, this.bAvas];
    for (const b of bancos) {
      if (!b) continue;
      for (let j = 0; j < b.Lmax; j++) {
        if (!b.ativo[j] || b.a[j] <= 0) continue;
        const f = (b.d[j] * this.fs) / TAU, dB = 20 * Math.log10((b.a[j] * Math.SQRT1_2) / 2e-5);
        out.push({ id: NOME_MEC[b.chave[j] >> 16] ?? '?', f, dB });
      }
    }
    out.sort((a, b) => b.dB - a.dB);
    return out.slice(0, max);
  }
}
