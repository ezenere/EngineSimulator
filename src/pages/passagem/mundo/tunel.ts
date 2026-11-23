// O túnel: por dentro, a seção da Cena (secaoTunel) com a abóbada, o revestimento concretado em anéis de 12,5 m (as
// juntas e o tom de cada anel), a luz das luminárias e a que entra pelas bocas assada nas cores, a passarela de serviço do
// lado do observador com a borda pintada e o corrimão, os nichos de refúgio com a moldura branca de contraste, a placa e a
// luminária (a porta de emergência a cada 100 m), as bandejas de cabos nas duas paredes, as placas de quilometragem e de
// saída, o sinal, a canaleta de drenagem, a catenária com os suportes e, ao longe, a boca com a luz de fora. Por fora, o
// morro que cobre o tubo e o emboque em cada boca: a testa de concreto em volta da abertura, as alas descendo a 45° e o
// vale de acesso. As medidas são as de lugar.ts e planta.ts (o morro em que se pisa).
import * as THREE from 'three';
import type { Lugar } from '../lugar';
import { TUNEL } from '../lugar';
import { alturaMorro, emboque, MORRO, type TuboTunel } from './planta';
import { fosco, faixa, prisma, repetir, terreno, grade, Malha, type Inst } from './geo';
import { fios } from './vias';
import { fundir, fundirGeometria, soltarPecas } from '../modelos/fundir';

/** m: o anel de concretagem do revestimento, a largura da junta, a flecha da abóbada acima das paredes */
const ANEL = 12.5, JUNTA = 0.12, FLECHA = 1.4;
/**
 * m: as luminárias (a cada LUZ_CADA, a primeira a LUZ_INI da boca), o raio das placas e dos sinais em volta da chegada,
 * o das peças miúdas (tampas, juntas, suportes: além dele somem no pixel) e o trecho do revestimento em fatias de 2,5 m
 * (as poças de luz; mais longe, uma fatia por anel)
 */
const LUZ_CADA = 25, LUZ_INI = 10, RAIO_PLACAS = 420, RAIO_MIUDO = 160, RAIO_FINO = 250;

