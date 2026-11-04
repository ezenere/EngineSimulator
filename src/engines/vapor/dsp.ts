// VaporDSP: a máquina a vapor por síntese física (docs/VAPOR.md, decisões 1–11). Um DSP novo: não há combustão no
// cilindro, então NÃO herda do EngineDSP; implementa o `Motor` de src/carriers/tipos.ts direto.
//
// Por amostra:
//   - cinemática das manivelas (θ += ω·redução·dt por motor; dois motores sem fase travada na articulada);
//   - cada extremidade de cada cilindro de dupla ação: volume pela manivela, evento da distribuição pelo corte
//     (tabela 1.2), pressão (admissão: 1ª ordem de 3 ms até a caixa de válvulas com a perda das passagens; expansão e
//     compressão: politrópica incremental; escape: esvaziamento pelo pórtico com a área abrindo em 20° de manivela,
//     escoamento compressível com engasgo, implícito contra a linha da passagem);
//   - a rede bico → caixa de fumaça → chaminé (rede.ts) e o ruído de jato do bico, que dão o chuff: o chuff é o que a
//     rede faz com a vazão do pórtico, não uma amostra;
//   - torque Σ (p − p0)·dV/dθ, a integração de ω com J = J_motor + carga.inercia ou só J_motor patinando (a patinagem
//     é a troca de J: a roda desacopla da massa do trem quando o esforço passa da adesão);
//   - caixa de válvulas (volume alimentado pelo regulador, um orifício a partir da caldeira) e as fontes auxiliares.
// A cada 64 amostras: caldeira, regulador (1ª ordem de 0,4 s), reverser (1,5 s), auxiliares, governador (estacionária),
// adesão, aquecimento do apito, filtros que dependem da velocidade do jato.
//
// Canais (fontes, ordem de `fontes`), Pa a 7,5 m depois da sonda de nível (motor.ts): `chamine`, `cilindro.e/d`,
// `bielas.e/d`, `apito`, `seguranca`, `bomba.ar` (`bomba.ar.1`), `injetor`, `sino`, `queimador`, `engrenagens`,
// `correias`. A posição e a diretividade de cada uma estão em 4.3.
import type { FonteSonora, EixoSaida, Carga, ComandoMotor, Vec3, Diretividade } from '../../scene/tipos';
import type { Motor, EstadoMotor, TelemetriaMotor } from '../../carriers/tipos';
import { RNG, Biquad, onePole } from '../../acoustics';
import { RedeEscape, JatoBico, vazaoV } from './rede';
import { Apito, Sino } from './apito';
import { BombaAr, Injetor, Seguranca, Torneiras, Bielas, Soprador, Queimador, Engrenagens, Correias, Ruido } from './auxiliares';
import { type PresetVapor, escapesPorVolta } from './presets';
import {
  P0, BAR, G, R_V, T_SUPER, T_SAT, K_T_ESCAPE, N_SUPER, N_SAT, PERDA_ADMISSAO, V_NOCIVO, HASTE, CD_PORTICO,
  ABERTURA_PORTICO, TAU_ADMISSAO, eventos, cortePorReverser, MU, REF_DIST_VAPOR, C_V,
} from './constantes';

const TAU = Math.PI * 2;
/** sopro da tiragem na chaminé, na escala do ruído de mistura (kg/s·M³), na vazão média = E_max */
const K_TIRAGEM = 28;
/** chiado do vapor entrando no condensador, na escala do ruído de mistura, por kg/s */
const K_CONDENSADOR = 0.8;
/** inércia térmica da fornalha e da água (s) */
const TAU_FOGO = 60;
/** governador de esferas: corte por % de erro de rotação e integral por %·s */
const GOV_KP = 0.2, GOV_KI = 0.012;
/** corte mínimo do governador (o 2.1 diz 10%; o disparo do Corliss corta bem antes, e com 10% a máquina de moinho
 * em meia carga ficava forte demais e o governador tinha de estrangular o regulador) */
const GOV_CMIN = 0.05;
/** ruído de mistura do bico, Pa (unidades da linha) por kg/s·M³, num bico de 0,0177 m² (escala com 1/A_bico) */
const K_MISTURA = 1500;
const DEG = Math.PI / 180;

/** extensão de ComandoMotor (campos opcionais; os outros motores os ignoram) */
export interface ComandoVapor {
  regulador: number;        // 0..1 (substitui `acelerador`; se só `acelerador` vier, regulador = acelerador)
  cutoff: number;           // −1..1: reverser; sinal = sentido, |c| → corte 15–85% (1.2)
  apito: number;            // 0..1 abertura da válvula do apito
  sino: boolean;
  areia: boolean;
  torneiras: boolean | 'auto';
  fogo: number | 'auto';
  injetor: boolean | 'auto';
  bombaAr: boolean | 'auto';
  soprador: boolean | 'auto';
  freio: number;            // 0..1 (o motor usa para a bomba de ar)
  simplificacao?: boolean;  // compound: válvula de partida (vapor vivo na BP)
  trilho?: 'seco' | 'molhado';
  /** mistura (como o Ronco): ar = jato, choque, torneiras e vazamentos; mecanica = bielas, engrenagens, correias */
  mixAr?: number; mixMec?: number;
}

export interface TelemetriaVapor extends TelemetriaMotor {
  rpm: number; pCaldeira: number; pChest: number; pRelease: number; corte: number; chuffsPorS: number;
  vapor: number; evaporacao: number; esforco: number; adesao: number; patinando: boolean;
  seguranca: boolean; injetor: boolean; bombaAr: boolean; torneiras: boolean; soprador: boolean;
  fApito: number[];
  [k: string]: unknown;
}

/** componentes calibrados pela sonda (motor.ts): um ganho por componente, Pa a 7,5 m por unidade interna */
export type IdComponente = 'chuff' | 'soprador' | 'torneiras' | 'vazamentos' | 'bielas' | 'apito' | 'seguranca' | 'bomba' | 'injetor' | 'sino' | 'queimador' | 'engrenagens' | 'correias';
export const COMPONENTES: readonly IdComponente[] = ['chuff', 'soprador', 'torneiras', 'vazamentos', 'bielas', 'apito', 'seguranca', 'bomba', 'injetor', 'sino', 'queimador', 'engrenagens', 'correias'];

/** um comando com qualquer destes campos é do vapor: o `acelerador` genérico do portador não vira regulador */
const CHAVES_VAPOR = new Set(['cutoff', 'apito', 'sino', 'areia', 'torneiras', 'fogo', 'injetor', 'bombaAr', 'soprador', 'freio', 'simplificacao', 'trilho', 'mixAr', 'mixMec']);

const OMNI: Diretividade['tabela'] = [0, 0, 0, 0, 0, 0, 0];
const T_LADO: Diretividade['tabela'] = [0, -1, -3, -6, -9, -12, -14];
const dir = (tabela: Diretividade['tabela'], eixo: Vec3, expConv = 2): Diretividade => ({ tabela, eixo, expConv });

/** configuração pronta (preset + ganhos da sonda); `prepararMotorVapor` (motor.ts) a monta */
export interface ConfigVapor { preset: PresetVapor; ganhos: Partial<Record<IdComponente, number>>; uso?: string }

export class VaporDSP implements Motor {
  readonly familia = 'vapor' as const;
  fontes: FonteSonora[] = [];
  eixo: EixoSaida = { omega: 0, torque: 0, inercia: 3000 };
  estado: EstadoMotor = 'funcionando';
  governadorProprio = false;
  fs: number;
  P!: PresetVapor;
  ganhos: Record<IdComponente, number> = Object.fromEntries(COMPONENTES.map((c) => [c, 1])) as Record<IdComponente, number>;
  /** sonda: só os componentes com máscara 1 soam (motor.ts) */
  mascara: Record<IdComponente, number> = Object.fromEntries(COMPONENTES.map((c) => [c, 1])) as Record<IdComponente, number>;
  /** gancho de leitura por amostra para as ferramentas (null no navegador) */
  tap: ((d: VaporDSP) => void) | null = null;

