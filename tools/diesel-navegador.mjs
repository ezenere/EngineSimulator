// Teste da página do Diesel num navegador headless de verdade (o padrão de tools/ronco-navegador.mjs: CDP no
// Chromium, WebDriver BiDi no Firefox). Liga o motor (velas, partida), acelera, troca marcha, preset, ambiente e
// ouvinte, passa pelos portadores (bancada, gerador com degraus, locomotiva com notches, e de volta a um caminhão, que
// tem de voltar à lenta), aciona o freio-motor (J),
// mexe no painel e confere telemetria, som na saída, worklet (não a reserva) e console.
//
//   node tools/diesel-navegador.mjs [url da diesel.html] [chromium|firefox] [porta]
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
const porta = +(process.argv[4] || (nav === 'firefox' ? 9470 : 9350));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
// MUDO=1: o teste roda sem tocar nas caixas (o áudio continua rodando e sendo medido no analisador): --mute-audio no
// Chromium; no Firefox, media.volume_scale 0 (o fluxo vai em silêncio ao servidor de áudio)
const MUDO_CR = process.env.MUDO ? ['--mute-audio'] : [];
const MUDO_FF = process.env.MUDO ? 'user_pref("media.volume_scale", "0.0");\n' : '';
const perfil = fs.mkdtempSync(path.join(os.tmpdir(), `diesel-${nav}-`));
const logs = [];
let falhas = 0;
const confere = (ok, msg, extra = '') => { console.log(`${ok ? 'ok   ' : 'FALHA'} ${msg}${extra ? ` · ${extra}` : ''}`); if (!ok) falhas++; };

// servidor estático do dist/ em /data/engine/ (como em ezenere.com/data/engine/)
let servidor = null;
if (!url || url === 'dist') {
  const dist = path.join(RAIZ, 'dist');
  if (!fs.existsSync(path.join(dist, 'diesel.html'))) { console.error('dist/diesel.html não existe: rode npm run build'); process.exit(2); }
  const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
  servidor = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (!u.startsWith('/data/engine/')) { res.writeHead(404); res.end(); return; }
    const arq = path.join(dist, u.slice('/data/engine/'.length) || 'index.html');
    if (!arq.startsWith(dist) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': tipos[path.extname(arq)] || 'application/octet-stream' });
    fs.createReadStream(arq).pipe(res);
  }).listen(porta + 1, '127.0.0.1');
  url = `http://127.0.0.1:${porta + 1}/data/engine/diesel.html`;
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
const tele = () => ev(`(() => { const k = window.__diesel; const t = k.tele; return { rpm: t.rpm, state: t.state, gear: t.gear, kmh: t.kmh, pMax: t.pMax, lambda: t.lambda, notch: t.notch, portador: t.portador, cargaKW: t.cargaKW, hz: t.hz, freio: t.freio, jake: t.jake, velas: t.velas, boost: t.boost, fuel: t.fuel, coolant: t.coolant, tempos: t.tempos, temPt: Array.isArray(t.ptheta) && t.ptheta.length > 0, modo: k.audio?.modo, sr: k.audio?.ctx.sampleRate, estadoCtx: k.audio?.ctx.state, idade: performance.now() - (t.t || 0) }; })()`);
const rms = () => ev(`(() => { const an = window.__diesel.audio?.analyser; if (!an) return -999; const x = new Float32Array(an.fftSize); an.getFloatTimeDomainData(x); let s = 0; for (const v of x) s += v * v; return 10 * Math.log10(s / x.length + 1e-20); })()`);
const deslizar = (id, v) => ev(`(() => { const r = document.getElementById(${JSON.stringify(id)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(r, String(${v})); r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); return r.closest('.field').querySelector('output').textContent; })()`);
// Esperas: em vez de dormir um tempo fixo depois de mexer num controle (com a máquina carregada a página ainda não
// respondeu), lê até a condição valer ou o limite passar e devolve a última leitura, que a conferência julga e mostra.
// `min` espera pelo menos isso antes de olhar, onde o estado de antes já satisfaria a condição ou onde a medida é de um
// estado assentado (a lenta que serve de referência). Os limites são folgados (a troca de preset calibra o motor na
// thread principal antes de mandar a configuração): só pesam quando algo está errado.
const lerAte = async (f, ok, ms = 6000, min = 0) => { const t0 = Date.now(); if (min) await espera(min); let v; for (;;) { v = await f(); if (ok(v) || Date.now() - t0 >= ms) return v; await espera(150); } };
const esperaAte = (f, ms = 8000, min = 0) => lerAte(f, Boolean, ms, min);
const teleAte = (ok, ms = 8000, min = 0) => lerAte(tele, ok, ms, min);
const textoAte = (sel, ok, ms = 4000) => lerAte(() => texto(sel), (v) => v != null && ok(v), ms).then((v) => v ?? '');
// motor de cada portador na telemetria (a condição de cada troca de preset leva o portador, que só muda quando a
// configuração nova chega ao DSP: o estado do preset anterior não passa por ela)
const carroEmLenta = (x) => x.portador === 'carro' && x.state === 'run' && Math.abs(x.rpm - 500) < 40;
const geradorEm1800 = (x) => x.portador === 'gerador' && x.state === 'run' && x.rpm > 1750;
const emdEmLenta = (x) => x.portador === 'locomotiva' && x.state === 'run' && x.tempos === 2 && x.rpm > 200 && x.rpm < 400;

