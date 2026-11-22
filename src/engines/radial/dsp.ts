// Motor radial (docs/RADIAL.md), como subclasse do EngineDSP do Ronco (o padrão do DieselDSP).
//
// O laço de amostra é o do Ronco: cilindro de zona única, válvulas com escoamento compressível, escape em guias de onda,
// virabrequim e ouvintes. O radial entra por três caminhos:
//  1. Geometria (src/engines/radial/geometria.ts): PMS reais das articuladas (a irregularidade de fase própria do radial),
//     ordens reais da P&W na dupla fileira e a ordem decorrente do R-4360; o curso das articuladas pesa no ar e na energia
//     de cada cilindro (gancho 2); a vibração sem a 1ª ordem, que o contrapeso anula (gancho 9).
//  2. Métodos sobrescritos inteiros: buildExhaust (anel coletor com k saídas, estaques, aranha, lados do Sherman, um
//     sistema por fileira, os dois anéis numa turbina no P-47, as fileiras aos pares no R-4360), buildFilters (o apito do
//     motor de arranque de inércia), calibrate/measurePower (sondas com um RadialDSP e o escape de referência), tune.
//  3. Os ganchos `if (this.av)` do EngineDSP, com as funções da aviação (src/engines/ronco/aviacao.ts: magnetos, mistura,
//     carga da hélice ou do rotor, som da hélice na página) trocadas aqui pelas do radial: encharque dos cilindros de
//     baixo e os "tosses" da partida, arranque de inércia (energizar → engatar), elétrico direto e a ar comprimido
//     (M-14P), contagem de pás, estouros da partida, refrigeração a ar das aletas expostas (gancho 12).
//
// Regra do DSP: nada do navegador; a taxa entra no construtor; RNG com semente.
import { TAU, DEG, P0, clamp, smooth, flow, onePole, RNG, Biquad, Line, Junction, TwoPort, Radiator, port } from '../../acoustics';
import { EngineDSP } from '../ronco/dsp';
import { T_MAN } from '../ronco/constantes';
import { AV, arranqueBase, paLw5 } from '../ronco/aviacao';
import type { EscapeRadial } from './geometria';
import { BocaEscape } from './boca';
import { FonteHelice } from '../../carriers/helice';

/** escape de referência da calibração (RADIAL.md 2.3): um anel de uma saída */
export const ESCAPE_REF: EscapeRadial = { tipo: 'anel', Danel: 1.1, Oanel: 80, Lp: 0.2, saidas: [{ L: 0.8, O: 80, phi: 180 }] };

/** turbulência do sopro na boca do escape (boca.ts): intensidade (fração RMS da vazão).
 *  Lado baixo de propósito (PLANO: mais motor, menos ar): um escoamento pulsado em tubo tem 4 a 10 %. `coletor` e
 *  `turbina` (dB): num anel coletor o jato de cada válvula se desfaz no caminho (o gás dá a volta no anel, passa pelas
 *  junções dos outros cilindros e sai somado numa saída larga, quase sem pulsar) e chega à boca como escoamento de tubo
 *  comum; no estaque ele chega fresco, a 10–16 diâmetros da válvula. Depois de metros de tubo e de uma turbina, menos ainda */
export const SOPRO = { kT: 0.05, coletor: -8, turbina: -6 };
/** juntas do anel coletor e dos estaques (o `breakout`): cada uma vaza diferente. `old` e `leaky`: desvio do log do
 *  vazamento por junta (0 = todas iguais; com 1,5 na chapa fina o T-6 passava de 6 picos por segundo na lenta);
 *  `piso`: o que sobra vazando entre as rajadas, relativo à média (o Ronco usa 0,5); `queda` (s) e `corte` (Hz): quanto
 *  dura a rajada depois da abertura e o polo do espectro dela (10 ms e 2,5 kHz no coletor de carro do Ronco) */
export const JUNTAS = { old: 0.7, leaky: 1.25, piso: 0.15, queda: 0.035, corte: 1600 };

/** argumento do `tanh` de saída em que fica o percentil 99,5 da decolagem com o volume padrão (tanh(0,8) = 0,66: no
 *  máximo 0,5% das amostras acima disso, contra o critério de 1% acima de 0,7 da AUDITORIA R-02) */
const LIM_DECOLAGEM = 0.8;

/** rotação em que o arranque de inércia entrega o volante (s de energização, automático) */
const T_ENERGIZAR = 16;

export class RadialDSP extends EngineDSP {
  declare fase: any; declare tFase: any; declare tGiro: any; declare pas: any; declare magAuto: any; declare encharque: any; declare fumaca: any;
  declare radPhi: any; declare rotAng: any; declare apF: any; declare apPh: any; declare apHz: any; declare apAmp: any; declare apNz: any;
  declare margemDb: any; declare kSopro: any; declare exposto: any;
  declare Aar: any; declare blowerAlta: any; declare engateT: any; declare falhaMedia: any; declare galL: any; declare galN: any; declare falhaLenta: any; declare qMix0: any;
  // (da aviação, postos por instalarAviacao: src/engines/ronco/aviacao.ts)
  declare heliceSom: any; declare helK: any; declare magnetos: any; declare mistura: any; declare partidaTipo: any; declare prime: any; declare cargaAv: any; declare falhaMix: any; declare nivelEscape: any;

