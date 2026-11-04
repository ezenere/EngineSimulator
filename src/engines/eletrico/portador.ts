// Montagem do portador de um preset elétrico (ELETRICO.md 4.3): carro elétrico (ou trólebus), trem/metrô/bonde, bancada
// ou multirrotor, com o motor (e o 2º motor do Tesla AWD) acoplado. Usado pela Cena (src/scene/dsp-cena.ts), pela página
// eletrico.html e pelas ferramentas (tools/eletrico/).
import type { Portador } from '../../carriers/tipos';
import { CarroEletrico } from '../../carriers/carro-eletrico';
import { Trem, type ConfigTrem } from '../../carriers/trem';
import { PortadorBancada, CargaBancada } from '../../carriers/teste';
import { Multirrotor } from '../../carriers/multirrotor';
import { MotorEletrico, type CfgEletrico } from './motor';
import { TAU } from './constantes';

export function montarMotorEletrico(cfg: CfgEletrico, fs: number) { const m = new MotorEletrico(fs); m.configurar(cfg, fs); return m; }

/** quantas fontes o motor pede no trem (para a reserva do orçamento: o aero dos truques sai antes) */
export function reservaTrem(cfg: CfgEletrico, N: number) {
  const pt = cfg.portador.tipo === 'trem' ? cfg.portador : null;
  if (!pt) return 0;
  const carros = pt.carrosMotores.filter((c) => c >= 1 && c <= N).length;
  return carros * 4 + 1;
}

/**
 * Portador do preset, com o motor. `tremBase` (a configuração do trem da página ou da Passagem) é a base sobre a qual entra
 * a do preset; `carga` muda o tipo de portador só na bancada (a página escolhe pelo preset).
 */
export function montarPortadorEletrico(cfg: CfgEletrico, fs: number, tremBase: Partial<ConfigTrem> = {}, motor?: MotorEletrico): Portador {
  const m = motor ?? montarMotorEletrico(cfg, fs);
  const pt = cfg.portador;
  if (pt.tipo === 'carro') {
    const c = new CarroEletrico(fs, { massa: pt.massa, CdA: pt.CdA, Crr: pt.Crr, rw: pt.rw, corpo: pt.corpo, pneus: pt.pneus, trole: pt.trole });
    c.acoplar(m);
    if (cfg.segundo) c.acoplarSegundo(montarMotorEletrico(cfg.segundo, fs));
    return c;
  }
  if (pt.tipo === 'trem') {
    const base: Partial<ConfigTrem> = { ...tremBase, ...(pt.config as Partial<ConfigTrem>) };
    const N = base.N ?? 10;
    const t = new Trem(fs, { ...base, reservaFontes: base.reservaFontes ?? reservaTrem(cfg, N) });
    t.acoplar(m);
    return t;
  }
  if (pt.tipo === 'bancada') {
    const wRef = ((pt.rpmRef ?? cfg.rpmBase) * TAU) / 60;
    const b = new PortadorBancada(new CargaBancada(pt.carga, pt.Tcarga, pt.inercia, wRef));
    b.acoplar(m);
    return b;
  }
  const d = new Multirrotor({ massa: pt.massa, cQ: pt.cQ });
  d.acoplar(m);
  return d;
}
