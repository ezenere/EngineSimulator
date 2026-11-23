// Cena 3D da Passagem, three.js, só na thread principal. Carregada sob demanda (import dinâmico na página): o áudio
// nunca espera por ela, e se o WebGL faltar a página segue sem 3D (o observador anda e ouve do mesmo jeito).
//
// Um lugar visto por uma pessoa: a câmera é o olho do observador (observador.ts; o ouvinte da Cena é o ouvido dele),
// em primeira pessoa, sem órbita. Tudo opaco: céu em degradê com o sol, luz do céu, neblina de distância; o chão na cor
// ou na textura do solo; a via (lastro, dormentes e trilhos; a estrada com as faixas); o túnel, a estação, o corte e a
// ponte com as medidas de lugar.ts (as mesmas em que o observador pisa); o corpo por segmento, com o vão entre eles,
// nariz e cauda afilados, truques, pantógrafo, rotor e hélice com as pás girando.
// A vista técnica (tecla T, desligada por padrão) acrescenta os marcadores das fontes e a linha da trajetória no ar.
//
// Mundo em metros, z para cima (o mesmo da Cena: a via passa ao longo de x, o ponto de chegada fica do lado −y).
// Modelos: geometria parametrizada com as dimensões do portador (PLANO.md, Recursos 3D). Texturas de solo CC0 da Poly
// Haven em public/3d/ (LICENSES.md), carregadas sem bloquear: se não chegarem, fica a cor lisa.
import * as THREE from 'three';
import type { ControlePassagem } from './controle';
import { COR_TIPO } from './cena3d-cores';
import { PontoVia } from '../../scene/trajetoria';
import type { Lugar } from './lugar';
import { PLATAFORMA, ESTACAO, PONTE, CORTE, LIMITE_LATERAL, TUNEL, SEGUNDA_VIA } from './lugar';
import { secaoTunel } from '../../scene/ambientes';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

const COR_SOLO: Record<string, number> = { asfalto: 0x3c3f44, concreto: 0x9a978f, brita: 0x8a7d68, grama: 0x5b7a3e, agua: 0x2f5f78, nenhum: 0x5b7a3e };
// céu de dia: azul no alto, claro e um pouco quente no horizonte; a neblina tem a cor do horizonte
const CEU_ZENITE = 0x3f73b8, CEU_HORIZONTE = 0xc9d8e4;
/** m: os dormentes são desenhados até esta distância de você, ao longo da via */
const DORMENTES_RAIO = 150;
const GRAMA = 0x5b7a3e, TERRA = 0x7d6a4c, CONCRETO = 0x9c9a94, CONCRETO_ESCURO = 0x6e6d68;
/** portadores a vapor com silhueta própria: a locomotiva a vapor, o trator e o barco */
const silhuetaVapor = (c: ControlePassagem) => (c.portador === 'locomotiva' && c.motor === 'vapor') || c.portador === 'trator' || c.portador === 'barco';
/** altura até onde a caixa do 1º segmento é desenhada nessas máquinas: o estrado da locomotiva, o chassi do trator, o casco */
const alturaEstrado = (c: ControlePassagem, s: { zPiso: number; altura: number }) => c.portador === 'barco' ? Math.min(s.altura, 2.2) : c.portador === 'trator' ? s.zPiso + 0.7 : s.zPiso + 1.0;

/**
 * Material difuso (Lambert) com sombreamento plano: o "low poly" não pede brilho, e o Lambert custa bem menos que o PBR
 * no WebGL em software e nos celulares (o quadro pesa no olho, não no som).
 */
const fosco = (cor: number, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color: cor, flatShading: true, ...extra });
/** as mesmas peças repetidas ao longo da via num InstancedMesh (uma chamada de desenho): luminárias, colunas, pilares */
function repetir(geo: THREE.BufferGeometry, mat: THREE.Material, pontos: { pos: readonly number[]; rumo: number }[]) {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, pontos.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p3 = new THREE.Vector3(), um = new THREE.Vector3(1, 1, 1);
  pontos.forEach((pt, i) => { e.set(0, 0, pt.rumo); q.setFromEuler(e); p3.set(pt.pos[0], pt.pos[1], pt.pos[2]); im.setMatrixAt(i, m.compose(p3, q, um)); });
  im.count = pontos.length;
  return im;
}

export class Cena3D {
  c: ControlePassagem;
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private estatico = new THREE.Group();
  private corpoG = new THREE.Group();
  private tecnicoG = new THREE.Group();
  private segs: { m: THREE.Object3D; xc: number }[] = [];
  private fontes3d: { id: string; pos: readonly number[]; m: THREE.Mesh; idx: number }[] = [];
  private ceu: THREE.Mesh; private sol: THREE.DirectionalLight; private discoSol: THREE.Mesh;
  private rotores: { o: THREE.Object3D; eixo: 'x' | 'y' | 'z'; k: number }[] = [];
  private chaveEstatico = ''; private chaveCorpo = '';
  private dormentes: { im: THREE.InstancedMesh; mv: number; s0: number; s1: number }[] = [];
  private dormentesEm = NaN;
  private texturas: Record<string, THREE.Texture | null> = {};
  private pv = new PontoVia();
  private ultimo = 0;
  private olho = { pos: [0, 0, 0] as [number, number, number], rumo: 0, arfagem: 0 };
  /** desenhou ao menos um quadro (o teste do navegador confere) */
  quadros = 0;
  vivo = true;

