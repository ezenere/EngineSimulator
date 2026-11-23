// Condução da página do Vapor: o que um maquinista faz com a reversão quando o dono só quer abrir o regulador. É lógica
// da página (o motor recebe o `cutoff` como sempre), sem DOM, para as ferramentas poderem rodar a mesma lei offline.
//
// Corte automático. A máquina sai com o corte longo e o maquinista o encurta conforme a velocidade sobe ("notching up"):
// com a manivela girando depressa, cada golpe precisa de menos vapor para a mesma força, e a caldeira não daria conta de
// um corte longo. A lei olha a rotação da MANIVELA (a velocidade do pistão), como fração da rotação na velocidade máxima
// da ficha (`voltasDeProjeto`), e não os km/h: o Shay e o trator giram a manivela depressa a 20 e a 8 km/h, e as 14
// máquinas cabem numa tabela só. Os pontos vêm dos roteiros que a página tinha (VAPOR.md 1.9, os cenários): 78 % parada
// (reversão quase toda à frente), 60 % e 45 % na arrancada (K4s a ~12 e ~20 km/h), 25 % a 60 km/h e 20 % a 100 km/h
// (K4s: 0,4 e 0,67 da rotação de projeto). Duas correções alongam o corte de novo, como o maquinista faria:
//   - rampa: +5 pontos por 1 % de subida (até +20);
//   - perdendo velocidade com o regulador aberto (≥ 60 %) e sem freio: sobe 5 pontos por segundo enquanto a máquina
//     cai, até +30; volta devagar (3 pontos por segundo) quando ela torna a ganhar velocidade ou o regulador fecha.
// Patinando, a manivela dispara e a lei encurta o corte sozinha (menos força na roda); nas locomotivas (roda de aço em
// trilho, onde patinar derruba a aderência) o corte ainda perde 30 pontos por segundo (até 45) enquanto a roda patina e
// os devolve a 6 pontos por segundo depois que ela pega: são os 2–3 surtos da arrancada de VAPOR.md 1.9. Com um cilindro
// só (o trator) o corte não desce de 30 % (não há outro cilindro para levar a manivela pelo ponto morto) e, parada com o
// regulador aberto, a página balança a reversão (ré um instante e volta) para tirar a manivela de onde nenhuma ponta
// admite vapor.
// Andando contra o sentido escolhido (a máquina descendo de ré com a reversão à frente, por exemplo), o corte é o de
// partida: é o contravapor.
//
// Ponto morto. A reversão no meio do motor ainda admite vapor (o corte mínimo da Walschaerts é 15 %, `cortePorReverser`),
// então "Ponto morto" na página põe a reversão no meio E manda o regulador fechado ao motor: a alavanca fica onde o dono
// deixou, e a máquina não puxa para lado nenhum.
import type { PresetVapor } from '../../engines/vapor/presets';

export type Sentido = 1 | 0 | -1;
export const SENTIDOS: { valor: Sentido; rotulo: string }[] = [{ valor: 1, rotulo: 'Frente' }, { valor: 0, rotulo: 'Ponto morto' }, { valor: -1, rotulo: 'Ré' }];

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/** corte (fração do curso) pela fração da rotação de projeto da manivela */
export const TABELA_CORTE: readonly [number, number][] = [
  [0, 0.78], [0.04, 0.72], [0.08, 0.62], [0.13, 0.5], [0.2, 0.38], [0.3, 0.29], [0.4, 0.25], [0.67, 0.2], [1, 0.17],
];
export const CORTE_MIN = 0.15, CORTE_MAX = 0.85;

export function corteDaTabela(x: number): number {
  const T = TABELA_CORTE;
  if (x <= T[0][0]) return T[0][1];
  for (let i = 1; i < T.length; i++) if (x <= T[i][0]) { const [x0, c0] = T[i - 1], [x1, c1] = T[i]; return c0 + ((c1 - c0) * (x - x0)) / (x1 - x0); }
  return T[T.length - 1][1];
}

