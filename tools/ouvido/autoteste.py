#!/usr/bin/env python3
"""autoteste.py — confere as medidas do kit ouvido contra sinais sintéticos de resposta conhecida.

    python3 -I tools/ouvido/autoteste.py [-v] [--so nome]        (npm run ouvido:teste)

Cada teste planta um valor num sinal e exige que a medida devolva o que foi plantado:

  hnr            série harmônica + ruído com relação conhecida por banda → HNR a ±1 dB (giro fixo, giro com vibrato
                 rastreado pelo f0.py, ciclo de 150 Hz de F1)
  liso-x-pulsado ruído liso × o mesmo ruído modulado no ciclo, com o MESMO espectro médio: as bandas médias não podem
                 separar os dois (< 0,5 dB) e as medidas de envoltória têm de separar (p90/p10, vão, modulação na
                 ignição, fração presa ao ciclo, distâncias de envoltória e modulação)
  tom            tom espúrio fora das ordens (parado em Hz, e preso ao giro numa ordem não inteira) → detectado, com a
                 frequência certa; sem o tom, nada é detectado ali
  oitava         erros de oitava plantados: a linha mais forte é o 13º harmônico do ciclo (o caso do Mustang); a ignição
                 domina e as meias ordens são fracas; e um motor perfeitamente regular (não pode inventar sub-harmônico)
  periodica      fração periódica: ~0 para ruído, ~1 para sinal periódico
  ganho          a distância não muda quando o simulado é gravado 20 dB mais alto (normalização pela âncora)
  eventos        variação entre explosões plantada (CV) e estalos plantados (por segundo) → medidos
  orcamento      fontes somadas com frações conhecidas → fração por banda de cada uma a ±1 dB, e quem enche o vão
  wav            leitura de PCM 16 e float 32, mono e estéreo, e reamostragem de 44,1 kHz

Sai com código 1 se algum falhar.
"""
import argparse
import os
import sys
import tempfile
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nucleo as nu  # noqa: E402
import sinteticos as si  # noqa: E402
import f0 as F0  # noqa: E402
import comparar as cp  # noqa: E402
import orcamento as orc  # noqa: E402

FS = nu.FS
RES = []
VERB = False


def confere(nome, cond, texto):
    RES.append((nome, bool(cond), texto))
    print(f"  [{'ok' if cond else 'FALHOU'}] {texto}")


def motor(dur, f0, ev, snr_db, vib=0.0, deriva=0.0, meias_db=-10.0, incl_ruido=-3.0, cil=None, semente=3):
    fase = si.fase_ciclo(dur, f0, vib, 0.7, deriva)
    h = si.serie_harmonica(fase, si.amps_motor(f0, ev, meias_db=meias_db, cilindros=cil))
    h /= h.std()
    nz = si.ruido(len(h), incl_ruido, semente=semente) * 10 ** (-snr_db / 20)
    return h + nz, fase, h, nz


