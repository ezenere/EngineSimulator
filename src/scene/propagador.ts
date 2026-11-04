// Propagador de fontes (CENA.md 2.1–2.5, 3.3 e 5.1): um anel por fonte, histórico de poses do corpo,
// tempo de emissão por ponto fixo, leitura com atraso fracionário (Hermite) e o atraso interpolado
// por parábola dentro do bloco de controle, 1/r, amplificação convectiva, diretividade, ar (2 polos),
// solo por fonte-imagem, sombra do corpo (shelf de Maekawa), ITD/ILD e panorâmica.
//
// Orçamento (5.1): MAX_FONTES anéis, geometria (raiz, acos, Maekawa) só a cada 64 amostras, nada é
// alocado depois de preparar(). O anel guarda só os últimos DIST_ANEL/c + 0,1 s; o que passa disso
// vira um deslocamento inteiro fixo (`off`), reancorado com crossfade de potência constante de 50 ms
// quando o trecho variável sai da janela. O Doppler vem da VARIAÇÃO do atraso, que fica toda no anel.
import type { FonteSonora } from './tipos';
import type { Corpo, Segmento } from '../carriers/tipos';
import { C_SOM, MAX_FONTES, R_MIN, DIST_ANEL, ITD_MAX } from './constantes';
import { k1 } from './filtros';
import { corteAr, alfa1k, POLO_POR_CORTE } from './ar';
import { CalculoSombra, ganhosShelf } from './sombra';
import { PontoVia, type Via, type Historico } from './trajetoria';
import { raizesEmissao } from './supersonico';

const TAU = Math.PI * 2;
const ITD_ANEL = 128;          // amostras (2,7 ms a 48 kHz)
const LARGURA_PAN = 0.5;       // ver docs/TECNICO.md: pan inteiro (lei de −3 dB) zeraria o ouvido oposto a 90°

/** Geometria do ouvinte num instante (preenchida pela Cena a cada bloco de controle). */
export class GeoOuvinte {
  x = 0; y = 0; z = 1.6;            // mundo
  vx = 0; vy = 0; vz = 0;           // m/s (o gimbal anda com o corpo)
  fx = 0; fy = 1;                   // para onde a cabeça olha (horizontal, unitário)
  lx = -1; ly = 0;                  // esquerda da cabeça
}

/** Regras por local do ouvinte (3.3). */
export interface RegrasLocal {
  diretividade: boolean; sombra: boolean; solo: boolean; binaural: boolean;
  /** barramento por fonte (0 direto, 1 filtrado pelo local) e peso; null = barramento 0, peso 1 */
  rota: ((f: FonteSonora, i: number) => { bus: number; peso: number }) | null;
  envio: number;                    // fração do envio para a reverberação
}

// índices do estado mutável de cada fonte
const S_OFF = 0;
const S_OFFVELHO = 1;
const S_XF = 2;
const S_XFN = 3;
const S_FADE = 4;
const S_GR = 5;
const S_A1 = 6;
const S_A2 = 7;
const S_KAR = 8;
const S_KARALVO = 9;
const S_SL = 10;
const S_SA = 11;
const S_SB = 12;
const S_SAALVO = 13;
const S_SBALVO = 14;
const S_HB = 15;
const S_CB = 16;
const S_CBALVO = 17;
const S_ITDW = 18;
const S_DL = 19;
const S_DR = 20;
const S_DLALVO = 21;
const S_DRALVO = 22;
const S_LPL = 23;
const S_LPR = 24;
const S_IL = 25;
const S_IR = 26;
const S_ILALVO = 27;
const S_IRALVO = 28;
const S_PL = 29;
const S_PR = 30;
const S_PLALVO = 31;
const S_PRALVO = 32;
const S_GS = 33;
const S_GSALVO = 34;
const S_PS = 35;
const S_PSALVO = 36;
const S_PESO = 37;
const S_EX = 38;
const S_EY = 39;
const S_EZ = 40;
const S_R = 41;
const S_THETA = 42;
const S_GANHODB = 43;
const S_ATRASOMS = 44;
// ar em 1ª ordem bilinear: b0 = b1 (zero em Nyquist), c1 (polo), e a entrada anterior de cada polo
const S_B1 = 45;
const S_X1 = 46;
const S_X2 = 47;
const N_ESTADO = 48;
export const S_ESTADO = { sa: S_SA, sb: S_SB, fade: S_FADE, ganhoDb: S_GANHODB };

export class EstadoFonte {
  f: FonteSonora;
  bx: number; by: number; bz: number;           // posição no corpo
  ax: number; ay: number; az: number;           // eixo da diretividade
  tab: readonly number[]; expConv: number; refDist: number;
  /** corte (Hz) de um passa-baixa por ângulo (FonteSonora.agudo), ou null */
  agudo: readonly number[] | null;
  seg: Segmento;
  anel: Float32Array; mask: number; cap: number;
  // por caminho (0 direto, 1 imagem): atraso (amostras, inclui off) e derivada (amostra/amostra)
  D0 = new Float64Array(2); dD0 = new Float64Array(2); tau = new Float64Array(2);
  g = new Float64Array(2); gAlvo = new Float64Array(2);
  ativo = new Uint8Array(2);
  /**
   * Estado mutável em ponto flutuante (índices S_*): num Float64Array, não em campos do objeto. Com ~50
   * campos numéricos o V8 deixava a representação deles como `Any` (marcada) e cada escrita de um double
   * alocava um HeapNumber (~100 MB/s de lixo com 63 fontes); escrever num Float64Array não aloca.
   */
  s = new Float64Array(N_ESTADO);
  itd = new Float32Array(ITD_ANEL);             // anel curto do ITD
  /** resolvedor fechado (M >= 0,9): por caminho e raiz, [atraso anterior (amostras), ganho anterior] */
  sup = new Float64Array(8);
  bus = 0;
  iter = 0;                                     // iterações extras do ponto fixo (telemetria)
  get ex() { return this.s[S_EX]; } get ey() { return this.s[S_EY]; } get ez() { return this.s[S_EZ]; }
  get r() { return this.s[S_R]; } get theta() { return this.s[S_THETA]; } get ganhoDb() { return this.s[S_GANHODB]; } get atrasoMs() { return this.s[S_ATRASOMS]; }
  get sa() { return this.s[S_SA]; } get sb() { return this.s[S_SB]; } get fade() { return this.s[S_FADE]; }

