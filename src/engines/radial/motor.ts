// Adaptador `Motor` (CENA.md 1.3, RADIAL.md 3.7) sobre o RadialDSP, para os portadores de src/carriers/: hélice (aviões),
// rotor (S-55), carro (Sherman, Trossi, Megola: `CarroLegado`, o câmbio de dentro do DSP) e bancada.
//
// O gancho de leitura é o do EngineDSP (`tap`, TapPistao de src/engines/ronco/motor.ts): as bocas do escape (`escape.k`,
// uma por radiador: estaque, saída do anel, cauda da turbina), `admissao` (carburador + superalimentador, dentro da
// carenagem), `bloco` (cilindros e aletas expostos: `dentro: false`), `vibracao` e `compressor` (o uivo do impulsor).
//
// Carga e comando (CENA 1.1.5): `acoplar(carga)` põe a carga do portador no eixo do DSP (gancho 11): a CargaHelice do
// portador Helice (com o governador de passo dele) ou a CargaRotor (o governador do rotor manda `combustivel`, que aqui
// vira o acelerador, como o governador do R44 mexe na borboleta). Com um portador em voo, o motor já começa funcionando
// na rotação do portador (`emVoo`): a Passagem mostra o avião passando, não a partida.
//
// Nível absoluto (RADIAL.md 3.7): `kAbs` leva a soma das bocas em plena carga a 55% da rotação máxima, com o escape do
// próprio preset, ao `nivelEscape` (L_W dB re 1 pW → Pa a 5 m por L_p = L_W − 20·log₁₀ 5 − 11). Sem o reforço de lenta da
// página (`mk` = 1): a lenta fica onde a física a põe.
import type { FonteSonora, Vec3, Carga } from '../../scene/tipos';
import { TAU } from '../../acoustics';
import { RadialDSP } from './dsp';
import { configCalibrada } from './config';
import { MotorPistaoBase, TapPistao, Acumulador } from '../ronco/motor';
import { paLw5 } from '../ronco/aviacao';

/** diretividades (CENA 1.3; 0° = eixo): bloco exposto na boca da carenagem e as bocas do escape (para trás e para baixo) */
const T_BLOCO = [0, -1, -3, -6, -8, -10, -12] as const;
const T_BOCA = [0, -0.5, -1.5, -3, -4.5, -6, -7] as const;
const T_DENTRO = [0, -1, -2, -4, -6, -8, -9] as const;

const dir = (tabela: readonly number[], eixo: Vec3) => ({ tabela: tabela as any, eixo, expConv: 2 });

/** fontes do radial no referencial do motor (origem no cubo do virabrequim); os pesos dos canais vão em `especs` */
export function fontesRadial(dsp: RadialDSP, cfg: any) {
  const fontes: FonteSonora[] = [];
  const terra = (cfg.portadores || []).includes('carro');
  // bocas: na carenagem, a ~0,6 m do eixo no ângulo da saída, 1 m atrás do nariz (avião); no tanque, na traseira
  dsp.rads.forEach((_r: any, k: number) => {
    const ph = ((dsp.radPhi?.[k] ?? 180) * Math.PI) / 180;
    const pos: Vec3 = terra ? [-2.6, 0.5 * Math.sin(ph), 0.4] : [-1.0, 0.6 * Math.sin(ph), 0.6 * Math.cos(ph) - 0.1];
    fontes.push({ id: `escape.${k}`, tipo: 'escape', pos, dir: dir(T_BOCA, [-1, 0, -0.3]), refDist: 5, dentro: false });
  });
  const expostos = !terra; // (no Sherman e no Trossi o motor fica num compartimento)
  const especs: { id: any; peso: number; vias: any }[] = [];
  const via = { cabine: { ganho: 0.3, fc: 900 }, cofre: { ganho: 1, fc: 0 } };
  const add = (id: string, tipo: FonteSonora['tipo'], peso: number, dentro: boolean, tabela: readonly number[], eixo: Vec3, pos: Vec3) => {
    especs.push({ id, peso, vias: via });
    fontes.push({ id, tipo, pos, dir: dir(tabela, eixo), refDist: 5, dentro, vias: dentro ? via : undefined });
  };
  add('admissao', 'admissao', 0.12, true, T_DENTRO, [1, 0, 0], [0.3, 0, -0.3]);
  add('bloco', 'mecanica', 0.12, !expostos, expostos ? T_BLOCO : T_DENTRO, [1, 0, 0], [0.2, 0, 0]);
  add('vibracao', 'mecanica', 0.3, true, T_DENTRO, [1, 0, 0], [0, 0, 0]);
  if (dsp.blower) add('compressor', 'compressor', 0.5, true, T_DENTRO, [1, 0, 0], [-0.4, 0, 0]);
  // rajada do anel de chapa fina e das juntas deslizantes (breakout 'old'/'leaky'), colada a cada abertura de válvula
  if (dsp.breakK) add('coletor', 'escape', 0.7, false, T_BOCA, [-1, 0, -0.3], [-0.5, 0, 0]);
  return { fontes, especs };
}

