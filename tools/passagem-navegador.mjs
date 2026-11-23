// Teste da página Passagem / modo de testes num navegador headless de verdade (com áudio e WebGL).
//
//   node tools/passagem-navegador.mjs [url da passagem.html] [--firefox] [--reserva] [--porta N] [--foto arquivo.png]
//
// Sem url, serve o `dist/` (npm run build antes) em http://127.0.0.1:<porta>/data/engine/, como no site.
// --reserva bloqueia o AudioWorklet: a página tem de cair no ScriptProcessorNode (DSP na thread principal).
// Chromium por CDP (/usr/bin/chromium, ou CHROMIUM=/caminho) ou Firefox por WebDriver BiDi (/usr/bin/firefox, ou
// FIREFOX=/caminho), sem dependências; MUDO=1 roda sem tocar nas caixas (o som continua sendo medido).
// Um script antes da página grava toda mensagem mandada pela porta do AudioWorklet.
//
// Roteiro: carga (presets, portadores pela tabela de compatibilidade, seções do painel com "Você" em primeiro, cena 3D
// desenhando e toda opaca, ajuda das teclas que some sozinha); o ponto de chegada do trem-bala no túnel e a passagem dele
// (onda de compressão ~2 kPa antes do trem, onda de nariz no ouvinte livre, nível em dB(A) no ouvido real); andar (W,
// Shift), a parede do túnel, olhar arrastando o mouse, voar (V, E), embarcar e desembarcar (botão e B), cada ponto de
// vista do painel, as teclas 1–9, H e T, o painel recolhido; a troca de ambiente (estação: o observador em cima da
// plataforma), o slider do ponto de chegada e o de vagões; o helicóptero; todos os presets carregando com o observador
// no ponto de chegada; o carro na rua (Camaro do Ronco), o RX-7 e a locomotiva EMD em N8; voltar ao padrão; o celular a
// 400 px (o círculo de andar e arrastar para olhar, no Chromium); console sem erros. Sempre com MUDO=1 quando houver
// alguém ouvindo outra coisa nas caixas.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const args = process.argv.slice(2);
const opc = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const firefox = args.includes('--firefox');
const reserva = args.includes('--reserva');
const porta = +opc('--porta', firefox ? 9470 : 9350);
const foto = opc('--foto');
let url = args.find((a) => !a.startsWith('--') && a !== opc('--porta') && a !== opc('--foto'));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
// MUDO=1: o teste roda sem tocar nas caixas (o áudio continua rodando e sendo medido no analisador): --mute-audio no
// Chromium; no Firefox, media.volume_scale 0 (o fluxo vai em silêncio ao servidor de áudio)
const MUDO_CR = process.env.MUDO ? ['--mute-audio'] : [];
const MUDO_FF = process.env.MUDO ? 'user_pref("media.volume_scale", "0.0");\n' : '';

// ------------------------------------------------------------------ servidor do dist/ em /data/engine/
let servidor = null;
if (!url) {
  const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'dist');
  if (!fs.existsSync(path.join(raiz, 'passagem.html'))) { console.error('sem dist/passagem.html: rode npm run build antes'); process.exit(2); }
  const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.md': 'text/markdown' };
  servidor = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!u.startsWith('/data/engine/')) { res.writeHead(404); res.end(); return; }
    const arq = path.normalize(path.join(raiz, u.slice('/data/engine/'.length) || 'index.html'));
    if (!arq.startsWith(raiz) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': tipos[path.extname(arq)] || 'application/octet-stream' });
    fs.createReadStream(arq).pipe(res);
  });
  const ps = porta + 7;
  await new Promise((r) => servidor.listen(ps, '127.0.0.1', r));
  url = `http://127.0.0.1:${ps}/data/engine/passagem.html`;
  console.log(`servindo dist/ em ${url}`);
}

const perfil = fs.mkdtempSync(path.join(os.tmpdir(), firefox ? 'passagem-ff-' : 'passagem-cr-'));
// (a cópia guardada da mensagem 'portador' fica só com o que o roteiro lê: as calibrações e o cfg do motor de cada
// preset, guardados inteiros, enchiam a memória da página com as 29 montagens)
const GANCHO = `(() => {
  window.__msgs = [];
  const enxugar = (m) => {
    if (m.type !== 'portador') return m;
    const c = m.config || {}, cfg = m.motor && m.motor.cfg || {};
    return { ...m, config: { ...c, calibracao: c.calibracao ? { length: c.calibracao.length } : undefined }, motor: m.motor ? { familia: m.motor.familia, cfg: { id: cfg.id, kAbs: cfg.kAbs, uso: cfg.uso } } : m.motor };
  };
  const orig = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (m, ...r) { try { if (m && typeof m === "object" && typeof m.type === "string") window.__msgs.push(enxugar(JSON.parse(JSON.stringify(m)))); } catch {} return orig.call(this, m, ...r); };
})();${reserva ? "\nAudioWorklet.prototype.addModule = () => Promise.reject(new Error('bloqueado no teste'));" : ''}`;

const logs = [];
let ev, fechar, fotografar, mouse, toque = null, navegou = 0;