  constructor(fs: number) {
    super(fs);
    this.av = true; this.radial = true;
    // o chiado de jato do Ronco (ruído ∝ v² somado depois da ponteira) sai: a boca do radial tem o sopro turbulento dela
    // (boca.ts), que irradia pelo mesmo monopolo do pulso
    this.jetGain = 0;
    // os ganchos do EngineDSP chamam estas (propriedades da instância, como no DieselDSP)
    this.falhaAv = this.falhaRadial; this.torquePartida = this.torqueRadial; this.partidaAr = this.arRadial; this.somPartidaAv = this.somArranque;
    this.avControle = this.controleRadial; this.avMensagem = this.mensagemRadial; this.avTelemetria = this.telemetriaRadial; this.avSomExtra = this.somExtraRadial;
    this.fase = 'parado'; this.tFase = 0; this.tGiro = 0; this.pas = 0; this.magAuto = true; this.encharque = new Float64Array(1); this.fumaca = 0;
    this.apPh = 0; this.apHz = 0; this.apAmp = 0; this.engateT = -1; this.falhaMedia = 0; this.blowerAlta = false;
    this.galL = 0; this.galN = new RNG(0x9a10); this.falhaLenta = 0;
  }

  // ------------------------------------------------------------------ configuração
  setConfig(cfg, calibrate = true) {
    // encharque (3.4): óleo nos cilindros de baixo com o motor parado; 1 no de baixo, 0 nos de cima
    this.encharque = Float64Array.from(cfg.phi || cfg.axis, (p: number) => Math.max(0, -Math.cos(p * DEG)));
    super.setConfig(cfg, calibrate);
    // margem da decolagem (calibrate): com o ganho vindo pronto da página, a margem vem junto; a hélice e o apito da
    // página usam `nivelEscape` como referência de nível, e descem com o motor
    if (cfg.gain) this.margemDb = cfg.margemDb || 0; else if (!calibrate) this.margemDb = 0;
    this.nivelEscape = (cfg.nivelEscape || 135) + (this.margemDb || 0);
    if (this.heliceSom) this.heliceSom.pasLentas = true; // (contagem de pás: o "vuff" de cada pá passando devagar)
    // a hélice da página com a mesma lei de nível da hélice do portador na Cena (src/carriers/leis-helice.ts: o tom de
    // carga de Gutin com o torque absorvido): sem isso a página tocava a lei do JetDSP, que só olha o Mach da ponta, e o
    // mesmo avião saía com a hélice 6 a 8 dB mais alta em radial.html do que na Passagem
    if (this.heliceSom) this.heliceSom.lei = 'carga';
    this.rotAng = cfg.rotativo ? 0 : undefined;
  }

  tune(cfg) {
    super.tune(cfg);
    // tanque: a rolagem das esteiras (0,06·m·g) no lugar da do pneu
    if (cfg.rolagem) this.roll = cfg.rolagem * this.mass * 9.81;
    // galope (RADIAL.md 4.3): a variação explosão a explosão dos radiais na lenta (CVciclo 0,30–0,42) é maior que a dos
    // carros do Ronco com a mesma alimentação; `galope` multiplica a dispersão do Ronco (varScale)
    this.varScale = cfg.galope ?? (cfg.carburador === 'boia' ? 2.6 : 1.8);
    // borboleta: a do carburador de avião é grande (o ar de lenta é uma fração dela): com a do Ronco o controle de lenta
    // não tinha ar para segurar a lenta contra a hélice
    this.Athr *= clamp(cfg.displacement / 10, 1, 1.6); // (nos pequenos, Rotec e Verner, a do Ronco já basta)
    // vazamento do anel de chapa e das juntas (breakout do Ronco), com o acerto da instalação em dB (`vazamento`, RADIAL.md 2.1)
    this.breakK = ({ sealed: 0, old: 1, leaky: 2.2 }[cfg.breakout] || 0) * Math.pow(10, (cfg.vazamento || 0) / 20);
    this.brkFloor = JUNTAS.piso; // (entre as rajadas quase nada vaza: o chiado do anel pulsa com cada abertura, não é um leito)
    // sopro das bocas (boca.ts), com o acerto do preset em dB (`sopro`)
    const esc = cfg.escape || ESCAPE_REF;
    const ks = Math.pow(10, ((cfg.sopro || 0) + (esc.tipo === 'tubos' ? 0 : SOPRO.coletor) + (esc.turbina ? SOPRO.turbina : 0)) / 20);
    this.kSopro = SOPRO.kT * ks;
    if (this.rads) for (const r of this.rads) if (r instanceof BocaEscape) r.kT = this.kSopro;
    // ouvinte de fora da página (5 m do cubo) com os cilindros expostos na boca da carenagem: os mesmos pesos do
    // adaptador da Cena (motor.ts: admissão 0,12, bloco 0,12 sem a sombra de uma carroceria, compressor 0,5, coletor 1).
    // Com os pesos do carro de motor dianteiro do Ronco (mecânica 0,1 atrás de um passa-baixa de 3 kHz, coletor 0,3) a
    // página ficava 4 a 11 dB mais escura que a Passagem acima de 400 Hz. No tanque e no carro o motor fica num
    // compartimento: valem os do Ronco
    this.exposto = !(cfg.portadores || []).includes('carro');
    if (this.exposto) { this.posW = [0.12, 0.12, 0.5, 1, 0.12]; this.breakK *= 0.7; }
    // superalimentador de duas velocidades (R-2800): a relação e a pressão da marcha alta
    const sa = cfg.superalimentador;
    if (sa?.duasVelocidades && this.blowerAlta) { this.scOrder = sa.duasVelocidades.relacao * sa.pas; this.maxBoost = sa.duasVelocidades.boost; }
    // ar de partida (3.4): orifício que dá ṁ = 0,02·(Vd/0,5 L) kg/s engasgado a 20 bar
    this.Aar = (0.3 * 0.02 * ((this.Vd || 1e-3) / 0.5e-3)) / (0.0404 * 20e5 / Math.sqrt(T_MAN)); // (×0,3: com a vazão do RADIAL.md o motor saía a 300 rpm em 0,7 s)
  }

