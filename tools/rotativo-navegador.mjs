// Teste da página dos Rotativos num navegador headless de verdade (o padrão de tools/radial-navegador.mjs: CDP no
// Chromium, WebDriver BiDi no Firefox). Liga o RX-7 FD, acelera, troca marcha, ambiente e microfone, mexe nas janelas
// (periférica), nas velas (trailing), no pré-silencioso, troca de preset (787B, AE50R com o rotor, X Mini) e o motor de
// palhetas (ferramenta e arranque); confere telemetria (rpm, anel de 1 080°, câmara), som na saída, worklet (não a
// reserva) e console.
//
//   node tools/rotativo-navegador.mjs [url da rotativo.html] [chromium|firefox] [porta]
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
const porta = +(process.argv[4] || (nav === 'firefox' ? 9690 : 9570));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const perfil = fs.mkdtempSync(path.join(os.tmpdir(), `rotativo-${nav}-`));
const logs = [];
let falhas = 0;
const confere = (ok, msg, extra = '') => { console.log(`${ok ? 'ok   ' : 'FALHA'} ${msg}${extra ? ` · ${extra}` : ''}`); if (!ok) falhas++; };

// servidor estático do dist/ em /data/engine/ (como em ezenere.com/data/engine/)
let servidor = null;
if (!url || url === 'dist') {
  const dist = path.join(RAIZ, 'dist');
  if (!fs.existsSync(path.join(dist, 'rotativo.html'))) { console.error('dist/rotativo.html não existe: rode npm run build'); process.exit(2); }
  const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
  servidor = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (!u.startsWith('/data/engine/')) { res.writeHead(404); res.end(); return; }
    const arq = path.join(dist, u.slice('/data/engine/'.length) || 'index.html');
    if (!arq.startsWith(dist) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': tipos[path.extname(arq)] || 'application/octet-stream' });
    fs.createReadStream(arq).pipe(res);
  }).listen(porta + 1, '127.0.0.1');
  url = `http://127.0.0.1:${porta + 1}/data/engine/rotativo.html`;
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
const tele = () => ev(`(() => { const k = window.__rotativo; const t = k.tele; return { rpm: t.rpm, state: t.state, theta: t.theta, cyc: t.cyc, rotores: t.rotores, camara: t.camara, estouros: t.estouros, tEscape: t.tEscape, fHC: t.fHC, gear: t.gear, kmh: t.kmh, Nr: t.Nr, palhetas: t.palhetas, fPalheta: t.fPalheta, rpmHospedeiro: t.rpmHospedeiro, trailing: t.trailing, janelas: t.janelas, modo: k.audio?.modo, sr: k.audio?.ctx.sampleRate, estadoCtx: k.audio?.ctx.state, idade: performance.now() - (t.t || 0) }; })()`);
const rms = () => ev(`(() => { const an = window.__rotativo.audio?.analyser; if (!an) return -999; const x = new Float32Array(an.fftSize); an.getFloatTimeDomainData(x); let s = 0; for (const v of x) s += v * v; return 10 * Math.log10(s / x.length + 1e-20); })()`);
const esperaAte = async (f, ms = 8000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await f(); if (v) return v; await espera(250); } return v; };

