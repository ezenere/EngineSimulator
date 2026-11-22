#!/usr/bin/env python3
"""rotativo-espectro.py — espectrogramas lado a lado de uma gravação e de um render, para o que o kit ouvido não mede:
aceleradas em ponto morto e outros trechos em que a rotação varia depressa. Mesma escala de frequência (log), mesma
faixa dinâmica, os dois nivelados pela banda de 150–400 Hz. É para olhar: as riscas das ordens subindo com o giro, o
que há entre elas (névoa = ar) e se o agudo acompanha cada explosão.

    python3 -I tools/rotativo-espectro.py REAL.wav SIM.wav saida.png [--trecho-real a-b] [--trecho-sim a-b] [--titulo "…"]
"""
import argparse
import os
import sys

import numpy as np
from scipy import signal

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ouvido'))
import nucleo as nu  # noqa: E402


def espectro(x, fs):
    n = 2048
    f, t, Z = signal.stft(x, fs, window='hann', nperseg=n, noverlap=n - 256, boundary=None, padded=False)
    return f, t, np.abs(Z) ** 2


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('real'); ap.add_argument('sim'); ap.add_argument('saida')
    ap.add_argument('--trecho-real'); ap.add_argument('--trecho-sim'); ap.add_argument('--titulo', default='')
    a = ap.parse_args()
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    lados = []
    for arq, tr in ((a.real, a.trecho_real), (a.sim, a.trecho_sim)):
        x, fs = nu.ler_audio(arq, nu.parse_trecho(tr))
        anc = nu.energia_bandas(x, fs)[nu.IDX_REF]
        f, t, P = espectro(x / np.sqrt(max(anc, 1e-30)), fs)
        lados.append((os.path.basename(arq) + (f' [{tr} s]' if tr else ''), f, t, 10 * np.log10(P + 1e-12)))
    topo = max(np.percentile(L[3], 99.9) for L in lados)
    fig, eixos = plt.subplots(1, 2, figsize=(15, 5.2), facecolor='#fcfcfb', sharey=True)
    for ax, (nome, f, t, L), cor in zip(eixos, lados, ('#2a78d6', '#e8662f')):
        m = (f >= 40) & (f <= 12000)
        ax.pcolormesh(t, f[m], L[m], vmin=topo - 70, vmax=topo, cmap='gray_r', shading='auto', rasterized=True)
        ax.set_yscale('log'); ax.set_yticks([50, 100, 200, 400, 1000, 2500, 6000, 12000]); ax.set_yticklabels(['50', '100', '200', '400', '1k', '2,5k', '6k', '12k'])
        ax.set_xlabel('s'); ax.set_title(nome, fontsize=10, color=cor, loc='left')
    eixos[0].set_ylabel('Hz')
    fig.suptitle((a.titulo + ' · ' if a.titulo else '') + 'espectrogramas nivelados pela banda de 150–400 Hz, 70 dB de faixa', fontsize=10, x=0.01, ha='left')
    fig.tight_layout()
    fig.savefig(a.saida, dpi=100, facecolor='#fcfcfb')
    print('gravado', a.saida)


if __name__ == '__main__':
    main()