if (!firefox) {
  const chrome = spawn(process.env.CHROMIUM || '/usr/bin/chromium', ['--headless=new', `--remote-debugging-port=${porta}`, '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1400,900', ...MUDO_CR, `--user-data-dir=${perfil}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let alvo;
  for (let i = 0; i < 50 && !alvo; i++) { await espera(200); try { const l = await (await fetch(`http://127.0.0.1:${porta}/json`)).json(); alvo = l.find((t) => t.type === 'page'); } catch {} }
  const ws = new WebSocket(alvo.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(m.params.type)) logs.push(`console.${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    if (m.method === 'Runtime.exceptionThrown') logs.push(`EXCEÇÃO: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logs.push(`log.error: ${m.params.entry.text} ${m.params.entry.url || ''}`);
    if (m.method === 'Network.loadingFailed' && !m.params.canceled && !/net::ERR_ABORTED/.test(m.params.errorText)) logs.push(`FALHA DE REDE: ${m.params.errorText}`);
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) logs.push(`HTTP ${m.params.response.status}: ${m.params.response.url}`);
    if (m.method === 'Inspector.targetCrashed') { logs.push('O PROCESSO DA PÁGINA QUEBROU'); console.log('*** o processo da página quebrou'); }
    if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId && navegou++) { logs.push(`a página recarregou: ${m.params.frame.url}`); console.log('*** a página recarregou'); }
  });
  const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  ev = async (expr) => {
    const r = await cmd('Runtime.evaluate', { expression: `(async () => JSON.stringify(await (${expr})))()`, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.result?.exceptionDetails) throw new Error(`${expr.slice(0, 90)}: ${r.result.exceptionDetails.exception?.description}`);
    const v = r.result?.result?.value; return v === undefined ? undefined : JSON.parse(v);
  };
  fotografar = async (arq) => { const r = await cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(arq, Buffer.from(r.result.data, 'base64')); };
  mouse = async (tipo, x, y, shift = false) => {
    const type = tipo === 'down' ? 'mousePressed' : tipo === 'up' ? 'mouseReleased' : 'mouseMoved';
    await cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: tipo === 'up' ? 0 : 1, clickCount: 1, modifiers: shift ? 8 : 0 });
  };
  fechar = () => { ws.close(); chrome.kill(); };
  toque = {
    // tela de celular em pé, com toque
    tela: async (w, h) => { await cmd('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: true }); await cmd('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 }); },
    // um dedo de (x0, y0) a (x1, y1) em `ms`, segurando no fim até completar o tempo
    arrastar: async (x0, y0, x1, y1, ms) => {
      await cmd('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
      const n = 8;
      for (let i = 1; i <= n; i++) { await cmd('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n }] }); await espera(25); }
      await espera(Math.max(0, ms - n * 25));
      await cmd('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    },
  };
  await cmd('Runtime.enable'); await cmd('Log.enable'); await cmd('Network.enable'); await cmd('Page.enable'); await cmd('Inspector.enable');
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: GANCHO });
  await cmd('Page.navigate', { url });
} else {
  fs.writeFileSync(`${perfil}/user.js`, 'user_pref("media.autoplay.default", 0);\nuser_pref("media.autoplay.blocking_policy", 0);\nuser_pref("webgl.force-enabled", true);\n' + MUDO_FF);
  const ff = spawn(process.env.FIREFOX || '/usr/bin/firefox', ['--headless', '--width', '1400', '--height', '900', '--remote-debugging-port', String(porta), '--profile', perfil, '--no-remote'], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 60; i++) { await espera(300); try { ws = new WebSocket(`ws://127.0.0.1:${porta}/session`); await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; }); break; } catch { ws = null; } }
  let id = 0; const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } if (m.method === 'log.entryAdded' && ['error'].includes(m.params.level)) logs.push(`${m.params.level}: ${m.params.text}`); };
  const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await cmd('session.new', { capabilities: {} });
  await cmd('session.subscribe', { events: ['log.entryAdded'] });
  const ctx = (await cmd('browsingContext.getTree', {})).result.contexts[0].context;
  await cmd('browsingContext.setViewport', { context: ctx, viewport: { width: 1400, height: 900 } });
  await cmd('script.addPreloadScript', { functionDeclaration: `() => { ${GANCHO} }` });
  ev = async (e) => {
    const r = await cmd('script.evaluate', { expression: `(async () => JSON.stringify(await (${e})))()`, target: { context: ctx }, awaitPromise: true, userActivation: true });
    if (r.result?.type === 'exception') throw new Error(`${e.slice(0, 90)}: ${r.result.exceptionDetails?.text}`);
    const v = r.result?.result?.value; return v === undefined ? undefined : JSON.parse(v);
  };
  fotografar = async (arq) => { const r = await cmd('browsingContext.captureScreenshot', { context: ctx }); fs.writeFileSync(arq, Buffer.from(r.result.data, 'base64')); };
  mouse = async (tipo, x, y, shift = false) => {
    const acoes = tipo === 'down' ? [{ type: 'pointerMove', x: Math.round(x), y: Math.round(y) }, { type: 'pointerDown', button: 0 }] : tipo === 'up' ? [{ type: 'pointerUp', button: 0 }] : [{ type: 'pointerMove', x: Math.round(x), y: Math.round(y), duration: 0 }];
    const lista = [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: acoes }];
    if (shift) lista.push({ type: 'key', id: 'teclado', actions: [{ type: 'keyDown', value: '' }, ...acoes.slice(1).map(() => ({ type: 'pause', duration: 0 }))] });
    await cmd('input.performActions', { context: ctx, actions: lista });
  };
  fechar = () => { ws.close(); ff.kill(); };
  await cmd('browsingContext.navigate', { context: ctx, url, wait: 'complete' });
}

// ------------------------------------------------------------------ roteiro
let falhas = 0;
const confere = (ok, rotulo, valor) => { console.log(`${ok ? 'ok  ' : 'FALHA'} ${rotulo}${valor !== undefined ? ` → ${typeof valor === 'string' ? valor : JSON.stringify(valor)}` : ''}`); if (!ok) falhas++; };
const confereMsg = (ok, rotulo, valor) => (reserva ? console.log(`--    ${rotulo} (pulado: reserva)`) : confere(ok, rotulo, valor));
const ate = async (expr, ms, passo = 200) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await ev(expr); if (v) return v; await espera(passo); } return v; };
// Esperas: em vez de dormir um tempo fixo depois de mexer num controle (com a máquina carregada a mensagem ainda não
// saiu, ou a página ainda está calibrando o motor do preset no worker), lê até a condição valer ou o limite passar e
// devolve a última leitura, que a conferência julga e mostra. O limite é folgado: só pesa quando algo está errado.
// `janela` mede durante uma passagem: o tempo de antes vira o mínimo e ela se estende (até `maxMs`) enquanto a condição
// de chegada não vale, em vez de acabar no meio da passagem quando a máquina está lenta.
const lerAte = async (f, ok, ms = 6000) => { const t0 = Date.now(); let v; for (;;) { v = await f(); if (ok(v) || Date.now() - t0 >= ms) return v; await espera(150); } };
// (na reserva nada passa pela porta: no lugar da mensagem, os 0,8 s de antes)
const ultimaAte = (tipo, ok, ms = 6000) => (reserva ? espera(800).then(async () => (await ultimos(tipo)).at(-1)) : lerAte(async () => (await ultimos(tipo)).at(-1), (m) => !!m && ok(m), ms));
const janela = async (ler, junta, chegou, minMs, maxMs, passo) => { const t0 = Date.now(); for (;;) { const r = await ler(); if (r) await junta(r, (Date.now() - t0) / 1000); const dt = Date.now() - t0; if (dt >= maxMs || (dt >= minMs && chegou(dt / 1000))) return; await espera(passo); } };
const clicar = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('não achei ${sel.replace(/'/g, '')}'); e.click(); return true; })()`);
const chip = (grupo, texto) => ev(`(() => { const b = [...document.querySelectorAll('#${grupo} .chip')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(texto)})); if (!b) throw new Error('chip ${texto} em ${grupo}'); b.click(); return true; })()`);
const slider = (id, v) => ev(`(() => { const r = document.getElementById('${id}'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(r, '${v}'); r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); return r.closest('.field').querySelector('output').textContent; })()`);
const ultimos = (tipo) => ev(`window.__msgs.filter((m) => m.type === '${tipo}')`);
/** alguma mensagem do tipo, mandada depois da n0-ésima, que passa em `ok` (a última pode ser outra: o observador manda as dele) */
const marca = () => ev('window.__msgs.length');
const algumaDesde = (n0, tipo, ok, ms = 6000) => (reserva ? espera(800).then(() => null) : lerAte(async () => (await ev(`window.__msgs.slice(${n0}).filter((m) => m.type === '${tipo}')`)).filter(ok).at(-1), (m) => !!m, ms));
const texto = (id) => ev(`document.getElementById(${JSON.stringify(id)})?.textContent ?? null`);
// teclas: eventos de teclado na janela (o controle lê o `code`), com o foco fora dos controles do painel
const tecla = (code, tipo = 'keydown') => ev(`(() => { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); window.dispatchEvent(new KeyboardEvent('${tipo}', { code: '${code}', key: '${code.replace(/^Key|^Digit/, '').toLowerCase()}', bubbles: true })); return true; })()`);
const segurar = async (codes, ms) => { for (const c of codes) await tecla(c); await espera(ms); for (const c of codes) await tecla(c, 'keyup'); };
const P = 'window.__passagem.c';
// telemetria guardada pela página (vale também na reserva, em que nada passa pela porta)
const tele = () => ev(`(() => { const t = ${P}.tele; return t && { s: t.portador.s, v: t.portador.v, p: t.cena.pressaoPa, pmax: t.pressao.max, pmin: t.pressao.min, tunel: t.pressao.tunel, spl: t.cena.splDbA, vento: t.cena.ventoMs, n: t.cena.fontes.length, lado: t.lado, ouvinte: t.cena.ouvinte }; })()`);
const obs = () => ev(`(() => { const o = ${P}.obs; return { modo: o.modo, pos: o.pos.map((x) => +x.toFixed(3)), rumo: +o.rumo.toFixed(4), arf: +o.arfagem.toFixed(4), salto: o.salto, local: o.local, nome: o.nome, v: +Math.hypot(o.vel[0], o.vel[1]).toFixed(3), vz: +o.vel[2].toFixed(3) }; })()`);
/** a última mensagem 'cena' com o ouvinte livre */
const ultimoOuvinte = async (ok = () => true, ms = 6000) => (await ultimaAte('cena', (m) => m.ouv?.modo === 'livre' && ok(m.ouv), ms))?.ouv;

