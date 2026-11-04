// Ponto de entrada do worklet do Vapor. A página importa este arquivo com `?worker&url`; o Vite o compila, com o
// CenaDSP (que monta o portador a vapor e o VaporDSP: src/scene/dsp-cena.ts) e o src/acoustics/, num bundle próprio.
import { registrarProcessador } from './registrar';
import { CenaDSP } from '../scene/dsp-cena';

registrarProcessador('vapor', (fs) => new CenaDSP(fs));
