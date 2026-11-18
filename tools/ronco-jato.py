#!/usr/bin/env python3
"""ronco-jato.py — mede a varredura do tools/ronco-jato.ts: quanto do som é chiado de jato em cada posição dos
controles "Diâmetro do escape" e "Ponteira (saída)" do Ronco.

    python3 -I tools/ronco-jato.py PASTA [--json saida.json] [--ref-pasta PASTA_REF]

Por ponto (preset, condição, tubo, ponteira), com as medidas do kit ouvido (`tools/ouvido/`):
  jato A      fração da potência ponderada A que é o jato da ponteira (tudo − sem-jato, mesma semente; é a fonte exata)
  jato dB     nível do jato relativo ao resto (dB, sem ponderação)
  válv. A     efeito de desligar o chiado do vão da válvula de escape na potência ponderada A (ele entra na rede de
              tubos: vale a diferença de potência, não o sinal-diferença)
  leito       fração de 1–6 kHz que é chiado contínuo (resíduo não periódico × quanto dele enche o vão entre as explosões)
  ar          defeito "ar" do kit contra o MESMO preset e condição nos diâmetros do preset (`--ref-pasta`: os do preset
              numa outra varredura, por exemplo a do som aprovado): quanto leito a mais do que a referência, em
              tolerâncias. Sem gravação de cada condição, a régua é o próprio carro no diâmetro de fábrica
  linhas      nível das linhas de 400 Hz–2,5 kHz relativo ao de 150–400 Hz (dB): o que o estreitamento faz ao tom
  total       nível total relativo ao ponto de referência (dB): o estreitamento "prende" o som?
"""
import argparse
import glob
import json
import os
import sys

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, 'ouvido'))
import nucleo as nu      # noqa: E402
import comparar as cp    # noqa: E402


def pot_a(x, fs):
    f, P = nu.psd_welch(x, fs)
    return float((P * nu.ponderacao_a(f)).sum())


def medir(base):
    with open(base + '.json') as fh:
        inf = json.load(fh)
    x, fs = nu.ler_audio(base + '_tudo.wav')
    sj, _ = nu.ler_audio(base + '_sem-jato.wav')
    sv, _ = nu.ler_audio(base + '_sem-valvula.wav')
    n = min(len(x), len(sj), len(sv))
    x, sj, sv = x[:n], sj[:n], sv[:n]
    jato = x - sj
    pa = pot_a(x, fs)
    f0 = inf['f0']
    fase = nu.fase_constante(n, f0, fs)
    med = nu.analisar(x, fase, inf.get('ev'), 2, fs, detalhe=False)
    b = {q['banda']: q for q in med['bandas']}
    lin = lambda k: 10 ** (b[k]['harm_db'] / 10)
    return {**inf, 'jato_A': pot_a(jato, fs) / max(pa, 1e-30), 'jato_db': float(nu.db10(np.mean(jato ** 2) / max(np.mean(sj ** 2), 1e-30))),
            'valv_A': (pa - pot_a(sv, fs)) / max(pa, 1e-30), 'leito': cp.leito_frac(med['faixa_1_6k']), 'total_db': med['nivel_total_db'],
            'linhas_med': float(nu.db10((lin('400-1k') + lin('1-2,5k')) / max(lin('150-400'), 1e-30))), 'hnr': [q['hnr'] for q in med['bandas']], '_med': med}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('pasta'); ap.add_argument('--json'); ap.add_argument('--ref-pasta')
    a = ap.parse_args()
    bases = sorted(p[:-len('_tudo.wav')] for p in glob.glob(os.path.join(a.pasta, '*_tudo.wav')))
    pts = [medir(b) for b in bases]
    por = {}
    for p in pts:
        por.setdefault((p['preset'], p['cond']), []).append(p)
    refs = {}
    if a.ref_pasta:
        for b in sorted(q[:-len('_tudo.wav')] for q in glob.glob(os.path.join(a.ref_pasta, '*_tudo.wav'))):
            r = medir(b)
            refs.setdefault((r['preset'], r['cond']), []).append(r)
    saida = []
    ordem = {'lenta': 0, 'parcial': 1, 'plena': 2}
    for (pre, cond), lista in sorted(por.items(), key=lambda kv: (kv[0][0], ordem.get(kv[0][1], 9))):
        # referência: o ponto com os diâmetros do preset (tubo do preset, ponteira acompanhando), desta pasta ou da de referência
        tubo0 = [p for p in lista if p['tipD'] == 1.25 and p['pipeD'] != 1.5]
        d0 = tubo0[0]['pipeD'] if tubo0 else 2.5
        cand = [p for p in refs.get((pre, cond), lista) if p['pipeD'] == d0 and p['tipD'] is None]
        ref = cand[0] if cand else None
        print(f"\n== {pre} · {cond} · {lista[0]['rpm']:.0f} rpm, pedal {lista[0]['pedal']:.3f}  (referência: tubo {d0}\" com a ponteira do tubo{', da pasta de referência' if a.ref_pasta else ''})")
        print('  tubo  ponteira |  jato A   jato dB | válv. A |  leito 1–6k |   ar  | linhas 0,4–2,5k | total re ref')
        for p in sorted(lista, key=lambda q: (q['tipD'] is not None, q['pipeD'], q['tipD'] or 0)):
            ar = float('nan')
            if ref is not None:
                d = cp.defeitos(ref['_med'], p['_med'])
                ar = d['ar']
            dom = '  DOMINA' if p['jato_A'] > 0.5 else ''
            print(f"  {p['pipeD']:4.2f}  {('tubo' if p['tipD'] is None else format(p['tipD'], '4.2f')):>8} | {100 * p['jato_A']:5.1f}%  {p['jato_db']:7.1f} | {100 * p['valv_A']:6.1f}% | {100 * p['leito']:9.0f}%  | {ar:5.2f} | {p['linhas_med']:14.1f}  | {p['total_db'] - (ref['total_db'] if ref else 0):8.1f}{dom}")
            saida.append({k: v for k, v in p.items() if not k.startswith('_')} | {'ar': ar, 'total_re_ref': p['total_db'] - (ref['total_db'] if ref else 0)})
    if a.json:
        with open(a.json, 'w') as fh:
            json.dump(nu.limpar(saida), fh, indent=1)
    pior = max(saida, key=lambda s: s['jato_A'])
    print(f"\npior ponto: {pior['preset']} {pior['cond']} tubo {pior['pipeD']} ponteira {pior['tipD']}: jato = {100 * pior['jato_A']:.0f}% do nível ponderado A")
    for cond in ('lenta', 'parcial', 'plena'):
        s = [q for q in saida if q['cond'] == cond]
        if s:
            print(f"  {cond}: jato A máximo {100 * max(q['jato_A'] for q in s):.0f}% · pontos em que domina {sum(q['jato_A'] > 0.5 for q in s)}/{len(s)} · ar máximo {np.nanmax([q['ar'] for q in s]):.2f} · leito máximo {100 * max(q['leito'] for q in s):.0f}%")


if __name__ == '__main__':
    main()
