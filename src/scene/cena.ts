// A Cena (CENA.md 1.5 e 2): dona do tempo de propagação. Lê os canais mono que o portador preencheu
// (Pa a refDist de cada fonte), guarda o histórico de poses do corpo, resolve o tempo de emissão de
// cada fonte e entrega o estéreo direto (binaural) e o envio para a reverberação do ambiente, em escala
// absoluta: 0 dBFS ≙ 124 dB SPL (decisão 1.5). O `tanh` e o `master` ficam no DSP do worklet (dsp-cena.ts).
//
// Campo próximo (não passa pelo anel): onda de nariz/cauda, onda de compressão do túnel, vento induzido
// e do pistão, ronco estrutural da ponte, som de fundo. A pressão inteira vai para a telemetria; ao
// alto-falante só o resíduo acima de 20 Hz.
import type { Ambiente, Trajetoria, Ouvinte, Cena, TelemetriaCena, Vec3, FonteSonora, LocalOuvinte } from './tipos';
import type { Portador } from '../carriers/tipos';
import { BLOCO_CONTROLE, PA_FS, P_REF, RAMPA, C_SOM } from './constantes';
import { Propagador, GeoOuvinte, type RegrasLocal } from './propagador';
import { Via, Historico, PontoVia } from './trajetoria';
import { SOLOS } from './solo';
import { expoenteEnvio } from './ambientes';
import { Bq, k1, PonderacaoA } from './filtros';
import { ondaNariz, OndaTunel, RuidoVento, ventoInduzido, ventoPistao } from './pressao';
import { FundoAmbiente } from './fundo';
import { Estrondo } from './estrondo';
import { RNG } from '../acoustics/rng';

/** pesos do cofre por tipo de fonte (3.3; os mesmos do `bay` do Ronco) */
const PESO_COFRE: Partial<Record<FonteSonora['tipo'], number>> = { admissao: 1.0, mecanica: 0.7, compressor: 0.8 };

/**
 * Ronco estrutural da ponte: ganho calibrado para +5 dB em 31–125 Hz na passagem do trem de validação
 * (10 vagões, 350 km/h, 3 m; `valida.ts ambientes`). O 0,042 de antes somava 0,0 dB: o ronco ficava
 * 50 dB abaixo do trem nessas bandas.
 */
export const K_PONTE = 26;

/** velocidade do som (m/s) à temperatura t (°C): 343 m/s a 20 °C */
export const velocidadeSom = (t: number) => C_SOM * Math.sqrt((273.15 + t) / 293.15);

export interface OpcoesCena { ur?: number; blocoMax?: number; /** desliga a sombra do corpo (diagnóstico) */ semSombra?: boolean; /** ganho do ronco da ponte (calibração; padrão K_PONTE) */ kPonte?: number }

export class CenaPassagem implements Cena {
  fs = 48000;
  amb!: Ambiente; traj!: Trajetoria; ouv!: Ouvinte;
  ur = 60;
  via = new Via();
  hist!: Historico;
  prop!: Propagador;
  geo = new GeoOuvinte();
  pv = new PontoVia();
  portador: Portador | null = null;
  fontesP: readonly FonteSonora[] = [];
  amostra = 0;               // índice da primeira amostra do próximo bloco
  local: LocalOuvinte = 'fora';
  // rampas de 20 ms dos parâmetros geométricos (atualizar)
  lateral = 3; lateralAlvo = 3; altitude = 0; altitudeAlvo = 0;
  pos: [number, number, number] = [0, 0, 1.6]; posAlvo: [number, number, number] = [0, 0, 1.6];
  gim = { az: 90, el: 0, r: 5 }; gimAlvo = { az: 90, el: 0, r: 5 };
  passoRampa = 1;
  soloG = 0; soloGAlvo = 0;
  // campo próximo
  tunel = new OndaTunel();
  vento: RuidoVento;
  fundo: FundoAmbiente;
  hpP: Bq[] = [new Bq(), new Bq()];
  pAnt = 0;
  narizAnt = NaN;
  // ponte
  ponteR = new RNG(0xb41d9e); ponteF: Bq[] = [new Bq(), new Bq(), new Bq()]; ponteG = 0; ponteGAlvo = 0;
  xTruques: number[] = [];
  // local: cabine (lei da massa) e cofre
  cabK1 = 1; cabK2 = 1; cabPk: Bq[] = [new Bq(), new Bq()]; cabS = new Float64Array(4);
  cofreK = 1; cofreS = new Float64Array(2);
  // cabine própria do portador (Corpo.cabine: o carro mantém a do Ronco) e vias estruturais das fontes `dentro` (3.3)
  cabProp: Bq[][] = [[], []]; cabPropG = 0; cabPropOn = false;
  viasC: number[] = []; viasG: number[] = []; viasBq: (Bq | null)[] = []; tmpV = new Float64Array(4096); tmpW = new Float64Array(4096);
  // medidores
  pa: PonderacaoA[]; eA = 0; eZ = 0; kMed = 1;
  // buffers
  bL: Float64Array; bR: Float64Array;
  tele: TelemetriaCena = { fontes: [], corpo: { s: 0, v: 0, pose: [0, 0, 0], rumo: 0 }, ouvinte: [0, 0, 0], pressaoPa: 0, ventoMs: 0, splDbA: 0, splDb: 0 };
  ventoU = 0;
  tmpP = new Float64Array(64); tmpQ = new Float64Array(64); tmpA = new Float64Array(4096); tmpB = new Float64Array(4096); tmpC = new Float64Array(4096); tmpD = new Float64Array(4096);

