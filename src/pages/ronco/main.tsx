// Página do Ronco (pistão a gasolina: carros e motos).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../ui/estilo.css';
import './ronco.css';
import { PaginaRonco } from './PaginaRonco';

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <PaginaRonco />
  </StrictMode>,
);
