// Painel de controles do Vapor (VAPOR.md 6): máquina (regulador, reverser, apito, sino, areia, freio, torneiras),
// caldeira e auxiliares (fogo, injetor, bomba de ar, soprador, simplificação), composição e via (vagões, massa, rampa,
// trilho; marcha do trator; carga da estacionária), ouvinte e ambiente, mixagem. Só re-renderiza quando o estado muda.
import { useSyncExternalStore, type PointerEvent } from 'react';
import { ChipGroup, Field, Section, Slider } from '../../ui';
import { AMBIENTES_VAPOR, fmt, type ControleVapor, type EstadoVapor } from './controle';

const pct = (v: number) => `${Math.round(v * 100)}%`;
type P = { k: ControleVapor; e: EstadoVapor };
type Auto = boolean | 'auto';
const OP_AUTO = (lig: string, desl: string) => [{ valor: 'auto' as Auto, rotulo: 'Auto' }, { valor: true as Auto, rotulo: lig }, { valor: false as Auto, rotulo: desl }];

export function Painel({ k }: { k: ControleVapor }) {
  const e = useSyncExternalStore(k.assinar, k.obter);
  return (
    <>
      <Maquina k={k} e={e} />
      <Caldeira k={k} e={e} />
      <Composicao k={k} e={e} />
      <Escuta k={k} e={e} />
    </>
  );
}

/** botão segurável (mouse e toque): aperta ao descer, solta ao subir ou sair */
function Seguravel({ id, rotulo, ativo, aoMudar }: { id: string; rotulo: string; ativo: boolean; aoMudar: (on: boolean) => void }) {
  const solta = () => aoMudar(false);
  return (
    <button type="button" id={id} className="key wide" aria-pressed={ativo}
      onPointerDown={(ev: PointerEvent<HTMLButtonElement>) => { ev.currentTarget.setPointerCapture(ev.pointerId); aoMudar(true); }}
      onPointerUp={solta} onPointerCancel={solta} onLostPointerCapture={solta}>{rotulo}</button>
  );
}

function Maquina({ k, e }: P) {
  const c = e.cmd, P = k.P;
  const corte = 0.15 + 0.7 * Math.abs(c.reverser);
  return (
    <Section titulo="Máquina">
      <Slider id="regulador" rotulo="Regulador (W/S, X fecha)" min={0} max={1} passo={0.01} valor={c.regulador} formatar={pct} aoMudar={(v) => k.setCmd({ regulador: v })} />
      <Slider id="reverser" rotulo="Reverser (A/D) · corte 15–85%" min={-1} max={1} passo={0.01} valor={c.reverser}
        formatar={(v) => (Math.abs(v) < 0.005 ? 'meio (0)' : `${v > 0 ? 'frente' : 'ré'} · corte ${Math.round(corte * 100)}%`)} aoMudar={(v) => k.setCmd({ reverser: v })} />
      <div className="acoes">
        <Seguravel id="botaoApito" rotulo="Apito (H)" ativo={e.apitando} aoMudar={(on) => { void k.ligar(); k.apitar(on); }} />
        <button type="button" id="botaoSino" className="key wide" aria-pressed={c.sino} disabled={!P.sino} onClick={() => k.alternarSino()} title={P.sino ? '' : 'Esta máquina não tem sino'}>Sino (B)</button>
        <Seguravel id="botaoAreia" rotulo="Areia (E)" ativo={c.areia} aoMudar={(on) => k.areia(on)} />
        <Seguravel id="botaoFreio" rotulo="Freio (espaço)" ativo={e.freando} aoMudar={(on) => k.frear(on)} />
      </div>
      <Slider id="apitoAbertura" rotulo="Abertura do apito (abaixo de 15%: só chia)" min={0.05} max={1} passo={0.01} valor={c.apitoAbertura} formatar={pct} aoMudar={(v) => k.setCmd({ apitoAbertura: v })} />
      <Slider id="freio" rotulo="Freio" min={0} max={1} passo={0.01} valor={c.freio} formatar={pct} aoMudar={(v) => k.setCmd({ freio: v })} />
      <Field rotulo="Torneiras dos cilindros (T)">
        <ChipGroup id="torneiras" opcoes={OP_AUTO('Abertas', 'Fechadas')} atual={c.torneiras} aoEscolher={(v) => k.setCmd({ torneiras: v }, true)} />
      </Field>
      {P.compound && (
        <Field rotulo="Válvula de simplificação (compound)">
          <ChipGroup id="simplificacao" opcoes={[{ valor: false, rotulo: 'Compound' }, { valor: true, rotulo: 'Simples (partida)' }]} atual={c.simplificacao} aoEscolher={(v) => k.setCmd({ simplificacao: v }, true)} />
        </Field>
      )}
    </Section>
  );
}

