"""Núcleo do kit ouvido: leitura de áudio, filtros, envoltória, reamostragem síncrona ao ciclo e as medidas.

Tudo aqui é função pura sobre vetores numpy; os programas de linha de comando (`comparar.py`, `f0.py`,
`orcamento.py`, `autoteste.py`) só montam chamadas. Rode sempre com `python3 -I`.

Convenções:
  f0      frequência do CICLO do motor em Hz (o menor período em que o som se repete): rpm/120 no 4 tempos, rpm/60 no
          2 tempos. Todas as linhas de um motor em regime são múltiplos de f0 (as "meias ordens" incluídas).
  ev      eventos (explosões) por ciclo: 4 num 4 cilindros, 8 num V8. Ignição = ev·f0. Rotação = voltas·f0.
  fase    fase do ciclo em radianos, uma por amostra, monotônica (2π por ciclo). É ela que deixa as medidas
          imunes ao vibrato de rotação: o sinal é reamostrado numa grade uniforme de ângulo.
  bandas  30–60, 60–150, 150–400, 400–1k, 1–2,5k, 2,5–6k, 6–12k Hz.
"""
import warnings
import numpy as np
from scipy import signal, ndimage, fft as sfft
from scipy.io import wavfile

FS = 48000
BANDAS = [(30, 60), (60, 150), (150, 400), (400, 1000), (1000, 2500), (2500, 6000), (6000, 12000)]
NOMES = ['30-60', '60-150', '150-400', '400-1k', '1-2,5k', '2,5-6k', '6-12k']
IDX_REF = 2  # 150–400 Hz: a âncora do projeto (microfone de celular corta abaixo de ~150 Hz)
EPS = 1e-30


def db10(x):
    return 10.0 * np.log10(np.maximum(x, EPS))


def db20(x):
    return 20.0 * np.log10(np.maximum(x, 1e-15))


# ---------------------------------------------------------------------------------------------- leitura
def ler_audio(caminho, trecho=None, canal='media', fs_alvo=FS):
    """Lê WAV (PCM 8/16/24/32 ou float) ou `.f32` cru (float32 estéreo intercalado a 48 kHz, o formato de
    tools/analise-som). Devolve (x mono float64, fs). `trecho` = (t0, t1) em segundos. `canal`: 'media', 'e' ou 'd'."""
    caminho = str(caminho)
    if caminho.endswith('.f32'):
        a = np.fromfile(caminho, dtype='<f4').astype(np.float64).reshape(-1, 2)
        fs = FS
    else:
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            fs, a = wavfile.read(caminho)
        if a.dtype.kind == 'i':
            a = a.astype(np.float64) / float(2 ** (8 * a.dtype.itemsize - 1))
        elif a.dtype.kind == 'u':
            a = (a.astype(np.float64) - 128.0) / 128.0
        else:
            a = a.astype(np.float64)
    if trecho is not None:
        t0, t1 = trecho
        a = a[int(round(t0 * fs)):(int(round(t1 * fs)) if t1 is not None else None)]
    if a.ndim == 2:
        if canal in ('e', 'E', '0', 'l', 'L'):
            a = a[:, 0]
        elif canal in ('d', 'D', '1', 'r', 'R'):
            a = a[:, min(1, a.shape[1] - 1)]
        else:
            a = a.mean(axis=1)
    if fs != fs_alvo:
        g = np.gcd(int(fs), int(fs_alvo))
        a = signal.resample_poly(a, fs_alvo // g, fs // g)
        fs = fs_alvo
    if not np.all(np.isfinite(a)):
        raise ValueError(f'{caminho}: amostras não finitas (NaN/inf)')
    return np.ascontiguousarray(a, dtype=np.float64), fs


def gravar_wav(caminho, x, fs=FS):
    """WAV mono float32 (para os sinais sintéticos dos autotestes e os casos fabricados da régua)."""
    wavfile.write(str(caminho), fs, np.asarray(x, dtype=np.float32))


def parse_trecho(s):
    """'a-b' em segundos → (a, b); None → None."""
    if s is None:
        return None
    a, b = str(s).split('-', 1)
    return float(a), (float(b) if b else None)


# ---------------------------------------------------------------------------------------------- filtros
def passa_faixa(x, lo, hi, fs=FS, ordem=4):
    """Butterworth em seções de 2ª ordem, fase zero (REVISAO-DE-SOM: a forma (b, a) estoura com cortes baixos)."""
    hi = min(hi, 0.49 * fs)
    sos = signal.butter(ordem, [lo, hi], 'bandpass', fs=fs, output='sos')
    return signal.sosfiltfilt(sos, x)


def passa_baixa(x, fc, fs=FS, ordem=2):
    sos = signal.butter(ordem, min(fc, 0.49 * fs), fs=fs, output='sos')
    return signal.sosfiltfilt(sos, x)


def hilbert_abs(y):
    n = len(y)
    m = sfft.next_fast_len(n)
    return np.abs(signal.hilbert(y, m))[:n]


def fc_envoltoria(lo, hi, f_ign=None, rapida=False):
    """Corte do passa-baixa da envoltória. A envoltória "do motor" guarda até o 3º harmônico da ignição (o pulso tem
    forma, mas o granulado próprio do ruído é alisado: é o que separa chiado liso de chiado pulsado); a "rápida"
    (400 Hz) serve para estalos. Nunca passa de meia largura da banda."""
    teto = 0.5 * (hi - lo)
    if rapida or not f_ign:
        return min(400.0, teto)
    return min(float(np.clip(3.0 * f_ign, 50.0, 400.0)), teto)


def envoltoria(x, lo, hi, fs=FS, fc=None):
    """(sinal da banda, envoltória |Hilbert| alisada)."""
    y = passa_faixa(x, lo, hi, fs)
    e = hilbert_abs(y)
    e = passa_baixa(e, fc if fc else fc_envoltoria(lo, hi), fs)
    return y, np.maximum(e, 0.0)


def ponderacao_a(f):
    """Curva A (IEC 61672), ganho de potência (linear) por frequência."""
    f = np.maximum(np.asarray(f, dtype=float), 1e-6)
    f2 = f * f
    ra = (12194.0 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * np.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194.0 ** 2))
    return (ra * 10 ** (2.0 / 20)) ** 2


