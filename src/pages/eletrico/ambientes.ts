// Ambientes da página do Elétrico: céu aberto, estação e túnel são os da Passagem (src/scene/ambientes.ts); a rua (prédios
// dos dois lados, asfalto) e o galpão (bancada, oficina: concreto, teto metálico) são próprios, no mesmo formato.
import type { Ambiente } from '../../scene/tipos';
import { ambientePassagem } from '../../scene/ambientes';

export type IdAmbienteEletrico = 'ceu' | 'rua' | 'tunel' | 'estacao' | 'hangar';

const sem = { vento: 0, ventilacao: 0, murmurio: 0 };

const RUA: Ambiente = {
  id: 'rua', solo: { tipo: 'asfalto' },
  // fachadas a ~10 m dos dois lados: ecos de 25–70 ms, RT60 curto (a rua é aberta em cima)
  reverb: { len: 1.4, tau: 0.18, diff: 0.45, wet: 0.18, dry: 1, echoes: [[0.026, 0.4, 0.004], [0.048, 0.3, 0.006], [0.071, 0.2, 0.01]], rt60: [1.2, 1.0, 0.8, 0.5] },
  fundo: { ...sem, vento: 34 },
};

const GALPAO: Ambiente = {
  id: 'hangar', solo: { tipo: 'concreto' },
  // galpão de 20 × 30 × 8 m, paredes de bloco e telhado metálico: RT60 longo nos médios
  reverb: { len: 3.0, tau: 0.5, diff: 0.8, wet: 0.45, dry: 1, echoes: [[0.018, 0.45, 0.003], [0.041, 0.35, 0.005], [0.062, 0.3, 0.008]], rt60: [2.2, 1.9, 1.5, 0.8] },
  fundo: { ...sem, ventilacao: 34 },
};

export const AMBIENTES_ELETRICO: readonly { id: IdAmbienteEletrico; nome: string; nota: string }[] = [
  { id: 'ceu', nome: 'Céu aberto', nota: 'Só o solo reflete' },
  { id: 'rua', nome: 'Rua', nota: 'Fachadas dos dois lados, asfalto' },
  { id: 'tunel', nome: 'Túnel', nota: '64 m², RT60 5–1 s' },
  { id: 'estacao', nome: 'Estação', nota: 'Plataforma coberta, murmúrio' },
  { id: 'hangar', nome: 'Galpão', nota: 'Oficina de concreto e telhado metálico' },
];

/** ambiente da página (cópia rasa): o túnel é longo (30 km) porque o veículo anda por ele à vontade */
export function ambienteEletrico(id: IdAmbienteEletrico): Ambiente {
  if (id === 'rua') return { ...RUA };
  if (id === 'hangar') return { ...GALPAO };
  const a = ambientePassagem(id);
  if (a.tunel) a.tunel = { area: 64, comprimento: 30000, xEntrada: -15000 };
  return a;
}
