#!/usr/bin/env python3
"""ronco-linhas.py — nível das LINHAS do motor (os harmônicos do ciclo) por terço de oitava e por banda, de uma
gravação e de um ou mais renders, lado a lado. É a medida do "faltam médios": a energia média de uma banda soma
linha e ruído; aqui as duas saem separadas (linhas, piso entre as linhas, HNR), com as medidas do kit ouvido
(`tools/ouvido/nucleo.py`: reamostragem no ângulo do ciclo, espectro de ordens, linha ÷ piso).

    python3 -I tools/ronco-linhas.py [--real GRAV.wav --trecho a-b --rpm R --ev N [--fmin Hz --fmax Hz] [--ancora lo-hi]]
                                     nome=ARQ.wav [nome=ARQ.wav ...] [--json saida.json] [--f0 Hz]

Cada ARQ.wav de render vem com um .json ao lado (o do `tools/ouvido/render.ts` ou do `tools/ronco-estagios.ts`), de
onde saem o f0 do ciclo e se o giro é travado; `--f0` vale para os que não têm. Com `nome=ARQ.wav@REF.wav` o nível
sai relativo à âncora de REF (para comparar uma fonte isolada, ou um estágio, com a saída completa).

Níveis em dB relativos à potência total da banda âncora (150–400 Hz por padrão, a do projeto) do próprio sinal: a
mesma normalização do `comparar.py`. Colunas por sinal: `lin` = potência das linhas, `piso` = potência do ruído entre
as linhas. Os arquivos de gravação são dados não confiáveis: rode com `python3 -I`, de fora da pasta deles.
"""
import argparse
import json
import os
import sys

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, 'ouvido'))
import nucleo as nu      # noqa: E402
import comparar as cp    # noqa: E402

TERCOS = [100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000]


