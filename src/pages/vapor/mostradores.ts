// Mostradores da página do Vapor (docs/VAPOR.md 6), desenhados no requestAnimationFrame fora do React, lendo a
// telemetria guardada em `ControleVapor.tele`:
//   - manômetro redondo: pressão da caldeira (bar e psi), zona vermelha a partir de p_nom + 0,3 (abertura da segurança),
//     ponteiro secundário na caixa de válvulas;
//   - fita de escapes: uma luz por escape da volta (4 nos 2 cilindros, 6 no A4 e no Shay, 4 + 4 em duas fileiras na
//     articulada, cada fileira pela fase do seu motor), acesa na batida;
//   - leituras em texto (velocidade, roda, corte, chuffs/s, release, esforço × adesão, estados, apito, nível no ouvido).
//   - a linha de estado da condução (maquinista.ts → linhaDeEstado) e o corte que o automático escolheu.
import type { ControleVapor } from './controle';
import { CENARIOS, corteDeRev, fmt, temAreia, temFreio } from './controle';
import { linhaDeEstado, vMaxDaMarcha } from './maquinista';
import type { RefsConducao } from './Conducao';

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

/** manômetro: 0 … 1,35·p_nom, arco de 270°, no mesmo desenho do conta-giros das outras páginas (trilho grosso, faixa
 *  vermelha, algarismos na fonte de mostrador, leitura grande no meio). O ponteiro fino dourado é a caixa de vapor. */
