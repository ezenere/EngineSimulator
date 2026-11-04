// Medidas dos adaptadores de motor pela Cena (docs/TECNICO.md → Adaptadores de motor): a tabela "não pode
// piorar" do CENA.md 2.11 refeita com o motor adaptado (carro a 6 m, avião a 1500 m, estrondo sônico) contra as
// referências do legado (tools/cena/referencias/legado.json), os níveis absolutos e a hélice idêntica.
//
//   npx tsx tools/cena/valida.ts motores
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPassagem, SR, BLOCO } from './render-passagem';
import * as A from './analise';
import type { Linha } from './medidas';
import { CarroLegado } from '../../src/carriers/carro';
import { MotorRonco, prepararMotorRonco } from '../../src/engines/ronco/motor';
import { PRESETS as PRESETS_RONCO, ACESSORIOS_PADRAO } from '../../src/engines/ronco/presets';
import { PRESETS_TURBINA as PRESETS_JATO } from '../../src/engines/turbina/presets';
import { MotorTurbina } from '../../src/engines/turbina/motor';
import { FonteHelice } from '../../src/carriers/helice';
import { Aviao } from '../../src/carriers/aviao';
import type { CenaPassagem } from '../../src/scene/cena';
import { Helice } from '../../src/carriers/helice';
import { Locomotiva } from '../../src/carriers/locomotiva';
import { MotorDiesel, prepararMotorDiesel, type UsoDiesel } from '../../src/engines/diesel/motor';
import { PRESETS as PRESETS_DIESEL, PADRAO_DIESEL } from '../../src/engines/diesel/presets';
import { PA_FS } from '../../src/scene/constantes';

/** temperatura em que a Cena tem c = 340 m/s, a velocidade do som da Turbina legada (C0) */
export const T_C340 = 293.15 * (340 / 343) ** 2 - 273.15;

/** avião a jato pela Cena: preset da Turbina, motores na altura `h` (como no flyby legado, onde z = 0 é a linha dos motores) */
export function passagemAviao(id: string, vKmh: number, h: number, sNariz0: number, dur: number, manete: number, extra: { ambiente?: any; solo?: any; aoBloco?: (t: number, c: CenaPassagem) => void } = {}) {
  const m = new MotorTurbina(SR);
  m.configurar(PRESETS_JATO.find((p) => p.id === id)!, SR);
  const av = new Aviao();
  av.acoplar(m);
  av.comandar({ pedal: manete, velocidadeFixa: vKmh / 3.6 });
  const zM = m.fontes[0].pos[2];
  return renderPassagem({
    portadorPronto: av, v: vKmh / 3.6, d: 0, altitude: h - zM, ambiente: extra.ambiente ?? 'ceu', solo: extra.solo ?? 'asfalto', dur, sCentro0: sNariz0,
    reverb: false, semFundo: true, comprimentoVia: 6000, aoBloco: (t, c) => extra.aoBloco?.(t, c),
    antesBloco: (_t, p) => { (p as Aviao).comandar({ pedal: manete }); },
    temperatura: T_C340,
    // (o flyby legado não tem ITD nem ILD: a comparação é com o ouvinte sem binaural)
    ouvinte: { binaural: false, pos: [0, 0, 1.7] },
  });
}

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const REF = () => JSON.parse(fs.readFileSync(path.join(AQUI, 'referencias', 'legado.json'), 'utf8'));
const f1 = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const L = (passo: string, nome: string, alvo: string, medido: string, ok: boolean, desvio?: string): Linha => ({ passo, nome, alvo, medido, ok, desvio });
/** índices das bandas de FAIXAS_PROJETO acima de 2,5 kHz */
const FAIXAS_HF = [4, 5];
const mono = (a: Float32Array, b: Float32Array) => Float32Array.from(a, (v, i) => 0.5 * (v + b[i]));

/** motor do Ronco pronto (calibrado como na página) */
export function motorRonco(id: string, extra: Record<string, any> = {}) {
  const spec = { ...ACESSORIOS_PADRAO, ...PRESETS_RONCO.find((p) => p.id === id)!, ...extra };
  const m = new MotorRonco(SR);
  m.configurar(prepararMotorRonco(spec, SR), SR);
  return m;
}

