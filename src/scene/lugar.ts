// O lugar (extensão de 23/11/2026, CENA.md 2.10 e 3.2): a acústica do ambiente depende de onde o ouvinte está e, onde
// faz sentido, de onde a fonte está em relação ao lugar. Sem `Ambiente.lugar` nada aqui roda, e com o ouvinte fixo ou no
// gimbal (a API das ferramentas) também não: o ambiente vale para o cenário inteiro, como antes.
//
// Coordenadas da via: `s` ao longo dela (a abscissa da Cena), `m` a distância ao eixo para o lado do ouvinte de antes
// (m = −y na reta; na volta, para fora do oval), `z` para cima a partir do chão da via. Uma fonte do corpo em (x_i, y_i)
// fica em s + x_i e m = −sentido·y_i.
//
// Modelo. Um recinto (o tubo do túnel, a cobertura da estação, a trincheira do corte) tem uma caixa e aberturas
// (retângulos em planos de coordenada: as bocas do túnel, as pontas e o vão de cima do muro da estação, o topo do corte).
//  · Campo reverberante. Dentro, a fonte alimenta o campo do lugar como antes (a lei do envio com a distância, 2.10). Fora,
//    o ponto se acopla a ele pela abertura: o campo difuso de pressão quadrática p² incide na abertura com intensidade
//    p²/(4ρc); a potência S·p²/(4ρc) que sai irradia num ângulo sólido Ω = 4π/Q e, a d da abertura,
//        p²(d)/p² = S·Q/(16π·d²)            (abertura 3-D: a boca, a ponta da estação)
//        p²(d)/p² = W/(4π·d)                (fenda 2-D de largura W, longa: o topo do corte, o vão sobre o muro)
//    A realização contínua (igual a 1 na abertura) é c² = 1/(1 + (d/d₀)ⁿ), d₀² = S·Q/(16π) com n = 2, d₀ = W/(4π) com
//    n = 1, d a distância do ponto ao retângulo da abertura; as aberturas somam energia. O envio de uma fonte S a um
//    ouvinte O vira  envio(|S′ − O′|)·c(S)·c(O), com X′ = X dentro e X′ = o ponto da abertura por onde X se acopla fora;
//    o mesmo c nos dois sentidos (recíproco). Na abertura c = 1 e X′ = X: atravessar a boca é contínuo.
//  · Caminho direto. Com um ponto dentro e o outro fora, o som só passa pela abertura: se a reta cruza o plano dela
//    dentro do retângulo, há visada (perto da borda, a zona iluminada de Kurze–Anderson); se cruza fora, o caminho
//    contorna a borda mais fácil (o ponto ótimo da aresta, fechado; nos cantos, o canto) e a atenuação é a de Maekawa
//    com o δ desse caminho (sombra.ts), somada à do corpo. Dois pontos fora ou dois dentro: nada (o morro do túnel com os
//    dois fora fica de fora).
//  · Ponte: não há recinto; a laje do tabuleiro é um obstáculo extrudado ao longo da via (o retângulo de sombra.ts), e
//    embaixo dele o chão refletor é o vale.
import type { EspecFundo, LugarAcustico } from './tipos';
import type { Via } from './trajetoria';
import { CalculoSombra } from './sombra';

/** o som de fundo fora do lugar quando a página não diz (o do céu aberto, ambientes.ts) */
export const FUNDO_FORA_PADRAO: EspecFundo = { vento: 38, ventilacao: 0, murmurio: 0 };
/** Q da boca do túnel (testa no morro e chão na frente: um quarto de espaço) e da ponta da estação (meio espaço) */
export const Q_BOCA = 4, Q_PONTA = 2;
/** m: a altura do ouvido de pé no chão da via; o acoplamento de cada fonte ao campo reverberante é medido daqui (cena.ts) */
export const Z_REF_ENVIO = 1.6;

export const TIPO_NENHUM = 0, TIPO_TUNEL = 1, TIPO_ESTACAO = 2, TIPO_CORTE = 3, TIPO_PONTE = 4;
// uma abertura: [eixo da normal (0 s, 1 m, 2 z), coordenada do plano, u0, u1, v0, v1 (os outros dois eixos, em ordem),
// arestas que difratam (u0, u1, v0, v1: 1/0), d₀, n]
const A_TAM = 12;
// saída de acoplar(): [dentro (0/1), c, s′, m′, z′, d]
export const AC_DENTRO = 0, AC_C = 1, AC_S = 2, AC_M = 3, AC_Z = 4, AC_D = 5;

