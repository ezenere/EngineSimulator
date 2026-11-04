// Adaptador `Motor` (CENA.md 1.3) sobre o EngineDSP do Ronco, e a base dos motores a pistão que herdam dele
// (o DieselDSP; o radial e a aviação da etapa 3 seguirão o mesmo molde, RADIAL.md 3.7).
//
// O DSP não muda: o laço de amostra continua produzindo o estéreo legado (que aqui é descartado), e o gancho
// `this.tap` do EngineDSP (três linhas `if (this.tap) …`, só leituras) entrega a este arquivo, a cada amostra,
// os sinais que já existem antes da mistura do ouvinte: o de cada ponteira (`x` do radiador, sem o reforço de
// +3 dB em 110 Hz dos microfones junto ao carro, `radSh`: a Cena calcula a imagem no solo de verdade, 2.4) e
// `inP`, `inH`, `mech`, `vib`, `tur`, `sc`, `brk`. Daqui eles saem como canais mono em Pa a `refDist` = 5 m.
//
// Pesos de fora: os do `road()` do legado, que é a passagem que a Cena substitui. Nele o que vem do cofre de um
// motor dianteiro (`eng = 0,12·inP + 0,12·inH + 0,1·mech + 0,8·sc` e `0,2·tur`) irradia para a frente com
// (0,5 + 0,3·cosθ) e o escape (com o que vem de um motor traseiro) para trás com (0,3 + 0,8·traseira); aqui
// isso vira diretividade (tabelas T_FRENTE e T_TRAS) e o canal fica no nível do eixo, relativo ao escape (÷1,1).
// Vias estruturais (cabine e cofre, 3.3): os pesos do `int` e do `bay` do legado, divididos pelo peso de fora.
//
// Nível absoluto (decisão do CENA.md 1.3): uma sonda na thread principal (`sondarNivel`) renderiza a condição de
// referência da calibração do Ronco (carga total a 55% da faixa vermelha, escape de referência, motor quente) e
// mede a soma das ponteiras; `kAbs` leva essa soma a DB_REF_RONCO (95 dB SPL; o CENA dizia 100) a 5 m atrás. A lenta mantém o reforço
// da calibração (`mk`, a lenta 21 dB abaixo da carga). O diesel em gerador e locomotiva usa `L_W` dB(A) (DIESEL.md
// 6.3), com a sonda dele (src/engines/diesel/motor.ts).
import type { FonteSonora, Carga, ComandoMotor, EixoSaida, Vec3, Diretividade, ViasEstruturais } from '../../scene/tipos';
import type { MotorLegado, EstadoMotor, TelemetriaMotor, FamiliaMotor, MontagemMotor } from '../../carriers/tipos';
import { Biquad, TAU } from '../../acoustics';
import { PonderacaoA } from '../../scene/filtros';
import { EngineDSP } from './dsp';
import { montarConfig, configCalibrada } from './config';

/**
 * escape (CENA 1.3), eixo [−1, 0, 0]. O CENA escreve a tabela `[−14, −12, −8, −4, −1, 0, 0]` medida a partir da
 * frente (a convenção do DIR do jet-dsp: 0° = entrada de ar): −14 dB para quem está na frente, 0 atrás. Com o eixo
 * para trás, o 0° da tabela é atrás, então ela vai invertida (com a do CENA lida à letra o escape soprava para a frente).
 */
export const T_ESCAPE_CENA = [0, 0, -1, -4, -8, -12, -14] as const;
/**
 * A usada: a do road() legado, (0,3 + 0,8·traseira)/1,1, que difere da do CENA em até 2,7 dB na frente (−11,3 contra
 * −14): a curva nível × x da passagem a 6 m tem de ficar a ±1 dB da do legado (tabela "não pode piorar", 2.11).
 */
