// Mostradores da Passagem, em canvas e texto, desenhados no requestAnimationFrame (nada passa pelo React):
//   - nível no ouvido: dB(A) e dB da soma seco + molhado (o que sai para o alto-falante, antes do
//     compressor), na escala absoluta da Cena: 0 dBFS ≙ 124 dB SPL, descontado o `master`;
//   - telemetria: nariz, velocidade, Doppler da fonte escolhida, pressão, vento, onda do túnel;
//   - onda de pressão de nariz/cauda e do túnel (histórico de ~11 s, extremos de cada telemetria);
//   - espectrograma e espectro; osciloscópio.
import type { ControlePassagem } from './controle';
import { fmt } from './controle';
import { ganhoA } from '../../scene/filtros';
import { C_SOM } from '../../scene/constantes';

// cores e fontes do tema, lidas dos tokens de src/ui/estilo.css (os valores abaixo valem até a primeira leitura)
const COR = { ink: '#e9e4d8', muted: '#9aa2b0', faint: '#838c9b', line: '#29313d', gold: '#dca54c', blue: '#7398e6', violet: '#a57ad8', hot: '#ff5b3d', bg: '#0d1015', panel: '#141920', mono: '"IBM Plex Mono", monospace' };
let coresLidas = false;
function lerCores() {
  if (coresLidas || typeof document === 'undefined') return;
  const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  for (const k of ['ink', 'muted', 'faint', 'line', 'gold', 'blue', 'violet', 'hot', 'bg', 'panel'] as const) COR[k] = css(`--${k}`) || COR[k];
  COR.mono = css('--f-mono') || COR.mono;
  coresLidas = true;
}

/** nome de cada tipo de fonte para quem lê (os ids da Cena não têm acento: "pa", "vao", "admissao") */
export const NOME_TIPO: Record<string, string> = {
  escape: 'escape', admissao: 'admissão', mecanica: 'mecânica', compressor: 'compressor', pa: 'pás', rolamento: 'rolamento', aero: 'ar no corpo',
  vao: 'vãos', pantografo: 'pantógrafo', eletrica: 'motor elétrico', pressao: 'pressão', vento: 'vento',
};
/** nome de uma fonte: o tipo por extenso e o que a distingue (truque 3, vão 2, face direita…) */
export function nomeFonte(c: ControlePassagem, id: string) {
  const f = c.fontes.find((x) => x.id === id);
  const resto = id.split('.').slice(1).filter((p) => p !== '0' || id.split('.').length > 2).join('.');
  return `${NOME_TIPO[f?.tipo ?? ''] ?? id.split('.')[0]}${resto ? ` ${resto}` : ''}`;
}

// ------------------------------------------------------------------ nível no ouvido (FFT própria)
/** FFT radix-2 no lugar (re, im) */
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

export class Medidor {
  n = 8192;
  x = new Float32Array(8192); re = new Float32Array(8192); im = new Float32Array(8192);
  w = new Float32Array(8192); a2: Float32Array | null = null; sr = 0; sw2 = 0;
  dBA = -Infinity; dB = -Infinity; maxA = -Infinity; ultimoT = 0;
  constructor() { for (let i = 0; i < this.n; i++) { this.w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.n); this.sw2 += this.w[i] * this.w[i]; } }
  /** mede a última janela do analisador; devolve dB SPL (A e sem ponderação) */
  medir(c: ControlePassagem) {
    const an = c.audio?.medidor; if (!an) return;
    const sr = c.audio!.ctx.sampleRate;
    if (sr !== this.sr) { this.sr = sr; this.a2 = new Float32Array(this.n / 2); for (let k = 0; k < this.n / 2; k++) { const g = ganhoA((k * sr) / this.n); this.a2[k] = g * g; } }
    an.getFloatTimeDomainData(this.x);
    let s = 0;
    for (let i = 0; i < this.n; i++) { this.re[i] = this.x[i] * this.w[i]; this.im[i] = 0; s += this.x[i] * this.x[i]; }
    fft(this.re, this.im);
    let pa = 0;
    for (let k = 1; k < this.n / 2; k++) pa += (this.re[k] * this.re[k] + this.im[k] * this.im[k]) * this.a2![k];
    const msA = (2 * pa) / (this.n * this.sw2), ms = s / this.n;
    const corr = 124 - 20 * Math.log10(Math.max(1e-6, c.master));
    this.dBA = 10 * Math.log10(msA + 1e-20) + corr;
    this.dB = 10 * Math.log10(ms + 1e-20) + corr;
    if (c.andando) this.maxA = Math.max(this.maxA, this.dBA);
  }
  zerarMax() { this.maxA = -Infinity; }
}

