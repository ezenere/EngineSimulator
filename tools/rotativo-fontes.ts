// Renderiza um preset dos Rotativos numa condição casada com uma gravação, para o kit ouvido (tools/ouvido), e grava o
// conjunto do orçamento de ruído: o mesmo render com uma fonte desligada de cada vez, com a MESMA semente (nos moldes de
// tools/ouvido/render.ts, que só conhece o Ronco, e de tools/diesel-fontes.ts). A calibração é a da página (feita antes
// de desligar qualquer coisa): o nível de cada fonte é o que se ouve no navegador.
//
//   npx tsx tools/rotativo-fontes.ts <preset> <saida.wav> [opções]
//   npx tsx tools/rotativo-fontes.ts <preset> <pasta/> --cada [opções]   (<pasta>/<preset>_<cond>_<ouvinte>_tudo.wav, _sem-<fonte>.wav, _semente2.wav)
//
//   --lenta            lenta livre e quente (padrão): o giro caça como no navegador
//   --rpm R            giro travado em R rpm em ponto morto: perto da lenta, com o ar de lenta que zera o torque líquido;
//                      acima dela, com o pedal que zera o torque (o operador segurando o giro)
//   --pedal x          com --rpm: pedal fixo de 0 a 1 (1 = plena carga travada no dinamômetro)
//   --acelerada        lenta livre, pedal a 60% de 3 a 4,2 s e solta (a acelerada em ponto morto); grava tudo desde 0 s
//   --dur s            segundos gravados (padrão 12)      --descarta s   jogados fora antes (padrão 4 travado, 8 na lenta)
//   --ouvinte ext|pipe|int|bay   (padrão ext)             --ambiente     deixa o som de ambiente ligado
//   --campo JSON       muda campos do preset antes de montar (o `escape` é fundido com o do preset):
//                      '{"escape":{"ponteira":32,"saidas":[{"L":3.4,"D":25,"phi":30}]}}'
//   --sem a,b          desliga fontes (lista abaixo)      --escala a=g,b=g   multiplica o ganho de fontes
//   --semente N        outra semente nos geradores de ruído
//   --cada             grava o conjunto do orçamento; `--fontes a,b` restringe as fontes isoladas (padrão: todas);
//                      `--grupos a+b+c,d+e` troca os renders com várias fontes desligadas juntas (padrão: as de ar contínuas)
//
// Fontes (desligar zera o ganho sem pular as chamadas dos geradores de ruído):
//   jato        chiado do gás na ponteira (segue a velocidade de cada pulso)                 soma na saída
//   chiadoAdm   chiado do ar na borboleta                                                    soma na saída
//   admissao    pulso grave da admissão (determinístico)                                     soma na saída
//   mecanica    tiques do ápice, batida, engrenagem fixa, vedações, vibração                 soma na saída
//   vedacoes    só o chiado contínuo das vedações (parte da mecânica: o "fundo")             soma na saída
//   chiadoTurbo chiado do turbo                                                              soma na saída
//   apitoTurbo  apito tonal do turbo (determinístico)                                        soma na saída
//   posBoca     pós-queima que queima na boca                                                ENTRA NA REDE (junto à boca)
//   posQuente   pós-queima no ponto quente (antes do pré-silencioso)                         ENTRA NA REDE
//   posPrim     pós-queima no primário do rotor                                              ENTRA NA REDE
//   posqueima   as três partes da pós-queima de uma vez                                      ENTRA NA REDE
//   janela      jato na abertura da janela de escape (o `turb` do Ronco, dentro do tubo)     ENTRA NA REDE
//   estouros    estouros das falhas e da desaceleração                                       ENTRA NA REDE (muda os sorteios)
//   variacao    variação da queima de explosão para explosão                                 ENTRA NA REDE
//   ar          todo o ruído aerodinâmico do controle "Ar" da página (params.air = 0)        (grupo)
// Fonte que entra na rede de tubos muda a trajetória do laço não linear: para ela vale o EFEITO de desligar na potência
// (`orcamento.py --na-rede posBoca,posQuente,posPrim,posqueima,janela,estouros,variacao`).
// No Wankel o ciclo que se repete é o da câmara (3 voltas do eixo, 1 080°e): f0 = rpm/180, 3·rotores explosões por ciclo;
// no kit, `--voltas-por-ciclo 3` (o .json ao lado do WAV leva f0 e as explosões por ciclo).
import fs from 'node:fs';
import path from 'node:path';
import { RotativoDSP } from '../src/engines/rotativo/dsp';
import { preset, cfgCalibrada, SR } from './rotativo-comum';