  constructor(f: FonteSonora, seg: Segmento, fs: number, distAnel: number) {
    this.f = f; this.seg = seg;
    this.bx = f.pos[0]; this.by = f.pos[1]; this.bz = f.hCorpo ?? f.pos[2];
    const e = f.dir.eixo, ne = Math.hypot(e[0], e[1], e[2]) || 1;
    this.ax = e[0] / ne; this.ay = e[1] / ne; this.az = e[2] / ne;
    this.tab = f.dir.tabela; this.expConv = f.dir.expConv; this.refDist = f.refDist;
    this.agudo = f.agudo ?? null;
    let n = 1024; while (n < (distAnel / C_SOM + 0.1) * fs + 512) n <<= 1;
    this.anel = new Float32Array(n); this.mask = n - 1; this.cap = n - 512;
    const v = this.s;
    v[S_FADE] = 1; v[S_KAR] = 0; v[S_KARALVO] = 1; v[S_B1] = 0; v[S_SA] = 1; v[S_SB] = 1; v[S_SAALVO] = 1; v[S_SBALVO] = 1;
    v[S_IL] = 1; v[S_IR] = 1; v[S_ILALVO] = 1; v[S_IRALVO] = 1; v[S_PL] = 1; v[S_PR] = 1; v[S_PLALVO] = 1; v[S_PRALVO] = 1;
    v[S_PESO] = 1; v[S_R] = 1; v[S_THETA] = 90; v[S_GANHODB] = -120;
  }
}

export class Propagador {
  fs: number;
  fontes: EstadoFonte[] = [];
  via!: Via; hist!: Historico; corpo!: Corpo;
  pv = new PontoVia();
  sombra = new CalculoSombra();
  shelf = new Float64Array(2);   // ganhos do shelf da sombra (a, b)
  w = 0;                     // índice de escrita (absoluto) da próxima amostra
  alt = 0;
  ur = 60;
  soloGanho = 0; soloFc = 20000;
  /** expoente da distância no envio para a reverberação (0,5 = 1/√r, como o roadS) */
  expEnvio = 0.5;
  /** largura refletora (m do eixo da via) além da qual o solo vira `nenhum` (ponte); Infinity = toda */
  soloLargura = Infinity;
  /** velocidade do som (m/s): 343 a 20 °C; o modo de testes muda pela temperatura (definirTemperatura na Cena) */
  c = C_SOM;
  regras: RegrasLocal = { diretividade: true, sombra: true, solo: true, binaural: true, rota: null, envio: 1 };
  kSh: number; kHb: number; kIld: number;
  iteracoesExtra = 0;
  urCache = -1; a1kCache = 0.0037;
  // acumuladores por barramento (0 e 1) e envio
  accL: Float64Array[]; accR: Float64Array[]; envL: Float64Array; envR: Float64Array;

  constructor(fs: number, blocoMax = 4096) {
    this.fs = fs;
    this.kSh = k1(fs, 400); this.kHb = k1(fs, 3000); this.kIld = k1(fs, 1500);
    this.accL = [new Float64Array(blocoMax), new Float64Array(blocoMax)];
    this.accR = [new Float64Array(blocoMax), new Float64Array(blocoMax)];
    this.envL = new Float64Array(blocoMax); this.envR = new Float64Array(blocoMax);
  }

  /** Cria um anel por fonte (exceto 'pressao', que é campo próximo). Aloca: chamar fora do laço. */
  preparar(fontes: readonly FonteSonora[], corpo: Corpo, via: Via, hist: Historico, distMax: number, anelCompleto = false) {
    this.corpo = corpo; this.via = via; this.hist = hist;
    const lista = fontes.filter((f) => f.tipo !== 'pressao');
    if (lista.length > MAX_FONTES) throw new Error(`Cena: ${lista.length} fontes com propagação, o máximo é ${MAX_FONTES}`);
    // (o avião, com poucas fontes, guarda o anel inteiro: o resolvedor fechado lê atrasos de vários segundos, 5.1)
    const distAnel = anelCompleto ? distMax : Math.min(distMax, DIST_ANEL);
    this.fontes = lista.map((f) => new EstadoFonte(f, segmentoEm(corpo, f.pos[0]), this.fs, distAnel));
    this.indices = fontes.map((f) => lista.indexOf(f));
    this.primeiro = true;
  }
  /** índice da fonte em fontes() → índice do estado (−1 para 'pressao') */
  indices: number[] = [];
  primeiro = true;

  /** grava o bloco de cada fonte no seu anel */
  escrever(canais: Float32Array[], n: number) {
    const F = this.fontes, idx = this.indices;
    for (let c = 0; c < idx.length; c++) {
      const i = idx[c]; if (i < 0) continue;
      const es = F[i], a = es.anel, m = es.mask, x = canais[c];
      let w = this.w;
      for (let k = 0; k < n; k++) a[(w++) & m] = x[k];
    }
  }
  avancar(n: number) { this.w += n; }

