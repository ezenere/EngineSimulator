// Resolvedor fechado do tempo de emissão para M ≥ 0,9 e o estrondo sônico (CENA.md 2.1 e 6), copiados
// de `geom()` e `triggerBoom()` do jet-dsp.js sem mudar a aritmética (decisão: "não se mexe nela").
//
//   c·s = |fonte(t − s) − ouvinte|  ⇒  (c² − v²)s² + 2·A·v·s − (A² + Q) = 0
//   A = posição atual da fonte ao longo da rota, relativa ao ponto mais próximo do ouvinte;
//   Q = distância² da rota ao ouvinte (lateral² + altura²)
// Abaixo de Mach 1 há uma raiz; acima, nenhuma antes do cone (silêncio), duas iguais na cáustica (o
// estrondo) e duas depois (a do som "indo" e a do som "chegando", que toca de trás para frente).
//
// TODO (integração): o Propagador usa o ponto fixo (M < 0,9). Para a Turbina supersônica, a Cena tem de
// trocar, por fonte, para estas raízes (até duas leituras por caminho) quando M ≥ 0,9; isso depende das
// fontes do JetDSP separadas (migração da Turbina). Os testes conferem o instante do cone contra o legado.
import { clamp } from '../acoustics/util';

/** C0 da Turbina legada (340 m/s), mantido para o resolvedor copiado */
export const C0_TURBINA = 340;

/** raízes positivas (s) em ordem decrescente (a de maior atraso primeiro); `cone` = disc ≥ 0 com A > 0 */
export function raizesEmissao(A: number, v: number, Q: number, out: Float64Array, c = C0_TURBINA) {
  const a = c * c - v * v, b = 2 * A * v, cq = -(A * A + Q);
  let n = 0, cone = false;
  if (Math.abs(a) < 1e-3) { if (b > 0) out[n++] = -cq / b; }
  else {
    const disc = b * b - 4 * a * cq;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const r1 = (-b - sq) / (2 * a), r2 = (-b + sq) / (2 * a);
      if (r1 > 0) out[n++] = r1;
      if (r2 > 0) out[n++] = r2;
    }
    cone = v > c && disc >= 0 && A > 0;
  }
  if (n === 2 && out[1] > out[0]) { const t = out[0]; out[0] = out[1]; out[1] = t; }
  return { n, cone };
}

/** amplificação de fonte em movimento com o limite na cáustica, como no legado */
export const convJato = (M: number, cth: number) => Math.min(4, Math.pow(Math.max(0.05, Math.abs(1 - M * cth)), -1.4));

/**
 * Parâmetros do estrondo (regra de Carlson para o campo distante), como `triggerBoom`:
 *   Δp ≈ 1,9·Ks·p0·(M² − 1)^⅛·(l/h)^¾ ;  T ≈ 0,0042·l·M/(M² − 1)^⅜·(h/300)^¼ (limitado a 30–450 ms)
 */
export function parametrosEstrondo(M: number, h: number, l = 30, ks = 0.09) {
  const m2 = Math.max(0.02, M * M - 1);
  const dp = 1.9 * ks * 101325 * Math.pow(m2, 1 / 8) * Math.pow(l / h, 0.75);
  const T = clamp((0.0042 * l * M) / Math.pow(m2, 3 / 8) * Math.pow(h / 300, 0.25), 0.03, 0.45);
  const rise = 0.0003 + 0.002 * Math.pow(h / 1000, 1.3);
  return { dp, T, dB: 20 * Math.log10(dp / 2e-5), subida: rise };
}
