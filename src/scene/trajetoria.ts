// Trajetória do corpo no mundo (CENA.md 1.5 e 3.1).
//
// Mundo: z para cima; a via passa pelo ouvinte ao longo de x. O ouvinte fixo fica do lado −y da via,
// a `lateral + largura/2` do eixo, olhando para +y (para a via); a direita dele é +x, então sentido 1
// (o corpo andando em +x) passa da esquerda para a direita.
//   reta:  eixo y = 0; s ∈ [−comprimento/2, comprimento/2) e o corpo "reaparece do outro lado".
//   volta: oval com duas retas de (comprimento − 2πR)/2 e dois semicírculos de raio R; a reta de baixo
//          (y = −R) é a do ouvinte, s = 0 no meio dela, sentido 1 = anti-horário.
//
// Formulação: cada fonte anda pela via na sua própria abscissa s + x_i, com o deslocamento lateral
// y_i ao longo da normal da via. Numa reta isto é exatamente r_i = P + R(ψ)·b_i; numa curva os
// vagões de um trem seguem os trilhos em vez de formar uma barra rígida (que sairia da via por
// L²/8R: 3,9 m num trem de 250 m numa curva de 2 km).
import type { Trajetoria } from './tipos';

/**
 * Ponto da via: posição do eixo (x, y), tangente (tx, ty) e normal à esquerda (nx, ny), num Float64Array
 * v = [x, y, tx, ty, nx, ny] (escrever doubles em campos de objeto aloca no V8; isto roda no laço).
 */
export class PontoVia {
  v = new Float64Array([0, 0, 1, 0, 0, 1, 0]);   // + v[6]: abscissa de entrada de pontoV
  get x() { return this.v[0]; } get y() { return this.v[1]; } get tx() { return this.v[2]; } get ty() { return this.v[3]; } get nx() { return this.v[4]; } get ny() { return this.v[5]; }
}

export class Via {
  tipo: Trajetoria['tipo'] = 'reta';
  comp = 3000;
  R = 60;
  sentido: 1 | -1 = 1;
  ls = 0;          // comprimento de cada reta da volta
  yOuvinte = 0;    // y do eixo da reta do ouvinte (0 na reta, −R na volta)

  configurar(t: Trajetoria) {
    this.tipo = t.tipo; this.comp = Math.max(1, t.comprimento); this.sentido = t.sentido;
    this.R = Math.max(20, t.raioCurva);
    if (this.tipo === 'volta') {
      this.ls = Math.max(0, (this.comp - 2 * Math.PI * this.R) / 2);
      if (this.ls === 0) this.comp = 2 * Math.PI * this.R;
      this.yOuvinte = -this.R;
    } else { this.ls = this.comp; this.yOuvinte = 0; }
  }

  /** abscissa reduzida ao intervalo da via */
  reduzir(s: number) {
    const L = this.comp;
    if (this.tipo === 'reta') { let u = (s + L / 2) % L; if (u < 0) u += L; return u - L / 2; }
    let u = s % L; if (u < 0) u += L; return u;
  }

  /** ponto da via na abscissa s (qualquer valor; a via é periódica) */
  ponto(s: number, p: PontoVia) { p.v[6] = s; return this.pontoV(p); }
  /**
   * O mesmo, com a abscissa em p.v[6]: no laço do propagador passar um double como argumento de uma
   * função que o V8 não embute aloca a caixa dele; pelo Float64Array não.
   */
  pontoV(p: PontoVia) {
    // (reduzir() embutido, pelo mesmo motivo)
    const s = p.v[6], L = this.comp, sg = this.sentido;
    let u: number;
    if (this.tipo === 'reta') { u = (s + L / 2) % L; if (u < 0) u += L; u -= L / 2; } else { u = s % L; if (u < 0) u += L; }
    if (this.tipo === 'reta') {
      const v = p.v; v[0] = sg * u; v[1] = 0; v[2] = sg; v[3] = 0; v[4] = 0; v[5] = sg;
      return p;
    }
    // volta anti-horária (sentido 1): reta de baixo de −ls/2 a ls/2 em y = −R, semicírculo direito,
    // reta de cima, semicírculo esquerdo. u = 0 no meio da reta de baixo.
    const ls = this.ls, R = this.R, h = ls / 2, arco = Math.PI * R;
    let x: number, y: number, tx: number, ty: number;
    // sentido −1 percorre o mesmo oval no sentido horário: ponto(−u) com a tangente invertida
    const per = 2 * ls + 2 * arco;
    let w = sg * u + h;                 // 0 no começo da reta de baixo
    if (w >= per) w -= per;
    if (w < 0) w += per;
    if (w < ls) { x = -h + w; y = -R; tx = 1; ty = 0; }
    else if (w < ls + arco) { const a = (w - ls) / R - Math.PI / 2; x = h + R * Math.cos(a); y = R * Math.sin(a); tx = -Math.sin(a); ty = Math.cos(a); }
    else if (w < 2 * ls + arco) { const q = w - ls - arco; x = h - q; y = R; tx = -1; ty = 0; }
    else { const a = (w - 2 * ls - arco) / R + Math.PI / 2; x = -h + R * Math.cos(a); y = R * Math.sin(a); tx = -Math.sin(a); ty = Math.cos(a); }
    if (sg < 0) { tx = -tx; ty = -ty; }
    const v = p.v; v[0] = x; v[1] = y; v[2] = tx; v[3] = ty; v[4] = -ty; v[5] = tx;
    return p;
  }

