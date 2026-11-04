// Portador trem de N vagões (CENA.md 4.6), etapa 1 sem motor próprio (compatibilidade "nenhum × trem";
// o motor elétrico entra na etapa 6). Padrões: trem-bala tipo Shinkansen/ICE.
//
// Geometria no referencial do corpo: x = 0 no centro, frente em +L/2. Vagão c (0 = o da frente) começa
// em x_c = L/2 − c·L_c e tem L_c − vão de corpo; L = N·L_c − vão. Truques a `truqueExtremidade` de cada
// ponta (8 m de um ao outro através do vão, L_c − 8 dentro do vagão), vãos no meio da junção.
//
// Fontes (refDist 7,5 m; v_ref 300 km/h; L_W dB(A) re 1 pW; entre parênteses o valor da tabela de 4.6):
//   truque.k (rolamento) ×2N, 130 (123) dB(A), n 3 · truque.k.aero ×2N, 105 (119), n 6 (pico 160 Hz)
//   corpo.k (aero) ×N, 119 (122), n 6, na face voltada ao ouvinte, z 1,8
//   vao.k ×(N−1), 119, n 6 · pantografo.k ×2, 125 (115 carenado), n 6, z 5
//   nariz / cauda (aero, pico 300 Hz) 116 (119), n 6, mais as fontes 'pressao' (campo próximo, calculado pela Cena)
//
// Orçamento ajustado contra gravações de passagem a 265–320 km/h (E5, Tohoku, Velaro E a 300 e 265, Velaro,
// ICE 3; docs/TECNICO.md, Validação). Com os L_W de 4.6 o aero dominava o nível A a 7,5 m por 7 dB (o
// rolamento, sob o piso, chega com a sombra de 2.5: 92 dB(A) contra os 97 que 4.6 dá para "só rolamento a
// 7,5 m e 300 km/h"), e o pico tinha 1–2,5 kHz a −6 dB e centroide de 510 Hz, contra +4 dB e 1,5 kHz nas
// gravações. Agora: só rolamento 98,8 dB(A) a 7,5 m (97 ± 2 de 4.6), aero + vãos + pantógrafos 95,8, total
// 100,6. O aero do truque (pico 160 Hz) é o que mais enchia 60–400 Hz e caiu mais; o corpo, na face, segura
// o nível a 3 m (o rolamento sombreado sobe só ~2 dB de 7,5 para 3 m): L_Aeq,tp 105,5 dB(A) a 3 m/350 km/h
// e túnel − céu +8,7 dB, dentro dos alvos de 2.10–2.11.
//
// Diretividade: o CENA.md não dá tabela para essas fontes. O rolamento é um dipolo lateral (eixo y,
// cos θ limitado a −20 dB ao longo da via: a roda vibra na direção do eixo do rodeiro); as fontes
// aerodinâmicas (camada limite na face, boca do vão, cavidade do truque, nariz, braços do pantógrafo)
// são dipolos normais à face, mais brandos (−6 dB ao longo da via). Com fontes omnidirecionais e a
// amplificação convectiva de dipolo (+8,7 dB chegando a 350 km/h) o trem chegando a 100 m ficava só
// 16 dB abaixo do pico (alvo 23 ± 4). expConv: rolamento 2 (monopolo), aero/vão/pantógrafo 3 (dipolo), 2.1.
import type { FonteSonora, Diretividade, Vec3, TipoFonte } from '../scene/tipos';
import type { Portador, Corpo, Cinematica, ComandoPortador, TelemetriaPortador, Motor, FamiliaMotor, Segmento } from './tipos';
import { COMPAT, validarCompat } from './compat';
import { FonteRuido, FonteRolamento, FonteAero, FonteVao, FontePantografo, FonteTom } from './ruido';
import { fatorPotenciaDir } from '../scene/filtros';
import { MAX_FONTES } from '../scene/constantes';
import type { Carga } from '../scene/tipos';
import type { MotorEletrico } from '../engines/eletrico/motor';
import type { ComandoEletrico } from '../engines/eletrico/dsp';
import { DIR_MOTOR, OMNI as OMNI_EL } from '../engines/eletrico/constantes';

