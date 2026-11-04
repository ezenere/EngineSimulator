// Portador carro (CENA.md 4.1): `CarroLegado`, o adaptador fino que a decisão 1.1.5 pede. Massa, potência,
// relações, diferencial, raio da roda, arrasto, embreagem, câmbio, automático, corte de giro e 2-step continuam
// dentro do EngineDSP (Ronco) ou do DieselDSP (picape, caminhão, ônibus); este portador só lê a velocidade
// do carro de lá, posiciona as fontes do motor no corpo e passa o pedal, o freio e a marcha.
//
// `velocidadeFixa` (modo de testes, e a passagem disparada pela página): a velocidade do carro dentro do DSP é
// imposta a cada bloco. Com uma marcha engatada o motor fica preso às rodas, como num dinamômetro de rolo: em
// carga total ele segura a rotação v·i/r_w e sopra tudo o que tem (a "carga" do carro passando na rua).
// Pneus e aero (4.1) ficam desligados por padrão, como pede o CENA (o som do Ronco não pode mudar): TODO.
import type { FonteSonora } from '../scene/tipos';
import type { Portador, Corpo, Cinematica, ComandoPortador, TelemetriaPortador, Motor, FamiliaMotor } from './tipos';
import { COMPAT, validarCompat, fontesDoMotor } from './compat';
import type { MotorPistaoBase } from '../engines/ronco/motor';

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

  acoplar(motor: Motor | null) {
    validarCompat('carro', motor);
    const m = motor as MotorPistaoBase | null;
    if (m && !(m as any).dsp?.ratios) throw new Error('CarroLegado: o motor precisa trazer o câmbio e o carro do EngineDSP (Ronco ou Diesel)');
    this.motor = m;
    m?.acoplar(null);   // a carga do carro é a dinâmica de dentro do DSP
    this.lista = m ? fontesDoMotor(m, m.montagem) : [];
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
    k.a = (k.v - this.vAnt) / (n * dt); this.vAnt = k.v;
    k.s += k.v * n * dt;
  }
  telemetria(): TelemetriaPortador {
    const d = this.motor?.dsp;
    return { v: this.cinematica.v, s: this.cinematica.s, rpmEixo: d ? d.rpmAvg : 0, torqueCarga: 0, marcha: d ? d.gear : 0, rpm: d ? d.rpmAvg : 0, acelerador: d ? d.thr : 0, estado: this.motor?.estado ?? 'desligado' };
  }
}
