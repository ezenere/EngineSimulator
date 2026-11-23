// Mostradores do Diesel: os das páginas a pistão (src/pages/comum/mostradores.ts: conta-giros, ciclo de ignição, onda e
// espectro, vista da via) com o que é do diesel: conta-giros com fundo de escala 1,15·rpmMax (em centenas abaixo de
// 3 000 rpm), sobrevelocidade, soprador Roots e os avisos de velas e freio-motor; ciclo de 360° nos 2 tempos; e os
// novos (DIESEL.md 7): pressão de pico e dp/dθ com o traço p–θ do último ciclo do cilindro 1, λ e opacímetro, pressão
// e rotação do turbo, temperatura do gás de escape, notch/kW, kW/Hz e o atraso de ignição.
// O que muda a cada quadro vai direto no DOM, para o React não re-renderizar com a telemetria.
import { clamp } from '../comum/controle';
import { Mostradores as MostradoresPistao, fit } from '../comum/mostradores';
import type { ControleDiesel } from './controle';

export class Mostradores extends MostradoresPistao<ControleDiesel> {
  protected ciclo() { return this.k.estado.motor.tempos === 2 ? 360 : 720; }

  // fundo de escala 1,15·rpmMax arredondado (5000, 3000, 2500, 1200…)
  protected escala(spec: Record<string, any>) {
    const red = spec.rpmMax || spec.redline;
    const passo = red > 3000 ? 1000 : red > 1500 ? 500 : red > 600 ? 200 : 50;
    const max = Math.ceil((red * 1.15) / passo) * passo;
    return { red, max, passo, divisor: max > 3000 ? 1000 : 100 };
  }
  protected noLimite(tele: Record<string, any>) { return !!tele.sobre; }
  protected pressao(spec: Record<string, any>) { return spec.aspiration === 'turbo' ? 'turbo' : spec.soprador ? 'soprador' : null; }
  // segunda linha: velocidade e torque no veículo; potência e torque no gerador, na locomotiva e na bancada
  protected segundaLinha(g: CanvasRenderingContext2D, R: number, tele: Record<string, any>) {
    const n0 = (x: number) => Math.round(x).toLocaleString('pt-BR');
    const linha2 = this.k.estado.portador === 'carro' ? `${Math.round(tele.kmh || 0)} km/h  ·  ${n0(tele.torque || 0)} N·m` : `${n0(tele.kW || 0)} kW  ·  ${n0(tele.torque || 0)} N·m`;
    // (a linha comprida encostaria nos algarismos da escala: fica só a primeira parte; o torque está na coluna ao lado)
    return g.measureText(linha2).width > R * 0.84 ? linha2.split('  ·  ')[0] : linha2;
  }
  protected aviso(tele: Record<string, any>): [string, string] | null {
    const C = this.C;
    return tele.sobre ? ['SOBREVELOCIDADE', C.hot]
      : tele.velas > 0 ? [`VELAS ${tele.velas.toFixed(1).replace('.', ',')} s`, C.gold]
      : tele.freio ? [tele.jake ? 'FREIO-MOTOR · JAKE' : 'FREIO-MOTOR', C.blue]
      : tele.state === 'crank' ? ['PARTIDA', C.gold] : null;
  }
  protected frequenciaDeIgnicao(rpm: number, N: number) { return (rpm / 60) * (N / (this.k.estado.motor.tempos === 2 ? 1 : 2)); }
  // (no 2 tempos cada cilindro queima a cada volta: a referência é a 1ª ordem, não a meia-ordem)
  protected textoDaIgnicao(rpm: number, ff: number) {
    return this.k.estado.motor.tempos === 2
      ? `${ff.toFixed(0)} Hz · 1ª ordem ${(rpm / 60).toFixed(1).replace('.', ',')} Hz`
      : super.textoDaIgnicao(rpm, ff);
  }

  protected quadro(now: number) {
    super.quadro(now);
    const pt = document.getElementById('ptheta') as HTMLCanvasElement | null;
    if (pt) this.drawPTheta(pt);
    this.leiturasDiesel();
  }

