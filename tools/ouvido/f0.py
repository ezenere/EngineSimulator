#!/usr/bin/env python3
"""f0.py — rastreia a rotação (f0 do ciclo) de um motor num WAV, com as salvaguardas contra erro de oitava do
docs/REVISAO-DE-SOM.md ("a linha mais forte não é a ignição").

    python3 -I tools/ouvido/f0.py GRAVACAO.wav [--trecho a-b] [--fmin 4 --fmax 60] [--nominal Hz [--folga 0.08]]
                                  [--voltas-por-ciclo 2] [--canal media|e|d] [--linha-do-tempo [--bloco 4]] [--json]

f0 aqui é a frequência do CICLO (720° no 4 tempos: rpm/120; 360° no 2 tempos: rpm/60). Três estimadores conferem um
ao outro:

  1. Pente harmônico (espectro): em janelas curtas, a nota f que mais alinha dentes k·f com linhas do espectro
     branqueado, com multa para linhas no meio dos dentes; um caminho suave no tempo (Viterbi). O pente sozinho erra de
     oitava: fica com a ignição ou com um harmônico forte.
  2. Fase da linha mais forte: a linha de maior nível do pente é demodulada (heteródino + passa-baixa) e dá uma fase
     fina, que acompanha o vibrato do giro. Essa linha é o harmônico N do ciclo, com N desconhecido.
  3. Dobramento em N períodos: o sinal é reamostrado na fase da linha e dobrado em N = 1…32 períodos dela. Só o N do
     ciclo verdadeiro (e seus múltiplos) dá fração periódica alta. Confere-se em três sinais: a onda do grave em
     volta da linha, a onda acima dela e a ENVOLTÓRIA de 1–6 kHz (a repetição dos estalos). Fica o menor N que
     explica quase tanto quanto o melhor.

Com `--nominal` (rotação conhecida) a busca fica em ±folga e N não é escolhido, só conferido (sai um aviso se a
dobra discorda). `--linha-do-tempo` varre o arquivo em blocos e lista rotação, confiança e nível por banda: serve para
achar trechos estáveis, motor desligado e aceleradas numa gravação longa.

Como biblioteca: `rastrear(x, fs, ...)` devolve a fase do ciclo por amostra (para `nucleo.analisar`).
"""
import argparse
import json
import sys
import os

import numpy as np
from scipy import signal

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nucleo as nu  # noqa: E402


