// Renderiza um preset do Diesel numa condição casada com uma gravação, para o kit ouvido (tools/ouvido/): o análogo
// do tools/ouvido/render.ts para o DieselDSP. Grava WAV mono float 32 a 48 kHz e, ao lado, um .json com a rotação e
// o f0 do ciclo (o comparar.py e o orcamento.py leem esse .json sozinhos). Com --cada grava o conjunto do orçamento
// de ruído: o mesmo render com uma fonte desligada de cada vez, com a MESMA semente, mais os grupos `ar` e `turbo` e
// uma segunda semente.
//
//   npx tsx tools/diesel-ouvido-render.ts <preset> <saida.wav> [opções]
//   npx tsx tools/diesel-ouvido-render.ts <preset> <pasta/> --cada [opções]   (<pasta>/<preset>_<cond>_<ouvinte>_tudo.wav, _so-<fonte>.wav, _sem-<fonte>.wav, _semente2.wav)
//
//   --rpm R            giro travado em R rpm (a rotação da gravação), motor quente
//   --comb x           com --rpm: combustível fixo, de 0 a 1 do máximo da ficha (1 = plena carga). Sem ele: o combustível
//                      que zera o torque líquido nessa rotação (a lenta, ou o motor segurado em vazio)
//   --degrau c0,c1,t   com --rpm: transitório de enchimento do turbo. Giro travado, combustível c0 até o instante t (s,
//                      dentro da gravação) e c1 depois; o turbo parte assentado em c0 e sobe com a constante de tempo dele
//   --agua T           com --rpm: água fixa em T °C (motor frio recém-ligado); padrão 90
//   --lenta            lenta livre pelo governador, como na página (com --rpm: a lenta regulada para R)
//   --cenario nome     cenário de giro livre do tools/diesel-fontes.ts (carga, n8, ger, rev, wot…); --de/--ate recortam (s)
//   --dur s            segundos gravados (padrão 12)       --descarta s  segundos jogados fora antes (padrão: o turbo assenta)
//   --ouvinte ext|pipe|int|bay    posição (padrão ext: a câmera atrás)
//   --ambiente         deixa o som de ambiente ligado (padrão: desligado, para comparar o motor sozinho)
//   --campo JSON       muda campos do preset antes de montar ('{"turboChiado":-6}')
//   --sem a,b          desliga fontes     --escala a=g,b=g   multiplica o ganho de fontes     --semente N
//   --cada             grava o conjunto do orçamento
//
// Fontes (desligar zera o ganho sem pular as chamadas do gerador de ruído: a semente segue igual e a diferença para o
// render completo é a contribuição da fonte). "ar" marca as fontes de ruído largo de escoamento (as do viés "mais
// motor, menos ar" do PLANO); "rede" as que entram na rede de tubos (desligá-las muda a trajetória do laço não linear:
// vale a diferença de energia, não o sinal-diferença):
//   jato        ar        chiado do gás na boca do escape (segue a velocidade de cada pulso)
//   valvula     ar, rede  jato na abertura da válvula de escape (ruído dentro do tubo)
//   chiadoAdm   ar        chiado do ar no filtro e nos dutos de admissão
//   sopro       ar        banda larga do compressor do turbo
//   turbina     ar, rede  banda larga da turbina, que sai pelo escape
//   wastegate   ar        chiado da válvula de alívio da turbina e da borboleta do freio de descarga
//   fundo       ar        fundo mecânico contínuo (engrenagens, bombas, correias) como ruído
//   apito                 tom da passagem das pás do compressor
//   batida                a batida da combustão: resposta do bloco ao dp/dθ de cada queima (determinística)
//   chocalho              a parte da batida que é ruído (a chama turbulenta), colada à mesma subida de pressão
//   saia                  a saia do pistão batendo na camisa depois do PMS de queima
//   tiques                injetores e bomba (rajadas coladas a cada injeção)
//   valvulas              trem de válvulas (rajadas coladas a cada abertura e fechamento)
//   cliques               cliques de válvula herdados do Ronco
//   admissao              pulso grave da admissão (determinístico)
//   vib                   vibração do bloco pelo torque (determinística)
//   variacao    rede      irregularidade da queima: atraso, injetor, mistura e energia de ciclo para ciclo
//   ambiente              som de fundo da cena (só com --ambiente)
//   escape                o som que sai da boca do escape (os pulsos e o jato): para ouvir só o resto
// Grupos: `ar` (as marcadas), `turbo` (sopro, turbina, wastegate, apito), `turboLargo` (sem o apito), `mecanica`
// (batida, chocalho, tiques, valvulas, cliques, fundo). A saída passa por um tanh suave: a soma é exata só em nível baixo.
import fs from 'node:fs';
import path from 'node:path';
import { DieselDSP } from '../src/engines/diesel/dsp';
import { PRESETS, PADRAO_DIESEL } from '../src/engines/diesel/presets';
import { configCalibrada } from '../src/engines/diesel/config';
import { CENARIOS, type Cenario } from './diesel-comum';
import { CEN_EXTRA } from './diesel-fontes';

