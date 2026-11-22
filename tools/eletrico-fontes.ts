// Renderiza um preset do Elétrico numa condição casada com uma gravação, para o kit ouvido (tools/ouvido), e grava o
// conjunto do orçamento por fonte: o mesmo render com uma fonte só de cada vez e a MESMA semente (nos moldes de
// tools/rotativo-fontes.ts). O render passa pela Cena crua (Pa no ouvido, sem tanh nem master), com o portador do preset
// e a calibração da página. A propagação é linear: `_so-<fonte>` é a contribuição exata da fonte.
//
//   npx tsx tools/eletrico-fontes.ts <preset> <saida.wav> [opções]
//   npx tsx tools/eletrico-fontes.ts <preset> <pasta/> --cada [opções]   (<pasta>/<preset>_<rótulo>_tudo.wav, _so-<fonte>.wav, _semente2.wav)
//
//   --kmh V            velocidade imposta (padrão 0: parado); --livre solta a velocidade (arrancada: o portador integra)
//   --pedal x          acelerador ou tração, 0 a 1 (padrão 0)          --freio x   freio elétrico, 0 a 1
//   --carga x          bancada: fração do degrau de carga
//   --ouvinte o        fora (o da página: preso ao corpo, a 7,5 m da lateral; no trem, ao lado do 1º truque motor), cabine, cofre (os da página),
//                      motor (preso ao corpo, ao lado da 1ª fonte de motor, a --dist m da lateral, ouvido a 1,6 m) ou
//                      fixo (parado na via, a --dist m da lateral: o corpo passa por ele; --s0 = posição inicial)
//   --dist m           distância da lateral (padrão 7,5)               --alvo id   fonte ao lado da qual fica o ouvinte `motor`
//   --amb a            ceu (padrão) | rua | estacao | tunel | hangar   --solo t    troca o solo do ambiente (asfalto, nenhum…)
//   --sem-fundo        desliga o som de fundo do ambiente (vento, murmúrio)
//   --dur s            segundos gravados (padrão 10)                   --descarta s   jogados fora antes (padrão 3)
//   --campo JSON       muda campos do preset antes de calibrar: '{"niveis":{"aux":80}}' (os objetos são fundidos)
//   --sem a,b          desliga fontes     --so a,b   só estas     --escala a=g,b=g   multiplica o ganho
//   --semente N        outra semente nos geradores de RUÍDO (as fases das linhas e o passeio do eixo ficam os mesmos:
//                      só assim a diferença de dois renders é a parte estocástica)
//   --f0 Hz | rot | ele | fc    o "ciclo" que vai no .json para o kit (padrão rot: a volta do eixo do motor)
//   --rotulo nome      nome da condição nos arquivos de --cada
//
// Fontes: motor (forças magnéticas), inversor, engrenamento, rolamentos (ruído dos rolamentos do motor), chocalho (e o
// clique de flanco), ventilador, escovas, helice, pas (ruído largo de pá), aux (linhas e largo do conversor auxiliar),
// compressor, ventilacao e transformador (auxiliares.ts), avas; do portador: pneus, vento (aero do carro), trole,
// rolamento (roda e trilho), aerotrem (corpo, vãos, pantógrafo, nariz e cauda); e fundo (o som do ambiente da Cena).
import fs from 'node:fs';
import path from 'node:path';
import { preset, SR } from './eletrico/comum';
import { prepararMotorEletrico } from '../src/engines/eletrico/motor';
import { montarPortadorEletrico } from '../src/engines/eletrico/portador';
import { EletricoDSP, type PresetEletrico } from '../src/engines/eletrico/dsp';
import { BancoDeLinhas, JitterEixo } from '../src/engines/eletrico/linhas';
import { RNG } from '../src/acoustics/rng';
import { CenaDSP } from '../src/scene/dsp-cena';
import { ambientePassagem } from '../src/scene/ambientes';
import { ambienteEletrico, type IdAmbienteEletrico } from '../src/pages/eletrico/ambientes';
import type { Ambiente, Ouvinte, Trajetoria } from '../src/scene/tipos';
import type { Portador } from '../src/carriers/tipos';
import { Trem } from '../src/carriers/trem';
import { CarroEletrico } from '../src/carriers/carro-eletrico';
import { PA_FS } from '../src/scene/constantes';

