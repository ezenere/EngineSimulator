// Teste offline dos presets da página Passagem: monta cada um pelo MESMO caminho da página e do worklet e mede.
//
//   npx tsx tools/passagem-presets.ts [ids separados por vírgula] [--combinacoes] [--sem-sequencia] [--j N]
//                                     [--md arquivo.md] [--json arquivo.json] [--camera]
//
// Ouvinte. A página põe você no ponto de chegada do preset como observador em primeira pessoa (o modo 'livre' da
// Cena: o ouvido 5 cm abaixo do olho, a cabeça para onde a câmera olha, que é o veículo chegando). Este teste mede com o
// ouvinte FIXO de antes (`ControlePassagem.ouvinteFixo`): parado ao lado da via na lateral do preset, a 1,6 m, de frente
// para ela; é a régua dos números de sempre, que não mudam com a tela nova (tools/cena/ouvinte-movel.ts prova que o
// livre no mesmo ponto, de frente para a via, dá o mesmo som amostra a amostra). `--camera` mede com o observador da
// página, como ele nasce: a cabeça virada para o veículo chegando muda a panorâmica, o ITD e o ILD, e na estação ele
// fica em cima da plataforma (o ouvido mais alto); com o lugar (src/scene/lugar.ts) o ambiente é o de onde ele está. Com
// `--camera` o mesmo preset é medido também com o ouvinte fixo: a coluna do L_AFmax mostra os dois, e a câmera mais de
// 3 dB abaixo do fixo vira alerta (era o defeito da plataforma e da passarela até 23/11/2026).
//
// Como monta. A classe `ControlePassagem` de src/pages/passagem/controle.ts (a que a página usa) é carregada aqui
// no Node, com uma cadeia de áudio de mentira cujo `send()` entrega cada mensagem (clonada, como o postMessage faz)
// a um `CenaDSP` de src/scene/dsp-cena.ts, o DSP que o worklet `cena` registra. Quem escreve as mensagens
// `portador`, `cena`, `comando`, `params` e `ar` é, portanto, o código da página: `carregarPreset(p)` e depois
// `disparar()`, como quem abre a página, clica no preset e aperta o botão. A telemetria volta para o controle (que
// para o corpo quando a cauda vai longe). O relógio `performance.now()` é trocado pelo tempo do áudio, para o teste
// não depender da velocidade da máquina. O laço é o do worklet: blocos de 128 amostras a 48 kHz, 4 canais.
//
// O que mede, por preset (a passagem inteira: do nariz a x0 antes do ouvinte até a cauda x0 depois; 12 a 60 s):
//   · monta sem exceção, com as mesmas fontes que a página sondou na thread principal;
//   · NaN/Infinity nos 4 canais;
//   · nível no ouvido: L_AFmax e L_Aeq (janela de 10 dB abaixo do máximo), ponderados A, da pressão de verdade
//     (direto + reverberação do ambiente feita aqui por convolução, com os ganhos que a página põe no ConvolverNode);
//   · o medidor "direto" da página (telemetria `splDbA`, sem o ambiente) contra essa medida: a diferença é quanto a
//     reverberação soma (esperado no túnel e na estação; a céu aberto não devia passar de 2 dB);
//   · saturação: a Passagem é escala ABSOLUTA (src/scene/constantes.ts: 0 dBFS ≙ 124 dB SPL, isto é, amostra 1,0 =
//     31,7 Pa de pico). O worklet escreve tanh(pressão × master), com master = 0,8 (padrão da página). Aqui o DSP roda
//     com `cru = true` (sem tanh nem master) para medir a pressão; a saturação é calculada com a mesma fórmula:
//     pico de |pressão × 0,8| em dBFS e a fração de amostras com |pressão × 0,8| > 1,0 (o tanh já comprime 24%) e > 0,7;
//   · audível: L_AFmax pelo menos 6 dB acima do som de fundo do ambiente (vento, ventilação, murmúrio), medido à parte;
//     um preset que "toca" só o fundo é silêncio;
//   · CPU por bloco em % do quantum de 2,67 ms: a média pelo tempo de CPU do processo (não sobe com a máquina
//     ocupada), o p99 pelo relógio (sobe: use --j 1 numa máquina parada); e o tempo que `carregarPreset` trava a
//     thread principal (as sondas de calibração do motor rodam nela).
//
// Sequência (sem --sem-sequencia): um controle e um DSP só, como uma sessão de uso: carrega e dispara todos os
// presets em fila (2 s cada, a saída de verdade, com tanh), depois troca de preset no meio da passagem e três
// trocas seguidas sem tocar. Confere exceção, NaN e saída fora de ±1.
//
// --combinacoes: além dos presets, monta TODAS as combinações portador × família × preset de motor que a página
// habilita (motoresProntos/presetsDoMotor), com os padrões do portador (`setPortador`, `setMotor`, `setMotorPreset`):
// 8 s parado (o motor assenta) e 5 s de passagem com o nariz no ouvinte aos 2 s. Monta, toca, NaN, nível, e a rotação
// do motor no instante da passagem contra o corte do preset (o padrão do portador pode não servir ao motor escolhido).
//
// Código de saída ≠ 0: preset que não monta, NaN, silêncio (inaudível), ou preset fora da tabela de compatibilidade.
// Nível fora da faixa esperada, saturação, CPU alta e reverberação alta a céu aberto são ALERTAS (listados, não falham).
//
// Faixas esperadas de L_AFmax, dB(A), no ouvinte do preset. São ordens de grandeza (a largura da faixa já diz isso),
// tiradas dos limites de homologação e de medidas publicadas, corrigidas para a distância do preset com 6 dB por
// dobro (fonte pontual) ou 3 a 4,5 dB (trem: fonte em linha). Onde o projeto já tem alvo próprio, vale o do projeto.
//
// | Preset | Faixa | De onde vem |
// |---|---|---|
// | trembala-tunel | 110–122 | CENA.md 2.10/2.11: céu aberto a 3 m e 350 km/h L_Aeq,tp 108 / L_AFmax 113; túnel +7 ± 2 |
// | trembala-ceu | 97–106 | CENA.md: L_Aeq,tp 100 ± 3 a 7,5 m e 300 km/h (ETI Ruído 1304/2014: 95 dB(A) a 7,5 m e 250 km/h; +30·log v) |
// | trembala-ponte | 100–112 | o de cima a 5 m e 320 km/h (+2 a +3) mais o ronco do viaduto |
// | convencional-estacao | 86–100 | ETI: unidade elétrica 80 dB(A) a 7,5 m e 80 km/h; 120 km/h +5; a 2 m +4 a +6; plataforma coberta +3 |
// | regional-corte | 90–102 | ETI: 80 dB(A) a 7,5 m e 80 km/h; 160 km/h +9; a 4 m +2 a +3; taludes +2 |
// | heli-rasante | 80–92 | R44 II: 81 dB(A) SEL no sobrevoo a 150 m (FAR 36 ap. J) → L_Amax ≈ 74–77 a 150 m; a 40 m, +11,5 |
// | carro-rua | 82–96 | V8 esportivo de escape aberto em carga total: 85–90 dB(A) a 6 m (TECNICO → Adaptadores de motor; ISO 362 limita o de rua a 72–75 a 7,5 m) |
// | picape-diesel | 70–84 | ISO 362 / UNECE R51: 72–76 dB(A) a 7,5 m em aceleração; a 5 m, +3,5; a 80 km/h o pneu dá 74–78 a 7,5 m |
// | corsair-rasante | 100–118 | motor radial de 2 000 hp em potência máxima: L_W ≈ 148–155 dB → 107–114 a 30 m |
// | yak52-passagem | 76–92 | 360 hp, hélice de 2,4 m: L_W ≈ 132–140 → 79–87 a 120 m |
// | p47-passagem | 92–108 | como o Corsair, a 80 m (−8,5 dB) e manete 0,9 |
// | sherman | 86–102 | motor de 400 hp com abafador a 8 m: 88–95; com as lagartas (que o portador não tem) um M4 passa de 100 |
// | rx7-rua | 80–96 | como carro-rua (13B turbo de rua, escape esportivo) |
// | 787b-hunaudieres | 106–124 | protótipo de Le Mans sem abafador: 120–130 dB(A) a 1 m da ponteira → 108–118 a 15 m; o R26B é dos mais altos |
// | shadow-passagem | 56–74 | VANT de 38 hp com hélice impulsora a 150 m (audível a quilômetros): 60–70 |
// | cessna-passagem | 72–88 | Cessna 172S: 75 dB(A) na decolagem de homologação (FAR 36 ap. G, ≈ 200 m de altura); a 100 m, +6; manete 0,8 |
// | aviao-rasante | 82–92 | tools/cena/motores.ts: ATR 72 em decolagem a 100 m, alvo 85 ± 3 (84 EPNdB na lateral a 450 m) |
// | locomotiva-patio | 88–100 | EUA, 40 CFR 201.12: 90 dB(A) a 30 m em movimento (87 parada, qualquer notch); a 15 m, +6 |
// | gerador-bancada | 85–102 | grupo aberto de 500 kVA: 100–105 dB(A) a 1 m (catálogos); a 7,5 m de uma máquina de 4 m, −10 a −14 |
// | jato-1500 | 62–78 | 737-800 a 1 500 m: 65–75 dB(A) L_Amax (curvas NPD de decolagem; na aproximação, o de baixo) |
// | pacific-100 | 88–102 | locomotiva a vapor trabalhando a 15 m: 90–100 (VAPOR.md) |
// | bigboy-arrancando | 92–108 | arrancada com corte de 75% e torneiras abertas, a 10 m |
// | maria-estacao | 84–100 | 15 km/h a 4 m, com sino, sob cobertura |
// | caca-supersonico | 115–145 | F-16 em pós-combustão a 200 m: 115–125; o estrondo (Δp de ~2 kPa) leva o L_AFmax acima disso |
// | tesla-rua | 54–68 | carro elétrico a 30 km/h: 58–62 dB(A) a 7,5 m (pneu); a 5 m, +3; AVAS R138: ≥ 50/56 dB(A) a 2 m (10/20 km/h) |
// | taurus-doremi | 72–90 | ETI: ruído de partida de locomotiva elétrica ≤ 82–85 dB(A) a 7,5 m; a 6 m, sob cobertura, +3 a +5 |
// | metro-estacao | 74–94 | chegada de metrô medida na plataforma: 80–95 dB(A); a 35 km/h, freando, o de baixo |
// | n700-tunel | 90–104 | trembala-tunel a 150 km/h: −11 (rolamento, 30·log v) |
// | drone-pairando | 46–62 | Mavic Pro: ≈ 70 dB(A) a 1 m no pairado → 50 a 10 m; mais o chão |
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CenaDSP } from '../src/scene/dsp-cena';
import { PA_FS } from '../src/scene/constantes';
import { gerarRespostaPorBanda } from '../src/scene/ambientes';
import { FundoAmbiente } from '../src/scene/fundo';
import type { Ambiente } from '../src/scene/tipos';
import { convoluir, nivelF, leq, percentil } from './cena/analise';
import {
  PRESETS_PASSAGEM, PORTADORES, MOTOR_PADRAO, motoresProntos, presetsDoMotor, situacaoPortador,
  type PresetPassagem, type IdPortadorPagina,
} from '../src/pages/passagem/presets';
import type { FamiliaMotor } from '../src/carriers/tipos';
import { PRESETS as PRESETS_RONCO, PRESETS_AVIACAO } from '../src/engines/ronco/presets';
import { PRESETS as PRESETS_DIESEL } from '../src/engines/diesel/presets';
import { PRESETS_RADIAL } from '../src/engines/radial/presets';
import { PRESETS_ROTATIVO } from '../src/engines/rotativo/presets';
import { PRESETS_VAPOR } from '../src/engines/vapor/presets';
import { PRESETS_ELETRICO } from '../src/engines/eletrico/presets';
import { COMPAT, USO_REAL, ADAPTADORES } from '../src/carriers/compat';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FS = 48000, B = 128, MASTER = 0.8;
const QUANTUM_US = (B / FS) * 1e6;

