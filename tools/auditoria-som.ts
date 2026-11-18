// Auditoria de nível e de robustez do áudio de todas as famílias, fora do navegador (docs/AUDITORIA.md, frentes 5 e 6).
//
//   npx tsx tools/auditoria-som.ts [familias separadas por vírgula] [--niveis] [--extremos] [--taxas] [--trocas] [--gc]
//                                  [--json arquivo]
//
// Sem opções roda tudo (uns 10 min; uma família por processo, em paralelo). É relatório, não portão: sai com código
// ≠ 0 só se aparecer NaN/Infinity, exceção ou travamento.
//
// O que mede, com o volume padrão das páginas (master 0,8) e o motor quente:
//   --niveis    lenta e carga (pé no fundo) de TODOS os presets: RMS ponderado A, pico, fração das amostras com
//               |saída| > 0,7 (o `tanh` de saída já comprimindo), NaN, e o custo de CPU por bloco de 128 amostras a
//               48 kHz (média e p99, em % do quantum de 2,67 ms). Aponta quem foge mais de 8 dB da mediana da família.
//   --extremos  cada controle deslizante do painel ligado a um campo do preset (lido de src/pages/<família>/Painel.tsx),
//               no mínimo e no máximo, em 4 presets por família: 1 s de lenta + 1 s de carga, sem NaN, sem exceção, sem
//               pico absurdo, sem travar. No Vapor e no Elétrico, que não têm campos de ficha no painel, os comandos e
//               os campos do modo avançado.
//   --taxas     2 presets por família a 44,1 e 96 kHz contra 48 kHz (nível de lenta e de carga).
//   --trocas    troca de preset a cada 0,4 s com o motor rodando, todos os presets da família em sequência.
//   --gc        10 s de carga com `node --trace-gc`: coletas de lixo durante o áudio (alocação no laço).
//
// Escalas: Ronco, Turbina, Diesel, Radial e Rotativos saem normalizados (calibração + `tanh`), como no worklet de
// cada página. Vapor e Elétrico saem em pressão (Pa a 7,5 m, somando as fontes do motor/portador, sem a Cena): aqui
// viram fundo de escala por PA_FS (0 dBFS = 124 dB SPL) e passam pelo mesmo `tanh`, como faz o CenaDSP.
// O motor de palhetas (PalhetasDSP) fica de fora: tem DSP e mensagens próprios.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { PRESETS as P_RONCO, PRESETS_AVIACAO, ACESSORIOS_PADRAO } from '../src/engines/ronco/presets';
import { EngineDSP } from '../src/engines/ronco/dsp';
import { configCalibrada as cfgRonco } from '../src/engines/ronco/config';
import { PRESETS as P_DIESEL, PADRAO_DIESEL } from '../src/engines/diesel/presets';
import { DieselDSP } from '../src/engines/diesel/dsp';
import { configCalibrada as cfgDiesel } from '../src/engines/diesel/config';
import { PRESETS_RADIAL, PADRAO_RADIAL } from '../src/engines/radial/presets';
import { RadialDSP } from '../src/engines/radial/dsp';
import { configCalibrada as cfgRadial } from '../src/engines/radial/config';
import { PRESETS_ROTATIVO, PADRAO_ROTATIVO } from '../src/engines/rotativo/presets';
import { RotativoDSP } from '../src/engines/rotativo/dsp';
import { configCalibrada as cfgRotativo } from '../src/engines/rotativo/config';
import { PRESETS_TURBINA } from '../src/engines/turbina/presets';
import { JetDSP } from '../src/engines/turbina/dsp';
import { PRESETS_VAPOR } from '../src/engines/vapor/presets';
import { VaporDSP } from '../src/engines/vapor/dsp';
import { prepararMotorVapor } from '../src/engines/vapor/motor';
import { escapesPorVolta } from '../src/engines/vapor/presets';
import { PRESETS_ELETRICO } from '../src/engines/eletrico/presets';
import { prepararMotorEletrico } from '../src/engines/eletrico/motor';
import { montarPortadorEletrico } from '../src/engines/eletrico/portador';
import { PonderacaoA } from '../src/scene/filtros';
import { PA_FS } from '../src/scene/constantes';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const B = 128, QUANTUM_MS = (B / 48000) * 1000;
const LIMIAR_TANH = 0.7;       // |saída| acima disto: o tanh já tirou mais de 2 dB do pico
const FORA_DA_CURVA_DB = 8;    // distância à mediana da família a partir da qual o preset é apontado
const PICO_ABSURDO = 30;       // (escala absoluta, antes do tanh) 30 × fundo de escala = 154 dB SPL a 7,5 m

