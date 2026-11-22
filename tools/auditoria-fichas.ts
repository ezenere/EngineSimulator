// Auditoria mecânica das fichas dos presets: a conta que dá para fazer sem ouvir nada.
//
//   npx tsx tools/auditoria-fichas.ts [familia] [--md] [--so-alertas]
//
//   familia: ronco (os 68 e a Aviação), diesel, radial, rotativo, vapor, eletrico, turbina; sem ela, todas
//   --md: tabelas em Markdown · --so-alertas: só as linhas com alerta
//
// Para cada preset, o que se aplica a ele:
//   · câmbio (Ronco, Diesel rodoviário, Sherman/Monaco-Trossi/Megola, rotativos de rua): velocidade em cada marcha no
//     corte, rpm a 100 km/h na última marcha, kg/kW, kW/L, final estimada pelo arrasto e com o câmbio, 0–100 km/h;
//   · hélices (Aviação do Ronco, Radial, rotativos de aviação, turboélices) e rotores: rotação, Mach na ponta parado e
//     no cruzeiro, passagem de pá, coeficiente de potência; no rotor, também a potência do pairado contra a do motor;
//   · vapor: rotação da roda e sopros por segundo na velocidade máxima, velocidade do pistão, esforço de tração e fator
//     de aderência; diesel-elétricas: rotação e potência por notch; geradores: rotação síncrona;
//   · elétricos: redução, rotação do motor, frequência elétrica e de engrenamento na velocidade máxima, esforço de
//     partida, aceleração, velocidade de equilíbrio, ranhuras por polo e fase; ponta da hélice do drone e das facas
//     (a ficha não tem o diâmetro do rotor do motor, então não há velocidade periférica dele);
//   · turbinas: Mach na ponta do fan em N1 100%, passagem de pá do fan e do compressor.
//
// As convenções são as do código, não as de um manual: relações e diferencial como em `EngineDSP.tune()`
// (src/engines/ronco/dsp.ts: `ratios` só vale se tiver `gears` relações, senão `gearRatios(gears)`; `finalDrive` ausente
// → `defaultFinal(redline)`; massa, raio e arrasto ausentes → 850 + 160·L (950–1900 kg), 0,33 m, 0,42; rolagem
// 0,012·m·g, ou `rolagem` no Radial), hélice como em `configHelice()` (src/engines/ronco/aviacao.ts), rotor como em
// `configRotor()` + `CargaRotor` (src/carriers/rotor.ts), vapor como em `VaporDSP` (esforço 0,85·p·d²·s/D por par de
// cilindros) e `escapesPorVolta()`, elétrico como em `CarroEletrico` e `TracaoTrem` (T = min(Tn, Pmax/ω) por motor,
// aderência 0,75, massa equivalente 1,06·m, Davis A + B·v + C·v²), Turbina como em `JetDSP.sources()`.
//
// O que NÃO vem do código (e por isso fica em constantes nomeadas logo abaixo): a curva de potência das estimativas
// de final e de 0–100, a aderência por tipo de veículo, as velocidades de cruzeiro das aeronaves e as faixas de alerta.
//
// É um relatório, não um portão: sai sempre com código 0. Alerta não é erro: é onde olhar primeiro.
import { PRESETS as PRESETS_RONCO, PRESETS_AVIACAO, ACESSORIOS_PADRAO } from '../src/engines/ronco/presets';
import { gearRatios, defaultFinal } from '../src/engines/ronco/dsp';
import { configHelice, configRotor } from '../src/engines/ronco/aviacao';
import { PRESETS as PRESETS_DIESEL, PADRAO_DIESEL } from '../src/engines/diesel/presets';
import { PRESETS_RADIAL, PADRAO_RADIAL } from '../src/engines/radial/presets';
import { PRESETS_ROTATIVO, PADRAO_ROTATIVO } from '../src/engines/rotativo/presets';
import { PRESETS_VAPOR, escapesPorVolta, eixosRodeiro } from '../src/engines/vapor/presets';
import { PRESETS_ELETRICO } from '../src/engines/eletrico/presets';
import { PRESETS_TURBINA } from '../src/engines/turbina/presets';
import { machPonta, bpfHelice } from '../src/carriers/helice';
import { CargaRotor } from '../src/carriers/rotor';
import { NOTCH_POTENCIA } from '../src/carriers/locomotiva';
import { rpmGerador } from '../src/carriers/gerador';
import { C_SOM, RHO } from '../src/scene/constantes';
import { C0 } from '../src/acoustics';

// =================================================================================================================
// Constantes da ferramenta (o que não vem do código do simulador)
// =================================================================================================================
const G = 9.81, TAU = 2 * Math.PI, RPM = 60 / TAU; // rad/s → rpm

/** rendimento da transmissão nas estimativas "de verdade" (final e 0–100). O DSP do Ronco não tem perda nem limite de
 *  aderência: a coluna "0–100 sem ader." refaz a conta assim (η = 1, força livre), que é como o carro anda na página. */
const ETA_TRANSMISSAO = 0.9;
/** rotação de potência máxima quando a ficha não a tem (Ronco, Radial, Rotativos): fração do corte. Motores de série
 *  dão o pico entre 85% e 95% da faixa vermelha. O Diesel tem `rpmPotencia` na ficha. */
const FRACAO_PICO = 0.9;
/** curva de potência das estimativas: P/Pmax = C1·r + C2·r² − C3·r³, r = rpm/rpm de pico. É o polinômio empírico dos
 *  livros de dinâmica veicular (Otto 1/1/1; diesel de injeção direta 0,87/1,13/1; pré-câmara 0,6/1,4/1). NÃO é a curva
 *  do DSP (que sai do modelo termodinâmico e é escalada até `power`): serve para estimar, não para conferir o DSP. */
const CURVA = { otto: [1, 1, 1], diesel: [0.87, 1.13, 1], idi: [0.6, 1.4, 1] } as const;

type Tipo = 'carro' | 'hiper' | 'corrida' | 'moto' | 'pesado' | 'tanque';
/**
 * Faixas de alerta por tipo de veículo. `primeira`: velocidade no corte em 1ª (km/h); `rpm100`: rotação a 100 km/h na
 * última marcha; `zeroCem`: 0–100 km/h (s); `mu`: aderência equivalente (força máxima de tração / peso total).
 *  · carro de rua: 1ª entre 25 e 110 km/h, 1500–4500 rpm a 100 km/h (pedido da auditoria); 0–100 de 2,5 s (o mais
 *    rápido de série com pneu de rua) a 35 s (utilitário diesel aspirado dos anos 80); μ 0,95 (pneu de rua, com a
 *    transferência de peso de um tração traseira ou integral);
 *  · hipercarro: como o carro, com 1ª até 130 km/h e 0–100 de 1,8 a 5 s; μ 1,2 (semi-slick, integral ou carga aero);
 *  · corrida: sem faixa de 1ª nem de rpm a 100 (um F1 faz 130 km/h em 1ª); 0–100 de 1,5 a 7 s; μ 1,6 (slick);
 *  · moto: 1ª de 50 a 200 km/h, 3000–7000 rpm a 100 km/h (pedido da auditoria; o piso cai a 40% do corte nas de
 *    giro baixo, como uma Harley, que roda a ~2400); 0–100 de 2,2 a 9 s; μ 1,0 (o limite é empinar);
 *  · pesado (caminhão, ônibus): 1ª de 3 a 25 km/h, 900–1800 rpm a 100 km/h (pedido da auditoria); μ 0,35 (só o
 *    eixo de tração, ~40% do peso, × 0,8);
 *  · tanque: 1ª de 2 a 12 km/h; μ 0,7.
 */
const FAIXAS: Record<Tipo, { primeira: [number, number] | null; rpm100: [number, number] | null; zeroCem: [number, number] | null; mu: number }> = {
  carro: { primeira: [25, 110], rpm100: [1500, 4500], zeroCem: [2.5, 35], mu: 0.95 },
  hiper: { primeira: [25, 130], rpm100: [1500, 4500], zeroCem: [1.8, 5], mu: 1.2 },
  corrida: { primeira: null, rpm100: null, zeroCem: [1.5, 7], mu: 1.6 },
  moto: { primeira: [50, 200], rpm100: [3000, 7000], zeroCem: [2.2, 9], mu: 1.0 },
  pesado: { primeira: [3, 25], rpm100: [900, 1800], zeroCem: null, mu: 0.35 },
  tanque: { primeira: [2, 12], rpm100: null, zeroCem: null, mu: 0.7 },
};
/** carros com sobremarcha longa de fábrica (motor de 5 L ou mais, ou caixa de 8+ marchas: Corvette, Camaro, Mustang de
 *  10 marchas rodam a 1200–1400 rpm a 100 km/h): o piso de rpm a 100 km/h desce para este valor */
const PISO_RPM100_SOBREMARCHA = 1100;
/** degrau entre marchas vizinhas (relação de cima / de baixo): abaixo de 1,05 as duas marchas são a mesma; acima de
 *  2,2 o giro cai mais da metade na troca (só a 1ª "de força" de caminhão e de tanque passa disso) */
const DEGRAU = [1.05, 2.2] as const;
/** velocidade no corte da última marcha contra a final estimada pelo arrasto: abaixo de 0,8 o carro bate no corte antes
 *  da final; acima de 1,6 a última marcha é longa demais para ser a da final (sobremarcha de estrada, ou diferencial errado) */
const CORTE_SOBRE_FINAL = [0.8, 1.6] as const;
/** kg por kW: 0,5 (F1) a 40 (utilitário antigo carregado); caminhão de 40 t com 350 kW dá 110, por isso o pesado e o
 *  tanque ficam fora desta faixa */
