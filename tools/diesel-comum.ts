// Laço de renderização e cenários do Diesel, compartilhados por tools/diesel-render.ts, diesel-lenta.ts e
// diesel-valida.ts. O laço é o de tools/render.ts: eventos no início de cada bloco de 128 amostras (como no
// AudioWorklet) e telemetria depois do bloco. A configuração é a da página (configCalibrada: sonda fora da thread).
import { DieselDSP } from '../src/engines/diesel/dsp';
import { PRESETS, PADRAO_DIESEL, type PresetDiesel } from '../src/engines/diesel/presets';
import { configCalibrada } from '../src/engines/diesel/config';
import { spawn } from 'node:child_process';
import { semear, indiceMediano, type Medida } from './desvios';

export const SR = 48000;
const B = 128;

export type Evento = [number, ((d: DieselDSP) => void) | null];
export type Cenario = { eventos: Evento[]; ouvinte?: string; portador?: string; antes?: (d: DieselDSP, t: number) => void };

export const preset = (id: string) => {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`preset diesel desconhecido: ${id}`);
  return { ...PADRAO_DIESEL, ...p } as PresetDiesel;
};

const quente = (d: DieselDSP) => { d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } }); };
const liga = (d: DieselDSP) => d.message({ type: 'input', ignition: true });
const pedal = (v: number) => (d: DieselDSP) => d.message({ type: 'input', throttle: v });

// Cenários (DIESEL.md 8): lista de [tempo (s), ação]; a última entrada marca o fim
export const CENARIOS: Record<string, (spec: PresetDiesel) => Cenario> = {
  // lenta quente, 12 s
  idle: () => ({ eventos: [[0, (d) => { quente(d); liga(d); }], [12, null]], portador: 'nenhum0' }),
  // partida a frio de verdade (20 °C), 12 s
  cold: () => ({ eventos: [[0, (d) => { d.message({ type: 'input', temp: { mode: 'real', value: 20 } }); liga(d); }], [14, null]], portador: 'nenhum0' }),
  // partida a −10 °C (velas, partida, queimas parciais), 20 s
  frio10: () => ({ eventos: [[0, (d) => { d.ambientT = -10; d.message({ type: 'input', temp: { mode: 'real', value: -10 } }); liga(d); }], [22, null]], portador: 'nenhum0' }),
  // lenta com a água fixa em −10 °C, à mesma rotação da lenta quente (DIESEL.md 2.6: o knock sobe 8 ± 3 dB)
  idleFrio: (spec) => ({ eventos: [[0, (d) => { d.lentaFixa = spec.idle; d.message({ type: 'input', temp: { mode: 'fixed', value: -10 } }); liga(d); }], [12, null]], portador: 'nenhum0' }),
  // lenta fria a −23 °C (Cummins 6.7 da gravação: a central sobe a lenta a 1000 rpm)
  idle23: () => ({ eventos: [[0, (d) => { d.ambientT = -23; d.message({ type: 'input', temp: { mode: 'fixed', value: -23 } }); liga(d); }], [12, null]], portador: 'nenhum0' }),
  // em neutro: lenta, pé no fundo (governador de máxima), solta
  rev: () => ({ eventos: [[0, (d) => { quente(d); liga(d); }], [3, pedal(1)], [7.5, pedal(0)], [11, null]], portador: 'nenhum0' }),
  // carro: 1ª, pé no fundo, trocas automáticas
  wot: () => ({ eventos: [[0, (d) => { quente(d); liga(d); }], [2.5, (d) => { d.message({ type: 'input', shift: 1 }); pedal(1)(d); }], [18, pedal(0)], [22, null]], portador: 'carro' }),
  // rotação travada em carga, como a calibração: 4 patamares de 1,5 s com combustível 1
  sweep: (spec) => {
    const ev: Evento[] = [[0, (d) => { quente(d); d.state = 'run'; d.lockOmega = true; d.sonda = true; d.fuelCmd = 1; }]];
    const steps = [0.35, 0.55, 0.75, 0.9];
    steps.forEach((f, i) => ev.push([i * 1.5, (d) => { const r = spec.rpmMax * f; d.omega = (r * Math.PI * 2) / 60; d.rpmAvg = r; d.tw = 0.3 + 0.7 * f; d.boostFixo = spec.boost * (0.3 + 0.7 * f); }]));
    ev.push([steps.length * 1.5, null]);
    return { eventos: ev, portador: 'nenhum0' };
  },
  // locomotiva: lenta, notches 1 a 8 a cada 8 s, volta à lenta
  notches: () => {
    const ev: Evento[] = [[0, (d) => { quente(d); liga(d); }]];
    for (let n = 1; n <= 8; n++) ev.push([6 + (n - 1) * 8, (d) => d.message({ type: 'diesel', notch: n })]);
    ev.push([6 + 64, (d) => d.message({ type: 'diesel', notch: 0 })]);
    ev.push([6 + 74, null]);
    return { eventos: ev, portador: 'locomotiva' };
  },
  // gerador: degraus 0 → 50 → 0 → 100 → 0%
  degraus: () => ({
    eventos: [[0, (d) => { quente(d); liga(d); }], [10, (d) => d.message({ type: 'diesel', degrau: 0.5 })], [20, (d) => d.message({ type: 'diesel', degrau: 0 })],
      [30, (d) => d.message({ type: 'diesel', degrau: 1 })], [40, (d) => d.message({ type: 'diesel', degrau: 0 })], [48, null]],
    portador: 'gerador',
  }),
  // Jake: rotação travada a 1900 rpm sem combustível, freio ligado
  jake: (spec) => ({
    eventos: [[0, (d) => { quente(d); d.state = 'run'; d.runT = 30; d.lockOmega = true; d.omega = (1900 * Math.PI * 2) / 60; d.rpmAvg = 1900; d.message({ type: 'diesel', freioMotor: true }); }], [4, null]],
    portador: 'nenhum0',
  }),
  // plena carga travada a 1900 rpm (referência do Jake)
  plena1900: (spec) => ({
    eventos: [[0, (d) => { quente(d); d.state = 'run'; d.lockOmega = true; d.sonda = true; d.fuelCmd = 1; d.omega = (1900 * Math.PI * 2) / 60; d.rpmAvg = 1900; d.tw = 0.9; d.boostFixo = spec.boost; }], [4, null]],
    portador: 'nenhum0',
  }),
};

