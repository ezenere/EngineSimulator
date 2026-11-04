// Painel de controles do Ronco (renderControls() de src/app.js): escuta e ambiente, motor,
// características, corte de giro, temperatura, transmissão, escapamento, acessórios, estalos e
// admissão. Cada controle chama uma ação do ControleRonco; o painel só re-renderiza quando o
// estado (especificação, parâmetros) muda, nunca com a telemetria.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ChipGroup, Field, Section, Slider, AMBIENTES_RONCO, type OpcaoChip } from '../../ui';
import { LAYOUTS, parseOrder, randomValidOrder } from '../../engines/ronco/geometria';
import { defaultFinal } from '../../engines/ronco/dsp';
import { DRIVE_MODES, familyFor, type ControleRonco, type EstadoRonco } from './controle';
import { MagnetosEMistura, PartidaAv, HeliceAv, RotorAv } from '../comum/Aviacao';

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const br = (v: number) => v.toLocaleString('pt-BR');
const virgula = (v: number, casas: number) => v.toFixed(casas).replace('.', ',');
const pct = (v: number) => `${Math.round(v * 100)}%`;
const LIGADO: OpcaoChip<boolean>[] = [{ valor: true, rotulo: 'Ligado' }, { valor: false, rotulo: 'Desligado' }];

type P = { k: ControleRonco; e: EstadoRonco };

export function Painel({ k }: { k: ControleRonco }) {
  const e = useSyncExternalStore(k.assinar, k.obter);
  return (
    <>
      <Escuta k={k} e={e} />
      <Motor k={k} e={e} />
      <Caracteristicas k={k} e={e} />
      {/* aviação (RADIAL.md 7.2): o corte de giro vira magnetos e mistura, a transmissão some, aparecem partida e hélice/rotor */}
      {e.spec.aviation ? <MagnetosEMistura av={e.av} aoMudar={(p) => k.setAv(p)} /> : <CorteDeGiro k={k} e={e} />}
      {e.spec.aviation && <PartidaAv tipo={e.spec.partida || 'direta'} av={e.av} aoMudar={(p) => k.setAv(p)} />}
      {e.spec.aviation && e.spec.helice && <HeliceAv passoFixo={!!e.spec.helice.passoFixo} av={e.av} aoMudar={(p) => k.setAv(p)} />}
      {e.spec.aviation && e.spec.rotor && <RotorAv av={e.av} aoMudar={(p) => k.setAv(p)} />}
      <Temperatura k={k} e={e} />
      {!e.spec.aviation && <Transmissao k={k} e={e} />}
      <Escapamento k={k} e={e} />
      <Acessorios k={k} e={e} />
      <Estalos k={k} e={e} />
      <Admissao k={k} e={e} />
    </>
  );
}

// ---- Escuta e ambiente
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
        <ChipGroup id="observer" opcoes={[{ valor: 'car', rotulo: 'Junto com o carro' }, { valor: 'road', rotulo: 'Parado na via' }]} atual={e.observer} aoEscolher={(v) => k.setObserver(v as 'car' | 'road')} />
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
          <canvas id="passby" className="passby" aria-label="Posição do carro na via" />
          <p className="note" id="passNote">Engate e acelere: o carro anda pela via e passa por você a cada volta.</p>
        </>
      )}
      <Field rotulo="Ambiente">
        <ChipGroup id="env" opcoes={Object.entries(AMBIENTES_RONCO).map(([kk, v]) => ({ valor: kk, rotulo: v.name }))} atual={params.env} aoEscolher={(v) => k.setEnvironment(v)} />
      </Field>
      <Field rotulo="Som de fundo do ambiente">
        <ChipGroup id="ambSound" opcoes={[
          { valor: true, rotulo: 'Ligado', titulo: 'Vento, trânsito ao longe, ventilação do túnel, arquibancada…' },
          { valor: false, rotulo: 'Desligado', titulo: 'Só o carro (a acústica do lugar, ecos e reverberação, continua)' },
        ]} atual={params.ambSound} aoEscolher={(v) => k.setParams({ ambSound: v }, true)} />
      </Field>
      <Field rotulo="Volume do motor">
        <ChipGroup id="dynamics" opcoes={[
          { valor: 'real', rotulo: 'Real', titulo: 'Nível de verdade: a marcha lenta fica uns 20 dB abaixo do giro alto em carga' },
          { valor: 'arcade', rotulo: 'Arcade', titulo: 'Segura o som num nível médio em qualquer rotação: lenta e giro baixo sobem, o giro alto não muda' },
        ]} atual={params.dynamics} aoEscolher={(v) => k.setParams({ dynamics: v as 'real' | 'arcade' }, true)} />
      </Field>
      {params.dynamics === 'arcade' && <p className="note">Arcade: a lenta e o giro baixo ganham volume até ficar perto do giro alto. Útil em alto-falante pequeno ou volume baixo.</p>}
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

