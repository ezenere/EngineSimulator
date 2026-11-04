// Adaptador `Motor` do Elétrico para a Cena e os portadores (ELETRICO.md 4.2). O EletricoDSP já é um `Motor` (escreve
// os canais das fontes direto, sem `tap`); este arquivo acrescenta o nível absoluto: os `niveis` do preset são L_W dB(A)
// na condição de referência (torque nominal na rotação de base: motor, inversor, redução; rotação nominal: ventilador,
// escovas, hélice em pairado; o auxiliar é constante), e `kAbs` por fonte vem de uma sonda na thread principal
// (`sondarNivelEletrico`: 0,5 s na condição de referência, RMS ponderado A pelo `Acumulador` de ronco/motor.ts, `paDeLw`),
// como `sondarNivelDiesel`. O AVAS é calibrado analiticamente (avas.ts). Com o chopper a referência do inversor é D = 0,5
// (meia rotação de base): em D = 1 (série plena) ele não soa.
import type { FonteSonora } from '../../scene/tipos';
import { EletricoDSP, type PresetEletrico, type IdCanalEletrico } from './dsp';
import { Acumulador } from '../ronco/motor';
import { paDeLw } from '../../carriers/ruido';
import { TAU, REF_DIST_ELETRICO } from './constantes';

export type CfgEletrico = PresetEletrico & { kAbs?: Record<string, number>; segundo?: CfgEletrico };

const BASES: IdCanalEletrico[] = ['motor', 'inversor', 'reducao', 'ventilador', 'escovas', 'helice', 'aux'];

/** RMS ponderado A de cada canal base (unidade de referência) na condição dada, com kAbs = 1 */
function medir(p: PresetEletrico, fs: number, fracBase: number) {
  const d = new EletricoDSP(fs);
  d.configurar({ ...p, kAbs: undefined }, fs);
  const wb = (p.rpmBase * TAU) / 60;
  d.comandar({ acelerador: 1, ignicao: true, partida: false, omegaImposta: wb * fracBase, torqueFixo: p.Tn, v: 20 } as never);
  // ventiladores forçados já na rotação (a subida de 1,5 s fica fora da sonda)
  for (const U of d.uni) if (U.ven && p.ventilacao?.forcada) U.ven.wv = U.ven.fRef();
  // unidade de referência: a de desvio de rotação mais perto de zero (drone: o rotor de detune 0)
  let uRef = 0;
  d.uni.forEach((U, i) => { if (Math.abs(U.det - 1) < Math.abs(d.uni[uRef].det - 1)) uRef = i; });
  const idx = new Map<IdCanalEletrico, number>();
  d.canais.forEach((c, i) => { if ((c.u === uRef || c.u === -1) && c.id !== 'avas.re' && c.base !== 'avas') idx.set(c.base, i); });
  const acc = new Map<IdCanalEletrico, Acumulador>();
  for (const b of idx.keys()) acc.set(b, new Acumulador(fs));
  const B = 128, saidas = d.canais.map(() => new Float32Array(B));
  const N = Math.round(0.5 * fs), ini = Math.round(0.25 * fs);
  for (let k = 0; k < N; k += B) {
    d.processar(saidas, B);
    if (k >= ini) for (const [b, i] of idx) { const a = acc.get(b)!, x = saidas[i]; for (let j = 0; j < B; j++) a.somar(x[j]); }
  }
  const out: Partial<Record<IdCanalEletrico, number>> = {};
  for (const [b, a] of acc) out[b] = a.rmsA();
  return out;
}

/** kAbs por fonte: cada canal no L_W dB(A) do preset na condição de referência */
export function sondarNivelEletrico(p: PresetEletrico, fs: number) {
  const k: Record<string, number> = { avas: 1 };
  const m1 = medir(p, fs, 1);
  const chopper = p.inversor?.tipo === 'chopper' || p.inversor?.modo === 'chopper';
  const m2 = chopper ? medir(p, fs, 0.5) : null;
  for (const b of BASES) {
    const lw = (p.niveis as Record<string, number | undefined>)[b];
    const r = b === 'inversor' && m2 ? m2.inversor : m1[b];
    if (r === undefined) continue;
    k[b] = lw && r > 1e-12 ? paDeLw(lw, REF_DIST_ELETRICO) / r : 0;
  }
  return k;
}

/** cfg pronto para o worklet: o preset com `kAbs` (e o do segundo motor) */
export function prepararMotorEletrico(p: PresetEletrico, fs: number): CfgEletrico {
  const cfg: CfgEletrico = { ...p, kAbs: sondarNivelEletrico(p, fs) };
  if (p.segundo) cfg.segundo = prepararMotorEletrico(p.segundo, fs);
  return cfg;
}

export class MotorEletrico extends EletricoDSP {
  cfg!: CfgEletrico;
  constructor(fs: number) { super(fs); }
  configurar(preset: object, fs: number) {
    const p = preset as CfgEletrico;
    const cfg = p.kAbs ? p : prepararMotorEletrico(p, fs);
    this.cfg = cfg;
    super.configurar(cfg, fs);
  }
  /** fontes do motor (posições do preset, no referencial do motor) */
  get fontesMotor(): readonly FonteSonora[] { return this.fontes; }
}
