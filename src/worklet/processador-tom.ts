// Ponto de entrada do worklet de prova. A página importa este arquivo com `?worker&url`.
import { registrarProcessador } from './registrar';
import { TomDSP } from './tom';

registrarProcessador('prova-tom', (fs) => new TomDSP(fs));
