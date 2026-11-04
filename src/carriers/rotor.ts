// Portador rotor de helicóptero (CENA.md 4.3). Nr fixo pelo governador; o pedal é o coletivo c ∈ [0, 1].
//   T = T_pairado·(0,25 + 1,0·c), T_pairado = m·g (c ≈ 0,75 paira)
//   P = T^(3/2)/√(2ρA)/FM + ρAσc_d0(ΩR)³/8 + P_cauda + P_acess, A = πR², FM 0,72, P_cauda = 0,1·P_principal, P_acess 5 kW
//   carga no motor Q/i_cx, inércia J_rot/i_cx²; governador PI sobre o combustível (K_p 0,8 por %, K_i 0,4/s)
// Sem motor (`nenhum`): Nr é imposto e só as fontes do rotor soam.
//
// Fontes (refDist 7,5 m):
//   rotor.principal (pa): BPF = B·Nr/60; carga a_h = e^(−(h−1)κ_L), κ_L = 0,22 + 0,5(1 − c); espessura
//     ∝ M_t² (κ_T 0,35); tapa (BVI) ∝ c² com κ_BVI 0,08 até o 40º harmônico. Diretividade eixo z
//     [−8,−3,0,0,−2,−6,−10]. L_W 118 dB(A) em pairado (R44), +30·log₁₀(T/T_pairado).
//   rotor.cauda (pa): BPF B_c·Nr·i_c/60, κ 0,3, modulada na BPF principal; eixo y [0,−1,−3,−8,−3,−1,0]; L_W 110 + 10·log(P_cauda/P_cauda,pairado)
//   caixa (mecanica, dentro): tons de engrenamento z_k·n_k/60 com bandas laterais ±Nr/60; L_W 100 + 6 dB por duplicação do torque
//   aero (downwash): ruído lp 400 Hz modulado na BPF; L_W 100 ∝ c³
import type { Carga, Vec3 } from '../scene/tipos';
import type { TelemetriaPortador, Corpo } from './tipos';
import { PortadorComMotor, GovernadorPI, SerieHarmonica, calibrarSerieA, type GeradorCanal } from './base';
import { FonteRuido, Ramo, paDeLw } from './ruido';
import { Bq } from '../scene/filtros';
import { RHO, C_SOM } from '../scene/constantes';
import { REF_DIST_PORTADOR } from './trem';

export interface ConfigRotor {
  B: number; R: number; Nr: number; sigma: number; cd0: number; J_rot: number;
  Bc: number; Rc: number; ic: number; posCauda: Vec3;
  icx: number;                                  // rpm do motor / Nr
  engrenagens: { z: number; rpm: number }[];    // estágios da caixa (dentes, rpm do eixo)
  massa: number;                                // kg
  posRotor: Vec3; posCaixa: Vec3; posMotor: Vec3;
  corpo: { comprimento: number; largura: number; altura: number };
}

/** R44 (padrão) e a tabela de 4.3: B, D, Nr, BPF, ponta, cauda (B_c, rpm → BPF) */
export const ROTOR_R44: ConfigRotor = {
  B: 2, R: 5.03, Nr: 408, sigma: 0.033, cd0: 0.0102, J_rot: 700,
  Bc: 2, Rc: 0.74, ic: 2800 / 408, posCauda: [-5.8, 0, 1.8],
  icx: 6.66, engrenagens: [{ z: 57, rpm: 2718 }, { z: 9, rpm: 408 * 9.6 }], massa: 1090,
  posRotor: [0.2, 0, 3.3], posCaixa: [0, 0, 2.4], posMotor: [-0.5, 0, 1.2],
  corpo: { comprimento: 11.7, largura: 1.3, altura: 3.3 },
};

