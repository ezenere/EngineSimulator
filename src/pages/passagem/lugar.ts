// O lugar por onde o observador anda (a pé ou voando): a altura do chão em cada ponto e as paredes, por ambiente. A cena
// 3D desenha as mesmas medidas (as constantes daqui), para o que se vê e o que se pisa serem o mesmo lugar. Sem three.js:
// o observador e o lugar rodam também sem WebGL e no Node.
//
// Coordenadas da via: `s` (abscissa, a da Cena) e `m`, a distância à linha da via medida para o lado do ponto de chegada
// (positivo do lado do observador, negativo do outro). Na reta, m = −y; na volta, m é a distância para fora do oval.
// No mundo, um ponto (s, m) fica em via.ponto(s) + n·normal, com n = −sentido·m.
//
// Regra: o observador nasce onde uma pessoa de verdade ficaria para ver (a calçada, a plataforma, a passarela do túnel,
// o passeio da ponte), nunca em cima da via, e pode descer para a via se quiser. A passarela e o passeio vão até o ponto
// de chegada (`mChegada`): quem dizia "a 3 m" nasce a 3 m, em cima deles.
//
// Por ambiente (os da Passagem, CENA.md 2.10):
//   céu aberto: chão em 0;
//   corte: o fundo da trincheira até 8 m da via, taludes a 45° até 20 m, o alto a 12 m (dá para subir o talude);
//   estação: plataforma de PLATAFORMA m do lado do observador (da borda a 0,35 m do corpo até 8 m), parede do fundo e
//            cobertura a 7 m (não se atravessa nem voando);
//   túnel: a seção de secaoTunel (a da Cena), da boca à outra boca; do lado do observador, a passarela de serviço
//          (TUNEL.passarela acima da via, da borda até a parede) e os nichos de refúgio na parede a cada TUNEL.nicho.cada
//          m perto do ponto de chegada; dentro, entre as paredes (e os nichos) e abaixo do teto; de fora, só pela boca;
//   ponte: tabuleiro de −3,7 a +8,5 m da via, com o passeio de pedestres (meio-fio de PONTE.meioFio) do lado do
//          observador e guarda-corpo dos dois lados; a segunda via cabe entre a via e o passeio quando ele não chega
//          perto demais; embaixo, o vale.
// Limites suaves no resto: até LIMITE_LATERAL da via e até a ponta da reta.
import type { Via } from '../../scene/trajetoria';
import { PontoVia } from '../../scene/trajetoria';
import { secaoTunel } from '../../scene/ambientes';
import type { Tunel } from '../../scene/tipos';

/** m, altura da plataforma da estação (a borda junto do piso do trem) */
export const PLATAFORMA = 0.9;
/** estação: extensão ao longo da via (m, de −a a +a), largura da plataforma, altura da cobertura */
export const ESTACAO = { meio: 160, largura: 8, folga: 0.35, teto: 7, fundo: 2 } as const;
/**
 * túnel: a passarela de serviço (altura acima do piso da via; a borda do lado da via, que chega até 0,6 m antes do
 * ponto de chegada, nunca a menos de `bordaMin` da via) e os nichos de refúgio na parede (a cada `cada` m, até `raio` m
 * do ponto de chegada: largura ao longo da via, fundo, altura acima da passarela)
 */
export const TUNEL = { passarela: 0.75, borda: 3.2, bordaMin: 2.0, corrimao: 1.0, nicho: { cada: 50, largura: 2.2, fundo: 1.1, altura: 2.3, raio: 400 } } as const;
/** ponte: o tabuleiro (m), o passeio (a borda dele do lado da via e o meio-fio), o guarda-corpo, o vale */
export const PONTE = { longe: -3.7, perto: 8.5, espessura: 1.6, vale: -28, guarda: 1.1, passeio: 5.9, passeioMin: 2.4, meioFio: 0.2 } as const;
/** m: a segunda via (túnel e ponte de via dupla) e a meia largura do lastro dela */
export const SEGUNDA_VIA = 4.3, MEIO_LASTRO = 1.4;
/** corte: o fundo até `m0`, o talude até `m1`, a altura do alto */
export const CORTE = { m0: 8, m1: 20, alto: 12 } as const;
/** m: até onde o observador se afasta da via (a Cena segue o corpo até DIST_LIVRE) */
export const LIMITE_LATERAL = 280;
/** m: o observador não encosta nas paredes */
const FOLGA = 0.3;

