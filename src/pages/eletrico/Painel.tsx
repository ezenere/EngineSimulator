// Painel de controles do Elétrico (ELETRICO.md 6). Como nas outras páginas, o painel inteiro é montado de novo quando algo
// estrutural muda (tópico "painel"); acelerador e freio assinam também "estado" (o teclado mexe neles).
import { useLayoutEffect, useRef, useState } from 'react';
import { ChipGroup, Field, Section, Slider } from '../../ui';
import { CARGAS, fmt, useTopico, type ControleEletrico, type IdOuvinte, type ModoAvasPagina } from './controle';
import { AMBIENTES_ELETRICO } from './ambientes';
import type { ModoModulacao } from '../../engines/eletrico/inversor';

const NOME_MODO: Record<ModoModulacao, string> = { auto: 'Auto', assincrona: 'Assíncrona', escada: 'Escada', sincrona: 'Síncrona', aleatoria: 'Aleatória', chopper: 'Chopper' };
const TITULO_MODO: Record<ModoModulacao, string> = {
  auto: 'O do preset: assíncrona até f_c/f_e < N_max, depois a lista síncrona ("marchas")',
  assincrona: 'Portadora fixa: as bandas laterais abrem com a velocidade',
  escada: 'Portadora em degraus de f_e (o do-re-mi do Taurus), depois síncrona',
  sincrona: 'f_c = N·f_e, N caindo na lista: o tom sobe e cai na troca',
  aleatoria: 'Random PWM: as linhas viram bandas de ruído',
  chopper: 'Chopper de CC: ondulação ∝ D(1 − D), some em série plena',
};
const pct = (v: number) => `${fmt(v * 100)}%`;

export function Painel({ c }: { c: ControleEletrico }) {
  const versao = useTopico(c, 'painel');
  const aside = useRef<HTMLElement>(null);
  const scroll = useRef(0);
  scroll.current = aside.current?.scrollTop ?? scroll.current;
  useLayoutEffect(() => { if (aside.current) aside.current.scrollTop = scroll.current; }, [versao]);
  return (
    <aside className="controls" id="controls" aria-label="Parâmetros do motor elétrico" ref={aside}>
      <Conteudo key={versao} c={c} />
    </aside>
  );
}

function Comando({ c }: { c: ControleEletrico }) {
  useTopico(c, 'estado');
  const tp = c.tipoPortador;
  const rot = tp === 'bancada' ? 'Gatilho' : tp === 'drone' ? 'Coletivo (50% = pairado)' : 'Acelerador';
  return (
    <>
      <Slider id="acelerador" rotulo={rot} min={0} max={1} passo={0.01} valor={c.acel} formatar={pct} aoMudar={(v) => c.setAcel(v)} />
      {tp !== 'drone' && tp !== 'bancada' && <Slider id="freio" rotulo="Regeneração / freio" min={0} max={1} passo={0.01} valor={c.freio} formatar={pct} aoMudar={(v) => c.setFreio(v)} />}
    </>
  );
}

