// Identidade amostra a amostra por família (o mesmo método de tools/diesel-identidade.ts, para o Ronco, o Radial, os
// Rotativos e o Vapor): renderiza cada preset em várias condições e compara o SHA-256 de todos os canais de saída em
// float 32 com o retrato `tools/identidade-<família>.json`. É o portão de quem otimiza o laço de amostra sem querer mudar o
// som: uma amostra diferente é falha. O Diesel tem a dele (tools/diesel-identidade.ts, 125 cenários).
//
// Como na página: a configuração calibrada chega por mensagem (`config`; a página calibra na thread principal), as
// mensagens entram no começo de cada bloco de 128 amostras, a telemetria é pedida por dentro do `process` (o `post` do
// worklet) e o `process` recebe os quatro canais do nó (os dois de saída e os dois do envio para a reverberação, que
// também entram no hash). As sementes são as de fábrica (a variável SEMENTE é ignorada). Os ouvintes variam entre os
// cenários. O Vapor roda como no teste de lenta: o MotorVapor no portador de uso real (locomotiva, trator, gerador,
// carro, barco), com a caldeira de verdade, e o hash é o de cada canal de fonte que o portador entrega à Cena.
//
// Além do hash inteiro, o retrato guarda um hash curto de cada segundo, que diz onde a diferença começou.
//
//   npx tsx tools/identidade.ts <ronco|radial|rotativo|vapor> [--gravar] [--so id1,id2] [--j N]
//     sem opção: compara com o retrato e sai ≠ 0 se algum cenário mudar
//     --gravar:  regrava o retrato (só quando a mudança do som é a intenção, com o motivo no commit)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SR = 48000, B = 128;
const AQUI = fileURLToPath(import.meta.url);
const RAIZ = path.resolve(path.dirname(AQUI), '..');
const retrato = (fam: string) => path.join(path.dirname(AQUI), `identidade-${fam}.json`);

type Ev = [number, ((d: any) => void) | null];
/** um cenário: eventos no tempo (o último, nulo, marca o fim), ouvinte, e o que roda antes de cada bloco */
type Cen = { nome: string; ouvinte?: string; env?: string; eventos: Ev[]; cada?: (d: any, t: number) => void };
type Familia = {
  ids: () => string[];
  cenarios: (id: string) => Promise<Cen[]>;
  /** monta o motor do cenário e devolve o passo de um bloco (os canais saem em `canais`) */
  montar: (id: string, c: Cen) => Promise<{ d: any; canais: Float32Array[]; bloco: () => void }>;
};

const quente = (d: any) => d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } });
const liga = (d: any) => d.message({ type: 'input', ignition: true });
const pedal = (v: number) => (d: any) => d.message({ type: 'input', throttle: v });
const partida = (tc: number) => (d: any) => { (d.ativo ?? d).ambientT = tc; d.message({ type: 'input', temp: { mode: 'real', value: tc } }); liga(d); };
const cache = new Map<string, any>();
const calibrada = (f: (s: any, sr: number) => any, s: any) => { const k = JSON.stringify(s); if (!cache.has(k)) cache.set(k, f(s, SR)); return cache.get(k); };

/** o nó do EngineDSP como no worklet: saída e envio, telemetria por dentro, a config calibrada por mensagem */
function noDeAudio(d: any, c: Cen, cfg: any) {
  d.post = () => {};
  d.message({ type: 'params', params: { listener: c.ouvinte || 'ext', ...(c.env ? { env: c.env } : {}) } });
  d.message({ type: 'config', cfg: { ...cfg } });
  const canais = [new Float32Array(B), new Float32Array(B), new Float32Array(B), new Float32Array(B)];
  return { d, canais, bloco: () => d.process(canais[0], canais[1], B, canais[2], canais[3]) };
}