  // ------------------------------------------------------------------ escape (2.1)
  buildExhaust(cfg) {
    const fs = this.fs, N = this.N, e: EscapeRadial = cfg.escape || ESCAPE_REF;
    const lines: Line[] = [], nodes: any[] = [], runners = new Array(N), rads: Radiator[] = [], radPhi: number[] = [];
    const L = (len: number, Y: number, loss: number, damp = 1) => { const l = new Line(fs, Math.max(0.02, len), Y, loss, damp); l.kNL = 0.6; lines.push(l); return l; };
    const ds = (mm: number) => clamp(mm / 63.5, 0.4, 2.4);
    const phi: number[] = cfg.phi || cfg.axis, grupo: number[] = cfg.bank, nG: number = cfg.banks, fil: number[] = cfg.fileira || new Array(N).fill(0);
    this.brkW = new Float64Array(N);
    // juntas: cada cilindro entra no anel (ou no estaque) por uma junta deslizante, e uma ou duas vazam bem mais que as
    // outras; a rajada do coletor fica presa ao ciclo (um sopro por volta do comando, o "tch… tch…" de um T-6 de perto)
    // em vez de um chiado igual em todas as explosões. Pesos de média quadrática 1: o nível médio não muda
    const sj = (JUNTAS as any)[cfg.breakout] || 0;
    let w2 = 0;
    for (let c = 0; c < N; c++) {
      const r = L(cfg.runners[c], 1, 12000); r.runner = true; runners[c] = r;
      this.brkW[c] = Math.exp(sj * new RNG(0x7a11 + 977 * c + 31 * N).gauss());
      w2 += this.brkW[c] * this.brkW[c];
    }
    for (let c = 0; c < N; c++) this.brkW[c] /= Math.sqrt(w2 / N);
    this.bankJ = new Array(nG).fill(null);
    const radiar = (line: Line, ph: number, O: number) => {
      const d = ds(O), A2 = d * d, p = Math.sin(ph * DEG);
      const r = new BocaEscape(fs, line, 0.62 - 0.34 * p, 0.62 + 0.34 * p, 1500 / d, A2, 400 / (TAU * 0.03175 * d),
        { D: Math.max(0.02, O / 1000), kT: this.kSopro, params: this.params, semente: 0xb0ca + 7919 * rads.length + 131 * N });
      nodes.push(r); rads.push(r); radPhi.push(ph);
    };
    const angMedio = (cs: number[]) => Math.atan2(cs.reduce((s, c) => s + Math.sin(phi[c] * DEG), 0), cs.reduce((s, c) => s + Math.cos(phi[c] * DEG), 0)) / DEG;
    const distAng = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
    let A2out = 1;
    if (e.tipo === 'tubos') {
      // estaques: cada grupo (um cilindro, ou os vizinhos de uma fileira) numa junção (onde os estouros entram) → boca
      const O = e.Ot ?? 40; A2out = ds(O) ** 2;
      for (let g = 0; g < nG; g++) {
        const cs = []; for (let c = 0; c < N; c++) if (grupo[c] === g) cs.push(c);
        if (!cs.length) continue;
        const sh = L(0.05, cs.length, 12000);
        const j = new Junction([...cs.map((c) => port(runners[c], 1)), port(sh, 0)]);
        nodes.push(j); this.bankJ[g] = j;
        // (Corsair: os estaques de cada fileira saem de um lado da carenagem, 3 por lado)
        const gr = e.agrupar || 1, k = g % gr;
        radiar(sh, e.ladoPorFileira ? (fil[cs[0]] ? 90 : 270) + 25 * (k - (gr - 1) / 2) : angMedio(cs), O);
      }
    } else if (e.tipo === 'aranha') {
      const s = e.saidas?.[0] ?? { L: 0.5, O: 70, phi: 180 }, A2 = ds(s.O) ** 2; A2out = A2;
      const out = L(s.L, 0.55 * Math.sqrt(N) * A2, 9000, 1 / ds(s.O));
      const j = new Junction([...runners.map((r) => port(r, 1)), port(out, 0)]);
      nodes.push(j); this.bankJ[0] = j;
      radiar(out, s.phi, s.O);
    } else if (e.tipo === 'lados') {
      // Sherman: dois meio-anéis (coletores em cadeia, um por lado) → dois tubos de saída na traseira
      for (let g = 0; g < nG; g++) {
        const cs = []; for (let c = 0; c < N; c++) if (grupo[c] === g) cs.push(c);
        cs.sort((a, b) => phi[a] - phi[b]);
        const s = e.saidas?.[g] ?? { L: 1.5, O: 90, phi: g ? 200 : 160 }, A2 = ds(s.O) ** 2, Ya = 0.55 * Math.sqrt(cs.length) * A2; A2out = A2;
        const segs = cs.slice(1).map((_, k) => L(Math.max(0.08, ((Math.PI * (e.Danel ?? 1.0)) / N) * (distAng(phi[cs[k + 1]], phi[cs[k]]) / (360 / N))), Ya, 9000, 1 / ds(s.O)));
        const out = L(s.L, Ya, 9000, 1 / ds(s.O));
        cs.forEach((c, k) => {
          const ps = [port(runners[c], 1)];
          if (k > 0) ps.push(port(segs[k - 1], 1));
          if (k < cs.length - 1) ps.push(port(segs[k], 0)); else ps.push(port(out, 0));
          const j = new Junction(ps); nodes.push(j);
          if (k === cs.length - 1) this.bankJ[g] = j;
        });
        radiar(out, s.phi, s.O);
      }
    } else {
      // anel coletor: N_f primários → junções em laço (segmentos de π·D/N_f); nas junções das saídas, a 4ª porta
      const rows = Math.max(...fil) + 1;
      const sistemas: number[][] = e.juntar ? e.juntar : e.porFileira || e.turbina ? Array.from({ length: rows }, (_, r) => [r]) : [Array.from({ length: rows }, (_, r) => r)];
      const Oa = e.Oanel ?? 80, A2a = ds(Oa) ** 2, dwa = 1 / ds(Oa);
      const saidas = e.saidas?.length ? e.saidas : [{ L: 0.8, O: 80, phi: 180 }];
      const pontasTurbo: Line[] = [];
      // um anel sobre os cilindros dados; `toco` = tubo que sai da junção mais perto de `ph` (pares de fileiras, turbina)
      const anel = (cs: number[], toco: { ph: number; linha: Line } | null) => {
        cs.sort((a, b) => phi[a] - phi[b]);
        const n = cs.length, Ya = 0.55 * Math.sqrt(n) * A2a;
        const seg = cs.map(() => L((Math.PI * (e.Danel ?? 1.1)) / n, Ya, 9000, dwa));
        const ports: any[][] = cs.map((c, k) => [port(runners[c], 1), port(seg[k], 0), port(seg[(k - 1 + n) % n], 1)]);
        const perto = (ph: number) => { let kb = 0; cs.forEach((c, k) => { if (distAng(phi[c], ph) < distAng(phi[cs[kb]], ph)) kb = k; }); return kb; };
        let jOut = 0;
        if (toco) { jOut = perto(toco.ph); ports[jOut].push(port(toco.linha, 0)); }
        else saidas.forEach((sd, si) => {
          const k = perto(sd.phi), A2 = ds(sd.O) ** 2;
          const out = L(sd.L, Ya * (A2 / A2a), 9000, 1 / ds(sd.O));
          ports[k].push(port(out, 0)); if (si === 0) jOut = k;
          radiar(out, sd.phi, sd.O); A2out = A2;
        });
        const js = ports.map((ps) => new Junction(ps));
        nodes.push(...js);
        return js[jOut];
      };
      const daFileira = (rs: number[]) => { const cs = []; for (let c = 0; c < N; c++) if (rs.includes(fil[c])) cs.push(c); return cs; };
      sistemas.forEach((rs, si) => {
        if (!e.juntar && !e.turbina) { this.bankJ[si] = anel(daFileira(rs), null); return; }
        const sd = saidas[Math.min(si, saidas.length - 1)];
        const tocos: Line[] = [];
        for (const r of rs) {
          const cs = daFileira([r]), n = cs.length;
          const t = e.turbina ? L(e.turbina.Lantes, 0.55 * Math.sqrt(n) * ds(e.turbina.Oantes) ** 2, 9000, 1 / ds(e.turbina.Oantes)) : L(0.3, 0.55 * Math.sqrt(n) * A2a, 9000, dwa);
          const jr = anel(cs, { ph: sd.phi, linha: t });
          tocos.push(t);
          if (e.turbina) this.bankJ[r] = jr;
        }
        if (e.juntar) {
          const A2 = ds(sd.O) ** 2;
          const out = L(sd.L, 0.55 * Math.sqrt(N / sistemas.length) * A2, 9000, 1 / ds(sd.O));
          const j = new Junction([...tocos.map((t) => port(t, 1)), port(out, 0)]);
          nodes.push(j); this.bankJ[si] = j;
          radiar(out, sd.phi, sd.O); A2out = A2;
        } else pontasTurbo.push(...tocos);
      });
      if (e.turbina && pontasTurbo.length) {
        // P-47: os dois tubos se juntam antes da turbina (TwoPort 'turbo' do Ronco) e a cauda leva à boca
        const t = e.turbina, A2 = ds(t.Oantes) ** 2, Ym = 0.55 * Math.sqrt(N) * A2;
        const mid = L(0.3, Ym, 9000, 1 / ds(t.Oantes));
        nodes.push(new Junction([...pontasTurbo.map((x) => port(x, 1)), port(mid, 0)]));
        const tail = L(t.Ldepois, 0.55 * Math.sqrt(N) * ds(t.Odepois) ** 2, 9000, 1 / ds(t.Odepois));
        nodes.push(new TwoPort(fs, port(mid, 1), port(tail, 0), 'turbo'));
        radiar(tail, 180, t.Odepois); A2out = ds(t.Odepois) ** 2;
      }
    }
    for (let g = 0; g < nG; g++) if (!this.bankJ[g]) this.bankJ[g] = this.bankJ.find((x) => x) || nodes.find((x) => x instanceof Junction);
    this.pipeA = A2out;
    this.lines = lines; this.nodes = nodes; this.runners = runners; this.rads = rads; this.radPhi = radPhi;
    this.radHP = rads.map(() => new Biquad().hp(fs, 45, 0.7));
    this.radSh = rads.map(() => new Biquad().peak(fs, 110, 0.6, 3));
    let ib = 64; while (ib < fs * 0.0015) ib <<= 1;
    this.itdB = rads.map(() => new Float32Array(ib)); this.itdM = ib - 1; this.itdW = 0;
    this.itdD = rads.map((r) => {
      const p = (r.panR - r.panL) / (r.panR + r.panL + 1e-9), d = Math.round(Math.abs(p) * 0.0006 * fs);
      return p > 0 ? [d, 0] : [0, d];
    });
    this.jetF = rads.map(() => [new Biquad().bp(fs, 450, 0.5), new Biquad().bp(fs, 1400, 0.6)]);
    this.jetEnv = rads.map(() => 0);
    this.tipA = A2out;
  }

