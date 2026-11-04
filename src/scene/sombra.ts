// Sombra do próprio corpo (CENA.md 2.5): barreira de Maekawa.
//   número de Fresnel N = 2δ/λ, δ = caminho contornando a borda − caminho direto
//   atenuação A = 10·log₁₀(3 + 20N) dB para N > 0, limitada a 24 dB
// O corpo é a seção retangular do segmento (|y| ≤ largura/2, zPiso ≤ z ≤ altura), extrudada ao longo
// de x. O caminho contornado no plano y-z é a corrente do fecho convexo de {fonte, ouvinte, 4 cantos}
// por cima e por baixo; em 3D as bordas são paralelas a x, então o caminho desdobrado é
// √(Δx² + P²) contra √(Δx² + D²) do direto. Vale o MENOR A dos dois caminhos (o som escolhe o mais fácil).
//
// Fora da sombra (zona iluminada, perto da borda) usa a extensão de Kurze–Anderson, para não haver
// salto de 4,8 dB quando a linha de visada raspa a borda: A = 4,77 + 20·log₁₀(x/tan x), x = √(2π|N|), |N| < 0,2.
//
// Realização (decisão): shelf de 1 polo em f_s = 400 Hz, y = b·x + (a − b)·lp(x). O CENA.md fixa
// a = A(100 Hz) e b = A(1 kHz); com um só polo isso erra até 2,5 dB em 1 kHz quando a diferença é
// grande (o shelf ainda não chegou a b em 1 kHz). Aqui a e b são resolvidos para que a RESPOSTA do
// shelf dê A(100) e A(1k) exatamente (|H|² é linear em a² e b²), com b no máximo 6 dB abaixo de A(1k).
import { C_SOM } from './constantes';

const LIM_DB = 24;

/** Maekawa (shadow, δ ≥ 0) com a extensão iluminada (δ < 0), em dB. */
export function maekawaDb(delta: number, f: number, c = C_SOM) {
  const N = (2 * delta * f) / c;
  if (N >= 0) return Math.min(LIM_DB, 10 * Math.log10(3 + 20 * N));
  if (N <= -0.2) return 0;
  const x = Math.sqrt(2 * Math.PI * -N);
  return Math.max(0, 4.77 + 20 * Math.log10(x / Math.tan(x)));
}

/** Ganhos do shelf (a abaixo, b acima de 400 Hz) que reproduzem A100 e A1k na resposta. */
export function ganhosShelf(a100Db: number, a1kDb: number, out: { a: number; b: number }) {
  const u1 = 100 / 400, u2 = 1000 / 400;
  const T1 = Math.pow(10, -a100Db / 20), T2 = Math.pow(10, -a1kDb / 20);
  let b2 = (T2 * T2 * (1 + u2 * u2) - T1 * T1 * (1 + u1 * u1)) / (u2 * u2 - u1 * u1);
  const piso = 0.25 * T2 * T2;
  if (b2 < piso) b2 = piso;
  let a2 = T1 * T1 * (1 + u1 * u1) - b2 * u1 * u1;
  if (a2 < 0) a2 = 0;
  out.a = Math.min(1, Math.sqrt(a2)); out.b = Math.min(1, Math.sqrt(b2));
}

/** Calcula δ e A(100), A(1k) para uma fonte e um ouvinte no referencial local do corpo. Sem alocação. */
export class CalculoSombra {
  // pontos (y, z): 0 = fonte, 1 = ouvinte, 2..5 = cantos
  private py = new Float64Array(6);
  private pz = new Float64Array(6);
  private ord = new Int32Array(6);
  private hull = new Int32Array(14);
  delta = -1;          // m, o menor dos dois caminhos (negativo: iluminado)
  a100 = 0; a1k = 0;   // dB
  sombreado = false;

