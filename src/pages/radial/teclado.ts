// Teclado do Radial: o comum das páginas a pistão (src/pages/comum/teclado.ts). Aviões e helicóptero: a manete de
// potência como a da Turbina (W / ↑ avança e S / ↓ recua enquanto seguradas, 1–4 posições: lenta, cruzeiro, subida,
// decolagem; PageUp/PageDown com o foco na manete). Tanque, carro e moto: W / ↑ / Espaço pedal (Shift: meio pé), Q / E
// câmbio, sem freio. Todos: I partida em fases (energizar, engatar, magnetos, desligar) · C microfone, e os do radial:
// M magnetos · [ e ] mistura · , e . manete de passo.
import { usarTeclado as usarTecladoPistao } from '../comum/teclado';
import type { ControleRadial } from './controle';

export function usarTeclado(k: ControleRadial) {
  usarTecladoPistao(k, {
    nome: 'Radial',
    tecla: (e) => {
      if (e.code === 'KeyM') k.cycleMagnetos();
      else if (e.code === 'BracketLeft') k.stepMistura(-0.05);
      else if (e.code === 'BracketRight') k.stepMistura(0.05);
      else if (e.code === 'Comma') k.setAv({ rpmAlvo: Math.max(0, k.estado.av.rpmAlvo - 0.05) });
      else if (e.code === 'Period') k.setAv({ rpmAlvo: Math.min(1, k.estado.av.rpmAlvo + 0.05) });
    },
  });
}