  // ---------------------------------------------------------------- geometria
  nM = 1;                      // motores (2 na articulada)
  nE = 0;                      // extremidades
  reducao = 1;
  rRoda = 1;                   // m
  nPol = N_SUPER; Tv = T_SUPER; Tex = T_SUPER * K_T_ESCAPE; sRTv = 1; sRTex = 1;
  eMotor!: Int32Array; eCil!: Int32Array; eLado!: Int32Array; ePass!: Int32Array; eFonte!: Int32Array; eDest!: Int32Array;
  ePhi!: Float64Array; eVs!: Float64Array; eVcl!: Float64Array; eAe!: Float64Array;
  eP!: Float64Array; eV!: Float64Array; eFase!: Int32Array; eMdot!: Float64Array; ePerda!: Float64Array;
  eAC = new Float64Array(0); eAR = new Float64Array(0); eAK = new Float64Array(0);
  /** por cilindro: força líquida (p_frente − p_trás)·A e o salto suavizado (bielas) */
  cF!: Float64Array; cDF!: Float64Array; cLado!: Int32Array; cA!: Float64Array; nC = 0;
  /** por motor: ângulo da manivela, ω da roda, J, adesão, patinando, deriva */
  thM!: Float64Array; wM!: Float64Array; JM!: Float64Array; wAd!: Float64Array; patM!: Uint8Array; epsM!: Float64Array; tqM!: Float64Array;
  /** ω da roda se não patinasse (= v/r) */
  wTrem = 0;
  omegaImposto: number | null = null;

  // ---------------------------------------------------------------- rede e fontes
  rede!: RedeEscape; jato!: JatoBico;
  condensador = false; pCond = P0;
  apito!: Apito; sino: Sino | null = null; bombas: BombaAr[] = [];
  injetor!: Injetor; seg!: Seguranca; torn: Torneiras[] = []; biel: Bielas[] = []; soprador!: Soprador;
  queimador: Queimador | null = null; engren: Engrenagens | null = null; correias: Correias | null = null;
  hpSeg = new Biquad(); lpCond = new Biquad(); lpCond2 = new Biquad();
  /** índice de cada canal em `fontes` (−1 = não tem) */
  ch = { chamine: 0, cilE: -1, cilD: -1, bielE: -1, bielD: -1, apito: -1, seguranca: -1, bomba0: -1, bomba1: -1, injetor: -1, sino: -1, queimador: -1, engrenagens: -1, correias: -1 };

  // ---------------------------------------------------------------- caldeira, regulador, distribuição
  pCal = 0;                    // bar manométrico
  pNom = 0;
  pChest = P0;                 // Pa abs
  vChest = 0.4;
  aRegMax = 0;
  pRec = P0; vRec = 1;         // receptor do compound (Pa abs)
  reg = 0; regAlvo = 0;        // regulador 0..1
  rev = 0.6; revAlvo = 0.6;    // reverser −1..1
  corte = 0.57; aC = 0; aR = 0; aK = 0; aL = 0;
  dirMarcha = 1;
  fogo = 0.5; fogoAuto = true; fogoCmd: number | 'auto' = 'auto';
  tiragem = 0.2;
  mCyl = 0; mCylS = 0;          // kg/s consumidos pelos cilindros (no bloco e suavizado)
  mTot = 0; evap = 0;
  mAgua = 1000;
  mu: number = MU.seco; muAlvo: number = MU.seco; areia = false; trilho: 'seco' | 'molhado' = 'seco';
  apitoCmd = 0; sinoCmd = false; torneirasCmd: boolean | 'auto' = 'auto'; injetorCmd: boolean | 'auto' = 'auto';
  bombaCmd: boolean | 'auto' = 'auto'; sopradorCmd: boolean | 'auto' = 'auto'; freio = 0; freioAnt = 0; simplif = false;
  mixAr = 1; mixMec = 1;
  torneirasAbertas = false; voltasDesdeParado = 1e9; tParado = 0;
  sopradorLigado = 0;
  /** governador de esferas (estacionária e trator parado): alvo, integrador */
  rpmAlvo = 0; govI = 0; govLigado = false;
  carga: Carga | null = null;
  rng: RNG;
  // telemetria
  pRelSoma = 0; pRelN = 0; pRelUlt = P0; engasgado = false; esforcoS = 0; tqS = 0; nEscapes = 0;
  pCaixaMax = 0; pCaixaMin = 0;
  fApitoTel: number[] = [];
  nCtl = 0; cntCtl = 0;
  TE = 1;                      // N, esforço de tração nominal (catálogo) para as escalas
  wRef = 1;                    // rad/s de referência das bielas (1 volta/s)
  jMotorTotal = 0; jPreset = 0; kAtV = 0; kAtS = 0; cEventos = -1;
  tirR!: Ruido;
  sM = new Float64Array(2); cM = new Float64Array(2); sPhi = new Float64Array(0); cPhi = new Float64Array(0);
  condEnv = 0; condEnv2 = 0; kCondEnv = 0; momS = 0; kMom = 0;

  constructor(fs: number) { this.fs = fs; this.rng = new RNG(1); }

  // ================================================================ configuração
  configurar(cfgOuPreset: object, fs: number) {
    this.fs = fs;
    const c = cfgOuPreset as Partial<ConfigVapor> & PresetVapor;
    const P: PresetVapor = (c as ConfigVapor).preset ?? (c as PresetVapor);
    const ganhos = (c as ConfigVapor).ganhos;
    if (ganhos) for (const k of COMPONENTES) if (ganhos[k] != null) this.ganhos[k] = ganhos[k]!;
    this.P = P;
    this.rng = new RNG(P.semente);
    this.reducao = P.reducao ?? 1;
    this.rRoda = P.dRoda > 0 ? P.dRoda / 2 : 1;
    this.nPol = P.superaquecido ? N_SUPER : N_SAT;
    this.Tv = P.superaquecido ? T_SUPER : T_SAT;
    this.Tex = this.Tv * K_T_ESCAPE;
    this.sRTv = Math.sqrt(R_V * this.Tv); this.sRTex = Math.sqrt(R_V * this.Tex);
    this.pNom = P.pNominal; this.pCal = P.pNominal;
    this.condensador = P.escape.destino === 'condensador' || P.escape.destino === 'abafador';
    this.pCond = P.escape.pCondensador ?? P0;
    this.governadorProprio = P.familia === 'estacionaria';
    this.rpmAlvo = P.rpmGovernado ?? 0;
    this.montarCilindros(P);
    this.montarFontes(P);
    // caixa de válvulas e regulador: A_max tal que, com o regulador cheio e a vazão máxima (1,5·E_max), p_chest ≈ 0,85·p_cal
    const vsTot = this.volumeTotal();
    this.vChest = Math.max(0.005, 0.4 * (vsTot / 1.05));
    const mMax = 1.5 * P.evaporacaoMax, pAbs = P.pNominal * BAR + P0;
    this.aRegMax = (mMax * this.sRTv) / (pAbs * 0.5);
    this.pChest = P0;
    if (P.compound) { this.vRec = P.compound.receptor; this.pRec = P0; }
    this.mAgua = 300 * P.evaporacaoMax;
    this.evap = 0.2 * 0.15 * P.evaporacaoMax;   // (parada, foguista no mínimo, tiragem natural)
    this.estado = 'funcionando';
    this.fixar({ regulador: 0, cutoff: P.familia === 'estacionaria' ? 0.2 : 0.6 });
  }

  private volumeTotal() { let s = 0; for (let e = 0; e < this.nE; e++) s += this.eVs[e]; return s; }

