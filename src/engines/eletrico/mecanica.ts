// Mecânica (ELETRICO.md 1.3): engrenamento da redução (com bandas laterais, chocalho em torque ≈ 0, clique na mudança de
// flanco e rolamentos), ventilação (forçada ou autoventilada), escovas e comutador (tons e faiscamento), e a hélice do
// drone (BPF e harmônicos medidos no Mavic, ruído largo de pá). Linhas na lista do banco; ruídos com semente somados no
// canal em unidades relativas (o nível absoluto vem do kAbs da sonda, motor.ts).
import type { PresetEletrico } from './dsp';
import type { EstadoMaquina } from './maquina';
import type { ListaLinhas } from './linhas';
import { RNG } from '../../acoustics/rng';
import { Bq, rmsCadeia } from '../../scene/filtros';
import { SerieHarmonica, calibrarSerieA } from '../../carriers/base';
import { TAU, MEC, chave, I_VAZIO_CC } from './constantes';

/** ruído branco → cadeia de biquads, normalizado para RMS 1; ganho em rampa linear no bloco */
export class RuidoBanda {
  rng: RNG; bq: Bq[]; norm = 1; g = 0; g0 = 0;
  constructor(fs: number, semente: number, bq: Bq[]) { this.rng = new RNG(semente); this.bq = bq; this.norm = 1 / Math.max(1e-12, rmsCadeia(fs, bq, 1 / 3, false, 4)); }
  /** RMS pedido no fim do bloco */
  alvo(rms: number) { this.g0 = this.g; this.g = rms * this.norm; }
  /** soma n amostras; `pos`/`tot` situam o trecho no bloco (rampa) */
  processar(out: Float32Array, off: number, n: number, pos: number, tot: number, escala: number) {
    if (this.g === 0 && this.g0 === 0) return;
    const r = this.rng, b = this.bq, nb = b.length, g0 = this.g0 * escala, dg = ((this.g - this.g0) * escala) / tot;
    for (let k = 0; k < n; k++) {
      let x = r.bi();
      for (let j = 0; j < nb; j++) x = b[j].run(x);
      out[off + k] += (g0 + dg * (pos + k + 1)) * x;
    }
  }
}

const dB = (x: number) => Math.pow(10, x / 20);
const HARM_ENGR = [1, dB(-8), dB(-14), dB(-18)];

/**
 * Redução de engrenagens. Estágio j: pinhão de Z_p dentes a f_j (f_1 = f_rot; f_{j+1} = f_j·Z_p/Z_c), engrenamento
 * Z_p·f_j e harmônicos 2–4 (−8, −14, −18 dB), bandas laterais ±f_j e ±f_{j+1} a −10 dB; amplitude ∝ T·n (6 dB por
 * duplicação de torque); o 2º estágio a −4 dB do 1º (≈). Em |T| < 3% de T_n o engrenamento some e entra o chocalho
 * (impactos no bp de 1–4 kHz a cada volta do pinhão, −15 dB); T cruzando zero dá o clique de flanco (bp 800 Hz, 45 ms,
 * −10 dB); rolamentos: largo de 2–10 kHz, ∝ n, −20 dB.
 */
