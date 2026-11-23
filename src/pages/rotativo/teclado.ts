// Teclado dos Rotativos: o comum das páginas a pistão (src/pages/comum/teclado.ts: W / ↑ / Espaço acelerador, que nas
// palhetas é o gatilho, Shift meio, S / ↓ freio, Q / E câmbio, I ignição ou o ar, C microfone; nos presets de aviação,
// a manete de potência: W / ↑ e S / ↓ seguradas, 1–4 posições) mais B válvula do escape · M magnetos (aviação) · [ e ]
// carga das palhetas.
import { usarTeclado as usarTecladoPistao } from '../comum/teclado';
import type { ControleRotativo } from './controle';

const FREIO = ['KeyS', 'ArrowDown'];

export function usarTeclado(k: ControleRotativo, setFreio: (on: boolean) => void) {
  usarTecladoPistao(k, {
    nome: 'Rotativo', freio: FREIO, aoFrear: setFreio,
    tecla: (e) => {
      if (e.code === 'KeyB') k.cycleValve();
      else if (e.code === 'KeyM') k.cycleMagnetos();
      else if (e.code === 'BracketLeft' && k.palhetas) k.setPal({ carga: Math.max(0, k.estado.pal.carga - 0.1) });
      else if (e.code === 'BracketRight' && k.palhetas) k.setPal({ carga: Math.min(1, k.estado.pal.carga + 0.1) });
    },
  });
}
