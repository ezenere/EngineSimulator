// Página da Turbina (jatos e turboélices): porte de jato.html + src/jet-app.js para React.
// O React monta a estrutura; o estado e as mensagens para o DSP ficam em ControleTurbina, e os
// mostradores são desenhados em canvas no requestAnimationFrame, lendo a telemetria de um campo
// (nada re-renderiza a cada telemetria).
import { memo, useEffect, useRef, useState } from 'react';
import { AudioShell, Barra, BotaoIgnicao, FamilyNav, PERFIL_TURBINA, PresetNav, useAudioShell } from '../../ui';
import { JetDSP } from '../../engines/turbina/dsp';
import urlTurbina from '../../worklet/processador-turbina.ts?worker&url';
import { ControleTurbina, MAXT, PRESETS, useTopico } from './controle';
import { drawEicas, drawFan, drawMap, drawScope, readColors, renderReadout, type Leituras } from './desenho';
import { Painel, type RefsDoMapa } from './Painel';

export function PaginaTurbina() {
  const [c] = useState(() => new ControleTurbina());
  return (
    <AudioShell perfil={PERFIL_TURBINA} moduloUrl={urlTurbina} processador="turbina-engine" criarDspLocal={(fs) => new JetDSP(fs)}
      ambiente={c.environment} ouvinte={c.params.listener} aoMensagem={c.onTelemetry}>
      <Conteudo c={c} />
    </AudioShell>
  );
}

function Conteudo({ c }: { c: ControleTurbina }) {
  const { iniciar } = useAudioShell();
  c.iniciar = iniciar;
  const eicas = useRef<HTMLCanvasElement>(null), fan = useRef<HTMLCanvasElement>(null), scope = useRef<HTMLCanvasElement>(null);
  const leituras = useRef<Partial<Leituras>>({});
  const mapa: RefsDoMapa = { mapa: useRef<HTMLCanvasElement>(null), nota: useRef<HTMLParagraphElement>(null) };
  const refsMapa = useRef(mapa).current;

  // teclado (W/S/↑/↓, 1–4, R, I, C, V) e o laço de desenho
  useEffect(() => {
    window.addEventListener('keydown', c.keydown);
    window.addEventListener('keyup', c.keyup);
    window.addEventListener('blur', c.blur);
    readColors();
    let vivo = true;
    document.fonts?.ready.then(() => { if (vivo) readColors(); });
    let lastNow = 0, id = 0;
    const frame = (now: number) => {
      const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
      lastNow = now;
      c.segurar(dt);
      if (eicas.current) drawEicas(c, eicas.current);
      if (fan.current) drawFan(c, fan.current, now, dt);
      if (scope.current) drawScope(c, scope.current);
      if (refsMapa.mapa.current) drawMap(c, refsMapa.mapa.current, refsMapa.nota.current);
      const l = leituras.current;
      if (l.roFan && l.roTip && l.roCut && l.roHpc && l.roJet && l.roSpl) renderReadout(c, l as Leituras);
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => {
      vivo = false;
      cancelAnimationFrame(id);
      window.removeEventListener('keydown', c.keydown);
      window.removeEventListener('keyup', c.keyup);
      window.removeEventListener('blur', c.blur);
    };
  }, [c, refsMapa]);

  return (
    <div className="app">
      <Barra logo="Turbina" placa={<Placa c={c} />}><Ignicao c={c} /></Barra>
      <Navegacao c={c} />
      <main className="cluster">
        <section className="tach-wrap" aria-label="Instrumentos do motor">
          <canvas id="eicas" ref={eicas} />
          <Manete c={c} />
        </section>
        <section className="firing" aria-label="Face do fan">
          <canvas id="fan" ref={fan} />
          <Leitura leituras={leituras} />
        </section>
        <section className="scope-wrap" aria-label="Forma de onda e espectro">
          <canvas id="scope" ref={scope} />
        </section>
        <Posicoes c={c} />
      </main>
      <Painel c={c} refs={refsMapa} />
    </div>
  );
}

function Placa({ c }: { c: ControleTurbina }) {
  useTopico(c, 'placa');
  return <span id="plate">{c.placa()}</span>;
}

function Ignicao({ c }: { c: ControleTurbina }) {
  useTopico(c, 'ignicao');
  return <BotaoIgnicao ligado={c.running} rotulo={c.rotuloIgnicao()} aoClicar={() => c.setRunning(!c.running)} />;
}

// família em cima, aeronaves dela embaixo
function Navegacao({ c }: { c: ControleTurbina }) {
  useTopico(c, 'presets');
  return (
    <nav className="presets" id="presets" aria-label="Motores prontos">
      <FamilyNav familias={PRESETS.families} presets={PRESETS} atual={c.family} aoEscolher={(f) => c.setFamily(f)} />
      <PresetNav presets={PRESETS} familia={c.family} atual={c.presetId} aoEscolher={(p) => c.loadPreset(p)} />
    </nav>
  );
}

// manete: fica onde foi deixada (não volta como o pedal)
function Manete({ c }: { c: ControleTurbina }) {
  useTopico(c, 'manete', 'painel');
  const trilho = useRef<HTMLDivElement>(null);
  const { tla, spec } = c;
  const marcas: [number, string][] = [[0, 'lenta'], [0.8, 'subida'], [1, 'deco']];
  if (spec.ab && spec.arch !== 'turboprop') marcas.push([1.3, 'pós']);
  const mover = (e: { clientY: number }) => { if (trilho.current) c.setTla(c.tlaFrom(e, trilho.current)); };
  return (
    <div className="lever" id="lever" role="slider" tabIndex={0} aria-label="Manete de potência" aria-valuemin={0} aria-valuemax={130} aria-valuenow={Math.round(tla * 100)}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); mover(e); }}
      onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) mover(e); }}
      onKeyDown={(e) => { if (e.code === 'PageUp') c.setTla(c.tla + 0.1); else if (e.code === 'PageDown') c.setTla(c.tla - 0.1); }}>
      <div className="lever-track" ref={trilho}><div className="lever-fill" id="leverFill" style={{ height: `${(tla / MAXT) * 100}%` }} /></div>
      <div className="lever-marks" id="leverMarks">
        {marcas.map(([v, rotulo]) => <span key={rotulo} className={v > 1 ? 'ab' : ''} style={{ bottom: `${(v / MAXT) * 100}%` }}>{rotulo}</span>)}
      </div>
      <div className="lever-knob" id="leverKnob" style={{ bottom: `calc(10px + (100% - 20px) * ${tla / MAXT})` }} />
    </div>
  );
}

