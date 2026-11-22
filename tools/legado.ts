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
export const CORRECOES_RONCO: Correcoes = {
  // (docs/AUDITORIA.md, F-RON-01…15: nenhum destes campos muda o timbre; só o nome, o rótulo e como o carro anda)
  // potência (455 hp), relações e diferencial 3,73 são do Camaro SS de 6ª geração, que usa o LT1; o LS3 (426 hp) é o da 5ª,
  // com 3,01/2,07/1,43/1,00/0,84/0,57 e 3,45 (gmauthority.com, especificações do Camaro 2016; Wikipedia, Tremec TR-6060)
  muscle: { tag: '6.2 V8 LT1 · cross-plane' },
  // 10R80: a 4ª é 1,769 (Wikipedia, Ford–GM 10-speed automatic transmission)
  mustang: { ratios: [4.70, 2.99, 2.15, 1.77, 1.52, 1.28, 1.00, 0.85, 0.69, 0.64] },
  // Tremec TR-9070 DCT do GT500 2020: 3,14/2,05/1,43/1,10/0,86/0,68/0,56 (suplemento do manual da Ford, março de 2020)
  gt500: { ratios: [3.14, 2.05, 1.43, 1.10, 0.86, 0.68, 0.56] },
  // o Z06 C6 usa 2,66/1,78/1,30/1,00/0,74/0,50 com 3,42 (1ª até ~100 km/h); 2,97/2,07/1,43/1,00/0,71/0,57 é o pacote Z51
  // do Corvette comum (corvsport.com, especificações de 2008; Wikipedia, Tremec TR-6060)
  corvette: { ratios: [2.66, 1.78, 1.30, 1.00, 0.74, 0.50] },
  // o Century 1976 tinha o automático THM 350 de 3 marchas (2,52/1,52/1,00); 2,74/1,57/1,00/0,67 é o 200-4R, de 1981
  v6odd: { gears: 3, ratios: [2.52, 1.52, 1.00] },
  // 1525 kg é o peso seco da Lamborghini; com fluidos, 1770 kg (Wikipedia, Lamborghini Aventador)
  aventador: { mass: 1770 },
  // faltava a redução secundária do câmbio do S2000 (1,160): 4,100 × 1,160 = 4,756; 6ª a 100 km/h ≈ 3300 rpm (hondanews.com)
  i4: { finalDrive: 4.76 },
  // EK9: 3,230/2,105/1,458/1,107/0,848 com 4,400 (ficha da Honda de 08/1997); 1,034/0,787 são do Integra Type R 98, com 4,785
  ek9: { ratios: [3.23, 2.11, 1.46, 1.11, 0.85] },
  // Skyactiv-MT do ND: 5,087/2,991/2,035/1,594/1,286/1,000 com 2,866: a 6ª é direta (mazdausa.com, especificações de 2018)
  mx5: { ratios: [5.09, 2.99, 2.04, 1.59, 1.29, 1.00] },
  // SMG III: 3,985/2,652/1,806/1,392/1,159/1,000/0,833 com 3,62 (ficha de imprensa da BMW, press.bmwgroup.com)
  m5e60: { ratios: [3.99, 2.65, 1.81, 1.39, 1.16, 1.00, 0.83] },
  // o M156 6.2 é do C 63 AMG W204 (2008–2014); "Mercedes-AMG C 63" é o W205 em diante, com o 4.0 biturbo
  c63: { name: 'Mercedes-Benz C 63 AMG' },
  // a 412 T2 tinha câmbio transversal de 6 marchas (f1technical.net; Wikipedia, Ferrari 412 T2); mesma 1ª e mesma última
  f1v12: { gears: 6, ratios: [3.60, 2.79, 2.16, 1.67, 1.29, 1.00] },
  // Fusca 1600: coroa e pinhão 8 × 33 = 4,125; 4,375 é o do 1300 (fichas dos clubes de Fusca, ver AUDITORIA.md)
  fusca: { finalDrive: 4.125 },
  // o emblema do Gol de 1989 (2.0 AP com injeção, sem catalisador) é "GTi"
  golgti: { name: 'VW Gol GTi' },
  // a 450 SX-F é de motocross; a de trilha (enduro) da KTM é a EXC-F
  single: { tag: 'monocilíndrico de motocross' },
};

