// Validação do radial e da família aviação (RADIAL.md 4 e 8): geometria (Apêndice B), razões f_ign/BPF, bandas por
// regime contra as gravações (dB rel. 150–400 Hz, ±4 dB até 6 kHz: acima disso o áudio comprimido das gravações corta o
// agudo e vale a física), linhas de ordem, lenta → plena, galope da lenta, partida, mag check, mistura, superalimentador,
// refrigeração a ar, subida de giro com o governador, aviação no Ronco (Cessna, R44), estalos da lenta e potência.
//
// Os cenários de som passam pela Cena (tools/radial-cena.ts: o preset no portador hélice, o MotorRadial, ouvinte parado de
// lado, solo de grama), que dá a propagação, o solo e a hélice de verdade; a dinâmica roda no RadialDSP direto. O grupo
// `pagina` mede as mesmas lentas pelo RadialDSP da página (radial.html, ouvinte de fora), que é o que se ouve lá
// (AUDITORIA T-RAD-05); os estalos (`estalos-*`) também são da página, e cobrem os motores pequenos, o Sherman e a
// aviação do Ronco (T-RAD-06).
//
// Desvios (tools/desvios.ts): uma medida fora do alvo só passa se estiver no retrato `tools/radial-desvios.json` e
// ficar na folga do valor gravado lá (±1 dB, ±5 %). Contagens, transientes, vagar e CV são a mediana de 3 sementes do
// ruído (base, base+1, base+2); a CPU saiu para `npm run cpu:radial` (tools/radial-cpu.ts).
//
//   npx tsx tools/radial-valida.ts [grupos...] [--j 8] [--semente N] [--atualizar[=nome exato]]
//   grupos: geometria razoes bandas pagina linhas linhas-b linhas-decolagem niveis galope galope-b partida partida-b
//           estouros (a–d) estalos (a–d) limitador (a–b) motor aviacao potencia; sem grupo, todos em paralelo
// Sai ≠ 0 se houver falha (os desvios do retrato aparecem como "desv", com o teto).
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { lerOpcoes, iniciarSementes, sementeAtual, semear, porSementes, mediana, fmtSementes, avaliarDesvios, imprimirAvaliacao, type Medida } from './desvios';

export type Linha = Medida;
const AQUI = fileURLToPath(import.meta.url);
const RETRATO = path.join(path.dirname(AQUI), 'radial-desvios.json');
const f1 = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const sg = (x: number, d = 1) => (x >= 0 ? '+' : '') + f1(x, d);
/** mediana das 3 sementes e o texto "m (a · b · c)" */
const m3 = (v: number[], d = 1) => ({ m: mediana(v), txt: `${f1(mediana(v), d)} (sementes ${fmtSementes(v, d)})` });

// regimes das bandas (4.1): [60–150, 400–1k, 1–2,5k, 2,5–6k], centroide; ±4 dB e ±30%
const REG: [string, string, number, any, number[], number][] = [
  ['lenta 9 cil. grande, 12 m (Yak-52)', 'm14p', 12, { rpm: 983 }, [4, -6, -15, -14], 370],
  ['lenta 9 cil. perto, 4 m (T-6G)', 'r1340', 4, { rpm: 916 }, [12, -1, 2, 0], 1300],
  ['lenta 14 cil., 10 m (DC-3)', 'r1830', 10, { rpm: 876 }, [5, -7.5, -11, -12.5], 340],
  ['lenta 18 cil. coletor único + turbina, 5 m (P-47)', 'r2800turbo', 5, { rpm: 773 }, [5, -6.5, -12, -10], 490],
  ['lenta 18 cil. estaques por fileira, 8 m (Corsair)', 'r2800', 8, { rpm: 685 }, [-4, -5, -9, -14.5], 400],
  ['lenta 7 cil. pequeno, 4 m (Rotec)', 'rotec2800', 4, { rpm: 1200 }, [3, -8, -4, -6], 1050],
  ['decolagem 9 cil. redutor, 75 m (Yak-52)', 'm14p', 75, { pedal: 1, rpmAlvo: 1 }, [-2, -13, -10.5, -10], 580],
  ['decolagem 9 cil. direto, 50 m (T-6)', 'r1340', 50, { pedal: 1, rpmAlvo: 0.9 }, [-11, -1, 0, -5], 1100],
  ['decolagem 18 cil., 150 m (Corsair)', 'r2800', 150, { pedal: 1, rpmAlvo: 0.75 }, [-16, -12, -10, -15], 456],
];

/** estalos da lenta quente pela página: quem entra em cada grupo (o alvo vem das gravações de radiais: ≤ 3 picos/s) */
const ESTALOS: Record<string, string[]> = {
  'estalos-a': ['r1820', 'r1830', 'r2800', 'r2800turbo', 'm14p'],
  'estalos-b': ['rotec2800', 'rotec3600', 'verner3', 'verner5', 'm14pf', 'r975'],
  'estalos-c': ['c172', 'o360', 'o200', 'io540', 'io550'],
  'estalos-d': ['rotax912', 'bell47', 'r22', 'r44', 's300'],
};
/** limitador de saída em potência de decolagem, pela página (AUDITORIA R-02): menos de 1% das amostras acima de 0,7 */
const LIMITADOR: Record<string, string[]> = {
  'limitador-a': ['r1820', 'r1830', 'r2800', 'r2800turbo', 'r4360', 'r1340', 'r985', 'm14p'],
  'limitador-b': ['m14pf', 'rotec2800', 'rotec3600', 'verner3', 'verner5', 'r975', 'trossi', 's55'],
};
/** página × Cena: o mesmo motor nos dois caminhos, na mesma posição (5 m de lado, sem o solo da Cena) */
const PAGINA_CENA = ['r1830', 'r2800turbo', 'm14p', 'rotec2800'];
const ESTOUROS: Record<string, string[]> = { 'estouros-a': ['r1820'], 'estouros-b': ['r1830'], 'estouros-c': ['r2800'], 'estouros-d': ['r2800turbo'] };