  buildFilters(cfg) {
    super.buildFilters(cfg);
    // rajada do coletor: o anel fica pressurizado enquanto o gás do cilindro escoa por ele, e a junta vaza esse tempo
    // todo (um sopro de dezenas de ms por abertura, como na gravação do T-6G: 60 a 100 ms), não só no estouro da válvula
    // (os 10 ms do Ronco, afinados num coletor de carro, davam um tique por explosão)
    this.brkKd = 1 - Math.exp(-1 / (JUNTAS.queda * this.fs));
    // (e o anel é de tubo largo: a chapa irradia mais grave que o coletor de um carro; o polo desce de 2,5 para 1,6 kHz.
    // Nas gravações de anel coletor 2,5–6 kHz fica 3 a 6 dB abaixo de 1–2,5 kHz; com o polo do Ronco saíam iguais)
    this.brkKl = onePole(this.fs, JUNTAS.corte);
    // apito do volante do arranque de inércia (3.4): ruído em banda estreita (Q 25) em volta do tom
    this.apF = new Biquad().bp(this.fs, 300, 25); this.apNz = new RNG(0xa917);
  }

  // ------------------------------------------------------------------ sondas (2.3)
  private sonda(cfg, rpm: number) {
    const ref = { ...cfg, escape: ESCAPE_REF, bank: new Array(cfg.N).fill(0), banks: 1, runners: cfg.runners.map((_: number, c: number) => 0.2 * (1 + 0.03 * Math.sin(c * 2.3))),
      gain: undefined, powerModel: undefined, scWhine: 0, breakout: 'sealed', rotativo: undefined };
    const t = new RadialDSP(this.fs);
    t.setConfig(ref, false);
    t.state = 'run'; t.lockOmega = true; t.tempMode = 'fixed'; t.tempSet = 90; t.coolant = 90; t.runT = 100;
    t.omega = (rpm * TAU) / 60; t.rpmAvg = rpm; t.magnetos = 'ambos'; t.mistura = 0.8;
    return t;
  }

