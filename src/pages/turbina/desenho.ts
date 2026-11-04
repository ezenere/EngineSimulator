// Mostradores da Turbina desenhados em canvas a cada quadro (porte de src/jet-app.js): EICAS,
// face do fan, osciloscópio/espectro, mapa do observador e as leituras de texto ao lado do fan.
// Nada aqui passa pelo React: lê o estado do controle e escreve direto nos elementos.
import { clamp, fmt, type ControleTurbina } from './controle';

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// cores e fontes do tema, lidas das variáveis CSS (de novo quando as fontes chegam)
export const C: Record<string, string> = {};
export function readColors() {
  for (const k of ['bg', 'panel', 'raise', 'line', 'ink', 'muted', 'faint', 'gold', 'blue', 'violet', 'hot']) C[k] = css(`--${k}`);
  C.display = css('--f-display'); C.mono = css('--f-mono');
}

function fit(canvas: HTMLCanvasElement): [CanvasRenderingContext2D, number, number] {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [ctx, r.width, r.height];
}

// Mostrador redondo no estilo dos painéis de motor (EICAS)
function dial(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, value: number, max: number, red: number, label: string, unit: string, digits: number, hot: boolean) {
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.0;
  const ang = (v: number) => a0 + (a1 - a0) * clamp(v / max, 0, 1.02);
  g.lineCap = 'butt';
  g.lineWidth = Math.max(3, R * 0.07);
  g.strokeStyle = C.raise;
  g.beginPath(); g.arc(cx, cy, R * 0.9, a0, a1); g.stroke();
  g.strokeStyle = C.violet;
  g.beginPath(); g.arc(cx, cy, R * 0.9, ang(red), a1); g.stroke();
  g.strokeStyle = hot ? C.hot : C.gold; g.globalAlpha = 0.85;
  g.beginPath(); g.arc(cx, cy, R * 0.9, a0, ang(value)); g.stroke(); g.globalAlpha = 1;
  // marcas
  g.lineWidth = 1;
  for (let i = 0; i <= 10; i++) {
    const v = (max * i) / 10, a = ang(v), major = i % 2 === 0;
    g.strokeStyle = v >= red ? C.violet : major ? C.ink : C.faint;
    const r1 = R * (major ? 0.72 : 0.76), r2 = R * 0.8;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); g.stroke();
  }
  // ponteiro
  const a = ang(value);
  g.strokeStyle = C.ink; g.lineWidth = 2;
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * R * 0.86, cy + Math.sin(a) * R * 0.86); g.stroke();
  g.fillStyle = C.ink; g.beginPath(); g.arc(cx, cy, Math.max(3, R * 0.05), 0, Math.PI * 2); g.fill();
  // leitura digital
  g.textAlign = 'right'; g.textBaseline = 'alphabetic';
  g.fillStyle = hot ? C.hot : C.ink;
  g.font = `800 ${Math.round(R * 0.36)}px ${C.display}`;
  g.fillText(fmt(value, digits), cx + R * 0.95, cy + R * 0.62);
  g.textAlign = 'left';
  g.font = `500 ${Math.max(9, Math.round(R * 0.09))}px ${C.mono}`;
  g.fillStyle = C.muted;
  g.fillText(`${label}${unit ? ' · ' + unit : ''}`, cx - R * 0.95, cy + R * 0.62);
}

