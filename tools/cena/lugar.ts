// Grupo `lugar` do teste:cena (valida.ts): o ambiente que depende de onde se está (src/scene/lugar.ts; extensão de
// 23/11/2026 para a Passagem em primeira pessoa). Com `Ambiente.lugar` e o ouvinte livre, a reverberação, a ocultação
// do direto, o fundo, a onda do túnel e o chão da ponte passam a depender da posição do ouvinte e da fonte. As medidas
// do lugar são as da página (src/pages/passagem/lugar.ts e mundo/planta.ts), copiadas aqui para o teste não depender
// dela. O ouvinte fixo e o gimbal não leem o lugar: os outros grupos não mudam.
//
// O que mede (o caminho da página: o ouvinte livre; a reverberação feita aqui por convolução, como o ConvolverNode):
//  · túnel: o tempo de decaimento (EDT e T20, 500 Hz–2 kHz) de um ruído interrompido 60 m dentro, ouvido dentro, fora
//    na frente da boca e fora ao lado dela; o trem passando fora com o ouvinte fora (sem reverberação de túnel); o trem
//    entrando, ouvido de dentro; a onda de compressão fora da boca;
//  · estação e corte: a reverberação e o direto sob a cobertura e fora dela, no fundo do corte e no alto;
//  · ponte: no tabuleiro e embaixo, no vale (a laje na frente do direto, o ronco, o chão do vale);
//  · plataforma (o item da tela nova): o campo reverberante com o ouvido 0,9 m mais alto, na plataforma.
import type { Linha } from './medidas';
import { renderPassagem, SR, type ResultadoPassagem } from './render-passagem';
import { ambientePassagem, ambienteDoLugar, secaoTunel } from '../../src/scene/ambientes';
import type { Ambiente, IdAmbiente, LugarAcustico, Ouvinte, Vec3 } from '../../src/scene/tipos';
import { PA_FS } from '../../src/scene/constantes';
import { Bq } from '../../src/scene/filtros';
import * as A from './analise';

const f1 = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const sinal = (x: number, d = 1) => `${x >= 0 ? '+' : ''}${f1(x, d)}`;
const linha = (passo: string, nome: string, alvo: string, medido: string, ok: boolean, valor?: number | number[], unidade?: string): Linha => ({ passo, nome, alvo, medido, ok, valor, unidade });

// as medidas da página (lugar.ts: TUNEL, ESTACAO, CORTE, PONTE; planta.ts: ESTACAO_OUTRA, VALE)
const SEC = secaoTunel(64), TA = -500;
export const LUGARES: Record<'tunel' | 'estacao' | 'corte' | 'ponte', LugarAcustico> = {
  tunel: { tunel: { s0: TA, s1: TA + 2000, mLonge: -SEC.paredeOposta, mPerto: -SEC.paredeOuvinte, altura: SEC.altura, nicho: 1.1 } },
  // (a borda da plataforma a 0,35 m do trem de 3,36 m; a plataforma de 8 m e 2 m até a parede do fundo)
  estacao: { estacao: { s0: -160, s1: 160, mLonge: -15.6, mFundo: 1.68 + 0.35 + 8 + 2, teto: 7, mMuro: -15.2, muro: 2.6 } },
  corte: { corte: { m0: 8, m1: 20, alto: 12 } },
  ponte: { ponte: { m0: -3.7, m1: 8.5, espessura: 1.6, vale: -28, fundo: 170, borda: 330 } },
};
function amb(id: IdAmbiente, comLugar = true, semFundo = true): Ambiente {
  const a = ambientePassagem(id);
  if (semFundo) a.fundo = { vento: 0, ventilacao: 0, murmurio: 0 };
  if (comLugar && id in LUGARES) a.lugar = { ...LUGARES[id as keyof typeof LUGARES], fundoFora: a.fundo };
  return a;
}
/** ouvinte livre parado em (s, m, z), a cabeça para a via */
const livre = (s: number, m: number, z: number): Partial<Ouvinte> => ({ modo: 'livre', local: 'fora', livre: { ref: 'mundo', pos: [s, -m, z] as Vec3, vel: [0, 0, 0], rumo: 90, salto: 0 } });

