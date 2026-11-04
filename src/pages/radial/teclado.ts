// Teclado do Radial: W / ↑ / Espaço manete (Shift: meia manete) · I partida em fases (energizar, engatar, magnetos,
// desligar) · M magnetos · [ e ] mistura · , e . manete de passo · Q / E câmbio (tanque, carro, moto) · C microfone.
import { useEffect } from 'react';
import type { ControleRadial } from './controle';

const MANETE = ['KeyW', 'ArrowUp', 'Space'];

export function usarTeclado(k: ControleRadial) {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLInputElement | null;
      if (alvo && alvo.tagName === 'INPUT' && alvo.type === 'text') return;
      if (MANETE.includes(e.code)) { e.preventDefault(); if (!k.audio) return; k.input.key = 1; k.input.half = e.shiftKey; k.sendInput(); return; }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { k.input.half = true; k.sendInput(); return; }
      if (e.repeat) return;
      if (e.code === 'KeyI') k.toggleIgnition().catch((err) => console.error('Radial: áudio não iniciou', err));
      else if (e.code === 'KeyM') k.cycleMagnetos();
      else if (e.code === 'BracketLeft') k.stepMistura(-0.05);
      else if (e.code === 'BracketRight') k.stepMistura(0.05);
      else if (e.code === 'Comma') k.setAv({ rpmAlvo: Math.max(0, k.estado.av.rpmAlvo - 0.05) });
      else if (e.code === 'Period') k.setAv({ rpmAlvo: Math.min(1, k.estado.av.rpmAlvo + 0.05) });
      else if (e.code === 'KeyE' || e.code === 'PageUp') k.shift(1);
      else if (e.code === 'KeyQ' || e.code === 'PageDown') k.shift(-1);
      else if (e.code === 'KeyC') k.nextMic();
    };
    const up = (e: KeyboardEvent) => {
      if (MANETE.includes(e.code)) { k.input.key = 0; k.sendInput(); }
      else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { k.input.half = false; k.sendInput(); }
    };
    const blur = () => { k.input.key = 0; k.input.pad = 0; k.sendInput(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, [k]);
}