export interface ConfigTrem {
  N: number;                  // vagões
  Lc: number;                 // m, passo do vagão (corpo + vão)
  vao: number;                // m
  largura: number; altura: number; zPiso: number;
  lNariz: number; lCauda: number;
  truqueExtremidade: number;  // m de cada ponta do vagão ao truque
  eixosPorTruque: number; distEixos: number; diametroRoda: number;
  pantografos: number[];      // vagões com pantógrafo (contados a partir de 1)
  carenagem: boolean;         // carenagem do pantógrafo (−10 dB)
  dormente: number;           // m entre dormentes
  achatamento: number;        // 0..1, roda ovalizada
  areaFrontal: number; cd: number; cpNariz: number;
  massaSuperficial: number; fCabine: number;
  vTransicao: number;         // km/h em que aero = rolamento (informativo: vem dos L_W)
  ladoOuvinte: 1 | -1;        // lado do corpo (y) voltado ao ouvinte: as fontes `corpo.k` ficam nessa face
  semente: number;
  /** tom de teste (Doppler) no nariz, na face voltada ao ouvinte, à altura do ouvido; nivel = dB SPL a refDist */
  tom?: { f: number; nivelDb: number; z?: number; expConv?: number } | null;
  /** só o tom de teste (as fontes do trem ficam mudas): para medir o Doppler limpo */
  soTom?: boolean;
  /** só estes tipos de fonte soam (validação da lei de velocidade por tipo); indefinido = todos */
  tipos?: TipoFonte[] | null;
  /**
   * 'uma': as fontes `corpo.k` ficam só na face `ladoOuvinte` (validação, ouvinte fixo de um lado).
   * 'duas': `corpo.k.d` (y −) e `corpo.k.e` (y +), alimentadas pelo mesmo gerador, com crossfade de
   * potência constante de 50 ms quando o ouvinte troca de lado (`definirLado`): o ouvinte do gimbal ou a
   * volta, em que o trem mostra uma face na reta do ouvinte e a outra na reta de lá.
   */
  faces?: 'uma' | 'duas';
  /** ganhos de calibração já calculados (Trem.calibracoes() com a mesma configuração), um por fonte */
  calibracao?: number[] | null;
  // ---- Elétrico (ELETRICO.md 4.3): o trem com motor; sem motor nada disto muda o trem
  /** vagões com um truque só, no meio (bonde: módulos 1, 3, 5); indefinido = 2 truques por vagão */
  truques?: number[] | null;
  /** fontes reservadas para o motor no orçamento (o aero dos truques sai antes delas) */
  reservaFontes?: number;
}

export const TREM_PADRAO: ConfigTrem = {
  N: 10, Lc: 25, vao: 0.5, largura: 3.36, altura: 3.6, zPiso: 0.4, lNariz: 12, lCauda: 12,
  truqueExtremidade: 3.75, eixosPorTruque: 2, distEixos: 2.5, diametroRoda: 0.86,
  pantografos: [3, 8], carenagem: true, dormente: 0.6, achatamento: 0,
  areaFrontal: 11.2, cd: 0.2, cpNariz: 0.14, massaSuperficial: 25, fCabine: 45, vTransicao: 300,
  ladoOuvinte: -1, semente: 0x7a11, tom: null, soTom: false, faces: 'uma',
};

/**
 * Quantas fontes com anel de propagação o trem pede (a Cena aceita MAX_FONTES, CENA.md 5.1) e se o
 * aerodinâmico dos truques entra. O aero do truque (105 dB(A)) fica 25 dB abaixo do rolamento (130) no
 * mesmo ponto: contribui menos de 0,02 dB e é o primeiro a sair quando o trem não cabe no orçamento.
 */
export function orcamentoTrem(c: Pick<ConfigTrem, 'N' | 'pantografos' | 'faces' | 'tom'> & Partial<Pick<ConfigTrem, 'truques' | 'reservaFontes'>>) {
  const faces = c.faces === 'duas' ? 2 : 1;
  const pant = c.pantografos.filter((p) => p >= 1 && p <= c.N).length;
  const nT = nTruques(c);
  const base = nT + faces * c.N + (c.N - 1) + pant + 2 + (c.tom ? 1 : 0);
  const res = c.reservaFontes ?? 0;
  const aeroTruque = base + nT + res <= MAX_FONTES;
  return { fontes: aeroTruque ? base + nT : base, aeroTruque, cabe: base <= MAX_FONTES };
}

/** truques do trem: 2 por vagão, ou um no meio dos vagões de `truques` (bonde) */
export function nTruques(c: Pick<ConfigTrem, 'N'> & Partial<Pick<ConfigTrem, 'truques'>>) {
  return c.truques ? c.truques.filter((v) => v >= 1 && v <= c.N).length : 2 * c.N;
}

