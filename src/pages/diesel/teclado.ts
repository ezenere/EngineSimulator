// Teclado do Diesel (o do Ronco, src/pages/ronco/teclado.ts, mais o que é do diesel):
//   W / ↑ / Espaço acelera (Shift: meio pé) · S / ↓ freia · E / PageUp e Q / PageDown câmbio · M modo do automático
//   B escape ativo · I ignição · C microfone · V observador · J freio-motor (descarga, VGT, Jake, VEB)
//   locomotiva: 0–8 notch, + / − sobe e desce · gerador: 0–4 degrau de carga (0, 25, 50, 75, 100%)
import { useEffect } from 'react';
import type { ControleDiesel } from './controle';

const THROTTLE_KEYS = ['KeyW', 'ArrowUp', 'Space'];
const DEGRAUS = [0, 0.25, 0.5, 0.75, 1];

export function usarTeclado(k: ControleDiesel, setFreio: (on: boolean) => void) {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLInputElement | null;
      if (alvo && alvo.tagName === 'INPUT' && alvo.type === 'text') return;
      const input = k.input, port = k.estado.portador;
      if (THROTTLE_KEYS.includes(e.code)) {
        e.preventDefault();
        if (!k.estado.ignicao && !k.audio) return;
        input.key = 1; input.half = e.shiftKey; k.sendInput();
      } else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { input.half = true; k.sendInput(); }
      else if (e.code === 'KeyS' || e.code === 'ArrowDown') { e.preventDefault(); input.brake = 1; k.sendInput(); setFreio(true); }
      else if (e.repeat) return;
      else if (e.code === 'KeyE' || e.code === 'PageUp') k.shift(1);
      else if (e.code === 'KeyQ' || e.code === 'PageDown') k.shift(-1);
      else if (e.code === 'KeyM' && k.estado.spec.transmission === 'auto') k.cycleDriveMode();
      else if (e.code === 'KeyB') k.cycleValve();
      else if (e.code === 'KeyI') k.toggleIgnition().catch((err) => console.error('Diesel: áudio não iniciou', err));
      else if (e.code === 'KeyC') k.nextMic();
      else if (e.code === 'KeyV') k.setObserver(k.estado.observer === 'car' ? 'road' : 'car');
      else if (e.code === 'KeyJ') k.toggleFreio();
      else if (/^(Digit|Numpad)\d$/.test(e.code)) {
        const n = +e.code.slice(-1);
        if (port === 'locomotiva' && n <= 8) k.setNotch(n);
        else if (port === 'gerador' && n <= 4) k.setDegrau(DEGRAUS[n]);
      } else if (port === 'locomotiva' && (e.code === 'Equal' || e.code === 'NumpadAdd')) k.setNotch(k.estado.carga.notch + 1);
      else if (port === 'locomotiva' && (e.code === 'Minus' || e.code === 'NumpadSubtract')) k.setNotch(k.estado.carga.notch - 1);
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