await ate(`document.readyState === 'complete' && !!window.__passagem && document.querySelectorAll('.preset').length > 0`, 15000);
confere((await ev('document.title')) === 'Passagem', 'título');
const est = await ev(`({
  presets: [...document.querySelectorAll('.preset')].map((b) => b.dataset.id + (b.disabled ? '(d)' : '')),
  portadores: [...document.querySelectorAll('#portador .chip')].map((b) => b.textContent + (b.disabled ? '(d)' : '')),
  secoes: [...document.querySelectorAll('#controls h2')].map((h) => h.textContent),
  sliders: [...document.querySelectorAll('#controls input[type=range]')].map((i) => i.id),
  pontos: [...document.querySelectorAll('#pontos .chip')].map((b) => b.dataset.id),
  canvas: [...document.querySelectorAll('canvas')].map((c) => c.id + ':' + Math.round(c.getBoundingClientRect().width) + 'x' + Math.round(c.getBoundingClientRect().height)),
  placa: document.getElementById('plate')?.textContent,
  ajuda: !document.getElementById('ajuda')?.hidden && document.getElementById('ajuda')?.textContent,
  vista: (() => { const r = document.getElementById('cena3d').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
})`);
console.log('estrutura:', JSON.stringify(est));
// (29: os 13 da etapa 1 e 2, os 5 da etapa 3, radiais e aviação a pistão, os 3 da etapa 4, rotativos, os 3 da etapa 5,
// vapor, e os 5 da etapa 6, elétrico)
const N_PRESETS = 13 + 5 + 3 + 3 + 5;
confere(est.presets.length === N_PRESETS && !est.presets.some((p) => p.endsWith('(d)')), `presets: ${N_PRESETS}, todos habilitados (os com motor pelos adaptadores)`, est.presets.length);
confere(est.portadores.join() === 'Trem,Helicóptero,Carro,Avião de hélice,Gerador,Locomotiva,Avião a jato,Trator,Barco,Drone', 'portadores pela tabela de compatibilidade e os adaptadores', est.portadores);
confere(JSON.stringify(est.secoes) === JSON.stringify(['Você', 'Portador', 'Passagem', 'Ambiente', 'Trajetória', 'Trem', 'Ar', 'Volume', 'Modo de testes', 'Leituras', 'Gráficos']), 'seções do painel (a primeira é você)', est.secoes);
confere(['vKmh', 'x0', 'corpoParado', 'rtFator', 'tunelArea', 'tunelComp', 'tunelBoca', 'comprimento', 'lateral', 'altitude', 'N', 'Lc', 'vao', 'truque', 'lNariz', 'ur', 'temperatura', 'master'].every((s) => est.sliders.includes(s)) && !est.sliders.some((s) => ['az', 'el', 'r', 'ouvX', 'ouvZ'].includes(s)), 'parâmetros livres do modo de testes (sem os do gimbal)', est.sliders.length);
confere(est.pontos.join() === 'chegada,via,alto,embarcar,frente,lado,atras,topo', 'pontos de vista do trem sem motor no túnel (sem escape, ponteira, cofre nem plataforma)', est.pontos);
confere(est.canvas.length === 4 && est.canvas.every((c) => !/:0x|x0$/.test(c)), 'canvas com tamanho', est.canvas);
confere(est.vista[0] >= 900 && est.vista[1] >= 500, 'a cena é a protagonista (o palco inteiro ao lado do painel)', est.vista);
confere(typeof est.ajuda === 'string' && /W A S D/.test(est.ajuda) && /embarcar/.test(est.ajuda), 'ajuda das teclas na tela ao abrir', est.ajuda?.slice?.(0, 80));
const q3d = await ate(`+document.getElementById('cena3d').dataset.quadros > 3 && +document.getElementById('cena3d').dataset.quadros`, 8000);
const aviso = await texto('aviso3d');
confere(!!q3d, 'cena 3D desenhando (WebGL)', q3d || aviso);
// cena opaca: nenhum material transparente na vista padrão (vista técnica desligada)
const transp = await ev(`(() => { const k = window.__passagem.cena.current; if (!k) return null; const l = []; k.scene.traverseVisible((o) => { const m = o.material; for (const x of (Array.isArray(m) ? m : m ? [m] : [])) if (x.transparent || x.opacity < 1) l.push(o.type + ':' + x.type); }); return l; })()`);
confere(Array.isArray(transp) && transp.length === 0, 'cena padrão toda opaca', transp);
// (etapa 2: o túnel no morro, o trem-bala com o modelo e a sombra do sol; lá dentro, o morro e o resto de fora somem)
const tun3d = await lerAte(() => ev(`(() => { const k = window.__passagem.cena.current, c = window.__passagem.c; return k && { cen: k.mundo?.cenario, fora: k.mundo?.morro ? k.mundo.morro.visible : null, sol: k.sol.intensity, sombra: k.renderer.shadowMap.enabled, segs: k.segs.length, corpo: c.corpo.segmentos.length, rodas: k.rodas.length }; })()`), (r) => r?.cen === 'tunel' && r.segs === r.corpo, 8000);
confere(tun3d?.cen === 'tunel' && tun3d.fora === false && tun3d.sol === 0 && tun3d.sombra && tun3d.segs === tun3d.corpo && tun3d.rodas > 0, 'túnel no morro: dentro do tubo o sol se apaga e o de fora some; o trem com um grupo por vagão e as rodas em instâncias', tun3d);
const ajudaSome = await lerAte(() => ev(`document.getElementById('ajuda').hidden`), (h) => h === true, 14000);
confere(ajudaSome === true, 'a ajuda some sozinha');

