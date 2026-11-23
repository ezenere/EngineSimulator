// Onda e espectro do som que chega ao ouvinte: o instrumento das páginas de motor (a caixa `.scope-wrap` com o canvas
// `#scope`, em src/ui/estilo.css), no mesmo desenho do Ronco e da Turbina. Em cima, a forma de onda: traço dourado em
// volta da linha do zero. Embaixo, o espectro em escala logarítmica (de 20 Hz a `f1`), preenchido em azul, com as
// frequências marcadas; os marcadores das fontes (nome e frequência) em traço tracejado, cada rótulo na primeira fila em
// que não encosta nos outros. As legendas têm fundo, para o traço não passar por cima das letras; sem áudio, o aviso fica
// centrado. Lê o AnalyserNode da saída da cadeia de áudio (src/ui/audio).
//
// As páginas a pistão (Ronco, Diesel, Radial e Rotativos) e a Turbina ainda desenham cada uma a sua cópia deste quadro
// (src/pages/comum/mostradores.ts, src/pages/turbina/desenho.ts), com o marcador próprio de cada família; esta é a peça
// comum, usada pelo Vapor, para onde as outras podem ir (o desenho delas difere em detalhes: traço, filas dos rótulos,
// a marca de 10 kHz).

export type MarcaEspectro = { f: number; rotulo: string; cor?: 'gold' | 'violet' | 'hot' | 'blue' };
export type OpcoesOnda = {
  /** aviso do estado vazio (ainda sem áudio), centrado na parte do espectro */
  vazio: string;
  /** legenda da onda, no canto de cima */
  legenda?: string;
  /** amostras mostradas na onda (padrão: a janela inteira do analisador) */
  amostras?: number;
  /** escala da onda: 'fixa' (0 dBFS no alto, para as páginas com ganho de saída: Ronco, Turbina) ou 'pico' (o pico da
   *  janela no alto, com piso em −26 dBFS e a leitura do pico no canto, como o osciloscópio da Passagem: para a cadeia de
   *  escala absoluta, em que 85 dB(A) no ouvido ficam em −40 dBFS e a onda fixa seria uma reta) */
  escala?: 'fixa' | 'pico';
  /** fim do eixo do espectro, em Hz (o começo é 20 Hz) */
  f1?: number;
  /** marcadores das fontes no espectro */
  marcas?: MarcaEspectro[];
};

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const inteiro = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

function caber(cv: HTMLCanvasElement): [CanvasRenderingContext2D, number, number] {
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const g = cv.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [g, r.width, r.height];
}

export class OndaEEspectro {
  private tBuf: Float32Array<ArrayBuffer> | null = null;
  private fBuf: Float32Array<ArrayBuffer> | null = null;
  private C: Record<string, string> | null = null;

  /** cores e fontes dos tokens do tema (lidas no primeiro quadro; de novo quando as fontes chegam) */
  lerCores() {
    const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const C: Record<string, string> = {};
    for (const k of ['panel', 'line', 'ink', 'muted', 'faint', 'gold', 'blue', 'violet', 'hot']) C[k] = css(`--${k}`);
    C.mono = css('--f-mono');
    this.C = C;
  }

