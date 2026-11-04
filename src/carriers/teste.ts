// Portador de teste (bancada da Cena): um corpo pequeno com fontes sintéticas (tom ou ruído branco) em
// posições escolhidas, andando com velocidade fixa. É o que os testes do propagador usam (Doppler,
// 1/r, pente do solo, sombra, orçamento de CPU com N fontes) sem depender de nenhum motor.
import type { FonteSonora, Diretividade, Vec3, TipoFonte } from '../scene/tipos';
import type { Portador, Corpo, Cinematica, ComandoPortador, TelemetriaPortador, Motor, FamiliaMotor } from './tipos';
import { RNG } from '../acoustics/rng';

export interface FonteTeste {
  id?: string;
  pos: Vec3;
  sinal: 'tom' | 'ruido';
  f?: number;               // Hz (tom)
  paRms: number;            // Pa RMS a refDist
  refDist?: number;
  expConv?: number;
  tipo?: TipoFonte;
  dir?: Diretividade['tabela']; eixo?: Vec3;
}

export class PortadorTeste implements Portador {
  readonly tipo = 'nenhum' as const;
  readonly compat: readonly FamiliaMotor[] = ['nenhum'];
  corpo: Corpo;
  cinematica: Cinematica = { s: 0, v: 0, a: 0, rumo: 0 };
  fs: number;
  lista: FonteSonora[];
  esp: FonteTeste[];
  fase: Float64Array;
  rng: RNG[];
  vFixa = 0;

  constructor(fs: number, fontes: FonteTeste[], corpo?: Partial<Corpo> & { largura?: number; altura?: number; zPiso?: number; comprimento?: number }) {
    this.fs = fs; this.esp = fontes;
    const L = corpo?.comprimento ?? 4.6;
    this.corpo = {
      segmentos: [{ comprimento: L, vao: 0, altura: corpo?.altura ?? 1.4, largura: corpo?.largura ?? 1.85, zPiso: corpo?.zPiso ?? 0.15 }],
      comprimento: L, nariz: 0, cauda: 0, areaFrontal: 2.2, cd: 0.3, cpNariz: 0.05, massaSuperficial: corpo?.massaSuperficial ?? 12, fCabine: corpo?.fCabine ?? 70,
    };
    this.lista = fontes.map((f, i) => ({
      id: f.id ?? `teste.${i}`, tipo: f.tipo ?? 'mecanica', pos: f.pos,
      dir: { tabela: f.dir ?? [0, 0, 0, 0, 0, 0, 0], eixo: f.eixo ?? [1, 0, 0], expConv: f.expConv ?? 2 },
      refDist: f.refDist ?? 7.5, dentro: false,
    }));
    this.fase = new Float64Array(fontes.length);
    this.rng = fontes.map((_, i) => new RNG(0x7e57 + i * 7919));
  }
  acoplar(m: Motor | null) { if (m) throw new Error('portador de teste não leva motor'); }
  comandar(c: ComandoPortador) { if (c.velocidadeFixa != null) this.vFixa = c.velocidadeFixa; }
  fontes() { return this.lista; }
  processar(saidas: Float32Array[], n: number, dt: number) {
    const k = this.cinematica;
    k.v = this.vFixa; k.a = 0;
    for (let i = 0; i < this.esp.length; i++) {
      const e = this.esp[i], out = saidas[i];
      if (e.sinal === 'tom') {
        const a = e.paRms * Math.SQRT2, d = (e.f ?? 1000) / this.fs;
        let ph = this.fase[i];
        for (let j = 0; j < n; j++) { out[j] = a * Math.sin(2 * Math.PI * ph); ph += d; if (ph >= 1) ph -= 1; }
        this.fase[i] = ph;
      } else {
        const a = e.paRms * Math.sqrt(3), r = this.rng[i];
        for (let j = 0; j < n; j++) out[j] = a * r.bi();
      }
    }
    k.s += k.v * n * dt;
  }
  telemetria(): TelemetriaPortador { return { v: this.cinematica.v, s: this.cinematica.s, rpmEixo: 0, torqueCarga: 0 }; }
}

// ---------------------------------------------------------------- motor de teste
import type { EixoSaida, Carga, ComandoMotor } from '../scene/tipos';
import type { EstadoMotor, TelemetriaMotor } from './tipos';

export interface ConfigMotorTeste {
  familia: FamiliaMotor;
  Tmax: number;          // N·m com combustível 1
  J: number;             // kg·m² do motor (sem a carga)
  atrito: number;        // N·m por rad/s
  tau: number;           // s, atraso do torque ao comando (bomba/injeção)
  omega0: number;        // rad/s inicial
}

/**
 * Motor de bancada para testar portadores (governadores, cargas, inércias) sem depender da migração
 * dos motores de verdade: eixo rígido, torque = comando·Tmax com atraso de 1ª ordem, atrito viscoso.
 * Não tem fontes sonoras. Integra o virabrequim (decisão 1.1.5: quem integra é o motor).
 */
