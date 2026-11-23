// Página do Radial (RADIAL.md 7.1): a casca do Ronco (barra, famílias e presets, conta-giros, ciclo de ignição com as
// fileiras e os PMS reais, onda e espectro) mais as leituras da aviação (hélice, magnetos, partida) e o painel de
// controles. Mesmo DOM e classes do Ronco, para o estilo (src/ui/estilo.css) valer. O comando de potência dos aviões e do
// helicóptero é a manete da Turbina (src/ui/Manete.tsx: fica onde foi deixada, com as posições); o do tanque, do carro e
// da moto, o pedal do Ronco.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { AudioShell, Barra, BotaoIgnicao, PERFIL_RONCO, useAudioShell, dec, grau, resumoGraus, listaGraus } from '../../ui';
import { RadialDSP } from '../../engines/radial/dsp';
import { PRESETS_RADIAL } from '../../engines/radial/presets';
import urlRadial from '../../worklet/processador-radial.ts?worker&url';
import { ControleRadial, type EstadoRadial } from './controle';
import { Balanco, ManeteDePotencia, NavDePresets, Pedal, PosicoesDaManete } from '../comum/Palco';
import { Mostradores } from '../comum/mostradores';
import { escreverLeiturasAv } from '../comum/Aviacao';
import { Painel } from './Painel';
import { usarTeclado } from './teclado';

export function PaginaRadial() {
  const [k] = useState(() => new ControleRadial());
  const e = useSyncExternalStore(k.assinar, k.obter);
  return (
    <AudioShell perfil={PERFIL_RONCO} moduloUrl={urlRadial} processador="radial-engine" criarDspLocal={(fs) => new RadialDSP(fs)}
      ambiente={e.params.env} ouvinte={e.params.listener} aoMensagem={k.aoTelemetria}>
      <Interior k={k} e={e} />
    </AudioShell>
  );
}

// "Radial 9 · biela-mestra · 29,9 L · superalimentado 0,35 bar · 1-3-5-7-9-2-4-6-8"
function placa({ spec, motor }: EstadoRadial) {
  const arr = motor.rows === 1 ? `Radial ${motor.N}` : `Radial ${motor.N} (${motor.rows} × ${motor.cylPerRow})`;
  const sa = spec.superalimentador ? `superalimentado ${spec.superalimentador.boost.toFixed(2).replace('.', ',')} bar` : 'aspirado';
  return `${arr} · ${motor.crank.name} · ${spec.displacement.toFixed(1).replace('.', ',')} L · ${sa} · ${motor.decorrente ? 'ordem decorrente' : motor.ordemTexto}${spec.aproximacao ? ' · aproximação' : ''}`;
}

function rotuloPartida(e: EstadoRadial, fase: string | undefined) {
  if (e.ignicao && fase === 'girar' && e.magnetosTele === 'desligado') return 'Magnetos (I)';
  if (!e.ignicao) return e.spec.partida === 'inercia' ? 'Energizar' : e.spec.partida === 'ar' ? 'Partida a ar' : e.spec.partida === 'manivela' ? 'Empurrar' : 'Girar';
  if (fase === 'energizar') return 'Engatar';
  return 'Desligar';
}

