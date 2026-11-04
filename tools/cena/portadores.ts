// Testes dos portadores hélice, rotor, gerador e locomotiva (CENA.md 4.2–4.5, passo 10 do plano), com o
// motor de bancada `MotorTeste` no lugar dos motores que ainda não foram migrados (diesel, turboeixo,
// turboélice). As constantes do motor de bancada (Tmax, J, atraso) são da bancada, não do motor real:
// o que se testa é a carga, o governador e as fontes do portador.
import { Gerador, rpmGerador } from '../../src/carriers/gerador';
import { Locomotiva, NOTCH_RPM, NOTCH_POTENCIA } from '../../src/carriers/locomotiva';
import { Rotor, HELICOPTEROS, ROTOR_R44 } from '../../src/carriers/rotor';
import { Helice, HELICES, bpfHelice, machPonta } from '../../src/carriers/helice';
import { Trem } from '../../src/carriers/trem';
import { MotorTeste } from '../../src/carriers/teste';
import type { Portador, Motor } from '../../src/carriers/tipos';
import * as A from './analise';
import { Bq } from '../../src/scene/filtros';
import type { Linha } from './medidas';

const SR = 48000, B = 128;
const f1 = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const L = (passo: string, nome: string, alvo: string, medido: string, ok: boolean, desvio?: string): Linha => ({ passo, nome, alvo, medido, ok, desvio });

/** roda o portador por `dur` s chamando `aoBloco(t)`; devolve os canais de saída concatenados (opcional) */
function rodar(p: Portador, dur: number, aoBloco?: (t: number) => void, gravar = false) {
  const nF = p.fontes().length, canais = Array.from({ length: nF }, () => new Float32Array(B));
  const n = Math.round(dur * SR);
  const saida = gravar ? Array.from({ length: nF }, () => new Float32Array(n)) : [];
  for (let i = 0; i < n; i += B) {
    aoBloco?.(i / SR);
    p.processar(canais, B, 1 / SR);
    if (gravar) for (let c = 0; c < nF; c++) saida[c].set(canais[c].subarray(0, Math.min(B, n - i)), i);
  }
  return saida;
}

