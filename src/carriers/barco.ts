// Portador barco (docs/VAPOR.md 2.4 e 4.4; `TipoPortador` 'barco' é extensão): vapor de rodas de pás. Corpo de um
// segmento sobre a água (solo 'agua' na Cena), sem rolamento. Fontes próprias:
//   pas    — cada pá bate na água: N_pás × f_rev tapas/s (5–8 a 40 rpm), cada uma um pulso de 100–200 ms de respingo
//            200–2000 Hz com um "tum" de 60–120 Hz; L_W 105 dB(A) a 40 rpm, ∝ (rpm/40)³
//   agua   — o arrastar da água na caixa da roda e no casco, ruído contínuo 100–800 Hz ∝ v² (L_W 95 a 6 m/s)
// Carga: resistência de atrito do casco R = ½·ρ_água·S·C_f·v² (C_f 0,003) mais a de onda ∝ v⁴ acima de Fr 0,3, vista na
// roda com 25% de escorregamento das pás (v = 0,75·ω·R_roda): torque = R(v)·R_roda/0,75·…, inércia = m·(0,75·R)².
import type { Carga, Diretividade } from '../scene/tipos';
import type { TelemetriaPortador, Corpo, ComandoPortador } from './tipos';
import type { GeradorCanal } from './base';
import { PortadorComMotor } from './base';
import { FonteRuido, Ramo, paDeLw } from './ruido';
import { REF_DIST_PORTADOR } from './trem';
import { Bq, PonderacaoA } from '../scene/filtros';
import { RNG } from '../acoustics/rng';
import type { VaporDSP, ComandoVapor } from '../engines/vapor/dsp';
import type { PresetVapor } from '../engines/vapor/presets';

const OMNI: Diretividade = { tabela: [0, 0, 0, 0, 0, 0, 0], eixo: [0, 1, 0], expConv: 2 };
const ESCORREGAMENTO = 0.75;

export interface ConfigBarco { massa: number; comprimento: number; boca: number; calado: number; dRoda: number; nPas: number }
export const configBarco = (P: PresetVapor): ConfigBarco => ({ massa: P.massa, comprimento: P.geometria.comprimento, boca: P.geometria.largura, calado: 2, dRoda: P.pas?.D ?? P.dRoda, nPas: P.pas?.n ?? 10 });

export class CargaBarco implements Carga {
  inercia: number; c: ConfigBarco; S: number;
  constructor(c: ConfigBarco) {
    this.c = c; const re = ESCORREGAMENTO * c.dRoda / 2;
    this.inercia = c.massa * 1000 * re * re;
    this.S = c.comprimento * (c.boca + 2 * c.calado) * 0.85;   // superfície molhada
  }
  /** resistência do casco (N) a v m/s */
  resistencia(v: number) {
    const a = Math.abs(v), Rf = 0.5 * 1000 * this.S * 0.003 * a * a;
    const Fr = a / Math.sqrt(9.81 * this.c.comprimento), onda = Fr > 0.3 ? Rf * 8 * Math.pow(Fr - 0.3, 2) / 0.09 : 0;
    return Math.sign(v) * (Rf + onda);
  }
  torque(omega: number) { const R = this.c.dRoda / 2; return this.resistencia(ESCORREGAMENTO * omega * R) * R; }
}

/** as pás batendo na água, em fase com a roda */
class Pas implements GeradorCanal {
  fs: number; n: number; fase = 0; f = 0; amp = 0; rng: RNG;
  resp = new Bq(); resp2 = new Bq(); tum = new Bq(); e = 0; kE: number; eT = 0; kT: number; g = 1;
  constructor(fs: number, n: number, semente: number) {
    this.fs = fs; this.n = n; this.rng = new RNG(semente);
    this.resp.hp(fs, 200, 0.7071); this.resp2.lp(fs, 2000, 0.7071); this.tum.bp(fs, 90, 3);
    this.kE = Math.exp(-1 / (0.05 * fs)); this.kT = Math.exp(-1 / (0.04 * fs));
  }
  preencher(out: Float32Array, n: number) {
    for (let k = 0; k < n; k++) {
      this.fase += this.f / this.fs;
      if (this.fase >= 1) { this.fase -= 1; this.e = 0.7 + 0.3 * this.rng.next(); this.eT = 1; }
      const x = this.rng.next() * 2 - 1;
      out[k] = this.g * this.amp * (this.e * this.resp2.run(this.resp.run(x)) + 3 * this.eT * this.tum.run(x));
      this.e *= this.kE; this.eT *= this.kT;
    }
  }
}

/** água arrastada: 100–800 Hz ∝ v² */
class Agua extends FonteRuido {
  constructor(fs: number, semente: number) { super(fs, { lw: 95, n: 4, vRef: 6, refDist: REF_DIST_PORTADOR }, semente); this.ramos = [new Ramo(semente, [new Bq(), new Bq()])]; }
  montar() { this.ramos[0].bq[0].hp(this.fs, 100, 0.7071); this.ramos[0].bq[1].lp(this.fs, 800, 0.7071); }
}