/** maior N que cabe no orçamento de fontes (o resto da configuração fixa) */
export function maxVagoes(c: Pick<ConfigTrem, 'pantografos' | 'faces' | 'tom'>) {
  let n = 1;
  while (n < 40 && orcamentoTrem({ ...c, N: n + 1 }).cabe) n++;
  return n;
}

/**
 * x (referencial do corpo) dos truques de N vagões de passo `Lc` (corpo `Lc − vao`), o primeiro começando em `xFrente`:
 * dois por vagão, a `te` de cada ponta. É a geometria do `Trem`; a composição a vapor (locomotiva-vapor.ts) a reusa para
 * os vagões atrás do tênder.
 */
export function xTruquesVagoes(N: number, Lc: number, vao: number, te: number, xFrente: number) {
  const lc = Lc - vao, x: number[] = [];
  for (let k = 0; k < N; k++) { const xf = xFrente - k * Lc; x.push(xf - te, xf - lc + te); }
  return x;
}
/** x do meio de cada vão entre vagões (o mesmo padrão) */
export function xVaosVagoes(N: number, Lc: number, vao: number, xFrente: number) {
  const lc = Lc - vao, x: number[] = [];
  for (let k = 0; k < N - 1; k++) x.push(xFrente - k * Lc - lc - vao / 2);
  return x;
}

/** níveis de potência (4.6, ajustados contra gravações: ver o cabeçalho) */
export const LW_TREM = { rolamento: 130, truqueAero: 105, corpo: 119, vao: 119, pantografo: 125, pantografoCarenado: 115, narizCauda: 116 } as const;
export const V_REF_TREM = 300 / 3.6;
export const REF_DIST_PORTADOR = 7.5;

const OMNI: Diretividade['tabela'] = [0, 0, 0, 0, 0, 0, 0];
/** roda: a vibração axial do rodeiro irradia como dipolo lateral (cos θ, limitado a −20 dB ao longo da via) */
const DIP_LATERAL: Diretividade['tabela'] = [0, -1.2, -6, -20, -6, -1.2, 0];
/** fontes de parede (camada limite na face, boca do vão, cavidade do truque): dipolo normal à face */
const DIP_FACE: Diretividade['tabela'] = [0, -1, -4, -10, -4, -1, 0];

export class Trem implements Portador {
  readonly tipo = 'trem' as const;
  readonly compat: readonly FamiliaMotor[] = COMPAT.trem;
  corpo: Corpo;
  cinematica: Cinematica = { s: 0, v: 0, a: 0, rumo: 0 };
  cfg: ConfigTrem;
  fs: number;
  motor: Motor | null = null;
  private lista: FonteSonora[] = [];
  private geradores: (FonteRuido | FonteTom | null)[] = [];
  private cmd: ComandoPortador = { pedal: 0, velocidadeFixa: null };
  /** x (corpo) de cada truque, para o padrão de truques e a ponte */
  xTruques: number[] = [];
  /** vagão (contado a partir de 1) de cada truque */
  vagaoTruque: number[] = [];
  /** modo 'duas': índices em fontes() das faces y − e y + de cada vagão, e o crossfade entre elas */
  private faceD: number[] = []; private faceE: number[] = [];
  lado: 1 | -1 = -1; private xfLado = 0; private xfAlvo = 0;

  constructor(fs: number, cfg: Partial<ConfigTrem> = {}) {
    this.fs = fs;
    this.cfg = { ...TREM_PADRAO, ...cfg };
    this.corpo = Trem.montarCorpo(this.cfg);
    this.montarFontes();
  }

  static montarCorpo(c: ConfigTrem): Corpo {
    const lc = c.Lc - c.vao;
    const segmentos: Segmento[] = [];
    for (let k = 0; k < c.N; k++) segmentos.push({ comprimento: lc, vao: k < c.N - 1 ? c.vao : 0, altura: c.altura, largura: c.largura, zPiso: c.zPiso });
    return {
      segmentos, comprimento: c.N * c.Lc - c.vao, nariz: c.lNariz, cauda: c.lCauda,
      areaFrontal: c.areaFrontal, cd: c.cd, cpNariz: c.cpNariz, massaSuperficial: c.massaSuperficial, fCabine: c.fCabine,
    };
  }

