// Síntese física do som do motor a pistão (Ronco). Migrado de src/dsp.js sem mudar a aritmética:
// mesma ordem de operações, mesmas constantes e o mesmo RNG com semente (a renderização offline é
// conferida amostra a amostra contra o legado por tools/ronco-paridade.ts).
//
// Tudo roda amostra a amostra (48 kHz):
//  1. Cada cilindro é um volume de gás com pressão, massa e temperatura. O volume
//     segue a geometria biela/manivela; a combustão libera calor por uma curva de
//     Wiebe; as válvulas são orifícios com escoamento compressível (inclusive
//     blocado/sônico). A pressão no cilindro gera o torque no virabrequim.
//  2. A válvula de escape despeja massa no tubo primário, que é uma guia de onda
//     acústica. O escoamento depende da pressão que já está no tubo (resolvido de
//     forma implícita), então ondas refletidas ajudam ou atrapalham a exaustão
//     como num coletor real.
//  3. Coletores, X-pipe, H-pipe, turbina, abafador e ponteira formam uma rede de
//     guias de onda com junções de espalhamento (src/acoustics/guias.ts).
//  4. Na ponteira: irradiação + ruído de jato proporcional à velocidade do gás.
//  5. Admissão (coletor com borboleta física), ruído mecânico, turbo e posição
//     do ouvinte são somados no final.
//
// Regra do DSP: nada do navegador (nem o `sampleRate` global); a taxa entra no construtor.
// O mesmo arquivo roda no AudioWorklet (src/worklet/processador-ronco.ts) e no Node (tools/).
import {
  TAU, DEG, SOUND_SPEED, P0, RGAS, GAM, clamp, smooth, onePole, flow,
  RNG, Biquad, Line, Junction, TwoPort, Radiator, Cutout, ClosedEnd, port,
} from '../../acoustics';
import type { DSPDeAudio } from '../../worklet/tipos';
import { T_MAN, T_BACK, T_WALL, T_EXREF, SCREW_H, ENV_LOOP } from './constantes';

// Diferencial padrão: motores de giro alto pedem redução maior para a mesma velocidade.
export const defaultFinal = (redline) => 3.55 * clamp(redline / 7000, 0.6, 3);

// Relações de câmbio: progressão geométrica levemente "fechada" nas marchas altas.
export function gearRatios(n) {
  const first = { 4: 3.4, 5: 3.6, 6: 3.9, 7: 4.3, 8: 4.7, 9: 4.7, 10: 4.7 }[n] || 3.8;
  const last = { 4: 0.95, 5: 0.82, 6: 0.72, 7: 0.68, 8: 0.66, 9: 0.6, 10: 0.62 }[n] || 0.72;
  const r = [0];
  for (let i = 0; i < n; i++) r.push(first * Math.pow(last / first, Math.pow(i / (n - 1), 0.85)));
  return r;
}

export class EngineDSP implements DSPDeAudio {
  // estado do motor, do carro e do ouvinte (declarados só para o TypeScript: `declare` não gera código)
  declare fs: any; declare dt: any; declare rng: any; declare post: any; declare cfg: any; declare theta: any; declare omega: any; declare rpmAvg: any; declare state: any; declare crankT: any;
  declare thr: any; declare thrTarget: any; declare brake: any; declare iac: any; declare iacI: any; declare advTrim: any; declare ePrev: any; declare dash: any; declare KP: any; declare KI: any;
  declare iacTrim: any; declare KD: any; declare KA: any; declare KAD: any; declare RG: any; declare pMan: any; declare boost: any; declare turboW: any; declare bovEnv: any; declare bovAmp: any;
  declare limiter: any; declare popWindow: any; declare popDur: any; declare prevThrUser: any; declare exhT: any; declare burnHeat: any; declare als: any; declare gear: any; declare shiftT: any; declare shifting: any;
  declare shiftCut: any; declare blip: any; declare clutch: any; declare locked: any; declare shiftCool: any; declare auto: any; declare ratios: any; declare v: any; declare tqMean: any; declare tqGas: any;
  declare ignition: any; declare params: any; declare wE: any; declare wI: any; declare wB: any; declare wP: any; declare wR: any; declare prop: any; declare propMask: any; declare propW: any;
  declare carX: any; declare airL: any; declare gndL: any; declare shade: any; declare rDist: any; declare vRad: any; declare roadL: any; declare roadR: any; declare roadS: any; declare panS: any;
  declare amb: any; declare ambEnv: any; declare ambMod: any; declare ctrl: any; declare telem: any; declare pops: any; declare phW: any; declare phT: any; declare phS: any; declare dcL: any;
  declare dcR: any; declare dcxL: any; declare dcxR: any; declare lockOmega: any; declare cfgGain: any; declare mkIdle: any; declare tqScale: any; declare tqS: any; declare frMean: any; declare rw: any;
  declare kDrag: any; declare roll: any; declare brakeF: any; declare mk: any; declare fade: any; declare jetGain: any; declare scK: any; declare brkK: any; declare brkFloor: any; declare carbVar: any;
  declare carbMis: any; declare valveNoise: any; declare tzLP: any; declare tzK: any; declare revCd: any; declare varScale: any; declare solverIt: any; declare spread: any; declare boxerAsym: any; declare valveState: any;
  declare valveMode: any; declare valveAuto: any; declare twoStep: any; declare twoStepMode: any; declare lcI: any; declare launching: any; declare boxerPan: any; declare coolant: any; declare ambientT: any; declare tempMode: any;
  declare tempSet: any; declare warm: any; declare fanOn: any; declare fanSpin: any; declare secAir: any; declare catRetard: any; declare idleTarget: any; declare phFan: any; declare phSA: any; declare arcE: any;
  declare arcG: any; declare arcP: any; declare final: any; declare redline: any; declare denied: any; declare shiftTime: any; declare ignCut: any; declare shiftUp: any; declare sinceShift: any; declare N: any;
  declare fire: any; declare tdcRel: any; declare ux: any; declare uy: any; declare dz: any; declare turbo: any; declare blower: any; declare Vd: any; declare bore: any; declare Ap: any;
  declare rCrank: any; declare lRod: any; declare CR: any; declare Vc: any; declare Ar: any; declare Zr: any; declare hw: any; declare Aleak: any; declare p: any; declare m: any;
  declare Vprev: any; declare mEx: any; declare mIn: any; declare densC: any; declare Q: any; declare xb: any; declare air: any; declare armed: any; declare spk: any; declare burnK: any;
  declare aPrev: any; declare cylIn: any; declare cylEx: any; declare cylQ: any; declare powerModel: any; declare tqPeakModel: any; declare frPeakModel: any; declare runT: any; declare lcPrev: any; declare dfcoOn: any;
  declare fuelRamp: any; declare dispL: any; declare J: any; declare Tmax: any; declare mass: any; declare idle: any; declare cam: any; declare maxBoost: any; declare overrun: any; declare hasCat: any;
  declare catNoise: any; declare fuelVar: any; declare engPos: any; declare posW: any; declare airCool: any; declare scType: any; declare scOrder: any; declare scGain: any; declare breakK: any; declare launchRpm: any;
  declare AexMax: any; declare AinMax: any; declare Athr: any; declare Vman: any; declare evo: any; declare evc: any; declare ivo: any; declare ivc: any; declare Jtc: any; declare driveMode: any;
  declare limType: any; declare limBand: any; declare limHold: any; declare pipeA: any; declare bankJ: any; declare brkW: any; declare lines: any; declare nodes: any; declare runners: any; declare rads: any;
  declare radHP: any; declare radSh: any; declare itdB: any; declare itdM: any; declare itdW: any; declare itdD: any; declare jetF: any; declare jetEnv: any; declare tipA: any; declare inF: any;
  declare inGain: any; declare hissF: any; declare hissGain: any; declare clickF: any; declare brkF: any; declare brkLP: any; declare brkE: any; declare cabBrk: any; declare brkKa: any; declare brkKd: any;
  declare brkKl: any; declare brkKs: any; declare brkS: any; declare knockF: any; declare mechHP: any; declare saF: any; declare fanF: any; declare vibLP: any; declare starterLP: any; declare turboHiss: any;
  declare scHiss: any; declare bovF: any; declare cabL: any; declare cabR: any; declare cabIn: any; declare cabMech: any; declare extMech: any; declare bayEx: any; declare inPrev: any; declare clickEnv: any;
  declare knockEnv: any; declare alsArm: any; declare shiftRetard: any; declare limPrev: any; declare limI: any; declare limRetard: any; declare limFrac: any; declare limT: any; declare lacc: any; declare scJit: any;
  declare phB: any; declare scIn: any; declare ambL: any; declare ambR: any; declare ambSpec: any; declare ambHum: any;
  // ignição por compressão (src/engines/diesel/dsp.ts, DieselDSP): flag, ciclo e os ramos que a subclasse implementa
  declare cc: any; declare tempos: any; declare ciclo: any; declare tParede: any; declare fmepK: any; declare pmeCarga: any; declare rpmPartida: any;
  declare ccInjecao: any; declare ccValvulas: any; declare ccQueima: any; declare ccEscape: any; declare ccAdmissao: any; declare ccMecanica: any; declare ccTurbo: any;
  // adaptador Motor da Cena (src/engines/ronco/motor.ts): só lê os canais antes da mistura; null no Ronco
  declare tap: any;

  constructor(fs) {
    this.fs = fs; this.dt = 1 / fs;
    this.rng = new RNG(12345);
    this.post = null;
    this.cfg = null;
    this.theta = 0; this.omega = 0; this.rpmAvg = 0;
    this.state = 'off'; this.crankT = 0;
    this.thr = 0; this.thrTarget = 0; this.brake = 0;
    this.iac = 0.004; this.iacI = 0.006; this.advTrim = 0; this.ePrev = 0; this.dash = 0;
    this.KP = 0.0015; this.KI = 0.0035; this.iacTrim = 1; this.KD = 0.0012; this.KA = 40; this.KAD = 0; this.RG = 0.08;
    this.pMan = P0; this.boost = 0; this.turboW = 0; this.bovEnv = 0; this.bovAmp = 0;
    this.limiter = false; this.popWindow = 0; this.popDur = 1; this.prevThrUser = 0; this.exhT = 20; this.burnHeat = 1; this.als = false;
    this.gear = 0; this.shiftT = 0; this.shifting = false; this.shiftCut = false; this.blip = false; this.clutch = 1; this.locked = false;
    this.shiftCool = 0; this.auto = false; this.ratios = gearRatios(6);
    this.v = 0; this.tqMean = 0; this.tqGas = 0;
    this.ignition = false;
    this.params = { listener: 'ext', env: 'open', roadDist: 6, exhaust: 1, intake: 1, mech: 1, air: 1, master: 0.8, fanSound: true, saSound: true, ambSound: true, dynamics: 'real' };
    this.wE = 1; this.wI = 0; this.wB = 0; this.wP = 0; this.wR = 0;
    // observador parado na via: propagação pelo ar com atraso variável (Doppler)
    let ps = 1024; while (ps < fs * 2.6) ps <<= 1;
    this.prop = new Float32Array(ps); this.propMask = ps - 1; this.propW = 0;
    this.carX = -12; this.airL = 0; this.gndL = 0; this.shade = 0; this.rDist = 12; this.vRad = 0;
    this.roadL = 0; this.roadR = 0; this.roadS = 0; this.panS = 0;
    this.amb = [new Biquad().lp(fs, 220, 0.7), new Biquad().lp(fs, 220, 0.7), new Biquad().bp(fs, 900, 0.7), new Biquad().bp(fs, 900, 0.7)];
    this.ambEnv = ''; this.ambMod = 0;
    this.ctrl = 0; this.telem = 0;
    this.pops = [];
    this.phW = 0; this.phT = 0; this.phS = 0;
    this.dcL = 0; this.dcR = 0; this.dcxL = 0; this.dcxR = 0;
    this.lockOmega = false; this.cfgGain = 1; this.mkIdle = 1; this.tqScale = 1; this.tqS = 1; this.frMean = 0; this.rw = 0.33; this.kDrag = 0.42; this.roll = 165; this.brakeF = 13000; this.mk = 1; this.fade = 1; this.jetGain = 500; this.scK = 1; this.brkK = 0.034; this.brkFloor = 0.5; this.carbVar = 0.04; this.carbMis = 0.01; this.valveNoise = 0.05; this.tzLP = 0; this.tzK = 0.15; this.revCd = 0.15; this.varScale = 1; this.solverIt = 6; this.spread = 1; this.boxerAsym = 0.15; this.valveState = { v: 0 }; this.valveMode = 'closed'; this.valveAuto = false; this.twoStep = false; this.twoStepMode = 'off'; this.lcI = 0.12; this.launching = false; this.boxerPan = [1.0, 0.5, 0.22, 0.55];
    // temperatura do líquido de arrefecimento (°C); começa frio, como numa manhã qualquer
    this.coolant = 20; this.ambientT = 20; this.tempMode = 'real'; this.tempSet = 90; this.warm = 0;
    this.fanOn = false; this.fanSpin = 0; this.secAir = 0; this.catRetard = 0; this.idleTarget = 0; this.phFan = 0; this.phSA = 0;
    this.arcE = 0; this.arcG = 1; this.arcP = 0; // nivelador do modo arcade
    this.cc = false; this.tempos = 4; // gasolina; o DieselDSP põe cc = true e o ciclo do preset
    this.tap = null;
  }

  message(m) {
    if (m.type === 'config') this.setConfig(m.cfg);
    else if (m.type === 'tune') { if (this.cfg) this.tune(m.cfg); }
    else if (m.type === 'params') Object.assign(this.params, m.params);
    else if (m.type === 'input') {
      if (m.throttle !== undefined) this.thrTarget = clamp(m.throttle, 0, 1);
      if (m.brake !== undefined) this.brake = clamp(m.brake, 0, 1);
      if (m.ignition !== undefined) this.setIgnition(m.ignition);
      if (m.shift) this.requestShift(m.shift);
      if (m.temp) {
        if (m.temp.mode) this.tempMode = m.temp.mode;
        if (m.temp.value !== undefined) { this.coolant = clamp(m.temp.value, -20, 130); this.tempSet = this.coolant; }
      }
    }
  }

  setIgnition(on) {
    this.ignition = on;
    if (on && this.state === 'off') { this.state = 'crank'; this.crankT = 0; }
    if (!on) this.state = 'off';
  }