const SR = 48000, B = 128;
export const AR = ['jato', 'valvula', 'chiadoAdm', 'sopro', 'turbina', 'wastegate', 'fundo'] as const;
export const NA_REDE = ['valvula', 'turbina', 'variacao'];
export const FONTES = [...AR, 'apito', 'batida', 'chocalho', 'saia', 'tiques', 'valvulas', 'cliques', 'admissao', 'vib', 'variacao'] as const;
export const GRUPOS: Record<string, string[]> = {
  ar: [...AR], turbo: ['sopro', 'turbina', 'wastegate', 'apito'], turboLargo: ['sopro', 'turbina', 'wastegate'],
  mecanica: ['batida', 'chocalho', 'saia', 'tiques', 'valvulas', 'cliques', 'fundo'],
};
const bq = (f: any, g: number) => { if (f) { f.b0 *= g; f.b1 *= g; f.b2 *= g; } };

// multiplica o ganho de uma fonte (0 = desliga) depois do setConfig: a calibração já foi feita com tudo ligado
export function escalar(d: any, f: string, g: number) {
  if (GRUPOS[f]) { for (const x of GRUPOS[f]) escalar(d, x, g); return; }
  switch (f) {
    case 'escape': d.params.exhaust *= g; break;
    case 'jato': { d.kJatoMed = (d.kJatoMed ?? 1) * g; const fr = d.freio.bind(d); d.freio = (dtc: number) => { fr(dtc); d.jetGain *= d.kJatoMed; }; d.jetGain *= g; break; } // (o freio-motor repõe o ganho a cada passo de controle)
    case 'valvula': d.valveNoise *= g; break;
    case 'chiadoAdm': d.hissGain *= g; break;
    case 'sopro': d.gChiado *= g; break;
    case 'turbina': d.zTurb *= g; break;
    case 'wastegate': bq(d.wgF, g); bq(d.fbF, g); break;
    case 'fundo': d.fundoAmp = d.fundoAmp.map((a: number) => a * g); break;
    case 'apito': d.gApito *= g; break;
    case 'batida': d.kBatida *= g; break;
    case 'chocalho': d.kChocalho *= g; break;
    case 'tiques': d.kTiques *= g; d.kRot *= g; break;
    case 'valvulas': d.kValvulas *= g; break;
    case 'saia': d.kSaia *= g; break;
    case 'cliques': for (const q of d.clickF) bq(q, g); break;
    case 'admissao': d.inGain *= g; break;
    case 'vib': bq(d.vibLP, g); break;
    case 'variacao': d.kVar *= g; break;
    case 'ambiente': if (g === 0) d.params.ambSound = false; break;
    default: throw new Error(`fonte desconhecida: ${f} (${[...FONTES, ...Object.keys(GRUPOS), 'ambiente'].join(', ')})`);
  }
}

type Op = { rpm?: number; comb?: number; agua?: number; degrau?: [number, number, number]; lenta?: boolean; cenario?: string; de?: number; ate?: number; dur: number; descarta?: number;
  ouvinte: string; ambiente: boolean; campo: any; sem: string[]; escala: [string, number][]; semente?: number };

