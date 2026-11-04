// Teclado do Radial. Aviões e helicóptero: manete de potência como a da Turbina (W / ↑ avança e S / ↓ recua enquanto
// seguradas, 1–4 posições: lenta, cruzeiro, subida, decolagem; PageUp/PageDown com o foco na manete). Tanque, carro e
// moto: W / ↑ / Espaço pedal (Shift: meio pé), Q / E câmbio. Todos: I partida em fases (energizar, engatar, magnetos,
// desligar) · M magnetos · [ e ] mistura · , e . manete de passo · C microfone.
import { useEffect } from 'react';
import { POSICOES_MANETE, type ControleRadial } from './controle';

const PEDAL = ['KeyW', 'ArrowUp', 'Space'];
const POSICAO: Record<string, number> = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 };

export function usarTeclado(k: ControleRadial) {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLInputElement | null;
      if (alvo && alvo.tagName === 'INPUT' && alvo.type === 'text') return;
      if (k.comManete) {
        if (e.code === 'KeyW' || e.code === 'ArrowUp') { e.preventDefault(); k.teclas.up = 1; return; }
        if (e.code === 'KeyS' || e.code === 'ArrowDown') { e.preventDefault(); k.teclas.down = 1; return; }
        if (!e.repeat && e.code in POSICAO) { k.setManete(POSICOES_MANETE[POSICAO[e.code]][0]); return; }
      } else if (PEDAL.includes(e.code)) { e.preventDefault(); if (!k.audio) return; k.input.key = 1; k.input.half = e.shiftKey; k.sendInput(); return; }
      if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !k.comManete) { k.input.half = true; k.sendInput(); return; }
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
      if (e.code === 'KeyW' || e.code === 'ArrowUp') k.teclas.up = 0;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') k.teclas.down = 0;
      if (PEDAL.includes(e.code)) { k.input.key = 0; if (!k.comManete) k.sendInput(); }
      else if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !k.comManete) { k.input.half = false; k.sendInput(); }
    };
    const blur = () => { k.teclas.up = 0; k.teclas.down = 0; k.input.key = 0; k.input.pad = 0; k.sendInput(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, [k]);
}
