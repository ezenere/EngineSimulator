// Portador locomotiva diesel-elétrica (CENA.md 4.5). O motor diesel de 2 tempos (EMD 710) ou 4 tempos
// (GE 7FDL) é da etapa 2; aqui ficam as tabelas por notch, a carga do gerador de tração, o governador e
// as fontes próprias (turbo, ventiladores, sopradores, compressor de ar, grades do freio, rodas, buzina).
//
//   rpm alvo = tabela[notch], rampa de 100 rpm/s; potência = fração[notch]·P_nominal, com 1,5 s de atraso
//   (o regulador de carga sobe a excitação depois do giro); Q = P/(η_ger·ω)
//   governador PI sobre o combustível: K_p 0,6 por %, K_i 0,3/s
//   freio dinâmico: motor em notch fixo (EMD: 8 na rotação, carga do gerador zero), grades e sopradores ligados
import type { Carga, Vec3, Diretividade } from '../scene/tipos';
import type { TelemetriaPortador, Corpo } from './tipos';
import { PortadorComMotor, GovernadorPI, SerieHarmonica, Soma, calibrarSerieA, ganhoRelativo, type GeradorCanal } from './base';
import { FonteRuido, FonteRolamento, Ramo, paDeLw, type EspecFonteRuido } from './ruido';
import { Bq } from '../scene/filtros';
import { REF_DIST_PORTADOR } from './trem';

export const NOTCH_RPM = {
  emd710: [269, 269, 343, 490, 568, 651, 729, 820, 904],     // notch 0 = lenta (200 em lenta baixa)
  ge7fdl: [440, 440, 511, 585, 672, 764, 846, 950, 1050],
} as const;
export const NOTCH_POTENCIA = [0, 0.05, 0.12, 0.23, 0.35, 0.48, 0.64, 0.82, 1.0] as const;
export const BUZINA_K5LA = [311, 370, 440, 494, 622] as const;

export interface ConfigLocomotiva {
  motor: keyof typeof NOTCH_RPM;
  potenciaNominal: number;     // kW (SD70: 3200)
  etaGer: number;              // 0,93
  J_ger: number;               // kg·m²
  rampa: number;               // rpm/s
  atrasoCarga: number;         // s
  ventiladores: { n: number; B: number; rpmAlta: number; rpmBaixa: number };
  eixos: number;
  buzina: boolean;
  posMotor: Vec3;
}

export const LOCOMOTIVA_PADRAO: ConfigLocomotiva = {
  motor: 'emd710', potenciaNominal: 3200, etaGer: 0.93, J_ger: 120, rampa: 100, atrasoCarga: 1.5,
  ventiladores: { n: 3, B: 12, rpmAlta: 1100, rpmBaixa: 550 }, eixos: 6, buzina: false, posMotor: [1, 0, 2.2],
};

const OMNI: Diretividade = { tabela: [0, 0, 0, 0, 0, 0, 0], eixo: [1, 0, 0], expConv: 2 };

/** ruído de banda: hp/lp (largo) ou bp (Q), nível em L_W dB(A) */
class Banda extends FonteRuido {
  fa: number; fb: number;
  constructor(fs: number, esp: EspecFonteRuido, semente: number, fa: number, fb: number) {
    super(fs, esp, semente); this.fa = fa; this.fb = fb;
    this.ramos = [new Ramo(semente, [new Bq(), new Bq()])];
    this.ajustar(esp.vRef);
  }
  montar() { this.ramos[0].bq[0].hp(this.fs, this.fa, 0.7071); this.ramos[0].bq[1].lp(this.fs, this.fb, 0.7071); }
  /** liga/desliga e escala (amplitude relativa ao L_W) */
  nivel = 1;
  protected modular() { return this.nivel; }
}

/** pulsos do compressor de ar (2 cilindros a 600 rpm → 20 Hz), passa-baixa de 300 Hz */
class Pulsos implements GeradorCanal {
  fs: number; f = 20; fase = 0; lp = new Bq(); g = 1; ligado = 1;
  constructor(fs: number, pa: number) { this.fs = fs; this.lp.lp(fs, 300, 0.7071); this.g = pa * 6; }
  preencher(out: Float32Array, n: number) {
    for (let k = 0; k < n; k++) {
      this.fase += this.f / this.fs; if (this.fase >= 1) this.fase -= 1;
      const x = this.fase < 0.08 ? Math.sin(Math.PI * this.fase / 0.08) : 0;
      out[k] = this.ligado * this.g * this.lp.run(x);
    }
  }
}

export class CargaLocomotiva implements Carga {
  inercia: number; P = 0; eta: number;
  constructor(c: ConfigLocomotiva) { this.inercia = c.J_ger; this.eta = c.etaGer; }
  torque(omega: number) { return this.P / (this.eta * Math.max(omega, 1)); }
}