  calcular(ys: number, zs: number, yo: number, zo: number, dx: number, largura: number, altura: number, zPiso: number) {
    const hw = largura / 2;
    this.sombreado = false; this.delta = -1; this.a100 = 0; this.a1k = 0;
    // um corpo muito menor que os comprimentos de onda de interesse não faz sombra (Maekawa supõe barreira grande)
    if (largura < 0.1 || altura - zPiso < 0.1) return;
    const dentro = (y: number, z: number) => y > -hw && y < hw && z > zPiso && z < altura;
    if (dentro(ys, zs) || dentro(yo, zo)) return;
    const D2 = (yo - ys) * (yo - ys) + (zo - zs) * (zo - zs), D = Math.sqrt(D2);
    const dx2 = dx * dx, direto = Math.sqrt(dx2 + D2);
    const temBaixo = zPiso >= 0.05;
    if (!this.cruza(ys, zs, yo, zo, -hw, hw, zPiso, altura)) {
      // iluminado: δ < 0 medido pelo canto mais próximo da linha de visada
      let melhor = Infinity;
      for (let k = 0; k < 4; k++) {
        const cy = k & 1 ? hw : -hw, cz = k & 2 ? altura : zPiso;
        if (!temBaixo && !(k & 2)) continue;
        const p = Math.hypot(cy - ys, cz - zs) + Math.hypot(yo - cy, zo - cz);
        const d3 = Math.sqrt(dx2 + p * p) - direto;
        if (d3 < melhor) melhor = d3;
      }
      if (!isFinite(melhor)) return;
      this.delta = -melhor;
      this.a100 = maekawaDb(-melhor, 100); this.a1k = maekawaDb(-melhor, 1000);
      return;
    }
    // sombra: as duas correntes do fecho convexo entre a fonte e o ouvinte
    const py = this.py, pz = this.pz;
    py[0] = ys; pz[0] = zs; py[1] = yo; pz[1] = zo;
    py[2] = -hw; pz[2] = zPiso; py[3] = hw; pz[3] = zPiso; py[4] = -hw; pz[4] = altura; py[5] = hw; pz[5] = altura;
    const n = this.fecho();
    const H = this.hull;
    let iS = -1, iO = -1;
    for (let k = 0; k < n; k++) { if (H[k] === 0) iS = k; else if (H[k] === 1) iO = k; }
    if (iS < 0 || iO < 0) return;   // degenerado: trata como iluminado
    // corrente 1: de iS andando para a frente até iO; corrente 2: para trás
    let best = Infinity;
    for (let sentido = 1; sentido >= -1; sentido -= 2) {
      let p = 0, k = iS, usaBaixo = false;
      while (k !== iO) {
        const k2 = (k + sentido + n) % n;
        p += Math.hypot(py[H[k2]] - py[H[k]], pz[H[k2]] - pz[H[k]]);
        if (H[k2] === 2 || H[k2] === 3) usaBaixo = true;
        k = k2;
      }
      if (usaBaixo && !temBaixo) continue;
      const d3 = Math.sqrt(dx2 + p * p) - direto;
      if (d3 < best) best = d3;
    }
    if (!isFinite(best)) best = 10;   // sem caminho: bloqueio total
    this.sombreado = true;
    this.delta = best;
    this.a100 = maekawaDb(best, 100); this.a1k = maekawaDb(best, 1000);
    void D;
  }

  /** o segmento S–O cruza o interior do retângulo? (Liang–Barsky) */
  private cruza(y0: number, z0: number, y1: number, z1: number, ya: number, yb: number, za: number, zb: number) {
    const dy = y1 - y0, dz = z1 - z0;
    let t0 = 0, t1 = 1;
    // (sem arrays: isto roda por fonte a cada bloco de controle)
    for (let i = 0; i < 4; i++) {
      const p = i === 0 ? -dy : i === 1 ? dy : i === 2 ? -dz : dz;
      const q = i === 0 ? y0 - ya : i === 1 ? yb - y0 : i === 2 ? z0 - za : zb - z0;
      if (Math.abs(p) < 1e-12) { if (q <= 0) return false; continue; }
      const r = q / p;
      if (p < 0) { if (r > t0) t0 = r; } else if (r < t1) t1 = r;
      if (t0 >= t1) return false;
    }
    return t1 - t0 > 1e-9;
  }

  /** fecho convexo (cadeia monótona) dos 6 pontos, em this.hull, sentido anti-horário; devolve o tamanho */
  private fecho() {
    const py = this.py, pz = this.pz, o = this.ord, H = this.hull;
    for (let i = 0; i < 6; i++) o[i] = i;
    for (let i = 1; i < 6; i++) {
      const v = o[i]; let j = i - 1;
      while (j >= 0 && (py[o[j]] > py[v] || (py[o[j]] === py[v] && pz[o[j]] > pz[v]))) { o[j + 1] = o[j]; j--; }
      o[j + 1] = v;
    }
    const cross = (a: number, b: number, c: number) => (py[b] - py[a]) * (pz[c] - pz[a]) - (pz[b] - pz[a]) * (py[c] - py[a]);
    let k = 0;
    for (let i = 0; i < 6; i++) { while (k >= 2 && cross(H[k - 2], H[k - 1], o[i]) <= 1e-12) k--; H[k++] = o[i]; }
    for (let i = 4, t = k + 1; i >= 0; i--) { while (k >= t && cross(H[k - 2], H[k - 1], o[i]) <= 1e-12) k--; H[k++] = o[i]; }
    return k - 1;
  }
}