export function drawEicas(c: ControleTurbina, cv: HTMLCanvasElement) {
  const { spec, tele } = c;
  const [g, w, h] = fit(cv);
  g.clearRect(0, 0, w, h);
  const prop = spec.arch === 'turboprop';
  // N1 grande à esquerda, EGT menor à direita, leituras digitais embaixo do EGT
  const narrow = w < 560;
  let big = narrow ? Math.min(w * 0.27, (h - 112) / 2.1) : Math.min(w * 0.3, h * 0.4), small = Math.min(w * 0.17, big * 0.68);
  const gap = w - 2 * big - 2 * small - 20;
  if (gap < 0) { const k = (w - 20) / (2 * big + 2 * small); big *= k; small *= k; }
  const cx1 = big + 6, cy1 = big + 8;
  const cx2 = w - small - 6, cy2 = small + 8;
  dial(g, cx1, cy1, big, prop ? tele.np || 0 : tele.n1 || 0, 110, 104, prop ? 'NP' : 'N1', '%', 1, false);
  dial(g, cx2, cy2, small, tele.egt || 0, 1100, 950, 'EGT', '°C', 0, (tele.ab || 0) > 0.1);
  const rows = [
    [prop ? 'NG' : 'N2', `${fmt(tele.n2 || 0, 1)} %`],
    // consumo específico típico: turbofan de bypass alto gasta bem menos por kN que turbojato
    ['Combustível', `${fmt((tele.ff || 0) * spec.thrust * (36 + 45 / (1 + (spec.bpr || 0))) * (1 + 1.6 * (tele.ab || 0)), 0)} kg/h`],
    ['Empuxo', `${fmt(Math.max(0, tele.thrust || 0), 0)} kN`],
  ];
  if (prop) rows.push(['Hélice', `${fmt(((tele.np || 0) / 100) * spec.propRpm, 0)} rpm`]);
  // em tela estreita as leituras vão para baixo dos dois mostradores, na largura toda
  const x0 = narrow ? 6 : Math.max(cx1 + big + 12, cx2 - small - 20), x1 = w - 6;
  const y0 = narrow ? cy1 + big * 0.75 + 18 : cy2 + small * 0.95 + 16;
  g.textBaseline = 'alphabetic';
  rows.forEach(([k, v], i) => {
    const y = y0 + i * 24;
    if (y > h - 4) return;
    g.textAlign = 'left'; g.font = `500 10px ${C.mono}`; g.fillStyle = C.muted; g.fillText(k.toUpperCase(), x0, y);
    g.textAlign = 'right'; g.font = `500 14px ${C.mono}`; g.fillStyle = C.ink; g.fillText(v, x1, y);
    g.strokeStyle = C.line; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, y + 7); g.lineTo(x1, y + 7); g.stroke();
  });
  // avisos
  const flags: [string, string][] = [];
  if (tele.state === 'start') {
    if (tele.starter) flags.push(['MOTOR DE PARTIDA', C.gold]);
    flags.push(tele.lit ? ['CHAMA ACESA', C.hot] : tele.fuel ? ['COMBUSTÍVEL · IGNIÇÃO', C.gold] : ['GIRANDO A SECO', C.muted]);
  }
  if (tele.state === 'stop') flags.push(['CORTE', C.muted]);
  if ((tele.ab || 0) > 0.1) flags.push(['PÓS-COMBUSTÃO', C.hot]);
  if ((tele.rev || 0) > 0.1) flags.push(['REV', C.hot]);
  if ((tele.boomAge ?? 99) < 2) flags.push(['ESTRONDO SÔNICO', C.hot]);
  g.textAlign = 'center'; g.font = `600 ${Math.max(10, Math.round(big * 0.1))}px ${C.mono}`;
  flags.forEach(([t, col], i) => { g.fillStyle = col; g.fillText(t, cx1, cy1 - big * 0.32 + i * big * 0.13); });
  // para os testes: o que está escrito nos mostradores
  cv.dataset.n1 = (tele.n1 || 0).toFixed(1); cv.dataset.n2 = (tele.n2 || 0).toFixed(1); cv.dataset.egt = (tele.egt || 0).toFixed(0);
  cv.dataset.empuxo = Math.max(0, tele.thrust || 0).toFixed(0); cv.dataset.avisos = flags.map((f) => f[0]).join('|');
}

