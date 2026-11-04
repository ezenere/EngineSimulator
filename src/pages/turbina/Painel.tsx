// Painel de controles da Turbina (renderControls() de src/jet-app.js).
// Como no legado, o painel inteiro é montado de novo quando algo estrutural muda (tópico "painel"):
// a `key` com a versão faz o React recriar os controles, então cada Slider nasce com o valor atual
// do spec. Arrastar um slider "ao vivo" muda o som sem redesenhar nada.
import { Fragment, useLayoutEffect, useRef, type PointerEvent, type RefObject } from 'react';
import { AMBIENTES_TURBINA, ChipGroup, Field, Section, Slider } from '../../ui';
import { ARCH, fmt, useTopico, type ControleTurbina } from './controle';
import { pickMap } from './desenho';

export type RefsDoMapa = { mapa: RefObject<HTMLCanvasElement | null>; nota: RefObject<HTMLParagraphElement | null> };

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function Painel({ c, refs }: { c: ControleTurbina; refs: RefsDoMapa }) {
  const versao = useTopico(c, 'painel');
  const aside = useRef<HTMLElement>(null);
  const scroll = useRef(0);
  // o legado guardava e restaurava a rolagem ao redesenhar o painel
  scroll.current = aside.current?.scrollTop ?? scroll.current;
  useLayoutEffect(() => { if (aside.current) aside.current.scrollTop = scroll.current; }, [versao]);
  return (
    <aside className="controls" id="controls" aria-label="Parâmetros do motor" ref={aside}>
      <Conteudo key={versao} c={c} refs={refs} />
    </aside>
  );
}

