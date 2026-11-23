// Ouvinte em movimento (modo 'livre' da Cena: a câmera da página Passagem, docs/CENA.md 3): andar, correr e voar
// não podem dar estalo nem "zíper", e o Doppler de quem anda tem de sair da variação do atraso de cada fonte.
//
//   npx tsx tools/cena/ouvinte-movel.ts [--wav pasta]
//
// Bancada: uma fonte tonal parada (1 kHz, PortadorTeste), céu aberto sem solo, sem fundo e sem sombra (só a
// propagação), e o ouvinte passando por ela a 3 m, em linha reta, a 1,5, 6 e 20 m/s (andar, correr, voar). As
// mensagens chegam como as da página: uma a cada ~33 ms com atraso e espera sorteados (±8 ms), com a posição e a
// velocidade do instante em que o quadro foi desenhado, e o ouvinte sai do repouso com a aceleração da página.
// O que confere, em cada velocidade:
//   · degrau amostra a amostra: |x[n] − x[n−1]| contra o máximo de um seno da mesma amplitude e frequência,
//     2·A·sen(π·f′/fs), com A a amplitude local (máximo de |x| em ±1 período); acima de 1,02 é descontinuidade;
//   · resíduo acima de 5 kHz (passa-alta de 8ª ordem) em relação à amplitude local: um estalo é largo e aparece
//     aqui; o tom de 1 kHz limpo fica perto de −110 dB;
//   · zíper: bandas laterais do tom (±25 Hz a ±1,5 kHz, janela Blackman-Harris de 0,5 s) em relação ao pico; o
//     atraso que muda aos degraus de bloco (64 amostras, 750 Hz) daria uma modulação de 750 Hz e bandas laterais;
//   · Doppler: frequência média por cruzamentos de zero (com interpolação) chegando e indo, contra
//     f₀·(1 + v·cos θ/c) médio na mesma janela; o desvio medido tem de ficar a ±5% do esperado.
// E mais: um salto (teletransporte de 25 m) e o giro da cabeça (360° em 0,5 s, binaural) sem estalo; o ouvinte livre
// parado no ponto do fixo, de frente para a via, igual ao fixo amostra a amostra (a API antiga e a nova dão o mesmo
// som); e, como controle negativo, o mesmo passeio a 20 m/s pelo jeito antigo (o fixo arrastado por mensagens, com
// a rampa de 20 ms e a velocidade do ouvinte em zero), que tem de acusar zíper.
// Código de saída ≠ 0 se alguma conferência falhar.
import fs from 'node:fs';
import path from 'node:path';
import { CenaPassagem } from '../../src/scene/cena';
import { ambientePassagem, secaoTunel } from '../../src/scene/ambientes';
import { PortadorTeste } from '../../src/carriers/teste';
import { C_SOM } from '../../src/scene/constantes';
import { Bq } from '../../src/scene/filtros';
import type { Ambiente, Ouvinte, Trajetoria, Vec3 } from '../../src/scene/tipos';
import { RNG } from '../../src/acoustics/rng';
import { fft, proxPot2 } from './analise';
import { gravarWav } from '../wav';

const FS = 48000, B = 128, F0 = 1000, D = 3, Z = 1.6;
const argv = process.argv.slice(2);
const pastaWav = (() => { const i = argv.indexOf('--wav'); return i >= 0 ? argv[i + 1] : null; })();

function ambiente(): Ambiente {
  const a = ambientePassagem('ceu');
  a.solo = { tipo: 'nenhum' };
  a.fundo = { vento: 0, ventilacao: 0, murmurio: 0 };
  return a;
}
const TRAJ: Trajetoria = { tipo: 'reta', comprimento: 3000, raioCurva: 2000, lateral: D, altitude: 0, sentido: 1 };
const base = (o: Partial<Ouvinte>): Ouvinte => ({ modo: 'livre', pos: [0, 0, Z], gimbal: { az: 90, el: 0, r: 5, alvo: 'corpo' }, local: 'fora', binaural: false, ...o });

