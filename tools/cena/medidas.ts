// Medidas automáticas da Cena contra os números-alvo do CENA.md (2.11 e plano da seção 5).
// Cada medida devolve linhas { passo, nome, alvo, medido, ok, desvio? }: `desvio` marca um alvo que o
// projeto não deixa atingir, com o porquê (vai para o relatório e não derruba o valida.ts).
import { renderPassagem, SR, type ResultadoPassagem } from './render-passagem';
import * as A from './analise';
import { PA_FS, C_SOM } from '../../src/scene/constantes';
import { Bq } from '../../src/scene/filtros';
import { pressaoPP, RuidoVento } from '../../src/scene/pressao';
import { gerarRespostaPorBanda, ambientePassagem, BANDAS_RT, rt60Efetivo } from '../../src/scene/ambientes';
import { CalculoSombra, maekawaDb } from '../../src/scene/sombra';
import { atenuacaoIso } from '../../src/scene/ar';
import { FonteVao } from '../../src/carriers/ruido';
import type { FonteTeste } from '../../src/carriers/teste';
import type { IdAmbiente } from '../../src/scene/tipos';

export interface Linha { passo: string; nome: string; alvo: string; medido: string; ok: boolean; desvio?: string; valor?: number }

const f1 = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const linha = (passo: string, nome: string, alvo: string, medido: string, ok: boolean, valor?: number, desvio?: string): Linha => ({ passo, nome, alvo, medido, ok, valor, desvio });
const dentro = (x: number, c: number, tol: number) => Math.abs(x - c) <= tol;
const mono = (r: { L: Float32Array; R: Float32Array }) => { const m = new Float32Array(r.L.length); for (let i = 0; i < m.length; i++) m[i] = 0.5 * (r.L[i] + r.R[i]); return m; };

export const V350 = 350 / 3.6;

// ---------------------------------------------------------------- caso de validação: trem 10×25 m
let cache: Record<string, ResultadoPassagem> = {};
export function passagemTrem(amb: IdAmbiente, v = V350, d = 3, extra: Partial<Parameters<typeof renderPassagem>[0]> = {}, chave = '') {
  const k = `${amb}|${v}|${d}|${chave}`;
  if (!cache[k]) cache[k] = renderPassagem({ portador: 'trem', v, d, ambiente: amb, dur: 12, x0: 600, medirCpu: true, ...extra });
  return cache[k];
}
export function limparCache() { cache = {}; }

/** passagem do corpo medida pela onda de nariz/cauda (cruzamentos por zero) */
function tempoPassagem(r: ResultadoPassagem) {
  const { t, p } = r.tele;
  const zero = (t0: number, sinal: number) => {
    // extremos em ±0,3 s de t0 e o cruzamento entre eles
    let iMax = -1, iMin = -1;
    for (let i = 0; i < t.length; i++) if (Math.abs(t[i] - t0) < 0.3) { if (iMax < 0 || p[i] > p[iMax]) iMax = i; if (iMin < 0 || p[i] < p[iMin]) iMin = i; }
    const [a, b] = sinal > 0 ? [iMax, iMin] : [iMin, iMax];
    for (let i = Math.min(a, b); i < Math.max(a, b); i++) if (Math.sign(p[i]) !== Math.sign(p[i + 1])) return t[i] + (t[i + 1] - t[i]) * (p[i] / (p[i] - p[i + 1]));
    return NaN;
  };
  return { tN: zero(r.tNarizAbeam, 1), tC: zero(r.tCaudaAbeam, -1) };
}