type Maquina = { processar(L: Float32Array, R: Float32Array, n: number): void; lenta(): void; carga(): void; rpm?(): number };
type Familia = {
  escala: 'tanh' | 'absoluta';
  ids: string[];
  montar(id: string, fs: number, patch?: Record<string, number>): Maquina;
  /** troca de preset na mesma instância (se a família tiver) */
  trocar?(m: Maquina, id: string, fs: number): void;
  painel?: string;
  /** campos de extremos que não vêm do painel: [nome, mínimo, máximo] */
  campos?: [string, number, number][];
  assenta: [number, number]; // s de espera antes de medir a lenta e a carga
};

// ------------------------------------------------------------------ famílias a pistão (EngineDSP e derivados)
function pistao(DSP: any, cfgFn: (spec: any, fs: number) => any, lista: any[], padrao: any, forcar: boolean, extra?: (d: any, spec: any) => void) {
  const spec = (id: string, patch?: Record<string, number>) => ({ ...padrao, ...lista.find((p) => p.id === id), ...patch });
  const rodando = (d: any, s: any) => {
    d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } });
    if (forcar) { // motor já funcionando na lenta, sem o procedimento de partida (o atalho de tools/radial-comum.ts)
      d.coolant = 90; d.ambientT = 20; d.state = 'run'; d.ignition = true; d.runT = 120; d.warm = 1; d.fase = 'pegou';
      d.omega = (s.idle * 2 * Math.PI) / 60; d.rpmAvg = s.idle; d.exhT = 450;
    } else d.message({ type: 'input', ignition: true });
  };
  const montar = (id: string, fs: number, patch?: Record<string, number>): Maquina => {
    const s = spec(id, patch), d: any = new DSP(fs);
    d.setConfig(cfgFn(s, fs));
    extra?.(d, s);
    rodando(d, s);
    return {
      processar: (L, R, n) => d.process(L, R, n),
      lenta: () => d.message({ type: 'input', throttle: 0 }),
      carga: () => d.message({ type: 'input', throttle: 1 }),
      rpm: () => d.rpmAvg,
      d,
    } as Maquina & { d: any };
  };
  const trocar = (m: Maquina, id: string, fs: number) => { const d = (m as any).d, s = spec(id); d.message({ type: 'config', cfg: cfgFn(s, fs) }); extra?.(d, s); if (d.state !== 'run') rodando(d, s); };
  return { montar, trocar };
}

