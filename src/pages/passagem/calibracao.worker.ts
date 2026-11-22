// Web Worker da calibração dos motores da Passagem (AUDITORIA.md P-07): a mesma função que os testes chamam na hora
// (calibracao.ts), fora da thread principal. Recebe { n, pedido } e devolve { n, cfg } ou { n, erro }; o cfg é o objeto
// que vai na mensagem `portador` para o worklet (clonável, como lá).
import { calibrarMotor, type PedidoCalibracao } from './calibracao';

const escopo = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage: (m: unknown) => void };
escopo.onmessage = (e: MessageEvent<{ n: number; pedido: PedidoCalibracao }>) => {
  const { n, pedido } = e.data;
  try { escopo.postMessage({ n, cfg: calibrarMotor(pedido) }); }
  catch (err) { escopo.postMessage({ n, erro: String((err as Error)?.message ?? err) }); }
};
