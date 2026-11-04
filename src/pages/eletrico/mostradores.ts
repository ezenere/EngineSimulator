// Mostradores do Elétrico, em canvas e texto, desenhados no requestAnimationFrame (nada passa pelo React):
//   - nível no ouvido: dB(A) da soma seco + molhado (analisador `medidor`, FFT de 8192 com Hann), na escala absoluta da
//     Cena (0 dBFS ≙ 124 dB SPL, descontado o `master`);
//   - leituras: rpm, v, f_e, f_c e N (ou a nota do do-re-mi no teclado de 12 teclas), corrente/torque com sinal
//     (regeneração em azul), potência, M e fluxo;
//   - espectro de 20 Hz a 12 kHz (eixo log, dB SPL por raia) com as linhas da telemetria anotadas, e o espectrograma
//     rolante de 10 s. Desvio (anotado em docs/TECNICO.md): o espectro é o da saída, depois do ouvinte, não "antes do
//     ouvinte" como pede o ELETRICO.md 6 (o worklet só devolve o estéreo).
import type { ControleEletrico } from './controle';
import { fmt } from './controle';
import { ganhoA } from '../../scene/filtros';

const COR = { ink: '#e9e4d8', muted: '#8b93a1', faint: '#59616e', line: '#29313d', gold: '#dca54c', blue: '#7398e6', violet: '#a57ad8', hot: '#ff5b3d', green: '#7fc28a', panel: '#141920' };

function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k], j = i + k + len / 2;
        const vr = re[j] * cr - im[j] * ci, vi = re[j] * ci + im[j] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[j] = ur - vr; im[j] = ui - vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

/** FFT de 8192 do medidor: dB(A) no ouvido e o espectro em dB SPL por raia (um seno lê o seu nível) */
export class Medidor {
  n = 8192;
  x = new Float32Array(8192); re = new Float32Array(8192); im = new Float32Array(8192);
  w = new Float32Array(8192); a2: Float32Array | null = null; sr = 48000; sw = 0; sw2 = 0;
  /** dB SPL por raia (n/2) */
  esp = new Float32Array(4096).fill(-200);
  dBA = -Infinity; dB = -Infinity;
  constructor() { for (let i = 0; i < this.n; i++) { this.w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.n); this.sw += this.w[i]; this.sw2 += this.w[i] * this.w[i]; } }
  medir(c: ControleEletrico) {
    const an = c.audio?.medidor; if (!an) return false;
    const sr = c.audio!.ctx.sampleRate;
    if (sr !== this.sr || !this.a2) { this.sr = sr; this.a2 = new Float32Array(this.n / 2); for (let k = 0; k < this.n / 2; k++) { const g = ganhoA((k * sr) / this.n); this.a2[k] = g * g; } }
    an.getFloatTimeDomainData(this.x);
    let s = 0;
    for (let i = 0; i < this.n; i++) { this.re[i] = this.x[i] * this.w[i]; this.im[i] = 0; s += this.x[i] * this.x[i]; }
    fft(this.re, this.im);
    const corr = 124 - 20 * Math.log10(Math.max(1e-6, c.master));
    let pa = 0;
    // seno de amplitude A: |X| = A·Σw/2 → A²/2 (potência do seno) = 2|X|²/(Σw)²
    const kTom = 2 / (this.sw * this.sw);
    for (let k = 1; k < this.n / 2; k++) {
      const p = this.re[k] * this.re[k] + this.im[k] * this.im[k];
      pa += p * this.a2![k];
      this.esp[k] = 10 * Math.log10(p * kTom + 1e-20) + corr;
    }
    this.dBA = 10 * Math.log10((2 * pa) / (this.n * this.sw2) + 1e-20) + corr;
    this.dB = 10 * Math.log10(s / this.n + 1e-20) + corr;
    return true;
  }
  /** dB SPL da raia de f */
  em(f: number) { const k = Math.round((f * this.n) / this.sr); return k > 0 && k < this.n / 2 ? this.esp[k] : -200; }
}

function preparar(cv: HTMLCanvasElement) {
  const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const g = cv.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, W: r.width, H: r.height };
}

const F_LO = 20, F_HI = 12000, DB_LO = 0, DB_HI = 110;
const xDeF = (f: number, W: number) => ((Math.log(f) - Math.log(F_LO)) / (Math.log(F_HI) - Math.log(F_LO))) * W;
const fDeX = (x: number, W: number) => Math.exp(Math.log(F_LO) + ((Math.log(F_HI) - Math.log(F_LO)) * x) / W);

