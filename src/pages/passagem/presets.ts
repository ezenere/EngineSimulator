// Portadores, motores e presets da página Passagem / modo de testes (dados, sem lógica).
//
// Regra do produto (PLANO.md): só se ouve cada motor nos portadores onde ele foi usado de verdade. A
// página lista todos os portadores da camada `carriers/`; um portador fica habilitado quando a tabela
// COMPAT (CENA.md 1.6) tem pelo menos uma família de motor cujo adaptador já existe na página
// (`MOTORES_PRONTOS`) e o DSP da Cena sabe montá-lo (`PORTADORES_NO_DSP`). Os outros aparecem
// desabilitados com o motivo; quando o adaptador de um motor chegar, basta acrescentá-lo às listas.
import type { FamiliaMotor, TipoPortador } from '../../carriers/tipos';
import type { IdAmbiente, Solo } from '../../scene/tipos';
import { COMPAT, ADAPTADORES, USO_REAL } from '../../carriers/compat';
import { PRESETS as PRESETS_RONCO, PRESETS_AVIACAO } from '../../engines/ronco/presets';
import { PRESETS_RADIAL } from '../../engines/radial/presets';
import { PRESETS as PRESETS_DIESEL } from '../../engines/diesel/presets';
import { PRESETS_TURBINA } from '../../engines/turbina/presets';
import { PRESETS_ELETRICO } from '../../engines/eletrico/presets';

export type IdPortadorPagina = Exclude<TipoPortador, 'nenhum'>;
export type IdAmbientePagina = Extract<IdAmbiente, 'ceu' | 'corte' | 'estacao' | 'ponte' | 'tunel'>;

/** famílias de motor com adaptador pronto para a Cena ('nenhum' = o portador sozinho; docs/TECNICO.md → Adaptadores de motor) */
export const MOTORES_PRONTOS: readonly FamiliaMotor[] = ADAPTADORES;
/** portadores que o DSP da Cena (src/scene/dsp-cena.ts) monta */
export const PORTADORES_NO_DSP: readonly IdPortadorPagina[] = ['trem', 'rotor', 'carro', 'helice', 'gerador', 'locomotiva', 'aviao',
  'drone', // Elétrico (etapa 6): o multirrotor
];

export const NOME_MOTOR: Record<FamiliaMotor, string> = {
  nenhum: 'Sem motor', pistao: 'Pistão (Ronco)', turbina: 'Turbina', turboelice: 'Turboélice', turboeixo: 'Turboeixo',
  radial: 'Radial', rotativo: 'Rotativo', diesel: 'Diesel', vapor: 'Vapor', eletrico: 'Elétrico',
};
/** de onde vem o adaptador de cada família (para o motivo de um portador desabilitado) */
export const ESPERA_MOTOR: Partial<Record<FamiliaMotor, string>> = {
  pistao: 'adaptador do Ronco', turbina: 'adaptador da Turbina', turboelice: 'adaptador da Turbina', turboeixo: 'adaptador da Turbina',
  diesel: 'etapa 2 (diesel)', radial: 'adaptador do radial', rotativo: 'etapa 4 (rotativos)', vapor: 'etapa 5 (vapor)', eletrico: 'etapa 6 (elétrico)',
};

