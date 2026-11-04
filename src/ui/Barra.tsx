// Barra superior das páginas de motor: nome, placa com o resumo do motor e botão de ignição.
import type { ReactNode } from 'react';

export function Barra({ logo, placa, children }: { logo: string; placa?: ReactNode; children?: ReactNode }) {
  return (
    <header className="bar">
      <div className="brand">
        <a className="logo" href="./index.html" title="Voltar ao menu de motores" style={{ color: 'inherit', textDecoration: 'none' }}>{logo}</a>
        {placa != null && <span className="plate">{placa}</span>}
      </div>
      {children}
    </header>
  );
}

export function BotaoIgnicao({ id, ligado, rotulo, aoClicar }: { id?: string; ligado: boolean; rotulo: string; aoClicar: () => void }) {
  return (
    <button id={id} className="ignition" type="button" aria-pressed={ligado} onClick={aoClicar}>
      <span className="dot" /><span>{rotulo}</span>
    </button>
  );
}
