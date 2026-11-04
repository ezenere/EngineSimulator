// Portador trem de N vagões (CENA.md 4.6), etapa 1 sem motor próprio (compatibilidade "nenhum × trem";
// o motor elétrico entra na etapa 6). Padrões: trem-bala tipo Shinkansen/ICE.
//
// Geometria no referencial do corpo: x = 0 no centro, frente em +L/2. Vagão c (0 = o da frente) começa
// em x_c = L/2 − c·L_c e tem L_c − vão de corpo; L = N·L_c − vão. Truques a `truqueExtremidade` de cada
// ponta (8 m de um ao outro através do vão, L_c − 8 dentro do vagão), vãos no meio da junção.
//
// Fontes (refDist 7,5 m; v_ref 300 km/h; L_W dB(A) re 1 pW), tabela de 4.6:
//   truque.k (rolamento) ×2N, 123 dB(A), n 3 · truque.k.aero ×2N, 119, n 6 (pico 160 Hz)
//   corpo.k (aero) ×N, 122, n 6, na face voltada ao ouvinte, z 1,8
//   vao.k ×(N−1), 119, n 6 · pantografo.k ×2, 125 (115 carenado), n 6, z 5
//   nariz / cauda (aero, pico 300 Hz) 119, n 6, mais as fontes 'pressao' (campo próximo, calculado pela Cena)
//
// Diretividade: o CENA.md não dá tabela para essas fontes. O rolamento usa um dipolo lateral brando
// (eixo y, −4 dB ao longo da via; a roda vibra na direção do eixo do rodeiro); as aerodinâmicas são
// omnidirecionais. expConv: rolamento 2 (monopolo), aero/vão/pantógrafo 3 (dipolo), como em 2.1.
import type { FonteSonora, Diretividade, Vec3, TipoFonte } from '../scene/tipos';
import type { Portador, Corpo, Cinematica, ComandoPortador, TelemetriaPortador, Motor, FamiliaMotor, Segmento } from './tipos';
import { COMPAT, validarCompat } from './compat';
import { FonteRuido, FonteRolamento, FonteAero, FonteVao, FontePantografo, FonteTom } from './ruido';

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
}

export const TREM_PADRAO: ConfigTrem = {
  N: 10, Lc: 25, vao: 0.5, largura: 3.36, altura: 3.6, zPiso: 0.4, lNariz: 12, lCauda: 12,
  truqueExtremidade: 3.75, eixosPorTruque: 2, distEixos: 2.5, diametroRoda: 0.86,
  pantografos: [3, 8], carenagem: true, dormente: 0.6, achatamento: 0,
  areaFrontal: 11.2, cd: 0.2, cpNariz: 0.14, massaSuperficial: 25, fCabine: 45, vTransicao: 300,
  ladoOuvinte: -1, semente: 0x7a11, tom: null, soTom: false,
};

/** níveis de potência (4.6) */
export const LW_TREM = { rolamento: 123, truqueAero: 119, corpo: 122, vao: 119, pantografo: 125, pantografoCarenado: 115, narizCauda: 119 } as const;
export const V_REF_TREM = 300 / 3.6;
export const REF_DIST_PORTADOR = 7.5;

