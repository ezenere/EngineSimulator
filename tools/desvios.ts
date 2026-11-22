// Desvios com teto e sementes (docs/AUDITORIA.md, bloco A: A1 e A2). Utilitário comum das suítes `teste:*`.
//
// 1. Desvio com teto (A1). Uma medida fora do alvo só passa se estiver no retrato da família
//    (`tools/<família>-desvios.json`, chave = nome exato da medida) e o valor medido hoje ficar dentro da folga do valor
//    gravado lá: ±1 dB nas medidas em dB, ±5 % nas outras (a entrada pode trazer outra folga, com a razão no motivo).
//    Saiu da folga, para pior ou para melhor: FALHA, até o retrato ser regravado com `--atualizar` (o retrato é o valor
//    aceito de hoje; se uma melhora não fosse gravada, uma piora de volta passaria calada). Medida do retrato que
//    voltou a passar: aviso "desvio órfão". Entrada sem medida correspondente (nome mudou): aviso. Medida nova fora do
//    alvo: FALHA; `--atualizar` cria a entrada com o valor e o motivo vazio, e ela continua falhando até alguém
//    escrever o motivo no JSON.
// 2. Sementes (A2). `semear(obj)` troca o estado de todo `RNG` alcançável a partir de um DSP ou portador recém-montado
//    (depois da calibração, que fica com as sementes de fábrica, como na página): é a fase do ruído no instante em que
//    o usuário dá a partida. A semente de base vem de `--semente N` (padrão 0 = a de fábrica, nada muda);
//    `porSementes(f)` roda `f` com as sementes base, base+1 e base+2, e as medidas de contagem, de transiente e de
//    coeficiente de variação usam a mediana das três.
//
// Uso numa suíte (as outras famílias adotam do mesmo jeito):
//   import { lerOpcoes, iniciarSementes, semear, porSementes, mediana, avaliarDesvios, imprimirAvaliacao } from './desvios';
//   const op = lerOpcoes(process.argv.slice(2)); iniciarSementes(op.semente);
//   const d = semear(novoDSP(...));                               // todo DSP/portador montado para medir
//   const v = mediana(porSementes(() => medirEstouros(semear(novoDSP(...)))));
//   linhas.push({ grupo, nome, alvo, medido, ok, valor: v, unidade: '/s' });   // `valor`: número ou vetor
//   const r = avaliarDesvios('tools/radial-desvios.json', linhas, { atualizar: op.atualizar, grupos });
//   imprimirAvaliacao(r); process.exitCode = r.contagem.falha ? 1 : 0;
//
// CLI comum: `--semente N`, `--atualizar` (regrava o que saiu da folga, cria as entradas novas e tira as órfãs) ou
// `--atualizar=<nome exato>` (só essa medida, mesmo dentro da folga: a mudança que a ficha explica; repetível). Nomes
// exatos, sem expressão regular. Folga na entrada: "±1 dB", "±5 %", "±0.2" (absoluta) ou "±10 % (≥ 0.5)" (com piso).
import fs from 'node:fs';
import { RNG } from '../src/acoustics/rng';

// ================================================================================================ sementes
let base = 0, atual = 0;

/** semente de base da suíte (0 = a de fábrica); também vai para os processos filhos pelo ambiente */
export function iniciarSementes(n?: number) {
  const v = n ?? Number(process.env.SEMENTE || 0);
  base = atual = Number.isFinite(v) ? Math.trunc(v) : 0;
  process.env.SEMENTE = String(base);
  return base;
}
export const sementeBase = () => base;
export const sementeAtual = () => atual;

/** mistura de 32 bits (a semente 0 não muda nada) */
function misturar(s: number, k: number) {
  let h = Math.imul(k ^ 0x5bd1e995, 0x9e3779b1); h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13;
  return ((s ^ h) >>> 0) || 0x9e3779b9;
}
const semeados = new WeakSet<object>();

