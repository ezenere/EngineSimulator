// Radial pela Cena (o caminho da Passagem): o preset no portador hélice (ou rotor, ou carro), com o MotorRadial e um
// ouvinte parado de lado, para medir contra as gravações com a propagação, o solo e a hélice de verdade (RADIAL.md 4).
//
//   ouvirParado('r1830', { d: 12, pedal: 0, rpm: 600, dur: 8 })  → { x (mono, Pa), tele }
import { renderPassagem, SR } from './cena/render-passagem';
import { Helice } from '../src/carriers/helice';
import { Rotor } from '../src/carriers/rotor';
import { CarroLegado } from '../src/carriers/carro';
import { MotorRadial, prepararMotorRadial } from '../src/engines/radial/motor';
import { configHelice, configRotor } from '../src/engines/ronco/aviacao';
import { PA_FS } from '../src/scene/constantes';
import { preset } from './radial-comum';
import type { Portador } from '../src/carriers/tipos';

const cacheCfg = new Map<string, any>();
export function motorRadial(id: string, extra: Record<string, any> = {}) {
  const k = id + JSON.stringify(extra);
  if (!cacheCfg.has(k)) cacheCfg.set(k, prepararMotorRadial({ ...preset(id), ...extra }, SR));
  const m = new MotorRadial(SR);
  m.configurar({ ...cacheCfg.get(k) }, SR);
  return m;
}

/** portador do preset com o motor acoplado */
export function portadorRadial(id: string, extra: Record<string, any> = {}) {
  const spec = { ...preset(id), ...extra };
  const m = motorRadial(id, extra);
  let p: Portador;
  if (spec.portadores.includes('helice')) p = new Helice(SR, { ...configHelice(spec), posMotor: [2.5, 0, 2.0], posCubo: [3.3, 0, 2.0] });
  else if (spec.portadores.includes('rotor')) p = new Rotor(SR, configRotor(spec));
  else p = new CarroLegado();
  p.acoplar(m);
  return { p, m, spec };
}

export type OpOuvir = { d: number; pedal?: number; rpm?: number; dur?: number; t0?: number; rpmAlvo?: number; altura?: number; solo?: any; aoBloco?: (t: number, p: Portador, m: MotorRadial) => void; v?: number; s0?: number; extra?: Record<string, any> };

/** ouvinte parado a `d` m de lado do motor; devolve o mono em Pa (descartando os primeiros `t0` s) e a telemetria */
export function ouvirParado(id: string, o: OpOuvir) {
  const { p, m } = portadorRadial(id, o.extra);
  const d = m.dsp;
  if (o.rpm) { d.omega = (o.rpm * 2 * Math.PI) / 60; d.rpmAvg = o.rpm; }
  const pedal = o.pedal ?? 0;
  d.thrTarget = pedal; d.thr = pedal;
  const tele: any[] = [];
  const dur = o.dur ?? 8, t0 = o.t0 ?? 2;
  const r = renderPassagem({
    portadorPronto: p, v: o.v ?? 0, d: o.d, altitude: 0, ambiente: 'ceu', solo: o.solo ?? 'grama', dur, sCentro0: o.s0 ?? -2.5,
    reverb: false, semFundo: true, ouvinte: { binaural: false, pos: [0, 0, o.altura ?? 1.6] },
    antesBloco: (t) => { p.comandar({ pedal, ...(o.rpmAlvo !== undefined ? { rpmAlvo: o.rpmAlvo } : {}) } as any); o.aoBloco?.(t, p, m); },
    aoBloco: (t) => { if (Math.round(t * SR) % 1024 < 128) tele.push({ t, ...d.telemetry(), ...p.telemetria() }); },
  });
  const a = Math.round(t0 * SR), x = new Float64Array(r.dL.length - a);
  for (let i = 0; i < x.length; i++) x[i] = 0.5 * (r.dL[a + i] + r.dR[a + i]) * PA_FS;
  return { x, tele: tele.filter((q) => q.t >= t0), p, m };
}

export { SR };