  /**
   * Resolve o tempo de emissão de uma fonte por um caminho (0 direto, 1 imagem) para um ouvinte em O
   * no instante tRec. Preenche o rascunho `rs` com a geometria no instante de emissão. Devolve τ (s).
   */
  /** rascunho do resolvedor (Float64Array: escrever doubles em campos de objeto aloca no V8) */
  rs = new Float64Array(15);   // sx sy sz ux uy uz r cT uN v tx ty nx ny τ
  resolver(es: EstadoFonte, cam: number, tRec: number, O: GeoOuvinte) {
    const h = this.hist, via = this.via, p = this.pv, pv = p.v, rs = this.rs, hr = h.res;
    const oz = cam === 0 ? O.z : -O.z, ox = O.x, oy = O.y;
    const bx = es.bx, by = es.by, bz = es.bz;
    let tau = es.tau[cam], r = 1, sx = 0, sy = 0, sz = 0;
    const lim = 1 / this.fs;
    let it = 0;
    for (; it < 6; it++) {
      hr[2] = tRec - tau; h.lerV();
      pv[6] = hr[0] + bx; via.pontoV(p);
      sx = pv[0] + by * pv[4]; sy = pv[1] + by * pv[5]; sz = this.alt + bz;
      const dx = ox - sx, dy = oy - sy, dz = oz - sz;
      r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const tn = r / this.c, d = Math.abs(tn - tau);
      tau = tn;
      if (it >= 2 && d < lim) break;
    }
    if (it > 3) this.iteracoesExtra++;
    if (r < R_MIN) r = R_MIN;
    const ux = (ox - sx) / r, uy = (oy - sy) / r, uz = (oz - sz) / r;   // fonte → ouvinte
    rs[0] = sx; rs[1] = sy; rs[2] = sz; rs[3] = ux; rs[4] = uy; rs[5] = uz; rs[6] = r;
    rs[10] = pv[2]; rs[11] = pv[3]; rs[12] = pv[4]; rs[13] = pv[5];
    rs[7] = ux * pv[2] + uy * pv[3]; rs[8] = ux * pv[4] + uy * pv[5];
    rs[9] = hr[1];   // v no instante de emissão (h.ler já leu s e v juntos)
    rs[14] = tau;
  }