// posições da manete, reversor e atalhos
function Posicoes({ c }: { c: ControleTurbina }) {
  useTopico(c, 'manete', 'painel');
  const canAB = c.spec.ab && c.spec.arch !== 'turboprop';
  const det = (v: number, texto: string, id?: string, disabled?: boolean) => (
    <button type="button" className={`key wide${Math.abs(v - c.tla) < 0.01 ? ' at' : ''}`} data-tla={v} id={id} disabled={disabled} onClick={() => c.setTla(v)}>{texto}</button>
  );
  return (
    <section className="drive">
      <div className="gearbox" id="detents">
        {det(0, '1 · lenta')}
        {det(0.8, '2 · subida')}
        {det(1, '3 · decolagem')}
        {det(1.3, '4 · pós-combustão', 'abKey', !canAB)}
        <button type="button" className="key wide" id="revKey" aria-pressed={c.reverser} onClick={() => c.setReverser(!c.reverser)}>R · reversor</button>
      </div>
      <p className="hints"><kbd>W</kbd>/<kbd>↑</kbd> avança · <kbd>S</kbd>/<kbd>↓</kbd> recua · <kbd>1</kbd>–<kbd>4</kbd> posições · <kbd>R</kbd> reversor · <kbd>I</kbd> partida · <kbd>C</kbd> posição · <kbd>V</kbd> a bordo/no solo</p>
    </section>
  );
}

// Leituras ao lado do fan: o React só cria os elementos; o texto é escrito a cada quadro.
const Leitura = memo(function Leitura({ leituras }: { leituras: { current: Partial<Leituras> } }) {
  const linha = (k: string, id: keyof Leituras) => (
    <div className="ro-row"><span className="k">{k}</span><span className="v mono" id={id} ref={(e) => { if (e) leituras.current[id] = e; }}>—</span></div>
  );
  return (
    <div className="readout">
      {linha('Fan', 'roFan')}
      {linha('Ponta da pá', 'roTip')}
      {linha('Tom BPF', 'roCut')}
      {linha('Compressor', 'roHpc')}
      {linha('Jato', 'roJet')}
      {linha('No ouvido', 'roSpl')}
    </div>
  );
});
