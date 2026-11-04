// Rede de guias de onda do escapamento: tubos, junções, abafadores, bocas e pontas fechadas.
// Copiado de src/dsp.js sem mudar a aritmética (a comparação de WAV amostra a amostra depende disso).
import { P0, SOUND_SPEED } from './constantes';
import { clamp, onePole } from './util';
import { Biquad } from './biquad';

// Segmento de tubo: duas linhas de atraso (ida e volta) com perdas.
// As ondas carregam pressão acústica em Pa (desvio em relação à ambiente).
export class Line {
  declare D: number; declare Dprev: number; declare kNL: number; declare len: number; declare runner: boolean;
  declare a: Float32Array; declare b: Float32Array; declare mask: number; declare w: number; declare Y: number;
  declare g: number; declare k: number; declare sa: number; declare sb: number;
  declare in0: number; declare in1: number; declare out0: number; declare out1: number;
  constructor(fs, length, Y, lossHz = 9000, damp = 1) {
    this.D = Math.max(1, (length / SOUND_SPEED) * fs);
    this.Dprev = this.D; this.kNL = 0; this.len = length; this.runner = false;
    let size = 16; while (size < this.D * 1.8 + 8) size <<= 1;
    this.a = new Float32Array(size); this.b = new Float32Array(size);
    this.mask = size - 1; this.w = 0; this.Y = Y;
    // gradiente de temperatura e atrito nas paredes amortecem bastante os tubos reais
    this.g = Math.exp(-0.09 * length * damp);
    this.k = onePole(fs, lossHz);
    this.sa = 0; this.sb = 0;
    this.in0 = 0; this.in1 = 0; this.out0 = 0; this.out1 = 0;
  }
  read() {
    const m = this.mask;
    let pos = this.w - this.D, i = Math.floor(pos), f = pos - i;
    const b0 = this.b[i & m];
    this.in0 = b0 + (this.b[(i + 1) & m] - b0) * f;
    let a0 = this.a[i & m], v = a0 + (this.a[(i + 1) & m] - a0) * f;
    if (this.kNL) {
      // propagação não linear: a parte de alta pressão da onda viaja mais rápido
      // e alcança a frente, que se acentua até quase virar um choque. É isso que
      // dá o "rasgado" do escape em carga, sempre colado ao pulso.
      let De = this.D * (1 - this.kNL * clamp(v / P0, -0.6, 1.2));
      De = clamp(De, Math.max(1, this.Dprev - 4), this.Dprev + 0.9);
      this.Dprev = De;
      pos = this.w - De; i = Math.floor(pos); f = pos - i;
      a0 = this.a[i & m]; v = a0 + (this.a[(i + 1) & m] - a0) * f;
    }
    this.in1 = v;
  }
  write() {
    // atrito turbulento na onda de volta do tubo primário: a onda refletida na junção do coletor, subindo contra o
    // fluxo, perde energia como Δp ∝ ρu|u| (perda ∝ |p| por passagem, escalada pelo comprimento sobre o diâmetro). Sem
    // isso, em giro muito alto (F1: cada cilindro a ~150 Hz, perto dos ~167 Hz de 1/4 de onda do primário de 0,78 m) a
    // ressonância crescia sem limite e o afiamento da onda de ida virava subharmônicos (período de 3 ciclos) e caos: o
    // som "engasgava" e virava ruído. A onda de ida (o pulso, com o afiamento) não é tocada
    const xb = this.runner ? Math.abs(this.out1) / P0 : 0, lb = 0.7 * (this.len / 0.78) / Math.sqrt(this.Y) * xb;
    this.sa += this.k * (this.out0 * this.g - this.sa);
    this.sb += this.k * (this.out1 * this.g * (1 - lb) - this.sb);
    this.a[this.w] = this.sa; this.b[this.w] = this.sb;
    this.w = (this.w + 1) & this.mask;
  }
}

// ponta de um tubo ligada a uma junção: end 0 = começo, 1 = fim
export type Porta = { line: Line; end: number };
export const port = (line: Line, end: number): Porta => ({ line, end });
export const pin = (p: Porta) => (p.end === 0 ? p.line.in0 : p.line.in1);
export const pout = (p: Porta, v: number) => { if (p.end === 0) p.line.out0 = v; else p.line.out1 = v; };

export class Junction {
  declare ports: Porta[]; declare sumY: number; declare inj: number;
  constructor(ports) { this.ports = ports; this.sumY = ports.reduce((s, p) => s + p.line.Y, 0); this.inj = 0; }
  step() {
    let acc = 0;
    for (const p of this.ports) acc += p.line.Y * pin(p);
    const P = (2 * acc) / this.sumY + this.inj;
    for (const p of this.ports) pout(p, P - pin(p));
    this.inj = 0;
  }
}

