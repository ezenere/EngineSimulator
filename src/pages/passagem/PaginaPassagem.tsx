// Página Passagem / modo de testes: qualquer portador passando pelo ouvinte, com a Cena nova
// (src/scene/) no AudioWorklet, o ouvinte num gimbal 3D e a cena three.js. O React monta a estrutura;
// o estado e as mensagens para o DSP ficam em ControlePassagem, e a cena 3D e os mostradores são
// desenhados num só requestAnimationFrame lendo a telemetria de um campo.
//
// A cena 3D é carregada sob demanda (import dinâmico, chunk próprio com o three.js): o áudio não espera
// por ela e, sem WebGL, a página continua com os mostradores.
import { memo, useEffect, useRef, useState } from 'react';
import { AudioShell, Barra, PERFIL_PASSAGEM, useAudioShell } from '../../ui';
import { CenaDSP } from '../../scene/dsp-cena';
import urlCena from '../../worklet/processador-cena.ts?worker&url';
import { ControlePassagem, fmt, useTopico } from './controle';
import { Painel } from './Painel';
import { PORTADORES } from './presets';
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
        <section className="vista3d" aria-label="Cena 3D">
          <canvas id="cena3d" ref={cv3d} tabIndex={0} />
          <pre className="hud mono" id="hud" ref={hud} />
          <div className="camera" role="group" aria-label="Câmera">
            {(['ouvinte', 'corpo', 'livre'] as ModoCamera[]).map((m) => (
              <button key={m} type="button" className="chip" aria-pressed={cam === m} data-cam={m} onClick={() => { cena.current?.definirCamera(m); setCam(m); }}>
                {m === 'ouvinte' ? 'No ouvinte' : m === 'corpo' ? 'Segue o corpo' : 'Livre'}
              </button>
            ))}
          </div>
          {aviso3d && <p className="aviso3d" id="aviso3d">{aviso3d}</p>}
          <p className="dica3d">Arraste a cabeça, os arcos do gimbal, o corpo, a seta verde (lateral) e a azul (altitude). <kbd>Shift</kbd> muda a altura. Clique numa esfera para ver a fonte.</p>
        </section>
        <Telemetria leituras={leituras} />
        <section className="graficos" aria-label="Pressão, espectro e forma de onda">
          <figure><figcaption>Onda de pressão</figcaption><canvas id="pressao" ref={cvP} /></figure>
          <figure><figcaption>Espectrograma e espectro</figcaption><canvas id="espectro" ref={cvE} /></figure>
          <figure><figcaption>Osciloscópio</figcaption><canvas id="osc" ref={cvO} /></figure>
        </section>
      </main>
      <Painel c={c} />
    </div>
  );
}

function Placa({ c }: { c: ControlePassagem }) {
  useTopico(c, 'presets', 'painel');
  const p = PORTADORES.find((x) => x.id === c.portador)!;
  const corpo = c.portador === 'trem' ? `${c.trem.N} vagões · ${fmt(c.corpo.comprimento, 1)} m` : `${fmt(c.corpo.comprimento, 1)} m`;
  return <span id="plate">{`${p.nome} · ${corpo} · ${fmt(c.vKmh)} km/h · ${fmt(c.traj.lateral, 1)} m · ${c.ambiente}`}</span>;
}

function Disparar({ c }: { c: ControlePassagem }) {
  useTopico(c, 'estado');
  const rot = c.erro ? `Erro no áudio: ${c.erro}` : c.andando ? 'Parar' : 'Disparar passagem';
  return <button id="ignicao" className="ignition" type="button" aria-pressed={c.andando} onClick={() => (c.andando ? c.parar() : c.disparar())}><span className="dot" /><span>{rot}</span></button>;
}

function Presets({ c }: { c: ControlePassagem }) {
  useTopico(c, 'presets');
  return (
    <nav className="presets" id="presets" aria-label="Passagens prontas">
      <div className="cars">
        {c.presetsVisiveis().map((p) => (
          <button key={p.id} type="button" className="preset" data-id={p.id} aria-pressed={p.id === c.presetId} disabled={!p.situacao.ok}
            title={p.situacao.ok ? p.sub : p.situacao.motivo} onClick={() => c.carregarPreset(p)}>
            <b>{p.nome}</b><small>{p.situacao.ok ? p.sub : 'espera o motor'}</small>
          </button>
        ))}
      </div>
    </nav>
  );
}

const Telemetria = memo(function Telemetria({ leituras }: { leituras: { current: Leituras } }) {
  const linha = (k: string, id: string, grande = false) => (
    <div className={`ro-row${grande ? ' grande' : ''}`}><span className="k">{k}</span><span className="v mono" id={`ro-${id}`} ref={(e) => { if (e) leituras.current[id] = e; }}>—</span></div>
  );
  return (
    <section className="telemetria readout" aria-label="Telemetria da cena">
      {linha('No ouvido', 'nivel', true)}
      {linha('', 'nivelZ')}
      {linha('Cena', 'direto')}
      {linha('Velocidade', 'v')}
      {linha('Nariz', 'nariz')}
      {linha('Doppler', 'doppler')}
      {linha('Pressão', 'pressao')}
      {linha('Túnel', 'tunel')}
      {linha('Vento', 'vento')}
      {linha('Local', 'local')}
    </section>
  );
});
