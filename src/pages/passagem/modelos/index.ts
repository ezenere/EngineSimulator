// Qual modelo cada portador e cada motor ganham. O portador diz a família (carro, trem, locomotiva, avião…); o preset
// do motor diz o veículo (o Camaro é um muscle, a Hilux uma picape, o Scania um caminhão, o R-975 um Sherman, o 787B
// um protótipo, o K4s uma Pacific). Um grupo por segmento do corpo (os trens), no referencial do segmento.
import * as THREE from 'three';
import type { ControlePassagem } from '../controle';
import { COR, type Modelo } from './kit';
import { carro } from './estrada';
import { tipoCarro, paramsHelice, paramsJato } from './tipos';
import { trem, locomotivaDiesel, trensVapor, centros, type TipoTrem, type Pintura } from './trilhos';
import { aviaoHelice, jato, helicoptero, drone } from './ar';
import { geradorDiesel, corliss, tratorVapor, barcoVapor } from './outros';

/**
 * Os faróis acesos (no referencial do corpo): os do trem, da locomotiva e do carro, o farol de pouso do avião e do
 * helicóptero. A cena desenha cada um como um ponto de tamanho fixo na tela: de longe, o veículo é visto chegando (de
 * perto o farol do modelo já aparece). `vermelho`: o farol anticolisão do avião, no alto.
 */
export function farois(c: ControlePassagem): { brancos: [number, number, number][]; vermelhos: [number, number, number][] } {
  const k = c.corpo, s0 = k.segmentos[0], f = c.fontes, brancos: [number, number, number][] = [], vermelhos: [number, number, number][] = [];
  if (!s0) return { brancos, vermelhos };
  const frente = k.comprimento / 2, H = s0.altura - s0.zPiso;
  if (c.portador === 'trem') for (const y of [-0.3, 0.3]) brancos.push([frente - 0.25, y * s0.largura, s0.zPiso + H * 0.25]);
  else if (c.portador === 'locomotiva' && c.motor !== 'vapor') for (const y of [-0.5, 0.5]) brancos.push([frente - 0.3, y, 2.05]);
  else if (c.portador === 'locomotiva') brancos.push([frente - 0.45, 0, s0.altura * 0.66]);
  else if (c.portador === 'carro') {
    const t = tipoCarro(c.motor, c.motorPreset ?? '').tipo, x = t === 'caminhao' ? 8.25 : t === 'onibus' ? 6.15 : t === 'moto' ? 1.0 : t === 'tanque' ? 2.95 : 2.35;
    if (t === 'moto') brancos.push([x, 0, 0.82]); else for (const y of [-0.62, 0.62]) brancos.push([x, y, t === 'caminhao' ? 1.3 : t === 'onibus' ? 0.75 : 0.62]);
  } else if (c.portador === 'helice') {
    const pas = f.filter((x) => x.tipo === 'pa'), h = pas[0]?.pos ?? [3.3, 0, 1.5];
    if (pas.length > 1) for (const p of pas) brancos.push([p.pos[0] - 1.2, p.pos[1] * 0.6, p.pos[2] - 0.9]);
    else brancos.push([h[0] - 0.6, 0, h[2] - 0.35]);
  } else if (c.portador === 'aviao') {
    const zc = s0.zPiso + (s0.altura - s0.zPiso) / 2;
    brancos.push([frente - 2.5, 0, zc - 0.8]);
    for (const a of f.filter((x) => x.id.startsWith('admissao'))) brancos.push([a.pos[0] + 2, a.pos[1] * 0.5, zc - 0.6]);
    vermelhos.push([0, 0, zc + 2.2]);
  } else if (c.portador === 'rotor') brancos.push([(c.rotorCfg?.posRotor[0] ?? 0.2) + 2.2, 0, 0.9]);
  return { brancos, vermelhos };
}

