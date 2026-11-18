// Roda os portões do projeto em ordem, um de cada vez, e imprime um resumo (o que passou, o que falhou, quanto
// levou). Um de cada vez de propósito: várias medidas são de tempo de CPU e falham com a máquina ocupada.
//
//   npm run verificar            tudo: tipos, paridades, teste:*, lenta:*, build
//   npm run verificar:rapido     o essencial em poucos minutos (paridades em amostra, famílias rápidas, build)
//   npm run verificar -- --navegador     também os roteiros de navegador (pedem Chromium em /usr/bin/chromium)
//   npm run verificar -- --so diesel,cena     só os passos cujo nome contém um dos trechos
//   npm run verificar -- --parar              para na primeira falha
//
// A saída inteira de cada passo fica numa pasta temporária (o caminho aparece no fim). Sai com código ≠ 0 se
// algum passo falhar.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const RAPIDO = args.includes('--rapido');
const NAVEGADOR = args.includes('--navegador');
const PARAR = args.includes('--parar');
const iSo = args.indexOf('--so');
const SO = iSo >= 0 ? args[iSo + 1].split(',') : null;

// [script do package.json, argumentos extras]
const COMPLETO = [
  ['typecheck'],
  ['paridade:acoustics'], ['paridade:ronco'], ['paridade:turbina'],
  ['teste:cena'], ['teste:passagem'], ['teste:diesel'], ['teste:radial'], ['teste:rotativo'], ['teste:eletrico'], ['teste:vapor'],
  ['lenta:ronco'], ['lenta:diesel'], ['lenta:radial'], ['lenta:rotativo'], ['lenta:eletrico'], ['lenta:vapor'],
  ['troca:diesel'], ['geometria:radial'],
  ['build'],
];
const RAPIDOS = [
  ['typecheck'],
  ['paridade:acoustics'], ['paridade:ronco', '--rapido'], ['paridade:turbina', 'narrow,fighter,regional,sst'],
  ['geometria:radial'], ['teste:rotativo'], ['teste:eletrico'], ['teste:vapor'],
  ['lenta:rotativo'], ['lenta:eletrico'], ['lenta:vapor'],
  ['build'],
];
const NAVEGADORES = ['ronco', 'turbina', 'diesel', 'radial', 'rotativo', 'eletrico', 'vapor', 'passagem'].map((f) => [`navegador:${f}`]);

let passos = RAPIDO ? RAPIDOS : COMPLETO;
if (NAVEGADOR) passos = [...passos, ...NAVEGADORES]; // (depois do build: eles servem o dist/)
if (SO) passos = passos.filter(([nome]) => SO.some((t) => nome.includes(t)));
if (!passos.length) { console.error('nenhum passo com esse nome'); process.exit(2); }

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-verificar-'));
const duracao = (s) => (s >= 90 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${s.toFixed(0)} s`);

function rodar([nome, ...extras]) {
  return new Promise((resolve) => {
    const log = path.join(pasta, nome.replace(/:/g, '-') + '.log');
    const saida = fs.createWriteStream(log);
    const t0 = Date.now();
    const p = spawn('npm', ['run', '-s', nome, ...(extras.length ? ['--', ...extras] : [])], { cwd: RAIZ, stdio: ['ignore', 'pipe', 'pipe'] });
    let fim = '';
    const guardar = (x) => { saida.write(x); fim = (fim + x).slice(-4000); };
    p.stdout.on('data', guardar); p.stderr.on('data', guardar);
    p.on('close', (codigo) => {
      saida.end();
      const linhas = fim.split('\n').map((l) => l.trim()).filter(Boolean);
      resolve({ nome: [nome, ...extras].join(' '), ok: codigo === 0, codigo, s: (Date.now() - t0) / 1000, ultima: (linhas[linhas.length - 1] || '').slice(0, 110), log });
    });
  });
}

const t0 = Date.now();
const resultados = [];
console.log(`${RAPIDO ? 'verificar:rapido' : 'verificar'}: ${passos.length} passos, um de cada vez (saídas em ${pasta})\n`);
for (let i = 0; i < passos.length; i++) {
  process.stdout.write(`[${String(i + 1).padStart(2)}/${passos.length}] ${passos[i].join(' ')} … `);
  const r = await rodar(passos[i]);
  resultados.push(r);
  console.log(`${r.ok ? 'ok' : `FALHA (código ${r.codigo})`} · ${duracao(r.s)}${r.ultima ? ` · ${r.ultima}` : ''}`);
  if (!r.ok && PARAR) break;
}

const falhas = resultados.filter((r) => !r.ok);
console.log('\n| Passo | Resultado | Tempo |\n|---|---|---|');
for (const r of resultados) console.log(`| ${r.nome} | ${r.ok ? 'ok' : 'FALHA'} | ${duracao(r.s)} |`);
console.log(`\n${resultados.length - falhas.length}/${resultados.length} passos ok em ${duracao((Date.now() - t0) / 1000)}.`);
for (const r of falhas) console.log(`FALHA ${r.nome}: veja ${r.log}`);
if (!falhas.length) console.log('VERIFICAÇÃO OK');
process.exit(falhas.length ? 1 : 0);
