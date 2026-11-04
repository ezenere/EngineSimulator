// Configuração que a página manda ao DSP (engineConfig() de src/app.js): a especificação do carro
// mais a geometria montada, e a calibração de volume e de potência feita numa sonda, fora da
// thread de áudio (a página chama isto na thread principal e manda o resultado em `config`).
import { build } from './geometria';
import { EngineDSP } from './dsp';
import type { PresetRonco } from './presets';

// especificação + geometria (sem calibração)
export function montarConfig(spec: Partial<PresetRonco> & Record<string, any>) {
  const engine = build(spec);
  const cfg: any = {
    ...spec, N: engine.N, fire: engine.fire, bank: engine.bank, banks: engine.banks,
    axis: engine.axis, z: engine.z, tdcRel: engine.tdcRel, runners: engine.runners,
  };
  if (cfg.banks === 1 && (cfg.routing === 'xpipe' || cfg.routing === 'hpipe')) cfg.routing = 'dual';
  return cfg;
}

// especificação + geometria + calibração na sonda: o DSP do worklet recebe gain/mkIdle (e a potência
// que o modelo entrega, para a escala de torque até a ficha técnica) e não calibra de novo
export function configCalibrada(spec: Partial<PresetRonco> & Record<string, any>, sr: number) {
  const cfg = montarConfig(spec);
  const probe = new EngineDSP(sr);
  probe.setConfig(cfg);
  cfg.gain = probe.cfgGain; cfg.mkIdle = probe.mkIdle;
  if (probe.powerModel) { cfg.powerModel = probe.powerModel; cfg.tqPeakModel = probe.tqPeakModel; cfg.frPeakModel = probe.frPeakModel; }
  return cfg;
}
