// Mostradores do Ronco desenhados em canvas a cada quadro (drawTach, drawRing, drawScope e
// drawPassby de src/app.js): conta-giros com arco, faixa vermelha, turbo, velocímetro, torque e
// temperatura; ciclo de ignição de 720° em tempo real; onda e espectro; vista de cima da via.
// Também atualiza direto no DOM o que muda a cada quadro (marcha, válvula, frequência de ignição,
// nota da passagem, água e escape), para o React não re-renderizar com a telemetria.
import type { ControleRonco } from './controle';

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

type Cores = Record<string, string>;

function fit(canvas: HTMLCanvasElement): [CanvasRenderingContext2D, number, number] {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [ctx, r.width, r.height];
}

export class Mostradores {
  C: Cores = {};
  private shownRpm = 0;
  private ringPhase = 0; private ringSweep = 0; private lastNow = 0;
  private glow = new Float32Array(16);
  private tBuf: Float32Array<ArrayBuffer> | null = null;
  private fBuf: Float32Array<ArrayBuffer> | null = null;
  private raf = 0;

  constructor(private k: ControleRonco) {}

  readColors() {
    const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const C = this.C;
    for (const k of ['bg', 'panel', 'raise', 'line', 'ink', 'muted', 'faint', 'gold', 'blue', 'violet', 'hot']) C[k] = css(`--${k}`);
    C.display = css('--f-display'); C.mono = css('--f-mono');
  }

  iniciar() {
    this.readColors();
    if (document.fonts) document.fonts.ready.then(() => this.readColors());
    const frame = (now: number) => { this.frame(now); this.raf = requestAnimationFrame(frame); };
    this.raf = requestAnimationFrame(frame);
  }
  parar() { cancelAnimationFrame(this.raf); }

  private frame(now: number) {
    const k = this.k, tele = k.tele;
    const dt = this.lastNow ? Math.min(0.1, (now - this.lastNow) / 1000) : 0;
    // água do motor: o controle acompanha a telemetria (menos enquanto o usuário mexe nele)
    const cs = document.getElementById('coolant');
    if (tele.coolant !== undefined && document.activeElement !== cs && Math.round(tele.coolant) !== k.lento.agua) k.mudarLento({ agua: Math.round(tele.coolant) });
    // temperatura do escape: só mexe no texto quando o grau muda
    const et = tele.exhT === undefined ? '' : String(Math.round(tele.exhT));
    if (et !== k.lento.escape) k.mudarLento({ escape: et });
    this.lastNow = now;
    const tach = document.getElementById('tach') as HTMLCanvasElement | null;
    if (tach) this.drawTach(tach);
    const ring = document.getElementById('ring') as HTMLCanvasElement | null;
    if (ring) this.drawRing(ring, now, dt);
    const scope = document.getElementById('scope') as HTMLCanvasElement | null;
    if (scope) this.drawScope(scope);
    this.drawPassby();
  }