/** fonte tonal parada no centro do corpo (um corpo de 0,3 m: nada de sombra nem de cabine) */
function fonte(vFonte = 0) {
  const p = new PortadorTeste(FS, [{ pos: [0, 0, 1.2], sinal: 'tom', f: F0, paRms: 1, refDist: 7.5 }], { comprimento: 0.3, largura: 0.3, altura: 0.3, zPiso: 0 });
  p.comandar({ pedal: 0, velocidadeFixa: vFonte });
  return p;
}

interface Passeio {
  /** posição e velocidade do ouvinte no instante t (o que a página desenharia) */
  traj: (t: number) => { pos: Vec3; vel: Vec3; rumo: number };
  dur: number;
  binaural?: boolean;
  /** saltos: instantes em que o contador muda (teletransporte) */
  saltos?: number[];
  /** o jeito antigo: o ouvinte fixo movido por mensagens (posição ao longo da via e lateral) */
  antigo?: boolean;
  /** modo da Cena (sem mensagens: o ouvinte fica onde configurou) */
  fixo?: Ouvinte;
  fonteV?: number; sFonte0?: number;
  /** (o lugar) ambiente com `lugar` e a sombra ligada (a ocultação pelo lugar anda com a sombra do corpo) */
  amb?: Ambiente;
}

/** toca o passeio e devolve L e R */
function tocar(p: Passeio) {
  const cena = new CenaPassagem({ semSombra: !p.amb });
  const port = fonte(p.fonteV ?? 0);
  (port.cinematica as { s: number }).s = p.sFonte0 ?? 0;
  // (o relógio da página anda adiantado 12,345 s do do áudio: a Cena só pode usar a diferença entre os dois)
  const RELOGIO = 12.345;
  const ouvDe = (t: number, salto: number): Ouvinte => {
    const e = p.traj(t);
    if (p.antigo) return base({ modo: 'fixo', pos: [e.pos[0], 0, e.pos[2]], binaural: !!p.binaural });
    return base({ binaural: !!p.binaural, livre: { ref: 'mundo', pos: e.pos, vel: e.vel, rumo: e.rumo, salto, t: t + RELOGIO } });
  };
  const traj0: Trajetoria = { ...TRAJ };
  if (p.antigo) traj0.lateral = -p.traj(0).pos[1] - 0.15;   // (a lateral do fixo é medida da face do corpo de 0,3 m)
  cena.configurar(p.amb ?? ambiente(), traj0, p.fixo ?? ouvDe(0, 0), FS);
  const n = Math.round(p.dur * FS);
  const L = new Float32Array(n), R = new Float32Array(n), sL = new Float32Array(n);
  const bl = new Float32Array(B), br = new Float32Array(B), el = new Float32Array(B), er = new Float32Array(B);
  const canais = [new Float32Array(B)];
  const rng = new RNG(0x0b5e);
  // mensagens: um quadro a cada 33 ms ± 8 ms, com a posição e a velocidade do instante do quadro; a mensagem chega à
  // Cena 0–6 ms depois (a fila do worklet), no começo do bloco de áudio seguinte
  let tQuadro = 0.033, salto = 0, iSalto = 0;
  const fila: { chega: number; m: Ouvinte; traj?: Trajetoria }[] = [];
  for (let i = 0; i < n; i += B) {
    const t = i / FS;
    if (!p.fixo) {
      while (tQuadro <= t + 0.05) {
        while (p.saltos && iSalto < p.saltos.length && p.saltos[iSalto] <= tQuadro) { salto++; iSalto++; }
        fila.push({ chega: tQuadro + 0.003 + 0.003 * rng.bi(), m: ouvDe(tQuadro, salto), traj: p.antigo ? { ...traj0, lateral: -p.traj(tQuadro).pos[1] - 0.15 } : undefined });
        tQuadro += 0.033 + 0.008 * rng.bi();
      }
      while (fila.length && fila[0].chega <= t) { const f = fila.shift()!; cena.atualizar(f.traj ? { ouv: f.m, traj: f.traj } : { ouv: f.m }); }
    }
    port.processar(canais, B, 1 / FS);
    cena.processar(port, canais, bl, br, el, er, B);
    const m = Math.min(B, n - i);
    L.set(bl.subarray(0, m), i); R.set(br.subarray(0, m), i); sL.set(el.subarray(0, m), i);
  }
  return { L, R, sL, cena };
}