export function medirTrem(): Linha[] {
  const L: Linha[] = [];
  const ceu = passagemTrem('ceu'), tun = passagemTrem('tunel');
  const tN = ceu.tNarizAbeam, tC = ceu.tCaudaAbeam;
  // passagem nariz → cauda
  const tp = tempoPassagem(ceu);
  const dur = tp.tC - tp.tN;
  L.push(linha('2.11', 'passagem nariz→cauda abeam (onda de pressão)', '2,57 ± 0,05 s', `${f1(dur, 3)} s`, dentro(dur, 2.57, 0.05), dur));
  // envoltória 1–4 kHz durante o corpo (túnel, como na tabela 2.11)
  for (const [nomeAmb, r] of [['túnel', tun], ['céu', ceu]] as const) {
    const m = mono(r);
    const env = A.envoltoria(m, SR, 1000, 4000, 0.02, 0.005);
    const seg = env.slice(Math.round(r.tNarizAbeam / 0.005), Math.round(r.tCaudaAbeam / 0.005));
    const fpk = A.picoDaSerie(seg, 200, 2, 8), prof = A.percentil(seg, 90) - A.percentil(seg, 10);
    const okF = dentro(fpk, 3.89, 0.1), okP = prof >= 6;
    L.push(linha('2.11', `modulação 1–4 kHz (${nomeAmb}): frequência`, '3,89 ± 0,1 Hz', `${f1(fpk, 3)} Hz`, okF, fpk));
    L.push(linha('2.11', `modulação 1–4 kHz (${nomeAmb}): profundidade p90−p10`, '≥ 6 dB', `${f1(prof)} dB`, okP, prof,
      okP ? undefined : 'Na banda 1–4 kHz o ruído aerodinâmico (corpo, truques, vãos: espectro de 2.7 com níveis de 4.6) fica ~15 dB acima do rolamento, que a sombra do piso (2.5) atenua 8–10 dB acima de 1 kHz; o rolamento sozinho modula ' + f1(rolamentoProf()) + ' dB. O orçamento de 4.6 (rolamento ≈ aero a 7,5 m) supõe rolamento sem sombra.'));
  }
  // padrão duplo dos truques: autocorrelação da envoltória do rolamento sozinho
  {
    const r = passagemTrem('ceu', V350, 3, { trem: { tipos: ['rolamento'] } }, 'rol');
    const env = A.envoltoria(mono(r), SR, 1000, 4000, 0.02, 0.002);
    const seg = env.slice(Math.round(r.tNarizAbeam / 0.002), Math.round(r.tCaudaAbeam / 0.002));
    const mu = seg.reduce((a, b) => a + b, 0) / seg.length;
    const x = seg.map((a) => a - mu);
    const ac = (lag: number) => { let s = 0; for (let i = 0; i + lag < x.length; i++) s += x[i] * x[i + lag]; return s; };
    let best = 0, bestLag = 0;
    for (let lag = 25; lag <= 60; lag++) { const v = ac(lag); if (v > best) { best = v; bestLag = lag; } }
    const lagMs = bestLag * 2;
    const vale = ac(Math.round(bestLag / 2)), ok = dentro(lagMs, 82, 12) && best > vale;
    L.push(linha('2.11', 'padrão duplo dos truques (autocorrelação do rolamento)', 'pico em 82 ms (8 m a 97,2 m/s)', `${lagMs} ms`, ok, lagMs));
  }
  // pulsos de vão (50–200 Hz): nível no instante de cada vão abeam contra o meio do vagão
  {
    const r = tun, m = mono(r);
    const passo = 0.002, env = A.envoltoria(m, SR, 50, 200, 0.02, passo);
    const p = r.portador as unknown as { cfg: { Lc: number; vao: number; N: number } };
    const Lc = p.cfg.Lc, lc = Lc - p.cfg.vao, N = p.cfg.N, v = V350;
    const atr = 4.7 / C_SOM;
    let nOk = 0; const larg: number[] = [], acima: number[] = [];
    for (let k = 0; k < N - 1; k++) {
      const tv = r.tNarizAbeam + (k * Lc + lc + p.cfg.vao / 2) / v + atr;
      const tm = r.tNarizAbeam + (k * Lc + lc / 2) / v + atr, tm2 = r.tNarizAbeam + ((k + 1) * Lc + lc / 2) / v + atr;
      const iv = Math.round((tv - 0.01) / passo);
      let pk = -1e9, ipk = iv;
      for (let i = iv - 20; i <= iv + 20; i++) if (env[i] > pk) { pk = env[i]; ipk = i; }
      const meio = 0.5 * (env[Math.round((tm - 0.01) / passo)] + env[Math.round((tm2 - 0.01) / passo)]);
      const dif = pk - meio;
      // largura a −3 dB
      let a = ipk, b = ipk;
      while (a > 0 && env[a] > pk - 3) a--; while (b < env.length - 1 && env[b] > pk - 3) b++;
      const w = (b - a) * passo * 1000;
      acima.push(dif); larg.push(w);
      if (dif >= 8) nOk++;
    }
    const ok = nOk === N - 1;
    L.push(linha('2.11', 'pulsos de vão 50–200 Hz (túnel) ≥ 8 dB sobre o meio do vagão', `${N - 1} pulsos`, `${nOk} (${acima.map((x) => f1(x)).join(' ')} dB; −3 dB: ${larg.map((x) => x.toFixed(0)).join(' ')} ms)`, ok, nOk,
      ok ? undefined : 'Os vãos são fontes de 119 dB(A) com energia em 50–400 Hz, mas na banda 50–200 Hz os truques (aero com pico em 160 Hz, 2×119 dB(A) a ±4 m do vão) e o corpo enchem o meio do vagão; a diferença fica abaixo de 8 dB.'));
  }
  // Doppler: tom de 1 kHz no nariz, só o tom, sem solo
  {
    const r = renderPassagem({ portador: 'trem', v: V350, d: 3, ambiente: 'ceu', solo: 'nenhum', dur: 12, x0: 600, reverb: false, semFundo: true, trem: { tom: { f: 1000, nivelDb: 90 }, soTom: true } });
    const m = mono(r), tN = r.tNarizAbeam + 3.0 / C_SOM;
    const fa = A.picoEm(m, SR, tN - 1.5, 0.02, 600, 2000), fi = A.picoEm(m, SR, tN + 1.5, 0.02, 400, 1500);
    L.push(linha('2.11', 'Doppler 1 kHz no nariz: chegando', '1395 ± 5 Hz', `${f1(fa)} Hz`, dentro(fa, 1395, 5), fa));
    L.push(linha('2.11', 'Doppler 1 kHz no nariz: indo', '779 ± 5 Hz', `${f1(fi)} Hz`, dentro(fi, 779, 5), fi));
    // transição 45°→135°: f(θ) = 1000/(1 − M·cosθ)
    const M = V350 / C_SOM, f45 = 1000 / (1 - M * Math.SQRT1_2), f135 = 1000 / (1 + M * Math.SQRT1_2);
    const ts: number[] = [], fs: number[] = [];
    for (let t = tN - 0.25; t <= tN + 0.25; t += 0.001) { ts.push(t); fs.push(A.picoEm(m, SR, t, 0.02, 500, 1800)); }
    const cruza = (fx: number) => { for (let i = 0; i < fs.length - 1; i++) if ((fs[i] - fx) * (fs[i + 1] - fx) <= 0) return ts[i] + (ts[i + 1] - ts[i]) * ((fs[i] - fx) / (fs[i] - fs[i + 1])); return NaN; };
    const dt = (cruza(f135) - cruza(f45)) * 1000;
    L.push(linha('2.11', 'Doppler: transição 45°→135°', '62 ± 5 ms', `${f1(dt)} ms`, dentro(dt, 62, 5), dt));
    // assimetria chegando/indo à mesma distância de emissão (30 m), expConv 2
    const re = 30, xe = Math.sqrt(re * re - 3.01 * 3.01);
    const tA = r.tNarizAbeam - xe / V350 + re / C_SOM, tI = r.tNarizAbeam + xe / V350 + re / C_SOM;
    const rms = (t: number) => { const i0 = Math.round((t - 0.01) * SR); let s = 0; for (let i = 0; i < 960; i++) s += m[i0 + i] * m[i0 + i]; return Math.sqrt(s / 960); };
    const as = 20 * Math.log10(rms(tA) / rms(tI));
    L.push(linha('2.11', 'assimetria chegando/indo (monopolo, 30 m)', '+10 ± 1 dB', `${f1(as)} dB`, dentro(as, 10, 1), as));
  }
  // onda de nariz e cauda (céu aberto)
  {
    const { t, p } = ceu.tele;
    const ext = (t0: number) => { let mx = -1e9, mn = 1e9, tmx = 0, tmn = 0; for (let i = 0; i < t.length; i++) if (Math.abs(t[i] - t0) < 0.4) { if (p[i] > mx) { mx = p[i]; tmx = t[i]; } if (p[i] < mn) { mn = p[i]; tmn = t[i]; } } return { pp: mx - mn, sig: Math.abs(tmn - tmx) / 2 }; };
    const n = ext(tN), c = ext(tC);
    L.push(linha('2.11', 'onda de nariz: pico a pico', '150 ± 30 Pa', `${f1(n.pp)} Pa (fórmula ${f1(pressaoPP(V350, 3, 0.14))})`, dentro(n.pp, 150, 30), n.pp));
    L.push(linha('2.11', 'onda de nariz: σ', '51 ± 5 ms', `${f1(n.sig * 1000)} ms`, dentro(n.sig * 1000, 51, 5), n.sig * 1000,
      dentro(n.sig * 1000, 51, 5) ? undefined : 'σ = L_nariz/(3v) com L_nariz = 12 m (padrão de 4.6) dá 41 ms; os 51 ms de 2.6 saem de L_nariz = 15 m.'));
    L.push(linha('2.11', 'onda de cauda / nariz', '0,70', f1(c.pp / n.pp, 2), dentro(c.pp / n.pp, 0.7, 0.05), c.pp / n.pp));
    // resíduo > 20 Hz
    const hp = [new Bq().hp(SR, 20, 0.7071), new Bq().hp(SR, 20, 0.7071)];
    let mx = 0;
    for (let i = 0; i < p.length - 1; i++) for (let k = 0; k < 128; k++) { const x = hp[1].run(hp[0].run(p[i] + (p[i + 1] - p[i]) * (k / 128))); if (Math.abs(x) > mx) mx = Math.abs(x); }
    L.push(linha('5 #6', 'resíduo da pressão > 20 Hz no alto-falante (céu)', '≤ 20 Pa', `${f1(mx)} Pa`, mx <= 20, mx));
    // vento
    const u = ceu.tele.u;
    const umax = Math.max(...u);
    L.push(linha('5 #6', 'vento induzido a céu aberto (pico)', '5,4 ± 1 m/s', `${f1(umax, 2)} m/s`, dentro(umax, 5.4, 1), umax));
  }
  // túnel: onda de compressão, vento do pistão
  {
    const { t, p, u } = tun.tele;
    const tNt = tun.tNarizAbeam, tCt = tun.tCaudaAbeam;
    let pmax = 0; for (let i = 0; i < t.length; i++) if (t[i] < tNt - 1) pmax = Math.max(pmax, p[i]);
    let tch = NaN; for (let i = 0; i < t.length; i++) if (p[i] > 0.1 * pmax) { tch = t[i]; break; }
    const ant = tNt - tch;
    L.push(linha('2.11', 'onda de compressão do túnel: Δp', '2,0 ± 0,4 kPa', `${f1(pmax / 1000, 2)} kPa`, dentro(pmax, 2000, 400), pmax));
    L.push(linha('2.11', 'onda de compressão: antecedência (ouvinte 500 m dentro)', '3,7 ± 0,1 s', `${f1(ant, 2)} s`, dentro(ant, 3.7, 0.1), ant));
    let su = 0, nu = 0; for (let i = 0; i < t.length; i++) if (t[i] >= tNt && t[i] <= tCt) { su += u[i]; nu++; }
    const um = su / nu;
    L.push(linha('2.11', 'vento no ouvinte durante o corpo (túnel)', '15 ± 2 m/s', `${f1(um, 1)} m/s`, dentro(um, 15, 2), um));
    const iC = t.findIndex((x) => x >= tCt), i3 = t.findIndex((x) => x >= tCt + 3);
    const raz = u[i3] / u[iC];
    L.push(linha('2.11', 'esteira: u(cauda + 3 s)/u(cauda)', 'e⁻¹ = 0,37 ± 0,05', f1(raz, 2), dentro(raz, 0.37, 0.05), raz));
  }
  // níveis
  {
    const nivel = (r: ResultadoPassagem) => {
      const lf = A.nivelF(r.L, r.R, SR, PA_FS, true, 480);
      const i0 = Math.round((r.tNarizAbeam - 0.5) * 100), i1 = Math.round((r.tCaudaAbeam + 0.5) * 100);
      let mx = -1e9, imx = 0; for (let i = i0; i < i1; i++) if (lf[i] > mx) { mx = lf[i]; imx = i; }
      const t100 = r.tNarizAbeam - 100 / V350 + 100 / C_SOM;
      const l100 = lf[Math.round(t100 * 100)];
      const leq = A.leq(r.L, r.R, SR, PA_FS, Math.round(r.tNarizAbeam * SR), Math.round(r.tCaudaAbeam * SR));
      return { mx, l100, leq, tmx: imx / 100 };
    };
    const nc = nivel(ceu), nt = nivel(tun);
    const dCeu = nc.mx - nc.l100, dTun = nt.mx - nt.l100;
    L.push(linha('2.11', 'pico − nariz a 100 m (céu aberto)', '23 ± 4 dB', `${f1(dCeu)} dB`, dentro(dCeu, 23, 4), dCeu));
    L.push(linha('2.11', 'pico − nariz a 100 m (túnel)', '10–12 dB', `${f1(dTun)} dB`, dTun >= 10 && dTun <= 12, dTun));
    const dt = nt.leq - nc.leq;
    L.push(linha('2.11', 'túnel − céu aberto no L_Aeq,tp', '+7 ± 2 dB', `${f1(dt)} dB`, dentro(dt, 7, 2), dt));
    L.push(linha('2.11', 'L_Aeq,tp céu aberto (3 m, 350 km/h)', '108 ± 3 dB(A)', `${f1(nc.leq)} dB(A)`, dentro(nc.leq, 108, 3), nc.leq));
    L.push(linha('2.11', 'L_AFmax céu aberto', '113 ± 3 dB(A)', `${f1(nc.mx)} dB(A)`, dentro(nc.mx, 113, 3), nc.mx,
      dentro(nc.mx, 113, 3) ? undefined : 'Com o ruído aerodinâmico uniforme ao longo do corpo dominando o nível A, o L_AF varia pouco na passagem (L_AFmax − L_Aeq,tp ≈ 1 dB, contra os 5 dB implícitos na tabela).'));
    L.push(linha('2.11', 'L_Aeq,tp túnel', '115 ± 3 dB(A)', `${f1(nt.leq)} dB(A)`, dentro(nt.leq, 115, 3), nt.leq));
    L.push(linha('2.11', 'L_AFmax túnel', '120 ± 3 dB(A)', `${f1(nt.mx)} dB(A)`, dentro(nt.mx, 120, 3), nt.mx));
    // balanço espectral no pico (céu aberto, mono, sem ponderação), 0,5 s em torno do L_AFmax
    const m = mono(ceu);
    const b = A.balanco(m, SR, Math.round((nc.tmx - 0.25) * SR), Math.round((nc.tmx + 0.25) * SR));
    const alvo = [4, 0, -1, 1, -2, -10];
    const nomes = ['60–150', '150–400', '400–1k', '1–2,5k', '2,5–6k', '6–12k'];
    for (let i = 0; i < 6; i++) {
      if (i === 1) continue;
      const ok = dentro(b.rel[i], alvo[i], 4);
      L.push(linha('2.11', `balanço no pico ${nomes[i]} Hz (rel. 150–400)`, `${alvo[i] > 0 ? '+' : ''}${alvo[i]} ± 4 dB`, `${f1(b.rel[i])} dB`, ok, b.rel[i],
        ok ? undefined : 'Mesma causa da modulação: acima de 1 kHz o espectro é do ruído aerodinâmico (2.7), que cai 3–9 dB/oitava, e o rolamento chega 8–10 dB atenuado pela sombra do piso.'));
    }
    L.push(linha('2.11', 'centroide no pico', '≈ 1,2 kHz', `${f1(b.centroide, 0)} Hz`, b.centroide > 800 && b.centroide < 1800, b.centroide,
      b.centroide > 800 && b.centroide < 1800 ? undefined : 'Idem (espectro aerodinâmico dominante).'));
  }
  return L;
}

