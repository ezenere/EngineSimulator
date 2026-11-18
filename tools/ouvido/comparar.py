#!/usr/bin/env python3
"""comparar.py — compara uma gravação real e um render do simulador em condição casada (mesma rotação, carga e
posição) e diz, em números e num painel, o que o simulado tem a mais e a menos que o real.

    python3 -I tools/ouvido/comparar.py REAL.wav SIM.wav --saida pasta/
        [--f0-real Hz] [--f0-sim Hz]            f0 do ciclo de cada um (rpm/120 no 4 tempos), se conhecido
        [--rpm R] [--rpm-real R] [--rpm-sim R]  alternativa: rotação (com --voltas-por-ciclo, padrão 2)
        [--eventos-por-volta E | --eventos-por-ciclo N]   explosões por volta (V8 4T: 4) ou por ciclo (V8: 8)
        [--fixo-sim] [--fixo-real]              o f0 dado é exato (render com giro travado): não rastrear
        [--trecho-real a-b] [--trecho-sim a-b]  segundos
        [--canal-real media|e|d] [--canal-sim …]
        [--ancora auto|lo-hi]                   banda da normalização de nível (padrão: 150–400 Hz, ou em volta da
                                                ignição quando ela passa de 320 Hz)
        [--pesos p1,…,p7]                       peso de cada banda nas distâncias (padrão 0.25,0.5,1,1,1,1,0)
        [--fmin Hz --fmax Hz] [--folga 0.08]    busca do f0 quando ele não é dado (ou a folga em volta do dado)
        [--zoom 0.5] [--dpi 100] [--titulo "…"] [--sem-painel]

Grava em `pasta/`: `painel.png` (lado a lado, mesmas escalas), `medidas.json` (tudo, por banda) e `resumo.txt`.

Normalização de nível: gravações têm ganho arbitrário, então o simulado é escalado para ter a MESMA POTÊNCIA NA BANDA
ÂNCORA que o real, e todos os níveis saem em dB relativos a ela. A âncora padrão é 150–400 Hz (a do projeto: microfone
de celular corta abaixo disso). O critério usado fica escrito no painel e no JSON.

Sem `--f0-*`/`--rpm`, o ciclo é rastreado por `f0.py` (com as salvaguardas de oitava); o que ele achou fica no resumo.
Passe a rotação sempre que souber: errar o ciclo por um fator inverte as conclusões (REVISAO-DE-SOM, caso do Mustang).

Distâncias (em "tolerâncias": 1 = diferença do tamanho da incerteza de uma gravação de celular; ver README):
  timbre tonal   nível das linhas por banda e perfil das ordens baixas
  piso de ruído  HNR por banda, nível e planura do piso entre as linhas
  envoltória     p90/p10, vão, crista e desvio/média da envoltória (bandas ≥ 400 Hz e a faixa 1–6 kHz)
  modulação      profundidade no ciclo, na rotação e na ignição; fração da envoltória presa ao ciclo
  eventos        estalos por segundo, curtose, irregularidade ciclo a ciclo e desigualdade entre explosões
"""
import argparse
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nucleo as nu  # noqa: E402
import f0 as F0  # noqa: E402

PESOS = [0.25, 0.5, 1.0, 1.0, 1.0, 1.0, 0.0]
TOL_NIVEL = [6.0, 4.0, 3.0, 3.0, 5.0, 5.0, 7.0]   # dB (REVISAO-DE-SOM: ±3 até 1 kHz, ±5 de 1 a 8 kHz, ±6–8 acima)
COMPONENTES = ['tonal', 'piso', 'envoltoria', 'modulacao', 'eventos']
NOME_COMP = {'tonal': 'timbre tonal', 'piso': 'piso de ruído', 'envoltoria': 'envoltória', 'modulacao': 'modulação', 'eventos': 'eventos'}


