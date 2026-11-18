// Renderiza um preset do Ronco numa condição casada com uma gravação, para o kit ouvido: giro travado (como o
// tools/analise-som/render.js: em neutro, com o pedal que zera o torque líquido, ou com pedal fixo), lenta livre ou
// partida a frio. Grava WAV mono float 32 a 48 kHz e, ao lado, um .json com a rotação e o f0 do ciclo (o
// tools/ouvido/comparar.py lê esse .json sozinho). Também grava o conjunto do orçamento de ruído: o mesmo render com
// uma fonte desligada de cada vez, com a MESMA semente.
//
//   npx tsx tools/ouvido/render.ts <preset> <saida.wav> [opções]
//   npx tsx tools/ouvido/render.ts <preset> <pasta/> --cada [opções]     (orçamento: <pasta>/<preset>_<cond>_tudo.wav, _sem-<fonte>.wav, _semente2.wav)
//
//   --rpm R            giro travado em R rpm, em neutro, com o pedal que zera o torque líquido (segurar o pedal parado)
//   --pedal x          com --rpm: pedal fixo de 0 a 1 em vez do que zera o torque (1 = plena carga travada)
//   --lenta            lenta livre e quente (padrão quando não há --rpm): o giro caça como no navegador
//   --frio T           partida a frio de verdade a T °C (lenta acelerada, centelha atrasada); grava depois de pegar.
//                      Com --rpm: giro travado com a água fixa em T e o motor recém-ligado (o estado frio na rotação da gravação)
//   --dur s            segundos gravados (padrão 12)        --descarta s   segundos jogados fora antes (padrão 3; 8 na lenta e no frio)
//   --ouvinte ext|pipe|int|bay     posição (padrão ext: atrás do carro)      --canal media|e|d   (padrão media)
//   --ambiente         deixa o som de ambiente ligado (padrão: desligado, para comparar o motor sozinho)
//   --campo '{"muffler":"straight"}'   muda campos do preset antes de montar
//   --sem a,b          desliga fontes (lista abaixo)        --escala jato=4,chiadoAdm=30   multiplica o ganho de fontes
//   --semente N        semente do gerador de ruído (padrão: a do DSP)
//   --cada             grava o conjunto do orçamento
//
// Fontes (desligar zera o ganho sem pular as chamadas do gerador de ruído: a semente segue igual e a diferença para o
// render completo é a contribuição da fonte):
//   jato        chiado do gás na ponteira (segue a velocidade de cada pulso)            soma na saída
//   vazamento   rajada que vaza pelo coletor e juntas (escapes 'old' e 'leaky')         soma na saída
//   chiadoAdm   chiado do ar na borboleta                                               soma na saída
//   admissao    pulso grave da admissão (determinístico)                                soma na saída
//   mecanica    válvulas, batida, engrenagens, ventoinha e vibração do bloco            soma na saída
//   compressor  uivo e chiado do compressor mecânico                                    soma na saída
//   chiadoTurbo chiado do turbo (o apito tonal não tem ganho próprio no DSP e fica)     soma na saída
//   valvula     jato na abertura da válvula de escape (ruído dentro do tubo)            ENTRA NA REDE: muda a trajetória
//   variacao    variação da queima de ciclo para ciclo e falhas do carburador           ENTRA NA REDE
//   ar          todo o ruído aerodinâmico de uma vez (params.air = 0)                   (grupo)
// A saída passa por um tanh suave: a soma é exata só em nível baixo; o orcamento.py confere e avisa.
import fs from 'node:fs';
import path from 'node:path';
import { EngineDSP } from '../../src/engines/ronco/dsp';
import { PRESETS, ACESSORIOS_PADRAO } from '../../src/engines/ronco/presets';
import { montarConfig } from '../../src/engines/ronco/config';

const SR = 48000, B = 128;
export const FONTES = ['jato', 'vazamento', 'chiadoAdm', 'admissao', 'mecanica', 'compressor', 'chiadoTurbo', 'valvula', 'variacao'] as const;
type Fonte = (typeof FONTES)[number] | 'ar';
const NA_REDE = ['valvula', 'variacao'];

// multiplica o ganho de uma fonte (0 = desliga) depois do setConfig: a calibração já foi feita com tudo ligado
function escalar(d: any, f: string, g: number) {
  switch (f) {
    case 'jato': d.jetGain *= g; break;
    case 'vazamento': d.brkK *= g; break;
    case 'chiadoAdm': d.hissGain *= g; break;
    case 'admissao': d.inGain *= g; break;
    case 'mecanica': d.params.mech *= g; break;
    case 'compressor': d.scGain *= g; break;
    // (o turbo não tem um ganho só no DSP: aqui só o chiado, escalando o filtro dele; o apito tonal fica)
    case 'chiadoTurbo': { const t = d.turboHiss; if (t) { t.b0 *= g; t.b1 *= g; t.b2 *= g; } break; }
    case 'valvula': d.valveNoise *= g; break;
    case 'variacao': d.varScale *= g; d.carbVar *= g; d.carbMis *= g; break;
    case 'ar': d.params.air *= g; break;
    default: throw new Error(`fonte desconhecida: ${f} (${[...FONTES, 'ar'].join(', ')})`);
  }
}