export interface ParamsLugar {
  ambiente: string; via: Via; tunel?: Tunel; larguraCorpo: number;
  /** m da via do ponto de chegada (lateral + meia largura do corpo): a passarela e o passeio chegam até ele */
  mChegada: number;
}

export class Lugar {
  readonly amb: string;
  private via: Via; private pv = new PontoVia();
  /** túnel: boca, outra boca, paredes (m), altura, borda da passarela */
  readonly tun: { ta: number; tb: number; mPerto: number; mLonge: number; h: number; borda: number } | null = null;
  private borda: number;
  /** ponte: a borda do passeio do lado da via, e se a segunda via cabe antes dele */
  readonly passeio: number;
  readonly segundaViaNaPonte: boolean;
  constructor(p: ParamsLugar) {
    this.amb = p.ambiente; this.via = p.via;
    this.borda = p.larguraCorpo / 2 + ESTACAO.folga;
    if (p.tunel) {
      const sec = secaoTunel(p.tunel.area), mPerto = -sec.paredeOuvinte;
      // (paredeOuvinte é negativa na normal da via do lado do ouvinte: em m ela fica positiva)
      const borda = Math.max(TUNEL.bordaMin, Math.min(TUNEL.borda, p.mChegada - 0.6, mPerto - 1));
      this.tun = { ta: p.tunel.xEntrada, tb: p.tunel.xEntrada + p.tunel.comprimento, mPerto, mLonge: -sec.paredeOposta, h: sec.altura, borda };
    }
    this.passeio = Math.max(PONTE.passeioMin, Math.min(PONTE.passeio, p.mChegada - 0.6));
    this.segundaViaNaPonte = this.passeio >= SEGUNDA_VIA + MEIO_LASTRO + 0.2;
  }

  /** borda da plataforma da estação (m) */
  get bordaPlataforma() { return this.borda; }
  /**
   * a distância da via, a partir de `m` e para fora, onde uma pessoa fica para ver: a passarela do túnel, o passeio da
   * ponte, a plataforma; nunca em cima de uma via
   */
  paraFicar(m: number) {
    if (this.tun) return Math.max(m, this.tun.borda + 0.5);
    if (this.amb === 'ponte') return Math.max(m, this.passeio + 0.6);
    if (this.amb === 'estacao') return Math.max(m, this.borda + 0.8);
    return m;
  }

  /** (s, m) de um ponto do mundo; na volta, pelo pedaço do oval mais perto */
  projetar(x: number, y: number, out: { s: number; m: number } = { s: 0, m: 0 }) {
    const v = this.via;
    if (v.tipo === 'reta') { out.s = v.sentido * x; out.m = -y; return out; }
    const R = v.R, h = v.ls / 2, arco = Math.PI * R;
    // w: comprimento desde o começo da reta de baixo, no sentido anti-horário (o de pontoV)
    let w: number, m: number;
    if (x >= -h && x <= h) {
      if (y <= 0) { w = x + h; m = -(y + R); } else { w = v.ls + arco + (h - x); m = y - R; }
    } else if (x > h) { const a = Math.atan2(y, x - h); w = v.ls + R * (a + Math.PI / 2); m = Math.hypot(x - h, y) - R; }
    else { let a = Math.atan2(y, x + h); if (a < 0) a += 2 * Math.PI; w = 2 * v.ls + arco + R * (a - Math.PI / 2); m = Math.hypot(x + h, y) - R; }
    out.s = v.sentido * (w - h); out.m = m;
    return out;
  }

