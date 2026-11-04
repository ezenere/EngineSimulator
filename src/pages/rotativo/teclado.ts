// Teclado dos Rotativos: W / ↑ / Espaço acelerador (gatilho nas palhetas; Shift: meio) · I ignição (ou o ar) ·
// Q / E câmbio · S freio · C microfone · B válvula do escape · M magnetos (aviação) · [ e ] carga das palhetas.
import { useEffect } from 'react';
import type { ControleRotativo } from './controle';

const PEDAL = ['KeyW', 'ArrowUp', 'Space'];

export function usarTeclado(k: ControleRotativo) {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLInputElement | null;
      if (alvo && alvo.tagName === 'INPUT' && alvo.type === 'text') return;
      if (PEDAL.includes(e.code)) { e.preventDefault(); if (!k.audio) return; k.input.key = 1; k.input.half = e.shiftKey; k.sendInput(); return; }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { k.input.half = true; k.sendInput(); return; }
      if (e.code === 'KeyS') { k.input.brake = 1; k.sendInput(); return; }
      if (e.repeat) return;
      if (e.code === 'KeyI') k.toggleIgnition().catch((err) => console.error('Rotativo: áudio não iniciou', err));
      else if (e.code === 'KeyE' || e.code === 'PageUp') k.shift(1);
      else if (e.code === 'KeyQ' || e.code === 'PageDown') k.shift(-1);
      else if (e.code === 'KeyC') k.nextMic();
      else if (e.code === 'KeyB') k.cycleValve();
      else if (e.code === 'KeyM') k.cycleMagnetos();
      else if (e.code === 'BracketLeft' && k.palhetas) k.setPal({ carga: Math.max(0, k.estado.pal.carga - 0.1) });
      else if (e.code === 'BracketRight' && k.palhetas) k.setPal({ carga: Math.min(1, k.estado.pal.carga + 0.1) });
    };
    const up = (e: KeyboardEvent) => {
      if (PEDAL.includes(e.code)) { k.input.key = 0; k.sendInput(); }
      else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { k.input.half = false; k.sendInput(); }
      else if (e.code === 'KeyS') { k.input.brake = 0; k.sendInput(); }
    };
    const blur = () => { k.input.key = 0; k.input.pad = 0; k.input.brake = 0; k.sendInput(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, [k]);
}