  /**
   * Processa um trecho de N amostras (≤ 64) a partir de `ini` no bloco: atualiza a geometria para o
   * fim do trecho (tRec) e soma cada fonte nos acumuladores.
   */
  /** M >= 0,9 numa reta: a Cena liga o resolvedor fechado (supersonico.ts) no lugar do ponto fixo */
  supersonico = false;
  /** o cone de Mach da primeira fonte alcançou o ouvinte neste trecho (o critério do estrondo do legado) */
  cone = false;
  /** M e altura da primeira fonte no último trecho supersônico (para o estrondo) */
  machSup = 0; altSup = 0;
  trecho(ini: number, N: number, tRec: number, O: GeoOuvinte) {
    if (this.supersonico) { this.trechoSuper(ini, N, tRec, O); return; }
    const fs = this.fs, F = this.fontes, R = this.regras;
    const usaSolo = R.solo && this.soloGanho > 0;
    const corpo = this.corpo;
    for (let i = 0; i < F.length; i++) {
      const es = F[i];
      // ---------------- geometria no fim do trecho
      let fcDir = 1e9;
      for (let cam = 0; cam < 2; cam++) {
        if (cam === 1 && !usaSolo) { es.ativo[1] = 0; es.gAlvo[1] = 0; continue; }
        this.resolver(es, cam, tRec, O);
        const rs = this.rs, tau = rs[14];
        const M = rs[9 /*v*/] / this.c, mc = M * rs[7 /*cT*/];            // M·cosθ_e (velocidade · direção fonte→ouvinte)
        let conv = Math.pow(Math.max(0.05, Math.abs(1 - mc)), -es.expConv);
        if (conv > 4) conv = 4;
        // dτ/dt = û·(v_s − v_O)/(c + û·v_s), û = ouvinte → fonte
        const usv = -rs[9 /*v*/] * rs[7 /*cT*/];
        const uvo = -(rs[3 /*ux*/] * O.vx + rs[4 /*uy*/] * O.vy + rs[5 /*uz*/] * O.vz);
        const dtau = (usv - uvo) / (this.c + usv);
        let gd = 1;
        // (fora, a diretividade vale sempre, 3.3; as fontes `dentro` dos portadores são omni [0…0], e as do cofre
        // de um motor de carro levam a do road() legado: para a frente ou para trás com o escape)
        if (R.diretividade) {
          const cosD = es.ax * rs[7 /*cT*/] + es.ay * rs[8 /*uN*/] + es.az * rs[5 /*uz*/];
          const th = Math.acos(cosD < -1 ? -1 : cosD > 1 ? 1 : cosD) * 57.29577951308232;
          // dirDb embutido (tabela de 7 pontos, interpolação linear em dB)
          const tb = es.tab; let xd = th / 30; xd = xd < 0 ? 0 : xd > 5.999 ? 5.999 : xd;
          const id = xd | 0;
          gd = Math.pow(10, (tb[id] + (tb[id + 1] - tb[id]) * (xd - id)) / 20);
          const ag = es.agudo;
          if (ag !== null && cam === 0) fcDir = ag[id] + (ag[id + 1] - ag[id]) * (xd - id);
        }
        let g = conv * gd * es.refDist / rs[6 /*r*/];
        if (cam === 0) {
          // telemetria, envio, ar, sombra e cabeça vêm do caminho direto
          es.s[S_EX] = rs[0 /*sx*/]; es.s[S_EY] = rs[1 /*sy*/]; es.s[S_EZ] = rs[2 /*sz*/]; es.s[S_R] = rs[6 /*r*/]; es.s[S_ATRASOMS] = tau * 1000;
          es.s[S_THETA] = Math.acos(Math.max(-1, Math.min(1, rs[9 /*v*/] >= 0 ? rs[7 /*cT*/] : -rs[7 /*cT*/]))) * 57.29577951308232;
          {
            // f_c(r) = 1000·(3/(α₁ₖ·r))^(1/1,6), limitado a [600, 20000] (ar.ts), com o α₁ₖ da umidade atual
            if (this.urCache !== this.ur) { this.urCache = this.ur; this.a1kCache = corteAr(1000, this.ur) > 0 ? alfa1k(this.ur) : 0.0037; }
            let fc = 1000 * Math.pow(3 / (this.a1kCache * Math.max(rs[6], 0.1)), 0.625);
            fc = fc < 600 ? 600 : fc > 20000 ? 20000 : fc;
            if (fcDir < fc) fc = fcDir;   // sombra do próprio corpo por ângulo (o `shade` do road() do Ronco)
            fc *= POLO_POR_CORTE;
            arBilinear(es.s, fc, fs);
          }
          let A100 = 0, A1k = 0;
          if (R.sombra && !es.f.dentro) {
            const sg = es.seg;
            const lyO = es.by + rs[6 /*r*/] * rs[8 /*uN*/], lzO = es.bz + rs[6 /*r*/] * rs[5 /*uz*/];
            const se = this.sombra.ent;
            se[0] = es.by; se[1] = es.bz; se[2] = lyO; se[3] = lzO; se[4] = rs[6] * rs[7]; se[5] = sg.largura; se[6] = sg.altura; se[7] = sg.zPiso;
            this.sombra.calcularV();
            A100 = this.sombra.a100; A1k = this.sombra.a1k;
          }
          ganhosShelf(A100, A1k, this.shelf);
          es.s[S_SAALVO] = this.shelf[0]; es.s[S_SBALVO] = this.shelf[1];
          es.s[S_GANHODB] = 20 * Math.log10(g * Math.pow(10, -A100 / 20) / es.refDist + 1e-12);
          // envio: 1/√r como o roadS do Ronco (1,2/√r com a fonte a 5 m); sem a diretividade (o campo
          // reverberante recebe a potência irradiada em todas as direções). Em ambientes que guiam o som
          // (túnel) o expoente da distância é menor: `expEnvio`.
          // (o envio é tirado do sinal já com o ganho direto g = conv·D·refDist/r, então aqui vai a razão)
          const gEnvio = conv * (es.refDist / 5) * 1.2 * Math.pow(Math.max(rs[6 /*r*/], 3), -this.expEnvio) * Math.pow(3, this.expEnvio - 0.5);
          es.s[S_GSALVO] = g > 1e-12 ? (R.envio * gEnvio) / g : 0;
          // cabeça: direção de chegada = ouvinte → ponto de emissão
          const dx = -rs[3 /*ux*/], dy = -rs[4 /*uy*/];
          const lat = dx * O.lx + dy * O.ly, fr = dx * O.fx + dy * O.fy;   // seno lateral (com elevação) e frente
          if (R.binaural) {
            const az = Math.atan2(lat, fr);                 // + = esquerda
            const pan = -lat * LARGURA_PAN;                 // + = direita
            const a = (pan + 1) * Math.PI / 4;
            es.s[S_PLALVO] = Math.cos(a) * Math.SQRT2; es.s[S_PRALVO] = Math.sin(a) * Math.SQRT2;
            const itd = ITD_MAX * fs * Math.abs(lat);
            es.s[S_DLALVO] = lat < 0 ? itd : 0; es.s[S_DRALVO] = lat > 0 ? itd : 0;
            // shelf de 1 polo em 1,5 kHz com o ganho resolvido para dar −6·|sin az| dB em 4 kHz
            const T = Math.pow(10, (-6 * Math.abs(lat)) / 20), u2 = (4000 / 1500) * (4000 / 1500);
            const gi = Math.sqrt(Math.max(0, (T * T * (1 + u2) - 1) / u2));
            es.s[S_ILALVO] = lat < 0 ? gi : 1; es.s[S_IRALVO] = lat > 0 ? gi : 1;
            const tras = Math.abs(az) * 57.29577951308232;
            const w = tras <= 110 ? 0 : tras >= 130 ? 1 : (tras - 110) / 20;
            es.s[S_CBALVO] = w * (1 - Math.pow(10, -3 / 20));
            es.s[S_PSALVO] = 0.25 * Math.max(-1, Math.min(1, pan / LARGURA_PAN));
          } else {
            es.s[S_PLALVO] = 1; es.s[S_PRALVO] = 1; es.s[S_DLALVO] = 0; es.s[S_DRALVO] = 0; es.s[S_ILALVO] = 1; es.s[S_IRALVO] = 1; es.s[S_CBALVO] = 0; es.s[S_PSALVO] = 0;
          }
        } else {
          // reflexão: só onde o ponto de reflexão cai sobre o solo refletor (ponte: tabuleiro)
          let ok = 1;
          if (this.soloLargura < Infinity) {
            const fr = es.bz + this.alt, fo = O.z, t = fr / Math.max(1e-6, fr + fo);
            const yr = rs[1 /*sy*/] + (O.y - rs[1 /*sy*/]) * t - this.via.yOuvinte;
            ok = Math.abs(yr) <= this.soloLargura ? 1 : 0;
          }
          g *= this.soloGanho * ok;
        }
        es.gAlvo[cam] = g * es.s[S_FADE];
        // atraso em amostras no fim do trecho; salto (fonte que reapareceu do outro lado da reta) → fade
        const D1 = tau * fs;
        if (this.primeiro || !es.ativo[cam]) {
          es.D0[cam] = D1 - dtau * N; es.dD0[cam] = dtau; es.g[cam] = cam === 0 || this.primeiro ? g * es.s[S_FADE] : 0;
          if (cam === 0) this.ancorar(es, D1, true);
          es.ativo[cam] = 1;
        } else if (Math.abs(D1 - es.D0[cam]) > 2 * N + 8) {
          es.D0[cam] = D1 - dtau * N; es.dD0[cam] = dtau; es.s[S_FADE] = 0; es.g[cam] = 0; es.gAlvo[cam] = 0;
          if (cam === 0) this.ancorar(es, D1, true);
        }
        es.tau[cam] = tau;
        // guarda o alvo e a derivada no fim; o laço usa D0/dD0 do início
        this.alvoD[cam] = D1; this.alvoDD[cam] = dtau;
      }
      if (es.s[S_FADE] < 1) es.s[S_FADE] = Math.min(1, es.s[S_FADE] + N / (0.05 * fs));
      // reancoragem do deslocamento (fontes a mais de DIST_ANEL)
      this.verificarAncora(es, this.alvoD[0], usaSolo ? this.alvoD[1] : this.alvoD[0]);
      this.somar(es, ini, N, usaSolo);
      es.D0[0] = this.alvoD[0]; es.dD0[0] = this.alvoDD[0];
      if (usaSolo) { es.D0[1] = this.alvoD[1]; es.dD0[1] = this.alvoDD[1]; }
    }
    this.primeiro = false;
    void corpo;
  }
  alvoD = new Float64Array(2); alvoDD = new Float64Array(2);

