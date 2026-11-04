// Renderiza uma passagem pela Cena nova, fora do navegador: portador + cena + (opcional) a
// reverberação do ambiente feita aqui por convolução (no navegador ela é o ConvolverNode da cadeia).
//
//   npx tsx tools/cena/render-passagem.ts [--portador trem] [--v 350] [--d 3] [--altitude 0]
//        [--ambiente tunel|ceu|corte|estacao|ponte] [--dur 12] [--x0 600] [--tom 1000] [--so-tom]
//        [--solo brita|...] [--sem-reverb] [--out pasta]
//
// Saída: <out>/passagem_<ambiente>_<v>.wav (float 32, escala absoluta 0 dBFS = 124 dB SPL, sem tanh)
// e .json com a telemetria (a cada 128 amostras: t, s, v, pressão, vento, SPL A, e a fonte 'tom').
import fs from 'node:fs';
import path from 'node:path';
import { CenaPassagem } from '../../src/scene/cena';
import { ambientePassagem, gerarRespostaPorBanda } from '../../src/scene/ambientes';
import { Trem, type ConfigTrem } from '../../src/carriers/trem';
import { PortadorTeste, type FonteTeste } from '../../src/carriers/teste';
import type { Portador } from '../../src/carriers/tipos';
import type { Ambiente, Ouvinte, Trajetoria, IdAmbiente } from '../../src/scene/tipos';
import { convoluir } from './analise';
import { gravarWav } from '../wav';

export const SR = 48000;
export const BLOCO = 128;

export interface OpcoesPassagem {
  portador?: 'trem' | 'teste';
  /** portador já montado (com motor): substitui `portador` */
  portadorPronto?: Portador;
  /** chamado antes de cada bloco (comandos) */
  antesBloco?: (t: number, p: Portador) => void;
  /** trajetória completa (substitui d/altitude/comprimentoVia) */
  traj?: Partial<Trajetoria>;
  trem?: Partial<ConfigTrem>;
  fontesTeste?: FonteTeste[];
  corpoTeste?: ConstructorParameters<typeof PortadorTeste>[2];
  v: number;                    // m/s
  d: number;                    // lateral (m)
  altitude?: number;
  ambiente?: IdAmbiente;
  amb?: Ambiente;               // substitui o ambiente por id
  solo?: Ambiente['solo']['tipo'];
  dur: number;                  // s
  x0?: number;                  // m: o nariz começa x0 antes do ouvinte (padrão: centro do corpo começa a x0)
  sCentro0?: number;            // m: s inicial do centro do corpo (substitui x0)
  comprimentoVia?: number;
  ouvinte?: Partial<Ouvinte>;
  reverb?: boolean;             // soma a reverberação offline (padrão true)
  semFundo?: boolean;
  ur?: number;
  /** chamado depois de cada bloco */
  aoBloco?: (t: number, cena: CenaPassagem, p: Portador) => void;
  medirCpu?: boolean;
  semSombra?: boolean;
  kPonte?: number;
  /** °C do ar (velocidade do som da propagação) */
  temperatura?: number;
}

export interface ResultadoPassagem {
  L: Float32Array; R: Float32Array;       // direto + reverberação (FS, escala absoluta)
  dL: Float32Array; dR: Float32Array;     // só o direto
  sL: Float32Array; sR: Float32Array;     // envio
  tele: { t: number[]; s: number[]; p: number[]; u: number[]; spl: number[] };
  L_corpo: number; tNarizAbeam: number; tCaudaAbeam: number;
  cpuMsPorBloco?: number; cpuFracao?: number; nFontes: number;
  amb: Ambiente; portador: Portador; cena: CenaPassagem;
}

