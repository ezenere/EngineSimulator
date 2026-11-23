// Componentes React compartilhados por todas as páginas.
// Os estilos (estilo.css e os de cada página) são importados por cada página em src/pages/.
export { Slider, type SliderProps } from './Slider';
export { ChipGroup, type OpcaoChip, type ChipGroupProps } from './ChipGroup';
export { Field } from './Field';
export { Section } from './Section';
export { Faixa, FamilyNav, PresetNav, type Familia, type PresetResumo } from './PresetNav';
export { Barra, BotaoIgnicao } from './Barra';
export { Manete, segurarManete, VELOCIDADE_MANETE, type ManeteProps, type MarcaManete } from './Manete';
export { PAGINAS, paginaAtual, type Pagina } from './paginas';
export { dec, num, pct, grau, resumoGraus, listaGraus } from './formato';
export { OndaEEspectro, type MarcaEspectro, type OpcoesOnda } from './onda';
export * from './audio';