  private montarFontes() {
    const c = this.cfg, fs = this.fs, L = this.corpo.comprimento, lc = c.Lc - c.vao, te = c.truqueExtremidade;
    const R = REF_DIST_PORTADOR, vr = V_REF_TREM;
    const lista: FonteSonora[] = [], ger: (FonteRuido | FonteTom | null)[] = [];
    let sem = c.semente >>> 0;
    const prox = () => (sem = (sem + 0x9e3779b9) >>> 0);
    const d = (tabela: Diretividade['tabela'], eixo: Vec3, expConv: number): Diretividade => ({ tabela, eixo, expConv });
    const xf = (k: number) => L / 2 - k * c.Lc;
    this.xTruques = [];
    this.vagaoTruque = [];
    if (c.truques) { for (let k = 0; k < c.N; k++) if (c.truques.includes(k + 1)) { this.xTruques.push(xf(k) - lc / 2); this.vagaoTruque.push(k + 1); } }
    else {
      this.xTruques = xTruquesVagoes(c.N, c.Lc, c.vao, te, L / 2);
      for (let k = 0; k < c.N; k++) this.vagaoTruque.push(k + 1, k + 1);
    }
    // rolamento por truque
    this.xTruques.forEach((x, k) => {
      lista.push({ id: `truque.${k}`, tipo: 'rolamento', pos: [x, 0, 0.3], hCorpo: 0.3, dir: d(DIP_LATERAL, [0, 1, 0], 2), refDist: R, dentro: false });
      ger.push(new FonteRolamento(fs, { lw: LW_TREM.rolamento, n: 3, vRef: vr, refDist: R }, prox(), c.dormente, c.achatamento, c.diametroRoda));
    });
    // aerodinâmico do truque (cavidade, 160 Hz), se couber no orçamento de fontes
    const orc = orcamentoTrem(c);
    if (!orc.cabe) throw new Error(`trem de ${c.N} vagões: ${orc.fontes} fontes, a Cena aceita ${MAX_FONTES} (até ${maxVagoes(c)} vagões nesta configuração)`);
    if (orc.aeroTruque) this.xTruques.forEach((x, k) => {
      lista.push({ id: `truque.${k}.aero`, tipo: 'aero', pos: [x, 0, 0.5], dir: d(DIP_FACE, [0, 1, 0], 3), refDist: R, dentro: false });
      ger.push(new FonteAero(fs, { lw: LW_TREM.truqueAero, n: 6, vRef: vr, refDist: R }, prox(), 160));
    });
    // corpo de cada vagão, na face voltada ao ouvinte
    this.faceD = []; this.faceE = [];
    for (let k = 0; k < c.N; k++) {
      if (c.faces === 'duas') {
        // as duas faces: o gerador fica na face y − e a face y + copia o mesmo canal (processar)
        this.faceD.push(lista.length);
        lista.push({ id: `corpo.${k}.d`, tipo: 'aero', pos: [xf(k) - lc / 2, -(c.largura / 2 + 0.01), 1.8], dir: d(DIP_FACE, [0, 1, 0], 3), refDist: R, dentro: false });
        ger.push(new FonteAero(fs, { lw: LW_TREM.corpo, n: 6, vRef: vr, refDist: R }, prox(), 350));
        this.faceE.push(lista.length);
        lista.push({ id: `corpo.${k}.e`, tipo: 'aero', pos: [xf(k) - lc / 2, c.largura / 2 + 0.01, 1.8], dir: d(DIP_FACE, [0, 1, 0], 3), refDist: R, dentro: false });
        ger.push(null);
        continue;
      }
      lista.push({ id: `corpo.${k}`, tipo: 'aero', pos: [xf(k) - lc / 2, c.ladoOuvinte * (c.largura / 2 + 0.01), 1.8], dir: d(DIP_FACE, [0, 1, 0], 3), refDist: R, dentro: false });
      ger.push(new FonteAero(fs, { lw: LW_TREM.corpo, n: 6, vRef: vr, refDist: R }, prox(), 350));
    }
    this.lado = c.ladoOuvinte; this.xfLado = this.xfAlvo = c.ladoOuvinte > 0 ? 1 : 0;
    // vãos
    for (let k = 0; k < c.N - 1; k++) {
      lista.push({ id: `vao.${k}`, tipo: 'vao', pos: [xf(k) - lc - c.vao / 2, 0, 1.8], dir: d(DIP_FACE, [0, 1, 0], 3), refDist: R, dentro: false });
      ger.push(new FonteVao(fs, { lw: LW_TREM.vao, n: 6, vRef: vr, refDist: R }, prox(), c.vao));
    }
    // pantógrafos
    c.pantografos.forEach((p, k) => {
      if (p < 1 || p > c.N) return;
      lista.push({ id: `pantografo.${k}`, tipo: 'pantografo', pos: [xf(p - 1) - lc / 2, 0, 5.0], dir: d(DIP_FACE, [0, 1, 0], 3), refDist: R, dentro: false });
      ger.push(new FontePantografo(fs, { lw: c.carenagem ? LW_TREM.pantografoCarenado : LW_TREM.pantografo, n: 6, vRef: vr, refDist: R }, prox()));
    });
    // nariz e cauda: aero (pico 300 Hz) e pressão (campo próximo)
    lista.push({ id: 'nariz', tipo: 'aero', pos: [L / 2, 0, 1.8], dir: d(DIP_FACE, [0, 1, 0], 3), refDist: R, dentro: false });
    ger.push(new FonteAero(fs, { lw: LW_TREM.narizCauda, n: 6, vRef: vr, refDist: R }, prox(), 300));
    lista.push({ id: 'cauda', tipo: 'aero', pos: [-L / 2, 0, 1.8], dir: d(DIP_FACE, [0, 1, 0], 3), refDist: R, dentro: false });
    ger.push(new FonteAero(fs, { lw: LW_TREM.narizCauda, n: 6, vRef: vr, refDist: R }, prox(), 300));
    lista.push({ id: 'pressao.nariz', tipo: 'pressao', pos: [L / 2, 0, 1.8], dir: d(OMNI, [1, 0, 0], 0), refDist: R, dentro: false });
    ger.push(null);
    lista.push({ id: 'pressao.cauda', tipo: 'pressao', pos: [-L / 2, 0, 1.8], dir: d(OMNI, [1, 0, 0], 0), refDist: R, dentro: false });
    ger.push(null);
    // tom de teste
    if (c.tom) {
      const pa = 2e-5 * Math.pow(10, c.tom.nivelDb / 20);
      lista.push({ id: 'tom', tipo: 'mecanica', pos: [L / 2, c.ladoOuvinte * (c.largura / 2 + 0.01), c.tom.z ?? 1.6], dir: d(OMNI, [1, 0, 0], c.tom.expConv ?? 2), refDist: R, dentro: false });
      ger.push(new FonteTom(fs, c.tom.f, pa));
    }
    // L_W é potência: a fonte com diretividade sobe no eixo pelo índice de diretividade
    // (a página calcula as calibrações na thread principal e as manda prontas em `calibracao`: calibrar
    // as ~60 fontes leva dezenas de ms, o que cortaria o áudio se fosse feito no worklet)
    const cal = c.calibracao && c.calibracao.length === ger.length ? c.calibracao : null;
    ger.forEach((g, i) => {
      if (!(g instanceof FonteRuido)) return;
      if (cal) { g.montar(g.esp.vRef); g.gCal = cal[i]; g.vAtual = -1; return; }
      g.calibrar(); g.gCal /= Math.sqrt(fatorPotenciaDir(lista[i].dir.tabela));
    });
    this.lista = lista; this.geradores = ger;
    this.nProprias = lista.length;
  }

