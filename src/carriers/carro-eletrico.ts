// Portador carro elétrico (ELETRICO.md 4.3, decisão 5): redução fixa, regeneração, pneus e aero do CENA 4.1 ligados,
// 1 ou 2 motores (Tesla AWD: traseiro + dianteiro com presets diferentes). Não reusa o `CarroLegado` (aquele é o câmbio
// de dentro do EngineDSP); o trólebus é este portador com o corpo de ônibus (12 × 2,5 × 3,3 m, 6 pneus, os braços do
// trole).
//
// Dinâmica: m·dv/dt = T·i·η/r_w − F_res, F_res = ½ρC_dA·v² + C_rr·m·g + m·g·sen θ. Quem integra é o motor (decisão
// 1.1.5 do CENA): o 1º motor recebe a `Carga` do carro inteiro (resistência refletida menos o torque do 2º motor, e a
// inércia 1,06·m·r_w²/i²); o 2º motor anda preso a ele (ω imposta), com o torque dele entrando na carga do 1º. Aderência
// limitada a 0,75 g (controle de tração corta o pedal). `velocidadeFixa`: ω = v·i/r_w (o dinamômetro de rolo do
// CarroLegado). Freio: regeneração até v_regen,min, depois atrito (mudo).
import type { FonteSonora, Carga, Vec3 } from '../scene/tipos';
import type { Portador, Corpo, Cinematica, ComandoPortador, TelemetriaPortador, Motor, FamiliaMotor } from './tipos';
import { COMPAT, validarCompat } from './compat';
import { CORPO_CARRO } from './carro';
import { FonteRuido, FonteAero, Ramo, polo1 } from './ruido';
import { Bq, fatorPotenciaDir } from '../scene/filtros';
import { RHO } from '../scene/constantes';
import type { MotorEletrico } from '../engines/eletrico/motor';
import type { ComandoEletrico } from '../engines/eletrico/dsp';

const G = 9.81;
const V_REF_PNEU = 80 / 3.6;

/**
 * Pneu (CENA 4.1): pico de 1/3 de oitava em 800–1250 Hz, −10 dB em 250 Hz e 4 kHz (passa-banda em 1 kHz com Q 0,8: duas
 * oitavas para cada lado dão −10 dB), modulação lenta pela textura (±1,5 dB); L_W 95 dB(A) por roda a 80 km/h, n 3,5.
 */
export class FontePneu extends FonteRuido {
  constructor(fs: number, lw: number, semente: number) {
    super(fs, { lw, n: 3.5, vRef: V_REF_PNEU, refDist: 7.5, modLenta: 1.5 }, semente);
    this.ramos = [new Ramo(semente, [new Bq()])];
  }
  montar(_v: number) { this.ramos[0].bq[0].bp(this.fs, 1000, 0.8); }
}

/** braços do trole (trólebus): tom eólio 0,2·v/d (d 0,03 m: 0 a 130 Hz até 70 km/h), Q 4, fraco */
export class FonteTrole extends FonteRuido {
  constructor(fs: number, semente: number) {
    super(fs, { lw: 82, n: 6, vRef: 50 / 3.6, refDist: 7.5, modLenta: 1 }, semente);
    this.ramos = [new Ramo(semente, [new Bq()], 0, 1), new Ramo(semente + 1, [new Bq(), new Bq()], 0, 0.3)];
  }
  montar(v: number) {
    this.ramos[0].bq[0].bp(this.fs, Math.max(5, (0.2 * v) / 0.03), 4);
    polo1(this.ramos[1].bq[0], this.fs, 300, 'hp'); polo1(this.ramos[1].bq[1], this.fs, 3000, 'lp');
  }
}