export class Locomotiva extends PortadorComMotor {
  readonly tipo = 'locomotiva' as const;
  cfg: ConfigLocomotiva;
  cargaL: CargaLocomotiva;
  gov = new GovernadorPI(0.6, 0.3, 0, 1, Infinity, 0.05);
  rpmAlvo: number; pAlvo = 0; pFila: Float64Array = new Float64Array(0); pI = 0;
  turbo: Banda; vent: SerieHarmonica[] = []; ventR: Banda[] = []; sopr: Banda; comp: Pulsos; grades: Banda; rodas: FonteRolamento[] = [];
  tComp = 0; tVent = 0;
  constructor(fs: number, cfg: Partial<ConfigLocomotiva> = {}) {
    const c = { ...LOCOMOTIVA_PADRAO, ...cfg };
    const corpo: Corpo = { segmentos: [{ comprimento: 22, vao: 0, altura: 4.7, largura: 3.2, zPiso: 0.5 }], comprimento: 22, nariz: 0, cauda: 0, areaFrontal: 14, cd: 0.8, cpNariz: 0.3, massaSuperficial: 25, fCabine: 45 };
    super(fs, 'locomotiva', corpo, { posMotor: c.posMotor, rotMotor: 'frente' });
    this.cfg = c;
    this.cargaL = new CargaLocomotiva(c);
    this.rpmAlvo = NOTCH_RPM[c.motor][0];
    const R = REF_DIST_PORTADOR;
    // turbo: eixo de 300–333 Hz com 27 pás → 8–9 kHz, uivo bp Q 15; L_W 95 dB(A) em N8 ∝ 60·log(rpm_turbo)
    this.turbo = new Banda(fs, { lw: 95, n: 0, vRef: 1, refDist: R }, 0x7b0, 8000, 9500);
    this.propria({ id: 'turbo', tipo: 'pa', pos: [2, 0, 4.2], dir: OMNI, refDist: R, dentro: true }, this.turbo);
    // ventiladores do radiador: 12 pás a 1100 rpm → 220 Hz e harmônicos; ruído bp 500 Hz; L_W 100 (alta) / 92 (baixa)
    for (let k = 0; k < c.ventiladores.n; k++) {
      const s = new SerieHarmonica(fs, 4), r = new Banda(fs, { lw: 97, n: 0, vRef: 1, refDist: R }, 0x7e0 + k, 350, 700);
      this.vent.push(s); this.ventR.push(r);
      this.propria({ id: `ventilador.${k}`, tipo: 'pa', pos: [-4 - 2.5 * k, 0, 4.7], dir: { tabela: [0, -1, -3, -6, -9, -12, -15], eixo: [0, 0, 1], expConv: 3 }, refDist: R, dentro: false }, new Soma([s, r]));
    }
    this.sopr = new Banda(fs, { lw: 95, n: 0, vRef: 1, refDist: R }, 0x50b, 400, 3000);
    this.propria({ id: 'soprador.tracao', tipo: 'aero', pos: [5, 0, 3], dir: OMNI, refDist: R, dentro: false }, this.sopr);
    this.comp = new Pulsos(fs, paDeLw(90, R));
    this.propria({ id: 'compressor.ar', tipo: 'compressor', pos: [-8, 0, 1.5], dir: OMNI, refDist: R, dentro: true }, this.comp);
    this.grades = new Banda(fs, { lw: 100, n: 0, vRef: 1, refDist: R }, 0x96d, 1000, 4000);
    this.propria({ id: 'grades.freio', tipo: 'aero', pos: [0, 0, 4.7], dir: OMNI, refDist: R, dentro: false }, this.grades);
    // rodas: 6 eixos, roda de 1,02 m, L_W 103 dB(A) por eixo a 80 km/h, n 3 (pico 1–2 kHz)
    for (let k = 0; k < c.eixos; k++) {
      const x = k < c.eixos / 2 ? 7 - 1.9 * k : -7 + 1.9 * (c.eixos - 1 - k);
      const roda = new FonteRolamento(fs, { lw: 103, n: 3, vRef: 80 / 3.6, refDist: R }, 0x40da + k, 0.6, 0, 1.02);
      this.rodas.push(roda);
      this.propria({ id: `rolamento.${k}`, tipo: 'rolamento', pos: [x, 0, 0.3], hCorpo: 0.3, dir: { tabela: [0, -1.2, -6, -20, -6, -1.2, 0], eixo: [0, 1, 0], expConv: 2 }, refDist: R, dentro: false }, roda);
    }
    if (c.buzina) {
      // K5LA: 5 notas (311, 370, 440, 494, 622 Hz), L_W 130 dB(A): parciais 1–3 de cada nota
      // TODO: sopro e o peak Q 40 por nota; aqui só os parciais
      this.propria({ id: 'buzina', tipo: 'pa', pos: [10, 0, 4.8], dir: { tabela: [0, -2, -6, -10, -14, -18, -22], eixo: [1, 0, 0], expConv: 2 }, refDist: R, dentro: false }, new Soma(BUZINA_K5LA.map((f) => { const n = new SerieHarmonica(fs, 3); n.f0 = f; calibrarSerieA(n, [1, 0.5, 0.25], paDeLw(130 - 7, R)); return n; })));
    }
  }
  carga() { return this.cargaL; }
  gRel = 0;
  acoplar(m: import('./tipos').Motor | null) { this.gRel = 0; super.acoplar(m); }

