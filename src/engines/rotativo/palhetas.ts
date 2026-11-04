// Motor pneumático de palhetas (ROTATIVO.md 5), APROXIMAÇÃO: não é o ciclo termodinâmico do Ronco, é um sintetizador
// próprio com a dinâmica de um motor a ar.
//
// O que existe de verdade: rotor com 4–8 palhetas deslizantes num estator excêntrico; o ar a 6–7 bar expande nas câmaras
// entre as palhetas. É o motor de retífica, parafusadeira, lixadeira (5 000–20 000 rpm livre, 0,2–3 kW) e o motor de
// arranque a ar de diesel pesado, marítimo e turbinas industriais (6–8 palhetas, 3 000–6 000 rpm, redução 6–12:1).
//
// Modelo (5.3), por bloco de controle de 32 amostras:
//   pressão na entrada segue o gatilho com τ de 0,2 s (mangueira e válvula);
//   torque T = T₀·((p − 1)/(p_n − 1))·(1 − n/n_livre(p)) − T_carga − atrito, T₀ = 4·P/ω_livre (potência máxima na metade
//   da rotação livre), n_livre(p) = n_livre·√((p − 1)/(p_n − 1)); dn/dt = T/J;
// por amostra:
//   passagem de palheta f_p = z·n/60: harmônicos k^−1,2 pela recorrência de Chebyshev (o trecho do `blower` do Ronco),
//   até 16 kHz, com a linha alargada ±0,5% (atrito das palhetas);
//   jato do ar expandindo: ruído → passa-faixas 2,5 kHz (Q 0,7) e 6 kHz (Q 1), nível ∝ vazão·(p/p₀)^1,5, vazão ∝ n·(1 − 0,4·carga);
//   descarga pelo silencioso da ferramenta: ruído passa-baixa de 3 kHz modulado em f_p (±30%);
//   atrito das palhetas: ruído 1–3 kHz ∝ n²;
//   arranque: o pinhão engata (estalo de 20 ms), as compressões do motor hospedeiro modulam a carga na frequência de
//   ignição dele, e ao soltar o pinhão sai o sopro da descarga.
// Saída mono no ouvinte do Ronco (de fora, cabine, cofre, junto à saída), com os mesmos `params`.
import { TAU, clamp, smooth, RNG, Biquad } from '../../acoustics';
import type { DSPDeAudio } from '../../worklet/tipos';

type Modo = 'ferramenta' | 'arranque';

export class PalhetasDSP implements DSPDeAudio {
  fs: number; dt: number; post: ((m: any) => void) | null = null;
  rng = new RNG(0x9a1e7a5);
  cfg: any = null;
  params: any = { listener: 'ext', master: 0.8, exhaust: 1, intake: 1, mech: 1, air: 1, ambSound: true };
  modo: Modo = 'ferramenta';
  // estado
  n = 0; p = 1; gatilho = 0; ligado = false; carga = 0; cargaAlvo = 0; pRede = 6.3;
  z = 8; nLivre = 20000; J = 1e-5; P = 700; T0 = 1;
  ph = 0; jit = 0; ctrl = 0; telem = 0; theta = 0;
  // arranque: hospedeiro
  hosp: any = null; nHosp = 0; phH = 0; engatado = false; engateT = -1; pegou = false; tGiro = 0; soltaT = -1;
  // filtros
  jA = new Biquad(); jB = new Biquad(); desc = new Biquad(); atr = new Biquad(); est = new Biquad(); cab = new Biquad(); cab2 = new Biquad();
  dcx = 0; dcy = 0; nivel = 0;

  constructor(fs: number) {
    this.fs = fs; this.dt = 1 / fs;
    this.jA.bp(fs, 2500, 0.7); this.jB.bp(fs, 6000, 1.0); this.desc.lp(fs, 3000, 0.7); this.atr.bp(fs, 1800, 0.6); this.est.bp(fs, 3500, 2);
    this.cab.lp(fs, 900, 0.7); this.cab2.lp(fs, 1400, 0.7);
  }

  message(m: any) {
    if (m.type === 'config') this.configurar(m.cfg);
    else if (m.type === 'params') Object.assign(this.params, m.params);
    else if (m.type === 'input') {
      if (m.throttle !== undefined) this.gatilho = clamp(m.throttle, 0, 1);
      if (m.ignition !== undefined) this.ligar(!!m.ignition);
    } else if (m.type === 'palhetas') {
      if (m.pIn !== undefined) this.pRede = clamp(m.pIn, 3, 10);
      if (m.carga !== undefined) this.cargaAlvo = clamp(m.carga, 0, 1);
      if (m.modo !== undefined && m.modo !== this.modo) { this.modo = m.modo; this.aplicarModo(); }
    }
  }