/** corpo do ônibus (trólebus): 12 × 2,5 × 3,3 m, piso 0,3, casca 15 kg/m², habitáculo 55 Hz (lei da massa) */
export const CORPO_ONIBUS: Corpo = {
  segmentos: [{ comprimento: 12, vao: 0, altura: 3.3, largura: 2.5, zPiso: 0.3 }], comprimento: 12, nariz: 0, cauda: 0,
  areaFrontal: 7.5, cd: 0.6, cpNariz: 0.08, massaSuperficial: 15, fCabine: 55,
};

export interface ConfigCarroEletrico {
  massa: number; CdA: number; Crr: number; rw: number;
  corpo?: 'carro' | 'onibus'; pneus?: number; trole?: boolean;
  /** inclinação da via (fração: 0,03 = 3%) e massa extra (reboque, lotação) */
  inclinacao?: number; massaExtra?: number;
  aderencia?: number;
  /** liga os pneus e o aero (padrão true: decisão 5; a página tem a chave para ouvir o trem de força sozinho) */
  pneusAero?: boolean;
  semente?: number;
}

export class CarroEletrico implements Portador {
  readonly tipo = 'carro' as const;
  readonly compat: readonly FamiliaMotor[] = COMPAT.carro;
  corpo: Corpo;
  cinematica: Cinematica = { s: 0, v: 0, a: 0, rumo: 0 };
  cfg: ConfigCarroEletrico;
  fs: number;
  motores: MotorEletrico[] = [];
  i = 9; eta = 0.97;
  cmd: ComandoPortador = { pedal: 0, ignicao: true };
  private lista: FonteSonora[] = [];
  private nMotor: number[] = [];
  private proprias: { f: FonteSonora; g: FonteRuido }[] = [];
  private canaisM: Float32Array[][] = [];
  private vAnt = 0;
  re = false;
  carga: Carga;

  constructor(fs: number, cfg: ConfigCarroEletrico) {
    this.fs = fs; this.cfg = { aderencia: 0.75, pneusAero: true, ...cfg };
    const onibus = cfg.corpo === 'onibus';
    this.corpo = onibus ? CORPO_ONIBUS : CORPO_CARRO;
    const c = this.cfg, L = this.corpo.comprimento, W = this.corpo.segmentos[0].largura;
    let sem = (c.semente ?? 0xca7e) >>> 0;
    const prox = () => (sem = (sem + 0x9e3779b9) >>> 0);
    const omni = { tabela: [0, 0, 0, 0, 0, 0, 0] as const, eixo: [1, 0, 0] as Vec3, expConv: 2 };
    // pneus: 4 no carro (eixos a ±1,4 m), 6 no ônibus (dianteiro e eixo duplo traseiro), L_W +3 dB por roda no ônibus
    const nP = c.pneus ?? (onibus ? 6 : 4);
    const xs = nP === 6 ? [L / 2 - 2.6, L / 2 - 2.6, -L / 2 + 3.2, -L / 2 + 3.2, -L / 2 + 3.2, -L / 2 + 3.2] : [1.4, 1.4, -1.4, -1.4];
    const ys = nP === 6 ? [W / 2 - 0.2, -W / 2 + 0.2, W / 2 - 0.2, -W / 2 + 0.2, W / 2 - 0.5, -W / 2 + 0.5] : [W / 2 - 0.15, -W / 2 + 0.15, W / 2 - 0.15, -W / 2 + 0.15];
    if (c.pneusAero !== false) {
      for (let k = 0; k < nP; k++) this.propria({ id: `pneu.${k}`, tipo: 'rolamento', pos: [xs[k], ys[k], 0.02], hCorpo: 0.02, dir: omni, refDist: 7.5, dentro: false }, new FontePneu(fs, onibus ? 98 : 95, prox()));
      // aero: para-brisa e retrovisores (CENA 4.1 e 2.7): 80 dB(A) a 80 km/h, n 6
      this.propria({ id: 'aero', tipo: 'aero', pos: onibus ? [L / 2 - 0.3, 0, 2.6] : [0.8, 0, 1.0], dir: omni, refDist: 7.5, dentro: false },
        new FonteAero(fs, { lw: onibus ? 86 : 80, n: 6, vRef: V_REF_PNEU, refDist: 7.5 }, prox(), 500));
    }
    if (c.trole) this.propria({ id: 'trole', tipo: 'pantografo', pos: [-1, 0, 4.0], dir: omni, refDist: 7.5, dentro: false }, new FonteTrole(fs, prox()));
    for (const p of this.proprias) { p.g.calibrar(); p.g.gCal /= Math.sqrt(fatorPotenciaDir(p.f.dir.tabela)); }
    const self = this;
    this.carga = {
      inercia: 0,
      torque(w: number) { return self.torqueCarga(w); },
    };
    this.atualizarLista();
  }