// ------------------------------------------------------------------ grupos
async function grupo(nome: string): Promise<Linha[]> {
  const L: Linha[] = [];
  const add = (n: string, alvo: string, medido: string, ok: boolean, valor?: number | number[], unidade?: string) => L.push({ grupo: nome, nome: n, alvo, medido, ok, valor, unidade });
  const { SR } = await import('./radial-cena');

  if (nome === 'geometria') {
    const log = console.log; console.log = () => {};
    const g = await import('./radial-geometria');
    console.log = log;
    const r = g.resultados;
    for (const x of r) add(x.nome, x.alvo, x.medido, x.ok);
  }

  if (nome === 'razoes' || nome === 'bandas' || nome.startsWith('linhas') || nome.startsWith('galope')) {
    const { ouvirParado } = await import('./radial-cena');
    const { medir } = await import('./radial-bandas');
    const { preset } = await import('./radial-comum');
    const cache = new Map<string, any>();
    /** cenário pela Cena: lenta (pedal 0, rpm fixado como alvo da lenta) ou decolagem (pedal 1, rpm pela hélice) */
    const cena = (id: string, d: number, o: { rpm?: number; pedal?: number; rpmAlvo?: number; dur?: number; s0?: number } = {}) => {
      const k = JSON.stringify([id, d, o, sementeAtual()]);
      if (cache.has(k)) return cache.get(k);
      const s = preset(id);
      const r = ouvirParado(id, { d, pedal: o.pedal ?? 0, rpm: o.rpm, rpmAlvo: o.rpmAlvo, dur: o.dur ?? 12, t0: 4, s0: o.s0, extra: o.rpm && !o.pedal ? { idle: o.rpm } : {} });
      const rpms = r.tele.map((q: any) => q.rpm), rpm = rpms.reduce((a: number, b: number) => a + b, 0) / rpms.length;
      const fIgn = ((rpm / 60) * s.cylinders) / 2;
      const B = s.helice?.B || 0, i = 1 / (s.reducao || 1);
      const m = medir(r.x, SR, { N: s.cylinders, fileiras: s.rows, fIgn, B, i, rastrear: false });
      // vagar: f_ign rastreada em janelas de 1 s (a da telemetria, que é a rotação de verdade)
      const jan: number[] = [];
      for (let t = 4; t + 1 <= (o.dur ?? 12); t += 1) { const w = r.tele.filter((q: any) => q.t >= t && q.t < t + 1).map((q: any) => q.rpm); if (w.length) jan.push(w.reduce((a: number, b: number) => a + b, 0) / w.length); }
      const mj = jan.reduce((a, b) => a + b, 0) / jan.length, vagar = (100 * Math.sqrt(jan.reduce((a, b) => a + (b - mj) ** 2, 0) / jan.length)) / mj;
      const rh = r.tele.map((q: any) => q.rpmHelice || 0), bpfTele = ((rh.reduce((a: number, b: number) => a + b, 0) / rh.length) * B) / 60;
      const out = { m, rpm, fIgn, bpf: m.bpf, bpfTele, s, vagar, x: r.x };
      cache.set(k, out);
      return out;
    };
    const pk = (m: any, f: number) => m.pico(f, 0.015);
    /** uma diferença de picos em dB pela mediana de 3 sementes do mesmo cenário */
    const pk3 = (id: string, d: number, o: any, f: (c: any) => number) => m3(porSementes(() => f(cena(id, d, o))));

    if (nome === 'razoes') {
      // f_ign/BPF = N·i/(2B) medido nos picos do espectro (RADIAL.md 4.2: Yak 3,42, T-6 2,25, DC-3 4,15, P-47 4,5, Corsair 5,14)
      for (const [id, alvo, d] of [['m14p', 3.42, 50], ['r1340', 2.25, 50], ['r1830', 4.15, 50], ['r2800turbo', 4.5, 50], ['r2800', 5.14, 50]] as [string, number, number][]) {
        const c = cena(id, d, { pedal: 1, rpmAlvo: 1, dur: 8 });
        // (picos procurados a ±1% do esperado pela rotação da telemetria: a ±3% o pente da hélice e o da ignição se misturam)
        const achar = (f: number) => { let mx = -1e9, fb = f; for (let x = f * 0.99; x < f * 1.01; x += f * 0.0002) { const v = c.m.pico(x, 0.002); if (v > mx) { mx = v; fb = x; } } return fb; };
        // (a razão pela telemetria, rotação do motor e da hélice no render; a dos picos do espectro vai ao lado: com bins de
        // 1,46 Hz a 60 Hz ela não resolve 1%)
        const r = achar(c.fIgn) / achar(c.bpf), rt = c.fIgn / c.bpfTele;
        add(`f_ign/BPF ${id}`, `${f1(alvo, 2)} ± 1%`, `${f1(rt, 3)} (picos do espectro ${f1(r, 3)}; ${f1(c.rpm, 0)} rpm; ${f1(c.fIgn)} / ${f1(c.bpf)} Hz)`, Math.abs(rt / alvo - 1) <= 0.01, rt, '');
      }
    }

    if (nome === 'bandas') {
      for (const [n, id, d, o, alvo, cent] of REG) {
        const c = cena(id, d, o);
        const b = [c.m.b[0], c.m.b[2], c.m.b[3], c.m.b[4]];
        const erro = Math.max(...b.map((v, k) => Math.abs(v - alvo[k])));
        add(`bandas ${n}`, `${alvo.map((x) => sg(x)).join(' / ')} ± 4 dB`, `${b.map((x) => sg(x)).join(' / ')} (6–12k ${sg(c.m.b[5])}; ${f1(c.rpm, 0)} rpm; erro máx ${f1(erro)} dB)`, erro <= 4, b, 'dB');
        add(`centroide ${n}`, `${cent} Hz ± 30%`, `${f1(c.m.cent, 0)} Hz`, Math.abs(c.m.cent / cent - 1) <= 0.3, c.m.cent, 'Hz');
      }
    }

    if (nome.startsWith('galope')) {
      // vagar e CV pela mediana de 3 sementes (AUDITORIA T-RAD-02: com uma semente só, 3 dos 10 mudavam de estado)
      for (const [n, id, d, o] of REG) {
        if (!n.startsWith('lenta') || id === 'rotec2800') continue;
        if ((nome === 'galope') !== ['m14p', 'r1340'].includes(id)) continue;
        const cs = porSementes(() => cena(id, d, o));
        const p47 = id === 'r2800turbo';
        const vg = m3(cs.map((c: any) => c.vagar), 2), cc = m3(cs.map((c: any) => c.m.cvCiclo), 2), cl = m3(cs.map((c: any) => c.m.cvLento), 2);
        add(`vagar da lenta ${n}`, p47 ? '≤ 7%' : '2–4%', `${vg.txt} %`, p47 ? vg.m <= 7 : vg.m >= 2 && vg.m <= 4, vg.m, '%');
        add(`CVciclo da lenta ${n}`, '0,30–0,42', cc.txt, cc.m >= 0.3 && cc.m <= 0.42, cc.m, '');
        add(`CVlento da lenta ${n}`, '0,05–0,20', cl.txt, cl.m >= 0.05 && cl.m <= 0.2, cl.m, '');
      }
    }

    if (nome === 'linhas') {
      // as linhas da lenta dependem da explosão a explosão: mediana de 3 sementes (T-RAD-02)
      const d3 = pk3('rotec2800', 4, { rpm: 1200 }, (c) => pk(c.m, 3 * c.fIgn) - pk(c.m, c.fIgn));
      add('Rotec: 3·f_ign contra a fundamental (estaque de 0,6 m)', '0 ± 4 dB', `${d3.txt} dB`, Math.abs(d3.m) <= 4, d3.m, 'dB');
      const dfil = pk3('r2800', 8, { rpm: 685 }, (c) => pk(c.m, c.fIgn / 2) - pk(c.m, c.fIgn));
      add('R-2800 estaques, lenta: 4,5ª contra a 9ª', '≥ −3 dB', `${dfil.txt} dB`, dfil.m >= -3, dfil.m, 'dB');
      const dp = pk3('r2800turbo', 5, { rpm: 773 }, (c) => pk(c.m, c.fIgn) - pk(c.m, c.fIgn / 2));
      add('P-47 coletor único, lenta: 9ª contra a 4,5ª', '≥ 0 dB', `${dp.txt} dB`, dp.m >= 0, dp.m, 'dB');
    }
    if (nome === 'linhas-b') {
      for (const [id, rpm] of [['r1830', 876], ['m14p', 983]] as [string, number][]) {
        const h = pk3(id, 12, { rpm }, (c) => Math.max(...[2, 3, 4, 5].map((k) => pk(c.m, k * c.bpf))) - pk(c.m, c.fIgn));
        add(`${id} lenta a 12 m de lado: harmônicos 2–5 da BPF contra a ignição`, '−10 ± 5 dB', `${h.txt} dB`, Math.abs(h.m + 10) <= 5, h.m, 'dB');
      }
      const hn = pk3('r1830', 3, { rpm: 1147, s0: -3.3 }, (c) => Math.max(...[2, 3, 5].map((k) => pk(c.m, k * c.bpf))) - pk(c.m, c.fIgn));
      add('DC-3 a 3 m da hélice ("singing"): 2·, 3·, 5·BPF contra a ignição', '≥ −2 dB', `${hn.txt} dB`, hn.m >= -2, hn.m, 'dB');
    }

    if (nome === 'linhas-decolagem') {
      const yk = cena('m14p', 75, { pedal: 1, rpmAlvo: 1 });
      const yb = pk(yk.m, yk.bpf) - pk(yk.m, yk.fIgn), yh = [1, 2, 3].map((h) => pk(yk.m, h * yk.bpf));
      add('Yak-52 decolagem: BPF contra a ignição', '≥ +5 dB', `${sg(yb)} dB`, yb >= 5, yb, 'dB');
      add('Yak-52 decolagem: harmônicos 1–3 da BPF', 'dentro de 8 dB', `${f1(Math.max(...yh) - Math.min(...yh))} dB`, Math.max(...yh) - Math.min(...yh) <= 8, Math.max(...yh) - Math.min(...yh), 'dB');
      const t6 = cena('r1340', 50, { pedal: 1, rpmAlvo: 0.9 });
      const th = [5, 6, 7, 8, 9].map((h) => pk(t6.m, h * t6.bpf)), ti = pk(t6.m, t6.fIgn);
      add('T-6 decolagem: harmônicos 5–9 da BPF entre si', 'dentro de 6 dB', `${f1(Math.max(...th) - Math.min(...th))} dB (${th.map((x) => f1(x - ti, 0)).join('/')} dB rel. ignição)`, Math.max(...th) - Math.min(...th) <= 6, Math.max(...th) - Math.min(...th), 'dB');
      add('T-6 decolagem: harmônicos 5–9 contra a ignição', '≥ +10 dB', `${sg(Math.min(...th) - ti)} dB`, Math.min(...th) - ti >= 10, Math.min(...th) - ti, 'dB');
      const co = cena('r2800', 150, { pedal: 1, rpmAlvo: 0.75 });
      const cf = pk(co.m, co.fIgn / 2) - pk(co.m, co.fIgn);
      add('Corsair decolagem: fileira (4,5ª) contra a ignição (9ª)', '≥ +8 dB', `${sg(cf)} dB`, cf >= 8, cf, 'dB');
    }
  }

  if (nome === 'pagina') {
    // T-RAD-05: as mesmas lentas pelo RadialDSP da página (radial.html, ouvinte de fora, 5 m do cubo, hélice do próprio
    // DSP), contra os mesmos alvos das gravações. A distância da página não é a da gravação (4–12 m): comparação aproximada,
    // mas é o que se ouve lá
    // (um ouvido só, o do lado das bocas: a soma em mono dos dois ouvidos, cada boca com o seu atraso de até 0,6 ms, tirava
    // 2 a 4 dB de 1–2,5 kHz na medida; radial-comum.ts, `ouvido`)
    const { preset, novoDSP, renderizar, ouvido, trecho, media } = await import('./radial-comum');
    const { medir } = await import('./radial-bandas');
    for (const [n, id, , o, alvo, cent] of REG) {
      if (!n.startsWith('lenta')) continue;
      const s = preset(id);
      const d = novoDSP({ ...s, idle: o.rpm }, { quente: true });
      const r = renderizar(d, 12);
      const rpm = media(trecho(r.tele, 4, 12).map((q) => q.rpm));
      const fIgn = ((rpm / 60) * s.cylinders) / 2, B = s.helice?.B || 0, i = 1 / (s.reducao || 1);
      const m = medir(ouvido(r.L, r.R, 4, 12), SR, { N: s.cylinders, fileiras: s.rows, fIgn, B, i, rastrear: false });
      const b = [m.b[0], m.b[2], m.b[3], m.b[4]];
      const erro = Math.max(...b.map((v, k) => Math.abs(v - alvo[k])));
      const curto = n.replace(/^lenta /, '').replace(/, \d+ m \(/, ' (');
      add(`bandas da página na lenta, ${curto}`, `${alvo.map((x) => sg(x)).join(' / ')} ± 4 dB`, `${b.map((x) => sg(x)).join(' / ')} (6–12k ${sg(m.b[5])}; ${f1(rpm, 0)} rpm; erro máx ${f1(erro)} dB)`, erro <= 4, b, 'dB');
      add(`centroide da página na lenta, ${curto}`, `${cent} Hz ± 30%`, `${f1(m.cent, 0)} Hz`, Math.abs(m.cent / cent - 1) <= 0.3, m.cent, 'Hz');
    }
    // página × Cena (T-RAD-05): o mesmo preset na lenta quente pelos dois caminhos, na mesma posição de ouvinte: de lado,
    // a 5 m, e a Cena sem o solo (a página não tem reflexão do solo; com a grama a Cena fica 3 a 5 dB mais brilhante
    // em relação a 150–400 Hz, porque a banda de referência cai no vale da interferência). Bandas relativas a 150–400 Hz
    const { bandas } = await import('./radial-bandas');
    const { ouvirParado } = await import('./radial-cena');
    for (const id of PAGINA_CENA) {
      const s = preset(id);
      const r = renderizar(novoDSP(s, { quente: true }), 12);
      const pg = bandas(ouvido(r.L, r.R, 4, 12), SR).b;
      const cn = bandas(ouvirParado(id, { d: 5, pedal: 0, rpm: s.idle, dur: 12, t0: 4, solo: 'nenhum' }).x, SR).b;
      const dif = [2, 3, 4].map((k) => cn[k] - pg[k]), pior = Math.max(...dif.map(Math.abs));
      add(`${id}: Cena (5 m, sem solo) menos página, 400–1k / 1–2,5k / 2,5–6k`, '0 ± 2 dB', `${dif.map((x) => sg(x)).join(' / ')} dB`, pior <= 2, dif, 'dB');
    }
  }

  if (nome in LIMITADOR) {
    // potência de decolagem pela página, com o volume padrão (0,8): manete toda (hélice no alvo máximo; tanque e carro
    // em ponto morto), 5 s para assentar e 4 s medidos. O limitador de saída (o `tanh`) é proteção, não parte do timbre
    const { preset, novoDSP } = await import('./radial-comum');
    const B = 128, l = new Float32Array(B), r = new Float32Array(B);
    for (const id of LIMITADOR[nome]) {
      const d: any = novoDSP(preset(id), { quente: true });
      d.message({ type: 'av', rpmAlvo: 1 }); d.message({ type: 'input', throttle: 1 });
      let acima = 0, n = 0, pico = 0;
      for (let i = -5 * SR; i < 4 * SR; i += B) {
        d.process(l, r, B);
        if (i >= 0) for (let k = 0; k < B; k++) { const m = Math.max(Math.abs(l[k]), Math.abs(r[k])); if (m > 0.7) acima++; if (m > pico) pico = m; n++; }
      }
      const pc = (100 * acima) / n;
      add(`${id}: decolagem pela página, amostras acima de 0,7`, '< 1 %', `${f1(pc, 2)} % (pico ${f1(pico, 2)}; ${f1(d.rpmAvg, 0)} rpm; margem de decolagem ${f1(d.margemDb || 0)} dB)`, pc < 1, pc, '%');
    }
  }

  if (nome === 'niveis' || nome === 'motor') {
    const { motorRadial } = await import('./radial-cena');
    const { preset } = await import('./radial-comum');
    // nível das bocas (Pa a 5 m) numa condição travada: lenta (o controle de lenta ajusta a válvula de ar) e plena a 55%
    const nivelBocas = (id: string, rpm: number, thr: number, dur = 3, extra: Record<string, any> = {}) => {
      const m = motorRadial(id, extra), d = m.dsp, B = 128;
      d.omega = (rpm * 2 * Math.PI) / 60; d.rpmAvg = rpm; d.lockOmega = true; d.thrTarget = thr; d.thr = thr; d.carga = null;
      d.state = 'run'; d.ignition = true; d.runT = 100; d.magnetos = 'ambos'; d.exhT = thr > 0.5 ? 700 : 320;
      const can = m.fontes.map(() => new Float32Array(B));
      const nEsc = m.fontes.filter((f) => f.id.startsWith('escape.')).length;
      const idx = (id2: string) => m.fontes.findIndex((f) => f.id === id2);
      let e = 0, n = 0; const acc: Record<string, number> = {};
      for (let i = 0; i < dur * SR; i += B) {
        m.processar(can, B);
        if (i > SR) {
          for (let k = 0; k < B; k++) { let s = 0; for (let q = 0; q < nEsc; q++) s += can[q][k]; e += s * s; n++; }
          for (const f of m.fontes) { const q = idx(f.id); let s = 0; for (let k = 0; k < B; k++) s += can[q][k] ** 2; acc[f.id] = (acc[f.id] || 0) + s; }
        }
      }
      return { db: 10 * Math.log10(e / n / 4e-10), canais: Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, 10 * Math.log10(v / n / 4e-10)])), m };
    };
    if (nome === 'niveis') {
      // (a lenta varia explosão a explosão: a diferença ia de +12,8 a +13,8 dB no R-1340 com a semente; mediana de 3)
      for (const id of ['r1340', 'r1830', 'r2800', 'm14p']) {
        const s = preset(id);
        const ns = porSementes(() => { const lenta = nivelBocas(id, s.idle, 0), plena = nivelBocas(id, s.rpmMax * 0.55, 1); return [lenta.db, plena.db]; });
        const dd = m3(ns.map(([a, b]) => b - a));
        add(`${id}: lenta → plena carga a 55% (bocas a 5 m)`, '+18 a +25 dB', `${dd.txt} dB (${f1(ns[0][0])} → ${f1(ns[0][1])} dB)`, dd.m >= 18 && dd.m <= 25, dd.m, 'dB');
      }
      // os 13 aviões na lenta a 12 m de lado, pela Cena (com a hélice): dentro de 12 dB
      const { ouvirParado } = await import('./radial-cena');
      const ids = ['r1820', 'r1830', 'r2800', 'r2800turbo', 'r4360', 'm14p', 'm14pf', 'r1340', 'r985', 'rotec2800', 'rotec3600', 'verner3', 'verner5'];
      const lv = ids.map((id) => { const r = ouvirParado(id, { d: 12, pedal: 0, dur: 6, t0: 3, rpm: preset(id).idle }); let e = 0; for (const v of r.x) e += v * v; return 10 * Math.log10(e / r.x.length / 4e-10); });
      const faixa = Math.max(...lv) - Math.min(...lv);
      add('os 13 aviões na lenta a 12 m: faixa de nível', '≤ 12 dB', `${f1(faixa)} dB (${ids.map((id, k) => `${id} ${f1(lv[k], 0)}`).join(', ')})`, faixa <= 12, faixa, 'dB');
    } else {
      // superalimentador: o uivo em rpm·relação·pás/60 (±2%) e −25 dB ou menos do total de fora
      const { welch } = await import('./radial-bandas');
      for (const rpm of [800, 2700]) {
        const r = nivelBocas('r2800', rpm, 1, 2.5);
        const m = r.m, B = 128, q = m.fontes.findIndex((f) => f.id === 'compressor');
        const d = m.dsp; d.omega = (rpm * 2 * Math.PI) / 60; d.rpmAvg = rpm;
        const can = m.fontes.map(() => new Float32Array(B)), x = new Float64Array(SR);
        for (let i = 0; i < SR; i += B) { m.processar(can, B); x.set(can[q].subarray(0, Math.min(B, SR - i)), i); }
        const [f, P] = welch(x, SR, 16384);
        const alvo = (rpm * 7.6 * 16) / 60;
        let kb = 0; for (let k = 1; k < f.length; k++) if (f[k] > alvo * 0.7 && f[k] < alvo * 1.3 && P[k] > P[kb]) kb = k;
        add(`R-2800: uivo do superalimentador a ${rpm} rpm`, `${f1(alvo, 0)} Hz ± 2%`, `${f1(f[kb], 0)} Hz`, Math.abs(f[kb] / alvo - 1) <= 0.02, f[kb], 'Hz');
        const tot = 10 * Math.log10(Object.values(r.canais).reduce((a, v) => a + 10 ** (v / 10), 0));
        add(`R-2800: nível do uivo contra o total a ${rpm} rpm`, '≤ −25 dB', `${sg(r.canais.compressor - tot)} dB`, r.canais.compressor - tot <= -25, r.canais.compressor - tot, 'dB');
      }
      // refrigeração a ar: a mecânica do radial (×1,2 do ar e ×1,17 das aletas expostas) contra o mesmo motor com água
      const ar = nivelBocas('r1340', 1500, 0.5, 2), agua = nivelBocas('r1340', 1500, 0.5, 2, { cooling: 'water' });
      const raz = 10 ** ((ar.canais.bloco - agua.canais.bloco) / 20) * 1.17;
      add('mecânica do radial contra um motor de água (×1,2 do ar × 1,17 das aletas)', '1,4×', `${f1(raz, 2)}×`, Math.abs(raz - 1.4) <= 0.05, raz, '');
    }
  }

  if (nome === 'partida' || nome === 'partida-b' || nome === 'motor') {
    const { preset, novoDSP, renderizar, trecho, media, mono, SR: S } = await import('./radial-comum');
    const { medir, welch } = await import('./radial-bandas');
    if (nome === 'partida') {
      // R-1830, arranque de inércia: energizar (apito 290 → 390 Hz em ~18 s), engate, contagem de pás, pegar, CV; os
      // transientes, os CV e a contagem de estouros pela mediana de 3 sementes (T-RAD-02: 3 a 12 estouros conforme a fase)
      const um = () => {
        const s = preset('r1830');
        const d = novoDSP(s, { temp: 15 });
        // (estouros com o instante: o alvo é dos primeiros 10 s depois de pegar)
        const tPops: number[] = []; let tAgora = 0; const push = d.pops.push.bind(d.pops); d.pops.push = (...a: any[]) => { tPops.push(tAgora); return push(...a); };
        d.message({ type: 'av', prime: 2 });
        const r = renderizar(d, 45, [[0, (x) => x.message({ type: 'input', ignition: true })]], (_x, t) => { tAgora = t; });
        const tEng = r.tele.find((q) => q.fase === 'girar')?.t ?? NaN, tPega = r.tele.find((q) => q.state === 'run')?.t ?? NaN;
        const tMag = r.tele.find((q) => q.t > tEng && q.magnetos === 'ambos')?.t ?? NaN;
        const apito = (t0: number) => { const x = mono(r.L, r.R, t0, t0 + 1); const [f, P] = welch(x, S, 16384); let kb = 0; for (let k = 1; k < f.length; k++) if (f[k] > 250 && f[k] < 450 && P[k] > P[kb]) kb = k; return f[kb]; };
        const cv = (t0: number, t1: number) => { const tl = trecho(r.tele, t0, t1); const rpm = media(tl.map((q) => q.rpm)); return medir(mono(r.L, r.R, t0, t1), S, { N: 14, fileiras: 2, fIgn: (rpm / 60) * 7, rastrear: false }).cvCiclo; };
        const p10 = tPops.filter((t) => t >= tPega && t < tPega + 10).length, pTot = tPops.filter((t) => t >= tPega).length;
        return { tEng, tPega, tMag, a0: apito(1), a1: apito(tEng - 1.2), c3: cv(tPega - 0.5, tPega + 2.5), c20: cv(tPega + 18, tPega + 21), p10, pTot };
      };
      const rs = porSementes(um), r0 = rs[0];
      add('R-1830: apito do volante energizando (pico do espectro)', '290 → 390 Hz em 15–20 s (±5%)', `${f1(r0.a0, 0)} → ${f1(r0.a1, 0)} Hz em ${f1(r0.tEng, 1)} s`, Math.abs(r0.a0 / 290 - 1) <= 0.05 && Math.abs(r0.a1 / 390 - 1) <= 0.05 && r0.tEng >= 15 && r0.tEng <= 20, [r0.a0, r0.a1, r0.tEng], '');
      const pas = m3(rs.map((r) => r.tMag - r.tEng)), pega = m3(rs.map((r) => r.tPega - r.tMag));
      add('R-1830: 9 pás contadas depois do engate', '4–6 s', `${pas.txt} s`, pas.m >= 4 && pas.m <= 6, pas.m, 's');
      add('R-1830: pega depois dos magnetos', '1–3 s', `${pega.txt} s`, pega.m >= 1 && pega.m <= 3, pega.m, 's');
      // (a janela da gravação, DC-3 25–28 s, começa meio segundo antes da 1ª explosão e pega a subida de 20 dB do nível
      // enquanto o motor pega; a do modelo é a mesma, de 0,5 s antes a 2,5 s depois. O alvo é a faixa das partidas do A.3
      // com o motor frio: P-47 0,62, DC-3 0,80, R-2800 1,06, SBD 1,11 (o Corsair, quente, 0,37). O "≥ 0,8" de antes só
      // passava com 21 estouros de 28–34 dB nesses 3 s, que nenhuma gravação tem: ver ESTOURO_PARTIDA em aviacao.ts)
      const c3 = m3(rs.map((r) => r.c3), 2), c20 = m3(rs.map((r) => r.c20), 2);
      add('R-1830: CVciclo nos 3 s em que pega (de 0,5 s antes a 2,5 s depois)', '0,6–1,1 (A.3)', c3.txt, c3.m >= 0.6 && c3.m <= 1.1, c3.m, '');
      add('R-1830: CVciclo aos 20 s', '≤ 0,45', c20.txt, c20.m <= 0.45, c20.m, '');
      const p10 = m3(rs.map((r) => r.p10), 0);
      add('R-1830 com primer 2: estouros nos primeiros 10 s depois de pegar', '3–8', `${p10.txt} (${fmtSementes(rs.map((r) => r.pTot), 0)} até ${f1(45 - r0.tPega, 0)} s depois de pegar)`, p10.m >= 3 && p10.m <= 8, p10.m, '');
    } else if (nome === 'partida-b') {
      // M-14P, ar comprimido: "tchufs" por segundo (cilindros recebendo ar) por 2–3 s
      const tc = porSementes(() => {
        const dm = novoDSP(preset('m14p'), { temp: 15 });
        let tch = 0; const ant = new Uint8Array(9); const fn = dm.partidaAr.bind(dm);
        dm.partidaAr = (c: number, a: number) => { const v = fn(c, a); const on = v > 0 ? 1 : 0; if (on && !ant[c]) tch++; ant[c] = on; return v; };
        const rm = renderizar(dm, 6, [[0, (x) => x.message({ type: 'input', ignition: true })]]);
        const tAr = rm.tele.filter((q) => q.state === 'crank').length * (1024 / S);
        return { taxa: tch / Math.max(0.1, Math.min(tAr, 3)), tAr, tPega: rm.tele.find((q) => q.state === 'run')?.t ?? NaN };
      });
      const tx = m3(tc.map((r) => r.taxa)), tAr = mediana(tc.map((r) => Math.min(r.tAr, 3)));
      add('M-14P: partida a ar, "tchufs" por segundo', '7–11 /s por 2–3 s', `${tx.txt} /s por ${f1(tAr, 1)} s (pegou em ${fmtSementes(tc.map((r) => r.tPega))} s)`, tx.m >= 7 && tx.m <= 11 && tAr >= 2, tx.m, '/s');
      // R-2800, parada pela mistura: de 1 000 rpm a 0 em 4–8 s (hélice de bancada)
      const pc = porSementes(() => {
        const dp = novoDSP(preset('r2800'), { quente: true });
        const rp = renderizar(dp, 14, [[0, (x) => { x.message({ type: 'input', throttle: 0.15 }); }], [5, (x) => { x.message({ type: 'input', throttle: 0 }); x.message({ type: 'av', mistura: 0 }); }]]);
        const t1000 = rp.tele.find((q) => q.t > 5 && q.rpm <= 1000)?.t ?? NaN, t0 = rp.tele.find((q) => q.t > 5 && q.rpm < 30)?.t ?? NaN;
        return { dt: t0 - t1000, antes: trecho(rp.tele, 4, 5)[0]?.rpm ?? 0 };
      });
      const dt = m3(pc.map((r) => r.dt));
      add('R-2800: mistura em corte, de 1 000 rpm a parar', '4–8 s', `${dt.txt} s (${f1(pc[0].antes, 0)} rpm antes do corte)`, dt.m >= 4 && dt.m <= 8, dt.m, 's');
    } else {
      // mag check a 1 700 rpm (R-1340): queda de 60 ± 30 rpm em cada magneto, diferença ≤ 30
      let thr = 0.2;
      // (a manete fixa que dá 1 700 rpm com os dois magnetos, achada por bisseção na semente de base; depois cada
      // magneto sozinho por 4 s, nas 3 sementes: a queda medida mudava 81–107 rpm com a fase do ruído, T-RAD-02)
      let lo = 0.02, hi = 0.6;
      for (let it = 0; it < 7; it++) {
        thr = 0.5 * (lo + hi);
        const dt = novoDSP(preset('r1340'), { quente: true });
        const rt = renderizar(dt, 8, [[0, (x) => x.message({ type: 'input', throttle: thr })]]);
        if (media(trecho(rt.tele, 6, 8).map((q) => q.rpm)) > 1700) hi = thr; else lo = thr;
      }
      thr = 0.5 * (lo + hi);
      const mc = porSementes(() => {
        const r = renderizar(novoDSP(preset('r1340'), { quente: true }), 26, [
          [0, (x) => { x.message({ type: 'input', throttle: thr }); x.message({ type: 'av', magnetos: 'ambos' }); }], [12, (x) => x.message({ type: 'av', magnetos: 'esq' })],
          [16, (x) => x.message({ type: 'av', magnetos: 'ambos' })], [22, (x) => x.message({ type: 'av', magnetos: 'dir' })],
        ]);
        const m = (a: number, b: number) => media(trecho(r.tele, a, b).map((q) => q.rpm));
        const base = m(10.5, 12), esq = m(14, 16), base2 = m(19.5, 22), dir = m(24, 26);
        return { base, esq, qe: base - esq, qd: base2 - dir };
      });
      const qe = m3(mc.map((r) => r.qe), 0), qd = m3(mc.map((r) => r.qd), 0), df = m3(mc.map((r) => Math.abs(r.qe - r.qd)), 0);
      add('mag check a 1 700 rpm: queda com o magneto esquerdo', '60 ± 30 rpm', `${qe.txt} rpm (${f1(mc[0].base, 0)} → ${f1(mc[0].esq, 0)})`, Math.abs(qe.m - 60) <= 30, qe.m, 'rpm');
      add('mag check: queda com o direito', '60 ± 30 rpm', `${qd.txt} rpm`, Math.abs(qd.m - 60) <= 30, qd.m, 'rpm');
      add('mag check: diferença entre os magnetos', '≤ 30 rpm', `${df.txt} rpm`, df.m <= 30, df.m, 'rpm');
      // mistura pobre (0,55) contra auto-rica: escape mais quente e potência menor (plena carga, rotação travada)
      const pot = (mx: number) => {
        const d = novoDSP(preset('r1340'), { quente: true }); d.lockOmega = true; d.omega = (2000 * 2 * Math.PI) / 60; d.rpmAvg = 2000; d.message({ type: 'av', mistura: mx });
        const rr = renderizar(d, 2, [[0, (x) => x.message({ type: 'input', throttle: 1 })]]);
        return { tq: media(trecho(rr.tele, 1.2, 2).map((q) => q.torque)), egt: rr.tele.at(-1)!.egt - rr.tele.at(-1)!.exhT };
      };
      const p8 = pot(0.8), p55 = pot(0.55), dp = (100 * (p55.tq - p8.tq)) / p8.tq;
      add('mistura 0,55: potência contra a auto-rica', '−3 a −7%', `${sg(dp)}%`, dp <= -3 && dp >= -7, dp, '%');
      add('mistura 0,55: escape mais quente', '+40 a +80 °C', `${sg(p55.egt - p8.egt, 0)} °C`, p55.egt - p8.egt >= 40 && p55.egt - p8.egt <= 80, p55.egt - p8.egt, '°C');
      // subida de giro do R-2800 com a hélice: 650 → 2 800 rpm em 4–7 s, o governador segura 1 225 ± 2% na hélice
      // (o piloto leva a manete ao fundo em ~3 s; transiente: mediana de 3 sementes)
      const sb = porSementes(() => {
        const dr = novoDSP(preset('r2800'), { quente: true });
        const rr = renderizar(dr, 14, [], (x, t) => { if (t >= 1) x.message({ type: 'input', throttle: Math.min(1, (t - 1) / 3) }); });
        return { t: (rr.tele.find((q) => q.t > 1 && q.rpm >= 0.97 * 2800)?.t ?? NaN) - 1, nh: media(trecho(rr.tele, 10, 14).map((q) => q.rpmHelice)) };
      });
      const ts = m3(sb.map((r) => r.t)), nh = mediana(sb.map((r) => r.nh));
      add('R-2800: subida de giro com o passo mínimo (manete ao fundo em 3 s)', '650 → 2 800 rpm em 4–7 s', `${ts.txt} s`, ts.m >= 4 && ts.m <= 7, ts.m, 's');
      add('R-2800: governador segura a hélice', '1 225 ± 2%', `${f1(nh, 0)} rpm`, Math.abs(nh / 1225 - 1) <= 0.02, nh, 'rpm');
      // Sherman (D1, F-RAD-03): velocidade de cada marcha no corte, pela ficha (redução final 2,84 × diferencial 3,53);
      // a máxima do M4A1 é 24 mph (39 km/h). Conta da ficha, não do som: guarda a relação que a página e a Passagem usam
      const sh = preset('r975'), vm = sh.ratios.map((r: number) => ((sh.rpmMax / (r * sh.finalDrive)) * 2 * Math.PI / 60) * sh.wheelR * 3.6);
      add('Sherman (r975): velocidade no corte em cada marcha (conta da ficha)', '5ª: 39 km/h ± 5% (24 mph do M4A1)', `${vm.map((v: number) => f1(v)).join(' / ')} km/h`, Math.abs(vm[4] / 39 - 1) <= 0.05, vm, 'km/h');
    }
  }

  if (nome === 'aviacao') {
    const { EngineDSP } = await import('../src/engines/ronco/dsp');
    const { configCalibrada } = await import('../src/engines/ronco/config');
    const { ACESSORIOS_PADRAO, PRESETS_AVIACAO } = await import('../src/engines/ronco/presets');
    const { renderizar, trecho, media } = await import('./radial-comum');
    const novo = (id: string, temp: number) => { const d: any = new EngineDSP(SR); d.setConfig(configCalibrada({ ...ACESSORIOS_PADRAO, ...PRESETS_AVIACAO.find((p) => p.id === id) }, SR)); d.ambientT = temp; d.coolant = temp; d.exhT = temp; return semear(d); };
    for (const temp of [20, -5]) {
      const d = novo('c172', temp);
      d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } });
      const r = renderizar(d, 20, [[0, (x) => x.message({ type: 'input', ignition: true })]]);
      const rpm = media(trecho(r.tele, 15, 20).map((q) => q.rpm));
      add(`Cessna 172 lenta quente (ar a ${temp} °C)`, '650 ± 20 rpm', `${f1(rpm, 0)} rpm`, Math.abs(rpm - 650) <= 20, rpm, 'rpm');
    }
    // R44 no portador rotor (MotorRonco): Nr 408 ± 2%, droop ao puxar o coletivo 0,5 → 0,75 em 1 s, recuperação
    // (transientes: mediana de 3 sementes)
    const { Rotor } = await import('../src/carriers/rotor');
    const { MotorRonco, prepararMotorRonco } = await import('../src/engines/ronco/motor');
    const { configRotor } = await import('../src/engines/ronco/aviacao');
    const av = PRESETS_AVIACAO.find((p) => p.id === 'r44')!;
    const B = 128;
    const rr = porSementes(() => {
      const m = new MotorRonco(SR); m.configurar(prepararMotorRonco({ ...ACESSORIOS_PADRAO, ...av }, SR), SR);
      const ro = new Rotor(SR, configRotor(av)); ro.acoplar(m); semear(ro);
      const can = ro.fontes().map(() => new Float32Array(B));
      const nr: [number, number][] = [];
      for (let i = 0; i < 16 * SR; i += B) { const t = i / SR; ro.comandar({ pedal: t < 8 ? 0.5 : t < 9 ? 0.5 + 0.25 * (t - 8) : 0.75 }); ro.processar(can, B, 1 / SR); nr.push([t, (ro.telemetria() as any).Nr]); }
      const est = media(nr.filter(([t]) => t > 5 && t < 8).map(([, v]) => v));
      const min = Math.min(...nr.filter(([t]) => t > 8).map(([, v]) => v));
      const tVolta = nr.find(([t, v]) => t > 9 && v >= est * 0.995 && nr.filter(([t2]) => t2 > 8 && t2 < t).some(([, v2]) => v2 === min))?.[0] ?? NaN;
      return { est, droop: (100 * (est - min)) / est, volta: tVolta - 9 };
    });
    const est = mediana(rr.map((r) => r.est)), dr = m3(rr.map((r) => r.droop), 2), vt = m3(rr.map((r) => r.volta), 2);
    add('R44 (O-540 + rotor): Nr em voo pairado', '408 ± 2%', `${f1(est, 1)} rpm`, Math.abs(est / 408 - 1) <= 0.02, est, 'rpm');
    add('R44: droop ao puxar o coletivo (0,5 → 0,75 em 1 s)', '2–3%', `${dr.txt} %`, dr.m >= 2 && dr.m <= 3, dr.m, '%');
    add('R44: recuperação a 99,5%', '≤ 1,5 s', `${vt.txt} s depois do fim do puxão`, vt.m <= 1.5, vt.m, 's');
    // Cessna 172 em decolagem (35 m/s): BPF ~90 Hz, M_t ~0,80, f_ign/BPF = 1 (4 cilindros e 2 pás: a ignição coincide)
    const { Helice } = await import('../src/carriers/helice');
    const { configHelice } = await import('../src/engines/ronco/aviacao');
    const c = PRESETS_AVIACAO.find((p) => p.id === 'c172')!;
    const mc = new MotorRonco(SR); mc.configurar(prepararMotorRonco({ ...ACESSORIOS_PADRAO, ...c }, SR), SR);
    const h = new Helice(SR, configHelice(c)); h.acoplar(mc); semear(h); h.comandar({ pedal: 1, velocidadeFixa: 35 });
    const ch = h.fontes().map(() => new Float32Array(B));
    for (let i = 0; i < 8 * SR; i += B) h.processar(ch, B, 1 / SR);
    const tl: any = h.telemetria(), fIgn = (mc.dsp.rpmAvg / 60) * 2;
    add('Cessna 172 decolagem (35 m/s): passagem de pá', '≈ 90 Hz (2 700 rpm)', `${f1(tl.bpf, 1)} Hz (${f1(mc.dsp.rpmAvg, 0)} rpm)`, Math.abs(tl.bpf / 90 - 1) <= 0.08, tl.bpf, 'Hz');
    add('Cessna 172: Mach na ponta', '≈ 0,80', f1(tl.machPonta, 2), Math.abs(tl.machPonta - 0.8) <= 0.06, tl.machPonta, '');
    add('Cessna 172: f_ign/BPF', '1,0', f1(fIgn / tl.bpf, 3), Math.abs(fIgn / tl.bpf - 1) <= 0.01, fIgn / tl.bpf, '');
  }

  if (nome in ESTOUROS) {
    // "pipocos" (REVISAO-DE-SOM.md: picos por segundo e curtose do agudo; tools/radial-estouros.ts): o detector do pops.py
    // na saída da página (de fora, 5 m do cubo) contra as gravações (DC-3, P-47, Corsair, T-28, R-2800 em banco, Rotec,
    // Sh-14): nos 20 s depois de pegar, 0–6 picos acima de 20 dB e 0–0,73 por segundo acima de 16 dB. Contagens: mediana
    // de 3 sementes (T-RAD-02: o r1830 dava 3 a 9 picos fortes na partida conforme o instante)
    const { cenario, ign, eng, thr } = await import('./radial-estouros');
    for (const id of ESTOUROS[nome]) {
      const ps = porSementes(() => cenario(id, false, 45, [[0, ign], [0.5, eng]], [['partida 0–20 s', 0, 20]], true)[0]);
      const n20 = m3(ps.map((p) => p.m.n20), 0), fo = m3(ps.map((p) => p.m.fortes), 2);
      add(`${id}: estouros nos 20 s depois de pegar (picos > 20 dB)`, '≤ 6', `${n20.txt} (o mais alto ${f1(mediana(ps.map((p) => p.m.hmax)))} dB; ${f1(mediana(ps.map((p) => p.inj)), 2)} injetados/s)`, n20.m <= 6, n20.m, '');
      add(`${id}: picos > 16 dB por segundo nos 20 s depois de pegar`, '≤ 0,75', fo.txt, fo.m <= 0.75, fo.m, '/s');
      const fr = porSementes(() => cenario(id, false, 40, [[0, ign], [0.5, eng], [14, thr(1)], [20, thr(0)]], [['subida', 14.5, 20], ['desaceleração', 20, 26]]));
      const sub = mediana(fr.map((r) => r[0].m.fortes)), des = mediana(fr.map((r) => r[1].m.fortes));
      add(`${id}: picos > 16 dB por segundo acelerando e desacelerando a frio (14–26 s)`, '≤ 0,5', `${f1(sub, 2)} / ${f1(des, 2)} (sementes ${fr.map((r) => `${f1(r[0].m.fortes, 2)}/${f1(r[1].m.fortes, 2)}`).join(' · ')})`, sub <= 0.5 && des <= 0.5, [sub, des], '/s');
    }
  }

  if (nome in ESTALOS) {
    // lenta quente pela página: 0–2,5 picos por segundo e nenhum acima de 16 dB nas gravações (DC-3 0, P-47 0–2,3,
    // Corsair 2,5, T-28 1,8; Rotec 5,9/s com 0,17/s fortes e curtose 6). O critério do teste: ≤ 3 picos/s e ≤ 0,3/s acima
    // de 16 dB. Motores pequenos, Sherman e aviação do Ronco entraram aqui (T-RAD-06). Mediana de 3 sementes
    const { cenario } = await import('./radial-estouros');
    for (const id of ESTALOS[nome]) {
      const ls = porSementes(() => cenario(id, true, 14, [], [['lenta quente', 3, 14]])[0]);
      const est = m3(ls.map((l) => l.m.est), 2), fo = mediana(ls.map((l) => l.m.fortes)), ku = mediana(ls.map((l) => l.m.kmed));
      add(`${id}: lenta quente, picos por segundo (> 16 dB)`, '≤ 3/s, e ≤ 0,3/s acima de 16 dB', `${est.txt} (${f1(fo, 2)} fortes/s; curtose ${f1(ku)}; ${f1(mediana(ls.map((l) => l.rpm)), 0)} rpm)`, est.m <= 3 && fo <= 0.3, [est.m, fo], '/s');
    }
  }

  if (nome === 'potencia') {
    const { preset, cfgCalibrada } = await import('./radial-comum');
    const { RadialDSP } = await import('../src/engines/radial/dsp');
    // a potência em cada ponto é a média de 2 s do torque (o `tqMean` do DSP é uma média exponencial de 50 ms: lida no
    // fim de 0,5 s ela variava ±8% com a semente, T-RAD-02)
    for (const id of ['r1820', 'r1830', 'r2800', 'r4360', 'm14p', 'r1340', 'rotec2800']) {
      const s = preset(id), cfg = cfgCalibrada(s);
      const d = new RadialDSP(SR); d.setConfig(cfg); semear(d);
      d.state = 'run'; d.lockOmega = true; d.tempMode = 'fixed'; d.coolant = 90; d.runT = 100; d.thrTarget = 1; d.thr = 1; d.boost = cfg.boost; d.maxBoost = cfg.boost; d.carga = null;
      let mx = 0;
      for (const f of [0.8, 0.9, 1.0]) {
        d.omega = (s.rpmMax * f * 2 * Math.PI) / 60; d.rpmAvg = s.rpmMax * f; d.tqMean = 0;
        const B = 256, l = new Float32Array(B), r = new Float32Array(B);
        let soma = 0, n = 0;
        for (let i = 0; i < 2.25 * SR; i += B) { d.process(l, r, B); if (i >= 0.25 * SR) { soma += d.tqMean; n++; } }
        mx = Math.max(mx, ((soma / n) * d.omega) / 1000);
      }
      add(`potência ${id}`, `${s.power} kW ± 5%`, `${f1(mx, 0)} kW`, Math.abs(mx / s.power - 1) <= 0.05, mx, 'kW');
    }
  }
  return L;
}