/** troca o estado de todos os RNG alcançáveis a partir de `obj` pela semente `k` (padrão: a atual); devolve `obj` */
export function semear<T>(obj: T, k = atual): T {
  if (!k) return obj;
  const vistos = new Set<unknown>();
  const visitar = (o: any) => {
    if (o === null || typeof o !== 'object' || vistos.has(o)) return;
    vistos.add(o);
    if (o instanceof RNG) { if (!semeados.has(o)) { o.s = misturar(o.s, k); semeados.add(o); } return; }
    if (ArrayBuffer.isView(o) || o instanceof ArrayBuffer) return;
    if (Array.isArray(o)) { for (const x of o) visitar(x); return; }
    if (o instanceof Map) { for (const x of o.values()) visitar(x); return; }
    if (o instanceof Set) { for (const x of o) visitar(x); return; }
    for (const c of Object.keys(o)) visitar(o[c]);
  };
  visitar(obj);
  return obj;
}

/** roda `f` com as sementes base, base+1, …, base+n−1 (a atual muda durante cada chamada) */
export function porSementes<T>(f: (k: number) => T, n = 3): T[] {
  const r: T[] = [], ant = atual;
  try { for (let i = 0; i < n; i++) { atual = base + i; r.push(f(atual)); } } finally { atual = ant; }
  return r;
}
export async function porSementesAsync<T>(f: (k: number) => Promise<T>, n = 3): Promise<T[]> {
  const r: T[] = [], ant = atual;
  try { for (let i = 0; i < n; i++) { atual = base + i; r.push(await f(atual)); } } finally { atual = ant; }
  return r;
}

/** mediana (NaN só se todos forem NaN) */
export function mediana(xs: number[]) {
  const v = xs.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : 0.5 * (v[m - 1] + v[m]);
}
/** índice do elemento mediano (para mostrar o caso mediano inteiro, não só um número) */
export function indiceMediano(xs: number[]) {
  const ord = xs.map((x, i) => [x, i] as const).filter(([x]) => !Number.isNaN(x)).sort((a, b) => a[0] - b[0]);
  return ord.length ? ord[(ord.length - 1) >> 1][1] : 0;
}
/** "3,2 (3,1 · 3,2 · 3,4)": a mediana e as sementes */
export const fmtSementes = (xs: number[], d = 1) => xs.map((x) => (Number.isFinite(x) ? x.toFixed(d) : String(x))).join(' · ');

// ================================================================================================ desvios
export type Medida = { grupo: string; nome: string; alvo: string; medido: string; ok: boolean; valor?: number | number[]; unidade?: string };
/** `beira`: a medida passa por menos de 5 % da tolerância e cai fora com outras sementes; passar ou falhar dentro da
 *  folga do retrato é aceito (sem aviso de órfão); fora da folga, falha como qualquer desvio */
export type Entrada = { grupo: string; medido: number | number[] | null; unidade?: string; folga?: string; alvo?: string; motivo: string; beira?: boolean };
export type Retrato = Record<string, Entrada>;
export type Estado = 'ok' | 'desv' | 'FALHA';
export type Avaliada<T extends Medida> = T & { estado: Estado; nota?: string; motivo?: string };
export type Opcoes = { semente: number; atualizar: boolean | string[]; resto: string[]; j?: number };

/** `--semente N`, `--atualizar[=nome]`, `--j N`; o resto (grupos) em `resto` */
export function lerOpcoes(args: string[]): Opcoes {
  let semente = Number(process.env.SEMENTE || 0), atualizar: boolean | string[] = false, j: number | undefined;
  const resto: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--semente') semente = Number(args[++i]);
    else if (a.startsWith('--semente=')) semente = Number(a.slice(10));
    else if (a === '--j') j = Number(args[++i]);
    else if (a === '--atualizar') atualizar = true;
    else if (a.startsWith('--atualizar=')) { const n = a.slice(12); if (atualizar !== true) atualizar = [...(atualizar || []), n]; }
    else resto.push(a);
  }
  return { semente, atualizar, resto, j };
}

const fmtV = (v: number | number[] | null | undefined) => (v == null ? '—' : Array.isArray(v) ? v.map((x) => fmtN(x)).join(' / ') : fmtN(v));
const fmtN = (x: number) => (Number.isFinite(x) ? (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2)) : String(x));
const arred = (x: number) => (Number.isFinite(x) ? +x.toPrecision(4) : null);

/** folga padrão: ±1 dB nas medidas em dB, ±5 % nas outras */
export const folgaPadrao = (unidade?: string) => (unidade === 'dB' ? '±1 dB' : '±5 %');

/** a folga como função de comparação: "±1 dB" absoluto em dB, "±5 %" relativo, "±0.2" absoluto na unidade da medida,
 *  "±10 % (≥ 0.3)" relativo com piso absoluto (contagens perto de zero) */
