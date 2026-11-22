// Renderiza um preset do Radial numa condição casada com uma gravação, para o kit ouvido (tools/ouvido), e grava o
// conjunto do orçamento de ruído: o mesmo render com uma fonte desligada de cada vez, com a MESMA semente (nos moldes de
// tools/rotativo-fontes.ts). A calibração é a da página (feita antes de desligar qualquer coisa): o nível de cada fonte é
// o que se ouve no navegador.
//
//   npx tsx tools/radial-fontes.ts <preset> <saida.wav> [opções]
//   npx tsx tools/radial-fontes.ts <preset> <pasta/> --cada [opções]   (<pasta>/<preset>_<cond>_<caminho>_tudo.wav, _sem-<fonte>.wav, _semente2.wav)
//
//   --caminho pagina|cena   `pagina` (padrão): o RadialDSP de radial.html, ouvinte de fora a 5 m do cubo, com o `tanh` da
//                           saída; `cena`: o MotorRadial no portador hélice, ouvinte parado de lado a `--d` metros
//                           (padrão 5), solo de grama, em Pa (o caminho da Passagem)
//   --lenta                 lenta livre e quente (padrão): o giro vaga como no navegador; `--idle R` troca a rotação-alvo
//                           da lenta pela da gravação
//   --rpm R                 giro travado em R rpm (só na página): perto da lenta, com o ar de lenta que equilibra o torque
//                           da hélice; acima dela, com a manete que o equilibra. A hélice continua soando
//   --pedal x               com --rpm: manete fixa de 0 a 1
//   --decolagem             manete toda, hélice no alvo `--rpmAlvo` (0..1, padrão 1); grava depois de o giro assentar
//   --dur s                 segundos gravados (padrão 12)     --descarta s   jogados fora antes (padrão 4; 8 na decolagem)
//   --campo JSON            muda campos do preset antes de montar (o `escape` é fundido com o do preset)
//   --sem a,b               desliga fontes (lista abaixo)     --escala a=g,b=g   multiplica o ganho de fontes
//   --semente N             outra semente nos geradores de ruído (todos os RNG do DSP, depois da calibração)
//   --cada                  grava o conjunto do orçamento; `--fontes a,b` restringe as fontes isoladas
//
// Fontes (desligar zera o ganho sem pular as chamadas dos geradores de ruído):
//   jato        chiado do gás na boca (segue a velocidade de cada pulso)                     soma na saída
//   vazamento   rajada do anel de chapa e das juntas (o `breakout` do Ronco)                 soma na saída
//   chiadoAdm   chiado do ar na borboleta                                                    soma na saída
//   admissao    pulso grave da admissão (determinístico)                                     soma na saída
//   mecanica    válvulas, batida, engrenagens, vibração                                      soma na saída
//   compressor  uivo e chiado do superalimentador                                            soma na saída
//   helice      passagem de pá e ruído largo da hélice (a da página, ou a do portador)       soma na saída
//   valvula     jato na abertura da válvula de escape (o `turb` do Ronco, dentro do tubo)    ENTRA NA REDE
//   estouros    estouros das falhas                                                          ENTRA NA REDE (muda os sorteios)
//   variacao    variação da queima de explosão para explosão e falhas da lenta (galope)      ENTRA NA REDE
//   ar          todo o ruído aerodinâmico do controle "Ar" da página (params.air = 0)        (grupo)
// Fonte que entra na rede de tubos muda a trajetória do laço não linear: para ela vale o EFEITO de desligar na potência
// (`orcamento.py --na-rede valvula,estouros,variacao`).
// f0 do ciclo = rpm/120; ignição = cilindros × rpm/120 (o .json ao lado do WAV leva os dois).
import fs from 'node:fs';
import path from 'node:path';
import { preset, novoDSP, SR } from './radial-comum';
import { semear } from './desvios';

const B = 128;
export const FONTES = ['jato', 'vazamento', 'chiadoAdm', 'admissao', 'mecanica', 'compressor', 'helice', 'valvula', 'estouros', 'variacao'] as const;
export const NA_REDE = ['valvula', 'estouros', 'variacao'];

/** multiplica o ganho de uma fonte (0 = desliga) depois do setConfig: a calibração já foi feita com tudo ligado.
 *  `helice` é a fonte de hélice a escalar (a da página, `d.heliceSom`, ou a do portador na Cena) */
