// Portador multirrotor (drone, ELETRICO.md 4.3): tipo 'drone'. Não reusa o rotor de helicóptero (decisão 5: o CENA 4.3 tem
// governador de Nr, cauda, BVI e caixa, nada disso existe num multirrotor). Corpo 0,3 × 0,3 × 0,1 m, sem cabine; 4 rotores
// em [±0,12, ±0,12, 0,05]. As fontes são todas do motor: `motor.k` e `helice.k` (4 unidades com o `detune` medido no
// Mavic), postas na posição do rotor k. Carga por rotor Q = c_Q·ρ·n²·D⁵ (n em rot/s) com a inércia da hélice.
//
// Comando: `pedal` = coletivo; o ESC segura a rotação-alvo n = n_pairado·√(coletivo/0,5) (tração ∝ n²: pairado em 0,5)
// com alimentação direta de Q(n_alvo) e um proporcional; `velocidadeFixa` para a passagem.
import type { FonteSonora, Carga, Vec3 } from '../scene/tipos';
import type { Portador, Corpo, Cinematica, ComandoPortador, TelemetriaPortador, Motor, FamiliaMotor } from './tipos';
import { COMPAT, validarCompat } from './compat';
import { RHO } from '../scene/constantes';
import type { MotorEletrico } from '../engines/eletrico/motor';
import { torqueDisponivel } from '../engines/eletrico/maquina';

export const POS_ROTORES: Vec3[] = [[0.12, 0.12, 0.05], [-0.12, -0.12, 0.05], [0.12, -0.12, 0.05], [-0.12, 0.12, 0.05]];

export class Multirrotor implements Portador {
  readonly tipo = 'drone' as const;
  readonly compat: readonly FamiliaMotor[] = COMPAT.drone;
  corpo: Corpo = {
    segmentos: [{ comprimento: 0.3, vao: 0, altura: 0.1, largura: 0.3, zPiso: 0 }], comprimento: 0.3, nariz: 0, cauda: 0,
    areaFrontal: 0.03, cd: 1, cpNariz: 0, massaSuperficial: 1, fCabine: 400,
  };
  cinematica: Cinematica = { s: 0, v: 0, a: 0, rumo: 0 };
  motor: MotorEletrico | null = null;
  cmd: ComandoPortador = { pedal: 0.5, ignicao: true };
  massa: number; cQ: number; D = 0.21;
  carga: Carga;
  private lista: FonteSonora[] = [];
  private alvo = 0;

  constructor(cfg: { massa?: number; cQ?: number } = {}) {
    this.massa = cfg.massa ?? 0.734; this.cQ = cfg.cQ ?? 0.012;
    const self = this;
    this.carga = { inercia: 3e-5, torque(w: number) { const n = w / (2 * Math.PI); return self.cQ * RHO * n * n * Math.pow(self.D, 5); } };
  }
  acoplar(motor: Motor | null) {
    validarCompat('drone', motor);
    this.motor = motor as MotorEletrico | null;
    if (this.motor) {
      const h = this.motor.p.helice;
      if (h) { this.D = h.D; this.carga.inercia = 0.5 * 0.006 * (h.D / 2) * (h.D / 2) * h.B; }   // pás de ~6 g
      this.motor.acoplar(this.carga);
      // pairado desde o início: o ESC já está na rotação
      this.motor.eixo.omega = (this.motor.p.rpmBase * 2 * Math.PI) / 60;
    }
    // motor.k e helice.k na posição do rotor k
    this.lista = this.motor ? this.motor.fontes.map((f) => {
      const k = Number(f.id.split('.')[1] ?? 0) | 0, r = POS_ROTORES[k % 4];
      return { ...f, pos: [r[0] + f.pos[0], r[1] + f.pos[1], r[2] + f.pos[2] - 0.05] as Vec3 };
    }) : [];
  }
  comandar(c: ComandoPortador) { this.cmd = { ...this.cmd, ...c }; }
  fontes(): readonly FonteSonora[] { return this.lista; }
  processar(saidas: Float32Array[], n: number, dt: number) {
    const m = this.motor, k = this.cinematica, c = this.cmd;
    if (m) {
      const p = m.p, wH = (p.rpmBase * 2 * Math.PI) / 60, wM = (p.rpmMax * 2 * Math.PI) / 60;
      const col = Math.max(0, Math.min(1, c.pedal ?? 0.5));
      this.alvo = Math.min(wM, wH * Math.sqrt(col / 0.5));
      const w = m.eixo.omega;
      const Tff = this.carga.torque(this.alvo), Td = Math.max(1e-6, torqueDisponivel(p, w, 1));
      const ac = Math.max(0, Math.min(1, (Tff + 4 * p.Tn * (this.alvo - w) / wH) / Td));
      m.comandar({ acelerador: ac, ignicao: c.ignicao !== false, partida: false, v: Math.abs(k.v) } as never);
      m.processar(saidas, n);
    }
    if (c.velocidadeFixa != null) { k.v = c.velocidadeFixa; k.a = 0; }
    k.s += k.v * n * dt;
  }
  telemetria(): TelemetriaPortador {
    const t = this.motor ? this.motor.telemetria() : null;
    return { ...(t || {}), v: this.cinematica.v, s: this.cinematica.s, rpmEixo: t ? t.rpm : 0, torqueCarga: this.motor ? this.carga.torque(this.motor.eixo.omega) : 0, rpmAlvo: (this.alvo * 60) / (2 * Math.PI) };
  }
}