# ----------------------------------------------------------------------------------------------- um lado
def preparar(caminho, trecho=None, canal='media', f0=None, fixo=False, ev=None, voltas=2.0, fmin=4.0, fmax=60.0, folga=0.08, detalhe=True):
    """Lê, acha a fase do ciclo e mede. Devolve um dicionário com x, fs, fase, med e o que o rastreio disse."""
    x, fs = nu.ler_audio(caminho, trecho, canal)
    if len(x) < 2 * fs:
        raise ValueError(f'{caminho}: trecho de {len(x) / fs:.1f} s; use pelo menos 2 s (o ideal é 8 s ou mais)')
    info = {'arquivo': str(caminho), 'trecho': list(trecho) if trecho else None, 'canal': canal}
    if fixo and f0:
        fase = nu.fase_constante(len(x), f0, fs)
        info['rastreio'] = {'modo': 'fixo', 'f0': f0}
        avisos = []
    else:
        r = F0.rastrear(x, fs, fmin, fmax, nominal=f0, folga=folga, voltas=voltas)
        fase = r['fase']
        avisos = r['avisos']
        info['rastreio'] = {'modo': 'nominal' if f0 else 'livre', 'f0': r['f0'], 'linha_hz': r['linha_hz'], 'N': r['N'], 'pente_hz': r['pente_hz'],
                            'confianca': r['confianca'], 'avisos': avisos}
    med = nu.analisar(x, fase, ev, voltas, fs, detalhe=detalhe)
    info.update({'x': x, 'fs': fs, 'fase': fase, 'med': med, 'avisos': avisos})
    return info


def escolher_ancora(arg, f_ign):
    if arg and arg != 'auto':
        lo, hi = arg.split('-')
        return float(lo), float(hi), 'pedida na linha de comando'
    if f_ign <= 320:
        return 150.0, 400.0, 'padrão do projeto'
    return float(f_ign / 1.6), float(f_ign * 1.6), f'em volta da ignição ({f_ign:.0f} Hz), que passa de 320 Hz'


# -------------------------------------------------------------------------------------------- distâncias
def _v(d, k, pad=float('nan')):
    v = d.get(k, pad)
    return float('nan') if v is None else float(v)


def _rms_pond(itens):
    """itens = [(diferença em tolerâncias, peso)] → raiz da média ponderada dos quadrados (ignora NaN)."""
    it = [(d, w) for d, w in itens if np.isfinite(d) and w > 0]
    if not it:
        return float('nan')
    d = np.array([a for a, _ in it]); w = np.array([b for _, b in it])
    return float(np.sqrt(np.sum(w * d * d) / np.sum(w)))


def relativos(med, anc_db):
    """Níveis por banda relativos à âncora: total, linhas e piso (dB)."""
    out = []
    for b in med['bandas']:
        out.append({'nivel': b['nivel_db'] - anc_db, 'harm': b['harm_db'] - anc_db, 'piso': b['piso_db'] - anc_db})
    return out


