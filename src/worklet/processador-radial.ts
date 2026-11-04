// Ponto de entrada do worklet do Radial. A página importa este arquivo com `?worker&url`; o Vite o compila, com o
// RadialDSP (com o EngineDSP do Ronco), a aviação, a hélice e o src/acoustics/, num bundle próprio para `audioWorklet.addModule`.
import { registrarProcessador } from './registrar';
import { RadialDSP } from '../engines/radial/dsp';

registrarProcessador('radial-engine', (fs) => new RadialDSP(fs));
