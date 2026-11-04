// Página do Radial (motores radiais: aviões, helicóptero, Sherman, Monaco-Trossi, Megola).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../ui/estilo.css';
import { PaginaRadial } from './PaginaRadial';

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <PaginaRadial />
  </StrictMode>,
);
