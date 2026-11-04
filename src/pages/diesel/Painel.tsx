// Painel de controles do Diesel (DIESEL.md 7). Igual ao do Ronco em "Escuta e ambiente", "Temperatura do motor" e
// "Transmissão" (mesmos nomes e ids); "Corte de giro" vira "Governador", "Estalos no escape" vira "Fumaça e frio",
// e entram "Carga" (do portador), freio-motor, turbo diesel e soprador Roots. O painel só re-renderiza quando o
// estado (especificação, parâmetros, carga) muda, nunca com a telemetria.
import { useSyncExternalStore } from 'react';
import { ChipGroup, Field, Section, Slider, AMBIENTES_RONCO, type OpcaoChip } from '../../ui';
import { LAYOUTS } from '../../engines/ronco/geometria';
import { defaultFinal } from '../../engines/ronco/dsp';
import { DRIVE_MODES, familyFor, type ControleDiesel, type EstadoDiesel } from './controle';

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const br = (v: number) => v.toLocaleString('pt-BR');
const virgula = (v: number, casas: number) => v.toFixed(casas).replace('.', ',');
const pct = (v: number) => `${Math.round(v * 100)}%`;
const LIGADO: OpcaoChip<boolean>[] = [{ valor: true, rotulo: 'Ligado' }, { valor: false, rotulo: 'Desligado' }];
const nt = { structural: false, render: false };

type P = { k: ControleDiesel; e: EstadoDiesel };

export function Painel({ k }: { k: ControleDiesel }) {
  const e = useSyncExternalStore(k.assinar, k.obter);
  return (
    <>
      <Escuta k={k} e={e} />
      <Carga k={k} e={e} />
      <Motor k={k} e={e} />
      <Caracteristicas k={k} e={e} />
      <Governador k={k} e={e} />
      <Temperatura k={k} e={e} />
      {e.portador === 'carro' && <Transmissao k={k} e={e} />}
      <Escapamento k={k} e={e} />
      <Acessorios k={k} e={e} />
      <FumacaEFrio k={k} e={e} />
      <Admissao k={k} e={e} />
    </>
  );
}

// ---- Escuta e ambiente (igual ao Ronco)
function Escuta({ k, e }: P) {
  const { params, eq } = e;
  const mix = (id: string, rotulo: string, chave: 'exhaust' | 'intake' | 'mech' | 'air' | 'master', max = 2) => (
    <Slider id={id} rotulo={rotulo} min={0} max={max} passo={0.01} valor={params[chave]} formatar={pct} aoMudar={(v) => k.setParams({ [chave]: v })} />
  );
  const tom = (id: string, rotulo: string, chave: 'lo' | 'mid' | 'hi') => (
    <Slider id={id} rotulo={rotulo} min={-12} max={12} passo={0.5} valor={eq[chave]} formatar={(v) => `${v > 0 ? '+' : ''}${br(v)} dB`} aoMudar={(v) => k.setEq({ [chave]: v })} />
  );
  return (
    <Section titulo="Escuta e ambiente">
      <Field rotulo="Observador">
        <ChipGroup id="observer" opcoes={[{ valor: 'car', rotulo: 'Junto com o veículo' }, { valor: 'road', rotulo: 'Parado na via' }]} atual={e.observer} aoEscolher={(v) => k.setObserver(v as 'car' | 'road')} />
      </Field>
      {e.observer === 'car' ? (
        <Field rotulo="Microfone">
          <ChipGroup id="mic" opcoes={[
            { valor: 'pipe', rotulo: 'Ao lado do escape' }, { valor: 'ext', rotulo: 'Câmera atrás' },
            { valor: 'int', rotulo: 'Cabine' }, { valor: 'bay', rotulo: 'Cofre' },
          ]} atual={e.carMic} aoEscolher={(v) => k.setCarMic(v)} />
        </Field>
      ) : (
        <>
          <Slider id="roadDist" rotulo="Distância até a via" min={2} max={40} passo={0.5} valor={params.roadDist} formatar={(v) => `${br(v)} m`} aoMudar={(v) => k.setParams({ roadDist: v })} />
          <canvas id="passby" className="passby" aria-label="Posição do veículo na via" />
          <p className="note" id="passNote">Engate e acelere: o veículo anda pela via e passa por você a cada volta.</p>
        </>
      )}
      <Field rotulo="Ambiente">
        <ChipGroup id="env" opcoes={Object.entries(AMBIENTES_RONCO).map(([kk, v]) => ({ valor: kk, rotulo: v.name }))} atual={params.env} aoEscolher={(v) => k.setEnvironment(v)} />
      </Field>
      <Field rotulo="Som de fundo do ambiente">
        <ChipGroup id="ambSound" opcoes={[
          { valor: true, rotulo: 'Ligado', titulo: 'Vento, trânsito ao longe, ventilação do túnel…' },
          { valor: false, rotulo: 'Desligado', titulo: 'Só o motor (a acústica do lugar continua)' },
        ]} atual={params.ambSound} aoEscolher={(v) => k.setParams({ ambSound: v }, true)} />
      </Field>
      <Field rotulo="Volume do motor">
        <ChipGroup id="dynamics" opcoes={[
          { valor: 'real', rotulo: 'Real', titulo: 'Nível de verdade: a lenta fica uns 20 dB abaixo da plena carga' },
          { valor: 'arcade', rotulo: 'Arcade', titulo: 'Segura o som num nível médio em qualquer rotação' },
        ]} atual={params.dynamics} aoEscolher={(v) => k.setParams({ dynamics: v as 'real' | 'arcade' }, true)} />
      </Field>
      {params.dynamics === 'arcade' && <p className="note">Arcade: a lenta e o giro baixo ganham volume até ficar perto da plena carga.</p>}
      {mix('mxEx', 'Escape', 'exhaust')}
      {mix('mxIn', 'Admissão', 'intake')}
      {mix('mxMech', 'Mecânica', 'mech')}
      {mix('mxAir', 'Ar (jato, chiado)', 'air')}
      {mix('mxVol', 'Volume', 'master', 1.5)}
      <Field rotulo="Equalização">
        <div className="chips"><button type="button" className="chip" onClick={() => k.setEq({ lo: 0, mid: 0, hi: 0 }, true)}>Zerar</button></div>
      </Field>
      {tom('eqLo', 'Grave (abaixo de 160 Hz)', 'lo')}
      {tom('eqMid', 'Médio (900 Hz)', 'mid')}
      {tom('eqHi', 'Agudo (acima de 3,5 kHz)', 'hi')}
    </Section>
  );
}