const B = 128;
export const FONTES = ['motor', 'inversor', 'engrenamento', 'rolamentos', 'chocalho', 'ventilador', 'escovas', 'helice', 'pas', 'aux', 'compressor', 'ventilacao', 'transformador', 'avas', 'pneus', 'vento', 'trole', 'rolamento', 'aerotrem', 'fundo'] as const;
export type Fonte = (typeof FONTES)[number];

export interface Op {
  kmh: number; livre: boolean; pedal: number; freio: number; carga: number;
  ouvinte: 'fora' | 'cabine' | 'cofre' | 'motor' | 'fixo'; dist: number; alvo?: string; s0?: number;
  amb: string; solo?: string; semFundo: boolean; dur: number; descarta: number; campo: Record<string, unknown>;
  sem: string[]; so: string[]; escala: [string, number][]; semente?: number; f0: string;
}
export const OP_PADRAO: Op = { kmh: 0, livre: false, pedal: 0, freio: 0, carga: 0, ouvinte: 'fora', dist: 7.5, amb: 'ceu', semFundo: false, dur: 10, descarta: 3, campo: {}, sem: [], so: [], escala: [], f0: 'rot' };

/** funde `campo` no preset (um nível de objetos: niveis, inversor, reducao…) */
function comCampo(p: PresetEletrico, campo: Record<string, unknown>): PresetEletrico {
  const q: Record<string, unknown> = { ...p };
  for (const [k, v] of Object.entries(campo)) {
    const a = (p as unknown as Record<string, unknown>)[k];
    q[k] = v && typeof v === 'object' && !Array.isArray(v) && a && typeof a === 'object' && !Array.isArray(a) ? { ...(a as object), ...(v as object) } : v;
  }
  return q as unknown as PresetEletrico;
}

/** os motores elétricos de um portador (o Tesla tem dois) */
function motoresDe(p: Portador): EletricoDSP[] {
  const x = p as unknown as { motores?: EletricoDSP[]; motor?: EletricoDSP | null; tracao?: { motor: EletricoDSP } | null };
  if (x.motores) return x.motores;
  if (x.tracao) return [x.tracao.motor];
  return x.motor ? [x.motor] : [];
}

/** a que fonte do orçamento pertence um canal do PORTADOR que não é do motor (null: é do motor) */
function fonteDoPortador(id: string): Fonte | null {
  if (id.startsWith('pneu')) return 'pneus';
  if (id === 'aero') return 'vento';
  if (id === 'trole') return 'trole';
  if (/^truque\.\d+$/.test(id)) return 'rolamento';
  if (/^(truque\.\d+\.aero|corpo|vao|pantografo|nariz|cauda|pressao)/.test(id)) return 'aerotrem';
  return null;
}

/**
 * Multiplica o ganho de cada fonte (0 = desliga) num portador já montado e calibrado. Cada gerador de ruído tem o seu RNG:
 * desligar um não muda a sequência dos outros.
 */
