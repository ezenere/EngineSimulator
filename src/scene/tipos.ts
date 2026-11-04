// Tipos da camada Cena (docs/CENA.md, seções 1.2 e 1.5), copiados à letra.
// Unidades: metros, segundos, rad/s, N·m, pascal, kg. Referencial do corpo: x para a frente,
// y para a esquerda, z para cima, origem no centro do corpo ao nível do solo.
//
// Nada aqui usa o navegador: o mesmo código roda no AudioWorklet e no Node (tools/cena/).
import type { Portador } from '../carriers/tipos';

export type Vec3 = readonly [number, number, number];

/** Diretividade de uma fonte: ganho em dB a 0°, 30°, …, 180° do eixo da fonte (7 valores), como DIR em jet-dsp. */
export interface Diretividade {
  tabela: readonly [number, number, number, number, number, number, number];
  eixo: Vec3;        // direção do 0° no referencial do corpo (escape: [-1,0,0]; admissão/hélice: [1,0,0]; rotor: [0,0,1])
  expConv: number;   // expoente da amplificação convectiva |1 − M·cosθ|^(−expConv): 2 monopolo, 3 dipolo, 1,4 jato (legado)
}

export type TipoFonte =
  | 'escape' | 'admissao' | 'mecanica' | 'compressor'   // do motor
  | 'pa'                                                // hélice, rotor, fan, ventilador: tons de passagem de pá
  | 'rolamento' | 'aero' | 'vao' | 'pantografo'         // do portador
  | 'eletrica' | 'pressao' | 'vento';                   // zumbido elétrico, onda de pressão (infrassom), vento no ouvinte

export interface FonteSonora {
  id: string;                 // 'escape.0', 'admissao', 'bloco', 'helice', 'rotor.principal', 'truque.7', 'vao.3', 'pantografo.1'
  tipo: TipoFonte;
  pos: Vec3;                  // no referencial do corpo
  dir: Diretividade;
  refDist: number;            // m: o canal é p(t) em Pa, campo livre, a esta distância (Ronco 5 m; Turbina 30 m; portadores 7,5 m)
  dentro: boolean;            // true = está dentro de um compartimento (cofre, nacele, casa de máquinas): sofre a casca antes de sair
  hCorpo?: number;            // altura do ponto de emissão (usa pos[2] se omitido)
}

export interface EixoSaida { omega: number; torque: number; inercia: number }   // rad/s, N·m (líquido que o motor entrega), kg·m² (do motor)

export interface Carga {
  torque(omega: number): number;   // N·m resistente no eixo do motor (sinal positivo = freia)
  inercia: number;                 // kg·m² refletida no eixo do motor (ex.: hélice J·i², rotor J·i²)
}

export interface ComandoMotor {
  acelerador: number;      // 0..1 (pedal, manete, ou saída do governador do portador)
  ignicao: boolean;
  partida: boolean;
  combustivel?: number;    // 0..1, quando um governador externo manda no motor (rotor, gerador, locomotiva); se definido, substitui acelerador
}

// ---------------------------------------------------------------- 1.5 Cena → ouvinte

export type IdAmbiente = 'ceu' | 'rua' | 'corte' | 'estacao' | 'tunel' | 'ponte' | 'garagem' | 'autodromo' | 'serra' | 'pista' | 'patio' | 'hangar' | 'celula' | 'vale' | 'porta-avioes';

export interface Solo { tipo: 'asfalto' | 'concreto' | 'brita' | 'grama' | 'agua' | 'nenhum'; }

export interface Tunel { area: number; comprimento: number; xEntrada: number; }   // m², m, posição da boca na trajetória (o ouvinte está dentro)

/**
 * Reverberação do ambiente. Os campos `len … echoes` são os de ENVS em app.js/jet-app.js
 * (src/ui/audio/ambientes.ts); `rt60` (s em 125/500/2k/8k Hz) e `iniciais` são o que a seção 2.10 acrescenta.
 * A resposta ao impulso é gerada por `gerarRespostaPorBanda` (src/scene/ambientes.ts), sem DOM.
 */
