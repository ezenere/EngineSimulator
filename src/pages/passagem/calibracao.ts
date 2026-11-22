// Calibração do motor da Passagem (a sonda de nível absoluto e as calibrações de cada família, src/engines/*/motor.ts):
// uma função só, chamada pela página dentro de um Web Worker (calibracao.worker.ts) e, sem worker (Node, os testes),
// na hora. Rodar 1–9 s de sonda na thread principal travava a página ao carregar um preset com motor (AUDITORIA.md P-07).
import type { FamiliaMotor } from '../../carriers/tipos';
import { prepararMotorRonco } from '../../engines/ronco/motor';
import { prepararMotorDiesel, type UsoDiesel } from '../../engines/diesel/motor';
import { prepararMotorRadial } from '../../engines/radial/motor';
import { PRESETS_RADIAL, PADRAO_RADIAL } from '../../engines/radial/presets';
import { prepararMotorRotativo } from '../../engines/rotativo/motor';
import { PRESETS_ROTATIVO, PADRAO_ROTATIVO } from '../../engines/rotativo/presets';
import { PRESETS as PRESETS_RONCO, PRESETS_AVIACAO, ACESSORIOS_PADRAO } from '../../engines/ronco/presets';
import { PRESETS as PRESETS_DIESEL, PADRAO_DIESEL } from '../../engines/diesel/presets';
import { PRESETS_TURBINA } from '../../engines/turbina/presets';
import { PRESETS_ELETRICO } from '../../engines/eletrico/presets';
import { prepararMotorEletrico } from '../../engines/eletrico/motor';
import { prepararMotorVapor } from '../../engines/vapor/motor';
import { presetVapor } from '../../engines/vapor/presets';

/** pedido de calibração: família, preset, portador (o diesel calibra por uso) e taxa de amostragem */
export interface PedidoCalibracao { fam: FamiliaMotor; id: string; portador: string; fs: number }

/** cfg do motor pronto para o worklet: geometria, calibração e nível absoluto (caro: 1–9 s de sonda) */
export function calibrarMotor({ fam, id, portador, fs }: PedidoCalibracao): Record<string, any> {
  if (fam === 'pistao') return prepararMotorRonco({ ...ACESSORIOS_PADRAO, ...[...PRESETS_RONCO, ...PRESETS_AVIACAO].find((x) => x.id === id)! }, fs);
  if (fam === 'radial') return prepararMotorRadial({ ...PADRAO_RADIAL, ...PRESETS_RADIAL.find((x) => x.id === id)! }, fs);
  if (fam === 'rotativo') return prepararMotorRotativo({ ...PADRAO_ROTATIVO, ...PRESETS_ROTATIVO.find((x) => x.id === id)! }, fs);
  if (fam === 'diesel') return prepararMotorDiesel({ ...PADRAO_DIESEL, ...PRESETS_DIESEL.find((x) => x.id === id)! }, fs, portador as UsoDiesel);
  if (fam === 'eletrico') return prepararMotorEletrico(PRESETS_ELETRICO.find((x) => x.id === id)!, fs);
  if (fam === 'vapor') return prepararMotorVapor(presetVapor(id)!, fs) as unknown as Record<string, any>;
  return { ...PRESETS_TURBINA.find((x) => x.id === id)! };
}

/** a família calibra rápido o bastante para não precisar do worker (Turbina: só copia o preset) */
export const calibracaoInstantanea = (fam: FamiliaMotor) => fam === 'turbina' || fam === 'turboelice';
