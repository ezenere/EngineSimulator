// Geometria do motor diesel: os 4 tempos reusam a do Ronco (build, tdcAngles, schedule, intervals); os
// 2 tempos (EMD, Detroit) têm virabrequins próprios e um montador uniflow em que cada cilindro queima a
// cada volta: o disparo é o próprio PMS (mod 360°) e a ordem de ignição decorre dos moentes (DIESEL.md 4.3).
import { build as buildRonco, intervals, tdcAngles, CRANKS, type MotorMontado, type Virabrequim } from '../ronco/geometria';

const mod = (a: number, m: number) => ((a % m) + m) % m;
const dbl = (arr: number[]) => arr.flatMap((x) => [x, x]);

// Virabrequins dos 2 tempos, por família layout-N (mesma forma do Ronco). Numeração como no Ronco: ímpares
// na bancada A, pares na B, o par (2k+1, 2k+2) no mesmo moente (na EMD: `n` e `n+8` no mesmo moente).
export const CRANKS_2T: Record<string, Virabrequim[]> = {
  'v-16': [{ id: 'emd16', name: 'EMD 16 (pares a 22,5°)', pins: [0, 0, 90, 90, 180, 180, 270, 270, 22.5, 22.5, 112.5, 112.5, 202.5, 202.5, 292.5, 292.5], bank: 45, orders: [['pms', 'Uniforme 22,5° (decorre dos moentes)']] }],
  'v-12': [{ id: 'emd12', name: 'EMD 12 (pares a 30°)', pins: dbl([0, 30, 120, 150, 240, 270]), bank: 45, orders: [['pms', 'Pares a 30° (aproximação: com V de 45° não fica uniforme)']] }],
  'v-20': [{ id: 'emd20', name: 'EMD 20 (pares a 18°)', pins: dbl([0, 18, 72, 90, 144, 162, 216, 234, 288, 306]), bank: 45, orders: [['pms', 'Pares a 18° (aproximação)']] }],
  'v-6': [{ id: 'dd6v', name: 'Detroit V6 (moentes a 120°)', pins: [0, 0, 120, 120, 240, 240], bank: 63.5, orders: [['pms', 'Trote 56,5° / 63,5°']] }],
  'inline-6': [{ id: 'dd6', name: 'Detroit 6-71 (60°)', pins: [0, 240, 120, 300, 60, 180], orders: [['pms', 'Uniforme 60°']] }],
};

function bankOf(layout: string, c: number) { return layout === 'inline' ? 0 : (c % 2 === 0 ? 1 : 0); }
function axisAngle(layout: string, c: number, bankAngle: number) { return layout === 'inline' || c % 2 === 1 ? 0 : -bankAngle; }

// intervalos num ciclo de 360°
export function intervalos360(angs: number[]) {
  const s = [...angs].sort((a, b) => a - b);
  if (s.length <= 1) return [360];
  return s.map((a, i) => (i + 1 < s.length ? s[i + 1] - a : 360 - a + s[0]));
}

// Balanceamento só para mostrar (a mesma conta do Ronco, com os PMS de cada cilindro).
function balance(layout: string, tdc: number[], bankAngle: number, z: number[]) {
  const N = tdc.length, lam = 0.3;
  let f1 = 0, f2 = 0, m1 = 0, m2 = 0;
  const zc = z.reduce((a, b) => a + b, 0) / N;
  for (let s = 0; s < 360; s += 2) {
    let x1 = 0, y1 = 0, x2 = 0, y2 = 0, mx1 = 0, my1 = 0, mx2 = 0, my2 = 0;
    for (let c = 0; c < N; c++) {
      const ax = axisAngle(layout, c + 1, bankAngle) * Math.PI / 180, ph = (s - tdc[c]) * Math.PI / 180;
      const a1 = Math.cos(ph), a2 = lam * Math.cos(2 * ph), ux = Math.sin(ax), uy = Math.cos(ax), dz = z[c] - zc;
      x1 += ux * a1; y1 += uy * a1; x2 += ux * a2; y2 += uy * a2;
      mx1 += dz * ux * a1; my1 += dz * uy * a1; mx2 += dz * ux * a2; my2 += dz * uy * a2;
    }
    f1 = Math.max(f1, Math.hypot(x1, y1)); f2 = Math.max(f2, Math.hypot(x2, y2) / lam);
    m1 = Math.max(m1, Math.hypot(mx1, my1)); m2 = Math.max(m2, Math.hypot(mx2, my2) / lam);
  }
  const clean = (v: number) => (v < 1e-3 ? 0 : v);
  return { f1: clean(f1), f2: clean(f2), m1: clean(m1), m2: clean(m2) };
}

// Montador uniflow de 2 tempos: fire[c] = PMS[c] mod 360, válido sempre; a ordem sai da sequência dos PMS.
export function build2T(spec: any): MotorMontado {
  const { layout, cylinders: N } = spec;
  const fam = CRANKS_2T[`${layout}-${N}`];
  if (!fam) throw new Error(`2 tempos: sem virabrequim para ${layout}-${N}`);
  const crank = fam.find((k) => k.id === spec.crank) || fam[0];
  const bankAngle = layout === 'v' ? (spec.bankAngle ?? crank.bank) : 0;
  const tdc = tdcAngles(layout, crank.pins, bankAngle);
  const fire = tdc.map((t) => mod(t, 360));
  // ordem: cilindros por PMS crescente a partir do 1
  const order = Array.from({ length: N }, (_, c) => c).sort((a, b) => mod(fire[a] - fire[0], 360) - mod(fire[b] - fire[0], 360)).map((c) => c + 1);
  const banks = layout === 'inline' ? 1 : 2;
  const bank = Array.from({ length: N }, (_, c) => bankOf(layout, c + 1));
  const z = Array.from({ length: N }, (_, i) => (layout === 'inline' ? i : Math.floor(i / 2)));
  const axis = Array.from({ length: N }, (_, c) => axisAngle(layout, c + 1, bankAngle));
  const perBank = [];
  for (let b = 0; b < banks; b++) perBank.push(intervalos360(fire.filter((_, c) => bank[c] === b)));
  // coletores curtos por bancada nos 2T de locomotiva (4.3)
  const runners = Array.from({ length: N }, (_, c) => Math.max(0.12, 0.26 * (1 + 0.08 * Math.sin(c * 1.7))));
  return {
    layout, N, crank, bankAngle, order, fire, valid: true, intervals: intervalos360(fire), perBank, banks, bank, z, axis,
    tdcRel: fire.slice(), runners, balance: balance(layout, fire, bankAngle, z),
  };
}

// Monta o motor do preset: 4 tempos pelo Ronco, 2 tempos pelo montador uniflow.
export function buildDiesel(spec: any): MotorMontado & { tempos: number } {
  if (spec.tempos === 2) return { ...build2T(spec), tempos: 2 };
  return { ...buildRonco(spec), tempos: 4 };
}

// virabrequins disponíveis para um arranjo (4T: os do Ronco; 2T: os de CRANKS_2T)
export function familiaDiesel(layout: string, N: number, tempos: number): Virabrequim[] {
  return (tempos === 2 ? CRANKS_2T : CRANKS)[`${layout}-${N}`] || [];
}

export { intervals };