function lerFolga(f: string) {
  const m = /^±?\s*([\d.,]+)\s*(dB|%)?\s*(?:\(≥\s*([\d.,]+)\))?\s*$/.exec(f.trim());
  if (!m) throw new Error(`folga ilegível: "${f}"`);
  const v = Number(m[1].replace(',', '.')), piso = m[3] ? Number(m[3].replace(',', '.')) : 0;
  return m[2] === '%' ? (a: number, b: number) => Math.abs(a - b) <= Math.max((v / 100) * Math.abs(b), piso) + 1e-12 : (a: number, b: number) => Math.abs(a - b) <= v + 1e-12;
}
function dentroDaFolga(valor: number | number[], ret: number | number[] | null, folga: string) {
  if (ret == null) return false;
  const a = Array.isArray(valor) ? valor : [valor], b = Array.isArray(ret) ? ret : [ret];
  if (a.length !== b.length) return false;
  const cmp = lerFolga(folga);
  return a.every((x, i) => { const y = b[i] == null ? NaN : (b[i] as number); if (Number.isNaN(x) && Number.isNaN(y)) return true; if (!Number.isFinite(x) || !Number.isFinite(y)) return x === y; return cmp(x, y); });
}
const pedido = (at: boolean | string[], nome: string) => at === true || (Array.isArray(at) && at.includes(nome));

export function lerRetrato(arquivo: string): Retrato {
  if (!fs.existsSync(arquivo)) return {};
  return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
}

/**
 * Confere as medidas contra o retrato; com `atualizar`, regrava o que mudou (só as entradas pedidas, se for lista).
 * `grupos`: os grupos que rodaram (entradas de outros grupos não geram aviso).
 */
