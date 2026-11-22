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
// Modo legado do Ronco (rodada de som de 18/11/2026: "Médios" e "Jato da ponteira", docs/TECNICO.md → Ronco).
//
// O motor-base ganhou mecanismos que MUDAM o som dos carros de propósito: a irradiação da carcaça do escape
// (`carcaca`), a batida periódica da mecânica (`batida`), o jato da ponteira que satura no escoamento sônico (`jato`)
// e a bomba de ar secundário de linha larga ou ausente (`bombaAr`). Os padrões do produto (ACESSORIOS_PADRAO e os
// presets em src/engines/ronco/presets.ts) saem com eles ligados. Cada um tem um VALOR LEGADO com que o EngineDSP toca
// exatamente como antes; a prova de paridade (tools/ronco-paridade.ts) força esses valores no lado migrado antes de
// renderizar, aqui na ferramenta e não nos padrões do produto, e por isso continua sendo amostra a amostra. Assim:
//   · a paridade prova que, com os mecanismos novos na posição legada, o DSP migrado É o legado;
//   · ela NÃO prova nada sobre o som novo (quem julga é o ouvido do dono; as medidas estão em tools/ronco-medios.py,
//     tools/ronco-jato.py e na régua do kit ouvido);
//   · um campo novo que mude o som e não esteja nesta tabela faz a paridade FALHAR: nenhum outro desvio é aceito.
// Valor legado = o campo ausente (`undefined`): é como os presets das outras famílias (Diesel, Radial, Rotativos e a
// aviação a pistão) chegam ao EngineDSP, e por isso o som delas não mudou (tools/ronco-heranca.ts confere por hash).
// No painel do Ronco a posição legada de cada controle é: Carcaça e Batida no mínimo ("sem · legado"), Jato da
// ponteira em "Legado" e Bomba de ar secundário em "Tom parado (legado)".
export const MODO_LEGADO_RONCO: Record<string, undefined> = { carcaca: undefined, batida: undefined, jato: undefined, bombaAr: undefined };

/** a posição legada de cada controle novo no painel do Ronco (src/pages/ronco/Painel.tsx): tem de soar igual ao campo ausente */
export const POSICAO_LEGADA_PAINEL: Record<string, unknown> = { carcaca: -30, batida: -30, jato: 'legado', bombaAr: 'tom' };

/** o preset sem os campos dos mecanismos novos (para a comparação campo a campo com o legado, que não os tem) */
export function semCamposNovos<T extends Record<string, unknown>>(p: T): T {
  const r: Record<string, unknown> = {};
  for (const k of Object.keys(p)) if (!(k in MODO_LEGADO_RONCO)) r[k] = p[k];
  return r as T;
}

/** módulo de presets do lado migrado com os campos novos forçados ao valor legado (texto TypeScript; o render o carrega por PRESETS=) */
export function presetsEmModoLegado(caminhoPresets: string): string {
  const campos = Object.entries(MODO_LEGADO_RONCO).map(([k, v]) => `${k}: ${v === undefined ? 'undefined' : JSON.stringify(v)}`).join(', ');
  return `import { PRESETS } from ${JSON.stringify(caminhoPresets)};\nexport default PRESETS.map((p) => ({ ...p, ${campos} }));\n`;
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