  semSombra = false;
  kPonte = K_PONTE;
  /** estrondo sônico (scene/estrondo.ts), disparado quando o cone de Mach da primeira fonte alcança o ouvinte */
  estrondo = new Estrondo(48000);
  inCone = false;
  /** instante (s, fim do trecho) em que o cone alcançou o ouvinte pela última vez */
  tCone = NaN;
  constructor(op: OpcoesCena = {}) {
    if (op.ur) this.ur = op.ur;
    this.semSombra = !!op.semSombra;
    this.kPonte = op.kPonte ?? K_PONTE;
    const bm = op.blocoMax ?? 4096;
    this.bL = new Float64Array(bm); this.bR = new Float64Array(bm);
    this.vento = new RuidoVento(48000);
    this.fundo = new FundoAmbiente(48000);
    this.pa = [new PonderacaoA(48000), new PonderacaoA(48000)];
  }

  configurar(amb: Ambiente, traj: Trajetoria, ouv: Ouvinte, fs: number) {
    this.fs = fs;
    this.prop = new Propagador(fs, this.bL.length);
    this.prop.ur = this.ur;
    this.prop.c = velocidadeSom(this.temperatura);
    this.vento = new RuidoVento(fs);
    this.fundo = new FundoAmbiente(fs);
    this.pa = [new PonderacaoA(fs), new PonderacaoA(fs)];
    this.estrondo = new Estrondo(fs); this.inCone = false;
    this.kMed = k1(fs, 1 / (2 * Math.PI * 0.125));   // constante 'F' (125 ms)
    this.hpP[0].hp(fs, 20, 0.7071); this.hpP[1].hp(fs, 20, 0.7071);
    this.ponteF[0].hp(fs, 31, 0.7071); this.ponteF[1].lp(fs, 125, 0.7071); this.ponteF[2].lp(fs, 125, 0.7071);
    this.passoRampa = BLOCO_CONTROLE / (RAMPA * fs);
    this.cofreK = k1(fs, 900);
    this.amb = amb; this.traj = traj; this.ouv = ouv;
    this.lateral = this.lateralAlvo = traj.lateral; this.altitude = this.altitudeAlvo = traj.altitude;
    this.pos = [...ouv.pos] as [number, number, number]; this.posAlvo = [...ouv.pos] as [number, number, number];
    this.gim = { ...ouv.gimbal }; this.gimAlvo = { ...ouv.gimbal };
    this.via.configurar(traj);
    this.aplicarAmbiente(amb, true);
    this.definirAlvos(true);
    this.portador = null;
    this.amostra = 0;
  }

  /** umidade relativa (%) da absorção do ar (2.3); padrão 60 */
  definirUmidade(ur: number) { this.ur = ur; if (this.prop) this.prop.ur = ur; }
  /**
   * Temperatura do ar (°C, modo de testes): muda a velocidade do som da propagação, c = 343·√(T/293,15 K)
   * (343 m/s a 20 °C, a das referências). A tabela de absorção (2.3) continua a de 20 °C.
   */
  temperatura = 20;
  definirTemperatura(t: number) {
    this.temperatura = Math.max(-30, Math.min(50, t));
    if (this.prop) this.prop.c = velocidadeSom(this.temperatura);
  }