// ------------------------------------------------------------------ telemetria em texto
export interface Leituras { [k: string]: HTMLElement }

/** nome do modo do observador */
export const NOME_MODO: Record<string, string> = { pe: 'a pé', voo: 'voando', embarcado: 'embarcado' };

/**
 * Doppler da fonte escolhida (ou da mais próxima): f'/f = (1 + v_O·û/c)/(1 − M·cos θ_e), com θ_e no instante de emissão e
 * û do ouvido para o ponto de emissão (o termo de cima é o de quem anda). Embarcado, o ouvinte anda com as fontes: × 1.
 */
export function dopplerEscolhida(c: ControlePassagem) {
  const t = c.tele; if (!t) return null;
  const F = t.cena.fontes; if (!F.length) return null;
  const id = c.fonteFicha ?? (c.obs.alvo !== 'corpo' ? c.obs.alvo : null);
  let i = id ? F.findIndex((f) => f.id === id) : -1;
  if (i < 0) { i = 0; for (let k = 1; k < F.length; k++) if (F[k].r < F[i].r) i = k; }
  const f = F[i], M = Math.abs(t.portador.v) / C_SOM;
  const junto = c.obs.modo === 'embarcado' && !c.ouvinteFixo;
  let quem = 1;
  if (!junto && !c.ouvinteFixo) {
    const o = t.cena.ouvinte, e = f.posEmitida, r = Math.hypot(e[0] - o[0], e[1] - o[1], e[2] - o[2]) || 1, v = c.obs.velReal;
    quem = 1 + (v[0] * (e[0] - o[0]) + v[1] * (e[1] - o[1]) + v[2] * (e[2] - o[2])) / (r * C_SOM);
  }
  const fator = junto ? 1 : quem / (1 - M * Math.cos((f.thetaEmissao * Math.PI) / 180));
  return { id: f.id, fator, r: f.r, atrasoMs: f.atrasoMs, ganhoDb: f.ganhoDb, junto };
}

/** onde o observador está: o modo, o nome do ponto e a distância ao veículo */
export function textoOnde(c: ControlePassagem, s: number) {
  const o = c.obs, d = c.distanciaAoCorpo(s), nome = o.nome ? ` ${o.nome}` : '';
  const corpo = NOME_CORPO[c.portador] ?? 'veículo';
  if (o.modo === 'embarcado') return `embarcado${nome}${d > 0.2 ? ` · a ${fmt(d, d < 10 ? 1 : 0)} m ${corpo === 'veículo' ? 'dele' : `do ${corpo}`}` : ''}`;
  return `${NOME_MODO[o.modo]}${nome} · a ${fmt(d, d < 10 ? 1 : 0)} m ${artigo(corpo)} · altura ${fmt(o.pos[2], 1)} m`;
}
const NOME_CORPO: Record<string, string> = { trem: 'trem', rotor: 'helicóptero', carro: 'carro', helice: 'avião', gerador: 'gerador', locomotiva: 'locomotiva', aviao: 'avião', trator: 'trator', barco: 'barco', drone: 'drone' };
const artigo = (n: string) => (n === 'locomotiva' ? 'da locomotiva' : `do ${n}`);

export function escreverLeituras(c: ControlePassagem, m: Medidor, l: Leituras, agora: number) {
  const t = c.tele, { s, v } = c.estimativa(agora);
  const xi = c.xiNariz(s), L = c.corpo.comprimento;
  const set = (k: string, txt: string) => { const e = l[k]; if (e && e.textContent !== txt) e.textContent = txt; };
  set('nivel', Number.isFinite(m.dBA) && c.audio ? `${fmt(m.dBA, 1)} dB(A)` : '—');
  set('nivelZ', Number.isFinite(m.dB) && c.audio ? `${fmt(m.dB, 1)} dB · máx ${Number.isFinite(m.maxA) ? fmt(m.maxA, 1) : '—'} dB(A)` : '—');
  set('direto', t ? `${fmt(t.cena.splDbA, 1)} dB(A) sem o eco` : '—');
  set('v', `${fmt(Math.abs(v) * 3.6)} km/h${c.andando ? '' : ' (parado)'}`);
  if (c.obs.modo !== 'embarcado' || c.ouvinteFixo) set('nariz', xi < 0 ? `chegando: faltam ${fmt(-xi)} m` : xi <= L ? `passando: ${fmt(xi)} de ${fmt(L)} m` : `passou: ${fmt(xi - L)} m depois da cauda`);
  else set('nariz', 'você anda junto com o corpo');
  set('onde', textoOnde(c, s));
  const d = dopplerEscolhida(c);
  set('doppler', d ? (d.junto ? '× 1 (você anda junto)' : `× ${fmt(d.fator, 3)} · ${nomeFonte(c, d.id)}`) : '—');
  set('pressao', t ? `${fmt(t.pressao.nariz, 1)} Pa · pico ${fmt(Math.max(Math.abs(t.pressao.max), Math.abs(t.pressao.min)), 1)} Pa` : '—');
  set('tunel', t && c.ambienteCena().tunel ? `${fmt(t.pressao.tunel / 1000, 2)} kPa` : 'sem túnel');
  set('vento', t ? `${fmt(t.cena.ventoMs, 1)} m/s` : '—');
  set('local', `${c.localEfetivo()}${c.portador === 'trem' && t ? ` · face ${t.lado > 0 ? 'esquerda' : 'direita'} do trem` : ''}`);
}