export class Reducao {
  p: PresetEletrico; fs: number;
  i: number; f: Float64Array;
  rol: RuidoBanda; choc: RuidoBanda; cliq: RuidoBanda;
  rng: RNG;
  // chocalho: envoltória de impactos
  faseC = 0; envC = 0; ampC = 0; kC: number; gChoc = 0; gChoc0 = 0; fChoc = 0;
  // clique de flanco
  sinalT = 0; cliqueRest = 0; nCliq: number;
  cargaMalha = 1;
  constructor(p: PresetEletrico, fs: number, semente: number) {
    this.p = p; this.fs = fs;
    this.i = p.reducao.estagios.reduce((a, s) => (a * s.Zc) / s.Zp, 1);
    this.f = new Float64Array(p.reducao.estagios.length + 1);
    this.rol = new RuidoBanda(fs, semente, [new Bq().hp(fs, 2000, 0.7071), new Bq().lp(fs, 10000, 0.7071)]);
    this.choc = new RuidoBanda(fs, semente + 1, [new Bq().bp(fs, 2000, 0.5)]);
    this.cliq = new RuidoBanda(fs, semente + 2, [new Bq().bp(fs, 800, 1)]);
    this.rng = new RNG(semente + 3);
    this.kC = Math.exp(-1 / (0.0015 * fs));
    this.nCliq = Math.round(0.045 * fs);
  }
  /** fração do engrenamento em carga (0 abaixo de 3% de T_n, 1 acima de 6%) */
  static malha(T: number, Tn: number) { const x = (Math.abs(T) / Tn - 0.03) / 0.03; return x <= 0 ? 0 : x >= 1 ? 1 : x; }
  linhas(e: EstadoMaquina, L: ListaLinhas, det: number, fBase: number) {
    const est = this.p.reducao.estagios, f = this.f;
    f[0] = e.frot * det;
    for (let j = 0; j < est.length; j++) f[j + 1] = (f[j] * est[j].Zp) / est[j].Zc;
    const malha = Reducao.malha(e.T, this.p.Tn);
    this.cargaMalha = malha;
    const nRel = (e.frot * det) / fBase;
    const aT = (Math.abs(e.T) / this.p.Tn) * nRel * malha;
    if (aT <= 0) return;
    for (let j = 0; j < est.length; j++) {
      const fm = est[j].Zp * f[j], a = aT * dB(-4 * j);
      for (let h = 1; h <= 4; h++) {
        const ah = a * HARM_ENGR[h - 1], fh = h * fm;
        L.por(chave(MEC.engren, j * 64 + h * 8), fh, ah);
        if (h <= 2) {
          L.por(chave(MEC.engren, j * 64 + h * 8 + 1), fh + f[j], ah * dB(-10)); L.por(chave(MEC.engren, j * 64 + h * 8 + 2), fh - f[j], ah * dB(-10));
          L.por(chave(MEC.engren, j * 64 + h * 8 + 3), fh + f[j + 1], ah * dB(-10)); L.por(chave(MEC.engren, j * 64 + h * 8 + 4), fh - f[j + 1], ah * dB(-10));
        }
      }
    }
  }
  /** níveis dos ruídos do bloco (chamar no início do bloco) */
  inicio(e: EstadoMaquina, det: number, fBase: number) {
    const nRel = (e.frot * det) / fBase;
    const ref = Math.SQRT1_2 * 1.2;   // RMS do engrenamento de referência (1º estágio, com harmônicos e laterais)
    this.rol.alvo(ref * dB(-20) * nRel);
    this.gChoc0 = this.gChoc; this.gChoc = ref * dB(-15) * nRel * (1 - Reducao.malha(e.T, this.p.Tn)) * (e.frot > 1 ? 1 : e.frot);
    this.fChoc = e.frot * det;
    // mudança de flanco: o torque troca de sinal (fora de ±2% de T_n)
    const s = e.T > 0.02 * this.p.Tn ? 1 : e.T < -0.02 * this.p.Tn ? -1 : 0;
    if (s !== 0 && this.sinalT !== 0 && s !== this.sinalT && e.frot > 1) this.cliqueRest = this.nCliq;
    if (s !== 0) this.sinalT = s;
    this.cliq.alvo(this.cliqueRest > 0 ? ref * dB(-10) * 2.5 : 0);
  }
  ruido(out: Float32Array, off: number, n: number, pos: number, tot: number, escala: number) {
    this.rol.processar(out, off, n, pos, tot, escala);
    // chocalho: impactos a cada volta do pinhão, amplitude aleatória (curtose alta)
    if (this.gChoc > 0 || this.gChoc0 > 0) {
      const r = this.choc.rng, b = this.choc.bq[0], nrm = this.choc.norm * escala * 2.2;
      const d = this.fChoc / this.fs;
      for (let k = 0; k < n; k++) {
        this.faseC += d;
        if (this.faseC >= 1) { this.faseC -= 1; this.envC = 0.5 + this.rng.next(); }
        this.envC *= this.kC;
        const g = this.gChoc0 + ((this.gChoc - this.gChoc0) * (pos + k + 1)) / tot;
        out[off + k] += g * nrm * this.envC * b.run(r.bi());
      }
    }
    if (this.cliqueRest > 0) {
      const m = Math.min(n, this.cliqueRest);
      const r = this.cliq.rng, b = this.cliq.bq[0], g = this.cliq.g * escala;
      for (let k = 0; k < m; k++) {
        const t = (this.nCliq - this.cliqueRest + k) / this.nCliq;
        out[off + k] += g * Math.sin(Math.PI * t) * b.run(r.bi());
      }
      this.cliqueRest -= m;
    }
  }
}

/**
 * Ventilação: BPF B_v·f_v + 3 harmônicos (κ 0,6) + ruído bp 1 kHz, como o `ventilador` do gerador (CENA 4.4).
 * Forçada: soprador de rotação fixa (2 polos na rede: 2950/3550 rpm) que sobe em ~1,5 s ao ligar; autoventilado: f_v = f_rot.
 * L_W ∝ n^5,5.
 */
export class Ventilador {
  p: PresetEletrico; fs: number;
  wv = 0; ruido: RuidoBanda;
  constructor(p: PresetEletrico, fs: number, semente: number) {
    this.p = p; this.fs = fs;
    this.ruido = new RuidoBanda(fs, semente, [new Bq().bp(fs, 1000, 0.7)]);
  }
  /** rotação de referência (Hz) do ventilador */
  fRef() { const v = this.p.ventilacao!; return v.forcada ? (v.rpm ?? 2950) / 60 : this.p.rpmBase / 60; }
  linhas(e: EstadoMaquina, L: ListaLinhas, det: number, dt: number, ligado: boolean) {
    const v = this.p.ventilacao!;
    let fv: number;
    if (v.forcada) { const alvo = ligado ? this.fRef() : 0; this.wv += (alvo - this.wv) * (1 - Math.exp(-dt / 1.5)); fv = this.wv; }
    else fv = e.frot * det;
    const nRel = fv / this.fRef();
    const a = Math.pow(Math.max(0, nRel), 2.75);
    this.ruido.alvo(a * 0.35);
    if (a <= 0) return;
    const fb = v.B * fv;
    for (let h = 1; h <= 4; h++) L.por(chave(MEC.ventilador, h), h * fb, a * Math.exp(-(h - 1) * 0.6));
  }
}