// ---- o ponto de chegada do trem-bala no túnel: a 3 m da lateral, olhando o trem chegar
await clicar('.preset[data-id="trembala-tunel"]');
const ch = await lerAte(obs, (o) => o.modo === 'pe' && Math.abs(o.pos[1] + 4.68) < 0.01, 4000);
// (o refúgio do túnel: a passarela de serviço a 0,75 m acima da via, que vai até o ponto de chegada)
confere(ch.modo === 'pe' && Math.abs(ch.pos[0]) < 0.01 && Math.abs(ch.pos[1] + 4.68) < 0.01 && Math.abs(ch.pos[2] - 2.4) < 0.01, 'ponto de chegada no túnel: a pé na passarela de serviço (0,75 m), a 3 m da lateral (4,68 m do eixo), olho a 1,65 m dela', ch.pos);
confere(Math.cos(ch.rumo) < -0.95, 'nasce olhando o trem chegar (para −x, ao longo da via)', ch.rumo);
await clicar('#ignicao');
const pronto = await ate(`${P}.tele && ${P}.andando`, 20000);
confere(!!pronto, 'áudio pronto e telemetria chegando');
const modo = await ev(`${P}.audio?.modo`);
confere(reserva ? modo === 'script' : modo === 'worklet', `áudio pelo ${reserva ? 'ScriptProcessorNode (reserva)' : 'AudioWorklet'}`, modo);
const msgs0 = await ev(`window.__msgs.map((m) => m.type)`);
confereMsg(msgs0.includes('portador') && msgs0.includes('cena') && msgs0.includes('comando'), 'mensagens portador, cena e comando', msgs0.slice(0, 10));
const port0 = (await ultimos('portador')).at(-1);
confereMsg(port0?.tipo === 'trem' && port0.config.N === 10 && port0.config.faces === 'duas' && port0.config.calibracao?.length > 40, 'trem de 10 vagões, duas faces, calibrações da página', port0 && { N: port0.config.N, cal: port0.config.calibracao?.length });
const cena0 = (await ultimos('cena')).filter((m) => m.amb).at(-1);
confereMsg(cena0?.amb?.id === 'tunel' && cena0.traj.lateral === 3 && cena0.amb.tunel.xEntrada === -500, 'cena: túnel, 3 m, boca a 500 m', cena0 && { amb: cena0.amb?.id, lat: cena0.traj?.lateral });
const ov0 = (await ultimos('cena')).at(-1)?.ouv;
confereMsg(ov0?.modo === 'livre' && ov0.livre?.ref === 'mundo' && Math.abs(ov0.livre.pos[2] - 2.35) < 0.01 && typeof ov0.livre.t === 'number', 'o ouvinte é o observador: modo livre, ouvido 5 cm abaixo do olho, com o instante do quadro', ov0 && { modo: ov0.modo, ref: ov0.livre?.ref, pos: ov0.livre?.pos, rumo: ov0.livre?.rumo });
const conv = await ev(`({ n: ${P}.audio.conv.normalize, dur: ${P}.audio.conv.buffer?.duration, wet: ${P}.audio.wet.gain.value })`);
confere(conv.n === false && conv.dur > 5.5, 'reverberação da Cena: resposta por banda, normalize = false', conv);

// acompanha a passagem: 600 m a 97 m/s → nariz abeam em ~6,2 s, cauda em ~8,8 s
let maxTun = 0, maxP = -1e9, minP = 1e9, maxA = -1e9, tunT = null, narizT = null, vMax = 0;
// (o nariz só conta depois de ser visto antes de você: a primeira telemetria depois de disparar pode ainda trazer a
// posição de antes do reposicionamento, com o nariz já "passado", e a conta saía 0 s)
let narizAntes = false;
// O nível de cada passagem é o máximo que o medidor da página guarda a cada quadro (`med.maxA`, zerado antes da janela)
const zeraMax = () => ev(`(window.__passagem.med.zerarMax(), true)`);
await zeraMax();
await janela(() => ev(`(() => { const t = ${P}.tele; const m = window.__passagem.med; return t && { tun: t.pressao.tunel, max: t.pressao.max, min: t.pressao.min, nariz: t.pressao.nariz, dBA: m.maxA, xi: ${P}.xiNariz(t.portador.s), v: t.portador.v }; })()`),
  async (r, dt) => {
    if (r.tun > maxTun) maxTun = r.tun; if (tunT == null && r.tun > 500) tunT = dt;
    if (r.xi < 0) narizAntes = true;
    if (narizT == null && narizAntes && r.xi > 0) { narizT = dt; if (foto) { await espera(500); await fotografar(foto.replace(/\.png$/, '-abeam.png')); } }
    if (Math.abs(r.nariz) > 0) { maxP = Math.max(maxP, r.max - r.tun); minP = Math.min(minP, r.min - r.tun); }
    if (Number.isFinite(r.dBA)) maxA = Math.max(maxA, r.dBA);
    vMax = Math.max(vMax, r.v);
  }, (dt) => narizT != null && dt - narizT > 5.8, 12000, 40000, 40);
confere(Math.abs(vMax * 3.6 - 350) < 1, 'velocidade 350 km/h', (vMax * 3.6).toFixed(1));
confere(maxTun > 1600 && maxTun < 2400, 'onda de compressão do túnel ~2 kPa', `${maxTun.toFixed(0)} Pa`);
confere(tunT != null && narizT != null && narizT - tunT > 2.5, 'a onda do túnel chega segundos antes do nariz', { onda: tunT, nariz: narizT });
confere(maxP - minP > 90 && maxP - minP < 220, 'onda de nariz/cauda no ouvinte livre (pico a pico, alvo 150 ± 30 Pa)', `${(maxP - minP).toFixed(0)} Pa`);
confere(maxA > 105 && maxA < 125, 'nível no ouvido real (direto + túnel) em dB(A)', `${maxA.toFixed(1)} dB(A)`);
const leit = await lerAte(() => ev(`({ nivel: document.getElementById('ro-nivel').textContent, doppler: document.getElementById('ro-doppler').textContent, nariz: document.getElementById('ro-nariz').textContent, tunel: document.getElementById('ro-tunel').textContent, onde: document.getElementById('ro-onde').textContent, hud: document.getElementById('hud').textContent })`),
  (l) => /dB\(A\)/.test(l.nivel) && /×/.test(l.doppler) && /kPa/.test(l.tunel) && /km\/h/.test(l.hud) && /a pé/.test(l.onde), 4000);
confere(/dB\(A\)/.test(leit.nivel) && /×/.test(leit.doppler) && /kPa/.test(leit.tunel) && /km\/h/.test(leit.hud) && /a pé/.test(leit.onde), 'leituras: nível, Doppler, túnel, onde você está, HUD', leit);
const rms = await ev(`document.getElementById('osc').dataset.rms`);
confere(+rms > -70, 'som saindo (RMS no analisador)', `${rms} dBFS`);
if (foto) await fotografar(foto.replace(/\.png$/, '-tunel.png'));

