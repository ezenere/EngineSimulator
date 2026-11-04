// Teste de "lenta" do vapor: todos os presets no portador de uso real (locomotiva, gerador, trator, carro, barco), com
// a caldeira de verdade (foguista automático) e o motor integrando a velocidade:
//   1. parado (regulador 0, 8 s): nenhum escape, nenhuma linha de chuff, a caldeira na pressão nominal;
//   2. arrancada (reverser 80%, regulador 0,3 → 0,8; trilho molhado nas locomotivas, 300 t atrás): anda, e a
//      locomotiva patina pelo menos uma vez ou passa dos 5 km/h; a estacionária fica no governador a ±5% da rotação;
//      o trator anda em 1ª; o Stanley e o barco aceleram;
//   3. cruzeiro com velocidade imposta (60% da máxima, corte 30%): chuffs/s = escapes por volta × voltas/s a ±2%;
//   4. drifting (regulador 0 na mesma velocidade): o canal da chaminé cai ≥ 12 dB (o bufo do ar bombeado; o Y6b, com
//      as BP de 39", fica em −14);
//   5. nenhum NaN em nenhum canal.
//
//   npx tsx tools/vapor-lenta.ts [ids...] [--j 8]
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PRESETS_VAPOR } from '../src/engines/vapor/presets';

const AQUI = fileURLToPath(import.meta.url);
type Resultado = { id: string; ok: boolean; texto: string };

async function umCaso(id: string): Promise<Resultado> {
  const { SR, TAU } = await import('./vapor-comum');
  const { presetVapor, escapesPorVolta } = await import('../src/engines/vapor/presets');
  const { MotorVapor, prepararMotorVapor } = await import('../src/engines/vapor/motor');
  const { montarPortadorVapor, configPortadorVapor } = await import('../src/carriers/portadores-vapor');
  const P = presetVapor(id)!;
  const tipo = P.portadores[0];
  const cfg = prepararMotorVapor(P, SR);
  const m = new MotorVapor(SR); m.configurar(cfg, SR);
  const conf = { ...configPortadorVapor(tipo, id, 0), ...(tipo === 'locomotiva' ? { vagoes: 0 } : {}) };
  const p: any = montarPortadorVapor(tipo, conf, m, SR)!;
  if (tipo === 'locomotiva') p.cargaT.definirMassa(P.massa + (P.tender?.massa ?? 0) + 300 - P.massa);
  const B = 128, can = p.fontes().map(() => new Float32Array(B)), ids: string[] = p.fontes().map((f: any) => f.id);
  const ich = ids.indexOf('chamine');
  let nan = false;
  const rodar = (seg: number, cada?: (t: number) => void) => {
    let e = 0, n = 0;
    for (let i = 0; i < seg * SR; i += B) {
      cada?.(i / SR);
      p.processar(can, B, 1 / SR);
      for (const c of can) for (let k = 0; k < B; k++) if (!Number.isFinite(c[k])) nan = true;
      for (let k = 0; k < B; k++) e += can[ich][k] * can[ich][k];
      n += B;
    }
    return 10 * Math.log10(e / Math.max(1, n) + 1e-30);
  };
  const cmd = (c: any) => p.comandar({ pedal: 0, ...c });
  const notas: string[] = [];
  let ok = true;
  const r = P.dRoda > 0 ? P.dRoda / 2 : 1;
  // 1. parado
  cmd({ regulador: 0, cutoff: 0.6, marcha: tipo === 'trator' ? 1 : undefined, cargaFracao: 0 });
  // (a estacionária no portador gerador está sempre no governador: não há "parado" do maquinista)
  if (P.familia !== 'estacionaria') {
    rodar(1);
    const esc0 = m.nEscapes;
    rodar(7);
    const escParado = m.nEscapes - esc0;
    const pOk = Math.abs(m.pCal - P.pNominal) < 1.0;
    notas.push(`parado: ${escParado} escapes, ${m.pCal.toFixed(1)} bar`);
    // (o barco sem atrito estático no casco escorrega meia volta enquanto a caixa esvazia: 1 escape)
    if (escParado > (P.familia === 'barco' ? 1 : 0) || !pOk) ok = false;
  }
  // 2. arrancada
  if (P.familia === 'estacionaria') {
    m.govLigado = true; m.rpmAlvo = P.rpmGovernado ?? 75;
    cmd({ cargaFracao: 0.5 });
    rodar(30);
    const rpm = (m.eixo.omega * 60) / TAU, erro = (100 * (rpm - (P.rpmGovernado ?? 75))) / (P.rpmGovernado ?? 75);
    notas.push(`governador: ${rpm.toFixed(1)} rpm (${erro >= 0 ? '+' : ''}${erro.toFixed(1)}%)`);
    if (Math.abs(erro) > 5) ok = false;
  } else {
    cmd({ trilho: 'molhado', cutoff: (0.8 - 0.15) / 0.7, regulador: 0.3, torneiras: 'auto', marcha: tipo === 'trator' ? 1 : undefined });
    let patinou = false;
    rodar(20, (t) => { if (t > 3 && t < 3.01) cmd({ regulador: 0.8 }); if (m.patinando) patinou = true; });
    const vk = Math.abs(p.cinematica.v) * 3.6;
    notas.push(`arrancada: ${vk.toFixed(1)} km/h em 20 s${patinou ? ', patinou' : ''}`);
    if (vk < (tipo === 'trator' ? 1 : 3)) ok = false;
    if (tipo === 'locomotiva' && !patinou && vk < 5) ok = false;
  }
  // 3. cruzeiro com velocidade imposta
  if (P.familia !== 'estacionaria') {
    const vKmh = 0.6 * P.vMax, vms = vKmh / 3.6;
    cmd({ regulador: 1, cutoff: (0.3 - 0.15) / 0.7, trilho: 'seco', velocidadeFixa: vms });
    m.fixar({ regulador: 1, cutoff: (0.3 - 0.15) / 0.7 });
    const lc = rodar(4);
    const wRoda = tipo === 'barco' ? vms / (0.75 * r) : vms / r;
    const esperado = (escapesPorVolta(P) * wRoda) / TAU, medido = m.chuffsPorS();
    notas.push(`cruzeiro ${vKmh.toFixed(0)} km/h: ${medido.toFixed(2)} chuffs/s (${esperado.toFixed(2)})`);
    if (Math.abs(medido / esperado - 1) > 0.02) ok = false;
    // 4. drifting
    cmd({ regulador: 0 }); m.fixar({ regulador: 0 });
    rodar(2);
    const ld = rodar(3);
    // (com condensador o escape já sai abafado em marcha: o critério é só nas máquinas que escapam pela chaminé)
    const condensa = P.escape.destino === 'condensador';
    notas.push(`drifting: chaminé ${(ld - lc).toFixed(1)} dB${condensa ? ' (condensador)' : ''}`);
    if (!condensa && ld - lc > -12) ok = false;
  }
  if (nan) { ok = false; notas.push('NaN'); }
  return { id, ok, texto: `${ok ? 'ok   ' : 'FALHA'} ${id.padEnd(13)} (${tipo}) · ${notas.join(' · ')}` };
}

