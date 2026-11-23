// Estado e ações da página do Radial, fora do React. O comum das páginas a pistão está em src/pages/comum/controle.ts;
// aqui fica o que é do radial: a geometria da biela-mestra (fileiras × cilindros), o escape radial, a manete de potência
// dos aviões e do helicóptero, a aviação (`{ type: 'av', … }`: magnetos, mistura, passo, coletivo, embreagem, primer,
// partida, superalimentador) e a partida em fases.
import { buildRadial, type MotorRadial } from '../../engines/radial/geometria';
import { PRESETS_RADIAL, PADRAO_RADIAL, type PresetRadial } from '../../engines/radial/presets';
import { configCalibrada } from '../../engines/radial/config';
import { AV_PADRAO, passoDaMistura, proximoMagneto, type EstadoAv } from '../comum/Aviacao';
import { ControlePistao, estadoInicial, type EstadoPistao, type Lento, type ParamsPistao } from '../comum/controle';

export type Spec = PresetRadial & Record<string, any>;
export type ParamsRadial = ParamsPistao;
export type { Lento };
export type EstadoRadial = EstadoPistao<Spec, MotorRadial> & {
  av: EstadoAv;
  /** fase da partida e magnetos vindos da telemetria (o botão muda de rótulo: energizar → engatar → magnetos → desligar) */
  fase?: string; magnetosTele?: string;
};
export type Telemetria = Record<string, any> & { rpm: number; theta: number; state: string };

/** especificação completa de um preset: padrões do radial, a ficha e o `redline` que os mostradores do Ronco leem */
export const specDe = (p: PresetRadial): Spec => ({ ...PADRAO_RADIAL, ...p, redline: p.rpmMax } as Spec);

export class ControleRadial extends ControlePistao<Spec, MotorRadial, EstadoRadial> {
  constructor() {
    const p = PRESETS_RADIAL[0];
    const spec = specDe(p);
    super({ ...estadoInicial(spec, buildRadial(spec), p, { roadDist: 12 }), av: { ...AV_PADRAO } });
  }

  protected montar(spec: Spec) { return buildRadial(spec); }
  protected configDoMotor(sr: number) { return configCalibrada(this.spec, sr); }
  protected depoisDaConfig() { this.enviarAv(); }
  protected aoIniciarAudio() { this.sendInput(); }
  // (os magnetos ficam no automático, que liga na 9ª pá, até o usuário mexer neles)
  private enviarAv() { this.audio?.send({ type: 'av', ...this.estado.av, magAuto: true }); }

  /** com hélice ou rotor o comando de potência é a manete; no tanque, no carro e na moto, o pedal */
  get comManete() { return !(this.spec.portadores || []).includes('carro'); }

  // (no Radial o observador fica junto do motor: não há via)
  setCarMic(v: string) { this.setListener('car', v); }

  setEscape(patch: Record<string, any>) { this.setSpec({ escape: { ...this.spec.escape, ...patch } } as Partial<Spec>); }
  /** fileiras × cilindros: 1 × 3/5/7/9, 2 × 7/9 (14, 18), 4 × 7 (28) */
  setArranjo(rows: number, porFileira: number) {
    const N = rows * porFileira;
    const ordens: Record<number, string | undefined> = { 3: '1-3-2', 5: '1-3-5-2-4', 7: '1-3-5-7-2-4-6', 9: '1-3-5-7-9-2-4-6-8', 14: '1-10-5-14-9-4-13-8-3-12-7-2-11-6', 18: '1-12-5-16-9-2-13-6-17-10-3-14-7-18-11-4-15-8' };
    const esc = { ...this.spec.escape };
    if (rows === 1) { delete esc.porFileira; delete esc.juntar; delete esc.turbina; }
    if (rows === 4 && esc.tipo === 'anel') esc.juntar = [[0, 1], [2, 3]];
    this.setSpec({ cylinders: N, rows, cylPerRow: porFileira, crank: rows === 4 ? 'mestra4' : 'mestra', order: ordens[N], escape: esc } as Partial<Spec>);
  }
  loadPreset(p: PresetRadial) {
    const spec = specDe(p);
    const av = { ...AV_PADRAO, magnetos: p.magnetosPadrao || 'ambos', mistura: p.misturaPadrao ?? 0.8 };
    // (motor novo começa parado: a partida de um radial é um procedimento, não um giro automático)
    this.audio?.send({ type: 'input', ignition: false });
    this.mudar({ spec, motor: buildRadial(spec), presetId: p.id, av, ignicao: false }, true);
    this.pushConfig(true, true);
    // (do avião para o tanque e de volta: o comando de potência muda de manete para pedal)
    this.sendInput();
  }

  // ---------------------------------------------------------------- aviação
  setAv(p: Partial<EstadoAv>) { this.mudar({ av: { ...this.estado.av, ...p } }, true); this.audio?.send({ type: 'av', ...p }); }
  cycleMagnetos() { this.setAv({ magnetos: proximoMagneto(this.estado.av.magnetos) }); }
  stepMistura(d: number) { this.setAv({ mistura: passoDaMistura(this.estado.av.mistura, d) }); }
  /** liga os magnetos à mão durante a partida (tecla I com o motor girando) */
  ligarMagnetos() { this.setAv({ magnetos: 'ambos' }); }

  /** botão de partida em fases: ENERGIZAR (inércia) → ENGATAR; ou GIRAR; com o motor girando sem magnetos, liga os magnetos */
  toggleIgnition() {
    this.ignitionAt = performance.now();
    const f = this.tele.fase;
    if (this.estado.ignicao && f === 'energizar') { this.audio?.send({ type: 'av', partida: 'engatar' }); return Promise.resolve(); }
    if (this.estado.ignicao && f === 'girar' && this.tele.magnetos === 'desligado') { this.ligarMagnetos(); return Promise.resolve(); }
    return this.setIgnition(!this.estado.ignicao);
  }
  shift(dir: number) { if ((this.spec.portadores || []).includes('carro')) this.audio?.send({ type: 'input', shift: dir }); }

  protected telemetria(m: any) {
    super.telemetria(m);
    if (m.fase !== this.estado.fase || m.magnetos !== this.estado.magnetosTele) this.mudar({ fase: m.fase, magnetosTele: m.magnetos });
    // (energizando o volante, o motor ainda está parado)
    if (m.fase !== 'energizar' && this.apagou(m, 3000)) this.mudar({ ignicao: false });
  }
}
