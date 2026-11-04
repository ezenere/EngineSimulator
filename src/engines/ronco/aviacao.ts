// Família aviação no EngineDSP (RADIAL.md 6) e a base de aviação do radial (RADIAL.md 2.2, 3.4–3.6).
//
// O EngineDSP do Ronco tem ganchos `if (this.av)` nos pontos da tabela 1.6 do RADIAL.md (centelha, falhas, energia da
// queima, estouros, partida, carga no eixo, telemetria). Eles chamam funções que não existem no EngineDSP: este arquivo
// as põe na instância quando o preset traz `aviation: true` (ou quando o DSP é um RadialDSP, que já nasce com `av`),
// e as tira quando o preset volta a ser um carro. Nada aqui roda nos 68 carros: com `av` falso os ganchos não chamam.
//
// O que a aviação acrescenta ao motor a pistão:
//  - magnetos ('ambos' | 'esq' | 'dir' | 'desligado'): com um só, uma vela por cilindro e a queima 20% mais lenta;
//    desligados, nenhuma explosão (o motor gira no arranque sem pegar: contagem de pás);
//  - mistura manual (0 corte de lenta … 1 rica): energia da queima, velocidade da chama e falhas abaixo de 0,45;
//  - partida 'direta' (motor elétrico com redução), com o zumbido do redutor e o ruído das escovas;
//  - carga no eixo (gancho 11): a hélice (CargaHelice de carriers/helice.ts, com o governador de passo) ou o rotor
//    (CargaRotor de carriers/rotor.ts, com o governador no acelerador e a embreagem); quando um portador da Cena
//    acopla a carga dele (MotorRonco.acoplar), a de bancada sai;
//  - o som da hélice na página (FonteHelice, a mesma do portador) somado ao ouvinte, na escala absoluta: o escape em
//    plena carga a 55% da rotação máxima ↔ `nivelEscape` (L_W) e a hélice em Pa a 30 m levados à distância do ouvinte.
// O radial (src/engines/radial/dsp.ts) troca falhaAv, partidaAr, torquePartida e somPartidaAv pelas dele (encharque
// dos cilindros de baixo, arranque de inércia e a ar, tosses) e reaproveita o resto.
import { TAU, clamp, smooth, Biquad, RNG } from '../../acoustics';
import { CargaHelice, FonteHelice, HELICE_PADRAO, type ConfigHelice } from '../../carriers/helice';
import { CargaRotor, ROTOR_R44, type ConfigRotor } from '../../carriers/rotor';
import { GovernadorPI } from '../../carriers/base';
import { RHO } from '../../scene/constantes';

/** L_W (dB re 1 pW) → Pa RMS a 5 m (a conversão do RADIAL.md 3.7: L_p = L_W − 20·log₁₀ 5 − 11) */
export const paLw5 = (lw: number) => 2e-5 * Math.pow(10, (lw - 20 * Math.log10(5) - 11) / 20);

export type Magnetos = 'ambos' | 'esq' | 'dir' | 'desligado';

/** hélice do preset (RADIAL.md 5.1): pás, diâmetro (m), inércia (kg·m²), passo fixo, β0, rpm mínima e máxima da hélice */
export type HelicePreset = { B: number; D: number; J: number; passoFixo?: boolean; beta0?: number; nMin?: number; nMax?: number };

/**
 * Configuração da hélice do portador a partir do preset. O c_Q é escolhido pela potência da ficha, P = 2π·c_Q·ρ·n³·D⁵:
 *  - passo fixo: c_Q para absorver a potência a 92% da rotação máxima parado (a hélice de passo fixo segura o motor
 *    abaixo da máxima no chão e o avanço, 0,3·J_adv, a alivia em voo);
 *  - passo variável: c_Q0 (passo mínimo) absorve 25% da potência na rotação máxima; o passo máximo (×7) passa dela, e o
 *    governador acha o passo que segura a rotação-alvo.
 */
export function configHelice(spec: any): ConfigHelice {
  const h: HelicePreset = spec.helice;
  const i = 1 / (spec.reducao || 1);
  const rpmMax = spec.rpmMax || spec.redline;
  const nMax = h.nMax || rpmMax / i;
  const P = (spec.power || 100) * 1000;
  const cq = (n: number) => P / (TAU * RHO * Math.pow(n / 60, 3) * Math.pow(h.D, 5));
  const fixo = !!h.passoFixo;
  return {
    ...HELICE_PADRAO, B: h.B, D: h.D, i, nHelice: nMax, J_hel: h.J, passoFixo: fixo,
    cQ0: fixo ? cq(0.92 * nMax) : 0.25 * cq(nMax), nMin: h.nMin ?? (fixo ? nMax : 0.65 * nMax), beta0: h.beta0, onLenta: spec.onLenta ?? 0.35,
  } as ConfigHelice;
}

