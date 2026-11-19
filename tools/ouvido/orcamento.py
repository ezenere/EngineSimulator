#!/usr/bin/env python3
"""orcamento.py — orçamento de ruído do simulado: de que fonte vem a energia de cada banda, quanto do som é estocástico
e quem enche o vão entre as explosões (regra 4 da rodada de som, docs/PLANO.md).

    python3 -I tools/ouvido/orcamento.py PASTA [--prefixo nome] [--saida pasta/] [--f0 Hz | --rpm R] [--eventos-por-ciclo N]
                                         [--na-rede valvula,variacao,turbina] [--sem-figura]

Recebe um conjunto de WAVs do MESMO render (mesma condição, mesma duração, MESMA SEMENTE do gerador de ruído), com a
convenção de nomes do tools/diesel-fontes.ts, que o tools/ouvido/render.ts também grava (`--cada`):

    <prefixo>_tudo.wav            tudo ligado (obrigatório)
    <prefixo>_sem-<fonte>.wav     tudo menos a <fonte> (o ganho dela zerado, sem pular as chamadas do gerador de ruído)
    <prefixo>_so-<fonte>.wav      só a contribuição da <fonte> (alternativa: já é a diferença)
    <prefixo>_semente2.wav        tudo ligado com OUTRA semente (opcional): dá a fração estocástica exata

Para cada fonte sai:
  · a fração da potência de cada banda e do total ponderado A. Fonte que soma na saída: potência do sinal-diferença
    (tudo − sem), que é a própria fonte. Fonte que entra na rede de tubos (`--na-rede`): desligá-la muda a trajetória
    do laço não linear e a diferença deixa de ser a fonte; vale a diferença de potência (tudo − sem), que pode até ser
    negativa. As duas contas saem no JSON (`propria` e `efeito`); quando divergem mais de 1 dB numa fonte que deveria
    somar, sai um aviso (interferência com outra fonte periódica, ou a saturação da saída);
  · quanto do VÃO ela ocupa: a fração da potência da faixa (1–6 kHz e cada banda acima de 400 Hz) no quarto do ciclo
    em que a envoltória média do render completo é mais baixa (entre as explosões; a máscara é no ângulo do ciclo,
    igual para todos os arquivos). É a conta que acha o "mar": a fonte que domina o vão é a que o ouvido ouve como
    chiado contínuo.
Com `_semente2`: dois renders com sementes diferentes têm a mesma parte determinística e ruídos independentes, então
potência estocástica = potência de (a − b)/√2, por banda, ponderada A e no vão. Só vale com giro travado (com o giro
livre as duas trajetórias se afastam e tudo vira "estocástico").

O ciclo vem do .json ao lado do `_tudo.wav` (gravado pelo render.ts), de `--f0`/`--rpm`, ou é rastreado.
"""
import argparse
import glob
import json
import os
import re
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nucleo as nu  # noqa: E402

NA_REDE = ['valvula', 'variacao', 'turbina']
BANDAS_VAO = [3, 4, 5]   # 400–1k, 1–2,5k, 2,5–6k


def _pot_bandas(x, fs):
    return nu.energia_bandas(x, fs)


def _pot_a(x, fs):
    f, P = nu.psd_welch(x, fs)
    return float((P * nu.ponderacao_a(f)).sum() * (f[1] - f[0]))


def achar(pasta, prefixo=None):
    """Acha os arquivos do conjunto numa pasta. Devolve (prefixo, {papel: caminho})."""
    tudo = sorted(glob.glob(os.path.join(pasta, (prefixo or '*') + '_tudo.wav')))
    if not tudo:
        raise FileNotFoundError(f'nenhum *_tudo.wav em {pasta}')
    if len(tudo) > 1 and not prefixo:
        raise ValueError('mais de um conjunto na pasta; escolha com --prefixo: ' + ', '.join(os.path.basename(t)[:-9] for t in tudo))
    base = tudo[0][:-len('_tudo.wav')]
    arqs = {'tudo': tudo[0]}
    for a in sorted(glob.glob(glob.escape(base) + '_*.wav')):
        m = re.match(r'_(sem|so)-(.+)\.wav$', a[len(base):])
        if m:
            arqs[f'{m.group(1)}-{m.group(2)}'] = a
        elif a[len(base):] == '_semente2.wav':
            arqs['semente2'] = a
    return os.path.basename(base), arqs


