// Portador locomotiva a vapor (docs/VAPOR.md 4.4, decisão 9): a composição locomotiva + tênder + N vagões, por
// COMPOSIÇÃO e não herança (o `Trem` recusa motor). A geometria dos vagões (truques e vãos) sai das mesmas funções do
// trem.ts (`xTruquesVagoes`, `xVaosVagoes`); o rolamento é a `FonteRolamento` do ruido.ts, `v_ref` 80 km/h, `n` 3:
// rodeiros motrizes L_W 103 dB(A) por eixo, guias, tênder e vagões 100 por eixo (os eixos de um mesmo truque somam em
// potência numa fonte só, para caber no orçamento de 64 fontes da Cena). Vãos (`FonteVao`, 119 a 300 km/h, n 6) só se
// couberem: abaixo de 100 km/h são inaudíveis e são os primeiros a sair.
//
// Carga sobre o motor (o VaporDSP integra ω da roda, decisão 2):
//   torque(ω) = r·(R_davis(v) + m·g·rampa + F_freio),  R_davis = m·(6,4 + 0,13·v) + 0,0045·A·v² N (m em t, v em km/h)
//   inércia = m_total·r²·1,02 (massas girantes)
// `comandar` passa regulador, reverser, apito, sino, areia, freio, torneiras, fogo… ao motor; `velocidadeFixa` (modo de
// testes, passagem disparada) impõe ω à roda e deixa o resto (caldeira, cilindros, auxiliares) rodar.
import type { Carga, Diretividade } from '../scene/tipos';
import type { TelemetriaPortador, Corpo, Segmento, Motor, ComandoPortador } from './tipos';
import { PortadorComMotor } from './base';
import { FonteRolamento, FonteVao } from './ruido';
import { REF_DIST_PORTADOR, xTruquesVagoes, xVaosVagoes } from './trem';
import { MAX_FONTES } from '../scene/constantes';
import type { PresetVapor } from '../engines/vapor/presets';
import { eixosRodeiro } from '../engines/vapor/presets';
import { davis, G } from '../engines/vapor/constantes';
import type { VaporDSP, ComandoVapor } from '../engines/vapor/dsp';

export interface ConfigLocomotivaVapor {
  /** dimensões e massas da locomotiva e do tênder (do preset do motor) */
  loco: { comprimento: number; largura: number; altura: number; massa: number; dRoda: number; rodeiro?: string; tender?: { massa: number; eixos: number; comprimento: number } };
  vagoes: number;              // 0–20
  massaVagao: number;          // t
  Lc: number; vaoVagao: number; alturaVagao: number; larguraVagao: number; zPiso: number;
  areaFrontal: number;         // m²
  rampa: number;               // fração (0,0265 = 2,65%)
  semente: number;
}

export const LOCO_VAPOR_PADRAO: Omit<ConfigLocomotivaVapor, 'loco'> = {
  vagoes: 8, massaVagao: 40, Lc: 20, vaoVagao: 1.0, alturaVagao: 4.0, larguraVagao: 3.0, zPiso: 0.4, areaFrontal: 10, rampa: 0, semente: 0x5a0,
};

/** configuração do portador a partir de um preset de locomotiva a vapor */
export function configLocoVapor(P: PresetVapor, extra: Partial<ConfigLocomotivaVapor> = {}): ConfigLocomotivaVapor {
  const g = P.geometria;
  return {
    ...LOCO_VAPOR_PADRAO, massaVagao: P.vagao?.massa ?? LOCO_VAPOR_PADRAO.massaVagao, ...extra,
    // (a caixa do corpo vai até o teto da cabine e o alto da caldeira, 0,6 m abaixo da boca da chaminé: com a caixa na
    // altura da chaminé a borda dela fazia ~6 dB de sombra (Maekawa) sobre a chaminé para um ouvinte a 15 m)
    loco: { comprimento: g.comprimento, largura: g.largura, altura: Math.min(g.altura, g.zTopo - 0.6), massa: P.massa, dRoda: P.dRoda, rodeiro: P.rodeiro, tender: P.tender },
  };
}

/** L_W de referência (1.7) */
export const LW_ROLAMENTO_VAPOR = { motriz: 103, eixo: 100, vRef: 80 / 3.6 } as const;
const DIP_LATERAL: Diretividade['tabela'] = [0, -1.2, -6, -20, -6, -1.2, 0];
const DIP_FACE: Diretividade['tabela'] = [0, -1, -4, -10, -4, -1, 0];

