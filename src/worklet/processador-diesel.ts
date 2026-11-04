// Ponto de entrada do worklet do Diesel. A página importa este arquivo com `?worker&url`; o Vite o
// compila, com o DieselDSP (com o EngineDSP do Ronco) e o src/acoustics/, num bundle próprio para `audioWorklet.addModule`.
import { registrarProcessador } from './registrar';
import { DieselDSP } from '../engines/diesel/dsp';

registrarProcessador('diesel-engine', (fs) => new DieselDSP(fs));