// ---- Motor
function Motor({ k, e }: P) {
  const { spec } = e;
  const fam = familyFor(spec.layout, spec.cylinders);
  const crank = fam.find((x) => x.id === spec.crank) || fam[0];
  return (
    <Section titulo="Motor">
      <Field rotulo="Cilindros">
        <ChipGroup id="cyl" classe="num" opcoes={[1, 2, 3, 4, 5, 6, 8, 10, 12, 16].map((n) => ({ valor: n, rotulo: String(n) }))} atual={spec.cylinders} aoEscolher={(n) => k.pickCylinders(n)} />
      </Field>
      <Field rotulo="Configuração">
        <ChipGroup id="layout" opcoes={Object.entries(LAYOUTS).map(([kk, v]) => ({ valor: kk, rotulo: v.name, desabilitado: !v.counts.includes(spec.cylinders) }))}
          atual={spec.layout} aoEscolher={(l) => k.applyFamily(l, spec.cylinders)} />
      </Field>
      {spec.layout === 'v' && (
        <Slider id="bank" rotulo="Ângulo entre bancadas" min={15} max={150} passo={1} valor={spec.bankAngle} formatar={(v) => `${v}°`}
          aoMudar={(v) => k.previewSpec({ bankAngle: v })} aoSoltar={(v) => k.setSpec({ bankAngle: v }, { render: false })} />
      )}
      <Field rotulo="Virabrequim">
        <ChipGroup id="crank" opcoes={fam.map((x) => ({ valor: x.id, rotulo: x.name }))} atual={crank.id} aoEscolher={(id) => k.applyFamily(spec.layout, spec.cylinders, id)} />
      </Field>
      <Field rotulo="Ordem de ignição">
        <div className="chips">
          <ChipGroup id="orders" classe="order" opcoes={crank.orders.map(([o, name]) => ({ valor: o, rotulo: name, sub: o }))} atual={spec.order} aoEscolher={(o) => k.setSpec({ order: o })} />
        </div>
      </Field>
      <OrdemDigitada k={k} e={e} pins={crank.pins} bank={crank.bank} />
    </Section>
  );
}

// ordem de ignição digitada: o texto é do campo (o usuário pode digitar "1 8 4 3…"), a
// especificação só muda quando a ordem é válida; volta ao valor da especificação quando o
// painel seria redesenhado no legado (rev)
function OrdemDigitada({ k, e, pins, bank }: P & { pins: number[]; bank?: number }) {
  const { spec } = e;
  const [texto, setTexto] = useState(spec.order);
  const [ok, setOk] = useState<number[] | null>(() => parseOrder(spec.order, spec.cylinders));
  useEffect(() => { setTexto(spec.order); setOk(parseOrder(spec.order, spec.cylinders)); }, [e.rev]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="order-edit">
        <input id="orderInput" type="text" value={texto} spellCheck={false} autoComplete="off" aria-label="Ordem de ignição personalizada" className={ok ? undefined : 'bad'}
          onKeyDown={(ev) => ev.stopPropagation()}
          onChange={(ev) => {
            const v = ev.target.value;
            const p = parseOrder(v, spec.cylinders);
            setTexto(v); setOk(p);
            if (p) k.setSpec({ order: p.join('-') }, { render: false });
          }} />
        <button type="button" className="chip" title="Gera outra ordem fisicamente possível para este virabrequim"
          onClick={() => { const o = randomValidOrder(spec.layout, pins, spec.bankAngle ?? bank); if (o) k.setSpec({ order: o.join('-') }); }}>Sortear</button>
      </div>
      <NotaDaOrdem e={e} parsed={ok} />
    </>
  );
}

// leitura da ordem: uniforme, irregular ou impossível neste virabrequim (updateOrderNote)
function NotaDaOrdem({ e, parsed }: { e: EstadoRonco; parsed: number[] | null }) {
  const { spec, motor } = e;
  let cls = 'note', txt: string;
  if (!parsed) {
    cls = 'note warn';
    txt = `Digite os ${spec.cylinders} cilindros, cada um uma vez (ex.: ${familyFor(spec.layout, spec.cylinders)[0].orders[0][0]}).`;
  } else if (!motor.valid) {
    cls = 'note warn';
    txt = 'Este virabrequim não permite essa sequência em 720°. Dois cilindros vão disparar quase juntos.';
  } else {
    const iv = motor.intervals.map(Math.round);
    const even = iv.every((x) => x === iv[0]);
    txt = even ? `Ignição uniforme a cada ${iv[0]}°.` : 'Ignição irregular: o ritmo vai "galopar".';
  }
  return <p className={cls} id="orderNote">{txt}</p>;
}

