// Prova de "sem alocação" (ELETRICO.md 7, passo 1): roda 10 s do banco de 200 linhas e 10 s do motor do N700 (4 unidades)
// entre marcadores; `valida.ts` roda este arquivo com `node --trace-gc --import tsx` e conta as coletas entre eles.
import { BancoDeLinhas, ListaLinhas } from '../../src/engines/eletrico/linhas';
import { MotorEletrico, prepararMotorEletrico } from '../../src/engines/eletrico/motor';
import { PRESETS_ELETRICO } from '../../src/engines/eletrico/presets';

const SR = 48000;
const nL = 200, b = new BancoDeLinhas(SR, nL, 7), L = new ListaLinhas(256), out = new Float32Array(128);
const fq = new Float64Array(nL);
for (let k = 0; k < nL; k++) fq[k] = 50 * Math.pow(400, k / (nL - 1));
const passo = () => { L.limpar(); for (let i = 0; i < nL; i++) L.por(i, fq[i] * (1 + 1e-4 * Math.sin(i)), 0.002); b.atualizar(L); b.processar(out, 0, 64); b.processar(out, 64, 0); };
for (let k = 0; k < SR; k += 64) passo();
console.log('INICIO-BANCO');
for (let k = 0; k < 10 * SR; k += 64) passo();
console.log('FIM-BANCO');

const p = PRESETS_ELETRICO.find((x) => x.id === 'n700')!;
const m = new MotorEletrico(SR);
m.configurar(prepararMotorEletrico(p, SR), SR);
const S = m.fontes.map(() => new Float32Array(128));
const carga = { inercia: 50, torque: (w: number) => 0.002 * w * w };
m.acoplar(carga);
m.comandar({ acelerador: 0.7, ignicao: true, partida: false, v: 20 } as never);
for (let k = 0; k < SR; k += 128) m.processar(S, 128);
console.log('INICIO-MOTOR');
for (let k = 0; k < 10 * SR; k += 128) m.processar(S, 128);
console.log('FIM-MOTOR');
