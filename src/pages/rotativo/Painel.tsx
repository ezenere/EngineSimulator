// Painel de controles dos Rotativos (ROTATIVO.md 7): escuta e ambiente (igual ao Ronco), motor (rotores, R/e/b com V_cam
// e CR, janelas, velas, lenta, rotação máxima, alimentação), características (inércia, potência, torque, vedações), corte
// de giro (igual ao Ronco), temperatura (mais o gás de escape e a fumaça de óleo), transmissão (no carro e na moto),
// escapamento (tipo, pré-silencioso, reator, abafador, diâmetros, saídas), acessórios (válvula, 2-step no FD), estalos
// (mais a pós-queima), admissão (turbo, sequencial, troca) e carga (hélice/rotor pela aviação; palhetas: pressão e carga).
// Só re-renderiza quando o estado muda; as leituras da telemetria são escritas no DOM pelos mostradores.
import { useSyncExternalStore } from 'react';
import { ChipGroup, Field, Section, Slider, AMBIENTES_RONCO, type OpcaoChip } from '../../ui';
import { volumeCamara } from '../../engines/rotativo/geometria';
import { sobreposicao } from '../../engines/rotativo/config';
import { HeliceAv, RotorAv, MagnetosEMistura } from '../comum/Aviacao';
import type { ControleRotativo, EstadoRot } from './controle';

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const br = (v: number) => v.toLocaleString('pt-BR');
const virgula = (v: number, c: number) => v.toFixed(c).replace('.', ',');
const pct = (v: number) => `${Math.round(v * 100)}%`;
const LIGADO: OpcaoChip<boolean>[] = [{ valor: true, rotulo: 'Ligado' }, { valor: false, rotulo: 'Desligado' }];
type P = { k: ControleRotativo; e: EstadoRot };