# ------------------------------------------------------------------------------------------------------- hnr
def t_hnr():
    print('hnr: série harmônica + ruído em relação conhecida por banda')
    casos = [('giro fixo, f0 10,4 Hz (V8 a 1250 rpm)', 10.4, 8, 10, 0.0, 0.0, (4, 40), False),
             ('vibrato de ±1,5% e deriva, fase rastreada pelo f0.py', 10.4, 8, 10, 0.015, 0.01, (4, 40), True),
             ('4 cilindros a 2800 rpm, vibrato ±1%, rastreado', 23.4, 4, 6, 0.01, 0.0, (4, 60), True),
             ('ciclo de 150 Hz (F1 a 18.000 rpm), vibrato ±1%, rastreado', 150.0, 8, 10, 0.01, 0.0, (80, 200), True)]
    for nome, f0, ev, snr, vib, der, faixa, rastrear in casos:
        x, fase, h, nz = motor(12, f0, ev, snr, vib, der)
        if rastrear:
            r = F0.rastrear(x, FS, faixa[0], faixa[1])
            fase_m = r['fase']
            ef = 100 * abs(r['f0'] / f0 - 1)
        else:
            fase_m = fase; ef = 0.0
        m = nu.analisar(x, fase_m, ev, detalhe=False)
        Hb = nu.energia_bandas(h, FS); Nb = nu.energia_bandas(nz, FS)
        erros = []
        linhas = []
        for i, b in enumerate(m['bandas']):
            plant = float(nu.db10(Hb[i] / Nb[i]))
            usar = b['n_linhas'] >= 3 and -10 <= plant <= 30
            linhas.append(f"      {b['banda']:8s} plantado {plant:6.1f}  medido {b['hnr']:6.1f}  {'' if usar else '(fora do teste)'}")
            if usar:
                erros.append(abs(b['hnr'] - plant))
        if VERB:
            print('\n'.join(linhas))
        confere('hnr', max(erros) <= 1.0 and ef < 0.5, f'{nome}: erro máximo do HNR {max(erros):.2f} dB em {len(erros)} bandas (limite 1,0)' + (f', f0 a {ef:.2f}%' if rastrear else ''))


# ------------------------------------------------------------------------------------------ liso × pulsado
def t_liso_pulsado():
    print('liso-x-pulsado: mesmo espectro médio, envoltória diferente')
    f0, ev = 10.4, 8
    fase = si.fase_ciclo(12, f0)
    h = si.serie_harmonica(fase, si.amps_motor(f0, ev))
    h /= h.std()
    liso = si.ruido(len(h), -4.0, semente=5) * 0.5
    puls = si.mesmo_espectro(si.modular_no_ciclo(si.ruido(len(h), -4.0, semente=6), fase, ev, 0.95, 0.22), liso)
    a = {'x': h + puls, 'fs': FS, 'med': nu.analisar(h + puls, fase, ev, detalhe=False), 'avisos': []}   # "real": chiado colado ao pulso
    b = {'x': h + liso, 'fs': FS, 'med': nu.analisar(h + liso, fase, ev, detalhe=False), 'avisos': []}   # "simulado": chiado liso
    dn = max(abs(ba['nivel_rel'] - bb['nivel_rel']) for ba, bb in zip(a['med']['bandas'], b['med']['bandas']))
    confere('liso-x-pulsado', dn < 0.5, f'bandas médias NÃO separam: maior diferença de nível por banda {dn:.2f} dB (limite 0,5)')
    ga, gb = a['med']['faixa_1_6k'], b['med']['faixa_1_6k']
    rr = gb['ref_ruido']
    confere('liso-x-pulsado', abs(gb['p90_p10'] - rr['p90_p10']) < 1.0 and abs(gb['vao'] - rr['vao']) < 1.0,
            f"o liso bate com a referência de ruído estacionário: p90/p10 {gb['p90_p10']:.1f} dB (ref. {rr['p90_p10']:.1f}), vão {gb['vao']:.1f} dB (ref. {rr['vao']:.1f})")
    confere('liso-x-pulsado', ga['p90_p10'] - gb['p90_p10'] > 6 and gb['vao'] - ga['vao'] > 4,
            f"p90/p10 de 1–6 kHz: pulsado {ga['p90_p10']:.1f} dB × liso {gb['p90_p10']:.1f} dB; vão: {ga['vao']:.1f} × {gb['vao']:.1f} dB")
    confere('liso-x-pulsado', ga['m_ign'] > 0.5 and gb['m_ign'] < 0.08 and ga['frac_ign'] > 0.6 and abs(gb['frac_ign']) < 0.08,
            f"modulação na ignição: {ga['m_ign']:.2f} × {gb['m_ign']:.2f}; fração presa à ignição: {ga['frac_ign']:.2f} × {gb['frac_ign']:.2f}")
    c = cp.comparar(a, b)
    d = c['distancias']
    confere('liso-x-pulsado', d['envoltoria'] > 3 and d['modulacao'] > 3 and d['tonal'] < 0.5,
            f"distâncias: envoltória {d['envoltoria']:.1f}, modulação {d['modulacao']:.1f} (as duas > 3); timbre tonal {d['tonal']:.2f} (< 0,5); piso {d['piso']:.2f}")
    txt = ' | '.join(r['texto'] for r in c['resumo'][:2])
    confere('liso-x-pulsado', 'A MENOS: pulso' in txt or 'A MENOS: modulação' in txt, f"o resumo aponta a falta de pulso primeiro: “{c['resumo'][0]['texto'][:90]}…”")
    dh = max(abs(max(ba['hnr'], -15) - max(bb['hnr'], -15)) for ba, bb in zip(a['med']['bandas'][1:6], b['med']['bandas'][1:6]))
    confere('liso-x-pulsado', dh < 1.5, f'o HNR não confunde ruído pulsado com tom: maior diferença {dh:.2f} dB (limite 1,5)')


