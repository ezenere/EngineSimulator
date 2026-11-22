// Serve o `dist/` (gerado por `npm run build`) em http://127.0.0.1:<porta>/data/engine/, o mesmo caminho do site,
// e opcionalmente roda um comando contra ele.
//
//   node tools/servir-dist.mjs                       só serve (Ctrl+C para parar)
//   node tools/servir-dist.mjs [--porta N] <comando> [argumentos…]
//
// Nos argumentos, `{url}` vira a base servida (sem a barra final): por exemplo
//   node tools/servir-dist.mjs node tools/ronco-navegador.mjs {url}/ronco.html
// O servidor para quando o comando termina e o código de saída é o do comando. Sem `--porta`, o sistema escolhe uma
// porta livre (os roteiros de navegador podem rodar em sequência sem colidir).
//
// É o que os `npm run navegador:ronco` e `navegador:turbina` usam: esses dois roteiros exigiam a URL na linha de
// comando; os das outras famílias já servem o `dist/` sozinhos.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(RAIZ, 'dist');
const PREFIXO = '/data/engine';
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.ktx2': 'image/ktx2', '.md': 'text/markdown; charset=utf-8',
};

const args = process.argv.slice(2);
let porta = 0;
if (args[0] === '--porta') { porta = +args[1]; args.splice(0, 2); }
if (args[0] === '--') args.shift();

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist/index.html não existe: rode `npm run build` antes.');
  process.exit(2);
}

const servidor = http.createServer((req, res) => {
  let caminho = decodeURIComponent((req.url || '/').split('?')[0]);
  if (!caminho.startsWith(PREFIXO)) { res.writeHead(404).end('fora de ' + PREFIXO); return; }
  caminho = caminho.slice(PREFIXO.length) || '/';
  if (caminho.endsWith('/')) caminho += 'index.html';
  const arquivo = path.join(DIST, path.normalize(caminho));
  if (!arquivo.startsWith(DIST + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(arquivo, (erro, dados) => {
    if (erro) { res.writeHead(404).end('não achei ' + caminho); return; }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arquivo).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(dados);
  });
});

servidor.listen(porta, '127.0.0.1', () => {
  const base = `http://127.0.0.1:${servidor.address().port}${PREFIXO}`;
  if (!args.length) { console.log(`servindo dist/ em ${base}/ (Ctrl+C para parar)`); return; }
  const [comando, ...resto] = args.map((a) => a.replaceAll('{url}', base));
  console.log(`servindo dist/ em ${base}/ · ${comando} ${resto.join(' ')}`);
  const filho = spawn(comando, resto, { cwd: RAIZ, stdio: 'inherit' });
  const fim = (codigo) => { servidor.close(); process.exit(codigo); };
  filho.on('error', (e) => { console.error(`não consegui rodar ${comando}: ${e.message}`); fim(2); });
  filho.on('close', (codigo, sinal) => fim(codigo ?? (sinal ? 1 : 0)));
});
