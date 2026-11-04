// Teste da página do Radial num navegador headless de verdade (o padrão de tools/diesel-navegador.mjs: CDP no
// Chromium, WebDriver BiDi no Firefox). Partida direta com a contagem de pás e os magnetos na 9ª, manete de potência (a
// da Turbina: fica onde foi deixada; W/S seguradas, 1–4, PageUp/PageDown, arrasto), manete de passo, magnetos (M),
// mistura ([ ]), ambiente e microfone, arranque de inércia (energizar → engatar) e corte da mistura no DC-3, ordem
// decorrente do R-4360, pedal e câmbio do Sherman; confere telemetria, som na saída, worklet e console.
//
//   node tools/radial-navegador.mjs [url da radial.html] [chromium|firefox] [porta]
//   sem url: serve o dist/ em http://127.0.0.1:<porta+1>/data/engine/ (rode npm run build antes)
//
// CHROMIUM=/caminho e FIREFOX=/caminho trocam os executáveis; SHOT=arquivo.png grava uma captura (Chromium);
// RESERVA=1 bloqueia o AudioWorklet para testar a reserva na thread principal. Sai com código ≠ 0 se algo falhar.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let url = process.argv[2];
const nav = process.argv[3] || 'chromium';
const porta = +(process.argv[4] || (nav === 'firefox' ? 9490 : 9370));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const perfil = fs.mkdtempSync(path.join(os.tmpdir(), `radial-${nav}-`));
const logs = [];
let falhas = 0;
const confere = (ok, msg, extra = '') => { console.log(`${ok ? 'ok   ' : 'FALHA'} ${msg}${extra ? ` · ${extra}` : ''}`); if (!ok) falhas++; };

// servidor estático do dist/ em /data/engine/ (como em ezenere.com/data/engine/)
let servidor = null;
if (!url || url === 'dist') {
  const dist = path.join(RAIZ, 'dist');
  if (!fs.existsSync(path.join(dist, 'radial.html'))) { console.error('dist/radial.html não existe: rode npm run build'); process.exit(2); }
  const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
  servidor = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (!u.startsWith('/data/engine/')) { res.writeHead(404); res.end(); return; }
    const arq = path.join(dist, u.slice('/data/engine/'.length) || 'index.html');
    if (!arq.startsWith(dist) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': tipos[path.extname(arq)] || 'application/octet-stream' });
    fs.createReadStream(arq).pipe(res);
  }).listen(porta + 1, '127.0.0.1');
  url = `http://127.0.0.1:${porta + 1}/data/engine/radial.html`;
}

