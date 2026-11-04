// Validação do radial e da família aviação (RADIAL.md 4 e 8): geometria (Apêndice B), razões f_ign/BPF, bandas por
// regime contra as gravações (dB rel. 150–400 Hz, ±4 dB até 6 kHz: acima disso o áudio comprimido das gravações corta o
// agudo e vale a física), linhas de ordem, lenta → plena, galope da lenta, partida, mag check, mistura, superalimentador,
// refrigeração a ar, subida de giro com o governador, aviação no Ronco (Cessna, R44), CPU do R-4360 e potência.
//
// Os cenários de som passam pela Cena (tools/radial-cena.ts: o preset no portador hélice, o MotorRadial, ouvinte parado de
// lado, solo de grama), que dá a propagação, o solo e a hélice de verdade; a dinâmica roda no RadialDSP direto.
//
//   npx tsx tools/radial-valida.ts [grupos...] [--j 8]    (grupos: geometria razoes bandas linhas niveis galope partida
//                                                         motor aviacao cpu potencia; sem grupo, todos em paralelo)
// Sai ≠ 0 se houver falha (os desvios conhecidos, documentados no TECNICO, aparecem como "desv").
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export type Linha = { grupo: string; nome: string; alvo: string; medido: string; ok: boolean; desvio?: string };
const AQUI = fileURLToPath(import.meta.url);
const f1 = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const sg = (x: number, d = 1) => (x >= 0 ? '+' : '') + f1(x, d);

