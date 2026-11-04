// Página do Vapor (docs/VAPOR.md 6): famílias e máquinas em chips, manômetro, fita de escapes e leituras, cenários e o
// painel. O som é a Cena (processador `vapor` = CenaDSP com o portador do preset e o VaporDSP), com a cadeia da Passagem
// (escala absoluta, reverberação por banda). O React monta a estrutura; o estado fica em ControleVapor e os mostradores
// são desenhados num só requestAnimationFrame lendo a telemetria de um campo.
import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AudioShell, Barra, FamilyNav, PresetNav, PERFIL_PASSAGEM, useAudioShell } from '../../ui';
import { CenaDSP } from '../../scene/dsp-cena';
import urlVapor from '../../worklet/processador-vapor.ts?worker&url';
import { PRESETS_VAPOR, FAMILIAS_VAPOR, type FamiliaVapor } from '../../engines/vapor/presets';
import { ControleVapor, CENARIOS, fmt } from './controle';
import { Painel } from './Painel';
import { desenharManometro, desenharFita, escreverLeituras, MedidorPico, type Leituras } from './mostradores';
import { usarTeclado } from './teclado';

const PRESETS_NAV = PRESETS_VAPOR.map((p) => ({ id: p.id, name: p.nome, tag: p.tag, family: p.familia }));
const FAMILIAS_NAV = FAMILIAS_VAPOR.map((f) => ({ id: f.id, name: f.nome }));

export function PaginaVapor() {
  const [k] = useState(() => new ControleVapor());
  return (
    <AudioShell perfil={PERFIL_PASSAGEM} moduloUrl={urlVapor} processador="vapor" criarDspLocal={(fs) => new CenaDSP(fs)}
      ambiente="passagem" medidor aoMensagem={k.onTelemetria}>
      <Interior k={k} />
    </AudioShell>
  );
}

function Interior({ k }: { k: ControleVapor }) {
  const { iniciar, estado, erro } = useAudioShell();
  k.iniciar = iniciar;
  const e = useSyncExternalStore(k.assinar, k.obter);
  const cvM = useRef<HTMLCanvasElement>(null), cvF = useRef<HTMLCanvasElement>(null);
  const leituras = useRef<Leituras>({});
  usarTeclado(k);

  useEffect(() => {
    // alça para os testes no navegador (tools/vapor-navegador.mjs)
    (window as any).__vapor = k;
    const pico = new MedidorPico();
    let id = 0, n = 0;
    const quadro = (agora: number) => {
      k.quadro(agora);
      const pk = pico.medir(k);
      if ((n++ & 1) === 0) {
        if (cvM.current) desenharManometro(k, cvM.current);
        escreverLeituras(k, leituras.current, pk);
      }
      if (cvF.current) desenharFita(k, cvF.current);
      id = requestAnimationFrame(quadro);
    };
    id = requestAnimationFrame(quadro);
    return () => cancelAnimationFrame(id);
  }, [k]);

  const P = k.P;
  const ligado = estado === 'pronto';
  const rotulo = erro ? `Erro no áudio: ${String((erro as Error)?.message || erro)}` : e.calibrando ? 'Calibrando…' : ligado ? 'Som ligado' : estado === 'carregando' ? 'Carregando…' : 'Ligar o som';
  return (
    <div className="app vapor">
      <Barra logo="Vapor" placa={`${P.nome} · ${P.rodeiro ?? P.tag} · ${fmt(P.pNominal, 1)} bar · ${P.cilindros.n}${P.motores === 2 ? ' × 2' : ''} cil.${P.compound ? ' compound' : ''}`}>
        <button id="ignicao" className="ignition" type="button" aria-pressed={ligado} onClick={() => { k.ligar().catch((err) => console.error('Vapor: áudio não iniciou', err)); }}>
          <span className="dot" /><span>{rotulo}</span>
        </button>
      </Barra>

      <nav className="presets" id="presets" aria-label="Máquinas">
        <FamilyNav familias={FAMILIAS_NAV} presets={PRESETS_NAV} atual={e.familia} aoEscolher={(id) => k.setFamilia(id as FamiliaVapor)} />
        <PresetNav presets={PRESETS_NAV} familia={e.familia} atual={e.presetId} aoEscolher={(p) => k.setPreset(p.id)} />
      </nav>

      <main className="cluster painel-vapor">
        <section className="manometro" aria-label="Manômetro">
          <canvas id="manometro" ref={cvM} />
        </section>
        <Telemetria leituras={leituras} />
        <section className="fita" aria-label="Escapes">
          <canvas id="fita" ref={cvF} />
          <div className="esforco" title="esforço de tração × adesão"><i id="barraEsforco" ref={(el) => { if (el) leituras.current.barraEsforco = el; }} /></div>
        </section>
        <section className="drive">
          <div className="acoes" id="cenarios" role="group" aria-label="Cenários">
            {CENARIOS.map((c) => (
              <button key={c.id} type="button" className="key wide" data-cenario={c.id} aria-pressed={e.cenario === c.id} title={c.titulo}
                onClick={() => (e.cenario === c.id ? k.pararCenario() : void k.cenario(c.id).catch((err) => console.error(err)))}>{c.nome}</button>
            ))}
          </div>
          {P.nota && <p className="note">{P.nota}</p>}
          <p className="hints"><kbd>W</kbd>/<kbd>S</kbd> regulador · <kbd>X</kbd> fecha · <kbd>A</kbd>/<kbd>D</kbd> reverser · <kbd>H</kbd> apito (segure) · <kbd>B</kbd> sino · <kbd>E</kbd> areia (segure) · <kbd>T</kbd> torneiras · <kbd>Espaço</kbd> freio · <kbd>I</kbd> injetor</p>
        </section>
      </main>

      <aside className="controls" id="controls" aria-label="Controles da máquina" data-audio={estado}>
        <Painel k={k} />
      </aside>
    </div>
  );
}

const Telemetria = memo(function Telemetria({ leituras }: { leituras: { current: Leituras } }) {
  const linha = (rot: string, id: string, grande = false) => (
    <div className={`ro-row${grande ? ' grande' : ''}`}><span className="k">{rot}</span><span className="v mono" id={`ro-${id}`} ref={(el) => { if (el) leituras.current[id] = el; }}>—</span></div>
  );
  return (
    <section className="telemetria readout" aria-label="Leituras">
      {linha('Velocidade', 'v', true)}
      {linha('Roda', 'roda')}
      {linha('Corte', 'corte')}
      {linha('Chuffs', 'chuffs', true)}
      {linha('Release', 'release')}
      {linha('Esforço', 'esforco')}
      {linha('Estados', 'estados')}
      {linha('Vapor', 'vapor')}
      {linha('Apito', 'apito')}
      {linha('No ouvido', 'nivel', true)}
      {linha('', 'pico')}
    </section>
  );
});
