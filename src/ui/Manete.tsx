// Manete de potência (a da Turbina): alavanca que fica onde o usuário a deixa, ao contrário do pedal, que volta a zero ao
// soltar. Arrasta com o ponteiro no trilho; PageUp/PageDown com o foco nela movem um passo; as marcas mostram as posições
// (lenta, subida, decolagem…). As teclas que a movem aos poucos enquanto seguradas (W/S, ↑/↓) ficam com a página: ela
// chama `segurarManete` a cada quadro.
import { useRef } from 'react';
import './manete.css';

/** marca no trilho: valor, rótulo e uma classe opcional (a Turbina pinta a pós-combustão com `ab`) */
export type MarcaManete = [valor: number, rotulo: string, classe?: string];

export type ManeteProps = {
  /** posição atual, de 0 a `max` */
  valor: number;
  /** fim do curso (1 = 100%; a Turbina vai a 1,3 com a pós-combustão) */
  max?: number;
  marcas: MarcaManete[];
  /** posição pedida (o chamador limita ao curso) */
  aoMudar: (v: number) => void;
  /** posição de agora, lida na hora da tecla (padrão: `valor`) */
  obter?: () => number;
  /** passo de PageUp/PageDown */
  passo?: number;
  rotulo?: string;
};

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/** quanto do curso por segundo a manete anda com a tecla segurada (o da Turbina) */
export const VELOCIDADE_MANETE = 0.45;

/** move a manete enquanto as teclas estão seguradas (chamado a cada quadro, `dt` em s); devolve a posição nova ou null */
export function segurarManete(teclas: { up: number; down: number }, valor: number, dt: number): number | null {
  if (!teclas.up && !teclas.down) return null;
  return valor + (teclas.up - teclas.down) * dt * VELOCIDADE_MANETE;
}

export function Manete({ valor, max = 1, marcas, aoMudar, obter, passo = 0.1, rotulo = 'Manete de potência' }: ManeteProps) {
  const trilho = useRef<HTMLDivElement>(null);
  const agora = () => (obter ? obter() : valor);
  const mover = (e: { clientY: number }) => {
    if (!trilho.current) return;
    const r = trilho.current.getBoundingClientRect();
    aoMudar(clamp(1 - (e.clientY - r.top) / r.height, 0, 1) * max);
  };
  return (
    <div className="lever" id="lever" role="slider" tabIndex={0} aria-label={rotulo} aria-valuemin={0} aria-valuemax={Math.round(max * 100)} aria-valuenow={Math.round(valor * 100)}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); mover(e); }}
      onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) mover(e); }}
      onKeyDown={(e) => { if (e.code === 'PageUp') aoMudar(agora() + passo); else if (e.code === 'PageDown') aoMudar(agora() - passo); }}>
      <div className="lever-track" ref={trilho}><div className="lever-fill" id="leverFill" style={{ height: `${(valor / max) * 100}%` }} /></div>
      <div className="lever-marks" id="leverMarks">
        {marcas.map(([v, r, classe]) => <span key={r} className={classe || ''} style={{ bottom: `${(v / max) * 100}%` }}>{r}</span>)}
      </div>
      <div className="lever-knob" id="leverKnob" style={{ bottom: `calc(10px + (100% - 20px) * ${valor / max})` }} />
    </div>
  );
}