const spec = (id: string, campo: any) => {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`preset diesel desconhecido: ${id}`);
  return { ...PADRAO_DIESEL, ...p, ...campo } as any;
};
const cfgCache = new Map<string, any>();
const config = (id: string, campo: any) => {
  const k = id + JSON.stringify(campo);
  if (!cfgCache.has(k)) cfgCache.set(k, configCalibrada(spec(id, campo), SR));
  return cfgCache.get(k);
};

function novo(id: string, op: Op) {
  const sp = spec(id, op.campo), d: any = new DieselDSP(SR);
  d.params.listener = op.ouvinte; d.params.ambSound = op.ambiente;
  d.setConfig(config(id, op.campo));
  d.message({ type: 'diesel', portador: sp.portadores.includes('carro') ? 'carro' : sp.portadores[0] });
  for (const f of op.sem) escalar(d, f, 0);
  for (const [f, g] of op.escala) escalar(d, f, g);
  if (op.semente !== undefined) d.rng.s = op.semente >>> 0 || 1;
  return { d, sp };
}

// rotação do turbo assentada para um combustível e uma rotação (a mesma conta do DieselDSP.turboDiesel)
function turboAssentado(d: any, rpm: number, comb: number) {
  if (!d.turbo) return 0;
  let alvo = Math.min(1, Math.max(0, 1.05 * Math.sqrt(Math.min(1.3, rpm / d.rpmMax) * (0.08 + 0.92 * Math.min(1.2, comb)))));
  if (d.turboTipo === 'vgt') alvo = Math.max(alvo, d.turboLenta);
  return alvo;
}

// motor quente, girando travado em `rpm` com o combustível mandado de fora (como um portador faria)
function travar(d: any, rpm: number, comb: number, agua = 90) {
  // (água fria: o motor "acabou de pegar", com a parede e o óleo frios; o `warm` sai da água no primeiro passo de controle)
  d.tempMode = 'fixed'; d.tempSet = agua; d.coolant = agua; d.warm = agua >= 85 ? 1 : 0; d.runT = agua >= 85 ? 100 : 20; d.tEsc = 300; if (agua < 60) d.ambientT = Math.min(d.ambientT, agua);
  d.state = 'run'; d.lockOmega = true; d.omega = (rpm * 2 * Math.PI) / 60; d.rpmAvg = rpm;
  d.combExterno = comb; d.fuelCmd = comb; d.fuelM = comb; d.tw = turboAssentado(d, rpm, comb);
}

