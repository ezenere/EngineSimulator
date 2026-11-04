// Tipos de motor do menu. `pagina` vazio = ainda em construção (cartão desabilitado).
export type TipoDeMotor = {
  id: string;
  nome: string;
  descricao: string;
  exemplos: string;
  pagina?: string;
};

export const TIPOS: TipoDeMotor[] = [
  { id: 'ronco', nome: 'Ronco', pagina: './ronco.html',
    descricao: 'Pistão a gasolina: carros e motos, do escape ao câmbio.',
    exemplos: 'Mustang, Ferrari 458, Fusca, Opala, Fórmula 1 V8, Hayabusa' },
  { id: 'turbina', nome: 'Turbina', pagina: './turbina.html',
    descricao: 'Jatos e turboélices: fan, jato, hélice e estrondo sônico.',
    exemplos: 'Boeing 737, Airbus A320, Concorde, F-16, ATR 72, Super Tucano' },
  { id: 'radial', nome: 'Radial', pagina: './radial.html',
    descricao: 'Cilindros em estrela com biela-mestra, fileiras ímpares, hélice e partida de aviação.',
    exemplos: 'Corsair, P-47, DC-3, T-6, Yak-52, R-4360, M4 Sherman, Monaco-Trossi, Megola, S-55' },
  { id: 'rotativo', nome: 'Rotativos',
    descricao: 'Wankel, X-Engine e motor de palhetas.',
    exemplos: 'Mazda 13B e Renesis, 787B, NSU Ro80, Norton' },
  { id: 'diesel', nome: 'Diesel', pagina: './diesel.html',
    descricao: 'Ignição por compressão, 4 e 2 tempos.',
    exemplos: 'Picapes, caminhões, locomotiva EMD 710, geradores' },
  { id: 'vapor', nome: 'Vapor',
    descricao: 'Sopro do escape, regulador, bielas e apito.',
    exemplos: 'Locomotivas, máquinas estacionárias, Stanley, barcos' },
  { id: 'eletrico', nome: 'Elétrico', pagina: './eletrico.html',
    descricao: 'Ranhuras, PWM e redução.',
    exemplos: 'Carros elétricos, metrô, Taurus, trem-bala, bonde, drones' },
  { id: 'testes', nome: 'Passagem e modo de testes', pagina: './passagem.html',
    descricao: 'Qualquer fonte passando por você, com o ouvinte livre em 3D.',
    exemplos: 'Trem-bala de 10 vagões a 350 km/h num túnel, trem na estação, helicóptero rasante' },
];
