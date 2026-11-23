// Identidade amostra a amostra do Diesel (otimização de CPU, AUDITORIA A8): renderiza os 16 presets em várias condições
// (partida e lenta, lenta fria, arrancada com o câmbio do preset, pé no fundo em neutro e em plena carga travada, troca de
// carga com o freio-motor ligado onde houver, bancada; notch 1, 4 e 8 e o freio dinâmico nas locomotivas; degraus de carga
// nos geradores; o Jake/freio-motor travado a 1900 rpm; a troca de configuração com o motor funcionando) e compara o hash
// SHA-256 dos dois canais em float 32 (os bytes do WAV) com o retrato `tools/diesel-identidade.json`. Serve para quem
// mexer no laço do DieselDSP (ou no EngineDSP do Ronco) sem querer mudar o som: uma amostra diferente é falha.
//
// Cada cenário roda como na página: config e mensagens no começo de cada bloco de 128 amostras, telemetria pedida a cada
// 1024 amostras por dentro do `process` (o `post` do worklet), as sementes de fábrica (a variável SEMENTE é ignorada). Os
// ouvintes variam entre os cenários (exterior, cofre, cabine, ponteira, rua), para todo ramo do ouvinte passar pela conta.
// Além do hash inteiro, o retrato guarda um hash curto de cada segundo, que diz onde a diferença começou; com `--wav` os
// WAVs são gravados em referencias/_sim/diesel-cpu/wav/ (fora do git) e, se existirem, a comparação diz a primeira amostra
// diferente e a maior diferença.
//
//   npx tsx tools/diesel-identidade.ts [--j N] [--so preset1,preset2] [--wav] [--gravar]
//     sem opção: compara com o retrato e sai ≠ 0 se algum cenário mudar
//     --gravar:  regrava o retrato (só quando a mudança do som é a intenção, com o motivo no commit)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DieselDSP } from '../src/engines/diesel/dsp';
import { configCalibrada } from '../src/engines/diesel/config';
import { PRESETS, PADRAO_DIESEL, type PresetDiesel } from '../src/engines/diesel/presets';
import { gravarWav, lerWav } from './wav';

const SR = 48000, B = 128;
const AQUI = fileURLToPath(import.meta.url);
const RAIZ = path.resolve(path.dirname(AQUI), '..');
const RETRATO = path.join(path.dirname(AQUI), 'diesel-identidade.json');
const PASTA = path.join(RAIZ, 'referencias', '_sim', 'diesel-cpu');
const PASTA_WAV = path.join(PASTA, 'wav');

type Ev = [number, ((d: any) => void) | null];
// `troca`: em `t` s a página manda a config inteira com o escape mudado (`muda`) e depois a carga do portador (`carga`)
type Cen = { nome: string; ouvinte: string; portador: string; eventos: Ev[]; troca?: { t: number; muda: (s: PresetDiesel) => PresetDiesel; carga: Record<string, any> } };

const spec = (id: string) => ({ ...PADRAO_DIESEL, ...PRESETS.find((p) => p.id === id)! }) as PresetDiesel;
const quente = (d: any) => d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } });
const liga = (d: any) => d.message({ type: 'input', ignition: true });
const pedal = (v: number) => (d: any) => d.message({ type: 'input', throttle: v });
const diesel = (m: Record<string, any>) => (d: any) => d.message({ type: 'diesel', ...m });
const partida = (tc: number) => (d: any) => { d.ambientT = tc; d.message({ type: 'input', temp: { mode: 'real', value: tc } }); liga(d); };
// plena carga travada na rotação de potência (a sonda de potência do teste:diesel e o caso do cpu:diesel)
const plena = (s: PresetDiesel) => (d: any) => {
  quente(d);
  const rpm = s.rpmPotencia;
  Object.assign(d, { state: 'run', runT: 30, lockOmega: true, sonda: true, fuelCmd: 1, fuelM: 1, omega: (rpm * Math.PI * 2) / 60, rpmAvg: rpm, tw: 0.95, turboW: 0.95, tEsc: 500 });
  d.boostFixo = s.boost + (d.soprador0 ? d.soprador0(rpm) : 0);
};
// freio-motor travado a 1900 rpm sem combustível (o cenário `jake` do diesel-comum)
const travado1900 = (d: any) => { quente(d); Object.assign(d, { state: 'run', runT: 30, lockOmega: true, omega: (1900 * Math.PI * 2) / 60, rpmAvg: 1900 }); d.message({ type: 'diesel', freioMotor: true }); };
const diametro = (s: PresetDiesel): PresetDiesel => { const e: any = s.escape || {}, dm = e.diametro || 2.5; return { ...s, escape: { ...e, diametro: dm > 3 ? dm - 1 : dm + 0.5 }, ponteira: (s as any).ponteira ?? dm } as PresetDiesel; };