const OMNI: Diretividade['tabela'] = [0, 0, 0, 0, 0, 0, 0];
/** roda: a vibração axial do rodeiro irradia como dipolo lateral (cos θ, limitado a −20 dB ao longo da via) */
const DIP_LATERAL: Diretividade['tabela'] = [0, -1.2, -6, -20, -6, -1.2, 0];
/** fontes de parede (camada limite na face, boca do vão, cavidade do truque): dipolo normal à face */
const DIP_FACE: Diretividade['tabela'] = [0, -1, -3, -6, -3, -1, 0];

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
    for (let k = 0; k < c.N; k++) this.xTruques.push(xf(k) - te, xf(k) - lc + te);
    // rolamento por truque
    this.xTruques.forEach((x, k) => {
      lista.push({ id: `truque.${k}`, tipo: 'rolamento', pos: [x, 0, 0.3], hCorpo: 0.3, dir: d(DIP_LATERAL, [0, 1, 0], 2), refDist: R, dentro: false });
      ger.push(new FonteRolamento(fs, { lw: LW_TREM.rolamento, n: 3, vRef: vr, refDist: R }, prox(), c.dormente, c.achatamento, c.diametroRoda));
    });
    // aerodinâmico do truque (cavidade, 160 Hz)
    this.xTruques.forEach((x, k) => {
      lista.push({ id: `truque.${k}.aero`, tipo: 'aero', pos: [x, 0, 0.5], dir: d(DIP_FACE, [0, 1, 0], 3), refDist: R, dentro: false });
      ger.push(new FonteAero(fs, { lw: LW_TREM.truqueAero, n: 6, vRef: vr, refDist: R }, prox(), 160));
    });
    // corpo de cada vagão, na face voltada ao ouvinte
    for (let k = 0; k < c.N; k++) {
      lista.push({ id: `corpo.${k}`, tipo: 'aero', pos: [xf(k) - lc / 2, c.ladoOuvinte * (c.largura / 2 + 0.01), 1.8], dir: d(DIP_FACE, [0, 1, 0], 3), refDist: R, dentro: false });
      ger.push(new FonteAero(fs, { lw: LW_TREM.corpo, n: 6, vRef: vr, refDist: R }, prox(), 350));
    }
    // vãos
    for (let k = 0; k < c.N - 1; k++) {
      lista.push({ id: `vao.${k}`, tipo: 'vao', pos: [xf(k) - lc - c.vao / 2, 0, 1.8], dir: d(DIP_FACE, [0, 1, 0], 3), refDist: R, dentro: false });
      ger.push(new FonteVao(fs, { lw: LW_TREM.vao, n: 6, vRef: vr, refDist: R }, prox(), c.vao));
    }
    // pantógrafos
    c.pantografos.forEach((p, k) => {
      if (p < 1 || p > c.N) return;
      lista.push({ id: `pantografo.${k}`, tipo: 'pantografo', pos: [xf(p - 1) - lc / 2, 0, 5.0], dir: d(OMNI, [1, 0, 0], 3), refDist: R, dentro: false });
      ger.push(new FontePantografo(fs, { lw: c.carenagem ? LW_TREM.pantografoCarenado : LW_TREM.pantografo, n: 6, vRef: vr, refDist: R }, prox()));
    });
    // nariz e cauda: aero (pico 300 Hz) e pressão (campo próximo)
    lista.push({ id: 'nariz', tipo: 'aero', pos: [L / 2, 0, 1.8], dir: d(OMNI, [1, 0, 0], 3), refDist: R, dentro: false });
    ger.push(new FonteAero(fs, { lw: LW_TREM.narizCauda, n: 6, vRef: vr, refDist: R }, prox(), 300));
    lista.push({ id: 'cauda', tipo: 'aero', pos: [-L / 2, 0, 1.8], dir: d(OMNI, [1, 0, 0], 3), refDist: R, dentro: false });
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
    for (const g of ger) if (g instanceof FonteRuido) g.calibrar();
    this.lista = lista; this.geradores = ger;
  }

  acoplar(motor: Motor | null) {
    validarCompat('trem', motor);
    if (motor) throw new Error('trem com motor elétrico: etapa 6 (TODO); na etapa 1 o trem anda sem motor');
    this.motor = null;
  }
  comandar(c: ComandoPortador) { this.cmd = { ...this.cmd, ...c }; }
  fontes(): readonly FonteSonora[] { return this.lista; }

  processar(saidas: Float32Array[], n: number, dt: number) {
    const k = this.cinematica;
    const vf = this.cmd.velocidadeFixa;
    if (vf != null) { k.a = 0; k.v = vf; }
    const G = this.geradores, so = this.cfg.soTom, tipos = this.cfg.tipos;
    for (let i = 0; i < G.length; i++) {
      const g = G[i], out = saidas[i];
      if (!g) { out.fill(0, 0, n); continue; }
      if (g instanceof FonteTom) { g.preencher(out, n); continue; }
      if (so || (tipos && !tipos.includes(this.lista[i].tipo))) { out.fill(0, 0, n); continue; }
      g.ajustar(k.v);
      g.preencher(out, n);
    }
    k.s += k.v * n * dt;
  }

  telemetria(): TelemetriaPortador {
    return { v: this.cinematica.v, s: this.cinematica.s, rpmEixo: 0, torqueCarga: 0, fontes: this.lista.length, comprimento: this.corpo.comprimento };
  }
}