const KG_POR_KW = [0.5, 40] as const;
/** potência específica (kW/L): aspirado de rua 12–100, sobrealimentado até 250; corrida e moto até 330 */
const KW_POR_LITRO = { min: 12, aspirado: 100, sobrealimentado: 250, corrida: 330 };
/** pressão média efetiva no torque máximo (bar): diesel aspirado ~7, turbo de caminhão 20–26, locomotiva 2T 9–13 */
const PME_DIESEL = [5.5, 30] as const;
/** velocidade média do pistão do diesel (m/s): 4–14,5 na rotação de potência (locomotiva 8, caminhão 11, picape 12);
 *  até 16,5 na rotação máxima sem carga (`rpmMax`, onde o governador corta) */
const PISTAO_DIESEL = [4, 14.5] as const, PISTAO_DIESEL_MAX = 16.5;

/** Mach na ponta da pá da hélice (rotação máxima): acima de 0,95 a pá é supersônica (o Tu-95 e o XF-84H são a exceção) */
const MACH_HELICE_MAX = 0.95;
/** coeficiente de potência C_P = P/(ρ·n³·D⁵) na rotação máxima: de 0,02 (hélice pequena de passo fixo) a 0,6 (turboélice de 6 pás) */
const CP_HELICE = [0.02, 0.6] as const;
/** rotor de helicóptero: ponta a 0,50–0,72 de Mach no pairado (180–230 m/s nos leves a pistão, 190 nos UAV) */
const MACH_ROTOR_PAIRADO = [0.5, 0.72] as const;
/** pá que avança, no cruzeiro: o pedido da auditoria era 0,75, mas o R44 de verdade (215 m/s de ponta + 200 km/h) dá
 *  0,79 e o R22 0,76; com 0,75 a ficha certa dava alerta. Os helicópteros evitam passar de ~0,85–0,9. */
const MACH_ROTOR_CRUZEIRO_MAX = 0.85;
/** velocidade de cruzeiro típica de cada aeronave (km/h). É referência da ferramenta, não campo da ficha: os presets
 *  não têm velocidade. Usada só para o Mach helicoidal da ponta no cruzeiro (com a rotação MÁXIMA: é o pior caso). */
const CRUZEIRO_KMH: Record<string, number> = {
  // aviação do Ronco
  c172: 226, o360: 237, io540: 287, o200: 198, io550: 339, rotax912: 200, bell47: 135, r22: 177, r44: 200, s300: 153,
  // radial
  r1820: 370, r1830: 333, r2800: 350, r2800turbo: 560, r4360: 390, r1340: 233, r985: 170, m14p: 190, m14pf: 330,
  rotec2800: 150, rotec3600: 160, verner3: 110, verner5: 150, s55: 137,
  // rotativos
  mistral: 280, ae110: 200, ae50r: 190, ar741: 150,
  // turboélices
  regional: 510, q400: 667, c130: 643, kingair: 560, single: 344, pc12: 528, stucano: 520,
};
const CRUZEIRO_PADRAO = 200;

/** Mach tangencial na ponta do fan em N1 100% (π·D·N1/60/c): fans civis 1,0–1,5, compressores de baixa de caça até 1,6 */
const MACH_FAN = [0.85, 1.65] as const;
/** turboélices: `fanD`/`n1Max` descrevem o compressor do gerador de gás; a ponta de um rotor centrífugo anda a 450–600 m/s
 *  (Mach 1,3–1,75): acima disso o diâmetro ou a rotação do preset está grande */
const MACH_GERADOR_GAS = [0.9, 1.75] as const;

/** vapor: rotação da roda motriz na velocidade máxima (o recorde da Mallard, 203 km/h, foi a ~530 rpm; em serviço
 *  raramente passava de 400) e velocidade média do pistão (as expressas chegavam a 9–10 m/s) */
const RPM_RODA_VAPOR_MAX = 500;
const PISTAO_VAPOR_MAX = 10;
/** fator de aderência (peso aderente / esforço de tração nominal) de locomotivas de expansão simples: os projetos
 *  ficavam entre 3,5 e 5; abaixo disso a máquina patina sempre, muito acima o cilindro é pequeno para o peso */
const FATOR_ADERENCIA = [3.3, 6.5] as const;
/** escorregamento da roda de pás (src/carriers/barco.ts, ESCORREGAMENTO: não é exportado) */
const ESCORREGAMENTO_PAS = 0.75;

/** elétricos: a rotação do motor na velocidade máxima da ficha tem de caber em `rpmMax` (2% de folga) e não ficar
 *  abaixo de 60% dele; o canto da curva (Pmax/Tn) e `rpmBase` devem concordar a menos de 30% */
const FOLGA_RPM_MAX = 1.02, FRACAO_RPM_MAX_MIN = 0.6, DESVIO_RPM_BASE = 0.3;
/** aceleração de partida em nível (m/s²): locomotiva com trem 0,3–0,8; metrô e trem-unidade 0,8–1,3; bonde até 1,4 */
const ACEL_TREM = [0.25, 1.45] as const;
/** 0–100 km/h de carro elétrico (s): 1,8 (hipercarro) a 20 (compacto fraco) */
const ZERO_CEM_ELETRICO = [1.8, 20] as const;
/** 0–100 medido contra o ideal só pela potência, m·v²/(2·P·η): os elétricos de série ficam em 1,4–1,7×; acima de 3×
 *  o carro está sem torque na roda em baixa (redução longa demais para o torque do motor) */
const ARRANCADA_SOBRE_IDEAL = 3;

// =================================================================================================================
// Saída
// =================================================================================================================
const args = process.argv.slice(2);
const MD = args.includes('--md'), SO_ALERTAS = args.includes('--so-alertas');
const FAMILIA = args.find((a) => !a.startsWith('--'));
const FAMILIAS = ['ronco', 'diesel', 'radial', 'rotativo', 'vapor', 'eletrico', 'turbina'] as const;
type Familia = (typeof FAMILIAS)[number];
if (FAMILIA && !FAMILIAS.includes(FAMILIA.replace(/s$/, '') as Familia)) {
  console.error(`família desconhecida: ${FAMILIA} (${FAMILIAS.join(', ')})`);
  process.exit(0);
}
const quer = (f: Familia) => !FAMILIA || FAMILIA.replace(/s$/, '') === f;

type Alerta = { texto: string; forca: number };
type Linha = { id: string; nome: string; v: (string | number)[]; alertas: Alerta[] };
const todas: { familia: Familia; id: string; nome: string; alertas: Alerta[] }[] = [];

const n = (x: number, d = 0) => (Number.isFinite(x) ? x.toFixed(d).replace('.', ',') : '—');
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
/** alerta de faixa: força 1 + 10 × o quanto passou (20% fora → 3) */
function fora(al: Alerta[], rotulo: string, valor: number, [lo, hi]: readonly [number, number], d = 0, unidade = '') {
  if (!Number.isFinite(valor)) return;
  if (valor < lo) al.push({ texto: `${rotulo} ${n(valor, d)}${unidade} (abaixo de ${n(lo, d)})`, forca: 1 + (10 * (lo - valor)) / Math.abs(lo) });
  else if (valor > hi) al.push({ texto: `${rotulo} ${n(valor, d)}${unidade} (acima de ${n(hi, d)})`, forca: 1 + (10 * (valor - hi)) / Math.abs(hi) });
}
/** campo ausente que o código preenche com um padrão: informativo (força 0,5) */
const padrao = (al: Alerta[], texto: string) => al.push({ texto: `padrão: ${texto}`, forca: 0.5 });

function tabela(familia: Familia, titulo: string, colunas: string[], linhas: Linha[], nota?: string) {
  for (const l of linhas) todas.push({ familia, id: l.id, nome: l.nome, alertas: l.alertas });
  const mostra = SO_ALERTAS ? linhas.filter((l) => l.alertas.length) : linhas;
  if (!mostra.length) return;
  const cab = ['id', 'preset', ...colunas, 'alerta'];
  const corpo = mostra.map((l) => [l.id, l.nome, ...l.v.map(String), l.alertas.length ? l.alertas.map((a) => a.texto).join('; ') : MD ? '' : '—']);
  if (MD) {
    console.log(`\n### ${titulo}\n`);
    if (nota) console.log(`${nota}\n`);
    console.log(`| ${cab.join(' | ')} |\n|${cab.map(() => '---').join('|')}|`);
    for (const c of corpo) console.log(`| ${c.map((x) => x.replace(/\|/g, '/')).join(' | ')} |`);
  } else {
    console.log(`\n== ${titulo} ==`);
    if (nota) console.log(nota);
    const w = cab.map((h, i) => (i === cab.length - 1 ? 0 : Math.max(h.length, ...corpo.map((c) => c[i].length))));
    const fmt = (c: string[]) => c.map((x, i) => (i === c.length - 1 ? x : x.padEnd(w[i]))).join('  ');
    console.log(fmt(cab));
    for (const c of corpo) console.log(fmt(c));
  }
}

// =================================================================================================================
// Câmbio (convenções do EngineDSP)
// =================================================================================================================
interface Veiculo {
  id: string; nome: string; tipo: Tipo;
  corte: number; idle: number; litros: number; sobrealimentado: boolean;
  kW?: number; rpmPico: number; curva: readonly number[]; J: number;
  massa: number; rel: number[]; final: number; rw: number; kD: number; roll: number; tTroca: number;
  marchas: number; padroes: string[]; extras: Alerta[];
  /** multiplica o teto de kW/L (Wankel: a cilindrada nominal conta uma câmara por rotor, metade da equivalente) */
  fatorKwL: number;
}