/** HUD sobre a cena: onde você está, o nível no ouvido, o veículo e o Doppler (curto: a cena é a protagonista) */
export function textoHud(c: ControlePassagem, m: Medidor) {
  const t = c.tele;
  const linhas: string[] = [];
  const { s, v } = c.estimativa();
  linhas.push(`${textoOnde(c, s)}`);
  linhas.push(`${Number.isFinite(m.dBA) && c.audio ? fmt(m.dBA, 1) : '—'} dB(A) no ouvido · ${NOME_CORPO[c.portador] ?? 'veículo'} a ${fmt(Math.abs(v) * 3.6)} km/h`);
  if (t) {
    const d = dopplerEscolhida(c);
    if (d && !d.junto && Math.abs(v) > 0.5) linhas.push(`Doppler × ${fmt(d.fator, 3)} · vento ${fmt(t.cena.ventoMs, 1)} m/s`);
  }
  return linhas.join('\n');
}

// ------------------------------------------------------------------ canvas
function preparar(cv: HTMLCanvasElement) {
  const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const g = cv.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, W: r.width, H: r.height };
}

/** onda de pressão: extremos de cada telemetria (21 ms), nariz/cauda e túnel */
export function desenharPressao(c: ControlePassagem, cv: HTMLCanvasElement) {
  lerCores();
  const { g, W, H } = preparar(cv);
  g.fillStyle = COR.panel; g.fillRect(0, 0, W, H);
  const h = c.histP, n = c.nHist, k0 = h.k;
  let am = 5;
  for (let i = 0; i < n; i++) am = Math.max(am, Math.abs(h.max[i]), Math.abs(h.min[i]));
  const esc = Math.pow(10, Math.ceil(Math.log10(am) * 3) / 3);
  const y = (p: number) => H / 2 - (p / esc) * (H / 2 - 14);
  g.strokeStyle = COR.line; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
  const trilha = (arr: Float32Array, cor: string) => {
    g.strokeStyle = cor; g.lineWidth = 1.3; g.beginPath();
    for (let i = 0; i < n; i++) { const v = arr[(k0 + i) % n]; const x = (i / (n - 1)) * W; if (i) g.lineTo(x, y(v)); else g.moveTo(x, y(v)); }
    g.stroke();
  };
  // envelope dos extremos
  g.fillStyle = 'rgba(165,122,216,0.25)';
  for (let i = 0; i < n; i++) { const j = (k0 + i) % n, x = (i / (n - 1)) * W; g.fillRect(x, y(h.max[j]), Math.max(1, W / n), Math.max(1, y(h.min[j]) - y(h.max[j]))); }
  trilha(h.tunel, COR.blue); trilha(h.nariz, COR.violet);
  g.font = `500 10px ${COR.mono}`; g.textBaseline = 'alphabetic';
  g.fillStyle = COR.muted; g.textAlign = 'left';
  g.fillText(`±${esc >= 1000 ? fmt(esc / 1000, 1) + ' kPa' : fmt(esc) + ' Pa'} · 11 s`, 6, 12);
  // legenda das duas curvas, embaixo à direita (fora do caminho do traço, que anda perto do zero)
  g.textAlign = 'right';
  g.fillStyle = COR.blue; g.fillText('túnel', W - 6, H - 5);
  g.fillStyle = COR.violet; g.fillText('nariz e cauda', W - 6 - g.measureText('túnel').width - 12, H - 5);
  g.textAlign = 'left';
}