try {
  await b.ir(url);
  await espera(2500);
  confere((await ev('document.title')) === 'Rotativos', 'título');
  const ini = await ev(`({ familias: document.querySelectorAll('.fam').length, presets: document.querySelectorAll('.preset').length, marcado: document.querySelector('.preset[aria-pressed=true]')?.dataset.id, placa: document.querySelector('.plate')?.textContent, secoes: [...document.querySelectorAll('.controls h2')].map((h) => h.textContent), sliders: document.querySelectorAll('.controls input[type=range]').length, anel: !!document.getElementById('anel'), pAlfa: !!document.getElementById('pAlfa') })`);
  confere(ini.familias === 6 && ini.presets === 5 && ini.marcado === 'rx7fd', 'presets: 6 famílias, 5 Mazda de rua, RX-7 FD marcado', JSON.stringify([ini.familias, ini.presets, ini.marcado]));
  confere(/^Wankel 2 rotores · 2 × 65[45] cm³ · CR 9,0 · lateral4 \/ periferico · biturbo sequencial/.test(ini.placa), 'placa', ini.placa);
  const esperadas = 'Escuta e ambiente,Motor,Características,Corte de giro,Temperatura do motor,Transmissão,Escapamento,Acessórios,Estalos no escape,Admissão';
  confere(ini.secoes.join(',') === esperadas, 'seções do painel (paridade com o Ronco: escuta, temperatura, transmissão, corte, acessórios)', ini.secoes.join(','));
  confere(ini.sliders >= 25 && ini.anel && ini.pAlfa, 'sliders, anel do ciclo e traço p–α', `${ini.sliders} sliders`);

  // liga o FD
  await clicar('.bar .ignition');
  let t = await esperaAte(async () => { const x = await tele(); return x.state === 'run' && x.rpm > 500 ? x : null; }, 10000);
  if (process.env.RESERVA) confere(t?.modo === 'script', 'áudio pela reserva (ScriptProcessorNode)', `${t?.modo}`);
  else confere(t?.modo === 'worklet', 'áudio pelo AudioWorklet (não a reserva)', `${t?.modo} · ${t?.sr} Hz · ${t?.estadoCtx}`);
  confere(!!t, 'pegou', t ? `${Math.round(t.rpm)} rpm` : 'não pegou');
  await espera(1500);
  t = await tele();
  confere(t.cyc === 1080 && t.rotores === 2 && t.camara && t.camara.a >= 0 && t.camara.a < 1080, 'telemetria do rotativo: ciclo de 1 080°, 2 rotores, câmara', JSON.stringify({ cyc: t.cyc, rotores: t.rotores, a: Math.round(t.camara?.a) }));
  confere(t.idade < 500 && t.theta >= 0 && t.theta < 1080, 'eixo no anel de 1 080°', `θ ${Math.round(t.theta)}°`);
  confere(/Hz/.test(await texto('#roFreqRot')) && /°C/.test(await texto('#roGas')), 'leituras (ignição, gás de escape)', `${await texto('#roFreqRot')} · ${await texto('#roGas')}`);
  const lenta = await rms();
  confere(lenta > -60, 'som na saída em lenta', `${lenta.toFixed(1)} dBFS`);

  // acelera (a medida fica antes do corte de giro: em ponto morto o FD chega ao corte em ~1 s)
  await tecla('KeyW');
  await espera(500);
  t = await tele();
  const alto = await rms();
  confere(t.rpm > 2500, 'W: acelera', `${Math.round(t.rpm)} rpm`);
  confere(alto > lenta + 3, 'em carga soa mais alto', `${alto.toFixed(1)} vs ${lenta.toFixed(1)} dBFS`);
  await tecla('KeyW', 'keyup');
  await espera(1500);
  // câmbio
  await tecla('KeyE');
  await espera(500);
  confere(/^1$/.test(await texto('#gearRead')), 'E engata a 1ª', await texto('#gearRead'));
  await tecla('KeyQ');
  // ambiente e microfone
  await clicar('#env .chip:nth-child(3)');
  await espera(400);
  confere((await ev(`window.__rotativo.estado.params.env`)) === 'tunnel', 'ambiente Túnel');
  await tecla('KeyC');
  await espera(300);
  confere((await ev(`window.__rotativo.audio.ouvinte`)) === 'int', 'C: microfone na cabine');
  await clicar('#env .chip:nth-child(1)');
  await tecla('KeyC'); await tecla('KeyC'); await tecla('KeyC');
  // janelas, velas, pré-silencioso
  await chip('#admissao', 'Periférica');
  await espera(1200);
  confere((await ev(`window.__rotativo.estado.spec.janelas.admissao`)) === 'periferica', 'janela de admissão periférica');
  await chip('#trailing', 'Desligadas');
  await espera(800);
  t = await tele();
  confere(t.trailing === false, 'velas trailing desligadas (telemetria)', String(t.trailing));
  await chip('#presilencioso', 'Retirado');
  await espera(1500);
  t = await tele();
  confere(t.state === 'run', 'pré-silencioso retirado com o motor funcionando', `${t.state} ${Math.round(t.rpm)} rpm`);

  // 787B
  await clicar('.fam:nth-child(2)');
  await clicar('.preset[data-id=r26b]');
  await espera(2500);
  t = await esperaAte(async () => { const x = await tele(); return x.rotores === 4 ? x : null; }, 8000);
  confere(t?.rotores === 4, '787B: 4 rotores', JSON.stringify(t?.janelas));
  confere(/^Wankel 4 rotores/.test(await texto('.plate')), 'placa do 787B', await texto('.plate'));
  // AE50R com o rotor
  await clicar('.fam:nth-child(4)');
  await clicar('.preset[data-id=ae50r]');
  await espera(2000);
  const sec = await ev(`[...document.querySelectorAll('.controls h2')].map((h) => h.textContent).join(',')`);
  confere(sec.includes('Rotor') && !sec.includes('Transmissão'), 'AE50R: seção do rotor, sem transmissão', sec);
  // X Mini
  await clicar('.fam:nth-child(5)');
  await clicar('.preset[data-id=xmini]');
  await espera(2500);
  t = await tele();
  confere(t.cyc === 720, 'X Mini: ciclo de 720°', String(t.cyc));
  confere(/aproximação/i.test(await ev(`document.querySelector('.controls').textContent`)), 'etiqueta "aproximação" no painel');

  // palhetas: ferramenta
  await clicar('.fam:nth-child(6)');
  await clicar('.preset[data-id=palhetas]');
  await espera(1200);
  if (await ev(`window.__rotativo.estado.ignicao`)) { await clicar('.bar .ignition'); await espera(400); }
  await clicar('.bar .ignition');
  await tecla('KeyW');
  t = await esperaAte(async () => { const x = await tele(); return x.palhetas && x.rpm > 15000 ? x : null; }, 6000);
  confere(!!t, 'palhetas: o gatilho leva à rotação livre', t ? `${Math.round(t.rpm)} rpm · ${Math.round(t.fPalheta)} Hz` : JSON.stringify(await tele()));
  const pal = await rms();
  confere(pal > -50, 'som das palhetas', `${pal.toFixed(1)} dBFS`);
  for (let i = 0; i < 5; i++) await tecla('BracketRight');
  await espera(1200);
  const t2 = await tele();
  confere(t2.rpm < 0.85 * (t?.rpm || 1), '] carrega a ferramenta: a rotação cai', `${Math.round(t2.rpm)} rpm`);
  await tecla('KeyW', 'keyup');
  // arranque a ar
  await chip('#modoPal', 'Motor de arranque');
  await espera(800);
  await clicar('.bar .ignition');
  t = await esperaAte(async () => { const x = await tele(); return x.rpmHospedeiro > 200 ? x : null; }, 6000);
  confere(!!t, 'arranque a ar: o hospedeiro gira', t ? `${Math.round(t.rpmHospedeiro)} rpm` : '');
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
