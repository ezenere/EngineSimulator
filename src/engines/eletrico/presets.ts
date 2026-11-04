// Presets do Elétrico (ELETRICO.md 5): 18 fichas, um objeto por máquina, fáceis de editar à mão. Valores de catálogo
// quando conhecidos; os estimados ficam em `aprox` (decisão 8: só o medido é alvo de teste). Torques e potências são
// POR MOTOR; os do trem saem do esforço de partida da ficha (F·r_w/(i·η·n_motores)), o que dá as acelerações de serviço.
import type { PresetEletrico } from './dsp';
import type { Vec3 } from '../../scene/tipos';
import { NOTAS_TAURUS, PATAMAR_TAURUS, ESCADA_F0, ESCADA_DELTA } from './constantes';

export const FAMILIAS_ELETRICO = [
  { id: 'carros', name: 'Carros' },
  { id: 'trens', name: 'Trens e metrôs' },
  { id: 'bondes', name: 'Bondes e trólebus' },
  { id: 'ferramentas', name: 'Ferramentas' },
  { id: 'drones', name: 'Drones' },
  { id: 'industrial', name: 'Industrial' },
];

const dentro = (pos: Vec3) => ({ pos, dentro: true });
const fora = (pos: Vec3) => ({ pos, dentro: false });
/** carro: motor traseiro (CENA/ELETRICO 4.3), inversor junto, redução no motor, AVAS no para-choque */
const FONTES_CARRO_TRAS = { motor: dentro([-1.4, 0, 0.35]), inversor: dentro([-1.15, 0, 0.45]), reducao: dentro([-1.4, 0.25, 0.35]), avas: fora([2.2, 0, 0.4]), 'avas.re': fora([-2.3, 0, 0.4]) };
const FONTES_CARRO_FRENTE = { motor: dentro([1.3, 0, 0.35]), inversor: dentro([1.05, 0, 0.45]), reducao: dentro([1.3, 0.25, 0.35]), avas: fora([2.2, 0, 0.4]), 'avas.re': fora([-2.3, 0, 0.4]) };
/** trem: o portador põe cada fonte no truque e no carro motor (trem.ts); estes valores valem só fora dele */
const FONTES_TREM = { motor: fora([0, 0, 0.5]), inversor: fora([0, 0, 0.6]), reducao: fora([0, 0.4, 0.5]), ventilador: fora([0, 0, 0.6]), escovas: fora([0, 0, 0.5]), aux: fora([0, 0, 0.6]) };
/** bancada: tudo na mesa */
const FONTES_MESA = { motor: fora([0, 0, 1]), inversor: fora([0.1, 0, 1]), reducao: fora([0.08, 0, 1]), ventilador: fora([-0.05, 0, 1]), escovas: fora([-0.03, 0, 1]), helice: fora([0, 0, 1.15]) };
const IGBT_TREM = [21, 15, 9, 5, 3, 1];

// ------------------------------------------------------------------ carros
const MODEL3_DIANTEIRO: PresetEletrico = {
  id: 'model3-dianteiro', name: 'Model 3 (dianteiro)', tag: 'indução 4 polos', family: 'carros', nome: 'Tesla Model 3 LR AWD, motor dianteiro', familia: 'eletrico',
  maquina: 'inducao', p: 2, Zs: 60, Zr: 74, Tn: 210, Pmax: 98000, rpmBase: 6000, rpmMax: 18000, J: 0.04, escorregamentoNominal: 0.02,
  inversor: { tipo: 'sic', fc: 10000, modo: 'aleatoria', delta: 0.1 },
  reducao: { estagios: [{ Zp: 27, Zc: 75 }, { Zp: 23, Zc: 75 }], eta: 0.97 }, ventilacao: null, carcaca: 'carro',
  niveis: { motor: 84, inversor: 70, reducao: 82, ventilador: 0 }, Tregen: 0.3, creep: true,
  fontes: FONTES_CARRO_FRENTE, aprox: ['Zs', 'Zr', 'Tn', 'Pmax', 'reducao'],
  portador: { tipo: 'carro', massa: 1850, CdA: 0.23 * 2.22, Crr: 0.011, rw: 0.334 },
};