type Op = { rpm?: number; pedal?: number; frio?: number; dur: number; descarta?: number; ouvinte: string; canal: string; ambiente: boolean; campo: any; sem: string[]; escala: [string, number][]; semente?: number };

function preset(id: string, campo: any) {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`preset desconhecido: ${id}`);
  return { ...ACESSORIOS_PADRAO, ...p, ...campo } as any;
}

function novo(cfg: any, op: Op) {
  const d: any = new EngineDSP(SR);
  d.params.listener = op.ouvinte;
  d.params.ambSound = op.ambiente;
  d.setConfig(cfg);
  for (const f of op.sem) escalar(d, f, 0);
  for (const [f, g] of op.escala) escalar(d, f, g);
  if (op.semente !== undefined) d.rng.s = op.semente >>> 0 || 1;
  return d;
}

export function render(id: string, op: Op) {
  const spec = preset(id, op.campo);
  const cfg = montarConfig(spec);
  const l = new Float32Array(B), r = new Float32Array(B);
  let d: any, pedal = NaN, modo: string;
  if (op.rpm) {
    // giro travado; o integrador do controle de lenta fica congelado (REVISAO-DE-SOM, Armadilhas). Quente por padrão;
    // com --frio T, a água fica fixa em T e o motor "acabou de pegar" (20 s): centelha atrasada, mecânica fria
    const frio = op.frio;
    const mk = (thr: number) => {
      const x = novo(cfg, op);
      if (frio !== undefined) { x.ambientT = frio; x.tempMode = 'fixed'; x.tempSet = frio; x.coolant = frio; x.exhT = 250; x.runT = 20; }
      else { x.tempMode = 'fixed'; x.tempSet = 90; x.coolant = 90; x.exhT = 450; x.runT = 60; }
      x.state = 'run'; x.lockOmega = true; x.KI = 0; x.omega = (op.rpm! * 2 * Math.PI) / 60; x.rpmAvg = op.rpm; x.thrTarget = thr; x.thr = thr;
      return x;
    };
    if (op.pedal !== undefined) pedal = op.pedal;
    else {
      let lo = 0, hi = 0.6;
      for (let it = 0; it < 14; it++) {
        pedal = 0.5 * (lo + hi);
        const x = mk(pedal);
        for (let i = 0; i < 0.8 * SR; i += B) x.process(l, r, B);
        if (x.tqMean > 0) hi = pedal; else lo = pedal;
      }
    }
    d = mk(pedal); modo = frio !== undefined ? 'travado frio' : 'travado';
  } else {
    d = novo(cfg, op);
    if (op.frio !== undefined) { d.ambientT = op.frio; d.message({ type: 'input', temp: { mode: 'real', value: op.frio } }); modo = 'frio'; }
    else { d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } }); modo = 'lenta'; }
    d.message({ type: 'input', ignition: true });
  }
  const descarta = op.descarta ?? (modo.startsWith('travado') ? 3 : 8);
  const n0 = Math.round(descarta * SR), n = Math.round(op.dur * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  let somaRpm = 0, cont = 0, rpmMin = Infinity, rpmMax = 0;
  for (let i = -n0; i < n; i += B) {
    d.process(l, r, B);
    if (i >= 0) {
      const k = Math.min(B, n - i);
      L.set(l.subarray(0, k), i); R.set(r.subarray(0, k), i);
      somaRpm += d.rpmAvg; cont++; rpmMin = Math.min(rpmMin, d.rpmAvg); rpmMax = Math.max(rpmMax, d.rpmAvg);
    }
  }
  const m = new Float32Array(n);
  let pico = 0, nan = 0;
  for (let i = 0; i < n; i++) {
    m[i] = op.canal === 'e' ? L[i] : op.canal === 'd' ? R[i] : 0.5 * (L[i] + R[i]);
    if (!Number.isFinite(m[i])) nan++;
    pico = Math.max(pico, Math.abs(m[i]));
  }
  const rpm = somaRpm / Math.max(1, cont);
  const N = cfg.N;
  const info = { preset: id, modo, rpm: +rpm.toFixed(1), rpmMin: +rpmMin.toFixed(1), rpmMax: +rpmMax.toFixed(1), f0: +(rpm / 120).toFixed(4), fixo: modo.startsWith('travado'),
    // (o pedal vai com a precisão inteira: o conjunto do orçamento e os casos fabricados o reusam, e um arredondamento muda a trajetória)
    eventosPorCiclo: N, voltasPorCiclo: 2, pedal: Number.isFinite(pedal) ? pedal : d.thr, coletorBar: +(d.pMan / 101325).toFixed(3), agua: Math.round(d.coolant),
    ouvinte: op.ouvinte, canal: op.canal, ambiente: op.ambiente, sem: op.sem, escala: op.escala, semente: op.semente ?? 12345, ganho: +d.cfgGain.toFixed(4), pico: +pico.toFixed(4), nan, estado: d.state,
    campo: op.campo, sr: SR, dur: op.dur };
  return { m, info };
}

