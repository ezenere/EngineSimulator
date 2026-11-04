// Fontes auxiliares do vapor (docs/VAPOR.md 1.6, 1.7, 2.1–2.3): bomba de ar Westinghouse, injetor, válvula de
// segurança, torneiras dos cilindros e vazamentos, bielas (folga e rolar), soprador, queimador (Stanley),
// engrenagens (Shay, trator) e correias com os cliques dos dashpots (Corliss).
//
// Cada gerador devolve um sinal "unitário" (escala interna); o `VaporDSP` multiplica pelo ganho que a sonda de nível
// (motor.ts → prepararMotorVapor) acha na condição de referência de 4.6, para a fonte dar o `L_W` dB(A) da tabela.
// Ritmos com `RNG` de semente: render offline determinístico.
import { Biquad, RNG, onePole } from '../../acoustics';

/** ruído uniforme por uma cadeia de biquads (sem alocação no laço) */
export class Ruido {
  rng: RNG; f: Biquad[];
  constructor(semente: number, f: Biquad[]) { this.rng = new RNG(semente); this.f = f; }
  amostra() { let x = this.rng.next() * 2 - 1; const f = this.f; for (let i = 0; i < f.length; i++) x = f[i].run(x); return x; }
}
const bp = (fs: number, f: number, q: number) => new Biquad().bp(fs, Math.min(0.45 * fs, f), q);
const lp = (fs: number, f: number, q = 0.7071) => new Biquad().lp(fs, Math.min(0.45 * fs, f), q);
const hp = (fs: number, f: number, q = 0.7071) => new Biquad().hp(fs, Math.min(0.45 * fs, f), q);

/**
 * Bomba de ar Westinghouse (cross-compound, 8½"): 50–90 cursos/min enquanto carrega o encanamento (60 s depois de
 * parar e depois de cada freada), depois intermitente pelo governador da bomba (10–20 s a cada 1–3 min). Por curso:
 * o escape de vapor ("thump", 60–120 ms, passa-baixa 600 Hz), o escape de ar do 1º estágio ("psh", 40–80 ms,
 * 1–4 kHz) e a batida de inversão (clique de 2 ms, 500–3000 Hz). O ritmo varia ±5% por curso.
 */
export class BombaAr {
  fs: number; periodo: number; rng: RNG;
  thump: Ruido; psh: Ruido; clique: Ruido;
  t = 0; dur = 1; ligada = false; carga = 60; pausa = 30;
  eT = 0; eP = 0; eC = 0; kT: number; kP: number; kC: number;
  /** forçada pela página */
  forcada = false;
  constructor(fs: number, cursosPorMin: number, semente: number) {
    this.fs = fs; this.periodo = 60 / cursosPorMin; this.rng = new RNG(semente);
    this.thump = new Ruido(semente + 1, [lp(fs, 600), lp(fs, 600)]);
    this.psh = new Ruido(semente + 2, [bp(fs, 2200, 0.6)]);
    this.clique = new Ruido(semente + 3, [bp(fs, 1500, 1.2)]);
    this.kT = Math.exp(-1 / (0.035 * fs)); this.kP = Math.exp(-1 / (0.025 * fs)); this.kC = Math.exp(-1 / (0.0008 * fs));
    this.dur = this.periodo;
  }
  /** pedido de carga (parou, freou): o encanamento esvazia e a bomba trabalha `s` segundos */
  carregar(s: number) { this.carga = Math.max(this.carga, s); }
  controle(dt: number, auto: boolean) {
    if (!auto) { this.ligada = this.forcada; return; }
    if (this.carga > 0) { this.carga -= dt; this.ligada = true; return; }
    // governador da bomba: ciclos curtos para repor os vazamentos do encanamento
    this.pausa -= dt;
    if (this.pausa <= 0) { this.ligada = !this.ligada; this.pausa = this.ligada ? 10 + 10 * this.rng.next() : 60 + 120 * this.rng.next(); }
  }
  amostra() {
    if (this.ligada) {
      // relógio do curso: cada curso começa com o escape de vapor e a batida de inversão; o ar sai a 35% do curso
      const t0 = this.t;
      this.t += 1 / (this.dur * this.fs);
      if (t0 < 0.35 && this.t >= 0.35) this.eP = 1;
      if (this.t >= 1) { this.t -= 1; this.eT = 1; this.eC = 1; this.dur = this.periodo * (1 + 0.05 * (this.rng.next() * 2 - 1)); }
    }
    if (this.eT < 1e-5 && this.eP < 1e-5 && this.eC < 1e-5) return 0;
    const s = 6 * this.eT * this.thump.amostra() + 0.5 * this.eP * this.psh.amostra() + 0.6 * this.eC * this.clique.amostra();
    this.eT *= this.kT; this.eP *= this.kP; this.eC *= this.kC;
    return s;
  }
  get consumo() { return this.ligada ? 0.07 : 0; }
}