try {
  await b.ir(url);
  await esperaAte(() => ev(`document.readyState === 'complete' && !!window.__diesel && !!document.querySelector('.preset[aria-pressed=true]')`), 15000);
  confere((await ev('document.title')) === 'Diesel', 'título');
  const ini = await ev(`({ familias: document.querySelectorAll('.fam').length, presets: document.querySelectorAll('.preset').length, marcado: document.querySelector('.preset[aria-pressed=true]')?.dataset.id, placa: document.querySelector('.plate')?.textContent, secoes: [...document.querySelectorAll('.controls h2')].map((h) => h.textContent), sliders: document.querySelectorAll('.controls input[type=range]').length, ordem: document.getElementById('roOrder').textContent })`);
  confere(ini.familias === 4 && ini.presets === 8 && ini.marcado === 'hilux28', 'presets: 4 famílias, 8 picapes e carros, Hilux marcada', JSON.stringify([ini.familias, ini.presets, ini.marcado]));
  confere(/^4 em linha .* 2,8 L · 4 tempos · common-rail · turbo 2,4 bar/.test(ini.placa), 'placa', ini.placa);
  const esperadas = 'Escuta e ambiente,Carga,Motor,Características,Governador,Temperatura do motor,Transmissão,Escapamento,Acessórios,Fumaça e frio,Admissão';
  confere(ini.secoes.join(',') === esperadas, 'seções do painel', ini.secoes.join(','));
  confere(ini.sliders >= 30, 'sliders no painel', String(ini.sliders));

  // liga: motor quente para a partida não esperar as velas (a temperatura vai ao DSP: espera o áudio existir)
  await clicar('.bar .ignition');
  await esperaAte(() => ev(`!!window.__diesel.audio`), 15000);
  await ev(`window.__diesel.setTempMode('fixed')`); await ev(`window.__diesel.setCoolant(90)`);
  // a lenta medida aqui é a referência do "acelerando soa mais alto": 2 s de mínimo para ela assentar
  let t = await teleAte((x) => x.state === 'run' && x.rpm > 650 && x.rpm < 1150 && x.idade < 500 && x.pMax > 30 && x.lambda > 2 && x.temPt, 20000, 2000);
  if (process.env.RESERVA) confere(t.modo === 'script', 'áudio pela reserva (ScriptProcessorNode)', `${t.modo} · ${t.sr} Hz`);
  else confere(t.modo === 'worklet', 'áudio pelo AudioWorklet (não a reserva)', `${t.modo} · ${t.sr} Hz · ${t.estadoCtx}`);
  confere(t.state === 'run' && t.rpm > 650 && t.rpm < 1150, 'pegou e está em lenta', `${t.state} ${Math.round(t.rpm)} rpm`);
  confere(t.idade < 500 && t.pMax > 30 && t.lambda > 2 && t.temPt, 'telemetria do diesel chegando (pMax, λ, p–θ)', `pMax ${t.pMax?.toFixed(1)} bar, λ ${t.lambda?.toFixed(1)}, ${Math.round(t.idade)} ms`);
  const lenta = await rms();
  confere(lenta > -60, 'som na saída em lenta', `${lenta.toFixed(1)} dBFS`);
  const most = await lerAte(async () => [await texto('#dPmax'), await texto('#dLambda')], (m) => /bar · .* bar\/°/.test(m[0]) && /λ/.test(m[1]), 4000);
  confere(/bar · .* bar\/°/.test(most[0]) && /λ/.test(most[1]), 'mostradores de pico de pressão e λ', most.join(' · '));

  // acelera em neutro: o governador de máxima segura a rotação
  await tecla('KeyW');
  t = await teleAte((x) => x.rpm > 3800, 12000);
  const alto = await rms();
  confere(t.rpm > 3800 && t.rpm < 4500, 'W acelera até o governador de máxima', `${Math.round(t.rpm)} rpm`);
  confere(alto > lenta + 3, 'acelerando soa mais alto', `${alto.toFixed(1)} vs ${lenta.toFixed(1)} dBFS`);
  await tecla('KeyW', 'keyup');
  await teleAte((x) => x.rpm < 1200, 12000); // volta perto da lenta antes de engatar

  // engata e anda
  await tecla('KeyE');
  const g1 = await textoAte('#gearRead', (v) => /^D?1$/.test(v));
  confere(/^D?1$/.test(g1), 'E engata a 1ª', g1);
  await tecla('KeyW', 'keydown', { shiftKey: true });
  t = await teleAte((x) => x.kmh > 2, 12000);
  confere(t.kmh > 2, 'meio pé anda', `${t.kmh.toFixed(1)} km/h`);
  await tecla('KeyW', 'keyup');
  await tecla('KeyQ');
  await teleAte((x) => x.gear === 0, 3000);
  // S segurado e a janela perde o foco (o keyup não chega): o freio solta e o botão da tela apaga
  await tecla('KeyS');
  const acendeu = await esperaAte(() => ev(`document.getElementById('brakeBtn').classList.contains('on')`), 3000);
  await ev(`window.dispatchEvent(new Event('blur'))`);
  const apagou = await esperaAte(() => ev(`!document.getElementById('brakeBtn').classList.contains('on')`), 3000);
  confere(acendeu && apagou && (await ev(`window.__diesel.input.brake`)) === 0, 'S segurado e a janela perde o foco: o freio solta e o botão apaga');

  // ambiente e microfone
  await clicar('#env .chip:nth-child(3)');
  confere((await lerAte(() => ev(`window.__diesel.estado.params.env`), (v) => v === 'tunnel', 3000)) === 'tunnel', 'ambiente Túnel');
  await tecla('KeyC');
  confere((await lerAte(() => ev(`window.__diesel.audio.ouvinte`), (v) => v === 'int', 3000)) === 'int', 'C: microfone na cabine');
  await tecla('KeyC'); await tecla('KeyC'); // ext → bay? (pipe, ext, int, bay)

  // caminhão com Jake: freio-motor acionado pela tecla J
  await clicar('.fam:nth-child(2)');
  await clicar('.preset[data-id=catc15]');
  const pc = await textoAte('.plate', (v) => v.startsWith('6 em linha'));
  confere(pc.startsWith('6 em linha'), 'placa do Cat C15', pc);
  // (o caminhão nasce no mesmo portador da picape, que estava ligada: os 0,8 s de antes viram o mínimo)
  await teleAte((x) => x.state === 'run' && x.rpm > 400, 20000, 800);
  await tecla('KeyW');
  await espera(3000); // (o tempo com o pé no fundo: é a ação, não uma espera por resposta)
  await tecla('KeyW', 'keyup');
  await tecla('KeyJ');
  t = await teleAte((x) => x.jake || x.freio || x.rpm < 1.3 * 600, 5000);
  confere(await ev(`window.__diesel.estado.carga.freio`) && (t.jake || t.freio || t.rpm < 1.3 * 600), 'J liga o freio-motor (Jake na desaceleração)', `jake ${t.jake} rpm ${Math.round(t.rpm)}`);
  await tecla('KeyJ');

  // gerador: degraus de carga com rotação fixa
  await clicar('.fam:nth-child(3)');
  await clicar('.preset[data-id=gen500]');
  await teleAte(geradorEm1800, 25000);
  await tecla('Digit2');
  t = await teleAte((x) => x.portador === 'gerador' && Math.abs(x.rpm - 1800) < 60 && x.cargaKW > 150, 15000);
  confere(t.portador === 'gerador' && Math.abs(t.rpm - 1800) < 60 && t.cargaKW > 150, 'gerador a 1800 rpm com 50% de carga (tecla 2)', `${Math.round(t.rpm)} rpm, ${Math.round(t.cargaKW)} kW, ${t.hz?.toFixed(1)} Hz`);
  const dc = await lerAte(async () => [await texto('#dCarga'), await ev(`document.getElementById('dCarga').closest('.ro-row').querySelector('.k').textContent`)], (d) => /^[\d.]+ kW · \d+,\d Hz$/.test(d[0]) && d[1] === 'Alternador', 4000);
  confere(/^[\d.]+ kW · \d+,\d Hz$/.test(dc[0]) && dc[1] === 'Alternador', 'leitura kW/Hz do alternador do gerador', dc[0]);
  await tecla('Digit0');
  // fora do veículo não há via: o campo "Observador" some e a tecla V não muda nada
  await tecla('KeyV');
  await espera(300); // (a tecla não pode mudar nada: a janela de observação é o teste)
  confere((await ev(`window.__diesel.estado.observer`)) === 'car' && !(await ev(`!!document.getElementById('observer')`)), 'gerador: V não leva o observador para a via (sem o campo no painel)', await ev(`window.__diesel.estado.observer`));

  // locomotiva EMD (2 tempos): notches pelo teclado
  await clicar('.fam:nth-child(4)');
  await clicar('.preset[data-id=emd710]');
  await teleAte(emdEmLenta, 25000);
  t = await tele();
  confere(t.tempos === 2 && /ciclo|360/.test(await ev(`'360'`)), 'EMD 710 em 2 tempos', `tempos ${t.tempos}`);
  await tecla('Digit4');
  t = await teleAte((x) => x.notch === 4 && x.rpm > 500, 15000);
  const n4 = await textoAte('#notchRead', (v) => v === '4');
  confere(t.notch === 4 && t.rpm > 500 && n4 === '4', 'notch 4 pela tecla, giro subindo', `notch ${t.notch} ${Math.round(t.rpm)} rpm`);
  await tecla('Minus');
  const n3 = await textoAte('#notchRead', (v) => v === '3');
  confere(n3 === '3', '− desce o notch', n3);
  await tecla('Digit0');

  // troca de portador de volta para um caminhão (defeito: depois do gerador o caminhão ficava "acelerado constante")
  // gerador com carga → EMD em notch 8 → Scania: o Scania tem de nascer no portador veículo e voltar à lenta de 500
  await clicar('.fam:nth-child(3)');
  await clicar('.preset[data-id=gen500]');
  await teleAte(geradorEm1800, 25000);
  await tecla('Digit2');
  await teleAte((x) => x.portador === 'gerador' && x.cargaKW > 100, 10000); // o gerador sob carga
  await clicar('.fam:nth-child(2)');
  await clicar('.preset[data-id=scaniav8]');
  t = await teleAte(carroEmLenta, 25000);
  confere(t.portador === 'carro' && Math.abs(t.rpm - 500) < 40, 'gerador → Scania: veículo em lenta (não fica isócrono a 1800)', `${t.portador} ${Math.round(t.rpm)} rpm`);
  await clicar('.fam:nth-child(4)');
  await clicar('.preset[data-id=emd710]');
  await teleAte(emdEmLenta, 25000);
  await tecla('Digit8');
  await teleAte((x) => x.notch === 8 && x.rpm > 700, 15000); // a EMD subindo em notch 8
  await clicar('.fam:nth-child(2)');
  await clicar('.preset[data-id=scaniav8]');
  t = await teleAte((x) => carroEmLenta(x) && x.notch === 0, 25000);
  confere(t.portador === 'carro' && Math.abs(t.rpm - 500) < 40 && t.notch === 0, 'EMD em notch 8 → Scania: lenta, sem notch', `${t.portador} ${Math.round(t.rpm)} rpm notch ${t.notch}`);
  await clicar('.fam:nth-child(4)');
  await clicar('.preset[data-id=emd710]');
  await teleAte(emdEmLenta, 25000);

  // bancada: dinamômetro e rotação-alvo
  await chip('#portador', 'Bancada');
  await esperaAte(() => ev(`!!document.getElementById('rpmAlvo') && !!document.getElementById('dinamometro')`), 4000);
  confere((await deslizar('rpmAlvo', 600)) === '600 rpm', 'rotação-alvo da bancada');
  confere(/%/.test(await deslizar('dinamometro', 0.3)), 'carga do dinamômetro');

  // painel: governador, temperatura, cilindrada (escala log)
  await clicar('.fam:nth-child(1)');
  await clicar('.preset[data-id=om617]');
  // o OM 617 no DSP (4 tempos, depois da EMD de 2) e ligado: a configuração do preset sai 60 ms depois do clique e um
  // controle mexido antes disso a substitui (some o "motor novo do zero" e o motor herda o giro da EMD e apaga)
  await teleAte((x) => x.tempos === 4 && x.state === 'run' && x.rpm > 500, 25000);
  await chip('#portador', 'Veículo');
  await teleAte((x) => x.portador === 'carro', 6000);
  confere(await esperaAte(() => ev(`!!document.getElementById('droop') && !!document.getElementById('manual')`), 4000), 'governador mecânico: droop e acelerador manual');
  confere(/L$/.test(await deslizar('disp', Math.log10(3.0))), 'cilindrada em escala logarítmica', await deslizar('disp', Math.log10(3.0)));

  // I desliga (antes do inverno: a −10 °C fixos o motor que está dando a partida às vezes não pega, e aí a tecla I
  // ligaria em vez de desligar). A cilindrada nova recomeça o motor: espera ele pegar.
  await teleAte((x) => x.state === 'run' && x.rpm > 500, 20000);
  await tecla('KeyI');
  t = await teleAte((x) => x.state === 'off', 8000);
  const bl = await textoAte('.bar .ignition', (v) => v.includes('Ligar motor'));
  confere(t.state === 'off' && bl.includes('Ligar motor'), 'I desliga o motor', `${t.state} · ${bl}`);

  // temperatura fixa no inverno (chega ao DSP com o motor parado)
  await ev(`[...document.querySelectorAll('.controls .chip')].find((c) => c.textContent.startsWith('Inverno')).click()`);
  t = await teleAte((x) => Math.round(x.coolant) === -10, 6000);
  confere(Math.round(t.coolant) === -10, 'temperatura fixa em −10 °C', String(t.coolant));
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