def orcamento(pasta, prefixo=None, f0=None, ev=None, fixo=None, na_rede=NA_REDE, voltas=2.0):
    """Calcula o orçamento. Devolve um dicionário (serializável) com `fontes`, `estocastico`, `total` e `avisos`."""
    prefixo, arqs = achar(pasta, prefixo)
    lado = arqs['tudo'][:-4] + '.json'
    if os.path.exists(lado):
        try:
            with open(lado) as fh:
                j = json.load(fh)
            f0 = f0 or j.get('f0'); ev = ev or j.get('eventosPorCiclo')
            fixo = bool(j.get('fixo')) if fixo is None else fixo
        except (ValueError, OSError):
            pass
    x, fs = nu.ler_audio(arqs['tudo'])
    sinais = {k: nu.ler_audio(v)[0] for k, v in arqs.items() if k != 'tudo'}
    n = min([len(x)] + [len(v) for v in sinais.values()])
    x = x[:n]
    sinais = {k: v[:n] for k, v in sinais.items()}
    avisos = []
    # ---- fase do ciclo e máscara do vão
    if f0 and fixo:
        fase = nu.fase_constante(n, f0, fs)
    else:
        import f0 as F0
        r = F0.rastrear(x, fs, nominal=f0, voltas=voltas)
        fase = r['fase']; f0 = r['f0']
        avisos += r['avisos']
    if not ev:
        ev = nu.analisar(x, fase, None, voltas, fs, detalhe=False)['ev']
        avisos.append(f'eventos por ciclo estimados em {ev}; passe --eventos-por-ciclo')
    f_ign = ev * f0
    Eb = _pot_bandas(x, fs)
    EA = _pot_a(x, fs)
    faixas = {'1_6k': (1000, 6000)}
    for i in BANDAS_VAO:
        faixas[nu.NOMES[i]] = nu.BANDAS[i]
    filt = {}
    masc = {}
    Evao = {}
    # O vão é definido no ÂNGULO do ciclo, não instante a instante: o quarto do ciclo em que a envoltória MÉDIA do render
    # completo é mais baixa. (Escolher os instantes em que este render em particular está baixo dá viés: qualquer outra
    # realização, outra semente ou uma fonte desligada que mude a trajetória, parece ter mais energia ali.)
    NB = 720
    ib = np.minimum((np.mod(fase, 2 * np.pi) / (2 * np.pi) * NB).astype(int), NB - 1)
    cont = np.maximum(np.bincount(ib, minlength=NB), 1)
    for nome, (lo, hi) in faixas.items():
        y, e = nu.envoltoria(x, lo, hi, fs, nu.fc_envoltoria(lo, hi, f_ign))
        filt[nome] = y
        med = np.bincount(ib, weights=e, minlength=NB) / cont
        masc[nome] = (med <= np.percentile(med, 25))[ib]
        Evao[nome] = float(np.mean(y[masc[nome]] ** 2))
    g16 = nu.estat_envoltoria(nu.envoltoria(x, 1000, 6000, fs, nu.fc_envoltoria(1000, 6000, f_ign))[1])
    out = {'prefixo': prefixo, 'arquivos': {k: os.path.basename(v) for k, v in arqs.items()}, 'f0': f0, 'ev': int(ev), 'rpm': f0 * 60 * voltas, 'duracao': n / fs,
           'bandas': nu.NOMES, 'total': {'bandas_db': [float(v) for v in nu.db10(Eb)], 'A_db': float(nu.db10(EA)), 'vao_1_6k_db': g16['vao'], 'p90_p10_1_6k': g16['p90_p10']},
           'fontes': {}, 'avisos': avisos}
    nomes = sorted({k.split('-', 1)[1] for k in sinais if k.startswith(('sem-', 'so-'))})
    for nome in nomes:
        rede = nome in na_rede
        if 'so-' + nome in sinais:
            c = sinais['so-' + nome]; sem = x - c; modo = 'so'
        else:
            sem = sinais['sem-' + nome]; c = x - sem; modo = 'sem'
        Ec = _pot_bandas(c, fs); Es = _pot_bandas(sem, fs)
        propria = Ec / np.maximum(Eb, nu.EPS)
        efeito = (Eb - Es) / np.maximum(Eb, nu.EPS)
        pa = _pot_a(c, fs) / max(EA, nu.EPS); ea = (EA - _pot_a(sem, fs)) / max(EA, nu.EPS)
        usar = efeito if rede else propria
        f = {'modo': modo, 'na_rede': rede,
             'bandas_frac': [float(max(v, 0.0)) for v in usar], 'bandas_db': [float(nu.db10(max(v, 1e-10))) for v in usar],
             'A_frac': float(max(ea if rede else pa, 0.0)),
             'propria': {'bandas_frac': [float(v) for v in propria], 'A_frac': float(pa)},
             'efeito': {'bandas_frac': [float(v) for v in efeito], 'A_frac': float(ea), 'queda_db': [float(-nu.db10(max(1 - v, 1e-6))) for v in efeito]}}
        for fx, (lo, hi) in faixas.items():
            if rede:
                ys = nu.passa_faixa(sem, lo, hi, fs)
                v = 1.0 - float(np.mean(ys[masc[fx]] ** 2)) / max(Evao[fx], nu.EPS)
            else:
                yc = nu.passa_faixa(c, lo, hi, fs)
                v = float(np.mean(yc[masc[fx]] ** 2)) / max(Evao[fx], nu.EPS)
            f['vao_' + fx] = float(max(v, 0.0))
        # a fonte é presa ao pulso? p90/p10 da própria envoltória em 1–6 kHz (só faz sentido para fonte que soma)
        if not rede:
            _, ec = nu.envoltoria(c, 1000, 6000, fs, nu.fc_envoltoria(1000, 6000, f_ign))
            if ec.mean() > 1e-9:
                st = nu.estat_envoltoria(ec)
                f['p90_p10_1_6k'] = st['p90_p10']; f['vao_proprio_1_6k_db'] = st['vao']
            dv = [abs(nu.db10(max(a, 1e-9)) - nu.db10(max(b, 1e-9))) for a, b in zip(propria, efeito) if a > 0.05]
            if dv and max(dv) > 1.0:
                avisos.append(f'{nome}: a potência própria e o efeito de desligar diferem até {max(dv):.1f} dB numa banda em que ela pesa mais de 5% '
                              f'(interfere com outra fonte periódica, entra na rede de tubos ou a saída satura): leia `efeito`')
        out['fontes'][nome] = f
    # ---- fração estocástica com a segunda semente
    if 'semente2' in sinais:
        dif = (x - sinais['semente2']) / np.sqrt(2.0)
        Sb = _pot_bandas(dif, fs)
        est = {'bandas_frac': [float(min(v, 1.0)) for v in Sb / np.maximum(Eb, nu.EPS)], 'A_frac': float(min(_pot_a(dif, fs) / max(EA, nu.EPS), 1.0))}
        for fx, (lo, hi) in faixas.items():
            yd = nu.passa_faixa(dif, lo, hi, fs)
            est['vao_' + fx] = float(min(np.mean(yd[masc[fx]] ** 2) / max(Evao[fx], nu.EPS), 1.0))
        out['estocastico'] = est
        if not fixo:
            avisos.append('fração estocástica medida com o giro livre: as duas sementes dão trajetórias diferentes e a conta exagera; use giro travado')
    return out