  private propria(f: FonteSonora, g: FonteRuido) { this.proprias.push({ f, g }); }

  private massa() { return this.cfg.massa + (this.cfg.massaExtra ?? 0); }
  /** força resistente (N) a v (m/s), positiva contra o movimento */
  forcaResistente(v: number) {
    const c = this.cfg, m = this.massa(), va = Math.abs(v);
    const roll = va > 0.05 ? c.Crr * m * G : c.Crr * m * G * (va / 0.05);
    const atrito = this.cmd.freio && va > 0.05 && va <= this.vRegenMin() ? this.cmd.freio * 0.8 * m * G : 0;
    return 0.5 * RHO * c.CdA * va * va + roll + atrito + m * G * Math.sin(Math.atan(c.inclinacao ?? 0)) * (this.re ? -1 : 1);
  }
  private vRegenMin() { return this.motores[0]?.p.vRegenMin ?? 5 / 3.6; }
  /** carga do 1º motor: o carro inteiro, menos o torque do 2º (que anda preso a ele) */
  private torqueCarga(w: number) {
    const v = (w * this.cfg.rw) / this.i;
    const T1 = this.motores[0] ? this.motores[0].eixo.torque : 0, T2 = this.motores[1] ? this.motores[1].eixo.torque : 0;
    // perda da engrenagem (1 − η)·|T| sempre contra o movimento: na regeneração ela também freia
    const perda = w > 0 ? (1 - this.eta) * (Math.abs(T1) + Math.abs(T2)) : 0;
    return (this.forcaResistente(v) * this.cfg.rw) / this.i + perda - T2;
  }

  acoplar(motor: Motor | null) {
    validarCompat('carro', motor);
    if (motor && motor.familia !== 'eletrico') throw new Error('CarroEletrico: o motor é elétrico (o pistão e o diesel usam o CarroLegado)');
    this.motores = motor ? [motor as MotorEletrico] : [];
    this.montarMotores();
  }
  /** 2º motor (AWD): mesma redução (o Tesla tem as duas iguais), ω presa à do 1º */
  acoplarSegundo(motor: MotorEletrico | null) {
    this.motores = this.motores.slice(0, 1);
    if (motor) this.motores.push(motor);
    this.montarMotores();
  }
  private montarMotores() {
    const m0 = this.motores[0];
    if (m0) {
      const est = m0.p.reducao.estagios;
      this.i = est.reduce((a, s) => (a * s.Zc) / s.Zp, 1) || 1;
      this.eta = m0.p.reducao.eta || 0.97;
      this.carga.inercia = (1.06 * this.massa() * this.cfg.rw * this.cfg.rw) / (this.i * this.i);
      m0.acoplar(this.carga);
      this.motores[1]?.acoplar(null);
    }
    this.canaisM = this.motores.map((m) => m.fontes.map(() => new Float32Array(4096)));
    this.atualizarLista();
  }
  private atualizarLista() {
    // fontes dos motores (posições do preset já no referencial do carro), depois as próprias
    const fm = this.motores.flatMap((m, k) => m.fontes.map((f) => ({ ...f, id: k === 0 ? f.id : `${f.id}.d` })));
    this.nMotor = this.motores.map((m) => m.fontes.length);
    this.lista = [...fm, ...this.proprias.map((p) => p.f)];
  }
  /** inclinação (fração) e massa extra (kg): os chips de carga da página */
  definirCarga(inclinacao: number, massaExtra = 0) {
    this.cfg.inclinacao = inclinacao; this.cfg.massaExtra = massaExtra;
    if (this.motores[0]) this.carga.inercia = (1.06 * this.massa() * this.cfg.rw * this.cfg.rw) / (this.i * this.i);
  }
  comandar(c: ComandoPortador) {
    this.cmd = { ...this.cmd, ...c };
    if (c.marcha !== undefined) this.re = c.marcha === -1;
    // velocidade imposta: o carro (e o motor preso a ele) vai direto para ela
    if (c.velocidadeFixa != null) this.cinematica.v = c.velocidadeFixa;
  }
  fontes(): readonly FonteSonora[] { return this.lista; }

