// Portador carro (CENA.md 4.1): `CarroLegado`, o adaptador fino que a decisão 1.1.5 pede. Massa, potência,
// relações, diferencial, raio da roda, arrasto, embreagem, câmbio, automático, corte de giro e 2-step continuam
// dentro do EngineDSP (Ronco) ou do DieselDSP (picape, caminhão, ônibus); este portador só lê a velocidade
// do carro de lá, posiciona as fontes do motor no corpo e passa o pedal, o freio e a marcha.
//
// `velocidadeFixa` (modo de testes, e a passagem disparada pela página): a velocidade do carro dentro do DSP é
// imposta a cada bloco. Com uma marcha engatada o motor fica preso às rodas, como num dinamômetro de rolo: em
// carga total ele segura a rotação v·i/r_w e sopra tudo o que tem (a "carga" do carro passando na rua).
// Pneus e vento (4.1, AUDITORIA.md C-06/K-12): ligados pela configuração (`configCarroLegado`, que a Passagem monta a
// partir da ficha do motor). Sem configuração (`new CarroLegado()`), só o motor, como o road() do Ronco: é assim que as
// referências do legado e os níveis do teste:cena são medidos, e o som do motor não muda.
//   pneus: a FontePneu de ruido.ts (CENA 4.1, 95 dB(A) por roda a 80 km/h; 98 nos pesados), 4 no carro, 2 na moto, 6 no
//          caminhão e no ônibus (acima de 7 t), nenhum no tanque (o Sherman anda de lagarta, que não existe aqui)
//   vento: a FonteAero do carro elétrico (para-brisa e retrovisores, 80 dB(A) a 80 km/h, n 6; 86 nos pesados)
import type { FonteSonora, Vec3 } from '../scene/tipos';
import type { Portador, Corpo, Cinematica, ComandoPortador, TelemetriaPortador, Motor, FamiliaMotor } from './tipos';
import { COMPAT, validarCompat, fontesDoMotor } from './compat';
import type { MotorPistaoBase } from '../engines/ronco/motor';
import { FontePneu, FonteAero, type FonteRuido } from './ruido';
import { fatorPotenciaDir } from '../scene/filtros';

/** pneus e vento do carro com motor de câmbio (lw em dB(A) a 80 km/h; 0 pneus = sem pneu) */
export interface ConfigCarroLegado { pneus?: number; lwPneu?: number; lwAero?: number; semente?: number }

/** veículos de lagarta (sem pneu): o Sherman */
const LAGARTA = new Set(['r975']);
/** pneus e vento pela ficha do motor (Ronco, Diesel, radial, rotativo): família, massa e o veículo */
export function configCarroLegado(spec: { id?: string; family?: string; mass?: number; veiculo?: { massa?: number } } | null | undefined): ConfigCarroLegado {
  if (!spec) return {};
  const massa = spec.mass ?? spec.veiculo?.massa ?? 1400, pesado = massa > 7000;
  const pneus = spec.id && LAGARTA.has(spec.id) ? 0 : spec.family === 'moto' || massa < 400 ? 2 : pesado ? 6 : 4;
  return { pneus, lwPneu: pesado ? 98 : 95, lwAero: pesado ? 86 : 80 };
}

/** corpo do carro (4.1) com a cabine do Ronco (lp 420 + lp 1100 + pico de 70 Hz Q 1,1 +7 dB, 0,6 do escape a ~5 m) */
export const CORPO_CARRO: Corpo = {
  segmentos: [{ comprimento: 4.6, vao: 0, altura: 1.4, largura: 1.85, zPiso: 0.15 }], comprimento: 4.6, nariz: 0, cauda: 0,
  areaFrontal: 2.2, cd: 0.32, cpNariz: 0.05, massaSuperficial: 12, fCabine: 70,
  // ganho: o `int` legado leva 0,6 do escape no nível da câmera de fora (5 m); da ponteira ao ponto da cabine
  // ([−0,3, 0,4, 1,1]) a Cena propaga ~2,2 m (×5/2,2), então a casca leva 0,6·2,2/5
  cabine: { lp: [[420, 0.7], [1100, 0.6]], pico: [70, 1.1, 7], ganho: (0.6 * 2.2) / 5 },
};

export class CarroLegado implements Portador {
  readonly tipo = 'carro' as const;
  readonly compat: readonly FamiliaMotor[] = COMPAT.carro;
  corpo: Corpo = CORPO_CARRO;
  cinematica: Cinematica = { s: 0, v: 0, a: 0, rumo: 0 };
  motor: MotorPistaoBase | null = null;
  cmd: ComandoPortador = { pedal: 0 };
  private lista: FonteSonora[] = [];
  private vAnt = 0;
  private nMotor = 0;
  /** pneus e vento (fontes próprias, depois das do motor) */
  private proprias: { f: FonteSonora; g: FonteRuido }[] = [];