  /** ganhos de calibração de cada fonte (0 nas que não são ruído), para mandar ao worklet em `calibracao` */
  calibracoes(): number[] { return this.geradores.map((g) => (g instanceof FonteRuido ? g.gCal : 0)); }

  acoplar(motor: Motor | null) {
    validarCompat('trem', motor);
    this.motor = motor;
    this.tracao = motor ? new TracaoTrem(this, motor as MotorEletrico) : null;
    this.lista = [...this.lista.slice(0, this.nProprias), ...(this.tracao ? this.tracao.fontes : [])];
  }
  /** fontes do próprio trem (as do motor vêm depois) */
  nProprias = 0;
  /** motor elétrico por truque (ELETRICO.md 4.3) */
  tracao: TracaoTrem | null = null;
  /**
   * Lado do corpo (y) em que está o ouvinte, no modo de duas faces: o som da camada limite passa para a
   * face certa com crossfade de potência constante de 50 ms (sem estalo e sem buraco no nível).
   */
  definirLado(lado: 1 | -1) { if (lado !== this.lado) { this.lado = lado; this.xfAlvo = lado > 0 ? 1 : 0; } }
  comandar(c: ComandoPortador) {
    this.cmd = { ...this.cmd, ...c };
    // com motor, a velocidade imposta vale já (o trem que é solto depois dela parte dessa velocidade)
    if (this.tracao && c.velocidadeFixa != null) this.cinematica.v = c.velocidadeFixa;
  }
  fontes(): readonly FonteSonora[] { return this.lista; }

