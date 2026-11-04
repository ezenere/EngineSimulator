// Teste da página da Turbina num navegador headless de verdade (com áudio rodando).
//
//   node tools/turbina-testa-navegador.mjs <url de turbina.html> [--firefox] [--reserva] [--porta 9333] [--foto arquivo.png]
//
// --reserva bloqueia o AudioWorklet: a página tem de cair no ScriptProcessorNode (DSP na thread
// principal). Nesse modo as mensagens não passam pela porta e as verificações delas são puladas.
//
// Chromium por CDP puro (/usr/bin/chromium) ou Firefox por WebDriver BiDi (/usr/bin/firefox), sem
// dependências. Antes da página carregar, um script grava toda mensagem mandada pela porta do
// AudioWorklet (para conferir o que chega ao DSP). Roteiro: carga e lista de controles, partida
// completa, manete (teclado e posições), troca de avião, pós-combustão, reversor, passagem
// supersônica com estrondo, troca de ambiente (tem de mandar `params` com o env novo), a bordo,
// turboélice, corte do motor e console sem erros. Sai com código 1 se alguma verificação falhar.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const opc = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const url = args.find((a) => !a.startsWith('--') && a !== opc('--porta') && a !== opc('--foto'));
const firefox = args.includes('--firefox');
const reserva = args.includes('--reserva');
const porta = +opc('--porta', firefox ? 9450 : 9333);
const foto = opc('--foto');
if (!url) { console.error('uso: node tools/turbina-testa-navegador.mjs <url> [--firefox] [--reserva] [--porta N] [--foto arq.png]'); process.exit(2); }
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const perfil = fs.mkdtempSync(path.join(os.tmpdir(), firefox ? 'turbina-ff-' : 'turbina-cr-'));

// grava as mensagens para o worklet; marca o modo (worklet ou reserva)
const GANCHO = `(() => {
  window.__msgs = [];
  const orig = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (m, ...r) { try { if (m && typeof m === "object" && typeof m.type === "string") window.__msgs.push(JSON.parse(JSON.stringify(m))); } catch {} return orig.call(this, m, ...r); };
})();${reserva ? "\nAudioWorklet.prototype.addModule = () => Promise.reject(new Error('bloqueado no teste'));" : ''}`;

const logs = [];
// clicarEm: clique de verdade do mouse (ponteiro ativo, então setPointerCapture funciona)
let ev, tecla, fechar, fotografar, clicarEm;