/** redução manivela : roda na marcha de agora (o trator tem duas; as outras, a da ficha) */
export const reducaoAtual = (P: PresetVapor, marcha = 1) => (P.familia === 'trator' && marcha === 2 ? P.reducao2 ?? P.reducao ?? 1 : P.reducao ?? 1);
/** trator: a velocidade máxima da marcha (km/h), a do governador de esferas na rotação de trabalho da ficha; 0 sem ela */
export const vMaxDaMarcha = (P: PresetVapor, marcha = 1) => (P.rpmNominal && P.dRoda > 0 ? (P.rpmNominal / 60 / reducaoAtual(P, marcha)) * Math.PI * P.dRoda * 3.6 : 0);

/** voltas da manivela por segundo na velocidade máxima da ficha, na marcha mais longa */
export function voltasDeProjeto(P: PresetVapor): number {
  if (P.dRoda <= 0) return Math.max(0.5, P.vMax / 60);
  const red = P.familia === 'trator' ? P.reducao2 ?? P.reducao ?? 1 : P.reducao ?? 1;
  // (as pás escorregam na água: o barco anda 0,75 do aro da roda, ESCORREGAMENTO de src/carriers/barco.ts)
  const desliza = P.familia === 'barco' ? 0.75 : 1;
  return (P.vMax / 3.6 / (Math.PI * P.dRoda * desliza)) * red;
}

/** reversão (−1..1) de um corte (15–85 %) num sentido */
export const reversaoDe = (corte: number, sentido: Sentido) => (sentido === 0 ? 0 : sentido * clamp((corte - CORTE_MIN) / (CORTE_MAX - CORTE_MIN), 0, 1));

export type EntradaCorte = {
  /** voltas da roda por segundo, com sinal (telemetria `voltasPorS`) */
  voltasRoda: number;
  /** velocidade do veículo, m/s com sinal (positiva à frente) */
  v: number;
  sentido: Sentido;
  /** regulador pedido (0..1) */
  regulador: number;
  /** rampa, % (positiva = subida) */
  rampa: number;
  freando: boolean;
  /** rodas patinando (telemetria) */
  patinando?: boolean;
};

/** a lei do corte automático, com o estado das duas correções; `passo` a cada quadro */
export class CorteAutomatico {
  readonly P: PresetVapor;
  marcha = 1;
  /** alongamento por perder velocidade com o regulador aberto (fração do curso) */
  reforco = 0;
  /** alívio por patinar (fração do curso tirada do corte) */
  alivio = 0;
  /** aceleração filtrada (m/s², no sentido escolhido) */
  acel = 0;
  corte: number = TABELA_CORTE[0][1];
  /** corte mínimo da máquina: com um cilindro só não há outro para passar o ponto morto, e abaixo de 30 % ela morre */
  readonly minimo: number;
  /** roda de aço em trilho: patinar derruba a aderência (Polach) e vale aliviar; o trator (garras) e o carro (pneus)
   *  seguem puxando 90 % patinando, e aliviar só os fazia parar */
  readonly alivia: boolean;
  private vAnt: number | null = null;
  constructor(P: PresetVapor) {
    this.P = P;
    this.minimo = P.cilindros.n === 1 && !P.compound ? 0.3 : CORTE_MIN;
    this.alivia = P.familia === 'locomotiva';
  }
  /** balanço da máquina de um cilindro presa no ponto morto: segundos parada com o regulador aberto, segundos de ré
   *  que faltam e a espera até a próxima tentativa */
  private tPreso = 0; private tBalanco = 0; private tEspera = 0;
  /** a reversão está do lado contrário ao sentido (balançando) */
  invertida = false;
  zerar() { this.reforco = 0; this.alivio = 0; this.acel = 0; this.vAnt = null; this.corte = TABELA_CORTE[0][1]; this.tPreso = this.tBalanco = this.tEspera = 0; this.invertida = false; }
  /** a reversão (−1..1) a mandar ao motor depois de `passo` */
  reversao(sentido: Sentido) { return reversaoDe(this.corte, (this.invertida ? -sentido : sentido) as Sentido); }

