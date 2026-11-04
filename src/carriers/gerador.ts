// Portador gerador (CENA.md 4.4): grupo motor-gerador de rotação fixa, degraus de carga elétrica.
//   rpm = 120·f_rede/polos (1500, 1800, 3000, 3600)
//   carga: Q = cargaFracao·P_nominal/(η·ω), com rampa de 0,1 s (o alternador responde na hora)
//   governador isócrono PI sobre o combustível com atraso de 0,3 s da bomba. O CENA.md dá K_p 0,5 por %
//   e K_i 0,5/s; com o combustível em fração (0..1) e o atraso de 0,3 s isso dá um ciclo-limite de ±10%
//   (a frequência de cruzamento fica em ~30 rad/s, e o atraso tira 9 rad de fase). Com K_p 0,07 por % e
//   K_i 0,05/(%·s) o degrau de 50% faz o que o mesmo parágrafo descreve: queda de 5–6%, volta em ~2 s,
//   sobrepasso de +0,6% (num grupo de 500 kW com 80 kg·m² no eixo). Ver docs/TECNICO.md.
// Alvo (5.10): degrau de 50% derruba 4–8% e recupera a ±2% em < 3 s; ISO 8528 G2 ≤ 10% e ≤ 5 s num
// degrau de 100%, G3 ≤ 7% e ≤ 3 s.
//
// O motor (diesel, etapa 2; vapor, etapa 5) ainda não existe: com motor `null` o eixo gira na rotação
// nominal imposta (bancada sem motor) e só as fontes próprias soam.
import type { Carga, Vec3 } from '../scene/tipos';
import type { TelemetriaPortador, Corpo } from './tipos';
import { PortadorComMotor, GovernadorPI, SerieHarmonica, Soma, calibrarSerieA, ganhoRelativo } from './base';
import { FonteRuido, Ramo, type EspecFonteRuido, paDeLw } from './ruido';
import { Bq } from '../scene/filtros';
import { REF_DIST_PORTADOR } from './trem';

export interface ConfigGerador {
  polos: 2 | 4; fRede: 50 | 60;
  potenciaNominal: number;     // kW
  eta: number;                 // rendimento do alternador
  J_alt: number;               // kg·m²
  ventilador: { B: number; D: number };
  carenagem: boolean;          // m_s 15: as fontes `dentro` passam pela lei da massa
  droop: number;               // 0–0,04 (0 = isócrono)
  ranhuras: number;            // ranhuras do estator (tom z_r·rpm/60)
  posMotor: Vec3;
  /**
   * (extensões do vapor, VAPOR.md 2.1) máquina de moinho: rotação nominal direta (60–100 rpm, sem polos), sem as fontes
   * de alternador e ventilador (a carga é o eixo de transmissão) e o corpo da casa de máquinas (12 × 6 × 6, alvenaria)
   */
  rpmNominal?: number;
  semFontes?: boolean;
  corpo?: { comprimento: number; largura: number; altura: number; massaSuperficial: number };
}

export const GERADOR_PADRAO: ConfigGerador = {
  polos: 4, fRede: 60, potenciaNominal: 500, eta: 0.92, J_alt: 20, ventilador: { B: 8, D: 0.6 }, carenagem: true, droop: 0, ranhuras: 48, posMotor: [0.4, 0, 0.8],
};

export const rpmGerador = (polos: number, fRede: number) => (120 * fRede) / polos;
export const DEGRAUS_CARGA = [0, 0.25, 0.5, 0.75, 1] as const;
/** ganhos do governador (por % de erro de rotação; combustível em fração). CENA.md: 0,5 e 0,5 (instável com o atraso). */
export const GOV_GERADOR = { kp: 0.07, ki: 0.05 };

/** ruído largo do ventilador: passa-banda em 1 kHz */
class RuidoLargo extends FonteRuido {
  f: number; q: number;
  constructor(fs: number, esp: EspecFonteRuido, semente: number, f: number, q: number) { super(fs, esp, semente); this.f = f; this.q = q; this.ramos = [new Ramo(semente, [new Bq()])]; this.ajustar(esp.vRef); }
  montar() { this.ramos[0].bq[0].bp(this.fs, this.f, this.q); }
}