// ---- Carga (depende do portador)
const NOME_PORTADOR = { carro: 'Veículo (câmbio)', gerador: 'Gerador', locomotiva: 'Locomotiva', nenhum: 'Bancada (dinamômetro)' };
function Carga({ k, e }: P) {
  const { spec, carga: c } = e;
  return (
    <Section titulo="Carga">
      <Field rotulo="Portador">
        <ChipGroup id="portador" opcoes={(['carro', 'gerador', 'locomotiva', 'nenhum'] as const).filter((p) => spec.portadores.includes(p)).map((p) => ({ valor: p, rotulo: NOME_PORTADOR[p] }))}
          atual={e.portador} aoEscolher={(v) => k.setPortador(v)} />
      </Field>
      {e.portador === 'carro' && <p className="note">O pedal manda o combustível (teclas W/↑, barra do acelerador ou gamepad); o câmbio e o veículo são os do Ronco.</p>}
      {e.portador === 'locomotiva' && spec.locomotiva && (
        <>
          <Field rotulo="Notch (0–8, + e −)">
            <ChipGroup id="notch" classe="num" opcoes={Array.from({ length: 9 }, (_, n) => ({ valor: n, rotulo: n === 0 ? 'L' : String(n), titulo: `${spec.locomotiva!.notchRpm[n]} rpm` }))} atual={c.notch} aoEscolher={(n) => k.setNotch(n)} />
          </Field>
          <Field rotulo="Freio dinâmico">
            <ChipGroup id="dinamico" opcoes={LIGADO} atual={c.dinamico} aoEscolher={(v) => k.setCarga({ dinamico: v })} />
          </Field>
          {spec.locomotiva.lentaBaixa < spec.idle && (
            <Field rotulo="Lenta baixa">
              <ChipGroup id="lentaBaixa" opcoes={LIGADO} atual={c.lentaBaixa} aoEscolher={(v) => k.setCarga({ lentaBaixa: v })} />
            </Field>
          )}
          <p className="note">{`Notch ${c.notch}: ${spec.locomotiva.notchRpm[c.notch]} rpm. O regulador de carga sobe a excitação do gerador de tração depois do giro (1,5 s). Freio dinâmico: motor em N8 sem carga.`}</p>
        </>
      )}
      {e.portador === 'gerador' && spec.gerador && (
        <>
          <Field rotulo="Degrau de carga (0–4)">
            <ChipGroup id="degrau" classe="num" opcoes={[0, 0.25, 0.5, 0.75, 1].map((v) => ({ valor: v, rotulo: pct(v) }))} atual={c.degrau} aoEscolher={(v) => k.setDegrau(v)} />
          </Field>
          <Field rotulo="Frequência da rede">
            <ChipGroup id="fRede" opcoes={[{ valor: 50, rotulo: '50 Hz' }, { valor: 60, rotulo: '60 Hz' }]} atual={c.fRede} aoEscolher={(v) => k.setCarga({ fRede: v })} />
          </Field>
          <p className="note">{`${spec.gerador.kWe} kW elétricos, ${spec.gerador.polos} polos: ${(120 * c.fRede) / spec.gerador.polos} rpm fixos pelo governador isócrono.`}</p>
        </>
      )}
      {e.portador === 'nenhum' && (
        <>
          <Slider id="dinamometro" rotulo="Dinamômetro (torque de carga)" min={0} max={1} passo={0.01} valor={c.dinamometro} formatar={(v) => `${pct(v)} · ${Math.round(v * spec.torque)} N·m`} aoMudar={(v) => k.setCarga({ dinamometro: v }, false)} />
          <Slider id="rpmAlvo" rotulo="Rotação-alvo (governador isócrono)" min={0} max={spec.rpmMax} passo={10} valor={c.rpmAlvo} formatar={(v) => (v < spec.idle ? 'lenta' : `${br(v)} rpm`)} aoMudar={(v) => k.setCarga({ rpmAlvo: v }, false)} />
        </>
      )}
      {/* TODO(integração carriers/): com os portadores gerador e locomotiva da camada carriers/, a carga e o
          combustível vêm de lá (Motor.acoplar(Carga) e ComandoMotor.combustivel); aqui é o portador interno ("bancada") */}
    </Section>
  );
}