// ---- andar: W (1,5 m/s), depois Shift + W (6 m/s); a posição do ouvinte na telemetria acompanha. (A velocidade é a do
// observador, não a do relógio da parede: no Chromium sem cabeça, com o WebGL em software e a máquina ocupada, os
// quadros podem vir a 1–3 por segundo, e o passo acompanha o tempo de cada quadro até 1 s)
const o0 = await obs(), t0 = await tele();
const nMsg0 = (await ultimos('cena')).length, tMsg0 = Date.now();
await tecla('KeyW');
const oW = await lerAte(obs, (o) => Math.abs(o.v - 1.5) < 0.08, 5000);
await espera(800);
await tecla('KeyW', 'keyup');
confere(Math.abs(oW.v - 1.5) < 0.08, 'W anda a 1,5 m/s', oW.v);
const o1 = await lerAte(obs, (o) => o.v === 0, 4000);
const andou = Math.hypot(o1.pos[0] - o0.pos[0], o1.pos[1] - o0.pos[1]);
confere(andou > 0.5 && o1.v === 0, 'andou e parou ao soltar (sem degrau: a velocidade desce com a constante de 0,12 s)', `${andou.toFixed(2)} m`);
const t1 = await lerAte(tele, (t) => !!t && Math.hypot(t.ouvinte[0] - t0.ouvinte[0], t.ouvinte[1] - t0.ouvinte[1]) > 1, 3000);
confere(!!t1 && Math.hypot(t1.ouvinte[0] - t0.ouvinte[0], t1.ouvinte[1] - t0.ouvinte[1]) > 1, 'andar muda a posição do ouvinte na telemetria da Cena', t1 && { antes: t0.ouvinte, depois: t1.ouvinte });
const msgsAndando = (await ultimos('cena')).slice(nMsg0);
const taxa = msgsAndando.length / ((Date.now() - tMsg0) / 1000);
confereMsg(msgsAndando.some((m) => m.ouv?.livre && Math.hypot(...m.ouv.livre.vel) > 1) && taxa < 36, 'amostras do observador andando (com a velocidade), no máximo ~30 por segundo', { n: msgsAndando.length, porSegundo: +taxa.toFixed(1) });
await tecla('ShiftLeft'); await tecla('KeyW');
const oC = await lerAte(obs, (o) => Math.abs(o.v - 6) < 0.3, 5000);
await tecla('KeyW', 'keyup'); await tecla('ShiftLeft', 'keyup');
confere(Math.abs(oC.v - 6) < 0.3, 'Shift + W corre a 6 m/s', oC.v);
await lerAte(obs, (o) => o.v === 0, 4000);
// a parede do túnel: andar de lado (A, para a esquerda de quem olha para −x é o lado de fora) não atravessa
await segurar(['ShiftLeft', 'KeyA'], 2500);
const o3 = await obs();
confere(o3.pos[1] > -6.9 && o3.pos[1] < -6.3, 'a pé não atravessa a parede do túnel', o3.pos);
// olhar: arrastar o mouse na cena gira a cabeça (e a cabeça do binaural vai junto)
const cv = await ev(`(() => { const r = document.getElementById('cena3d').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
const rumo0 = (await obs()).rumo;
await mouse('down', cv.x, cv.y); for (let i = 1; i <= 8; i++) { await mouse('move', cv.x + 15 * i, cv.y); await espera(30); } await mouse('up', cv.x + 120, cv.y);
const rumo1 = await lerAte(async () => (await obs()).rumo, (r) => Math.abs(r - rumo0) > 0.2, 3000);
confere(Math.abs(rumo1 - rumo0) > 0.2, 'arrastar na cena olha para o lado', { antes: rumo0, depois: rumo1 });
const ovR = await ultimoOuvinte((o) => Math.abs(o.livre.rumo - rumo1 * 180 / Math.PI) < 1, 3000);
confereMsg(!!ovR, 'a cabeça do ouvinte vai para onde a câmera olha', ovR?.livre?.rumo);

// ---- voo: V, E sobe; Q desce; V volta a pé (no chão)
await tecla('KeyV');
const ov = await lerAte(obs, (o) => o.modo === 'voo', 2000);
confere(ov.modo === 'voo', 'V: voando');
await tecla('KeyE');
const oE = await lerAte(obs, (o) => Math.abs(o.vz - 8) < 0.4 || o.pos[2] > 6, 5000);
// (dentro do túnel: sobe até o teto, 6,8 m, e para nele)
const ov2 = await lerAte(obs, (o) => o.pos[2] > 6, 8000);
await espera(600);
const ov2b = await obs();
await tecla('KeyE', 'keyup');
confere(oE.vz > 7 || oE.pos[2] > 6, 'E sobe a 8 m/s', oE.vz);
confere(ov2.pos[2] > 6 && ov2b.pos[2] <= 6.55, 'o teto do túnel segura quem voa', ov2b.pos[2]);
const tz = await lerAte(tele, (t) => !!t && t.ouvinte[2] > 5, 3000);
confere(!!tz && tz.ouvinte[2] > 5, 'o ouvinte da Cena sobe junto', tz?.ouvinte);
await tecla('KeyV');
const noChao = (o) => ev(`${P}.lugar().chao(${o.pos[0]}, ${o.pos[1]}) + 1.65`);
const ov3 = await lerAte(obs, (o) => o.modo === 'pe' && o.v === 0, 3000);
const z3 = await lerAte(async () => { const o = await obs(); return { o, z: await noChao(o) }; }, (r) => Math.abs(r.o.pos[2] - r.z) < 0.05, 3000);
confere(ov3.modo === 'pe' && Math.abs(z3.o.pos[2] - z3.z) < 0.05, 'V de novo: a pé, de volta ao chão (a passarela)', z3.o.pos);
// do refúgio para a via: andando para o lado da via (D, à direita de quem olha o trem chegar), a passarela acaba e o chão
// passa a ser o da via
await tecla('Digit1');
await lerAte(obs, (o) => o.modo === 'pe' && Math.abs(o.pos[1] + 4.68) < 0.01, 3000);
await tecla('KeyD');
const naVia = await lerAte(obs, (o) => o.pos[1] > -2.6 && Math.abs(o.pos[2] - 1.65) < 0.05, 8000);
await tecla('KeyD', 'keyup');
confere(naVia.pos[1] > -2.6 && Math.abs(naVia.pos[2] - 1.65) < 0.05, 'pode descer da passarela para a via (o olho desce para 1,65 m do piso da via)', naVia.pos);
await lerAte(obs, (o) => o.v === 0, 4000);

// ---- embarcar e desembarcar (botão e tecla B)
const antesEmb = await obs();
await clicar('#embarcar');
const emb = await lerAte(obs, (o) => o.modo === 'embarcado', 2000);
confere(emb.modo === 'embarcado' && emb.salto > antesEmb.salto, 'embarcar: no assento do trem (a cabine do maquinista)', emb);
const ovE = await ultimoOuvinte((o) => o.livre.ref === 'corpo', 3000);
confereMsg(ovE?.livre?.ref === 'corpo', 'embarcado, o ouvinte anda com o corpo (referencial do corpo)', ovE?.livre?.pos);
const locE = await lerAte(() => texto('localEfetivo'), (v) => !!v?.includes('cabine'), 3000);
confere(!!locE?.includes('cabine'), 'dentro do trem o local automático é a cabine', locE);
await tecla('KeyB');
const des = await lerAte(obs, (o) => o.modo === 'pe', 2000);
confere(des.modo === 'pe' && Math.hypot(des.pos[0] - antesEmb.pos[0], des.pos[1] - antesEmb.pos[1]) < 0.05, 'B: desembarca no último ponto a pé', des.pos);
const ovD = await ultimoOuvinte((o) => o.livre.ref === 'mundo' && o.livre.salto === des.salto, 3000);
confereMsg(!!ovD, 'desembarcado, o ouvinte volta ao mundo', ovD?.livre?.pos);

// ---- cada ponto de vista (clique no painel): o modo, o salto e a mensagem
for (const id of est.pontos) {
  const a = await obs();
  await clicar(`#pontos [data-id="${id}"]`);
  const b = await lerAte(obs, (o) => o.salto > a.salto, 3000);
  const esperado = ['chegada', 'via', 'plataforma'].includes(id) ? 'pe' : id === 'alto' ? 'voo' : 'embarcado';
  const m = await ultimoOuvinte((o) => o.livre.salto === b.salto, 3000);
  confere(b.salto > a.salto && b.modo === esperado && (reserva || m?.livre?.ref === (esperado === 'embarcado' ? 'corpo' : 'mundo')), `ponto de vista "${id}": ${esperado}`, { pos: b.pos, nome: b.nome });
}
// teclas 1–9: a 1 é o ponto de chegada
await tecla('Digit5');
const p5 = await lerAte(obs, (o) => o.modo === 'embarcado', 2000);
confere(p5.modo === 'embarcado' && p5.nome === 'na frente do veículo', 'tecla 5: o 5º ponto de vista (na frente)', p5.nome);
await tecla('Digit1');
const p1 = await lerAte(obs, (o) => o.modo === 'pe' && Math.abs(o.pos[1] + 4.68) < 0.01, 2000);
confere(p1.modo === 'pe' && Math.abs(p1.pos[1] + 4.68) < 0.01, 'tecla 1: de volta ao ponto de chegada', p1.pos);
// ajuda (H), vista técnica (T: marcadores das fontes), painel recolhido
await tecla('KeyH');
confere((await lerAte(() => ev(`!document.getElementById('ajuda').hidden`), (v) => v, 2000)) === true, 'H mostra a ajuda de novo');
await tecla('KeyT');
const tec = await lerAte(() => ev(`(() => { const k = window.__passagem.cena.current; let n = 0; k?.scene.traverseVisible((o) => { if (o.type === 'Mesh' && o.geometry?.type === 'SphereGeometry' && o.geometry.parameters.radius === 1) n++; }); return { on: ${P}.vistaTecnica, n }; })()`), (v) => v.on && v.n > 20, 3000);
confere(tec.on && tec.n > 20, 'T: vista técnica com os marcadores das fontes', tec);
await tecla('KeyT');
await clicar('#recolher');
const rec = await lerAte(() => ev(`({ painel: document.getElementById('controls').hidden, w: Math.round(document.getElementById('cena3d').getBoundingClientRect().width) })`), (v) => v.painel && v.w > 1300, 3000);
confere(rec.painel && rec.w > 1300, 'recolher o painel: a cena fica com a largura toda', rec);
await clicar('#recolher');