/** o tubo por dentro: o que o observador vê do refúgio. `boca`: as duas luzes das bocas (só aparecem de dentro) */
export function tuboPorDentro(G: THREE.Group, lg: Lugar, reta: boolean, catenariaZ: number | null): { boca: THREE.Object3D } {
  const t = lg.tun!, mP = t.mPerto, mL = t.mLonge, h = t.h, ta = t.ta, tb = t.tb, p = reta ? 25 : 5;
  const pas = TUNEL.passarela, ni = TUNEL.nicho, topoNicho = pas + ni.altura, bo = t.borda, mc = (mP + mL) / 2, meia = (mP - mL) / 2;
  const nichos = lg.nichos();
  // ---------------------------------------------------------------- o revestimento (paredes e abóbada) em anéis
  // a seção: a parede de lá do chão até h, a abóbada (arco de flecha FLECHA), a parede de cá de h até o topo dos nichos;
  // a parte de baixo da parede de cá vai por trechos (entre os nichos)
  const sec: [number, number][] = [[mL, 0.25], [mL, h]];
  for (let i = 1; i < 10; i++) { const u = -1 + (2 * i) / 10; sec.push([mc + u * meia, h + FLECHA * (1 - u * u)]); }
  sec.push([mP, h], [mP, topoNicho + 0.4]);
  const baixo: [number, number][] = [[mP, topoNicho + 0.4], [mP, pas]];
  // a luz assada: poças de luz nas luminárias, a luz do dia perto das bocas, um pouco mais escuro no alto da abóbada
  const luz = (s: number, z: number) => {
    const u = (((s - ta - LUZ_INI) % LUZ_CADA) + LUZ_CADA) % LUZ_CADA, d = Math.min(u, LUZ_CADA - u);
    const poca = 0.4 + 0.85 * Math.exp(-(d * d) / 40), dia = Math.max(0, 1 - Math.min(s - ta, tb - s) / 45);
    return Math.min(1.35, poca + 0.6 * dia) * (1 - 0.18 * Math.max(0, (z - h) / FLECHA));
  };
  // os cortes ao longo da via: a cada 2,5 m perto da chegada, nas juntas e nas bordas dos nichos
  const cortes = new Set<number>();
  for (let s = Math.max(ta, -RAIO_FINO); s <= Math.min(tb, RAIO_FINO); s += 2.5) cortes.add(+s.toFixed(3));
  for (let s = ta; s <= tb; s += ANEL) { cortes.add(+s.toFixed(3)); cortes.add(+Math.min(tb, s + JUNTA).toFixed(3)); }
  for (const c of nichos) { cortes.add(c - ni.largura / 2); cortes.add(c + ni.largura / 2); }
  cortes.add(tb);
  const ss = [...cortes].filter((s) => s >= ta && s <= tb).sort((a, b) => a - b);
  const pos: number[] = [], cor: number[] = [], k = new THREE.Color(), w: [number, number, number] = [0, 0, 0];
  const base = [0xb6b1a6, 0xbcb7ac, 0xb1aca1, 0xb9b4a9], corJunta = 0x6f6b64;
  const quad = (s0: number, s1: number, a: readonly [number, number], b: readonly [number, number], c: number) => {
    const P = [[s0, a], [s1, a], [s1, b], [s0, b]] as const;
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const [s, [m, z]] = P[i]; lg.mundo(s, m, z, w); pos.push(w[0], w[1], w[2]);
      k.set(c).multiplyScalar(luz(s, z)); cor.push(k.r, k.g, k.b);
    }
  };
  const emNicho = (sm: number) => nichos.some((c) => Math.abs(sm - c) < ni.largura / 2 - 1e-3);
  for (let i = 0; i < ss.length - 1; i++) {
    const s0 = ss[i], s1 = ss[i + 1], sm = (s0 + s1) / 2, anel = Math.floor((sm - ta) / ANEL), naJunta = sm - ta - anel * ANEL < JUNTA;
    const c = naJunta ? corJunta : base[anel % base.length];
    for (let j = 0; j < sec.length - 1; j++) quad(s0, s1, sec[j], sec[j + 1], c);
    if (!emNicho(sm)) quad(s0, s1, baixo[0], baixo[1], c);
  }
  const gR = new THREE.BufferGeometry();
  gR.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); gR.setAttribute('color', new THREE.Float32BufferAttribute(cor, 3)); gR.computeVertexNormals();
  const revest = new THREE.Mesh(gR, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide, emissive: 0x1c1b18 }));
  G.add(revest);
  // (as peças sólidas de cor lisa vão para `miudo`, fundidas numa malha só no fim; as acesas, para `acesos`)
  const miudo = new THREE.Group(), acesos = new THREE.Group();
  // o rodapé da parede de lá (a canaleta de drenagem com as tampas) e o pé da parede de cá, embaixo da passarela
  miudo.add(prisma(lg, ta, tb, p, [[mL, 0], [mL, 0.25], [mL + 0.55, 0.25], [mL + 0.55, 0]], fosco(0x9c9a94), false));
  G.add(faixa(lg, ta, tb, p, mL + 0.08, mL + 0.47, 0.255, 0.255, fosco(0x55524c)));
  const tampas: Inst[] = [];
  for (let s = Math.max(ta, -RAIO_MIUDO) + 0.5; s < Math.min(tb, RAIO_MIUDO); s += 1.0) tampas.push({ pos: lg.mundo(s, mL + 0.275, 0.262), rumo: lg.rumoVia(s) });
  miudo.add(repetir(new THREE.BoxGeometry(0.92, 0.36, 0.02), fosco(0x8e8b84), tampas));

  // ---------------------------------------------------------------- os nichos e a moldura de contraste
  const nicho = new Malha(lg);
  for (const c of nichos) {
    const a = c - ni.largura / 2, b = c + ni.largura / 2, f = mP + ni.fundo;
    nicho.quad([a, f, pas], [b, f, pas], [b, f, topoNicho], [a, f, topoNicho]);
    nicho.quad([a, mP, pas], [a, f, pas], [a, f, topoNicho], [a, mP, topoNicho]);
    nicho.quad([b, mP, pas], [b, f, pas], [b, f, topoNicho], [b, mP, topoNicho]);
    nicho.quad([a, mP, topoNicho], [b, mP, topoNicho], [b, f, topoNicho], [a, f, topoNicho]);
    nicho.quad([a, mP, pas], [b, mP, pas], [b, f, pas], [a, f, pas]);
    nicho.quad([a, mP, 0], [b, mP, 0], [b, mP, pas], [a, mP, pas]);
  }
  // (o nicho tem a luz dele: as paredes de dentro, claras, aparecem acesas ao longo do túnel)
  if (!nicho.vazia) G.add(nicho.mesh(fosco(0xe2dfd6, { emissive: 0x5a5852 })));
  // a moldura branca em volta do vão (as faixas de contraste) e a porta verde a cada 100 m
  const moldura = new Malha(lg), mm = mP - 0.02, lm = 0.3;
  for (const c of nichos) {
    const a = c - ni.largura / 2, b = c + ni.largura / 2;
    moldura.quad([a - lm, mm, pas], [a, mm, pas], [a, mm, topoNicho + lm], [a - lm, mm, topoNicho + lm]);
    moldura.quad([b, mm, pas], [b + lm, mm, pas], [b + lm, mm, topoNicho + lm], [b, mm, topoNicho + lm]);
    moldura.quad([a, mm, topoNicho], [b, mm, topoNicho], [b, mm, topoNicho + lm], [a, mm, topoNicho + lm]);
  }
  if (!moldura.vazia) G.add(moldura.mesh(fosco(0xf2f0e8, { emissive: 0x3a3935 })));
  const porta = new Malha(lg);
  for (const c of nichos) if (Math.round(c / ni.cada) % 2 === 0) { const f = mP + ni.fundo - 0.04; porta.quad([c - 0.5, f, pas], [c + 0.5, f, pas], [c + 0.5, f, pas + 2.05], [c - 0.5, f, pas + 2.05]); }
  if (!porta.vazia) G.add(porta.mesh(fosco(0x2f7d4f, { emissive: 0x0d2416 })));

  // ---------------------------------------------------------------- a passarela, a borda pintada, o corrimão
  miudo.add(prisma(lg, ta, tb, p, [[bo, 0], [bo, pas], [mP, pas], [mP, 0]], fosco(0x9c9a94), true));
  G.add(faixa(lg, ta, tb, p, bo + 0.05, bo + 0.2, pas + 0.006, pas + 0.006, fosco(0xe2c23a, { emissive: 0x2a2410 })));
  const trechos: [number, number][] = [];
  let ini = ta;
  for (const c of nichos) { trechos.push([ini, c - ni.largura / 2 - lm]); ini = c + ni.largura / 2 + lm; }
  trechos.push([ini, tb]);
  const amarelo = fosco(0xe6bd52);
  for (const [a, b] of trechos) if (b > a) miudo.add(prisma(lg, a, b, p, [[mP - 0.12, pas + TUNEL.corrimao], [mP - 0.05, pas + TUNEL.corrimao], [mP - 0.05, pas + TUNEL.corrimao - 0.06], [mP - 0.12, pas + TUNEL.corrimao - 0.06]], amarelo, true));
  const suportes: Inst[] = [];
  for (const [a, b] of trechos) for (let s = Math.max(a, -RAIO_MIUDO) + 0.8; s < Math.min(b, RAIO_MIUDO) - 0.2; s += 2.5) suportes.push({ pos: lg.mundo(s, mP - 0.08, pas + TUNEL.corrimao - 0.02), rumo: lg.rumoVia(s) });
  if (suportes.length) miudo.add(repetir(new THREE.BoxGeometry(0.05, 0.12, 0.05), amarelo, suportes));
  // as tampas da canaleta de cabos da passarela (as juntas a cada metro) e as luzes de balizamento no pé da parede
  const juntas: Inst[] = [], balizas: Inst[] = [];
  for (let s = Math.max(ta, -RAIO_MIUDO) + 0.5; s < Math.min(tb, RAIO_MIUDO); s += 1) if (!nichos.some((c) => Math.abs(c - s) < ni.largura / 2)) juntas.push({ pos: lg.mundo(s, (bo + 0.2 + mP) / 2, pas + 0.004), rumo: lg.rumoVia(s), esc: [0.03, mP - bo - 0.25, 0.01] });
  for (let s = Math.ceil(Math.max(ta, -RAIO_PLACAS) / 12.5) * 12.5 + 6.25; s < Math.min(tb, RAIO_PLACAS); s += 12.5) if (!nichos.some((c) => Math.abs(c - s) < 2)) balizas.push({ pos: lg.mundo(s, mP - 0.04, pas + 0.55), rumo: lg.rumoVia(s) });
  miudo.add(repetir(new THREE.BoxGeometry(1, 1, 1), fosco(0x6e6c66), juntas));
  acesos.add(repetir(new THREE.BoxGeometry(0.3, 0.06, 0.12), fosco(0xfff4d8), balizas));
  // piso da via
  G.add(faixa(lg, ta, tb, p, mL + 0.55, bo, 0.01, 0.01, fosco(0x77746e)));

  // ---------------------------------------------------------------- as bandejas de cabos nas duas paredes
  const aco = fosco(0x8a8f94), cabo = fosco(0x24262a);
  for (const [mw, sg, z] of [[mL, 1, 3.1], [mL, 1, 3.6], [mP, -1, topoNicho + 0.75]] as const) {
    const m0 = mw + sg * 0.06, m1 = mw + sg * 0.46;
    // (a bandeja: a chapa do fundo e a aba de fora; os cabos em cima; as mãos-francesas)
    const a0 = Math.min(m0, m1), a1 = Math.max(m0, m1), aba = sg > 0 ? m1 : m1;
    miudo.add(prisma(lg, ta, tb, p, [[a0, z], [a1, z], [a1, z + 0.03], [a0, z + 0.03]], aco, false));
    miudo.add(prisma(lg, ta, tb, p, [[aba - 0.015, z], [aba + 0.015, z], [aba + 0.015, z + 0.1], [aba - 0.015, z + 0.1]], aco, false));
    miudo.add(prisma(lg, ta, tb, p, [[a0 + 0.06, z + 0.03], [a1 - 0.06, z + 0.03], [a1 - 0.06, z + 0.09], [a0 + 0.06, z + 0.09]], cabo, false));
    const mao: Inst[] = [];
    for (let s = Math.max(ta, -RAIO_MIUDO) + 1; s < Math.min(tb, RAIO_MIUDO); s += 2) mao.push({ pos: lg.mundo(s, (m0 + m1) / 2, z - 0.04), rumo: lg.rumoVia(s), esc: [0.05, 0.46, 0.06] });
    miudo.add(repetir(new THREE.BoxGeometry(1, 1, 1), aco, mao));
  }

  // ---------------------------------------------------------------- as luminárias (acesas: sem sombreamento)
  const lum = fosco(0xfff1cf), pts: Inst[] = [], caixas: Inst[] = [];
  for (let s = ta + LUZ_INI; s < tb; s += LUZ_CADA) for (const [mm2, sg] of [[mL + 0.12, 1], [mP - 0.12, -1]] as const) { const z = sg > 0 ? 4.4 : topoNicho + 1.4; pts.push({ pos: lg.mundo(s, mm2 + sg * 0.05, z), rumo: lg.rumoVia(s) }); caixas.push({ pos: lg.mundo(s, mm2, z), rumo: lg.rumoVia(s) }); }
  for (const c of nichos) pts.push({ pos: lg.mundo(c, mP + ni.fundo / 2, topoNicho - 0.06), rumo: lg.rumoVia(c) });
  acesos.add(repetir(new THREE.BoxGeometry(1.2, 0.08, 0.14), lum, pts)); miudo.add(repetir(new THREE.BoxGeometry(1.3, 0.12, 0.22), fosco(0x6b7077), caixas));

  // ---------------------------------------------------------------- placas: quilometragem, saída, refúgio, distâncias
  G.add(placas(lg, nichos, mL, mP, pas, topoNicho));

  // ---------------------------------------------------------------- o sinal (o da outra mão, de frente para você) e o marco
  const sSin = -95, mSin = mL + 0.3;
  if (sSin > ta + 20) {
    const r = lg.rumoVia(sSin), q = (dm: number, z: number) => lg.mundo(sSin, mSin + dm, z);
    miudo.add(repetir(new THREE.BoxGeometry(0.4, 0.3, 1.0), fosco(0x1d1f22), [{ pos: q(0, 3.2), rumo: r }]));
    miudo.add(repetir(new THREE.BoxGeometry(0.06, 0.32, 0.06), fosco(0x5b5f63), [{ pos: q(-0.12, 3.7), rumo: r }, { pos: q(-0.12, 2.75), rumo: r }]));
    const lamp = (cor2: number, z: number) => repetir(new THREE.CylinderGeometry(0.085, 0.085, 0.04, 12).rotateZ(Math.PI / 2), fosco(cor2), [{ pos: lg.mundo(sSin + 0.21, mSin, z), rumo: r }]);
    acesos.add(lamp(0x5cff8a, 3.48), lamp(0x2a1a14, 3.2), lamp(0x2a2414, 2.92));
  }

  // ---------------------------------------------------------------- a catenária com os suportes na abóbada
  if (catenariaZ != null) {
    const fio = fosco(0x4a4f55), isol = fosco(0x8a4a2e), pend: Inst[] = [], barras: Inst[] = [], isols: Inst[] = [];
    fios(G, lg, ta - 30, tb + 30, [{ m: 0, z: catenariaZ }, { m: 0, z: catenariaZ + 0.9 }], 0x34373b);
    for (let s = ta + 25; s < tb; s += 50) {
      const r = lg.rumoVia(s), zTeto = h + FLECHA * (1 - ((0 - mc) / meia) ** 2) - 0.05, zb = catenariaZ + 1.25;
      pend.push({ pos: lg.mundo(s, 0.6, (zTeto + zb) / 2), rumo: r, esc: [0.08, 0.08, zTeto - zb] });
      barras.push({ pos: lg.mundo(s, 0.2, zb), rumo: r, esc: [0.07, 1.0, 0.07] });
      isols.push({ pos: lg.mundo(s, -0.25, zb), rumo: r }, { pos: lg.mundo(s, 0, catenariaZ + 0.55), rumo: r });
      pend.push({ pos: lg.mundo(s, 0, (catenariaZ + zb) / 2), rumo: r, esc: [0.04, 0.04, zb - catenariaZ] });
    }
    miudo.add(repetir(new THREE.BoxGeometry(1, 1, 1), fio, pend), repetir(new THREE.BoxGeometry(1, 1, 1), fio, barras), repetir(new THREE.CylinderGeometry(0.06, 0.06, 0.32, 8), isol, isols));
  }

  // ---------------------------------------------------------------- as bocas: a luz de fora (de dentro, o resto de fora some)
  const boca = new THREE.Group(), ceu = new THREE.MeshBasicMaterial({ color: 0xeef3f6, fog: false, depthWrite: false, side: THREE.DoubleSide });
  for (const [sb, dir] of [[ta, -1], [tb, 1]] as const) {
    const g = new Malha(lg), sx = sb + dir * 4;
    for (let j = 0; j < sec.length - 1; j++) g.quad([sx, sec[j][0], sec[j][1]], [sx, sec[j + 1][0], sec[j + 1][1]], [sx, mc, 0]);
    g.quad([sx, mP, topoNicho + 0.4], [sx, mP, 0], [sx, mc, 0]);
    g.quad([sx, mL, 0.25], [sx, mL, 0], [sx, mc, 0]);
    const m = g.mesh(ceu); m.renderOrder = -5; boca.add(m);
  }
  boca.visible = false;
  G.add(boca);
  // as peças miúdas numa malha só (cores nos vértices) e as acesas noutra, sem sombreamento: duas chamadas de desenho
  G.add(fundir(miudo));
  G.add(new THREE.Mesh(fundirGeometria(acesos), new THREE.MeshBasicMaterial({ vertexColors: true })));
  soltarPecas(miudo); soltarPecas(acesos);
  // o teto e as paredes fazem sombra (o sol não entra pela pedra)
  G.traverse((o) => { o.receiveShadow = true; if ((o as THREE.Mesh).isMesh && o !== boca) o.castShadow = true; });
  return { boca };
}

