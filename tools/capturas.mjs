// Capturas de tela de todas as páginas, em várias larguras e estados, para a auditoria visual (docs/AUDITORIA-UI.md).
// Fala CDP direto com o Chromium headless, sem dependências (o padrão de tools/*-navegador.mjs).
//
//   node tools/capturas.mjs [--saida pasta] [--paginas menu,ronco,…] [--larguras 1440,1100,768,400]
//                           [--estados regex] [--so-parado] [--url http://…/] [--porta N] [--sem-auditoria]
//
// Sem --url, serve o dist/ (rode npm run build antes) em http://127.0.0.1:<porta+1>/data/engine/, como no site.
// --saida: pasta dos PNG (padrão .claude/capturas/agora/, fora do git). --estados filtra os estados pelo nome (o roteiro
// roda inteiro, só as capturas são filtradas); --so-parado para depois do primeiro estado de cada página (uns 5 minutos
// para as 36 combinações: serve para refazer só a auditoria automática).
//
// Para cada página × largura o roteiro da página passa pelos estados (parado, motor ligado em lenta, acelerando, painel
// rolado, um preset de cada família e os estados próprios de cada página) e grava `<página>-<largura>-<estado>.png`:
//   · captura da janela (o que cabe na tela);
//   · `-inteira`: a página toda, quando ela rola (larguras estreitas);
//   · `-painel-N`: o painel lateral rolado de tela em tela, quando ele rola por dentro (telas largas).
// Junto vai `relatorio.json`, com a auditoria automática de cada captura principal: transbordo horizontal, elementos
// para fora da janela, texto cortado, rolagem dupla, controles e canvas sem nome acessível, contraste abaixo de AA,
// ids repetidos, letras miúdas e alvos de toque pequenos. `--sem-auditoria` pula essa parte.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opc = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const porta = +opc('--porta', 9620);
const saida = path.resolve(RAIZ, opc('--saida', '.claude/capturas/agora'));
const larguras = opc('--larguras', '1440,1100,768,400').split(',').map(Number);
const filtroEstados = opc('--estados') ? new RegExp(opc('--estados')) : null;
const semAuditoria = args.includes('--sem-auditoria');
const soParado = args.includes('--so-parado');
const FIM = '__fim do roteiro__';
const ALTURAS = { 1440: 900, 1100: 800, 768: 1024, 400: 800 };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(saida, { recursive: true });

// ------------------------------------------------------------------ servidor do dist/ em /data/engine/
let base = opc('--url');
let servidor = null;
if (!base) {
  const dist = path.join(RAIZ, 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) { console.error('dist/index.html não existe: rode npm run build'); process.exit(2); }
  const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };
  servidor = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!u.startsWith('/data/engine/')) { res.writeHead(404); res.end(); return; }
    const arq = path.normalize(path.join(dist, u.slice('/data/engine/'.length) || 'index.html'));
    if (!arq.startsWith(dist) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': tipos[path.extname(arq)] || 'application/octet-stream' });
    fs.createReadStream(arq).pipe(res);
  });
  await new Promise((r) => servidor.listen(porta + 1, '127.0.0.1', r));
  base = `http://127.0.0.1:${porta + 1}/data/engine/`;
}
if (!base.endsWith('/')) base += '/';