// ---- Motor
const INJECOES = [
  { valor: 'common-rail', rotulo: 'Common-rail' }, { valor: 'rotativa', rotulo: 'Bomba rotativa' }, { valor: 'em-linha', rotulo: 'Bomba em linha' },
  { valor: 'unitaria', rotulo: 'Injetor-bomba' }, { valor: 'heui', rotulo: 'HEUI' }, { valor: 'pld', rotulo: 'Bomba-tubo-bico' },
];
function Motor({ k, e }: P) {
  const { spec } = e;
  const fam = familyFor(spec.layout, spec.cylinders, spec.tempos);
  const crank = fam.find((x) => x.id === spec.crank) || fam[0];
  const tem2T = familyFor(spec.layout, spec.cylinders, 2).length > 0;
  return (
    <Section titulo="Motor">
      <Field rotulo="Ciclo">
        <ChipGroup id="tempos" opcoes={[{ valor: 4, rotulo: '4 tempos' }, { valor: 2, rotulo: '2 tempos', desabilitado: !tem2T, titulo: 'Só nos virabrequins de 2 tempos (EMD, Detroit)' }]} atual={spec.tempos} aoEscolher={(v) => k.setTempos(v as 2 | 4)} />
      </Field>
      <Field rotulo="Cilindros">
        <ChipGroup id="cyl" classe="num" opcoes={[3, 4, 5, 6, 8, 10, 12, 16].map((n) => ({ valor: n, rotulo: String(n), desabilitado: !familyFor('inline', n, spec.tempos).length && !familyFor('v', n, spec.tempos).length }))} atual={spec.cylinders} aoEscolher={(n) => k.pickCylinders(n)} />
      </Field>
      <Field rotulo="Configuração">
        <ChipGroup id="layout" opcoes={Object.entries(LAYOUTS).filter(([kk]) => kk !== 'boxer').map(([kk, v]) => ({ valor: kk, rotulo: v.name, desabilitado: !familyFor(kk, spec.cylinders, spec.tempos).length }))}
          atual={spec.layout} aoEscolher={(l) => k.applyFamily(l, spec.cylinders)} />
      </Field>
      {spec.layout === 'v' && (
        <Slider id="bank" rotulo="Ângulo entre bancadas" min={15} max={150} passo={0.5} valor={spec.bankAngle} formatar={(v) => `${v}°`}
          aoMudar={(v) => k.previewSpec({ bankAngle: v })} aoSoltar={(v) => k.setSpec({ bankAngle: v }, { render: false })} />
      )}
      <Field rotulo="Virabrequim">
        <ChipGroup id="crank" opcoes={fam.map((x) => ({ valor: x.id, rotulo: x.name }))} atual={crank?.id} aoEscolher={(id) => k.applyFamily(spec.layout, spec.cylinders, id)} />
      </Field>
      {spec.tempos === 4 ? (
        <Field rotulo="Ordem de ignição">
          <ChipGroup id="orders" classe="order" opcoes={(crank?.orders || []).map(([o, name]) => ({ valor: o, rotulo: name, sub: o }))} atual={spec.order} aoEscolher={(o) => k.setSpec({ order: o })} />
        </Field>
      ) : <p className="note">2 tempos uniflow: cada cilindro queima a cada volta, no próprio PMS; a ordem decorre dos moentes.</p>}
      {/* cilindrada em escala logarítmica, 0,5–3000 L */}
      <Slider id="disp" rotulo="Cilindrada" min={Math.log10(0.5)} max={Math.log10(3000)} passo={0.005} valor={Math.log10(spec.displacement)} formatar={(v) => { const L = Math.pow(10, v); return `${L < 20 ? virgula(L, 2) : br(Math.round(L))} L`; }}
        aoMudar={(v) => k.tuneSpec({ displacement: +Math.pow(10, v).toFixed(3) })} aoSoltar={(v) => k.setSpec({ displacement: +Math.pow(10, v).toFixed(3) }, { render: false })} />
      <Slider id="idle" rotulo="Marcha lenta" min={100} max={2000} passo={10} valor={spec.idle} formatar={(v) => `${br(v)} rpm`} aoMudar={(v) => k.setSpec({ idle: Math.min(v, spec.rpmMax * 0.7) }, nt)} />
      <Slider id="rpmMax" rotulo="Rotação máxima (governada)" min={300} max={6000} passo={10} valor={spec.rpmMax} formatar={(v) => `${br(v)} rpm`} aoSoltar={(v) => k.setSpec({ rpmMax: v, redline: v, rpmPotencia: Math.min(spec.rpmPotencia, v) })} />
      <Slider id="cr" rotulo="Taxa de compressão" min={12} max={23} passo={0.1} valor={spec.cr} formatar={(v) => `${virgula(v, 1)}:1`} aoSoltar={(v) => k.setSpec({ cr: v }, { render: false })} />
      <Field rotulo="Injeção">
        <ChipGroup id="injecao" opcoes={INJECOES} atual={spec.injecao} aoEscolher={(v) => k.setSpec({ injecao: v as any, eletronico: v === 'common-rail' || v === 'heui' ? true : spec.eletronico })} />
      </Field>
      <Field rotulo="Injeção piloto">
        <ChipGroup id="piloto" opcoes={LIGADO} atual={spec.piloto} aoEscolher={(v) => k.setSpec({ piloto: v }, { structural: false })} />
      </Field>
      <Field rotulo="Câmara">
        <ChipGroup id="idi" opcoes={[{ valor: false, rotulo: 'Injeção direta' }, { valor: true, rotulo: 'Pré-câmara (IDI)' }]} atual={spec.idi} aoEscolher={(v) => k.setSpec({ idi: v }, { structural: false })} />
      </Field>
      <Slider id="cetano" rotulo="Número de cetano" min={40} max={55} passo={1} valor={spec.cetano || 48} formatar={(v) => `${v}${v >= 51 ? ' (europeu)' : v >= 48 ? ' (S10)' : ''}`} aoMudar={(v) => k.setSpec({ cetano: v }, nt)} />
      <Slider id="cam" rotulo="Cruzamento de válvulas" min={0} max={0.3} passo={0.01} valor={clamp(spec.cam || 0, 0, 0.3)} formatar={(v) => virgula(v, 2)} aoMudar={(v) => k.setSpec({ cam: v }, nt)} />
      <Slider id="mecanica" rotulo="Ruído mecânico (acerto do motor)" min={-20} max={30} passo={1} valor={spec.mecanica || 0} formatar={(v) => `${v > 0 ? '+' : ''}${v} dB`} aoMudar={(v) => k.setSpec({ mecanica: v }, nt)} />
    </Section>
  );
}

