// Menu de tipos de motor: a porta de entrada do site.
import { TIPOS } from './tipos';

export function Menu() {
  return (
    <div className="menu">
      <header className="bar">
        <div className="brand">
          <span className="logo">Motores</span>
          <span className="plate">som sintetizado a partir da física · nada é gravação</span>
        </div>
      </header>
      <main>
        <p className="intro">Escolha um tipo de motor. Cada som é criado na hora pelo computador, a partir de como o motor funciona de verdade, e muda sozinho quando você muda qualquer peça. Use fone de ouvido e comece com o volume baixo.</p>
        <ul className="tipos">
          {TIPOS.map((t) => {
            const corpo = (
              <>
                <span className="nome">{t.nome}</span>
                <span className="desc">{t.descricao}</span>
                <span className="ex"><span className="k">Exemplos</span> {t.exemplos}</span>
                {!t.pagina && <span className="obra">em construção</span>}
              </>
            );
            return (
              <li key={t.id}>
                {t.pagina
                  ? <a className="tipo" href={t.pagina}>{corpo}</a>
                  : <div className="tipo" aria-disabled="true">{corpo}</div>}
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