/** espectrograma (rolando) e espectro do analisador da saída */
export class Espectro {
  buf: Float32Array<ArrayBuffer> | null = null; img: ImageData | null = null; off: HTMLCanvasElement | null = null;
  desenhar(c: ControlePassagem, cv: HTMLCanvasElement) {
    lerCores();
    const { g, W, H } = preparar(cv);
    g.fillStyle = COR.panel; g.fillRect(0, 0, W, H);
    const an = c.audio?.analyser;
    if (!an) { g.fillStyle = COR.muted; g.font = `500 10px ${COR.mono}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('dispare a passagem para ver', W / 2, H / 2); g.textAlign = 'left'; g.textBaseline = 'alphabetic'; return; }
    if (!this.buf || this.buf.length !== an.frequencyBinCount) this.buf = new Float32Array(an.frequencyBinCount);
    an.getFloatFrequencyData(this.buf);
    const sr = c.audio!.ctx.sampleRate, nb = this.buf.length;
    const hE = Math.round(H * 0.62), hS = H - hE;
    // espectrograma: um canvas fora da tela que rola uma coluna por quadro (eixo log 30 Hz–16 kHz)
    const ow = 320, oh = 128;
    if (!this.off) { this.off = document.createElement('canvas'); this.off.width = ow; this.off.height = oh; }
    const og = this.off.getContext('2d')!;
    og.drawImage(this.off, -1, 0);
    const col = og.createImageData(1, oh);
    const fl = Math.log(30), fh = Math.log(16000);
    for (let yy = 0; yy < oh; yy++) {
      const f = Math.exp(fh - ((fh - fl) * yy) / (oh - 1)), b = Math.min(nb - 1, Math.round((f * 2 * nb) / sr));
      const db = this.buf[b], u = Math.max(0, Math.min(1, (db + 110) / 90));
      col.data[yy * 4] = 30 + 225 * Math.pow(u, 1.4); col.data[yy * 4 + 1] = 20 + 170 * Math.pow(u, 2.2); col.data[yy * 4 + 2] = 60 + 120 * u * (1 - u) * 2; col.data[yy * 4 + 3] = 255;
    }
    og.putImageData(col, ow - 1, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.off, 0, 0, W, hE);
    // espectro
    g.strokeStyle = COR.gold; g.lineWidth = 1.2; g.beginPath();
    for (let x = 0; x < W; x++) {
      const f = Math.exp(fl + ((fh - fl) * x) / (W - 1)), b = Math.min(nb - 1, Math.round((f * 2 * nb) / sr));
      const db = this.buf[b], yy = hE + hS - Math.max(0, Math.min(1, (db + 110) / 90)) * hS;
      if (x) g.lineTo(x, yy); else g.moveTo(x, yy);
    }
    g.stroke();
    g.fillStyle = COR.muted; g.font = `500 10px ${COR.mono}`;
    for (const f of [100, 1000, 10000]) { const x = ((Math.log(f) - fl) / (fh - fl)) * W; g.textAlign = x > W - 30 ? 'right' : 'left'; g.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x + (x > W - 30 ? -3 : 2), H - 3); g.fillRect(x, hE, 1, 4); }
    g.textAlign = 'left';
  }
}

/** osciloscópio: a saída (L) */
export class Osciloscopio {
  buf: Float32Array<ArrayBuffer> | null = null;
  desenhar(c: ControlePassagem, cv: HTMLCanvasElement) {
    lerCores();
    const { g, W, H } = preparar(cv);
    g.fillStyle = COR.panel; g.fillRect(0, 0, W, H);
    g.strokeStyle = COR.line; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    const an = c.audio?.analyser;
    if (!an) { g.fillStyle = COR.muted; g.font = `500 10px ${COR.mono}`; g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText('dispare a passagem para ver', W / 2, H / 2 - 6); g.textAlign = 'left'; g.textBaseline = 'alphabetic'; return; }
    if (!this.buf || this.buf.length !== an.fftSize) this.buf = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(this.buf);
    let pk = 0, ms = 0;
    for (let i = 0; i < this.buf.length; i++) { pk = Math.max(pk, Math.abs(this.buf[i])); ms += this.buf[i] * this.buf[i]; }
    const esc = Math.max(0.05, pk) * 1.1;
    g.strokeStyle = COR.ink; g.lineWidth = 1; g.beginPath();
    const n = Math.min(this.buf.length, 2048);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * W, yy = H / 2 - (this.buf[i] / esc) * (H / 2 - 4); if (i) g.lineTo(x, yy); else g.moveTo(x, yy); }
    g.stroke();
    const rms = 10 * Math.log10(ms / this.buf.length + 1e-20);
    cv.dataset.rms = rms.toFixed(1);
    g.fillStyle = COR.muted; g.font = `500 10px ${COR.mono}`;
    g.fillText(`pico ${fmt(20 * Math.log10(pk + 1e-9), 1)} dBFS · ${(n / (c.audio!.ctx.sampleRate / 1000)).toFixed(0)} ms`, 6, 12);
  }
}
