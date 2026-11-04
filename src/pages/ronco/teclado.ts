// Teclado do Ronco (os listeners de window em src/app.js):
//   W / ↑ / Espaço acelera (com Shift, meio pé) · Shift meio pé · S / ↓ freia
//   E / PageUp sobe marcha · Q / PageDown reduz · M modo do câmbio automático · B escape ativo
//   I ignição · C próximo microfone · V observador junto ao carro / parado na via
// Perder o foco da janela solta acelerador, pedal e freio.
import { useEffect } from 'react';
import type { ControleRonco } from './controle';

const THROTTLE_KEYS = ['KeyW', 'ArrowUp', 'Space'];

export function usarTeclado(k: ControleRonco, setFreio: (on: boolean) => void) {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLInputElement | null;
      if (alvo && alvo.tagName === 'INPUT' && alvo.type === 'text') return;
      const input = k.input;
      if (THROTTLE_KEYS.includes(e.code)) {
        e.preventDefault();
        if (!k.estado.ignicao && !k.audio) return;
        input.key = 1; input.half = e.shiftKey; k.sendInput();
      } else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { input.half = true; k.sendInput(); }
      else if (e.code === 'KeyS' || e.code === 'ArrowDown') { e.preventDefault(); input.brake = 1; k.sendInput(); setFreio(true); }
      else if (e.repeat) return;
      else if (e.code === 'KeyE' || e.code === 'PageUp') k.shift(1);
      else if (e.code === 'KeyQ' || e.code === 'PageDown') k.shift(-1);
      else if (e.code === 'KeyM' && k.estado.spec.aviation) k.cycleMagnetos();
      else if (e.code === 'BracketLeft') k.stepMistura(-0.05);
      else if (e.code === 'BracketRight') k.stepMistura(0.05);
      else if (e.code === 'KeyM' && k.estado.spec.transmission === 'auto') k.cycleDriveMode();
      else if (e.code === 'KeyB') k.cycleValve();
      else if (e.code === 'KeyI') k.toggleIgnition().catch((err) => console.error('Ronco: áudio não iniciou', err));
      else if (e.code === 'KeyC') k.nextMic();
      else if (e.code === 'KeyV') k.setObserver(k.estado.observer === 'car' ? 'road' : 'car');
    };
    const up = (e: KeyboardEvent) => {
      const input = k.input;
      if (THROTTLE_KEYS.includes(e.code)) { input.key = 0; k.sendInput(); }
      else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { input.half = false; k.sendInput(); }
      else if (e.code === 'KeyS' || e.code === 'ArrowDown') { input.brake = 0; k.sendInput(); setFreio(false); }
    };
    const blur = () => { k.input.key = 0; k.input.pad = 0; k.input.brake = 0; k.sendInput(); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, [k, setFreio]);
}