export interface InfoPortador { id: IdPortadorPagina; nome: string; descricao: string }
export const PORTADORES: readonly InfoPortador[] = [
  { id: 'trem', nome: 'Trem', descricao: 'N vagões: rolamento por truque, camada limite, vãos, pantógrafos, nariz e cauda' },
  { id: 'rotor', nome: 'Helicóptero', descricao: 'Rotor principal e de cauda, caixa e downwash (R44); com o pistão de aviação ou o radial do S-55 o governador segura o Nr; sem motor, o Nr é imposto' },
  { id: 'carro', nome: 'Carro', descricao: 'Motor, câmbio e estrada' },
  { id: 'helice', nome: 'Avião de hélice', descricao: 'Hélice com redutor e governador (turboélice, radial ou motor plano)' },
  { id: 'gerador', nome: 'Gerador', descricao: 'Rotação fixa, degraus de carga' },
  { id: 'locomotiva', nome: 'Locomotiva', descricao: 'Diesel-elétrica de 8 notches' },
  { id: 'aviao', nome: 'Avião a jato', descricao: 'Fuselagem com os motores da Turbina; acima de Mach 0,9 o resolvedor fechado e o estrondo' },
  // Elétrico (etapa 6)
  { id: 'drone', nome: 'Drone', descricao: 'Multirrotor de 4 hélices (Mavic): BPF por rotor com o desvio de rotação medido, o motor em 9·f_e' },
];

/** motores possíveis no portador que já têm adaptador e foram usados nele de verdade (regra do produto) */
export function motoresProntos(p: IdPortadorPagina): FamiliaMotor[] {
  return COMPAT[p].filter((f) => MOTORES_PRONTOS.includes(f) && USO_REAL[p].includes(f));
}

/** Presets de motor que a Passagem oferece em cada portador (os das páginas de cada família, filtrados pelo uso). */
export interface OpcaoMotor { id: string; nome: string; tag: string }
export function presetsDoMotor(p: IdPortadorPagina, f: FamiliaMotor): OpcaoMotor[] {
  const op = (x: { id: string; name: string; tag: string }) => ({ id: x.id, nome: x.name, tag: x.tag });
  if (f === 'pistao') return p === 'carro' ? PRESETS_RONCO.map(op) : PRESETS_AVIACAO.filter((x) => (x.portadores || []).includes(p)).map(op);
  if (f === 'radial') return PRESETS_RADIAL.filter((x) => (x.portadores as string[]).includes(p)).map(op);
  if (f === 'diesel') return PRESETS_DIESEL.filter((x) => (x.portadores as string[]).includes(p === 'carro' ? 'carro' : p)).map(op);
  if (f === 'turboelice') return PRESETS_TURBINA.filter((x) => x.arch === 'turboprop').map(op);
  if (f === 'turbina') return PRESETS_TURBINA.filter((x) => x.arch !== 'turboprop').map(op);
  // Elétrico: carro (e trólebus), trem (metrô, bonde, trem-bala), drone
  if (f === 'eletrico') return PRESETS_ELETRICO.filter((x) => x.portador.tipo === (p === 'carro' || p === 'trem' || p === 'drone' ? p : '')).map(op);
  return [];
}
/** preset de motor padrão por portador e família */
export const MOTOR_PADRAO: Partial<Record<FamiliaMotor, Partial<Record<IdPortadorPagina, string>>>> = {
  pistao: { carro: 'muscle', helice: 'c172', rotor: 'r44' }, radial: { helice: 'r2800', rotor: 's55', carro: 'r975' }, diesel: { carro: 'hilux28', gerador: 'gen500', locomotiva: 'emd710' }, turboelice: { helice: 'regional' }, turbina: { aviao: 'narrow' },
  eletrico: { carro: 'model3', trem: 'n700', drone: 'mavic' },
};

/** habilitado e, se não, por quê */
export function situacaoPortador(p: IdPortadorPagina): { ok: boolean; motivo: string } {
  const prontos = motoresProntos(p);
  if (!prontos.length) {
    const espera = [...new Set(COMPAT[p].map((f) => ESPERA_MOTOR[f]).filter(Boolean))];
    return { ok: false, motivo: `Espera o motor: ${COMPAT[p].map((f) => NOME_MOTOR[f]).join(', ')} (${espera.join('; ')})` };
  }
  if (!PORTADORES_NO_DSP.includes(p)) return { ok: false, motivo: 'A Cena ainda não monta este portador' };
  return { ok: true, motivo: `Motor: ${prontos.map((f) => NOME_MOTOR[f]).join(', ')}` };
}