/** cfg pronto para o adaptador: geometria, calibração da página e o nível absoluto do preset */
export function prepararMotorRadial(spec: Record<string, any>, fs: number) {
  const cfg = configCalibrada(spec, fs);
  cfg.kAbs = sondarNivelRadial(cfg, fs);
  return cfg;
}

/** sonda do nível: plena carga a 55% da rotação máxima, com o escape do preset (3.7) */
export function sondarNivelRadial(cfg: any, fs: number) {
  const t = new RadialDSP(fs);
  t.setConfig({ ...cfg, gain: 1, mkIdle: 1 }, false);
  t.state = 'run'; t.lockOmega = true; t.tempMode = 'fixed'; t.tempSet = 90; t.coolant = 90; t.runT = 100;
  t.omega = (cfg.redline * 0.55 * TAU) / 60; t.rpmAvg = cfg.redline * 0.55;
  t.thrTarget = 1; t.thr = 1; t.boost = cfg.boost * 0.8; t.maxBoost = cfg.boost * 0.8;
  t.magnetos = 'ambos'; t.mistura = 0.8;
  const acc = new Acumulador(fs);
  const tap = new TapPistao(t, []);
  let amostra = 0;
  tap.medir = (_s, esc) => { if (amostra++ > 0.25 * fs) acc.somar(esc); };
  t.tap = tap;
  const B = 256, L = new Float32Array(B), R = new Float32Array(B);
  for (let i = 0; i < 0.5 * fs; i += B) t.process(L, R, B);
  return paLw5(cfg.nivelEscape || 140) / Math.max(acc.rmsZ(), 1e-9);
}

export class MotorRadial extends MotorPistaoBase {
  readonly familia = 'radial' as const;
  declare dsp: RadialDSP;
  cfg: any = null;
  constructor(fs: number) { super(new RadialDSP(fs), fs); }

  configurar(preset: Record<string, any>, fs: number) {
    const cfg = preset.gain ? preset : prepararMotorRadial(preset, fs);
    if (!cfg.kAbs) cfg.kAbs = sondarNivelRadial(cfg, fs);
    this.cfg = cfg;
    this.dsp.setConfig(cfg);
    this.dsp.mkIdle = 1; this.dsp.mk = 1; // (escala absoluta: sem o reforço de lenta da página)
    this.dsp.message({ type: 'input', temp: { mode: 'fixed', value: 90 } });
    const { fontes, especs } = fontesRadial(this.dsp, cfg);
    this.fontes = fontes;
    const terra = (cfg.portadores || []).includes('carro');
    this.montagem = { posMotor: terra ? [-1.2, 0, 1.0] : [2.5, 0, 2.0], rotMotor: 'frente' };
    this.tap = new TapPistao(this.dsp, especs);
    this.tap.kAbs = cfg.kAbs;
  }

  /** a carga do portador vai ao eixo; a hélice da página sai (o portador tem a dele) */
  acoplar(carga: Carga | null) {
    this.carga = carga;
    const d = this.dsp;
    d.cargaExterna = carga; d.carga = carga || d.cargaAv; d.heliceSom = carga ? null : d.heliceSom;
    if (carga) this.emVoo(carga);
  }

  /** motor funcionando, quente, na rotação em que o portador o quer (hélice: a rotação governada; rotor: o Nr nominal) */
  emVoo(carga: any) {
    const d = this.dsp, k = carga.cfg || {};
    const rpm = k.nHelice ? k.nHelice * k.i * 0.92 : k.Nr ? k.Nr * k.icx : d.idle;
    d.state = 'run'; d.ignition = true; this.ign = true; d.runT = 120; d.fase = 'pegou'; d.coolant = 90; d.warm = 1; d.exhT = 450;
    d.omega = (rpm * TAU) / 60; d.rpmAvg = rpm; d.magnetos = 'ambos';
  }

  comandar(c: { acelerador: number; ignicao: boolean; partida: boolean; combustivel?: number; rpmAlvo?: number }) {
    if (c.ignicao !== this.ign) { this.ign = c.ignicao; this.dsp.message({ type: 'input', ignition: c.ignicao }); }
    this.dsp.message({ type: 'input', throttle: c.combustivel ?? c.acelerador });
  }

  get rpmHelice() { const k = this.carga as any; return k?.cfg?.i ? ((this.dsp.omega / k.cfg.i) * 60) / TAU : 0; }
  telemetria() { const t = this.dsp.telemetry(), w = this.dsp.omega; return { ...t, rpm: t.rpm, torque: t.torque, potencia: t.torque * w, estado: this.estado }; }
}