def psd_welch(x, fs=FS, n=8192):
    n = min(n, len(x))
    return signal.welch(x, fs, nperseg=n, noverlap=n // 2, window='hann', scaling='density')


def energia_bandas(x, fs=FS, bandas=BANDAS, n=8192):
    """Potência (integral da PSD) em cada banda."""
    f, P = psd_welch(x, fs, n)
    df = f[1] - f[0]
    return np.array([P[(f >= lo) & (f < hi)].sum() * df for lo, hi in bandas])


def tercos(x, fs=FS, f_lo=100.0, f_hi=12000.0, fracao=3, n=8192):
    """Níveis em 1/fracao de oitava (potência por banda). Devolve (centros, potência)."""
    f, P = psd_welch(x, fs, n)
    df = f[1] - f[0]
    k0 = int(np.ceil(fracao * np.log2(f_lo / 1000.0)))
    k1 = int(np.floor(fracao * np.log2(f_hi / 1000.0)))
    cs = 1000.0 * 2.0 ** (np.arange(k0, k1 + 1) / fracao)
    h = 2.0 ** (1.0 / (2 * fracao))
    out = np.array([P[(f >= c / h) & (f < c * h)].sum() * df for c in cs])
    return cs, out


def inclinacao_espectral(x, fs=FS, f_lo=150.0, f_hi=6000.0):
    """Inclinação (dB por oitava) da reta ajustada à densidade em terços de oitava entre f_lo e f_hi."""
    cs, p = tercos(x, fs, f_lo, f_hi)
    # densidade (potência por Hz): terços têm largura ∝ f; ruído rosa dá −3 dB/oitava, branco 0
    dens = p / (cs * (2 ** (1 / 6) - 2 ** (-1 / 6)))
    ok = dens > 0
    if ok.sum() < 3:
        return float('nan')
    a, _ = np.polyfit(np.log2(cs[ok]), db10(dens[ok]), 1)
    return float(a)


# ---------------------------------------------------------------------------------- domínio do ângulo
def pot2(n):
    return 1 << int(np.ceil(np.log2(max(2, n))))


def fase_constante(n, f0, fs=FS):
    """Fase de um ciclo de frequência fixa (simulado com giro travado)."""
    return 2 * np.pi * f0 * np.arange(n) / fs


def reamostrar_sincrono(x, fase, K, fator=2):
    """Reamostra x (uma amostra por elemento de `fase`) numa grade uniforme de K pontos por ciclo (2π de fase).
    Interpolação cúbica (B-spline) sobre o sinal superamostrado `fator`×: erro < −50 dB até 12 kHz. Para não haver
    aliasing K deve ser ≥ fs / f0 mínimo (use `k_para`). Devolve (y, n_ciclos)."""
    c0 = np.ceil(fase[0] / (2 * np.pi) + 1e-9)
    c1 = np.floor(fase[-1] / (2 * np.pi) - 1e-9)
    nc = int(c1 - c0)
    if nc < 1:
        return np.zeros(0), 0
    grade = (c0 + np.arange(nc * K) / K) * 2 * np.pi
    t = np.interp(grade, fase, np.arange(len(fase), dtype=float))
    if fator > 1:
        xu = signal.resample_poly(x, fator, 1)
        y = ndimage.map_coordinates(xu, [t * fator], order=3, mode='nearest')
    else:
        y = ndimage.map_coordinates(x, [t], order=3, mode='nearest')
    return y, nc


def k_para(fase, fs=FS, fmax=None, multiplo=1):
    """Pontos por ciclo para reamostrar sem aliasing: `multiplo` × potência de 2, ≥ fs/f0mín (ou ≥ 2,6·fmax/f0mín, se
    o sinal é limitado em fmax, como uma envoltória). `multiplo` = eventos por ciclo, para o ciclo poder ser dividido
    em janelas iguais, uma por explosão."""
    df = np.diff(fase) * fs / (2 * np.pi)
    f0min = max(np.percentile(df, 1), 1e-3)
    alvo = fs / f0min if fmax is None else 2.6 * fmax / f0min
    return int(multiplo * min(pot2(alvo / multiplo), 1 << 16))


def fracao_periodica(linhas):
    """Fração periódica sem viés (REVISAO-DE-SOM): covariância entre as médias dos períodos pares e ímpares ÷
    variância total. `linhas` = matriz (períodos, pontos por período). ~0 para ruído, 1 para sinal periódico."""
    if linhas.shape[0] < 4:
        return float('nan')
    m = linhas.mean()
    v = linhas.var()
    if v <= 0:
        return float('nan')
    a1 = linhas[0::2].mean(0) - m
    a2 = linhas[1::2].mean(0) - m
    return float(np.mean(a1 * a2) / v)


def dobrar(y, P):
    n = len(y) // P
    return y[:n * P].reshape(n, P)


# ------------------------------------------------------------------------ espectro de ordens, HNR e piso
def espectro_ordens(y, K, M):
    """Welch no domínio do ângulo: segmentos de M ciclos (Hann, 50% de sobreposição). Devolve (P, L): P[b] é a
    potência no bin b (o bin b está na ordem de ciclo b/M; a soma de P é a potência do sinal) e L o nº de
    segmentos. As linhas do motor caem exatamente nos bins múltiplos de M."""
    n = M * K
    if len(y) < n:
        return None, 0
    w = signal.get_window('hann', n, fftbins=True)
    passo = n // 2
    acc = None
    L = 0
    for i in range(0, len(y) - n + 1, passo):
        S = np.abs(sfft.rfft(y[i:i + n] * w)) ** 2
        acc = S if acc is None else acc + S
        L += 1
    P = 2.0 * acc / (L * n * np.sum(w * w))
    P[0] *= 0.5
    return P, L


def _corr_mediana(L):
    """Mediana ÷ média de uma média de L periodogramas (Gama de forma L; Wilson–Hilferty)."""
    Le = max(1.0, 0.9 * L)  # (sobreposição de 50% com Hann: ~0,9 segmento independente por segmento)
    return (1.0 - 1.0 / (9.0 * Le)) ** 3


def separar_linhas(P, M, L, tol=5e-4):
    """Separa o espectro de ordens em linhas (harmônicos do ciclo) e piso entre elas.

    Janela de cada linha h: ±hw bins em volta do bin h·M, hw = 1 (lóbulo do Hann com a linha no bin) + a folga para o
    vibrato que o rastreio não tirou (`tol` relativo × h·M), limitada a M/4. O piso de cada intervalo entre duas
    linhas é a mediana dos bins fora das janelas, corrigida para a média (o estimador é robusto a tons que não são
    ordens). Devolve um dicionário com, por harmônico h = 0…H−1: `harm` (potência da linha acima do piso), `piso`
    (potência do piso por bin no intervalo [h, h+1)), `hw`, e os vetores por bin `piso_bin` e `e_linha`."""
    H = (len(P) - 1) // M
    nb = H * M
    Pm = P[:nb].reshape(H, M)
    h = np.arange(H)
    hw = np.minimum(max(1, M // 4), 1 + np.ceil(tol * h * M).astype(int))
    if M < 8:
        hw = np.minimum(hw, 1)
    c = np.arange(M)[None, :]
    hw_prox = np.r_[hw[1:], hw[-1]]
    fora = (c > hw[:, None]) & (c < M - hw_prox[:, None])
    vazio = ~fora.any(axis=1)
    if vazio.any():  # (M pequeno: fica só o bin do meio)
        fora[vazio, M // 2] = True
    Pn = np.where(fora, Pm, np.nan)
    piso = np.nanmedian(Pn, axis=1) / _corr_mediana(L)
    # piso sob a linha h: média dos intervalos vizinhos
    sob = 0.5 * (piso + np.r_[piso[0], piso[:-1]])
    # potência na janela da linha h: bins h·M−hw … h·M+hw
    harm = np.zeros(H)
    bruto = np.zeros(H)
    for d in range(-int(hw.max()), int(hw.max()) + 1):
        idx = h * M + d
        ok = (np.abs(d) <= hw) & (idx >= 0) & (idx < len(P))
        bruto[ok] += P[idx[ok]]
    liq = bruto - (2 * hw + 1) * sob   # (sem cortar em zero: a soma por banda fica sem viés quando não há linha)
    liq[0] = 0.0  # (DC)
    harm = np.maximum(liq, 0.0)
    piso_bin = np.repeat(piso, M)
    e_linha = np.zeros(nb, dtype=bool)
    for d in range(-int(hw.max()), int(hw.max()) + 1):
        idx = h * M + d
        ok = (np.abs(d) <= hw) & (idx >= 0) & (idx < nb)
        e_linha[idx[ok]] = True
    return {'H': H, 'M': M, 'L': L, 'harm': harm, 'liq': liq, 'piso': piso, 'sob': sob, 'hw': hw, 'piso_bin': piso_bin, 'e_linha': e_linha, 'P': P[:nb]}


def hnr_bandas(sep, f0, bandas=BANDAS):
    """Por banda: potência das linhas (H), do piso (N), HNR = 10·log10(H/N), planura do piso (média geométrica ÷
    aritmética dos pisos entre linhas, em dB: 0 = liso como ruído branco; negativa = piso com estrutura) e o excesso
    entre as linhas que não é piso (tons fora de ordem)."""
    H, M = sep['H'], sep['M']
    fb = np.arange(H * M) / M * f0       # frequência de cada bin
    fh = np.arange(H) * f0               # frequência de cada harmônico
    out = []
    for lo, hi in bandas:
        mb = (fb >= lo) & (fb < hi)
        mh = (fh >= lo) & (fh < hi)
        if mb.sum() < 2 or mh.sum() < 1:
            out.append({'harm': float('nan'), 'piso': float('nan'), 'hnr': float('nan'), 'planura': float('nan'), 'total': float('nan'), 'n_linhas': int(mh.sum())})
            continue
        Nb = float(sep['piso_bin'][mb].sum())
        Hb = float(max(sep['liq'][mh].sum(), 10 ** -2.5 * Nb))   # (chão de −25 dB: abaixo disso não há o que medir)
        tot = float(sep['P'][mb].sum())
        pis = sep['piso'][mh]
        pis = pis[pis > 0]
        plan = float(db10(np.exp(np.mean(np.log(pis))) / np.mean(pis))) if len(pis) >= 3 else float('nan')
        out.append({'harm': Hb, 'piso': Nb, 'hnr': float(np.clip(db10(Hb / max(Nb, EPS)), -30, 70)), 'planura': plan, 'total': tot, 'n_linhas': int(mh.sum())})
    return out


# ----------------------------------------------------------------------------------- envoltória e eventos
_REF_RUIDO = {}


def estat_envoltoria(e):
    """p90/p10 (dB), vão (p10 relativo ao RMS da envoltória, dB), crista (p99,9 ÷ RMS, dB) e desvio/média."""
    p10, p50, p90, p999 = np.percentile(e, [10, 50, 90, 99.9])
    rms = np.sqrt(np.mean(e * e))
    return {'p90_p10': float(db20(p90 / max(p10, 1e-15))), 'vao': float(db20(p10 / max(rms, 1e-15))),
            'crista': float(db20(p999 / max(rms, 1e-15))), 'desvio_media': float(e.std() / max(e.mean(), 1e-15))}


def ref_ruido(lo, hi, fc, fs=FS):
    """As mesmas estatísticas para ruído gaussiano estacionário passado pela mesma cadeia (banda e passa-baixa):
    é a régua do "liso". Depende da banda e do corte; calcular sempre (REVISAO-DE-SOM)."""
    ch = (lo, hi, round(fc, 1), fs)
    if ch not in _REF_RUIDO:
        rng = np.random.default_rng(20261118)
        w = rng.standard_normal(12 * fs)
        _, e = envoltoria(w, lo, hi, fs, fc)
        _REF_RUIDO[ch] = estat_envoltoria(e[fs:-fs])
    return _REF_RUIDO[ch]


def modulacao_angular(e_ang, K, ordens):
    """Profundidade de modulação da envoltória em ordens do ciclo, pela série de Fourier da envoltória dobrada no
    ciclo (imune a vibrato): m_k = 2|c_k|/c_0 (0 = lisa; 1 = some entre os pulsos de uma senoide; pode passar de 1).
    Também a fração periódica dobrando em 1 ciclo e em 1/ordem de ciclo."""
    linhas = dobrar(e_ang, K)
    if linhas.shape[0] < 4:
        return {}
    med = linhas.mean(0)
    c = sfft.rfft(med) / K
    c0 = max(abs(c[0]), 1e-15)
    out = {'frac_ciclo': fracao_periodica(linhas)}
    for nome, k in ordens.items():
        k = int(round(k))
        out['m_' + nome] = float(2 * abs(c[k]) / c0) if 0 < k < len(c) else float('nan')
        if k > 1 and K % k == 0:
            out['frac_' + nome] = fracao_periodica(dobrar(e_ang, K // k))
    # profundidade total presa ao ciclo: desvio/média do ciclo médio
    out['m_total_ciclo'] = float(med.std() / max(med.mean(), 1e-15))
    return out


def espectro_modulacao(e, fs=FS, res=0.5, fmax=200.0):
    """Espectro de modulação da envoltória (no tempo): amplitude de cada componente relativa à média (índice de
    modulação por linha, com `res` Hz de resolução). Devolve (f, m)."""
    q = max(1, int(fs // 2000))
    ed = signal.resample_poly(e, 1, q) if q > 1 else e
    fsd = fs / q
    n = int(min(len(ed), round(fsd / res)))
    med = max(ed.mean(), 1e-15)
    f, P = signal.welch(ed / med - 1.0, fsd, nperseg=n, noverlap=n // 2, window='hann', scaling='spectrum')
    ok = (f >= res) & (f <= fmax)
    return f[ok], np.sqrt(2.0 * P[ok])


def picos_por_segundo(e, fs=FS, limiar_db=10.0, jan=0.3, sep=0.015):
    """Estalos: picos da envoltória mais de `limiar_db` acima da mediana corrida de `jan` s (o detector de
    tools/radial-estouros.ts), separados por pelo menos `sep` s."""
    q = max(1, int(fs // 4000))
    ed = e[::q]
    fsd = fs / q
    k = int(jan * fsd) | 1
    # mediana corrida barata: em blocos de jan/4, interpolada
    b = max(1, k // 4)
    nb = len(ed) // b
    if nb < 4:
        return 0.0
    blocos = ed[:nb * b].reshape(nb, b)
    medb = np.median(blocos, axis=1)
    medb = ndimage.median_filter(medb, size=5, mode='nearest')
    med = np.interp(np.arange(len(ed)), (np.arange(nb) + 0.5) * b, medb)
    lim = med * 10 ** (limiar_db / 20)
    pk, _ = signal.find_peaks(ed, distance=max(1, int(sep * fsd)))
    return float(np.sum(ed[pk] > lim[pk]) / (len(ed) / fsd))


def curtose(y, bloco=None, fs=FS):
    """Curtose (gaussiana = 3). Com `bloco` (s) devolve a mediana por blocos (robusta a um estouro isolado)."""
    if bloco:
        n = int(bloco * fs)
        m = len(y) // n
        if m < 1:
            return float('nan')
        Y = y[:m * n].reshape(m, n)
        Y = Y - Y.mean(1, keepdims=True)
        return float(np.median((Y ** 4).mean(1) / np.maximum((Y ** 2).mean(1) ** 2, EPS)))
    y = y - y.mean()
    return float((y ** 4).mean() / max((y ** 2).mean() ** 2, EPS))


def variacao_eventos(v_ang, K, ev):
    """Irregularidade ciclo a ciclo: `v_ang` é uma potência instantânea (sinal² ou envoltória²) reamostrada com K
    pontos por ciclo. Divide cada ciclo em `ev` janelas (uma por explosão) e devolve o CV da energia por evento
    (todos), o CV do mesmo evento de ciclo para ciclo, e a desigualdade fixa entre os eventos do ciclo."""
    if ev < 1 or K % ev:
        return {}
    linhas = dobrar(v_ang, K)
    if linhas.shape[0] < 4:
        return {}
    E = linhas.reshape(linhas.shape[0], ev, K // ev).mean(2)   # (ciclos, eventos)
    r = np.sqrt(np.maximum(E, 0))                               # amplitude RMS por evento
    tot = r.std() / max(r.mean(), 1e-15)
    mesmo = float(np.mean(r.std(0) / np.maximum(r.mean(0), 1e-15)))
    desig = float(r.mean(0).std() / max(r.mean(), 1e-15))
    return {'cv_evento': float(tot), 'cv_ciclo': mesmo, 'desigualdade': desig}


# ---------------------------------------------------------------------------------- tons que não são ordens
def tons_fora_de_ordem(x, fase, f0, fs=FS, sep=None, fmin=150.0, fmax=12000.0, limiar=10.0, tol_ordem=None):
    """Procura tons estreitos que não são ordens do motor ("apitos"), em dois domínios:
      · em Hz (Welch de 1 Hz): tons parados na frequência (ressonância batida, eletrônica, rede);
      · em ordens (espectro síncrono): tons presos ao giro com razão não inteira (compressor, turbo, engrenagem).
    Cada um sai com frequência, ordem de ciclo, proeminência sobre o piso local (dB), nível relativo ao total da
    oitava em volta, estabilidade (desvio da frequência entre janelas de 1 s, %) e presença (fração das janelas).
    Um tom que cai em cima de uma ordem inteira (±1,5 Hz) não é separável: aparece como uma linha de ordem forte."""
    achados = []
    df = np.diff(fase) * fs / (2 * np.pi)
    esp = float((np.percentile(df, 95) - np.percentile(df, 5)) / max(np.median(df), 1e-9))  # espalhamento relativo do giro
    # ---- (a) em Hz
    n = min(len(x), fs)
    f, P = signal.welch(x, fs, nperseg=n, noverlap=n // 2, window='hann')
    Ld = db10(P)
    # piso local: mediana em janela de ~1/6 de oitava (em bins: cresce com f) aproximada por dois filtros
    med = ndimage.percentile_filter(Ld, 40, size=max(31, int(60 * n / fs)) | 1, mode='nearest')
    pro = Ld - med
    m = (f >= fmin) & (f <= fmax)
    pk, pr = signal.find_peaks(np.where(m, pro, -99), height=limiar, prominence=limiar * 0.6, width=(None, max(3, int(8 * n / fs))))
    for i in pk:
        fi = float(f[i])
        ordc = fi / f0
        dist_hz = abs(ordc - round(ordc)) * f0
        if dist_hz <= max(1.5, 0.6 * esp * fi):   # é uma ordem (com o borrão do vibrato)
            continue
        achados.append({'f': fi, 'ordem_ciclo': float(ordc), 'proeminencia': float(pro[i]), 'tipo': 'parado em Hz'})
    # ---- (b) em ordens: picos entre as linhas no espectro síncrono
    if sep is not None and esp > 0.004:   # (com o giro parado os dois domínios dizem a mesma coisa)
        M = sep['M']
        P2 = sep['P']
        nb = len(P2)
        exc = db10(P2 / np.maximum(sep['piso_bin'], EPS))
        exc[sep['e_linha']] = -99
        fb = np.arange(nb) / M * f0
        mm = (fb >= fmin) & (fb <= fmax)
        pk2, _ = signal.find_peaks(np.where(mm, exc, -99), height=limiar)
        for i in pk2:
            fi = float(fb[i])
            if any(abs(a['f'] - fi) < 0.02 * fi for a in achados):
                continue
            achados.append({'f': fi, 'ordem_ciclo': float(i / M), 'proeminencia': float(exc[i]), 'tipo': 'preso ao giro'})
    if not achados:
        return []
    # ---- estabilidade e presença: espectros de 1 s (Hz) ao longo do trecho
    nf = min(len(x), fs)
    passo = nf // 2
    w = signal.get_window('hann', nf)
    quadros = []
    for i in range(0, len(x) - nf + 1, passo):
        S = np.abs(sfft.rfft(x[i:i + nf] * w)) ** 2
        quadros.append(S)
    quadros = np.array(quadros) if quadros else np.zeros((0, nf // 2 + 1))
    fq = sfft.rfftfreq(nf, 1 / fs)
    f0q = np.array([np.median(df[i:i + nf]) for i in range(0, len(x) - nf + 1, passo)]) if len(quadros) else np.zeros(0)
    cs, pot3 = tercos(x, fs, 100, 12000, fracao=1)
    for a in achados:
        fs_, pres = [], 0
        for q, S in enumerate(quadros):
            alvo = a['f'] if a['tipo'] == 'parado em Hz' else a['ordem_ciclo'] * f0q[q]
            j0 = int(np.searchsorted(fq, alvo * 0.985)); j1 = int(np.searchsorted(fq, alvo * 1.015)) + 1
            if j1 - j0 < 3:
                j0 = max(0, j0 - 2); j1 = j1 + 2
            seg = S[j0:j1]
            j = j0 + int(np.argmax(seg))
            viz = S[max(0, j0 - 40):j1 + 40]
            if S[j] > 10 ** (0.6) * np.median(viz):   # ≥ 6 dB sobre a mediana local
                pres += 1
                fs_.append(fq[j] / (1.0 if a['tipo'] == 'parado em Hz' else f0q[q] / f0))
        a['presenca'] = float(pres / max(1, len(quadros)))
        a['estabilidade_pct'] = float(100 * np.std(fs_) / a['f']) if len(fs_) >= 3 else float('nan')
        io = int(np.argmin(np.abs(np.log(cs / a['f']))))
        # nível do tom relativo à oitava em volta (potência do pico ±2 bins ÷ potência da oitava)
        j = int(np.argmin(np.abs(f - a['f'])))
        a['nivel_rel_oitava'] = float(db10(P[max(0, j - 2):j + 3].sum() * (f[1] - f[0]) / max(pot3[io], EPS)))
    achados = [a for a in achados if a['presenca'] >= 0.5]
    achados.sort(key=lambda a: -a['proeminencia'])
    return achados[:12]


# ------------------------------------------------------------------------------------------ análise completa
def analisar(x, fase, ev=None, voltas=2, fs=FS, bandas=BANDAS, tol=5e-4, detalhe=True):
    """Todas as medidas de um sinal com a fase do ciclo conhecida. `ev` = eventos por ciclo (None: estima pela ordem
    que mais modula a envoltória de 400–6000 Hz). Devolve um dicionário (serializável em JSON, fora as chaves que
    começam com '_', que guardam vetores para o painel)."""
    n = min(len(x), len(fase))
    x = x[:n]; fase = fase[:n]
    df = np.diff(fase) * fs / (2 * np.pi)
    f0 = float(np.median(df))
    r = {'f0': f0, 'f0_p5': float(np.percentile(df, 5)), 'f0_p95': float(np.percentile(df, 95)), 'duracao': n / fs,
         'ciclos': float((fase[-1] - fase[0]) / (2 * np.pi)), 'voltas_por_ciclo': voltas, 'rpm': f0 * 60 * voltas}
    # ---- espectro de ordens, HNR e piso
    K = k_para(fase, fs)
    y, nc = reamostrar_sincrono(x, fase, K)
    M = 16 if nc >= 48 else 8 if nc >= 20 else 4
    P, L = espectro_ordens(y, K, M)
    if P is None:
        raise ValueError(f'trecho curto demais: {nc} ciclos (mínimo {M})')
    sep = separar_linhas(P, M, L, tol)
    hb = hnr_bandas(sep, f0, bandas)
    r['K'] = K; r['M'] = M; r['segmentos'] = L
    # ---- eventos por ciclo
    ev_estimado = False
    if not ev:
        _, e_larga = envoltoria(x, 400, 6000, fs, 400)
        Ke = k_para(fase, fs, 400)
        ea, _ = reamostrar_sincrono(e_larga, fase, Ke, fator=1)
        med = dobrar(ea, Ke).mean(0)
        c = np.abs(sfft.rfft(med))[1:25]
        ev = int(np.argmax(c)) + 1
        ev_estimado = True
    r['ev'] = int(ev); r['ev_estimado'] = ev_estimado
    f_ign = ev * f0
    r['f_ign'] = f_ign; r['f_rot'] = voltas * f0
    # ---- níveis por banda (Welch no tempo) e inclinação
    Eb = energia_bandas(x, fs, bandas)
    ref = max(Eb[IDX_REF], EPS)
    r['inclinacao_db_oitava'] = inclinacao_espectral(x, fs)
    r['inclinacao_piso_db_oitava'] = _inclinacao_piso(sep, f0)
    fA, PA = psd_welch(x, fs)
    r['nivel_A_rel_total'] = float(db10((PA * ponderacao_a(fA)).sum() / max(PA.sum(), EPS)))
    r['nivel_total_db'] = float(db10(np.mean(x * x)))
    # ---- por banda
    ordens = {'ciclo': 1, 'rot': voltas, 'ign': ev}
    r['bandas'] = []
    vet = {}
    for i, (lo, hi) in enumerate(bandas):
        b = {'banda': NOMES[i] if bandas is BANDAS else f'{lo}-{hi}', 'lo': lo, 'hi': hi}
        b['nivel_db'] = float(db10(Eb[i]))                             # potência da banda (dB re fundo de escala)
        b['nivel_rel'] = float(db10(Eb[i] / ref))                      # potência da banda ÷ potência de 150–400
        h = hb[i]
        b['hnr'] = h['hnr']
        b['harm_db'] = float(db10(h['harm'])) if np.isfinite(h['harm']) else float('nan')   # potência das linhas
        b['piso_db'] = float(db10(h['piso'])) if np.isfinite(h['piso']) else float('nan')   # potência do piso
        b['planura_piso'] = h['planura']
        b['n_linhas'] = h['n_linhas']
        # envoltória "do motor" e rápida
        fc = fc_envoltoria(lo, hi, f_ign)
        yb, e = envoltoria(x, lo, hi, fs, fc)
        b['fc_env'] = float(fc)
        b['env_valida'] = bool(lo >= 2.0 * f_ign and lo >= 400)        # a banda tem de caber vários harmônicos do pulso
        b.update(estat_envoltoria(e))
        rr = ref_ruido(lo, hi, fc, fs)
        b['ref_ruido'] = {k: round(v, 3) for k, v in rr.items()}
        Ke = k_para(fase, fs, fc, ev)
        ea, _ = reamostrar_sincrono(e, fase, Ke, fator=1)
        b.update(modulacao_angular(ea, Ke, ordens))
        fm, mm = espectro_modulacao(e, fs)
        j = int(np.argmax(mm)) if len(mm) else 0
        b['mod_dominante_hz'] = float(fm[j]) if len(mm) else float('nan')
        b['mod_dominante_m'] = float(mm[j]) if len(mm) else float('nan')
        # eventos
        fcr = fc_envoltoria(lo, hi, rapida=True)
        er = passa_baixa(hilbert_abs(yb), fcr, fs)
        b['curtose'] = curtose(yb)
        b['curtose_mediana'] = curtose(yb, 0.5, fs)
        b['picos_s'] = picos_por_segundo(np.maximum(er, 0), fs)
        va, _ = reamostrar_sincrono(e * e, fase, Ke, fator=1)
        b.update(variacao_eventos(va, Ke, ev))
        r['bandas'].append(b)
        if detalhe:
            vet[i] = {'fm': fm, 'mm': mm}
    # ---- faixa 1–6 kHz (a do "vão" do painel) e grave
    fc16 = fc_envoltoria(1000, 6000, f_ign)
    y16, e16 = envoltoria(x, 1000, 6000, fs, fc16)
    g = estat_envoltoria(e16)
    g['ref_ruido'] = {k: round(v, 3) for k, v in ref_ruido(1000, 6000, fc16, fs).items()}
    K16 = k_para(fase, fs, max(fc16, 400.0), ev)
    e16a, _ = reamostrar_sincrono(e16, fase, K16, fator=1)
    g.update(modulacao_angular(e16a, K16, ordens))
    er16 = np.maximum(passa_baixa(hilbert_abs(y16), 400, fs), 0)
    g['picos_s'] = picos_por_segundo(er16, fs)
    g['picos_irregulares_s'] = _picos_irregulares(er16, fase, fs)
    g['curtose'] = curtose(y16); g['curtose_mediana'] = curtose(y16, 0.5, fs)
    va, _ = reamostrar_sincrono(e16 * e16, fase, K16, fator=1)
    g.update(variacao_eventos(va, K16, ev))
    r['faixa_1_6k'] = g
    lo_g, hi_g = 30.0, float(max(400.0, min(4 * f_ign, 0.4 * fs)))
    yg = passa_faixa(x, lo_g, hi_g, fs)
    Kg = k_para(fase, fs, hi_g, ev)
    ga, _ = reamostrar_sincrono(yg * yg, fase, Kg, fator=1)
    r['grave'] = {'lo': lo_g, 'hi': hi_g, **variacao_eventos(ga, Kg, ev)}
    gl = dobrar(reamostrar_sincrono(yg, fase, Kg, fator=1)[0], Kg)
    r['grave']['frac_ciclo'] = fracao_periodica(gl)
    # ---- perfil das linhas (ordens baixas) e tons fora de ordem
    nh = int(min(sep['H'] - 1, max(4 * ev, 48)))
    hh = sep['harm'][1:nh + 1]
    r['linhas_db'] = [round(float(v), 2) for v in db10(hh / max(hh.sum(), EPS))]
    r['fracao_harmonica'] = float(sep['harm'].sum() / max(sep['P'].sum(), EPS))
    r['tons'] = tons_fora_de_ordem(x, fase, f0, fs, sep)
    if detalhe:
        r['_sep'] = sep; r['_y_ang'] = y; r['_K'] = K; r['_e16_ang'] = e16a; r['_K16'] = K16; r['_mod'] = vet
        r['_e16'] = e16; r['_Eb'] = Eb
    return r


def _inclinacao_piso(sep, f0, f_lo=150.0, f_hi=6000.0):
    """Inclinação (dB/oitava) do piso entre linhas (densidade por Hz)."""
    fh = (np.arange(sep['H']) + 0.5) * f0
    ok = (fh >= f_lo) & (fh <= f_hi) & (sep['piso'] > 0)
    if ok.sum() < 6:
        return float('nan')
    a, _ = np.polyfit(np.log2(fh[ok]), db10(sep['piso'][ok]), 1)
    return float(a)


def _picos_irregulares(e, fase, fs=FS, limiar_db=10.0, sep=0.015):
    """Estalos fora do padrão: picos da envoltória rápida mais de `limiar_db` acima do ciclo médio naquele ângulo
    (e da mediana geral). Os pulsos regulares de cada explosão, por mais secos que sejam, não contam."""
    K = k_para(fase, fs, 400)
    ea, nc = reamostrar_sincrono(e, fase, K, fator=1)
    if nc < 6:
        return float('nan')
    L = dobrar(ea, K)
    med = np.median(L, axis=0)
    base = np.maximum(med, np.median(ea))[None, :] * 10 ** (limiar_db / 20)
    acima = (L > base).reshape(-1)
    # conta rajadas (subidas), separadas por `sep`
    f0 = (fase[-1] - fase[0]) / (2 * np.pi) / (len(fase) / fs)
    dist = max(1, int(sep * f0 * K))
    sub = np.flatnonzero(acima[1:] & ~acima[:-1])
    if len(sub) == 0:
        return 0.0
    cont = 1 + int(np.sum(np.diff(sub) > dist))
    return float(cont / (len(ea) / (f0 * K)))


def limpar(r):
    """Tira os vetores (chaves com '_') e troca NaN por None, para gravar em JSON."""
    if isinstance(r, dict):
        return {k: limpar(v) for k, v in r.items() if not str(k).startswith('_')}
    if isinstance(r, (list, tuple)):
        return [limpar(v) for v in r]
    if isinstance(r, (np.floating, float)):
        v = float(r)
        return None if not np.isfinite(v) else round(v, 4)
    if isinstance(r, (np.integer,)):
        return int(r)
    if isinstance(r, (np.bool_,)):
        return bool(r)
    if isinstance(r, np.ndarray):
        return limpar(r.tolist())
    return r
