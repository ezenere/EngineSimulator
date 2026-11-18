"""Painel lado a lado do kit ouvido (real à esquerda, simulado à direita, mesmas escalas e mesma faixa dinâmica).

Linhas do painel, de cima para baixo:
  1. espectrograma log-mel de ~8 s (visão geral: estável? tonal ou chiado?);
  2. zoom de 0,5 s com janela curta (os pulsos de cada explosão e o que há entre eles);
  3. espectro fino no domínio das ordens (linhas do motor nítidas mesmo com o giro variando), com o piso entre as linhas;
  4. espectro em 1/6 de oitava, total e piso, dos dois sobrepostos + HNR por banda;
  5. espectro de modulação da envoltória por banda (0,5–200 Hz) com ciclo, rotação e ignição marcados;
  6. envoltória de 1–6 kHz dobrada no ciclo: cada ciclo, o ciclo médio e a média dobrada na ignição;
  7. distâncias por componente e o resumo.

Cores: real = azul, simulado = laranja (os dois primeiros lugares da paleta categórica, conferidos para daltonismo);
espectrogramas numa rampa de um só tom (claro = fraco, escuro = forte); bandas numa rampa ordinal do tom da série.
"""
import os
import sys

import numpy as np
import matplotlib
matplotlib.use('Agg')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap  # noqa: E402
from scipy import signal  # noqa: E402

import nucleo as nu  # noqa: E402

COR = {'real': '#2a78d6', 'sim': '#eb6834'}
RAMPA = {'real': ['#86b6ef', '#2a78d6', '#0d366b'], 'sim': ['#f3ab8c', '#eb6834', '#8a3410']}
TINTA = '#0b0b0b'
TINTA2 = '#52514e'
FUNDO = '#fcfcfb'
GRADE = '#dddcd6'
MAPA = LinearSegmentedColormap.from_list('tinta', [FUNDO, '#c9c8c2', '#8b8a84', '#4a4946', '#0b0b0b'])


def _mel(f):
    return 2595.0 * np.log10(1.0 + f / 700.0)


def _imel(m):
    return 700.0 * (10 ** (m / 2595.0) - 1.0)


def banco_mel(f, n_mel, fmin, fmax):
    """Filtros triangulares na escala mel (cada um com pelo menos um bin)."""
    pts = _imel(np.linspace(_mel(fmin), _mel(fmax), n_mel + 2))
    B = np.zeros((n_mel, len(f)))
    for i in range(n_mel):
        a, c, b = pts[i], pts[i + 1], pts[i + 2]
        w = np.minimum((f - a) / max(c - a, 1e-9), (b - f) / max(b - c, 1e-9))
        w = np.clip(w, 0, None)
        if w.sum() <= 0:
            w[np.argmin(np.abs(f - c))] = 1.0
        B[i] = w / w.sum()
    return B, pts[1:-1]


def log_mel(x, fs, n_jan, salto, n_mel, fmin, fmax, nfft=None):
    """Espectrograma log-mel: potência por filtro (dB). Devolve (t, centros, S_dB)."""
    nfft = nfft or nu.pot2(n_jan)
    f, t, Z = signal.stft(x, fs, window='hann', nperseg=n_jan, noverlap=n_jan - salto, nfft=nfft, boundary=None, padded=False, scaling='spectrum')
    P = np.abs(Z) ** 2
    B, cs = banco_mel(f, n_mel, fmin, fmax)
    # (potência por filtro: soma dos bins ponderada; × nº de bins equivalente, para um tom e um ruído largos terem leitura estável)
    S = B @ P
    return t, cs, nu.db10(S)


def _eixo(ax, titulo=None, xlabel=None, ylabel=None):
    ax.set_facecolor(FUNDO)
    for s in ax.spines.values():
        s.set_color(GRADE)
    ax.tick_params(colors=TINTA2, labelsize=8, length=3)
    if titulo:
        ax.set_title(titulo, fontsize=9.5, color=TINTA, loc='left', pad=4)
    if xlabel:
        ax.set_xlabel(xlabel, fontsize=8.5, color=TINTA2, labelpad=2)
    if ylabel:
        ax.set_ylabel(ylabel, fontsize=8.5, color=TINTA2, labelpad=2)