def distancias(R, S, relR, relS, pesos=PESOS):
    """Distância por componente entre o real (R) e o simulado (S), em tolerâncias."""
    d = {}
    nb = len(R['bandas'])
    # ---- timbre tonal
    it = []
    for i in range(nb):
        hr, hs = relR[i]['harm'], relS[i]['harm']
        if not (np.isfinite(hr) and np.isfinite(hs)):
            continue
        # sem tom nenhum dos dois lados (HNR < −10 dB), o nível das linhas não quer dizer nada
        if max(_v(R['bandas'][i], 'hnr'), _v(S['bandas'][i], 'hnr')) < -10:
            continue
        hr = max(hr, relR[i]['nivel'] - 15); hs = max(hs, relS[i]['nivel'] - 15)
        it.append(((hs - hr) / TOL_NIVEL[i], pesos[i]))
    lr = np.array(R['linhas_db'], dtype=float); ls = np.array(S['linhas_db'], dtype=float)
    n = min(len(lr), len(ls))
    if n >= 4:
        lr, ls = lr[:n], ls[:n]
        lr = np.maximum(lr, lr.max() - 30); ls = np.maximum(ls, ls.max() - 30)
        w = np.maximum(10 ** (lr / 10), 10 ** (ls / 10))
        ok = (lr > lr.max() - 25) | (ls > ls.max() - 25)
        w = np.where(ok, w, 0)
        w = 2.0 * w / max(w.sum(), 1e-30)   # o perfil das ordens pesa como duas bandas
        it += [((ls[k] - lr[k]) / 5.0, w[k]) for k in range(n)]
    d['tonal'] = _rms_pond(it)
    # ---- piso de ruído
    it = []
    for i in range(nb):
        br, bs = R['bandas'][i], S['bandas'][i]
        hr = np.clip(_v(br, 'hnr'), -15, 35); hs = np.clip(_v(bs, 'hnr'), -15, 35)
        it.append(((hs - hr) / 4.0, 1.5 * pesos[i]))
        it.append(((relS[i]['piso'] - relR[i]['piso']) / TOL_NIVEL[i], pesos[i]))
        it.append(((_v(bs, 'planura_piso') - _v(br, 'planura_piso')) / 2.0, 0.5 * pesos[i]))
    d['piso'] = _rms_pond(it)
    # ---- envoltória e modulação: bandas válidas dos dois lados + a faixa 1–6 kHz
    pares = [(R['bandas'][i], S['bandas'][i], pesos[i]) for i in range(nb) if R['bandas'][i]['env_valida'] and S['bandas'][i]['env_valida']]
    pares.append((R['faixa_1_6k'], S['faixa_1_6k'], 2.0))
    it = []
    for br, bs, w in pares:
        it.append(((_v(bs, 'p90_p10') - _v(br, 'p90_p10')) / 3.0, w))
        it.append(((_v(bs, 'vao') - _v(br, 'vao')) / 3.0, w))
        it.append(((_v(bs, 'crista') - _v(br, 'crista')) / 3.0, 0.5 * w))
        it.append(((_v(bs, 'desvio_media') - _v(br, 'desvio_media')) / 0.12, w))
    d['envoltoria'] = _rms_pond(it)
    it = []
    for br, bs, w in pares:
        for k in ('m_ign', 'm_rot', 'm_ciclo', 'm_total_ciclo'):
            it.append(((min(_v(bs, k), 1.5) - min(_v(br, k), 1.5)) / 0.12, w))
        it.append(((_v(bs, 'frac_ciclo') - _v(br, 'frac_ciclo')) / 0.15, w))
    d['modulacao'] = _rms_pond(it)
    # ---- eventos
    it = []
    gr, gs = R['faixa_1_6k'], S['faixa_1_6k']
    it.append(((np.sqrt(_v(gs, 'picos_s')) - np.sqrt(_v(gr, 'picos_s'))) / 1.0, 1.0))
    it.append(((np.sqrt(_v(gs, 'picos_irregulares_s')) - np.sqrt(_v(gr, 'picos_irregulares_s'))) / 0.7, 1.0))
    it.append(((np.log(max(_v(gs, 'curtose_mediana'), 1.0)) - np.log(max(_v(gr, 'curtose_mediana'), 1.0))) / np.log(1.5), 0.5))
    for a, b, w in ((gr, gs, 1.0), (R['grave'], S['grave'], 1.0)):
        it.append(((_v(b, 'cv_evento') - _v(a, 'cv_evento')) / 0.08, w))
        it.append(((_v(b, 'cv_ciclo') - _v(a, 'cv_ciclo')) / 0.08, w))
        it.append(((_v(b, 'desigualdade') - _v(a, 'desigualdade')) / 0.10, 0.5 * w))
    d['eventos'] = _rms_pond(it)
    vals = [d[k] for k in COMPONENTES if np.isfinite(d[k])]
    d['total'] = float(np.sqrt(np.mean(np.square(vals)))) if vals else float('nan')
    return d


# ------------------------------------------------------------------------------------------------ resumo
def _faixas(idx):
    """Agrupa índices de banda contíguos: [3,4,5,7] → [(3,5),(7,7)]."""
    out = []
    for i in sorted(idx):
        if out and i == out[-1][1] + 1:
            out[-1] = (out[-1][0], i)
        else:
            out.append((i, i))
    return out


def _nome_faixa(a, b):
    lo = nu.BANDAS[a][0]; hi = nu.BANDAS[b][1]
    f = lambda v: f'{v}' if v < 1000 else f'{v / 1000:g}k'.replace('.', ',')
    return f'{f(lo)}–{f(hi)} Hz'