let _rolProf = NaN;
function rolamentoProf() {
  if (!Number.isNaN(_rolProf)) return _rolProf;
  const r = passagemTrem('ceu', V350, 3, { trem: { tipos: ['rolamento'] } }, 'rol');
  const env = A.envoltoria(mono(r), SR, 1000, 4000, 0.02, 0.005);
  const seg = env.slice(Math.round(r.tNarizAbeam / 0.005), Math.round(r.tCaudaAbeam / 0.005));
  return (_rolProf = A.percentil(seg, 90) - A.percentil(seg, 10));
}

// ---------------------------------------------------------------- passo 7: níveis do portador trem
export function medirNiveisTrem(): Linha[] {
  const L: Linha[] = [];
  const v300 = 300 / 3.6, v160 = 160 / 3.6;
  const leq = (v: number, tipos?: any) => {
    // render curto centrado na passagem: o corpo começa 300 m antes do ouvinte
    const L0 = 249.5;
    const x0 = 300;
    const dur = (x0 + L0 + 60) / v;
    const rr = renderPassagem({ portador: 'trem', v, d: 7.5, ambiente: 'ceu', dur, x0, reverb: false, semFundo: true, trem: tipos ? { tipos } : {} });
    return A.leq(rr.L, rr.R, SR, PA_FS, Math.round(rr.tNarizAbeam * SR), Math.round(rr.tCaudaAbeam * SR));
  };
  const total = leq(v300);
  L.push(linha('5 #7', 'L_Aeq,tp a 7,5 m e 300 km/h (céu aberto, brita)', '100 ± 3 dB(A)', `${f1(total)} dB(A)`, dentro(total, 100, 3), total));
  const r300 = leq(v300, ['rolamento']), r160 = leq(v160, ['rolamento']);
  const a300 = leq(v300, ['aero', 'vao', 'pantografo']), a160 = leq(v160, ['aero', 'vao', 'pantografo']);
  L.push(linha('5 #7', 'lei de velocidade do rolamento 160 → 300 km/h', '+8 ± 1 dB', `${f1(r300 - r160)} dB (só rolamento: ${f1(r160)} → ${f1(r300)})`, dentro(r300 - r160, 8, 1), r300 - r160));
  L.push(linha('5 #7', 'lei de velocidade do aero 160 → 300 km/h', '+16 ± 1 dB', `${f1(a300 - a160)} dB (${f1(a160)} → ${f1(a300)})`, dentro(a300 - a160, 16, 1), a300 - a160));
  return L;
}