def _ticks_hz(ax, eixo='y', lo=30, hi=12000):
    vals = [v for v in (30, 60, 150, 400, 1000, 2500, 6000, 12000) if lo <= v <= hi]
    rot = [f'{v}' if v < 1000 else f'{v / 1000:g}k' for v in vals]
    pos = _mel(np.array(vals, dtype=float))
    if eixo == 'y':
        ax.set_yticks(pos); ax.set_yticklabels(rot)
    else:
        ax.set_xticks(pos); ax.set_xticklabels(rot)


def desenhar(lados, comp, saida, dpi=100, zoom=0.5, visao=8.0, titulo='', rodape=None):
    """`lados` = {'real': {...}, 'sim': {...}} com x (já no ganho de exibição), fs, med (nucleo.analisar), rotulo, e
    `anc_db` (potência da banda âncora, dB). `comp` = resultado de comparar (distâncias, resumo, âncora)."""
    nomes = ['real', 'sim']
    fig = plt.figure(figsize=(16, 27), facecolor=FUNDO)
    gs = fig.add_gridspec(8, 2, height_ratios=[0.55, 3.0, 3.0, 2.6, 2.6, 2.4, 2.6, 4.6], hspace=0.40, wspace=0.10,
                          left=0.055, right=0.955, top=0.986, bottom=0.008)
    # ------------------------------------------------------------------ cabeçalho
    axh = fig.add_subplot(gs[0, :]); axh.axis('off')
    axh.text(0, 0.95, titulo or 'ouvido: real × simulado', fontsize=14, color=TINTA, weight='bold', va='top')
    lin = []
    for n in nomes:
        m = lados[n]['med']
        lin.append(f"{'REAL' if n == 'real' else 'SIMULADO'}: {lados[n]['rotulo']}  ·  f0 (ciclo) {m['f0']:.2f} Hz = {m['rpm']:.0f} rpm (±{50 * (m['f0_p95'] - m['f0_p5']) / m['f0']:.1f}%)"
                   f"  ·  ignição {m['f_ign']:.1f} Hz ({m['ev']} por ciclo{', estimado' if m['ev_estimado'] else ''})  ·  {m['duracao']:.1f} s, {m['ciclos']:.0f} ciclos")
    axh.text(0, 0.52, lin[0], fontsize=9, color=COR['real'], va='top', weight='bold')
    axh.text(0, 0.22, lin[1], fontsize=9, color=COR['sim'], va='top', weight='bold')
    axh.text(0, -0.08, comp['criterio'], fontsize=8.5, color=TINTA2, va='top')

    # ------------------------------------------------------------------ 1. log-mel de ~8 s
    mel = {}
    for n in nomes:
        x, fs = lados[n]['x'], lados[n]['fs']
        seg = x[:int(min(len(x), visao * fs))]
        t, cs, S = log_mel(seg, fs, 4096, 960, 96, 30, 12000)
        mel[n] = (t, cs, S - lados['real']['anc_db'])
    vmax = max(np.percentile(mel[n][2], 99.7) for n in nomes)
    vmin = vmax - 70
    for j, n in enumerate(nomes):
        ax = fig.add_subplot(gs[1, j])
        t, cs, S = mel[n]
        im = ax.imshow(S, origin='lower', aspect='auto', cmap=MAPA, vmin=vmin, vmax=vmax,
                       extent=[t[0], t[-1], _mel(cs[0]), _mel(cs[-1])], interpolation='nearest')
        _ticks_hz(ax)
        _eixo(ax, f"1 · espectrograma log-mel · {'REAL' if n == 'real' else 'SIMULADO'}", 's', 'Hz' if j == 0 else None)
        if j == 1:
            cax = ax.inset_axes([1.012, 0.0, 0.012, 1.0])
            cb = fig.colorbar(im, cax=cax); cb.ax.tick_params(labelsize=7, colors=TINTA2); cb.outline.set_edgecolor(GRADE)
            cb.set_label('dB re âncora', fontsize=7.5, color=TINTA2)

    # ------------------------------------------------------------------ 2. zoom
    zz = {}
    for n in nomes:
        x, fs = lados[n]['x'], lados[n]['fs']
        m = lados[n]['med']
        dz = float(min(zoom, len(x) / fs * 0.8))
        i0 = int(max(0, (len(x) / fs - dz) / 2) * fs)
        seg = x[i0:i0 + int(dz * fs)]
        nj = int(np.clip(round(0.3 * fs / m['f_ign'] / 16) * 16, 48, 256))   # janela ≈ 0,3 do período da ignição (1 a 5,3 ms)
        t, cs, S = log_mel(seg, fs, nj, max(4, nj // 16), 72, 100, 12000, nfft=1024)
        zz[n] = (t, cs, S - lados['real']['anc_db'], nj, i0)
    vmaxz = max(np.percentile(zz[n][2], 99.8) for n in nomes)
    for j, n in enumerate(nomes):
        ax = fig.add_subplot(gs[2, j])
        t, cs, S, nj, i0 = zz[n]
        m = lados[n]['med']
        ax.imshow(S, origin='lower', aspect='auto', cmap=MAPA, vmin=vmaxz - 60, vmax=vmaxz,
                  extent=[t[0] * 1000, t[-1] * 1000, _mel(cs[0]), _mel(cs[-1])], interpolation='nearest')
        _ticks_hz(ax, lo=100)
        _eixo(ax, f"2 · zoom de {t[-1] - t[0]:.2f} s (janela {1000 * nj / lados[n]['fs']:.1f} ms, a partir de {i0 / lados[n]['fs']:.1f} s) · {'REAL' if n == 'real' else 'SIMULADO'}", 'ms', 'Hz' if j == 0 else None)
        # réguas: 1 ignição e 1 ciclo
        y0 = _mel(cs[-1]) - 0.035 * (_mel(cs[-1]) - _mel(cs[0]))
        x0 = t[0] * 1000 + 0.012 * (t[-1] - t[0]) * 1000
        for k, (dur, rot) in enumerate([(1000 / m['f_ign'], '1 ignição'), (1000 / m['f0'], '1 ciclo')]):
            yy = y0 - k * 0.06 * (_mel(cs[-1]) - _mel(cs[0]))
            if dur < (t[-1] - t[0]) * 1000 * 0.95:
                ax.plot([x0, x0 + dur], [yy, yy], color=COR[n], lw=3, solid_capstyle='butt')
                ax.text(x0 + dur + 3, yy, rot, fontsize=7.5, color=TINTA, va='center',
                        bbox=dict(facecolor=FUNDO, edgecolor='none', alpha=0.75, pad=1))

    # ------------------------------------------------------------------ 3. espectro fino (ordens)
    f0m = 0.5 * (lados['real']['med']['f0'] + lados['sim']['med']['f0'])
    fmax_fino = float(np.clip(96 * f0m, 300, 12000))
    fino = {}
    for n in nomes:
        m = lados[n]['med']; sep = m['_sep']
        fb = np.arange(len(sep['P'])) / sep['M'] * m['f0']
        ok = fb <= fmax_fino
        g = lados[n]['ganho_db'] - lados['real']['anc_db']
        fino[n] = (fb[ok], nu.db10(sep['P'][ok]) + g, nu.db10(sep['piso_bin'][ok]) + g)
    topo = max(fino[n][1].max() for n in nomes)
    for j, n in enumerate(nomes):
        ax = fig.add_subplot(gs[3, j])
        m = lados[n]['med']
        fb, Pd, pis = fino[n]
        ax.plot(fb, Pd, color=COR[n], lw=0.7)
        ax.plot(fb, pis, color=TINTA, lw=1.0, alpha=0.8, label='piso entre as linhas')
        k = 1
        while k * m['f_ign'] <= fmax_fino:
            ax.axvline(k * m['f_ign'], color=TINTA2, lw=0.6, alpha=0.45, zorder=0)
            if k <= 12:
                ax.text(k * m['f_ign'], topo + 4.5, 'ign' if k == 1 else f'{k}×', fontsize=7, color=TINTA2, ha='center', va='bottom')
            k += 1
        hs = np.arange(1, int(fmax_fino / m['f0']) + 1) * m['f0']
        ax.plot(hs, np.full(len(hs), topo + 3), '|', color=TINTA2, ms=3, mew=0.5, alpha=0.7)
        ax.set_xlim(0, fmax_fino); ax.set_ylim(topo - 85, topo + 9)
        ax.grid(axis='y', color=GRADE, lw=0.5)
        _eixo(ax, f"3 · espectro fino (ordens) · {'REAL' if n == 'real' else 'SIMULADO'} · tracinhos: harmônicos do ciclo; verticais: ignição e múltiplos",
              'Hz (ordem × f0 mediano)', 'dB re âncora' if j == 0 else None)
        ax.legend(fontsize=7.5, loc='upper right', frameon=False, labelcolor=TINTA2, bbox_to_anchor=(1.0, 0.93))

    # ------------------------------------------------------------------ 4. 1/6 de oitava: total e piso; HNR por banda
    g4 = gs[4, :].subgridspec(1, 2, width_ratios=[1.55, 1.0], wspace=0.13)
    ax = fig.add_subplot(g4[0, 0])
    for n in nomes:
        m = lados[n]['med']; sep = m['_sep']
        g = lados[n]['ganho_db'] - lados['real']['anc_db']
        cs, p = nu.tercos(lados[n]['x_bruto'], lados[n]['fs'], 30, 12000, fracao=6)
        fb = np.arange(len(sep['P'])) / sep['M'] * m['f0']
        h = 2 ** (1 / 12)
        pp = np.array([sep['piso_bin'][(fb >= c / h) & (fb < c * h)].sum() for c in cs])
        ax.plot(cs, nu.db10(p) + g, color=COR[n], lw=2, label=f"{'real' if n == 'real' else 'simulado'}: total")
        okp = pp > 0
        ax.plot(cs[okp], nu.db10(pp[okp]) + g, color=COR[n], lw=1.4, ls=(0, (4, 2)), label=f"{'real' if n == 'real' else 'simulado'}: piso de ruído")
    ax.set_xscale('log'); ax.set_xlim(30, 12000)
    ax.set_xticks([30, 60, 150, 400, 1000, 2500, 6000, 12000]); ax.set_xticklabels(['30', '60', '150', '400', '1k', '2,5k', '6k', '12k'])
    ax.minorticks_off()
    yl = ax.get_ylim(); ax.set_ylim(max(yl[0], yl[1] - 75), yl[1] + 2)
    ax.axvspan(comp['ancora'][0], comp['ancora'][1], color=GRADE, alpha=0.45, lw=0)
    ax.text(np.sqrt(comp['ancora'][0] * comp['ancora'][1]), ax.get_ylim()[0] + 2, 'âncora', fontsize=7.5, color=TINTA2, ha='center')
    ax.axvspan(6000, 12000, facecolor='none', edgecolor=GRADE, hatch='////', lw=0)
    ax.text(8500, ax.get_ylim()[0] + 2, 'acima de 6 kHz\nvale a física', fontsize=7, color=TINTA2, ha='center')
    ax.grid(color=GRADE, lw=0.5)
    ax.legend(fontsize=8, loc='upper right', frameon=False, labelcolor=TINTA, ncol=2)
    _eixo(ax, '4 · espectro em 1/6 de oitava: total (cheio) e piso de ruído entre as linhas (tracejado)', 'Hz', 'dB re âncora (potência por banda)')
    ax = fig.add_subplot(g4[0, 1])
    xb = np.arange(len(nu.BANDAS))
    for k, n in enumerate(nomes):
        v = np.array([b['hnr'] if b['hnr'] is not None else np.nan for b in lados[n]['med']['bandas']], dtype=float)
        v = np.clip(v, -20, 40)
        ax.bar(xb + (k - 0.5) * 0.36, v, width=0.32, color=COR[n], label='real' if n == 'real' else 'simulado', zorder=3)
    ax.axhline(0, color=TINTA2, lw=0.8)
    ax.set_xticks(xb); ax.set_xticklabels([s.replace('-', '–') for s in nu.NOMES])
    ax.set_ylim(-22, 42); ax.grid(axis='y', color=GRADE, lw=0.5, zorder=0)
    ax.legend(fontsize=8, loc='upper right', frameon=False, labelcolor=TINTA)
    _eixo(ax, 'HNR por banda: linhas das ordens ÷ piso (dB)', 'banda (Hz)', None)
    ax.text(0.01, 0.03, '> 0: mais tom que ruído · < −15: sem tom', transform=ax.transAxes, fontsize=7.5, color=TINTA2)

    # ------------------------------------------------------------------ 5. modulação por banda
    bandas_mod = [3, 4, 5]
    for j, n in enumerate(nomes):
        ax = fig.add_subplot(gs[5, j])
        m = lados[n]['med']
        for k, ib in enumerate(bandas_mod):
            fm, mm = m['_mod'][ib]['fm'], m['_mod'][ib]['mm']
            ax.plot(fm, nu.db20(mm), color=RAMPA[n][k], lw=1.3, label=nu.NOMES[ib].replace('-', '–') + ' Hz')
        for f_, rot in [(m['f0'], 'ciclo'), (m['f_rot'], 'rotação'), (m['f_ign'], 'ignição')]:
            if 0.5 <= f_ <= 200:
                ax.axvline(f_, color=TINTA2, lw=0.7, ls=(0, (2, 2)), zorder=0)
                ax.text(f_, 1.5, rot, fontsize=7.5, color=TINTA2, ha='center', va='bottom', rotation=0)
        ax.set_xscale('log'); ax.set_xlim(0.5, 200); ax.set_ylim(-50, 6)
        ax.set_xticks([0.5, 1, 2, 5, 10, 20, 50, 100, 200]); ax.set_xticklabels(['0,5', '1', '2', '5', '10', '20', '50', '100', '200'])
        ax.minorticks_off()
        ax.grid(color=GRADE, lw=0.5)
        ax.legend(fontsize=8, loc='lower left', frameon=False, labelcolor=TINTA, ncol=3)
        _eixo(ax, f"5 · modulação da envoltória por banda · {'REAL' if n == 'real' else 'SIMULADO'}", 'Hz de modulação',
              '20·log10(índice de modulação)' if j == 0 else None)

    # ------------------------------------------------------------------ 6. envoltória de 1–6 kHz dobrada no ciclo
    for j, n in enumerate(nomes):
        ax = fig.add_subplot(gs[6, j])
        m = lados[n]['med']
        K = m['_K16']; ev = m['ev']
        L = nu.dobrar(m['_e16_ang'], K)
        rms = np.sqrt(np.mean(m['_e16_ang'] ** 2))
        xx = np.arange(K) / K * ev
        g = m['faixa_1_6k']
        rr = g['ref_ruido']
        ax.axhspan(rr['vao'], rr['vao'] + rr['p90_p10'], color=GRADE, alpha=0.6, lw=0, zorder=0)
        ax.text(ev * 0.995, rr['vao'] + rr['p90_p10'] + 0.4, 'faixa p10–p90 de um ruído liso', fontsize=7, color=TINTA2, ha='right', va='bottom')
        passo = max(1, L.shape[0] // 50)
        for row in L[::passo]:
            ax.plot(xx, nu.db20(row / rms), color=RAMPA[n][0], lw=0.5, alpha=0.5)
        ax.plot(xx, nu.db20(L.mean(0) / rms), color=RAMPA[n][2], lw=2.0, label='ciclo médio')
        if ev > 1 and K % ev == 0:
            mi = L.reshape(-1, K // ev).mean(0)
            ax.plot(xx, nu.db20(np.tile(mi, ev) / rms), color=TINTA, lw=1.0, ls=(0, (4, 2)), label='média dobrada na ignição')
        pr = m.get('_perfil_residuo_16')
        if pr is not None:
            ax.plot((np.arange(len(pr)) + 0.5) / len(pr) * ev, nu.db10(pr), color=TINTA, lw=1.1, label='ruído não periódico (o que não se repete)')
        for k in range(1, ev):
            ax.axvline(k, color=GRADE, lw=0.6, zorder=0)
        ax.set_xlim(0, ev); ax.set_ylim(-26, 14)
        ax.grid(axis='y', color=GRADE, lw=0.5)
        ax.legend(fontsize=8, loc='upper left', frameon=False, labelcolor=TINTA, ncol=3)
        lf = (g.get('residuo_frac') or float('nan')) * min(g.get('ruido_liso') or float('nan'), 1.0)
        txt = (f"p90/p10 {g['p90_p10']:.1f} dB · vão {g['vao']:.1f} dB · crista {g['crista']:.1f} dB · fração presa ao ciclo {g.get('frac_ciclo', float('nan')):.2f} · "
               f"m na ignição {g.get('m_ign', float('nan')):.2f}\n"
               f"ruído não periódico: {100 * (g.get('residuo_frac') or float('nan')):.0f}% da faixa, {100 * min(g.get('ruido_liso') or float('nan'), 1.0):.0f}% dele liso"
               f"  →  leito contínuo = {100 * lf:.0f}% da potência da faixa")
        ax.text(0.995, 0.03, txt, transform=ax.transAxes, fontsize=8, color=TINTA, ha='right', va='bottom',
                bbox=dict(facecolor=FUNDO, edgecolor=GRADE, alpha=0.85, pad=2.5))
        _eixo(ax, f"6 · envoltória de 1–6 kHz dobrada no ciclo · {'REAL' if n == 'real' else 'SIMULADO'}", 'ângulo do ciclo (em períodos de ignição)',
              'dB re RMS da envoltória' if j == 0 else None)

    # ------------------------------------------------------------------ 7. rodapé
    axr = fig.add_subplot(gs[7, :]); axr.axis('off')
    import textwrap
    linhas = []
    for ln in (rodape or '').split('\n'):
        linhas += textwrap.wrap(ln, 200, subsequent_indent='       ', break_long_words=False, drop_whitespace=False) or ['']
    axr.text(0, 1.0, '\n'.join(linhas), fontsize=8.2, color=TINTA, va='top', family='DejaVu Sans Mono', linespacing=1.3)
    fig.savefig(saida, dpi=dpi, facecolor=FUNDO)
    plt.close(fig)


def compactar(entrada, saida, largura=1150, cores=40):
    """Versão pequena de um painel para entrar na documentação (o git só recebe painéis, e pequenos): reduz a largura
    e a paleta (PNG de 8 bits). `python3 -I tools/ouvido/painel.py painel.png docs/ouvido/nome.png [largura] [cores]`."""
    from PIL import Image
    im = Image.open(entrada).convert('RGB')
    if im.width > largura:
        im = im.resize((largura, round(im.height * largura / im.width)), Image.LANCZOS)
    im.quantize(colors=cores, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(saida, optimize=True)
    return os.path.getsize(saida)


if __name__ == '__main__':
    import sys
    if len(sys.argv) < 3:
        print(compactar.__doc__); sys.exit(2)
    n = compactar(sys.argv[1], sys.argv[2], *(int(v) for v in sys.argv[3:5]))
    print(f'{sys.argv[2]}: {n / 1024:.0f} kB')
