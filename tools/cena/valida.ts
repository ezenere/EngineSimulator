// Validação offline da Cena e dos portadores: roda as medidas, compara com os números-alvo do CENA.md e sai com
// código ≠ 0 se alguma falhar.
//
// Desvios (tools/desvios.ts, AUDITORIA A1 e T-CEN-04): uma medida fora do alvo só passa se estiver no retrato
// `tools/cena-desvios.json` (chave = nome exato) e ficar na folga do valor gravado lá (±1 dB nas medidas em dB, ±5 % nas
// outras); o porquê de cada uma está no retrato. Sementes (A2, T-CEN-03 e T-CEN-08): nos grupos que têm ruído sorteado
// (as passagens do trem, os portadores, os motores adaptados, o propagador com fonte de ruído) cada grupo roda com as
// sementes base, base+1 e base+2 e cada medida fica com o caso mediano das três (o valor mediano; num vetor, o caso da
// pior componente mediana). A CPU e a alocação no laço saíram para `npm run cpu:cena` (tools/cena/cpu.ts; A8, T-CEN-05).
//
//   npx tsx tools/cena/valida.ts [grupo…] [--j 8] [--semente N] [--atualizar[=nome exato]] [--json arquivo]
//   grupos: propagador sombra vento ambientes ouvinte trem niveis portadores legado motores niveis-motores (padrão: todos,
//           em paralelo, um processo por grupo)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Linha } from './medidas';
import { lerOpcoes, iniciarSementes, porSementesAsync, indiceMediano, fmtSementes, avaliarDesvios, sementeBase, type Medida } from '../desvios';

const AQUI = fileURLToPath(import.meta.url);
const RETRATO = path.resolve(path.dirname(AQUI), '..', 'cena-desvios.json');

type Grupo = () => Linha[] | Promise<Linha[]>;
const GRUPOS: Record<string, () => Promise<Grupo>> = {
  propagador: async () => (await import('./medidas')).medirPropagador,
  sombra: async () => (await import('./medidas')).medirSombra,
  vento: async () => (await import('./medidas')).medirVento,
  ambientes: async () => (await import('./medidas')).medirAmbientes,
  ouvinte: async () => (await import('./medidas')).medirOuvinte,
  trem: async () => (await import('./medidas')).medirTrem,
  niveis: async () => (await import('./medidas')).medirNiveisTrem,
  portadores: async () => (await import('./portadores')).medirPortadores,
  legado: async () => (await import('./legado')).compararLegado,
  motores: async () => (await import('./motores')).medirMotores,
  'niveis-motores': async () => (await import('./motores')).medirNiveisMotores,
};
/** grupos com ruído sorteado: rodam com 3 sementes (a sombra usa tons; o ambiente, a resposta ao impulso de semente fixa
 *  da página; o legado é o DSP antigo, determinístico) */
const COM_SEMENTES = new Set(['propagador', 'vento', 'ouvinte', 'trem', 'niveis', 'portadores', 'motores', 'niveis-motores']);

const escalar = (l: Linha) => l.ordem ?? (Array.isArray(l.valor) ? Math.max(...l.valor.map(Math.abs)) : l.valor ?? NaN);

/** o caso mediano das 3 sementes, medida a medida (as listas têm as mesmas medidas, na mesma ordem) */
function casoMediano(listas: Linha[][]): Linha[] {
  const n = listas[0].length;
  for (const ls of listas) if (ls.length !== n || ls.some((l, i) => l.nome !== listas[0][i].nome)) throw new Error('as sementes deram medidas diferentes');
  return listas[0].map((_, i) => {
    const cs = listas.map((ls) => ls[i]), v = cs.map(escalar);
    const txt = fmtSementes(v, 2);
    if (v.every((x) => x === v[0]) || new Set(txt.split(' · ')).size === 1) return cs[indiceMediano(v)];
    const m = cs[indiceMediano(v)];
    return { ...m, medido: `${m.medido} [sementes ${txt}]` };
  });
}