// ------------------------------------------------------------------ CLI
const GRUPOS = ['geometria', 'razoes', 'bandas', 'pagina', 'linhas', 'linhas-b', 'linhas-decolagem', 'niveis', 'galope', 'galope-b', 'partida', 'partida-b', ...Object.keys(ESTOUROS), ...Object.keys(ESTALOS), ...Object.keys(LIMITADOR), 'motor', 'aviacao', 'potencia'];
const ALIAS: Record<string, string[]> = { estouros: Object.keys(ESTOUROS), estalos: Object.keys(ESTALOS), limitador: Object.keys(LIMITADOR) };
const args = process.argv.slice(2);
if (args[0] === '--grupo') {
  iniciarSementes();
  grupo(args[1]).then((l) => process.stdout.write(JSON.stringify(l))).catch((e) => process.stdout.write(JSON.stringify([{ grupo: args[1], nome: 'execução do grupo', alvo: 'sem erro', medido: String(e?.stack || e).slice(0, 400), ok: false }])));
} else if (process.argv[1] && process.argv[1].endsWith('radial-valida.ts')) {
  const op = lerOpcoes(args);
  iniciarSementes(op.semente);
  const J = op.j ?? Math.max(2, Math.floor(os.cpus().length * 0.5));
  const pedidos = op.resto.flatMap((g) => ALIAS[g] ?? [g]);
  for (const g of pedidos) if (!GRUPOS.includes(g)) { console.error(`grupo desconhecido: ${g} (${GRUPOS.join(' ')})`); process.exit(2); }
  const fila = pedidos.length ? pedidos : GRUPOS;
  const res: Record<string, Linha[]> = {};
  const t0 = Date.now();
  const rodar = (g: string) => new Promise<void>((ok) => {
    const p = spawn(process.execPath, ['--import', 'tsx', AQUI, '--grupo', g], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = ''; p.stdout.on('data', (b) => { out += b; });
    p.on('close', () => { try { res[g] = JSON.parse(out); } catch { res[g] = [{ grupo: g, nome: 'execução do grupo', alvo: 'sem erro', medido: out.slice(-300), ok: false }]; } console.error(`  (${g}: ${((Date.now() - t0) / 1000).toFixed(0)} s)`); ok(); });
  });
  (async () => {
    // (os grupos mais longos primeiro)
    const q = [...fila].sort((a, b) => +b.startsWith('estalos') + +b.startsWith('estouros') + +b.startsWith('partida') - (+a.startsWith('estalos') + +a.startsWith('estouros') + +a.startsWith('partida')));
    await Promise.all(Array.from({ length: Math.min(J, q.length) }, async () => { while (q.length) await rodar(q.shift()!); }));
    const linhas = fila.flatMap((g) => res[g] || []);
    const r = avaliarDesvios(RETRATO, linhas, { atualizar: op.atualizar, grupos: fila });
    // (o tempo antes da contagem: o verificar mostra a última linha)
    console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    imprimirAvaliacao(r, { motivo: true });
    process.exitCode = r.contagem.falha ? 1 : 0;
  })();
}
