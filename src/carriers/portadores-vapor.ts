// Montagem dos portadores do motor a vapor (docs/VAPOR.md 4.4) a partir da mensagem `portador` (o DSP da Cena e a
// página chamam a mesma função, para a geometria e as fontes saírem iguais nos dois lados).
//   locomotiva → LocomotivaVapor (composição)   gerador → Gerador (Corliss: rpm nominal, sem alternador)
//   trator → Trator   barco → Barco   carro → CarroDireto (Stanley)
import type { Portador, Motor } from './tipos';
import { LocomotivaVapor, type ConfigLocomotivaVapor } from './locomotiva-vapor';
import { Trator, type ConfigTrator } from './trator';
import { Barco, type ConfigBarco } from './barco';
import { CarroDireto, type ConfigCarroDireto } from './carro-direto';
import { Gerador } from './gerador';
import { configLocoVapor } from './locomotiva-vapor';
import { configTrator } from './trator';
import { configBarco } from './barco';
import { configCarroDireto } from './carro-direto';
import { presetVapor } from '../engines/vapor/presets';

export function montarPortadorVapor(tipo: string, c: Record<string, any>, motor: Motor, fs: number): Portador | null {
  let p: Portador | null = null;
  if (tipo === 'locomotiva') p = new LocomotivaVapor(fs, c as ConfigLocomotivaVapor, motor.fontes.length);
  else if (tipo === 'trator') p = new Trator(fs, c as ConfigTrator);
  else if (tipo === 'barco') p = new Barco(fs, c as ConfigBarco);
  else if (tipo === 'carro') p = new CarroDireto(fs, c as ConfigCarroDireto);
  else if (tipo === 'gerador') p = new Gerador(fs, c);
  if (!p) return null;
  p.acoplar(motor);
  return p;
}

/** (vapor) configuração do portador pelo preset da máquina (VAPOR.md 4.4) */
export function configPortadorVapor(portador: string, id: string | null, vagoes: number): Record<string, any> {
  const P = id ? presetVapor(id) : undefined;
  if (!P) return {};
  if (portador === 'locomotiva') return configLocoVapor(P, { vagoes });
  if (portador === 'trator') return configTrator(P);
  if (portador === 'barco') return configBarco(P);
  if (portador === 'carro') return configCarroDireto(P);
  if (portador === 'gerador') return { rpmNominal: P.rpmGovernado ?? 75, potenciaNominal: P.potenciaGerador ?? 500, eta: 0.95, J_alt: 50, semFontes: true, posMotor: [0, 0, 0], corpo: { comprimento: 12, largura: 6, altura: 6, massaSuperficial: 30 } };
  return {};
}
