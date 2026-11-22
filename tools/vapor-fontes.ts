// Renderiza um preset do Vapor numa condição casada com uma gravação, para o kit ouvido (tools/ouvido), e grava o
// conjunto do orçamento de ruído: o mesmo render com uma fonte desligada de cada vez, com a MESMA semente (nos moldes de
// tools/rotativo-fontes.ts e tools/diesel-fontes.ts). A calibração é a da página (a sonda de nível, feita antes de
// desligar qualquer coisa): o nível de cada fonte é o que se ouve no navegador.
//
//   npx tsx tools/vapor-fontes.ts <preset> <saida.wav> [opções]
//   npx tsx tools/vapor-fontes.ts <preset> <pasta/> --cada [opções]   (<pasta>/<preset>_<cond>_tudo.wav, _sem-<fonte>.wav, _semente2.wav)
//
// Condição (uma delas):
//   --chuffs N         velocidade imposta que dá N chuffs/s (padrão 4)        --kmh V   ou a velocidade em km/h
//   --parada           parada, com os auxiliares no automático (bomba de ar carregando, injetor, soprador)
//   --patinagem        a arrancada do teste: 500 t no trilho molhado a 4 chuffs/s, regulador 0,3 → `--reg` (padrão 1) em
//                      1 s, e o maquinista fecha 1 s depois do início do surto (grava desde 0 s; --areia: a mesma com areia)
//   --lenta            o portador de uso real em lenta: trator com a embreagem solta, estacionária no governador
//   --corte c          corte da admissão, fração do curso (padrão 0,5)        --reg r   regulador 0..1 (padrão 1)
//   --aux              deixa bomba de ar, injetor, torneiras e soprador no automático (padrão: desligados, como nos testes)
// Escuta:
//   (padrão)           de perto: a soma dos canais do VaporDSP, Pa a 7,5 m em campo livre (0 dBFS = 124 dB SPL): é o
//                      "de perto" dos testes (tools/vapor-valida.ts) e o motor sozinho, sem rolamento nem chão
//   --cena D           pela Cena, como a página toca: locomotiva + tênder (+ --vagoes n), ouvinte andando junto a D m de
//                      lado (o padrão da página é 10), solo de brita; grava estéreo. --ambiente ceu|corte|estacao|tunel|ponte,
//                      --reverb soma a reverberação do ambiente, --fundo liga o som de fundo (vento)
//   --passagem D       pela Cena, ouvinte parado a D m da via; a composição passa por ele no meio do render
// Render:
//   --dur s            segundos gravados (padrão 12)      --descarta s   jogados fora antes (padrão 2)
//   --campo JSON       muda campos do preset antes da sonda (`escape` e `cilindros` são fundidos com os do preset)
//   --sem a,b          desliga fontes (lista abaixo)      --escala a=g,b=g   multiplica o ganho de fontes
//   --semente N        outra semente em todos os geradores de ruído (depois da sonda, como tools/desvios.ts)
//   --cada             grava o conjunto do orçamento; `--fontes a,b` restringe as fontes isoladas (padrão: as que soam na
//                      condição); `--grupos a+b,c+d` troca os renders com várias desligadas juntas (padrão: tiragem+vazamentos)
//
// Fontes (desligar zera o ganho sem pular as chamadas dos geradores de ruído):
//   hoot        turbulência do jato na saia da chaminé: o ruído que a chaminé ressoa             ENTRA NA REDE
//   variacao    sorteio de chuff para chuff (água arrastada, pressão na caixa de válvulas)        ENTRA NA REDE
//   mistura     ruído de mistura do jato do bico (Strouhal), preso a cada descarga               soma na saída
//   choque      ruído de choque do jato engasgado                                                soma na saída
//   portico     jato na fresta do pórtico de escape ao abrir: o ataque de cada chuff               soma na saída
//   tiragem     sopro do escoamento na chaminé, preso à coluna de gás que cada chuff puxa        soma na saída
//   cauda       o ruído do jato que fica na caixa de fumaça (cavidade) e sai depois da descarga   soma na saída
//   vazamentos  gaxetas e juntas (canais dos cilindros)                                          soma na saída
//   torneiras   torneiras de purga dos cilindros                                                 soma na saída
//   bielas      folga das bielas e rolar                                                         soma na saída
//   bomba, ejetor, injetor, soprador, seguranca, apito, sino, engrenagens, correias, queimador    somam na saída
//   rolamento   (só com --cena/--passagem) rodas da locomotiva, do tênder e dos vagões            soma na saída
//   ar          tudo o que o controle "Ar" da página multiplica (mixAr = 0)                       (grupo)
// O que sobra com todas desligadas é o pulso: a vazão de cada descarga pela rede bico → caixa de fumaça → chaminé.
// No kit o ciclo é a volta de roda: f0 = chuffs/s ÷ escapes por volta (o .json ao lado do WAV leva f0 e os escapes).
import fs from 'node:fs';
import path from 'node:path';
import { VaporDSP } from '../src/engines/vapor/dsp';
import { presetVapor, escapesPorVolta, type PresetVapor } from '../src/engines/vapor/presets';
import { prepararMotorVapor } from '../src/engines/vapor/motor';
import { LocomotivaVapor, CargaTremVapor, configLocoVapor } from '../src/carriers/locomotiva-vapor';
import { Trator, configTrator } from '../src/carriers/trator';
import { Gerador } from '../src/carriers/gerador';
import { configPortadorVapor } from '../src/carriers/portadores-vapor';
import { renderPassagem } from './cena/render-passagem';
import { semear } from './desvios';
import { gravarWav } from './wav';