  requestShift(dir) {
    const target = clamp(this.gear + dir, 0, this.ratios.length - 1);
    if (target === this.gear) return;
    const up = target > this.gear;
    // proteção contra redução que estouraria o giro (como nos câmbios modernos)
    const after = (this.v / this.rw) * this.ratios[target] * this.final * 9.549;
    if (!up && target > 0 && after > this.redline * 1.02) { this.denied = 0.6; return; }
    this.shifting = true;
    // tempo de troca do carro: metade com a marcha em transição, metade soltando a embreagem
    const st = this.shiftTime;
    this.shiftT = this.gear === 0 || target === 0 ? 0.05 : Math.max(0.02, up ? 0.5 * st : 0.75 * st);
    // subida de pé embaixo: corta a ignição, menos no automático com conversor (troca lenta): lá a
    // central só atrasa a ignição (shiftRetard) e o motor segue queimando e roncando durante a troca
    const hard = up && this.thr > 0.5 && this.gear > 0, tc = this.auto && st > 0.2;
    this.shiftCut = hard && !tc;
    // troca comandada pela central (dupla embreagem, automático, quickshifter): a central tira torque
    // e a borboleta fica aberta, então o turbo não despeja. Troca manual normal: o
    // motorista tira o pé e a válvula de alívio solta a pressão.
    this.ignCut = this.auto || this.shiftTime <= 0.2;
    this.shiftUp = up; this.sinceShift = 0;
    this.blip = !up && target > 0 && after > this.rpmAvg * 1.05;
    // automático (troca embreagem-a-embreagem): na subida a próxima marcha já vai
    // pegando enquanto a outra solta, então o motor é puxado para baixo e não dispara
    // (com conversor e sem corte a embreagem nova aperta mais, para a troca durar o mesmo)
    this.clutch = this.auto && up && this.gear > 0 ? (hard && tc ? 0.75 : 0.3) : 0;
    this.gear = target;
    this.shiftCool = Math.max(0.3, 1.5 * st + 0.2);
  }

  setConfig(cfg, calibrate = true) {
    const prevN = this.N;
    this.cfg = cfg;
    const N = cfg.N;
    this.N = N;
    this.fire = Float64Array.from(cfg.fire);
    this.tdcRel = Float64Array.from(cfg.tdcRel);
    this.ux = Float64Array.from(cfg.axis.map((a) => Math.sin(a * DEG)));
    this.uy = Float64Array.from(cfg.axis.map((a) => Math.cos(a * DEG)));
    const zc = cfg.z.reduce((s, x) => s + x, 0) / N;
    this.dz = Float64Array.from(cfg.z.map((x) => x - zc));
    this.turbo = cfg.aspiration === 'turbo';
    this.blower = cfg.aspiration === 'super'; // compressor mecânico, tocado por correia

    // geometria do cilindro (curso = diâmetro)
    const Vd = (cfg.displacement / N) * 1e-3;
    const bore = Math.cbrt((4 * Vd) / Math.PI);
    this.Vd = Vd; this.bore = bore;
    this.Ap = (Math.PI / 4) * bore * bore;
    this.rCrank = bore / 2; this.lRod = this.rCrank / 0.3;
    // taxa de compressão: motor antigo, feito para gasolina de baixa octanagem, comprime pouco (Fusca 7,5:1) e
    // expande pouco: o gás chega à abertura do escape mais quente e com pressão, e o pulso sai mais forte e estalado
    this.CR = clamp(cfg.compression || (this.turbo || this.blower ? 9.5 : 11), 6, this.cc ? 24 : 15);
    this.Vc = Vd / (this.CR - 1);
    this.Ar = 0.16 * bore * bore;           // seção do tubo primário
    this.Zr = SOUND_SPEED / this.Ar;         // impedância: Pa por kg/s
    this.hw = 900 * this.Ap * 2.5;           // perda de calor pelas paredes (W/K), em carga
    this.Aleak = 1.2e-4 * bore * bore;       // folga equivalente dos anéis

    this.tune(cfg);

    // estado termodinâmico por cilindro
    const pinit = this.pMan;
    this.p = new Float64Array(N); this.m = new Float64Array(N); this.Vprev = new Float64Array(N);
    this.mEx = new Float64Array(N); this.mIn = new Float64Array(N); this.densC = new Float64Array(N).fill(1);
    this.Q = new Float64Array(N); this.xb = new Float64Array(N); this.air = new Float64Array(N);
    this.armed = new Uint8Array(N); this.spk = new Float64Array(N); this.burnK = new Float64Array(N).fill(1);
    this.aPrev = new Float64Array(N);
    // nenhum cilindro é igual ao outro: distribuição de ar no coletor, sede de
    // válvula, injetor e câmara variam alguns por cento. Isso gera as ordens que
    // não são de ignição (0,5, 1, 2...) que dão o caráter "mecânico" dos motores reais.
    // carburador: a mistura se divide mal pelo coletor e cada cilindro recebe um pouco
    // diferente (e varia de explosão a explosão) — é o "galope" dos motores antigos
    const sr = new RNG(0x51ed27 + N * 7919), sp = this.spread * (cfg.fuel === 'carb' ? 2.6 : 1);
    this.cylIn = new Float64Array(N); this.cylEx = new Float64Array(N); this.cylQ = new Float64Array(N);
    for (let c = 0; c < N; c++) {
      this.cylIn[c] = 1 + 0.07 * sp * sr.bi();
      this.cylEx[c] = 1 + 0.1 * sp * sr.bi();
      this.cylQ[c] = 1 + 0.05 * sp * sr.bi();
    }
    for (let c = 0; c < N; c++) {
      const a = ((this.theta - this.fire[c]) % 720 + 720) % 720;
      this.aPrev[c] = a;
      const V = this.volume(a);
      this.Vprev[c] = V; this.p[c] = pinit; this.m[c] = (pinit * V) / (RGAS * T_MAN);
      this.xb[c] = 1;
    }
    this.buildExhaust(cfg);
    this.buildFilters(cfg);
    // (a interface calibra fora da thread de áudio e manda o resultado em cfg.gain/mkIdle/powerModel)
    if (cfg.gain) { this.cfgGain = cfg.gain; this.mkIdle = cfg.mkIdle || 1; }
    else if (calibrate) { const c = this.calibrate(cfg); this.cfgGain = c.gain; this.mkIdle = c.idle; }
    else { this.cfgGain = 1; this.mkIdle = 1; }
    if (cfg.powerModel) { this.powerModel = cfg.powerModel; this.tqPeakModel = cfg.tqPeakModel; this.frPeakModel = cfg.frPeakModel; this.tune(cfg); }
    else if (calibrate && cfg.power && !cfg.gain) { const pm = this.measurePower(cfg); this.powerModel = pm.kw; this.tqPeakModel = pm.tq; this.frPeakModel = pm.fr; this.tune(cfg); }
    this.fade = 0;
    // trocou de carro com o motor ligado: o motor novo dá a partida do zero. Herdar giro,
    // marcha e o controle de marcha lenta "aprendido" no outro motor deixava a lenta
    // instável e às vezes apagava (uma moto nascendo a 750 rpm de um V8, por exemplo)
    if ((this.state === 'run' || this.state === 'crank') && (cfg.fresh || prevN !== N)) this.freshStart();
  }

  freshStart() {
    this.state = 'crank'; this.crankT = 0; this.runT = 0;
    this.omega = 0; this.rpmAvg = 0;
    this.iacI = 0.006; this.iac = 0.004; this.dash = 0; this.ePrev = 0; this.advTrim = 0; this.lcI = 0.12; this.lcPrev = undefined;
    this.limiter = false; this.pops.length = 0; this.boost = 0; this.turboW = 0; this.bovEnv = 0; this.catRetard = 0; this.exhT = this.ambientT; this.popWindow = 0; this.als = false;
    this.gear = 0; this.clutch = 1; this.locked = false; this.shifting = false; this.shiftCut = false; this.blip = false; this.v = 0;
    this.pMan = P0; this.thr = 0; this.dfcoOn = false; this.fuelRamp = 1;
  }

  // Parâmetros escalares que podem mudar sem reconstruir a acústica.
  tune(cfg) {
    this.dispL = cfg.displacement;
    this.J = (0.05 + 0.045 * cfg.displacement) * cfg.inertia;
    this.Tmax = 95 * cfg.displacement * (this.turbo || this.blower ? 1 + 0.8 * cfg.boost : 1);
    // carro: massa, raio da roda e arrasto da ficha técnica (ou um chute pela cilindrada)
    this.mass = cfg.mass || clamp(850 + 160 * cfg.displacement, 950, 1900);
    this.rw = cfg.wheelR || 0.33;
    this.kDrag = cfg.drag ?? 0.42;           // ½·ρ·Cd·A (N por (m/s)²)
    this.roll = 0.012 * this.mass * 9.81;      // rolagem
    this.brakeF = 0.9 * this.mass * 9.81;      // freio: ~0,9 g
    // torque escalado até a potência da ficha técnica (medida na calibração); o som não muda, só a dinâmica
    // (a escala age no torque bruto dos gases; o atrito fica de fora, então ela é um pouco diferente da razão das potências)
    if (cfg.power && this.powerModel) {
      const r = cfg.power / this.powerModel, net = this.tqPeakModel, fr = this.frPeakModel || 0;
      this.tqScale = clamp((r * net + fr) / (net + fr), 0.3, 3);
    } else this.tqScale = 1;
    if (this.tqPeakModel) this.Tmax = Math.max(this.Tmax, this.tqPeakModel * this.tqScale);
    this.redline = cfg.redline; this.idle = cfg.idle;
    this.final = cfg.finalDrive || defaultFinal(cfg.redline);
    this.cam = cfg.cam;
    this.maxBoost = cfg.boost;
    // estalos: o mapa da desaceleração e o catalisador (sem os campos: carburador não corta na desaceleração,
    // e só o escape direto de corrida/moto não tem catalisador)
    this.overrun = cfg.overrun || (cfg.fuel === 'carb' ? 'lean' : 'cut');
    if (this.overrun === 'antilag' && !this.turbo) this.overrun = 'popbang';
    this.hasCat = cfg.cat ?? cfg.muffler !== 'straight';
    this.catNoise = this.hasCat ? 0.8 : 1;
    this.fuelVar = cfg.fuel === 'carb' ? 1.9 : 1;
    // posição do motor → [pulso da admissão, mecânica, compressor, parte sem a sombra da carroceria, chiado] na câmera de trás
    this.engPos = cfg.engine || (cfg.family === 'moto' ? 'mid' : 'front');
    this.posW = { front: [0.12, 0.1, 0.07, 0, 0.12], mid: [0.15, 0.2, 0.22, 0.5, 0.12], rear: [0.15, 0.15, 0.3, 1, 0.12] }[this.engPos] || [0.12, 0.1, 0.07, 0, 0.12];
    // refrigerado a ar: sem camisa d'água a mecânica soa mais, e não há ventoinha elétrica de radiador. (O sopro da
    // ventoinha de correia do Fusca foi testado: no som real ele não aparece, e aqui soava como mar)
    this.airCool = cfg.cooling === 'air';
    // compressor mecânico: o uivo é a pulsação da descarga a cada passagem de lóbulo (ou de pá). Roots: cada um dos
    // dois rotores descarrega um bolsão por lóbulo; duplo parafuso: um por lóbulo do rotor tocado pela correia;
    // centrífugo: uma por pá do rotor. A frequência é giro × relação da polia × passagens por volta do rotor
    this.scType = cfg.scType || 'screw';
    this.scOrder = (cfg.scRatio || 2.4) * (cfg.scLobes || 6) * (this.scType === 'roots' ? 2 : 1);
    this.scGain = Math.pow(10, (cfg.scWhine ?? 0) / 20);
    // vedação do escape perto do motor: coletor de parede grossa e juntas soldadas não deixa a rajada da abertura
    // escapar; paredes finas e juntas deslizantes (Fusca, carros antigos) deixam, e com vazamento mais ainda
    this.breakK = { sealed: 0, old: 1, leaky: 2.2 }[cfg.breakout] || 0;
    this.valveMode = cfg.valve || 'closed';
    // 2-step: 'cut' corta a ignição no limite; 'soft' (controle de largada) dosa o acelerador
    this.twoStepMode = cfg.twoStep === true ? 'cut' : cfg.twoStep || 'off';
    this.twoStep = this.twoStepMode !== 'off';
    this.launchRpm = cfg.launchRpm ? clamp(cfg.launchRpm, cfg.idle * 1.3, cfg.redline * 0.95) : clamp(cfg.redline * 0.5, cfg.idle * 2.2, cfg.redline * 0.8);
    const bore = this.bore || 0.08;
    const lift = 1 + 0.35 * cfg.cam + 0.25 * clamp((cfg.redline - 7000) / 7000, 0, 1.5);
    this.AexMax = 0.10 * bore * bore * lift;
    this.AinMax = 0.13 * bore * bore * lift;
    this.Athr = 1.6e-3 * cfg.displacement * clamp(cfg.redline / 7000, 0.8, 2.5) * (cfg.intake === 'itb' ? 1.3 : 1);
    this.Vman = (cfg.intake === 'itb' ? 0.35 : 1.0) * cfg.displacement * 1e-3;
    // eventos de válvula (graus após o PMS de ignição); comando bravo = mais cruzamento
    const cam = cfg.cam;
    this.evo = 132 - 28 * cam; this.evc = 372 + 34 * cam;
    this.ivo = 348 - 34 * cam; this.ivc = 572 + 34 * cam;
    if (cfg.gears) {
      this.ratios = cfg.ratios && cfg.ratios.length === cfg.gears ? [0, ...cfg.ratios] : gearRatios(cfg.gears);
      if (this.gear > cfg.gears) this.gear = cfg.gears;
    }
    if (cfg.transmission) this.auto = cfg.transmission === 'auto';
    this.shiftTime = clamp(cfg.shiftTime || (this.auto ? 0.36 : 0.26), 0.04, 1);
    // automático com conversor de torque (troca lenta; o de dupla embreagem abre as embreagens em ponto morto e o
    // motor gira solto): o impulsor é aparafusado no volante e o óleo arrasta a turbina e o eixo de entrada, então em
    // ponto morto o motor sobe de giro bem mais devagar que um manual. Num Hellcat a acelerada em ponto morto sobe
    // ~9000 rpm/s, com a nota varrendo da lenta até o alto; solto, o motor ia de 1100 a 4800 rpm em 0,1 s
    this.Jtc = this.auto && this.shiftTime > 0.2 ? 0.06 + 0.035 * cfg.displacement : 0;
    this.J = (0.05 + 0.045 * cfg.displacement) * cfg.inertia + this.Jtc;
    this.driveMode = cfg.driveMode || 'auto';
    // corte de giro: tipo, faixa (quanto o giro cai antes de voltar) e tempo mínimo de cada corte
    this.limType = cfg.limiter || 'ign';
    // (faixa pequena + ~70 ms de corte: batido rápido em neutro e em marcha, como nas centrais reais)
    this.limBand = clamp(cfg.limiterBand || 70, 30, 1000);
    this.limHold = clamp(cfg.limiterHold ?? 0.07, 0, 0.5);
  }