// ------------------------------------------------------------------ medidas
/**
 * amplitude local: máximo de |x| em ±1 período, com piso de 5% da mediana (no fundo de um salto o tom some, e a razão
 * de qualquer resto contra uma amplitude perto de zero não diz nada; um estalo ali continua aparecendo contra o piso)
 */
function amplitude(x: Float32Array) {
  const P = Math.ceil(FS / F0 * 1.1), n = x.length, a = new Float32Array(n);
  // (máximo deslizante simples: P pequeno)
  for (let i = 0; i < n; i++) { let m = 0; const i0 = Math.max(0, i - P), i1 = Math.min(n - 1, i + P); for (let k = i0; k <= i1; k++) { const v = Math.abs(x[k]); if (v > m) m = v; } a[i] = m; }
  const ord = Array.from(a.subarray(Math.floor(n / 10))).sort((u, v) => u - v), piso = 0.05 * ord[Math.floor(ord.length / 2)];
  for (let i = 0; i < n; i++) if (a[i] < piso) a[i] = piso;
  return a;
}
/** maior razão |Δx| / (2·A·sen(π·f′/fs)) entre ini e fim (amostras), com f′ o máximo esperado */
function degrau(x: Float32Array, A: Float32Array, ini: number, fim: number, fMax: number) {
  const k = 2 * Math.sin((Math.PI * fMax) / FS);
  let pior = 0, onde = ini;
  for (let i = Math.max(1, ini); i < fim; i++) {
    const r = Math.abs(x[i] - x[i - 1]) / (k * A[i]);
    if (r > pior) { pior = r; onde = i; }
  }
  return { pior, t: onde / FS };
}
/** resíduo acima de 5 kHz (passa-alta Butterworth de 8ª ordem) em relação à amplitude local, dB (o pior) */
function residuoAgudo(x: Float32Array, A: Float32Array, ini: number, fim: number) {
  const q = [0.5098, 0.6013, 0.9000, 2.5629];   // Q das 4 seções de um Butterworth de 8ª ordem
  const f = q.map((Q) => new Bq().hp(FS, 5000, Q));
  let pior = -Infinity, onde = ini;
  for (let i = 0; i < fim; i++) {
    let y = x[i];
    for (const b of f) y = b.run(y);
    if (i >= ini + 2000) { const d = 20 * Math.log10(Math.abs(y) / A[i] + 1e-12); if (d > pior) { pior = d; onde = i; } }
  }
  return { db: pior, t: onde / FS };
}
/** pior banda lateral (dB rel. ao pico) entre ±`perto` Hz e ±1,5 kHz, janela Blackman-Harris de `jan` s em t0 */
function bandasLaterais(x: Float32Array, t0: number, jan = 0.5, perto = 25) {
  const n = Math.round(jan * FS), i0 = Math.round(t0 * FS), N = proxPot2(n) * 4;
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < n; i++) {
    const u = (2 * Math.PI * i) / (n - 1);
    const w = 0.35875 - 0.48829 * Math.cos(u) + 0.14128 * Math.cos(2 * u) - 0.01168 * Math.cos(3 * u);
    re[i] = x[i0 + i] * w;
  }
  fft(re, im);
  const mag = (k: number) => Math.hypot(re[k], im[k]);
  let kp = 0; for (let k = 1; k < N / 2; k++) if (mag(k) > mag(kp)) kp = k;
  const fp = (kp * FS) / N, pico = mag(kp);
  let pior = -Infinity, fPior = 0;
  for (let k = 1; k < N / 2; k++) {
    const f = (k * FS) / N, df = Math.abs(f - fp);
    if (df < perto || df > 1500) continue;
    const d = 20 * Math.log10(mag(k) / pico + 1e-15);
    if (d > pior) { pior = d; fPior = f; }
  }
  return { db: pior, f: fPior, fPico: fp };
}
/** frequência média por cruzamentos de zero ascendentes (interpolados) entre t0 e t1 */
function freqMedia(x: Float32Array, t0: number, t1: number) {
  const i0 = Math.round(t0 * FS), i1 = Math.round(t1 * FS);
  let primeiro = NaN, ultimo = NaN, n = 0;
  for (let i = i0 + 1; i < i1; i++) {
    if (x[i - 1] < 0 && x[i] >= 0) {
      const tc = (i - 1 + -x[i - 1] / (x[i] - x[i - 1])) / FS;
      if (Number.isNaN(primeiro)) primeiro = tc; else n++;
      ultimo = tc;
    }
  }
  return n / (ultimo - primeiro);
}