  /**
   * Trecho com o resolvedor fechado do jet-dsp (CENA 2.1, decisão: M ≥ 0,9 numa reta). Para cada fonte e caminho
   * (direto e imagem no solo), as raízes de (c² − v²)τ² + 2·A·v·τ − (A² + Q) = 0 (`raizesEmissao`, a cópia do
   * `geom()` legado): antes do cone nenhuma, na cáustica duas iguais, depois duas (a de maior atraso, emitida
   * chegando, toca de trás para frente). Como no legado: atraso e ganho em rampa linear dentro do trecho,
   * |1 − M·cosθ|^−expConv limitado a 4, diretividade pelo ângulo de emissão, ar pelo caminho mais curto, imagem com o
   * ganho e o passa-baixa do solo; sem ITD/ILD (o flyby não tem) e sem sombra. A primeira fonte decide o cone.
   */
  raiz = new Float64Array(2);
  tmpS = new Float64Array(64); tmpI = new Float64Array(64);
  private trechoSuper(ini: number, N: number, tRec: number, O: GeoOuvinte) {
    const fs = this.fs, F = this.fontes, R = this.regras, h = this.hist, via = this.via, p = this.pv, pv = p.v, hr = h.res, c = this.c;
    const usaSolo = R.solo && this.soloGanho > 0, invN = 1 / N;
    hr[2] = tRec; h.lerV();
    const sC = hr[0], v = hr[1], M = v / c;
    this.cone = false;
    const tmp = this.tmpS, tmpI = this.tmpI;
    for (let i = 0; i < F.length; i++) {
      const es = F[i], st = es.sup;
      pv[6] = sC + es.bx; via.pontoV(p);
      const tx = pv[2], ny = pv[5];
      const sx = pv[0], sy = pv[1] + es.by * ny, sz = this.alt + es.bz;
      const A = (sx - O.x) * tx;                       // ao longo da rota; positivo = já passou do ouvinte
      if (i === 0) { this.machSup = M; this.altSup = sz; }
      let rMin = 1e9, gDir = 0, cthP = 0, uyP = 0;
      const a = es.anel, m = es.mask | 0, cap = es.cap | 0;
      for (let k = 0; k < N; k++) { tmp[k] = 0; tmpI[k] = 0; }
      for (let cam = 0; cam < (usaSolo ? 2 : 1); cam++) {
        const oz = cam === 0 ? O.z : -O.z;
        const Q = (sy - O.y) * (sy - O.y) + (sz - oz) * (sz - oz);
        const rr = raizesEmissao(A, v, Q, this.raiz, c);
        if (i === 0 && cam === 0) this.cone = rr.cone;
        for (let slot = 0; slot < 2; slot++) {
          // como no legado: com duas raízes, slot 0 = a de maior atraso; com uma, slot 1
          const j = rr.n === 2 ? slot : rr.n === 1 && slot === 1 ? 0 : -1;
          let D = 0, g = 0;
          if (j >= 0) {
            const tau = this.raiz[j], re = c * tau, Xe = A - v * tau;
            if (tau * fs < cap - 4 && re >= 1) {
              const cth = -Xe / re;                     // > 0: emitido com o ouvinte à frente
              const uN = ((O.y - sy) * ny) / re, uz = (oz - sz) / re;
              let gd = 1;
              if (R.diretividade) {
                const cosD = es.ax * cth + es.ay * uN + es.az * uz;
                const th = Math.acos(cosD < -1 ? -1 : cosD > 1 ? 1 : cosD) * 57.29577951308232;
                const tb = es.tab; let xd = th / 30; xd = xd < 0 ? 0 : xd > 5.999 ? 5.999 : xd;
                const id = xd | 0;
                gd = Math.pow(10, (tb[id] + (tb[id + 1] - tb[id]) * (xd - id)) / 20);
              }
              let conv = Math.pow(Math.max(0.05, Math.abs(1 - M * cth)), -es.expConv);
              if (conv > 4) conv = 4;
              g = conv * gd * Math.min(4, es.refDist / Math.max(re, R_MIN)) * es.s[S_FADE];
              if (cam === 1) g *= this.soloGanho;
              D = tau * fs;
              if (cam === 0 && re < rMin) { rMin = re; gDir = g; cthP = cth; uyP = (O.y - sy) / re; }
            }
          }
          const q = cam * 4 + slot * 2;
          const gp = st[q + 1];
          let d0 = st[q]; if (gp <= 0 && g > 0) d0 = D;     // raiz nova: o atraso salta, o ganho sobe do zero
          if (g > 0 || gp > 0) {
            const d1 = g > 0 ? D : d0, dd = (d1 - d0) * invN, dg = (g - gp) * invN;
            let dk = d0, gk = gp, w = this.w + ini;
            const out = cam === 0 ? tmp : tmpI;
            for (let k = 0; k < N; k++) {
              let d = dk; if (d < 2) d = 2; else if (d > cap) d = cap;
              const pos = w - d, ip = Math.floor(pos), f = pos - ip;
              const y0 = a[(ip - 1) & m], y1 = a[ip & m], y2 = a[(ip + 1) & m], y3 = a[(ip + 2) & m];
              out[k] += gk * ((((0.5 * (y3 - y0) + 1.5 * (y1 - y2)) * f + (y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3)) * f + 0.5 * (y2 - y0)) * f + y1);
              dk += dd; gk += dg; w++;
            }
          }
          st[q] = g > 0 ? D : d0; st[q + 1] = g;
        }
      }
      // ar pelo caminho mais curto, panorâmica e envio
      if (rMin < 1e9) {
        if (this.urCache !== this.ur) { this.urCache = this.ur; this.a1kCache = corteAr(1000, this.ur) > 0 ? alfa1k(this.ur) : 0.0037; }
        let fc = 1000 * Math.pow(3 / (this.a1kCache * Math.max(rMin, 0.1)), 0.625);
        fc = (fc < 600 ? 600 : fc > 20000 ? 20000 : fc) * POLO_POR_CORTE;
        arBilinear(es.s, fc, fs);
        // direção de chegada (ouvinte → ponto de emissão) na cabeça
        const dx = -cthP * tx, dy = -uyP;
        const lat = dx * O.lx + dy * O.ly;
        if (R.binaural) { const pan = -lat * LARGURA_PAN, aa = (pan + 1) * Math.PI / 4; es.s[S_PLALVO] = Math.cos(aa) * Math.SQRT2; es.s[S_PRALVO] = Math.sin(aa) * Math.SQRT2; es.s[S_PSALVO] = 0.25 * Math.max(-1, Math.min(1, pan / LARGURA_PAN)); }
        else { es.s[S_PLALVO] = 1; es.s[S_PRALVO] = 1; es.s[S_PSALVO] = 0; }
        // envio: o mesmo do ponto fixo (1/r^e relativo ao direto), sem a diretividade
        const gGeo = Math.min(4, es.refDist / Math.max(rMin, R_MIN));
        const gEnvio = (es.refDist / 5) * 1.2 * Math.pow(Math.max(rMin, 3), -this.expEnvio) * Math.pow(3, this.expEnvio - 0.5);
        es.s[S_GSALVO] = (R.envio * gEnvio) / gGeo;
        es.s[S_EX] = sx; es.s[S_EY] = sy; es.s[S_EZ] = sz; es.s[S_R] = rMin; es.s[S_THETA] = Math.acos(Math.max(-1, Math.min(1, cthP))) * 57.29577951308232;
        es.s[S_GANHODB] = 20 * Math.log10(gDir / es.refDist + 1e-12); es.s[S_ATRASOMS] = (rMin / c) * 1000;
      } else es.s[S_GANHODB] = -120;
      if (es.s[S_FADE] < 1) es.s[S_FADE] = Math.min(1, es.s[S_FADE] + N / (0.05 * fs));
      // ar, solo e saída
      const oL = this.accL[es.bus], oR = this.accR[es.bus], eL = this.envL, eR = this.envR;
      const b0 = es.s[S_KARALVO], b1 = es.s[S_B1], c1 = es.s[S_KAR], kGr = this.kGr, peso = es.s[S_PESO];
      let a1 = es.s[S_A1], a2 = es.s[S_A2], gr = es.s[S_GR], x1 = es.s[S_X1], x2 = es.s[S_X2];
      let pL = es.s[S_PL] * peso, pR = es.s[S_PR] * peso, gs = es.s[S_GS], ps = es.s[S_PS];
      const dpL = (es.s[S_PLALVO] * peso - pL) * invN, dpR = (es.s[S_PRALVO] * peso - pR) * invN, dgs = (es.s[S_GSALVO] - gs) * invN, dps = (es.s[S_PSALVO] - ps) * invN;
      for (let k = 0; k < N; k++) {
        gr += kGr * (tmpI[k] - gr);
        const x = tmp[k] + gr;
        a1 = b0 * x + b1 * x1 - c1 * a1; x1 = x;
        a2 = b0 * a1 + b1 * x2 - c1 * a2; x2 = a1;
        const e = a2 * gs;
        eL[ini + k] += e * (1 - ps); eR[ini + k] += e * (1 + ps);
        oL[ini + k] += a2 * pL; oR[ini + k] += a2 * pR;
        pL += dpL; pR += dpR; gs += dgs; ps += dps;
      }
      es.s[S_A1] = a1; es.s[S_A2] = a2; es.s[S_GR] = gr; es.s[S_X1] = x1; es.s[S_X2] = x2;
      es.s[S_PL] = es.s[S_PLALVO]; es.s[S_PR] = es.s[S_PRALVO]; es.s[S_GS] = es.s[S_GSALVO]; es.s[S_PS] = es.s[S_PSALVO];
      // se o corpo voltar a ficar abaixo de M 0,9, o ponto fixo recomeça do zero
      es.ativo[0] = 0; es.ativo[1] = 0;
    }
    this.primeiro = false;
  }

