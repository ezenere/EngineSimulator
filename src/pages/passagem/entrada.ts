// Mouse e toque da Passagem sobre a cena (sem three.js: funciona também sem WebGL, com a página só tocando).
//   mouse: um clique na cena trava o ponteiro (Pointer Lock) e o mouse passa a olhar; Esc solta. Sem Pointer Lock (o
//          navegador recusou), arrastar com o botão apertado olha;
//   toque: arrastar na cena olha; o controle de andar é o `Manche` (PaginaPassagem), que escreve em `c.toque`.
import type { ControlePassagem } from './controle';

/** rad por pixel: mouse travado, arrasto do mouse, arrasto do dedo */
const SENS_TRAVADO = 0.0022, SENS_ARRASTO = 0.004, SENS_TOQUE = 0.006;

export class EntradaCena {
  private c: ControlePassagem; private el: HTMLElement;
  private arrasto: { id: number; x: number; y: number; x0: number; y0: number; toque: boolean } | null = null;
  /** o ponteiro está travado na cena */
  travado = false;
  aoMudar: (() => void) | null = null;

  constructor(c: ControlePassagem, el: HTMLElement) {
    this.c = c; this.el = el;
    el.addEventListener('pointerdown', this.aoApertar);
    el.addEventListener('pointermove', this.aoMover);
    el.addEventListener('pointerup', this.aoSoltar);
    el.addEventListener('pointercancel', this.aoSoltar);
    document.addEventListener('pointerlockchange', this.aoTravar);
    document.addEventListener('mousemove', this.aoMoverTravado);
  }

  private aoApertar = (e: PointerEvent) => {
    if (this.travado) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.el.focus({ preventScroll: true });
    this.arrasto = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, toque: e.pointerType !== 'mouse' };
    try { this.el.setPointerCapture(e.pointerId); } catch { /* sem captura */ }
  };
  private aoMover = (e: PointerEvent) => {
    const a = this.arrasto; if (!a || a.id !== e.pointerId || this.travado) return;
    const k = a.toque ? SENS_TOQUE : SENS_ARRASTO;
    // (arrastar para a direita gira a cabeça para a direita: o rumo diminui)
    this.c.obs.olhar(-(e.clientX - a.x) * k, -(e.clientY - a.y) * k);
    a.x = e.clientX; a.y = e.clientY;
  };
  private aoSoltar = (e: PointerEvent) => {
    const a = this.arrasto; if (!a || a.id !== e.pointerId) return;
    this.arrasto = null;
    try { this.el.releasePointerCapture(e.pointerId); } catch { /* já solto */ }
    // um clique de mouse (sem arrastar) trava o ponteiro
    if (!a.toque && Math.hypot(e.clientX - a.x0, e.clientY - a.y0) < 4 && this.el.requestPointerLock) {
      try { const r = this.el.requestPointerLock() as unknown as Promise<void> | undefined; r?.catch?.(() => { /* recusado: fica o arrasto */ }); } catch { /* recusado */ }
    }
  };
  private aoTravar = () => { this.travado = document.pointerLockElement === this.el; this.aoMudar?.(); };
  private aoMoverTravado = (e: MouseEvent) => {
    if (!this.travado) return;
    this.c.obs.olhar(-e.movementX * SENS_TRAVADO, -e.movementY * SENS_TRAVADO);
  };

  descartar() {
    const el = this.el;
    el.removeEventListener('pointerdown', this.aoApertar);
    el.removeEventListener('pointermove', this.aoMover);
    el.removeEventListener('pointerup', this.aoSoltar);
    el.removeEventListener('pointercancel', this.aoSoltar);
    document.removeEventListener('pointerlockchange', this.aoTravar);
    document.removeEventListener('mousemove', this.aoMoverTravado);
    if (document.pointerLockElement === el) document.exitPointerLock?.();
  }
}