// ------------------------------------------------------------------ passeios
const resultados: { nome: string; ok: boolean; txt: string }[] = [];
const conferir = (nome: string, ok: boolean, txt: string) => { resultados.push({ nome, ok, txt }); console.log(`${ok ? 'ok   ' : 'FALHA'} ${nome}: ${txt}`); };
const salvar = (nome: string, L: Float32Array, R: Float32Array) => {
  if (!pastaWav) return;
  fs.mkdirSync(pastaWav, { recursive: true });
  gravarWav(path.join(pastaWav, `${nome}.wav`), L, R, FS);
};

/** passeio em linha reta a y = −D, de −X a +X na velocidade v, saindo do repouso com a aceleração da página (τ 0,12 s) */
function passeioReto(v: number, X: number) {
  const tau = 0.12, x0 = -X;
  // x(t) = x0 + v·(t − τ·(1 − e^(−t/τ))): a velocidade sobe de 0 a v com a constante de tempo da página
  const traj = (t: number) => {
    const e = Math.exp(-t / tau);
    return { pos: [x0 + v * (t - tau * (1 - e)), -D, Z] as Vec3, vel: [v * (1 - e), 0, 0] as Vec3, rumo: 0 };
  };
  return { traj, dur: (2 * X) / v + 1 };
}

const VELOCIDADES: [string, number, number][] = [['andando', 1.5, 45], ['correndo', 6, 75], ['voando', 20, 220]];
for (const [nome, v, X] of VELOCIDADES) {
  const ps = passeioReto(v, X);
  const { L } = tocar({ traj: ps.traj, dur: ps.dur });
  salvar(`passeio-${nome}`, L, L);
  // o regime: o mesmo caminho relativo com o ouvinte fixo e a fonte andando (o caso de sempre da Cena). O filtro do ar
  // troca de fio para passa-baixa perto de 10 m num degrau de coeficiente (−48 dB contra o tom, igual nos dois): é do
  // propagador, não do ouvinte que anda, e fica como está (os números da Cena não mudam)
  const fixo: Ouvinte = { modo: 'fixo', pos: [0, 0, Z], gimbal: { az: 90, el: 0, r: 5, alvo: 'corpo' }, local: 'fora', binaural: false };
  const rg = tocar({ traj: ps.traj, dur: ps.dur, fixo, fonteV: v, sFonte0: -X - 0.15 + 0.15 });
  salvar(`regime-${nome}`, rg.L, rg.L);
  const A = amplitude(L), Ar = amplitude(rg.L);
  // depois de 1 s (o anel e o filtro do ar assentam) até o fim
  const ini = FS, fim = L.length - 2 * FS / F0;
  const fMax = F0 * (1 + v / C_SOM), fMaxR = F0 / (1 - v / C_SOM);
  const dg = degrau(L, A, ini, fim, fMax), ra = residuoAgudo(L, A, ini, fim);
  const dgR = degrau(rg.L, Ar, ini, fim, fMaxR), raR = residuoAgudo(rg.L, Ar, ini, fim);
  // janelas chegando e indo: |x| entre 8·D e X − 2 s de caminho
  const tDe = (x: number) => (x + X) / v + 0.12;    // (o atraso de partida: τ)
  const xa = Math.min(X - 2 * v, X * 0.9), xb = 8 * D;
  const ja: [number, number] = [tDe(-xa), tDe(-xb)], jb: [number, number] = [tDe(xb), tDe(xa)];
  const esperado = (t0: number, t1: number) => {
    let s = 0, k = 0;
    for (let t = t0; t <= t1; t += 0.001) { const e = ps.traj(t); const r = Math.hypot(e.pos[0], e.pos[1], e.pos[2] - 1.2); s += (v * -e.pos[0]) / r; k++; }
    return s / k / C_SOM;   // desvio relativo médio: v·cos θ/c
  };
  for (const [rot, j] of [['chegando', ja], ['indo', jb]] as const) {
    const fm = freqMedia(L, j[0], j[1]), dm = fm / F0 - 1, de = esperado(j[0], j[1]);
    conferir(`${nome} ${v} m/s · Doppler ${rot}`, Math.abs(dm - de) <= 0.05 * Math.abs(de), `${(100 * dm).toFixed(3)}% (esperado ${(100 * de).toFixed(3)}%, diferença ${(100 * Math.abs(dm / de - 1)).toFixed(2)}% do desvio)`);
  }
  conferir(`${nome} ${v} m/s · degrau amostra a amostra`, dg.pior <= Math.max(1.02, dgR.pior + 0.005), `${dg.pior.toFixed(4)} do máximo de um seno (pior em ${dg.t.toFixed(2)} s; regime ${dgR.pior.toFixed(4)})`);
  conferir(`${nome} ${v} m/s · resíduo acima de 5 kHz`, ra.db <= Math.max(-70, raR.db + 1), `${ra.db.toFixed(1)} dB da amplitude (pior em ${ra.t.toFixed(2)} s; regime ${raR.db.toFixed(1)} dB)`);
  // zíper: no meio da chegada (0,5 s, o Doppler quase constante) e na passagem (50 ms, o Doppler varrendo; fora de
  // ±100 Hz do pico)
  const tMeio = (ja[0] + ja[1]) / 2 - 0.25, tPass = tDe(0) - 0.025;
  const bl1 = bandasLaterais(L, tMeio), bl2 = bandasLaterais(L, tPass, 0.05, 100);
  conferir(`${nome} ${v} m/s · zíper (bandas laterais)`, Math.max(bl1.db, bl2.db) <= -60, `chegando ${bl1.db.toFixed(1)} dB (em ${bl1.f.toFixed(0)} Hz), na passagem ${bl2.db.toFixed(1)} dB (em ${bl2.f.toFixed(0)} Hz)`);
}

