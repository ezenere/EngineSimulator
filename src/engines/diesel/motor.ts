// Adaptador `Motor` (CENA.md 1.3) sobre o DieselDSP, para os portadores de src/carriers/: carro (picape, caminhão,
// ônibus: `CarroLegado`, o câmbio de dentro do DSP), gerador e locomotiva (carga e governador do portador).
//
// O gancho de leitura é o do EngineDSP (`tap`, src/engines/ronco/motor.ts): o DieselDSP herda o laço de amostra, e
// os ramos `cc` (knock, injeção, bomba no `mech`, turbo diesel no `tur`, Jake e borboleta no escape) já chegam
// nesses sinais. Nada em src/engines/diesel/ além deste arquivo muda.
//
// Carga e comando (CENA 1.1.5): `acoplar(Carga)` vai para `DieselDSP.acoplar` (a carga entra como pressão média de
// freio); `comandar({ combustivel })` manda no combustível (`{ type: 'diesel', combustivel }`), passando por cima do
// governador do preset: o governador é o do portador. Sem `combustivel`, o pedal (`acelerador`) é o do carro.
//
// Nível absoluto: no carro, a convenção do Ronco (DB_REF_RONCO a 5 m em carga total a 55% da rotação máxima, DIESEL.md
// 6.3: "para o portador carro vale a calibração relativa do Ronco"); em gerador e locomotiva, `L_W` dB(A) do escape +
// bloco em plena carga na rotação de potência (DIESEL.md 6.3: grupo de 500 kVA 118 dB(A); locomotiva em N8 128 dB(A),
// do limite de 87 dB(A) a 30 m da 40 CFR 201 para locomotivas paradas).
import type { FonteSonora, Vec3 } from '../../scene/tipos';
import { DieselDSP } from './dsp';
import { configCalibrada } from './config';
import { MotorPistaoBase, TapPistao, Acumulador, fontesPistaoCarro, PA_REF_RONCO, paDeLw5, REF_DIST_RONCO, POS_MOTOR_CARRO } from '../ronco/motor';

export type UsoDiesel = 'carro' | 'gerador' | 'locomotiva' | 'nenhum';

/** L_W dB(A) do escape + bloco em plena carga (DIESEL.md 6.3), por uso; null = a convenção do Ronco (carro) */
export const LW_DIESEL: Record<UsoDiesel, number | null> = { carro: null, gerador: 118, locomotiva: 128, nenhum: null };

/** chaminé acima do motor (m, referencial do motor): locomotiva no teto da caixa, gerador no teto do contêiner */
// (a chaminé da locomotiva sai ~0,5 m acima do teto da caixa, 4,7 m: rente ao teto, a borda dele fazia sombra de ~8 dB a 15 m)
const CHAMINE: Record<UsoDiesel, Vec3> = { carro: [0, 0, 0], gerador: [0.3, 0, 1.4], locomotiva: [0.5, 0, 3.0], nenhum: [0, 0, 1] };

/**
 * Fontes do diesel fora do carro: as do Ronco (mesmos canais e vias), mas a ponteira vira a chaminé no teto, omni
 * (a boca de 0,45 m do EMD é pequena perto do comprimento de onda da ignição, 240 Hz → 1,4 m), e o que vem do cofre
 * (capô da locomotiva, carenagem do gerador) também é omni.
 */
function fontesEstacionario(dsp: DieselDSP, uso: UsoDiesel) {
  const { fontes, especs } = fontesPistaoCarro(dsp, [0, 0, 0]);
  const ch = CHAMINE[uso];
  const out: FonteSonora[] = fontes.map((f, k) => f.tipo === 'escape' && f.id.startsWith('escape.')
    ? { ...f, pos: [ch[0], ch[1] + 0.3 * (k - (dsp.rads.length - 1) / 2), ch[2]] as Vec3, dir: { tabela: [0, 0, 0, 0, 0, 0, 0], eixo: [0, 0, 1] as Vec3, expConv: 2 }, agudo: undefined, hCorpo: undefined }
    : { ...f, pos: [0, f.pos[1], f.pos[2]] as Vec3, dir: { tabela: [0, 0, 0, 0, 0, 0, 0], eixo: [1, 0, 0] as Vec3, expConv: 2 }, agudo: undefined });
  return { fontes: out, especs };
}

/** cfg pronto para o adaptador: geometria, calibração do diesel e o nível absoluto do uso */
export function prepararMotorDiesel(spec: Record<string, any>, fs: number, uso: UsoDiesel = 'carro') {
  const cfg = configCalibrada(spec, fs);
  cfg.kAbs = sondarNivelDiesel(cfg, fs, uso);
  cfg.uso = uso;
  return cfg;
}

/**
 * Sonda do nível: a sonda de calibração do próprio DieselDSP (`sonda0`: giro travado, combustível fixo, turbo
 * fixo, motor quente). Carro: 55% da rotação máxima, turbo a 40% (a do `calibrate`), e a soma das ponteiras vai a
 * DB_REF_RONCO a 5 m. Gerador/locomotiva: rotação de potência, turbo cheio, e a potência ponderada A do escape + bloco
 * vai ao `L_W` de LW_DIESEL.
 */
