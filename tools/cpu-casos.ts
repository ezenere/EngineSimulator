// Os casos das medidas de CPU e de alocação, do lado do processo que mede (tools/cpu-pagina.ts): este arquivo roda
// empacotado pelo rolldown, o empacotador do Vite, num processo só dele, com uma instância do motor, como o worklet da
// página. A configuração calibrada chega pronta por mensagem (a página calibra na thread principal): aqui não roda sonda
// nenhuma. Cada caso devolve `rodar(segundos)`, que avança o motor com os eventos no relógio do próprio caso.
//
// Protocolo (mensagens do processo que pede, uma de cada vez, cada uma com uma resposta):
//   { tipo: 'montar', familia, caso, dados }   → { info }          (monta e aquece)
//   { tipo: 'rodar', s }                       → { cpu, info }     (tempo de CPU do processo em `s` segundos de som)
//   { tipo: 'alocacao', s }                    → { bytes, coletas, msColetas }  (amostragem do heap e as coletas)
//   { tipo: 'coletas', s }                     → { coletas, msColetas }         (só as coletas, sem o amostrador)
//   { tipo: 'fim' }
import { Session } from 'node:inspector/promises';
import { PerformanceObserver, constants } from 'node:perf_hooks';
import { DieselDSP } from '../src/engines/diesel/dsp';
import { EngineDSP } from '../src/engines/ronco/dsp';
import { RadialDSP } from '../src/engines/radial/dsp';
import { RotativosDSP } from '../src/engines/rotativo/rotativos';
import { VaporDSP } from '../src/engines/vapor/dsp';
import { escapesPorVolta } from '../src/engines/vapor/presets';
import { MotorEletrico } from '../src/engines/eletrico/motor';
import { BancoDeLinhas, ListaLinhas } from '../src/engines/eletrico/linhas';
import { montarPortadorEletrico } from '../src/engines/eletrico/portador';
import { CenaDSP } from '../src/scene/dsp-cena';
import { ambientePassagem } from '../src/scene/ambientes';

const SR = 48000, B = 128, TAU = Math.PI * 2;
// (o processo de medida roda com --allow-natives-syntax: `rapido` diz se o objeto está com propriedades rápidas ou caiu no
// modo dicionário do V8, que deixa o laço 4–5× mais lento; ver docs/TECNICO.md → Diesel → CPU do laço de amostra)
let rapido: (o: any) => boolean = () => true;
try { rapido = new Function('o', 'return %HasFastProperties(o)') as any; } catch { /* sem a opção */ }
let alvo: any = null; // (o DSP do caso, para a guarda)
export type Motor = { rodar: (s: number) => void; info?: () => Record<string, any> };
type Fabrica = (caso: string, dados: any) => Motor;

/** o nó de áudio como no worklet (`registrarProcessador`): quatro canais (saída e envio), telemetria por dentro; os
 *  eventos `ev` ([segundos, ação]) no relógio do caso, no começo do bloco; `cada` antes de cada bloco */
function no(d: any, ev: [number, (d: any) => void][] = [], cada?: (d: any) => void): Motor {
  const L = new Float32Array(B), R = new Float32Array(B), sL = new Float32Array(B), sR = new Float32Array(B);
  let i = 0, ei = 0;
  const fila = [...ev].sort((a, b) => a[0] - b[0]);
  return {
    rodar: (s) => {
      const n = Math.round(s * SR);
      for (let k = 0; k < n; k += B, i += B) {
        while (ei < fila.length && fila[ei][0] * SR <= i) fila[ei++][1](d);
        cada?.(d);
        d.process(L, R, B, sL, sR);
      }
    },
  };
}
/** monta o DSP como a página: o nó, a telemetria, o ouvinte e a config calibrada por mensagem */
function pagina(d: any, cfg: any, params: Record<string, any> = {}) {
  alvo = d;
  d.post = () => {};
  d.message({ type: 'params', params: { listener: 'ext', ...params } });
  d.message({ type: 'config', cfg });
  return d;
}

