// Teclado do Vapor (VAPOR.md 6): W/S sobem e descem o regulador (0 → 100% em 1 s, seguradas) · X fecha o regulador ·
// A/D reverser (seguradas) · H apito SEGURÁVEL · B sino · E areia segurável · T torneiras · Espaço freio segurável ·
// I injetor. Ignora as teclas quando o foco está num campo de texto.
import { useEffect } from 'react';
import type { ControleVapor } from './controle';

export function usarTeclado(k: ControleVapor) {
  useEffect(() => {
    const campo = (e: KeyboardEvent) => { const a = e.target as HTMLInputElement | null; return !!a && a.tagName === 'INPUT' && a.type === 'text'; };
    const down = (e: KeyboardEvent) => {
      if (campo(e)) return;
      const c = e.code;
      if (c === 'KeyW' || c === 'ArrowUp') { e.preventDefault(); k.teclas.w = true; return; }
      if (c === 'KeyS' || c === 'ArrowDown') { e.preventDefault(); k.teclas.s = true; return; }
      if (c === 'KeyA' || c === 'ArrowLeft') { k.teclas.a = true; return; }
      if (c === 'KeyD' || c === 'ArrowRight') { k.teclas.d = true; return; }
      if (c === 'KeyH') { e.preventDefault(); k.apitar(true); return; }
      if (c === 'Space') { e.preventDefault(); k.frear(true); return; }
      if (c === 'KeyE') { k.areia(true); return; }
      if (e.repeat) return;
      if (c === 'KeyX') k.fecharRegulador();
      else if (c === 'KeyB') k.alternarSino();
      else if (c === 'KeyT') k.alternarTorneiras();
      else if (c === 'KeyI') k.alternarInjetor();
    };
    const up = (e: KeyboardEvent) => {
      const c = e.code;
      if (c === 'KeyW' || c === 'ArrowUp') k.teclas.w = false;
      else if (c === 'KeyS' || c === 'ArrowDown') k.teclas.s = false;
      else if (c === 'KeyA' || c === 'ArrowLeft') k.teclas.a = false;
      else if (c === 'KeyD' || c === 'ArrowRight') k.teclas.d = false;
      else if (c === 'KeyH') k.apitar(false);
      else if (c === 'Space') k.frear(false);
      else if (c === 'KeyE') k.areia(false);
    };
    // perder o foco solta tudo o que estava segurado (o apito não fica preso)
    const blur = () => { k.teclas.w = k.teclas.s = k.teclas.a = k.teclas.d = false; k.apitar(false); k.frear(false); k.areia(false); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, [k]);
}