  /** ponto do mundo na abscissa s, a m da via (para o lado do observador), na altura z */
  mundo(s: number, m: number, z: number, out: [number, number, number] = [0, 0, 0]) {
    // (na reta, sem reduzir s à via: a ponta s = comprimento/2 é a ponta, não o começo do outro lado, onde a última
    // fatia de um prisma até a ponta virava uma folha atravessando o lugar inteiro)
    if (this.via.tipo === 'reta') { const sg = this.via.sentido; out[0] = sg * s; out[1] = -m; out[2] = z; return out; }
    const p = this.via.ponto(s, this.pv), n = -this.via.sentido * m;
    out[0] = p.x + n * p.nx; out[1] = p.y + n * p.ny; out[2] = z;
    return out;
  }
  /** rumo (rad) da via na abscissa s, no sentido em que o corpo anda */
  rumoVia(s: number) { const p = this.via.ponto(s, this.pv); return Math.atan2(p.ty, p.tx); }

  /** s está dentro do trecho [a, b] da via (a volta é periódica) */
  private noTrecho(s: number, a: number, b: number) {
    if (this.via.tipo === 'reta') return s >= a && s <= b;
    const L = this.via.comp; let u = (s - a) % L; if (u < 0) u += L;
    return u <= b - a;
  }

  /** as abscissas dos nichos do túnel (perto do ponto de chegada, dentro do túnel) */
  nichos(): number[] {
    const t = this.tun; if (!t) return [];
    const n = TUNEL.nicho, l: number[] = [];
    for (let s = -n.raio; s <= n.raio; s += n.cada) if (this.noTrecho(s - n.largura, t.ta, t.tb) && this.noTrecho(s + n.largura, t.ta, t.tb)) l.push(s);
    return l;
  }
  /** o nicho cujo vão contém s (a abscissa dele), ou NaN */
  private nichoEm(s: number, folga = 0) {
    const t = this.tun; if (!t) return NaN;
    const n = TUNEL.nicho, c = Math.round(s / n.cada) * n.cada;
    if (Math.abs(c) > n.raio || Math.abs(s - c) > n.largura / 2 - folga) return NaN;
    return this.noTrecho(c - n.largura, t.ta, t.tb) && this.noTrecho(c + n.largura, t.ta, t.tb) ? c : NaN;
  }

  /** altura do chão onde se pisa (a pé) no ponto (x, y) do mundo */
  chao(x: number, y: number): number {
    const q = this.projetar(x, y);
    return this.chaoSM(q.s, q.m);
  }
  private chaoSM(s: number, m: number): number {
    if (this.amb === 'corte') { const a = Math.abs(m); return a <= CORTE.m0 ? 0 : a >= CORTE.m1 ? CORTE.alto : (a - CORTE.m0) * (CORTE.alto / (CORTE.m1 - CORTE.m0)); }
    if (this.amb === 'estacao' && this.noTrecho(s, -ESTACAO.meio, ESTACAO.meio) && m >= this.borda && m <= this.borda + ESTACAO.largura + ESTACAO.fundo) return PLATAFORMA;
    if (this.amb === 'ponte') return m >= this.passeio && m <= PONTE.perto ? PONTE.meioFio : m >= PONTE.longe && m <= PONTE.perto ? 0 : PONTE.vale;
    const t = this.tun;
    if (t && m >= t.borda && this.noTrecho(s, t.ta, t.tb) && (m <= t.mPerto || (m <= t.mPerto + TUNEL.nicho.fundo && !Number.isNaN(this.nichoEm(s))))) return TUNEL.passarela;
    return 0;
  }