/** especificação nas convenções do Ronco (`redline`, `ratios`, `finalDrive`, `wheelR`, `drag`, `mass`, `power`) → veículo */
function veiculo(s: any, tipo: Tipo, o: { rpmPico?: number; curva?: readonly number[]; J?: number; fatorKwL?: number } = {}): Veiculo {
  const pad: string[] = [], corte = s.redline, L = s.displacement;
  let rel: number[];
  if (s.ratios && s.ratios.length === s.gears) rel = s.ratios;
  else {
    rel = gearRatios(s.gears).slice(1);
    pad.push(s.ratios ? `ratios tem ${s.ratios.length} relações e gears = ${s.gears}: o DSP descarta a lista e usa gearRatios(${s.gears})` : `ratios ausente → gearRatios(${s.gears})`);
  }
  let final = s.finalDrive;
  if (!final) { final = defaultFinal(corte); pad.push(`finalDrive ausente → defaultFinal(${corte}) = ${n(final, 2)}`); }
  let massa = s.mass;
  if (!massa) { massa = clamp(850 + 160 * L, 950, 1900); pad.push(`mass ausente → ${n(massa)} kg (850 + 160·L, entre 950 e 1900)`); }
  if (!s.wheelR) pad.push('wheelR ausente → 0,33 m');
  if (s.drag == null) pad.push('drag ausente → 0,42');
  if (!s.power) pad.push('power ausente → a dinâmica usa a potência que o modelo der (sem escala de torque)');
  const auto = s.transmission === 'auto';
  return {
    id: s.id, nome: s.name, tipo, corte, idle: s.idle, litros: L, sobrealimentado: s.aspiration === 'turbo' || s.aspiration === 'super',
    kW: s.power || undefined, rpmPico: o.rpmPico ?? FRACAO_PICO * corte, curva: o.curva ?? CURVA.otto,
    J: o.J ?? (0.05 + 0.045 * L) * (s.inertia ?? 1),
    massa, rel, final, rw: s.wheelR || 0.33, kD: s.drag ?? 0.42, roll: (s.rolagem || 0.012) * massa * G,
    tTroca: clamp(s.shiftTime || (auto ? 0.36 : 0.26), 0.04, 1), marchas: s.gears, padroes: pad, extras: [], fatorKwL: o.fatorKwL ?? 1,
  };
}

/** potência no volante (W) a `rpm`, pela curva empírica */
function potencia(v: Veiculo, rpm: number) {
  const r = rpm / v.rpmPico, [a, b, c] = v.curva;
  return (v.kW ?? 0) * 1000 * clamp(a * r + b * r * r - c * r * r * r, 0, 1);
}
const vNoCorte = (v: Veiculo, g: number) => (v.corte / RPM) * v.rw / (v.rel[g] * v.final); // m/s
const rpmEm = (v: Veiculo, g: number, vel: number) => (vel / v.rw) * v.rel[g] * v.final * RPM;
const resistencia = (v: Veiculo, vel: number) => v.kD * vel * vel + v.roll;

/** final só pelo arrasto: Pmax·η = (k·v² + rolagem)·v */
function finalArrasto(v: Veiculo) {
  if (!v.kW) return NaN;
  const P = v.kW * 1000 * ETA_TRANSMISSAO;
  let lo = 0, hi = 200;
  for (let i = 0; i < 60; i++) { const m = 0.5 * (lo + hi); if (resistencia(v, m) * m < P) lo = m; else hi = m; }
  return lo;
}
/** final com o câmbio: a maior velocidade em que alguma marcha, sem passar do corte, ainda tem potência para o arrasto */
function finalCambio(v: Veiculo) {
  let melhor = 0, marcha = 0;
  for (let g = 0; g < v.rel.length; g++) {
    for (let vel = vNoCorte(v, g); vel > 0.5; vel -= 0.05) {
      const rpm = rpmEm(v, g, vel);
      if (rpm < v.idle) break;
      if (potencia(v, rpm) * ETA_TRANSMISSAO >= resistencia(v, vel) * vel) { if (vel > melhor) { melhor = vel; marcha = g + 1; } break; }
    }
  }
  return { v: melhor, marcha };
}
/** tempo de 0 a `alvo` (m/s). `mu` = aderência (Infinity: sem limite, como o DSP), `eta` = rendimento da transmissão */
function arrancada(v: Veiculo, alvo: number, mu: number, eta: number) {
  if (!v.kW) return NaN;
  const dt = 0.002, rpmLanc = Math.min(v.rpmPico, Math.max(1.5 * v.idle, 0.5 * v.rpmPico));
  let vel = 0, g = 0, t = 0, troca = 0;
  while (vel < alvo && t < 300) {
    const R = v.rel[g] * v.final, rpmRoda = (vel / v.rw) * R * RPM;
    if (troca <= 0 && rpmRoda >= 0.985 * v.corte && g < v.rel.length - 1) { g++; troca = v.tTroca; continue; }
    // em 1ª a embreagem (ou o conversor) segura o motor na rotação de saída até a roda alcançar
    const patina = g === 0 && rpmRoda < rpmLanc, rpm = Math.min(v.corte, patina ? rpmLanc : rpmRoda);
    let F = 0;
    if (troca > 0) troca -= dt;
    else F = Math.min((potencia(v, rpm) / (rpm / RPM)) * R * eta / v.rw, mu * v.massa * G);
    // massa equivalente: rodas (3%) e, com a embreagem fechada, o motor refletido (J·(R/r)²)
    const mEq = 1.03 * v.massa + (patina ? 0 : v.J * (R / v.rw) * (R / v.rw));
    vel = Math.max(0, vel + ((F - resistencia(v, vel)) / mEq) * dt);
    t += dt;
  }
  return vel >= alvo ? t : NaN;
}

/** nota (força 0,6) nos veículos que repetem a lista de relações de outro: pode ser a mesma caixa (Supra e Skyline usam a
 *  Getrag V160) ou ficha copiada */
function repetidas(vs: Veiculo[]) {
  const porLista = new Map<string, Veiculo[]>();
  for (const v of vs) { if (v.padroes.some((p) => p.startsWith('ratios'))) continue; const k = v.rel.join('/'); porLista.set(k, [...(porLista.get(k) ?? []), v]); }
  for (const g of porLista.values()) if (g.length > 1) for (const v of g) {
    const outros = g.filter((o) => o !== v).map((o) => `${o.id}${o.final === v.final ? '' : ` (diferencial ${n(o.final, 2)})`}`);
    v.extras.push({ texto: `mesmas relações de ${outros.join(', ')}`, forca: 0.6 });
  }
  return vs;
}

const COLS_CAMBIO = ['kW', 'kg', 'kg/kW', 'kW/L', 'corte', 'km/h no corte, por marcha', 'rpm a 100 (últ.)', 'final arrasto', 'final c/ câmbio', '0–100 s', '0–100 sem ader.'];
const NOTA_CAMBIO = `Velocidade no corte = (corte/60)·2π·raio/(relação·diferencial), como no \`EngineDSP\`. "final arrasto": Pmax·${n(ETA_TRANSMISSAO, 2)} = (arrasto·v² + rolagem)·v. ` +
  `"final c/ câmbio": a maior velocidade que alguma marcha alcança sem passar do corte (entre parênteses, a marcha). "0–100": curva de potência empírica com pico a ${n(100 * FRACAO_PICO)}% do corte ` +
  '(no Diesel, em `rpmPotencia`), aderência por tipo de veículo e tempo de troca da ficha; "sem ader.": sem limite de aderência nem perda, que é como o DSP anda. Quando a final é menor que 100 km/h, o tempo é até 90% dela.';

function linhaCambio(v: Veiculo): Linha {
  const al: Alerta[] = [...v.extras], fx = FAIXAS[v.tipo], nG = v.rel.length;
  const vc = v.rel.map((_, g) => vNoCorte(v, g) * 3.6);
  const vA = finalArrasto(v) * 3.6, fc = finalCambio(v), vF = fc.v * 3.6;
  // rpm a 100 km/h na última marcha (ou na final, se ela for menor)
  const vRef = Number.isFinite(vF) && vF > 0 && vF < 100 ? vF : 100;
  const rpm100 = rpmEm(v, nG - 1, vRef / 3.6);
  // estruturais
  for (const p of v.padroes) (p.startsWith('ratios tem') ? al.push({ texto: p, forca: 8 }) : padrao(al, p));
  for (let g = 1; g < nG; g++) {
    const d = v.rel[g - 1] / v.rel[g];
    if (d <= 1) al.push({ texto: `marchas fora de ordem: ${g}ª ${n(v.rel[g - 1], 2)} → ${g + 1}ª ${n(v.rel[g], 2)}`, forca: 8 });
    else if (!(v.tipo === 'pesado' || v.tipo === 'tanque') || g > 1) fora(al, `degrau ${g}ª→${g + 1}ª`, d, DEGRAU, 2);
    else if (d > 2.6) fora(al, `degrau ${g}ª→${g + 1}ª`, d, [DEGRAU[0], 2.6], 2);
  }
  if (fx.primeira) fora(al, '1ª no corte', vc[0], fx.primeira, 0, ' km/h');
  if (fx.rpm100 && vRef === 100) {
    let [lo, hi] = fx.rpm100;
    if (v.tipo === 'carro' || v.tipo === 'hiper') { if (v.litros >= 5 || nG >= 8) lo = PISO_RPM100_SOBREMARCHA; }
    if (v.tipo === 'moto') lo = Math.min(lo, 0.4 * v.corte);
    if (rpm100 > v.corte) al.push({ texto: `não chega a 100 km/h: a última marcha bate no corte a ${n(vc[nG - 1])} km/h`, forca: 1 + (10 * (rpm100 - v.corte)) / v.corte });
    else fora(al, 'rpm a 100 km/h na última', rpm100, [lo, hi]);
  }
  if (Number.isFinite(vA)) {
    const q = vc[nG - 1] / vA;
    if (q < CORTE_SOBRE_FINAL[0]) al.push({ texto: `câmbio curto: última marcha corta a ${n(vc[nG - 1])} km/h, ${n(100 * q)}% da final pelo arrasto (${n(vA)})`, forca: 1 + (10 * (CORTE_SOBRE_FINAL[0] - q)) / CORTE_SOBRE_FINAL[0] });
    else if (q > CORTE_SOBRE_FINAL[1]) al.push({ texto: `última marcha longa: corta a ${n(vc[nG - 1])} km/h, ${n(q, 2)}× a final pelo arrasto (${n(vA)})`, forca: 1 + (10 * (q - CORTE_SOBRE_FINAL[1])) / CORTE_SOBRE_FINAL[1] });
    else if (vF < 0.9 * vA) al.push({ texto: `nenhuma marcha chega à final pelo arrasto: ${n(vF)} km/h em ${fc.marcha}ª contra ${n(vA)}`, forca: 1 + (10 * (0.9 * vA - vF)) / (0.9 * vA) });
  }
  const kgkW = v.kW ? v.massa / v.kW : NaN, kWL = v.kW ? v.kW / v.litros : NaN;
  if (v.tipo !== 'pesado' && v.tipo !== 'tanque') fora(al, 'kg/kW', kgkW, KG_POR_KW, 1);
  const teto = v.tipo === 'corrida' || v.tipo === 'moto' || v.tipo === 'hiper' ? KW_POR_LITRO.corrida : v.sobrealimentado ? KW_POR_LITRO.sobrealimentado : KW_POR_LITRO.aspirado;
  fora(al, 'kW/L', kWL, [KW_POR_LITRO.min, teto * v.fatorKwL], 0);
  // arrancada
  const alvo = (vF > 0 && vF < 100 ? 0.9 * vF : 100) / 3.6, rot = vF > 0 && vF < 100 ? `0–${n(0.9 * vF)}: ` : '';
  const t = arrancada(v, alvo, fx.mu, ETA_TRANSMISSAO), tDsp = arrancada(v, alvo, Infinity, 1);
  if (v.kW && !Number.isFinite(t)) al.push({ texto: `não chega a ${n(alvo * 3.6)} km/h em 300 s`, forca: 6 });
  else if (fx.zeroCem && !rot) fora(al, '0–100', t, fx.zeroCem, 1, ' s');
  return {
    id: v.id, nome: v.nome, alertas: al,
    v: [n(v.kW ?? NaN), n(v.massa), n(kgkW, 1), n(kWL), n(v.corte), vc.map((x) => n(x)).join('/'), vRef === 100 ? n(rpm100) : `${n(rpm100)} (a ${n(vRef)} km/h)`,
      n(vA), `${n(vF)} (${fc.marcha}ª)`, Number.isFinite(t) ? `${rot}${n(t, 1)}` : '—', Number.isFinite(tDsp) ? n(tDsp, 1) : '—'],
  };
}

