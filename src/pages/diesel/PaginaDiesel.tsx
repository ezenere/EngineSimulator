// Página do Diesel: a casca do Ronco (barra, famílias e presets, conta-giros com pedal, ciclo de ignição com a
// leitura da ordem, onda e espectro, câmbio) mais a coluna do diesel (traço p–θ e as leituras de combustão, turbo,
// escape e carga do portador) e o painel de controles. Mesmo DOM e classes do Ronco, para o estilo (src/ui/estilo.css)
// valer. O pedal só aparece onde ele manda: no veículo (combustível) e na bancada (rotação); no gerador e na locomotiva
// o governador é isócrono e o comando é o degrau de carga ou o notch.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { AudioShell, Barra, BotaoIgnicao, PERFIL_RONCO, useAudioShell, dec, resumoGraus, listaGraus } from '../../ui';
import { DieselDSP } from '../../engines/diesel/dsp';
import { PRESETS } from '../../engines/diesel/presets';
import urlDiesel from '../../worklet/processador-diesel.ts?worker&url';
import { ControleDiesel, familyFor, type EstadoDiesel } from './controle';
import { Balanco, DICA_BALANCO, NavDePresets, Pedal } from '../comum/Palco';
import { Mostradores } from './mostradores';
import { Painel } from './Painel';
import { usarTeclado } from './teclado';

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

// "4 em linha · Plano (180°) · 2,8 L · 4 tempos · common-rail · turbo 2,4 bar · 1-3-4-2"
const NOME_INJECAO: Record<string, string> = { 'common-rail': 'common-rail', rotativa: 'bomba rotativa', 'em-linha': 'bomba em linha', unitaria: 'injetor-bomba', heui: 'HEUI', pld: 'bomba-tubo-bico' };
function placa({ spec, motor }: EstadoDiesel) {
  const fam = familyFor(spec.layout, spec.cylinders, spec.tempos);
  const crank = fam.find((x) => x.id === spec.crank) || fam[0];
  const lay = spec.layout === 'inline' ? `${spec.cylinders} em linha` : `V${spec.cylinders} ${spec.bankAngle}°`;
  const asp = spec.aspiration === 'turbo' ? `turbo ${dec(1 + spec.boost, 1)} bar` : spec.soprador ? 'Roots' : 'aspirado';
  const L = spec.displacement >= 20 ? spec.displacement.toFixed(0) : dec(spec.displacement, 1);
  return `${lay} · ${crank?.name ?? ''} · ${L} L · ${spec.tempos} tempos · ${NOME_INJECAO[spec.injecao] ?? spec.injecao} · ${asp} · ${spec.ordemReal || motor.order.join('-')}`;
}