// ---- Características
function Caracteristicas({ k, e }: P) {
  const { spec } = e;
  return (
    <Section titulo="Características">
      <Slider id="inertia" rotulo="Volante do motor" min={0.2} max={2} passo={0.05} valor={spec.inertia}
        formatar={(v) => (v < 0.5 ? 'muito leve' : v < 0.85 ? 'leve' : v < 1.25 ? 'normal' : 'pesado')} aoMudar={(v) => k.setSpec({ inertia: v }, nt)} />
      <Slider id="power" rotulo="Potência" min={20} max={4000} passo={1} valor={spec.power} formatar={(v) => `${br(v)} kW · ${br(Math.round(v * 1.3596))} cv`} aoSoltar={(v) => k.setSpec({ power: v }, { structural: true })} />
      <Slider id="torque" rotulo="Torque máximo" min={100} max={40000} passo={10} valor={spec.torque} formatar={(v) => `${br(v)} N·m`} aoSoltar={(v) => k.setSpec({ torque: v }, { structural: false })} />
      <Slider id="bsfc" rotulo="Consumo específico" min={0.16} max={0.26} passo={0.005} valor={spec.bsfc || ({ leve: 0.22, pesado: 0.195, locomotiva: 0.215 }[spec.classe] ?? 0.21)} formatar={(v) => `${Math.round(v * 1000)} g/kWh`} aoSoltar={(v) => k.setSpec({ bsfc: v })} />
    </Section>
  );
}

// ---- Governador (no lugar do corte de giro)
const NOTA_GOV = {
  'min-max': 'Eletrônico: o pedal manda combustível; um PI segura a lenta e o governador de máxima corta numa rampa de 120 rpm acima da rotação máxima. Sem corte de ignição, sem batido.',
  'todas-as-rotacoes': 'Mecânico (contrapesos contra a mola): o pedal escolhe a rotação; com carga o giro cai o droop. Em lenta a mola é mais mole e o motor "caça" um pouco.',
  isocrono: 'Isócrono: rotação fixa, qualquer que seja a carga (gerador, locomotiva, bancada).',
};
function Governador({ k, e }: P) {
  const { spec, carga: c } = e;
  const gov = e.portador === 'carro' ? spec.governador : e.portador === 'nenhum' ? 'isocrono' : 'isocrono';
  return (
    <Section titulo="Governador">
      {e.portador === 'carro' ? (
        <Field rotulo="Tipo">
          <ChipGroup id="governador" opcoes={[{ valor: 'min-max', rotulo: 'Eletrônico (mín–máx)' }, { valor: 'todas-as-rotacoes', rotulo: 'Mecânico (todas as rotações)' }]}
            atual={spec.governador === 'isocrono' ? 'min-max' : spec.governador} aoEscolher={(v) => k.setSpec({ governador: v as any }, { structural: false })} />
        </Field>
      ) : <p className="note">{e.portador === 'nenhum' ? 'Bancada: governador isócrono na rotação-alvo (ou na do pedal).' : 'O governador é o do portador: isócrono na rotação do notch ou da rede.'}</p>}
      {spec.governador === 'todas-as-rotacoes' && e.portador === 'carro' && (
        <>
          <Slider id="droop" rotulo="Droop" min={0.02} max={0.12} passo={0.005} valor={spec.droop ?? 0.08} formatar={(v) => pct(v)} aoMudar={(v) => k.setSpec({ droop: v }, nt)} />
          <Slider id="manual" rotulo="Acelerador manual" min={0} max={0.5} passo={0.01} valor={c.manual} formatar={(v) => (v ? `+${pct(v)} da faixa` : 'solto')} aoMudar={(v) => k.setCarga({ manual: v }, false)} />
        </>
      )}
      <p className="note">{NOTA_GOV[gov]} Sobrevelocidade: acima de 112% da rotação máxima o combustível é cortado até voltar a 105%.</p>
    </Section>
  );
}