  constructor(canvas: HTMLCanvasElement, c: ControlePassagem) {
    this.c = c; this.canvas = canvas;
    // (antisserrilhado só em tela de densidade baixa: na de densidade alta ele custa caro e quase não se vê)
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: (window.devicePixelRatio || 1) < 1.5, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.scene.background = new THREE.Color(CEU_HORIZONTE);
    this.scene.fog = new THREE.Fog(CEU_HORIZONTE, 250, 5500);
    {
      // cúpula do céu com degradê do horizonte ao zênite, que anda com a câmera (sem neblina)
      const R = 9000, g = new THREE.SphereGeometry(R, 32, 20), p = g.attributes.position as THREE.BufferAttribute;
      const cores = new Float32Array(p.count * 3), a = new THREE.Color(CEU_HORIZONTE), b = new THREE.Color(CEU_ZENITE), k = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        // (a esfera do three.js tem o eixo em y; a cúpula é girada para o z do mundo)
        const h = Math.max(0, p.getY(i) / R);
        k.copy(a).lerp(b, Math.pow(h, 0.55)); cores[3 * i] = k.r; cores[3 * i + 1] = k.g; cores[3 * i + 2] = k.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(cores, 3));
      this.ceu = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
      this.ceu.rotation.x = Math.PI / 2; this.ceu.renderOrder = -10;
      this.scene.add(this.ceu);
    }
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 12000);
    this.camera.up.set(0, 0, 1);
    // luz do céu e o sol de meio da tarde, por trás e à direita de quem está no ponto de chegada olhando a via
    this.scene.add(new THREE.HemisphereLight(0xdfe9f5, 0x8a8170, 1.3));
    this.sol = new THREE.DirectionalLight(0xfff1dc, 2.1); this.sol.position.set(380, -560, 520); this.scene.add(this.sol, this.sol.target);
    this.discoSol = new THREE.Mesh(new THREE.CircleGeometry(160, 32), new THREE.MeshBasicMaterial({ color: 0xfff6e0, fog: false, depthWrite: false }));
    this.discoSol.renderOrder = -9;
    this.scene.add(this.discoSol);
    this.scene.add(this.estatico, this.corpoG, this.tecnicoG);
    this.carregarTexturas();
  }

  // ------------------------------------------------------------------ texturas (sob demanda)
  private carregarTexturas() {
    const base = import.meta.env.BASE_URL || './';
    const ld = new THREE.TextureLoader();
    // (só a brita do lastro usa textura; o concreto ficou na cor lisa, e a textura dele, em public/3d/, não é mais carregada)
    for (const [k, arq] of [['brita', 'brita_1k.jpg']] as const) {
      this.texturas[k] = null;
      ld.load(`${base}3d/texturas/${arq}`, (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        this.texturas[k] = t; this.chaveEstatico = '';    // remonta com a textura
      }, undefined, () => { /* sem textura: fica a cor lisa */ });
    }
  }
  private texturizado(k: 'brita' | 'concreto', cor: number, repeticao: number) {
    // (o concreto fica na cor lisa: a textura dele, multiplicada pela luz do céu, puxava para o marrom de terra; a brita
    // do lastro fica com a textura, que é o que faz a via parecer via)
    if (k === 'concreto') return fosco(cor, { flatShading: false });
    const t = this.texturas[k], m = fosco(t ? 0xd8d4cc : cor, { flatShading: false });
    if (t) { const tt = t.clone(); tt.needsUpdate = true; tt.repeat.set(repeticao, repeticao); m.map = tt; m.color.set(cor).lerp(new THREE.Color(0xffffff), 0.45); }
    return m;
  }

  // ------------------------------------------------------------------ cenário (muda com ambiente, via, solo)
  private montarEstatico() {
    const c = this.c, amb = c.ambienteCena(), t = c.traj, lg = c.lugar();
    const chave = JSON.stringify([amb.id, amb.solo.tipo, amb.tunel, t.tipo, t.comprimento, t.raioCurva, t.sentido, t.altitude > 2, c.portador, c.motor, c.corpo.segmentos[0]?.largura, !!this.texturas.brita, !!this.texturas.concreto]);
    if (chave === this.chaveEstatico) return;
    this.chaveEstatico = chave;
    descartar(this.estatico);
    this.dormentes = []; this.dormentesEm = NaN;
    const G = this.estatico, via = c.via, Lv = via.comp;
    const reta = t.tipo === 'reta';
    const s0 = reta ? -Lv / 2 : 0, s1 = reta ? Lv / 2 : Lv, passo = reta ? 40 : 4;
    const solo = amb.solo.tipo;
    const ponte = amb.id === 'ponte';
    const ferro = (c.portador === 'trem' || c.portador === 'locomotiva') && t.altitude <= 2;
    const estrada = (c.portador === 'carro' || c.portador === 'trator') && t.altitude <= 2;
    // chão: o vale embaixo da ponte; grama em volta da via e da estrada; a cor do solo no resto (água, concreto do pátio)
    {
      const ext = reta ? Lv + 2 * LIMITE_LATERAL + 1200 : 2 * (via.ls / 2 + via.R) + 2400, larg = reta ? 2 * LIMITE_LATERAL + 2400 : 2 * via.R + 2400;
      const cor = ponte ? 0x6f7a4a : ferro || estrada || solo === 'grama' || solo === 'nenhum' ? GRAMA : solo === 'agua' ? COR_SOLO.grama : COR_SOLO[solo] ?? GRAMA;
      const chao = new THREE.Mesh(new THREE.PlaneGeometry(ext, larg), fosco(cor, { flatShading: false }));
      chao.position.set(0, reta ? 0 : 0, ponte ? PONTE.vale : -0.02);
      G.add(chao);
      if (ponte) G.add(faixa(lg, s0, s1, passo, -40, 25, PONTE.vale + 0.05, PONTE.vale + 0.05, fosco(0x3c6a86)));   // o rio no fundo do vale
      if (solo === 'agua') G.add(faixa(lg, s0, s1, passo, -400, 12, 0.0, 0.0, fosco(COR_SOLO.agua)));
      if (solo === 'concreto' && !ponte && amb.id !== 'estacao' && amb.id !== 'tunel') G.add(faixa(lg, -25, 25, 5, -12, 25, 0.0, 0.0, this.texturizado('concreto', CONCRETO, 6)));
    }
    // via férrea: lastro, dormentes, trilhos (e a outra via onde o lugar é de via dupla: túnel e ponte)
    if (ferro) {
      const vias = ponte && lg.segundaViaNaPonte ? [0, SEGUNDA_VIA] : [0];
      for (const mv of vias) {
        G.add(prisma(lg, s0, s1, passo, [[mv - 2.4, 0], [mv - 1.6, 0.3], [mv + 1.6, 0.3], [mv + 2.4, 0]], solo === 'brita' || ferro ? this.texturizado('brita', COR_SOLO.brita, 1) : fosco(COR_SOLO.brita), false));
        for (const yo of [-0.7175, 0.7175]) G.add(prisma(lg, s0, s1, passo, [[mv + yo - 0.035, 0.46], [mv + yo + 0.035, 0.46], [mv + yo + 0.035, 0.31], [mv + yo - 0.035, 0.31]], fosco(0x9a9fa6), false));
        // dormentes a 0,6 m só perto de você (DORMENTES_RAIO para cada lado; mais longe eles somem no lastro): o trecho
        // anda junto quando você se afasta (recentrarDormentes)
        const dorm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.25, 2.6, 0.16), fosco(0x6b5f52), Math.ceil((2 * DORMENTES_RAIO) / 0.6) + 1);
        this.dormentes.push({ im: dorm, mv, s0, s1 });
        G.add(dorm);
      }
    }
    // estrada: duas faixas de 3,5 m, acostamento, faixa amarela no meio e brancas nas bordas
    if (estrada) {
      G.add(faixa(lg, s0, s1, passo, -5.6, 3.6, 0.02, 0.02, fosco(COR_SOLO.asfalto, { flatShading: false })));
      G.add(faixa(lg, s0, s1, passo, -5.35, -5.2, 0.035, 0.035, fosco(0xe8e6df)), faixa(lg, s0, s1, passo, 1.6, 1.75, 0.035, 0.035, fosco(0xe8e6df)));
      for (let s = Math.max(s0, -600); s < Math.min(s1, 600); s += 12) G.add(faixa(lg, s, s + 4, 4, -1.85, -1.7, 0.035, 0.035, fosco(0xe0b53a)));
      G.add(faixa(lg, s0, s1, passo, 3.6, 7.2, 0.025, 0.025, fosco(0x8a857a)));   // calçada de terra batida
    }
    // ambientes, com as medidas em que o observador pisa (lugar.ts)
    if (amb.tunel) {
      const sec = secaoTunel(amb.tunel.area), mP = -sec.paredeOuvinte, mL = -sec.paredeOposta, h = sec.altura;
      const ta = amb.tunel.xEntrada, tb = ta + amb.tunel.comprimento, p = reta ? 25 : 5;
      const parede = this.texturizado('concreto', 0xb8b3a9, 3);
      parede.emissive.set(0x2c2a26);   // (a luz das luminárias, sem custo de luz de verdade)
      parede.side = THREE.DoubleSide;
      // a parede do outro lado e o teto até o alto da parede do lado do observador; essa, por trechos, com os nichos de
      // refúgio no meio (TUNEL.nicho, os de lugar.ts)
      const pas = TUNEL.passarela, ni = TUNEL.nicho, topoNicho = pas + ni.altura, bo = lg.tun!.borda;
      G.add(prisma(lg, ta, tb, p, [[mL, 0], [mL, h], [mL + 0.6, h + 0.5], [mP - 0.6, h + 0.5], [mP, h], [mP, topoNicho]], parede, false, true));
      const nichos = lg.nichos(), trechos: [number, number][] = [];
      let ini = ta;
      for (const c of nichos) { trechos.push([ini, c - ni.largura / 2]); ini = c + ni.largura / 2; }
      trechos.push([ini, tb]);
      for (const [a, b] of trechos) if (b > a) G.add(prisma(lg, a, b, p, [[mP, topoNicho], [mP, 0]], parede, false, true));
      // os nichos: fundo, laterais e teto (uma malha só), cada um com a luminária e, a cada 100 m, a porta de emergência
      const nicho = new Malha(lg);
      for (const c of nichos) {
        const a = c - ni.largura / 2, b = c + ni.largura / 2, f = mP + ni.fundo;
        nicho.quad([a, f, pas], [b, f, pas], [b, f, topoNicho], [a, f, topoNicho]);       // fundo
        nicho.quad([a, mP, pas], [a, f, pas], [a, f, topoNicho], [a, mP, topoNicho]);      // laterais
        nicho.quad([b, mP, pas], [b, f, pas], [b, f, topoNicho], [b, mP, topoNicho]);
        nicho.quad([a, mP, topoNicho], [b, mP, topoNicho], [b, f, topoNicho], [a, f, topoNicho]);   // teto
        nicho.quad([a, mP, pas], [b, mP, pas], [b, f, pas], [a, f, pas]);                  // piso
      }
      if (nichos.length) G.add(nicho.mesh(parede));
      const porta = new Malha(lg);
      for (const c of nichos) if (Math.round(c / ni.cada) % 2 === 0) { const f = mP + ni.fundo - 0.04; porta.quad([c - 0.5, f, pas], [c + 0.5, f, pas], [c + 0.5, f, pas + 2.05], [c - 0.5, f, pas + 2.05]); }
      G.add(porta.mesh(fosco(0x2f7d4f)));
      // a passarela de serviço do lado do observador (o refúgio de onde se vê o trem), com a borda pintada e o corrimão
      // na parede (por trechos, entre os nichos)
      G.add(prisma(lg, ta, tb, p, [[bo, 0], [bo, pas], [mP, pas], [mP, 0]], fosco(0x9c9a94), true));
      G.add(faixa(lg, ta, tb, p, bo + 0.05, bo + 0.2, pas + 0.006, pas + 0.006, fosco(0xe2c23a)));
      for (const [a, b] of trechos) if (b > a) G.add(prisma(lg, a, b, p, [[mP - 0.12, pas + TUNEL.corrimao], [mP - 0.05, pas + TUNEL.corrimao], [mP - 0.05, pas + TUNEL.corrimao - 0.06], [mP - 0.12, pas + TUNEL.corrimao - 0.06]], fosco(0xd9b04a), true));
      // piso da via e as luminárias do teto (a cada 25 m, do lado das paredes) e uma em cada nicho
      G.add(faixa(lg, ta, tb, p, mL, bo, 0.01, 0.01, fosco(0x77746e)));
      const lum = fosco(0xfff4d6, { emissive: 0xfff0c8, emissiveIntensity: 1.2 }), pts: { pos: number[]; rumo: number }[] = [];
      for (let s = ta + 10; s < tb; s += 25) for (const mm of [mL + 0.45, mP - 0.45]) pts.push({ pos: lg.mundo(s, mm, h - 0.4), rumo: lg.rumoVia(s) });
      for (const c of nichos) pts.push({ pos: lg.mundo(c, mP + ni.fundo / 2, topoNicho - 0.1), rumo: lg.rumoVia(c) });
      G.add(repetir(new THREE.BoxGeometry(1.2, 0.18, 0.08), lum, pts));
      // bocas: a testa de concreto em volta da abertura
      for (const sx of [ta, tb]) G.add(prisma(lg, sx - (sx === ta ? 1.5 : 0), sx + (sx === ta ? 0 : 1.5), 1.5, [[mL - 3, 0], [mL - 3, h + 3], [mP + 3, h + 3], [mP + 3, 0], [mP, 0], [mP, h + 0.5], [mL, h + 0.5], [mL, 0]], fosco(CONCRETO_ESCURO), true));
    } else if (amb.id === 'estacao') {
      const bo = lg.bordaPlataforma, fu = bo + ESTACAO.largura + ESTACAO.fundo, a = ESTACAO.meio;
      G.add(prisma(lg, -a, a, 10, [[bo, 0], [bo, PLATAFORMA], [fu, PLATAFORMA], [fu, 0]], this.texturizado('concreto', CONCRETO, 4), true));
      G.add(faixa(lg, -a, a, 10, bo + 0.5, bo + 0.65, PLATAFORMA + 0.006, PLATAFORMA + 0.006, fosco(0xe2c23a)));   // faixa amarela
      G.add(prisma(lg, -a, a, 10, [[fu, 0], [fu, ESTACAO.teto], [fu + 0.4, ESTACAO.teto], [fu + 0.4, 0]], fosco(0x9a8f80), true));   // parede do fundo
      G.add(prisma(lg, -a - 4, a + 4, 10, [[-4.5, ESTACAO.teto], [-4.5, ESTACAO.teto + 0.35], [fu + 0.4, ESTACAO.teto + 0.35], [fu + 0.4, ESTACAO.teto]], fosco(0x858b92), true));   // cobertura
      const cols: { pos: number[]; rumo: number }[] = [], bancos: { pos: number[]; rumo: number }[] = [];
      for (let s = -a + 7.5; s <= a; s += 15) {
        cols.push({ pos: lg.mundo(s, bo + 6, PLATAFORMA + (ESTACAO.teto - PLATAFORMA) / 2), rumo: lg.rumoVia(s) });
        bancos.push({ pos: lg.mundo(s + 5, fu - 0.6, PLATAFORMA + 0.22), rumo: lg.rumoVia(s) });
      }
      G.add(repetir(new THREE.BoxGeometry(0.35, 0.35, ESTACAO.teto - PLATAFORMA), fosco(0x6d737a), cols), repetir(new THREE.BoxGeometry(1.8, 0.45, 0.45), fosco(0x7a5a3c), bancos));
    } else if (amb.id === 'corte') {
      const talude = fosco(TERRA);
      for (const sg of [-1, 1]) {
        G.add(prisma(lg, s0, s1, reta ? 50 : 5, sg > 0 ? [[CORTE.m0, 0], [CORTE.m1, CORTE.alto], [CORTE.m1, 0]] : [[-CORTE.m0, 0], [-CORTE.m1, 0], [-CORTE.m1, CORTE.alto]], talude, false));
        G.add(faixa(lg, s0, s1, reta ? 50 : 5, sg * CORTE.m1, sg * LIMITE_LATERAL * 1.5, CORTE.alto, CORTE.alto, fosco(GRAMA)));
      }
    } else if (ponte) {
      const mat = this.texturizado('concreto', CONCRETO, 3);
      G.add(prisma(lg, s0, s1, reta ? 50 : 5, [[PONTE.longe, 0], [PONTE.perto, 0], [PONTE.perto, -PONTE.espessura], [PONTE.longe, -PONTE.espessura]], mat, false));
      // o passeio de pedestres (o "acostamento" da ponte), com meio-fio, do lado do observador
      G.add(prisma(lg, s0, s1, reta ? 50 : 5, [[lg.passeio, 0], [lg.passeio, PONTE.meioFio], [PONTE.perto, PONTE.meioFio], [PONTE.perto, 0]], fosco(0xb0ada6), false));
      const guarda = fosco(0x8d9095);
      for (const [mA, mB, z0] of [[PONTE.longe, PONTE.longe + 0.25, 0], [PONTE.perto - 0.25, PONTE.perto, PONTE.meioFio]]) G.add(prisma(lg, s0, s1, reta ? 50 : 5, [[mA, z0], [mA, z0 + PONTE.guarda], [mB, z0 + PONTE.guarda], [mB, z0]], guarda, false));
      const pils: { pos: number[]; rumo: number }[] = [];
      for (let x = Math.ceil(Math.max(s0, -900) / 40) * 40; x <= Math.min(s1, 900); x += 40) pils.push({ pos: lg.mundo(x, (PONTE.perto + PONTE.longe) / 2, (PONTE.vale - PONTE.espessura) / 2), rumo: lg.rumoVia(x) });
      G.add(repetir(new THREE.BoxGeometry(2.4, PONTE.perto - PONTE.longe - 2, -PONTE.vale - PONTE.espessura), fosco(CONCRETO_ESCURO), pils));
    }
  }

  /** põe os dormentes em volta da abscissa s (de 100 em 100 m) */
  private recentrarDormentes(s: number) {
    const centro = Math.round(s / 100) * 100;
    if (centro === this.dormentesEm || !this.dormentes.length) return;
    this.dormentesEm = centro;
    const lg = this.c.lugar(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p3 = new THREE.Vector3(), um = new THREE.Vector3(1, 1, 1), w: [number, number, number] = [0, 0, 0];
    for (const d of this.dormentes) {
      const sa = Math.max(d.s0, centro - DORMENTES_RAIO), sb = Math.min(d.s1, centro + DORMENTES_RAIO);
      const n = Math.max(0, Math.min(d.im.instanceMatrix.count, Math.floor((sb - sa) / 0.6)));
      for (let i = 0; i < n; i++) {
        const sx = sa + i * 0.6;
        lg.mundo(sx, d.mv, 0.38, w);
        e.set(0, 0, lg.rumoVia(sx)); q.setFromEuler(e); p3.set(w[0], w[1], w[2]);
        d.im.setMatrixAt(i, m.compose(p3, q, um));
      }
      d.im.count = n; d.im.instanceMatrix.needsUpdate = true; d.im.computeBoundingSphere();
    }
  }

  // ------------------------------------------------------------------ corpo (muda com o portador)
  private montarCorpo() {
    const c = this.c, corpo = c.corpo;
    const chave = JSON.stringify([c.portador, c.motor, corpo.segmentos.length, corpo.comprimento, corpo.nariz, corpo.segmentos[0], c.fontes.length, c.trem.pantografos, c.trem.carenagem, c.vKmh > 1100]);
    if (chave === this.chaveCorpo) return;
    this.chaveCorpo = chave;
    descartar(this.corpoG); descartar(this.tecnicoG);
    this.segs = []; this.fontes3d = []; this.rotores = [];
    const corM = fosco(c.portador === 'rotor' ? 0xc9302c : c.portador === 'carro' ? 0x2f5aa8 : 0xeef0f2, { flatShading: false });
    const faixaM = fosco(0x1f5fbf);
    const janM = fosco(0x1b222b);
    const escM = fosco(0x2a2f36);
    let frente = corpo.comprimento / 2;
    const n = corpo.segmentos.length;
    corpo.segmentos.forEach((s, k) => {
      const xc = frente - s.comprimento / 2;
      const g = new THREE.Group();
      const nar = k === 0 ? Math.min(corpo.nariz, s.comprimento * 0.6) : 0, cau = k === n - 1 ? Math.min(corpo.cauda, s.comprimento * 0.6) : 0;
      // (locomotiva a vapor, trator e barco: a caixa do corpo só até o estrado, o casco ou o chassi; a caldeira, a
      // chaminé, a cabine e as rodas vêm da silhueta abaixo)
      const baixa = k === 0 && silhuetaVapor(c) ? alturaEstrado(c, s) : s.altura;
      g.add(new THREE.Mesh(geometriaSegmento(s.comprimento, s.largura, baixa, s.zPiso, nar, cau, c.portador === 'rotor'), corM));
      if (c.portador === 'trem') {
        // faixa azul e janelas nas duas faces (fora do trecho afilado)
        const x0 = -s.comprimento / 2 + cau + 0.5, x1 = s.comprimento / 2 - nar - 0.5;
        if (x1 > x0) for (const sg of [-1, 1]) {
          const fx = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.03, 0.18), faixaM); fx.position.set((x0 + x1) / 2, sg * (s.largura / 2 + 0.01), s.zPiso + 0.95); g.add(fx);
          const jn = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.03, 0.62), janM); jn.position.set((x0 + x1) / 2, sg * (s.largura / 2 + 0.01), s.zPiso + 1.75); g.add(jn);
        }
      } else if (c.portador === 'carro' && k === 0) {
        // vidros: a faixa escura da cabine
        for (const sg of [-1, 1]) { const jn = new THREE.Mesh(new THREE.BoxGeometry(s.comprimento * 0.42, 0.03, (s.altura - s.zPiso) * 0.3), janM); jn.position.set(-s.comprimento * 0.05, sg * (s.largura / 2 + 0.01), s.zPiso + (s.altura - s.zPiso) * 0.78); g.add(jn); }
      }
      this.corpoG.add(g); this.segs.push({ m: g, xc });
      frente -= s.comprimento + s.vao;
    });
    // truques e pantógrafos (trem)
    for (const f of c.fontes) {
      if (f.tipo === 'rolamento' && c.portador === 'trem') {
        const b = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.2, 0.55), escM); b.position.set(f.pos[0], 0, 0.36);
        this.anexar(b, f.pos[0]);
      } else if (f.tipo === 'pantografo') {
        const alt = corpo.segmentos[0].altura;
        const pz = new THREE.Group();
        const braco = (x0: number, z0: number, x1: number, z1: number) => { const l = Math.hypot(x1 - x0, z1 - z0); const m = new THREE.Mesh(new THREE.BoxGeometry(l, 0.06, 0.06), escM); m.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2); m.rotation.y = -Math.atan2(z1 - z0, x1 - x0); pz.add(m); };
        braco(-0.9, alt + 0.15, 0.7, alt + 0.85); braco(0.7, alt + 0.85, -0.3, f.pos[2]);    // o "Z"
        const cab = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.9, 0.06), escM); cab.position.set(-0.3, 0, f.pos[2]); pz.add(cab);
        if (c.trem.carenagem) { const car = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.2, 0.35), fosco(0xc8ccd2)); car.position.set(0, 0, alt + 0.17); pz.add(car); }
        pz.position.x = f.pos[0];
        this.anexar(pz, f.pos[0]);
      }
    }
    // pás opacas: n pás de comprimento r a partir do cubo, giradas no eixo dado
    const pas = (nPas: number, r: number, larg: number, eixo: 'x' | 'y' | 'z') => {
      const g = new THREE.Group(), geo = new THREE.BoxGeometry(r, larg, 0.04); geo.translate(r / 2, 0, 0);
      for (let b = 0; b < nPas; b++) { const p = new THREE.Mesh(geo, escM); p.rotation.z = (b * 2 * Math.PI) / nPas; g.add(p); }
      const cubo = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(0.06, r * 0.06), Math.max(0.06, r * 0.06), 0.2, 12), escM); cubo.rotation.x = Math.PI / 2; g.add(cubo);
      const h = new THREE.Group(); h.add(g);
      if (eixo === 'x') h.rotation.y = Math.PI / 2; else if (eixo === 'y') h.rotation.x = Math.PI / 2;
      return { h, g };
    };
    const rc = c.rotorCfg;
    if (rc) {
      const prin = pas(rc.B, rc.R, 0.27, 'z'); prin.h.position.set(rc.posRotor[0], rc.posRotor[1], rc.posRotor[2]);
      const cauda = pas(2, rc.Rc, 0.1, 'y'); cauda.h.position.set(rc.posCauda[0], rc.posCauda[1] + 0.3, rc.posCauda[2]);
      const lanca = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(rc.posCauda[0]) - 2, 0.3, 0.35), corM); lanca.position.set((rc.posCauda[0] - 2) / 2, 0, rc.posCauda[2] - 0.6);
      const mastro = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.9, 8), escM); mastro.rotation.x = Math.PI / 2; mastro.position.set(rc.posRotor[0], 0, rc.posRotor[2] - 0.45);
      const esqui = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.9, 0.06), escM); esqui.position.set(0, 0, 0.05);
      for (const o of [prin.h, cauda.h, lanca, mastro, esqui]) this.anexar(o, 0);
      // (rodam a 8% e 5% da rotação real: estroboscópico, para as pás se verem)
      this.rotores.push({ o: prin.g, eixo: 'z', k: 0.08 }, { o: cauda.g, eixo: 'z', k: 0.05 });
    }
    // silhueta: asas e empenagem nos aviões, hélice no nariz dos de hélice, rodas nos carros (medidas aproximadas,
    // tiradas do comprimento; a fuselagem e a carroceria são as do portador)
    const s0 = corpo.segmentos[0];
    if (s0 && (c.portador === 'helice' || c.portador === 'aviao')) {
      const L = corpo.comprimento, H = s0.altura - s0.zPiso, jato = c.portador === 'aviao', caca = jato && c.vKmh > 1100;
      const env = L * (caca ? 0.66 : jato ? 0.9 : 1.1), corda = L * (caca ? 0.32 : 0.14), zAsa = s0.zPiso + H * (jato ? 0.3 : 0.75);
      const asa = new THREE.Mesh(new THREE.BoxGeometry(corda, env, Math.max(0.06, H * 0.07)), corM); asa.position.set(caca ? -L * 0.12 : L * 0.04, 0, zAsa);
      const estab = new THREE.Mesh(new THREE.BoxGeometry(corda * 0.55, env * 0.36, Math.max(0.05, H * 0.05)), corM); estab.position.set(-L / 2 + corda * 0.4, 0, s0.zPiso + H * 0.7);
      const deriva = new THREE.Mesh(new THREE.BoxGeometry(corda * 0.75, Math.max(0.05, s0.largura * 0.06), L * 0.16), corM); deriva.position.set(-L / 2 + corda * 0.5, 0, s0.altura + L * 0.06);
      for (const o of [asa, estab, deriva]) this.anexar(o, 0);
      if (!jato) {
        // hélices: as fontes `pa` do portador (uma no nariz, ou uma por motor no turboélice)
        const helices = c.fontes.filter((f) => f.tipo === 'pa');
        for (const f of helices.length ? helices : [{ pos: [L / 2 + 0.05, 0, s0.zPiso + H * 0.5] }]) {
          const r = helices.length > 1 ? 1.95 : Math.max(0.9, H * 0.85);
          const p = pas(helices.length > 1 ? 6 : 3, r, 0.18, 'x'); p.h.position.set(Math.max(f.pos[0], helices.length > 1 ? f.pos[0] : L / 2 + 0.05), f.pos[1], f.pos[2]);
          this.anexar(p.h, L / 2);
          this.rotores.push({ o: p.g, eixo: 'z', k: 0.03 });
        }
      }
    } else if (s0 && c.portador === 'carro') {
      const L = corpo.comprimento, r = Math.min(0.55, Math.max(0.3, s0.altura * 0.24));
      for (const sx of [-0.31, 0.31]) for (const sy of [-1, 1]) {
        const roda = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.24, 20), escM); roda.position.set(sx * L, sy * (s0.largura / 2 - 0.06), r);
        this.anexar(roda, sx * L);
      }
    } else if (s0 && c.portador === 'drone') {
      for (const f of c.fontes.filter((x) => x.tipo === 'pa')) { const p = pas(2, 0.12, 0.025, 'z'); p.h.position.set(f.pos[0], f.pos[1], f.pos[2] + 0.02); this.anexar(p.h, 0); this.rotores.push({ o: p.g, eixo: 'z', k: 0.02 }); }
    } else if (s0 && silhuetaVapor(c)) {
      // as máquinas a vapor com as medidas do 1º segmento: caldeira deitada, chaminé, cabine ou casa de convés, rodas
      // (motrizes na locomotiva, de ferro no trator) ou as rodas de pás do barco
      const L = s0.comprimento, W = s0.largura, H = s0.altura, x0 = corpo.comprimento / 2 - L / 2, zE = alturaEstrado(c, s0);
      const pretoM = fosco(0x2b2e33, { flatShading: false });
      const cil = (r: number, comp: number, eixo: 'x' | 'y' | 'z', m: THREE.Material) => { const g = new THREE.Mesh(new THREE.CylinderGeometry(r, r, comp, 24), m); if (eixo === 'x') g.rotation.z = Math.PI / 2; else if (eixo === 'z') g.rotation.x = Math.PI / 2; return g; };
      const por = (o: THREE.Object3D, x: number, y: number, z: number) => { o.position.set(x, y, z); this.anexar(o, x); };
      if (c.portador === 'locomotiva') {
        const r = Math.min(0.42 * W, 0.22 * H), zc = Math.max(zE + r, H - r - 0.9);
        por(cil(r, 0.68 * L, 'x', pretoM), x0 + 0.12 * L, 0, zc);                                   // caldeira
        por(cil(0.3, H - zc - r + 0.1, 'z', pretoM), x0 + 0.4 * L, 0, zc + r + (H - zc - r) / 2 - 0.05);  // chaminé
        por(new THREE.Mesh(new THREE.BoxGeometry(0.2 * L, W, H - zE), corM), x0 - 0.4 * L, 0, zE + (H - zE) / 2);   // cabine
        const rm = Math.min(0.9, 0.18 * H), nR = 4;
        for (let i = 0; i < nR; i++) for (const sy of [-1, 1]) por(cil(rm, 0.16, 'y', escM), x0 - 0.22 * L + (i * 0.42 * L) / (nR - 1), sy * (W / 2 - 0.1), rm);
      } else if (c.portador === 'trator') {
        por(cil(0.45, 0.55 * L, 'x', pretoM), x0 + 0.05 * L, 0, zE + 0.55);                        // caldeira
        por(cil(0.16, 1.6, 'z', pretoM), x0 + 0.34 * L, 0, zE + 1.8);                              // chaminé
        por(new THREE.Mesh(new THREE.BoxGeometry(L * 0.9, W, 0.05), corM), x0 - 0.02 * L, 0, H);   // toldo
        for (const sx of [-0.4, 0.4]) for (const sy of [-1, 1]) por(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, H - zE), escM), x0 + sx * L, sy * (W / 2 - 0.1), zE + (H - zE) / 2);
        for (const sy of [-1, 1]) por(cil(0.85, 0.4, 'y', escM), x0 - 0.25 * L, sy * (W / 2 - 0.2), 0.85);   // rodas de trás
        for (const sy of [-1, 1]) por(cil(0.55, 0.25, 'y', escM), x0 + 0.33 * L, sy * (W / 2 - 0.35), 0.55);  // da frente
        por(cil(0.6, 0.1, 'y', pretoM), x0 - 0.02 * L, W / 2 + 0.1, zE + 1.2);                      // volante
      } else {
        // barco de rodas de pás: casa de convés, chaminé alta e as duas rodas de pás no meio
        por(new THREE.Mesh(new THREE.BoxGeometry(0.45 * L, 0.6 * W, 2.0), corM), x0 - 0.05 * L, 0, zE + 1.0);
        por(cil(0.45, 4.5, 'z', pretoM), x0 + 0.05 * L, 0, zE + 2.0 + 2.25);
        const rp = Math.min(2.6, 0.45 * H);
        for (const sy of [-1, 1]) { const d = cil(rp, 0.9, 'y', escM); por(d, x0, sy * (W / 2 + 0.5), rp * 0.6); }
      }
    }
    // vista técnica: marcadores das fontes (opacos), cor por tipo, raio pelo ganho
    const geo = new THREE.SphereGeometry(1, 14, 10);
    for (const f of c.fontes) {
      if (f.tipo === 'pressao') continue;
      const m = new THREE.Mesh(geo, fosco(COR_TIPO[f.tipo], { emissive: COR_TIPO[f.tipo], emissiveIntensity: 0.35, flatShading: false }));
      m.scale.setScalar(0.2);
      this.tecnicoG.add(m); this.fontes3d.push({ id: f.id, pos: f.pos, m, idx: -1 });
    }
    // e a trajetória (no ar, a linha na altitude)
    const lg = c.lugar(), pts: THREE.Vector3[] = [], Lv = c.via.comp, reta = c.traj.tipo === 'reta';
    for (let s = reta ? -Lv / 2 : 0; s <= (reta ? Lv / 2 : Lv); s += reta ? 20 : 4) { const w = lg.mundo(s, 0, c.traj.altitude + (corpo.segmentos[0]?.altura ?? 2) / 2); pts.push(new THREE.Vector3(w[0], w[1], w[2])); }
    const linha = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0x2f5aa8, dashSize: 6, gapSize: 4 }));
    linha.computeLineDistances();
    this.tecnicoG.add(linha);
  }
  /** peça presa ao segmento que contém x (referencial do corpo) */
  private anexar(o: THREE.Object3D, x: number) {
    let melhor = this.segs[0];
    for (const s of this.segs) if (Math.abs(s.xc - x) < Math.abs(melhor.xc - x)) melhor = s;
    o.position.x -= melhor.xc;
    melhor.m.add(o);
  }

  // ------------------------------------------------------------------ quadro
  /**
   * Resolução adaptativa: com o quadro pesado (WebGL em software, aparelho fraco) a densidade de pixels desce até 0,5 e
   * sobe de novo quando sobra tempo. O passo do observador e o som não dependem dela; o que ela poupa é o olho travando.
   */
  private densidadeMax = Math.min(2, window.devicePixelRatio || 1);
  private intervaloMs = 16;
  /** `ms`: o intervalo entre dois quadros (o custo de desenhar aparece nele, inclusive o que roda fora da chamada) */
  private ajustarDensidade(ms: number) {
    if (!(ms > 0) || ms > 1500) return;   // (a aba voltou do segundo plano: não conta)
    this.intervaloMs += (ms - this.intervaloMs) * 0.15;
    const d = this.renderer.getPixelRatio();
    let nova = d;
    if (this.intervaloMs > 45 && d > 0.5) nova = Math.max(0.5, d * 0.8);
    else if (this.intervaloMs < 20 && d < this.densidadeMax) nova = Math.min(this.densidadeMax, d * 1.1);
    if (Math.abs(nova - d) > 0.01) { this.renderer.setPixelRatio(nova); this.intervaloMs = Math.min(this.intervaloMs, 30); }
  }
  redimensionar() {
    const r = this.canvas.getBoundingClientRect(), w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    const cv = this.renderer.domElement;
    if (cv.width !== Math.round(w * this.renderer.getPixelRatio()) || cv.height !== Math.round(h * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false); this.camera.aspect = w / h;
      // (tela em pé, celular: o campo de visão vertical abre para o horizontal não ficar estreito demais)
      this.camera.fov = w / h < 0.9 ? 72 : 60;
      this.camera.updateProjectionMatrix();
    }
  }

  quadro(agora: number) {
    if (!this.vivo) return;
    if (agora - this.ultimo < 12) return;
    const dt = Math.min(0.1, (agora - this.ultimo) / 1000);
    if (this.ultimo > 0) this.ajustarDensidade(agora - this.ultimo);
    this.ultimo = agora;
    this.redimensionar();
    this.montarEstatico();
    this.montarCorpo();
    const c = this.c, { s } = c.estimativa(agora), tele = c.tele;
    this.recentrarDormentes(c.sOuvinte());
    // corpo
    for (const sg of this.segs) {
      const p = c.via.ponto(s + sg.xc, this.pv);
      sg.m.position.set(p.x, p.y, c.traj.altitude); sg.m.rotation.set(0, 0, Math.atan2(p.ty, p.tx));
    }
    // rotores e hélices girando (estroboscópico: uma fração da rotação real)
    if (this.rotores.length) {
      const rpm = Number(tele?.portador.Nr) || Number(tele?.portador.nHelice) || Number(tele?.portador.rpmHelice) || 400;
      for (const r of this.rotores) r.o.rotation.z += (rpm / 60) * 2 * Math.PI * dt * r.k;
    }
    // vista técnica
    this.tecnicoG.visible = c.vistaTecnica;
    if (c.vistaTecnica) {
      const tf = tele?.cena.fontes, tmp: [number, number, number] = [0, 0, 0];
      if (tf && this.fontes3d.length && this.fontes3d[0].idx < 0) for (const f3 of this.fontes3d) f3.idx = tf.findIndex((x) => x.id === f3.id);
      for (const f3 of this.fontes3d) {
        c.corpoNoMundo(s, f3.pos, tmp); f3.m.position.set(tmp[0], tmp[1], tmp[2]);
        const g = tf && f3.idx >= 0 && tf[f3.idx] ? tf[f3.idx].ganhoDb : -40;
        f3.m.scale.setScalar(0.15 + 0.25 * Math.min(1, Math.max(0, (g + 40) / 40)));
      }
    }
    // câmera: o olho do observador
    const o = c.olhoNoMundo(s, this.olho), cam = this.camera;
    cam.position.set(o.pos[0], o.pos[1], o.pos[2]);
    const ca = Math.cos(o.arfagem);
    cam.lookAt(o.pos[0] + ca * Math.cos(o.rumo), o.pos[1] + ca * Math.sin(o.rumo), o.pos[2] + Math.sin(o.arfagem));
    // neblina: voando alto, ela recua (o chão lá embaixo continua visível)
    const f = this.scene.fog as THREE.Fog, alto = Math.max(0, o.pos[2] - 30);
    f.near = 250 + alto * 2; f.far = 5500 + alto * 6;
    this.ceu.position.copy(cam.position);
    const ds = this.sol.position.clone().normalize();
    this.discoSol.position.copy(cam.position).addScaledVector(ds, 8500); this.discoSol.lookAt(cam.position);
    this.sol.target.position.copy(cam.position); this.sol.position.copy(cam.position).addScaledVector(ds, 800);
    this.renderer.render(this.scene, cam);
    this.quadros++;
  }

  descartar() {
    this.vivo = false;
    descartar(this.scene);
    this.renderer.dispose();
  }
}