  protected fisica(n: number, dt: number) {
    const c = this.cfg, tb = n * dt;
    const notch = this.cmd.notch ?? 0, fd = this.cmd.freioDinamico ?? 0;
    const tabela = NOTCH_RPM[c.motor];
    // freio dinâmico: motor no notch 8 de rotação, sem carga de tração
    const nRot = fd > 0 ? 8 : notch;
    const alvo = tabela[nRot];
    const d = c.rampa * tb;
    this.rpmAlvo += Math.max(-d, Math.min(d, alvo - this.rpmAlvo));
    // potência pedida com atraso de 1,5 s (fila)
    if (this.pFila.length === 0) this.pFila = new Float64Array(Math.max(1, Math.round(c.atrasoCarga / tb)));
    const pPed = fd > 0 ? 0 : NOTCH_POTENCIA[notch] * c.potenciaNominal * 1000;
    const k = this.pI % this.pFila.length;
    const pAt = this.pI >= this.pFila.length ? this.pFila[k] : 0;
    this.pFila[k] = pPed; this.pI++;
    const m = this.motor;
    const w = m ? m.eixo.omega : (this.rpmAlvo * 2 * Math.PI) / 60;
    // regulador de carga: corta a excitação se a rotação cai mais de 10% abaixo do alvo (uma carga de
    // potência constante num eixo que perde rotação pede cada vez mais torque e apagaria o motor)
    const wAlvo = (this.rpmAlvo * 2 * Math.PI) / 60;
    this.cargaL.P = pAt * Math.max(0, Math.min(1, (w / wAlvo - 0.9) / 0.08));
    if (m && m.governadorProprio) {
      // motor com governador próprio (o diesel, isócrono com a rampa de 100 rpm/s dele): o alvo é o do notch
      m.comandar({ acelerador: 0, ignicao: this.cmd.ignicao !== false, partida: false, rpmAlvo: alvo });
    } else if (m) {
      const erro = (100 * ((this.rpmAlvo * 2 * Math.PI) / 60 - w)) / ((tabela[8] * 2 * Math.PI) / 60);
      // ganhos acertados com o motor de bancada de tools/cena/portadores.ts (48 000 N·m, 60 + 120 kg·m²), escalados pela planta
      if (this.gRel === 0) { this.gRel = ganhoRelativo(m, 48000, 60 + 120, this.cargaL.inercia); this.gov.kp = 0.6 * this.gRel; this.gov.ki = 0.3 * this.gRel; }
      m.comandar({ acelerador: 0, ignicao: this.cmd.ignicao !== false, partida: false, combustivel: this.gov.passo(erro, tb) });
    }
    // fontes próprias
    const rpm = (w * 60) / (2 * Math.PI), frac = rpm / tabela[8];
    this.turbo.nivel = Math.pow(Math.max(frac, 0.05), 3);   // 60·log(rpm_turbo) em amplitude: ^3
    const pf = this.cargaL.P / (c.potenciaNominal * 1000);
    this.sopr.nivel = 0.3 + 0.7 * Math.max(pf, fd);
    this.grades.nivel = fd;
    // ventiladores: ligam por temperatura (ciclo de 2–5 min): aqui altos acima do notch 5, baixos de 3 a 5
    const rpmV = notch >= 6 || fd > 0 ? c.ventiladores.rpmAlta : notch >= 3 ? c.ventiladores.rpmBaixa : 0;
    for (let i = 0; i < this.vent.length; i++) {
      this.vent[i].f0 = (c.ventiladores.B * rpmV) / 60;
      if (rpmV > 0) calibrarSerieA(this.vent[i], [1, 0.4, 0.2, 0.1], paDeLw(rpmV === c.ventiladores.rpmAlta ? 100 : 92, REF_DIST_PORTADOR) * 0.7);
      else this.vent[i].a.fill(0);
      this.ventR[i].nivel = rpmV > 0 ? (rpmV === c.ventiladores.rpmAlta ? 1 : 0.4) : 0;
    }
    // compressor: liga 20 s a cada 3 min
    this.tComp = (this.tComp + tb) % 180;
    this.comp.ligado = this.tComp < 20 ? 1 : 0;
    for (const r of this.rodas) r.ajustar(this.cinematica.v);
  }

  telemetria(): TelemetriaPortador {
    const w = this.motor ? this.motor.eixo.omega : (this.rpmAlvo * 2 * Math.PI) / 60;
    return { v: this.cinematica.v, s: this.cinematica.s, rpmEixo: (w * 60) / (2 * Math.PI), torqueCarga: this.cargaL.torque(w), rpmAlvo: this.rpmAlvo, potencia: this.cargaL.P, notch: this.cmd.notch ?? 0 };
  }
}
