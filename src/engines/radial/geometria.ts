// Geometria do motor radial (docs/RADIAL.md 1): fileira única com biela-mestra e articuladas (3, 5, 7, 9 cilindros),
// dupla fileira (14 e 18, ordens reais da P&W) e quatro fileiras helicoidais (R-4360, ordem decorrente dos PMS).
//
// Convenção do Ronco (src/engines/ronco/geometria.ts): o PMS do cilindro c ocorre em θ = shift(c) − pin(c). Aqui
// shift(c) = φ_c, o eixo do cilindro medido no sentido de rotação a partir do cilindro 1 (no topo), e pin(c) é o
// moente da fileira (0° na traseira; 180° na dianteira da dupla; 0/90/180/270° nas quatro do R-4360). O comando
// escolhe qual dos dois PMS a cada 720° é o de ignição: é o `schedule()` do Ronco, sem alteração, que faz isso a
// partir da ordem (texto do preset) ou, no R-4360, da ordem que `ordemDecorrente` acha.
//
// Biela-mestra (1.2): o cilindro 1 de cada fileira tem a mestra; os outros pistões andam presos a pinos na cabeça
// dela. O PMS real de cada articulada sai da cinemática (máximo numérico da posição do pistão, passo de 0,05° e
// refino parabólico): ele adianta de um lado e atrasa do outro uns poucos graus, e o curso cresce um pouco. A ordem de
// ignição usa esses PMS reais: os intervalos deixam de ser exatamente 80° no 9 (80 ± 5°), a irregularidade de fase
// própria do radial.
import { schedule, intervals, parseOrder, balance, type MotorMontado } from '../ronco/geometria';

const mod = (a: number, m: number) => ((a % m) + m) % m;
const RAD = Math.PI / 180;

export const LAYOUTS_RADIAL: Record<string, { name: string; counts: number[] }> = {
  radial: { name: 'Radial', counts: [3, 5, 7, 9, 14, 16, 18, 28] },
};

export type VirabrequimRadial = { id: string; name: string; rows: number; pins: number[]; orders: [string, string][] };

/** ordens por fileira única (1.1): ímpares no sentido de rotação, depois os pares (no 3 isso dá 1-3-2: a tabela 1.1 diz
 * 1-2-3, que com os PMS em 0/120/240° dispara a 120-120-480°) */
const ORDEM_FILEIRA: Record<number, string> = { 3: '1-3-2', 5: '1-3-5-2-4', 7: '1-3-5-7-2-4-6', 8: '1-3-5-7-2-4-6-8', 9: '1-3-5-7-9-2-4-6-8' };

export const CRANKS_RADIAL: Record<string, VirabrequimRadial[]> = {
  'radial-3': [{ id: 'mestra', name: 'Biela-mestra (1 moente)', rows: 1, pins: [0], orders: [[ORDEM_FILEIRA[3], 'Uniforme 240°']] }],
  'radial-5': [{ id: 'mestra', name: 'Biela-mestra (1 moente)', rows: 1, pins: [0], orders: [[ORDEM_FILEIRA[5], 'Uniforme 144°']] }],
  'radial-7': [{ id: 'mestra', name: 'Biela-mestra (1 moente)', rows: 1, pins: [0], orders: [[ORDEM_FILEIRA[7], 'Uniforme 102,9°']] }],
  'radial-9': [{ id: 'mestra', name: 'Biela-mestra (1 moente)', rows: 1, pins: [0], orders: [[ORDEM_FILEIRA[9], 'Uniforme 80°']] }],
  'radial-14': [{ id: 'mestra', name: 'Dupla fileira (moentes a 180°)', rows: 2, pins: [0, 180], orders: [['1-10-5-14-9-4-13-8-3-12-7-2-11-6', 'P&W R-1830 (51,43°)']] }],
  // Monaco-Trossi: 2 anéis de 8 (2 tempos no motor real; aqui 4 tempos, aproximação): ordem decorrente, a mais uniforme
  'radial-16': [{ id: 'mestra', name: 'Dupla fileira de 8 (aproximação 4T)', rows: 2, pins: [0, 180], orders: [['decorrente', 'Decorrente dos PMS']] }],
  'radial-18': [{ id: 'mestra', name: 'Dupla fileira (moentes a 180°)', rows: 2, pins: [0, 180], orders: [['1-12-5-16-9-2-13-6-17-10-3-14-7-18-11-4-15-8', 'P&W R-2800 (40°)']] }],
  'radial-28': [{ id: 'mestra4', name: 'Quatro fileiras helicoidais (0/90/180/270°)', rows: 4, pins: [0, 90, 180, 270], orders: [['decorrente', 'Decorrente dos PMS (25,714°)']] }],
};