export const HELICOPTEROS: Record<string, { nome: string; B: number; D: number; Nr: number; Bc: number; rpmCauda: number }> = {
  r44: { nome: 'Robinson R44', B: 2, D: 10.06, Nr: 408, Bc: 2, rpmCauda: 2800 },
  r22: { nome: 'Robinson R22', B: 2, D: 7.67, Nr: 530, Bc: 2, rpmCauda: 3330 },
  as350: { nome: 'AS350 Esquilo', B: 3, D: 10.69, Nr: 390, Bc: 2, rpmCauda: 2086 },
  b206: { nome: 'Bell 206', B: 2, D: 10.16, Nr: 394, Bc: 2, rpmCauda: 2550 },
  uh60: { nome: 'UH-60 Black Hawk', B: 4, D: 16.36, Nr: 258, Bc: 4, rpmCauda: 1190 },
  mi8: { nome: 'Mi-8', B: 5, D: 21.29, Nr: 192, Bc: 3, rpmCauda: 1124 },
};

/** peso do tapa (BVI) contra a carga: com 2,5 os harmônicos 10–30 ficam a 15 dB com o coletivo cheio (5.10) */
export const K_BVI = 2.5;

export class CargaRotor implements Carga {
  cfg: ConfigRotor; c = 0.75; inercia: number;
  constructor(cfg: ConfigRotor) { this.cfg = cfg; this.inercia = cfg.J_rot / (cfg.icx * cfg.icx); }
  tracao() { return this.cfg.massa * 9.81 * (0.25 + 1.0 * this.c); }
  /** potências (W) na rotação Ω do rotor */
  potencias(Omega: number) {
    const k = this.cfg, A = Math.PI * k.R * k.R, T = this.tracao();
    const ind = Math.pow(T, 1.5) / Math.sqrt(2 * RHO * A) / 0.72;
    const perfil = (RHO * A * k.sigma * k.cd0 * Math.pow(Omega * k.R, 3)) / 8;
    const princ = ind + perfil, cauda = 0.1 * princ, acess = 5000;
    return { ind, perfil, cauda, acess, total: princ + cauda + acess };
  }
  torque(omega: number) {
    const Om = omega / this.cfg.icx;
    // a potência induzida não depende de Ω; a de perfil sim: Q = P/Ω no rotor, /i_cx no motor
    return this.potencias(Om).total / Math.max(Om, 1) / this.cfg.icx;
  }
}

/** série com modulação de amplitude numa frequência (cauda modulada pela BPF principal; downwash) */
class Modulada implements GeradorCanal {
  base: GeradorCanal; f = 0; m = 0; fase = 0; fs: number;
  constructor(fs: number, base: GeradorCanal) { this.fs = fs; this.base = base; }
  preencher(out: Float32Array, n: number) {
    this.base.preencher(out, n);
    if (this.m === 0) return;
    for (let k = 0; k < n; k++) { this.fase += this.f / this.fs; if (this.fase >= 1) this.fase -= 1; out[k] *= 1 + this.m * Math.sin(2 * Math.PI * this.fase); }
  }
}

class Downwash extends FonteRuido {
  montar() { this.ramos[0].bq[0].lp(this.fs, 400, 0.7071); }
  nivel = 1;
  protected modular() { return this.nivel; }
}
class RuidoCaixa extends FonteRuido {
  montar() { this.ramos[0].bq[0].hp(this.fs, 1000, 0.7071); this.ramos[0].bq[1].lp(this.fs, 4000, 0.7071); }
  nivel = 1;
  protected modular() { return this.nivel; }
}

