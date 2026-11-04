// Página do Elétrico (carros, trens e metrôs, bondes e trólebus, ferramentas, drone, motor industrial).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../ui/estilo.css';
import './eletrico.css';
import { PaginaEletrico } from './PaginaEletrico';

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <PaginaEletrico />
  </StrictMode>,
);