  volume(a) {
    const th = a * DEG, r = this.rCrank, l = this.lRod, s = Math.sin(th);
    return this.Vc + this.Ap * (r * (1 - Math.cos(th)) + l - Math.sqrt(l * l - r * r * s * s));
  }

  // Renderiza um trecho em carga total a rotação fixa para normalizar o volume
  // entre configurações (mantendo a diferença natural entre abafadores).
  calibrate(cfg) {
    const t = new EngineDSP(this.fs);
    t.setConfig({ ...cfg, muffler: 'sport', valve: 'none', pipeD: 2.5, reso: false, twoStep: false, breakout: 'sealed', scWhine: 0 }, false);
    t.state = 'run'; t.lockOmega = true; t.tempMode = 'fixed'; t.tempSet = 90; t.coolant = 90;
    t.omega = (this.redline * 0.55 * TAU) / 60; t.rpmAvg = this.redline * 0.55;
    // turbo calibrado em pressão parcial: com a pressão cheia o motor sopra quase o dobro de ar e
    // o resto do tempo (sem pressão) ficaria baixo demais, como se o carro estivesse longe
    t.thrTarget = 1; t.thr = 1; t.turboW = 0.6; t.boost = cfg.boost * (this.blower ? 0.8 : 0.3);
    t.maxBoost = cfg.boost * (this.blower ? 0.8 : 0.4); // (o controle recalcula a pressão; limita aqui de verdade)
    t.params.master = 0.02;
    const B = 256, L = new Float32Array(B), R = new Float32Array(B);
    let acc = 0, cnt = 0, pk = 0;
    for (let i = 0; i < 0.5 * this.fs; i += B) {
      t.process(L, R, B);
      if (i > 0.25 * this.fs) for (let k = 0; k < B; k++) { acc += L[k] * L[k] + R[k] * R[k]; cnt += 2; pk = Math.max(pk, Math.abs(L[k]), Math.abs(R[k])); }
    }
    const rms = Math.sqrt(acc / Math.max(1, cnt)) / 0.01;
    const target = 0.17; // RMS em carga total (master 1); deixa ~5 dB de folga antes do limitador de saída
    const gWot = Math.min(target / Math.max(rms, 1e-6), 0.9 / Math.max(pk / 0.01, 1e-6)); // (e o pico em carga fica abaixo do limitador)
    // e em marcha lenta: motores com dinâmica muito diferente (turbo abafado × corrida) ficavam
    // 30 dB apartados na lenta; a média geométrica (pesada 60/40 para a carga) dos dois ganhos divide essa diferença ao meio
    const ti = new EngineDSP(this.fs);
    ti.setConfig({ ...cfg, muffler: 'sport', valve: 'none', pipeD: 2.5, reso: false, twoStep: false, breakout: 'sealed', scWhine: 0 }, false);
    ti.state = 'run'; ti.lockOmega = true; ti.tempMode = 'fixed'; ti.tempSet = 90; ti.coolant = 90; ti.runT = 60;
    ti.omega = (this.idle * TAU) / 60; ti.rpmAvg = this.idle; ti.thrTarget = 0; ti.thr = 0; ti.params.master = 0.02; ti.dash = 0;
    // com o giro travado o controle de lenta não tem o que corrigir; aqui a válvula de ar é ajustada até o
    // torque médio ficar em zero, que é onde a lenta de verdade se equilibra (sem isso a sonda ficava ~4 dB
    // mais alta que a lenta real e a lenta saía baixa demais)
    let acc2 = 0, cnt2 = 0;
    for (let i = 0; i < 1.2 * this.fs; i += B) {
      ti.process(L, R, B);
      ti.dash = 0; ti.iacI = clamp(ti.iacI - 5e-4 * ti.tqMean * (B / this.fs), 0, 0.05);
      if (i > 0.8 * this.fs) for (let k = 0; k < B; k++) { acc2 += L[k] * L[k] + R[k] * R[k]; cnt2 += 2; }
    }
    const rmsIdle = Math.sqrt(acc2 / Math.max(1, cnt2)) / 0.01;
    // lenta ~21 dB abaixo da carga total (motores reais: 20 a 25 dB entre a lenta e o corte em carga).
    // O ganho é o da carga; a lenta ganha um reforço próprio, aplicado por rotação (ver `mk` no process)
    const gIdle = (target * 0.09) / Math.max(rmsIdle, 1e-6);
    const gain = clamp(gWot, 0.05, 40);
    return { gain, idle: clamp(gIdle / gain, 1, 8) };
  }

  // Mede a potência que o modelo entrega em carga total (kW) e o torque de pico (N·m), para escalar
  // a dinâmica até a ficha técnica do carro sem mexer no som.
  measurePower(cfg) {
    const t = new EngineDSP(this.fs);
    t.setConfig({ ...cfg, muffler: 'sport', valve: 'none', pipeD: 2.5, reso: false, twoStep: false, breakout: 'sealed', scWhine: 0, limiter: 'none', power: undefined }, false);
    t.state = 'run'; t.lockOmega = true; t.tempMode = 'fixed'; t.tempSet = 90; t.coolant = 90; t.runT = 100;
    t.thrTarget = 1; t.thr = 1; t.turboW = 1; t.boost = cfg.boost; t.maxBoost = cfg.boost; t.params.master = 0;
    const B = 256, L = new Float32Array(B), R = new Float32Array(B);
    let kw = 0, tq = 0, fr = 0;
    for (const f of [0.6, 0.75, 0.9]) {
      t.omega = (this.redline * f * TAU) / 60; t.rpmAvg = this.redline * f; t.tqMean = 0; t.frMean = 0;
      for (let i = 0; i < 0.35 * this.fs; i += B) t.process(L, R, B);
      const k = (t.tqMean * t.omega) / 1000;
      if (k > kw) { kw = k; tq = t.tqMean; fr = t.frMean; }
    }
    return { kw: Math.max(kw, 1), tq: Math.max(tq, 1), fr: Math.max(fr, 0) };
  }

  buildExhaust(cfg) {
    const fs = this.fs, N = this.N;
    const lines = []; const nodes = []; const runners = new Array(N); const rads = [];
    // (afiamento da onda: o teórico é (γ+1)/2γ ≈ 0,88; atrito e troca de calor nas paredes seguram a frente, e 0,6
    // bate com gravações de V8 acelerando. Com o chiado de jato antigo, alto em qualquer giro, isso virava um
    // muro de agudo e o valor tinha descido a 0,28, o que deixava o ronco abafado)
    const L = (len, Y, loss, damp = 1) => { const l = new Line(fs, len, Y, loss, damp); l.kNL = 0.6; lines.push(l); return l; };
    const pipe = cfg.pipeLen;
    // diâmetro do escape (referência 2,5"): área muda a impedância vista pelo coletor,
    // tubo fino atrita mais e acelera o gás (mais chiado de jato), ponta larga irradia mais grave
    const ds = clamp((cfg.pipeD || 2.5) / 2.5, 0.6, 1.6), A2 = ds * ds, dw = 1 / ds;
    this.pipeA = A2;
    // ka = 1 na boca: c/(2πa) com o gás já mais frio na ponta (~400 m/s); raio 31,75 mm numa ponta de 2,5"
    const fRad = 400 / (TAU * 0.03175 * ds);
    const bankOut = []; this.bankJ = [];
    const meanRun = cfg.runners.reduce((a, b) => a + b, 0) / N; this.brkW = new Float64Array(N).fill(1);
    for (let b = 0; b < cfg.banks; b++) {
      const cyls = [];
      for (let c = 0; c < N; c++) if (cfg.bank[c] === b) cyls.push(c);
      const ports = [];
      for (const c of cyls) {
        // caixas de calefação (Fusca): os tubos longos atravessam o trocador aletado, que come agudo e esfria o gás
        const heat = cfg.header === 'heater' && cfg.runners[c] > meanRun;
        const r = heat ? L(cfg.runners[c], 1, 5000, 2.5) : L(cfg.runners[c], 1, 12000); r.runner = true;
        this.brkW[c] = (heat ? 0.35 : 1) * (1 + 0.2 * new RNG(0x7a11 + 977 * c + 31 * N).bi()); // (cada junta vaza um pouco diferente)
        runners[c] = r;
        ports.push(port(r, 1));
      }
      const Yc = Math.max(1, cyls.length * 0.55);
      const extra = cfg.routing === 'dual' && cfg.banks === 2 ? pipe * 0.55 * (b ? 1.03 + (cfg.layout === 'boxer' ? this.boxerAsym : 0) : 1) : 0;
      const col = L(0.32 + (this.turbo ? 0 : extra), Yc * A2, 10000, dw);
      ports.push(port(col, 0));
      const j = new Junction(ports); nodes.push(j); this.bankJ.push(j);
      let out = col;
      if (this.turbo) {
        const t = L(0.22 + extra, Yc * A2, 9000, dw);
        nodes.push(new TwoPort(fs, port(col, 1), port(t, 0), 'turbo'));
        out = t;
      }
      bankOut.push(out);
    }
    const Ym = bankOut[0].Y;
    // ressonador: tubo lateral fechado de 1/4 de onda, afinado no ronco de cruzeiro (~2200 rpm)
    const resoLen = clamp(SOUND_SPEED / (4 * (N / 2) * (2200 / 60)), 0.25, 2.2);
    const addTail = (mid, panL, panR) => {
      let feed = mid;
      if (cfg.reso) {
        const br = L(resoLen, mid.Y * 0.6, 6000); br.kNL = 0;
        const m2 = L(0.15, mid.Y, 9000, dw);
        nodes.push(new Junction([port(mid, 1), port(br, 0), port(m2, 0)]), new ClosedEnd(br));
        feed = m2;
      }
      if (cfg.valve && cfg.valve !== 'none') {
        const stub = L(0.2, mid.Y * 0.9, 5000, dw), m3 = L(0.12, mid.Y, 9000, dw);
        nodes.push(new Junction([port(feed, 1), port(stub, 0), port(m3, 0)]));
        const cut = new Cutout(fs, stub, 0.5 + 0.3 * (panL - panR), 0.5 + 0.3 * (panR - panL), 1500 / ds, 1.0 * A2, this.valveState, fRad);
        nodes.push(cut); rads.push(cut);
        feed = m3;
      }
      const tail = L(pipe * 0.3, mid.Y, 9000, dw);
      // depois do abafador a onda já é fraca: quase não se afia de novo (senão refaz os agudos que ele tirou)
      tail.kNL = cfg.muffler === 'stock' ? 0.05 : cfg.muffler === 'classic' ? 0.15 : 0.6;
      nodes.push(new TwoPort(fs, port(feed, 1), port(tail, 0), cfg.muffler));
      const r = new Radiator(fs, tail, panL, panR, 1500 / ds, A2, fRad); nodes.push(r); rads.push(r);
    };
    const routing = cfg.routing;
    if (routing === 'single') {
      const mid = L(pipe * 0.55, Ym * (cfg.banks === 2 ? 1.4 : 1), 9000, dw);
      nodes.push(new Junction([...bankOut.map((o) => port(o, 1)), port(mid, 0)]));
      addTail(mid, 0.62, 0.78);
    } else if (cfg.banks === 1) {
      const mL = L(pipe * 0.55, Ym, 9000, dw), mR = L(pipe * 0.55 * 1.03, Ym, 9000, dw);
      nodes.push(new Junction([...bankOut.map((o) => port(o, 1)), port(mL, 0), port(mR, 0)]));
      addTail(mL, 0.95, 0.32); addTail(mR, 0.32, 0.95);
    } else if (routing === 'xpipe' || routing === 'hpipe') {
      // H: tubo fino de equalização. X: cruzamento curto e largo, onde os pulsos se trocam em boa parte, mas
      // cada lado ainda leva o ritmo da sua bancada. (Uma junção única deixava as duas ponteiras idênticas e
      // apagava o "pop" de cada volta do V8 de virabrequim cruzado: correlação 0,99 entre os ouvidos)
      const x = routing === 'xpipe';
      const mL = L(pipe * 0.55, Ym, 9000, dw), mR = L(pipe * 0.55 * 1.03, Ym, 9000, dw);
      const bal = L(x ? 0.1 : 0.28, Ym * (x ? 0.8 : 0.35), x ? 8000 : 6000); bal.kNL = 0;
      nodes.push(new Junction([port(bankOut[0], 1), port(mL, 0), port(bal, 0)]));
      nodes.push(new Junction([port(bankOut[1], 1), port(mR, 0), port(bal, 1)]));
      addTail(mL, 0.95, 0.32); addTail(mR, 0.32, 0.95);
    } else {
      // duplo: bancadas totalmente separadas até as ponteiras
      if (cfg.layout === 'boxer') {
        // boxer traseiro: o tubo da bancada B cruza por baixo do motor e cada
        // ponteira fica de um lado, mais perto de um ouvido. Assim a meia-ordem de
        // cada bancada (1,5ª num flat-6, que se anula quando as bancadas se somam
        // por igual) sobrevive: é ela que separa o "ronco de boxer" de um 6 em linha.
        const bp = this.boxerPan;
        addTail(bankOut[0], bp[0], bp[1]);
        addTail(bankOut[1], bp[2], bp[3]);
      } else {
        addTail(bankOut[0], 0.95, 0.28);
        addTail(bankOut[1], 0.28, 0.95);
      }
    }
    this.lines = lines; this.nodes = nodes; this.runners = runners; this.rads = rads;
    this.radHP = rads.map(() => new Biquad().hp(this.fs, 45, 0.7));
    // microfones junto ao carro: a ponteira fica a ~35 cm do asfalto, e abaixo de ~200 Hz a reflexão no chão
    // chega em fase (fonte-imagem): é o "peso" do grave que se sente perto do escape
    // (acima disso a reflexão não some, soma em potência: +3 dB em média; o ganho relativo do grave é ~3 dB)
    this.radSh = rads.map(() => new Biquad().peak(this.fs, 110, 0.6, 3));
    // de fora, cada ouvido recebe cada ponteira com um pequeno atraso conforme o lado (até ~0,6 ms): é a
    // diferença de tempo entre os ouvidos que tira o som "de dentro da cabeça" no fone; só o volume não basta
    let ib = 64; while (ib < this.fs * 0.0015) ib <<= 1;
    this.itdB = rads.map(() => new Float32Array(ib)); this.itdM = ib - 1; this.itdW = 0;
    this.itdD = rads.map((r) => {
      const p = (r.panR - r.panL) / (r.panR + r.panL + 1e-9), d = Math.round(Math.abs(p) * 0.0006 * this.fs);
      return p > 0 ? [d, 0] : [0, d]; // (atrasa o ouvido do lado de lá)
    });
    this.jetF = rads.map(() => [new Biquad().bp(this.fs, 450, 0.5), new Biquad().bp(this.fs, 1400, 0.6)]);
    this.jetEnv = rads.map(() => 0);
    // ponteira: só a saída, por onde o gás sopra; fina, o mesmo pulso sai mais rápido (o resto do escape segue o tubo)
    const td = clamp((cfg.tipD || cfg.pipeD || 2.5) / 2.5, 0.5, 1.6); this.tipA = td * td;
  }