# ------------------------------------------------------------------------------------------ pente harmônico
def _decimar(x, fs, fmax_lin):
    q = max(1, int(fs // (2.6 * fmax_lin)))
    xd = x
    r = q
    while r > 1:  # em estágios de até 8×
        p = min(r, 8)
        while r % p:
            p -= 1
        if p == 1:
            p = r
        xd = signal.decimate(xd, p, ftype='fir', zero_phase=True)
        r //= p
    return xd, fs / q, q


def _proeminencia(xd, fsd, jan, salto, larg_hz):
    """STFT → dB acima do piso local (percentil 30 em blocos de `larg_hz`), limitado a [0, 30]."""
    n = int(round(jan * fsd))
    nfft = nu.pot2(4 * n)
    hop = max(1, int(round(salto * fsd)))
    f, t, Z = signal.stft(xd, fsd, window='hann', nperseg=n, noverlap=n - hop, nfft=nfft, boundary=None, padded=False)
    A = np.abs(Z)
    Ld = 20 * np.log10(A + 1e-12)
    b = max(4, int(round(0.5 * larg_hz / (f[1] - f[0]))))
    nb = len(f) // b
    blocos = Ld[:nb * b].reshape(nb, b, -1)
    piso_b = np.percentile(blocos, 30, axis=1)
    centros = (np.arange(nb) + 0.5) * b
    piso = np.empty_like(Ld)
    idx = np.arange(len(f))
    for j in range(Ld.shape[1]):
        piso[:, j] = np.interp(idx, centros, piso_b[:, j])
    return f, t, A, np.clip(Ld - piso, 0, 30)


def _pente(P, f, grade, fmax_lin, kmax=30, f_piso=12.0):
    """Nota do pente para cada quadro e cada candidato: média da proeminência nos dentes k·f menos metade da média
    no meio dos dentes."""
    k = np.arange(1, kmax + 1)
    pos = grade[:, None] * k[None, :]
    posm = grade[:, None] * (k[None, :] - 0.5)
    ok = (pos <= fmax_lin) & (pos >= f_piso)
    okm = (posm <= fmax_lin) & (posm >= f_piso)
    nd = np.maximum(ok.sum(1), 1)
    ndm = np.maximum(okm.sum(1), 1)
    S = np.empty((P.shape[1], len(grade)))
    for j in range(P.shape[1]):
        col = P[:, j]
        a = np.interp(pos, f, col) * ok
        b = np.interp(posm, f, col) * okm
        S[j] = a.sum(1) / nd - 0.5 * b.sum(1) / ndm
    return S


def _viterbi(S, W, pen):
    """Caminho de maior nota com transição limitada a ±W pontos da grade por quadro e multa `pen` por ponto."""
    T, n = S.shape
    acc = S[0].copy()
    volta = np.zeros((T, n), dtype=np.int32)
    desl = np.arange(-W, W + 1)
    for t in range(1, T):
        melhor = np.full(n, -np.inf)
        arg = np.zeros(n, dtype=np.int32)
        for d in desl:
            cand = np.full(n, -np.inf)
            if d >= 0:
                cand[d:] = acc[:n - d] - pen * abs(d)
            else:
                cand[:n + d] = acc[-d:] - pen * abs(d)
            m = cand > melhor
            melhor[m] = cand[m]
            arg[m] = d
        volta[t] = arg
        acc = melhor + S[t]
    i = int(np.argmax(acc))
    cam = np.zeros(T, dtype=np.int32)
    for t in range(T - 1, -1, -1):
        cam[t] = i
        i = i - volta[t][i]
    return cam


# ------------------------------------------------------------------------------- fase fina da linha mais forte
def _fase_linha(xd, fsd, t_q, f_trk, k, fc):
    """Demodula o harmônico k do caminho do pente: fase total (rad) e amplitude da linha, por amostra de xd."""
    n = len(xd)
    tt = np.arange(n) / fsd
    fi = np.interp(tt, t_q, f_trk)
    fase0 = 2 * np.pi * k * np.cumsum(fi) / fsd
    z = xd * np.exp(-1j * fase0)
    sos = signal.butter(4, fc, fs=fsd, output='sos')
    zr = signal.sosfiltfilt(sos, z.real) + 1j * signal.sosfiltfilt(sos, z.imag)
    psi = np.unwrap(np.angle(zr))
    fase = np.maximum.accumulate(fase0 + psi)
    return fase, 2 * np.abs(zr)


def _refinar(xd, fsd, fase_c, f, P, t_q, fc, fmax_lin, n_ref):
    """Afina a fase do ciclo com várias linhas ao mesmo tempo. Um erro δ(t) na fase do ciclo aparece no harmônico h
    como h·δ: as linhas altas medem δ com mais alavanca e a média de várias tira o ruído que a linha de referência
    sozinha deixa passar. Em três estágios (harmônicos até 2·N, 6·N e todos), porque a fase residual de uma linha só
    vale enquanto h·δ < π. Peso de cada linha: h² × relação sinal/ruído × amplitude instantânea."""
    n = len(xd)
    tt = np.arange(n) / fsd
    sos = signal.butter(4, fc, fs=fsd, output='sos')
    df = f[1] - f[0]
    for lim in (2 * n_ref, 6 * n_ref, 10 ** 9):
        f0_q = np.interp(t_q, tt, np.gradient(fase_c) * fsd / (2 * np.pi))
        hmax = int(min(lim, np.floor(fmax_lin / max(np.max(f0_q), 1e-9))))
        cand = []
        for h in range(1, hmax + 1):
            ib = np.clip(np.round(h * f0_q / df).astype(int), 2, len(f) - 3)
            pr = np.median(np.max(np.stack([P[ib + d, np.arange(len(ib))] for d in (-2, -1, 0, 1, 2)]), axis=0))
            if pr >= 8.0 and np.median(h * f0_q) >= 15.0:
                cand.append((pr, h))
        cand = sorted(cand, reverse=True)[:16]
        num = np.zeros(n)
        den = np.zeros(n)
        for pr, h in cand:
            z = xd * np.exp(-1j * h * fase_c)
            zr = signal.sosfiltfilt(sos, z.real) + 1j * signal.sosfiltfilt(sos, z.imag)
            zm = zr.mean()
            a2 = np.abs(zr) ** 2
            if abs(zm) < 0.5 * np.sqrt(a2.mean()):
                continue   # (a linha não acompanha a fase atual: não é ordem do motor, ou treme demais)
            psi = np.angle(zr * np.conj(zm))
            w = h * h * 10 ** (min(pr, 30.0) / 10) * a2 / max(np.median(a2), 1e-30)
            num += w * psi / h
            den += w
        if not np.any(den > 0):
            continue
        fase_c = np.maximum.accumulate(fase_c + num / np.maximum(den, 1e-30))
    return fase_c


def _dobras(x, fs, fase_linha, f_linha, nmax, fmax_lin):
    """Fração periódica dobrando em N períodos da linha, para três sinais (a onda do grave em volta da linha, a onda
    acima dela e a envoltória do médio-agudo). Devolve ({N: (grave, acima, envoltória)}, sinais no ângulo, pontos por
    período da linha)."""
    PPL = 48  # pontos por período da linha
    lo1, hi1 = max(12.0, 0.2 * f_linha), 2.5 * f_linha
    lo2, hi2 = hi1, min(10 * f_linha, 0.45 * fs, max(fmax_lin, 4 * f_linha))
    loe, hie = max(1000.0, 6 * f_linha), 6000.0
    sinais = []
    sinais.append(nu.passa_faixa(x, lo1, hi1, fs))
    sinais.append(nu.passa_faixa(x, lo2, hi2, fs) if hi2 > lo2 * 1.2 else None)
    if hie > loe * 1.3:
        _, e = nu.envoltoria(x, loe, hie, fs, min(400.0, 2.0 * f_linha))
        sinais.append(e)
    else:
        sinais.append(None)
    ang = []
    for s in sinais:
        if s is None:
            ang.append(None)
            continue
        y, _ = nu.reamostrar_sincrono(s, fase_linha, PPL, fator=1)
        ang.append(y)
    out = {}
    for N in range(1, nmax + 1):
        vals = []
        for y in ang:
            if y is None or len(y) // (PPL * N) < 6:
                vals.append(float('nan'))
            else:
                vals.append(nu.fracao_periodica(nu.dobrar(y, PPL * N)))
        if np.all(np.isnan(vals)):
            break
        out[N] = tuple(vals)
    return out, ang, PPL


def _residuo_periodico(ang, PPL, d, N):
    """Depois de tirar o que se repete a cada d períodos da linha, que fração do que SOBRA ainda se repete a cada N
    (N múltiplo de d)? ~0 se dobrar em d já explica tudo o que dobrar em N explica; alta se o ciclo é mais longo que d.
    Uma linha forte sozinha não engana esta conta (ela sai inteira na primeira dobra). Devolve a lista por sinal."""
    out = []
    for y in ang:
        if y is None or len(y) // (PPL * N) < 6:
            out.append(float('nan'))
            continue
        G = nu.dobrar(y, PPL * N)
        md = nu.dobrar(y, PPL * d).mean(0)
        out.append(nu.fracao_periodica(G - np.tile(md, N // d)[None, :]))
    return out


def _significativo(res):
    res = [r for r in res if np.isfinite(r)]
    return bool(res) and (float(np.mean(res)) >= 0.06 or max(res) >= 0.15)


def _escolher_n(pf, ang, PPL):
    """O ciclo é o MENOR período que explica o que há de periódico. Primeiro o N que mais explica (média dos três
    sinais, robusta pelos múltiplos de N); depois, entre os divisores dele, o menor d tal que o que sobra da dobra
    em d já não se repete em N."""
    Ns = sorted(pf)
    med = {N: float(np.nanmean(pf[N])) for N in Ns}
    rob = {}
    for N in Ns:
        mult = [med[m] for m in Ns if m % N == 0]
        rob[N] = float(np.median(mult[:4])) if len(mult) >= 2 else med[N]
    melhor = max(rob.values())
    n_max = min(N for N in Ns if rob[N] >= melhor - 1e-9)
    for d in [d for d in Ns if n_max % d == 0]:
        if d == n_max or not _significativo(_residuo_periodico(ang, PPL, d, n_max)):
            return d, rob, melhor, n_max
    return n_max, rob, melhor, n_max


# -------------------------------------------------------------------------------------------------- rastrear
def rastrear(x, fs=nu.FS, fmin=4.0, fmax=60.0, nominal=None, folga=0.08, nmax=32, voltas=2, verbose=False):
    """Rastreia o ciclo. Devolve um dicionário: `fase` (rad por amostra, 2π por ciclo), `f0` (mediana, Hz), `f0_p5`,
    `f0_p95`, `rpm`, `t`/`f0_t` (trajetória), `N` (harmônico do ciclo que a linha de referência é), `linha_hz`,
    `pente_hz` (o que o pente sozinho disse), `pf` (tabela das dobras), `confianca` (fração periódica média no N
    escolhido) e `avisos`."""
    avisos = []
    if nominal:
        fmin_b, fmax_b = nominal * (1 - folga), nominal * (1 + folga)
    else:
        fmin_b, fmax_b = fmin, fmax
    fmax_lin = float(min(max(1500.0, 24 * fmax_b), 0.42 * fs))
    xd, fsd, q = _decimar(x, fs, fmax_lin)
    jan = float(np.clip(6.0 / fmin_b, 0.15, 1.5))
    jan = min(jan, len(xd) / fsd / 3)
    salto = jan / 4
    f, t_q, A, P = _proeminencia(xd, fsd, jan, salto, float(np.clip(6 * fmax_b, 40, 1000)))
    t_q = t_q + 0.0
    passo = 0.001
    grade = fmin_b * np.exp(np.arange(0, np.log(fmax_b / fmin_b) + passo, passo))
    S = _pente(P, f, grade, fmax_lin)
    W = max(2, int(np.ceil(0.04 / passo)))
    cam = _viterbi(S, W, pen=0.02 * np.percentile(S.max(1), 50) + 1e-6)
    f_trk = grade[cam]
    nota = float(np.median(S[np.arange(len(cam)), cam]))
    pente_hz = float(np.median(f_trk))
    # ---- linha de referência: o harmônico do caminho com maior nível mediano
    fmax_l = float(min(fmax_lin, max(600.0, 10 * fmax_b)))
    df = f[1] - f[0]
    niv = {}
    for k in range(1, 41):
        fk = k * f_trk
        if np.median(fk) > fmax_l or np.median(fk) < 15.0:
            continue
        ib = np.clip(np.round(fk / df).astype(int), 2, len(f) - 3)
        a = np.max(np.stack([A[ib + d, np.arange(len(ib))] for d in (-2, -1, 0, 1, 2)]), axis=0)
        niv[k] = float(np.median(a))
    if not niv:
        raise ValueError('nenhuma linha na faixa de busca')
    k_ref = max(niv, key=niv.get)
    f_linha = k_ref * pente_hz
    fc = float(np.clip(0.35 * fmin_b, 3.0, 40.0))
    fase_l, amp_l = _fase_linha(xd, fsd, t_q, f_trk, k_ref, fc)
    # (segunda passada: re-demodula em volta da própria fase alisada, para tirar o erro do caminho em degraus)
    fl = np.gradient(fase_l) * fsd / (2 * np.pi)
    fl = nu.passa_baixa(fl, fc, fsd)
    fase_l, amp_l = _fase_linha(xd, fsd, np.arange(len(xd)) / fsd, fl / k_ref, k_ref, fc)
    # para a taxa original
    fase_L = np.interp(np.arange(len(x)) / fs, np.arange(len(xd)) / fsd, fase_l)
    f_linha = float(np.median(np.diff(fase_L)) * fs / (2 * np.pi))
    # ---- dobramento em N períodos
    if nominal:
        n_user = max(1, int(round(f_linha / nominal)))
        lim = min(nmax, max(n_user * 2, 8))
    else:
        lim = int(min(nmax, max(1, np.floor(f_linha / fmin))))
    pf, ang, PPL = _dobras(x, fs, fase_L, f_linha, lim, fmax_lin)
    n_dobra, rob, melhor, n_max = _escolher_n(pf, ang, PPL)
    if nominal:
        N = n_user
        if N in rob and n_dobra != N:
            if n_dobra % N == 0:
                res = _residuo_periodico(ang, PPL, N, n_dobra)
                if _significativo(res):
                    avisos.append(f'com o f0 nominal ({nominal:.2f} Hz, N={N}) sobra som periódico num período {n_dobra // N}× mais longo (fração do resíduo: '
                                  + ' / '.join('--' if not np.isfinite(v) else f'{v:.2f}' for v in res) + f'): confira a rotação (f0 = {f_linha / n_dobra:.2f} Hz?) '
                                  f'ou é um padrão que se repete a cada {n_dobra // N} ciclos')
            elif rob[N] < melhor - max(0.1, 0.25 * melhor):
                avisos.append(f'a dobra em N={N} (f0 nominal {nominal:.2f} Hz) explica {rob[N]:.2f} do sinal, e em N={n_dobra} explica {rob[n_dobra]:.2f}: '
                              f'confira a rotação (f0 = {f_linha / n_dobra:.2f} Hz?)')
    else:
        N = n_dobra
        # o ciclo não pode passar de fmax nem ficar abaixo de fmin
        while f_linha / N > fmax * 1.02 and N < lim:
            N += 1
    # ---- afinação com várias linhas, na taxa decimada, e volta à taxa original
    fase_d = _refinar(xd, fsd, fase_l / N, f, P, t_q, fc, fmax_lin, N)
    fase = np.interp(np.arange(len(x)) / fs, np.arange(len(xd)) / fsd, fase_d)
    f0_t = np.gradient(fase) * fs / (2 * np.pi)
    f0 = float(np.median(f0_t))
    if abs(pente_hz / f0 - 1) > 0.03:
        avisos.append(f'o pente sozinho dava {pente_hz:.2f} Hz ({pente_hz / f0:.2f}× o ciclo): corrigido pela dobra')
    conf = float(np.nanmean(pf[N])) if N in pf else float('nan')
    if not np.isfinite(conf) or conf < 0.15:
        avisos.append(f'fração periódica baixa ({conf:.2f}): pouco som periódico no trecho, ou a rotação varia rápido demais')
    amp_rel = float(np.percentile(amp_l, 10) / max(np.median(amp_l), 1e-12))
    if amp_rel < 0.2:
        avisos.append('a linha de referência some em parte do trecho: a fase ali não é confiável')
    passo_t = max(1, int(0.1 * fs))
    r = {'fase': fase, 'f0': f0, 'f0_p5': float(np.percentile(f0_t, 5)), 'f0_p95': float(np.percentile(f0_t, 95)),
         'rpm': f0 * 60 * voltas, 't': (np.arange(len(x)) / fs)[::passo_t], 'f0_t': f0_t[::passo_t], 'N': int(N), 'N_dobra': int(n_dobra),
         'linha_hz': f_linha, 'k_pente': int(k_ref), 'pente_hz': pente_hz, 'nota_pente': nota, 'pf': pf, 'pf_rob': rob,
         'confianca': conf, 'avisos': avisos}
    if verbose:
        print(resumo(r))
    return r


def resumo(r, voltas=2):
    L = [f"f0 (ciclo) {r['f0']:.3f} Hz  (p5–p95 {r['f0_p5']:.3f}–{r['f0_p95']:.3f}, ±{50 * (r['f0_p95'] - r['f0_p5']) / r['f0']:.1f}%)  →  {r['rpm']:.0f} rpm",
         f"linha de referência {r['linha_hz']:.2f} Hz = harmônico {r['N']} do ciclo · pente sozinho: {r['pente_hz']:.2f} Hz · fração periódica no N escolhido: {r['confianca']:.2f}",
         'dobra em N períodos da linha (grave / acima / envoltória 1–6k):']
    for N, v in r['pf'].items():
        marca = '  ← ciclo' if N == r['N'] else ''
        L.append(f"   N={N:2d}  f={r['linha_hz'] / N:7.2f} Hz   " + ' '.join('  -- ' if np.isnan(a) else f'{a:5.2f}' for a in v) + marca)
    for a in r['avisos']:
        L.append('AVISO: ' + a)
    return '\n'.join(L)


# -------------------------------------------------------------------------------------------- linha do tempo
def linha_do_tempo(x, fs, bloco, fmin, fmax, voltas):
    bandas = [(60, 150), (150, 400), (400, 1000), (1000, 2500), (2500, 6000), (6000, 12000)]
    n = int(bloco * fs)
    print('    t(s)   f0(Hz)    rpm   ±%   conf  N  | ' + ' '.join(f'{lo}-{hi}'.rjust(10) for lo, hi in bandas) + '  (dBFS)')
    for i in range(0, len(x) - n + 1, n // 2):
        seg = x[i:i + n]
        niv = nu.db10(nu.energia_bandas(seg, fs, bandas, 4096))
        try:
            r = rastrear(seg, fs, fmin, fmax, voltas=voltas)
            s = f"{r['f0']:8.2f} {r['rpm']:6.0f} {50 * (r['f0_p95'] - r['f0_p5']) / r['f0']:4.1f}  {r['confianca']:5.2f} {r['N']:2d}"
        except Exception:  # (silêncio, trecho sem linhas)
            s = '      --     --   --     --  --'
        print(f'{i / fs:8.1f} {s}  | ' + ' '.join(f'{v:10.1f}' for v in niv))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('arquivo')
    ap.add_argument('--trecho', help='a-b em segundos')
    ap.add_argument('--canal', default='media', help='media (padrão), e ou d')
    ap.add_argument('--fmin', type=float, default=4.0, help='menor f0 de ciclo procurado, Hz (4 Hz = 480 rpm no 4 tempos)')
    ap.add_argument('--fmax', type=float, default=60.0, help='maior f0 de ciclo procurado, Hz (60 Hz = 7200 rpm no 4 tempos)')
    ap.add_argument('--nominal', type=float, help='f0 conhecido (Hz): rastreia só em ±folga e confere')
    ap.add_argument('--rpm', type=float, help='alternativa a --nominal: rotação conhecida')
    ap.add_argument('--folga', type=float, default=0.08)
    ap.add_argument('--voltas-por-ciclo', type=float, default=2.0, help='2 no 4 tempos (padrão), 1 no 2 tempos')
    ap.add_argument('--linha-do-tempo', action='store_true', help='varre o arquivo em blocos')
    ap.add_argument('--bloco', type=float, default=4.0)
    ap.add_argument('--json', action='store_true')
    a = ap.parse_args()
    x, fs = nu.ler_audio(a.arquivo, nu.parse_trecho(a.trecho), a.canal)
    if a.linha_do_tempo:
        linha_do_tempo(x, fs, a.bloco, a.fmin, a.fmax, a.voltas_por_ciclo)
        return
    nominal = a.nominal or (a.rpm / 60.0 / a.voltas_por_ciclo if a.rpm else None)
    r = rastrear(x, fs, a.fmin, a.fmax, nominal, a.folga, voltas=a.voltas_por_ciclo)
    if a.json:
        print(json.dumps(nu.limpar({k: v for k, v in r.items() if k not in ('fase', 'pf', 'pf_rob')} | {'pf': {str(k): list(v) for k, v in r['pf'].items()}})))
    else:
        print(resumo(r))


if __name__ == '__main__':
    main()
