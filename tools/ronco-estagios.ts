// Diagnóstico do motor-base do Ronco por ESTÁGIO e por FONTE, com a mesma semente: de onde vêm (e onde morrem) os
// médios. Usa o gancho `tap` do EngineDSP, só leituras: o som não muda.
//
//   npx tsx tools/ronco-estagios.ts <preset> <pasta/> [--rpm R [--pedal x]] [--frio T] [--dur s] [--campo JSON] [--nome base]
//       Renderiza como o tools/ouvido/render.ts (giro travado, pedal que zera o torque ou fixo; sem --rpm: lenta livre)
//       com o ouvinte `ext` e grava em <pasta>/ (WAV mono float 32, tudo na escala da saída):
//         <base>_tudo.wav            a saída (média dos canais), igual à do render.ts do kit
//         <base>_so-<fonte>.wav      a parcela de cada fonte na mistura do ouvinte `ext` (antes do bloqueio de DC e do
//                                    tanh): escape (o que a boca irradia, sem o jato), jato, carcaca (a parede do escape),
//                                    admissao (pulso), chiadoAdm, mecanica (com a batida periódica), vibracao, coletor
//                                    (vazamento), turbo, compressor. O orcamento.py do kit lê este conjunto
//         <base>_est-fonte.wav       estágio 1: o pulso que as válvulas põem nos primários (Σ Z·ṁ·dens), em Pa × escala
//         <base>_est-ponta.wav       estágio 2: o que as ponteiras irradiam (Σ emit), antes dos filtros do microfone
//         <base>.json                rotação, pedal, ganhos, pesos do ouvinte e a pressão de pico em cada tubo
//
//   npx tsx tools/ronco-estagios.ts <preset> <pasta/> --impulso [--amp Pa] [--largura ms] [--cil c] [--valvula 0|1] [--campo JSON]
//       Função de transferência do escape: só a rede de tubos (válvulas fechadas), um pulso conhecido num primário.
//       --amp 1 (padrão): resposta linear. --amp 30000 --largura 2: um pulso de 0,3 bar com frente de 2 ms (meio
//       cosseno), para ver o afiamento não linear. Grava <base>_imp-entrada.wav e <base>_imp-ponta.wav e imprime a
//       transferência por terço de oitava (dB re a média de 150–400 Hz).
import fs from 'node:fs';
import path from 'node:path';
import { EngineDSP } from '../src/engines/ronco/dsp';
import { PRESETS, ACESSORIOS_PADRAO } from '../src/engines/ronco/presets';
import { montarConfig } from '../src/engines/ronco/config';
import { Biquad } from '../src/acoustics';
import { gravarMono } from './ouvido/render';

const SR = 48000, B = 128;
const a = process.argv.slice(2);
const BOOL = ['--impulso', '--lenta'];
const pos = a.filter((x, i) => !x.startsWith('--') && !(i > 0 && a[i - 1].startsWith('--') && !BOOL.includes(a[i - 1])));
const val = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
const tem = (k: string) => a.includes(k);
const [id, pasta] = pos;
if (!id || !pasta) { console.error('uso: tsx tools/ronco-estagios.ts <preset> <pasta/> [--rpm R [--pedal x]] [--frio T] [--dur s] [--campo JSON] [--nome base] | --impulso [--amp Pa] [--largura ms] [--cil c] [--valvula 0|1]'); process.exit(2); }
const campo = JSON.parse(val('--campo') || '{}');
const p0 = PRESETS.find((x) => x.id === id);
if (!p0) throw new Error(`preset desconhecido: ${id}`);
const spec: any = { ...ACESSORIOS_PADRAO, ...p0, ...campo };
const cfg = montarConfig(spec);
fs.mkdirSync(pasta, { recursive: true });

function novo() {
  const d: any = new EngineDSP(SR);
  d.params.listener = 'ext'; d.params.ambSound = false;
  Object.assign(d.params, JSON.parse(val('--param') || '{}')); // (ex.: --param '{"saSound":false}' desliga a bomba de ar secundário)
  d.setConfig(cfg);
  // (a calibração é determinística: guarda o resultado da primeira sonda, como a página faz, para não repeti-la)
  if (!cfg.gain) { cfg.gain = d.cfgGain; cfg.mkIdle = d.mkIdle; if (d.powerModel) { cfg.powerModel = d.powerModel; cfg.tqPeakModel = d.tqPeakModel; cfg.frPeakModel = d.frPeakModel; } }
  return d;
}

