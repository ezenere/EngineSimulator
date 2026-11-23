// O observador da Passagem: uma pessoa no lugar. A câmera é o olho dele e o ouvinte da Cena é o ouvido (5 cm abaixo do
// olho), com a cabeça para onde ele olha. Sem three.js: roda sem WebGL (a página continua tocando e andando) e no Node.
//
// Três modos:
//   a pé       olho a OLHO do chão do lugar (plataforma, tabuleiro, talude), anda a ANDAR m/s e corre a CORRER;
//   voo        sobe e desce livre (VOAR m/s, VOAR_RAPIDO com Shift; SUBIR na vertical);
//   embarcado  o olho num ponto do corpo (o assento, ou junto dele, por fora), andando com o veículo; olha livre e se
//              mexe devagar no referencial do corpo. Desembarcar volta ao último ponto a pé (ou de voo).
// A velocidade sobe e desce com a constante TAU_VEL (o passo nunca começa nem para num degrau: o atraso de cada fonte
// muda sem quina, e a Cena tira o Doppler de quem anda daí).
import type { Lugar } from './lugar';

export type ModoObservador = 'pe' | 'voo' | 'embarcado';
export type V3 = [number, number, number];

/** m: altura do olho de quem está em pé; o ouvido fica OUVIDO_ABAIXO mais embaixo */
export const OLHO = 1.65;
export const OUVIDO_ABAIXO = 0.05;
/** m/s: andando, correndo; voando, voando com Shift, subindo; embarcado (dentro do veículo) */
export const ANDAR = 1.5, CORRER = 6, VOAR = 10, VOAR_RAPIDO = 45, SUBIR = 8, SUBIR_RAPIDO = 30, ANDAR_DENTRO = 1;
/** s: constante de tempo da velocidade (sair do repouso e parar) */
export const TAU_VEL = 0.12;
/** rad: a cabeça não passa disto para cima nem para baixo */
export const ARFAGEM_MAX = (85 * Math.PI) / 180;

/** o que as teclas, o mouse e o toque pedem: frente e lado em −1..1, subir em −1..1, correr */
export interface Entrada { frente: number; lado: number; sobe: number; correr: boolean }

/** para onde o observador vai num teletransporte (ponto de vista, ponto de chegada, embarcar) */
export interface Destino {
  modo: ModoObservador;
  /** olho: no mundo (pe, voo) ou no referencial do corpo (embarcado) */
  pos: V3;
  /** rad: no mundo, ou em relação à frente do corpo (embarcado) */
  rumo: number;
  arfagem: number;
  /** filtro do local da Cena neste ponto (padrão 'auto'), e a fonte alvo dele (a ponteira) */
  local?: 'auto' | 'fora' | 'cabine' | 'cofre' | 'ponteira';
  alvo?: string;
  /** embarcado: caixa onde o olho pode andar (no corpo); sem ela, anda livre junto do corpo */
  caixa?: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };
  /** o nome do ponto, para a leitura "onde estou" */
  nome?: string;
}

export class Observador {
  modo: ModoObservador = 'pe';
  pos: V3 = [0, -4.7, OLHO];
  vel: V3 = [0, 0, 0];
  rumo = Math.PI;
  arfagem = 0;
  /** contador de saltos (vai para a Cena: ela abaixa o som e salta, sem varrer o caminho) */
  salto = 0;
  local: NonNullable<Destino['local']> = 'auto';
  alvo = 'corpo';
  caixa: Destino['caixa'] = undefined;
  nome = '';
  entrada: Entrada = { frente: 0, lado: 0, sobe: 0, correr: false };
  /** o último ponto fora do veículo, para onde desembarcar volta */
  volta: Destino | null = null;
  /** algo mudou desde a última mensagem (posição, rumo, salto) */
  mudou = true;

  /** salta para um destino (o som passa por um silêncio curto) */
  ir(d: Destino) {
    if (this.modo !== 'embarcado' && d.modo === 'embarcado') this.volta = this.destinoAtual();
    this.modo = d.modo;
    this.pos = [d.pos[0], d.pos[1], d.pos[2]];
    this.vel = [0, 0, 0]; this.velReal = [0, 0, 0];
    this.rumo = d.rumo; this.arfagem = d.arfagem;
    this.local = d.local ?? 'auto'; this.alvo = d.alvo ?? 'corpo';
    this.caixa = d.caixa; this.nome = d.nome ?? '';
    this.origem = [d.pos[0], d.pos[1], d.pos[2]];
    this.salto++;
    this.mudou = true;
  }
  /** o ponto em que está, como destino (para voltar a ele) */
  destinoAtual(): Destino {
    return { modo: this.modo, pos: [...this.pos] as V3, rumo: this.rumo, arfagem: this.arfagem, local: this.local, alvo: this.alvo, caixa: this.caixa, nome: this.nome };
  }
  /** desembarca: volta ao último ponto a pé ou de voo (ou ao destino dado, se nunca esteve fora) */
  desembarcar(reserva: Destino) { this.ir(this.volta ?? reserva); this.volta = null; }