export const T_ESCAPE = [0, -0.4, -1.7, -3.9, -6.9, -9.9, -11.3] as const;
/** corte do `shade` do road() por ângulo a partir de trás: 900 + 15000·traseira², traseira = (1 + cos φ)/2 */
export const AGUDO_ESCAPE = [0, 30, 60, 90, 120, 150, 180].map((g) => { const tr = 0.5 + 0.5 * Math.cos((g * Math.PI) / 180); return 900 + 15000 * tr * tr; });
/** o que sai do cofre de um motor dianteiro no road(): (0,5 + 0,3·cosθ)/0,8, eixo [1, 0, 0] */
export const T_FRENTE = [0, -0.4, -1.8, -4.1, -7.2, -10.5, -12] as const;
/** o que vai junto do escape (motor central ou traseiro) no road(): (0,3 + 0,8·traseira)/1,1, eixo [−1, 0, 0] */
export const T_TRAS = [0, -0.4, -1.7, -3.9, -6.9, -9.9, -11.3] as const;
/**
 * Referência do nível (CENA 1.3): dB SPL em campo livre a 5 m atrás, em carga total a 55% da faixa vermelha com o
 * escape de referência. O CENA fixou 100 dB; com 100 o Camaro SS em 3ª, pé no fundo, passa a 6 m com L_AFmax de
 * 94 dB(A) (o solo soma 3–5 dB no grave), acima dos 85–90 dB(A) que a validação pede para um carro em carga a 6 m.
 * Com 95 dá 89 (tools/cena/motores.ts, níveis). Ver docs/TECNICO.md → Adaptadores de motor.
 */
export const DB_REF_RONCO = 95;
export const PA_REF_RONCO = 2e-5 * Math.pow(10, DB_REF_RONCO / 20);
export const REF_DIST_RONCO = 5;
/** Pa RMS a 5 m de uma fonte de potência L_W (dB re 1 pW): L_p = L_W − 20·log₁₀ 5 − 11 */
export const paDeLw5 = (lw: number) => 2e-5 * Math.pow(10, (lw - 20 * Math.log10(REF_DIST_RONCO) - 11) / 20);

/** posição do motor no carro (CENA 1.3) pelo campo `engine` do preset */
export const POS_MOTOR_CARRO: Record<string, Vec3> = { front: [1.6, 0, 0.7], mid: [-0.5, 0, 0.6], rear: [-1.8, 0, 0.6] };
/** traseira do carro de 4,6 m (CENA 4.1) e altura das ponteiras */
export const X_PONTEIRA = -2.35, Z_PONTEIRA = 0.35;

type IdCanal = 'admissao' | 'bloco' | 'vibracao' | 'compressor' | 'turbo' | 'coletor';
interface EspecCanal { id: IdCanal; peso: number; vias: ViasEstruturais }

/**
 * Recebe os sinais do laço do EngineDSP (gancho `tap`) e escreve os canais. Sem alocação: chamado por amostra.
 * Ordem dos canais: as ponteiras (escape.0…), depois `extras` na ordem de `especs`.
 */
export class TapPistao {
  dsp: EngineDSP;
  n: number;                        // ponteiras
  hp: Biquad[];                     // cópia do radHP (passa-alta de 45 Hz) para tirar o x antes do radSh
  pre: Float64Array; sh: Float64Array; ex: Float64Array;
  saidas: Float32Array[] = [];
  /** Pa por unidade do sinal interno (multiplicado ainda por mk e fade do DSP) */
  kAbs = 1;
  idx: Int32Array;                  // canal de cada IdCanal (−1 = não tem)
  pesos: Float64Array;
  /** sonda: acumula a soma das ponteiras (e o resto) em vez de escrever */
  medir: ((s: number, esc: number, resto: number) => void) | null = null;

