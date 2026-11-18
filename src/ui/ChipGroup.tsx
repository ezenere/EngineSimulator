// Grupo de botões de escolha única (equivalente a chipGroup() de app.js/jet-app.js).
import { useContext } from 'react';
import { RotuloDoCampo } from './Field';

export type OpcaoChip<T> = {
  valor: T;
  rotulo: string;
  sub?: string; // segunda linha (ex.: a ordem de ignição embaixo do nome)
  titulo?: string; // dica ao passar o mouse
  desabilitado?: boolean;
};

export type ChipGroupProps<T> = {
  id?: string;
  opcoes: OpcaoChip<T>[];
  atual: T;
  aoEscolher: (v: T) => void;
  classe?: string; // 'num', 'order'…
  rotulo?: string; // nome acessível do grupo (padrão: o rótulo do campo em volta)
};

export function ChipGroup<T>({ id, opcoes, atual, aoEscolher, classe = '', rotulo }: ChipGroupProps<T>) {
  const doCampo = useContext(RotuloDoCampo);
  return (
    <div className="chips" id={id} role="group" aria-label={rotulo ?? doCampo}>
      {opcoes.map((o) => (
        <button
          key={String(o.valor)} type="button" className={`chip ${classe}`}
          aria-pressed={o.valor === atual} title={o.titulo || undefined} disabled={o.desabilitado}
          onClick={() => aoEscolher(o.valor)}
        >
          {o.sub ? <><span>{o.rotulo}</span><small>{o.sub}</small></> : o.rotulo}
        </button>
      ))}
    </div>
  );
}