// =================================================================================================================
// Hélices e rotores (convenções de configHelice/configRotor)
// =================================================================================================================
const COLS_HELICE = ['kW', 'rpm motor', 'redução', 'rpm hélice', 'D (m)', 'pás', 'passagem de pá (Hz)', 'ponta (m/s)', 'Mach parado', 'cruzeiro (km/h)', 'Mach no cruzeiro', 'C_P'];
const NOTA_HELICE = 'Rotação da hélice = `helice.nMax`, ou `rpmMax`·`reducao` se ele faltar (`configHelice`). Mach = hipotenusa(π·D·n/60, v)/343 (`machPonta`). ' +
  'A velocidade de cruzeiro é a típica da aeronave (tabela da ferramenta, não é campo da ficha) e a rotação é a máxima: é o pior caso. C_P = P/(ρ·n³·D⁵).';

function linhaHelice(s: any, kW: number): Linha {
  const al: Alerta[] = [], h = configHelice(s), rpmMotor = s.rpmMax || s.redline;
  const vCr = CRUZEIRO_KMH[s.id] ?? CRUZEIRO_PADRAO;
  if (!(s.id in CRUZEIRO_KMH)) padrao(al, `sem velocidade de cruzeiro na tabela da ferramenta → ${CRUZEIRO_PADRAO} km/h`);
  // (helice.nMax e reducao ausentes não são chute: a hélice gira a rpmMax × reducao, direta se não houver redutor)
  if (s.helice.nMax && Math.abs(s.helice.nMax - rpmMotor / h.i) / s.helice.nMax > 0.02) al.push({ texto: `helice.nMax ${n(s.helice.nMax)} ≠ rpmMax × reducao = ${n(rpmMotor / h.i)} rpm`, forca: 1 + (10 * Math.abs(s.helice.nMax - rpmMotor / h.i)) / s.helice.nMax });
  const ponta = (Math.PI * h.D * h.nHelice) / 60, M0 = machPonta(h.D, h.nHelice), M1 = machPonta(h.D, h.nHelice, vCr / 3.6);
  const nps = h.nHelice / 60, cp = (kW * 1000) / (RHO * nps * nps * nps * Math.pow(h.D, 5));
  if (M0 > MACH_HELICE_MAX) al.push({ texto: `ponta da pá a Mach ${n(M0, 2)} parado (acima de ${n(MACH_HELICE_MAX, 2)})`, forca: 1 + (10 * (M0 - MACH_HELICE_MAX)) / MACH_HELICE_MAX });
  else if (M1 > MACH_HELICE_MAX) al.push({ texto: `ponta da pá a Mach ${n(M1, 2)} no cruzeiro de ${n(vCr)} km/h (acima de ${n(MACH_HELICE_MAX, 2)})`, forca: 1 + (10 * (M1 - MACH_HELICE_MAX)) / MACH_HELICE_MAX });
  fora(al, 'C_P', cp, CP_HELICE, 3);
  return {
    id: s.id, nome: s.name, alertas: al,
    v: [n(kW), n(rpmMotor), h.i === 1 ? 'direta' : `${n(h.i, 3)}:1`, n(h.nHelice), n(h.D, 2), `${h.B}${h.passoFixo ? ' fixo' : ''}`, n(bpfHelice(h.B, h.nHelice), 1), n(ponta), n(M0, 2), n(vCr), n(M1, 2), n(cp, 3)],
  };
}

const COLS_ROTOR = ['kW', 'Nr (rpm)', 'D (m)', 'pás', 'passagem de pá (Hz)', 'ponta (m/s)', 'Mach pairado', 'cruzeiro (km/h)', 'Mach pá que avança', 'cauda rpm', 'cauda Hz', 'cauda Mach', 'motor em Nr (rpm)', '% de rpmMax', 'pairado (kW)', '% da potência', 'kg/m²'];
const NOTA_ROTOR = 'Rotor do preset sobre o `ROTOR_R44` (`configRotor`). Motor em Nr = Nr·`icx`. Potência do pairado = `CargaRotor.potencias()` com o coletivo em 0,75 (tração = peso), ' +
  'que é a carga que o motor do simulador segura. Mach da pá que avança = (ΩR + v)/343 na velocidade de cruzeiro típica (tabela da ferramenta).';

function linhaRotor(s: any, kW: number): Linha {
  const al: Alerta[] = [], c = configRotor(s), rpmMotor = s.rpmMax || s.redline;
  if (!s.rotor || !Object.keys(s.rotor).length) padrao(al, 'rotor vazio → ROTOR_R44 inteiro (R 5,03 m, 408 rpm, 1090 kg)');
  else for (const k of ['B', 'R', 'Nr', 'sigma', 'cd0', 'J_rot', 'Bc', 'Rc', 'ic', 'icx', 'massa']) if (s.rotor[k] == null) padrao(al, `rotor.${k} ausente → ${n((c as any)[k], 4).replace(/,?0+$/, '')} do R44`);
  const vCr = CRUZEIRO_KMH[s.id] ?? CRUZEIRO_PADRAO, Om = c.Nr / RPM, ponta = Om * c.R;
  const M0 = ponta / C_SOM, M1 = (ponta + vCr / 3.6) / C_SOM;
  const rpmC = c.Nr * c.ic, pontaC = (rpmC / RPM) * c.Rc;
  const carga = new CargaRotor(c); carga.c = 0.75;
  const pPair = carga.potencias(Om).total / 1000, rpmNr = c.Nr * c.icx;
  fora(al, 'Mach da ponta no pairado', M0, MACH_ROTOR_PAIRADO, 2);
  if (M1 > MACH_ROTOR_CRUZEIRO_MAX) al.push({ texto: `pá que avança a Mach ${n(M1, 2)} a ${n(vCr)} km/h (acima de ${n(MACH_ROTOR_CRUZEIRO_MAX, 2)})`, forca: 1 + (10 * (M1 - MACH_ROTOR_CRUZEIRO_MAX)) / MACH_ROTOR_CRUZEIRO_MAX });
  if (pontaC / C_SOM > 0.75) al.push({ texto: `ponta do rotor de cauda a Mach ${n(pontaC / C_SOM, 2)}`, forca: 1 + (10 * (pontaC / C_SOM - 0.75)) / 0.75 });
  fora(al, 'rotação do motor em Nr, em % de rpmMax,', (100 * rpmNr) / rpmMotor, [80, 102], 0, '%');
  if (pPair > kW) al.push({ texto: `o pairado pede ${n(pPair)} kW e o motor tem ${n(kW)}`, forca: 1 + (10 * (pPair - kW)) / kW });
  return {
    id: s.id, nome: s.name, alertas: al,
    v: [n(kW), n(c.Nr), n(2 * c.R, 2), c.B, n((c.B * c.Nr) / 60, 1), n(ponta), n(M0, 2), n(vCr), n(M1, 2), n(rpmC), n((c.Bc * rpmC) / 60, 1), n(pontaC / C_SOM, 2),
      n(rpmNr), n((100 * rpmNr) / rpmMotor), n(pPair), n((100 * pPair) / kW), n(c.massa / (Math.PI * c.R * c.R), 1)],
  };
}

// =================================================================================================================
// Famílias
// =================================================================================================================
const TIPO_RONCO: Record<string, Tipo> = { race: 'corrida', hyper: 'hiper', moto: 'moto' };

