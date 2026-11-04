// Página do Diesel: a casca do Ronco (barra, famílias e presets, conta-giros com pedal, ciclo de ignição com a
// leitura da ordem, onda e espectro, câmbio) mais os mostradores do diesel (p–θ, λ e opacímetro, turbo, escape,
// carga do portador) e o painel de controles. Mesmo DOM e classes do Ronco, para o estilo (src/ui/estilo.css) valer.
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react';
import { AudioShell, Barra, BotaoIgnicao, FamilyNav, PresetNav, PERFIL_RONCO, useAudioShell } from '../../ui';
import { DieselDSP } from '../../engines/diesel/dsp';
import { PRESETS } from '../../engines/diesel/presets';
import urlDiesel from '../../worklet/processador-diesel.ts?worker&url';
import { ControleDiesel, familyFor, type EstadoDiesel } from './controle';
import { Mostradores } from './mostradores';
import { Painel } from './Painel';
import { usarTeclado } from './teclado';

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

export function PaginaDiesel() {
  const [k] = useState(() => new ControleDiesel());
  const e = useSyncExternalStore(k.assinar, k.obter);
  return (
    <AudioShell perfil={PERFIL_RONCO} moduloUrl={urlDiesel} processador="diesel-engine" criarDspLocal={(fs) => new DieselDSP(fs)}
      ambiente={e.params.env} ouvinte={e.params.listener} aoMensagem={k.aoTelemetria}>
      <Interior k={k} e={e} />
    </AudioShell>
  );
}

// "I4 · 2,8 L · 4 tempos · common-rail · turbo 2,4 bar · 1-3-4-2"
function placa({ spec, motor }: EstadoDiesel) {
  const fam = familyFor(spec.layout, spec.cylinders, spec.tempos);
  const crank = fam.find((x) => x.id === spec.crank) || fam[0];
  const lay = spec.layout === 'inline' ? `${spec.cylinders} em linha` : `V${spec.cylinders} ${spec.bankAngle}°`;
  const asp = spec.aspiration === 'turbo' ? `turbo ${(1 + spec.boost).toFixed(1)} bar` : spec.soprador ? 'Roots' : 'aspirado';
  const L = spec.displacement >= 20 ? spec.displacement.toFixed(0) : spec.displacement.toFixed(1);
  return `${lay} · ${crank?.name ?? ''} · ${L} L · ${spec.tempos} tempos · ${spec.injecao} · ${asp} · ${spec.ordemReal || motor.order.join('-')}`;
}

