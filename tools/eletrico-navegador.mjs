// Teste da página do Elétrico num navegador headless de verdade (o padrão de tools/radial-navegador.mjs: CDP no
// Chromium, WebDriver BiDi no Firefox). Confere presets e famílias, os controles e mostradores da seção 6 do ELETRICO.md,
// liga (worklet, não a reserva), acelera o Model 3 (rpm e v sobem, espectro anotado), regeneração (corrente negativa), modo
// de modulação, AVAS, carga, ré, pneus e vento, velocidade imposta, ouvinte (cabine, cofre, gimbal), ambiente (resposta ao
// impulso nova), o do-re-mi do Taurus (escada com a nota subindo de G3), a bancada (furadeira: gatilho e carga), o drone
// pairando, o volume e o console.
//
//   node tools/eletrico-navegador.mjs [url da eletrico.html] [chromium|firefox] [porta]
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
const porta = +(process.argv[4] || (nav === 'firefox' ? 9510 : 9390));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const perfil = fs.mkdtempSync(path.join(os.tmpdir(), `eletrico-${nav}-`));
const logs = [];
let falhas = 0;
const confere = (ok, msg, extra = '') => { console.log(`${ok ? 'ok   ' : 'FALHA'} ${msg}${extra ? ` · ${extra}` : ''}`); if (!ok) falhas++; };

// servidor estático do dist/ em /data/engine/ (como em ezenere.com/data/engine/)
let servidor = null;
if (!url || url === 'dist') {
  const dist = path.join(RAIZ, 'dist');
  if (!fs.existsSync(path.join(dist, 'eletrico.html'))) { console.error('dist/eletrico.html não existe: rode npm run build'); process.exit(2); }
  const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
  servidor = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (!u.startsWith('/data/engine/')) { res.writeHead(404); res.end(); return; }
    const arq = path.join(dist, u.slice('/data/engine/'.length) || 'index.html');
    if (!arq.startsWith(dist) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': tipos[path.extname(arq)] || 'application/octet-stream' });
    fs.createReadStream(arq).pipe(res);
  }).listen(porta + 1, '127.0.0.1');
  url = `http://127.0.0.1:${porta + 1}/data/engine/eletrico.html`;
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
const K = 'window.__eletrico.c';
const tecla = (code, tipo = 'keydown') => ev(`window.dispatchEvent(new KeyboardEvent('${tipo}', ${JSON.stringify({ code, bubbles: true })}))`);
const clicar = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('sem ${sel.replace(/'/g, '')}'); el.click(); return true; })()`);
const chip = (grupo, txt) => ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(grupo + ' .chip')})].find((c) => c.textContent.trim().startsWith(${JSON.stringify(txt)})); if (!el) throw new Error('sem chip ${txt}'); el.click(); return true; })()`);
const texto = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? null`);
const tele = () => ev(`(() => { const c = ${K}, t = c.tele; if (!t) return null; const p = t.portador; return { rpm: p.rpm, v: p.v * 3.6, corrente: p.corrente, modo: p.modo, nota: p.nota, fC: p.fC, N: p.N, linhas: (p.linhas || []).length, spl: t.cena.splDbA, idade: performance.now() - t.t, audio: c.audio?.modo, sr: c.audio?.ctx.sampleRate, ctx: c.audio?.ctx.state }; })()`);
const rms = () => ev(`(() => { const an = ${K}.audio?.analyser; if (!an) return -999; const x = new Float32Array(an.fftSize); an.getFloatTimeDomainData(x); let s = 0; for (const v of x) s += v * v; return 10 * Math.log10(s / x.length + 1e-20); })()`);
const deslizar = (id, v) => ev(`(() => { const r = document.getElementById(${JSON.stringify(id)}); if (!r) throw new Error('sem slider ${id}'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(r, String(${v})); r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); return r.closest('.field').querySelector('output').textContent; })()`);
const ultima = (tipo, campo) => ev(`(() => { const e = ${K}.enviadas.filter((m) => m.type === ${JSON.stringify(tipo)}); const m = e[e.length - 1]; return m ? ${campo ? `m${campo}` : 'm'} : null; })()`);
const esperaAte = async (f, ms = 8000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await f(); if (v) return v; await espera(250); } return v; };
const preset = async (fam, id) => { await clicar(`.fam:nth-child(${fam})`); await espera(150); await clicar(`.preset[data-id=${id}]`); await espera(800); };