/** escape do preset (RADIAL.md 2.1 e 5.1) */
export type EscapeRadial = {
  tipo: 'anel' | 'tubos' | 'aranha' | 'lados';
  Danel?: number; Oanel?: number; Lp?: number;
  /** tubos: comprimento (m) ou faixa [de cima, de baixo] e diâmetro (mm) */
  Lt?: number | [number, number]; Ot?: number;
  /** saídas de cada sistema (anel: as junções das saídas, a `phi` graus na carenagem) */
  saidas?: { L: number; O: number; phi: number }[];
  /** um sistema por fileira (dupla 'dual'; o R-4360 com `juntar`) */
  porFileira?: boolean;
  /** fileiras que dividem uma saída (R-4360: [[0, 1], [2, 3]]) */
  juntar?: number[][];
  /** tubos: grupos por fileira, cada um num radiador (Corsair: 3 por fileira) */
  agrupar?: number;
  /** os grupos de cada fileira saem de um lado da carenagem (fileira 0 à esquerda, 1 à direita) */
  ladoPorFileira?: boolean;
  /** dupla fileira 'single' (P-47): as saídas dos anéis → tubo longo → turbina → cauda */
  turbina?: { Lantes: number; Ldepois: number; Oantes: number; Odepois: number };
};

export type SpecRadial = Record<string, any> & {
  cylinders: number; rows?: number; cylPerRow?: number; crank?: string; order?: string;
  Lr?: number; rkr?: number; delta?: number[]; escape?: EscapeRadial;
  /** sem a cinemática das articuladas (PMS nominais): os intervalos exatos do Apêndice B */
  ideal?: boolean;
};

export type MotorRadial = MotorMontado & {
  rows: number; cylPerRow: number; phi: number[]; dPMS: number[]; curso: number[]; grupo: number[]; fileira: number[];
  f1Residuo: number; tdc: number[]; ordemTexto: string; decorrente: boolean; grupos: number;
};

// ------------------------------------------------------------------ biela-mestra (1.2)

/**
 * ΔPMS (graus) e curso relativo ao cilindro mestre de uma articulada de eixo `phi` (graus, relativo ao eixo da mestra),
 * com o pino a `dk` graus (padrão phi), `Lr` = L/r da mestra e `rkr` = r_k/r. Unidades de r.
 */
export function pmsArticulada(phi: number, Lr = 3.8, rkr = 1.0, dk = phi): { dPMS: number; curso: number; lk: number } {
  if (mod(phi, 360) < 1e-9) return { dPMS: 0, curso: 1, lk: Lr };
  const r = 1, L = Lr, rk = rkr;
  const sMestre = (th: number) => r * Math.cos(th) + L * Math.cos(Math.asin((r * Math.sin(th)) / L));
  const topo = r + L, fundo = L - r; // PMS e PMI do pistão mestre
  const a = [Math.sin(phi * RAD), Math.cos(phi * RAD)];
  const d = dk * RAD, cd = Math.cos(d), sd = Math.sin(d);
  // pino da articulada para o moente em θ: K = C + r_k·R(δ)·u
  const K = (th: number) => {
    const Cx = r * Math.sin(th), Cy = r * Math.cos(th);
    const sb = (r * Math.sin(th)) / L, cb = Math.sqrt(1 - sb * sb);
    const ux = -sb, uy = cb;
    return [Cx + rk * (cd * ux + sd * uy), Cy + rk * (-sd * ux + cd * uy)];
  };
  // l_k: em θ = φ o pistão k fica na altura de topo do mestre (mesma folga de topo)
  const k0 = K(phi * RAD), ka0 = k0[0] * a[0] + k0[1] * a[1];
  const p0 = [k0[0] - ka0 * a[0], k0[1] - ka0 * a[1]];
  const lk = Math.sqrt((topo - ka0) ** 2 + p0[0] * p0[0] + p0[1] * p0[1]);
  const s = (th: number) => {
    const k = K(th), ka = k[0] * a[0] + k[1] * a[1];
    const px = k[0] - ka * a[0], py = k[1] - ka * a[1];
    return ka + Math.sqrt(Math.max(0, lk * lk - px * px - py * py));
  };
  // máximo e mínimo numéricos (passo 0,05°) e refino parabólico do máximo
  const passo = 0.05;
  let iMax = 0, sMax = -Infinity, sMin = Infinity;
  const n = Math.round(360 / passo);
  for (let i = 0; i < n; i++) {
    const v = s(i * passo * RAD);
    if (v > sMax) { sMax = v; iMax = i; }
    if (v < sMin) sMin = v;
  }
  const y0 = s((iMax - 1) * passo * RAD), y1 = sMax, y2 = s((iMax + 1) * passo * RAD);
  const den = y0 - 2 * y1 + y2;
  const off = den < 0 ? (0.5 * (y0 - y2)) / den : 0;
  const thMax = (iMax + off) * passo;
  void sMestre;
  return { dPMS: mod(thMax - phi + 180, 360) - 180, curso: (sMax - sMin) / (topo - fundo), lk };
}

