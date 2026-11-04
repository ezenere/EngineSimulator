// Troca de preset e de portador com o motor ligado, na ordem de mensagens da página (controle.ts: loadPreset →
// config com `fresh` → estado de carga inteiro, com o portador escolhido por `portadorAoTrocar`): gerador com carga →
// Scania (o defeito: o caminhão aceita gerador e nascia isócrono a 1800 rpm) → gerador → EMD em notch 8 → Scania → GE
// em notch 6 → Hilux → gerador → Cat C15. Depois de cada troca o motor dá a partida de novo e tem de voltar à lenta do
// novo preset (±5%) em poucos segundos, sem ficar acelerado pelo estado do governador ou da carga do preset anterior.
//
//   npx tsx tools/diesel-troca.ts
import { DieselDSP } from '../src/engines/diesel/dsp';
import { configCalibrada } from '../src/engines/diesel/config';
import { preset, SR } from './diesel-comum';
import { portadorAoTrocar } from '../src/engines/diesel/presets';

const B = 128;
const cfgs = new Map<string, any>();
const cfgDe = (id: string) => { if (!cfgs.has(id)) cfgs.set(id, configCalibrada(preset(id), SR)); return cfgs.get(id); };

// a mensagem de carga que a página manda depois de cada config (enviarCarga)
const carga = (portador: string, c: Partial<{ notch: number; degrau: number }> = {}) => ({
  type: 'diesel', portador, notch: c.notch ?? 0, degrau: c.degrau ?? 0, cargaBancada: 0, rpmAlvo: 0, freioMotor: false, jakeCilindros: 6, manual: 0,
  dinamico: false, lentaBaixa: false, fRede: 60,
});

const d = new DieselDSP(SR);
d.params.listener = 'ext';
const L = new Float32Array(B), R = new Float32Array(B);
const rodar = (s: number) => { const rpms: number[] = []; for (let i = 0; i < s * SR; i += B) { d.process(L, R, B); if (i % 4096 === 0) rpms.push(d.rpmAvg); } return rpms; };
const media = (x: number[]) => x.reduce((a, b) => a + b, 0) / Math.max(1, x.length);

// passos: [preset, carga do passo, segundos com carga]; o portador é o que a página escolhe (portadorAoTrocar)
const passos: [string, any, number][] = [
  ['gen500', { degrau: 0.5 }, 8],
  ['scaniav8', {}, 0], // (o caso do defeito: o Scania aceita gerador e nascia isócrono a 1800 rpm)
  ['gen500', { degrau: 1 }, 6],
  ['emd710', { notch: 8 }, 14],
  ['scaniav8', {}, 0],
  ['ge7fdl', { notch: 6 }, 12],
  ['hilux28', {}, 0],
  ['gen500', {}, 0],
  ['catc15', {}, 0],
];
let falhas = 0;
console.log('| troca para | portador | rpm 8–12 s depois | alvo (lenta) | erro | |\n|---|---|---|---|---|---|');
let port = preset(passos[0][0]).portadores[0] as string;
d.message({ type: 'config', cfg: { ...cfgDe(passos[0][0]) } });
d.message(carga(port));
d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } });
d.message({ type: 'input', ignition: true });
for (const [i, [id, c, s]] of passos.entries()) {
  if (i > 0) {
    port = portadorAoTrocar(preset(id), port as any);
    // loadPreset: config com fresh (o motor ligado dá a partida de novo) e o estado de carga zerado
    d.message({ type: 'config', cfg: { ...cfgDe(id), fresh: true } });
    d.message(carga(port));
  }
  // lenta do motor novo: o gerador no portador gerador vai à rotação da rede (isócrono)
  const r = media(rodar(12).slice(-Math.round((4 * SR) / 4096)));
  const sp = preset(id);
  const alvo = port === 'gerador' && sp.gerador ? (120 * sp.gerador.fRede) / sp.gerador.polos : sp.idle;
  const erro = (r - alvo) / alvo, ok = Math.abs(erro) <= 0.05 && d.state === 'run';
  if (!ok) falhas++;
  console.log(`| ${id} | ${port} | ${r.toFixed(0)} (${d.state}) | ${alvo} | ${(erro * 100).toFixed(1)}% | ${ok ? 'ok' : 'FALHA'} |`);
  // a carga do passo (notch, degrau) antes da próxima troca
  if (s > 0) { d.message({ ...carga(port, c) }); rodar(s); }
}
console.log(falhas ? `${falhas} falha(s) na troca de preset` : 'TROCA OK: o motor volta à lenta depois de cada troca');
process.exit(falhas ? 1 : 0);
