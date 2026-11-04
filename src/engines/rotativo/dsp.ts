// Motor rotativo (docs/ROTATIVO.md), como subclasse do EngineDSP do Ronco (o padrão do DieselDSP e do RadialDSP).
//
// O laço de amostra é o do Ronco: cada câmara do Wankel é um volume de controle de zona única com a 1ª lei, janelas com
// escoamento compressível, escape em guias de onda, eixo e ouvintes. O rotativo entra por três caminhos:
//  1. Geometria (geometria.ts): N = 3·rotores câmaras, fire = φ_rotor + 360·flanco, ciclo de 1 080°e (`cyc`), volume
//     V(α) = V_min + (V_cam/2)·(1 − cos(2α/3)) com V_cam = 3√3·e·R·b (gancho 11: `kVol` = 2/3; o X-Engine usa 1 e 720°).
//  2. Os ganchos `if (this.rot)` do EngineDSP (tabela 1.6), que chamam os métodos que este construtor põe na instância:
//     janelas trapezoidais (`rotEscape`, `rotAdmissao`), tiques do ápice (`rotJanelas`), a fração fHC do calor que vai ao
//     escape (`rotQueima`) e volta como pós-queima presa ao evento (`posQueima`), a densidade do pulso com a referência
//     do gás mais quente (`rotDens`), falhas e estouros da sobreposição (`falhaRot`, `prRot`), a temperatura da parede
//     do coletor (`rotTBurn`), a engrenagem fixa (`mechRot`) e a telemetria; o tubo primário é um por rotor e as 3
//     câmaras somam nele (`runRot`).
//  3. Métodos sobrescritos inteiros: buildExhaust (serie, megafone, 2em1, duplo, reator; pré-silencioso em escape.ts),
//     calibrate / measurePower (sondas com um RotativoDSP e o escape 'serie' de referência), tune (janelas, velas,
//     queima, áreas), control (super + avanço do rotativo, janelas secundárias, turbo sequencial, falhas).
//
// Regra do DSP: nada do navegador; a taxa entra no construtor; RNG com semente.
import { TAU, DEG, P0, RGAS, SOUND_SPEED, clamp, smooth, flow, onePole, RNG, Biquad, Line, Junction, TwoPort, Radiator, port } from '../../acoustics';
import { EngineDSP } from '../ronco/dsp';
import { T_MAN } from '../ronco/constantes';
import { ADMISSAO, ESCAPE, K_VELAS, T_EXREF_ROT, DENS_TETO_ROT, DENTES_ENGRENAGEM, type Janela } from './constantes';
import { DoisPortasRotativo } from './escape';
import { PRESETS_ROTATIVO, type EscapeRotativo } from './presets';

/** escape de referência da calibração (ROTATIVO.md 1.6): série com pré-silencioso, abafador esportivo, Ø 2,5" */
export const ESCAPE_REF: EscapeRotativo = { tipo: 'serie', Lp: 0.3, Dp: 50, presilencioso: true, cat: true, downpipe: { L: 1.0, D: 63.5 }, saidas: [{ L: 3.0, D: 63.5, phi: 30 }] };

/** área da janela (fração de Amax): trapézio com rampa de abertura `ra` e de fechamento `rf` (frações da duração), 1.3 */
export function areaJanela(a: number, j: Janela) {
  const u = (a - j.abre) / (j.fecha - j.abre);
  if (u <= 0 || u >= 1) return 0;
  return Math.min(1, u / j.ra, (1 - u) / j.rf);
}

/** nó da rede do escape que injeta a parte distribuída da pós-queima no ponto quente e na boca (1.4) */
class PosQueimaBoca {
  d: RotativoDSP;
  // A envoltória é a do próprio evento (subida de 2 ms, queda de 12 ms, ROTATIVO.md 1.4): cada pulso tem o seu "chiado
  // quente" e o vão até o próximo fica quieto. (Antes ela passava ainda por um polo de 15 ms, "o gás chega espalhado":
  // na lenta do FD, a 25 eventos/s, isso emendava um evento no outro e a pós-queima na boca virava um chiado quase
  // contínuo, o "som de ar" que o ouvido apontou, como o ruído de jato contínuo do Fusca. Sem o polo, o p10 da envoltória
  // de 1–6 kHz cai de −6 para −15 dB da média e a modulação na ignição sobe de 0,4 para 1,0)
  constructor(d: RotativoDSP) { this.d = d; }
  step() {
    const d = this.d, n = d.ruidoHC(1), bs = d.bocas, e = d.hcBoca;
    d.hcBoca = 0;
    if (e < 1e-12) return;
    const k = (d.kHC * d.kQuente * e * n) / bs.length;
    for (let i = 0; i < bs.length; i++) bs[i].j.inj += bs[i].Z * k;
    const bb = d.bocasF, kb = (d.kHC * d.kBoca * e * n) / bb.length;
    for (let i = 0; i < bb.length; i++) bb[i].j.inj += bb[i].Z * kb;
  }
}

export class RotativoDSP extends EngineDSP {
  declare jAd: Janela; declare jEx: Janela; declare AinPrim: number; declare AinSec: number; declare AinAux: number; declare AinMaxRpm: number; declare apv: number[];
  declare hcQ: Float64Array; declare hcN: RNG; declare hcS: Float64Array; declare hcBoca: number; declare kBoca: number; declare hcKh: number; declare hcKl: number; declare bocas: { j: Junction; Z: number }[]; declare bocasF: { j: Junction; Z: number }[]; declare kQuente: number; declare kPrim: number; declare kHC: number; declare fHCatual: number; declare ov: number; declare rotores: number;
  declare kVelas: number; declare trailingOn: boolean; declare velas: number; declare tipoRot: string; declare fHCextra: number; declare fHCcat: number;
  declare seq: boolean; declare trocaRpm: number; declare transT: number; declare seqW: number; declare boostBase: number; declare rpmPrevSeq: number; declare phT2: number;
  declare pEO: Float64Array; declare TEO: Float64Array; declare MjEO: Float64Array; declare nEstouros: number; declare estourosS: number; declare tEst: number; declare fumaca: number;
  declare traco: Float32Array; declare vedF: Biquad; declare vedLP: number; declare iacLenta: number; declare estourosTotal: number; declare magnetos: any; declare mistura: any; declare kBurn0: number; declare gastas: boolean; declare reator: boolean; declare rotFase: Float64Array; declare densMax: number;