function Interior({ k, e }: { k: ControleDiesel; e: EstadoDiesel }) {
  const { iniciar, estado, erro } = useAudioShell();
  k.iniciarAudio = iniciar;
  const [freio, setFreio] = useState(false);

  const carro = e.portador === 'carro';
  // o pedal manda combustível no veículo e a rotação na bancada; no gerador e na locomotiva ele não faz nada
  const comPedal = carro || e.portador === 'nenhum';
  useEffect(() => {
    // alça para os testes no navegador (tools/diesel-navegador.mjs)
    (window as any).__diesel = k;
    const m = new Mostradores(k);
    m.iniciar();
    return () => m.parar();
  }, [k]);
  usarTeclado(k, setFreio);

  const ligar = () => { k.toggleIgnition().catch((err) => console.error('Diesel: áudio não iniciou', err)); };
  // (soltar o pedal da tela também solta o acelerador do teclado)
  const solta = () => { k.input.pad = 0; k.input.key = 0; k.sendInput(); };
  const freia = (on: boolean) => { k.input.brake = on ? 1 : 0; k.sendInput(); setFreio(on); };

  return (
    <div className="app">
      <Barra logo="Diesel" placa={placa(e)}>
        <BotaoIgnicao id="ignition" ligado={e.ignicao} rotulo={e.ignicao ? 'Desligar' : 'Ligar motor'} aoClicar={ligar}
          estado={erro ? 'erro' : estado === 'carregando' ? 'ocupado' : undefined} />
      </Barra>

      <NavDePresets k={k} e={e} presets={PRESETS} />

      <main className="cluster cluster-3">
        <section className="tach-wrap" aria-label="Conta-giros">
          <canvas id="tach" role="img" aria-label="Conta-giros: rotação, pressão do turbo, torque e temperatura do motor" />
          {comPedal && <Pedal k={k} rotulo={carro ? 'Acelerador' : 'Rotação'} nome={carro ? 'Acelerador' : 'Rotação da bancada'} aoSoltar={solta} />}
        </section>

        <section className="firing" aria-label="Ciclo de ignição">
          <canvas id="ring" role="img" aria-label={`Ciclo de ignição de ${e.motor.tempos === 2 ? 360 : 720} graus: cada cilindro acende quando queima`} />
          <Leitura e={e} />
        </section>

        <section className="extra" aria-label="Combustão, turbo e escape">
          <PainelDiesel e={e} />
        </section>

        <section className="scope-wrap" aria-label="Forma de onda e espectro">
          <canvas id="scope" role="img" aria-label="Forma de onda e espectro do som no ouvido do observador" />
        </section>

        <section className="drive">
          {carro ? (
            <div className="gearbox">
              <button type="button" className="key" id="gDown" aria-label="Reduzir marcha" onClick={() => k.shift(-1)}>Q</button>
              <div className="gear-read"><span className="k">Marcha</span><span className="gear mono" id="gearRead">N</span></div>
              <button type="button" className="key" id="gUp" aria-label="Subir marcha" onClick={() => k.shift(1)}>E</button>
              <button type="button" className={`key wide${freio ? ' on' : ''}`} id="brakeBtn" title="Freio (segure)"
                onPointerDown={() => freia(true)} onPointerUp={() => freia(false)} onPointerLeave={() => freia(false)} onPointerCancel={() => freia(false)}>S · freio</button>
              <button type="button" className="valve-tag" id="valveTag" title="Troca o modo do escape ativo (B)" onClick={() => k.cycleValve()} hidden>válvula fechada</button>
            </div>
          ) : <ComandoDaCarga k={k} e={e} />}
          <p className="hints">{carro
            ? <><kbd>W</kbd>/<kbd>↑</kbd> acelera · <kbd>Shift</kbd> meio pé · <kbd>S</kbd> freia · <kbd>Q</kbd>/<kbd>E</kbd> câmbio · <kbd>J</kbd> freio-motor · <kbd>I</kbd> ignição · <kbd>C</kbd> microfone · <kbd>V</kbd> observador · <kbd>M</kbd> modo do câmbio</>
            : e.portador === 'locomotiva' ? <><kbd>0</kbd>–<kbd>8</kbd> notch · <kbd>+</kbd>/<kbd>−</kbd> sobe e desce · <kbd>I</kbd> ignição · <kbd>C</kbd> microfone</>
            : e.portador === 'gerador' ? <><kbd>0</kbd>–<kbd>4</kbd> carga 0/25/50/75/100% · <kbd>I</kbd> ignição · <kbd>C</kbd> microfone</>
            : <><kbd>W</kbd>/<kbd>↑</kbd> sobe a rotação · <kbd>I</kbd> ignição · <kbd>C</kbd> microfone · <kbd>J</kbd> freio-motor</>}</p>
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
    <div className="gearbox" id="notches" role="group" aria-label="Notch (ponto de aceleração)">
      <button type="button" className="key" onClick={() => k.setNotch(c.notch - 1)} aria-label="Desce o notch" disabled={c.notch <= 0}>−</button>
      <div className="gear-read"><span className="k">Notch</span><span className="gear mono" id="notchRead">{c.notch === 0 ? 'L' : c.notch}</span></div>
      <button type="button" className="key" onClick={() => k.setNotch(c.notch + 1)} aria-label="Sobe o notch" disabled={c.notch >= 8}>+</button>
    </div>
  );
  if (e.portador === 'gerador') return (
    <div className="gearbox" id="degraus" role="group" aria-label="Carga do gerador">
      <div className="gear-read"><span className="k">Carga</span></div>
      {[0, 0.25, 0.5, 0.75, 1].map((v, i) => (
        <button key={v} type="button" className="key wide" aria-pressed={c.degrau === v} title={`Tecla ${i}`} onClick={() => k.setDegrau(v)}>{Math.round(v * 100)}%</button>
      ))}
    </div>
  );
  // bancada: o dinamômetro é o controle do painel (seção Carga); aqui fica só a leitura
  return (
    <div className="gearbox" id="dinoRead" title="Carga do dinamômetro: ajuste em Carga, no painel">
      <div className="gear-read"><span className="k">Carga do dinamômetro</span><span className="gear mono">{Math.round(c.dinamometro * 100)}%</span></div>
    </div>
  );
}