// ---- Temperatura do motor (igual ao Ronco, mais velas, fumaça e λ)
function Temperatura({ k, e }: P) {
  const { params, spec } = e;
  return (
    <Section titulo="Temperatura do motor">
      <Field rotulo="Temperatura">
        <ChipGroup id="tempMode" opcoes={[
          { valor: 'real', rotulo: 'Esquentando de verdade', titulo: 'A água esquenta com o motor funcionando e esfria desligado' },
          { valor: 'fixed', rotulo: 'Fixa', titulo: 'Fica parada no valor escolhido' },
        ]} atual={e.tempMode} aoEscolher={(v) => k.setTempMode(v as 'real' | 'fixed')} />
      </Field>
      <AguaDoMotor k={k} />
      <div className="chips">
        <button type="button" className="chip" onClick={() => k.setCoolant(20)}>Partida a frio (20 °C)</button>
        <button type="button" className="chip" onClick={() => k.setCoolant(-10)}>Inverno (−10 °C)</button>
        <button type="button" className="chip" onClick={() => k.setCoolant(90)}>Motor quente (90 °C)</button>
      </div>
      <Field rotulo="Som da ventoinha do radiador">
        <ChipGroup id="fanSound" opcoes={LIGADO} atual={params.fanSound} aoEscolher={(v) => k.setParams({ fanSound: v }, true)} />
      </Field>
      <Field rotulo="Velas de aquecimento">
        <ChipGroup id="glow" opcoes={LIGADO} atual={!!spec.glow} aoEscolher={(v) => k.setSpec({ glow: v }, { structural: false })} />
      </Field>
      <p className="note">Frio: o atraso de ignição dobra e o knock sobe ~8 dB; nos primeiros segundos parte das queimas é parcial (fumaça branca). Com velas, o botão de ignição espera o tempo das velas antes de girar. O eletrônico sobe a lenta; o mecânico não (puxe o acelerador manual).</p>
    </Section>
  );
}
function AguaDoMotor({ k }: { k: ControleDiesel }) {
  const { agua } = useSyncExternalStore(k.assinarLento, k.obterLento);
  return <Slider id="coolant" rotulo="Água do motor" min={-25} max={120} passo={1} valor={agua} formatar={(v) => `${v} °C`} aoMudar={(v) => k.setCoolant(v)} />;
}