  constructor(fs: number) {
    super(fs);
    this.rot = true; this.cyc = 1080; this.kVol = 2 / 3; this.Vh = 0;
    // os ganchos do EngineDSP chamam estas (propriedades da instância, como no DieselDSP e no RadialDSP)
    this.rotQueima = this.queimaRot; this.rotJanelas = this.janelasRot; this.rotEscape = this.escapeRot; this.rotAdmissao = this.admissaoRot;
    this.rotDens = this.densRot; this.posQueima = this.posQueimaRot; this.mechRot = this.mecanicaRot; this.rotTBurn = this.tBurnRot; this.rotTelemetria = this.telemetriaRot;
    this.kBurn = 1.5 * 1.15; this.falhaRot = 0; this.prRot = 0.04; this.runRot = [];
    this.hcN = new RNG(0x4c0b); this.hcS = new Float64Array(4); this.hcBoca = 0; this.kBoca = 0.4; this.kQuente = 0.2; this.kPrim = 0.1; this.hcKh = 0; this.hcKl = 0; this.bocas = []; this.bocasF = []; this.kHC = 1; this.fHCatual = 0; this.ov = 0; this.rotores = 2;
    this.seq = false; this.trocaRpm = 4500; this.transT = -1; this.seqW = 0; this.boostBase = 0; this.rpmPrevSeq = 0; this.phT2 = 0;
    this.traco = new Float32Array(64); this.iacLenta = 0; this.estourosTotal = 0; this.nEstouros = 0; this.estourosS = 0; this.tEst = 0; this.fumaca = 0; this.densMax = 0;
    // (conta os estouros: o mecanismo é o do Ronco, que põe cada um em `pops`)
    const pops = this.pops;
    pops.push = (...xs: any[]) => { this.nEstouros += xs.length; this.estourosTotal += xs.length; return Array.prototype.push.apply(pops, xs); };
  }

  // ------------------------------------------------------------------ configuração
  setConfig(cfg, calibrate = true) {
    this.cyc = cfg.cyc || 1080; this.kVol = cfg.kVol || 2 / 3; this.tipoRot = cfg.tipo || 'wankel'; this.rotores = cfg.rotores || 1;
    const N = cfg.N;
    // dispersão por flanco (a do Ronco: ar ±7%, janela ±10%, energia ±5%, × 2,6 com carburador) escalada por `dispersao`:
    // as câmaras de um rotor dividem a mesma janela de admissão e o mesmo primário, então variam menos que cilindros
    this.spread = cfg.dispersao ?? 2.5;
    this.hcQ = new Float64Array(N); this.pEO = new Float64Array(N); this.TEO = new Float64Array(N); this.MjEO = new Float64Array(N);
    super.setConfig(cfg, calibrate);
    if (cfg.iacLenta) this.iacLenta = cfg.iacLenta;
    // dispersão por rotor (1.2): além da do Ronco por flanco, ±4% na energia e ±6% na janela de escape de cada rotor (a
    // ordem 1 do eixo sai 8–15 dB abaixo da ignição, como nas gravações)
    const sr = new RNG(0x707a + 131 * N), sp = (cfg.fuel === 'carb' ? 2.6 : 1) * (cfg.dispersaoRotor ?? 3);
    const fq = Array.from({ length: this.rotores }, () => 1 + 0.04 * sp * sr.bi()), fe = Array.from({ length: this.rotores }, () => 1 + 0.06 * sp * sr.bi());
    for (let c = 0; c < N; c++) { this.cylQ[c] *= fq[cfg.bank[c]]; this.cylEx[c] *= fe[cfg.bank[c]]; }
  }

  /** volume da câmara (m³) no ângulo `a` (°e) */
  volume(a: number) { return this.Vc + this.Vh * (1 - Math.cos(this.kVol * a * DEG)); }