  /** abscissa da via no ponto mais próximo de um ouvinte junto da reta (x do mundo) */
  abscissaDe(xMundo: number) { return this.sentido * xMundo; }

  /** maior distância possível entre o corpo e um ouvinte junto da via (dimensiona anéis e histórico) */
  distMax(lateral: number, altitude: number) {
    const meia = this.tipo === 'reta' ? this.comp / 2 : Math.hypot(this.ls / 2 + this.R, 2 * this.R);
    return Math.sqrt(meia * meia + lateral * lateral + altitude * altitude);
  }
}

/** Histórico da abscissa s(t) do corpo, uma entrada por bloco de controle (seção 2.1). */
export class Historico {
  s: Float64Array; v: Float64Array;
  n: number; mask: number;
  k = 0;           // índice (absoluto) da última entrada
  dtb: number;     // s entre entradas
  t0 = 0;          // tempo (s) da entrada k

  constructor(segundos: number, dtb: number) {
    let n = 16; while (n * dtb < segundos) n <<= 1;
    this.n = n; this.mask = n - 1; this.dtb = dtb;
    this.s = new Float64Array(n); this.v = new Float64Array(n);
  }

  /** zera o histórico como se o corpo viesse andando em linha reta com v constante */
  reiniciar(t: number, s: number, v: number) {
    this.k = this.n; this.t0 = t;
    for (let i = 0; i < this.n; i++) { const j = this.k - i; this.s[j & this.mask] = s - v * i * this.dtb; this.v[j & this.mask] = v; }
  }

  empurrar(s: number, v: number) {
    this.k++; this.t0 += this.dtb;
    this.s[this.k & this.mask] = s; this.v[this.k & this.mask] = v;
  }

  /** s e v no tempo t em this.res = [s, v] (sem devolver double: chamada que não é embutida aloca o retorno) */
  res = new Float64Array(3);
  ler(t: number) { this.res[2] = t; this.lerV(); }
  /** idem, com t em res[2] (sem argumento double) */
  lerV() {
    const t = this.res[2];
    const x = (t - this.t0) / this.dtb, m = this.mask, S = this.s, V = this.v, r = this.res;
    if (x >= 0) { const j = this.k & m; r[0] = S[j] + V[j] * x * this.dtb; r[1] = V[j]; return; }
    const fl = Math.floor(x), f = x - fl;
    if (-fl >= this.n - 1) { const j = (this.k - this.n + 2) & m, xa = x + this.n - 2; r[0] = S[j] + V[j] * xa * this.dtb; r[1] = V[j]; return; }
    const i0 = (this.k + fl) & m, i1 = (this.k + fl + 1) & m;
    r[0] = S[i0] + (S[i1] - S[i0]) * f; r[1] = V[i0] + (V[i1] - V[i0]) * f;
  }

  /** s no tempo t (≤ t0); antes do início do histórico, extrapola com a v mais antiga */
  sEm(t: number) {
    const x = (t - this.t0) / this.dtb;          // ≤ 0
    if (x >= 0) { const j = this.k & this.mask; return this.s[j] + this.v[j] * x * this.dtb; }
    const fl = Math.floor(x), f = x - fl;
    const i0 = this.k + fl;
    if (-fl >= this.n - 1) {
      const j = (this.k - this.n + 2) & this.mask, xa = x + this.n - 2;
      return this.s[j] + this.v[j] * xa * this.dtb;
    }
    const a = this.s[i0 & this.mask], b = this.s[(i0 + 1) & this.mask];
    return a + (b - a) * f;
  }

  vEm(t: number) {
    const x = (t - this.t0) / this.dtb;
    if (x >= 0) return this.v[this.k & this.mask];
    const fl = Math.floor(x), f = x - fl;
    if (-fl >= this.n - 1) return this.v[(this.k - this.n + 2) & this.mask];
    const i0 = this.k + fl;
    const a = this.v[i0 & this.mask], b = this.v[(i0 + 1) & this.mask];
    return a + (b - a) * f;
  }
}