// ------------------------------------------------------------------ função de transferência da rede
if (tem('--impulso')) {
  const amp = +(val('--amp') || 1), larg = +(val('--largura') || 0), cil = +(val('--cil') || 0), valv = +(val('--valvula') ?? 1);
  const d = novo();
  d.valveState.v = valv; for (const r of d.rads) if (r.o !== undefined) r.o = valv;
  const n = 2 * SR, ent = new Float32Array(n), sai = new Float32Array(n), saiX = new Float32Array(n);
  // pulso: impulso unitário, ou degrau suave (meio cosseno de `larg` ms) seguido de queda exponencial de 6 ms
  const nl = Math.max(1, Math.round((larg / 1000) * SR));
  for (let i = 0; i < n; i++) ent[i] = larg ? (i < nl ? amp * 0.5 * (1 - Math.cos((Math.PI * i) / nl)) : amp * Math.exp(-(i - nl) / (0.006 * SR))) : i === 0 ? amp : 0;
  const { lines, nodes, runners, rads, radHP, radSh } = d;
  const pk = new Float64Array(lines.length);
  for (let s = 0; s < n; s++) {
    for (let i = 0; i < lines.length; i++) lines[i].read();
    for (let c = 0; c < d.N; c++) runners[c].out0 = 0.985 * runners[c].in0 + (c === cil ? ent[s] : 0);
    for (let i = 0; i < nodes.length; i++) nodes[i].step();
    for (let i = 0; i < lines.length; i++) { lines[i].write(); pk[i] = Math.max(pk[i], Math.abs(lines[i].in1)); }
    let e = 0, x = 0;
    for (let i = 0; i < rads.length; i++) { e += rads[i].emit; x += radSh[i].run(radHP[i].run(rads[i].emit)); }
    sai[s] = e; saiX[s] = x;
  }
  const base = path.join(pasta, val('--nome') || `${id}_imp${larg ? `-${amp}Pa-${larg}ms` : ''}`);
  gravarMono(`${base}_imp-entrada.wav`, ent); gravarMono(`${base}_imp-ponta.wav`, sai); gravarMono(`${base}_imp-microfone.wav`, saiX);
  // transferência por terço de oitava: energia de saída ÷ energia de entrada (DFT direta nas frequências de interesse)
  const dft = (x: Float32Array, f: number) => { let re = 0, im = 0; const w = (2 * Math.PI * f) / SR; for (let i = 0; i < x.length; i++) { re += x[i] * Math.cos(w * i); im -= x[i] * Math.sin(w * i); } return re * re + im * im; };
  const tercos = [50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000];
  const H: number[] = [], Hx: number[] = [];
  for (const fc of tercos) {
    let num = 0, numX = 0, den = 0;
    for (let k = 0; k < 24; k++) { const f = fc * Math.pow(2, (k + 0.5) / 24 / 3 - 1 / 6); num += dft(sai, f); numX += dft(saiX, f); den += dft(ent, f); }
    H.push(10 * Math.log10(num / den)); Hx.push(10 * Math.log10(numX / den));
  }
  const ref = (v: number[]) => 10 * Math.log10((Math.pow(10, v[5] / 10) + Math.pow(10, v[6] / 10) + Math.pow(10, v[7] / 10) + Math.pow(10, v[8] / 10)) / 4);
  const r0 = ref(H), r1 = ref(Hx);
  console.log(`${id}: rede do escape, pulso no cilindro ${cil}, ${larg ? `${amp} Pa com frente de ${larg} ms` : 'impulso (linear)'}, válvula ${valv ? 'aberta' : 'fechada'} · ${lines.length} tubos, ${rads.length} boca(s)`);
  console.log('terço (Hz)   ponta (dB re 150–400)   com os filtros do microfone');
  tercos.forEach((f, i) => console.log(`${String(f).padStart(6)}   ${(H[i] - r0).toFixed(1).padStart(8)}   ${(Hx[i] - r1).toFixed(1).padStart(8)}`));
  const banda = (v: number[], lo: number, hi: number) => { const xs = tercos.map((f, i) => [f, v[i]]).filter(([f]) => f >= lo && f < hi).map(([, x]) => Math.pow(10, x / 10)); return 10 * Math.log10(xs.reduce((s, x) => s + x, 0) / xs.length); };
  console.log(`bandas (média da transferência, dB re 150–400): 400–1k ${(banda(H, 400, 1000) - r0).toFixed(1)} · 1–2,5k ${(banda(H, 1000, 2500) - r0).toFixed(1)} · 2,5–6k ${(banda(H, 2500, 6300) - r0).toFixed(1)}`);
  console.log(`pico em cada tubo (Pa): ${Array.from(pk).map((v) => v.toFixed(amp > 10 ? 0 : 3)).join(' ')}`);
  process.exit(0);
}