export function avaliarDesvios<T extends Medida>(arquivo: string, linhas: T[], op: { atualizar: boolean | string[]; grupos: string[] }) {
  const ret = lerRetrato(arquivo), avisos: string[] = [];
  let mudou = false;
  const out: Avaliada<T>[] = [];
  const vistos = new Set<string>();
  for (const l of linhas) {
    vistos.add(l.nome);
    const e = ret[l.nome], at = pedido(op.atualizar, l.nome);
    if (e && e.grupo !== l.grupo) { e.grupo = l.grupo; mudou = true; } // (a medida mudou de grupo: só o rótulo)
    if (l.ok) {
      out.push({ ...l, estado: 'ok' });
      if (e?.beira) {
        // medida à beira do alvo (passa por menos de 5 % da tolerância): passar é o esperado; longe do retrato, avisa
        if (l.valor !== undefined && !dentroDaFolga(l.valor, e.medido, e.folga || folgaPadrao(e.unidade ?? l.unidade))) {
          if (at) { e.medido = arredV(l.valor); mudou = true; } else avisos.push(`"${l.nome}" (à beira) mudou: retrato ${fmtV(e.medido)}, agora ${fmtV(l.valor)}; se saiu da beira, tire do retrato`);
        }
      } else if (e) {
        if (at) { delete ret[l.nome]; mudou = true; avisos.push(`desvio órfão retirado do retrato: "${l.nome}" (passa: ${l.medido})`); }
        else avisos.push(`desvio órfão: "${l.nome}" passa (${l.medido}); tire do retrato com --atualizar="${l.nome}"`);
      }
      continue;
    }
    if (!e) {
      if (at && l.valor !== undefined) {
        ret[l.nome] = { grupo: l.grupo, medido: arredV(l.valor), unidade: l.unidade, folga: folgaPadrao(l.unidade), alvo: l.alvo, motivo: '' };
        mudou = true;
        out.push({ ...l, estado: 'FALHA', nota: `desvio novo gravado em ${arquivo}: escreva o motivo` });
      } else out.push({ ...l, estado: 'FALHA', nota: l.valor === undefined ? 'fora do alvo (medida sem valor numérico)' : 'fora do alvo, fora do retrato' });
      continue;
    }
    const folga = e.folga || folgaPadrao(e.unidade ?? l.unidade);
    if (l.valor === undefined) { out.push({ ...l, estado: 'FALHA', nota: 'no retrato, mas a medida não tem valor numérico', motivo: e.motivo }); continue; }
    if (e.alvo !== undefined && e.alvo !== l.alvo) {
      if (at) { e.alvo = l.alvo; mudou = true; } else avisos.push(`alvo mudou em "${l.nome}": retrato "${e.alvo}", teste "${l.alvo}"`);
    }
    const dentro = dentroDaFolga(l.valor, e.medido, folga);
    if (!e.motivo?.trim()) {
      if (at && !dentro) { e.medido = arredV(l.valor); mudou = true; }
      out.push({ ...l, estado: 'FALHA', nota: `desvio sem motivo no retrato (${arquivo})` });
      continue;
    }
    // (com --atualizar=<este nome>, o valor é regravado mesmo dentro da folga: a mudança foi explicada por quem a pediu)
    const nomeado = Array.isArray(op.atualizar) && op.atualizar.includes(l.nome);
    if (dentro && !nomeado) { out.push({ ...l, estado: 'desv', nota: `retrato ${fmtV(e.medido)} ${folga}`, motivo: e.motivo }); continue; }
    if (at) {
      const antes = fmtV(e.medido);
      e.medido = arredV(l.valor); e.unidade = l.unidade ?? e.unidade; mudou = true;
      out.push({ ...l, estado: 'desv', nota: `retrato atualizado (era ${antes})`, motivo: e.motivo });
    } else out.push({ ...l, estado: 'FALHA', nota: `saiu da folga do retrato: era ${fmtV(e.medido)} ${folga}, agora ${fmtV(l.valor)} (se a mudança é a intenção: --atualizar="${l.nome}")`, motivo: e.motivo });
  }
  for (const [n, e] of Object.entries(ret)) {
    if (vistos.has(n) || !op.grupos.includes(e.grupo)) continue;
    if (op.atualizar === true) { delete ret[n]; mudou = true; avisos.push(`entrada sem medida retirada do retrato: "${n}"`); }
    else avisos.push(`entrada do retrato sem medida (o nome mudou?): "${n}"`);
  }
  if (mudou) fs.writeFileSync(arquivo, JSON.stringify(ret, null, 2) + '\n');
  // (MEDIDAS_JSON=arquivo: as medidas com o valor numérico, para comparar sementes de base fora da suíte)
  if (process.env.MEDIDAS_JSON) fs.writeFileSync(process.env.MEDIDAS_JSON, JSON.stringify(out.map((l) => ({ grupo: l.grupo, nome: l.nome, estado: l.estado, valor: l.valor ?? null, alvo: l.alvo })), null, 1));
  const contagem = { ok: out.filter((x) => x.estado === 'ok').length, desv: out.filter((x) => x.estado === 'desv').length, falha: out.filter((x) => x.estado === 'FALHA').length };
  return { linhas: out, avisos, contagem, gravado: mudou, arquivo };
}
function arredV(v: number | number[]) { return Array.isArray(v) ? v.map((x) => arred(x) as number) : (arred(v) as number); }

/** saída padrão: uma linha por medida (estado, grupo, nome, alvo, medido), a nota do retrato e os avisos */
export function imprimirAvaliacao(r: ReturnType<typeof avaliarDesvios>, op: { motivo?: boolean; cabecalhoGrupo?: boolean } = {}) {
  let gAnt = '';
  for (const l of r.linhas) {
    if (op.cabecalhoGrupo && l.grupo !== gAnt) { console.log(`\n## ${l.grupo}`); gAnt = l.grupo; }
    const tag = l.estado === 'ok' ? 'ok   ' : l.estado === 'desv' ? 'desv ' : 'FALHA';
    console.log(`${tag} [${l.grupo}] ${l.nome}: alvo ${l.alvo} · medido ${l.medido}`);
    if (l.estado !== 'ok' && l.nota) console.log(`        ${l.nota}`);
    if (op.motivo && l.estado === 'desv' && l.motivo) console.log(`        desvio: ${l.motivo}`);
  }
  if (r.avisos.length) { console.log('\navisos:'); for (const a of r.avisos) console.log(`  - ${a}`); }
  if (r.gravado) console.log(`\nretrato regravado: ${r.arquivo}`);
  const c = r.contagem;
  console.log(`\n${c.ok + c.desv + c.falha} medidas: ${c.ok} ok, ${c.desv} desvios com teto, ${c.falha} falhas (semente ${sementeBase()})`);
}