  private drawTach(canvas: HTMLCanvasElement) {
    const { C, k } = this, tele = k.tele, spec = k.estado.spec;
    const [g, w, h] = fit(canvas);
    g.clearRect(0, 0, w, h);
    this.shownRpm += (tele.rpm - this.shownRpm) * 0.35;
    const shownRpm = this.shownRpm;
    const red = spec.redline;
    const max = Math.ceil((red * 1.12) / 1000) * 1000;
    const cx = w / 2, cy = h * 0.54, R = Math.min(w * 0.46, h * 0.5);
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const ang = (rpm: number) => a0 + (a1 - a0) * clamp(rpm / max, 0, 1.02);

    // faixa vermelha
    g.lineCap = 'butt';
    g.lineWidth = R * 0.07;
    g.strokeStyle = C.raise;
    g.beginPath(); g.arc(cx, cy, R * 0.92, a0, a1); g.stroke();
    const grad = g.createLinearGradient(cx - R, 0, cx + R, 0);
    grad.addColorStop(0, C.violet); grad.addColorStop(1, C.hot);
    g.strokeStyle = grad;
    g.beginPath(); g.arc(cx, cy, R * 0.92, ang(red), a1); g.stroke();
    // arco de rotação atual
    g.strokeStyle = tele.limiter ? C.hot : C.gold;
    g.globalAlpha = 0.85;
    g.beginPath(); g.arc(cx, cy, R * 0.92, a0, ang(shownRpm)); g.stroke();
    g.globalAlpha = 1;

    // marcas
    const step = max > 12000 ? 2000 : 1000;
    g.fillStyle = C.muted; g.strokeStyle = C.muted;
    g.font = `600 ${Math.round(R * 0.11)}px ${C.display}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let r = 0; r <= max; r += step / 2) {
      const a = ang(r), major = r % step === 0;
      const r1 = R * (major ? 0.78 : 0.82), r2 = R * 0.86;
      g.lineWidth = major ? 2 : 1;
      g.strokeStyle = r >= red ? C.violet : major ? C.ink : C.faint;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); g.stroke();
      if (major) {
        g.fillStyle = r >= red ? C.violet : C.muted;
        g.fillText(String(r / 1000), cx + Math.cos(a) * R * 0.66, cy + Math.sin(a) * R * 0.66);
      }
    }
    g.font = `500 ${Math.round(R * 0.055)}px ${C.mono}`;
    g.fillStyle = C.faint;
    g.fillText('× 1000 rpm', cx, cy - R * 0.38);

    // turbo
    if (spec.aspiration === 'turbo') {
      const bmax = Math.max(0.5, spec.boost);
      const ba0 = Math.PI * 0.22, ba1 = Math.PI * 0.78;
      g.lineWidth = R * 0.03;
      g.strokeStyle = C.raise;
      g.beginPath(); g.arc(cx, cy, R * 0.58, ba1, ba0, true); g.stroke();
      g.strokeStyle = C.blue;
      g.beginPath(); g.arc(cx, cy, R * 0.58, ba1, ba1 - (ba1 - ba0) * clamp(tele.boost / bmax, 0, 1), true); g.stroke();
      g.font = `500 ${Math.round(R * 0.06)}px ${C.mono}`;
      g.fillStyle = C.blue;
      g.fillText(`+${(tele.boost || 0).toFixed(2)} bar`, cx, cy + R * 0.72);
    }

    // ponteiro
    const an = ang(shownRpm);
    g.strokeStyle = C.ink; g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx - Math.cos(an) * R * 0.08, cy - Math.sin(an) * R * 0.08); g.lineTo(cx + Math.cos(an) * R * 0.86, cy + Math.sin(an) * R * 0.86); g.stroke();
    g.fillStyle = C.ink; g.beginPath(); g.arc(cx, cy, R * 0.035, 0, Math.PI * 2); g.fill();

    // números
    g.fillStyle = tele.limiter ? C.hot : C.ink;
    g.font = `800 ${Math.round(R * 0.3)}px ${C.display}`;
    g.fillText(Math.round(shownRpm / 10) * 10 + '', cx, cy + R * 0.3);
    g.font = `500 ${Math.round(R * 0.06)}px ${C.mono}`;
    g.fillStyle = C.muted;
    const kmh = Math.round(tele.kmh || 0);
    g.fillText(`${kmh} km/h  ·  ${Math.round(tele.torque || 0)} N·m`, cx, cy + R * 0.5);
    const wt = tele.coolant ?? 20;
    g.fillStyle = wt < 60 ? C.blue : wt > 105 ? C.hot : C.muted;
    g.fillText(`água ${Math.round(wt)} °C${tele.fan ? '  ·  ventoinha' : ''}${tele.secAir ? '  ·  bomba de ar' : ''}`, cx, cy + R * 0.62);
    if (tele.limiter) {
      g.fillStyle = C.hot;
      g.font = `600 ${Math.round(R * 0.07)}px ${C.mono}`;
      g.fillText(tele.launch ? '2-STEP' : 'CORTE', cx, cy - R * 0.22);
    } else if (tele.launch) {
      g.fillStyle = C.gold;
      g.font = `600 ${Math.round(R * 0.07)}px ${C.mono}`;
      g.fillText('LARGADA', cx, cy - R * 0.22);
    } else if (tele.state === 'crank') {
      g.fillStyle = C.gold;
      g.font = `600 ${Math.round(R * 0.07)}px ${C.mono}`;
      g.fillText('PARTIDA', cx, cy - R * 0.22);
    }
    const gr = document.getElementById('gearRead');
    if (gr) {
      gr.textContent = tele.gear ? `${spec.transmission === 'auto' ? 'D' : ''}${tele.gear}` : 'N';
      gr.classList.toggle('deny', !!tele.denied);
      gr.title = tele.denied ? 'Redução recusada: o motor passaria da faixa vermelha' : '';
    }
    const vt = document.getElementById('valveTag');
    if (vt) {
      vt.hidden = !(spec.valve && spec.valve !== 'none');
      vt.classList.toggle('on', (tele.valve || 0) > 0.5);
      vt.textContent = (tele.valve || 0) > 0.5 ? 'válvula aberta' : 'válvula fechada';
    }
  }

  // Ciclo de 720° no tempo real do virabrequim: o ângulo vem do motor e é extrapolado
  // entre as leituras. Em giro alto o ponteiro vira borrão, como numa foto com obturador.
  private drawRing(canvas: HTMLCanvasElement, now: number, dt: number) {
    const { C, k, glow } = this, tele = k.tele, engine = k.estado.motor;
    const [g, w, h] = fit(canvas);
    g.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, R = Math.min(w * 0.42, h * 0.37);
    const two = engine.banks === 2;
    const radius = (b: number) => (two ? (b === 0 ? R : R * 0.72) : R * 0.86);
    const running = tele.rpm > 60;
    if (running) {
      const age = Math.min(0.05, Math.max(0, (now - (tele.t || now)) / 1000));
      this.ringPhase = (((tele.theta || 0) + tele.rpm * 6 * age) % 720 + 720) % 720;
      this.ringSweep = Math.min(720, tele.rpm * 6 * dt);
    } else this.ringSweep = 0;
    const ringPhase = this.ringPhase, ringSweep = this.ringSweep;
    const start = (ringPhase - ringSweep + 720) % 720;
    const glowTau = clamp(60 / Math.max(tele.rpm, 1), 0.03, 0.35);
    const toA = (deg: number) => (deg / 720) * Math.PI * 2 - Math.PI / 2;

    // trilhas
    for (let b = 0; b < engine.banks; b++) {
      g.strokeStyle = C.line; g.lineWidth = 1;
      g.beginPath(); g.arc(cx, cy, radius(b), 0, Math.PI * 2); g.stroke();
    }
    // graus
    g.font = `500 10px ${C.mono}`; g.fillStyle = C.faint; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let d = 0; d < 720; d += 90) {
      const a = toA(d);
      g.strokeStyle = C.line;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * R * 1.04, cy + Math.sin(a) * R * 1.04); g.lineTo(cx + Math.cos(a) * R * 1.1, cy + Math.sin(a) * R * 1.1); g.stroke();
      g.fillText(`${d}°`, cx + Math.cos(a) * R * 1.2, cy + Math.sin(a) * R * 1.2);
    }

    // arcos dos intervalos por bancada (onde os pulsos de cada coletor caem)
    for (let b = 0; b < engine.banks; b++) {
      const angs = engine.fire.map((f, c) => [f, c]).filter(([, c]) => engine.bank[c] === b).sort((x, y) => x[0] - y[0]);
      g.strokeStyle = b === 0 ? C.gold : C.blue;
      for (let i = 0; i < angs.length; i++) {
        const fa = angs[i][0], fb = i + 1 < angs.length ? angs[i + 1][0] : angs[0][0] + 720;
        const gap = fb - fa;
        g.globalAlpha = 0.18 + 0.5 * clamp(1 - gap / 720, 0, 1);
        g.lineWidth = 3;
        g.beginPath(); g.arc(cx, cy, radius(b), toA(fa) + 0.05, toA(fb) - 0.05); g.stroke();
      }
      g.globalAlpha = 1;
    }

    // cilindros
    for (let c = 0; c < engine.N; c++) {
      const f = engine.fire[c];
      if (running && ringSweep > 0) {
        const crossed = ringSweep >= 720 || (start <= ringPhase ? f > start && f <= ringPhase : f > start || f <= ringPhase);
        if (crossed) glow[c] = 1;
      }
      glow[c] *= Math.exp(-dt / glowTau);
      const b = engine.bank[c];
      const a = toA(f), r = radius(b);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      const col = b === 0 ? C.gold : C.blue;
      const size = Math.max(9, Math.min(14, R * 0.09));
      if (glow[c] > 0.02) {
        g.fillStyle = col; g.globalAlpha = glow[c] * 0.35;
        g.beginPath(); g.arc(x, y, size * (1.6 + glow[c]), 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1;
      }
      g.fillStyle = glow[c] > 0.5 ? col : C.panel;
      g.strokeStyle = col; g.lineWidth = 1.5;
      g.beginPath(); g.arc(x, y, size, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = glow[c] > 0.5 ? C.bg : C.ink;
      g.font = `500 ${Math.round(size * 0.95)}px ${C.mono}`;
      g.fillText(String(c + 1), x, y + 0.5);
    }

    // virabrequim
    const ha = toA(ringPhase);
    if (ringSweep > 6) {
      // rastro do quadro: o ângulo que o virabrequim percorreu desde o último desenho
      g.fillStyle = C.muted; g.globalAlpha = clamp(12 / ringSweep, 0.05, 0.3);
      g.beginPath(); g.moveTo(cx, cy);
      if (ringSweep >= 720) g.arc(cx, cy, R * 0.98, 0, Math.PI * 2);
      else g.arc(cx, cy, R * 0.98, toA(start), ha);
      g.closePath(); g.fill();
    }
    g.globalAlpha = clamp(40 / Math.max(ringSweep, 1), 0.25, 1);
    g.strokeStyle = C.muted; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(ha) * R * 0.98, cy + Math.sin(ha) * R * 0.98); g.stroke();
    g.globalAlpha = 1;
    g.fillStyle = C.ink;
    g.font = `800 ${Math.round(R * 0.22)}px ${C.display}`;
    g.fillText(`${engine.N}`, cx, cy - R * 0.06);
    g.font = `500 10px ${C.mono}`; g.fillStyle = C.muted;
    g.fillText(engine.N === 1 ? 'cilindro' : 'cilindros', cx, cy + R * 0.13);
    if (R > 110) {
      g.fillStyle = C.faint;
      g.fillText('ciclo de 720° · tempo real', cx, cy + R * 0.27);
    }
  }

  private drawScope(canvas: HTMLCanvasElement) {
    const { C, k } = this, tele = k.tele, engine = k.estado.motor, audio = k.audio;
    const [g, w, h] = fit(canvas);
    g.clearRect(0, 0, w, h);
    const mid = h * 0.32;
    g.strokeStyle = C.line; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, mid); g.lineTo(w, mid); g.stroke();
    g.font = `500 10px ${C.mono}`; g.fillStyle = C.faint; g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText('pressão no ouvido do observador', 10, 8);
    if (!audio) { g.fillText('ligue o motor para ver a onda e o espectro', 10, h - 18); return; }
    const an = audio.analyser;
    if (!this.tBuf) { this.tBuf = new Float32Array(an.fftSize); this.fBuf = new Float32Array(an.frequencyBinCount); }
    const tBuf = this.tBuf, fBuf = this.fBuf!;
    an.getFloatTimeDomainData(tBuf);
    // janela de ~2 ciclos para a onda ficar parada em rotação constante
    const sr = audio.ctx.sampleRate;
    const span = Math.min(tBuf.length, Math.max(256, Math.round(tele.rpm > 100 ? (2 * 120 / tele.rpm) * sr : 2048)));
    g.strokeStyle = C.gold; g.lineWidth = 1.3;
    g.beginPath();
    for (let i = 0; i < span; i++) {
      const x = (i / (span - 1)) * w;
      const y = mid - tBuf[tBuf.length - span + i] * mid * 0.9;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
    // espectro (log)
    an.getFloatFrequencyData(fBuf);
    const top = h * 0.66, bot = h - 4, f0 = 20, f1 = 8000;
    const fx = (f: number) => (Math.log(f / f0) / Math.log(f1 / f0)) * w;
    g.beginPath(); g.moveTo(0, bot);
    for (let x = 0; x <= w; x += 2) {
      const f = f0 * Math.pow(f1 / f0, x / w);
      const bin = Math.round((f / (sr / 2)) * fBuf.length);
      const db = fBuf[Math.min(bin, fBuf.length - 1)];
      const y = bot - clamp((db + 110) / 90, 0, 1) * (bot - top + h * 0.28);
      g.lineTo(x, y);
    }
    g.lineTo(w, bot); g.closePath();
    g.fillStyle = C.blue; g.globalAlpha = 0.22; g.fill(); g.globalAlpha = 1;
    // frequência de ignição
    const ff = (tele.rpm / 60) * (engine.N / 2);
    const ro = document.getElementById('roFreq');
    if (ro) ro.textContent = tele.rpm > 60 ? `${ff.toFixed(0)} Hz · meia-ordem ${(tele.rpm / 120).toFixed(1)} Hz` : '—';
    if (ff > f0 && ff < f1) {
      const x = fx(ff);
      g.strokeStyle = C.gold; g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(x, top - h * 0.28); g.lineTo(x, bot); g.stroke(); g.setLineDash([]);
      g.fillStyle = C.gold; g.textAlign = x > w - 90 ? 'right' : 'left';
      g.fillText(`ignição ${ff.toFixed(0)} Hz`, x + (x > w - 90 ? -6 : 6), top - h * 0.26);
    }
    g.fillStyle = C.faint; g.textAlign = 'right';
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000]) g.fillText(f >= 1000 ? `${f / 1000}k` : String(f), fx(f) - 2, bot - 12);
  }

  // Vista de cima da via: observador embaixo, carro andando da esquerda para a direita.
  private drawPassby() {
    const cv = document.getElementById('passby') as HTMLCanvasElement | null;
    if (!cv) return;
    const { C, k } = this, tele = k.tele, params = k.estado.params;
    const [g, w, h] = fit(cv);
    g.clearRect(0, 0, w, h);
    const span = 120, sx = w / (2 * span);
    const roadY = h * 0.32, obsY = Math.min(h - 12, roadY + 6 + (params.roadDist || 6) * 1.6);
    g.strokeStyle = C.line; g.lineWidth = 10;
    g.beginPath(); g.moveTo(0, roadY); g.lineTo(w, roadY); g.stroke();
    g.strokeStyle = C.faint; g.lineWidth = 1; g.setLineDash([6, 8]);
    g.beginPath(); g.moveTo(0, roadY); g.lineTo(w, roadY); g.stroke(); g.setLineDash([]);
    const ox = w / 2;
    g.fillStyle = C.ink; g.beginPath(); g.arc(ox, obsY, 4, 0, Math.PI * 2); g.fill();
    g.font = `500 10px ${C.mono}`; g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillStyle = C.muted; g.fillText('você', ox, obsY + 6 > h - 12 ? obsY - 18 : obsY + 6);
    const x = tele.carX ?? -12;
    const vis = Math.abs(x) <= span;
    const cx = ox + Math.max(-span, Math.min(span, x)) * sx;
    g.fillStyle = C.gold;
    if (vis) { g.fillRect(cx - 8, roadY - 4, 16, 8); g.fillStyle = C.hot; g.fillRect(cx - 9, roadY - 2, 2, 4); }
    else { g.beginPath(); const dir = x > 0 ? 1 : -1, ex = dir > 0 ? w - 4 : 4; g.moveTo(ex, roadY); g.lineTo(ex - dir * 10, roadY - 6); g.lineTo(ex - dir * 10, roadY + 6); g.fill(); }
    const note = document.getElementById('passNote');
    if (note) {
      const dist = Math.round(tele.dist ?? 0);
      const moving = (tele.kmh || 0) > 2;
      const ratio = 343 / (343 + (tele.vRad || 0));
      const pct = (ratio - 1) * 100;
      note.textContent = moving
        ? `${dist} m · ${pct > 0 ? 'aproximando' : 'afastando'} · Doppler ${pct > 0 ? '+' : ''}${pct.toFixed(1)}% no tom · volta de ${tele.loop} m`
        : `${dist} m de você · carro parado. Engate e acelere para ele passar.`;
    }
  }
}