  /** extremidades: as BP (ou as simples) escapam pela chaminé; as AP do compound para o receptor */
  private montarCilindros(P: PresetVapor) {
    type Cil = { motor: number; d: number; s: number; ang: number; lado: number; ap: boolean };
    const cils: Cil[] = [];
    const s = P.cilindros.curso;
    const ladoDe = (k: number, n: number) => (n <= 1 ? 0 : Math.min(1, Math.floor((k * 2) / n)));
    if (P.compound) {
      const nm = P.motores ?? 1;
      const { ap, bp } = P.compound;
      const angs = P.cilindros.angulo ?? [0, 90, 180, 270];
      // articulada (Y6b): motor traseiro (1) = AP, dianteiro (0) = BP; barco: um motor só, AP e BP a 90°
      for (let k = 0; k < bp.n; k++) cils.push({ motor: 0, d: bp.diametro, s, ang: (angs[k % angs.length] ?? 90 * k) * DEG, lado: ladoDe(k, bp.n), ap: false });
      for (let k = 0; k < ap.n; k++) cils.push({ motor: nm > 1 ? 1 : 0, d: ap.diametro, s, ang: (nm > 1 ? angs[k % angs.length] : angs[(bp.n + k) % angs.length] ?? 90) * DEG, lado: ladoDe(k, ap.n), ap: true });
      this.nM = nm;
    } else {
      const nm = P.motores ?? 1, n = P.cilindros.n;
      const angs = P.cilindros.angulo ?? (n === 1 ? [0] : n === 2 ? [0, 90] : n === 3 ? [0, 120, 240] : [0, 180, 90, 270]);
      for (let m = 0; m < nm; m++) for (let k = 0; k < n; k++) cils.push({ motor: m, d: P.cilindros.diametro, s, ang: angs[k] * DEG, lado: ladoDe(k, n), ap: false });
      this.nM = nm;
    }
    this.nC = cils.length; this.cEventos = -1;
    const nE = 2 * cils.length;
    this.nE = nE;
    this.eMotor = new Int32Array(nE); this.eCil = new Int32Array(nE); this.eLado = new Int32Array(nE); this.ePass = new Int32Array(nE);
    this.eFonte = new Int32Array(nE); this.eDest = new Int32Array(nE); this.ePhi = new Float64Array(nE); this.eVs = new Float64Array(nE);
    this.eVcl = new Float64Array(nE); this.eAe = new Float64Array(nE); this.eP = new Float64Array(nE).fill(P0); this.eV = new Float64Array(nE);
    this.eFase = new Int32Array(nE); this.eMdot = new Float64Array(nE); this.ePerda = new Float64Array(nE).fill(PERDA_ADMISSAO);
    this.eAC = new Float64Array(nE); this.eAR = new Float64Array(nE); this.eAK = new Float64Array(nE);
    this.sPhi = new Float64Array(nE); this.cPhi = new Float64Array(nE);
    this.cF = new Float64Array(this.nC); this.cDF = new Float64Array(this.nC); this.cLado = new Int32Array(this.nC); this.cA = new Float64Array(this.nC);
    let np = 0;
    cils.forEach((cl, k) => {
      const A = (Math.PI / 4) * cl.d * cl.d, Vs = A * cl.s;
      this.cLado[k] = cl.lado; this.cA[k] = A;
      for (let j = 0; j < 2; j++) {
        const e = 2 * k + j;
        this.eMotor[e] = cl.motor; this.eCil[e] = k; this.eLado[e] = cl.lado;
        this.ePhi[e] = cl.ang + j * Math.PI;              // a extremidade traseira está a 180°
        this.sPhi[e] = Math.sin(this.ePhi[e]); this.cPhi[e] = Math.cos(this.ePhi[e]);
        this.eVs[e] = Vs * (j === 1 ? 1 - HASTE : 1);      // (a haste ocupa 4% da área do lado de trás)
        this.eVcl[e] = V_NOCIVO * Vs;
        // pórtico: 0,03 m² no K4s (V 0,26 m³), escalado por V^0,75 (0-6-0T: 0,08 m³ → 0,012 m²)
        this.eAe[e] = 0.03 * Math.pow(Vs / 0.263, 0.75);
        // as passagens de escape das duas pontas de um cilindro não são iguais (fundição, comprimento até o bloco
        // de escape) e os dois lados também não: ±4%. Com a desigualdade do corte (atualizarEventos) é o que põe a
        // linha de 2/volta 5–15 dB abaixo da de 4/volta e a de 1/volta abaixo dela (1.3, Apêndice A)
        this.eAe[e] *= (j === 0 ? 1.04 : 0.96) * (cl.lado === 0 ? 1.04 : 0.96);
        this.eFonte[e] = P.compound && !cl.ap ? 1 : 0;      // a BP do compound admite do receptor
        this.eDest[e] = cl.ap ? 1 : 0;                      // a AP escapa para o receptor
        this.ePass[e] = np++;                               // (todas têm passagem: a AP usa na simplificação)
        this.eV[e] = this.eVcl[e];
      }
    });
    this.thM = new Float64Array(this.nM); this.wM = new Float64Array(this.nM); this.JM = new Float64Array(this.nM);
    this.wAd = new Float64Array(this.nM); this.patM = new Uint8Array(this.nM); this.epsM = new Float64Array(this.nM); this.tqM = new Float64Array(this.nM);
    // (com redução, o J do preset é o do lado da manivela: na roda vale J·redução²)
    const jPorMotor = P.J != null ? (P.J * this.reducao * this.reducao) / this.nM : Math.max(1500, (20 * P.massaAderente) / this.nM);
    this.jPreset = P.J ?? 0;
    for (let m = 0; m < this.nM; m++) {
      this.JM[m] = jPorMotor;
      // dois motores: a roda do traseiro gira ε mais depressa (diâmetros e desgaste diferentes; 0,5–2%)
      this.epsM[m] = m === 0 ? 0 : (P.derivaFase ?? 0.01) * (0.8 + 0.4 * this.rng.next());
      // (fase inicial fora do ponto morto: a máquina de 1 cilindro parada no PM não sai sem ser girada à mão)
      this.thM[m] = 0.9 + m * 1.3;
    }
    this.jMotorTotal = jPorMotor * this.nM;
    this.eixo.inercia = this.jMotorTotal;
    // esforço de tração nominal (1.2): 0,85·p·d²·s/D por par de cilindros
    const d = P.compound ? P.compound.ap.diametro : P.cilindros.diametro;
    const pares = P.compound ? P.compound.ap.n / 2 : (P.cilindros.n / 2) * (P.motores ?? 1);
    this.TE = (0.85 * P.pNominal * BAR * d * d * s * pares * this.reducao) / (2 * this.rRoda);
    this.wRef = TAU / this.reducao;
    // atrito viscoso das bielas e dos mancais (2% do esforço nominal na velocidade máxima) mais um seco: 0,4% nas
    // locomotivas, 3% nas estacionárias e 8% no trator (bombas, engrenagens e os mancais das rodas na embreagem solta)
    this.kAtV = (0.02 * this.TE * this.rRoda) / Math.max(1, P.vMax / 3.6 / this.rRoda);
    this.kAtS = (P.familia === 'locomotiva' ? 0.004 : P.familia === 'trator' ? 0.08 : 0.03) * this.TE * this.rRoda;
    // rede: uma passagem por extremidade
    this.rede = new RedeEscape(this.fs, {
      nPassagens: nE, aPortico: CD_PORTICO * this.eAe[0], dBico: P.escape.dBico, lDescarga: P.escape.lDescarga, vCaixa: P.escape.vCaixa,
      lChamine: P.escape.lChamine, dChamine: P.escape.dChamine, kNL: P.escape.kNL ?? 0.3, condensador: this.condensador,
    });
    this.jato = new JatoBico(this.fs, P.escape.dBico, P.semente ^ 0x1e7);
    // ganho do ruído de mistura relativo ao tom da chaminé (unidades da linha: Pa por kg/s·M³), acertado contra as
    // bandas de perto (3.3); o choque fica 6 dB acima da mistura quando pleno (controle "Ar")
    this.jato.gMistura = (K_MISTURA * 0.0177) / this.rede.aBico;
    this.jato.gChoque = 0.9 * this.jato.gMistura;
    this.lpCond.lp(this.fs, 300, 0.7071); this.lpCond2.lp(this.fs, 300, 0.7071); this.kCondEnv = onePole(this.fs, 5); this.kMom = onePole(this.fs, 0.5);
    // (tiragem: 200–1500 Hz; o 1.4 diz 300–1500)
    this.tirR = new Ruido(P.semente ^ 0x7123, [new Biquad().hp(this.fs, 200, 0.7071), new Biquad().lp(this.fs, 1500, 0.7071), new Biquad().lp(this.fs, 4000, 0.7071)]);
    // volumes iniciais pela posição das manivelas
    for (let e = 0; e < nE; e++) { let a = this.thM[this.eMotor[e]] + this.ePhi[e]; a -= TAU * Math.floor(a / TAU); const sg = (e & 1) === 0 ? 1 : -1; this.eV[e] = this.eVcl[e] + this.eVs[e] * (0.5 * (1 - Math.cos(a)) + sg * LAMBDA4 * Math.sin(a) * Math.sin(a)); }
  }

