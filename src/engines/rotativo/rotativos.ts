// DSP da página Rotativos: um só nó de áudio para as três famílias da página. Com `tipo 'palhetas'` na configuração ele
// toca o PalhetasDSP (sintetizador próprio, 5.3); com 'wankel' ou 'x', o RotativoDSP. As mensagens vão para o motor
// ativo; `params` vai aos dois (o ouvinte e o volume não se perdem na troca).
import type { DSPDeAudio } from '../../worklet/tipos';
import { RotativoDSP } from './dsp';
import { PalhetasDSP } from './palhetas';

export class RotativosDSP implements DSPDeAudio {
  rot: RotativoDSP; pal: PalhetasDSP; ativo: DSPDeAudio;
  private _post: ((m: any) => void) | null = null;
  constructor(fs: number) {
    this.rot = new RotativoDSP(fs); this.pal = new PalhetasDSP(fs); this.ativo = this.rot;
  }
  get post() { return this._post; }
  set post(f) { this._post = f; this.rot.post = f; this.pal.post = f; }
  message(m: any) {
    if (m.type === 'config') {
      const pal = m.cfg?.tipo === 'palhetas';
      const novo = pal ? this.pal : this.rot;
      if (novo !== this.ativo) { this.ativo.message({ type: 'input', ignition: false }); this.ativo = novo; }
      novo.message(m);
      return;
    }
    if (m.type === 'params') { this.rot.message(m); this.pal.message(m); return; }
    this.ativo.message(m);
  }
  process(outL: Float32Array, outR: Float32Array, n: number, sendL?: Float32Array, sendR?: Float32Array) {
    this.ativo.process(outL, outR, n, sendL, sendR);
  }
}
