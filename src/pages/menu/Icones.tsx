// Ícones do menu: um desenho de traço por tipo de motor, na mesma grade de 48 × 48 e com a mesma espessura.
// A cor vem de `currentColor` (o dourado do cartão); `em` marca o detalhe em vermelho (faixa vermelha, chama).
import type { ReactNode } from 'react';

export type IdIcone = 'ronco' | 'turbina' | 'diesel' | 'radial' | 'rotativo' | 'vapor' | 'eletrico' | 'passagem';

const gira = (n: number, f: (i: number) => ReactNode) => Array.from({ length: n }, (_, i) => <g key={i} transform={`rotate(${(360 * i) / n} 24 24)`}>{f(i)}</g>);

const DESENHOS: Record<IdIcone, ReactNode> = {
  // conta-giros com a faixa vermelha
  ronco: (
    <>
      <path d="M11.98 38.02 A17 17 0 1 1 39.4 33.2" />
      <path className="em" d="M39.4 33.2 A17 17 0 0 1 36.02 38.02" />
      <path d="M24 26 L32.4 16" />
      <circle cx="24" cy="26" r="2" fill="currentColor" stroke="none" />
    </>
  ),
  // face do fan
  turbina: (
    <>
      <circle cx="24" cy="24" r="17.5" />
      {gira(9, () => <path d="M25.6 19.4 Q31 13.5 27.2 6.9" />)}
      <circle cx="24" cy="24" r="4.6" />
    </>
  ),
  // cilindro, pistão e o leque do injetor
  diesel: (
    <>
      <path d="M14.5 39 V11.5 H33.5 V39" />
      <rect x="17" y="25" width="14" height="8.5" rx="1.5" />
      <path d="M24 33.5 V41" />
      <path d="M24 6 V12.5" />
      <path className="em" d="M24 14.5 L19.5 21 M24 14.5 V22 M24 14.5 L28.5 21" />
    </>
  ),
  // cilindros em estrela
  radial: (
    <>
      <circle cx="24" cy="24" r="5.2" />
      {gira(7, () => <rect x="21.2" y="5" width="5.6" height="11.5" rx="2" />)}
    </>
  ),
  // rotor de três pontas dentro da carcaça de dois lóbulos
  rotativo: (
    <>
      <path d="M6.5 24 C6.5 12.5 16 8.5 24 11 C32 8.5 41.5 12.5 41.5 24 C41.5 35.5 32 39.5 24 37 C16 39.5 6.5 35.5 6.5 24 Z" />
      <path d="M21 12.6 A20 20 0 0 1 33.4 30 A20 20 0 0 1 11.2 28.6 A20 20 0 0 1 21 12.6 Z" />
      <circle cx="22.4" cy="24.4" r="3.4" />
    </>
  ),
  // roda motriz, biela, cilindro e duas nuvens de vapor
  vapor: (
    <>
      <circle cx="17" cy="30" r="11.5" />
      <circle cx="17" cy="30" r="2.4" />
      <path d="M17 18.5 V27.6 M17 32.4 V41.5 M5.5 30 H14.6 M19.4 30 H28.5" />
      <path d="M22.6 24.6 H35" />
      <circle cx="22.6" cy="24.6" r="1.7" fill="currentColor" stroke="none" />
      <rect x="35" y="20.4" width="9" height="8.4" rx="1.5" />
      <circle className="em" cx="38.5" cy="11.5" r="3.6" />
      <circle className="em" cx="31" cy="7.6" r="2.3" />
    </>
  ),
  // estator com os dentes, rotor e o raio
  eletrico: (
    <>
      <circle cx="24" cy="24" r="17.5" />
      {gira(8, () => <path d="M24 9.5 V13.5" />)}
      <circle cx="24" cy="24" r="8.6" />
      <path className="em" d="M25.6 18.4 L21.2 24.8 H24.6 L22.6 29.8 L27 23.2 H23.8 Z" fill="currentColor" strokeWidth="0.8" />
    </>
  ),
  // frentes de onda apertadas na frente da fonte (Doppler)
  passagem: (
    <>
      <circle cx="30.5" cy="24" r="4.5" />
      <circle cx="27" cy="24" r="9.5" />
      <circle cx="23.5" cy="24" r="14.5" />
      <path d="M12.6 39.6 A19.5 19.5 0 0 1 12.6 8.4" />
      <circle className="em" cx="32.5" cy="24" r="2" fill="currentColor" stroke="none" />
    </>
  ),
};

export function Icone({ id }: { id: IdIcone }) {
  return (
    <svg className="icone" viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {DESENHOS[id]}
    </svg>
  );
}