function Conteudo({ c, refs }: { c: ControleTurbina; refs: RefsDoMapa }) {
  const spec = c.spec, params = c.params;
  const prop = spec.arch === 'turboprop', jet = spec.arch === 'turbojet';
  const live = c.live;
  const set = (patch: any, structural = false) => c.setSpec(patch, { structural });
  const fanName = prop ? 'Gerador de gás' : jet ? 'Compressor de baixa' : 'Fan';
  const f = c.fanFacts();
  const Mh = (Math.PI * spec.propD * spec.propRpm) / 60 / 340;
  const num = (n: number) => ({ valor: n, rotulo: String(n) });

  return (
    <>
      <Section titulo="Motor">
        <Field rotulo="Arquitetura">
          <ChipGroup id="arch" opcoes={Object.entries(ARCH).map(([v, rotulo]) => ({ valor: v, rotulo }))} atual={spec.arch} aoEscolher={(v) => {
            const patch: any = { arch: v };
            if (v === 'turboprop') Object.assign(patch, { propB: spec.propB || 6, propD: spec.propD || 3.5, propRpm: spec.propRpm || 1200, ab: false });
            if (v === 'geared' && !(spec.gear > 1)) patch.gear = 3;
            if (v === 'turbojet') patch.bpr = 0;
            if ((v === 'turbofan' || v === 'geared') && !(spec.bpr > 0.2)) patch.bpr = 5;
            set(patch, true);
          }} />
        </Field>
        <Field rotulo="Número de motores">
          <ChipGroup id="engines" classe="num" opcoes={[1, 2, 3, 4].map(num)} atual={spec.engines}
            aoEscolher={(v) => set({ engines: v, span: spec.span || (v > 1 ? 6 : 0) }, true)} />
        </Field>
        <Field rotulo="Eixos">
          <ChipGroup id="spools" classe="num" opcoes={[
            { valor: 1, rotulo: '1', titulo: 'Compressor e fan no mesmo eixo: os tons andam juntos' },
            { valor: 2, rotulo: '2' }, { valor: 3, rotulo: '3', titulo: 'Eixo intermediário: mais uma família de tons' },
          ]} atual={spec.spools} aoEscolher={(v) => set({ spools: v })} />
        </Field>
        <Slider id="spool" rotulo="Tempo de aceleração (lenta → máxima)" min={2} max={14} passo={0.5} valor={spec.spoolTime} formatar={(v) => `${fmt(v, 1)} s`} aoMudar={live('spoolTime')} />
        <Slider id="thrust" rotulo={prop ? 'Potência (empuxo equivalente)' : 'Empuxo máximo por motor'} min={5} max={520} passo={1} valor={spec.thrust} formatar={(v) => `${fmt(v)} kN`} aoMudar={live('thrust')} aoSoltar={() => c.updatePlate()} />
        <Slider id="n2Idle" rotulo="Marcha lenta (N2)" min={0.45} max={0.8} passo={0.01} valor={spec.n2Idle} formatar={(v) => `${fmt(v * 100)} %`} aoMudar={live('n2Idle')} />
        {!prop && <Slider id="n1Idle" rotulo="Marcha lenta (N1)" min={0.12} max={0.6} passo={0.01} valor={spec.n1Idle} formatar={(v) => `${fmt(v * 100)} %`} aoMudar={live('n1Idle')} />}
      </Section>

      {/* onde os motores ficam e o formato, que muda o estrondo sônico */}
      <Section titulo="Aeronave">
        <Field rotulo="Motores montados">
          <ChipGroup id="mount" opcoes={[
            { valor: 'wing', rotulo: 'Sob a asa' }, { valor: 'rear', rotulo: 'Na cauda' },
            { valor: 'fuselage', rotulo: 'Na fuselagem' }, { valor: 'nose', rotulo: 'No nariz', desabilitado: spec.engines > 1 },
          ]} atual={spec.mount} aoEscolher={(v) => set({ mount: v }, true)} />
        </Field>
        {spec.engines > 1 && <Slider id="span" rotulo="Distância do motor externo ao centro" min={0.5} max={25} passo={0.1} valor={spec.span} formatar={(v) => `${fmt(v, 1)} m`} aoSoltar={(v) => set({ span: v }, true)} />}
        <Slider id="cockpitX" rotulo="Cockpit à frente dos motores" min={-5} max={40} passo={0.5} valor={spec.cockpitX} formatar={(v) => `${fmt(v, 1)} m`} aoMudar={live('cockpitX')} />
        <Slider id="length" rotulo="Comprimento" min={8} max={80} passo={1} valor={spec.length} formatar={(v) => `${fmt(v)} m`} aoMudar={live('length')} />
        <Slider id="shape" rotulo="Formato (para o estrondo sônico)" min={0.05} max={0.15} passo={0.005} valor={spec.shape}
          formatar={(v) => (v < 0.075 ? 'muito afilado' : v < 0.095 ? 'afilado' : v < 0.12 ? 'normal' : 'rombudo')} aoMudar={live('shape')} />
      </Section>

      {prop && (
        <Section titulo="Hélice">
          <Field rotulo="Pás">
            <ChipGroup id="propB" classe="num" opcoes={[2, 3, 4, 5, 6, 8].map(num)} atual={spec.propB} aoEscolher={(v) => set({ propB: v })} />
          </Field>
          <Slider id="propD" rotulo="Diâmetro" min={1.5} max={5} passo={0.05} valor={spec.propD} formatar={(v) => `${fmt(v, 2)} m`} aoMudar={live('propD')} aoSoltar={() => c.renderControls()} />
          <Slider id="propRpm" rotulo="Rotação da hélice" min={800} max={2700} passo={10} valor={spec.propRpm} formatar={(v) => `${fmt(v)} rpm`} aoMudar={live('propRpm')} aoSoltar={() => c.renderControls()} />
          <p className={Mh > 0.9 ? 'note warn' : 'note'}>{`Ponta da pá a Mach ${fmt(Mh, 2)} parado. Passagem de pá: ${fmt((spec.propB * spec.propRpm) / 60)} Hz. ${Mh > 0.85 ? 'Perto do som: o ronco vira um rasgado cheio de harmônicos.' : 'Quanto mais perto de Mach 1, mais harmônicos e mais alto.'}`}</p>
        </Section>
      )}

      <Section titulo={fanName}>
        {!prop && <>
          <Slider id="fanB" rotulo={jet ? 'Pás do 1º estágio' : 'Pás do fan'} min={10} max={60} passo={1} valor={spec.fanB} formatar={String} aoSoltar={(v) => set({ fanB: v }, true)} />
          <Slider id="vanes" rotulo="Palhetas guia (estator)" min={10} max={120} passo={1} valor={spec.vanes} formatar={String} aoMudar={live('vanes')} aoSoltar={() => c.renderControls()} />
          <Slider id="fanD" rotulo="Diâmetro" min={0.3} max={3.5} passo={0.01} valor={spec.fanD} formatar={(v) => `${fmt(v, 2)} m`} aoMudar={live('fanD')} aoSoltar={() => c.renderControls()} />
          <Slider id="n1Max" rotulo="Rotação máxima (N1)" min={1500} max={16000} passo={10} valor={spec.n1Max} formatar={(v) => `${fmt(v)} rpm`} aoMudar={live('n1Max')} aoSoltar={() => c.renderControls()} />
          {spec.arch === 'geared' && <Slider id="gear" rotulo="Redução turbina → fan" min={1.5} max={4} passo={0.01} valor={spec.gear} formatar={(v) => `${fmt(v, 2)} : 1`} aoMudar={live('gear')} />}
          <p className={f.Mt > 1 ? 'note warn' : 'note'}>{`A 100%: ponta a Mach ${fmt(f.Mt, 2)}${f.Mt > 1 ? ' (supersônica: choques nas pás e buzz-saw)' : ''}. BPF ${fmt(f.bpf)} Hz. ${f.cutSub ? `Com ${spec.vanes} palhetas para ${spec.fanB} pás o BPF fica preso no duto enquanto a ponta for subsônica.` : `Com ${spec.vanes} palhetas para ${spec.fanB} pás o BPF sai do duto em qualquer rotação.`}`}</p>
        </>}
        <Slider id="hpcB" rotulo="Pás do compressor de alta" min={12} max={80} passo={1} valor={spec.hpcB} formatar={String} aoMudar={live('hpcB')} />
        <Slider id="lptB" rotulo="Pás da turbina de baixa" min={20} max={140} passo={1} valor={spec.lptB} formatar={String} aoMudar={live('lptB')} />
        <Slider id="n2Max" rotulo="Rotação máxima (N2)" min={6000} max={45000} passo={100} valor={spec.n2Max} formatar={(v) => `${fmt(v)} rpm`} aoMudar={live('n2Max')} />
      </Section>

      <Section titulo="Jato">
        {(spec.arch === 'turbofan' || spec.arch === 'geared') &&
          <Slider id="bpr" rotulo="Razão de bypass" min={0.2} max={15} passo={0.1} valor={spec.bpr} formatar={(v) => `${fmt(v, 1)} : 1`} aoMudar={live('bpr')} />}
        <Slider id="jetV" rotulo="Velocidade do jato primário a 100%" min={80} max={1000} passo={5} valor={spec.jetV} formatar={(v) => `${fmt(v)} m/s`} aoMudar={live('jetV')} />
        <Slider id="nozD" rotulo="Diâmetro do bocal" min={0.2} max={1.8} passo={0.01} valor={spec.nozD} formatar={(v) => `${fmt(v, 2)} m`} aoMudar={live('nozD')} />
      </Section>

      <Section titulo="Acessórios">
        <Field rotulo="Pós-combustão">
          <ChipGroup id="ab" opcoes={[
            { valor: false, rotulo: 'Sem' }, { valor: true, rotulo: 'Com', desabilitado: prop, titulo: prop ? 'Turboélice não tem jato para reaquecer' : 'Libera a manete além de 100%' },
          ]} atual={!!spec.ab && !prop} aoEscolher={(v) => { c.setSpec({ ab: v }); if (!v && c.tla > 1) c.setTla(1); c.paintLever(); }} />
        </Field>
        <Field rotulo="Bocal">
          <ChipGroup id="nozzle" opcoes={[
            { valor: 'conv', rotulo: 'Convergente', titulo: 'Jato acima de Mach 1 sai com células de choque: chiado de choque e screech' },
            { valor: 'cd', rotulo: 'Convergente-divergente', titulo: 'Expande o jato supersônico sem choques no ponto de projeto' },
          ]} atual={spec.nozzle} aoEscolher={(v) => set({ nozzle: v })} />
        </Field>
        <Field rotulo="Redutor de ruído do jato">
          <ChipGroup id="suppressor" opcoes={[
            { valor: 'none', rotulo: 'Nenhum' },
            { valor: 'chevrons', rotulo: 'Chevrons', titulo: 'Borda serrilhada: mistura mais rápido, menos ronco grave' },
            { valor: 'hushkit', rotulo: 'Hush kit', titulo: 'Misturador e ejetor: corta bastante o ronco do jato' },
          ]} atual={spec.suppressor} aoEscolher={(v) => set({ suppressor: v })} />
        </Field>
        <Field rotulo="Revestimento acústico">
          <ChipGroup id="liners" opcoes={[
            { valor: false, rotulo: 'Sem' }, { valor: true, rotulo: 'Com', titulo: 'Painéis de colmeia na nacele absorvem os tons do fan e do compressor' },
          ]} atual={!!spec.liners} aoEscolher={(v) => set({ liners: v })} />
        </Field>
        {spec.engines > 1 && (
          <Field rotulo="Sincronizador">
            <ChipGroup id="sync" opcoes={[
              { valor: false, rotulo: 'Desligado', titulo: 'Cada motor gira um pouco diferente: os tons batem (uón-uón)' },
              { valor: true, rotulo: 'Ligado', titulo: 'Iguala as rotações e acaba com o batimento' },
            ]} atual={!!spec.sync} aoEscolher={(v) => set({ sync: v })} />
          </Field>
        )}
        <p className="note">{prop ? 'Reversor (R): a hélice inverte o passo e chicoteia o ar.' : 'Reversor (R): as cascatas jogam o jato para frente. Ruge bem mais alto na lateral e na frente.'}</p>
      </Section>

      <Section titulo="Escuta">
        <Field rotulo="Observador">
          <ChipGroup id="observer" opcoes={[{ valor: 'board', rotulo: 'A bordo' }, { valor: 'ground', rotulo: 'No solo' }]} atual={c.observer} aoEscolher={(v) => c.setObserver(v)} />
        </Field>
        {c.observer === 'board' ? <>
          <Field rotulo="Posição">
            <ChipGroup id="board" opcoes={[
              { valor: 'cabin', rotulo: 'Cabine de passageiros', desabilitado: spec.mount === 'fuselage' }, { valor: 'cockpit', rotulo: 'Cockpit' },
              { valor: 'wingcam', rotulo: spec.mount === 'wing' ? 'Câmera na asa' : 'Câmera externa' },
            ]} atual={c.board} aoEscolher={(v) => { c.board = v; c.setListener(); }} />
          </Field>
          {c.board === 'cabin' && (
            <Field rotulo="Assento">
              <ChipGroup id="seat" opcoes={[{ valor: 'fwd', rotulo: 'Dianteiro' }, { valor: 'wing', rotulo: 'Sobre a asa' }, { valor: 'aft', rotulo: 'Traseiro' }]}
                atual={params.seat} aoEscolher={(v) => { params.seat = v; c.sendParams(); c.renderControls(); }} />
            </Field>
          )}
        </> : <>
          <Field rotulo="Situação">
            <ChipGroup id="groundMode" opcoes={[{ valor: 'ground', rotulo: 'Ao redor do motor' }, { valor: 'flyby', rotulo: 'Passagem' }]}
              atual={c.groundMode} aoEscolher={(v) => { c.groundMode = v; c.setListener(); }} />
          </Field>
          {c.groundMode === 'ground' ? <SlidersDoSolo c={c} /> : <>
            <Slider id="alt" rotulo="Altura da passagem" min={20} max={1500} passo={5} valor={params.alt} formatar={(v) => `${fmt(v)} m`} aoMudar={(v) => c.setParam({ alt: v })} />
            <Slider id="speed" rotulo="Velocidade" min={150} max={2500} passo={10} valor={params.speed} formatar={(v) => `${fmt(v)} km/h · Mach ${fmt(v / 3.6 / 340, 2)}`} aoMudar={(v) => c.setParam({ speed: v })} />
          </>}
          <Mapa c={c} refs={refs} />
          <p className="note" id="obsNote" ref={refs.nota} />
        </>}
        <Field rotulo="Ambiente">
          <ChipGroup id="env" opcoes={Object.entries(AMBIENTES_TURBINA).map(([k, v]) => ({ valor: k, rotulo: v.name }))} atual={c.environment}
            aoEscolher={(v) => { c.setEnvironment(v); c.renderControls(); }} />
        </Field>
        <Slider id="mxFan" rotulo={prop ? 'Hélice e fan' : 'Fan'} min={0} max={2} passo={0.01} valor={params.fan} formatar={pct} aoMudar={(v) => c.setParam({ fan: v })} />
        <Slider id="mxCore" rotulo="Núcleo (compressor, turbina, combustão)" min={0} max={2} passo={0.01} valor={params.core} formatar={pct} aoMudar={(v) => c.setParam({ core: v })} />
        <Slider id="mxJet" rotulo="Jato" min={0} max={2} passo={0.01} valor={params.jet} formatar={pct} aoMudar={(v) => c.setParam({ jet: v })} />
        <Slider id="mxVol" rotulo="Volume" min={0} max={1.5} passo={0.01} valor={params.master} formatar={pct} aoMudar={(v) => c.setParam({ master: v })} />
      </Section>
    </>
  );
}

