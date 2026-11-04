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
