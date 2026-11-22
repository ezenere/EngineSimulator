// Navegação do topo: famílias em cima, veículos da família embaixo (renderPresets() de app.js/jet-app.js).
// Cada linha é uma faixa que rola de lado: a ponta esmaece onde há mais itens, uma seta leva até eles, a roda do mouse
// rola a faixa e o item escolhido é trazido à vista.
import { useEffect, useRef, useState, type ReactNode } from 'react';

export type Familia = { id: string; name: string };
export type PresetResumo = { id: string; name: string; tag?: string; family: string };

type Rola = 'nao' | 'inicio' | 'meio' | 'fim';

/** Faixa de rolagem lateral com setas e pontas esmaecidas. `marca` muda quando o item escolhido muda. */
export function Faixa({ className, rotulo, marca, children }: { className: string; rotulo?: string; marca?: unknown; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [rola, setRola] = useState<Rola>('nao');
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => {
      const max = el.scrollWidth - el.clientWidth;
      setRola(max <= 1 ? 'nao' : el.scrollLeft <= 1 ? 'inicio' : el.scrollLeft >= max - 1 ? 'fim' : 'meio');
    };
    medir();
    el.addEventListener('scroll', medir, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(medir) : null;
    ro?.observe(el);
    // a roda (vertical) rola a faixa enquanto houver para onde ir; no fim, a página volta a rolar
    const roda = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 1 || (e.deltaY < 0 && el.scrollLeft <= 0) || (e.deltaY > 0 && el.scrollLeft >= max - 1)) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener('wheel', roda, { passive: false });
    return () => { el.removeEventListener('scroll', medir); el.removeEventListener('wheel', roda); ro?.disconnect(); };
  }, []);
  // o escolhido à vista quando ele muda (sem mexer na rolagem da página)
  useEffect(() => {
    const el = ref.current;
    const m = el?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!el || !m) return;
    const re = el.getBoundingClientRect(), rm = m.getBoundingClientRect();
    const a = rm.left - re.left + el.scrollLeft, b = a + rm.width;
    if (a < el.scrollLeft + 40) el.scrollLeft = Math.max(0, a - 40);
    else if (b > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = b - el.clientWidth + 40;
  }, [marca]);
  // a medida de novo quando o conteúdo muda (troca de família)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setRola(max <= 1 ? 'nao' : el.scrollLeft <= 1 ? 'inicio' : el.scrollLeft >= max - 1 ? 'fim' : 'meio');
  });
  const andar = (dir: number) => { const el = ref.current; if (el) el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.7), behavior: 'smooth' }); };
  return (
    <div className="faixa">
      {(rola === 'meio' || rola === 'fim') && <button type="button" className="seta esq" tabIndex={-1} aria-hidden="true" onClick={() => andar(-1)}>‹</button>}
      <div className={className} role="group" aria-label={rotulo} ref={ref} data-rola={rola} data-marca={marca === undefined ? undefined : String(marca)}>{children}</div>
      {(rola === 'meio' || rola === 'inicio') && <button type="button" className="seta dir" tabIndex={-1} aria-hidden="true" onClick={() => andar(1)}>›</button>}
    </div>
  );
}

export function FamilyNav({ familias, presets, atual, aoEscolher }: {
  familias: Familia[];
  presets: { family: string }[]; // para contar quantos veículos há em cada família
  atual: string;
  aoEscolher: (id: string) => void;
}) {
  return (
    <Faixa className="families" rotulo="Famílias" marca={atual}>
      {familias.map((f) => (
        <button key={f.id} type="button" className="fam" aria-pressed={f.id === atual} onClick={() => aoEscolher(f.id)}>
          <span>{f.name}</span><small>{presets.filter((p) => p.family === f.id).length}</small>
        </button>
      ))}
    </Faixa>
  );
}

export function PresetNav<P extends PresetResumo>({ presets, familia, atual, aoEscolher }: {
  presets: P[];
  familia: string;
  atual: string | null; // null: o usuário mexeu em algo e nenhum preset está marcado
  aoEscolher: (p: P) => void;
}) {
  return (
    <Faixa className="cars" rotulo="Presets da família" marca={`${familia}:${atual}`}>
      {presets.filter((p) => p.family === familia).map((p) => (
        <button key={p.id} type="button" className="preset" data-id={p.id} aria-pressed={p.id === atual} onClick={() => aoEscolher(p)}>
          <b>{p.name}</b><small>{p.tag}</small>
        </button>
      ))}
    </Faixa>
  );
}