  buildFilters(cfg) {
    const fs = this.fs;
    const intake = cfg.intake;
    if (intake === 'itb') {
      // o pulso da válvula percorre a corneta e se espalha; o que sai pela boca é
      // grave e encorpado. Sem esse corte o pulso derivado vira um "zzzz" metálico.
      this.inF = [new Biquad().hp(fs, 60), new Biquad().peak(fs, 600, 0.8, 3), new Biquad().lp(fs, 1400, 0.7), new Biquad().lp(fs, 3000, 0.6)];
      this.inGain = 1.6; this.hissF = new Biquad().bp(fs, 2400, 0.7); this.hissGain = 0.45;
    } else if (intake === 'sport') {
      this.inF = [new Biquad().hp(fs, 45), new Biquad().peak(fs, 280, 1.2, 6), new Biquad().lp(fs, 1300, 0.7), new Biquad().lp(fs, 2400, 0.6)];
      this.inGain = 1.1; this.hissF = new Biquad().bp(fs, 1700, 0.7); this.hissGain = 0.3;
    } else {
      this.inF = [new Biquad().hp(fs, 35), new Biquad().peak(fs, 160, 2.0, 8), new Biquad().lp(fs, 1000, 0.7)];
      this.inGain = 0.8; this.hissF = new Biquad().bp(fs, 1200, 0.8); this.hissGain = 0.2;
    }
    this.clickF = [new Biquad().bp(fs, 2600, 2.5), new Biquad().bp(fs, 5200, 3)];
    // irradiação do coletor: ruído largo caindo ~4 dB/oitava de 1 a 8 kHz e mais rápido acima (medido num Fusca)
    this.brkF = [new Biquad().hp(fs, 700, 0.7), new Biquad().lp(fs, 10000, 0.7)]; this.brkLP = 0; this.brkE = 0; this.cabBrk = new Biquad().lp(fs, 900, 0.7);
    this.brkKa = 1 - Math.exp(-1 / (0.003 * fs)); this.brkKd = 1 - Math.exp(-1 / (0.01 * fs)); this.brkKl = onePole(fs, 2500); this.brkKs = 1 - Math.exp(-1 / (0.1 * fs)); this.brkS = 0;
    this.knockF = [new Biquad().bp(fs, 900, 3), new Biquad().bp(fs, 2100, 4), new Biquad().bp(fs, 4200, 5)];
    this.mechHP = new Biquad().hp(fs, 80);
    this.saF = new Biquad().bp(fs, 2600, 0.8);
    this.fanF = new Biquad().lp(fs, 900, 0.6);
    this.vibLP = new Biquad().lp(fs, 200, 0.7);
    this.starterLP = new Biquad().lp(fs, 2200, 0.8);
    this.turboHiss = new Biquad().bp(fs, 4800, 0.9);
    this.scHiss = new Biquad().bp(fs, 2500, 0.8);
    this.bovF = [new Biquad().bp(fs, 2300, 0.9), new Biquad().bp(fs, 5400, 1.3)];
    // cabine: a carroceria isola o médio e o agudo (lei da massa) e o habitáculo ressoa no grave
    this.cabL = [new Biquad().lp(fs, 420, 0.7), new Biquad().lp(fs, 1100, 0.6), new Biquad().peak(fs, 70, 1.1, 7)];
    this.cabR = [new Biquad().lp(fs, 420, 0.7), new Biquad().lp(fs, 1100, 0.6), new Biquad().peak(fs, 70, 1.1, 7)];
    this.cabIn = new Biquad().lp(fs, 900, 0.7);
    this.cabMech = new Biquad().lp(fs, 1200, 0.7);
    this.extMech = new Biquad().lp(fs, 3000, 0.7); // de fora, atrás do carro, a carroceria sombreia o agudo da mecânica
    this.bayEx = new Biquad().lp(fs, 900, 0.7);
    this.inPrev = 0;
    this.clickEnv = 0; this.knockEnv = 0;
  }

  // Vazão de escape resolvida implicitamente contra a pressão do tubo primário.
  exhaustFlow(A, pc, Tc, pb, Z) {
    if (pb < 2000) pb = 2000;
    // refluxo pela válvula tem coeficiente de descarga bem menor que o fluxo direto
    if (pb > pc) A *= this.revCd;
    const F0 = flow(A, pc, Tc, pb, T_BACK);
    let lo, hi, glo, ghi;
    if (F0 >= 0) { lo = 0; glo = F0; hi = F0; ghi = flow(A, pc, Tc, pb + Z * F0, T_BACK) - F0; }
    else { hi = 0; ghi = F0; lo = F0; glo = flow(A, pc, Tc, Math.max(2000, pb + Z * F0), T_BACK) - F0; }
    if (glo - ghi < 1e-12) return F0;
    let side = 0, m = lo;
    for (let k = 0; k < this.solverIt; k++) {
      m = (lo * ghi - hi * glo) / (ghi - glo);
      const g = flow(A, pc, Tc, Math.max(2000, pb + Z * m), T_BACK) - m;
      if (g > 0) { lo = m; glo = g; if (side === 1) ghi *= 0.5; side = 1; }
      else { hi = m; ghi = g; if (side === -1) glo *= 0.5; side = -1; }
    }
    return m;
  }