  /**
   * Põe o corpo em s (o "disparar a passagem" da página): o histórico recomeça como se ele viesse
   * andando assim, a onda do túnel e a detecção da boca zeram. As fontes sentem o salto do atraso e
   * entram com o fade de 50 ms do propagador.
   */
  reposicionar(portador: Portador, s: number) {
    const c = portador.cinematica as { s: number; v: number };
    c.s = s;
    if (this.portador === portador && this.hist) this.hist.reiniciar(this.amostra / this.fs, s, c.v);
    this.tunel.zerar(); this.narizAnt = NaN;
  }

  /**
   * Lado do corpo (y do referencial do corpo) em que está o ouvinte: +1 à esquerda, −1 à direita. Para o
   * trem com duas faces (Trem.definirLado). Com histerese de 0,2 m para não alternar no plano y = 0.
   */
  ladoOuvinte: 1 | -1 = -1;
  ladoDoOuvinte(): 1 | -1 {
    if (!this.portador) return this.ladoOuvinte;
    let y: number;
    if (this.ouv.modo === 'gimbal') y = this.posGimbalCorpo()[1];
    else {
      const p = this.via.ponto(this.portador.cinematica.s, this.pv);
      y = (this.geo.x - p.x) * p.nx + (this.geo.y - p.y) * p.ny;
    }
    if (y > 0.2) this.ladoOuvinte = 1; else if (y < -0.2) this.ladoOuvinte = -1;
    return this.ladoOuvinte;
  }

  atualizar(p: Partial<{ amb: Ambiente; traj: Trajetoria; ouv: Ouvinte }>) {
    if (p.traj) {
      const t = p.traj;
      // tipo, comprimento, raio e sentido mudam a via inteira: reinicia o histórico (o corpo "reaparece")
      if (t.tipo !== this.traj.tipo || t.comprimento !== this.traj.comprimento || t.raioCurva !== this.traj.raioCurva || t.sentido !== this.traj.sentido) {
        this.via.configurar(t);
        if (this.portador) this.hist.reiniciar(this.amostra / this.fs, this.portador.cinematica.s, this.portador.cinematica.v);
      }
      this.lateralAlvo = t.lateral; this.altitudeAlvo = t.altitude;
      this.traj = t;
    }
    if (p.ouv) {
      this.posAlvo = [...p.ouv.pos] as [number, number, number];
      this.gimAlvo = { ...p.ouv.gimbal };
      this.ouv = p.ouv;
      if (this.portador) this.aplicarLocal();
    }
    if (p.amb) this.aplicarAmbiente(p.amb, false);
    this.definirAlvos(false);
  }

  private aplicarAmbiente(amb: Ambiente, agora: boolean) {
    this.amb = amb;
    const s = SOLOS[amb.solo.tipo];
    this.soloGAlvo = s.ganho;
    if (agora) this.soloG = s.ganho;
    if (this.prop) {
      this.prop.definirSolo(this.soloG, s.fc);
      this.prop.soloLargura = amb.id === 'ponte' ? 3.7 : Infinity;   // tabuleiro até 3 m do trilho (+ meia bitola)
      this.prop.expEnvio = expoenteEnvio(amb);
    }
    this.fundo.definir(amb.fundo);
    if (!amb.tunel) this.tunel.zerar();
  }

  /** prepara os anéis para o portador (aloca; acontece quando o portador muda) */
  preparar(portador: Portador) {
    this.portador = portador;
    this.fontesP = portador.fontes();
    const c = portador.cinematica;
    const dm = this.via.distMax(this.traj.lateral + 50, this.traj.altitude) + portador.corpo.comprimento;
    this.hist = new Historico(dm / 343 + 0.5, BLOCO_CONTROLE / this.fs);
    this.hist.reiniciar(this.amostra / this.fs, c.s, c.v);
    this.prop.preparar(this.fontesP, portador.corpo, this.via, this.hist, dm, portador.tipo === 'aviao');
    this.prop.alt = this.altitude;
    this.prop.definirSolo(this.soloG, SOLOS[this.amb.solo.tipo].fc);
    this.prop.soloLargura = this.amb.id === 'ponte' ? 3.7 : Infinity;
    this.prop.expEnvio = expoenteEnvio(this.amb);
    this.xTruques = this.fontesP.filter((f) => f.tipo === 'rolamento').map((f) => f.pos[0]);
    this.tele.fontes = this.prop.fontes.map((es) => ({ id: es.f.id, posEmitida: [0, 0, 0] as Vec3, r: 0, thetaEmissao: 0, ganhoDb: -120, atrasoMs: 0 }));
    this.narizAnt = NaN;
    this.tunel.zerar();
    this.aplicarLocal();
  }

