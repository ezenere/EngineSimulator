// Ponto de entrada do worklet do Elétrico. A página importa este arquivo com `?worker&url`; o Vite o compila, com a Cena,
// os portadores e o EletricoDSP, num bundle próprio para `audioWorklet.addModule`.
import { registrarProcessador } from './registrar';
import { DSPEletricoPagina } from '../engines/eletrico/pagina';

registrarProcessador('eletrico-engine', (fs) => new DSPEletricoPagina(fs));
