// Renderiza cenários do Diesel para WAV float 32 + telemetria JSON (DIESEL.md 8).
//
//   npx tsx tools/diesel-render.ts <presets|all> <cenário> <pasta> [ouvinte] [--resumo]
//
//   cenários: idle, cold, frio10, rev, wot, sweep, notches, degraus, jake, plena1900
//   ouvinte: ext (padrão), pipe, bay, int, road
//   --resumo: só imprime a telemetria média por segundo (não grava WAV)
import fs from 'node:fs';
import path from 'node:path';
import { gravarWav } from './wav';
import { PRESETS } from '../src/engines/diesel/presets';
import { CENARIOS, renderizar, preset, SR } from './diesel-comum';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const resumo = process.argv.includes('--resumo');
const [which, cen, pasta, ouvinte] = args;
if (!which || !cen || !CENARIOS[cen]) { console.error(`uso: tsx tools/diesel-render.ts <presets|all> <${Object.keys(CENARIOS).join('|')}> <pasta> [ouvinte] [--resumo]`); process.exit(2); }
const ids = which === 'all' ? PRESETS.map((p) => p.id) : which.split(',');
if (!resumo) fs.mkdirSync(pasta, { recursive: true });
for (const id of ids) {
  const t0 = Date.now();
  const spec = preset(id);
  const r = renderizar(spec, cen, { ouvinte: ouvinte || 'ext' });
  if (resumo) {
    console.log(`== ${id} ${cen} gain=${r.cfg.gain.toFixed(3)} mkIdle=${r.cfg.mkIdle.toFixed(2)} fuelLenta=${r.cfg.fuelLenta.toFixed(3)} refKnock=${r.cfg.refKnock.toExponential(2)} powerModel=${(r.cfg.powerModel || 0).toFixed(0)} kW nan=${r.nan}`);
    const T = Math.ceil(r.tele[r.tele.length - 1].t);
    for (let s = 0; s < T; s++) {
      const x = r.tele.filter((e) => e.t >= s && e.t < s + 1);
      if (!x.length) continue;
      const m = (k: string) => x.reduce((a, e) => a + (+e[k] || 0), 0) / x.length;
      console.log(`${String(s).padStart(3)}s ${x[x.length - 1].state.padEnd(5)} rpm ${m('rpm').toFixed(0).padStart(5)} alvo ${m('rpmAlvo').toFixed(0).padStart(5)} fuel ${m('fuel').toFixed(3)} λ ${m('lambda').toFixed(2).padStart(5)} pMax ${m('pMax').toFixed(1).padStart(5)} dp ${m('dpdth').toFixed(2).padStart(5)} ang ${m('ang').toFixed(1).padStart(5)} τ ${m('tauId').toFixed(2)}ms Tinj ${m('tInj').toFixed(0)} Tevo ${m('tEvo').toFixed(0)} esc ${m('exhT').toFixed(0)}°C boost ${m('boost').toFixed(2)} turbo ${(m('turboRpm') / 1000).toFixed(0)}k kW ${m('kW').toFixed(0)} carga ${m('cargaKW').toFixed(0)} água ${m('coolant').toFixed(0)} fum ${m('fumaca').toFixed(2)} br ${m('branca').toFixed(2)} g${x[x.length - 1].gear} ${m('kmh').toFixed(0)}km/h`);
    }
  } else {
    const base = path.join(pasta, `${id}_${cen}_${ouvinte || 'ext'}`);
    const pico = gravarWav(base + '.wav', r.L, r.R, SR, 'float32');
    fs.writeFileSync(base + '.json', JSON.stringify({ id, cen, ouvinte: ouvinte || 'ext', gain: r.cfg.gain, pico, nan: r.nan, tele: r.tele }));
    console.log(`${id.padEnd(10)} ${cen.padEnd(8)} pico=${pico.toFixed(3)} rpmFim=${Math.round(r.d.rpmAvg)} ${r.d.state} nan=${r.nan} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }
}