/** os cenários de um preset, na ordem do retrato */
function cenarios(s: PresetDiesel): Cen[] {
  const port = s.portadores, loco = port.includes('locomotiva'), ger = port.includes('gerador'), carro = port.includes('carro');
  const base = loco ? 'locomotiva' : carro ? 'carro' : 'gerador';
  const freio = (s as any).freioMotor && (s as any).freioMotor !== 'nenhum';
  const C: Cen[] = [];
  C.push({ nome: 'partida', ouvinte: 'ext', portador: base, eventos: [[0, partida(20)], ...(loco ? [[6, diesel({ lentaBaixa: true })] as Ev] : []), [10, null]] });
  C.push({ nome: 'lentaFria', ouvinte: 'bay', portador: base, eventos: [[0, partida(-10)], [10, null]] });
  if (carro) {
    C.push({ nome: 'arrancada', ouvinte: 'int', portador: 'carro', eventos: [[0, (d) => { quente(d); liga(d); }], [1.5, (d) => { d.message({ type: 'input', shift: 1 }); pedal(1)(d); }], [10, null]] });
    C.push({ nome: 'peNoFundo', ouvinte: 'ext', portador: 'carro', eventos: [[0, (d) => { quente(d); liga(d); }], [2, pedal(1)], [10, null]] });
    C.push({ nome: 'trocaCarga', ouvinte: 'road', portador: 'carro', eventos: [[0, (d) => { quente(d); liga(d); if (freio) diesel({ freioMotor: true })(d); }], [1, (d) => { d.message({ type: 'input', shift: 1 }); pedal(1)(d); }], [5, pedal(0)], [7.5, pedal(0.4)], [10, null]] });
  }
  if (!loco) C.push({ nome: 'plena', ouvinte: 'pipe', portador: 'nenhum', eventos: [[0, plena(s)], [10, null]] });
  if (freio) C.push({ nome: 'freioTravado', ouvinte: 'ext', portador: 'nenhum', eventos: [[0, travado1900], [10, null]] });
  if (ger) {
    C.push({ nome: 'degraus', ouvinte: 'int', portador: 'gerador', eventos: [[0, (d) => { quente(d); liga(d); }], [2, diesel({ degrau: 0.5 })], [5, diesel({ degrau: 1 })], [8, diesel({ degrau: 0 })], [10, null]] });
    if (!carro) C.push({ nome: 'trocaCarga', ouvinte: 'road', portador: 'gerador', eventos: [[0, (d) => { quente(d); liga(d); }], [1, diesel({ degrau: 1 })], [6, diesel({ degrau: 0 })], [10, null]] });
  }
  if (loco) {
    C.push({ nome: 'notch1', ouvinte: 'int', portador: 'locomotiva', eventos: [[0, (d) => { quente(d); liga(d); }], [1, diesel({ notch: 1 })], [10, null]] });
    C.push({ nome: 'notch4', ouvinte: 'pipe', portador: 'locomotiva', eventos: [[0, (d) => { quente(d); liga(d); }], [1, diesel({ notch: 4 })], [10, null]] });
    // (o caso do cpu:diesel: 12 s para subir ao notch 8 e assentar, e mais 10 s)
    C.push({ nome: 'notch8', ouvinte: 'ext', portador: 'locomotiva', eventos: [[0, (d) => { quente(d); liga(d); diesel({ notch: 8 })(d); }], [22, null]] });
    C.push({ nome: 'trocaCarga', ouvinte: 'road', portador: 'locomotiva', eventos: [[0, (d) => { quente(d); liga(d); }], [0.5, diesel({ notch: 8 })], [6, diesel({ notch: 2 })], [8, diesel({ dinamico: true })], [10, null]] });
  }
  C.push({ nome: 'bancada', ouvinte: 'ext', portador: 'nenhum', eventos: [[0, (d) => { quente(d); liga(d); }], [1, diesel({ govBancada: 'isocrono', rpmAlvo: 0.75 * s.rpmMax, cargaBancada: 0.6 })], [10, null]] });
  // troca de configuração com o motor funcionando (o caminho das redes velhas do EngineDSP), como tools/troca.ts
  if (['hilux28', 'scaniav8', 'gen500', 'emd710'].includes(s.id)) {
    const carga = loco ? { notch: 4 } : ger && !carro ? { degrau: 0.5 } : {};
    C.push({ nome: 'trocaConfig', ouvinte: 'ext', portador: base, troca: { t: 4, muda: diametro, carga }, eventos: [[0, (d) => { quente(d); liga(d); }], [1, diesel(carga)], [10, null]] });
  }
  return C;
}