// ------------------------------------------------------------------ drivers (os de ronco-navegador.mjs)
async function abrirChromium() {
  const bin = process.env.CHROMIUM || '/usr/bin/chromium';
  const proc = spawn(bin, ['--headless=new', `--remote-debugging-port=${porta}`, '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${perfil}`, 'about:blank'], { stdio: 'ignore' });
  let alvo;
  for (let i = 0; i < 50 && !alvo; i++) { await espera(200); try { alvo = (await (await fetch(`http://127.0.0.1:${porta}/json`)).json()).find((t) => t.type === 'page'); } catch {} }
  const ws = new WebSocket(alvo.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(m.params.type)) logs.push(`console.${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    if (m.method === 'Runtime.exceptionThrown') logs.push(`EXCEÇÃO: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logs.push(`log.error: ${m.params.entry.text} ${m.params.entry.url || ''}`);
    if (m.method === 'Network.loadingFailed' && !m.params.canceled) logs.push(`FALHA DE REDE: ${m.params.errorText}`);
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) logs.push(`HTTP ${m.params.response.status}: ${m.params.response.url}`);
  });
  const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await cmd('Runtime.enable'); await cmd('Log.enable'); await cmd('Network.enable');
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  if (process.env.RESERVA) await cmd('Page.enable'), await cmd('Page.addScriptToEvaluateOnNewDocument', { source: `AudioWorklet.prototype.addModule = () => Promise.reject(new Error('bloqueado no teste'))` });
  return {
    ir: async (u) => { await cmd('Page.navigate', { url: u }); },
    ev: async (e) => { const r = await cmd('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result?.result?.value; },
    // botão do mouse de verdade (pointerdown/pointerup com o id do ponteiro do navegador)
    mouse: async (tipo, x, y) => { await cmd('Input.dispatchMouseEvent', { type: tipo === 'down' ? 'mousePressed' : 'mouseReleased', x, y, button: 'left', clickCount: 1 }); },
    foto: async (arq) => { const r = await cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(arq, Buffer.from(r.result.data, 'base64')); },
    fechar: () => { ws.close(); proc.kill(); },
  };
}

async function abrirFirefox() {
  const bin = process.env.FIREFOX || '/usr/bin/firefox';
  fs.writeFileSync(path.join(perfil, 'user.js'), 'user_pref("media.autoplay.default", 0);\nuser_pref("media.autoplay.blocking_policy", 0);\n');
  const proc = spawn(bin, ['--headless', '--remote-debugging-port', String(porta), '--profile', perfil, '--no-remote', '--width', '1400', '--height', '900'], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 60; i++) { await espera(300); try { ws = new WebSocket(`ws://127.0.0.1:${porta}/session`); await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; }); break; } catch { ws = null; } }
  let id = 0; const pend = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'log.entryAdded' && (m.params.level === 'error' || m.params.level === 'warn')) logs.push(`${m.params.level}: ${m.params.text}`);
  };
  const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await cmd('session.new', { capabilities: {} });
  await cmd('session.subscribe', { events: ['log.entryAdded'] });
  const ctx = (await cmd('browsingContext.getTree', {})).result.contexts[0].context;
  return {
    ir: async (u) => { await cmd('browsingContext.navigate', { context: ctx, url: u, wait: 'complete' }); },
    ev: async (e) => {
      const r = await cmd('script.evaluate', { expression: `(async () => JSON.stringify(await (${e})))()`, target: { context: ctx }, awaitPromise: true, userActivation: true });
      if (r.result?.type === 'exception') throw new Error(r.result.exceptionDetails?.text);
      const v = r.result?.result?.value;
      return v === undefined ? undefined : JSON.parse(v);
    },
    mouse: async (tipo, x, y) => {
      await cmd('input.performActions', { context: ctx, actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: tipo === 'down' ? [{ type: 'pointerMove', x: Math.round(x), y: Math.round(y) }, { type: 'pointerDown', button: 0 }] : [{ type: 'pointerUp', button: 0 }] }] });
    },
    foto: async () => {},
    fechar: () => { ws.close(); proc.kill(); },
  };
}