// Face do fan girando na rotação real; acima de uns poucos giros por quadro vira borrão.
export function drawFan(c: ControleTurbina, cv: HTMLCanvasElement, now: number, dt: number) {
  const { spec, tele } = c;
  const [g, w, h] = fit(cv);
  g.clearRect(0, 0, w, h);
  const prop = spec.arch === 'turboprop';
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.42;
  const age = Math.min(0.05, Math.max(0, (now - (tele.t || now)) / 1000));
  const f = prop ? tele.fp || 0 : tele.f1 || 0;
  const ph = ((prop ? tele.phP : tele.ph) || 0) + f * age;
  const B = prop ? spec.propB : spec.fanB;
  const fanSweep = f * dt; // voltas por quadro
  // carcaça e estator
  if (!prop) {
    g.strokeStyle = C.line; g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cy, R * 1.04, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = C.faint;
    for (let i = 0; i < spec.vanes; i++) {
      const a = (i / spec.vanes) * Math.PI * 2;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * R * 1.07, cy + Math.sin(a) * R * 1.07); g.lineTo(cx + Math.cos(a) * R * 1.14, cy + Math.sin(a) * R * 1.14); g.stroke();
    }
  }
  const tipCol = !prop && (tele.Mt || 0) > 1 ? C.hot : C.gold;
  const hub = prop ? 0.14 : 0.3;
  // borrão de movimento: desenha as pás em várias posições dentro do quadro
  const steps = clamp(Math.ceil(fanSweep * B * 3), 1, 18);
  const blur = fanSweep * B > 6;
  if (blur) {
    const grd = g.createRadialGradient(cx, cy, R * hub, cx, cy, R);
    grd.addColorStop(0, C.raise); grd.addColorStop(1, tipCol);
    g.fillStyle = grd; g.globalAlpha = 0.28;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.arc(cx, cy, R * hub, 0, Math.PI * 2, true); g.fill();
    g.globalAlpha = 1;
  } else {
    for (let s = 0; s < steps; s++) {
      const p0 = ph - (fanSweep * s) / steps;
      g.globalAlpha = steps > 1 ? 0.9 / steps + 0.08 : 1;
      for (let b = 0; b < B; b++) {
        const a = (p0 + b / B) * Math.PI * 2 - Math.PI / 2;
        if (prop) {
          // pá de hélice: larga perto do cubo, afinando na ponta
          const pw = 0.09;
          g.fillStyle = C.ink;
          g.beginPath();
          g.moveTo(cx + Math.cos(a - pw) * R * 0.16, cy + Math.sin(a - pw) * R * 0.16);
          g.quadraticCurveTo(cx + Math.cos(a - pw * 0.7) * R * 0.6, cy + Math.sin(a - pw * 0.7) * R * 0.6, cx + Math.cos(a) * R, cy + Math.sin(a) * R);
          g.quadraticCurveTo(cx + Math.cos(a + pw * 0.4) * R * 0.6, cy + Math.sin(a + pw * 0.4) * R * 0.6, cx + Math.cos(a + pw) * R * 0.16, cy + Math.sin(a + pw) * R * 0.16);
          g.fill();
        } else {
          // pá de fan com torção: a ponta fica adiantada em relação à raiz
          const twist = 0.35;
          g.strokeStyle = C.ink; g.lineWidth = Math.max(1, (R * 2.2) / B);
          g.beginPath();
          g.moveTo(cx + Math.cos(a) * R * hub, cy + Math.sin(a) * R * hub);
          g.quadraticCurveTo(cx + Math.cos(a + twist * 0.3) * R * 0.65, cy + Math.sin(a + twist * 0.3) * R * 0.65, cx + Math.cos(a + twist) * R * 0.98, cy + Math.sin(a + twist) * R * 0.98);
          g.stroke();
          g.fillStyle = tipCol;
          g.beginPath(); g.arc(cx + Math.cos(a + twist) * R * 0.98, cy + Math.sin(a + twist) * R * 0.98, 1.6, 0, Math.PI * 2); g.fill();
        }
      }
    }
    g.globalAlpha = 1;
  }
  // cubo / spinner
  g.fillStyle = C.panel; g.strokeStyle = C.line; g.lineWidth = 1;
  g.beginPath(); g.arc(cx, cy, R * hub, 0, Math.PI * 2); g.fill(); g.stroke();
  // marca no spinner para ver o giro mesmo com borrão
  const sa = ph * Math.PI * 2 - Math.PI / 2;
  g.strokeStyle = C.muted; g.lineWidth = 2;
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(sa) * R * hub * 0.85, cy + Math.sin(sa) * R * hub * 0.85); g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = C.faint; g.font = `500 10px ${C.mono}`;
  if (R > 90) g.fillText(prop ? `${B} pás · tempo real` : `${B} pás · ${spec.vanes} palhetas · tempo real`, cx, cy + R * 1.24 > h - 6 ? h - 8 : cy + R * 1.24);
}