// A coluna do diesel: o traço p–θ em cima e as leituras embaixo (texto preenchido pelo laço dos mostradores). Em tela
// larga é a terceira coluna do palco; em tela estreita vira uma faixa com o traço à esquerda e as leituras em grade.
function PainelDiesel({ e }: { e: EstadoDiesel }) {
  const linha = (id: string, k: string, dica?: string) => <div className="ro-row" title={dica}><span className="k">{k}</span><span className="v mono" id={id}>—</span></div>;
  return (
    <>
      <canvas id="ptheta" className="traco quadro" role="img" aria-label="Pressão no cilindro 1 em função do ângulo do virabrequim" />
      <div className="readout">
        {linha('dPmax', 'Pico no cilindro', 'Pressão de pico no cilindro 1 e a taxa de subida (a “batida” do diesel)')}
        {linha('dTau', 'Atraso', 'Atraso de ignição: do começo da injeção ao começo da queima')}
        {linha('dLambda', 'Ar/combustível', 'λ: quantas vezes mais ar do que o necessário para queimar o combustível')}
        <div className="ro-row"><span className="k">Opacímetro</span><span className="v"><span className="meter-linha"><i id="dOpac" style={{ width: '0%' }} /></span></span></div>
        {linha('dFumaca', 'Fumaça')}
        {linha('dTurbo', e.spec.aspiration === 'turbo' ? 'Turbo' : e.spec.soprador ? 'Soprador' : 'Admissão')}
        {linha('dEgt', 'Gás de escape')}
        {linha('dPot', 'Potência')}
        {linha('dCarga', e.portador === 'locomotiva' ? 'Tração' : e.portador === 'gerador' ? 'Alternador' : e.portador === 'nenhum' ? 'Dinamômetro' : 'Velocidade')}
      </div>
    </>
  );
}

// ordem, intervalos, frequência de ignição e balanceamento (como no Ronco)
function Leitura({ e }: { e: EstadoDiesel }) {
  const engine = e.motor;
  const twoBanks = engine.banks === 2;
  const b = engine.balance;
  const dica = DICA_BALANCO;
  const items: [string, number, string][] = [['Força 1ª', b.f1, dica], ['Força 2ª', b.f2, dica], ['Mom. 1ª', b.m1, dica], ['Mom. 2ª', b.m2, dica]];
  return (
    <div className="readout">
      <div className="ro-row"><span className="k">Ordem</span><span className="v mono" id="roOrder">{e.spec.ordemReal || engine.order.join('-')}</span></div>
      <div className="ro-row"><span className="k">Intervalos</span><span className="v mono" id="roIntervals" title={listaGraus(engine.intervals)}>{resumoGraus(engine.intervals)}</span></div>
      <div className="ro-row bankA" hidden={!twoBanks}><span className="k">Bancada A</span><span className="v mono" id="roBankA">{twoBanks ? resumoGraus(engine.perBank[0]) : ''}</span></div>
      <div className="ro-row bankB" hidden={!twoBanks}><span className="k">Bancada B</span><span className="v mono" id="roBankB">{twoBanks ? resumoGraus(engine.perBank[1]) : ''}</span></div>
      <div className="ro-row"><span className="k">Ignição</span><span className="v mono" id="roFreq">—</span></div>
      <Balanco itens={items} N={engine.N} />
    </div>
  );
}
