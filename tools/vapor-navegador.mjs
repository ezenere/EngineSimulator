// Teste da página do Vapor num navegador headless de verdade (o padrão de tools/radial-navegador.mjs: CDP no Chromium,
// WebDriver BiDi no Firefox). Confere a estrutura (famílias, máquinas, painel, cenários, mostradores), liga o som (sonda
// de nível e portador no worklet), parado sem chuff, abre o regulador (slider e W) e vê a composição andar e soltar
// chuffs, segura H (apito soa) e solta (apito cala), toca o sino (B), troca o ambiente, roda o cenário de cruzeiro a
// 60 km/h, troca para o Big Boy (dois motores) e para a família Estacionárias (Corliss governado a 75 rpm no portador
// gerador); som na saída, worklet e console sem erros.
//
//   node tools/vapor-navegador.mjs [url da vapor.html] [chromium|firefox] [porta]
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
const porta = +(process.argv[4] || (nav === 'firefox' ? 9590 : 9470));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const perfil = fs.mkdtempSync(path.join(os.tmpdir(), `vapor-${nav}-`));
const logs = [];
let falhas = 0;
const confere = (ok, msg, extra = '') => { console.log(`${ok ? 'ok   ' : 'FALHA'} ${msg}${extra ? ` · ${extra}` : ''}`); if (!ok) falhas++; };

// servidor estático do dist/ em /data/engine/ (como em ezenere.com/data/engine/)
let servidor = null;
if (!url || url === 'dist') {
  const dist = path.join(RAIZ, 'dist');
  if (!fs.existsSync(path.join(dist, 'vapor.html'))) { console.error('dist/vapor.html não existe: rode npm run build'); process.exit(2); }
  const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
  servidor = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (!u.startsWith('/data/engine/')) { res.writeHead(404); res.end(); return; }
    const arq = path.join(dist, u.slice('/data/engine/'.length) || 'index.html');
    if (!arq.startsWith(dist) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': tipos[path.extname(arq)] || 'application/octet-stream' });
    fs.createReadStream(arq).pipe(res);
  }).listen(porta + 1, '127.0.0.1');
  url = `http://127.0.0.1:${porta + 1}/data/engine/vapor.html`;
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
const tele = () => ev(`(() => { const k = window.__vapor; const t = k.tele; const m = t?.motor; return { tem: !!t, motor: !!m, v: t ? Math.abs(t.portador.v) * 3.6 : 0, rpmEixo: t?.portador.rpmEixo ?? 0, chuffs: m?.chuffsPorS ?? 0, pCal: m?.pCaldeira ?? 0, apito: m ? m.fApito.filter((f) => f > 0).length : 0, motores: m?.motores ?? 0, spl: t?.cena.splDbA ?? -999, idade: t ? performance.now() - t.t : 1e9, modo: k.audio?.modo, estadoCtx: k.audio?.ctx.state, amb: k.audio?.ambiente, calibrando: k.estado.calibrando, cenario: k.estado.cenario, sino: k.estado.cmd.sino, preset: k.estado.presetId }; })()`);
const rms = () => ev(`(() => { const an = window.__vapor.audio?.analyser; if (!an) return -999; const x = new Float32Array(an.fftSize); an.getFloatTimeDomainData(x); let s = 0; for (const v of x) s += v * v; return 10 * Math.log10(s / x.length + 1e-20); })()`);
const deslizar = (id, v) => ev(`(() => { const r = document.getElementById(${JSON.stringify(id)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(r, String(${v})); r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); return r.closest('.field').querySelector('output').textContent; })()`);
const esperaAte = async (f, ms = 8000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await f(); if (v) return v; await espera(250); } return v; };
const r1 = (x) => Math.round(x * 10) / 10;

