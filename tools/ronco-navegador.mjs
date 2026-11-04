// Teste da página do Ronco num navegador headless de verdade (sem dependências: CDP no Chromium,
// WebDriver BiDi no Firefox). Liga o motor, acelera, troca marcha, de preset, de ambiente e de
// ouvinte, mexe em controles do painel e confere a telemetria, o som na saída e o console.
//
//   node tools/ronco-navegador.mjs <url da ronco.html> [chromium|firefox] [porta]
//   (ex.: npm run dev → http://localhost:5173/ronco.html; npm run build && npm run preview → :4173)
//
// CHROMIUM=/caminho e FIREFOX=/caminho trocam os executáveis (padrão /usr/bin/chromium, /usr/bin/firefox).
// SHOT=arquivo.png grava uma captura da página no fim (só Chromium); RESERVA=1 bloqueia o AudioWorklet
// para testar a reserva na thread principal (só Chromium). Sai com código ≠ 0 se algo falhar.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const url = process.argv[2];
const nav = process.argv[3] || 'chromium';
const porta = +(process.argv[4] || (nav === 'firefox' ? 9460 : 9340));
if (!url) { console.error('uso: node tools/ronco-navegador.mjs <url> [chromium|firefox] [porta]'); process.exit(2); }
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const perfil = fs.mkdtempSync(path.join(os.tmpdir(), `ronco-${nav}-`));
const logs = [];
let falhas = 0;
const confere = (ok, msg, extra = '') => { console.log(`${ok ? 'ok   ' : 'FALHA'} ${msg}${extra ? ` · ${extra}` : ''}`); if (!ok) falhas++; };