// ------------------------------------------------------------------ fileiras

/** eixo de cada cilindro (graus) e fileira; numeração P&W na dupla, por fileira no R-4360 (1.3–1.4) */
function eixosEFileiras(N: number, rows: number) {
  const phi: number[] = [], fileira: number[] = [];
  const per = N / rows;
  for (let c = 1; c <= N; c++) {
    if (rows === 1) { phi.push(((c - 1) * 360) / N); fileira.push(0); }
    else if (rows === 2) { phi.push(((c - 1) * 360) / N); fileira.push(c % 2 ? 0 : 1); }
    else { const r = Math.floor((c - 1) / per); phi.push(mod((((c - 1) % per) * 360) / per + (r * 360) / N, 360)); fileira.push(r); }
  }
  return { phi, fileira };
}

/**
 * Ordem do R-4360 (1.4): cada fileira dispara no padrão 1-3-5-7-2-4-6 a cada 102,857°; cada fileira escolhe qual dos
 * dois PMS do seu cilindro 1 é o de ignição. Das 16 combinações (8 com a fileira 0 fixa), a que dá os 28 disparos a
 * 25,714° define a ordem (os disparos ordenados).
 */
export function ordemDecorrente(tdc: number[], fileira: number[], rows: number, exata = true): number[] | null {
  const N = tdc.length, per = N / rows, alvo = 720 / N;
  const padrao = ORDEM_FILEIRA[per].split('-').map(Number);
  const base: number[][] = [];
  // cilindros de cada fileira pela posição angular a partir do mestre da fileira (1.4: 7r+1..7r+7; na dupla, alternados)
  const daFileira = Array.from({ length: rows }, (_, r) => {
    const cs = tdc.map((_, c) => c).filter((c) => fileira[c] === r);
    const t0 = tdc[cs[0]];
    return cs.sort((a, b) => mod(tdc[a] - t0, 360) - mod(tdc[b] - t0, 360)).map((c) => c + 1);
  });
  for (let r = 0; r < rows; r++) {
    const cyls = padrao.map((l) => daFileira[r][l - 1]);
    const sch = schedule(cyls.map((_, i) => i + 1), cyls.map((c) => tdc[c - 1]));
    if (!sch.valid) return null;
    base.push(cyls.map((c, i) => mod(tdc[cyls[0] - 1] + sch.fire[i], 720)));
  }
  let melhor: number[] | null = null, erroMin = Infinity;
  for (let comb = 0; comb < 1 << rows; comb++) {
    if (comb & 1) continue; // fileira 0 no primeiro PMS
    const fire = new Array(N).fill(0);
    for (let r = 0; r < rows; r++) {
      const k = (comb >> r) & 1;
      padrao.forEach((l, i) => { fire[daFileira[r][l - 1] - 1] = mod(base[r][i] + 360 * k, 720); });
    }
    const f0 = fire[0];
    const rel = fire.map((x) => mod(x - f0, 720));
    const erro = Math.max(...intervals(rel).map((x) => Math.abs(x - alvo)));
    if (erro < erroMin) { erroMin = erro; melhor = rel; }
  }
  if (!melhor || (exata && erroMin > 1e-6)) return null;
  void fileira;
  return Array.from({ length: N }, (_, c) => c).sort((a, b) => melhor![a] - melhor![b]).map((c) => c + 1);
}

// ------------------------------------------------------------------ escape: grupos e primários (2.1)