// controle negativo: o mesmo passeio a 20 m/s pelo ouvinte fixo arrastado por mensagens (a rampa de 20 ms, sem a
// velocidade do ouvinte na derivada do atraso): o teste tem de acusar
{
  const ps = passeioReto(20, 220);
  const { L } = tocar({ traj: ps.traj, dur: ps.dur, antigo: true });
  salvar('controle-fixo-arrastado', L, L);
  const tMeio = (220 - 0.9 * 220) / 20 + 0.12 + 1.5;
  const bl = bandasLaterais(L, tMeio);
  conferir('controle: o fixo arrastado a 20 m/s acusa zíper', bl.db > -45, `bandas laterais ${bl.db.toFixed(1)} dB (em ${bl.f.toFixed(0)} Hz): o teste enxerga o defeito`);
}

// salto: parado a 5 m da fonte, teletransporte de 25 m aos 1,5 s (e de volta aos 3 s)
{
  const traj = (t: number) => ({ pos: [t < 1.5 || t >= 3 ? -4 : 21, -D, Z] as Vec3, vel: [0, 0, 0] as Vec3, rumo: 0 });
  const { L } = tocar({ traj, dur: 4.5, saltos: [1.5, 3] });
  salvar('salto', L, L);
  const A = amplitude(L);
  const dg = degrau(L, A, FS, L.length - 100, F0), ra = residuoAgudo(L, A, FS, L.length - 100);
  conferir('salto de 25 m · degrau amostra a amostra', dg.pior <= 1.02, `${dg.pior.toFixed(4)} (pior em ${dg.t.toFixed(3)} s)`);
  conferir('salto de 25 m · resíduo acima de 5 kHz', ra.db <= -70, `${ra.db.toFixed(1)} dB (pior em ${ra.t.toFixed(3)} s)`);
  // e o nível depois do salto é o do lugar novo: 1/r (r de 5,1 para 21,2 m: −12,4 dB)
  const rms = (a: number, b: number) => { let s = 0; for (let i = Math.round(a * FS); i < Math.round(b * FS); i++) s += L[i] * L[i]; return Math.sqrt(s / ((b - a) * FS)); };
  const dB = 20 * Math.log10(rms(2.2, 2.9) / rms(0.8, 1.4)), esp = 20 * Math.log10(Math.hypot(4, D, Z - 1.2) / Math.hypot(21, D, Z - 1.2));
  conferir('salto de 25 m · nível no lugar novo', Math.abs(dB - esp) < 0.5, `${dB.toFixed(2)} dB (1/r: ${esp.toFixed(2)} dB)`);
}