/** L_eq (dB(A)) do total, do direto e da reverberação na janela de 10 dB em volta do máximo */
function niveis(r: ResultadoPassagem) {
  const n = r.L.length, rL = new Float32Array(n), rR = new Float32Array(n);
  for (let i = 0; i < n; i++) { rL[i] = r.L[i] - r.dL[i]; rR[i] = r.R[i] - r.dR[i]; }
  const serie = A.nivelF(r.L, r.R, SR, PA_FS, true, 480);
  let iM = 0; for (let i = 1; i < serie.length; i++) if (serie[i] > serie[iM]) iM = i;
  let a = iM, b = iM; while (a > 0 && serie[a - 1] >= serie[iM] - 10) a--; while (b < serie.length - 1 && serie[b + 1] >= serie[iM] - 10) b++;
  const i0 = a * 480, i1 = Math.min(n, (b + 1) * 480);
  return { total: A.leq(r.L, r.R, SR, PA_FS, i0, i1), dir: A.leq(r.dL, r.dR, SR, PA_FS, i0, i1), rev: A.leq(rL, rR, SR, PA_FS, i0, i1), lmax: serie[iM], i0, i1 };
}
/** nível de banda (dB) de um sinal estéreo num trecho */
function banda(L: Float32Array, R: Float32Array, i0: number, i1: number, fa: number, fb: number) {
  return 10 * Math.log10(A.bandas([L, R], SR, i0, i1, [[fa, fb]])[0] + 1e-30);
}

/**
 * Tempo de decaimento de um ruído interrompido (banda de 500 Hz a 2 kHz): EDT (0 a −10 dB, ×6) e T20 (−5 a −25, ×3) da
 * curva de Schroeder do total (direto + reverberação), a partir do instante em que o direto para de chegar.
 */
function decaimento(lug: boolean, s: number, m: number, z: number) {
  const tC = 4, sF = TA + 60;
  const r = renderPassagem({
    portador: 'teste', fontesTeste: [{ pos: [0, 0, 1.2], sinal: 'ruido', paRms: 1 }], corpoTeste: { largura: 0.05, altura: 0.05, zPiso: 0, comprimento: 0.05 },
    v: 0, d: 3, amb: amb('tunel', lug), dur: tC + 7, sCentro0: sF, ouvinte: livre(s, m, z),
    antesBloco: (t, p) => { if (t >= tC) ((p as unknown as { esp: { paRms: number }[] }).esp[0].paRms = 0); },
  });
  const f: Bq[] = []; for (let i = 0; i < 4; i++) f.push(new Bq().hp(SR, 500), new Bq().lp(SR, 2000));
  const g: Bq[] = []; for (let i = 0; i < 4; i++) g.push(new Bq().hp(SR, 500), new Bq().lp(SR, 2000));
  const n = r.L.length, y = new Float64Array(n);
  for (let i = 0; i < n; i++) { let a = r.L[i], b = r.R[i]; for (const q of f) a = q.run(a); for (const q of g) b = q.run(b); y[i] = a * a + b * b; }
  const dist = Math.hypot(s - sF, m, z - 1.2), i0 = Math.round((tC + dist / 343 - 0.005) * SR);
  const sch = new Float64Array(n - i0); let acc = 0;
  for (let i = n - 1; i >= i0; i--) { acc += y[i]; sch[i - i0] = acc; }
  const db = (k: number) => 10 * Math.log10(sch[k] / sch[0] + 1e-30);
  const quando = (lim: number) => { for (let k = 0; k < sch.length; k++) if (db(k) <= lim) return k / SR; return NaN; };
  const t5 = quando(-5), t25 = quando(-25);
  return { edt: 6 * quando(-10), t20: 3 * (t25 - t5) };
}

