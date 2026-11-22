// Página Passagem / modo de testes: qualquer portador passando pelo ouvinte, com a Cena nova
// (src/scene/) no AudioWorklet, o ouvinte num gimbal 3D e a cena three.js. O React monta a estrutura;
// o estado e as mensagens para o DSP ficam em ControlePassagem, e a cena 3D e os mostradores são
// desenhados num só requestAnimationFrame lendo a telemetria de um campo.
//
// A cena 3D é carregada sob demanda (import dinâmico, chunk próprio com o three.js): o áudio não espera
// por ela e, sem WebGL, a página continua com os mostradores.
import { memo, useEffect, useRef, useState } from 'react';
import { AudioShell, Barra, BotaoIgnicao, Faixa, FamilyNav, PERFIL_PASSAGEM, useAudioShell } from '../../ui';
import { CenaDSP } from '../../scene/dsp-cena';
import urlCena from '../../worklet/processador-cena.ts?worker&url';
import { ControlePassagem, fmt, useTopico } from './controle';
import { Painel } from './Painel';
import { AMBIENTES, PORTADORES, PRESETS_PASSAGEM } from './presets';
import { Medidor, Espectro, Osciloscopio, desenharPressao, escreverLeituras, textoHud, type Leituras } from './mostradores';
import type { Cena3D, ModoCamera } from './cena3d';