const SR = 48000, B = 128, TAU = Math.PI * 2;
/** Pa de 0 dBFS (124 dB SPL): a escala absoluta da Cena */
const PA_FS = 2e-5 * Math.pow(10, 124 / 20);
export const FONTES = ['hoot', 'variacao', 'mistura', 'choque', 'portico', 'tiragem', 'cauda', 'vazamentos', 'torneiras', 'bielas', 'bomba', 'injetor', 'soprador', 'seguranca', 'apito', 'sino', 'engrenagens', 'correias', 'queimador', 'rolamento'] as const;
export const NA_REDE = ['hoot', 'variacao'];
const MASCARA = ['vazamentos', 'torneiras', 'bielas', 'bomba', 'injetor', 'soprador', 'ejetor', 'seguranca', 'apito', 'sino', 'engrenagens', 'correias', 'queimador'];

/** multiplica o ganho de uma fonte (0 = desliga) depois da sonda de nível */
export function escalar(d: any, f: string, g: number, portador?: any) {
  if (MASCARA.includes(f)) { d.mascara[f] *= g; return; }
  switch (f) {
    case 'hoot': d.rede.sigmaTurb *= g; break;
    case 'variacao': if (g === 0) { const r = d.rng, gs = r.gauss.bind(r); r.gauss = () => { gs(); return 0; }; } break;
    case 'mistura': d.jato.gMistura *= g; break;
    case 'choque': d.jato.gChoque *= g; break;
    case 'tiragem': d.gTiragem *= g; break;
    case 'cauda': d.caixa.ganho *= g; break;
    case 'portico': d.gPortico *= g; break;
    case 'ar': d.mixAr *= g; break;
    case 'rolamento': if (portador) for (const r of [...(portador.rodas?.length != null ? portador.rodas : portador.rodas ? [portador.rodas] : []), ...(portador.vaos || [])]) { const p = r.preencher.bind(r); r.preencher = (o: Float32Array, n: number) => { p(o, n); for (let i = 0; i < n; i++) o[i] *= g; }; } break;
    default: throw new Error(`fonte desconhecida: ${f} (${[...FONTES, 'ar'].join(', ')})`);
  }
}

export type Op = {
  modo: 'fixo' | 'parada' | 'patinagem' | 'lenta'; chuffs?: number; kmh?: number; corte: number; reg: number; aux: boolean; areia: boolean;
  cena?: number; passagem?: number; ambiente: string; reverb: boolean; fundo: boolean; vagoes: number;
  dur: number; descarta: number; campo: any; sem: string[]; escala: [string, number][]; semente?: number;
};
export const OP_PADRAO: Op = { modo: 'fixo', corte: 0.5, reg: 1, aux: false, areia: false, ambiente: 'ceu', reverb: false, fundo: false, vagoes: 0, dur: 12, descarta: 2, campo: {}, sem: [], escala: [] };

