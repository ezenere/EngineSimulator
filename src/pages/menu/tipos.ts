// Tipos de motor do menu, na ordem das páginas (src/ui/paginas.ts). Cada cartão diz o que é, mostra exemplos e leva à
// página. Os textos são para quem chega: sem jargão; o detalhe técnico fica na página e em docs/TECNICO.md.
import type { IdIcone } from './Icones';

export type TipoDeMotor = {
  id: IdIcone;
  nome: string;
  /** o que é, em poucas palavras (linha logo abaixo do nome) */
  subtitulo: string;
  /** o que dá para fazer e ouvir */
  descricao: string;
  exemplos: string[];
  pagina: string;
};

export const TIPOS: TipoDeMotor[] = [
  { id: 'ronco', nome: 'Ronco', pagina: './ronco.html',
    subtitulo: 'Carros e motos a gasolina',
    descricao: 'Escolha o carro, ligue e acelere. Troque cilindros, escape, turbo e câmbio e ouça o corte de giro e os estalos.',
    exemplos: ['Mustang', 'Ferrari 458', 'Fusca', 'Opala', 'Fórmula 1 V8', 'Hayabusa'] },
  { id: 'turbina', nome: 'Turbina', pagina: './turbina.html',
    subtitulo: 'Aviões a jato e turboélices',
    descricao: 'Dê a partida, empurre a manete e ouça do solo, de dentro ou com o avião passando, com estrondo sônico.',
    exemplos: ['Boeing 737', 'Airbus A320', 'Concorde', 'F-16', 'ATR 72', 'Super Tucano'] },
  { id: 'diesel', nome: 'Diesel', pagina: './diesel.html',
    subtitulo: 'Picapes, caminhões, geradores e locomotivas',
    descricao: 'A batida da injeção, o assobio do turbo, o freio-motor e os oito pontos de aceleração de uma locomotiva.',
    exemplos: ['Hilux', 'Scania V8', 'Cat C15', 'Gerador Cummins', 'EMD SD70'] },
  { id: 'radial', nome: 'Radial', pagina: './radial.html',
    subtitulo: 'Motores em estrela',
    descricao: 'Aviões a pistão com partida de verdade: gire a hélice, ligue os magnetos, ajuste a mistura e o passo.',
    exemplos: ['Corsair', 'P-47', 'DC-3', 'T-6', 'Yak-52', 'Sherman', 'S-55'] },
  { id: 'rotativo', nome: 'Rotativos', pagina: './rotativo.html',
    subtitulo: 'Wankel, X-Engine e motor de palhetas',
    descricao: 'O motor sem pistão dos Mazda e o seu “brap-brap”: troque rotores, janelas e escape, do RX-7 ao 787B.',
    exemplos: ['RX-7', 'RX-8', '787B', 'Cosmo', 'NSU Ro80', 'Norton'] },
  { id: 'vapor', nome: 'Vapor', pagina: './vapor.html',
    subtitulo: 'Locomotivas e máquinas a vapor',
    descricao: 'Abra o regulador e a máquina sai com o trem: o sopro da chaminé, o apito, o sino e a bomba de ar.',
    exemplos: ['Big Boy', 'Mallard', 'Maria Fumaça', 'D51', 'Stanley', 'Barco de pás'] },
  { id: 'eletrico', nome: 'Elétrico', pagina: './eletrico.html',
    subtitulo: 'Carros, trens e ferramentas',
    descricao: 'O zumbido do motor e o canto do inversor, com o espectro mostrando de onde vem cada nota.',
    exemplos: ['Tesla Model 3', 'Taurus (do-re-mi)', 'Metrô de SP', 'Shinkansen', 'Bonde', 'Drone'] },
  { id: 'passagem', nome: 'Passagem', pagina: './passagem.html',
    subtitulo: 'Qualquer coisa passando por você',
    descricao: 'Uma cena em 3D para ouvir de onde quiser: o efeito Doppler, o eco do lugar e a onda de pressão do trem.',
    exemplos: ['Trem-bala no túnel', 'Carro na rua', 'Caça supersônico', 'Helicóptero', 'Locomotiva'] },
];
