#!/usr/bin/env python3
"""eletrico-bandas.py — nível por banda de um ou mais WAVs, absoluto e relativo a 150–400 Hz.

    python3 -I tools/eletrico-bandas.py ARQ.wav[:a-b] [ARQ2.wav[:a-b] …] [--dba]

Para os renders do tools/eletrico-fontes.ts (em Pa) o nível absoluto sai em dB SPL; para as gravações (ganho arbitrário)
só vale a coluna relativa. Serve para ver de que fonte vem cada banda (os `_so-<fonte>.wav` lado a lado) e para acertar
o nível de uma fonte contra a gravação casada. `--dba` acrescenta o nível ponderado A.
"""
import os
import sys

import numpy as np
from scipy import signal

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ouvido'))
import nucleo as nu  # noqa: E402

BANDAS = [(20, 60), (60, 150), (150, 400), (400, 1000), (1000, 2500), (2500, 6000), (6000, 12000)]


def medir(arq, trecho):
    x, fs = nu.ler_audio(arq, trecho)
    n = min(32768, 1 << int(np.floor(np.log2(len(x) / 2))))
    f, P = signal.welch(x, fs, window='hann', nperseg=n, noverlap=n // 2, detrend=False)
    df = f[1] - f[0]
    b = [float(np.sum(P[(f >= lo) & (f < hi)]) * df) for lo, hi in BANDAS]
    tot = float(np.sum(P[(f >= 20) & (f < 20000)]) * df)
    A = nu.ponderacao_a(np.maximum(f, 1.0))
    totA = float(np.sum(P[(f >= 20) & (f < 20000)] * A[(f >= 20) & (f < 20000)] ** 2) * df)
    return b, tot, totA


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    dba = '--dba' in sys.argv
    if not args:
        print(__doc__)
        sys.exit(2)
    print(f"{'arquivo':46s} " + ' '.join(f'{lo}-{hi}'.rjust(9) for lo, hi in BANDAS) + '     total' + ('     dB(A)' if dba else '') + '   | relativo a 150–400 Hz')
    for a in args:
        arq, _, tr = a.partition(':') if (':' in a and not os.path.exists(a)) else (a, '', '')
        b, tot, totA = medir(arq, nu.parse_trecho(tr) if tr else None)
        spl = [10 * np.log10(v / 4e-10 + 1e-30) for v in b]
        rel = [10 * np.log10((v + 1e-30) / (b[2] + 1e-30)) for v in b]
        nome = os.path.basename(arq)[-44:] + (f':{tr}' if tr else '')
        print(f'{nome:46s} ' + ' '.join(f'{v:9.1f}' for v in spl) + f' {10 * np.log10(tot / 4e-10 + 1e-30):9.1f}' + (f' {10 * np.log10(totA / 4e-10 + 1e-30):9.1f}' if dba else '')
              + '   | ' + ' '.join(f'{v:+6.1f}' for v in rel))


if __name__ == '__main__':
    main()