// ---- Características
function Caracteristicas({ k, e }: P) {
  const { spec } = e;
  // taxa de compressão: motor antigo para gasolina ruim comprime pouco (Fusca 7,5:1), moderno 10–13:1, turbo ~9,5:1
  const crDef = spec.aspiration === 'na' ? 11 : 9.5;
  const nt = { structural: false, render: false };
  return (
    <Section titulo="Características">
      <Slider id="disp" rotulo="Cilindrada" min={0.25} max={9} passo={0.05} valor={spec.displacement} formatar={(v) => `${v.toFixed(2)} L`}
        aoMudar={(v) => k.tuneSpec({ displacement: v })} aoSoltar={(v) => k.setSpec({ displacement: v }, { render: false })} />
      <Slider id="redline" rotulo="Faixa vermelha" min={3000} max={20000} passo={100} valor={spec.redline} formatar={(v) => `${br(v)} rpm`}
        aoMudar={(v) => k.setSpec({ redline: v, idle: Math.min(spec.idle, v * 0.45) }, nt)} />
      <Slider id="idle" rotulo="Marcha lenta" min={500} max={5000} passo={50} valor={spec.idle} formatar={(v) => `${br(v)} rpm`}
        aoMudar={(v) => k.setSpec({ idle: Math.min(v, spec.redline * 0.45) }, nt)} />
      <Slider id="compression" rotulo="Taxa de compressão" min={6.5} max={14} passo={0.1} valor={spec.compression || crDef} formatar={(v) => `${virgula(v, 1)}:1`}
        aoSoltar={(v) => k.setSpec({ compression: v }, { render: false })} />
      <Slider id="cam" rotulo="Comando de válvulas" min={0} max={1} passo={0.01} valor={spec.cam} formatar={(v) => (v < 0.3 ? 'manso' : v < 0.6 ? 'esportivo' : 'bravo')}
        aoMudar={(v) => k.setSpec({ cam: v }, nt)} />
      {/* onde o motor fica e como ele é arrefecido mudam o que se ouve de fora (cofre colado na câmera de trás, ventoinha) */}
      <Field rotulo="Posição do motor">
        <ChipGroup id="engine" opcoes={[
          { valor: 'front', rotulo: 'Dianteiro', titulo: 'Cofre na frente: de trás do carro, admissão e mecânica chegam de longe e atrás da carroceria' },
          { valor: 'mid', rotulo: 'Central', titulo: 'Atrás da cabine (Ferrari, Lamborghini, F1, motos): a câmera de trás ouve o motor de perto' },
          { valor: 'rear', rotulo: 'Traseiro', titulo: 'Atrás do eixo (Fusca, 911): a câmera de trás fica colada no cofre e ouve o carburador puxando ar e a mecânica' },
        ]} atual={spec.engine || (spec.family === 'moto' ? 'mid' : 'front')} aoEscolher={(v) => k.setSpec({ engine: v }, { structural: false })} />
      </Field>
      <Field rotulo="Arrefecimento">
        <ChipGroup id="cooling" opcoes={[
          { valor: 'water', rotulo: 'Água', titulo: 'Radiador e camisa d\'água: a camisa abafa a mecânica' },
          { valor: 'air', rotulo: 'Ar', titulo: 'Aletas, sem radiador (Fusca, 911 antigo, motos clássicas): sem camisa d\'água em volta, a mecânica soa mais' },
        ]} atual={spec.cooling || 'water'} aoEscolher={(v) => k.setSpec({ cooling: v }, { structural: false })} />
      </Field>
      <Slider id="inertia" rotulo="Volante do motor" min={0.2} max={2} passo={0.05} valor={spec.inertia}
        formatar={(v) => (v < 0.5 ? 'muito leve' : v < 0.85 ? 'leve' : v < 1.25 ? 'normal' : 'pesado')} aoMudar={(v) => k.setSpec({ inertia: v }, nt)} />
    </Section>
  );
}

