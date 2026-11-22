#!/usr/bin/env python3
"""eletrico-vida.py — mede o que faz uma máquina elétrica simulada "soar a sintetizador": linhas paradas e perfeitas
sobre silêncio, onde a gravação tem linhas vivas sobre um piso. Complementa o kit ouvido (tools/ouvido), que supõe um
ciclo só: uma máquina elétrica tem várias famílias de linhas sem múltiplo comum (ordens do eixo, f_e com escorregamento,
portadora fixa do inversor, auxiliares na frequência da rede), então aqui as linhas são achadas pelo espectro, sem f0.

    python3 -I tools/eletrico-vida.py REAL.wav SIM.wav [--trecho-real a-b] [--trecho-sim a-b] [--linhas 6]
                                      [--fmin 100] [--fmax 6000] [--saida pasta/] [--titulo "…"]
    python3 -I tools/eletrico-vida.py ARQ.wav [--trecho a-b]          (um arquivo só)

Só vale em REGIME (rotação parada ou portadora fixa): numa aceleração as ordens varrem e a medida de linha perde o
sentido; escolha patamares.

Por banda (as do projeto, relativas à âncora de 150–400 Hz):
  nível      potência total da banda
  linhas     potência dos picos estreitos acima do piso (mediana corrida do espectro fino)
  HNR        linhas ÷ piso, dB (sem supor f0)
  piso       potência do piso entre as linhas
  planura    média geométrica ÷ aritmética do PISO na banda, dB (0 = liso como ruído branco; negativa = com relevo)
  n          quantas linhas passam de 10 dB sobre o piso
Por linha (as N mais fortes de [fmin, fmax]): cada uma é trazida a zero por heteródino e filtrada em ±B Hz
(B = 2,5% da frequência, de 6 a 40 Hz), o que dá a amplitude e a frequência instantâneas:
  sobre o piso   pico da linha acima do piso local, dB
  AM             desvio-padrão do nível da linha no tempo, dB (uma senoide parada dá 0; uma linha real respira)
  taxa AM        a taxa que mais modula a amplitude, Hz
  FM             desvio-padrão da frequência instantânea, em centésimos de semitom, tirada a deriva linear
  deriva         inclinação da frequência no trecho, centésimos por segundo (Doppler, rotação mudando)
  largura        largura de banda equivalente da linha, Hz (uma senoide parada dá ~1,5/T)
  saia           potência a ±(3…B) Hz do centro ÷ potência do centro (±3 Hz), dB: as bandas laterais e o ruído colado
A figura (com --saida) mostra o espectro fino em volta das linhas mais fortes, real e simulado, cada um relativo ao pico.
"""
import argparse
import json
import os
import sys

import numpy as np
from scipy import signal

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ouvido'))
import nucleo as nu  # noqa: E402

BANDAS = [(20, 60), (60, 150), (150, 400), (400, 1000), (1000, 2500), (2500, 6000), (6000, 12000)]
NOMES = ['20-60', '60-150', '150-400', '400-1k', '1-2,5k', '2,5-6k', '6-12k']