// ---- Transmissão (igual ao Ronco; só com o portador carro)
const nomeDaTroca = (v: number) => (v < 0.08 ? 'corrida' : v < 0.17 ? 'dupla embreagem' : v < 0.32 ? 'esportivo' : v < 0.5 ? 'comum' : 'caminhão, sem pressa');
function Transmissao({ k, e }: P) {
  const { spec } = e;
  const st = spec.shiftTime || (spec.transmission === 'auto' ? 0.36 : 0.26);
  const ratios = k.currentRatios();
  const fin = spec.finalDrive || defaultFinal(spec.redline);
  const rw = spec.wheelR || 0.33;
  const vmax = (r: number) => Math.round(((spec.rpmMax / 60) * 2 * Math.PI * rw * 3.6) / (r * fin));
  return (
    <Section titulo="Transmissão">
      <Field rotulo="Marchas">
        <ChipGroup id="gears" classe="num" opcoes={[4, 5, 6, 8, 10, 12].map((n) => ({ valor: n, rotulo: String(n) }))} atual={spec.gears} aoEscolher={(v) => k.setSpec({ gears: v, ratios: undefined }, { structural: false })} />
      </Field>
      <Field rotulo="Câmbio">
        <ChipGroup id="trans" opcoes={[{ valor: 'manual', rotulo: 'Manual' }, { valor: 'auto', rotulo: 'Automático' }]} atual={spec.transmission} aoEscolher={(v) => k.setSpec({ transmission: v }, { structural: false })} />
      </Field>
      <Slider id="shiftTime" rotulo="Tempo de troca" min={0.04} max={1.5} passo={0.01} valor={st} formatar={(v) => `${virgula(v, 2)} s · ${nomeDaTroca(v)}`} aoMudar={(v) => k.setSpec({ shiftTime: v }, nt)} />
      {spec.transmission === 'auto' && (
        <Field rotulo="Modo do câmbio (M)">
          <ChipGroup id="driveMode" opcoes={DRIVE_MODES.map(([valor, rotulo, titulo]) => ({ valor, rotulo, titulo }))} atual={spec.driveMode || 'auto'} aoEscolher={(v) => k.setSpec({ driveMode: v }, { structural: false })} />
        </Field>
      )}
      {ratios.map((r, i) => (
        <Slider key={`ratio${i + 1}`} id={`ratio${i + 1}`} rotulo={`${i + 1}ª marcha`} min={0.4} max={16} passo={0.01} valor={r} formatar={(v) => `${v.toFixed(2)} : 1 · ${vmax(v)} km/h`}
          aoMudar={(v) => { const next = k.currentRatios(); next[i] = v; k.setSpec({ ratios: next }, nt); }} />
      ))}
      <Slider id="final" rotulo="Diferencial" min={1.5} max={12} passo={0.01} valor={fin} formatar={(v) => `${v.toFixed(2)} : 1`} aoMudar={(v) => k.setSpec({ finalDrive: v }, nt)} />
      <Slider id="mass" rotulo="Massa (com carga)" min={800} max={60000} passo={50} valor={spec.mass || 2000} formatar={(v) => `${br(v)} kg`} aoMudar={(v) => k.setSpec({ mass: v }, nt)} />
      <Slider id="wheelR" rotulo="Raio da roda" min={0.25} max={0.6} passo={0.005} valor={spec.wheelR || 0.33} formatar={(v) => `${Math.round(v * 1000)} mm`} aoMudar={(v) => k.setSpec({ wheelR: v }, nt)} />
      <Slider id="drag" rotulo="Arrasto aerodinâmico (½·ρ·Cd·A)" min={0.1} max={5} passo={0.01} valor={spec.drag ?? 0.42} formatar={(v) => `${virgula(v, 2)} N/(m/s)²`} aoMudar={(v) => k.setSpec({ drag: v }, nt)} />
      <p className="note">{spec.transmission === 'auto' ? 'E engata o D a partir do neutro. Q e E continuam funcionando como trocas manuais.' : 'E sobe e Q reduz.'}</p>
    </Section>
  );
}

// ---- Escapamento
function Escapamento({ k, e }: P) {
  const { spec } = e;
  const esc = spec.escape;
  const setE = (p: Partial<typeof esc>) => k.setSpec({ escape: { ...esc, ...p } });
  return (
    <Section titulo="Escapamento">
      <Field rotulo="Turbina no escape">
        <ChipGroup id="turbina" opcoes={LIGADO} atual={esc.turbina} aoEscolher={(v) => setE({ turbina: v })} />
      </Field>
      <Field rotulo="Filtro de partículas (DOC + DPF)">
        <ChipGroup id="dpf" opcoes={LIGADO} atual={esc.dpf} aoEscolher={(v) => setE({ dpf: v })} />
      </Field>
      <Field rotulo="Abafador">
        <ChipGroup id="abafador" opcoes={[
          { valor: 'stock', rotulo: 'Original' }, { valor: 'abafador-caminhao', rotulo: 'Caminhão' }, { valor: 'sport', rotulo: 'Esportivo' },
          { valor: 'straight', rotulo: 'Direto' }, { valor: 'nenhum', rotulo: 'Só a chaminé' },
        ]} atual={esc.abafador} aoEscolher={(v) => setE({ abafador: v as any })} />
      </Field>
      <Slider id="pipe" rotulo="Comprimento do escape" min={0.6} max={8} passo={0.1} valor={esc.comprimento} formatar={(v) => `${virgula(v, 1)} m`} aoSoltar={(v) => setE({ comprimento: v })} />
      <Slider id="pipeD" rotulo="Diâmetro do escape" min={1.5} max={18} passo={0.25} valor={esc.diametro} formatar={(v) => `${virgula(v, 2)}" · ${Math.round(v * 25.4)} mm`} aoSoltar={(v) => setE({ diametro: v })} />
      <Field rotulo="Chaminé">
        <ChipGroup id="chamine" opcoes={LIGADO} atual={!!esc.chamine} aoEscolher={(v) => setE({ chamine: v ? { altura: 1, diametro: esc.diametro } : null })} />
      </Field>
      {esc.chamine && (
        <>
          <Slider id="chAltura" rotulo="Altura da chaminé" min={0.3} max={5} passo={0.1} valor={esc.chamine.altura} formatar={(v) => `${virgula(v, 1)} m`} aoSoltar={(v) => setE({ chamine: { ...esc.chamine!, altura: v } })} />
          <Slider id="chDiam" rotulo="Diâmetro da chaminé" min={2} max={20} passo={0.25} valor={esc.chamine.diametro} formatar={(v) => `${virgula(v, 2)}"`} aoSoltar={(v) => setE({ chamine: { ...esc.chamine!, diametro: v } })} />
        </>
      )}
      <Slider id="tempGas" rotulo="Gás no escape (velocidade do som)" min={420} max={600} passo={5} valor={esc.tempGas} formatar={(v) => `${v} m/s · ${Math.round((v / 20.05) ** 2 - 273)} °C`} aoSoltar={(v) => setE({ tempGas: v })} />
    </Section>
  );
}

