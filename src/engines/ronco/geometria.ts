// Geometria do motor: virabrequim, bancadas, ordem de ignição e balanceamento.
//
// Convenção de numeração:
//  - Linha: 1..N da frente para trás.
//  - V / Boxer: ímpares na bancada A (esquerda), pares na bancada B (direita);
//    o par (2k+1, 2k+2) ocupa a mesma posição longitudinal k.
//
// Cada cilindro tem um ângulo de moente (pin). O PMS do cilindro c ocorre quando
// θ = shift(c) − pin(c), onde shift é o ângulo do eixo do cilindro (0 na bancada A,
// −ângulo do V na bancada B, −180° no boxer). O comando de válvulas escolhe qual
// dos dois PMS a cada 720° é o de ignição — é isso que a ordem de ignição define.
//
// Migrado de src/geometry.js sem mudar a aritmética (a configuração que vai ao DSP sai daqui).

// virabrequim de uma família layout-N: ângulo de cada moente, ângulo padrão do V e ordens conhecidas
export type Virabrequim = { id: string; name: string; pins: number[]; bank?: number; orders: [string, string][] };

// o que build() devolve: tudo o que o DSP e os mostradores precisam saber do motor
export type MotorMontado = {
  layout: string; N: number; crank: Virabrequim; bankAngle: number; order: number[];
  fire: number[]; valid: boolean; intervals: number[]; perBank: number[][]; banks: number;
  bank: number[]; z: number[]; axis: number[]; tdcRel: number[]; runners: number[];
  balance: { f1: number; f2: number; m1: number; m2: number };
};

const mod = (a, m) => ((a % m) + m) % m;
const dbl = (arr) => arr.flatMap((x) => [x, x]);
const I6 = [0, 240, 120, 120, 240, 0];
const I8 = [0, 180, 90, 270, 270, 90, 180, 0];
const p = (s) => s.split('-').map(Number);

export const LAYOUTS: Record<string, { name: string; counts: number[] }> = {
  inline: { name: 'Em linha', counts: [1, 2, 3, 4, 5, 6, 8] },
  v: { name: 'Em V', counts: [2, 4, 6, 8, 10, 12, 16] },
  boxer: { name: 'Boxer', counts: [2, 4, 6, 8, 12] },
};