/**
 * As placas do túnel numa textura só (um atlas de 1024 × 512, células de 256 × 128): a quilometragem a cada 100 m na
 * parede de lá, a placa verde de saída de emergência sobre os nichos com porta, a azul de refúgio sobre os outros, e as
 * distâncias até as portas a cada 25 m no corrimão. Opacas e sem sombreamento (refletivas: acesas na luz do trem e das
 * luminárias)
 */
function placas(lg: Lugar, nichos: readonly number[], mL: number, mP: number, pas: number, topoNicho: number) {
  const t = lg.tun!, cv = document.createElement('canvas'); cv.width = 1024; cv.height = 512;
  const x = cv.getContext('2d'), celulas: string[] = [];
  const celula = (desenho: (c: CanvasRenderingContext2D) => void) => {
    const i = celulas.length; celulas.push(''); if (!x) return i;
    x.save(); x.translate((i % 4) * 256, Math.floor(i / 4) * 128); x.beginPath(); x.rect(0, 0, 256, 128); x.clip(); desenho(x); x.restore();
    return i;
  };
  const texto = (c: CanvasRenderingContext2D, s: string, px: number, cx: number, cy: number, cor: string) => { c.fillStyle = cor; c.font = `bold ${px}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(s, cx, cy); };
  const seta = (c: CanvasRenderingContext2D, cx: number, cy: number, d: number) => { c.beginPath(); c.moveTo(cx + d * 18, cy); c.lineTo(cx - d * 6, cy - 16); c.lineTo(cx - d * 6, cy - 6); c.lineTo(cx - d * 22, cy - 6); c.lineTo(cx - d * 22, cy + 6); c.lineTo(cx - d * 6, cy + 6); c.lineTo(cx - d * 6, cy + 16); c.closePath(); c.fill(); };
  // o homenzinho correndo da placa de saída (traços grossos)
  const homem = (c: CanvasRenderingContext2D, cx: number, cy: number) => {
    c.strokeStyle = '#ffffff'; c.lineWidth = 9; c.lineCap = 'round';
    c.beginPath(); c.arc(cx + 6, cy - 34, 9, 0, Math.PI * 2); c.fillStyle = '#ffffff'; c.fill();
    c.beginPath(); c.moveTo(cx + 2, cy - 20); c.lineTo(cx - 6, cy + 6); c.moveTo(cx - 6, cy + 6); c.lineTo(cx + 12, cy + 18); c.lineTo(cx + 8, cy + 36); c.moveTo(cx - 6, cy + 6); c.lineTo(cx - 20, cy + 26); c.lineTo(cx - 30, cy + 22);
    c.moveTo(cx + 2, cy - 18); c.lineTo(cx + 20, cy - 6); c.moveTo(cx + 2, cy - 18); c.lineTo(cx - 16, cy - 10); c.stroke();
  };
  const fundo = (c: CanvasRenderingContext2D, cor: string, borda = '#ffffff') => { c.fillStyle = borda; c.fillRect(0, 0, 256, 128); c.fillStyle = cor; c.fillRect(6, 6, 244, 116); };
  const cSaida = celula((c) => { fundo(c, '#1f8a4c'); homem(c, 56, 64); texto(c, 'SAÍDA', 34, 168, 46, '#ffffff'); texto(c, 'EMERGÊNCIA', 24, 168, 86, '#ffffff'); });
  const cRef = celula((c) => { fundo(c, '#1f4f96'); texto(c, 'REFÚGIO', 40, 128, 50, '#ffffff'); texto(c, 'SOS ☎', 26, 128, 92, '#ffffff'); });
  const dist: Record<number, number> = {};
  for (const d of [25, 50, 75]) dist[d] = celula((c) => { fundo(c, '#1f8a4c'); c.fillStyle = '#ffffff'; seta(c, 40, 64, -1); seta(c, 216, 64, 1); texto(c, `${d} m`, 30, 98, 64, '#ffffff'); texto(c, `${100 - d} m`, 30, 162, 64, '#ffffff'); c.fillRect(127, 30, 3, 68); });
  const km0 = 84.6, cKm: Record<string, number> = {};
  for (let s = Math.ceil(Math.max(t.ta, -RAIO_PLACAS) / 100) * 100; s <= Math.min(t.tb, RAIO_PLACAS); s += 100) {
    const r = (km0 + (s - t.ta) / 1000).toFixed(1).replace('.', ',');
    if (cKm[r] == null && celulas.length < 16) cKm[r] = celula((c) => { fundo(c, '#f4f2ea', '#1d1f22'); texto(c, `km ${r}`, 52, 128, 66, '#1d1f22'); });
  }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  // as placas como quadriláteros com as coordenadas da célula, viradas para quem está no túnel
  const pos: number[] = [], uv: number[] = [], w = new THREE.Vector3(), a3 = new THREE.Vector3(), b3 = new THREE.Vector3();
  const placa = (s: number, m: number, z: number, lw: number, lh: number, cel: number, paraM: 1 | -1) => {
    const A = new THREE.Vector3(...lg.mundo(s - lw / 2, m, z)), B = new THREE.Vector3(...lg.mundo(s + lw / 2, m, z));
    // (a face de frente fica para o lado de dentro do túnel: m crescente na parede de lá, decrescente na de cá)
    const dentro = new THREE.Vector3(...lg.mundo(s, m + paraM, z)).sub(A), n = b3.copy(B).sub(A).cross(w.set(0, 0, 1));
    const [P0, P1] = n.dot(dentro) > 0 ? [A, B] : [B, A];
    const u0 = (cel % 4) / 4, u1 = u0 + 0.25, v1 = 1 - Math.floor(cel / 4) / 4, v0 = v1 - 0.25;
    const c4 = [P0, P1, a3.copy(P1).setZ(z + lh).clone(), P0.clone().setZ(z + lh)], uv4 = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(c4[i].x, c4[i].y, c4[i].z); uv.push(uv4[i][0], uv4[i][1]); }
  };
  // (a placa do quilômetro um pouco antes do marco, para quem está no refúgio olhando o trem chegar a ver de frente)
  for (let s = Math.ceil(Math.max(t.ta, -RAIO_PLACAS) / 100) * 100; s <= Math.min(t.tb, RAIO_PLACAS); s += 100) {
    const r = (km0 + (s - t.ta) / 1000).toFixed(1).replace('.', ',');
    if (cKm[r] != null) placa(s - 12, mL + 0.03, 1.7, 0.9, 0.45, cKm[r], 1);
  }
  // sobre cada nicho, a placa de bandeira (perpendicular à parede, das duas faces): é o que se vê ao longo do túnel
  for (const c of nichos) for (const lado of [1, -1] as const) bandeira(c + lado * 0.01, mP - 0.08, mP - 0.78, topoNicho + 0.08, 0.35, Math.round(c / TUNEL.nicho.cada) % 2 === 0 ? cSaida : cRef, lado);
  /** placa perpendicular à parede, de m0 a m1 na abscissa s, com a face virada para s crescente (lado 1) ou decrescente */
  function bandeira(s: number, m0: number, m1: number, z: number, lh: number, cel: number, lado: 1 | -1) {
    const A = new THREE.Vector3(...lg.mundo(s, m0, z)), B = new THREE.Vector3(...lg.mundo(s, m1, z));
    const fora = new THREE.Vector3(...lg.mundo(s + lado, m0, z)).sub(A), n = b3.copy(B).sub(A).cross(w.set(0, 0, 1));
    const [P0, P1] = n.dot(fora) > 0 ? [A, B] : [B, A];
    const u0 = (cel % 4) / 4, u1 = u0 + 0.25, v1 = 1 - Math.floor(cel / 4) / 4, v0 = v1 - 0.25;
    const c4 = [P0, P1, P1.clone().setZ(z + lh), P0.clone().setZ(z + lh)], uv4 = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(c4[i].x, c4[i].y, c4[i].z); uv.push(uv4[i][0], uv4[i][1]); }
  }
  for (let s = Math.ceil(Math.max(t.ta, -RAIO_PLACAS) / 25) * 25; s <= Math.min(t.tb, RAIO_PLACAS); s += 25) {
    const d = (((s % 100) + 100) % 100);
    if (d === 0 || nichos.some((c) => Math.abs(c - s) < 3)) continue;
    placa(s, mP - 0.035, pas + TUNEL.corrimao + 0.25, 0.7, 0.35, dist[d], -1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos.length ? pos : [0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv.length ? uv : [0, 0, 0, 0, 0, 0], 2));
  void pas;
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex }));
}

/** o morro por cima do tubo e o emboque das duas bocas (na reta) */
export function morroEEmboque(G: THREE.Group, lg: Lugar): THREE.Object3D {
  const t = lg.tun!, tubo: TuboTunel = { ta: t.ta, tb: t.tb, mPerto: t.mPerto, mLonge: t.mLonge, h: t.h }, e = emboque(tubo);
  const largMorro = MORRO.topo + MORRO.crista / MORRO.rampaLado + 4;
  const subida = MORRO.crista - e.alto, alaFim = e.alto / MORRO.alas;
  const ss = grade(t.ta - e.alto - 30, t.tb + e.alto + 30, 30, [t.ta - e.alto, t.ta - 0.02, t.ta, t.ta + subida / 2, t.ta + subida, t.tb - subida, t.tb - subida / 2, t.tb, t.tb + 0.02, t.tb + e.alto]);
  const quinasM: number[] = [];
  for (const sg of [-1, 1]) quinasM.push(e.mc + sg * (e.meia - 0.02), e.mc + sg * e.meia, e.mc + sg * (e.meia + alaFim / 2), e.mc + sg * (e.meia + alaFim), e.mc + sg * MORRO.topo);
  quinasM.push(t.mLonge, t.mPerto);
  const ms = grade(e.mc - largMorro, e.mc + largMorro, 12, quinasM);
  const pedra = 0x8a8273, grama = [0x5d7f3e, 0x557838, 0x66884a, 0x4f7036];
  const cor = (z: number, s: number, m: number) => {
    const naFace = (Math.abs(s - t.ta) < 0.1 || Math.abs(s - t.tb) < 0.1) || (Math.abs(Math.abs(m - e.mc) - e.meia) < 0.1 && (s < t.ta || s > t.tb));
    if (naFace) return pedra;
    return grama[(Math.floor(s / 37) + Math.floor(m / 23) + (z > 18 ? 1 : 0)) & 3];
  };
  // (a face do emboque na frente da abertura do tubo não é desenhada: ali o tubo continua; a grade tem as quinas da
  // abertura nas linhas, e as células da face que caem dentro dela saem)
  const mor = terreno(lg, ss, ms, (s, m) => alturaMorro(tubo, s, m), cor);
  const morro = recortarAbertura(mor, lg, tubo); G.add(morro);
  // a testa de concreto: os dois pilares, a verga e a abóbada da boca; as alas na lateral do vale de acesso
  const conc = fosco(0x8d8a83), conc2 = fosco(0x76736c), mc = (t.mPerto + t.mLonge) / 2, meia = (t.mPerto - t.mLonge) / 2;
  for (const [sa, sb] of [[t.ta - 0.7, t.ta + 0.05], [t.tb - 0.05, t.tb + 0.7]] as const) {
    G.add(prisma(lg, sa, sb, 1, [[e.mc - e.meia, 0], [e.mc - e.meia, e.alto], [t.mLonge, e.alto], [t.mLonge, 0]], conc, true));
    G.add(prisma(lg, sa, sb, 1, [[t.mPerto, 0], [t.mPerto, e.alto], [e.mc + e.meia, e.alto], [e.mc + e.meia, 0]], conc, true));
    // a verga acima da abóbada e os dois lados dela (o arco da boca acompanha a abóbada do tubo)
    const arco: [number, number][] = [];
    for (let i = 0; i <= 10; i++) { const u = -1 + (2 * i) / 10; arco.push([mc + u * meia, t.h + FLECHA * (1 - u * u)]); }
    for (let i = 0; i < 10; i++) G.add(prisma(lg, sa, sb, 1, [[arco[i][0], arco[i][1]], [arco[i][0], e.alto + 0.01], [arco[i + 1][0], e.alto + 0.01], [arco[i + 1][0], arco[i + 1][1]]], conc, true));
    // a cornija em cima da testa
    G.add(prisma(lg, sa - 0.25, sb + 0.25, 1, [[e.mc - e.meia - 0.3, e.alto], [e.mc - e.meia - 0.3, e.alto + 0.35], [e.mc + e.meia + 0.3, e.alto + 0.35], [e.mc + e.meia + 0.3, e.alto]], conc2, true));
  }
  const alas = new Malha(lg);
  for (const sg of [-1, 1]) {
    const m = e.mc + sg * (e.meia - 0.04);
    alas.quad([t.ta - e.alto, m, 0], [t.ta, m, 0], [t.ta, m, e.alto]);
    alas.quad([t.tb + e.alto, m, 0], [t.tb, m, 0], [t.tb, m, e.alto]);
  }
  G.add(alas.mesh(conc));
  G.traverse((o) => { o.receiveShadow = true; if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  // (a malha do morro: a cena esconde quando você está dentro do tubo, onde ela não se vê e só custaria pixels)
  return morro;
}

/** tira da malha do morro os triângulos da face das bocas que ficam na frente da abertura do tubo */
function recortarAbertura(mor: THREE.Mesh, lg: Lugar, t: TuboTunel) {
  const g = mor.geometry, p = g.attributes.position as THREE.BufferAttribute, c = g.attributes.color as THREE.BufferAttribute;
  const pos: number[] = [], cor: number[] = [], q = { s: 0, m: 0 };
  for (let i = 0; i < p.count; i += 3) {
    let sm = 0, mm = 0, zmax = 0, s0 = Infinity, s1 = -Infinity;
    for (let k = 0; k < 3; k++) { lg.projetar(p.getX(i + k), p.getY(i + k), q); sm += q.s / 3; mm += q.m / 3; zmax = Math.max(zmax, p.getZ(i + k)); s0 = Math.min(s0, q.s); s1 = Math.max(s1, q.s); }
    const naFace = (s1 - s0 < 0.1) && (Math.abs(sm - t.ta) < 0.1 || Math.abs(sm - t.tb) < 0.1);
    if (naFace && mm > t.mLonge - 0.1 && mm < t.mPerto + 0.1 && zmax <= emboque(t).alto + 1e-3) continue;
    for (let k = 0; k < 3; k++) { pos.push(p.getX(i + k), p.getY(i + k), p.getZ(i + k)); cor.push(c.getX(i + k), c.getY(i + k), c.getZ(i + k)); }
  }
  const ng = new THREE.BufferGeometry();
  ng.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); ng.setAttribute('color', new THREE.Float32BufferAttribute(cor, 3)); ng.computeVertexNormals();
  g.dispose(); mor.geometry = ng;
  return mor;
}