  calibrate(cfg) {
    const B = 256, L = new Float32Array(B), R = new Float32Array(B), fs = this.fs;
    const t = this.sonda(cfg, this.redline * 0.55);
    t.thrTarget = 1; t.thr = 1; t.boost = cfg.boost * 0.8; t.maxBoost = cfg.boost * 0.8; t.params.master = 0.02;
    let acc = 0, cnt = 0, pk = 0;
    for (let i = 0; i < 0.5 * fs; i += B) {
      t.process(L, R, B);
      if (i > 0.25 * fs) for (let k = 0; k < B; k++) { acc += L[k] * L[k] + R[k] * R[k]; cnt += 2; pk = Math.max(pk, Math.abs(L[k]), Math.abs(R[k])); }
    }
    const rms = Math.sqrt(acc / Math.max(1, cnt)) / 0.01, target = 0.17;
    const gWot = Math.min(target / Math.max(rms, 1e-6), 0.9 / Math.max(pk / 0.01, 1e-6));
    const ti = this.sonda(cfg, this.idle);
    ti.runT = 60; ti.thrTarget = 0; ti.thr = 0; ti.params.master = 0.02; ti.dash = 0;
    let acc2 = 0, cnt2 = 0;
    for (let i = 0; i < 1.2 * fs; i += B) {
      ti.process(L, R, B);
      ti.dash = 0; ti.iacI = clamp(ti.iacI - 5e-4 * ti.tqMean * (B / fs), 0, 0.05);
      if (i > 0.8 * fs) for (let k = 0; k < B; k++) { acc2 += L[k] * L[k] + R[k] * R[k]; cnt2 += 2; }
    }
    const rmsIdle = Math.sqrt(acc2 / Math.max(1, cnt2)) / 0.01;
    const gIdle = (target * 0.09) / Math.max(rmsIdle, 1e-6);
    // margem da decolagem: a referência de volume é o escape a 55% da rotação máxima; em potência de decolagem o escape
    // do próprio preset sobe e a hélice entra por cima (num T-6, 17 dB acima dessa referência), e a soma passava do
    // limitador de saída (o `tanh` achatava o som em 10 dos 17 presets: AUDITORIA R-02). O ganho do motor e o nível da
    // hélice descem juntos o quanto for preciso para a decolagem caber; a lenta mantém o nível dela (o reforço `mkIdle`
    // compensa). O limitador volta a ser proteção, não parte do timbre
    const m = this.margemDecolagem(cfg, gWot);
    this.margemDb = -20 * Math.log10(m);
    const gain = clamp(gWot * m, 0.05, 40);
    return { gain, idle: clamp(gIdle / gain, 1, 8) };
  }