  private montarFontes(P: PresetVapor) {
    const fs = this.fs, g = P.geometria, R = REF_DIST_VAPOR, sem = P.semente;
    const F: FonteSonora[] = [];
    const yC = g.yCilindros ?? 1.3;
    const est = P.familia === 'estacionaria';
    const add = (f: Omit<FonteSonora, 'refDist' | 'dentro'> & { dentro?: boolean }) => { F.push({ refDist: R, dentro: false, ...f }); return F.length - 1; };
    const ch = this.ch;
    ch.chamine = add({ id: 'chamine', tipo: 'escape', pos: [g.xChamine, 0, g.zTopo + 0.3], dir: dir(OMNI, [0, 0, 1]) });
    const doisLados = P.cilindros.n > 1 || !!P.compound || (P.motores ?? 1) > 1;
    ch.cilE = add({ id: 'cilindro.e', tipo: 'mecanica', pos: [g.xCilindros, yC, 0.6], dir: dir(yC > 0.9 ? T_LADO : OMNI, [0, 1, 0]), dentro: est });
    ch.cilD = doisLados ? add({ id: 'cilindro.d', tipo: 'mecanica', pos: [g.xCilindros, -yC, 0.6], dir: dir(yC > 0.9 ? T_LADO : OMNI, [0, -1, 0]), dentro: est }) : -1;
    ch.bielE = add({ id: 'bielas.e', tipo: 'mecanica', pos: [g.xCilindros - 1.5, Math.max(yC, 1.2) * (yC > 0.9 ? 0.92 : 1), 0.5], dir: dir(OMNI, [0, 1, 0]), dentro: est });
    ch.bielD = doisLados ? add({ id: 'bielas.d', tipo: 'mecanica', pos: [g.xCilindros - 1.5, -Math.max(yC, 1.2) * (yC > 0.9 ? 0.92 : 1), 0.5], dir: dir(OMNI, [0, -1, 0]), dentro: est }) : -1;
    ch.apito = add({ id: 'apito', tipo: 'pa', pos: [g.xDomo, 0, g.zTopo + 0.4], dir: dir(T_LADO, [1, 0, 0]) });
    ch.seguranca = add({ id: 'seguranca', tipo: 'escape', pos: [g.xDomo - 1, 0, g.zTopo + 0.2], dir: dir(OMNI, [0, 0, 1]) });
    if (P.bombaAr) {
      ch.bomba0 = add({ id: P.bombaAr.n > 1 ? 'bomba.ar.0' : 'bomba.ar', tipo: 'compressor', pos: [g.xChamine - 1, -1.4, 1.8], dir: dir(OMNI, [0, -1, 0]) });
      if (P.bombaAr.n > 1) ch.bomba1 = add({ id: 'bomba.ar.1', tipo: 'compressor', pos: [g.xChamine - 1, 1.4, 1.8], dir: dir(OMNI, [0, 1, 0]) });
    }
    ch.injetor = add({ id: 'injetor', tipo: 'mecanica', pos: [g.xCabine, -1.3, 1.2], dir: dir(OMNI, [0, -1, 0]) });
    if (P.sino) ch.sino = add({ id: 'sino', tipo: 'pa', pos: [g.xChamine + 1, 0, g.zTopo + 0.3], dir: dir(OMNI, [1, 0, 0]) });
    if (P.queimador) ch.queimador = add({ id: 'queimador', tipo: 'admissao', pos: [1.2, 0, 0.6], dir: dir(OMNI, [1, 0, 0]), dentro: true });
    if (P.engrenagens) ch.engrenagens = add({ id: 'engrenagens', tipo: 'mecanica', pos: [g.xCilindros, 1.1, 0.8], dir: dir(OMNI, [0, 1, 0]) });
    if (P.correias) ch.correias = add({ id: 'correias', tipo: 'mecanica', pos: [-2, 2, 2], dir: dir(OMNI, [0, 1, 0]), dentro: true });
    this.fontes = F;
    // geradores
    this.apito = new Apito(fs, P.apito.tubos, sem ^ 0xa917);
    this.sino = P.sino ? new Sino(fs, P.sino.f, P.sino.batidasPorS, sem ^ 0x5170) : null;
    this.bombas = [];
    if (P.bombaAr) for (let k = 0; k < P.bombaAr.n; k++) { const b = new BombaAr(fs, P.bombaAr.cursosPorMin, sem ^ (0xb0b + 31 * k)); b.t = 0.43 * k; this.bombas.push(b); }
    this.injetor = new Injetor(fs, sem ^ 0x1137);
    this.seg = new Seguranca(fs, sem ^ 0x5e6);
    this.torn = [new Torneiras(fs, sem ^ 0x70e), new Torneiras(fs, sem ^ 0x70d)];
    this.biel = [new Bielas(fs, sem ^ 0xb1e), new Bielas(fs, sem ^ 0xb1d)];
    this.soprador = new Soprador(fs, sem ^ 0x50f);
    this.queimador = P.queimador ? new Queimador(fs, sem ^ 0x9e1) : null;
    this.engren = P.engrenagens ? new Engrenagens(fs, P.engrenagens.z, sem ^ 0xe9) : null;
    this.correias = P.correias ? new Correias(fs, sem ^ 0xc0e) : null;
    this.hpSeg.hp(fs, 20, 0.7071);
  }

  // ================================================================ comando
  /** valores já no alvo (testes, cenários e a troca de preset): sem as rampas do regulador e do reverser */
  fixar(c: { regulador?: number; cutoff?: number }) {
    if (c.regulador != null) { this.reg = this.regAlvo = clamp(c.regulador, 0, 1); }
    if (c.cutoff != null) { this.rev = this.revAlvo = clamp(c.cutoff, -1, 1); }
    this.atualizarEventos();
  }
  /** velocidade imposta à roda (modo de testes e passagem): ω em rad/s, null = livre */
  impor(omega: number | null) { this.omegaImposto = omega; }
  definirReducao(r: number) {
    if (r === this.reducao) return;
    // a roda continua com a mesma velocidade; o J do volante refletido muda com a relação
    this.reducao = r; this.wRef = TAU / r;
    if (this.jPreset) { for (let m = 0; m < this.nM; m++) this.JM[m] = (this.jPreset * r * r) / this.nM; this.jMotorTotal = this.jPreset * r * r; }
  }

