// Peças do escape diesel que o Ronco não tem (DIESEL.md 5): filtro de partículas, abafador de caminhão e chaminé.
// Derivadas do TwoPort de src/acoustics/guias.ts sem mexer nele: o construtor da base monta a turbina (tipo
// desconhecido) e aqui a cadeia de filtros e os coeficientes são trocados.
import { Biquad, TwoPort, onePole } from '../../acoustics';

export type TipoDoisPortasDiesel = 'dpf' | 'abafador-caminhao' | 'chamine';

export class DoisPortasDiesel extends TwoPort {
  constructor(fs: number, a: any, b: any, kind: TipoDoisPortasDiesel) {
    super(fs, a, b, 'turbo');
    this.chain = [];
    const q = (f: Biquad) => this.chain.push(f);
    let lr = 1400;
    if (kind === 'dpf') {
      // DOC + DPF: a colmeia de cerâmica (milhares de canais finos) é um passa-baixa de verdade e reflete pouco
      q(new Biquad().lp(fs, 1200, 0.7)); q(new Biquad().lp(fs, 1200, 0.7));
      this.gT = 0.85; this.rA = 0.3; this.rB = 0.15; this.x = 0.05; lr = 600;
    } else if (kind === 'abafador-caminhao') {
      // abafador grande de caminhão/ônibus: câmaras longas, o grave da ignição (30–100 Hz) passa e até ganha um pouco
      q(new Biquad().lp(fs, 900, 0.7)); q(new Biquad().lp(fs, 900, 0.7)); q(new Biquad().peak(fs, 90, 0.9, 3));
      this.gT = 0.9; this.rA = 0.25; this.rB = 0.12; this.x = 0.06; lr = 500;
    } else {
      // chaminé curta de locomotiva: só um tubo largo com o silenciador de faíscas, quase transparente
      q(new Biquad().lp(fs, 6000, 0.6));
      this.gT = 0.97; this.rA = 0.05; this.rB = 0.02; this.x = 0.02;
    }
    this.k = onePole(fs, lr); this.s = 0;
  }
}
