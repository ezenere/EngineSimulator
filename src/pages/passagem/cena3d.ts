// Cena 3D da Passagem (CENA.md 3.4), three.js, só na thread principal. Carregada sob demanda
// (import dinâmico na página): o áudio nunca espera por ela, e se o WebGL faltar a página segue sem 3D.
//
// Mundo em metros, z para cima (o mesmo da Cena: a via passa ao longo de x, o ouvinte fixo fica do lado
// −y). Elementos: chão com grade de 10 e 100 m e a cor/textura do solo; via (trilhos e dormentes a
// 0,6 m; no ar, linha tracejada); túnel, estação, corte ou ponte; o corpo por segmento, com o vão entre
// eles, nariz e cauda afilados, truques e pantógrafos (ou rotor); esferas das fontes coloridas por tipo e
// escaladas pelo ganho; o fantasma do corpo na posição de emissão; a cabeça do ouvinte com o nariz para
// o alvo, os arcos do gimbal e a linha até o alvo com a distância; o ponto mais próximo da via.
//
// Modelos: o trem-bala e o helicóptero são geometria parametrizada com as dimensões do portador (não há
// modelo aberto de vagão de trem-bala bom; PLANO.md, Recursos 3D). Texturas de solo CC0 da Poly Haven em
// public/3d/ (LICENSES.md), carregadas sem bloquear: se não chegarem, fica a cor lisa.
//
// Arrasto (raycast): cabeça (fixo: x e lateral no chão, Shift = altura; gimbal: azimute e distância,
// Shift = elevação, com passo de 5° e 0,5 m), anel do azimute, arco da elevação, linha da distância,
// corpo ao longo da via (posição s), alça da lateral da via e alça da altitude. Clique numa fonte: vira
// o alvo do gimbal e mostra a ficha. Tudo vai ao worklet pelo `atualizar()` da Cena (rampa de 20 ms).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { ControlePassagem } from './controle';
import type { FonteSonora } from '../../scene/tipos';
import { COR_TIPO } from './cena3d-cores';
import { nomeFonte } from './mostradores';
import { PontoVia } from '../../scene/trajetoria';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

const COR_SOLO: Record<string, number> = { asfalto: 0x3a3d42, concreto: 0x85837d, brita: 0x8f8069, grama: 0x47603d, agua: 0x2a5068, nenhum: 0x1a1f26 };
// céu de fim de tarde: escuro no alto (combina com a página), claro no horizonte, para o corpo e a via se recortarem
const CEU_ZENITE = 0x0f1828, CEU_HORIZONTE = 0x56667e;
/** nome curto de cada portador, para o rótulo do corpo na cena */
const NOME_CORPO: Record<string, string> = { trem: 'trem', rotor: 'helicóptero', carro: 'carro', helice: 'avião', gerador: 'gerador', locomotiva: 'locomotiva', aviao: 'avião', trator: 'trator', barco: 'barco', drone: 'drone' };
export type ModoCamera = 'ouvinte' | 'corpo' | 'livre';
export const NOME_CAMERA: Record<ModoCamera, string> = { ouvinte: 'orbital no ouvinte', corpo: 'segue o corpo', livre: 'livre' };

type Arrasto =
  | { tipo: 'cabeca'; alt: boolean } | { tipo: 'az' } | { tipo: 'el' } | { tipo: 'r' }
  | { tipo: 'corpo'; xGrab: number } | { tipo: 'lateral' } | { tipo: 'altitude' };

interface Fonte3D { f: FonteSonora; m: THREE.Mesh; idx: number }

export class Cena3D {
  c: ControlePassagem;
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  modo: ModoCamera = 'ouvinte';
  private estatico = new THREE.Group();
  private corpoG = new THREE.Group();
  private fantasmaG = new THREE.Group();
  private fontesG = new THREE.Group();
  private ouvinteG = new THREE.Group();
  private gimbalG = new THREE.Group();
  private segs: { m: THREE.Object3D; xc: number }[] = [];
  private segsF: { m: THREE.Object3D; xc: number }[] = [];
  private fontes3d: Fonte3D[] = [];
  private cabeca: THREE.Mesh; private narizCab: THREE.Mesh;
  private anelAz: THREE.Mesh; private arcoEl: THREE.Mesh; private linhaR: THREE.Line; private pegaR: THREE.Mesh;
  private rotuloR: THREE.Sprite; private textoR = '';
  private rotuloVoce: THREE.Sprite; private rotuloCorpo: THREE.Sprite; private textoCorpo = '';
  private rotuloFonte: THREE.Sprite; private textoFonte = '';
  private ceu: THREE.Mesh; private sombra: THREE.Mesh; private prumo: THREE.Line;
  private chaveQuadro = '';
  private alcaLateral: THREE.Mesh; private alcaAltitude: THREE.Mesh; private marcaProximo: THREE.Mesh;
  private rotores: THREE.Object3D[] = [];
  private chaveEstatico = ''; private chaveCorpo = '';
  private texturas: Record<string, THREE.Texture | null> = {};
  private ray = new THREE.Raycaster();
  private arrasto: Arrasto | null = null;
  private pv = new PontoVia();
  private ultimo = 0;
  private alvoAnt = new THREE.Vector3(); private temAlvoAnt = false;
  /** desenhou ao menos um quadro (o teste do navegador confere) */
  quadros = 0;
  aoMudarCamera: (() => void) | null = null;
  vivo = true;

  constructor(canvas: HTMLCanvasElement, c: ControlePassagem) {
    this.c = c; this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    // céu: cúpula com degradê do horizonte ao zênite, que anda com a câmera; a neblina tem a cor do horizonte
    this.scene.background = new THREE.Color(CEU_HORIZONTE);
    this.scene.fog = new THREE.Fog(CEU_HORIZONTE, 700, 7000);
    {
      const g = new THREE.SphereGeometry(9000, 32, 20), p = g.attributes.position as THREE.BufferAttribute;
      const cores = new Float32Array(p.count * 3), a = new THREE.Color(CEU_HORIZONTE), b = new THREE.Color(CEU_ZENITE), k = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        // (a esfera do three.js tem o eixo em y; a cúpula é girada para o z do mundo)
        const h = Math.max(0, p.getY(i) / 9000);
        k.copy(a).lerp(b, Math.pow(h, 0.45)); cores[3 * i] = k.r; cores[3 * i + 1] = k.g; cores[3 * i + 2] = k.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(cores, 3));
      this.ceu = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
      this.ceu.rotation.x = Math.PI / 2; this.ceu.renderOrder = -10;
      this.scene.add(this.ceu);
    }
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 20000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(-14, -28, 9);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.12;
    this.controls.maxDistance = 4000; this.controls.minDistance = 0.5;
    // luz do céu e um sol baixo do lado do ouvinte (a face do corpo que ele vê fica iluminada)
    this.scene.add(new THREE.HemisphereLight(0xcfdcf2, 0x4a4338, 1.25));
    const sol = new THREE.DirectionalLight(0xfff0dc, 1.9); sol.position.set(-350, -600, 520); this.scene.add(sol);
    this.scene.add(this.estatico, this.corpoG, this.fantasmaG, this.fontesG, this.ouvinteG, this.gimbalG);

