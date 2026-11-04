// "Lenta" do Elétrico: todos os presets no portador deles, em quatro estados (parado ligado, arrancada, cruzeiro e
// regeneração; na bancada: parado, gatilho, carga e solto; no drone: pairado, subindo, descendo), conferindo que nada vira
// NaN, que o motor faz o que o estado pede (anda, segura, freia) e que a soma das fontes a 7,5 m não passa de −1 dBFS.
//
//   npx tsx tools/eletrico/lenta.ts [ids...]
import { PRESETS_ELETRICO } from '../../src/engines/eletrico/presets';
import { cfg, SR } from './comum';
import { montarPortadorEletrico } from '../../src/engines/eletrico/portador';
import { PA_FS } from '../../src/scene/constantes';
import type { Portador, ComandoPortador } from '../../src/carriers/tipos';

const ids = process.argv.slice(2);
const lista = ids.length ? PRESETS_ELETRICO.filter((p) => ids.includes(p.id)) : PRESETS_ELETRICO;
let falhas = 0;
const f1 = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

function rodar(p: Portador, dur: number, cmd: Partial<ComandoPortador> & Record<string, unknown>) {
  p.comandar({ pedal: 0, ...cmd } as ComandoPortador);
  const B = 128, S = p.fontes().map(() => new Float32Array(B));
  let nan = 0, pk = 0;
  for (let k = 0; k < dur * SR; k += B) {
    p.processar(S, B, 1 / SR);
    for (let j = 0; j < B; j++) { let s = 0; for (const c of S) s += c[j]; if (!Number.isFinite(s)) nan++; else if (Math.abs(s) > pk) pk = Math.abs(s); }
  }
  const t = p.telemetria() as Record<string, number>;
  return { nan, pk, v: p.cinematica.v, rpm: t.rpm ?? 0, T: t.torque ?? 0 };
}

for (const pr of lista) {
  const c = cfg(pr.id), tipo = pr.portador.tipo;
  const p = montarPortadorEletrico(c, SR, { faces: 'duas' });
  const linhas: string[] = [];
  let ok = true;
  const confere = (cond: boolean, msg: string) => { if (!cond) ok = false; linhas.push(`${cond ? '' : '!'}${msg}`); };
  const lim = PA_FS * Math.pow(10, -1 / 20);
  const ver = (nome: string, r: ReturnType<typeof rodar>) => { confere(r.nan === 0, `${nome}: NaN ${r.nan}`); confere(r.pk < lim, `${nome}: pico ${f1(20 * Math.log10(r.pk / PA_FS))} dBFS`); };
  if (tipo === 'carro' || tipo === 'trem') {
    const r0 = rodar(p, 2, { ignicao: true, velocidadeFixa: 0 });
    ver('parado', r0);
    const r1 = rodar(p, tipo === 'trem' ? 12 : 5, { pedal: 1, velocidadeFixa: null });
    ver('arrancada', r1); confere(r1.v > 2, `arrancada: v ${f1(r1.v * 3.6)} km/h`);
    const vc = Math.min((pr.vMaxKmh ?? 100) * 0.6, tipo === 'trem' ? 80 : 80) / 3.6;
    const r2 = rodar(p, 3, { pedal: 0.3, velocidadeFixa: vc });
    ver('cruzeiro', r2); confere(Math.abs(r2.v - vc) < 0.1, `cruzeiro: v ${f1(r2.v * 3.6)} km/h, ${f1(r2.rpm, 0)} rpm`);
    const r3 = rodar(p, 3, { pedal: 0, freio: 1, velocidadeFixa: null });
    ver('regeneração', r3); confere(r3.v < vc && r3.T < 0, `regeneração: v ${f1(r3.v * 3.6)} km/h, T ${f1(r3.T, 0)} N·m`);
  } else if (tipo === 'bancada') {
    ver('parado', rodar(p, 1, { ignicao: true, pedal: 0, cargaFracao: 0 }));
    const r1 = rodar(p, 2, { pedal: 1, cargaFracao: 0 }); ver('gatilho', r1); confere(r1.rpm > 0.8 * pr.rpmBase, `gatilho: ${f1(r1.rpm, 0)} rpm`);
    const r2 = rodar(p, 2, { pedal: 1, cargaFracao: 1 }); ver('carga', r2); confere(r2.rpm < r1.rpm, `carga: ${f1(r2.rpm, 0)} rpm`);
    const r3 = rodar(p, 2, { pedal: 0, cargaFracao: 0 }); ver('solto', r3); confere(r3.rpm < r2.rpm || pr.inversor === null && pr.maquina === 'inducao', `solto: ${f1(r3.rpm, 0)} rpm`);
  } else {
    const r0 = rodar(p, 3, { ignicao: true, pedal: 0.5 }); ver('pairado', r0); confere(Math.abs(r0.rpm / pr.rpmBase - 1) < 0.03, `pairado: ${f1(r0.rpm, 0)} rpm`);
    const r1 = rodar(p, 2, { pedal: 0.8 }); ver('subindo', r1); confere(r1.rpm > r0.rpm, `subindo: ${f1(r1.rpm, 0)} rpm`);
    const r2 = rodar(p, 2, { pedal: 0.3 }); ver('descendo', r2); confere(r2.rpm < r0.rpm, `descendo: ${f1(r2.rpm, 0)} rpm`);
  }
  if (!ok) falhas++;
  console.log(`${ok ? 'ok   ' : 'FALHA'} ${pr.id.padEnd(15)} ${linhas.join(' · ')}`);
}
console.log(`\n${lista.length - falhas}/${lista.length} presets ok`);
process.exit(falhas ? 1 : 0);
