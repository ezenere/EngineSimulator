// Painel de controles do Radial (RADIAL.md 7.1): escuta e ambiente, motor (fileiras, cilindros, biela-mestra, ordem),
// características (inércia, potência, redução, hélice), magnetos e mistura (no lugar do corte de giro), partida, hélice
// ou rotor (portador), temperatura (cabeça dos cilindros), escapamento radial e superalimentador. Só re-renderiza quando
// o estado muda; as leituras da telemetria são escritas no DOM pelo laço dos mostradores.
import { useSyncExternalStore } from 'react';
import { ChipGroup, Field, Section, Slider, AMBIENTES_RONCO } from '../../ui';
import { MagnetosEMistura, PartidaAv, HeliceAv, RotorAv } from '../comum/Aviacao';
import type { ControleRadial, EstadoRadial } from './controle';

const br = (v: number) => v.toLocaleString('pt-BR');
const virgula = (v: number, c: number) => v.toFixed(c).replace('.', ',');
const pct = (v: number) => `${Math.round(v * 100)}%`;
type P = { k: ControleRadial; e: EstadoRadial };

export function Painel({ k }: { k: ControleRadial }) {
  const e = useSyncExternalStore(k.assinar, k.obter);
  const s = e.spec;
  const aviao = (s.portadores || []).includes('helice'), heli = (s.portadores || []).includes('rotor');
  return (
    <>
      <Escuta k={k} e={e} />
      {s.aproximacao && <p className="note">Aproximação: {s.aproximacao}.</p>}
      <Motor k={k} e={e} />
      <Caracteristicas k={k} e={e} />
      <MagnetosEMistura av={e.av} aoMudar={(p) => k.setAv(p)} duasVelocidades={!!s.superalimentador?.duasVelocidades} />
      <PartidaAv tipo={s.partida} av={e.av} aoMudar={(p) => k.setAv(p)} comPrime />
      {aviao && s.helice && <HeliceAv passoFixo={!!s.helice.passoFixo} av={e.av} aoMudar={(p) => k.setAv(p)} />}
      {heli && <RotorAv av={e.av} aoMudar={(p) => k.setAv(p)} />}
      <Temperatura k={k} e={e} />
      <Escapamento k={k} e={e} />
      <Superalimentador k={k} e={e} />
    </>
  );
}

function Escuta({ k, e }: P) {
  const { params, eq } = e;
  const mix = (id: string, rotulo: string, chave: 'exhaust' | 'intake' | 'mech' | 'air' | 'master', max = 2) => (
    <Slider id={id} rotulo={rotulo} min={0} max={max} passo={0.01} valor={params[chave]} formatar={pct} aoMudar={(v) => k.setParams({ [chave]: v })} />
  );
  return (
    <Section titulo="Escuta e ambiente">
      <Field rotulo="Microfone">
        <ChipGroup id="mic" opcoes={[
          { valor: 'pipe', rotulo: 'Junto à saída do escape' }, { valor: 'ext', rotulo: 'De fora (5 m do cubo)' },
          { valor: 'int', rotulo: 'Cabine' }, { valor: 'bay', rotulo: 'Na carenagem' },
        ]} atual={e.carMic} aoEscolher={(v) => k.setCarMic(v)} />
      </Field>
      <Field rotulo="Ambiente">
        <ChipGroup id="env" opcoes={Object.entries(AMBIENTES_RONCO).map(([kk, v]) => ({ valor: kk, rotulo: v.name }))} atual={params.env} aoEscolher={(v) => k.setEnvironment(v)} />
      </Field>
      <Field rotulo="Som de fundo do ambiente">
        <ChipGroup id="ambSound" opcoes={[{ valor: true, rotulo: 'Ligado' }, { valor: false, rotulo: 'Desligado' }]} atual={params.ambSound} aoEscolher={(v) => k.setParams({ ambSound: v }, true)} />
      </Field>
      <Field rotulo="Volume do motor">
        <ChipGroup id="dynamics" opcoes={[{ valor: 'real', rotulo: 'Real' }, { valor: 'arcade', rotulo: 'Arcade' }]} atual={params.dynamics} aoEscolher={(v) => k.setParams({ dynamics: v as 'real' | 'arcade' }, true)} />
      </Field>
      {mix('mxEx', 'Escape', 'exhaust')}
      {mix('mxIn', 'Admissão', 'intake')}
      {mix('mxMech', 'Mecânica (cilindros expostos)', 'mech')}
      {mix('mxAir', 'Ar (jato, chiado)', 'air')}
      {mix('mxVol', 'Volume', 'master', 1.5)}
      <Slider id="eqLo" rotulo="Grave (abaixo de 160 Hz)" min={-12} max={12} passo={0.5} valor={eq.lo} formatar={(v) => `${v > 0 ? '+' : ''}${br(v)} dB`} aoMudar={(v) => k.setEq({ lo: v })} />
      <Slider id="eqHi" rotulo="Agudo (acima de 3,5 kHz)" min={-12} max={12} passo={0.5} valor={eq.hi} formatar={(v) => `${v > 0 ? '+' : ''}${br(v)} dB`} aoMudar={(v) => k.setEq({ hi: v })} />
    </Section>
  );
}