// ---- troca de ambiente: resposta ao impulso nova, mensagem com o ambiente, e o observador na plataforma
const durAntes = await ev(`${P}.audio.conv.buffer.duration`);
const nAmb = await marca();
await chip('ambiente', 'Estação');
const amb2 = await algumaDesde(nAmb, 'cena', (m) => m.amb?.id === 'estacao', 4000);
const durDepois = await lerAte(() => ev(`${P}.audio.conv.buffer.duration`), (d) => d !== durAntes, 4000);
confereMsg(amb2?.amb?.id === 'estacao' && amb2.amb.solo.tipo === 'concreto', 'ambiente estação mandado (solo concreto)', amb2?.amb?.id);
confere(durDepois !== durAntes, 'resposta ao impulso trocada', { antes: durAntes, depois: durDepois });
const naPlat = await lerAte(obs, (o) => Math.abs(o.pos[2] - 2.55) < 0.05, 3000);
confere(Math.abs(naPlat.pos[2] - 2.55) < 0.05, 'na estação o ponto de chegada fica em cima da plataforma (0,9 m)', naPlat.pos);
await chip('ambiente', 'Céu aberto');
const nLat = await marca();
await slider('lateral', 7.5);
confereMsg((await algumaDesde(nLat, 'cena', (m) => m.traj?.lateral === 7.5, 4000))?.traj.lateral === 7.5, 'slider do ponto de chegada manda a trajetória');
const o75 = await lerAte(obs, (o) => Math.abs(o.pos[1] + 7.5 + 1.68) < 0.01, 3000);
confere(Math.abs(o75.pos[1] + 9.18) < 0.01, 'e leva o observador ao ponto de chegada novo (7,5 m da lateral)', o75.pos);
// trem com menos vagões: monta de novo
await slider('N', 6);
const port2 = await ultimaAte('portador', (m) => m.config?.N === 6, 8000);
confereMsg(port2?.config.N === 6, 'N = 6 vagões monta o trem de novo', port2?.config.N);
const comp6 = await lerAte(() => ev(`${P}.corpo.comprimento`), (c) => c === 149.5, 4000);
confere(comp6 === 149.5, 'comprimento do corpo com 6 vagões', comp6);
// passa de novo a céu aberto, repetindo
await clicar('#repetir');
await clicar('#ignicao');
if (!(await ev(`${P}.andando`))) await clicar('#ignicao');
const tc = await lerAte(tele, (x) => !!x && x.v > 90 && x.n > 30, 20000);
confere(tc && tc.v > 90 && tc.n > 30, 'passagem a céu aberto andando', tc && { v: tc.v, n: tc.n });
await clicar('#ignicao');
if (await ev(`${P}.andando`)) await clicar('#ignicao');
await clicar('#repetir');
// helicóptero
await chip('portador', 'Helicóptero');
await ate(`!${P}.calibrando`, 30000);
const port3 = await ultimaAte('portador', (m) => m.tipo === 'rotor', 25000);
await lerAte(() => ev(`${P}.traj.altitude`), (a) => a === 150, 4000);
confereMsg(port3?.tipo === 'rotor' && port3.motor?.familia === 'pistao' && port3.motor.cfg.id === 'r44', 'helicóptero montado com o IO-540 do R44 (família aviação do Ronco)', port3 && { tipo: port3.tipo, motor: port3.motor?.familia, id: port3.motor?.cfg.id });
confere((await ev(`${P}.traj.altitude`)) === 150, 'padrão do helicóptero: altitude 150 m');

