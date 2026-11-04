// Página da Turbina (jatos e turboélices).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../ui/estilo.css';
import '../../ui/turbina.css';
import { PaginaTurbina } from './Turbina';

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <PaginaTurbina />
  </StrictMode>,
);
