// Adaptador `Motor` do vapor para os portadores (Passagem, página vapor.html) e a sonda de nível absoluto
// (docs/VAPOR.md 4.6). O `VaporDSP` já implementa `Motor`: aqui ficam só a sonda e a classe que o worklet monta.
//
// Sonda (`prepararMotorVapor`, thread principal, guardada por preset): cada componente é levado a um `L_W` dB(A) re
// 1 pW numa condição de referência, renderizando um VaporDSP com só aquele componente soando:
//   chuff     regulador 1, corte 50%, p_cal nominal, 4 chuffs/s (ω imposto), sem o jato de choque    lwChuff do preset
//   soprador  regulador 0, parado, soprador ligado                                                      100
//   torneiras abertas, 2 voltas/s, regulador 0,5, corte 57%                                            123
//   vazamentos p_cal nominal                                                                            85 + 10·folga
//   bielas    folga 0,5, regulador 1, corte 60%, 1 volta/s                                              103
//   apito     válvula toda aberta, tubos quentes                                                        145 (navio 150, estacionária 135)
//   seguranca aberta                                                                                    140
//   bomba     carregando                                                                                104
//   injetor   ligado (depois do gorgolejo)                                                              94
//   sino      batendo                                                                                   113
//   queimador fogo 1                                                                                    95
//   engrenagens 4 chuffs/s, regulador 1, corte 50%                                                       100
//   correias  rotação governada                                                                         95
// Uma fonte com diretividade sobe no eixo pelo índice de diretividade (`fatorPotenciaDir`), como nos portadores.
// Fora da referência, tudo vem da física (corte, regulador, taxa).
import { VaporDSP, COMPONENTES, type IdComponente, type ConfigVapor } from './dsp';
import { type PresetVapor, escapesPorVolta } from './presets';
import { LW_VAPOR, REF_DIST_VAPOR } from './constantes';
import { PonderacaoA, fatorPotenciaDir } from '../../scene/filtros';
import { paDeLw } from '../../carriers/ruido';

const TAU = Math.PI * 2;

interface Condicao { canais: string[]; lw: number; dur: number; ini: number; montar: (d: VaporDSP) => void; preset?: Partial<PresetVapor> }

function condicoes(P: PresetVapor): Partial<Record<IdComponente, Condicao>> {
  const omegaChuffs = (f: number) => (f / escapesPorVolta(P)) * TAU;
  const omegaManivela = (rev: number) => (rev * TAU) / (P.reducao ?? 1);
  const lwApito = P.apito.nivelDb ?? (P.apito.tipo === 'navio' ? LW_VAPOR.apitoNavio : P.familia === 'estacionaria' ? LW_VAPOR.apitoEstacionaria : LW_VAPOR.apito);
  const c: Partial<Record<IdComponente, Condicao>> = {
    chuff: { canais: ['chamine'], lw: P.lwChuff, dur: 3, ini: 1.5, montar: (d) => { d.fixar({ regulador: 1, cutoff: (0.5 - 0.15) / 0.7 }); d.impor(omegaChuffs(4)); d.jato.gChoque = 0; d.pChest = d.pCal * 1e5 + 101325; } },
    soprador: { canais: ['chamine'], lw: LW_VAPOR.soprador, dur: 2.5, ini: 1, montar: (d) => { d.fixar({ regulador: 0 }); d.comandar({ acelerador: 0, ignicao: true, partida: false, soprador: true } as any); } },
    torneiras: { canais: ['cilindro.e'], lw: LW_VAPOR.torneiras, dur: 3, ini: 1.5, montar: (d) => { d.fixar({ regulador: 0.5, cutoff: (0.57 - 0.15) / 0.7 }); d.impor(omegaManivela(2)); d.comandar({ acelerador: 0, ignicao: true, partida: false, torneiras: true } as any); } },
    vazamentos: { canais: ['cilindro.e'], lw: 85 + 10 * P.folga, dur: 2, ini: 0.5, montar: () => {} },
    bielas: { canais: ['bielas.e'], lw: LW_VAPOR.bielas, dur: 4, ini: 1.5, preset: { folga: 0.5 }, montar: (d) => { d.fixar({ regulador: 1, cutoff: (0.6 - 0.15) / 0.7 }); d.impor(omegaManivela(1)); d.pChest = d.pCal * 1e5 + 101325; } },
    apito: { canais: ['apito'], lw: lwApito, dur: 2.5, ini: 1, montar: (d) => { d.apito.aq = 1; d.comandar({ acelerador: 0, ignicao: true, partida: false, apito: 1 } as any); } },
    seguranca: { canais: ['seguranca'], lw: LW_VAPOR.seguranca, dur: 2, ini: 0.6, montar: (d) => { d.seg.aberta = true; d.seg.controle = () => {}; } },
    bomba: { canais: ['bomba.ar', 'bomba.ar.0'], lw: LW_VAPOR.bombaAr, dur: 6, ini: 0.5, montar: (d) => { d.comandar({ acelerador: 0, ignicao: true, partida: false, bombaAr: true } as any); } },
    injetor: { canais: ['injetor'], lw: LW_VAPOR.injetor, dur: 5, ini: 3.2, montar: (d) => { d.comandar({ acelerador: 0, ignicao: true, partida: false, injetor: true } as any); } },
  };
  if (P.sino) c.sino = { canais: ['sino'], lw: LW_VAPOR.sino, dur: 4, ini: 1, montar: (d) => { d.comandar({ acelerador: 0, ignicao: true, partida: false, sino: true } as any); } };
  if (P.queimador) c.queimador = { canais: ['queimador'], lw: LW_VAPOR.queimador, dur: 1.5, ini: 0.5, montar: (d) => { d.comandar({ acelerador: 0, ignicao: true, partida: false, fogo: 1 } as any); } };
  if (P.engrenagens) c.engrenagens = { canais: ['engrenagens'], lw: LW_VAPOR.engrenagens, dur: 2.5, ini: 1, montar: (d) => { d.fixar({ regulador: 1, cutoff: 0.5 }); d.impor(omegaChuffs(4)); d.pChest = d.pCal * 1e5 + 101325; } };
  if (P.correias) c.correias = { canais: ['correias'], lw: LW_VAPOR.correias, dur: 2.5, ini: 1, montar: (d) => { d.impor(omegaManivela((P.rpmGovernado ?? 75) / 60)); } };
  return c;
}

