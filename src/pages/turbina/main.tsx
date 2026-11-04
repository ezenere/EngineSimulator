// Página da Turbina (jatos e turboélices). Por enquanto, a casca da migração.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../ui/estilo.css';
import '../../ui/turbina.css';
import '../comum/casca.css';
import { PERFIL_TURBINA } from '../../ui';
import { PRESETS_TURBINA } from '../comum/legado';
import { Casca } from '../comum/Casca';

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <Casca logo="Turbina" perfil={PERFIL_TURBINA} presets={PRESETS_TURBINA} ouvinte="ground"
      legado={<>na página legada <a href="./jato.html">jato.html</a> (no <code>npm run dev</code> ou na branch <code>master</code>)</>} />
  </StrictMode>,
);
