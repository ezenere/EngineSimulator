// Cena 3D da Passagem, three.js, só na thread principal. Carregada sob demanda (import dinâmico na página): o áudio
// nunca espera por ela, e se o WebGL faltar a página segue sem 3D (o observador anda e ouve do mesmo jeito).
//
// Um lugar visto por uma pessoa: a câmera é o olho do observador (observador.ts; o ouvinte da Cena é o ouvido dele),
// em primeira pessoa, sem órbita. Tudo opaco: céu em degradê com o sol, luz do céu, sombra do sol perto de você,
// neblina de distância. O lugar é o do cenário (mundo/: a ferrovia, a estação, o túnel no morro, a rua, o aeródromo…)
// e o veículo é o modelo low poly do portador (modelos/), um grupo por segmento, com as rodas, as pás e as bielas
// andando. A vista técnica (tecla T, desligada por padrão) acrescenta os marcadores das fontes e a linha da trajetória.
//
// Mundo em metros, z para cima (o mesmo da Cena: a via passa ao longo de x, o ponto de chegada fica do lado −y).
// Texturas de solo CC0 da Poly Haven em public/3d/ (LICENSES.md), carregadas sem bloquear: sem elas, a cor lisa.
import * as THREE from 'three';
import type { ControlePassagem } from './controle';
import { COR_TIPO } from './cena3d-cores';
import { PontoVia } from '../../scene/trajetoria';
import { TUNEL } from './lugar';
import { montarMundo, type Mundo } from './mundo';
import { descartar } from './mundo/geo';
import { montarModelo } from './modelos';
import type { Modelo } from './modelos/kit';
import { fundir, fundirGeometria, materialFundido, soltarPecas } from './modelos/fundir';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

// céu de dia: azul no alto, claro e um pouco quente no horizonte; a neblina tem a cor do horizonte
const CEU_ZENITE = 0x3f73b8, CEU_HORIZONTE = 0xc9d8e4;
/** m: meia largura da caixa da sombra do sol (em volta de você) e o passo em que ela anda */
const SOMBRA_MEIA = 90, SOMBRA_PASSO = 4;
/** sol de meio da tarde: por trás e à direita de quem está no ponto de chegada olhando a via */
const DIR_SOL = new THREE.Vector3(380, -560, 520).normalize();

/** as rodas de um modelo, numa instância por tipo de roda: a matriz no segmento e o raio (gira com a distância) */
interface Rodas { im: THREE.InstancedMesh; itens: { seg: number; local: THREE.Matrix4; r: number }[] }

export class Cena3D {
  c: ControlePassagem;
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private estatico = new THREE.Group();
  private corpoG = new THREE.Group();
  private tecnicoG = new THREE.Group();
  private segs: { m: THREE.Group; xc: number }[] = [];
  private rodas: Rodas[] = [];
  private giros: Modelo['giros'] = [];
  private animar: Modelo['animar'];
  private distancia = 0;
  private fontes3d: { id: string; pos: readonly number[]; m: THREE.Mesh; idx: number }[] = [];
  private ceu: THREE.Mesh; private sol: THREE.DirectionalLight; private luzCeu: THREE.HemisphereLight; private discoSol: THREE.Mesh;
  private chaveEstatico = ''; private chaveCorpo = '';
  private mundo: Mundo | null = null;
  private dormentesEm = NaN;
  private texturas: { brita: THREE.Texture | null } = { brita: null };
  private pv = new PontoVia();
  private ultimo = 0; private ultimoRelogio = 0;
  private olho = { pos: [0, 0, 0] as [number, number, number], rumo: 0, arfagem: 0 };
  private centroSombra = new THREE.Vector2(NaN, NaN);
  /** onde o corpo estava quando a sombra foi desenhada */
  private sSombra = NaN;
  /** desenhou ao menos um quadro (o teste do navegador confere) */
  quadros = 0;
  vivo = true;

