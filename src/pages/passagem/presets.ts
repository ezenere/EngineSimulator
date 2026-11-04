// Portadores, motores e presets da página Passagem / modo de testes (dados, sem lógica).
//
// Regra do produto (PLANO.md): só se ouve cada motor nos portadores onde ele foi usado de verdade. A
// página lista todos os portadores da camada `carriers/`; um portador fica habilitado quando a tabela
// COMPAT (CENA.md 1.6) tem pelo menos uma família de motor cujo adaptador já existe na página
// (`MOTORES_PRONTOS`) e o DSP da Cena sabe montá-lo (`PORTADORES_NO_DSP`). Os outros aparecem
// desabilitados com o motivo; quando o adaptador de um motor chegar, basta acrescentá-lo às listas.
import type { FamiliaMotor, TipoPortador } from '../../carriers/tipos';
import type { IdAmbiente, Solo } from '../../scene/tipos';
import { COMPAT } from '../../carriers/compat';

export type IdPortadorPagina = Exclude<TipoPortador, 'nenhum'>;
export type IdAmbientePagina = Extract<IdAmbiente, 'ceu' | 'corte' | 'estacao' | 'ponte' | 'tunel'>;

/** famílias de motor com adaptador pronto para a Cena ('nenhum' = o portador sozinho) */
export const MOTORES_PRONTOS: readonly FamiliaMotor[] = ['nenhum'];
/** portadores que o DSP da Cena (src/scene/dsp-cena.ts) monta */
export const PORTADORES_NO_DSP: readonly IdPortadorPagina[] = ['trem', 'rotor'];

export const NOME_MOTOR: Record<FamiliaMotor, string> = {
  nenhum: 'Sem motor', pistao: 'Pistão (Ronco)', turbina: 'Turbina', turboelice: 'Turboélice', turboeixo: 'Turboeixo',
  radial: 'Radial', rotativo: 'Rotativo', diesel: 'Diesel', vapor: 'Vapor', eletrico: 'Elétrico',
};
/** de onde vem o adaptador de cada família (para o motivo de um portador desabilitado) */
export const ESPERA_MOTOR: Partial<Record<FamiliaMotor, string>> = {
  pistao: 'adaptador do Ronco', turbina: 'adaptador da Turbina', turboelice: 'adaptador da Turbina', turboeixo: 'adaptador da Turbina',
  diesel: 'etapa 2 (diesel)', radial: 'etapa 3 (radial)', rotativo: 'etapa 4 (rotativos)', vapor: 'etapa 5 (vapor)', eletrico: 'etapa 6 (elétrico)',
};

export interface InfoPortador { id: IdPortadorPagina; nome: string; descricao: string }
export const PORTADORES: readonly InfoPortador[] = [
  { id: 'trem', nome: 'Trem', descricao: 'N vagões: rolamento por truque, camada limite, vãos, pantógrafos, nariz e cauda' },
  { id: 'rotor', nome: 'Helicóptero', descricao: 'Rotor principal e de cauda, caixa e downwash (R44); sem motor, o Nr é imposto' },
  { id: 'carro', nome: 'Carro', descricao: 'Motor, câmbio e estrada' },
  { id: 'helice', nome: 'Avião de hélice', descricao: 'Hélice com redutor e governador' },
  { id: 'gerador', nome: 'Gerador', descricao: 'Rotação fixa, degraus de carga' },
  { id: 'locomotiva', nome: 'Locomotiva', descricao: 'Diesel-elétrica de 8 notches' },
];

/** motores possíveis no portador que já têm adaptador */
export function motoresProntos(p: IdPortadorPagina): FamiliaMotor[] {
  return COMPAT[p].filter((f) => MOTORES_PRONTOS.includes(f));
}

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
}

export const PRESETS_PASSAGEM: readonly PresetPassagem[] = [
  { id: 'trembala-tunel', nome: 'Trem-bala no túnel', sub: '10 vagões · 350 km/h · 3 m', portador: 'trem', motor: 'nenhum', ambiente: 'tunel', vKmh: 350, lateral: 3 },
  { id: 'trembala-ceu', nome: 'Trem-bala a céu aberto', sub: '10 vagões · 300 km/h · 7,5 m', portador: 'trem', motor: 'nenhum', ambiente: 'ceu', vKmh: 300, lateral: 7.5 },
  { id: 'trembala-ponte', nome: 'Trem-bala no viaduto', sub: '8 vagões · 320 km/h · 5 m', portador: 'trem', motor: 'nenhum', ambiente: 'ponte', vKmh: 320, lateral: 5, trem: { N: 8, pantografos: [2, 6] } },
  { id: 'convencional-estacao', nome: 'Trem convencional na estação', sub: '8 vagões · 120 km/h · 2 m', portador: 'trem', motor: 'nenhum', ambiente: 'estacao', vKmh: 120, lateral: 2,
    trem: { N: 8, Lc: 26.4, vao: 0.8, lNariz: 3, cpNariz: 0.3, largura: 2.9, altura: 3.9, zPiso: 0.5, pantografos: [4], carenagem: false } },
  { id: 'regional-corte', nome: 'Regional no corte', sub: '4 vagões · 160 km/h · 4 m', portador: 'trem', motor: 'nenhum', ambiente: 'corte', vKmh: 160, lateral: 4,
    trem: { N: 4, Lc: 26, vao: 0.7, lNariz: 6, cpNariz: 0.22, largura: 2.9, altura: 3.8, pantografos: [2], carenagem: false } },
  { id: 'heli-rasante', nome: 'Helicóptero rasante', sub: 'R44 só o rotor · 150 km/h · 40 m', portador: 'rotor', motor: 'nenhum', ambiente: 'ceu', vKmh: 150, lateral: 0, altitude: 40, solo: 'grama', coletivo: 0.75 },
  // à espera dos adaptadores de motor: aparecem desabilitados
  { id: 'carro-rua', nome: 'Carro na rua', sub: 'a 6 m · 108 km/h', portador: 'carro', motor: 'pistao', ambiente: 'ceu', vKmh: 108, lateral: 6, solo: 'asfalto' },
  { id: 'aviao-rasante', nome: 'Turboélice rasante', sub: '150 m · 300 km/h', portador: 'helice', motor: 'turboelice', ambiente: 'ceu', vKmh: 300, lateral: 0, altitude: 150, solo: 'grama' },
  { id: 'locomotiva-patio', nome: 'Locomotiva em notch 8', sub: 'a 5 m · 60 km/h', portador: 'locomotiva', motor: 'diesel', ambiente: 'ceu', vKmh: 60, lateral: 5 },
];