function gruposEPrimarios(esc: EscapeRadial | undefined, phi: number[], fileira: number[], rows: number) {
  const N = phi.length, per = N / rows;
  const e: EscapeRadial = esc || { tipo: 'anel', Lp: 0.2, saidas: [{ L: 0.8, O: 80, phi: 180 }] };
  const grupo: number[] = [], runners: number[] = [];
  let grupos = 1;
  const varia = (c: number) => 1 + 0.03 * Math.sin(c * 2.3); // (os primários não são idênticos)
  if (e.tipo === 'tubos') {
    const g = e.agrupar || per;
    grupos = g * rows;
    for (let c = 0; c < N; c++) {
      // posição do cilindro na fileira pelo ângulo (grupos de cilindros vizinhos)
      const naFileira = phi.map((p, i) => [p, i]).filter(([, i]) => fileira[i] === fileira[c]).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
      const pos = naFileira.indexOf(c);
      grupo.push(g === per ? fileira[c] * per + pos : fileira[c] * g + Math.floor((pos * g) / per));
      const Lt = e.Lt ?? 0.6;
      // (faixa [a, b]: com um sistema por fileira, cada fileira com o seu comprimento, a traseira com os curtos; senão, de
      // cima a baixo. As fileiras com estaques diferentes é que deixam a 4,5ª ordem do R-2800 aparecer: RADIAL.md 4.2)
      const L = Array.isArray(Lt) ? (e.porFileira ? Lt[Math.min(fileira[c], 1)] : Lt[0] + (Lt[1] - Lt[0]) * (1 - Math.cos(phi[c] * RAD)) / 2) : Lt;
      runners.push(L * varia(c));
    }
  } else if (e.tipo === 'aranha') {
    for (let c = 0; c < N; c++) { grupo.push(0); runners.push(0.4 + (0.5 * (1 + Math.cos(phi[c] * RAD))) / 2); }
  } else if (e.tipo === 'lados') {
    grupos = 2;
    for (let c = 0; c < N; c++) { grupo.push(Math.sin(phi[c] * RAD) >= -1e-9 ? 0 : 1); runners.push((e.Lp ?? 0.2) * varia(c)); }
  } else {
    // anel: um sistema (grupo 0), um por fileira, ou fileiras juntadas aos pares
    const sis = (r: number) => (e.juntar ? e.juntar.findIndex((j) => j.includes(r)) : e.porFileira || e.turbina ? r : 0);
    grupos = e.juntar ? e.juntar.length : e.porFileira || e.turbina ? rows : 1;
    for (let c = 0; c < N; c++) { grupo.push(sis(fileira[c])); runners.push((e.Lp ?? 0.2) * varia(c)); }
  }
  return { grupo, runners, grupos };
}

// ------------------------------------------------------------------ montagem

/** monta o radial: devolve o MotorMontado do Ronco (o DSP lê os mesmos campos) mais os campos radiais */
export function buildRadial(spec: SpecRadial): MotorRadial {
  const N = spec.cylinders;
  const fam = CRANKS_RADIAL[`radial-${N}`];
  if (!fam) throw new Error(`radial de ${N} cilindros não existe (3, 5, 7, 9, 14, 18, 28)`);
  const crank = fam.find((k) => k.id === spec.crank) || fam[0];
  const rows = crank.rows, per = N / rows;
  const { phi, fileira } = eixosEFileiras(N, rows);
  // PMS nominal e real (com o ΔPMS da articulada relativo à mestra da fileira)
  const mestre = Array.from({ length: rows }, (_, r) => fileira.indexOf(r));
  const dPMS: number[] = [], curso: number[] = [];
  for (let c = 0; c < N; c++) {
    const rel = mod(phi[c] - phi[mestre[fileira[c]]], 360);
    const dk = spec.delta ? spec.delta[c] - phi[mestre[fileira[c]]] : rel;
    const k = spec.ideal ? { dPMS: 0, curso: 1 } : pmsArticulada(rel, spec.Lr ?? 3.8, spec.rkr ?? 1.0, dk);
    dPMS.push(k.dPMS); curso.push(k.curso);
  }
  const tdcNom = phi.map((p, c) => mod(p - crank.pins[fileira[c]], 360));
  const tdc = tdcNom.map((t, c) => mod(t + dPMS[c], 360));
  // ordem: texto do preset; no R-4360, decorrente dos PMS nominais
  const decorrente = rows === 4 || N === 16;
  let order: number[] | null = decorrente ? ordemDecorrente(tdcNom, fileira, rows, N !== 16) : parseOrder(spec.order, N);
  if (!order) order = decorrente ? null : parseOrder(crank.orders[0][0], N);
  if (!order) throw new Error('ordem de ignição do radial não encontrada');
  const sch = schedule(order, tdc);
  const tdcRel = sch.fire.map((f) => mod(f, 360));
  const z = fileira.map((r) => (rows === 1 ? 0 : rows === 2 ? 0.22 * r : 0.2 * r));
  const perBank: number[][] = [];
  for (let r = 0; r < rows; r++) perBank.push(intervals(sch.fire.filter((_, c) => fileira[c] === r)));
  const { grupo, runners, grupos } = gruposEPrimarios(spec.escape, phi, fileira, rows);
  const bal = balance('radial', tdcRel, 0, z, phi);
  const f1Residuo = Math.abs(bal.f1 - (rows === 1 ? N / 2 : 0));
  return {
    layout: 'radial', N, crank: { id: crank.id, name: crank.name, pins: crank.pins, orders: crank.orders }, bankAngle: 0, order,
    fire: sch.fire, valid: sch.valid, intervals: intervals(sch.fire), perBank, banks: rows, bank: fileira, z, axis: phi, tdcRel,
    runners, balance: bal,
    rows, cylPerRow: per, phi, dPMS, curso, grupo, fileira, f1Residuo, tdc, ordemTexto: order.join('-'), decorrente, grupos,
  };
}
