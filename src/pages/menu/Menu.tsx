// Menu de tipos de motor: a porta de entrada do site. A barra é a mesma das outras páginas (com a faixa de navegação);
// cada cartão diz o que é, mostra exemplos e leva à página.
import { Barra } from '../../ui';
import { Icone } from './Icones';
import { TIPOS } from './tipos';

export function Menu() {
  return (
    <div className="menu">
      <Barra logo="Motores" placa="som de motor criado na hora, a partir da física" />
      <main>
        <section className="abre" aria-label="Sobre o site">
          <p className="chamada">Nada aqui é gravação. Cada som nasce no seu navegador, de como o motor funciona de verdade: as explosões nos cilindros, o gás no escapamento, as pás da turbina. Por isso ele muda sozinho quando você troca qualquer peça.</p>
          <ul className="dicas">
            <li><b>Use fone de ouvido.</b> O som tem esquerda e direita.</li>
            <li><b>Comece com o volume baixo.</b> Caça, trem-bala e estrondo sônico são altos.</li>
            <li><b>Melhor no computador,</b> com teclado. Também abre no celular.</li>
          </ul>
        </section>
        <h2 className="so-leitor">Tipos de motor</h2>
        <ul className="tipos">
          {TIPOS.map((t) => (
            <li key={t.id}>
              <a className="tipo" href={t.pagina}>
                <span className="topo">
                  <Icone id={t.id} />
                  <span className="titulo">
                    <span className="nome">{t.nome}</span>
                    <span className="sub">{t.subtitulo}</span>
                  </span>
                </span>
                <span className="desc">{t.descricao}</span>
                <span className="ex" aria-label={`Exemplos: ${t.exemplos.join(', ')}`}>
                  {t.exemplos.map((e) => <span key={e} aria-hidden="true">{e}</span>)}
                </span>
                <span className="abrir" aria-hidden="true">Abrir</span>
              </a>
            </li>
          ))}
        </ul>
        <footer className="rodape">
          <p>Em cada página: escolha um preset no topo, ligue no botão à direita e use o teclado (as teclas aparecem embaixo dos instrumentos). O painel lateral muda as peças do motor, o lugar e de onde você ouve.</p>
        </footer>
      </main>
    </div>
  );
}