/** faixa esperada de L_AFmax, dB(A) (a tabela do cabeçalho) */
const FAIXAS: Record<string, readonly [number, number]> = {
  'trembala-tunel': [110, 122], 'trembala-ceu': [97, 106], 'trembala-ponte': [100, 112], 'convencional-estacao': [86, 100],
  'regional-corte': [90, 102], 'heli-rasante': [80, 92], 'carro-rua': [82, 96], 'picape-diesel': [70, 84],
  'corsair-rasante': [100, 118], 'yak52-passagem': [76, 92], 'p47-passagem': [92, 108], sherman: [86, 102], 'rx7-rua': [80, 96],
  '787b-hunaudieres': [106, 124], 'shadow-passagem': [56, 74], 'cessna-passagem': [72, 88], 'aviao-rasante': [82, 92],
  'locomotiva-patio': [88, 100], 'gerador-bancada': [85, 102], 'jato-1500': [62, 78], 'pacific-100': [88, 102],
  'bigboy-arrancando': [92, 108], 'maria-estacao': [84, 100], 'caca-supersonico': [115, 145], 'tesla-rua': [54, 68],
  'taurus-doremi': [72, 90], 'metro-estacao': [74, 94], 'n700-tunel': [90, 104], 'drone-pairando': [46, 62],
};

