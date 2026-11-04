// Página do Ronco (pistão a gasolina). Por enquanto, a casca da migração.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../ui/estilo.css';
import '../comum/casca.css';
import { PERFIL_RONCO } from '../../ui';
import { PRESETS_RONCO } from '../comum/legado';
import { Casca } from '../comum/Casca';

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <Casca logo="Ronco" perfil={PERFIL_RONCO} presets={PRESETS_RONCO} ouvinte="ext"
      legado={<>na branch <code>master</code> (página <code>index.html</code> antiga)</>} />
  </StrictMode>,
);
