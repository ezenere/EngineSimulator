// Página do Diesel (ignição por compressão: picapes, caminhões, geradores, locomotivas).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../ui/estilo.css';
import { PaginaDiesel } from './PaginaDiesel';

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <PaginaDiesel />
  </StrictMode>,
);
