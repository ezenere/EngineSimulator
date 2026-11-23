// Pedaços do painel de controles comuns às páginas a pistão (Ronco, Diesel, Radial e Rotativos). Cada página monta as
// suas seções com eles e põe em volta o que é da família: os rótulos que mudam (o carro, o veículo, a hélice), as dicas
// de cada escolha, as faixas e as notas. Os controles chamam as ações de `ControlePistao` (src/pages/comum/controle.ts).
import { useSyncExternalStore } from 'react';
import { ChipGroup, Field, Slider, AMBIENTES_RONCO, dec, pct, type OpcaoChip } from '../../ui';
import type { ControlePistao, EstadoPistao, ParamsPistao } from './controle';

type K = ControlePistao<any, any, any>;
type EstadoK = EstadoPistao<any, any>;

/** número como o pt-BR escreve (ponto de milhar, até 3 casas): 12142 → "12.142" */
export const br = (v: number) => v.toLocaleString('pt-BR');
export const LIGADO: OpcaoChip<boolean>[] = [{ valor: true, rotulo: 'Ligado' }, { valor: false, rotulo: 'Desligado' }];
/** dB com sinal: +4,5 dB, 0 dB, -3 dB */
const dbComSinal = (v: number) => `${v > 0 ? '+' : ''}${br(v)} dB`;

// ---------------------------------------------------------------- escuta e ambiente
/** Observador: junto do motor ou parado na via (onde a página tem a via) */
export function Observador({ k, e, junto }: { k: K; e: EstadoK; junto: string }) {
  return (
    <Field rotulo="Observador">
      <ChipGroup id="observer" opcoes={[{ valor: 'car', rotulo: junto }, { valor: 'road', rotulo: 'Parado na via' }]} atual={e.observer} aoEscolher={(v) => k.setObserver(v as 'car' | 'road')} />
    </Field>
  );
}

/** Microfone junto do motor (C passa para o próximo): os nomes de "de fora" e "junto ao motor" são da família */
export function Microfone({ k, e, ext, bay }: { k: K; e: EstadoK; ext: string; bay: string }) {
  return (
    <Field rotulo="Microfone">
      <ChipGroup id="mic" opcoes={[
        { valor: 'pipe', rotulo: 'Ao lado do escape' }, { valor: 'ext', rotulo: ext },
        { valor: 'int', rotulo: 'Cabine' }, { valor: 'bay', rotulo: bay },
      ]} atual={e.carMic} aoEscolher={(v) => k.setCarMic(v)} />
    </Field>
  );
}

/** parado na via: a distância, a vista de cima (desenhada pelos mostradores) e a nota da passagem */
export function NaVia({ k, params, quem }: { k: K; params: ParamsPistao; quem: 'carro' | 'veículo' }) {
  return (
    <>
      <Slider id="roadDist" rotulo="Distância até a via" min={2} max={40} passo={0.5} valor={params.roadDist} formatar={(v) => `${br(v)} m`} aoMudar={(v) => k.setParams({ roadDist: v })} />
      <canvas id="passby" className="passby" aria-label={`Posição do ${quem} na via`} />
      <p className="note" id="passNote">{`Engate e acelere: o ${quem} anda pela via e passa por você a cada volta.`}</p>
    </>
  );
}

export function Ambiente({ k, params }: { k: K; params: ParamsPistao }) {
  return (
    <Field rotulo="Ambiente">
      <ChipGroup id="env" opcoes={Object.entries(AMBIENTES_RONCO).map(([kk, v]) => ({ valor: kk, rotulo: v.name }))} atual={params.env} aoEscolher={(v) => k.setEnvironment(v)} />
    </Field>
  );
}

/** som de fundo do ambiente; `dicas`: o que cada escolha faz, [ligado, desligado] */
export function SomDeFundo({ k, params, dicas }: { k: K; params: ParamsPistao; dicas?: [string, string] }) {
  return (
    <Field rotulo="Som de fundo do ambiente">
      <ChipGroup id="ambSound" opcoes={[{ valor: true, rotulo: 'Ligado', titulo: dicas?.[0] }, { valor: false, rotulo: 'Desligado', titulo: dicas?.[1] }]}
        atual={params.ambSound} aoEscolher={(v) => k.setParams({ ambSound: v }, true)} />
    </Field>
  );
}

/** volume do motor real ou arcade; `dicas`: [real, arcade]; `notaArcade`: a nota que aparece no arcade */
export function VolumeDoMotor({ k, params, dicas, notaArcade }: { k: K; params: ParamsPistao; dicas?: [string, string]; notaArcade?: string }) {
  return (
    <>
      <Field rotulo="Volume do motor">
        <ChipGroup id="dynamics" opcoes={[{ valor: 'real', rotulo: 'Real', titulo: dicas?.[0] }, { valor: 'arcade', rotulo: 'Arcade', titulo: dicas?.[1] }]}
          atual={params.dynamics} aoEscolher={(v) => k.setParams({ dynamics: v as 'real' | 'arcade' }, true)} />
      </Field>
      {notaArcade && params.dynamics === 'arcade' && <p className="note">{notaArcade}</p>}
    </>
  );
}