  // traço p–θ do último ciclo do cilindro 1 (bar × graus), com o pico e a taxa de subida
  private drawPTheta(canvas: HTMLCanvasElement) {
    const { C, k } = this, tele = k.tele;
    const [g, w, h] = fit(canvas);
    g.clearRect(0, 0, w, h);
    const p: number[] | undefined = tele.ptheta;
    const cyc = k.estado.motor.tempos === 2 ? 360 : 720;
    g.font = `500 10px ${C.mono}`; g.fillStyle = C.faint; g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText('pressão no cilindro 1', 6, 5);
    if (!p || !p.length) {
      g.fillStyle = C.muted; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('sem leitura: motor parado', w / 2, h / 2 + 6);
      return;
    }
    const pm = Math.max(20, ...p) * 1.1;
    // janela de −180° a +180° em torno do PMS de ignição
    const n = p.length, px = (i: number) => { const a = i * (cyc / n); const rel = a < cyc / 2 ? a : a - cyc; return ((rel + 180) / 360) * w; };
    g.strokeStyle = C.line; g.lineWidth = 1; g.beginPath(); g.moveTo(w / 2, 18); g.lineTo(w / 2, h - 16); g.stroke();
    g.strokeStyle = C.gold; g.lineWidth = 1.4; g.beginPath();
    const ord = Array.from({ length: n }, (_, i) => i).filter((i) => { const a = i * (cyc / n); const rel = a < cyc / 2 ? a : a - cyc; return rel >= -180 && rel <= 180; })
      .sort((a, b) => px(a) - px(b));
    ord.forEach((i, j) => { const x = px(i), y = h - 16 - (p[i] / pm) * (h - 36); if (j) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
    g.fillStyle = C.muted; g.textAlign = 'right';
    g.fillText(`${Math.round(pm / 1.1)} bar`, w - 6, 5);
    g.fillStyle = C.faint; g.textBaseline = 'bottom';
    g.textAlign = 'center'; g.fillText('PMS', w / 2, h - 2);
    g.textAlign = 'left'; g.fillText('−180°', 4, h - 2);
    g.textAlign = 'right'; g.fillText('+180°', w - 4, h - 2);
  }

  // leituras numéricas do diesel (direto no DOM)
  private leiturasDiesel() {
    const tele = this.k.tele, e = this.k.estado;
    const set = (id: string, v: string) => { const el = document.getElementById(id); if (el && el.textContent !== v) el.textContent = v; };
    const on = tele.state === 'run';
    const v = (x: number, c: number) => x.toFixed(c).replace('.', ','), n0 = (x: number) => Math.round(x).toLocaleString('pt-BR');
    const abs = v(1 + (tele.boost || 0), 2);
    set('dPmax', on ? `${(tele.pMax || 0).toFixed(0)} bar · ${v(tele.dpdth || 0, 1)} bar/°` : '—');
    set('dLambda', on ? `λ ${(tele.lambda || 0) > 9 ? '> 9' : v(tele.lambda || 0, 2)}` : '—');
    set('dFumaca', on ? `${Math.round((tele.fumaca || 0) * 100)}% preta · ${Math.round((tele.fumacaBranca || 0) * 100)}% branca` : '—');
    set('dTurbo', e.spec.aspiration === 'turbo' ? `${abs} bar · ${Math.round((tele.turboRpm || 0) / 1000)} mil rpm` : e.spec.soprador ? `${abs} bar (Roots)` : 'aspirado');
    set('dEgt', `${Math.round(tele.exhT ?? 20)} °C`);
    set('dTau', on ? `${v(tele.tauId || 0, 2)} ms` : '—');
    set('dPot', on ? `${n0(tele.kW || 0)} kW · ${n0(tele.torque || 0)} N·m` : '—');
    // (o nome de cada leitura diz onde a potência é medida: tração, alternador, dinamômetro)
    const extra = e.portador === 'locomotiva' ? `notch ${tele.notch ?? 0} · ${n0(tele.cargaKW || 0)} kW`
      : e.portador === 'gerador' ? `${n0(tele.cargaKW || 0)} kW · ${v(tele.hz || 0, 1)} Hz`
      : e.portador === 'nenhum' ? `${n0(tele.cargaKW || 0)} kW · alvo ${n0(tele.rpmAlvo || 0)} rpm` : `${Math.round(tele.kmh || 0)} km/h`;
    set('dCarga', extra);
    const op = document.getElementById('dOpac') as HTMLElement | null;
    if (op) op.style.width = `${Math.round(clamp(tele.fumaca || 0, 0, 1) * 100)}%`;
  }
}