  processar(saidas: Float32Array[], n: number, dt: number) {
    const k = this.cinematica;
    const vf = this.cmd.velocidadeFixa;
    if (vf != null) { k.a = 0; k.v = vf; }
    // motor: dinâmica (ou a velocidade imposta) e os canais replicados nos truques motores
    if (this.tracao) this.tracao.processar(saidas, this.nProprias, n, dt, this.cmd);
    const G = this.geradores, so = this.cfg.soTom, tipos = this.cfg.tipos;
    for (let i = 0; i < G.length; i++) {
      const g = G[i], out = saidas[i];
      if (!g) { out.fill(0, 0, n); continue; }
      if (g instanceof FonteTom) { g.preencher(out, n); continue; }
      if (so || (tipos && !tipos.includes(this.lista[i].tipo))) { out.fill(0, 0, n); continue; }
      g.ajustar(k.v);
      g.preencher(out, n);
    }
    // duas faces: a face y + recebe o canal da face y −; ganhos cos/sen do crossfade, em rampa no bloco
    const FD = this.faceD;
    if (FD.length) {
      const x0 = this.xfLado, passo = n / (0.05 * this.fs);
      const x1 = this.xfAlvo > x0 ? Math.min(this.xfAlvo, x0 + passo) : Math.max(this.xfAlvo, x0 - passo);
      this.xfLado = x1;
      const a0 = x0 * Math.PI / 2, a1 = x1 * Math.PI / 2;
      const d0 = Math.cos(a0), e0 = Math.sin(a0), dd = (Math.cos(a1) - d0) / n, de = (Math.sin(a1) - e0) / n;
      for (let j = 0; j < FD.length; j++) {
        const od = saidas[FD[j]], oe = saidas[this.faceE[j]];
        for (let i = 0; i < n; i++) { const x = od[i]; od[i] = x * (d0 + dd * (i + 1)); oe[i] = x * (e0 + de * (i + 1)); }
      }
    }
    k.s += k.v * n * dt;
  }

  telemetria(): TelemetriaPortador {
    const base = { v: this.cinematica.v, s: this.cinematica.s, rpmEixo: 0, torqueCarga: 0, fontes: this.lista.length, comprimento: this.corpo.comprimento };
    return this.tracao ? { ...this.tracao.telemetria(), ...base, rpmEixo: this.tracao.motor.telemetria().rpm, torqueCarga: this.tracao.torqueCarga } : base;
  }
}

// ---------------------------------------------------------------- tração elétrica (ELETRICO.md 4.3)
/**
 * O motor elétrico do trem: uma `Carga` para o conjunto (Davis + rampa: torque = F·r_w/(i·η·n_motores), inércia
 * 1,06·m·r_w²/(i²·n_motores)) e as unidades do motor (até 4, cada uma com o seu desvio de rotação) REPLICADAS nos truques
 * motores, ciclicamente: replicar é copiar canal (custo de síntese zero). O orçamento de 64 fontes da Cena decide o
 * agrupamento (o trem sem motor não muda: o motor só usa o que sobra):
 *   A: por truque motor, `motor.g` (motor + redução + escovas, no truque, z 0,5) e `inversor.g` (inversor + soprador,
 *      sob o assoalho junto ao truque, z 0,6);
 *   B: por carro motor, `tracao.c` (tudo, no meio dos truques; dois truques somam em potência);
 *   C: carros motores agrupados (o N700 de 16 carros), mais o `aux` no carro do conversor quando cabe.
 * Tudo fora do corpo (`dentro: false`), sob o piso: a Cena aplica a sombra do assoalho (`hCorpo` 0,5).
 * Comando: `pedal` = tração 0..1 (notch contínuo, com rampa de 0,5/s na subida: o limitador de solavanco), `freio` =
 * freio elétrico (abaixo de v_regen,min, o atrito: mudo); `velocidadeFixa` impõe ω = v·i/r_w.
 */