export class LugarCena {
  ativo = false;
  tipo = TIPO_NENHUM;
  /** sem recinto (a ponte): a ocultação do caminho direto vale também para o envio */
  ocultaEnvio = false;
  via: Via | null = null;
  /** a caixa do recinto: s0, s1, m0, m1, z0, z1 (±Infinity onde não há limite) */
  caixa = new Float64Array(6);
  ab = new Float64Array(3 * A_TAM);
  nAb = 0;
  /** reduz s para perto do recinto (na volta a via é periódica) */
  private sCentro = 0; private periodo = Infinity;
  /** ponte: m0, m1, espessura, vale, fundo, borda */
  ponte = new Float64Array(6);
  /** área da boca do túnel (m²): a onda de compressão fora dele cai como a de um pistão de raio √(S/2π) (cena.ts) */
  areaBoca = 0;
  fundoFora: EspecFundo = FUNDO_FORA_PADRAO;
  private sombra = new CalculoSombra();
  /** rascunho (as entradas e saídas vão por aqui, sem argumentos double): S (0–2) e O (3–5) em (s, m, z) para delta();
   *  o ponto de acoplar() (6–8); o δ de delta() (9) e o de cada abertura (10) */
  q = new Float64Array(12);
  /** o ouvinte, a cada bloco de controle: s, m, z e a saída de acoplar() (AC_*, a partir de 3) */
  ouv = new Float64Array(9);

  configurar(l: LugarAcustico | undefined, via: Via) {
    this.via = via; this.nAb = 0; this.tipo = TIPO_NENHUM; this.ativo = false; this.areaBoca = 0;
    this.fundoFora = l?.fundoFora ?? FUNDO_FORA_PADRAO;
    this.periodo = via.tipo === 'volta' ? via.comp : Infinity;
    const cx = this.caixa;
    if (!l) return;
    if (l.tunel) {
      const t = l.tunel, area = (t.mPerto - t.mLonge) * t.altura;
      this.tipo = TIPO_TUNEL; this.areaBoca = area;
      cx[0] = t.s0; cx[1] = t.s1; cx[2] = t.mLonge; cx[3] = t.mPerto + (t.nicho ?? 0); cx[4] = -Infinity; cx[5] = t.altura;
      const d0 = Math.sqrt((area * Q_BOCA) / (16 * Math.PI));
      // as bocas: planos s = s0 e s = s1; (u, v) = (m, z); o chão não difrata
      for (const s of [t.s0, t.s1]) this.abertura(0, s, t.mLonge, t.mPerto, 0, t.altura, 1, 1, 0, 1, d0, 2);
      this.sCentro = (t.s0 + t.s1) / 2;
    } else if (l.estacao) {
      const e = l.estacao, area = (e.mFundo - e.mLonge) * e.teto;
      this.tipo = TIPO_ESTACAO;
      cx[0] = e.s0; cx[1] = e.s1; cx[2] = e.mLonge; cx[3] = e.mFundo; cx[4] = -Infinity; cx[5] = e.teto;
      const d0 = Math.sqrt((area * Q_PONTA) / (16 * Math.PI));
      for (const s of [e.s0, e.s1]) this.abertura(0, s, e.mLonge, e.mFundo, 0, e.teto, 1, 1, 0, 1, d0, 2);
      // o vão entre o muro e a beira do telhado, do lado de lá: plano m = mLonge; (u, v) = (s, z); fenda de largura teto − muro
      this.abertura(1, e.mLonge, e.s0, e.s1, e.muro, e.teto, 1, 1, 1, 1, Math.max(0.05, e.teto - e.muro) / (4 * Math.PI), 1);
      this.sCentro = (e.s0 + e.s1) / 2;
    } else if (l.corte) {
      const c = l.corte;
      this.tipo = TIPO_CORTE;
      cx[0] = -Infinity; cx[1] = Infinity; cx[2] = -c.m1; cx[3] = c.m1; cx[4] = -Infinity; cx[5] = c.alto;
      // o topo: plano z = alto; (u, v) = (s, m); as arestas do alto dos taludes difratam
      this.abertura(2, c.alto, -Infinity, Infinity, -c.m1, c.m1, 0, 0, 1, 1, (2 * c.m1) / (4 * Math.PI), 1);
    } else if (l.ponte) {
      const p = l.ponte;
      this.tipo = TIPO_PONTE;
      this.ponte[0] = p.m0; this.ponte[1] = p.m1; this.ponte[2] = p.espessura; this.ponte[3] = p.vale; this.ponte[4] = p.fundo; this.ponte[5] = p.borda;
    }
    this.ativo = this.tipo !== TIPO_NENHUM;
    this.ocultaEnvio = this.tipo === TIPO_PONTE;
  }

