// Peças comuns dos portadores com motor (hélice, rotor, gerador, locomotiva): montagem das fontes do
// motor no corpo, canais do motor, governador PI e geradores de tons (série harmônica, nota).
import type { FonteSonora } from '../scene/tipos';
import type { Motor, MontagemMotor, TipoPortador, FamiliaMotor, Corpo, Cinematica, ComandoPortador, TelemetriaPortador, Portador } from './tipos';
import { COMPAT, validarCompat, fontesDoMotor } from './compat';
import { FonteRuido } from './ruido';
import { fatorPotenciaDir, ganhoA } from '../scene/filtros';

/** gerador de canal de uma fonte própria do portador */
export interface GeradorCanal { preencher(out: Float32Array, n: number): void }

/**
 * Base dos portadores com motor: `fontes()` = fontes do motor (no referencial do corpo) seguidas das
 * fontes próprias; `processar` chama `motor.processar` nos primeiros canais e os geradores nos demais.
 * A física de cada portador fica em `fisica(n, dt)`, chamada antes de preencher os canais.
 */
export abstract class PortadorComMotor implements Portador {
  abstract readonly tipo: TipoPortador;
  readonly compat: readonly FamiliaMotor[];
  corpo: Corpo;
  cinematica: Cinematica = { s: 0, v: 0, a: 0, rumo: 0 };
  motor: Motor | null = null;
  montagem: MontagemMotor;
  fs: number;
  cmd: ComandoPortador = { pedal: 0 };
  protected proprias: FonteSonora[] = [];
  protected geradores: GeradorCanal[] = [];
  private lista: FonteSonora[] = [];
  private nMotor = 0;
  private canaisMotor: Float32Array[] = [];

  constructor(fs: number, tipo: TipoPortador, corpo: Corpo, montagem: MontagemMotor) {
    this.fs = fs; this.corpo = corpo; this.montagem = montagem; this.compat = COMPAT[tipo];
  }
  /** registra uma fonte própria (aloca; só na construção). Fontes de ruído calibradas em L_W sobem pelo índice de diretividade. */
  protected propria(f: FonteSonora, g: GeradorCanal) {
    if (g instanceof FonteRuido) { g.calibrar(); g.gCal /= Math.sqrt(fatorPotenciaDir(f.dir.tabela)); }
    this.proprias.push(f); this.geradores.push(g); this.usadas.push(this.proprias.length - 1);
    this.lista = [...fontesDoMotor(this.motor, this.montagem), ...this.usadas.map((j) => this.proprias[j])];
  }
  /** índices das fontes próprias em uso: uma fonte do motor substitui a própria de mesmo id (ou `id.k`) */
  protected usadas: number[] = [];
  acoplar(motor: Motor | null) {
    validarCompat(this.tipo, motor);
    this.motor = motor;
    const fm = fontesDoMotor(motor, this.montagem);
    this.nMotor = fm.length;
    this.usadas = this.proprias.map((_, j) => j).filter((j) => { const id = this.proprias[j].id; return !fm.some((f) => f.id === id || f.id.startsWith(id + '.')); });
    this.lista = [...fm, ...this.usadas.map((j) => this.proprias[j])];
    this.canaisMotor = [];
    motor?.acoplar(this.carga());
  }
  abstract carga(): import('../scene/tipos').Carga | null;
  comandar(c: ComandoPortador) { this.cmd = { ...this.cmd, ...c }; }
  fontes(): readonly FonteSonora[] { return this.lista; }
  protected abstract fisica(n: number, dt: number): void;
  processar(saidas: Float32Array[], n: number, dt: number) {
    this.fisica(n, dt);
    if (this.motor) {
      if (this.canaisMotor.length !== this.nMotor) this.canaisMotor = saidas.slice(0, this.nMotor);
      for (let i = 0; i < this.nMotor; i++) this.canaisMotor[i] = saidas[i];
      this.motor.processar(this.canaisMotor, n);
    }
    const u = this.usadas;
    for (let j = 0; j < u.length; j++) this.geradores[u[j]].preencher(saidas[this.nMotor + j], n);
    const k = this.cinematica;
    if (this.cmd.velocidadeFixa != null) { k.v = this.cmd.velocidadeFixa; k.a = 0; }
    k.s += k.v * n * dt;
  }
  abstract telemetria(): TelemetriaPortador;
}