  /** gira a cabeça (rad): o mouse e o toque */
  olhar(dRumo: number, dArfagem: number) {
    if (!dRumo && !dArfagem) return;
    this.rumo = ((this.rumo + dRumo) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    this.arfagem = Math.max(-ARFAGEM_MAX, Math.min(ARFAGEM_MAX, this.arfagem + dArfagem));
    this.mudou = true;
  }

  /**
   * avança dt segundos: velocidade pedida pela entrada, suavizada, e o passo corrigido pelo lugar. Um quadro lento não
   * atrasa o passo: até 1 s por quadro, em pedaços de até 0,1 s (acima disso, a aba voltou do segundo plano: pausa)
   */
  passo(dt: number, lugar: Lugar | null) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 1);
    const n = Math.ceil(dt / 0.1);
    for (let i = 0; i < n; i++) this.passo1(dt / n, lugar);
  }
  private passo1(dt: number, lugar: Lugar | null) {
    const e = this.entrada;
    const voo = this.modo === 'voo', dentro = this.modo === 'embarcado';
    const vh = dentro ? ANDAR_DENTRO * (e.correr ? 2 : 1) : voo ? (e.correr ? VOAR_RAPIDO : VOAR) : e.correr ? CORRER : ANDAR;
    // direção no plano: frente para onde olha, direita a 90° no sentido horário
    let f = e.frente, l = e.lado;
    const n = Math.hypot(f, l); if (n > 1) { f /= n; l /= n; }
    const c = Math.cos(this.rumo), s = Math.sin(this.rumo);
    const alvo: V3 = [vh * (f * c + l * s), vh * (f * s - l * c), voo || dentro ? (e.correr ? SUBIR_RAPIDO : SUBIR) * e.sobe * (dentro ? 0.15 : 1) : 0];
    const k = 1 - Math.exp(-dt / TAU_VEL);
    let andou = false;
    for (let i = 0; i < 3; i++) {
      this.vel[i] += (alvo[i] - this.vel[i]) * k;
      if (Math.abs(this.vel[i]) < 1e-3 && alvo[i] === 0) this.vel[i] = 0;
      if (this.vel[i] !== 0) andou = true;
    }
    if (!andou) {
      this.velReal[0] = 0; this.velReal[1] = 0; this.velReal[2] = 0;
      // parado: a pé o olho ainda acompanha o chão (o lugar mudou de baixo dele)
      if (this.modo === 'pe' && lugar) { const z = lugar.chao(this.pos[0], this.pos[1]) + OLHO; if (Math.abs(z - this.pos[2]) > 1e-4) { this.pos[2] += (z - this.pos[2]) * Math.min(1, dt / 0.08); this.mudou = true; } }
      return;
    }
    const ant: V3 = [this.pos[0], this.pos[1], this.pos[2]];
    const nova: V3 = [ant[0] + this.vel[0] * dt, ant[1] + this.vel[1] * dt, ant[2] + this.vel[2] * dt];
    if (dentro) {
      const b = this.caixa;
      if (b) { nova[0] = Math.max(b.x0, Math.min(b.x1, nova[0])); nova[1] = Math.max(b.y0, Math.min(b.y1, nova[1])); nova[2] = Math.max(b.z0, Math.min(b.z1, nova[2])); }
    } else if (lugar) {
      const z0 = ant[2];
      lugar.limitar(ant, nova, voo, OLHO);
      // a pé, degraus (plataforma, talude) sobem e descem em ~80 ms, não num salto
      if (!voo) nova[2] = z0 + (nova[2] - z0) * Math.min(1, dt / 0.08 + (Math.abs(nova[2] - z0) < 0.02 ? 1 : 0));
    }
    // a velocidade que vai para a Cena é a do passo dado (a parede para o observador), suavizada em 50 ms
    const k2 = 1 - Math.exp(-dt / 0.05);
    for (let i = 0; i < 3; i++) this.velReal[i] += ((nova[i] - ant[i]) / dt - this.velReal[i]) * k2;
    this.pos = nova;
    this.mudou = true;
    // saiu do ponto para onde foi: o nome dele não vale mais
    if (this.nome && Math.hypot(nova[0] - this.origem[0], nova[1] - this.origem[1], nova[2] - this.origem[2]) > 1.5) this.nome = '';
  }
  private origem: V3 = [0, 0, 0];
  /** m/s: a velocidade do olho de verdade (a que a Cena usa para seguir o ouvido entre duas mensagens) */
  velReal: V3 = [0, 0, 0];
}