function specDe(id: string, campo: any): PresetVapor {
  const p = presetVapor(id);
  if (!p) throw new Error(`preset ${id} não existe`);
  const c = { ...campo };
  if (c.escape) c.escape = { ...p.escape, ...c.escape };
  if (c.cilindros) c.cilindros = { ...p.cilindros, ...c.cilindros };
  return { ...p, ...c } as PresetVapor;
}

const cfgs = new Map<string, any>();
function novo(P: PresetVapor, op: Op, fixa: boolean) {
  const chave = JSON.stringify(P);
  if (!cfgs.has(chave)) cfgs.set(chave, prepararMotorVapor(P, SR));
  const c = cfgs.get(chave);
  const d = new VaporDSP(SR);
  d.configurar({ ...c, preset: { ...c.preset, ...(fixa ? { kCaldeira: 1e-12 } : {}) } }, SR);
  return d;
}
/** desliga, escala e semeia: depois de montar o motor e o portador (a sonda já rodou) */
function preparar(d: any, op: Op, portador?: any) {
  for (const f of op.sem) escalar(d, f, 0, portador);
  for (const [f, g] of op.escala) escalar(d, f, g, portador);
  if (op.semente !== undefined) { semear(d, op.semente); if (portador) semear(portador, op.semente); }
}

