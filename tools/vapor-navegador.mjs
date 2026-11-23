// Teste da página do Vapor num navegador headless de verdade (o padrão de tools/radial-navegador.mjs: CDP no Chromium,
// WebDriver BiDi no Firefox), dirigindo pela TELA como o dono dirige: o mouse (e, no Chromium, o dedo) de verdade na
// alavanca do regulador e nos botões de segurar, sem chamar o controle por dentro. Confere:
//   - a estrutura (famílias, máquinas, o bloco de condução, as demonstrações, os mostradores, o painel);
//   - a linha de estado antes de ligar, ao ligar ("Pronta para partir") e em marcha;
//   - ligar e abrir o regulador pela tela põe a máquina em marcha em poucos segundos em CADA preset que se dirige (as 10
//     locomotivas, o trator, o Stanley e o barco); a estacionária fica no governador a 75 rpm e não tem alavanca;
//   - o corte automático: longo parado, curto a 60 km/h;
//   - a demonstração "Cruzeiro a 60": mexer no regulador a cancela e solta a velocidade; deixada até o fim, devolve a
//     máquina com a velocidade livre (fechar o regulador faz perder velocidade) e o freio de segurar a para;
//   - o apito pelo botão: soa enquanto seguro e volta a zero ao soltar, ao sair de cima, ao perder o foco e (Chromium) ao
//     escorregar o dedo; H segurada e solta; a demonstração "Toque de apito" termina com o apito em zero e, cancelada
//     no meio de um toque pelo regulador, cala na hora;
//   - sino, ambiente, o Big Boy com dois motores, som na saída, onda e espectro, console sem erros.
//
//   node tools/vapor-navegador.mjs [url da vapor.html] [chromium|firefox] [porta]
//   sem url: serve o dist/ em http://127.0.0.1:<porta+1>/data/engine/ (rode npm run build antes)
//
// CHROMIUM=/caminho e FIREFOX=/caminho trocam os executáveis; MUDO=1 roda sem tocar nas caixas (o som continua sendo
// medido; rode sempre assim com alguém ouvindo outra coisa); SHOT=arquivo.png grava uma captura (Chromium);
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
// MUDO=1: o teste roda sem tocar nas caixas (o áudio continua rodando e sendo medido no analisador): --mute-audio no
// Chromium; no Firefox, media.volume_scale 0 (o fluxo vai em silêncio ao servidor de áudio)
const MUDO_CR = process.env.MUDO ? ['--mute-audio'] : [];
const MUDO_FF = process.env.MUDO ? 'user_pref("media.volume_scale", "0.0");\n' : '';
const perfil = fs.mkdtempSync(path.join(os.tmpdir(), `vapor-${nav}-`));
const logs = [];
let falhas = 0, total = 0;
const confere = (ok, msg, extra = '') => { total++; console.log(`${ok ? 'ok   ' : 'FALHA'} ${msg}${extra ? ` · ${extra}` : ''}`); if (!ok) falhas++; };

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

// ------------------------------------------------------------------ drivers (os de ronco-navegador.mjs, com entrada de verdade)
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
  // (o toque emulado junto com o mouse: o teste do dedo que escorrega usa Input.dispatchTouchEvent)
  await cmd('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
  if (process.env.RESERVA) await cmd('Page.enable'), await cmd('Page.addScriptToEvaluateOnNewDocument', { source: `AudioWorklet.prototype.addModule = () => Promise.reject(new Error('bloqueado no teste'))` });
  const mouse = (type, x, y) => cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'mouse' });
  return {
    ir: async (u) => { await cmd('Page.navigate', { url: u }); },
    ev: async (e) => { const r = await cmd('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text); return r.result?.result?.value; },
    foto: async (arq) => { const r = await cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(arq, Buffer.from(r.result.data, 'base64')); },
    // o botão do mouse: aperta e solta num ponto, ou move com ele apertado
    apertar: (x, y) => cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, pointerType: 'mouse' }).then(() => mouse('mousePressed', x, y)),
    mover: (x, y) => cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1, pointerType: 'mouse' }),
    soltar: (x, y) => mouse('mouseReleased', x, y),
    // o dedo
    tocar: (x, y) => cmd('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] }),
    arrastarDedo: (x, y) => cmd('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] }),
    levantar: () => cmd('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
    temToque: true,
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
  const acoes = (lista) => cmd('input.performActions', { context: ctx, actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: lista }] });
  const xy = (x, y) => ({ x: Math.round(x), y: Math.round(y) });
  return {
    ir: async (u) => { await cmd('browsingContext.navigate', { context: ctx, url: u, wait: 'complete' }); },
    ev: async (e) => {
      const r = await cmd('script.evaluate', { expression: `(async () => JSON.stringify(await (${e})))()`, target: { context: ctx }, awaitPromise: true, userActivation: true });
      if (r.result?.type === 'exception') throw new Error(r.result.exceptionDetails?.text);
      const v = r.result?.result?.value;
      return v === undefined ? undefined : JSON.parse(v);
    },
    foto: async () => {},
    apertar: (x, y) => acoes([{ type: 'pointerMove', ...xy(x, y) }, { type: 'pointerDown', button: 0 }]),
    mover: (x, y) => acoes([{ type: 'pointerMove', ...xy(x, y) }]),
    soltar: (x, y) => acoes([{ type: 'pointerMove', ...xy(x, y) }, { type: 'pointerUp', button: 0 }]),
    temToque: false,
    fechar: () => { ws.close(); proc.kill(); },
  };
}