def espectro(x, fs):
    """Welch fino (≥ 6 segmentos de Hann, resolução de até 0,37 Hz) e o piso (mediana corrida, corrigida para a média)."""
    n = 1 << int(np.floor(np.log2(max(4096, len(x) / 3.5))))
    n = min(n, 1 << 17)
    f, P = signal.welch(x, fs, window='hann', nperseg=n, noverlap=n // 2, detrend=False)
    L = len(x) // (n // 2) - 1
    df = f[1] - f[0]
    logP = np.log(P + 1e-300)
    # mediana corrida de largura proporcional à frequência (4% de f, pelo menos 12 Hz): segue o relevo e ignora as linhas
    piso = np.empty_like(P)
    larg = np.maximum(12.0, 0.04 * f) / df
    cs = None
    from scipy.ndimage import median_filter
    # (poucas larguras distintas: faixas de oitava)
    edges = [0, 150, 300, 600, 1200, 2400, 4800, 9600, fs]
    for a, b in zip(edges[:-1], edges[1:]):
        m = (f >= a) & (f < b)
        if not m.any():
            continue
        w = int(np.median(larg[m])) | 1
        piso[m] = np.exp(median_filter(logP, size=max(9, w), mode='nearest')[m])
    corr = nu._corr_mediana(max(1, L))
    piso = piso / corr
    return f, P, piso, df, n


def achar_linhas(f, P, piso, fmin, fmax, limiar_db=8.0):
    """Picos estreitos acima do piso: (f, potência líquida da linha, dB sobre o piso), do mais forte para o mais fraco."""
    df = f[1] - f[0]
    R = 10 * np.log10(P / piso)
    pk, _ = signal.find_peaks(R, height=limiar_db, distance=max(2, int(3 / df)))
    out = []
    for p in pk:
        if f[p] < fmin or f[p] > fmax:
            continue
        a, b = max(0, p - 2), min(len(P), p + 3)
        liq = float(np.sum(P[a:b] - piso[a:b]) * df)
        if liq <= 0:
            continue
        # interpolação parabólica do pico
        if 0 < p < len(P) - 1:
            y0, y1, y2 = np.log(P[p - 1]), np.log(P[p]), np.log(P[p + 1])
            d = 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2) if (y0 - 2 * y1 + y2) != 0 else 0.0
        else:
            d = 0.0
        out.append({'f': float(f[p] + d * df), 'pot': liq, 'sobre_db': float(R[p])})
    out.sort(key=lambda q: -q['pot'])
    return out


def bandas(f, P, piso, linhas):
    df = f[1] - f[0]
    anc = np.sum(P[(f >= 150) & (f < 400)]) * df
    res = []
    for (lo, hi) in BANDAS:
        m = (f >= lo) & (f < hi)
        tot = np.sum(P[m]) * df
        pis = min(tot, np.sum(piso[m]) * df)
        lin = max(tot - pis, 0.0)
        pm = piso[m]
        plan = 10 * np.log10(np.exp(np.mean(np.log(pm))) / np.mean(pm)) if m.sum() > 3 else float('nan')
        n10 = sum(1 for q in linhas if lo <= q['f'] < hi and q['sobre_db'] >= 10)
        res.append({'nivel': float(nu.db10(tot / anc)), 'linhas': float(nu.db10(max(lin, 1e-30) / anc)), 'piso': float(nu.db10(pis / anc)),
                    'hnr': float(np.clip(nu.db10(max(lin, 1e-30) / max(pis, 1e-30)), -30, 60)), 'planura': float(plan), 'n': n10})
    return res


def vida_da_linha(x, fs, f0):
    """Amplitude e frequência instantâneas de uma linha (heteródino + passa-baixa)."""
    B = float(min(40.0, max(6.0, 0.025 * f0)))
    t = np.arange(len(x)) / fs
    z = x * np.exp(-2j * np.pi * f0 * t)
    # decima para ~16·B antes de filtrar (estável numericamente)
    dec = max(1, int(fs / (16 * B)))
    sos = signal.butter(4, B / (fs / 2), output='sos')
    z = signal.sosfiltfilt(sos, z)[::dec]
    fsd = fs / dec
    k = int(0.25 * fsd)
    z = z[k:-k] if len(z) > 4 * k else z
    a = np.abs(z)
    lvl = 20 * np.log10(a + 1e-30)
    ph = np.unwrap(np.angle(z))
    td = np.arange(len(z)) / fsd
    # frequência instantânea alisada em 50 ms (a fase de uma linha fraca sobre ruído é ruidosa)
    fi = np.gradient(ph, td) / (2 * np.pi)
    w = max(3, int(0.05 * fsd) | 1)
    fi = np.convolve(fi, np.ones(w) / w, mode='same')[w:-w]
    tf = td[w:-w]
    cents = 1200 * np.log2(np.maximum(f0 + fi, 1e-6) / f0)
    c = np.polyfit(tf, cents, 1)
    res = cents - np.polyval(c, tf)
    # taxa dominante da modulação de amplitude (0,5–B Hz)
    env = lvl - np.mean(lvl)
    F, S = signal.welch(env, fsd, nperseg=min(len(env), int(4 * fsd)), detrend='linear')
    m = (F >= 0.5) & (F <= B)
    taxa = float(F[m][np.argmax(S[m])]) if m.any() else float('nan')
    # largura equivalente e saia, do espectro do sinal já em banda base
    nfft = 1 << int(np.ceil(np.log2(len(z))))
    Z = np.abs(np.fft.fft(z * np.hanning(len(z)), nfft)) ** 2
    fz = np.fft.fftfreq(nfft, 1 / fsd)
    Z = np.fft.fftshift(Z)
    fz = np.fft.fftshift(fz)
    # centra no pico
    fpk = fz[np.argmax(Z)]
    dfz = fz[1] - fz[0]
    mB = np.abs(fz - fpk) <= B * 0.9
    larg = float((np.sum(Z[mB]) * dfz) ** 2 / (np.sum(Z[mB] ** 2) * dfz))
    centro = np.sum(Z[np.abs(fz - fpk) <= 3.0])
    saia = np.sum(Z[mB & (np.abs(fz - fpk) > 3.0)])
    return {'B': B, 'am_db': float(np.std(lvl)), 'am_taxa': taxa, 'fm_cents': float(np.std(res)), 'deriva_cents_s': float(c[0]),
            'largura_hz': larg, 'saia_db': float(10 * np.log10(max(saia, 1e-30) / max(centro, 1e-30))), 'dur': float(len(z) / fsd)}


