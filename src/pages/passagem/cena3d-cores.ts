// Cores das fontes por tipo (CENA.md 3.4, item 4), sem depender do three.js: o painel usa as mesmas
// cores da cena 3D, e a cena só é carregada sob demanda.
import type { TipoFonte } from '../../scene/tipos';

export const COR_TIPO: Record<TipoFonte, number> = {
  escape: 0xe5484d, admissao: 0x4c7ee8, mecanica: 0xf08c2e, compressor: 0xd6a03a, pa: 0x35c4d4,
  rolamento: 0xf2d544, aero: 0xf4f4f0, vao: 0xd450c8, pantografo: 0x48c26a, eletrica: 0x8fb3ff, pressao: 0x8a5cd6, vento: 0x9aa4b2,
};