try {
  await b.ir(url);
  await espera(2500);
  confere((await ev('document.title')) === 'Vapor', 'título');
  const ini = await ev(`({ familias: document.querySelectorAll('.fam').length, presets: document.querySelectorAll('.preset').length, marcado: document.querySelector('.preset[aria-pressed=true]')?.dataset.id, secoes: [...document.querySelectorAll('.controls h2')].map((h) => h.textContent), sliders: document.querySelectorAll('.controls input[type=range]').length, cenarios: document.querySelectorAll('[data-cenario]').length, manometro: !!document.getElementById('manometro'), fita: !!document.getElementById('fita') })`);
  confere(ini.familias === 5 && ini.presets === 10 && ini.marcado === 'k4s', 'famílias e locomotivas nos chips', `${ini.familias} famílias, ${ini.presets} presets, ${ini.marcado}`);
  confere(ini.secoes.length >= 4 && ini.sliders >= 8 && ini.cenarios === 8 && ini.manometro && ini.fita, 'painel, cenários e mostradores', `${ini.secoes.join(' / ')} · ${ini.sliders} sliders · ${ini.cenarios} cenários`);

  // liga o som: sonda, portador e telemetria
  await clicar('#ignicao');
  let t = await esperaAte(async () => { const x = await tele(); return x.motor && x.idade < 500 && !x.calibrando ? x : null; }, 15000);
  confere(!!t, 'som ligado, motor calibrado e telemetria chegando', t ? `${t.modo}, ${t.estadoCtx}, caldeira ${r1(t.pCal)} bar` : '');
  confere(t?.modo === (process.env.RESERVA ? 'script' : 'worklet'), 'modo do áudio', t?.modo);
  confere(t && t.chuffs < 0.05 && t.v < 0.5, 'parado: sem chuff', t ? `${r1(t.chuffs)}/s, ${r1(t.v)} km/h` : '');

  // regulador (slider) e W: a composição sai andando
  await deslizar('regulador', 0.7);
  await tecla('KeyW'); await espera(300); await tecla('KeyW', 'keyup');
  t = await esperaAte(async () => { const x = await tele(); return x.chuffs > 0.5 && x.v > 1 ? x : null; }, 15000);
  confere(!!t, 'regulador aberto: anda e solta chuffs', t ? `${r1(t.v)} km/h, ${r1(t.chuffs)} chuffs/s` : JSON.stringify(await tele()));
  const nivelSom = await rms();
  confere(nivelSom > -80, 'som na saída', `${r1(nivelSom)} dBFS`);

  // apito segurável (H)
  await tecla('KeyH');
  t = await esperaAte(async () => { const x = await tele(); return x.apito > 0 ? x : null; }, 4000);
  confere(!!t, 'H segurado: o apito soa', t ? `${t.apito} tubo(s)` : '');
  await tecla('KeyH', 'keyup');
  t = await esperaAte(async () => { const x = await tele(); return x.apito === 0 ? x : null; }, 4000);
  confere(!!t, 'H solto: o apito cala');

  // sino (B)
  await tecla('KeyB'); await espera(300);
  t = await tele();
  confere(t.sino && (await ev(`document.getElementById('botaoSino').getAttribute('aria-pressed')`)) === 'true', 'B toca o sino');
  await tecla('KeyB');

  // ambiente
  await chip('#ambiente', 'Túnel'); await espera(500);
  t = await tele();
  confere(t.amb === 'tunel', 'troca o ambiente (resposta por banda)', t.amb);

  // cenário de cruzeiro a 60 km/h
  await clicar('[data-cenario=cruzeiro60]');
  t = await esperaAte(async () => { const x = await tele(); return Math.abs(x.v - 60) < 2 && x.chuffs > 5 ? x : null; }, 8000);
  confere(!!t, 'cenário cruzeiro: 60 km/h fixos', t ? `${r1(t.v)} km/h, ${r1(t.chuffs)} chuffs/s (K4s: 10,4)` : JSON.stringify(await tele()));
  await clicar('[data-cenario=cruzeiro60]');

  // articulada: Big Boy, dois motores
  await clicar('.preset[data-id=bigboy]');
  t = await esperaAte(async () => { const x = await tele(); return x.preset === 'bigboy' && !x.calibrando && x.motores === 2 && x.idade < 500 ? x : null; }, 15000);
  confere(!!t, 'Big Boy: dois motores na telemetria', t ? `${t.motores} motores` : '');

  // família estacionária: Corliss no portador gerador, governado a 75 rpm
  await ev(`(() => { const el = [...document.querySelectorAll('.fam')].find((c) => c.textContent.startsWith('Estacionárias')); el.click(); return true; })()`);
  t = await esperaAte(async () => { const x = await tele(); return x.preset === 'corliss' && !x.calibrando && Math.abs(x.rpmEixo - 75) < 6 ? x : null; }, 20000);
  confere(!!t, 'Corliss governado a 75 rpm (família Estacionárias)', t ? `${r1(t.rpmEixo)} rpm` : JSON.stringify(await tele()));

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