export class TracaoTrem {
  trem: Trem; motor: MotorEletrico;
  fontes: FonteSonora[] = [];
  private mapa: { ch: Int32Array; g: Float64Array }[] = [];
  /** canais do motor (as unidades antes da replicação): os testes medem o inversor aqui */
  readonly canais: Float32Array[];
  i = 1; eta = 0.95; rw = 0.43; nMot = 1; massa = 100000; davis = { A: 0, B: 0, C: 0 };
  inclinacao = 0; massaExtra = 0;
  carga: Carga;
  pedal = 0; torqueCarga = 0; grupo: 'truque' | 'carro' | 'grupo' = 'truque';
  private freio = 0;
  constructor(trem: Trem, motor: MotorEletrico) {
    this.trem = trem; this.motor = motor;
    const p = motor.p, pt = p.portador.tipo === 'trem' ? p.portador : null;
    const N = trem.cfg.N;
    const carros = (pt?.carrosMotores ?? [1]).filter((c) => c >= 1 && c <= N);
    const bog = trem.vagaoTruque.map((v, g) => (carros.includes(v) ? g : -1)).filter((g) => g >= 0);
    const mpt = pt?.motoresPorTruque ?? 2;
    this.nMot = Math.max(1, bog.length * mpt);
    this.i = p.reducao.estagios.reduce((a, s) => (a * s.Zc) / s.Zp, 1) || 1;
    this.eta = p.reducao.eta || 0.95; this.rw = pt?.rw ?? 0.43; this.massa = pt?.massaTotal ?? 100000;
    this.davis = pt?.davis ?? { A: 0.02 * this.massa, B: 0, C: 0 };
    const self = this;
    this.carga = { inercia: 0, torque(w: number) { return self.torqueEm(w); } };
    this.atualizarInercia();
    motor.acoplar(this.carga);
    this.canais = motor.fontes.map(() => new Float32Array(4096));
    // agrupamento pelo orçamento
    const livre = MAX_FONTES - trem.nProprias;
    const temAux = motor.cAux >= 0 && livre > 1;
    const nU = motor.uni.length;
    const canaisDe = (u: number, bases: string[]) => motor.canais.filter((c) => c.u === u && bases.includes(c.base)).map((c) => c.out);
    const xT = trem.xTruques, L = trem.corpo.comprimento, lc = trem.cfg.Lc - trem.cfg.vao;
    const xCarro = (v: number) => L / 2 - (v - 1) * trem.cfg.Lc - lc / 2;
    // sob o piso (a sombra do assoalho, CENA 2.5, como o rolamento): 10 cm abaixo dele, no máximo a 0,5 m do trilho
    const zMax = Math.max(0.15, trem.cfg.zPiso - 0.1);
    const fonte = (id: string, tipo: TipoFonte, x: number, z0: number, omni = false): FonteSonora => { const z = Math.min(z0, zMax); return {
      id, tipo, pos: [x, 0, z], hCorpo: z, dir: { tabela: omni ? OMNI_EL : DIR_MOTOR, eixo: [0, 1, 0], expConv: 2 }, refDist: REF_DIST_PORTADOR, dentro: false,
    }; };
    /** fonte que soma as unidades dos truques `gs` nos canais de `bases` (cada unidade com o peso √(quantos truques a usam)) */
    const somar = (gs: number[], bases: string[]) => {
      const cont = new Map<number, number>();
      gs.forEach((g, k) => { const u = (bog.indexOf(g) >= 0 ? bog.indexOf(g) : k) % nU; cont.set(u, (cont.get(u) ?? 0) + 1); });
      const ch: number[] = [], gn: number[] = [];
      for (const [u, c] of cont) for (const o of canaisDe(u, bases)) { ch.push(o); gn.push(Math.sqrt(c)); }
      return { ch: Int32Array.from(ch), g: Float64Array.from(gn) };
    };
    const MOT = ['motor', 'reducao', 'escovas'], INV = ['inversor', 'ventilador'], TUDO = [...MOT, ...INV];
    const nCar = carros.length, res = temAux ? 1 : 0;
    const temInv = motor.canais.some((c) => c.base === 'inversor' || c.base === 'ventilador');
    if ((temInv ? 2 : 1) * bog.length + res <= livre) {
      this.grupo = 'truque';
      for (const g of bog) {
        this.fontes.push(fonte(`motor.${g}`, 'eletrica', xT[g], 0.5)); this.mapa.push(somar([g], MOT));
        if (temInv) {
          const xc = xCarro(trem.vagaoTruque[g]), x = xT[g] + Math.sign(xc - xT[g]) * Math.min(2.5, Math.abs(xc - xT[g]));
          this.fontes.push(fonte(`inversor.${g}`, 'eletrica', x, 0.6)); this.mapa.push(somar([g], INV));
        }
      }
    } else {
      const porGrupo = Math.max(1, Math.ceil(nCar / Math.max(1, livre - res)));
      this.grupo = porGrupo === 1 ? 'carro' : 'grupo';
      for (let j = 0; j < nCar; j += porGrupo) {
        const cs = carros.slice(j, j + porGrupo);
        const gs = bog.filter((g) => cs.includes(trem.vagaoTruque[g]));
        const x = gs.reduce((a, g) => a + xT[g], 0) / Math.max(1, gs.length);
        this.fontes.push(fonte(`tracao.${cs[0]}`, 'eletrica', x, 0.5)); this.mapa.push(somar(gs, TUDO));
      }
    }
    if (temAux) {
      const v = Math.min(N, Math.max(1, pt?.carroAux ?? carros[0] ?? 1));
      // o conversor e a ventilação do carro: de dentro do carro se ouvem pela estrutura e pelos dutos (vias), não pelo piso
      const fa = fonte('aux', 'eletrica', xCarro(v), 0.6, true);
      fa.dentro = true; fa.vias = { cabine: { ganho: 0.5, fc: 2500 }, cofre: { ganho: 1, fc: 0 } };
      this.fontes.push(fa); this.mapa.push({ ch: Int32Array.of(motor.cAux), g: Float64Array.of(1) });
    }
  }
  private atualizarInercia() {
    const m = this.massa + this.massaExtra;
    this.carga.inercia = (1.06 * m * this.rw * this.rw) / (this.i * this.i * this.nMot);
  }
  /** rampa (fração) e massa extra (lotação, kg) */
  definirCarga(inclinacao: number, massaExtra = 0) { this.inclinacao = inclinacao; this.massaExtra = massaExtra; this.atualizarInercia(); }
  /** força resistente do trem (N): Davis A + B·v + C·v², rampa, e o freio de atrito abaixo de v_regen,min */
  forca(v: number) {
    const va = Math.abs(v), d = this.davis, m = this.massa + this.massaExtra;
    const rola = va > 0.02 ? d.A : d.A * (va / 0.02);
    const vR = this.motor.p.vRegenMin ?? 10 / 3.6;
    const atrito = this.freio > 0 && va > 0.02 && va <= vR ? this.freio * 1.0 * m : 0;
    return rola + d.B * va + d.C * va * va + atrito + m * 9.81 * Math.sin(Math.atan(this.inclinacao));
  }
  /** carga por motor: a força refletida mais a perda da engrenagem, (1 − η)·|T|, sempre contra o movimento (na regeneração
   * ela também freia: a roda vê |T|·i·(2 − η)/r_w ≈ |T|·i/(η·r_w)) */
  torqueEm(w: number) { const v = (w * this.rw) / this.i; return (this.forca(v) * this.rw) / (this.i * this.nMot) + (w > 0 ? (1 - this.eta) * Math.abs(this.motor.eixo.torque) : 0); }

