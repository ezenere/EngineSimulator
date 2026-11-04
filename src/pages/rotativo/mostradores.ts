// Mostradores da página Rotativos (ROTATIVO.md 7), desenhados em canvas a cada quadro, fora do React:
//  - conta-giros, onda e espectro e a vista da via: os do Ronco (src/pages/ronco/mostradores.ts), alimentados por um
//    controle "de fachada" em que o motor tem 2·eventos por volta (a frequência de ignição do Ronco é N/2 por volta);
//  - o anel do ciclo da câmara com 1 080° (720° no X-Engine): as 3 câmaras do rotor 1 em cores por flanco, as dos outros
//    rotores por dentro, e o eixo excêntrico girando em tempo real;
//  - o traço p–α do último ciclo da câmara 0 (64 pontos da telemetria);
//  - as leituras que mudam a cada quadro: ignição e ordens, gás de escape, pós-queima, estouros/s, turbo secundário,
//    janelas secundárias, pressão de pico; no motor de palhetas, a rotação, a pressão, a passagem de palheta e o hospedeiro.
import type { ControleRotativo } from './controle';
import { Mostradores } from '../ronco/mostradores';
import { escreverLeiturasAv } from '../comum/Aviacao';

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

function fit(canvas: HTMLCanvasElement): [CanvasRenderingContext2D, number, number] {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [ctx, r.width, r.height];
}

export class MostradoresRot {
  private ronco: Mostradores;
  private raf = 0; private fase = 0; private ultimo = 0;
  private C: Record<string, string> = {};
  constructor(private k: ControleRotativo) {
    // fachada para os mostradores do Ronco: eventos por volta = rotores (X: 1,5) → "N" = 2·eventos
    const fachada: any = {
      get tele() { return k.tele; }, get audio() { return k.audio; }, get lento() { return k.lento; },
      mudarLento: (p: any) => k.mudarLento(p),
      get estado() {
        const m = k.estado.motor, ev = m ? m.eventosPorVolta : 1;
        return { ...k.estado, motor: { N: 2 * ev, banks: 1, fire: [], bank: [] } };
      },
    };
    this.ronco = new Mostradores(fachada);
  }

  iniciar() {
    this.ronco.iniciar();
    const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    for (const n of ['bg', 'panel', 'line', 'ink', 'muted', 'faint', 'gold', 'blue', 'violet', 'hot']) this.C[n] = css(`--${n}`);
    this.C.mono = css('--f-mono'); this.C.display = css('--f-display');
    const laco = (t: number) => { this.quadro(t); this.raf = requestAnimationFrame(laco); };
    this.raf = requestAnimationFrame(laco);
  }
  parar() { this.ronco.parar(); cancelAnimationFrame(this.raf); }

  private quadro(agora: number) {
    const dt = this.ultimo ? Math.min(0.1, (agora - this.ultimo) / 1000) : 0;
    this.ultimo = agora;
    const t = this.k.tele;
    if (t.aviacao) escreverLeiturasAv(t);
    const anel = document.getElementById('anel') as HTMLCanvasElement | null;
    if (anel) this.desenharAnel(anel, agora, dt);
    const pa = document.getElementById('pAlfa') as HTMLCanvasElement | null;
    if (pa) this.desenharPAlfa(pa);
    this.leituras();
  }