// Leituras de texto ao lado do fan (os <span> são do React, mas o texto é escrito aqui)
export type Leituras = { roFan: HTMLElement; roTip: HTMLElement; roCut: HTMLElement; roHpc: HTMLElement; roJet: HTMLElement; roSpl: HTMLElement };
const escrever = (e: HTMLElement, texto: string, classe?: string) => {
  if (e.textContent !== texto) e.textContent = texto;
  if (classe != null && e.className !== classe) e.className = classe;
};
export function renderReadout(c: ControleTurbina, r: Leituras) {
  const { spec, tele, audio } = c;
  const prop = spec.arch === 'turboprop';
  const on = (tele.n2 || 0) > 1;
  if (prop) {
    escrever(r.roFan, on ? `hélice ${fmt(((tele.np || 0) / 100) * spec.propRpm)} rpm · pás ${fmt((spec.propB * (tele.fp || 0)), 0)} Hz` : '—');
    escrever(r.roTip, on ? `Mach ${fmt(tele.Mh || 0, 2)}` : '—');
    escrever(r.roCut, 'hélice aberta: sem duto', 'v mono');
  } else {
    escrever(r.roFan, on ? `${fmt((tele.f1 || 0) * 60)} rpm · BPF ${fmt(tele.bpf || 0)} Hz` : '—');
    const Mt = tele.Mt || 0;
    escrever(r.roTip, on ? `Mach ${fmt(Mt, 2)}${Mt > 1 ? ' · choques: buzz-saw' : ''}` : '—', `v mono${Mt > 1 ? ' warn' : ''}`);
    const cc = tele.cut1 || 0;
    escrever(r.roCut, !on ? '—' : Mt > 1 ? 'propaga (ponta supersônica)' : cc > 0.5 ? 'propaga pelo duto' : `cortado no duto (${fmt(20 * Math.log10(Math.max(cc, 1e-6)), 0)} dB)`,
      `v mono${on && cc <= 0.5 && Mt <= 1 ? ' ok' : ''}`);
  }
  escrever(r.roFan.previousElementSibling as HTMLElement, prop ? 'Hélice' : 'Fan');
  escrever(r.roCut.previousElementSibling as HTMLElement, prop ? 'Duto' : 'Tom BPF');
  escrever(r.roHpc, on ? `${fmt(tele.hpcF || 0)} Hz` : '—');
  const vj = tele.vj || 0, mj = tele.mj || 0;
  escrever(r.roJet, on ? `${fmt(vj)} m/s · Mach ${fmt(mj, 2)}${tele.vb > 1 ? ` · bypass ${fmt(tele.vb)} m/s` : ''}${tele.crackle ? ' · crackle' : ''}` : '—', `v mono${mj > 1 ? ' warn' : ''}`);
  const boom = (tele.boomAge ?? 99) < 4;
  escrever(r.roSpl, boom ? `estrondo: ${fmt(tele.boomDb)} dB de pico` : tele.spl > 20 && audio ? `≈ ${fmt(tele.spl)} dB SPL` : '—', `v mono${boom || tele.spl > 120 ? ' warn' : ''}`);
}