export function render(id: string, op: Op) {
  const l = new Float32Array(B), r = new Float32Array(B);
  let d: any, sp: any, modo: string, comb = NaN, fixo = false, cen: Cenario | null = null;
  if (op.cenario) {
    ({ d, sp } = novo(id, op));
    cen = CEN_EXTRA[op.cenario] || CENARIOS[op.cenario](sp);
    if (cen.portador && cen.portador !== 'nenhum0') d.message({ type: 'diesel', portador: cen.portador });
    modo = `cenário ${op.cenario}`;
  } else if (op.rpm && !op.lenta) {
    if (op.degrau) comb = op.degrau[0];
    else if (op.comb !== undefined) comb = op.comb;
    else {
      // o combustível que zera o torque líquido (bisseção, como o iacI da sonda de calibração)
      let lo = 0.005, hi = 0.7;
      for (let it = 0; it < 14; it++) {
        comb = 0.5 * (lo + hi);
        const x = novo(id, op).d; travar(x, op.rpm, comb, op.agua);
        let s = 0, n = 0;
        for (let i = 0; i < 1.4 * SR; i += B) { x.process(l, r, B); if (i > 0.7 * SR) { s += x.tqMean; n++; } }
        if (s / n > 0) hi = comb; else lo = comb;
      }
    }
    ({ d, sp } = novo(id, op)); travar(d, op.rpm, comb, op.agua);
    modo = op.degrau ? 'degrau travado' : 'travado'; fixo = true;
  } else {
    ({ d, sp } = novo(id, op));
    if (op.rpm) d.lentaFixa = op.rpm;
    d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } });
    d.message({ type: 'input', ignition: true });
    modo = 'lenta';
  }
  const descarta = cen ? op.de ?? 0 : op.descarta ?? (fixo ? 2.5 : 8); // (travado: o turbo já parte assentado)
  const dur = cen ? (op.ate ?? cen.eventos[cen.eventos.length - 1][0]) - descarta : op.dur;
  const n0 = Math.round(descarta * SR), n = Math.round(dur * SR);
  const m = new Float32Array(n), tele: any[] = [];
  let somaRpm = 0, cont = 0, rpmMin = Infinity, rpmMax = 0, ei = 0, nan = 0, pico = 0;
  for (let i = -n0; i < n; i += B) {
    if (cen) { const t = (i + n0) / SR; while (ei < cen.eventos.length && cen.eventos[ei][0] <= t) { cen.eventos[ei][1]?.(d); ei++; } }
    if (op.degrau && i >= op.degrau[2] * SR) d.combExterno = op.degrau[1];
    d.process(l, r, B);
    if (i >= 0) {
      const k = Math.min(B, n - i);
      for (let j = 0; j < k; j++) { const v = 0.5 * (l[j] + r[j]); m[i + j] = v; if (!Number.isFinite(v)) nan++; else if (Math.abs(v) > pico) pico = Math.abs(v); }
      somaRpm += d.rpmAvg; cont++; rpmMin = Math.min(rpmMin, d.rpmAvg); rpmMax = Math.max(rpmMax, d.rpmAvg);
      if (cont % 8 === 1) tele.push({ t: +(i / SR).toFixed(4), rpm: +d.rpmAvg.toFixed(1), comb: +d.fuelCmd.toFixed(4), turbo: +(d.turboW || 0).toFixed(4), boost: +(d.boost || 0).toFixed(4), lambda: +(d.lamM || 0).toFixed(2), dpdth: +(d.dpM || 0).toFixed(2), pMax: +((d.pMaxM || 0) / 1e5).toFixed(1), marcha: d.gear });
    }
  }
  const rpm = somaRpm / Math.max(1, cont), voltas = d.tempos / 2;
  const info = { preset: id, familia: 'diesel', modo, rpm: +rpm.toFixed(1), rpmMin: +rpmMin.toFixed(1), rpmMax: +rpmMax.toFixed(1), f0: +(rpm / (60 * voltas)).toFixed(4), fixo,
    eventosPorCiclo: d.N, voltasPorCiclo: voltas, comb: Number.isFinite(comb) ? comb : +d.fuelCmd.toFixed(4), degrau: op.degrau, turbo: +(d.turboW || 0).toFixed(3), boostBar: +(d.boost || 0).toFixed(3), lambda: +(d.lamM || 0).toFixed(2),
    dpdth: +(d.dpM || 0).toFixed(2), pMaxBar: +((d.pMaxM || 0) / 1e5).toFixed(1), ouvinte: op.ouvinte, ambiente: op.ambiente, sem: op.sem, escala: op.escala, semente: op.semente ?? 12345,
    ganho: +d.cfgGain.toFixed(4), pico: +pico.toFixed(4), nan, estado: d.state, campo: op.campo, sr: SR, dur, tele };
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

function salvar(arq: string, r: { m: Float32Array; info: any }, quieto = false) {
  gravarMono(arq, r.m);
  fs.writeFileSync(arq.replace(/\.wav$/, '.json'), JSON.stringify(r.info));
  const i = r.info;
  if (!quieto) console.log(`${arq}: ${i.modo} ${i.rpm} rpm (${i.rpmMin}–${i.rpmMax}), f0 ${i.f0} Hz, combustível ${(+i.comb).toFixed(4)}, turbo ${i.turbo}, ${i.boostBar} bar, λ ${i.lambda}, dp/dθ ${i.dpdth}, pico ${i.pico}${i.nan ? `, ${i.nan} NaN` : ''}${i.sem.length ? `, sem ${i.sem.join('+')}` : ''}`);
}