  /** decide o local do ouvinte e as regras de cada fonte (3.3) */
  private aplicarLocal() {
    const o = this.ouv;
    let local: LocalOuvinte = o.local === 'auto' ? 'fora' : o.local;
    if (o.local === 'auto' && o.modo === 'gimbal' && this.portador) {
      const b = this.posGimbalCorpo();
      const corpo = this.portador.corpo;
      let frente = corpo.comprimento / 2;
      for (const s of corpo.segmentos) {
        if (b[0] <= frente && b[0] >= frente - s.comprimento && Math.abs(b[1]) < s.largura / 2 && b[2] > s.zPiso && b[2] < s.altura) local = 'cabine';
        frente -= s.comprimento + s.vao;
      }
    }
    this.local = local;
    const alvo = o.gimbal.alvo;
    let r: RegrasLocal;
    // vias estruturais: fontes `dentro` com `vias` chegam à cabine e ao cofre só por elas (sem propagação)
    this.viasC = []; this.viasG = []; this.viasBq = []; this.cabPropOn = false;
    if (local === 'cabine' || local === 'cofre') {
      this.fontesP.forEach((f, c) => {
        if (!f.vias) return;
        const v = local === 'cabine' ? f.vias.cabine : f.vias.cofre;
        this.viasC.push(c); this.viasG.push(v.ganho); this.viasBq.push(v.fc > 0 ? new Bq().lp(this.fs, v.fc, 0.7) : null);
      });
    }
    if (local === 'fora') r = { diretividade: true, sombra: !this.semSombra, solo: true, binaural: o.binaural, rota: null, envio: 1 };
    else if (local === 'cabine') {
      r = { diretividade: false, sombra: false, solo: false, binaural: o.binaural, rota: (f) => ({ bus: 1, peso: f.vias ? 0 : 1 }), envio: 0.25 };
      const cp = this.portador?.corpo.cabine;
      if (cp) {
        // filtro próprio da cabine (o carro: o `cab` do Ronco), no lugar da lei da massa
        this.cabPropOn = true; this.cabPropG = cp.ganho;
        this.cabProp = [0, 1].map(() => [...cp.lp.map(([f, q]) => new Bq().lp(this.fs, f, q)), new Bq().peak(this.fs, cp.pico[0], cp.pico[1], cp.pico[2])]);
      }
      const ms = this.portador?.corpo.massaSuperficial ?? 25, fc = this.portador?.corpo.fCabine ?? 45;
      // Lei da massa TL = 20·log₁₀(f·m_s) − 47 dB, limitada a [5, 45]. O CENA.md (3.3) sugere dois polos em
      // 891/m_s e 2,6× isso, mas dois polos caem 12 dB/oitava contra os 6 da lei e erram 7 dB em 125 Hz e
      // 17 dB em 2 kHz no trem; aqui: H = 10^(−5/20)·(LP₁(f₀) + 10^(−40/20)), f₀ = 398/m_s, que segue a
      // lei a ±1 dB entre 125 Hz e 2 kHz (o termo constante é o teto de 45 dB, o fator o piso de 5 dB).
      this.cabK1 = k1(this.fs, 398 / ms); this.cabK2 = 0.01;
      this.cabPk[0].peak(this.fs, fc, 1.1, 7); this.cabPk[1].peak(this.fs, fc, 1.1, 7);
    } else if (local === 'cofre') {
      r = { diretividade: false, sombra: false, solo: false, binaural: o.binaural, envio: 0.5,
        rota: (f) => (f.vias ? { bus: 0, peso: 0 } : f.dentro ? { bus: 0, peso: PESO_COFRE[f.tipo] ?? 0.8 } : { bus: 1, peso: 0.55 }) };
    } else {
      r = { diretividade: true, sombra: false, solo: false, binaural: o.binaural, envio: 0.5,
        rota: (f) => ({ bus: 0, peso: f.id === alvo ? 1 : 0.1 }) };
    }
    this.prop.aplicarRegras(r);
  }