let tBuf: Float32Array<ArrayBuffer> | null = null, fBuf: Float32Array<ArrayBuffer> | null = null;
export function drawScope(c: ControleTurbina, cv: HTMLCanvasElement) {
  const { spec, tele, audio } = c;
  const [g, w, h] = fit(cv);
  g.clearRect(0, 0, w, h);
  const mid = h * 0.32;
  g.strokeStyle = C.line; g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, mid); g.lineTo(w, mid); g.stroke();
  g.font = `500 10px ${C.mono}`; g.fillStyle = C.faint; g.textAlign = 'left'; g.textBaseline = 'top';
  g.fillText('pressão no ouvido do observador', 10, 8);
  if (!audio) { g.fillText('dê a partida para ver a onda e o espectro', 10, h - 18); return; }
  const an = audio.analyser;
  if (!tBuf) { tBuf = new Float32Array(an.fftSize); fBuf = new Float32Array(an.frequencyBinCount); }
  an.getFloatTimeDomainData(tBuf);
  const sr = audio.ctx.sampleRate;
  const span = Math.min(tBuf.length, 2048);
  g.strokeStyle = C.gold; g.lineWidth = 1.2;
  g.beginPath();
  let s2 = 0;
  for (let i = 0; i < span; i++) {
    const x = (i / (span - 1)) * w;
    const v = tBuf[tBuf.length - span + i];
    s2 += v * v;
    const y = mid - v * mid * 0.9;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.stroke();
  // para os testes: nível RMS da janela mostrada (dBFS)
  cv.dataset.rms = (10 * Math.log10(s2 / span + 1e-20)).toFixed(1);
  an.getFloatFrequencyData(fBuf!);
  const top = h * 0.66, bot = h - 4, f0 = 20, f1 = 16000;
  const fx = (f: number) => (Math.log(f / f0) / Math.log(f1 / f0)) * w;
  g.beginPath(); g.moveTo(0, bot);
  for (let x = 0; x <= w; x += 2) {
    const f = f0 * Math.pow(f1 / f0, x / w);
    const bin = Math.round((f / (sr / 2)) * fBuf!.length);
    const dbv = fBuf![Math.min(bin, fBuf!.length - 1)];
    const y = bot - clamp((dbv + 110) / 90, 0, 1) * (bot - top + h * 0.28);
    g.lineTo(x, y);
  }
  g.lineTo(w, bot); g.closePath();
  g.fillStyle = C.blue; g.globalAlpha = 0.22; g.fill(); g.globalAlpha = 1;
  // marcadores das fontes
  const prop = spec.arch === 'turboprop';
  const marks: [number, string, string][] = [];
  if ((tele.n2 || 0) > 5) {
    if (prop) marks.push([spec.propB * (tele.fp || 0), 'hélice', C.gold]);
    else marks.push([tele.bpf || 0, 'BPF', C.gold]);
    marks.push([tele.hpcF || 0, 'compressor', C.violet]);
    if ((tele.fJet || 0) > 20) marks.push([tele.fJet, 'jato', C.hot]);
    if ((tele.fShock || 0) > 0) marks.push([tele.fShock, 'choque', C.hot]);
  }
  let lastX = -1e9, row = 0;
  for (const [f, label, col] of marks.sort((a, b) => a[0] - b[0])) {
    if (!(f > f0 && f < f1)) continue;
    const x = fx(f);
    row = x - lastX < 70 ? row + 1 : 0; lastX = x;
    g.strokeStyle = col; g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(x, top - h * 0.28 + row * 12); g.lineTo(x, bot); g.stroke(); g.setLineDash([]);
    g.fillStyle = col; g.textAlign = x > w - 110 ? 'right' : 'left';
    g.fillText(`${label} ${fmt(f)} Hz`, x + (x > w - 110 ? -6 : 6), top - h * 0.26 + row * 12);
  }
  g.fillStyle = C.faint; g.textAlign = 'right';
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) g.fillText(f >= 1000 ? `${f / 1000}k` : String(f), fx(f) - 2, bot - 12);
}