  private ancorar(es: EstadoFonte, D: number, agora: boolean) {
    const novo = Math.max(0, Math.round(D - 0.6 * es.cap));
    if (agora) { es.s[S_OFF] = novo; es.s[S_XFN] = 0; }
    else { es.s[S_OFFVELHO] = es.s[S_OFF]; es.s[S_OFF] = novo; es.s[S_XFN] = Math.round(0.05 * this.fs); es.s[S_XF] = 0; }
  }
  private verificarAncora(es: EstadoFonte, D1: number, D2: number) {
    if (es.s[S_XFN] > 0) return;
    const lo = D1 - es.s[S_OFF], hi = D2 - es.s[S_OFF];
    if ((es.s[S_OFF] > 0 && lo < 0.25 * es.cap) || hi > 0.9 * es.cap) {
      const novo = Math.max(0, Math.round(D1 - 0.6 * es.cap));
      if (novo !== es.s[S_OFF]) this.ancorar(es, D1, false);
    }
  }

  /** laço por amostra de uma fonte num trecho */
  private somar(es: EstadoFonte, ini: number, N: number, usaSolo: boolean) {
    // (|0: o V8 não sabe o tipo dos campos de EstadoFonte; sem a coerção o clamp do atraso mistura um
    // valor marcado e o double vira HeapNumber a cada amostra)
    const a = es.anel, m = es.mask | 0, invN = 1 / N;
    const bus = es.bus, oL = this.accL[bus], oR = this.accR[bus], eL = this.envL, eR = this.envR;
    // parábolas do atraso: D(u) = D0 + D'0·u + C·u²
    let D1 = es.D0[0], inc1 = es.dD0[0];
    const C1 = (this.alvoD[0] - D1 - inc1 * N) * invN * invN;
    inc1 += C1; const dd1 = 2 * C1;
    let D2 = 0, inc2 = 0, dd2 = 0;
    if (usaSolo) { D2 = es.D0[1]; inc2 = es.dD0[1]; const C2 = (this.alvoD[1] - D2 - inc2 * N) * invN * invN; inc2 += C2; dd2 = 2 * C2; }
    // rampas lineares de ganho e filtros ao longo do trecho
    let g1 = es.g[0], g2 = es.g[1];
    const dg1 = (es.gAlvo[0] - g1) * invN, dg2 = (es.gAlvo[1] - g2) * invN;
    let sa = es.s[S_SA], sb = es.s[S_SB]; const dsa = (es.s[S_SAALVO] - sa) * invN, dsb = (es.s[S_SBALVO] - sb) * invN;
    let pL = es.s[S_PL], pR = es.s[S_PR]; const dpL = (es.s[S_PLALVO] - pL) * invN * es.s[S_PESO], dpR = (es.s[S_PRALVO] - pR) * invN * es.s[S_PESO];
    pL *= es.s[S_PESO]; pR *= es.s[S_PESO];
    let dL = es.s[S_DL], dR = es.s[S_DR]; const ddL = (es.s[S_DLALVO] - dL) * invN, ddR = (es.s[S_DRALVO] - dR) * invN;
    let iL = es.s[S_IL], iR = es.s[S_IR]; const diL = (es.s[S_ILALVO] - iL) * invN, diR = (es.s[S_IRALVO] - iR) * invN;
    let cb = es.s[S_CB]; const dcb = (es.s[S_CBALVO] - cb) * invN;
    let gs = es.s[S_GS]; const dgs = (es.s[S_GSALVO] - gs) * invN;
    let ps = es.s[S_PS]; const dps = (es.s[S_PSALVO] - ps) * invN;
    const b0 = es.s[S_KARALVO], b1 = es.s[S_B1], c1 = es.s[S_KAR], kGr = this.kGr, kSh = this.kSh, kHb = this.kHb, kI = this.kIld;
    let gr = es.s[S_GR], a1 = es.s[S_A1], a2 = es.s[S_A2], sl = es.s[S_SL], hb = es.s[S_HB], lpL = es.s[S_LPL], lpR = es.s[S_LPR], x1 = es.s[S_X1], x2 = es.s[S_X2];
    const itd = es.itd; let iw = es.s[S_ITDW];
    let w = this.w + ini;
    // crossfade da reancoragem
    const xfOn = es.s[S_XFN] > 0;
    const off = es.s[S_OFF], offV = es.s[S_OFFVELHO];
    let xf = es.s[S_XF]; const dxf = xfOn ? 1 / es.s[S_XFN] : 0;
    const cap = es.cap | 0;
    for (let k = 0; k < N; k++) {
      // caminho direto
      let d = D1 - off; if (d < 2) d = 2; else if (d > cap) d = cap;
      let pos = w - d, ip = Math.floor(pos), f = pos - ip;
      let y0 = a[(ip - 1) & m], y1 = a[ip & m], y2 = a[(ip + 1) & m], y3 = a[(ip + 2) & m];
      let x = ((((0.5 * (y3 - y0) + 1.5 * (y1 - y2)) * f + (y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3)) * f + 0.5 * (y2 - y0)) * f + y1);
      if (xfOn) {
        let dv = D1 - offV; if (dv < 2) dv = 2; else if (dv > cap) dv = cap;
        pos = w - dv; ip = Math.floor(pos); f = pos - ip;
        y0 = a[(ip - 1) & m]; y1 = a[ip & m]; y2 = a[(ip + 1) & m]; y3 = a[(ip + 2) & m];
        const xv = ((((0.5 * (y3 - y0) + 1.5 * (y1 - y2)) * f + (y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3)) * f + 0.5 * (y2 - y0)) * f + y1);
        const ph = xf * 1.5707963267948966;
        x = x * Math.sin(ph) + xv * Math.cos(ph);
      }
      let s = g1 * x;
      // reflexão no solo
      if (usaSolo) {
        let d2 = D2 - off; if (d2 < 2) d2 = 2; else if (d2 > cap) d2 = cap;
        pos = w - d2; ip = Math.floor(pos); f = pos - ip;
        y0 = a[(ip - 1) & m]; y1 = a[ip & m]; y2 = a[(ip + 1) & m]; y3 = a[(ip + 2) & m];
        const xr = ((((0.5 * (y3 - y0) + 1.5 * (y1 - y2)) * f + (y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3)) * f + 0.5 * (y2 - y0)) * f + y1);
        gr += kGr * (xr - gr);
        s += g2 * gr;
        D2 += inc2; inc2 += dd2; g2 += dg2;
      }
      // ar (2 polos)
      a1 = b0 * s + b1 * x1 - c1 * a1; x1 = s;
      a2 = b0 * a1 + b1 * x2 - c1 * a2; x2 = a1;
      // sombra do corpo: shelf em 400 Hz
      sl += kSh * (a2 - sl);
      let y = sb * a2 + (sa - sb) * sl;
      // envio (antes da cabeça)
      const e = y * gs;
      eL[ini + k] += e * (1 - ps); eR[ini + k] += e * (1 + ps);
      // sombra da cabeça para trás (> 3 kHz)
      hb += kHb * (y - hb); y -= cb * (y - hb);
      // ITD: anel curto, leitura linear
      itd[iw & (ITD_ANEL - 1)] = y;
      let pz = iw - dL, iz = Math.floor(pz), fz = pz - iz;
      let xl = itd[iz & (ITD_ANEL - 1)]; xl += (itd[(iz + 1) & (ITD_ANEL - 1)] - xl) * fz;
      pz = iw - dR; iz = Math.floor(pz); fz = pz - iz;
      let xr2 = itd[iz & (ITD_ANEL - 1)]; xr2 += (itd[(iz + 1) & (ITD_ANEL - 1)] - xr2) * fz;
      iw++;
      // ILD: shelf > 1,5 kHz no ouvido oposto
      lpL += kI * (xl - lpL); xl = lpL + iL * (xl - lpL);
      lpR += kI * (xr2 - lpR); xr2 = lpR + iR * (xr2 - lpR);
      oL[ini + k] += xl * pL; oR[ini + k] += xr2 * pR;
      // rampas
      D1 += inc1; inc1 += dd1; g1 += dg1;
      sa += dsa; sb += dsb; pL += dpL; pR += dpR; dL += ddL; dR += ddR; iL += diL; iR += diR; cb += dcb; gs += dgs; ps += dps;
      if (xfOn) { xf += dxf; if (xf > 1) xf = 1; }
      w++;
    }
    es.g[0] = es.gAlvo[0]; es.g[1] = es.gAlvo[1];
    es.s[S_SA] = es.s[S_SAALVO]; es.s[S_SB] = es.s[S_SBALVO]; es.s[S_PL] = es.s[S_PLALVO]; es.s[S_PR] = es.s[S_PRALVO]; es.s[S_DL] = es.s[S_DLALVO]; es.s[S_DR] = es.s[S_DRALVO];
    es.s[S_IL] = es.s[S_ILALVO]; es.s[S_IR] = es.s[S_IRALVO]; es.s[S_CB] = es.s[S_CBALVO]; es.s[S_GS] = es.s[S_GSALVO]; es.s[S_PS] = es.s[S_PSALVO];
    es.s[S_X1] = x1; es.s[S_X2] = x2;
    es.s[S_GR] = gr; es.s[S_A1] = a1; es.s[S_A2] = a2; es.s[S_SL] = sl; es.s[S_HB] = hb; es.s[S_LPL] = lpL; es.s[S_LPR] = lpR; es.s[S_ITDW] = iw;
    if (xfOn) { es.s[S_XF] = xf; es.s[S_XFN] = xf >= 1 ? 0 : es.s[S_XFN]; }
  }