export const AMBIENTES: readonly { id: IdAmbientePagina; nome: string; nota: string }[] = [
  { id: 'ceu', nome: 'Céu aberto', nota: 'Só o solo reflete; RT60 0,6–0,2 s' },
  { id: 'corte', nome: 'Corte', nota: 'Trincheira com taludes a 8 m: duas reflexões laterais' },
  { id: 'estacao', nome: 'Estação', nota: 'Plataforma coberta: teto, paredes, RT60 2,5–0,9 s, murmúrio' },
  { id: 'ponte', nome: 'Ponte', nota: 'Viaduto: tabuleiro estreito, ronco da estrutura em 31–125 Hz' },
  { id: 'tunel', nome: 'Túnel', nota: '64 m², 2 km: onda de compressão, pistão, RT60 5–1 s' },
];

export const SOLOS: readonly { id: Solo['tipo']; nome: string }[] = [
  { id: 'brita', nome: 'Brita' }, { id: 'concreto', nome: 'Concreto' }, { id: 'asfalto', nome: 'Asfalto' },
  { id: 'grama', nome: 'Grama' }, { id: 'agua', nome: 'Água' }, { id: 'nenhum', nome: 'Nenhum' },
];

/** parâmetros do trem editáveis na página (o resto fica no TREM_PADRAO de carriers/trem.ts) */
export interface TremPagina {
  N: number; Lc: number; vao: number; truqueExtremidade: number; lNariz: number;
  pantografos: number[]; carenagem: boolean; largura: number; altura: number; zPiso: number; cpNariz: number;
}
export const TREM_PAGINA_PADRAO: TremPagina = {
  N: 10, Lc: 25, vao: 0.5, truqueExtremidade: 3.75, lNariz: 12, pantografos: [3, 8], carenagem: true,
  largura: 3.36, altura: 3.6, zPiso: 0.4, cpNariz: 0.14,
};

/** Um preset de passagem: o que muda em relação aos padrões do portador (CENA.md 3.1). */
export interface PresetPassagem {
  id: string; nome: string; sub: string;
  portador: IdPortadorPagina; motor: FamiliaMotor;
  ambiente: IdAmbientePagina; vKmh: number; lateral: number; altitude?: number;
  trem?: Partial<TremPagina>; solo?: Solo['tipo'];
  coletivo?: number;
  /** motor: preset da família (src/engines/<família>/presets.ts) e comando */
  motorPreset?: string; pedal?: number; marcha?: number; notch?: number; cargaFracao?: number;
  /** ouvinte parado nesta posição ao longo da via (m) e altura do ouvido */
  x0?: number;
  /** (Elétrico) freio elétrico 0..1 durante a passagem; `partida`: o corpo parte parado (a velocidade vem do motor) */
  freio?: number; partida?: boolean;
}