// ---- Corte de giro
const NOTA_CORTE: Record<string, string> = {
  ign: 'Faixa pequena com ~70 ms de corte: batido rápido ("brrrr"), em neutro e em marcha. Faixa grande e tempo longo: batido lento e fundo ("brap... brap"). Os estouros dependem do escape quente e do catalisador (veja "Estalos no escape").',
  fuel: 'Faixa pequena e tempo curto: batido rápido. Faixa grande e tempo longo: batido lento e fundo. Seco, quase sem estouro.',
  partial: 'O giro fica praticamente parado na faixa vermelha, com um ronco picotado.',
  throttle: 'O giro para de subir perto da faixa vermelha, sem batida nem estouro.',
  none: 'Passando da faixa vermelha o motor perde força e começa a falhar (flutuação de válvulas), como num carro antigo.',
};
function CorteDeGiro({ k, e }: P) {
  const { spec } = e;
  const lt = spec.limiter || 'ign';
  const range = { ign: [50, 800], fuel: [50, 800], partial: [40, 400], throttle: [250, 800] }[lt];
  const help = { ign: 'quanto o giro cai antes de voltar', fuel: 'quanto o giro cai antes de voltar', partial: 'quão cedo começa a cortar', throttle: 'quão cedo começa a fechar' }[lt];
  const nt = { structural: false, render: false };
  return (
    <Section titulo="Corte de giro">
      <Field rotulo="Tipo de corte">
        <ChipGroup id="limiter" opcoes={[
          { valor: 'ign', rotulo: 'Ignição', titulo: 'Corta a faísca: o combustível passa e estoura no escape (carro preparado)' },
          { valor: 'fuel', rotulo: 'Combustível', titulo: 'Corta a injeção: o giro bate e volta, seco (corte de fábrica clássico)' },
          { valor: 'partial', rotulo: 'Parcial', titulo: 'Corta só alguns cilindros em rodízio: o giro fica parado no limite, picotado (Porsche, Ferrari, F1)' },
          { valor: 'throttle', rotulo: 'Borboleta', titulo: 'A central fecha o acelerador: o giro só para de subir, liso (carro moderno de rua)' },
          { valor: 'none', rotulo: 'Sem corte', titulo: 'Motor antigo de distribuidor: passando do limite as válvulas flutuam e ele falha' },
        ]} atual={lt} aoEscolher={(v) => k.setSpec({ limiter: v, limiterBand: { ign: 70, fuel: 70, partial: 110, throttle: 300 }[v] ?? spec.limiterBand, limiterHold: v === 'ign' || v === 'fuel' ? 0.07 : 0 }, { structural: false })} />
      </Field>
      {lt !== 'none' && range && (
        <Slider id="limiterBand" rotulo={`Faixa do corte (${help})`} min={range[0]} max={range[1]} passo={10} valor={clamp(spec.limiterBand || 70, range[0], range[1])}
          formatar={(v) => `${v} rpm`} aoMudar={(v) => k.setSpec({ limiterBand: v }, nt)} />
      )}
      {(lt === 'ign' || lt === 'fuel') && (
        <Slider id="limiterHold" rotulo="Tempo mínimo de cada corte" min={0} max={0.2} passo={0.005} valor={spec.limiterHold ?? 0.07}
          formatar={(v) => (v === 0 ? 'nenhum' : `${Math.round(v * 1000)} ms`)} aoMudar={(v) => k.setSpec({ limiterHold: v }, nt)} />
      )}
      <p className="note">{NOTA_CORTE[lt]}</p>
    </Section>
  );
}

// ---- Temperatura do motor
function Temperatura({ k, e }: P) {
  const { params } = e;
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
        <button type="button" className="chip" onClick={() => k.setCoolant(90)}>Motor quente (90 °C)</button>
      </div>
      <Field rotulo="Som da ventoinha do radiador">
        <ChipGroup id="fanSound" opcoes={LIGADO} atual={params.fanSound} aoEscolher={(v) => k.setParams({ fanSound: v }, true)} />
      </Field>
      <Field rotulo="Som da bomba de ar secundário">
        <ChipGroup id="saSound" opcoes={LIGADO} atual={params.saSound} aoEscolher={(v) => k.setParams({ saSound: v }, true)} />
      </Field>
      <p className="note">Frio: marcha lenta mais alta, ronco mais rasgado nos primeiros segundos (a central esquenta o catalisador), mais barulho de tucho e a bomba de ar zunindo. Perto de 90 °C a termostática abre; acima de ~99 °C liga a ventoinha.</p>
    </Section>
  );
}

// a água acompanha a telemetria (só re-renderiza este controle, e só quando o grau muda)
function AguaDoMotor({ k }: { k: ControleRonco }) {
  const { agua } = useSyncExternalStore(k.assinarLento, k.obterLento);
  return <Slider id="coolant" rotulo="Água do motor" min={-10} max={120} passo={1} valor={agua} formatar={(v) => `${v} °C`} aoMudar={(v) => k.setCoolant(v)} />;
}