/** espectro (20 Hz–12 kHz) com as linhas da telemetria anotadas */
export function desenharEspectro(c: ControleEletrico, m: Medidor, cv: HTMLCanvasElement) {
  const { g, W, H } = preparar(cv);
  g.fillStyle = COR.panel; g.fillRect(0, 0, W, H);
  const y = (db: number) => H - 14 - ((Math.max(DB_LO, Math.min(DB_HI, db)) - DB_LO) / (DB_HI - DB_LO)) * (H - 26);
  g.strokeStyle = COR.line; g.lineWidth = 1;
  for (let d = 20; d <= 100; d += 20) { g.beginPath(); g.moveTo(0, y(d)); g.lineTo(W, y(d)); g.stroke(); }
  g.fillStyle = COR.muted; g.font = '10px "IBM Plex Mono", monospace';
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) { const x = xDeF(f, W); g.fillRect(x, H - 14, 1, 4); g.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x + 2, H - 3); }
  if (!c.audio) { g.fillStyle = COR.faint; g.font = '12px sans-serif'; g.fillText('espectro (ligue o motor)', 10, 20); cv.dataset.anotadas = '0'; return; }
  // curva: o máximo das raias em cada pixel
  g.strokeStyle = COR.gold; g.lineWidth = 1.2; g.beginPath();
  const n = m.n, sr = m.sr;
  for (let x = 0; x < W; x++) {
    const ka = Math.max(1, Math.floor((fDeX(x, W) * n) / sr)), kb = Math.max(ka, Math.floor((fDeX(x + 1, W) * n) / sr));
    let v = -200; for (let k = ka; k <= kb && k < n / 2; k++) v = Math.max(v, m.esp[k]);
    if (x) g.lineTo(x, y(v)); else g.moveTo(x, y(v));
  }
  g.stroke();
  // linhas da telemetria
  const L = c.tele?.portador.linhas ?? [];
  let anot = 0;
  g.font = '10px "IBM Plex Mono", monospace';
  // rótulos em até 4 filas, cada uma guardando onde o último rótulo terminou (sem sobrepor)
  const fim = [-1e9, -1e9, -1e9, -1e9];
  const ord = L.filter((l) => l.f >= F_LO && l.f <= F_HI).sort((a, b) => a.f - b.f);
  for (const l of ord) {
    const x = xDeF(l.f, W), v = m.em(l.f), w = g.measureText(l.id).width + 4;
    let fila = fim.findIndex((e) => e < x);
    const tem = fila >= 0;
    if (!tem) fila = 3;
    const yl = 11 + fila * 11;
    g.strokeStyle = 'rgba(115,152,230,0.55)'; g.beginPath(); g.moveTo(x, yl + 2); g.lineTo(x, y(v)); g.stroke();
    if (tem) { g.fillStyle = COR.blue; g.fillText(l.id, Math.min(W - w, x + 2), yl); fim[fila] = x + 2 + w; }
    anot++;
  }
  cv.dataset.anotadas = String(anot);
  g.fillStyle = COR.muted; g.fillText('dB SPL', W - 44, y(100) - 2);
}

/** espectrograma rolante de 10 s (eixo log 20 Hz–12 kHz) */
export class Espectrograma {
  off: HTMLCanvasElement | null = null; ow = 600; oh = 160; tAnt = 0; resto = 0;
  desenhar(c: ControleEletrico, m: Medidor, cv: HTMLCanvasElement, agora: number, novo: boolean) {
    const { g, W, H } = preparar(cv);
    if (!this.off) { this.off = document.createElement('canvas'); this.off.width = this.ow; this.off.height = this.oh; const og = this.off.getContext('2d')!; og.fillStyle = COR.panel; og.fillRect(0, 0, this.ow, this.oh); this.tAnt = agora; }
    const og = this.off.getContext('2d')!;
    const dt = Math.min(1, (agora - this.tAnt) / 1000); this.tAnt = agora;
    this.resto += (dt / 10) * this.ow;
    let cols = Math.floor(this.resto); this.resto -= cols;
    if (cols > 0 && novo && c.audio) {
      cols = Math.min(cols, this.ow);
      og.drawImage(this.off, -cols, 0);
      const col = og.createImageData(1, this.oh), n = m.n, sr = m.sr;
      for (let yy = 0; yy < this.oh; yy++) {
        const fa = fDeX(((this.oh - 1 - yy) / this.oh) * 1000, 1000), fb = fDeX(((this.oh - yy) / this.oh) * 1000, 1000);
        const ka = Math.max(1, Math.floor((fa * n) / sr)), kb = Math.max(ka, Math.floor((fb * n) / sr));
        let v = -200; for (let k = ka; k <= kb && k < n / 2; k++) v = Math.max(v, m.esp[k]);
        const u = Math.max(0, Math.min(1, (v - 10) / 85));
        col.data[yy * 4] = 30 + 225 * Math.pow(u, 1.4); col.data[yy * 4 + 1] = 20 + 170 * Math.pow(u, 2.2); col.data[yy * 4 + 2] = 60 + 240 * u * (1 - u); col.data[yy * 4 + 3] = 255;
      }
      for (let k = 0; k < cols; k++) og.putImageData(col, this.ow - 1 - k, 0);
    }
    g.imageSmoothingEnabled = false;
    g.drawImage(this.off, 0, 0, W, H);
    g.fillStyle = COR.muted; g.font = '10px "IBM Plex Mono", monospace';
    for (const f of [100, 1000, 10000]) { const yy = H - xDeF(f, H); g.fillText(f >= 1000 ? `${f / 1000}k` : String(f), 3, yy - 2); g.fillRect(0, yy, 5, 1); }
    g.fillText('10 s', W - 30, H - 4);
  }
}