// ---- Acessórios: válvula e ressonador só nas picapes; freio-motor
const NOTA_FREIO = {
  descarga: 'Borboleta no escape: o motor bombeia contra 3 bar; os pulsos quase somem e sobra o chiado da fresta.',
  vgt: 'As palhetas do turbo fecham: contrapressão de 2,5 bar e o uivo do turbo subindo.',
  jake: 'Jake brake: abre o escape no fim da compressão e solta o ar a 35–50 bar. O "metralhadora".',
  veb: 'VEB (Volvo): compressão nos 6 cilindros com janela menor mais a borboleta no escape; mais surdo que o Jake.',
};
function Acessorios({ k, e }: P) {
  const { spec, carga: c } = e;
  const picape = spec.classe === 'leve';
  return (
    <Section titulo="Acessórios">
      {picape && (
        <>
          <Field rotulo="Escape ativo (válvula)">
            <ChipGroup id="valve" opcoes={[{ valor: 'none', rotulo: 'Sem' }, { valor: 'closed', rotulo: 'Silencioso' }, { valor: 'auto', rotulo: 'Normal' }, { valor: 'sport', rotulo: 'Esportivo' }, { valor: 'open', rotulo: 'Escape livre' }]}
              atual={spec.valve || 'none'} aoEscolher={(v) => k.setValve(v)} />
          </Field>
          <Field rotulo="Ressonador">
            <ChipGroup id="reso" opcoes={[{ valor: false, rotulo: 'Sem' }, { valor: true, rotulo: 'Com' }]} atual={!!spec.reso} aoEscolher={(v) => k.setSpec({ reso: v })} />
          </Field>
        </>
      )}
      <Field rotulo="Freio-motor">
        <ChipGroup id="freioMotor" opcoes={[{ valor: 'nenhum', rotulo: 'Nenhum' }, { valor: 'descarga', rotulo: 'Borboleta no escape' }, { valor: 'vgt', rotulo: 'VGT' }, { valor: 'jake', rotulo: 'Jake' }, { valor: 'veb', rotulo: 'VEB' }]}
          atual={spec.freioMotor} aoEscolher={(v) => k.setSpec({ freioMotor: v as any, jakeCilindros: v === 'jake' ? [2, 4, 6] : spec.jakeCilindros }, { structural: false })} />
      </Field>
      {spec.freioMotor !== 'nenhum' && (
        <>
          <Field rotulo="Chave do freio-motor (J)">
            <ChipGroup id="freioChave" opcoes={LIGADO} atual={c.freio} aoEscolher={(v) => k.setCarga({ freio: v })} />
          </Field>
          {spec.freioMotor === 'jake' && (
            <Field rotulo="Cilindros do Jake">
              <ChipGroup id="jakeCil" classe="num" opcoes={[2, 4, 6].map((n) => ({ valor: n, rotulo: String(n) }))} atual={c.jake} aoEscolher={(v) => k.setCarga({ jake: v })} />
            </Field>
          )}
          <p className="note">{NOTA_FREIO[spec.freioMotor]} Age sem pedal e acima de 1,3× a lenta.</p>
        </>
      )}
    </Section>
  );
}

// ---- Fumaça e frio (no lugar de "Estalos no escape")
function FumacaEFrio({ k, e }: P) {
  const { spec } = e;
  return (
    <Section titulo="Fumaça e frio">
      <Slider id="limiteFumaca" rotulo="Limite de fumaça (λ mínimo)" min={1} max={1.3} passo={0.01} valor={spec.limiteFumaca} formatar={(v) => (v <= 1.001 ? '1,00 · nada corta' : `${virgula(v, 2)}${v >= 1.2 ? ' · central eletrônica' : ' · aneroide'}`)} aoMudar={(v) => k.setSpec({ limiteFumaca: v }, nt)} />
      <Field rotulo="Aneroide (compensador do turbo)">
        <ChipGroup id="aneroide" opcoes={[{ valor: true, rotulo: 'Com', titulo: 'λ mínimo 1,10' }, { valor: false, rotulo: 'Sem', titulo: 'λ mínimo 1,0: o excesso vira fumaça preta' }]}
          atual={spec.limiteFumaca > 1.001} aoEscolher={(v) => k.setSpec({ limiteFumaca: v ? (spec.eletronico ? 1.25 : 1.1) : 1.0 }, nt)} />
      </Field>
      <Field rotulo="Pré-aquecimento (velas)">
        <ChipGroup id="preaquec" opcoes={LIGADO} atual={!!spec.glow} aoEscolher={(v) => k.setSpec({ glow: v }, { structural: false })} />
      </Field>
      <p className="note">Pisando de uma vez, o combustível vem na hora e o ar só com o turbo: sem limite (bomba mecânica sem aneroide) sai fumaça preta por 1–4 s; com a central, o motor só acelera o quanto o ar deixa.</p>
    </Section>
  );
}

