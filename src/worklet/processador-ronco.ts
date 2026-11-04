// Ponto de entrada do worklet do Ronco. A página importa este arquivo com `?worker&url`; o Vite o
// compila, com o DSP e o src/acoustics/, num bundle próprio para `audioWorklet.addModule`.
import { registrarProcessador } from './registrar';
import { EngineDSP } from '../engines/ronco/dsp';

registrarProcessador('ronco-engine', (fs) => new EngineDSP(fs));