  /**
   * Fator (≤ 1) que põe a decolagem abaixo do limitador de saída: o motor com o escape do próprio preset na rotação
   * máxima, manete toda e pressão cheia, mais a hélice da página na rotação governada com o torque da potência da ficha
   * (a lei de carga), somados amostra a amostra como a página soma; o percentil 99,5 do módulo, com o volume padrão
   * (0,8), fica em `LIM_DECOLAGEM` de argumento do `tanh`.
   */
  private margemDecolagem(cfg, gWot: number) {
    const B = 256, L = new Float32Array(B), R = new Float32Array(B), fs = this.fs;
    const t = new RadialDSP(fs);
    t.setConfig({ ...cfg, gain: undefined, powerModel: undefined, rotativo: undefined }, false);
    t.state = 'run'; t.lockOmega = true; t.tempMode = 'fixed'; t.tempSet = 90; t.coolant = 90; t.runT = 100; t.exhT = 700;
    t.omega = (this.redline * TAU) / 60; t.rpmAvg = this.redline; t.magnetos = 'ambos'; t.mistura = 0.8;
    t.thrTarget = 1; t.thr = 1; t.boost = cfg.boost; t.maxBoost = cfg.boost; t.params.master = 0.02;
    const n0 = Math.round(0.15 * fs), n = Math.round(0.3 * fs), x = new Float32Array(2 * n);
    for (let i = -n0; i < n; i += B) {
      t.process(L, R, B);
      if (i >= 0) for (let k = 0; k < B && i + k < n; k++) { x[2 * (i + k)] = L[k] / 0.01; x[2 * (i + k) + 1] = R[k] / 0.01; }
    }
    // hélice da página em decolagem (Pa a 30 m → unidades da saída: aviacao.ts, somExtraAv)
    const h = this.cargaAv?.hcfg, hel = new Float32Array(n);
    if (h && this.heliceSom) {
      const f = new FonteHelice(fs, h.B, h.D, h.nHelice);
      f.onLenta = h.onLenta ?? 0; f.kapK = h.kapK ?? 1; f.largoK = h.largoK ?? 1; f.lei = 'carga';
      f.np = 1; f.u = 1; f.torque = ((cfg.power || 100) * 1000) / ((h.nHelice * TAU) / 60);
      f.preencher(hel, n);
      const k = (30 / 5) * (0.17 / paLw5(cfg.nivelEscape || 135));
      for (let i = 0; i < n; i++) hel[i] *= k;
    }
    const a = new Float32Array(2 * n);
    for (let i = 0; i < n; i++) { a[2 * i] = Math.abs(x[2 * i] * gWot + hel[i]); a[2 * i + 1] = Math.abs(x[2 * i + 1] * gWot + hel[i]); }
    a.sort();
    const q = a[Math.min(a.length - 1, Math.floor(0.995 * a.length))];
    return Math.min(1, LIM_DECOLAGEM / (0.8 * 0.5 * Math.max(q, 1e-9)));
  }

  measurePower(cfg) {
    const B = 256, L = new Float32Array(B), R = new Float32Array(B), fs = this.fs;
    const t = this.sonda({ ...cfg, limiter: 'none', power: undefined }, this.redline * 0.6);
    t.thrTarget = 1; t.thr = 1; t.boost = cfg.boost; t.maxBoost = cfg.boost; t.params.master = 0;
    let kw = 0, tq = 0, fr = 0;
    // (a ficha dos motores de avião é a potência na rotação máxima: os pontos ficam perto dela)
    for (const f of [0.8, 0.9, 1.0]) {
      t.omega = (this.redline * f * TAU) / 60; t.rpmAvg = this.redline * f; t.tqMean = 0; t.frMean = 0;
      for (let i = 0; i < 0.35 * fs; i += B) t.process(L, R, B);
      const k = (t.tqMean * t.omega) / 1000;
      if (k > kw) { kw = k; tq = t.tqMean; fr = t.frMean; }
    }
    return { kw: Math.max(kw, 1), tq: Math.max(tq, 1), fr: Math.max(fr, 0) };
  }