# ------------------------------------------------------------------------------------------------------- tom
def t_tom():
    print('tom: tons que não são ordens')
    f0, ev = 10.4, 8
    x, fase, h, nz = motor(12, f0, ev, 8)
    t = np.arange(len(x)) / FS
    m0 = nu.analisar(x, fase, ev, detalhe=False)
    confere('tom', len(m0['tons']) == 0, f"sem tom plantado: {len(m0['tons'])} detectado(s)")
    ft = 3137.0
    xt = x + 10 ** (-28 / 20) * np.sqrt(2) * np.std(x) * np.sin(2 * np.pi * ft * t)
    m1 = nu.analisar(xt, fase, ev, detalhe=False)
    ach = [a for a in m1['tons'] if abs(a['f'] / ft - 1) < 0.003]
    confere('tom', len(ach) == 1 and ach[0]['proeminencia'] >= 10 and ach[0]['tipo'] == 'parado em Hz' and len(m1['tons']) == 1,
            f"tom de {ft:.0f} Hz a −28 dB do total: " + (f"achado em {ach[0]['f']:.1f} Hz, {ach[0]['proeminencia']:.0f} dB sobre o piso, {ach[0]['tipo']}, estabilidade {ach[0]['estabilidade_pct']:.3f}%" if ach else 'NÃO achado')
            + f" ({len(m1['tons'])} no total)")
    # preso ao giro, ordem não inteira (compressor de parafusos: 11,8× o giro = 23,6× o ciclo), com vibrato
    x2, fase2, _, _ = motor(12, f0, ev, 8, vib=0.015)
    xo = x2 + 10 ** (-25 / 20) * np.sqrt(2) * np.std(x2) * np.sin(23.6 * 2 * fase2)   # 2º harmônico do uivo: 47,2× o ciclo ≈ 491 Hz
    r = F0.rastrear(xo, FS, 4, 40)
    m2 = nu.analisar(xo, r['fase'], ev, detalhe=False)
    alvo = 23.6 * 2
    ach = [a for a in m2['tons'] if abs(a['ordem_ciclo'] - alvo) < 0.2]
    confere('tom', len(ach) >= 1 and ach[0]['tipo'] == 'preso ao giro',
            f"tom preso ao giro na ordem {alvo:.1f} do ciclo, com vibrato de ±1,5%: " + (f"achado na ordem {ach[0]['ordem_ciclo']:.2f} ({ach[0]['f']:.0f} Hz), {ach[0]['proeminencia']:.0f} dB sobre o piso, {ach[0]['tipo']}" if ach else 'NÃO achado'))