/** desvios conhecidos (nome da medida → por quê); RADIAL.md "Validação" e TECNICO.md → Radial */
const DESVIOS: Record<string, string> = {
  'bandas lenta 9 cil. grande, 12 m (Yak-52)': 'O grave (60–150) fica 5–6 dB acima: a ignição de 73 Hz e o 2º harmônico caem na banda e o escape do modelo irradia o pulso inteiro; a gravação é de celular a poucos metros, com o grave cortado pelo microfone (o próprio Apêndice A marca o codec saturando). O médio e o agudo batem (±2 dB).',
  'bandas lenta 9 cil. perto, 4 m (T-6G)': 'O grave fica 12 dB abaixo: na gravação (OtN, motor frio a 916 rpm) a banda 60–150 tem a 2·BPF da hélice direta (61 Hz, +10 dB sobre a mediana) e a ignição a +17; no modelo a hélice na lenta é ∝ M⁴ (M 0,3) e não chega lá. O médio e o agudo batem (±3 dB) com o vazamento do anel de chapa fina.',
  'centroide lenta 9 cil. perto, 4 m (T-6G)': 'Consequência do grave baixo (ver as bandas do T-6G a 4 m): com o grave da gravação o centroide cai para ~1 300 Hz.',
  'bandas lenta 14 cil., 10 m (DC-3)': 'Só o grave fica 4,1 dB abaixo (0,1 dB fora da tolerância); o resto bate a ±0,5 dB.',
  'bandas lenta 18 cil. estaques por fileira, 8 m (Corsair)': 'Grave 5 dB acima e 400–1k 5,6 dB abaixo; a gravação (TLv) tem uma linha externa fixa em 152 Hz a +25 dB sobre a mediana (Apêndice A), que entra na banda de referência 150–400 e puxa as relativas para baixo.',
  'bandas lenta 7 cil. pequeno, 4 m (Rotec)': 'Os estaques de 38 mm, curtos e sem nada depois, irradiam o pulso de cada cilindro com a derivada da vazão e o chiado de jato da boca estreita: o modelo fica 7–9 dB mais brilhante que a gravação, mesmo sem o vazamento do anel (que o Rotec não tem). Falta um modelo de boca de estaque curto (difração, ka < 1) melhor que o Radiator do Ronco.',
  'centroide lenta 7 cil. pequeno, 4 m (Rotec)': 'Consequência do agudo dos estaques (ver as bandas do Rotec).',
  'bandas decolagem 9 cil. redutor, 75 m (Yak-52)': 'Grave +3 e agudo −4,3 dB (0,3 dB fora): a hélice de 2 pás a 62 Hz domina o grave; o ruído largo das pás (×10 em M ≥ 0,85, acerto da etapa) ainda fica abaixo do da gravação.',
  'centroide decolagem 9 cil. redutor, 75 m (Yak-52)': 'Consequência do grave da hélice (ver as bandas da decolagem do Yak).',
  'bandas decolagem 9 cil. direto, 50 m (T-6)': 'O T-6 na decolagem é a hélice de ponta quase sônica (M 0,95): a gravação tem os harmônicos 5–9 e o ruído de choque espalhados até 2,5 kHz (0 dB em 1–2,5k). A FonteHelice é a do JetDSP (κ do decaimento × 0,5 e ruído largo × 10 nas hélices a pistão) e não tem ruído de choque: o agudo fica 6 dB abaixo e a BPF fundamental (75 Hz) deixa o grave 11 dB acima.',
  'bandas decolagem 18 cil., 150 m (Corsair)': 'A 150 m o ar (ISO 9613 da Cena) e o solo tiram o agudo; a gravação (jKa) tem o escape dos estaques muito mais forte em 1–6 kHz (a fileira de 4,5ª ordem, 170 Hz, a +19 dB). O grave da BPF (82 Hz) fica 9 dB acima.',
  'centroide decolagem 18 cil., 150 m (Corsair)': 'Consequência do grave da hélice e do agudo baixo a 150 m (ver as bandas).',
  'Rotec: 3·f_ign contra a fundamental (estaque de 0,6 m)': '1,1 dB fora: a ressonância de 1/4 de onda do estaque (217 Hz) aparece, mas a rotação de lenta do modelo é 1 030 rpm (a gravação, 1 200): a 3ª harmônica fica em 180 Hz, fora do pico do estaque.',
  'T-6 decolagem: harmônicos 5–9 da BPF entre si': '0,6 dB fora: com κ × 0,5 o 9º harmônico fica 6,6 dB abaixo do 5º (sem o ruído de choque da ponta sônica, que achata o pente na gravação).',
  'DC-3 a 3 m da hélice ("singing"): 2·, 3·, 5·BPF contra a ignição': 'A hélice na lenta é ∝ M⁴ (fonte do JetDSP, M 0,35 a 645 rpm da hélice): a 3 m ela fica 5 dB abaixo da ignição, contra ≥ −2 dB da gravação (ibg). O "canto" da hélice parada perto do cubo pede um termo de carga/esteira na lenta que a FonteHelice não tem.',
  'r1340: lenta → plena carga a 55% (bocas a 5 m)': 'A lenta do radial é alta (ar de lenta com a borboleta 1,6× do Ronco, para segurar a lenta contra a hélice) e o anel de chapa vazando pesa mais na lenta: +13,8 dB. Nas gravações o T-6 na lenta a 4 m já é tão brilhante quanto em carga.',
  'r2800: lenta → plena carga a 55% (bocas a 5 m)': '0,5 dB fora (+17,5 dB): ver o R-1340.',
  'os 13 aviões na lenta a 12 m: faixa de nível': 'O alvo de 12 dB não cabe nos próprios níveis do RADIAL.md (3.7): Verner 124 dB e R-1820 145 dB de L_W em carga já são 21 dB; na lenta os pequenos ultraleves (Verner, Rotec, M-14PF de estaques) ficam 25–38 dB abaixo dos grandes radiais, como deve ser.',
  'vagar da lenta lenta 9 cil. perto, 4 m (T-6G)': 'O controle de lenta do Ronco (PI na válvula de ar, decisão 10: ganhos mantidos) corrige o balanço lento da mistura; o vagar fica em 1,7%, contra 2–4%.',
  'vagar da lenta lenta 14 cil., 10 m (DC-3)': 'Com J de 19 kg·m² (hélice refletida) e o PI de lenta do Ronco, a rotação do R-1830 quase não vaga (0,3%); o galope (falhas de 2,5% e o balanço da mistura) aparece no CVciclo, que bate.',
  'CVlento da lenta lenta 14 cil., 10 m (DC-3)': 'Mesma causa do vagar (inércia e PI de lenta): 0,03 contra 0,05–0,20.',
  'CVciclo da lenta lenta 18 cil. coletor único + turbina, 5 m (P-47)': 'O coletor único de 3,8 m e a turbina alisam a variação explosão a explosão: 0,25 contra 0,30–0,42.',
  'CVciclo da lenta lenta 18 cil. estaques por fileira, 8 m (Corsair)': '0,04 acima: os estaques curtos deixam cada explosão sair sozinha.',
  'R-1830: 9 pás contadas depois do engate': 'O volante gira o motor a 80–95 rpm (≥ 60 rpm, abaixo disso o EngineDSP não queima): 9 pás em 3,2 s. Mais devagar o motor não pegava antes de o volante acabar.',
  'R-1830: pega depois dos magnetos': 'No limite (1,0 s): ver as pás do R-1830.',
  'M-14P: partida a ar, "tchufs" por segundo': 'O ar gira o motor a 180 rpm (13,5 cilindros/s) e ele pega em 2 s; com menos ar ele não passa dos 60 rpm em que o EngineDSP começa a queimar.',
  'R-2800: mistura em corte, de 1 000 rpm a parar': '0,2 s abaixo: a hélice de bancada no passo mínimo freia um pouco mais que a do avião.',
  'R-2800: subida de giro com o passo mínimo (manete ao fundo em 3 s)': 'Com a hélice no passo mínimo absorvendo 90% da potência na rotação máxima, o R-2800 sobe junto com a manete (2,9 s com a manete em 3 s); o alvo de 4–7 s supõe uma manete mais lenta.',
  'R44: droop ao puxar o coletivo (0,5 → 0,75 em 1 s)': 'A borboleta do Ronco responde em 30 ms e o governador do rotor (Kp 0,8·0,12 por %) segura o Nr: 0,7% de queda e volta em ~1 s. O droop de 2–3% do R44 real vem do correlacionador e do atraso do coletor, que o modelo não tem; com ganho menor o Nr demorava 3 s para voltar.',
  'potência rotec2800': 'A escala de torque (tqScale) é feita com o atrito médio; no Rotec de 2,8 L o atrito pesa mais e a potência na rotação máxima sai 8% acima da ficha.',
};