// giro da cabeça: parado a 5 m, 360° em 0,5 s, binaural (panorâmica, ITD e ILD andando)
{
  const traj = (t: number) => ({ pos: [-4, -D, Z] as Vec3, vel: [0, 0, 0] as Vec3, rumo: t < 1 ? 0 : t < 1.5 ? (t - 1) * 720 : 360 });
  const { L, R } = tocar({ traj, dur: 3, binaural: true });
  salvar('giro', L, R);
  for (const [lado, x] of [['esquerdo', L], ['direito', R]] as const) {
    const A = amplitude(x);
    const dg = degrau(x, A, FS / 2, x.length - 100, F0 * 1.02), ra = residuoAgudo(x, A, FS / 2, x.length - 100);
    conferir(`giro de 360° em 0,5 s · ouvido ${lado}`, dg.pior <= 1.02 && ra.db <= -60, `degrau ${dg.pior.toFixed(4)}, resíduo acima de 5 kHz ${ra.db.toFixed(1)} dB`);
  }
}

// a API antiga e a nova dão o mesmo som: fonte passando a 30 m/s, ouvinte parado no ponto do fixo de frente para a via
{
  const fixo: Ouvinte = { modo: 'fixo', pos: [0, 0, Z], gimbal: { az: 90, el: 0, r: 5, alvo: 'corpo' }, local: 'auto', binaural: true };
  const livre: Ouvinte = { ...fixo, modo: 'livre', livre: { ref: 'mundo', pos: [0, -(D + 0.15), Z], vel: [0, 0, 0], rumo: 90, salto: 0 } };
  const a = tocar({ traj: () => ({ pos: [0, 0, 0], vel: [0, 0, 0], rumo: 0 }), dur: 4, fixo, fonteV: 30, sFonte0: -60 });
  const b = tocar({ traj: () => ({ pos: [0, 0, 0], vel: [0, 0, 0], rumo: 0 }), dur: 4, fixo: livre, fonteV: 30, sFonte0: -60 });
  let dif = 0, pico = 0;
  for (let i = 0; i < a.L.length; i++) { dif = Math.max(dif, Math.abs(a.L[i] - b.L[i]), Math.abs(a.R[i] - b.R[i])); pico = Math.max(pico, Math.abs(a.L[i])); }
  const db = 20 * Math.log10(dif / pico + 1e-30);
  conferir('livre no ponto do fixo, de frente para a via = fixo', db < -120, dif === 0 ? 'idêntico amostra a amostra' : `diferença máxima ${db.toFixed(1)} dB do pico`);
}