  desenhar(cv: HTMLCanvasElement, an: AnalyserNode | null | undefined, sr: number, o: OpcoesOnda) {
    if (!this.C) { this.lerCores(); if (document.fonts) document.fonts.ready.then(() => this.lerCores()); }
    const C = this.C!;
    const [g, w, h] = caber(cv);
    g.clearRect(0, 0, w, h);
    const mid = h * 0.32;
    g.strokeStyle = C.line; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, mid); g.lineTo(w, mid); g.stroke();
    g.font = `500 10px ${C.mono}`; g.textAlign = 'left'; g.textBaseline = 'top';
    const legenda = (t: string, x: number, y: number, cor: string) => {
      const lw = g.measureText(t).width, x0 = g.textAlign === 'right' ? x - lw : x;
      g.fillStyle = C.panel; g.globalAlpha = 0.82; g.fillRect(x0 - 3, y - 2, lw + 6, 14); g.globalAlpha = 1;
      g.fillStyle = cor; g.fillText(t, x, y);
    };
    const titulo = o.legenda ?? 'pressão no ouvido do observador';
    if (!an) {
      legenda(titulo, 10, 8, C.faint);
      g.fillStyle = C.muted; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(o.vazio, w / 2, h * 0.66);
      g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      return;
    }
    if (!this.tBuf || this.tBuf.length !== an.fftSize) { this.tBuf = new Float32Array(an.fftSize); this.fBuf = new Float32Array(an.frequencyBinCount); }
    const tBuf = this.tBuf, fBuf = this.fBuf!;
    an.getFloatTimeDomainData(tBuf);
    // onda: as últimas `amostras` da janela
    const span = Math.min(tBuf.length, Math.max(256, o.amostras ?? tBuf.length));
    let pk = 0;
    for (let i = tBuf.length - span; i < tBuf.length; i++) pk = Math.max(pk, Math.abs(tBuf[i]));
    const esc = o.escala === 'pico' ? Math.max(0.05, pk) * 1.1 : 1;
    g.strokeStyle = C.gold; g.lineWidth = 1.2;
    g.beginPath();
    let s2 = 0;
    for (let i = 0; i < span; i++) {
      const v = tBuf[tBuf.length - span + i];
      s2 += v * v;
      const x = (i / (span - 1)) * w, y = mid - (v / esc) * mid * 0.9;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
    // (para os testes de navegador: o nível RMS da janela mostrada, em dBFS)
    cv.dataset.rms = (10 * Math.log10(s2 / span + 1e-20)).toFixed(1);
    // espectro (log)
    an.getFloatFrequencyData(fBuf);
    const top = h * 0.66, bot = h - 4, f0 = 20, f1 = o.f1 ?? 16000;
    const fx = (f: number) => (Math.log(f / f0) / Math.log(f1 / f0)) * w;
    g.beginPath(); g.moveTo(0, bot);
    for (let x = 0; x <= w; x += 2) {
      const f = f0 * Math.pow(f1 / f0, x / w);
      const bin = Math.round((f / (sr / 2)) * fBuf.length);
      const db = fBuf[Math.min(bin, fBuf.length - 1)];
      g.lineTo(x, bot - clamp((db + 110) / 90, 0, 1) * (bot - top + h * 0.28));
    }
    g.lineTo(w, bot); g.closePath();
    g.fillStyle = C.blue; g.globalAlpha = 0.22; g.fill(); g.globalAlpha = 1;
    // marcadores: cada rótulo na primeira fila em que não encosta nos que já estão lá (à direita do traço; perto da
    // borda, à esquerda)
    const filas: [number, number][][] = [[], [], [], []];
    for (const m of [...(o.marcas ?? [])].sort((a, b) => a.f - b.f)) {
      if (!(m.f > f0 && m.f < f1)) continue;
      const x = fx(m.f), texto = `${m.rotulo ? `${m.rotulo} ` : ''}${inteiro.format(m.f)} Hz`, lw = g.measureText(texto).width;
      const esq = x + 6 + lw > w - 4;
      const a = esq ? x - 6 - lw : x + 6, b = a + lw;
      let fila = filas.findIndex((f) => f.every(([p, q]) => b + 8 < p || a - 8 > q));
      if (fila < 0) fila = filas.length - 1;
      filas[fila].push([a, b]);
      const y = top - h * 0.26 + fila * 14, cor = C[m.cor ?? 'gold'];
      g.strokeStyle = cor; g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x, bot); g.stroke(); g.setLineDash([]);
      g.textAlign = 'left';
      legenda(texto, a, y, cor);
    }
    g.fillStyle = C.faint; g.textAlign = 'right';
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) if (f < f1 && fx(f) > 24) g.fillText(f >= 1000 ? `${f / 1000}k` : String(f), fx(f) - 2, bot - 12);
    g.textAlign = 'left';
    legenda(titulo, 10, 8, C.faint);
    if (o.escala === 'pico') {
      g.textAlign = 'right';
      legenda(`pico ${(20 * Math.log10(pk + 1e-9)).toFixed(1).replace('.', ',').replace('-', '−')} dBFS`, w - 10, 8, C.faint);
      g.textAlign = 'left';
    }
    g.textBaseline = 'alphabetic';
  }
}
