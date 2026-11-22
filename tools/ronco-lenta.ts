// Teste de lenta e de corte de giro do Ronco (a regra do docs/PLANO.md: "68 veículos, 20 °C e −5 °C, zero
// apagamentos, e o teste de corte de giro"). Os harnesses antigos (idletest.js, limtest.js) nunca entraram no
// repositório; este os substitui.
//
//   npx tsx tools/ronco-lenta.ts [ids separados por vírgula] [--j N] [--tudo]
//
// Para cada carro, com a calibração da página (`configCalibrada`), em 20 °C e em −5 °C (temperatura real, motor frio):
//   · partida: tem de pegar em menos de 5 s;
//   · lenta: 6 s; uma acelerada curta (0,6 s de pé no fundo) e a volta;
//   · corte: 2,5 s de pé no fundo em ponto morto. Com corte de giro, o pico de rotação fica entre 90 % e 106 % da
//     faixa vermelha (bate no corte e não passa dele); sem corte (`limiter: 'none'`) só se registra o pico; com
//     2-step (Evo, Quattro) o motor segura a rotação de largada, então só o teto de 106 % vale;
//   · volta à lenta: nos 2 s finais o motor está rodando, a rotação média a menos de 20 % do alvo de lenta do DSP
//     (`idleTarget`, que sobe com o motor frio) e nunca abaixo de 55 % dele;
//   · nenhuma amostra NaN/Infinity e pico de saída ≤ 1.
// Depois, a troca de carro com o motor rodando (um DSP só, todos os carros em sequência, 3 s cada): tem de continuar
// rodando e sem NaN (foi assim que apareceu o apagão por NaN do limitador de duas etapas).
// Sai com código ≠ 0 se algum caso falhar. `--tudo` imprime a tabela inteira, não só as falhas.
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PRESETS, ACESSORIOS_PADRAO } from '../src/engines/ronco/presets';
import { EngineDSP } from '../src/engines/ronco/dsp';
import { configCalibrada } from '../src/engines/ronco/config';

const SR = 48000, B = 128;
const TEMPERATURAS = [20, -5];
const args = process.argv.slice(2);
const opcao = (nome: string, padrao: string) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : padrao; };

type Caso = { id: string; temp: number; pegou: number; lenta: number; alvo: number; minimo: number; pico: number; corte: number; redline: number; limiter: string; saida: number; nan: number; falhas: string[] };

function rodarCaso(id: string, temp: number): Caso {
  const p = PRESETS.find((x) => x.id === id)!;
  const cfg = configCalibrada({ ...ACESSORIOS_PADRAO, ...p }, SR);
  const d: any = new EngineDSP(SR);
  d.setConfig(cfg);
  d.message({ type: 'input', temp: { mode: 'real', value: temp } });
  d.message({ type: 'input', ignition: true });
  const eventos: [number, object][] = [[6, { throttle: 1 }], [6.6, { throttle: 0 }], [10, { throttle: 1 }], [12.5, { throttle: 0 }]];
  const T = 18, n = Math.round(T * SR), L = new Float32Array(B), R = new Float32Array(B);
  let ei = 0, pegou = -1, apagou = -1, nan = 0, saida = 0, corte = 0, soma = 0, cont = 0, minimo = Infinity;
  for (let i = 0; i < n; i += B) {
    const t = i / SR;
    while (ei < eventos.length && eventos[ei][0] <= t) { d.message({ type: 'input', ...eventos[ei][1] }); ei++; }
    d.process(L, R, B);
    for (let k = 0; k < B; k++) { const a = Math.abs(L[k]), b = Math.abs(R[k]); if (!(a <= 1e9) || !(b <= 1e9)) nan++; else { if (a > saida) saida = a; if (b > saida) saida = b; } }
    if (pegou < 0 && d.state === 'run') pegou = t;
    if (pegou >= 0 && apagou < 0 && d.state !== 'run') apagou = t;
    if (t >= 10 && t < 13 && d.rpmAvg > corte) corte = d.rpmAvg;
    if (t >= T - 2) { soma += d.rpmAvg; cont++; if (d.rpmAvg < minimo) minimo = d.rpmAvg; }
  }
  const lenta = soma / Math.max(1, cont), alvo = d.idleTarget || cfg.idle, limiter = cfg.limiter || 'ign';
  const falhas: string[] = [];
  if (pegou < 0 || pegou > 5) falhas.push(pegou < 0 ? 'não pegou' : `pegou só em ${pegou.toFixed(1)} s`);
  if (apagou >= 0) falhas.push(`apagou em ${apagou.toFixed(1)} s`);
  if (nan) falhas.push(`${nan} amostras NaN/Infinity`);
  if (saida > 1) falhas.push(`pico de saída ${saida.toFixed(2)}`);
  if (pegou >= 0 && apagou < 0) {
    if (Math.abs(lenta - alvo) / alvo > 0.2) falhas.push(`lenta ${lenta.toFixed(0)} rpm (alvo ${alvo.toFixed(0)})`);
    if (minimo < 0.55 * alvo) falhas.push(`lenta caiu a ${minimo.toFixed(0)} rpm (alvo ${alvo.toFixed(0)})`);
    // (com 2-step, pé no fundo parado e em ponto morto segura a rotação de largada, bem abaixo do corte: só o teto vale)
    const doisTempos = !!cfg.twoStep && cfg.twoStep !== 'off';
    if (limiter !== 'none' && ((!doisTempos && corte < 0.9 * cfg.redline) || corte > 1.06 * cfg.redline)) falhas.push(`corte: pico ${corte.toFixed(0)} rpm (faixa vermelha ${cfg.redline})`);
  }
  return { id, temp, pegou, lenta, alvo, minimo, pico: saida, corte, redline: cfg.redline, limiter, saida, nan, falhas };
}