export function PaginaPassagem() {
  const [c] = useState(() => new ControlePassagem());
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
  const [cam, setCam] = useState<ModoCamera>('ouvinte');
  const [aviso3d, setAviso3d] = useState('carregando a cena 3D…');

  useEffect(() => {
    let vivo = true;
    // cena 3D sob demanda
    import('./cena3d').then((m) => {
      if (!vivo || !cv3d.current) return;
      try {
        const k = new m.Cena3D(cv3d.current, c);
        k.aoMudarCamera = () => setCam(k.modo);
        cena.current = k; setAviso3d('');
      } catch (e) { setAviso3d(`Sem cena 3D (${String((e as Error)?.message || e)}); o som e os mostradores continuam.`); }
    }, (e) => setAviso3d(`A cena 3D não carregou (${String(e?.message || e)}); o som e os mostradores continuam.`));
    const med = new Medidor(), esp = new Espectro(), osc = new Osciloscopio();
    window.addEventListener('keydown', c.keydown);
    (window as unknown as { __passagem: unknown }).__passagem = { c, cena, med };
    let id = 0, n = 0;
    const frame = (agora: number) => {
      c.enviarPendentes();
      const k = cena.current;
      if (k) { k.quadro(agora); if (cv3d.current) cv3d.current.dataset.quadros = String(k.quadros); }
      med.medir(c);
      escreverLeituras(c, med, leituras.current, agora);
      if ((n++ & 1) === 0) {
        if (cvP.current) desenharPressao(c, cvP.current);
        if (cvE.current) esp.desenhar(c, cvE.current);
        if (cvO.current) osc.desenhar(c, cvO.current);
        if (hud.current) { const t = textoHud(c, med); if (hud.current.textContent !== t) hud.current.textContent = t; }
      }
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => {
      vivo = false;
      cancelAnimationFrame(id);
      window.removeEventListener('keydown', c.keydown);
      cena.current?.descartar(); cena.current = null;
    };
  }, [c]);

  return (
    <div className="app passagem">
      <Barra logo="Passagem" placa={<Placa c={c} />}><Disparar c={c} /></Barra>
      <Presets c={c} />
      <main className="palco">
        <section className="vista3d quadro" aria-label="Cena 3D">
          <canvas id="cena3d" ref={cv3d} tabIndex={0} aria-label="Cena 3D. Arraste para girar a câmera; arraste a cabeça do ouvinte, o corpo e as setas para mudar a cena; a tecla C troca a câmera" />
          <div className="sobre">
            <pre className="hud mono" id="hud" ref={hud} aria-hidden="true" />
            <div className="camera chips" role="group" aria-label="Câmera">
              {(['ouvinte', 'corpo', 'livre'] as ModoCamera[]).map((m) => (
                <button key={m} type="button" className="chip" aria-pressed={cam === m} data-cam={m} title={m === 'ouvinte' ? 'Gira em volta de você' : m === 'corpo' ? 'Anda junto com o que passa' : 'Fica onde você deixar'}
                  onClick={() => { cena.current?.definirCamera(m); setCam(m); }}>
                  {m === 'ouvinte' ? 'No ouvinte' : m === 'corpo' ? 'Segue o corpo' : 'Livre'}
                </button>
              ))}
            </div>
          </div>
          {aviso3d && <p className="aviso3d" id="aviso3d" role="status">{aviso3d}</p>}
          <p className="dica3d">Arraste o fundo para girar a câmera. Arraste a cabeça dourada (você), o corpo, a seta verde (distância da via) e a azul (altitude); com <kbd>Shift</kbd>, a cabeça sobe e desce. Clique numa esfera para ouvir de perto aquela fonte.</p>
        </section>
        <div className="lado">
          <Telemetria leituras={leituras} />
          <section className="graficos" aria-label="Pressão, espectro e forma de onda">
            <figure className="grafico"><figcaption className="legenda">Onda de pressão no ouvinte</figcaption><div className="quadro"><canvas id="pressao" ref={cvP} role="img" aria-label="Pressão do ar no ouvinte nos últimos 11 segundos: onda de nariz e cauda e onda do túnel" /></div></figure>
            <figure className="grafico"><figcaption className="legenda">Espectrograma e espectro</figcaption><div className="quadro"><canvas id="espectro" ref={cvE} role="img" aria-label="Espectrograma rolante e espectro do som no ouvinte" /></div></figure>
            <figure className="grafico"><figcaption className="legenda">Forma de onda</figcaption><div className="quadro"><canvas id="osc" ref={cvO} role="img" aria-label="Forma de onda do som no ouvinte" /></div></figure>
          </section>
        </div>
      </main>
      <Painel c={c} />
    </div>
  );
}

function Placa({ c }: { c: ControlePassagem }) {
  useTopico(c, 'presets', 'painel');
  const p = PORTADORES.find((x) => x.id === c.portador)!;
  const corpo = c.portador === 'trem' ? `${c.trem.N} vagões · ${fmt(c.corpo.comprimento, 1)} m` : `${fmt(c.corpo.comprimento, 1)} m`;
  const onde = c.traj.altitude > 0 ? `a ${fmt(c.traj.altitude)} m de altura` : `a ${fmt(c.traj.lateral, 1)} m de você`;
  const lugar = AMBIENTES.find((a) => a.id === c.ambiente)?.nome.toLowerCase() ?? c.ambiente;
  return <span id="plate">{`${p.nome} · ${corpo} · ${fmt(c.vKmh)} km/h · ${onde} · ${lugar}`}</span>;
}

function Disparar({ c }: { c: ControlePassagem }) {
  useTopico(c, 'estado');
  const rot = c.erro ? `Erro no áudio: ${c.erro}` : c.andando ? 'Parar' : 'Disparar passagem';
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
    <section className="telemetria readout" aria-label="Leituras da cena">
      {linha('No ouvido', 'nivel', true, 'Nível com ponderação A no ouvido, somando o som direto e o eco do lugar')}
      {linha('', 'nivelZ', false, 'Nível sem ponderação e o máximo desta passagem')}
      {linha('Direto', 'direto', false, 'Só o som que vem direto das fontes')}
      {linha('Velocidade', 'v')}
      {linha('Posição', 'nariz', false, 'Onde o nariz do corpo está em relação a você')}
      {linha('Doppler', 'doppler', false, 'Quanto a frequência sobe ou desce para a fonte mais próxima (ou a escolhida)')}
      {linha('Pressão', 'pressao', false, 'Onda de pressão do nariz e da cauda no ouvinte, agora e o pico')}
      {linha('Túnel', 'tunel', false, 'Onda de compressão que o trem empurra pelo túnel')}
      {linha('Vento', 'vento', false, 'Vento que o corpo arrasta até você')}
      {linha('Local', 'local', false, 'Filtro do lugar onde você está: fora, cabine, cofre ou ponteira')}
    </section>
  );
});
