// Ponto de entrada do worklet dos Rotativos. A página importa este arquivo com `?worker&url`; o Vite o compila, com o
// RotativoDSP (com o EngineDSP do Ronco), o PalhetasDSP e o src/acoustics/, num bundle próprio para `audioWorklet.addModule`.
// 'rotativo-engine' é o da página (RotativosDSP: Wankel, X-Engine ou palhetas pela configuração); 'palhetas-engine', só
// o motor de palhetas.
import { registrarProcessador } from './registrar';
import { RotativosDSP } from '../engines/rotativo/rotativos';
import { PalhetasDSP } from '../engines/rotativo/palhetas';

registrarProcessador('rotativo-engine', (fs) => new RotativosDSP(fs));
registrarProcessador('palhetas-engine', (fs) => new PalhetasDSP(fs));