  tune(cfg) {
    super.tune(cfg);
    const x = cfg.tipo === 'x';
    this.Vh = this.Vd / 2;
    // taxa de compressão: o teto do Ronco (15) cortaria o X diesel (CR 18): aqui o do Diesel (24)
    this.CR = clamp(cfg.compression || 9, 6, 24); this.Vc = this.Vd / (this.CR - 1);
    // primário com o diâmetro da ficha (a impedância do Ronco usa 0,16·diâmetro²; o do 13B tem Ø 50–60)
    const Dp = cfg.escape?.Dp;
    if (Dp) { this.Ar = (Math.PI / 4) * (Dp / 1000) ** 2; this.Zr = SOUND_SPEED / this.Ar; }
    // janelas (1.3): eventos, rampas e áreas
    const jA = ADMISSAO[cfg.janelas?.admissao] || ADMISSAO.lateral4, jE = ESCAPE[cfg.janelas?.escape] || ESCAPE.periferico;
    this.jAd = jA; this.jEx = jE;
    this.evo = jE.abre; this.evc = jE.fecha; this.ivo = jA.abre; this.ivc = jA.fecha;
    const b2 = this.bore * this.bore;
    this.AexMax = jE.area * b2;
    this.AinPrim = jA.area * b2; this.AinSec = (jA.sec || 0) * b2; this.AinAux = (jA.aux || 0) * b2;
    this.apv = cfg.janelas?.apv || [];
    if (this.AinMaxRpm === undefined) this.AinMaxRpm = this.AinPrim;
    this.ov = jE.fecha - jA.abre;
    // velas (1.4): a segunda e a terceira só encurtam a queima; as trailing desligadas → uma vela
    this.velas = cfg.velas || 2; this.trailingOn = cfg.trailingOn !== false;
    this.kVelas = K_VELAS[this.trailingOn ? clamp(this.velas, 1, 3) : 1];
    // Wiebe em °e: 1,5× (curso de 270°e) × velas; no X-Engine a câmara pequena e isolada queima quase a volume constante
    this.kBurn0 = x ? 0.9 * this.kVelas : 1.5 * this.kVelas;
    this.kBurn = this.kBurn0; // (o controle soma o fator do vácuo)
    // o Wankel respira como um 4 tempos do dobro da cilindrada nominal (cada rotor admite uma câmara por volta)
    if (!x) { this.Athr *= 1.8; this.Vman *= 1.5; }
    // (X-Engine: o fechamento tardio da admissão devolve parte da carga ao coletor; a borboleta passa mais ar que a câmara
    // guarda. Aviação: a hélice de passo fixo e o rotor pesam na lenta, e o circuito de lenta do carburador é maior)
    if (x) this.Athr *= 1.6;
    if (cfg.aviation) this.Athr *= cfg.helice?.passoFixo ? 3 : 1.5;
    if (cfg.torque) this.Tmax = Math.max(this.Tmax, cfg.torque);
    // atrito: o Ronco faz T = pme_atrito·V/(4π) com V = o volume varrido em 720°; no Wankel cada rotor queima uma câmara
    // por volta, então em 720° varre 2·rotores·V_cam = 2× a cilindrada nominal da Mazda (vedações de ápice e laterais,
    // mancais do excêntrico): sem isso a lenta pedia pouco ar e a câmara chegava à abertura a 1,1–1,4 bar
    if (!x) this.dispL = (cfg.kAtrito ?? 2) * cfg.displacement;
    // vedações de ápice gastas: a folga equivalente ×3 (1.5)
    this.gastas = cfg.vedacoes === 'gastas';
    this.Aleak = 1.2e-4 * b2 * (this.gastas ? 3 : 1);
    // reator térmico (RX-3): queima os HC por dentro como um catalisador, com ar secundário a frio; os estouros caem à metade
    this.reator = !!cfg.escape?.reator;
    if (this.reator) { this.hasCat = true; this.catNoise = 0.8; }
    this.fHCextra = cfg.fHCextra || 0;
    // variação explosão a explosão (a dispersão do Ronco, `varScale`): a câmara alongada, a chama que não volta para o lado
    // da vela trailing e o apagamento nas vedações fazem cada queima sair mais diferente que num cilindro (CVciclo 0,20–0,25
    // na lenta da gravação do RX-7, contra 0,07 com a dispersão do pistão)
    this.varScale = cfg.variacao ?? 3.5;
    this.fHCcat = this.hasCat ? 0.6 : 1;
    // turbo sequencial (2.3)
    this.seq = !!cfg.turbo?.sequencial && this.turbo; this.trocaRpm = cfg.turbo?.trocaRpm || 4500;
    // pós-queima distribuída (1.4): partes que queimam no primário, no ponto quente (depois do catalisador) e na boca. A
    // da boca era 0,7 (o resto do 1 no primário): na lenta ela dava ~100% do agudo acima de 1 kHz e soava como "ar" alto;
    // atenuada para 0,4 (−4,9 dB) sem passar a diferença ao primário: o HC que não queima na boca sai cru (ou queima sem
    // ruído no catalisador)
    this.kHC = cfg.kHC ?? 0.85; this.kBoca = cfg.kBoca ?? 0.4; this.kQuente = cfg.kQuente ?? 0.2; this.kPrim = cfg.kPrim ?? 0.1;
    // jato na abertura da janela (o `turb` do Ronco, M³·vazão): a aresta do alojamento descoberta pelo ápice solta um jato
    // sônico desde o primeiro grau, em vez da lâmina anular da válvula de prato (0,05 no Ronco)
    this.valveNoise = cfg.kJato ?? 0.05;
  }

  // ------------------------------------------------------------------ ganchos do laço
  /** gancho 7: a fração fHC do calor não sai na câmara; fica guardada para a pós-queima no escape */
  queimaRot(c: number, idleness: number, slowB: number) {
    // (o documento escreve 0,08·idleness·slowB/2,4 + 0,015: lenta ≈ 8%, plena carga ≈ 1,5%. Aqui o termo de lenta segue o
    // vácuo do coletor, não a distância à rotação de lenta: o HC do Wankel vem do apagamento da chama nas vedações e nos
    // cantos da câmara, que é o que piora com a carga leve, em qualquer rotação. A lenta e a plena carga ficam iguais; a
    // carga leve em giro alto (o RX-8 a 5 000 rpm em ponto morto) ganha a pós-queima que a gravação mostra no agudo)
    const leve = clamp((0.85 - this.pMan / P0) / 0.55, 0, 1);
    let f = (0.08 * leve * slowB) / 2.4 + 0.015;
    void idleness;
    if (this.ov > 90) f *= 2;
    f = f * this.fHCcat + this.fHCextra + ((this.runT || 0) < 20 ? 0.01 : 0);
    f = clamp(f, 0, 0.3);
    this.fHCatual = f;
    this.hcQ[c] = this.Q[c] * f; this.Q[c] -= this.hcQ[c];
  }

  /** gancho 9: tiques das vedações de ápice nas bordas das janelas (peso 0,3) e nos furos das velas (0,15); o ar zera no IO */
  janelasRot(c: number, a: number, ap: number) {
    const jE = this.jEx, jA = this.jAd, rng = this.rng;
    if (c === 0) this.traco[Math.min(63, (a / this.cyc * 64) | 0)] = this.p[0]; // (traço p–α da câmara 0 para o mostrador)
    if (ap < jE.abre && a >= jE.abre) {
      this.clickEnv += 0.3 * (0.5 + 0.5 * rng.next());
      // (sonda: pressão e temperatura na abertura do escape)
      const p = this.p[c], V = this.Vprev[c];
      this.pEO[c] = p; this.TEO[c] = (p * V) / (Math.max(this.m[c], 1e-9) * RGAS); this.MjEO[c] = 0;
    }
    if (ap < jE.fecha && a >= jE.fecha) this.clickEnv += 0.3 * (0.5 + 0.5 * rng.next());
    if (ap < jA.abre && a >= jA.abre) { this.clickEnv += 0.3 * (0.5 + 0.5 * rng.next()); this.air[c] = 0; }
    if (ap < jA.fecha && a >= jA.fecha) this.clickEnv += 0.3 * (0.5 + 0.5 * rng.next());
    if (this.tipoRot !== 'x' && ((ap < this.cyc - 30 && a >= this.cyc - 30) || (ap < 30 && a >= 30))) this.clickEnv += 0.15 * (0.5 + 0.5 * rng.next());
  }