export function escalar(p: Portador, g: (f: Fonte) => number) {
  const banco = (b: BancoDeLinhas | null | undefined, k: number) => {
    if (!b || k === 1) return;
    const o = b.atualizar;
    b.atualizar = function (this: BancoDeLinhas, L, fatorF = 1, ganho = 1) { return o.call(this, L, fatorF, ganho * k); };
  };
  const ruido = (r: { norm: number; ganho?: number } | null | undefined, k: number) => { if (r) { r.norm *= k; if (r.ganho !== undefined) r.ganho *= k; } };
  for (const m of motoresDe(p)) {
    for (const U of m.uni) {
      banco(U.bMotor, g('motor')); ruido(U.corcova, g('motor')); if (U.corcova) U.normCorc *= g('motor');
      banco(U.bInv, g('inversor'));
      if (U.inv && g('inversor') !== 1) { const k = g('inversor'), o = U.inv.ruido; U.inv.ruido = function (out, off, n, escala, ini) { return o.call(this, out, off, n, escala * k, ini); }; }
      banco(U.bRed, g('engrenamento'));
      if (U.red) { ruido(U.red.rol, g('rolamentos')); ruido(U.red.choc, g('chocalho')); ruido(U.red.cliq, g('chocalho')); }
      banco(U.bVen, g('ventilador')); ruido(U.ven?.ruido, g('ventilador'));
      banco(U.bEsc, g('escovas')); ruido(U.esc?.faisca, g('escovas'));
      banco(U.bHel, g('helice')); ruido(U.hel?.largo, g('pas'));
    }
    banco(m.bAux, g('aux')); ruido(m.ruidoAux, g('aux'));
    if (m.auxi) { m.auxi.ganhos.compressor *= g('compressor'); m.auxi.ganhos.ventilacao *= g('ventilacao'); m.auxi.ganhos.transformador *= g('transformador'); }
    banco(m.bAvas, g('avas'));
    if (m.avas && g('avas') !== 1) { const k = g('avas'), a = m.avas, o = a.processar; a.processar = function (out, off, n, pos, tot) { const t = new Float32Array(n); o.call(this, t, 0, n, pos, tot); for (let i = 0; i < n; i++) out[off + i] += k * t[i]; }; }
  }
  // canais do portador: zera ou escala depois do processar
  const ids = p.fontes().map((f) => f.id), ks = ids.map((id) => { const f = fonteDoPortador(id); return f ? g(f) : 1; });
  if (ks.some((k) => k !== 1)) {
    const o = p.processar.bind(p);
    (p as { processar: Portador['processar'] }).processar = (s, n, dt) => { o(s, n, dt); for (let i = 0; i < ks.length; i++) if (ks[i] !== 1) { const x = s[i], k = ks[i]; for (let j = 0; j < n; j++) x[j] *= k; } };
  }
}

/** troca a semente dos geradores de RUÍDO (não a das fases dos bancos de linhas nem a do passeio do eixo) */
export function semearRuido<T>(obj: T, k: number): T {
  const vistos = new Set<unknown>();
  const mistura = (s: number) => { let h = Math.imul(k ^ 0x5bd1e995, 0x9e3779b1); h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; return ((s ^ h) >>> 0) || 0x9e3779b9; };
  const ir = (o: any) => {
    if (o === null || typeof o !== 'object' || vistos.has(o)) return;
    vistos.add(o);
    if (o instanceof BancoDeLinhas || o instanceof JitterEixo) return;
    if (o instanceof RNG) { o.s = mistura(o.s); return; }
    if (ArrayBuffer.isView(o) || o instanceof ArrayBuffer) return;
    if (Array.isArray(o)) { for (const x of o) ir(x); return; }
    for (const c of Object.keys(o)) ir(o[c]);
  };
  ir(obj);
  return obj;
}

function ambiente(op: Op): Ambiente {
  const a = ['rua', 'hangar'].includes(op.amb) ? ambienteEletrico(op.amb as IdAmbienteEletrico) : ambientePassagem(op.amb as never);
  if (op.solo) a.solo = { tipo: op.solo } as Ambiente['solo'];
  if (op.semFundo) a.fundo = { vento: 0, ventilacao: 0, murmurio: 0 };
  return a;
}