// Mapa do observador: vista de cima (ao redor do motor) ou de lado (passagem).
export function mapGeom(w: number, h: number) {
  const ox = w * 0.5, oy = h * 0.5;
  const maxR = Math.min(w, h) * 0.46;
  const rad = (d: number) => Math.sqrt(d / 300) * maxR;
  return { ox, oy, maxR, rad };
}
export function drawMap(c: ControleTurbina, cv: HTMLCanvasElement, note: HTMLElement | null) {
  const { tele, params, groundMode } = c;
  const [g, w, h] = fit(cv);
  g.clearRect(0, 0, w, h);
  g.font = `500 10px ${C.mono}`; g.textBaseline = 'middle';
  if (groundMode === 'ground') {
    const { ox, oy, rad } = mapGeom(w, h);
    // anéis de distância
    g.strokeStyle = C.line; g.lineWidth = 1; g.fillStyle = C.faint; g.textAlign = 'left';
    for (const d of [10, 50, 150, 300]) { g.beginPath(); g.arc(ox, oy, rad(d), 0, Math.PI * 2); g.stroke(); g.fillText(`${d} m`, ox + rad(d) + 3, oy - 6); }
    // lóbulos de diretividade: frente (fan) e trás (jato), proporcionais ao nível
    const lobe = (dirFn: (th: number) => number, col: string) => {
      g.beginPath();
      for (let a = 0; a <= 360; a += 4) {
        const th = a <= 180 ? a : 360 - a;
        const r = rad(150) * dirFn(th);
        const x = ox - Math.cos((a * Math.PI) / 180) * r, y = oy - Math.sin((a * Math.PI) / 180) * r;
        if (a) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.closePath(); g.fillStyle = col; g.globalAlpha = 0.14; g.fill(); g.globalAlpha = 0.6; g.strokeStyle = col; g.stroke(); g.globalAlpha = 1;
    };
    const tab = (t: number[]) => (th: number) => { const x = clamp(th / 30, 0, 5.999), i = x | 0; return Math.pow(10, (t[i] + (t[i + 1] - t[i]) * (x - i)) / 30); };
    lobe(tab([-6, -2, 0, -3, -10, -20, -26]), C.gold);
    lobe(tab([-24, -22, -18, -14, -8, 0, -6]), C.hot);
    // avião visto de cima, nariz para a esquerda (mesmo sentido do ângulo)
    g.strokeStyle = C.ink; g.lineWidth = 2;
    g.beginPath(); g.moveTo(ox - 16, oy); g.lineTo(ox + 18, oy); g.stroke();
    g.lineWidth = 1.5; g.beginPath(); g.moveTo(ox + 2, oy - 14); g.lineTo(ox - 2, oy); g.lineTo(ox + 2, oy + 14); g.stroke();
    g.fillStyle = C.gold; g.fillRect(ox - 4, oy - 6, 6, 4);
    g.fillStyle = C.muted; g.textAlign = 'center'; g.fillText('entrada', ox - rad(150) * 0.75, oy + 12); g.fillText('jato', ox + rad(150) * 0.8, oy + 12);
    // você
    const a = (params.angle * Math.PI) / 180, r = rad(params.dist);
    const px = ox - Math.cos(a) * r, py = oy - Math.sin(a) * r;
    g.fillStyle = C.ink; g.beginPath(); g.arc(px, py, 5, 0, Math.PI * 2); g.fill();
    g.strokeStyle = C.bg; g.lineWidth = 2; g.stroke();
    g.fillStyle = C.ink; g.textAlign = 'center'; g.fillText('você', px, py - 12);
    if (note) {
      const where = params.angle < 35 ? 'na frente da entrada de ar: fan e compressor' : params.angle < 110 ? 'de lado: um pouco de tudo' : 'atrás: o jato domina';
      escrever(note, `${params.dist} m, ${params.angle}° · ${where}. Arraste no mapa para mudar.`);
    }
  } else {
    // vista lateral: chão embaixo, avião passando no alto
    const gy = h - 16, ox = w / 2;
    const span = 1600, sx = w / span;
    const alt = params.alt, sy = (gy - 14) / Math.max(250, alt * 1.25);
    g.strokeStyle = C.line; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, gy); g.lineTo(w, gy); g.stroke();
    g.fillStyle = C.ink; g.beginPath(); g.arc(ox, gy, 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = C.muted; g.textAlign = 'center'; g.fillText('você', ox, gy + 9);
    const x = tele.flyX ?? -800, ay = gy - alt * sy;
    g.strokeStyle = C.faint; g.setLineDash([4, 6]);
    g.beginPath(); g.moveTo(0, ay); g.lineTo(w, ay); g.stroke(); g.setLineDash([]);
    const vis = Math.abs(x) < span / 2;
    const ax = ox + clamp(x, -span / 2, span / 2) * sx;
    g.fillStyle = C.gold;
    if (vis) {
      g.beginPath(); g.moveTo(ax + 12, ay); g.lineTo(ax - 10, ay - 4); g.lineTo(ax - 10, ay + 4); g.closePath(); g.fill();
      g.strokeStyle = C.hot; g.globalAlpha = 0.6; g.beginPath(); g.moveTo(ax - 12, ay); g.lineTo(ax - 40, ay); g.stroke(); g.globalAlpha = 1;
    } else {
      const dirn = x > 0 ? 1 : -1, ex = dirn > 0 ? w - 4 : 4;
      g.beginPath(); g.moveTo(ex, ay); g.lineTo(ex - dirn * 10, ay - 6); g.lineTo(ex - dirn * 10, ay + 6); g.fill();
    }
    g.fillStyle = C.faint; g.textAlign = 'left'; g.fillText(`${fmt(alt)} m`, 4, ay - 8);
    const v = params.speed / 3.6, M = v / 340;
    if (M > 1 && vis) {
      // cone de Mach: atrás do avião, abrindo com ângulo asen(1/M); onde toca o chão, estrondo
      const back = alt * Math.sqrt(M * M - 1);
      const gx = ox + (x - back) * sx;
      g.strokeStyle = C.hot; g.lineWidth = 1.2; g.globalAlpha = 0.8;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(gx, gy); g.stroke();
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax - back * sx, ay - (gy - ay)); g.stroke();
      g.globalAlpha = 0.08; g.fillStyle = C.hot;
      // dentro do cone: tudo que fica atrás das duas linhas
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(gx, gy); g.lineTo(Math.min(gx, 0), gy); g.lineTo(Math.min(ax - back * sx, 0), ay - (gy - ay)); g.lineTo(ax - back * sx, ay - (gy - ay)); g.closePath(); g.fill();
      g.globalAlpha = 1;
    }
    if ((tele.boomAge ?? 99) < 1.2) {
      g.fillStyle = C.hot; g.textAlign = 'center'; g.font = `600 12px ${C.mono}`;
      g.fillText('BUM!', ox, gy - 22);
    }
    if (note) {
      const r = Math.hypot(x, alt);
      if (M > 1) {
        const back = alt * Math.sqrt(M * M - 1);
        const toCone = x - back; // >0: o cone já passou por você
        escrever(note, toCone < 0
          ? `Mach ${fmt(M, 2)} · o cone de Mach está a ${fmt(-toCone)} m de você. Até ele chegar, silêncio total.`
          : `Mach ${fmt(M, 2)} · dentro do cone. Estrondo de ${fmt(tele.boomDb || 0)} dB; o ronco de quando ele vinha chega de trás para frente.`);
      } else {
        const cos = -x / Math.max(1, r);
        const pct = (1 / (1 - M * cos) - 1) * 100;
        escrever(note, `${fmt(r)} m · ${x < 0 ? 'chegando' : 'indo embora'} · Doppler ${pct > 0 ? '+' : ''}${fmt(pct, 1)}% · volta de 6 km. Passe de Mach 1 para ouvir o estrondo.`);
      }
    }
  }
}

// Arrastar no mapa (vista de cima): ângulo e distância do observador
export function pickMap(c: ControleTurbina, cv: HTMLCanvasElement, e: { clientX: number; clientY: number }) {
  const r = cv.getBoundingClientRect();
  const { ox, oy, maxR } = mapGeom(r.width, r.height);
  const dx = e.clientX - r.left - ox, dy = e.clientY - r.top - oy;
  const d = clamp(Math.round(Math.pow(Math.hypot(dx, dy) / maxR, 2) * 300), 5, 300);
  const ang = clamp(Math.round((Math.atan2(Math.abs(dy), -dx) * 180) / Math.PI), 0, 180);
  return { angle: ang, dist: d };
}
