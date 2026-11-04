// Teste da página Passagem / modo de testes num navegador headless de verdade (com áudio e WebGL).
//
//   node tools/passagem-navegador.mjs [url da passagem.html] [--firefox] [--reserva] [--porta N] [--foto arquivo.png]
//
// Sem url, serve o `dist/` (npm run build antes) em http://127.0.0.1:<porta>/data/engine/, como no site.
// --reserva bloqueia o AudioWorklet: a página tem de cair no ScriptProcessorNode (DSP na thread principal).
// Chromium por CDP (/usr/bin/chromium) ou Firefox por WebDriver BiDi (/usr/bin/firefox), sem dependências.
// Um script antes da página grava toda mensagem mandada pela porta do AudioWorklet.
//
// Roteiro: carga (presets, portadores pela tabela de compatibilidade, cena 3D desenhando), dispara o
// trem-bala no túnel a 350 km/h e acompanha a passagem (nariz chegando, onda de compressão do túnel
// ~2 kPa antes do trem, onda de nariz, nível em dB(A) no ouvido real), arrasta a cabeça na cena 3D,
// usa os atalhos do gimbal e os sliders (mensagens 'cena' com o ouvinte novo), troca o ambiente (resposta
// ao impulso nova, mensagem com o ambiente), modo de testes (voltar ao padrão), câmera, os portadores com motor
// (carro na rua com o Camaro do Ronco, locomotiva EMD em N8 com o diesel) e console sem erros.
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
const GANCHO = `(() => {
  window.__msgs = [];
  const orig = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (m, ...r) { try { if (m && typeof m === "object" && typeof m.type === "string") window.__msgs.push(JSON.parse(JSON.stringify(m))); } catch {} return orig.call(this, m, ...r); };
})();${reserva ? "\nAudioWorklet.prototype.addModule = () => Promise.reject(new Error('bloqueado no teste'));" : ''}`;

const logs = [];
let ev, fechar, fotografar, mouse;