  /** gancho 12: janela de escape trapezoidal (o primário é o do rotor) */
  escapeRot(c: number, a: number, p: number, T: number, run: Line, Zr: number) {
    const j = this.jEx;
    if (a <= j.abre || a >= j.fecha) return 0;
    const A = this.AexMax * this.cylEx[c] * areaJanela(a, j);
    const m = this.exhaustFlow(A, p, T, P0 + 2 * run.in0, Zr);
    // (sonda: Mach do jato no primeiro terço da rampa de abertura)
    if (a < j.abre + (j.fecha - j.abre) * j.ra / 3 && m > 0) {
      const pr = p / (P0 + 2 * run.in0);
      const Mj = pr > 1 ? Math.min(1, Math.sqrt(5 * (Math.pow(pr, 0.4 / 1.4) - 1))) : 0;
      if (Mj > this.MjEO[c]) this.MjEO[c] = Mj;
    }
    return m;
  }

  /** gancho 14: janela de admissão (primária + secundária/auxiliar pela rotação, `AinMaxRpm`) */
  admissaoRot(c: number, a: number, pMan: number, p: number, T: number) {
    const j = this.jAd;
    if (a <= j.abre || a >= j.fecha) return 0;
    return flow(this.AinMaxRpm * this.cylIn[c] * areaJanela(a, j), pMan, T_MAN, p, T);
  }

  /** densidade do pulso na abertura (gancho do densC): a referência do Ronco, 1 650 K, com teto 1,8 (o do Ronco, 1,3,
   *  achataria o gás do Wankel em plena carga, que passa de 2 100 K na abertura; ver TECNICO → Rotativos) */
  densRot(T: number) {
    const d = clamp(T / T_EXREF_ROT, 0.1, DENS_TETO_ROT);
    if (d > this.densMax) this.densMax = d;
    return d;
  }

  /**
   * gancho 13: pós-queima presa ao evento. O calor guardado (hcQ) queima depois da abertura do escape com envoltória de
   * subida 2 ms e queda 12 ms (integral 1). Fonte de volume: ṁ_eq = (γ−1)/γ·Q̇/(R·T) → p = Z·ṁ_eq, quase toda turbulenta
   * (ruído de combustão, 250 Hz–4 kHz, modulado pela envoltória: o "chiado quente" de cada pulso, não um estalo).
   * É distribuída (1.4): uma parte queima no primário (fonte no tubo do rotor) e o resto adiante, onde o gás cru ainda
   * quente se mistura (`PosQueimaBoca`, um nó da rede que injeta no ponto quente: depois do downpipe e do catalisador,
   * antes do pré-silencioso e do abafador).
   */
  posQueimaRot(c: number, a: number, Zr: number) {
    const h = this.hcQ[c], j = this.jEx;
    if (h <= 0 || a <= j.abre || a >= j.fecha) return 0;
    const t = ((a - j.abre) * DEG) / Math.max(this.omega, 10);
    if (t > 0.06) return 0;
    const env = (Math.exp(-t / 0.012) - Math.exp(-t / 0.002)) / 0.01;
    const mEq = (0.2857 * h * env) / (RGAS * 1100);
    this.hcBoca += mEq;
    return Zr * mEq * this.kHC * this.kPrim * this.ruidoHC(0);
  }

  /** ruído de combustão turbulenta: branco → passa-alta de 1ª ordem em 250 Hz → passa-baixa de 1ª ordem em 4 kHz (2 estados por canal) */
  ruidoHC(k: number) {
    const w = this.hcN.bi(), s = this.hcS;
    s[2 * k] += this.hcKh * (w - s[2 * k]);
    s[2 * k + 1] += this.hcKl * (w - s[2 * k] - s[2 * k + 1]);
    return 2.2 * s[2 * k + 1];
  }

  /** gancho 16: engrenagem fixa / coroa do rotor (34·rpm/60, harmônicos k^−2) e o 2º turbo do sequencial */
  mecanicaRot(omega: number, rf: number) {
    const ph = this.phW;
    let m = (Math.sin(DENTES_ENGRENAGEM * ph) + 0.25 * Math.sin(2 * DENTES_ENGRENAGEM * ph) + 0.11 * Math.sin(3 * DENTES_ENGRENAGEM * ph)) * 0.0012 * rf * rf;
    // vedações de ápice e laterais raspando na carcaça: chiado granulado contínuo (2–6 kHz), que funde os tiques das bordas
    // das janelas (o Wankel em lenta não tem os cliques contáveis do trem de válvulas)
    this.vedLP += 0.5 * (this.hcN.bi() - this.vedLP);
    m += this.vedF.run(this.vedLP) * 0.006 * (0.25 + rf) * (this.gastas ? 1.8 : 1);
    if (this.seq && this.seqW > 0.05) {
      // (o secundário gira a ~0,8 da rotação do primário: segunda linha de apito; ×2 porque a mecânica pesa metade do turbo de fora)
      const f = 0.8 * (500 + 6200 * this.turboW);
      this.phT2 += TAU * f * this.dt; if (this.phT2 > TAU) this.phT2 -= TAU;
      const lvl = this.turboW * this.turboW * this.seqW * (0.2 + 0.8 * clamp(this.pMan / (P0 * (1 + this.boost)), 0, 1));
      m += Math.sin(this.phT2) * 0.04 * lvl;
    }
    void omega;
    return m;
  }

  /** gancho 17: parede do coletor; o gás do Wankel sai a 900–1 000 °C em carga (lenta 400–500) */
  tBurnRot(rpm: number) {
    return Math.min(1050, 250 + 800 * Math.sqrt(clamp(rpm / this.redline, 0, 1.1)) * Math.pow(clamp(this.pMan / P0, 0, 1.6), 0.6));
  }