// ------------------------------------------------------------------ famílias
const FAMILIAS: Record<string, () => Promise<Familia>> = {
  // Ronco: os 78 presets da página (carros, motos, aviação e helicópteros), com os acessórios de fábrica
  ronco: async () => {
    const { EngineDSP } = await import('../src/engines/ronco/dsp');
    const { configCalibrada } = await import('../src/engines/ronco/config');
    const { PRESETS_PAGINA, ACESSORIOS_PADRAO } = await import('../src/engines/ronco/presets');
    const spec = (id: string) => ({ ...ACESSORIOS_PADRAO, ...PRESETS_PAGINA.find((p: any) => p.id === id)! }) as any;
    return {
      ids: () => PRESETS_PAGINA.map((p: any) => p.id),
      cenarios: async (id) => {
        const s = spec(id), red = s.redline || 6000;
        const C: Cen[] = [
          // partida a 20 °C (o de inércia da aviação engata aos 0,5 s, como no teste de lenta do radial)
          { nome: 'partida', ouvinte: 'ext', eventos: [[0, partida(20)], [0.5, (d) => d.engatar?.()], [10, null]] },
          // em ponto morto: pé no fundo até o corte e solta (a desaceleração: corte de combustível, estouros, mapas)
          { nome: 'rev', ouvinte: 'pipe', eventos: [[0, (d) => { quente(d); liga(d); }], [0.5, (d) => d.engatar?.()], [3, pedal(1)], [6.5, pedal(0)], [10, null]] },
          // arrancada de pé no fundo, trocas perto do corte até a 3ª, e solta; da rua (o carro passa)
          { nome: 'arrancada', ouvinte: 'road', eventos: [[0, (d) => { quente(d); liga(d); }], [0.5, (d) => d.engatar?.()], [2, (d) => { d.message({ type: 'input', shift: 1 }); pedal(1)(d); }], [8.5, pedal(0)], [10, null]],
            cada: (d) => { if (d.gear > 0 && d.locked && d.rpmAvg > red * 0.96 && d.gear < 3 && !d.shifting) d.message({ type: 'input', shift: 1 }); } },
          // rotação travada em carga: três patamares (o turbo e o compressor cheios)
          { nome: 'carga', ouvinte: 'bay', eventos: [[0, (d) => { quente(d); Object.assign(d, { state: 'run', ignition: true, runT: 100, lockOmega: true, thrTarget: 1, thr: 1 }); }],
            ...[0.35, 0.6, 0.9].map((f, i) => [i * 2, (d: any) => { d.omega = (red * f * Math.PI * 2) / 60; d.rpmAvg = red * f; }] as Ev), [6, null]] },
          // lenta na cabine, dentro do túnel (o zumbido da ventilação do ambiente)
          { nome: 'tunel', ouvinte: 'int', env: 'tunnel', eventos: [[0, (d) => { quente(d); liga(d); }], [0.5, (d) => d.engatar?.()], [6, null]] },
        ];
        // troca de configuração com o motor funcionando (as redes velhas do EngineDSP), como tools/troca.ts
        if (['mustang', 'fusca', 'supra', 'c172'].includes(id)) C.push({ nome: 'trocaConfig', ouvinte: 'ext', eventos: [[0, (d) => { quente(d); liga(d); }], [0.5, (d) => d.engatar?.()], [4, (d) => d.message({ type: 'config', cfg: { ...calibrada(configCalibrada, { ...s, pipeD: (s.pipeD || 2.5) > 2.2 ? 2.0 : 2.5 }) } })], [8, null]] });
        return C;
      },
      montar: async (id, c) => noDeAudio(new EngineDSP(SR), c, calibrada(configCalibrada, spec(id))),
    };
  },
  // Radial: os 17 presets, no RadialDSP da página
  radial: async () => {
    const { RadialDSP } = await import('../src/engines/radial/dsp');
    const { configCalibrada } = await import('../src/engines/radial/config');
    const { PRESETS_RADIAL, PADRAO_RADIAL } = await import('../src/engines/radial/presets');
    const spec = (id: string) => ({ ...PADRAO_RADIAL, ...PRESETS_RADIAL.find((p: any) => p.id === id)! }) as any;
    // motor quente, já funcionando na lenta (tools/radial-comum.ts, `quente`): a partida de um radial é um procedimento
    const funcionando = (s: any) => (d: any) => {
      quente(d);
      Object.assign(d, { coolant: 90, ambientT: 20, state: 'run', ignition: true, runT: 120, fase: 'pegou', omega: (s.idle * 2 * Math.PI) / 60, rpmAvg: s.idle, exhT: 320, warm: 1 });
    };
    return {
      ids: () => PRESETS_RADIAL.map((p: any) => p.id),
      cenarios: async (id) => {
        const s = spec(id);
        const C: Cen[] = [
          // a partida de verdade a 20 °C (arranque, contagem de pás, magnetos no automático; o de inércia engata aos 0,5 s)
          { nome: 'partida', ouvinte: 'ext', eventos: [[0, partida(20)], [0.5, (d) => d.engatar?.()], [12, null]] },
          // quente, manete toda aos 1 s, subindo de giro (o caso do cpu:radial)
          { nome: 'subida', ouvinte: 'pipe', eventos: [[0, funcionando(s)], [1, pedal(1)], [10, null]] },
          // manete a 60 % e solta (estouros e falhas da desaceleração)
          { nome: 'meiaManete', ouvinte: 'int', eventos: [[0, funcionando(s)], [1, pedal(0.6)], [5, pedal(0)], [9, null]] },
          { nome: 'rua', ouvinte: 'road', eventos: [[0, funcionando(s)], [1, pedal(0.4)], [6, null]] },
        ];
        if (['r1340', 'r1830'].includes(id)) C.push({ nome: 'trocaConfig', ouvinte: 'ext', eventos: [[0, funcionando(s)], [4, (d) => d.message({ type: 'config', cfg: { ...calibrada(configCalibrada, { ...s, escape: { ...s.escape, Oanel: (s.escape?.Oanel ?? 80) + 15 } }) } })], [8, null]] });
        return C;
      },
      montar: async (id, c) => noDeAudio(new RadialDSP(SR), c, calibrada(configCalibrada, spec(id))),
    };
  },
  // Rotativos: os 16 presets da página (Wankel, X e o de palhetas), no RotativosDSP da página
  rotativo: async () => {
    const { RotativosDSP } = await import('../src/engines/rotativo/rotativos');
    const { configCalibrada } = await import('../src/engines/rotativo/config');
    const { PRESETS_ROTATIVO, PADRAO_ROTATIVO } = await import('../src/engines/rotativo/presets');
    const spec = (id: string) => ({ ...PADRAO_ROTATIVO, ...PRESETS_ROTATIVO.find((p: any) => p.id === id)! }) as any;
    // (tools/rotativo-comum.ts: `quente` e `travar`, no RotativoDSP de dentro do nó)
    const funcionando = (rpm: number) => (w: any) => {
      quente(w); const d = w.rot;
      Object.assign(d, { coolant: 90, ambientT: 20, state: 'run', ignition: true, runT: 120, warm: 1, omega: (rpm * 2 * Math.PI) / 60, rpmAvg: rpm, exhT: 450 });
    };
    const travar = (rpm: number, thr: number) => (w: any) => Object.assign(w.rot, { lockOmega: true, omega: (rpm * 2 * Math.PI) / 60, rpmAvg: rpm, thrTarget: thr, thr });
    return {
      ids: () => PRESETS_ROTATIVO.map((p: any) => p.id),
      cenarios: async (id) => {
        const s = spec(id), pal = s.tipo === 'palhetas', rM = s.rpmMax || s.redline || 7000;
        const C: Cen[] = [
          { nome: 'partida', ouvinte: 'ext', eventos: [[0, partida(20)], [10, null]] },
          { nome: 'rev', ouvinte: 'pipe', eventos: [[0, (d) => { quente(d); liga(d); }], [3, pedal(1)], [6.5, pedal(0)], [10, null]] },
          { nome: 'arrancada', ouvinte: 'road', eventos: [[0, (d) => { quente(d); liga(d); }], [2, (d) => { d.message({ type: 'input', shift: 1 }); pedal(1)(d); }], [8.5, pedal(0)], [10, null]] },
        ];
        if (!pal) {
          // plena carga travada a 70 % da máxima (os turbos cheios) e sustentado em ponto morto a 85 % (os casos do cpu:rotativo)
          C.push({ nome: 'carga', ouvinte: 'bay', eventos: [[0, (w) => { funcionando(0.7 * rM)(w); travar(0.7 * rM, 1)(w); }], [6, null]] });
          C.push({ nome: 'sustentado', ouvinte: 'int', eventos: [[0, (w) => { funcionando(0.85 * rM)(w); travar(0.85 * rM, 0.6)(w); }], [6, null]],
            cada: (w) => { const x = w.rot; x.thrTarget = Math.min(1, Math.max(0.005, x.thrTarget - (2e-4 * x.tqMean) / Math.max(1, x.Tmax / 100))); } });
        }
        if (['rx7fc', 'rx8hp'].includes(id)) C.push({ nome: 'trocaConfig', ouvinte: 'ext', eventos: [[0, (d) => { quente(d); liga(d); }], [4, (d) => d.message({ type: 'config', cfg: { ...calibrada(configCalibrada, { ...s, escape: { ...s.escape, Dp: (s.escape?.Dp ?? 50) + 8 } }) } })], [8, null]] });
        return C;
      },
      montar: async (id, c) => noDeAudio(new RotativosDSP(SR), c, calibrada(configCalibrada, spec(id))),
    };
  },
  // Vapor: os 14 presets, o MotorVapor no portador de uso real, com a caldeira de verdade (tools/vapor-lenta.ts)
  vapor: async () => {
    const { presetVapor, PRESETS_VAPOR } = await import('../src/engines/vapor/presets');
    const { MotorVapor, prepararMotorVapor } = await import('../src/engines/vapor/motor');
    const { montarPortadorVapor, configPortadorVapor } = await import('../src/carriers/portadores-vapor');
    const cmd = (c: any) => (p: any) => p.comandar({ pedal: 0, ...c });
    return {
      ids: () => PRESETS_VAPOR.map((p: any) => p.id),
      cenarios: async (id) => {
        const P: any = presetVapor(id)!, tipo = P.portadores[0], estac = P.familia === 'estacionaria', trator = tipo === 'trator';
        const C: Cen[] = [];
        if (estac) {
          C.push({ nome: 'governador', eventos: [[0, (p) => { p.m.govLigado = true; p.m.rpmAlvo = P.rpmGovernado ?? 75; cmd({ cargaFracao: 0.5 })(p); }], [6, cmd({ cargaFracao: 1 })], [10, cmd({ cargaFracao: 0.2, apito: 1 })], [12, cmd({ apito: 0 })], [14, null]] });
        } else {
          // parado, arrancada no trilho molhado com as torneiras no automático, apito e sino, e a deriva (regulador 0)
          C.push({ nome: 'arrancada', eventos: [[0, cmd({ regulador: 0, cutoff: 0.6, marcha: trator ? 1 : undefined, cargaFracao: 0 })],
            [2, cmd({ trilho: 'molhado', cutoff: (0.8 - 0.15) / 0.7, regulador: 0.3, torneiras: 'auto', marcha: trator ? 1 : undefined })],
            [5, cmd({ regulador: 0.8, apito: 1, sino: true })], [6.5, cmd({ apito: 0 })], [12, cmd({ regulador: 0 })], [14, null]] });
          // cruzeiro com a velocidade imposta (60 % da máxima, corte 30 %) e a deriva
          const vms = (0.6 * P.vMax) / 3.6;
          C.push({ nome: 'cruzeiro', eventos: [[0, (p) => { cmd({ regulador: 1, cutoff: (0.3 - 0.15) / 0.7, trilho: 'seco', velocidadeFixa: vms, marcha: trator ? 2 : undefined, bombaAr: true, injetor: true })(p); p.m.fixar({ regulador: 1, cutoff: (0.3 - 0.15) / 0.7 }); }],
            [6, (p) => { cmd({ regulador: 0 })(p); p.m.fixar({ regulador: 0 }); }], [10, null]] });
        }
        return C;
      },
      montar: async (id) => {
        const P: any = presetVapor(id)!, tipo = P.portadores[0];
        const m: any = new MotorVapor(SR); m.configurar(calibrada((s: any, sr: number) => prepararMotorVapor(s, sr), P), SR);
        const conf = { ...configPortadorVapor(tipo, id, 0), ...(tipo === 'locomotiva' ? { vagoes: 0 } : {}) };
        const p: any = montarPortadorVapor(tipo, conf, m, SR)!;
        if (tipo === 'locomotiva') p.cargaT.definirMassa(P.massa + (P.tender?.massa ?? 0) + 300);
        p.m = m;
        const canais = p.fontes().map(() => new Float32Array(B));
        return { d: p, canais, bloco: () => p.processar(canais, B, 1 / SR) };
      },
    };
  },
};