  private abertura(eixo: number, c: number, u0: number, u1: number, v0: number, v1: number, bu0: number, bu1: number, bv0: number, bv1: number, d0: number, n: number) {
    const a = this.ab, o = this.nAb * A_TAM;
    a[o] = eixo; a[o + 1] = c; a[o + 2] = u0; a[o + 3] = u1; a[o + 4] = v0; a[o + 5] = v1;
    a[o + 6] = bu0; a[o + 7] = bu1; a[o + 8] = bv0; a[o + 9] = bv1; a[o + 10] = d0; a[o + 11] = n;
    this.nAb++;
  }

  /** s reduzido para perto do recinto (na volta) */
  reduzirS(s: number) {
    const P = this.periodo;
    return P === Infinity ? s : s - P * Math.round((s - this.sCentro) / P);
  }

  /** (s, m) de um ponto do mundo (o mesmo que Lugar.projetar da página), em out[o], out[o + 1] */
  projetar(x: number, y: number, out: Float64Array, o: number) {
    const v = this.via!;
    if (v.tipo === 'reta') { out[o] = v.sentido * x; out[o + 1] = -y; return; }
    const R = v.R, h = v.ls / 2, arco = Math.PI * R;
    let w: number, m: number;
    if (x >= -h && x <= h) {
      if (y <= 0) { w = x + h; m = -(y + R); } else { w = v.ls + arco + (h - x); m = y - R; }
    } else if (x > h) { const a = Math.atan2(y, x - h); w = v.ls + R * (a + Math.PI / 2); m = Math.sqrt((x - h) * (x - h) + y * y) - R; }
    else { let a = Math.atan2(y, x + h); if (a < 0) a += 2 * Math.PI; w = 2 * v.ls + arco + R * (a - Math.PI / 2); m = Math.sqrt((x + h) * (x + h) + y * y) - R; }
    out[o] = v.sentido * (w - h); out[o + 1] = m;
  }

  /** o ponto (s, m, z) está dentro do recinto */
  dentro(s: number, m: number, z: number) {
    const c = this.caixa;
    return s >= c[0] && s <= c[1] && m >= c[2] && m <= c[3] && z >= c[4] && z <= c[5];
  }