const args = process.argv.slice(2);
if (args[0] === '--um') {
  umCaso(args[1]).then((r) => process.stdout.write(JSON.stringify(r))).catch((e) => process.stdout.write(JSON.stringify({ id: args[1], ok: false, texto: `FALHA ${args[1]} · ${String(e?.stack || e).slice(0, 300)}` })));
} else {
  const ji = args.indexOf('--j');
  const J = ji >= 0 ? +args[ji + 1] : Math.max(2, Math.floor(os.cpus().length * 0.6));
  const ids = args.filter((a, i) => !a.startsWith('--') && (ji < 0 || i !== ji + 1));
  const fila = ids.length ? ids : PRESETS_VAPOR.map((p) => p.id);
  const res: Resultado[] = [];
  const t0 = Date.now();
  const rodar = (id: string) => new Promise<Resultado>((ok) => {
    const p = spawn(process.execPath, ['--import', 'tsx', AQUI, '--um', id], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = ''; p.stdout.on('data', (b) => { out += b; });
    p.on('close', () => { try { ok(JSON.parse(out)); } catch { ok({ id, ok: false, texto: `FALHA ${id} · erro no render` }); } });
  });
  (async () => {
    const q = [...fila];
    await Promise.all(Array.from({ length: J }, async () => { while (q.length) { const r = await rodar(q.shift()!); res.push(r); console.log(r.texto); } }));
    const f = res.filter((r) => !r.ok).length;
    console.log(`\n${res.length} presets em ${((Date.now() - t0) / 1000).toFixed(0)} s: ${res.length - f} ok, ${f} falhas`);
    process.exitCode = f ? 1 : 0;
  })();
}