// ---- Transmissão
const nomeDaTroca = (v: number) => (v < 0.08 ? 'corrida / quickshifter' : v < 0.17 ? 'dupla embreagem' : v < 0.32 ? 'esportivo' : v < 0.5 ? 'comum' : 'antigo, sem pressa');
function Transmissao({ k, e }: P) {
  const { spec } = e;
  const nt = { structural: false, render: false };
  const st = spec.shiftTime || (spec.transmission === 'auto' ? 0.36 : 0.26);
  // relações: número maior = marcha mais curta (mais força, menos velocidade)
  const ratios = k.currentRatios();
  const fin = spec.finalDrive || defaultFinal(spec.redline);
  const rw = spec.wheelR || 0.33;
  const vmax = (r: number) => Math.round(((spec.redline / 60) * 2 * Math.PI * rw * 3.6) / (r * fin));
  // o carro: massa e potência mudam só como ele anda (o som fica igual)
  const massDef = Math.round(clamp(850 + 160 * spec.displacement, 950, 1900));
  return (
    <Section titulo="Transmissão">
      <Field rotulo="Marchas">
        <ChipGroup id="gears" classe="num" opcoes={[4, 5, 6, 7, 8, 9, 10].map((n) => ({ valor: n, rotulo: String(n) }))} atual={spec.gears} aoEscolher={(v) => k.setSpec({ gears: v, ratios: undefined }, { structural: false })} />
      </Field>
      <Field rotulo="Câmbio">
        <ChipGroup id="trans" opcoes={[{ valor: 'manual', rotulo: 'Manual' }, { valor: 'auto', rotulo: 'Automático' }]} atual={spec.transmission} aoEscolher={(v) => k.setSpec({ transmission: v }, { structural: false })} />
      </Field>
      <Slider id="shiftTime" rotulo="Tempo de troca" min={0.04} max={1} passo={0.01} valor={st} formatar={(v) => `${virgula(v, 2)} s · ${nomeDaTroca(v)}`}
        aoMudar={(v) => k.setSpec({ shiftTime: v }, nt)} />
      {spec.transmission === 'auto' && (
        <Field rotulo="Modo do câmbio (M)">
          <ChipGroup id="driveMode" opcoes={DRIVE_MODES.map(([valor, rotulo, titulo]) => ({ valor, rotulo, titulo }))} atual={spec.driveMode || 'auto'} aoEscolher={(v) => k.setSpec({ driveMode: v }, { structural: false })} />
        </Field>
      )}
      {ratios.map((r, i) => (
        <Slider key={`ratio${i + 1}`} id={`ratio${i + 1}`} rotulo={`${i + 1}ª marcha`} min={0.4} max={5.5} passo={0.01} valor={r} formatar={(v) => `${v.toFixed(2)} : 1 · ${vmax(v)} km/h`}
          aoMudar={(v) => { const next = k.currentRatios(); next[i] = v; k.setSpec({ ratios: next }, nt); }} />
      ))}
      <Slider id="final" rotulo="Diferencial" min={1.5} max={12} passo={0.01} valor={fin} formatar={(v) => `${v.toFixed(2)} : 1`} aoMudar={(v) => k.setSpec({ finalDrive: v }, nt)} />
      <div className="chips"><button type="button" className="chip" onClick={() => k.setSpec({ ratios: undefined, finalDrive: undefined }, { structural: false })}>Escalonamento padrão</button></div>
      <Slider id="mass" rotulo="Massa (com motorista)" min={150} max={2600} passo={10} valor={spec.mass || massDef} formatar={(v) => `${v} kg`} aoMudar={(v) => k.setSpec({ mass: v }, nt)} />
      {/* roda e arrasto: com o diferencial, definem a velocidade em cada marcha e a final (o som não muda) */}
      <Slider id="wheelR" rotulo="Raio da roda" min={0.25} max={0.45} passo={0.005} valor={spec.wheelR || 0.33} formatar={(v) => `${Math.round(v * 1000)} mm`} aoMudar={(v) => k.setSpec({ wheelR: v }, nt)} />
      <Slider id="drag" rotulo="Arrasto aerodinâmico (½·ρ·Cd·A)" min={0.1} max={1.2} passo={0.01} valor={spec.drag ?? 0.42}
        formatar={(v) => `${virgula(v, 2)} N/(m/s)² · ${v < 0.33 ? 'moto/afilado' : v < 0.48 ? 'esportivo' : 'caixote'}`} aoMudar={(v) => k.setSpec({ drag: v }, nt)} />
      <Slider id="power" rotulo="Potência" min={20} max={1200} passo={5} valor={spec.power || 0} formatar={(v) => (v ? `${v} kW · ${Math.round(v * 1.3596)} cv` : 'a do modelo (sem ajuste)')}
        aoSoltar={(v) => k.setSpec({ power: v }, { structural: true })} />
      <p className="note">A potência escala o torque do modelo até a ficha técnica (recalibra ao soltar). Aparece no mostrador como N·m.</p>
      <p className="note">{spec.transmission === 'auto' ? 'E engata o D a partir do neutro. Q e E continuam funcionando como trocas manuais.' : 'E sobe e Q reduz. As reduções fazem punta-tacco automático.'}</p>
    </Section>
  );
}