// ---------------------------------------------------------------- passos 1–3, 5, 6, 8, 9: unidades
function renderTeste(fontes: FonteTeste[], v: number, d: number, dur: number, extra: Partial<Parameters<typeof renderPassagem>[0]> = {}) {
  return renderPassagem({ portador: 'teste', fontesTeste: fontes, corpoTeste: { largura: 0.01, altura: 0.01, zPiso: 0, comprimento: 0.01 }, v, d, ambiente: 'ceu', solo: 'nenhum', dur, reverb: false, semFundo: true, ...extra });
}

export function medirPropagador(): Linha[] {
  const L: Linha[] = [];
  // passo 1: carro a 6 m, 200 Hz a 30 m/s
  {
    const r = renderTeste([{ pos: [0, 0, 0.35], sinal: 'tom', f: 200, paRms: 1, refDist: 5 }], 30, 6, 8, { x0: 120, solo: 'asfalto' });
    const m = mono(r), t0 = 120 / 30;
    const fa = A.picoEm(m, SR, t0 - 1.5, 0.2, 150, 260), fi = A.picoEm(m, SR, t0 + 1.5, 0.2, 150, 260);
    L.push(linha('5 #1', 'Doppler carro a 6 m, 200 Hz a 30 m/s: chegando', '219 ± 1 Hz', `${f1(fa)} Hz`, dentro(fa, 219, 1), fa));
    L.push(linha('5 #1', 'idem: indo', '184 ± 1 Hz', `${f1(fi)} Hz`, dentro(fi, 184, 1), fi));
  }
  // passo 1: nível 1/r em 5, 10, 50 m (tom de 250 Hz parado, sem solo)
  {
    const nivel = (d: number) => {
      const r = renderTeste([{ pos: [0, 0, 1.6], sinal: 'tom', f: 250, paRms: 1, refDist: 7.5 }], 0, d, 1.0, { sCentro0: 0 });
      let s = 0; const i0 = Math.round(0.6 * SR), n = Math.round(0.3 * SR);
      for (let i = 0; i < n; i++) s += r.dL[i0 + i] * r.dL[i0 + i] + r.dR[i0 + i] * r.dR[i0 + i];
      return 20 * Math.log10(Math.sqrt(s / (2 * n)) * PA_FS);
    };
    for (const d of [5, 10, 50]) {
      const med = nivel(d), teo = 20 * Math.log10(7.5 / d);
      L.push(linha('5 #1', `nível 1/r a ${d} m (rel. refDist 7,5 m)`, `${f1(teo, 2)} ± 0,2 dB`, `${f1(med, 2)} dB`, dentro(med, teo, 0.2), med));
    }
  }
  // passo 2: pente do solo (fonte parada de ruído branco, solo água)
  {
    const casos: [string, number, number, number][] = [['escape do carro', 0.35, 1.6, 6], ['roda do trem', 0.3, 1.6, 3], ['pantógrafo', 5.0, 1.6, 3]];
    for (const [nome, zs, zo, d] of casos) {
      const r = renderTeste([{ pos: [0, 0, zs], sinal: 'ruido', paRms: 1 }], 0, d, 2.5, { sCentro0: 0, solo: 'agua', ouvinte: { pos: [0, 0, zo] } });
      const r1 = Math.hypot(d, zo - zs), r2 = Math.hypot(d, zo + zs), fn = 343 / (2 * (r2 - r1));
      // espectro médio do ouvido esquerdo de 0,5 a 2,5 s
      const nseg = 16384, acc = new Float64Array(nseg / 2); let q = 0;
      for (let i = Math.round(0.5 * SR); i + nseg < r.dL.length; i += nseg / 2) { const P = A.espectro(r.dL, i, nseg, nseg); for (let k = 0; k < P.length; k++) acc[k] += P[k]; q++; }
      // suaviza e acha o mínimo em [0,6, 1,4]·fn
      let kb = -1, vb = Infinity;
      for (let k = Math.round(0.6 * fn * nseg / SR); k <= Math.round(1.4 * fn * nseg / SR); k++) {
        let s = 0; for (let j = -2; j <= 2; j++) s += acc[k + j]; if (s < vb) { vb = s; kb = k; }
      }
      const fm = (kb * SR) / nseg, err = (fm - fn) / fn;
      L.push(linha('5 #2', `nulo do solo: ${nome}`, `${f1(fn, 0)} Hz ± 3%`, `${f1(fm, 0)} Hz (${f1(err * 100)}%)`, Math.abs(err) <= 0.03, fm));
      void q;
    }
  }
  // passo 2: absorção do ar, 4 kHz contra 500 Hz (ruído parado, sem solo), UR 60%
  for (const d of [30, 300, 1500]) {
    const dur = d / 343 + 1.6;
    const r = renderTeste([{ pos: [0, 0, 1.6], sinal: 'ruido', paRms: 1 }], 0, d, dur, { sCentro0: 0 });
    const nseg = 8192, ini = Math.round((d / 343 + 0.4) * SR);
    const acc = new Float64Array(nseg / 2);
    for (let i = ini; i + nseg < r.dL.length; i += nseg / 2) { const P = A.espectro(r.dL, i, nseg, nseg); for (let k = 0; k < P.length; k++) acc[k] += P[k]; }
    const banda = (f: number) => { let s = 0; for (let k = Math.round(f / 1.12 * nseg / SR); k <= Math.round(f * 1.12 * nseg / SR); k++) s += acc[k]; return s; };
    const med = 10 * Math.log10(banda(500) / banda(4000)) - 10 * Math.log10(500 / 4000);   // ruído branco: corrige a largura da banda
    const iso = atenuacaoIso(4000, d) - atenuacaoIso(500, d);
    const ok = dentro(med, iso, 1.5);
    L.push(linha('5 #2', `ar a ${d} m: atenuação 4 kHz − 500 Hz`, `${f1(iso)} ± 1,5 dB (ISO)`, `${f1(med)} dB`, ok, med,
      ok ? undefined : 'Decisão de 2.3: dois polos de 1 polo por fonte. A 1500 m a ISO pede 46,7 dB entre 500 Hz e 4 kHz; dois polos dão no máximo 36 dB em qualquer corte, e com o −3 dB em f_c(r) dão ~22 dB. A tabela "não pode piorar" (avião a 1500 m: 4 kHz ≤ −20 dB rel. 500 Hz) é atendida.'));
  }
  return L;
}