export function sondarNivelDiesel(cfg: any, fs: number, uso: UsoDiesel) {
  const base = new DieselDSP(fs);
  base.setConfig({ ...cfg }, false);
  const lw = LW_DIESEL[uso];
  const sop = cfg.soprador ? cfg.soprador.pressao : 0;
  const t = lw == null
    ? base.sonda0(cfg, base.rpmMax * 0.55, 1, 0.6, Math.max(0, (cfg.boost || 0) - sop) * 0.4)
    : base.sonda0(cfg, base.rpmNom, 1, 1, Math.max(0, (cfg.boost || 0) - sop));
  const { especs } = fontesPistaoCarro(t, [0, 0, 0]);
  const tap = new TapPistao(t, especs);
  const aE = new Acumulador(fs), aR = new Acumulador(fs);
  let amostra = 0;
  tap.medir = (_s, esc, resto) => { if (amostra++ > 0.3 * fs) { aE.somar(esc); aR.somar(resto); } };
  t.tap = tap;
  t.params.master = 0.02;
  const B = 256, L = new Float32Array(B), R = new Float32Array(B);
  for (let i = 0; i < 0.6 * fs; i += B) t.process(L, R, B);
  if (lw == null) return PA_REF_RONCO / Math.max(aE.rmsZ(), 1e-9);
  return paDeLw5(lw) / Math.max(Math.hypot(aE.rmsA(), aR.rmsA()), 1e-9);
}

export class MotorDiesel extends MotorPistaoBase {
  readonly familia = 'diesel' as const;
  declare dsp: DieselDSP;
  uso: UsoDiesel = 'carro';
  constructor(fs: number) { super(new DieselDSP(fs), fs); }

  /** `preset`: o cfg de `prepararMotorDiesel` (ou a especificação crua, calibrada aqui) com `uso` */
  configurar(preset: Record<string, any>, fs: number) {
    const uso: UsoDiesel = preset.uso ?? (preset.portadores?.includes('locomotiva') ? 'locomotiva' : preset.portadores?.includes('gerador') ? 'gerador' : 'carro');
    const cfg = preset.gain ? preset : prepararMotorDiesel(preset, fs, uso);
    if (!cfg.kAbs) cfg.kAbs = sondarNivelDiesel(cfg, fs, uso);
    this.uso = uso;
    this.dsp.setConfig(cfg);
    this.dsp.message({ type: 'input', temp: { mode: 'fixed', value: 90 } });
    // fora do carro o governador e a carga são do portador; o DSP fica em "bancada" sem carga própria
    // (gerador e locomotiva: o modo do DSP é o do uso, pelo governador acertado; a carga é a do portador, que
    // `cargas()` do DieselDSP usa no lugar da interna sempre que há `acoplar(carga)`)
    this.dsp.message({ type: 'diesel', portador: uso === 'carro' ? 'carro' : uso });
    if (uso === 'carro') this.montarFontes(cfg.kAbs);
    else {
      const { fontes, especs } = fontesEstacionario(this.dsp, uso);
      this.fontes = fontes;
      this.montagem = { posMotor: [0, 0, 0], rotMotor: 'frente' };
      this.tap = new TapPistao(this.dsp, especs);
      this.tap.kAbs = cfg.kAbs;
    }
  }
  /** fora do carro o governador é o isócrono do próprio DieselDSP (acertado por motor: Kp = ω_c/P, TECNICO → Diesel);
   * o portador manda o alvo (`rpmAlvo`): na locomotiva vira o notch da tabela do preset, no gerador a frequência da rede */
  get governadorProprio() { return this.uso === 'gerador' || this.uso === 'locomotiva'; }
  private alvoAnt = -1;
  comandar(c: { acelerador: number; ignicao: boolean; partida: boolean; combustivel?: number; rpmAlvo?: number }) {
    if (c.ignicao !== this.ign) { this.ign = c.ignicao; this.dsp.message({ type: 'input', ignition: c.ignicao }); }
    this.dsp.message({ type: 'input', throttle: c.acelerador });
    if (c.rpmAlvo !== undefined && this.governadorProprio) {
      if (c.rpmAlvo !== this.alvoAnt) {
        this.alvoAnt = c.rpmAlvo;
        const d = this.dsp;
        if (this.uso === 'locomotiva' && d.locCfg) {
          // notch cuja rotação é a mais próxima do alvo (as tabelas do CENA 4.5 e do preset são as mesmas)
          const t: number[] = d.locCfg.notchRpm;
          let nb = 0; for (let k = 0; k < t.length; k++) if (Math.abs(t[k] - c.rpmAlvo) <= Math.abs(t[nb] - c.rpmAlvo)) nb = k;
          d.message({ type: 'diesel', notch: c.rpmAlvo <= t[0] + 1 ? 0 : nb, combustivel: null });
        } else if (this.uso === 'gerador' && d.gerCfg) d.message({ type: 'diesel', fRede: (c.rpmAlvo * d.gerCfg.polos) / 120, combustivel: null });
        else d.message({ type: 'diesel', rpmAlvo: c.rpmAlvo, combustivel: null });
      }
      return;
    }
    this.dsp.message({ type: 'diesel', combustivel: c.combustivel ?? null });
  }
  acoplar(carga: import('../../scene/tipos').Carga | null) { this.carga = carga; this.dsp.acoplar(carga); }
  telemetria() { const t = this.dsp.telemetry(); return { ...t, rpm: t.rpm, torque: t.torque, potencia: t.kW * 1000, estado: this.estado }; }
}

export { REF_DIST_RONCO, POS_MOTOR_CARRO };