function Interior({ k, e }: { k: ControleRadial; e: EstadoRadial }) {
  const { iniciar, estado, erro } = useAudioShell();
  k.iniciarAudio = iniciar;
  // (o pedal só existe no tanque, no carro e na moto)
  const terra = (e.spec.portadores || []).includes('carro');

  useEffect(() => {
    // alça para os testes no navegador (tools/radial-navegador.mjs)
    (window as any).__radial = k;
    // (refrigerado a ar: a temperatura do conta-giros é a da cabeça dos cilindros, pelo `cooling: 'air'` do PADRAO_RADIAL)
    const m = new Mostradores(k);
    m.iniciar();
    // leituras da aviação a cada quadro, fora do React; e a manete com as teclas seguradas
    let raf = 0, antes = 0;
    const laco = (agora: number) => {
      k.segurar(antes ? Math.min(0.1, (agora - antes) / 1000) : 0); antes = agora;
      escreverLeiturasAv(k.tele); raf = requestAnimationFrame(laco);
    };
    raf = requestAnimationFrame(laco);
    return () => { m.parar(); cancelAnimationFrame(raf); };
  }, [k]);
  usarTeclado(k);

  const ligar = () => { k.toggleIgnition().catch((err) => console.error('Radial: áudio não iniciou', err)); };

  return (
    <div className="app">
      <Barra logo="Radial" placa={placa(e)}>
        <BotaoIgnicao id="ignition" ligado={e.ignicao} rotulo={rotuloPartida(e, e.fase)} aoClicar={ligar}
          estado={erro ? 'erro' : estado === 'carregando' ? 'ocupado' : undefined} />
      </Barra>

      <NavDePresets k={k} e={e} presets={PRESETS_RADIAL} />

      <main className="cluster">
        <section className="tach-wrap" aria-label="Conta-giros">
          <canvas id="tach" role="img" aria-label="Conta-giros: rotação do motor, rotação da hélice, torque, temperatura e fase da partida" />
          {terra ? <Pedal k={k} rotulo="Acelerador" /> : <ManeteDePotencia k={k} />}
        </section>

        <section className="firing" aria-label="Ciclo de ignição">
          <canvas id="ring" role="img" aria-label="Ciclo de ignição de 720 graus, com uma trilha por fileira de cilindros" />
          <Leitura e={e} />
        </section>

        <section className="scope-wrap" aria-label="Forma de onda e espectro">
          <canvas id="scope" role="img" aria-label="Forma de onda e espectro do som no ouvido do observador" />
        </section>

        <section className="drive">
          {!terra && <PosicoesDaManete k={k} />}
          {terra && (
            <div className="gearbox">
              <button type="button" className="key" aria-label="Reduzir marcha" onClick={() => k.shift(-1)}>Q</button>
              <div className="gear-read"><span className="k">Marcha</span><span className="gear mono" id="gearRead">N</span></div>
              <button type="button" className="key" aria-label="Subir marcha" onClick={() => k.shift(1)}>E</button>
            </div>
          )}
          <p className="hints">{terra
            ? <><kbd>W</kbd>/<kbd>↑</kbd>/<kbd>Espaço</kbd> acelera · <kbd>Shift</kbd> meio pé · <kbd>Q</kbd>/<kbd>E</kbd> câmbio</>
            : <><kbd>W</kbd>/<kbd>↑</kbd> avança a manete · <kbd>S</kbd>/<kbd>↓</kbd> recua · <kbd>1</kbd>–<kbd>4</kbd> posições</>} · <kbd>I</kbd> partida (energizar, engatar, magnetos) · <kbd>M</kbd> magnetos · <kbd>[</kbd>/<kbd>]</kbd> mistura · <kbd>,</kbd>/<kbd>.</kbd> passo · <kbd>C</kbd> microfone</p>
        </section>
      </main>

      <aside className="controls" id="controls" aria-label="Parâmetros do motor" data-audio={estado} data-erro={erro ? String(erro) : undefined}>
        <Painel k={k} />
      </aside>
    </div>
  );
}

// ordem, intervalos (total e por fileira), ΔPMS das articuladas e balanceamento
// Com muitos cilindros as listas viram resumos (a lista inteira fica na dica de cada leitura), para o ciclo ter espaço.
function Leitura({ e }: { e: EstadoRadial }) {
  const m = e.motor;
  const b = m.balance;
  const dica = (t: string) => `${t}, em múltiplos de um cilindro`;
  const items: [string, number, string][] = [
    ['Força 1ª', m.f1Residuo, dica('Força de 1ª ordem que sobra depois do contrapeso (o contrapeso leva metade dos cilindros)')],
    ['Força 2ª', b.f2, dica('Força alternativa de 2ª ordem')], ['Momento 1ª', b.m1, dica('Momento de 1ª ordem entre as fileiras')], ['Momento 2ª', b.m2, dica('Momento de 2ª ordem entre as fileiras')],
  ];
  const dp = m.dPMS.slice(0, m.cylPerRow);
  const dpTexto = dp.map((x) => (x >= 0 ? '+' : '−') + dec(Math.abs(x), 1)).join(' ') + '°';
  const mesmasFileiras = m.rows > 2;
  return (
    <div className="readout">
      <div className="ro-row"><span className="k">Ordem</span><span className="v mono" id="roOrder">{m.decorrente ? `${m.ordemTexto} (decorrente)` : m.ordemTexto}</span></div>
      <div className="ro-row"><span className="k">Intervalos</span><span className="v mono" id="roIntervals" title={listaGraus(m.intervals)}>{resumoGraus(m.intervals, 9)}</span></div>
      {m.rows > 1 && !mesmasFileiras && m.perBank.map((pb, r) => (
        <div key={r} className="ro-row"><span className="k">Fileira {r + 1}</span><span className="v mono" title={listaGraus(pb)}>{resumoGraus(pb, 7)}</span></div>
      ))}
      {mesmasFileiras && (
        <div className="ro-row" title={m.perBank.map((pb, r) => `Fileira ${r + 1}: ${listaGraus(pb)}`).join('\n')}>
          <span className="k">Fileiras</span><span className="v mono">{m.rows} de {m.cylPerRow} cilindros · {grau(Math.min(...m.perBank.flat()))} a {grau(Math.max(...m.perBank.flat()))}</span>
        </div>
      )}
      <div className="ro-row" title={`Quanto o ponto morto superior de cada biela articulada foge do ideal: ${dpTexto}`}>
        <span className="k">Desvio PMS</span><span className="v mono">{dp.length > 7 ? `de ${dec(Math.min(...dp), 1)}° a +${dec(Math.max(...dp), 1)}°` : dpTexto}</span>
      </div>
      <div className="ro-row"><span className="k">Ignição</span><span className="v mono" id="roFreq">—</span></div>
      {/* (no radial, abaixo de um milésimo de cilindro conta como zero) */}
      <Balanco itens={items} N={m.N} eZero={(v) => v < 1e-3} />
    </div>
  );
}