// Ângulo e distância: arrastar no mapa move estes dois sliders (tópico "mapa"; o legado
// disparava `input` neles), sem montar o resto do painel de novo.
function SlidersDoSolo({ c }: { c: ControleTurbina }) {
  const v = useTopico(c, 'mapa');
  return (
    <Fragment key={v}>
      <Slider id="angle" rotulo="Ângulo (0° = de frente para a entrada)" min={0} max={180} passo={1} valor={c.params.angle} formatar={(x) => `${x}°`} aoMudar={(x) => c.setParam({ angle: x })} />
      <Slider id="dist" rotulo="Distância" min={5} max={300} passo={1} valor={c.params.dist} formatar={(x) => `${x} m`} aoMudar={(x) => c.setParam({ dist: x })} />
    </Fragment>
  );
}

function Mapa({ c, refs }: { c: ControleTurbina; refs: RefsDoMapa }) {
  const solo = c.groundMode === 'ground';
  const pick = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = pickMap(c, e.currentTarget, e);
    c.setParam(p);
    c.avisar('mapa');
  };
  return (
    <canvas id="obsMap" ref={refs.mapa} className={`obs-map${solo ? ' drag' : ''}`}
      aria-label={solo ? 'Mapa: arraste para mudar onde você está' : 'Vista lateral da passagem'}
      onPointerDown={solo ? (e) => { e.currentTarget.setPointerCapture(e.pointerId); pick(e); } : undefined}
      onPointerMove={solo ? (e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) pick(e); } : undefined} />
  );
}
