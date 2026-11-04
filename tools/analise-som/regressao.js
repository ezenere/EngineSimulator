// Regressão: todos os presets (ou os passados como "a,b,c"). Partida a frio, lenta, acelerada, desaceleração; em marcha;
// arcade. Só imprime falhas: NaN, motor apagando, lenta fora do lugar, saturação. Uso: node regressao.js [ids]
const H = require('./harness.js');
const ids = process.argv[2] ? process.argv[2].split(',') : H.PRESETS.map((p) => p.id);
let fails = 0; const t0 = Date.now(); const pk = [];
for (const id of ids) {
  const cfg = H.config(id);
  const probs = [];
  for (const [name, script, dur, params, warm, check] of [
    ['neutro frio', [[0, { throttle: 0 }], [4, { throttle: 1 }], [5.5, { throttle: 0 }]], 10, {}, false, 'idle'],
    ['marcha', [[0, { throttle: 0 }], [2.5, { shift: 1 }], [3, { throttle: 1 }], [7, { throttle: 0 }]], 12, {}, true, 'run'],
    ['arcade', [[0, { throttle: 0 }], [3, { throttle: 1 }], [4, { throttle: 0 }]], 10, { dynamics: 'arcade' }, true, 'idle'],
  ]) {
    let st = [];
    const r = H.render(cfg, script, dur, { params, warm, onBlock: (d, t) => { if (t > dur - 1.5) st.push([d.state, d.rpmAvg]); } });
    let nan = 0, peak = 0, clip = 0;
    for (const x of r.L) { if (!Number.isFinite(x)) nan++; const a = Math.abs(x); if (a > peak) peak = a; if (a > 0.97) clip++; }
    if (nan) probs.push(`${name}: ${nan} NaN`);
    if (st.some((s) => s[0] !== 'run')) probs.push(`${name}: apagou (${st.find((s) => s[0] !== 'run')[0]})`);
    const rpm = st.reduce((s, x) => s + x[1], 0) / st.length;
    if (check === 'idle' && (rpm < cfg.idle * 0.8 || rpm > cfg.idle * 2.2)) probs.push(`${name}: lenta ${Math.round(rpm)} rpm (alvo ${cfg.idle})`);
    if (clip / r.L.length > 0.002) probs.push(`${name}: clip ${(100 * clip / r.L.length).toFixed(2)}%`);
    pk.push(peak); if (peak > 0.97) probs.push(`${name}: pico ${peak.toFixed(3)}`);
  }
  if (probs.length) { fails++; console.log(`${id}: ${probs.join(' · ')}`); }
}
console.log(`${ids.length} presets, ${fails} com problema, pico máx ${Math.max(...pk).toFixed(2)}, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