export interface EspecReverb {
  len: number;                                  // s, duração da resposta
  tau: number;                                  // s, decaimento da cauda (legado; com rt60 definido, vale o rt60)
  diff: number;                                 // nível da cauda difusa
  wet: number;                                  // ganho do envio (molhado)
  dry?: number;                                 // ganho do direto
  dark?: number;                                // quanto a cauda escurece (legado)
  flutter?: number;                             // s, eco palpitante
  echoes: readonly (readonly [number, number, number])[];   // [atraso (s), ganho, espalhamento (s)]
  rt60?: readonly [number, number, number, number];         // s por banda (125, 500, 2k, 8k Hz)
}

/** Som de fundo do ambiente (o que hoje é setAmbience): independe do corpo. Níveis em dB SPL. */
export interface EspecFundo {
  vento: number;          // dB SPL do vento de fundo (0 = desligado)
  ventilacao: number;     // dB SPL da ventilação (túnel, garagem): ruído estreito em 100/120 Hz
  murmurio: number;       // dB SPL do murmúrio de gente (estação)
}

export interface Ambiente {
  id: IdAmbiente;
  solo: Solo;
  reverb: EspecReverb;         // o que o app.js de hoje chama ENVS (len, tau, diff, wet, dry, dark, flutter, echoes), mais rt60 por banda (seção 2.9)
  tunel?: Tunel;
  fundo: EspecFundo;           // vento, trânsito, ventilação (o que hoje é setAmbience)
}

export interface Trajetoria {
  tipo: 'reta' | 'volta';
  comprimento: number;         // m: da reta (o corpo reaparece do outro lado) ou perímetro da volta
  raioCurva: number;           // m, só na volta: oval com duas retas e dois semicírculos; o ouvinte fica junto de uma reta
  lateral: number;             // m, distância do ouvinte à LATERAL do corpo (não ao eixo); d da seção 2
  altitude: number;            // m, altura do piso do corpo sobre o solo (0 em veículos terrestres)
  sentido: 1 | -1;             // 1 = passa da esquerda para a direita do ouvinte
}

export type LocalOuvinte = 'fora' | 'cabine' | 'cofre' | 'ponteira';

export interface Ouvinte {
  modo: 'fixo' | 'gimbal';
  pos: Vec3;                   // modo fixo: no mundo, z = altura do ouvido (1,6 em pé; 1,2 sentado)
  gimbal: { az: number; el: number; r: number; alvo: 'corpo' | string };   // graus, graus, m; alvo = 'corpo' ou id de fonte
  local: LocalOuvinte | 'auto'; // 'auto': 'cabine' se o ponto cair dentro do corpo, senão 'fora'
  binaural: boolean;           // ITD + ILD (padrão true)
}

export interface TelemetriaCena {
  fontes: { id: string; posEmitida: Vec3; r: number; thetaEmissao: number; ganhoDb: number; atrasoMs: number }[];
  corpo: { s: number; v: number; pose: Vec3; rumo: number };
  ouvinte: Vec3;
  pressaoPa: number;           // onda de nariz/cauda + túnel, instantânea
  ventoMs: number;             // vento induzido no ouvinte
  splDbA: number; splDb: number;
  boom?: { dB: number; idade: number };
}

export interface Cena {
  configurar(amb: Ambiente, traj: Trajetoria, ouv: Ouvinte, fs: number): void;
  atualizar(parcial: Partial<{ amb: Ambiente; traj: Trajetoria; ouv: Ouvinte }>): void;   // sem estalos: rampas de 20 ms
  /** Lê os canais já preenchidos pelo portador e escreve direto (L/R) e envio para a reverberação (sendL/R). */
  processar(portador: Portador, canais: Float32Array[], outL: Float32Array, outR: Float32Array, sendL: Float32Array, sendR: Float32Array, n: number): void;
  telemetria(): TelemetriaCena;
}