export const PRESETS_PASSAGEM: readonly PresetPassagem[] = [
  // (o trem-bala ganha o motor do N700 na etapa 6: a 350 km/h ele fica 15–20 dB abaixo do aero e do rolamento)
  { id: 'trembala-tunel', nome: 'Trem-bala no túnel', sub: '10 vagões · N700 · 350 km/h · 3 m', portador: 'trem', motor: 'eletrico', motorPreset: 'n700', pedal: 0.3, ambiente: 'tunel', vKmh: 350, lateral: 3 },
  { id: 'trembala-ceu', nome: 'Trem-bala a céu aberto', sub: '10 vagões · 300 km/h · 7,5 m', portador: 'trem', motor: 'nenhum', ambiente: 'ceu', vKmh: 300, lateral: 7.5 },
  { id: 'trembala-ponte', nome: 'Trem-bala no viaduto', sub: '8 vagões · 320 km/h · 5 m', portador: 'trem', motor: 'nenhum', ambiente: 'ponte', vKmh: 320, lateral: 5, trem: { N: 8, pantografos: [2, 6] } },
  { id: 'convencional-estacao', nome: 'Trem convencional na estação', sub: '8 vagões · 120 km/h · 2 m', portador: 'trem', motor: 'nenhum', ambiente: 'estacao', vKmh: 120, lateral: 2,
    trem: { N: 8, Lc: 26.4, vao: 0.8, lNariz: 3, cpNariz: 0.3, largura: 2.9, altura: 3.9, zPiso: 0.5, pantografos: [4], carenagem: false } },
  { id: 'regional-corte', nome: 'Regional no corte', sub: '4 vagões · 160 km/h · 4 m', portador: 'trem', motor: 'nenhum', ambiente: 'corte', vKmh: 160, lateral: 4,
    trem: { N: 4, Lc: 26, vao: 0.7, lNariz: 6, cpNariz: 0.22, largura: 2.9, altura: 3.8, pantografos: [2], carenagem: false } },
  // R44 com o Lycoming O-540 (família aviação do Ronco): o governador do rotor mexe na borboleta
  { id: 'heli-rasante', nome: 'Helicóptero R44 sobrevoando', sub: 'Lycoming O-540 + rotor · 150 km/h · 40 m', portador: 'rotor', motor: 'pistao', motorPreset: 'r44', ambiente: 'ceu', vKmh: 150, lateral: 0, altitude: 40, solo: 'grama', coletivo: 0.75 },
  // com motor (adaptadores de src/engines/*/motor.ts)
  { id: 'carro-rua', nome: 'Carro na rua a 6 m', sub: 'Camaro SS · V8 · 3ª, pé no fundo · 108 km/h', portador: 'carro', motor: 'pistao', motorPreset: 'muscle', ambiente: 'ceu', vKmh: 108, lateral: 5.1, solo: 'asfalto', marcha: 3, pedal: 1, x0: 150 },
  { id: 'picape-diesel', nome: 'Picape diesel passando', sub: 'Hilux 2.8 · 4ª · 80 km/h · 5 m', portador: 'carro', motor: 'diesel', motorPreset: 'hilux28', ambiente: 'ceu', vKmh: 80, lateral: 5, solo: 'asfalto', marcha: 4, pedal: 0.8, x0: 150 },
  // radiais (etapa 3) e aviação a pistão
  { id: 'corsair-rasante', nome: 'Corsair rasante', sub: 'F4U-4 · R-2800 · 30 m · 500 km/h', portador: 'helice', motor: 'radial', motorPreset: 'r2800', ambiente: 'ceu', vKmh: 500, lateral: 0, altitude: 30, solo: 'grama', pedal: 1, x0: 900 },
  { id: 'yak52-passagem', nome: 'Yak-52 passando', sub: 'M-14P · 9 cilindros · 120 m · 280 km/h', portador: 'helice', motor: 'radial', motorPreset: 'm14p', ambiente: 'ceu', vKmh: 280, lateral: 0, altitude: 120, solo: 'grama', pedal: 0.8, x0: 700 },
  { id: 'p47-passagem', nome: 'P-47 Thunderbolt passando', sub: 'R-2800 com turbina · 80 m · 450 km/h', portador: 'helice', motor: 'radial', motorPreset: 'r2800turbo', ambiente: 'ceu', vKmh: 450, lateral: 0, altitude: 80, solo: 'grama', pedal: 0.9, x0: 900 },
  { id: 'sherman', nome: 'Sherman passando', sub: 'M4A1 · Continental R-975 · 2ª · 15 km/h · 8 m', portador: 'carro', motor: 'radial', motorPreset: 'r975', ambiente: 'ceu', vKmh: 15, lateral: 8, solo: 'asfalto', marcha: 2, pedal: 0.7, x0: 60 },
  { id: 'cessna-passagem', nome: 'Cessna 172 passando', sub: 'Lycoming O-320 · 100 m · 200 km/h', portador: 'helice', motor: 'pistao', motorPreset: 'c172', ambiente: 'ceu', vKmh: 200, lateral: 0, altitude: 100, solo: 'grama', pedal: 0.8, x0: 600 },
  { id: 'aviao-rasante', nome: 'Turboélice rasante', sub: 'ATR 72 · decolagem · 100 m · 250 km/h', portador: 'helice', motor: 'turboelice', motorPreset: 'regional', ambiente: 'ceu', vKmh: 250, lateral: 0, altitude: 100, solo: 'grama', pedal: 1, x0: 900 },
  { id: 'locomotiva-patio', nome: 'Locomotiva EMD em N8 passando', sub: 'SD70ACe · notch 8 · 40 km/h · 15 m', portador: 'locomotiva', motor: 'diesel', motorPreset: 'emd710', ambiente: 'ceu', vKmh: 40, lateral: 15, solo: 'brita', notch: 8, x0: 110 },
  { id: 'gerador-bancada', nome: 'Gerador em bancada', sub: 'Cummins 500 kVA · 1800 rpm · 50% de carga · 7,5 m', portador: 'gerador', motor: 'diesel', motorPreset: 'gen500', ambiente: 'ceu', vKmh: 0, lateral: 7.5, solo: 'concreto', cargaFracao: 0.5, x0: 0 },
  { id: 'jato-1500', nome: 'Jato a 1500 m', sub: '737-800 · 300 km/h · manete 0,85', portador: 'aviao', motor: 'turbina', motorPreset: 'narrow', ambiente: 'ceu', vKmh: 300, lateral: 0, altitude: 1500, solo: 'grama', pedal: 0.85, x0: 2500 },
  { id: 'caca-supersonico', nome: 'Caça supersônico a 200 m', sub: 'F-16 · Mach 1,5 · estrondo', portador: 'aviao', motor: 'turbina', motorPreset: 'fighter', ambiente: 'ceu', vKmh: 1836, lateral: 0, altitude: 200, solo: 'grama', pedal: 1, x0: 1500 },
  // Elétrico (etapa 6)
  { id: 'tesla-rua', nome: 'Tesla na rua', sub: 'Model 3 AWD · 30 km/h · 6 m · pneus e AVAS', portador: 'carro', motor: 'eletrico', motorPreset: 'model3', ambiente: 'ceu', vKmh: 30, lateral: 5.1, solo: 'asfalto', pedal: 0.15, x0: 60 },
  { id: 'taurus-doremi', nome: 'Taurus partindo do-re-mi', sub: 'ES64U2 · GTO em escada · arranca parado a 7,5 m', portador: 'trem', motor: 'eletrico', motorPreset: 'taurus', ambiente: 'estacao', vKmh: 0, lateral: 6, pedal: 0.63, partida: true, x0: -12 },
  { id: 'metro-estacao', nome: 'Metrô chegando na estação', sub: 'Metropolis · freio elétrico · 35 km/h · 2 m', portador: 'trem', motor: 'eletrico', motorPreset: 'metropolis', ambiente: 'estacao', vKmh: 35, lateral: 2, pedal: 0, freio: 0.6, x0: 120 },
  { id: 'n700-tunel', nome: 'Trem-bala N700 no túnel', sub: '10 vagões · tração a 150 km/h · 3 m', portador: 'trem', motor: 'eletrico', motorPreset: 'n700', ambiente: 'tunel', vKmh: 150, lateral: 3, pedal: 0.8 },
  { id: 'drone-pairando', nome: 'Drone pairando', sub: 'Mavic Pro · 4 hélices · 10 m · 5 km/h', portador: 'drone', motor: 'eletrico', motorPreset: 'mavic', ambiente: 'ceu', vKmh: 5, lateral: 0, altitude: 10, solo: 'grama', pedal: 0.5, x0: 15 },
];