/**
 * Ganho da planta do governador relativo ao motor de bancada com que os ganhos do portador foram acertados:
 * (T_ref/J_ref)/(T_max/J_total), que multiplica Kp e Ki. Um motor de verdade (diesel) com metade da inércia por N·m reage o dobro ao
 * mesmo comando e o mesmo PI caçava (±3% no grupo de 500 kVA com o QSX15). Sem `torqueMax` no motor, 1.
 */
export function ganhoRelativo(motor: Motor | null, Tref: number, Jref: number, Jcarga: number) {
  const T = (motor as { torqueMax?: number } | null)?.torqueMax;
  if (!motor || !T) return 1;
  // (e a metade: o atraso da combustão por ciclo e o do turbo, que o motor de bancada não tem; com o ganho inteiro o
  // grupo de 500 kVA caçava ±2% em vazio, com a metade assenta e o degrau de 50% volta em ~2 s)
  return (0.5 * (Tref / Jref)) / (T / (motor.eixo.inercia + Jcarga));
}

/** Governador PI com limites e taxa máxima de variação da saída. */
export class GovernadorPI {
  kp: number; ki: number; min: number; max: number; taxa: number;
  i = 0; saida = 0;
  constructor(kp: number, ki: number, min: number, max: number, taxa = Infinity, inicial = 0) {
    this.kp = kp; this.ki = ki; this.min = min; this.max = max; this.taxa = taxa; this.saida = inicial; this.i = inicial;
  }
  /** erro em %, dt em s; devolve a saída */
  passo(erroPct: number, dt: number) {
    this.i += this.ki * erroPct * dt;
    if (this.i > this.max) this.i = this.max; else if (this.i < this.min) this.i = this.min;   // anti-windup
    let alvo = this.kp * erroPct + this.i;
    if (alvo > this.max) alvo = this.max; else if (alvo < this.min) alvo = this.min;
    const d = this.taxa * dt;
    this.saida += Math.max(-d, Math.min(d, alvo - this.saida));
    return this.saida;
  }
}

/** Série harmônica aditiva: f0 com amplitudes a_h (Pa RMS a refDist por harmônico), osciladores por rotação. */
export class SerieHarmonica implements GeradorCanal {
  fs: number; f0 = 0; a: Float64Array; c: Float64Array; s: Float64Array;
  constructor(fs: number, n: number) { this.fs = fs; this.a = new Float64Array(n); this.c = new Float64Array(n).fill(1); this.s = new Float64Array(n); }
  /** fase inicial em quadratura; a rotação acumula erro: renormaliza a cada bloco */
  preencher(out: Float32Array, n: number) {
    const H = this.a.length, w = (2 * Math.PI * this.f0) / this.fs;
    out.fill(0, 0, n);
    for (let h = 0; h < H; h++) {
      const amp = this.a[h] * Math.SQRT2;
      if (amp === 0 || (h + 1) * this.f0 >= 0.45 * this.fs) continue;
      const cw = Math.cos(w * (h + 1)), sw = Math.sin(w * (h + 1));
      let c = this.c[h], s = this.s[h];
      for (let k = 0; k < n; k++) { out[k] += amp * s; const c2 = c * cw - s * sw; s = s * cw + c * sw; c = c2; }
      const m = 1 / Math.hypot(c, s); this.c[h] = c * m; this.s[h] = s * m;
    }
  }
}

/**
 * Amplitudes de uma série harmônica com forma relativa `rel[h]` cuja soma, ponderada em A, dá `paA`
 * (Pa RMS a refDist): a_h = paA·rel_h/√Σ(rel_h·A(f_h))². Não aloca.
 */
export function calibrarSerieA(s: SerieHarmonica, rel: ArrayLike<number>, paA: number) {
  let e = 0;
  for (let h = 0; h < s.a.length; h++) { const r = rel[h] ?? 0, a = ganhoA((h + 1) * s.f0); e += r * r * a * a; }
  const g = e > 0 ? paA / Math.sqrt(e) : 0;
  for (let h = 0; h < s.a.length; h++) s.a[h] = (rel[h] ?? 0) * g;
}

/** Soma de geradores num canal só (ex.: tons + ruído largo de uma mesma fonte) */
export class Soma implements GeradorCanal {
  partes: GeradorCanal[]; tmp: Float32Array;
  constructor(partes: GeradorCanal[], blocoMax = 4096) { this.partes = partes; this.tmp = new Float32Array(blocoMax); }
  preencher(out: Float32Array, n: number) {
    out.fill(0, 0, n);
    for (const p of this.partes) { p.preencher(this.tmp, n); for (let k = 0; k < n; k++) out[k] += this.tmp[k]; }
  }
}