  // ------------------------------------------------------------------ controle
  control(dtc: number) {
    if (this.seq) this.boost = this.boostBase; // (o soluço da troca é aplicado por cima; o turbo do Ronco segue do valor sem ele)
    super.control(dtc);
    const rpm = this.rpmAvg, rf = clamp(rpm / this.redline, 0, 1.1);
    // avanço do rotativo (1.4): −5 + 30·rf °e (lenta: a leading ~5°e depois do PMS, para aquecer escape e reator); o
    // Ronco dá 10 + 24·rf, e o que falta entra como atraso (o mesmo caminho do atraso de aquecimento do catalisador)
    if (this.tipoRot !== 'x') this.catRetard += 15 - 6 * rf;
    // janelas secundária e auxiliar (13B-REW, Renesis): borboletas no coletor, abrindo pela rotação (degrau de 300 rpm)
    const a0 = this.apv[0], a1 = this.apv[1];
    this.AinMaxRpm = this.AinPrim + (a0 ? this.AinSec * smooth(a0 - 150, a0 + 150, rpm) : this.AinSec) + (a1 ? this.AinAux * smooth(a1 - 150, a1 + 150, rpm) : 0);
    // falhas (1.4, decisão 9): a sobreposição devolve gás queimado à admissão e manda mistura ao escape; cresce com o
    // vácuo e quando o giro cai (mais tempo de sobreposição por ciclo): é isso que faz a lenta periférica caçar
    const vac = clamp((0.6 - this.pMan / P0) / 0.4, 0, 1);
    // queima em °e: no vácuo da lenta o rotativo carrega mais gás queimado de um ciclo para o outro (o rebaixo do flanco
    // e a câmara que passa direto do escape à admissão): a chama anda mais devagar que no pistão com o mesmo vácuo
    this.kBurn = this.kBurn0 * (1 + 1.65 * vac);
    const lento = clamp(1 - (rpm - this.idle) / 1500, 0, 1);
    const ovk = clamp((this.ov - 40) / 90, 0, 1.2);
    const queda = clamp(this.idle / Math.max(rpm, 300), 0.5, 2.5);
    const kq = this.cfg?.kQueda ?? 4;
    // (e com o escape esfriando: o gás que volta à câmara pela sobreposição reacende menos a mistura nova; a parede do
    // coletor esquenta em ~4 s e esfria em ~20 s, então as falhas e a rotação se perseguem devagar: é a caça da lenta)
    const frio = 1 - smooth(this.cfg?.tCacaA ?? 530, this.cfg?.tCacaB ?? 600, this.exhT);
    let f = ovk * (this.cfg?.falhaBase ?? 0.05) * (1 + 1.5 * vac) * lento * Math.pow(queda, kq) * (1 + (this.cfg?.kCaca ?? 2) * frio * this.warm);
    if (!this.trailingOn && this.velas >= 2) f += 0.02;
    if (this.gastas) f += 0.03 * (1 - this.warm);
    this.falhaRot = this.state === 'run' ? clamp(f, 0, 0.6) : 0;
    // estouro de uma câmara que falhou: a mistura crua chega ao escape quente (1.4)
    this.prRot = Math.min(0.9, (this.ov > 90 ? 0.7 : 0.04 * (1 + Math.max(0, this.ov) / 60)) * (this.reator ? 0.5 : 1));
    // turbo sequencial (2.3)
    if (this.seq) {
      const run = this.state === 'run';
      // o primário é pequeno: enche cedo e gira sempre acima de 2 000 rpm
      if (run && rpm > 2000) this.turboW = Math.max(this.turboW, 0.45 + 0.4 * smooth(2000, 3200, rpm) * smooth(0.3, 0.9, this.thr));
      this.seqW += ((rpm > this.trocaRpm ? 1 : 0) * smooth(this.trocaRpm - 200, this.trocaRpm + 200, rpm) - this.seqW) * (1 - Math.exp(-dtc / 0.15));
      if (this.rpmPrevSeq < this.trocaRpm && rpm >= this.trocaRpm && this.thr > 0.5) this.transT = 0;
      this.rpmPrevSeq = rpm;
      this.boostBase = this.boost;
      if (this.transT >= 0) {
        const TT = 0.3;
        this.boost *= 1 - 0.25 * Math.sin((Math.PI * this.transT) / TT);
        this.transT += dtc; if (this.transT > TT) this.transT = -1;
      }
    }
    // estouros por segundo (janela de ~1 s) e a fumaça azul do óleo na partida (só visual)
    this.tEst += dtc;
    if (this.tEst >= 0.5) { this.estourosS += (this.nEstouros / this.tEst - this.estourosS) * 0.5; this.nEstouros = 0; this.tEst = 0; }
    this.fumaca = this.state === 'run' ? Math.max(0, 1 - (this.runT || 0) / 20) * (0.5 + 0.5 * (1 - this.warm)) : 0;
  }

  freshStart() {
    super.freshStart();
    this.transT = -1; this.seqW = 0; this.boostBase = 0; this.hcQ.fill(0);
  }