const FAMILIAS: Record<string, Familia> = {
  ronco: { escala: 'tanh', ids: [...P_RONCO, ...PRESETS_AVIACAO].map((p) => p.id), painel: 'src/pages/ronco/Painel.tsx', assenta: [4, 3],
    ...(() => { // os 68 carros dão a partida pela ignição; a família Aviação entra já rodando (partida de avião)
      const carros = pistao(EngineDSP, cfgRonco, P_RONCO, ACESSORIOS_PADRAO, false), avioes = pistao(EngineDSP, cfgRonco, PRESETS_AVIACAO, ACESSORIOS_PADRAO, true);
      const de = (id: string) => (P_RONCO.some((p) => p.id === id) ? carros : avioes);
      return { montar: (id: string, f: number, patch?: Record<string, number>) => de(id).montar(id, f, patch), trocar: (m: Maquina, id: string, f: number) => de(id).trocar(m, id, f) };
    })() },
  diesel: { escala: 'tanh', ids: P_DIESEL.map((p) => p.id), painel: 'src/pages/diesel/Painel.tsx', assenta: [5, 4],
    ...pistao(DieselDSP, cfgDiesel, P_DIESEL, PADRAO_DIESEL, false, (d, s) => d.message({ type: 'diesel', portador: s.portadores.includes('carro') ? 'carro' : s.portadores[0] })) },
  radial: { escala: 'tanh', ids: PRESETS_RADIAL.map((p) => p.id), painel: 'src/pages/radial/Painel.tsx', assenta: [3, 4], ...pistao(RadialDSP, cfgRadial, PRESETS_RADIAL, PADRAO_RADIAL, true) },
  rotativo: { escala: 'tanh', ids: PRESETS_ROTATIVO.filter((p) => p.tipo !== 'palhetas').map((p) => p.id), painel: 'src/pages/rotativo/Painel.tsx', assenta: [3, 3],
    ...pistao(RotativoDSP, cfgRotativo, PRESETS_ROTATIVO, PADRAO_ROTATIVO, true) },
  turbina: { escala: 'tanh', ids: PRESETS_TURBINA.map((p) => p.id), painel: 'src/pages/turbina/Painel.tsx', assenta: [3, 12],
    montar(id, fs, patch) {
      const s: any = { ...PRESETS_TURBINA.find((p) => p.id === id), ...patch }, d: any = new JetDSP(fs);
      d.setConfig(s);
      d.state = 'run'; d.lit = true; d.n2 = s.n2Idle; d.u = 0; d.lightT = 10; // já em lenta (o cenário takeoff de tools/render.ts)
      return { processar: (L, R, n) => d.process(L, R, n), lenta: () => d.message({ type: 'input', tla: 0 }), carga: () => d.message({ type: 'input', tla: s.ab && s.arch !== 'turboprop' ? 1.3 : 1 }), d } as Maquina;
    },
    trocar(m, id) { const d = (m as any).d, s: any = PRESETS_TURBINA.find((p) => p.id === id); d.setConfig(s); d.state = 'run'; d.lit = true; d.n2 = Math.max(d.n2 || 0, s.n2Idle); } },
  vapor: { escala: 'absoluta', ids: PRESETS_VAPOR.map((p) => p.id), assenta: [3, 5],
    campos: [['regulador', 0, 1], ['reverser', -1, 1], ['apitoAbertura', 0.05, 1], ['freio', 0, 1], ['fogo', 0, 1], ['mixAr', 0, 2], ['mixMec', 0, 2]],
    montar(id, fs, patch) {
      const P = PRESETS_VAPOR.find((p) => p.id === id)!, d = new VaporDSP(fs);
      d.configurar(prepararMotorVapor(P, fs), fs);
      const tmp = d.fontes.map(() => new Float32Array(B));
      const cmd = (c: Record<string, unknown>) => d.comandar({ acelerador: 0, ignicao: true, partida: false, ...c, ...(patch ? { ...patch, apito: patch.apitoAbertura !== undefined } : {}) } as never);
      return {
        processar(L, R, n) { d.processar(tmp, n); for (let k = 0; k < n; k++) { let s = 0; for (const c of tmp) s += c[k]; L[k] = R[k] = Math.tanh(s / PA_FS); } },
        lenta: () => { d.impor(0); cmd({ regulador: 0 }); },                                              // parada, com os auxiliares
        carga: () => { d.impor((4 / escapesPorVolta(P)) * 2 * Math.PI); cmd({ regulador: 1, cutoff: 0.5 }); }, // 4 sopros/s, regulador aberto
        d,
      } as Maquina;
    },
    trocar(m, id, fs) { const d = (m as any).d as VaporDSP; d.configurar(prepararMotorVapor(PRESETS_VAPOR.find((p) => p.id === id)!, fs), fs); } },
  eletrico: { escala: 'absoluta', ids: PRESETS_ELETRICO.map((p) => p.id), assenta: [2, 5],
    campos: [['inversor.fc', 100, 20000], ['inversor.delta', 0.02, 0.3], ['Zs', 0, 96], ['reducao.estagios.0.Zp', 5, 60], ['excentricidade', 0, 1], ['escovas.desgaste', 0, 1], ['detune', 0, 0.02]],
    montar(id, fs, patch) {
      const P: any = structuredClone(PRESETS_ELETRICO.find((p) => p.id === id));
      for (const [caminho, v] of Object.entries(patch || {})) { // campo do modo avançado, se o preset o tiver
        const partes = caminho.split('.'); let o = P;
        for (const k of partes.slice(0, -1)) o = o?.[k];
        if (o && o[partes[partes.length - 1]] !== undefined) o[partes[partes.length - 1]] = v;
      }
      const p = montarPortadorEletrico(prepararMotorEletrico(P, fs), fs, {});
      const tmp = p.fontes().map(() => new Float32Array(B));
      return {
        processar(L, R, n) { p.processar(tmp, n, 1 / fs); for (let k = 0; k < n; k++) { let s = 0; for (const c of tmp) s += c[k]; L[k] = R[k] = Math.tanh(s / PA_FS); } },
        lenta: () => p.comandar({ pedal: 0, ignicao: true }),   // ligado e parado
        carga: () => p.comandar({ pedal: 1, ignicao: true }),   // arranca com tudo (mede o fim da aceleração)
      };
    } },
};

