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
import { k1, dirDb } from './filtros';
import { corteAr, POLO_POR_CORTE } from './ar';
import { CalculoSombra, ganhosShelf } from './sombra';
import { PontoVia, type Via, type Historico } from './trajetoria';

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

export class EstadoFonte {
  f: FonteSonora;
  bx: number; by: number; bz: number;           // posição no corpo
  ax: number; ay: number; az: number;           // eixo da diretividade
  tab: readonly number[]; expConv: number; refDist: number;
  seg: Segmento;
  anel: Float32Array; mask: number; cap: number;
  // por caminho (0 direto, 1 imagem): atraso (amostras, inclui off) e derivada (amostra/amostra)
  D0 = new Float64Array(2); dD0 = new Float64Array(2); tau = new Float64Array(2);
  g = new Float64Array(2); gAlvo = new Float64Array(2);
  ativo = new Uint8Array(2);
  off = 0; offVelho = 0; xf = 0; xfN = 0;       // deslocamento inteiro e crossfade da reancoragem
  fade = 1;                                     // 0..1 depois de um salto do atraso
  // filtros
  gr = 0; kGr = 1; a1 = 0; a2 = 0; kAr = 1; kArAlvo = 1;
  sl = 0; sa = 1; sb = 1; saAlvo = 1; sbAlvo = 1;  // shelf da sombra (a abaixo, b acima de 400 Hz)
  hb = 0; cb = 0; cbAlvo = 0;                      // sombra da cabeça para trás (> 3 kHz)
  itd = new Float32Array(ITD_ANEL); itdW = 0;
  dL = 0; dR = 0; dLAlvo = 0; dRAlvo = 0;
  lpL = 0; lpR = 0; iL = 1; iR = 1; iLAlvo = 1; iRAlvo = 1;   // ILD (shelf > 1,5 kHz no ouvido oposto)
  pL = 1; pR = 1; pLAlvo = 1; pRAlvo = 1;
  gs = 0; gsAlvo = 0; ps = 0; psAlvo = 0;       // envio e panorâmica do envio
  bus = 0; peso = 1;
  iter = 0;                                     // iterações extras do ponto fixo (telemetria)
  // telemetria (caminho direto)
  ex = 0; ey = 0; ez = 0; r = 1; theta = 90; ganhoDb = -120; atrasoMs = 0;

  constructor(f: FonteSonora, seg: Segmento, fs: number, distAnel: number) {
    this.f = f; this.seg = seg;
    this.bx = f.pos[0]; this.by = f.pos[1]; this.bz = f.hCorpo ?? f.pos[2];
    const e = f.dir.eixo, ne = Math.hypot(e[0], e[1], e[2]) || 1;
    this.ax = e[0] / ne; this.ay = e[1] / ne; this.az = e[2] / ne;
    this.tab = f.dir.tabela; this.expConv = f.dir.expConv; this.refDist = f.refDist;
    let n = 1024; while (n < (distAnel / C_SOM + 0.1) * fs + 512) n <<= 1;
    this.anel = new Float32Array(n); this.mask = n - 1; this.cap = n - 512;
  }
}