  /**
   * Acoplamento do ponto (s, m, z) em this.q[6..8] ao campo reverberante do recinto, em out[o…o+5] (AC_*): dentro, c,
   * o ponto por onde ele se acopla (ele mesmo dentro; o ponto mais perto da abertura que mais pesa, fora) e a distância
   * a ela. (As entradas vão por Float64Array: um double passado a uma função que o V8 não embute aloca a caixa dele.)
   */
  acoplar(out: Float64Array, o: number) {
    const q = this.q;
    const s = this.reduzirS(q[6]), m = q[7], z = q[8];
    // (sem recinto, a ponte: tudo conta como dentro, e o envio fica o de antes)
    if (this.tipo === TIPO_PONTE || this.tipo === TIPO_NENHUM || this.dentro(s, m, z)) {
      out[o] = 1; out[o + 1] = 1;
      out[o + 2] = s; out[o + 3] = m; out[o + 4] = z; out[o + 5] = 0;
      return;
    }
    const a = this.ab;
    let c2 = 0, melhor = -1, dMelhor = Infinity, ps = s, pm = m, pz = z;
    for (let k = 0; k < this.nAb; k++) {
      const b = k * A_TAM, eixo = a[b];
      // o ponto do retângulo mais perto: o plano na coordenada da normal, as outras duas presas aos limites
      let qs: number, qm: number, qz: number;
      if (eixo === 0) { qs = a[b + 1]; qm = m < a[b + 2] ? a[b + 2] : m > a[b + 3] ? a[b + 3] : m; qz = z < a[b + 4] ? a[b + 4] : z > a[b + 5] ? a[b + 5] : z; }
      else if (eixo === 1) { qm = a[b + 1]; qs = s < a[b + 2] ? a[b + 2] : s > a[b + 3] ? a[b + 3] : s; qz = z < a[b + 4] ? a[b + 4] : z > a[b + 5] ? a[b + 5] : z; }
      else { qz = a[b + 1]; qs = s < a[b + 2] ? a[b + 2] : s > a[b + 3] ? a[b + 3] : s; qm = m < a[b + 4] ? a[b + 4] : m > a[b + 5] ? a[b + 5] : m; }
      const d = Math.sqrt((s - qs) * (s - qs) + (m - qm) * (m - qm) + (z - qz) * (z - qz));
      const r = d / a[b + 10], ck = 1 / (1 + (a[b + 11] === 2 ? r * r : r));
      c2 += ck;
      if (ck > melhor) { melhor = ck; ps = qs; pm = qm; pz = qz; dMelhor = d; }
    }
    out[o] = 0; out[o + 1] = Math.sqrt(c2 > 1 ? 1 : c2);
    out[o + 2] = ps; out[o + 3] = pm; out[o + 4] = pz; out[o + 5] = dMelhor;
  }

  /**
   * δ (m) do caminho direto de S a O (em this.q[0..2] e this.q[3..5], coordenadas da via) pelo lugar, em this.q[9]:
   * negativo na zona iluminada perto de uma borda, positivo na sombra, −Infinity quando o lugar não está no caminho.
   */
  delta() {
    const q = this.q;
    q[0] = this.reduzirS(q[0]); q[3] = this.reduzirS(q[3]);
    q[9] = -Infinity;
    if (this.tipo === TIPO_PONTE) { this.deltaPonte(); return; }
    if (this.dentro(q[0], q[1], q[2]) === this.dentro(q[3], q[4], q[5])) return;
    let melhor = Infinity;
    for (let k = 0; k < this.nAb; k++) { this.deltaAbertura(k * A_TAM); if (q[10] < melhor) melhor = q[10]; }
    q[9] = melhor;
  }

