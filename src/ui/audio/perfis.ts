// Ajustes da cadeia de áudio de cada página. Os números são os de initAudio() e
// applyListenerAcoustics() em src/app.js (Ronco) e src/jet-app.js (Turbina).
import { AMBIENTES_RONCO, AMBIENTES_TURBINA, type Ambiente } from './ambientes';

export type AcusticaDoOuvinte = {
  corte: number; // passa-baixa do envio para o ambiente (Hz)
  molhado: number; // ganho do ambiente
  seco: number | null; // ganho do som direto (null: não mexe)
};

export type PerfilDeAudio = {
  compressor: { threshold: number; knee: number; ratio: number; attack: number; release: number };
  eq: boolean; // equalizador de escuta de 3 bandas (grave 160 Hz, médio 900 Hz, agudo 3,5 kHz)
  corteInicial: number; // passa-baixa do envio antes de escolher o ouvinte (Hz)
  saida: number; // ganho final
  fft: number; // tamanho da FFT do analisador
  ambientes: Record<string, Ambiente>;
  // dentro do carro/avião o ambiente chega abafado pela carroceria/fuselagem
  acustica: (ouvinte: string, amb: Ambiente) => AcusticaDoOuvinte;
};

export const PERFIL_RONCO: PerfilDeAudio = {
  compressor: { threshold: -16, knee: 10, ratio: 3.2, attack: 0.004, release: 0.22 },
  eq: true,
  corteInicial: 18000,
  saida: 1.35,
  fft: 4096,
  ambientes: AMBIENTES_RONCO,
  acustica: (l, E) => {
    const f = { int: 650, bay: 3500 }[l] || 18000;
    const k = { int: 0.5, pipe: 0.55, bay: 0.8 }[l] || 1;
    // dentro do carro o ambiente não muda o som direto
    return { corte: f, molhado: E.wet * k, seco: l === 'int' || l === 'bay' ? 1 : (E.dry || 1) };
  },
};

export const PERFIL_TURBINA: PerfilDeAudio = {
  compressor: { threshold: -14, knee: 10, ratio: 3.5, attack: 0.006, release: 0.3 },
  eq: false,
  corteInicial: 16000,
  saida: 1.3,
  fft: 8192,
  ambientes: AMBIENTES_TURBINA,
  acustica: (l, E) => {
    const inside = l === 'cabin' || l === 'cockpit';
    return { corte: inside ? 500 : 16000, molhado: E.wet * (inside ? 0.3 : 1), seco: null };
  },
};