const B = 128;
export const FONTES = ['jato', 'chiadoAdm', 'admissao', 'mecanica', 'vedacoes', 'chiadoTurbo', 'apitoTurbo', 'posBoca', 'posQuente', 'posPrim', 'posqueima', 'janela', 'estouros', 'variacao'] as const;
export const NA_REDE = ['posBoca', 'posQuente', 'posPrim', 'posqueima', 'janela', 'estouros', 'variacao'];

const zerarBiquad = (f: any, g: number) => { if (f) { f.b0 *= g; f.b1 *= g; f.b2 *= g; } };

/** multiplica o ganho de uma fonte (0 = desliga) depois do setConfig: a calibração já foi feita com tudo ligado */
export function escalar(d: any, f: string, g: number) {
  switch (f) {
    case 'jato': d.jetGain *= g; break;
    case 'chiadoAdm': d.hissGain *= g; break;
    case 'admissao': d.inGain *= g; break;
    case 'mecanica': d.params.mech *= g; break;
    case 'vedacoes': if (d.kVed !== undefined) d.kVed *= g; else zerarBiquad(d.vedF, g); break;
    case 'chiadoTurbo': zerarBiquad(d.turboHiss, g); break;
    case 'apitoTurbo': if (d.kApito !== undefined) d.kApito *= g; break;
    case 'posBoca': d.kBoca *= g; break;
    case 'posQuente': d.kQuente *= g; break;
    case 'posPrim': d.kPrim *= g; break;
    case 'posqueima': d.kHC *= g; break;
    case 'janela': d.valveNoise *= g; break;
    case 'estouros': if (g === 0) d.pops.push = () => d.pops.length; break;
    case 'variacao': d.varScale *= g; d.carbVar *= g; d.carbMis *= g; break;
    case 'ar': d.params.air *= g; break;
    default: throw new Error(`fonte desconhecida: ${f} (${[...FONTES, 'ar'].join(', ')})`);
  }
}

export type Op = { rpm?: number; pedal?: number; acelerada?: boolean; dur: number; descarta?: number; ouvinte: string; ambiente: boolean; campo: any; sem: string[]; escala: [string, number][]; semente?: number; iac?: number };

function specDe(id: string, campo: any) {
  const p = preset(id);
  const c = { ...campo };
  if (c.escape) c.escape = { ...p.escape, ...c.escape };
  if (c.janelas) c.janelas = { ...p.janelas, ...c.janelas };
  return { ...p, ...c } as any;
}

function novo(spec: any, op: Op, rpm: number) {
  const d: any = new RotativoDSP(SR);
  d.setConfig(cfgCalibrada(spec));
  d.message({ type: 'params', params: { listener: op.ouvinte, master: 0.8, ambSound: op.ambiente, env: 'open' } });
  d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } });
  d.coolant = 90; d.ambientT = 20; d.state = 'run'; d.ignition = true; d.runT = 120; d.warm = 1;
  d.omega = (rpm * 2 * Math.PI) / 60; d.rpmAvg = rpm; d.exhT = 450;
  for (const f of op.sem) escalar(d, f, 0);
  for (const [f, g] of op.escala) escalar(d, f, g);
  if (op.semente !== undefined) { d.rng.s = op.semente >>> 0 || 1; d.hcN.s = ((op.semente * 2654435761) >>> 0) || 7; }
  return d;
}

