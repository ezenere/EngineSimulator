// Absorção do ar por banda (CENA.md 2.3): ISO 9613-1, 20 °C, 1 atm.
// Realização por fonte (decisão): dois passa-baixas de 1 polo em cascata. O corte f_c(r) é a
// frequência em que a absorção chega a 3 dB:
//     f_c(r) = 1000·(3/(α₁ₖ·r))^(1/1,6) Hz, limitado a [600, 20000]
// e cada polo fica em f_c/0,6436, para que a CASCATA tenha −3 dB em f_c (dois polos em f_c dariam −6 dB).
// Com isso a diferença 4 kHz − 500 Hz bate com a ISO a 30 m e a 300 m; a 1500 m a ISO pede 46,7 dB
// e dois polos não passam de 36 dB em nenhuma posição de corte (ver docs/TECNICO.md, Cena e portadores).

/** Tabela ISO 9613-1 em dB/km: linhas UR 30/60/80 %, colunas 125, 250, 500, 1k, 2k, 4k, 8k Hz. */
export const ISO_FREQ = [125, 250, 500, 1000, 2000, 4000, 8000] as const;
export const ISO_UR = [30, 60, 80] as const;
export const ISO_DB_KM: readonly (readonly number[])[] = [
  [0.4, 1.2, 2.4, 4.7, 12, 42, 140],
  [0.4, 1.0, 1.9, 3.7, 9.7, 33, 117],
  [0.3, 1.1, 2.8, 5.0, 9.0, 23, 77],
];

/** α em dB/km numa banda da tabela, interpolando linearmente na umidade (fora da faixa, o extremo). */
export function alfaIso(ur: number, banda: number) {
  if (ur <= 30) return ISO_DB_KM[0][banda];
  if (ur >= 80) return ISO_DB_KM[2][banda];
  if (ur <= 60) { const t = (ur - 30) / 30; return ISO_DB_KM[0][banda] * (1 - t) + ISO_DB_KM[1][banda] * t; }
  const t = (ur - 60) / 20; return ISO_DB_KM[1][banda] * (1 - t) + ISO_DB_KM[2][banda] * t;
}

/** α em 1 kHz, dB/m */
export const alfa1k = (ur: number) => alfaIso(ur, 3) / 1000;

/** corte (−3 dB) da absorção à distância r (m) */
export function corteAr(r: number, ur = 60) {
  const fc = 1000 * Math.pow(3 / (alfa1k(ur) * Math.max(r, 0.1)), 1 / 1.6);
  return Math.min(20000, Math.max(600, fc));
}

/** razão entre o corte de cada polo e o −3 dB da cascata de dois polos iguais: 1/√(√2 − 1) */
export const POLO_POR_CORTE = 1 / Math.sqrt(Math.SQRT2 - 1);   // 1,554

/** Atenuação teórica ISO (dB) a uma distância r numa frequência f (interpolação log-log na tabela). */
export function atenuacaoIso(f: number, r: number, ur = 60) {
  const lf = Math.log(f);
  let i = 0;
  while (i < ISO_FREQ.length - 2 && f > ISO_FREQ[i + 1]) i++;
  const f0 = ISO_FREQ[i], f1 = ISO_FREQ[i + 1];
  const a0 = alfaIso(ur, i), a1 = alfaIso(ur, i + 1);
  const t = (lf - Math.log(f0)) / (Math.log(f1) - Math.log(f0));
  const a = Math.exp(Math.log(a0) * (1 - t) + Math.log(a1) * t);
  return (a * r) / 1000;
}