def medir(arq, trecho, n_linhas, fmin, fmax):
    x, fs = nu.ler_audio(arq, trecho)
    f, P, piso, df, n = espectro(x, fs)
    todas = achar_linhas(f, P, piso, 20.0, 12000.0)
    cand = [q for q in todas if fmin <= q['f'] <= fmax][:n_linhas]
    for q in cand:
        q.update(vida_da_linha(x, fs, q['f']))
    anc = np.sum(P[(f >= 150) & (f < 400)]) * df
    for q in cand:
        q['nivel_db'] = float(nu.db10(q['pot'] / anc))
    return {'arquivo': os.path.basename(str(arq)), 'trecho': list(trecho) if trecho else None, 'dur': len(x) / fs, 'df': float(df),
            'bandas': bandas(f, P, piso, todas), 'linhas': cand, 'n_linhas_10db': sum(1 for q in todas if q['sobre_db'] >= 10),
            '_f': f, '_P': P, '_piso': piso, '_anc': anc}


def mediana_linhas(m, campo):
    v = [q[campo] for q in m['linhas'] if np.isfinite(q.get(campo, np.nan))]
    return float(np.median(v)) if v else float('nan')


def imprimir(ms, rot):
    print('por banda (dB re 150–400 Hz):   ' + '   |   '.join(f'{r:^44s}' for r in rot))
    print('banda     ' + '   |   '.join('  nível linhas   piso    HNR planura  n   ' for _ in ms))
    for i, nome in enumerate(NOMES):
        cols = []
        for m in ms:
            b = m['bandas'][i]
            cols.append(f"{b['nivel']:7.1f} {b['linhas']:6.1f} {b['piso']:6.1f} {b['hnr']:6.1f} {b['planura']:7.1f} {b['n']:3d}   ")
        print(f'{nome:9s} ' + '   |   '.join(cols))
    for m, r in zip(ms, rot):
        print(f"\nlinhas mais fortes de {r} ({m['n_linhas_10db']} linhas a mais de 10 dB do piso no espectro inteiro):")
        print('     Hz   nível  s/piso    AM  taxa AM     FM   deriva  largura   saia')
        for q in m['linhas']:
            print(f"{q['f']:7.1f} {q['nivel_db']:7.1f} {q['sobre_db']:7.1f} {q['am_db']:5.2f} {q['am_taxa']:7.1f} {q['fm_cents']:7.2f} {q['deriva_cents_s']:7.2f} {q['largura_hz']:8.2f} {q['saia_db']:6.1f}")
        print(f"  medianas: AM {mediana_linhas(m, 'am_db'):.2f} dB · FM {mediana_linhas(m, 'fm_cents'):.2f} cents · largura {mediana_linhas(m, 'largura_hz'):.2f} Hz · saia {mediana_linhas(m, 'saia_db'):.1f} dB · sobre o piso {mediana_linhas(m, 'sobre_db'):.1f} dB")


