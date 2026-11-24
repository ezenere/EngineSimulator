// Medida de CPU e de alocação como na página (AUDITORIA A8; docs/TECNICO.md → Diesel → CPU do laço de amostra, "A medida
// como na página"). Usada pelos `cpu:*` (diesel, radial, rotativo, vapor, eletrico) e por tools/cpu-alocacao.ts.
//
// O worklet da página tem um processo de áudio com uma instância do motor; a calibração (as sondas) roda na thread
// principal e a configuração chega pronta por mensagem; e o código é o que o Vite empacota, sem guardar os nomes das
// funções. Antes, os `cpu:*` mediam no mesmo processo do tsx: vários presets, as sondas de calibração e a referência
// juntos deixavam o laço comum do EngineDSP megamórfico (a EMD a 44 % do tempo real contra 18 % sozinha), e o `keepNames`
// do tsx põe um Object.defineProperty em toda função criada (no Diesel eram dois terços do tempo). Aqui:
//   · cada caso (e a referência) roda num processo só dele (`Filho`), com tools/cpu-casos.ts empacotado pelo rolldown,
//     o empacotador do Vite, sem minificar e sem os nomes (como o `worker` do vite.config.mts);
//   · quem pede calibra no próprio processo (tsx) e manda a configuração por mensagem (serialização estruturada, como o
//     postMessage da página);
//   · a razão entre um caso e a referência sai de trechos alternados de 0,25 s, um processo de cada vez (`alternados`):
//     os dois passam pela mesma carga da máquina.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');
const CACHE = path.join(RAIZ, 'node_modules', '.cache', 'engine-cpu');

let pacote: Promise<string> | null = null;
/** tools/cpu-casos.ts empacotado pelo rolldown (uma vez por processo; o arquivo sai ao fim) */
export function empacotar(): Promise<string> {
  return (pacote ??= (async () => {
    fs.mkdirSync(CACHE, { recursive: true });
    const arq = path.join(CACHE, `casos-${process.pid}.mjs`);
    if (process.env.ENGINE_CPU_EMPACOTADOR === 'esbuild') {
      // (para comparar: o esbuild, o empacotador do tsx, sem os nomes)
      const { build } = await import('esbuild');
      await build({ entryPoints: [path.join(AQUI, 'cpu-casos.ts')], bundle: true, platform: 'node', format: 'esm', outfile: arq, logLevel: 'silent' });
    } else {
      const { rolldown } = await import('rolldown');
      const b = await rolldown({ input: path.join(AQUI, 'cpu-casos.ts'), platform: 'node', external: [/^node:/], logLevel: 'silent' });
      await b.write({ file: arq, format: 'esm', minify: false });
      await b.close();
    }
    // (ENGINE_CPU_MANTER=1 guarda o pacote, para achar as linhas dos sítios de alocação de tools/cpu-alocacao.ts --sitios)
    if (!process.env.ENGINE_CPU_MANTER) process.on('exit', () => { try { fs.unlinkSync(arq); } catch { /* já saiu */ } });
    else console.error(`(pacote guardado em ${arq})`);
    return arq;
  })());
}

export type Pedido = { familia: string; caso: string; dados?: any };

/** um processo de medida com um caso montado e aquecido */
export class Filho {
  p: ChildProcess; info: Record<string, any> = {};
  private espera: ((m: any) => void) | null = null;
  private constructor(p: ChildProcess) {
    this.p = p;
    p.on('message', (m) => { const f = this.espera; this.espera = null; f?.(m); });
    p.on('exit', (c) => { if (this.espera) { const f = this.espera; this.espera = null; f({ erro: `o processo de medida saiu com ${c}` }); } });
  }
  static async abrir(ped: Pedido): Promise<Filho> {
    const arq = await empacotar();
    // (ENGINE_CPU_NODE_ARGS: opções do node para o processo de medida, como --trace-turbo-inlining, para investigar)
    const extra = process.env.ENGINE_CPU_NODE_ARGS ? process.env.ENGINE_CPU_NODE_ARGS.split(' ') : [];
    const f = new Filho(spawn(process.execPath, [...extra, arq], { cwd: RAIZ, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], serialization: 'advanced' }));
    const r = await f.pedir({ tipo: 'montar', ...ped });
    f.info = r.info ?? {};
    return f;
  }
  pedir(m: any): Promise<any> {
    return new Promise((ok, erro) => {
      this.espera = (r) => (r?.erro ? erro(new Error(r.erro)) : ok(r));
      this.p.send(m);
    });
  }
  /** tempo de CPU do processo (s) em `s` segundos de som */
  async rodar(s: number) { const r = await this.pedir({ tipo: 'rodar', s }); this.info = r.info ?? this.info; return r.cpu as number; }
  /** bytes alocados (amostragem do heap do V8, que estima o total), coletas e o tempo delas em `s` segundos de som */
  alocacao(s: number, amostrar = true): Promise<{ bytes: number; coletas: number; msColetas: number; cpu: number; sitios: [string, number][] }> { return this.pedir({ tipo: amostrar ? 'alocacao' : 'coletas', s }); }
  fechar() { try { this.p.send({ tipo: 'fim' }); } catch { /* já saiu */ } }
}

/** `total` segundos de som em cada processo, em trechos alternados de `trecho` s (um processo de cada vez); devolve o
 *  tempo de CPU (s) de cada um */
export async function alternados(fs: Filho[], total = 10, trecho = 0.25) {
  const cpu = fs.map(() => 0);
  for (let k = 0; k < Math.round(total / trecho); k++) {
    // (a ordem troca a cada trecho: nenhum dos dois fica sempre logo depois do outro)
    const ordem = k % 2 ? fs.map((_, i) => fs.length - 1 - i) : fs.map((_, i) => i);
    for (const i of ordem) cpu[i] += await fs[i].rodar(trecho);
  }
  return cpu;
}

/** abre os processos, mede alternado e fecha: o tempo de CPU por segundo de som (fração do tempo real) de cada pedido */
export async function medirAlternados(peds: Pedido[], total = 10) {
  const fs = await Promise.all(peds.map((p) => Filho.abrir(p)));
  try {
    const cpu = await alternados(fs, total);
    return fs.map((f, i) => ({ fr: cpu[i] / total, info: f.info }));
  } finally { for (const f of fs) f.fechar(); }
}

/** um caso sozinho: `total` s de som de uma vez */
export async function medirSozinho(ped: Pedido, total = 10) {
  const f = await Filho.abrir(ped);
  try { const c = await f.rodar(total); return { fr: c / total, info: f.info }; } finally { f.fechar(); }
}
