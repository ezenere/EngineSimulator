// Página Rotativos (ROTATIVO.md 7): a casca do Ronco (barra, famílias e presets, conta-giros com o pedal, onda e
// espectro) com o anel do ciclo de 1 080° e as 3 câmaras e, na terceira coluna do palco, o traço p–α com as leituras do
// rotativo. Mesmo DOM e classes do Ronco, para o estilo (src/ui/estilo.css) valer.
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react';
import { AudioShell, Barra, BotaoIgnicao, FamilyNav, PresetNav, PERFIL_RONCO, useAudioShell } from '../../ui';
import { RotativosDSP } from '../../engines/rotativo/rotativos';
import { PRESETS_ROTATIVO } from '../../engines/rotativo/presets';
import { volumeCamara } from '../../engines/rotativo/geometria';
import urlRot from '../../worklet/processador-rotativo.ts?worker&url';
import { ControleRotativo, type EstadoRot } from './controle';
import { MostradoresRot } from './mostradores';
import { Painel } from './Painel';
import { usarTeclado } from './teclado';

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const virgula = (v: number, c: number) => v.toFixed(c).replace('.', ',');

export function PaginaRotativo() {
  const [k] = useState(() => new ControleRotativo());
  const e = useSyncExternalStore(k.assinar, k.obter);
  return (
    <AudioShell perfil={PERFIL_RONCO} moduloUrl={urlRot} processador="rotativo-engine" criarDspLocal={(fs) => new RotativosDSP(fs)}
      ambiente={e.params.env} ouvinte={e.params.listener} aoMensagem={k.aoTelemetria}>
      <Interior k={k} e={e} />
    </AudioShell>
  );
}

// "Wankel 2 rotores · 2 × 654 cm³ · CR 9,0 · admissão lateral 4 · escape periférico · biturbo sequencial"
const NOME_ADM: Record<string, string> = { lateral4: 'lateral 4', lateral6: 'lateral 6', street: 'street port', bridge: 'bridge port', periferica: 'periférica', sachs: 'Sachs' };
const NOME_ESC: Record<string, string> = { periferico: 'periférico', lateral: 'lateral', sachs: 'Sachs' };
function placa({ spec, motor }: EstadoRot) {
  if (spec.tipo === 'palhetas') return `Motor pneumático de palhetas · aproximação`;
  const Vc = spec.geo ? volumeCamara(spec.geo.R, spec.geo.e, spec.geo.b) : spec.Vcam || 0;
  const arr = spec.tipo === 'x' ? 'X-Engine · 3 câmaras' : `Wankel ${motor!.rotores} ${motor!.rotores === 1 ? 'rotor' : 'rotores'}`;
  const asp = spec.turbo ? (spec.turbo.sequencial ? 'biturbo sequencial' : `turbo ${virgula(spec.turbo.boost, 1)} bar`) : 'aspirado';
  const janelas = spec.tipo === 'x' ? '' : ` · admissão ${NOME_ADM[spec.janelas.admissao] ?? spec.janelas.admissao} · escape ${NOME_ESC[spec.janelas.escape] ?? spec.janelas.escape}`;
  return `${arr} · ${motor!.rotores === 1 || spec.tipo === 'x' ? '' : `${motor!.rotores} × `}${Math.round(Vc)} cm³ · CR ${virgula(spec.cr, 1)}${janelas} · ${asp}${spec.aproximacao ? ' · aproximação' : ''}`;
}