  passo(dt: number, e: EntradaCorte): number {
    const P = this.P, s = e.sentido === 0 ? 1 : e.sentido;
    // Um cilindro só pode parar onde nenhuma ponta admite vapor (perto do ponto morto, depois do corte): o maquinista
    // do trator põe a reversão em ré um instante e volta. Parada há 2,5 s com o regulador aberto e sem freio: 1,5 s de
    // ré a 85 %, e outra tentativa 5 s depois.
    if (this.minimo > CORTE_MIN && dt > 0) {
      const preso = e.sentido !== 0 && e.regulador >= 0.15 && !e.freando && Math.abs(e.v) < 0.05 && Math.abs(e.voltasRoda) < 0.01;
      this.tPreso = preso ? this.tPreso + dt : 0;
      this.tEspera = Math.max(0, this.tEspera - dt);
      if (this.tBalanco > 0) this.tBalanco = Math.max(0, this.tBalanco - dt);
      else if (this.tPreso > 2.5 && this.tEspera <= 0) { this.tBalanco = 1.5; this.tEspera = 5; }
      this.invertida = this.tBalanco > 0;
      if (this.invertida) { this.corte = CORTE_MAX; return this.corte; }
    }
    // velocidade no sentido escolhido e a aceleração filtrada (1,5 s)
    const vs = e.v * s;
    if (this.vAnt != null && dt > 0) { const a = (vs - this.vAnt) / dt; this.acel += (a - this.acel) * (1 - Math.exp(-dt / 1.5)); }
    this.vAnt = vs;
    if (dt > 0) {
      if (e.regulador >= 0.6 && !e.freando && this.acel < -0.02 && vs > 0.3) this.reforco = Math.min(0.3, this.reforco + 0.05 * dt);
      else if (this.acel > 0.05 || e.regulador < 0.3 || e.freando) this.reforco = Math.max(0, this.reforco - 0.03 * dt);
      if (e.patinando && this.alivia) { this.alivio = Math.min(0.45, this.alivio + 0.3 * dt); this.reforco = 0; }
      else this.alivio = Math.max(0, this.alivio - 0.06 * dt);
    }
    // andando contra o sentido (mais de 1 km/h): o corte de partida, o contravapor
    const contra = vs < -0.3;
    const x = contra ? 0 : (Math.abs(e.voltasRoda) * reducaoAtual(P, this.marcha)) / voltasDeProjeto(P);
    const rampa = clamp(0.05 * e.rampa, 0, 0.2);
    this.corte = clamp(corteDaTabela(x) + rampa + this.reforco - this.alivio, this.minimo, CORTE_MAX);
    return this.corte;
  }
}

// ---------------------------------------------------------------- a demonstração "Subida forte"
// A subida pesada de VAPOR.md 1.9 (a rampa de Lickey, 2,65 %): a máquina trabalha no limite, com o regulador todo aberto,
// o corte longo, chuffs fortes e lentos que vão apressando, e a caldeira caindo. O roteiro de antes (10 vagões, o
// regulador todo aberto de uma vez, corte fixo de 55 %, sem areia) fazia a K4s descer de ré: 636 t pedem 165 kN na
// rampa, e com o corte de 55 % ela não chega a isso (a composição descia a −17 km/h aos 60 s; a D51, a −29, patinando).
// A Lickey tinha máquinas de reforço atrás; aqui a
// composição é menor e a máquina sobe como um maquinista a levaria: segura parada até o vapor encher os cilindros,
// abre o regulador aos poucos, joga areia a subida toda (a aderência vai de 0,22 a 0,30) e deixa o corte com o
// automático, que sai no máximo (o da tabela mais a correção da rampa), encurta com a velocidade e alivia se a roda
// patinar. O teste roda este roteiro com a mesma lei (`npm run teste:vapor -- conducao`: a K4s, a D51 e o Big Boy);
// simuladas offline, as 10 locomotivas sobem (12 a 47 km/h aos 60 s, nenhuma desce de ré).
export type RoteiroSubida = {
  vagoes: number; rampa: number; dur: number;
  /** segundos com a composição segura parada (o vapor enchendo a caixa e os cilindros) */
  segura: number;
  /** [s, regulador] desde o início */
  regulador: readonly (readonly [number, number])[];
  /** corte: 'auto' = o corte automático da página; um número = a reversão fixa nesse corte */
  corte: number | 'auto';
  areia: boolean;
};
export const SUBIDA_FORTE: RoteiroSubida = {
  vagoes: 5, rampa: 2.65, dur: 60, segura: 2.5,
  regulador: [[0, 0.35], [1, 0.55], [2, 0.75], [4, 0.9], [6, 1]],
  corte: 'auto', areia: true,
};

