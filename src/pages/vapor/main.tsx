// Página do Vapor (locomotivas, estacionárias, trator, Stanley, barco).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../ui/estilo.css';
import './vapor.css';
import { PaginaVapor } from './PaginaVapor';

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <PaginaVapor />
  </StrictMode>,
);