  /** δ pela abertura que começa em a[b] (ver delta()), em this.q[10] */
  private deltaAbertura(b: number) {
    const a = this.ab, q = this.q, eixo = a[b], c = a[b + 1];
    // eixos (u, v) do plano: os dois que não são a normal, em ordem
    const iu = eixo === 0 ? 1 : 0, iv = eixo === 2 ? 1 : 2;
    const Sn = q[eixo], Su = q[iu], Sv = q[iv];
    let On = q[3 + eixo];
    const Ou = q[3 + iu], Ov = q[3 + iv];
    const dx = q[0] - q[3], dy = q[1] - q[4], dz = q[2] - q[5], direto = Math.sqrt(dx * dx + dy * dy + dz * dz);
    // os dois do mesmo lado do plano (um dentro, o outro fora atrás da testa): o caminho sai pela abertura e volta;
    // espelhar O no plano dá o mesmo comprimento por qualquer ponto do plano
    const mesmoLado = (Sn - c) * (On - c) > 0;
    if (mesmoLado) On = 2 * c - On;
    const aS = Sn - c, aO = On - c, t = aS === aO ? 0.5 : aS / (aS - aO);
    const Cu = Su + t * (Ou - Su), Cv = Sv + t * (Ov - Sv);
    const u0 = a[b + 2], u1 = a[b + 3], v0 = a[b + 4], v1 = a[b + 5];
    const dentroU = Cu >= u0 && Cu <= u1, dentroV = Cv >= v0 && Cv <= v1;
    let eu = Cu, ev = Cv, sinal = 1;
    // (do mesmo lado, o caminho pelo ponto C da abertura vai e volta: nunca é visada, δ = via − direto ≥ 0)
    if (dentroU && dentroV && mesmoLado) { /* E = C */ }
    else if (dentroU && dentroV) {
      // visada pela abertura: zona iluminada, pela aresta que difrata mais perto do ponto onde a reta cruza
      let e = Infinity;
      if (a[b + 6] && Cu - u0 < e) { e = Cu - u0; eu = u0; ev = Cv; }
      if (a[b + 7] && u1 - Cu < e) { e = u1 - Cu; eu = u1; ev = Cv; }
      if (a[b + 8] && Cv - v0 < e) { e = Cv - v0; eu = Cu; ev = v0; }
      if (a[b + 9] && v1 - Cv < e) { e = v1 - Cv; eu = Cu; ev = v1; }
      if (e === Infinity) { q[10] = -Infinity; return; }
      sinal = -1;
    } else if (dentroU) {
      // contorna a aresta v = v0 ou v1 pelo ponto ótimo dela: onde o caminho desdobrado fica reto,
      // u = uS + (uO − uS)·ρS/(ρS + ρO), com ρ a distância de cada ponto à aresta; preso ao segmento
      ev = Cv < v0 ? v0 : v1;
      const rS = Math.sqrt(aS * aS + (Sv - ev) * (Sv - ev)), rO = Math.sqrt(aO * aO + (Ov - ev) * (Ov - ev)), r = rS + rO;
      eu = r > 1e-9 ? Su + ((Ou - Su) * rS) / r : 0.5 * (Su + Ou);
      eu = eu < u0 ? u0 : eu > u1 ? u1 : eu;
    } else if (dentroV) {
      eu = Cu < u0 ? u0 : u1;
      const rS = Math.sqrt(aS * aS + (Su - eu) * (Su - eu)), rO = Math.sqrt(aO * aO + (Ou - eu) * (Ou - eu)), r = rS + rO;
      ev = r > 1e-9 ? Sv + ((Ov - Sv) * rS) / r : 0.5 * (Sv + Ov);
      ev = ev < v0 ? v0 : ev > v1 ? v1 : ev;
    } else { eu = Cu < u0 ? u0 : u1; ev = Cv < v0 ? v0 : v1; }   // o canto
    // comprimento S → E → O (com O espelhado, se for o caso, dá o mesmo)
    const via = Math.sqrt(aS * aS + (eu - Su) * (eu - Su) + (ev - Sv) * (ev - Sv)) + Math.sqrt(aO * aO + (Ou - eu) * (Ou - eu) + (Ov - ev) * (Ov - ev));
    q[10] = sinal * (via - direto);
  }

  /** ponte: a laje do tabuleiro como obstáculo (o retângulo de sombra.ts, deslocado para o eixo dele) */
  private deltaPonte() {
    const q = this.q, p = this.ponte, mc = (p[0] + p[1]) / 2, sobe = p[2] + 1;
    // (os dois em cima do tabuleiro, dentro da largura dele: a laje fica embaixo dos dois)
    if (q[2] >= 0 && q[5] >= 0 && q[1] >= p[0] && q[1] <= p[1] && q[4] >= p[0] && q[4] <= p[1]) return;
    const e = this.sombra.ent;
    // (a laje fica de 1 a 1 + espessura no referencial do retângulo: o topo do tabuleiro em z = 0 vira sobe)
    e[0] = q[1] - mc; e[1] = q[2] + sobe; e[2] = q[4] - mc; e[3] = q[5] + sobe; e[4] = q[3] - q[0];
    e[5] = p[1] - p[0]; e[6] = sobe; e[7] = 1;
    this.sombra.calcularV();
    const o = this.sombra.out;
    q[9] = o[3] > 0 ? o[0] : o[1] > 0 ? o[0] : -Infinity;
  }

  /** altura do chão do vale (ponte) na distância m da via: o fundo até `fundo`, a encosta em S até 0 em `borda` */
  vale(m: number) {
    const p = this.ponte, a = Math.abs(m);
    if (a <= p[4]) return p[3];
    if (a >= p[5]) return 0;
    const t = (a - p[4]) / (p[5] - p[4]);
    return p[3] * (1 - t * t * (3 - 2 * t));
  }
  /** distância do ponto (m, z) à laje do tabuleiro (0 dentro dela) */
  distLaje(m: number, z: number) {
    const p = this.ponte, dm = m < p[0] ? p[0] - m : m > p[1] ? m - p[1] : 0, dz = z > 0 ? z : z < -p[2] ? -p[2] - z : 0;
    return Math.sqrt(dm * dm + dz * dz);
  }
}