/** Turbina: id do preset → campos corrigidos (valor novo) */
export const CORRECOES_TURBINA: Correcoes = {
  // `tag` é o rótulo do preset e `thrust` só vai para o mostrador de empuxo (thrust100 em src/engines/turbina/dsp.ts, usado
  // só na telemetria); `propKW` só a Cena lê. Entram no som da página Turbina: as rotações do C-130J e do HondaJet e o
  // comprimento do Phenom (a paridade aplica a correção dos dois lados, então continua idêntica).
  // GE90-115B: deixou de ser "o maior fan" com o GE9X do 777X (134 pol = 3,40 m, certificado em 25/9/2020;
  // https://en.wikipedia.org/wiki/General_Electric_GE9X). O fan de 128 pol (3,25 m) e as 22 pás estão na ficha.
  wide: { tag: '2× GE90-115B · fan de 3,25 m, 22 pás' },
  // JT3D: não foi o primeiro turbofan; o primeiro motor com derivação a entrar em serviço foi o Rolls-Royce Conway
  // (https://en.wikipedia.org/wiki/Rolls-Royce_Conway), no 707-420 e no DC-8-40, em 1960; o JT3D veio em 1961.
  b707b: { tag: '4× JT3D · um dos primeiros turbofans' },
  // Phenom 300: o PW535E dá 3 360 lbf = 14,95 kN POR MOTOR (PW535E1 do 300E: 3 478 lbf = 15,47 kN;
  // https://en.wikipedia.org/wiki/Embraer_Phenom_300 e relatório TAR 13/21B/3 da CAA da Nova Zelândia). A ficha tinha
  // 30 kN, que é a soma dos dois motores, num campo que é "kN por motor" (os outros três executivos estão por motor).
  // Phenom 300: 15,64 m de comprimento; 15,9 era a envergadura (15,91 m; https://en.wikipedia.org/wiki/Embraer_Phenom_300).
  // Este campo entra no som: é o `l` da onda em N do estrondo (só acima de Mach 1, que o Phenom não passa) e a geometria
  // da passagem (AUDITORIA.md F-TUR-06).
  bizjet: { thrust: 15, length: 15.64 },
  // C-130J: AE 2100D3, gerador de gás de eixo único (compressor axial de 14 estágios) a 15 404 rpm em regime (TCDS EASA
  // IM.E.040, AE 2100A/D2/D2A; o material de treino do C-130J dá 15 265 rpm a 100%). A ficha herdava 27 000 e 31 000 rpm,
  // os genéricos dos turboélices (os do PW127 do ATR), e o apito do compressor saía ~uma oitava acima. No turboélice o
  // "fan" e o "compressor" do JetDSP descrevem o gerador de gás: o mesmo eixo, a mesma rotação (F-TUR-04). Muda o som.
  // HondaJet: HF120, N1 19 055 rpm e N2 48 777 rpm a 100% (TCDS EASA IM.E.054); a ficha tinha 17 000 e 40 000: o tom do
  // fan sobe 12% e o do compressor 22% (F-TUR-05). Muda o som.
  hondajet: { n1Max: 19055, n2Max: 48777 },
  // `propKW` (campo novo, kW por motor): a potência de decolagem no eixo da hélice dos turboélices. Não entra no som da
  // página Turbina (o JetDSP só a lê com `leiCarga`, que só o adaptador da Cena liga): é o torque do tom de carga de
  // Gutin na Passagem (src/carriers/leis-helice.ts; AUDITORIA.md P-03 e T-CEN-10). Potência de decolagem das fichas dos
  // fabricantes (Pratt & Whitney Canada, Rolls-Royce), shp × 0,7457: PW127M 2 750 shp, PW150A 5 071, AE 2100D3 4 637,
  // PT6A-60A 1 050, PT6A-114 600, PT6A-67P 1 200, PT6A-68C 1 600.
  regional: { propKW: 2051 }, q400: { propKW: 3781 }, c130: { propKW: 3458, n1Max: 15404, n2Max: 15404 }, kingair: { propKW: 783 },
  single: { propKW: 447 }, pc12: { propKW: 895 }, stucano: { propKW: 1193 },
};

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
