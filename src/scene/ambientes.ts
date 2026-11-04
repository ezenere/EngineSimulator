// Ambientes da Passagem (CENA.md 2.10) e a resposta ao impulso com RT60 por banda.
//
// A reverberação continua na thread principal (ConvolverNode); o worklet só manda o envio (canais 2–3).
// `gerarRespostaPorBanda` não usa DOM nem Math.random (RNG com semente): a mesma resposta é usada pela
// página (num AudioBuffer, com `convolver.normalize = false`) e pela validação offline (tools/cena/).
// A resposta sai com energia 1 em cada canal: o ganho `reverb.wet` é então a razão de potência entre o
// campo reverberante e o envio, em regime.
import type { Ambiente, EspecReverb, IdAmbiente } from './tipos';
import { RNG } from '../acoustics/rng';
import { Bq } from './filtros';

/** Bandas do RT60: 125, 500, 2k, 8k Hz, separadas em 250, 1k e 4k (Butterworth de 8ª ordem). */
export const BANDAS_RT = [125, 500, 2000, 8000] as const;
export const CORTES_RT = [250, 1000, 4000] as const;

const sem = { vento: 0, ventilacao: 0, murmurio: 0 };

export const AMBIENTES_PASSAGEM: Record<'ceu' | 'corte' | 'estacao' | 'tunel' | 'ponte', Ambiente> = {
  ceu: {
    id: 'ceu', solo: { tipo: 'brita' },
    reverb: { len: 0.8, tau: 0.08, diff: 0.35, wet: 0.05, dry: 1, echoes: [], rt60: [0.6, 0.4, 0.3, 0.2] },
    fundo: { ...sem, vento: 38 },
  },
  corte: {
    id: 'corte', solo: { tipo: 'brita' },
    // taludes a 8 m, 45°: duas laterais a 20–60 ms, ganho 0,45/0,3, flutter 0,05
    reverb: { len: 1.4, tau: 0.2, diff: 0.4, wet: 0.25, dry: 1, flutter: 0.05, echoes: [[0.024, 0.45, 0.004], [0.052, 0.3, 0.008]], rt60: [1.0, 0.9, 0.7, 0.5] },
    fundo: { ...sem, vento: 35 },
  },
  estacao: {
    id: 'estacao', solo: { tipo: 'concreto' },
    // cobertura a 7 m: teto 12 ms (0,5), 2 paredes 30–60 ms (0,35), piso
    reverb: { len: 3.2, tau: 0.6, diff: 0.8, wet: 0.6, dry: 1, echoes: [[0.012, 0.5, 0.002], [0.034, 0.35, 0.004], [0.057, 0.35, 0.006]], rt60: [2.5, 2.0, 1.6, 0.9] },
    fundo: { ...sem, murmurio: 55 },
  },
  tunel: {
    id: 'tunel', solo: { tipo: 'concreto' },
    // paredes a 2 m e teto a 5 m: pente denso 5–30 ms (0,5), flutter 0,041
    reverb: { len: 6.0, tau: 0.9, diff: 1, wet: 4.0, dry: 1, flutter: 0.041,
      echoes: [[0.006, 0.5, 0.001], [0.0117, 0.45, 0.0015], [0.017, 0.4, 0.002], [0.023, 0.35, 0.003], [0.029, 0.3, 0.004]], rt60: [5.0, 4.0, 2.8, 1.0] },
    tunel: { area: 64, comprimento: 2000, xEntrada: -500 },
    fundo: { ...sem, ventilacao: 58 },
  },
  ponte: {
    id: 'ponte', solo: { tipo: 'concreto' },   // tabuleiro até 3 m do trilho, depois `nenhum` (Cena.soloLargura)
    reverb: { len: 0.8, tau: 0.07, diff: 0.3, wet: 0.04, dry: 1, echoes: [], rt60: [0.5, 0.4, 0.3, 0.2] },
    fundo: { ...sem, vento: 42 },
  },
};

/**
 * Expoente da distância no envio (1/r^e). Ao ar livre o envio cai com 1/√r (o roadS do Ronco); num
 * túnel o som é guiado e o campo reverberante quase não depende de onde está a fonte (e pequeno).
 */
export function expoenteEnvio(amb: Ambiente) { return amb.id === 'tunel' ? 0.15 : amb.id === 'estacao' ? 0.35 : 0.5; }