export function Painel({ k }: { k: ControleRotativo }) {
  const e = useSyncExternalStore(k.assinar, k.obter);
  const s = e.spec, port = s.portadores || [];
  if (s.tipo === 'palhetas') return (<><Escuta k={k} e={e} /><p className="note">Aproximação: {s.aproximacao}.</p><Palhetas k={k} e={e} /></>);
  return (
    <>
      <Escuta k={k} e={e} />
      {s.aproximacao && <p className="note">Aproximação: {s.aproximacao}.</p>}
      <Motor k={k} e={e} />
      <Caracteristicas k={k} e={e} />
      <CorteDeGiro k={k} e={e} />
      {s.aviation && <MagnetosEMistura av={e.av} aoMudar={(p) => k.setAv(p)} />}
      {s.aviation && s.helice && <HeliceAv passoFixo={!!s.helice.passoFixo} av={e.av} aoMudar={(p) => k.setAv(p)} />}
      {s.aviation && s.rotor && <RotorAv av={e.av} aoMudar={(p) => k.setAv(p)} />}
      <Temperatura k={k} e={e} />
      {port.includes('carro') && <Transmissao k={k} e={e} />}
      <Escapamento k={k} e={e} />
      {port.includes('carro') && <Acessorios k={k} e={e} />}
      <Estalos k={k} e={e} />
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
  return (
    <Section titulo="Escuta e ambiente">
      <Field rotulo="Onde você está">
        <ChipGroup id="observer" opcoes={[{ valor: 'car', rotulo: 'No carro' }, { valor: 'road', rotulo: 'Na rua' }]} atual={e.observer} aoEscolher={(v) => k.setObserver(v as 'car' | 'road')} />
      </Field>
      {e.observer === 'car' ? (
        <Field rotulo="Microfone (C)">
          <ChipGroup id="mic" opcoes={[
            { valor: 'pipe', rotulo: 'Na ponteira' }, { valor: 'ext', rotulo: 'Atrás do carro' }, { valor: 'int', rotulo: 'Cabine' }, { valor: 'bay', rotulo: 'Cofre' },
          ]} atual={e.carMic} aoEscolher={(v) => k.setCarMic(v)} />
        </Field>
      ) : (
        <Slider id="roadDist" rotulo="Distância da via" min={2} max={60} passo={0.5} valor={params.roadDist} formatar={(v) => `${virgula(v, 1)} m`} aoMudar={(v) => k.setParams({ roadDist: v })} />
      )}
      <Field rotulo="Ambiente">
        <ChipGroup id="env" opcoes={Object.entries(AMBIENTES_RONCO).map(([kk, v]) => ({ valor: kk, rotulo: v.name }))} atual={params.env} aoEscolher={(v) => k.setEnvironment(v)} />
      </Field>
      <Field rotulo="Som de fundo do ambiente">
        <ChipGroup id="ambSound" opcoes={LIGADO} atual={params.ambSound} aoEscolher={(v) => k.setParams({ ambSound: v }, true)} />
      </Field>
      <Field rotulo="Volume do motor">
        <ChipGroup id="dynamics" opcoes={[{ valor: 'real', rotulo: 'Real' }, { valor: 'arcade', rotulo: 'Arcade' }]} atual={params.dynamics} aoEscolher={(v) => k.setParams({ dynamics: v as 'real' | 'arcade' }, true)} />
      </Field>
      {mix('mxEx', 'Escape', 'exhaust')}
      {mix('mxIn', 'Admissão', 'intake')}
      {mix('mxMech', 'Mecânica (vedações, engrenagem)', 'mech')}
      {mix('mxAir', 'Ar (jato, chiado)', 'air')}
      {mix('mxVol', 'Volume', 'master', 1.5)}
      <Slider id="eqLo" rotulo="Grave (abaixo de 160 Hz)" min={-12} max={12} passo={0.5} valor={eq.lo} formatar={(v) => `${v > 0 ? '+' : ''}${br(v)} dB`} aoMudar={(v) => k.setEq({ lo: v })} />
      <Slider id="eqMid" rotulo="Médio" min={-12} max={12} passo={0.5} valor={eq.mid} formatar={(v) => `${v > 0 ? '+' : ''}${br(v)} dB`} aoMudar={(v) => k.setEq({ mid: v })} />
      <Slider id="eqHi" rotulo="Agudo (acima de 3,5 kHz)" min={-12} max={12} passo={0.5} valor={eq.hi} formatar={(v) => `${v > 0 ? '+' : ''}${br(v)} dB`} aoMudar={(v) => k.setEq({ hi: v })} />
    </Section>
  );
}

// ---- Motor: rotores, geometria, janelas, velas
const ADM: OpcaoChip<string>[] = [
  { valor: 'lateral4', rotulo: 'Lateral 4', titulo: '13B: primária e secundária laterais; sobreposição de 16°e' },
  { valor: 'lateral6', rotulo: 'Lateral 6', titulo: 'Renesis Hi-Power: 6 janelas laterais, sem sobreposição' },
  { valor: 'street', rotulo: 'Street port', titulo: 'Lateral alargada: ~28°e de sobreposição, lenta a 900–1 100' },
  { valor: 'bridge', rotulo: 'Bridge port', titulo: 'Ponte sobre a vedação: ~100°e de sobreposição, lenta a 1 500–2 000' },
  { valor: 'periferica', rotulo: 'Periférica', titulo: '787B: janela na carcaça, ~130°e de sobreposição, lenta caçando 1 600–2 200' },
  { valor: 'sachs', rotulo: 'Sachs', titulo: 'Norton, MidWest, Austro, UEL: periférica pequena (a conferir)' },
];
function Motor({ k, e }: P) {
  const s = e.spec, m = e.motor!, x = s.tipo === 'x';
  const geo = s.geo || { R: 105, e: 15, b: 80 };
  const Vc = x ? s.Vcam || 23 : volumeCamara(geo.R, geo.e, geo.b);
  const ov = sobreposicao(s.janelas);
  return (
    <Section titulo="Motor">
      {!x && (
        <Field rotulo="Rotores">
          <ChipGroup id="rotores" classe="num" opcoes={[1, 2, 3, 4].map((n) => ({ valor: n, rotulo: String(n) }))} atual={m.rotores}
            aoEscolher={(n) => k.setSpec({ rotores: n, displacement: (n * Vc) / 1000 })} />
        </Field>
      )}
      <p className="note mono">{x ? 'X-Engine: rotor de 2 lobos em alojamento de 3, câmaras a 0/240/480° (ciclo de 720°)' : `Fases dos rotores: ${m.fases.map((f) => `${f}°`).join(' / ')} · câmaras a 360° (ciclo de 1 080°)`}</p>
      {!x ? (
        <>
          <Slider id="geoR" rotulo="Raio gerador R" min={50} max={130} passo={0.5} valor={geo.R} formatar={(v) => `${virgula(v, 1)} mm`} aoSoltar={(v) => k.setGeo({ R: v })} />
          <Slider id="geoE" rotulo="Excentricidade e" min={7} max={20} passo={0.1} valor={geo.e} formatar={(v) => `${virgula(v, 1)} mm · R/e ${virgula(geo.R / v, 2)}`} aoSoltar={(v) => k.setGeo({ e: v })} />
          <Slider id="geoB" rotulo="Largura b" min={30} max={110} passo={0.5} valor={geo.b} formatar={(v) => `${virgula(v, 1)} mm`} aoSoltar={(v) => k.setGeo({ b: v })} />
        </>
      ) : (
        <Slider id="vcam" rotulo="Volume da câmara" min={10} max={120} passo={0.5} valor={Vc} formatar={(v) => `${virgula(v, 1)} cm³`} aoSoltar={(v) => k.setSpec({ Vcam: v, cilindradaCamara: v, displacement: (3 * v) / 1000 })} />
      )}
      <p className="note mono">V_cam = 3√3·e·R·b = {virgula(Vc, 1)} cm³ por câmara · V_min = {virgula(Vc / (s.cr - 1), 1)} cm³ · nominal {virgula(s.displacement, 3)} L</p>
      <Slider id="cr" rotulo="Taxa de compressão" min={7} max={x ? 20 : 11} passo={0.1} valor={s.cr} formatar={(v) => `${virgula(v, 1)}:1`} aoSoltar={(v) => k.setSpec({ cr: v })} />
      {!x && (
        <>
          <Field rotulo="Janelas de admissão">
            <ChipGroup id="admissao" opcoes={ADM} atual={s.janelas.admissao} aoEscolher={(v) => k.setJanelas({ admissao: v as any })} />
          </Field>
          <Field rotulo="Janela de escape">
            <ChipGroup id="escapeJ" opcoes={[
              { valor: 'periferico', rotulo: 'Periférica', titulo: 'Na carcaça: abre a 75° antes do PMI com a câmara a 3–5 bar, o "brap"' },
              { valor: 'lateral', rotulo: 'Lateral (Renesis)', titulo: 'Duas janelas na face lateral: rampa 2× mais lenta, sem sobreposição' },
              { valor: 'sachs', rotulo: 'Sachs', titulo: 'Periférica da linhagem Sachs/Norton' },
            ]} atual={s.janelas.escape} aoEscolher={(v) => k.setJanelas({ escape: v as any })} />
          </Field>
          <p className="note">Sobreposição das janelas: {ov > 0 ? `${ov}°e` : 'nenhuma'}{ov > 90 ? ' · competição: a lenta caça e estala' : ''}</p>
          {(s.janelas.admissao === 'lateral4' || s.janelas.admissao === 'lateral6') && (
            <Slider id="apv" rotulo="Abertura da janela secundária" min={2500} max={6000} passo={50} valor={s.janelas.apv?.[0] ?? 3750} formatar={(v) => `${br(v)} rpm`}
              aoSoltar={(v) => k.setJanelas({ apv: [v, ...(s.janelas.apv?.slice(1) || [])] })} />
          )}
          {s.janelas.admissao === 'lateral6' && (
            <Slider id="apv2" rotulo="Abertura da janela auxiliar" min={4500} max={8000} passo={50} valor={s.janelas.apv?.[1] ?? 6250} formatar={(v) => `${br(v)} rpm`}
              aoSoltar={(v) => k.setJanelas({ apv: [s.janelas.apv?.[0] ?? 3750, v] })} />
          )}
        </>
      )}
      <Field rotulo="Velas por câmara">
        <ChipGroup id="velas" classe="num" opcoes={[1, 2, 3].map((n) => ({ valor: n, rotulo: String(n) }))} atual={s.velas} aoEscolher={(n) => k.setSpec({ velas: n }, { structural: false })} />
      </Field>
      {s.velas >= 2 && (
        <Field rotulo="Velas trailing (T)">
          <ChipGroup id="trailing" opcoes={[{ valor: true, rotulo: 'Ligadas' }, { valor: false, rotulo: 'Desligadas' }]} atual={s.trailingOn !== false} aoEscolher={(v) => k.setSpec({ trailingOn: v }, { structural: false })} />
        </Field>
      )}
      <Slider id="idle" rotulo="Lenta" min={600} max={3500} passo={10} valor={s.idle} formatar={(v) => `${br(v)} rpm`} aoSoltar={(v) => k.setSpec({ idle: v })} />
      <Slider id="rpmMax" rotulo="Rotação máxima" min={5000} max={16000} passo={100} valor={s.rpmMax} formatar={(v) => `${br(v)} rpm`} aoSoltar={(v) => k.setSpec({ rpmMax: v })} />
      <Field rotulo="Alimentação">
        <ChipGroup id="fuel" opcoes={[{ valor: 'efi', rotulo: 'Injeção' }, { valor: 'carb', rotulo: 'Carburador', titulo: 'A mistura se divide mal entre as câmaras: mais variação e galope' }]} atual={s.fuel || 'efi'} aoEscolher={(v) => k.setSpec({ fuel: v })} />
      </Field>
    </Section>
  );
}

function Caracteristicas({ k, e }: P) {
  const s = e.spec;
  return (
    <Section titulo="Características">
      <Slider id="J" rotulo="Inércia do eixo e do volante" min={0.002} max={0.6} passo={0.001} valor={s.J} formatar={(v) => `${virgula(v, 3)} kg·m²`} aoSoltar={(v) => k.setSpec({ J: v })} />
      <Slider id="power" rotulo="Potência" min={1} max={600} passo={1} valor={s.power} formatar={(v) => `${br(v)} kW · ${br(Math.round(v * 1.3596))} cv`} aoSoltar={(v) => k.setSpec({ power: v })} />
      {s.torque !== undefined && <p className="note">Torque da ficha: {br(s.torque)} N·m</p>}
      <Field rotulo="Vedações de ápice">
        <ChipGroup id="vedacoes" opcoes={[{ valor: 'novas', rotulo: 'Novas' }, { valor: 'gastas', rotulo: 'Gastas', titulo: 'Folga ×3: menos compressão, partida demorada, a lenta fria falha mais' }]}
          atual={s.vedacoes || 'novas'} aoEscolher={(v) => k.setSpec({ vedacoes: v as any }, { structural: false })} />
      </Field>
    </Section>
  );
}

const NOTA_CORTE: Record<string, string> = {
  ign: 'Corta a ignição: a mistura passa crua e estoura no escape quente.', fuel: 'Corta a injeção: o giro bate e volta, seco.',
  partial: 'Corta parte das câmaras em rodízio: o giro fica parado, picotado.', throttle: 'A central fecha a borboleta: o giro só para de subir.', none: 'Sem corte.',
};
function CorteDeGiro({ k, e }: P) {
  const { spec } = e, lt = spec.limiter || 'fuel';
  const range = ({ ign: [50, 800], fuel: [50, 800], partial: [40, 400], throttle: [250, 800] } as Record<string, number[]>)[lt];
  const nt = { structural: false, render: false };
  return (
    <Section titulo="Corte de giro">
      <Field rotulo="Tipo de corte">
        <ChipGroup id="limiter" opcoes={[
          { valor: 'ign', rotulo: 'Ignição' }, { valor: 'fuel', rotulo: 'Combustível' }, { valor: 'partial', rotulo: 'Parcial' }, { valor: 'throttle', rotulo: 'Borboleta' }, { valor: 'none', rotulo: 'Sem corte' },
        ]} atual={lt} aoEscolher={(v) => k.setSpec({ limiter: v, limiterBand: ({ ign: 70, fuel: 70, partial: 110, throttle: 300 } as Record<string, number>)[v] ?? spec.limiterBand, limiterHold: v === 'ign' || v === 'fuel' ? 0.07 : 0 }, { structural: false })} />
      </Field>
      {lt !== 'none' && range && (
        <Slider id="limiterBand" rotulo="Faixa do corte" min={range[0]} max={range[1]} passo={10} valor={clamp(spec.limiterBand || 70, range[0], range[1])} formatar={(v) => `${v} rpm`} aoMudar={(v) => k.setSpec({ limiterBand: v }, nt)} />
      )}
      {(lt === 'ign' || lt === 'fuel') && (
        <Slider id="limiterHold" rotulo="Tempo mínimo de cada corte" min={0} max={0.2} passo={0.005} valor={spec.limiterHold ?? 0.07} formatar={(v) => (v === 0 ? 'nenhum' : `${Math.round(v * 1000)} ms`)} aoMudar={(v) => k.setSpec({ limiterHold: v }, nt)} />
      )}
      <p className="note">{NOTA_CORTE[lt]}{spec.aproximacao?.includes('corte') ? ' (Aproximação: o carro original não tinha corte.)' : ''}</p>
    </Section>
  );
}

function Temperatura({ k, e }: P) {
  const { agua, escape } = useSyncExternalStore(k.assinarLento, k.obterLento);
  return (
    <Section titulo="Temperatura do motor">
      <Field rotulo="Temperatura">
        <ChipGroup id="tempMode" opcoes={[{ valor: 'real', rotulo: 'Esquentando de verdade' }, { valor: 'fixed', rotulo: 'Fixa' }]} atual={e.tempMode} aoEscolher={(v) => k.setTempMode(v as 'real' | 'fixed')} />
      </Field>
      <Slider id="coolant" rotulo="Água do motor (alojamentos)" min={-10} max={120} passo={1} valor={agua} formatar={(v) => `${v} °C`} aoMudar={(v) => k.setCoolant(v)} />
      <div className="chips">
        <button type="button" className="chip" onClick={() => k.setCoolant(20)}>Partida a frio (20 °C)</button>
        <button type="button" className="chip" onClick={() => k.setCoolant(90)}>Motor quente (90 °C)</button>
      </div>
      <Field rotulo="Som da ventoinha do radiador">
        <ChipGroup id="fanSound" opcoes={LIGADO} atual={e.params.fanSound} aoEscolher={(v) => k.setParams({ fanSound: v }, true)} />
      </Field>
      <Field rotulo="Som da bomba de ar secundário">
        <ChipGroup id="saSound" opcoes={LIGADO} atual={e.params.saSound} aoEscolher={(v) => k.setParams({ saSound: v }, true)} />
      </Field>
      <p className="note" id="exhNote">{escape ? `Gás de escape: parede do coletor a ${escape} °C (o Wankel chega a 900–1 000 °C em carga)` : 'O rotativo sai com o escape mais quente que o pistão: 400–500 °C na lenta, 900–1 000 °C em carga.'}</p>
      <p className="note">Nos primeiros 20 s a bomba dosadora queima óleo: fumaça azul (só visual).</p>
    </Section>
  );
}

function Transmissao({ k, e }: P) {
  const s = e.spec, nt = { structural: false, render: false };
  const ratios = k.currentRatios(), fin = s.finalDrive || 4, rw = s.wheelR || 0.33;
  const vmax = (r: number) => Math.round(((s.redline / 60) * 2 * Math.PI * rw * 3.6) / (r * fin));
  return (
    <Section titulo="Transmissão">
      <Field rotulo="Marchas">
        <ChipGroup id="gears" classe="num" opcoes={[3, 4, 5, 6].map((n) => ({ valor: n, rotulo: String(n) }))} atual={s.gears} aoEscolher={(v) => k.setSpec({ gears: v, ratios: undefined }, { structural: false })} />
      </Field>
      <Field rotulo="Câmbio">
        <ChipGroup id="trans" opcoes={[{ valor: 'manual', rotulo: 'Manual' }, { valor: 'auto', rotulo: 'Automático' }]} atual={s.transmission} aoEscolher={(v) => k.setSpec({ transmission: v }, { structural: false })} />
      </Field>
      <Slider id="shiftTime" rotulo="Tempo de troca" min={0.04} max={1} passo={0.01} valor={s.shiftTime || (s.transmission === 'auto' ? 0.36 : 0.26)} formatar={(v) => `${virgula(v, 2)} s`} aoMudar={(v) => k.setSpec({ shiftTime: v }, nt)} />
      {ratios.map((r, i) => (
        <Slider key={`ratio${i + 1}`} id={`ratio${i + 1}`} rotulo={`${i + 1}ª marcha`} min={0.4} max={5.5} passo={0.01} valor={r} formatar={(v) => `${v.toFixed(2)} : 1 · ${vmax(v)} km/h`}
          aoMudar={(v) => { const next = k.currentRatios(); next[i] = v; k.setSpec({ ratios: next }, nt); }} />
      ))}
      <Slider id="final" rotulo="Diferencial" min={1.5} max={8} passo={0.01} valor={fin} formatar={(v) => `${v.toFixed(2)} : 1`} aoMudar={(v) => k.setSpec({ finalDrive: v }, nt)} />
      <Slider id="mass" rotulo="Massa (com motorista)" min={150} max={2200} passo={10} valor={s.mass || 1300} formatar={(v) => `${v} kg`} aoMudar={(v) => k.setSpec({ mass: v }, nt)} />
      <Slider id="wheelR" rotulo="Raio da roda" min={0.25} max={0.45} passo={0.005} valor={rw} formatar={(v) => `${Math.round(v * 1000)} mm`} aoMudar={(v) => k.setSpec({ wheelR: v }, nt)} />
      <Slider id="drag" rotulo="Arrasto aerodinâmico (½·ρ·Cd·A)" min={0.1} max={1.2} passo={0.01} valor={s.drag ?? 0.42} formatar={(v) => `${virgula(v, 2)} N/(m/s)²`} aoMudar={(v) => k.setSpec({ drag: v }, nt)} />
    </Section>
  );
}

function Escapamento({ k, e }: P) {
  const s = e.spec, esc = s.escape, saidas = esc.saidas.length;
  return (
    <Section titulo="Escapamento">
      <Field rotulo="Tipo">
        <ChipGroup id="escTipo" opcoes={[
          { valor: 'serie', rotulo: 'Série', titulo: 'Coletor → turbo → catalisador → pré-silencioso → abafador (RX-7, RX-8, Cosmo)' },
          { valor: 'megafone', rotulo: 'Megafone', titulo: '787B: primários iguais → coletor → megafone de boca larga' },
          { valor: '2em1', rotulo: '2 em 1', titulo: 'Norton, aviação: primários → coletor → abafador' },
          { valor: 'duplo', rotulo: 'Duplo', titulo: 'Ro80, Cosmo 110S: um downpipe por rotor → Y → dois silenciosos' },
        ]} atual={esc.tipo} aoEscolher={(v) => k.setEscape({ tipo: v })} />
      </Field>
      {esc.tipo === 'serie' && (
        <>
          <Field rotulo="Pré-silencioso">
            <ChipGroup id="presilencioso" opcoes={[{ valor: true, rotulo: 'Ligado' }, { valor: false, rotulo: 'Retirado', titulo: 'O que os donos fazem: o pulso de cada câmara sai inteiro, "brap"' }]} atual={esc.presilencioso} aoEscolher={(v) => k.setEscape({ presilencioso: v })} />
          </Field>
          <Field rotulo="Reator térmico (REAPS)">
            <ChipGroup id="reator" opcoes={[{ valor: false, rotulo: 'Sem' }, { valor: true, rotulo: 'Com', titulo: 'RX-3 1973+: câmara a 900 °C no lugar do coletor; queima os HC, os estouros caem à metade' }]} atual={!!esc.reator} aoEscolher={(v) => k.setEscape({ reator: v })} />
          </Field>
          <Field rotulo="Catalisador">
            <ChipGroup id="catEsc" opcoes={[{ valor: true, rotulo: 'Com' }, { valor: false, rotulo: 'Sem' }]} atual={!!esc.cat} aoEscolher={(v) => { k.setEscape({ cat: v }); k.setSpec({ cat: v }); }} />
          </Field>
          <Slider id="downpipe" rotulo="Downpipe" min={0.3} max={2} passo={0.05} valor={esc.downpipe?.L ?? 1} formatar={(v) => `${virgula(v, 2)} m`} aoSoltar={(v) => k.setEscape({ downpipe: { D: esc.downpipe?.D ?? 63.5, L: v } })} />
        </>
      )}
      <Slider id="Lp" rotulo="Primário (por rotor)" min={0.1} max={1.2} passo={0.01} valor={esc.Lp} formatar={(v) => `${virgula(v, 2)} m`} aoSoltar={(v) => k.setEscape({ Lp: v })} />
      <Slider id="Dp" rotulo="Ø do primário" min={30} max={80} passo={1} valor={esc.Dp ?? 50} formatar={(v) => `${v} mm`} aoSoltar={(v) => k.setEscape({ Dp: v })} />
      {esc.tipo !== 'megafone' && (
        <Field rotulo="Abafador">
          <ChipGroup id="muffler" opcoes={[{ valor: 'straight', rotulo: 'Direto' }, { valor: 'sport', rotulo: 'Esportivo' }, { valor: 'stock', rotulo: 'Original' }, { valor: 'classic', rotulo: 'Original antigo' }]}
            atual={s.muffler} aoEscolher={(v) => k.setSpec({ muffler: v })} />
        </Field>
      )}
      <Slider id="Dsaida" rotulo="Ø da saída" min={20} max={130} passo={1} valor={esc.saidas[0]?.D ?? 63.5} formatar={(v) => `${v} mm`}
        aoSoltar={(v) => k.setEscape({ saidas: esc.saidas.map((x) => ({ ...x, D: v })) })} />
      <Slider id="Dtip" rotulo="Ponteira (jato)" min={20} max={130} passo={1} valor={esc.ponteira ?? esc.saidas[0]?.D ?? 63.5} formatar={(v) => `${v} mm`}
        aoSoltar={(v) => k.setEscape({ ponteira: v })} />
      {esc.tipo !== 'megafone' && (
        <Field rotulo="Saídas">
          <ChipGroup id="saidas" classe="num" opcoes={[1, 2].map((n) => ({ valor: n, rotulo: String(n) }))} atual={saidas}
            aoEscolher={(n) => { const s0 = esc.saidas[0] || { L: 3, D: 63.5, phi: 30 }; k.setEscape({ saidas: n === 1 ? [{ ...s0, phi: 30 }] : [{ ...s0, phi: 20 }, { ...s0, L: s0.L * 1.01, phi: 160 }] }); }} />
        </Field>
      )}
    </Section>
  );
}

function Acessorios({ k, e }: P) {
  const s = e.spec, vm = s.valve || 'none', ts = s.twoStep === true ? 'cut' : s.twoStep || 'off';
  return (
    <Section titulo="Acessórios">
      <Field rotulo="Escape ativo (válvula)">
        <ChipGroup id="valve" opcoes={[{ valor: 'none', rotulo: 'Sem' }, { valor: 'closed', rotulo: 'Silencioso' }, { valor: 'auto', rotulo: 'Normal' }, { valor: 'sport', rotulo: 'Esportivo' }, { valor: 'open', rotulo: 'Pista' }]} atual={vm} aoEscolher={(v) => k.setValve(v)} />
      </Field>
      <Field rotulo="Ressonador">
        <ChipGroup id="reso" opcoes={[{ valor: false, rotulo: 'Sem' }, { valor: true, rotulo: 'Com' }]} atual={!!s.reso} aoEscolher={(v) => k.setSpec({ reso: v })} />
      </Field>
      {e.presetId === 'rx7fd' || ts !== 'off' ? (
        <Field rotulo="2-step (preparações do FD)">
          <ChipGroup id="twoStep" opcoes={[{ valor: 'off', rotulo: 'Desligado' }, { valor: 'cut', rotulo: 'Corte' }]} atual={ts} aoEscolher={(v) => k.setSpec({ twoStep: v }, { structural: false })} />
        </Field>
      ) : null}
      <p className="note">A válvula e o ressonador são os do Ronco; o escape do rotativo não os usa sem preparação.</p>
    </Section>
  );
}

function Estalos({ k, e }: P) {
  const s = e.spec;
  return (
    <Section titulo="Estalos no escape">
      <Field rotulo="Mapa na desaceleração">
        <ChipGroup id="overrun" opcoes={[
          { valor: 'cut', rotulo: 'Corta a injeção' }, { valor: 'lean', rotulo: 'Sem corte (carburador)' }, { valor: 'burble', rotulo: 'Crepitar de fábrica' }, { valor: 'popbang', rotulo: 'Pop & bang' },
          { valor: 'antilag', rotulo: 'Antilag', desabilitado: !s.turbo },
        ]} atual={s.overrun || 'cut'} aoEscolher={(v) => k.setSpec({ overrun: v }, { structural: false })} />
      </Field>
      <Field rotulo="Catalisador">
        <ChipGroup id="cat" opcoes={[{ valor: true, rotulo: 'Com' }, { valor: false, rotulo: 'Sem' }]} atual={s.cat !== false} aoEscolher={(v) => k.setSpec({ cat: v }, { structural: false })} />
      </Field>
      <Slider id="fHCextra" rotulo="Pós-queima extra (HC no escape)" min={0} max={0.1} passo={0.005} valor={s.fHCextra || 0} formatar={pct} aoMudar={(v) => k.setSpec({ fHCextra: v }, { structural: false, render: false })} />
      <p className="note">O Wankel manda 3–5× mais HC ao escape que um pistão (a chama apaga nas vedações e nos cantos da câmara): em lenta ~8% do calor queima no escape, o "chiado quente" de cada pulso; com a mistura crua de uma falha, estoura.</p>
    </Section>
  );
}

function Admissao({ k, e }: P) {
  const s = e.spec, t = s.turbo;
  return (
    <Section titulo="Admissão">
      <Field rotulo="Aspiração">
        <ChipGroup id="asp" opcoes={[{ valor: 'na', rotulo: 'Aspirado' }, { valor: 'turbo', rotulo: 'Turbo' }]} atual={t ? 'turbo' : 'na'} aoEscolher={(v) => (v === 'turbo' ? k.setTurbo({}) : k.semTurbo())} />
      </Field>
      {t && (
        <>
          <Slider id="boost" rotulo="Pressão máxima" min={0.2} max={1.5} passo={0.05} valor={t.boost} formatar={(v) => `${virgula(v, 2)} bar`} aoSoltar={(v) => k.setTurbo({ boost: v })} />
          <Field rotulo="Turbo sequencial">
            <ChipGroup id="sequencial" opcoes={[{ valor: true, rotulo: 'Ligado', titulo: 'Primário pequeno até a troca; o secundário entra com o "soluço" de 0,1–0,2 bar' }, { valor: false, rotulo: 'Desligado' }]} atual={!!t.sequencial} aoEscolher={(v) => k.setTurbo({ sequencial: v })} />
          </Field>
          {t.sequencial && <Slider id="trocaRpm" rotulo="Rotação da troca" min={3000} max={6000} passo={50} valor={t.trocaRpm ?? 4500} formatar={(v) => `${br(v)} rpm`} aoSoltar={(v) => k.setTurbo({ trocaRpm: v })} />}
        </>
      )}
      <Field rotulo="Entrada de ar">
        <ChipGroup id="intake" opcoes={[{ valor: 'airbox', rotulo: 'Caixa de ar' }, { valor: 'sport', rotulo: 'Filtro esportivo' }]} atual={s.intake === 'sport' ? 'sport' : 'airbox'} aoEscolher={(v) => k.setSpec({ intake: v })} />
      </Field>
    </Section>
  );
}

function Palhetas({ k, e }: P) {
  const pa = e.spec.palhetas!, p = e.pal, cfg = pa[p.modo];
  return (
    <Section titulo="Motor de palhetas (aproximação)">
      <Field rotulo="Uso">
        <ChipGroup id="modoPal" opcoes={[{ valor: 'ferramenta', rotulo: 'Ferramenta (retífica)' }, { valor: 'arranque', rotulo: `Motor de arranque a ar (${pa.arranque.hospedeiro.nome})` }]} atual={p.modo} aoEscolher={(v) => k.setPal({ modo: v as any })} />
      </Field>
      <p className="note mono">{cfg.z} palhetas · livre {br(cfg.nLivre)} rpm · {virgula(cfg.potencia, 1)} kW{p.modo === 'arranque' ? ` · redução ${pa.arranque.reducao}:1` : ''}</p>
      <Slider id="pIn" rotulo="Pressão do ar" min={3} max={8} passo={0.1} valor={p.pIn} formatar={(v) => `${virgula(v, 1)} bar`} aoMudar={(v) => k.setPal({ pIn: v })} />
      {p.modo === 'ferramenta' && (
        <Slider id="cargaPal" rotulo="Carga da ferramenta" min={0} max={1} passo={0.01} valor={p.carga} formatar={pct} aoMudar={(v) => k.setPal({ carga: v })} />
      )}
      <p className="note">{p.modo === 'ferramenta'
        ? 'Abra o ar (I) e aperte o gatilho (W ou o pedal): solta, a ferramenta vai à rotação livre em ~0,4 s; com carga a rotação cai e o tom de palheta desce.'
        : 'Dar a partida engata o pinhão e solta o ar: o motor de palhetas gira o diesel, as compressões dele modulam o som; ao pegar, o pinhão solta com um estalo.'}</p>
    </Section>
  );
}