/** o cenário do legado (legado.ts): Camaro SS, 3000 rpm travado, ponto morto, borboleta 0,5, v = 30 m/s, 6 m do eixo */
export function passagemCarroLegado(x0 = 180, dur = 12, ouvinte?: any) {
  const m = motorRonco('muscle');
  const c = new CarroLegado();
  c.acoplar(m);
  const d = m.dsp, w = (3000 * 2 * Math.PI) / 60;
  d.message({ type: 'input', ignition: true });
  d.state = 'run'; d.lockOmega = true; d.omega = w; d.rpmAvg = 3000; d.thrTarget = 0.5; d.thr = 0.5;
  (m as any).ign = true;
  c.comandar({ pedal: 0.5, velocidadeFixa: 30 });
  const r = renderPassagem({
    portadorPronto: c, v: 30, d: 6 - c.corpo.segmentos[0].largura / 2, ambiente: 'ceu', solo: 'asfalto', dur, sCentro0: -x0,
    reverb: false, semFundo: true, ouvinte, antesBloco: () => { d.omega = w; },
  });
  return r;
}

export function medirMotores(): Linha[] {
  const out: Linha[] = [];
  const ref = REF();
  // ------------------------------------------------------------ carro a 6 m pela Cena
  {
    const r = passagemCarroLegado();
    const m = mono(r.dL, r.dR);
    // instante (recepção) com o escape em x (o centro do carro fica 2,35 m à frente): t = (x + 2,35 + 180)/30 + r/c
    const tEm = (x: number) => (x + 2.35 + 180) / 30 + Math.hypot(x, 6, 1.25) / 343;
    const fa = A.picoEm(m, SR, tEm(-90), 0.25, 170, 250), fi = A.picoEm(m, SR, tEm(90), 0.25, 160, 230);
    out.push(L('2.11', 'carro a 6 m pela Cena (Camaro SS adaptado): Doppler da ignição de 200 Hz', '219 ± 1 / 184 ± 1 Hz', `${f1(fa)} / ${f1(fi)} Hz (legado ${ref.carro.dopplerChegando} / ${ref.carro.dopplerIndo})`, Math.abs(fa - 219.2) <= 1 && Math.abs(fi - 183.9) <= 1));
    const t0 = tEm(0);
    const ban = A.balanco([r.dL, r.dR], SR, Math.round((t0 - 0.25) * SR), Math.round((t0 + 0.25) * SR)).rel;
    const dif = ban.map((b, i) => b - ref.carro.bandasAbeam.relDb[i]);
    out.push(L('2.11', 'carro a 6 m: bandas no instante abeam (dB rel. 150–400) contra o legado', '±1,5 dB por banda', `${ban.map((b) => f1(b)).join(' / ')} (Δ ${dif.map((b) => f1(b)).join(' / ')})`, dif.every((x) => Math.abs(x) <= 1.5)));
    // curva nível × x a cada 0,25 s (forma: relativa ao pico)
    const lf = A.nivelF(r.dL, r.dR, SR, 1, false, 480);
    // (sem o primeiro ponto, t = 1 s: transitório do começo do render nos dois)
    const c = ((ref.carro.curvaNivelXSemFundo ?? ref.carro.curvaNivelX) as [number, number][]).slice(1);
    const pk = Math.max(...c.map((p) => p[1]));
    let pkC = -Infinity;
    // (o legado grava o x do carro no instante de recepção, sem o r/c: aqui o mesmo, com o escape em x)
    const cur = c.map(([x]) => { const i = Math.min(lf.length - 1, Math.round(((x + 2.35 + 180) / 30) * 100)); const v = lf[i]; pkC = Math.max(pkC, v); return v; });
    const dc = cur.map((v, i) => (v - pkC) - (c[i][1] - pk));
    const rms = Math.sqrt(dc.reduce((a, b) => a + b * b, 0) / dc.length), mx = Math.max(...dc.map(Math.abs));
    // a Cena soma a amplificação convectiva |1 − M·cosθ|^−2 (2.1), que o road() não tem: +0,8 dB chegando e −0,75 indo
    const ch = dc.filter((_, i) => c[i][0] < -10), id = dc.filter((_, i) => c[i][0] > 10);
    const med = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    out.push(L('2.11', 'carro a 6 m: curva nível × x (relativa ao pico) contra o legado sem o som de fundo', '±1 dB (rms)', `rms ${f1(rms, 2)} dB, máx ${f1(mx, 2)} dB; chegando ${f1(med(ch), 2)} dB, indo ${f1(med(id), 2)} dB (convecção a 30 m/s: 20·log₁₀((1 + M)/(1 − M)) = ${f1(20 * Math.log10((1 + 30 / 343) / (1 - 30 / 343)), 2)} dB)`, rms <= 1));
    if (process.env.DEPURA) console.log(c.map(([x], i) => `${f1(x, 0)}:${f1(dc[i])}`).join(' '));
  }
  // ------------------------------------------------------------ avião a 1500 m (737, 300 km/h, manete 0,85)
  {
    const v = 300 / 3.6, x0 = 2000;
    const r = passagemAviao('narrow', 300, 1500, -x0, x0 / v + 1500 / 340 + 2, 0.85, { solo: 'grama' });
    const tCima = x0 / v + 1500 / 340;
    const jan = (t: number) => A.balanco([r.dL, r.dR], SR, Math.round((t - 1) * SR), Math.round((t + 1) * SR)).rel;
    const oit = (t: number, f: number) => A.bandas([r.dL, r.dR], SR, Math.round((t - 1) * SR), Math.round((t + 1) * SR), [[f / 1.414, f * 1.414]])[0];
    for (const [nome, t, refB] of [['no ponto mais próximo', tCima, ref.aviao.bandasCima.relDb], ['10 s antes', tCima - 10, ref.aviao.bandas10sAntes.relDb]] as const) {
      const b = jan(t), dif = b.map((x, i) => x - refB[i]);
      const ok = dif.every((x) => Math.abs(x) <= 2);
      // acima de 2,5 kHz a diferença é a do ar: a Cena tem dois polos em 1,554·f_c(r) (f_c(1500 m) = 680 Hz, 2.3) e o
      // flyby legado dois polos em 900 Hz (o piso de 14000·(60/(r + 60))^0,85); com o ar do legado a Cena fica a ±1,2 dB
      // de 60 Hz a 2,5 kHz (medido trocando só o corte). Os dois absorvem menos que a ISO (4 kHz a 1500 m: −50 dB).
      const soAr = !ok && dif.every((x, i) => (FAIXAS_HF.includes(i) ? Math.abs(x) <= 4 : Math.abs(x) <= 2.2));
      out.push(L('2.11', `avião a 1500 m pela Cena (737 adaptado): bandas ${nome}`, '±2 dB por banda (rel. 150–400)', `${b.map((x) => f1(x)).join(' / ')} (Δ ${dif.map((x) => f1(x)).join(' / ')})`, ok,
        soAr ? 'Acima de 2,5 kHz a Cena fica mais clara que o flyby no ponto mais próximo: o ar dela (dois polos no f_c(r) da ISO, decisão de 2.3: 680 Hz a 1500 m) contra os dois polos em 900 Hz do legado (o piso da fórmula dele, igual a 1500 e a 1750 m). Trocando só o corte pelo do legado (sem solo) a diferença cai para ≤ 1,2 dB de 60 Hz a 2,5 kHz e 0,9 dB em 2,5–6 kHz; 10 s antes, os 2,1 dB em 60–150 Hz são o pente denso do solo (Δr ≈ 3 m) na janela de 2 s. 2.3 manda registrar: o legado vale por definição na etapa 1; os dois modelos absorvem bem menos que a ISO em 4 kHz a essa distância.' : undefined));
    }
    const abs = 10 * Math.log10(oit(tCima, 4000) / oit(tCima, 500));
    out.push(L('2.11', 'avião a 1500 m pela Cena: 4 kHz rel. 500 Hz no ponto mais próximo', '≤ −20 dB', `${f1(abs)} dB (legado ${ref.aviao.oitava4kRel500})`, abs <= -20));
  }
  // ------------------------------------------------------------ estrondo (F-16, Mach 1,5, 200 m)
  {
    const e = ref.estrondo, v = 1.5 * 340;
    let tCone = NaN, dp = NaN, T = NaN, nCones = 0, pico = 0;
    const r = passagemAviao('fighter', v * 3.6, 200, -1500, 5, 1, {
      aoBloco: (_t, c) => {
        if (Number.isNaN(tCone) && !Number.isNaN(c.tCone)) {
          // (o legado confere o cone a cada bloco de 128 amostras; o tique de 64 amostras j em que ele aparece
          // vira o fim do bloco de 128 que o contém, como em legado.ts)
          const j = Math.round((c.tCone * SR) / 64) - 1;
          tCone = ((Math.floor(j / 2) + 1) * 128) / SR; dp = c.estrondo.dp; T = c.estrondo.dur; nCones++;
        }
      },
    });
    for (let i = 0; i < r.dL.length; i++) pico = Math.max(pico, Math.abs(r.dL[i]));
    out.push(L('2.11', 'estrondo pela Cena (F-16 adaptado, M 1,5, 200 m): instante do cone, Δp e T de Carlson', `${e.tCone} s ± 1 ms; Δp ${e.dpPa} Pa, T ${e.duracaoS} s`,
      `${f1(tCone, 4)} s; Δp ${f1(dp, 3)} Pa, T ${f1(T, 3)} s; pico na saída ${f1(pico, 2)} FS`, Math.abs(tCone - e.tCone) <= 0.001 && Math.abs(dp - e.dpPa) < 0.01 && Math.abs(T - e.duracaoS) < 0.001));
  }
  out.push(...medirHeliceIdentica());
  return out;
}