export function renderPassagem(o: OpcoesPassagem): ResultadoPassagem {
  const amb = o.amb ?? ambientePassagem(o.ambiente ?? 'ceu');
  if (o.solo) amb.solo = { tipo: o.solo };
  if (o.semFundo) amb.fundo = { vento: 0, ventilacao: 0, murmurio: 0 };
  const traj: Trajetoria = { tipo: 'reta', comprimento: o.comprimentoVia ?? 3000, raioCurva: 2000, lateral: o.d, altitude: o.altitude ?? 0, sentido: 1, ...(o.traj || {}) };
  const ouv: Ouvinte = { modo: 'fixo', pos: [0, 0, 1.6], gimbal: { az: 90, el: 0, r: 5, alvo: 'corpo' }, local: 'fora', binaural: true, ...(o.ouvinte || {}) };
  const portador: Portador = o.portadorPronto ?? (o.portador === 'teste'
    ? new PortadorTeste(SR, o.fontesTeste ?? [], o.corpoTeste)
    : new Trem(SR, { ladoOuvinte: -1, ...(o.trem || {}) }));
  const L = portador.corpo.comprimento;
  const s0 = o.sCentro0 ?? -(o.x0 ?? 600) - (o.portador === 'teste' || o.portadorPronto ? 0 : L / 2);
  (portador.cinematica as { s: number }).s = s0;
  portador.comandar(o.portadorPronto ? { ...(portador as any).cmd, velocidadeFixa: o.v } : { pedal: 0, velocidadeFixa: o.v });
  const cena = new CenaPassagem({ ur: o.ur, semSombra: o.semSombra, kPonte: o.kPonte });
  cena.configurar(amb, traj, ouv, SR);
  if (o.temperatura != null) cena.definirTemperatura(o.temperatura);
  const nF = portador.fontes().length;
  const canais = Array.from({ length: nF }, () => new Float32Array(BLOCO));
  const n = Math.round(o.dur * SR);
  const dL = new Float32Array(n), dR = new Float32Array(n), sL = new Float32Array(n), sR = new Float32Array(n);
  const bl = new Float32Array(BLOCO), br = new Float32Array(BLOCO), el = new Float32Array(BLOCO), er = new Float32Array(BLOCO);
  const tele = { t: [] as number[], s: [] as number[], p: [] as number[], u: [] as number[], spl: [] as number[] };
  let cpu = 0n;
  for (let i = 0; i < n; i += BLOCO) {
    const t0 = o.medirCpu ? process.hrtime.bigint() : 0n;
    o.antesBloco?.(i / SR, portador);
    portador.processar(canais, BLOCO, 1 / SR);
    cena.processar(portador, canais, bl, br, el, er, BLOCO);
    if (o.medirCpu) cpu += process.hrtime.bigint() - t0;
    const m = Math.min(BLOCO, n - i);
    dL.set(bl.subarray(0, m), i); dR.set(br.subarray(0, m), i); sL.set(el.subarray(0, m), i); sR.set(er.subarray(0, m), i);
    const tc = cena.telemetria();
    tele.t.push((i + BLOCO) / SR); tele.s.push(portador.cinematica.s); tele.p.push(tc.pressaoPa); tele.u.push(tc.ventoMs); tele.spl.push(tc.splDbA);
    o.aoBloco?.((i + BLOCO) / SR, cena, portador);
  }
  // reverberação offline: wet · (envio ⊛ resposta ao impulso de energia 1)
  let Lo = dL, Ro = dR;
  if (o.reverb !== false && amb.reverb.wet > 0) {
    const ir = gerarRespostaPorBanda(amb, SR);
    const w = Math.sqrt(amb.reverb.wet);
    const cl = convoluir(sL, ir.L), cr = convoluir(sR, ir.R);
    Lo = new Float32Array(n); Ro = new Float32Array(n);
    const dry = amb.reverb.dry ?? 1;
    for (let i = 0; i < n; i++) { Lo[i] = dry * dL[i] + w * cl[i]; Ro[i] = dry * dR[i] + w * cr[i]; }
  }
  // instantes em que nariz e cauda ficam abeam do ouvinte (x = 0)
  const tN = (-(s0 + L / 2)) / o.v, tC = (-(s0 - L / 2)) / o.v;
  const blocos = n / BLOCO;
  const r: ResultadoPassagem = { L: Lo, R: Ro, dL, dR, sL, sR, tele, L_corpo: L, tNarizAbeam: tN, tCaudaAbeam: tC, nFontes: nF, amb, portador, cena };
  if (o.medirCpu) { r.cpuMsPorBloco = Number(cpu) / 1e6 / blocos; r.cpuFracao = r.cpuMsPorBloco / ((BLOCO / SR) * 1000); }
  return r;
}

// ------------------------------------------------------------------ CLI
const ehCli = process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('tools', 'cena', 'render-passagem.ts'));
if (ehCli) {
  const a = process.argv.slice(2);
  const arg = (k: string, d?: string) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
  const tem = (k: string) => a.includes('--' + k);
  const v = +(arg('v', '350')!) / 3.6;
  const amb = (arg('ambiente', 'tunel') as IdAmbiente);
  const tom = arg('tom');
  const out = arg('out', 'saida-cena')!;
  fs.mkdirSync(out, { recursive: true });
  const t0 = Date.now();
  const r = renderPassagem({
    portador: 'trem', v, d: +(arg('d', '3')!), altitude: +(arg('altitude', '0')!), ambiente: amb, dur: +(arg('dur', '12')!), x0: +(arg('x0', '600')!),
    solo: arg('solo') as any, reverb: !tem('sem-reverb'),
    trem: tom ? { tom: { f: +tom, nivelDb: 90 }, soTom: tem('so-tom') } : {}, medirCpu: true,
  });
  const base = path.join(out, `passagem_${amb}_${Math.round(v * 3.6)}`);
  const pico = gravarWav(base + '.wav', r.L, r.R, SR);
  fs.writeFileSync(base + '.json', JSON.stringify({ amb, v, tNarizAbeam: r.tNarizAbeam, tCaudaAbeam: r.tCaudaAbeam, fontes: r.nFontes, cpuMsPorBloco: r.cpuMsPorBloco, tele: r.tele }));
  console.log(`${base}.wav pico=${(20 * Math.log10(pico)).toFixed(1)} dBFS (${(124 + 20 * Math.log10(pico)).toFixed(1)} dB SPL) fontes=${r.nFontes} CPU=${r.cpuMsPorBloco!.toFixed(3)} ms/bloco (${(100 * r.cpuFracao!).toFixed(1)}% do quantum) em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