  constructor(dsp: EngineDSP, especs: readonly EspecCanal[]) {
    this.dsp = dsp;
    const n = dsp.rads.length;
    this.n = n;
    this.hp = Array.from({ length: n }, () => new Biquad().hp(dsp.fs, 45, 0.7));
    this.pre = new Float64Array(n); this.sh = new Float64Array(n); this.ex = new Float64Array(n);
    const ids: IdCanal[] = ['admissao', 'bloco', 'vibracao', 'compressor', 'turbo', 'coletor'];
    this.idx = new Int32Array(ids.length).fill(-1); this.pesos = new Float64Array(ids.length);
    especs.forEach((e, k) => { const i = ids.indexOf(e.id); this.idx[i] = n + k; this.pesos[i] = e.peso; });
  }
  ponteira(i: number, e: number, x: number) { this.sh[i] = x; this.pre[i] = this.hp[i].run(e); }
  /** x já com o chiado de jato: tira o radSh trocando a parte filtrada pela do passa-alta sozinho */
  jato(i: number, x: number) { this.ex[i] = this.pre[i] + (x - this.sh[i]); }
  gravar(s: number, kEx: number, inP: number, inH: number, mech: number, vib: number, tur: number, sc: number, brk: number) {
    const d = this.dsp, G = this.kAbs * d.mk * d.fade, o = this.saidas, ix = this.idx, w = this.pesos;
    if (this.medir) {
      let e = 0; for (let i = 0; i < this.n; i++) e += this.ex[i];
      this.medir(s, e * kEx, w[1] * mech + w[2] * vib + (ix[0] >= 0 ? w[0] * (inP + inH) : 0));
      return;
    }
    for (let i = 0; i < this.n; i++) o[i][s] = this.ex[i] * kEx * G;
    if (ix[0] >= 0) o[ix[0]][s] = w[0] * (inP + inH) * G;      // (0,12·inP + 0,12·inH: o kH é 0,12 em todos)
    if (ix[1] >= 0) o[ix[1]][s] = w[1] * mech * G;
    if (ix[2] >= 0) o[ix[2]][s] = w[2] * vib * G;
    if (ix[3] >= 0) o[ix[3]][s] = w[3] * sc * G;
    if (ix[4] >= 0) o[ix[4]][s] = w[4] * tur * G;
    if (ix[5] >= 0) o[ix[5]][s] = w[5] * brk * G;
  }
}

const dir = (tabela: readonly number[], eixo: Vec3, expConv = 2): Diretividade => ({ tabela: tabela as Diretividade['tabela'], eixo, expConv });
const via = (cab: number, fcCab: number, cof: number, fcCof = 0): ViasEstruturais => ({ cabine: { ganho: cab, fc: fcCab }, cofre: { ganho: cof, fc: fcCof } });

/**
 * Fontes de um motor a pistão num carro (CENA 1.3), no referencial do MOTOR (origem no bloco, em `posMotor`):
 * `escape.k` (uma por ponteira, na traseira), `admissao`, `bloco`, `vibracao`, e se houver `compressor`
 * (compressor mecânico), `turbo` e `coletor` (rajada do coletor perto do motor, Fusca). Devolve também os pesos.
 */
export function fontesPistaoCarro(dsp: EngineDSP, posMotor: Vec3) {
  const tras = dsp.engPos !== 'front';
  // (motor central: o road() manda metade do cofre para cada lado; aqui vai tudo para trás, com o escape)
  const c = tras ? 1 : 0.8 / 1.1;
  const tCofre = tras ? T_TRAS : T_FRENTE, eCofre: Vec3 = tras ? [-1, 0, 0] : [1, 0, 0];
  const rel = (p: Vec3): Vec3 => [p[0] - posMotor[0], p[1] - posMotor[1], p[2] - posMotor[2]];
  const fontes: FonteSonora[] = [];
  dsp.rads.forEach((r: any, k: number) => {
    // (as ponteiras ficam no eixo, como no road() legado, que soma as bancadas em mono: com cada uma no seu lado,
    // ±0,55 m, de lado a diferença de caminho de ~1,1 m tira o cancelamento da 2ª ordem entre as bancadas de um V8
    // cruzado e a banda 60–150 Hz sobe 5,7 dB a 6 m, fora da tabela "não pode piorar"; ver TECNICO → Adaptadores)
    void r;
    fontes.push({ id: `escape.${k}`, tipo: 'escape', pos: rel([X_PONTEIRA, 0, Z_PONTEIRA]), dir: dir(T_ESCAPE, [-1, 0, 0]), agudo: AGUDO_ESCAPE, refDist: REF_DIST_RONCO, dentro: false });
  });
  const especs: EspecCanal[] = [];
  const add = (id: IdCanal, tipo: FonteSonora['tipo'], peso: number, cab: number, fcCab: number, cof: number, tabela: readonly number[], eixo: Vec3, dz = 0) => {
    especs.push({ id, peso, vias: via(cab / peso, fcCab, cof / peso) });
    fontes.push({ id, tipo, pos: [0, 0, dz], dir: dir(tabela, eixo), refDist: REF_DIST_RONCO, dentro: true, vias: via(cab / peso, fcCab, cof / peso) });
  };
  // pesos de fora (road) e das vias (int: 0,35·lp900(inS), 0,2·lp1200(mech), 1,2·vib, 0,25·(tur + sc),
  // 0,2·lp900(brk); bay: 1,0·inS, 0,7·mech, 0,8·vib, 0,8·(tur + sc), 1,0·brk)
  add('admissao', 'admissao', 0.12 * c, 0.35, 900, 1.0, tCofre, eCofre, 0.1);
  add('bloco', 'mecanica', 0.1 * c, 0.2, 1200, 0.7, tCofre, eCofre);
  add('vibracao', 'mecanica', 0.1 * c, 1.2, 0, 0.8, tCofre, eCofre, -0.2);
  if (dsp.blower) add('compressor', 'compressor', 0.8 * c, 0.25, 0, 0.8, tCofre, eCofre, 0.3);
  if (dsp.turbo || dsp.cc) add('turbo', 'compressor', 0.2 * (0.8 / 1.1), 0.25, 0, 0.8, T_FRENTE, [1, 0, 0], 0.2);
  if (dsp.breakK) add('coletor', 'escape', 0.7, 0.2, 900, 1.0, T_ESCAPE, [-1, 0, 0], -0.4);
  // (o coletor sai junto com o escape no road(): leva a mesma sombra)
  // (e com o motor atrás o que sai do cofre também: no road() ele entra no `shade` junto com o escape)
  for (const f of fontes) if (f.id === 'coletor' || (tras && f.dentro && f.dir.eixo[0] < 0)) (f as { agudo?: readonly number[] }).agudo = AGUDO_ESCAPE;
  return { fontes, especs };
}