// ---------------------------------------------------------------- linha de estado
// A primeira coisa que o palco diz: em que pé a máquina está e o que fazer agora. Pura (sem DOM): os mostradores
// escrevem o resultado no requestAnimationFrame.

export type Tom = 'ok' | 'aviso' | 'neutro';
export type LinhaDeEstado = { titulo: string; detalhe: string; tom: Tom };
export type EntradaEstado = {
  ligado: boolean; calibrando: boolean; erro: string | null;
  /** demonstração em curso: o que ela faz e quantos segundos faltam */
  demo: { estado: string; restante: number } | null;
  portador: 'locomotiva' | 'gerador' | 'carro' | 'trator' | 'barco';
  /** km/h, com sinal (negativa = de ré) */
  v: number; vMax: number;
  /** regulador pedido pelo dono e o que vai ao motor (0 em ponto morto) */
  regulador: number; reguladorEfetivo: number;
  sentido: Sentido; corteAuto: boolean;
  /** corte de agora (telemetria) e a reversão à mão */
  corte: number; reversao: number;
  patinando: boolean; freando: boolean; temFreio: boolean; temAreia: boolean;
  /** segundos parada com o regulador aberto */
  presaHa: number;
  jaAndou: boolean;
  rampa: number;
  marcha: number;
  /** estacionária: rotação do eixo e carga */
  rpm: number; carga: number;
  /** trator engatado: o governador está segurando a máquina (a válvula dele mais fechada que o regulador) e a velocidade
   *  máxima da marcha (km/h; 0 = sem governador na estrada) */
  governando?: boolean; vMaxMarcha?: number;
  pCaldeira: number; pNominal: number;
};

const num = (x: number, d = 0) => x.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const pctTxt = (x: number) => `${Math.round(x * 100)} %`;