  // Atualizações de controle (taxa reduzida).
  control(dtc) {
    const rpm = this.rpmAvg;
    const user = this.thrTarget;
    // mapa da desaceleração: tirando o pé depois de carga, o crepitar de fábrica dura um ou dois segundos e o
    // pop & bang de remap bem mais; a janela é da central, os estouros em si dependem do escape quente
    if (this.prevThrUser > 0.35 && user < 0.1 && rpm > this.redline * 0.35) this.popWindow = this.popDur = { burble: 1.8, popbang: 4 }[this.overrun] || 0;
    this.popWindow = Math.max(0, this.popWindow - dtc);
    this.prevThrUser = user;
    // antilag (rali): pé fora com giro acima de ~1/3 da faixa, a central abre um desvio de ar, atrasa a
    // ignição e queima a mistura no coletor: estouros secos e a turbina não para de girar
    // (arma só depois de o piloto pisar: a arrancada de giro da partida não conta)
    const alsRpm = Math.max(this.idle * 2, this.redline * 0.3);
    if (user > 0.35) this.alsArm = true; else if (rpm < alsRpm || this.state !== 'run') this.alsArm = false;
    this.als = this.overrun === 'antilag' && this.turbo && this.state === 'run' && !!this.alsArm && user < 0.1 && rpm > alsRpm;
    // temperatura da parede do coletor (é ela, em brasa, que acende a mistura): segue o gás (lenta ~320 °C, carga
    // total ~850 °C) com a inércia do ferro, aquecendo em ~4 s e esfriando em ~20 s. Ciclo cortado só bombeia ar
    // e esfria o escape, a não ser que leve combustível que queima lá dentro
    const tBurn = Math.min(950, 180 + 720 * Math.sqrt(clamp(rpm / this.redline, 0, 1.1)) * Math.pow(clamp(this.pMan / P0, 0, 1.6), 0.6));
    const tWant = this.state === 'run' ? this.ambientT + (tBurn - this.ambientT) * this.burnHeat : this.ambientT;
    this.exhT += (tWant - this.exhT) * (1 - Math.exp(-dtc / (tWant > this.exhT ? 4 : 20)));

    this.runT = this.state === 'run' ? (this.runT || 0) + dtc : 0;
    // escala de torque até a potência da ficha técnica: só sobre o torque dos gases (o atrito é o que é) e só
    // acima da lenta, para o controle de marcha lenta continuar com o ganho com que foi acertado
    this.tqS = this.tqScale === 1 ? 1 : 1 + (this.tqScale - 1) * smooth(this.idle * 1.5, this.idle * 3, rpm);
    // ---- temperatura do motor
    if (this.tempMode === 'fixed') this.coolant = this.tempSet;
    else {
      // calor que vai para a água cresce com giro e carga; a carcaça perde um pouco para o ar;
      // a válvula termostática abre perto de 90 °C e manda a água para o radiador
      const load = this.state === 'run' ? Math.sqrt(Math.max(0.2, (rpm * clamp(this.pMan / P0, 0.15, 2.5)) / 240)) : 0;
      let dT = 0.135 * load - 0.0008 * (this.coolant - this.ambientT);
      const air = 0.35 + clamp(this.v / 25, 0, 1.5) + (this.fanOn ? 1.2 : 0);
      dT -= smooth(86, 95, this.coolant) * 0.06 * (this.coolant - 80) * air;
      this.coolant += dT * dtc;
    }
    // ventoinha do radiador liga perto de 100 °C e desliga uns graus abaixo
    if (this.coolant > 99 && this.state === 'run' && !this.airCool) this.fanOn = true; else if (this.coolant < 93 || this.state === 'off') this.fanOn = false;
    this.fanSpin += ((this.fanOn ? 1 : 0) - this.fanSpin) * (1 - Math.exp(-dtc / (this.fanOn ? 1.5 : 4)));
    this.warm = smooth(15, 80, this.coolant);
    const cold = 1 - this.warm;
    // partida a frio: a central atrasa a ignição para esquentar o catalisador (ronco mais
    // rasgado) e liga a bomba de ar secundário por um minuto ou dois
    // (a centelha cai ~10° depois do ponto morto: a queima termina tarde, o gás sai quente e com pressão, e cada
    // abertura do escape estala; sem catalisador não há o que esquentar nem bomba de ar)
    const hasCat = this.hasCat;
    this.catRetard = this.state === 'run' && hasCat ? 25 * (1 - smooth(30, 60, this.coolant)) * (1 - smooth(45, 80, this.runT)) * (user < 0.3 ? 1 : 0.4) : 0;
    const saWant = hasCat && this.state === 'run' && this.coolant < 45 && this.runT < 100 ? 1 : 0;
    this.secAir += (saWant - this.secAir) * (1 - Math.exp(-dtc / (saWant ? 0.8 : 1.5)));

    // controle de marcha lenta como numa ECU: válvula de ar (lenta) + avanço (rápido)
    if (this.state === 'run' || this.state === 'crank') {
      // motor frio: marcha lenta acelerada, e uma arrancada de giro logo depois de pegar
      const flare = this.state === 'run' && this.runT < 3 ? Math.exp(-this.runT / 1.2) * (200 + 450 * cold) : 0;
      // frio: lenta acelerada de verdade (uns 1,8× logo depois de pegar), que a central vai baixando com o tempo
      // de funcionamento mesmo antes de a água esquentar; limitada em rpm absolutos para motores de corrida
      const coldAdd = cold * Math.min(0.8 * this.idle, 650) * (0.55 + 0.45 * Math.exp(-(this.runT || 0) / 50));
      this.idleTarget = this.idle + coldAdd + flare;
      const e = (this.idleTarget - rpm) / this.idleTarget;
      const active = user < 0.05 && !(this.shifting && this.blip);
      const de = (e - this.ePrev) / dtc; this.ePrev = e;
      // integra também para baixo quando o giro está parado acima do alvo (ex.: o motor esquentou
      // e a lenta acelerada acabou); só não integra enquanto o giro está despencando de uma acelerada
      // (bem devagar: puxar com força aqui fazia o controle exagerar e entrar num vai-e-vem que apagava o motor)
      if (active && (e > -0.15 || this.runT < 4)) this.iacI = clamp(this.iacI + clamp(e, -0.3, 0.3) * dtc * this.KI, 0, 0.05);
      else if (active && de < 0.08) this.iacI = clamp(this.iacI - 0.15 * dtc * this.KI * this.iacTrim, 0, 0.05);
      // resgate contra apagamento: só age quando a rotação cai abaixo da lenta
      const rescue = active && e > 0.15 ? e - 0.15 : 0;
      // "dashpot": mantém ar extra na desaceleração para o coletor não chegar vazio na lenta
      if (user > 0.08) this.dash = 0.006 * Math.min(1, user * 2);
      else this.dash *= Math.exp(-dtc / 1.5);
      const dash = this.dash;
      // (o termo derivativo só age com o giro caindo e já perto da lenta: é o "pouso" suave do giro)
      const catchAir = active && de > 0 && e > -0.9 ? this.KD * clamp(de, 0, 3) : 0;
      this.iac = clamp(this.iacI + (active ? Math.max(this.KP * e, -0.5 * this.iacI) : 0) + catchAir + rescue * this.RG + dash, 0, 0.1);
      this.advTrim = active && e > -0.3 ? clamp(this.KA * e + this.KAD * de + rescue * 60, -8, 16) : 0;
      if (this.state === 'crank') this.iac = Math.max(this.iac, 0.02);
    } else { this.advTrim = 0; }

    let want = user;
    if (this.shifting && this.blip) want = rpm < this.vehOmega() * 9.55 * 1.02 ? 0.85 : 0;
    if (this.shifting && this.shiftCut && !this.ignCut) want = 0;
    // câmbio automático corta torque na subida de marcha (sem isso o motor dispara no meio da troca)
    // automático com o pé pela metade: reduz torque atrasando a ignição, borboleta aberta
    // (e nas trocas rápidas, durante o escorregamento da embreagem, um pouco de atraso alisa a descida do giro)
    this.shiftRetard = this.shiftUp && this.gear > 1 && this.ignCut && (this.shifting || (!this.locked && this.sinceShift < 0.8)) && !(this.shifting && this.shiftCut);
    this.sinceShift = (this.sinceShift || 0) + dtc;
    // 2-step: parado e de pé embaixo
    // como no carro de verdade: só segura com a embreagem pisada (ponto morto) ou o freio apertado
    this.launching = this.twoStep && this.state === 'run' && this.v < 1 && user > 0.6 && (this.gear === 0 || this.brake > 0.5);
    if (this.launching && this.twoStepMode === 'soft') {
      // controle de largada: a ECU fecha a borboleta o quanto precisa para o giro ficar
      // parado na rotação escolhida — sem cortar ignição, sem estouro
      const e = (this.launchRpm - rpm) / this.launchRpm;
      const de = ((rpm - (this.lcPrev ?? rpm)) / dtc) / this.launchRpm; // subida relativa por segundo
      this.lcPrev = rpm;
      if (Math.abs(e) < 0.15) this.lcI = clamp(this.lcI + e * dtc * 4, -0.2, 0.7);
      want = Math.min(want, clamp(this.lcI + 1.6 * e - 0.09 * de, 0, 1));
      // borboleta já fechada e o giro ainda alto (motor de borboletas individuais solto):
      // atrasa a ignição, como as centrais de largada fazem
      this.dash = 0;
      if (e < 0) { this.advTrim = clamp(160 * e, -35, 0); this.iac = Math.min(this.iac, 0.004); }
    } else { this.lcI = 0.12; this.lcPrev = undefined; }
    // corte por borboleta (central eletrônica): fecha o acelerador chegando no limite, liso
    // (olha a velocidade com que o giro sobe para frear antes de chegar, sem passar do limite)
    const rpmRate = (rpm - (this.limPrev ?? rpm)) / dtc; this.limPrev = rpm;
    if (this.limType === 'throttle' && !this.launching) {
      // mesmo controlador do controle de largada (PI + amortecimento pela subida do giro),
      // mirando um pouco abaixo da faixa vermelha
      const tb = Math.max(this.limBand, 250), target = this.redline - 40;
      if (rpm > target - tb) {
        const e = (target - rpm) / target, de = rpmRate / target;
        if (this.limI === undefined) this.limI = Math.min(1, want);
        // ganhos altos: em giro alto a borboleta só tira ar de verdade quando está quase fechada
        if (Math.abs(e) < 0.08) this.limI = clamp(this.limI + e * dtc * 40, -0.3, 1);
        want = Math.min(want, clamp(this.limI + 12 * e - 0.25 * de, 0, 1));
        // a borboleta é lenta (o coletor demora a esvaziar): o atraso de ignição tira torque na hora
        const ahead = rpm + 0.08 * Math.max(0, rpmRate);
        this.limRetard = clamp((ahead - (target - 0.25 * tb)) / (0.3 * tb) * 30, 0, 32);
        // (o ar extra da marcha lenta e do dashpot também é cortado, senão sustenta o giro sozinho)
        if (this.limRetard > 0) { this.dash = 0; this.iac = Math.min(this.iac, 0.003); }
      } else { this.limI = undefined; this.limRetard = 0; }
    } else this.limRetard = 0;
    this.thr += (want - this.thr) * (1 - Math.exp(-dtc / 0.03));

    // turbo
    if (this.turbo) {
      const flowN = (rpm / this.redline) * (0.15 + 0.85 * clamp(this.pMan / P0, 0, 1.5)) * (this.state === 'run' ? 1 : 0.2);
      const target = this.als ? Math.max(0.85, clamp(flowN * 1.35, 0, 1)) : clamp(flowN * 1.35, 0, 1);
      const tau = target > this.turboW ? 0.55 : 1.2;
      this.turboW += (target - this.turboW) * (1 - Math.exp(-dtc / tau));
      const avail = this.maxBoost * Math.pow(smooth(0.25, 0.85, this.turboW), 1.3);
      const boostWant = avail * smooth(0.35, 0.9, this.thr);
      const prev = this.boost;
      this.boost += (boostWant - this.boost) * (1 - Math.exp(-dtc / (boostWant > this.boost ? 0.12 : 0.05)));
      if (prev > 0.35 && this.thr < 0.25 && user < 0.2 && this.bovEnv < 0.2 && !this.als) { this.bovAmp = prev / Math.max(0.3, this.maxBoost); this.bovEnv = 1; }
    } else if (this.blower) {
      // compressor de deslocamento positivo: a pressão vem na hora, proporcional ao giro;
      // sem acelerar, a válvula de alívio abre e ele só gira em vazio
      const boostWant = this.maxBoost * Math.pow(clamp(rpm / (this.redline * 0.5), 0, 1), 0.6) * smooth(0.2, 0.9, this.thr);
      this.boost += (boostWant - this.boost) * (1 - Math.exp(-dtc / 0.05));
    } else this.boost = 0;
    this.bovEnv *= Math.exp(-dtc / 0.22);

    // 2-step com corte: a ECU segura o giro cortando a ignição (alguns estouros no escape)
    const lt = this.limType;
    if (this.launching && this.twoStepMode === 'cut') {
      if (this.rpmAvg > this.launchRpm) this.limiter = true;
      else if (this.rpmAvg < this.launchRpm - 260) this.limiter = false;
    } else if (lt === 'partial') {
      // corte parcial: corta uma fração das explosões, crescendo com o quanto passou do limite
      const start = this.redline - this.limBand * 0.5;
      this.limFrac = clamp((this.rpmAvg - start) / (this.limBand * 0.6), 0, 1);
      this.limiter = this.limFrac > 0;
    } else if (lt === 'ign' || lt === 'fuel') {
      // corte total com histerese e tempo mínimo: o giro bate no limite e volta
      if (!this.limiter && this.rpmAvg > this.redline) { this.limiter = true; this.limT = 0; }
      else if (this.limiter) {
        this.limT = (this.limT || 0) + dtc; // (pode ter sido ligado pelo 2-step, que não zera limT)
        if (this.limT >= this.limHold && this.rpmAvg < this.redline - this.limBand) this.limiter = false;
      }
    } else if (lt === 'throttle') {
      // a borboleta já segura; corta combustível só de segurança se passar muito
      if (this.rpmAvg > this.redline + 200) this.limiter = true; else if (this.rpmAvg < this.redline) this.limiter = false;
    } else this.limiter = false; // sem corte: as válvulas flutuam (ver combustão)

    // válvula do abafador (atuador leva ~0,15 s); no automático abre com carga ou giro alto
    if (this.valveMode === 'auto') {
      if (user > 0.55 && rpm > this.idle * 1.6 || rpm > this.redline * 0.62) this.valveAuto = true;
      else if (user < 0.3 && rpm < this.redline * 0.5) this.valveAuto = false;
    } else if (this.valveMode === 'sport') {
      // modo esportivo dos escapes ativos: aberta em lenta e assim que se pisa; fecha só rodando leve em giro
      // baixo, para não zunir na estrada
      const cruise = this.gear > 0 && this.v > 5 && user > 0.03 && user < 0.15 && rpm < this.redline * 0.4; // (rodando: parado ou em ponto morto fica aberta)
      this.valveAuto = !cruise;
    }
    const vt = this.valveMode === 'open' || ((this.valveMode === 'auto' || this.valveMode === 'sport') && this.valveAuto) ? 1 : 0;
    this.valveState.v += (vt - this.valveState.v) * (1 - Math.exp(-dtc / 0.15));


    if (this.state === 'crank') {
      this.crankT += dtc;
      if (this.crankT > 0.45 && rpm > Math.min(this.idle * 0.7, 550)) this.state = 'run';
      if (this.crankT > 5) this.state = 'off';
    }
    if (this.state === 'run' && rpm < 150 && this.omega < 15) this.state = 'off';

    // câmbio
    if (this.shifting) {
      this.shiftT -= dtc;
      if (this.shiftT <= 0) { this.shifting = false; this.shiftCut = false; this.blip = false; }
    } else this.clutch = Math.min(1, this.clutch + dtc / Math.max(this.shiftUp && this.gear > 1 ? 0.2 : 0.02, 0.5 * this.shiftTime));
    this.shiftCool -= dtc;
    this.denied = Math.max(0, (this.denied || 0) - dtc);
    if (this.auto && this.gear > 0 && !this.shifting && this.shiftCool <= 0) {
      const n = this.ratios.length - 1;
      const t = clamp(user, 0, 1);
      // sem acelerar o câmbio segura a marcha (freio-motor); só sobe para não estourar o giro
      // modo do câmbio: pista/esportivo/normal/econômico trocam em rotações fixas;
      // automático decide pelo quanto o acelerador está pisado
      const Rl = this.redline, I = this.idle, mode = this.driveMode;
      const FIXED = {
        track: [0.97 * Rl, 0.7 * Rl],
        sport: [0.85 * Rl, 0.5 * Rl],
        normal: [clamp(I * 3.6, 0.38 * Rl, 0.6 * Rl), I * 1.9],
        eco: [clamp(I * 2.6, 0.25 * Rl, 0.45 * Rl), I * 1.4],
      }[mode];
      const sp = 0.5, base = this.idle * (1.4 + 1.2 * sp);
      let up = FIXED ? FIXED[0] : base + (this.redline * 0.94 - base) * Math.pow(t, 2.2 - 1.8 * sp);
      if (t < 0.05) up = Math.max(up, this.redline * 0.94); // sem acelerar segura a marcha (freio-motor)
      // reduz desacelerando (antes de o giro cair na lenta) e no kickdown
      const down = FIXED ? FIXED[1] : this.idle * (1.3 + 0.8 * sp) + this.redline * 0.42 * t * t;
      if (this.v < 0.6 && this.gear > 1) {
        // parado: volta direto para a 1ª, pronto para sair
        this.gear = 1; this.shifting = true; this.shiftT = 0.15; this.clutch = 0; this.shiftCut = false; this.blip = false; this.shiftCool = 0.4;
      } else if (this.locked && rpm > up && this.gear < n) this.requestShift(1);
      else if (rpm < down && this.gear > 1) {
        const nextRpm = rpm * this.ratios[this.gear - 1] / this.ratios[this.gear];
        if (nextRpm < this.redline * 0.9 && (!FIXED || nextRpm < up * 0.92)) this.requestShift(-1);
      }
    }
  }

  vehOmega() { return this.gear ? (this.v / this.rw) * this.ratios[this.gear] * this.final : 0; }

