// Teclado dos Rotativos: o comum das páginas a pistão (src/pages/comum/teclado.ts: W / ↑ / Espaço acelerador, que nas
// palhetas é o gatilho, Shift meio, S freio, Q / E câmbio, I ignição ou o ar, C microfone) mais B válvula do escape ·
// M magnetos (aviação) · [ e ] carga das palhetas.
import { usarTeclado as usarTecladoPistao } from '../comum/teclado';
import type { ControleRotativo } from './controle';

const FREIO = ['KeyS'];

export function usarTeclado(k: ControleRotativo) {
  usarTecladoPistao(k, {
    nome: 'Rotativo', freio: FREIO,
    tecla: (e) => {
      if (e.code === 'KeyB') k.cycleValve();
      else if (e.code === 'KeyM') k.cycleMagnetos();
      else if (e.code === 'BracketLeft' && k.palhetas) k.setPal({ carga: Math.max(0, k.estado.pal.carga - 0.1) });
      else if (e.code === 'BracketRight' && k.palhetas) k.setPal({ carga: Math.min(1, k.estado.pal.carga + 0.1) });
    },
  });
}