  private desenharAnel(cv: HTMLCanvasElement, agora: number, dt: number) {
    const { C, k } = this, t = k.tele, m = k.estado.motor;
    const [g, w, h] = fit(cv);
    g.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, R = Math.min(w * 0.42, h * 0.38);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (!m) {
      // palhetas: o rotor com as palhetas girando
      const z = t.z || k.spec.palhetas?.ferramenta.z || 8;
      this.fase = (this.fase + ((t.rpm || 0) / 60) * 360 * dt * 0.02) % 360;
      g.strokeStyle = C.line; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(cx + R * 0.12, cy, R * 0.7, 0, Math.PI * 2); g.stroke();
      for (let i = 0; i < z; i++) {
        const a = ((this.fase + (360 * i) / z) * Math.PI) / 180;
        g.strokeStyle = i ? C.gold : C.hot; g.lineWidth = 2;
        g.beginPath(); g.moveTo(cx + R * 0.12 + Math.cos(a) * R * 0.2, cy + Math.sin(a) * R * 0.2); g.lineTo(cx + R * 0.12 + Math.cos(a) * R * 0.86, cy + Math.sin(a) * R * 0.86); g.stroke();
      }
      g.fillStyle = C.muted; g.font = `500 10px ${C.mono}`;
      g.fillText(`${z} palhetas · ${Math.round(t.fPalheta || 0)} Hz`, cx, cy + R * 1.15);
      return;
    }
    const cyc = m.cyc;
    const rodando = (t.rpm || 0) > 30;
    if (rodando) {
      const idade = Math.min(0.05, Math.max(0, (agora - (t.t || agora)) / 1000));
      this.fase = ((((t.theta || 0) + t.rpm * 6 * idade) % cyc) + cyc) % cyc;
    }
    const toA = (d: number) => (d / cyc) * Math.PI * 2 - Math.PI / 2;
    g.strokeStyle = C.line; g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
    if (m.rotores > 1) { g.beginPath(); g.arc(cx, cy, R * 0.72, 0, Math.PI * 2); g.stroke(); }
    g.font = `500 10px ${C.mono}`; g.fillStyle = C.faint;
    for (let d = 0; d < cyc; d += cyc === 1080 ? 135 : 90) {
      const a = toA(d);
      g.beginPath(); g.moveTo(cx + Math.cos(a) * R * 1.04, cy + Math.sin(a) * R * 1.04); g.lineTo(cx + Math.cos(a) * R * 1.1, cy + Math.sin(a) * R * 1.1); g.stroke();
      g.fillText(`${d}°`, cx + Math.cos(a) * R * 1.22, cy + Math.sin(a) * R * 1.22);
    }
    // câmaras: as do rotor 1 por fora, em cores por flanco; as dos outros rotores por dentro
    const cores = [C.gold, C.blue, C.violet];
    m.fire.forEach((f, c) => {
      const rot = m.bank[c], flanco = m.tipo === 'x' ? c : c % 3, r = rot === 0 ? R : R * 0.72;
      // aceso logo depois da ignição dela (a frente do eixo passou por ela há menos de 60°)
      const desde = (((this.fase - f) % cyc) + cyc) % cyc, aceso = rodando && desde < 60 ? 1 - desde / 60 : 0;
      const a = toA(f), x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r, s = rot === 0 ? Math.max(9, R * 0.09) : Math.max(6, R * 0.06);
      if (aceso > 0) { g.globalAlpha = 0.35 * aceso; g.fillStyle = cores[flanco]; g.beginPath(); g.arc(x, y, s * (1.8 + aceso), 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; }
      g.fillStyle = aceso > 0.5 ? cores[flanco] : C.panel; g.strokeStyle = cores[flanco]; g.lineWidth = 1.5;
      g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill(); g.stroke();
      if (rot === 0) { g.fillStyle = aceso > 0.5 ? C.bg : C.ink; g.font = `500 ${Math.round(s * 0.95)}px ${C.mono}`; g.fillText(String(flanco + 1), x, y + 0.5); }
    });
    // eixo excêntrico
    const ha = toA(this.fase);
    g.strokeStyle = C.muted; g.lineWidth = 1.5; g.globalAlpha = clamp(40 / Math.max(1, (t.rpm || 0) * 6 * dt), 0.25, 1);
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(ha) * R * 0.98, cy + Math.sin(ha) * R * 0.98); g.stroke(); g.globalAlpha = 1;
    g.fillStyle = C.ink; g.font = `800 ${Math.round(R * 0.2)}px ${C.display}`;
    g.fillText(m.tipo === 'x' ? 'X' : `${m.rotores}×3`, cx, cy - R * 0.06);
    g.font = `500 10px ${C.mono}`; g.fillStyle = C.muted;
    g.fillText(m.tipo === 'x' ? '3 câmaras fixas' : m.rotores === 1 ? 'câmaras · 1 rotor' : `câmaras · ${m.rotores} rotores`, cx, cy + R * 0.13);
    if (R > 100) { g.fillStyle = C.faint; g.fillText(`ciclo de ${cyc}° do eixo · tempo real`, cx, cy + R * 0.27); }
  }