/** quantas fontes próprias a composição pede e se os vãos entram (orçamento de MAX_FONTES com as do motor) */
export function orcamentoLocoVapor(c: Pick<ConfigLocomotivaVapor, 'vagoes' | 'loco'>, fontesMotor = 14) {
  const e = eixosRodeiro(c.loco.rodeiro);
  const loco = (e.motrizes > 0 ? (e.motrizes > 3 ? 2 : 1) : 0) + (e.guia > 0 ? 1 : 0) + (e.arrasto > 0 ? 1 : 0);
  const tender = c.loco.tender ? 2 : 0;
  const base = fontesMotor + loco + tender + 2 * c.vagoes;
  const vaos = (c.loco.tender ? 1 : 0) + (c.vagoes ? 1 : 0) + Math.max(0, c.vagoes - 1);
  return { fontes: base + (base + vaos <= MAX_FONTES ? vaos : 0), vaos: base + vaos <= MAX_FONTES, cabe: base <= MAX_FONTES };
}
export function maxVagoesVapor(c: Pick<ConfigLocomotivaVapor, 'loco'>, fontesMotor = 14) {
  let n = 0; while (n < 40 && orcamentoLocoVapor({ ...c, vagoes: n + 1 }, fontesMotor).cabe) n++; return n;
}

/** a carga do trem no eixo da roda (Davis + rampa + freio) */
export class CargaTremVapor implements Carga {
  inercia: number; mT: number; r: number; area: number; rampa = 0; freio = 0;
  constructor(mT: number, r: number, area: number) { this.mT = mT; this.r = r; this.area = area; this.inercia = mT * 1000 * r * r * 1.02; }
  definirMassa(mT: number) { this.mT = mT; this.inercia = mT * 1000 * this.r * this.r * 1.02; }
  torque(omega: number) {
    const v = omega * this.r, vk = Math.abs(v) * 3.6, s = Math.tanh(v / 0.05);
    const R = davis(this.mT, vk, this.area);
    // freio: sapatas, até 10% do peso (μ_sapata 0,1)
    const F = this.freio * 0.1 * this.mT * 1000 * G;
    return this.r * (s * (R + F) + this.mT * 1000 * G * this.rampa);
  }
}

