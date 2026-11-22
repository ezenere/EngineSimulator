// Teste da página do Radial num navegador headless de verdade (o padrão de tools/diesel-navegador.mjs: CDP no
// Chromium, WebDriver BiDi no Firefox). Partida direta com a contagem de pás e os magnetos na 9ª, manete de potência (a
// da Turbina: fica onde foi deixada; W/S seguradas, 1–4, PageUp/PageDown, arrasto), manete de passo, magnetos (M),
// mistura ([ ]), ambiente e microfone, arranque de inércia (energizar → engatar) e corte da mistura no DC-3, ordem
// decorrente do R-4360, pedal e câmbio do Sherman; confere telemetria, som na saída, worklet e console.
//
//   node tools/radial-navegador.mjs [url da radial.html] [chromium|firefox] [porta]
//   sem url: serve o dist/ em http://127.0.0.1:<porta+1>/data/engine/ (rode npm run build antes)
//
// CHROMIUM=/caminho e FIREFOX=/caminho trocam os executáveis; MUDO=1 roda sem tocar nas caixas (o som continua sendo
// medido); SHOT=arquivo.png grava uma captura (Chromium);
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
// MUDO=1: o teste roda sem tocar nas caixas (o áudio continua rodando e sendo medido no analisador): --mute-audio no
// Chromium; no Firefox, media.volume_scale 0 (o fluxo vai em silêncio ao servidor de áudio)
const MUDO_CR = process.env.MUDO ? ['--mute-audio'] : [];
const MUDO_FF = process.env.MUDO ? 'user_pref("media.volume_scale", "0.0");\n' : '';
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
  const proc = spawn(bin, ['--headless=new', `--remote-debugging-port=${porta}`, '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check', ...MUDO_CR, `--user-data-dir=${perfil}`, 'about:blank'], { stdio: 'ignore' });
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
  fs.writeFileSync(path.join(perfil, 'user.js'), 'user_pref("media.autoplay.default", 0);\nuser_pref("media.autoplay.blocking_policy", 0);\n' + MUDO_FF);
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
const tele = () => ev(`(() => { const k = window.__radial; const t = k.tele; return { rpm: t.rpm, state: t.state, fase: t.fase, pas: t.pas, magnetos: t.magnetos, mistura: t.mistura, apito: t.apito, rpmHelice: t.rpmHelice, bpf: t.bpf, beta: t.beta, gear: t.gear, kmh: t.kmh, modo: k.audio?.modo, sr: k.audio?.ctx.sampleRate, estadoCtx: k.audio?.ctx.state, idade: performance.now() - (t.t || 0), cil: t.encharque?.length }; })()`);
const rms = () => ev(`(() => { const an = window.__radial.audio?.analyser; if (!an) return -999; const x = new Float32Array(an.fftSize); an.getFloatTimeDomainData(x); let s = 0; for (const v of x) s += v * v; return 10 * Math.log10(s / x.length + 1e-20); })()`);
const deslizar = (id, v) => ev(`(() => { const r = document.getElementById(${JSON.stringify(id)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(r, String(${v})); r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); return r.closest('.field').querySelector('output').textContent; })()`);
const manete = () => ev(`(() => { const l = document.getElementById('lever'); return l ? +l.getAttribute('aria-valuenow') : null; })()`);
const thrTele = () => ev(`window.__radial.tele.thr`);
// Esperas: em vez de dormir um tempo fixo depois de mexer num controle (com a máquina carregada a página ainda não
// respondeu), lê até a condição valer ou o limite passar e devolve a última leitura, que a conferência julga e mostra.
// `min` espera pelo menos isso antes de olhar, onde o estado de antes já satisfaria a condição ou onde a medida é de um
// estado assentado (a lenta que serve de referência). O limite é folgado: só pesa quando algo está errado.
const lerAte = async (f, ok, ms = 6000, min = 0) => { const t0 = Date.now(); if (min) await espera(min); let v; for (;;) { v = await f(); if (ok(v) || Date.now() - t0 >= ms) return v; await espera(150); } };
const esperaAte = async (f, ms = 8000) => (await lerAte(f, Boolean, ms)) || null;
const teleAte = (ok, ms = 8000, min = 0) => lerAte(tele, ok, ms, min);
const textoAte = (sel, ok, ms = 4000) => lerAte(() => texto(sel), (v) => v != null && ok(v), ms).then((v) => v ?? '');
// troca de preset: espera o motor novo chegar ao DSP (o `encharque` da telemetria tem um valor por cilindro) e estar
// parado. A configuração sai 60 ms depois do clique, calibrada na thread principal; um clique na partida antes disso é
// desfeito por ela (o motor recomeça do zero), e com a máquina carregada essa janela passava dos 1,2 s de antes.
const motorNovoNoDsp = async () => { const N = await ev(`window.__radial.estado.motor.N`); return teleAte((x) => x.cil === N && x.state === 'off', 15000); };