  private desenharPAlfa(cv: HTMLCanvasElement) {
    const { C, k } = this, t = k.tele, tr: number[] | undefined = t.traco;
    const [g, w, h] = fit(cv);
    g.clearRect(0, 0, w, h);
    g.strokeStyle = C.line; g.lineWidth = 1; g.strokeRect(0.5, 0.5, w - 1, h - 1);
    g.font = `500 10px ${C.mono}`; g.fillStyle = C.faint; g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText('p × α da câmara 1', 6, 4);
    if (!tr || !k.estado.motor) return;
    const pmax = Math.max(5, ...tr), cyc = k.estado.motor.cyc;
    g.strokeStyle = C.gold; g.lineWidth = 1.4; g.beginPath();
    tr.forEach((p, i) => { const x = 4 + ((w - 8) * i) / (tr.length - 1), y = h - 4 - ((h - 20) * p) / pmax; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
    g.fillStyle = C.muted; g.textAlign = 'right'; g.fillText(`${pmax.toFixed(0)} bar`, w - 6, 4);
    g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillText(`0°`, 4, h - 2); g.textAlign = 'right'; g.fillText(`${cyc}°`, w - 4, h - 2);
  }

  private leituras() {
    const t = this.k.tele, set = (id: string, v: string) => { const el = document.getElementById(id); if (el && el.textContent !== v) el.textContent = v; };
    const n0 = (x: number) => Math.round(x).toLocaleString('pt-BR');
    const n1 = (x: number) => x.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
    const m = this.k.estado.motor;
    if (t.palhetas) {
      set('roFreqRot', `${n0(t.fPalheta || 0)} Hz (passagem de palheta)`);
      set('roPal', `${n0(t.rpm)} rpm · ${n1(t.pIn || 1)} bar · carga ${n0(100 * (t.carga || 0))}%`);
      set('roHosp', t.modo === 'arranque' ? `${n0(t.rpmHospedeiro || 0)} rpm${t.pegou ? ' · pegou' : t.engatado ? ' · pinhão engatado' : ''}` : '—');
      return;
    }
    if (!m) return;
    const rpm = t.rpm || 0, ev = m.eventosPorVolta;
    set('roFreqRot', rpm > 60 ? `${n0((rpm / 60) * ev)} Hz · ordem 1 ${n1(rpm / 60)} Hz · 1/3 ${n1(rpm / 180)} Hz` : '—');
    if (t.tEscape !== undefined) set('roGas', `${n0(t.tEscape)} °C`);
    if (t.fHC !== undefined) set('roHC', `${n1(100 * t.fHC)}%`);
    if (t.estouros !== undefined) set('roEst', `${n1(t.estouros)}/s`);
    if (t.pPico !== undefined) set('roPico', `${n1(t.pPico)} bar`);
    set('roSeq', t.boostSec ? `secundário ${n0(100 * t.boostSec)}% · ${n1(t.boost || 0)} bar` : '—');
    set('roApv', t.apv && t.apv.length ? t.apv.map((x: number, i: number) => `${i ? 'auxiliar' : 'secundária'} ${x ? 'aberta' : 'fechada'}`).join(' · ') : '—');
    set('roFumaca', t.fumaca > 0.02 ? `fumaça azul ${n0(100 * t.fumaca)}%` : '—');
  }
}