export class Barco extends PortadorComMotor {
  readonly tipo = 'barco' as const;
  cfg: ConfigBarco; cargaB: CargaBarco; pas: Pas[] = []; agua: Agua;
  constructor(fs: number, cfg: ConfigBarco) {
    const corpo: Corpo = { segmentos: [{ comprimento: cfg.comprimento, vao: 0, altura: 6, largura: cfg.boca, zPiso: 0 }], comprimento: cfg.comprimento, nariz: 0, cauda: 0, areaFrontal: cfg.boca * 4, cd: 0.5, cpNariz: 0, massaSuperficial: 30, fCabine: 40 };
    super(fs, 'barco', corpo, { posMotor: [0, 0, 1], rotMotor: 'frente' });
    this.cfg = cfg; this.cargaB = new CargaBarco(cfg);
    // as duas rodas de pás, uma de cada lado, no meio do casco
    for (const lado of [1, -1]) {
      const p = new Pas(fs, cfg.nPas, 0x9a5 + lado);
      this.pas.push(p);
      this.propria({ id: `pas.${lado > 0 ? 'e' : 'd'}`, tipo: 'mecanica', pos: [0, lado * (cfg.boca / 2 + 0.8), 0.8], dir: OMNI, refDist: REF_DIST_PORTADOR, dentro: false }, p);
    }
    this.calibrarPas();
    this.agua = new Agua(fs, 0xa9a);
    this.propria({ id: 'agua', tipo: 'aero', pos: [cfg.comprimento * 0.3, 0, 0.2], dir: OMNI, refDist: REF_DIST_PORTADOR, dentro: false }, this.agua);
  }
  /** pás: L_W 105 dB(A) a 40 rpm (renderiza 2 s de uma roda e mede o A ponderado) */
  private calibrarPas() {
    const fs = this.fs, p = new Pas(fs, this.cfg.nPas, 0x9a5);
    p.f = (40 / 60) * this.cfg.nPas; p.amp = 1;
    const B = 256, out = new Float32Array(B), buf = new Float64Array(B);
    const pa = new PonderacaoA(fs);
    let e = 0, n = 0;
    for (let i = 0; i < 2 * fs; i += B) { p.preencher(out, B); for (let k = 0; k < B; k++) buf[k] = out[k]; pa.bloco(buf, B); if (i > 0.3 * fs) { for (let k = 0; k < B; k++) e += buf[k] * buf[k]; n += B; } }
    const g = paDeLw(105, REF_DIST_PORTADOR) / Math.sqrt(e / Math.max(1, n));
    for (const q of this.pas) q.g = g;
  }
  carga() { return this.cargaB; }
  get vapor(): VaporDSP | null { return (this.motor as unknown as VaporDSP) ?? null; }
  comandar(c: ComandoPortador & Partial<ComandoVapor>) {
    super.comandar(c);
    const m = this.vapor;
    if (m) {
      const vc: any = { acelerador: 0, ignicao: c.ignicao !== false, partida: false };
      for (const k of ['regulador', 'cutoff', 'apito', 'fogo', 'injetor', 'mixAr', 'mixMec']) if ((c as any)[k] !== undefined) vc[k] = (c as any)[k];
      if (c.regulador === undefined && c.pedal !== undefined && (c as any).cutoff === undefined) vc.regulador = c.pedal;
      m.comandar(vc);
    }
  }
  protected fisica(n: number, dt: number) {
    const m = this.vapor, k = this.cinematica, R = this.cfg.dRoda / 2, vf = this.cmd.velocidadeFixa;
    if (m) {
      m.impor(vf != null ? vf / (ESCORREGAMENTO * R) : null);
      if (vf == null) { const v = ESCORREGAMENTO * m.wTrem * R; k.a = (v - k.v) / (n * dt); k.v = v; }
    }
    const w = m ? Math.abs(m.eixo.omega) : 0, frev = w / (2 * Math.PI);
    for (const p of this.pas) { p.f = frev * this.cfg.nPas; p.amp = Math.pow(Math.min(2, frev / (40 / 60)), 1.5); }
    this.agua.ajustar(vf ?? k.v);
  }
  telemetria(): TelemetriaPortador {
    const m = this.vapor, w = m ? m.eixo.omega : 0;
    return { v: this.cinematica.v, s: this.cinematica.s, rpmEixo: (w * 60) / (2 * Math.PI), torqueCarga: this.cargaB.torque(m ? m.wTrem : 0), tapasPorS: (Math.abs(w) / (2 * Math.PI)) * this.cfg.nPas, motor: m ? m.telemetria() : null };
  }
}
