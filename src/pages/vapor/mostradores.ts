// Mostradores da página do Vapor (docs/VAPOR.md 6), desenhados no requestAnimationFrame fora do React, lendo a
// telemetria guardada em `ControleVapor.tele`:
//   - manômetro redondo: pressão da caldeira (bar e psi), zona vermelha a partir de p_nom + 0,3 (abertura da segurança),
//     ponteiro secundário na caixa de válvulas;
//   - fita de escapes: uma luz por escape da volta (4 nos 2 cilindros, 6 no A4 e no Shay, 4 + 4 em duas fileiras na
//     articulada, cada fileira pela fase do seu motor), acesa na batida;
//   - leituras em texto (velocidade, roda, corte, chuffs/s, release, esforço × adesão, estados, apito, nível no ouvido).
import type { ControleVapor } from './controle';
import { fmt } from './controle';

const TAU = Math.PI * 2;
const cor = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#ccc';

export interface Leituras { [id: string]: HTMLElement }

function prepararCanvas(cv: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}

/** manômetro: 0 … 1,35·p_nom, arco de 270° */
export function desenharManometro(c: ControleVapor, cv: HTMLCanvasElement) {
  const { g, w, h } = prepararCanvas(cv);
  const P = c.P, pMax = Math.ceil((P.pNominal * 1.35) / 2) * 2;
  const cx = w / 2, cy = h / 2 + 6, R = Math.min(w, h) / 2 - 12;
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, ang = (p: number) => a0 + (a1 - a0) * Math.min(1.02, Math.max(0, p / pMax));
  const ink = cor('--ink'), muted = cor('--muted'), hot = cor('--hot') || '#e5533c', gold = cor('--gold') || '#d9a441';
  g.lineWidth = 2; g.strokeStyle = muted;
  g.beginPath(); g.arc(cx, cy, R, a0, a1); g.stroke();
  // zona vermelha: a segurança abre em p_nom + 0,3
  g.lineWidth = 6; g.strokeStyle = hot;
  g.beginPath(); g.arc(cx, cy, R - 4, ang(P.pNominal + 0.3), a1); g.stroke();
  // marcas a cada 2 bar
  g.fillStyle = muted; g.font = '10px "IBM Plex Mono", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 1.5; g.strokeStyle = muted;
  for (let p = 0; p <= pMax; p += 2) {
    const a = ang(p), x = Math.cos(a), y = Math.sin(a);
    g.beginPath(); g.moveTo(cx + x * (R - 10), cy + y * (R - 10)); g.lineTo(cx + x * R, cy + y * R); g.stroke();
    if (p % 4 === 0) g.fillText(String(p), cx + x * (R - 22), cy + y * (R - 22));
  }
  const m = c.tele?.motor;
  const pc = m ? m.pCaldeira : P.pNominal, pch = m ? m.pChest : 0;
  const ponteiro = (p: number, comp: number, larg: number, cc: string) => {
    const a = ang(p);
    g.strokeStyle = cc; g.lineWidth = larg; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * comp, cy + Math.sin(a) * comp); g.stroke();
  };
  ponteiro(pch, R * 0.62, 2, gold);
  ponteiro(pc, R * 0.86, 3, ink);
  g.fillStyle = ink; g.beginPath(); g.arc(cx, cy, 4, 0, TAU); g.fill();
  g.font = '600 15px "IBM Plex Mono", monospace'; g.fillStyle = ink;
  g.fillText(`${fmt(pc, 1)} bar`, cx, cy + R * 0.42);
  g.font = '11px "IBM Plex Mono", monospace'; g.fillStyle = muted;
  g.fillText(`${fmt(pc * 14.5038)} psi · caixa ${fmt(pch, 1)}`, cx, cy + R * 0.42 + 16);
}

/** fita de escapes: as luzes acendem quando a fase da manivela passa pela batida */
export function desenharFita(c: ControleVapor, cv: HTMLCanvasElement) {
  const { g, w, h } = prepararCanvas(cv);
  const m = c.tele?.motor;
  const nM = (m?.motores as number) ?? (c.P.motores ?? 1);
  const n = Math.max(1, Math.round(c.escapesPorMotor()));
  const th = (m?.theta as number[]) ?? [];
  const tempo = c.tele ? (performance.now() - c.tele.t) / 1000 : 0;
  const w0 = m ? ((m.voltasPorS as number) || 0) * TAU * (c.P.reducao ?? 1) : 0;
  const gold = cor('--gold') || '#d9a441', line = cor('--line') || '#333';
  const lado = Math.min((w - 20) / n - 6, (h - 10) / nM - 8, 22);
  for (let k = 0; k < nM; k++) {
    // fase atual estimada entre telemetrias (a roda gira com ω)
    const fase = (((th[k] ?? 0) + w0 * tempo) % TAU + TAU) % TAU;
    const ativa = Math.floor((fase / TAU) * n) % n, frac = ((fase / TAU) * n) % 1;
    for (let j = 0; j < n; j++) {
      const x = 10 + j * ((w - 20) / n) + ((w - 20) / n - lado) / 2, y = 5 + k * ((h - 10) / nM) + ((h - 10) / nM - lado) / 2;
      const brilho = j === ativa && m && Math.abs(m.chuffsPorS) > 0.05 ? Math.max(0.25, 1 - frac) : 0;
      g.fillStyle = brilho > 0 ? gold : line; g.globalAlpha = brilho > 0 ? brilho : 1;
      g.beginPath(); g.arc(x + lado / 2, y + lado / 2, lado / 2, 0, TAU); g.fill();
      g.globalAlpha = 1;
    }
  }
}