/**
 * Hélice idêntica (CENA 4.2 e 5.10): o tom da hélice do JetDSP (Caravan, 1 motor, decolagem em `flyby` a 300 km/h)
 * contra a `FonteHelice` de carriers/helice.ts alimentada, a cada tique de controle, com as mesmas entradas
 * (np, potência, reverso, velocidade, diretividade) e a mesma fase inicial. Tem de sair idêntico amostra a amostra.
 */
export function medirHeliceIdentica(): Linha[] {
  const dur = 6, n = Math.round(dur * SR);
  const m = new MotorTurbina(SR);
  m.configurar(PRESETS_JATO.find((p) => p.id === 'single')!, SR);
  const d: any = m.dsp;
  const fase0 = d.phP[0];
  const rec: number[][] = [];
  const orig = d.sources.bind(d);
  d.sources = (dtc: number) => { orig(dtc); rec.push([d.np, d.u, d.rev || 0, d.vFly, d.de[0].prop]); };
  m.tap.tomHelice = new Float32Array(n + 64);
  const canais = m.fontes.map(() => new Float32Array(BLOCO));
  m.velocidade = 300 / 3.6;
  for (let i = 0; i < n; i += BLOCO) { m.comandar({ acelerador: i < SR ? 0.3 : 1, ignicao: true, partida: false }); m.processar(canais, BLOCO); }
  const f = new FonteHelice(SR, d.propB, d.propD, d.cfg.propRpm);
  f.pp = fase0; f.semRuido = true;
  const y = new Float32Array(n), t = new Float32Array(64);
  for (let j = 0; j * 64 < n; j++) {
    const r = rec[j]; f.np = r[0]; f.u = r[1]; f.rv = r[2]; f.vFly = r[3]; f.dprop = r[4];
    f.preencher(t, 64); y.set(t.subarray(0, Math.min(64, n - j * 64)), j * 64);
  }
  let dif = 0, ref = 0, nd = 0;
  for (let i = 0; i < n; i++) { const e = Math.abs(y[i] - m.tap.tomHelice[i]); if (e > 0) nd++; dif = Math.max(dif, e); ref = Math.max(ref, Math.abs(y[i])); }
  return [L('4.2 / 5 #10', 'hélice idêntica: tom da hélice do JetDSP (Caravan, 6 s) × FonteHelice de carriers/helice.ts', 'idêntico amostra a amostra',
    nd === 0 ? `idêntico (${n} amostras, pico ${f1(20 * Math.log10(ref / 2e-5))} dB a 30 m)` : `${nd} amostras diferentes, erro máx ${f1(20 * Math.log10(dif / ref + 1e-30))} dB rel. pico`, nd === 0)];
}