  processar(saidas: Float32Array[], off: number, n: number, dt: number, cmd: ComandoPortador) {
    const k = this.trem.cinematica, vf = cmd.velocidadeFixa, m = this.motor;
    const alvo = Math.max(0, Math.min(1, cmd.pedal ?? 0));
    this.pedal = alvo < this.pedal ? alvo : Math.min(alvo, this.pedal + 0.5 * n * dt);
    this.freio = Math.max(0, Math.min(1, cmd.freio ?? 0));
    const ext = cmd as ComandoPortador & Partial<ComandoEletrico>;
    m.comandar({
      acelerador: this.pedal, freio: this.freio, ignicao: cmd.ignicao !== false, partida: false, v: Math.abs(k.v),
      omegaImposta: vf != null ? (Math.abs(vf) * this.i) / this.rw : null,
      ...(ext.modulacao !== undefined ? { modulacao: ext.modulacao } : {}),
    } as ComandoEletrico);
    m.processar(this.canais, n);
    if (vf == null) { const v = (m.eixo.omega * this.rw) / this.i; k.a = (v - k.v) / (n * dt); k.v = v; }
    this.torqueCarga = this.torqueEm(m.eixo.omega);
    const C = this.canais;
    for (let s = 0; s < this.mapa.length; s++) {
      const out = saidas[off + s], mp = this.mapa[s];
      out.fill(0, 0, n);
      for (let q = 0; q < mp.ch.length; q++) { const src = C[mp.ch[q]], g = mp.g[q]; for (let j = 0; j < n; j++) out[j] += g * src[j]; }
    }
  }
  telemetria() { return { ...this.motor.telemetria(), grupoTracao: this.grupo, fontesTracao: this.fontes.length, pedal: this.pedal }; }
}