export class CargaGerador implements Carga {
  inercia: number;
  fracao = 0; fracaoAlvo = 0;
  Pnom: number; eta: number;
  constructor(cfg: ConfigGerador) { this.inercia = cfg.J_alt; this.Pnom = cfg.potenciaNominal * 1000; this.eta = cfg.eta; }
  torque(omega: number) { return (this.fracao * this.Pnom) / (this.eta * Math.max(omega, 1)); }
}

export class Gerador extends PortadorComMotor {
  readonly tipo = 'gerador' as const;
  cfg: ConfigGerador;
  cargaG: CargaGerador;
  gov: GovernadorPI;
  omegaNom: number;
  // atraso de 0,3 s da bomba: fila do comando de combustível (dimensionada no primeiro bloco)
  fila: Float64Array = new Float64Array(0); filaI = 0;
  omegaLivre: number;
  alt: SerieHarmonica; vent: SerieHarmonica;
  constructor(fs: number, cfg: Partial<ConfigGerador> = {}) {
    const c = { ...GERADOR_PADRAO, ...cfg };
    const k = c.corpo;
    const corpo: Corpo = k
      ? { segmentos: [{ comprimento: k.comprimento, vao: 0, altura: k.altura, largura: k.largura, zPiso: 0 }], comprimento: k.comprimento, nariz: 0, cauda: 0, areaFrontal: k.largura * k.altura, cd: 1, cpNariz: 0, massaSuperficial: k.massaSuperficial, fCabine: 40 }
      : { segmentos: [{ comprimento: 3, vao: 0, altura: 1.8, largura: 1.2, zPiso: 0.1 }], comprimento: 3, nariz: 0, cauda: 0, areaFrontal: 2.2, cd: 1, cpNariz: 0, massaSuperficial: c.carenagem ? 15 : 0, fCabine: 90 };
    super(fs, 'gerador', corpo, { posMotor: c.posMotor, rotMotor: 'frente' });
    this.cfg = c;
    this.cargaG = new CargaGerador(c);
    this.omegaNom = ((c.rpmNominal ?? rpmGerador(c.polos, c.fRede)) * 2 * Math.PI) / 60;
    this.omegaLivre = this.omegaNom;
    this.gov = new GovernadorPI(GOV_GERADOR.kp, GOV_GERADOR.ki, 0, 1, Infinity, 0.02);
    // fontes próprias (refDist 7,5 m)
    const R = REF_DIST_PORTADOR, rpm = rpmGerador(c.polos, c.fRede);
    const nr = Math.max(6, Math.round(c.ranhuras / c.polos));
    this.alt = new SerieHarmonica(fs, nr);
    this.relAlt = new Float64Array(nr);
    this.relAlt[0] = 1; this.relAlt[2] = 0.5; this.relAlt[4] = 0.3; this.relAlt[nr - 1] = 0.35;
    if (!c.semFontes) this.propria({ id: 'alternador', tipo: 'eletrica', pos: [-0.8, 0, 0.8], dir: { tabela: [0, 0, 0, 0, 0, 0, 0], eixo: [1, 0, 0], expConv: 2 }, refDist: R, dentro: true }, this.alt);
    this.vent = new SerieHarmonica(fs, 3);
    const ruidoVent = new RuidoLargo(fs, { lw: 95 - 3, n: 0, vRef: 1, refDist: R }, 0x6e7, 1000, 0.7);
    if (!c.semFontes) this.propria({ id: 'ventilador', tipo: 'pa', pos: [1.3, 0, 0.8], dir: { tabela: [0, 0, 0, 0, 0, 0, 0], eixo: [1, 0, 0], expConv: 3 }, refDist: R, dentro: true }, new Soma([this.vent, ruidoVent]));
    void rpm;
  }
  carga() { return this.cargaG; }
  gRel = 0;
  acoplar(m: import('./tipos').Motor | null) { this.gRel = 0; super.acoplar(m); }