// ------------------------------------------------------------------ medidas
type Medida = { dbA: number; pico: number; acima: number; nan: number; cpu?: number; p99?: number; rpm?: number };
const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-12));
function medir(m: Maquina, fs: number, espera: number, dur: number, cpu = false): Medida {
  const L = new Float32Array(B), R = new Float32Array(B), pa = new PonderacaoA(fs);
  for (let i = 0; i < espera * fs; i += B) m.processar(L, R, B);
  let soma = 0, n = 0, pico = 0, acima = 0, nan = 0;
  const tempos: number[] = [];
  for (let i = 0; i < dur * fs; i += B) {
    const t0 = cpu ? performance.now() : 0;
    m.processar(L, R, B);
    if (cpu) tempos.push(performance.now() - t0);
    for (let k = 0; k < B; k++) {
      const a = Math.abs(L[k]), b = Math.abs(R[k]);
      if (!(a < 1e9) || !(b < 1e9)) { nan++; continue; }
      const mx = a > b ? a : b;
      if (mx > pico) pico = mx;
      if (mx > LIMIAR_TANH) acima++;
      const y = pa.run(0.5 * (L[k] + R[k]));
      soma += y * y; n++;
    }
  }
  tempos.sort((a, b) => a - b);
  // (a CPU é sempre referida ao quantum de 128 amostras a 48 kHz, com o bloco medido na taxa do teste)
  const escala = (fs / 48000) / QUANTUM_MS * 100;
  return { dbA: db(Math.sqrt(soma / Math.max(1, n))), pico, acima: acima / Math.max(1, n + nan), nan,
    ...(cpu ? { cpu: (tempos.reduce((a, b) => a + b, 0) / tempos.length) * escala, p99: tempos[Math.floor(tempos.length * 0.99)] * escala } : {}), rpm: m.rpm?.() };
}
const mediana = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };

