// Página Passagem / modo de testes.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../ui/estilo.css';
import './passagem.css';
import { PaginaPassagem } from './PaginaPassagem';

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <PaginaPassagem />
  </StrictMode>,
);