export function render(id: string, op: Op) {
  const P = specDe(id, op.campo), esc = escapesPorVolta(P);
  const n0 = Math.round(op.descarta * SR), n = Math.round(op.dur * SR);
  let L = new Float32Array(n), R: Float32Array | null = null;
  const cmd0: any = op.aux ? {} : { bombaAr: false, injetor: false, torneiras: false, soprador: false };
  const cutoff = (op.corte - 0.15) / 0.7;
  let chuffs = op.chuffs ?? (op.kmh != null ? ((op.kmh / 3.6) / (P.dRoda / 2) / TAU) * esc : 4);
  const info: any = { preset: id, modo: op.modo, corte: op.corte, regulador: op.reg };
  const somar = (canais: Float32Array[], i: number, k: number) => { for (let q = 0; q < k; q++) { let s = 0; for (let c = 0; c < canais.length; c++) s += canais[c][q]; L[i + q] = s / PA_FS; } };

  if (op.modo === 'lenta') {
    // o portador de uso real em lenta: trator com a embreagem solta; estacionária no governador com meia carga
    const d = novo(P, op, false);
    const p: any = P.familia === 'trator' ? new Trator(SR, configTrator(P)) : new Gerador(SR, configPortadorVapor('gerador', id, 0));
    p.acoplar(d); preparar(d, op, p);
    p.comandar(P.familia === 'trator' ? { pedal: 0, marcha: 0 } : { pedal: 0, cargaFracao: 0.5 });
    const can = p.fontes().map(() => new Float32Array(B));
    let somaF = 0, cont = 0;
    for (let i = -n0; i < n; i += B) {
      p.processar(can, B, 1 / SR);
      if (i >= 0) { somar(can, i, Math.min(B, n - i)); somaF += (Math.abs(d.eixo.omega) * d.reducao) / TAU; cont++; }
    }
    const fMan = somaF / cont;
    Object.assign(info, { f0: +fMan.toFixed(4), fixo: false, eventosPorCiclo: 2 * P.cilindros.n, chuffs: +(2 * P.cilindros.n * fMan).toFixed(3), rpmManivela: +(60 * fMan).toFixed(1) });
  } else if (op.modo === 'patinagem') {
    // a arrancada de tools/vapor-valida.ts (grupo patinagem), desde 0 s
    const d = novo(P, op, false);
    d.comandar({ acelerador: 0, ignicao: true, partida: false, bombaAr: false, injetor: false, torneiras: false, soprador: false } as any);
    d.fixar({ regulador: 0.3, cutoff: (0.8 - 0.15) / 0.7 }); d.pChest = d.pCal * 1e5 + 101325;
    d.acoplar(new CargaTremVapor(500, P.dRoda / 2, 10));
    d.wTrem = TAU; for (let k = 0; k < d.nM; k++) d.wM[k] = TAU;
    d.comandar({ acelerador: 0, ignicao: true, partida: false, trilho: 'molhado', areia: op.areia } as any);
    preparar(d, op);
    let surto = -1, fechou = -1, volta = -1, t = 0;
    const linha: any[] = [];
    d.tap = (x) => {
      t++;
      if (t === SR) x.fixar({ regulador: op.reg });
      if (x.patM[0] && surto < 0) surto = t;
      if (surto > 0 && fechou < 0 && t - surto >= SR) { fechou = t; x.fixar({ regulador: 0 }); }
      if (fechou > 0 && volta < 0 && !x.patM[0]) volta = t;
      if (t % 2400 === 0) linha.push({ t: +(t / SR).toFixed(2), chuffs: +x.chuffsPorS().toFixed(2), pChest: +((x.pChest - 101325) / 1e5).toFixed(2), pat: x.patM[0] });
    };
    const can = d.fontes.map(() => new Float32Array(B));
    for (let i = 0; i < n; i += B) { d.processar(can, B); somar(can, i, Math.min(B, n - i)); }
    Object.assign(info, { surto: surto / SR, fechou: fechou / SR, readere: volta / SR, linha, f0: 1, fixo: false, eventosPorCiclo: esc });
  } else if (op.cena != null || op.passagem != null) {
    // pela Cena, como a página: ouvinte andando junto (gimbal de lado, nos cilindros) ou parado junto à via
    const d = novo(P, op, true);
    d.comandar({ acelerador: 0, ignicao: true, partida: false, ...cmd0 } as any);
    d.fixar({ regulador: op.modo === 'parada' ? 0 : op.reg, cutoff }); d.pChest = d.pCal * 1e5 + 101325;
    const p = new LocomotivaVapor(SR, configLocoVapor(P, { vagoes: op.vagoes }), d.fontes.length);
    p.acoplar(d);
    p.comandar({ pedal: 0, regulador: op.modo === 'parada' ? 0 : op.reg, cutoff, ...cmd0 } as any);
    preparar(d, op, p);
    if (op.modo === 'parada') chuffs = 0;
    const v = (chuffs / esc) * TAU * (P.dRoda / 2);
    const dist = (op.cena ?? op.passagem)!, tot = op.descarta + op.dur;
    const el = (Math.asin(Math.min(1, 1 / dist)) * 180) / Math.PI;
    const r = renderPassagem({
      portadorPronto: p, v, d: dist, ambiente: op.ambiente as any, solo: 'brita', dur: tot, reverb: op.reverb, semFundo: !op.fundo,
      sCentro0: op.passagem != null ? -v * (op.descarta + op.dur / 2) - p.xLoco : 0, comprimentoVia: 20000,
      ouvinte: op.cena != null ? { modo: 'gimbal', gimbal: { az: 90, el, r: dist, alvo: 'cilindro.e' } } : {},
    });
    L = new Float32Array(n); R = new Float32Array(n);
    for (let i = 0; i < n; i++) { L[i] = r.L[n0 + i]; R[i] = r.R[n0 + i]; }
    Object.assign(info, { chuffs: +chuffs.toFixed(3), kmh: +(v * 3.6).toFixed(1), f0: +(chuffs / esc).toFixed(5), fixo: op.cena != null, eventosPorCiclo: esc, distancia: dist, escuta: op.cena != null ? 'cena' : 'passagem', ambiente: op.ambiente, reverb: op.reverb, fundo: op.fundo, vagoes: op.vagoes, fontes: r.nFontes });
  } else {
    // de perto: a soma dos canais do VaporDSP a 7,5 m
    const parada = op.modo === 'parada';
    const d = novo(P, op, !parada);
    d.comandar({ acelerador: 0, ignicao: true, partida: false, ...(parada ? {} : cmd0) } as any);
    if (parada) d.fixar({ regulador: 0 });
    else { d.fixar({ regulador: op.reg, cutoff }); d.pChest = d.pCal * 1e5 + 101325; d.impor((chuffs / esc) * TAU); }
    preparar(d, op);
    const can = d.fontes.map(() => new Float32Array(B));
    for (let i = -n0; i < n; i += B) { d.processar(can, B); if (i >= 0) somar(can, i, Math.min(B, n - i)); }
    const tl = d.telemetria();
    if (parada) Object.assign(info, { f0: null, fixo: false, eventosPorCiclo: esc, bomba: tl.bombaAr, injetor: tl.injetor, soprador: tl.soprador });
    else Object.assign(info, { chuffs: +chuffs.toFixed(3), kmh: +(((chuffs / esc) * TAU * (P.dRoda / 2)) * 3.6).toFixed(1), f0: +(chuffs / esc).toFixed(5), fixo: true, eventosPorCiclo: esc, pRelBar: +tl.pRelease.toFixed(2), engasgado: tl.engasgado, vaporKgS: +tl.consumoCilindros!.toString().slice(0, 6) });
    info.escuta = 'perto';
  }
  let pico = 0, nan = 0, e = 0;
  for (let i = 0; i < n; i++) { const x = R ? 0.5 * (L[i] + R[i]) : L[i]; if (!Number.isFinite(x)) nan++; pico = Math.max(pico, Math.abs(L[i]), R ? Math.abs(R[i]) : 0); e += x * x; }
  Object.assign(info, { sem: op.sem, escala: op.escala, semente: op.semente ?? null, pico: +pico.toFixed(4), picoDbFs: +(20 * Math.log10(pico + 1e-12)).toFixed(1), rmsDbSpl: +(124 + 10 * Math.log10(e / n + 1e-20)).toFixed(1), nan, campo: op.campo, sr: SR, dur: op.dur });
  return { L, R, info };
}