/** rotor do preset (RADIAL.md 6, 5.2 #17): o ROTOR_R44 com o que o preset muda */
export function configRotor(spec: any): ConfigRotor {
  return { ...ROTOR_R44, ...(spec.rotor || {}) };
}

/**
 * Carga de bancada da página (sem portador da Cena): a hélice com o governador de passo do portador Helice (o mesmo PI e
 * a mesma regra: abaixo de 60% do alvo, passo mínimo), ou o rotor com a embreagem e o governador no acelerador.
 */
export class CargaBancadaAv {
  tipo: 'helice' | 'rotor';
  helice: CargaHelice | null = null; hcfg: ConfigHelice | null = null; gov: GovernadorPI | null = null;
  rotor: CargaRotor | null = null; rcfg: ConfigRotor | null = null; govR: GovernadorPI | null = null;
  /** rpm-alvo da hélice (manete de passo, 0..1) e coletivo do rotor */
  rpmAlvo = 1; coletivo = 0;
  /** embreagem do rotor (0 solto, 1 engatado) e o pedido */
  engate = 0; engatar = false;
  inercia = 0;
  constructor(spec: any) {
    if (spec.rotor) {
      this.tipo = 'rotor';
      this.rcfg = configRotor(spec); this.rotor = new CargaRotor(this.rcfg);
      this.govR = new GovernadorPI(0.8 * 0.05, 0.4 * 0.05, 0, 1, Infinity, 0.3);
    } else {
      this.tipo = 'helice';
      this.hcfg = configHelice(spec); this.helice = new CargaHelice(this.hcfg);
      const c = this.hcfg;
      this.gov = new GovernadorPI(0.02, 0.01, c.betaMin, c.betaMax, (5 * Math.PI) / 180, c.betaMin);
      this.inercia = this.helice.inercia;
    }
  }
  get nAlvo() { const c = this.hcfg!; const nMin = c.nMin ?? c.nHelice; return nMin + (c.nHelice - nMin) * this.rpmAlvo; }
  /** rpm do motor em que o rotor fica no Nr nominal */
  get rpmNominal() { return this.rcfg ? this.rcfg.Nr * this.rcfg.icx : this.hcfg!.nHelice * this.hcfg!.i; }
  torque(omega: number) {
    if (this.helice) return this.helice.torque(omega);
    return this.engate > 0 ? this.engate * this.rotor!.torque(omega) : 0;
  }
  /** passo do controle (dt em s); devolve o acelerador que o governador do rotor manda (ou null) */
  passo(dt: number, omega: number, rodando: boolean, idle: number): number | null {
    const rpm = (omega * 60) / TAU;
    if (this.helice) {
      const c = this.hcfg!, nh = rpm / c.i, alvo = this.nAlvo;
      if (!c.passoFixo) {
        if (nh < 0.6 * alvo) { this.gov!.saida = c.betaMin; this.gov!.i = c.betaMin; }
        else this.gov!.passo((100 * (nh - alvo)) / alvo, dt);
        this.helice.beta = this.gov!.saida;
      }
      return null;
    }
    // rotor: a embreagem (correia) só engata com o motor funcionando, em ~8 s; com ela solta o motor fica na lenta
    const want = this.engatar && rodando ? 1 : 0;
    this.engate = clamp(this.engate + (want ? dt / 8 : -dt / 2), 0, 1);
    this.inercia = this.engate * this.rotor!.inercia;
    this.rotor!.c = this.engate >= 1 ? clamp(this.coletivo, 0, 1) : 0;
    if (this.engate <= 0) return null;
    // governador (R22/R44: liga acima de ~80% e segura 102–104%): o alvo sobe da lenta ao nominal junto com o engate
    const alvo = idle + (this.rpmNominal - idle) * smooth(0.2, 1, this.engate);
    return this.govR!.passo((100 * (alvo - rpm)) / alvo, dt);
  }
  telemetria(omega: number) {
    if (this.helice) {
      const c = this.hcfg!, nh = ((omega / c.i) * 60) / TAU;
      return { rpmHelice: nh, bpf: (c.B * nh) / 60, machPonta: Math.hypot((Math.PI * c.D * nh) / 60, 0) / 343, beta: this.helice.beta, torqueCarga: this.helice.torque(omega), nAlvo: this.nAlvo, passoFixo: c.passoFixo, B: c.B };
    }
    const c = this.rcfg!, Om = omega / c.icx;
    return { Nr: (Om * 60) / TAU, bpf: (c.B * Om) / TAU, bpfCauda: (c.Bc * c.ic * Om) / TAU, torqueCarga: this.torque(omega), engate: this.engate, coletivo: this.rotor!.c, nrPct: (100 * Om * 60) / TAU / c.Nr };
  }
}