/** a mistura das fontes: escape, admissão, mecânica (o nome diz o que ela é na família), ar e volume */
export function Mixagem({ k, params, mecanica = 'Mecânica' }: { k: K; params: ParamsPistao; mecanica?: string }) {
  const mix = (id: string, rotulo: string, chave: 'exhaust' | 'intake' | 'mech' | 'air' | 'master', max = 2) => (
    <Slider id={id} rotulo={rotulo} min={0} max={max} passo={0.01} valor={params[chave]} formatar={pct} aoMudar={(v) => k.setParams({ [chave]: v })} />
  );
  return (
    <>
      {mix('mxEx', 'Escape', 'exhaust')}
      {mix('mxIn', 'Admissão', 'intake')}
      {mix('mxMech', mecanica, 'mech')}
      {mix('mxAir', 'Ar (jato, chiado)', 'air')}
      {mix('mxVol', 'Volume', 'master', 1.5)}
    </>
  );
}

/** equalização da saída: grave e agudo; o médio onde a página tem (`medio`, o rótulo); `zerar`, o botão que zera */
export function Equalizacao({ k, eq, medio, zerar }: { k: K; eq: EstadoK['eq']; medio?: string; zerar?: boolean }) {
  const tom = (id: string, rotulo: string, chave: 'lo' | 'mid' | 'hi') => (
    <Slider id={id} rotulo={rotulo} min={-12} max={12} passo={0.5} valor={eq[chave]} formatar={dbComSinal} aoMudar={(v) => k.setEq({ [chave]: v })} />
  );
  return (
    <>
      {zerar && (
        <Field rotulo="Equalização">
          <div className="chips" role="group" aria-label="Equalização"><button type="button" className="chip" onClick={() => k.setEq({ lo: 0, mid: 0, hi: 0 }, true)}>Zerar</button></div>
        </Field>
      )}
      {tom('eqLo', 'Grave (abaixo de 160 Hz)', 'lo')}
      {medio && tom('eqMid', medio, 'mid')}
      {tom('eqHi', 'Agudo (acima de 3,5 kHz)', 'hi')}
    </>
  );
}

// ---------------------------------------------------------------- temperatura
/** a água (ou a cabeça dos cilindros) acompanha a telemetria: só re-renderiza este controle, e só quando o grau muda.
 *  Os mostradores escrevem `k.lento.agua` a partir de `tele.coolant`, menos enquanto o usuário mexe no controle. */
export function AguaDoMotor({ k, rotulo = 'Água do motor', min = -10, max = 120 }: { k: K; rotulo?: string; min?: number; max?: number }) {
  const { agua } = useSyncExternalStore(k.assinarLento, k.obterLento);
  return <Slider id="coolant" rotulo={rotulo} min={min} max={max} passo={1} valor={agua} formatar={(v) => `${v} °C`} aoMudar={(v) => k.setCoolant(v)} />;
}

const PRONTAS: [number, string][] = [[20, 'Partida a frio (20 °C)'], [90, 'Motor quente (90 °C)']];
/** botões de temperatura pronta (valor, rótulo) */
export function TemperaturasProntas({ k, valores = PRONTAS }: { k: K; valores?: [number, string][] }) {
  return (
    <div className="chips" role="group" aria-label="Temperaturas prontas">
      {valores.map(([v, rotulo]) => <button key={v} type="button" className="chip" onClick={() => k.setCoolant(v)}>{rotulo}</button>)}
    </div>
  );
}

// ---------------------------------------------------------------- transmissão
/** uma relação por marcha (número maior = marcha mais curta), com a velocidade no corte; `max`, a mais curta possível */
export function RelacoesDasMarchas({ k, max, vmax }: { k: K; max: number; vmax: (r: number) => number }) {
  const nt = { structural: false, render: false };
  return (
    <>
      {k.currentRatios().map((r, i) => (
        <Slider key={`ratio${i + 1}`} id={`ratio${i + 1}`} rotulo={`${i + 1}ª marcha`} min={0.4} max={max} passo={0.01} valor={r} formatar={(v) => `${dec(v, 2)} : 1 · ${vmax(v)} km/h`}
          aoMudar={(v) => { const next = k.currentRatios(); next[i] = v; k.setSpec({ ratios: next }, nt); }} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------- corte de giro
/** a faixa do controle "Faixa do corte" em cada tipo de corte, em rpm */
export const FAIXA_DO_CORTE: Record<string, [number, number]> = { ign: [50, 800], fuel: [50, 800], partial: [40, 400], throttle: [250, 800] };
/** a especificação ao escolher o tipo de corte: a faixa e o tempo mínimo de cada corte voltam aos de cada tipo */
export const trocaDoCorte = (v: string, faixa: number) => ({
  limiter: v, limiterBand: ({ ign: 70, fuel: 70, partial: 110, throttle: 300 } as Record<string, number>)[v] ?? faixa, limiterHold: v === 'ign' || v === 'fuel' ? 0.07 : 0,
});