export class LocomotivaVapor extends PortadorComMotor {
  readonly tipo = 'locomotiva' as const;
  cfg: ConfigLocomotivaVapor;
  cargaT: CargaTremVapor;
  rodas: FonteRolamento[] = []; vaos: FonteVao[] = [];
  /** x (corpo) do centro da locomotiva, dos truques dos vagões e do tênder (cena 3D) */
  xLoco = 0; xTruques: number[] = [];
  constructor(fs: number, cfg: ConfigLocomotivaVapor, fontesMotor = 14) {
    const c = cfg, L0 = c.loco, Lt = L0.tender?.comprimento ?? 0;
    const orc = orcamentoLocoVapor(c, fontesMotor);
    if (!orc.cabe) throw new Error(`composição com ${c.vagoes} vagões: ${orc.fontes} fontes, a Cena aceita ${MAX_FONTES} (até ${maxVagoesVapor(c, fontesMotor)} vagões)`);
    const segs: Segmento[] = [];
    const gap = 1.0;
    segs.push({ comprimento: L0.comprimento, vao: Lt || c.vagoes ? gap : 0, altura: L0.altura, largura: L0.largura, zPiso: 0.3 });
    if (Lt) segs.push({ comprimento: Lt, vao: c.vagoes ? gap : 0, altura: Math.min(L0.altura, 4.0), largura: L0.largura, zPiso: 0.4 });
    for (let k = 0; k < c.vagoes; k++) segs.push({ comprimento: c.Lc - c.vaoVagao, vao: k < c.vagoes - 1 ? c.vaoVagao : 0, altura: c.alturaVagao, largura: c.larguraVagao, zPiso: c.zPiso });
    const L = segs.reduce((s, g) => s + g.comprimento + g.vao, 0);
    const corpo: Corpo = { segmentos: segs, comprimento: L, nariz: 0, cauda: 0, areaFrontal: c.areaFrontal, cd: 0.8, cpNariz: 0.3, massaSuperficial: 25, fCabine: 45 };
    const xLoco = L / 2 - L0.comprimento / 2;
    super(fs, 'locomotiva', corpo, { posMotor: [xLoco, 0, 0], rotMotor: 'frente' });
    this.cfg = c; this.xLoco = xLoco;
    const r = L0.dRoda / 2;
    const mT = L0.massa + (L0.tender?.massa ?? 0) + c.vagoes * c.massaVagao;
    this.cargaT = new CargaTremVapor(mT, r, c.areaFrontal);
    this.cargaT.rampa = c.rampa;
    const R = REF_DIST_PORTADOR, vr = LW_ROLAMENTO_VAPOR.vRef;
    let sem = c.semente >>> 0;
    const prox = () => (sem = (sem + 0x9e3779b9) >>> 0);
    const roda = (id: string, x: number, eixos: number, lw: number, d: number) => {
      const f = new FonteRolamento(fs, { lw: lw + 10 * Math.log10(Math.max(1, eixos)), n: 3, vRef: vr, refDist: R }, prox(), 0.6, 0, d);
      this.rodas.push(f);
      this.propria({ id, tipo: 'rolamento', pos: [x, 0, 0.3], hCorpo: 0.3, dir: { tabela: DIP_LATERAL, eixo: [0, 1, 0], expConv: 2 }, refDist: R, dentro: false }, f);
    };
    // locomotiva: guias à frente, motrizes no meio (em dois grupos nas grandes), arrasto atrás
    const e = eixosRodeiro(L0.rodeiro), Ll = L0.comprimento;
    if (e.guia) roda('rolamento.guia', xLoco + 0.38 * Ll, e.guia, LW_ROLAMENTO_VAPOR.eixo, 0.9);
    if (e.motrizes > 3) { roda('rolamento.motriz.0', xLoco + 0.12 * Ll, e.motrizes / 2, LW_ROLAMENTO_VAPOR.motriz, L0.dRoda); roda('rolamento.motriz.1', xLoco - 0.12 * Ll, e.motrizes / 2, LW_ROLAMENTO_VAPOR.motriz, L0.dRoda); }
    else if (e.motrizes) roda('rolamento.motriz', xLoco + 0.05 * Ll, e.motrizes, LW_ROLAMENTO_VAPOR.motriz, L0.dRoda);
    if (e.arrasto) roda('rolamento.arrasto', xLoco - 0.35 * Ll, e.arrasto, LW_ROLAMENTO_VAPOR.eixo, 1.1);
    // tênder: dois truques
    let xf = L / 2 - Ll - gap;
    if (L0.tender) {
      const xt = xTruquesVagoes(1, Lt + gap, gap, Math.min(2.5, Lt / 4), xf);
      xt.forEach((x, k) => roda(`tender.${k}`, x, L0.tender!.eixos / 2, LW_ROLAMENTO_VAPOR.eixo, 0.9));
      xf -= Lt + gap;
    }
    // vagões: as mesmas posições de truque do trem.ts
    this.xTruques = xTruquesVagoes(c.vagoes, c.Lc, c.vaoVagao, 2.5, xf);
    this.xTruques.forEach((x, k) => roda(`truque.${k}`, x, 2, LW_ROLAMENTO_VAPOR.eixo, 0.9));
    if (orc.vaos) {
      // vãos: locomotiva–tênder, tênder (ou locomotiva)–1º vagão e entre os vagões
      const xv: number[] = [];
      if (L0.tender) xv.push(L / 2 - Ll - gap / 2);
      if (c.vagoes) xv.push(xf + gap / 2);
      xv.push(...xVaosVagoes(c.vagoes, c.Lc, c.vaoVagao, xf));
      xv.forEach((x, k) => {
        const f = new FonteVao(fs, { lw: 119, n: 6, vRef: 300 / 3.6, refDist: R }, prox(), c.vaoVagao);
        this.vaos.push(f);
        this.propria({ id: `vao.${k}`, tipo: 'vao', pos: [x, 0, 1.8], dir: { tabela: DIP_FACE, eixo: [0, 1, 0], expConv: 3 }, refDist: R, dentro: false }, f);
      });
    }
  }
  carga() { return this.cargaT; }
  get vapor(): VaporDSP | null { return (this.motor as unknown as VaporDSP) ?? null; }
  acoplar(m: Motor | null) { super.acoplar(m); }
  comandar(c: ComandoPortador & Partial<ComandoVapor> & { rampa?: number }) {
    super.comandar(c);
    if (c.rampa != null) this.cargaT.rampa = c.rampa;
    if (c.freio != null) this.cargaT.freio = c.freio;
    const m = this.vapor;
    if (m) {
      // o pedal genérico (Passagem) vira o regulador quando o comando não traz o do vapor
      const vc: Partial<ComandoVapor> & { acelerador: number; ignicao: boolean; partida: boolean } = { acelerador: 0, ignicao: c.ignicao !== false, partida: false };
      for (const k of ['regulador', 'cutoff', 'apito', 'sino', 'areia', 'torneiras', 'fogo', 'injetor', 'bombaAr', 'soprador', 'freio', 'simplificacao', 'trilho', 'mixAr', 'mixMec'] as const) if ((c as any)[k] !== undefined) (vc as any)[k] = (c as any)[k];
      if (c.regulador === undefined && c.pedal !== undefined && (c as any).cutoff === undefined) vc.regulador = c.pedal;
      m.comandar(vc as any);
    }
  }
  protected fisica(_n: number, _dt: number) {
    const m = this.vapor, k = this.cinematica, r = this.cfg.loco.dRoda / 2;
    const vf = this.cmd.velocidadeFixa;
    if (m) {
      m.impor(vf != null ? vf / r : null);
      if (vf == null) { const v = m.wTrem * r; k.a = (v - k.v) / Math.max(1e-6, _n * _dt); k.v = v; }
    }
    const v = vf ?? k.v;
    for (const f of this.rodas) f.ajustar(v);
    for (const f of this.vaos) f.ajustar(v);
  }
  telemetria(): TelemetriaPortador {
    const m = this.vapor, w = m ? m.eixo.omega : 0;
    return { v: this.cinematica.v, s: this.cinematica.s, rpmEixo: (w * 60) / (2 * Math.PI), torqueCarga: this.cargaT.torque(m ? m.wTrem : 0), massa: this.cargaT.mT, vagoes: this.cfg.vagoes, motor: m ? m.telemetria() : null };
  }
}