export function linhaDeEstado(e: EntradaEstado): LinhaDeEstado {
  if (e.erro) return { titulo: 'O áudio não iniciou', detalhe: e.erro, tom: 'aviso' };
  if (!e.ligado) return { titulo: 'Desligada', detalhe: 'Clique em “Ligar o som”: a máquina acende em pressão, parada e pronta para partir.', tom: 'neutro' };
  if (e.calibrando) return { titulo: 'Preparando a máquina…', detalhe: 'Medindo o nível de cada fonte desta máquina (um ou dois segundos).', tom: 'neutro' };
  const caldeira = e.pCaldeira < 0.75 * e.pNominal ? ` · caldeira baixa: ${num(e.pCaldeira, 1)} bar` : '';
  if (e.demo) return { titulo: `Demonstração: ${e.demo.estado}`, detalhe: `Toque no regulador, no sentido ou no freio para assumir a máquina · termina em ${num(Math.ceil(e.demo.restante))} s`, tom: 'neutro' };
  if (e.portador === 'gerador') return { titulo: `Máquina fixa · ${num(e.rpm)} rpm no governador`, detalhe: `Carga do eixo em ${pctTxt(e.carga)}: mude a carga e ouça o governador segurar a rotação${caldeira}`, tom: 'ok' };
  if (e.portador === 'trator' && e.marcha === 0) return { titulo: 'Embreagem solta (N): a manivela gira em lenta', detalhe: `Escolha a 1ª ou a 2ª marcha para andar${caldeira}`, tom: 'neutro' };
  const av = Math.abs(e.v), lado = e.sentido === -1 ? 'Ré' : 'Frente';
  const comando = e.corteAuto ? `${e.sentido === 0 ? 'Ponto morto' : lado} · corte ${pctTxt(e.corte)} (automático)` : `reversão à mão: ${Math.abs(e.reversao) < 0.02 ? 'no meio' : e.reversao > 0 ? 'frente' : 'ré'}, corte ${pctTxt(e.corte)}`;
  const parar = e.temFreio ? 'segure Espaço para frear' : e.portador === 'barco' ? 'para parar mais depressa, Ré com o regulador aberto' : 'o atrito da estrada para o trator';
  if (av > 0.5) {
    const vel = `${num(av, av < 10 ? 1 : 0)} km/h${e.v < 0 ? ' de ré' : ''}`;
    const contra = e.corteAuto && e.sentido !== 0 && e.reguladorEfetivo > 0.02 && Math.sign(e.v) !== e.sentido && av > 1;
    if (e.patinando) return { titulo: `Patinando · ${vel}`, detalhe: `Feche um pouco o regulador${e.temAreia ? ' e segure E (areia)' : ''}: a roda gira em falso${caldeira}`, tom: 'aviso' };
    if (e.freando) return { titulo: `Freando · ${vel}`, detalhe: `Solte o freio para seguir${e.reguladorEfetivo > 0.02 ? ' (o regulador está aberto: feche-o para parar de vez)' : ''}`, tom: 'neutro' };
    if (contra) return { titulo: `Contravapor · ${vel}`, detalhe: `O sentido está contra o movimento: a máquina freia no vapor e depois volta · ${comando}`, tom: 'aviso' };
    if (e.reguladorEfetivo > 0.02) {
      // (o trator engatado não passa da máxima: o governador de esferas segura a manivela na rotação de trabalho)
      if (e.governando && e.vMaxMarcha) return { titulo: `Em marcha · ${vel}`, detalhe: `No governador: a máxima da ${e.marcha}ª (${num(e.vMaxMarcha, 1)} km/h)${e.marcha === 1 ? ' · engate a 2ª para ir mais depressa' : ''} · ${comando}`, tom: 'ok' };
      if (!e.vMaxMarcha && av > e.vMax * 1.05) return { titulo: `Em marcha · ${vel}`, detalhe: `Acima da velocidade máxima da ficha (${num(e.vMax)} km/h): feche um pouco o regulador · ${comando}`, tom: 'aviso' };
      return { titulo: `Em marcha · ${vel}`, detalhe: `${comando} · regulador ${pctTxt(e.regulador)}${caldeira}`, tom: 'ok' };
    }
    if (e.corteAuto && e.sentido === 0) return { titulo: `Ponto morto · ${vel}`, detalhe: `A máquina corre solta: escolha Frente ou Ré para puxar · ${parar}`, tom: 'neutro' };
    return { titulo: `Regulador fechado · ${vel}`, detalhe: `A máquina corre solta e perde velocidade · ${parar}`, tom: 'neutro' };
  }
  // parada
  if (e.corteAuto && e.sentido === 0) return { titulo: 'Ponto morto', detalhe: 'Escolha Frente ou Ré e abra o regulador', tom: 'neutro' };
  if (e.freando) return { titulo: 'Parada no freio', detalhe: 'Solte o freio (Espaço) e abra o regulador para partir', tom: 'neutro' };
  if (e.reguladorEfetivo <= 0.02) return { titulo: e.jaAndou ? 'Parada · pronta para partir' : 'Pronta para partir: abra o regulador', detalhe: `${e.jaAndou ? 'Abra o regulador para sair' : 'Arraste a alavanca do regulador para cima, ou segure W'}${e.corteAuto ? (e.sentido === -1 ? ' · sentido: ré' : '') : ` · ${comando}`}${caldeira}`, tom: 'ok' };
  if (e.presaHa > 4) {
    // (o trator preso pela patinagem de duas amostras, que pedia "ponha em N e engate a 1ª de novo", foi corrigido no
    // motor: src/engines/vapor/dsp.ts, `dinamica`; parado no ponto morto, o corte automático balança a reversão)
    const vagoes = e.portador === 'locomotiva' ? ' ou tire vagões no painel' : '';
    const dica = e.patinando ? `Feche um pouco o regulador${e.temAreia ? ' e segure E (areia)' : ''}`
      : e.portador === 'trator' && e.marcha === 2 && e.regulador >= 0.5 ? 'Abra mais o regulador ou engate a 1ª (a 2ª tem a metade da força)'
      : e.rampa > 0.5 ? `A rampa é forte para esta ${e.portador === 'locomotiva' ? 'composição' : 'máquina'}: abra mais o regulador${e.temAreia ? ', segure E (areia)' : ''}${vagoes}`
      : e.regulador < 0.5 ? 'Abra mais o regulador' : `Abra mais o regulador${vagoes}`;
    return { titulo: 'A máquina não sai do lugar', detalhe: `${dica}${caldeira}`, tom: 'aviso' };
  }
  return { titulo: 'Saindo…', detalhe: `O vapor está enchendo os cilindros · ${comando} · regulador ${pctTxt(e.regulador)}`, tom: 'ok' };
}