/** motor diesel pronto (calibrado como na página) para um uso */
export function motorDiesel(id: string, uso: UsoDiesel) {
  const spec = { ...PADRAO_DIESEL, ...PRESETS_DIESEL.find((p) => p.id === id)! } as Record<string, any>;
  const m = new MotorDiesel(SR);
  m.configurar(prepararMotorDiesel(spec, SR, uso), SR);
  return m;
}

/** L_AFmax e L_Aeq (dB(A)) de um render da Cena, num trecho [t0, t1] s */
function niveis(r: { dL: Float32Array; dR: Float32Array }, t0: number, t1: number) {
  const lf = A.nivelF(r.dL, r.dR, SR, PA_FS, true, 480);
  let mx = -Infinity; for (let i = Math.round(t0 * 100); i < Math.min(lf.length, Math.round(t1 * 100)); i++) mx = Math.max(mx, lf[i]);
  return { max: mx, eq: A.leq(r.dL, r.dR, SR, PA_FS, Math.round(t0 * SR), Math.round(t1 * SR), true) };
}

/**
 * Níveis absolutos pela Cena com os motores adaptados (dB(A), céu aberto, sem reverberação nem fundo):
 *   carro a 6 m em carga: Camaro SS em 3ª, pé no fundo, 30 m/s (o motor preso às rodas), L_AFmax da passagem;
 *   Hilux em lenta, parada, ouvinte a 7,5 m da lateral, L_Aeq de 3 s;
 *   EMD SD70ACe em N8, parada, a 15 m da lateral, L_Aeq de 4 s;
 *   ATR 72 em decolagem (manete 1, 60 m/s) passando a 100 m de altura, L_AFmax.
 */