// ------------------------------------------------------------------ leituras
export interface Leituras { [k: string]: HTMLElement }

const MODO_NOME: Record<string, string> = {
  assincrona: 'assíncrona', escada: 'escada (do-re-mi)', sincrona: 'síncrona', bloco: 'onda quadrada (N = 1)', aleatoria: 'aleatória (random PWM)',
  chopper: 'chopper CC', csi: 'inversor de corrente', desligado: 'sem pulsos', auto: 'auto',
};

export function escreverLeituras(c: ControleEletrico, m: Medidor, l: Leituras) {
  const t = c.tele?.portador;
  const set = (k: string, txt: string) => { const e = l[k]; if (e && e.textContent !== txt) e.textContent = txt; };
  set('nivel', Number.isFinite(m.dBA) && c.audio ? `${fmt(m.dBA, 1)} dB(A)` : '—');
  if (!t) return;
  set('rpm', `${fmt(t.rpm ?? 0)} rpm`);
  set('v', c.tipoPortador === 'bancada' ? 'bancada' : `${fmt(Math.abs(t.v) * 3.6)} km/h`);
  set('fe', `${fmt(t.fE ?? 0, 1)} Hz · f_rot ${fmt(t.fRot ?? 0, 1)} Hz`);
  const modo = t.modo ?? 'desligado';
  const fc = modo === 'sincrona' || modo === 'bloco' ? `${fmt(t.fC ?? 0)} Hz · N ${t.N}` : modo === 'csi' ? `6f_e ${fmt(6 * (t.fE ?? 0))} Hz` : modo === 'desligado' ? '—' : `${fmt(t.fC ?? 0)} Hz`;
  set('fc', c.base.inversor ? fc : 'sem inversor');
  set('modo', c.base.inversor ? `${MODO_NOME[modo] ?? modo}${modo === 'escada' && t.notaNome ? ` · ${t.notaNome}` : ''}${modo === 'chopper' ? ` · D ${fmt(t.D ?? 0, 2)}` : ''}` : c.base.maquina === 'bldc' ? 'ESC 6 passos (não sintetizado)' : 'rede/CC direto');
  const I = (t.corrente ?? 0) * 100, T = t.torque ?? 0;
  set('corrente', `${I >= 0 ? '' : '−'}${fmt(Math.abs(I))}% I_n · ${fmt(T, Math.abs(T) < 10 ? 2 : 0)} N·m`);
  const ec = l.corrente; if (ec) ec.style.color = I < -0.5 ? COR.blue : '';
  const P = (t.potencia ?? 0) / 1000;
  set('potencia', `${fmt(P, Math.abs(P) < 10 ? 2 : 0)} kW`);
  const ep = l.potencia; if (ep) ep.style.color = P < -0.01 ? COR.blue : '';
  set('mfluxo', `M ${fmt(t.M ?? 0, 2)} · Φ ${fmt(t.fluxo ?? 0, 2)}`);
  set('avas', c.base.avas === undefined ? '—' : `${c.avas === 'desligado' ? 'desligado' : c.avas.toUpperCase()}${(t.avas ?? 0) > 0.01 ? ' · tocando' : ''}`);
}

/** teclado do do-re-mi: a tecla da nota atual acesa (índice 0..11; 12 = patamar) */
export function acenderTeclado(c: ControleEletrico, el: HTMLElement | null) {
  if (!el) return;
  const t = c.tele?.portador, nota = t && t.modo === 'escada' ? (t.nota ?? -1) : -1;
  const k = String(nota);
  if (el.dataset.nota === k) return;
  el.dataset.nota = k;
  el.querySelectorAll<HTMLElement>('.tecla').forEach((e, i) => e.classList.toggle('acesa', i === nota));
}