  process(outL, outR, n, sendL?, sendR?) {
    if (!this.cfg) { outL.fill(0); if (outR !== outL) outR.fill(0); if (sendL) { sendL.fill(0); sendR.fill(0); } return; }
    const fs = this.fs, dt = this.dt, N = this.N, rng = this.rng;
    const fire = this.fire, aPrev = this.aPrev, pc_ = this.p, m_ = this.m;
    const P = this.params;
    const targetE = P.listener === 'ext' ? 1 : 0, targetI = P.listener === 'int' ? 1 : 0, targetB = P.listener === 'bay' ? 1 : 0;
    const targetP = P.listener === 'pipe' ? 1 : 0, targetR = P.listener === 'road' ? 1 : 0;
    if (this.ambEnv !== P.env) this.setAmbience(P.env);
    const loop = ENV_LOOP[P.env] || 800;
    const kw = 1 - Math.exp(-dt / 0.15);
    const evo = this.evo, evc = this.evc, ivo = this.ivo, ivc = this.ivc;
    const lines = this.lines, nodes = this.nodes, runners = this.runners, rads = this.rads;
    const nL = lines.length, nN = nodes.length, nR = rads.length;
    const r = this.rCrank, l = this.lRod, Ap = this.Ap, Vc = this.Vc, Zr = this.Zr, hw = this.hw;
    const g1 = GAM - 1;

    for (let s = 0; s < n; s++) {
      if (this.ctrl-- <= 0) { this.control(16 * dt); this.ctrl = 15; }
      const omega = this.omega;
      const rpm = omega * 9.549296585513721;
      this.rpmAvg += (rpm - this.rpmAvg) * Math.min(1, dt * Math.max(4, rpm / 60));
      const rpmFrac = rpm / this.redline;
      const running = this.state === 'run';
      const cranking = this.state === 'crank' && this.crankT > 0.25 && this.rpmAvg > 60;
      // corte de combustível na desaceleração: entra bem acima da lenta, sai a ~1,4× o alvo (histerese) e o
      // combustível volta em rampa, como numa central real; sem isso a combustão voltava de uma vez
      // com o giro ainda despencando, e o motor batia na lenta e quicava
      // (carburador não corta: o circuito de lenta segue mandando mistura e o motor continua queimando, mal, na
      // desaceleração; cortar e religar a ~1200 rpm fazia o som sumir e voltar de repente)
      const dfcoWant = running && this.thr < 0.02 && !this.shifting && !(this.launching && this.twoStepMode === 'soft') && this.fuelVar === 1;
      const it = this.idleTarget || this.idle;
      if (dfcoWant && this.rpmAvg > Math.max(it + 900, it * 1.9)) this.dfcoOn = true;
      else if (!dfcoWant || this.rpmAvg < Math.max(it + 350, it * 1.4)) this.dfcoOn = false;
      const dfco = !!this.dfcoOn;
      this.fuelRamp = dfco ? 0 : Math.min(1, (this.fuelRamp ?? 1) + dt / 0.4);
      const cut = this.limiter || (this.shifting && this.shiftCut);
      const deg = (omega * dt) / DEG;
      const rf = clamp(rpmFrac, 0, 1.1);
      const adv = Math.max(-20, 10 + 24 * rf + this.advTrim - (this.shiftRetard ? 26 : 0) - this.catRetard - (this.limRetard || 0));
      const aSp = 720 - adv;
      // com o coletor em vácuo, o gás queimado que sobra no cilindro dilui a mistura e a chama anda devagar: em lenta
      // a queima (10–90%) leva ~45–50°, contra ~20° em carga. Rápida demais, o motor ficava eficiente demais em carga
      // leve, pedia pouco ar e chegava à abertura do escape sem pressão (sem o estalo do jato em cada cilindro)
      const slowB = 1 + 1.4 * clamp((0.6 - this.pMan / P0) / 0.4, 0, 1);
      const burn = (42 + 26 * rf) * slowB;
      // (o gás rarefeito do vácuo troca menos calor com a parede, como na correlação de Woschni: em lenta a perda fica
      // em ~20–25% do calor da queima, como num motor real, e em carga não muda)
      const hwr = hw * Math.max(0.06, rpm / 3000) * Math.min(1, Math.pow(this.pMan / P0, 0.4));

      // ---- coletor de admissão (borboleta + soma das válvulas)
      const pUp = P0 * (1 + this.boost);
      const thrA = this.cc ? this.Athr : this.Athr * (1 - Math.cos(this.thr * Math.PI / 2) + this.iac + 0.00005); // (diesel: sem borboleta)
      const mThr = flow(thrA, pUp, T_MAN, this.pMan, T_MAN);
      const pMan = this.pMan;

      for (let i = 0; i < nL; i++) lines[i].read();

      const wn = rng.bi();
      this.tzLP += this.tzK * (wn - this.tzLP);
      const hiN = (wn - this.tzLP) * 1.4;
      let Tgas = 0, mInSum = 0, vib = 0, intake = 0, brkIn = 0;
      for (let c = 0; c < N; c++) {
        let a = this.theta - fire[c]; if (a < 0) a += 720;
        if (this.cc && a >= this.ciclo) a -= this.ciclo; // (2 tempos: ciclo de 360°)
        const ap = aPrev[c];
        // ---- centelha (diesel: injeção e atraso de ignição no DieselDSP; o ramo a gasolina segue sem reindentar)
        if (this.cc) this.ccInjecao(c, a, ap, running, cranking, cut, rpm);
        else {
        // a centelha é armada no curso de admissão e dispara uma única vez por ciclo,
        // mesmo que o avanço mude de repente (com atraso grande, depois do ponto morto superior)
        if (a >= 360 && a < 540) this.armed[c] = 1;
        if (this.armed[c] && (aSp < 720 ? a >= aSp || a < 180 : a >= aSp - 720 && a < 180)) {
          this.armed[c] = 0;
          this.spk[c] = a;
          let cutNow = cut;
          if (this.limiter && this.limType === 'partial' && !this.launching) {
            // rodízio irregular: acumula a fração de corte (com sorteio, para não virar um padrão
            // periódico que soa como um zumbido parado) e corta a explosão quando passa de 1
            cutNow = this.shifting && this.shiftCut;
            this.lacc = (this.lacc || 0) + this.limFrac * (0.4 + 1.2 * rng.next());
            if (this.lacc >= 1) { this.lacc -= 1; cutNow = true; }
          }
          const combust = (running || cranking) && !cutNow && !dfco;
          const idleness = clamp(1 - (this.rpmAvg - this.idle) / 1500, 0, 1);
          // frio: a mistura vaporiza mal e cada explosão sai um pouco diferente
          const sigma = (0.025 + idleness * (0.015 + 0.06 * this.cam * this.cam)) * (1 + 0.9 * (1 - this.warm));
          // sem limitador (motor antigo): passando da faixa vermelha as válvulas flutuam,
          // a mistura não entra direito e o motor falha e perde força
          const float = this.limType === 'none' ? clamp((this.rpmAvg - this.redline) / (0.12 * this.redline), 0, 1) : 0;
          // (carburador em lenta: de vez em quando uma mistura não acende, a "tossida" do motor velho, ~1% das explosões)
          // (e na desaceleração, com o vácuo alto, a mistura rala falha muito mais: até ~15% das explosões)
          const misfire = rng.next() < this.cam * this.cam * 0.02 * idleness + 0.5 * float + (this.fuelVar > 1 ? (this.carbMis * idleness + 0.15 * clamp((0.3 - this.pMan / P0) / 0.15, 0, 1)) * this.varScale : 0);
          if (combust && !misfire) {
            this.burnHeat += (1 - this.burnHeat) * 0.05;
            // carburador em carga leve: com a borboleta quase fechada a mistura chega mal vaporizada e mal dividida
            // entre os cilindros, e cada explosão sai diferente (na força e no ritmo da queima). Com o pé embaixo o
            // fluxo forte homogeneíza e o motor assenta; em lenta e meio pé volta o "galope" (num Fusca real, 16% de
            // variação entre explosões a 1400 rpm em neutro e ~33% a 2000 rpm instável). Em carga leve o pulso do escape
            // sai da pressão no fim da queima, que já amplifica bastante uma variação pequena da mistura
            const light = this.fuelVar > 1 ? clamp((0.8 - this.pMan / P0) / 0.5, 0, 1) * this.varScale : 0;
            this.Q[c] = Math.max(0, this.air[c]) * 2.6e6 * this.cylQ[c] * (1 - 0.7 * float) * (0.45 + 0.55 * this.fuelRamp) * clamp(1 + (sigma * this.varScale * this.fuelVar + this.carbVar * light) * rng.gauss(), 0.25, 1.6);
            // (mistura pobre queima devagar e chega mais quente no escape; a variação é em graus, então não cresce
            // com a queima mais lenta do vácuo)
            this.burnK[c] = light ? 1 + 0.1 * light * clamp(rng.gauss(), -1.5, 2) / slowB : 1;
            this.xb[c] = 0;
            this.knockEnv += 0.6 + 0.4 * rng.next();
          } else {
            this.Q[c] = 0; this.xb[c] = 1;
            // estouro no escape: a mistura que não queimou no cilindro chega ao coletor quente e explode lá. Precisa
            // de combustível (ignição cortada ou falha; corte de injeção só bombeia ar) e de escape quente (~600 °C).
            // Cada fonte tem uma taxa típica (estouros por segundo, escape quente e sem catalisador) e um tamanho;
            // o estouro cresce com a carga do cilindro, e o catalisador queima boa parte do combustível sem barulho
            let rate = 0, k = 0, pr = 0, wet = true, floor = 0.15, lit = false;
            if (running && this.rpmAvg > this.idle * 1.4) {
              const ov = this.overrun;
              if (combust) { pr = 0.015; k = 0.7; } // falha de ignição (válvulas flutuando, comando bravo): mistura inteira, mas quase nunca acende
              else if (this.launching && this.limiter) { rate = 20; k = 0.8; } // 2-step com corte
              else if (this.limiter) [rate, k, wet] = { ign: [25, 0.7, true], partial: [8, 0.6, true] }[this.limType] || [0.5, 0.3, false]; // (corte de injeção: só o filme de combustível do coletor)
              else if (this.shifting && this.shiftCut) [rate, k] = this.ignCut ? [40, 0.8] : [5, 0.5];
              else if (dfco) {
                if (this.als) { rate = 22; k = 1.1; floor = 0.6; lit = true; }
                else if (ov === 'lean') { rate = 1; k = 0.5; } // carburador: a mistura da desaceleração é rica e raramente acende (o pipoco frequente é vazamento no escape)
                // (os mapas de estouro abrem um pouco a borboleta e enriquecem: a carga não é a da lenta)
                else if (ov === 'burble' && this.popWindow > 0) { rate = 16 * Math.sqrt(this.popWindow / this.popDur); k = 0.8; floor = 0.35; lit = true; }
                else if (ov === 'popbang' && this.popWindow > 0) { rate = 20 * Math.min(1, this.popWindow); k = 1.2; floor = 0.5; lit = true; }
              }
            }
            if (rate) pr = Math.min(0.9, rate / (N * Math.max(rpm, 300) / 120));
            this.burnHeat += ((wet && (pr || rate) ? 0.5 : 0) - this.burnHeat) * 0.05;
            // (nos mapas de estouro a ignição atrasada manda a chama acesa para o escape: não precisa da parede em
            // brasa. A mistura crua do corte de ignição, do carburador ou de uma falha só acende no escape quente)
            const hot = lit ? 0.7 + 0.3 * smooth(280, 520, this.exhT) : smooth(280, 520, this.exhT);
            if (pr && rng.next() < pr * hot * (this.hasCat ? 0.6 : 1) && this.pops.length < 10) {
              const size = Math.pow(clamp(this.air[c] / (this.Vd * 1.2), floor, 1.3), 0.7);
              const delay = ((evo + adv + 30) / Math.max(600, rpm * 6)) * fs + rng.next() * 0.006 * fs;
              this.pops.push({ d: delay | 0, t: 0, bank: this.cfg.bank[c], amp: 8e4 * k * size * (0.6 + 0.6 * rng.next()) * (this.hasCat ? 0.7 : 1) * (0.6 + 0.4 * hot) });
            }
          }
        }
        }
        // ---- válvulas (cliques do trem de válvulas)
        if (this.cc) this.ccValvulas(c, a, ap);
        else {
        if ((ap < evo && a >= evo) || (ap < evc && a >= evc) || (ap < ivo && a >= ivo) || (ap < ivc && a >= ivc)) this.clickEnv += 0.5 + 0.5 * rng.next();
        if (ap < ivo && a >= ivo) this.air[c] = 0;
        }
        aPrev[c] = a;

        // ---- volume
        const th = a * DEG, sn = Math.sin(th), cs = Math.cos(th);
        const q = Math.sqrt(l * l - r * r * sn * sn);
        const V = Vc + Ap * (r * (1 - cs) + l - q);
        const dxdth = r * sn * (1 + (r * cs) / q);
        const dV = V - this.Vprev[c];
        this.Vprev[c] = V;

        let p = pc_[c], m = m_[c];
        const T = clamp((p * V) / (m * RGAS), 220, 3200);

        // ---- combustão (Wiebe)
        let dQ = 0;
        if (this.cc) dQ = this.ccQueima(c, a, p, V, deg);
        else if (this.xb[c] < 1) {
          let d = a - this.spk[c]; if (d < -360) d += 720;
          if (d < 0) d = 0;
          const u = d / (burn * this.burnK[c]);
          const x = u >= 1 || d > 360 ? 1 : 1 - Math.exp(-5 * u * u * u);
          dQ = this.Q[c] * (x - this.xb[c]);
          this.xb[c] = x;
        }
        if (this.cc) dQ -= hwr * (T - this.tParede) * dt; // (diesel: a parede segue a água)
        else dQ -= hwr * (T - T_WALL) * dt;

        // ---- válvula de escape -> tubo primário
        let mEx = 0;
        const run = runners[c];
        if (this.cc) mEx = this.ccEscape(c, a, p, T, run, Zr);
        else if (a > evo && a < evc) {
          const sv = Math.sin(Math.PI * (a - evo) / (evc - evo));
          const A = this.AexMax * this.cylEx[c] * Math.min(1, 2.5 * sv * sv); // (área efetiva satura cedo: perfil "quadrado")
          mEx = this.exhaustFlow(A, p, T, P0 + 2 * run.in0, Zr);
        }
        // turbulência no vão da válvula: o jato que sai pelo vão no "estouro" da abertura. A velocidade dele vem da
        // razão entre a pressão no cilindro e a do tubo (Mach do escoamento isentrópico, que satura no engasgo), e o
        // chiado cresce com ela sem limiar, como num jato (pressão ∝ vazão·Mach³, potência ∝ U⁸). Com o cilindro
        // esvaziado o Mach cai e o resto do curso é manso; chiado ligado o tempo todo vira um som de vento contínuo.
        // O jato engasgado chia em alta frequência (rasgado); grave e médio continuam tonais.
        // É o "rasgado" metálico, uma rajada colada a cada abertura (na lenta fria, o estalo de cada cilindro); a
        // colmeia do catalisador, com milhares de canais finos, come um pouco desse agudo antes do abafador
        let turb = 0;
        if (mEx > 0) {
          const pr = p / (P0 + 2 * run.in0), Mj = pr > 1 ? Math.min(1, Math.sqrt(2 / (GAM - 1) * (Math.pow(pr, (GAM - 1) / GAM) - 1))) : 0;
          turb = this.valveNoise * this.catNoise * P.air * Mj * Mj * Mj;
        }
        // a pressão no tubo é impedância × vazão volumétrica, não mássica: o gás de um cilindro cortado
        // (ignição/combustível cortado, ~350 K) é 4× mais denso que o queimado (~1500 K) e empurra bem menos
        // pela mesma massa. Sem isso o corte de giro soava 8 dB mais alto que o motor queimando.
        // O fator é fixado na abertura da válvula (temperatura do ciclo), não amostra a amostra: assim um ciclo
        // queimado mantém o timbre (o estouro inicial não fica mais agudo que o resto do curso) e só o ciclo
        // cortado sai abafado.
        // (referência = ciclo queimado em carga, ~1650 K: a amplitude no tubo em carga fica como foi acertada; a lenta
        // sai a ~950 K (−5 dB, que a calibração repõe) e o ciclo cortado ou de freio-motor a ~350 K (piso −20 dB))
        if (ap <= evo && a > evo) this.densC[c] = clamp(T / T_EXREF, 0.1, 1.3);
        const dens = mEx > 0 ? this.densC[c] : 1;
        // (o chiado do jato na válvula não entra na correção: é o escoamento sônico, não o empurrão do gás)
        run.out0 = 0.985 * run.in0 + Zr * mEx * (dens + turb * hiN);
        this.mEx[c] = mEx;
        if (mEx > 0) brkIn += this.brkW[c] * Zr * mEx * dens;

        // ---- válvula de admissão
        let mIn = 0;
        if (this.cc) mIn = this.ccAdmissao(c, a, pMan, p, T);
        else if (a > ivo && a < ivc) {
          const sv = Math.sin(Math.PI * (a - ivo) / (ivc - ivo));
          const A = this.AinMax * this.cylIn[c] * Math.min(1, 1.5 * sv * sv);
          mIn = flow(A, pMan, T_MAN, p, T);
        }
        mInSum += mIn;
        // (o refluxo para o coletor na abertura da admissão chega abafado pelo plenum e pela borboleta)
        intake += mIn > 0 ? mIn : 0.35 * mIn;
        this.air[c] += mIn * dt;

        // ---- 1ª lei para volume de controle aberto
        const hIn = mIn >= 0 ? T_MAN : T, hEx = mEx >= 0 ? T : T_BACK;
        p += (g1 * dQ + GAM * RGAS * (hIn * mIn - hEx * mEx) * dt - GAM * p * dV) / V;
        // blow-by pelos anéis: relevante só em baixa rotação (partida)
        const mLk = p > P0 ? (this.Aleak * (p - P0) * 0.67) / Math.sqrt(RGAS * T) : 0;
        p -= (GAM * RGAS * T * mLk * dt) / V;
        m += (mIn - mEx - mLk) * dt;
        if (m < 1e-9) m = 1e-9;
        if (p < 3000) p = 3000;
        pc_[c] = p; m_[c] = m;

        Tgas += (p - P0) * Ap * dxdth;

        // ---- forças de inércia (vibração)
        const ph = (this.theta - this.tdcRel[c]) * DEG;
        const acc = Math.cos(ph) + 0.3 * Math.cos(2 * ph);
        vib += (0.6 * this.ux[c] + this.uy[c] + 0.35 * this.dz[c] * (this.ux[c] + this.uy[c])) * acc;
      }
      this.pMan = clamp(pMan + ((mThr - mInSum) * dt * RGAS * T_MAN) / this.Vman, 3000, pUp * 1.05);

      // ---- dinâmica: virabrequim + embreagem + veículo
      const nk = (rpm / this.redline) * 7;
      // óleo frio é grosso: mais atrito
      let fmep = (0.95e5 + 0.12e5 * nk + 0.02e5 * nk * nk) * (1 + 0.5 * (1 - this.warm));
      if (this.cc) fmep = fmep * this.fmepK + this.pmeCarga; // (diesel: atrito maior + a carga do portador como pressão média de freio)
      const Tfr = (fmep * this.dispL * 1e-3) / (4 * Math.PI) * (omega > 0.5 ? 1 : 0.6);
      let Tst = 0;
      if (this.state === 'crank') Tst = (70 * this.dispL / Math.sqrt(this.N) * 2 + 40) * Math.max(0, 1 - rpm / (this.cc ? this.rpmPartida : 330));
      let Tcl = 0;
      // segurando o 2-step a embreagem fica aberta (pedal pisado / dupla embreagem esperando)
      if (this.gear > 0 && this.clutch > 0 && !this.launching) {
        // embreagem automática: patina segurando o giro de arrancada, trava ao sincronizar
        const slip = omega - this.vehOmega();
        if (Math.abs(slip) < 12 && this.clutch >= 1 && this.rpmAvg > this.idle * 0.95) this.locked = true;
        else if (Math.abs(slip) > 40 || this.clutch < 1 || (this.rpmAvg < this.idle * 0.85 && this.thr < 0.1)) this.locked = false;
        const launch = Math.max(this.idle * 2.2, this.redline * 0.36);
        // sem acelerar e fora de sincronia, a embreagem fica aberta (como pisar no pedal)
        // embalado acima da lenta, ela acopla mesmo sem acelerar (como soltar o pedal
        // depois de trocar a marcha): o motor é puxado até o giro das rodas e segura
        const coast = this.clutch * this.Tmax * 0.6 * smooth(this.idle * 1.05, this.idle * 1.4, this.vehOmega() * 9.549);
        // depois de uma troca, com o carro andando, é uma embreagem normal sendo solta:
        // aguenta bem mais que o motor e sincroniza em décimos de segundo. A patinada
        // controlada (capacidade limitada) é só para sair do lugar.
        const moving = this.vehOmega() * 9.549 > this.idle * 1.1;
        const cap = this.locked
          ? this.Tmax * 2.6 * smooth(this.idle * 0.75, this.idle * 1.0, rpm)
          : moving
            ? Math.max(coast, (this.ignCut && this.shiftUp && this.clutch > 0
              ? 0.65 + 1.6 * this.clutch * this.clutch * (3 - 2 * this.clutch) // troca rápida: a embreagem nova já segura o motor desde o começo
              : 2.2 * this.clutch * this.clutch * (3 - 2 * this.clutch)) * this.Tmax * smooth(this.idle * 0.6, this.idle * 0.95, rpm))
            : Math.max(coast, this.clutch * this.Tmax * 1.15 * smooth(this.idle * 1.05, launch, rpm) * smooth(0.02, 0.12, this.thr));
        Tcl = clamp(220 * slip, -cap, cap);
      } else this.locked = false;
      const w = Math.max(0, omega + ((Tgas * this.tqS + Tst - Tfr - Tcl) / this.J) * dt);
      if (!this.lockOmega) this.omega = w;
      this.theta += deg; if (this.theta >= 720) this.theta -= 720;
      this.tqGas += (Tgas - this.tqGas) * 0.002;
      this.tqMean += (Tgas * this.tqS - Tfr - this.tqMean) * 0.0004;
      this.frMean += (Tfr - this.frMean) * 0.0004;
      if (this.gear > 0) {
        const ratio = this.ratios[this.gear] * this.final;
        const F = (Tcl * ratio) / this.rw - this.kDrag * this.v * this.v - (this.v > 0.05 ? this.roll : 0) - this.brake * this.brakeF * (this.v > 0.05 ? 1 : 0);
        this.v = Math.max(0, this.v + (F / this.mass) * dt);
      } else if (this.v > 0) {
        this.v = Math.max(0, this.v - ((this.kDrag * this.v * this.v + this.roll + this.brake * this.brakeF) / this.mass) * dt);
      }

      // ---- rede acústica do escape
      for (let i = this.pops.length - 1; i >= 0; i--) {
        const pp = this.pops[i];
        if (pp.d > 0) { pp.d--; continue; }
        const t = pp.t / fs;
        const v = pp.amp * 0.55 * (Math.exp(-t / 0.0025) * (1 + 0.3 * rng.bi()) + 0.45 * rng.bi() * Math.exp(-t / 0.006));
        this.bankJ[Math.min(pp.bank, this.bankJ.length - 1)].inj += v;
        if (++pp.t > 0.03 * fs) this.pops.splice(i, 1);
      }
      for (let i = 0; i < nN; i++) nodes[i].step();
      for (let i = 0; i < nL; i++) lines[i].write();

      // ---- ponteira: irradiação + ruído de jato (escala com a velocidade do gás)
      let exL = 0, exR = 0, exLd = 0, exRd = 0;
      const iw = this.itdW = (this.itdW + 1) & this.itdM;
      for (let i = 0; i < nR; i++) {
        const rd = rads[i];
        const e = rd.emit;
        let x = this.radSh[i].run(this.radHP[i].run(e));
        if (this.tap) this.tap.ponteira(i, e, x);
        // o chiado segue a velocidade instantânea do gás em cada pulso (∝ v²): é o "puf" de cada explosão saindo
        // pela ponteira, com silêncio entre elas. (Uma versão que usava a velocidade média do gás tirava esses pufs
        // e deixava o agudo de todos os carros abafado, como um fundo liso)
        const vel = Math.max(0, rd.u) / (2.5e4 * this.tipA);
        this.jetEnv[i] += (vel - this.jetEnv[i]) * 0.15;
        const jv = this.jetEnv[i], nz = rng.bi();
        x += (this.jetF[i][0].run(nz) + 0.8 * this.jetF[i][1].run(nz)) * jv * jv * this.jetGain * P.air;
        if (this.tap) this.tap.jato(i, x);
        exL += x * rd.panL; exR += x * rd.panR;
        const ib = this.itdB[i], dd = this.itdD[i]; ib[iw] = x;
        exLd += ib[(iw - dd[0]) & this.itdM] * rd.panL; exRd += ib[(iw - dd[1]) & this.itdM] * rd.panR;
      }

      // ---- admissão
      let inS, inP, inH;
      {
        const dIn = (intake - this.inPrev) * fs;
        this.inPrev = intake;
        let x = dIn * 0.9 / (this.N * 0.5 + 1) / Math.max(0.02, this.Vd * 1e3);
        for (let i = 0; i < this.inF.length; i++) x = this.inF[i].run(x);
        // chiado do ar entrando pela borboleta: cresce com a vazão nela, não com a carga. Pisando com o coletor em
        // vácuo, a borboleta engole ar em fluxo sônico até o coletor encher: é o "suspiro" curto da acelerada; depois
        // segue a vazão do motor (normalizado pela rotação ele ficava no máximo durante toda a acelerada)
        const air = clamp(mThr / (this.Vd * N * 1.2 * this.redline / 120 + 1e-9), 0, 2);
        const hiss = this.hissF.run(rng.bi()) * air * air * this.hissGain * 0.25 * P.air;
        const loadIn = 0.3 + 0.7 * clamp(pMan / P0, 0, 1); // em lenta (coletor em vácuo) a admissão quase não se ouve
        inP = x * this.inGain * 0.004 * loadIn; inH = hiss; inS = inP + inH; // (pulso grave + chiado)
      }

      // ---- mecânico
      let mech = 0;
      {
        this.clickEnv *= 0.88;
        // frio: tuchos e pistão batem mais até o óleo esquentar e as folgas fecharem
        const coldN = 1 - this.warm;
        const cn = rng.bi() * this.clickEnv * (0.15 + rf) * (1 + 1.6 * coldN);
        mech += (this.clickF[0].run(cn) + 0.35 * this.clickF[1].run(cn)) * 0.05;
        if (this.cc) mech += this.ccMecanica(rf, coldN, pMan); // (diesel: knock por dp/dθ, injeção, bomba)
        else {
        this.knockEnv *= 0.93;
        const kn = rng.bi() * this.knockEnv * (0.3 + 0.7 * pMan / P0) * (1 + 1.2 * coldN);
        mech += (this.knockF[0].run(kn) + 0.6 * this.knockF[1].run(kn) + 0.25 * this.knockF[2].run(kn)) * 0.07;
        }
        this.phW += omega * dt; if (this.phW > 1e4) this.phW -= TAU * 1000;
        mech += (Math.sin(this.phW * 23) * 0.6 + Math.sin(this.phW * 2.9 * 12) * 0.4) * 0.002 * rf * rf;
        if (this.state === 'crank') {
          this.phS += (omega * 11 * dt) / TAU; this.phS -= Math.floor(this.phS);
          mech += this.starterLP.run((this.phS * 2 - 1) * 0.05 + rng.bi() * 0.02) * (0.6 + 0.4 * Math.sin(this.phW * 2));
        }
        mech = this.mechHP.run(mech);
        if (this.airCool) mech *= 1.2; // (sem a camisa d'água em volta, tucho, válvula e pistão irradiam mais)
        // bomba de ar secundário (zumbido elétrico) e ventoinha do radiador
        if (this.secAir > 0.01 && P.saSound !== false) {
          this.phSA += 760 * dt; if (this.phSA > 1) this.phSA -= 1;
          mech += this.secAir * (0.001 * Math.sin(TAU * this.phSA) + 0.0004 * Math.sin(2 * TAU * this.phSA) + 0.003 * this.saF.run(rng.bi()));
        }
        if (this.fanSpin > 0.01 && P.fanSound !== false) {
          this.phFan += 7 * 42 * this.fanSpin * dt; if (this.phFan > 1) this.phFan -= 1;
          mech += this.fanSpin * (0.006 * Math.sin(TAU * this.phFan) + 0.03 * this.fanF.run(rng.bi())) * this.fanSpin;
        }
        const ripple = (Tgas - this.tqGas) / (this.Tmax + 1);
        vib = this.vibLP.run(vib * 0.04 * rf * rf + ripple * 0.05);
      }

      // ---- irradiação do coletor perto do motor: a rajada de cada abertura de válvula vaza pelas paredes finas e
      // juntas antes do abafador. Sobe em ~3 ms e cai em ~10 ms (acima de ~1800 rpm as rajadas se fundem em ondas por
      // volta), e cada cilindro sopra conforme o próprio pulso. É o agudo "de lata" do Fusca, colado ao motor
      let brk = 0;
      if (this.breakK) {
        this.brkE += (brkIn - this.brkE) * (brkIn > this.brkE ? this.brkKa : this.brkKd);
        this.brkS += (brkIn - this.brkS) * this.brkKs; // (média de ~0,1 s: entre as rajadas o escape segue pressurizado e as juntas vazam um pouco)
        this.brkLP += this.brkKl * (this.brkF[0].run(rng.bi()) - this.brkLP); // (passa-alta em 700 Hz e 1 polo em 2,5 kHz)
        brk = this.brkF[1].run(this.brkLP) * (this.brkE + this.brkFloor * this.brkS) * this.breakK * this.brkK;
      }

      // ---- turbo
      let tur = 0, sc = 0;
      if (this.cc) tur = this.ccTurbo(pMan, pUp, P);
      else if (this.turbo) {
        const tw = this.turboW;
        const f = 500 + 6200 * tw;
        this.phT += TAU * f * dt; if (this.phT > TAU) this.phT -= TAU;
        const lvl = tw * tw * (0.2 + 0.8 * clamp(pMan / pUp, 0, 1));
        tur += (Math.sin(this.phT) + 0.25 * Math.sin(2 * this.phT + 0.7)) * 0.02 * lvl;
        tur += this.turboHiss.run(rng.bi()) * 0.02 * lvl * (0.3 + this.boost) * P.air;
        if (this.bovEnv > 0.002) {
          const nz = rng.bi();
          tur += (this.bovF[0].run(nz) + 0.6 * this.bovF[1].run(nz)) * this.bovEnv * this.bovAmp * 0.35;
        }
      }

      // ---- compressor mecânico: o "uivo" dos rotores; cresce com o giro e com a pressão
      if (this.blower) {
        // a correia e a carga variam um pouco a rotação dos rotores: a linha do uivo fica larga, não um apito parado
        this.scJit = (this.scJit || 0) + 0.02 * (rng.bi() - (this.scJit || 0));
        const fb = (omega / TAU) * this.scOrder * (1 + 0.09 * this.scJit);
        this.phB = (this.phB || 0) + TAU * fb * dt; if (this.phB > TAU) this.phB -= TAU;
        // (o uivo é a pulsação de cada bolsão abrindo para a descarga pressurizada: com o pé embaixo ela é forte; tirando
        // o pé, a válvula de alívio abre, os dois lados dos rotores ficam quase na mesma pressão e sobra só um fundo dos
        // rotores girando em vazio. Preso só ao giro, ele soava igual acelerando e caindo)
        const lv = Math.pow(rf, 1.5) * (0.06 + 0.94 * clamp(this.boost / Math.max(0.2, this.maxBoost), 0, 1));
        // (a passagem dos lóbulos pulsa a pressão de descarga numa fração grande da própria pressão: no cofre, de pé
        // embaixo, o uivo briga com o escape; antes ficava ~30 dB abaixo e não se ouvia)
        // a pulsação não é senoidal: cada bolsão abre de uma vez para a descarga, e a onda tem muitos harmônicos
        // (o Roots moderno, de lóbulos torcidos 160–170° como o Eaton TVS, abre cada bolsão aos poucos e a pulsação é
        // suave: com os harmônicos quase sem cair, como num Roots de lóbulos retos, o uivo agudo virava um guincho fino;
        // o duplo parafuso tem o 2º harmônico tão forte quanto o fundamental, medido num Hellcat, o que dá o som cheio
        // de sirene, e depois cai; o centrífugo é quase só a passagem das pás). Os harmônicos vêm pela recorrência de
        // Chebyshev, só até ~20 kHz
        const ty = this.scType, ex = ty === 'roots' ? 1.6 : 1.8;
        const c2 = 2 * Math.cos(this.phB), kMax = Math.min(16, Math.floor(0.42 * this.fs / Math.max(fb, 1)));
        let s1 = Math.sin(this.phB), s0 = 0, wv = 0, e2 = 0;
        for (let k = 1; k <= kMax; k++) {
          const a = ty === 'screw' ? (k <= 8 ? SCREW_H[k - 1] : 0.05 * Math.pow(0.6, k - 8)) : Math.pow(k, -ex);
          wv += a * s1; e2 += a * a; const s = c2 * s1 - s0; s0 = s1; s1 = s;
        }
        wv *= 0.79 / Math.sqrt(0.5 * Math.max(e2, 1e-9));
        // cada cilindro que aspira puxa a descarga e o uivo pulsa no ritmo das admissões (o "nhiii" granulado)
        this.scIn = (this.scIn || 0) + 0.0005 * (intake - (this.scIn || 0));
        const am = clamp(1 + (ty === 'centrifugal' ? 0.1 : ty === 'roots' ? 0.2 : 0.35) * (intake / Math.max(this.scIn, 1e-9) - 1), 0.4, 1.8);
        sc += wv * am * 0.36 * lv * this.scK * this.scGain;
        // o vazamento pelas pontas dos rotores chia junto com cada bolsão (um chiado médio, abaixo do uivo: centrado
        // nos agudos ele soava mais brilhante que o compressor real)
        sc += this.scHiss.run(rng.bi()) * 0.07 * lv * P.air * this.scGain * (0.6 + 0.4 * Math.sin(this.phB));
      }

      // ---- ouvinte (exL/exR em Pa, o resto já em escala de áudio)
      const exScale = 2.4e-4;
      exL *= exScale * P.exhaust; exR *= exScale * P.exhaust; exLd *= exScale * P.exhaust; exRd *= exScale * P.exhaust; brk *= exScale * P.exhaust;
      this.wE += (targetE - this.wE) * kw; this.wI += (targetI - this.wI) * kw; this.wB += (targetB - this.wB) * kw;
      this.wP += (targetP - this.wP) * kw; this.wR += (targetR - this.wR) * kw;
      inS *= P.intake; inP *= P.intake; inH *= P.intake; mech *= P.mech; vib *= P.mech;
      if (this.tap) this.tap.gravar(s, exScale * P.exhaust, inP, inH, mech, vib, tur, sc, brk);
      let L = 0, R = 0;
      // o que sai do cofre (admissão, mecânica, compressor) depende de onde o motor está: dianteiro, chega à câmera
      // de trás de longe e com a carroceria no meio; central ou traseiro, a câmera fica colada nele e ouve o
      // carburador puxando ar, a ventoinha e o trem de válvulas com o agudo. É por isso que o mesmo chiado é a
      // alma do Fusca e soa postiço num Mustang. (O pulso grave da admissão fica contido na caixa do filtro e sob a
      // tampa do motor; o chiado agudo, que nasce no carburador e na borboleta, escapa pelas grelhas)
      const me = this.extMech.run(mech), [kIn, kMe, kSc, kRaw, kH] = this.posW, mm = me + kRaw * (mech - me), ia = kIn * inP + kH * inH;
      if (this.wE > 1e-4) {
        const bk = (0.3 + 0.7 * kRaw) * brk; // (motor dianteiro: o coletor fica sob o capô e chega por baixo do carro)
        L += this.wE * (exLd + ia + kMe * mm + 0.2 * tur + kSc * sc + bk + 0.1 * vib);
        R += this.wE * (exRd + ia + kMe * mm + 0.2 * tur + kSc * sc + bk + 0.1 * vib);
      }
      if (this.wP > 1e-4) {
        // microfone colado na ponteira esquerda: campo próximo, quase só escape
        L += this.wP * (1.6 * exL + 0.4 * exR + 0.06 * inS + 0.05 * mech + 0.1 * tur + 0.03 * sc + 0.5 * brk);
        R += this.wP * (1.1 * exL + 0.35 * exR + 0.06 * inS + 0.05 * mech + 0.1 * tur + 0.03 * sc + 0.5 * brk);
      }
      if (this.wI > 1e-4) {
        let cl = exL * 0.75 + exR * 0.25, cr = exR * 0.75 + exL * 0.25;
        for (let i = 0; i < 3; i++) { cl = this.cabL[i].run(cl); cr = this.cabR[i].run(cr); }
        // pela parede corta-fogo chegam admissão, mecânica e a vibração do bloco
        const common = 0.35 * this.cabIn.run(inS) + 0.2 * this.cabMech.run(mech) + 0.25 * (tur + sc) + 0.2 * this.cabBrk.run(brk) + 1.2 * vib;
        L += this.wI * (cl * 0.6 + common); R += this.wI * (cr * 0.6 + common);
      }
      if (this.wB > 1e-4) {
        // cofre: o escape chega por baixo do carro, abafado; dominam admissão, comando e bloco
        const ex = this.bayEx.run((exL + exR) * 0.5);
        const b = 0.55 * ex + 1.0 * inS + 0.7 * mech + 0.8 * (tur + sc) + brk + 0.8 * vib;
        L += this.wB * b; R += this.wB * b;
      }
      // carro andando pela via (posição sempre atualizada; volta de "loop" metros)
      this.carX += this.v * dt;
      if (this.carX > loop / 2) this.carX -= loop;
      // (na rua o motor traseiro sopra para trás, junto com o escape; o dianteiro, para a frente)
      // (de frente, nada fica entre o compressor e quem está na rua: ele entra como no cofre)
      const eng = 0.12 * inP + kH * inH + 0.1 * mm + 0.8 * sc;
      this.road((exL + exR) * 0.5 + 0.7 * brk + kRaw * eng, (1 - kRaw) * eng + 0.2 * tur, P);
      if (this.wR > 1e-4) { L += this.wR * this.roadL; R += this.wR * this.roadR; }
      // bloqueio DC + compensação de loudness por rotação + saturação suave
      // (leve: um motor real fica uns 25 dB mais alto da lenta ao corte; aqui comprimimos só ~5 dB disso)
      // reforço da lenta medido na calibração, que some conforme o giro sobe (até metade da faixa)
      const wIdle = 1 - smooth((this.idle / this.redline) * 1.15, 0.5, rpmFrac);
      this.mk += (Math.pow(this.mkIdle || 1, wIdle) - this.mk) * 0.0005;
      if (this.fade < 1) this.fade = Math.min(1, this.fade + dt / 0.04);
      // arcade: nivelador sobre o escape na fonte (antes do ouvinte, para a distância na rua e a cabine
      // continuarem valendo). Abaixo da carga total da calibração ele sobe o ganho na razão 1:2, até +10 dB: a lenta
      // sobe metade do que falta, sem igualar ao giro alto; acima não mexe. O ganho desce em 15 ms e sobe em 300 ms, para não "bombear" no corte de giro
      const lv = this.cfgGain * this.mk, e2 = 0.5 * (exL * exL + exR * exR) * lv * lv;
      this.arcE += (e2 - this.arcE) * 0.0004; // (RMS de ~50 ms: um detector de pico lia os pulsos da lenta, não o nível)
      const gw = P.dynamics === 'arcade' && this.state === 'run' ? clamp(Math.pow(0.17 / Math.sqrt(this.arcE + 1e-12), 0.5), 1, 3.16) : 1;
      this.arcG += (gw - this.arcG) * (gw < this.arcG ? 0.0014 : 0.00007);
      // (e o reforço nunca leva um estouro além do teto: pico com ataque na hora e soltura de ~140 ms)
      this.arcP = Math.max(Math.max(Math.abs(exL), Math.abs(exR)) * lv * P.master * 0.5, this.arcP * 0.99985);
      const gOut = P.master * 0.5 * this.cfgGain * this.mk * this.fade * Math.min(this.arcG, Math.max(1, 0.9 / (this.arcP + 1e-9)));
      this.dcL = L - this.dcxL + 0.9985 * this.dcL; this.dcxL = L;
      this.dcR = R - this.dcxR + 0.9985 * this.dcR; this.dcxR = R;
      // som de fundo do ambiente (independe do motor)
      this.ambience(this.wI);
      const gA = P.ambSound === false ? 0 : P.master * 0.5;
      outL[s] = Math.tanh(this.dcL * gOut + this.ambL * gA);
      if (outR !== outL) outR[s] = Math.tanh(this.dcR * gOut + this.ambR * gA);
      if (sendL) {
        // envio para a reverberação: de longe o som refletido pesa mais que o direto
        const onboard = 1 - this.wR;
        sendL[s] = (this.dcL * onboard + this.wR * this.roadS * (0.75 + 0.25 * this.panS)) * gOut;
        sendR[s] = (this.dcR * onboard + this.wR * this.roadS * (0.75 - 0.25 * this.panS)) * gOut;
      }
    }

    this.telem += n;
    if (this.post && this.telem >= 1024) {
      this.telem = 0;
      this.post(this.telemetry());
    }
  }