// ------------------------------------------------------------------ geometria

/**
 * Casca de um segmento por seções (superelipse de expoente 5, "retângulo arredondado"), de −comp/2
 * (trás) a +comp/2 (frente). Com `nariz`/`cauda` > 0 a ponta afila: largura 1 − 0,45·t², teto que desce
 * a 25% da altura (o nariz de bico de pato de um Shinkansen) e a ponta fechada num ponto.
 */
export function geometriaSegmento(comp: number, larg: number, alt: number, zPiso: number, nariz: number, cauda: number, heli = false) {
  const K = 20, secoes: { x: number; w: number; zb: number; zt: number }[] = [];
  const H = alt - zPiso, zb0 = heli ? 0.5 : zPiso;
  const perfil = (t: number) => (heli ? { w: larg * (1 - 0.55 * t * t), zb: zb0 + 0.9 * t * t, zt: zb0 + (alt - zb0) * (1 - 0.55 * Math.pow(t, 1.5)) } : { w: larg * (1 - 0.45 * t * t), zb: zb0 + 0.25 * t * t, zt: zb0 + H * (1 - 0.75 * Math.pow(t, 1.3)) });
  const M = 14;
  if (cauda > 0) for (let i = M; i > 0; i--) { const t = i / M, p = perfil(t); secoes.push({ x: -comp / 2 + cauda * (1 - t), ...p }); }
  else secoes.push({ x: -comp / 2, w: larg, zb: zb0, zt: alt });
  if (cauda > 0) secoes.push({ x: -comp / 2 + cauda, w: larg, zb: zb0, zt: alt });
  if (nariz > 0) secoes.push({ x: comp / 2 - nariz, w: larg, zb: zb0, zt: alt });
  if (nariz > 0) for (let i = 1; i <= M; i++) { const t = i / M, p = perfil(t); secoes.push({ x: comp / 2 - nariz * (1 - t), ...p }); }
  else secoes.push({ x: comp / 2, w: larg, zb: zb0, zt: alt });
  const pos: number[] = [], idx: number[] = [];
  const anel = (s: (typeof secoes)[0]) => {
    const zc = (s.zb + s.zt) / 2, hh = (s.zt - s.zb) / 2;
    for (let j = 0; j < K; j++) {
      const a = (j / K) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      pos.push(s.x, (s.w / 2) * Math.sign(ca) * Math.pow(Math.abs(ca), 0.4), zc + hh * Math.sign(sa) * Math.pow(Math.abs(sa), 0.4));
    }
  };
  secoes.forEach(anel);
  for (let i = 0; i < secoes.length - 1; i++) for (let j = 0; j < K; j++) {
    const a = i * K + j, b = i * K + ((j + 1) % K), cc = (i + 1) * K + j, d = (i + 1) * K + ((j + 1) % K);
    // (a face olha para fora: o ângulo j cresce no sentido anti-horário visto de +x, e x cresce de uma seção para a outra)
    idx.push(a, b, cc, b, d, cc);
  }
  // tampas (fan a partir do centro da seção)
  const tampa = (i: number, frente: boolean) => {
    const s = secoes[i], c0 = pos.length / 3;
    pos.push(s.x, 0, (s.zb + s.zt) / 2);
    for (let j = 0; j < K; j++) { const a = i * K + j, b = i * K + ((j + 1) % K); if (frente) idx.push(c0, a, b); else idx.push(c0, b, a); }
  };
  tampa(0, false); tampa(secoes.length - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** malha montada por quadriláteros dados em coordenadas da via ([s, m, z] nos quatro cantos), num só desenho */
class Malha {
  private pos: number[] = []; private w: [number, number, number] = [0, 0, 0];
  constructor(private lg: Lugar) {}
  quad(...c: [number, number, number][]) {
    const p = c.map(([s, m, z]) => [...this.lg.mundo(s, m, z, this.w)]);
    for (const i of [0, 1, 2, 0, 2, 3]) this.pos.push(p[i][0], p[i][1], p[i][2]);
  }
  mesh(mat: THREE.Material) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos.length ? this.pos : [0, 0, 0, 0, 0, 0, 0, 0, 0], 3)); g.computeVertexNormals();
    if (mat instanceof THREE.MeshLambertMaterial) mat.side = THREE.DoubleSide;
    return new THREE.Mesh(g, mat);
  }
}