def medir(x, fase, f0, ancora):
    """Linhas e piso por terço de oitava e por banda do kit; devolve potências lineares e a potência da âncora."""
    K = nu.k_para(fase)
    y, nc = nu.reamostrar_sincrono(x, fase, K)
    M = 16 if nc >= 48 else 8 if nc >= 20 else 4
    P, L = nu.espectro_ordens(y, K, M)
    sep = nu.separar_linhas(P, M, L)
    H = sep['H']
    fh = np.arange(H) * f0
    fb = np.arange(H * M) / M * f0
    lin_t, piso_t = [], []
    for fc in TERCOS:
        lo, hi = fc * 2 ** (-1 / 6), fc * 2 ** (1 / 6)
        lin_t.append(float(np.maximum(sep['liq'][(fh >= lo) & (fh < hi)].sum(), 0.0)))
        piso_t.append(float(sep['piso_bin'][(fb >= lo) & (fb < hi)].sum()))
    hb = nu.hnr_bandas(sep, f0)
    anc = float(sep['P'][(fb >= ancora[0]) & (fb < ancora[1])].sum())
    tot = float(sep['P'].sum())
    return {'lin_t': lin_t, 'piso_t': piso_t, 'lin_b': [h['harm'] for h in hb], 'piso_b': [h['piso'] for h in hb], 'hnr_b': [h['hnr'] for h in hb],
            'ancora': anc, 'total': tot, 'ciclos': nc, 'frac_harm': float(sep['harm'].sum() / max(tot, 1e-30))}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('sims', nargs='+', help='nome=ARQ.wav[@REF.wav]')
    ap.add_argument('--real'); ap.add_argument('--trecho'); ap.add_argument('--rpm', type=float); ap.add_argument('--ev', type=int)
    ap.add_argument('--fmin', type=float, default=4.0); ap.add_argument('--fmax', type=float, default=60.0)
    ap.add_argument('--canal', default='media')
    ap.add_argument('--ancora', default='150-400'); ap.add_argument('--f0', type=float); ap.add_argument('--json')
    a = ap.parse_args()
    anc = tuple(float(v) for v in a.ancora.split('-'))
    cols = []   # (nome, medida, referência da âncora)
    if a.real:
        r = cp.preparar(a.real, nu.parse_trecho(a.trecho) if a.trecho else None, a.canal, f0=a.rpm / 120.0 if a.rpm else None, ev=a.ev, fmin=a.fmin, fmax=a.fmax, detalhe=False)
        f0 = r['med']['f0']
        m = medir(r['x'], r['fase'], f0, anc)
        cols.append(('REAL', m, m['ancora'], f0))
    cache = {}
    for s in a.sims:
        nome, arq = s.split('=', 1)
        ref = None
        if '@' in arq:
            arq, ref = arq.split('@', 1)

        def um(caminho):
            if caminho in cache:
                return cache[caminho]
            f0, fixo = a.f0, True
            for lado in (caminho[:-4] + '.json', caminho.rsplit('_', 1)[0] + '.json'):
                if os.path.exists(lado):
                    with open(lado) as fh:
                        inf = json.load(fh)
                    if inf.get('f0'):
                        f0, fixo = float(inf['f0']), bool(inf.get('fixo', True))
                        break
            x, fs = nu.ler_audio(caminho)
            if f0 and fixo:
                fase = nu.fase_constante(len(x), f0, fs)
            else:   # giro livre: rastreia (com o f0 do .json como nominal)
                rr = cp.preparar(caminho, None, 'media', f0=f0, ev=a.ev, detalhe=False)
                fase = rr['fase']; f0 = rr['med']['f0']
            cache[caminho] = (medir(x, fase, f0, anc), f0)
            return cache[caminho]
        m, f0 = um(arq)
        cols.append((nome, m, um(ref)[0]['ancora'] if ref else m['ancora'], f0))
    db = lambda v, r: 10 * np.log10(max(v, 1e-30) / max(r, 1e-30))
    larg = 13
    print('LINHAS e PISO por terço de oitava (dB re a potência de %g–%g Hz)' % anc)
    print('terço Hz '.ljust(10) + ''.join(n[:larg - 1].center(larg) for n, *_ in cols))
    print(' ' * 10 + ''.join('  lin  piso '.center(larg) for _ in cols))
    for i, fc in enumerate(TERCOS):
        print(str(fc).rjust(7) + '   ' + ''.join(f"{db(m['lin_t'][i], r):6.1f}{db(m['piso_t'][i], r):6.1f} " for _, m, r, _ in cols))
    print('\nPOR BANDA do kit: linhas / piso (dB re âncora) · HNR (dB)')
    print('banda'.ljust(10) + ''.join(n[:larg + 5].center(larg + 7) for n, *_ in cols))
    for i, nb in enumerate(nu.NOMES):
        print(nb.ljust(10) + ''.join(f"{db(m['lin_b'][i], r):6.1f}{db(m['piso_b'][i], r):6.1f}{m['hnr_b'][i]:6.1f}  " for _, m, r, _ in cols))
    print('total'.ljust(10) + ''.join(f"{db(m['total'], r):6.1f}  harm {100 * m['frac_harm']:3.0f}%  " for _, m, r, _ in cols))
    print('f0 (Hz)'.ljust(10) + ''.join(f"{f0:8.3f} ({m['ciclos']} cic) ".rjust(larg + 7) for _, m, _, f0 in cols))
    if a.json:
        out = {n: {'f0': f0, 'ancora_db': db(r, 1.0), 'tercos': TERCOS, 'lin_t': [db(v, r) for v in m['lin_t']], 'piso_t': [db(v, r) for v in m['piso_t']],
                   'bandas': nu.NOMES, 'lin_b': [db(v, r) for v in m['lin_b']], 'piso_b': [db(v, r) for v in m['piso_b']], 'hnr_b': m['hnr_b'], 'total': db(m['total'], r)} for n, m, r, f0 in cols}
        with open(a.json, 'w') as fh:
            json.dump(nu.limpar(out), fh, indent=1)


if __name__ == '__main__':
    main()
