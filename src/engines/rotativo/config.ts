// Configuração que a página manda ao RotativoDSP (como src/engines/ronco/config.ts e radial/config.ts): a ficha do preset
// traduzida para os campos que o EngineDSP lê, mais a geometria de montarRotativo, e a calibração de volume e de potência
// numa sonda (fora da thread de áudio).
//
// Tradução (ROTATIVO.md 6.1): `rpmMax` → `redline`; `cr` → `compression`; `J` → `inertia` = J/(0,05 + 0,045·L) (a fórmula
// do Ronco dá de volta o J do motor); `rotores` → N = 3·rotores câmaras com fire = φ_rotor + 360·flanco, `bank` = rotor
// (o primário onde as 3 câmaras do rotor descarregam e onde os estouros entram); `Vcam` de (R, e, b); `cam` = índice da
// sobreposição das janelas (o Ronco o usa na dispersão da lenta). O motor de palhetas não passa por aqui (palhetas.ts).
import { montarRotativo } from './geometria';
import { RotativoDSP } from './dsp';
import { ADMISSAO, ESCAPE } from './constantes';
import { PADRAO_ROTATIVO, type PresetRotativo } from './presets';

/** sobreposição das janelas (°e): EC − IO (negativa = nenhuma) */
export const sobreposicao = (j: PresetRotativo['janelas']) => ESCAPE[j.escape].fecha - ADMISSAO[j.admissao].abre;

export function montarConfig(spec: Partial<PresetRotativo> & Record<string, any>) {
  const s = { ...PADRAO_ROTATIVO, ...spec } as any;
  const m = montarRotativo(s);
  const ov = sobreposicao(s.janelas);
  const cfg: any = {
    ...s,
    redline: s.rpmMax, compression: s.cr, inertia: (s.J || 0.2) / (0.05 + 0.045 * s.displacement),
    aspiration: s.turbo ? 'turbo' : 'na', boost: s.turbo ? s.turbo.boost : 0,
    cam: Math.min(0.7, Math.max(0.1, 0.15 + ov / 260)),
    N: m.N, fire: m.fire, bank: m.bank, banks: m.banks, axis: m.axis, z: m.z, tdcRel: m.tdcRel, runners: m.runners,
    Vcam: m.Vcam, Vmin: m.Vmin, boreEq: m.boreEq, cyc: m.cyc, kVol: m.kVol, rotores: m.rotores, sobreposicao: ov,
  };
  return cfg;
}

export function configCalibrada(spec: Partial<PresetRotativo> & Record<string, any>, sr: number) {
  const cfg = montarConfig(spec);
  const probe = new RotativoDSP(sr);
  probe.setConfig(cfg);
  cfg.gain = probe.cfgGain; cfg.mkIdle = probe.mkIdle; cfg.iacLenta = probe.iacLenta;
  if (probe.powerModel) { cfg.powerModel = probe.powerModel; cfg.tqPeakModel = probe.tqPeakModel; cfg.frPeakModel = probe.frPeakModel; }
  return cfg;
}