# ---------------------------------------------------------------------------------------------------- oitava
def t_oitava():
    print('oitava: erros de oitava plantados')
    # (a) a linha mais forte é o 13º harmônico do ciclo (REVISAO-DE-SOM, caso do Mustang)
    f0, ev = 10.4, 8
    fase = si.fase_ciclo(12, f0, 0.012, 0.6)
    am = si.amps_motor(f0, ev, meias_db=-6, cilindros=[1, 0.55, 0.9, 0.7, 1.1, 0.6, 0.8, 0.95])
    am[12] = 2.0 * am.max()   # o 13º harmônico (135,2 Hz) fica 6 dB acima da ignição e 20 dB ou mais acima do resto
    x = si.serie_harmonica(fase, am); x /= x.std()
    x = x + si.ruido(len(x), -3.0) * 10 ** (-8 / 20)
    r = F0.rastrear(x, FS, 4, 40)
    confere('oitava', abs(r['f0'] / f0 - 1) < 0.005 and abs(r['linha_hz'] - 13 * f0) < 1.5,
            f"a linha mais forte é o 13º harmônico: f0 achado {r['f0']:.3f} Hz (plantado {f0}; linha de referência {r['linha_hz']:.1f} Hz = harmônico {r['N']}; tomá-la pela ignição de um V8 daria {r['linha_hz'] / 8:.2f} Hz)")
    # (a2) a ignição domina (as outras linhas 16 dB ou mais abaixo): uma linha forte sozinha não pode esconder o ciclo
    am2 = si.amps_motor(f0, ev, meias_db=-6, cilindros=[1, 0.55, 0.9, 0.7, 1.1, 0.6, 0.8, 0.95])
    x2 = si.serie_harmonica(fase, am2); x2 /= x2.std()
    x2 = x2 + si.ruido(len(x2), -3.0) * 10 ** (-8 / 20)
    r2 = F0.rastrear(x2, FS, 4, 40)
    confere('oitava', abs(r2['f0'] / f0 - 1) < 0.005, f"V8 com a ignição 16 dB acima das outras linhas: f0 achado {r2['f0']:.3f} Hz (plantado {f0}; a ignição é {ev * f0:.1f} Hz)")
    # (b) ignição dominante, cilindros desiguais (meias ordens ~15 dB abaixo): o ciclo é a ignição ÷ 4
    f0b, evb = 23.4, 4
    xb, fb, _, _ = motor(12, f0b, evb, 14, vib=0.01, cil=[1.0, 0.5, 0.85, 0.65])
    rb = F0.rastrear(xb, FS, 4, 60)
    confere('oitava', abs(rb['f0'] / f0b - 1) < 0.005,
            f"4 cilindros desiguais, ignição a {evb * f0b:.1f} Hz: f0 achado {rb['f0']:.3f} Hz (plantado {f0b}; o pente sozinho dava {rb['pente_hz']:.2f} Hz)")
    # (c) motor perfeitamente regular: o período verdadeiro É o da ignição; não pode inventar sub-harmônico
    fc = si.fase_ciclo(12, 20.0, 0.01)
    am = si.amps_motor(20.0, 1)   # todas as linhas são múltiplos de 20 Hz
    xc = si.serie_harmonica(fc, am); xc /= xc.std()
    xc = xc + si.ruido(len(xc), -3.0) * 10 ** (-8 / 20)
    rc = F0.rastrear(xc, FS, 4, 60)
    confere('oitava', abs(rc['f0'] / 20.0 - 1) < 0.005, f"série regular de 20 Hz, busca de 4 a 60 Hz: f0 achado {rc['f0']:.3f} Hz (não pode cair para 10 ou 5 Hz, nem subir para 40)")
    # (d) rotação dada com uma oitava de erro: o kit tem de avisar
    rd = F0.rastrear(x, FS, 4, 40, nominal=2 * f0)
    confere('oitava', any('confira a rotação' in a for a in rd['avisos']), 'rotação nominal dada com o dobro do valor: sai o aviso para conferir a rotação')