  comandar(c0: ComandoMotor & Partial<ComandoVapor>) {
    const c = c0 as Partial<ComandoVapor> & ComandoMotor;
    if (c.regulador != null) this.regAlvo = clamp(c.regulador, 0, 1);
    else if (c.acelerador != null && c.combustivel == null && !this.governadorProprio && !Object.keys(c).some((k) => CHAVES_VAPOR.has(k))) this.regAlvo = clamp(c.acelerador, 0, 1);
    if (c.combustivel != null) this.regAlvo = clamp(c.combustivel, 0, 1);
    if (c.cutoff != null) this.revAlvo = clamp(c.cutoff, -1, 1);
    if (c.apito != null) this.apitoCmd = clamp(c.apito, 0, 1);
    if (c.sino != null) this.sinoCmd = c.sino;
    if (c.areia != null) this.areia = c.areia;
    if (c.torneiras != null) this.torneirasCmd = c.torneiras;
    if (c.fogo != null) this.fogoCmd = c.fogo;
    if (c.injetor != null) this.injetorCmd = c.injetor;
    if (c.bombaAr != null) { this.bombaCmd = c.bombaAr; for (const b of this.bombas) b.forcada = c.bombaAr === true; }
    if (c.soprador != null) this.sopradorCmd = c.soprador;
    if (c.freio != null) this.freio = clamp(c.freio, 0, 1);
    if (c.simplificacao != null) this.simplif = c.simplificacao;
    if (c.trilho != null) this.trilho = c.trilho;
    if (c.mixAr != null) this.mixAr = c.mixAr;
    if (c.mixMec != null) this.mixMec = c.mixMec;
    if (c.rpmAlvo != null && c.rpmAlvo > 0) { this.rpmAlvo = c.rpmAlvo; this.govLigado = true; }
    if (c.ignicao === false) this.fogoCmd = 0;
  }
  acoplar(carga: Carga | null) {
    this.carga = carga;
    // estacionária e trator sem carga ficam no governador (lenta a 70–80 rpm com a embreagem solta)
    if (this.P && (this.P.familia === 'estacionaria' || (this.P.familia === 'trator' && !carga))) this.govLigado = !!this.P.rpmGovernado;
  }

  private atualizarEventos() {
    const c = this.govLigado ? this.corte : cortePorReverser(this.rev);
    if (!this.govLigado) this.corte = c;
    const ev = eventos(c);
    // ângulo da manivela (a partir do ponto morto da extremidade) em que o pistão percorreu a fração x do curso, com a
    // angularidade da biela: a extremidade da tampa (+) e a do lado da manivela (−) cortam em ângulos diferentes, e
    // é isso (com a haste) que faz as duas batidas de um cilindro diferirem 1–2 dB (a linha de 2/volta, 1.3)
    // e a distribuição de cada lado não é igual (corte ±2,5% do curso entre os lados, ±1% entre as pontas: o ajuste da
    // Walschaerts; o maquinista ouve o "manco"): as duas batidas de um cilindro e os dois cilindros diferem 1–2 dB
    if (c === this.cEventos) { this.dirMarcha = this.rev < -0.02 ? -1 : 1; return; }
    this.cEventos = c;
    for (let e = 0; e < this.nE; e++) {
      const sg = (e & 1) === 0 ? 1 : -1, dc = (this.eLado[e] === 0 ? DC_LADO : -DC_LADO) + sg * 0.01;
      this.eAC[e] = angPistao(c + dc, sg); this.eAR[e] = angPistao(ev.r, sg); this.eAK[e] = TAU - angPistao(1 - ev.k, sg);
    }
    this.aC = this.eAC[0]; this.aR = this.eAR[0]; this.aK = this.eAK[0]; this.aL = ev.avanco * DEG;
    this.dirMarcha = this.rev < -0.02 ? -1 : 1;
  }

  // ================================================================ controle (a cada 64 amostras)
  private controle(dt: number) {
    const P = this.P;
    // regulador (1ª ordem 0,4 s) e reverser (1,5 s)
    this.reg += (this.regAlvo - this.reg) * (1 - Math.exp(-dt / 0.4));
    this.rev += (this.revAlvo - this.rev) * (1 - Math.exp(-dt / 1.5));
    // governador de esferas sobre o corte (2.1). O 2.1 dá 0,02 de corte por % de erro e 0,01/(%·s); com o volante de
    // 3·10⁴ kg·m² e o degrau de 50% isso derrubava 14% (o corte tem de ir de ~0,1 a ~0,3: 10% de erro só no
    // proporcional). Com 0,2 e 0,012 a queda é a de 2.1 (2–4%) e a volta em 5–10 s; a borboleta do governador age sem o atraso de 0,4 s do
    // regulador do maquinista (com ele o trator em lenta caçava de 90 a 170 rpm)
    if (this.govLigado && this.rpmAlvo > 0) {
      const w = Math.abs(this.wM[0]) * this.reducao, alvo = (this.rpmAlvo * TAU) / 60;
      const erro = (100 * (alvo - w)) / alvo;
      // (integrador limitado à faixa útil da saída: anti-windup na partida, que vem do repouso com erro de 100%)
      const kp = P.governador?.kp ?? GOV_KP, ki = P.governador?.ki ?? GOV_KI;
      // (integração condicional: só integra perto do alvo, senão a partida do repouso enchia o integrador e passava 30%)
      if (Math.abs(erro) < 15) this.govI = clamp(this.govI + ki * erro * dt, -0.25, 0.45);
      const hunt = P.hunting ? P.hunting * Math.sin(TAU * 0.15 * this.nCtl * dt) : 0;
      // a saída do governador corta primeiro no corte (10–60%) e, abaixo do corte mínimo, fecha o regulador (a
      // borboleta do governador de Watt): sem carga, com o corte no mínimo e o regulador aberto, a máquina disparava
      const u = 0.2 + kp * erro + this.govI + hunt;
      this.corte = clamp(u, GOV_CMIN, 0.6);
      this.regAlvo = clamp(1 + (u - GOV_CMIN) / 0.15, 0, 1); this.reg = this.regAlvo;
    }
    this.atualizarEventos();
    // adesão: μ seco/molhado, areia sobe em 0,3 s
    this.muAlvo = this.areia ? MU.areia : this.trilho === 'molhado' ? MU.molhado : MU.seco;
    this.mu += (this.muAlvo - this.mu) * (1 - Math.exp(-dt / 0.3));
    const wAd = this.P.massaAderente * 1000 * G / this.nM;
    for (let m = 0; m < this.nM; m++) this.wAd[m] = this.mu * wAd * (this.nM > 1 && m === 0 ? 0.93 : 1);   // o dianteiro perde antes
    // caldeira (1.1): dp/dt = (E − ṁ)·k_cal, k_cal = 1 bar/(10·E_max kg)
    const vel = Math.abs(this.wTrem) * this.rRoda;
    const parado = vel < 0.2 && Math.abs(this.wM[0]) < 0.2;
    // tiragem: o jato do escape puxa o fogo; parado só a natural (0,15) e o soprador
    const sopr = this.sopradorCmd === 'auto' ? (this.reg < 0.05 && parado && P.familia === 'locomotiva' ? 1 : 0) : this.sopradorCmd ? 1 : 0;
    this.sopradorLigado = sopr;
    this.tiragem = clamp(0.15 + 0.3 * sopr + this.mCylS / (0.8 * P.evaporacaoMax), 0, 1);
    this.fogoAuto = this.fogoCmd === 'auto';
    if (this.fogoAuto) this.fogo = clamp(0.2 + (this.pNom - this.pCal) / 1, 0, 1);
    else this.fogo = clamp(this.fogoCmd as number, 0, 1);
    // (a evaporação segue o fogo e a tiragem com a inércia térmica da fornalha e da água: 1ª ordem de 40 s. Sem ela o
    // foguista repunha na hora e a arrancada não derrubava a caldeira os 1–2 bar de 1.9)
    this.evap += (this.fogo * P.evaporacaoMax * this.tiragem - this.evap) * (1 - Math.exp(-dt / TAU_FOGO));
    const nSeg = P.evaporacaoMax >= 4 ? 2 : 1, descarga = clamp(0.25 * P.evaporacaoMax, 0.05, 1.5) * nSeg;
    this.seg.controle(this.pCal, this.pNom);
    const mInj = this.injetor.ligado ? clamp(0.15 * P.evaporacaoMax, 0.03, 1.5) : 0;
    const mApito = this.apito.ps * clamp(0.08 * P.evaporacaoMax, 0.02, 0.6) * (P.apito.tipo === 'navio' ? 2 : 1);
    let mBomba = 0; for (const b of this.bombas) mBomba += b.consumo * Math.min(1, P.evaporacaoMax / 3);
    const mVaz = 0.004 * P.evaporacaoMax * (1 + P.folga);
    this.mTot = this.mCyl + mInj + mApito + mBomba + mVaz + (this.seg.aberta ? descarga : 0) + 0.05 * sopr * P.evaporacaoMax;
    const kCal = P.kCaldeira ?? 1 / (10 * P.evaporacaoMax);
    this.pCal = Math.max(0, this.pCal + (this.evap - this.mTot) * kCal * dt);
    this.estado = this.pCal < 0.5 ? 'desligado' : 'funcionando';
    this.mCylS += (this.mCyl - this.mCylS) * (1 - Math.exp(-dt / 0.5));
    // injetor pelo nível de água (2–5 min com a caldeira trabalhando)
    this.injetor.controle(dt, this.injetorCmd, this.mCylS + mApito + mVaz, 1.5 * P.evaporacaoMax, this.mAgua);
    // bomba de ar: carrega depois de parar e depois de cada freada
    if (parado) this.tParado += dt; else this.tParado = 0;
    if (this.tParado > 0 && this.tParado - dt <= 0) for (const b of this.bombas) b.carregar(60);
    if (this.freioAnt > 0.2 && this.freio <= 0.2) for (const b of this.bombas) b.carregar(30);
    this.freioAnt = this.freio;
    for (const b of this.bombas) b.controle(dt, this.bombaCmd === 'auto');
    // torneiras: no automático abertas nas primeiras 15 voltas depois de parado (≥ 5 s)
    if (this.tParado > 5) this.voltasDesdeParado = 0;
    this.voltasDesdeParado += (Math.abs(this.wM[0]) * dt) / TAU;
    this.torneirasAbertas = this.torneirasCmd === 'auto' ? this.voltasDesdeParado < 15 && P.familia === 'locomotiva' : !!this.torneirasCmd;
    const agua = this.torneirasAbertas ? Math.exp(-this.voltasDesdeParado / 5) : 0;
    for (const t of this.torn) t.aguaFrac = agua;
    // apito e sino
    this.apito.controle(dt);
    if (this.sino) this.sino.ligado = this.sinoCmd;
    // jato: filtro de Strouhal pela velocidade do bico
    this.jato.controle(this.rede.mach * C_V);
    this.nCtl++;
  }