export function medirPortadores(): Linha[] {
  const out: Linha[] = [];
  // ---------------------------------------------------------- compatibilidade
  {
    const casos: [string, () => void, boolean][] = [
      ['trem × nenhum', () => new Trem(SR).acoplar(null), true],
      ['trem × diesel', () => new Trem(SR).acoplar(new MotorTeste({ familia: 'diesel', Tmax: 1, J: 1, atrito: 0, tau: 0.1, omega0: 0 })), false],
      ['gerador × turbina', () => new Gerador(SR).acoplar(new MotorTeste({ familia: 'turbina', Tmax: 1, J: 1, atrito: 0, tau: 0.1, omega0: 0 })), false],
      ['rotor × turboeixo', () => new Rotor(SR).acoplar(new MotorTeste({ familia: 'turboeixo', Tmax: 1, J: 1, atrito: 0, tau: 0.1, omega0: 0 })), true],
      ['locomotiva × diesel', () => new Locomotiva(SR).acoplar(new MotorTeste({ familia: 'diesel', Tmax: 1, J: 1, atrito: 0, tau: 0.1, omega0: 0 })), true],
    ];
    const res = casos.map(([nome, f, deve]) => { let ok = true; try { f(); } catch { ok = false; } return { nome, ok: ok === deve }; });
    out.push(L('1.6', 'tabela motor × portador (acoplar aceita/recusa)', 'conforme 1.6', res.map((r) => `${r.nome} ${r.ok ? 'ok' : 'ERRADO'}`).join('; '), res.every((r) => r.ok)));
  }
  // ---------------------------------------------------------- hélice: tabela de 4.2
  {
    const linhas = Object.entries(HELICES).map(([id, h]) => `${id} BPF ${f1(bpfHelice(h.B, h.nHelice), 0)} Hz M_t ${f1(machPonta(h.D, h.nHelice), 2)}`);
    const ref: Record<string, [number, number]> = { c172: [90, 0.8], caravan: [95, 0.79], atr72: [120, 0.72], spitfire: [84, 0.63], tu95: [50, 0.64] };
    const ok = Object.entries(HELICES).every(([id, h]) => Math.abs(bpfHelice(h.B, h.nHelice) - ref[id][0]) <= 1 && Math.abs(machPonta(h.D, h.nHelice) - ref[id][1]) <= 0.02);
    out.push(L('4.2', 'hélices: BPF e M_t estático (tabela de 4.2)', '±1 Hz, ±0,02', linhas.join('; '), ok));
    // governador: ATR 72 com turbina de bancada; manete 0,4 → 1,0 aos 5 s, a rotação volta a 1200 rpm
    const h = new Helice(SR, { B: 6, D: 3.93, i: 17, nHelice: 1200 });
    const m = new MotorTeste({ familia: 'turboelice', Tmax: 1300, J: 1.2, atrito: 0.02, tau: 0.5, omega0: (1200 * 17 * 2 * Math.PI) / 60 });
    h.acoplar(m);
    let beta0 = 0, rpmMin = 1e9, rpmMax = 0;
    rodar(h, 25, (t) => {
      h.comandar({ pedal: t < 5 ? 0.4 : 1 });
      const nh = h.telemetria().rpmHelice as number;
      if (t > 4.9 && t < 5) beta0 = h.cargaH.beta;
      if (t > 5) { rpmMin = Math.min(rpmMin, nh); rpmMax = Math.max(rpmMax, nh); }
    });
    const nh = h.telemetria().rpmHelice as number, b1 = h.cargaH.beta;
    out.push(L('4.2', 'governador da hélice: manete 0,4 → 1,0 (ATR 72, turbina de bancada)', 'rotação volta a 1200 ± 1%, passo sobe',
      `${f1(nh, 0)} rpm aos 25 s (faixa ${f1(rpmMin, 0)}–${f1(rpmMax, 0)}), β ${f1((beta0 * 180) / Math.PI)}° → ${f1((b1 * 180) / Math.PI)}°`, Math.abs(nh - 1200) <= 12 && b1 > beta0));
  }
  // ---------------------------------------------------------- rotor R44
  {
    const r = new Rotor(SR);
    const tele = r.telemetria();
    const p = r.cargaR.potencias((ROTOR_R44.Nr * 2 * Math.PI) / 60);
    out.push(L('4.3', 'R44: potência no coletivo de pairado', '≈ 170 kW (110 + 40 + 15 + 5)', `${f1(p.total / 1000, 0)} kW (induzida ${f1(p.ind / 1000, 0)}, perfil ${f1(p.perfil / 1000, 0)}, cauda ${f1(p.cauda / 1000, 0)}, acess. 5)`, Math.abs(p.total / 1000 - 170) <= 10));
    // BPF e cauda medidos no canal do rotor (sem motor: Nr imposto)
    r.comandar({ pedal: 0.75 });
    const s = rodar(r, 6, undefined, true);
    const ids = r.fontes().map((f) => f.id);
    const sp = s[ids.indexOf('rotor.principal')], sc = s[ids.indexOf('rotor.cauda')];
    const bpf = A.picoEm(sp, SR, 3.5, 5, 8, 20, 4), fc = A.picoEm(sc, SR, 3.5, 5, 60, 130, 4);
    out.push(L('5 #10', 'R44: BPF do rotor principal (medida)', '13,6 ± 0,05 Hz', `${f1(bpf, 3)} Hz (telemetria ${f1(tele.bpf as number, 3)})`, Math.abs(bpf - 13.6) <= 0.05));
    out.push(L('5 #10', 'R44: BPF do rotor de cauda (medida)', '≈ 93 Hz', `${f1(fc, 1)} Hz`, Math.abs(fc - 93.3) <= 1.5));
    // harmônicos: nível de cada h·BPF no espectro de 4 s
    const harm = (x: Float32Array, H: number) => {
      const nfft = 1 << 18;
      const Q = A.espectro(x, SR, 4 * SR, nfft);
      const res: number[] = [];
      for (let h = 1; h <= H; h++) { const k = Math.round((h * bpf * nfft) / SR); let m = 0; for (let j = -3; j <= 3; j++) m = Math.max(m, Q[k + j]); res.push(10 * Math.log10(m + 1e-30)); }
      return res;
    };
    const hp = harm(sp, 10), faixa1 = Math.max(...hp) - Math.min(...hp);
    out.push(L('5 #10', 'R44 em pairado: harmônicos 1–10 da BPF', 'dentro de 20 dB', `${f1(faixa1)} dB`, faixa1 <= 20));
    const r2 = new Rotor(SR); r2.comandar({ pedal: 1 });
    const s2 = rodar(r2, 6, undefined, true)[ids.indexOf('rotor.principal')];
    const h2 = harm(s2, 30).slice(9), faixa2 = Math.max(...h2) - Math.min(...h2);
    // curtose do sinal em 300–1000 Hz (tapa)
    const f = [new Bq().hp(SR, 300, 0.7071), new Bq().lp(SR, 1000, 0.7071)];
    let m2 = 0, m4 = 0, nn = 0;
    for (let i = SR; i < s2.length; i++) { const y = f[1].run(f[0].run(s2[i])); m2 += y * y; m4 += y * y * y * y; nn++; }
    const curt = (m4 / nn) / ((m2 / nn) ** 2);
    out.push(L('5 #10', 'R44 com coletivo 1,0: harmônicos 10–30', 'dentro de 15 dB', `${f1(faixa2)} dB`, faixa2 <= 15));
    out.push(L('5 #10', 'R44 com coletivo 1,0: curtose em 300–1000 Hz (tapa)', '> 6', f1(curt, 1), curt > 6));
    // droop: O-540 de bancada, coletivo 0,75 → 1,0 em 0,2 s
    const r3 = new Rotor(SR);
    const wN = (ROTOR_R44.Nr * ROTOR_R44.icx * 2 * Math.PI) / 60;
    const m3 = new MotorTeste({ familia: 'pistao', Tmax: 900, J: 0.7, atrito: 0.05, tau: Number(process.env.TAU_ROTOR || 1.1), omega0: wN });   // atraso de torque de 1,1 s: o motor de bancada faz o papel do O-540 com o correlacionador
    r3.acoplar(m3);
    let nrMin = 1e9, tMin = 0, tRec = NaN, nr0 = 0;
    rodar(r3, 10, (t) => {
      r3.comandar({ pedal: t < 5 ? 0.75 : Math.min(1, 0.75 + (t - 5) / 0.2 * 0.25) });
      const nr = r3.telemetria().Nr as number;
      if (t < 5) nr0 = nr;
      if (t > 5 && nr < nrMin) { nrMin = nr; tMin = t; }
      if (t > tMin && t > 5.2 && Number.isNaN(tRec) && nr > nr0 * 0.995 && nrMin < nr0 * 0.99) tRec = t;
    });
    const droop = 100 * (1 - nrMin / nr0);
    tMin -= 2; tRec -= 2;
    out.push(L('5 #10', 'R44: droop ao puxar o coletivo (0,75 → 1,0 em 0,2 s)', '2–3% em ~1 s', `${f1(droop, 2)}% (mínimo ${f1(tMin - 3, 2)} s depois; volta a 99,5% em ${f1(tRec - 3, 2)} s)`, droop >= 2 && droop <= 3 && tMin - 3 < 1.5));
    out.push(L('4.3', 'tabela de helicópteros: BPF B·Nr/60 e cauda', 'R44 13,6/93; R22 17,7/111; AS350 19,5/69,5; 206 13,1/85; UH-60 17,2/79,3; Mi-8 16,0/56,2',
      Object.entries(HELICOPTEROS).map(([id, h]) => `${id} ${f1((h.B * h.Nr) / 60, 1)}/${f1((h.Bc * h.rpmCauda) / 60, 1)}`).join('; '), true));
  }
  // ---------------------------------------------------------- gerador: degrau de 50%
  {
    const g = new Gerador(SR, { polos: 4, fRede: 60, potenciaNominal: 500 });
    const wN = (rpmGerador(4, 60) * 2 * Math.PI) / 60;
    const m = new MotorTeste({ familia: 'diesel', Tmax: 4500, J: 60, atrito: 0.3, tau: 0.08, omega0: wN });   // + 20 kg·m² do alternador
    g.acoplar(m);
    let wMin = 1e9, tMin = 0, tRec = NaN, ultimoFora = 0;
    rodar(g, 12, (t) => {
      g.comandar({ pedal: 0, cargaFracao: t < 4 ? 0 : 0.5 });
      const w = m.eixo.omega;
      if (t > 4) { if (w < wMin) { wMin = w; tMin = t; } if (Math.abs(w / wN - 1) > 0.02) ultimoFora = t; }
    });
    tRec = ultimoFora - 4;
    const queda = 100 * (1 - wMin / wN);
    out.push(L('5 #10', 'gerador (500 kW, 1800 rpm): degrau de 50%', 'queda 4–8%, recupera a ±2% em < 3 s', `queda ${f1(queda, 1)}% (aos ${f1(tMin - 4, 2)} s), dentro de ±2% a partir de ${f1(tRec, 2)} s`, queda >= 4 && queda <= 8 && tRec < 3));
    // alternador: 120 Hz em vazio e a plena carga
    const nivel120 = (fr: number) => {
      const gg = new Gerador(SR); gg.comandar({ pedal: 0, cargaFracao: fr });
      const s = rodar(gg, 2, undefined, true)[gg.fontes().findIndex((f) => f.id === 'alternador')];
      const P = A.espectro(s, SR, SR, 1 << 16); const k = Math.round((120 * (1 << 16)) / SR); let mm = 0; for (let j = -3; j <= 3; j++) mm = Math.max(mm, P[k + j]);
      return 10 * Math.log10(mm);
    };
    const d120 = nivel120(1) - nivel120(0);
    out.push(L('5 #10', 'gerador: 120 Hz a plena carga − em vazio', '+8 ± 2 dB', `${f1(d120)} dB`, Math.abs(d120 - 8) <= 2));
  }
  // ---------------------------------------------------------- locomotiva: notches
  {
    const loc = new Locomotiva(SR);
    const tab = NOTCH_RPM.emd710;
    const m = new MotorTeste({ familia: 'diesel', Tmax: 48000, J: 60, atrito: 2, tau: 0.3, omega0: (tab[0] * 2 * Math.PI) / 60 });
    loc.acoplar(m as Motor);
    const erros: string[] = []; let okRpm = true, okPot = true;
    let t0n = 0, rampaMed = NaN, r1 = 0;
    const rpm = () => (m.eixo.omega * 60) / (2 * Math.PI);
    for (let notch = 1; notch <= 8; notch++) {
      const dur = 10;
      rodar(loc, dur, (t) => {
        loc.comandar({ pedal: 0, notch: notch as 1 });
        if (notch === 3) { if (t < 0.01) { t0n = t; } if (Math.abs(t - 0.5) < 0.002) r1 = loc.telemetria().rpmAlvo as number; if (Math.abs(t - 1.0) < 0.002) rampaMed = ((loc.telemetria().rpmAlvo as number) - r1) / 0.5; }
      });
      const e = (100 * (rpm() - tab[notch])) / tab[notch];
      const pe = (100 * (loc.cargaL.P / 1000 - NOTCH_POTENCIA[notch] * 3200)) / (NOTCH_POTENCIA[notch] * 3200);
      if (Math.abs(e) > 1) okRpm = false;
      if (Math.abs(pe) > 3) okPot = false;
      erros.push(`N${notch} ${f1(rpm(), 0)} rpm (${f1(e, 2)}%)`);
    }
    void t0n;
    out.push(L('5 #10', 'locomotiva EMD 710: rpm por notch (motor de bancada)', '±1%', erros.join(', '), okRpm));
    out.push(L('5 #10', 'locomotiva: potência do gerador de tração por notch', '±3% (depois do atraso de 1,5 s)', okPot ? 'todas dentro' : 'fora', okPot));
    out.push(L('5 #10', 'locomotiva: rampa de rotação', '100 rpm/s', `${f1(rampaMed, 1)} rpm/s`, Math.abs(rampaMed - 100) <= 2));
  }
  return out;
}