// ------------------------------------------------------------------ teste
const b = nav === 'firefox' ? await abrirFirefox() : await abrirChromium();
const { ev } = b;
const tecla = (code, tipo = 'keydown', extra = {}) => ev(`window.dispatchEvent(new KeyboardEvent('${tipo}', ${JSON.stringify({ code, bubbles: true, ...extra })}))`);
const clicar = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('sem ${sel.replace(/'/g, '')}'); el.click(); return true; })()`);
const chip = (grupo, texto) => ev(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(grupo + ' .chip')})].find((c) => c.textContent.trim().startsWith(${JSON.stringify(texto)})); if (!el) throw new Error('sem chip ${texto}'); el.click(); return true; })()`);
const tele = () => ev(`(() => { const k = window.__vapor; const t = k.tele; const m = t?.motor; return { tem: !!t, motor: !!m, v: t ? t.portador.v * 3.6 : 0, rpmEixo: t?.portador.rpmEixo ?? 0, chuffs: m?.chuffsPorS ?? 0, pCal: m?.pCaldeira ?? 0, apito: m ? m.fApito.filter((f) => f > 0).length : 0, motores: m?.motores ?? 0, spl: t?.cena.splDbA ?? -999, idade: t ? performance.now() - t.t : 1e9, modo: k.audio?.modo, estadoCtx: k.audio?.ctx.state, amb: k.audio?.ambiente, calibrando: k.estado.calibrando, cenario: k.estado.cenario, sino: k.estado.cmd.sino, preset: k.estado.presetId, regulador: k.estado.cmd.regulador, rev: k.reversaoEfetiva(), corteAuto: k.estado.corteAuto, apitando: k.estado.apitando, freando: k.estado.freando, vFixa: k.vFixa, estado: document.getElementById('estadoTitulo')?.textContent ?? '' }; })()`);
const rms = () => ev(`(() => { const an = window.__vapor.audio?.analyser; if (!an) return -999; const x = new Float32Array(an.fftSize); an.getFloatTimeDomainData(x); let s = 0; for (const v of x) s += v * v; return 10 * Math.log10(s / x.length + 1e-20); })()`);
const esperaAte = async (f, ms = 8000) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await f(); if (v) return v; await espera(200); } return v; };
// lê até a condição valer ou o limite passar e devolve a última leitura (no lugar de dormir um tempo fixo depois de mexer
// num controle: com a máquina carregada a página ainda não respondeu)
const lerAte = async (f, ok, ms = 6000) => { const t0 = Date.now(); let v; for (;;) { v = await f(); if (ok(v) || Date.now() - t0 >= ms) return v; await espera(150); } };
const r1 = (x) => Math.round(x * 10) / 10;
const corteTxt = (rev) => `${Math.round((0.15 + 0.7 * Math.min(1, Math.abs(rev))) * 100)}%`;
/** retângulo de um elemento na janela */
const caixa = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
const centro = async (sel) => { const r = await caixa(sel); if (!r) throw new Error(`sem ${sel}`); return [r.x + r.w / 2, r.y + r.h / 2]; };
/** arrasta a alavanca do regulador até a fração `f` com o mouse: aperta no meio do trilho e leva até a altura de `f` */
const regulador = async (f) => {
  const r = await caixa('#alavancaRegulador .alavanca-trilho');
  if (!r) throw new Error('sem a alavanca do regulador');
  const x = r.x + r.w / 2;
  await b.apertar(x, r.y + r.h / 2); await b.mover(x, r.y + r.h * (1 - f)); await b.soltar(x, r.y + r.h * (1 - f));
};
/** aperta um botão de segurar com o mouse (devolve o centro) e o solta */
const segurar = async (sel) => { const [x, y] = await centro(sel); await b.apertar(x, y); return [x, y]; };
const largar = (x, y) => b.soltar(x, y);
const preset = async (id) => {
  await clicar(`.preset[data-id=${id}]`);
  return esperaAte(async () => { const x = await tele(); return x.preset === id && !x.calibrando && x.motor && x.idade < 500 ? x : null; }, 25000);
};
const apitoEm = (n) => lerAte(tele, (x) => (n ? x.apito > 0 : x.apito === 0), 4000);

try {
  await b.ir(url);
  await esperaAte(() => ev(`document.readyState === 'complete' && !!window.__vapor && !!document.querySelector('.preset[aria-pressed=true]')`), 15000);
  confere((await ev('document.title')) === 'Vapor', 'título');
  const ini = await ev(`({ familias: document.querySelectorAll('.fam').length, presets: document.querySelectorAll('.preset').length, marcado: document.querySelector('.preset[aria-pressed=true]')?.dataset.id, secoes: [...document.querySelectorAll('.controls h2')].map((h) => h.textContent), sliders: document.querySelectorAll('.controls input[type=range]').length, demos: document.querySelectorAll('[data-cenario]').length, alavanca: !!document.getElementById('alavancaRegulador'), sentidos: document.querySelectorAll('[data-sentido]').length, auto: document.getElementById('corteAuto')?.getAttribute('aria-checked'), apito: !!document.getElementById('botaoApito'), freio: !!document.getElementById('botaoFreio'), manometro: !!document.getElementById('manometro'), fita: !!document.getElementById('fita'), estado: document.getElementById('estadoTitulo')?.textContent, ordem: [...document.querySelector('.palco').children].map((c) => c.className.split(' ')[0]) })`);
  confere(ini.familias === 5 && ini.presets === 10 && ini.marcado === 'k4s', 'famílias e locomotivas nos chips', `${ini.familias} famílias, ${ini.presets} presets, ${ini.marcado}`);
  confere(ini.alavanca && ini.sentidos === 3 && ini.auto === 'true' && ini.apito && ini.freio && ini.ordem[0] === 'conducao', 'condução no palco, em primeiro: alavanca do regulador, sentido, corte automático ligado, apito e freio', ini.ordem.join(' / '));
  confere(ini.secoes.length >= 4 && ini.sliders >= 8 && ini.demos === 8 && ini.manometro && ini.fita, 'painel, demonstrações e mostradores', `${ini.secoes.join(' / ')} · ${ini.sliders} sliders · ${ini.demos} demonstrações`);
  confere(ini.estado === 'Desligada', 'linha de estado antes de ligar', ini.estado);

  // liga o som: sonda, portador e telemetria; a máquina pronta para partir
  await clicar('#ignicao');
  let t = await esperaAte(async () => { const x = await tele(); return x.motor && x.idade < 500 && !x.calibrando ? x : null; }, 25000);
  confere(!!t, 'som ligado, motor calibrado e telemetria chegando', t ? `${t.modo}, ${t.estadoCtx}, caldeira ${r1(t.pCal)} bar` : '');
  confere(t?.modo === (process.env.RESERVA ? 'script' : 'worklet'), 'modo do áudio', t?.modo);
  t = await lerAte(tele, (x) => x.estado.startsWith('Pronta para partir'), 3000);
  confere(t.chuffs < 0.05 && Math.abs(t.v) < 0.5 && t.regulador === 0 && t.corteAuto && t.rev > 0.8 && t.estado.startsWith('Pronta para partir'), 'ao ligar: parada, regulador fechado, reversão à frente no automático, "Pronta para partir"', `${t.estado} · corte ${corteTxt(t.rev)}`);
  const revParada = t.rev;

  // abre o regulador pela tela (o mouse na alavanca): sai andando em poucos segundos
  const t0 = Date.now();
  await regulador(0.6);
  t = await lerAte(tele, (x) => x.regulador > 0.5, 2000);
  confere(Math.abs(t.regulador - 0.6) < 0.06, 'a alavanca vai aonde o mouse a leva e fica', `regulador ${Math.round(t.regulador * 100)}%`);
  t = await esperaAte(async () => { const x = await tele(); return x.chuffs > 0.3 && x.v > 1 ? x : null; }, 10000);
  confere(!!t, 'regulador aberto pela tela: anda e solta chuffs em poucos segundos', t ? `${r1(t.v)} km/h, ${r1(t.chuffs)} chuffs/s em ${r1((Date.now() - t0) / 1000)} s` : JSON.stringify(await tele()));
  t = await lerAte(tele, (x) => x.estado.startsWith('Em marcha') || x.estado.startsWith('Patinando'), 4000);
  confere(t.estado.startsWith('Em marcha') || t.estado.startsWith('Patinando'), 'linha de estado em marcha', t.estado);
  const nivelSom = await rms();
  confere(nivelSom > -80, 'som na saída', `${r1(nivelSom)} dBFS`);
  // onda e espectro (o instrumento comum, src/ui/onda.ts): o canvas desenha a janela do analisador
  const onda = await lerAte(() => ev(`document.getElementById('scope')?.dataset.rms ?? null`), (v) => v != null && +v > -90, 4000);
  confere(onda != null && +onda > -90, 'onda e espectro desenhando', `${onda} dBFS na janela da onda`);
  // W segurada move a mesma alavanca, e ela fica onde parou
  const antes = (await tele()).regulador;
  await tecla('KeyW'); await espera(250); await tecla('KeyW', 'keyup');
  await espera(300);
  const depoisW = (await tele()).regulador;
  confere(depoisW > antes + 0.1 && depoisW < 1, 'W move a alavanca e ela fica onde parou', `${Math.round(antes * 100)}% → ${Math.round(depoisW * 100)}%`);

  // apito pelo botão da tela: segura, soa; solta, cala
  let [ax, ay] = await segurar('#botaoApito');
  t = await apitoEm(true);
  confere(t.apito > 0 && t.apitando, 'apito seguro pelo botão: soa', `${t.apito} tubo(s)`);
  await largar(ax, ay);
  t = await apitoEm(false);
  confere(t.apito === 0 && !t.apitando, 'apito solto: volta a zero');
  // seguro e o ponteiro sai de cima do botão (sem soltar)
  [ax, ay] = await segurar('#botaoApito');
  await apitoEm(true);
  const fora = await caixa('#manometro');
  await b.mover(fora.x + fora.w / 2, fora.y + fora.h / 2);
  t = await apitoEm(false);
  confere(t.apito === 0 && !t.apitando, 'apito: o ponteiro sai de cima do botão e ele cala');
  await b.soltar(fora.x + fora.w / 2, fora.y + fora.h / 2);
  // seguro e a janela perde o foco
  [ax, ay] = await segurar('#botaoApito');
  await apitoEm(true);
  await ev(`window.dispatchEvent(new Event('blur'))`);
  t = await apitoEm(false);
  confere(t.apito === 0 && !t.apitando, 'apito: a janela perde o foco e ele cala');
  await largar(ax, ay);
  if (b.temToque) {
    // o dedo aperta e escorrega para fora do botão
    [ax, ay] = await centro('#botaoApito');
    await b.tocar(ax, ay);
    const toque = await apitoEm(true);
    await b.arrastarDedo(fora.x + fora.w / 2, fora.y + fora.h / 2);
    t = await apitoEm(false);
    confere(toque.apito > 0 && t.apito === 0 && !t.apitando, 'apito no toque: soa com o dedo em cima e cala quando ele escorrega para fora');
    await b.levantar();
  }
  // H segurada e solta
  await tecla('KeyH');
  t = await apitoEm(true);
  confere(t.apito > 0, 'H segurada: o apito soa', `${t.apito} tubo(s)`);
  await tecla('KeyH', 'keyup');
  t = await apitoEm(false);
  confere(t.apito === 0, 'H solta: o apito cala');

  // sino (B)
  await tecla('KeyB');
  const sino = await lerAte(async () => [(await tele()).sino, await ev(`document.getElementById('botaoSino').getAttribute('aria-pressed')`)], (x) => x[0] && x[1] === 'true', 4000);
  confere(sino[0] && sino[1] === 'true', 'B toca o sino (e o botão acende)');
  await tecla('KeyB');

  // ambiente
  await chip('#ambiente', 'Túnel');
  t = await lerAte(tele, (x) => x.amb === 'tunel', 4000);
  confere(t.amb === 'tunel', 'troca o ambiente (resposta por banda)', t.amb);
  await chip('#ambiente', 'Céu aberto');

  // demonstração "Cruzeiro a 60": mexer no regulador a cancela e solta a velocidade
  await clicar('[data-cenario=cruzeiro60]');
  t = await esperaAte(async () => { const x = await tele(); return Math.abs(x.v - 60) < 2 && x.chuffs > 5 ? x : null; }, 15000);
  confere(!!t && t.cenario === 'cruzeiro60' && t.estado.startsWith('Demonstração'), 'demonstração cruzeiro: 60 km/h fixos, e a linha de estado diz que é demonstração', t ? `${r1(t.v)} km/h, ${r1(t.chuffs)} chuffs/s · ${t.estado}` : JSON.stringify(await tele()));
  await regulador(0.5);
  // (o estado muda na hora; a linha de estado, no requestAnimationFrame, que o Firefox sem cabeça às vezes passa segundos sem rodar)
  t = await lerAte(tele, (x) => x.cenario === null && !x.estado.startsWith('Demonstração'), 10000);
  confere(t.cenario === null && t.vFixa === null && !t.estado.startsWith('Demonstração'), 'mexer no regulador cancela a demonstração e solta a velocidade', `${t.estado}`);
  // de novo, e agora até o fim (o relógio da demonstração é adiantado: o fim é o mesmo caminho do fim natural)
  await clicar('[data-cenario=cruzeiro60]');
  await esperaAte(async () => { const x = await tele(); return Math.abs(x.v - 60) < 2 && x.cenario === 'cruzeiro60' ? x : null; }, 15000);
  await ev(`window.__vapor.fimDemo = performance.now()`);
  t = await lerAte(tele, (x) => x.cenario === null, 3000);
  confere(t.cenario === null && t.vFixa === null, 'a demonstração acaba e devolve a máquina (sem velocidade fixa)', `${r1(t.v)} km/h · ${t.estado}`);
  t = await lerAte(tele, (x) => x.rev < 0.4, 4000);
  confere(t.corteAuto && t.rev < 0.4 && revParada > 0.8 && t.rev < revParada - 0.3, "o corte automático encurta com a velocidade", `parada ${corteTxt(revParada)} → ${corteTxt(t.rev)} a ${r1(t.v)} km/h`);
  // fechar o regulador: a máquina perde velocidade (antes a velocidade ficava presa)
  await clicar('#fecharRegulador');
  const v0 = (await tele()).v;
  t = await lerAte(tele, (x) => x.v < v0 - 0.3, 8000);
  confere(t.v < v0 - 0.3 && t.regulador === 0, 'depois da demonstração a velocidade é livre: regulador fechado, perde velocidade', `${r1(v0)} → ${r1(t.v)} km/h · ${t.estado}`);
  // o freio de segurar (botão da tela) para a máquina
  const [fx, fy] = await segurar('#botaoFreio');
  t = await lerAte(tele, (x) => x.freando && x.estado.startsWith('Freando'), 3000);
  confere(t.freando && t.estado.startsWith('Freando'), 'freio seguro pelo botão: "Freando"', t.estado);
  t = await lerAte(tele, (x) => Math.abs(x.v) < 0.5, 40000);
  confere(Math.abs(t.v) < 0.5, 'o freio para a máquina', `${r1(t.v)} km/h · ${t.estado}`);
  await largar(fx, fy);
  t = await lerAte(tele, (x) => !x.freando, 3000);
  confere(!t.freando, 'freio solto ao soltar o botão');

  // demonstração "Toque de apito": termina com o apito em zero; cancelada no meio de um toque pelo regulador, cala na hora
  await clicar('[data-cenario=apito]');
  t = await apitoEm(true);
  confere(t.apito > 0 && t.cenario === 'apito', 'demonstração do apito: soa', `${t.apito} tubo(s)`);
  t = await lerAte(tele, (x) => x.cenario === null, 15000);
  const fim = await apitoEm(false);
  confere(t.cenario === null && fim.apito === 0 && !fim.apitando, 'a demonstração do apito termina com o apito em zero');
  await clicar('[data-cenario=apito]');
  await apitoEm(true);
  await regulador(0.3);
  t = await apitoEm(false);
  confere(t.apito === 0 && !t.apitando && t.cenario === null, 'demonstração do apito cancelada no meio do toque pelo regulador: cala na hora');
  await clicar('#fecharRegulador');

  // cada preset que se dirige: ligar e abrir o regulador pela tela põe a máquina em marcha em poucos segundos
  const familias = ['Locomotivas', 'Trator', 'Carro', 'Barco'];
  const lentos = [];
  for (const fam of familias) {
    await ev(`(() => { const el = [...document.querySelectorAll('.fam')].find((c) => c.textContent.startsWith(${JSON.stringify(fam)})); el.click(); return true; })()`);
    await espera(200);
    const ids = await ev(`[...document.querySelectorAll('.preset')].map((p) => p.dataset.id)`);
    for (const id of ids) {
      const p = await preset(id);
      if (!p) { confere(false, `${id}: calibrou e a telemetria chegou`); continue; }
      // (a anterior estava andando: a nova nasce parada, pronta para partir)
      const pronta = await lerAte(tele, (x) => x.estado.startsWith('Pronta para partir') && Math.abs(x.v) < 0.3, 4000);
      const t1 = Date.now();
      await regulador(0.6);
      // em movimento (o barco de 400 t sai devagar: 0,5 km/h basta) e, logo depois, o escape batendo
      const x = await esperaAte(async () => { const y = await tele(); return y.v > 0.5 ? y : null; }, 10000);
      const s = (Date.now() - t1) / 1000;
      const bate = await lerAte(tele, (y) => y.chuffs > 0.05, 6000);
      confere(!!x && bate.chuffs > 0.05 && pronta.estado.startsWith('Pronta para partir') && Math.abs(pronta.v) < 0.3, `${id}: nasce parada e pronta, e o regulador pela tela a põe em marcha`, x ? `${r1(x.v)} km/h em ${r1(s)} s, ${r1(bate.chuffs)} escapes/s · ${bate.estado}` : `${pronta.estado} · ${JSON.stringify(await tele())}`);
      if (x && s > 6) lentos.push(id);
      if (id === 'bigboy') confere(x?.motores === 2, 'Big Boy: dois motores na telemetria', `${x?.motores} motores`);
    }
  }
  confere(!lentos.length, 'todas saem em até 6 s', lentos.join(', '));

  // família estacionária: Corliss no portador gerador, governado a 75 rpm, sem alavanca (a carga no lugar)
  await ev(`(() => { const el = [...document.querySelectorAll('.fam')].find((c) => c.textContent.startsWith('Estacionárias')); el.click(); return true; })()`);
  t = await esperaAte(async () => { const x = await tele(); return x.preset === 'corliss' && !x.calibrando && Math.abs(x.rpmEixo - 75) < 6 ? x : null; }, 30000);
  const est = await ev(`({ alavanca: !!document.getElementById('alavancaRegulador'), carga: document.querySelectorAll('#carga .chip').length })`);
  confere(!!t && !est.alavanca && est.carga === 5, 'Corliss governado a 75 rpm (família Estacionárias), com a carga do eixo no lugar da alavanca', t ? `${r1(t.rpmEixo)} rpm · ${t.estado}` : JSON.stringify(await tele()));

  if (process.env.SHOT) await b.foto(process.env.SHOT);
} catch (e) {
  confere(false, `exceção no teste: ${e.message}`);
}
confere(logs.length === 0, 'console sem erros', logs.join('\n'));
b.fechar();
servidor?.close();
await espera(500);
try { fs.rmSync(perfil, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {}
console.log(falhas ? `${falhas} falha(s) de ${total} conferências` : `TUDO OK (${total} conferências)`);
process.exit(falhas ? 1 : 0);