  /**
   * Corrige o passo do observador de `ant` para `nova` (olho no mundo, em metros): paredes, nichos, guarda-corpo, teto,
   * chão e os limites. `voo`: anda no ar (o chão é só o piso mínimo); a pé, a altura é a do chão mais `olho`.
   */
  limitar(ant: readonly number[], nova: number[], voo: boolean, olho: number) {
    const a = this.projetar(ant[0], ant[1], { s: 0, m: 0 }), b = this.projetar(nova[0], nova[1], { s: 0, m: 0 });
    let s = b.s, m = b.m;
    const L = this.via.comp;
    // limites suaves: a ponta da reta e a distância lateral
    if (this.via.tipo === 'reta') s = Math.max(-L / 2 + 20, Math.min(L / 2 - 20, s));
    m = Math.max(-LIMITE_LATERAL, Math.min(LIMITE_LATERAL, m));
    let z = nova[2];
    // ponte: a pé não se sai do tabuleiro (guarda-corpo); voando, sim
    if (this.amb === 'ponte' && !voo) m = Math.max(PONTE.longe + FOLGA, Math.min(PONTE.perto - FOLGA, m));
    // estação: a parede do fundo e a cobertura; por baixo da cobertura, voando, até o teto
    if (this.amb === 'estacao') {
      const fundo = this.borda + ESTACAO.largura + ESTACAO.fundo;
      const dentroA = this.noTrecho(a.s, -ESTACAO.meio, ESTACAO.meio), dentroB = this.noTrecho(s, -ESTACAO.meio, ESTACAO.meio);
      if (dentroB || dentroA) {
        const sobA = a.m < fundo && ant[2] < ESTACAO.teto;
        // atravessar a parede do fundo
        if ((a.m < fundo) !== (m < fundo) && (z < ESTACAO.teto + 0.5 || ant[2] < ESTACAO.teto + 0.5)) m = a.m < fundo ? fundo - FOLGA : fundo + FOLGA;
        // atravessar a cobertura (de cima para baixo ou de baixo para cima)
        if (m < fundo && m > -4) {
          if (sobA && z > ESTACAO.teto - FOLGA) z = ESTACAO.teto - FOLGA;
          else if (!sobA && ant[2] >= ESTACAO.teto && z < ESTACAO.teto + 0.4) z = ESTACAO.teto + 0.4;
        }
      }
    }
    // túnel: dentro, entre as paredes (e o fundo dos nichos) e abaixo do teto; de fora, só pela boca
    const t = this.tun;
    if (t) {
      const naFaixaA = this.noTrecho(a.s, t.ta, t.tb), naFaixaB = this.noTrecho(s, t.ta, t.tb);
      const dentroA = naFaixaA && a.m > t.mLonge && a.m < t.mPerto + TUNEL.nicho.fundo && ant[2] < t.h;
      if (dentroA && naFaixaB) {
        // dentro de um nicho (além da parede): as laterais e o teto dele seguram
        if (a.m > t.mPerto - FOLGA * 0.5 && !Number.isNaN(this.nichoEm(a.s))) {
          const c = this.nichoEm(a.s), meia = TUNEL.nicho.largura / 2 - FOLGA;
          if (m > t.mPerto - FOLGA) s = Math.max(c - meia, Math.min(c + meia, s));
          z = Math.min(z, TUNEL.passarela + TUNEL.nicho.altura - FOLGA);
        }
        const fundo = !Number.isNaN(this.nichoEm(s, FOLGA)) && (z < TUNEL.passarela + TUNEL.nicho.altura) ? t.mPerto + TUNEL.nicho.fundo : t.mPerto;
        m = Math.max(t.mLonge + FOLGA, Math.min(fundo - FOLGA, m));
        z = Math.min(t.h - FOLGA, z);
      } else if (!dentroA && naFaixaB && naFaixaA) {
        // de fora, ao lado ou em cima do tubo: não atravessa a parede nem o teto
        const dentroB = m > t.mLonge - FOLGA && m < t.mPerto + FOLGA && z < t.h + FOLGA;
        if (dentroB) {
          if (ant[2] >= t.h + FOLGA * 0.5) z = t.h + FOLGA;
          else m = a.m >= t.mPerto ? t.mPerto + FOLGA : a.m <= t.mLonge ? t.mLonge - FOLGA : a.m;
        }
      }
    }
    // o chão: a pé, a altura é a do chão onde pisa; voando, não desce abaixo dele
    const ch = this.chaoSM(s, m);
    if (!voo) z = ch + olho;
    else z = Math.max(ch + 0.3, Math.min(600, z));
    this.mundo(s, m, z, nova as [number, number, number]);
  }
}