  // ================================================================ laço de amostra
  processar(saidas: Float32Array[], n: number) {
    const P = this.P, fs = this.fs, dt = 1 / fs;
    // (constantes e campos em locais: no Node, via tsx, cada constante importada é um getter dentro do laço)
    const P0l = P0, CDP = CD_PORTICO, PERDA = PERDA_ADMISSAO, BARl = BAR, L4 = LAMBDA4;
    const cPhi = this.cPhi, sPhi = this.sPhi, ePerda = this.ePerda;
    const kAlivio = 1 - Math.exp(-dt / 0.15);
    const nE = this.nE, nM = this.nM, red = this.reducao, rede = this.rede;
    const eP = this.eP, eV = this.eV, ePhi = this.ePhi, eVs = this.eVs, eVcl = this.eVcl, eAe = this.eAe, eMotor = this.eMotor, eFase = this.eFase;
    const ePass = this.ePass, eDest = this.eDest, eFonte = this.eFonte, eLado = this.eLado, eCil = this.eCil, eMdot = this.eMdot;
    const thM = this.thM, wM = this.wM, tqM = this.tqM;
    const nPol = this.nPol, kAdm = 1 - Math.exp(-dt / TAU_ADMISSAO);
    const RTv = R_V * this.Tv, RTex = R_V * this.Tex, sRTex = this.sRTex;
    const dAb = ABERTURA_PORTICO * DEG;
    const ch = this.ch, g = this.ganhos, mk = this.mascara;
    const S = saidas;
    for (let i = 0; i < S.length; i++) S[i].fill(0, 0, n);
    const cond = this.condensador;
    const mixAr = this.mixAr, mixMec = this.mixMec;
    const gChuff = g.chuff * mk.chuff, gSopr = g.soprador * mk.soprador, gTorn = g.torneiras * mk.torneiras * mixAr, gVaz = g.vazamentos * mk.vazamentos * mixAr;
    const gBiel = g.bielas * mk.bielas * mixMec, gApito = g.apito * mk.apito, gSeg = g.seguranca * mk.seguranca, gBomba = g.bomba * mk.bomba;
    const gInj = g.injetor * mk.injetor, gSino = g.sino * mk.sino, gQ = g.queimador * mk.queimador, gEng = g.engrenagens * mk.engrenagens * mixMec, gCor = g.correias * mk.correias * mixMec;
    const pNomAbs = this.pNom * BARl + P0l;
    let mCylBloco = 0;
    const sM = this.sM, cM = this.cM;
    for (let k = 0; k < n; k++) {
      if (--this.cntCtl < 0) { this.cntCtl = 63; this.controle(64 / fs); }
      const pCalAbs = this.pCal * BARl + P0l;
      const aL = this.aL, d = this.dirMarcha, eAC = this.eAC, eAR = this.eAR, eAK = this.eAK;
      const aAdm0 = TAU - aL;
      // ---- caixa de válvulas: orifício do regulador a partir da caldeira
      const r = this.reg, aReg = r < 0.3 ? (0.08 * r) / 0.3 : 0.08 + 0.92 * ((r - 0.3) / 0.7) * ((r - 0.3) / 0.7);
      const mReg = vazaoV(aReg * this.aRegMax, pCalAbs, this.pChest, this.sRTv);
      let mAdmChest = 0, mAdmRec = 0, mRecIn = 0, mCond = 0;
      for (let m = 0; m < nM; m++) { sM[m] = Math.sin(thM[m]); cM[m] = Math.cos(thM[m]); }
      rede.ler();
      let tqTot = 0, tornE = 0, tornD = 0;
      for (let e = 0; e < nE; e++) {
        const m = eMotor[e];
        const th0 = thM[m] + ePhi[e];
        let a = d * th0;
        a -= TAU * Math.floor(a / TAU);
        // (sen e cos pela soma de ângulos: dois por motor por amostra, não dois por extremidade)
        const j = e & 1, sg = j === 0 ? 1 : -1, sMo = sM[m], cMo = cM[m];
        const sa = d * (sMo * cPhi[e] + cMo * sPhi[e]), ca = cMo * cPhi[e] - sMo * sPhi[e];
        void th0;
        const Vs = eVs[e], V = eVcl[e] + Vs * (0.5 * (1 - ca) + sg * L4 * sa * sa);
        const dV = V - eV[e];
        let p = eP[e];
        let fase: number;
        const aC = eAC[e], aR = eAR[e], aK = eAK[e];
        if (a >= aAdm0 || a < aC) fase = 0; else if (a < aR) fase = 1; else if (a < aK) fase = 2; else fase = 3;
        // cada admissão um pouco diferente (pressão na caixa, água arrastada): ±1–2 dB por chuff
        if (fase === 0 && eFase[e] === 3) ePerda[e] = PERDA * (1 + 0.05 * this.rng.gauss());
        // expansão/compressão politrópica incremental (todas as fases sentem o volume mudar)
        p *= 1 - (nPol * dV) / V;
        const pass = ePass[e];
        let mE = 0;
        if (fase === 0) {
          // admissão: a pressão vai à da caixa (ou do receptor) com 1ª ordem de 3 ms, menos a perda das passagens; o
          // fechamento estrangula nos últimos 3° (wire drawing)
          const src = eFonte[e] === 1 ? this.pRec : this.pChest;
          const fim = a < aC ? Math.min(1, (aC - a) / (3 * DEG)) : 1;
          // (a perda das passagens só vale entrando: com o cilindro entre 0,92·p_caixa e p_caixa não há escoamento, e
          // acima de p_caixa o vapor volta para a caixa sem perda; com a perda simétrica a compressão empurrava vapor para
          // uma caixa de pressão maior e a máquina de regulador fechado ganhava energia do nada)
          const alvo = p < ePerda[e] * src ? ePerda[e] * src : p > src ? src : p;
          const dp = kAdm * fim * (alvo - p);
          p += dp;
          const dm = (dp * V) / (nPol * RTv);
          if (eFonte[e] === 1) mAdmRec += dm; else mAdmChest += dm;
          if (pass >= 0) rede.fechar(pass);
          if (this.torneirasAbertas) { const q = Math.max(0, p - P0l) / pNomAbs; if (eLado[e] === 0) tornE += q; else tornD += q; }
        } else if (fase === 2) {
          // escape: pórtico abrindo em 20° de manivela (^1,5) e fechando simétrico antes da compressão
          let u = Math.min((a - aR) / dAb, (aK - a) / dAb);
          if (u > 1) u = 1;
          const A = eAe[e] * CDP * u * Math.sqrt(u);
          const paraRec = eDest[e] === 1 && !this.simplif;
          if (paraRec) {
            mE = vazaoV(A, p, this.pRec, sRTex);
            mRecIn += mE;
            rede.fechar(pass);
          } else if (cond) {
            mE = vazaoV(A, p, this.pCond, sRTex);
            mCond += mE;
            rede.injetarFixo(pass, 0.15 * mE);
          } else mE = rede.injetar(pass, p, A, sRTex);
          p -= (nPol * RTex * mE * dt) / V;
          if (eFase[e] !== 2) { rede.gAlvo = Math.pow(10, (1.3 * this.rng.gauss() + (this.eLado[e] === 0 ? DB_LADO : -DB_LADO) + ((e & 1) === 0 ? DB_PONTA : -DB_PONTA)) / 20); this.pRelSoma += p; this.pRelN++; this.pRelUlt = p; this.nEscapes++; this.engasgado = p / rede.pPassagem(pass) > 1.83; }
        } else {
          if (pass >= 0) rede.fechar(pass);
          if (fase === 1 && this.torneirasAbertas) { const q = Math.max(0, p - P0l) / pNomAbs; if (eLado[e] === 0) tornE += q; else tornD += q; }
        }
        // dashpot do Corliss: o clique seco no corte da admissão
        if (fase === 1 && eFase[e] === 0 && this.correias) this.biel[eLado[e]].dashpot(Math.min(1, 0.3 + this.reg));
        if (p < 2000) p = 2000;
        eP[e] = p; eV[e] = V; eFase[e] = fase; eMdot[e] = mE;
        // torque na manivela: (p − p0)·dV/dθ; na roda, × redução
        const tq = d * (p - P0l) * Vs * sa * (0.5 + 2 * sg * L4 * ca) * red;
        tqM[m] += tq;
        tqTot += tq;
      }
      // receptor do compound: AP → receptor → BP; na simplificação, vapor vivo da caixa pelo orifício de partida
      if (P.compound) {
        let mSimp = 0;
        if (this.simplif) mSimp = vazaoV(0.12 * this.aRegMax * aReg, this.pChest, this.pRec, this.sRTv);
        this.pRec += ((RTex * (mRecIn + mSimp)) / this.vRec) * dt - (RTex * mAdmRec * fs * dt) / this.vRec;
        if (this.pRec < 0.5 * P0l) this.pRec = 0.5 * P0l;
        // regulador fechado: a válvula de alívio do receptor (drifting) o deixa na atmosfera; sem ela as AP, com a caixa
        // na atmosfera pelas válvulas de alívio, bombeavam ar no receptor e as BP davam chuffs descendo a serra
        if (this.reg < 0.02 && this.pRec > P0l) this.pRec += (P0l - this.pRec) * kAlivio;
        mAdmChest += mSimp * dt;
      }
      // caixa de válvulas: volume entre o regulador e os cilindros (válvula de alívio: nunca abaixo da atmosfera)
      this.pChest += (RTv / this.vChest) * (mReg * dt - mAdmChest);
      if (this.pChest < P0l) this.pChest = P0l;
      if (this.pChest > pCalAbs) this.pChest = pCalAbs;
      mCylBloco += mAdmChest > 0 ? mAdmChest : 0;
      // ---- rede e jato
      const tom = rede.passo(sRTex);
      let jat = this.jato.amostra(rede.mJato * rede.gVar, rede.mach, rede.prBico);
      if (this.tap) this.tap(this);
      // tiragem: sopro contínuo de escoamento na chaminé ∝ U_ch² (a vazão média dos cilindros), 300–1500 Hz: enche o vale
      // (U_ch vem da quantidade de movimento do jato que arrasta o gás: ∝ média de ṁ_j·M_j; no corte curto, com o jato
      // subsônico, a tiragem sopra menos e o espectro escurece, 3.3)
      this.momS += this.kMom * (rede.mJato * rede.mach - this.momS);
      const mr = this.momS / P.evaporacaoMax;
      if (!cond) jat += this.jato.gMistura * K_TIRAGEM * mr * mr * this.tirR.amostra();
      let chamine = tom + jat * mixAr;
      if (cond) {
        // condensador e abafador: a rede só recebe o pulso abafado (passa-baixa de 300 Hz) e o que se ouve é o chiado do
        // vapor entrando no condensador, com a envoltória alisada pelo volume dele (2 polos em 5 Hz): um ronronar de 2–4 dB
        this.condEnv += this.kCondEnv * (mCond - this.condEnv);
        this.condEnv2 += this.kCondEnv * (this.condEnv - this.condEnv2);
        chamine = 0.03 * this.lpCond2.run(this.lpCond.run(chamine)) + K_CONDENSADOR * this.jato.gMistura * this.condEnv2 * this.tirR.amostra();
      }
      const sopr = this.soprador.amostra(this.sopradorLigado * (1 - this.reg));
      S[ch.chamine][k] = gChuff * chamine + gSopr * sopr;
      // ---- cilindros: torneiras e vazamentos
      const pRel = this.pCal / this.pNom;
      S[ch.cilE][k] = gTorn * this.torn[0].torneira(tornE) + gVaz * this.torn[0].vazamento(pRel);
      if (ch.cilD >= 0) S[ch.cilD][k] = gTorn * this.torn[1].torneira(tornD) + gVaz * this.torn[1].vazamento(pRel);
      // ---- bielas: impactos de folga nas inversões de força, rolar 1/volta
      const cF = this.cF, cDF = this.cDF, cLado = this.cLado, cA = this.cA;
      for (let c = 0; c < this.nC; c++) {
        const F = (eP[2 * c] - eP[2 * c + 1]) * cA[c];
        const dF = Math.abs(F - cF[c]);
        cDF[c] += 0.02 * (dF * fs * 0.005 - cDF[c]);
        const lim = 0.02 * pNomAbs * cA[c];
        if ((F > lim && cF[c] <= lim && cF[c] > -lim) || (F < -lim && cF[c] >= -lim && cF[c] < lim)) {
          const amp = P.folga * Math.sqrt(Math.min(4, cDF[c] / (this.pNom * BARl * cA[c] + 1)));
          this.biel[cLado[c]].bater(amp);
        }
        cF[c] = F;
      }
      const wAbs = Math.abs(wM[0]);
      const rolar = Math.min(2, wAbs / this.wRef) * (0.45 + 0.55 * this.reg);
      const th = thM[0] * red;
      S[ch.bielE][k] = gBiel * this.biel[0].amostra(rolar, cM[0]);
      if (ch.bielD >= 0) S[ch.bielD][k] = gBiel * this.biel[1].amostra(rolar, -sM[0]);
      // ---- apito, segurança, bomba, injetor, sino, queimador, engrenagens, correias
      S[ch.apito][k] = gApito * this.apito.amostra(this.apitoCmd * Math.min(1.1, this.pCal / this.pNom));
      S[ch.seguranca][k] = gSeg * this.hpSeg.run(this.seg.amostra());
      if (ch.bomba0 >= 0) S[ch.bomba0][k] = gBomba * this.bombas[0].amostra();
      if (ch.bomba1 >= 0) S[ch.bomba1][k] = gBomba * this.bombas[1].amostra();
      S[ch.injetor][k] = gInj * this.injetor.amostra();
      if (ch.sino >= 0 && this.sino) S[ch.sino][k] = gSino * this.sino.amostra();
      if (ch.queimador >= 0 && this.queimador) S[ch.queimador][k] = gQ * this.queimador.amostra(this.fogo);
      if (ch.engrenagens >= 0 && this.engren) S[ch.engrenagens][k] = gEng * this.engren.amostra(th, (wM[0] * red) / TAU, Math.min(1, Math.abs(tqTot) / (this.TE * this.rRoda)));
      if (ch.correias >= 0 && this.correias) S[ch.correias][k] = gCor * this.correias.amostra(((wAbs * red) / TAU) * (P.correias!.dVolante / P.correias!.dPolia));
      // ---- dinâmica: ω de cada motor e do trem (a patinagem é a troca de J)
      this.dinamica(dt);
      for (let m = 0; m < nM; m++) tqM[m] = 0;
      this.tqS += 0.0005 * (tqTot - this.tqS);
    }
    this.mCyl = (mCylBloco * fs) / n;
    this.eixo.omega = wM[0];
    this.eixo.torque = this.tqS;
    this.eixo.inercia = this.jMotorTotal;
  }

