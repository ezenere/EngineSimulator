// Navegação do topo: famílias em cima, veículos da família embaixo (renderPresets() de app.js/jet-app.js).
export type Familia = { id: string; name: string };
export type PresetResumo = { id: string; name: string; tag?: string; family: string };

export function FamilyNav({ familias, presets, atual, aoEscolher }: {
  familias: Familia[];
  presets: PresetResumo[]; // para contar quantos veículos há em cada família
  atual: string;
  aoEscolher: (id: string) => void;
}) {
  return (
    <div className="families" role="group" aria-label="Famílias">
      {familias.map((f) => (
        <button key={f.id} type="button" className="fam" aria-pressed={f.id === atual} onClick={() => aoEscolher(f.id)}>
          <span>{f.name}</span><small>{presets.filter((p) => p.family === f.id).length}</small>
        </button>
      ))}
    </div>
  );
}

export function PresetNav<P extends PresetResumo>({ presets, familia, atual, aoEscolher }: {
  presets: P[];
  familia: string;
  atual: string | null; // null: o usuário mexeu em algo e nenhum preset está marcado
  aoEscolher: (p: P) => void;
}) {
  return (
    <div className="cars">
      {presets.filter((p) => p.family === familia).map((p) => (
        <button key={p.id} type="button" className="preset" data-id={p.id} aria-pressed={p.id === atual} onClick={() => aoEscolher(p)}>
          <b>{p.name}</b><small>{p.tag}</small>
        </button>
      ))}
    </div>
  );
}