export class Propagador {
  fs: number;
  fontes: EstadoFonte[] = [];
  via!: Via; hist!: Historico; corpo!: Corpo;
  pv = new PontoVia();
  sombra = new CalculoSombra();
  shelf = { a: 1, b: 1 };
  w = 0;                     // índice de escrita (absoluto) da próxima amostra
  alt = 0;
  ur = 60;
  soloGanho = 0; soloFc = 20000;
  /** expoente da distância no envio para a reverberação (0,5 = 1/√r, como o roadS) */
  expEnvio = 0.5;
  /** largura refletora (m do eixo da via) além da qual o solo vira `nenhum` (ponte); Infinity = toda */
  soloLargura = Infinity;
  regras: RegrasLocal = { diretividade: true, sombra: true, solo: true, binaural: true, rota: null, envio: 1 };
  kSh: number; kHb: number; kIld: number;
  iteracoesExtra = 0;
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
  preparar(fontes: readonly FonteSonora[], corpo: Corpo, via: Via, hist: Historico, distMax: number) {
    this.corpo = corpo; this.via = via; this.hist = hist;
    const lista = fontes.filter((f) => f.tipo !== 'pressao');
    if (lista.length > MAX_FONTES) throw new Error(`Cena: ${lista.length} fontes com propagação, o máximo é ${MAX_FONTES}`);
    const distAnel = Math.min(distMax, DIST_ANEL);
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
  rs = { sx: 0, sy: 0, sz: 0, ux: 0, uy: 0, uz: 0, r: 1, cT: 0, uN: 0, v: 0, tx: 1, ty: 0, nx: 0, ny: 1 };
  resolver(es: EstadoFonte, cam: number, tRec: number, O: GeoOuvinte) {
    const h = this.hist, via = this.via, p = this.pv, rs = this.rs;
    const oz = cam === 0 ? O.z : -O.z;
    let tau = es.tau[cam], r = 1, sx = 0, sy = 0, sz = 0;
    const lim = 1 / this.fs;
    let it = 0;
    for (; it < 6; it++) {
      const se = h.sEm(tRec - tau);
      via.ponto(se + es.bx, p);
      sx = p.x + es.by * p.nx; sy = p.y + es.by * p.ny; sz = this.alt + es.bz;
      const dx = O.x - sx, dy = O.y - sy, dz = oz - sz;
      r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const tn = r / C_SOM, d = Math.abs(tn - tau);
      tau = tn;
      if (it >= 2 && d < lim) break;
    }
    if (it > 3) this.iteracoesExtra++;
    if (r < R_MIN) r = R_MIN;
    const ux = (O.x - sx) / r, uy = (O.y - sy) / r, uz = (oz - sz) / r;   // fonte → ouvinte
    rs.sx = sx; rs.sy = sy; rs.sz = sz; rs.ux = ux; rs.uy = uy; rs.uz = uz; rs.r = r;
    rs.tx = p.tx; rs.ty = p.ty; rs.nx = p.nx; rs.ny = p.ny;
    rs.cT = ux * p.tx + uy * p.ty; rs.uN = ux * p.nx + uy * p.ny;
    rs.v = h.vEm(tRec - tau);
    return tau;
  }

  /**
   * Processa um trecho de N amostras (≤ 64) a partir de `ini` no bloco: atualiza a geometria para o
   * fim do trecho (tRec) e soma cada fonte nos acumuladores.
   */
  trecho(ini: number, N: number, tRec: number, O: GeoOuvinte) {
    const fs = this.fs, F = this.fontes, R = this.regras;
    const usaSolo = R.solo && this.soloGanho > 0;
    const corpo = this.corpo;
    for (let i = 0; i < F.length; i++) {
      const es = F[i];
      // ---------------- geometria no fim do trecho
      for (let cam = 0; cam < 2; cam++) {
        if (cam === 1 && !usaSolo) { es.ativo[1] = 0; es.gAlvo[1] = 0; continue; }
        const tau = this.resolver(es, cam, tRec, O);
        const rs = this.rs;
        const M = rs.v / C_SOM, mc = M * rs.cT;            // M·cosθ_e (velocidade · direção fonte→ouvinte)
        let conv = Math.pow(Math.max(0.05, Math.abs(1 - mc)), -es.expConv);
        if (conv > 4) conv = 4;
        // dτ/dt = û·(v_s − v_O)/(c + û·v_s), û = ouvinte → fonte
        const usv = -rs.v * rs.cT;
        const uvo = -(rs.ux * O.vx + rs.uy * O.vy + rs.uz * O.vz);
        const dtau = (usv - uvo) / (C_SOM + usv);
        let gd = 1;
        if (R.diretividade && !es.f.dentro) {
          const cosD = es.ax * rs.cT + es.ay * rs.uN + es.az * rs.uz;
          const th = Math.acos(cosD < -1 ? -1 : cosD > 1 ? 1 : cosD) * 57.29577951308232;
          gd = Math.pow(10, dirDb(es.tab, th) / 20);
        }
        let g = conv * gd * es.refDist / rs.r;
        if (cam === 0) {
          // telemetria, envio, ar, sombra e cabeça vêm do caminho direto
          es.ex = rs.sx; es.ey = rs.sy; es.ez = rs.sz; es.r = rs.r; es.atrasoMs = tau * 1000;
          es.theta = Math.acos(Math.max(-1, Math.min(1, rs.v >= 0 ? rs.cT : -rs.cT))) * 57.29577951308232;
          es.kArAlvo = k1(fs, Math.min(0.45 * fs, corteAr(rs.r, this.ur) * POLO_POR_CORTE));
          let A100 = 0, A1k = 0;
          if (R.sombra && !es.f.dentro) {
            const sg = es.seg;
            const lyO = es.by + rs.r * rs.uN, lzO = es.bz + rs.r * rs.uz;
            this.sombra.calcular(es.by, es.bz, lyO, lzO, rs.r * rs.cT, sg.largura, sg.altura, sg.zPiso);
            A100 = this.sombra.a100; A1k = this.sombra.a1k;
          }
          ganhosShelf(A100, A1k, this.shelf);
          es.saAlvo = this.shelf.a; es.sbAlvo = this.shelf.b;
          es.ganhoDb = 20 * Math.log10(g * Math.pow(10, -A100 / 20) / es.refDist + 1e-12);
          // envio: 1/√r como o roadS do Ronco (1,2/√r com a fonte a 5 m); sem a diretividade (o campo
          // reverberante recebe a potência irradiada em todas as direções). Em ambientes que guiam o som
          // (túnel) o expoente da distância é menor: `expEnvio`.
          // (o envio é tirado do sinal já com o ganho direto g = conv·D·refDist/r, então aqui vai a razão)
          const gEnvio = conv * (es.refDist / 5) * 1.2 * Math.pow(Math.max(rs.r, 3), -this.expEnvio) * Math.pow(3, this.expEnvio - 0.5);
          es.gsAlvo = g > 1e-12 ? (R.envio * gEnvio) / g : 0;
          // cabeça: direção de chegada = ouvinte → ponto de emissão
          const dx = -rs.ux, dy = -rs.uy;
          const lat = dx * O.lx + dy * O.ly, fr = dx * O.fx + dy * O.fy;   // seno lateral (com elevação) e frente
          if (R.binaural) {
            const az = Math.atan2(lat, fr);                 // + = esquerda
            const pan = -lat * LARGURA_PAN;                 // + = direita
            const a = (pan + 1) * Math.PI / 4;
            es.pLAlvo = Math.cos(a) * Math.SQRT2; es.pRAlvo = Math.sin(a) * Math.SQRT2;
            const itd = ITD_MAX * fs * Math.abs(lat);
            es.dLAlvo = lat < 0 ? itd : 0; es.dRAlvo = lat > 0 ? itd : 0;
            // shelf de 1 polo em 1,5 kHz com o ganho resolvido para dar −6·|sin az| dB em 4 kHz
            const T = Math.pow(10, (-6 * Math.abs(lat)) / 20), u2 = (4000 / 1500) * (4000 / 1500);
            const gi = Math.sqrt(Math.max(0, (T * T * (1 + u2) - 1) / u2));
            es.iLAlvo = lat < 0 ? gi : 1; es.iRAlvo = lat > 0 ? gi : 1;
            const tras = Math.abs(az) * 57.29577951308232;
            const w = tras <= 110 ? 0 : tras >= 130 ? 1 : (tras - 110) / 20;
            es.cbAlvo = w * (1 - Math.pow(10, -3 / 20));
            es.psAlvo = 0.25 * Math.max(-1, Math.min(1, pan / LARGURA_PAN));
          } else {
            es.pLAlvo = 1; es.pRAlvo = 1; es.dLAlvo = 0; es.dRAlvo = 0; es.iLAlvo = 1; es.iRAlvo = 1; es.cbAlvo = 0; es.psAlvo = 0;
          }
        } else {
          // reflexão: só onde o ponto de reflexão cai sobre o solo refletor (ponte: tabuleiro)
          let ok = 1;
          if (this.soloLargura < Infinity) {
            const fr = es.bz + this.alt, fo = O.z, t = fr / Math.max(1e-6, fr + fo);
            const yr = rs.sy + (O.y - rs.sy) * t - this.via.yOuvinte;
            ok = Math.abs(yr) <= this.soloLargura ? 1 : 0;
          }
          g *= this.soloGanho * ok;
        }
        es.gAlvo[cam] = g * es.fade;
        // atraso em amostras no fim do trecho; salto (fonte que reapareceu do outro lado da reta) → fade
        const D1 = tau * fs;
        if (this.primeiro || !es.ativo[cam]) {
          es.D0[cam] = D1 - dtau * N; es.dD0[cam] = dtau; es.g[cam] = cam === 0 || this.primeiro ? g * es.fade : 0;
          if (cam === 0) this.ancorar(es, D1, true);
          es.ativo[cam] = 1;
        } else if (Math.abs(D1 - es.D0[cam]) > 2 * N + 8) {
          es.D0[cam] = D1 - dtau * N; es.dD0[cam] = dtau; es.fade = 0; es.g[cam] = 0; es.gAlvo[cam] = 0;
          if (cam === 0) this.ancorar(es, D1, true);
        }
        es.tau[cam] = tau;
        // guarda o alvo e a derivada no fim; o laço usa D0/dD0 do início
        this.alvoD[cam] = D1; this.alvoDD[cam] = dtau;
      }
      if (es.fade < 1) es.fade = Math.min(1, es.fade + N / (0.05 * fs));
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

  private ancorar(es: EstadoFonte, D: number, agora: boolean) {
    const novo = Math.max(0, Math.round(D - 0.6 * es.cap));
    if (agora) { es.off = novo; es.xfN = 0; }
    else { es.offVelho = es.off; es.off = novo; es.xfN = Math.round(0.05 * this.fs); es.xf = 0; }
  }
  private verificarAncora(es: EstadoFonte, D1: number, D2: number) {
    if (es.xfN > 0) return;
    const lo = D1 - es.off, hi = D2 - es.off;
    if ((es.off > 0 && lo < 0.25 * es.cap) || hi > 0.9 * es.cap) {
      const novo = Math.max(0, Math.round(D1 - 0.6 * es.cap));
      if (novo !== es.off) this.ancorar(es, D1, false);
    }
  }

  /** laço por amostra de uma fonte num trecho */
  private somar(es: EstadoFonte, ini: number, N: number, usaSolo: boolean) {
    const a = es.anel, m = es.mask, invN = 1 / N;
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
    let sa = es.sa, sb = es.sb; const dsa = (es.saAlvo - sa) * invN, dsb = (es.sbAlvo - sb) * invN;
    let pL = es.pL, pR = es.pR; const dpL = (es.pLAlvo - pL) * invN * es.peso, dpR = (es.pRAlvo - pR) * invN * es.peso;
    pL *= es.peso; pR *= es.peso;
    let dL = es.dL, dR = es.dR; const ddL = (es.dLAlvo - dL) * invN, ddR = (es.dRAlvo - dR) * invN;
    let iL = es.iL, iR = es.iR; const diL = (es.iLAlvo - iL) * invN, diR = (es.iRAlvo - iR) * invN;
    let cb = es.cb; const dcb = (es.cbAlvo - cb) * invN;
    let gs = es.gs; const dgs = (es.gsAlvo - gs) * invN;
    let ps = es.ps; const dps = (es.psAlvo - ps) * invN;
    const kAr = es.kArAlvo, kGr = this.kGr, kSh = this.kSh, kHb = this.kHb, kI = this.kIld;
    let gr = es.gr, a1 = es.a1, a2 = es.a2, sl = es.sl, hb = es.hb, lpL = es.lpL, lpR = es.lpR;
    const itd = es.itd; let iw = es.itdW;
    let w = this.w + ini;
    // crossfade da reancoragem
    const xfOn = es.xfN > 0;
    const off = es.off, offV = es.offVelho;
    let xf = es.xf; const dxf = xfOn ? 1 / es.xfN : 0;
    const cap = es.cap;
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
      a1 += kAr * (s - a1); a2 += kAr * (a1 - a2);
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
    es.sa = es.saAlvo; es.sb = es.sbAlvo; es.pL = es.pLAlvo; es.pR = es.pRAlvo; es.dL = es.dLAlvo; es.dR = es.dRAlvo;
    es.iL = es.iLAlvo; es.iR = es.iRAlvo; es.cb = es.cbAlvo; es.gs = es.gsAlvo; es.ps = es.psAlvo; es.kAr = kAr;
    es.gr = gr; es.a1 = a1; es.a2 = a2; es.sl = sl; es.hb = hb; es.lpL = lpL; es.lpR = lpR; es.itdW = iw;
    if (xfOn) { es.xf = xf; es.xfN = xf >= 1 ? 0 : es.xfN; }
  }

  /** ganho do solo (tabela 2.4) */
  kGr = 1;
  definirSolo(ganho: number, fc: number) { this.soloGanho = ganho; this.soloFc = fc; this.kGr = k1(this.fs, Math.min(fc, 0.45 * this.fs)); }

  /** aplica as regras de local a cada fonte (barramento e peso) */
  aplicarRegras(r: RegrasLocal) {
    this.regras = r;
    this.fontes.forEach((es, i) => { const x = r.rota ? r.rota(es.f, i) : { bus: 0, peso: 1 }; es.bus = x.bus; es.peso = x.peso; });
  }

  zerarAcumuladores(n: number) {
    this.accL[0].fill(0, 0, n); this.accR[0].fill(0, 0, n); this.accL[1].fill(0, 0, n); this.accR[1].fill(0, 0, n);
    this.envL.fill(0, 0, n); this.envR.fill(0, 0, n);
  }
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