export function escalar(d: any, f: string, g: number, helice?: any) {
  switch (f) {
    case 'jato': d.jetGain *= g; break;
    case 'vazamento': d.brkK *= g; break; // (o ganho, não o `breakK`: com ele em zero o laço pula o sorteio do ruído)
    case 'chiadoAdm': d.hissGain *= g; break;
    case 'admissao': d.inGain *= g; break;
    case 'mecanica': d.params.mech *= g; break;
    case 'compressor': d.scGain *= g; break;
    case 'helice': {
      const h = helice ?? d.heliceSom;
      if (h?.preencher) { const p = h.preencher.bind(h); h.preencher = (buf: Float32Array, n: number, ...r: any[]) => { const v = p(buf, n, ...r); for (let i = 0; i < n; i++) buf[i] *= g; return v; }; }
      break;
    }
    case 'valvula': d.valveNoise *= g; break;
    case 'estouros': if (g === 0) d.pops.push = () => d.pops.length; break;
    case 'variacao': {
      d.varScale *= g; d.carbVar *= g; d.carbMis *= g;
      // (as falhas de vela do galope da lenta são repostas a cada tique de controle)
      const c = d.avControle; d.avControle = function (this: any, dt: number) { c.call(this, dt); this.falhaLenta *= g; };
      break;
    }
    case 'ar': d.params.air *= g; break;
    default: throw new Error(`fonte desconhecida: ${f} (${[...FONTES, 'ar'].join(', ')})`);
  }
}

export type Op = { caminho: 'pagina' | 'cena'; d: number; idle?: number; rpm?: number; pedal?: number; decolagem?: boolean; rpmAlvo?: number; dur: number; descarta?: number;
  campo: any; sem: string[]; escala: [string, number][]; semente?: number; iac?: number };

function specDe(id: string, campo: any) {
  const p = preset(id);
  const c = { ...campo };
  if (c.escape) c.escape = { ...p.escape, ...c.escape };
  return { ...p, ...c } as any;
}

/** a hélice continua soando com o giro travado (as sondas de calibração a calam com `lockOmega`) */
function heliceTravada(d: any) {
  const orig = d.avSomExtra;
  d.avSomExtra = function (this: any) { const l = this.lockOmega; this.lockOmega = false; const x = orig.call(this); this.lockOmega = l; return x; };
}

function aplicar(d: any, op: Op, helice?: any) {
  for (const f of op.sem) escalar(d, f, 0, helice);
  for (const [f, g] of op.escala) escalar(d, f, g, helice);
}

function estat(m: Float32Array) {
  let pico = 0, nan = 0, sat = 0, e = 0;
  for (let i = 0; i < m.length; i++) { const v = m[i]; if (!Number.isFinite(v)) nan++; const a = Math.abs(v); if (a > pico) pico = a; if (a > 0.7) sat++; e += v * v; }
  return { pico, nan, acima07: sat / Math.max(1, m.length), rms: Math.sqrt(e / Math.max(1, m.length)) };
}

function renderPagina(id: string, op: Op) {
  const spec0 = specDe(id, op.campo), spec = op.idle ? { ...spec0, idle: op.idle } : spec0;
  const l = new Float32Array(B), r = new Float32Array(B);
  const novo = (rpm: number) => {
    const d: any = novoDSP(spec, { quente: true });
    d.omega = (rpm * 2 * Math.PI) / 60; d.rpmAvg = rpm;
    aplicar(d, op);
    if (op.semente) semear(d, op.semente);
    return d;
  };
  let d: any, pedal = NaN, iac = NaN, modo: string;
  if (op.rpm) {
    const pertoDaLenta = op.rpm < 1.25 * spec.idle && op.pedal === undefined;
    const mk = (thr: number, ar?: number) => {
      const x = novo(op.rpm!);
      x.lockOmega = true; x.KI = 0; x.thrTarget = thr; x.thr = thr; heliceTravada(x);
      if (ar !== undefined) { x.iacI = ar; x.iac = ar; }
      return x;
    };
    // (o torque líquido que equilibra é o do motor menos o da hélice na rotação travada)
    const sobra = (x: any) => { for (let i = 0; i < 1.5 * SR; i += B) x.process(l, r, B); return x.tqMean - (x.carga ? x.carga.torque(x.omega) : 0); };
    if (op.pedal !== undefined) { pedal = op.pedal; iac = op.iac ?? NaN; }
    else if (pertoDaLenta) {
      pedal = 0;
      let lo = 0, hi = 0.05;
      for (let it = 0; it < 12; it++) { iac = 0.5 * (lo + hi); if (sobra(mk(0, iac)) > 0) hi = iac; else lo = iac; }
    } else {
      let lo = 0, hi = 1;
      for (let it = 0; it < 12; it++) { pedal = 0.5 * (lo + hi); if (sobra(mk(pedal)) > 0) hi = pedal; else lo = pedal; }
    }
    d = mk(pedal, Number.isFinite(iac) ? iac : undefined); modo = 'travado';
  } else if (op.decolagem) {
    d = novo(spec.idle); modo = 'decolagem';
    d.message({ type: 'av', rpmAlvo: op.rpmAlvo ?? 1 }); d.message({ type: 'input', throttle: 1 });
  } else { d = novo(spec.idle); modo = 'lenta'; }
  const descarta = op.descarta ?? (modo === 'decolagem' ? 8 : 4);
  const n0 = Math.round(descarta * SR), n = Math.round(op.dur * SR);
  const m = new Float32Array(n);
  let somaRpm = 0, cont = 0, rpmMin = Infinity, rpmMax = 0;
  for (let i = -n0; i < n; i += B) {
    d.process(l, r, B);
    if (i >= 0) {
      const k = Math.min(B, n - i);
      for (let j = 0; j < k; j++) m[i + j] = 0.5 * (l[j] + r[j]);
      somaRpm += d.rpmAvg; cont++; rpmMin = Math.min(rpmMin, d.rpmAvg); rpmMax = Math.max(rpmMax, d.rpmAvg);
    }
  }
  const rpm = somaRpm / Math.max(1, cont);
  return { m, d, spec, modo, rpm, rpmMin, rpmMax, pedal: Number.isFinite(pedal) ? pedal : d.thr, iac: Number.isFinite(iac) ? iac : null };
}