if (!firefox) {
  const chrome = spawn(process.env.CHROMIUM || '/usr/bin/chromium', ['--headless=new', `--remote-debugging-port=${porta}`, '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1400,900', `--user-data-dir=${perfil}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
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
  await cmd('Runtime.enable'); await cmd('Log.enable'); await cmd('Network.enable'); await cmd('Page.enable');
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: GANCHO });
  await cmd('Page.navigate', { url });
} else {
  fs.writeFileSync(`${perfil}/user.js`, 'user_pref("media.autoplay.default", 0);\nuser_pref("media.autoplay.blocking_policy", 0);\nuser_pref("webgl.force-enabled", true);\n');
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
const clicar = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('não achei ${sel.replace(/'/g, '')}'); e.click(); return true; })()`);
const chip = (grupo, texto) => ev(`(() => { const b = [...document.querySelectorAll('#${grupo} .chip')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(texto)})); if (!b) throw new Error('chip ${texto} em ${grupo}'); b.click(); return true; })()`);
const slider = (id, v) => ev(`(() => { const r = document.getElementById('${id}'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(r, '${v}'); r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); return r.closest('.field').querySelector('output').textContent; })()`);
const ultimos = (tipo) => ev(`window.__msgs.filter((m) => m.type === '${tipo}')`);
const texto = (id) => ev(`document.getElementById(${JSON.stringify(id)})?.textContent ?? null`);
const P = 'window.__passagem.c';
// telemetria guardada pela página (vale também na reserva, em que nada passa pela porta)
const tele = () => ev(`(() => { const t = ${P}.tele; return t && { s: t.portador.s, v: t.portador.v, p: t.cena.pressaoPa, pmax: t.pressao.max, pmin: t.pressao.min, tunel: t.pressao.tunel, spl: t.cena.splDbA, vento: t.cena.ventoMs, n: t.cena.fontes.length, lado: t.lado }; })()`);

await espera(2500);
confere((await ev('document.title')) === 'Passagem', 'título');
const est = await ev(`({
  presets: [...document.querySelectorAll('.preset')].map((b) => b.dataset.id + (b.disabled ? '(d)' : '')),
  portadores: [...document.querySelectorAll('#portador .chip')].map((b) => b.textContent + (b.disabled ? '(d)' : '')),
  secoes: [...document.querySelectorAll('#controls h2')].map((h) => h.textContent),
  sliders: [...document.querySelectorAll('#controls input[type=range]')].map((i) => i.id),
  atalhos: [...document.querySelectorAll('#atalhos .chip')].map((b) => b.dataset.id + (b.disabled ? '(d)' : '')),
  canvas: [...document.querySelectorAll('canvas')].map((c) => c.id + ':' + Math.round(c.getBoundingClientRect().width) + 'x' + Math.round(c.getBoundingClientRect().height)),
  placa: document.getElementById('plate')?.textContent,
})`);
console.log('estrutura:', JSON.stringify(est));
// (29: os 13 da etapa 1 e 2, os 5 da etapa 3, radiais e aviação a pistão, os 3 da etapa 4, rotativos, os 3 da etapa 5,
// vapor, e os 5 da etapa 6, elétrico)
const N_PRESETS = 13 + 5 + 3 + 3 + 5;
confere(est.presets.length === N_PRESETS && !est.presets.some((p) => p.endsWith('(d)')), `presets: ${N_PRESETS}, todos habilitados (os com motor pelos adaptadores)`, est.presets);
// (Trator e Barco: portadores do vapor, etapa 5; Drone: do elétrico, etapa 6)
confere(est.portadores.join() === 'Trem,Helicóptero,Carro,Avião de hélice,Gerador,Locomotiva,Avião a jato,Trator,Barco,Drone', 'portadores pela tabela de compatibilidade e os adaptadores', est.portadores);
confere(JSON.stringify(est.secoes) === JSON.stringify(['Portador', 'Passagem', 'Ambiente', 'Trajetória', 'Ouvinte', 'Trem', 'Ar', 'Escuta', 'Modo de testes']), 'seções do painel', est.secoes);
confere(['vKmh', 'x0', 'rtFator', 'tunelArea', 'tunelComp', 'tunelBoca', 'comprimento', 'lateral', 'altitude', 'ouvX', 'ouvZ', 'N', 'Lc', 'vao', 'truque', 'lNariz', 'ur', 'temperatura', 'master'].every((s) => est.sliders.includes(s)), 'parâmetros livres do modo de testes', est.sliders.length);
confere(est.atalhos.join() === 'escape(d),ponteira(d),frente,lateral,atras,cabine,cofre(d),topo', 'atalhos do gimbal (sem motor: escape, ponteira e cofre desabilitados)', est.atalhos);
confere(est.canvas.length === 4 && est.canvas.every((c) => !/:0x|x0$/.test(c)), 'canvas com tamanho', est.canvas);
const q3d = await ate(`+document.getElementById('cena3d').dataset.quadros > 3 && +document.getElementById('cena3d').dataset.quadros`, 8000);
const aviso = await texto('aviso3d');
confere(!!q3d, 'cena 3D desenhando (WebGL)', q3d || aviso);

// foto do trem parado perto do ouvinte, de três quartos, pelo nariz (só com --foto)
if (foto) {
  await clicar('.preset[data-id="trembala-ceu"]');
  await ev(`(() => { const c = ${P}, k = window.__passagem.cena.current; c.moverCorpo(-c.corpo.comprimento / 2 + 25); if (k) { k.definirCamera('livre'); k.camera.position.set(42, -26, 9); k.controls.target.set(12, 0, 1.8); } return true; })()`);
  await espera(800);
  await fotografar(foto.replace(/\.png$/, '-nariz.png'));
  await clicar('.camera [data-cam="ouvinte"]');
}

// ---- dispara o trem-bala no túnel
await clicar('.preset[data-id="trembala-tunel"]');
await clicar('#ignicao');
const pronto = await ate(`${P}.tele && ${P}.andando`, 6000);
confere(!!pronto, 'áudio pronto e telemetria chegando');
const modo = await ev(`${P}.audio?.modo`);
confere(reserva ? modo === 'script' : modo === 'worklet', `áudio pelo ${reserva ? 'ScriptProcessorNode (reserva)' : 'AudioWorklet'}`, modo);
const msgs0 = await ev(`window.__msgs.map((m) => m.type)`);
confereMsg(msgs0.includes('portador') && msgs0.includes('cena') && msgs0.includes('comando'), 'mensagens portador, cena e comando', msgs0.slice(0, 10));
const port0 = (await ultimos('portador')).at(-1);
confereMsg(port0?.tipo === 'trem' && port0.config.N === 10 && port0.config.faces === 'duas' && port0.config.calibracao?.length > 40, 'trem de 10 vagões, duas faces, calibrações da página', port0 && { N: port0.config.N, cal: port0.config.calibracao?.length });
const cena0 = (await ultimos('cena')).at(-1);
confereMsg(cena0?.amb?.id === 'tunel' && cena0.traj.lateral === 3 && cena0.amb.tunel.xEntrada === -500, 'cena: túnel, 3 m, boca a 500 m', cena0 && { amb: cena0.amb?.id, lat: cena0.traj?.lateral });
const conv = await ev(`({ n: ${P}.audio.conv.normalize, dur: ${P}.audio.conv.buffer?.duration, wet: ${P}.audio.wet.gain.value })`);
confere(conv.n === false && conv.dur > 5.5, 'reverberação da Cena: resposta por banda, normalize = false', conv);

// acompanha a passagem: 600 m a 97 m/s → nariz abeam em ~6,2 s, cauda em ~8,8 s
let maxTun = 0, maxP = -1e9, minP = 1e9, maxA = -1e9, tunT = null, narizT = null, vMax = 0;
const t0 = Date.now();
while (Date.now() - t0 < 12000) {
  const r = await ev(`(() => { const t = ${P}.tele; const m = window.__passagem.med; return t && { tun: t.pressao.tunel, max: t.pressao.max, min: t.pressao.min, nariz: t.pressao.nariz, dBA: m.dBA, xi: ${P}.xiNariz(t.portador.s), v: t.portador.v }; })()`);
  if (r) {
    const dt = (Date.now() - t0) / 1000;
    if (r.tun > maxTun) maxTun = r.tun; if (tunT == null && r.tun > 500) tunT = dt;
    if (narizT == null && r.xi > 0) { narizT = dt; if (foto) { await espera(900); await fotografar(foto.replace(/\.png$/, '-abeam.png')); } }
    if (Math.abs(r.nariz) > 0) { maxP = Math.max(maxP, r.max - r.tun); minP = Math.min(minP, r.min - r.tun); }
    if (Number.isFinite(r.dBA)) maxA = Math.max(maxA, r.dBA);
    vMax = Math.max(vMax, r.v);
  }
  await espera(40);
}
confere(Math.abs(vMax * 3.6 - 350) < 1, 'velocidade 350 km/h', (vMax * 3.6).toFixed(1));
confere(maxTun > 1600 && maxTun < 2400, 'onda de compressão do túnel ~2 kPa', `${maxTun.toFixed(0)} Pa`);
confere(tunT != null && narizT != null && narizT - tunT > 2.5, 'a onda do túnel chega segundos antes do nariz', { onda: tunT, nariz: narizT });
confere(maxP - minP > 90 && maxP - minP < 220, 'onda de nariz/cauda (pico a pico, alvo 150 ± 30 Pa)', `${(maxP - minP).toFixed(0)} Pa`);
confere(maxA > 105 && maxA < 125, 'nível no ouvido real (direto + túnel) em dB(A)', `${maxA.toFixed(1)} dB(A)`);
const leit = await ev(`({ nivel: document.getElementById('ro-nivel').textContent, doppler: document.getElementById('ro-doppler').textContent, nariz: document.getElementById('ro-nariz').textContent, tunel: document.getElementById('ro-tunel').textContent, hud: document.getElementById('hud').textContent })`);
confere(/dB\(A\)/.test(leit.nivel) && /×/.test(leit.doppler) && /kPa/.test(leit.tunel) && /km\/h/.test(leit.hud), 'leituras: nível, Doppler, túnel, HUD', leit);
const rms = await ev(`document.getElementById('osc').dataset.rms`);
confere(+rms > -70, 'som saindo (RMS no analisador)', `${rms} dBFS`);
if (foto) await fotografar(foto.replace(/\.png$/, '-tunel.png'));

// ---- gimbal: atalho lateral, depois arrasta a cabeça na cena 3D
await clicar('#atalhos [data-id="lateral"]');
await espera(300);
const g1 = (await ultimos('cena')).at(-1);
confereMsg(g1?.ouv?.modo === 'gimbal' && g1.ouv.gimbal.az === 90 && g1.ouv.gimbal.r === 5, 'atalho "lateral": gimbal 90°, 5 m', g1?.ouv);
const sl = await ev(`[document.getElementById('az')?.value, document.getElementById('r')?.value]`);
confere(sl[0] === '90' && sl[1] === '5', 'sliders do gimbal acompanham', sl);
await slider('el', 30);
await espera(200);
confereMsg((await ultimos('cena')).at(-1)?.ouv.gimbal.el === 30, 'slider de elevação manda o ouvinte novo');
// arrasto da cabeça: projeta a cabeça na tela e arrasta 60 px
const cab = await ev(`(() => { const k = window.__passagem.cena.current; if (!k) return null; const v = k.cabeca.position.clone().project(k.camera); const r = k.canvas.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, az: ${P}.ouv.gimbal.az, r: ${P}.ouv.gimbal.r }; })()`);
if (cab) {
  await mouse('down', cab.x, cab.y); await espera(60);
  for (let i = 1; i <= 6; i++) { await mouse('move', cab.x + 10 * i, cab.y + 4 * i); await espera(40); }
  await mouse('up', cab.x + 60, cab.y + 24); await espera(250);
  const depois = await ev(`({ az: ${P}.ouv.gimbal.az, r: ${P}.ouv.gimbal.r })`);
  confere(depois.az !== cab.az || depois.r !== cab.r, 'arrastar a cabeça muda azimute/distância', { antes: [cab.az, cab.r], depois });
  confereMsg((await ultimos('cena')).at(-1)?.ouv.gimbal.az === depois.az, 'o arrasto vai ao worklet');
} else confere(false, 'arrastar a cabeça (sem cena 3D)');
// cabine (lei da massa)
await clicar('#atalhos [data-id="cabine"]');
await espera(200);
confere((await texto('localEfetivo')).includes('cabine'), 'atalho "cabine": local automático vira cabine', await texto('localEfetivo'));
// clique numa fonte: vira alvo e mostra a ficha
await ev(`(() => { ${P}.escolherFonte('pantografo.0'); ${P}.setOuvinte({}, { alvo: 'pantografo.0' }); })()`);
await espera(200);
confere(/pantografo\.0/.test((await texto('ficha')) || ''), 'ficha da fonte escolhida', (await texto('ficha'))?.slice(0, 60));
await chip('modoOuvinte', 'Parado');

// ---- troca de ambiente: resposta ao impulso nova e mensagem com o ambiente
const durAntes = await ev(`${P}.audio.conv.buffer.duration`);
await chip('ambiente', 'Estação');
await espera(400);
const amb2 = (await ultimos('cena')).at(-1);
const durDepois = await ev(`${P}.audio.conv.buffer.duration`);
confereMsg(amb2?.amb?.id === 'estacao' && amb2.amb.solo.tipo === 'concreto', 'ambiente estação mandado (solo concreto)', amb2?.amb?.id);
confere(durDepois !== durAntes, 'resposta ao impulso trocada', { antes: durAntes, depois: durDepois });
await chip('ambiente', 'Céu aberto');
await slider('lateral', 7.5);
await espera(200);
confereMsg((await ultimos('cena')).at(-1)?.traj.lateral === 7.5, 'slider da lateral manda a trajetória');
// trem com menos vagões: monta de novo
await slider('N', 6);
await espera(400);
const port2 = (await ultimos('portador')).at(-1);
confereMsg(port2?.config.N === 6, 'N = 6 vagões monta o trem de novo', port2?.config.N);
confere((await ev(`${P}.corpo.comprimento`)) === 149.5, 'comprimento do corpo com 6 vagões', await ev(`${P}.corpo.comprimento`));
// passa de novo a céu aberto, repetindo
await clicar('#repetir');
await clicar('#ignicao');
if (!(await ev(`${P}.andando`))) await clicar('#ignicao');
await espera(3500);
const tc = await tele();
confere(tc && tc.v > 90 && tc.n > 30, 'passagem a céu aberto andando', tc);
// câmera: os três modos
await clicar('.camera [data-cam="corpo"]'); await espera(300);
await clicar('.camera [data-cam="livre"]'); await espera(300);
confere((await ev(`window.__passagem.cena.current?.modo`)) === 'livre', 'câmera livre');
await clicar('.camera [data-cam="ouvinte"]');
// helicóptero
await chip('portador', 'Helicóptero');
await espera(800);
const port3 = (await ultimos('portador')).at(-1);
confereMsg(port3?.tipo === 'rotor' && port3.motor?.familia === 'pistao' && port3.motor.cfg.id === 'r44', 'helicóptero montado com o O-540 do R44 (família aviação do Ronco)', port3 && { tipo: port3.tipo, motor: port3.motor?.familia, id: port3.motor?.cfg.id });
confere((await ev(`${P}.traj.altitude`)) === 150, 'padrão do helicóptero: altitude 150 m');
// ---- carro na rua a 6 m: Camaro SS (Ronco adaptado), 3ª, pé no fundo, 108 km/h
await clicar('#ignicao');
if (await ev(`${P}.andando`)) await clicar('#ignicao');
await clicar('.preset[data-id="carro-rua"]');
await espera(600);
const portC = (await ultimos('portador')).at(-1);
confereMsg(portC?.tipo === 'carro' && portC.motor?.familia === 'pistao' && portC.motor.cfg.id === 'muscle' && portC.motor.cfg.kAbs > 0, 'carro montado com o motor do Ronco calibrado na página (kAbs)', portC && { tipo: portC.tipo, motor: portC.motor?.familia, id: portC.motor?.cfg.id, kAbs: portC.motor?.cfg.kAbs });
const secC = await ev(`[...document.querySelectorAll('#controls h2')].map((h) => h.textContent)`);
confere(secC.includes('Motor') && (await ev(`document.getElementById('motorPreset')?.options.length`)) > 50, 'seção Motor com os presets do Ronco', secC);
await clicar('#ignicao');
let maxC = -1e9, rpmC = 0, vC = 0, marchaC = 0;
const tc0 = Date.now();
while (Date.now() - tc0 < 9000) {
  const r = await ev(`(() => { const t = ${P}.tele; const m = window.__passagem.med; return t && { dBA: m.dBA, rpm: t.portador.rpm, v: t.portador.v, marcha: t.portador.marcha }; })()`);
  if (r) { if (Number.isFinite(r.dBA)) maxC = Math.max(maxC, r.dBA); rpmC = Math.max(rpmC, r.rpm || 0); vC = Math.max(vC, r.v); marchaC = r.marcha; }
  await espera(60);
}
confere(Math.abs(vC - 30) < 0.5 && marchaC === 3 && rpmC > 3500 && rpmC < 4500, 'carro a 108 km/h em 3ª com o motor preso às rodas', { v: vC, marcha: marchaC, rpm: Math.round(rpmC) });
confere(maxC > 80 && maxC < 100, 'nível no ouvido na passagem do carro (direto + reverberação)', `${maxC.toFixed(1)} dB(A)`);
await clicar('#ignicao');
if (await ev(`${P}.andando`)) await clicar('#ignicao');
// ---- RX-7 FD na rua (rotativo adaptado, etapa 4): 3ª, pé no fundo, 100 km/h
await clicar('.preset[data-id="rx7-rua"]');
await espera(800);
const portR = (await ultimos('portador')).at(-1);
confereMsg(portR?.tipo === 'carro' && portR.motor?.familia === 'rotativo' && portR.motor.cfg.id === 'rx7fd' && portR.motor.cfg.kAbs > 0, 'carro montado com o Wankel do RX-7 calibrado na página (kAbs)', portR && { tipo: portR.tipo, motor: portR.motor?.familia, id: portR.motor?.cfg.id, kAbs: portR.motor?.cfg.kAbs });
await clicar('#ignicao');
let maxR = -1e9, rpmR = 0;
const tr0 = Date.now();
while (Date.now() - tr0 < 8000) {
  const r = await ev(`(() => { const t = ${P}.tele; const m = window.__passagem.med; return t && { dBA: m.dBA, rpm: t.portador.rpm }; })()`);
  if (r) { if (Number.isFinite(r.dBA)) maxR = Math.max(maxR, r.dBA); rpmR = Math.max(rpmR, r.rpm || 0); }
  await espera(60);
}
confere(rpmR > 4300 && rpmR < 5300, 'RX-7 a 100 km/h em 3ª com o motor preso às rodas (≈ 4 790 rpm)', Math.round(rpmR));
confere(maxR > 75 && maxR < 105, 'nível no ouvido na passagem do RX-7', `${maxR.toFixed(1)} dB(A)`);
await clicar('#ignicao');
if (await ev(`${P}.andando`)) await clicar('#ignicao');
// ---- locomotiva EMD em N8 (diesel adaptado, governador do motor, carga do portador)
await clicar('.preset[data-id="locomotiva-patio"]');
await espera(600);
const portL = (await ultimos('portador')).at(-1);
confereMsg(portL?.tipo === 'locomotiva' && portL.motor?.familia === 'diesel' && portL.motor.cfg.uso === 'locomotiva' && portL.comando?.notch === 8, 'locomotiva montada com o EMD 710 (uso locomotiva) e notch 8', portL && { tipo: portL.tipo, motor: portL.motor?.familia, uso: portL.motor?.cfg.uso, notch: portL.comando?.notch });
await clicar('#ignicao');
let rpmL = 0, maxL = -1e9;
const tl0 = Date.now();
while (Date.now() - tl0 < 16000) {
  const r = await ev(`(() => { const t = ${P}.tele; const m = window.__passagem.med; return t && { dBA: m.dBA, rpm: t.portador.rpmEixo }; })()`);
  if (r) { if (Number.isFinite(r.dBA)) maxL = Math.max(maxL, r.dBA); rpmL = Math.max(rpmL, r.rpm || 0); }
  await espera(80);
}
confere(rpmL > 840 && rpmL < 920, 'locomotiva sobe ao notch 8 (EMD 710: 904 rpm)', Math.round(rpmL));
confere(maxL > 75 && maxL < 110, 'nível no ouvido com a locomotiva', `${maxL.toFixed(1)} dB(A)`);
await clicar('#ignicao');
if (await ev(`${P}.andando`)) await clicar('#ignicao');
// modo de testes: voltar ao padrão
await chip('portador', 'Trem');
await slider('ur', 30); await slider('temperatura', -5);
await clicar('#padrao');
await espera(300);
const pd = await ev(`({ ur: ${P}.ar.ur, t: ${P}.ar.temperatura, lat: ${P}.traj.lateral, v: ${P}.vKmh, amb: ${P}.ambiente, N: ${P}.trem.N, comp: ${P}.traj.comprimento })`);
confere(pd.ur === 60 && pd.t === 20 && pd.lat === 3 && pd.v === 350 && pd.amb === 'tunel' && pd.N === 10 && pd.comp === 3000, 'voltar ao padrão (CENA 3.1)', pd);
const ar = (await ultimos('ar')).at(-1);
confereMsg(ar?.ur === 60 && ar?.temperatura === 20, 'ar padrão mandado');
await clicar('#ignicao');
if (foto) await fotografar(foto);

console.log(`mensagens para o worklet: ${await ev('window.__msgs.length')}`);
if (reserva) logs.splice(0, logs.length, ...logs.filter((l) => !/ScriptProcessorNode is deprecated/.test(l)));
// avisos de WebGL do SwiftShader (headless, sem GPU) não são erros da página
const erros = logs.filter((l) => !/GPU stall due to ReadPixels|Automatic fallback to software WebGL|swiftshader/i.test(l));
console.log(erros.length ? erros.join('\n') : '(sem erros no console)');
confere(!erros.length, 'console sem erros');
fechar();
servidor?.close();
await espera(500);
try { fs.rmSync(perfil, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
console.log(falhas ? `${falhas} FALHA(S)` : 'TUDO OK');
process.exit(falhas ? 1 : 0);