  processar(saidas: Float32Array[], n: number, dt: number) {
    const k = this.cinematica, c = this.cmd, M = this.motores, cf = this.cfg;
    const vf = c.velocidadeFixa;
    if (M.length) {
      const wImp = vf != null ? (Math.abs(vf) * this.i) / cf.rw : null;
      const w0 = M[0].eixo.omega;
      // controle de tração: a força nas rodas não passa de μ·m·g
      const Fmax = (cf.aderencia ?? 0.75) * this.massa() * G;
      let Tdisp = 0;
      for (const m of M) Tdisp += Math.min(m.p.Tn, m.p.Pmax / Math.max(w0, 1e-3));
      const aMax = Tdisp > 0 ? (Fmax * cf.rw) / (this.i * this.eta * Tdisp) : 1;
      const ext = c as ComandoPortador & Partial<ComandoEletrico>;
      const base: ComandoEletrico = {
        acelerador: Math.min(c.pedal ?? 0, aMax), ignicao: c.ignicao !== false, partida: false,
        freio: Math.min(c.freio ?? 0, 1), v: Math.abs(k.v), re: this.re,
        ...(ext.modulacao !== undefined ? { modulacao: ext.modulacao } : {}), ...(ext.avas !== undefined ? { avas: ext.avas } : {}),
      };
      M[0].comandar({ ...base, omegaImposta: wImp } as ComandoEletrico);
      M[1]?.comandar({ ...base, omegaImposta: wImp ?? w0, avas: 'desligado' } as ComandoEletrico);
      let o = 0;
      for (let j = 0; j < M.length; j++) {
        const cm = this.canaisM[j];
        M[j].processar(cm, n);
        for (let q = 0; q < this.nMotor[j]; q++) { const dst = saidas[o + q], src = cm[q]; for (let s = 0; s < n; s++) dst[s] = src[s]; }
        o += this.nMotor[j];
      }
      k.v = vf != null ? vf : ((this.re ? -1 : 1) * M[0].eixo.omega * cf.rw) / this.i;
    } else if (vf != null) k.v = vf;
    // pneus, aero, trole
    const o0 = this.nMotor.reduce((a, b) => a + b, 0);
    for (let j = 0; j < this.proprias.length; j++) { const g = this.proprias[j].g; g.ajustar(k.v); g.preencher(saidas[o0 + j], n); }
    k.a = (k.v - this.vAnt) / (n * dt); this.vAnt = k.v;
    k.s += k.v * n * dt;
  }

  telemetria(): TelemetriaPortador {
    const m = this.motores[0], t = m ? m.telemetria() : null;
    return {
      ...(t || {}), v: this.cinematica.v, s: this.cinematica.s, rpmEixo: t ? t.rpm : 0, torqueCarga: m ? this.torqueCarga(m.eixo.omega) : 0,
      torque2: this.motores[1]?.eixo.torque ?? 0, i: this.i,
    };
  }
}
