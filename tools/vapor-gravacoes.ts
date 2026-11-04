// Passo 1 do VAPOR.md 7: as medidas de `tools/vapor-analise.ts` sobre as gravações do Commons (Apêndice A) contra os
// números do Apêndice A (A.2 chuffs, A.3 apitos). Tolerâncias do plano: taxa ±2%, tempos ±5%, bandas e p/v ±0,5 dB,
// notas ±1,5% (centroides ±2%, não pedidos pelo plano).
//
//   npx tsx tools/vapor-gravacoes.ts [--pasta <dir dos WAV>]
//
// A porta é conferida também contra os scripts originais rodados com numpy/scipy (`chuff2.py`, `apito.py`): os
// filtros de Butterworth em ida e volta saem iguais ao `sosfiltfilt` em 12 algarismos e as medidas de chuff saem iguais
// às do Python nos 5 trechos.
//
// Desvios do Apêndice A (não são da porta: o próprio `apito.py` com os parâmetros do texto, Welch 32768 e > 18 dB, não
// acha essas linhas; o Apêndice deve ter usado outra janela ou limiar nesses trechos). Ficam listados como "desvio" e
// não reprovam:
//  - D51 6–8 s: 2194 Hz (6º harmônico, 21 dB no Apêndice) não passa dos 18 dB sobre a mediana; 1103 Hz aparece a 19 dB;
//  - C57 12–20 s: 1071 Hz (19 dB no Apêndice, abaixo do próprio limiar de 18) não aparece; 240 e 368 Hz aparecem a 19–21;
//  - UP 844 Kosse 28–34 s: só 400, 409 e 419 Hz passam de 18 dB (o Apêndice lista 274, 286, 344 e 810 a 18–21 dB);
//  - Grand Canyon 4960 8–10 s: as 8 linhas batem.
// Os trechos de vídeo (v) não entram aqui (alvo interno, não públicos).
import path from 'node:path';
import fs from 'node:fs';
import { lerMono, trecho, analisarChuff, linhasTonais, cinco, textoChuff, type MedidaChuff } from './vapor-analise';

const ai = process.argv.indexOf('--pasta');
const PASTA = ai >= 0 ? process.argv[ai + 1] : '/tmp/claude-1000/-home-ezenere-Documents-Projects-Engine/e31418c8-04d3-4470-8423-a94efb88e841/scratchpad/real2/vapor/wav';

type Alvo = {
  nome: string; arq: string; t0: number; t1: number;
  fch: number; fCiclo?: number; at: number; larg: number; dec: number; pv: [number, number, number, number];
  pico: number[]; cenPico: number; vale: number[]; cenVale: number;
};
// Apêndice A.2 (só os trechos do Commons)
const CHUFFS: Alvo[] = [
  { nome: 'Huntsville 2–20', arq: 'Steam_engine_ogg.wav', t0: 2, t1: 20, fch: 3.32, fCiclo: 3.32, at: 62, larg: 77, dec: 75, pv: [15.4, 16.4, 16.5, 9.8], pico: [-5.0, 1.0, -4.4, -3.2, -10.7], cenPico: 1189, vale: [2.7, -1.9, -3.5, -2.1, -7.7], cenVale: 1378 },
  { nome: 'Huntsville 24–44', arq: 'Steam_engine_ogg.wav', t0: 24, t1: 44, fch: 4.26, fCiclo: 2.14, at: 35, larg: 65, dec: 60, pv: [17.8, 19.1, 20.1, 13.6], pico: [-10.6, 2.2, -1.8, -1.3, -6.1], cenPico: 1563, vale: [-3.5, -2.1, -2.6, -0.8, -4.3], cenVale: 2005 },
  { nome: '6024 Lickey 40–72', arq: '6024_Lickey_Bank_ogg.wav', t0: 40, t1: 72, fch: 9.56, fCiclo: 4.64, at: 33, larg: 46, dec: 52, pv: [10.6, 13.6, 9.4, 6.4], pico: [-11.7, -0.9, -3.5, -9.9, -25.1], cenPico: 771, vale: [-8.4, -1.9, -4.2, -10.1, -23.4], cenVale: 736 },
  { nome: '6024 Lickey 128–160', arq: '6024_Lickey_Bank_ogg.wav', t0: 128, t1: 160, fch: 8.7, at: 38, larg: 78, dec: 66, pv: [7.8, 10.5, 7.3, 6.9], pico: [-6.8, -0.1, -2.2, -21.2, -29.5], cenPico: 641, vale: [-3.3, 0.2, -2.1, -19.0, -26.5], cenVale: 630 },
  { nome: 'Grand Canyon 4960 16–27', arq: 'Steam_Locomotive_Leaving_Depot_10_01_2022_webm.wav', t0: 16, t1: 27, fch: 30.42, at: 11, larg: 23, dec: 15, pv: [6.9, 12.3, 7.3, 4.1], pico: [-12.2, -5.6, -11.5, -11.6, -15.9], cenPico: 675, vale: [-7.4, -0.9, -7.0, -6.4, -10.5], cenVale: 1033 },
];