/**
 * Põe (ou tira) a aviação na instância. `d` é o EngineDSP (ou o RadialDSP, que já vem com `av` e as funções dele).
 * Chamado pelo `setConfig` quando o preset tem `aviation` ou a instância já é de aviação.
 */
export function instalarAviacao(d: any, cfg: any) {
  if (!cfg.aviation && !d.radial) { d.av = false; d.carga = d.cargaExterna || null; return; }
  const novo = !d.av || d.avPreset !== cfg.id;
  d.av = true;
  d.falhaAv ??= falhaPlano; d.torquePartida ??= torqueDireta; d.partidaAr ??= () => 0; d.somPartidaAv ??= somDireta;
  d.avControle ??= controleAv; d.avMensagem ??= mensagemAv; d.avTelemetria ??= telemetriaAv;
  d.avSomExtra ??= somExtraAv;
  if (novo) {
    d.avPreset = cfg.id;
    d.magnetos = cfg.magnetosPadrao || 'ambos';
    d.mistura = cfg.misturaPadrao ?? 0.8;
    d.prime = 0;
  }
  d.qMix = 1; d.burnAv = 1; d.avHot = 0; d.prAv = 0.015; d.arPartida = false; d.falhaMix = 0;
  d.crankMax = cfg.crankMax || (d.radial ? 25 : 8);
  d.partidaTipo = cfg.partida || 'direta';
  d.nivelEscape = cfg.nivelEscape || 135;
  d.avRng = d.avRng || new RNG(0xa71a);
  d.avStLP = new Biquad().lp(d.fs, 2200, 0.8); d.avStBP = new Biquad().bp(d.fs, 1200, 1.2);
  // carga de bancada (a do portador, se acoplada, manda)
  d.cargaAv = cfg.helice || cfg.rotor ? new CargaBancadaAv(cfg) : null;
  d.carga = d.cargaExterna || d.cargaAv;
  // som da hélice na página (só sem portador externo: na Cena a hélice é do portador)
  const h = d.cargaAv?.hcfg;
  d.heliceSom = h && !d.cargaExterna ? new FonteHelice(d.fs, h.B, h.D, h.nHelice) : null;
  if (d.heliceSom) d.heliceSom.onLenta = h.onLenta ?? 0;
  d.helBuf = new Float32Array(128); d.helK = 128; d.kHel = 0;
}

// ------------------------------------------------------------------ funções postas na instância (this = EngineDSP)

/** chance de falha de uma explosão: magnetos desligados (todas), mistura pobre (abaixo de 0,45) */
function falhaPlano(this: any, _c: number) {
  if (this.magnetos === 'desligado') return 1;
  return this.falhaMix;
}

/** arranque elétrico direto (RADIAL.md 3.4): torque que cai a zero em 220 rpm. O torque de partida segue o atrito de
 *  arranque do próprio motor (3,2× o atrito frio parado: gira a 70–110 rpm, acima dos 60 rpm em que o EngineDSP já queima): a fórmula do RADIAL.md, (8·L + 60) N·m, não vence o atrito do
 *  modelo acima de ~30 L (o R-2800 não saía do lugar) */
function torqueDireta(this: any, rpm: number) {
  if (this.state !== 'crank') return 0;
  return arranqueBase(this) * Math.max(0, 1 - rpm / (this.radial ? 220 : 330));
}
export function arranqueBase(d: any) {
  const atrito = (0.95e5 * 1.5 * d.dispL * 1e-3) / (4 * Math.PI);
  return Math.max(8 * d.dispL + 60, 3.2 * atrito, d.radial ? 0 : 0.8 * ((140 * d.dispL) / Math.sqrt(d.N) + 40));
}

/** zumbido do redutor do arranque (rpm·11, como o do Ronco) ×2 e o ruído das escovas em 1,2 kHz */
function somDireta(this: any, rng: any) {
  if (this.state !== 'crank') return 0;
  const ph = this.phS;
  return this.avStLP.run((ph * 2 - 1) * 0.05 + rng.bi() * 0.02) + 0.02 * this.avStBP.run(rng.bi());
}