  /** posição do ouvinte no gimbal, no referencial do corpo */
  private posGimbalCorpo(): [number, number, number] {
    const g = this.gim, D = Math.PI / 180;
    let ax = 0, ay = 0, az = (this.portador?.corpo.segmentos[0]?.altura ?? 2) / 2;
    if (this.ouv.gimbal.alvo !== 'corpo') {
      const f = this.fontesP.find((x) => x.id === this.ouv.gimbal.alvo);
      if (f) { ax = f.pos[0]; ay = f.pos[1]; az = f.pos[2]; }
    }
    const el = Math.max(-20, Math.min(89, g.el)) * D, a = g.az * D, r = Math.max(0.3, Math.min(300, g.r));
    return [ax + r * Math.cos(el) * Math.cos(a), ay + r * Math.cos(el) * Math.sin(a), az + r * Math.sin(el)];
  }
  private alvoCorpo(): [number, number, number] {
    let ax = 0, ay = 0, az = (this.portador?.corpo.segmentos[0]?.altura ?? 2) / 2;
    if (this.ouv.gimbal.alvo !== 'corpo') {
      const f = this.fontesP.find((x) => x.id === this.ouv.gimbal.alvo);
      if (f) { ax = f.pos[0]; ay = f.pos[1]; az = f.pos[2]; }
    }
    return [ax, ay, az];
  }

  /** geometria do ouvinte no instante em que o corpo está em s (com velocidade v) */
  private geometria(s: number, v: number) {
    const G = this.geo, largura = this.portador?.corpo.segmentos[0]?.largura ?? 2;
    if (this.ouv.modo === 'fixo') {
      G.x = this.pos[0]; G.y = this.via.yOuvinte - (this.lateral + largura / 2); G.z = Math.max(0.2, this.pos[2]);
      G.vx = 0; G.vy = 0; G.vz = 0; G.fx = 0; G.fy = 1; G.lx = -1; G.ly = 0;
      return;
    }
    const b = this.posGimbalCorpo(), p = this.via.ponto(s + b[0], this.pv);
    G.x = p.x + b[1] * p.nx; G.y = p.y + b[1] * p.ny; G.z = Math.max(0.2, this.altitude + b[2]);
    G.vx = v * p.tx; G.vy = v * p.ty; G.vz = 0;
    const a = this.alvoCorpo(), q = this.via.ponto(s + a[0], this.pv);
    const axw = q.x + a[1] * q.nx, ayw = q.y + a[1] * q.ny;
    let fx = axw - G.x, fy = ayw - G.y; const nf = Math.hypot(fx, fy);
    if (nf < 1e-3) { fx = q.tx; fy = q.ty; } else { fx /= nf; fy /= nf; }
    G.fx = fx; G.fy = fy; G.lx = -fy; G.ly = fx;
  }

  // parâmetros com rampa: 0 lateral, 1 altitude, 2–4 pos, 5 az, 6 el, 7 r, 8 ganho do solo
  rCur = new Float64Array(9); rAlvo = new Float64Array(9); rPasso = new Float64Array(9);
  private definirAlvos(agora: boolean) {
    const a = this.rAlvo;
    a[0] = this.lateralAlvo; a[1] = this.altitudeAlvo; a[2] = this.posAlvo[0]; a[3] = this.posAlvo[1]; a[4] = this.posAlvo[2];
    a[5] = this.gimAlvo.az; a[6] = this.gimAlvo.el; a[7] = this.gimAlvo.r; a[8] = this.soloGAlvo;
    for (let i = 0; i < 9; i++) {
      if (agora) this.rCur[i] = a[i];
      this.rPasso[i] = Math.abs(a[i] - this.rCur[i]) * this.passoRampa;   // chega em 20 ms
    }
  }
  /** avança as rampas de 20 ms um bloco de controle (sem alocação) */
  private rampas() {
    const c = this.rCur, a = this.rAlvo, st = this.rPasso;
    for (let i = 0; i < 9; i++) {
      const d = a[i] - c[i];
      if (d !== 0) c[i] = Math.abs(d) <= st[i] ? a[i] : c[i] + (d > 0 ? st[i] : -st[i]);
    }
    this.lateral = c[0]; this.altitude = c[1]; this.pos[0] = c[2]; this.pos[1] = c[3]; this.pos[2] = c[4];
    this.gim.az = c[5]; this.gim.el = c[6]; this.gim.r = c[7]; this.soloG = c[8];
    this.prop.alt = this.altitude;
  }