def resumir(R, S, relR, relS, pesos=PESOS, n=5):
    """Lista priorizada do que o simulado tem A MAIS e A MENOS que o real. Devolve [(gravidade, texto)]."""
    it = []
    nb = len(R['bandas'])
    ativos = [i for i in range(nb) if pesos[i] > 0]
    hr = np.array([np.clip(_v(R['bandas'][i], 'hnr'), -15, 35) for i in range(nb)])
    hs = np.array([np.clip(_v(S['bandas'][i], 'hnr'), -15, 35) for i in range(nb)])
    # ---- HNR: ruído sobrando / tom faltando (ou o contrário)
    for sinal in (-1, 1):
        idx = [i for i in ativos if np.isfinite(hr[i]) and np.isfinite(hs[i]) and sinal * (hs[i] - hr[i]) > 3.0]
        for a, b in _faixas(idx):
            ii = list(range(a, b + 1))
            pior = max(ii, key=lambda i: abs(hs[i] - hr[i]) * pesos[i])
            dN = float(np.mean([relS[i]['piso'] - relR[i]['piso'] for i in ii]))
            dH = float(np.mean([max(relS[i]['harm'], relS[i]['nivel'] - 15) - max(relR[i]['harm'], relR[i]['nivel'] - 15) for i in ii]))
            grav = max(abs(hs[i] - hr[i]) / 4.0 * pesos[i] for i in ii) * 1.5
            if sinal < 0:
                if dN > 2 and dN >= -dH:
                    causa = f'ruído sobrando: o piso está {dN:+.0f} dB (linhas {dH:+.0f} dB)'
                elif dH < -2:
                    causa = f'tom faltando: as linhas estão {dH:+.0f} dB (piso {dN:+.0f} dB)'
                else:
                    causa = f'piso {dN:+.0f} dB, linhas {dH:+.0f} dB'
                it.append((grav, f'A MAIS: ruído entre as linhas em {_nome_faixa(a, b)} (HNR {hs[pior]:.0f} dB contra {hr[pior]:.0f} do real em {nu.NOMES[pior]}; {causa})'))
            else:
                it.append((grav, f'A MENOS: ruído entre as linhas em {_nome_faixa(a, b)}: tonal demais (HNR {hs[pior]:.0f} dB contra {hr[pior]:.0f} do real em {nu.NOMES[pior]}; piso {dN:+.0f} dB, linhas {dH:+.0f} dB)'))
    # ---- nível por banda
    for sinal in (-1, 1):
        idx = [i for i in ativos if sinal * (relS[i]['nivel'] - relR[i]['nivel']) > TOL_NIVEL[i]]
        for a, b in _faixas(idx):
            ii = list(range(a, b + 1))
            pior = max(ii, key=lambda i: abs(relS[i]['nivel'] - relR[i]['nivel']) / TOL_NIVEL[i] * pesos[i])
            dv = relS[pior]['nivel'] - relR[pior]['nivel']
            grav = abs(dv) / TOL_NIVEL[pior] * pesos[pior]
            it.append((grav, f"{'A MAIS' if sinal > 0 else 'A MENOS'}: nível em {_nome_faixa(a, b)} ({dv:+.0f} dB em {nu.NOMES[pior]}, relativo à âncora)"))
    # ---- envoltória e modulação
    cand = [(nu.NOMES[i] + ' Hz', R['bandas'][i], S['bandas'][i], pesos[i]) for i in ativos if R['bandas'][i]['env_valida'] and S['bandas'][i]['env_valida']]
    cand.append(('1–6 kHz', R['faixa_1_6k'], S['faixa_1_6k'], 2.0))
    melhor_env = None
    melhor_mod = None
    for nome, br, bs, w in cand:
        dp = _v(bs, 'p90_p10') - _v(br, 'p90_p10'); dv = _v(bs, 'vao') - _v(br, 'vao')
        g = max(abs(dp), abs(dv)) / 3.0 * min(w, 1.5)
        if np.isfinite(g) and g > 1 and (melhor_env is None or g > melhor_env[0]):
            if dp < 0 or dv > 0:
                t = (f"A MENOS: pulso em {nome}: a envoltória é mais lisa (p90/p10 {_v(bs, 'p90_p10'):.1f} dB contra {_v(br, 'p90_p10'):.1f}; vão {_v(bs, 'vao'):.1f} dB contra {_v(br, 'vao'):.1f}; "
                     f"ruído liso daria {bs['ref_ruido']['p90_p10']:.1f} e {bs['ref_ruido']['vao']:.1f}): algo enche o silêncio entre as explosões")
            else:
                t = (f"A MAIS: pulso em {nome}: a envoltória é mais seca (p90/p10 {_v(bs, 'p90_p10'):.1f} dB contra {_v(br, 'p90_p10'):.1f}; vão {_v(bs, 'vao'):.1f} dB contra {_v(br, 'vao'):.1f}): "
                     f"falta o que enche o intervalo entre as explosões no real")
            melhor_env = (g, t)
        for k, rot in (('m_ign', 'na ignição'), ('m_rot', 'na rotação'), ('m_ciclo', 'no ciclo')):
            dm = min(_v(bs, k), 1.5) - min(_v(br, k), 1.5)
            g = abs(dm) / 0.12 * min(w, 1.5) * 0.8
            if np.isfinite(g) and g > 1 and (melhor_mod is None or g > melhor_mod[0]):
                melhor_mod = (g, f"{'A MAIS' if dm > 0 else 'A MENOS'}: modulação {rot} em {nome} (índice {_v(bs, k):.2f} contra {_v(br, k):.2f}; "
                                 f"fração da envoltória presa ao ciclo {_v(bs, 'frac_ciclo'):.2f} contra {_v(br, 'frac_ciclo'):.2f})")
    if melhor_env:
        it.append(melhor_env)
    if melhor_mod:
        it.append(melhor_mod)
    # ---- eventos
    gr, gs = R['faixa_1_6k'], S['faixa_1_6k']
    for k, rot, tol in (('picos_irregulares_s', 'estalos fora do padrão do ciclo', 0.7), ('picos_s', 'picos 10 dB acima da mediana', 1.0)):
        dq = np.sqrt(_v(gs, k)) - np.sqrt(_v(gr, k))
        if np.isfinite(dq) and abs(dq) / tol > 1:
            it.append((abs(dq) / tol, f"{'A MAIS' if dq > 0 else 'A MENOS'}: {rot} em 1–6 kHz ({_v(gs, k):.1f}/s contra {_v(gr, k):.1f}/s)"))
            break
    for nome, a, b in (('grave', R['grave'], S['grave']), ('1–6 kHz', gr, gs)):
        dc = _v(b, 'cv_evento') - _v(a, 'cv_evento')
        if np.isfinite(dc) and abs(dc) / 0.08 > 1:
            it.append((abs(dc) / 0.08 * 0.8, f"{'A MAIS' if dc > 0 else 'A MENOS'}: irregularidade entre explosões no {nome} (CV {_v(b, 'cv_evento'):.2f} contra {_v(a, 'cv_evento'):.2f}; "
                                              f"mesmo cilindro, ciclo a ciclo: {_v(b, 'cv_ciclo'):.2f} contra {_v(a, 'cv_ciclo'):.2f})"))
            break
    # ---- tons fora de ordem
    def sem_par(t, outros):
        return not any(abs(o['f'] / t['f'] - 1) < 0.04 or abs(o['ordem_ciclo'] - t['ordem_ciclo']) < 0.15 for o in outros)
    for t in S.get('tons', [])[:3]:
        if t['proeminencia'] >= 12 and sem_par(t, R.get('tons', [])):
            it.append((t['proeminencia'] / 6.0, f"A MAIS: tom que não é ordem em {t['f']:.0f} Hz ({t['ordem_ciclo'] / R['voltas_por_ciclo']:.2f}× o giro, {t['tipo']}), {t['proeminencia']:.0f} dB sobre o piso; o real não tem"))
            break
    for t in R.get('tons', [])[:3]:
        if t['proeminencia'] >= 12 and sem_par(t, S.get('tons', [])):
            it.append((t['proeminencia'] / 8.0, f"A MENOS: o real tem um tom em {t['f']:.0f} Hz ({t['ordem_ciclo'] / R['voltas_por_ciclo']:.2f}× o giro, {t['tipo']}), {t['proeminencia']:.0f} dB sobre o piso; o simulado não"))
            break
    # ---- inclinação
    di = _v(S, 'inclinacao_db_oitava') - _v(R, 'inclinacao_db_oitava')
    if np.isfinite(di) and abs(di) > 1.5:
        it.append((abs(di) / 1.5 * 0.7, f"{'A MAIS' if di > 0 else 'A MENOS'}: brilho (inclinação de 150 Hz a 6 kHz: {_v(S, 'inclinacao_db_oitava'):.1f} dB/oitava contra {_v(R, 'inclinacao_db_oitava'):.1f})"))
    it.sort(key=lambda a: -a[0])
    return it[:n]