  /** integra ω (uma vez por amostra); tqM ainda tem o torque desta amostra */
  private dinamica(dt: number) {
    const nM = this.nM, wM = this.wM, tqM = this.tqM, r = this.rRoda;
    const kAtV = this.kAtV, kAtS = this.kAtS;
    if (this.omegaImposto != null) {
      this.wTrem = this.omegaImposto;
      for (let m = 0; m < nM; m++) { wM[m] = this.omegaImposto * (1 + this.epsM[m]); this.thM[m] += wM[m] * this.reducao * dt; this.patM[m] = 0; }
      return;
    }
    const carga = this.carga;
    const Jc = carga ? carga.inercia : 0;
    let Jt = Jc, Tt = -(carga ? carga.torque(this.wTrem) : 0);
    for (let m = 0; m < nM; m++) {
      const k = 1 + this.epsM[m];
      const T = tqM[m] - (kAtV * wM[m] + kAtS * Math.tanh(wM[m] / 0.2));
      const F = Math.abs(tqM[m]) / r;
      if (!this.patM[m]) {
        // aderido: a roda segue o trem; passa da adesão (com carga de verdade atrás) → patina
        if (carga && F > this.wAd[m] && this.wAd[m] > 0) this.patM[m] = 1;
        else { Jt += this.JM[m] * k * k; Tt += T * k; continue; }
      }
      // patinando: só o rodeiro e as bielas; o trem recebe o atrito de escorregamento
      const s = Math.sign(wM[m] - this.wTrem * k) || Math.sign(tqM[m]) || 1;
      const Fat = this.wAd[m] * 0.9 * s;
      wM[m] += ((T - Fat * r) / this.JM[m]) * dt;
      Tt += Fat * r * k;
      // readere quando a roda volta à velocidade do trem
      if ((wM[m] - this.wTrem * k) * s <= 0) { this.patM[m] = 0; wM[m] = this.wTrem * k; }
    }
    if (Jt <= 0) Jt = this.jMotorTotal;
    this.wTrem += (Tt / Jt) * dt;
    if (!carga && this.P.familia === 'locomotiva' && Math.abs(this.wTrem) < 0.05 && Math.abs(Tt) < 0.02 * this.TE * r) this.wTrem *= 0.9;
    for (let m = 0; m < nM; m++) {
      if (!this.patM[m]) wM[m] = this.wTrem * (1 + this.epsM[m]);
      this.thM[m] += wM[m] * this.reducao * dt;
      if (this.thM[m] > 1e4) this.thM[m] -= TAU * Math.floor(this.thM[m] / TAU);
      else if (this.thM[m] < -1e4) this.thM[m] += TAU * Math.ceil(-this.thM[m] / TAU);
    }
    // esforço de tração médio (N)
    let tq = 0; for (let m = 0; m < nM; m++) tq += this.patM[m] ? this.wAd[m] * 0.9 * r : tqM[m];
    this.esforcoS += 0.0005 * (tq / r - this.esforcoS);
  }