/** WAV mono float 32 */
export function gravarMono(arq: string, x: Float32Array, sr = SR) {
  const dados = x.length * 4, buf = Buffer.alloc(58 + dados);
  buf.write('RIFF', 0); buf.writeUInt32LE(50 + dados, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(18, 16); buf.writeUInt16LE(3, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(32, 34); buf.writeUInt16LE(0, 36);
  buf.write('fact', 38); buf.writeUInt32LE(4, 42); buf.writeUInt32LE(x.length, 46);
  buf.write('data', 50); buf.writeUInt32LE(dados, 54);
  Buffer.from(x.buffer, x.byteOffset, dados).copy(buf, 58);
  fs.writeFileSync(arq, buf);
}

function salvar(arq: string, r: ReturnType<typeof render>) {
  if (r.R) gravarWav(arq, r.L, r.R, SR); else gravarMono(arq, r.L);
  fs.writeFileSync(arq.replace(/\.wav$/, '.json'), JSON.stringify(r.info, null, 1));
  const i = r.info;
  console.log(`${arq}: ${i.modo}${i.chuffs != null ? ` ${i.chuffs} chuffs/s` : ''}${i.kmh != null ? ` (${i.kmh} km/h)` : ''}, corte ${i.corte}, regulador ${i.regulador}, ${i.escuta ?? 'perto'}, ${i.rmsDbSpl} dB SPL, pico ${i.picoDbFs} dBFS${i.nan ? `, ${i.nan} NaN` : ''}${i.sem.length ? `, sem ${i.sem.join('+')}` : ''}`);
}

/** as fontes que existem e soam na condição (as outras dariam arquivos idênticos ao completo) */
function fontesDaCondicao(P: PresetVapor, op: Op) {
  const andando = op.modo !== 'parada';
  const f: string[] = [];
  if (andando) f.push('hoot', 'variacao', 'mistura', 'choque', 'portico', 'tiragem', 'cauda', 'bielas');
  f.push('vazamentos');
  if (op.aux || op.modo === 'parada') { if (P.bombaAr) f.push('bomba'); if (P.ejetor) f.push('ejetor'); f.push('injetor', 'soprador', 'torneiras'); }
  if (P.engrenagens && andando) f.push('engrenagens');
  if (P.correias && andando) f.push('correias');
  if (P.queimador) f.push('queimador');
  if (op.cena != null || op.passagem != null) f.push('rolamento');
  return f;
}

if (process.argv[1] && process.argv[1].endsWith('vapor-fontes.ts')) {
  const a = process.argv.slice(2);
  const BOOL = ['--parada', '--patinagem', '--lenta', '--aux', '--areia', '--reverb', '--fundo', '--cada'];
  const pos = a.filter((x, i) => !x.startsWith('--') && !(i > 0 && a[i - 1].startsWith('--') && !BOOL.includes(a[i - 1])));
  const val = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const num = (k: string) => (val(k) !== undefined ? +val(k)! : undefined);
  const tem = (k: string) => a.includes(k);
  const [id, saida] = pos;
  if (!id || !saida) { console.error('uso: tsx tools/vapor-fontes.ts <preset> <saida.wav | pasta/ --cada> [--chuffs N | --kmh V | --parada | --patinagem [--areia] | --lenta] [--corte c] [--reg r] [--aux] [--cena D | --passagem D] [--ambiente ceu] [--reverb] [--fundo] [--vagoes n] [--dur s] [--descarta s] [--campo JSON] [--sem a,b] [--escala a=g] [--semente N] [--fontes a,b] [--grupos a+b,c+d] [--rotulo nome]'); process.exit(2); }
  const modo: Op['modo'] = tem('--parada') ? 'parada' : tem('--patinagem') ? 'patinagem' : tem('--lenta') ? 'lenta' : 'fixo';
  const op: Op = {
    ...OP_PADRAO, modo, chuffs: num('--chuffs'), kmh: num('--kmh'), corte: num('--corte') ?? 0.5, reg: num('--reg') ?? 1, aux: tem('--aux'), areia: tem('--areia'),
    cena: num('--cena'), passagem: num('--passagem'), ambiente: val('--ambiente') || 'ceu', reverb: tem('--reverb'), fundo: tem('--fundo'), vagoes: num('--vagoes') ?? 0,
    dur: num('--dur') ?? 12, descarta: num('--descarta') ?? (modo === 'patinagem' ? 0 : modo === 'lenta' ? 20 : 2), campo: JSON.parse(val('--campo') || '{}'),
    sem: (val('--sem') || '').split(',').filter(Boolean),
    escala: (val('--escala') || '').split(',').filter(Boolean).map((kv) => { const [k, v] = kv.split('='); return [k, +v] as [string, number]; }),
    semente: num('--semente'),
  };
  if (tem('--cada')) {
    fs.mkdirSync(saida, { recursive: true });
    const P = specDe(id, op.campo);
    const cond = (val('--rotulo') ? `${val('--rotulo')}-` : '') + (modo === 'fixo' ? `${op.chuffs != null ? `${op.chuffs}cs` : op.kmh != null ? `${op.kmh}kmh` : '4cs'}-c${Math.round(op.corte * 100)}` : modo) + (op.cena != null ? `-cena${op.cena}` : op.passagem != null ? `-pass${op.passagem}` : '');
    const base = path.join(saida, `${id}_${cond}`);
    salvar(`${base}_tudo.wav`, render(id, op));
    const quais = val('--fontes') ? val('--fontes')!.split(',') : fontesDaCondicao(P, op);
    for (const f of quais) salvar(`${base}_sem-${f}.wav`, render(id, { ...op, sem: [...op.sem, f] }));
    for (const g of (val('--grupos') || (modo === 'parada' ? '' : 'tiragem+vazamentos')).split(',').filter(Boolean)) salvar(`${base}_sem-${g}.wav`, render(id, { ...op, sem: [...op.sem, ...g.split('+')] }));
    if (modo === 'fixo') salvar(`${base}_semente2.wav`, render(id, { ...op, semente: 987654321 }));
    console.log(`fontes que entram na rede (vale o efeito de desligar): --na-rede ${NA_REDE.join(',')}`);
  } else {
    fs.mkdirSync(path.dirname(path.resolve(saida)), { recursive: true });
    salvar(saida, render(id, op));
  }
}
