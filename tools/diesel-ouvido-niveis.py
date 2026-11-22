#!/usr/bin/env python3
"""diesel-ouvido-niveis.py — tabela curta dos níveis por banda (dB re 150–400 Hz), gravação / simulado, de uma pasta de
resultados do tools/diesel-ouvido.py. Serve para acertar o nível da mecânica de cada preset.

    python3 -I tools/diesel-ouvido-niveis.py PASTA [PASTA2 ...]
"""
import json
import os
import sys

NOMES = ['30-60', '60-150', '150-400', '400-1k', '1-2,5k', '2,5-6k', '6-12k']
for pasta in sys.argv[1:]:
    with open(os.path.join(pasta, 'resumo.json')) as fh:
        res = json.load(fh)
    print(f'== {pasta}')
    print(f"{'caso':24s} " + ' '.join(f'{n:>13s}' for n in NOMES) + '   total  ar   tom  pulso | m_ign      p90/p10     leito16   CV16')
    for r in res:
        c = r.get('comparacao')
        if not c:
            continue
        f = lambda v: '  --' if v is None else f'{v:5.1f}'
        b = c['bandas']
        g = c['faixa_1_6k']
        print(f"{r['id']:24s} " + ' '.join(f"{f(x['nivel'][0])} /{f(x['nivel'][1])} " for x in b)
              + f"  {c['distancias']['total']:4.2f} {c['defeitos']['ar']:4.2f} {c['defeitos']['tom']:4.2f} {c['defeitos']['pulso']:4.2f} | {f(g['m_ign'][0])}/{f(g['m_ign'][1])} {f(g['p90_p10'][0])}/{f(g['p90_p10'][1])} "
              + f"{100 * c['leito_1_6k'][0]:3.0f}/{100 * c['leito_1_6k'][1]:3.0f} {f(g['cv_evento'][0])}/{f(g['cv_evento'][1])}")