// ------------------------------------------------------------------ argumentos
const argv = process.argv.slice(2);
const opcao = (nome: string) => { const i = argv.indexOf(nome); return i >= 0 ? argv[i + 1] : undefined; };
const tem = (nome: string) => argv.includes(nome);
const COM_VALOR = ['--j', '--md', '--json', '--filho', '--saida'];
const idsArg = argv.filter((a, i) => !a.startsWith('--') && !COM_VALOR.includes(argv[i - 1]))[0];
const COMBOS = tem('--combinacoes');
/** mede com o observador da página (ponto de chegada) em vez do ouvinte fixo de antes */
const CAMERA = tem('--camera');
const J = Math.max(1, +(opcao('--j') ?? Math.min(8, Math.max(1, Math.floor(os.cpus().length / 2)))));

// ------------------------------------------------------------------ trabalhos
type Trabalho = { tipo: 'preset'; id: string } | { tipo: 'combo'; portador: IdPortadorPagina; familia: FamiliaMotor; motorPreset: string | null };

function listarTrabalhos(): Trabalho[] {
  const t: Trabalho[] = [];
  const ids = idsArg ? idsArg.split(',') : null;
  for (const p of PRESETS_PASSAGEM) if (!ids || ids.includes(p.id)) t.push({ tipo: 'preset', id: p.id });
  if (ids && !t.length) { console.error(`nenhum preset da Passagem com id ${idsArg}`); process.exit(2); }
  if (COMBOS) {
    // agrupadas por portador e família: dentro de um filho o controle é reaproveitado (o cache de calibração também)
    for (const port of PORTADORES) for (const f of motoresProntos(port.id)) {
      const ps = presetsDoMotor(port.id, f);
      if (f === 'nenhum') t.push({ tipo: 'combo', portador: port.id, familia: f, motorPreset: null });
      for (const m of ps) t.push({ tipo: 'combo', portador: port.id, familia: f, motorPreset: m.id });
    }
  }
  return t;
}

// ------------------------------------------------------------------ resultado
interface Resultado {
  chave: string; tipo: 'preset' | 'combo'; portador: string; familia: string; motorPreset: string | null;
  erro: string | null;
  dur: number; nFontes: number; fontesPagina: number; montagemMs: number;
  naoFinitos: number;
  lafmax: number; tMax: number; laeq: number; t10: number; medidorPagina: number; ambienteSoma: number;
  /** (--camera) L_AFmax do mesmo preset com o ouvinte fixo de antes, ao lado da via a 1,6 m */
  lafmaxFixo: number;
  picoPa: number; picoDbfs: number; fracAcima1: number; fracAcima07: number;
  fundo: number;
  cpuMedia: number; cpuP99: number;
  /** telemetria do portador com o nariz na frente do ouvinte (ou no meio do trecho, parado) */
  tele: { v: number; rpm: number | null; marcha: number | null; estado: string | null; machPonta: number | null; nrRel: number | null };
  corte: number | null;
  faixa: readonly [number, number] | null;
  falhas: string[]; alertas: string[];
}

// relógio do controle: tempo do áudio, não o da máquina
const relogio = { ms: 0 };
Object.defineProperty(globalThis, 'performance', { value: { now: () => relogio.ms }, configurable: true, writable: true });

/** corte de giro do preset de motor (carros, caminhões, tanque, motos), quando a ficha tem */
function corteDoMotor(familia: string, id: string | null): number | null {
  if (!id) return null;
  const L: readonly any[] = familia === 'pistao' ? [...PRESETS_RONCO, ...PRESETS_AVIACAO] : familia === 'diesel' ? PRESETS_DIESEL
    : familia === 'radial' ? PRESETS_RADIAL : familia === 'rotativo' ? PRESETS_ROTATIVO : [];
  const p = L.find((x) => x.id === id);
  return p ? (p.redline ?? p.rpmMax ?? null) : null;
}

/** velocidade máxima do veículo na ficha do motor, km/h (vapor: `vMax`; elétrico: `vMaxKmh`) */
function vmaxDoMotor(familia: string, id: string | null): number | null {
  if (!id) return null;
  if (familia === 'vapor') { const p = PRESETS_VAPOR.find((x) => x.id === id); return p && p.familia !== 'estacionaria' ? p.vMax ?? null : null; }
  if (familia === 'eletrico') return (PRESETS_ELETRICO.find((x) => x.id === id) as { vMaxKmh?: number } | undefined)?.vMaxKmh ?? null;
  return null;
}

