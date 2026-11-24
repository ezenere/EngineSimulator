// Alocação e tempo de CPU por família, como na página (tools/cpu-pagina.ts: um processo por caso, uma instância, a
// configuração calibrada por mensagem, o código empacotado pelo rolldown sem os nomes das funções). Para cada caso:
// o tempo de CPU em % do tempo real, os MB alocados por segundo de som (a amostragem do heap do V8, que estima o total),
// e as coletas de lixo por segundo e o tempo delas (no worklet, cada coleta é uma pausa dentro de um quantum de 2,67 ms).
//
//   npx tsx tools/cpu-alocacao.ts [diesel ronco radial rotativo vapor] [--todos] [--sitios] [--s 5] [--j 6]
//     --sitios: onde cada caso aloca (com ENGINE_CPU_MANTER=1 o pacote fica, para achar as linhas)
//     sem família: todas; sem --todos, os casos mais pesados de cada uma (a lista abaixo); --todos varre os presets
import os from 'node:os';
import { Filho, type Pedido } from './cpu-pagina';

const SR = 48000;
const args = process.argv.slice(2);
const opcao = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const S = +(opcao('--s') ?? 5), J = +(opcao('--j') ?? Math.max(1, Math.min(8, Math.floor(os.cpus().length / 4))));
const todos = args.includes('--todos'), sitios = args.includes('--sitios');
const fams = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--s' && args[i - 1] !== '--j');

type Caso = { familia: string; rotulo: string; pedido: () => Promise<Pedido> };
const FAMILIAS: Record<string, () => Promise<Caso[]>> = {
  diesel: async () => {
    const { configCalibrada } = await import('../src/engines/diesel/config');
    const { PRESETS, PADRAO_DIESEL } = await import('../src/engines/diesel/presets');
    const ids = todos ? PRESETS.map((p) => p.id) : ['emd710', 'ge7fdl', 'duramax66', 'scaniav8'];
    return ids.map((id) => {
      const spec: any = { ...PADRAO_DIESEL, ...PRESETS.find((p) => p.id === id)! }, loco = spec.portadores[0] === 'locomotiva';
      return { familia: 'diesel', rotulo: `${id} ${loco ? 'notch 8' : 'plena carga travada'}`, pedido: async () => ({ familia: 'diesel', caso: loco ? 'notch8' : 'plena', dados: { cfg: configCalibrada(spec, SR), spec } }) };
    });
  },
  ronco: async () => {
    const { configCalibrada } = await import('../src/engines/ronco/config');
    const { PRESETS_PAGINA, ACESSORIOS_PADRAO } = await import('../src/engines/ronco/presets');
    const ids = todos ? PRESETS_PAGINA.map((p: any) => p.id) : ['v16', 'f1v12', 'hellcat', 'muscle', 'fusca', 'r1', 'c172'];
    const casos: Caso[] = ids.map((id) => {
      const spec: any = { ...ACESSORIOS_PADRAO, ...PRESETS_PAGINA.find((p: any) => p.id === id)! }, rpm = Math.round(0.9 * (spec.redline || 6000));
      return { familia: 'ronco', rotulo: `${id} plena carga travada a ${rpm} rpm`, pedido: async () => ({ familia: 'ronco', caso: 'carga', dados: { cfg: configCalibrada(spec, SR), rpm } }) };
    });
    // (o V8 solto no corte de giro, em ponto morto e pé no fundo: a referência do cpu:vapor, e o caso que desotimizava o laço)
    const muscle: any = { ...ACESSORIOS_PADRAO, ...PRESETS_PAGINA.find((p: any) => p.id === 'muscle')! };
    casos.push({ familia: 'ronco', rotulo: 'muscle no corte (ponto morto, pé no fundo)', pedido: async () => ({ familia: 'ronco', caso: 'muscle', dados: { cfg: configCalibrada(muscle, SR) } }) });
    return casos;
  },
  radial: async () => {
    const { configCalibrada } = await import('../src/engines/radial/config');
    const { PRESETS_RADIAL, PADRAO_RADIAL } = await import('../src/engines/radial/presets');
    const ids = todos ? PRESETS_RADIAL.map((p: any) => p.id) : ['r4360', 'r2800turbo', 'trossi', 'r1340'];
    return ids.map((id) => {
      const spec: any = { ...PADRAO_RADIAL, ...PRESETS_RADIAL.find((p: any) => p.id === id)! };
      return { familia: 'radial', rotulo: `${id} subindo de giro`, pedido: async () => ({ familia: 'radial', caso: 'subida', dados: { cfg: configCalibrada(spec, SR), spec } }) };
    });
  },
  rotativo: async () => {
    const { configCalibrada } = await import('../src/engines/rotativo/config');
    const { PRESETS_ROTATIVO, PADRAO_ROTATIVO } = await import('../src/engines/rotativo/presets');
    const ids = todos ? PRESETS_ROTATIVO.filter((p: any) => p.tipo !== 'palhetas').map((p: any) => p.id) : ['r26b', 'rx7fd', 'cosmo20b'];
    return ids.flatMap((id) => {
      const spec: any = { ...PADRAO_ROTATIVO, ...PRESETS_ROTATIVO.find((p: any) => p.id === id)! };
      return (['carga', 'rev'] as const).map((c) => ({ familia: 'rotativo', rotulo: `${id} ${c === 'carga' ? 'plena carga a 70 %' : 'sustentado a 85 %'}`, pedido: async () => ({ familia: 'rotativo', caso: c, dados: { cfg: configCalibrada(spec, SR), spec } }) }));
    });
  },
  vapor: async () => {
    const { prepararMotorVapor } = await import('../src/engines/vapor/motor');
    const { PRESETS_VAPOR, presetVapor } = await import('../src/engines/vapor/presets');
    const ids = todos ? PRESETS_VAPOR.map((p: any) => p.id) : ['bigboy', 'up844', 'k4s'];
    return ids.flatMap((id) => (['marcha', 'tudo'] as const).filter((c) => todos || c === 'marcha' || id === 'bigboy').map((c) => ({
      familia: 'vapor', rotulo: `${id} a 10 chuffs/s${c === 'tudo' ? ' com apito, sino, bomba e torneiras' : ''}`, pedido: async () => ({ familia: 'vapor', caso: c, dados: { cfg: prepararMotorVapor(presetVapor(id)!, SR) } }),
    })));
  },
};