function Interior({ k, e }: { k: ControleDiesel; e: EstadoDiesel }) {
  const { iniciar, estado, erro } = useAudioShell();
  k.iniciarAudio = iniciar;
  const pedal = useRef<HTMLDivElement>(null);
  const pedalFill = useRef<HTMLDivElement>(null);
  const [freio, setFreio] = useState(false);

  useEffect(() => {
    k.pedal = pedal.current; k.pedalFill = pedalFill.current;
    // alça para os testes no navegador (tools/diesel-navegador.mjs)
    (window as any).__diesel = k;
    const m = new Mostradores(k as any);
    m.iniciar();
    return () => m.parar();
  }, [k]);
  usarTeclado(k, setFreio);

  const ligar = () => { k.toggleIgnition().catch((err) => console.error('Diesel: áudio não iniciou', err)); };
  const padFrom = (ev: PointerEvent) => { const r = pedal.current!.getBoundingClientRect(); return clamp(1 - (ev.clientY - r.top) / r.height, 0, 1); };
  const solta = () => { k.input.pad = 0; k.input.key = 0; k.sendInput(); };
  const freia = (on: boolean) => { k.input.brake = on ? 1 : 0; k.sendInput(); setFreio(on); };
  const carro = e.portador === 'carro';

  return (
    <div className="app">
      <Barra logo="Diesel" placa={placa(e)}>
        <BotaoIgnicao id="ignition" ligado={e.ignicao} rotulo={e.ignicao ? 'Desligar' : 'Ligar motor'} aoClicar={ligar} />
      </Barra>

      <nav className="presets" id="presets" aria-label="Motores prontos">
        <FamilyNav familias={PRESETS.families} presets={PRESETS} atual={e.familia} aoEscolher={(id) => k.setFamilia(id)} />
        <PresetNav presets={PRESETS} familia={e.familia} atual={e.presetId} aoEscolher={(p) => k.loadPreset(p)} />
      </nav>

      <main className="cluster">
        <section className="tach-wrap" aria-label="Conta-giros">
          <canvas id="tach" />
          <div className="pedal" id="pedal" ref={pedal} role="slider" tabIndex={0} aria-label="Acelerador" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}
            onPointerDown={(ev) => { pedal.current!.setPointerCapture(ev.pointerId); k.input.pad = padFrom(ev); k.sendInput(); }}
            onPointerMove={(ev) => { if (pedal.current!.hasPointerCapture(ev.pointerId)) { k.input.pad = padFrom(ev); k.sendInput(); } }}
            onPointerUp={solta} onPointerCancel={solta}>
            <div className="pedal-fill" id="pedalFill" ref={pedalFill} />
            <span className="pedal-label">{e.portador === 'nenhum' ? 'Rotação' : 'Acelerador'}</span>
          </div>
        </section>

        <section className="firing" aria-label="Ciclo de ignição">
          <canvas id="ring" />
          <Leitura e={e} />
        </section>

        <section className="scope-wrap" aria-label="Forma de onda e espectro">
          <canvas id="scope" />
        </section>

        <section className="drive">
          {carro ? (
            <div className="gearbox">
              <button type="button" className="key" id="gDown" aria-label="Reduzir marcha" onClick={() => k.shift(-1)}>Q</button>
              <div className="gear-read"><span className="k">Marcha</span><span className="gear mono" id="gearRead">N</span></div>
              <button type="button" className="key" id="gUp" aria-label="Subir marcha" onClick={() => k.shift(1)}>E</button>
              <button type="button" className={`key wide${freio ? ' on' : ''}`} id="brakeBtn"
                onPointerDown={() => freia(true)} onPointerUp={() => freia(false)} onPointerLeave={() => freia(false)} onPointerCancel={() => freia(false)}>S · freio</button>
              <button type="button" className="valve-tag" id="valveTag" title="Troca o modo do escape ativo (B)" onClick={() => k.cycleValve()} hidden>válvula fechada</button>
            </div>
          ) : <ComandoDaCarga k={k} e={e} />}
          <PainelDiesel e={e} />
          <p className="hints">{carro
            ? <><kbd>W</kbd>/<kbd>↑</kbd> acelera · <kbd>Shift</kbd> meio pé · <kbd>S</kbd> freia · <kbd>Q</kbd>/<kbd>E</kbd> câmbio · <kbd>J</kbd> freio-motor · <kbd>I</kbd> ignição · <kbd>C</kbd> microfone · <kbd>V</kbd> observador · <kbd>M</kbd> modo do câmbio</>
            : e.portador === 'locomotiva' ? <><kbd>0</kbd>–<kbd>8</kbd> notch · <kbd>+</kbd>/<kbd>−</kbd> sobe e desce · <kbd>I</kbd> ignição · <kbd>C</kbd> microfone</>
            : e.portador === 'gerador' ? <><kbd>0</kbd>–<kbd>4</kbd> carga 0/25/50/75/100% · <kbd>I</kbd> ignição · <kbd>C</kbd> microfone</>
            : <><kbd>W</kbd> sobe a rotação · <kbd>I</kbd> ignição · <kbd>C</kbd> microfone · <kbd>J</kbd> freio-motor</>}</p>
        </section>
      </main>

      <aside className="controls" id="controls" aria-label="Parâmetros do motor" data-audio={estado} data-erro={erro ? String(erro) : undefined}>
        <Painel k={k} />
      </aside>
    </div>
  );
}

