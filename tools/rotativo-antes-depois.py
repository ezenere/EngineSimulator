#!/usr/bin/env python3
"""rotativo-antes-depois.py — junta duas rodadas da régua dos Rotativos (`tabela.json` do tools/rotativo-regua.py) numa
tabela antes × depois × gravação em Markdown: defeitos de um lado só e total, e por banda o leito de ruído, o HNR, o
nível das linhas e o nível total (todos relativos à âncora de cada lado).

    python3 -I tools/rotativo-antes-depois.py ANTES/tabela.json DEPOIS/tabela.json
"""
import json
import sys


def f(v, n=1):
    return '--' if v is None else f'{v:+.{n}f}'.replace('.', ',') if n else f'{v:+.0f}'


def g(v):
    return '--' if v is None else f'{v:.2f}'.replace('.', ',')


def main():
    a = {c['id']: c for c in json.load(open(sys.argv[1]))['casos'] if not c.get('erro')}
    d = {c['id']: c for c in json.load(open(sys.argv[2]))['casos'] if not c.get('erro')}
    ids = [k for k in d if k in a]
    print('| caso | rpm real / sim | ar | tom a menos | pulso a menos | total | nível re âncora em 400–1k · 1–2,5k · 2,5–6k (dB): gravação / antes / depois |')
    print('|---|---|---|---|---|---|---|')
    for k in ids:
        A, D = a[k], d[k]
        niv = ' · '.join(f"{f(D['bandas'][i]['nivel'][0])} / {f(A['bandas'][i]['nivel'][1])} / {f(D['bandas'][i]['nivel'][1])}" for i in (3, 4, 5))
        print(f"| {k} | {D['rpm_real']:.0f} / {D['rpm_sim']:.0f} | {g(A['defeitos']['ar'])} → {g(D['defeitos']['ar'])} | {g(A['defeitos']['tom'])} → {g(D['defeitos']['tom'])} | "
              f"{g(A['defeitos']['pulso'])} → {g(D['defeitos']['pulso'])} | {g(A['distancias']['total'])} → {g(D['distancias']['total'])} | {niv} |")
    print()
    print('| caso | leito de ruído re âncora em 400–1k · 1–2,5k · 2,5–6k (dB): gravação / antes / depois | HNR em 400–1k · 1–2,5k · 2,5–6k (dB): gravação / antes / depois | linhas re âncora em 400–1k · 1–2,5k (dB): gravação / antes / depois |')
    print('|---|---|---|---|')
    for k in ids:
        A, D = a[k], d[k]
        tres = lambda campo, ii, n=1: ' · '.join(f"{f(D['bandas'][i][campo][0], n)} / {f(A['bandas'][i][campo][1], n)} / {f(D['bandas'][i][campo][1], n)}" for i in ii)
        print(f"| {k} | {tres('leito', (3, 4, 5))} | {tres('hnr', (3, 4, 5), 0)} | {tres('linhas', (3, 4))} |")


if __name__ == '__main__':
    main()