// Virabrequins por família (layout-N).
export const CRANKS: Record<string, Virabrequim[]> = {
  'inline-1': [{ id: 'single', name: 'Monocilíndrico', pins: [0], orders: [['1', 'Única']] }],
  'inline-2': [
    { id: '360', name: '360° (twin paralelo)', pins: [0, 0], orders: [['1-2', 'Uniforme 360°']] },
    { id: '270', name: '270° (crossplane)', pins: [0, 90], orders: [['1-2', '270° / 450°']] },
    { id: '180', name: '180°', pins: [0, 180], orders: [['1-2', '180° / 540°']] },
  ],
  'inline-3': [{ id: '120', name: '120°', pins: [0, 120, 240], orders: [['1-2-3', 'Uniforme 240°'], ['1-3-2', 'Experimental (120-120-480)']] }],
  'inline-4': [
    { id: 'flat', name: 'Plano (180°)', pins: [0, 180, 180, 0], orders: [['1-3-4-2', 'Padrão'], ['1-2-4-3', 'Alternativa']] },
    { id: 'cross', name: 'Crossplane (90°)', pins: [0, 270, 90, 180], orders: [['1-3-2-4', 'Crossplane 270-180-90-180']] },
  ],
  'inline-5': [{ id: '144', name: '72° (5 moentes)', pins: [0, 216, 144, 72, 288], orders: [['1-2-4-5-3', 'Clássica 144°']] }],
  'inline-6': [{ id: '120', name: '120° (3 planos)', pins: I6, orders: [['1-5-3-6-2-4', 'Clássica'], ['1-2-4-6-5-3', 'Alternativa'], ['1-2-3-6-5-4', 'Sequencial']] }],
  'inline-8': [{ id: '90', name: '90° (straight-8)', pins: I8, orders: [['1-5-2-6-8-4-7-3', 'Clássica'], ['1-4-7-3-8-5-2-6', 'Alternativa']] }],

  'v-2': [{ id: 'shared', name: 'Moente comum', pins: [0, 0], bank: 45, orders: [['1-2', 'Padrão']] }],
  'v-4': [
    { id: '180', name: '180°', pins: [0, 0, 180, 180], bank: 90, orders: [['1-3-2-4', 'Pulso irregular'], ['1-4-3-2', 'Big-bang']] },
    { id: '360', name: '360° (twin-pulse)', pins: [0, 0, 0, 0], bank: 90, orders: [['1-2-3-4', 'Twin-pulse 270/90']] },
  ],
  'v-6': [
    { id: 'split60', name: 'Moentes defasados (60°)', pins: [0, 180, 120, 300, 240, 60], bank: 60, orders: [['1-2-3-4-5-6', 'Uniforme 120°']] },
    { id: 'odd90', name: 'Moente comum (odd-fire)', pins: [0, 0, 240, 240, 120, 120], bank: 90, orders: [['1-6-5-4-3-2', 'Odd-fire 150/90']] },
    { id: 'split90', name: 'Moentes defasados 30° (90°)', pins: [0, 30, 240, 270, 120, 150], bank: 90, orders: [['1-6-5-4-3-2', 'Uniforme 120°']] },
  ],
  'v-8': [
    { id: 'cross', name: 'Cross-plane', pins: [0, 0, 90, 90, 270, 270, 180, 180], bank: 90, orders: [['1-8-4-3-6-5-7-2', 'Small-block clássica'], ['1-8-7-2-6-5-4-3', 'Moderna (troca 4/7, 2/3)'], ['1-5-4-2-6-8-7-3', 'Alternativa']] },
    { id: 'flat', name: 'Flat-plane', pins: [0, 0, 180, 180, 180, 180, 0, 0], bank: 90, orders: [['1-6-5-8-7-4-3-2', 'Italiana'], ['1-4-3-8-7-6-5-2', 'Alternativa']] },
  ],
  'v-10': [
    { id: 'even72', name: 'Moente comum (72°, uniforme)', pins: [0, 0, 144, 144, 288, 288, 72, 72, 216, 216], bank: 72, orders: [['1-10-9-8-7-6-5-4-3-2', 'Alternada'], ['1-5-9-8-2-6-10-4-3-7', 'Variante']] },
    { id: 'odd90', name: 'Moente comum (90°, odd-fire)', pins: dbl([0, 72, 144, 216, 288]), bank: 90, orders: [['1-8-7-4-3-10-9-6-5-2', 'Odd-fire 54/90']] },
  ],
  'v-12': [{ id: '120', name: '120° (6 moentes)', pins: dbl(I6), bank: 60, orders: [['1-10-9-8-7-12-11-4-3-6-5-2', 'GT'], ['1-4-9-8-5-2-11-10-3-6-7-12', 'Variante'], ['1-4-3-6-5-12-11-10-9-8-7-2', 'Variante 2']] }],
  'v-16': [{ id: '90', name: '90° (8 moentes)', pins: dbl(I8), bank: 45, orders: [['1-8-7-4-3-6-5-2-15-10-9-14-13-12-11-16', 'Uniforme 45°']] }],

  'boxer-2': [{ id: 'boxer', name: 'Opostos (180°)', pins: [0, 180], orders: [['1-2', 'Uniforme 360°']] }],
  'boxer-4': [{ id: 'boxer', name: 'Opostos (180°)', pins: [0, 180, 180, 0], orders: [['1-3-2-4', 'Padrão'], ['1-4-2-3', 'Alternativa']] }],
  'boxer-6': [{ id: 'boxer', name: 'Opostos (120°)', pins: [0, 180, 120, 300, 240, 60], orders: [['1-6-3-2-5-4', 'Padrão'], ['1-5-3-2-6-4', 'Alternativa']] }],
  'boxer-8': [{ id: 'boxer', name: 'Opostos (90°)', pins: [0, 180, 90, 270, 270, 90, 180, 0], orders: [['1-5-7-3-2-6-8-4', 'Padrão'], ['1-6-7-4-2-5-8-3', 'Alternativa']] }],
  'boxer-12': [{ id: 'v180', name: 'V a 180° (moente comum)', pins: dbl(I6), orders: [['1-8-9-2-5-10-11-6-3-12-7-4', 'Padrão'], ['1-6-3-12-7-4-11-8-9-2-5-10', 'Variante']] }],
};