async function renderCena(id: string, op: Op) {
  const { portadorRadial } = await import('./radial-cena');
  const { renderPassagem } = await import('./cena/render-passagem');
  const { PA_FS } = await import('../src/scene/constantes');
  const spec0 = specDe(id, op.campo);
  const extra = { ...op.campo, ...(op.idle ? { idle: op.idle } : {}) };
  const { p, m: mot } = portadorRadial(id, extra);
  const d: any = mot.dsp;
  const rpm0 = op.idle ?? spec0.idle;
  const pedal = op.decolagem ? 1 : 0;
  if (!op.decolagem) { d.omega = (rpm0 * 2 * Math.PI) / 60; d.rpmAvg = rpm0; }
  d.thrTarget = pedal; d.thr = pedal;
  aplicar(d, op, (p as any).fonte);
  if (op.semente) { semear(mot, op.semente); semear(p, op.semente); }
  const descarta = op.descarta ?? (op.decolagem ? 8 : 4), dur = op.dur + descarta;
  let somaRpm = 0, cont = 0, rpmMin = Infinity, rpmMax = 0;
  const r = renderPassagem({
    portadorPronto: p, v: 0, d: op.d, altitude: 0, ambiente: 'ceu', solo: 'grama', dur, sCentro0: -2.5, reverb: false, semFundo: true,
    ouvinte: { binaural: false, pos: [0, 0, 1.6] },
    antesBloco: () => { p.comandar({ pedal, ...(op.decolagem ? { rpmAlvo: op.rpmAlvo ?? 1 } : {}) } as any); },
    aoBloco: (t) => { if (t >= descarta) { somaRpm += d.rpmAvg; cont++; rpmMin = Math.min(rpmMin, d.rpmAvg); rpmMax = Math.max(rpmMax, d.rpmAvg); } },
  });
  const a = Math.round(descarta * SR), m = new Float32Array(r.dL.length - a);
  // (em Pa ÷ 20: fica na ordem de grandeza da saída da página; o kit normaliza pela âncora de qualquer jeito)
  for (let i = 0; i < m.length; i++) m[i] = (0.5 * (r.dL[a + i] + r.dR[a + i]) * PA_FS) / 20;
  return { m, d, spec: spec0, modo: op.decolagem ? 'decolagem' : 'lenta', rpm: somaRpm / Math.max(1, cont), rpmMin, rpmMax, pedal, iac: null as number | null };
}

