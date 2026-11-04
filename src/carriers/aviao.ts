// Portador avião a jato em passagem (o "avião (Turbina legado)" da tabela de comando do CENA.md 1.6): a fuselagem
// carrega os motores do JetDSP, a manete passa direto (`acelerador`) e a cinemática é a velocidade fixa da passagem.
// O `flyby` legado continua como está na página Turbina; aqui o mesmo avião passa pela Cena nova, com o resolvedor
// supersônico (src/scene/supersonico.ts) ligado ao propagador acima de Mach 0,9 e o estrondo da Cena.
import type { FonteSonora } from '../scene/tipos';
import type { Portador, Corpo, Cinematica, ComandoPortador, TelemetriaPortador, Motor, FamiliaMotor } from './tipos';
import { COMPAT, validarCompat, fontesDoMotor } from './compat';
import type { MotorTurbina } from '../engines/turbina/motor';

export function corpoAviao(comprimento = 40): Corpo {
  return {
    segmentos: [{ comprimento, vao: 0, altura: 4, largura: 4, zPiso: 0 }], comprimento, nariz: 4, cauda: 8,
    areaFrontal: 12, cd: 0.025, cpNariz: 0.05, massaSuperficial: 8, fCabine: 110,
  };
}

export class Aviao implements Portador {
  readonly tipo = 'aviao' as const;
  readonly compat: readonly FamiliaMotor[] = COMPAT.aviao;
  corpo: Corpo;
  cinematica: Cinematica = { s: 0, v: 0, a: 0, rumo: 0 };
  motor: MotorTurbina | null = null;
  cmd: ComandoPortador = { pedal: 0.85 };
  private lista: FonteSonora[] = [];
  estrondo = { comprimento: 30, forma: 0.09 };
  constructor(comprimento = 40) { this.corpo = corpoAviao(comprimento); }
  acoplar(motor: Motor | null) {
    validarCompat('aviao', motor);
    this.motor = motor as MotorTurbina | null;
    this.lista = motor ? fontesDoMotor(motor, { posMotor: [0, 0, 0], rotMotor: 'frente' }) : [];
    const cfg = (motor as MotorTurbina | null)?.dsp.cfg;
    if (cfg?.length) this.corpo = corpoAviao(cfg.length);
    // estrondo pela regra de Carlson com o comprimento e o fator de forma do avião (os do triggerBoom legado)
    this.estrondo = { comprimento: cfg?.length || 30, forma: cfg?.shape || 0.09 };
  }
  comandar(c: ComandoPortador) { this.cmd = { ...this.cmd, ...c }; }
  fontes(): readonly FonteSonora[] { return this.lista; }
  processar(saidas: Float32Array[], n: number, dt: number) {
    const k = this.cinematica, m = this.motor;
    if (this.cmd.velocidadeFixa != null) { k.v = this.cmd.velocidadeFixa; k.a = 0; }
    if (m) {
      m.velocidade = k.v;
      m.comandar({ acelerador: this.cmd.pedal, ignicao: this.cmd.ignicao !== false, partida: !!this.cmd.partida });
      m.processar(saidas, n);
    }
    k.s += k.v * n * dt;
  }
  telemetria(): TelemetriaPortador {
    const t = this.motor?.dsp.telemetry();
    return { v: this.cinematica.v, s: this.cinematica.s, rpmEixo: 0, torqueCarga: 0, n1: t?.n1 ?? 0, n2: t?.n2 ?? 0, mach: this.cinematica.v / 343 };
  }
}
