// Página do Ronco: barra, presets, instrumentos (conta-giros com pedal, ciclo de ignição com a
// leitura da ordem e do balanceamento, onda e espectro, câmbio) e o painel de controles.
// Mesmo DOM e classes do index.html legado, para o estilo (src/ui/estilo.css) valer igual. Na família aviação o pedal dá
// lugar à manete de potência da Turbina (src/ui/Manete.tsx), que fica onde foi deixada.
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react';
import { AudioShell, Barra, BotaoIgnicao, FamilyNav, Manete, PresetNav, PERFIL_RONCO, useAudioShell } from '../../ui';
import { EngineDSP } from '../../engines/ronco/dsp';
import { PRESETS_PAGINA as PRESETS } from '../../engines/ronco/presets';
import urlRonco from '../../worklet/processador-ronco.ts?worker&url';
import { ControleRonco, familyFor, MARCAS_MANETE, POSICOES_MANETE, type EstadoRonco } from './controle';
import { Mostradores } from './mostradores';
import { Painel } from './Painel';
import { usarTeclado } from './teclado';

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

export function PaginaRonco() {
  const [k] = useState(() => new ControleRonco());
  const e = useSyncExternalStore(k.assinar, k.obter);
  return (
    // a cadeia nasce (no primeiro "Ligar motor") com o ambiente e o ouvinte do momento
    <AudioShell perfil={PERFIL_RONCO} moduloUrl={urlRonco} processador="ronco-engine" criarDspLocal={(fs) => new EngineDSP(fs)}
      ambiente={e.params.env} ouvinte={e.params.listener} aoMensagem={k.aoTelemetria}>
      <Interior k={k} e={e} />
    </AudioShell>
  );
}

// "V8 90° · Cross-plane · 6.2 L · aspirado · 1-8-4-3-6-5-7-2" (updatePlate)
function placa({ spec }: EstadoRonco) {
  const fam = familyFor(spec.layout, spec.cylinders);
  const crank = fam.find((x) => x.id === spec.crank) || fam[0];
  const lay = spec.layout === 'inline' ? `${spec.cylinders} em linha` : spec.layout === 'boxer' ? `Boxer ${spec.cylinders}` : `V${spec.cylinders} ${spec.bankAngle}°`;
  return `${lay} · ${crank.name} · ${spec.displacement.toFixed(1)} L · ${spec.aspiration === 'na' ? 'aspirado' : `${spec.aspiration === 'turbo' ? 'turbo' : 'compressor'} ${spec.boost.toFixed(1)} bar`} · ${spec.order}`;
}

function Interior({ k, e }: { k: ControleRonco; e: EstadoRonco }) {
  const { iniciar, estado, erro } = useAudioShell();
  k.iniciarAudio = iniciar;
  const pedal = useRef<HTMLDivElement>(null);
  const pedalFill = useRef<HTMLDivElement>(null);
  const [freio, setFreio] = useState(false);
  const aviao = !!e.spec.aviation;

  // (o pedal só existe nos carros)
  useEffect(() => { k.pedal = pedal.current; k.pedalFill = pedalFill.current; }, [k, aviao]);
  // laço dos mostradores (requestAnimationFrame) e teclado
  useEffect(() => {
    // alça para os testes no navegador (tools/ronco-navegador.mjs): telemetria, cadeia de áudio e estado
    (window as any).__ronco = k;
    const m = new Mostradores(k);
    m.iniciar();
    // a manete da aviação anda com as teclas seguradas
    let raf = 0, antes = 0;
    const laco = (agora: number) => { k.segurar(antes ? Math.min(0.1, (agora - antes) / 1000) : 0); antes = agora; raf = requestAnimationFrame(laco); };
    raf = requestAnimationFrame(laco);
    return () => { m.parar(); cancelAnimationFrame(raf); };
  }, [k]);
  usarTeclado(k, setFreio);

  const ligar = () => { k.toggleIgnition().catch((err) => console.error('Ronco: áudio não iniciou', err)); };

  // pedal na tela: arrasta com o ponteiro
  const padFrom = (ev: PointerEvent) => { const r = pedal.current!.getBoundingClientRect(); return clamp(1 - (ev.clientY - r.top) / r.height, 0, 1); };
  const solta = () => { k.input.pad = 0; k.sendInput(); };
  const freia = (on: boolean) => { k.input.brake = on ? 1 : 0; k.sendInput(); setFreio(on); };

  return (
    <div className="app">
      <Barra logo="Ronco" placa={placa(e)}>
        <BotaoIgnicao id="ignition" ligado={e.ignicao} rotulo={e.ignicao ? 'Desligar' : e.spec.aviation ? 'Magnetos + partida' : 'Ligar motor'} aoClicar={ligar} />
      </Barra>

      <nav className="presets" id="presets" aria-label="Motores prontos">
        <FamilyNav familias={PRESETS.families} presets={PRESETS} atual={e.familia} aoEscolher={(id) => k.setFamilia(id)} />
        <PresetNav presets={PRESETS} familia={e.familia} atual={e.presetId} aoEscolher={(p) => k.loadPreset(p)} />
      </nav>

      <main className="cluster">
        <section className="tach-wrap" aria-label="Conta-giros">
          <canvas id="tach" />
          {aviao ? <ManeteAv k={k} /> : (
            <div className="pedal" id="pedal" ref={pedal} role="slider" tabIndex={0} aria-label="Acelerador" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}
              onPointerDown={(ev) => { pedal.current!.setPointerCapture(ev.pointerId); k.input.pad = padFrom(ev); k.sendInput(); }}
              onPointerMove={(ev) => { if (pedal.current!.hasPointerCapture(ev.pointerId)) { k.input.pad = padFrom(ev); k.sendInput(); } }}
              onPointerUp={solta} onPointerCancel={solta}>
              <div className="pedal-fill" id="pedalFill" ref={pedalFill} />
              <span className="pedal-label">Acelerador</span>
            </div>
          )}
        </section>

        <section className="firing" aria-label="Ciclo de ignição">
          <canvas id="ring" />
          <Leitura e={e} />
        </section>

        <section className="scope-wrap" aria-label="Forma de onda e espectro">
          <canvas id="scope" />
        </section>

        <section className="drive">
          {aviao ? <PosicoesAv k={k} /> : (
          <div className="gearbox">
            <button type="button" className="key" id="gDown" aria-label="Reduzir marcha" onClick={() => k.shift(-1)}>Q</button>
            <div className="gear-read"><span className="k">Marcha</span><span className="gear mono" id="gearRead">N</span></div>
            <button type="button" className="key" id="gUp" aria-label="Subir marcha" onClick={() => k.shift(1)}>E</button>
            <button type="button" className={`key wide${freio ? ' on' : ''}`} id="brakeBtn"
              onPointerDown={() => freia(true)} onPointerUp={() => freia(false)} onPointerLeave={() => freia(false)} onPointerCancel={() => freia(false)}>S · freio</button>
            {/* o texto, o `hidden` e o estado "aberta" vêm da telemetria, no laço dos mostradores */}
            <button type="button" className="valve-tag" id="valveTag" title="Troca o modo do escape ativo (B)" onClick={() => k.cycleValve()} hidden>válvula fechada</button>
          </div>
          )}
          {aviao
            ? <p className="hints"><kbd>W</kbd>/<kbd>↑</kbd> avança a manete · <kbd>S</kbd>/<kbd>↓</kbd> recua · <kbd>1</kbd>–<kbd>4</kbd> posições · <kbd>I</kbd> magnetos + partida · <kbd>M</kbd> magnetos · <kbd>[</kbd>/<kbd>]</kbd> mistura · <kbd>C</kbd> microfone · <kbd>V</kbd> observador</p>
            : <p className="hints"><kbd>W</kbd>/<kbd>↑</kbd>/<kbd>Espaço</kbd> acelera · <kbd>Shift</kbd> meio pé · <kbd>S</kbd> freia · <kbd>Q</kbd>/<kbd>E</kbd> câmbio · <kbd>I</kbd> ignição · <kbd>C</kbd> microfone · <kbd>V</kbd> observador · <kbd>B</kbd> escape ativo · <kbd>M</kbd> modo do câmbio</p>}
        </section>
      </main>

      <aside className="controls" id="controls" aria-label="Parâmetros do motor" data-audio={estado} data-erro={erro ? String(erro) : undefined}>
        <Painel k={k} />
      </aside>
    </div>
  );
}

