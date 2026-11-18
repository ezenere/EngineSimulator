"""Sinais sintéticos com resposta conhecida, para os autotestes do kit (e para experimentar as medidas).

Um "motor" aqui é uma série harmônica do ciclo (amplitudes escolhidas) tocada com a fase do ciclo, que pode ter
vibrato de rotação, mais ruído com espectro e envoltória escolhidos. Nada disto imita um motor de verdade: serve para
plantar um valor (HNR, modulação, um tom, uma oitava errada) e conferir se a medida devolve o que foi plantado.
"""
import numpy as np
from scipy import signal

import nucleo as nu

FS = nu.FS


def fase_ciclo(dur, f0, vibrato=0.0, f_vib=0.7, deriva=0.0, fs=FS, semente=1):
    """Fase do ciclo (rad por amostra). `vibrato`: desvio relativo senoidal do giro; `deriva`: variação relativa
    lenta e aleatória (passeio suave), como uma lenta que caça."""
    n = int(dur * fs)
    t = np.arange(n) / fs
    f = f0 * (1 + vibrato * np.sin(2 * np.pi * f_vib * t))
    if deriva:
        rng = np.random.default_rng(semente)
        w = nu.passa_baixa(rng.standard_normal(n), 0.5, fs)
        f = f * (1 + deriva * w / max(np.abs(w).max(), 1e-12))
    return 2 * np.pi * np.cumsum(f) / fs


def serie_harmonica(fase, amps, fases=None, K=1 << 15):
    """Soma de harmônicos do ciclo com amplitudes `amps[k-1]` (k = 1…len): tabela de onda de K pontos (limitada em
    banda por construção) lida na fase do ciclo com interpolação cúbica."""
    amps = np.asarray(amps, dtype=float)
    H = len(amps)
    assert K >= 8 * H, 'tabela curta para tantos harmônicos'
    if fases is None:
        fases = np.random.default_rng(7).uniform(0, 2 * np.pi, H)
    c = np.zeros(K // 2 + 1, dtype=complex)
    c[1:H + 1] = 0.5 * amps * np.exp(1j * fases) * K
    tab = np.fft.irfft(c, K)
    from scipy import ndimage
    pos = (fase / (2 * np.pi)) % 1.0 * K
    return ndimage.map_coordinates(tab, [pos], order=3, mode='grid-wrap')


def amps_motor(f0, ev=4, n_harm=None, fmax=9000.0, queda_db_oit=-9.0, f_joelho=120.0, meias_db=-12.0, cilindros=None, fs=FS):
    """Amplitudes de uma série "de motor": as linhas múltiplas da ignição (k múltiplo de `ev`) seguem uma queda de
    `queda_db_oit` dB/oitava acima de `f_joelho`; as outras (meias ordens) ficam `meias_db` abaixo. `cilindros`
    (lista de `ev` pesos) desiguala as explosões em vez de usar `meias_db`."""
    H = n_harm or int(min(fmax, 0.45 * fs) / f0)
    k = np.arange(1, H + 1)
    f = k * f0
    env = 10 ** ((queda_db_oit * np.log2(np.maximum(f, f_joelho) / f_joelho)) / 20)
    if cilindros is not None:
        # DFT do padrão de pesos: o harmônico k do ciclo pesa |Σ w_j e^{-2πi k j/ev}|/Σw
        w = np.asarray(cilindros, dtype=float)
        j = np.arange(ev)
        pes = np.abs((w[None, :] * np.exp(-2j * np.pi * k[:, None] * j[None, :] / ev)).sum(1)) / w.sum()
        return env * pes
    return env * np.where(k % ev == 0, 1.0, 10 ** (meias_db / 20))


def ruido(n, inclinacao_db_oit=-3.0, fs=FS, semente=3, f_lo=20.0):
    """Ruído gaussiano com inclinação espectral dada (0 = branco, −3 = rosa), variância 1."""
    rng = np.random.default_rng(semente)
    X = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / fs)
    g = (np.maximum(f, f_lo) / 1000.0) ** (inclinacao_db_oit / 6.0206)
    g[f < f_lo] *= (f[f < f_lo] / f_lo) ** 2
    y = np.fft.irfft(X * g, n)
    return y / y.std()


def modular_no_ciclo(y, fase, ev, profundidade=0.9, largura=0.25):
    """Modula um ruído por um trem de pulsos preso ao ciclo (um pulso por explosão, cada um ocupando `largura` do
    intervalo entre explosões), mantendo a potência média: é o "chiado colado ao pulso"."""
    th = (fase * ev / (2 * np.pi)) % 1.0
    pulso = np.exp(-0.5 * ((th - 0.5) / (largura / 2.355)) ** 2)
    g = (1 - profundidade) + profundidade * pulso / pulso.mean()
    z = y * g
    return z * (y.std() / z.std())


def mesmo_espectro(y, alvo, fs=FS, voltas=3):
    """Filtra `y` para ter o mesmo espectro médio de `alvo` (correção de fase zero, repetida `voltas` vezes)."""
    n = len(y)
    f = np.fft.rfftfreq(n, 1 / fs)
    k = np.ones(9) / 9
    for _ in range(voltas):
        fy, Py = signal.welch(y, fs, nperseg=16384)
        fa, Pa = signal.welch(alvo, fs, nperseg=16384)
        g = np.sqrt(np.convolve(Pa, k, 'same') / np.maximum(np.convolve(Py, k, 'same'), 1e-30))
        y = np.fft.irfft(np.fft.rfft(y) * np.interp(f, fy, g), n)
    return y


def embaralhar_fases(x, semente=11):
    """Substituto de fase aleatória: mesmo espectro de potência (bin a bin) do sinal inteiro, sem nenhuma estrutura no
    tempo. É o "mesmo som, liso": as tabelas de banda não mudam e o ouvido ouve mar."""
    rng = np.random.default_rng(semente)
    X = np.fft.rfft(x)
    ph = rng.uniform(0, 2 * np.pi, len(X))
    ph[0] = 0
    return np.fft.irfft(np.abs(X) * np.exp(1j * ph), len(x))