try {
  await b.ir(url);
  await espera(2500);
  confere((await ev('document.title')) === 'Elétrico', 'título');
  const ini = await ev(`({ familias: document.querySelectorAll('.fam').length, presets: document.querySelectorAll('.preset').length, marcado: document.querySelector('.preset[aria-pressed=true]')?.dataset.id, placa: document.querySelector('.plate')?.textContent, secoes: [...document.querySelectorAll('.controls h2')].map((h) => h.textContent.trim()) })`);
  confere(ini.familias === 6 && ini.presets === 4 && ini.marcado === 'model3', 'presets: 6 famílias, 4 carros, Model 3 marcado', JSON.stringify([ini.familias, ini.presets, ini.marcado]));
  confere(/Tesla Model 3 .* PMSRM 6 polos · Z_s 54 · SIC 10 kHz/.test(ini.placa), 'placa', ini.placa);
  confere(ini.secoes.join('|').startsWith('Comando|Carga e velocidade|Ouvinte e ambiente|Avançado'), 'seções do painel', ini.secoes.join('|'));
  const ids = ['acelerador', 'freio', 'modulacao', 'avas', 're', 'carga', 'velocidade', 'impor', 'pneus', 'ouvinte', 'ambiente', 'master', 'avancado', 'espectro', 'espectrograma', 'ro-rpm', 'ro-v', 'ro-fe', 'ro-fc', 'ro-corrente', 'ro-potencia', 'ro-mfluxo', 'ro-nivel', 'teclado'];
  const falta = await ev(`${JSON.stringify(ids)}.filter((i) => !document.getElementById(i))`);
  confere(falta.length === 0, 'controles e mostradores da seção 6 presentes', falta.join(', ') || `${ids.length} ids`);
  await clicar('#avancado');
  await espera(200);
  const av = await ev(`['avFc', 'avDelta', 'avZs', 'avZp', 'avExc'].filter((i) => !document.getElementById(i))`);
  confere(av.length === 0, 'Avançado: f_c, δ, Z_s, Z_p, excentricidade', av.join(', '));

  // liga e acelera
  await clicar('#ignicao');
  let t = await esperaAte(async () => { const x = await tele(); return x && x.idade < 500 ? x : null; }, 8000);
  if (process.env.RESERVA) confere(t?.audio === 'script', 'áudio pela reserva (ScriptProcessorNode)', `${t?.audio}`);
  else confere(t?.audio === 'worklet', 'áudio pelo AudioWorklet (não a reserva)', `${t?.audio} · ${t?.sr} Hz · ${t?.ctx}`);
  confere(await ultima('preset', '.id') === 'model3', 'preset mandado ao worklet (cfg calibrado na página)');
  await deslizar('acelerador', 1);
  await espera(3500);
  t = await tele();
  confere(t.rpm > 3000 && t.v > 40, 'acelerador: rpm e v sobem', `${Math.round(t.rpm)} rpm · ${t.v.toFixed(0)} km/h · ${t.modo} ${Math.round(t.fC)} Hz`);
  confere(/rpm/.test(await texto('#ro-rpm')) && /km\/h/.test(await texto('#ro-v')) && /Hz/.test(await texto('#ro-fe')), 'mostradores de rpm, v e f_e', `${await texto('#ro-rpm')} · ${await texto('#ro-v')} · ${await texto('#ro-fe')}`);
  const anot = +(await ev(`document.getElementById('espectro').dataset.anotadas`));
  confere(t.linhas > 0 && anot > 3, 'espectro anotado com as linhas da telemetria', `${t.linhas} linhas, ${anot} anotadas`);
  const r1 = await rms();
  confere(r1 > -70, 'som na saída', `${r1.toFixed(1)} dBFS · ${await texto('#ro-nivel')}`);
  // regeneração
  await deslizar('acelerador', 0);
  await deslizar('freio', 1);
  t = await esperaAte(async () => { const x = await tele(); return x.corrente < -0.05 ? x : null; }, 4000);
  confere(!!t, 'regeneração: corrente negativa', t ? `${(t.corrente * 100).toFixed(0)}% · ${await texto('#ro-potencia')}` : String((await tele()).corrente));
  await deslizar('freio', 0);
  // modo de modulação
  await chip('#modulacao', 'Assíncrona');
  t = await esperaAte(async () => { const x = await tele(); return x.modo === 'assincrona' ? x : null; }, 3000);
  confere(!!t, 'modo de modulação: assíncrona na telemetria', t?.modo ?? (await tele()).modo);
  await tecla('KeyM');
  await espera(300);
  confere((await ev(`${K}.modulacao`)) === 'aleatoria', 'M troca o modo', await ev(`${K}.modulacao`));
  // AVAS, carga, pneus
  await chip('#avas', 'EUA');
  confere(await ultima('eletrico', '.avas') === 'eua', 'AVAS EUA mandado');
  await chip('#carga', 'Subida 6%');
  confere(await ultima('eletrico', '.inclinacao') === 0.06, 'carga: subida 6%');
  await chip('#carga', 'Lotação');
  confere((await ultima('eletrico', '.massaExtra')) > 300, 'carga: lotação (+20% da massa)', String(await ultima('eletrico', '.massaExtra')));
  await chip('#carga', 'Plano');
  await chip('#re', 'Ré');
  confere(await ultima('eletrico', '.re') === true, 'marcha à ré mandada');
  await chip('#re', 'D');
  await chip('#pneus', 'Só o trem');
  confere(await ultima('preset', '.pneusAero') === false, 'pneus e vento desligados: o preset vai de novo');
  await chip('#pneus', 'Ligados');
  // velocidade imposta
  await deslizar('velocidade', 60);
  await chip('#impor', 'Impor');
  t = await esperaAte(async () => { const x = await tele(); return Math.abs(x.v - 60) < 1.5 ? x : null; }, 4000);
  confere(!!t, 'velocidade imposta: 60 km/h', `${(t ?? (await tele())).v.toFixed(1)} km/h`);
  await chip('#impor', 'Livre');
  // ouvinte
  await chip('#ouvinte', 'Cabine');
  confere(await ultima('cena', '.ouv.local') === 'cabine', 'ouvinte na cabine');
  await chip('#ouvinte', 'Cofre');
  confere(await ultima('cena', '.ouv.local') === 'cofre' && /^motor/.test(await ultima('cena', '.ouv.gimbal.alvo')), 'ouvinte no cofre, junto ao motor', await ultima('cena', '.ouv.gimbal.alvo'));
  await chip('#ouvinte', 'Gimbal');
  await espera(200);
  await deslizar('gAz', 30);
  confere(await ultima('cena', '.ouv.gimbal.az') === 30, 'gimbal: azimute');
  await chip('#ouvinte', 'Fora');
  // ambiente
  const conv0 = await ev(`${K}.audio.conv.buffer?.duration`);
  await chip('#ambiente', 'Túnel');
  await espera(500);
  const amb = await ev(`({ id: ${K}.audio.ambiente, d: ${K}.audio.conv.buffer?.duration, msg: ${K}.enviadas.filter((m) => m.type === 'cena').pop().amb.id })`);
  confere(amb.id === 'tunel' && amb.msg === 'tunel' && amb.d > conv0, 'ambiente túnel: resposta ao impulso nova', JSON.stringify(amb));
  await chip('#ambiente', 'Rua');
  await espera(300);
  confere((await ev(`${K}.audio.ambiente`)) === 'rua', 'ambiente rua (próprio da página)');
  // master
  await deslizar('master', 0.5);
  confere(await ultima('params', '.master') === 0.5, 'volume (master)');

  // Taurus: o do-re-mi
  await preset(2, 'taurus');
  confere((await ev(`!document.getElementById('teclado').hidden`)), 'Taurus: teclado do do-re-mi visível');
  await deslizar('acelerador', 0.8);
  const notas = [];
  let acesa = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 11000) {
    const x = await tele();
    if (x.modo === 'escada' && (!notas.length || notas[notas.length - 1] !== x.nota)) notas.push(x.nota);
    if (!acesa) acesa = await ev(`!!document.querySelector('#teclado .tecla.acesa')`);
    await espera(100);
  }
  const crescente = notas.every((n, i) => i === 0 || n > notas[i - 1]);
  confere(notas[0] === 0 && notas.length >= 8 && crescente && notas[notas.length - 1] >= 11, 'escada: as notas sobem de G3 ao patamar', notas.join(' '));
  confere(acesa, 'uma tecla acesa no teclado');
  await deslizar('acelerador', 0);

  // bancada: furadeira
  await preset(4, 'furadeira');
  confere(/Gatilho/.test(await ev(`document.getElementById('acelerador').closest('.field').textContent`)), 'bancada: o acelerador vira gatilho');
  await deslizar('acelerador', 1);
  t = await esperaAte(async () => { const x = await tele(); return x.rpm > 14000 ? x : null; }, 5000);
  confere(!!t, 'furadeira em vazio perto de 14 850 rpm', `${Math.round((t ?? (await tele())).rpm)} rpm`);
  const rpmVazio = (await tele()).rpm;
  await chip('#carga', '100%');
  await espera(1500);
  t = await tele();
  confere(t.rpm < 0.85 * rpmVazio, 'furar (carga 100%): a rotação cai', `${Math.round(rpmVazio)} → ${Math.round(t.rpm)} rpm`);
  await deslizar('acelerador', 0);

  // drone pairando
  await preset(5, 'mavic');
  await espera(2500);
  t = await tele();
  confere(Math.abs(t.rpm - 6270) < 0.06 * 6270 && (await ev(`${K}.acel`)) === 0.5, 'drone: coletivo 50% paira perto de 6270 rpm', `${Math.round(t.rpm)} rpm`);
  confere(!(await ev(`!!document.getElementById('velocidade')`)), 'drone: sem o slider de velocidade');

  // Espaço desliga
  await tecla('Space');
  await espera(300);
  confere((await ev(`${K}.ign`)) === false && /Ligar/.test(await texto('#ignicao')), 'Espaço desliga');
  if (process.env.SHOT) { await preset(1, 'model3'); await tecla('Space'); await deslizar('acelerador', 0.6); await espera(3000); await b.foto(process.env.SHOT); }
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