// ---- Escapamento
function Escapamento({ k, e }: P) {
  const { spec } = e;
  const inline = spec.layout === 'inline';
  return (
    <Section titulo="Escapamento">
      <Field rotulo="Coletor">
        <ChipGroup id="header" opcoes={[
          { valor: 'equal', rotulo: 'Tubos iguais' }, { valor: 'unequal', rotulo: 'Tubos desiguais' }, { valor: 'short', rotulo: 'Coletor curto' },
          { valor: 'heater', rotulo: 'Caixas de calefação', titulo: 'Fusca: os tubos longos atravessam o trocador de calor da cabine, que come agudo; os curtos vão direto ao abafador. Um sopra diferente do outro a cada volta' },
        ]} atual={spec.header} aoEscolher={(v) => k.setSpec({ header: v })} />
      </Field>
      <Field rotulo="Vedação do escape">
        <ChipGroup id="breakout" opcoes={[
          { valor: 'sealed', rotulo: 'Vedado', titulo: 'Coletor de parede grossa e juntas soldadas: a rajada de cada válvula fica dentro do tubo' },
          { valor: 'old', rotulo: 'Antigo', titulo: 'Paredes finas e juntas deslizantes (Fusca, carros antigos): a rajada de cada abertura vaza perto do motor, o agudo "de lata"' },
          { valor: 'leaky', rotulo: 'Com vazamento', titulo: 'Junta furada ou escape solto: o vazamento sopra forte a cada explosão' },
        ]} atual={spec.breakout || 'sealed'} aoEscolher={(v) => k.setSpec({ breakout: v }, { structural: false })} />
      </Field>
      <Field rotulo="Traçado">
        <ChipGroup id="routing" opcoes={[
          { valor: 'single', rotulo: 'Único' }, { valor: 'dual', rotulo: 'Duplo' },
          { valor: 'xpipe', rotulo: 'X-pipe', desabilitado: inline, titulo: 'Cruza as bancadas no meio do escape' },
          { valor: 'hpipe', rotulo: 'H-pipe', desabilitado: inline, titulo: 'Tubo de equalização entre as bancadas' },
        ]} atual={spec.routing} aoEscolher={(v) => k.setSpec({ routing: v })} />
      </Field>
      <Field rotulo="Abafador">
        <ChipGroup id="muffler" opcoes={[
          { valor: 'straight', rotulo: 'Direto' }, { valor: 'sport', rotulo: 'Esportivo' },
          { valor: 'stock', rotulo: 'Original', titulo: 'Câmaras com lã e ressonador, como nos carros modernos: grave encorpado, agudo cortado' },
          { valor: 'classic', rotulo: 'Original antigo', titulo: 'Caixa de lata só com câmaras, sem lã (Fusca, anos 60/70): o médio-agudo passa e a lata ressoa, estridente' },
        ]} atual={spec.muffler} aoEscolher={(v) => k.setSpec({ muffler: v })} />
      </Field>
      <Slider id="pipe" rotulo="Comprimento do escape" min={0.8} max={5} passo={0.1} valor={spec.pipeLen} formatar={(v) => `${v.toFixed(1)} m`}
        aoSoltar={(v) => k.setSpec({ pipeLen: v }, { render: false })} />
    </Section>
  );
}