/** campos do painel ligados ao preset: `<Slider … min={a} max={b} … valor={spec.campo …}` */
function camposDoPainel(arquivo: string): [string, number, number][] {
  const out: [string, number, number][] = [];
  for (const linha of fs.readFileSync(path.join(RAIZ, arquivo), 'utf8').split('\n')) {
    if (!linha.includes('<Slider')) continue;
    const r = linha.match(/min=\{(-?[\d.]+)\} max=\{(-?[\d.]+)\}/), c = linha.match(/valor=\{(?:clamp\()?spec\.(\w+)/);
    if (r && c && !out.some((x) => x[0] === c[1])) out.push([c[1], +r[1], +r[2]]);
  }
  return out;
}

// ------------------------------------------------------------------ uma família (processo filho)
function rodarFamilia(nome: string, etapas: Set<string>) {
  const F = FAMILIAS[nome], res: any = { familia: nome, escala: F.escala };
  const tenta = <T>(rotulo: string, erros: string[], f: () => T): T | null => { try { return f(); } catch (e) { erros.push(`${rotulo}: exceção ${(e as Error).message?.split('\n')[0]}`); return null; } };

  if (etapas.has('niveis')) {
    res.niveis = []; res.errosNiveis = [];
    for (const id of F.ids) tenta(id, res.errosNiveis, () => {
      const m = F.montar(id, 48000);
      m.lenta(); const lenta = medir(m, 48000, F.assenta[0], 3);
      m.carga(); const carga = medir(m, 48000, F.assenta[1], 3, true);
      res.niveis.push({ id, lenta, carga });
    });
  }
  if (etapas.has('extremos')) {
    const campos = F.painel ? camposDoPainel(F.painel) : F.campos || [];
    const quatro = [...new Set([0, Math.floor(F.ids.length / 3), Math.floor((2 * F.ids.length) / 3), F.ids.length - 1])].map((i) => F.ids[i]);
    res.extremos = { campos: campos.map((c) => c[0]), presets: quatro, casos: 0, problemas: [] as string[] };
    for (const id of quatro) for (const [campo, mn, mx] of campos) for (const v of [mn, mx]) {
      res.extremos.casos++;
      const rot = `${id} ${campo}=${v}`, t0 = performance.now();
      tenta(rot, res.extremos.problemas, () => {
        const m = F.montar(id, 48000, { [campo]: v });
        m.lenta(); const a = medir(m, 48000, 0, 1);
        m.carga(); const b = medir(m, 48000, 0, 1);
        const nan = a.nan + b.nan, pico = Math.max(a.pico, b.pico), seg = (performance.now() - t0) / 1000;
        if (nan) res.extremos.problemas.push(`${rot}: ${nan} amostras NaN/Infinity`);
        else if (F.escala === 'absoluta' ? Math.atanh(Math.min(pico, 0.999999)) > PICO_ABSURDO : pico > 1) res.extremos.problemas.push(`${rot}: pico ${pico.toFixed(2)}`);
        if (seg > 60) res.extremos.problemas.push(`${rot}: levou ${seg.toFixed(0)} s para 2 s de áudio`);
      });
    }
  }
  if (etapas.has('taxas')) {
    res.taxas = []; res.errosTaxas = [];
    for (const id of [F.ids[0], F.ids[Math.floor(F.ids.length / 2)]]) {
      const linha: any = { id };
      for (const fs of [48000, 44100, 96000]) tenta(`${id} a ${fs} Hz`, res.errosTaxas, () => {
        const m = F.montar(id, fs);
        m.lenta(); const lenta = medir(m, fs, F.assenta[0], 2);
        m.carga(); const carga = medir(m, fs, F.assenta[1], 2, true);
        linha[fs] = { lenta: lenta.dbA, carga: carga.dbA, nan: lenta.nan + carga.nan, cpu: carga.cpu, rpm: carga.rpm };
      });
      res.taxas.push(linha);
    }
  }
  if (etapas.has('trocas') && F.trocar) {
    res.trocas = { n: 0, problemas: [] as string[] };
    const L = new Float32Array(B), R = new Float32Array(B);
    tenta('trocas', res.trocas.problemas, () => {
      const m = F.montar(F.ids[0], 48000);
      m.carga();
      for (const id of [...F.ids.slice(1), ...F.ids.slice(0, 3)]) {
        tenta(`troca para ${id}`, res.trocas.problemas, () => {
          F.trocar!(m, id, 48000); m.carga(); res.trocas.n++;
          let nan = 0, pico = 0;
          for (let i = 0; i < 0.4 * 48000; i += B) { m.processar(L, R, B); for (let k = 0; k < B; k++) { const a = Math.abs(L[k]); if (!(a < 1e9)) nan++; else if (a > pico) pico = a; } }
          if (nan) res.trocas.problemas.push(`troca para ${id}: ${nan} amostras NaN`);
          else if (pico > 1) res.trocas.problemas.push(`troca para ${id}: pico ${pico.toFixed(2)}`);
        });
      }
    });
  }
  if (etapas.has('gc')) { // (o pai roda este filho com --trace-gc e conta as linhas entre as marcas)
    const m = F.montar(F.ids[Math.floor(F.ids.length / 2)], 48000), L = new Float32Array(B), R = new Float32Array(B);
    m.carga();
    for (let i = 0; i < 4 * 48000; i += B) m.processar(L, R, B);
    console.log('GC-INICIO');
    for (let i = 0; i < 10 * 48000; i += B) m.processar(L, R, B);
    console.log('GC-FIM');
    res.gc = { preset: F.ids[Math.floor(F.ids.length / 2)] };
  }
  console.log('RESULTADO ' + JSON.stringify(res));
}

// ------------------------------------------------------------------ relatório (processo pai)
function relatorio(todos: any[]) {
  const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '—');
  let ruim = 0;
  for (const r of todos) {
    console.log(`\n## ${r.familia} (${r.escala === 'tanh' ? 'saída normalizada do worklet' : 'pressão a 7,5 m, 0 dBFS = 124 dB SPL'})\n`);
    if (r.niveis) {
      const ml = mediana(r.niveis.map((x: any) => x.lenta.dbA)), mc = mediana(r.niveis.map((x: any) => x.carga.dbA));
      console.log('| preset | lenta dBFS(A) | pico | carga dBFS(A) | pico | carga − lenta | > 0,7 em carga | CPU média / p99 (% do quantum) | fora da curva |\n|---|---|---|---|---|---|---|---|---|');
      for (const x of r.niveis) {
        const obs: string[] = [];
        if (Math.abs(x.lenta.dbA - ml) > FORA_DA_CURVA_DB) obs.push(`lenta ${x.lenta.dbA > ml ? '+' : ''}${f1(x.lenta.dbA - ml)} dB`);
        if (Math.abs(x.carga.dbA - mc) > FORA_DA_CURVA_DB) obs.push(`carga ${x.carga.dbA > mc ? '+' : ''}${f1(x.carga.dbA - mc)} dB`);
        if (x.carga.acima > 0.01) obs.push('limitador');
        if (x.lenta.nan || x.carga.nan) { obs.push('NaN'); ruim++; }
        console.log(`| ${x.id} | ${f1(x.lenta.dbA)} | ${x.lenta.pico.toFixed(2)} | ${f1(x.carga.dbA)} | ${x.carga.pico.toFixed(2)} | ${f1(x.carga.dbA - x.lenta.dbA)} | ${(100 * x.carga.acima).toFixed(2)}% | ${f1(x.carga.cpu)} / ${f1(x.carga.p99)} | ${obs.join(', ')} |`);
      }
      const pior = [...r.niveis].sort((a: any, b: any) => b.carga.cpu - a.carga.cpu)[0];
      console.log(`\nMediana: lenta ${f1(ml)}, carga ${f1(mc)} dBFS(A). Pior CPU: ${pior.id}, ${f1(pior.carga.cpu)}% do quantum em média, p99 ${f1(pior.carga.p99)}% (margem de ${f1(100 / pior.carga.cpu)}×).`);
      const lim = r.niveis.filter((x: any) => x.carga.acima > 0.01);
      console.log(`Limitador: ${lim.length} de ${r.niveis.length} presets com mais de 1% das amostras acima de ${LIMIAR_TANH} em carga${lim.length ? ` (${lim.map((x: any) => `${x.id} ${(100 * x.carga.acima).toFixed(1)}%`).join(', ')})` : ''}.`);
      for (const e of r.errosNiveis) { console.log(`ERRO ${e}`); ruim++; }
    }
    if (r.extremos) {
      console.log(`\nExtremos: ${r.extremos.casos} casos (${r.extremos.campos.length} campos × mínimo e máximo × ${r.extremos.presets.join(', ')}): ${r.extremos.problemas.length ? `${r.extremos.problemas.length} problema(s)` : 'sem NaN, exceção, pico absurdo ou travamento'}.`);
      console.log(`Campos: ${r.extremos.campos.join(', ')}.`);
      for (const p of r.extremos.problemas) { console.log(`- ${p}`); if (/NaN|exceção|levou/.test(p)) ruim++; }
    }
    if (r.taxas) {
      console.log('\n| preset | 48 kHz lenta / carga | 44,1 kHz (diferença) | 96 kHz (diferença) | rpm em carga 48 / 44,1 / 96 | CPU a 96 kHz |\n|---|---|---|---|---|---|');
      for (const t of r.taxas) {
        const a = t[48000], b = t[44100], c = t[96000];
        if (!a || !b || !c) continue;
        const d = (x: any) => `${f1(x.lenta - a.lenta)} / ${f1(x.carga - a.carga)} dB${x.nan ? ' NaN!' : ''}`;
        if (b.nan || c.nan) ruim++;
        console.log(`| ${t.id} | ${f1(a.lenta)} / ${f1(a.carga)} | ${d(b)} | ${d(c)} | ${[a, b, c].map((x) => (x.rpm ? x.rpm.toFixed(0) : '—')).join(' / ')} | ${f1(c.cpu)}% |`);
      }
      for (const e of r.errosTaxas) { console.log(`ERRO ${e}`); ruim++; }
    }
    if (r.trocas) {
      console.log(`\nTroca rápida de preset: ${r.trocas.n} trocas a cada 0,4 s com o motor em carga: ${r.trocas.problemas.length ? '' : 'sem NaN nem exceção.'}`);
      for (const p of r.trocas.problemas) { console.log(`- ${p}`); if (/NaN|exceção/.test(p)) ruim++; }
    }
    if (r.gc) console.log(`\nColeta de lixo em 10 s de carga (${r.gc.preset}): ${r.gc.coletas} coleta(s)${r.gc.coletas ? `, ${r.gc.pausaMs.toFixed(1)} ms de pausa no total, maior ${r.gc.maiorMs.toFixed(1)} ms` : ' (não aloca no laço)'}.`);
  }
  return ruim;
}

// ------------------------------------------------------------------ CLI
const args = process.argv.slice(2);
const ETAPAS = ['niveis', 'extremos', 'taxas', 'trocas', 'gc'];
const pedidas = ETAPAS.filter((e) => args.includes('--' + e));
const etapas = new Set(pedidas.length ? pedidas : ETAPAS);
if (args[0] === '--filho') rodarFamilia(args[1], new Set(args[2].split(',')));
else {
  const iJson = args.indexOf('--json');
  const nomes = (args.find((a, i) => !a.startsWith('--') && (iJson < 0 || i !== iJson + 1)) || Object.keys(FAMILIAS).join(',')).split(',');
  for (const n of nomes) if (!FAMILIAS[n]) { console.error(`família desconhecida: ${n} (${Object.keys(FAMILIAS).join(', ')})`); process.exit(2); }
  const aqui = fileURLToPath(import.meta.url);
  const filho = (nome: string, quais: string[], traceGc = false) => new Promise<{ res: any; saida: string }>((resolve, reject) => {
    const p = spawn(process.execPath, [...(traceGc ? ['--trace-gc'] : []), '--import', 'tsx', aqui, '--filho', nome, quais.join(',')], { cwd: RAIZ });
    let saida = '', erro = '';
    p.stdout.on('data', (x) => (saida += x)); p.stderr.on('data', (x) => (erro += x));
    p.on('close', (codigo) => {
      const l = saida.split('\n').find((x) => x.startsWith('RESULTADO '));
      if (codigo !== 0 || !l) reject(new Error(`${nome}: código ${codigo}\n${erro.slice(-2000)}`)); else resolve({ res: JSON.parse(l.slice(10)), saida });
    });
  });
  (async () => {
    const t0 = Date.now();
    const semGc = [...etapas].filter((e) => e !== 'gc');
    const todos = await Promise.all(nomes.map(async (nome) => {
      const r = semGc.length ? (await filho(nome, semGc)).res : { familia: nome, escala: FAMILIAS[nome].escala };
      if (etapas.has('gc')) {
        const g = await filho(nome, ['gc'], true);
        const trecho = g.saida.slice(g.saida.indexOf('GC-INICIO'), g.saida.indexOf('GC-FIM'));
        const pausas = [...trecho.matchAll(/(?:Scavenge|Mark-Compact|Mark-sweep)[^\n]*?\/ ([\d.]+) ms/g)].map((m) => +m[1]);
        r.gc = { ...g.res.gc, coletas: (trecho.match(/Scavenge|Mark-Compact|Mark-sweep/g) || []).length, pausaMs: pausas.reduce((a, b) => a + b, 0), maiorMs: Math.max(0, ...pausas) };
      }
      return r;
    }));
    console.log(`# Auditoria de nível e robustez (${nomes.join(', ')}; ${[...etapas].join(', ')}; ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    const ruim = relatorio(todos);
    if (iJson >= 0) fs.writeFileSync(args[iJson + 1], JSON.stringify(todos, null, 1));
    console.log(ruim ? `\n${ruim} problema(s) grave(s) (NaN, exceção ou travamento)` : '\nSem NaN, exceção nem travamento.');
    process.exit(ruim ? 1 : 0);
  })().catch((e) => { console.error(e); process.exit(2); });
}