// som de fundo do ambiente sozinho, em dB(A) (o mesmo gerador que a Cena soma)
const cacheFundo = new Map<string, number>();
function nivelDoFundo(amb: Ambiente): number {
  const chave = JSON.stringify(amb.fundo);
  let v = cacheFundo.get(chave);
  if (v === undefined) {
    const f = new FundoAmbiente(FS); f.definir(amb.fundo);
    const n = 4 * FS, L = new Float32Array(n), R = new Float32Array(n), bl = new Float64Array(B), br = new Float64Array(B);
    for (let i = 0; i < n; i += B) { bl.fill(0); br.fill(0); f.somar(bl, br, B); L.set(bl, i); R.set(br, i); }
    v = leq(L, R, FS, 1, FS, n);   // (o fundo já sai em Pa)
    cacheFundo.set(chave, v);
  }
  return v;
}

// ------------------------------------------------------------------ sessão: controle da página + DSP do worklet
interface Sessao { c: any; dsp: CenaDSP; amb: Ambiente | null; splMax: number; ultimaTele: any }
let ControlePassagem: any = null;
async function novaSessao(cru: boolean): Promise<Sessao> {
  // (import com caminho calculado: o controle usa tipos do DOM no teclado, que o tsconfig das ferramentas não tem)
  if (!ControlePassagem) ControlePassagem = (await import(path.join(AQUI, '..', 'src', 'pages', 'passagem', 'controle.ts'))).ControlePassagem;
  relogio.ms = 0;
  const s: Sessao = { c: new ControlePassagem(), dsp: new CenaDSP(FS), amb: null, splMax: -Infinity, ultimaTele: null };
  s.dsp.cru = cru;
  // (o ouvinte fixo de antes, a régua de sempre; com --camera, o observador da página no ponto de chegada)
  s.c.ouvinteFixo = !CAMERA;
  s.dsp.post = (m: any) => {
    const copia = structuredClone(m);
    s.ultimaTele = copia;
    if (Number.isFinite(copia?.cena?.splDbA)) s.splMax = Math.max(s.splMax, copia.cena.splDbA);
    s.c.onTelemetria(copia);
  };
  const audio = {
    ctx: { sampleRate: FS },
    send: (m: any) => s.dsp.message(structuredClone(m)),          // postMessage clona: uma função no cfg estouraria aqui
    aplicarRespostaPorBanda: (amb: Ambiente) => { s.amb = amb; },
    retomar: async () => {},
  };
  s.c.iniciar = async () => audio;
  return s;
}

/** toca `dur` segundos em blocos de 128; devolve os 4 canais, o tempo de cada bloco e a telemetria na passagem */
function tocar(s: Sessao, dur: number, pararCedo: boolean) {
  const n = Math.ceil((dur * FS) / B) * B;
  const dL = new Float32Array(n), dR = new Float32Array(n), eL = new Float32Array(n), eR = new Float32Array(n);
  const bl = new Float32Array(B), br = new Float32Array(B), el = new Float32Array(B), er = new Float32Array(B);
  const cpu = new Float64Array(n / B);
  let naoFinitos = 0, feitos = 0, teleNaPassagem: any = null, cpuProcesso = 0;
  const t0ms = relogio.ms;
  const parado = !(s.c.vKmh > 7) || s.c.partida;
  for (let i = 0; i < n; i += B) {
    relogio.ms = t0ms + (i / FS) * 1000;
    const u0 = process.cpuUsage(), t0 = process.hrtime.bigint();
    s.dsp.process(bl, br, B, el, er);
    cpu[i / B] = Number(process.hrtime.bigint() - t0) / 1000;
    const u = process.cpuUsage(u0); cpuProcesso += u.user + u.system;
    for (let k = 0; k < B; k++) if (!Number.isFinite(bl[k]) || !Number.isFinite(br[k]) || !Number.isFinite(el[k]) || !Number.isFinite(er[k])) naoFinitos++;
    dL.set(bl, i); dR.set(br, i); eL.set(el, i); eR.set(er, i);
    feitos = i + B;
    if (!teleNaPassagem && s.dsp.portador) {
      const xi = s.c.xiNariz(s.dsp.portador.cinematica.s);
      if (parado ? i / FS >= dur / 2 : xi >= 0) teleNaPassagem = s.dsp.portador.telemetria();
    }
    if (pararCedo && !s.c.andando && i / FS > 12) break;
  }
  relogio.ms = t0ms + (feitos / FS) * 1000;
  return { dL: dL.subarray(0, feitos), dR: dR.subarray(0, feitos), eL: eL.subarray(0, feitos), eR: eR.subarray(0, feitos), cpu: cpu.subarray(0, feitos / B), cpuProcesso, naoFinitos, tele: teleNaPassagem ?? s.dsp.portador?.telemetria() };
}