export function render(id: string, op: Op) {
  const p0 = comCampo(preset(id), op.campo);
  const c = prepararMotorEletrico(p0, SR);
  const p = montarPortadorEletrico(c, SR, { faces: 'duas', ladoOuvinte: 1 });
  const liga = (f: Fonte) => (op.so.length ? op.so.includes(f) : !op.sem.includes(f));
  const esc = new Map(op.escala);
  escalar(p, (f) => (liga(f) ? esc.get(f) ?? 1 : 0));
  if (op.semente !== undefined) semearRuido(p, op.semente);
  const d = new CenaDSP(SR); d.cru = true;
  const amb = ambiente(op);
  if (!liga('fundo')) amb.fundo = { vento: 0, ventilacao: 0, murmurio: 0 };
  else if (esc.has('fundo')) { const k = 20 * Math.log10(esc.get('fundo')!); for (const q of ['vento', 'ventilacao', 'murmurio'] as const) if (amb.fundo[q] > 0) amb.fundo[q] += k; }
  if (op.semente !== undefined) semearRuido(d, op.semente + 17);
  const corpo = p.corpo, larg = corpo.segmentos[0]?.largura ?? 2, alt = corpo.segmentos[0]?.altura ?? 2, L = corpo.comprimento;
  const tipo = p0.portador.tipo;
  const traj: Trajetoria = { tipo: op.ouvinte === 'fixo' ? 'reta' : 'volta', comprimento: 20000, raioCurva: 3000, lateral: op.ouvinte === 'fixo' ? op.dist : 3, altitude: tipo === 'drone' ? 10 : 0, sentido: 1 };
  const fMotor = p.fontes().find((f) => (op.alvo ? f.id === op.alvo : /^(motor|tracao)/.test(f.id)));
  let ouv: Ouvinte;
  const base = { modo: 'gimbal' as const, pos: [0, 0, 1.6] as [number, number, number], binaural: false };
  if (op.ouvinte === 'fixo') ouv = { ...base, modo: 'fixo', gimbal: { az: 90, el: 0, r: 5, alvo: 'corpo' }, local: 'fora' };
  else if (op.ouvinte === 'cabine') ouv = { ...base, gimbal: { az: 0, el: 0, r: Math.max(0.3, L / 2 - Math.min(8, L / 4)), alvo: 'corpo' }, local: 'cabine' };
  else if (op.ouvinte === 'cofre') ouv = { ...base, gimbal: { az: 90, el: 0, r: 0.5, alvo: fMotor?.id ?? 'corpo' }, local: 'cofre' };
  else if (op.ouvinte === 'motor' || (op.ouvinte === 'fora' && tipo === 'trem' && fMotor)) {
    // preso ao corpo, ao lado da fonte do motor: x da fonte, a `dist` da lateral, ouvido a 1,6 m do chão
    const x = fMotor ? fMotor.pos[0] : 0, y = larg / 2 + op.dist, z = 1.6 - alt / 2, r = Math.hypot(x, y, z);
    ouv = { ...base, gimbal: { az: (Math.atan2(y, x) * 180) / Math.PI, el: (Math.asin(z / r) * 180) / Math.PI, r, alvo: 'corpo' }, local: 'fora' };
  } else ouv = { ...base, gimbal: { az: 90, el: 0, r: op.dist + larg / 2, alvo: 'corpo' }, local: 'fora' };
  d.message({ type: 'cena', amb, traj, ouv });
  d.montar(p);
  if (op.s0 !== undefined) d.message({ type: 'params', posicao: op.s0 });
  const v = op.kmh / 3.6;
  const cmd: Record<string, unknown> = { pedal: op.pedal, freio: op.freio, ignicao: true, velocidadeFixa: op.livre ? null : v };
  if (tipo === 'bancada') { cmd.cargaFracao = op.carga; cmd.velocidadeFixa = null; }
  if (tipo === 'drone') cmd.velocidadeFixa = v;
  p.comandar(cmd as never);
  const n0 = Math.round(op.descarta * SR), n = Math.round(op.dur * SR);
  const m = new Float32Array(n), l = new Float32Array(B), r = new Float32Array(B), sl = new Float32Array(B), sr = new Float32Array(B);
  const mot = motoresDe(p)[0];
  let sRot = 0, sFe = 0, sFc = 0, cont = 0, vMin = Infinity, vMax = 0;
  for (let i = -n0; i < n; i += B) {
    d.process(l, r, B, sl, sr);
    if (i >= 0) {
      const k = Math.min(B, n - i);
      for (let j = 0; j < k; j++) m[i + j] = 0.5 * (l[j] + r[j]) * PA_FS;
      if (mot) { const t = mot.telemetria() as Record<string, number>; sRot += t.fRot; sFe += t.fE; sFc += t.fC; cont++; }
      const vv = Math.abs(p.cinematica.v) * 3.6; vMin = Math.min(vMin, vv); vMax = Math.max(vMax, vv);
    }
  }
  const fRot = sRot / Math.max(1, cont), fE = sFe / Math.max(1, cont), fC = sFc / Math.max(1, cont);
  let pico = 0, nan = 0, e = 0;
  for (let i = 0; i < n; i++) { if (!Number.isFinite(m[i])) nan++; pico = Math.max(pico, Math.abs(m[i])); e += m[i] * m[i]; }
  const f0 = op.f0 === 'rot' ? fRot : op.f0 === 'ele' ? fE : op.f0 === 'fc' ? fC : +op.f0;
  const t = (mot ? mot.telemetria() : {}) as Record<string, unknown>;
  const info = {
    preset: id, f0: +f0.toFixed(5), fixo: !op.livre && f0 > 0, eventosPorCiclo: 1, voltasPorCiclo: 1,
    fRot: +fRot.toFixed(4), fE: +fE.toFixed(4), fC: +fC.toFixed(2), modo: t.modo, N: t.N, rpm: +(fRot * 60).toFixed(1), torque: t.torque, corrente: t.corrente,
    kmh: +(Math.abs(p.cinematica.v) * 3.6).toFixed(2), kmhMin: +vMin.toFixed(2), kmhMax: +vMax.toFixed(2), pedal: op.pedal, freio: op.freio, carga: op.carga,
    ouvinte: op.ouvinte, dist: op.dist, amb: op.amb, solo: amb.solo.tipo, fundo: amb.fundo, sem: op.sem, so: op.so, escala: op.escala, semente: op.semente ?? null,
    nivelDb: +(10 * Math.log10(e / n / 4e-10 + 1e-30)).toFixed(2), picoPa: +pico.toFixed(4), nan, campo: op.campo, sr: SR, dur: op.dur, fontes: p.fontes().length,
  };
  return { m, info, p };
}

