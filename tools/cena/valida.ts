// Validação offline da Cena e do portador trem: roda as medidas, compara com os números-alvo do
// CENA.md e sai com código ≠ 0 se algum alvo falhar sem desvio documentado.
//
//   npx tsx tools/cena/valida.ts [grupo…] [--json arquivo]
//   grupos: propagador sombra vento ambientes ouvinte trem niveis cpu portadores legado (padrão: todos)
import fs from 'node:fs';
import * as M from './medidas';
import type { Linha } from './medidas';

type Grupo = () => Linha[] | Promise<Linha[]>;
const GRUPOS: Record<string, () => Promise<Grupo>> = {
  propagador: async () => M.medirPropagador,
  sombra: async () => M.medirSombra,
  vento: async () => M.medirVento,
  ambientes: async () => M.medirAmbientes,
  ouvinte: async () => M.medirOuvinte,
  trem: async () => M.medirTrem,
  niveis: async () => M.medirNiveisTrem,
  cpu: async () => M.medirCpu,
  portadores: async () => (await import('./portadores')).medirPortadores,
  legado: async () => (await import('./legado')).compararLegado,
};

async function main() {
  const args = process.argv.slice(2);
  const ji = args.indexOf('--json');
  const jsonOut = ji >= 0 ? args[ji + 1] : null;
  const pedidos = args.filter((a, i) => !a.startsWith('--') && (ji < 0 || i !== ji + 1));
  const nomes = pedidos.length ? pedidos : Object.keys(GRUPOS);
  const todas: Linha[] = [];
  for (const g of nomes) {
    if (!GRUPOS[g]) { console.error(`grupo desconhecido: ${g} (${Object.keys(GRUPOS).join(', ')})`); process.exit(2); }
    const t0 = Date.now();
    const ls = await (await GRUPOS[g]())();
    for (const l of ls) {
      const st = l.ok ? 'ok   ' : l.desvio ? 'desv ' : 'FALHA';
      console.log(`${st} [${l.passo}] ${l.nome}: alvo ${l.alvo} · medido ${l.medido}`);
      if (!l.ok && l.desvio) console.log(`        desvio: ${l.desvio}`);
    }
    console.log(`  (${g}: ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    todas.push(...ls);
  }
  const falhas = todas.filter((l) => !l.ok && !l.desvio), desvios = todas.filter((l) => !l.ok && l.desvio);
  console.log(`\n${todas.length} medidas: ${todas.filter((l) => l.ok).length} ok, ${desvios.length} desvios documentados, ${falhas.length} falhas`);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(todas, null, 1));
  process.exit(falhas.length ? 1 : 0);
}
main();