// ---- Admissão: caixa de ar, turbo diesel e soprador Roots
function Admissao({ k, e }: P) {
  const { spec } = e;
  return (
    <Section titulo="Admissão">
      <Field rotulo="Entrada de ar">
        <ChipGroup id="intake" opcoes={[{ valor: 'airbox', rotulo: 'Caixa de ar' }, { valor: 'sport', rotulo: 'Filtro esportivo' }]} atual={spec.intake} aoEscolher={(v) => k.setSpec({ intake: v })} />
      </Field>
      <Field rotulo="Turbo">
        <ChipGroup id="asp" opcoes={[{ valor: 'na', rotulo: 'Aspirado' }, { valor: 'turbo', rotulo: 'Turbo' }]} atual={spec.aspiration === 'turbo' ? 'turbo' : 'na'}
          aoEscolher={(v) => k.setSpec({ aspiration: v, boost: v === 'turbo' && !spec.boost ? 1.2 : spec.boost, turboTipo: v === 'turbo' ? (spec.turboTipo === 'nenhum' ? 'wastegate' : spec.turboTipo) : 'nenhum', turboRpmMax: spec.turboRpmMax || 120000, turboPas: spec.turboPas || 7 })} />
      </Field>
      {spec.aspiration === 'turbo' && (
        <>
          <Field rotulo="Tipo do turbo">
            <ChipGroup id="turboTipo" opcoes={[{ valor: 'vgt', rotulo: 'Geometria variável' }, { valor: 'wastegate', rotulo: 'Wastegate' }, { valor: 'fixo', rotulo: 'Fixo' }, { valor: 'engrenado', rotulo: 'Engrenado (EMD)' }]}
              atual={spec.turboTipo} aoEscolher={(v) => k.setSpec({ turboTipo: v as any, turboEngrenagem: v === 'engrenado' ? spec.turboEngrenagem || 18.3 : spec.turboEngrenagem }, { structural: false })} />
          </Field>
          <Slider id="boost" rotulo="Pressão máxima" min={0.3} max={2.6} passo={0.05} valor={spec.boost} formatar={(v) => `${virgula(1 + v, 2)} bar abs`} aoMudar={(v) => k.setSpec({ boost: v }, nt)} />
          <Slider id="turboRpmMax" rotulo="Rotação máxima do turbo" min={10000} max={220000} passo={1000} valor={spec.turboRpmMax} formatar={(v) => `${br(v)} rpm`} aoMudar={(v) => k.setSpec({ turboRpmMax: v }, nt)} />
          <Slider id="turboPas" rotulo="Pás do compressor" min={5} max={30} passo={1} valor={spec.turboPas} formatar={(v) => `${v} · apito ${br(Math.round((v * spec.turboRpmMax) / 60 / 100) / 10)} kHz no máximo`} aoMudar={(v) => k.setSpec({ turboPas: v }, nt)} />
          <Slider id="turboApito" rotulo="Volume do apito" min={-40} max={12} passo={1} valor={spec.turboApito} formatar={(v) => `${v > 0 ? '+' : ''}${v} dB`} aoMudar={(v) => k.setSpec({ turboApito: v }, nt)} />
          <Slider id="turboChiado" rotulo="Sopro do turbo (segue os pulsos do escape)" min={-30} max={12} passo={1} valor={spec.turboChiado || 0} formatar={(v) => `${v > 0 ? '+' : ''}${v} dB`} aoMudar={(v) => k.setSpec({ turboChiado: v }, nt)} />
          <Slider id="turboTau" rotulo="Atraso do turbo (sobe)" min={0.3} max={8} passo={0.1} valor={spec.turboTau[0]} formatar={(v) => `${virgula(v, 1)} s · desce em ${virgula(spec.turboTau[1], 1)} s`} aoMudar={(v) => k.setSpec({ turboTau: [v, v * (spec.turboTau[1] / spec.turboTau[0])] }, nt)} />
        </>
      )}
      {spec.tempos === 2 && (
        <Field rotulo="Soprador Roots">
          <ChipGroup id="soprador" opcoes={LIGADO} atual={!!spec.soprador} aoEscolher={(v) => k.setSpec({ soprador: v ? { relacao: 1.95, lobulos: 3, uivo: 0, pressao: 0.45 } : undefined })} />
        </Field>
      )}
      {spec.soprador && (
        <>
          <Slider id="scRatio" rotulo="Relação do soprador" min={1} max={3} passo={0.01} valor={spec.soprador.relacao} formatar={(v) => `${v.toFixed(2)}:1 · ${Math.round((spec.rpmMax / 60) * v * 2 * spec.soprador!.lobulos)} Hz na máxima`} aoSoltar={(v) => k.setSpec({ soprador: { ...spec.soprador!, relacao: v } })} />
          <Slider id="scWhine" rotulo="Volume do uivo" min={-30} max={12} passo={1} valor={spec.soprador.uivo} formatar={(v) => `${v > 0 ? '+' : ''}${v} dB`} aoSoltar={(v) => k.setSpec({ soprador: { ...spec.soprador!, uivo: v } })} />
        </>
      )}
    </Section>
  );
}
