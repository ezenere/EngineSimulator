// Renderiza um preset segurando uma rotação em neutro (giro travado, acelerador que zera o torque líquido, como
// segurar o pedal parado) e grava float32 estéreo intercalado a 48 kHz, para comparar com uma gravação.
// O integrador do controle de lenta fica congelado: com o pedal abaixo de 5% ele continuaria fechando o ar (o giro
// travado está acima da lenta) e o coletor iria caindo ao longo da renderização.
//   node render.js <preset> <rpm> <saida.f32> ['{"campo":valor}'] [segundos]
//   DSP=/caminho/dsp.js node render.js ...   (outra versão do DSP, ex.: git show HEAD:src/dsp.js > /tmp/dsp.head.js)
//   PARAMS='{"ambSound":false}' node render.js ...   (parâmetros de escuta e mixagem, ex.: sem som de ambiente)
//   THR=1 node render.js ...   (pedal fixo em vez do que zera o torque, ex.: plena carga)
const H = require('./harness.js'); const fs = require('fs');
const [id, rpm, out, patch, dur] = [process.argv[2], +process.argv[3], process.argv[4], JSON.parse(process.argv[5] || '{}'), +(process.argv[6] || 10)];
if (process.env.DSP) H.use(require('path').resolve(process.env.DSP));
const cfg = H.config(id, patch), params = JSON.parse(process.env.PARAMS || '{}');
function mk(thr) { const d = new H.EngineDSP(H.FS); d.setConfig(cfg); Object.assign(d.params, params); d.tempMode = 'fixed'; d.tempSet = 90; d.coolant = 90; d.exhT = 450;
  d.state = 'run'; d.lockOmega = true; d.KI = 0; d.runT = 60; d.omega = rpm * 2 * Math.PI / 60; d.rpmAvg = rpm; d.thrTarget = thr; d.thr = thr; return d; }
const B = 128, l = new Float32Array(B), r = new Float32Array(B);
let lo = 0, hi = 0.6, thr = 0.05;
if (process.env.THR) thr = +process.env.THR;
else for (let it = 0; it < 14; it++) { thr = 0.5 * (lo + hi); const d = mk(thr); for (let i = 0; i < 0.8 * H.FS; i += B) d.process(l, r, B); if (d.tqMean > 0) hi = thr; else lo = thr; }
const d = mk(thr), n = Math.floor(dur * H.FS), o = new Float32Array(2 * n);
for (let i = 0; i < n; i += B) { d.process(l, r, B); for (let k = 0; k < B && i + k < n; k++) { o[2 * (i + k)] = l[k]; o[2 * (i + k) + 1] = r[k]; } }
fs.writeFileSync(out, Buffer.from(o.buffer));
console.log(`${id} a ${rpm} rpm: acelerador ${thr.toFixed(3)}, coletor ${(d.pMan / 101325).toFixed(2)} bar → ${out}`);