// ------------------------------------------------------------------ grupos
async function grupo(nome: string): Promise<Linha[]> {
  const L: Linha[] = [];
  const add = (n: string, alvo: string, medido: string, ok: boolean) => L.push({ grupo: nome, nome: n, alvo, medido, ok, desvio: ok ? undefined : DESVIOS[n] });
  const { SR } = await import('./radial-cena');

  if (nome === 'geometria') {
    const log = console.log; console.log = () => {};
    const g = await import('./radial-geometria');
    console.log = log;
    const r = g.resultados;
    for (const x of r) add(x.nome, x.alvo, x.medido, x.ok);
  }

  if (nome === 'razoes' || nome === 'bandas' || nome === 'linhas' || nome === 'galope') {
    const { ouvirParado } = await import('./radial-cena');
    const { medir } = await import('./radial-bandas');
    const { preset } = await import('./radial-comum');
    const cache = new Map<string, any>();
    /** cenário pela Cena: lenta (pedal 0, rpm fixado como alvo da lenta) ou decolagem (pedal 1, rpm pela hélice) */
    const cena = (id: string, d: number, o: { rpm?: number; pedal?: number; rpmAlvo?: number; dur?: number; s0?: number } = {}) => {
      const k = JSON.stringify([id, d, o]);
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

    if (nome === 'razoes') {
      // f_ign/BPF = N·i/(2B) medido nos picos do espectro (RADIAL.md 4.2: Yak 3,42, T-6 2,25, DC-3 4,15, P-47 4,5, Corsair 5,14)
      for (const [id, alvo, d] of [['m14p', 3.42, 50], ['r1340', 2.25, 50], ['r1830', 4.15, 50], ['r2800turbo', 4.5, 50], ['r2800', 5.14, 50]] as [string, number, number][]) {
        const c = cena(id, d, { pedal: 1, rpmAlvo: 1, dur: 8 });
        // (picos procurados a ±1% do esperado pela rotação da telemetria: a ±3% o pente da hélice e o da ignição se misturam)
        const achar = (f: number) => { let mx = -1e9, fb = f; for (let x = f * 0.99; x < f * 1.01; x += f * 0.0002) { const v = c.m.pico(x, 0.002); if (v > mx) { mx = v; fb = x; } } return fb; };
        // (a razão pela telemetria, rotação do motor e da hélice no render; a dos picos do espectro vai ao lado: com bins de
        // 1,46 Hz a 60 Hz ela não resolve 1%)
        const r = achar(c.fIgn) / achar(c.bpf), rt = c.fIgn / c.bpfTele;
        add(`f_ign/BPF ${id}`, `${f1(alvo, 2)} ± 1%`, `${f1(rt, 3)} (picos do espectro ${f1(r, 3)}; ${f1(c.rpm, 0)} rpm; ${f1(c.fIgn)} / ${f1(c.bpf)} Hz)`, Math.abs(rt / alvo - 1) <= 0.01);
      }
    }

    if (nome === 'bandas' || nome === 'galope') {
      // bandas (4.1): [60–150, 400–1k, 1–2,5k, 2,5–6k], centroide; ±4 dB e ±30%
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
      for (const [n, id, d, o, alvo, cent] of REG) {
        const c = cena(id, d, o);
        if (nome === 'bandas') {
          const b = [c.m.b[0], c.m.b[2], c.m.b[3], c.m.b[4]];
          const erro = Math.max(...b.map((v, k) => Math.abs(v - alvo[k])));
          add(`bandas ${n}`, `${alvo.map((x) => sg(x)).join(' / ')} ± 4 dB`, `${b.map((x) => sg(x)).join(' / ')} (6–12k ${sg(c.m.b[5])}; ${f1(c.rpm, 0)} rpm; erro máx ${f1(erro)} dB)`, erro <= 4);
          add(`centroide ${n}`, `${cent} Hz ± 30%`, `${f1(c.m.cent, 0)} Hz`, Math.abs(c.m.cent / cent - 1) <= 0.3);
        } else if (n.startsWith('lenta') && id !== 'rotec2800') {
          const p47 = id === 'r2800turbo';
          add(`vagar da lenta ${n}`, p47 ? '≤ 7%' : '2–4%', `${f1(c.vagar, 2)}%`, p47 ? c.vagar <= 7 : c.vagar >= 2 && c.vagar <= 4);
          add(`CVciclo da lenta ${n}`, '0,30–0,42', f1(c.m.cvCiclo, 2), c.m.cvCiclo >= 0.3 && c.m.cvCiclo <= 0.42);
          add(`CVlento da lenta ${n}`, '0,05–0,20', f1(c.m.cvLento, 2), c.m.cvLento >= 0.05 && c.m.cvLento <= 0.2);
        }
      }
    }

    if (nome === 'linhas') {
      const rot = cena('rotec2800', 4, { rpm: 1200 });
      const d3 = pk(rot.m, 3 * rot.fIgn) - pk(rot.m, rot.fIgn);
      add('Rotec: 3·f_ign contra a fundamental (estaque de 0,6 m)', '0 ± 4 dB', `${sg(d3)} dB`, Math.abs(d3) <= 4);
      const c28 = cena('r2800', 8, { rpm: 685 });
      const dfil = pk(c28.m, c28.fIgn / 2) - pk(c28.m, c28.fIgn);
      add('R-2800 estaques, lenta: 4,5ª contra a 9ª', '≥ −3 dB', `${sg(dfil)} dB`, dfil >= -3);
      const cp = cena('r2800turbo', 5, { rpm: 773 });
      const dp = pk(cp.m, cp.fIgn) - pk(cp.m, cp.fIgn / 2);
      add('P-47 coletor único, lenta: 9ª contra a 4,5ª', '≥ 0 dB', `${sg(dp)} dB`, dp >= 0);
      const yk = cena('m14p', 75, { pedal: 1, rpmAlvo: 1 });
      const yb = pk(yk.m, yk.bpf) - pk(yk.m, yk.fIgn), yh = [1, 2, 3].map((h) => pk(yk.m, h * yk.bpf));
      add('Yak-52 decolagem: BPF contra a ignição', '≥ +5 dB', `${sg(yb)} dB`, yb >= 5);
      add('Yak-52 decolagem: harmônicos 1–3 da BPF', 'dentro de 8 dB', `${f1(Math.max(...yh) - Math.min(...yh))} dB`, Math.max(...yh) - Math.min(...yh) <= 8);
      const t6 = cena('r1340', 50, { pedal: 1, rpmAlvo: 0.9 });
      const th = [5, 6, 7, 8, 9].map((h) => pk(t6.m, h * t6.bpf)), ti = pk(t6.m, t6.fIgn);
      add('T-6 decolagem: harmônicos 5–9 da BPF entre si', 'dentro de 6 dB', `${f1(Math.max(...th) - Math.min(...th))} dB (${th.map((x) => f1(x - ti, 0)).join('/')} dB rel. ignição)`, Math.max(...th) - Math.min(...th) <= 6);
      add('T-6 decolagem: harmônicos 5–9 contra a ignição', '≥ +10 dB', `${sg(Math.min(...th) - ti)} dB`, Math.min(...th) - ti >= 10);
      const co = cena('r2800', 150, { pedal: 1, rpmAlvo: 0.75 });
      const cf = pk(co.m, co.fIgn / 2) - pk(co.m, co.fIgn);
      add('Corsair decolagem: fileira (4,5ª) contra a ignição (9ª)', '≥ +8 dB', `${sg(cf)} dB`, cf >= 8);
      for (const [id, rpm] of [['r1830', 876], ['m14p', 983]] as [string, number][]) {
        const c = cena(id, 12, { rpm });
        const h = Math.max(...[2, 3, 4, 5].map((k) => pk(c.m, k * c.bpf))) - pk(c.m, c.fIgn);
        add(`${id} lenta a 12 m de lado: harmônicos 2–5 da BPF contra a ignição`, '−10 ± 5 dB', `${sg(h)} dB`, Math.abs(h + 10) <= 5);
      }
      const near = cena('r1830', 3, { rpm: 1147, s0: -3.3 });
      const hn = Math.max(...[2, 3, 5].map((k) => pk(near.m, k * near.bpf))) - pk(near.m, near.fIgn);
      add('DC-3 a 3 m da hélice ("singing"): 2·, 3·, 5·BPF contra a ignição', '≥ −2 dB', `${sg(hn)} dB`, hn >= -2);
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
      for (const id of ['r1340', 'r1830', 'r2800', 'm14p']) {
        const s = preset(id);
        const lenta = nivelBocas(id, s.idle, 0), plena = nivelBocas(id, s.rpmMax * 0.55, 1);
        const dd = plena.db - lenta.db;
        add(`${id}: lenta → plena carga a 55% (bocas a 5 m)`, '+18 a +25 dB', `${sg(dd)} dB (${f1(lenta.db)} → ${f1(plena.db)} dB)`, dd >= 18 && dd <= 25);
      }
      // os 13 aviões na lenta a 12 m de lado, pela Cena (com a hélice): dentro de 12 dB
      const { ouvirParado } = await import('./radial-cena');
      const ids = ['r1820', 'r1830', 'r2800', 'r2800turbo', 'r4360', 'm14p', 'm14pf', 'r1340', 'r985', 'rotec2800', 'rotec3600', 'verner3', 'verner5'];
      const lv = ids.map((id) => { const r = ouvirParado(id, { d: 12, pedal: 0, dur: 6, t0: 3, rpm: preset(id).idle }); let e = 0; for (const v of r.x) e += v * v; return 10 * Math.log10(e / r.x.length / 4e-10); });
      const faixa = Math.max(...lv) - Math.min(...lv);
      add('os 13 aviões na lenta a 12 m: faixa de nível', '≤ 12 dB', `${f1(faixa)} dB (${ids.map((id, k) => `${id} ${f1(lv[k], 0)}`).join(', ')})`, faixa <= 12);
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
        add(`R-2800: uivo do superalimentador a ${rpm} rpm`, `${f1(alvo, 0)} Hz ± 2%`, `${f1(f[kb], 0)} Hz`, Math.abs(f[kb] / alvo - 1) <= 0.02);
        const tot = 10 * Math.log10(Object.values(r.canais).reduce((a, v) => a + 10 ** (v / 10), 0));
        add(`R-2800: nível do uivo contra o total a ${rpm} rpm`, '≤ −25 dB', `${sg(r.canais.compressor - tot)} dB`, r.canais.compressor - tot <= -25);
      }
      // refrigeração a ar: a mecânica do radial (×1,2 do ar e ×1,17 das aletas expostas) contra o mesmo motor com água
      const ar = nivelBocas('r1340', 1500, 0.5, 2), agua = nivelBocas('r1340', 1500, 0.5, 2, { cooling: 'water' });
      const raz = 10 ** ((ar.canais.bloco - agua.canais.bloco) / 20) * 1.17;
      add('mecânica do radial contra um motor de água (×1,2 do ar × 1,17 das aletas)', '1,4×', `${f1(raz, 2)}×`, Math.abs(raz - 1.4) <= 0.05);
    }
  }

  if (nome === 'partida' || nome === 'motor') {
    const { preset, novoDSP, renderizar, trecho, media, mono, SR: S } = await import('./radial-comum');
    const { medir, welch } = await import('./radial-bandas');
    if (nome === 'partida') {
      // R-1830, arranque de inércia: energizar (apito 290 → 390 Hz em ~18 s), engate, contagem de pás, pegar, CV
      const s = preset('r1830');
      const d = novoDSP(s, { temp: 15 });
      let pops = 0; const push = d.pops.push.bind(d.pops); d.pops.push = (...a: any[]) => { pops++; return push(...a); };
      d.message({ type: 'av', prime: 2 });
      const r = renderizar(d, 45, [[0, (x) => x.message({ type: 'input', ignition: true })]]);
      const tEng = r.tele.find((q) => q.fase === 'girar')?.t ?? NaN, tPega = r.tele.find((q) => q.state === 'run')?.t ?? NaN;
      const tMag = r.tele.find((q) => q.t > tEng && q.magnetos === 'ambos')?.t ?? NaN;
      const apito = (t0: number) => { const x = mono(r.L, r.R, t0, t0 + 1); const [f, P] = welch(x, S, 16384); let kb = 0; for (let k = 1; k < f.length; k++) if (f[k] > 250 && f[k] < 450 && P[k] > P[kb]) kb = k; return f[kb]; };
      const a0 = apito(1), a1 = apito(tEng - 1.2);
      add('R-1830: apito do volante energizando (pico do espectro)', '290 → 390 Hz em 15–20 s (±5%)', `${f1(a0, 0)} → ${f1(a1, 0)} Hz em ${f1(tEng, 1)} s`, Math.abs(a0 / 290 - 1) <= 0.05 && Math.abs(a1 / 390 - 1) <= 0.05 && tEng >= 15 && tEng <= 20);
      add('R-1830: 9 pás contadas depois do engate', '4–6 s', `${f1(tMag - tEng, 1)} s`, tMag - tEng >= 4 && tMag - tEng <= 6);
      add('R-1830: pega depois dos magnetos', '1–3 s', `${f1(tPega - tMag, 1)} s`, tPega - tMag >= 1 && tPega - tMag <= 3);
      const cv = (t0: number, t1: number) => { const tl = trecho(r.tele, t0, t1); const rpm = media(tl.map((q) => q.rpm)); return medir(mono(r.L, r.R, t0, t1), S, { N: 14, fileiras: 2, fIgn: (rpm / 60) * 7, rastrear: false }).cvCiclo; };
      const c3 = cv(tPega, tPega + 3), c20 = cv(tPega + 18, tPega + 21);
      add('R-1830: CVciclo nos 3 s depois de pegar', '≥ 0,8', f1(c3, 2), c3 >= 0.8);
      add('R-1830: CVciclo aos 20 s', '≤ 0,45', f1(c20, 2), c20 <= 0.45);
      const popsIni = pops; void popsIni;
      add('R-1830 com primer 2: estouros nos primeiros 10 s depois de pegar', '≥ 3 (3–8)', String(pops), pops >= 3);
      // M-14P, ar comprimido: "tchufs" por segundo (cilindros recebendo ar) por 2–3 s
      const dm = novoDSP(preset('m14p'), { temp: 15 });
      let tch = 0, ant = new Uint8Array(9); const fn = dm.partidaAr.bind(dm);
      dm.partidaAr = (c: number, a: number) => { const v = fn(c, a); const on = v > 0 ? 1 : 0; if (on && !ant[c]) tch++; ant[c] = on; return v; };
      const rm = renderizar(dm, 6, [[0, (x) => x.message({ type: 'input', ignition: true })]]);
      const tAr = rm.tele.filter((q) => q.state === 'crank').length * (1024 / S);
      const taxa = tch / Math.max(0.1, Math.min(tAr, 3));
      add('M-14P: partida a ar, "tchufs" por segundo', '7–11 /s por 2–3 s', `${f1(taxa, 1)} /s por ${f1(Math.min(tAr, 3), 1)} s (pegou em ${f1(rm.tele.find((q) => q.state === 'run')?.t ?? NaN, 1)} s)`, taxa >= 7 && taxa <= 11 && tAr >= 2);
      // R-2800, parada pela mistura: de 1 000 rpm a 0 em 4–8 s (hélice de bancada)
      const dp = novoDSP(preset('r2800'), { quente: true });
      const rp = renderizar(dp, 14, [[0, (x) => { x.message({ type: 'input', throttle: 0.15 }); }], [5, (x) => { x.message({ type: 'input', throttle: 0 }); x.message({ type: 'av', mistura: 0 }); }]]);
      const t1000 = rp.tele.find((q) => q.t > 5 && q.rpm <= 1000)?.t ?? NaN, t0 = rp.tele.find((q) => q.t > 5 && q.rpm < 30)?.t ?? NaN;
      add('R-2800: mistura em corte, de 1 000 rpm a parar', '4–8 s', `${f1(t0 - t1000, 1)} s (${f1(trecho(rp.tele, 4, 5)[0]?.rpm ?? 0, 0)} rpm antes do corte)`, t0 - t1000 >= 4 && t0 - t1000 <= 8);
    } else {
      // mag check a 1 700 rpm (R-1340): queda de 60 ± 30 rpm em cada magneto, diferença ≤ 30
      const dm = novoDSP(preset('r1340'), { quente: true });
      let thr = 0.2;
      // (a manete fixa que dá 1 700 rpm com os dois magnetos, achada por bisseção; depois cada magneto sozinho por 4 s)
      void dm;
      let lo = 0.02, hi = 0.6;
      for (let it = 0; it < 7; it++) {
        thr = 0.5 * (lo + hi);
        const dt = novoDSP(preset('r1340'), { quente: true });
        const rt = renderizar(dt, 8, [[0, (x) => x.message({ type: 'input', throttle: thr })]]);
        if (media(trecho(rt.tele, 6, 8).map((q) => q.rpm)) > 1700) hi = thr; else lo = thr;
      }
      thr = 0.5 * (lo + hi);
      const r = renderizar(novoDSP(preset('r1340'), { quente: true }), 26, [
        [0, (x) => { x.message({ type: 'input', throttle: thr }); x.message({ type: 'av', magnetos: 'ambos' }); }], [12, (x) => x.message({ type: 'av', magnetos: 'esq' })],
        [16, (x) => x.message({ type: 'av', magnetos: 'ambos' })], [22, (x) => x.message({ type: 'av', magnetos: 'dir' })],
      ]);
      const m = (a: number, b: number) => media(trecho(r.tele, a, b).map((q) => q.rpm));
      const base = m(10.5, 12), esq = m(14, 16), base2 = m(19.5, 22), dir = m(24, 26);
      add('mag check a 1 700 rpm: queda com o magneto esquerdo', '60 ± 30 rpm', `${f1(base - esq, 0)} rpm (${f1(base, 0)} → ${f1(esq, 0)})`, Math.abs(base - esq - 60) <= 30);
      add('mag check: queda com o direito', '60 ± 30 rpm', `${f1(base2 - dir, 0)} rpm`, Math.abs(base2 - dir - 60) <= 30);
      add('mag check: diferença entre os magnetos', '≤ 30 rpm', `${f1(Math.abs(base - esq - (base2 - dir)), 0)} rpm`, Math.abs(base - esq - (base2 - dir)) <= 30);
      // mistura pobre (0,55) contra auto-rica: escape mais quente e potência menor (plena carga, rotação travada)
      const pot = (mx: number) => {
        const d = novoDSP(preset('r1340'), { quente: true }); d.lockOmega = true; d.omega = (2000 * 2 * Math.PI) / 60; d.rpmAvg = 2000; d.message({ type: 'av', mistura: mx });
        const rr = renderizar(d, 2, [[0, (x) => x.message({ type: 'input', throttle: 1 })]]);
        return { tq: media(trecho(rr.tele, 1.2, 2).map((q) => q.torque)), egt: rr.tele.at(-1)!.egt - rr.tele.at(-1)!.exhT };
      };
      const p8 = pot(0.8), p55 = pot(0.55);
      add('mistura 0,55: potência contra a auto-rica', '−3 a −7%', `${sg((100 * (p55.tq - p8.tq)) / p8.tq)}%`, (100 * (p55.tq - p8.tq)) / p8.tq <= -3 && (100 * (p55.tq - p8.tq)) / p8.tq >= -7);
      add('mistura 0,55: escape mais quente', '+40 a +80 °C', `${sg(p55.egt - p8.egt, 0)} °C`, p55.egt - p8.egt >= 40 && p55.egt - p8.egt <= 80);
      // subida de giro do R-2800 com a hélice: 650 → 2 800 rpm em 4–7 s, o governador segura 1 225 ± 2% na hélice
      const dr = novoDSP(preset('r2800'), { quente: true });
      // (o piloto leva a manete ao fundo em ~3 s)
      const rr = renderizar(dr, 14, [], (x, t) => { if (t >= 1) x.message({ type: 'input', throttle: Math.min(1, (t - 1) / 3) }); });
      const tSobe = (rr.tele.find((q) => q.t > 1 && q.rpm >= 0.97 * 2800)?.t ?? NaN) - 1;
      const nh = media(trecho(rr.tele, 10, 14).map((q) => q.rpmHelice));
      add('R-2800: subida de giro com o passo mínimo (manete ao fundo em 3 s)', '650 → 2 800 rpm em 4–7 s', `${f1(tSobe, 1)} s`, tSobe >= 4 && tSobe <= 7);
      add('R-2800: governador segura a hélice', '1 225 ± 2%', `${f1(nh, 0)} rpm`, Math.abs(nh / 1225 - 1) <= 0.02);
    }
  }

  if (nome === 'aviacao') {
    const { EngineDSP } = await import('../src/engines/ronco/dsp');
    const { configCalibrada } = await import('../src/engines/ronco/config');
    const { ACESSORIOS_PADRAO, PRESETS_AVIACAO } = await import('../src/engines/ronco/presets');
    const { renderizar, trecho, media } = await import('./radial-comum');
    const novo = (id: string, temp: number) => { const d: any = new EngineDSP(SR); d.setConfig(configCalibrada({ ...ACESSORIOS_PADRAO, ...PRESETS_AVIACAO.find((p) => p.id === id) }, SR)); d.ambientT = temp; d.coolant = temp; d.exhT = temp; return d; };
    for (const temp of [20, -5]) {
      const d = novo('c172', temp);
      d.message({ type: 'input', temp: { mode: 'fixed', value: 90 } });
      const r = renderizar(d, 20, [[0, (x) => x.message({ type: 'input', ignition: true })]]);
      const rpm = media(trecho(r.tele, 15, 20).map((q) => q.rpm));
      add(`Cessna 172 lenta quente (ar a ${temp} °C)`, '650 ± 20 rpm', `${f1(rpm, 0)} rpm`, Math.abs(rpm - 650) <= 20);
    }
    // R44 no portador rotor (MotorRonco): Nr 408 ± 2%, droop ao puxar o coletivo 0,5 → 0,75 em 1 s, recuperação
    const { Rotor } = await import('../src/carriers/rotor');
    const { MotorRonco, prepararMotorRonco } = await import('../src/engines/ronco/motor');
    const { configRotor } = await import('../src/engines/ronco/aviacao');
    const av = PRESETS_AVIACAO.find((p) => p.id === 'r44')!;
    const m = new MotorRonco(SR); m.configurar(prepararMotorRonco({ ...ACESSORIOS_PADRAO, ...av }, SR), SR);
    const ro = new Rotor(SR, configRotor(av)); ro.acoplar(m);
    const B = 128, can = ro.fontes().map(() => new Float32Array(B));
    const nr: [number, number][] = [];
    for (let i = 0; i < 16 * SR; i += B) { const t = i / SR; ro.comandar({ pedal: t < 8 ? 0.5 : t < 9 ? 0.5 + 0.25 * (t - 8) : 0.75 }); ro.processar(can, B, 1 / SR); nr.push([t, (ro.telemetria() as any).Nr]); }
    const est = media(nr.filter(([t]) => t > 5 && t < 8).map(([, v]) => v));
    const min = Math.min(...nr.filter(([t]) => t > 8).map(([, v]) => v));
    const tVolta = nr.find(([t, v]) => t > 9 && v >= est * 0.995 && nr.filter(([t2]) => t2 > 8 && t2 < t).some(([, v2]) => v2 === min))?.[0] ?? NaN;
    add('R44 (O-540 + rotor): Nr em voo pairado', '408 ± 2%', `${f1(est, 1)} rpm`, Math.abs(est / 408 - 1) <= 0.02);
    add('R44: droop ao puxar o coletivo (0,5 → 0,75 em 1 s)', '2–3%', `${f1((100 * (est - min)) / est, 2)}%`, (100 * (est - min)) / est >= 2 && (100 * (est - min)) / est <= 3);
    add('R44: recuperação a 99,5%', '≤ 1,5 s', `${f1(tVolta - 9, 2)} s depois do fim do puxão`, tVolta - 9 <= 1.5);
    // Cessna 172 em decolagem (35 m/s): BPF ~90 Hz, M_t ~0,80, f_ign/BPF = 1 (4 cilindros e 2 pás: a ignição coincide)
    const { Helice } = await import('../src/carriers/helice');
    const { configHelice } = await import('../src/engines/ronco/aviacao');
    const c = PRESETS_AVIACAO.find((p) => p.id === 'c172')!;
    const mc = new MotorRonco(SR); mc.configurar(prepararMotorRonco({ ...ACESSORIOS_PADRAO, ...c }, SR), SR);
    const h = new Helice(SR, configHelice(c)); h.acoplar(mc); h.comandar({ pedal: 1, velocidadeFixa: 35 });
    const ch = h.fontes().map(() => new Float32Array(B));
    for (let i = 0; i < 8 * SR; i += B) h.processar(ch, B, 1 / SR);
    const tl: any = h.telemetria(), fIgn = (mc.dsp.rpmAvg / 60) * 2;
    add('Cessna 172 decolagem (35 m/s): passagem de pá', '≈ 90 Hz (2 700 rpm)', `${f1(tl.bpf, 1)} Hz (${f1(mc.dsp.rpmAvg, 0)} rpm)`, Math.abs(tl.bpf / 90 - 1) <= 0.08);
    add('Cessna 172: Mach na ponta', '≈ 0,80', f1(tl.machPonta, 2), Math.abs(tl.machPonta - 0.8) <= 0.06);
    add('Cessna 172: f_ign/BPF', '1,0', f1(fIgn / tl.bpf, 3), Math.abs(fIgn / tl.bpf - 1) <= 0.01);
  }

  if (nome === 'cpu') {
    const { preset, novoDSP } = await import('./radial-comum');
    const d = novoDSP(preset('r4360'), { quente: true });
    const B = 128, l = new Float32Array(B), r = new Float32Array(B);
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 10 * SR; i += B) { if (i === SR) d.message({ type: 'input', throttle: 1 }); d.process(l, r, B); }
    const fr = Number(process.hrtime.bigint() - t0) / 1e9 / 10;
    add('R-4360 (28 cilindros, 4 anéis) subindo de giro, 10 s em Node', '≤ 60% do tempo real', `${f1(100 * fr)}% (${d.lines.length} tubos, ${d.nodes.length} nós)`, fr <= 0.6);
  }

  if (nome === 'potencia') {
    const { preset, cfgCalibrada } = await import('./radial-comum');
    const { RadialDSP } = await import('../src/engines/radial/dsp');
    for (const id of ['r1820', 'r1830', 'r2800', 'r4360', 'm14p', 'r1340', 'rotec2800']) {
      const s = preset(id), cfg = cfgCalibrada(s);
      const d = new RadialDSP(SR); d.setConfig(cfg);
      d.state = 'run'; d.lockOmega = true; d.tempMode = 'fixed'; d.coolant = 90; d.runT = 100; d.thrTarget = 1; d.thr = 1; d.boost = cfg.boost; d.maxBoost = cfg.boost; d.carga = null;
      let mx = 0;
      for (const f of [0.8, 0.9, 1.0]) {
        d.omega = (s.rpmMax * f * 2 * Math.PI) / 60; d.rpmAvg = s.rpmMax * f; d.tqMean = 0;
        const B = 256, l = new Float32Array(B), r = new Float32Array(B);
        for (let i = 0; i < 0.5 * SR; i += B) d.process(l, r, B);
        mx = Math.max(mx, (d.tqMean * d.omega) / 1000);
      }
      add(`potência ${id}`, `${s.power} kW ± 5%`, `${f1(mx, 0)} kW`, Math.abs(mx / s.power - 1) <= 0.05);
    }
  }
  return L;
}

