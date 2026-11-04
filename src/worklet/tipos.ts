// Contrato entre o processador do AudioWorklet e o DSP de cada motor (o mesmo de EngineDSP e JetDSP).
// O DSP não sabe que está num worklet: recebe a taxa de amostragem no construtor, mensagens por
// message(), escreve blocos em process() e manda telemetria por post(). Assim ele roda igual no Node.
export interface DSPDeAudio {
  // canais 0–1: som direto · canais 2–3 (opcionais): envio para a acústica do ambiente
  process(outL: Float32Array, outR: Float32Array, n: number, sendL?: Float32Array, sendR?: Float32Array): void;
  message(m: any): void;
  post?: ((m: any) => void) | null;
}

export type FabricaDeDSP = (fs: number) => DSPDeAudio;