# ------------------------------------------------------------------------------------------------- periodica
def t_periodica():
    print('periodica: fração periódica sem viés')
    rng = np.random.default_rng(4)
    w = rng.standard_normal(200 * 256)
    fp_r = nu.fracao_periodica(nu.dobrar(w, 256))
    per = np.tile(rng.standard_normal(256), 200)
    fp_p = nu.fracao_periodica(nu.dobrar(per, 256))
    mist = per + w
    fp_m = nu.fracao_periodica(nu.dobrar(mist, 256))
    confere('periodica', abs(fp_r) < 0.03 and fp_p > 0.999 and abs(fp_m - 0.5) < 0.05, f'ruído {fp_r:+.3f} (≈ 0), periódico {fp_p:.3f} (≈ 1), metade de cada {fp_m:.3f} (≈ 0,5)')


# ----------------------------------------------------------------------------------------------------- ganho
def t_ganho():
    print('ganho: a comparação não depende do ganho da gravação')
    xa, fa, _, _ = motor(10, 10.4, 8, 10)
    xb, fb, _, _ = motor(10, 10.4, 8, 4, semente=9)
    A = {'x': xa, 'fs': FS, 'med': nu.analisar(xa, fa, 8, detalhe=False), 'avisos': []}
    B1 = {'x': xb, 'fs': FS, 'med': nu.analisar(xb, fb, 8, detalhe=False), 'avisos': []}
    B2 = {'x': 10 * xb, 'fs': FS, 'med': nu.analisar(10 * xb, fb, 8, detalhe=False), 'avisos': []}
    d1 = cp.comparar(A, B1)['distancias']; d2 = cp.comparar(A, B2)['distancias']
    dif = max(abs(d1[k] - d2[k]) for k in cp.COMPONENTES)
    c2 = cp.comparar(A, B2)
    confere('ganho', dif < 1e-3 and abs(c2['ganho_sim_db'] - (cp.comparar(A, B1)['ganho_sim_db'] - 20)) < 0.01,
            f"simulado 20 dB mais alto: maior mudança nas distâncias {dif:.1e}; ganho de casamento {c2['ganho_sim_db']:+.1f} dB (20 dB a menos que antes)")
    confere('ganho', d1['piso'] > 1.0 and d1['tonal'] < 1.0, f"6 dB a mais de ruído no simulado: distância do piso {d1['piso']:.2f} (> 1), timbre tonal {d1['tonal']:.2f} (< 1)")
    d0 = cp.comparar(A, A)['distancias']
    confere('ganho', max(d0[k] for k in cp.COMPONENTES) < 1e-9, 'um sinal contra ele mesmo: todas as distâncias zero')