  processar(portador: Portador, canais: Float32Array[], outL: Float32Array, outR: Float32Array, sendL: Float32Array, sendR: Float32Array, n: number) {
    if (portador !== this.portador || portador.fontes() !== this.fontesP) this.preparar(portador);
    const P = this.prop, fs = this.fs, c = portador.cinematica;
    const T = this.amostra;
    P.zerarAcumuladores(n);
    P.escrever(canais, n);
    const bL = this.bL, bR = this.bR;
    bL.fill(0, 0, n); bR.fill(0, 0, n);
    const L = portador.corpo.comprimento, largura = portador.corpo.segmentos[0]?.largura ?? 2;
    const fixo = this.ouv.modo === 'fixo' && this.local === 'fora';
    const sO = this.via.abscissaDe(this.pos[0]);
    const tFim = (T + n) / fs;
    let ini = 0;
    while (ini < n) {
      const N = Math.min(BLOCO_CONTROLE, n - ini);
      this.rampas();
      if (this.soloG !== P.soloGanho) P.definirSolo(this.soloG, SOLOS[this.amb.solo.tipo].fc);
      // pose do corpo no fim do trecho (extrapolada do estado do portador no fim do bloco)
      const tj = (T + ini + N) / fs, dtj = tFim - tj;
      const sj = c.s - c.v * dtj + 0.5 * c.a * dtj * dtj, vj = c.v - c.a * dtj;
      this.hist.empurrar(sj, vj);
      this.geometria(sj, vj);
      // M ≥ 0,9 numa reta: o resolvedor fechado (2.1) e o estrondo no cone, como no flyby legado
      P.supersonico = this.via.tipo === 'reta' && Math.abs(vj) >= 0.9 * P.c;
      P.trecho(ini, N, tj, this.geo);
      const cone = P.supersonico && P.cone;
      if (cone && !this.inCone && P.machSup > 1) {
        const e = (portador as { estrondo?: { comprimento: number; forma: number } }).estrondo;
        this.estrondo.disparar(P.machSup, Math.max(15, P.altSup), e?.comprimento ?? portador.corpo.comprimento, e?.forma ?? 0.09);
        this.tCone = tj;
      }
      this.inCone = cone;
      // campo próximo: pressão e vento, no fim do trecho; a pressão é interpolada por amostra
      let p = 0, u = 0;
      let pTun = 0;
      this.pNariz = 0;
      if (fixo) {
        const xiN = this.reduzir(sj + L / 2 - sO), xiC = xiN - L;
        // distância do ouvinte à lateral do corpo; com o corpo no alto (helicóptero, avião) conta a altura
        const d = this.altitude > 0 ? Math.hypot(this.lateral, this.altitude) : this.lateral;
        p = ondaNariz(xiN, xiC, vj, d, portador.corpo.cpNariz, portador.corpo.nariz || 1, portador.corpo.cauda || 1);
        this.pNariz = p;
        // vento induzido (2.8): sobe ao longo do corpo, esteira de 3 s depois da cauda
        let w = 0;
        if (xiN >= 0 && xiN <= L) w = xiN / L;
        else if (xiN > L && vj > 0.1) w = Math.exp(-(xiN - L) / (vj * 3));
        const uo = ventoInduzido(vj, d) * w;
        let up = 0;
        const tun = this.amb.tunel;
        if (tun) {
          // abscissa do nariz reduzida à via: na reta, o corpo que reaparece do outro lado entra de novo no
          // túnel (um salto para trás maior que meia via zera a onda da passagem anterior)
          const nariz = this.reduzir(sj + L / 2);
          if (!isNaN(this.narizAnt) && this.narizAnt - nariz > this.via.comp / 2) this.tunel.zerar();
          if (this.tunel.tEntrada < 0 && !isNaN(this.narizAnt) && this.narizAnt < tun.xEntrada && nariz >= tun.xEntrada && vj > 0) {
            const tc = tj - (nariz - tun.xEntrada) / vj;
            this.tunel.entrar(tc, vj, portador.corpo.areaFrontal, tun.area, portador.corpo.nariz || 10, sO - tun.xEntrada, tun.comprimento);
          }
          this.narizAnt = nariz;
          pTun = this.tunel.pressao(tj);
          p += pTun;
          if (this.tunel.tEntrada >= 0) {
            const ua = ventoPistao(vj, this.tunel.beta);
            const tch = this.tunel.tEntrada + this.tunel.chegada();
            if (xiN < 0) up = tj >= tch ? this.tunel.uFrente : 0;
            else if (xiN <= L) up = ua;
            else up = ua * Math.exp(-(xiN - L) / (Math.max(vj, 0.1) * 3));
          }
        }
        u = Math.sqrt(uo * uo + up * up);
        // ponte: ronco estrutural pelos truques sobre o tabuleiro perto do ouvinte
        if (this.amb.id === 'ponte') {
          let s = 0;
          for (const x of this.xTruques) { const xi = (sj + x - sO) / 15; s += 1 / (1 + xi * xi); }
          this.ponteGAlvo = this.kPonte * s * Math.pow(Math.max(0, vj) / (300 / 3.6), 1.5);
        } else this.ponteGAlvo = 0;
      }
      // resíduo > 20 Hz da pressão no alto-falante (mono, os dois ouvidos); ponte: ronco em 31–125 Hz
      const p0 = this.pAnt, dp = (p - p0) / N, tp = this.tmpP, tq = this.tmpQ;
      for (let k = 0; k < N; k++) tp[k] = p0 + dp * (k + 1);
      this.hpP[0].bloco(tp, N); this.hpP[1].bloco(tp, N);
      const pg0 = this.ponteG, dpg = (this.ponteGAlvo - pg0) / N;
      if (pg0 > 0 || dpg !== 0) {
        const pr = this.ponteR;
        for (let k = 0; k < N; k++) tq[k] = pr.bi();
        this.ponteF[0].bloco(tq, N); this.ponteF[1].bloco(tq, N); this.ponteF[2].bloco(tq, N);
        for (let k = 0; k < N; k++) tp[k] += (pg0 + dpg * (k + 1)) * tq[k];
      }
      for (let k = 0; k < N; k++) { bL[ini + k] += tp[k]; bR[ini + k] += tp[k]; }
      this.ponteG = this.ponteGAlvo;
      this.pAnt = p;
      this.tele.pressaoPa = p;
      this.pTunel = pTun;
      if (p > this.pMax) this.pMax = p;
      if (p < this.pMin) this.pMin = p;
      this.ventoU = u;
      this.vento.uAlvo = u;
      ini += N;
    }
    P.avancar(n);
    // vento e fundo
    this.vento.somar(bL, bR, n);
    this.fundo.somar(bL, bR, n);
    // barramentos do local
    const a0L = P.accL[0], a0R = P.accR[0], a1L = P.accL[1], a1R = P.accR[1], cs = this.cabS, cf = this.cofreS;
    const g = 1 / PA_FS;
    const km = this.kMed, ta = this.tmpA, tb = this.tmpB, tc = this.tmpC, td = this.tmpD;
    // barramento 1 pelo filtro do local: cabine = lei da massa (2 polos) + ressonância do habitáculo; cofre = lp 900 Hz
    if (this.local === 'cabine' && this.cabPropOn) {
      const gc = this.cabPropG;
      for (let k = 0; k < n; k++) { tc[k] = gc * a1L[k]; td[k] = gc * a1R[k]; }
      for (const b of this.cabProp[0]) b.bloco(tc, n);
      for (const b of this.cabProp[1]) b.bloco(td, n);
    } else if (this.local === 'cabine') {
      for (let k = 0; k < n; k++) {
        cs[0] += this.cabK1 * (a1L[k] - cs[0]); cs[2] += this.cabK1 * (a1R[k] - cs[2]);
        tc[k] = 0.5623 * (cs[0] + this.cabK2 * a1L[k]); td[k] = 0.5623 * (cs[2] + this.cabK2 * a1R[k]);
      }
      this.cabPk[0].bloco(tc, n); this.cabPk[1].bloco(td, n);
    } else if (this.local === 'cofre') {
      for (let k = 0; k < n; k++) { cf[0] += this.cofreK * (a1L[k] - cf[0]); cf[1] += this.cofreK * (a1R[k] - cf[1]); tc[k] = cf[0]; td[k] = cf[1]; }
    } else { for (let k = 0; k < n; k++) { tc[k] = a1L[k]; td[k] = a1R[k]; } }
    // vias estruturais (mono nos dois ouvidos, como o `common` do int e o `b` do bay do Ronco)
    if (this.viasC.length) {
      const tv = this.tmpV, tw = this.tmpW;
      tv.fill(0, 0, n);
      for (let j = 0; j < this.viasC.length; j++) {
        const x = canais[this.viasC[j]], gv = this.viasG[j], bq = this.viasBq[j];
        for (let k = 0; k < n; k++) tw[k] = gv * x[k];
        if (bq) bq.bloco(tw, n);
        for (let k = 0; k < n; k++) tv[k] += tw[k];
      }
      for (let k = 0; k < n; k++) { tc[k] += tv[k]; td[k] += tv[k]; }
    }
    let eZ = this.eZ;
    for (let k = 0; k < n; k++) {
      const l = a0L[k] + bL[k] + tc[k], r = a0R[k] + bR[k] + td[k];
      ta[k] = l; tb[k] = r;
      eZ += km * (0.5 * (l * l + r * r) - eZ);
    }
    for (let k = 0; k < n; k++) { outL[k] = ta[k] * g; outR[k] = tb[k] * g; sendL[k] = P.envL[k] * g; sendR[k] = P.envR[k] * g; }
    // estrondo: em unidades do alto-falante, como no legado (o pico perto do máximo), fora da escala absoluta
    const es = this.estrondo;
    if (es.ativo) for (let k = 0; k < n && es.ativo; k++) { const bm = es.amostra(); outL[k] += bm; outR[k] += bm * 0.97; sendL[k] += bm * 0.6; sendR[k] += bm * 0.6; }
    es.age += n / this.fs;
    // nível A com constante 'F': filtra em bloco
    this.pa[0].bloco(ta, n); this.pa[1].bloco(tb, n);
    let eA = this.eA;
    for (let k = 0; k < n; k++) eA += km * (0.5 * (ta[k] * ta[k] + tb[k] * tb[k]) - eA);
    this.eA = eA; this.eZ = eZ;
    this.amostra += n;
    this.tele.ventoMs = this.ventoU;
  }