export function desenharManometro(c: ControleVapor, cv: HTMLCanvasElement) {
  const { g, w, h } = prepararCanvas(cv);
  const P = c.P, pMax = Math.ceil((P.pNominal * 1.35) / 2) * 2;
  const cx = w / 2, cy = h * 0.54, R = Math.min(w * 0.46, h * 0.5);
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, ang = (p: number) => a0 + (a1 - a0) * Math.min(1.02, Math.max(0, p / pMax));
  const ink = cor('--ink'), muted = cor('--muted'), faint = cor('--faint'), raise = cor('--raise'), hot = cor('--hot'), gold = cor('--gold'), violet = cor('--violet');
  const display = cor('--f-display'), mono = cor('--f-mono');
  const m = c.tele?.motor;
  const pc = m ? m.pCaldeira : P.pNominal, pch = m ? m.pChest : 0, seg = P.pNominal + 0.3;
  // trilho, faixa vermelha (a segurança abre em p_nom + 0,3) e arco da pressão da caldeira
  g.lineCap = 'butt'; g.lineWidth = R * 0.07;
  g.strokeStyle = raise; g.beginPath(); g.arc(cx, cy, R * 0.92, a0, a1); g.stroke();
  const grad = g.createLinearGradient(cx - R, 0, cx + R, 0);
  grad.addColorStop(0, violet); grad.addColorStop(1, hot);
  g.strokeStyle = grad; g.beginPath(); g.arc(cx, cy, R * 0.92, ang(seg), a1); g.stroke();
  g.strokeStyle = pc >= seg ? hot : gold; g.globalAlpha = 0.85;
  g.beginPath(); g.arc(cx, cy, R * 0.92, a0, ang(pc)); g.stroke(); g.globalAlpha = 1;
  // marcas a cada 1 bar, algarismos a cada 2 (ou 4, nas caldeiras de pressão alta)
  const passo = pMax > 16 ? 4 : 2;
  g.font = `600 ${Math.round(R * 0.11)}px ${display}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let p = 0; p <= pMax; p++) {
    const a = ang(p), x = Math.cos(a), y = Math.sin(a), maior = p % 2 === 0;
    g.lineWidth = maior ? 2 : 1; g.strokeStyle = p >= seg ? violet : maior ? ink : faint;
    g.beginPath(); g.moveTo(cx + x * R * (maior ? 0.78 : 0.82), cy + y * R * (maior ? 0.78 : 0.82)); g.lineTo(cx + x * R * 0.86, cy + y * R * 0.86); g.stroke();
    if (p % passo === 0) { g.fillStyle = p >= seg ? violet : muted; g.fillText(String(p), cx + x * R * 0.66, cy + y * R * 0.66); }
  }
  const miudo = Math.max(10, Math.round(R * 0.06));
  g.font = `500 ${miudo}px ${mono}`; g.fillStyle = faint;
  g.fillText('bar', cx, cy - R * 0.38);
  // ponteiros: caixa de vapor (fino, dourado) e caldeira
  const ponteiro = (p: number, comp: number, larg: number, cc: string) => {
    const a = ang(p);
    g.strokeStyle = cc; g.lineWidth = larg; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx - Math.cos(a) * R * 0.08, cy - Math.sin(a) * R * 0.08); g.lineTo(cx + Math.cos(a) * comp, cy + Math.sin(a) * comp); g.stroke();
  };
  ponteiro(pch, R * 0.62, 2, gold);
  ponteiro(pc, R * 0.86, 3, ink);
  g.fillStyle = ink; g.beginPath(); g.arc(cx, cy, R * 0.035, 0, TAU); g.fill();
  // leituras
  g.fillStyle = pc >= seg ? hot : ink; g.font = `800 ${Math.round(R * 0.3)}px ${display}`;
  g.fillText(fmt(pc, 1), cx, cy + R * 0.3);
  g.font = `500 ${miudo}px ${mono}`; g.fillStyle = muted;
  // (em mostrador pequeno a linha comprida encostaria nos algarismos da escala: fica só a pressão em psi)
  const psi = `${fmt(pc * 14.5038)} psi`, linha2 = `caldeira  ·  ${psi}`;
  g.fillText(g.measureText(linha2).width > R * 0.84 ? psi : linha2, cx, cy + R * 0.5);
  g.fillStyle = gold;
  g.fillText(`caixa de vapor ${fmt(pch, 1)} bar`, cx, cy + R * 0.63);
  if (m?.seguranca) {
    g.fillStyle = hot; g.font = `600 ${Math.max(11, Math.round(R * 0.07))}px ${mono}`;
    g.fillText('SEGURANÇA ABERTA', cx, cy - R * 0.22);
  }
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

/** leituras em texto (só escreve no DOM quando muda) */
export function escreverLeituras(c: ControleVapor, L: Leituras, pico: number) {
  const m = c.tele?.motor, p = c.tele?.portador, ce = c.tele?.cena;
  const set = (id: string, t: string) => { const e = L[id]; if (e && e.textContent !== t) e.textContent = t; };
  const v = p ? Math.abs(p.v) * 3.6 : 0;
  set('v', `${fmt(v, 1)} km/h`);
  if (!m) {
    set('roda', p ? `${fmt(p.rpmEixo)} rpm` : '—');
    // (o portador gerador não repassa a telemetria do motor: na estacionária só a rotação do eixo)
    set('corte', c.audio && p ? 'governador de esferas (sem leitura do motor nesta máquina)' : '—');
    for (const id of ['chuffs', 'release', 'esforco', 'estados', 'vapor', 'apito']) set(id, '—');
  } else {
    set('roda', `${fmt(m.rpm)} rpm · ${fmt(m.voltasPorS as number, 2)} voltas/s`);
    const sentido = (m.reverser as number) < -0.02 ? 'ré' : 'frente';
    set('corte', `${fmt(m.corte * 100)}% · ${sentido} · regulador ${fmt((m.regulador as number) * 100)}%`);
    set('chuffs', `${fmt(m.chuffsPorS, 1)} /s`);
    set('release', `${fmt(m.pRelease, 1)} bar · ${m.engasgado ? 'jato sônico' : 'jato subsônico'}`);
    const fr = m.adesao > 0 ? Math.min(1.2, Math.abs(m.esforco) / m.adesao) : 0;
    set('esforco', `${fmt(Math.abs(m.esforco) / 1000)} de ${fmt(m.adesao / 1000)} kN${m.patinando ? ' · PATINANDO' : ''}`);
    const barra = L['barraEsforco'];
    if (barra) { barra.style.width = `${Math.round((fr / 1.2) * 100)}%`; barra.classList.toggle('patina', !!m.patinando); }
    // só o que está funcionando agora (uma lista de "sim" e "—" não se lia)
    const ativos = [m.seguranca && 'válvula de segurança', m.injetor && 'injetor', m.bombaAr && 'bomba de ar', m.torneiras && 'torneiras abertas', m.soprador && 'soprador'].filter(Boolean);
    set('estados', `${ativos.length ? ativos.join(', ') : 'nenhum ligado'} · fogo ${fmt((m.fogo as number) * 100)}%`);
    set('vapor', `evaporação ${fmt(m.evaporacao, 2)} · consumo ${fmt(m.vapor, 2)} kg/s · água ${fmt((m.nivelAgua as number) * 100)}%`);
    const f = (m.fApito || []).filter((x: number) => x > 0);
    const ct = cents(m.aquecimentoApito as number), frio = Math.abs(ct) < 3 ? 'tubo quente' : `tubo frio, ${fmt(ct)} cents`;
    set('apito', f.length ? `${f.map((x: number) => fmt(x)).join(' · ')} Hz · ${frio}` : `calado · ${frio}`);
  }
  set('nivel', ce ? `${fmt(ce.splDbA, 1)} dB(A)` : '—');
  set('pico', Number.isFinite(pico) ? `pico ${fmt(pico, 1)} dB` : '—');
}

/** a linha de estado e o corte do automático (só escreve no DOM quando muda) */
export function escreverConducao(c: ControleVapor, R: RefsConducao, ligado: boolean, erro: string | null) {
  const m = c.tele?.motor, p = c.tele?.portador, e = c.estado, P = c.P;
  const v = p ? (p.v as number) * 3.6 : 0;
  const demo = e.cenario ? { estado: CENARIOS.find((x) => x.id === e.cenario)?.estado ?? '', restante: c.restanteDemo() } : null;
  // (o corte pedido, o mesmo do lado da chave do automático; as leituras mostram o do motor, 1,5 s atrás)
  const corte = corteDeRev(c.reversaoEfetiva());
  const linha = linhaDeEstado({
    ligado: ligado && !!p, calibrando: e.calibrando, erro, demo, portador: c.portador, v, vMax: P.vMax,
    regulador: e.cmd.regulador, reguladorEfetivo: c.reguladorEfetivo(), sentido: e.sentido, corteAuto: e.corteAuto, corte, reversao: e.cmd.reverser,
    patinando: !!m?.patinando, freando: e.freando || Math.max(e.cmd.freio, c.freioAuto) > 0.05, temFreio: temFreio(c.portador), temAreia: temAreia(P),
    presaHa: c.paradaAberta ? (performance.now() - c.paradaAberta) / 1000 : 0, jaAndou: c.jaAndou, rampa: e.rampa, marcha: e.marcha,
    governando: c.portador === 'trator' && !!m && (m.governador as number) < Math.min(1, m.regulador as number) - 0.02,
    vMaxMarcha: c.portador === 'trator' ? vMaxDaMarcha(P, e.marcha) : 0,
    rpm: p ? Math.abs(p.rpmEixo as number) : 0, carga: e.carga, pCaldeira: m ? m.pCaldeira : P.pNominal, pNominal: P.pNominal,
  });
  const put = (el: HTMLElement | undefined, t: string) => { if (el && el.textContent !== t) el.textContent = t; };
  put(R.titulo, linha.titulo);
  put(R.detalhe, linha.detalhe);
  if (R.caixa && R.caixa.dataset.tom !== linha.tom) R.caixa.dataset.tom = linha.tom;
  // o corte que o automático manda agora, ao lado da chave (a telemetria segue com o 1,5 s da reversão do motor)
  put(R.corte, e.corteAuto ? `${e.sentido === 0 ? 'meio' : e.sentido > 0 ? 'frente' : 'ré'} · corte ${Math.round(corteDeRev(c.reversaoEfetiva()) * 100)} %` : 'desligado');
}
