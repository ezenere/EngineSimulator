// Rotativo pela Cena (o caminho da Passagem): o preset no portador (carro, hélice, rotor, gerador), com o MotorRotativo e
// um ouvinte parado de lado ou uma passagem, para os testes de portador do ROTATIVO.md 8 (passo 8) e a passagem do 787B.
//
//   ouvirRot('ar741', { d: 20, pedal: 1, dur: 8 })   → { x (mono, Pa), tele }
import { renderPassagem, SR } from './cena/render-passagem';
import { Helice } from '../src/carriers/helice';
import { Rotor } from '../src/carriers/rotor';
import { Gerador } from '../src/carriers/gerador';
import { CarroLegado } from '../src/carriers/carro';
import { MotorRotativo, prepararMotorRotativo } from '../src/engines/rotativo/motor';
import { configHelice, configRotor } from '../src/engines/ronco/aviacao';
import { PA_FS } from '../src/scene/constantes';
import { preset } from './rotativo-comum';
import type { Portador } from '../src/carriers/tipos';

const cacheCfg = new Map<string, any>();
export function motorRotativo(id: string, extra: Record<string, any> = {}) {
  const k = id + JSON.stringify(extra);
  if (!cacheCfg.has(k)) cacheCfg.set(k, prepararMotorRotativo(preset(id, extra), SR));
  const m = new MotorRotativo(SR);
  m.configurar({ ...cacheCfg.get(k) }, SR);
  return m;
}

/** portador do preset (o primeiro da lista, ou `tipo`) com o motor acoplado */
export function portadorRotativo(id: string, extra: Record<string, any> = {}, tipo?: string) {
  const spec = preset(id, extra);
  const m = motorRotativo(id, extra);
  const t = tipo || spec.portadores[0];
  let p: Portador;
  if (t === 'helice') p = new Helice(SR, { ...configHelice(spec), posMotor: [2.0, 0, 1.2], posCubo: [-1.0, 0, 1.2] });
  else if (t === 'rotor') p = new Rotor(SR, configRotor(spec));
  else if (t === 'gerador') p = new Gerador(SR, { polos: spec.gerador!.polos, fRede: spec.gerador!.fRede, potenciaNominal: spec.gerador!.kWe, eta: spec.gerador!.eta, J_alt: spec.gerador!.J, ventilador: { B: 8, D: 0.15 }, ranhuras: 24, posMotor: [0, 0, 0.6] } as any);
  else p = new CarroLegado();
  p.acoplar(m);
  return { p, m, spec };
}

export type OpOuvir = { d: number; pedal?: number; dur?: number; t0?: number; v?: number; s0?: number; altura?: number; solo?: any; tipo?: string; extra?: Record<string, any>;
  comando?: Record<string, any>; aoBloco?: (t: number, p: Portador, m: MotorRotativo) => void };

/** ouvinte parado a `d` m; com `v` e `s0` o corpo passa (passagem); devolve o mono em Pa e a telemetria */
export function ouvirRot(id: string, o: OpOuvir) {
  const { p, m } = portadorRotativo(id, o.extra, o.tipo);
  const d = m.dsp, pedal = o.pedal ?? 0;
  const tele: any[] = [];
  const dur = o.dur ?? 8, t0 = o.t0 ?? 2;
  const r = renderPassagem({
    portadorPronto: p, v: o.v ?? 0, d: o.d, altitude: 0, ambiente: 'ceu', solo: o.solo ?? 'grama', dur, sCentro0: o.s0 ?? -2.5,
    reverb: false, semFundo: true, ouvinte: { binaural: false, pos: [0, 0, o.altura ?? 1.6] },
    antesBloco: (t) => { p.comandar({ pedal, ...(o.comando || {}) } as any); o.aoBloco?.(t, p, m); },
    aoBloco: (t) => { if (Math.round(t * SR) % 1024 < 128) tele.push({ t, ...d.telemetry(), ...p.telemetria() }); },
  });
  const a = Math.round(t0 * SR), x = new Float64Array(r.dL.length - a);
  for (let i = 0; i < x.length; i++) x[i] = 0.5 * (r.dL[a + i] + r.dR[a + i]) * PA_FS;
  return { x, tele: tele.filter((q) => q.t >= t0), p, m, r };
}

export { SR };
