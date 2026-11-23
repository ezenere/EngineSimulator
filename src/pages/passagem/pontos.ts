// Pontos de vista da Passagem: o ponto de chegada de cada preset e os teletransportes do painel (os atalhos do gimbal de
// antes, CENA.md 3.2, traduzidos para lugares onde uma pessoa fica). Os do mundo deixam o observador a pé; os do
// veículo o põem embarcado (no assento, ou junto do veículo, por fora, andando com ele).
//
// Assentos: a página não tem o assento de cada portador (o Corpo só tem as caixas dos segmentos); ele sai daqui, das
// medidas do corpo: a cabine do carro (o ponto do CENA 3.2, [−0,3; 0,4; 1,1]), a cabine do maquinista do trem e da
// locomotiva, a cabine do helicóptero e, no avião de hélice, a cabine do modelo (atrás da hélice: o corpo do portador
// tem 27 m para todos os aviões e o modelo fica ancorado na hélice). Onde não há interior (gerador, drone, trator, barco,
// VANT), o ponto junto do motor, fora da caixa: o local 'auto' fica 'fora'. Embarcado, a cena 3D mostra o interior do
// veículo em volta do assento (modelos/interior.ts); a caixa em que o olho anda é a da cabine.
import type { ControlePassagem } from './controle';
import type { Destino, V3 } from './observador';
import { OLHO, OUVIDO_ABAIXO } from './observador';
import { PLATAFORMA } from './lugar';
import { paramsHelice, olhoPilotoHelice, tipoCarro } from './modelos/tipos';

export interface PontoDeVista { id: string; nome: string; titulo: string; ok: boolean; ir?: () => Destino }

const clampP = (a: number) => Math.max(-0.35, Math.min(0.75, a));
/** rumo e arfagem de um olho para um alvo */
function mirar(de: readonly number[], para: readonly number[]) {
  const dx = para[0] - de[0], dy = para[1] - de[1], dz = para[2] - de[2];
  return { rumo: Math.atan2(dy, dx), arfagem: clampP(Math.atan2(dz, Math.hypot(dx, dy))) };
}
/** lado do corpo voltado para o ponto de chegada, no referencial do corpo (+1 esquerda, −1 direita) */
const ladoChegada = (c: ControlePassagem) => (c.traj.sentido === 1 ? -1 : 1);
/** abscissa da via do observador agora (ou do último ponto fora do veículo) */
function sAgora(c: ControlePassagem) { return c.sOuvinte(); }

/** para onde olhar de um ponto ao lado da via em s: o veículo chegando (ou o veículo parado) */
function alvoChegando(c: ControlePassagem, s: number): V3 {
  const lg = c.lugar(), L = c.corpo.comprimento, h = c.corpo.segmentos[0]?.altura ?? 2, alt = c.traj.altitude;
  const parado = c.vKmh < 1 || c.partida;
  if (parado) {
    // o nariz do veículo onde ele espera (disparar põe o nariz a x0 antes do ouvinte), olhando para a parte da frente
    const sN = s - c.x0;
    return lg.mundo(sN - Math.min(L / 2, 8), 0, alt + h / 2);
  }
  // no ar: onde ele aparece; no chão: a via 45 m antes (o veículo vem por ela)
  if (alt > 2) return lg.mundo(s - c.x0, 0, alt + h / 2);
  return lg.mundo(s - Math.min(c.x0, 45), 0, h / 2);
}

/** o ponto de chegada: ao lado da via, à distância da lateral do preset, olhando o veículo chegar */
export function pontoDeChegada(c: ControlePassagem): Destino {
  const lg = c.lugar(), w = c.corpo.segmentos[0]?.largura ?? 2;
  const m = c.traj.lateral + w / 2, s = 0;
  const p0 = lg.mundo(s, m, 0), z = lg.chao(p0[0], p0[1]) + OLHO;
  const olho = lg.mundo(s, m, z);
  const a = mirar(olho, alvoChegando(c, s));
  // (o que passa alto: a cabeça para onde ele aparece, mas sem perder o chão e o horizonte do quadro)
  if (c.traj.altitude > 2) a.arfagem = Math.min(a.arfagem, 0.3);
  return { modo: 'pe', pos: olho, rumo: a.rumo, arfagem: a.arfagem, nome: 'no ponto de chegada' };
}

