// Ponto de entrada do worklet da Cena (modo de testes e Passagem universal). A página importa este
// arquivo com `?worker&url` e cria o AudioWorkletNode 'cena' com 4 canais de saída.
import { registrarProcessador } from './registrar';
import { CenaDSP } from '../scene/dsp-cena';

registrarProcessador('cena', (fs) => new CenaDSP(fs));