export const PRESETS_ELETRICO: PresetEletrico[] = [
  {
    id: 'model3', name: 'Tesla Model 3 LR AWD', tag: 'PMSRM + indução · SiC 10 kHz', family: 'carros', nome: 'Tesla Model 3 Long Range AWD', familia: 'eletrico',
    maquina: 'pmsrm', p: 3, Zs: 54, Tn: 300, Pmax: 160000, rpmBase: 6000, rpmMax: 18000, J: 0.03,
    inversor: { tipo: 'sic', fc: 10000, modo: 'aleatoria', delta: 0.1 },
    // 27:75 → 23:75 (9,06): uivo do 1º estágio em 27·f_rot (3,5 kHz a 100 km/h) e do 2º em 23·f_rot/2,78
    reducao: { estagios: [{ Zp: 27, Zc: 75 }, { Zp: 23, Zc: 75 }], eta: 0.97 }, ventilacao: null, carcaca: 'carro',
    niveis: { motor: 86, inversor: 72, reducao: 84, ventilador: 0 }, avas: 'ue', creep: true, Tregen: 0.3,
    fontes: FONTES_CARRO_TRAS, segundo: MODEL3_DIANTEIRO, vMaxKmh: 233,
    aprox: ['Tn (divisão 300 + 210 N·m dos 510)', 'Pmax (160 + 98 kW)', 'reducao (dentes)'],
    portador: { tipo: 'carro', massa: 1850, CdA: 0.23 * 2.22, Crr: 0.011, rw: 0.334 },
  },
  {
    id: 'leaf', name: 'Nissan Leaf ZE1', tag: 'PMSM 8 polos · IGBT 10 kHz', family: 'carros', nome: 'Nissan Leaf (ZE1, 40 kWh)', familia: 'eletrico',
    maquina: 'pmsm', p: 4, Zs: 48, Tn: 320, Pmax: 110000, rpmBase: 3300, rpmMax: 10500, J: 0.04,
    inversor: { tipo: 'igbt', fc: 10000, modo: 'assincrona' },
    reducao: { estagios: [{ Zp: 16, Zc: 44 }, { Zp: 17, Zc: 51 }], eta: 0.97 }, ventilacao: null, carcaca: 'carro',
    niveis: { motor: 86, inversor: 72, reducao: 84, ventilador: 0 }, avas: 'ue', creep: true, Tregen: 0.3,
    fontes: { ...FONTES_CARRO_TRAS, motor: dentro([1.3, 0, 0.35]), inversor: dentro([1.05, 0, 0.5]), reducao: dentro([1.3, 0.25, 0.35]) }, vMaxKmh: 144,
    aprox: ['fc (linha fixa 9,6–10 kHz na gravação)', 'reducao (2,75 × 3,0)'],
    portador: { tipo: 'carro', massa: 1580, CdA: 0.28 * 2.27, Crr: 0.011, rw: 0.316 },
  },
  {
    id: 'dolphin', name: 'BYD Dolphin', tag: 'PMSM 8 polos · SiC aleatória', family: 'carros', nome: 'BYD Dolphin', familia: 'eletrico',
    maquina: 'pmsm', p: 4, Zs: 48, Tn: 310, Pmax: 150000, rpmBase: 4620, rpmMax: 16000, J: 0.035,
    inversor: { tipo: 'sic', fc: 10000, modo: 'aleatoria', delta: 0.1 },
    reducao: { estagios: [{ Zp: 19, Zc: 61 }, { Zp: 20, Zc: 66 }], eta: 0.97 }, ventilacao: null, carcaca: 'carro',
    niveis: { motor: 86, inversor: 72, reducao: 84, ventilador: 0 }, avas: 'ue', creep: true, Tregen: 0.3,
    fontes: { ...FONTES_CARRO_TRAS, motor: dentro([1.3, 0, 0.35]), inversor: dentro([1.05, 0, 0.5]), reducao: dentro([1.3, 0.25, 0.35]) }, vMaxKmh: 160,
    aprox: ['p', 'Zs', 'reducao (10,6)', 'fc', 'rpmMax'],
    portador: { tipo: 'carro', massa: 1660, CdA: 0.3 * 2.3, Crr: 0.011, rw: 0.32 },
  },
  {
    id: 'formulae', name: 'Fórmula E Gen3', tag: 'PMSM · dentes retos', family: 'carros', nome: 'Fórmula E Gen3 (traseiro)', familia: 'eletrico',
    maquina: 'pmsm', p: 4, Zs: 48, Tn: 280, Pmax: 350000, rpmBase: 11940, rpmMax: 20000, J: 0.02,
    // SiC a 24 kHz: acima de 0,45·fs, não se sintetiza (as bandas laterais que caem abaixo de 21,6 kHz entram com −12 dB)
    inversor: { tipo: 'sic', fc: 24000, modo: 'assincrona' },
    reducao: { estagios: [{ Zp: 20, Zc: 80 }], eta: 0.98, retos: true }, ventilacao: null, carcaca: 'carro',
    // redução de dentes retos: +10 dB sobre a helicoidal (84 + 10)
    niveis: { motor: 88, inversor: 60, reducao: 94, ventilador: 0 }, Tregen: 0.5,
    fontes: { motor: dentro([-1.2, 0, 0.3]), inversor: dentro([-0.9, 0, 0.4]), reducao: dentro([-1.5, 0, 0.3]) }, vMaxKmh: 322,
    aprox: ['p', 'Zs', 'reducao (4,0, 1 estágio)', 'fc', 'Tn'],
    portador: { tipo: 'carro', massa: 854, CdA: 1.05, Crr: 0.012, rw: 0.335 },
  },
  // ------------------------------------------------------------------ trens e metrôs
  {
    id: 'taurus', name: 'Siemens Taurus ES64U2', tag: 'GTO · do-re-mi', family: 'trens', nome: 'Siemens Taurus ES64U2', familia: 'eletrico',
    maquina: 'inducao', p: 2, Zs: 48, Zr: 58, Tn: 12050, Pmax: 1600000, rpmBase: 1270, rpmMax: 4000, J: 25, escorregamentoNominal: 0.02,
    inversor: {
      tipo: 'gto', fc: PATAMAR_TAURUS, fcMax: 600, modo: 'escada',
      escada: { f0: ESCADA_F0, delta: ESCADA_DELTA, notas: NOTAS_TAURUS, patamar: PATAMAR_TAURUS },
      sincrona: [15, 11, 9, 7, 5, 3, 1],
      // grupos 2f_c, 3f_c, 4f_c medidos no patamar (3.1: D −4/−9/−8, A −11/−15/−22): os do meio
      perfilGrupos: [0, -6, -9, -9],
    },
    // linhas fixas da locomotiva parada (conversor auxiliar e ventilação, 3.1)
    auxLinhas: [[176, 0], [527, 0], [688, -3]],
    reducao: { estagios: [{ Zp: 26, Zc: 96 }], eta: 0.97 }, ventilacao: { forcada: true, B: 9, rpm: 2950 }, carcaca: 'trem',
    niveis: { motor: 100, inversor: 98, reducao: 96, ventilador: 95, aux: 85 }, Tregen: 1, vRegenMin: 10 / 3.6, nUnidades: 2, detune: 0.003,
    fontes: FONTES_TREM, vMaxKmh: 230,
    aprox: ['Zs', 'Zr', 'reducao (3,69)', 'lista síncrona', 'Tn (300 kN de partida)'],
    portador: {
      tipo: 'trem', carrosMotores: [1], motoresPorTruque: 2, rw: 0.575, massaTotal: 486000, carroAux: 1,
      davis: { A: 8000, B: 100, C: 8 },
      config: { N: 8, Lc: 25, vao: 0.8, lNariz: 2, lCauda: 1, cpNariz: 0.3, largura: 3.0, altura: 4.3, zPiso: 0.5, pantografos: [1], carenagem: false, diametroRoda: 1.15 },
    },
  },
  {
    id: 'vectron', name: 'Siemens Vectron AC', tag: 'IGBT 1 kHz · auto', family: 'trens', nome: 'Siemens Vectron AC', familia: 'eletrico',
    maquina: 'inducao', p: 2, Zs: 48, Zr: 40, Tn: 12000, Pmax: 1600000, rpmBase: 1280, rpmMax: 3500, J: 25, escorregamentoNominal: 0.02,
    inversor: { tipo: 'igbt', fc: 1000, modo: 'auto', sincrona: IGBT_TREM },
    reducao: { estagios: [{ Zp: 27, Zc: 100 }], eta: 0.97 }, ventilacao: { forcada: true, B: 9, rpm: 2950 }, carcaca: 'trem',
    niveis: { motor: 100, inversor: 92, reducao: 96, ventilador: 95 }, Tregen: 1, vRegenMin: 10 / 3.6, nUnidades: 2, detune: 0.003,
    fontes: FONTES_TREM, vMaxKmh: 200,
    aprox: ['Zs', 'Zr', 'reducao (3,7)', 'fc', 'lista síncrona'],
    portador: {
      tipo: 'trem', carrosMotores: [1], motoresPorTruque: 2, rw: 0.575, massaTotal: 490000,
      davis: { A: 8000, B: 100, C: 8 },
      config: { N: 8, Lc: 25, vao: 0.8, lNariz: 2, lCauda: 1, cpNariz: 0.3, largura: 3.0, altura: 4.3, zPiso: 0.5, pantografos: [1], carenagem: false, diametroRoda: 1.15 },
    },
  },
  {
    id: 'frotaa', name: 'Metrô SP Frota A', tag: 'CC série · chopper', family: 'trens', nome: 'Metrô de São Paulo, Frota A (original, chopper)', familia: 'eletrico',
    maquina: 'cc-serie', p: 2, Zs: 46, Zc: 139, Tn: 1190, Pmax: 130000, rpmBase: 1040, rpmMax: 3500, J: 6,
    inversor: { tipo: 'chopper', fc: 350, modo: 'chopper' },
    reducao: { estagios: [{ Zp: 15, Zc: 93 }], eta: 0.96 }, ventilacao: { forcada: false, B: 12 }, escovas: { Zc: 139, desgaste: 0.3 }, carcaca: 'trem',
    niveis: { motor: 95, inversor: 94, reducao: 96, ventilador: 92, escovas: 90 }, Tregen: 0.8, vRegenMin: 10 / 3.6, nUnidades: 4, detune: 0.003,
    fontes: FONTES_TREM, vMaxKmh: 90,
    aprox: ['Zs', 'Zc', 'reducao (6,2)', 'f_ch (sem gravação)', 'Tn'],
    portador: {
      tipo: 'trem', carrosMotores: [1, 3, 4, 6], motoresPorTruque: 2, rw: 0.43, massaTotal: 240000, carroAux: 2,
      davis: { A: 7000, B: 120, C: 12 },
      config: { N: 6, Lc: 21.5, vao: 0.8, lNariz: 1.5, lCauda: 1.5, cpNariz: 0.3, largura: 3.1, altura: 3.7, zPiso: 0.5, pantografos: [], carenagem: false },
    },
  },
  {
    id: 'cptm9500', name: 'CPTM Série 9500', tag: 'Hyundai Rotem · IGBT · SIV 1333 Hz', family: 'trens', nome: 'CPTM Série 9500 (Hyundai Rotem)', familia: 'eletrico',
    maquina: 'inducao', p: 2, Zs: 36, Tn: 1760, Pmax: 210000, rpmBase: 1140, rpmMax: 4000, J: 4, escorregamentoNominal: 0.02,
    inversor: { tipo: 'igbt', fc: 1500, modo: 'auto', sincrona: IGBT_TREM, fcAux: 1333, fRede: 60 },
    // engrenamento Z_p 16 (família 1) e ranhuras Z_s 36 (família 2): 36/16 = 2,25, medido 2,24 (3.2); barras não aparecem
    reducao: { estagios: [{ Zp: 16, Zc: 101 }], eta: 0.96 }, ventilacao: null, carcaca: 'trem',
    auxLinhas: [[542, 0], [656, -12]],
    niveis: { motor: 98, inversor: 92, reducao: 98, ventilador: 0, aux: 85 }, Tregen: 1, vRegenMin: 10 / 3.6, nUnidades: 4, detune: 0.003,
    fontes: FONTES_TREM, vMaxKmh: 100,
    aprox: ['reducao (6,3)', 'fc', 'Tn'],
    portador: {
      tipo: 'trem', carrosMotores: [2, 3, 6, 7], motoresPorTruque: 2, rw: 0.43, massaTotal: 360000, carroAux: 1,
      davis: { A: 10000, B: 150, C: 14 },
      config: { N: 8, Lc: 20, vao: 0.8, lNariz: 1.5, lCauda: 1.5, cpNariz: 0.3, largura: 3.0, altura: 3.9, zPiso: 0.5, pantografos: [2, 6], carenagem: false },
    },
  },
  {
    id: 'cptm9000', name: 'CPTM Série 9000', tag: 'CAF · IGBT 2,3 kHz', family: 'trens', nome: 'CPTM Série 9000 (CAF)', familia: 'eletrico',
    maquina: 'inducao', p: 2, Zs: 44, Tn: 1700, Pmax: 200000, rpmBase: 1120, rpmMax: 4100, J: 4, escorregamentoNominal: 0.02,
    inversor: { tipo: 'igbt', fc: 2300, modo: 'auto', sincrona: IGBT_TREM },
    // ordens medidas 1 : 1,44 : 2,45 (3.2): engrenamento Z_p 18, ranhuras 44 (44/18 = 2,44) e a linha de 1,44·18 = 25,9·f_rot,
    // medida e sem explicação física
    reducao: { estagios: [{ Zp: 18, Zc: 117 }], eta: 0.96 }, ventilacao: null, carcaca: 'trem',
    linhasExtras: [[25.92, -3]],
    niveis: { motor: 98, inversor: 92, reducao: 98, ventilador: 0 }, Tregen: 1, vRegenMin: 10 / 3.6, nUnidades: 4, detune: 0.003,
    fontes: FONTES_TREM, vMaxKmh: 100,
    aprox: ['Zp 18 e Zs 44 (das razões medidas)', 'reducao (6,5)', 'fc'],
    portador: {
      tipo: 'trem', carrosMotores: [2, 3, 6, 7], motoresPorTruque: 2, rw: 0.43, massaTotal: 360000,
      davis: { A: 10000, B: 150, C: 14 },
      config: { N: 8, Lc: 20, vao: 0.8, lNariz: 1.5, lCauda: 1.5, cpNariz: 0.3, largura: 3.0, altura: 3.9, zPiso: 0.5, pantografos: [2, 6], carenagem: false },
    },
  },
  {
    id: 'metropolis', name: 'Alstom Metropolis', tag: 'Frota I · Onix · troca de marcha', family: 'trens', nome: 'Alstom Metropolis (Frota I, Metrô SP)', familia: 'eletrico',
    maquina: 'inducao', p: 2, Zs: 48, Tn: 1110, Pmax: 150000, rpmBase: 1290, rpmMax: 4000, J: 3, escorregamentoNominal: 0.02,
    inversor: { tipo: 'igbt', fc: 1250, modo: 'auto', sincrona: [15, 9, 5, 3, 1] },
    reducao: { estagios: [{ Zp: 15, Zc: 102 }], eta: 0.96 }, ventilacao: null, carcaca: 'trem',
    niveis: { motor: 98, inversor: 92, reducao: 96, ventilador: 0 }, Tregen: 1, vRegenMin: 10 / 3.6, nUnidades: 4, detune: 0.003,
    fontes: FONTES_TREM, vMaxKmh: 90,
    aprox: ['Zs', 'reducao (6,8)', 'fc', 'lista síncrona', 'Pmax (150 kW: com os 190 da ficha o 0–80 km/h sai em 30 s, contra 36 ± 4 do passo 2)'],
    portador: {
      tipo: 'trem', carrosMotores: [1, 2, 5, 6], motoresPorTruque: 2, rw: 0.43, massaTotal: 240000,
      davis: { A: 7000, B: 120, C: 12 },
      config: { N: 6, Lc: 22, vao: 0.8, lNariz: 1.5, lCauda: 1.5, cpNariz: 0.3, largura: 3.1, altura: 3.8, zPiso: 0.5, pantografos: [], carenagem: false },
    },
  },
  {
    id: 'n700', name: 'Shinkansen N700', tag: 'indução · IGBT 3 níveis', family: 'trens', nome: 'Shinkansen N700', familia: 'eletrico',
    maquina: 'inducao', p: 2, Zs: 48, Tn: 1780, Pmax: 305000, rpmBase: 1640, rpmMax: 5500, J: 4, escorregamentoNominal: 0.015,
    inversor: { tipo: 'igbt', fc: 1200, modo: 'auto', sincrona: IGBT_TREM },
    reducao: { estagios: [{ Zp: 29, Zc: 81 }], eta: 0.97 }, ventilacao: { forcada: true, B: 9, rpm: 3550 }, carcaca: 'trem',
    niveis: { motor: 100, inversor: 92, reducao: 96, ventilador: 95 }, Tregen: 1, vRegenMin: 10 / 3.6, nUnidades: 4, detune: 0.003,
    fontes: FONTES_TREM, vMaxKmh: 300,
    aprox: ['Zs', 'fc', 'lista síncrona'],
    // o trem-bala da Passagem (10 vagões de 25 m, 8 motores): 715 t × 10/16
    portador: {
      tipo: 'trem', carrosMotores: [2, 3, 4, 5, 6, 7, 8, 9], motoresPorTruque: 2, rw: 0.43, massaTotal: 447000,
      davis: { A: 6300, B: 80, C: 20 },
      config: {},
    },
  },
  {
    id: 'tgv', name: 'TGV Réseau', tag: 'síncrono · CSI', family: 'trens', nome: 'TGV Réseau/Duplex (síncrono)', familia: 'eletrico',
    maquina: 'sincrona-excitada', p: 2, Zs: 48, Tn: 5640, Pmax: 1100000, rpmBase: 1860, rpmMax: 4500, J: 15,
    // inversor de corrente a tiristores: sem portadora; 6f_e é o "apito" subindo com a velocidade; chopper de entrada em 1,5 kV CC
    inversor: { tipo: 'csi', fc: 0, modo: 'sincrona', fcEntrada: 300 },
    reducao: { estagios: [{ Zp: 30, Zc: 69 }], eta: 0.97 }, ventilacao: { forcada: true, B: 9, rpm: 2950 }, carcaca: 'trem',
    niveis: { motor: 100, inversor: 94, reducao: 96, ventilador: 95 }, Tregen: 1, vRegenMin: 10 / 3.6, nUnidades: 2, detune: 0.003,
    fontes: FONTES_TREM, vMaxKmh: 320,
    aprox: ['p', 'Zs', 'reducao (2,3)', 'fcEntrada'],
    portador: {
      tipo: 'trem', carrosMotores: [1, 10], motoresPorTruque: 2, rw: 0.46, massaTotal: 384000,
      davis: { A: 6000, B: 80, C: 20 },
      config: { N: 10, Lc: 20, vao: 0.8, lNariz: 8, lCauda: 8, cpNariz: 0.18, largura: 2.9, altura: 4.1, zPiso: 0.4, pantografos: [1, 10] },
    },
  },
  // ------------------------------------------------------------------ bondes e trólebus
  {
    id: 'flexity', name: 'Bombardier Flexity', tag: 'bonde · IGBT 2,2 kHz', family: 'bondes', nome: 'Bonde Bombardier Flexity', familia: 'eletrico',
    maquina: 'inducao', p: 2, Zs: 36, Tn: 1000, Pmax: 120000, rpmBase: 1150, rpmMax: 3800, J: 1.5, escorregamentoNominal: 0.025,
    // classe medida (Citadis, Urbos): f_c fixa 2,09–2,52 kHz com 2f_c mais forte que f_c (3.4)
    inversor: { tipo: 'igbt', fc: 2200, modo: 'assincrona', perfilGrupos: [0, 2] },
    auxLinhas: [[167, 0], [1942, -22], [3879, -16], [5473, -24]],
    reducao: { estagios: [{ Zp: 17, Zc: 102 }], eta: 0.96 }, ventilacao: null, carcaca: 'trem',
    niveis: { motor: 95, inversor: 90, reducao: 92, ventilador: 0, aux: 82 }, Tregen: 1, vRegenMin: 8 / 3.6, nUnidades: 2, detune: 0.003,
    fontes: FONTES_TREM, vMaxKmh: 70,
    aprox: ['Zs', 'reducao (6,0)', 'fc'],
    portador: {
      tipo: 'trem', carrosMotores: [1, 5], motoresPorTruque: 2, rw: 0.3, massaTotal: 58000, carroAux: 3, bonde: true,
      davis: { A: 1500, B: 40, C: 3 },
      config: { N: 5, Lc: 6.5, vao: 0.3, largura: 2.4, altura: 3.4, zPiso: 0.35, lNariz: 1.5, lCauda: 1.5, cpNariz: 0.3, pantografos: [3], carenagem: false, diametroRoda: 0.6, truques: [1, 3, 5] },
    },
  },
  {
    id: 'trolebus', name: 'Trólebus Eletra (CC)', tag: 'CC série · chopper 500 Hz', family: 'bondes', nome: 'Trólebus Eletra/Marcopolo (São Paulo, versão CC)', familia: 'eletrico',
    maquina: 'cc-serie', p: 2, Zs: 38, Zc: 100, Tn: 1345, Pmax: 150000, rpmBase: 1065, rpmMax: 3500, J: 2,
    inversor: { tipo: 'chopper', fc: 500, modo: 'chopper' },
    reducao: { estagios: [{ Zp: 8, Zc: 76 }], eta: 0.95 }, ventilacao: { forcada: true, B: 9, rpm: 3550 }, escovas: { Zc: 100, desgaste: 0.3 }, carcaca: 'trem',
    niveis: { motor: 95, inversor: 94, reducao: 93, ventilador: 96, escovas: 92 }, Tregen: 0.6, avas: null,
    fontes: { motor: dentro([-3.5, 0, 0.6]), inversor: dentro([-3.0, 0, 2.9]), reducao: dentro([-4.0, 0, 0.5]), ventilador: fora([-3.2, 0.9, 1.0]), escovas: dentro([-3.5, 0.1, 0.6]) },
    vMaxKmh: 70,
    aprox: ['Zs', 'Zc', 'reducao (9,5)', 'f_ch'],
    portador: { tipo: 'carro', massa: 18000, CdA: 0.6 * 7.5, Crr: 0.009, rw: 0.51, corpo: 'onibus', pneus: 6, trole: true },
  },
  // ------------------------------------------------------------------ ferramentas
  {
    id: 'furadeira', name: 'Furadeira sem fio', tag: 'CC escovado · 12 lâminas', family: 'ferramentas', nome: 'Furadeira sem fio (CC escovado 2 polos)', familia: 'eletrico',
    maquina: 'universal', p: 1, Zs: 8, Zc: 12, Tn: 0.83, Pmax: 650, rpmBase: 7500, rpmMax: 15000, J: 3e-5, curvaLinear: true,
    inversor: null,
    // planetária de 2 estágios (≈): ×6 e ×3 de f_rot (as ordens 3 e 6 da gravação)
    reducao: { estagios: [{ Zp: 6, Zc: 20 }, { Zp: 10, Zc: 30 }], eta: 0.9 }, ventilacao: { forcada: false, B: 10 }, escovas: { Zc: 12, desgaste: 0.2 }, carcaca: 'pequena',
    linhasExtras: [[5, -6]], faiscamento: 0.5,
    niveis: { motor: 92, inversor: 0, reducao: 96, ventilador: 90, escovas: 94 },
    fontes: FONTES_MESA,
    aprox: ['reducao (dentes)', 'Tn', 'ordem 5 (medida)'],
    portador: { tipo: 'bancada', carga: 'degrau', Tcarga: 0.6 * 0.83, inercia: 1e-5 },
  },
  {
    id: 'liquidificador', name: 'Liquidificador', tag: 'universal · 22 000 rpm', family: 'ferramentas', nome: 'Liquidificador (motor universal)', familia: 'eletrico',
    maquina: 'universal', p: 1, Zs: 12, Zc: 16, Tn: 0.69, Pmax: 800, rpmBase: 11000, rpmMax: 22000, J: 4e-5, curvaLinear: true,
    inversor: null, reducao: { estagios: [], eta: 1 }, ventilacao: { forcada: false, B: 8 }, escovas: { Zc: 16, desgaste: 0.3 }, carcaca: 'pequena',
    // facas (4 pás: BPF 4·f_rot) e a jarra (largo de cavitação, +10 dB com gelo)
    helice: { B: 4, D: 0.07, rotores: 1, detune: [0], harmonicos: [0, -6, -10, -14, -18, -22], largoDb: 6, largoCarga: true },
    faiscamento: 0.5,
    niveis: { motor: 90, inversor: 0, reducao: 0, ventilador: 86, escovas: 92, helice: 98 },
    fontes: FONTES_MESA,
    aprox: ['Zc', 'Zs', 'Tn'],
    portador: { tipo: 'bancada', carga: 'quadratica', Tcarga: 0.41, inercia: 2e-5, rpmRef: 15400 },
  },
  // ------------------------------------------------------------------ drones
  {
    id: 'mavic', name: 'DJI Mavic Pro', tag: '4 × BLDC 12N14P', family: 'drones', nome: 'Drone DJI Mavic Pro', familia: 'eletrico',
    maquina: 'bldc', p: 7, Zs: 12, Tn: 0.15, Pmax: 100, rpmBase: 6270, rpmMax: 9000, J: 2e-5,
    // ESC de 6 passos (PWM a 24 kHz: não se sintetiza); a força do motor medida em 63·f_rot = 9·f_e (3.6); 6f_e e 12f_e fracos
    inversor: null, ordensEletricas: [[9, 0], [6, -16], [12, -16]],
    reducao: { estagios: [], eta: 1 }, ventilacao: null, carcaca: 'pequena',
    helice: { B: 2, D: 0.21, rotores: 4, detune: [-0.10, -0.02, 0, 0.01], largoDb: -4 },
    jitter: 0.01,
    niveis: { motor: 70, inversor: 0, reducao: 0, ventilador: 0, helice: 80 },
    fontes: { motor: fora([0, 0, 0.03]), helice: fora([0, 0, 0.05]) },
    aprox: ['Tn', 'Pmax'],
    portador: { tipo: 'drone', massa: 0.734, cQ: 0.012 },
  },
  // ------------------------------------------------------------------ industrial
  {
    id: 'industrial', name: 'Motor de indução 11 kW', tag: '4 polos · rede 50 Hz · ventilador', family: 'industrial', nome: 'Ventilador industrial / motor de indução 4 polos', familia: 'eletrico',
    maquina: 'inducao', p: 2, Zs: 36, Zr: 28, Tn: 72, Pmax: 11000, rpmBase: 1460, rpmMax: 1500, J: 0.08, escorregamentoNominal: 0.027, fRede: 50,
    inversor: null, reducao: { estagios: [], eta: 1 }, ventilacao: { forcada: false, B: 8 }, carcaca: 'trem',
    niveis: { motor: 78, inversor: 0, reducao: 0, ventilador: 92 },
    fontes: FONTES_MESA,
    aprox: ['J'],
    portador: { tipo: 'bancada', carga: 'quadratica', Tcarga: 72, inercia: 0.5, rpmRef: 1460 },
  },
];

export const PADRAO_ELETRICO = PRESETS_ELETRICO[0];
export const presetEletrico = (id: string) => PRESETS_ELETRICO.find((p) => p.id === id);