/** cfg do preset pronto para o adaptador: geometria, calibração do Ronco e o nível absoluto (`kAbs`) */
export function prepararMotorRonco(spec: Record<string, any>, fs: number) {
  const cfg = configCalibrada(spec, fs);
  cfg.kAbs = sondarNivelRonco(cfg, fs);
  return cfg;
}

/** RMS de um sinal acumulado pela sonda (Z ou A) */
class Acumulador {
  z = 0; a = 0; n = 0; pa: PonderacaoA; bz = new Float64Array(256); k = 0;
  constructor(fs: number) { this.pa = new PonderacaoA(fs); }
  somar(x: number) {
    this.z += x * x; this.n++;
    this.bz[this.k++] = x;
    if (this.k === this.bz.length) { this.pa.bloco(this.bz, this.k); for (let i = 0; i < this.k; i++) this.a += this.bz[i] * this.bz[i]; this.k = 0; }
  }
  rmsZ() { return Math.sqrt(this.z / Math.max(1, this.n)); }
  rmsA() { return Math.sqrt(this.a / Math.max(1, this.n - this.k)); }
}

/**
 * Sonda do nível absoluto: a condição de referência de `EngineDSP.calibrate()` (escape de referência, 55% da
 * faixa vermelha, borboleta toda aberta, turbo a 40%, motor quente), 0,5 s, mede a soma das ponteiras nos
 * últimos 0,25 s. Devolve kAbs = PA_REF_RONCO / RMS (DB_REF_RONCO a 5 m).
 */
export function sondarNivelRonco(cfg: any, fs: number) {
  const t = new EngineDSP(fs);
  t.setConfig({ ...cfg, muffler: 'sport', valve: 'none', pipeD: 2.5, reso: false, twoStep: false, breakout: 'sealed', scWhine: 0, gain: 1, mkIdle: 1 }, false);
  t.state = 'run'; t.lockOmega = true; t.tempMode = 'fixed'; t.tempSet = 90; t.coolant = 90;
  t.omega = (cfg.redline * 0.55 * TAU) / 60; t.rpmAvg = cfg.redline * 0.55;
  t.thrTarget = 1; t.thr = 1; t.turboW = 0.6; t.boost = cfg.boost * (t.blower ? 0.8 : 0.3);
  t.maxBoost = cfg.boost * (t.blower ? 0.8 : 0.4);
  const acc = new Acumulador(fs);
  const tap = new TapPistao(t, []);
  let amostra = 0;
  tap.medir = (_s, esc) => { if (amostra++ > 0.25 * fs) acc.somar(esc); };
  t.tap = tap;
  const B = 256, L = new Float32Array(B), R = new Float32Array(B);
  for (let i = 0; i < 0.5 * fs; i += B) t.process(L, R, B);
  return PA_REF_RONCO / Math.max(acc.rmsZ(), 1e-9);
}
export { Acumulador };