function Interior({ k, e }: { k: ControleRotativo; e: EstadoRot }) {
  const { iniciar, estado, erro } = useAudioShell();
  k.iniciarAudio = iniciar;
  const pedal = useRef<HTMLDivElement>(null);
  const pedalFill = useRef<HTMLDivElement>(null);
  useEffect(() => {
    k.pedal = pedal.current; k.pedalFill = pedalFill.current;
    (window as any).__rotativo = k; // (alça para os testes no navegador, tools/rotativo-navegador.mjs)
    const m = new MostradoresRot(k);
    m.iniciar();
    return () => m.parar();
  }, [k]);
  usarTeclado(k);

  const ligar = () => { k.toggleIgnition().catch((err) => console.error('Rotativo: áudio não iniciou', err)); };
  const padFrom = (ev: PointerEvent) => { const r = pedal.current!.getBoundingClientRect(); return clamp(1 - (ev.clientY - r.top) / r.height, 0, 1); };
  const solta = () => { k.input.pad = 0; k.sendInput(); };
  const carro = (e.spec.portadores || []).includes('carro'), pal = e.spec.tipo === 'palhetas';

  return (
    <div className="app">
      <Barra logo="Rotativos" placa={placa(e)}>
        <BotaoIgnicao id="ignition" ligado={e.ignicao} rotulo={pal ? (e.ignicao ? 'Fechar o ar' : e.pal.modo === 'arranque' ? 'Dar a partida' : 'Abrir o ar') : e.ignicao ? 'Desligar' : 'Ligar motor'} aoClicar={ligar}
          estado={erro ? 'erro' : estado === 'carregando' ? 'ocupado' : undefined} />
      </Barra>

      <nav className="presets" id="presets" aria-label="Motores prontos">
        <FamilyNav familias={PRESETS_ROTATIVO.families} presets={PRESETS_ROTATIVO} atual={e.familia} aoEscolher={(id) => k.setFamilia(id)} />
        <PresetNav presets={PRESETS_ROTATIVO} familia={e.familia} atual={e.presetId} aoEscolher={(p) => k.loadPreset(p)} />
      </nav>

      <main className={pal ? 'cluster' : 'cluster cluster-3'}>
        <section className="tach-wrap" aria-label="Conta-giros">
          <canvas id="tach" role="img" aria-label="Conta-giros: rotação do eixo, pressão do turbo, torque e temperatura" />
          <div className="pedal" id="pedal" ref={pedal} role="slider" tabIndex={0} aria-label={pal ? 'Gatilho' : 'Acelerador'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}
            onPointerDown={(ev) => { pedal.current!.setPointerCapture(ev.pointerId); k.input.pad = padFrom(ev); k.sendInput(); }}
            onPointerMove={(ev) => { if (pedal.current!.hasPointerCapture(ev.pointerId)) { k.input.pad = padFrom(ev); k.sendInput(); } }}
            onPointerUp={solta} onPointerCancel={solta}>
            <div className="pedal-fill" id="pedalFill" ref={pedalFill} />
            <span className="pedal-label">{pal ? 'Gatilho' : 'Acelerador'}</span>
          </div>
        </section>

        <section className="firing" aria-label={pal ? 'Rotor de palhetas' : 'Ciclo das câmaras'}>
          <canvas id="anel" role="img" aria-label={pal ? 'Rotor de palhetas girando' : 'Ciclo das câmaras: cada câmara acende quando queima'} />
          <Leitura e={e} />
        </section>

        {!pal && (
          <section className="extra" aria-label="Câmara, escape e turbo">
            <canvas id="pAlfa" className="traco quadro" role="img" aria-label="Pressão na câmara 1 em função do ângulo do eixo" />
            <div className="readout">
              {LEITURAS_CAMARA.map(([id, rot, dica]) => <div className="ro-row" key={id} title={dica}><span className="k">{rot}</span><span className="v mono" id={id}>—</span></div>)}
            </div>
          </section>
        )}

        <section className="scope-wrap" aria-label="Forma de onda e espectro">
          <canvas id="scope" role="img" aria-label="Forma de onda e espectro do som no ouvido do observador" />
        </section>

        <section className="drive">
          {carro && (
            <div className="gearbox">
              <button type="button" className="key" aria-label="Reduzir marcha" onClick={() => k.shift(-1)}>Q</button>
              <div className="gear-read"><span className="k">Marcha</span><span className="gear mono" id="gearRead">N</span></div>
              <button type="button" className="key" aria-label="Subir marcha" onClick={() => k.shift(1)}>E</button>
            </div>
          )}
          <p className="hints"><kbd>W</kbd>/<kbd>↑</kbd> {pal ? 'gatilho' : 'acelerador'} · <kbd>Shift</kbd> meio · <kbd>I</kbd> {pal ? 'ar' : 'ignição'} · <kbd>C</kbd> microfone{carro ? <> · <kbd>Q</kbd>/<kbd>E</kbd> câmbio · <kbd>S</kbd> freio</> : null}{e.spec.aviation ? <> · <kbd>M</kbd> magnetos</> : null}{pal ? <> · <kbd>[</kbd>/<kbd>]</kbd> carga</> : null}</p>
        </section>
      </main>

      <aside className="controls" id="controls" aria-label="Parâmetros do motor" data-audio={estado} data-erro={erro ? String(erro) : undefined}>
        <Painel k={k} />
      </aside>
    </div>
  );
}

// leituras da coluna da câmara (o texto é escrito pelo laço dos mostradores): id, nome e dica
const LEITURAS_CAMARA: [string, string, string][] = [
  ['roPico', 'Pico na câmara', 'Pressão de pico da câmara 1 no último ciclo'],
  ['roGas', 'Gás de escape', 'Temperatura do gás na janela de escape'],
  ['roHC', 'Pós-queima', 'Fração do combustível que ainda queima no escape'],
  ['roEst', 'Estouros', 'Estouros por segundo no escape'],
  ['roSeq', 'Turbo', 'Pressão do turbo e, no sequencial, quanto o turbo secundário já entrou'],
  ['roApv', 'Janelas', 'Janelas secundária e auxiliar da admissão (abrem com o giro)'],
  ['roFumaca', 'Óleo', 'Fumaça azul do óleo das vedações, nos primeiros 20 s depois da partida (mais forte com o motor frio)'],
];

function Leitura({ e }: { e: EstadoRot }) {
  const linha = (id: string, rot: string) => <div className="ro-row" key={id}><span className="k">{rot}</span><span className="v mono" id={id}>—</span></div>;
  if (e.spec.tipo === 'palhetas') return <div className="readout">{[linha('roFreqRot', 'Palhetas'), linha('roPal', 'Motor'), linha('roHosp', 'Motor acionado')]}</div>;
  const m = e.motor!;
  const fases = m.fases.map((f) => `${f}°`).join(' / ');
  return (
    <div className="readout">
      <div className="ro-row"><span className="k">{m.tipo === 'x' ? 'Câmaras' : 'Rotores'}</span><span className="v mono">{m.tipo === 'x' ? '3 fixas, a 0° / 240° / 480°' : m.rotores === 1 ? '1' : `${m.rotores}, a ${fases}`}</span></div>
      <div className="ro-row" title="Ângulo do eixo entre uma queima e a seguinte"><span className="k">Intervalo</span><span className="v mono">{Math.round(m.intervalos[0])}° · {virgula(m.eventosPorVolta, 1)} por volta</span></div>
      {linha('roFreqRot', 'Ignição')}
    </div>
  );
}
