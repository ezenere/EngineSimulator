// Configuração que a página manda ao RadialDSP (como src/engines/ronco/config.ts): a ficha do preset traduzida para os
// campos que o EngineDSP lê, mais a geometria de buildRadial, e a calibração de volume e de potência numa sonda.
//
// Tradução (RADIAL.md 5.1): `rpmMax` → `redline`; `cr` → `compression`; `J` → `inertia` = J/(0,05 + 0,045·L) (a fórmula
// do Ronco dá de volta o J do motor; a hélice entra pela carga); carburador de pressão → `fuel 'efi'` (dispersão ×1),
// de boia → `'carb'` (×2,6 e o galope do Ronco); superalimentador → `aspiration 'super'`, `scType 'centrifugal'`,
// `scRatio`, `scLobes`, `boost`, `scWhine` (−18 dB: fora do avião ele quase não se ouve). Para o DSP, `bank` é o grupo
// de escape (onde os estouros entram) e `fileira` vai à parte (vibração, mostradores).
import { buildRadial } from './geometria';
import { RadialDSP } from './dsp';
import { PADRAO_RADIAL, type PresetRadial } from './presets';

export function montarConfig(spec: Partial<PresetRadial> & Record<string, any>) {
  const s = { ...PADRAO_RADIAL, ...spec } as any;
  const m = buildRadial(s);
  const sa = s.superalimentador, J = (s.J || 1) + (s.volante || 0);
  const cfg: any = {
    ...s,
    aviation: true, redline: s.rpmMax, compression: s.cr, inertia: J / (0.05 + 0.045 * s.displacement),
    fuel: s.carburador === 'pressao' ? 'efi' : 'carb',
    aspiration: sa ? 'super' : 'na', boost: sa ? sa.boost : 0, scType: 'centrifugal', scRatio: sa?.relacao, scLobes: sa?.pas, scWhine: sa?.uivoDb ?? -21,
    N: m.N, fire: m.fire, bank: m.grupo, banks: m.grupos, fileira: m.fileira, axis: m.phi, z: m.z, tdcRel: m.tdcRel,
    runners: m.runners, curso: m.curso, phi: m.phi, grupo: m.grupo, rows: m.rows,
  };
  return cfg;
}

export function configCalibrada(spec: Partial<PresetRadial> & Record<string, any>, sr: number) {
  const cfg = montarConfig(spec);
  const probe = new RadialDSP(sr);
  probe.setConfig(cfg);
  cfg.gain = probe.cfgGain; cfg.mkIdle = probe.mkIdle;
  if (probe.powerModel) { cfg.powerModel = probe.powerModel; cfg.tqPeakModel = probe.tqPeakModel; cfg.frPeakModel = probe.frPeakModel; }
  return cfg;
}