export class Rotor extends PortadorComMotor {
  readonly tipo = 'rotor' as const;
  cfg: ConfigRotor;
  cargaR: CargaRotor;
  gov = new GovernadorPI(0.8, 0.4, 0, 1, Infinity, 0.6);
  principal: SerieHarmonica; cauda: SerieHarmonica; caudaM: Modulada; caixa: SerieHarmonica[] = []; down: Downwash; ruidoCx: RuidoCaixa;
  OmegaLivre: number;
  relP = new Float64Array(40); relC = new Float64Array(8);
  pCaudaRef: number; Pref: number;
  constructor(fs: number, cfg: Partial<ConfigRotor> = {}) {
    const c = { ...ROTOR_R44, ...cfg };
    const corpo: Corpo = { segmentos: [{ comprimento: c.corpo.comprimento, vao: 0, altura: c.corpo.altura, largura: c.corpo.largura, zPiso: 0.4 }], comprimento: c.corpo.comprimento, nariz: 1, cauda: 3, areaFrontal: 3, cd: 0.4, cpNariz: 0.05, massaSuperficial: 5, fCabine: 60 };
    super(fs, 'rotor', corpo, { posMotor: c.posMotor, rotMotor: 'frente' });
    this.cfg = c;
    this.cargaR = new CargaRotor(c);
    this.OmegaLivre = (c.Nr * 2 * Math.PI) / 60;
    const R = REF_DIST_PORTADOR;
    this.principal = new SerieHarmonica(fs, 40);
    this.propria({ id: 'rotor.principal', tipo: 'pa', pos: c.posRotor, dir: { tabela: [-8, -3, 0, 0, -2, -6, -10], eixo: [0, 0, 1], expConv: 3 }, refDist: R, dentro: false }, this.principal);
    this.cauda = new SerieHarmonica(fs, 8);
    this.caudaM = new Modulada(fs, this.cauda);
    this.propria({ id: 'rotor.cauda', tipo: 'pa', pos: c.posCauda, dir: { tabela: [0, -1, -3, -8, -3, -1, 0], eixo: [0, 1, 0], expConv: 3 }, refDist: R, dentro: false }, this.caudaM);
    for (let k = 0; k < c.engrenagens.length; k++) this.caixa.push(new SerieHarmonica(fs, 1));
    this.ruidoCx = new RuidoCaixa(fs, { lw: 94, n: 0, vRef: 1, refDist: R }, 0xca1);
    this.ruidoCx.ramos = [new Ramo(0xca1, [new Bq(), new Bq()])]; this.ruidoCx.ajustar(1);
    const somaCaixa: GeradorCanal = { preencher: (out, n) => { this.ruidoCx.preencher(out, n); for (const s of this.caixa) { s.preencher(this.tmp, n); for (let k = 0; k < n; k++) out[k] += this.tmp[k]; } } };
    this.propria({ id: 'caixa', tipo: 'mecanica', pos: c.posCaixa, dir: { tabela: [0, 0, 0, 0, 0, 0, 0], eixo: [1, 0, 0], expConv: 2 }, refDist: R, dentro: true }, somaCaixa);
    this.down = new Downwash(fs, { lw: 100, n: 0, vRef: 1, refDist: R }, 0xd0a);
    this.down.ramos = [new Ramo(0xd0a, [new Bq()])]; this.down.ajustar(1);
    const dm = new Modulada(fs, this.down); dm.m = 0.5;
    this.propria({ id: 'aero', tipo: 'aero', pos: [0, 0, 1], dir: { tabela: [0, 0, 0, 0, 0, 0, 0], eixo: [1, 0, 0], expConv: 3 }, refDist: R, dentro: false }, dm);
    this.downM = dm;
    const p0 = this.cargaR.potencias(this.OmegaLivre);
    this.pCaudaRef = p0.cauda; this.Pref = p0.total;
  }
  tmp = new Float32Array(4096);
  downM: Modulada;
  carga() { return this.cargaR; }
  /** (RADIAL.md 6) com um motor a pistão de verdade (pistão de aviação, radial) o governador é o do R22/R44: a borboleta
   *  responde na hora e, com os ganhos do motor de bancada (0,8 por %), o Nr nem se mexia ao puxar o coletivo; com 1/10
   *  deles o droop fica em 2–3% e volta em ~1 s, como no helicóptero real. Sem motor ou com outro motor, os de sempre */
  acoplar(motor: import('./tipos').Motor | null) {
    const k = motor && (motor.familia === 'pistao' || motor.familia === 'radial') && 'dsp' in (motor as object) ? 0.12 : 1; // (o MotorTeste de bancada, com o atraso de torque do correlacionador, fica com os de sempre)
    this.gov.kp = 0.8 * k; this.gov.ki = 0.4 * Math.min(1, 6 * k);
    super.acoplar(motor);
  }