/**
 * Injetor: vapor e água num cone; chiado largo 2–6 kHz com um assobio (Q 6 em 3 kHz) que afina ao pegar (sobe 20%
 * em 1 s) e um gorgolejo no transbordo (pulsos 5–10/s, 300–800 Hz) nos primeiros 2–3 s. No automático liga pelo nível
 * de água (20–60 s a cada 2–5 min com a caldeira trabalhando).
 */
export class Injetor {
  fs: number; chiado: Ruido; assobio: Biquad; gorg: Ruido; rng: RNG;
  ligado = false; t = 0; f = 2500; eG = 0; tG = 0; kG: number;
  nivel = 0.9;
  constructor(fs: number, semente: number) {
    this.fs = fs; this.rng = new RNG(semente);
    this.chiado = new Ruido(semente + 1, [hp(fs, 2000), lp(fs, 6000)]);
    this.assobio = bp(fs, 2500, 6);
    this.gorg = new Ruido(semente + 2, [bp(fs, 550, 1)]);
    this.kG = Math.exp(-1 / (0.02 * fs));
  }
  /** a cada bloco: `evap` kg/s, `alim` kg/s do injetor, massa de água `mAgua` */
  controle(dt: number, modo: boolean | 'auto', evap: number, alim: number, mAgua: number) {
    const antes = this.ligado;
    this.nivel += ((this.ligado ? alim : 0) - evap) * dt / mAgua;
    this.nivel = Math.max(0, Math.min(1, this.nivel));
    if (modo === 'auto') { if (!this.ligado && this.nivel < 0.85) this.ligado = true; else if (this.ligado && this.nivel > 0.97) this.ligado = false; }
    else this.ligado = modo;
    if (this.ligado && !antes) this.t = 0;
    if (this.ligado) {
      this.t += dt;
      this.f = 3000 * (0.83 + 0.17 * (1 - Math.exp(-this.t / 0.35)));
      this.assobio.bp(this.fs, this.f, 6);
    }
  }
  amostra() {
    if (!this.ligado) return 0;
    const ch = this.chiado.amostra(), x = this.chiado.rng.next() * 2 - 1;
    let s = ch + 0.5 * this.assobio.run(x);
    if (this.t < 2.8) {
      this.tG -= 1 / this.fs;
      if (this.tG <= 0) { this.eG = 1; this.tG = 0.1 + 0.1 * this.rng.next(); }
      s += 1.5 * this.eG * this.gorg.amostra() * (1 - this.t / 2.8);
      this.eG *= this.kG;
    }
    return s;
  }
}

/**
 * Válvula de segurança: jato anular engasgado (fenda de 3–5 mm, 480 m/s) de 1–2 kg/s por válvula; rugido largo de
 * 300 Hz a 8 kHz, plano até 2 kHz e −3 dB/oitava acima, ataque de 50 ms com o "pop" e fechamento seco. Abre em
 * p_nom + 0,3 bar, fecha em p_nom − 0,4 (histerese do blowdown).
 */
export class Seguranca {
  fs: number; r: Ruido; lpk: number; lpS = 0; aberta = false; env = 0; pop = 0;
  kA: number; kF: number; kPop: number;
  lpB = new Biquad();
  constructor(fs: number, semente: number) {
    this.fs = fs; this.r = new Ruido(semente, [hp(fs, 300, 0.6)]); this.lpk = onePole(fs, 2000); this.lpB.lp(fs, 10000, 0.7071);
    this.kA = onePole(fs, 1 / (2 * Math.PI * 0.05)); this.kF = onePole(fs, 1 / (2 * Math.PI * 0.012)); this.kPop = Math.exp(-1 / (0.08 * fs));
  }
  controle(p: number, pNom: number) {
    if (!this.aberta && p >= pNom + 0.3) { this.aberta = true; this.pop = 0.4; }
    else if (this.aberta && p <= pNom - 0.4) this.aberta = false;
  }
  amostra() {
    const alvo = this.aberta ? 1 : 0;
    this.env += (alvo > this.env ? this.kA : this.kF) * (alvo - this.env);
    if (this.env < 1e-5 && this.pop < 1e-5) return 0;
    const x = this.r.amostra();
    this.lpS += this.lpk * (x - this.lpS);
    const y = this.lpB.run(this.lpS + 0.3 * x);
    const s = y * (this.env * (1 + this.pop));
    this.pop *= this.kPop;
    return s;
  }
}