/** caixa do segmento k no referencial do corpo, com folga */
function caixaSeg(c: ControlePassagem, k: number, folga = 0.25) {
  const sg = c.corpo.segmentos; let frente = c.corpo.comprimento / 2;
  for (let i = 0; i < k; i++) frente -= sg[i].comprimento + sg[i].vao;
  const s = sg[k];
  return { x0: frente - s.comprimento + folga, x1: frente - folga, y0: -s.largura / 2 + folga, y1: s.largura / 2 - folga, z0: s.zPiso + 0.5, z1: s.altura - folga };
}
const dentroDaCaixa = (b: ReturnType<typeof caixaSeg>, p: V3) => p[0] >= b.x0 && p[0] <= b.x1 && p[1] >= b.y0 && p[1] <= b.y1 && p[2] >= b.z0 && p[2] <= b.z1;

/** o assento (ou o ponto junto do motor) do portador, no referencial do corpo */
export function assento(c: ControlePassagem): Destino {
  const k = c.corpo, s0 = k.segmentos[0], L = k.comprimento, frente = L / 2;
  const lado = ladoChegada(c);
  let pos: V3, nome: string, rumo = 0, arfagem = -0.05;
  /** a cabine em volta do olho, onde se anda embarcado: meia largura em x, y e z (e em x, de quanto a quanto) */
  let cab: [number, number, number] | null = null, cabX: [number, number] | null = null;
  const vapor = c.motor === 'vapor';
  if (c.portador === 'carro') {
    pos = [-0.3, 0.37, s0.zPiso + 1.0]; nome = 'no banco do motorista'; cabX = [-1.1, 0.45];
    // (a cabeça um pouco para baixo, para ver o capô, o tanque da moto, o casco do tanque: só a vista; o som não muda)
    const t = tipoCarro(c.motor, c.motorPreset ?? '').tipo;
    arfagem = t === 'tanque' ? -0.3 : t === 'moto' ? -0.22 : t === 'formula' || t === 'gp-antigo' ? -0.12 : -0.09;
  }
  else if (c.portador === 'trem') { pos = [frente - Math.max(2.5, 0.75 * k.nariz + 0.5), 0, s0.zPiso + 1.75]; nome = 'na cabine do maquinista'; }
  else if (c.portador === 'locomotiva' && !vapor) { pos = [frente - 2.2, 0.6, s0.zPiso + 2.9]; nome = 'na cabine da locomotiva'; cabX = [-1.4, 0.6]; }
  else if (c.portador === 'locomotiva') {
    // estrado entre a máquina e o tênder (fora das caixas): onde o maquinista e o foguista ficam
    const x = frente - s0.comprimento - Math.max(0.3, s0.vao / 2);
    pos = [x, 0.5, s0.zPiso + 1.0 + OLHO]; nome = 'no estrado da locomotiva';
  } else if (c.portador === 'helice') {
    // a cabine do modelo (modelos/tipos.ts), atrás da hélice; o VANT não tem cabine: junto dele, por fora
    const pas = c.fontes.filter((f) => f.tipo === 'pa').map((f) => f.pos), olho = olhoPilotoHelice(paramsHelice(c.motor, c.motorPreset ?? ''), pas);
    if (olho) { pos = [olho[0], olho[1], olho[2]]; nome = 'na cabine do avião'; cab = [0.35, 0.22, 0.12]; }
    else { const h = pas[0] ?? [3.3, 0, 1.5]; pos = [h[0] - 1.2, lado * 2.2, h[2]]; rumo = -lado * Math.PI / 2; nome = 'junto do VANT'; }
  } else if (c.portador === 'aviao') {
    // (o jato de linha: a janela do lado do ponto de chegada, olhando para fora; o caça: a cabine)
    pos = L > 25 ? [-2, lado * (s0.largura / 2 - 0.6), s0.zPiso + 1.7] : [frente - 3.5, 0, s0.zPiso + 2.6];
    nome = L > 25 ? 'na janela, atrás da asa' : 'na cabine do caça';
    if (L > 25) { rumo = lado * Math.PI / 2; cabX = [-6.3, 6.3]; cab = [0, 3, 0.25]; } else cab = [0.35, 0.2, 0.12];
  } else if (c.portador === 'rotor') { pos = [frente - 3, 0.35, s0.zPiso + 1.0]; nome = 'na cabine do helicóptero'; cab = [0.35, 0.3, 0.12]; }
  else if (c.portador === 'gerador') {
    const m = c.fontes.find((f) => f.tipo === 'mecanica')?.pos[0] ?? 0;
    pos = [m, lado * (s0.largura / 2 + 1.2), OLHO]; rumo = -lado * Math.PI / 2; nome = 'junto do motor';
  } else if (c.portador === 'drone') { pos = [0, lado * 1.5, -0.2]; rumo = -lado * Math.PI / 2; arfagem = 0.05; nome = 'junto do drone'; }
  else if (c.portador === 'barco') { pos = [-0.25 * L, 0, s0.altura + OLHO]; nome = 'no convés'; }
  else { pos = [-L / 2 - 0.6, 0, s0.zPiso + 0.7 + OLHO]; nome = 'na plataforma de trás'; }   // trator e o que mais vier
  // dentro de um segmento: pode andar nele (a caixa com folga, ou só a cabine); fora, anda livre junto do corpo. A cabine
  // do avião que fica fora da caixa do corpo (o turboélice, alto: o modelo segue a hélice) é a cabine assim mesmo
  const cx = caixaSeg(c, 0), dentro = dentroDaCaixa(cx, pos);
  let caixa = dentro ? cx : undefined, local: Destino['local'];
  if (cab || cabX) {
    const b = caixa ?? { x0: -Infinity, x1: Infinity, y0: -Infinity, y1: Infinity, z0: -Infinity, z1: Infinity };
    const [dx, dy, dz] = cab ?? [0, Infinity, Infinity], [ax, bx] = cabX ?? [-dx, dx];
    caixa = { x0: Math.max(b.x0, pos[0] + ax), x1: Math.min(b.x1, pos[0] + bx), y0: Math.max(b.y0, pos[1] - dy), y1: Math.min(b.y1, pos[1] + dy), z0: Math.max(b.z0, pos[2] - dz), z1: Math.min(b.z1, pos[2] + dz) };
    if (!dentro) local = 'cabine';
  }
  return { modo: 'embarcado', pos, rumo, arfagem, caixa, nome, local };
}