  constructor(canvas: HTMLCanvasElement, c: ControlePassagem) {
    this.c = c; this.canvas = canvas;
    // (antisserrilhado só em tela de densidade baixa: na de densidade alta ele custa caro e quase não se vê)
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: (window.devicePixelRatio || 1) < 1.5, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    // sombra do sol: mapa de profundidade simples (bordas duras combinam com o low poly e custam um acesso por pixel),
    // redesenhado só quando você anda um passo da grade ou quando o veículo está perto (o resto não se mexe)
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
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
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 12000);
    this.camera.up.set(0, 0, 1);
    this.luzCeu = new THREE.HemisphereLight(0xdfe9f5, 0x8a8170, 1.3);
    this.scene.add(this.luzCeu);
    this.sol = new THREE.DirectionalLight(0xfff1dc, 2.1); this.scene.add(this.sol, this.sol.target);
    this.sol.castShadow = true;
    this.sol.shadow.mapSize.set(1024, 1024);
    const sc = this.sol.shadow.camera;
    sc.left = -SOMBRA_MEIA; sc.right = SOMBRA_MEIA; sc.top = SOMBRA_MEIA; sc.bottom = -SOMBRA_MEIA; sc.near = 10; sc.far = 1400;
    this.sol.shadow.bias = -0.0006; this.sol.shadow.normalBias = 0.04;
    this.discoSol = new THREE.Mesh(new THREE.CircleGeometry(160, 32), new THREE.MeshBasicMaterial({ color: 0xfff6e0, fog: false, depthWrite: false }));
    this.discoSol.renderOrder = -9;
    this.scene.add(this.discoSol);
    this.scene.add(this.estatico, this.corpoG, this.tecnicoG);
    this.carregarTexturas();
  }

  // ------------------------------------------------------------------ texturas (sob demanda)
  private carregarTexturas() {
    const base = import.meta.env.BASE_URL || './';
    // (só a brita do lastro usa textura: é o que faz a via parecer via; o resto fica nas cores lisas da paleta)
    new THREE.TextureLoader().load(`${base}3d/texturas/brita_1k.jpg`, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      this.texturas.brita = t; this.chaveEstatico = '';    // remonta com a textura
    }, undefined, () => { /* sem textura: fica a cor lisa */ });
  }

  // ------------------------------------------------------------------ cenário (muda com ambiente, via, portador)
  private montarEstatico() {
    const c = this.c, amb = c.ambienteCena(), t = c.traj;
    const chave = JSON.stringify([amb.id, amb.solo.tipo, amb.tunel, t.tipo, t.comprimento, t.raioCurva, t.sentido, t.altitude > 2, t.lateral, c.portador, c.motor, c.motorPreset, c.cenario(), c.corpo.segmentos[0]?.largura, c.fontes.filter((f) => f.tipo === 'pantografo').length, !!this.texturas.brita]);
    if (chave === this.chaveEstatico) return;
    this.chaveEstatico = chave;
    descartar(this.estatico);
    this.dormentesEm = NaN;
    this.mundo = montarMundo(c, this.texturas.brita);
    this.estatico.add(this.mundo.grupo);
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** põe os dormentes em volta da abscissa s (de 100 em 100 m) */
  private recentrarDormentes(s: number) {
    const centro = Math.round(s / 100) * 100, l = this.mundo?.dormentes ?? [];
    if (centro === this.dormentesEm || !l.length) return;
    this.dormentesEm = centro;
    const lg = this.c.lugar(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p3 = new THREE.Vector3(), um = new THREE.Vector3(1, 1, 1), w: [number, number, number] = [0, 0, 0];
    for (const d of l) {
      const sa = Math.max(d.s0, centro - d.raio), sb = Math.min(d.s1, centro + d.raio);
      const n = Math.max(0, Math.min(d.im.instanceMatrix.count, Math.floor((sb - sa) / 0.6)));
      for (let i = 0; i < n; i++) {
        const sx = sa + i * 0.6;
        lg.mundo(sx, d.mv, d.z, w);
        e.set(0, 0, lg.rumoVia(sx)); q.setFromEuler(e); p3.set(w[0], w[1], w[2]);
        d.im.setMatrixAt(i, m.compose(p3, q, um));
      }
      d.im.count = n; d.im.instanceMatrix.needsUpdate = true; d.im.computeBoundingSphere();
    }
    this.renderer.shadowMap.needsUpdate = true;
  }

  // ------------------------------------------------------------------ corpo (muda com o portador)
  private montarCorpo() {
    const c = this.c, corpo = c.corpo;
    const chave = JSON.stringify([c.portador, c.motor, c.motorPreset, corpo.segmentos.length, corpo.comprimento, corpo.nariz, corpo.segmentos[0], c.fontes.length, c.trem.pantografos, c.trem.carenagem, c.vKmh > 1100, !!c.rotorCfg]);
    if (chave === this.chaveCorpo) return;
    this.chaveCorpo = chave;
    descartar(this.corpoG); descartar(this.tecnicoG);
    this.segs = []; this.fontes3d = []; this.rodas = []; this.giros = []; this.animar = undefined;
    const mod = montarModelo(c);
    this.giros = mod.giros; this.animar = mod.animar;
    // o que mexe fica de fora da fusão: as rodas (viram instâncias), as pás e as bielas (objetos próprios)
    const fora = new Set<THREE.Object3D>([...mod.rodas.map((r) => r.o), ...mod.giros.map((g) => g.o), ...(mod.moveis ?? [])]);
    const tipos = new Map<string, { geo: THREE.BufferGeometry; itens: Rodas['itens'] }>();
    let frente = corpo.comprimento / 2;
    corpo.segmentos.forEach((s, k) => {
      const xc = frente - s.comprimento / 2;
      frente -= s.comprimento + s.vao;
      const g = mod.segmentos[k] ?? new THREE.Group();
      g.updateMatrixWorld(true);
      const inv = g.matrixWorld.clone().invert();
      // rodas deste segmento: a matriz da roda no segmento; a geometria fundida, uma por tipo (raio e largura)
      for (const r of mod.rodas) {
        let p: THREE.Object3D | null = r.o; while (p && p !== g) p = p.parent;
        if (!p) continue;
        const local = inv.clone().multiply(r.o.matrixWorld);
        const geoRoda = fundirGeometria(r.o);
        geoRoda.computeBoundingBox();
        const bb = geoRoda.boundingBox!, chaveR = `${r.r.toFixed(3)}|${(bb.max.y - bb.min.y).toFixed(3)}|${geoRoda.attributes.color.getX(0).toFixed(3)}`;
        let tp = tipos.get(chaveR);
        if (!tp) { tp = { geo: geoRoda, itens: [] }; tipos.set(chaveR, tp); } else geoRoda.dispose();
        tp.itens.push({ seg: k, local, r: r.r });
      }
      // o resto do segmento numa malha só; as pás e as bielas continuam como objetos (as pás fundidas no grupo delas)
      const seg = new THREE.Group();
      seg.add(fundir(g, fora));
      for (const gi of mod.giros) {
        let p: THREE.Object3D | null = gi.o; while (p && p !== g) p = p.parent;
        if (!p) continue;
        const m = fundir(gi.o);
        const pai = new THREE.Group(); pai.matrixAutoUpdate = false; pai.matrix.copy(inv.clone().multiply(gi.o.parent!.matrixWorld)); seg.add(pai);
        const o = new THREE.Group(); o.position.copy(gi.o.position); o.quaternion.copy(gi.o.quaternion); o.scale.copy(gi.o.scale); o.add(m); pai.add(o);
        gi.o = o;
      }
      for (const mv of mod.moveis ?? []) {
        let p: THREE.Object3D | null = mv; while (p && p !== g) p = p.parent;
        if (p && mv.parent === g) seg.add(mv);   // (as bielas são filhas diretas do grupo do segmento)
      }
      soltarPecas(g);
      this.corpoG.add(seg); this.segs.push({ m: seg, xc });
    });
    for (const tp of tipos.values()) {
      const im = new THREE.InstancedMesh(tp.geo, materialFundido(), tp.itens.length);
      im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false;
      this.corpoG.add(im); this.rodas.push({ im, itens: tp.itens });
    }
    // vista técnica: marcadores das fontes (opacos), cor por tipo, raio pelo ganho
    const geo = new THREE.SphereGeometry(1, 14, 10);
    for (const f of c.fontes) {
      if (f.tipo === 'pressao') continue;
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: COR_TIPO[f.tipo], emissive: COR_TIPO[f.tipo], emissiveIntensity: 0.35 }));
      m.scale.setScalar(0.2);
      this.tecnicoG.add(m); this.fontes3d.push({ id: f.id, pos: f.pos, m, idx: -1 });
    }
    // e a trajetória (no ar, a linha na altitude)
    const lg = c.lugar(), pts: THREE.Vector3[] = [], Lv = c.via.comp, reta = c.traj.tipo === 'reta';
    for (let s = reta ? -Lv / 2 : 0; s <= (reta ? Lv / 2 : Lv); s += reta ? 20 : 4) { const w = lg.mundo(s, 0, c.traj.altitude + (corpo.segmentos[0]?.altura ?? 2) / 2); pts.push(new THREE.Vector3(w[0], w[1], w[2])); }
    const linha = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0x2f5aa8, dashSize: 6, gapSize: 4 }));
    linha.computeLineDistances();
    this.tecnicoG.add(linha);
    this.renderer.shadowMap.needsUpdate = true;
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

  /** você está dentro do tubo do túnel (lá dentro o sol não chega: só a luz das luminárias e o que entra pelas bocas) */
  private dentroDoTunel(p: readonly number[]) {
    const lg = this.c.lugar(), t = lg.tun;
    if (!t) return false;
    const q = lg.projetar(p[0], p[1]);
    const L = this.c.via.comp, noTrecho = this.c.via.tipo === 'reta' ? q.s > t.ta && q.s < t.tb : (((q.s - t.ta) % L) + L) % L < t.tb - t.ta;
    return noTrecho && q.m > t.mLonge - 0.5 && q.m < t.mPerto + TUNEL.nicho.fundo + 0.5 && p[2] < t.h + 0.5;
  }

  private m4 = new THREE.Matrix4(); private giro = new THREE.Matrix4();
  quadro(agora: number) {
    if (!this.vivo) return;
    if (agora - this.ultimo < 12) return;
    const dt = Math.min(0.1, (agora - this.ultimo) / 1000);
    if (this.ultimo > 0) this.ajustarDensidade(agora - this.ultimo);
    this.ultimo = agora;
    this.redimensionar();
    this.montarEstatico();
    this.montarCorpo();
    const c = this.c, { s, v } = c.estimativa(agora), tele = c.tele, alt = c.traj.altitude;
    this.recentrarDormentes(c.sOuvinte());
    // corpo: cada segmento no ponto dele da via
    for (const sg of this.segs) {
      const p = c.via.ponto(s + sg.xc, this.pv);
      sg.m.position.set(p.x, p.y, alt); sg.m.rotation.set(0, 0, Math.atan2(p.ty, p.tx));
      sg.m.updateMatrixWorld(true);
    }
    // rodas rolando (no chão), bielas da locomotiva a vapor
    if (alt <= 2) this.distancia += v * dt;
    for (const rd of this.rodas) {
      rd.itens.forEach((it, i) => {
        this.giro.makeRotationY(this.distancia / it.r);
        this.m4.multiplyMatrices(this.segs[it.seg].m.matrixWorld, it.local).multiply(this.giro);
        rd.im.setMatrixAt(i, this.m4);
      });
      rd.im.instanceMatrix.needsUpdate = true;
    }
    this.animar?.(this.distancia);
    // rotores e hélices girando (estroboscópico: uma fração da rotação real)
    if (this.giros.length) {
      const pt = tele?.portador as Record<string, unknown> | undefined;
      const rpm = Number(pt?.Nr) || Number(pt?.nHelice) || Number(pt?.rpmHelice) || Number(pt?.rpm) || 400;
      for (const r of this.giros) r.o.rotation.z += (rpm / 60) * 2 * Math.PI * dt * r.k;
    }
    // relógio da estação (a cada 10 s)
    if (this.mundo?.relogio && agora - this.ultimoRelogio > 10000) { this.ultimoRelogio = agora; this.mundo.relogio(new Date()); }
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
    const f = this.scene.fog as THREE.Fog, altO = Math.max(0, o.pos[2] - 30);
    f.near = 250 + altO * 2; f.far = 5500 + altO * 6;
    this.ceu.position.copy(cam.position);
    this.discoSol.position.copy(cam.position).addScaledVector(DIR_SOL, 8500); this.discoSol.lookAt(cam.position);
    // o sol e a caixa da sombra: centrados em você, andando de SOMBRA_PASSO em SOMBRA_PASSO m (a sombra não treme)
    const dentro = this.dentroDoTunel(o.pos);
    this.sol.intensity = dentro ? 0 : 2.1; this.luzCeu.intensity = dentro ? 0.8 : 1.3;
    if (this.mundo?.morro) this.mundo.morro.visible = !dentro;
    const cx = Math.round(o.pos[0] / SOMBRA_PASSO) * SOMBRA_PASSO, cy = Math.round(o.pos[1] / SOMBRA_PASSO) * SOMBRA_PASSO;
    if (cx !== this.centroSombra.x || cy !== this.centroSombra.y) {
      this.centroSombra.set(cx, cy);
      this.sol.target.position.set(cx, cy, 0); this.sol.position.set(cx, cy, 0).addScaledVector(DIR_SOL, 700);
      this.sol.target.updateMatrixWorld(); this.sol.updateMatrixWorld();
      this.renderer.shadowMap.needsUpdate = true;
    }
    // (o veículo perto de você e andando: a sombra dele anda, redesenha a cada quadro; parado, só quando ele muda de lugar)
    if (!dentro && !(Math.abs(s - this.sSombra) <= 0.02) && c.distanciaAoCorpo(s) < SOMBRA_MEIA * 1.4) { this.renderer.shadowMap.needsUpdate = true; this.sSombra = s; }
    this.renderer.render(this.scene, cam);
    this.quadros++;
  }

  descartar() {
    this.vivo = false;
    descartar(this.scene);
    this.renderer.dispose();
  }
}