// WAV mono float 32
export function gravarMono(arq: string, x: Float32Array, sr = SR) {
  const dados = x.length * 4, buf = Buffer.alloc(58 + dados);
  buf.write('RIFF', 0); buf.writeUInt32LE(50 + dados, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(18, 16); buf.writeUInt16LE(3, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(32, 34); buf.writeUInt16LE(0, 36);
  buf.write('fact', 38); buf.writeUInt32LE(4, 42); buf.writeUInt32LE(x.length, 46);
  buf.write('data', 50); buf.writeUInt32LE(dados, 54);
  Buffer.from(x.buffer, x.byteOffset, dados).copy(buf, 58);
  fs.writeFileSync(arq, buf);
}

function salvar(arq: string, r: { m: Float32Array; info: any }) {
  gravarMono(arq, r.m);
  fs.writeFileSync(arq.replace(/\.wav$/, '.json'), JSON.stringify(r.info, null, 1));
  const i = r.info;
  console.log(`${arq}: ${i.modo} ${i.rpm} rpm (${i.rpmMin}–${i.rpmMax}), f0 ${i.f0} Hz, pedal ${(+i.pedal).toFixed(4)}, coletor ${i.coletorBar} bar, pico ${i.pico}${i.nan ? `, ${i.nan} NaN` : ''}${i.sem.length ? `, sem ${i.sem.join('+')}` : ''}`);
}

if (process.argv[1] && process.argv[1].endsWith('render.ts')) {
  const a = process.argv.slice(2);
  const pos = a.filter((x, i) => !x.startsWith('--') && !(i > 0 && a[i - 1].startsWith('--') && !['--lenta', '--ambiente', '--cada'].includes(a[i - 1])));
  const val = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const tem = (k: string) => a.includes(k);
  const [id, saida] = pos;
  if (!id || !saida) { console.error('uso: tsx tools/ouvido/render.ts <preset> <saida.wav | pasta/ --cada> [--rpm R [--pedal x] | --lenta | --frio T] [--dur s] [--descarta s] [--ouvinte ext] [--canal media|e|d] [--ambiente] [--campo JSON] [--sem a,b] [--escala a=g,b=g] [--semente N]'); process.exit(2); }
  const op: Op = {
    rpm: val('--rpm') ? +val('--rpm')! : undefined, pedal: val('--pedal') !== undefined ? +val('--pedal')! : undefined, frio: val('--frio') !== undefined ? +val('--frio')! : undefined,
    dur: +(val('--dur') || 12), descarta: val('--descarta') !== undefined ? +val('--descarta')! : undefined, ouvinte: val('--ouvinte') || 'ext', canal: val('--canal') || 'media',
    ambiente: tem('--ambiente'), campo: JSON.parse(val('--campo') || '{}'), sem: (val('--sem') || '').split(',').filter(Boolean),
    escala: (val('--escala') || '').split(',').filter(Boolean).map((kv) => { const [k, v] = kv.split('='); return [k, +v] as [string, number]; }),
    semente: val('--semente') !== undefined ? +val('--semente')! : undefined,
  };
  if (tem('--cada')) {
    fs.mkdirSync(saida, { recursive: true });
    const cond = op.rpm ? `${Math.round(op.rpm)}rpm${op.pedal !== undefined ? `-p${Math.round(op.pedal * 100)}` : ''}${op.frio !== undefined ? '-frio' : ''}` : op.frio !== undefined ? 'frio' : 'lenta';
    const base = path.join(saida, `${id}_${cond}_${op.ouvinte}`);
    const tudo = render(id, op);
    salvar(`${base}_tudo.wav`, tudo);
    // (o pedal que zera o torque é o do render completo: desligar uma fonte não pode mudar a carga)
    const fixo: Op = op.rpm ? { ...op, pedal: tudo.info.pedal } : op;
    for (const f of FONTES) {
      // fontes que o preset não tem ficam de fora
      if (f === 'compressor' && preset(id, op.campo).aspiration !== 'super') continue;
      if (f === 'chiadoTurbo' && preset(id, op.campo).aspiration !== 'turbo') continue;
      if (f === 'vazamento' && !['old', 'leaky'].includes(preset(id, op.campo).breakout)) continue;
      salvar(`${base}_sem-${f}.wav`, render(id, { ...fixo, sem: [...op.sem, f] }));
    }
    salvar(`${base}_semente2.wav`, render(id, { ...fixo, semente: 987654321 }));
    console.log(`fontes que entram na rede de tubos (a diferença não é a fonte; vale a diferença de energia): ${NA_REDE.join(', ')}`);
  } else {
    fs.mkdirSync(path.dirname(path.resolve(saida)), { recursive: true });
    salvar(saida, render(id, op));
  }
}