// ------------------------------------------------------------------ estágios e fontes
const rpmAlvo = val('--rpm') ? +val('--rpm')! : undefined, frio = val('--frio') !== undefined ? +val('--frio')! : undefined;
const dur = +(val('--dur') || 12);
const l = new Float32Array(B), r = new Float32Array(B);
let d: any, pedal = NaN, modo: string;
if (rpmAlvo) {
  const mk = (thr: number) => {
    const x = novo();
    if (frio !== undefined) { x.ambientT = frio; x.tempMode = 'fixed'; x.tempSet = frio; x.coolant = frio; x.exhT = 250; x.runT = 20; }
    else { x.tempMode = 'fixed'; x.tempSet = 90; x.coolant = 90; x.exhT = 450; x.runT = 60; }
    x.state = 'run'; x.lockOmega = true; x.KI = 0; x.omega = (rpmAlvo * 2 * Math.PI) / 60; x.rpmAvg = rpmAlvo; x.thrTarget = thr; x.thr = thr;
    return x;
  };
  if (val('--pedal') !== undefined) pedal = +val('--pedal')!;
  else {
    let lo = 0, hi = 0.6;
    for (let it = 0; it < 14; it++) { pedal = 0.5 * (lo + hi); const x = mk(pedal); for (let i = 0; i < 0.8 * SR; i += B) x.process(l, r, B); if (x.tqMean > 0) hi = pedal; else lo = pedal; }
  }
  d = mk(pedal); modo = frio !== undefined ? 'travado frio' : 'travado';
} else {
  d = novo();
  if (frio !== undefined) { d.ambientT = frio; d.message({ type: 'input', temp: { mode: 'real', value: frio } }); modo = 'frio'; }
  else { d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } }); modo = 'lenta'; }
  d.message({ type: 'input', ignition: true });
}
const descarta = +(val('--descarta') ?? (modo.startsWith('travado') ? 3 : 8));
const n0 = Math.round(descarta * SR), n = Math.round(dur * SR);
const nR = d.rads.length, N = d.N;
const X = Array.from({ length: nR }, () => new Float32Array(n)), XJ = Array.from({ length: nR }, () => new Float32Array(n)), XC = Array.from({ length: nR }, () => new Float32Array(n));
const est: Record<string, Float32Array> = {};
for (const k of ['fonte', 'ponta', 'admissao', 'chiadoAdm', 'mecanica', 'vibracao', 'coletor', 'turbo', 'compressor']) est[k] = new Float32Array(n);
const [kIn, kMe, kSc, kRaw, kH] = d.posW;
const fMe = new Biquad().lp(SR, 3000, 0.7); // cópia do extMech (a sombra da carroceria sobre a mecânica)
const eAt = new Float64Array(nR), xAt = new Float64Array(nR), jAt = new Float64Array(nR);
const pk = new Float64Array(d.lines.length);
let g = -n0 - 1; // amostra global (negativa durante o descarte)
d.tap = {
  ponteira(i: number, e: number, x: number) { eAt[i] = e; xAt[i] = x; },
  jato(i: number, x: number) { jAt[i] = x; },
  gravar(_s: number, kEx: number, inP: number, inH: number, mech: number, vib: number, tur: number, sc: number, brk: number) {
    g++;
    const me = fMe.run(mech);
    if (g < 0) return;
    let f = 0;
    for (let c = 0; c < N; c++) { const m = d.mEx[c]; f += d.Zr * m * (m > 0 ? d.densC[c] : 1); }
    let e = 0;
    // (a carcaça entra na mesma soma do jato, entre os dois ganchos: o DSP guarda a parcela dela em carcOut)
    for (let i = 0; i < nR; i++) { const cz = d.carcK && d.carcSrc[i] ? d.carcOut[i] : 0; e += eAt[i]; X[i][g] = xAt[i] * kEx; XJ[i][g] = (jAt[i] - xAt[i] - cz) * kEx; XC[i][g] = cz * kEx; }
    est.fonte[g] = f * kEx; est.ponta[g] = e * kEx;
    est.admissao[g] = kIn * inP; est.chiadoAdm[g] = kH * inH; est.mecanica[g] = kMe * (me + kRaw * (mech - me)); est.vibracao[g] = 0.1 * vib;
    est.coletor[g] = (0.3 + 0.7 * kRaw) * brk; est.turbo[g] = 0.2 * tur; est.compressor[g] = kSc * sc;
    for (let i = 0; i < pk.length; i++) pk[i] = Math.max(pk[i], Math.abs(d.lines[i].in1));
  },
};
const L = new Float32Array(n), R = new Float32Array(n);
let ganho = 0, cont = 0;
for (let i = -n0; i < n; i += B) {
  d.process(l, r, B);
  if (i >= 0) { const k = Math.min(B, n - i); L.set(l.subarray(0, k), i); R.set(r.subarray(0, k), i); ganho += d.params.master * 0.5 * d.cfgGain * d.mk * d.fade; cont++; }
}
ganho /= Math.max(1, cont);
// a mistura do ouvinte `ext` em mono: cada ponteira chega a cada ouvido com o seu atraso (itdD) e o seu peso (pan)
const mono = (xs: Float32Array[]) => {
  const y = new Float32Array(n);
  for (let i = 0; i < nR; i++) {
    const [d0, d1] = d.itdD[i], pl = d.rads[i].panL, pr = d.rads[i].panR, x = xs[i];
    for (let s = 0; s < n; s++) y[s] += 0.5 * ((s >= d0 ? x[s - d0] : 0) * pl + (s >= d1 ? x[s - d1] : 0) * pr);
  }
  return y;
};
const cond = rpmAlvo ? `${Math.round(rpmAlvo)}rpm${val('--pedal') !== undefined ? `-p${Math.round(pedal * 100)}` : ''}${frio !== undefined ? '-frio' : ''}` : frio !== undefined ? 'frio' : 'lenta';
const base = path.join(pasta, val('--nome') || `${id}_${cond}_ext`);
const escalar = (x: Float32Array, k: number) => { const y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) y[i] = x[i] * k; return y; };
const saida = new Float32Array(n); for (let i = 0; i < n; i++) saida[i] = 0.5 * (L[i] + R[i]);
gravarMono(`${base}_tudo.wav`, saida);
const fontes: Record<string, Float32Array> = { escape: escalar(mono(X), ganho), jato: escalar(mono(XJ), ganho), carcaca: escalar(mono(XC), ganho) };
for (const k of ['admissao', 'chiadoAdm', 'mecanica', 'vibracao', 'coletor', 'turbo', 'compressor']) fontes[k] = escalar(est[k], ganho);
const rms = (x: Float32Array) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / x.length); };
const niveis: Record<string, number> = {};
for (const [k, x] of Object.entries(fontes)) {
  niveis[k] = +(20 * Math.log10(rms(x) + 1e-30)).toFixed(1);
  if (rms(x) > 1e-9) gravarMono(`${base}_so-${k}.wav`, x);
}
gravarMono(`${base}_est-fonte.wav`, escalar(est.fonte, ganho)); gravarMono(`${base}_est-ponta.wav`, escalar(est.ponta, ganho));
const rpm = d.rpmAvg;
const info = { preset: id, modo, rpm: +rpm.toFixed(1), f0: +(rpm / 120).toFixed(4), fixo: modo.startsWith('travado'), eventosPorCiclo: N, voltasPorCiclo: 2, pedal, coletorBar: +(d.pMan / 101325).toFixed(3),
  agua: Math.round(d.coolant), ganho, ouvinte: 'ext', campo, sr: SR, dur, niveisDb: niveis, saidaDb: +(20 * Math.log10(rms(saida))).toFixed(1), valvula: +d.valveState.v.toFixed(2),
  tubos: d.lines.map((x: any, i: number) => ({ len: +x.len.toFixed(3), Y: +x.Y.toFixed(3), kNL: x.kNL, primario: !!x.runner, picoPa: Math.round(pk[i]) })) };
fs.writeFileSync(`${base}.json`, JSON.stringify(info, null, 1));
fs.writeFileSync(`${base}_tudo.json`, JSON.stringify(info, null, 1));
console.log(`${base}: ${modo} ${info.rpm} rpm, pedal ${(+pedal).toFixed(4)}, coletor ${info.coletorBar} bar, saída ${info.saidaDb} dB · ` + Object.entries(niveis).filter(([, v]) => v > -200).map(([k, v]) => `${k} ${v}`).join(' · '));
console.log(`  pico nos tubos (kPa): ${info.tubos.map((t: any) => `${t.primario ? 'P' : ''}${(t.picoPa / 1000).toFixed(1)}`).join(' ')}`);
