// Teste de lenta do Diesel (DIESEL.md 8, como o idletest do Ronco): todos os presets a 20 °C e a −5 °C, partida de
// verdade (velas, motor de partida), 20 s em lenta com duas aceleradas (pé no fundo aos 8 s por 0,6 s, meio pé aos
// 13 s por 0,3 s; locomotiva: notch 4 por 2 s; gerador: degrau de 50% por 3 s). Falha se apagar, se não pegar, se
// der NaN ou se a rotação média dos 2 s finais sair de ±3% do alvo (o alvo é o do próprio governador: a lenta fria do
// eletrônico, 1800 rpm no gerador). Nos governadores mecânicos (todas-as-rotações) a −5 °C a tolerância é ±8%: a
// lenta cai pelo droop com o atrito do óleo frio e o motorista puxaria o acelerador manual (DIESEL.md 2.8).
//
//   npx tsx tools/diesel-lenta.ts [ids] [--j 12]
import os from 'node:os';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESETS } from '../src/engines/diesel/presets';
import { renderizar, preset, media, type Cenario } from './diesel-comum';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function lenta(id: string, T: number) {
  const spec = preset(id);
  const port = spec.portadores.includes('carro') ? 'carro' : spec.portadores[0];
  const cen: Cenario = {
    eventos: [
      [0, (d) => { d.ambientT = T; d.message({ type: 'input', temp: { mode: 'real', value: T } }); d.message({ type: 'input', ignition: true }); }],
      [8, (d) => port === 'locomotiva' ? d.message({ type: 'diesel', notch: 4 }) : port === 'gerador' ? d.message({ type: 'diesel', degrau: 0.5 }) : d.message({ type: 'input', throttle: 1 })],
      [8.6, (d) => { if (port === 'carro') d.message({ type: 'input', throttle: 0 }); }],
      [10, (d) => { if (port === 'locomotiva') d.message({ type: 'diesel', notch: 0 }); }],
      [11, (d) => { if (port === 'gerador') d.message({ type: 'diesel', degrau: 0 }); }],
      [13, (d) => { if (port === 'carro') d.message({ type: 'input', throttle: 0.5 }); }],
      [13.3, (d) => { if (port === 'carro') d.message({ type: 'input', throttle: 0 }); }],
      [20, null],
    ],
    portador: port,
  };
  const r = renderizar(spec, cen, { tele: 1024 });
  const tl = r.tele;
  const pegou = tl.find((e) => e.state === 'run');
  const apagou = pegou ? tl.some((e) => e.t > pegou.t && e.state === 'off') : false;
  const fim = tl.filter((e) => e.t >= 18);
  const rpm = media(fim.map((e) => e.rpm)), alvo = media(fim.map((e) => e.rpmAlvo || r.d.idleTarget));
  const mecanico = spec.governador === 'todas-as-rotacoes' && port === 'carro';
  // (o alvo do mecânico é a mola de lenta: a lenta da ficha)
  const ref = mecanico ? spec.idle : alvo;
  const tol = mecanico && T < 10 ? 0.08 : 0.03;
  const erro = (rpm - ref) / ref;
  const pico = Math.max(...tl.filter((e) => e.t > 8 && e.t < 11).map((e) => e.rpm));
  const ok = !!pegou && !apagou && !r.nan && Math.abs(erro) <= tol;
  return { id, T, ok, pegou: pegou ? +pegou.t.toFixed(2) : null, apagou, nan: r.nan, rpm: Math.round(rpm), alvo: Math.round(ref), erro: +(erro * 100).toFixed(1), tol: tol * 100, pico: Math.round(pico), port };
}

// ---- CLI: um processo por caso, em paralelo
const args = process.argv.slice(2);
if (args[0] === '--um') {
  console.log(JSON.stringify(lenta(args[1], +args[2])));
} else if (process.argv[1] && process.argv[1].endsWith('diesel-lenta.ts')) {
  const ji = args.indexOf('--j');
  const J = ji >= 0 ? +args[ji + 1] : Math.max(2, Math.floor(os.cpus().length * 0.75));
  const ids = args[0] && !args[0].startsWith('--') ? args[0].split(',') : PRESETS.map((p) => p.id);
  const casos = ids.flatMap((id) => [20, -5].map((T) => [id, T] as [string, number]));
  const tsx = path.join(RAIZ, 'node_modules', '.bin', 'tsx');
  const res: any[] = [];
  const fila = casos.slice();
  const rodar = () => new Promise<void>((ok) => {
    const c = fila.shift(); if (!c) return ok();
    const p = spawn(tsx, [path.join(RAIZ, 'tools/diesel-lenta.ts'), '--um', c[0], String(c[1])], { cwd: RAIZ });
    let s = ''; p.stdout.on('data', (d) => (s += d)); p.stderr.on('data', (d) => (s += d));
    p.on('close', () => { try { res.push(JSON.parse(s.trim().split('\n').pop()!)); } catch { res.push({ id: c[0], T: c[1], ok: false, erroExec: s.slice(-400) }); } rodar().then(ok); });
  });
  (async () => {
    await Promise.all(Array.from({ length: J }, rodar));
    res.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id) || b.T - a.T);
    console.log('| preset | T | pegou (s) | apagou | NaN | rpm final | alvo | erro | tol. | pico acelerando | |\n|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of res) console.log(r.erroExec ? `| ${r.id} | ${r.T} | ERRO ${r.erroExec.replace(/\n/g, ' ')} |` : `| ${r.id} | ${r.T} °C | ${r.pegou ?? 'não pegou'} | ${r.apagou ? 'SIM' : 'não'} | ${r.nan ? 'SIM' : 'não'} | ${r.rpm} | ${r.alvo} | ${r.erro}% | ±${r.tol}% | ${r.pico} | ${r.ok ? 'ok' : 'FALHA'} |`);
    const falhas = res.filter((r) => !r.ok).length;
    console.log(falhas ? `${falhas} falha(s) em ${res.length}` : `LENTA OK: ${res.length} casos, zero apagamentos`);
    process.exit(falhas ? 1 : 0);
  })();
}