export class MotorTeste implements Motor {
  readonly familia: FamiliaMotor;
  readonly fontes: readonly FonteSonora[] = [];
  eixo: EixoSaida = { omega: 0, torque: 0, inercia: 0 };
  estado: EstadoMotor = 'funcionando';
  cfg: ConfigMotorTeste;
  fs = 48000;
  carga: Carga | null = null;
  u = 0; uAlvo = 0; primeiro = true;
  constructor(cfg: ConfigMotorTeste) { this.cfg = cfg; this.familia = cfg.familia; this.eixo.omega = cfg.omega0; this.eixo.inercia = cfg.J; }
  configurar(_p: object, fs: number) { this.fs = fs; }
  comandar(c: ComandoMotor) { this.uAlvo = Math.max(0, Math.min(1, c.combustivel ?? c.acelerador)); if (!c.ignicao) this.uAlvo = 0; if (this.primeiro) { this.u = this.uAlvo; this.primeiro = false; } }
  acoplar(c: Carga | null) { this.carga = c; }
  processar(_s: Float32Array[], n: number) {
    // integra em passos de 32 amostras (a carga não muda mais depressa que isso)
    const c = this.cfg, h = 32 / this.fs;
    for (let k = 0; k < n; k += 32) {
      this.u += (this.uAlvo - this.u) * (1 - Math.exp(-h / c.tau));
      const w = this.eixo.omega;
      const Tm = this.u * c.Tmax - c.atrito * w;
      const Tc = this.carga ? this.carga.torque(w) : 0;
      const J = c.J + (this.carga ? this.carga.inercia : 0);
      this.eixo.omega = Math.max(0, w + ((Tm - Tc) / J) * h);
      this.eixo.torque = Tm;
    }
  }
  telemetria(): TelemetriaMotor { const w = this.eixo.omega; return { rpm: (w * 60) / (2 * Math.PI), torque: this.eixo.torque, potencia: this.eixo.torque * w, estado: this.estado }; }
}

// ---------------------------------------------------------------- bancada com motor (Elétrico, ELETRICO.md 4.3)
/**
 * Carga de bancada: constante (`frac·T_c`), quadrática (ventilador, facas na jarra: `T_c·(ω/ω_ref)²·(0,3 + 0,7·frac)`,
 * 30% de base: o ar ou a água) ou degrau (furar: +`frac·T_c` com o motor girando). `inercia`: mandril, jarra, ventilador.
 */
export class CargaBancada implements Carga {
  tipo: 'constante' | 'quadratica' | 'degrau';
  Tc: number; inercia: number; wRef: number;
  frac = 0;
  constructor(tipo: CargaBancada['tipo'], Tc: number, inercia: number, wRef: number) { this.tipo = tipo; this.Tc = Tc; this.inercia = inercia; this.wRef = wRef; }
  torque(w: number) {
    if (this.tipo === 'quadratica') { const r = w / this.wRef; return this.Tc * r * r * (0.3 + 0.7 * this.frac); }
    return w > 0.5 ? this.frac * this.Tc : 0;
  }
}

/**
 * Portador `nenhum` com motor: a bancada (ferramentas, liquidificador, motor industrial). As fontes ficam onde o preset as
 * põe (a mesa, [0, 0, 1]); `pedal` = gatilho (na rede: o contator), `cargaFracao` = degrau de carga. O corpo é uma caixa
 * pequena (0,6 × 0,4 × 0,9 m) que quase não faz sombra.
 */
export class PortadorBancada implements Portador {
  readonly tipo = 'nenhum' as const;
  readonly compat: readonly FamiliaMotor[] = ['pistao', 'turbina', 'turboelice', 'turboeixo', 'diesel', 'radial', 'rotativo', 'vapor', 'eletrico'];
  corpo: Corpo = { segmentos: [{ comprimento: 0.6, vao: 0, altura: 0.9, largura: 0.4, zPiso: 0 }], comprimento: 0.6, nariz: 0, cauda: 0, areaFrontal: 0.3, cd: 1, cpNariz: 0, massaSuperficial: 5, fCabine: 200 };
  cinematica: Cinematica = { s: 0, v: 0, a: 0, rumo: 0 };
  motor: Motor | null = null;
  carga: CargaBancada | null;
  cmd: ComandoPortador = { pedal: 0, ignicao: true };
  private lista: FonteSonora[] = [];
  constructor(carga: CargaBancada | null) { this.carga = carga; }
  acoplar(m: Motor | null) { this.motor = m; m?.acoplar(this.carga); this.lista = m ? [...m.fontes] : []; }
  comandar(c: ComandoPortador) {
    this.cmd = { ...this.cmd, ...c };
    if (c.cargaFracao !== undefined && this.carga) this.carga.frac = c.cargaFracao;
  }
  fontes() { return this.lista; }
  processar(saidas: Float32Array[], n: number, dt: number) {
    const m = this.motor, c = this.cmd as ComandoPortador & Record<string, unknown>;
    if (m) {
      m.comandar({ ...c, acelerador: c.pedal ?? 0, ignicao: c.ignicao !== false, partida: false, v: 0 } as ComandoMotor);
      m.processar(saidas, n);
    }
    const k = this.cinematica;
    if (c.velocidadeFixa != null) k.v = c.velocidadeFixa as number;
    k.s += k.v * n * dt;
  }
  telemetria(): TelemetriaPortador {
    const t = this.motor ? this.motor.telemetria() : null;
    return { ...(t || {}), v: this.cinematica.v, s: this.cinematica.s, rpmEixo: t ? t.rpm : 0, torqueCarga: this.carga && this.motor ? this.carga.torque(this.motor.eixo.omega) : 0, cargaFracao: this.carga?.frac ?? 0 };
  }
}
