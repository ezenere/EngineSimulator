// Painel de controles do Vapor (VAPOR.md 6): o ajuste fino da máquina (regulador e reversão em números, abertura do
// apito, freio aplicado que fica, torneiras, simplificação; a condução de verdade está no palco, Conducao.tsx), escuta
// e ambiente, caldeira e auxiliares (fogo, injetor, bomba de ar, soprador), composição e via (vagões, massa, rampa,
// trilho), escape (os campos da ficha: coletor, cauda do chuff, tiragem, desajuste das válvulas). A marcha do trator e
// a carga da estacionária estão no palco, com a condução. Só re-renderiza quando o estado muda.
import { useSyncExternalStore } from 'react';
import { ChipGroup, Field, Section, Slider } from '../../ui';
import { AMBIENTES_VAPOR, corteDeRev, fmt, temChamine, temFreio, temPares, temTorneiras, type ControleVapor, type EstadoVapor } from './controle';

const pct = (v: number) => `${Math.round(v * 100)}%`;
type P = { k: ControleVapor; e: EstadoVapor };
type Auto = boolean | 'auto';
const OP_AUTO = (lig: string, desl: string) => [{ valor: 'auto' as Auto, rotulo: 'Auto' }, { valor: true as Auto, rotulo: lig }, { valor: false as Auto, rotulo: desl }];

export function Painel({ k }: { k: ControleVapor }) {
  const e = useSyncExternalStore(k.assinar, k.obter);
  const t = k.portador;
  return (
    <>
      {/* o ajuste fino da condução (a condução mesmo está no palco); depois a escuta, como nas outras páginas */}
      {t !== 'gerador' && <Maquina k={k} e={e} />}
      <Escuta k={k} e={e} />
      <Caldeira k={k} e={e} />
      {t !== 'gerador' && t !== 'barco' && <Composicao k={k} e={e} />}
      {temChamine(k.P) && <Escape k={k} e={e} />}
    </>
  );
}

function Maquina({ k, e }: P) {
  const c = e.cmd, P = k.P;
  return (
    <Section titulo="Máquina: ajuste fino">
      <Slider id="regulador" rotulo="Regulador (a alavanca do palco)" min={0} max={1} passo={0.01} valor={c.regulador} formatar={pct} aoMudar={(v) => k.moverRegulador(v)} />
      {/* (com o corte automático a reversão anda sozinha: o controle mostra "automático" e, mexido, passa a reversão para a mão) */}
      <Slider id="reverser" rotulo={e.corteAuto ? 'Reversão (mexer aqui desliga o corte automático)' : 'Reversão à mão e corte (15 a 85%)'} min={-1} max={1} passo={0.01}
        valor={e.corteAuto ? Math.round(k.reversaoEfetiva() * 100) / 100 : c.reverser}
        formatar={(v) => (e.corteAuto ? 'automático' : Math.abs(v) < 0.005 ? 'meio (0)' : `${v > 0 ? 'frente' : 'ré'} · corte ${Math.round(corteDeRev(v) * 100)}%`)} aoMudar={(v) => k.moverReversao(v)} />
      <Slider id="apitoAbertura" rotulo="Abertura do apito (abaixo de 15%: só chia)" min={0.05} max={1} passo={0.01} valor={c.apitoAbertura} formatar={pct} aoMudar={(v) => k.setCmd({ apitoAbertura: v })} />
      {temFreio(k.portador) && (
        <Slider id="freio" rotulo="Freio aplicado (fica onde você deixa)" min={0} max={1} passo={0.01} valor={c.freio} formatar={pct} aoMudar={(v) => k.setFreioFixo(v)} />
      )}
      {temTorneiras(P) && (
        <Field rotulo="Torneiras de purga dos cilindros">
          <ChipGroup id="torneiras" opcoes={OP_AUTO('Abertas', 'Fechadas')} atual={c.torneiras} aoEscolher={(v) => k.setCmd({ torneiras: v }, true)} />
        </Field>
      )}
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
      <Field rotulo="Injetor de água"><ChipGroup id="injetor" opcoes={OP_AUTO('Ligado', 'Desligado')} atual={c.injetor} aoEscolher={(v) => k.setCmd({ injetor: v }, true)} /></Field>
      {k.P.bombaAr && <Field rotulo="Bomba de ar"><ChipGroup id="bombaAr" opcoes={OP_AUTO('Forçar', 'Desligada')} atual={c.bombaAr} aoEscolher={(v) => k.setCmd({ bombaAr: v }, true)} /></Field>}
      {k.P.ejetor && <Field rotulo="Ejetor de vácuo (freio a vácuo)"><ChipGroup id="bombaAr" opcoes={OP_AUTO('Ligado', 'Desligado')} atual={c.bombaAr} aoEscolher={(v) => k.setCmd({ bombaAr: v }, true)} /></Field>}
      <Field rotulo="Soprador"><ChipGroup id="soprador" opcoes={OP_AUTO('Ligado', 'Desligado')} atual={c.soprador} aoEscolher={(v) => k.setCmd({ soprador: v }, true)} /></Field>
    </Section>
  );
}