// ---- Acessórios
const NOTA_VALVULA: Record<string, string> = {
  closed: 'Silencioso: o som sempre passa pelo abafador, abafado e grave.',
  auto: 'Normal: abre com o pé acima de ~55% ou acima de ~60% do giro; em cruzeiro fecha. B troca o modo.',
  sport: 'Esportivo: aberta na lenta e acelerando, com o pulso de cada cilindro saindo seco; fecha só rodando leve. B troca o modo.',
  open: 'Pista: sempre aberta, o gás sai antes do abafador. B troca o modo.',
};
const polegadas = (v: number) => `${virgula(v, 2)}" · ${Math.round(v * 25.4)} mm`;
function Acessorios({ k, e }: P) {
  const { spec } = e;
  // escape ativo: a válvula desvia o gás do abafador; cada modo é o comando que as centrais dos carros usam
  const vm = spec.valve || 'none';
  const ts = spec.twoStep === true ? 'cut' : spec.twoStep || 'off';
  const def = Math.round(Math.min(Math.max(spec.redline * 0.5, spec.idle * 2.2), spec.redline * 0.8) / 50) * 50;
  const lo = Math.ceil((spec.idle * 1.5) / 100) * 100, hi = Math.floor((spec.redline * 0.9) / 100) * 100;
  return (
    <Section titulo="Acessórios">
      <Field rotulo="Escape ativo (válvula)">
        <ChipGroup id="valve" opcoes={[
          { valor: 'none', rotulo: 'Sem' },
          { valor: 'closed', rotulo: 'Silencioso', titulo: 'Válvula sempre fechada: tudo passa pelo abafador' },
          { valor: 'auto', rotulo: 'Normal', titulo: 'Abre com o pé embaixo ou giro alto, fecha em cruzeiro' },
          { valor: 'sport', rotulo: 'Esportivo', titulo: 'Aberta na lenta e assim que você pisa; fecha só rodando leve em giro baixo' },
          { valor: 'open', rotulo: 'Pista', titulo: 'Sempre aberta: o gás sai antes do abafador' },
        ]} atual={vm} aoEscolher={(v) => k.setValve(v)} />
      </Field>
      {vm !== 'none' && <p className="note">{NOTA_VALVULA[vm]}</p>}
      {/* fino: mais contrapressão, gás mais rápido (mais chiado) e ponta que irradia menos grave; largo: o contrário */}
      <Slider id="pipeD" rotulo="Diâmetro do escape" min={1.5} max={4} passo={0.05} valor={spec.pipeD || 2.5} formatar={polegadas} aoSoltar={(v) => k.setSpec({ pipeD: v }, { render: false })} />
      {/* a ponteira é só a saída: fina, o gás sai rápido e sopra (o Fusca tem duas finas); larga, sai manso */}
      <Slider id="tipD" rotulo="Ponteira (saída)" min={1.25} max={4} passo={0.05} valor={spec.tipD || spec.pipeD || 2.5} formatar={polegadas} aoSoltar={(v) => k.setSpec({ tipD: v }, { render: false })} />
      <Field rotulo="Ressonador">
        <ChipGroup id="reso" opcoes={[
          { valor: false, rotulo: 'Sem' },
          { valor: true, rotulo: 'Com', titulo: 'Tubo lateral que cancela o ronco chato de cruzeiro (perto de 2200 rpm)' },
        ]} atual={!!spec.reso} aoEscolher={(v) => k.setSpec({ reso: v })} />
      </Field>
      <Field rotulo="2-step (largada)">
        <ChipGroup id="twoStep" opcoes={[
          { valor: 'off', rotulo: 'Desligado' },
          { valor: 'cut', rotulo: 'Corte', titulo: 'Corta a ignição no limite: o giro bate e solta alguns estouros' },
          { valor: 'soft', rotulo: 'Controle de largada', titulo: 'Como nos Porsche: a eletrônica dosa o acelerador e o giro fica parado, sem corte e sem estouro' },
        ]} atual={ts} aoEscolher={(v) => k.setSpec({ twoStep: v }, { structural: false })} />
      </Field>
      {ts !== 'off' && (
        <>
          <Slider id="launchRpm" rotulo="Rotação de largada" min={lo} max={hi} passo={50} valor={clamp(spec.launchRpm || def, lo, hi)} formatar={(v) => `${br(v)} rpm`}
            aoMudar={(v) => k.setSpec({ launchRpm: v }, { structural: false, render: false })} />
          <p className="note">{ts === 'cut'
            ? 'Em ponto morto, ou engatado segurando o freio (S), pise fundo: o giro bate no corte e estoura no escape. Engate ou solte o freio para largar.'
            : 'Em ponto morto, ou engatado segurando o freio (S), pise fundo: o giro fica parado na rotação escolhida, liso. Engate ou solte o freio para largar.'}</p>
        </>
      )}
    </Section>
  );
}

// ---- Estalos no escape
function Estalos({ k, e }: P) {
  const { spec } = e;
  return (
    <Section titulo="Estalos no escape">
      <Field rotulo="Mapa na desaceleração">
        <ChipGroup id="overrun" opcoes={[
          { valor: 'cut', rotulo: 'Corta a injeção', titulo: 'Central moderna: tirou o pé, cortou o combustível. Desacelera em silêncio.' },
          { valor: 'lean', rotulo: 'Sem corte (carburador)', titulo: 'Carburador ou injeção antiga: a mistura continua entrando, falha no cilindro com o vácuo alto e às vezes estoura no escape quente.' },
          { valor: 'burble', rotulo: 'Crepitar de fábrica', titulo: 'Mapa esportivo (AMG, Ferrari, RS3…): por um ou dois segundos depois de tirar o pé a central injeta e atrasa a ignição. Estalos curtos e seguidos.' },
          { valor: 'popbang', rotulo: 'Pop & bang (remap)', titulo: 'Mapa preparado: abre um pouco a borboleta e injeta na desaceleração por vários segundos. Estouros fortes.' },
          { valor: 'antilag', rotulo: 'Antilag (rali)', titulo: 'Tirou o pé, a central abre o ar e queima a mistura no coletor para a turbina não parar. Estouros secos e turbo sempre cheio.', desabilitado: spec.aspiration !== 'turbo' },
        ]} atual={spec.overrun || 'cut'} aoEscolher={(v) => k.setSpec({ overrun: v }, { structural: false })} />
      </Field>
      <Field rotulo="Catalisador">
        <ChipGroup id="cat" opcoes={[
          { valor: true, rotulo: 'Com', titulo: 'Queima o combustível que sobra: menos estouros, e os que sobram saem abafados. Também abafa um pouco o chiado do escape.' },
          { valor: false, rotulo: 'Sem', titulo: 'O combustível cru chega quente no escape: estoura mais e mais alto.' },
        ]} atual={spec.cat !== false} aoEscolher={(v) => k.setSpec({ cat: v }, { structural: false })} />
      </Field>
      <p className="note">Os estouros são combustível queimando no escape: precisam de mistura sem queimar (corte de ignição no limitador, troca rápida ou 2-step, ou o mapa da desaceleração) e de escape quente, depois de uma acelerada forte. O abafador e o catalisador abafam.</p>
      <TemperaturaDoEscape k={k} />
    </Section>
  );
}