// manete de potência da família aviação (a da Turbina): só ela re-renderiza quando a posição muda
function ManeteAv({ k }: { k: ControleRonco }) {
  const v = useSyncExternalStore(k.assinarManete, k.obterManete);
  return <Manete valor={v} marcas={MARCAS_MANETE} aoMudar={(x) => k.setManete(x)} obter={() => k.manete} passo={0.1} rotulo="Manete de potência" />;
}

// posições da manete (teclas 1–4)
function PosicoesAv({ k }: { k: ControleRonco }) {
  const v = useSyncExternalStore(k.assinarManete, k.obterManete);
  return (
    <div className="gearbox detentes" id="detents">
      {POSICOES_MANETE.map(([x, , texto]) => (
        <button key={texto} type="button" className={`key${Math.abs(x - v) < 0.01 ? ' at' : ''}`} data-manete={x} onClick={() => k.setManete(x)}>{texto}</button>
      ))}
    </div>
  );
}

// ordem, intervalos (total e por bancada), frequência de ignição e balanceamento (renderReadout)
function Leitura({ e }: { e: EstadoRonco }) {
  const engine = e.motor;
  const graus = (xs: number[]) => xs.map((x) => `${Math.round(x)}°`).join(' ');
  const twoBanks = engine.banks === 2;
  const b = engine.balance;
  const items: [string, number][] = [['Força 1ª', b.f1], ['Força 2ª', b.f2], ['Momento 1ª', b.m1], ['Momento 2ª', b.m2]];
  return (
    <div className="readout">
      <div className="ro-row"><span className="k">Ordem</span><span className="v mono" id="roOrder">{engine.order.join('-')}</span></div>
      <div className="ro-row"><span className="k">Intervalos</span><span className="v mono" id="roIntervals">{graus(engine.intervals)}</span></div>
      <div className="ro-row bankA" hidden={!twoBanks}><span className="k">Bancada A</span><span className="v mono" id="roBankA">{twoBanks ? graus(engine.perBank[0]) : ''}</span></div>
      <div className="ro-row bankB" hidden={!twoBanks}><span className="k">Bancada B</span><span className="v mono" id="roBankB">{twoBanks ? graus(engine.perBank[1]) : ''}</span></div>
      {/* atualizado pelo laço dos mostradores */}
      <div className="ro-row"><span className="k">Ignição</span><span className="v mono" id="roFreq">—</span></div>
      <div className="balance" id="balance">
        {items.map(([kk, v]) => {
          const w = clamp(v / Math.max(2, engine.N * 0.5), 0, 1) * 100;
          return (
            <div key={kk} className="bal" title="Desbalanceamento das massas alternativas, em múltiplos de um cilindro. Zero = cancelamento perfeito.">
              <span className="k">{kk}</span>
              <div className="meter"><i className={v === 0 ? 'zero' : ''} style={{ width: `${w}%` }} /></div>
              <span className="val">{v === 0 ? 'zero' : v.toFixed(2)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
