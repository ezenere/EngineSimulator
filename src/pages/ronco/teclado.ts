// Teclado do Ronco: o comum das páginas a pistão (src/pages/comum/teclado.ts: pedal, Shift meio pé, S / ↓ freio,
// E / PageUp e Q / PageDown câmbio, I ignição, C microfone, e a manete de potência na família aviação) mais
//   M modo do câmbio automático (na aviação, magnetos) · [ e ] mistura (aviação) · B escape ativo
//   V observador junto ao carro / parado na via
import { usarTeclado as usarTecladoPistao } from '../comum/teclado';
import type { ControleRonco } from './controle';

const FREIO = ['KeyS', 'ArrowDown'];

export function usarTeclado(k: ControleRonco, setFreio: (on: boolean) => void) {
  usarTecladoPistao(k, {
    nome: 'Ronco', freio: FREIO, aoFrear: setFreio,
    tecla: (e) => {
      if (e.code === 'KeyM' && k.estado.spec.aviation) k.cycleMagnetos();
      else if (e.code === 'BracketLeft') k.stepMistura(-0.05);
      else if (e.code === 'BracketRight') k.stepMistura(0.05);
      else if (e.code === 'KeyM' && k.estado.spec.transmission === 'auto') k.cycleDriveMode();
      else if (e.code === 'KeyB') k.cycleValve();
      else if (e.code === 'KeyV') k.setObserver(k.estado.observer === 'car' ? 'road' : 'car');
    },
  });
}