/** WAV mono float 32 (em Pa: o kit normaliza pela banda âncora) */
export function gravarMono(arq: string, x: Float32Array, sr = SR) {
  const dados = x.length * 4, buf = Buffer.alloc(58 + dados);
  buf.write('RIFF', 0); buf.writeUInt32LE(50 + dados, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(18, 16); buf.writeUInt16LE(3, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(32, 34); buf.writeUInt16LE(0, 36);
  buf.write('fact', 38); buf.writeUInt32LE(4, 42); buf.writeUInt32LE(x.length, 46);
  buf.write('data', 50); buf.writeUInt32LE(dados, 54);
  Buffer.from(x.buffer, x.byteOffset, dados).copy(buf, 58);
  fs.writeFileSync(arq, buf);
}

function salvar(arq: string, r: { m: Float32Array; info: Record<string, unknown> }) {
  gravarMono(arq, r.m);
  fs.writeFileSync(arq.replace(/\.wav$/, '.json'), JSON.stringify(r.info, null, 1));
  const i = r.info as Record<string, any>;
  console.log(`${path.basename(arq)}: ${i.kmh} km/h, ${i.rpm} rpm, f_e ${i.fE} Hz, f_c ${i.fC} Hz (${i.modo}), ${i.nivelDb} dB SPL, pico ${i.picoPa} Pa${i.nan ? `, ${i.nan} NaN` : ''}${i.so.length ? `, só ${i.so.join('+')}` : ''}${i.sem.length ? `, sem ${i.sem.join('+')}` : ''}`);
}

if (process.argv[1] && process.argv[1].endsWith('eletrico-fontes.ts')) {
  const a = process.argv.slice(2);
  const BOOL = ['--cada', '--livre', '--sem-fundo'];
  const pos = a.filter((x, i) => !x.startsWith('--') && !(i > 0 && a[i - 1].startsWith('--') && !BOOL.includes(a[i - 1])));
  const val = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const tem = (k: string) => a.includes(k);
  const num = (k: string, d: number) => (val(k) !== undefined ? +val(k)! : d);
  const [id, saida] = pos;
  if (!id || !saida) { console.error('uso: tsx tools/eletrico-fontes.ts <preset> <saida.wav | pasta/ --cada> [--kmh V] [--livre] [--pedal x] [--freio x] [--carga x] [--ouvinte fora|cabine|cofre|motor|fixo] [--dist m] [--alvo id] [--s0 m] [--amb a] [--solo t] [--sem-fundo] [--dur s] [--descarta s] [--campo JSON] [--sem a,b] [--so a,b] [--escala a=g] [--semente N] [--f0 Hz|rot|ele|fc] [--rotulo nome]'); process.exit(2); }
  const lista = (k: string) => (val(k) || '').split(',').filter(Boolean);
  const op: Op = {
    ...OP_PADRAO, kmh: num('--kmh', 0), livre: tem('--livre'), pedal: num('--pedal', 0), freio: num('--freio', 0), carga: num('--carga', 0),
    ouvinte: (val('--ouvinte') || 'fora') as Op['ouvinte'], dist: num('--dist', 7.5), alvo: val('--alvo'), s0: val('--s0') !== undefined ? +val('--s0')! : undefined,
    amb: val('--amb') || 'ceu', solo: val('--solo'), semFundo: tem('--sem-fundo'), dur: num('--dur', 10), descarta: num('--descarta', 3), campo: JSON.parse(val('--campo') || '{}'),
    sem: lista('--sem'), so: lista('--so'), escala: lista('--escala').map((kv) => { const [k, v] = kv.split('='); return [k, +v] as [string, number]; }),
    semente: val('--semente') !== undefined ? +val('--semente')! : undefined, f0: val('--f0') || 'rot',
  };
  for (const f of [...op.sem, ...op.so, ...op.escala.map((x) => x[0])]) if (!(FONTES as readonly string[]).includes(f)) { console.error(`fonte desconhecida: ${f} (${FONTES.join(', ')})`); process.exit(2); }
  if (tem('--cada')) {
    fs.mkdirSync(saida, { recursive: true });
    const rot = val('--rotulo') || `${Math.round(op.kmh)}kmh-p${Math.round(op.pedal * 100)}_${op.ouvinte}`;
    const base = path.join(saida, `${id}_${rot}`);
    const tudo = render(id, op);
    salvar(`${base}_tudo.wav`, tudo);
    for (const f of FONTES) {
      if (op.sem.includes(f)) continue;
      const r = render(id, { ...op, so: [f] });
      if (r.info.picoPa === 0) continue;   // o preset não tem essa fonte nesta condição
      r.info.f0 = tudo.info.f0;
      salvar(`${base}_so-${f}.wav`, r);
    }
    const s2 = render(id, { ...op, semente: 987654321 }); s2.info.f0 = tudo.info.f0;
    salvar(`${base}_semente2.wav`, s2);
  } else {
    fs.mkdirSync(path.dirname(path.resolve(saida)), { recursive: true });
    salvar(saida, render(id, op));
  }
}