if (quer('ronco')) {
  const carros = repetidas(PRESETS_RONCO.map((p) => veiculo({ ...ACESSORIOS_PADRAO, ...p }, TIPO_RONCO[p.family] ?? 'carro'))).map(linhaCambio);
  tabela('ronco', `Ronco: câmbio (${carros.length} carros e motos)`, COLS_CAMBIO, carros, NOTA_CAMBIO);
  const av = PRESETS_AVIACAO.map((p) => ({ ...ACESSORIOS_PADRAO, ...p }) as any);
  tabela('ronco', 'Ronco, Aviação: hélices', COLS_HELICE, av.filter((s) => s.helice).map((s) => linhaHelice(s, s.power)), NOTA_HELICE);
  tabela('ronco', 'Ronco, Aviação: rotores', COLS_ROTOR, av.filter((s) => s.rotor).map((s) => linhaRotor(s, s.power)), NOTA_ROTOR);
}

if (quer('diesel')) {
  const D = PRESETS_DIESEL.map((p) => ({ ...PADRAO_DIESEL, ...p }) as any);
  // ---- motor: cilindrada, pressão média efetiva, torque na rotação de potência
  const motor: Linha[] = D.map((s) => {
    const al: Alerta[] = [];
    const geo = (Math.PI / 4) * Math.pow(s.diametro / 100, 2) * (s.curso / 100) * s.cylinders; // L
    if (Math.abs(geo - s.displacement) / s.displacement > 0.02) al.push({ texto: `cilindrada da ficha ${n(s.displacement, 2)} L ≠ π/4·d²·curso·N = ${n(geo, 2)} L`, forca: 1 + (10 * Math.abs(geo - s.displacement)) / s.displacement });
    const voltas = s.tempos === 2 ? 1 : 2, pme = (voltas * TAU * s.torque) / (s.displacement * 1e-3) / 1e5;
    fora(al, 'pressão média efetiva no torque máximo', pme, PME_DIESEL, 1, ' bar');
    const tPot = (s.power * 1000) / (s.rpmPotencia / RPM);
    if (tPot > 1.02 * s.torque) al.push({ texto: `a potência a ${n(s.rpmPotencia)} rpm pede ${n(tPot)} N·m, mais que o torque máximo da ficha (${n(s.torque)})`, forca: 1 + (10 * (tPot - s.torque)) / s.torque });
    if (s.redline !== s.rpmMax) al.push({ texto: `redline ${s.redline} ≠ rpmMax ${s.rpmMax} (o EngineDSP lê redline; o diesel, rpmMax)`, forca: 4 });
    if (s.rpmPotencia > s.rpmMax) al.push({ texto: `rpmPotencia ${s.rpmPotencia} acima de rpmMax ${s.rpmMax}`, forca: 4 });
    const pist = (2 * (s.curso / 1000) * s.rpmPotencia) / 60, pistMax = (2 * (s.curso / 1000) * s.rpmMax) / 60;
    fora(al, 'velocidade média do pistão na rotação de potência', pist, PISTAO_DIESEL, 1, ' m/s');
    fora(al, 'velocidade média do pistão em rpmMax', pistMax, [0, PISTAO_DIESEL_MAX], 1, ' m/s');
    return { id: s.id, nome: s.name, alertas: al, v: [`${s.cylinders} × ${n(s.diametro, 1)} × ${n(s.curso, 1)}`, n(s.displacement, 2), n(geo, 2), `${s.tempos}T`, n(s.power), n(s.rpmPotencia), n(s.torque), n(tPot), n(pme, 1), n(s.idle), n(s.rpmMax), `${n(pist, 1)} / ${n(pistMax, 1)}`] };
  });
  tabela('diesel', 'Diesel: motor', ['cil. × Ø × curso (mm)', 'L (ficha)', 'L (geometria)', 'ciclo', 'kW', 'rpm de potência', 'torque máx. (N·m)', 'torque na potência', 'PME (bar)', 'lenta', 'rpmMax', 'pistão na potência / em rpmMax (m/s)'], motor,
    'PME = voltas por ciclo·2π·torque/cilindrada (2 voltas no 4 tempos, 1 no 2 tempos). "Torque na potência" = potência/ω em `rpmPotencia`: não pode passar do torque máximo da ficha.');
  // ---- câmbio
  const rod = repetidas(D.filter((s) => s.portadores.includes('carro') && s.gears > 0).map((s) => veiculo(s, s.classe === 'leve' ? 'carro' : 'pesado', { rpmPico: s.rpmPotencia, curva: s.idi ? CURVA.idi : CURVA.diesel, J: s.J }))).map(linhaCambio);
  tabela('diesel', 'Diesel: câmbio (picapes, carros, caminhões e ônibus)', COLS_CAMBIO, rod, NOTA_CAMBIO);
  // ---- geradores
  const ger: Linha[] = D.filter((s) => s.gerador).map((s) => {
    const al: Alerta[] = [], g = s.gerador, rpm = rpmGerador(g.polos, g.fRede), eixo = g.kWe / g.eta;
    if (rpm > s.rpmMax || rpm < s.idle) al.push({ texto: `rotação síncrona ${n(rpm)} rpm fora de lenta–rpmMax (${s.idle}–${s.rpmMax})`, forca: 6 });
    if (eixo > s.power) al.push({ texto: `o gerador pede ${n(eixo)} kW no eixo e o motor tem ${n(s.power)}`, forca: 1 + (10 * (eixo - s.power)) / s.power });
    return { id: s.id, nome: s.name, alertas: al, v: [g.polos, g.fRede, n(rpm), n(g.kWe), n(eixo), n(s.power), n((100 * eixo) / s.power), n(s.rpmPotencia)] };
  });
  tabela('diesel', 'Diesel: no portador gerador', ['polos', 'rede (Hz)', 'rpm síncrona', 'kWe', 'kW no eixo', 'kW do motor', '% do motor', 'rpm de potência'], ger, 'rpm = 120·f/polos (`rpmGerador`); potência no eixo = kWe/η.');
  // ---- locomotivas
  const loc: Linha[] = D.filter((s) => s.locomotiva).map((s) => {
    const al: Alerta[] = [], L = s.locomotiva, r: number[] = L.notchRpm;
    if (r.length !== 9) al.push({ texto: `notchRpm tem ${r.length} valores (são 9: lenta e N1–N8)`, forca: 8 });
    if (r[8] !== s.rpmMax) al.push({ texto: `N8 a ${r[8]} rpm ≠ rpmMax ${s.rpmMax}`, forca: 4 });
    if (r[0] !== s.idle) al.push({ texto: `notch 0 a ${r[0]} rpm ≠ lenta ${s.idle}`, forca: 4 });
    for (let k = 1; k < r.length; k++) if (r[k] < r[k - 1]) al.push({ texto: `rotação cai de N${k - 1} (${r[k - 1]}) para N${k} (${r[k]})`, forca: 8 });
    if (L.kW > s.power) al.push({ texto: `potência de tração ${L.kW} kW acima da do motor (${s.power})`, forca: 1 + (10 * (L.kW - s.power)) / s.power });
    const voltas = s.tempos === 2 ? 1 : 2, pme8 = (voltas * ((L.kW * 1000) / L.eta)) / ((s.displacement * 1e-3 * r[8]) / 60) / 1e5;
    return { id: s.id, nome: s.name, alertas: al, v: [r.join('/'), NOTCH_POTENCIA.map((f) => n(f * L.kW)).join('/'), n(L.lentaBaixa), n(pme8, 1)] };
  });
  tabela('diesel', 'Diesel: locomotivas (rotação e potência por notch)', ['rpm em lenta e N1–N8', 'kW em lenta e N1–N8', 'lenta baixa', 'PME em N8 (bar)'], loc, 'Potência por notch = `NOTCH_POTENCIA` (src/carriers/locomotiva.ts) × kW da ficha; PME em N8 com a potência de tração/η.');
}

if (quer('radial')) {
  const R = PRESETS_RADIAL.map((p) => ({ ...PADRAO_RADIAL, ...p, redline: p.rpmMax }) as any);
  tabela('radial', 'Radial: hélices', COLS_HELICE, R.filter((s) => s.helice).map((s) => linhaHelice(s, s.power)), NOTA_HELICE);
  tabela('radial', 'Radial: rotor', COLS_ROTOR, R.filter((s) => s.rotor).map((s) => linhaRotor(s, s.power)), NOTA_ROTOR);
  const tipo: Record<string, Tipo> = { r975: 'tanque', trossi: 'corrida', megola: 'moto' };
  const terra = R.filter((s) => s.gears > 0).map((s) => linhaCambio(veiculo(s, tipo[s.id] ?? 'carro', { J: (s.J || 1) + (s.volante || 0) })));
  tabela('radial', 'Radial: câmbio (Sherman, Monaco-Trossi, Megola)', COLS_CAMBIO, terra, NOTA_CAMBIO);
}

if (quer('rotativo')) {
  const R = PRESETS_ROTATIVO.map((p) => ({ ...PADRAO_ROTATIVO, ...p, redline: p.rpmMax }) as any);
  const tipo: Record<string, Tipo> = { r26b: 'corrida', norton: 'moto' };
  const rua = repetidas(R.filter((s) => s.portadores.includes('carro') && s.gears > 0).map((s) => veiculo(s, tipo[s.id] ?? 'carro', { J: s.J, fatorKwL: 2 }))).map(linhaCambio);
  tabela('rotativo', 'Rotativos: câmbio', COLS_CAMBIO, rua, `${NOTA_CAMBIO} kW/L sobre a cilindrada nominal (uma câmara por rotor), com o teto de alerta dobrado.`);
  tabela('rotativo', 'Rotativos: hélices', COLS_HELICE, R.filter((s) => s.helice).map((s) => linhaHelice(s, s.power)), NOTA_HELICE);
  tabela('rotativo', 'Rotativos: rotor', COLS_ROTOR, R.filter((s) => s.rotor).map((s) => linhaRotor(s, s.power)), NOTA_ROTOR);
  const outros: Linha[] = R.filter((s) => s.gerador || s.palhetas).map((s) => {
    const al: Alerta[] = [];
    if (s.gerador) {
      const g = s.gerador, rpm = rpmGerador(g.polos, g.fRede), eixo = g.kWe / g.eta;
      if (rpm > s.rpmMax || rpm < s.idle) al.push({ texto: `rotação do gerador ${n(rpm)} rpm fora de lenta–rpmMax (${s.idle}–${s.rpmMax})`, forca: 6 });
      if (eixo > s.power) al.push({ texto: `o gerador pede ${n(eixo, 1)} kW no eixo e o motor tem ${n(s.power, 1)}`, forca: 1 + (10 * (eixo - s.power)) / s.power });
      return { id: s.id, nome: s.name, alertas: al, v: [`gerador ${g.polos} polos, ${g.fRede} Hz`, n(rpm), n(s.rpmMax), `${n(g.kWe, 1)} kWe → ${n(eixo, 1)} kW no eixo de ${n(s.power, 1)}`] };
    }
    const f = s.palhetas.ferramenta, a = s.palhetas.arranque;
    return { id: s.id, nome: s.name, alertas: al, v: [`palhetas: ferramenta ${f.z} pás / arranque ${a.z} pás`, `${n(f.nLivre)} / ${n(a.nLivre)} livre`, n(s.rpmMax), `passagem de palheta ${n((f.z * f.nLivre) / 60)} / ${n((a.z * a.nLivre) / 60)} Hz; arranque ${a.reducao}:1 → ${n(a.nLivre / a.reducao)} rpm no ${a.hospedeiro.nome}`] };
  });
  tabela('rotativo', 'Rotativos: gerador e palhetas', ['tipo', 'rpm', 'rpmMax', 'conta'], outros);
}