function medir(r: Resultado, s: Sessao, som: ReturnType<typeof tocar>) {
  const { dL, dR, eL, eR } = som, n = dL.length;
  r.dur = n / FS; r.naoFinitos = som.naoFinitos;
  // média: tempo de CPU do processo (user + system) gasto em process(); o p99 é de relógio e sobe com a máquina ocupada
  r.cpuMedia = (100 * som.cpuProcesso) / som.cpu.length / QUANTUM_US;
  r.cpuP99 = (100 * percentil(Array.from(som.cpu), 99)) / QUANTUM_US;
  const t = som.tele as any;
  // helicóptero: rotação do rotor em relação à nominal (o governador tem de segurar Nr = 100%)
  const nrNominal = (s.dsp.portador as unknown as { cfg?: { Nr?: number } } | null)?.cfg?.Nr;
  if (t) r.tele = { v: t.v, rpm: typeof t.rpm === 'number' ? t.rpm : typeof t.rpmEixo === 'number' ? t.rpmEixo : null, marcha: typeof t.marcha === 'number' ? t.marcha : null, estado: typeof t.estado === 'string' ? t.estado : null, machPonta: typeof t.machPonta === 'number' ? t.machPonta : null,
    nrRel: typeof t.Nr === 'number' && nrNominal ? t.Nr / nrNominal : null };
  if (som.naoFinitos) { r.falhas.push(`${som.naoFinitos} amostras NaN/Infinity`); return; }
  // saturação do direto: o worklet escreve tanh(pressão × master)
  let pico = 0, a1 = 0, a07 = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(dL[i]), b = Math.abs(dR[i]);
    if (a > pico) pico = a; if (b > pico) pico = b;
    if (a * MASTER > 1) a1++; if (b * MASTER > 1) a1++;
    if (a * MASTER > 0.7) a07++; if (b * MASTER > 0.7) a07++;
  }
  r.picoPa = pico * PA_FS; r.picoDbfs = 20 * Math.log10(pico * MASTER + 1e-30);
  r.fracAcima1 = a1 / (2 * n); r.fracAcima07 = a07 / (2 * n);
  // ouvido: seco + reverberação do ambiente (ConvolverNode da página: normalize = false, ganho √wet)
  let L = dL, R = dR;
  const amb = s.amb;
  if (amb && amb.reverb.wet > 0) {
    const ir = gerarRespostaPorBanda(amb, FS), w = Math.sqrt(amb.reverb.wet), seco = amb.reverb.dry ?? 1;
    const cl = convoluir(eL, ir.L), cr = convoluir(eR, ir.R);
    L = new Float32Array(n); R = new Float32Array(n);
    for (let i = 0; i < n; i++) { L[i] = seco * dL[i] + w * cl[i]; R[i] = seco * dR[i] + w * cr[i]; }
  }
  const serie = nivelF(L, R, FS, PA_FS, true, 480);
  let iMax = 0; for (let i = 1; i < serie.length; i++) if (serie[i] > serie[iMax]) iMax = i;
  r.lafmax = serie[iMax]; r.tMax = iMax * 0.01;
  let a = iMax, b = iMax;
  while (a > 0 && serie[a - 1] >= r.lafmax - 10) a--;
  while (b < serie.length - 1 && serie[b + 1] >= r.lafmax - 10) b++;
  const ini = a * 480, fim = Math.min(n, (b + 1) * 480);
  r.t10 = (fim - ini) / FS;
  r.laeq = leq(L, R, FS, PA_FS, ini, fim);
  r.medidorPagina = s.splMax;
  r.fundo = amb ? nivelDoFundo(amb) : -Infinity;

  if (pico < 1e-4) r.falhas.push(`silêncio: pico ${r.picoDbfs.toFixed(0)} dBFS`);
  else if (r.lafmax < r.fundo + 6) r.falhas.push(`inaudível: L_AFmax ${r.lafmax.toFixed(1)} dB(A) a menos de 6 dB do fundo do ambiente (${r.fundo.toFixed(1)})`);
  if (r.faixa && (r.lafmax < r.faixa[0] || r.lafmax > r.faixa[1])) r.alertas.push(`nível ${r.lafmax < r.faixa[0] ? 'abaixo' : 'acima'} da faixa (${(r.lafmax < r.faixa[0] ? r.lafmax - r.faixa[0] : r.lafmax - r.faixa[1]).toFixed(1)} dB)`);
  if (r.tipo === 'preset' && !r.faixa) r.alertas.push('sem faixa esperada (acrescente em FAIXAS)');
  if (r.fracAcima1 > 0.001) r.alertas.push(`satura: ${(100 * r.fracAcima1).toFixed(2)}% das amostras acima de 1,0`);
  else if (r.fracAcima07 > 0.01) r.alertas.push(`perto do teto: ${(100 * r.fracAcima07).toFixed(1)}% acima de 0,7`);
  // o medidor "direto" da página (telemetria splDbA) não tem o ambiente: a diferença é o que a reverberação soma.
  // No túnel e na estação é o esperado (+7 e +3 dB); a céu aberto, na ponte e no corte ela não devia passar de 2 dB
  r.ambienteSoma = Number.isFinite(r.medidorPagina) ? r.lafmax - r.medidorPagina : NaN;
  if (amb && amb.id !== 'tunel' && amb.id !== 'estacao' && r.ambienteSoma > 2) r.alertas.push(`a reverberação de "${amb.id}" soma ${r.ambienteSoma.toFixed(1)} dB ao som direto`);
  if (r.ambienteSoma < -1.5) r.alertas.push(`medidor direto da página ${(-r.ambienteSoma).toFixed(1)} dB ACIMA da medida com o ambiente`);
  if (r.cpuMedia > 50) r.alertas.push(`CPU média ${r.cpuMedia.toFixed(0)}% do quantum`);
  if (r.tele.estado && r.tele.estado !== 'funcionando') r.alertas.push(`motor "${r.tele.estado}" na passagem`);
  const vmax = vmaxDoMotor(r.familia, r.motorPreset);
  if (vmax && !s.c.partida && s.c.vKmh > vmax * 1.02 && s.c.portador !== 'gerador') r.alertas.push(`passa a ${Math.round(s.c.vKmh)} km/h, acima da velocidade máxima da ficha (${vmax} km/h)`);
  if (r.tele.nrRel != null && r.familia !== 'nenhum' && r.tele.nrRel < 0.95) r.alertas.push(`rotor a ${(100 * r.tele.nrRel).toFixed(0)}% da rotação nominal na passagem (o motor não segura o rotor)`);
  if (r.corte && r.tele.rpm && r.tele.rpm > r.corte * 1.03) r.alertas.push(`motor a ${Math.round(r.tele.rpm)} rpm, acima do corte de ${r.corte}`);
  if (r.fontesPagina !== r.nFontes) r.falhas.push(`a página sondou ${r.fontesPagina} fontes e o DSP montou ${r.nFontes}`);
}

const vazio = (chave: string, tipo: 'preset' | 'combo', portador: string, familia: string, motorPreset: string | null): Resultado => ({
  chave, tipo, portador, familia, motorPreset, erro: null, dur: 0, nFontes: 0, fontesPagina: 0, montagemMs: 0, naoFinitos: 0,
  lafmax: NaN, tMax: NaN, laeq: NaN, t10: NaN, medidorPagina: NaN, ambienteSoma: NaN, lafmaxFixo: NaN, picoPa: NaN, picoDbfs: NaN, fracAcima1: NaN, fracAcima07: NaN, fundo: NaN,
  cpuMedia: NaN, cpuP99: NaN, tele: { v: NaN, rpm: null, marcha: null, estado: null, machPonta: null, nrRel: null }, corte: null, faixa: null, falhas: [], alertas: [],
});

/** tempo de CPU do processo desde `u0`, em ms (o que a thread principal da página fica travada; não sobe com a máquina ocupada) */
const cpuMs = (u0: NodeJS.CpuUsage) => { const u = process.cpuUsage(u0); return (u.user + u.system) / 1000; };

