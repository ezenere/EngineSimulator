// Barra superior de todas as páginas: em cima, a faixa de navegação do site (o menu e as páginas, com a atual marcada);
// embaixo, o nome da página, a placa com o resumo do que está montado e o botão principal (ignição, partida, disparar).
import type { ReactNode } from 'react';
import { PAGINAS, paginaAtual } from './paginas';

export function Barra({ logo, placa, children }: { logo: string; placa?: ReactNode; children?: ReactNode }) {
  const atual = paginaAtual();
  return (
    <header className="bar">
      <nav className="site" aria-label="Páginas do site">
        <a className="inicio" href="./index.html" aria-current={atual ? undefined : 'page'} title="Menu com todos os tipos de motor">Motores</a>
        <span className="sep" aria-hidden="true" />
        {PAGINAS.map((p) => (
          <a key={p.id} href={`./${p.arquivo}`} aria-current={p === atual ? 'page' : undefined}>{p.nome}</a>
        ))}
      </nav>
      <div className="bar-main">
        <div className="brand">
          <h1 className="logo">{logo}</h1>
          {placa != null && <span className="plate">{placa}</span>}
        </div>
        {children}
      </div>
    </header>
  );
}

/** Botão principal da barra. `estado`: 'ocupado' (carregando, calibrando: a luz pulsa) ou 'erro' (borda vermelha). */
export function BotaoIgnicao({ id, ligado, rotulo, aoClicar, estado }: { id?: string; ligado: boolean; rotulo: string; aoClicar: () => void; estado?: 'ocupado' | 'erro' }) {
  return (
    <button id={id} className="ignition" type="button" aria-pressed={ligado} data-estado={estado} onClick={aoClicar}>
      <span className="dot" aria-hidden="true" /><span>{rotulo}</span>
    </button>
  );
}