  configurar(cfg: any) {
    this.cfg = cfg;
    const pa = cfg.palhetas;
    this.modo = cfg.modoPalhetas || pa?.modo || 'ferramenta';
    this.aplicarModo();
  }

  private aplicarModo() {
    const pa = this.cfg?.palhetas;
    if (!pa) return;
    const k = pa[this.modo];
    this.z = k.z; this.nLivre = k.nLivre; this.J = k.J; this.P = k.potencia * 1000; this.pRede = k.pIn;
    this.T0 = (4 * this.P) / ((this.nLivre * TAU) / 60);
    this.hosp = this.modo === 'arranque' ? { ...k.hospedeiro, reducao: k.reducao } : null;
    this.n = 0; this.nHosp = 0; this.engatado = false; this.pegou = false; this.tGiro = 0; this.soltaT = -1;
  }

  /** ligar = abrir o ar (ferramenta: o gatilho manda; arranque: o botão engata o pinhão e solta o ar) */
  private ligar(on: boolean) {
    this.ligado = on;
    if (this.modo === 'arranque') {
      if (on) { this.engatado = true; this.engateT = 0; this.pegou = false; this.tGiro = 0; }
      else { if (this.engatado) this.soltaT = 0; this.engatado = false; }
    }
  }

  private controle(dtc: number) {
    const arranque = this.modo === 'arranque';
    // ar: gatilho da ferramenta (ligada) ou a válvula do arranque (aberta enquanto engatado)
    const abre = arranque ? (this.engatado ? 1 : 0) : this.ligado ? this.gatilho : 0;
    const pAlvo = 1 + (this.pRede - 1) * abre;
    this.p += (pAlvo - this.p) * (1 - Math.exp(-dtc / 0.2));
    this.carga += (this.cargaAlvo - this.carga) * (1 - Math.exp(-dtc / 0.08));
    const pn = (this.pRede - 1) || 1, pr = clamp((this.p - 1) / pn, 0, 1.5);
    const nl = 1.045 * this.nLivre * Math.sqrt(pr) + 1e-6; // (×1,045: com o atrito a rotação livre fica na da ficha)
    // (atrito das palhetas no estator: 2% do torque de parada, mais um viscoso que cresce com a rotação)
    let T = this.T0 * pr * Math.max(-0.5, 1 - this.n / nl) - this.T0 * (this.n > 1 ? 0.02 + 0.02 * this.n / this.nLivre : 0);
    let Jt = this.J;
    if (arranque && this.hosp) {
      const h = this.hosp, i = h.reducao;
      if (this.engatado && !this.pegou) {
        // compressões do hospedeiro: torque que oscila na frequência de ignição dele, refletido pelo pinhão
        const Th = h.Tcomp * (0.55 + 0.45 * Math.sin(this.phH)) * smooth(0, 40, this.nHosp);
        T -= Th / i + 0.3 * h.Tcomp / i;
        Jt += h.J / (i * i);
        this.nHosp = this.n / i;
        this.tGiro += dtc;
        // o hospedeiro "pega" depois de ~1,5 s acima de 45% da lenta: o pinhão desengata (estalo) e o ar fecha
        if (this.nHosp > 0.45 * h.idle && this.tGiro > 1.5) { this.pegou = true; this.engatado = false; this.soltaT = 0; this.engateT = 0; }
      } else {
        this.nHosp += ((this.pegou ? h.idle : 0) - this.nHosp) * (1 - Math.exp(-dtc / (this.pegou ? 0.8 : 3)));
      }
      this.phH += ((TAU * this.nHosp) / 60) * h.eventosPorVolta * dtc;
      if (this.phH > TAU * 1000) this.phH -= TAU * 1000;
    } else {
      T -= this.carga * 0.7 * this.T0 * Math.min(1, this.n / 200);
    }
    this.n = Math.max(0, this.n + ((T / Jt) * dtc * 60) / TAU);
    if (this.engateT >= 0) { this.engateT += dtc; if (this.engateT > 0.05) this.engateT = -1; }
    if (this.soltaT >= 0) { this.soltaT += dtc; if (this.soltaT > 0.6) this.soltaT = -1; }
  }