// ---- cada preset carrega e põe o observador no ponto de chegada dele, a pé, na distância da lateral do preset
const presetsInfo = await ev(`${P}.presetsVisiveis().map((p) => ({ id: p.id, lateral: p.lateral, portador: p.portador }))`);
let ruins = [];
for (const p of presetsInfo) {
  await clicar(`.preset[data-id="${p.id}"]`);
  await ate(`!${P}.calibrando && ${P}.presetId === ${JSON.stringify(p.id)}`, 40000);
  const r = await lerAte(() => ev(`(() => { const c = ${P}, o = c.obs, w = c.corpo.segmentos[0]?.largura ?? 2; return { modo: o.modo, m: -o.pos[1] - w / 2, z: o.pos[2] - c.lugar().chao(o.pos[0], o.pos[1]), nome: o.nome, portador: c.portador, msg: window.__msgs.filter((x) => x.type === 'portador').at(-1)?.tipo }; })()`),
    (r) => r.modo === 'pe' && Math.abs(r.m - p.lateral) < 0.02, 6000);
  const ok = r.modo === 'pe' && Math.abs(r.m - p.lateral) < 0.02 && Math.abs(r.z - 1.65) < 0.02 && r.portador === p.portador && (reserva || r.msg === p.portador || (p.portador === 'trem' && r.msg === 'trem'));
  if (!ok) ruins.push({ id: p.id, ...r });
}
confere(!ruins.length, `os ${presetsInfo.length} presets carregam, com o observador a pé no ponto de chegada (a lateral do preset, olho a 1,65 m do chão)`, ruins.length ? ruins : `${presetsInfo.length} ok`);
// na ponte, o ponto de chegada é o passeio de pedestres (o "acostamento" dela, com meio-fio de 0,2 m), a 5 m da lateral
await clicar('.preset[data-id="trembala-ponte"]');
const pt = await lerAte(obs, (o) => Math.abs(o.pos[1] + 6.68) < 0.01 && Math.abs(o.pos[2] - 1.85) < 0.01, 4000);
confere(Math.abs(pt.pos[1] + 6.68) < 0.01 && Math.abs(pt.pos[2] - 1.85) < 0.01, 'ponto de chegada na ponte: no passeio (meio-fio de 0,2 m), a 5 m da lateral', pt.pos);
// (cada preset remonta o lugar e o corpo: nada pode sobrar na placa de vídeo)
const mem = await lerAte(() => ev(`window.__passagem.cena.current?.renderer.info.memory`), (m) => !!m, 3000);
confere(!!mem && mem.textures <= 12 && mem.geometries < 600, 'trocar de preset não acumula texturas nem geometrias', mem);

// ---- carro na rua a 6 m: Camaro SS (Ronco adaptado), 3ª, pé no fundo, 108 km/h
await clicar('.preset[data-id="carro-rua"]');
await ate(`!${P}.calibrando`, 30000);
const portC = await ultimaAte('portador', (m) => m.tipo === 'carro' && m.motor?.cfg?.id === 'muscle', 25000);
confereMsg(portC?.tipo === 'carro' && portC.motor?.familia === 'pistao' && portC.motor.cfg.id === 'muscle' && portC.motor.cfg.kAbs > 0, 'carro montado com o motor do Ronco calibrado na página (kAbs)', portC && { tipo: portC.tipo, motor: portC.motor?.familia, id: portC.motor?.cfg.id, kAbs: portC.motor?.cfg.kAbs });
const secC = await lerAte(() => ev(`[...document.querySelectorAll('#controls h2')].map((h) => h.textContent)`), (v) => v.includes('Motor'), 4000);
confere(secC.includes('Motor') && (await lerAte(() => ev(`document.getElementById('motorPreset')?.options.length`), (n) => n > 50, 4000)) > 50, 'seção Motor com os presets do Ronco', secC);
const pontosC = await ev(`[...document.querySelectorAll('#pontos .chip')].map((b) => b.dataset.id)`);
confere(['escape', 'ponteira', 'cofre', 'embarcar'].every((x) => pontosC.includes(x)), 'no carro: atrás do escape, na ponteira e no cofre', pontosC);
await clicar('#ignicao');
let maxC = -1e9, rpmC = 0, vC = 0, marchaC = 0;
await zeraMax();
await janela(() => ev(`(() => { const t = ${P}.tele; const m = window.__passagem.med; return t && { dBA: m.maxA, rpm: t.portador.rpm, v: t.portador.v, marcha: t.portador.marcha }; })()`),
  (r) => { if (Number.isFinite(r.dBA)) maxC = Math.max(maxC, r.dBA); rpmC = Math.max(rpmC, r.rpm || 0); vC = Math.max(vC, r.v); marchaC = r.marcha; },
  () => Math.abs(vC - 30) < 0.5 && marchaC === 3 && rpmC > 3500 && maxC > 80, 9000, 30000, 60);
confere(Math.abs(vC - 30) < 0.5 && marchaC === 3 && rpmC > 3500 && rpmC < 4500, 'carro a 108 km/h em 3ª com o motor preso às rodas', { v: vC, marcha: marchaC, rpm: Math.round(rpmC) });
confere(maxC > 80 && maxC < 100, 'nível no ouvido na passagem do carro (direto + reverberação)', `${maxC.toFixed(1)} dB(A)`);
await clicar('#ignicao');
if (await ev(`${P}.andando`)) await clicar('#ignicao');
// ---- RX-7 FD na rua (rotativo adaptado, etapa 4): 3ª, pé no fundo, 100 km/h
await clicar('.preset[data-id="rx7-rua"]');
await ate(`!${P}.calibrando`, 30000);
const portR = await ultimaAte('portador', (m) => m.tipo === 'carro' && m.motor?.cfg?.id === 'rx7fd', 25000);
confereMsg(portR?.tipo === 'carro' && portR.motor?.familia === 'rotativo' && portR.motor.cfg.id === 'rx7fd' && portR.motor.cfg.kAbs > 0, 'carro montado com o Wankel do RX-7 calibrado na página (kAbs)', portR && { tipo: portR.tipo, motor: portR.motor?.familia, id: portR.motor?.cfg.id, kAbs: portR.motor?.cfg.kAbs });
// (etapa 2: a rua de bairro, com a calçada de 15 cm em que você nasce e as casas que não se atravessam)
const rua = await lerAte(() => ev(`(() => { const c = ${P}, k = window.__passagem.cena.current, lg = c.lugar(); return { cen: c.cenario(), mundo: k?.mundo?.cenario, z: +c.obs.pos[2].toFixed(2), casas: lg.obstaculos.length, parede: (() => { const o = lg.obstaculos.find((x) => x.m0 > 0); if (!o) return null; const sc = (o.s0 + o.s1) / 2, a = lg.mundo(sc, o.m0 - 1, 1.65), n = lg.mundo(sc, o.m0 + 1, 1.65); lg.limitar(a, n, false, 1.65); return +(lg.projetar(n[0], n[1]).m - o.m0).toFixed(2); })() }; })()`), (r) => r.mundo === 'rua', 8000);
confere(rua?.cen === 'rua' && rua.mundo === 'rua' && Math.abs(rua.z - 1.8) < 0.01 && rua.casas > 20 && rua.parede != null && rua.parede < 0, 'RX-7 na rua: o cenário da rua, você na calçada (olho a 1,8 m), a parede da casa segura o passo', rua);
await clicar('#ignicao');
let maxR = -1e9, rpmR = 0;
await zeraMax();
await janela(() => ev(`(() => { const t = ${P}.tele; const m = window.__passagem.med; return t && { dBA: m.maxA, rpm: t.portador.rpm }; })()`),
  (r) => { if (Number.isFinite(r.dBA)) maxR = Math.max(maxR, r.dBA); rpmR = Math.max(rpmR, r.rpm || 0); },
  () => rpmR > 4300 && maxR > 75, 8000, 30000, 60);