/** controle (a cada 16 amostras): mistura, magnetos, decaimentos da partida, governador da carga */
function controleAv(this: any, dtc: number) {
  const mx = clamp(this.mistura, 0, 1);
  // mistura (RADIAL.md 2.2 e 3.6): corte abaixo de 0,25; auto-rica (0,8) é o ponto de potência; rica (1) perde 8%;
  // pobre (0,55–0,65) perde 3–7% (o fator pobre não está na fórmula do 2.2, que dava 1 com 0,55: ver TECNICO → Radial)
  this.qMix = smooth(0, 0.25, mx) * (1 - 0.08 * clamp((mx - 0.7) / 0.3, 0, 1)) * (1 - 0.25 * clamp((0.7 - mx) / 0.6, 0, 1));
  this.burnAv = (this.magnetos === 'esq' || this.magnetos === 'dir' ? 1.2 : 1) * (1 + 0.3 * clamp((0.6 - mx) / 0.3, 0, 1));
  this.falhaMix = mx < 0.45 ? 0.3 * (0.45 - mx) / 0.15 : 0;
  const rt = this.runT || 0;
  if (this.radial) { this.avHot = 0.8 * Math.exp(-rt / 20); this.prAv = 0.015 + 0.35 * Math.exp(-rt / 20); }
  // carga de bancada
  const ca = this.cargaAv;
  if (ca && this.carga === ca && !this.lockOmega) { // (nas sondas de calibração o acelerador é o da sonda)
    const thr = ca.passo(dtc, this.omega, this.state === 'run', this.idle);
    if (thr !== null && this.state === 'run') this.thrTarget = thr;
  }
}

/** mensagens `{ type: 'av', magnetos?, mistura?, rpmAlvo?, coletivo?, engatar?, prime? }` */
function mensagemAv(this: any, m: any) {
  if (m.magnetos !== undefined) this.magnetos = m.magnetos;
  if (m.mistura !== undefined) this.mistura = clamp(m.mistura, 0, 1);
  if (m.prime !== undefined) this.prime = clamp(Math.round(m.prime), 0, 3);
  const ca = this.cargaAv;
  if (ca) {
    if (m.rpmAlvo !== undefined) ca.rpmAlvo = clamp(m.rpmAlvo, 0, 1);
    if (m.coletivo !== undefined) ca.coletivo = clamp(m.coletivo, 0, 1);
    if (m.engatar !== undefined) ca.engatar = !!m.engatar;
  }
}

function telemetriaAv(this: any, t: any) {
  t.magnetos = this.magnetos; t.mistura = this.mistura; t.aviacao = true; t.partida = this.partidaTipo;
  t.egt = this.exhT + 60 * clamp((0.75 - this.mistura) / 0.2, 0, 1); // (mistura pobre: escape ~60 °C mais quente)
  const c = this.carga;
  if (c && c.telemetria) Object.assign(t, c.telemetria(this.omega));
  else if (c && c.cfg) {
    // carga de um portador da Cena (hélice ou rotor): a mesma leitura
    const k = c.cfg, w = this.omega;
    if (k.nHelice) { const nh = ((w / k.i) * 60) / TAU; t.rpmHelice = nh; t.bpf = (k.B * nh) / 60; t.machPonta = (Math.PI * k.D * nh) / 60 / 343; t.torqueCarga = c.torque(w); }
    else if (k.Nr) { const Om = w / k.icx; t.Nr = (Om * 60) / TAU; t.bpf = (k.B * Om) / TAU; t.torqueCarga = c.torque(w); }
  }
}

/**
 * Som da hélice na página (ouvinte de fora a 5 m do cubo; cabine e cofre bem menos), em unidades da saída antes do
 * ganho do motor: Pa a 5 m × (0,17/Pa do escape na referência), dividido por `cfgGain·mk` (a hélice não ganha o reforço
 * de lenta da página).
 */
function somExtraAv(this: any) {
  const f = this.heliceSom;
  if (!f || this.lockOmega) return 0; // (as sondas de calibração medem só o motor)
  if (this.helK >= 128) {
    const ca = this.cargaAv, c = ca.hcfg, nh = ((this.omega / c.i) * 60) / TAU;
    f.np = nh / c.nHelice; f.u = this.thr; f.rv = 0; f.vFly = 0;
    f.preencher(this.helBuf, 128); this.helK = 0;
    // Pa a 30 m → 5 m; e Pa → unidades do escape (0,17 = RMS da referência de calibração em plena carga)
    this.kHel = (30 / 5) * (0.17 / paLw5(this.nivelEscape)) / Math.max(1e-6, this.cfgGain * this.mk);
  }
  const x = this.helBuf[this.helK++] * this.kHel;
  return x * (this.wE + 0.3 * this.wI + 0.15 * this.wB + 0.1 * this.wP);
}

/** as funções de aviação, para o radial reaproveitar (src/engines/radial/dsp.ts) */
export const AV = { falhaPlano, torqueDireta, somDireta, controleAv, mensagemAv, telemetriaAv, somExtraAv };
