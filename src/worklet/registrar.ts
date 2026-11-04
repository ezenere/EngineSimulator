// Registra um processador de AudioWorklet que envolve um DSP. Só este arquivo toca nos globais do
// worklet (AudioWorkletProcessor, registerProcessor, sampleRate); importe-o apenas de um ponto de
// entrada de worklet (processador-*.ts), nunca do DSP nem da página.
import type { FabricaDeDSP } from './tipos';

export function registrarProcessador(nome: string, criar: FabricaDeDSP) {
  class Processador extends AudioWorkletProcessor {
    d: ReturnType<FabricaDeDSP>;
    constructor() {
      super();
      this.d = criar(sampleRate);
      this.d.post = (m) => this.port.postMessage(m);
      this.port.onmessage = (e) => this.d.message(e.data);
    }
    process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
      const o = outputs[0];
      this.d.process(o[0], o[1], o[0].length, o[2], o[3]);
      return true;
    }
  }
  registerProcessor(nome, Processador);
}