const cfgCache = new Map<string, any>();
const calibrada = (s: PresetDiesel) => { const k = JSON.stringify(s); if (!cfgCache.has(k)) cfgCache.set(k, configCalibrada(s, SR)); return cfgCache.get(k); };
const h8 = (b: crypto.Hash) => b.digest('hex').slice(0, 8);

/** renderiza um cenário e devolve os hashes (inteiro e por segundo) e os canais */
function renderizar(s: PresetDiesel, c: Cen) {
  const d: any = new DieselDSP(SR);
  d.post = () => {}; // (a telemetria por dentro do process, como no worklet)
  d.message({ type: 'params', params: { listener: c.ouvinte } });
  d.message({ type: 'config', cfg: { ...calibrada(s) } });
  d.message({ type: 'diesel', portador: c.portador });
  const ev: Ev[] = [...c.eventos];
  if (c.troca) {
    const tr = c.troca, novo = calibrada(tr.muda(s));
    ev.splice(ev.length - 1, 0, [tr.t, (x) => { x.message({ type: 'config', cfg: { ...novo } }); x.message({ type: 'diesel', portador: c.portador, ...tr.carga }); }]);
  }
  const T = ev[ev.length - 1][0], n = Math.round(T * SR);
  const L = new Float32Array(n), R = new Float32Array(n), bl = new Float32Array(B), br = new Float32Array(B);
  let ei = 0;
  for (let i = 0; i < n; i += B) {
    const t = i / SR;
    while (ei < ev.length && ev[ei][0] <= t) { ev[ei][1]?.(d); ei++; }
    const k = Math.min(B, n - i);
    d.process(bl, br, k);
    L.set(bl.subarray(0, k), i); R.set(br.subarray(0, k), i);
  }
  const tudo = crypto.createHash('sha256'), seg: string[] = [];
  for (let a = 0; a < n; a += SR) {
    const b = Math.min(n, a + SR), hs = crypto.createHash('sha256');
    const l = Buffer.from(L.buffer, a * 4, (b - a) * 4), r = Buffer.from(R.buffer, a * 4, (b - a) * 4);
    hs.update(l); hs.update(r); seg.push(h8(hs));
  }
  tudo.update(Buffer.from(L.buffer)); tudo.update(Buffer.from(R.buffer));
  const cfg = calibrada(s), cal = crypto.createHash('sha256').update(JSON.stringify([cfg.gain, cfg.mkIdle, cfg.fuelLenta, cfg.refKnock, cfg.powerModel, cfg.tqPeakModel, cfg.frPeakModel]));
  return { hash: tudo.digest('hex'), seg, cal: h8(cal), L, R, rpm: Math.round(d.rpmAvg), estado: d.state };
}

