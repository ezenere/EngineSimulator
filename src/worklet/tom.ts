// DSP de prova do pipeline: um seno com frequência e volume controlados por mensagem.
// Serve só para provar que o worklet em TypeScript compila e carrega (dev e build) e que o mesmo
// módulo roda no Node via tsx. Usa o pacote acoustics/ para provar que os imports entram no bundle.
import { TAU, onePole } from '../acoustics';
import type { DSPDeAudio } from './tipos';

export type MensagemTom = { type: 'tom'; ligado?: boolean; f?: number; amp?: number };

export class TomDSP implements DSPDeAudio {
  fs: number;
  fase = 0;
  f = 220;
  fAlvo = 220;
  a = 0;
  aAlvo = 0;
  ampLigado = 0.2;
  k: number;
  post: ((m: any) => void) | null = null;
  nTele = 0;
  periodoTele: number;
  amostras = 0;

  constructor(fs: number) {
    this.fs = fs;
    this.k = onePole(fs, 20); // ~8 ms: sem clique ao ligar, desligar ou mudar a nota
    this.periodoTele = Math.round(fs * 0.1);
  }

  message(m: MensagemTom) {
    if (!m || m.type !== 'tom') return;
    if (m.f != null) this.fAlvo = m.f;
    if (m.amp != null) this.ampLigado = m.amp;
    if (m.ligado != null) this.aAlvo = m.ligado ? this.ampLigado : 0;
    else if (this.aAlvo > 0) this.aAlvo = this.ampLigado;
  }

  process(outL: Float32Array, outR: Float32Array, n: number, sendL?: Float32Array, sendR?: Float32Array) {
    for (let i = 0; i < n; i++) {
      this.f += this.k * (this.fAlvo - this.f);
      this.a += this.k * (this.aAlvo - this.a);
      this.fase += this.f / this.fs;
      if (this.fase >= 1) this.fase -= 1;
      const y = this.a * Math.sin(TAU * this.fase);
      outL[i] = y; outR[i] = y;
      // um pouco para o ambiente, para a reverberação da cadeia ter o que mostrar
      if (sendL) sendL[i] = 0.3 * y;
      if (sendR) sendR[i] = 0.3 * y;
    }
    this.amostras += n;
    this.nTele += n;
    if (this.nTele >= this.periodoTele) {
      this.nTele = 0;
      this.post?.({ type: 'telemetry', f: this.f, amp: this.a, t: this.amostras / this.fs });
    }
  }
}