/** RMS ponderado em A de um canal do DSP na condição dada (unidades internas) */
function medir(P: PresetVapor, id: IdComponente, cond: Condicao, fs: number) {
  const d = new VaporDSP(fs);
  d.configurar({ preset: { ...P, ...(cond.preset || {}), kCaldeira: 1e-12 }, ganhos: {} }, fs);
  for (const k of COMPONENTES) d.mascara[k] = k === id ? 1 : 0;
  d.comandar({ acelerador: 0, ignicao: true, partida: false, bombaAr: false, injetor: false, torneiras: false, soprador: false, sino: false, apito: 0 } as any);
  cond.montar(d);
  const ci = d.fontes.findIndex((f) => cond.canais.includes(f.id));
  if (ci < 0) return { rms: 0, ci };
  const B = 128, tmp = d.fontes.map(() => new Float32Array(B));
  const pa = new PonderacaoA(fs), buf = new Float64Array(B);
  let e = 0, n = 0;
  for (let i = 0; i < cond.dur * fs; i += B) {
    d.processar(tmp, B);
    for (let k = 0; k < B; k++) buf[k] = tmp[ci][k];
    pa.bloco(buf, B);
    if (i >= cond.ini * fs) { for (let k = 0; k < B; k++) e += buf[k] * buf[k]; n += B; }
  }
  return { rms: Math.sqrt(e / Math.max(1, n)), ci, d };
}

/** ganhos de cada componente (Pa a 7,5 m por unidade interna) para o preset; ~1 s de render em Node */
export function prepararMotorVapor(P: PresetVapor, fs: number): ConfigVapor {
  const ganhos: Partial<Record<IdComponente, number>> = {};
  const cs = condicoes(P);
  for (const id of COMPONENTES) {
    const cond = cs[id];
    if (!cond) continue;
    const { rms, ci, d } = medir(P, id, cond, fs);
    if (!d || ci < 0 || rms <= 0) continue;
    const dir = d.fontes[ci].dir.tabela;
    ganhos[id] = paDeLw(cond.lw, REF_DIST_VAPOR) / rms / Math.sqrt(fatorPotenciaDir(dir));
  }
  return { preset: P, ganhos };
}

/** o `VaporDSP` é o próprio adaptador; esta classe é a que o worklet da Cena monta (`montarMotor`) */
export class MotorVapor extends VaporDSP {}