const h8 = (b: crypto.Hash) => b.digest('hex').slice(0, 8);

/** renderiza um cenário: hash de todos os canais (inteiro e por segundo) */
async function renderizar(f: Familia, id: string, c: Cen) {
  const { d, canais, bloco } = await f.montar(id, c);
  const ev = [...c.eventos], T = ev[ev.length - 1][0], n = Math.round(T * SR);
  const out = canais.map(() => new Float32Array(n));
  let ei = 0;
  for (let i = 0; i < n; i += B) {
    const t = i / SR;
    while (ei < ev.length && ev[ei][0] <= t) { ev[ei][1]?.(d); ei++; }
    c.cada?.(d, t);
    bloco();
    const k = Math.min(B, n - i);
    for (let j = 0; j < canais.length; j++) out[j].set(canais[j].subarray(0, k), i);
  }
  const tudo = crypto.createHash('sha256'), seg: string[] = [];
  for (let a = 0; a < n; a += SR) {
    const b = Math.min(n, a + SR), hs = crypto.createHash('sha256');
    for (const x of out) hs.update(Buffer.from(x.buffer, a * 4, (b - a) * 4));
    seg.push(h8(hs));
  }
  for (const x of out) tudo.update(Buffer.from(x.buffer));
  let nan = false; for (const x of out) for (let i = 0; i < x.length; i += 7) if (!Number.isFinite(x[i])) { nan = true; break; }
  return { hash: tudo.digest('hex'), seg, dur: n / SR, nan, rpm: Math.round((d.ativo ?? d).rpmAvg ?? (d.m?.eixo?.omega ?? 0) * 9.549), estado: (d.ativo ?? d).state ?? '' };
}