// comando da carga fora do carro: notch da locomotiva, degrau do gerador, dinamômetro da bancada
function ComandoDaCarga({ k, e }: { k: ControleDiesel; e: EstadoDiesel }) {
  const c = e.carga;
  if (e.portador === 'locomotiva') return (
    <div className="gearbox" id="notches" role="group" aria-label="Notch">
      <button type="button" className="key" onClick={() => k.setNotch(c.notch - 1)} aria-label="Desce o notch">−</button>
      <div className="gear-read"><span className="k">Notch</span><span className="gear mono" id="notchRead">{c.notch === 0 ? 'L' : c.notch}</span></div>
      <button type="button" className="key" onClick={() => k.setNotch(c.notch + 1)} aria-label="Sobe o notch">+</button>
    </div>
  );
  if (e.portador === 'gerador') return (
    <div className="gearbox" id="degraus" role="group" aria-label="Carga do gerador">
      {[0, 0.25, 0.5, 0.75, 1].map((v, i) => (
        <button key={v} type="button" className={`key${c.degrau === v ? ' on' : ''}`} title={`Tecla ${i}`} onClick={() => k.setDegrau(v)}>{Math.round(v * 100)}%</button>
      ))}
    </div>
  );
  return (
    <div className="gearbox" id="dinamometro">
      <div className="gear-read"><span className="k">Dinamômetro</span><span className="gear mono">{Math.round(c.dinamometro * 100)}%</span></div>
    </div>
  );
}

// leituras do diesel (texto preenchido pelo laço dos mostradores) e o traço p–θ
function PainelDiesel({ e }: { e: EstadoDiesel }) {
  const linha = (id: string, k: string) => <div className="ro-row"><span className="k">{k}</span><span className="v mono" id={id}>—</span></div>;
  return (
    <div className="readout diesel-leituras" aria-label="Combustão e escape">
      <canvas id="ptheta" style={{ width: '100%', maxWidth: 200, height: 120, display: 'block' }} aria-label="Pressão no cilindro 1 em função do ângulo" />
      {linha('dPmax', 'Pico no cilindro')}
      {linha('dTau', 'Atraso de ignição')}
      {linha('dLambda', 'Ar/combustível')}
      <div className="ro-row"><span className="k">Opacímetro</span><span className="v"><span className="meter" style={{ display: 'inline-block', width: 80, verticalAlign: 'middle' }}><i id="dOpac" style={{ width: '0%' }} /></span></span></div>
      {linha('dFumaca', 'Fumaça')}
      {linha('dTurbo', e.spec.soprador ? 'Soprador e turbo' : 'Turbo')}
      {linha('dEgt', 'Gás de escape')}
      {linha('dPot', 'Potência')}
      {linha('dCarga', e.portador === 'locomotiva' ? 'Locomotiva' : e.portador === 'gerador' ? 'Gerador' : e.portador === 'nenhum' ? 'Bancada' : 'Velocidade')}
    </div>
  );
}

// ordem, intervalos, frequência de ignição e balanceamento (como no Ronco)
function Leitura({ e }: { e: EstadoDiesel }) {
  const engine = e.motor;
  const graus = (xs: number[]) => xs.map((x) => `${Math.round(x * 10) / 10}°`).join(' ');
  const twoBanks = engine.banks === 2;
  const b = engine.balance;
  const items: [string, number][] = [['Força 1ª', b.f1], ['Força 2ª', b.f2], ['Momento 1ª', b.m1], ['Momento 2ª', b.m2]];
  return (
    <div className="readout">
      <div className="ro-row"><span className="k">Ordem</span><span className="v mono" id="roOrder">{e.spec.ordemReal || engine.order.join('-')}</span></div>
      <div className="ro-row"><span className="k">Intervalos</span><span className="v mono" id="roIntervals">{graus(engine.intervals)}</span></div>
      <div className="ro-row bankA" hidden={!twoBanks}><span className="k">Bancada A</span><span className="v mono" id="roBankA">{twoBanks ? graus(engine.perBank[0]) : ''}</span></div>
      <div className="ro-row bankB" hidden={!twoBanks}><span className="k">Bancada B</span><span className="v mono" id="roBankB">{twoBanks ? graus(engine.perBank[1]) : ''}</span></div>
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