# --------------------------------------------------------------------------------------------------- eventos
def t_eventos():
    print('eventos: irregularidade entre explosões e estalos')
    f0, ev, dur = 10.0, 4, 16
    n = int(dur * FS)
    fase = si.fase_ciclo(dur, f0)
    rng = np.random.default_rng(12)
    # trem de pulsos (um por explosão) com amplitude sorteada: CV plantado 0,25, e um peso fixo por cilindro
    per = FS / (f0 * ev)
    nev = int(n / per) - 1
    cv = 0.25
    amp = np.clip(1 + cv * rng.standard_normal(nev), 0.2, 2.0)
    pes = np.array([1.0, 0.8, 1.1, 0.9]); amp *= pes[np.arange(nev) % ev]
    x = np.zeros(n)
    tt = np.arange(int(0.02 * FS)) / FS
    pulso = np.sin(2 * np.pi * 140 * tt) * np.exp(-tt / 0.004)
    chi = nu.passa_faixa(rng.standard_normal(n), 1000, 6000)
    env = np.zeros(n)
    for k in range(nev):
        i = int(round((k + 0.25) * per))
        x[i:i + len(pulso)] += amp[k] * pulso
        j = np.arange(i, min(n, i + int(0.006 * FS)))
        env[j] += amp[k] * np.exp(-(j - i) / (0.002 * FS))
    x = x + 0.3 * chi * env + 0.002 * rng.standard_normal(n)
    m = nu.analisar(x, fase, ev, detalhe=False)
    plant = float(np.std(amp) / np.mean(amp))
    amp4 = amp[:nev - nev % ev].reshape(-1, ev)
    plant_c = float(np.mean(amp4.std(0) / amp4.mean(0)))
    plant_d = float(amp4.mean(0).std() / amp4.mean())
    g = m['grave']
    confere('eventos', abs(g['cv_evento'] - plant) < 0.04 and abs(g['cv_ciclo'] - plant_c) < 0.04 and abs(g['desigualdade'] - plant_d) < 0.04,
            f"CV entre explosões no grave: medido {g['cv_evento']:.3f} (plantado {plant:.3f}); mesmo cilindro {g['cv_ciclo']:.3f} ({plant_c:.3f}); desigualdade fixa {g['desigualdade']:.3f} ({plant_d:.3f})")
    q = m['faixa_1_6k']
    confere('eventos', abs(q['picos_s'] - ev * f0) < 0.15 * ev * f0 and q['picos_irregulares_s'] < 1.0,
            f"rajada seca em toda explosão ({ev * f0:.0f}/s): picos {q['picos_s']:.1f}/s; fora do padrão do ciclo {q['picos_irregulares_s']:.1f}/s (regulares não contam)")
    # estalos isolados: 3 por segundo, em instantes sorteados, 16 dB acima do pulso regular
    y = x.copy()
    ne = int(3 * dur)
    for i in rng.integers(FS, n - FS, ne):
        j = np.arange(i, i + int(0.008 * FS))
        y[j] += 6.0 * 0.3 * rng.standard_normal(len(j)) * np.exp(-(j - i) / (0.002 * FS))
    y = y + 0  # (o chiado dos estalos é largo: cai em 1–6 kHz)
    m2 = nu.analisar(y, fase, ev, detalhe=False)
    q2 = m2['faixa_1_6k']
    confere('eventos', abs(q2['picos_irregulares_s'] - 3.0) < 0.8 and q2['curtose'] > 1.5 * q['curtose'],
            f"3 estalos por segundo plantados: fora do padrão {q2['picos_irregulares_s']:.1f}/s; curtose {q2['curtose']:.0f} contra {q['curtose']:.0f} sem eles")


# ------------------------------------------------------------------------------------------------- orcamento
def t_orcamento():
    print('orcamento: fração de cada fonte por banda e no vão')
    f0, ev = 10.4, 8
    fase = si.fase_ciclo(10, f0)
    h = si.serie_harmonica(fase, si.amps_motor(f0, ev, fmax=2500.0)); h /= h.std()
    liso = nu.passa_faixa(si.ruido(len(h), 0.0, semente=21), 800, 8000) * 0.20      # "sopro": liso, enche o vão
    puls = si.modular_no_ciclo(nu.passa_faixa(si.ruido(len(h), 0.0, semente=22), 800, 8000), fase, ev, 0.97, 0.2) * 0.35   # "jato": colado ao pulso
    tudo = h + liso + puls
    with tempfile.TemporaryDirectory() as d:
        nu.gravar_wav(os.path.join(d, 'x_tudo.wav'), tudo)
        nu.gravar_wav(os.path.join(d, 'x_sem-sopro.wav'), h + puls)
        nu.gravar_wav(os.path.join(d, 'x_sem-jato.wav'), h + liso)
        nu.gravar_wav(os.path.join(d, 'x_sem-tom.wav'), liso + puls)
        r = orc.orcamento(d, f0=f0, ev=ev, fixo=True)
    ib = 4   # 1–2,5 kHz
    E = {k: nu.energia_bandas(v, FS)[ib] for k, v in (('sopro', liso), ('jato', puls), ('tom', h))}
    tot = nu.energia_bandas(tudo, FS)[ib]
    erros = []
    for k in ('sopro', 'jato', 'tom'):
        plant = float(nu.db10(E[k] / tot)); med = r['fontes'][k]['bandas_db'][ib]
        erros.append(abs(plant - med))
    confere('orcamento', max(erros) < 1.0, f"fração por fonte em 1–2,5 kHz: erro máximo {max(erros):.2f} dB (plantado sopro {nu.db10(E['sopro'] / tot):.1f}, jato {nu.db10(E['jato'] / tot):.1f}, tom {nu.db10(E['tom'] / tot):.1f} dB)")
    vs, vj = r['fontes']['sopro']['vao_1_6k'], r['fontes']['jato']['vao_1_6k']
    confere('orcamento', vs > 0.7 and vj < 0.3 and r['fontes']['jato']['bandas_frac'][ib] > r['fontes']['sopro']['bandas_frac'][ib],
            f"quem enche o vão de 1–6 kHz: sopro liso {100 * vs:.0f}%, jato colado ao pulso {100 * vj:.0f}% (embora o jato tenha {100 * r['fontes']['jato']['bandas_frac'][ib]:.0f}% da energia da banda e o sopro {100 * r['fontes']['sopro']['bandas_frac'][ib]:.0f}%)")