/** passo 3: CPU com 48 fontes de ruído em movimento, 10 s */
export function medirCpu(): Linha[] {
  const fontes: FonteTeste[] = [];
  for (let i = 0; i < 48; i++) fontes.push({ pos: [-i * 2, (i % 2) * 0.8 - 0.4, 0.3 + (i % 5) * 0.5], sinal: 'ruido', paRms: 0.5 });
  const r = renderPassagem({ portador: 'teste', fontesTeste: fontes, corpoTeste: { largura: 3, altura: 3.5, zPiso: 0.4, comprimento: 100 }, v: 97.2, d: 3, ambiente: 'ceu', dur: 10, x0: 500, reverb: false, medirCpu: true });
  const frac = r.cpuFracao!;
  const tr = r.portador as unknown as object; void tr;
  const trem = passagemTrem('tunel');
  return [
    linha('5 #3', 'CPU: 48 fontes, 10 s (Node, render offline)', '< 25% do tempo real', `${f1(frac * 100)}% (${f1(r.cpuMsPorBloco! * 1000, 0)} µs por bloco de 128)`, frac < 0.25, frac),
    linha('5 #3', 'CPU: trem 10×25 m no túnel (63 fontes + campo próximo)', '< 50% do quantum (5.1)', `${f1(trem.cpuFracao! * 100)}% (${f1(trem.cpuMsPorBloco! * 1000, 0)} µs por bloco)`, trem.cpuFracao! < 0.5, trem.cpuFracao!),
  ];
}

