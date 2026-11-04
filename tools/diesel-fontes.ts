// Isola as fontes do Diesel (REVISAO-DE-SOM.md: "isolar por fonte"): renderiza um preset num cenário com uma fonte
// desligada de cada vez, ou só uma ligada, e grava WAV float 32 mono (média dos canais) para a análise da envoltória
// (`tools/diesel-envoltoria.ts`). A calibração é a da página (feita antes de desligar qualquer coisa), então o nível de
// cada fonte é o que se ouve no navegador.
//
//   npx tsx tools/diesel-fontes.ts <preset> <cenário> <pasta> [ouvinte] [fonte,...|tudo|cada]
//
//   cenários: lenta (14 s), carga (1ª marcha, pé no fundo, 14 s), n8 (locomotiva, notch 8 aos 3 s, 30 s), ger (gerador,
//     degrau de 100% aos 6 s, 16 s), e os de diesel-comum (idle, rev, wot, notches…)
//   fontes: escape (pulso tonal na ponteira), jato (chiado do gás na ponteira), valvula (jato na abertura da válvula),
//     admissao (pulso), chiadoAdm (chiado do filtro), sopro (compressor: whoosh e chiado), turbina (banda larga da
//     turbina na chaminé), apito, mecanica (knock, tiques, válvulas, bombas), fundo (fundo mecânico contínuo), vib, ambiente (vento e fundo da cena)
//   ESCALA="fundo=0.3,sopro=0.2,turbina=0.5,valvula=1,mecanica=1" multiplica o ganho dessas fontes antes de renderizar
//   "cada": grava o motor inteiro e, para cada fonte, `so-<fonte>` = inteiro − (inteiro sem a fonte). Desligar uma fonte
//   zera o ganho dela sem pular as chamadas do gerador de ruído (a semente segue igual), então a diferença é a fonte
//   (exata nas fontes somadas na saída). As que entram na rede de tubos (válvula, turbina) mudam a trajetória do laço
//   não linear dos primários: para elas grava `sem-<fonte>`, e a contribuição é a diferença de energia por banda.
//   `so-escape` é o que sobra com todas as outras desligadas (o pulso tonal)
import fs from 'node:fs';
import path from 'node:path';
import { gravarWav } from './wav';
import { CENARIOS, renderizar, preset, SR, type Cenario } from './diesel-comum';
import type { DieselDSP } from '../src/engines/diesel/dsp';

const quente = (d: DieselDSP) => d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } });
const liga = (d: DieselDSP) => d.message({ type: 'input', ignition: true });
export const CEN_EXTRA: Record<string, Cenario> = {
  lenta: { eventos: [[0, (d) => { quente(d); liga(d); }], [14, null]], portador: 'nenhum0' },
  n8: { eventos: [[0, (d) => { quente(d); liga(d); }], [3, (d) => d.message({ type: 'diesel', notch: 8 })], [30, null]], portador: 'locomotiva' },
  ger: { eventos: [[0, (d) => { quente(d); liga(d); }], [6, (d) => d.message({ type: 'diesel', degrau: 1 })], [16, null]], portador: 'gerador' },
  carga: { eventos: [[0, (d) => { quente(d); liga(d); }], [3, (d) => { d.message({ type: 'input', shift: 1 }); d.message({ type: 'input', throttle: 1 }); }], [14, null]], portador: 'carro' },
};

export const FONTES = ['escape', 'jato', 'valvula', 'admissao', 'chiadoAdm', 'sopro', 'turbina', 'apito', 'mecanica', 'fundo', 'vib', 'ambiente'] as const;
type Fonte = (typeof FONTES)[number];
// as que passam pela rede de tubos (o resto é somado na saída)
export const NA_REDE: Fonte[] = ['valvula', 'turbina'];

