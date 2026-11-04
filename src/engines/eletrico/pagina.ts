// DSP da página eletrico.html (ELETRICO.md 6, decisão: a página usa a Cena nova): o `CenaDSP` com o portador do preset
// (carro elétrico, trólebus, trem/metrô/bonde, bancada, drone) e o ouvinte do modo de testes. Roda no worklet
// (src/worklet/processador-eletrico.ts, `eletrico-engine`) e, de reserva, na thread principal.
//
// Mensagens (além das do CenaDSP: 'cena', 'params', 'ar'):
//   { type: 'preset', cfg, trem?, pneusAero? }   monta o portador do preset com o motor já calibrado na página (`cfg` de
//                                                 prepararMotorEletrico: kAbs por fonte); a velocidade continua
//   { type: 'input', acelerador?, freio?, ignicao? }
//   { type: 'eletrico', modulacao?, avas?, cargaFracao?, inclinacao?, massaExtra?, velocidadeImposta? (m/s | null), re? }
// Telemetria: a do CenaDSP (a cada 1024 amostras), com a do portador trazendo a do motor (rpm, torque, potencia, corrente,
// fE, fC, N, modo, M, fluxo, nota, notaNome, linhas…).
import { CenaDSP } from '../../scene/dsp-cena';
import type { ConfigTrem } from '../../carriers/trem';
import { Trem } from '../../carriers/trem';
import { CarroEletrico } from '../../carriers/carro-eletrico';
import { montarPortadorEletrico } from './portador';
import type { CfgEletrico } from './motor';

export class DSPEletricoPagina extends CenaDSP {
  cmd: Record<string, unknown> = { pedal: 0, freio: 0, ignicao: false };
  carga = { inclinacao: 0, massaExtra: 0 };
  message(m: any) {
    if (!m) return;
    if (m.type === 'preset') {
      const cfg = m.cfg as CfgEletrico;
      const vAnt = this.portador ? this.portador.cinematica.v : 0;
      const p = montarPortadorEletrico(cfg, this.fs, (m.trem || {}) as Partial<ConfigTrem>, undefined, { pneusAero: m.pneusAero !== false });
      this.montar(p);
      p.comandar({ pedal: 0, ...this.cmd });
      // a velocidade imposta continua; sem ela, o portador começa parado
      if (this.cmd.velocidadeFixa == null) { (p.cinematica as { v: number }).v = 0; void vAnt; }
      this.aplicarCarga();
      return;
    }
    if (m.type === 'input') {
      if (typeof m.acelerador === 'number') this.cmd.pedal = m.acelerador;
      if (typeof m.freio === 'number') this.cmd.freio = m.freio;
      if (typeof m.ignicao === 'boolean') this.cmd.ignicao = m.ignicao;
      this.portador?.comandar({ pedal: this.cmd.pedal as number, freio: this.cmd.freio as number, ignicao: this.cmd.ignicao as boolean });
      return;
    }
    if (m.type === 'eletrico') {
      const c: Record<string, unknown> = {};
      if (m.modulacao !== undefined) c.modulacao = m.modulacao;
      if (m.avas !== undefined) c.avas = m.avas;
      if (m.cargaFracao !== undefined) c.cargaFracao = m.cargaFracao;
      if (m.velocidadeImposta !== undefined) c.velocidadeFixa = m.velocidadeImposta;
      if (m.re !== undefined) c.marcha = m.re ? -1 : 1;
      if (typeof m.inclinacao === 'number') this.carga.inclinacao = m.inclinacao;
      if (typeof m.massaExtra === 'number') this.carga.massaExtra = m.massaExtra;
      Object.assign(this.cmd, c);
      this.portador?.comandar({ pedal: this.cmd.pedal as number, ...c });
      this.aplicarCarga();
      return;
    }
    super.message(m);
  }
  private aplicarCarga() {
    const p = this.portador;
    if (p instanceof CarroEletrico) p.definirCarga(this.carga.inclinacao, this.carga.massaExtra);
    else if (p instanceof Trem && p.tracao) p.tracao.definirCarga(this.carga.inclinacao, this.carga.massaExtra);
  }
}
