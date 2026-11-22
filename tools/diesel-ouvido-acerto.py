#!/usr/bin/env python3
"""diesel-ouvido-acerto.py — acerto do nível da mecânica (`mecanica`, dB) de cada preset do Diesel.

Para cada preset renderiza a lenta quente (giro travado na lenta do preset, ouvinte `ext`) com tudo e sem a mecânica,
com a mesma semente; a diferença é a mecânica (ela soma na saída). Com as duas partes separadas por banda, calcula
para qualquer acerto Δ o espectro resultante (resto + Δ·mecânica) e diz qual Δ põe a banda de 1–2,5 kHz no alvo
relativo a 150–400 Hz, e quanto do som ponderado A fica sendo mecânica.

    python3 -I tools/diesel-ouvido-acerto.py [--alvo -3] [--ouvinte ext] [--rpm R] [--comb x] preset [preset ...]

Os alvos usados nesta passada (ouvinte ext, lenta): picapes e carros −3 dB; caminhões, ônibus e gerador +1 dB;
locomotivas −5 dB (faixas das gravações de fora: referencias/INDEX.md, classes do TECNICO.md → Diesel).
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, os.path.join(AQUI, 'ouvido'))
import nucleo as nu  # noqa: E402


def render(preset, saida, args):
    cmd = [os.path.join(RAIZ, 'node_modules', '.bin', 'tsx'), os.path.join(AQUI, 'diesel-ouvido-render.ts'), preset, saida] + [str(a) for a in args]
    r = subprocess.run(cmd, cwd=RAIZ, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stdout + r.stderr)
    with open(saida[:-4] + '.json') as fh:
        return json.load(fh)


def pot_a(x, fs):
    f, P = nu.psd_welch(x, fs)
    return float((P * nu.ponderacao_a(f)).sum() * (f[1] - f[0]))


def um(preset, a, pasta):
    with open(os.path.join(RAIZ, 'src', 'engines', 'diesel', 'presets.ts')) as fh:
        txt = fh.read()
    i = txt.index(f"id: '{preset}'")
    import re
    idle = float(re.search(r'idle: (\d+)', txt[i:]).group(1))
    rpm = a.rpm or idle
    base = ['--rpm', rpm, '--ouvinte', a.ouvinte, '--dur', 6]
    t = os.path.join(pasta, preset + '_tudo.wav'); s = os.path.join(pasta, preset + '_sem.wav')
    info = render(preset, t, base + (['--comb', a.comb] if a.comb is not None else []))
    render(preset, s, base + ['--comb', repr(info['comb']), '--sem', 'mecanica'])
    x, fs = nu.ler_audio(t); y, _ = nu.ler_audio(s)
    n = min(len(x), len(y)); x = x[:n]; y = y[:n]; m = x - y
    Er, Em = nu.energia_bandas(y, fs), nu.energia_bandas(m, fs)
    Ar, Am = pot_a(y, fs), pot_a(m, fs)
    def com(d):
        g = 10 ** (d / 10)
        E = Er + g * Em
        return nu.db10(E / E[2]), g * Am / (Ar + g * Am)
    # Δ que põe 1–2,5 kHz no alvo (bisseção; a banda de referência também recebe mecânica)
    lo, hi = -40.0, 40.0
    for _ in range(40):
        md = 0.5 * (lo + hi)
        if com(md)[0][4] < a.alvo: lo = md
        else: hi = md
    d = 0.5 * (lo + hi)
    r0, f0 = com(0.0); r1, f1 = com(d)
    return preset, rpm, r0, f0, d, r1, f1, nu.db10(Em / Em[4])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('presets', nargs='+')
    ap.add_argument('--alvo', type=float, default=-3.0); ap.add_argument('--ouvinte', default='ext')
    ap.add_argument('--rpm', type=float); ap.add_argument('--comb', type=float)
    a = ap.parse_args()
    with tempfile.TemporaryDirectory() as pasta, ThreadPoolExecutor(min(len(a.presets), 12)) as pool:
        print(f"{'preset':10s}  rpm | agora: 60-150 400-1k 1-2,5k 2,5-6k  6-12k  mec.(A) |    Δ  | com Δ: 60-150 400-1k 1-2,5k 2,5-6k  6-12k  mec.(A) | só a mecânica: 150-400 400-1k 2,5-6k 6-12k (re 1–2,5k)")
        for p, rpm, r0, f0, d, r1, f1, em in pool.map(lambda p: um(p, a, pasta), a.presets):
            f = lambda r: ' '.join(f'{r[i]:6.1f}' for i in (1, 3, 4, 5, 6))
            print(f"{p:10s} {rpm:4.0f} |        {f(r0)}   {100 * f0:3.0f}%   | {d:+5.1f} |         {f(r1)}   {100 * f1:3.0f}%   |                {em[2]:6.1f} {em[3]:6.1f} {em[5]:6.1f} {em[6]:6.1f}")


if __name__ == '__main__':
    main()