function bankOf(layout, c) { return layout === 'inline' ? 0 : (c % 2 === 0 ? 1 : 0); }

function axisAngle(layout, c, bankAngle) {
  if (layout === 'inline' || c % 2 === 1) return 0;
  return layout === 'boxer' ? -180 : -bankAngle;
}

export function tdcAngles(layout, pins, bankAngle) {
  return pins.map((pin, i) => mod(axisAngle(layout, i + 1, bankAngle) - pin, 360));
}

export function parseOrder(str, N) {
  const nums = String(str).split(/[^0-9]+/).filter(Boolean).map(Number);
  if (nums.length !== N) return null;
  const seen = new Set(nums);
  if (seen.size !== N) return null;
  for (const n of nums) if (n < 1 || n > N) return null;
  return nums;
}

// Para cada cilindro na ordem, usa o próximo PMS disponível após o anterior.
export function schedule(order, tdc) {
  const N = order.length;
  const fire = new Array(N).fill(0);
  const t0 = tdc[order[0] - 1];
  let cur = 0;
  fire[order[0] - 1] = 0;
  for (let i = 1; i < N; i++) {
    const c = order[i] - 1;
    let x = mod(tdc[c] - t0, 360);
    while (x <= cur + 1e-6) x += 360;
    cur = x;
    fire[c] = x;
  }
  const valid = cur < 720 - 1e-6;
  for (let c = 0; c < N; c++) fire[c] = mod(fire[c], 720);
  return { fire, valid };
}

export function intervals(angles) {
  const s = [...angles].sort((a, b) => a - b);
  if (s.length === 0) return [];
  if (s.length === 1) return [720];
  return s.map((a, i) => (i + 1 < s.length ? s[i + 1] - a : 720 - a + s[0]));
}

export function randomValidOrder(layout, pins, bankAngle, tries = 4000) {
  const N = pins.length;
  const tdc = tdcAngles(layout, pins, bankAngle);
  for (let k = 0; k < tries; k++) {
    const used = new Array(N).fill(false);
    used[0] = true;
    const ord = [1];
    let cur = 0, ok = true;
    while (ord.length < N) {
      const cand = [];
      for (let c = 1; c < N; c++) {
        if (used[c]) continue;
        let x = mod(tdc[c] - tdc[0], 360);
        while (x <= cur + 1e-6) x += 360;
        if (x < 720 - 1e-6) cand.push([c, x]);
      }
      if (!cand.length) { ok = false; break; }
      // privilegia o PMS mais próximo (tende a gerar ordens uniformes)
      cand.sort((a, b) => a[1] - b[1]);
      const pick = Math.random() < 0.8 ? cand.filter((q) => q[1] === cand[0][1]) : cand;
      const [c, x] = pick[Math.floor(Math.random() * pick.length)];
      used[c] = true; ord.push(c + 1); cur = x;
    }
    if (ok) return ord;
  }
  return null;
}