confere(rpmR > 4300 && rpmR < 5300, 'RX-7 a 100 km/h em 3ª com o motor preso às rodas (≈ 4 790 rpm)', Math.round(rpmR));
confere(maxR > 75 && maxR < 105, 'nível no ouvido na passagem do RX-7', `${maxR.toFixed(1)} dB(A)`);
await clicar('#ignicao');
if (await ev(`${P}.andando`)) await clicar('#ignicao');
// ---- locomotiva EMD em N8 (diesel adaptado, governador do motor, carga do portador)
await clicar('.preset[data-id="locomotiva-patio"]');
await ate(`!${P}.calibrando`, 30000);
const portL = await ultimaAte('portador', (m) => m.tipo === 'locomotiva' && m.motor?.familia === 'diesel', 25000);
confereMsg(portL?.tipo === 'locomotiva' && portL.motor?.familia === 'diesel' && portL.motor.cfg.uso === 'locomotiva' && portL.comando?.notch === 8, 'locomotiva montada com o EMD 710 (uso locomotiva) e notch 8', portL && { tipo: portL.tipo, motor: portL.motor?.familia, uso: portL.motor?.cfg.uso, notch: portL.comando?.notch });
// (etapa 2: o pátio de manobras e o modelo da SD70ACe: um grupo por segmento, as rodas dos truques em instâncias)
const patio = await lerAte(() => ev(`(() => { const c = ${P}, k = window.__passagem.cena.current; return { cen: k?.mundo?.cenario, segs: k?.segs.length, corpo: c.corpo.segmentos.length, rodas: (k?.rodas ?? []).reduce((a, r) => a + r.itens.length, 0) }; })()`), (r) => r.cen === 'patio-ferro' && r.segs === r.corpo, 8000);
confere(patio?.cen === 'patio-ferro' && patio.segs === patio.corpo && patio.rodas === 12, 'locomotiva no pátio de manobras: o modelo com um grupo por segmento e as 12 rodas dos truques girando', patio);
await clicar('#ignicao');
let rpmL = 0, maxL = -1e9;
await zeraMax();
// (só conta a telemetria da locomotiva, que tem o notch: as primeiras leituras ainda podem ser as do RX-7)
await janela(() => ev(`(() => { const t = ${P}.tele; const m = window.__passagem.med; return t && t.portador.notch !== undefined && { dBA: m.maxA, rpm: t.portador.rpmEixo }; })()`),
  (r) => { if (Number.isFinite(r.dBA)) maxL = Math.max(maxL, r.dBA); rpmL = Math.max(rpmL, r.rpm || 0); },
  () => rpmL > 840 && maxL > 75, 16000, 40000, 80);
confere(rpmL > 840 && rpmL < 920, 'locomotiva sobe ao notch 8 (EMD 710: 904 rpm)', Math.round(rpmL));
confere(maxL > 75 && maxL < 110, 'nível no ouvido com a locomotiva', `${maxL.toFixed(1)} dB(A)`);
await clicar('#ignicao');
if (await ev(`${P}.andando`)) await clicar('#ignicao');
// modo de testes: voltar ao padrão
await chip('portador', 'Trem');
await slider('ur', 30); await slider('temperatura', -5);
await clicar('#padrao');
const pd = await lerAte(() => ev(`({ ur: ${P}.ar.ur, t: ${P}.ar.temperatura, lat: ${P}.traj.lateral, v: ${P}.vKmh, amb: ${P}.ambiente, N: ${P}.trem.N, comp: ${P}.traj.comprimento, modo: ${P}.obs.modo, y: ${P}.obs.pos[1] })`),
  (d) => d.ur === 60 && d.t === 20 && d.lat === 3 && d.v === 350 && d.amb === 'tunel' && d.N === 10 && d.comp === 3000 && d.modo === 'pe' && Math.abs(d.y + 4.68) < 0.01, 6000);
confere(pd.ur === 60 && pd.t === 20 && pd.lat === 3 && pd.v === 350 && pd.amb === 'tunel' && pd.N === 10 && pd.comp === 3000 && pd.modo === 'pe' && Math.abs(pd.y + 4.68) < 0.01, 'voltar ao padrão (CENA 3.1), com você no ponto de chegada', pd);
const ar = await ultimaAte('ar', (m) => m.ur === 60 && m.temperatura === 20, 4000);
confereMsg(ar?.ur === 60 && ar?.temperatura === 20, 'ar padrão mandado');
if (foto) await fotografar(foto);

// ---- celular, 400 px: a cena aparece, o círculo de andar anda e arrastar olha (só no Chromium: emulação de toque)
if (!firefox && toque) {
  await toque.tela(400, 820);
  await espera(600);
  const m = await ev(`(() => { const r = document.getElementById('cena3d').getBoundingClientRect(), b = document.querySelector('.manche-base')?.getBoundingClientRect(); return { cena: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], manche: b && [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2), Math.round(b.width)], larguraPagina: document.documentElement.scrollWidth }; })()`);
  confere(m.cena[2] >= 340 && m.cena[3] >= 300 && m.larguraPagina <= 400 && m.manche?.[2] > 50, 'a 400 px: cena de pé, sem rolar de lado, com o círculo de andar', m);
  if (m.manche?.[2] > 50) {
    await ev(`window.scrollTo(0, 0)`);
    const m2 = await ev(`(() => { const b = document.querySelector('.manche-base').getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2, b.width]; })()`);
    const a = await obs();
    await toque.arrastar(m2[0], m2[1], m2[0], m2[1] - m2[2] * 0.45, 1500);
    const b = await obs();
    const d = Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1]);
    confere(d > 0.8, 'no toque, o círculo anda', `${d.toFixed(2)} m`);
    const r0 = (await obs()).rumo;
    await toque.arrastar(m.cena[0] + m.cena[2] * 0.7, m.cena[1] + m.cena[3] * 0.4, m.cena[0] + m.cena[2] * 0.3, m.cena[1] + m.cena[3] * 0.4, 400);
    const r1 = (await obs()).rumo;
    confere(Math.abs(r1 - r0) > 0.3, 'no toque, arrastar na cena olha', { antes: r0, depois: r1 });
  }
}

console.log(`mensagens para o worklet: ${await ev('window.__msgs.length')}`);
if (reserva) logs.splice(0, logs.length, ...logs.filter((l) => !/ScriptProcessorNode is deprecated/.test(l)));
// avisos de WebGL do SwiftShader (headless, sem GPU) não são erros da página; o Pointer Lock recusado no headless também não
const erros = logs.filter((l) => !/GPU stall due to ReadPixels|Automatic fallback to software WebGL|swiftshader|pointer lock|PointerLock/i.test(l));
console.log(erros.length ? erros.join('\n') : '(sem erros no console)');
confere(!erros.length, 'console sem erros');
fechar();
servidor?.close();
await espera(500);
try { fs.rmSync(perfil, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
console.log(falhas ? `${falhas} FALHA(S)` : 'TUDO OK');
process.exit(falhas ? 1 : 0);