  // ------------------------------------------------------------------ partida (3.4)
  setIgnition(on) {
    if (!on) { this.fase = 'parado'; this.engateT = -1; super.setIgnition(false); return; }
    if (this.state !== 'off') return super.setIgnition(true);
    const tipo = this.partidaTipo;
    this.pas = 0; this.tGiro = 0; this.tFase = 0;
    if (this.magAuto) this.magnetos = tipo === 'ar' || tipo === 'manivela' ? 'ambos' : 'desligado';
    if (tipo === 'inercia') { this.fase = 'energizar'; this.ignition = true; return; }
    this.fase = 'girar';
    if (tipo === 'manivela') { this.gear = Math.max(1, this.gear); this.v = Math.max(this.v, 2); this.clutch = 1; }
    super.setIgnition(true);
  }

  /** engata o volante (inércia) ou começa a girar */
  engatar() {
    if (this.fase !== 'energizar') return;
    this.fase = 'girar'; this.tGiro = 0; this.engateT = 0; this.clickEnv += 4; // (o estalo do engate)
    super.setIgnition(true);
  }

  falhaRadial(c: number) {
    if (this.magnetos === 'desligado') return 1;
    const rt = this.runT || 0, en = this.encharque[c] * (1 + 0.3 * (this.prime || 0));
    const umMag = this.magnetos === 'esq' || this.magnetos === 'dir' ? 0.02 * en : 0;
    // 0,55·encharque·e^(−t/8) nos de baixo; 0,12·e^(−t/15) em todos (menos com o primer nos de cima)
    return 0.55 * en * Math.exp(-rt / 8) + 0.12 * Math.exp(-rt / 15) * (1 - 0.15 * (this.prime || 0) * (1 - this.encharque[c])) + this.falhaMix + umMag + this.falhaLenta;
  }

  torqueRadial(rpm: number) {
    if (this.state !== 'crank') return 0;
    const tipo = this.partidaTipo, T0 = arranqueBase(this);
    // inércia: a energia do volante vai acabando em ~9 s (o motor gira a 60–100 rpm); a ar e a manivela: sem motor
    if (tipo === 'inercia') return 1.1 * T0 * Math.max(0, 1 - this.tGiro / 9) * Math.max(0, 1 - rpm / 250);
    // elétrico direto: além do atrito do motor inteiro (arranqueBase), ele vence o pico de compressão de UM cilindro com
    // 30% de folga. O pico, medido com o giro travado a 30 rpm sem queima, é ≈ 0,11·p0·V_cil·cr^1,3 nos radiais pequenos
    // (Verner 3V 71 N·m, Rotec R2800 63, Verner 5S 109). Com 3,39 L em 5 cilindros o arranque de antes (123 N·m) não
    // passava da compressão: o Verner 5S balançava entre 10 e 56 rpm e nunca chegava aos 60 em que o EngineDSP queima
    // (AUDITORIA F-RAD-02). Nos motores grandes o termo do atrito continua mandando.
    if (tipo === 'direta') return Math.max(T0, 1.3 * 0.11 * P0 * this.Vd * Math.pow(this.CR, 1.3)) * Math.max(0, 1 - rpm / 220);
    return 0;
  }

  /** ar comprimido (M-14P): o distribuidor manda ar ao cilindro depois do PMS, por ~3 s. O RADIAL.md diz de 5° a 60°;
   *  com 9 cilindros a 80° isso deixa buracos de 25° em que nenhum cilindro recebe ar e o motor parado não sai do lugar:
   *  aqui de 3° a 100° (o distribuidor real tem a janela larga para isso) */
  arRadial(c: number, a: number) {
    if (a < 3 || a >= 100) return 0;
    return Math.max(0, flow(this.Aar, 20e5, T_MAN, this.p[c], T_MAN));
  }

  somArranque(rng) {
    if (this.state !== 'crank') return 0;
    return this.partidaTipo === 'direta' ? AV.somDireta.call(this, rng) : 0;
  }