(async () => {
  const lista: Caso[] = [];
  for (const f of fams.length ? fams : Object.keys(FAMILIAS)) lista.push(...(await FAMILIAS[f]()));
  const res: any[] = new Array(lista.length);
  let lentas = 0;
  const fila = lista.map((c, i) => [c, i] as const);
  // (a calibração roda aqui, um caso de cada vez; os processos de medida, até J ao mesmo tempo: a alocação não depende
  // da carga da máquina, o tempo de CPU depende pouco nesta escala)
  await Promise.all(Array.from({ length: J }, async () => {
    while (fila.length) {
      const [c, i] = fila.shift()!;
      const f = await Filho.abrir(await c.pedido());
      try { const a = await f.alocacao(S); res[i] = { c, a }; } catch (e: any) { res[i] = { c, erro: String(e?.message || e) }; } finally { f.fechar(); }
    }
  }));
  console.log(`| família | caso | CPU (% do tempo real) | alocação (MB/s de som) | coletas/s | ms de coleta por s | propriedades |`);
  console.log(`|---|---|---:|---:|---:|---:|---|`);
  for (const r of res) {
    if (r.erro) { console.log(`| ${r.c.familia} | ${r.c.rotulo} | erro: ${r.erro.slice(0, 120)} | | | |`); continue; }
    const a = r.a;
    console.log(`| ${r.c.familia} | ${r.c.rotulo} | ${((100 * a.cpu) / S).toFixed(1)} | ${(a.bytes / S / 1e6).toFixed(1)} | ${(a.coletas / S).toFixed(1)} | ${(a.msColetas / S).toFixed(2)} | ${a.rapidas ? 'rápidas' : 'DICIONÁRIO'} |`);
    if (!a.rapidas) lentas++;
  }
  if (lentas) { console.log(`\n${lentas} caso(s) com o DSP no modo dicionário do V8 (propriedades lentas): veja quem cria propriedade com o motor rodando`); process.exitCode = 1; }
  if (sitios) for (const r of res) if (!r.erro) {
    console.log(`\n${r.c.familia} · ${r.c.rotulo}: onde aloca (MB/s; função:linha:coluna no pacote)`);
    for (const [k, b] of r.a.sitios) if (b / S > 0.05e6) console.log(`  ${(b / S / 1e6).toFixed(2).padStart(7)}  ${k}`);
  }
})().catch((e) => { console.error(e); process.exit(2); });