const CASOS: Record<string, Fabrica> = {
  // Diesel (tools/diesel-cpu.ts): locomotiva em notch 8 (12 s para subir e assentar) ou plena carga travada na rotação de
  // potência (a sonda de potência do teste:diesel)
  diesel: (caso, { cfg, spec }) => {
    const d: any = pagina(new DieselDSP(SR), cfg), loco = caso === 'notch8';
    d.message({ type: 'diesel', portador: loco ? 'locomotiva' : 'carro' });
    d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } });
    if (loco) { d.message({ type: 'input', ignition: true }); d.message({ type: 'diesel', notch: 8 }); }
    else {
      const rpm = spec.rpmPotencia;
      Object.assign(d, { state: 'run', runT: 30, lockOmega: true, sonda: true, fuelCmd: 1, fuelM: 1, omega: (rpm * TAU) / 60, rpmAvg: rpm, tw: 0.95, turboW: 0.95, tEsc: 500 });
      d.boostFixo = spec.boost + (d.soprador0 ? d.soprador0(rpm) : 0);
    }
    const m = no(d);
    m.rodar(loco ? 12 : 2);
    return { ...m, info: () => ({ rpm: d.rpmAvg, tubos: d.lines.length, nos: d.nodes.length }) };
  },
  // Ronco: `v16` é a referência do DIESEL.md 8.1 (o Chiron, W16 como V16, em plena carga travada a 5 000 rpm); `carga`,
  // qualquer preset em plena carga travada em `rpm`; `muscle`, a referência do Vapor (V8 solto, 2 s de lenta e pé no fundo)
  ronco: (caso, { cfg, rpm }) => {
    const d: any = pagina(new EngineDSP(SR), cfg);
    // (o `muscle` parte frio, como sempre partiu no tools/vapor-cpu.ts: a água na temperatura real)
    if (caso !== 'muscle') d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } });
    if (caso === 'muscle') {
      d.message({ type: 'input', ignition: true });
      const m = no(d, [[2, (x) => x.message({ type: 'input', throttle: 1 })]]);
      m.rodar(2);
      return { ...m, info: () => ({ rpm: d.rpmAvg }) };
    }
    const r = caso === 'v16' ? 5000 : rpm;
    Object.assign(d, { state: 'run', ignition: true, runT: 100, lockOmega: true, omega: (r * TAU) / 60, rpmAvg: r, thrTarget: 1, thr: 1 });
    const m = no(d);
    m.rodar(2);
    return { ...m, info: () => ({ rpm: d.rpmAvg, tubos: d.lines.length, nos: d.nodes.length }) };
  },
  // Radial (tools/radial-cpu.ts): o motor quente na lenta, 1 s de aquecimento, manete toda 1 s depois, subindo de giro
  radial: (_caso, { cfg, spec }) => { // (caso único: 'subida')
    const d: any = pagina(new RadialDSP(SR), cfg, { master: 0.8, ambSound: false });
    d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } });
    Object.assign(d, { coolant: 90, ambientT: 20, state: 'run', ignition: true, runT: 120, fase: 'pegou', omega: (spec.idle * TAU) / 60, rpmAvg: spec.idle, exhT: 320, warm: 1 });
    const m = no(d, [[2, (x) => x.message({ type: 'input', throttle: 1 })]]);
    m.rodar(1);
    return { ...m, info: () => ({ rpm: d.rpmAvg, tubos: d.lines.length, nos: d.nodes.length }) };
  },
  // Rotativos (tools/rotativo-cpu.ts), no RotativosDSP da página: `rev`, sustentado em ponto morto a 85 % da máxima com o
  // acelerador a 0,6 ajustado até o torque médio zerar; `carga`, plena carga travada a 70 % da máxima. 2 s de aquecimento
  rotativo: (caso, { cfg, spec }) => {
    const w: any = pagina(new RotativosDSP(SR), cfg, { master: 0.8, ambSound: false, env: 'open' });
    w.message({ type: 'input', temp: { mode: 'fixed', value: 90 } });
    const d = w.rot, rpm = spec.rpmMax * (caso === 'rev' ? 0.85 : 0.7), thr = caso === 'rev' ? 0.6 : 1;
    Object.assign(d, { coolant: 90, ambientT: 20, state: 'run', ignition: true, runT: 120, warm: 1, omega: (rpm * TAU) / 60, rpmAvg: rpm, exhT: 450 });
    Object.assign(d, { lockOmega: true, thrTarget: thr, thr });
    const cada = caso === 'rev' ? (x: any) => { const k = x.rot; k.thrTarget = Math.min(1, Math.max(0.005, k.thrTarget - (2e-4 * k.tqMean) / Math.max(1, k.Tmax / 100))); } : undefined;
    const m = no(w, [], cada);
    m.rodar(2);
    return { ...m, info: () => ({ rpm: d.rpmAvg, boost: d.boost ?? 0, tubos: d.lines.length, nos: d.nodes.length }) };
  },
  // Vapor (tools/vapor-cpu.ts): o VaporDSP em marcha a 10 chuffs/s, regulador cheio, corte de 30 %; `tudo` com apito,
  // sino, bomba de ar e torneiras. É o motor (o que o MotorVapor entrega à Cena), sem o portador nem a Cena
  vapor: (caso, { cfg }) => {
    const d: any = new VaporDSP(SR);
    d.configurar(cfg, SR);
    d.comandar({ acelerador: 0, ignicao: true, partida: false, bombaAr: false, injetor: false, torneiras: false, soprador: false });
    d.fixar({ regulador: 1, cutoff: (0.3 - 0.15) / 0.7 });
    d.pChest = d.pCal * 1e5 + 101325;
    d.impor((10 / escapesPorVolta(cfg.preset)) * TAU);
    if (caso === 'tudo') d.comandar({ acelerador: 0, ignicao: true, partida: false, apito: 1, sino: true, bombaAr: true, torneiras: true });
    const tmp = d.fontes.map(() => new Float32Array(B));
    const rodar = (s: number) => { for (let i = 0; i < s * SR; i += B) d.processar(tmp, B); };
    rodar(1);
    return { rodar, info: () => ({ fontes: d.fontes.length }) };
  },
  // Elétrico (tools/eletrico/cpu.ts): o banco de 200 linhas, o motor do N700 (4 unidades) a 2 500 rpm e o N700 no túnel
  // pela Cena; `motorCarga` é o motor do N700 com uma carga quadrática no eixo (o caso das coletas de lixo)
  eletrico: (caso, dados) => {
    const cfg = dados?.cfg;
    if (caso === 'banco') {
      const nL = 200, b = new BancoDeLinhas(SR, nL, 7), L = new ListaLinhas(256), out = new Float32Array(64);
      const fq = Array.from({ length: nL }, (_, k) => 50 * Math.pow(20000 / 50, k / (nL - 1))), am = fq.map((_, k) => 0.002 * (1 + (k % 5)));
      const rodar = (s: number) => { for (let k = 0; k < s * SR; k += 64) { L.limpar(); for (let i = 0; i < nL; i++) L.por(i, fq[i], am[i]); b.atualizar(L); b.processar(out, 0, 64); } };
      rodar(1);
      return { rodar };
    }
    if (caso === 'tunel') {
      const t: any = montarPortadorEletrico(cfg, SR, { N: 10, faces: 'duas' } as any);
      t.comandar({ pedal: 0.6, ignicao: true, velocidadeFixa: 120 / 3.6 });
      const d: any = new CenaDSP(SR); d.cru = true;
      d.message({ type: 'cena', amb: ambientePassagem('tunel'), traj: { tipo: 'reta', comprimento: 3000, raioCurva: 2000, lateral: 3, altitude: 0, sentido: 1 }, ouv: { modo: 'fixo', pos: [0, 0, 1.6], gimbal: { az: 90, el: 0, r: 5, alvo: 'corpo' }, local: 'fora', binaural: true } });
      d.montar(t); d.message({ type: 'params', posicao: -200 });
      const m = no(d);
      m.rodar(1);
      return { ...m, info: () => ({ fontes: t.fontes().length }) };
    }
    const m: any = new MotorEletrico(SR);
    m.configurar(cfg, SR);
    if (caso === 'motorCarga') { m.acoplar({ inercia: 50, torque: (w: number) => 0.002 * w * w }); m.comandar({ acelerador: 0.7, ignicao: true, partida: false, v: 20 }); }
    else m.comandar({ acelerador: 0.6, ignicao: true, partida: false, omegaImposta: (2500 * TAU) / 60 });
    const S = m.fontes.map(() => new Float32Array(B));
    const rodar = (s: number) => { for (let k = 0; k < s * SR; k += B) m.processar(S, B); };
    rodar(caso === 'motorCarga' ? 1 : 0.5);
    let nos = 0; for (const U of m.uni ?? []) for (const b of [U.bMotor, U.bInv, U.bRed, U.bVen]) nos += b ? b.Lmax : 0;
    return { rodar, info: () => ({ nos }) };
  },
};
// ------------------------------------------------------------------ servidor
let motor: Motor | null = null;
const responder = (m: any) => process.send!(m);
async function alocacao(s: number, amostrar: boolean) {
  let coletas = 0, msColetas = 0;
  // (só as coletas de verdade, a jovem e a completa, como as linhas do --trace-gc; os passos da marcação incremental e os
  // callbacks fracos também chegam como entradas de `gc`)
  const ob = new PerformanceObserver((l) => { for (const e of l.getEntries()) { const k = (e as any).detail?.kind; if (k === constants.NODE_PERFORMANCE_GC_MINOR || k === constants.NODE_PERFORMANCE_GC_MAJOR) { coletas++; msColetas += e.duration; } } });
  ob.observe({ entryTypes: ['gc'] });
  let sessao: Session | null = null;
  if (amostrar) {
    sessao = new Session(); sessao.connect();
    await sessao.post('HeapProfiler.enable');
    await sessao.post('HeapProfiler.startSampling', { samplingInterval: 16384, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  }
  const c0 = process.cpuUsage();
  motor!.rodar(s);
  const c = process.cpuUsage(c0);
  let bytes = 0;
  const sitios = new Map<string, number>();
  if (sessao) {
    const { profile } = await sessao.post('HeapProfiler.stopSampling');
    const soma = (n: any) => {
      bytes += n.selfSize;
      if (n.selfSize) { const k = `${n.callFrame.functionName || '(anônima)'}:${n.callFrame.lineNumber + 1}:${n.callFrame.columnNumber + 1}`; sitios.set(k, (sitios.get(k) || 0) + n.selfSize); }
      for (const f of n.children) soma(f);
    };
    soma(profile.head);
    sessao.disconnect();
  }
  await new Promise((r) => setTimeout(r, 50)); // (as entradas de coleta chegam depois do laço)
  ob.disconnect();
  return { bytes, coletas, msColetas, cpu: (c.user + c.system) / 1e6, rapidas: alvo ? rapido(alvo instanceof RotativosDSP ? alvo.rot : alvo) : true, sitios: [...sitios.entries()].sort((x, y) => y[1] - x[1]).slice(0, 20) };
}
if (process.send) {
  process.on('message', async (m: any) => {
    try {
      if (m.tipo === 'montar') {
        motor = CASOS[m.familia](m.caso, m.dados);
        responder({ info: motor.info?.() ?? {} });
      } else if (m.tipo === 'rodar') {
        const c0 = process.cpuUsage(); motor!.rodar(m.s); const c = process.cpuUsage(c0);
        responder({ cpu: (c.user + c.system) / 1e6, info: { ...(motor!.info?.() ?? {}), ...(alvo ? { rapidas: rapido(alvo instanceof RotativosDSP ? alvo.rot : alvo) } : {}) } });
      } else if (m.tipo === 'alocacao' || m.tipo === 'coletas') responder(await alocacao(m.s, m.tipo === 'alocacao'));
      else if (m.tipo === 'fim') process.exit(0);
    } catch (e: any) { responder({ erro: String(e?.stack || e) }); }
  });
}
