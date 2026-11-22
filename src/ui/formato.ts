// Formatação de números e listas para a interface, em pt-BR (vírgula decimal, ponto de milhar).

/** número com `casas` decimais fixas e vírgula: 6.2 → "6,20" (sem separador de milhar) */
export const dec = (v: number, casas = 1) => v.toFixed(casas).replace('.', ',');

/** número inteiro ou com até `casas` decimais, com ponto de milhar: 12142 → "12.142" */
export const num = (v: number, casas = 0) => v.toLocaleString('pt-BR', { maximumFractionDigits: casas, minimumFractionDigits: 0 });

/** um ângulo em graus, sem zeros sobrando: 90 → "90°", 22.5 → "22,5°" */
export const grau = (x: number) => `${String(Math.round(x * 10) / 10).replace('.', ',')}°`;

/**
 * Lista de intervalos em graus do jeito mais curto que ainda diz tudo:
 * todos iguais → "8 × 90°"; um padrão que se repete → "(67,5° 22,5°) × 4"; poucos → a lista; muitos → a faixa.
 */
export function resumoGraus(xs: number[], maxLista = 10): string {
  if (!xs.length) return '—';
  const r = xs.map((x) => Math.round(x * 10) / 10);
  if (r.every((x) => x === r[0])) return r.length === 1 ? grau(r[0]) : `${r.length} × ${grau(r[0])}`;
  for (let p = 2; p <= 4 && p * 2 <= r.length; p++) {
    if (r.length % p === 0 && r.every((x, i) => x === r[i % p])) return `(${r.slice(0, p).map(grau).join(' ')}) × ${r.length / p}`;
  }
  if (r.length <= maxLista) return r.map(grau).join(' ');
  return `${r.length} de ${grau(Math.min(...r))} a ${grau(Math.max(...r))}`;
}

/** a lista inteira, para a dica (title) de uma leitura resumida */
export const listaGraus = (xs: number[]) => xs.map(grau).join(' ');