  // ------------------------------------------------------------------ escape (2.1)
  buildExhaust(cfg) {
    const fs = this.fs, N = this.N, Rn = Math.max(1, cfg.rotores || 1), e: EscapeRotativo = cfg.escape || ESCAPE_REF;
    const lines: Line[] = [], nodes: any[] = [], rads: Radiator[] = [], panPhi: number[] = [];
    const L = (len: number, Y: number, loss: number, damp = 1) => { const l = new Line(fs, Math.max(0.02, len), Y, loss, damp); l.kNL = 0.6; lines.push(l); return l; };
    const Dp = e.Dp || 50;
    const Yd = (mm: number) => (mm / Dp) ** 2;               // admitância relativa ao primário
    const dw = (mm: number) => clamp(63.5 / mm, 0.4, 2.5);   // amortecimento: tubo fino atrita mais
    const runs: Line[] = [];
    for (let r = 0; r < Rn; r++) { const l = L(e.Lp * (1 + (cfg.difPrimario ?? 0) * r), 1, 12000); l.runner = true; runs.push(l); }
    this.brkW = new Float64Array(N).fill(1);
    const bankJ: any[] = new Array(Rn).fill(null);
    let A2out = 1, Dout = 63.5;
    const radiar = (line: Line, s: { D: number; phi: number }, R = 0.93, fc?: number) => {
      const d = clamp(s.D / 63.5, 0.3, 2.4), A2 = d * d, c = Math.cos(s.phi * DEG);
      const rd = new Radiator(fs, line, 0.62 + 0.34 * c, 0.62 - 0.34 * c, fc ?? 1500 / d, A2, 400 / (TAU * 0.03175 * d));
      rd.R = R; nodes.push(rd); rads.push(rd); panPhi.push(s.phi); A2out = A2; Dout = s.D;
    };
    // ponto quente: junção de 2 portas onde a parte distribuída da pós-queima entra (depois do downpipe e do
    // catalisador, antes do pré-silencioso e do abafador: é onde o gás cru ainda quente se mistura e queima)
    const quentes: { j: Junction; Z: number }[] = [];
    const bocasF: { j: Junction; Z: number }[] = [];
    const boca = (line: Line, s: { D: number; phi: number }, R = 0.93, fc?: number) => {
      const tb = L(0.06, line.Y, 9000, dw(s.D)); tb.kNL = line.kNL;
      const j = new Junction([port(line, 1), port(tb, 0)]); nodes.push(j);
      bocasF.push({ j, Z: SOUND_SPEED / ((Math.PI / 4) * (s.D / 1000) ** 2) });
      radiar(tb, s, R, fc);
    };
    const quente = (line: Line, D: number) => {
      const nx = L(0.06, line.Y, 9000, dw(D)); nx.kNL = line.kNL;
      const j = new Junction([port(line, 1), port(nx, 0)]); nodes.push(j);
      quentes.push({ j, Z: SOUND_SPEED / ((Math.PI / 4) * (D / 1000) ** 2) });
      return nx;
    };
    // cauda: [abafador] → tubo → boca (uma ou duas saídas)
    const cauda = (de: Line, Dde: number) => {
      const ss = e.saidas.length ? e.saidas : [{ L: 2, D: 63.5, phi: 30 }];
      let feeds: Line[] = [de];
      if (ss.length > 1) {
        feeds = ss.map((s) => L(0.45 * s.L, Yd(s.D), 9000, dw(s.D)));
        nodes.push(new Junction([port(de, 1), ...feeds.map((f) => port(f, 0))]));
      }
      ss.forEach((s, k) => {
        const tail = L(0.3 * s.L, Yd(s.D), 9000, dw(s.D));
        tail.kNL = cfg.muffler === 'stock' ? 0.05 : cfg.muffler === 'classic' ? 0.15 : 0.6;
        nodes.push(new TwoPort(fs, port(feeds[k], 1), port(tail, 0), cfg.muffler || 'stock'));
        boca(tail, s);
      });
      void Dde;
    };
    if (e.tipo === 'megafone') {
      // 787B: primários individuais iguais → coletor único → megafone em 3 degraus (admitância ×1,6 cada) → boca larga
      const col = L(0.08, 1.6 * Rn * 0.4, 10000);
      const j = new Junction([...runs.map((r) => port(r, 1)), port(col, 0)]); nodes.push(j);
      bankJ.fill(j);
      const m = e.megafone || { L: 0.5, Dboca: 120 };
      let prev = quente(col, 90), Y = col.Y;
      for (let k = 0; k < 3; k++) {
        Y *= 1.6;
        const seg = L(m.L / 3, Y, 10000, 0.6); seg.kNL = 0.4;
        nodes.push(new Junction([port(prev, 1), port(seg, 0)]));
        prev = seg;
      }
      // boca larga: reflexão −0,6 abaixo de ~300 Hz (a do Ronco é −0,93): perde grave e irradia o médio com eficiência
      boca(prev, { D: m.Dboca, phi: e.saidas[0]?.phi ?? 5 }, 0.6, 300);
    } else if (e.tipo === 'duplo') {
      // Ro80, Cosmo 110S: um downpipe por rotor → Y → silencioso dianteiro ('classic') → tubo → traseiro (abafador do preset)
      const dp = e.downpipe || { L: 1.5, D: 50 };
      const dps = runs.map((r, k) => {
        const d = L(dp.L * (1 + 0.03 * k), Yd(dp.D), 9000, dw(dp.D));
        const j = new Junction([port(r, 1), port(d, 0)]); nodes.push(j); bankJ[k] = j;
        return d;
      });
      const y = L(0.3, Yd(dp.D) * 1.4, 9000, dw(dp.D));
      nodes.push(new Junction([...dps.map((d) => port(d, 1)), port(y, 0)]));
      const meio = L(1.5, Yd(dp.D) * 1.4, 9000, dw(dp.D)); meio.kNL = 0.15;
      nodes.push(new TwoPort(fs, port(quente(y, dp.D), 1), port(meio, 0), 'classic'));
      cauda(meio, dp.D);
    } else if (e.tipo === '2em1') {
      // Norton, aviação: os primários (1 ou 2) → coletor → tubo → abafador → boca
      const s0 = e.saidas[0] || { L: 0.6, D: 45, phi: 90 };
      const col = L(0.3, Yd(s0.D) * 1.2, 10000, dw(s0.D));
      const j = new Junction([...runs.map((r) => port(r, 1)), port(col, 0)]); nodes.push(j); bankJ.fill(j);
      const tail = L(Math.max(0.1, s0.L), Yd(s0.D), 9000, dw(s0.D));
      tail.kNL = cfg.muffler === 'stock' ? 0.05 : cfg.muffler === 'classic' ? 0.15 : 0.6;
      nodes.push(new TwoPort(fs, port(quente(col, s0.D), 1), port(tail, 0), cfg.muffler || 'stock'));
      boca(tail, s0);
    } else {
      // série (RX-7, RX-8, Cosmo 20B, RX-3): coletor [reator] → [turbo] → downpipe → [cat] → [pré-silencioso] → tubo → abafador → saídas
      const dp = e.downpipe || { L: 1.0, D: 63.5 };
      const Ydp = Yd(dp.D), dwd = dw(dp.D);
      let prev = L(0.25, Ydp * 1.2, 10000, dwd);
      const j = new Junction([...runs.map((r) => port(r, 1)), port(prev, 0)]); nodes.push(j); bankJ.fill(j);
      const duas = (tipo: 'turbo' | 'presilencioso' | 'cat' | 'reator', len: number, kNL: number) => {
        const nx = L(len, Ydp, 9000, dwd); nx.kNL = kNL;
        nodes.push(tipo === 'turbo' ? new TwoPort(fs, port(prev, 1), port(nx, 0), 'turbo') : new DoisPortasRotativo(fs, port(prev, 1), port(nx, 0), tipo));
        prev = nx;
      };
      if (e.reator) duas('reator', 0.3, 0.2);
      if (this.turbo) duas('turbo', 0.25, 0.6);
      const d1 = L(dp.L, Ydp, 9000, dwd); nodes.push(new Junction([port(prev, 1), port(d1, 0)])); prev = d1;
      if (e.cat) duas('cat', 0.4, 0.05);
      prev = quente(prev, dp.D);
      if (e.presilencioso) duas('presilencioso', 1.2, 0.1);
      cauda(prev, dp.D);
    }
    this.bankJ = bankJ;
    this.runRot = runs;
    // a pós-queima distribuída entra antes das junções (é o primeiro nó da rede)
    this.bocas = quentes; this.bocasF = bocasF;
    nodes.unshift(new PosQueimaBoca(this));
    const runners = new Array(N);
    for (let c = 0; c < N; c++) runners[c] = runs[Math.min(cfg.bank[c], Rn - 1)];
    this.pipeA = A2out;
    this.lines = lines; this.nodes = nodes; this.runners = runners; this.rads = rads; this.rotFase = Float64Array.from(panPhi);
    this.radHP = rads.map(() => new Biquad().hp(fs, 45, 0.7));
    this.radSh = rads.map(() => new Biquad().peak(fs, 110, 0.6, 3));
    let ib = 64; while (ib < fs * 0.0015) ib <<= 1;
    this.itdB = rads.map(() => new Float32Array(ib)); this.itdM = ib - 1; this.itdW = 0;
    this.itdD = rads.map((r) => {
      const p = (r.panR - r.panL) / (r.panR + r.panL + 1e-9), d = Math.round(Math.abs(p) * 0.0006 * fs);
      return p > 0 ? [d, 0] : [0, d];
    });
    this.jetF = rads.map(() => [new Biquad().bp(fs, 450, 0.5), new Biquad().bp(fs, 1400, 0.6)]);
    this.jetEnv = rads.map(() => 0);
    // ponteira do ruído de jato (o `tipA` do Ronco): uma peça própria (`escape.ponteira`, como a `tipD` do Ronco depois da
    // revisão do Fusca), com a área relativa a 2,5" e os limites do Ronco (0,5–1,6). Antes ela seguia o Ø da saída com
    // limite 0,4: no Ø mínimo (25 mm) o jato subia 39× (∝ 1/área²) enquanto o tubo fino tirava ~30 dB do tom, e o jato
    // virava 80–90% do nível abaixo de 1 kHz ("só som de ar"). O tubo fino já baixa a vazão na boca (o abafador é uma
    // fonte de pressão): a velocidade do gás que o jato lê não cresce de novo com 1/área
    const td = clamp((e.ponteira ?? Dout) / 63.5, 0.5, 1.6); this.tipA = td * td;
  }