// ------------------------------------------------------------------ teste
const b = nav === 'firefox' ? await abrirFirefox() : await abrirChromium();
const { ev } = b;
const tecla = (code, tipo = 'keydown', extra = {}) => ev(`window.dispatchEvent(new KeyboardEvent('${tipo}', ${JSON.stringify({ code, bubbles: true, ...extra })}))`);
const clicar = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('sem ${sel.replace(/'/g, '')}'); el.click(); return true; })()`);
const chip = (grupo, texto) => ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(grupo + ' .chip')})].find((c) => c.textContent.trim().startsWith(${JSON.stringify(texto)})); if (!el) throw new Error('sem chip ${texto}'); el.click(); return true; })()`);
const texto = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);
const tele = () => ev(`(() => { const k = window.__radial; const t = k.tele; return { rpm: t.rpm, state: t.state, fase: t.fase, pas: t.pas, magnetos: t.magnetos, mistura: t.mistura, apito: t.apito, rpmHelice: t.rpmHelice, bpf: t.bpf, beta: t.beta, gear: t.gear, kmh: t.kmh, modo: k.audio?.modo, sr: k.audio?.ctx.sampleRate, estadoCtx: k.audio?.ctx.state, idade: performance.now() - (t.t || 0) }; })()`);
const rms = () => ev(`(() => { const an = window.__radial.audio?.analyser; if (!an) return -999; const x = new Float32Array(an.fftSize); an.getFloatTimeDomainData(x); let s = 0; for (const v of x) s += v * v; return 10 * Math.log10(s / x.length + 1e-20); })()`);
const deslizar = (id, v) => ev(`(() => { const r = document.getElementById(${JSON.stringify(id)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(r, String(${v})); r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); return r.closest('.field').querySelector('output').textContent; })()`);
const manete = () => ev(`(() => { const l = document.getElementById('lever'); return l ? +l.getAttribute('aria-valuenow') : null; })()`);
const thrTele = () => ev(`window.__radial.tele.thr`);
const esperaAte = async (f, ms = 8000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await f(); if (v) return v; await espera(250); } return v; };

try {
  await b.ir(url);
  await espera(2500);
  confere((await ev('document.title')) === 'Radial', 'título');
  const ini = await ev(`({ familias: document.querySelectorAll('.fam').length, presets: document.querySelectorAll('.preset').length, marcado: document.querySelector('.preset[aria-pressed=true]')?.dataset.id, placa: document.querySelector('.plate')?.textContent, secoes: [...document.querySelectorAll('.controls h2')].map((h) => h.textContent), sliders: document.querySelectorAll('.controls input[type=range]').length, ordem: document.getElementById('roOrder').textContent, botao: document.querySelector('.bar .ignition')?.textContent })`);
  confere(ini.familias === 5 && ini.presets === 7 && ini.marcado === 'r1820', 'presets: 5 famílias, 7 clássicos americanos, R-1820 marcado', JSON.stringify([ini.familias, ini.presets, ini.marcado]));
  confere(/^Radial 9 · Biela-mestra .* 29,9 L · superalimentado 0,35 bar · 1-3-5-7-9-2-4-6-8/.test(ini.placa), 'placa', ini.placa);
  const esperadas = 'Escuta e ambiente,Motor,Características,Magnetos e mistura,Partida,Hélice,Temperatura do motor,Escapamento,Superalimentador';
  confere(ini.secoes.join(',') === esperadas, 'seções do painel', ini.secoes.join(','));
  confere(ini.sliders >= 20, 'sliders no painel', String(ini.sliders));
  confere(ini.botao.includes('Girar'), 'botão de partida: Girar (arranque direto)', ini.botao);
  const lev = await ev(`({ lever: !!document.getElementById('lever'), pedal: !!document.getElementById('pedal'), marcas: [...document.querySelectorAll('#leverMarks span')].map((s) => s.textContent), posicoes: [...document.querySelectorAll('#detents button')].map((b) => b.textContent), rotulo: document.getElementById('lever')?.getAttribute('aria-label') })`);
  confere(lev.lever && !lev.pedal && lev.rotulo === 'Manete de potência', 'avião: manete de potência (a da Turbina) no lugar do pedal', JSON.stringify(lev));
  confere(lev.marcas.join(',') === 'lenta,cruzeiro,subida,deco' && lev.posicoes.join('|') === '1 · lenta|2 · cruzeiro|3 · subida|4 · decolagem', 'marcas e posições da manete', `${lev.marcas.join(',')} · ${lev.posicoes.join('|')}`);

  // partida direta: gira, conta as pás, os magnetos ligam na 9ª e pega
  await clicar('.bar .ignition');
  await espera(1500);
  let t = await tele();
  if (process.env.RESERVA) confere(t.modo === 'script', 'áudio pela reserva (ScriptProcessorNode)', `${t.modo} · ${t.sr} Hz`);
  else confere(t.modo === 'worklet', 'áudio pelo AudioWorklet (não a reserva)', `${t.modo} · ${t.sr} Hz · ${t.estadoCtx}`);
  confere(t.state === 'crank' || t.state === 'run', 'girando no arranque', `${t.state} ${Math.round(t.rpm)} rpm · ${t.pas?.toFixed(1)} pás · magnetos ${t.magnetos}`);
  t = await esperaAte(async () => { const x = await tele(); return x.state === 'run' && x.rpm > 450 ? x : null; }, 12000);
  confere(!!t, 'pegou (magnetos na 9ª pá)', t ? `${Math.round(t.rpm)} rpm · ${t.pas?.toFixed(1)} pás · ${t.magnetos}` : 'não pegou');
  await espera(2500);
  t = await tele();
  confere(t.idade < 500 && t.rpmHelice > 100 && t.bpf > 3, 'telemetria da hélice', `${Math.round(t.rpmHelice)} rpm hélice · ${t.bpf?.toFixed(1)} Hz`);
  confere(/rpm/.test(await texto('#avHel')) && /Hz/.test(await texto('#avBpf')), 'leituras da hélice no painel', `${await texto('#avHel')} · ${await texto('#avBpf')}`);
  const lenta = await rms();
  confere(lenta > -60, 'som na saída em lenta', `${lenta.toFixed(1)} dBFS`);

  // manete de potência: W segurado a leva aos poucos e, solto, ela fica onde está (não volta como o pedal)
  await tecla('KeyW');
  await espera(1000);
  await tecla('KeyW', 'keyup');
  const m1 = await manete();
  await espera(800);
  const m1b = await manete();
  confere(m1 > 20 && m1 < 90 && m1b === m1, 'W segurado avança a manete aos poucos e ela fica onde foi solta', `${m1}% → ${m1b}% depois de soltar`);
  confere(Math.abs((await thrTele()) - m1 / 100) < 0.03, 'a manete manda o acelerador ao DSP', `${(await thrTele())?.toFixed(2)} vs ${m1}%`);
  // tecla 4: decolagem (passo mínimo até o governador)
  await tecla('Digit4');
  await espera(300);
  confere((await manete()) === 100 && (await ev(`document.querySelector('#detents [data-manete="1"]').classList.contains('at')`)), 'tecla 4 → manete em decolagem (100%), posição marcada', String(await manete()));
  await espera(3500);
  t = await tele();
  const alto = await rms();
  confere(t.rpm > 1500, 'manete toda: o giro sobe', `${Math.round(t.rpm)} rpm · β ${(t.beta * 57.3).toFixed(1)}°`);
  confere(alto > lenta + 3, 'em carga soa mais alto', `${alto.toFixed(1)} vs ${lenta.toFixed(1)} dBFS`);
  // manete de passo
  await tecla('Comma'); await tecla('Comma'); await tecla('Comma');
  await espera(300);
  confere((await ev(`window.__radial.estado.av.rpmAlvo`)) < 0.9, ', baixa a manete de passo', String(await ev(`window.__radial.estado.av.rpmAlvo`)));
  // S segurado recua; PageUp com o foco na manete sobe um passo; arrasto com o ponteiro
  await tecla('KeyS');
  await espera(600);
  await tecla('KeyS', 'keyup');
  const m2 = await manete();
  confere(m2 < 100 && m2 > 50, 'S segurado recua a manete', `${m2}%`);
  await ev(`(() => { const l = document.getElementById('lever'); l.focus(); l.dispatchEvent(new KeyboardEvent('keydown', { code: 'PageUp', bubbles: true })); return true; })()`);
  await espera(200);
  confere((await manete()) === Math.min(100, m2 + 10), 'PageUp na manete: +10%', `${m2}% → ${await manete()}%`);
  const tr = await ev(`(() => { const r = document.querySelector('#lever .lever-track').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.75 }; })()`);
  await b.mouse('down', tr.x, tr.y);
  await espera(150);
  await b.mouse('up', tr.x, tr.y);
  await espera(400);
  const m3 = await manete();
  confere(m3 >= 22 && m3 <= 28, 'manete arrastada com o ponteiro a 1/4 do curso fica lá', `${m3}%`);
  await clicar('#detents [data-manete="0"]');
  await espera(2500);
  confere((await manete()) === 0, 'botão 1 · lenta leva a manete à lenta', String(await manete()));

  // magnetos (M) e mistura ([ ])
  await tecla('KeyM');
  await espera(600);
  t = await tele();
  confere(t.magnetos === 'desligado' || t.magnetos === 'esq', 'M cicla os magnetos', t.magnetos);
  await chip('#magnetos', 'AMBOS');
  await tecla('BracketLeft'); await tecla('BracketLeft');
  await espera(400);
  t = await tele();
  confere(Math.abs(t.mistura - 0.7) < 0.011, '[ empobrece a mistura', String(t.mistura));
  await tecla('BracketRight'); await tecla('BracketRight');

  // ambiente e microfone
  await clicar('#env .chip:nth-child(3)');
  await espera(500);
  confere((await ev(`window.__radial.estado.params.env`)) === 'tunnel', 'ambiente Túnel');
  await tecla('KeyC');
  await espera(300);
  confere((await ev(`window.__radial.audio.ouvinte`)) === 'int', 'C: microfone na cabine');
  await clicar('#env .chip:nth-child(1)');

  // DC-3: arranque de inércia (energizar → engatar), corte da mistura para desligar
  await clicar('.preset[data-id=r1830]');
  await espera(1200);
  confere((await texto('.bar .ignition')).includes('Energizar'), 'R-1830: botão Energizar', await texto('.bar .ignition'));
  await clicar('.bar .ignition');
  await espera(2500);
  t = await tele();
  confere(t.fase === 'energizar' && t.apito > 280 && t.apito < 400, 'energizando: o apito do volante sobe', `${t.fase} · ${Math.round(t.apito)} Hz`);
  confere((await texto('.bar .ignition')).includes('Engatar'), 'botão vira Engatar', await texto('.bar .ignition'));
  await clicar('.bar .ignition');
  t = await esperaAte(async () => { const x = await tele(); return x.state === 'run' && x.rpm > 400 ? x : null; }, 15000);
  confere(!!t, 'engatou, contou as pás e pegou', t ? `${Math.round(t.rpm)} rpm · ${t.pas?.toFixed(1)} pás` : 'não pegou');
  await deslizar('mistura', 0);
  t = await esperaAte(async () => { const x = await tele(); return x.state === 'off' ? x : null; }, 12000);
  confere(!!t, 'mistura em corte: o motor para', t ? `${t.state}` : 'não parou');

  // R-4360 (ordem decorrente) e o painel do motor
  await clicar('.preset[data-id=r4360]');
  await espera(1500);
  confere((await texto('#roOrder')).includes('decorrente'), 'R-4360: ordem decorrente (só leitura)', await texto('#roOrder'));
  confere(/^Radial 28 \(4 × 7\)/.test(await texto('.plate')), 'placa do R-4360', await texto('.plate'));

  // Sherman: câmbio
  await clicar('.fam:nth-child(4)');
  await clicar('.preset[data-id=r975]');
  await espera(1200);
  const lt = await ev(`({ lever: !!document.getElementById('lever'), pedal: !!document.getElementById('pedal') })`);
  confere(!lt.lever && lt.pedal, 'Sherman: pedal (não a manete)', JSON.stringify(lt));
  await clicar('.bar .ignition');
  t = await esperaAte(async () => { const x = await tele(); return x.state === 'run' ? x : null; }, 12000);
  confere(!!t, 'Sherman pegou', t ? `${Math.round(t.rpm)} rpm` : '');
  await tecla('KeyE');
  await espera(600);
  confere(/^1$/.test(await texto('#gearRead')), 'E engata a 1ª no tanque', await texto('#gearRead'));
  await tecla('KeyQ');
  await espera(300);
  // pedal: acelera enquanto W está apertado e volta a zero ao soltar
  await tecla('KeyW');
  await espera(400);
  const pw = await ev(`document.getElementById('pedalFill').style.height`);
  await tecla('KeyW', 'keyup');
  await espera(300);
  const ps = await ev(`document.getElementById('pedalFill').style.height`);
  confere(pw === '100%' && ps === '0%', 'Sherman: W no pedal, volta a zero ao soltar', `${pw} → ${ps}`);

  // I desliga
  await tecla('KeyI');
  await espera(1500);
  t = await tele();
  confere(t.state === 'off', 'I desliga o motor', t.state);
  if (process.env.SHOT) await b.foto(process.env.SHOT);
} catch (e) {
  confere(false, `exceção no teste: ${e.message}`);
}
confere(logs.length === 0, 'console sem erros', logs.join('\n'));
b.fechar();
servidor?.close();
await espera(500);
try { fs.rmSync(perfil, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {}
console.log(falhas ? `${falhas} falha(s)` : 'TUDO OK');
process.exit(falhas ? 1 : 0);