function Conteudo({ c }: { c: ControleEletrico }) {
  const p = c.base, tp = c.tipoPortador;
  const modos = c.modosPermitidos();
  const [aberto, setAberto] = useState(false);
  const pa = c.preset();
  return (
    <>
      <Section titulo="Comando">
        <Comando c={c} />
        {modos.length > 0 && (
          <Field rotulo="Modo de modulação">
            <ChipGroup id="modulacao" atual={c.modoAtual()} aoEscolher={(m) => c.setModulacao(m as ModoModulacao)}
              opcoes={modos.map((m) => ({ valor: m, rotulo: NOME_MODO[m], titulo: TITULO_MODO[m] }))} />
          </Field>
        )}
        {p.avas !== undefined && (
          <Field rotulo="AVAS (som de aviso)">
            <ChipGroup<ModoAvasPagina> id="avas" atual={c.avas} aoEscolher={(v) => c.setAvas(v)}
              opcoes={[{ valor: 'desligado', rotulo: 'Desligado' }, { valor: 'ue', rotulo: 'UE', titulo: 'R138: até 20 km/h e em ré' }, { valor: 'eua', rotulo: 'EUA', titulo: 'FMVSS 141: até 30 km/h' }]} />
          </Field>
        )}
        {tp === 'carro' && (
          <Field rotulo="Marcha">
            <ChipGroup id="re" atual={c.re} aoEscolher={(v) => c.setRe(v)} opcoes={[{ valor: false, rotulo: 'D' }, { valor: true, rotulo: 'Ré' }]} />
          </Field>
        )}
      </Section>

      <Section titulo="Carga e velocidade">
        {tp === 'bancada' ? (
          <Field rotulo={p.id === 'furadeira' ? 'Carga (furar)' : p.id === 'liquidificador' ? 'Carga (0 vazio, 100% gelo)' : 'Carga do ventilador'}>
            <ChipGroup id="carga" atual={c.cargaBancada} aoEscolher={(v) => c.setCargaBancada(v)} classe="num"
              opcoes={[0, 0.25, 0.5, 0.75, 1].map((v) => ({ valor: v, rotulo: `${v * 100}%` }))} />
          </Field>
        ) : tp !== 'drone' ? (
          <Field rotulo="Carga">
            <ChipGroup id="carga" atual={c.carga} aoEscolher={(v) => c.setCarga(v)} opcoes={CARGAS.map((x) => ({ valor: x.id, rotulo: x.nome, titulo: x.titulo }))} />
          </Field>
        ) : null}
        {tp !== 'bancada' && tp !== 'drone' && (
          <>
            <Slider id="velocidade" rotulo="Velocidade (dinamômetro)" min={0} max={c.vMax()} passo={1} valor={c.vKmh} formatar={(v) => `${fmt(v)} km/h`} aoMudar={(v) => c.setV(v)} />
            <Field rotulo="Impor a velocidade">
              <ChipGroup id="impor" atual={c.impor} aoEscolher={(v) => c.setImpor(v)} opcoes={[{ valor: false, rotulo: 'Livre', titulo: 'O motor acelera o veículo' }, { valor: true, rotulo: 'Impor', titulo: 'Trava ω = v·i/r_w: dinamômetro de rolo' }]} />
            </Field>
          </>
        )}
        {tp === 'carro' && (
          <Field rotulo="Pneus e vento">
            <ChipGroup id="pneus" atual={c.pneusAero} aoEscolher={(v) => c.setPneus(v)} opcoes={[{ valor: true, rotulo: 'Ligados' }, { valor: false, rotulo: 'Só o trem de força' }]} />
          </Field>
        )}
      </Section>

      <Section titulo="Ouvinte e ambiente">
        <Field rotulo="Ouvinte">
          <ChipGroup id="ouvinte" atual={c.ouvinte} aoEscolher={(v) => c.setOuvinte(v as IdOuvinte)} opcoes={[
            { valor: 'fora', rotulo: 'Fora, 7,5 m' },
            { valor: 'cabine', rotulo: 'Cabine', desabilitado: !c.temCabine() },
            { valor: 'cofre', rotulo: tp === 'trem' ? 'Sob o assoalho' : tp === 'carro' ? 'Cofre' : 'Junto ao motor' },
            { valor: 'gimbal', rotulo: 'Gimbal' },
          ]} />
        </Field>
        {c.ouvinte === 'gimbal' && (
          <>
            <Slider id="gAz" rotulo="Azimute" min={-180} max={180} passo={1} valor={c.gimbal.az} formatar={(v) => `${fmt(v)}°`} aoMudar={(v) => c.setGimbal({ az: v })} />
            <Slider id="gEl" rotulo="Elevação" min={-20} max={89} passo={1} valor={c.gimbal.el} formatar={(v) => `${fmt(v)}°`} aoMudar={(v) => c.setGimbal({ el: v })} />
            <Slider id="gR" rotulo="Distância" min={0.5} max={60} passo={0.5} valor={c.gimbal.r} formatar={(v) => `${fmt(v, 1)} m`} aoMudar={(v) => c.setGimbal({ r: v })} />
          </>
        )}
        <Field rotulo="Ambiente">
          <ChipGroup id="ambiente" atual={c.ambiente} aoEscolher={(v) => c.setAmbiente(v)} opcoes={AMBIENTES_ELETRICO.map((a) => ({ valor: a.id, rotulo: a.nome, titulo: a.nota }))} />
        </Field>
        <Slider id="master" rotulo="Volume" min={0.05} max={2} passo={0.01} valor={c.master} formatar={(v) => `${fmt(20 * Math.log10(v), 1)} dB`} aoMudar={(v) => c.setMaster(v)} />
      </Section>

      <section className="group avancado">
        <h2><button type="button" id="avancado" className="chip" aria-expanded={aberto} onClick={() => setAberto(!aberto)}>Avançado {aberto ? '▾' : '▸'}</button></h2>
        {aberto && (
          <>
            {pa.inversor && pa.inversor.tipo !== 'csi' && (
              <Slider id="avFc" rotulo="f_c (portadora)" min={100} max={20000} passo={10} valor={pa.inversor.fc} formatar={(v) => `${fmt(v)} Hz`} aoMudar={(v) => c.editarAvancado({ fc: v })} />
            )}
            {pa.inversor && pa.inversor.tipo !== 'csi' && pa.inversor.tipo !== 'chopper' && (
              <Slider id="avDelta" rotulo="δ (aleatória)" min={0.02} max={0.3} passo={0.01} valor={pa.inversor.delta ?? 0.1} formatar={(v) => `±${fmt(v * 100)}%`} aoMudar={(v) => c.editarAvancado({ delta: v })} />
            )}
            <Slider id="avZs" rotulo="Z_s (ranhuras do estator)" min={0} max={96} passo={1} valor={pa.Zs} aoMudar={(v) => c.editarAvancado({ Zs: v })} />
            {pa.reducao.estagios.length > 0 && (
              <Slider id="avZp" rotulo="Z_p (pinhão, 1º estágio)" min={5} max={60} passo={1} valor={pa.reducao.estagios[0].Zp} aoMudar={(v) => c.editarAvancado({ Zp: v })} />
            )}
            <Slider id="avExc" rotulo="Excentricidade" min={0} max={1} passo={0.05} valor={pa.excentricidade ?? 0.2} formatar={(v) => fmt(v, 2)} aoMudar={(v) => c.editarAvancado({ excentricidade: v })} />
            {pa.escovas && <Slider id="avDesg" rotulo="Desgaste das escovas" min={0} max={1} passo={0.05} valor={pa.escovas.desgaste} formatar={(v) => fmt(v, 2)} aoMudar={(v) => c.editarAvancado({ desgaste: v })} />}
            {pa.helice
              ? <Slider id="avDetune" rotulo="Detune dos rotores (× o medido)" min={0} max={2} passo={0.05} valor={c.avancado.detune ?? 1} formatar={(v) => `× ${fmt(v, 2)}`} aoMudar={(v) => c.editarAvancado({ detune: v })} />
              : (pa.nUnidades ?? 1) > 1 && <Slider id="avDetune" rotulo="Detune das unidades" min={0} max={0.02} passo={0.0005} valor={pa.detune ?? 0.003} formatar={(v) => `±${fmt(v * 100, 2)}%`} aoMudar={(v) => c.editarAvancado({ detune: v })} />}
            {pa.aprox?.length ? <p className="nota-aprox">Valores aproximados (≈) neste preset: {pa.aprox.join('; ')}.</p> : null}
          </>
        )}
      </section>
    </>
  );
}