if (process.argv[1] && process.argv[1].endsWith('diesel-ouvido-render.ts')) {
  const a = process.argv.slice(2);
  const BOOL = ['--lenta', '--ambiente', '--cada'];
  const pos = a.filter((x, i) => !x.startsWith('--') && !(i > 0 && a[i - 1].startsWith('--') && !BOOL.includes(a[i - 1])));
  const val = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const num = (k: string) => (val(k) !== undefined ? +val(k)! : undefined);
  const tem = (k: string) => a.includes(k);
  const [id, saida] = pos;
  if (!id || !saida) { console.error('uso: tsx tools/diesel-ouvido-render.ts <preset> <saida.wav | pasta/ --cada> [--rpm R [--comb x | --degrau c0,c1,t] | --lenta | --cenario nome [--de s --ate s]] [--dur s] [--descarta s] [--ouvinte ext] [--ambiente] [--campo JSON] [--sem a,b] [--escala a=g] [--semente N]'); process.exit(2); }
  const op: Op = {
    rpm: num('--rpm'), comb: num('--comb'), agua: num('--agua'), degrau: val('--degrau') ? (val('--degrau')!.split(',').map(Number) as [number, number, number]) : undefined, lenta: tem('--lenta'),
    cenario: val('--cenario'), de: num('--de'), ate: num('--ate'), dur: num('--dur') ?? 12, descarta: num('--descarta'), ouvinte: val('--ouvinte') || 'ext', ambiente: tem('--ambiente'),
    campo: JSON.parse(val('--campo') || '{}'), sem: (val('--sem') || '').split(',').filter(Boolean),
    escala: (val('--escala') || '').split(',').filter(Boolean).map((kv) => { const [k, v] = kv.split('='); return [k, +v] as [string, number]; }), semente: num('--semente'),
  };
  if (tem('--cada')) {
    fs.mkdirSync(saida, { recursive: true });
    const cond = op.cenario ? op.cenario : op.rpm && !op.lenta ? `${Math.round(op.rpm)}rpm${op.degrau ? `-degrau` : op.comb !== undefined ? `-c${Math.round(op.comb * 100)}` : ''}` : 'lenta';
    const base = path.join(saida, `${id}_${cond}_${op.ouvinte}`);
    const tudo = render(id, op);
    salvar(`${base}_tudo.wav`, tudo);
    // (o combustível que zera o torque é o do render completo: desligar uma fonte não pode mudar a carga)
    const fx: Op = op.rpm && !op.lenta && !op.degrau ? { ...op, comb: tudo.info.comb } : op;
    const sp = spec(id, op.campo), turbo = sp.aspiration === 'turbo';
    const lista = [...FONTES, ...(op.ambiente ? ['ambiente'] : []), 'ar', ...(turbo ? ['turbo', 'turboLargo'] : [])].filter((f) => turbo || !['sopro', 'turbina', 'wastegate', 'apito'].includes(f));
    for (const f of lista) {
      const semF = render(id, { ...fx, sem: [...op.sem, f] });
      const rede = NA_REDE.includes(f) || (GRUPOS[f] || []).some((x) => NA_REDE.includes(x));
      if (rede) { salvar(`${base}_sem-${f}.wav`, semF, true); continue; }
      const dif = new Float32Array(semF.m.length);
      for (let i = 0; i < dif.length; i++) dif[i] = tudo.m[i] - semF.m[i];
      salvar(`${base}_so-${f}.wav`, { m: dif, info: { ...semF.info, so: f } }, true);
    }
    salvar(`${base}_semente2.wav`, render(id, { ...fx, semente: 987654321 }), true);
    console.log(`conjunto do orçamento em ${base}_*.wav (${lista.length} fontes e grupos; na rede: ${NA_REDE.join(', ')} e os grupos que as contêm)`);
  } else {
    fs.mkdirSync(path.dirname(path.resolve(saida)), { recursive: true });
    salvar(saida, render(id, op));
  }
}