// ------------------------------------------------------------------ um preset da Passagem
async function rodarPreset(p: PresetPassagem): Promise<Resultado> {
  const r = vazio(p.id, 'preset', p.portador, p.motor, p.motorPreset ?? null);
  r.faixa = FAIXAS[p.id] ?? null;
  r.corte = corteDoMotor(p.motor, p.motorPreset ?? MOTOR_PADRAO[p.motor]?.[p.portador] ?? null);
  // tabela de compatibilidade: o preset tem de ser uma combinação que a página oferece
  if (!situacaoPortador(p.portador).ok) r.falhas.push(`portador ${p.portador} desabilitado: ${situacaoPortador(p.portador).motivo}`);
  if (!motoresProntos(p.portador).includes(p.motor)) r.falhas.push(`família ${p.motor} não habilitada no portador ${p.portador} (compat.ts)`);
  if (p.motor !== 'nenhum' && p.motorPreset && !presetsDoMotor(p.portador, p.motor).some((x) => x.id === p.motorPreset)) r.falhas.push(`motor ${p.motorPreset} não é oferecido em ${p.portador} × ${p.motor}`);
  try {
    const s = await novaSessao(true);
    const u0 = process.cpuUsage();
    s.c.carregarPreset(p);
    r.montagemMs = cpuMs(u0);
    if (s.c.presetId !== p.id) throw new Error('carregarPreset não carregou (portador desabilitado)');
    await s.c.disparar();
    if (!s.dsp.portador) throw new Error('o DSP não montou portador');
    r.nFontes = s.dsp.canais.length; r.fontesPagina = s.c.fontes.length;
    const v = p.vKmh / 3.6, L = s.c.corpo.comprimento;
    const dur = p.partida ? 20 : v < 0.5 ? 12 : Math.min(60, Math.max(12, (2 * s.c.x0 + L) / v));
    medir(r, s, tocar(s, dur, true));
    // (--camera) o mesmo preset com o ouvinte fixo de antes: o observador no ponto de chegada não pode ficar muito abaixo
    // dele. Até 23/11/2026, na plataforma e na passarela do túnel o campo reverberante caía com o ouvido mais alto
    // (o envio levava a sombra do corpo vista dali: src/scene/lugar.ts) e a câmera ficava 2,8 a 3,9 dB abaixo; o que
    // sobra é o direto dos truques, que o corpo esconde de quem está 0,75 a 0,9 m mais alto
    if (CAMERA && !r.falhas.length) {
      const f = await novaSessao(true);
      f.c.ouvinteFixo = true;
      f.c.carregarPreset(p); await f.c.disparar();
      const rf = vazio(p.id, 'preset', p.portador, p.motor, p.motorPreset ?? null);
      medir(rf, f, tocar(f, dur, true));
      r.lafmaxFixo = rf.lafmax;
      if (r.lafmax < rf.lafmax - 3) r.alertas.push(`a câmera no ponto de chegada fica ${(rf.lafmax - r.lafmax).toFixed(1)} dB abaixo do ouvinte fixo`);
    }
  } catch (e) {
    r.erro = String((e as Error)?.stack ?? e).split('\n').slice(0, 3).join(' | ');
    r.falhas.push(`exceção: ${String((e as Error)?.message ?? e)}`);
  }
  return r;
}

// ------------------------------------------------------------------ uma combinação portador × família × motor
let sessaoCombos: Sessao | null = null;
async function rodarCombo(t: Extract<Trabalho, { tipo: 'combo' }>): Promise<Resultado> {
  const r = vazio(`${t.portador}×${t.familia}×${t.motorPreset ?? '—'}`, 'combo', t.portador, t.familia, t.motorPreset);
  r.corte = corteDoMotor(t.familia, t.motorPreset);
  try {
    // uma sessão para todas as combinações do processo, como alguém escolhendo opções na página; refeita depois de uma falha
    const s = sessaoCombos ?? (sessaoCombos = await novaSessao(true));
    const c = s.c;
    s.splMax = -Infinity;
    if (c.andando) c.parar();
    const u0 = process.cpuUsage();
    c.setPortador(t.portador);
    c.setMotor(t.familia);
    if (t.motorPreset) c.setMotorPreset(t.motorPreset);
    r.montagemMs = cpuMs(u0);
    if (c.portador !== t.portador || c.motor !== t.familia || (t.motorPreset && c.motorPreset !== t.motorPreset)) throw new Error(`a página não aceitou a combinação (ficou ${c.portador} × ${c.motor} × ${c.motorPreset})`);
    if (!c.audio) await c.initAudio();
    if (!s.dsp.portador) throw new Error('o DSP não montou portador');
    r.nFontes = s.dsp.canais.length; r.fontesPagina = c.fontes.length;
    // 8 s parado antes de disparar, como quem escolhe o motor e só depois aperta o botão: a turbina sai da lenta, o
    // gerador e a locomotiva chegam à rotação, a caldeira e a calibração assentam (e o som do portador anterior some)
    const assento = tocar(s, 8, false);
    if (assento.naoFinitos) throw new Error(`${assento.naoFinitos} amostras NaN/Infinity com o portador parado`);
    s.splMax = -Infinity;
    // o nariz passa pelo ouvinte aos ~2 s (o x0 é um controle do painel)
    const v = c.vKmh / 3.6;
    c.x0 = Math.min(400, Math.max(5, 2 * v));
    await c.disparar();
    medir(r, s, tocar(s, 5, false));
  } catch (e) {
    r.erro = String((e as Error)?.stack ?? e).split('\n').slice(0, 3).join(' | ');
    r.falhas.push(`exceção: ${String((e as Error)?.message ?? e)}`);
  }
  if (r.falhas.length) sessaoCombos = null;
  return r;
}