  // Propagação do carro até um observador parado a `roadDist` metros da via.
  road(ex, front, P) {
    const fs = this.fs, buf = this.prop;
    const x = this.carX, d = Math.max(1.5, P.roadDist || 6);
    const hs = 0.35, hl = 1.6;
    const h2 = x * x + d * d;
    const rh = Math.sqrt(h2);
    const r1 = Math.sqrt(h2 + (hl - hs) * (hl - hs)), r2 = Math.sqrt(h2 + (hl + hs) * (hl + hs));
    const cosT = -x / rh;              // >0: o observador está à frente do carro
    const rear = 0.5 - 0.5 * cosT;
    // o escape aponta para trás; à frente, a própria carroceria abafa os agudos
    this.shade += onePole(fs, 900 + 15000 * rear * rear) * (ex - this.shade);
    const src = this.shade * (0.3 + 0.8 * rear) + front * (0.5 + 0.3 * cosT);
    buf[this.propW] = src;
    const k = fs / 343;
    const direct = this.readProp(r1 * k), refl = this.readProp(r2 * k);
    this.propW = (this.propW + 1) & this.propMask;
    // absorção do ar e do asfalto
    this.gndL += onePole(fs, 4500) * (refl - this.gndL);
    const mix = (direct * 5) / Math.max(r1, 1.5) + (0.6 * this.gndL * 5) / Math.max(r2, 1.5);
    this.airL += onePole(fs, clamp(20000 * Math.exp(-r1 / 170), 800, 20000)) * (mix - this.airL);
    const pan = clamp(x / r1, -1, 1);
    this.panS = pan;
    const a = (pan + 1) * Math.PI / 4;
    this.roadL = this.airL * Math.cos(a) * Math.SQRT2;
    this.roadR = this.airL * Math.sin(a) * Math.SQRT2;
    this.roadS = (direct * 1.2) / Math.sqrt(Math.max(r1, 3));
    this.rDist = r1;
    this.vRad = (x * this.v) / rh;   // >0: afastando
  }