if (!firefox) {
  const chrome = spawn('/usr/bin/chromium', ['--headless=new', `--remote-debugging-port=${porta}`, '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check', '--window-size=1400,900', `--user-data-dir=${perfil}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
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
    if (m.method === 'Log.entryAdded' && m.params.entry.level !== 'verbose' && m.params.entry.level !== 'info') logs.push(`log.${m.params.entry.level}: ${m.params.entry.text} ${m.params.entry.url || ''}`);
    if (m.method === 'Network.loadingFailed' && !/net::ERR_ABORTED/.test(m.params.errorText)) logs.push(`FALHA DE REDE: ${m.params.errorText}`);
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) logs.push(`HTTP ${m.params.response.status}: ${m.params.response.url}`);
  });
  const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  ev = async (expr) => { const r = await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) throw new Error(`${expr.slice(0, 80)}: ${r.result.exceptionDetails.exception?.description}`); return r.result?.result?.value; };
  const teclas = { Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', KeyR: 'r', KeyI: 'i', KeyC: 'c', KeyV: 'v', KeyW: 'w', KeyS: 's' };
  tecla = async (code, tipo = 'ambas') => {
    if (tipo !== 'up') await cmd('Input.dispatchKeyEvent', { type: 'keyDown', code, key: teclas[code], text: teclas[code] });
    if (tipo !== 'down') await cmd('Input.dispatchKeyEvent', { type: 'keyUp', code, key: teclas[code] });
  };
  fotografar = async (arq) => { const r = await cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(arq, Buffer.from(r.result.data, 'base64')); };
  clicarEm = async (x, y) => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await cmd('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }); };
  fechar = () => { ws.close(); chrome.kill(); };
  await cmd('Runtime.enable'); await cmd('Log.enable'); await cmd('Network.enable'); await cmd('Page.enable');
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: GANCHO });
  await cmd('Page.navigate', { url });
} else {
  fs.writeFileSync(`${perfil}/user.js`, 'user_pref("media.autoplay.default", 0);\nuser_pref("media.autoplay.blocking_policy", 0);\n');
  const ff = spawn('/usr/bin/firefox', ['--headless', '--width', '1400', '--height', '900', '--remote-debugging-port', String(porta), '--profile', perfil, '--no-remote'], { stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 60; i++) { await espera(300); try { ws = new WebSocket(`ws://127.0.0.1:${porta}/session`); await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; }); break; } catch { ws = null; } }
  let id = 0; const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } if (m.method === 'log.entryAdded' && ['error', 'warn'].includes(m.params.level)) logs.push(`${m.params.level}: ${m.params.text}`); };
  const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await cmd('session.new', { capabilities: {} });
  await cmd('session.subscribe', { events: ['log.entryAdded'] });
  const tree = await cmd('browsingContext.getTree', {}); const ctx = tree.result.contexts[0].context;
  await cmd('browsingContext.setViewport', { context: ctx, viewport: { width: 1400, height: 900 } });
  await cmd('script.addPreloadScript', { functionDeclaration: `() => { ${GANCHO} }` });
  ev = async (e) => { const r = await cmd('script.evaluate', { expression: e, target: { context: ctx }, awaitPromise: true, userActivation: true, resultOwnership: 'none' }); if (r.result?.type === 'exception') throw new Error(`${e.slice(0, 80)}: ${r.result.exceptionDetails?.text}`); return desserializar(r.result?.result); };
  const desserializar = (v) => (!v ? undefined : v.type === 'string' || v.type === 'number' || v.type === 'boolean' ? v.value : v.type === 'null' || v.type === 'undefined' ? null : JSON.stringify(v));
  const teclas = { Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', KeyR: 'r', KeyI: 'i', KeyC: 'c', KeyV: 'v', KeyW: 'w', KeyS: 's' };
  tecla = async (code, tipo = 'ambas') => {
    const acoes = [];
    if (tipo !== 'up') acoes.push({ type: 'keyDown', value: teclas[code] });
    if (tipo !== 'down') acoes.push({ type: 'keyUp', value: teclas[code] });
    await cmd('input.performActions', { context: ctx, actions: [{ type: 'key', id: 'teclado', actions: acoes }] });
  };
  fotografar = async (arq) => { const r = await cmd('browsingContext.captureScreenshot', { context: ctx }); fs.writeFileSync(arq, Buffer.from(r.result.data, 'base64')); };
  clicarEm = async (x, y) => { await cmd('input.performActions', { context: ctx, actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pointerMove', x: Math.round(x), y: Math.round(y) }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }] }] }); };
  fechar = () => { ws.close(); ff.kill(); };
  await cmd('browsingContext.navigate', { context: ctx, url, wait: 'complete' });
}

// ------------------------------------------------------------------ roteiro
let falhas = 0;
const confere = (ok, rotulo, valor) => { console.log(`${ok ? 'ok  ' : 'FALHA'} ${rotulo}${valor !== undefined ? ` → ${typeof valor === 'string' ? valor : JSON.stringify(valor)}` : ''}`); if (!ok) falhas++; };
// verificação que depende das mensagens gravadas na porta do worklet (pulada no modo reserva)
const confereMsg = (ok, rotulo, valor) => (reserva ? console.log(`--    ${rotulo} (pulado: reserva)`) : confere(ok, rotulo, valor));
const J = async (expr) => JSON.parse(await ev(`JSON.stringify(${expr})`));
const ate = async (expr, ms, passo = 250) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await J(expr); if (v) return v; await espera(passo); } return v; };
const clicar = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('não achei ${sel.replace(/'/g, '')}'); e.click(); return true; })()`);
const chip = (grupo, texto) => ev(`(() => { const b = [...document.querySelectorAll('#${grupo} .chip')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(texto)})); if (!b) throw new Error('chip ${texto} em ${grupo}'); b.click(); return true; })()`);
const familia = (nome) => ev(`[...document.querySelectorAll('.fam')].find((b) => b.textContent.startsWith(${JSON.stringify(nome)})).click()`);
const slider = (id, v, solta = true) => ev(`(() => { const r = document.getElementById('${id}'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(r, '${v}'); r.dispatchEvent(new Event('input', { bubbles: true })); ${solta ? "r.dispatchEvent(new Event('change', { bubbles: true }));" : ''} return r.closest('.field').querySelector('output').textContent; })()`);
const eicas = () => J(`({ ...document.getElementById('eicas').dataset })`);
const rotulo = () => ev(`document.querySelector('.bar .ignition').textContent`);
const ultimos = (tipo) => J(`window.__msgs.filter((m) => m.type === '${tipo}')`);

await espera(2500);
confere((await ev('document.title')) === 'Turbina', 'título');
const estrutura = await J(`({
  familias: document.querySelectorAll('.fam').length, presets: document.querySelectorAll('.preset').length,
  secoes: [...document.querySelectorAll('#controls h2')].map((h) => h.textContent),
  sliders: [...document.querySelectorAll('#controls input[type=range]')].map((i) => i.id),
  chips: [...document.querySelectorAll('#controls .chips')].map((g) => g.id),
  placa: document.querySelector('.plate').textContent, canvas: [...document.querySelectorAll('canvas')].map((c) => c.id + ':' + Math.round(c.getBoundingClientRect().width) + 'x' + Math.round(c.getBoundingClientRect().height)),
  manete: document.getElementById('lever').getAttribute('aria-valuenow'), marcas: [...document.querySelectorAll('#leverMarks span')].map((s) => s.textContent),
  posicoes: [...document.querySelectorAll('#detents button')].map((b) => b.textContent + (b.disabled ? ' (desab.)' : '')),
  leituras: [...document.querySelectorAll('.readout .k')].map((k) => k.textContent), fonte: getComputedStyle(document.querySelector('.logo')).fontFamily.split(',')[0],
})`);
console.log('estrutura:', JSON.stringify(estrutura));
confere(estrutura.familias === 6 && estrutura.presets === 5, 'famílias (6) e aviões da 1ª família (5)');
confere(JSON.stringify(estrutura.secoes) === JSON.stringify(['Motor', 'Aeronave', 'Fan', 'Jato', 'Acessórios', 'Escuta']), 'seções do turbofan');
confere(estrutura.sliders.join() === 'spool,thrust,n2Idle,n1Idle,span,cockpitX,length,shape,fanB,vanes,fanD,n1Max,hpcB,lptB,n2Max,bpr,jetV,nozD,angle,dist,mxFan,mxCore,mxJet,mxVol', 'sliders do 737 no solo', estrutura.sliders.length);
confere(estrutura.chips.join() === 'arch,engines,spools,mount,ab,nozzle,suppressor,liners,sync,observer,groundMode,env', 'grupos de chips', estrutura.chips.length);
confere(estrutura.placa === 'Turbofan · 2× · 24 pás · bypass 5,5 · 121 kN', 'placa', estrutura.placa);
confere(estrutura.canvas.every((c) => !/:0x|x0$/.test(c)) && estrutura.canvas.length === 4, 'canvas com tamanho', estrutura.canvas);
confere(estrutura.posicoes.at(3).includes('desab.'), 'pós-combustão desabilitada no 737');

// ---- partida
await clicar('.bar .ignition');
const r1 = await ate(`document.querySelector('.bar .ignition').textContent === 'Partida em curso…' && document.querySelector('.bar .ignition').textContent`, 3000);
confere(r1 === 'Partida em curso…', 'botão durante a partida', await rotulo());
const msgs0 = await J(`window.__msgs.map((m) => m.type + (m.type === 'input' ? ':' + Object.keys(m).filter((k) => k !== 'type').join('+') : ''))`);
confereMsg(msgs0.slice(0, 5).join() === 'params,config,params,input:tla+reverser,input:start+tla', 'sequência de mensagens do legado (worklet)', msgs0.slice(0, 5));
const cfg0 = (await ultimos('config'))[0];
confereMsg(cfg0 && cfg0.cfg.id === 'narrow' && cfg0.cfg.gain > 0, 'config com o ganho calibrado na página', cfg0 && cfg0.cfg.gain);
const avisoPartida = await ate(`document.getElementById('eicas').dataset.avisos`, 3000);
confere(/MOTOR DE PARTIDA|GIRANDO A SECO/.test(avisoPartida || ''), 'aviso de partida no EICAS', avisoPartida);
const acesa = await ate(`/CHAMA ACESA/.test(document.getElementById('eicas').dataset.avisos) && document.getElementById('eicas').dataset.avisos`, 15000);
confere(!!acesa, 'chama acesa', acesa);
const emRegime = await ate(`document.querySelector('.bar .ignition').textContent === 'Cortar motor'`, 25000, 500);
const e1 = await eicas();
confere(emRegime && +e1.n2 > 55, 'motor em marcha lenta (N2)', e1);
if (reserva) confere(msgs0.length === 0, 'modo reserva: nada passou pela porta do worklet', msgs0.length);
const rms1 = await ev(`document.getElementById('scope').dataset.rms`);
confere(+rms1 > -60, 'som saindo (RMS no analisador)', `${rms1} dBFS`);
confere(/rpm · BPF/.test(await ev(`document.getElementById('roFan').textContent`)), 'leitura do fan', await ev(`document.getElementById('roFan').textContent`));
confere(/dB SPL/.test(await ev(`document.getElementById('roSpl').textContent`)), 'leitura no ouvido', await ev(`document.getElementById('roSpl').textContent`));

// ---- manete pelo teclado e pelas posições
await tecla('Digit3');
confere((await ev(`document.getElementById('lever').getAttribute('aria-valuenow')`)) === '100', 'tecla 3 → manete 100%');
confere(await ev(`document.querySelector('#detents [data-tla="1"]').classList.contains('at')`), 'posição "decolagem" marcada');
await tecla('KeyS', 'down'); await espera(500); await tecla('KeyS', 'up');
const recuo = +(await ev(`document.getElementById('lever').getAttribute('aria-valuenow')`));
confere(recuo < 100 && recuo > 60, 'S segurado recua a manete', recuo);
await clicar('#detents [data-tla="1"]');
const n1alto = await ate(`+document.getElementById('eicas').dataset.n1 > 85 && document.getElementById('eicas').dataset.n1`, 12000);
confere(!!n1alto, 'N1 sobe na decolagem', n1alto);
confere(+(await eicas()).empuxo > 150, 'empuxo no EICAS', (await eicas()).empuxo);

// ---- troca de avião: F-16, pós-combustão
await familia('Militares');
await clicar('.preset[data-id="fighter"]');
await espera(400);
const p2 = await J(`({ placa: document.querySelector('.plate').textContent, marcado: document.querySelector('.preset[aria-pressed=true]')?.dataset.id, ab: document.getElementById('abKey').disabled, marcas: [...document.querySelectorAll('#leverMarks span')].map((s) => s.textContent) })`);
confere(p2.placa.includes('pós-combustão') && p2.marcado === 'fighter' && !p2.ab && p2.marcas.includes('pós'), 'F-16 carregado com pós-combustão', p2);
const cfgF = (await ultimos('config')).at(-1);
confereMsg(cfgF?.cfg.id === 'fighter', 'config do F-16 mandada ao DSP');
await tecla('Digit4');
confere((await ev(`document.getElementById('lever').getAttribute('aria-valuenow')`)) === '130', 'tecla 4 → manete 130%');
const pc = await ate(`/PÓS-COMBUSTÃO/.test(document.getElementById('eicas').dataset.avisos) && document.getElementById('eicas').dataset.avisos`, 10000);
confere(!!pc, 'PÓS-COMBUSTÃO no EICAS', pc);
confere(/Mach/.test(await ev(`document.getElementById('roJet').textContent`)), 'leitura do jato', await ev(`document.getElementById('roJet').textContent`));

// ---- reversor
await tecla('KeyR');
confere((await ev(`document.getElementById('revKey').getAttribute('aria-pressed')`)) === 'true', 'R liga o reversor');
const rev = await ate(`/REV/.test(document.getElementById('eicas').dataset.avisos)`, 4000);
confere(!!rev, 'REV no EICAS');
await clicar('#revKey');
confere((await ev(`document.getElementById('revKey').getAttribute('aria-pressed')`)) === 'false', 'botão desliga o reversor');

// ---- ambiente: tem de mandar params com o env novo
const antes = (await ultimos('params')).length;
await chip('env', 'Hangar');
const pEnv = (await ultimos('params')).slice(antes);
confereMsg(pEnv.length >= 1 && pEnv.at(-1).params.env === 'hangar', 'trocar ambiente manda params ao DSP', pEnv.map((m) => m.params.env));
confere((await ev(`document.querySelector('#env [aria-pressed=true]').textContent`)) === 'Hangar', 'chip do ambiente marcado');

// ---- arrastar no mapa muda ângulo e distância
await ev(`document.getElementById('obsMap').scrollIntoView({ block: 'center' })`);
await espera(200);
const mapa = await J(`(() => { const c = document.getElementById('obsMap'); const r = c.getBoundingClientRect(); return { x: r.left + r.width * 0.5 + 40, y: r.top + r.height * 0.5 + 5 }; })()`);
await clicarEm(mapa.x, mapa.y);
await espera(200);
const solo = await J(`({ ang: document.getElementById('angle').value, dist: document.getElementById('dist').value, nota: document.getElementById('obsNote').textContent, ultimo: window.__msgs.filter((m) => m.type === 'params').at(-1)?.params })`);
confere(+solo.ang > 150 && (reserva || (solo.ultimo.angle === +solo.ang && solo.ultimo.dist === +solo.dist)), 'clique no mapa (atrás do motor)', solo);

// ---- passagem supersônica: silêncio, estrondo
await chip('groundMode', 'Passagem');
confereMsg((await ultimos('params')).at(-1)?.params.listener === 'flyby', 'ouvinte em passagem');
confere(await slider('speed', 2000) === '2.000 km/h · Mach 1,63', 'velocidade 2000 km/h');
await slider('alt', 300);
const cone = await ate(`/cone de Mach está/.test(document.getElementById('obsNote').textContent) && document.getElementById('obsNote').textContent`, 3000);
confere(!!cone, 'nota da passagem antes do cone', cone);
const bum = await ate(`/estrondo:/.test(document.getElementById('roSpl').textContent) && document.getElementById('roSpl').textContent`, 20000, 150);
confere(!!bum, 'estrondo sônico', bum);
const aviso = (await eicas()).avisos;
confere(/ESTRONDO SÔNICO/.test(aviso), 'ESTRONDO SÔNICO no EICAS', aviso);
if (foto) await fotografar(foto.replace(/\.png$/, '-passagem.png'));

// ---- a bordo (V) e posição (C)
await tecla('KeyV');
const bordo = await J(`({ l: window.__msgs.filter((m) => m.type === 'params').at(-1)?.params.listener, chips: [...document.querySelectorAll('#board .chip')].map((b) => b.textContent + (b.disabled ? '(d)' : '')) })`);
confereMsg(bordo.l === 'cockpit', 'V: a bordo (F-16 não tem cabine de passageiros: cockpit)', bordo);
await tecla('KeyC');
confereMsg((await ultimos('params')).at(-1)?.params.listener === 'wingcam', 'C: câmera externa');

// ---- turboélice: hélice, manete volta a 100%
await familia('Turboélices');
await clicar('.preset[data-id="regional"]');
await espera(300);
const tp = await J(`({ secoes: [...document.querySelectorAll('#controls h2')].map((h) => h.textContent), manete: document.getElementById('lever').getAttribute('aria-valuenow'), ab: document.getElementById('abKey').disabled, placa: document.querySelector('.plate').textContent })`);
confere(tp.secoes.includes('Hélice') && tp.secoes.includes('Gerador de gás') && tp.manete === '100' && tp.ab, 'ATR 72: seção Hélice, manete limitada a 100%', tp);
const np = await ate(`/hélice .* rpm/.test(document.getElementById('roFan').textContent) && document.getElementById('roFan').textContent`, 8000);
confere(!!np, 'leitura da hélice', np);

// ---- mexer em parâmetros (ao vivo e estrutural)
const nCfg = (await ultimos('config')).length, nTune = (await ultimos('tune')).length;
await slider('jetV', 200, false);
await chip('engines', '4');
await espera(300);
confereMsg((await ultimos('tune')).length > nTune && (await ultimos('config')).length > nCfg, 'slider manda tune, nº de motores manda config', { tune: (await ultimos('tune')).length - nTune, config: (await ultimos('config')).length - nCfg });
confere((await ev(`document.querySelector('.preset[aria-pressed=true]')`)) == null, 'preset desmarcado depois de mexer');

// ---- corte
await tecla('KeyI');
const corte = await rotulo();
confere(corte === 'Desacelerando…' || corte === 'Dar partida', 'I corta o motor', corte);
if (foto) await fotografar(foto);

// ---- telemetria e console
const tel = await J(`window.__msgs.length`);
console.log(`mensagens para o worklet: ${tel}`);
// no modo reserva o aviso de ScriptProcessorNode obsoleto é esperado
if (reserva) logs.splice(0, logs.length, ...logs.filter((l) => !/ScriptProcessorNode is deprecated/.test(l)));
console.log(logs.length ? logs.join('\n') : '(sem erros no console)');
confere(!logs.length, 'console sem erros');
fechar();
// o navegador ainda escreve no perfil logo depois de morto
await espera(500);
try { fs.rmSync(perfil, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {}
console.log(falhas ? `${falhas} FALHA(S)` : 'TUDO OK');
process.exit(falhas ? 1 : 0);
