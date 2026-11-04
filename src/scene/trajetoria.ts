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

/** Ponto da via: posição do eixo (x, y), tangente (tx, ty) e normal à esquerda (nx, ny). */
export class PontoVia { x = 0; y = 0; tx = 1; ty = 0; nx = 0; ny = 1; }

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
  ponto(s: number, p: PontoVia) {
    const u = this.reduzir(s), sg = this.sentido;
    if (this.tipo === 'reta') {
      p.x = sg * u; p.y = 0; p.tx = sg; p.ty = 0; p.nx = 0; p.ny = sg;
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
    p.x = x; p.y = y; p.tx = tx; p.ty = ty; p.nx = -ty; p.ny = tx;
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