// ------------------------------------------------------------------ sequência: uma sessão, todos os presets
async function sequencia(): Promise<string[]> {
  const falhas: string[] = [];
  const s = await novaSessao(false);   // a saída de verdade: tanh(pressão × master)
  const conferir = (rotulo: string, dur: number) => {
    try {
      const som = tocar(s, dur, false);
      let fora = 0, pico = 0;
      for (const x of [som.dL, som.dR]) for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > 1) fora++; if (a > pico) pico = a; }
      if (som.naoFinitos) falhas.push(`${rotulo}: ${som.naoFinitos} amostras NaN/Infinity`);
      if (fora) falhas.push(`${rotulo}: ${fora} amostras fora de ±1 depois do tanh`);
      if (pico < 1e-6) falhas.push(`${rotulo}: silêncio digital`);
    } catch (e) { falhas.push(`${rotulo}: exceção ${String((e as Error)?.message ?? e)}`); }
  };
  const carregar = async (p: PresetPassagem, disparar: boolean) => {
    try { s.c.carregarPreset(p); if (disparar) await s.c.disparar(); }
    catch (e) { falhas.push(`${p.id}: exceção ao carregar com o áudio ligado: ${String((e as Error)?.message ?? e)}`); }
  };
  // 1. em fila, parando entre um e outro
  for (const p of PRESETS_PASSAGEM) { if (s.c.andando) s.c.parar(); await carregar(p, true); conferir(`fila ${p.id}`, 2); }
  // 2. troca no meio da passagem (sem parar)
  for (const p of PRESETS_PASSAGEM) { await carregar(p, false); conferir(`troca andando → ${p.id}`, 0.5); }
  // 3. três trocas seguidas sem tocar entre elas
  for (let i = 0; i + 2 < PRESETS_PASSAGEM.length; i += 3) {
    for (let k = 0; k < 3; k++) await carregar(PRESETS_PASSAGEM[i + k], false);
    conferir(`3 trocas seguidas → ${PRESETS_PASSAGEM[i + 2].id}`, 0.3);
  }
  return falhas;
}

// ------------------------------------------------------------------ saída
const f1 = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '—');
function linhaMd(r: Resultado) {
  const veredito = r.falhas.length ? `**FALHA**: ${r.falhas.join('; ')}` : r.alertas.length ? `alerta: ${r.alertas.join('; ')}` : 'ok';
  const tele = [r.tele.rpm != null ? `${Math.round(r.tele.rpm)} rpm` : '', r.tele.marcha != null && r.portador === 'carro' ? `${r.tele.marcha}ª` : '', r.tele.machPonta != null ? `ponta M ${r.tele.machPonta.toFixed(2)}` : '', r.tele.nrRel != null ? `Nr ${(100 * r.tele.nrRel).toFixed(0)}%` : ''].filter(Boolean).join(', ');
  return `| ${r.chave} | ${f1(r.lafmax)}${CAMERA && Number.isFinite(r.lafmaxFixo) ? ` (fixo ${f1(r.lafmaxFixo)})` : ''} | ${f1(r.laeq)} | ${Number.isFinite(r.ambienteSoma) ? (r.ambienteSoma >= 0 ? '+' : '') + f1(r.ambienteSoma) : '—'} | ${f1(r.picoPa, r.picoPa > 100 ? 0 : 1)} Pa (${f1(r.picoDbfs)} dBFS) | ${f1(100 * r.fracAcima1, 2)} | ${f1(r.cpuMedia, 0)} / ${f1(r.cpuP99, 0)} | ${f1(r.montagemMs, 0)} | ${tele || '—'} | ${r.faixa ? `${r.faixa[0]}–${r.faixa[1]}` : '—'} | ${veredito} |`;
}
const CABECALHO = '| Preset | L_AFmax dB(A) | L_Aeq dB(A) | Ambiente soma (dB) | Pico (× master 0,8) | % > 1,0 | CPU média / p99 (% do quantum) | Montagem (ms) | Motor na passagem | Faixa esperada | Veredito |\n|---|---|---|---|---|---|---|---|---|---|---|';

// (o JSON não guarda NaN nem ±Infinity: vão como texto)
const paraJson = (_k: string, v: unknown) => (typeof v === 'number' && !Number.isFinite(v) ? `#${v}` : v);
const deJson = (_k: string, v: unknown) => (v === '#NaN' ? NaN : v === '#Infinity' ? Infinity : v === '#-Infinity' ? -Infinity : v);

async function comoFilho(parte: string, saida: string) {
  const [k, n] = parte.split('/').map(Number);
  const trabalhos = listarTrabalhos();
  const iCombo0 = trabalhos.findIndex((x) => x.tipo === 'combo'), nCombos = trabalhos.filter((x) => x.tipo === 'combo').length;
  const out: { i: number; r: Resultado }[] = [];
  for (let i = 0; i < trabalhos.length; i++) {
    const t = trabalhos[i];
    // os presets são repartidos um a um (i % n); as combinações, em fatias contíguas (a mesma sessão, o mesmo cache de calibração)
    const meu = t.tipo === 'preset' ? i % n === k : Math.floor(((i - iCombo0) * n) / nCombos) === k;
    if (!meu) continue;
    const r = t.tipo === 'preset' ? await rodarPreset(PRESETS_PASSAGEM.find((p) => p.id === t.id)!) : await rodarCombo(t);
    out.push({ i, r });
    process.stderr.write(`  ${r.chave}: ${r.falhas.length ? 'FALHA ' + r.falhas.join('; ') : `${f1(r.lafmax)} dB(A)${r.alertas.length ? ' · ' + r.alertas.join('; ') : ''}`}\n`);
  }
  fs.writeFileSync(saida, JSON.stringify(out, paraJson));
}