/** pico do analisador (dB SPL na escala absoluta: 0 dBFS ≙ 124 dB, menos o master) */
export class MedidorPico {
  x = new Float32Array(4096); pico = -Infinity; t = 0;
  medir(c: ControleVapor) {
    const an = c.audio?.medidor; if (!an) return -Infinity;
    if (this.x.length !== an.fftSize) this.x = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(this.x);
    let p = 0; for (let i = 0; i < this.x.length; i++) { const v = Math.abs(this.x[i]); if (v > p) p = v; }
    const db = 20 * Math.log10(p + 1e-9) + 124 - 20 * Math.log10(Math.max(1e-6, c.estado.master));
    const agora = performance.now();
    // segura o pico por 1,5 s e cai depois
    if (db >= this.pico || agora - this.t > 1500) { this.pico = db; this.t = agora; }
    return this.pico;
  }
}

const cents = (r: number) => 1200 * Math.log2(Math.max(1e-6, r));
const sim = (b: unknown) => (b ? 'sim' : '—');

/** leituras em texto (só escreve no DOM quando muda) */
export function escreverLeituras(c: ControleVapor, L: Leituras, pico: number) {
  const m = c.tele?.motor, p = c.tele?.portador, ce = c.tele?.cena;
  const set = (id: string, t: string) => { const e = L[id]; if (e && e.textContent !== t) e.textContent = t; };
  const v = p ? Math.abs(p.v) * 3.6 : 0;
  set('v', `${fmt(v, 1)} km/h`);
  if (!m) {
    set('roda', p ? `${fmt(p.rpmEixo)} rpm` : '—');
    // (o portador gerador não repassa a telemetria do motor: na estacionária só a rotação do eixo)
    set('corte', c.audio && p ? 'governador de esferas (o portador não repassa a telemetria do motor)' : '—');
    for (const id of ['chuffs', 'release', 'esforco', 'estados', 'vapor', 'apito']) set(id, '—');
  } else {
    set('roda', `${fmt(m.rpm)} rpm · ${fmt(m.voltasPorS as number, 2)} voltas/s`);
    const sentido = (m.reverser as number) < -0.02 ? 'ré' : 'frente';
    set('corte', `${fmt(m.corte * 100)}% · ${sentido} · regulador ${fmt((m.regulador as number) * 100)}%`);
    set('chuffs', `${fmt(m.chuffsPorS, 1)} /s`);
    set('release', `${fmt(m.pRelease, 1)} bar abs · ${m.engasgado ? 'engasgado' : 'subsônico'}`);
    const fr = m.adesao > 0 ? Math.min(1.2, Math.abs(m.esforco) / m.adesao) : 0;
    set('esforco', `${fmt(Math.abs(m.esforco) / 1000)} / ${fmt(m.adesao / 1000)} kN${m.patinando ? ' · PATINANDO' : ''}`);
    const barra = L['barraEsforco'];
    if (barra) { barra.style.width = `${Math.round((fr / 1.2) * 100)}%`; barra.classList.toggle('patina', !!m.patinando); }
    set('estados', `segurança ${sim(m.seguranca)} · injetor ${sim(m.injetor)} · bomba ${sim(m.bombaAr)} · torneiras ${sim(m.torneiras)} · soprador ${sim(m.soprador)} · fogo ${fmt((m.fogo as number) * 100)}%`);
    set('vapor', `evaporação ${fmt(m.evaporacao, 2)} · consumo ${fmt(m.vapor, 2)} kg/s · água ${fmt((m.nivelAgua as number) * 100)}%`);
    const f = (m.fApito || []).filter((x: number) => x > 0);
    set('apito', f.length ? `${f.map((x: number) => fmt(x)).join(' · ')} Hz · ${fmt(cents(m.aquecimentoApito as number))} cents` : `mudo · tubo ${fmt(cents(m.aquecimentoApito as number))} cents`);
  }
  set('nivel', ce ? `${fmt(ce.splDbA, 1)} dB(A)` : '—');
  set('pico', Number.isFinite(pico) ? `pico ${fmt(pico, 1)} dB` : '—');
}