// ------------------------------------------------------------------ o lugar (src/scene/lugar.ts): sair do túnel
// O túnel da página (via dupla, 64 m², boca em −500), a fonte tonal parada 150 m dentro, na via. O ouvinte sai pela boca
// a pé pela passarela (o ouvido a 2,35 m; lá fora, no chão, a 1,6: o degrau de 0,75 m chega como a página manda), correndo,
// voando a 10 m/s e a 45 m/s (a 4 m de altura). Confere no direto e no envio: degrau, resíduo acima de 5 kHz e zíper
// na travessia da boca; e o envio (o campo reverberante que a boca irradia) caindo sem subir depois da boca, a cada
// 0,1 s. E mais: sair pela boca e virar para o lado, rente à testa (a borda da boca entra na frente do direto), e voar do
// tabuleiro da ponte para o vale (o chão refletor troca com o solo calado).
{
  const sec = secaoTunel(64), TA = -500;
  const ambT = (): Ambiente => {
    const a = ambientePassagem('tunel');
    a.fundo = { vento: 0, ventilacao: 0, murmurio: 0 };
    a.lugar = { tunel: { s0: TA, s1: TA + 2000, mLonge: -sec.paredeOposta, mPerto: -sec.paredeOuvinte, altura: sec.altura, nicho: 1.1 }, fundoFora: a.fundo };
    return a;
  };
  const M = 4.68, SF = TA + 150;
  /**
   * percurso por pernas como a página anda: a velocidade comandada muda de perna para perna e a do observador a segue com
   * 0,12 s de constante de tempo (nunca num degrau); integrado a cada 1 ms. Pernas: [duração (s), vx, vy, vz]
   */
  const percurso = (p0: Vec3, pernas: [number, number, number, number][], rumo: number) => {
    const dt = 0.001, k = 1 - Math.exp(-dt / 0.12), P: number[][] = [], V: number[][] = [];
    const p = [...p0], v = [0, 0, 0];
    for (const [d, ...cmd] of pernas) for (let t = 0; t < d; t += dt) { P.push([...p]); V.push([...v]); for (let i = 0; i < 3; i++) { v[i] += k * (cmd[i] - v[i]); p[i] += v[i] * dt; } }
    return (t: number) => { const i = Math.min(P.length - 1, Math.max(0, Math.round(t / dt))); return { pos: P[i] as unknown as Vec3, vel: V[i] as unknown as Vec3, rumo }; };
  };
  const SAIDAS: [string, number, number, number, number][] = [['a pé', 1.5, 10, 20, 0], ['correndo', 6, 30, 90, 0], ['voando', 10, 40, 160, 4], ['voando com Shift', 45, 60, 200, 4]];
  for (const [nome, v, dentro, fora, zv] of SAIDAS) {
    const x0 = TA + dentro, tau = 0.12;
    // sai do repouso com a aceleração da página; a pé, o ouvido 2,35 m sobre a via dentro (a passarela) e 1,6 fora
    const traj = (t: number) => {
      const e = Math.exp(-t / tau), x = x0 - v * (t - tau * (1 - e));
      return { pos: [x, -M, zv || (x >= TA ? 2.35 : 1.6)] as Vec3, vel: [-v * (1 - e), 0, 0] as Vec3, rumo: 180 };
    };
    const dur = (dentro + fora) / v + 0.5;
    const r = tocar({ traj, dur, amb: ambT(), sFonte0: SF });
    salvar(`tunel-saida-${nome.replace(/ /g, '-')}`, r.L, r.sL);
    const tBoca = dentro / v + tau;
    for (const [qual, x] of [['direto', r.L], ['envio', r.sL]] as const) {
      const A = amplitude(x), ini = FS, fim = x.length - 2 * FS / F0;
      const dg = degrau(x, A, ini, fim, F0), ra = residuoAgudo(x, A, ini, fim);
      const bl = bandasLaterais(x, Math.max(1, tBoca - 0.25));
      conferir(`túnel: saindo ${nome} (${v} m/s) · ${qual}: degrau, resíduo > 5 kHz, zíper na boca`, dg.pior <= 1.02 && ra.db <= -70 && bl.db <= -60,
        `degrau ${dg.pior.toFixed(4)}, resíduo ${ra.db.toFixed(1)} dB, bandas laterais ${bl.db.toFixed(1)} dB (em ${bl.f.toFixed(0)} Hz)`);
    }
    // o envio depois da boca, em janelas de 0,1 s: nunca sobe mais que 0,05 dB de uma para a seguinte
    const jan = Math.round(0.1 * FS), nivel = (i0: number) => { let e = 0; for (let i = i0; i < i0 + jan; i++) e += r.sL[i] * r.sL[i]; return 10 * Math.log10(e / jan + 1e-30); };
    let pior = -Infinity, ant = NaN, i0 = Math.round((tBoca + 0.1) * FS);
    const nDentro = nivel(Math.round((tBoca - 0.6) * FS));
    for (; i0 + jan < r.sL.length - FS / 4; i0 += jan) { const l = nivel(i0); if (ant === ant) pior = Math.max(pior, l - ant); ant = l; }
    conferir(`túnel: saindo ${nome} · o campo reverberante cai com a distância da boca`, pior <= 0.05,
      `maior subida entre janelas de 0,1 s depois da boca ${pior.toFixed(3)} dB; ${fora} m fora, ${(ant - nDentro).toFixed(1)} dB do de dentro`);
  }
  // sair e virar rente à testa do emboque: a borda da boca entra na frente da fonte (zona iluminada → sombra)
  {
    // 6 m/s para fora da boca por 1,3 s e depois para o lado (rente à testa) por 5 s
    const traj = percurso([TA + 5, -M, 1.6], [[1.3, -6, 0, 0], [5.7, 0, -6, 0]], 225);
    const r = tocar({ traj, dur: 7, amb: ambT(), sFonte0: SF });
    salvar('tunel-contorna-boca', r.L, r.sL);
    const A = amplitude(r.L), dg = degrau(r.L, A, FS, r.L.length - 100, F0), ra = residuoAgudo(r.L, A, FS, r.L.length - 100);
    const nv = (t: number) => { let e = 0; const i0 = Math.round(t * FS); for (let i = i0; i < i0 + FS / 5; i++) e += r.L[i] * r.L[i]; return 10 * Math.log10(e); };
    conferir('túnel: sair e virar rente à testa (a borda da boca na frente do direto)', dg.pior <= 1.02 && ra.db <= -70 && nv(6.6) - nv(1.2) < -10,
      `degrau ${dg.pior.toFixed(4)} (em ${dg.t.toFixed(2)} s), resíduo ${ra.db.toFixed(1)} dB (em ${ra.t.toFixed(2)} s); o direto 30 m ao lado da boca ${(nv(6.6) - nv(1.2)).toFixed(1)} dB do de dentro`);
  }
  // ponte: voar do passeio para fora do tabuleiro e descer ao vale (o chão refletor troca do tabuleiro para o vale)
  {
    const amb = ambientePassagem('ponte');
    amb.fundo = { vento: 0, ventilacao: 0, murmurio: 0 };
    amb.lugar = { ponte: { m0: -3.7, m1: 8.5, espessura: 1.6, vale: -28, fundo: 170, borda: 330 }, fundoFora: amb.fundo };
    // do passeio (6,68 m da via, ouvido a 1,8 m) para fora do tabuleiro a 8 m/s por 1,25 s, desce a 8 m/s por 3,5 s
    // (voando: 28 m) e para
    const traj = percurso([0, -6.68, 1.8], [[1.25, 0, -8, 0], [3.5, 0, 0, -8], [1.25, 0, 0, 0]], 90);
    const r = tocar({ traj, dur: 6, amb, sFonte0: -30 });
    salvar('ponte-ao-vale', r.L, r.sL);
    const A = amplitude(r.L), dg = degrau(r.L, A, FS, r.L.length - 100, F0), ra = residuoAgudo(r.L, A, FS, r.L.length - 100);
    const vale = r.cena.modoVale, z = r.cena.geo.z;
    conferir('ponte: voar do tabuleiro para o vale (o chão refletor troca com o solo calado)', dg.pior <= 1.02 && ra.db <= -70 && vale && z < -25,
      `degrau ${dg.pior.toFixed(4)} (em ${dg.t.toFixed(2)} s), resíduo ${ra.db.toFixed(1)} dB (em ${ra.t.toFixed(2)} s); no fim o ouvido a ${z.toFixed(1)} m, chão ${vale ? 'do vale' : 'do tabuleiro'}`);
  }
  // voar descendo (Q, 8 m/s) com o solo refletindo (concreto), sem lugar: a imagem do ouvido no solo anda com −v_z (até
  // 23/11/2026 a derivada do caminho dela usava +v_z e o reflexo zipava: resíduo de −36 dB no começo da descida)
  {
    const amb = ambientePassagem('ceu');
    amb.solo = { tipo: 'concreto' }; amb.fundo = { vento: 0, ventilacao: 0, murmurio: 0 };
    const traj = percurso([0, -16.68, 30], [[1.25, 0, 0, 0], [3.5, 0, 0, -8], [1.25, 0, 0, 0]], 90);
    const r = tocar({ traj, dur: 6, amb, sFonte0: -30 });
    salvar('descida-com-solo', r.L, r.sL);
    const A = amplitude(r.L), dg = degrau(r.L, A, FS, r.L.length - 100, F0), ra = residuoAgudo(r.L, A, FS, r.L.length - 100);
    conferir('voar descendo a 8 m/s com o solo refletindo (a imagem do ouvido anda com −v_z)', dg.pior <= 1.02 && ra.db <= -70,
      `degrau ${dg.pior.toFixed(4)} (em ${dg.t.toFixed(2)} s), resíduo ${ra.db.toFixed(1)} dB (em ${ra.t.toFixed(2)} s)`);
  }
}

const falhas = resultados.filter((r) => !r.ok).length;
console.log(`\n${resultados.length} conferências, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
