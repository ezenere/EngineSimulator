// Página do Ronco: barra, presets, instrumentos (conta-giros com pedal, ciclo de ignição com a
// leitura da ordem e do balanceamento, onda e espectro, câmbio) e o painel de controles.
// Mesmo DOM e classes do index.html legado, para o estilo (src/ui/estilo.css) valer igual. Na família aviação o pedal dá
// lugar à manete de potência da Turbina (src/ui/Manete.tsx), que fica onde foi deixada.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { AudioShell, Barra, BotaoIgnicao, PERFIL_RONCO, useAudioShell, dec, resumoGraus, listaGraus } from '../../ui';
import { EngineDSP } from '../../engines/ronco/dsp';
import { PRESETS_PAGINA as PRESETS } from '../../engines/ronco/presets';
import urlRonco from '../../worklet/processador-ronco.ts?worker&url';
import { ControleRonco, familyFor, type EstadoRonco } from './controle';
import { Balanco, BotaoDoFreio, DICA_BALANCO, ManeteDePotencia, NavDePresets, Pedal, PosicoesDaManete } from '../comum/Palco';
import { Mostradores } from '../comum/mostradores';
import { Painel } from './Painel';
import { usarTeclado } from './teclado';

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

// "V8 90° · Cross-plane · 6,2 L · aspirado · 1-8-4-3-6-5-7-2" (updatePlate)
function placa({ spec }: EstadoRonco) {
  const fam = familyFor(spec.layout, spec.cylinders);
  const crank = fam.find((x) => x.id === spec.crank) || fam[0];
  const lay = spec.layout === 'inline' ? `${spec.cylinders} em linha` : spec.layout === 'boxer' ? `Boxer ${spec.cylinders}` : `V${spec.cylinders} ${spec.bankAngle}°`;
  return `${lay} · ${crank.name} · ${dec(spec.displacement, 1)} L · ${spec.aspiration === 'na' ? 'aspirado' : `${spec.aspiration === 'turbo' ? 'turbo' : 'compressor'} ${dec(spec.boost, 1)} bar`} · ${spec.order}`;
}

function Interior({ k, e }: { k: ControleRonco; e: EstadoRonco }) {
  const { iniciar, estado, erro } = useAudioShell();
  k.iniciarAudio = iniciar;
  const [freio, setFreio] = useState(false);
  // (o pedal só existe nos carros)
  const aviao = !!e.spec.aviation;

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


  return (
    <div className="app">
      <Barra logo="Ronco" placa={placa(e)}>
        <BotaoIgnicao id="ignition" ligado={e.ignicao} rotulo={e.ignicao ? 'Desligar' : e.spec.aviation ? 'Magnetos + partida' : 'Ligar motor'} aoClicar={ligar}
          estado={erro ? 'erro' : estado === 'carregando' ? 'ocupado' : undefined} />
      </Barra>

      <NavDePresets k={k} e={e} presets={PRESETS} />

      <main className="cluster">
        <section className="tach-wrap" aria-label="Conta-giros">
          <canvas id="tach" role="img" aria-label="Conta-giros: rotação, velocidade, torque e temperatura do motor" />
          {aviao ? <ManeteDePotencia k={k} /> : <Pedal k={k} rotulo="Acelerador" />}
        </section>

        <section className="firing" aria-label="Ciclo de ignição">
          <canvas id="ring" role="img" aria-label="Ciclo de ignição de 720 graus: cada cilindro acende quando queima" />
          <Leitura e={e} />
        </section>

        <section className="scope-wrap" aria-label="Forma de onda e espectro">
          <canvas id="scope" role="img" aria-label="Forma de onda e espectro do som no ouvido do observador" />
        </section>

        <section className="drive">
          {aviao ? <PosicoesDaManete k={k} /> : (
          <div className="gearbox">
            <button type="button" className="key" id="gDown" aria-label="Reduzir marcha" onClick={() => k.shift(-1)}>Q</button>
            <div className="gear-read"><span className="k">Marcha</span><span className="gear mono" id="gearRead">N</span></div>
            <button type="button" className="key" id="gUp" aria-label="Subir marcha" onClick={() => k.shift(1)}>E</button>
            <BotaoDoFreio k={k} aceso={freio} aoFrear={setFreio} />
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

// ordem, intervalos (total e por bancada), frequência de ignição e balanceamento (renderReadout)
function Leitura({ e }: { e: EstadoRonco }) {
  const engine = e.motor;
  const twoBanks = engine.banks === 2;
  const b = engine.balance;
  const dica = DICA_BALANCO;
  const items: [string, number, string][] = [['Força 1ª', b.f1, dica], ['Força 2ª', b.f2, dica], ['Momento 1ª', b.m1, dica], ['Momento 2ª', b.m2, dica]];
  return (
    <div className="readout">
      <div className="ro-row"><span className="k">Ordem</span><span className="v mono" id="roOrder">{engine.order.join('-')}</span></div>
      <div className="ro-row"><span className="k">Intervalos</span><span className="v mono" id="roIntervals" title={listaGraus(engine.intervals)}>{resumoGraus(engine.intervals)}</span></div>
      <div className="ro-row bankA" hidden={!twoBanks}><span className="k">Bancada A</span><span className="v mono" id="roBankA">{twoBanks ? resumoGraus(engine.perBank[0]) : ''}</span></div>
      <div className="ro-row bankB" hidden={!twoBanks}><span className="k">Bancada B</span><span className="v mono" id="roBankB">{twoBanks ? resumoGraus(engine.perBank[1]) : ''}</span></div>
      {/* atualizado pelo laço dos mostradores */}
      <div className="ro-row"><span className="k">Ignição</span><span className="v mono" id="roFreq">—</span></div>
      <Balanco itens={items} N={engine.N} />
    </div>
  );
}