  private reduzir(x: number) {
    if (this.via.tipo !== 'reta') { const Lv = this.via.comp; let u = x % Lv; if (u > Lv / 2) u -= Lv; if (u < -Lv / 2) u += Lv; return u; }
    const Lv = this.via.comp; let u = (x + Lv / 2) % Lv; if (u < 0) u += Lv; return u - Lv / 2;
  }

  private atualizarTelemetria(portador: Portador) {
    const t = this.tele, F = this.prop.fontes;
    for (let i = 0; i < F.length; i++) {
      const es = F[i], o = t.fontes[i] as unknown as { posEmitida: number[]; r: number; thetaEmissao: number; ganhoDb: number; atrasoMs: number };
      o.posEmitida[0] = es.ex; o.posEmitida[1] = es.ey; o.posEmitida[2] = es.ez;
      o.r = es.r; o.thetaEmissao = es.theta; o.ganhoDb = es.ganhoDb; o.atrasoMs = es.atrasoMs;
    }
    const c = portador.cinematica, p = this.via.ponto(c.s, this.pv);
    const pose = t.corpo.pose as unknown as number[];
    pose[0] = p.x; pose[1] = p.y; pose[2] = this.altitude;
    t.corpo.s = c.s; t.corpo.v = c.v; t.corpo.rumo = Math.atan2(p.ty, p.tx);
    (c as { rumo: number }).rumo = t.corpo.rumo;
    const ov = t.ouvinte as unknown as number[]; ov[0] = this.geo.x; ov[1] = this.geo.y; ov[2] = this.geo.z;
    t.ventoMs = this.ventoU;
    t.splDbA = 10 * Math.log10(this.eA / (P_REF * P_REF) + 1e-30);
    if (this.estrondo.age < 30) t.boom = { dB: this.estrondo.dB, idade: this.estrondo.age }; else delete t.boom;
    t.splDb = 10 * Math.log10(this.eZ / (P_REF * P_REF) + 1e-30);
  }

  /** telemetria montada sob demanda (o worklet pede a cada 1024 amostras; escrever doubles em objetos aloca) */
  telemetria(): TelemetriaCena { if (this.portador) this.atualizarTelemetria(this.portador); return this.tele; }

  // campo próximo separado e extremos desde a última leitura (o mostrador amostra a cada 21 ms; a onda
  // de nariz dura ~80 ms e o pico se perderia)
  pNariz = 0; pTunel = 0; pMax = -Infinity; pMin = Infinity;
  /** extremos da pressão desde a última chamada e as duas parcelas instantâneas; zera os extremos */
  lerPressao(o: { max: number; min: number; nariz: number; tunel: number }) {
    o.max = this.pMax === -Infinity ? this.tele.pressaoPa : this.pMax; o.min = this.pMin === Infinity ? this.tele.pressaoPa : this.pMin;
    o.nariz = this.pNariz; o.tunel = this.pTunel;
    this.pMax = -Infinity; this.pMin = Infinity;
    return o;
  }
}