  process(outL: Float32Array, outR: Float32Array, nAm: number, sendL?: Float32Array, sendR?: Float32Array) {
    if (!this.cfg) { outL.fill(0); if (outR !== outL) outR.fill(0); if (sendL) { sendL.fill(0); sendR!.fill(0); } return; }
    const P = this.params, fs = this.fs, dt = this.dt, rng = this.rng;
    const ext = P.listener === 'ext' || P.listener === 'road' ? 1 : 0, cab = P.listener === 'int' ? 1 : 0, cof = P.listener === 'bay' ? 1 : 0, cano = P.listener === 'pipe' ? 1 : 0;
    for (let s = 0; s < nAm; s++) {
      if (this.ctrl-- <= 0) { this.controle(32 * dt); this.ctrl = 31; }
      const n = this.n, nr = n / Math.max(1, this.nLivre);
      // passagem de palheta, com a linha alargada pelo atrito
      this.jit += 0.002 * (rng.bi() - this.jit);
      const fp = (this.z * n) / 60 * (1 + 0.005 * this.jit * 20);
      this.ph += TAU * fp * dt; if (this.ph > TAU) this.ph -= TAU;
      this.theta = (this.theta + (n * 6) * dt) % 360;
      const c2 = 2 * Math.cos(this.ph), kMax = Math.min(24, Math.floor(16000 / Math.max(fp, 1)));
      let s1 = Math.sin(this.ph), s0 = 0, wv = 0;
      for (let k = 1; k <= kMax; k++) { wv += Math.pow(k, -1.2) * s1; const x = c2 * s1 - s0; s0 = s1; s1 = x; }
      const dp = Math.max(0, this.p - 1);
      const vazao = nr * (1 - 0.4 * this.carga) + 0.15 * dp / Math.max(1, this.pRede - 1);
      const tom = wv * 0.05 * Math.min(1, nr * 3) * Math.pow(dp / Math.max(1, this.pRede - 1) + 0.05, 0.8);
      const nz = rng.bi();
      const jato = (this.jA.run(nz) + 0.8 * this.jB.run(nz)) * 0.22 * vazao * Math.pow(this.p, 1.5) / Math.pow(this.pRede, 1.5) * P.air;
      const desc = this.desc.run(rng.bi()) * 0.35 * vazao * (1 + 0.3 * Math.sin(this.ph));
      const atr = this.atr.run(rng.bi()) * 0.06 * nr * nr * P.mech;
      let extra = 0;
      if (this.engateT >= 0) extra += this.est.run(rng.bi()) * 2.5 * Math.exp(-this.engateT / 0.008);
      if (this.soltaT >= 0) extra += this.desc.run(rng.bi()) * 0.4 * Math.exp(-this.soltaT / 0.2);
      // hospedeiro girando: as compressões aparecem como um "tuf-tuf" grave (a carga modula o motor de palhetas)
      let hosp = 0;
      if (this.hosp && this.nHosp > 5) hosp = 0.04 * Math.max(0, Math.sin(this.phH)) ** 3 * Math.min(1, this.nHosp / 100);
      let x = (tom + jato + desc) * P.exhaust + atr + extra + hosp * P.mech;
      // ouvinte: de fora (1 m), cabine (parede corta o agudo), cofre (perto do motor), junto à saída
      const xc = this.cab2.run(this.cab.run(x));
      x = ext * x + cab * 0.5 * xc + cof * 1.2 * x + cano * 1.6 * (jato + desc + tom);
      // bloqueio DC e saturação suave
      this.dcy = x - this.dcx + 0.9985 * this.dcy; this.dcx = x;
      const y = Math.tanh(this.dcy * P.master * 1.6);
      this.nivel += (y * y - this.nivel) * 0.0005;
      outL[s] = y; if (outR !== outL) outR[s] = y;
      if (sendL) { sendL[s] = y * 0.3; sendR![s] = y * 0.3; }
    }
    this.telem += nAm;
    if (this.post && this.telem >= 1024) { this.telem = 0; this.post(this.telemetria()); }
  }

  telemetria() {
    const fp = (this.z * this.n) / 60;
    return {
      type: 'telemetry', palhetas: true, rpm: this.n, theta: this.theta, state: this.n > 30 ? 'run' : 'off', kmh: 0, gear: 0, gears: 0, torque: 0, thr: this.gatilho,
      modo: this.modo, pIn: this.p, carga: this.carga, fPalheta: fp, z: this.z, rpmHospedeiro: this.nHosp, engatado: this.engatado, pegou: this.pegou,
      coolant: 20, exhT: 20, boost: 0, map: 1, limiter: false,
    };
  }
}
