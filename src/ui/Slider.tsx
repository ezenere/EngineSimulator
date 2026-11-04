// Controle deslizante com rótulo e valor formatado (equivalente a slider() de app.js/jet-app.js).
// `aoMudar` dispara a cada movimento (evento input); `aoSoltar` só quando o usuário solta
// (evento change nativo; o onChange do React dispara a cada movimento, por isso o listener nativo).
import { useEffect, useRef, useState, type CSSProperties } from 'react';

export type SliderProps = {
  id: string;
  rotulo: string;
  min: number;
  max: number;
  passo: number;
  valor: number;
  formatar?: (v: number) => string;
  aoMudar?: (v: number) => void;
  aoSoltar?: (v: number) => void;
};

const semFormato = (v: number) => String(v);

export function Slider({ id, rotulo, min, max, passo, valor, formatar = semFormato, aoMudar, aoSoltar }: SliderProps) {
  const [v, setV] = useState(valor);
  const ref = useRef<HTMLInputElement>(null);
  const soltar = useRef(aoSoltar);
  soltar.current = aoSoltar;

  // valor novo vindo de fora (troca de preset, "Zerar"): o controle acompanha
  useEffect(() => { setV(valor); }, [valor]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onChange = () => soltar.current?.(+el.value);
    el.addEventListener('change', onChange);
    return () => el.removeEventListener('change', onChange);
  }, []);

  const p = `${((v - min) / (max - min)) * 100}%`;
  return (
    <div className="field">
      <label htmlFor={id}><span>{rotulo}</span><output htmlFor={id}>{formatar(v)}</output></label>
      <input
        ref={ref} type="range" id={id} min={min} max={max} step={passo} value={v}
        style={{ '--p': p } as CSSProperties}
        onInput={(e) => { const x = +(e.target as HTMLInputElement).value; setV(x); aoMudar?.(x); }}
        // o React exige onChange num input controlado; o trabalho fica no onInput acima
        onChange={() => {}}
      />
    </div>
  );
}