if (quer('vapor')) {
  const linhas: Linha[] = PRESETS_VAPOR.map((p) => {
    const al: Alerta[] = [], red = p.reducao ?? 1, c = p.cilindros;
    const estac = !(p.dRoda > 0);
    // rotação da roda na velocidade máxima (o barco anda a ESCORREGAMENTO × a ponta da roda de pás)
    const D = p.pas?.D ?? p.dRoda, v = p.vMax / 3.6;
    const rpmRoda = estac ? NaN : ((v / (p.familia === 'barco' ? ESCORREGAMENTO_PAS : 1)) / (Math.PI * D)) * 60;
    const redAlta = p.familia === 'trator' ? p.reducao2 ?? red / 2 : red;
    const rpmManivela = estac ? p.rpmGovernado ?? p.vMax : rpmRoda * redAlta;
    const esc = escapesPorVolta(p) / red; // por volta da manivela
    const sopros = (esc * rpmManivela) / 60;
    const pist = (2 * c.curso * rpmManivela) / 60;
    // esforço de tração nominal, como no VaporDSP (0,85·p·d²·s/D por par de cilindros; compound: os de alta)
    const d = p.compound ? p.compound.ap.diametro : c.diametro, pares = p.compound ? p.compound.ap.n / 2 : (c.n / 2) * (p.motores ?? 1);
    const TE = estac ? NaN : (0.85 * p.pNominal * 1e5 * d * d * c.curso * pares * red) / D;
    const fAd = p.massaAderente > 0 && TE > 0 ? (p.massaAderente * 1000 * G) / TE : NaN;
    if (!estac && p.familia !== 'barco') fora(al, 'rotação da roda na velocidade máxima', rpmRoda, [0, p.familia === 'carro' ? 1500 : RPM_RODA_VAPOR_MAX], 0, ' rpm');
    fora(al, 'velocidade média do pistão', pist, [0, PISTAO_VAPOR_MAX], 1, ' m/s');
    if (p.familia === 'locomotiva' && !p.compound) fora(al, 'fator de aderência (peso aderente/esforço)', fAd, FATOR_ADERENCIA, 2);
    if (p.massaAderente > p.massa) al.push({ texto: `massa aderente ${p.massaAderente} t maior que a massa ${p.massa} t`, forca: 8 });
    const e = eixosRodeiro(p.rodeiro);
    if (p.rodeiro && e.guia + e.arrasto > 0 && p.massaAderente >= p.massa) al.push({ texto: `rodeiro ${p.rodeiro} tem ${e.guia + e.arrasto} eixo(s) sem tração, mas a massa aderente é a massa toda (${p.massa} t)`, forca: 3 });
    if (p.rodeiro && e.guia + e.arrasto === 0 && p.familia === 'locomotiva' && p.massaAderente < p.massa) al.push({ texto: `rodeiro ${p.rodeiro} só tem eixos motores, mas a massa aderente (${p.massaAderente} t) é menor que a massa (${p.massa} t)`, forca: 3 });
    if (p.familia === 'trator' && p.rpmGovernado && rpmManivela > 3 * p.rpmGovernado) al.push({ texto: `na velocidade máxima a manivela vai a ${n(rpmManivela)} rpm, ${n(rpmManivela / p.rpmGovernado, 1)}× a rotação governada (${p.rpmGovernado})`, forca: 1 + rpmManivela / p.rpmGovernado });
    const cil = `${c.n * (p.motores ?? 1)} × ${n(d * 1000)} × ${n(c.curso * 1000)}${p.compound ? ' (AP; compound)' : ''}`;
    const extra = p.familia === 'trator' ? `1ª ${red}:1 → ${n((p.rpmGovernado ?? 0) / red / 60 * Math.PI * D * 3.6, 1)} km/h a ${p.rpmGovernado} rpm; 2ª ${redAlta}:1`
      : p.correias ? `polia a ${n((rpmManivela * p.correias.dVolante) / p.correias.dPolia)} rpm` : p.pas ? `${p.pas.n} pás → ${n((p.pas.n * rpmRoda) / 60, 1)} tapas/s` : red !== 1 ? `redução ${String(red).replace('.', ',')}:1` : '';
    return {
      id: p.id, nome: p.nome, alertas: al,
      v: [p.rodeiro ?? '—', cil, estac ? '—' : n(D, 3), n(p.pNominal, 1), estac ? `${n(rpmManivela)} rpm` : n(p.vMax), n(rpmRoda), n(rpmManivela), n(esc, 1), n(sopros, 1), n(pist, 1), n(TE / 1000), n(p.massaAderente, p.massaAderente < 10 ? 1 : 0), n(fAd, 2), extra],
    };
  });
  tabela('vapor', 'Vapor', ['rodeiro', 'cil. × Ø × curso (mm)', 'roda (m)', 'pressão (bar)', 'vMax (km/h)', 'roda rpm', 'manivela rpm', 'sopros/volta', 'sopros/s', 'pistão (m/s)', 'esforço (kN)', 'aderente (t)', 'fator de aderência', 'obs.'], linhas,
    'Na velocidade máxima da ficha: roda rpm = v/(π·D); sopros/s = `escapesPorVolta()` × rotação; pistão = 2·curso·rpm/60. Esforço = 0,85·p·d²·curso/D por par de cilindros (× redução), como no `VaporDSP` ' +
    '(nas compound ele usa os cilindros de alta, o que dá menos que o esforço real da máquina). Fator de aderência = peso aderente/esforço. Estacionária: rotação governada. Barco: a roda de pás gira 1/0,75 mais rápido que o casco anda.');
}