/** RT60 efetivo: no túnel com brita o RT cai à metade (2.10). */
export function rt60Efetivo(amb: Ambiente): readonly [number, number, number, number] {
  const r = amb.reverb.rt60 ?? [amb.reverb.tau * 6.91, amb.reverb.tau * 6.91, amb.reverb.tau * 6.91, amb.reverb.tau * 6.91];
  if (amb.id === 'tunel' && amb.solo.tipo === 'brita') return [r[0] * 0.5, r[1] * 0.5, r[2] * 0.5, r[3] * 0.5];
  return r as [number, number, number, number];
}

/**
 * Resposta ao impulso estéreo: ruído com semente separado em 4 bandas, cada uma com o seu decaimento
 * exp(−6,91·t/RT60), mais as reflexões iniciais (ecos com espalhamento, como `echoes` do legado) e o
 * flutter. Normalizada para energia 1 por canal.
 */
export function gerarRespostaPorBanda(amb: Ambiente, fs: number, semente = 0x1e5a): { L: Float32Array; R: Float32Array } {
  const E: EspecReverb = amb.reverb;
  const rt = rt60Efetivo(amb);
  const len = Math.max(E.len, Math.max(...rt) * 1.15);
  const n = Math.floor(fs * len);
  const saida = [new Float32Array(n), new Float32Array(n)];
  for (let ch = 0; ch < 2; ch++) {
    const rng = new RNG(semente + 7919 * ch);
    const d = saida[ch];
    // filtros de banda: LP250 | HP250·LP1k | HP1k·LP4k | HP4k, Butterworth de 8ª ordem (4 biquads de cada
    // lado): com 4ª ordem a banda vizinha de RT mais longo vaza e domina a cauda (o RT de 8 kHz no túnel saía 25% longo)
    const lp = (f: number) => [new Bq().lp(fs, f), new Bq().lp(fs, f), new Bq().lp(fs, f), new Bq().lp(fs, f)];
    const hp = (f: number) => [new Bq().hp(fs, f), new Bq().hp(fs, f), new Bq().hp(fs, f), new Bq().hp(fs, f)];
    const fb: Bq[][] = [lp(250), [...hp(250), ...lp(1000)], [...hp(1000), ...lp(4000)], hp(4000)];
    const k = rt.map((r) => -6.907755 / (Math.max(0.05, r) * fs));
    for (let i = 0; i < n; i++) {
      const t = i / fs;
      let flut = 1;
      if (E.flutter) flut = 0.55 + 0.45 * Math.pow(Math.abs(Math.sin((Math.PI * t) / E.flutter)), 8);
      const ataque = Math.min(1, t / 0.003);
      const x = rng.bi();
      let y = 0;
      for (let b = 0; b < 4; b++) {
        let s = x;
        for (const f of fb[b]) s = f.run(s);
        y += s * Math.exp(k[b] * i);
      }
      d[i] = y * E.diff * flut * ataque;
    }
    // reflexões iniciais
    for (const [t0, g, smear] of E.echoes) {
      const start = Math.floor((t0 + ch * 0.0011 * (1 + t0 * 4)) * fs), l = Math.max(1, Math.floor(smear * fs));
      const amp = g * Math.sqrt(3 / l) * (1 - 0.15 * ch);
      let e = 0;
      const kk = Math.max(0.08, 0.7 - t0 * 0.6);
      for (let j = 0; j < l * 3 && start + j < n; j++) {
        e += kk * (rng.bi() - e);
        d[start + j] += amp * e * Math.exp(-j / l) * 2;
      }
    }
    let en = 0; for (let i = 0; i < n; i++) en += d[i] * d[i];
    const g = 1 / Math.sqrt(en || 1);
    for (let i = 0; i < n; i++) d[i] *= g;
  }
  return { L: saida[0], R: saida[1] };
}

/** ambiente da passagem por id (cópia rasa, para o chamador poder mudar solo/túnel) */
export function ambientePassagem(id: IdAmbiente): Ambiente {
  const a = (AMBIENTES_PASSAGEM as Record<string, Ambiente>)[id];
  if (!a) throw new Error(`ambiente da Passagem desconhecido: ${id}`);
  return { ...a, solo: { ...a.solo }, reverb: { ...a.reverb }, tunel: a.tunel ? { ...a.tunel } : undefined, fundo: { ...a.fundo } };
}