    // ouvinte: cabeça (0,25 m) e nariz (cone) para o alvo
    this.cabeca = new THREE.Mesh(new THREE.SphereGeometry(0.25, 24, 16), new THREE.MeshStandardMaterial({ color: 0xdca54c, roughness: 0.5 }));
    this.narizCab = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 12), new THREE.MeshStandardMaterial({ color: 0xdca54c }));
    this.narizCab.geometry.rotateZ(-Math.PI / 2); this.narizCab.geometry.translate(0.3, 0, 0);
    this.cabeca.add(this.narizCab);
    this.cabeca.userData.pega = 'cabeca';
    this.ouvinteG.add(this.cabeca);
    // gimbal: anel de azimute, arco de elevação, linha até o alvo com a distância
    const matG = new THREE.MeshBasicMaterial({ color: 0xdca54c, transparent: true, opacity: 0.75, depthWrite: false });
    this.anelAz = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 6, 96), matG); this.anelAz.userData.pega = 'az';
    this.arcoEl = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 6, 64, (109 * Math.PI) / 180), new THREE.MeshBasicMaterial({ color: 0x7398e6, transparent: true, opacity: 0.85, depthWrite: false }));
    this.arcoEl.userData.pega = 'el';
    this.linhaR = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]), new THREE.LineDashedMaterial({ color: 0xe9e4d8, dashSize: 0.3, gapSize: 0.2 }));
    this.pegaR = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1, 8), new THREE.MeshBasicMaterial({ visible: false }));
    this.pegaR.userData.pega = 'r';
    this.rotuloR = rotulo('');
    this.gimbalG.add(this.anelAz, this.arcoEl, this.linhaR, this.pegaR, this.rotuloR);
    // rótulos: o ouvinte, o corpo (quando fica pequeno na tela) e a fonte escolhida
    this.rotuloVoce = rotulo('você'); this.rotuloCorpo = rotulo(''); this.rotuloFonte = rotulo('');
    this.rotuloCorpo.visible = false; this.rotuloFonte.visible = false;
    this.scene.add(this.rotuloVoce, this.rotuloCorpo, this.rotuloFonte);
    // corpo no ar: a sombra no chão e o prumo até ele, para se ver por onde ele passa mesmo fora do quadro
    this.sombra = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: 0x05070a, transparent: true, opacity: 0.42, depthWrite: false }));
    this.prumo = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]), new THREE.LineDashedMaterial({ color: 0xa8c4ff, dashSize: 3, gapSize: 3, transparent: true, opacity: 0.6 }));
    this.sombra.visible = false; this.prumo.visible = false;
    this.scene.add(this.sombra, this.prumo);
    // alças: lateral da via (no chão, entre a via e o ouvinte), altitude (acima do corpo), ponto mais próximo
    this.alcaLateral = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 4), new THREE.MeshStandardMaterial({ color: 0x48c26a, emissive: 0x123018 }));
    this.alcaLateral.geometry.rotateX(Math.PI / 2); this.alcaLateral.userData.pega = 'lateral';
    this.alcaAltitude = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1, 12), new THREE.MeshStandardMaterial({ color: 0x8fb3ff, emissive: 0x101c33 }));
    this.alcaAltitude.geometry.rotateX(Math.PI / 2); this.alcaAltitude.userData.pega = 'altitude';
    this.marcaProximo = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 32), new THREE.MeshBasicMaterial({ color: 0xdca54c, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
    this.scene.add(this.alcaLateral, this.alcaAltitude, this.marcaProximo);

    canvas.addEventListener('pointerdown', this.aoApertar);
    canvas.addEventListener('pointermove', this.aoMover);
    canvas.addEventListener('pointerup', this.aoSoltar);
    canvas.addEventListener('pointercancel', this.aoSoltar);
    canvas.addEventListener('keydown', this.aoTecla);
    this.carregarTexturas();
  }

  // ------------------------------------------------------------------ texturas (sob demanda)
  private carregarTexturas() {
    const base = import.meta.env.BASE_URL || './';
    const ld = new THREE.TextureLoader();
    for (const [k, arq] of [['brita', 'brita_1k.jpg'], ['concreto', 'concreto_1k.jpg']] as const) {
      this.texturas[k] = null;
      ld.load(`${base}3d/texturas/${arq}`, (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        this.texturas[k] = t; this.chaveEstatico = '';    // remonta o chão com a textura
      }, undefined, () => { /* sem textura: fica a cor lisa */ });
    }
  }

  // ------------------------------------------------------------------ cenário (muda com ambiente/via)
  private montarEstatico() {
    const c = this.c, amb = c.ambienteCena(), t = c.traj;
    const chave = JSON.stringify([amb.id, amb.solo.tipo, amb.tunel, t.tipo, t.comprimento, t.raioCurva, t.sentido, t.altitude > 0, c.portador, !!this.texturas.brita, !!this.texturas.concreto]);
    if (chave === this.chaveEstatico) return;
    this.chaveEstatico = chave;
    descartar(this.estatico);
    const G = this.estatico, via = c.via, Lv = via.comp;
    const reta = t.tipo === 'reta';
    const solo = amb.solo.tipo;
    // chão (a ponte não tem: o tabuleiro fica no alto e o vale lá embaixo)
    const ponte = amb.id === 'ponte';
    const ext = reta ? Lv + 800 : 2 * (via.ls / 2 + via.R) + 800, larg = reta ? 1600 : 2 * via.R + 800;
    const cy = reta ? 0 : 0;
    {
      const tex = solo === 'brita' ? this.texturas.brita : solo === 'concreto' || solo === 'asfalto' ? this.texturas.concreto : null;
      // (com a textura a cor é um cinza médio: em branco o chão estourava com a luz do céu e do sol)
      const mat = new THREE.MeshStandardMaterial({ color: ponte ? 0x22303a : tex ? 0xd6d2ca : COR_SOLO[solo] ?? 0x555555, roughness: 0.95 });
      if (tex && !ponte) { const tt = tex.clone(); tt.needsUpdate = true; tt.repeat.set(ext / 6, larg / 6); mat.map = tt; if (solo === 'asfalto') mat.color.set(0x70737a); }
      const chao = new THREE.Mesh(new THREE.PlaneGeometry(ext, larg), mat);
      chao.position.set(0, cy, ponte ? -28 : -0.01);
      G.add(chao);
      // grades de 10 m e de 100 m: dão a escala do lugar
      const g1 = new THREE.GridHelper(1000, 100, 0x1c2128, 0x1c2128); g1.rotateX(Math.PI / 2); g1.position.z = ponte ? -27.98 : 0.005;
      const g2 = new THREE.GridHelper(4000, 40, 0x14181e, 0x14181e); g2.rotateX(Math.PI / 2); g2.position.z = ponte ? -27.97 : 0.01;
      (g1.material as THREE.Material).transparent = true; (g1.material as THREE.Material).opacity = 0.22;
      (g2.material as THREE.Material).transparent = true; (g2.material as THREE.Material).opacity = 0.4;
      G.add(g1, g2);
    }
    const s0 = reta ? -Lv / 2 : 0, s1 = reta ? Lv / 2 : Lv;
    const aereo = c.portador === 'rotor' || t.altitude > 0;
    if (c.portador === 'trem' && !aereo) {
      // via: dois trilhos (bitola 1,435 m) e dormentes a 0,6 m (só perto do ouvinte, ±600 m)
      const passo = reta ? 20 : 4;
      for (const yo of [-0.7175, 0.7175]) G.add(linhaVia(c, s0, s1, passo, yo, 0.17, 0x9aa1aa));
      const sa = Math.max(s0, -600), sb = Math.min(s1, 600), n = Math.floor((sb - sa) / 0.6);
      const dorm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.25, 2.6, 0.16), new THREE.MeshStandardMaterial({ color: 0x6b6258, roughness: 1 }), n);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p3 = new THREE.Vector3(), um = new THREE.Vector3(1, 1, 1);
      for (let i = 0; i < n; i++) {
        const p = via.ponto(sa + i * 0.6, this.pv);
        e.set(0, 0, Math.atan2(p.ty, p.tx)); q.setFromEuler(e); p3.set(p.x, p.y, 0.08);
        dorm.setMatrixAt(i, m.compose(p3, q, um));
      }
      G.add(dorm);
      // lastro (faixa de brita sob a via)
      G.add(faixa(c, s0, s1, reta ? 50 : 4, -2.2, 2.2, 0.02, 0.02, 0x7d705e, 1));
    } else if (aereo) {
      // trajetória no ar: linha tracejada na altitude e a projeção no chão
      const l = linhaVia(c, s0, s1, reta ? 20 : 4, 0, t.altitude, 0x8fb3ff, true);
      G.add(l, linhaVia(c, s0, s1, reta ? 20 : 4, 0, 0.03, 0x3d4b63));
    }
    // ambientes
    if (amb.tunel) {
      // tubo de seção quadrada da área do túnel, semitransparente, da boca até a outra boca
      const a = Math.sqrt(amb.tunel.area), ta = amb.tunel.xEntrada, tb = ta + amb.tunel.comprimento, p = reta ? 25 : 5;
      const mat = 0x7f8794;
      G.add(faixa(c, ta, tb, p, -a / 2, -a / 2, 0, a, mat, 0.28), faixa(c, ta, tb, p, a / 2, a / 2, 0, a, mat, 0.28), faixa(c, ta, tb, p, -a / 2, a / 2, a, a, mat, 0.18));
      for (const sx of [ta, tb]) { const b = faixa(c, sx, sx + 3, 3, -a / 2 - 2, a / 2 + 2, a, a + 1.5, 0x59616e, 0.9); G.add(b); }
    } else if (amb.id === 'estacao') {
      // plataforma do lado do ouvinte, cobertura a 7 m e parede do fundo
      const lado = -(c.corpo.segmentos[0]?.largura ?? 3) / 2 - 0.35;
      G.add(faixa(c, -160, 160, 10, lado - 8, lado, 0.25, 0.25, 0x9a9890, 1));
      G.add(faixa(c, -160, 160, 10, lado - 10, 4, 7, 7, 0x59616e, 0.35));
      G.add(faixa(c, -160, 160, 10, lado - 10, lado - 10, 0, 7, 0x434b57, 0.6));
      for (let x = -150; x <= 150; x += 15) { const col = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 7), new THREE.MeshStandardMaterial({ color: 0x6b7280 })); const p = c.via.ponto(x, this.pv); col.position.set(p.x + (lado - 6) * p.nx, p.y + (lado - 6) * p.ny, 3.5); G.add(col); }
    } else if (amb.id === 'corte') {
      // trincheira: taludes a 45° a partir de 8 m do eixo
      G.add(faixa(c, s0, s1, reta ? 50 : 5, -8, -20, 0, 12, 0x6f6450, 0.95), faixa(c, s0, s1, reta ? 50 : 5, 8, 20, 0, 12, 0x6f6450, 0.95));
    } else if (amb.id === 'ponte') {
      // tabuleiro de 3,7 m para cada lado do eixo (o que reflete) e pilares a cada 40 m
      G.add(faixa(c, s0, s1, reta ? 50 : 5, -3.7, 3.7, -0.02, -0.02, 0x8d8b85, 1), faixa(c, s0, s1, reta ? 50 : 5, -3.7, 3.7, -1.6, -1.6, 0x59616e, 1));
      for (let x = Math.ceil(Math.max(s0, -800) / 40) * 40; x <= Math.min(s1, 800); x += 40) { const pil = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 26.4), new THREE.MeshStandardMaterial({ color: 0x6b7280 })); const p = c.via.ponto(x, this.pv); pil.position.set(p.x, p.y, -14.8); G.add(pil); }
    }
  }

  // ------------------------------------------------------------------ corpo (muda com o portador)
  private montarCorpo() {
    const c = this.c, corpo = c.corpo;
    const chave = JSON.stringify([c.portador, corpo.segmentos.length, corpo.comprimento, corpo.nariz, corpo.segmentos[0], c.fontes.length, c.trem.pantografos, c.trem.carenagem]);
    if (chave === this.chaveCorpo) return;
    this.chaveCorpo = chave;
    descartar(this.corpoG); descartar(this.fantasmaG); descartar(this.fontesG);
    this.segs = []; this.segsF = []; this.fontes3d = []; this.rotores = [];
    const corM = new THREE.MeshStandardMaterial({ color: c.portador === 'rotor' ? 0xc9302c : 0xeef0f2, roughness: 0.35, metalness: 0.15 });
    const fanM = new THREE.MeshBasicMaterial({ color: 0xa8c4ff, transparent: true, opacity: 0.13, depthWrite: false });
    const faixaM = new THREE.MeshStandardMaterial({ color: 0x1f5fbf, roughness: 0.4 });
    const janM = new THREE.MeshStandardMaterial({ color: 0x1b222b, roughness: 0.2, metalness: 0.5 });
    const escM = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.8 });
    let frente = corpo.comprimento / 2;
    const n = corpo.segmentos.length;
    corpo.segmentos.forEach((s, k) => {
      const xc = frente - s.comprimento / 2;
      const g = new THREE.Group();
      const nar = k === 0 ? Math.min(corpo.nariz, s.comprimento * 0.6) : 0, cau = k === n - 1 ? Math.min(corpo.cauda, s.comprimento * 0.6) : 0;
      const casca = new THREE.Mesh(geometriaSegmento(s.comprimento, s.largura, s.altura, s.zPiso, nar, cau, c.portador === 'rotor'), corM);
      casca.userData.pega = 'corpo'; casca.userData.xc = xc;
      g.add(casca);
      if (c.portador === 'trem') {
        // faixa azul e janelas nas duas faces (fora do trecho afilado)
        const x0 = -s.comprimento / 2 + cau + 0.5, x1 = s.comprimento / 2 - nar - 0.5;
        if (x1 > x0) for (const sg of [-1, 1]) {
          const fx = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.03, 0.18), faixaM); fx.position.set((x0 + x1) / 2, sg * (s.largura / 2 + 0.01), s.zPiso + 0.95); g.add(fx);
          const jn = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.03, 0.62), janM); jn.position.set((x0 + x1) / 2, sg * (s.largura / 2 + 0.01), s.zPiso + 1.75); g.add(jn);
        }
      }
      this.corpoG.add(g); this.segs.push({ m: g, xc });
      const gf = new THREE.Mesh(casca.geometry, fanM); const gg = new THREE.Group(); gg.add(gf);
      this.fantasmaG.add(gg); this.segsF.push({ m: gg, xc });
      frente -= s.comprimento + s.vao;
    });
    // truques e pantógrafos (trem); rotor e cauda (helicóptero)
    for (const f of c.fontes) {
      if (f.tipo === 'rolamento') {
        const b = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.2, 0.55), escM); b.position.set(f.pos[0], 0, 0.36);
        this.anexar(b, f.pos[0]);
      } else if (f.tipo === 'pantografo') {
        const alt = corpo.segmentos[0].altura;
        const pz = new THREE.Group();
        const braco = (x0: number, z0: number, x1: number, z1: number) => { const l = Math.hypot(x1 - x0, z1 - z0); const m = new THREE.Mesh(new THREE.BoxGeometry(l, 0.06, 0.06), escM); m.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2); m.rotation.y = -Math.atan2(z1 - z0, x1 - x0); pz.add(m); };
        braco(-0.9, alt + 0.15, 0.7, alt + 0.85); braco(0.7, alt + 0.85, -0.3, f.pos[2]);    // o "Z"
        const cab = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.9, 0.06), escM); cab.position.set(-0.3, 0, f.pos[2]); pz.add(cab);
        if (c.trem.carenagem) { const car = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.2, 0.35), new THREE.MeshStandardMaterial({ color: 0xc8ccd2 })); car.position.set(0, 0, alt + 0.17); pz.add(car); }
        pz.position.x = f.pos[0];
        this.anexar(pz, f.pos[0]);
      }
    }
    const rc = c.rotorCfg;
    if (rc) {
      const disco = (r: number) => new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshBasicMaterial({ color: 0xbfd3ff, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
      const pa = (r: number, l: number) => new THREE.Mesh(new THREE.BoxGeometry(l, r, 0.03), escM);
      const prin = new THREE.Group(); prin.add(disco(rc.R)); for (let b = 0; b < rc.B; b++) { const p = pa(0.27, rc.R * 2); p.rotation.z = (b * Math.PI) / rc.B; prin.add(p); }
      prin.position.set(rc.posRotor[0], rc.posRotor[1], rc.posRotor[2]);
      const cauda = new THREE.Group(); const dc = disco(rc.Rc); dc.rotation.x = Math.PI / 2; cauda.add(dc); const pc = pa(0.1, rc.Rc * 2); pc.rotation.x = Math.PI / 2; cauda.add(pc);
      cauda.position.set(rc.posCauda[0], rc.posCauda[1] + 0.3, rc.posCauda[2]);
      const lanca = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(rc.posCauda[0]) - 2, 0.3, 0.35), corM); lanca.position.set((rc.posCauda[0] - 2) / 2, 0, rc.posCauda[2] - 0.6);
      const mastro = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.9, 8), escM); mastro.rotation.x = Math.PI / 2; mastro.position.set(rc.posRotor[0], 0, rc.posRotor[2] - 0.45);
      const esqui = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.9, 0.06), escM); esqui.position.set(0, 0, 0.05);
      for (const o of [prin, cauda, lanca, mastro, esqui]) this.anexar(o, 0);
      this.rotores = [prin, cauda];
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
        const disco = new THREE.Mesh(new THREE.CircleGeometry(Math.max(0.9, H * 0.85), 40), new THREE.MeshBasicMaterial({ color: 0xbfd3ff, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }));
        disco.rotation.y = Math.PI / 2; disco.position.set(L / 2 + 0.05, 0, s0.zPiso + H * 0.5);
        this.anexar(disco, L / 2);
      }
    } else if (s0 && c.portador === 'carro') {
      const L = corpo.comprimento, r = Math.min(0.55, Math.max(0.3, s0.altura * 0.24));
      for (const sx of [-0.31, 0.31]) for (const sy of [-1, 1]) {
        const roda = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.24, 20), escM); roda.position.set(sx * L, sy * (s0.largura / 2 - 0.06), r);
        this.anexar(roda, sx * L);
      }
    }
    // fontes: esferas de 0,2 m por tipo (o raio segue o ganho)
    const geo = new THREE.SphereGeometry(1, 16, 12);
    c.fontes.forEach((f) => {
      if (f.tipo === 'pressao') return;
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: COR_TIPO[f.tipo], emissive: COR_TIPO[f.tipo], emissiveIntensity: 0.35, roughness: 0.4 }));
      m.scale.setScalar(0.2); m.userData.pega = 'fonte'; m.userData.id = f.id;
      this.fontesG.add(m); this.fontes3d.push({ f, m, idx: -1 });
    });
  }
  /** peça presa ao segmento que contém x (referencial do corpo) */
  private anexar(o: THREE.Object3D, x: number) {
    let melhor = this.segs[0];
    for (const s of this.segs) if (Math.abs(s.xc - x) < Math.abs(melhor.xc - x)) melhor = s;
    o.position.x -= melhor.xc;
    melhor.m.add(o);
  }

  // ------------------------------------------------------------------ quadro
  redimensionar() {
    const r = this.canvas.getBoundingClientRect(), w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    const cv = this.renderer.domElement;
    if (cv.width !== Math.round(w * this.renderer.getPixelRatio()) || cv.height !== Math.round(h * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    }
  }

  quadro(agora: number) {
    if (!this.vivo) return;
    if (agora - this.ultimo < 30 && !this.arrasto) return;   // ~30 fps
    this.ultimo = agora;
    this.redimensionar();
    this.montarEstatico();
    this.montarCorpo();
    const c = this.c, { s, v } = c.estimativa(agora), tele = c.tele;
    // corpo e fantasma
    const posAt = (seg: { m: THREE.Object3D; xc: number }, sx: number) => {
      const p = c.via.ponto(sx + seg.xc, this.pv);
      seg.m.position.set(p.x, p.y, c.traj.altitude); seg.m.rotation.set(0, 0, Math.atan2(p.ty, p.tx));
    };
    for (const sg of this.segs) posAt(sg, s);
    // fantasma: o corpo onde estava quando saiu o som que se ouve agora (atraso da fonte alvo, ou da mais próxima)
    const tf = tele?.cena.fontes;
    let atraso = 0;
    if (tf && tf.length) {
      const alvo = c.ouv.gimbal.alvo, ficha = c.fonteFicha ?? alvo;
      let i = tf.findIndex((x) => x.id === ficha);
      if (i < 0) { i = 0; for (let k = 1; k < tf.length; k++) if (tf[k].r < tf[i].r) i = k; }
      atraso = tf[i].atrasoMs / 1000;
    }
    const sF = s - v * atraso;
    this.fantasmaG.visible = Math.abs(v) * atraso > 0.3;
    for (const sg of this.segsF) posAt(sg, sF);
    // rotores girando na rotação real
    if (this.rotores.length && tele) {
      const nr = Number(tele.portador.Nr) || 408, dt = 0.03;
      this.rotores[0].rotation.z += (nr / 60) * 2 * Math.PI * dt * 0.08;   // estroboscópico: 8% da rotação real, para ver as pás
      this.rotores[1].rotation.y += (nr / 60) * 2 * Math.PI * dt * 0.05;
    }
    // fontes: posição no corpo e raio pelo ganho instantâneo (r = 0,15 + 0,25·clamp((g + 40)/40))
    if (tf && this.fontes3d.length && this.fontes3d[0].idx < 0) for (const f3 of this.fontes3d) f3.idx = tf.findIndex((x) => x.id === f3.f.id);
    const w = new THREE.Vector3(), tmp: [number, number, number] = [0, 0, 0];
    for (const f3 of this.fontes3d) {
      c.corpoNoMundo(s, f3.f.pos, tmp); f3.m.position.set(tmp[0], tmp[1], tmp[2]);
      const g = tf && f3.idx >= 0 && tf[f3.idx] ? tf[f3.idx].ganhoDb : -40;
      let r = 0.15 + 0.25 * Math.min(1, Math.max(0, (g + 40) / 40));
      if (f3.f.id === c.fonteFicha) r *= 1.6;
      f3.m.scale.setScalar(r);
    }
    // ouvinte
    const o = c.ouvinteNoMundo(s);
    this.cabeca.position.set(o[0], o[1], o[2]);
    const gimbal = c.ouv.modo === 'gimbal';
    const alvoW = gimbal ? c.corpoNoMundo(s, c.alvoCorpo()) : [o[0], o[1] + 10, o[2]];
    this.cabeca.rotation.set(0, 0, Math.atan2(alvoW[1] - o[1], alvoW[0] - o[0]));
    // gimbal: anel no plano horizontal do alvo, arco de elevação no azimute, linha com a distância
    this.gimbalG.visible = gimbal;
    if (gimbal) {
      const gg = c.ouv.gimbal, rumo = this.rumo(s), el = (gg.el * Math.PI) / 180, az = (gg.az * Math.PI) / 180;
      const rh = Math.max(0.05, gg.r * Math.cos(el));
      this.anelAz.position.set(alvoW[0], alvoW[1], alvoW[2]); this.anelAz.scale.set(rh, rh, 1); this.anelAz.rotation.set(0, 0, 0);
      this.arcoEl.position.set(alvoW[0], alvoW[1], alvoW[2]); this.arcoEl.scale.set(gg.r, gg.r, gg.r);
      // toro no plano xy, de 0 a 109° → gira para o plano vertical do azimute e começa em −20°
      this.arcoEl.rotation.set(0, 0, 0); this.arcoEl.rotateZ(rumo + az); this.arcoEl.rotateX(Math.PI / 2); this.arcoEl.rotateZ((-20 * Math.PI) / 180);
      const pos = this.linhaR.geometry.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, alvoW[0], alvoW[1], alvoW[2]); pos.setXYZ(1, o[0], o[1], o[2]); pos.needsUpdate = true;
      this.linhaR.computeLineDistances(); this.linhaR.geometry.computeBoundingSphere();
      const a = new THREE.Vector3(alvoW[0], alvoW[1], alvoW[2]), b = new THREE.Vector3(o[0], o[1], o[2]);
      this.pegaR.position.copy(a).add(b).multiplyScalar(0.5); this.pegaR.scale.set(1, a.distanceTo(b), 1);
      this.pegaR.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), w.copy(b).sub(a).normalize());
      const txt = `${gg.r.toFixed(1).replace('.', ',')} m`;
      if (txt !== this.textoR) { this.textoR = txt; trocarRotulo(this.rotuloR, txt); }
      this.rotuloR.position.copy(this.pegaR.position).add(new THREE.Vector3(0, 0, 0.4));
      const esc = Math.max(0.6, this.camera.position.distanceTo(this.rotuloR.position) * 0.04);
      this.rotuloR.scale.set(esc * 2.4, esc * 0.6, 1);
    }
    // alças: lateral (no chão, entre a via e o ouvinte fixo), altitude (acima do centro do corpo)
    const largura = c.corpo.segmentos[0]?.largura ?? 2;
    const fixo = c.ouv.modo === 'fixo';
    this.alcaLateral.visible = fixo; this.marcaProximo.visible = fixo;
    if (fixo) {
      const yv = c.via.yOuvinte, yl = yv - largura / 2 - c.traj.lateral / 2;
      this.alcaLateral.position.set(o[0], yl, 0.45);
      const pp = c.via.ponto(c.sOuvinte(), this.pv);
      this.marcaProximo.position.set(pp.x, pp.y, c.traj.altitude + 0.05);
    }
    const cc = c.corpoNoMundo(s, [0, 0, (c.corpo.segmentos[0]?.altura ?? 2) + 2.5], tmp);
    this.alcaAltitude.position.set(cc[0], cc[1], cc[2]);
    // corpo no ar: sombra no chão e prumo até ele
    const noAr = c.traj.altitude > 2 && c.ambienteCena().id !== 'ponte';
    this.sombra.visible = noAr; this.prumo.visible = noAr;
    if (noAr) {
      const rs = Math.max(1.2, c.corpo.comprimento * 0.3);
      this.sombra.position.set(cc[0], cc[1], 0.06); this.sombra.scale.setScalar(rs);
      const pp = this.prumo.geometry.attributes.position as THREE.BufferAttribute;
      pp.setXYZ(0, cc[0], cc[1], 0.06); pp.setXYZ(1, cc[0], cc[1], c.traj.altitude); pp.needsUpdate = true;
      this.prumo.computeLineDistances(); this.prumo.geometry.computeBoundingSphere();
    }
    // câmera
    this.enquadrar(s);
    this.seguirCamera(gimbal ? null : o, s);
    this.controls.update();
    // marcas com tamanho mínimo na tela: longe, a cabeça do ouvinte, as alças e a sombra não somem
    const mPorPx = (p: THREE.Vector3) => (2 * this.camera.position.distanceTo(p) * Math.tan((this.camera.fov * Math.PI) / 360)) / Math.max(1, this.canvas.clientHeight);
    this.cabeca.scale.setScalar(Math.max(1, (mPorPx(this.cabeca.position) * 7) / 0.25));
    this.alcaLateral.scale.setScalar(Math.max(1, (mPorPx(this.alcaLateral.position) * 9) / 0.45));
    this.alcaAltitude.scale.setScalar(Math.max(1, (mPorPx(this.alcaAltitude.position) * 9) / 0.5));
    this.marcaProximo.scale.setScalar(Math.max(1, (mPorPx(this.marcaProximo.position) * 9) / 1.15));
    if (noAr) this.sombra.scale.setScalar(Math.max(this.sombra.scale.x, mPorPx(this.sombra.position) * 6));
    // rótulos (sprites de tamanho fixo na tela)
    const porRotulo = (sp: THREE.Sprite, p: THREE.Vector3, acima: number) => {
      const u = mPorPx(p);
      sp.position.set(p.x, p.y, p.z + acima + u * 16); sp.scale.set(u * 96, u * 24, 1);
    };
    porRotulo(this.rotuloVoce, this.cabeca.position, 0.25 * this.cabeca.scale.x);
    // (colado numa fonte, o nome dela é que importa: os dois rótulos ficariam um por cima do outro)
    this.rotuloVoce.visible = !(gimbal && c.fonteFicha && c.ouv.gimbal.r < 4);
    const centro = w.set(cc[0], cc[1], cc[2] - 2.5);
    const compPx = c.corpo.comprimento / mPorPx(centro);
    this.rotuloCorpo.visible = compPx < 140;
    if (this.rotuloCorpo.visible) {
      const txt = `${NOME_CORPO[c.portador] ?? c.portador}${c.traj.altitude > 2 ? ` · ${Math.round(c.traj.altitude)} m` : ''}`;
      if (txt !== this.textoCorpo) { this.textoCorpo = txt; trocarRotulo(this.rotuloCorpo, txt); }
      porRotulo(this.rotuloCorpo, centro, 2.5);
    }
    const f3 = c.fonteFicha ? this.fontes3d.find((x) => x.f.id === c.fonteFicha) : null;
    this.rotuloFonte.visible = !!f3;
    if (f3) {
      if (f3.f.id !== this.textoFonte) { this.textoFonte = f3.f.id; trocarRotulo(this.rotuloFonte, nomeFonte(c, f3.f.id)); }
      porRotulo(this.rotuloFonte, f3.m.position, f3.m.scale.x);
    }
    this.ceu.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
    this.quadros++;
  }

  /** alvo da câmera "no ouvinte": a cabeça; com o corpo no ar e o ouvinte parado, o meio entre a cabeça e o ponto da
   *  trajetória mais perto dele, para os dois caberem no quadro */
  private alvoOuvinte(alvo: THREE.Vector3) {
    const c = this.c;
    alvo.copy(this.cabeca.position);
    if (c.ouv.modo === 'fixo' && c.traj.altitude > 5) {
      const p = c.via.ponto(c.sOuvinte(), this.pv);
      alvo.set((alvo.x + p.x) / 2, (alvo.y + p.y) / 2, (alvo.z + c.traj.altitude) / 2);
    }
    return alvo;
  }
  /** põe a câmera "no ouvinte" no enquadramento padrão quando o portador, a altitude ou o modo do ouvinte mudam */
  private enquadrar(s: number) {
    const c = this.c;
    const chave = `${c.portador}|${c.ouv.modo}|${Math.round(c.traj.altitude / 20)}|${Math.round(c.traj.lateral / 20)}`;
    if (chave === this.chaveQuadro) return;
    const primeira = this.chaveQuadro === '';
    this.chaveQuadro = chave;
    if (this.modo !== 'ouvinte' || (!primeira && this.arrasto)) return;
    void s;
    this.posicionarNoOuvinte();
  }
  private posicionarNoOuvinte() {
    const c = this.c, h = this.cabeca.position, alvo = this.alvoOuvinte(new THREE.Vector3());
    if (c.ouv.modo === 'fixo' && c.traj.altitude > 5) {
      // de longe e de baixo, olhando para cima: o chão, o ouvinte e o corpo lá no alto
      const D = 1.7 * Math.hypot(c.traj.altitude, c.traj.lateral) + 25;
      this.camera.position.set(alvo.x - 0.4 * D, alvo.y - D, Math.max(1.5, 0.1 * D));
      (this.scene.fog as THREE.Fog).far = Math.max(7000, 5 * D);
    } else {
      this.camera.position.set(h.x - 14, h.y - 22, h.z + 8);
      (this.scene.fog as THREE.Fog).far = 7000;
    }
    this.controls.target.copy(alvo);
    this.temAlvoAnt = false;
  }

  private rumo(s: number) { const p = this.c.via.ponto(s, this.pv); return Math.atan2(p.ty, p.tx); }

  /** (a) orbital no ouvinte: o alvo dos controles anda com a cabeça; (b) segue o corpo; (c) livre */
  private seguirCamera(_fixo: unknown, s: number) {
    const c = this.c;
    if (this.modo === 'livre') { this.temAlvoAnt = false; return; }
    const alvo = new THREE.Vector3();
    if (this.modo === 'ouvinte') this.alvoOuvinte(alvo);
    else { const p = c.corpoNoMundo(s, [0, 0, 2]); alvo.set(p[0], p[1], p[2]); }
    if (this.temAlvoAnt) {
      const d = alvo.clone().sub(this.alvoAnt);
      // presa ao ouvinte ou ao corpo, a câmera anda junto, saltos incluídos (o ouvinte que passa a andar no
      // gimbal, o corpo que reaparece do outro lado da reta); no modo livre ela fica onde está
      this.camera.position.add(d);
    }
    this.controls.target.copy(alvo);
    this.alvoAnt.copy(alvo); this.temAlvoAnt = true;
  }

  alternarCamera() {
    const ordem: ModoCamera[] = ['ouvinte', 'corpo', 'livre'];
    this.definirCamera(ordem[(ordem.indexOf(this.modo) + 1) % 3]);
  }
  definirCamera(m: ModoCamera) {
    this.modo = m; this.temAlvoAnt = false;
    this.controls.enablePan = m === 'livre';
    // (segue o corpo: a distância acompanha o tamanho dele, para um carro de 4 m não ficar um ponto)
    if (m === 'corpo') { const p = this.c.corpoNoMundo(this.c.estimativa().s, [0, 0, 2]), d = Math.min(60, Math.max(9, this.c.corpo.comprimento * 1.1)); this.camera.position.set(p[0] - 0.65 * d, p[1] - 0.75 * d, p[2] + 0.3 * d); }
    if (m === 'ouvinte') this.posicionarNoOuvinte();
    this.aoMudarCamera?.();
  }

  // ------------------------------------------------------------------ arrasto
  private ndc(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }
  private aoApertar = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.ray.setFromCamera(this.ndc(e), this.camera);
    const alvos: THREE.Object3D[] = [this.cabeca, this.fontesG];
    if (this.gimbalG.visible) alvos.push(this.anelAz, this.arcoEl, this.pegaR);
    if (this.alcaLateral.visible) alvos.push(this.alcaLateral);
    alvos.push(this.alcaAltitude, this.corpoG);
    const hit = this.ray.intersectObjects(alvos, true)[0];
    if (!hit) return;
    let ob: THREE.Object3D | null = hit.object;
    while (ob && !ob.userData.pega) ob = ob.parent;
    if (!ob) return;
    const pega = ob.userData.pega as string;
    if (pega === 'fonte') {
      const id = ob.userData.id as string;
      this.c.escolherFonte(id);
      this.c.setOuvinte({}, { alvo: id });
      return;
    }
    if (pega === 'cabeca') this.arrasto = { tipo: 'cabeca', alt: e.shiftKey };
    else if (pega === 'az' || pega === 'el' || pega === 'r' || pega === 'lateral' || pega === 'altitude') this.arrasto = { tipo: pega } as Arrasto;
    else if (pega === 'corpo') {
      const { s } = this.c.estimativa();
      this.arrasto = { tipo: 'corpo', xGrab: this.abscissaPerto(hit.point, s) - s };
    } else return;
    this.controls.enabled = false;
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.style.cursor = 'grabbing';
  };
  private aoSoltar = (e: PointerEvent) => {
    if (!this.arrasto) return;
    this.arrasto = null;
    this.controls.enabled = true;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* já solto */ }
    this.canvas.style.cursor = '';
    this.c.avisar('painel');
  };
  /** ponto do raio no plano horizontal z = h */
  private noPlanoZ(h: number) { const p = new THREE.Vector3(); return this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -h), p) ? p : null; }
  /** ponto do raio no plano vertical que passa por q e encara a câmera */
  private noPlanoVertical(q: THREE.Vector3) {
    const n = this.camera.position.clone().sub(q); n.z = 0; if (n.lengthSq() < 1e-6) n.set(1, 0, 0); n.normalize();
    const p = new THREE.Vector3(); return this.ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, q), p) ? p : null;
  }
  /** abscissa da via mais perto de um ponto do mundo, procurando perto de s */
  private abscissaPerto(p: THREE.Vector3, s: number) {
    const via = this.c.via;
    if (via.tipo === 'reta') return via.sentido * p.x;
    let melhor = s, dm = Infinity;
    for (let d = -300; d <= 300; d += 2) { const q = via.ponto(s + d, this.pv); const e = (q.x - p.x) ** 2 + (q.y - p.y) ** 2; if (e < dm) { dm = e; melhor = s + d; } }
    for (let d = -2; d <= 2; d += 0.1) { const q = via.ponto(melhor + d, this.pv); const e = (q.x - p.x) ** 2 + (q.y - p.y) ** 2; if (e < dm) { dm = e; melhor += d; } }
    return melhor;
  }
  private aoMover = (e: PointerEvent) => {
    const a = this.arrasto;
    if (!a) return;
    this.ray.setFromCamera(this.ndc(e), this.camera);
    const c = this.c, { s } = c.estimativa(), largura = c.corpo.segmentos[0]?.largura ?? 2;
    const snapA = (x: number) => Math.round(x / 5) * 5, snapR = (x: number) => Math.max(0.3, Math.round(x * 2) / 2);
    const rumo = this.rumo(s);
    const alvoW = () => { const t = c.corpoNoMundo(s, c.alvoCorpo()); return new THREE.Vector3(t[0], t[1], t[2]); };
    if (a.tipo === 'cabeca' && c.ouv.modo === 'fixo') {
      const h = this.cabeca.position;
      if (a.alt || e.shiftKey) { const p = this.noPlanoVertical(h); if (p) c.setOuvinte({ pos: [c.ouv.pos[0], 0, Math.min(50, Math.max(0.2, Math.round(p.z * 10) / 10))] }); }
      else {
        const p = this.noPlanoZ(h.z); if (!p) return;
        const lateral = Math.max(0.5, Math.round((c.via.yOuvinte - p.y - largura / 2) * 2) / 2);
        c.setOuvinte({ pos: [Math.round(p.x * 2) / 2, 0, c.ouv.pos[2]] });
        c.setTraj({ lateral: Math.min(3000, lateral) });
      }
    } else if (a.tipo === 'cabeca' || a.tipo === 'az' || a.tipo === 'r') {
      const q = alvoW(), g = c.ouv.gimbal;
      if (a.tipo === 'cabeca' && (a.alt || e.shiftKey)) { this.elevacao(q, rumo); return; }
      const p = this.noPlanoZ(a.tipo === 'az' ? q.z : this.cabeca.position.z); if (!p) return;
      const dx = p.x - q.x, dy = p.y - q.y;
      const azw = Math.atan2(dy, dx) - rumo, rh = Math.hypot(dx, dy);
      const patch: Partial<typeof g> = {};
      if (a.tipo !== 'r') patch.az = snapA((azw * 180) / Math.PI);
      if (a.tipo !== 'az') {
        if (a.tipo === 'r') { const dir = this.cabeca.position.clone().sub(q).normalize(); const pp = this.noPlanoVertical(q) ?? p; patch.r = snapR(Math.max(0.3, pp.clone().sub(q).dot(dir))); }
        else patch.r = snapR(rh / Math.max(0.05, Math.cos((g.el * Math.PI) / 180)));
      }
      c.setOuvinte({}, patch);
    } else if (a.tipo === 'el') this.elevacao(alvoW(), rumo);
    else if (a.tipo === 'corpo') {
      const p = this.noPlanoZ(c.traj.altitude + 1.5); if (!p) return;
      c.moverCorpo(this.abscissaPerto(p, s + a.xGrab) - a.xGrab);
    } else if (a.tipo === 'lateral') {
      const p = this.noPlanoZ(0.45); if (!p) return;
      c.setTraj({ lateral: Math.min(3000, Math.max(0.5, Math.round((c.via.yOuvinte - p.y - largura / 2) * 2 * 2) / 2)) });
    } else if (a.tipo === 'altitude') {
      const p = this.noPlanoVertical(this.alcaAltitude.position); if (!p) return;
      const alt = Math.max(0, Math.min(3000, Math.round((p.z - (c.corpo.segmentos[0]?.altura ?? 2) - 2.5) * 2) / 2));
      c.setTraj({ altitude: alt });
    }
  };
  private elevacao(q: THREE.Vector3, _rumo: number) {
    const p = this.noPlanoVertical(q); if (!p) return;
    const dh = Math.hypot(p.x - q.x, p.y - q.y), el = (Math.atan2(p.z - q.z, dh) * 180) / Math.PI;
    this.c.setOuvinte({}, { el: Math.max(-20, Math.min(89, Math.round(el / 5) * 5)) });
  }
  private aoTecla = (e: KeyboardEvent) => { if (e.code === 'KeyC') this.alternarCamera(); };

  descartar() {
    this.vivo = false;
    this.canvas.removeEventListener('pointerdown', this.aoApertar);
    this.canvas.removeEventListener('pointermove', this.aoMover);
    this.canvas.removeEventListener('pointerup', this.aoSoltar);
    this.canvas.removeEventListener('pointercancel', this.aoSoltar);
    this.canvas.removeEventListener('keydown', this.aoTecla);
    this.controls.dispose();
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
  const K = 28, secoes: { x: number; w: number; zb: number; zt: number }[] = [];
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
    idx.push(a, cc, b, b, cc, d);
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

/** faixa ao longo da via entre as abscissas s0 e s1: de (deslocamento y0, altura z0) a (y1, z1) */
function faixa(c: ControlePassagem, s0: number, s1: number, passo: number, y0: number, y1: number, z0: number, z1: number, cor: number, opac: number) {
  const pv = new PontoVia(), pos: number[] = [], idx: number[] = [];
  const n = Math.max(1, Math.ceil((s1 - s0) / passo));
  for (let i = 0; i <= n; i++) {
    const p = c.via.ponto(s0 + ((s1 - s0) * i) / n, pv);
    pos.push(p.x + y0 * p.nx, p.y + y0 * p.ny, z0, p.x + y1 * p.nx, p.y + y1 * p.ny, z1);
    if (i < n) { const a = 2 * i; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({ color: cor, side: THREE.DoubleSide, roughness: 0.9, transparent: opac < 1, opacity: opac, depthWrite: opac >= 1 });
  return new THREE.Mesh(g, m);
}

/** linha ao longo da via com deslocamento lateral e altura (tracejada no ar) */
function linhaVia(c: ControlePassagem, s0: number, s1: number, passo: number, y: number, z: number, cor: number, tracejada = false) {
  const pv = new PontoVia(), pts: THREE.Vector3[] = [];
  const n = Math.max(1, Math.ceil((s1 - s0) / passo));
  for (let i = 0; i <= n; i++) { const p = c.via.ponto(s0 + ((s1 - s0) * i) / n, pv); pts.push(new THREE.Vector3(p.x + y * p.nx, p.y + y * p.ny, z)); }
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  const l = new THREE.Line(g, tracejada ? new THREE.LineDashedMaterial({ color: cor, dashSize: 6, gapSize: 4 }) : new THREE.LineBasicMaterial({ color: cor }));
  if (tracejada) l.computeLineDistances();
  return l;
}

/** rótulo de texto (sprite com canvas) */
function rotulo(texto: string) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.renderOrder = 10;
  trocarRotulo(s, texto);
  return s;
}
function trocarRotulo(s: THREE.Sprite, texto: string) {
  const t = (s.material as THREE.SpriteMaterial).map as THREE.CanvasTexture, cv = t.image as HTMLCanvasElement, g = cv.getContext('2d')!;
  g.clearRect(0, 0, cv.width, cv.height);
  if (!texto) { t.needsUpdate = true; return; }
  // (o fundo acompanha a largura do texto: uma tarja de ponta a ponta tapava a cena em volta)
  g.font = '500 30px "IBM Plex Mono", ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const lw = Math.min(cv.width - 4, g.measureText(texto).width + 26);
  g.fillStyle = 'rgba(13,16,21,0.8)';
  g.beginPath();
  if (g.roundRect) g.roundRect((cv.width - lw) / 2, 9, lw, 46, 10); else g.rect((cv.width - lw) / 2, 9, lw, 46);
  g.fill();
  g.fillStyle = '#e9e4d8';
  g.fillText(texto, cv.width / 2, 33, cv.width - 12);
  t.needsUpdate = true;
}

/** libera geometrias e materiais de um grupo e o esvazia */
function descartar(g: THREE.Object3D) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = (m as { material?: THREE.Material | THREE.Material[] }).material;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
  });
  if (g instanceof THREE.Scene) return;
  while (g.children.length) g.remove(g.children[0]);
}
