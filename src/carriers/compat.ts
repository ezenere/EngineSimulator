// Tabela de compatibilidade motor × portador (CENA.md 1.6). Regra do produto: só se ouve cada motor
// nos portadores onde ele foi usado de verdade; "possível, sem preset na etapa 1" entra como
// compatível (a combinação existe), mas sem preset.
import type { FamiliaMotor, TipoPortador, Motor, MontagemMotor } from './tipos';
import type { FonteSonora, Vec3 } from '../scene/tipos';

export const COMPAT: Record<TipoPortador, readonly FamiliaMotor[]> = {
  carro: ['pistao', 'diesel', 'rotativo', 'vapor', 'eletrico'],
  helice: ['pistao', 'turboelice', 'turbina', 'radial', 'rotativo'],
  rotor: ['pistao', 'turboeixo', 'radial', 'nenhum'],
  gerador: ['diesel', 'vapor'],
  locomotiva: ['diesel', 'vapor'],
  trem: ['eletrico', 'nenhum'],
  nenhum: ['pistao', 'turbina', 'turboelice', 'turboeixo', 'diesel', 'radial', 'rotativo', 'vapor', 'eletrico'],
};

/** lança erro se a combinação não estiver na tabela 1.6 */
export function validarCompat(tipo: TipoPortador, motor: Motor | null) {
  const fam: FamiliaMotor = motor ? motor.familia : 'nenhum';
  if (!COMPAT[tipo].includes(fam)) throw new Error(`motor "${fam}" não é compatível com o portador "${tipo}" (tabela 1.6 do CENA.md)`);
}

/**
 * Fontes do motor no referencial do corpo (1.4): soma `posMotor` à posição e, se o motor está montado
 * para trás, espelha x da posição relativa e do eixo da diretividade. O escape é a exceção do próprio
 * CENA.md ("motor traseiro do Fusca: escape continua apontando para trás; admissão aponta para trás"):
 * o tubo sai pela traseira de qualquer jeito, então o eixo dele não é espelhado.
 */
export function fontesDoMotor(motor: Motor | null, m: MontagemMotor): FonteSonora[] {
  if (!motor) return [];
  const tras = m.rotMotor === 'tras';
  return motor.fontes.map((f) => {
    const p = f.pos, e = f.dir.eixo;
    const pos: Vec3 = tras ? [m.posMotor[0] - p[0], m.posMotor[1] + p[1], m.posMotor[2] + p[2]] : [m.posMotor[0] + p[0], m.posMotor[1] + p[1], m.posMotor[2] + p[2]];
    const eixo: Vec3 = tras && f.tipo !== 'escape' ? [-e[0], e[1], e[2]] : e;
    return { ...f, pos, dir: { ...f.dir, eixo } };
  });
}