def tabela(R, S, relR, relS):
    L = ['banda       nível re âncora   HNR (dB)      piso re âncora   planura   p90/p10 (dB)    vão (dB)      m ignição     fração ciclo',
         '            real    sim       real   sim    real    sim      r    s    real   sim     real   sim    real  sim     real  sim']
    f = lambda v, w=6, p=1: (' ' * (w - 2) + '--') if v is None or not np.isfinite(v) else f'{v:{w}.{p}f}'
    for i, (br, bs) in enumerate(zip(R['bandas'], S['bandas'])):
        val = '' if (br['env_valida'] and bs['env_valida']) else '  (env. só indicativa)'
        L.append(f"{nu.NOMES[i]:9s} {f(relR[i]['nivel'])}  {f(relS[i]['nivel'])}    {f(_v(br, 'hnr'))} {f(_v(bs, 'hnr'))}  {f(relR[i]['piso'])}  {f(relS[i]['piso'])}   "
                 f"{f(_v(br, 'planura_piso'), 5)}{f(_v(bs, 'planura_piso'), 5)}  {f(_v(br, 'p90_p10'))} {f(_v(bs, 'p90_p10'))}   {f(_v(br, 'vao'))} {f(_v(bs, 'vao'))}   "
                 f"{f(_v(br, 'm_ign'), 5, 2)} {f(_v(bs, 'm_ign'), 5, 2)}   {f(_v(br, 'frac_ciclo'), 5, 2)} {f(_v(bs, 'frac_ciclo'), 5, 2)}{val}")
    return '\n'.join(L)