export async function render(id: string, op: Op) {
  const r = op.caminho === 'cena' ? await renderCena(id, op) : renderPagina(id, op);
  const { m, d, spec } = r, e = estat(m);
  const info = { preset: id, caminho: op.caminho, distancia: op.caminho === 'cena' ? op.d : 5, modo: r.modo, rpm: +r.rpm.toFixed(1), rpmMin: +r.rpmMin.toFixed(1), rpmMax: +r.rpmMax.toFixed(1),
    f0: +(r.rpm / 120).toFixed(4), fixo: r.modo === 'travado', eventosPorCiclo: spec.cylinders, voltasPorCiclo: 2, fIgn: +((r.rpm / 120) * spec.cylinders).toFixed(2),
    // (a manete e o ar de lenta vão com a precisão inteira: o conjunto do orçamento os reusa)
    pedal: r.pedal, iac: r.iac, coletorBar: +(d.pMan / 101325).toFixed(3), tEscape: Math.round(d.exhT),
    sem: op.sem, escala: op.escala, semente: op.semente ?? null, ganho: +(d.cfgGain ?? 0).toFixed(4), mkIdle: +(d.mkIdle ?? 1).toFixed(3), mk: +(d.mk ?? 1).toFixed(3),
    pico: +e.pico.toFixed(4), rmsDb: +(20 * Math.log10(e.rms + 1e-12)).toFixed(2), acima07: +e.acima07.toFixed(5), nan: e.nan, estado: d.state, campo: op.campo, sr: SR, dur: op.dur };
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
  console.log(`${arq}: ${i.caminho} ${i.modo} ${i.rpm} rpm (${i.rpmMin}–${i.rpmMax}), ign ${i.fIgn} Hz, manete ${(+i.pedal).toFixed(4)}, coletor ${i.coletorBar} bar, nível ${i.rmsDb} dB, pico ${i.pico}, acima de 0,7: ${(100 * i.acima07).toFixed(2)} %${i.nan ? `, ${i.nan} NaN` : ''}${i.sem.length ? `, sem ${i.sem.join('+')}` : ''}`);
}

if (process.argv[1] && process.argv[1].endsWith('radial-fontes.ts')) {
  const a = process.argv.slice(2);
  const BOOL = ['--lenta', '--cada', '--decolagem'];
  const pos = a.filter((x, i) => !x.startsWith('--') && !(i > 0 && a[i - 1].startsWith('--') && !BOOL.includes(a[i - 1])));
  const val = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const tem = (k: string) => a.includes(k);
  const num = (k: string) => (val(k) !== undefined ? +val(k)! : undefined);
  const [id, saida] = pos;
  if (!id || !saida) { console.error('uso: tsx tools/radial-fontes.ts <preset> <saida.wav | pasta/ --cada> [--caminho pagina|cena] [--d m] [--lenta [--idle R] | --rpm R [--pedal x] | --decolagem [--rpmAlvo x]] [--dur s] [--descarta s] [--campo JSON] [--sem a,b] [--escala a=g] [--semente N] [--fontes a,b] [--rotulo nome]'); process.exit(2); }
  const op: Op = {
    caminho: (val('--caminho') as any) || 'pagina', d: num('--d') ?? 5, idle: num('--idle'), rpm: num('--rpm'), pedal: num('--pedal'), decolagem: tem('--decolagem'), rpmAlvo: num('--rpmAlvo'),
    dur: num('--dur') ?? 12, descarta: num('--descarta'), campo: JSON.parse(val('--campo') || '{}'), sem: (val('--sem') || '').split(',').filter(Boolean),
    escala: (val('--escala') || '').split(',').filter(Boolean).map((kv) => { const [k, v] = kv.split('='); return [k, +v] as [string, number]; }), semente: num('--semente'),
  };
  (async () => {
    if (tem('--cada')) {
      fs.mkdirSync(saida, { recursive: true });
      const cond = (val('--rotulo') ? `${val('--rotulo')}-` : '') + (op.rpm ? `${Math.round(op.rpm)}rpm${op.pedal !== undefined ? `-p${Math.round(op.pedal * 100)}` : ''}` : op.decolagem ? 'decolagem' : 'lenta');
      const base = path.join(saida, `${id}_${cond}_${op.caminho}`);
      const tudo = await render(id, op);
      salvar(`${base}_tudo.wav`, tudo);
      // (a manete e o ar de lenta que equilibram o torque são os do render completo: desligar uma fonte não pode mudar a carga)
      const fixo: Op = op.rpm ? { ...op, pedal: tudo.info.pedal, iac: tudo.info.iac ?? undefined } : op;
      const sp = specDe(id, op.campo);
      const quais = val('--fontes') ? val('--fontes')!.split(',') : [...FONTES];
      for (const f of quais) {
        if (f === 'compressor' && !sp.superalimentador) continue;
        if (f === 'helice' && !sp.helice) continue;
        salvar(`${base}_sem-${f}.wav`, await render(id, { ...fixo, sem: [...op.sem, f] }));
      }
      salvar(`${base}_sem-ar.wav`, await render(id, { ...fixo, sem: [...op.sem, 'ar'] }));
      salvar(`${base}_semente2.wav`, await render(id, { ...fixo, semente: 987654321 }));
      console.log(`fontes que entram na rede de tubos (vale o efeito de desligar): --na-rede ${NA_REDE.join(',')}`);
    } else {
      fs.mkdirSync(path.dirname(path.resolve(saida)), { recursive: true });
      salvar(saida, await render(id, op));
    }
  })();
}