  buildFilters(cfg) {
    super.buildFilters(cfg);
    this.vedF = new Biquad().bp(this.fs, 3500, 0.6); this.vedLP = 0;
    this.hcKh = onePole(this.fs, this.cfg?.hcFh ?? 400); this.hcKl = onePole(this.fs, this.cfg?.hcFl ?? 3000); this.hcS.fill(0);
  }

  // ------------------------------------------------------------------ sondas (1.6)
  private sonda(cfg, rpm: number, proprio: boolean | 'fabrica' = false) {
    const fab: any = proprio === 'fabrica' ? PRESETS_ROTATIVO.find((p) => p.id === cfg.id) : null;
    const ref = fab ? { ...cfg, escape: fab.escape, muffler: fab.muffler ?? 'stock', turbo: fab.turbo, gain: undefined, powerModel: undefined, valve: 'none', reso: false, twoStep: false }
      : proprio ? { ...cfg, gain: undefined, powerModel: undefined, valve: 'none', reso: false, twoStep: false }
      : { ...cfg, escape: { ...ESCAPE_REF, Lp: cfg.escape?.Lp ?? 0.3, Dp: cfg.escape?.Dp ?? 50 }, muffler: 'sport', pipeD: 2.5,
        turbo: cfg.turbo ? { ...cfg.turbo, sequencial: false } : undefined, gain: undefined, powerModel: undefined, breakout: 'sealed', valve: 'none', reso: false, twoStep: false };
    const t = new RotativoDSP(this.fs);
    t.setConfig(ref, false);
    t.state = 'run'; t.lockOmega = true; t.tempMode = 'fixed'; t.tempSet = 90; t.coolant = 90; t.runT = 100;
    t.omega = (rpm * TAU) / 60; t.rpmAvg = rpm;
    if (t.av) { t.magnetos = 'ambos'; t.mistura = 0.8; }
    return t;
  }