// Abafador / turbina: transmite filtrado, reflete parte para trás.
export class TwoPort {
  declare A: Porta; declare B: Porta; declare chain: Biquad[];
  declare gT: number; declare rA: number; declare rB: number; declare x: number; declare k: number; declare s: number;
  constructor(fs, a, b, kind) {
    this.A = a; this.B = b; this.chain = [];
    const q = (f) => this.chain.push(f);
    let lr = 1400;
    if (kind === 'straight') { this.gT = 0.96; this.rA = 0.04; this.rB = 0; this.x = 0; }
    // esportivo: tubo perfurado reto com lã; a lã come os agudos, o grave passa livre
    // (a lã absorve cada vez mais com a frequência: 2ª ordem a partir de ~2 kHz, mais um corte em 4,5 kHz)
    else if (kind === 'sport') { q(new Biquad().lp(fs, 2200, 0.7)); q(new Biquad().lp(fs, 4500, 0.6)); q(new Biquad().peak(fs, 120, 0.9, 2)); this.gT = 0.78; this.rA = 0.2; this.rB = 0.1; this.x = 0.06; }
    // original: câmaras de reflexão + ressonador. Elas matam o médio (onde mora o
    // "rasgado") e o agudo, mas o grave das explosões atravessa: fica baixo e encorpado
    else if (kind === 'stock') {
      // (câmaras + lã: o agudo cai uns 40 dB acima de 2 kHz, como num escape de fábrica; o médio
      // é cortado, mas não tanto que sobre só o agudo que vaza)
      q(new Biquad().peak(fs, 350, 0.9, -7)); q(new Biquad().peak(fs, 800, 0.9, -6)); q(new Biquad().lp(fs, 900, 0.7)); q(new Biquad().lp(fs, 900, 0.7)); q(new Biquad().lp(fs, 2000, 0.6)); q(new Biquad().peak(fs, 55, 1.0, 3));
      this.gT = 0.95; this.rA = 0.22; this.rB = 0.15; this.x = 0.06; lr = 500;
    }
    // original antigo (Fusca, carros dos anos 60/70): caixa de lata só com câmaras, sem lã. As câmaras seguram o
    // grave-médio, mas sem material absorvente o médio-agudo passa e a lata ressoa: é o som "de lata", estridente
    else if (kind === 'classic') {
      q(new Biquad().peak(fs, 300, 0.9, -7)); q(new Biquad().peak(fs, 1600, 1.4, 1.5)); q(new Biquad().lp(fs, 3200, 0.7)); q(new Biquad().lp(fs, 7000, 0.6));
      this.gT = 0.9; this.rA = 0.25; this.rB = 0.12; this.x = 0.06; lr = 700;
    }
    else {
      // turbina: o rotor quebra a frente dos pulsos (agudos caem uns 6 dB) e reforça um pouco o
      // grave do coletor, mas não é uma parede; um passa-baixa forte aqui soava "de longe"
      q(new Biquad().hshelf(fs, 1300, -6)); q(new Biquad().lp(fs, 3500, 0.6)); q(new Biquad().peak(fs, 150, 0.8, 2.5));
      this.gT = 0.74; this.rA = 0.24; this.rB = 0.12; this.x = 0.08;
    }
    this.k = onePole(fs, lr); this.s = 0;
  }
  step() {
    const inA = this.A.line.in1, inB = this.B.line.in0;
    let t = inA;
    for (let i = 0; i < this.chain.length; i++) t = this.chain[i].run(t);
    this.s += this.k * (inA - this.s);
    this.A.line.out1 = this.rA * this.s + this.x * inB;
    this.B.line.out0 = this.gT * t + this.rB * inB;
  }
}

// Extremidade aberta: reflete invertido em baixas frequências e irradia como um
// monopolo. A pressão irradiada é a derivada da vazão que sai pela boca: abaixo de
// ka ≈ 1 (c/2πa, ~2 kHz num tubo de 2,5") sobe 6 dB por oitava, acima disso a boca
// irradia como um pistão. Sem isso o grave da ignição domina tudo e o nível não
// cresce com o giro, porque a boca "irradia" por igual em todas as frequências.
export class Radiator {
  declare line: Line; declare k: number; declare s: number; declare panL: number; declare panR: number; declare emit: number; declare gain: number;
  declare kr: number; declare d: number; declare u: number; declare R: number;
  constructor(fs, line, panL, panR, fc = 1500, gain = 1, fRad = 2000) {
    this.line = line; this.k = onePole(fs, fc); this.s = 0; this.panL = panL; this.panR = panR; this.emit = 0; this.gain = gain;
    this.kr = onePole(fs, fRad); this.d = 0; this.u = 0; this.R = 0.93;
  }
  radiate(u) {
    // u ∝ vazão volumétrica na boca; emite a parte "rápida" (passa-alta de 1ª ordem)
    this.u = u;
    this.d += this.kr * (u - this.d);
    return (u - this.d) * this.gain;
  }
  step() {
    const x = this.line.in1;
    this.s += this.k * (x - this.s);
    const refl = -this.R * this.s;
    this.line.out1 = refl;
    this.emit = this.radiate(x - refl);
  }
}

// Válvula cutout ("escape aberto"): boca lateral antes do abafador. Fechada é um
// toco tampado; aberta vira uma saída livre e o gás escolhe o caminho mais fácil.
export class Cutout extends Radiator {
  declare valve: { v: number }; declare o: number; declare ko: number;
  constructor(fs, line, panL, panR, fc, gain, valve, fRad) { super(fs, line, panL, panR, fc, gain, fRad); this.valve = valve; this.o = valve.v; this.ko = onePole(fs, 40); }
  step() {
    // a posição da válvula vem do control (a cada 16 amostras): em degraus, ela modulava a boca e o
    // toco em escada durante a abertura/fechamento e soava um zumbido em fs/16 (3, 6, 9 kHz). Alisa aqui
    const x = this.line.in1, o = (this.o += this.ko * (this.valve.v - this.o));
    this.s += this.k * (x - this.s);
    const open = -this.R * this.s;
    this.line.out1 = o * open + (1 - o) * 0.7 * x; // fechada: a borboleta da válvula vaza e absorve um pouco
    this.emit = this.radiate(o * (x - open));
  }
}

// Ponta fechada (tubo do ressonador): reflete a onda sem inverter.
export class ClosedEnd {
  declare line: Line;
  constructor(line) { this.line = line; }
  step() { this.line.out1 = 0.96 * this.line.in1; }
}

