// Bloco do painel de controles: <section class="group"> com título. Com `recolhivel`, o título é um botão que abre e
// fecha o conteúdo (começa fechado, a menos de `aberta`).
import { useId, useState, type ReactNode } from 'react';

export function Section({ titulo, children, recolhivel, aberta = false, idBotao, classe = '' }: {
  titulo: string;
  children?: ReactNode;
  recolhivel?: boolean;
  aberta?: boolean;
  idBotao?: string; // id do botão do título (seção recolhível)
  classe?: string;
}) {
  const [abre, setAbre] = useState(aberta);
  const corpo = useId();
  if (!recolhivel) {
    return (
      <section className={`group ${classe}`.trim()}>
        <h2>{titulo}</h2>
        {children}
      </section>
    );
  }
  return (
    <section className={`group ${classe}`.trim()}>
      <h2><button type="button" id={idBotao} className="dobra" aria-expanded={abre} aria-controls={corpo} onClick={() => setAbre(!abre)}>{titulo}</button></h2>
      {abre && <div id={corpo} style={{ display: 'contents' }}>{children}</div>}
    </section>
  );
}
