// Mecanismos de médios e o jato físico da ponteira do motor-base a pistão (docs/TECNICO.md → Ronco → "Médios" e
// "Jato da ponteira"). Este arquivo só MONTA o que o laço de amostra do EngineDSP usa (filtros, pesos por cilindro, a
// boca com bocal); os escalares saem do preset em `EngineDSP.tune`. Tudo nasce desligado: sem os campos `carcaca`,
// `batida`, `jato` e `bombaAr` no preset, o DSP toca como antes, amostra a amostra.
//
// `montarMedios` é chamado pelo `setConfig` do EngineDSP depois de `buildExhaust` e `buildFilters`, então vale também
// para as subclasses (Diesel, Radial, Rotativos), que montam o próprio escape:
//   · carcaça: a subclasse diz de que tubo cada boca tira a onda, em `this.carcSrc` (um `Line` ou `null` por boca, na
//     ordem de `this.rads`); sem a lista, a carcaça não irradia;
//   · batida: os impulsos são somados em `this.batC` (pistão) e `this.batV` (válvulas) pelo ramo do motor;
//   · jato: usa `this.pipeA` e `this.tipA`, que toda subclasse já define.
import { Biquad, RNG, P0, GAM, onePole } from '../../acoustics';
import { CARCACA, BATIDA, JATO_MACH } from './constantes';

/**
 * Boca com ponteira mais fina que o tubo: um bocal na ponta. A queda de pressão no estrangulamento é a de Bernoulli,
 * Δp = ½ρ·v²·(1/σ² − 1), com σ = área da ponteira ÷ área do tubo; em unidades de onda (w = vazão em Pa, ρc·v),
 * Δp = κ·w·|w|, κ = (1/σ² − 1)/(2γp₀). Com a boca aberta sairia w₀; com o bocal sai w, de w + κ·w·|w| = w₀: em pulso
 * fraco quase nada muda, em pulso forte a vazão cresce só com a raiz da pressão e o resto volta para o tubo como
 * contrapressão (reflexão positiva). A velocidade na garganta satura no escoamento sônico (w ≤ ~1 bar·σ).
 * Substitui o `step` de um `Radiator` (src/acoustics/guias.ts), que continua com o mesmo filtro e a mesma irradiação.
 */
function stepBocal(this: any) {
  const x = this.line.in1;
  this.s += this.k * (x - this.s);
  const w0 = x + this.R * this.s, kb = this.kBocal;
  let w = (Math.sqrt(1 + 4 * kb * Math.abs(w0)) - 1) / (2 * kb);
  const r = w / this.wMax, r2 = r * r;
  w /= Math.sqrt(Math.sqrt(1 + r2 * r2));
  if (w0 < 0) w = -w;
  this.line.out1 = x - w;
  this.emit = this.radiate(w);
}

export function montarMedios(d: any, _cfg: any) {
  const fs = d.fs, rads = d.rads, n = rads.length, N = d.N;
  const pipeA = d.pipeA || 1, tipA = d.tipA || 1, ds = Math.sqrt(pipeA);

  // ---- carcaça do escape, por boca: a ressonância da parede (passa-alta ressonante: rígida abaixo, 12 dB/oitava), o
  // corte da massa acima dela e a irradiação fraca do grave por uma fonte pequena (a parede maior ressoa mais grave)
  if (!d.carcSrc || d.carcSrc.length !== n) d.carcSrc = rads.map(() => null);
  d.carcF = rads.map(() => [new Biquad().hp(fs, CARCACA.f0 / ds, CARCACA.q), new Biquad().lp(fs, CARCACA.fMassa / ds, 0.7)]);
  d.carcOut = new Float64Array(n);
  d.carcS = new Float64Array(n); d.carcKp = onePole(fs, CARCACA.fGrave / ds); // (a caixa irradia mal abaixo de ~600 Hz)

  // ---- batida periódica: modos do bloco e do cabeçote, e o tamanho fixo do impulso de cada pistão e de cada válvula
  // (folgas diferentes: é isso que põe as meias ordens; sorteio com semente própria, igual em toda renderização)
  d.batF = [new Biquad().bp(fs, BATIDA.f1, BATIDA.q1), new Biquad().bp(fs, BATIDA.f2, BATIDA.q2), new Biquad().bp(fs, BATIDA.fV, BATIDA.qV), new Biquad().lp(fs, BATIDA.fCorte, 0.7)];
  const sr = new RNG(0xba71da + N * 7919);
  d.batW = new Float64Array(3 * N);
  for (let c = 0; c < N; c++) { d.batW[c] = 1 + 0.35 * sr.bi(); d.batW[N + c] = 1 + 0.5 * sr.bi(); d.batW[2 * N + c] = 0.7 * (1 + 0.5 * sr.bi()); }
  d.batC = 0; d.batV = 0;

  // ---- jato da ponteira ('sonico'). O sopro de cada pulso foi afinado de ouvido num escape de 2,5": ele segue a vazão
  // do pulso. A lei antiga dividia a onda pela área da ponteira (1/área²: +24 dB com a ponteira em 1,25", e mais o
  // estreitamento do tubo, contado duas vezes, porque a onda num tubo fino já é maior). Aqui, abaixo de 2,5" o sopro
  // não cresce com o estreitamento (o gás de um pulso a Mach 0,05–0,3 não chia mais por sair de um cano fino); acima,
  // cai como antes (gás mais lento). O que o estreitamento faz é subir a velocidade na ponteira (vazão ÷ área), que
  // satura no escoamento sônico (`jatoM`: Mach por unidade de `vel`): perto dele o sopro para de crescer.
  // (Subir o tom do chiado com 1/diâmetro, como num jato de verdade, foi medido e não entrou: levava o chiado para
  // 2,5–6 kHz, onde o tom do motor é fraco, e o leito de ruído dessa banda passava da régua em plena carga)
  d.jatoQ = Math.min(1, pipeA) / (2.5e4 * Math.max(1, tipA));
  d.jatoM = (JATO_MACH * pipeA) / tipA / (2.5e4 * d.jatoQ);
  if (d.jatoFis) {
    // ponteira mais fina que o tubo: bocal na boca (contrapressão, pulso mais mole); a boca da válvula de escape não muda
    const sigma = tipA / pipeA;
    if (sigma < 0.98) for (const rd of rads) if (rd.valve === undefined) { rd.kBocal = (1 / (sigma * sigma) - 1) / (2 * GAM * P0); rd.wMax = 1e5 * sigma; rd.step = stepBocal; }
  }
}