  // leitura com atraso fracionário (Hermite cúbica): o atraso variável é o Doppler
  readProp(D) {
    const buf = this.prop, m = this.propMask;
    D = Math.min(Math.max(D, 2), m - 4);
    const pos = this.propW - D, i = Math.floor(pos), f = pos - i;
    const y0 = buf[(i - 1) & m], y1 = buf[i & m], y2 = buf[(i + 1) & m], y3 = buf[(i + 2) & m];
    const c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    return ((c3 * f + c2) * f + c1) * f + y1;
  }

  setAmbience(env) {
    this.ambEnv = env;
    const fs = this.fs, a = this.amb;
    const lp = { open: 260, street: 160, tunnel: 380, garage: 300, track: 240, canyon: 200 }[env] || 260;
    const bp = { open: 2500, street: 900, tunnel: 700, garage: 1500, track: 650, canyon: 1600 }[env] || 900;
    a[0].lp(fs, lp, 0.7); a[1].lp(fs, lp, 0.7); a[2].bp(fs, bp, 0.6); a[3].bp(fs, bp, 0.6);
    this.ambSpec = {
      open: [0.05, 0.0012, 0, 0], street: [0.045, 0.0035, 0, 0], tunnel: [0.04, 0.002, 100, 0.004],
      garage: [0.02, 0.001, 120, 0.002], track: [0.05, 0.004, 0, 0], canyon: [0.06, 0.001, 0, 0],
    }[env] || [0.04, 0.0012, 0, 0];
    // ventilação (jet fans do túnel, exaustor da garagem): ruído de banda estreita na passagem das pás e no
    // dobro, um para cada ouvido. Um seno parado soava como um tom de teste por baixo de tudo
    const hz = this.ambSpec[2] || 100;
    this.ambHum = [0, 1].map(() => [new Biquad().bp(fs, hz, 7), new Biquad().bp(fs, 2 * hz, 9)]);
  }

  // vento, trânsito distante, ventilação do túnel, murmúrio da arquibancada...
  ambience(inside) {
    const [gl, gb, , gh] = this.ambSpec, rng = this.rng, a = this.amb;
    this.ambMod += (rng.bi() * 0.5 - this.ambMod) * 0.00002;
    const gust = 0.7 + 0.6 * Math.abs(this.ambMod) * 4;
    let l = a[0].run(rng.bi()) * gl * gust + a[2].run(rng.bi()) * gb;
    let r = a[1].run(rng.bi()) * gl * gust + a[3].run(rng.bi()) * gb;
    if (gh) {
      // (×16: a banda estreita só deixa passar ~1/1000 do ruído branco; fica uns 8 dB abaixo do antigo seno)
      const [hl, hr] = this.ambHum, k = 16 * gh;
      l += (hl[0].run(rng.bi()) + 0.4 * hl[1].run(rng.bi())) * k;
      r += (hr[0].run(rng.bi()) + 0.4 * hr[1].run(rng.bi())) * k;
    }
    const g = 1 - 0.75 * inside;
    this.ambL = l * g; this.ambR = r * g;
  }

  telemetry() {
    return {
      type: 'telemetry', rpm: this.rpmAvg, theta: this.theta, kmh: this.v * 3.6, gear: this.gear,
      gears: this.ratios.length - 1, auto: this.auto,
      boost: this.boost, thr: this.thr, map: this.pMan / P0, limiter: this.limiter, state: this.state,
      torque: Math.max(0, this.tqMean), turbo: this.blower ? this.boost / Math.max(0.2, this.maxBoost) : this.turboW, denied: (this.denied || 0) > 0,
      valve: this.valveState.v, launch: this.launching && (this.twoStepMode === 'cut' ? this.limiter : this.rpmAvg > this.launchRpm * 0.92), launchSoft: this.twoStepMode === 'soft',
      coolant: this.coolant, fan: this.fanOn, secAir: this.secAir > 0.5, idleTarget: this.idleTarget, exhT: this.exhT, als: this.als,
      carX: this.carX, dist: this.rDist, vRad: this.vRad, loop: ENV_LOOP[this.params.env] || 800,
    };
  }
}