/** um DSP só, os carros em sequência com o motor rodando: 3 s cada */
function rodarTrocas(ids: string[]): string[] {
  const falhas: string[] = [];
  const d: any = new EngineDSP(SR), L = new Float32Array(B), R = new Float32Array(B);
  let primeiro = true;
  for (const id of ids) {
    const p = PRESETS.find((x) => x.id === id)!;
    d.message({ type: 'config', cfg: configCalibrada({ ...ACESSORIOS_PADRAO, ...p }, SR) });
    if (primeiro) { d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } }); d.message({ type: 'input', ignition: true }); primeiro = false; }
    let nan = 0;
    for (let i = 0; i < 3 * SR; i += B) {
      if (i === SR) d.message({ type: 'input', throttle: 0.6 });
      if (i === Math.round(1.5 * SR / B) * B) d.message({ type: 'input', throttle: 0 });
      d.process(L, R, B);
      for (let k = 0; k < B; k++) if (!(Math.abs(L[k]) <= 1e9)) nan++;
    }
    if (nan) falhas.push(`troca para ${id}: ${nan} amostras NaN`);
    if (d.state !== 'run') { falhas.push(`troca para ${id}: motor ${d.state}`); d.message({ type: 'input', ignition: false }); d.message({ type: 'input', ignition: true }); }
  }
  return falhas;
}

if (args[0] === '--trabalhador') {
  // filho: roda os casos pedidos e devolve JSON por linha
  const ids = args[1].split(',');
  if (args[2] === 'trocas') process.stdout.write(JSON.stringify({ trocas: rodarTrocas(ids) }) + '\n');
  else for (const id of ids) for (const temp of TEMPERATURAS) process.stdout.write(JSON.stringify(rodarCaso(id, temp)) + '\n');
} else {
  const pedidos = args.find((a) => !a.startsWith('--') && a !== opcao('--j', ''));
  const ids = pedidos ? pedidos.split(',') : PRESETS.map((p) => p.id);
  for (const id of ids) if (!PRESETS.some((p) => p.id === id)) { console.error(`preset ${id} não existe`); process.exit(2); }
  const J = Math.max(1, +opcao('--j', String(Math.min(16, Math.max(2, Math.floor(os.cpus().length * 0.5))))));
  const aqui = fileURLToPath(import.meta.url);
  const tsx = path.resolve(path.dirname(aqui), '..', 'node_modules', '.bin', 'tsx');
  const filho = (argv: string[]) => new Promise<any[]>((resolve, reject) => {
    const p = spawn(tsx, [aqui, '--trabalhador', ...argv]);
    let saida = '', erro = '';
    p.stdout.on('data', (x) => (saida += x)); p.stderr.on('data', (x) => (erro += x));
    p.on('close', (codigo) => (codigo === 0 ? resolve(saida.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))) : reject(new Error(erro || `código ${codigo}`))));
  });
  (async () => {
    const t0 = Date.now();
    const fila = [...ids], casos: Caso[] = [];
    const trocas = filho([ids.join(','), 'trocas']);
    await Promise.all(Array.from({ length: J }, async () => { while (fila.length) casos.push(...(await filho([fila.shift()!]))); }));
    const falhasTroca: string[] = (await trocas)[0].trocas;
    casos.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id) || b.temp - a.temp);
    const ruins = casos.filter((c) => c.falhas.length);
    if (args.includes('--tudo')) {
      console.log('| preset | °C | pega (s) | lenta / alvo (rpm) | mínimo | pico no corte / faixa vermelha | corte | saída | |\n|---|---|---|---|---|---|---|---|---|');
      for (const c of casos) console.log(`| ${c.id} | ${c.temp} | ${c.pegou.toFixed(2)} | ${c.lenta.toFixed(0)} / ${c.alvo.toFixed(0)} | ${c.minimo.toFixed(0)} | ${c.corte.toFixed(0)} / ${c.redline} | ${c.limiter} | ${c.saida.toFixed(2)} | ${c.falhas.join('; ') || 'ok'} |`);
    }
    for (const c of ruins) console.log(`FALHA ${c.id} a ${c.temp} °C: ${c.falhas.join(' · ')}`);
    for (const f of falhasTroca) console.log(`FALHA ${f}`);
    const semCorte = casos.filter((c) => c.limiter === 'none' && c.temp === 20).map((c) => `${c.id} ${c.corte.toFixed(0)}/${c.redline}`);
    if (semCorte.length) console.log(`sem corte de giro (pico em ponto morto / faixa vermelha): ${semCorte.join(', ')}`);
    console.log(`${casos.length} casos (${ids.length} carros × ${TEMPERATURAS.length} temperaturas) e ${ids.length} trocas em ${((Date.now() - t0) / 1000).toFixed(0)} s: ` +
      `${casos.length - ruins.length} ok, ${ruins.length} falhas; trocas: ${falhasTroca.length} falhas`);
    process.exit(ruins.length || falhasTroca.length ? 1 : 0);
  })().catch((e) => { console.error(e); process.exit(2); });
}
