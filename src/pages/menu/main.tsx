import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../../ui/estilo.css';
import './menu.css';
import { Menu } from './Menu';

createRoot(document.getElementById('raiz')!).render(<StrictMode><Menu /></StrictMode>);
