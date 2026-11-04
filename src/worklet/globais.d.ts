// Globais do AudioWorkletGlobalScope. O lib "DOM" do TypeScript não traz estes tipos, e o lib
// "AudioWorklet" briga com o "DOM"; então declaramos só o que o projeto usa.
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: any);
}
declare function registerProcessor(name: string, ctor: new (options?: any) => AudioWorkletProcessor): void;
// taxa de amostragem do contexto: só use em registrar.ts (o DSP recebe a taxa no construtor)
declare const sampleRate: number;
declare const currentTime: number;