# ------------------------------------------------------------------------------------------------------- wav
def t_wav():
    print('wav: leitura')
    from scipy.io import wavfile
    t = np.arange(FS) / FS
    s = 0.5 * np.sin(2 * np.pi * 440 * t)
    with tempfile.TemporaryDirectory() as d:
        wavfile.write(os.path.join(d, 'a.wav'), FS, (s * 32767).astype(np.int16))
        wavfile.write(os.path.join(d, 'b.wav'), FS, np.stack([s, 0 * s], 1).astype(np.float32))
        t44 = np.arange(44100) / 44100
        wavfile.write(os.path.join(d, 'c.wav'), 44100, (0.5 * np.sin(2 * np.pi * 440 * t44)).astype(np.float32))
        a, fa = nu.ler_audio(os.path.join(d, 'a.wav'))
        b, _ = nu.ler_audio(os.path.join(d, 'b.wav'))
        be, _ = nu.ler_audio(os.path.join(d, 'b.wav'), canal='e')
        c, fc = nu.ler_audio(os.path.join(d, 'c.wav'), trecho=(0.25, 0.75))
    ok = (abs(a.std() - s.std()) < 1e-3 and abs(b.std() - 0.5 * s.std()) < 1e-3 and abs(be.std() - s.std()) < 1e-3 and fc == FS and abs(len(c) - FS // 2) <= 2
          and abs(c[2000:-2000].std() - s.std()) < 2e-3)
    confere('wav', ok, 'PCM 16 mono, float 32 estéreo (média e canal E), 44,1 kHz reamostrado para 48 kHz com trecho')


TESTES = {'hnr': t_hnr, 'liso-x-pulsado': t_liso_pulsado, 'tom': t_tom, 'oitava': t_oitava, 'periodica': t_periodica, 'ganho': t_ganho, 'eventos': t_eventos,
          'orcamento': t_orcamento, 'wav': t_wav}


def main():
    global VERB
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('-v', action='store_true'); ap.add_argument('--so')
    a = ap.parse_args()
    VERB = a.v
    t0 = time.time()
    for nome, fn in TESTES.items():
        if a.so and nome != a.so:
            continue
        fn()
    falhas = [r for r in RES if not r[1]]
    print(f"\n{len(RES) - len(falhas)} de {len(RES)} conferências passaram em {time.time() - t0:.0f} s" + ('' if not falhas else ' — FALHAS: ' + '; '.join(sorted({f[0] for f in falhas}))))
    sys.exit(1 if falhas else 0)


if __name__ == '__main__':
    main()
