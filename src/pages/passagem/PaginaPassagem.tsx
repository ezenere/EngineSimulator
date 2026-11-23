// Página Passagem / modo de testes: qualquer portador passando por um lugar, com a Cena nova (src/scene/) no
// AudioWorklet. Você é o observador: a câmera da cena 3D é o seu olho e o ouvinte da Cena é o seu ouvido (você ouve de
// onde está, olhando para onde olha), a pé, voando ou embarcado. O React monta a estrutura; o estado e as mensagens
// para o DSP ficam em ControlePassagem, e a cena 3D, o observador e os mostradores andam num só requestAnimationFrame.
//
// A cena 3D é carregada sob demanda (import dinâmico, chunk próprio com o three.js): o áudio não espera por ela e, sem
// WebGL, a página continua com os mostradores (o observador anda e ouve do mesmo jeito).
import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { AudioShell, Barra, BotaoIgnicao, Faixa, FamilyNav, PERFIL_PASSAGEM, useAudioShell } from '../../ui';
import { CenaDSP } from '../../scene/dsp-cena';
import urlCena from '../../worklet/processador-cena.ts?worker&url';
import { ControlePassagem, fmt, useTopico, TECLAS } from './controle';
import { Painel } from './Painel';
import { AMBIENTES, PORTADORES, PRESETS_PASSAGEM } from './presets';
import { Medidor, Espectro, Osciloscopio, desenharPressao, escreverLeituras, textoHud, textoOnde, type Leituras } from './mostradores';
import type { Cena3D } from './cena3d';
import { EntradaCena } from './entrada';
import type { ModoObservador } from './observador';

/**
 * (AUDITORIA.md P-07) A calibração dos motores (1–9 s de sonda) roda num Web Worker, fora da thread principal: a página
 * não trava ao carregar um preset com motor. Sem worker (navegador sem módulos em worker), o controle calibra na hora.
 */
function criarCalibrador(): ControlePassagem['calibrador'] {
  if (typeof Worker === 'undefined') return null;
  let w: Worker;
  try { w = new Worker(new URL('./calibracao.worker.ts', import.meta.url), { type: 'module' }); } catch { return null; }
  let n = 0;
  const esperando = new Map<number, { ok: (c: Record<string, any>) => void; erro: (e: Error) => void }>();
  w.onmessage = (e: MessageEvent<{ n: number; cfg?: Record<string, any>; erro?: string }>) => {
    const p = esperando.get(e.data.n); if (!p) return;
    esperando.delete(e.data.n);
    if (e.data.cfg) p.ok(e.data.cfg); else p.erro(new Error(e.data.erro || 'calibração'));
  };
  w.onerror = () => { for (const p of esperando.values()) p.erro(new Error('o worker de calibração falhou')); esperando.clear(); };
  return (pedido) => new Promise((ok, erro) => { const k = ++n; esperando.set(k, { ok, erro }); w.postMessage({ n: k, pedido }); });
}

export function PaginaPassagem() {
  const [c] = useState(() => { const x = new ControlePassagem(); x.calibrador = criarCalibrador(); return x; });
  return (
    <AudioShell perfil={PERFIL_PASSAGEM} moduloUrl={urlCena} processador="cena" criarDspLocal={(fs) => new CenaDSP(fs)}
      ambiente="passagem" medidor aoMensagem={c.onTelemetria}>
      <Conteudo c={c} />
    </AudioShell>
  );
}