if (quer('eletrico')) {
  const E = PRESETS_ELETRICO;
  const reducao = (p: any) => p.reducao.estagios.reduce((a: number, s: any) => (a * s.Zc) / s.Zp, 1) || 1;
  const torque = (p: any, w: number) => Math.min(p.Tn, p.Pmax / Math.max(w, 1e-3));
  /** máquina: polos, ranhuras por polo e fase, canto da curva */
  function maquina(p: any, al: Alerta[]) {
    const polos = 2 * p.p, canto = (p.Pmax / p.Tn) * RPM;
    if (['pmsm', 'pmsrm', 'inducao', 'sincrona-excitada'].includes(p.maquina)) {
      const q = p.Zs / (3 * polos);
      if (Math.abs(q - Math.round(q)) > 1e-6) al.push({ texto: `${p.Zs} ranhuras em ${polos} polos trifásicos dá q = ${n(q, 2)} ranhuras por polo e fase (fracionário: incomum em motor de tração)`, forca: 2 });
    }
    if (!p.curvaLinear && p.fRede == null && Math.abs(canto - p.rpmBase) / p.rpmBase > DESVIO_RPM_BASE) al.push({ texto: `rpmBase ${n(p.rpmBase)} longe do canto da curva Pmax/Tn = ${n(canto)} rpm`, forca: 1 + (10 * (Math.abs(canto - p.rpmBase) / p.rpmBase - DESVIO_RPM_BASE)) });
    return { polos, canto };
  }
  // ---- carros
  const carros: Linha[] = E.filter((p) => p.portador.tipo === 'carro').map((p: any) => {
    const al: Alerta[] = [], pt = p.portador, i = reducao(p), eta = p.reducao.eta || 0.95, M = [p, ...(p.segundo ? [p.segundo] : [])];
    const { polos, canto } = maquina(p, al);
    const vMax = (p.vMaxKmh ?? NaN) / 3.6, rpmV = (vMax / pt.rw) * i * RPM, vRpmMax = (p.rpmMax / RPM) * pt.rw / i;
    const res = (v: number) => 0.5 * RHO * pt.CdA * v * v + pt.Crr * pt.massa * G;
    const Fmax = 0.75 * pt.massa * G;
    const forca = (v: number) => { const w = (v * i) / pt.rw; return Math.min(M.reduce((a, m) => a + torque(m, w), 0) * i * eta / pt.rw, Fmax); };
    let v = 0, t = 0; const alvo = Math.min(100 / 3.6, 0.9 * Math.min(vRpmMax, Number.isFinite(vMax) ? vMax : Infinity));
    while (v < alvo && t < 300) { v += ((forca(v) - res(v)) / (1.06 * pt.massa)) * 0.002; t += 0.002; }
    let vEq = 0; for (let x = 0.5; x <= vRpmMax; x += 0.1) if (forca(x) >= res(x)) vEq = x; else break;
    const kW = M.reduce((a, m) => a + m.Pmax, 0) / 1000, F0 = forca(0);
    if (p.vMaxKmh) {
      if (rpmV > FOLGA_RPM_MAX * p.rpmMax) al.push({ texto: `a ${p.vMaxKmh} km/h o motor estaria a ${n(rpmV)} rpm, acima de rpmMax ${p.rpmMax} (a redução só deixa chegar a ${n(vRpmMax * 3.6)} km/h)`, forca: 1 + (10 * (rpmV - p.rpmMax)) / p.rpmMax });
      else if (rpmV < FRACAO_RPM_MAX_MIN * p.rpmMax) al.push({ texto: `a ${p.vMaxKmh} km/h o motor está a ${n(rpmV)} rpm, só ${n((100 * rpmV) / p.rpmMax)}% de rpmMax`, forca: 1 + (10 * (FRACAO_RPM_MAX_MIN * p.rpmMax - rpmV)) / (FRACAO_RPM_MAX_MIN * p.rpmMax) });
      if (vEq < 0.9 * vMax && vEq < vRpmMax - 0.2) al.push({ texto: `a potência só leva a ${n(vEq * 3.6)} km/h, e a ficha diz ${p.vMaxKmh}`, forca: 1 + (10 * (0.9 * vMax - vEq)) / (0.9 * vMax) });
    } else padrao(al, 'vMaxKmh ausente');
    if (alvo >= 100 / 3.6 - 1e-6) {
      fora(al, '0–100', t, ZERO_CEM_ELETRICO, 1, ' s');
      // só pela potência (sem torque nem aderência limitando): t = m·v²/(2·P·η)
      const ideal = (1.06 * pt.massa * alvo * alvo) / (2 * kW * 1000 * eta);
      if (t > ARRANCADA_SOBRE_IDEAL * ideal) al.push({ texto: `0–100 em ${n(t, 1)} s com ${n(pt.massa / kW, 1)} kg/kW (só pela potência seriam ${n(ideal, 1)} s): falta torque na roda, a redução é longa`, forca: 1 + t / ideal - ARRANCADA_SOBRE_IDEAL });
    }
    if (p.segundo && Math.abs(reducao(p.segundo) - i) / i > 0.01) al.push({ texto: `o 2º motor tem redução ${n(reducao(p.segundo), 2)} e o carro usa a do 1º (${n(i, 2)}) para os dois`, forca: 2 });
    return {
      id: p.id, nome: p.name, alertas: al,
      v: [`${p.maquina}${p.segundo ? ' + ' + p.segundo.maquina : ''}`, `${polos} / ${p.Zs}`, n(i, 2), n(pt.rw, 3), n(kW), n(pt.massa), n(pt.massa / kW, 1), n(p.rpmBase), n(canto), n(p.rpmMax), n(p.vMaxKmh ?? NaN), n(rpmV), n((p.p * rpmV) / 60), n((p.reducao.estagios[0]?.Zp * rpmV) / 60),
        n(vRpmMax * 3.6), n(vEq * 3.6), n(F0 / 1000, 1), n(F0 / pt.massa, 1), alvo >= 100 / 3.6 - 1e-6 ? n(t, 1) : `0–${n(alvo * 3.6)}: ${n(t, 1)}`],
    };
  });
  tabela('eletrico', 'Elétrico: carros e trólebus', ['máquina', 'polos / ranhuras', 'redução', 'roda (m)', 'kW', 'kg', 'kg/kW', 'rpmBase', 'canto P/T (rpm)', 'rpmMax', 'vMax (km/h)', 'motor rpm na vMax', 'f elétrica (Hz)', 'engrenamento (Hz)', 'km/h em rpmMax', 'km/h de equilíbrio', 'partida (kN)', 'a₀ (m/s²)', '0–100 s'], carros,
    'Redução = Π Zc/Zp; motor rpm = v·redução/raio; f elétrica = pares de polos × rpm/60 (sem o escorregamento); engrenamento = dentes do pinhão do 1º estágio × rpm/60. Força = soma de min(Tn, Pmax/ω) dos motores × redução × η / raio, limitada a 0,75·m·g; ' +
    'resistência ½·ρ·CdA·v² + Crr·m·g; massa equivalente 1,06·m (`CarroEletrico`). A ficha não tem o diâmetro do rotor, então não há velocidade periférica do motor: no lugar dela vai a frequência de engrenamento.');
  // ---- trens
  const trens: Linha[] = E.filter((p) => p.portador.tipo === 'trem').map((p: any) => {
    const al: Alerta[] = [], pt = p.portador, cfg = pt.config as any, i = reducao(p), eta = p.reducao.eta || 0.95;
    const { polos, canto } = maquina(p, al);
    const N = cfg.N ?? 10;
    if (cfg.N == null) padrao(al, 'portador.config.N ausente → 10 vagões (o trem da Passagem)');
    const carrosM = pt.carrosMotores.filter((c: number) => c >= 1 && c <= N);
    if (carrosM.length !== pt.carrosMotores.length) al.push({ texto: `carrosMotores ${JSON.stringify(pt.carrosMotores)} tem carro fora do trem de ${N}`, forca: 4 });
    const truques = cfg.truques ? carrosM.filter((c: number) => cfg.truques.includes(c)).length : 2 * carrosM.length;
    const nMot = Math.max(1, truques * (pt.motoresPorTruque ?? 2));
    const vMax = (p.vMaxKmh ?? NaN) / 3.6, rpmV = (vMax / pt.rw) * i * RPM, vRpmMax = (p.rpmMax / RPM) * pt.rw / i;
    const d = pt.davis, res = (v: number) => d.A + d.B * v + d.C * v * v;
    const forca = (v: number) => (nMot * torque(p, (v * i) / pt.rw) * i * eta) / pt.rw;
    let vEq = 0; for (let x = 0.5; x <= vRpmMax; x += 0.1) if (forca(x) >= res(x)) vEq = x; else break;
    const F0 = forca(0), a0 = (F0 - d.A) / (1.06 * pt.massaTotal), kW = (nMot * p.Pmax) / 1000;
    fora(al, 'aceleração de partida', a0, ACEL_TREM, 2, ' m/s²');
    if (p.vMaxKmh) {
      if (rpmV > FOLGA_RPM_MAX * p.rpmMax) al.push({ texto: `a ${p.vMaxKmh} km/h o motor estaria a ${n(rpmV)} rpm, acima de rpmMax ${p.rpmMax} (a redução só deixa chegar a ${n(vRpmMax * 3.6)} km/h)`, forca: 1 + (10 * (rpmV - p.rpmMax)) / p.rpmMax });
      else if (rpmV < FRACAO_RPM_MAX_MIN * p.rpmMax) al.push({ texto: `a ${p.vMaxKmh} km/h o motor está a ${n(rpmV)} rpm, só ${n((100 * rpmV) / p.rpmMax)}% de rpmMax`, forca: 1 + (10 * (FRACAO_RPM_MAX_MIN * p.rpmMax - rpmV)) / (FRACAO_RPM_MAX_MIN * p.rpmMax) });
      if (vEq < 0.95 * vMax && vEq < vRpmMax - 0.2) al.push({ texto: `em nível a potência só leva a ${n(vEq * 3.6)} km/h, e a ficha diz ${p.vMaxKmh}`, forca: 1 + (10 * (0.95 * vMax - vEq)) / (0.95 * vMax) });
    } else padrao(al, 'vMaxKmh ausente');
    if (cfg.diametroRoda != null && Math.abs(cfg.diametroRoda - 2 * pt.rw) / (2 * pt.rw) > 0.02) al.push({ texto: `diâmetro da roda ${cfg.diametroRoda} m (som do rolamento) ≠ 2·rw = ${n(2 * pt.rw, 2)} m (tração)`, forca: 3 });
    return {
      id: p.id, nome: p.name, alertas: al,
      v: [p.maquina, `${polos} / ${p.Zs}${p.Zr ? ' / ' + p.Zr : p.Zc ? ' / ' + p.Zc + ' lâm.' : ''}`, `${p.reducao.estagios.map((s: any) => `${s.Zc}:${s.Zp}`).join(' × ')} = ${n(i, 2)}`, n(2 * pt.rw, 2), `${nMot} (${carrosM.length} de ${N} carros)`, n(kW), n(pt.massaTotal / 1000), n(kW / (pt.massaTotal / 1000), 1),
        n(p.rpmBase), n(canto), n(p.rpmMax), n(p.vMaxKmh ?? NaN), n(rpmV), n((p.p * rpmV) / 60), n((p.reducao.estagios[0]?.Zp * rpmV) / 60), n(vRpmMax * 3.6), n(vEq * 3.6), n(F0 / 1000), n(a0, 2)],
    };
  });
  tabela('eletrico', 'Elétrico: trens, metrôs e bonde', ['máquina', 'polos / ranhuras / barras', 'redução', 'roda (m)', 'motores', 'kW', 't', 'kW/t', 'rpmBase', 'canto P/T (rpm)', 'rpmMax', 'vMax (km/h)', 'motor rpm na vMax', 'f elétrica (Hz)', 'engrenamento (Hz)', 'km/h em rpmMax', 'km/h de equilíbrio', 'partida (kN)', 'a₀ (m/s²)'], trens,
    'Motores = truques dos carros motores × `motoresPorTruque` (2 truques por carro, ou os de `config.truques`), como em `TracaoTrem`. Partida = motores·Tn·redução·η/raio; a₀ = (partida − A)/(1,06·massa); equilíbrio em nível contra Davis A + B·v + C·v².');
  // ---- bancada e drone
  const banc: Linha[] = E.filter((p) => p.portador.tipo === 'bancada' || p.portador.tipo === 'drone').map((p: any) => {
    const al: Alerta[] = [], i = reducao(p);
    const { polos, canto } = maquina(p, al);
    const h = p.helice, ponta = h ? (Math.PI * h.D * p.rpmMax) / 60 : NaN;
    if (h && ponta / C_SOM > MACH_HELICE_MAX) al.push({ texto: `ponta da hélice a Mach ${n(ponta / C_SOM, 2)} em rpmMax`, forca: 1 + (10 * (ponta / C_SOM - MACH_HELICE_MAX)) / MACH_HELICE_MAX });
    const sinc = p.fRede != null ? (60 * p.fRede) / p.p : NaN;
    if (p.fRede != null && (p.rpmBase > sinc || p.rpmMax > sinc * 1.001)) al.push({ texto: `na rede de ${p.fRede} Hz a rotação síncrona é ${n(sinc)} rpm; rpmBase ${p.rpmBase} / rpmMax ${p.rpmMax}`, forca: 4 });
    if (p.rpmBase > p.rpmMax) al.push({ texto: `rpmBase ${p.rpmBase} acima de rpmMax ${p.rpmMax}`, forca: 6 });
    return {
      id: p.id, nome: p.name, alertas: al,
      v: [p.maquina, `${polos} / ${p.Zs}${p.Zc ? ' / ' + p.Zc + ' lâm.' : p.Zr ? ' / ' + p.Zr : ''}`, n(p.Pmax), n(p.Tn, 2), n(p.rpmBase), n(canto), n(p.rpmMax), n((p.p * p.rpmMax) / 60), i === 1 ? 'direta' : `${n(i, 2)} → ${n(p.rpmMax / i)} rpm`,
        h ? `${h.rotores} × ${h.B} pás, Ø ${n(h.D, 2)} m` : '—', h ? `${n((h.B * p.rpmBase) / 60)} / ${n((h.B * p.rpmMax) / 60)}` : '—', h ? `${n(ponta)} m/s (Mach ${n(ponta / C_SOM, 2)})` : '—', Number.isFinite(sinc) ? n(sinc) : '—'],
    };
  });
  tabela('eletrico', 'Elétrico: ferramentas, industrial e drone', ['máquina', 'polos / ranhuras / lâminas', 'W', 'Tn (N·m)', 'rpmBase', 'canto P/T (rpm)', 'rpmMax', 'f elétrica em rpmMax (Hz)', 'redução → saída', 'hélice', 'passagem de pá em rpmBase / rpmMax (Hz)', 'ponta em rpmMax', 'síncrona (rpm)'], banc,
    'Nas máquinas de curva linear (furadeira, liquidificador) e na ligada à rede, `rpmBase` não é o canto da curva e a comparação não se aplica.');
}

