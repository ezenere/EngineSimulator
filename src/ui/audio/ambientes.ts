// Acústica de cada lugar: cauda difusa + ecos discretos (prédios, arquibancada, paredões…).
// Copiado de ENVS/makeIR() de src/app.js e src/jet-app.js. Na etapa da cena, isto vai para src/scene/.
//   len: duração da resposta (s) · tau: decaimento da cauda (s) · diff: nível da cauda
//   wet/dry: ganho do envio e do som direto · dark: quanto a cauda escurece · flutter: eco palpitante (s)
//   echoes: [atraso (s), ganho, espalhamento (s)]

export type Ambiente = {
  name: string;
  len: number;
  tau: number;
  diff: number;
  wet: number;
  dry?: number;
  dark?: number;
  flutter?: number;
  echoes: [number, number, number][];
};

export const AMBIENTES_RONCO: Record<string, Ambiente> = {
  open: { name: 'Céu aberto', len: 0.6, tau: 0.08, diff: 0.35, wet: 0.1, dry: 1.0, echoes: [[0.006, 0.5, 0.001]] },
  street: { name: 'Rua com prédios', len: 1.5, tau: 0.32, diff: 0.5, wet: 0.4, dry: 1.2, dark: 0.5,
    echoes: [[0.047, 0.55, 0.004], [0.061, 0.45, 0.005], [0.094, 0.3, 0.008], [0.122, 0.22, 0.01], [0.141, 0.16, 0.012], [0.19, 0.1, 0.02]] },
  tunnel: { name: 'Túnel', len: 3.4, tau: 0.9, diff: 1, wet: 0.8, dry: 1.6, dark: 0.6, flutter: 0.041,
    echoes: [[0.018, 0.5, 0.002], [0.041, 0.45, 0.004], [0.083, 0.35, 0.008], [0.124, 0.25, 0.012]] },
  garage: { name: 'Garagem', len: 1.3, tau: 0.28, diff: 1, wet: 0.6, dry: 1.45, dark: 0.25,
    echoes: [[0.011, 0.5, 0.002], [0.019, 0.4, 0.003], [0.027, 0.3, 0.004]] },
  track: { name: 'Autódromo', len: 1.8, tau: 0.12, diff: 0.4, wet: 0.28, dry: 1.1, dark: 0.7,
    echoes: [[0.009, 0.4, 0.001], [0.16, 0.32, 0.04], [0.28, 0.2, 0.06], [0.45, 0.1, 0.09]] },
  canyon: { name: 'Serra', len: 2.6, tau: 0.25, diff: 0.25, wet: 0.42, dry: 1.0, dark: 0.8,
    echoes: [[0.38, 0.45, 0.03], [0.71, 0.3, 0.05], [1.05, 0.2, 0.07], [1.5, 0.12, 0.1], [2.1, 0.07, 0.14]] },
};

export const AMBIENTES_TURBINA: Record<string, Ambiente> = {
  runway: { name: 'Pista aberta', len: 0.7, tau: 0.07, diff: 0.3, wet: 0.08, echoes: [[0.008, 0.4, 0.001]] },
  apron: { name: 'Pátio do terminal', len: 1.8, tau: 0.3, diff: 0.45, wet: 0.3, dark: 0.5,
    echoes: [[0.18, 0.5, 0.01], [0.26, 0.35, 0.015], [0.33, 0.2, 0.02], [0.5, 0.12, 0.04]] },
  hangar: { name: 'Hangar', len: 4.5, tau: 1.3, diff: 1, wet: 0.6, dark: 0.4,
    echoes: [[0.03, 0.4, 0.004], [0.07, 0.35, 0.006], [0.12, 0.3, 0.01]] },
  testcell: { name: 'Célula de teste', len: 2.5, tau: 0.6, diff: 1, wet: 0.5, dark: 0.55, flutter: 0.028,
    echoes: [[0.014, 0.5, 0.002], [0.028, 0.4, 0.003], [0.056, 0.3, 0.006]] },
  valley: { name: 'Vale (voo rasante)', len: 4, tau: 0.3, diff: 0.25, wet: 0.4, dark: 0.8,
    echoes: [[0.6, 0.5, 0.04], [1.1, 0.35, 0.06], [1.7, 0.25, 0.08], [2.4, 0.15, 0.12], [3.2, 0.08, 0.15]] },
  carrier: { name: 'Porta-aviões', len: 1.2, tau: 0.1, diff: 0.3, wet: 0.18, dark: 0.3,
    echoes: [[0.004, 0.6, 0.001], [0.045, 0.35, 0.004], [0.09, 0.15, 0.01]] },
};

// Resposta ao impulso sintética do ambiente (makeIR). Usa Math.random: é a única parte da cadeia
// que não é determinística, e ela fica fora do DSP (não entra na comparação de WAV).
export function gerarRespostaAoImpulso(ctx: BaseAudioContext, E: Ambiente): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * E.len);
  const buf = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let env = E.diff * Math.exp(-t / E.tau) * Math.min(1, t / 0.003);
      if (E.flutter) env *= 0.55 + 0.45 * Math.pow(Math.abs(Math.sin((Math.PI * t) / E.flutter)), 8);
      // a cauda escurece com o tempo (o ar e as superfícies absorvem os agudos)
      const k = 0.6 * Math.exp(-t / (0.5 - 0.35 * (E.dark || 0))) + 0.04;
      lp += k * (Math.random() * 2 - 1 - lp);
      d[i] = lp * env;
    }
    for (const [t0, g, smear] of E.echoes) {
      const start = Math.floor((t0 + ch * 0.0011 * (1 + t0 * 4)) * sr), len = Math.max(1, Math.floor(smear * sr));
      const amp = g * Math.sqrt(3 / len) * (1 - 0.15 * ch);
      let e = 0;
      const k = Math.max(0.08, 0.7 - t0 * 0.6);
      for (let j = 0; j < len * 3 && start + j < n; j++) {
        e += k * (Math.random() * 2 - 1 - e);
        d[start + j] += amp * e * Math.exp(-j / len) * 2;
      }
    }
  }
  return buf;
}
