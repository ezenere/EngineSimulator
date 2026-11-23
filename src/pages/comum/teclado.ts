// Teclado comum das páginas a pistão (os listeners de window em src/app.js), na ordem em que cada tecla é vista:
//   num campo de texto (a ordem de ignição digitada), nada;
//   com a manete de potência (aviões e helicópteros): W / ↑ avança e S / ↓ recua enquanto seguradas, 1–4 posições
//   (lenta, cruzeiro, subida, decolagem), Espaço não faz nada;
//   W / ↑ / Espaço pedal (com Shift, meio pé) · Shift meio pé · a tecla do freio, onde a página tem;
//   e, sem repetição: E / PageUp sobe marcha · Q / PageDown reduz · I ignição · C próximo microfone, e as teclas da
//   família (`tecla`).
// Perder o foco da janela solta tudo o que estava seguro (pedal, freio, as teclas da manete); a manete fica onde está.
import { useEffect, useRef } from 'react';
import { POSICOES_MANETE, type ControlePistao } from './controle';

const PEDAL = ['KeyW', 'ArrowUp', 'Space'];
const POSICAO: Record<string, number> = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 };
const SHIFT = (code: string) => code === 'ShiftLeft' || code === 'ShiftRight';

export type OpcoesTeclado = {
  /** nome da página nas mensagens de erro do console */
  nome: string;
  /** as teclas que seguram o freio (nenhuma: a página não tem freio) */
  freio?: string[];
  /** acende e apaga o botão do freio na tela */
  aoFrear?: (on: boolean) => void;
  /** as teclas da família, sem repetição (as comuns já foram vistas) */
  tecla?: (e: KeyboardEvent) => void;
};

export function usarTeclado(k: ControlePistao<any, any, any>, opcoes: OpcoesTeclado) {
  // (as opções são lidas na hora de cada tecla: os ouvintes de window ficam os mesmos enquanto a página vive)
  const o = useRef(opcoes);
  o.current = opcoes;
  useEffect(() => {
    const freio = (code: string) => (o.current.freio ?? []).includes(code);
    const down = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLInputElement | null;
      if (alvo && alvo.tagName === 'INPUT' && alvo.type === 'text') return;
      const input = k.input;
      if (k.comManete) {
        if (e.code === 'KeyW' || e.code === 'ArrowUp') { e.preventDefault(); k.teclas.up = 1; return; }
        if (e.code === 'KeyS' || e.code === 'ArrowDown') { e.preventDefault(); k.teclas.down = 1; return; }
        if (e.code === 'Space') { e.preventDefault(); return; }
        if (!e.repeat && e.code in POSICAO) { k.setManete(POSICOES_MANETE[POSICAO[e.code]][0]); return; }
      }
      if (PEDAL.includes(e.code)) {
        e.preventDefault();
        if (!k.audio) return;
        input.key = 1; input.half = e.shiftKey; k.sendInput();
      } else if (SHIFT(e.code)) { input.half = true; k.sendInput(); }
      else if (freio(e.code)) { e.preventDefault(); input.brake = 1; k.sendInput(); o.current.aoFrear?.(true); }
      else if (e.repeat) return;
      else if (e.code === 'KeyE' || e.code === 'PageUp') k.shift(1);
      else if (e.code === 'KeyQ' || e.code === 'PageDown') k.shift(-1);
      else if (e.code === 'KeyI') k.toggleIgnition().catch((err) => console.error(`${o.current.nome}: áudio não iniciou`, err));
      else if (e.code === 'KeyC') k.nextMic();
      else o.current.tecla?.(e);
    };
    const up = (e: KeyboardEvent) => {
      const input = k.input;
      if (e.code === 'KeyW' || e.code === 'ArrowUp') k.teclas.up = 0;
      if (e.code === 'KeyS' || e.code === 'ArrowDown') k.teclas.down = 0;
      if (PEDAL.includes(e.code)) { input.key = 0; k.sendInput(); }
      else if (SHIFT(e.code)) { input.half = false; k.sendInput(); }
      else if (freio(e.code)) { input.brake = 0; k.sendInput(); o.current.aoFrear?.(false); }
    };
    // (o botão do freio na tela também se apaga: sem isso ele ficava aceso com o freio já solto)
    const blur = () => { k.teclas.up = 0; k.teclas.down = 0; k.input.key = 0; k.input.pad = 0; k.input.brake = 0; k.sendInput(); o.current.aoFrear?.(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, [k]);
}