// Renderiza um cenário. `ouvinte` ext/pipe/bay/int/road; `portador` 'carro' | 'gerador' | 'locomotiva' | 'nenhum'
// ('nenhum0': bancada sem carga e com o governador do preset, como em neutro no carro)
export function renderizar(spec: PresetDiesel, cen: string | Cenario, op: { ouvinte?: string; portador?: string; tele?: number; cfg?: any } = {}) {
  const c = typeof cen === 'string' ? CENARIOS[cen](spec) : cen;
  const d = new DieselDSP(SR);
  d.params.listener = op.ouvinte || c.ouvinte || 'ext';
  // (MIX=exhaust=0,intake=0 isola fontes nas medições)
  if (process.env.MIX) for (const kv of process.env.MIX.split(',')) { const [k, v] = kv.split('='); d.params[k] = +v; }
  const cfg = op.cfg || configCalibrada(spec, SR);
  d.setConfig(cfg);
  const port = op.portador || c.portador || 'carro';
  d.message({ type: 'diesel', portador: port === 'nenhum0' ? (spec.portadores.includes('carro') ? 'carro' : spec.portadores[0]) : port });
  // o ruído na semente atual de tools/desvios.ts (0 = a de fábrica, nada muda; AUDITORIA A2): a calibração fica com a de
  // fábrica, como na página, e a semente é a fase do ruído no instante da partida
  semear(d);
  const ev = c.eventos;
  const T = ev[ev.length - 1][0], n = Math.round(T * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const bl = new Float32Array(B), br = new Float32Array(B);
  const tele: any[] = [];
  const passo = op.tele ?? 1024;
  let ei = 0, nan = false, ultTele = -Infinity, pico = 0;
  for (let i = 0; i < n; i += B) {
    const t = i / SR;
    while (ei < ev.length && ev[ei][0] <= t) { ev[ei][1]?.(d); ei++; }
    c.antes?.(d, t);
    // (como na página: troca automática no cenário wot até a 3ª)
    if (typeof cen === 'string' && cen === 'wot' && d.gear > 0 && d.locked && d.rpmAvg > spec.rpmMax * 0.93 && d.gear < 3 && !d.shifting) d.message({ type: 'input', shift: 1 });
    d.process(bl, br, B);
    const k = Math.min(B, n - i);
    L.set(bl.subarray(0, k), i); R.set(br.subarray(0, k), i);
    // (todas as amostras do bloco, nos dois canais: conferir só a primeira da esquerda e a última da direita deixava passar
    // um Infinity ou um NaN que não persistisse nos filtros; AUDITORIA A7, T-DSL-12. O pico vai junto, para a tabela)
    for (let j = 0; j < k; j++) {
      const a = Math.abs(bl[j]), b = Math.abs(br[j]);
      if (!(a < Infinity) || !(b < Infinity)) nan = true; else if (a > pico || b > pico) pico = Math.max(pico, a, b);
    }
    if (!Number.isFinite(d.rpmAvg) || !Number.isFinite(d.p[0])) nan = true;
    if (i - ultTele >= passo) {
      ultTele = i;
      const m = d.telemetry();
      tele.push({ t: +t.toFixed(4), rpm: m.rpm, fuel: m.fuel, lambda: m.lambda, lambdaInst: m.lambdaInst, pMax: m.pMax, dpdth: m.dpdth, ang: m.angPk, tauId: m.tauId, tInj: m.tInj, boost: m.boost, map: m.map,
        fumaca: m.fumaca, branca: m.fumacaBranca, state: m.state, gear: m.gear, kmh: m.kmh, coolant: m.coolant, exhT: m.exhT, tEvo: m.tEvo, turboRpm: m.turboRpm,
        kW: m.kW, cargaKW: m.cargaKW, torque: m.torque, velas: m.velas, notch: m.notch, rpmAlvo: m.rpmAlvo, jake: m.jake, pBack: m.pBack, fuelInj: m.fuelInj });
    }
  }
  return { L, R, tele, nan, pico, d, cfg };
}

// ---- análise de sinal simples (bandas relativas a 150–400 Hz e afins ficam em diesel-bandas.ts)
export const rmsDb = (x: Float32Array, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return 10 * Math.log10(s / Math.max(1, b - a) + 1e-20); };
export const media = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
// telemetria num intervalo de tempo
export const trecho = (tele: any[], t0: number, t1: number) => tele.filter((x) => x.t >= t0 && x.t < t1);

// ---- sementes (AUDITORIA A2): as medidas de contagem, transiente e CV rodam com as sementes base, base+1 e base+2, uma
// por processo (o filho lê a semente de SEMENTE, `iniciarSementes()` em tools/desvios.ts), e ficam com o caso mediano
/** `ordem`: o escalar que escolhe o caso mediano entre as sementes quando `valor` é um vetor */
export type LinhaDiesel = Medida & { ordem?: number };
const fmtS = (x: number) => (Number.isFinite(x) ? (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2)) : String(x));
const escalar = (l: LinhaDiesel) => l.ordem ?? (Array.isArray(l.valor) ? Math.max(...l.valor.map(Math.abs)) : (l.valor ?? NaN));