  /**
   * Alternador: 2·f_rede e os harmônicos ímpares dele (100/300/500 Hz em 50 Hz; 120/360/600 em 60 Hz) e o
   * tom de ranhura z_r·rpm/60 (= (z_r/polos)·2·f_rede), L_W 85 dB(A) em vazio, +8 dB a 100%.
   * Ventilador: BPF = B·rpm/60 com 3 harmônicos (κ 0,6), L_W 95 dB(A) com n 5,5 em rpm, mais ruído em 1 kHz.
   */
  private relAlt: Float64Array; private relVent = new Float64Array([1, Math.exp(-0.6), Math.exp(-1.2)]);
  private atualizarFontes(omega: number) {
    if (this.cfg.semFontes) return;
    const c = this.cfg, rpm = (omega * 60) / (2 * Math.PI), R = REF_DIST_PORTADOR, rpmN = rpmGerador(c.polos, c.fRede);
    this.alt.f0 = 2 * c.fRede * (omega / this.omegaNom);
    // (o alternador só tem campo com o regulador de tensão ligado, perto da rotação: entra entre 50% e 90%)
    const exc = Math.max(0, Math.min(1, (omega / this.omegaNom - 0.5) / 0.4));
    calibrarSerieA(this.alt, this.relAlt, exc * paDeLw(85 + 8 * this.cargaG.fracao, R));
    this.vent.f0 = (c.ventilador.B * rpm) / 60;
    calibrarSerieA(this.vent, this.relVent, paDeLw(95 + 55 * Math.log10(Math.max(rpm, 1) / rpmN), R));
  }

  protected fisica(n: number, dt: number) {
    const c = this.cfg, tb = n * dt;
    // rampa de 0,1 s da carga; o disjuntor só fecha com o grupo funcionando perto da rotação nominal (um motor de
    // verdade que dá a partida com a carga ligada não sai do motor de partida: P/ω com ω ≈ 0)
    const m0 = this.motor;
    const pronto = !m0 || (m0.estado === 'funcionando' && m0.eixo.omega > 0.9 * this.omegaNom);
    const alvo = pronto ? Math.max(0, Math.min(1, this.cmd.cargaFracao ?? 0)) : 0;
    const d = tb / 0.1;
    this.cargaG.fracao += Math.max(-d, Math.min(d, alvo - this.cargaG.fracao));
    const m = this.motor;
    if (this.fila.length === 0) this.fila = new Float64Array(Math.max(1, Math.round(0.3 / tb)));
    if (m && m.governadorProprio) {
      // motor com governador próprio (o diesel): o portador manda a rotação da rede
      const alvoW = this.omegaNom * (1 - c.droop * this.cargaG.fracao);
      m.comandar({ acelerador: 0, ignicao: this.cmd.ignicao !== false, partida: false, rpmAlvo: (alvoW * 60) / (2 * Math.PI) });
      this.atualizarFontes(m.eixo.omega);
    } else if (m) {
      const w = m.eixo.omega;
      const alvoW = this.omegaNom * (1 - c.droop * this.cargaG.fracao);
      const erro = (100 * (alvoW - w)) / this.omegaNom;
      // ganhos acertados com o motor de bancada de tools/cena/portadores.ts (4500 N·m, 60 + 20 kg·m²), escalados pela planta
      if (this.gRel === 0) { this.gRel = ganhoRelativo(m, 4500, 80, this.cargaG.inercia); this.gov.kp = GOV_GERADOR.kp * this.gRel; this.gov.ki = GOV_GERADOR.ki * this.gRel; }
      const u = this.gov.passo(erro, tb);
      // atraso da bomba
      const k = this.filaI % this.fila.length;
      const atrasado = this.fila[k]; this.fila[k] = u; this.filaI++;
      m.comandar({ acelerador: 0, ignicao: this.cmd.ignicao !== false, partida: false, combustivel: this.filaI > this.fila.length ? atrasado : u });
      this.atualizarFontes(w);
    } else this.atualizarFontes(this.omegaLivre);
  }

  telemetria(): TelemetriaPortador {
    const w = this.motor ? this.motor.eixo.omega : this.omegaLivre;
    return { v: 0, s: this.cinematica.s, rpmEixo: (w * 60) / (2 * Math.PI), torqueCarga: this.cargaG.torque(w), cargaFracao: this.cargaG.fracao, combustivel: this.gov.saida, frequencia: (this.cfg.fRede * w) / this.omegaNom };
  }
}
