// Ponto de entrada do worklet da Turbina. A página importa este arquivo com `?worker&url`;
// o Vite compila ele, o DSP e src/acoustics/ num bundle próprio.
import { registrarProcessador } from './registrar';
import { JetDSP } from '../engines/turbina/dsp';

registrarProcessador('turbina-engine', (fs) => new JetDSP(fs));