def figura(ms, rot, arq, titulo):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    cores = ['#1f6fd0', '#e8632b']
    k = min(3, min(len(m['linhas']) for m in ms)) if all(m['linhas'] for m in ms) else 0
    fig = plt.figure(figsize=(15, 9.5), dpi=80)
    gs = fig.add_gridspec(2, max(3, k), height_ratios=[1.15, 1])
    ax = fig.add_subplot(gs[0, :])
    for m, r, c in zip(ms, rot, cores):
        f, P, piso = m['_f'], m['_P'], m['_piso']
        df = f[1] - f[0]
        ax.semilogx(f[1:], 10 * np.log10(P[1:] * df / m['_anc']), color=c, lw=0.6, alpha=0.85, label=r)
        ax.semilogx(f[1:], 10 * np.log10(piso[1:] * df / m['_anc']), color=c, lw=1.4, ls='--', alpha=0.9)
    ax.set_xlim(20, 12000)
    yy = np.concatenate([10 * np.log10(m['_P'][(m['_f'] > 30) & (m['_f'] < 8000)] * (m['_f'][1] - m['_f'][0]) / m['_anc']) for m in ms])
    ax.set_ylim(np.percentile(yy, 1) - 6, yy.max() + 4)
    ax.set_xlabel('Hz'); ax.set_ylabel('dB por raia, re 150–400 Hz'); ax.grid(True, which='both', alpha=0.25)
    ax.set_title((titulo + ' — ' if titulo else '') + 'espectro fino (cheio) e piso entre as linhas (tracejado)', fontsize=11)
    ax.legend(loc='upper right')
    for j in range(k):
        a2 = fig.add_subplot(gs[1, j])
        for m, r, c in zip(ms, rot, cores):
            q = m['linhas'][j]
            f, P = m['_f'], m['_P']
            mm = np.abs(f - q['f']) <= 60
            a2.plot(f[mm] - q['f'], 10 * np.log10(P[mm] / P[mm].max()), color=c, lw=0.9, label=f"{r.split(' ')[0]} {q['f']:.0f} Hz · AM {q['am_db']:.1f} dB · FM {q['fm_cents']:.1f} c")
        a2.set_ylim(-70, 3); a2.set_xlim(-60, 60); a2.grid(True, alpha=0.25)
        a2.set_xlabel('Hz em volta da linha'); a2.set_ylabel('dB re pico')
        a2.set_title(f'{j + 1}ª linha mais forte de cada lado', fontsize=10)
        a2.legend(fontsize=8, loc='lower center')
    plt.tight_layout()
    plt.savefig(arq)
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('real'); ap.add_argument('sim', nargs='?')
    ap.add_argument('--trecho'); ap.add_argument('--trecho-real'); ap.add_argument('--trecho-sim')
    ap.add_argument('--linhas', type=int, default=6); ap.add_argument('--fmin', type=float, default=100.0); ap.add_argument('--fmax', type=float, default=6000.0)
    ap.add_argument('--saida'); ap.add_argument('--titulo', default='')
    a = ap.parse_args()
    ms = [medir(a.real, nu.parse_trecho(a.trecho_real or a.trecho), a.linhas, a.fmin, a.fmax)]
    rot = ['REAL ' + ms[0]['arquivo']]
    if a.sim:
        ms.append(medir(a.sim, nu.parse_trecho(a.trecho_sim), a.linhas, a.fmin, a.fmax))
        rot.append('SIM ' + ms[1]['arquivo'])
    else:
        rot = [ms[0]['arquivo']]
    if a.titulo:
        print(a.titulo)
    imprimir(ms, rot)
    if a.saida:
        os.makedirs(a.saida, exist_ok=True)
        figura(ms, rot, os.path.join(a.saida, 'vida.png'), a.titulo)
        limpo = [{k: v for k, v in m.items() if not k.startswith('_')} for m in ms]
        with open(os.path.join(a.saida, 'vida.json'), 'w') as fh:
            json.dump(nu.limpar({'titulo': a.titulo, 'lados': limpo, 'bandas_hz': BANDAS}), fh, ensure_ascii=False, indent=1)
        print(f"\ngravado em {a.saida}: vida.png, vida.json")


if __name__ == '__main__':
    main()
