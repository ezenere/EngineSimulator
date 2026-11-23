// Teclado do Diesel: o comum das páginas a pistão (src/pages/comum/teclado.ts: pedal, Shift meio pé, S / ↓ freio,
// E / PageUp e Q / PageDown câmbio, I ignição, C microfone) mais o que é do diesel:
//   M modo do automático · B escape ativo · V observador · J freio-motor (descarga, VGT, Jake, VEB)
//   locomotiva: 0–8 notch, + / − sobe e desce · gerador: 0–4 degrau de carga (0, 25, 50, 75, 100%)
import { usarTeclado as usarTecladoPistao } from '../comum/teclado';
import type { ControleDiesel } from './controle';

const FREIO = ['KeyS', 'ArrowDown'];
const DEGRAUS = [0, 0.25, 0.5, 0.75, 1];

export function usarTeclado(k: ControleDiesel, setFreio: (on: boolean) => void) {
  usarTecladoPistao(k, {
    nome: 'Diesel', freio: FREIO, aoFrear: setFreio,
    tecla: (e) => {
      const port = k.estado.portador;
      if (e.code === 'KeyM' && k.estado.spec.transmission === 'auto') k.cycleDriveMode();
      else if (e.code === 'KeyB') k.cycleValve();
      // a mesma condição que mostra o campo "Observador" no painel (Painel.tsx, Escuta): a via só existe com o veículo;
      // fora dele, a tecla só traz de volta quem já estava na via
      else if (e.code === 'KeyV' && (port === 'carro' || k.estado.observer === 'road')) k.setObserver(k.estado.observer === 'car' ? 'road' : 'car');
      else if (e.code === 'KeyJ') k.toggleFreio();
      else if (/^(Digit|Numpad)\d$/.test(e.code)) {
        const n = +e.code.slice(-1);
        if (port === 'locomotiva' && n <= 8) k.setNotch(n);
        else if (port === 'gerador' && n <= 4) k.setDegrau(DEGRAUS[n]);
      } else if (port === 'locomotiva' && (e.code === 'Equal' || e.code === 'NumpadAdd')) k.setNotch(k.estado.carga.notch + 1);
      else if (port === 'locomotiva' && (e.code === 'Minus' || e.code === 'NumpadSubtract')) k.setNotch(k.estado.carga.notch - 1);
    },
  });
}