  protected fisica(n: number, dt: number) {
    const c = this.cfg, tb = n * dt, m = this.motor;
    this.cargaR.c = Math.max(0, Math.min(1, this.cmd.pedal));
    const w = m ? m.eixo.omega : this.OmegaLivre * c.icx;
    if (m) {
      const erro = (100 * (this.OmegaLivre * c.icx - w)) / (this.OmegaLivre * c.icx);
      m.comandar({ acelerador: 0, ignicao: this.cmd.ignicao !== false, partida: false, combustivel: this.gov.passo(erro, tb) });
    }
    const Om = w / c.icx, nr = (Om * 60) / (2 * Math.PI);
    const R = REF_DIST_PORTADOR, cc = this.cargaR.c;
    const T = this.cargaR.tracao(), Tp = c.massa * 9.81;
    const pot = this.cargaR.potencias(Om);
    // rotor principal
    const bpf = (c.B * nr) / 60, Mt = (Om * c.R) / C_SOM;
    this.principal.f0 = bpf;
    const kL = 0.22 + 0.5 * (1 - cc), bvi = cc * cc;
    for (let h = 0; h < 40; h++) this.relP[h] = Math.exp(-h * kL) + 0.6 * Mt * Mt * Math.exp(-h * 0.35) + K_BVI * bvi * Math.exp(-h * 0.08);
    calibrarSerieA(this.principal, this.relP, paDeLw(118 + 30 * Math.log10(T / Tp), R));
    // cauda
    this.cauda.f0 = (c.Bc * nr * c.ic) / 60;
    for (let h = 0; h < 8; h++) this.relC[h] = Math.exp(-h * 0.3);
    calibrarSerieA(this.cauda, this.relC, paDeLw(110 + 10 * Math.log10(Math.max(pot.cauda, 1) / this.pCaudaRef), R));
    this.caudaM.f = bpf; this.caudaM.m = 0.3;
    // caixa: tom de engrenamento de cada estágio, L_W 100 + 6 dB por duplicação do torque
    const torqueRel = pot.total / this.Pref;
    for (let k = 0; k < c.engrenagens.length; k++) {
      const e = c.engrenagens[k], s = this.caixa[k];
      s.f0 = (e.z * e.rpm * (nr / c.Nr)) / 60;
      calibrarSerieA(s, [1], paDeLw(100 - 3 + 20 * Math.log10(Math.max(torqueRel, 0.05)), R));
    }
    this.ruidoCx.nivel = Math.max(torqueRel, 0.05);
    // downwash ∝ c³
    this.downM.f = bpf;
    this.down.nivel = Math.pow(Math.max(cc, 0.05) / 0.75, 1.5);
  }

  telemetria(): TelemetriaPortador {
    const c = this.cfg, w = this.motor ? this.motor.eixo.omega : this.OmegaLivre * c.icx, Om = w / c.icx;
    const p = this.cargaR.potencias(Om);
    return { v: this.cinematica.v, s: this.cinematica.s, rpmEixo: (w * 60) / (2 * Math.PI), torqueCarga: this.cargaR.torque(w), Nr: (Om * 60) / (2 * Math.PI), bpf: (c.B * Om) / (2 * Math.PI), bpfCauda: (c.Bc * c.ic * Om) / (2 * Math.PI), potencia: p.total, tracao: this.cargaR.tracao(), coletivo: this.cargaR.c };
  }
}