def texto(r):
    pct = lambda v: f'{100 * v:5.0f}%' if v >= 0.005 else '    · '
    L = [f"orçamento de {r['prefixo']}: {r['rpm']:.0f} rpm (f0 {r['f0']:.2f} Hz, {r['ev']} explosões por ciclo), {r['duracao']:.1f} s",
         f"render completo: vão de 1–6 kHz {r['total']['vao_1_6k_db']:.1f} dB re RMS, p90/p10 {r['total']['p90_p10_1_6k']:.1f} dB",
         '',
         'fração da potência por banda (%), do total ponderado A, e do VÃO entre as explosões (o quarto do ciclo com a envoltória média mais baixa)',
         'fonte         ' + ' '.join(f'{b:>7s}' for b in r['bandas']) + '  |  pond. A |  vão 400-1k  1-2,5k  2,5-6k  1–6 kHz | p90/p10 próprio']
    ordem = sorted(r['fontes'], key=lambda k: -r['fontes'][k]['vao_1_6k'])
    for k in ordem:
        f = r['fontes'][k]
        L.append(f"{k[:12]:12s}{'*' if f['na_rede'] else ' '} " + ' '.join(' ' + pct(v) for v in f['bandas_frac']) + f"  |  {pct(f['A_frac'])}  |      {pct(f['vao_400-1k'])}  {pct(f['vao_1-2,5k'])}  {pct(f['vao_2,5-6k'])}   {pct(f['vao_1_6k'])} |"
                 + (f"  {f['p90_p10_1_6k']:5.1f} dB" if 'p90_p10_1_6k' in f else '      --'))
        if f['na_rede']:
            L.append('  ↳ o que muda ' + ' '.join(' ' + pct(min(v, 9.99)) for v in f['propria']['bandas_frac']) + f"  |  {pct(min(f['propria']['A_frac'], 9.99))}  |  (potência de tudo − sem: inclui a mudança de trajetória)")
    if 'estocastico' in r:
        e = r['estocastico']
        L.append('-' * 60)
        L.append('ESTOCÁSTICO   ' + ' '.join(' ' + pct(v) for v in e['bandas_frac']) + f"  |  {pct(e['A_frac'])}  |      {pct(e['vao_400-1k'])}  {pct(e['vao_1-2,5k'])}  {pct(e['vao_2,5-6k'])}   {pct(e['vao_1_6k'])} |  (duas sementes)")
        L.append('determinístico' + ' '.join(' ' + pct(1 - v) for v in e['bandas_frac']) + f"  |  {pct(1 - e['A_frac'])}  |")
    L.append('(* entra na rede de tubos: a linha de cima é o EFEITO de desligar na potência; "o que muda" é a potência do sinal-diferença, que')
    L.append('   soma a fonte e o que ela desvia na trajetória do motor: numa fonte de variação da queima é o quanto do som deixa de ser periódico')
    L.append('   · "·" = menos de 0,5%)')
    if r['fontes']:
        k = ordem[0]
        L.append(f"quem mais enche o vão de 1–6 kHz: {k} ({100 * r['fontes'][k]['vao_1_6k']:.0f}%)")
    for a in r['avisos']:
        L.append('AVISO: ' + a)
    return '\n'.join(L)