// Forças de inércia alternativas (1ª e 2ª ordem) e momentos de balanço. (`eixos`: ângulos dos eixos dos cilindros, para
// arranjos que não saem do layout, como o radial de src/engines/radial/geometria.ts; sem ele, os do layout)
export function balance(layout, tdc, bankAngle, z, eixos?: number[]) {
  const N = tdc.length;
  const lam = 0.3;
  let f1 = 0, f2 = 0, m1 = 0, m2 = 0;
  const zc = z.reduce((a, b) => a + b, 0) / N;
  for (let s = 0; s < 360; s += 2) {
    let x1 = 0, y1 = 0, x2 = 0, y2 = 0, mx1 = 0, my1 = 0, mx2 = 0, my2 = 0;
    for (let c = 0; c < N; c++) {
      const ax = (eixos ? eixos[c] : axisAngle(layout, c + 1, bankAngle)) * Math.PI / 180;
      const ph = (s - tdc[c]) * Math.PI / 180;
      const a1 = Math.cos(ph), a2 = lam * Math.cos(2 * ph);
      const ux = Math.sin(ax), uy = Math.cos(ax), dz = z[c] - zc;
      x1 += ux * a1; y1 += uy * a1; x2 += ux * a2; y2 += uy * a2;
      mx1 += dz * ux * a1; my1 += dz * uy * a1; mx2 += dz * ux * a2; my2 += dz * uy * a2;
    }
    f1 = Math.max(f1, Math.hypot(x1, y1)); f2 = Math.max(f2, Math.hypot(x2, y2) / lam);
    m1 = Math.max(m1, Math.hypot(mx1, my1)); m2 = Math.max(m2, Math.hypot(mx2, my2) / lam);
  }
  const clean = (v) => (v < 1e-3 ? 0 : v);
  return { f1: clean(f1), f2: clean(f2), m1: clean(m1), m2: clean(m2) };
}

function zPositions(layout, N) {
  if (layout === 'inline') return Array.from({ length: N }, (_, i) => i);
  // boxer: cilindros opostos levemente defasados (largura da biela)
  return Array.from({ length: N }, (_, i) => Math.floor(i / 2) + (layout === 'boxer' && i % 2 ? 0.3 : 0));
}

// Comprimentos dos tubos primários (m).
function runnerLengths(layout, N, header, fire) {
  const out = [];
  for (let c = 0; c < N; c++) {
    const pos = layout === 'inline' ? c : Math.floor(c / 2);
    const npos = layout === 'inline' ? N : Math.ceil(N / 2);
    const centered = npos > 1 ? pos / (npos - 1) - 0.5 : 0;
    let L;
    if (header === 'equal') L = 0.78 * (1 + 0.012 * Math.sin(c * 2.3));
    else if (header === 'short') L = 0.26 * (1 + 0.5 * Math.abs(centered) + 0.08 * Math.sin(c * 1.7));
    else {
      // desiguais: cilindros dianteiros com tubos muito mais longos (estilo boxer/manifold)
      L = 0.62 * (1 + 1.1 * (0.5 - centered) * (c % 2 ? 0.85 : 1)) + 0.05 * Math.sin(c * 3.1);
    }
    out.push(Math.max(0.12, L));
  }
  return out;
}

export function build(spec): MotorMontado {
  const { layout, cylinders: N } = spec;
  const family = CRANKS[`${layout}-${N}`];
  const crank = family.find((k) => k.id === spec.crank) || family[0];
  const bankAngle = layout === 'v' ? (spec.bankAngle ?? crank.bank) : layout === 'boxer' ? 180 : 0;
  const tdc = tdcAngles(layout, crank.pins, bankAngle);
  const order = parseOrder(spec.order, N) || p(crank.orders[0][0]);
  const sch = schedule(order, tdc);
  const banks = layout === 'inline' ? 1 : 2;
  const bank = Array.from({ length: N }, (_, c) => bankOf(layout, c + 1));
  const z = zPositions(layout, N);
  const axis = Array.from({ length: N }, (_, c) => axisAngle(layout, c + 1, bankAngle));
  // PMS de cada cilindro em relação ao ciclo de ignição (para forças de inércia)
  const tdcRel = sch.fire.map((f) => mod(f, 360));
  const perBank = [];
  for (let b = 0; b < banks; b++) perBank.push(intervals(sch.fire.filter((_, c) => bank[c] === b)));
  return {
    layout, N, crank, bankAngle, order, fire: sch.fire, valid: sch.valid,
    intervals: intervals(sch.fire), perBank, banks, bank, z, axis, tdcRel,
    runners: runnerLengths(layout, N, spec.header, sch.fire),
    balance: balance(layout, tdcRel, bankAngle, z),
  };
}