/** os pontos de vista do painel, na ordem das teclas 1–9 (só os que existem no portador e no lugar) */
export function pontosDeVista(c: ControlePassagem): PontoDeVista[] {
  const k = c.corpo, L = k.comprimento, s0 = k.segmentos[0], h = s0?.altura ?? 2, w = s0?.largura ?? 2;
  const f = (id: string) => c.fontes.find((x) => x.id === id);
  const escape = c.fontes.find((x) => x.tipo === 'escape');
  const dentro = c.fontes.find((x) => x.dentro);
  const topo = c.fontes.find((x) => x.tipo === 'pantografo') ?? f('rotor.principal');
  const lado = ladoChegada(c);
  const lg = c.lugar();
  const amb = c.ambiente;
  const meio = (s0?.zPiso ?? 0) + (h - (s0?.zPiso ?? 0)) / 2;
  const noCorpo = (pos: V3, rumo: number, arfagem: number, nome: string, extra: Partial<Destino> = {}): Destino => ({ modo: 'embarcado', pos, rumo, arfagem, nome, ...extra });
  const lista: PontoDeVista[] = [
    { id: 'chegada', nome: 'Ponto de chegada', titulo: 'Onde o preset põe você: ao lado da via, olhando o veículo chegar', ok: true, ir: () => pontoDeChegada(c) },
    {
      id: 'via', nome: 'Ao lado da via', titulo: 'A 3 m da lateral do veículo (ou na passarela, no passeio, na plataforma mais perto), onde você está ao longo da via', ok: true,
      ir: () => {
        const s = sAgora(c), m = lg.paraFicar(3 + w / 2), p = lg.mundo(s, m, 0), olho = lg.mundo(s, m, lg.chao(p[0], p[1]) + OLHO);
        const a = mirar(olho, alvoChegando(c, s));
        return { modo: 'pe', pos: olho, rumo: a.rumo, arfagem: a.arfagem, nome: 'ao lado da via' };
      },
    },
    {
      id: 'plataforma', nome: 'Na plataforma', titulo: 'Em pé na plataforma, 2,5 m atrás da borda', ok: amb === 'estacao',
      ir: () => {
        const meio = (lg.est?.meio ?? 160) - 20, s = Math.max(-meio, Math.min(meio, sAgora(c))), m = lg.bordaPlataforma + 2.5, olho = lg.mundo(s, m, PLATAFORMA + OLHO);
        const a = mirar(olho, alvoChegando(c, s));
        return { modo: 'pe', pos: olho, rumo: a.rumo, arfagem: a.arfagem, nome: 'na plataforma' };
      },
    },
    {
      id: 'alto', nome: 'Do alto', titulo: 'Voando acima da via, para ver de cima', ok: true,
      ir: () => {
        const s = sAgora(c), alt = c.traj.altitude, z = alt > 2 ? alt + 45 : 28, m = alt > 2 ? 60 : 40;
        const olho = lg.mundo(s - 25, m, z), a = mirar(olho, lg.mundo(s + 20, 0, alt));
        return { modo: 'voo', pos: olho, rumo: a.rumo, arfagem: Math.max(-1.2, Math.atan2(alt - z, Math.hypot(45, m))), nome: 'voando acima da via' };
      },
    },
    { id: 'embarcar', nome: 'Embarcar', titulo: 'No assento do veículo (ou junto do motor, onde não há interior), andando com ele', ok: true, ir: () => assento(c) },
    {
      id: 'escape', nome: 'Atrás do escape', titulo: '1,5 m atrás da ponteira, andando com o veículo', ok: !!escape,
      ir: () => {
        const e = escape!.pos, z = Math.max(0.35, e[2] - 0.26) + OUVIDO_ABAIXO;
        const pos: V3 = [e[0] - 1.5 * Math.cos(0.17), e[1], z];
        return noCorpo(pos, 0, Math.atan2(e[2] - z, 1.5), 'atrás do escape');
      },
    },
    {
      id: 'ponteira', nome: 'Na ponteira', titulo: 'A 0,3 m da ponteira: só ela, as outras fontes −20 dB', ok: !!escape,
      ir: () => { const e = escape!.pos; return noCorpo([e[0] - 0.3, e[1], Math.max(0.3, e[2]) + OUVIDO_ABAIXO], 0, 0, 'na ponteira', { local: 'ponteira', alvo: escape!.id }); },
    },
    { id: 'frente', nome: 'Na frente', titulo: '3 m à frente do nariz, olhando o veículo, andando com ele', ok: true, ir: () => noCorpo([L / 2 + 3, 0, meio + OUVIDO_ABAIXO], Math.PI, 0, 'na frente do veículo') },
    { id: 'lado', nome: 'De lado', titulo: 'A 5 m do centro do veículo, de lado, andando com ele', ok: true, ir: () => noCorpo([0, lado * 5, meio + OUVIDO_ABAIXO], -lado * Math.PI / 2, 0, 'ao lado do veículo') },
    { id: 'atras', nome: 'Atrás', titulo: '4 m atrás da cauda, olhando para a frente, andando com o veículo', ok: true, ir: () => noCorpo([-L / 2 - 4 * Math.cos(0.087), 0, meio + 4 * Math.sin(0.087) + OUVIDO_ABAIXO], 0, -0.087, 'atrás do veículo') },
    {
      id: 'cofre', nome: 'No cofre', titulo: 'No compartimento do motor: as fontes de dentro diretas', ok: !!dentro,
      ir: () => { const d = dentro!.pos; return noCorpo([d[0], d[1] + 0.5, d[2] + OUVIDO_ABAIXO], -Math.PI / 2, 0, 'no cofre', { local: 'cofre' }); },
    },
    {
      id: 'topo', nome: topo?.id.startsWith('rotor') ? 'Sobre o rotor' : 'Sobre o pantógrafo', titulo: '1 m acima, olhando para baixo, andando com o veículo', ok: !!topo,
      ir: () => { const t = topo!.pos; return noCorpo([t[0] - 0.3, t[1], t[2] + 1 + OUVIDO_ABAIXO], 0, -1.25, topo!.id.startsWith('rotor') ? 'sobre o rotor' : 'sobre o pantógrafo'); },
    },
  ];
  return lista;
}