export function render(id: string, op: Op) {
  const spec = specDe(id, op.campo);
  const l = new Float32Array(B), r = new Float32Array(B);
  let d: any, pedal = NaN, iac = NaN, modo: string;
  if (op.rpm) {
    // giro travado; o integrador do controle de lenta fica congelado (REVISAO-DE-SOM, Armadilhas)
    const pertoDaLenta = op.rpm < 1.2 * spec.idle && op.pedal === undefined;
    const mk = (thr: number, ar?: number) => {
      const x = novo(spec, op, op.rpm!);
      x.lockOmega = true; x.KI = 0; x.thrTarget = thr; x.thr = thr;
      if (ar !== undefined) { x.iacI = ar; x.iac = ar; }
      return x;
    };
    const torque = (x: any) => { for (let i = 0; i < 1.0 * SR; i += B) x.process(l, r, B); return x.tqMean; };
    if (op.pedal !== undefined) { pedal = op.pedal; iac = op.iac ?? NaN; }
    else if (pertoDaLenta) {
      // na lenta quem segura o giro é o ar de lenta (pedal solto): acha o ar que zera o torque líquido
      pedal = 0;
      let lo = 0, hi = 0.05;
      for (let it = 0; it < 14; it++) { iac = 0.5 * (lo + hi); if (torque(mk(0, iac)) > 0) hi = iac; else lo = iac; }
    } else {
      let lo = 0, hi = 0.6;
      for (let it = 0; it < 14; it++) { pedal = 0.5 * (lo + hi); if (torque(mk(pedal)) > 0) hi = pedal; else lo = pedal; }
    }
    d = mk(pedal, Number.isFinite(iac) ? iac : undefined); modo = 'travado';
  } else {
    d = novo(spec, op, spec.idle); modo = op.acelerada ? 'acelerada' : 'lenta';
  }
  const descarta = op.acelerada ? 0 : op.descarta ?? (modo === 'travado' ? 4 : 8);
  const n0 = Math.round(descarta * SR), n = Math.round(op.dur * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  let somaRpm = 0, cont = 0, rpmMin = Infinity, rpmMax = 0, estouros0 = 0;
  for (let i = -n0; i < n; i += B) {
    if (op.acelerada) { const t = i / SR; const thr = t >= 3 && t < 4.2 ? 0.6 : 0; if (d.thrTarget !== thr) d.message({ type: 'input', throttle: thr }); }
    d.process(l, r, B);
    if (i < 0) estouros0 = d.estourosTotal;
    if (i >= 0) {
      const k = Math.min(B, n - i);
      L.set(l.subarray(0, k), i); R.set(r.subarray(0, k), i);
      somaRpm += d.rpmAvg; cont++; rpmMin = Math.min(rpmMin, d.rpmAvg); rpmMax = Math.max(rpmMax, d.rpmAvg);
    }
  }
  const m = new Float32Array(n);
  let pico = 0, nan = 0;
  for (let i = 0; i < n; i++) { m[i] = 0.5 * (L[i] + R[i]); if (!Number.isFinite(m[i])) nan++; pico = Math.max(pico, Math.abs(m[i])); }
  const rpm = somaRpm / Math.max(1, cont);
  const voltas = d.cyc / 360;
  const info = { preset: id, modo, rpm: +rpm.toFixed(1), rpmMin: +rpmMin.toFixed(1), rpmMax: +rpmMax.toFixed(1), f0: +(rpm / 60 / voltas).toFixed(4), fixo: modo === 'travado',
    eventosPorCiclo: d.N, voltasPorCiclo: voltas, rotores: d.rotores, fIgn: +((rpm / 60 / voltas) * d.N).toFixed(2),
    // (o pedal e o ar de lenta vão com a precisão inteira: o conjunto do orçamento os reusa, e um arredondamento muda a trajetória)
    pedal: Number.isFinite(pedal) ? pedal : d.thr, iac: Number.isFinite(iac) ? iac : null, coletorBar: +(d.pMan / 101325).toFixed(3), boostBar: +(d.boost || 0).toFixed(3),
    pAberturaBar: +(d.pEO[0] / 1e5).toFixed(2), fHC: +d.fHCatual.toFixed(4), falha: +d.falhaBase.toFixed(4), residual: +(d.xRes.reduce((x: number, y: number) => x + y, 0) / d.N).toFixed(3), estourosS: +((d.estourosTotal - estouros0) / op.dur).toFixed(2), tEscape: Math.round(d.exhT),
    ouvinte: op.ouvinte, ambiente: op.ambiente, sem: op.sem, escala: op.escala, semente: op.semente ?? null, ganho: +d.cfgGain.toFixed(4), mkIdle: +d.mkIdle.toFixed(3), pico: +pico.toFixed(4), nan, estado: d.state,
    campo: op.campo, sr: SR, dur: op.dur };
  return { m, info };
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

function salvar(arq: string, r: { m: Float32Array; info: any }) {
  gravarMono(arq, r.m);
  fs.writeFileSync(arq.replace(/\.wav$/, '.json'), JSON.stringify(r.info, null, 1));
  const i = r.info;
  console.log(`${arq}: ${i.modo} ${i.rpm} rpm (${i.rpmMin}–${i.rpmMax}), ign ${i.fIgn} Hz, pedal ${(+i.pedal).toFixed(4)}, coletor ${i.coletorBar} bar, abertura ${i.pAberturaBar} bar, fHC ${i.fHC}, estouros ${i.estourosS}/s, pico ${i.pico}${i.nan ? `, ${i.nan} NaN` : ''}${i.sem.length ? `, sem ${i.sem.join('+')}` : ''}`);
}

if (process.argv[1] && process.argv[1].endsWith('rotativo-fontes.ts')) {
  const a = process.argv.slice(2);
  const BOOL = ['--lenta', '--ambiente', '--cada', '--acelerada'];
  const pos = a.filter((x, i) => !x.startsWith('--') && !(i > 0 && a[i - 1].startsWith('--') && !BOOL.includes(a[i - 1])));
  const val = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const tem = (k: string) => a.includes(k);
  const [id, saida] = pos;
  if (!id || !saida) { console.error('uso: tsx tools/rotativo-fontes.ts <preset> <saida.wav | pasta/ --cada> [--lenta | --rpm R [--pedal x] | --acelerada] [--dur s] [--descarta s] [--ouvinte ext] [--ambiente] [--campo JSON] [--sem a,b] [--escala a=g] [--semente N] [--fontes a,b] [--grupos a+b,c+d] [--rotulo nome]'); process.exit(2); }
  const op: Op = {
    rpm: val('--rpm') ? +val('--rpm')! : undefined, pedal: val('--pedal') !== undefined ? +val('--pedal')! : undefined, acelerada: tem('--acelerada'),
    dur: +(val('--dur') || 12), descarta: val('--descarta') !== undefined ? +val('--descarta')! : undefined, ouvinte: val('--ouvinte') || 'ext',
    ambiente: tem('--ambiente'), campo: JSON.parse(val('--campo') || '{}'), sem: (val('--sem') || '').split(',').filter(Boolean),
    escala: (val('--escala') || '').split(',').filter(Boolean).map((kv) => { const [k, v] = kv.split('='); return [k, +v] as [string, number]; }),
    semente: val('--semente') !== undefined ? +val('--semente')! : undefined,
  };
  if (tem('--cada')) {
    fs.mkdirSync(saida, { recursive: true });
    const cond = (val('--rotulo') ? `${val('--rotulo')}-` : '') + (op.rpm ? `${Math.round(op.rpm)}rpm${op.pedal !== undefined ? `-p${Math.round(op.pedal * 100)}` : ''}` : 'lenta');
    const base = path.join(saida, `${id}_${cond}_${op.ouvinte}`);
    const tudo = render(id, op);
    salvar(`${base}_tudo.wav`, tudo);
    // (o pedal e o ar de lenta que zeram o torque são os do render completo: desligar uma fonte não pode mudar a carga)
    const fixo: Op = op.rpm ? { ...op, pedal: tudo.info.pedal, iac: tudo.info.iac ?? undefined } : op;
    const sp = specDe(id, op.campo);
    const quais = val('--fontes') ? val('--fontes')!.split(',') : [...FONTES];
    for (const f of quais) {
      if ((f === 'chiadoTurbo' || f === 'apitoTurbo') && !sp.turbo) continue;
      salvar(`${base}_sem-${f}.wav`, render(id, { ...fixo, sem: [...op.sem, f] }));
    }
    for (const g of (val('--grupos') || 'jato+chiadoAdm+vedacoes+chiadoTurbo').split(',').filter(Boolean)) salvar(`${base}_sem-${g}.wav`, render(id, { ...fixo, sem: [...op.sem, ...g.split('+')] }));
    salvar(`${base}_semente2.wav`, render(id, { ...fixo, semente: 987654321 }));
    console.log(`fontes que entram na rede de tubos (vale o efeito de desligar): --na-rede ${NA_REDE.join(',')}`);
  } else {
    fs.mkdirSync(path.dirname(path.resolve(saida)), { recursive: true });
    salvar(saida, render(id, op));
  }
}
