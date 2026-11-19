#!/usr/bin/env python3
"""diesel-ouvido-bandas.py — nível por banda de um ou mais WAVs (dBFS e relativo a uma banda de referência), com as
bandas do kit ouvido. Serve para acertar a forma do espectro de uma fonte isolada (por exemplo, só a mecânica:
`tools/diesel-ouvido-render.ts <preset> x.wav --rpm R --sem escape,admissao,vib,turbo`).

    python3 -I tools/diesel-ouvido-bandas.py [--ref 4] A.wav [B.wav ...]      (--ref: índice da banda de referência; 4 = 1–2,5 kHz)
"""
import os
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, 'ouvido'))
import nucleo as nu  # noqa: E402

args = sys.argv[1:]
ref = 4
if args and args[0] == '--ref':
    ref = int(args[1]); args = args[2:]
print(f"{'arquivo':44s} " + ' '.join(f'{n:>8s}' for n in nu.NOMES) + '  | pond. A  (dBFS; entre parênteses, relativo a ' + nu.NOMES[ref] + ')')
for a in args:
    x, fs = nu.ler_audio(a)
    E = nu.db10(nu.energia_bandas(x, fs))
    f, P = nu.psd_welch(x, fs)
    A = float(nu.db10((P * nu.ponderacao_a(f)).sum() * (f[1] - f[0])))
    print(f'{os.path.basename(a)[:44]:44s} ' + ' '.join(f'{v:8.1f}' for v in E) + f'  | {A:6.1f}')
    print(f"{'':44s} " + ' '.join(f'({v - E[ref]:+6.1f})' for v in E))
