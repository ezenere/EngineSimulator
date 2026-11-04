// Adaptador `Motor` (CENA.md 1.3) sobre o JetDSP da Turbina, para a Cena (portadores `aviao` e `helice`).
//
// O JetDSP já calcula as fontes em Pa a 30 m e as soma em barramentos "frente" (entrada de ar, hélice) e "trás"
// (jato, núcleo) por grupo de motores (lado esquerdo e direito). Na passagem legada (`flyby`) a diretividade de
// cada fonte é 1 e a do barramento inteiro é aplicada na propagação: frente `DIR.inlet` (ou `DIR.prop` no
// turboélice) e trás `max(DIR.jetL, 0,55·DIR.jetF, 0,5·DIR.shock)`, com convecção |1 − M·cosθ|^−1,4. O adaptador põe
// o JetDSP nesse modo e lê os barramentos antes da propagação pelo gancho `tap` (duas linhas `if (this.tap) …`,
// só leituras): cada grupo vira duas fontes, `admissao.g` (ou `helice.g`) e `jato.g`, com essas diretividades.
// É a mesma soma que o `flyby` propaga, e é com ela que a Cena reproduz a passagem do 737 a 1500 m do legado.
// (A separação por fonte do CENA 1.3, bypass/núcleo/crepitar/reversor com a diretividade de cada uma, pede outro
// gancho por fonte: fica para quando o gimbal de perto de um jato precisar dela.)
//
// Velocidade: o portador põe `velocidade` (m/s); o JetDSP a usa como `vFly` (Mach na ponta do fan, jato relativo ao
// ar, hélice com o avanço), como no flyby. O estrondo e o tempo de emissão são da Cena (src/scene/supersonico.ts).
// Carga: o JetDSP não integra eixo (a hélice do turboélice tem o governador dele, `np`); `acoplar` só guarda.
import type { FonteSonora, Carga, ComandoMotor, EixoSaida, Vec3, Diretividade } from '../../scene/tipos';
import type { Motor, EstadoMotor, TelemetriaMotor, FamiliaMotor, MontagemMotor } from '../../carriers/tipos';
import { JetDSP } from './dsp';
import { DIR, dir } from './constantes';
import { R_REF } from '../../acoustics';

const tab7 = (f: (th: number) => number) => [0, 30, 60, 90, 120, 150, 180].map((th) => 20 * Math.log10(f(th))) as unknown as Diretividade['tabela'];
/** diretividade do barramento de trás no flyby legado (0° = nariz) */
export const DIR_JATO = tab7((th) => Math.max(dir(DIR.jetL, th), 0.55 * dir(DIR.jetF, th), 0.5 * dir(DIR.shock, th)));
export const DIR_ENTRADA = DIR.inlet as unknown as Diretividade['tabela'];
export const DIR_HELICE = DIR.prop as unknown as Diretividade['tabela'];
/** expoente da convecção do jato legado (CENA 1.2) */
export const EXP_JATO = 1.4;

class TapTurbina {
  saidas: Float32Array[] = [];
  G = 1;
  /** teste da hélice idêntica: o tom da hélice de cada motor, por amostra */
  tomHelice: Float32Array | null = null;
  gravar(i: number, bi: Float64Array) { const o = this.saidas; for (let b = 0; b < o.length; b++) o[b][i] = bi[b]; }
  helice(e: number, x: number) { if (this.tomHelice && e === 0) this.tomHelice[this.k++] = x; }
  k = 0;
}

export class MotorTurbina implements Motor {
  familia: FamiliaMotor = 'turbina';
  dsp: JetDSP;
  fontes: FonteSonora[] = [];
  montagem: MontagemMotor = { posMotor: [0, 0, 0], rotMotor: 'frente' };
  /** m/s, posta pelo portador antes de `processar` */
  velocidade = 0;
  carga: Carga | null = null;
  tap = new TapTurbina();
  fs: number;
  private bL = new Float32Array(4096); private bR = new Float32Array(4096);
  private _eixo: EixoSaida = { omega: 0, torque: 0, inercia: 0 };
  constructor(fs: number) { this.fs = fs; this.dsp = new JetDSP(fs); }