export function medirNiveisMotores(): Linha[] {
  const out: Linha[] = [];
  // ------------------------------------------------------------ carro a 6 m em carga
  {
    const m = motorRonco('muscle'), c = new CarroLegado();
    c.acoplar(m);
    m.dsp.message({ type: 'input', ignition: true });
    m.dsp.state = 'run'; m.dsp.omega = (3000 * 2 * Math.PI) / 60; m.dsp.rpmAvg = 3000; (m as any).ign = true;
    c.comandar({ pedal: 1, marcha: 3, velocidadeFixa: 30 });
    const r = renderPassagem({ portadorPronto: c, v: 30, d: 6 - c.corpo.segmentos[0].largura / 2, ambiente: 'ceu', solo: 'asfalto', dur: 10, sCentro0: -150, reverb: false, semFundo: true });
    const n = niveis(r, 3, 8);
    const rpm = m.dsp.rpmAvg;
    out.push(L('níveis', `carro a 6 m em carga (Camaro SS, 3ª, pé no fundo, 108 km/h, ${f1(rpm, 0)} rpm): L_AFmax`, '85–90 dB(A)', `${f1(n.max)} dB(A)`, n.max >= 85 && n.max <= 90));
  }
  // ------------------------------------------------------------ Hilux em lenta
  {
    const m = motorDiesel('hilux28', 'carro'), c = new CarroLegado();
    c.acoplar(m);
    c.comandar({ pedal: 0, ignicao: true, velocidadeFixa: 0 });
    const ouv = { modo: 'gimbal' as const, gimbal: { az: 180, el: 0, r: 1, alvo: 'escape.0' }, local: 'fora' as const };
    const r = renderPassagem({ portadorPronto: c, v: 0, d: 7.5, ambiente: 'ceu', solo: 'asfalto', dur: 9, sCentro0: 0, reverb: false, semFundo: true, ouvinte: ouv });
    const n = niveis(r, 6, 9);
    const r2 = renderPassagem({ portadorPronto: (() => { const m2 = motorDiesel('hilux28', 'carro'), c2 = new CarroLegado(); c2.acoplar(m2); c2.comandar({ pedal: 0, ignicao: true, velocidadeFixa: 0 }); return c2; })(), v: 0, d: 7.5, ambiente: 'ceu', solo: 'asfalto', dur: 9, sCentro0: 0, reverb: false, semFundo: true });
    const n2 = niveis(r2, 6, 9);
    out.push(L('níveis', `Hilux 2.8 em lenta (${f1(m.dsp.rpmAvg, 0)} rpm), parada, a 1 m atrás da ponteira: L_Aeq`, '~70 dB(A) (±3)', `${f1(n.eq)} dB(A) (a 7,5 m da lateral: ${f1(n2.eq)})`, Math.abs(n.eq - 70) <= 3,
      'A picape usa a convenção do carro (DIESEL.md 6.3): DB_REF_RONCO em carga e a lenta 21 dB abaixo (calibração do Ronco). Com a referência em 95 dB, que põe o Camaro em carga a 6 m em 89 dB(A), a lenta da Hilux a 1 m fica 3 dB abaixo do alvo; com os 100 dB do CENA ficaria em 71,7 e o carro em 94. Os dois alvos pedem referências diferentes para gasolina e diesel leve, o que fica para quando houver gravações calibradas.'));
  }
  // ------------------------------------------------------------ locomotiva EMD em N8 a 15 m
  {
    const m = motorDiesel('emd710', 'locomotiva'), p = new Locomotiva(SR);
    p.acoplar(m);
    p.comandar({ pedal: 0, ignicao: true, notch: 8, velocidadeFixa: 0 });
    const r = renderPassagem({ portadorPronto: p, v: 0, d: 15, ambiente: 'ceu', solo: 'brita', dur: 22, sCentro0: 0, reverb: false, semFundo: true });
    const n = niveis(r, 18, 22);
    out.push(L('níveis', `locomotiva EMD SD70ACe em N8 (${f1(m.dsp.rpmAvg, 0)} rpm), parada, a 15 m: L_Aeq`, '~95 dB(A) (±3; 40 CFR 201: 87 dB(A) a 30 m parada)', `${f1(n.eq)} dB(A)`, Math.abs(n.eq - 95) <= 3,
      'O escape está no L_W 128 dB(A) do DIESEL.md 6.3 (103 dB(A) a 5 m, conferido canal a canal). A 15 m a chaminé, 0,5 m acima do teto, fica rasante à borda da caixa (4,7 m): a sombra (Maekawa, 2.5) tira ~4 dB (sem sombra: 92,6 dB(A)); o resto é a distância real da chaminé (17 m) e o solo de brita, que reflete pouco acima de 800 Hz. O limite da 40 CFR 201 é medido a 30 m, onde o ângulo sobre a borda é mais aberto.'));
  }
  // ------------------------------------------------------------ ATR 72 em decolagem a 100 m
  {
    const mt = new MotorTurbina(SR);
    mt.configurar(PRESETS_JATO.find((p) => p.id === 'regional')!, SR);
    const h = new Helice(SR, { B: 6, D: 3.93, i: 17, nHelice: 1200 });
    h.acoplar(mt);
    h.comandar({ pedal: 1, velocidadeFixa: 60 });
    const x0 = 900, dur = x0 / 60 + 100 / 343 + 6;
    const r = renderPassagem({ portadorPronto: h, v: 60, d: 0, altitude: 100 - mt.fontes[0].pos[2], ambiente: 'ceu', solo: 'grama', dur, sCentro0: -x0, reverb: false, semFundo: true, comprimentoVia: 6000 });
    const n = niveis(r, x0 / 60 - 6, x0 / 60 + 6);
    out.push(L('níveis', 'ATR 72 em decolagem (manete 1, 60 m/s) a 100 m de altura: L_AFmax', '~85 dB(A) (±3; certificação de ruído ICAO/EASA do ATR 72: ~84 EPNdB no ponto lateral a 450 m)', `${f1(n.max)} dB(A)`, Math.abs(n.max - 85) <= 3,
      'O nível é o do JetDSP sem retoque (as fontes já são "Pa a 30 m": a hélice é 9·(M/0,75)⁴ Pa, 113 dB a 30 m por motor na decolagem). A Turbina nunca foi calibrada em absoluto (a página normaliza a saída por cfgGain), e a hélice dela sai ~10 dB acima do que a certificação sugere a 100 m. O 737 no mesmo modelo dá 112,5 dB a 30 m por barramento, também alto. Corrigir a escala da Turbina muda o mostrador de dB da página Turbina: fica para a revisão de níveis da Turbina.'));
  }
  return out;
}

const ehCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (ehCli) for (const l of process.argv[2] === 'niveis' ? medirNiveisMotores() : medirMotores()) console.log(`${l.ok ? 'ok  ' : 'FALHA'} ${l.nome}: ${l.medido}`);
void BLOCO;
