// Estado e ações da página Rotativos, fora do React. O comum das páginas a pistão está em src/pages/comum/controle.ts;
// aqui fica o que é dos rotativos: a geometria trocoidal (ou nenhuma, no motor de palhetas), as janelas e a lenta que as
// acompanha, o escape e o turbo, a aviação dos presets de avião e helicóptero (`{ type: 'av', … }`) e o motor de
// palhetas (`{ type: 'palhetas', … }`). O worklet é um só (RotativosDSP): a configuração escolhe o Wankel/X-Engine ou o
// sintetizador de palhetas.
import { montarRotativo, type MotorRotativo } from '../../engines/rotativo/geometria';
import { PRESETS_ROTATIVO, PADRAO_ROTATIVO, type PresetRotativo } from '../../engines/rotativo/presets';
import { configCalibrada, montarConfig } from '../../engines/rotativo/config';
import { AV_PADRAO, proximoMagneto, type EstadoAv } from '../comum/Aviacao';
import { ControlePistao, estadoInicial, type EstadoPistao, type Lento, type ParamsPistao } from '../comum/controle';

export type Spec = PresetRotativo & Record<string, any>;
export type ParamsRot = ParamsPistao;
export type { Lento };
export type EstadoPalhetas = { modo: 'ferramenta' | 'arranque'; pIn: number; carga: number };
export type EstadoRot = EstadoPistao<Spec, MotorRotativo | null> & { av: EstadoAv; pal: EstadoPalhetas };
export type Telemetria = Record<string, any> & { rpm: number; theta: number; state: string };

/** especificação completa de um preset: padrões do rotativo e o `redline` que os mostradores do Ronco leem */
/** ponteira de fábrica: a boca do preset (o megafone irradia pela boca larga) */
const ponteiraDe = (e: PresetRotativo['escape']) => e.ponteira ?? (e.tipo === 'megafone' ? e.megafone?.Dboca : e.saidas[0]?.D) ?? 63.5;
export const specDe = (p: PresetRotativo): Spec => ({ ...PADRAO_ROTATIVO, ...p, escape: { ...p.escape, ponteira: ponteiraDe(p.escape) }, redline: p.rpmMax } as Spec);
const geometria = (s: Spec) => (s.tipo === 'palhetas' ? null : montarRotativo(s));
/** lenta mínima das janelas de competição, em rpm (a dos rótulos do painel: bridge 1 500–2 000, periférica 1 600–2 200) */
const LENTA_JANELA: Record<string, number> = { bridge: 1500, periferica: 1800 };

export class ControleRotativo extends ControlePistao<Spec, MotorRotativo | null, EstadoRot> {
  protected marchasPadrao = 5;

  constructor() {
    const p = PRESETS_ROTATIVO[0];
    const spec = specDe(p);
    super({ ...estadoInicial(spec, geometria(spec), p), av: { ...AV_PADRAO }, pal: palDe(spec) });
  }

  get palhetas() { return this.spec.tipo === 'palhetas'; }
  /** avião e helicóptero: o comando de potência é a manete (como na Aviação do Ronco); no resto, o pedal ou o gatilho */
  get comManete() { return !!this.spec.aviation; }
  protected montar(spec: Spec) { return geometria(spec); }
  /** configuração para o worklet: Wankel/X calibrado na thread principal; palhetas, o preset cru */
  protected configDoMotor(sr: number) {
    if (this.palhetas) return { ...this.spec, modoPalhetas: this.estado.pal.modo };
    return configCalibrada(this.spec, sr);
  }
  protected configLeve() { return montarConfig(this.spec); }
  protected depoisDaConfig() { this.enviarAv(); this.enviarPal(); }
  private enviarAv() { if (this.spec.aviation) this.audio?.send({ type: 'av', ...this.estado.av }); }
  private enviarPal() { if (this.palhetas) this.audio?.send({ type: 'palhetas', ...this.estado.pal }); }
  // (a posição da manete de um avião vai ao DSP junto com a cadeia: ela fica onde foi deixada)
  protected aoIniciarAudio() { if (this.comManete) this.sendInput(); }

