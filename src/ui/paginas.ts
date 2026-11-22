// As páginas do site, na ordem do menu e da faixa de navegação da barra superior.
export type Pagina = { id: string; nome: string; arquivo: string };

export const PAGINAS: Pagina[] = [
  { id: 'ronco', nome: 'Ronco', arquivo: 'ronco.html' },
  { id: 'turbina', nome: 'Turbina', arquivo: 'turbina.html' },
  { id: 'diesel', nome: 'Diesel', arquivo: 'diesel.html' },
  { id: 'radial', nome: 'Radial', arquivo: 'radial.html' },
  { id: 'rotativo', nome: 'Rotativos', arquivo: 'rotativo.html' },
  { id: 'vapor', nome: 'Vapor', arquivo: 'vapor.html' },
  { id: 'eletrico', nome: 'Elétrico', arquivo: 'eletrico.html' },
  { id: 'passagem', nome: 'Passagem', arquivo: 'passagem.html' },
];

/** a página aberta agora, pelo endereço (undefined no menu) */
export function paginaAtual(): Pagina | undefined {
  if (typeof location === 'undefined') return undefined;
  const arq = location.pathname.split('/').pop() || '';
  return PAGINAS.find((p) => p.arquivo === arq);
}