async function rodarGrupo(g: string): Promise<Linha[]> {
  const f = await GRUPOS[g]();
  if (!COM_SEMENTES.has(g)) return await f();
  const M = await import('./medidas');
  const ls = await porSementesAsync(async () => { M.limparCache(); return await f(); });
  M.limparCache();
  return casoMediano(ls);
}

const args = process.argv.slice(2);
if (args[0] === '--grupo') {
  iniciarSementes();
  rodarGrupo(args[1]).then((l) => process.stdout.write(JSON.stringify(l)))
    .catch((e) => process.stdout.write(JSON.stringify([{ passo: '—', nome: 'execução do grupo', alvo: 'sem erro', medido: String(e?.stack || e).slice(0, 400), ok: false }])));
} else {
  const op = lerOpcoes(args);
  let jsonOut: string | null = null;
  const resto: string[] = [];
  for (let i = 0; i < op.resto.length; i++) { if (op.resto[i] === '--json') jsonOut = op.resto[++i]; else resto.push(op.resto[i]); }
  iniciarSementes(op.semente);
  for (const g of resto) if (!GRUPOS[g]) { console.error(`grupo desconhecido: ${g} (${Object.keys(GRUPOS).join(', ')}; a CPU saiu para npm run cpu:cena)`); process.exit(2); }
  const fila = resto.length ? resto : Object.keys(GRUPOS);
  const J = op.j ?? Math.max(2, Math.floor(os.cpus().length * 0.5));
  const res: Record<string, Linha[]> = {};
  const t0 = Date.now();
  const rodar = (g: string) => new Promise<void>((ok) => {
    const p = spawn(process.execPath, ['--import', 'tsx', AQUI, '--grupo', g], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = ''; p.stdout.on('data', (b) => { out += b; });
    p.on('close', () => { try { res[g] = JSON.parse(out); } catch { res[g] = [{ passo: '—', nome: 'execução do grupo', alvo: 'sem erro', medido: out.slice(-300), ok: false }]; } console.error(`  (${g}: ${((Date.now() - t0) / 1000).toFixed(0)} s)`); ok(); });
  });
  (async () => {
    // (os grupos mais longos primeiro)
    const longos = ['niveis-motores', 'motores', 'trem', 'niveis', 'ambientes', 'legado'];
    const q = [...fila].sort((a, b) => (longos.includes(a) ? longos.indexOf(a) : 99) - (longos.includes(b) ? longos.indexOf(b) : 99));
    await Promise.all(Array.from({ length: Math.min(J, q.length) }, async () => { while (q.length) await rodar(q.shift()!); }));
    const linhas: (Medida & { passo: string })[] = fila.flatMap((g) => (res[g] || []).map((l) => ({ ...l, grupo: g })));
    const r = avaliarDesvios(RETRATO, linhas, { atualizar: op.atualizar, grupos: fila });
    // (como o imprimirAvaliacao, com o passo do CENA.md ao lado do grupo)
    for (const l of r.linhas) {
      const tag = l.estado === 'ok' ? 'ok   ' : l.estado === 'desv' ? 'desv ' : 'FALHA';
      console.log(`${tag} [${l.grupo} · ${l.passo}] ${l.nome}: alvo ${l.alvo} · medido ${l.medido}`);
      if (l.estado !== 'ok' && l.nota) console.log(`        ${l.nota}`);
      if (l.estado === 'desv' && l.motivo) console.log(`        desvio: ${l.motivo}`);
    }
    if (r.avisos.length) { console.log('\navisos:'); for (const a of r.avisos) console.log(`  - ${a}`); }
    if (r.gravado) console.log(`\nretrato regravado: ${r.arquivo}`);
    if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(r.linhas, null, 1));
    const c = r.contagem;
    console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    console.log(`\n${c.ok + c.desv + c.falha} medidas: ${c.ok} ok, ${c.desv} desvios com teto, ${c.falha} falhas (semente ${sementeBase()})`);
    process.exitCode = c.falha ? 1 : 0;
  })();
}