function Caldeira({ k, e }: P) {
  const c = e.cmd;
  return (
    <Section titulo="Caldeira e auxiliares">
      <Field rotulo="Fogo">
        <ChipGroup id="fogoModo" opcoes={[{ valor: true, rotulo: 'Foguista automático' }, { valor: false, rotulo: 'À mão' }]} atual={c.fogoAuto} aoEscolher={(v) => k.setCmd({ fogoAuto: v }, true)} />
      </Field>
      {!c.fogoAuto && <Slider id="fogo" rotulo="Taxa de fogo" min={0} max={1} passo={0.01} valor={c.fogo} formatar={pct} aoMudar={(v) => k.setCmd({ fogo: v })} />}
      <Field rotulo="Injetor (I)"><ChipGroup id="injetor" opcoes={OP_AUTO('Ligado', 'Desligado')} atual={c.injetor} aoEscolher={(v) => k.setCmd({ injetor: v }, true)} /></Field>
      {k.P.bombaAr && <Field rotulo="Bomba de ar"><ChipGroup id="bombaAr" opcoes={OP_AUTO('Forçar', 'Desligada')} atual={c.bombaAr} aoEscolher={(v) => k.setCmd({ bombaAr: v }, true)} /></Field>}
      <Field rotulo="Soprador"><ChipGroup id="soprador" opcoes={OP_AUTO('Ligado', 'Desligado')} atual={c.soprador} aoEscolher={(v) => k.setCmd({ soprador: v }, true)} /></Field>
    </Section>
  );
}

function Composicao({ k, e }: P) {
  const t = k.portador;
  return (
    <Section titulo={t === 'locomotiva' ? 'Composição e via' : t === 'gerador' ? 'Carga' : t === 'trator' ? 'Marcha e estrada' : 'Via'}>
      {t === 'locomotiva' && <>
        <Slider id="vagoes" rotulo="Vagões" min={0} max={20} passo={1} valor={e.vagoes} formatar={(v) => String(v)} aoSoltar={(v) => k.setVagoes(v)} />
        <Slider id="massaVagao" rotulo="Massa por vagão" min={10} max={100} passo={1} valor={e.massaVagao} formatar={(v) => `${v} t`} aoSoltar={(v) => k.setMassaVagao(v)} />
        <Field rotulo="Trilho">
          <ChipGroup id="trilho" opcoes={[{ valor: 'seco' as const, rotulo: 'Seco (μ 0,22)' }, { valor: 'molhado' as const, rotulo: 'Molhado (μ 0,12)' }]} atual={e.cmd.trilho} aoEscolher={(v) => k.setCmd({ trilho: v }, true)} />
        </Field>
      </>}
      {t === 'trator' && (
        <Field rotulo="Marcha">
          <ChipGroup id="marcha" classe="num" opcoes={[0, 1, 2].map((m) => ({ valor: m, rotulo: m === 0 ? 'N' : String(m), titulo: m === 0 ? 'embreagem solta: a manivela em lenta no governador' : '' }))} atual={e.marcha} aoEscolher={(v) => k.setMarcha(v)} />
        </Field>
      )}
      {t === 'gerador' && (
        <Field rotulo="Carga do eixo de transmissão">
          <ChipGroup id="carga" classe="num" opcoes={[0, 0.25, 0.5, 0.75, 1].map((f) => ({ valor: f, rotulo: pct(f) }))} atual={e.carga} aoEscolher={(v) => k.setCarga(v)} />
        </Field>
      )}
      {t !== 'gerador' && t !== 'barco' && <Slider id="rampa" rotulo="Rampa" min={-3} max={3} passo={0.05} valor={e.rampa} formatar={(v) => `${fmt(v, 2)}%`} aoMudar={(v) => k.setRampa(v)} />}
    </Section>
  );
}

function Escuta({ k, e }: P) {
  const c = e.cmd;
  return (
    <Section titulo="Ouvinte e mixagem">
      <Field rotulo="Ambiente">
        <ChipGroup id="ambiente" opcoes={AMBIENTES_VAPOR.map((a) => ({ valor: a.id, rotulo: a.nome }))} atual={e.ambiente} aoEscolher={(v) => k.setAmbiente(v)} />
      </Field>
      <Slider id="distancia" rotulo="Distância do ouvinte (de lado, acompanhando a máquina)" min={2} max={80} passo={0.5} valor={e.distancia} formatar={(v) => `${fmt(v, 1)} m`} aoMudar={(v) => k.setDistancia(v)} />
      <Slider id="mixAr" rotulo="Ar (jato, chiado, torneiras)" min={0} max={2} passo={0.01} valor={c.mixAr} formatar={pct} aoMudar={(v) => k.setCmd({ mixAr: v })} />
      <Slider id="mixMec" rotulo="Mecânica (bielas, engrenagens)" min={0} max={2} passo={0.01} valor={c.mixMec} formatar={pct} aoMudar={(v) => k.setCmd({ mixMec: v })} />
      <Slider id="master" rotulo="Master" min={0} max={2} passo={0.01} valor={e.master} formatar={pct} aoMudar={(v) => k.setMaster(v)} />
    </Section>
  );
}
