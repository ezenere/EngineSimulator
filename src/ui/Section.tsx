// Bloco do painel de controles: <section class="group"> com título.
import type { ReactNode } from 'react';

export function Section({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <section className="group">
      <h2>{titulo}</h2>
      {children}
    </section>
  );
}