/**
 * Torneiras dos cilindros e vazamentos de um lado da máquina (canal `cilindro.e` / `cilindro.d`). Torneiras: os drenos
 * abertos sopram em cada extremidade enquanto ela tem vapor (admissão e expansão): 4 sopros por volta em fase com as
 * admissões, ruído 1–5 kHz ∝ vazão, com pulsos de água (300–800 Hz) nas primeiras voltas. Vazamentos: gaxetas e
 * juntas, ruído 1–8 kHz (passa-alta 800 + polo em 5 kHz) ∝ p_cal, e o "pinga-pinga" (pulsos de 2 ms, 2–4 kHz, 2–5/s).
 */
export class Torneiras {
  fs: number; hiss: Ruido; agua: Ruido; vaz: Ruido; pinga: Ruido; rng: RNG;
  env = 0; kEnv: number; eA = 0; tA = 0; kA: number; eP = 0; tP = 0.3; kP: number; vzLp = 0; kVz: number;
  /** fração de água nos cilindros (cai com as voltas depois de abrir) */
  aguaFrac = 0;
  constructor(fs: number, semente: number) {
    this.fs = fs; this.rng = new RNG(semente);
    this.hiss = new Ruido(semente + 1, [hp(fs, 1000), lp(fs, 5000)]);
    this.agua = new Ruido(semente + 2, [bp(fs, 550, 1)]);
    this.vaz = new Ruido(semente + 3, [hp(fs, 800), lp(fs, 7000)]);
    this.pinga = new Ruido(semente + 4, [bp(fs, 3000, 2)]);
    this.kEnv = onePole(fs, 300); this.kA = Math.exp(-1 / (0.012 * fs)); this.kP = Math.exp(-1 / (0.002 * fs)); this.kVz = onePole(fs, 5000);
  }
  /** `vazao` = soma da vazão relativa das extremidades deste lado com as torneiras abertas (0 fechadas) */
  torneira(vazao: number) {
    this.env += this.kEnv * (vazao - this.env);
    if (this.env < 1e-5) return 0;
    let s = this.env * this.hiss.amostra();
    if (this.aguaFrac > 0.01) {
      this.tA -= 1 / this.fs;
      if (this.tA <= 0) { this.eA = 1; this.tA = 0.02 + 0.05 * this.rng.next(); }
      s += 2 * this.aguaFrac * this.env * this.eA * this.agua.amostra();
      this.eA *= this.kA;
    }
    return s;
  }
  /** vazamentos, `pRel` = p_cal/p_nom */
  vazamento(pRel: number) {
    const x = this.vaz.amostra();
    this.vzLp += this.kVz * (x - this.vzLp);
    let s = pRel * this.vzLp;
    this.tP -= 1 / this.fs;
    if (this.tP <= 0) { this.eP = 1; this.tP = 0.2 + 0.3 * this.rng.next(); }
    s += 0.8 * this.eP * this.pinga.amostra();
    this.eP *= this.kP;
    return s;
  }
}

/**
 * Bielas e cruzetas de um lado (1.7): a cada inversão de força na biela a folga dos mancais fecha com um impacto de
 * 1–3 ms (banda 300–3000 Hz: passa-banda Q 2 em 900 Hz mais um clique de ruído), amplitude ∝ folga·|ΔF|^0,5; mais o
 * rolar das bielas de acoplamento, um "whoosh" metálico 1/volta (ruído 500–2000 Hz × (1 + 0,5·cos θ)). Nos Corliss,
 * os cliques secos dos dashpots (2–3 ms, 1–4 kHz) a cada corte da admissão entram neste canal.
 */
