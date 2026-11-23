// Peças do palco das páginas a pistão (a barra de presets e os instrumentos em volta do conta-giros):
//  - a navegação de famílias e presets;
//  - o comando de potência na tela: o pedal (volta a zero ao soltar; arrasta com o ponteiro) e a manete de potência dos
//    aviões e helicópteros (a da Turbina, src/ui/Manete.tsx: fica onde foi deixada), com os botões das posições (teclas
//    1–4). O pedal se registra no controle (`k.pedal`, `k.pedalFill`) para `sendInput` escrever o preenchimento direto no
//    DOM, fora do React;
//  - o botão do freio;
//  - os medidores de balanceamento da leitura do ciclo de ignição.
import { useEffect, useRef, useSyncExternalStore, type PointerEvent } from 'react';
import { FamilyNav, Manete, PresetNav, dec, type Familia, type PresetResumo } from '../../ui';
import { clamp, MARCAS_MANETE, POSICOES_MANETE, type ControlePistao, type EstadoPistao } from './controle';

type K = ControlePistao<any, any, any>;

/** famílias e presets (a lista da página, com as famílias em `families`) */
export function NavDePresets<P extends PresetResumo>({ k, e, presets }: { k: K; e: EstadoPistao<any, any>; presets: P[] & { families: Familia[] } }) {
  return (
    <nav className="presets" id="presets" aria-label="Motores prontos">
      <FamilyNav familias={presets.families} presets={presets} atual={e.familia} aoEscolher={(id) => k.setFamilia(id)} />
      <PresetNav presets={presets} familia={e.familia} atual={e.presetId} aoEscolher={(p) => k.loadPreset(p)} />
    </nav>
  );
}

/** pedal: `rotulo` escrito nele, `nome` para o leitor de tela (padrão: o rótulo), `aoSoltar` o que soltar faz */
export function Pedal({ k, rotulo, nome = rotulo, aoSoltar }: { k: K; rotulo: string; nome?: string; aoSoltar?: () => void }) {
  const pedal = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  useEffect(() => {
    k.pedal = pedal.current; k.pedalFill = fill.current;
    return () => { k.pedal = null; k.pedalFill = null; };
  }, [k]);
  const padFrom = (ev: PointerEvent) => { const r = pedal.current!.getBoundingClientRect(); return clamp(1 - (ev.clientY - r.top) / r.height, 0, 1); };
  const solta = aoSoltar ?? (() => { k.input.pad = 0; k.sendInput(); });
  return (
    <div className="pedal" id="pedal" ref={pedal} role="slider" tabIndex={0} aria-label={nome} aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}
      onPointerDown={(ev) => { pedal.current!.setPointerCapture(ev.pointerId); k.input.pad = padFrom(ev); k.sendInput(); }}
      onPointerMove={(ev) => { if (pedal.current!.hasPointerCapture(ev.pointerId)) { k.input.pad = padFrom(ev); k.sendInput(); } }}
      onPointerUp={solta} onPointerCancel={solta}>
      <div className="pedal-fill" id="pedalFill" ref={fill} />
      <span className="pedal-label">{rotulo}</span>
    </div>
  );
}

/** botão do freio (segure); `aceso` e `aoFrear` são o estado da página, que o teclado também acende e apaga */
export function BotaoDoFreio({ k, aceso, aoFrear }: { k: K; aceso: boolean; aoFrear: (on: boolean) => void }) {
  const freia = (on: boolean) => { k.input.brake = on ? 1 : 0; k.sendInput(); aoFrear(on); };
  return (
    <button type="button" className={`key wide${aceso ? ' on' : ''}`} id="brakeBtn" title="Freio (segure)"
      onPointerDown={() => freia(true)} onPointerUp={() => freia(false)} onPointerLeave={() => freia(false)} onPointerCancel={() => freia(false)}>S · freio</button>
  );
}

/** manete de potência (a da Turbina): só ela re-renderiza quando a posição muda */
export function ManeteDePotencia({ k }: { k: K }) {
  const v = useSyncExternalStore(k.assinarManete, k.obterManete);
  return <Manete valor={v} marcas={MARCAS_MANETE} aoMudar={(x) => k.setManete(x)} obter={() => k.manete} passo={0.1} rotulo="Manete de potência" />;
}

/** posições da manete (teclas 1–4) */
export function PosicoesDaManete({ k }: { k: K }) {
  const v = useSyncExternalStore(k.assinarManete, k.obterManete);
  return (
    <div className="gearbox detentes" id="detents">
      {POSICOES_MANETE.map(([x, , texto]) => (
        <button key={texto} type="button" className={`key wide${Math.abs(x - v) < 0.01 ? ' at' : ''}`} data-manete={x} onClick={() => k.setManete(x)}>{texto}</button>
      ))}
    </div>
  );
}

export const DICA_BALANCO = 'Desbalanceamento das massas alternativas, em múltiplos de um cilindro. Zero = cancelamento perfeito.';

/** balanceamento das massas alternativas, em múltiplos de um cilindro: um medidor por [nome, valor, dica]; a barra
 *  enche em N/2 cilindros (no mínimo 2); `eZero` diz quando o valor conta como cancelamento perfeito */
export function Balanco({ itens, N, eZero = (v) => v === 0 }: { itens: [string, number, string][]; N: number; eZero?: (v: number) => boolean }) {
  return (
    <div className="balance" id="balance">
      {itens.map(([kk, v, dica]) => {
        const w = clamp(v / Math.max(2, N * 0.5), 0, 1) * 100;
        return (
          <div key={kk} className="bal" title={dica}>
            <span className="k">{kk}</span>
            <div className="meter"><i className={eZero(v) ? 'zero' : ''} style={{ width: `${w}%` }} /></div>
            <span className="val">{eZero(v) ? 'zero' : dec(v, 2)}</span>
          </div>
        );
      })}
    </div>
  );
}