if (quer('turbina')) {
  const T = PRESETS_TURBINA;
  const jatos: Linha[] = T.map((p) => {
    const al: Alerta[] = [], Mt = (Math.PI * p.fanD * p.n1Max) / 60 / C0;
    if (p.arch !== 'turboprop') fora(al, 'Mach na ponta do fan em N1 100%', Mt, MACH_FAN, 2);
    else fora(al, `gerador de gás: ponta do compressor a ${n((Math.PI * p.fanD * p.n1Max) / 60)} m/s, Mach`, Mt, MACH_GERADOR_GAS, 2);
    if (p.arch === 'geared' && !(p.gear > 1)) al.push({ texto: `arquitetura com redutor e gear = ${p.gear}`, forca: 4 });
    if (p.n2Max < p.n1Max) al.push({ texto: `N2 máx. (${p.n2Max}) abaixo de N1 máx. (${p.n1Max})`, forca: 4 });
    if (p.n1Idle >= 1 || p.n2Idle >= 1 || p.n1Idle <= 0 || p.n2Idle <= 0) al.push({ texto: `lenta fora de 0–1 (N1 ${p.n1Idle}, N2 ${p.n2Idle})`, forca: 6 });
    return {
      id: p.id, nome: p.name, alertas: al,
      v: [p.arch, `${p.engines} × ${n(p.thrust)} kN`, n(p.bpr, 1), n(p.fanD, 2), p.fanB, n(p.n1Max), n((Math.PI * p.fanD * p.n1Max) / 60), n(Mt, 2), n((p.fanB * p.n1Max) / 60), p.arch === 'geared' ? n(p.gear, 2) : '—',
        n(p.n2Max), n((p.hpcB * p.n2Max) / 60), n(p.jetV), n(p.jetV / C0, 2), `${n(100 * p.n1Idle)}/${n(100 * p.n2Idle)}`],
    };
  });
  tabela('turbina', 'Turbina: fan, compressor e jato', ['arquitetura', 'motores × empuxo', 'bypass', 'fan Ø (m)', 'pás', 'N1 100% (rpm)', 'ponta (m/s)', 'Mach da ponta', 'passagem de pá do fan (Hz)', 'redutor', 'N2 100% (rpm)', 'passagem do compressor (Hz)', 'jato (m/s)', 'jato/c', 'lenta N1/N2 (%)'], jatos,
    'Mach da ponta = π·D·N1/60/340 (a parte tangencial do `Mt` de `JetDSP.sources()`; `n1Max` é a rotação do fan, também nos motores com redutor). Nos turboélices, "fan" descreve o compressor do gerador de gás (faixa própria).');
  const helices: Linha[] = T.filter((p) => p.arch === 'turboprop').map((p) => {
    const al: Alerta[] = [], D = p.propD ?? 2.5, rpm = p.propRpm ?? 0, B = p.propB ?? 4;
    if (p.propD == null) padrao(al, 'propD ausente → 2,5 m'); if (p.propB == null) padrao(al, 'propB ausente → 4 pás'); if (!p.propRpm) al.push({ texto: 'propRpm ausente: a hélice não gira', forca: 8 });
    const vCr = CRUZEIRO_KMH[p.id] ?? 450, ponta = (Math.PI * D * rpm) / 60, M0 = ponta / C0, M1 = Math.hypot(ponta, vCr / 3.6) / C0;
    if (!(p.id in CRUZEIRO_KMH)) padrao(al, 'sem velocidade de cruzeiro na tabela da ferramenta → 450 km/h');
    if (M0 > MACH_HELICE_MAX) al.push({ texto: `ponta da pá a Mach ${n(M0, 2)} parado (acima de ${n(MACH_HELICE_MAX, 2)})`, forca: 1 + (10 * (M0 - MACH_HELICE_MAX)) / MACH_HELICE_MAX });
    else if (M1 > MACH_HELICE_MAX) al.push({ texto: `ponta da pá a Mach ${n(M1, 2)} no cruzeiro de ${n(vCr)} km/h (acima de ${n(MACH_HELICE_MAX, 2)})`, forca: 1 + (10 * (M1 - MACH_HELICE_MAX)) / MACH_HELICE_MAX });
    return { id: p.id, nome: p.name, alertas: al, v: [n(rpm), n(D, 2), B, n((B * rpm) / 60, 1), n(ponta), n(M0, 2), n(vCr), n(M1, 2)] };
  });
  tabela('turbina', 'Turbina: hélices dos turboélices', ['rpm hélice', 'D (m)', 'pás', 'passagem de pá (Hz)', 'ponta (m/s)', 'Mach parado', 'cruzeiro (km/h)', 'Mach no cruzeiro'], helices,
    'Mach = hipotenusa(π·D·rpm/60, v)/340, como o `Mh` do `JetDSP`; cruzeiro típico da aeronave (tabela da ferramenta).');
}

// =================================================================================================================
// Resumo
// =================================================================================================================
{
  const NOME: Record<Familia, string> = { ronco: 'Ronco', diesel: 'Diesel', radial: 'Radial', rotativo: 'Rotativos', vapor: 'Vapor', eletrico: 'Elétrico', turbina: 'Turbina' };
  console.log(MD ? '\n### Resumo\n' : '\n== Resumo ==');
  if (MD) console.log('| família | presets | com alerta de faixa | só com nota (padrão, relações repetidas) | alertas e notas |\n|---|---|---|---|---|');
  for (const f of FAMILIAS) {
    if (!quer(f)) continue;
    const ids = new Map<string, Alerta[]>();
    for (const l of todas) if (l.familia === f) ids.set(l.id, [...(ids.get(l.id) ?? []), ...l.alertas]);
    let faixa = 0, soPadrao = 0, total = 0;
    for (const al of ids.values()) { total += al.length; if (al.some((a) => a.forca >= 1)) faixa++; else if (al.length) soPadrao++; }
    console.log(MD ? `| ${NOME[f]} | ${ids.size} | ${faixa} | ${soPadrao} | ${total} |` : `${NOME[f].padEnd(10)} ${String(ids.size).padStart(3)} presets · ${String(faixa).padStart(2)} com alerta de faixa · ${String(soPadrao).padStart(2)} só com nota (padrão, relações repetidas) · ${total} alertas e notas`);
  }
  const fortes = todas.flatMap((l) => l.alertas.filter((a) => a.forca >= 1).map((a) => ({ ...a, onde: `${NOME[l.familia]} · ${l.id} (${l.nome})` }))).sort((a, b) => b.forca - a.forca);
  const N_FORTES = MD ? fortes.length : 25;
  console.log(MD ? `\n### Alertas, do mais forte ao mais fraco (${fortes.length})\n` : `\n== Alertas mais fortes (${Math.min(N_FORTES, fortes.length)} de ${fortes.length}) ==`);
  if (MD) console.log('| força | preset | o que foge |\n|---|---|---|');
  for (const a of fortes.slice(0, N_FORTES)) console.log(MD ? `| ${n(a.forca, 1)} | ${a.onde} | ${a.texto.replace(/\|/g, '/')} |` : `${n(a.forca, 1).padStart(5)}  ${a.onde}: ${a.texto}`);
  if (!fortes.length) console.log(MD ? '| — | — | nenhum |' : 'nenhum');
  console.log(MD ? '\nForça = 1 + 10 × o quanto o valor passou da faixa (20% fora → 3); 8 para erro de estrutura (lista de marchas ignorada, marchas fora de ordem); 0,5 para campo ausente que o código preenche com padrão (não entra nesta lista).'
    : '\n(força = 1 + 10 × o quanto passou da faixa; 8 = erro de estrutura; campos ausentes preenchidos com padrão ficam só nas tabelas)');
}
process.exit(0);