/**
 * Escovas e comutador (CC, universal): tons em Z_c·f_rot e 2Z_c·f_rot (−10 dB) ∝ I, e o faiscamento: largo de 2–10 kHz
 * modulado em Z_c·f_rot com profundidade 0,5, ∝ I^1,5, +6 dB com as escovas gastas.
 */
export class Escovas {
  p: PresetEletrico; fs: number;
  faisca: RuidoBanda; fase = 0; fMod = 0;
  constructor(p: PresetEletrico, fs: number, semente: number) {
    this.p = p; this.fs = fs;
    this.faisca = new RuidoBanda(fs, semente, [new Bq().hp(fs, 2000, 0.7071), new Bq().lp(fs, 10000, 0.7071)]);
  }
  linhas(e: EstadoMaquina, L: ListaLinhas, det: number, semTons = false) {
    const es = this.p.escovas!, fr = e.frot * det, Ie = Math.max(e.I, I_VAZIO_CC);
    this.fMod = es.Zc * fr;
    const gasto = 1 + es.desgaste;      // +6 dB com desgaste 1
    this.faisca.alvo(fr > 1 ? (this.p.faiscamento ?? 0.5) * Math.pow(Ie, 1.5) * gasto : 0);
    if (semTons || fr <= 0) return;
    L.por(chave(MEC.escova, 1), es.Zc * fr, Ie);
    L.por(chave(MEC.escova, 2), 2 * es.Zc * fr, Ie * dB(-10));
  }
  ruido(out: Float32Array, off: number, n: number, pos: number, tot: number, escala: number) {
    const R = this.faisca;
    if (R.g === 0 && R.g0 === 0) return;
    const r = R.rng, b = R.bq, g0 = R.g0 * escala, dg = ((R.g - R.g0) * escala) / tot, d = this.fMod / this.fs;
    for (let k = 0; k < n; k++) {
      let x = r.bi();
      x = b[0].run(x); x = b[1].run(x);
      this.fase += d; if (this.fase >= 1) this.fase -= 1;
      out[off + k] += (g0 + dg * (pos + k + 1)) * (1 + 0.5 * Math.sin(TAU * this.fase)) * x;
    }
  }
}

/** harmônicos da BPF medidos no Mavic pairado (3.6), do 1º ao 12º (o 12º extrapolado), dB */
export const HARM_MAVIC = [0, -6, -7, -6, -10, -8, -13, -19, -18, -18, -24, -26];

/**
 * Hélice de drone (1.3): BPF = B·f_rot e harmônicos até o 12º com a forma medida, a 1ª ordem do eixo (−18 dB, o
 * desbalanceamento), e o ruído largo de pá plano de 400 Hz a 12 kHz. L_W ∝ n^5 (dipolo de carga: 50·log n). A forma é
 * normalizada em A por `calibrarSerieA` (a mesma dos geradores dos portadores, carriers/base.ts).
 */
export class Helice {
  p: PresetEletrico; fs: number;
  serie: SerieHarmonica; rel: Float64Array; largo: RuidoBanda;
  constructor(p: PresetEletrico, fs: number, semente: number) {
    this.p = p; this.fs = fs;
    const H = p.helice!.harmonicos ?? HARM_MAVIC;
    this.serie = new SerieHarmonica(fs, H.length);
    this.rel = new Float64Array(H.map((x) => dB(x)));
    this.largo = new RuidoBanda(fs, semente, [new Bq().hp(fs, 400, 0.7071), new Bq().lp(fs, 12000, 0.7071)]);
  }
  linhas(e: EstadoMaquina, L: ListaLinhas, det: number, fRef: number) {
    const h = this.p.helice!, fr = e.frot * det, s = this.serie;
    const nRel = fr / fRef, a = Math.pow(Math.max(0, nRel), 2.5);
    s.f0 = h.B * fr;
    calibrarSerieA(s, this.rel, a);
    // (liquidificador: a cavitação da jarra cresce com a carga, +10 dB com gelo)
    const kc = h.largoCarga ? 1 + 2.2 * Math.max(0, e.I - 0.3) : 1;
    this.largo.alvo(a * kc * dB(h.largoDb ?? -3));
    if (a <= 0) return;
    for (let k = 0; k < s.a.length; k++) L.por(chave(MEC.helice, k + 1), (k + 1) * s.f0, s.a[k] * Math.SQRT2);
    L.por(chave(MEC.helice, 0), fr, s.a[0] * Math.SQRT2 * dB(-18));
  }
}