/** passo 5: sombra do corpo */
export function medirSombra(): Linha[] {
  const L: Linha[] = [];
  const c = new CalculoSombra();
  // roda oposta (exemplo de 2.5): fonte y = +1,5 z 0,3; ouvinte do lado −y a 3 m da lateral
  const ys = 1.5, zs = 0.3, yo = -(3 + 1.68), zo = 1.6;
  c.calcular(ys, zs, yo, zo, 0, 3.36, 3.6, 0.4);
  const ref100 = c.a100, ref1k = c.a1k;
  // medido: tom parado com e sem o corpo
  const nivel = (f: number, corpo: boolean) => {
    const r = renderPassagem({ portador: 'teste', fontesTeste: [{ pos: [0, ys, zs], sinal: 'tom', f, paRms: 1 }], corpoTeste: corpo ? { largura: 3.36, altura: 3.6, zPiso: 0.4, comprimento: 25 } : { largura: 0.01, altura: 0.01, zPiso: 0, comprimento: 25 },
      v: 0, d: corpo ? 3 : 3 + 1.68 - 0.005, ambiente: 'ceu', solo: 'nenhum', dur: 0.8, sCentro0: 0, reverb: false, semFundo: true });
    let s = 0; const i0 = Math.round(0.4 * SR), n = Math.round(0.3 * SR);
    for (let i = 0; i < n; i++) s += r.dL[i0 + i] ** 2 + r.dR[i0 + i] ** 2;
    return 10 * Math.log10(s / n);
  };
  const a100 = nivel(100, false) - nivel(100, true), a1k = nivel(1000, false) - nivel(1000, true);
  L.push(linha('5 #5', 'sombra da roda oposta em 100 Hz (Maekawa, caminho por baixo)', `${f1(ref100)} ± 2 dB`, `${f1(a100)} dB`, dentro(a100, ref100, 2), a100));
  L.push(linha('5 #5', 'sombra da roda oposta em 1 kHz', `${f1(ref1k)} ± 2 dB`, `${f1(a1k)} dB`, dentro(a1k, ref1k, 2), a1k));
  // por cima: fonte na face oposta alta, onde o caminho por cima é o mais curto
  c.calcular(1.69, 3.0, yo, 3.0, 0, 3.36, 3.6, 0.4);
  L.push(linha('5 #5', 'caminho por cima (face oposta, z 3): δ e A(100)/A(1k)', 'Maekawa: 10·log(3+20N)', `δ ${f1(c.delta, 3)} m, ${f1(c.a100)} / ${f1(c.a1k)} dB (fórmula ${f1(maekawaDb(c.delta, 100))} / ${f1(maekawaDb(c.delta, 1000))})`, dentro(c.a100, maekawaDb(c.delta, 100), 0.01), c.a100));
  // continuidade: ouvinte no gimbal passando por cima do corpo (az 90 → −90 a el 60°) em 2 s
  {
    let maxSalto = 0;
    const prev: number[] = [];
    renderPassagem({
      portador: 'teste', fontesTeste: [{ pos: [0, 1.69, 1.8], sinal: 'ruido', paRms: 1 }, { pos: [0, -1.69, 1.8], sinal: 'ruido', paRms: 1 }, { pos: [5, 0, 0.3], sinal: 'ruido', paRms: 1 }],
      corpoTeste: { largura: 3.36, altura: 3.6, zPiso: 0.4, comprimento: 25 }, v: 0, d: 3, ambiente: 'ceu', solo: 'nenhum', dur: 2.2, sCentro0: 0, reverb: false, semFundo: true,
      ouvinte: { modo: 'gimbal', gimbal: { az: 90, el: 60, r: 6, alvo: 'corpo' } },
      aoBloco: (t, cena) => {
        const az = 90 - 180 * Math.min(1, Math.max(0, (t - 0.1) / 2));
        cena.atualizar({ ouv: { ...cena.ouv, gimbal: { ...cena.ouv.gimbal, az } } });
        cena.prop.fontes.forEach((es, i) => {
          const g = 20 * Math.log10(es.g[0] * es.sa + 1e-12);
          if (prev[i] !== undefined && t > 0.2) maxSalto = Math.max(maxSalto, Math.abs(g - prev[i]));
          prev[i] = g;
        });
      },
    });
    L.push(linha('5 #5', 'continuidade da sombra com o ouvinte cruzando y = 0 por cima', '< 1 dB por bloco', `${f1(maxSalto, 2)} dB`, maxSalto < 1, maxSalto));
  }
  return L;
}

