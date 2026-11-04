// Adaptador `Motor` (CENA.md 1.3, ROTATIVO.md decisão 11) sobre o RotativoDSP, para os portadores de src/carriers/: carro
// (os Mazda, o Ro80, a Norton: `CarroLegado`, o câmbio de dentro do DSP), hélice (Mistral, AE110, AR741), rotor (AE50R no
// Camcopter), gerador (X-Engine) e bancada.
//
// O gancho de leitura é o do EngineDSP (`tap`, TapPistao de src/engines/ronco/motor.ts): as bocas do escape (`escape.k`,
// uma por radiador), `admissao`, `bloco` (vedações de ápice, engrenagem fixa, bomba de óleo), `vibracao`, `turbo`. No carro
// as fontes e as posições são as do Ronco (`fontesPistaoCarro`); fora dele, o motor fica no nariz do avião, atrás da cabine
// do helicóptero ou na carenagem do grupo gerador.
//
// Carga e comando (CENA 1.1.5): no carro a carga é o câmbio de dentro do DSP; na hélice e no rotor, a carga do portador vai
// ao eixo pelos ganchos de aviação (`av`, como o MotorRonco de aviação) e o motor já começa na rotação do portador; no
// gerador a carga vai direto ao eixo (gancho 11: `carga.torque(ω)`, `J + carga.inercia`) e o governador PI do portador
// manda `combustivel`, que vira o acelerador.
//
// Nível absoluto (decisão 11): carros e moto pela referência do Ronco (95 dB SPL a 5 m na condição da calibração); aviação,
// UAV e gerador pelo `nivelEscape` (L_W dB re 1 pW → Pa a 5 m), sem o reforço de lenta da página.
import type { Carga } from '../../scene/tipos';
import { TAU } from '../../acoustics';
import { RotativoDSP, ESCAPE_REF } from './dsp';
import { configCalibrada } from './config';
import { MotorPistaoBase, TapPistao, Acumulador, PA_REF_RONCO } from '../ronco/motor';
import { paLw5 } from '../ronco/aviacao';

/** cfg pronto para o adaptador: geometria, calibração da página e o nível absoluto do preset */
export function prepararMotorRotativo(spec: Record<string, any>, fs: number) {
  const cfg = configCalibrada(spec, fs);
  cfg.kAbs = sondarNivelRotativo(cfg, fs);
  return cfg;
}

/** sonda do nível: plena carga a 55% da rotação máxima. Carros: escape de referência e 95 dB SPL a 5 m (a do Ronco);
 *  aviação, UAV e gerador: o escape do próprio preset e o `nivelEscape` */
export function sondarNivelRotativo(cfg: any, fs: number) {
  const abs = !!cfg.nivelEscape;
  const t = new RotativoDSP(fs);
  const ref = abs ? { ...cfg } : { ...cfg, escape: { ...ESCAPE_REF, Lp: cfg.escape?.Lp ?? 0.3, Dp: cfg.escape?.Dp ?? 50 }, muffler: 'sport', pipeD: 2.5, turbo: cfg.turbo ? { ...cfg.turbo, sequencial: false } : undefined };
  t.setConfig({ ...ref, gain: 1, mkIdle: 1 }, false);
  t.state = 'run'; t.lockOmega = true; t.tempMode = 'fixed'; t.tempSet = 90; t.coolant = 90; t.runT = 100;
  t.omega = (cfg.redline * 0.55 * TAU) / 60; t.rpmAvg = cfg.redline * 0.55;
  t.thrTarget = 1; t.thr = 1; t.turboW = 0.6; t.boost = cfg.boost * 0.3; t.maxBoost = cfg.boost * 0.4;
  if (t.av) { t.magnetos = 'ambos'; t.mistura = 0.8; }
  const acc = new Acumulador(fs);
  const tap = new TapPistao(t, []);
  let amostra = 0;
  tap.medir = (_s, esc) => { if (amostra++ > 0.25 * fs) acc.somar(esc); };
  t.tap = tap;
  const B = 256, L = new Float32Array(B), R = new Float32Array(B);
  for (let i = 0; i < 0.5 * fs; i += B) t.process(L, R, B);
  return (abs ? paLw5(cfg.nivelEscape) : PA_REF_RONCO) / Math.max(acc.rmsZ(), 1e-9);
}

export class MotorRotativo extends MotorPistaoBase {
  readonly familia = 'rotativo' as const;
  declare dsp: RotativoDSP;
  cfg: any = null;
  constructor(fs: number) { super(new RotativoDSP(fs), fs); }

  configurar(preset: Record<string, any>, fs: number) {
    const cfg = preset.gain ? preset : prepararMotorRotativo(preset, fs);
    if (!cfg.kAbs) cfg.kAbs = sondarNivelRotativo(cfg, fs);
    this.cfg = cfg;
    this.dsp.setConfig(cfg);
    this.dsp.message({ type: 'input', temp: { mode: 'fixed', value: 90 } });
    this.montarFontes(cfg.kAbs);
    const port = cfg.portadores || [];
    // fora do carro: escala absoluta, sem o reforço de lenta da página
    if (cfg.nivelEscape) { this.dsp.mkIdle = 1; this.dsp.mk = 1; }
    if (port.includes('rotor')) this.montagem = { posMotor: [-0.3, 0, 0.6], rotMotor: 'frente' };
    else if (port.includes('helice')) this.montagem = { posMotor: [2.0, 0, 1.2], rotMotor: 'frente' };
    else if (port.includes('gerador')) this.montagem = { posMotor: [0, 0, 0.6], rotMotor: 'frente' };
  }

  /** hélice e rotor: a carga do portador vai ao eixo (ganchos de aviação) e o motor já começa na rotação dele; gerador:
   *  a carga vai direto ao eixo (gancho 11); carro: a carga é a de dentro do DSP */
  acoplar(carga: Carga | null) {
    this.carga = carga;
    const d: any = this.dsp;
    if (d.av) {
      d.cargaExterna = carga; d.carga = carga || d.cargaAv; if (carga) d.heliceSom = null;
      const k: any = (carga as any)?.cfg;
      if (!k) return;
      const rpm = k.nHelice ? k.nHelice * k.i * 0.92 : k.Nr ? k.Nr * k.icx : d.idle;
      d.state = 'run'; d.ignition = true; this.ign = true; d.runT = 120; d.coolant = 90; d.warm = 1; d.exhT = 600;
      d.omega = (rpm * TAU) / 60; d.rpmAvg = rpm;
    } else if ((this.cfg?.portadores || []).includes('gerador')) d.carga = carga;
  }
}