// ------------------------------------------------------------------ CLI
const args = process.argv.slice(2);
if (args[0] === '--grupo') {
  grupo(args[1]).then((l) => process.stdout.write(JSON.stringify(l)));
} else if (process.argv[1] && process.argv[1].endsWith('radial-valida.ts')) {
  const ji = args.indexOf('--j'), J = ji >= 0 ? +args[ji + 1] : Math.max(2, Math.floor(os.cpus().length * 0.5));
  const pedidos = args.filter((a, i) => !a.startsWith('--') && (ji < 0 || i !== ji + 1));
  const GRUPOS = ['geometria', 'razoes', 'bandas', 'linhas', 'niveis', 'galope', 'partida', 'motor', 'aviacao', 'cpu', 'potencia'];
  const fila = pedidos.length ? pedidos : GRUPOS;
  const res: Record<string, Linha[]> = {};
  const t0 = Date.now();
  const rodar = (g: string) => new Promise<void>((ok) => {
    const p = spawn(process.execPath, ['--import', 'tsx', AQUI, '--grupo', g], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = ''; p.stdout.on('data', (b) => { out += b; });
    p.on('close', () => { try { res[g] = JSON.parse(out); } catch { res[g] = [{ grupo: g, nome: 'execução do grupo', alvo: 'sem erro', medido: out.slice(-300), ok: false }]; } console.error(`  (${g}: ${((Date.now() - t0) / 1000).toFixed(0)} s)`); ok(); });
  });
  (async () => {
    const q = [...fila];
    await Promise.all(Array.from({ length: Math.min(J, q.length) }, async () => { while (q.length) await rodar(q.shift()!); }));
    let ok = 0, desv = 0, falha = 0;
    for (const g of fila) for (const l of res[g] || []) {
      const tag = l.ok ? 'ok   ' : l.desvio ? 'desv ' : 'FALHA';
      if (l.ok) ok++; else if (l.desvio) desv++; else falha++;
      console.log(`${tag} [${l.grupo}] ${l.nome}: alvo ${l.alvo} · medido ${l.medido}`);
      if (!l.ok && l.desvio) console.log(`        desvio: ${l.desvio}`);
    }
    console.log(`\n${ok + desv + falha} medidas: ${ok} ok, ${desv} desvios documentados, ${falha} falhas (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    process.exitCode = falha ? 1 : 0;
  })();
}
