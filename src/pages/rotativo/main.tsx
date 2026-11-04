// Página dos Rotativos (Wankel, X-Engine e motor de palhetas).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../ui/estilo.css';
import { PaginaRotativo } from './PaginaRotativo';

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <PaginaRotativo />
  </StrictMode>,
);
