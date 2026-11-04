// Configuração que a página manda ao DieselDSP (como src/engines/ronco/config.ts): a especificação do motor
// mais a geometria montada, e a calibração de volume e de potência feita numa sonda fora da thread de áudio.
import { buildDiesel } from './geometria';
import { DieselDSP } from './dsp';
import type { PresetDiesel } from './presets';

// especificação + geometria (sem calibração); os campos do diesel viram os nomes que o EngineDSP lê
export function montarConfig(spec: Partial<PresetDiesel> & Record<string, any>) {
  const engine = buildDiesel(spec);
  const cfg: any = {
    ...spec, N: engine.N, fire: engine.fire, bank: engine.bank, banks: engine.banks,
    axis: engine.axis, z: engine.z, tdcRel: engine.tdcRel, runners: engine.runners, tempos: engine.tempos,
    compression: spec.cr, redline: spec.rpmMax || spec.redline,
  };
  // soprador Roots (2T): o uivo é o do compressor mecânico do Ronco (scType 'roots', relação, lóbulos)
  if (spec.soprador) { cfg.scType = 'roots'; cfg.scRatio = spec.soprador.relacao; cfg.scLobes = spec.soprador.lobulos; cfg.scWhine = spec.soprador.uivo; }
  return cfg;
}

// especificação + geometria + calibração na sonda: o DSP do worklet recebe gain/mkIdle, a potência que o modelo
// entrega (escala de torque até a ficha), o combustível de lenta e o pico do knock de lenta (referência dos tiques)
export function configCalibrada(spec: Partial<PresetDiesel> & Record<string, any>, sr: number) {
  const cfg = montarConfig(spec);
  const probe = new DieselDSP(sr);
  probe.setConfig(cfg);
  cfg.gain = probe.cfgGain; cfg.mkIdle = probe.mkIdle;
  cfg.fuelLenta = probe.fuelLenta; cfg.refKnock = probe.refKnock;
  if (probe.powerModel) { cfg.powerModel = probe.powerModel; cfg.tqPeakModel = probe.tqPeakModel; cfg.frPeakModel = probe.frPeakModel; }
  return cfg;
}
