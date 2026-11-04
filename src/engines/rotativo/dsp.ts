// Motor rotativo (docs/ROTATIVO.md), como subclasse do EngineDSP do Ronco (o padrão do DieselDSP e do RadialDSP).
// Passo 1: só as flags; os ganchos `if (this.rot)` do EngineDSP ficam sem efeito até a subclasse pôr os métodos.
import { EngineDSP } from '../ronco/dsp';

export class RotativoDSP extends EngineDSP {
  constructor(fs: number) {
    super(fs);
    this.rot = true; this.cyc = 1080;
  }
}