// ------------------------------------------------------------------ Chromium por CDP
const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'capturas-'));
const logs = [];
const chrome = spawn(process.env.CHROMIUM || '/usr/bin/chromium', ['--headless=new', `--remote-debugging-port=${porta}`, '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--mute-audio', `--user-data-dir=${perfil}`, 'about:blank'], { stdio: 'ignore' });
let alvo;
for (let i = 0; i < 50 && !alvo; i++) { await espera(200); try { alvo = (await (await fetch(`http://127.0.0.1:${porta}/json`)).json()).find((t) => t.type === 'page'); } catch {} }
if (!alvo) { console.error('o Chromium não abriu'); process.exit(2); }
const ws = new WebSocket(alvo.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0; const pend = new Map();
let pagAtual = '';
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(m.params.type)) logs.push(`${pagAtual}: console.${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  if (m.method === 'Runtime.exceptionThrown') logs.push(`${pagAtual}: EXCEÇÃO: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) logs.push(`${pagAtual}: HTTP ${m.params.response.status}: ${m.params.response.url}`);
});
const cmd = (method, params = {}) => new Promise((r) => { const i = ++seq; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await cmd('Runtime.enable'); await cmd('Network.enable'); await cmd('Page.enable');

const ev = async (expr) => {
  const r = await cmd('Runtime.evaluate', { expression: `(async () => JSON.stringify(await (${expr})))()`, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.result?.exceptionDetails) throw new Error(`${expr.slice(0, 80)}: ${r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text}`);
  const v = r.result?.result?.value; return v === undefined ? undefined : JSON.parse(v);
};

// ------------------------------------------------------------------ ajudantes dos roteiros
const n = {
  ev, espera,
  /** tecla sintética na janela (os atalhos das páginas escutam `window`) */
  tecla: (code, tipo = 'keydown', extra = {}) => ev(`window.dispatchEvent(new KeyboardEvent('${tipo}', ${JSON.stringify({ code, key: code, bubbles: true, ...extra })}))`),
  /** tecla de verdade (Tab, para o foco visível) */
  teclaReal: async (key, code = key, vk = 9) => { for (const type of ['keyDown', 'keyUp']) await cmd('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk }); },
  mouse: (tipo, x, y) => cmd('Input.dispatchMouseEvent', { type: tipo === 'down' ? 'mousePressed' : tipo === 'up' ? 'mouseReleased' : 'mouseMoved', x, y, button: tipo === 'move' ? 'none' : 'left', buttons: tipo === 'down' ? 1 : 0, clickCount: 1 }),
  clicar: (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('não achei ' + ${JSON.stringify(sel)}); e.click(); return true; })()`),
  existe: (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`),
  chip: (grupo, texto) => ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(grupo + ' .chip')})].find((x) => x.textContent.trim().startsWith(${JSON.stringify(texto)})); if (!b) throw new Error('sem o chip ' + ${JSON.stringify(texto)}); b.click(); return true; })()`),
  deslizar: (id, v) => ev(`(() => { const r = document.getElementById(${JSON.stringify(id)}); if (!r) throw new Error('sem o slider ' + ${JSON.stringify(id)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(r, String(${v})); r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`),
  /** família pelo começo do nome (ou pelo índice, a partir de 1) e, se dado, o preset pelo id */
  familia: (f, preset) => ev(`(() => { const fs = [...document.querySelectorAll('.fam')]; const b = typeof ${JSON.stringify(f)} === 'number' ? fs[${JSON.stringify(f)} - 1] : fs.find((x) => x.textContent.trim().startsWith(${JSON.stringify(f)})); if (!b) throw new Error('sem a família ' + ${JSON.stringify(f)}); b.click(); return true; })()`)
    .then(() => espera(150)).then(() => (preset ? n.clicar(`.preset[data-id="${preset}"]`) : true)),
  ate: async (expr, ms = 8000, passo = 200) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { try { v = await ev(expr); } catch { v = null; } if (v) return v; await espera(passo); } return v; },
  rolarPainel: (y) => ev(`(() => { const c = document.querySelector('.controls'); if (c) c.scrollTop = ${y}; window.scrollTo(0, 0); return true; })()`),
  /** leva um elemento para o meio da área visível (do painel ou da página) */
  mostrar: (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e) e.scrollIntoView({ block: 'center' }); return !!e; })()`),
};

// ------------------------------------------------------------------ auditoria automática (roda na página)
const AUDITORIA = `(() => {
  const W = innerWidth, H = innerHeight, de = document.documentElement;
  const visivel = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05; };
  const nome = (e) => { let s = e.tagName.toLowerCase(); if (e.id) s += '#' + e.id; else if (e.className && typeof e.className === 'string') s += '.' + e.className.trim().split(/\\s+/).slice(0, 2).join('.'); return s; };
  const caminho = (e) => { const p = []; for (let x = e; x && x !== document.body && p.length < 3; x = x.parentElement) p.unshift(nome(x)); return p.join(' > '); };
  const rolaX = (e) => { for (let x = e.parentElement; x && x !== document.body; x = x.parentElement) { const o = getComputedStyle(x).overflowX; if ((o === 'auto' || o === 'scroll' || o === 'hidden') && x.scrollWidth > x.clientWidth + 1) return true; } return false; };
  const todos = [...document.body.querySelectorAll('*')].filter(visivel);
  // para fora da janela (sem contar o que está dentro de uma faixa que rola de lado de propósito)
  const fora = todos.filter((e) => { const r = e.getBoundingClientRect(); return (r.right > W + 1 || r.left < -1) && !rolaX(e); }).map(caminho);
  // texto cortado: o conteúdo não cabe na caixa e a caixa esconde o resto
  const cortado = todos.filter((e) => { if (!e.textContent.trim() || e.children.length > 3) return false; const s = getComputedStyle(e); const esconde = s.overflowX === 'hidden' || s.textOverflow === 'ellipsis'; return esconde && e.scrollWidth > e.clientWidth + 1; }).map((e) => caminho(e) + ' “' + e.textContent.trim().slice(0, 50) + '”');
  // faixas que rolam de lado (presets): quanto fica escondido
  const faixas = todos.filter((e) => { const o = getComputedStyle(e).overflowX; return (o === 'auto' || o === 'scroll') && e.scrollWidth > e.clientWidth + 1; }).map((e) => caminho(e) + ' ' + e.clientWidth + '/' + e.scrollWidth);
  const painel = document.querySelector('.controls');
  const rolagemDupla = de.scrollHeight > H + 2 && !!painel && painel.scrollHeight > painel.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(painel).overflowY);
  // nome acessível
  const rotulo = (e) => (e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || e.getAttribute('title') || (e.labels && e.labels[0] && e.labels[0].textContent) || e.textContent || '').trim();
  const semNome = todos.filter((e) => e.matches('button, input, select, textarea, [role=slider], [role=button], a[href]') && !rotulo(e)).map(caminho);
  const canvasSemNome = [...document.querySelectorAll('canvas')].filter((c) => visivel(c) && !c.getAttribute('aria-label') && !c.getAttribute('aria-hidden') && !(c.closest('[aria-label]'))).map(caminho);
  const grupos = [...document.querySelectorAll('.chips')].filter((g) => visivel(g) && !g.getAttribute('aria-label') && !g.getAttribute('aria-labelledby')).length;
  // contraste do texto contra o fundo efetivo (cores sólidas; ignora texto sobre canvas e gradiente)
  const rgb = (s) => { const m = s.match(/[\\d.]+/g); if (!m) return null; if (s.startsWith('color(srgb')) return [m[0] * 255, m[1] * 255, m[2] * 255, m[3] === undefined ? 1 : +m[3]]; return [+m[0], +m[1], +m[2], m[3] === undefined ? 1 : +m[3]]; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const sobre = (a, b) => [a[0] * a[3] + b[0] * (1 - a[3]), a[1] * a[3] + b[1] * (1 - a[3]), a[2] * a[3] + b[2] * (1 - a[3]), 1];
  const fundo = (e) => { const pilha = []; for (let x = e; x; x = x.parentElement) { const s = getComputedStyle(x); if (s.backgroundImage !== 'none') return null; const c = rgb(s.backgroundColor); if (c && c[3] > 0) { pilha.push(c); if (c[3] >= 1) break; } } let b = [13, 16, 21, 1]; for (const c of pilha.reverse()) b = sobre(c, b); return b; };
  const baixo = new Map();
  for (const e of todos) {
    if (![...e.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim())) continue;
    const s = getComputedStyle(e); const cor = rgb(s.color); const bg = fundo(e); if (!cor || !bg) continue;
    if (e.closest(':disabled, [aria-disabled=true]')) continue;
    let op = 1; for (let x = e; x; x = x.parentElement) op *= +getComputedStyle(x).opacity;
    const c = sobre([cor[0], cor[1], cor[2], cor[3] * op], bg); const l1 = lum(c), l2 = lum(bg);
    const razao = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const px = parseFloat(s.fontSize), grande = px >= 24 || (px >= 18.66 && +s.fontWeight >= 700);
    if (razao < (grande ? 3 : 4.5)) { const k = nome(e).replace(/#.*/, '') + ' ' + s.color + ' ' + Math.round(px) + 'px'; if (!baixo.has(k)) baixo.set(k, razao.toFixed(2) + ' ' + caminho(e) + ' “' + e.textContent.trim().slice(0, 30) + '”'); }
  }
  const ids = {}; for (const e of document.querySelectorAll('[id]')) ids[e.id] = (ids[e.id] || 0) + 1;
  const miudas = new Map(); for (const e of todos) { if (![...e.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim())) continue; const px = parseFloat(getComputedStyle(e).fontSize); if (px < 11) { const k = nome(e).replace(/#.*/, ''); if (!miudas.has(k)) miudas.set(k, px + 'px ' + caminho(e)); } }
  const alvos = todos.filter((e) => e.matches('button, a[href], [role=slider], select') && (e.getBoundingClientRect().height < 28 || e.getBoundingClientRect().width < 28)).map((e) => nome(e).replace(/#.*/, ''));
  const conta = (xs) => { const m = {}; for (const x of xs) m[x] = (m[x] || 0) + 1; return m; };
  return {
    janela: W + 'x' + H, pagina: de.scrollWidth + 'x' + de.scrollHeight, transbordoX: Math.max(0, de.scrollWidth - W), rolagemDupla,
    fora: [...new Set(fora)].slice(0, 12), cortado: [...new Set(cortado)].slice(0, 12), faixas,
    semNome: conta(semNome), canvasSemNome, gruposDeChipsSemNome: grupos,
    contrasteBaixo: [...baixo.values()].slice(0, 20), idsRepetidos: Object.keys(ids).filter((k) => ids[k] > 1),
    letrasMiudas: [...miudas.values()].slice(0, 12), alvosPequenos: conta(alvos),
    titulo: document.title, icone: document.querySelector('link[rel~=icon]')?.getAttribute('href')?.slice(0, 40) ?? null,
  };
})()`;

// ------------------------------------------------------------------ capturas
const relatorio = {};
let total = 0;
function contexto(pagina, largura) {
  const chave = `${pagina}-${largura}`;
  const arq = (estado) => path.join(saida, `${chave}-${estado}.png`);
  const grava = async (estado, params) => {
    const r = await cmd('Page.captureScreenshot', { format: 'png', ...params });
    if (!r.result?.data) throw new Error(`captura ${estado}: ${JSON.stringify(r.error || r).slice(0, 120)}`);
    fs.writeFileSync(arq(estado), Buffer.from(r.result.data, 'base64')); total++;
  };
  const quer = (estado) => !filtroEstados || filtroEstados.test(estado);
  const c = {
    pagina, largura, altura: ALTURAS[largura] || 900, estreita: largura <= 1100,
    /** captura da janela; `auditar` guarda a auditoria automática deste estado */
    foto: async (estado, { auditar = false } = {}) => {
      if (!quer(estado)) return;
      await grava(estado, {});
      if (auditar && !semAuditoria) (relatorio[chave] ||= {})[estado] = await ev(AUDITORIA);
    },
    /** a página toda (só difere da janela quando a página rola) */
    inteira: async (estado) => {
      if (!quer(estado)) return;
      const m = await ev(`({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, ih: innerHeight })`);
      if (m.h <= m.ih + 2) return;
      await ev(`window.scrollTo(0, 0)`);
      await grava(`${estado}-inteira`, { captureBeyondViewport: true, clip: { x: 0, y: 0, width: m.w, height: Math.min(m.h, 16000), scale: 1 } });
    },
    /** o painel lateral rolado de tela em tela (quando ele rola por dentro) */
    painel: async (estado) => {
      if (!quer(estado)) return;
      const p = await ev(`(() => { const c = document.querySelector('.controls'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: c.clientHeight, sh: c.scrollHeight, rola: /auto|scroll/.test(getComputedStyle(c).overflowY) }; })()`);
      if (!p || !p.rola || p.sh <= p.h + 2) return;
      const passo = p.h - 60;
      for (let i = 0, y = 0; y < p.sh - 60 && i < 14; i++, y += passo) {
        await n.rolarPainel(y); await espera(120);
        await grava(`${estado}-painel-${String(i + 1).padStart(2, '0')}`, { clip: { x: p.x, y: Math.max(0, p.y), width: p.w, height: Math.min(p.h, c.altura - Math.max(0, p.y)), scale: 1 } });
      }
      await n.rolarPainel(0);
    },
    /** janela + página inteira + painel, com a auditoria */
    tudo: async (estado) => { await c.foto(estado, { auditar: true }); await c.inteira(estado); await c.painel(estado); if (soParado) throw new Error(FIM); },
    /** um passo que pode falhar sem derrubar o resto do roteiro */
    passo: async (rotulo, f) => { try { await f(); } catch (e) { console.log(`   (pulou ${chave} ${rotulo}: ${String(e.message).slice(0, 140)})`); } },
  };
  return c;
}

// cada família, com o primeiro preset dela (as páginas com FamilyNav)
async function cadaFamilia(c, depois = 700) {
  const fams = await ev(`[...document.querySelectorAll('.fam')].map((b) => b.querySelector('span')?.textContent || b.textContent)`);
  for (let i = 0; i < fams.length; i++) {
    await c.passo(`família ${fams[i]}`, async () => {
      await n.familia(i + 1); await espera(200);
      await n.clicar('.cars .preset'); await espera(depois);
      await c.foto(`familia-${i + 1}-${fams[i].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24)}`);
    });
  }
  await n.familia(1); await n.clicar('.cars .preset'); await espera(300);
}
// foco de teclado: três Tabs a partir do começo da página
async function foco(c) {
  await ev(`(document.activeElement && document.activeElement.blur(), window.scrollTo(0, 0), true)`);
  for (let i = 0; i < 3; i++) await n.teclaReal('Tab', 'Tab', 9);
  await espera(150);
  await c.foto('foco');
}

const ROTEIROS = {
  async menu(c) {
    await c.tudo('parado');
    await c.passo('cartão sob o ponteiro', async () => {
      const r = await ev(`(() => { const e = document.querySelector('a.tipo'); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await n.mouse('move', r.x, r.y); await espera(250); await c.foto('ponteiro'); await n.mouse('move', 1, 1);
    });
    await foco(c);
  },

  async ronco(c) {
    await c.tudo('parado');
    await n.clicar('.bar .ignition'); await n.ate(`window.__ronco.tele.state === 'run'`, 8000); await espera(1500);
    await c.tudo('lenta');
    await n.tecla('KeyW'); await espera(1100); await c.foto('acelerando', { auditar: true }); await n.tecla('KeyW', 'keyup'); await espera(600);
    await c.passo('engatado e andando', async () => { await n.tecla('KeyE'); await espera(400); await n.tecla('KeyW'); await espera(2500); await c.foto('andando'); await n.tecla('KeyW', 'keyup'); await n.tecla('KeyQ'); });
    await c.passo('observador na rua', async () => { await n.tecla('KeyV'); await espera(1500); await n.rolarPainel(0); await c.foto('rua'); await c.inteira('rua'); await n.tecla('KeyV'); });
    await cadaFamilia(c);
    await c.passo('aviação', async () => { await n.familia('Aviação'); await n.clicar('.cars .preset'); await espera(600); await n.tecla('Digit3'); await espera(300); await c.tudo('aviacao-manete'); await n.familia(1); await n.clicar('.cars .preset'); });
    await foco(c);
  },

  async turbina(c) {
    await c.tudo('parado');
    await n.clicar('.bar .ignition'); await espera(4000); await c.foto('partida');
    await n.ate(`document.querySelector('.bar .ignition').textContent === 'Cortar motor'`, 30000, 500); await espera(800);
    await c.tudo('lenta');
    await n.tecla('Digit3'); await espera(6000); await c.foto('decolagem', { auditar: true });
    await c.passo('mapa da passagem', async () => { await n.chip('#groundMode', 'Passagem'); await espera(600); await n.mostrar('#obsMap'); await espera(1500); await c.foto('passagem-mapa'); await c.inteira('passagem-mapa'); await n.chip('#groundMode', 'Ao redor do motor'); });
    await c.passo('a bordo', async () => { await n.tecla('KeyV'); await espera(800); await n.mostrar('#obsMap'); await espera(300); await c.foto('a-bordo'); await n.tecla('KeyV'); await n.rolarPainel(0); await ev('window.scrollTo(0, 0)'); });
    await c.passo('F-16 com pós-combustão', async () => { await n.familia('Militares', 'fighter'); await espera(500); await n.tecla('Digit4'); await espera(5000); await c.foto('pos-combustao'); await n.tecla('KeyR'); await espera(1200); await c.foto('reversor'); await n.tecla('KeyR'); });
    await c.passo('estrondo sônico', async () => {
      await n.chip('#groundMode', 'Passagem'); await espera(400); await n.deslizar('speed', 2000); await n.deslizar('alt', 300); await n.mostrar('#obsMap');
      await n.ate(`/estrondo:/.test(document.getElementById('roSpl').textContent)`, 25000, 100); await espera(150);
      await c.foto('estrondo'); await n.chip('#groundMode', 'Ao redor do motor'); await n.rolarPainel(0); await ev('window.scrollTo(0, 0)');
    });
    await c.passo('turboélice', async () => { await n.familia('Turboélices', 'regional'); await espera(3000); await c.tudo('turboelice'); });
    await cadaFamilia(c);
    await foco(c);
  },

  async diesel(c) {
    await c.tudo('parado');
    await n.clicar('.bar .ignition'); await espera(600);
    await ev(`(window.__diesel.setTempMode('fixed'), window.__diesel.setCoolant(90), true)`);
    await n.ate(`window.__diesel.tele.state === 'run'`, 9000); await espera(1500);
    await c.tudo('picape-lenta');
    await n.tecla('KeyW'); await espera(1800); await c.foto('picape-acelerando', { auditar: true }); await n.tecla('KeyW', 'keyup'); await espera(800);
    await c.passo('caminhão', async () => { await n.familia(2, 'catc15'); await n.ate(`window.__diesel.tele.state === 'run'`, 8000); await n.tecla('KeyW'); await espera(2500); await c.foto('caminhao-acelerando'); await n.tecla('KeyW', 'keyup'); await n.tecla('KeyJ'); await espera(700); await c.foto('caminhao-freio-motor'); await n.tecla('KeyJ'); });
    await c.passo('gerador', async () => { await n.familia(3, 'gen500'); await n.ate(`window.__diesel.tele.state === 'run' && window.__diesel.tele.rpm > 1750`, 10000); await n.tecla('Digit2'); await espera(3500); await c.tudo('gerador-50'); await n.tecla('Digit0'); });
    await c.passo('locomotiva', async () => { await n.familia(4, 'emd710'); await n.ate(`window.__diesel.tele.state === 'run' && window.__diesel.tele.rpm > 200`, 12000); await c.foto('locomotiva-lenta'); await n.tecla('Digit4'); await espera(4500); await c.tudo('locomotiva-notch4'); await n.tecla('Digit8'); await espera(4000); await c.foto('locomotiva-notch8'); await n.tecla('Digit0'); });
    await c.passo('bancada', async () => { await n.chip('#portador', 'Bancada'); await espera(600); await n.rolarPainel(0); await c.foto('bancada'); await c.inteira('bancada'); });
    await cadaFamilia(c);
    await foco(c);
  },

  async radial(c) {
    await c.tudo('parado');
    await n.clicar('.bar .ignition'); await espera(1500); await c.foto('partida-girando');
    await n.ate(`window.__radial.tele.state === 'run' && window.__radial.tele.rpm > 450`, 14000); await espera(2000);
    await c.tudo('aviao-lenta');
    await n.tecla('Digit4'); await espera(3500); await c.foto('aviao-decolagem', { auditar: true }); await n.tecla('Digit1'); await espera(500);
    await c.passo('DC-3: partida em fases', async () => {
      await n.clicar('.preset[data-id=r1830]'); await espera(1200); await c.foto('partida-1-energizar');
      await n.clicar('.bar .ignition'); await espera(2500); await c.foto('partida-2-engatar');
      await n.clicar('.bar .ignition'); await espera(2500); await c.foto('partida-3-contando-pas');
      await n.ate(`window.__radial.tele.state === 'run' && window.__radial.tele.rpm > 400`, 15000); await espera(800); await c.foto('partida-4-pegou');
    });
    await c.passo('R-4360', async () => { await n.clicar('.preset[data-id=r4360]'); await espera(1500); await c.foto('r4360'); });
    await c.passo('Sherman', async () => {
      await n.familia(4, 'r975'); await espera(1000); await c.foto('sherman-parado');
      await n.clicar('.bar .ignition'); await n.ate(`window.__radial.tele.state === 'run'`, 12000);
      await n.tecla('KeyE'); await espera(500); await n.tecla('KeyW'); await espera(1800); await c.tudo('sherman-pedal'); await n.tecla('KeyW', 'keyup'); await n.tecla('KeyQ');
    });
    await cadaFamilia(c);
    await foco(c);
  },

  async rotativo(c) {
    await c.tudo('parado');
    await n.clicar('.bar .ignition'); await n.ate(`window.__rotativo.tele.state === 'run' && window.__rotativo.tele.rpm > 500`, 10000); await espera(1500);
    await c.tudo('wankel-lenta');
    await n.tecla('KeyW'); await espera(600); await c.foto('wankel-acelerando', { auditar: true }); await n.tecla('KeyW', 'keyup'); await espera(1200);
    await c.passo('787B', async () => { await n.familia(2, 'r26b'); await espera(3000); await c.foto('787b'); });
    await c.passo('AE50R com rotor', async () => { await n.familia(4, 'ae50r'); await espera(2500); await c.tudo('ae50r-rotor'); });
    await c.passo('X-Engine', async () => { await n.familia(5, 'xmini'); await espera(2500); await n.tecla('KeyW'); await espera(900); await c.tudo('x-engine'); await n.tecla('KeyW', 'keyup'); });
    await c.passo('palhetas', async () => {
      await n.familia(6, 'palhetas'); await espera(1200); await c.foto('palhetas-parado');
      if (await ev(`window.__rotativo.estado.ignicao`)) { await n.clicar('.bar .ignition'); await espera(400); }
      await n.clicar('.bar .ignition'); await n.tecla('KeyW'); await espera(2500); await c.tudo('palhetas-gatilho'); await n.tecla('KeyW', 'keyup');
      await n.chip('#modoPal', 'Motor de arranque'); await espera(800); await n.clicar('.bar .ignition'); await espera(2500); await c.foto('palhetas-arranque');
    });
    await cadaFamilia(c);
    await foco(c);
  },

  async vapor(c) {
    await c.tudo('parado');
    await n.clicar('#ignicao'); await espera(700); await c.foto('calibrando');
    await n.ate(`window.__vapor.tele && window.__vapor.tele.motor && !window.__vapor.estado.calibrando`, 20000); await espera(1200);
    await c.tudo('som-ligado');
    await n.deslizar('regulador', 0.7); await n.ate(`window.__vapor.tele.motor.chuffsPorS > 1 || window.__vapor.tele.portador.v > 2`, 15000); await espera(5000);
    await c.foto('andando', { auditar: true });
    await c.passo('apito', async () => { await n.tecla('KeyH'); await espera(1200); await c.foto('apito'); await n.tecla('KeyH', 'keyup'); });
    await c.passo('sino e torneiras', async () => { await n.tecla('KeyB'); await n.tecla('KeyT'); await espera(900); await c.foto('sino-torneiras'); await n.tecla('KeyB'); await n.tecla('KeyT'); });
    await c.passo('cenário', async () => { await n.clicar('[data-cenario=cruzeiro60]'); await espera(5000); await c.tudo('cenario-cruzeiro'); await n.clicar('[data-cenario=cruzeiro60]'); });
    await cadaFamilia(c, 3500);
    await foco(c);
  },

  async eletrico(c) {
    await c.tudo('parado');
    await n.clicar('#ignicao'); await espera(1500); await c.foto('ligado');
    await n.deslizar('acelerador', 1); await espera(3500); await c.tudo('acelerando');
    await c.passo('regeneração', async () => { await n.deslizar('acelerador', 0); await n.deslizar('freio', 1); await espera(1200); await c.foto('regenerando'); await n.deslizar('freio', 0); });
    await c.passo('avançado', async () => { await n.clicar('#avancado'); await espera(300); await n.mostrar('#avancado'); await c.foto('avancado'); await c.inteira('avancado'); await c.painel('avancado'); await n.clicar('#avancado'); await n.rolarPainel(0); await ev('window.scrollTo(0, 0)'); });
    await c.passo('ouvinte no gimbal', async () => { await n.chip('#ouvinte', 'Livre'); await espera(300); await n.mostrar('#ouvinte'); await c.foto('gimbal'); await n.chip('#ouvinte', 'Fora'); await n.rolarPainel(0); await ev('window.scrollTo(0, 0)'); });
    await c.passo('Taurus do-re-mi', async () => { await n.familia(2, 'taurus'); await espera(800); await c.foto('taurus-parado'); await n.deslizar('acelerador', 0.8); await espera(4500); await c.tudo('taurus-doremi'); await espera(5000); await c.foto('taurus-patamar'); await n.deslizar('acelerador', 0); });
    await c.passo('furadeira', async () => { await n.familia(4, 'furadeira'); await espera(600); await n.deslizar('acelerador', 1); await espera(2500); await c.foto('furadeira'); await n.deslizar('acelerador', 0); });
    await c.passo('drone', async () => { await n.familia(5, 'mavic'); await espera(2500); await c.tudo('drone'); });
    await cadaFamilia(c, 1200);
    await foco(c);
  },

  async passagem(c) {
    await n.ate(`+document.getElementById('cena3d').dataset.quadros > 3`, 10000); await espera(800);
    await c.tudo('parado');
    const dispara = async () => { await n.clicar('#ignicao'); if (!(await ev(`window.__passagem.c.andando`))) await n.clicar('#ignicao'); };
    const para = async () => { if (await ev(`window.__passagem.c.andando`)) await n.clicar('#ignicao'); };
    // o corpo ao lado do ouvinte: espera o nariz cruzar
    const cruzou = (ms = 14000) => n.ate(`(() => { const k = window.__passagem.c; return k.tele && k.xiNariz(k.tele.portador.s) > 0; })()`, ms, 60);
    await c.passo('trem-bala no túnel', async () => { await dispara(); await espera(3500); await c.foto('trem-chegando'); await cruzou(); await espera(500); await c.foto('trem-passando', { auditar: true }); await c.inteira('trem-passando'); await espera(2500); await c.foto('trem-saindo'); await para(); });
    await c.passo('gimbal', async () => {
      await n.clicar('#atalhos [data-id="lateral"]'); await espera(700); await n.mostrar('#atalhos'); await c.foto('gimbal-lateral');
      await n.clicar('#atalhos [data-id="topo"]'); await espera(700); await c.foto('gimbal-topo');
      await ev(`(() => { const k = window.__passagem.c; k.escolherFonte('pantografo.0'); k.setOuvinte({}, { alvo: 'pantografo.0' }); return true; })()`); await espera(500); await n.mostrar('#ficha'); await c.foto('gimbal-ficha-da-fonte');
      await n.clicar('#atalhos [data-id="cabine"]'); await espera(600); await c.foto('gimbal-cabine');
      await n.chip('#modoOuvinte', 'Parado'); await n.rolarPainel(0); await ev('window.scrollTo(0, 0)');
    });
    await c.passo('câmeras', async () => {
      await n.clicar('.preset[data-id="trembala-ceu"]'); await espera(500);
      await ev(`(() => { const k = window.__passagem.c; k.moverCorpo(-k.corpo.comprimento / 2 + 25); return true; })()`); await espera(600);
      await c.foto('trem-parado-perto');
      await n.clicar('.camera [data-cam="corpo"]'); await espera(700); await c.foto('camera-corpo');
      await n.clicar('.camera [data-cam="livre"]'); await espera(700); await c.foto('camera-livre');
      await n.clicar('.camera [data-cam="ouvinte"]');
    });
    const preset = async (id, nome, antes = 3000, limite = 14000) => c.passo(nome, async () => {
      await para(); await n.clicar(`.preset[data-id="${id}"]`); await espera(1200); await c.foto(`${nome}-parado`);
      await dispara(); await espera(antes); await cruzou(limite); await espera(250); await c.foto(`${nome}-passando`); await para();
    });
    await preset('carro-rua', 'carro');
    await preset('aviao-rasante', 'aviao-helice', 3000, 20000);
    await preset('jato-1500', 'aviao-jato', 3000, 20000);
    await preset('heli-rasante', 'helicoptero', 3000, 20000);
    await preset('locomotiva-patio', 'locomotiva', 4000, 30000);
    await preset('pacific-100', 'locomotiva-vapor', 3000, 25000);
    await preset('convencional-estacao', 'trem-estacao', 3000, 20000);
    await preset('trembala-ponte', 'trem-viaduto', 2500, 14000);
    await preset('drone-pairando', 'drone', 2500, 8000);
    await c.passo('painel do modo de testes', async () => { await para(); await n.clicar('.preset[data-id="trembala-tunel"]'); await espera(600); await c.painel('modo-de-testes'); await c.inteira('modo-de-testes'); });
    await foco(c);
  },
};

// ------------------------------------------------------------------ laço principal
const ARQUIVO = { menu: 'index.html' };
const paginas = opc('--paginas', Object.keys(ROTEIROS).join(',')).split(',');
const t0 = Date.now();
for (const pagina of paginas) {
  if (!ROTEIROS[pagina]) { console.error(`página desconhecida: ${pagina}`); continue; }
  for (const largura of larguras) {
    pagAtual = `${pagina}-${largura}`;
    const c = contexto(pagina, largura);
    const antes = total;
    await cmd('Emulation.setDeviceMetricsOverride', { width: largura, height: c.altura, deviceScaleFactor: 1, mobile: false });
    await cmd('Page.navigate', { url: 'about:blank' });
    await cmd('Page.navigate', { url: base + (ARQUIVO[pagina] || `${pagina}.html`) });
    await n.ate(`document.readyState === 'complete' && !!document.querySelector('#raiz > *') && (!document.fonts || document.fonts.status === 'loaded')`, 10000);
    await espera(1200);
    try { await ROTEIROS[pagina](c); } catch (e) { if (e.message !== FIM) console.log(`   ERRO no roteiro de ${pagAtual}: ${e.message}`); }
    console.log(`${pagAtual}: ${total - antes} capturas (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
}
if (!semAuditoria) fs.writeFileSync(path.join(saida, 'relatorio.json'), JSON.stringify({ base, quando: new Date().toISOString(), paginas: relatorio, console: logs }, null, 1));
console.log(`${total} capturas em ${path.relative(RAIZ, saida)}/${logs.length ? ` · ${logs.length} erro(s) no console (em relatorio.json)` : ''}`);
ws.close(); chrome.kill(); servidor?.close();
await espera(500);
try { fs.rmSync(perfil, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {}
process.exit(0);