/** o modelo do portador atual */
export function montarModelo(c: ControlePassagem): Modelo {
  const rodas: Modelo['rodas'] = [], giros: Modelo['giros'] = [], corpo = c.corpo, f = c.fontes;
  const id = c.motorPreset ?? '', grupo = (g: THREE.Group) => g;
  const um = (g: THREE.Group): Modelo => ({ segmentos: [grupo(g)], rodas, giros });
  const s0 = corpo.segmentos[0];
  if (c.portador === 'carro') { const t = tipoCarro(c.motor, id); return um(carro(t.tipo, t.cor, rodas).sombras()); }
  if (c.portador === 'trem') {
    const tipo: TipoTrem = ['taurus', 'vectron'].includes(id) && c.motor === 'eletrico' ? 'eletrica' : corpo.nariz >= 8 ? 'bala' : ['frotaa', 'metropolis', 'flexity'].includes(id) ? 'metro' : 'unidade';
    const pint: Pintura = tipo === 'bala' ? { corpo: COR.branco, faixa: 0x2f5aa8, teto: COR.claro } : tipo === 'metro' ? { corpo: COR.prata, faixa: id === 'frotaa' ? 0x2f5aa8 : 0x3d8a4a, teto: COR.cinza }
      : tipo === 'eletrica' ? { corpo: 0x8f949a, faixa: 0xb8322a, teto: COR.cinza, frente: COR.vermelho } : id.startsWith('cptm') ? { corpo: COR.prata, faixa: 0xb8322a, teto: COR.cinza } : { corpo: COR.branco, faixa: corpo.nariz >= 5 ? 0xb8322a : 0x2f5aa8, teto: COR.cinza };
    return { segmentos: trem(tipo, corpo, f, pint, c.trem.carenagem, rodas), rodas, giros };
  }
  if (c.portador === 'locomotiva' && c.motor === 'vapor') { const v = trensVapor(id, corpo, f, rodas); return { segmentos: v.segs, rodas, giros, animar: v.animar, moveis: v.moveis }; }
  if (c.portador === 'locomotiva') return um(locomotivaDiesel(s0, f, id === 'ge7fdl' ? 0xd9d2c0 : 0xd9a520, rodas));
  if (c.portador === 'helice') {
    const helices = f.filter((x) => x.tipo === 'pa');
    return um(aviaoHelice(paramsHelice(c.motor, id), helices, giros, rodas).sombras());
  }
  if (c.portador === 'aviao') return um(jato(paramsJato(id, corpo.comprimento, c.vKmh > 1100), f, s0.zPiso + (s0.altura - s0.zPiso) / 2).sombras());
  if (c.portador === 'rotor') {
    const rc = c.rotorCfg ?? { R: 5, Rc: 0.8, B: 2, posRotor: [0.2, 0, 3.3] as const, posCauda: [-5.8, 0, 1.8] as const };
    const bolha = id === 'bell47', cor = id === 's55' ? 0x5b6338 : id === 'ae50r' ? 0x8f949a : COR.branco, cor2 = id === 'r44' || id === 'r22' ? 0xb8322a : 0x2f5aa8;
    return um(helicoptero(rc, cor, cor2, bolha, giros).sombras());
  }
  if (c.portador === 'drone') return um(drone(f, giros).sombras());
  if (c.portador === 'gerador') return um(c.motor === 'vapor' ? corliss(s0, f, giros) : geradorDiesel(s0, f, c.motor === 'rotativo' ? 0x3f444b : 0x2f7d4f));
  if (c.portador === 'trator') return um(tratorVapor(s0, f, rodas));
  if (c.portador === 'barco') return um(barcoVapor(s0, f, rodas));
  // (sem modelo próprio: as caixas dos segmentos)
  const xs = centros(corpo);
  return { segmentos: corpo.segmentos.map((s, k) => { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.BoxGeometry(s.comprimento, s.largura, s.altura - s.zPiso), new THREE.MeshLambertMaterial({ color: COR.cinza })); m.position.z = (s.altura + s.zPiso) / 2; g.add(m); void xs[k]; return g; }), rodas, giros };
}