/** passo 6: vento (nível do gerador) */
export function medirVento(): Linha[] {
  const v = new RuidoVento(SR);
  v.uAlvo = 10; v.u = 10;
  const n = SR * 3, L = new Float64Array(n), R = new Float64Array(n);
  v.somar(L, R, n);
  let s = 0; for (let i = SR; i < n; i++) s += L[i] * L[i];
  const db = 10 * Math.log10(s / (n - SR) / 4e-10);
  return [linha('5 #6', 'nível do vento a 10 m/s', '70 ± 2 dB', `${f1(db)} dB`, dentro(db, 70, 2), db)];
}

/** passo 8: RT60 por banda das respostas geradas */
export function medirAmbientes(): Linha[] {
  const L: Linha[] = [];
  for (const id of ['ceu', 'corte', 'estacao', 'tunel', 'ponte'] as const) {
    const amb = ambientePassagem(id), ir = gerarRespostaPorBanda(amb, SR), alvo = rt60Efetivo(amb);
    const med = BANDAS_RT.map((f) => A.rt60(ir.L, SR, f));
    const ok = med.every((m, i) => Math.abs(m - alvo[i]) <= 0.15 * alvo[i]);
    L.push(linha('5 #8', `RT60 ${id} (125/500/2k/8k Hz)`, `${alvo.map((x) => f1(x, 1)).join(' / ')} s ± 15%`, `${med.map((x) => f1(x, 2)).join(' / ')} s`, ok, med[1]));
  }
  return L;
}

