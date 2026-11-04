// DSP da Cena para o AudioWorklet (contrato de src/worklet/tipos.ts): portador + cena, 4 canais
// (0–1 direto binaural, 2–3 envio para o ConvolverNode do ambiente). A escala é absoluta
// (0 dBFS ≙ 124 dB SPL); por cima vão o `master` do usuário e o `tanh` como limitador suave.
//
// Mensagens:
//   { type: 'portador', tipo, config?, motor? }                       monta o portador (aloca): 'trem' e 'rotor' sem
//        motor; 'carro' (CarroLegado + Ronco ou Diesel), 'helice' (turboélice), 'gerador' e 'locomotiva' (Diesel),
//        'aviao' (jato), 'rotor' com motor (pistão de aviação do Ronco, radial do S-55), 'helice' com radial ou pistão de
//        aviação. `motor` = { familia, cfg }: o cfg do preset já calibrado na thread principal
//        (prepararMotorRonco / prepararMotorDiesel / prepararMotorRadial; o da Turbina é o preset cru)
//   { type: 'cena', amb?, traj?, ouv? }                                configura/atualiza (rampas de 20 ms)
//   { type: 'comando', ...ComandoPortador }                            velocidade fixa etc.
//   { type: 'params', master?, posicao? }                              master e posição s do corpo
//   { type: 'ar', ur?, temperatura? }                                  umidade (%) e temperatura (°C) do ar
// `posicao` põe o corpo em s e recomeça o histórico (a passagem "disparada" pela página).
// Telemetria a cada 1024 amostras: { type: 'telemetria', cena: TelemetriaCena, portador: TelemetriaPortador,
// pressao: { max, min, nariz, tunel } (extremos desde a última telemetria e as parcelas), lado }.
import type { DSPDeAudio } from '../worklet/tipos';
import type { Portador } from '../carriers/tipos';
import type { Ambiente, Trajetoria, Ouvinte } from './tipos';
import { CenaPassagem } from './cena';
import { Trem } from '../carriers/trem';
import { Rotor } from '../carriers/rotor';
import { CarroLegado } from '../carriers/carro';
import { Helice } from '../carriers/helice';
import { Gerador } from '../carriers/gerador';
import { Locomotiva } from '../carriers/locomotiva';
import { Aviao } from '../carriers/aviao';
import { MotorRonco } from '../engines/ronco/motor';
import { MotorDiesel } from '../engines/diesel/motor';
import { MotorTurbina } from '../engines/turbina/motor';
import { MotorRadial } from '../engines/radial/motor';
import { MotorRotativo } from '../engines/rotativo/motor';
import type { Motor } from '../carriers/tipos';
// Elétrico (etapa 6): motor, carro elétrico, trem com motor, bancada e drone
import { MotorEletrico } from '../engines/eletrico/motor';
import { montarMotorEletrico, montarPortadorEletrico } from '../engines/eletrico/portador';
// (vapor, etapa 5)
import { MotorVapor } from '../engines/vapor/motor';
import { montarPortadorVapor } from '../carriers/portadores-vapor';

/** monta o motor de uma mensagem `portador` (fora do laço: aloca) */
export function montarMotor(m: { familia: string; cfg: Record<string, any> } | undefined, fs: number): Motor | null {
  if (!m) return null;
  if (m.familia === 'pistao') { const x = new MotorRonco(fs); x.configurar(m.cfg, fs); return x; }
  if (m.familia === 'diesel') { const x = new MotorDiesel(fs); x.configurar(m.cfg, fs); return x; }
  if (m.familia === 'turboelice' || m.familia === 'turbina') { const x = new MotorTurbina(fs); x.configurar(m.cfg, fs); return x; }
  if (m.familia === 'radial') { const x = new MotorRadial(fs); x.configurar(m.cfg, fs); return x; }
  if (m.familia === 'rotativo') { const x = new MotorRotativo(fs); x.configurar(m.cfg, fs); return x; }
  if (m.familia === 'eletrico') return montarMotorEletrico(m.cfg as never, fs);
  if (m.familia === 'vapor') { const x = new MotorVapor(fs); x.configurar(m.cfg, fs); return x; }
  return null;
}

/** portador com motor de uma mensagem `portador` (a página monta o mesmo na thread principal, para a geometria) */
export function montarPortadorComMotor(tipo: string, config: Record<string, any> | undefined, motor: Motor | null, fs: number): Portador | null {
  const c = config || {};
  // elétrico: o portador vem do preset (carro elétrico, trólebus, trem, bancada, drone)
  if (motor instanceof MotorEletrico) return montarPortadorEletrico(motor.cfg, fs, c, motor);
  if (motor?.familia === 'vapor') return montarPortadorVapor(tipo, c, motor, fs);
  let p: Portador | null = null;
  if (tipo === 'carro') p = new CarroLegado();
  else if (tipo === 'helice') p = new Helice(fs, c);
  else if (tipo === 'gerador') p = new Gerador(fs, c);
  else if (tipo === 'locomotiva') p = new Locomotiva(fs, c);
  else if (tipo === 'aviao') p = new Aviao();
  else if (tipo === 'rotor') p = new Rotor(fs, c);
  if (!p) return null;
  p.acoplar(motor);
  return p;
}
import { ambientePassagem } from './ambientes';