/** medida a medida, a linha da semente cujo valor (ou `ordem`) é o mediano; o `medido` ganha os das três sementes */
export function casoMediano(listas: LinhaDiesel[][]): Medida[] {
  return listas[0].map((_, i) => {
    const cs = listas.map((ls) => ls[i]);
    if (cs.some((c) => !c || c.nome !== cs[0].nome)) throw new Error(`as sementes deram medidas diferentes em "${cs[0].nome}"`);
    const v = cs.map(escalar), { ordem: _o, ...m } = cs[indiceMediano(v)];
    // (o texto mostra o valor de cada semente; num vetor, os componentes; a escolha do mediano é pela `ordem`)
    const txt = cs.map((c) => (Array.isArray(c.valor) ? c.valor.map(fmtS).join('/') : fmtS(c.valor ?? NaN)));
    return new Set(txt).size > 1 ? { ...m, medido: `${m.medido} [sementes ${txt.join(' · ')}]` } : m;
  });
}

/** roda `arquivo` num processo filho com `tsx`, a semente `semente` no ambiente, e devolve a saída padrão (a de erro
 *  vai junto se `erro`) e o código de saída */
export function filho(arquivo: string, argv: string[], op: { semente?: number; erro?: boolean } = {}) {
  return new Promise<{ saida: string; codigo: number }>((ok) => {
    const env = op.semente === undefined ? process.env : { ...process.env, SEMENTE: String(op.semente) };
    const p = spawn(process.execPath, ['--import', 'tsx', arquivo, ...argv], { env, stdio: ['ignore', 'pipe', op.erro ? 'pipe' : 'inherit'] });
    let s = ''; p.stdout!.on('data', (b) => (s += b)); if (op.erro) p.stderr!.on('data', (b) => (s += b));
    p.on('close', (c) => ok({ saida: s, codigo: c ?? 1 }));
  });
}