function TemperaturaDoEscape({ k }: { k: ControleRonco }) {
  const { escape } = useSyncExternalStore(k.assinarLento, k.obterLento);
  const t = +escape;
  return (
    <p className="note" id="exhNote" data-t={escape} hidden={!escape}>
      {escape ? `Escape a ${t} °C · ${t < 350 ? 'frio: quase não estoura' : t < 550 ? 'morno: estoura pouco' : 'quente: pronto para estourar'}` : ''}
    </p>
  );
}

// ---- Admissão
function Admissao({ k, e }: P) {
  const { spec } = e;
  const nt = { structural: false, render: false };
  // o uivo é a pulsação da descarga a cada passagem de lóbulo (ou de pá): giro × polia × passagens por volta
  const scType = spec.scType || 'screw';
  const order = (spec.scRatio || 2.4) * (spec.scLobes || 6) * (scType === 'roots' ? 2 : 1);
  return (
    <Section titulo="Admissão">
      <Field rotulo="Aspiração">
        <ChipGroup id="asp" opcoes={[
          { valor: 'na', rotulo: 'Aspirado' }, { valor: 'turbo', rotulo: 'Turbo' },
          { valor: 'super', rotulo: 'Compressor mecânico', titulo: 'Supercharger tocado por correia: pressão na hora, com o uivo dos rotores' },
        ]} atual={spec.aspiration} aoEscolher={(v) => k.setSpec({ aspiration: v, boost: v !== 'na' && !spec.boost ? 0.8 : spec.boost, ...(v !== 'turbo' && spec.overrun === 'antilag' ? { overrun: 'popbang' } : {}) })} />
      </Field>
      {spec.aspiration !== 'na' && (
        <Slider id="boost" rotulo="Pressão máxima" min={0.3} max={2.5} passo={0.05} valor={spec.boost || 1} formatar={(v) => `${v.toFixed(2)} bar`} aoMudar={(v) => k.setSpec({ boost: v }, nt)} />
      )}
      {spec.aspiration === 'super' && (
        <>
          <Field rotulo="Tipo do compressor">
            <ChipGroup id="scType" opcoes={[
              { valor: 'roots', rotulo: 'Roots', titulo: 'Dois rotores de lóbulos sem compressão interna: cada bolsão abre de uma vez na descarga, uivo áspero' },
              { valor: 'screw', rotulo: 'Duplo parafuso', titulo: 'Rotores helicoidais com compressão interna: uivo mais limpo e agudo' },
              { valor: 'centrifugal', rotulo: 'Centrífugo', titulo: 'Rotor de pás em rotação muito alta: assobio quase sem pulsação' },
            ]} atual={scType} aoEscolher={(v) => k.setSpec({ scType: v }, { structural: false })} />
          </Field>
          <Slider id="scRatio" rotulo="Relação da polia" min={1} max={12} passo={0.01} valor={spec.scRatio || 2.4} formatar={(v) => `${v.toFixed(2)}:1`} aoMudar={(v) => k.setSpec({ scRatio: v }, nt)} />
          <Slider id="scLobes" rotulo={scType === 'centrifugal' ? 'Pás do rotor' : scType === 'roots' ? 'Lóbulos de cada rotor' : 'Lóbulos do rotor da correia'} min={2} max={12} passo={1}
            valor={spec.scLobes || 6} formatar={(v) => `${v}`} aoMudar={(v) => k.setSpec({ scLobes: v }, nt)} />
          <Slider id="scWhine" rotulo="Volume do uivo" min={-30} max={12} passo={1} valor={spec.scWhine ?? 0} formatar={(v) => `${v > 0 ? '+' : ''}${v} dB`} aoMudar={(v) => k.setSpec({ scWhine: v }, nt)} />
          <p className="note">{`O uivo fica em ${order.toFixed(1)}× o giro: ${Math.round(order * spec.redline / 60)} Hz na faixa vermelha, mais os harmônicos.`}</p>
        </>
      )}
      <Field rotulo="Alimentação">
        <ChipGroup id="fuel" opcoes={[
          { valor: 'efi', rotulo: 'Injeção' },
          { valor: 'carb', rotulo: 'Carburador', titulo: 'A mistura se divide mal pelo coletor: cada cilindro queima um pouco diferente e o motor "galopa"' },
        ]} atual={spec.fuel || 'efi'} aoEscolher={(v) => k.setSpec({ fuel: v })} />
      </Field>
      <Field rotulo="Entrada de ar">
        <ChipGroup id="intake" opcoes={[
          { valor: 'airbox', rotulo: 'Caixa de ar' }, { valor: 'sport', rotulo: 'Filtro esportivo' }, { valor: 'itb', rotulo: 'Borboletas individuais' },
        ]} atual={spec.intake} aoEscolher={(v) => k.setSpec({ intake: v })} />
      </Field>
    </Section>
  );
}