const ARRANJOS: [number, number, string][] = [[1, 3, '3'], [1, 5, '5'], [1, 7, '7'], [1, 9, '9'], [2, 7, '14 (2 × 7)'], [2, 9, '18 (2 × 9)'], [4, 7, '28 (4 × 7)']];

function Motor({ k, e }: P) {
  const s = e.spec, m = e.motor;
  const atual = ARRANJOS.find(([r, c]) => r === m.rows && c === m.cylPerRow);
  return (
    <Section titulo="Motor">
      <Field rotulo="Fileiras × cilindros">
        <ChipGroup id="arranjo" classe="num" opcoes={ARRANJOS.map(([r, c, t]) => ({ valor: `${r}x${c}`, rotulo: t }))} atual={atual ? `${atual[0]}x${atual[1]}` : ''}
          aoEscolher={(v) => { const [r, c] = v.split('x').map(Number); k.setArranjo(r, c); }} />
      </Field>
      <Field rotulo="Virabrequim">
        <ChipGroup id="crank" opcoes={[{ valor: m.crank.id, rotulo: m.crank.name }]} atual={m.crank.id} aoEscolher={() => {}} />
      </Field>
      <Slider id="Lr" rotulo="Biela-mestra (L/r)" min={3.2} max={4.4} passo={0.05} valor={s.Lr ?? 3.8} formatar={(v) => virgula(v, 2)} aoSoltar={(v) => k.setSpec({ Lr: v })} />
      <Slider id="rkr" rotulo="Pino das articuladas (r_k/r)" min={0.8} max={1.4} passo={0.05} valor={s.rkr ?? 1} formatar={(v) => virgula(v, 2)} aoSoltar={(v) => k.setSpec({ rkr: v })} />
      <Field rotulo="Ordem de ignição">
        <p className="note mono">{m.decorrente ? `${m.ordemTexto} (decorrente dos PMS: só leitura)` : m.ordemTexto}</p>
      </Field>
      <Slider id="disp" rotulo="Cilindrada" min={0.5} max={75} passo={0.1} valor={s.displacement} formatar={(v) => `${virgula(v, 1)} L`} aoSoltar={(v) => k.setSpec({ displacement: v })} />
      <Slider id="idle" rotulo="Lenta" min={350} max={1500} passo={10} valor={s.idle} formatar={(v) => `${br(v)} rpm`} aoSoltar={(v) => k.setSpec({ idle: v })} />
      <Slider id="rpmMax" rotulo="Rotação máxima" min={1800} max={6500} passo={50} valor={s.rpmMax} formatar={(v) => `${br(v)} rpm`} aoSoltar={(v) => k.setSpec({ rpmMax: v })} />
      <Slider id="cr" rotulo="Taxa de compressão" min={5} max={10} passo={0.05} valor={s.cr} formatar={(v) => `${virgula(v, 2)}:1`} aoSoltar={(v) => k.setSpec({ cr: v })} />
      <Slider id="cam" rotulo="Cruzamento de válvulas" min={0} max={0.3} passo={0.01} valor={s.cam ?? 0.15} formatar={(v) => virgula(v, 2)} aoSoltar={(v) => k.setSpec({ cam: v })} />
      <Field rotulo="Carburador">
        <ChipGroup id="carb" opcoes={[{ valor: 'pressao', rotulo: 'Pressão (Stromberg, Bendix)' }, { valor: 'boia', rotulo: 'Boia (galope)' }]} atual={s.carburador} aoEscolher={(v) => k.setSpec({ carburador: v as 'pressao' | 'boia' })} />
      </Field>
    </Section>
  );
}

