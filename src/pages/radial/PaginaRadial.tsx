// Página do Radial (RADIAL.md 7.1): a casca do Ronco (barra, famílias e presets, conta-giros, ciclo de ignição com as
// fileiras e os PMS reais, onda e espectro) mais as leituras da aviação (hélice, magnetos, partida) e o painel de
// controles. Mesmo DOM e classes do Ronco, para o estilo (src/ui/estilo.css) valer. O comando de potência dos aviões e do
// helicóptero é a manete da Turbina (src/ui/Manete.tsx: fica onde foi deixada, com as posições); o do tanque, do carro e
// da moto, o pedal do Ronco.
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react';
import { AudioShell, Barra, BotaoIgnicao, FamilyNav, Manete, PresetNav, PERFIL_RONCO, useAudioShell } from '../../ui';
import { RadialDSP } from '../../engines/radial/dsp';
import { PRESETS_RADIAL } from '../../engines/radial/presets';
import urlRadial from '../../worklet/processador-radial.ts?worker&url';
import { ControleRadial, MARCAS_MANETE, POSICOES_MANETE, type EstadoRadial } from './controle';
import { Mostradores } from '../ronco/mostradores';
import { escreverLeiturasAv } from '../comum/Aviacao';
import { Painel } from './Painel';
import { usarTeclado } from './teclado';

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

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
  const pedal = useRef<HTMLDivElement>(null);
  const pedalFill = useRef<HTMLDivElement>(null);
  const terra = (e.spec.portadores || []).includes('carro');

  // (o pedal só existe no tanque, no carro e na moto)
  useEffect(() => { k.pedal = pedal.current; k.pedalFill = pedalFill.current; }, [k, terra]);
  useEffect(() => {
    // alça para os testes no navegador (tools/radial-navegador.mjs)
    (window as any).__radial = k;
    const m = new Mostradores(k as any);
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
  const padFrom = (ev: PointerEvent) => { const r = pedal.current!.getBoundingClientRect(); return clamp(1 - (ev.clientY - r.top) / r.height, 0, 1); };
  const solta = () => { k.input.pad = 0; k.sendInput(); };

  return (
    <div className="app">
      <Barra logo="Radial" placa={placa(e)}>
        <BotaoIgnicao id="ignition" ligado={e.ignicao} rotulo={rotuloPartida(e, e.fase)} aoClicar={ligar} />
      </Barra>

      <nav className="presets" id="presets" aria-label="Motores prontos">
        <FamilyNav familias={PRESETS_RADIAL.families} presets={PRESETS_RADIAL} atual={e.familia} aoEscolher={(id) => k.setFamilia(id)} />
        <PresetNav presets={PRESETS_RADIAL} familia={e.familia} atual={e.presetId} aoEscolher={(p) => k.loadPreset(p)} />
      </nav>

      <main className="cluster">
        <section className="tach-wrap" aria-label="Conta-giros">
          <canvas id="tach" />
          {terra ? (
            <div className="pedal" id="pedal" ref={pedal} role="slider" tabIndex={0} aria-label="Acelerador" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}
              onPointerDown={(ev) => { pedal.current!.setPointerCapture(ev.pointerId); k.input.pad = padFrom(ev); k.sendInput(); }}
              onPointerMove={(ev) => { if (pedal.current!.hasPointerCapture(ev.pointerId)) { k.input.pad = padFrom(ev); k.sendInput(); } }}
              onPointerUp={solta} onPointerCancel={solta}>
              <div className="pedal-fill" id="pedalFill" ref={pedalFill} />
              <span className="pedal-label">Acelerador</span>
            </div>
          ) : <ManeteRadial k={k} />}
        </section>

        <section className="firing" aria-label="Ciclo de ignição">
          <canvas id="ring" />
          <Leitura e={e} />
        </section>

        <section className="scope-wrap" aria-label="Forma de onda e espectro">
          <canvas id="scope" />
        </section>

        <section className="drive">
          {!terra && <Posicoes k={k} />}
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

// manete de potência (a da Turbina): só ela re-renderiza quando a posição muda
function ManeteRadial({ k }: { k: ControleRadial }) {
  const v = useSyncExternalStore(k.assinarManete, k.obterManete);
  return <Manete valor={v} marcas={MARCAS_MANETE} aoMudar={(x) => k.setManete(x)} obter={() => k.manete} passo={0.1} rotulo="Manete de potência" />;
}

// posições da manete (teclas 1–4)
function Posicoes({ k }: { k: ControleRadial }) {
  const v = useSyncExternalStore(k.assinarManete, k.obterManete);
  return (
    <div className="gearbox detentes" id="detents">
      {POSICOES_MANETE.map(([x, , texto]) => (
        <button key={texto} type="button" className={`key${Math.abs(x - v) < 0.01 ? ' at' : ''}`} data-manete={x} onClick={() => k.setManete(x)}>{texto}</button>
      ))}
    </div>
  );
}

// ordem, intervalos (total e por fileira), ΔPMS das articuladas e balanceamento
function Leitura({ e }: { e: EstadoRadial }) {
  const m = e.motor;
  const graus = (xs: number[]) => xs.map((x) => `${Math.round(x * 10) / 10}°`).join(' ');
  const b = m.balance;
  const items: [string, number][] = [['1ª − N/2', m.f1Residuo], ['Força 2ª', b.f2], ['Momento 1ª', b.m1], ['Momento 2ª', b.m2]];
  return (
    <div className="readout">
      <div className="ro-row"><span className="k">Ordem</span><span className="v mono" id="roOrder">{m.decorrente ? `${m.ordemTexto} (decorrente)` : m.ordemTexto}</span></div>
      <div className="ro-row"><span className="k">Intervalos</span><span className="v mono" id="roIntervals">{graus(m.intervals)}</span></div>
      {m.rows > 1 && m.perBank.map((pb, r) => (
        <div key={r} className="ro-row"><span className="k">Fileira {r + 1}</span><span className="v mono">{graus(pb)}</span></div>
      ))}
      <div className="ro-row"><span className="k">ΔPMS das articuladas</span><span className="v mono">{m.dPMS.slice(0, m.cylPerRow).map((x) => (x >= 0 ? '+' : '') + x.toFixed(1)).join(' ')}°</span></div>
      <div className="ro-row"><span className="k">Ignição</span><span className="v mono" id="roFreq">—</span></div>
      <div className="balance" id="balance">
        {items.map(([kk, v]) => {
          const w = clamp(v / Math.max(2, m.N * 0.5), 0, 1) * 100;
          return (
            <div key={kk} className="bal" title="Forças alternativas que sobram depois do contrapeso, em múltiplos de um cilindro">
              <span className="k">{kk}</span>
              <div className="meter"><i className={v < 1e-3 ? 'zero' : ''} style={{ width: `${w}%` }} /></div>
              <span className="val">{v < 1e-3 ? 'zero' : v.toFixed(2)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
