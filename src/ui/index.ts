// Componentes React compartilhados pelas páginas de motor.
// Os estilos (estilo.css e turbina.css) são importados por cada página em src/pages/.
export { Slider, type SliderProps } from './Slider';
export { ChipGroup, type OpcaoChip, type ChipGroupProps } from './ChipGroup';
export { Field } from './Field';
export { Section } from './Section';
export { FamilyNav, PresetNav, type Familia, type PresetResumo } from './PresetNav';
export { Barra, BotaoIgnicao } from './Barra';
export { Manete, segurarManete, VELOCIDADE_MANETE, type ManeteProps, type MarcaManete } from './Manete';
export * from './audio';
