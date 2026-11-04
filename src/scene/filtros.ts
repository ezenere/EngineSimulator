// Filtros da Cena. O `Biquad` de src/acoustics/ calcula os coeficientes por um `_w()` que devolve um
// array (aloca a cada chamada); aqui os coeficientes mudam a cada bloco de controle, dentro do laço
// de áudio, então a Cena tem a sua versão sem alocação. Mesmas fórmulas do "Audio EQ Cookbook".
// Também ficam aqui a ponderação A (IEC 61672) e a resposta em frequência usada na calibração.

const TAU = Math.PI * 2;

/** Biquad (transposta direta II) com coeficientes recalculáveis sem alocar. */
export class Bq {
  b0 = 1; b1 = 0; b2 = 0; a1 = 0; a2 = 0; z1 = 0; z2 = 0;
  private def(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number) {
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0; return this;
  }
  lp(fs: number, f: number, q = 0.7071) {
    const w = TAU * Math.min(f, fs * 0.45) / fs, c = Math.cos(w), al = Math.sin(w) / (2 * q);
    return this.def((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al);
  }
  hp(fs: number, f: number, q = 0.7071) {
    const w = TAU * Math.min(f, fs * 0.45) / fs, c = Math.cos(w), al = Math.sin(w) / (2 * q);
    return this.def((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al);
  }
  /** passa-banda com ganho 1 no pico */
  bp(fs: number, f: number, q: number) {
    const w = TAU * Math.min(f, fs * 0.45) / fs, c = Math.cos(w), al = Math.sin(w) / (2 * q);
    return this.def(al, 0, -al, 1 + al, -2 * c, 1 - al);
  }
  peak(fs: number, f: number, q: number, db: number) {
    const A = Math.pow(10, db / 40), w = TAU * Math.min(f, fs * 0.45) / fs, c = Math.cos(w), al = Math.sin(w) / (2 * q);
    return this.def(1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A);
  }
  /** coeficientes diretos (z⁻¹), a0 = 1 */
  coef(b0: number, b1: number, b2: number, a1: number, a2: number) { this.b0 = b0; this.b1 = b1; this.b2 = b2; this.a1 = a1; this.a2 = a2; return this; }
  run(x: number) { const y = this.b0 * x + this.z1; this.z1 = this.b1 * x - this.a1 * y + this.z2; this.z2 = this.b2 * x - this.a2 * y; return y; }
  zerar() { this.z1 = 0; this.z2 = 0; }
  /** |H(f)|² */
  mag2(fs: number, f: number) {
    const w = TAU * f / fs, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    const nr = this.b0 + this.b1 * c1 + this.b2 * c2, ni = -(this.b1 * s1 + this.b2 * s2);
    const dr = 1 + this.a1 * c1 + this.a2 * c2, di = -(this.a1 * s1 + this.a2 * s2);
    return (nr * nr + ni * ni) / (dr * dr + di * di);
  }
}

/** coeficiente de um passa-baixa de 1 polo (y += k·(x − y)) com corte f; igual ao onePole do acoustics */
export const k1 = (fs: number, f: number) => 1 - Math.exp(-TAU * f / fs);

/** |H(f)|² de um passa-baixa de 1 polo y += k(x − y) */
export function mag2Polo(fs: number, k: number, f: number) {
  const w = TAU * f / fs, p = 1 - k;
  // H = k / (1 − p·e^{−jw})
  const dr = 1 - p * Math.cos(w), di = p * Math.sin(w);
  return (k * k) / (dr * dr + di * di);
}

/** Ponderação A analítica (IEC 61672), em razão de amplitude (1 em 1 kHz). */
export function ganhoA(f: number) {
  const f2 = f * f;
  const ra = (12194 * 12194 * f2 * f2) / ((f2 + 20.6 * 20.6) * Math.sqrt((f2 + 107.7 * 107.7) * (f2 + 737.9 * 737.9)) * (f2 + 12194 * 12194));
  return ra * 1.2589;   // +2,00 dB
}

/** Filtro de ponderação A no tempo: 3 biquads pela transformação bilinear com pré-distorção dos polos. */
export class PonderacaoA {
  s: Bq[] = [new Bq(), new Bq(), new Bq()];
  g = 1;
  constructor(fs: number) {
    const K = 2 * fs, pw = (f: number) => K * Math.tan(Math.PI * f / fs);
    const w1 = pw(20.598997), w2 = pw(107.65265), w3 = pw(737.86223), w4 = pw(12194.217);
    // fator de 1ª ordem (s + a) → [(K + a) + (a − K) z⁻¹] / (1 + z⁻¹)
    // s/(s+a) = K(1 − z⁻¹)/[(K+a) + (a−K)z⁻¹] ;  a/(s+a) = a(1 + z⁻¹)/[(K+a) + (a−K)z⁻¹]
    const prod = (n1: number[], d1: number[], n2: number[], d2: number[], bq: Bq) => {
      const n = [n1[0] * n2[0], n1[0] * n2[1] + n1[1] * n2[0], n1[1] * n2[1]];
      const d = [d1[0] * d2[0], d1[0] * d2[1] + d1[1] * d2[0], d1[1] * d2[1]];
      bq.coef(n[0] / d[0], n[1] / d[0], n[2] / d[0], d[1] / d[0], d[2] / d[0]);
    };
    const hp = (a: number) => [[K, -K], [K + a, a - K]];
    const lp = (a: number) => [[a, a], [K + a, a - K]];
    const [h1n, h1d] = hp(w1), [h2n, h2d] = hp(w2), [h3n, h3d] = hp(w3), [l4n, l4d] = lp(w4);
    prod(h1n, h1d, h1n, h1d, this.s[0]);
    prod(h2n, h2d, h3n, h3d, this.s[1]);
    prod(l4n, l4d, l4n, l4d, this.s[2]);
    const m = this.s[0].mag2(fs, 1000) * this.s[1].mag2(fs, 1000) * this.s[2].mag2(fs, 1000);
    this.g = 1 / Math.sqrt(m);
  }
  run(x: number) { return this.s[2].run(this.s[1].run(this.s[0].run(x * this.g))); }
}

/** Atraso fracionário: Hermite cúbica de 4 pontos, a mesma do `readProp` do Ronco. */
export function hermite(buf: Float32Array, m: number, pos: number) {
  const i = Math.floor(pos), f = pos - i;
  const y0 = buf[(i - 1) & m], y1 = buf[i & m], y2 = buf[(i + 1) & m], y3 = buf[(i + 2) & m];
  const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
  return ((c3 * f + c2) * f + c1) * f + y1;
}

/** Diretividade: tabela de 7 pontos (0°…180°, passo de 30°) com interpolação linear em dB, como `dir()` do jet-dsp. */
export function dirDb(tab: readonly number[], thetaGraus: number) {
  const x = Math.min(Math.max(thetaGraus / 30, 0), 5.999), i = x | 0;
  return tab[i] + (tab[i + 1] - tab[i]) * (x - i);
}

/**
 * RMS da saída de uma cadeia de filtros em série para ruído branco de variância `vari`, integrando
 * |H(f)|²·|W(f)|² na frequência (W = ponderação A se `ponderarA`). Só na configuração (é lento).
 */
export function rmsCadeia(fs: number, cadeia: readonly Bq[], vari = 1 / 3, ponderarA = false, df = 2) {
  let p = 0;
  for (let f = df / 2; f < fs / 2; f += df) {
    let h = 1;
    for (const b of cadeia) h *= b.mag2(fs, f);
    if (ponderarA) { const a = ganhoA(f); h *= a * a; }
    p += h * df;
  }
  return Math.sqrt((p * vari) / (fs / 2));
}

/**
 * Fator de potência de uma diretividade de eixo simétrico: média de 10^(D(θ)/10) sobre a esfera,
 * (1/2)∫D²(θ)·sinθ dθ. Uma fonte calibrada em potência sonora (L_W) tem de ser multiplicada por
 * 1/√(fator) para irradiar a potência certa: no eixo ela fica acima do nível omnidirecional pelo índice
 * de diretividade (dipolo cos²: fator 1/3, +4,8 dB).
 */
export function fatorPotenciaDir(tab: readonly number[]) {
  let s = 0; const n = 360;
  for (let i = 0; i < n; i++) { const th = ((i + 0.5) / n) * Math.PI; s += Math.pow(10, dirDb(tab, (th * 180) / Math.PI) / 10) * Math.sin(th); }
  return (s * (Math.PI / n)) / 2;
}
