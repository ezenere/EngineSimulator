#!/usr/bin/env python3
"""vapor-patinagem.py — mede uma patinagem numa gravação ou num render: a taxa de chuffs e a energia de cada chuff ao
longo do tempo, e o que muda do trecho aderido para o surto.

    python3 -I tools/vapor-patinagem.py ARQUIVO.wav [--trecho a-b] [--fmin 1.5] [--fmax 30] [--tabela]

Como mede: envoltória RMS de 5 ms da banda 150–3000 Hz; picos a pelo menos 0,6/fmax s um do outro e 3 dB de proeminência
(um chuff = um pico); a taxa local é o inverso do intervalo entre picos (mediana de 5) e a energia de um chuff é a
integral da potência da banda de um vale ao seguinte. O "surto" é o trecho em que a taxa passa de 1,8× a mediana dos 30%
mais lentos; sai a taxa antes e no surto, a energia por chuff do surto relativa à de antes (dB) e a potência média do
surto relativa à de antes (dB). `--tabela` imprime chuff a chuff. O programa não ouve nada: confira no espectrograma
(`tools/referencias/medir.py --espectrograma`) que os picos do surto são chuffs e não apito nem sino.

Limite conhecido: numa gravação com chiado forte (purgadores abertos, guincho de roda) o detector acha picos de ruído a
20–30 por segundo em todo o trecho. Aperte `--fmax` para perto da taxa esperada no surto (a 844 do acervo patina de ~2
para ~7 chuffs/s: `--fmax 10`) e escolha o trecho pelo espectrograma; serve bem nos renders (`vapor-fontes.ts --patinagem`).
"""
import argparse
import os
import sys

import numpy as np
from scipy import signal

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, 'ouvido'))
import nucleo as nu  # noqa: E402


def medir(x, fs, fmin=1.5, fmax=30.0):
    sos = signal.butter(4, [150, 3000], btype='bandpass', fs=fs, output='sos')
    y = signal.sosfiltfilt(sos, x) ** 2
    n = int(0.005 * fs)
    p = np.convolve(y, np.ones(n) / n, mode='same')
    db = 10 * np.log10(p + 1e-14)
    pk, _ = signal.find_peaks(db, distance=max(1, int(0.6 * fs / fmax)), prominence=3)
    if len(pk) < 6:
        return None
    vales = [pk[i] + int(np.argmin(p[pk[i]:pk[i + 1]])) for i in range(len(pk) - 1)]
    t, taxa, en, pico = [], [], [], []
    for i in range(1, len(pk) - 1):
        a, b = vales[i - 1], vales[i]
        t.append(pk[i] / fs); taxa.append(fs / (0.5 * (pk[i + 1] - pk[i - 1]))); en.append(float(np.sum(y[a:b]) / fs)); pico.append(float(db[pk[i]]))
    t = np.array(t); taxa = signal.medfilt(np.array(taxa), 5); en = np.array(en); pico = np.array(pico)
    ok = (taxa >= fmin) & (taxa <= fmax)
    return {'t': t[ok], 'taxa': taxa[ok], 'energia': en[ok], 'pico': pico[ok]}


def resumo(m):
    taxa = m['taxa']
    base = np.median(np.sort(taxa)[:max(3, int(0.3 * len(taxa)))])
    surto = taxa > 1.8 * base
    antes = taxa < 1.25 * base
    if surto.sum() < 3 or antes.sum() < 3:
        return {'base': float(base), 'surto': None}
    e_a, e_s = np.median(m['energia'][antes]), np.median(m['energia'][surto])
    r_s = float(np.percentile(taxa[surto], 90))
    return {'base': float(base), 'surto': r_s, 'razao': r_s / float(base), 'n_surto': int(surto.sum()), 'energia_db': float(10 * np.log10(e_s / e_a)),
            'potencia_db': float(10 * np.log10(e_s * np.median(taxa[surto]) / (e_a * np.median(taxa[antes])))), 'pico_db': float(np.median(m['pico'][surto]) - np.median(m['pico'][antes])),
            't_surto': [float(m['t'][surto][0]), float(m['t'][surto][-1])]}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('arquivo'); ap.add_argument('--trecho'); ap.add_argument('--fmin', type=float, default=1.5); ap.add_argument('--fmax', type=float, default=30.0)
    ap.add_argument('--tabela', action='store_true')
    a = ap.parse_args()
    x, fs = nu.ler_audio(a.arquivo, nu.parse_trecho(a.trecho))
    m = medir(x, fs, a.fmin, a.fmax)
    if m is None:
        print('poucos picos: não deu para medir'); return
    if a.tabela:
        t0 = nu.parse_trecho(a.trecho)[0] if a.trecho else 0.0
        for i in range(len(m['t'])):
            print(f"{t0 + m['t'][i]:7.2f} s  {m['taxa'][i]:5.1f} chuffs/s  energia {10 * np.log10(m['energia'][i] + 1e-14):6.1f} dB  pico {m['pico'][i]:6.1f} dB")
    r = resumo(m)
    if r['surto'] is None:
        print(f"{os.path.basename(a.arquivo)}: {len(m['t'])} chuffs, taxa de base {r['base']:.1f}/s, nenhum surto (taxa > 1,8× a de base)")
    else:
        print(f"{os.path.basename(a.arquivo)}: taxa de base {r['base']:.1f}/s · surto até {r['surto']:.1f}/s ({r['razao']:.1f}×, {r['n_surto']} chuffs, de {r['t_surto'][0]:.1f} a {r['t_surto'][1]:.1f} s) · "
              f"energia por chuff no surto {r['energia_db']:+.1f} dB · pico de cada chuff {r['pico_db']:+.1f} dB · potência média {r['potencia_db']:+.1f} dB (re aderido)")


if __name__ == '__main__':
    main()
