// Presets legados (src/presets.js, src/jet-presets.js) lidos pela casca React enquanto a migração
// não chega. Eles são scripts UMD: no `npm run dev` o Vite os serve como módulo sem `module`, e eles
// se registram em `self`; no build o Rolldown os vê como CommonJS e entrega `module.exports` como
// export default. Lemos dos dois jeitos. A próxima tarefa troca isto pelos presets em TypeScript.
import * as presetsRonco from '../../presets.js';
import * as presetsTurbina from '../../jet-presets.js';
import type { Familia, PresetResumo } from '../../ui';

type ListaLegada = PresetResumo[] & { families: Familia[] };

export const PRESETS_RONCO: ListaLegada = (presetsRonco as any).default ?? (self as any).ENGINE_PRESETS;
export const PRESETS_TURBINA: ListaLegada = (presetsTurbina as any).default ?? (self as any).JET_PRESETS;