export class Bielas {
  fs: number; ress: Biquad; clique: Ruido; rolar: Ruido; dash: Ruido;
  ex = 0; kEx: number; eD = 0; kD: number; lpS: Biquad;
  constructor(fs: number, semente: number) {
    this.fs = fs;
    this.ress = bp(fs, 900, 2);
    this.clique = new Ruido(semente + 1, [bp(fs, 1400, 0.8)]);
    this.rolar = new Ruido(semente + 2, [hp(fs, 500), lp(fs, 2000)]);
    this.dash = new Ruido(semente + 3, [bp(fs, 2200, 1.5)]);
    this.kEx = Math.exp(-1 / (0.0015 * this.fs)); this.kD = Math.exp(-1 / (0.0012 * this.fs));
    this.lpS = lp(fs, 7000);
  }
  /** impacto (amplitude relativa) */
  bater(a: number) { this.ex = Math.max(this.ex, a); }
  dashpot(a: number) { this.eD = Math.max(this.eD, a); }
  /** `cosTheta`: cosseno do ângulo da manivela deste lado */
  amostra(rolarAmp: number, cosTheta: number) {
    const c = this.clique.amostra();
    let s = this.ress.run(this.ex * c * 4) + 0.5 * this.ex * c;
    this.ex *= this.kEx;
    s += rolarAmp * (1 + 0.5 * cosTheta) * this.rolar.amostra();
    if (this.eD > 1e-4) { s += this.eD * this.dash.amostra() * 3; this.eD *= this.kD; }
    // (o ferro do mancal e da cruzeta não irradia acima de ~8 kHz: sem este corte o clique punha o agudo acima de
    // 16 kHz a −55 dB do total, e o teste de aliasing de 7.1 pede < −60)
    return this.lpS.run(s);
  }
}

/** soprador (blower): jato de vapor no bico com o regulador fechado, sopro contínuo 300–2000 Hz pela chaminé */
export class Soprador {
  r: Ruido; env = 0; k: number;
  constructor(fs: number, semente: number) { this.r = new Ruido(semente, [hp(fs, 300), lp(fs, 2000)]); this.k = onePole(fs, 3); }
  amostra(ligado: number) { this.env += this.k * (ligado - this.env); return this.env < 1e-5 ? 0 : this.env * this.r.amostra(); }
}

/** queimador do Stanley: maçarico de querosene, ruído 100–600 Hz com corcova em 200 Hz, mais o assobio do vaporizador */
export class Queimador {
  r: Ruido; corcova: Biquad; ass: Ruido;
  constructor(fs: number, semente: number) {
    this.r = new Ruido(semente, [hp(fs, 100), lp(fs, 600)]); this.corcova = bp(fs, 200, 0.9);
    this.ass = new Ruido(semente + 5, [bp(fs, 3000, 4)]);
  }
  /** fogo 0..1: 85 dB(A) no piloto, 95 com o fogo alto (amplitude 0,32 → 1) */
  amostra(fogo: number) { const x = this.r.amostra(); return (0.32 + 0.68 * fogo) * (x + 1.5 * this.corcova.run(x) + 0.05 * this.ass.amostra()); }
}

/**
 * Engrenagens de dentes retos (Shay, trator): tom de passagem de dente f = rotação da manivela × z, harmônicos até 1 kHz,
 * nível ∝ torque (com um piso), fase presa ao ângulo da manivela.
 */
export class Engrenagens {
  fs: number; z: number; r: Ruido;
  constructor(fs: number, z: number, semente: number) { this.fs = fs; this.z = z; this.r = new Ruido(semente, [bp(fs, 700, 0.7)]); }
  amostra(thetaManivela: number, fManivela: number, carga: number) {
    const ph = thetaManivela * this.z, f = Math.abs(fManivela) * this.z;
    let s = 0;
    for (let h = 1; h <= 4; h++) if (h * f < 1000) s += Math.sin(h * ph) / h;
    return (0.25 + 0.75 * carga) * (s + 0.15 * this.r.amostra());
  }
}

/**
 * Correias e eixo de transmissão (Corliss): ruído largo 200–2000 Hz com o "tapa" da emenda da correia 1/volta da polia
 * (f = f_rev·D_volante/D_polia).
 */
export class Correias {
  fs: number; r: Ruido; tapa: Ruido; fase = 0; e = 0; k: number;
  constructor(fs: number, semente: number) { this.fs = fs; this.r = new Ruido(semente, [hp(fs, 200), lp(fs, 2000)]); this.tapa = new Ruido(semente + 1, [bp(fs, 400, 1)]); this.k = Math.exp(-1 / (0.006 * fs)); }
  amostra(fPolia: number) {
    this.fase += fPolia / this.fs;
    if (this.fase >= 1) { this.fase -= 1; this.e = 1; }
    const s = this.r.amostra() * Math.min(1, fPolia / 3) + 2 * this.e * this.tapa.amostra();
    this.e *= this.k;
    return s;
  }
}