const args = process.argv.slice(2);
const opcao = (nome: string) => { const a = args.find((x) => x.startsWith(nome + '=')); if (a) return a.slice(nome.length + 1); const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : undefined; };
if (args[0] === '--filho') {
  // processo filho: todos os cenários de um preset (a calibração fica em cache entre eles)
  (async () => {
    const [, fam, id] = args, f = await FAMILIAS[fam]();
    for (const c of await f.cenarios(id)) {
      const t0 = process.cpuUsage(), r = await renderizar(f, id, c), cu = process.cpuUsage(t0);
      process.stdout.write(JSON.stringify({ chave: `${id} · ${c.nome}`, ...r, cpu: (cu.user + cu.system) / 1e6 }) + '\n');
    }
  })().catch((e) => { console.error(e); process.exit(2); });
} else (async () => {
  const fam = args[0];
  if (!FAMILIAS[fam]) { console.error(`uso: tools/identidade.ts <${Object.keys(FAMILIAS).join('|')}> [--gravar] [--so id1,id2] [--j N] (o Diesel: tools/diesel-identidade.ts)`); process.exit(2); }
  const gravar = args.includes('--gravar'), so = opcao('--so')?.split(',');
  const j = Math.max(1, +(opcao('--j') ?? Math.max(1, Math.floor(os.cpus().length * 0.75))));
  const f = await FAMILIAS[fam]();
  const todos = f.ids(), ids = todos.filter((id) => !so || so.includes(id));
  const env = { ...process.env }; delete env.SEMENTE;
  const rodar = (id: string) => new Promise<any[]>((ok) => {
    const p = spawn(process.execPath, ['--import', 'tsx', AQUI, '--filho', fam, id], { env, cwd: RAIZ, stdio: ['ignore', 'pipe', 'inherit'] });
    let s = ''; p.stdout!.on('data', (b) => (s += b));
    p.on('close', (cod) => ok(cod === 0 ? s.trim().split('\n').filter(Boolean).map((x) => JSON.parse(x)) : [{ chave: `${id} · (processo saiu com ${cod})`, hash: '', seg: [] }]));
  });
  const t0 = Date.now(), res: any[] = [], fila = [...ids];
  await Promise.all(Array.from({ length: Math.min(j, fila.length) }, async () => { while (fila.length) res.push(...(await rodar(fila.shift()!))); }));
  const ordem = new Map(todos.map((id, i) => [id, i]));
  res.sort((a, b) => ordem.get(a.chave.split(' · ')[0])! - ordem.get(b.chave.split(' · ')[0])!);
  const arq = retrato(fam), ret: Record<string, any> = fs.existsSync(arq) ? JSON.parse(fs.readFileSync(arq, 'utf8')) : {};
  let falhas = 0, novos = 0, cpu = 0, dur = 0;
  for (const r of res) {
    cpu += r.cpu || 0; dur += r.dur || 0;
    const info = `${r.rpm} rpm, ${r.estado || '—'}${r.nan ? ', NaN' : ''}, ${(r.cpu ?? 0).toFixed(1)} s de CPU para ${r.dur} s`;
    if (!r.hash) { falhas++; console.log(`ERRO  ${r.chave}`); continue; }
    if (gravar) { ret[r.chave] = { hash: r.hash, seg: r.seg.join(' ') }; console.log(`grava ${r.chave} (${info})`); continue; }
    const e = ret[r.chave];
    if (!e) { novos++; console.log(`novo  ${r.chave}: fora do retrato (rode com --gravar)`); continue; }
    if (e.hash === r.hash) { console.log(`igual ${r.chave} (${info})`); continue; }
    falhas++;
    const sv = String(e.seg).split(' '), k = r.seg.findIndex((x: string, i: number) => x !== sv[i]);
    console.log(`MUDOU ${r.chave}: a partir do segundo ${k}`);
  }
  if (gravar && !so) {
    fs.writeFileSync(arq, JSON.stringify(ret, null, 1) + '\n');
    const pasta = path.join(RAIZ, 'referencias', '_sim', 'cpu');
    fs.mkdirSync(pasta, { recursive: true });
    fs.writeFileSync(path.join(pasta, `identidade-${fam}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify(ret, null, 1) + '\n');
    console.log(`retrato regravado: ${res.length} cenários em ${path.relative(RAIZ, arq)} (e uma cópia datada em referencias/_sim/cpu/)`);
  } else if (gravar) console.log('(--gravar com --so não regrava o retrato: rode a família inteira)');
  const faltam = gravar || so ? [] : Object.keys(ret).filter((k) => !res.some((r) => r.chave === k));
  for (const k of faltam) console.log(`falta ${k}: está no retrato e não rodou`);
  console.log(`\n${fam}: ${res.length} cenários (${dur.toFixed(0)} s de som, ${cpu.toFixed(0)} s de CPU nos filhos) em ${((Date.now() - t0) / 1000).toFixed(0)} s: ${gravar ? 'gravados' : `${res.length - falhas - novos} iguais, ${falhas} diferentes, ${novos} novos${faltam.length ? `, ${faltam.length} faltando` : ''}`}`);
  process.exitCode = falhas || novos || faltam.length ? 1 : 0;
})().catch((e) => { console.error(e); process.exit(2); });