/**
 * Base dos adaptadores sobre o EngineDSP (Ronco, Diesel): fontes, tap, eixo, estado, telemetria.
 * `processar` instala o tap e chama o `process` do DSP com buffers próprios (o estéreo legado é descartado);
 * `processarLegado` é o caminho de hoje, sem tap.
 */
export abstract class MotorPistaoBase implements MotorLegado {
  abstract readonly familia: FamiliaMotor;
  dsp: EngineDSP;
  fontes: readonly FonteSonora[] = [];
  montagem: MontagemMotor = { posMotor: POS_MOTOR_CARRO.front, rotMotor: 'frente' };
  tap: TapPistao | null = null;
  carga: Carga | null = null;
  fs: number;
  protected bL = new Float32Array(4096); protected bR = new Float32Array(4096);
  protected ign = false;
  private _eixo: EixoSaida = { omega: 0, torque: 0, inercia: 0 };

  constructor(dsp: EngineDSP, fs: number) { this.dsp = dsp; this.fs = fs; }
  get params() { return this.dsp.params; }
  get estado(): EstadoMotor { const s = this.dsp.state; return s === 'run' ? 'funcionando' : s === 'crank' ? 'partida' : 'desligado'; }
  /** torque máximo (N·m) para o portador normalizar o governador (carriers/base.ts, ganhoRelativo) */
  get torqueMax(): number { return this.dsp.Tmax; }
  get eixo(): EixoSaida { const e = this._eixo, d = this.dsp; e.omega = d.omega; e.torque = d.tqMean; e.inercia = d.J; return e; }

  /** monta fontes e tap depois do setConfig do DSP (a lista de ponteiras sai do escape montado) */
  protected montarFontes(kAbs: number) {
    const pm = POS_MOTOR_CARRO[this.dsp.engPos] ?? POS_MOTOR_CARRO.front;
    this.montagem = { posMotor: pm, rotMotor: 'frente' };
    const { fontes, especs } = fontesPistaoCarro(this.dsp, pm);
    this.fontes = fontes;
    this.tap = new TapPistao(this.dsp, especs);
    this.tap.kAbs = kAbs;
  }
  abstract configurar(preset: object, fs: number): void;

  comandar(c: ComandoMotor) {
    if (c.ignicao !== this.ign) { this.ign = c.ignicao; this.dsp.message({ type: 'input', ignition: c.ignicao }); }
    this.dsp.message({ type: 'input', throttle: c.combustivel ?? c.acelerador });
  }
  /** O Ronco ainda não tem o gancho de carga no virabrequim (gancho 11 do RADIAL.md, etapa 3): no carro a carga é o
   * câmbio e a estrada dentro do EngineDSP (`CarroLegado`). Guarda a carga para quando o gancho existir. */
  acoplar(carga: Carga | null) { this.carga = carga; }
  processar(saidas: Float32Array[], n: number) {
    const t = this.tap!;
    t.saidas = saidas;
    this.dsp.tap = t;
    if (this.bL.length < n) { this.bL = new Float32Array(n); this.bR = new Float32Array(n); }
    this.dsp.process(this.bL, this.bR, n);
    this.dsp.tap = null;
  }
  processarLegado(outL: Float32Array, outR: Float32Array, sendL: Float32Array, sendR: Float32Array, n: number) { this.dsp.process(outL, outR, n, sendL, sendR); }
  telemetria(): TelemetriaMotor {
    const t = this.dsp.telemetry(), w = this.dsp.omega;
    return { ...t, rpm: t.rpm, torque: t.torque, potencia: t.torque * w, estado: this.estado };
  }
}

/** Motor a pistão a gasolina (Ronco). `configurar` recebe o cfg de `prepararMotorRonco` (calibrado fora). */
export class MotorRonco extends MotorPistaoBase {
  readonly familia = 'pistao' as const;
  constructor(fs: number) { super(new EngineDSP(fs), fs); }
  configurar(preset: Record<string, any>, fs: number) {
    const cfg = preset.gain ? preset : prepararMotorRonco(preset, fs);
    if (!cfg.kAbs) cfg.kAbs = sondarNivelRonco(cfg, fs);
    this.dsp.setConfig(cfg);
    this.dsp.message({ type: 'input', temp: { mode: 'fixed', value: 90 } });
    this.montarFontes(cfg.kAbs);
  }
}

export { montarConfig };
