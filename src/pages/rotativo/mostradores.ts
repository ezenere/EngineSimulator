// Mostradores da página Rotativos (ROTATIVO.md 7), desenhados em canvas a cada quadro, fora do React:
//  - conta-giros, onda e espectro e a vista da via: os das páginas a pistão (src/pages/comum/mostradores.ts),
//    alimentados por um controle "de fachada" em que o motor tem 2·eventos por volta (a frequência de ignição do Ronco é
//    N/2 por volta);
//  - o anel do ciclo da câmara com 1 080° (720° no X-Engine): as 3 câmaras do rotor 1 em cores por flanco, as dos outros
//    rotores por dentro, e o eixo excêntrico girando em tempo real;
//  - o traço p–α do último ciclo da câmara 0 (64 pontos da telemetria);
//  - as leituras que mudam a cada quadro: ignição e ordens, gás de escape, pós-queima, estouros/s, turbo secundário,
//    janelas secundárias, pressão de pico; no motor de palhetas, a rotação, a pressão, a passagem de palheta e o hospedeiro.
import type { ControleRotativo } from './controle';
import { clamp } from '../comum/controle';
import { Mostradores, fit } from '../comum/mostradores';
import { escreverLeiturasAv, fumacaDaPartida } from '../comum/Aviacao';

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
        // (palhetas: sem ignição para marcar no espectro, N = 0; e a segunda linha do conta-giros só mostra km/h onde há rodas)
        const m = k.estado.motor, ev = m ? m.eventosPorVolta : 0;
        return { ...k.estado, spec: { ...k.estado.spec, portadores: k.estado.spec.portadores || [] }, motor: { N: 2 * ev, banks: 1, fire: [], bank: [] } };
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
    // (o raio deixa lugar para os graus do lado de fora)
    const cx = w / 2, cy = h / 2, R = Math.max(30, Math.min(w / 2 - 52, h / 2 - 36));
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
      g.fillText(`${z} palhetas · ${Math.round(t.fPalheta || 0).toLocaleString('pt-BR')} Hz`, cx, cy + R + 18);
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
    const sMax = Math.min(14, Math.max(9, R * 0.1)), fora = R + sMax + 3;
    for (let d = 0; d < cyc; d += cyc === 1080 ? 135 : 90) {
      const a = toA(d);
      g.beginPath(); g.moveTo(cx + Math.cos(a) * fora, cy + Math.sin(a) * fora); g.lineTo(cx + Math.cos(a) * (fora + 5), cy + Math.sin(a) * (fora + 5)); g.stroke();
      g.fillText(`${d}°`, cx + Math.cos(a) * (fora + 22), cy + Math.sin(a) * (fora + 13));
    }
    // câmaras: as do rotor 1 por fora, em cores por flanco; as dos outros rotores por dentro
    const cores = [C.gold, C.blue, C.violet];
    m.fire.forEach((f, c) => {
      const rot = m.bank[c], flanco = m.tipo === 'x' ? c : c % 3, r = rot === 0 ? R : R * 0.72;
      // aceso logo depois da ignição dela (a frente do eixo passou por ela há menos de 60°)
      const desde = (((this.fase - f) % cyc) + cyc) % cyc, aceso = rodando && desde < 60 ? 1 - desde / 60 : 0;
      const a = toA(f), x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r, s = rot === 0 ? sMax : Math.max(5, sMax * 0.62);
      if (aceso > 0) { g.globalAlpha = 0.35 * aceso; g.fillStyle = cores[flanco]; g.beginPath(); g.arc(x, y, s * (1.8 + aceso), 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; }
      g.fillStyle = aceso > 0.5 ? cores[flanco] : C.panel; g.strokeStyle = cores[flanco]; g.lineWidth = 1.5;
      g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill(); g.stroke();
      if (rot === 0) { g.fillStyle = aceso > 0.5 ? C.bg : C.ink; g.font = `500 ${Math.round(s * 0.95)}px ${C.mono}`; g.fillText(String(flanco + 1), x, y + 0.5); }
    });
    // eixo excêntrico
    const ha = toA(this.fase);
    // (o ponteiro do eixo sai de fora do miolo, para não riscar o texto do centro)
    const miolo = Math.max(14, Math.min(R * 0.42, (m.rotores > 1 ? R * 0.72 : R) - sMax - 6));
    g.strokeStyle = C.muted; g.lineWidth = 1.5; g.globalAlpha = clamp(40 / Math.max(1, (t.rpm || 0) * 6 * dt), 0.25, 1);
    g.beginPath(); g.moveTo(cx + Math.cos(ha) * miolo, cy + Math.sin(ha) * miolo); g.lineTo(cx + Math.cos(ha) * R * 0.98, cy + Math.sin(ha) * R * 0.98); g.stroke(); g.globalAlpha = 1;
    const fn = Math.round(clamp(miolo * 0.7, 13, 36)), comNome = miolo >= 30;
    g.fillStyle = C.ink; g.font = `800 ${fn}px ${C.display}`;
    g.fillText(m.tipo === 'x' ? 'X' : `${m.rotores} × 3`, cx, comNome ? cy - 6 : cy + 1);
    if (comNome) { g.font = `500 10px ${C.mono}`; g.fillStyle = C.muted; g.fillText('câmaras', cx, cy + fn * 0.5 + 2); }
  }

  private desenharPAlfa(cv: HTMLCanvasElement) {
    const { C, k } = this, t = k.tele, tr: number[] | undefined = t.traco;
    const [g, w, h] = fit(cv);
    g.clearRect(0, 0, w, h);
    g.font = `500 10px ${C.mono}`; g.fillStyle = C.faint; g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText('pressão na câmara 1', 6, 5);
    if (!tr || !k.estado.motor || !(t.rpm > 30)) {
      g.fillStyle = C.muted; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('sem leitura: motor parado', w / 2, h / 2 + 6);
      return;
    }
    const pmax = Math.max(5, ...tr), cyc = k.estado.motor.cyc;
    g.strokeStyle = C.gold; g.lineWidth = 1.4; g.beginPath();
    tr.forEach((p, i) => { const x = 4 + ((w - 8) * i) / (tr.length - 1), y = h - 16 - ((h - 36) * p) / pmax; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
    g.fillStyle = C.muted; g.textAlign = 'right'; g.fillText(`${Math.round(pmax).toLocaleString('pt-BR')} bar`, w - 6, 5);
    g.fillStyle = C.faint; g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillText(`0°`, 4, h - 2); g.textAlign = 'right'; g.fillText(`${cyc}°`, w - 4, h - 2);
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
    set('roFumaca', fumacaDaPartida(t.fumaca));
  }
}