  constructor(fs = 48000, cfg: ConfigCarroLegado = {}) {
    const omni = { tabela: [0, 0, 0, 0, 0, 0, 0] as const, eixo: [1, 0, 0] as Vec3, expConv: 2 };
    let sem = (cfg.semente ?? 0x9a5e) >>> 0;
    const prox = () => (sem = (sem + 0x9e3779b9) >>> 0);
    const n = cfg.pneus ?? 0, W = this.corpo.segmentos[0].largura;
    // (eixos a ±1,4 m; o 3º eixo dos pesados a −0,4 m; a moto com as rodas no eixo)
    const y = W / 2 - 0.15;
    const quatroMais: Vec3[] = [[1.4, y, 0.02], [1.4, -y, 0.02], [-1.4, y, 0.02], [-1.4, -y, 0.02], [-0.4, y, 0.02], [-0.4, -y, 0.02]];
    const pos: Vec3[] = n === 2 ? [[1.2, 0, 0.02], [-1.2, 0, 0.02]] : quatroMais.slice(0, n);
    pos.forEach((p, k) => this.proprias.push({ f: { id: `pneu.${k}`, tipo: 'rolamento', pos: p, hCorpo: 0.02, dir: omni, refDist: 7.5, dentro: false }, g: new FontePneu(fs, prox(), { lw: cfg.lwPneu ?? 95 }) }));
    if (cfg.lwAero) this.proprias.push({ f: { id: 'aero', tipo: 'aero', pos: [0.8, 0, 1.0], dir: omni, refDist: 7.5, dentro: false }, g: new FonteAero(fs, { lw: cfg.lwAero, n: 6, vRef: 80 / 3.6, refDist: 7.5 }, prox(), 500) });
    for (const p of this.proprias) { p.g.calibrar(); p.g.gCal /= Math.sqrt(fatorPotenciaDir(p.f.dir.tabela)); }
  }

  acoplar(motor: Motor | null) {
    validarCompat('carro', motor);
    const m = motor as MotorPistaoBase | null;
    if (m && !(m as any).dsp?.ratios) throw new Error('CarroLegado: o motor precisa trazer o câmbio e o carro do EngineDSP (Ronco ou Diesel)');
    this.motor = m;
    m?.acoplar(null);   // a carga do carro é a dinâmica de dentro do DSP
    const fm = m ? fontesDoMotor(m, m.montagem) : [];
    this.nMotor = fm.length;
    this.lista = [...fm, ...this.proprias.map((p) => p.f)];
  }
  comandar(c: ComandoPortador) {
    this.cmd = { ...this.cmd, ...c };
    const d = this.motor?.dsp; if (!d) return;
    if (c.freio !== undefined) d.message({ type: 'input', brake: c.freio });
    if (c.marcha === 'sobe') d.requestShift(1);
    else if (c.marcha === 'desce') d.requestShift(-1);
    else if (typeof c.marcha === 'number') {
      // marcha escolhida (preset da passagem): engata direto e segura (o automático não troca sozinho)
      d.gear = Math.max(0, Math.min(d.ratios.length - 1, c.marcha | 0)); d.clutch = 1; d.shifting = false; d.shiftCool = 1e9;
    }
  }
  fontes(): readonly FonteSonora[] { return this.lista; }
  processar(saidas: Float32Array[], n: number, dt: number) {
    const m = this.motor, k = this.cinematica;
    if (m) {
      const vf = this.cmd.velocidadeFixa;
      if (vf != null) m.dsp.v = vf;
      m.comandar({ acelerador: this.cmd.pedal, ignicao: this.cmd.ignicao !== false, partida: !!this.cmd.partida });
      m.processar(saidas, n);
      if (vf != null) m.dsp.v = vf;
      k.v = m.dsp.v;
    } else if (this.cmd.velocidadeFixa != null) k.v = this.cmd.velocidadeFixa;
    // pneus e vento na velocidade do carro
    const P = this.proprias, o = this.nMotor;
    for (let j = 0; j < P.length; j++) { P[j].g.ajustar(k.v); P[j].g.preencher(saidas[o + j], n); }
    k.a = (k.v - this.vAnt) / (n * dt); this.vAnt = k.v;
    k.s += k.v * n * dt;
  }
  telemetria(): TelemetriaPortador {
    const d = this.motor?.dsp;
    return { v: this.cinematica.v, s: this.cinematica.s, rpmEixo: d ? d.rpmAvg : 0, torqueCarga: 0, marcha: d ? d.gear : 0, rpm: d ? d.rpmAvg : 0, acelerador: d ? d.thr : 0, estado: this.motor?.estado ?? 'desligado' };
  }
}