function Caracteristicas({ k, e }: P) {
  const s = e.spec, h = s.helice;
  return (
    <Section titulo="Características">
      <Slider id="J" rotulo="Inércia do motor (sem hélice)" min={0.02} max={8} passo={0.01} valor={s.J} formatar={(v) => `${virgula(v, 2)} kg·m²`} aoSoltar={(v) => k.setSpec({ J: v })} />
      <Slider id="power" rotulo="Potência" min={8} max={2700} passo={1} valor={s.power} formatar={(v) => `${br(v)} kW · ${br(Math.round(v * 1.341))} hp`} aoSoltar={(v) => k.setSpec({ power: v })} />
      {h && <p className="note">Redução {s.reducao && s.reducao !== 1 ? `${virgula(1 / s.reducao, 3)}:1` : 'direta'} · hélice de {h.B} pás, {virgula(h.D, 2)} m, {br(h.J)} kg·m² · {h.passoFixo ? 'passo fixo' : 'passo variável'}</p>}
      {s.rotor && <p className="note">Rotor de {s.rotor.B} pás, {virgula(2 * s.rotor.R, 2)} m, Nr {br(s.rotor.Nr)} rpm · caixa {virgula(s.rotor.icx, 2)}:1</p>}
      {(s.portadores || []).includes('carro') && <p className="note">{s.gears} marchas · {(s.ratios || []).map((r: number) => virgula(r, 2)).join(' / ')} · {br(s.mass || 0)} kg</p>}
    </Section>
  );
}

function Temperatura({ k, e }: P) {
  return (
    <Section titulo="Temperatura do motor">
      <Field rotulo="Cabeça dos cilindros (CHT)">
        <ChipGroup id="tempMode" opcoes={[{ valor: 'real', rotulo: 'Real (começa fria)' }, { valor: 'fixed', rotulo: 'Fixa' }]} atual={e.tempMode} aoEscolher={(v) => k.setTempMode(v as 'real' | 'fixed')} />
      </Field>
      {e.tempMode === 'fixed' && <Slider id="coolant" rotulo="Temperatura" min={-10} max={230} passo={1} valor={90} formatar={(v) => `${v} °C`} aoMudar={(v) => k.setCoolant(v)} />}
      <p className="note">Motor frio: os cilindros de baixo têm óleo (encharque) e falham nos primeiros segundos, com estouros no escape; a lenta fica mais alta até esquentar.</p>
    </Section>
  );
}

