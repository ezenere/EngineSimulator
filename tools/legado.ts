// O código legado (src/dsp.js, src/geometry.js, src/presets.js, src/jet-dsp.js, src/jet-presets.js) saiu da árvore
// de trabalho no fim da reestruturação. Ele continua sendo a referência das provas de paridade, lido do histórico do
// git num commit FIXO: se a referência fosse o nome `master`, ela sumiria no dia em que a reestruturação fosse mesclada
// (o `master` novo já não tem esses arquivos).
//
// Usado por tools/ronco-paridade.ts, tools/turbina-paridade.ts, tools/acoustics-paridade.ts e tools/cena/legado.ts.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** último commit de `master` com o código legado: "F1: atrito turbulento na onda de volta dos primários" */
export const REF_LEGADO = '02c185f';

/** texto de um arquivo legado no commit de referência (`git show <ref>:<arquivo>`) */
export function lerLegado(arquivo: string, ref = REF_LEGADO): string {
  try {
    return execFileSync('git', ['show', `${ref}:${arquivo}`], { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    throw new Error(`não consegui ler ${arquivo} do commit ${ref} (git show ${ref}:${arquivo}). O histórico do repositório está completo? ` +
      `Num clone raso, rode "git fetch --unshallow".\n${(e as { stderr?: string }).stderr ?? e}`);
  }
}

/** grava os arquivos legados numa pasta (com o nome do arquivo, sem o caminho) e devolve os caminhos */
export function extrairLegado(arquivos: readonly string[], pasta: string, ref = REF_LEGADO): string[] {
  fs.mkdirSync(pasta, { recursive: true });
  return arquivos.map((a) => { const dest = path.join(pasta, path.basename(a)); fs.writeFileSync(dest, lerLegado(a, ref)); return dest; });
}

// ---------------------------------------------------------------------------------------------------------------
// Correções de ficha feitas depois da migração (docs/AUDITORIA.md).
//
// A paridade prova que o DSP migrado é o legado: mesmo preset → mesmo WAV, amostra a amostra. Os presets também
// tinham de ser iguais campo a campo, o que congelava os erros de ficha do legado (um nome errado, as relações de
// câmbio de outro carro). Em vez de afrouxar a comparação, cada correção fica declarada aqui, campo a campo: a
// paridade aplica esta tabela aos presets legados antes de comparar e de renderizar. Assim:
//   · um preset que mude sem estar aqui continua sendo FALHA (ninguém altera uma ficha sem declarar);
//   · o som continua provado idêntico, com a mesma ficha dos dois lados.
// Regras: só valores de campos que já existem no preset legado (a ordem das chaves é conferida); um campo novo tem
// de entrar no fim do objeto também em presets.ts. Quem acrescenta uma linha aqui escreve o motivo e a fonte no
// AUDITORIA.md (ou num comentário ao lado).
export type Correcoes = Record<string, Record<string, unknown>>;

/** Ronco: id do preset → campos corrigidos (valor novo) */
export const CORRECOES_RONCO: Correcoes = {};

/** Turbina: id do preset → campos corrigidos (valor novo) */
export const CORRECOES_TURBINA: Correcoes = {};

/** O arquivo de presets legado (CommonJS, `module.exports = PRESETS`) com as correções aplicadas no fim. */
export function comCorrecoes(fontePresets: string, correcoes: Correcoes): string {
  if (!Object.keys(correcoes).length) return fontePresets;
  return `${fontePresets}\n;(function (C) { for (const p of module.exports) { const c = C[p.id]; if (c) for (const k of Object.keys(c)) p[k] = c[k]; } })(${JSON.stringify(correcoes)});\n`;
}

/** confere que toda correção aponta para um preset que existe; devolve quantos campos foram corrigidos */
export function contarCorrecoes(presets: readonly { id: string }[], correcoes: Correcoes): number {
  let n = 0;
  for (const [id, c] of Object.entries(correcoes)) {
    if (!presets.some((p) => p.id === id)) throw new Error(`correção de ficha para um preset que não existe: ${id}`);
    n += Object.keys(c).length;
  }
  return n;
}