export const OUVINTE_PADRAO: Ouvinte = { modo: 'fixo', pos: [0, 0, 1.6], gimbal: { az: 90, el: 0, r: 5, alvo: 'corpo' }, local: 'fora', binaural: true };
export const TRAJ_TREM: Trajetoria = { tipo: 'reta', comprimento: 3000, raioCurva: 2000, lateral: 3, altitude: 0, sentido: 1 };

export class CenaDSP implements DSPDeAudio {
  fs: number;
  cena = new CenaPassagem();
  portador: Portador | null = null;
  canais: Float32Array[] = [];
  master = 0.8;
  post: ((m: any) => void) | null = null;
  nTele = 0;
  amb: Ambiente; traj: Trajetoria; ouv: Ouvinte;
  sL = new Float32Array(4096); sR = new Float32Array(4096);
  /** escreve sem tanh nem master (validação offline mede a pressão de verdade) */
  cru = false;
  pressao = { max: 0, min: 0, nariz: 0, tunel: 0 };

  constructor(fs: number) {
    this.fs = fs;
    this.amb = ambientePassagem('tunel'); this.traj = TRAJ_TREM; this.ouv = OUVINTE_PADRAO;
    this.cena.configurar(this.amb, this.traj, this.ouv, fs);
  }

  montar(p: Portador) {
    // a posição e a velocidade continuam as do portador anterior (trocar um parâmetro do trem não
    // recomeça a passagem)
    const ant = this.portador?.cinematica;
    if (ant) { const c = p.cinematica as { s: number; v: number }; c.s = ant.s; c.v = ant.v; }
    this.portador = p;
    this.canais = p.fontes().map(() => new Float32Array(4096));
  }

  message(m: any) {
    if (!m) return;
    if (m.type === 'portador') {
      if (m.tipo === 'trem') {
        const ladoOuvinte = (this.traj.sentido === 1 ? -1 : 1) as 1 | -1;
        const vf = this.portador ? this.portador.cinematica.v : null;
        const motor = montarMotor(m.motor, this.fs);
        this.montar(motor ? montarPortadorComMotor('trem', { ladoOuvinte, ...(m.config || {}) }, motor, this.fs)! : new Trem(this.fs, { ladoOuvinte, ...(m.config || {}) }));
        if (motor) this.portador!.comandar({ pedal: 0, ignicao: true, ...(m.comando || {}) });
        if (vf != null) this.portador!.comandar({ pedal: 0, velocidadeFixa: vf });
      } else if (m.tipo === 'rotor' && !m.motor) {
        // helicóptero sem motor (compatibilidade "nenhum × rotor"): Nr imposto, coletivo pelo pedal
        const vf = this.portador ? this.portador.cinematica.v : null;
        this.montar(new Rotor(this.fs, m.config || {}));
        if (vf != null) this.portador!.comandar({ pedal: 0.75, velocidadeFixa: vf });
      } else {
        const p = montarPortadorComMotor(m.tipo, m.config, montarMotor(m.motor, this.fs), this.fs);
        if (p) {
          const vf = this.portador ? this.portador.cinematica.v : null;
          this.montar(p);
          p.comandar({ pedal: 0, ignicao: true, ...(m.comando || {}), ...(vf != null ? { velocidadeFixa: vf } : {}) });
        }
      }
    } else if (m.type === 'cena') {
      if (m.amb) this.amb = m.amb; if (m.traj) this.traj = m.traj; if (m.ouv) this.ouv = m.ouv;
      this.cena.atualizar({ amb: m.amb, traj: m.traj, ouv: m.ouv });
    } else if (m.type === 'comando') {
      this.portador?.comandar(m);
    } else if (m.type === 'params') {
      if (typeof m.master === 'number') this.master = m.master;
      if (typeof m.posicao === 'number' && this.portador) this.cena.reposicionar(this.portador, m.posicao);
    } else if (m.type === 'ar') {
      if (typeof m.ur === 'number') this.cena.definirUmidade(m.ur);
      if (typeof m.temperatura === 'number') this.cena.definirTemperatura(m.temperatura);
    }
  }

  process(outL: Float32Array, outR: Float32Array, n: number, sendL?: Float32Array, sendR?: Float32Array) {
    if (!this.portador) { outL.fill(0, 0, n); outR.fill(0, 0, n); sendL?.fill(0, 0, n); sendR?.fill(0, 0, n); return; }
    const p = this.portador;
    // trem com as duas faces: a camada limite toca na face voltada ao ouvinte
    if (p instanceof Trem) p.definirLado(this.cena.ladoDoOuvinte());
    p.processar(this.canais, n, 1 / this.fs);
    const sl = sendL ?? this.sL, sr = sendR ?? this.sR;
    this.cena.processar(p, this.canais, outL, outR, sl, sr, n);
    if (!this.cru) {
      const g = this.master;
      for (let k = 0; k < n; k++) { outL[k] = Math.tanh(outL[k] * g); outR[k] = Math.tanh(outR[k] * g); sl[k] *= g; sr[k] *= g; }
    }
    this.nTele += n;
    if (this.post && this.nTele >= 1024) {
      this.nTele = 0;
      this.post({ type: 'telemetria', cena: this.cena.telemetria(), portador: p.telemetria(), pressao: this.cena.lerPressao(this.pressao), lado: this.cena.ladoOuvinte });
    }
  }
}