function Escapamento({ k, e }: P) {
  const esc = e.spec.escape;
  return (
    <Section titulo="Escapamento">
      <Field rotulo="Tipo">
        <ChipGroup id="escTipo" opcoes={[
          { valor: 'anel', rotulo: 'Anel coletor' }, { valor: 'tubos', rotulo: 'Estaques' }, { valor: 'aranha', rotulo: 'Aranha' }, { valor: 'lados', rotulo: 'Dois lados' },
        ]} atual={esc.tipo} aoEscolher={(v) => k.setEscape({ tipo: v })} />
      </Field>
      {e.motor.rows > 1 && esc.tipo === 'anel' && (
        <Field rotulo="Fileiras">
          <ChipGroup id="escFil" opcoes={[{ valor: 'single', rotulo: 'Um sistema (coletor único)' }, { valor: 'dual', rotulo: 'Um por fileira' }]} atual={esc.porFileira || esc.juntar ? 'dual' : 'single'}
            aoEscolher={(v) => k.setEscape({ porFileira: v === 'dual' })} />
        </Field>
      )}
      {(esc.tipo === 'anel' || esc.tipo === 'lados') && (
        <>
          <Slider id="Danel" rotulo="Diâmetro do anel" min={0.5} max={1.6} passo={0.01} valor={esc.Danel ?? 1.1} formatar={(v) => `${virgula(v, 2)} m`} aoSoltar={(v) => k.setEscape({ Danel: v })} />
          <Slider id="Oanel" rotulo="Ø do tubo do anel" min={40} max={130} passo={1} valor={esc.Oanel ?? 80} formatar={(v) => `${v} mm`} aoSoltar={(v) => k.setEscape({ Oanel: v })} />
        </>
      )}
      {esc.tipo === 'tubos' && (
        <Slider id="Lt" rotulo="Comprimento dos estaques" min={0.2} max={1.0} passo={0.01} valor={Array.isArray(esc.Lt) ? esc.Lt[0] : esc.Lt ?? 0.6} formatar={(v) => `${virgula(v, 2)} m`} aoSoltar={(v) => k.setEscape({ Lt: v })} />
      )}
      {esc.turbina && <p className="note">Turbina na fuselagem: os anéis → {virgula(esc.turbina.Lantes, 1)} m → turbina → {virgula(esc.turbina.Ldepois, 1)} m.</p>}
      <Field rotulo="Vedação do anel (breakout)">
        <ChipGroup id="breakout" opcoes={[{ valor: 'sealed', rotulo: 'Soldado' }, { valor: 'old', rotulo: 'Juntas deslizantes' }, { valor: 'leaky', rotulo: 'Chapa fina, vazando' }]}
          atual={e.spec.breakout || 'old'} aoEscolher={(v) => k.setSpec({ breakout: v })} />
      </Field>
      <p className="note">Bocas (fontes do escape): {e.motor.grupos} · cilindros por grupo de escape: {e.motor.grupo.length / Math.max(1, e.motor.grupos)}</p>
    </Section>
  );
}

function Superalimentador({ k, e }: P) {
  const sa = e.spec.superalimentador;
  if (!sa) return <Section titulo="Superalimentador"><p className="note">Aspirado (sem impulsor).</p></Section>;
  const muda = (p: Partial<typeof sa>) => k.setSpec({ superalimentador: { ...sa, ...p } });
  return (
    <Section titulo="Superalimentador">
      <Slider id="scRel" rotulo="Relação do impulsor" min={4} max={12} passo={0.05} valor={sa.relacao} formatar={(v) => `${virgula(v, 2)}:1`} aoSoltar={(v) => muda({ relacao: v })} />
      <Slider id="scPas" rotulo="Pás do impulsor" min={6} max={24} passo={1} valor={sa.pas} formatar={(v) => String(v)} aoSoltar={(v) => muda({ pas: v })} />
      <Slider id="scBoost" rotulo="Pressão máxima" min={0} max={1} passo={0.01} valor={sa.boost} formatar={(v) => `${virgula(v, 2)} bar`} aoSoltar={(v) => muda({ boost: v })} />
      <Slider id="scUivo" rotulo="Uivo" min={-40} max={0} passo={1} valor={sa.uivoDb ?? -18} formatar={(v) => `${v} dB`} aoSoltar={(v) => muda({ uivoDb: v })} />
    </Section>
  );
}