  controleRadial(dtc: number) {
    AV.controleAv.call(this, dtc);
    const tipo = this.partidaTipo;
    // galope da lenta (RADIAL.md 4.3–4.4): uma falha de vela de vez em quando (2–4%, mais com carburador de boia) e o
    // balanço lento da mistura (ruído abaixo de ~0,4 Hz, ±20%) que, com a inércia alta, dá o vagar de 2–4% da rotação
    const lento = this.state === 'run' && !this.lockOmega ? clamp(1 - (this.rpmAvg - this.idle) / 1200, 0, 1) : 0;
    this.falhaLenta = lento * (this.cfg?.carburador === 'boia' ? 0.045 : 0.025);
    this.galL += (1 - Math.exp(-dtc * TAU * 0.4)) * (this.galN.bi() * 4 - this.galL);
    this.qMix *= 1 + 0.2 * lento * clamp(this.galL, -1.5, 1.5);
    if (this.fase === 'energizar') {
      this.tFase += dtc;
      if (this.tFase >= T_ENERGIZAR) this.engatar();
    }
    if (this.state === 'crank') {
      this.tGiro += dtc;
      // contagem de pás (o painel conta; os magnetos ligam na 9ª pá no automático)
      const c = this.cargaAv?.hcfg ?? (this.carga?.cfg?.nHelice ? this.carga.cfg : null);
      if (c) this.pas += ((this.omega / c.i) / TAU) * c.B * dtc;
      else this.pas += ((this.omega / TAU) * 3) * dtc;
      // (no de inércia o volante perde força em poucos segundos: se as 9 pás não vieram em 4,5 s, o piloto liga os magnetos assim mesmo)
      if (this.magAuto && this.magnetos === 'desligado' && (this.pas >= 9 || (tipo === 'inercia' && this.tGiro >= 4.5))) this.magnetos = 'ambos';
    }
    if (this.state === 'run' && this.fase === 'girar') {
      this.fase = 'pegou';
      // (engatado com o motor ainda girando da vez anterior, o giro passa do limite de "funcionando" antes da 9ª pá: no
      // automático os magnetos ligam aí. Sem isso o motor ficava "funcionando" sem centelha e parava: o roteiro de
      // navegador troca de preset e engata em menos de 1 s, e só passava quando o giro que sobrava ainda estava acima
      // de 400 rpm na hora da leitura)
      if (this.magAuto && this.magnetos === 'desligado') this.magnetos = 'ambos';
    }
    if (this.state === 'off' && (this.fase === 'girar' || this.fase === 'pegou')) this.fase = 'parado';
    this.arPartida = tipo === 'ar' && this.state === 'crank' && this.tGiro < 3;
    if (this.engateT >= 0) { this.engateT += dtc; if (this.engateT > 3) this.engateT = -1; }
    // apito do volante: sobe de 290 a 390 Hz em 18 s energizando; no engate cai em ~2 s
    if (this.fase === 'energizar') { this.apHz = 290 + 100 * Math.min(1, this.tFase / 18); this.apAmp = smooth(0, 1.5, this.tFase); }
    else if (this.engateT >= 0) { this.apHz *= Math.exp(-dtc / 1.5); this.apAmp *= Math.exp(-dtc / 0.8); }
    else this.apAmp *= Math.exp(-dtc / 0.3);
    if (this.apAmp > 1e-3) this.apF.bp(this.fs, Math.max(60, this.apHz), 25);
    // fumaça: fração esperada de falhas
    let f = 0; for (let k = 0; k < this.N; k++) f += Math.min(1, this.falhaRadial(k));
    this.falhaMedia = this.state === 'run' || this.state === 'crank' ? f / this.N : 0;
    this.fumaca += (this.falhaMedia - this.fumaca) * (1 - Math.exp(-dtc / 2));
    // Megola: os estaques giram com a roda (rpm/i): a panorâmica de cada boca gira junto
    if (this.rotAng !== undefined && this.rads) {
      this.rotAng = (this.rotAng + (this.omega / this.cfg.rotativo.i) * dtc) % TAU;
      for (let k = 0; k < this.rads.length; k++) {
        const p = Math.sin(this.radPhi[k] * DEG + this.rotAng);
        this.rads[k].panL = 0.62 - 0.34 * p; this.rads[k].panR = 0.62 + 0.34 * p;
      }
    }
  }

  mensagemRadial(m: any) {
    if (m.magnetos !== undefined) this.magAuto = false;
    AV.mensagemAv.call(this, m);
    if (m.magAuto !== undefined) this.magAuto = !!m.magAuto;
    if (m.partida === 'energizar' && this.state === 'off') this.setIgnition(true);
    else if (m.partida === 'engatar') this.engatar();
    else if (m.partida === 'parar') this.setIgnition(false);
    if (m.blower !== undefined && this.cfg?.superalimentador?.duasVelocidades) { this.blowerAlta = m.blower === 'alta'; this.tune(this.cfg); }
  }

  telemetriaRadial(t: any) {
    AV.telemetriaAv.call(this, t);
    const rt = this.runT || 0;
    t.fase = this.fase; t.pas = this.pas; t.fumaca = this.fumaca; t.apito = this.apAmp > 0.01 ? this.apHz : 0; t.blower = this.blowerAlta ? 'alta' : 'baixa';
    t.encharque = Array.from(this.encharque, (x: number) => +(x * (1 + 0.3 * (this.prime || 0)) * Math.exp(-rt / 8)).toFixed(2));
    t.cht = this.coolant;
  }

  /** hélice (aviacao.ts) + apito do arranque de inércia (0,02 Pa a 5 m, tom + 2º harmônico −12 dB + banda estreita) */
  somExtraRadial() {
    // (o torque que a hélice absorve, no eixo dela: é o que a lei de carga da FonteHelice lê a cada tique)
    const f = this.heliceSom, ca = this.cargaAv;
    if (f && ca?.helice && this.helK >= 128) f.torque = ca.helice.torque(this.omega) * ca.hcfg.i;
    let x = AV.somExtraAv.call(this);
    if (this.apAmp > 1e-3 && !this.lockOmega) {
      this.apPh += this.apHz / this.fs; if (this.apPh > 1) this.apPh -= 1;
      const kPa = 0.17 / (paLw5(this.nivelEscape) * Math.max(1e-6, this.cfgGain * this.mk));
      const tom = Math.sin(TAU * this.apPh) + 0.25 * Math.sin(2 * TAU * this.apPh) + 2 * this.apF.run(this.apNz.bi());
      x += 0.02 * Math.SQRT2 * kPa * this.apAmp * tom * (this.wE + 0.3 * this.wI + 0.6 * this.wB + 0.2 * this.wP);
    }
    return x;
  }
}

void P0;