try {
  await b.ir(url);
  await esperaAte(() => ev(`document.readyState === 'complete' && !!window.__radial && !!document.querySelector('.preset[aria-pressed=true]')`), 15000);
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
  // (o áudio sobe, o worklet carrega e o arranque começa: com a máquina carregada isso passava de 1,5 s)
  let t = await teleAte((x) => !!x.modo && (x.state === 'crank' || x.state === 'run'), 15000);
  if (process.env.RESERVA) confere(t.modo === 'script', 'áudio pela reserva (ScriptProcessorNode)', `${t.modo} · ${t.sr} Hz`);
  else confere(t.modo === 'worklet', 'áudio pelo AudioWorklet (não a reserva)', `${t.modo} · ${t.sr} Hz · ${t.estadoCtx}`);
  confere(t.state === 'crank' || t.state === 'run', 'girando no arranque', `${t.state} ${Math.round(t.rpm)} rpm · ${t.pas?.toFixed(1)} pás · magnetos ${t.magnetos}`);
  t = await esperaAte(async () => { const x = await tele(); return x.state === 'run' && x.rpm > 450 ? x : null; }, 15000);
  confere(!!t, 'pegou (magnetos na 9ª pá)', t ? `${Math.round(t.rpm)} rpm · ${t.pas?.toFixed(1)} pás · ${t.magnetos}` : 'não pegou');
  // a lenta medida aqui é a referência do "em carga soa mais alto": os 2,5 s de antes viram o mínimo para ela assentar
  t = await teleAte((x) => x.idade < 500 && x.rpmHelice > 100 && x.bpf > 3, 12000, 2500);
  confere(t.idade < 500 && t.rpmHelice > 100 && t.bpf > 3, 'telemetria da hélice', `${Math.round(t.rpmHelice)} rpm hélice · ${t.bpf?.toFixed(1)} Hz`);
  const hel = await lerAte(async () => [await texto('#avHel'), await texto('#avBpf')], (h) => /rpm/.test(h[0]) && /Hz/.test(h[1]), 4000);
  confere(/rpm/.test(hel[0]) && /Hz/.test(hel[1]), 'leituras da hélice no painel', hel.join(' · '));
  const lenta = await rms();
  confere(lenta > -60, 'som na saída em lenta', `${lenta.toFixed(1)} dBFS`);

  // manete de potência: W segurado a leva aos poucos e, solto, ela fica onde está (não volta como o pedal). Segura até
  // ela andar (a velocidade é por quadro, e com a máquina carregada há menos quadros por segundo).
  await tecla('KeyW');
  await lerAte(manete, (v) => v > 20, 6000);
  await tecla('KeyW', 'keyup');
  const m1 = await manete();
  await espera(800); // (ela não pode se mexer depois de solta: a janela de observação é o teste)
  const m1b = await manete();
  confere(m1 > 20 && m1 < 90 && m1b === m1, 'W segurado avança a manete aos poucos e ela fica onde foi solta', `${m1}% → ${m1b}% depois de soltar`);
  const thr1 = await lerAte(thrTele, (v) => Math.abs(v - m1 / 100) < 0.03, 4000);
  confere(Math.abs(thr1 - m1 / 100) < 0.03, 'a manete manda o acelerador ao DSP', `${thr1?.toFixed(2)} vs ${m1}%`);
  // tecla 4: decolagem (passo mínimo até o governador)
  await tecla('Digit4');
  const deco = await lerAte(async () => [await manete(), await ev(`document.querySelector('#detents [data-manete="1"]').classList.contains('at')`)], (d) => d[0] === 100 && d[1], 4000);
  confere(deco[0] === 100 && deco[1], 'tecla 4 → manete em decolagem (100%), posição marcada', String(deco[0]));
  t = await teleAte((x) => x.rpm > 1500, 15000);
  const alto = await rms();
  confere(t.rpm > 1500, 'manete toda: o giro sobe', `${Math.round(t.rpm)} rpm · β ${(t.beta * 57.3).toFixed(1)}°`);
  confere(alto > lenta + 3, 'em carga soa mais alto', `${alto.toFixed(1)} vs ${lenta.toFixed(1)} dBFS`);
  // manete de passo
  await tecla('Comma'); await tecla('Comma'); await tecla('Comma');
  const passo = await lerAte(() => ev(`window.__radial.estado.av.rpmAlvo`), (v) => v < 0.9, 3000);
  confere(passo < 0.9, ', baixa a manete de passo', String(passo));
  // S segurado recua (até ela sair do fim); PageUp com o foco na manete sobe um passo; arrasto com o ponteiro
  await tecla('KeyS');
  await lerAte(manete, (v) => v < 100, 6000);
  await tecla('KeyS', 'keyup');
  const m2 = await manete();
  confere(m2 < 100 && m2 > 50, 'S segurado recua a manete', `${m2}%`);
  await ev(`(() => { const l = document.getElementById('lever'); l.focus(); l.dispatchEvent(new KeyboardEvent('keydown', { code: 'PageUp', bubbles: true })); return true; })()`);
  const m2b = await lerAte(manete, (v) => v === Math.min(100, m2 + 10), 3000);
  confere(m2b === Math.min(100, m2 + 10), 'PageUp na manete: +10%', `${m2}% → ${m2b}%`);
  const tr = await ev(`(() => { const r = document.querySelector('#lever .lever-track').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.75 }; })()`);
  await b.mouse('down', tr.x, tr.y);
  await lerAte(manete, (v) => v >= 22 && v <= 28, 3000);
  await b.mouse('up', tr.x, tr.y);
  const m3 = await lerAte(manete, (v) => v >= 22 && v <= 28, 3000);
  confere(m3 >= 22 && m3 <= 28, 'manete arrastada com o ponteiro a 1/4 do curso fica lá', `${m3}%`);
  await clicar('#detents [data-manete="0"]');
  const m0 = await lerAte(manete, (v) => v === 0, 3000);
  confere(m0 === 0, 'botão 1 · lenta leva a manete à lenta', String(m0));
  await teleAte((x) => x.rpm < 1000, 12000); // o giro volta para a lenta antes dos magnetos

  // magnetos (M) e mistura ([ ])
  await tecla('KeyM');
  t = await teleAte((x) => x.magnetos === 'desligado' || x.magnetos === 'esq', 4000);
  confere(t.magnetos === 'desligado' || t.magnetos === 'esq', 'M cicla os magnetos', t.magnetos);
  await chip('#magnetos', 'AMBOS');
  await tecla('BracketLeft'); await tecla('BracketLeft');
  t = await teleAte((x) => Math.abs(x.mistura - 0.7) < 0.011, 4000);
  confere(Math.abs(t.mistura - 0.7) < 0.011, '[ empobrece a mistura', String(t.mistura));
  await tecla('BracketRight'); await tecla('BracketRight');

  // ambiente e microfone
  await clicar('#env .chip:nth-child(3)');
  confere((await lerAte(() => ev(`window.__radial.estado.params.env`), (v) => v === 'tunnel', 3000)) === 'tunnel', 'ambiente Túnel');
  await tecla('KeyC');
  confere((await lerAte(() => ev(`window.__radial.audio.ouvinte`), (v) => v === 'int', 3000)) === 'int', 'C: microfone na cabine');
  await clicar('#env .chip:nth-child(1)');

  // DC-3: arranque de inércia (energizar → engatar), corte da mistura para desligar
  await clicar('.preset[data-id=r1830]');
  await motorNovoNoDsp();
  const bE = await textoAte('.bar .ignition', (v) => v.includes('Energizar'), 5000);
  confere(bE.includes('Energizar'), 'R-1830: botão Energizar', bE);
  await clicar('.bar .ignition');
  t = await teleAte((x) => x.fase === 'energizar' && x.apito > 280 && x.apito < 400, 12000);
  confere(t.fase === 'energizar' && t.apito > 280 && t.apito < 400, 'energizando: o apito do volante sobe', `${t.fase} · ${Math.round(t.apito)} Hz`);
  const bG = await textoAte('.bar .ignition', (v) => v.includes('Engatar'));
  confere(bG.includes('Engatar'), 'botão vira Engatar', bG);
  await clicar('.bar .ignition');
  t = await esperaAte(async () => { const x = await tele(); return x.state === 'run' && x.rpm > 400 ? x : null; }, 20000);
  confere(!!t, 'engatou, contou as pás e pegou', t ? `${Math.round(t.rpm)} rpm · ${t.pas?.toFixed(1)} pás` : 'não pegou');
  await deslizar('mistura', 0);
  t = await esperaAte(async () => { const x = await tele(); return x.state === 'off' ? x : null; }, 15000);
  confere(!!t, 'mistura em corte: o motor para', t ? `${t.state}` : 'não parou');

  // R-4360 (ordem decorrente) e o painel do motor
  await clicar('.preset[data-id=r4360]');
  const ord = await textoAte('#roOrder', (v) => v.includes('decorrente'), 5000);
  confere(ord.includes('decorrente'), 'R-4360: ordem decorrente (só leitura)', ord);
  const pl = await textoAte('.plate', (v) => /^Radial 28 \(4 × 7\)/.test(v));
  confere(/^Radial 28 \(4 × 7\)/.test(pl), 'placa do R-4360', pl);

  // Sherman: câmbio
  await clicar('.fam:nth-child(4)');
  await clicar('.preset[data-id=r975]');
  const lt = await lerAte(() => ev(`({ lever: !!document.getElementById('lever'), pedal: !!document.getElementById('pedal') })`), (v) => !v.lever && v.pedal, 5000);
  confere(!lt.lever && lt.pedal, 'Sherman: pedal (não a manete)', JSON.stringify(lt));
  await motorNovoNoDsp();
  await clicar('.bar .ignition');
  t = await esperaAte(async () => { const x = await tele(); return x.state === 'run' ? x : null; }, 15000);
  confere(!!t, 'Sherman pegou', t ? `${Math.round(t.rpm)} rpm` : '');
  await tecla('KeyE');
  const g1 = await textoAte('#gearRead', (v) => /^1$/.test(v));
  confere(/^1$/.test(g1), 'E engata a 1ª no tanque', g1);
  await tecla('KeyQ');
  await textoAte('#gearRead', (v) => v === 'N');
  // pedal: acelera enquanto W está apertado e volta a zero ao soltar
  const fill = () => ev(`document.getElementById('pedalFill').style.height`);
  await tecla('KeyW');
  const pw = await lerAte(fill, (v) => v === '100%', 3000);
  await tecla('KeyW', 'keyup');
  const ps = await lerAte(fill, (v) => v === '0%', 3000);
  confere(pw === '100%' && ps === '0%', 'Sherman: W no pedal, volta a zero ao soltar', `${pw} → ${ps}`);

  // temperatura fixa: o controle nasce da telemetria (não de um valor fixo) e manda no motor
  await chip('#tempMode', 'Fixa');
  const ct = await esperaAte(async () => { const v = await ev(`document.getElementById('coolant')?.value ?? null`); return v === null ? null : { v: +v, tele: Math.round((await ev(`window.__radial.tele.coolant`)) ?? -999) }; }, 4000);
  confere(!!ct && Math.abs(ct.v - ct.tele) <= 1, 'temperatura fixa: o controle nasce da cabeça dos cilindros', ct ? `${ct.v} °C no controle · ${ct.tele} °C na telemetria` : 'sem o controle');
  await deslizar('coolant', 60);
  const c60 = await esperaAte(async () => { const c = await ev(`window.__radial.tele.coolant`); return Math.round(c) === 60 ? c : null; }, 4000);
  confere(!!c60 && (await ev(`document.getElementById('coolant').value`)) === '60', 'temperatura fixa em 60 °C', String(await ev(`window.__radial.tele.coolant`)));
  await chip('#tempMode', 'Real');

  // I desliga
  await tecla('KeyI');
  t = await teleAte((x) => x.state === 'off', 8000);
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