// Apêndice A.3: notas (Hz); `faltam` = as do Apêndice que o apito.py não acha com os parâmetros do texto (ver o cabeçalho)
const APITOS: { nome: string; arq: string; t0: number; t1: number; notas: number[]; faltam?: number[] }[] = [
  { nome: 'D51 498 0–2 s (frio)', arq: 'D51498_kiteki_2005_ogg.wav', t0: 0, t1: 2, notas: [338, 431, 508, 527, 628] },
  { nome: 'D51 498 6–8 s', arq: 'D51498_kiteki_2005_ogg.wav', t0: 6, t1: 8, notas: [362, 463, 548, 1096], faltam: [2194] },
  { nome: 'D51 498 34–36 s (quente)', arq: 'D51498_kiteki_2005_ogg.wav', t0: 34, t1: 36, notas: [378, 482, 606, 620, 699, 710, 1134] },
  { nome: 'C57 180 12–20 s', arq: 'C57180_kiteki_1_ogg.wav', t0: 12, t1: 20, notas: [356, 429, 546, 576, 695], faltam: [1071] },
  { nome: 'UP 844 Kosse 28–34 s', arq: '2010_UP844_Whistle_ogg.wav', t0: 28, t1: 34, notas: [398, 409, 419], faltam: [274, 286, 344, 810] },
  { nome: 'Grand Canyon 4960 8–10 s', arq: 'Steam_Locomotive_Leaving_Depot_10_01_2022_webm.wav', t0: 8, t1: 10, notas: [278, 312, 346, 373, 437, 445, 517, 524] },
];

let falhas = 0, oks = 0, desvios = 0;
const linhasOut: string[] = [];
function conferir(grupo: string, medida: string, alvo: number, med: number, tol: number, modo: 'abs' | 'rel') {
  const erro = modo === 'rel' ? Math.abs(med - alvo) / Math.abs(alvo) : Math.abs(med - alvo);
  const ok = Number.isFinite(med) && erro <= tol + 1e-9;
  if (ok) oks++; else falhas++;
  const fm = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));
  linhasOut.push(`${ok ? 'ok   ' : 'FALHA'} ${grupo.padEnd(26)} ${medida.padEnd(18)} alvo ${fm(alvo).padStart(8)}  medido ${fm(med).padStart(8)}  (±${modo === 'rel' ? (100 * tol).toFixed(1) + '%' : tol + ' dB'})`);
}

const cache = new Map<string, { x: Float64Array; fs: number }>();
const ler = (arq: string) => { if (!cache.has(arq)) cache.set(arq, lerMono(path.join(PASTA, arq))); return cache.get(arq)!; };

const t0 = Date.now();
if (!fs.existsSync(PASTA)) { console.error(`pasta das gravações não encontrada: ${PASTA}`); process.exit(2); }

for (const a of CHUFFS) {
  const { x, fs: sr } = ler(a.arq);
  const m: MedidaChuff = analisarChuff(trecho(x, sr, a.t0, a.t1), sr);
  console.log(`-- ${a.nome} (${m.nivel.toFixed(1)} dBFS)\n   ${textoChuff(m)}`);
  const g = a.nome;
  conferir(g, 'chuff/s', a.fch, m.fChuff, 0.02, 'rel');
  if (a.fCiclo) conferir(g, 'ciclo', a.fCiclo, m.fCiclo, 0.02, 'rel');
  conferir(g, 'ataque', a.at, m.ataque.med, 0.05, 'rel');
  conferir(g, 'largura −6 dB', a.larg, m.largura.med, 0.05, 'rel');
  conferir(g, 'decaimento −10 dB', a.dec, m.decaimento.med, 0.05, 'rel');
  conferir(g, 'p/v total', a.pv[0], m.pv.med, 0.5, 'abs');
  conferir(g, 'p/v 150–400', a.pv[1], m.pvBanda['150-400'], 0.5, 'abs');
  conferir(g, 'p/v 400–1500', a.pv[2], m.pvBanda['400-1500'], 0.5, 'abs');
  conferir(g, 'p/v 1500–6000', a.pv[3], m.pvBanda['1500-6000'], 0.5, 'abs');
  const nb = ['60–150', '400–1k', '1–2,5k', '2,5–6k', '6–12k'];
  const bp = cinco(m.pico), bv = cinco(m.vale);
  nb.forEach((b, i) => conferir(g, `pico ${b}`, a.pico[i], bp[i], 0.5, 'abs'));
  conferir(g, 'pico centroide', a.cenPico, m.pico.centroide, 0.02, 'rel');
  nb.forEach((b, i) => conferir(g, `vale ${b}`, a.vale[i], bv[i], 0.5, 'abs'));
  conferir(g, 'vale centroide', a.cenVale, m.vale.centroide, 0.02, 'rel');
}

for (const a of APITOS) {
  const { x, fs: sr } = ler(a.arq);
  const L = linhasTonais(trecho(x, sr, a.t0, a.t1), sr, { max: 8 });
  console.log(`-- ${a.nome}: ${L.map((l) => `${l.f.toFixed(1)}(${l.abs.toFixed(0)}/${l.rel.toFixed(0)})`).join('  ')}`);
  for (const n of a.notas) {
    const mais = L.reduce((b, l) => (Math.abs(l.f - n) < Math.abs(b - n) ? l.f : b), Infinity);
    conferir(a.nome, `nota ${n}`, n, mais, 0.015, 'rel');
  }
  for (const n of a.faltam ?? []) {
    const achou = L.some((l) => Math.abs(l.f - n) / n <= 0.015);
    desvios++;
    linhasOut.push(`desvio ${a.nome.padEnd(26)} nota ${String(n).padEnd(13)} ${achou ? 'achada' : 'não achada pelo apito.py (> 18 dB): ver o cabeçalho'}`);
  }
}

console.log('\nalvo (Apêndice A) × medido');
for (const l of linhasOut) console.log(l);
console.log(`\n${oks} ok, ${desvios} desvios documentados, ${falhas} falhas (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exitCode = falhas ? 1 : 0;