/** faixa ao longo da via entre as abscissas s0 e s1: de (m0, altura z0) a (m1, z1), opaca */
function faixa(lg: Lugar, s0: number, s1: number, passo: number, m0: number, m1: number, z0: number, z1: number, mat: THREE.Material) {
  const pos: number[] = [], idx: number[] = [], w: [number, number, number] = [0, 0, 0];
  const n = Math.max(1, Math.ceil((s1 - s0) / passo));
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n;
    lg.mundo(s, m0, z0, w); pos.push(w[0], w[1], w[2]);
    lg.mundo(s, m1, z1, w); pos.push(w[0], w[1], w[2]);
    if (i < n) { const a = 2 * i; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  // (a faixa é vista dos dois lados: a ordem dos vértices depende do sentido da via)
  if (mat instanceof THREE.MeshLambertMaterial) mat.side = THREE.DoubleSide;
  return new THREE.Mesh(g, mat);
}

/**
 * Prisma ao longo da via: a seção [m, z] (polígono, no sentido anti-horário visto de quem anda para s crescente)
 * extrudada de s0 a s1; `tampas` fecha as pontas; `aberta` não liga o último vértice ao primeiro (o túnel).
 */
function prisma(lg: Lugar, s0: number, s1: number, passo: number, secao: readonly (readonly [number, number])[], mat: THREE.Material, tampas: boolean, aberta = false) {
  const pos: number[] = [], idx: number[] = [], w: [number, number, number] = [0, 0, 0];
  const n = Math.max(1, Math.ceil((s1 - s0) / passo)), K = secao.length;
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n;
    for (const [m, z] of secao) { lg.mundo(s, m, z, w); pos.push(w[0], w[1], w[2]); }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < (aberta ? K - 1 : K); j++) {
    const a = i * K + j, b = i * K + ((j + 1) % K), c = (i + 1) * K + j, d = (i + 1) * K + ((j + 1) % K);
    idx.push(a, b, c, b, d, c);
  }
  if (tampas) for (const i of [0, n]) for (let j = 1; j < K - 1; j++) idx.push(i * K, i * K + j, i * K + j + 1);
  // (geometria não indexada por face, para o sombreamento plano do "low poly")
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const ng = g.toNonIndexed(); ng.computeVertexNormals(); g.dispose();
  if (mat instanceof THREE.MeshLambertMaterial) mat.side = THREE.DoubleSide;
  return new THREE.Mesh(ng, mat);
}

/** libera geometrias e materiais de um grupo e o esvazia */
function descartar(g: THREE.Object3D) {
  // (as texturas dos materiais são cópias, uma por material: vão junto; e as instâncias têm buffers próprios)
  const solta = (x: THREE.Material) => { (x as { map?: THREE.Texture | null }).map?.dispose(); x.dispose(); };
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    if (o instanceof THREE.InstancedMesh) o.dispose();
    const mat = (m as { material?: THREE.Material | THREE.Material[] }).material;
    if (Array.isArray(mat)) mat.forEach(solta); else if (mat) solta(mat);
  });
  if (g instanceof THREE.Scene) return;
  while (g.children.length) g.remove(g.children[0]);
}