# ------------------------------------------------------------------------------------------------ comparar
def comparar(real, sim, ancora='auto', pesos=PESOS):
    """`real` e `sim` = saídas de `preparar`. Devolve o dicionário de comparação (distâncias, resumo, âncora…)."""
    R, S = real['med'], sim['med']
    lo, hi, motivo = escolher_ancora(ancora, R['f_ign'])
    ancR = float(nu.db10(nu.energia_bandas(real['x'], real['fs'], [(lo, hi)])[0]))
    ancS = float(nu.db10(nu.energia_bandas(sim['x'], sim['fs'], [(lo, hi)])[0]))
    relR, relS = relativos(R, ancR), relativos(S, ancS)
    d = distancias(R, S, relR, relS, pesos)
    res = resumir(R, S, relR, relS, pesos)
    avisos = []
    if abs(S['f0'] / R['f0'] - 1) > 0.05:
        avisos.append(f"condição NÃO casada: f0 do real {R['f0']:.2f} Hz e do simulado {S['f0']:.2f} Hz diferem {100 * (S['f0'] / R['f0'] - 1):+.0f}%")
    if R['ev'] != S['ev']:
        avisos.append(f"eventos por ciclo diferentes (real {R['ev']}, simulado {S['ev']}): passe --eventos-por-ciclo")
    for lado, inf in (('real', real), ('simulado', sim)):
        avisos += [f'{lado}: {a}' for a in inf.get('avisos', [])]
    crit = (f'Normalização: o simulado foi escalado {ancR - ancS:+.1f} dB para ter a mesma potência do real na banda âncora {lo:.0f}–{hi:.0f} Hz ({motivo}); '
            f'todos os níveis em dB relativos a essa banda.')
    return {'ancora': [lo, hi], 'ancora_motivo': motivo, 'ancora_db_real': ancR, 'ancora_db_sim': ancS, 'ganho_sim_db': ancR - ancS, 'criterio': crit,
            'pesos': list(pesos), 'distancias': d, 'resumo': [{'gravidade': round(g, 2), 'texto': t} for g, t in res], 'avisos': avisos,
            '_relR': relR, '_relS': relS}