async function principal() {
  const trabalhos = listarTrabalhos();
  const t0 = Date.now();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'passagem-presets-'));
  const n = Math.min(J, trabalhos.length);
  const tsx = path.join(AQUI, '..', 'node_modules', '.bin', 'tsx');
  const repassar = argv.filter((a, i) => !['--j', '--md', '--json'].includes(a) && !['--j', '--md', '--json'].includes(argv[i - 1]));
  console.log(`Passagem: ${trabalhos.filter((t) => t.tipo === 'preset').length} presets${COMBOS ? ` e ${trabalhos.filter((t) => t.tipo === 'combo').length} combinações portador × motor` : ''}, ${n} processo(s) (o p99 de CPU é de relógio: para medi-lo, --j 1 numa máquina parada)`);
  const codigos = await Promise.all(Array.from({ length: n }, (_, k) => new Promise<number>((resolve) => {
    const p = spawn(tsx, [fileURLToPath(import.meta.url), ...repassar, '--filho', `${k}/${n}`, '--saida', path.join(tmp, `${k}.json`)], { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('close', (c) => resolve(c ?? 1));
  })));
  const res: Resultado[] = new Array(trabalhos.length);
  for (let k = 0; k < n; k++) {
    const arq = path.join(tmp, `${k}.json`);
    if (codigos[k] !== 0 || !fs.existsSync(arq)) { console.log(`FALHA: o processo ${k} terminou com código ${codigos[k]} (os trabalhos dele contam como falha)`); continue; }
    for (const { i, r } of JSON.parse(fs.readFileSync(arq, 'utf8'), deJson)) res[i] = r;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const feitos = res.filter(Boolean);

  const presets = feitos.filter((r) => r.tipo === 'preset'), combos = feitos.filter((r) => r.tipo === 'combo');
  let md = `Escala: amostra 1,0 = ${PA_FS.toFixed(1)} Pa de pico (0 dBFS ≙ 124 dB SPL); a saída do worklet é tanh(pressão × master), master ${MASTER}.\n\n${CABECALHO}\n${presets.map(linhaMd).join('\n')}\n`;
  if (combos.length) md += `\nCombinações portador × família × motor (padrões do portador; 8 s parado e 5 s de passagem, nariz no ouvinte aos 2 s):\n\n${CABECALHO.replace('| Preset |', '| Combinação |')}\n${combos.map(linhaMd).join('\n')}\n`;
  console.log('\n' + md);

  let falhasSeq: string[] = [];
  if (!tem('--sem-sequencia') && !idsArg) {
    falhasSeq = await sequencia();
    console.log(`sequência (uma sessão: ${PRESETS_PASSAGEM.length} presets em fila, troca no meio da passagem, 3 trocas seguidas): ${falhasSeq.length ? `${falhasSeq.length} falha(s)` : 'ok'}`);
    for (const f of falhasSeq) console.log(`  FALHA ${f}`);
  }
  // tabela de compatibilidade (src/carriers/compat.ts) contra os presets de motor e os padrões da página
  const padroes: string[] = [], avisosTabela: string[] = [];
  const tipos = Object.keys(COMPAT);
  for (const p of tipos as (keyof typeof COMPAT)[]) for (const f of USO_REAL[p]) {
    if (!COMPAT[p].includes(f)) padroes.push(`USO_REAL.${p} tem "${f}", que não está em COMPAT.${p}`);
    if (!ADAPTADORES.includes(f)) padroes.push(`USO_REAL.${p} tem "${f}", que não tem adaptador (ADAPTADORES)`);
  }
  const familias: [FamiliaMotor, readonly { id: string; portadores?: readonly string[] }[]][] = [
    ['pistao', PRESETS_AVIACAO as never], ['radial', PRESETS_RADIAL as never], ['rotativo', PRESETS_ROTATIVO as never], ['diesel', PRESETS_DIESEL as never],
    ['vapor', PRESETS_VAPOR as never], ['eletrico', PRESETS_ELETRICO.map((x) => ({ id: x.id, portadores: [x.portador.tipo === 'bancada' ? 'nenhum' : x.portador.tipo] }))],
  ];
  for (const [f, lista] of familias) for (const m of lista) for (const p of m.portadores ?? []) {
    if (!tipos.includes(p)) { avisosTabela.push(`${f} ${m.id}: portador "${p}" não é um TipoPortador`); continue; }
    if (!USO_REAL[p as keyof typeof USO_REAL].includes(f)) padroes.push(`${f} ${m.id} declara o portador "${p}", que USO_REAL não habilita para a família`);
    else if (p !== 'nenhum' && !presetsDoMotor(p as IdPortadorPagina, f).some((x) => x.id === m.id)) padroes.push(`${f} ${m.id} declara o portador "${p}", mas a página não o oferece ali (presetsDoMotor)`);
  }
  for (const port of PORTADORES) for (const f of motoresProntos(port.id)) if (f !== 'nenhum' && !presetsDoMotor(port.id, f).length) avisosTabela.push(`${port.id} × ${f}: habilitado sem nenhum preset de motor`);
  for (const a of avisosTabela) console.log(`aviso: ${a}`);
  // MOTOR_PADRAO tem de passar no filtro da página
  for (const [f, m] of Object.entries(MOTOR_PADRAO)) for (const [p, id] of Object.entries(m!)) {
    if (!motoresProntos(p as IdPortadorPagina).includes(f as FamiliaMotor)) padroes.push(`MOTOR_PADRAO.${f}.${p} = ${id}: família não habilitada nesse portador`);
    else if (!presetsDoMotor(p as IdPortadorPagina, f as FamiliaMotor).some((x) => x.id === id)) padroes.push(`MOTOR_PADRAO.${f}.${p} = ${id}: o preset não passa no filtro de presetsDoMotor`);
  }
  for (const f of padroes) console.log(`FALHA ${f}`);

  const nFalhas = feitos.filter((r) => r.falhas.length).length + falhasSeq.length + padroes.length + (trabalhos.length - feitos.length);
  const nAlertas = feitos.filter((r) => !r.falhas.length && r.alertas.length).length;
  const jsonArq = opcao('--json'), mdArq = opcao('--md');
  if (jsonArq) fs.writeFileSync(jsonArq, JSON.stringify(feitos, paraJson, 1));
  if (mdArq) fs.writeFileSync(mdArq, md);
  console.log(`\n${feitos.length} montagens em ${((Date.now() - t0) / 1000).toFixed(0)} s: ${feitos.length - feitos.filter((r) => r.falhas.length).length - nAlertas} ok, ${nAlertas} com alerta, ${nFalhas} falha(s)`);
  process.exit(nFalhas ? 1 : 0);
}

const filho = opcao('--filho');
(filho ? comoFilho(filho, opcao('--saida')!) : principal()).catch((e) => { console.error(e); process.exit(1); });