  /** ganho do solo (tabela 2.4) */
  kGr = 1;
  definirSolo(ganho: number, fc: number) { this.soloGanho = ganho; this.soloFc = fc; this.kGr = k1(this.fs, Math.min(fc, 0.45 * this.fs)); }

  /** aplica as regras de local a cada fonte (barramento e peso) */
  aplicarRegras(r: RegrasLocal) {
    this.regras = r;
    this.fontes.forEach((es, i) => { const x = r.rota ? r.rota(es.f, i) : { bus: 0, peso: 1 }; es.bus = x.bus; es.s[S_PESO] = x.peso; });
  }

  zerarAcumuladores(n: number) {
    this.accL[0].fill(0, 0, n); this.accR[0].fill(0, 0, n); this.accL[1].fill(0, 0, n); this.accR[1].fill(0, 0, n);
    this.envL.fill(0, 0, n); this.envR.fill(0, 0, n);
  }
}

/**
 * Coeficientes de um polo do ar, 1ª ordem bilinear com pré-distorção (polo e zero em Nyquist), em s[S_KARALVO] (b0),
 * s[S_B1] (b1) e s[S_KAR] (c1, o polo): y = b0·x + b1·x₋₁ − c1·y₋₁. O "y += k·(x − y)" de antes, com o corte limitado
 * a 0,45·fs, nunca ficava transparente: a 3–7,5 m (f_c no teto de 20 kHz) os dois polos ficavam em 21,6 kHz e tiravam
 * ~1 dB em 10 kHz e ~2 dB em 16 kHz, mais que a ISO 9613 (< 1 dB a 10 kHz em 7,5 m). Acima de 0,49·fs vira um fio.
 */
export function arBilinear(s: Float64Array, fp: number, fs: number) {
  if (fp >= 0.49 * fs) { s[S_KARALVO] = 1; s[S_B1] = 0; s[S_KAR] = 0; return; }
  const K = Math.tan((Math.PI * fp) / fs);
  s[S_KARALVO] = K / (1 + K); s[S_B1] = K / (1 + K); s[S_KAR] = (K - 1) / (K + 1);
}

/** segmento do corpo que contém a abscissa x (referencial do corpo, x = 0 no centro, frente em +L/2) */
export function segmentoEm(corpo: Corpo, x: number): Segmento {
  let frente = corpo.comprimento / 2;
  for (const s of corpo.segmentos) {
    const tras = frente - s.comprimento;
    if (x <= frente + 1e-6 && x >= tras - s.vao - 1e-6) return s;
    frente = tras - s.vao;
  }
  return corpo.segmentos[x > 0 ? 0 : corpo.segmentos.length - 1];
}

void TAU;