def texto_resumo(real, sim, comp):
    R, S = real['med'], sim['med']
    d = comp['distancias']
    L = ['DISTÂNCIAS (em tolerâncias; 1 ≈ incerteza de uma gravação de celular):  ' + '   '.join(f"{NOME_COMP[k]} {d[k]:.2f}" for k in COMPONENTES) + f"   |  total {d['total']:.2f}",
         '',
         'O QUE O SIMULADO TEM A MAIS / A MENOS QUE O REAL (do mais grave para o menos):']
    if not comp['resumo']:
        L.append('  (nada acima das tolerâncias)')
    for k, r in enumerate(comp['resumo'], 1):
        L.append(f"  {k}. {r['texto']}")
    L += ['', tabela(R, S, comp['_relR'], comp['_relS'])]
    gr, gs = R['faixa_1_6k'], S['faixa_1_6k']
    L.append(f"1–6 kHz   p90/p10 {gr['p90_p10']:.1f} / {gs['p90_p10']:.1f} dB · vão {gr['vao']:.1f} / {gs['vao']:.1f} dB · curtose (mediana) {gr['curtose_mediana']:.1f} / {gs['curtose_mediana']:.1f} · "
             f"picos {gr['picos_s']:.1f} / {gs['picos_s']:.1f} por s · fora do padrão {gr['picos_irregulares_s']:.1f} / {gs['picos_irregulares_s']:.1f} por s   (real / simulado)")
    L.append(f"explosões  CV no grave {_v(R['grave'], 'cv_evento'):.2f} / {_v(S['grave'], 'cv_evento'):.2f} · mesmo cilindro {_v(R['grave'], 'cv_ciclo'):.2f} / {_v(S['grave'], 'cv_ciclo'):.2f} · "
             f"desigualdade fixa {_v(R['grave'], 'desigualdade'):.2f} / {_v(S['grave'], 'desigualdade'):.2f} · inclinação {R['inclinacao_db_oitava']:.1f} / {S['inclinacao_db_oitava']:.1f} dB/oitava · "
             f"fração harmônica {R['fracao_harmonica']:.2f} / {S['fracao_harmonica']:.2f}")
    for nome, m in (('real', R), ('simulado', S)):
        for t in m.get('tons', [])[:3]:
            L.append(f"tom fora de ordem no {nome}: {t['f']:.0f} Hz ({t['ordem_ciclo'] / m['voltas_por_ciclo']:.2f}× o giro), {t['proeminencia']:.0f} dB sobre o piso, {t['tipo']}, "
                     f"estabilidade {t['estabilidade_pct']:.2f}%, presente em {100 * t['presenca']:.0f}% do trecho")
    for a in comp['avisos']:
        L.append('AVISO: ' + a)
    return '\n'.join(L)


def executar(arq_real, arq_sim, saida, f0_real=None, f0_sim=None, ev=None, voltas=2.0, fixo_real=False, fixo_sim=False, trecho_real=None, trecho_sim=None,
             canal_real='media', canal_sim='media', ancora='auto', pesos=PESOS, fmin=4.0, fmax=60.0, folga=0.08, zoom=0.5, dpi=100, titulo='', painel=True,
             rotulo_real=None, rotulo_sim=None):
    """Compara dois arquivos e grava painel.png, medidas.json e resumo.txt em `saida`. Devolve o dicionário gravado."""
    os.makedirs(saida, exist_ok=True)
    # o render do kit (tools/ouvido/render.ts) grava ao lado do WAV um .json com a rotação: vale o que a linha de comando não disse
    lado = os.path.splitext(str(arq_sim))[0] + '.json'
    if os.path.exists(lado):
        try:
            with open(lado) as fh:
                j = json.load(fh)
            if f0_sim is None and j.get('f0'):
                f0_sim = float(j['f0'])
                fixo_sim = fixo_sim or bool(j.get('fixo'))
            if ev is None and j.get('eventosPorCiclo'):
                ev = int(j['eventosPorCiclo'])
        except (ValueError, OSError):
            pass
    real = preparar(arq_real, trecho_real, canal_real, f0_real, fixo_real, ev, voltas, fmin, fmax, folga)
    ev_s = ev or real['med']['ev']
    if f0_sim is None and not fixo_sim:
        f0_sim = real['med']['f0']   # condição casada: procura o ciclo do simulado em volta do do real
    sim = preparar(arq_sim, trecho_sim, canal_sim, f0_sim, fixo_sim, ev_s, voltas, fmin, fmax, folga)
    comp = comparar(real, sim, ancora, pesos)
    txt = texto_resumo(real, sim, comp)
    saida_json = {'real': {**{k: real[k] for k in ('arquivo', 'trecho', 'canal', 'rastreio')}, 'medidas': real['med']},
                  'sim': {**{k: sim[k] for k in ('arquivo', 'trecho', 'canal', 'rastreio')}, 'medidas': sim['med']},
                  'comparacao': comp, 'bandas_hz': nu.BANDAS, 'tolerancias_nivel_db': TOL_NIVEL}
    with open(os.path.join(saida, 'medidas.json'), 'w') as fh:
        json.dump(nu.limpar(saida_json), fh, ensure_ascii=False, indent=1)
    with open(os.path.join(saida, 'resumo.txt'), 'w') as fh:
        fh.write((titulo + '\n' if titulo else '') + comp['criterio'] + '\n\n' + txt + '\n')
    if painel:
        import painel as pn
        g = 10 ** (comp['ganho_sim_db'] / 20)
        lados = {'real': {'x': real['x'], 'x_bruto': real['x'], 'fs': real['fs'], 'med': real['med'], 'anc_db': comp['ancora_db_real'], 'ganho_db': 0.0,
                          'rotulo': rotulo_real or _rotulo(real)},
                 'sim': {'x': sim['x'] * g, 'x_bruto': sim['x'], 'fs': sim['fs'], 'med': sim['med'], 'anc_db': comp['ancora_db_sim'], 'ganho_db': comp['ganho_sim_db'],
                         'rotulo': rotulo_sim or _rotulo(sim)}}
        pn.desenhar(lados, comp, os.path.join(saida, 'painel.png'), dpi=dpi, zoom=zoom, titulo=titulo, rodape=txt)
    return {'real': real, 'sim': sim, 'comp': comp, 'texto': txt}