export function medirLugar(): Linha[] {
  const L: Linha[] = [];
  const P = 'lugar';
  // ---------------------------------------------------------------- túnel
  {
    // ruído interrompido 60 m dentro, na via: dentro (na passarela, 40 m da fonte), fora na frente da boca (o mesmo lado
    // da via, 40 m fora: visada pelo tubo) e fora ao lado dela (30 m para o lado da testa: a borda na frente)
    const d = decaimento(true, TA + 20, 4.68, 2.35), fe = decaimento(true, TA - 40, 4.68, 1.6), fl = decaimento(true, TA - 10, 30, 1.6), sem = decaimento(false, TA - 40, 4.68, 1.6);
    L.push(linha(P, 'túnel: tempo de decaimento (EDT, 500 Hz–2 kHz) fora da boca, na frente dela, contra dentro', 'fora < dentro',
      `dentro ${f1(d.edt, 2)} s (T20 ${f1(d.t20, 2)}), fora na frente ${f1(fe.edt, 2)} s (T20 ${f1(fe.t20, 2)}; sem o lugar ${f1(sem.edt, 2)} s), fora ao lado da boca ${f1(fl.edt, 2)} s (T20 ${f1(fl.t20, 2)})`,
      fe.edt < d.edt, [d.edt, fe.edt, fl.edt], 's'));
  }
  {
    // o trem (10×25 m, 350 km/h) passando fora, 300 m antes da boca, com o ouvinte fora a 3 m da lateral: a
    // reverberação do túnel some (comparada com a do céu aberto e com a do ouvinte no ponto de chegada, 500 m dentro)
    // (via de 6 km: o trem começa 900 m antes da boca sem dar a volta na ponta da reta)
    const fora = niveis(renderPassagem({ portador: 'trem', v: 350 / 3.6, d: 3, amb: amb('tunel'), dur: 9, comprimentoVia: 6000, sCentro0: TA - 300 - 600 - 125, ouvinte: livre(TA - 300, 4.68, 1.6) }));
    const ceu = niveis(renderPassagem({ portador: 'trem', v: 350 / 3.6, d: 3, amb: amb('ceu'), dur: 12, x0: 600, ouvinte: livre(0, 4.68, 1.6) }));
    const dentro = niveis(renderPassagem({ portador: 'trem', v: 350 / 3.6, d: 3, amb: amb('tunel'), dur: 12, x0: 600, ouvinte: livre(0, 4.68, 1.6) }));
    const rf = fora.rev - fora.dir, rc = ceu.rev - ceu.dir, rd = dentro.rev - dentro.dir;
    L.push(linha(P, 'túnel: trem fora e ouvinte fora (300 m antes da boca): reverberação − direto', `≤ a do céu aberto + 3 dB (${sinal(rc)} dB)`,
      `${sinal(rf)} dB (céu ${sinal(rc)}; dentro, no ponto de chegada, ${sinal(rd)}); L_Aeq ${f1(fora.total)} dB(A)`, rf <= rc + 3, rf, 'dB'));
  }
  {
    // o trem entrando, ouvido 100 m dentro: o campo reverberante com o nariz 150 m fora da boca e 150 m dentro
    const r = renderPassagem({ portador: 'trem', v: 350 / 3.6, d: 3, amb: amb('tunel'), dur: 5, sCentro0: TA - 300 - 125, ouvinte: livre(TA + 100, 4.68, 2.35), reverb: true });
    const n = r.L.length, rl = new Float32Array(n), rr = new Float32Array(n);
    for (let i = 0; i < n; i++) { rl[i] = r.L[i] - r.dL[i]; rr[i] = r.R[i] - r.dR[i]; }
    const tFora = (300 - 150) / (350 / 3.6), tDentro = (300 + 150) / (350 / 3.6), j = Math.round(0.25 * SR);
    const nv = (t: number) => A.leq(rl, rr, SR, PA_FS, Math.round(t * SR) - j, Math.round(t * SR) + j);
    const d = nv(tDentro) - nv(tFora);
    L.push(linha(P, 'túnel: o trem entrando, ouvido 100 m dentro: reverberação com o nariz 150 m dentro − 150 m fora', '≥ +20 dB (fora, só o que entra pela boca)',
      `${sinal(d)} dB (${f1(nv(tFora))} → ${f1(nv(tDentro))} dB(A))`, d >= 20, d, 'dB'));
  }
  {
    // a onda de compressão: no ponto de chegada (500 m dentro) e 50 m fora da boca de entrada
    const pico = (r: ResultadoPassagem) => Math.max(...r.tele.p.map(Math.abs));
    const den = renderPassagem({ portador: 'trem', v: 350 / 3.6, d: 3, amb: amb('tunel'), dur: 9, x0: 600, ouvinte: livre(0, 4.68, 2.35), reverb: false });
    const fora = renderPassagem({ portador: 'trem', v: 350 / 3.6, d: 3, amb: amb('tunel'), dur: 9, sCentro0: TA - 125 - 30, ouvinte: livre(TA - 50, 30, 1.6), reverb: false });
    // (fora, a onda de compressão começa quando o nariz entra; o nariz e a cauda passam longe: 30 m da via)
    const pd = pico(den), pf = Math.max(...fora.tele.p.slice(Math.round(0.6 * SR / 128)).map(Math.abs));
    L.push(linha(P, 'túnel: onda de compressão 50 m fora da boca (30 m da via) contra 500 m dentro', '≤ −15 dB (a boca irradia como um pistão: a/(a + d))',
      `${f1(pf, 0)} Pa contra ${f1(pd, 0)} Pa (${sinal(20 * Math.log10(pf / pd))} dB)`, pf / pd <= Math.pow(10, -15 / 20), 20 * Math.log10(pf / pd), 'dB'));
  }
  // ---------------------------------------------------------------- estação
  {
    // trem convencional (8 vagões, 120 km/h): sob a cobertura (na plataforma, 2 m da lateral) e fora (140 m além da
    // ponta da estação, no chão, 2 m da lateral), o trem passando em cada um
    const v = 120 / 3.6, trem = { N: 8 };
    const den = niveis(renderPassagem({ portador: 'trem', trem, v, d: 2, amb: amb('estacao'), dur: 14, x0: 150, ouvinte: livre(0, 3.68, 2.5) }));
    const fora = niveis(renderPassagem({ portador: 'trem', trem, v, d: 2, amb: amb('estacao'), dur: 14, sCentro0: 300 - 150 - 100, ouvinte: livre(300, 3.68, 1.6) }));
    const ceu = niveis(renderPassagem({ portador: 'trem', trem, v, d: 2, amb: amb('ceu'), dur: 14, x0: 150, ouvinte: livre(0, 3.68, 1.6) }));
    const rd = den.rev - den.dir, rf = fora.rev - fora.dir, rc = ceu.rev - ceu.dir;
    L.push(linha(P, 'estação: reverberação − direto fora da cobertura (140 m além da ponta) contra sob ela', `fora ≤ céu aberto + 3 dB (${sinal(rc)} dB)`,
      `sob a cobertura ${sinal(rd)} dB, fora ${sinal(rf)} dB (céu ${sinal(rc)})`, rf <= rc + 3, [rd, rf], 'dB'));
  }
  {
    // o item 3 da tela nova: com o ouvido na plataforma (0,9 m mais alto) o campo reverberante é o do lugar, não cai com
    // a sombra do corpo vista de cima (antes de 23/11/2026, −3,5 dB); o direto dos truques cai (o corpo os esconde)
    const v = 120 / 3.6, trem = { N: 8 };
    const alto = niveis(renderPassagem({ portador: 'trem', trem, v, d: 2, amb: amb('estacao'), dur: 14, x0: 150, ouvinte: livre(0, 3.68, 2.5) }));
    const baixo = niveis(renderPassagem({ portador: 'trem', trem, v, d: 2, amb: amb('estacao'), dur: 14, x0: 150, ouvinte: livre(0, 3.68, 1.6) }));
    const dr = alto.rev - baixo.rev, dd = alto.dir - baixo.dir;
    L.push(linha(P, 'plataforma: o campo reverberante com o ouvido a 2,5 m (na plataforma) − a 1,6 m', '0 ± 1,5 dB (a potência que o trem põe na estação não depende da altura de quem ouve)',
      `${sinal(dr)} dB (o direto ${sinal(dd)} dB: o corpo esconde os truques de quem está mais alto); L_AFmax ${f1(alto.lmax)} contra ${f1(baixo.lmax)} dB(A)`, Math.abs(dr) <= 1.5, dr, 'dB'));
  }
  // ---------------------------------------------------------------- corte
  {
    // trem regional (160 km/h): no fundo do corte a 4 m da lateral e no alto, 10 m além da borda do talude; o direto no
    // alto com o lugar contra o mesmo ponto sem ele (a borda na frente)
    const v = 160 / 3.6, trem = { N: 4 };
    const fundo = niveis(renderPassagem({ portador: 'trem', trem, v, d: 4, amb: amb('corte'), dur: 12, x0: 200, ouvinte: livre(0, 5.68, 1.6) }));
    const alto = niveis(renderPassagem({ portador: 'trem', trem, v, d: 4, amb: amb('corte'), dur: 12, x0: 200, ouvinte: livre(0, 30, 13.6) }));
    const altoSem = niveis(renderPassagem({ portador: 'trem', trem, v, d: 4, amb: amb('corte', false), dur: 12, x0: 200, ouvinte: livre(0, 30, 13.6) }));
    const dRev = alto.rev - fundo.rev, dDir = alto.dir - altoSem.dir;
    L.push(linha(P, 'corte: no alto (10 m além da borda) a reverberação cai e a borda tapa o direto', 'reverberação ≤ −6 dB do fundo; direto ≤ −5 dB do mesmo ponto sem o corte',
      `reverberação ${sinal(dRev)} dB, direto ${sinal(dDir)} dB; L_Aeq ${f1(alto.total)} no alto, ${f1(fundo.total)} dB(A) no fundo`, dRev <= -6 && dDir <= -5, [dRev, dDir], 'dB'));
  }
  // ---------------------------------------------------------------- o piso sob o ouvinte (a plataforma)
  {
    // ruído parado na lateral de um trem (m 1,69, z 1,8) e o ouvido na plataforma (m 4,5, z 2,5): o reflexo é o do piso
    // da plataforma (0,9 m), e o primeiro nulo do pente fica em c/(2Δr) com a imagem do ouvido nesse plano, não no da via
    const ms = 1.69, zs = 1.8, mo = 4.5, zo = 2.5, c = 343;
    const nulo = (zp: number) => c / (2 * (Math.hypot(mo - ms, zo + zs - 2 * zp) - Math.hypot(mo - ms, zo - zs)));
    const a = amb('estacao');
    a.lugar = { ...a.lugar!, pisos: [{ s0: -160, s1: 160, m0: 2.03, m1: 12.03, z: 0.9 }] };
    const r = renderPassagem({
      portador: 'teste', fontesTeste: [{ pos: [0, -ms, zs], sinal: 'ruido', paRms: 1 }], corpoTeste: { largura: 0.05, altura: 0.05, zPiso: 0, comprimento: 0.05 },
      v: 0, d: 3, amb: a, dur: 6, sCentro0: 0, reverb: false, ouvinte: { ...livre(0, mo, zo), binaural: false },
    });
    // espectro médio do direto de 1 a 6 s, resolução de 1,5 Hz; o mínimo entre 120 e 320 Hz
    const nseg = 32768, acc = new Float64Array(nseg / 2);
    for (let i = SR; i + nseg <= r.dL.length; i += nseg / 2) { const P = A.espectro(r.dL, i, nseg, nseg); for (let k = 0; k < P.length; k++) acc[k] += P[k]; }
    let kMin = Math.round((120 * nseg) / SR);
    for (let k = kMin; k <= Math.round((320 * nseg) / SR); k++) if (acc[k] < acc[kMin]) kMin = k;
    const f = (kMin * SR) / nseg, fPiso = nulo(0.9), fVia = nulo(0);
    L.push(linha(P, 'plataforma: o reflexo de uma fonte acima dela é o do piso (primeiro nulo do pente)', `c/(2Δr) com o plano a 0,9 m: ${f1(fPiso, 0)} Hz ± 5% (o chão da via daria ${f1(3 * fVia, 0)} Hz)`,
      `${f1(f, 0)} Hz`, Math.abs(f / fPiso - 1) <= 0.05, f, 'Hz'));
  }
  // ---------------------------------------------------------------- estação subterrânea (o metrô)
  {
    // a caixa de azulejo, 160 m, as pontas dando nos túneis: ruído parado no meio da estação, na via; o campo
    // reverberante na plataforma e no túnel, 100 m além da ponta (o campo guiado cai como o do túnel, d₀ = √S)
    const lug: LugarAcustico = { estacao: { s0: -80, s1: 80, mLonge: -10.6, mFundo: 7.55, teto: 5.4, tipo: 'subterranea' }, fundoFora: { vento: 0, ventilacao: 0, murmurio: 0 } };
    const a = ambienteDoLugar(amb('estacao', false), lug), cob = amb('estacao');
    const ouvir = (x: Ambiente, s: number, m: number, z: number) => renderPassagem({
      portador: 'teste', fontesTeste: [{ pos: [0, 0, 1.0], sinal: 'ruido', paRms: 1 }], corpoTeste: { largura: 0.05, altura: 0.05, zPiso: 0, comprimento: 0.05 },
      v: 0, d: 3, amb: x, dur: 6, sCentro0: 0, ouvinte: livre(s, m, z),
    });
    const nv = (r: ResultadoPassagem) => { const n = r.L.length, rl = new Float32Array(n), rr = new Float32Array(n); for (let i = 0; i < n; i++) { rl[i] = r.L[i] - r.dL[i]; rr[i] = r.R[i] - r.dR[i]; } return { rev: A.leq(rl, rr, SR, PA_FS, 2 * SR, n), dir: A.leq(r.dL, r.dR, SR, PA_FS, 2 * SR, n) }; };
    const pl = nv(ouvir(a, 10, 3.68, 2.5)), pc = nv(ouvir(cob, 10, 3.68, 2.5)), tu = nv(ouvir(a, 180, 3.68, 1.6));
    const S = (7.55 + 10.6) * 5.4, esperado = -10 * Math.log10(1 + Math.pow(100 / Math.sqrt(S), 1.6));
    const dSub = pl.rev - pc.rev;
    L.push(linha(P, 'estação subterrânea: o campo reverberante na plataforma contra a coberta; e 100 m túnel adentro', `na plataforma ≥ +5 dB sobre a coberta (a caixa fechada: wet pela área de absorção); no túnel ≤ −10 dB (o acoplamento guiado, ${f1(esperado)} dB, mais a distância)`,
      `plataforma ${sinal(dSub)} dB sobre a coberta (reverberação − direto ${sinal(pl.rev - pl.dir)} contra ${sinal(pc.rev - pc.dir)}; wet ${f1(a.reverb.wet, 2)}, RT ${a.reverb.rt60!.map((x) => f1(x, 1)).join('/')} s); no túnel ${sinal(tu.rev - pl.rev)} dB`, dSub >= 5 && tu.rev - pl.rev <= -10, [dSub, tu.rev - pl.rev], 'dB'));
  }
  // ---------------------------------------------------------------- ponte
  {
    // trem-bala a 320 km/h: no passeio do tabuleiro (5 m da lateral) e embaixo, no vale, debaixo da via e 40 m ao lado
    const v = 320 / 3.6;
    const tab = renderPassagem({ portador: 'trem', v, d: 5, amb: amb('ponte'), dur: 12, x0: 600, ouvinte: livre(0, 6.68, 1.8) });
    const sob = renderPassagem({ portador: 'trem', v, d: 5, amb: amb('ponte'), dur: 12, x0: 600, ouvinte: livre(0, 0, -26.4) });
    const lado = renderPassagem({ portador: 'trem', v, d: 5, amb: amb('ponte'), dur: 12, x0: 600, ouvinte: livre(0, 40, -26.4) });
    const nt = niveis(tab), i0 = nt.i0, i1 = nt.i1;
    const b = (r: ResultadoPassagem, fa: number, fb: number) => banda(r.L, r.R, i0, i1, fa, fb);
    const dAlto = b(sob, 1000, 4000) - b(tab, 1000, 4000), dGrave = b(sob, 31, 125) - b(tab, 31, 125), dLado = b(lado, 1000, 4000) - b(tab, 1000, 4000);
    const ok = dAlto <= -25 && dGrave > dAlto + 10 && sob.cena.modoVale;
    L.push(linha(P, 'ponte: embaixo, no vale, a laje tapa o trem e fica o ronco', '1–4 kHz ≤ −25 dB do tabuleiro; 31–125 Hz cai bem menos (o ronco da laje)',
      `debaixo da via: 1–4 kHz ${sinal(dAlto)} dB, 31–125 Hz ${sinal(dGrave)} dB; 40 m ao lado: 1–4 kHz ${sinal(dLado)} dB; chão do vale ${sob.cena.modoVale ? 'sim' : 'não'}`,
      ok, [dAlto, dGrave], 'dB'));
  }
  return L;
}