function Conteudo({ c }: { c: ControlePassagem }) {
  const { iniciar } = useAudioShell();
  c.iniciar = iniciar;
  const cv3d = useRef<HTMLCanvasElement>(null), cvP = useRef<HTMLCanvasElement>(null), cvE = useRef<HTMLCanvasElement>(null), cvO = useRef<HTMLCanvasElement>(null);
  const hud = useRef<HTMLPreElement>(null);
  const leituras = useRef<Leituras>({});
  const cena = useRef<Cena3D | null>(null);
  const [aviso3d, setAviso3d] = useState('carregando a cena 3D…');
  const [recolhido, setRecolhido] = useState(false);
  const [travado, setTravado] = useState(false);

  useEffect(() => {
    let vivo = true;
    // cena 3D sob demanda
    import('./cena3d').then((m) => {
      if (!vivo || !cv3d.current) return;
      try {
        cena.current = new m.Cena3D(cv3d.current, c); setAviso3d('');
      } catch (e) { setAviso3d(`Sem cena 3D (${String((e as Error)?.message || e)}); o som e os mostradores continuam.`); }
    }, (e) => setAviso3d(`A cena 3D não carregou (${String(e?.message || e)}); o som e os mostradores continuam.`));
    const med = new Medidor(), esp = new Espectro(), osc = new Osciloscopio();
    // mouse e toque sobre a cena (olhar); as teclas, na janela
    const ent = cv3d.current ? new EntradaCena(c, cv3d.current) : null;
    if (ent) ent.aoMudar = () => setTravado(ent.travado);
    window.addEventListener('keydown', c.keydown);
    window.addEventListener('keyup', c.keyup);
    window.addEventListener('blur', c.soltarTeclas);
    c.ajudaDesde = performance.now();
    (window as unknown as { __passagem: unknown }).__passagem = { c, cena, med };
    let id = 0, n = 0, ant = performance.now();
    const frame = (agora: number) => {
      // o observador anda primeiro: a câmera e o ouvido do quadro saem da mesma posição
      c.passoObservador((agora - ant) / 1000); ant = agora;
      c.enviarPendentes(agora);
      const k = cena.current;
      if (k) { k.quadro(agora); if (cv3d.current) cv3d.current.dataset.quadros = String(k.quadros); }
      med.medir(c);
      escreverLeituras(c, med, leituras.current, agora);
      if ((n++ & 1) === 0) {
        if (cvP.current) desenharPressao(c, cvP.current);
        if (cvE.current) esp.desenhar(c, cvE.current);
        if (cvO.current) osc.desenhar(c, cvO.current);
        if (hud.current) { const t = textoHud(c, med); if (hud.current.textContent !== t) hud.current.textContent = t; }
        const lo = c.leituraOnde;
        if (lo) { const t = textoOnde(c, c.estimativa(agora).s); if (lo.textContent !== t) lo.textContent = t; }
      }
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => {
      vivo = false;
      cancelAnimationFrame(id);
      window.removeEventListener('keydown', c.keydown);
      window.removeEventListener('keyup', c.keyup);
      window.removeEventListener('blur', c.soltarTeclas);
      ent?.descartar();
      cena.current?.descartar(); cena.current = null;
    };
  }, [c]);

  // leituras e gráficos no painel, fora da parte que ele remonta (os campos e os canvas que o quadro escreve ficam)
  const extra = (
    <>
      <Grupo titulo="Leituras"><Telemetria leituras={leituras} /></Grupo>
      <Grupo titulo="Gráficos" classe="graficos">
        <figure className="grafico"><figcaption className="legenda">Onda de pressão no ouvinte</figcaption><div className="quadro"><canvas id="pressao" ref={cvP} role="img" aria-label="Pressão do ar no ouvinte nos últimos 11 segundos: onda de nariz e cauda e onda do túnel" /></div></figure>
        <figure className="grafico"><figcaption className="legenda">Espectrograma e espectro</figcaption><div className="quadro"><canvas id="espectro" ref={cvE} role="img" aria-label="Espectrograma rolante e espectro do som no ouvinte" /></div></figure>
        <figure className="grafico"><figcaption className="legenda">Forma de onda</figcaption><div className="quadro"><canvas id="osc" ref={cvO} role="img" aria-label="Forma de onda do som no ouvinte" /></div></figure>
      </Grupo>
    </>
  );

  return (
    <div className={`app passagem${recolhido ? ' painel-recolhido' : ''}`}>
      <Barra logo="Passagem" placa={<Placa c={c} />}><Disparar c={c} /></Barra>
      <Presets c={c} />
      <main className="palco">
        <section className="vista3d quadro" aria-label="Cena 3D: você no lugar">
          <canvas id="cena3d" ref={cv3d} tabIndex={0} aria-label="Cena 3D em primeira pessoa. Clique para olhar com o mouse; W A S D anda, Shift corre, V voa, B embarca, 1 a 9 são os pontos de vista, H mostra as teclas" />
          <div className="sobre">
            <pre className="hud mono" id="hud" ref={hud} aria-hidden="true" />
            <div className="rapido">
              <ModoRapido c={c} />
              <button type="button" className="chip" id="recolher" aria-expanded={!recolhido} aria-controls="controls" title={recolhido ? 'Mostrar o painel' : 'Recolher o painel: a cena fica com a tela toda'} onClick={() => setRecolhido(!recolhido)}>{recolhido ? 'Painel' : 'Recolher painel'}</button>
            </div>
          </div>
          <Ajuda c={c} travado={travado} />
          <Manche c={c} />
          {aviso3d && <p className="aviso3d" id="aviso3d" role="status">{aviso3d}</p>}
        </section>
      </main>
      <Painel c={c} extra={extra} recolhido={recolhido} />
    </div>
  );
}

/** seção simples do painel (sem remontar) */
function Grupo({ titulo, classe = '', children }: { titulo: string; classe?: string; children: ReactNode }) {
  return <section className={`group ${classe}`.trim()}><h2>{titulo}</h2>{children}</section>;
}

/** a pé, voando, embarcado: os três modos à mão, sobre a cena */
function ModoRapido({ c }: { c: ControlePassagem }) {
  useTopico(c, 'ouvinte');
  const m = c.obs.modo;
  const op: [ModoObservador, string, string][] = [['pe', 'A pé', 'V'], ['voo', 'Voando', 'V'], ['embarcado', 'Embarcado', 'B']];
  return (
    <div className="chips camera" role="group" aria-label="Como você está">
      {op.map(([v, r, k]) => <button key={v} type="button" className="chip" data-modo={v} aria-pressed={m === v} title={`${r} (tecla ${k})`} onClick={() => c.setModoObservador(v)}>{r}</button>)}
    </div>
  );
}

/** o mapa das teclas, pequeno, sobre a cena: aparece ao abrir e com H, e some sozinho */
function Ajuda({ c, travado }: { c: ControlePassagem; travado: boolean }) {
  useTopico(c, 'ouvinte');
  const [visivel, setVisivel] = useState(true);
  const desde = c.ajudaDesde;
  useEffect(() => { setVisivel(true); const t = setTimeout(() => setVisivel(false), 9000); return () => clearTimeout(t); }, [desde]);
  return (
    <div className="ajuda" id="ajuda" hidden={!visivel} role="note" aria-label="Teclas">
      <b>{travado ? 'Olhando com o mouse (Esc solta)' : 'Clique na cena para olhar com o mouse'}</b>
      <dl>{TECLAS.map(([k, o]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{o}</dd></div>)}</dl>
      <p className="so-toque">No celular: arraste na cena para olhar; o círculo anda.</p>
    </div>
  );
}

/** controle de andar na tela de toque: o círculo (frente e lado) e, voando, subir e descer */
function Manche({ c }: { c: ControlePassagem }) {
  useTopico(c, 'ouvinte');
  const base = useRef<HTMLDivElement>(null), bola = useRef<HTMLSpanElement>(null), dedo = useRef<number | null>(null);
  const mover = (e: React.PointerEvent) => {
    const el = base.current; if (!el || dedo.current !== e.pointerId) return;
    const r = el.getBoundingClientRect(), R = r.width / 2;
    let dx = (e.clientX - (r.left + R)) / R, dy = (e.clientY - (r.top + R)) / R;
    const n = Math.hypot(dx, dy); if (n > 1) { dx /= n; dy /= n; }
    c.toque.frente = -dy; c.toque.lado = dx; c.atualizarEntrada();
    if (bola.current) bola.current.style.transform = `translate(${dx * R * 0.6}px, ${dy * R * 0.6}px)`;
  };
  const soltar = () => { dedo.current = null; c.toque.frente = 0; c.toque.lado = 0; c.atualizarEntrada(); if (bola.current) bola.current.style.transform = ''; };
  const sobe = (v: number) => () => { c.toque.sobe = v; c.atualizarEntrada(); };
  return (
    <div className="manche">
      <div className="manche-base" ref={base} role="application" aria-label="Andar: arraste o círculo"
        onPointerDown={(e) => { dedo.current = e.pointerId; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); mover(e); }}
        onPointerMove={mover} onPointerUp={soltar} onPointerCancel={soltar}>
        <span className="manche-bola" ref={bola} />
      </div>
      {c.obs.modo === 'voo' && <div className="manche-alto">
        <button type="button" className="chip" onPointerDown={sobe(1)} onPointerUp={sobe(0)} onPointerLeave={sobe(0)}>Subir</button>
        <button type="button" className="chip" onPointerDown={sobe(-1)} onPointerUp={sobe(0)} onPointerLeave={sobe(0)}>Descer</button>
      </div>}
    </div>
  );
}

function Placa({ c }: { c: ControlePassagem }) {
  useTopico(c, 'presets', 'painel');
  const p = PORTADORES.find((x) => x.id === c.portador)!;
  const corpo = c.portador === 'trem' ? `${c.trem.N} vagões · ${fmt(c.corpo.comprimento, 1)} m` : `${fmt(c.corpo.comprimento, 1)} m`;
  const onde = c.traj.altitude > 0 ? `a ${fmt(c.traj.altitude)} m de altura` : `chegada a ${fmt(c.traj.lateral, 1)} m da lateral`;
  const lugar = AMBIENTES.find((a) => a.id === c.ambiente)?.nome.toLowerCase() ?? c.ambiente;
  return <span id="plate">{`${p.nome} · ${corpo} · ${fmt(c.vKmh)} km/h · ${onde} · ${lugar}`}</span>;
}

function Disparar({ c }: { c: ControlePassagem }) {
  useTopico(c, 'estado');
  const rot = c.erro ? `Erro no áudio: ${c.erro}` : c.andando ? 'Parar' : c.calibrando ? 'Calibrando o motor…' : 'Disparar passagem';
  return <BotaoIgnicao id="ignicao" ligado={c.andando} rotulo={rot} estado={c.erro ? 'erro' : undefined} aoClicar={() => (c.andando ? c.parar() : c.disparar())} />;
}

// famílias das passagens prontas, pelo que passa (a mesma navegação das outras páginas)
const FAMILIAS_PASSAGEM: { id: string; name: string; de: string[] }[] = [
  { id: 'trens', name: 'Trens', de: ['trem'] },
  { id: 'estrada', name: 'Carros e tanque', de: ['carro', 'trator'] },
  { id: 'avioes', name: 'Aviões', de: ['helice', 'aviao'] },
  { id: 'locomotivas', name: 'Locomotivas', de: ['locomotiva'] },
  { id: 'outros', name: 'Helicóptero, drone e gerador', de: ['rotor', 'drone', 'gerador', 'barco'] },
];
const familiaDe = (portador: string) => FAMILIAS_PASSAGEM.find((f) => f.de.includes(portador))?.id ?? 'outros';
const CONTAGEM = PRESETS_PASSAGEM.map((p) => ({ family: familiaDe(p.portador) }));

function Presets({ c }: { c: ControlePassagem }) {
  useTopico(c, 'presets');
  const [familia, setFamilia] = useState(() => familiaDe(PRESETS_PASSAGEM.find((p) => p.id === c.presetId)?.portador ?? c.portador));
  // a família acompanha o preset carregado (também quando ele vem de fora: teclado, testes)
  useEffect(() => {
    const p = PRESETS_PASSAGEM.find((x) => x.id === c.presetId);
    if (p) setFamilia(familiaDe(p.portador));
  }, [c.presetId]);
  return (
    <nav className="presets" id="presets" aria-label="Passagens prontas">
      <FamilyNav familias={FAMILIAS_PASSAGEM} presets={CONTAGEM} atual={familia} aoEscolher={setFamilia} />
      <Faixa className="cars" rotulo="Passagens da família" marca={`${familia}:${c.presetId}`}>
        {/* todas ficam na página (as das outras famílias, escondidas) */}
        {c.presetsVisiveis().map((p) => (
          <button key={p.id} type="button" className="preset" data-id={p.id} aria-pressed={p.id === c.presetId} disabled={!p.situacao.ok}
            hidden={familiaDe(p.portador) !== familia}
            title={p.situacao.ok ? p.sub : p.situacao.motivo} onClick={() => c.carregarPreset(p)}>
            <b>{p.nome}</b><small>{p.situacao.ok ? p.sub : 'espera o motor'}</small>
          </button>
        ))}
      </Faixa>
    </nav>
  );
}

const Telemetria = memo(function Telemetria({ leituras }: { leituras: { current: Leituras } }) {
  const linha = (k: string, id: string, grande = false, dica?: string) => (
    <div className={`ro-row${grande ? ' grande' : ''}${k ? '' : ' sem-nome'}`} title={dica}><span className="k">{k || '·'}</span><span className="v mono" id={`ro-${id}`} ref={(e) => { if (e) leituras.current[id] = e; }}>—</span></div>
  );
  return (
    <div className="telemetria readout" aria-label="Leituras da cena">
      {linha('No ouvido', 'nivel', true, 'Nível com ponderação A no ouvido, somando o som direto e o eco do lugar')}
      {linha('', 'nivelZ', false, 'Nível sem ponderação e o máximo desta passagem')}
      {linha('Direto', 'direto', false, 'Só o som que vem direto das fontes')}
      {linha('Você', 'onde', false, 'Como você está, onde, e a que distância do veículo')}
      {linha('Velocidade', 'v')}
      {linha('Posição', 'nariz', false, 'Onde o nariz do corpo está em relação a você')}
      {linha('Doppler', 'doppler', false, 'Quanto a frequência sobe ou desce para a fonte mais próxima, contando o seu passo')}
      {linha('Pressão', 'pressao', false, 'Onda de pressão do nariz e da cauda no ouvinte, agora e o pico')}
      {linha('Túnel', 'tunel', false, 'Onda de compressão que o trem empurra pelo túnel')}
      {linha('Vento', 'vento', false, 'Vento que o corpo arrasta até você')}
      {linha('Local', 'local', false, 'Filtro do lugar onde você está: fora, cabine, cofre ou ponteira')}
    </div>
  );
});