// ------------------------------------------------------------------ drivers
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
  // RESERVA=1: o AudioWorklet falha ao carregar e a página tem de cair no ScriptProcessorNode
  if (process.env.RESERVA) await cmd('Page.enable'), await cmd('Page.addScriptToEvaluateOnNewDocument', { source: `AudioWorklet.prototype.addModule = () => Promise.reject(new Error('bloqueado no teste'))` });
  return {
    ir: async (u) => { await cmd('Page.navigate', { url: u }); },
    ev: async (e) => { const r = await cmd('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result?.result?.value; },
    // botão do mouse de verdade (gera pointerdown/pointerup com o id do ponteiro do navegador)
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
const texto = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);
const tele = () => ev(`(() => { const k = window.__ronco; return { ...k.tele, modo: k.audio?.modo, sr: k.audio?.ctx.sampleRate, estadoCtx: k.audio?.ctx.state }; })()`);
// nível na saída (analisador depois do compressor e do EQ), em dBFS
const rms = () => ev(`(() => { const an = window.__ronco.audio?.analyser; if (!an) return -999; const x = new Float32Array(an.fftSize); an.getFloatTimeDomainData(x); let s = 0; for (const v of x) s += v * v; return 10 * Math.log10(s / x.length + 1e-20); })()`);
// valor de slider (evento input e change, como o usuário arrastando e soltando)
const deslizar = (id, v) => ev(`(() => { const r = document.getElementById(${JSON.stringify(id)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(r, String(${v})); r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); return r.closest('.field').querySelector('output').textContent; })()`);
const pressionado = (sel) => ev(`[...document.querySelectorAll(${JSON.stringify(sel + ' [aria-pressed=true]')})].map((x) => x.textContent).join('|')`);

try {
  await b.ir(url);
  await espera(2500);
  confere((await ev('document.title')) === 'Ronco', 'título');
  const ini = await ev(`({ familias: document.querySelectorAll('.fam').length, carros: document.querySelectorAll('.preset').length, marcado: document.querySelector('.preset[aria-pressed=true]')?.dataset.id, placa: document.querySelector('.plate')?.textContent, secoes: [...document.querySelectorAll('.controls h2')].map((h) => h.textContent), sliders: document.querySelectorAll('.controls input[type=range]').length, ordem: document.getElementById('roOrder').textContent, bal: document.querySelectorAll('.bal').length })`);
  confere(ini.familias === 9 && ini.carros === 9 && ini.marcado === 'muscle', 'presets: 9 famílias, 9 muscle, Camaro marcado', JSON.stringify([ini.familias, ini.carros, ini.marcado]));
  confere(ini.placa === 'V8 90° · Cross-plane · 6.2 L · aspirado · 1-8-4-3-6-5-7-2', 'placa', ini.placa);
  confere(ini.secoes.join(',') === 'Escuta e ambiente,Motor,Características,Corte de giro,Temperatura do motor,Transmissão,Escapamento,Acessórios,Estalos no escape,Admissão', 'seções do painel', ini.secoes.join(','));
  confere(ini.ordem === '1-8-4-3-6-5-7-2' && ini.bal === 4, 'leitura da ordem e balanceamento');
  confere(ini.sliders >= 25, 'sliders no painel', String(ini.sliders));

  // liga o motor
  await clicar('.bar .ignition');
  await espera(3000);
  let t = await tele();
  if (process.env.RESERVA) confere(t.modo === 'script', 'áudio pela reserva (ScriptProcessorNode)', `${t.modo} · ${t.sr} Hz · ${t.estadoCtx}`);
  else confere(t.modo === 'worklet', 'áudio pelo AudioWorklet (não a reserva)', `${t.modo} · ${t.sr} Hz · ${t.estadoCtx}`);
  confere(t.state === 'run' && t.rpm > 500 && t.rpm < 1300, 'pegou e está em marcha lenta', `${t.state} ${Math.round(t.rpm)} rpm`);
  confere((await texto('.bar .ignition')).includes('Desligar'), 'botão mostra Desligar');
  const lenta = await rms();
  confere(lenta > -60, 'som na saída em marcha lenta', `${lenta.toFixed(1)} dBFS`);
  confere(/Hz · meia-ordem/.test(await texto('#roFreq')), 'frequência de ignição na leitura', await texto('#roFreq'));

  // acelera em neutro (W segurado)
  await tecla('KeyW');
  await espera(1500);
  t = await tele();
  const pedal = await ev(`document.getElementById('pedalFill').style.height`);
  const alto = await rms();
  confere(t.rpm > 3000 && t.thr > 0.5, 'W acelera', `${Math.round(t.rpm)} rpm, borboleta ${t.thr.toFixed(2)}`);
  confere(pedal === '100%', 'pedal na tela acompanha o teclado', pedal);
  confere(alto > lenta + 3, 'acelerando soa mais alto que a lenta', `${alto.toFixed(1)} vs ${lenta.toFixed(1)} dBFS`);
  await tecla('KeyW', 'keyup');
  await espera(1500);

  // engata a 1ª (E), anda um pouco com meio pé (Shift + W), freia (S), volta ao neutro (Q)
  await tecla('KeyE');
  await espera(600);
  confere((await texto('#gearRead')) === '1', 'E engata a 1ª', await texto('#gearRead'));
  await tecla('KeyW', 'keydown', { shiftKey: true });
  await espera(2000);
  t = await tele();
  confere(t.kmh > 3 && t.thr < 0.5, 'meio pé anda devagar', `${t.kmh.toFixed(1)} km/h, borboleta ${t.thr.toFixed(2)}`);
  await tecla('KeyW', 'keyup');
  await tecla('KeyS');
  confere(await ev(`document.getElementById('brakeBtn').classList.contains('on')`), 'S acende o freio');
  await espera(1500);
  await tecla('KeyS', 'keyup');
  await tecla('KeyQ');
  await espera(500);
  confere((await texto('#gearRead')) === 'N', 'Q volta ao neutro', await texto('#gearRead'));

  // pedal na tela com o ponteiro: aperta no meio do curso, solta
  const r = await ev(`(() => { const r = document.getElementById('pedal').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await b.mouse('down', r.x, r.y);
  await espera(150);
  const meio = await ev(`document.getElementById('pedalFill').style.height`);
  await b.mouse('up', r.x, r.y);
  await espera(150);
  const solto = await ev(`document.getElementById('pedalFill').style.height`);
  confere(/^(49|50)(\.\d+)?%$/.test(meio) && solto === '0%', 'pedal com o ponteiro (meio curso, solta)', `${meio} → ${solto}`);

  // troca de carro com o motor ligado: Fusca dá a partida do zero
  await clicar('.fam:nth-child(8)');
  await clicar('.preset[data-id=fusca]');
  await espera(400);
  confere((await ev(`document.querySelector('.plate').textContent`)).startsWith('Boxer 4'), 'placa do Fusca', await texto('.plate'));
  await espera(3500);
  t = await tele();
  confere(t.state === 'run' && t.rpm > 600 && t.rpm < 1600 && t.gear === 0, 'Fusca ligou do zero (fresh) e está na lenta', `${t.state} ${Math.round(t.rpm)} rpm, marcha ${t.gear}`);
  confere(await ev(`!!document.getElementById('ring') && window.__ronco.estado.motor.N === 4`), 'ciclo de ignição com 4 cilindros');

  // ambiente: troca a acústica e manda params ao DSP
  await clicar('#env .chip:nth-child(3)');
  await espera(800);
  const amb = await ev(`({ chip: document.querySelector('#env [aria-pressed=true]').textContent, env: window.__ronco.estado.params.env, cadeia: window.__ronco.audio.ambiente, loop: window.__ronco.tele.loop })`);
  confere(amb.chip === 'Túnel' && amb.env === 'tunnel' && amb.cadeia === 'tunnel' && amb.loop === 500, 'ambiente Túnel (cadeia + DSP: volta de 500 m na telemetria)', JSON.stringify(amb));

  // ouvinte: C troca o microfone, V põe o observador na via
  await tecla('KeyC');
  await espera(300);
  confere((await pressionado('#mic')) === 'Cabine' && (await ev(`window.__ronco.audio.ouvinte`)) === 'int', 'C: microfone na cabine', await pressionado('#mic'));
  await tecla('KeyV');
  await espera(800);
  const via = await ev(`({ obs: document.querySelector('#observer [aria-pressed=true]').textContent, canvas: !!document.getElementById('passby'), nota: document.getElementById('passNote')?.textContent, ouvinte: window.__ronco.audio.ouvinte })`);
  confere(via.obs === 'Parado na via' && via.canvas && /m de você/.test(via.nota) && via.ouvinte === 'road', 'V: observador parado na via, vista de cima e nota', JSON.stringify(via));
  confere((await deslizar('roadDist', 20)) === '20 m', 'distância até a via');
  await tecla('KeyV');

  // volume arcade, mistura e equalização
  await clicar('#dynamics .chip:nth-child(2)');
  confere((await ev(`window.__ronco.estado.params.dynamics`)) === 'arcade' && !!(await ev(`[...document.querySelectorAll('.note')].some((n) => n.textContent.startsWith('Arcade:'))`)), 'volume Arcade com a nota');
  confere((await deslizar('mxVol', 1.2)) === '120%', 'volume 120%');
  confere((await deslizar('eqLo', 4.5)) === '+4,5 dB', 'EQ grave +4,5 dB');
  await ev(`[...document.querySelectorAll('.controls .chip')].find((c) => c.textContent === 'Zerar').click()`);
  await espera(100);
  confere((await ev(`document.getElementById('eqLo').closest('.field').querySelector('output').textContent`)) === '0 dB', 'Zerar a equalização');

  // motor: ordem de ignição digitada, inválida e sorteada; cilindros; ângulo do V
  const ordem = await ev(`(async () => { const i = document.getElementById('orderInput'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '1 2 4 3'); i.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 100)); const a = [document.getElementById('roOrder').textContent, document.getElementById('orderNote').textContent, i.value]; set.call(i, '1 2 2'); i.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 100)); return [...a, i.className, document.getElementById('orderNote').className]; })()`);
  confere(ordem[0] === '1-2-4-3' && ordem[2] === '1 2 4 3' && ordem[3] === 'bad' && ordem[4] === 'note warn', 'ordem digitada: válida muda o motor, inválida avisa', JSON.stringify(ordem));
  await clicar('#cyl .chip:nth-child(8)'); // 10 cilindros: o boxer não tem, vira V
  await espera(100);
  confere((await texto('.plate')).startsWith('V10 72°'), 'Cilindros: 10 → V10', await texto('.plate'));
  confere((await deslizar('bank', 90)) === '90°' && (await texto('.plate')).startsWith('V10 90°'), 'ângulo entre bancadas');
  await ev(`[...document.querySelectorAll('.controls .chip')].find((c) => c.textContent === 'Sortear').click()`);
  confere(/^1(-\d+){9}$/.test(await texto('#roOrder')), 'Sortear ordem', await texto('#roOrder'));
  confere(await ev(`document.querySelector('.preset[aria-pressed=true]') === null`), 'mexer no motor desmarca o preset');

  // transmissão: automático, modo (M), relações
  await clicar('#trans .chip:nth-child(2)');
  await tecla('KeyM');
  await espera(100);
  confere((await pressionado('#driveMode')) === 'Pista', 'M troca o modo do câmbio (Automático → Pista)', await pressionado('#driveMode'));
  confere(/ : 1 · \d+ km\/h$/.test(await deslizar('ratio1', 3.2)), 'relação da 1ª com a velocidade máxima');
  confere((await deslizar('power', 300)) === '300 kW · 408 cv', 'potência (recalibra ao soltar)');

  // acessórios: B instala a válvula e troca o modo; turbo; compressor
  await tecla('KeyB');
  await espera(300);
  const v1 = await ev(`({ chip: document.querySelector('#valve [aria-pressed=true]').textContent, tag: !document.getElementById('valveTag').hidden, txt: document.getElementById('valveTag').textContent })`);
  confere(v1.chip === 'Pista' && v1.tag, 'B instala o escape ativo aberto', JSON.stringify(v1));
  await clicar('#asp .chip:nth-child(3)');
  confere((await ev(`!!document.getElementById('scRatio')`)) && /O uivo fica em/.test(await ev(`[...document.querySelectorAll('.note')].map((n) => n.textContent).join('|')`)), 'compressor mecânico com relação, lóbulos e nota do uivo');
  await clicar('#limiter .chip:nth-child(3)');
  confere((await ev(`!document.getElementById('limiterHold') && !!document.getElementById('limiterBand')`)), 'corte parcial: só a faixa');

  // temperatura: fixa e partida a frio
  await clicar('#tempMode .chip:nth-child(2)');
  await ev(`[...document.querySelectorAll('.controls .chip')].find((c) => c.textContent.startsWith('Partida a frio')).click()`);
  await espera(1200);
  t = await tele();
  confere(Math.round(t.coolant) === 20, 'temperatura fixa em 20 °C', String(t.coolant));
  confere((await ev(`document.getElementById('coolant').value`)) === '20', 'controle da água acompanha a telemetria');
  confere(/Escape a \d+ °C/.test(await texto('#exhNote')), 'temperatura do escape na nota', await texto('#exhNote'));

  // I desliga
  await tecla('KeyI');
  await espera(1500);
  t = await tele();
  confere(t.state === 'off' && (await texto('.bar .ignition')).includes('Ligar motor'), 'I desliga o motor', t.state);
  if (process.env.SHOT) await b.foto(process.env.SHOT);
} catch (e) {
  confere(false, `exceção no teste: ${e.message}`);
}
confere(logs.length === 0, 'console sem erros', logs.join('\n'));
b.fechar();
await espera(500);
try { fs.rmSync(perfil, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {}
console.log(falhas ? `${falhas} falha(s)` : 'TUDO OK');
process.exit(falhas ? 1 : 0);