  /**
   * Calibração da página (a do Ronco, 1.6): o ganho leva a plena carga a 55% de rpmMax, com o escape 'serie' de referência,
   * ao alvo; assim o escape do preset (megafone, 2 em 1, pré-silencioso retirado) continua mudando o volume de verdade.
   * O reforço da lenta é medido com o escape do PRÓPRIO preset (lenta e plena carga a 55% com ele): com as topologias tão
   * diferentes dos rotativos, a razão lenta/carga da série de referência não vale para o megafone do 787B nem para o
   * 2 em 1 de uma moto, e a lenta saía 4–10 dB fora dos 21 dB abaixo da carga.
   */
  calibrate(cfg) {
    const B = 256, L = new Float32Array(B), R = new Float32Array(B), fs = this.fs, target = 0.17;
    const plena = (proprio: boolean | 'fabrica') => {
      const t = this.sonda(cfg, this.redline * 0.55, proprio);
      t.thrTarget = 1; t.thr = 1; t.turboW = 0.6; t.boost = cfg.boost * 0.3; t.maxBoost = cfg.boost * 0.4; t.params.master = 0.02;
      let acc = 0, cnt = 0, pk = 0;
      for (let i = 0; i < 0.5 * fs; i += B) {
        t.process(L, R, B);
        if (i > 0.25 * fs) for (let k = 0; k < B; k++) { acc += L[k] * L[k] + R[k] * R[k]; cnt += 2; pk = Math.max(pk, Math.abs(L[k]), Math.abs(R[k])); }
      }
      return { rms: Math.sqrt(acc / Math.max(1, cnt)) / 0.01, pk: pk / 0.01 };
    };
    // (o escape de FÁBRICA do preset: os presets saem equilibrados entre si, e o que o usuário muda no escape, como tirar o
    // pré-silencioso, muda o volume de verdade em relação a ele; sem preset de fábrica, o escape 'serie' de referência)
    const fab = PRESETS_ROTATIVO.some((p) => p.id === cfg.id) ? 'fabrica' : false;
    const ref = plena(fab), prop = fab ? ref : plena(true);
    const gWot = Math.min(target / Math.max(ref.rms, 1e-6), 0.9 / Math.max(ref.pk, 1e-6));
    const ti = this.sonda(cfg, this.idle, fab || true);
    ti.runT = 60; ti.thrTarget = 0; ti.thr = 0; ti.params.master = 0.02; ti.dash = 0;
    let acc2 = 0, cnt2 = 0;
    for (let i = 0; i < 1.2 * fs; i += B) {
      ti.process(L, R, B);
      ti.dash = 0; ti.iacI = clamp(ti.iacI - 5e-4 * ti.tqMean * (B / fs), 0, 0.05);
      if (i > 0.8 * fs) for (let k = 0; k < B; k++) { acc2 += L[k] * L[k] + R[k] * R[k]; cnt2 += 2; }
    }
    const rmsIdle = Math.sqrt(acc2 / Math.max(1, cnt2)) / 0.01;
    this.iacLenta = ti.iac; // (o ar de lenta em equilíbrio)
    const gain = clamp(gWot, 0.05, 40);
    return { gain, idle: clamp((0.09 * prop.rms) / Math.max(rmsIdle, 1e-6), 1, 8) };
  }

  measurePower(cfg) {
    const B = 256, L = new Float32Array(B), R = new Float32Array(B), fs = this.fs;
    // (com o escape do próprio preset: o megafone do 787B e os 2 em 1 da aviação entregam bem diferente da série de referência)
    const t = this.sonda({ ...cfg, limiter: 'none', power: undefined }, this.redline * 0.7, true);
    t.thrTarget = 1; t.thr = 1; t.turboW = 1; t.boost = cfg.boost; t.maxBoost = cfg.boost; t.params.master = 0;
    let kw = 0, tq = 0, fr = 0;
    // (a ficha do Wankel é a potência perto da rotação máxima: 81–100% de rpmMax)
    for (const f of [0.7, 0.8, 0.9, 1.0]) {
      t.omega = (this.redline * f * TAU) / 60; t.rpmAvg = this.redline * f; t.tqMean = 0; t.frMean = 0;
      // (média do torque nos últimos 0,3 s: o tqMean do Ronco é uma média de ~50 ms, que num monorrotor carburado pega poucas
      // explosões e variava ±10% de uma sonda para a outra)
      let sq = 0, sf = 0, n = 0;
      for (let i = 0; i < 0.6 * fs; i += B) { t.process(L, R, B); if (i > 0.3 * fs) { sq += t.tqMean; sf += t.frMean; n++; } }
      const tm = sq / n, k = (tm * t.omega) / 1000;
      if (k > kw) { kw = k; tq = tm; fr = sf / n; }
    }
    return { kw: Math.max(kw, 1), tq: Math.max(tq, 1), fr: Math.max(fr, 0) };
  }

  // ------------------------------------------------------------------ telemetria (gancho 19)
  telemetriaRot(t: any) {
    const a0 = (((this.theta - this.fire[0]) % this.cyc) + this.cyc) % this.cyc;
    const rf = clamp(this.rpmAvg / this.redline, 0, 1.1);
    const slowB = 1 + 1.4 * clamp((0.6 - this.pMan / P0) / 0.4, 0, 1);
    t.rotativo = true; t.tipo = this.tipoRot; t.cyc = this.cyc; t.rotores = this.rotores;
    t.camara = { a: a0, V: this.Vprev[0], p: this.p[0] };
    t.janelas = { admissao: this.cfg.janelas?.admissao, escape: this.cfg.janelas?.escape, sobreposicao: this.ov, ainRel: this.AinMaxRpm / Math.max(this.AinPrim, 1e-12) };
    t.apv = this.apv.map((r) => (this.rpmAvg > r ? 1 : 0));
    t.velas = this.velas; t.trailing = this.trailingOn;
    t.tEscape = this.exhT; t.fHC = this.fHCatual; t.estouros = this.estourosS; t.boostSec = this.seq ? this.seqW : 0;
    t.pAbertura = this.pEO[0]; t.tAbertura = this.TEO[0]; t.machAbertura = this.MjEO[0]; t.densMax = this.densMax;
    t.queima1090 = 0.496 * (42 + 26 * rf) * slowB * this.kBurn;
    t.falha = this.falhaRot; t.fumaca = this.fumaca; t.vedacoes = this.gastas ? 'gastas' : 'novas';
    t.traco = Array.from(this.traco, (x) => Math.round(x / 100) / 10); // bar, 64 pontos do ciclo da câmara 0
    t.pPico = Math.max(...t.traco);
  }
}

void T_MAN;