  get estado(): EstadoMotor { const s = this.dsp.state; return s === 'run' ? 'funcionando' : s === 'start' ? 'partida' : s === 'stop' ? 'parando' : 'desligado'; }
  /** eixo: no turboélice, o da hélice (rotação governada `np·propRpm`); no jato, N1 */
  get eixo(): EixoSaida {
    const d = this.dsp, e = this._eixo;
    e.omega = d.prop ? d.np * d.propHz * 2 * Math.PI : (d.n1 ? d.n1[0] : 0) * d.n1Hz * 2 * Math.PI; e.torque = 0; e.inercia = 0;
    return e;
  }
  /** rpm da hélice (turboélice) */
  get rpmHelice() { return this.dsp.np * this.dsp.propHz * 60; }

  /** `preset`: um PresetTurbina (src/engines/turbina/presets.ts). O motor sai ligado, quente, em marcha lenta. */
  configurar(preset: Record<string, any>, fs: number) {
    this.fs = fs;
    const d = this.dsp;
    d.setConfig(preset, false);
    d.params = { ...d.params, listener: 'flyby', alt: 1e4, speed: 0, env: 'runway' };
    d.state = 'run'; d.lit = true; d.fuelOn = true; d.n2 = preset.n2Idle; d.u = 0; d.lightT = 10; d.np = d.prop ? 0.74 : 0;
    this.familia = d.prop ? 'turboelice' : 'turbina';
    // posições dos barramentos (as do legado em solo: z do motor pela montagem)
    const zE = ({ wing: d.prop ? 3.2 : 2.6, rear: 3.4, fuselage: 2.1, nose: 2.2 } as Record<string, number>)[preset.mount] || 2.6;
    const jetOff = 3 + 4 * (d.Dj || 0.6);
    this.fontes = [];
    for (let g = 0; g < d.G; g++) {
      let x = 0, y = 0, z = 0, n = 0;
      for (let e = 0; e < d.E; e++) if (d.grp[e] === g) { x += d.ex[e]; y += d.ey[e]; z += d.E === 3 && e === 1 ? zE + 3 : zE; n++; }
      x /= n; y /= n; z /= n;
      const frente: Vec3 = [x + 1.5, y, z], tras: Vec3 = [x - jetOff, y, z];
      this.fontes.push(d.prop
        ? { id: `helice.${g}`, tipo: 'pa', pos: frente, dir: { tabela: DIR_HELICE, eixo: [1, 0, 0], expConv: EXP_JATO }, refDist: R_REF, dentro: false }
        : { id: `admissao.${g}`, tipo: 'admissao', pos: frente, dir: { tabela: DIR_ENTRADA, eixo: [1, 0, 0], expConv: EXP_JATO }, refDist: R_REF, dentro: false });
      this.fontes.push({ id: `jato.${g}`, tipo: 'escape', pos: tras, dir: { tabela: DIR_JATO, eixo: [1, 0, 0], expConv: EXP_JATO }, refDist: R_REF, dentro: false });
    }
  }
  comandar(c: ComandoMotor) {
    const d = this.dsp;
    if (c.partida && (d.state === 'off' || d.state === 'stop')) d.setRunning(true);
    if (!c.ignicao && d.state !== 'off') d.setRunning(false);
    d.tla = Math.max(0, Math.min(1.3, c.combustivel ?? c.acelerador));
  }
  acoplar(carga: Carga | null) { this.carga = carga; }
  processar(saidas: Float32Array[], n: number) {
    const d = this.dsp;
    d.params.speed = this.velocidade * 3.6;
    this.tap.saidas = saidas;
    d.tap = this.tap;
    if (this.bL.length < n) { this.bL = new Float32Array(n); this.bR = new Float32Array(n); }
    d.process(this.bL, this.bR, n);
    d.tap = null;
  }
  telemetria(): TelemetriaMotor {
    const t = this.dsp.telemetry();
    return { ...t, rpm: t.n2, torque: 0, potencia: 0, estado: this.estado };
  }
}