function Composicao({ k, e }: P) {
  const t = k.portador;
  return (
    <Section titulo={t === 'locomotiva' ? 'Composição e via' : t === 'trator' ? 'Estrada' : 'Via'}>
      {t === 'locomotiva' && <>
        <Slider id="vagoes" rotulo="Vagões" min={0} max={20} passo={1} valor={e.vagoes} formatar={(v) => String(v)} aoSoltar={(v) => k.setVagoes(v)} />
        <Slider id="massaVagao" rotulo="Massa por vagão" min={10} max={100} passo={1} valor={e.massaVagao} formatar={(v) => `${v} t`} aoSoltar={(v) => k.setMassaVagao(v)} />
        <Field rotulo="Trilho">
          <ChipGroup id="trilho" opcoes={[{ valor: 'seco' as const, rotulo: 'Seco', titulo: 'Atrito 0,22' }, { valor: 'molhado' as const, rotulo: 'Molhado', titulo: 'Atrito 0,12: abrir demais faz as rodas patinarem (a areia resolve)' }]} atual={e.cmd.trilho} aoEscolher={(v) => k.setCmd({ trilho: v }, true)} />
        </Field>
      </>}
      <Slider id="rampa" rotulo="Rampa (parada na rampa com o regulador fechado, a página segura no freio)" min={-3} max={3} passo={0.05} valor={e.rampa} formatar={(v) => `${fmt(v, 2)}%`} aoMudar={(v) => k.setRampa(v)} />
    </Section>
  );
}

/** os campos do escape da ficha (aplicados ao soltar: o motor é remontado, como ao mudar os vagões) */
function Escape({ k, e }: P) {
  const x = e.escape;
  return (
    <Section titulo="Escape: o chuff">
      <Slider id="vColetor" rotulo="Coletor de escape (volume entre os cilindros e o bico)" min={0} max={1} passo={0.01} valor={x.vColetor} formatar={(v) => `${Math.round(v * 1000)} L`} aoSoltar={(v) => k.setEscape({ vColetor: v })} />
      <Slider id="tCauda" rotulo="Cauda do chuff: tempo de queda na caixa de fumaça" min={0.1} max={2} passo={0.05} valor={x.tCauda} formatar={(v) => `${fmt(v, 2)} s`} aoSoltar={(v) => k.setEscape({ tCauda: v })} />
      <Slider id="nivelCauda" rotulo="Cauda do chuff: nível (−60 desliga)" min={-60} max={6} passo={0.5} valor={x.nivelCauda} formatar={(v) => `${fmt(v, 1)} dB`} aoSoltar={(v) => k.setEscape({ nivelCauda: v })} />
      <Slider id="tiragem" rotulo="Tiragem (sopro do gás na chaminé)" min={0} max={8} passo={0.1} valor={x.tiragem} formatar={(v) => `${Math.round(v * 100)}%`} aoSoltar={(v) => k.setEscape({ tiragem: v })} />
      {temPares(k.P) && <Slider id="desajuste" rotulo="Válvulas de fora: atraso em relação às de dentro" min={0} max={12} passo={0.5} valor={x.desajuste} formatar={(v) => `${fmt(v, 1)}°`} aoSoltar={(v) => k.setEscape({ desajuste: v })} />}
    </Section>
  );
}

function Escuta({ k, e }: P) {
  const c = e.cmd;
  return (
    <Section titulo="Escuta e ambiente">
      <Field rotulo="Ambiente">
        <ChipGroup id="ambiente" opcoes={AMBIENTES_VAPOR.map((a) => ({ valor: a.id, rotulo: a.nome }))} atual={e.ambiente} aoEscolher={(v) => k.setAmbiente(v)} />
      </Field>
      <Slider id="distancia" rotulo="Distância do ouvinte (ao lado, andando junto)" min={2} max={80} passo={0.5} valor={e.distancia} formatar={(v) => `${fmt(v, 1)} m`} aoMudar={(v) => k.setDistancia(v)} />
      <Slider id="mixAr" rotulo="Ar (jato, chiado, torneiras)" min={0} max={2} passo={0.01} valor={c.mixAr} formatar={pct} aoMudar={(v) => k.setCmd({ mixAr: v })} />
      <Slider id="mixMec" rotulo="Mecânica (bielas, engrenagens)" min={0} max={2} passo={0.01} valor={c.mixMec} formatar={pct} aoMudar={(v) => k.setCmd({ mixMec: v })} />
      <Slider id="master" rotulo="Volume" min={0} max={2} passo={0.01} valor={e.master} formatar={pct} aoMudar={(v) => k.setMaster(v)} />
    </Section>
  );
}