def _rotulo(inf):
    t = inf['trecho']
    return os.path.basename(inf['arquivo']) + (f' [{t[0]:g}–{t[1]:g} s]' if t and t[1] is not None else '')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('real'); ap.add_argument('sim')
    ap.add_argument('--saida', required=True)
    ap.add_argument('--f0-real', type=float); ap.add_argument('--f0-sim', type=float)
    ap.add_argument('--rpm', type=float); ap.add_argument('--rpm-real', type=float); ap.add_argument('--rpm-sim', type=float)
    ap.add_argument('--eventos-por-volta', type=float); ap.add_argument('--eventos-por-ciclo', type=int)
    ap.add_argument('--voltas-por-ciclo', type=float, default=2.0)
    ap.add_argument('--fixo-sim', action='store_true'); ap.add_argument('--fixo-real', action='store_true')
    ap.add_argument('--trecho-real'); ap.add_argument('--trecho-sim')
    ap.add_argument('--canal-real', default='media'); ap.add_argument('--canal-sim', default='media')
    ap.add_argument('--ancora', default='auto')
    ap.add_argument('--pesos')
    ap.add_argument('--fmin', type=float, default=4.0); ap.add_argument('--fmax', type=float, default=60.0); ap.add_argument('--folga', type=float, default=0.08)
    ap.add_argument('--zoom', type=float, default=0.5); ap.add_argument('--dpi', type=int, default=100)
    ap.add_argument('--titulo', default=''); ap.add_argument('--sem-painel', action='store_true')
    a = ap.parse_args()
    v = a.voltas_por_ciclo
    f0r = a.f0_real or ((a.rpm_real or a.rpm) / 60.0 / v if (a.rpm_real or a.rpm) else None)
    f0s = a.f0_sim or ((a.rpm_sim or a.rpm) / 60.0 / v if (a.rpm_sim or a.rpm) else None)
    ev = a.eventos_por_ciclo or (int(round(a.eventos_por_volta * v)) if a.eventos_por_volta else None)
    pesos = [float(p) for p in a.pesos.split(',')] if a.pesos else PESOS
    if len(pesos) != len(nu.BANDAS):
        ap.error(f'--pesos precisa de {len(nu.BANDAS)} valores')
    r = executar(a.real, a.sim, a.saida, f0r, f0s, ev, v, a.fixo_real, a.fixo_sim, nu.parse_trecho(a.trecho_real), nu.parse_trecho(a.trecho_sim),
                 a.canal_real, a.canal_sim, a.ancora, pesos, a.fmin, a.fmax, a.folga, a.zoom, a.dpi, a.titulo, not a.sem_painel)
    print(r['comp']['criterio'])
    print()
    print(r['texto'])
    print(f"\ngravado em {a.saida}/: medidas.json, resumo.txt" + ('' if a.sem_painel else ', painel.png'))


if __name__ == '__main__':
    main()