// ------------------------------------------------------------------ processo filho: um preset
const args = process.argv.slice(2);
const opcao = (nome: string) => { const a = args.find((x) => x.startsWith(nome + '=')); if (a) return a.slice(nome.length + 1); const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : undefined; };
if (args[0] === '--filho') {
  const id = args[1], s = spec(id), wav = args.includes('--wav');
  for (const c of cenarios(s)) {
    const t0 = process.cpuUsage(), r = renderizar(s, c), cu = process.cpuUsage(t0);
    if (wav) { fs.mkdirSync(PASTA_WAV, { recursive: true }); gravarWav(path.join(PASTA_WAV, `${id}_${c.nome}.wav`), r.L, r.R, SR); }
    process.stdout.write(JSON.stringify({ chave: `${id} · ${c.nome}`, hash: r.hash, seg: r.seg, cal: r.cal, rpm: r.rpm, estado: r.estado, cpu: (cu.user + cu.system) / 1e6, dur: r.L.length / SR }) + '\n');
  }
} else (async () => {
  // ------------------------------------------------------------------ processo pai
  const gravar = args.includes('--gravar'), wav = args.includes('--wav');
  const so = opcao('--so')?.split(',');
  const j = Math.max(1, +(opcao('--j') ?? Math.max(1, Math.floor(os.cpus().length * 0.75))));
  const ids = PRESETS.map((p) => p.id).filter((id) => !so || so.includes(id));
  // (os mais longos primeiro: as locomotivas têm o notch 8 de 22 s e 16 cilindros)
  ids.sort((a, b) => (spec(b).portadores.includes('locomotiva') ? 1 : 0) - (spec(a).portadores.includes('locomotiva') ? 1 : 0));
  const env = { ...process.env }; delete env.SEMENTE;
  const rodar = (id: string) => new Promise<any[]>((ok) => {
    const p = spawn(process.execPath, ['--import', 'tsx', AQUI, '--filho', id, ...(wav ? ['--wav'] : [])], { env, stdio: ['ignore', 'pipe', 'inherit'] });
    let s = ''; p.stdout!.on('data', (b) => (s += b));
    p.on('close', (cod) => ok(cod === 0 ? s.trim().split('\n').filter(Boolean).map((x) => JSON.parse(x)) : [{ chave: `${id} · (processo saiu com ${cod})`, hash: '', seg: [] }]));
  });
  const t0 = Date.now();
  const res: any[] = [];
  const fila = [...ids];
  await Promise.all(Array.from({ length: Math.min(j, fila.length) }, async () => { while (fila.length) res.push(...(await rodar(fila.shift()!))); }));
  const ordem = new Map(PRESETS.map((p, i) => [p.id, i]));
  res.sort((a, b) => (ordem.get(a.chave.split(' · ')[0])! - ordem.get(b.chave.split(' · ')[0])!) || 0);
  const ret: Record<string, any> = fs.existsSync(RETRATO) ? JSON.parse(fs.readFileSync(RETRATO, 'utf8')) : {};
  let falhas = 0, novos = 0, cpu = 0, dur = 0;
  for (const r of res) {
    cpu += r.cpu || 0; dur += r.dur || 0;
    const e = ret[r.chave];
    if (gravar) { ret[r.chave] = { hash: r.hash, seg: r.seg.join(' '), cal: r.cal }; console.log(`grava ${r.chave} (${r.rpm} rpm, ${r.estado}, ${r.cpu.toFixed(1)} s de CPU para ${r.dur} s)`); continue; }
    if (!e) { novos++; console.log(`novo  ${r.chave}: fora do retrato (rode com --gravar)`); continue; }
    if (e.hash === r.hash) { console.log(`igual ${r.chave} (${r.rpm} rpm, ${r.estado}, ${r.cpu.toFixed(1)} s de CPU para ${r.dur} s)`); continue; }
    falhas++;
    const sv = String(e.seg).split(' '), k = r.seg.findIndex((x: string, i: number) => x !== sv[i]);
    let det = `a partir do segundo ${k}${e.cal !== r.cal ? '; a calibração da sonda também mudou' : ''}`;
    const [id, nome] = r.chave.split(' · '), arq = path.join(PASTA_WAV, `${id}_${nome}.wav`);
    if (fs.existsSync(arq) && !wav) {
      // (com o WAV de referência: a primeira amostra diferente e a maior diferença)
      const ref = lerWav(arq), s = spec(id), c = cenarios(s).find((x) => x.nome === nome)!, x = renderizar(s, c);
      let p = -1, mx = 0;
      for (let i = 0; i < x.L.length; i++) { const dd = Math.max(Math.abs(x.L[i] - ref.canais[0][i]), Math.abs(x.R[i] - ref.canais[1][i])); if (dd > 0 && p < 0) p = i; if (dd > mx) mx = dd; }
      det += `; primeira amostra diferente: ${p} (${(p / SR).toFixed(4)} s), maior diferença ${mx.toExponential(2)}`;
    }
    console.log(`MUDOU ${r.chave}: ${det}`);
  }
  if (gravar) {
    fs.writeFileSync(RETRATO, JSON.stringify(ret, null, 1) + '\n');
    fs.mkdirSync(PASTA, { recursive: true });
    fs.writeFileSync(path.join(PASTA, `identidade-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify(ret, null, 1) + '\n');
    console.log(`retrato regravado: ${res.length} cenários em ${path.relative(RAIZ, RETRATO)} (e uma cópia datada em ${path.relative(RAIZ, PASTA)})`);
  }
  const faltam = gravar || so ? [] : Object.keys(ret).filter((k) => !res.some((r) => r.chave === k));
  for (const k of faltam) console.log(`falta ${k}: está no retrato e não rodou`);
  console.log(`\n${res.length} cenários (${dur.toFixed(0)} s de som, ${cpu.toFixed(0)} s de CPU nos filhos) em ${((Date.now() - t0) / 1000).toFixed(0)} s: ${gravar ? 'gravados' : `${res.length - falhas - novos} iguais, ${falhas} diferentes, ${novos} novos${faltam.length ? `, ${faltam.length} faltando` : ''}`}`);
  process.exitCode = falhas || novos || faltam.length ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(2); });