// desliga uma fonte depois do setConfig (a calibração já foi feita com tudo ligado)
export function desligar(d: any, f: Fonte) {
  switch (f) {
    case 'escape': d.params.exhaust = 0; break;
    case 'jato': { const fr = d.freio.bind(d); d.freio = (dtc: number) => { fr(dtc); d.jetGain = 0; }; d.jetGain = 0; break; } // (o freio-motor repõe o ganho a cada passo de controle)
    case 'valvula': d.valveNoise = 0; break;
    case 'admissao': d.inGain = 0; break;
    case 'chiadoAdm': d.hissGain = 0; break;
    case 'sopro': d.gChiado = 0; break;
    case 'turbina': d.zTurb = 0; break;
    case 'apito': d.gApito = 0; break;
    case 'mecanica': d.gMec = 0; d.clickEnv = 0; break;
    case 'fundo': d.fundoAmp = [0, 0]; break;
    case 'vib': d.vibLP.b0 = 0; d.vibLP.b1 = 0; d.vibLP.b2 = 0; break;
    case 'ambiente': d.params.ambSound = false; break;
  }
}

export function renderFontes(id: string, cen: string, ouvinte: string, off: Fonte[]) {
  const spec = preset(id);
  const c: Cenario = CEN_EXTRA[cen] || CENARIOS[cen](spec);
  const c2: Cenario = { ...c, eventos: [[0, (d) => {
    c.eventos[0][1]?.(d);
    for (const f of off) desligar(d, f);
    // ESCALA="fundo=0.3,sopro=0.2": multiplica o ganho de uma fonte (para medir antes de mudar uma constante)
    for (const kv of (process.env.ESCALA || '').split(',').filter(Boolean)) {
      const [k, v] = kv.split('='), g = +v;
      if (k === 'fundo') d.fundoAmp = d.fundoAmp.map((a: number) => a * g);
      else if (k === 'sopro') d.gChiado *= g;
      else if (k === 'turbina') d.zTurb *= g;
      else if (k === 'valvula') d.valveNoise *= g;
      else if (k === 'mecanica') d.gMec *= g;
      else if (k === 'mod') d.kModT = g;
    }
  }], ...c.eventos.slice(1)] };
  return renderizar(spec, c2, { ouvinte });
}

if (process.argv[1] && process.argv[1].endsWith('diesel-fontes.ts')) {
  const [id, cen, pasta, ouvinte = 'ext', modo = 'tudo'] = process.argv.slice(2);
  if (!id || !cen || !pasta) { console.error('uso: tsx tools/diesel-fontes.ts <preset> <cenário> <pasta> [ouvinte] [fonte,...|tudo|cada]'); process.exit(2); }
  fs.mkdirSync(pasta, { recursive: true });
  const mono = (r: any) => { const m = new Float32Array(r.L.length); for (let i = 0; i < m.length; i++) m[i] = 0.5 * (r.L[i] + r.R[i]); return m; };
  const grava = (nome: string, r: any, m = mono(r)) => {
    const arq = path.join(pasta, `${id}_${cen}_${ouvinte}_${nome}.wav`);
    gravarWav(arq, m, m, SR, 'float32');
    const rpm = r.tele.filter((x: any) => x.t > 6).reduce((a: number, x: any, _: number, v: any[]) => a + x.rpm / v.length, 0);
    console.log(`${arq} rpm ${rpm.toFixed(0)}`);
  };
  if (modo === 'cada') {
    const r0 = renderFontes(id, cen, ouvinte, []), m0 = mono(r0);
    grava('tudo', r0, m0);
    for (const f of FONTES) {
      if (f === 'escape') { grava('so-escape', renderFontes(id, cen, ouvinte, FONTES.filter((g) => g !== 'escape'))); continue; }
      const r = renderFontes(id, cen, ouvinte, [f]), m = mono(r);
      // (fontes que entram na rede de tubos mudam a trajetória do laço não linear: a diferença não é a fonte; grava o
      // motor sem ela e a contribuição sai pela diferença de energia por banda)
      if (NA_REDE.includes(f)) { grava(`sem-${f}`, r, m); continue; }
      for (let i = 0; i < m.length; i++) m[i] = m0[i] - m[i];
      grava(`so-${f}`, r, m);
    }
  } else if (modo === 'tudo') grava('tudo', renderFontes(id, cen, ouvinte, []));
  else grava(`sem-${modo.replace(/,/g, '+')}`, renderFontes(id, cen, ouvinte, modo.split(',') as Fonte[]));
}