def figura(r, arq, dpi=100):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.colors import LinearSegmentedColormap
    fundo, tinta, tinta2, grade = '#fcfcfb', '#0b0b0b', '#52514e', '#dddcd6'
    mapa = LinearSegmentedColormap.from_list('azul', [fundo, '#cde2fb', '#6da7ec', '#2a78d6', '#0d366b'])
    ordem = sorted(r['fontes'], key=lambda k: -r['fontes'][k]['vao_1_6k'])
    linhas = list(ordem)
    M = [r['fontes'][k]['bandas_frac'] + [r['fontes'][k]['A_frac'], r['fontes'][k]['vao_400-1k'], r['fontes'][k]['vao_1-2,5k'], r['fontes'][k]['vao_2,5-6k'], r['fontes'][k]['vao_1_6k']] for k in ordem]
    if 'estocastico' in r:
        e = r['estocastico']
        linhas.append('ESTOCÁSTICO (2 sementes)')
        M.append(e['bandas_frac'] + [e['A_frac'], e['vao_400-1k'], e['vao_1-2,5k'], e['vao_2,5-6k'], e['vao_1_6k']])
    M = np.clip(np.array(M), 0, 1)
    cols = [b.replace('-', '–') for b in r['bandas']] + ['pond. A', 'vão\n400–1k', 'vão\n1–2,5k', 'vão\n2,5–6k', 'vão\n1–6 kHz']
    fig, ax = plt.subplots(figsize=(11.5, 1.6 + 0.42 * len(linhas)), facecolor=fundo)
    ax.imshow(M, cmap=mapa, vmin=0, vmax=1, aspect='auto')
    for i in range(M.shape[0]):
        for j in range(M.shape[1]):
            if M[i, j] >= 0.005:
                ax.text(j, i, f'{100 * M[i, j]:.0f}', ha='center', va='center', fontsize=8.5, color=fundo if M[i, j] > 0.55 else tinta)
    ax.set_xticks(range(len(cols))); ax.set_xticklabels(cols, fontsize=8, color=tinta2)
    ax.set_yticks(range(len(linhas))); ax.set_yticklabels([k + ('*' if k in r['fontes'] and r['fontes'][k]['na_rede'] else '') for k in linhas], fontsize=9, color=tinta)
    ax.xaxis.tick_top()
    for x_ in (6.5, 7.5):
        ax.axvline(x_, color=tinta2, lw=0.8)
    if 'estocastico' in r:
        ax.axhline(len(ordem) - 0.5, color=tinta2, lw=0.8)
    for s in ax.spines.values():
        s.set_color(grade)
    ax.tick_params(length=0)
    ax.set_title(f"orçamento de ruído · {r['prefixo']} · {r['rpm']:.0f} rpm · % da potência por banda, do total ponderado A e do vão entre as explosões\n"
                 f"(fontes em ordem de quanto enchem o vão de 1–6 kHz; * entra na rede de tubos: efeito de desligar)", fontsize=9, color=tinta, loc='left', pad=26)
    fig.tight_layout()
    fig.savefig(arq, dpi=dpi, facecolor=fundo)
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('pasta')
    ap.add_argument('--prefixo'); ap.add_argument('--saida')
    ap.add_argument('--f0', type=float); ap.add_argument('--rpm', type=float); ap.add_argument('--voltas-por-ciclo', type=float, default=2.0)
    ap.add_argument('--eventos-por-ciclo', type=int)
    ap.add_argument('--na-rede', default=','.join(NA_REDE))
    ap.add_argument('--sem-figura', action='store_true')
    a = ap.parse_args()
    f0 = a.f0 or (a.rpm / 60.0 / a.voltas_por_ciclo if a.rpm else None)
    r = orcamento(a.pasta, a.prefixo, f0, a.eventos_por_ciclo, True if f0 else None, [s for s in a.na_rede.split(',') if s], a.voltas_por_ciclo)
    t = texto(r)
    print(t)
    saida = a.saida or a.pasta
    os.makedirs(saida, exist_ok=True)
    base = os.path.join(saida, r['prefixo'] + '_orcamento')
    with open(base + '.json', 'w') as fh:
        json.dump(nu.limpar(r), fh, ensure_ascii=False, indent=1)
    with open(base + '.txt', 'w') as fh:
        fh.write(t + '\n')
    if not a.sem_figura and r['fontes']:
        figura(r, base + '.png')
    print(f"\ngravado: {base}.json, .txt" + ('' if a.sem_figura else ', .png'))


if __name__ == '__main__':
    main()