  // ================================================================ telemetria
  get patinando() { for (let m = 0; m < this.nM; m++) if (this.patM[m]) return true; return false; }
  chuffsPorS() { return (escapesPorVolta(this.P, this.simplif) * Math.abs(this.wM[0])) / TAU; }
  telemetria(): TelemetriaVapor {
    const w = this.wM[0];
    const pr = this.pRelN ? this.pRelSoma / this.pRelN : this.pRelUlt;
    this.pRelSoma = 0; this.pRelN = 0;
    let adesao = 0; for (let m = 0; m < this.nM; m++) adesao += this.wAd[m];
    return {
      rpm: (w * 60) / TAU, torque: this.tqS, potencia: this.tqS * w, estado: this.estado,
      pCaldeira: this.pCal, pChest: (this.pChest - P0) / BAR, pRelease: pr / BAR, corte: this.corte, chuffsPorS: this.chuffsPorS(),
      vapor: this.mTot, consumoCilindros: this.mCylS, evaporacao: this.evap, esforco: this.esforcoS, adesao, patinando: this.patinando,
      seguranca: this.seg.aberta, injetor: this.injetor.ligado, bombaAr: this.bombas.some((b) => b.ligada), torneiras: this.torneirasAbertas,
      soprador: this.sopradorLigado > 0, fApito: this.apito.frequencias(), aquecimentoApito: this.apito.aq,
      regulador: this.reg, reverser: this.rev, fogo: this.fogo, nivelAgua: this.injetor.nivel, engasgado: this.engasgado,
      v: this.wTrem * this.rRoda, rodaRpm: (w * 60) / TAU, voltasPorS: w / TAU, pCaixa: this.rede.pCaixa, theta: Array.from(this.thM, (t) => t * this.reducao),
      motores: this.nM, escapes: this.nEscapes, pRec: (this.pRec - P0) / BAR, mu: this.mu,
    };
  }
}

function clamp(x: number, a: number, b: number) { return x < a ? a : x > b ? b : x; }

/** r/(4·l): biela de 8,5 manivelas (x = (1 − cos α)/2 ± (r/4l)·sen²α) */
const LAMBDA4 = 1 / 34;
/** desigualdade do corte entre os lados (fração do curso; ver atualizarEventos) */
const DC_LADO = 0.025;
/**
 * diferença sistemática de nível entre os escapes dos dois lados (dB, ±) e entre as pontas: a válvula de um lado
 * adiantada solta o escape mais cedo e mais forte, e as passagens até o bloco de escape não são iguais. O bico engasgado
 * comprime a diferença que viria só da pressão de release (+1,8 dB de p_rel viram 0,7 dB de envoltória), então ela
 * entra também como ganho por extremidade; com ±1,3 dB a linha de 2/volta fica 6–14 dB abaixo da de 4/volta (medido: 1225
 * −4, "enchanting" −10, 6024 −3 dB)
 */
const DB_LADO = 1.3, DB_PONTA = 0.4;
/** ângulo α ∈ [0, π] em que o pistão percorreu a fração x do curso, extremidade da tampa (sg +1) ou da manivela (−1) */
function angPistao(x: number, sg: number) {
  x = clamp(x, 0, 1);
  let a = Math.acos(1 - 2 * x);
  for (let k = 0; k < 4; k++) {
    const s = Math.sin(a), c = Math.cos(a);
    const f = 0.5 * (1 - c) + sg * LAMBDA4 * s * s - x, df = s * (0.5 + 2 * sg * LAMBDA4 * c);
    if (Math.abs(df) < 1e-9) break;
    a = clamp(a - f / df, 0, Math.PI);
  }
  return a;
}