  // (o motor de palhetas não tem `tune`: toda mudança vai como configuração)
  protected pushConfig(structural: boolean, fresh = false) { super.pushConfig(structural || this.palhetas, fresh); }

  setGeo(p: Partial<{ R: number; e: number; b: number }>) { this.setSpec({ geo: { ...(this.spec.geo || { R: 105, e: 15, b: 80 }), ...p } }); }
  setJanelas(p: Partial<Spec['janelas']>) {
    const patch: Partial<Spec> = { janelas: { ...this.spec.janelas, ...p } as Spec['janelas'] };
    // a lenta acompanha a janela de admissão: com bridge ou periférica a carga volta diluída demais para segurar uma lenta
    // de rua (a 750 rpm o motor caça de 400 a 1 000 e apaga à toa), e o preparador a acerta lá em cima; ao voltar para uma
    // janela de rua, a lenta do preset
    const de = this.spec.janelas.admissao, para = p.admissao;
    if (para && para !== de) {
      const min = LENTA_JANELA[para];
      if (min && this.spec.idle < min) patch.idle = min;
      else if (!min && LENTA_JANELA[de]) { const base = PRESETS_ROTATIVO.find((x) => x.id === this.spec.id); if (base && base.idle < this.spec.idle) patch.idle = base.idle; }
    }
    this.setSpec(patch);
  }
  setEscape(p: Record<string, any>) { this.setSpec({ escape: { ...this.spec.escape, ...p } }); }
  setTurbo(p: Record<string, any>) { const t = { sequencial: false, boost: 0.6, ...(this.spec.turbo || {}), ...p }; this.setSpec({ turbo: t, aspiration: 'turbo', boost: t.boost }); }
  semTurbo() { this.setSpec({ turbo: undefined, aspiration: 'na', boost: 0 }); }
  loadPreset(p: PresetRotativo) {
    const spec = specDe(p);
    const av = { ...AV_PADRAO };
    const eraManete = this.comManete;
    this.mudar({ spec, motor: geometria(spec), presetId: p.id, av, pal: palDe(spec) }, true);
    this.pushConfig(true, true);
    // (do carro para o avião e de volta: o comando de potência muda de pedal para manete)
    if (eraManete || this.comManete) this.sendInput();
  }

  // ---------------------------------------------------------------- aviação e palhetas
  setAv(p: Partial<EstadoAv>) { this.mudar({ av: { ...this.estado.av, ...p } }, true); this.audio?.send({ type: 'av', ...p }); }
  cycleMagnetos() { if (this.spec.aviation) this.setAv({ magnetos: proximoMagneto(this.estado.av.magnetos) }); }
  setPal(p: Partial<EstadoPalhetas>) {
    const pal = { ...this.estado.pal, ...p };
    if (p.modo && p.modo !== this.estado.pal.modo) {
      const k = this.spec.palhetas![p.modo];
      pal.pIn = k.pIn; pal.carga = 0;
      this.mudar({ pal, spec: { ...this.spec, rpmMax: k.nLivre, redline: k.nLivre } as Spec }, true);
      this.audio?.send({ type: 'input', ignition: false }); this.mudar({ ignicao: false });
    } else this.mudar({ pal }, true);
    this.audio?.send({ type: 'palhetas', ...p });
  }

  shift(dir: number) { if ((this.spec.portadores || []).includes('carro')) this.audio?.send({ type: 'input', shift: dir }); }

  protected telemetria(m: any) {
    super.telemetria(m);
    if (!this.palhetas && this.apagou(m, 3000)) this.mudar({ ignicao: false });
  }
}

function palDe(spec: Spec): EstadoPalhetas {
  const pa = spec.palhetas;
  if (!pa) return { modo: 'ferramenta', pIn: 6.3, carga: 0 };
  return { modo: pa.modo, pIn: pa[pa.modo].pIn, carga: 0 };
}