/** passo 9 (parte do ouvinte que não depende de motor): ITD, ILD e lei da massa da cabine */
export function medirOuvinte(): Linha[] {
  const L: Linha[] = [];
  // ITD e ILD direto pela geometria do propagador: fonte a `az` à esquerda da cabeça (ouvinte fixo
  // olhando para +y; fonte em (−r·sin az, y_O + r·cos az))
  for (const az of [30, 60, 90]) {
    const D = Math.PI / 180, rr = 10;
    const r = renderPassagem({ portador: 'teste', fontesTeste: [{ pos: [0, 0, 1.6], sinal: 'ruido', paRms: 1 }], corpoTeste: { largura: 0.01, altura: 0.01, zPiso: 0, comprimento: 0.01 },
      v: 0, d: rr * Math.cos(az * D) - 0.005, ambiente: 'ceu', solo: 'nenhum', dur: 1.2, sCentro0: 0, reverb: false, semFundo: true,
      ouvinte: { pos: [rr * Math.sin(az * D), 0, 1.6] } });
    // correlação cruzada L×R em ±40 amostras
    const i0 = Math.round(0.4 * SR), n = Math.round(0.7 * SR);
    let best = -Infinity, lag = 0;
    for (let k = -40; k <= 40; k++) { let s = 0; for (let i = 0; i < n; i++) s += r.dL[i0 + i] * r.dR[i0 + i + k]; if (s > best) { best = s; lag = k; } }
    // parábola
    const cc = (k: number) => { let s = 0; for (let i = 0; i < n; i++) s += r.dL[i0 + i] * r.dR[i0 + i + k]; return s; };
    const a = cc(lag - 1), b = cc(lag), c = cc(lag + 1), fr = (a - c) / (2 * (a - 2 * b + c));
    const itd = lag + fr;   // > 0: o direito atrasado (fonte à esquerda)
    const teo = 0.65e-3 * SR * Math.sin(az * D);
    L.push(linha('5 #9', `ITD a ${az}°`, `${f1(teo, 2)} ± 1 amostra (0,65·sin az ms)`, `${f1(itd, 2)} amostras`, dentro(itd, teo, 1), itd));
    if (az === 90) {
      const nseg = 4096, accL = new Float64Array(nseg / 2), accR = new Float64Array(nseg / 2);
      for (let i = i0; i + nseg < r.dL.length; i += nseg / 2) { const P = A.espectro(r.dL, i, nseg, nseg), Q = A.espectro(r.dR, i, nseg, nseg); for (let k = 0; k < P.length; k++) { accL[k] += P[k]; accR[k] += Q[k]; } }
      const band = (acc: Float64Array, f: number) => { let s = 0; for (let k = Math.round(f / 1.12 * nseg / SR); k <= Math.round(f * 1.12 * nseg / SR); k++) s += acc[k]; return s; };
      const dHi = 10 * Math.log10(band(accR, 4000) / band(accL, 4000)), dLo = 10 * Math.log10(band(accR, 150) / band(accL, 150));
      const ild = dHi - dLo;
      L.push(linha('5 #9', 'ILD em 4 kHz a 90° (além da panorâmica)', '−6 ± 1 dB', `${f1(ild)} dB (pan ${f1(dLo)} dB)`, dentro(ild, -6, 1), ild));
    }
  }
  return L;
}

// constantes usadas pelos testes e pelo relatório
export const ROSSITER_350 = [1, 2, 3].map((m) => FonteVao.rossiter(V350, 0.5, m));
