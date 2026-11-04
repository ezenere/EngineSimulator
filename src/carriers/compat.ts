// Tabela de compatibilidade motor × portador (CENA.md 1.6). Regra do produto: só se ouve cada motor
// nos portadores onde ele foi usado de verdade; "possível, sem preset na etapa 1" entra como
// compatível (a combinação existe), mas sem preset.
import type { FamiliaMotor, TipoPortador, Motor, MontagemMotor } from './tipos';
import type { FonteSonora, Vec3 } from '../scene/tipos';

export const COMPAT: Record<TipoPortador, readonly FamiliaMotor[]> = {
  carro: ['pistao', 'diesel', 'radial', 'rotativo', 'vapor', 'eletrico'],
  // (o jato puro não tem hélice: a linha "turbina / turboélice × hélice" de 1.6 é a do turboélice)
  helice: ['pistao', 'turboelice', 'radial', 'rotativo'],
  rotor: ['pistao', 'turboeixo', 'radial', 'rotativo', 'nenhum'],
  gerador: ['diesel', 'rotativo', 'vapor'],
  locomotiva: ['diesel', 'vapor'],
  trem: ['eletrico', 'nenhum'],
  aviao: ['turbina'],
  nenhum: ['pistao', 'turbina', 'turboelice', 'turboeixo', 'diesel', 'radial', 'rotativo', 'vapor', 'eletrico'],
};

/**
 * O que existe hoje (adaptadores de motor, docs/TECNICO.md): famílias com adaptador `Motor` e, por portador, os
 * motores de verdade que a Passagem monta. A Turbina não tem turboeixo (nenhum preset com `arch: 'turboeixo'`); o rotor
 * leva o pistão de aviação do Ronco (R22, R44, Bell 47, S300) ou o radial do S-55 (etapa 3), ou fica sem motor (`nenhum`).
 */
export const ADAPTADORES: readonly FamiliaMotor[] = ['nenhum', 'pistao', 'diesel', 'turboelice', 'turbina', 'radial', 'rotativo'];
export const USO_REAL: Record<TipoPortador, readonly FamiliaMotor[]> = {
  carro: ['pistao', 'diesel', 'radial', 'rotativo'], // carros e motos; picape, caminhão e ônibus; Sherman, Monaco-Trossi e Megola; Mazda, Ro80, Norton
  helice: ['turboelice', 'radial', 'pistao', 'rotativo'], // turboélices; radiais e motores planos de avião (RADIAL.md 5.3 e 6); Wankel de aviação e UAV (ROTATIVO.md 6.3)
  rotor: ['pistao', 'radial', 'rotativo', 'nenhum'], // R22, R44, Bell 47, S300 (pistão de aviação), S-55 (radial), Camcopter S-100 (AE50R); ou o rotor sozinho
  gerador: ['diesel', 'rotativo'],                 // grupos diesel; X-Engine (LiquidPiston, aproximação)
  locomotiva: ['diesel'],
  trem: ['nenhum'],
  aviao: ['turbina'],
  nenhum: [],
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
