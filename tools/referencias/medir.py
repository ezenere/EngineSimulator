#!/usr/bin/env python3
"""Mede as gravações de referência e gera `referencias/index.json` e `referencias/INDEX.md`.

Uso (sempre com -I; este script fica longe da pasta dos dados):

  python3 -I tools/referencias/medir.py                      # mede tudo o que está na lista e no disco
  python3 -I tools/referencias/medir.py --familia vapor
  python3 -I tools/referencias/medir.py --arquivo X.wav [--trecho 10 22] [--ign-por-volta 2 --faixa-rpm 500 1200]
  python3 -I tools/referencias/medir.py --linha-do-tempo X.wav [--janela 4]
  python3 -I tools/referencias/medir.py --sugerir X.wav       # trechos estáveis candidatos
  python3 -I tools/referencias/medir.py --espectrograma X.wav --png saida.png [--trecho a b]

O que se mede (critério de entrada no acervo):
  bandaHz        onde o espectro despenca: primeira frequência em que a média do último 1 kHz fica
                 >= 20 dB acima do percentil 90 do que vem depois (falésia de passa-baixa ou do
                 codec); sem falésia, onde o agudo some no piso. Vale a banda dos TRECHOS anotados, a
                 melhor entre eles (um vídeo pode ter música de banda cheia na abertura e o motor
                 cortado em 6 kHz; trecho distante perde o agudo sem filtro e leva só uma ressalva).
                 `degrau` guarda a maior queda entre faixas vizinhas de 500 Hz.
  clippingPct    % de amostras empilhadas no fundo de escala do original (>= 0,99) ou no pico, o pior
                 entre cada canal do original decodificado (medido pelo baixar.py) e o WAV mono.
  grave30a100Db  energia de 30-100 Hz relativa a 150-400 Hz.
  silabica       profundidade da modulação de 2,5-7 Hz da envoltória de 300-3400 Hz (fala: >= 0,35);
                 mediana e p90 de janelas de 8 s. Motor em lenta: 0,03-0,15. Vapor lento engana.
  desvioGraveDb  desvio padrão do nível de 20-150 Hz em janelas de 0,1 s, descontada a tendência de 2 s
                 (vento batendo no microfone: > 6 dB).

Por trecho: nível, bandas em dB relativas a 150-400 Hz, centroide de 100 Hz a 8 kHz, p90/p10 da
envoltória de 1-4 kHz e o ritmo: linhas estreitas mais fortes, pente harmônico, taxa de repetição da
envoltória e o teste da dobra (fase da linha mais forte dividida por N; ver REVISAO-DE-SOM.md,
Armadilhas). A rotação anotada à mão na lista vale; a automática fica ao lado para conferência.
"""
from __future__ import annotations

import argparse
import datetime
import json
import math
import os
import sys
import wave

import numpy as np
from scipy import signal

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
sys.dont_write_bytecode = True   # nada de __pycache__ dentro do repositório
import baixar  # noqa: E402  (mesma pasta do repositório; nunca a pasta dos dados)

FS = 48000
BANDAS = [('20-60', 20, 60), ('30-100', 30, 100), ('60-150', 60, 150), ('150-400', 150, 400), ('400-1k', 400, 1000),
          ('1-2.5k', 1000, 2500), ('2.5-6k', 2500, 6000), ('6-12k', 6000, 12000), ('12-20k', 12000, 20000)]
CRITERIOS = {
    'bandaMinHz': 15000, 'bandaMinBaixaQualidadeHz': 12000, 'clippingMaxPct': 0.1,
    'silabicaAlerta': 0.35, 'desvioGraveAlertaDb': 6.0,
    'obs': 'bandas em dB relativas a 150-400 Hz; centroide de 100 Hz a 8 kHz; Welch de 8192 pontos',
}


# ---------------------------------------------------------------------------------------------
# Leitura


def le_wav(caminho: str) -> np.ndarray:
    with wave.open(caminho, 'rb') as w:
        n, ch, sw, fs = w.getnframes(), w.getnchannels(), w.getsampwidth(), w.getframerate()
        if sw != 2 or fs != FS:
            raise ValueError(f'{caminho}: esperado PCM de 16 bits a {FS} Hz (veio {sw * 8} bits, {fs} Hz)')
        x = np.frombuffer(w.readframes(n), dtype='<i2').astype(np.float64) / 32768.0
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    return x


def db(v: float) -> float:
    return 10.0 * math.log10(max(float(v), 1e-30))


def arred(v, n=1):
    if v is None or (isinstance(v, float) and not math.isfinite(v)):
        return None
    return round(float(v), n)


# ---------------------------------------------------------------------------------------------
# Espectro


def welch(x: np.ndarray, n: int = 8192):
    n = int(min(n, max(256, 2 ** int(math.log2(max(len(x), 256))))))
    f, p = signal.welch(x, FS, nperseg=n, noverlap=n // 2, window='hann', detrend='constant')
    return f, p


def pot_banda(f, p, a, b) -> float:
    m = (f >= a) & (f < b)
    return float(np.sum(p[m]) * (f[1] - f[0])) if m.any() else 0.0


def bandas_rel(f, p) -> dict:
    ref = pot_banda(f, p, 150, 400)
    return {nome: arred(db(pot_banda(f, p, a, b)) - db(ref)) for nome, a, b in BANDAS if nome != '150-400'}


def centroide(f, p, a=100.0, b=8000.0) -> float:
    m = (f >= a) & (f <= b)
    return float(np.sum(f[m] * p[m]) / max(np.sum(p[m]), 1e-30))


def banda_util(x: np.ndarray) -> dict:
    """Onde o espectro acaba.

    falesiaHz      primeira frequência (>= 3 kHz) em que a média do último 1 kHz fica >= 20 dB acima de
                   tudo o que vem depois: passa-baixa do codec (Opus 20 kHz, AAC 15,5-16 kHz) ou de uma
                   reamostragem anterior. None = não há falésia.
    conteudoAteHz  até onde o espectro fica >= 6 dB acima do piso do arquivo (o que há acima de 21 kHz):
                   sem falésia, é aí que o agudo some no ruído, sem prova de filtro.
    bandaHz        a falésia, se houver; senão conteudoAteHz.
    degrau         maior queda entre faixas vizinhas de 500 Hz (3-21 kHz): um degrau grande abaixo da
                   falésia denuncia material de banda estreita reenviado com banda larga."""
    f, p = welch(x, 4096)
    passo = 250.0
    nb = int(24000 / passo)
    niv = np.array([db(np.mean(p[(f >= i * passo) & (f < (i + 1) * passo)])) for i in range(nb)])
    piso = float(np.median(niv[int(21000 / passo):int(23500 / passo)]))
    falesia = None
    for i in range(int(3000 / passo), nb - 2):
        abaixo = float(np.mean(niv[i - 4:i]))
        # percentil 90 do que vem depois, e não o máximo: um apito isolado acima do corte (eletrônica
        # da câmera, 9-16 kHz) não pode esconder o passa-baixa
        acima = float(np.percentile(niv[i + 1:], 90))
        # e a queda tem de ser LOCAL (dentro do 1 kHz seguinte): gravação distante perde o agudo aos
        # poucos, por absorção do ar, e não por filtro
        logo_acima = float(np.median(niv[i + 1:i + 5]))
        if abaixo - acima >= 20.0 and abaixo - logo_acima >= 20.0:
            # o percentil adianta a detecção em até ~1,5 kHz: a borda é onde está a maior queda entre
            # faixas vizinhas nos 2 kHz seguintes
            ks = range(i, min(i + 8, nb - 2))
            k = max(ks, key=lambda k: niv[k - 1] - niv[k + 1])
            falesia = k * passo
            break
    acima_do_piso = np.nonzero(niv[:int(21000 / passo)] >= piso + 6.0)[0]
    conteudo = float((acima_do_piso.max() + 1) * passo) if len(acima_do_piso) else 0.0
    melhor = (0.0, None)
    for i in range(int(3000 / passo), int(21000 / passo)):
        if np.mean(niv[i - 2:i]) < piso + 10.0:
            continue
        q = float(np.mean(niv[i - 2:i]) - np.mean(niv[i + 1:i + 3]))
        if q > melhor[0]:
            melhor = (q, i * passo)
    return {'bandaHz': falesia if falesia is not None else conteudo, 'falesiaHz': falesia, 'conteudoAteHz': conteudo,
            'degrau': {'quedaDb': arred(melhor[0]), 'hz': melhor[1]}}


def passa_faixa(x: np.ndarray, a: float, b: float, ordem: int = 4) -> np.ndarray:
    b = min(b, FS / 2 * 0.98)
    sos = signal.butter(ordem, [a, b], btype='bandpass', fs=FS, output='sos')
    return signal.sosfiltfilt(sos, x)


def envoltoria(x: np.ndarray, a: float, b: float, corte: float = 500.0, fs_env: int = 2000) -> np.ndarray:
    """|Hilbert| da banda [a, b], passa-baixa em `corte`, decimada para fs_env."""
    y = np.abs(signal.hilbert(passa_faixa(x, a, b)))
    sos = signal.butter(4, corte, btype='lowpass', fs=FS, output='sos')
    y = signal.sosfiltfilt(sos, y)
    return y[:: FS // fs_env]


# ---------------------------------------------------------------------------------------------
# Qualidade do arquivo inteiro


def clipping(x: np.ndarray) -> dict:
    """No WAV (já normalizado a -1 dBFS) só dá para ver amostras empilhadas no pico; o clipping no
    fundo de escala do original vem medido pelo baixar.py (`clippingBruto`)."""
    a = np.abs(x)
    pico = float(a.max()) if a.size else 0.0
    return {'pico': pico, 'pctPico': baixar.empilhado(a, 0.985 * pico, 3.0) if pico > 0 else 0.0}


def silabica(x: np.ndarray) -> dict:
    fs_env = 200
    env = envoltoria(x, 300, 3400, corte=40.0, fs_env=fs_env)
    jan = 8 * fs_env
    sos = signal.butter(3, [2.5, 7.0], btype='bandpass', fs=fs_env, output='sos')
    vals = []
    for i in range(0, max(1, len(env) - jan + 1), jan // 2):
        e = env[i:i + jan]
        if len(e) < jan // 2 or e.mean() <= 0:
            continue
        m = signal.sosfiltfilt(sos, e - e.mean())
        vals.append(float(np.sqrt(np.mean(m ** 2)) / e.mean()))
    if not vals:
        return {'mediana': None, 'p90': None}
    return {'mediana': arred(np.median(vals), 3), 'p90': arred(np.percentile(vals, 90), 3)}


def desvio_grave(x: np.ndarray) -> float | None:
    y = passa_faixa(x, 20, 150)
    n = FS // 10
    k = len(y) // n
    if k < 30:
        return None
    niv = 10 * np.log10(np.mean(y[:k * n].reshape(k, n) ** 2, axis=1) + 1e-14)
    tend = signal.medfilt(niv, 21)
    ativo = niv > np.percentile(niv, 20)
    return float(np.std((niv - tend)[ativo]))


def qualidade(x: np.ndarray, meta: dict | None) -> dict:
    f, p = welch(x)
    c = clipping(x)
    clip = c['pctPico']
    cb = (meta or {}).get('clippingBruto')
    if cb:
        clip = max(clip, max(cb.get('pctFS') or [0]), max(cb.get('pctPico') or [0]))
    q = {
        'duracao': arred(len(x) / FS, 1),
        'nivelDbfs': arred(db(np.mean(x ** 2))),
        'picoDbfs': arred(2 * db(c['pico'])),
        'ganhoAplicadoDb': (meta or {}).get('ganhoDb'),
        'clippingPct': arred(clip, 4),
        'picoDoOriginal': max(cb['pico']) if cb and cb.get('pico') else None,
        **banda_util(x),
        'grave30a100Db': arred(db(pot_banda(f, p, 30, 100)) - db(pot_banda(f, p, 150, 400))),
        'silabica': silabica(x),
        'desvioGraveDb': arred(desvio_grave(x)),
    }
    if meta:
        b = meta.get('bruto') or {}
        q['codecOriginal'] = ' '.join(str(s) for s in (b.get('codec'), f"{int(b['hz'])} Hz" if b.get('hz') else None,
                                                     f"{int(b['kbps'])} kbps" if b.get('kbps') else None) if s)
        q['legendasAuto'] = meta.get('legendasAuto')
        leg = meta.get('legendas') or {}
        if leg and 'palavrasPorMin' in leg:
            q['legendas'] = {'idioma': leg.get('idioma'), 'palavrasPorMin': leg.get('palavrasPorMin'),
                             'segundosMarcadosMusica': leg.get('segundosMarcadosMusica'),
                             'trechos': leg.get('trechos')}
        q['musicaDeclarada'] = meta.get('musicaDeclarada')
    return q


# ---------------------------------------------------------------------------------------------
# Ritmo


def espectro_branqueado(x: np.ndarray, n: int = 32768):
    """Welch longo em dB menos a mediana local (±40 Hz): sobram as linhas."""
    f, p = welch(x, n)
    d = 10 * np.log10(p + 1e-30)
    larg = max(5, int(round(80.0 / (f[1] - f[0]))) | 1)
    return f, d - signal.medfilt(d, larg)


def linhas_fortes(f, w, fmin=15.0, fmax=1000.0, k=8) -> list:
    m = (f >= fmin) & (f <= fmax)
    idx, prop = signal.find_peaks(w[m], height=6.0, distance=max(2, int(2.5 / (f[1] - f[0]))))
    ff, hh = f[m][idx], prop['peak_heights']
    ordem = np.argsort(-hh)[:k]
    return [[arred(ff[i], 1), arred(hh[i], 1)] for i in sorted(ordem, key=lambda i: ff[i])]


def pente(f, w, fmin: float, fmax: float, teto: float = 900.0) -> list:
    """Pente harmônico: média do espectro branqueado (dB, cortado em 0) nos dentes k·f0 <= teto.
    Devolve até 3 candidatos; o primeiro é o MENOR f0 com nota >= 85 % da melhor (ver Armadilhas)."""
    df = f[1] - f[0]
    wc = np.clip(w, 0, 30)
    cands = np.arange(fmin, fmax, max(df / 4, fmin * 0.002))
    notas = np.zeros(len(cands))
    for j, f0 in enumerate(cands):
        nd = int(min(24, teto // f0))
        if nd < 3:
            continue
        soma = 0.0
        for k in range(1, nd + 1):
            c = k * f0
            i0, i1 = int((c * 0.99) / df), int((c * 1.01) / df) + 2
            soma += wc[i0:i1].max()
        notas[j] = soma / nd
    if notas.max() <= 0:
        return []
    idx, _ = signal.find_peaks(notas, distance=max(1, int(0.03 * len(cands))))
    if len(idx) == 0:
        idx = np.array([int(np.argmax(notas))])
    melhor = notas[idx].max()
    bons = [i for i in idx if notas[i] >= 0.85 * melhor]
    prim = min(bons, key=lambda i: cands[i])
    resto = sorted((i for i in idx if i != prim), key=lambda i: -notas[i])[:2]
    return [[arred(cands[i], 2), arred(notas[i], 1)] for i in [prim, *resto]]


def taxa_envoltoria(x: np.ndarray, a: float, b: float, fmin: float, fmax: float, k: int = 3) -> list:
    """Picos do espectro da envoltória [f, proeminência dB sobre a mediana, autocorrelação em 1/f]."""
    fs_env = 2000 if fmax > 60 else 400
    env = envoltoria(x, a, b, corte=min(500.0, fs_env * 0.4), fs_env=fs_env)
    env = env - env.mean()
    if len(env) < fs_env:
        return []
    n = int(min(len(env), fs_env * 8))
    fe, pe = signal.welch(env, fs_env, nperseg=n, noverlap=n // 2)
    m = (fe >= fmin) & (fe <= fmax)
    if m.sum() < 5:
        return []
    d = 10 * np.log10(pe[m] + 1e-30)
    med = np.median(d)
    idx, prop = signal.find_peaks(d, height=med + 6.0)
    if len(idx) == 0:
        return []
    ac = signal.correlate(env, env, mode='full', method='fft')[len(env) - 1:]
    ac = ac / max(ac[0], 1e-30)
    saida = []
    for i in sorted(idx, key=lambda i: -d[i])[:k]:
        fr = fe[m][i]
        atraso = int(round(fs_env / fr))
        saida.append([arred(fr, 2), arred(d[i] - med, 1), arred(ac[atraso], 2) if atraso < len(ac) else None])
    return saida


def dobra(x: np.ndarray, f_linha: float, nmax: int = 32) -> dict | None:
    """Teste da dobra: a fase da linha mais forte, dividida por N, define o ângulo de um período N vezes
    maior. Em cada N mede-se a fração periódica do grave (covariância entre a média dos períodos pares
    e a dos ímpares sobre a variância). O N do ciclo verdadeiro (e seus múltiplos) salta."""
    if f_linha is None or f_linha < 8 or len(x) < 3 * FS:
        return None
    ds = 8
    y = signal.decimate(x, ds, ftype='fir', zero_phase=True)
    fs = FS / ds
    alto = min(max(6 * f_linha, 400.0), fs * 0.45)
    sos = signal.butter(4, [max(10.0, f_linha / 40), alto], btype='bandpass', fs=fs, output='sos')
    g = signal.sosfiltfilt(sos, y)
    sosl = signal.butter(3, [f_linha * 0.92, f_linha * 1.08], btype='bandpass', fs=fs, output='sos')
    fase = np.unwrap(np.angle(signal.hilbert(signal.sosfiltfilt(sosl, y))))
    if fase[-1] - fase[0] < 2 * np.pi * 40:
        return None
    res = {}
    pontos = 96
    for n in range(1, nmax + 1):
        ang = fase / (2 * np.pi * n)
        nper = int(math.floor(ang[-1] - ang[0]))
        if nper < 8:
            break
        grade = ang[0] + np.arange(nper * pontos) / pontos
        gi = np.interp(grade, ang, g).reshape(nper, pontos)
        par, imp = gi[0::2].mean(axis=0), gi[1::2].mean(axis=0)
        par, imp = par - par.mean(), imp - imp.mean()
        var = float(np.mean((gi - gi.mean()) ** 2)) + 1e-30
        res[n] = float(np.mean(par * imp) / var)
    if not res:
        return None
    topo = max(res.values())
    if topo < 0.15:
        return {'linhaHz': arred(f_linha, 2), 'N': None, 'fracao': arred(topo, 2)}
    n_ok = min(n for n, v in res.items() if v >= 0.85 * topo)
    return {'linhaHz': arred(f_linha, 2), 'N': n_ok, 'fracao': arred(res[n_ok], 2),
            'fCicloHz': arred(f_linha / n_ok, 3), 'fracaoN1': arred(res.get(1, 0.0), 2)}


def largura_da_passagem(x: np.ndarray) -> dict:
    """Passagem (trem, avião, carro): instante do pico e larguras a -6 e -10 dB do nível de 300-6000 Hz
    (RMS de 0,1 s). Com o comprimento do trem, a largura a -6 dB dá a velocidade só em ordem de grandeza
    (o ouvinte perto vê o corpo inteiro; longe, a largura cresce com a distância)."""
    y = passa_faixa(x, 300, 6000)
    n = FS // 10
    k = len(y) // n
    if k < 5:
        return {}
    niv = 10 * np.log10(np.mean(y[:k * n].reshape(k, n) ** 2, axis=1) + 1e-14)
    niv = np.convolve(niv, np.ones(3) / 3, mode='same')
    i = int(np.argmax(niv))

    def larg(q):
        a = i
        while a > 0 and niv[a - 1] >= niv[i] - q:
            a -= 1
        b = i
        while b < k - 1 and niv[b + 1] >= niv[i] - q:
            b += 1
        return round((b - a + 1) * 0.1, 1)
    return {'picoEmS': round(i * 0.1, 1), 'larguraMenos6dBS': larg(6.0), 'larguraMenos10dBS': larg(10.0),
            'subidaDb': arred(niv[i] - np.percentile(niv, 10))}


def ritmo(x: np.ndarray, tipo: str, ipv: float | None, vpc: float, faixa_rpm) -> dict:
    """tipo: motor | chuff | rotor | tonal | passagem."""
    r: dict = {}
    f, w = espectro_branqueado(x)
    if tipo == 'chuff':
        r['envoltoria'] = taxa_envoltoria(x, 300, 6000, 0.6, 40.0)
        r['linhas'] = linhas_fortes(f, w, 80, 4000, 6)   # apito, sino, bomba
        return r
    if tipo in ('tonal', 'passagem'):
        r['linhas'] = linhas_fortes(f, w, 30, 12000, 10)
        if tipo == 'passagem':
            r['envoltoria'] = taxa_envoltoria(x, 300, 6000, 1.0, 60.0)
            r['passagem'] = largura_da_passagem(x)
        return r
    if tipo == 'rotor':
        r['linhas'] = linhas_fortes(f, w, 8, 400, 8)
        r['pente'] = pente(f, w, 6.0, 60.0, teto=300.0)
        r['envoltoria'] = taxa_envoltoria(x, 200, 4000, 4.0, 80.0)
        return r
    r['linhas'] = linhas_fortes(f, w)
    if ipv and faixa_rpm:
        # com a faixa plausível de rotação: pente só das harmônicas da ignição dentro dela
        ig_lo, ig_hi = faixa_rpm[0] / 60.0 * ipv, faixa_rpm[1] / 60.0 * ipv
        r['pente'] = pente(f, w, ig_lo, ig_hi)
        r['envoltoria'] = taxa_envoltoria(x, 1000, 4000, max(2.0, ig_lo / (ipv * vpc) * 0.9), min(400.0, ig_hi * 2.2))
    else:
        r['pente'] = pente(f, w, 4.0, 420.0)
        r['envoltoria'] = taxa_envoltoria(x, 1000, 4000, 3.0, 400.0)
    m = (f >= 15.0) & (f <= 600.0)
    if m.any():
        r['dobra'] = dobra(x, float(f[m][int(np.argmax(w[m]))]))
    if ipv and faixa_rpm:
        r['auto'] = rpm_auto(r, ipv, vpc, faixa_rpm)
    return r


def rpm_auto(r: dict, ipv: float, vpc: float, faixa) -> dict | None:
    """Rotação automática dentro da faixa plausível dada à mão: parte do pente das harmônicas da
    ignição e procura apoio independente na taxa de repetição da envoltória de 1-4 kHz, no teste da
    dobra (ciclo) e numa linha estreita na própria ignição. A faixa é que protege do erro de oitava:
    se ela cobrir mais de 2:1, a confiança cai um degrau."""
    ig_lo, ig_hi = faixa[0] / 60.0 * ipv, faixa[1] / 60.0 * ipv
    cands = []   # (f_ign, origem, peso)
    for f0, nota in r.get('pente') or []:
        if nota >= 2.0:
            cands.append((f0, 'pente', nota / 8.0))
    for fe, prom, ac in r.get('envoltoria') or []:
        if ig_lo <= fe <= ig_hi and prom >= 10.0 and (ac or 0.0) >= 0.15:
            cands.append((fe, 'envoltória', prom / 20.0 + ac))
    for fl, prom in r.get('linhas') or []:
        if ig_lo <= fl <= ig_hi and prom >= 8.0:
            cands.append((fl, 'linha', prom / 25.0))
    d = r.get('dobra')
    if d and d.get('N'):
        # o período achado pode ser o ciclo, a volta ou a própria ignição (cilindros iguais)
        for m in {ipv * vpc, ipv, 1.0}:
            fd = d['fCicloHz'] * m
            if ig_lo <= fd <= ig_hi:
                cands.append((fd, 'dobra', d['fracao']))
    if not cands:
        return None
    melhor = None
    for fi, _, _ in cands:
        perto = [(fj, o, p) for fj, o, p in cands if abs(fj - fi) / fi < 0.035]
        pesos = {}
        for fj, o, p in perto:
            pesos[o] = max(pesos.get(o, 0.0), p)
        nota = sum(pesos.values())
        if melhor is None or nota > melhor[0]:
            fino = [fj for fj, o, _ in perto if o in ('envoltória', 'linha')] or [fj for fj, _, _ in perto]
            melhor = (nota, float(np.mean(fino)), pesos)
    nota, fi, pesos = melhor
    fortes = [o for o in ('pente', 'envoltória', 'dobra') if o in pesos]
    if len(fortes) >= 2:
        conf = 'alta'
    elif len(pesos) >= 2 or pesos.get('pente', 0) >= 0.75 or pesos.get('envoltória', 0) >= 1.05:
        conf = 'média'
    else:
        conf = 'baixa'
    if faixa[1] / faixa[0] > 2.0 and conf != 'baixa':
        conf = 'média' if conf == 'alta' else 'baixa'
    return {'ignHz': arred(fi, 1), 'rpm': int(round(fi / ipv * 60.0)), 'apoio': sorted(pesos), 'confianca': conf}


# ---------------------------------------------------------------------------------------------
# Trecho


def mede_trecho(x: np.ndarray, tipo: str = 'motor', ipv=None, vpc: float = 2.0, faixa_rpm=None) -> dict:
    f, p = welch(x)
    env = envoltoria(x, 1000, 4000)
    p10, p90 = np.percentile(env, [10, 90])
    m = {
        'nivelDbfs': arred(db(np.mean(x ** 2))),
        'bandas': bandas_rel(f, p),
        'centroideHz': int(round(centroide(f, p))),
        'p90p10Db1a4k': arred(20 * math.log10(max(p90, 1e-9) / max(p10, 1e-9))),
    }
    if len(x) >= 2 * FS:
        b = banda_util(x)
        m.update(bandaHz=b['bandaHz'], falesiaHz=b['falesiaHz'], conteudoAteHz=b['conteudoAteHz'])
    if tipo == 'motor':
        ta = tom_agudo(x)
        if ta:
            m['tomAgudo'] = ta
    return {'medidas': m, 'ritmo': ritmo(x, tipo, ipv, vpc, faixa_rpm)}


def tom_agudo(x: np.ndarray, fmin: float = 2000.0, fmax: float = 19000.0) -> dict | None:
    """Tom estreito mais proeminente do agudo (apito de turbo, engrenagem, inversor), seguido a cada
    0,5 s: em que fração do trecho aparece (>= 10 dB sobre a mediana local de ±400 Hz), por onde anda
    (p10/p50/p90 da frequência), quanto sobressai e o nível dele relativo à banda das ordens do motor
    (150-400 Hz). Tom fixo de 15-17 kHz costuma ser eletrônica da câmera, não turbo."""
    n = FS
    if len(x) < 3 * n:
        return None
    fs_, proms, nivs = [], [], []
    for i in range(0, len(x) - n + 1, n // 2):
        f, p = signal.welch(x[i:i + n], FS, nperseg=4096, noverlap=2048)
        d = 10 * np.log10(p + 1e-30)
        w = d - signal.medfilt(d, 69)
        m = (f >= fmin) & (f <= fmax)
        j = int(np.argmax(w[m]))
        k = int(np.nonzero(m)[0][0]) + j
        fs_.append(float(f[k]))
        proms.append(float(w[k]))
        tom = float(np.sum(p[max(0, k - 2):k + 3]))
        nivs.append(db(tom) - db(float(np.sum(p[(f >= 150) & (f < 400)]))))
    fs_, proms, nivs = np.array(fs_), np.array(proms), np.array(nivs)
    tem = proms >= 10.0
    if tem.mean() < 0.2:
        return None
    p10, p50, p90 = np.percentile(fs_[tem], [10, 50, 90])
    return {'presencaPct': int(round(100 * tem.mean())), 'hzP10': int(p10), 'hzP50': int(p50), 'hzP90': int(p90),
            'sobreAMedianaLocalDb': arred(np.median(proms[tem])), 'nivelRelOrdensDb': arred(np.median(nivs[tem])),
            'tipo': 'tom fixo' if (p90 - p10) / p50 < 0.05 else 'tom que varre'}


def recorta(x: np.ndarray, ini: float, fim: float) -> np.ndarray:
    return x[int(max(0.0, ini) * FS): int(min(len(x) / FS, fim) * FS)]


# ---------------------------------------------------------------------------------------------
# Linha do tempo e sugestão de trechos


def linha_do_tempo(x: np.ndarray, janela: float = 4.0) -> list:
    saida = []
    n = int(janela * FS)
    for i in range(0, len(x) - n // 2, n):
        s = x[i:i + n]
        if len(s) < FS:
            break
        f, p = welch(s, 8192)
        fw, w = espectro_branqueado(s, 16384)
        mm = (fw >= 15) & (fw <= 600)
        j = int(np.argmax(w[mm]))
        te = taxa_envoltoria(s, 1000, 4000, 3.0, 300.0, k=1)
        saida.append({'t': i / FS, 'nivel': db(np.mean(s ** 2)), 'bandas': bandas_rel(f, p), 'cent': centroide(f, p),
                      'linha': (float(fw[mm][j]), float(w[mm][j])), 'env': te[0] if te else None})
    return saida


def imprime_linha_do_tempo(x: np.ndarray, janela: float) -> None:
    print('    t   nível | 30-100 60-150 400-1k 1-2.5k 2.5-6k  6-12k 12-20k | cent | linha<600 (dB) | envoltória 1-4k Hz (dB, ac)')
    for l in linha_do_tempo(x, janela):
        b = l['bandas']
        e = l['env']
        print(f"{l['t']:5.0f} {l['nivel']:7.1f} | {b['30-100']:6.1f} {b['60-150']:6.1f} {b['400-1k']:6.1f} {b['1-2.5k']:6.1f} "
              f"{b['2.5-6k']:6.1f} {b['6-12k']:6.1f} {b['12-20k']:6.1f} | {l['cent']:4.0f} | {l['linha'][0]:6.1f} ({l['linha'][1]:4.1f}) | "
              + (f"{e[0]:6.1f} ({e[1]:.0f}, {e[2]})" if e else '   —'))


def sugere(x: np.ndarray, janela: float = 2.0, tol_db: float = 3.0, ipv=None, vpc: float = 2.0, faixa_rpm=None,
           tipo: str = 'motor') -> list:
    """Resumo do arquivo em trechos: janelas vizinhas com o nível dentro de ±tol_db e o ritmo dentro
    de ±7 % são fundidas. O ritmo é a rotação automática (se `ipv` e `faixa_rpm` forem dados), a taxa
    da envoltória (chuff, rotor) ou a linha mais forte do grave."""
    n = int(janela * FS)
    jan = []
    for i in range(0, len(x) - n // 2, n):
        s = x[i:i + n]
        if len(s) < FS:
            break
        f, p = welch(s, 8192)
        nivel = db(np.mean(s ** 2))
        cent = centroide(f, p)
        fw, w = espectro_branqueado(s, 16384)
        r = None
        if tipo == 'chuff':
            te = taxa_envoltoria(s, 300, 6000, 0.8, 40.0, k=1)
            r = te[0][0] if te and te[0][1] >= 10 else None
        elif tipo == 'rotor':
            pt = pente(fw, w, 6.0, 60.0, teto=300.0)
            r = pt[0][0] if pt and pt[0][1] >= 4 else None
        elif ipv and faixa_rpm:
            pt = pente(fw, w, faixa_rpm[0] / 60.0 * ipv, faixa_rpm[1] / 60.0 * ipv)
            r = pt[0][0] / ipv * 60.0 if pt and pt[0][1] >= 4 else None
        else:
            mm = (fw >= 15) & (fw <= 600)
            j = int(np.argmax(w[mm]))
            r = float(fw[mm][j]) if w[mm][j] >= 8 else None
        b = bandas_rel(f, p)
        jan.append({'t': i / FS, 'nivel': nivel, 'cent': cent, 'r': r, 'grave': b['30-100'], 'agudo': b['2.5-6k']})
    if not jan:
        return []
    piso = float(np.percentile([j['nivel'] for j in jan], 5))
    segs, ini = [], 0

    def fecha(a, b):
        ref = jan[a:b]
        rs = [j['r'] for j in ref if j['r'] is not None]
        segs.append({'ini': ref[0]['t'], 'fim': ref[-1]['t'] + janela, 'nivel': arred(np.median([j['nivel'] for j in ref])),
                     'acimaDoPiso': arred(np.median([j['nivel'] for j in ref]) - piso),
                     'ritmo': arred(np.median(rs), 1) if len(rs) >= max(1, len(ref) // 2) else None,
                     'ritmoMinMax': [arred(min(rs), 1), arred(max(rs), 1)] if rs else None,
                     'cent': int(np.median([j['cent'] for j in ref])), 'grave': arred(np.median([j['grave'] for j in ref])),
                     'agudo': arred(np.median([j['agudo'] for j in ref]))})

    for i in range(1, len(jan) + 1):
        quebra = i == len(jan)
        if not quebra:
            ref = jan[ini:i]
            nv = np.median([j['nivel'] for j in ref])
            rs = [j['r'] for j in ref if j['r'] is not None]
            quebra = abs(jan[i]['nivel'] - nv) > tol_db
            if not quebra and rs and jan[i]['r'] is not None:
                quebra = abs(jan[i]['r'] - np.median(rs)) / max(np.median(rs), 1e-6) > 0.07
        if quebra:
            fecha(ini, i)
            ini = i
    return segs


def imprime_sugestao(nome: str, segs: list, un: str) -> None:
    print(nome)
    for s in segs:
        rm = s['ritmoMinMax']
        print(f"   {s['ini']:5.0f}–{s['fim']:<5.0f} {s['nivel']:6.1f} dB (+{s['acimaDoPiso']:4.1f}) "
              + (f"{s['ritmo']:7.1f} {un}" if s['ritmo'] is not None else '      — ' + ' ' * len(un))
              + (f" [{rm[0]:g}–{rm[1]:g}]" if rm and rm[1] - rm[0] > 0.04 * max(rm[1], 1e-6) else '')
              + f"  cent {s['cent']:5d}  30–100 {s['grave']:+5.1f}  2,5–6k {s['agudo']:+5.1f}")


def espectrograma_png(x: np.ndarray, png: str, titulo: str = '', fmax: float = 20000.0, tamanho=(11.5, 6.0),
                      fgrave: float = 700.0) -> None:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    dur = len(x) / FS
    fig, ax = plt.subplots(2, 1, figsize=tamanho, height_ratios=[1, 1])
    # em cima: tudo, em escala log (banda, fala, música); embaixo: o grave em escala linear, com
    # resolução fina (as linhas da ignição e como a rotação anda)
    for a, (f0, f1, escala, n) in zip(ax, [(40, fmax, 'log', 4096 if dur > 20 else 2048),
                                           (0, fgrave, 'linear', 16384 if dur > 20 else 8192)]):
        f, t, s = signal.spectrogram(x, FS, nperseg=n, noverlap=n - max(n // 8, int(len(x) / 1400)), window='hann')
        m = (f >= f0) & (f <= f1)
        d = 10 * np.log10(s[m] + 1e-14)
        topo = np.percentile(d, 99.9)
        a.pcolormesh(t, f[m], d, vmin=topo - (75 if escala == 'log' else 55), vmax=topo, cmap='magma', shading='auto', rasterized=True)
        a.set_yscale(escala)
        a.set_ylabel('Hz')
        passo = 5 if dur <= 80 else (10 if dur <= 160 else 20)
        a.set_xticks(np.arange(0, dur, passo))
        a.grid(axis='x', color='w', alpha=0.25, lw=0.5)
        if escala == 'linear':
            a.set_yticks(np.arange(0, f1 + 1, 50 if f1 <= 800 else 250))
            a.grid(axis='y', color='w', alpha=0.15, lw=0.4)
    ax[0].set_title(titulo, fontsize=9)
    ax[1].set_xlabel('s')
    fig.tight_layout()
    fig.savefig(png, dpi=72)
    plt.close(fig)


# ---------------------------------------------------------------------------------------------
# Índice


def julga(item: dict, q: dict) -> tuple[bool, list]:
    """Aplica o critério de entrada. Devolve (aprovado, ressalvas)."""
    res = []
    ok = True
    fal, cont = q.get('falesiaHz'), q.get('conteudoAteHz') or 0
    if fal is not None and fal < CRITERIOS['bandaMinHz']:
        ok = False
        res.append(f'passa-baixa em {fal / 1000:.1f} kHz (< {"12" if fal < CRITERIOS["bandaMinBaixaQualidadeHz"] else "15"} kHz)')
    elif fal is None and cont < CRITERIOS['bandaMinBaixaQualidadeHz']:
        ok = False
        res.append(f'sem conteúdo acima de {cont / 1000:.1f} kHz (o agudo some no piso; < 12 kHz)')
    elif fal is None and cont < CRITERIOS['bandaMinHz']:
        res.append(f'o agudo some no piso em {cont / 1000:.1f} kHz, sem falésia de filtro')
    dg = q.get('degrau') or {}
    if dg.get('hz') and dg['hz'] < min(fal or 24000, 15000) - 500 and (dg.get('quedaDb') or 0) >= 12:
        res.append(f"degrau de {dg['quedaDb']:.0f} dB em {dg['hz'] / 1000:.1f} kHz (material de banda estreita por baixo?)")
        if dg['quedaDb'] >= 20 and dg['hz'] < CRITERIOS['bandaMinBaixaQualidadeHz']:
            ok = False
    if q['clippingPct'] is not None and q['clippingPct'] >= CRITERIOS['clippingMaxPct']:
        ok = False
        res.append(f"clipping {q['clippingPct']:.2f} %")
    leg = q.get('legendas') or {}
    if leg.get('palavrasPorMin') is not None:
        if leg['palavrasPorMin'] >= 25:
            res.append(f"fala no vídeo (legenda automática: {leg['palavrasPorMin']:.0f} palavras/min no corte): só os trechos anotados servem")
        elif leg['palavrasPorMin'] > 0:
            res.append(f"legenda automática com palavras soltas ({leg['palavrasPorMin']:.0f}/min): fala esparsa ou engano do reconhecedor")
        if (leg.get('segundosMarcadosMusica') or 0) >= 4:
            res.append(f"legenda automática marca música em {leg['segundosMarcadosMusica']:.0f} s (o reconhecedor também marca assim motor tonal)")
    elif q.get('legendasAuto'):
        res.append('o YouTube gerou legenda automática (pode haver fala): só os trechos anotados servem')
    s = q.get('silabica') or {}
    if (s.get('p90') or 0) >= CRITERIOS['silabicaAlerta']:
        res.append(f"modulação silábica alta em parte do arquivo (p90 {s['p90']})")
    if (q.get('desvioGraveDb') or 0) > CRITERIOS['desvioGraveAlertaDb']:
        res.append(f"grave instável ({q['desvioGraveDb']} dB em janelas de 0,1 s: vento?)")
    if q.get('musicaDeclarada'):
        res.append('o vídeo declara música: ' + ', '.join(str(m) for m in q['musicaDeclarada']))
    return ok, res


def mede_item(args) -> dict | None:
    item, ref = args
    fam, slug = item['familia'], item['slug']
    wav = os.path.join(ref, fam, slug + '.wav')
    if not os.path.exists(wav):
        return None
    meta = {}
    mj = os.path.join(ref, '_meta', fam, slug + '.json')
    if os.path.exists(mj):
        with open(mj, encoding='utf-8') as f:
            meta = json.load(f)
    x = le_wav(wav)
    q = qualidade(x, meta)
    tipo_item = item.get('ritmo', 'motor')
    trechos = []
    falas = [e for e in ((meta.get('legendas') or {}).get('trechos') or []) if not e[2].startswith(('[', '('))]
    for t in item.get('trechos') or []:
        s = recorta(x, t['ini'], t['fim'])
        if len(s) < FS // 2:
            continue
        m = mede_trecho(s, t.get('ritmo', tipo_item), t.get('ignPorVolta', item.get('ignPorVolta')),
                        float(t.get('voltasPorCiclo', item.get('voltasPorCiclo', 2.0))),
                        t.get('faixaRpm', item.get('faixaRpm')))
        pal = sum(len(e[2].split()) for e in falas if e[0] < t['fim'] and e[1] > t['ini'])
        if pal:
            m['palavrasDaLegendaNoTrecho'] = pal
        trechos.append({**{k: v for k, v in t.items() if k not in ('ritmo', 'faixaRpm')}, **m})
    # a banda que vale é a dos trechos anotados (o resto do arquivo pode ser outra coisa: vinheta com
    # música de banda cheia, por exemplo). Entre os trechos fica a melhor, que é a que a cadeia de
    # gravação comprovadamente deixa passar; trecho distante ou muito baixo perde o agudo sem filtro
    # nenhum, e fica só com uma ressalva
    com_banda = [t['medidas'] for t in trechos if t['medidas'].get('bandaHz') is not None]
    if com_banda:
        melhor = max(com_banda, key=lambda m: m['bandaHz'])
        q['bandaArquivoInteiroHz'] = q['bandaHz']
        q.update(bandaHz=melhor['bandaHz'], falesiaHz=melhor['falesiaHz'], conteudoAteHz=melhor['conteudoAteHz'])
    ok, res = julga(item, q)
    for t in trechos:
        bt = t['medidas'].get('bandaHz')
        if bt is not None and bt < CRITERIOS['bandaMinBaixaQualidadeHz'] and bt < q['bandaHz'] - 2000:
            res.append(f"trecho {t['ini']:g}–{t['fim']:g}: o agudo acaba em {bt / 1000:.1f} kHz (distante, baixo ou filtrado)")
        if t['medidas'].get('palavrasDaLegendaNoTrecho', 0) >= 4:
            res.append(f"trecho {t['ini']:g}–{t['fim']:g}: a legenda automática tem {t['medidas']['palavrasDaLegendaNoTrecho']} palavras aqui")
    saida = {
        'familia': fam, 'slug': slug, 'arquivo': f'{fam}/{slug}.wav',
        'fonte': item['fonte'],
        'titulo': meta.get('titulo') or item.get('titulo'),
        'autor': meta.get('autor') or item.get('autor'),
        'licenca': meta.get('licenca') or item.get('licenca'),
        'nomeAntigo': item.get('nomeAntigo'),
        'motor': item.get('motor'),
        'oQue': item.get('oQue'),
        'corteDoOriginal': meta.get('corte') or item.get('corte') or [0, 240],
        'duracaoOriginal': meta.get('duracaoOriginal'),
        'ignPorVolta': item.get('ignPorVolta'), 'voltasPorCiclo': item.get('voltasPorCiclo'),
        'qualidade': q,
        'aprovado': ok,
        'baixaQualidade': bool(item.get('baixaQualidade')),
        'motivoBaixaQualidade': item.get('motivoBaixaQualidade'),
        'comprimentoM': item.get('comprimentoM'),
        'ressalvas': res + ([item['notas']] if item.get('notas') else []),
        'trechos': trechos,
    }
    return {k: v for k, v in saida.items() if v is not None}


def fmt_rpm(t: dict) -> str:
    partes = []
    if t.get('rpm') is not None:
        partes.append(f"{t['rpm']} rpm")
    if t.get('ignHz') is not None:
        partes.append(f"ign {t['ignHz']} Hz")
    for k, un in (('velocidadeKmh', 'km/h'), ('chuffHz', 'chuffs/s'), ('bpfHz', 'Hz (pás)'), ('tomHz', 'Hz (tom)')):
        if t.get(k) is not None:
            partes.append(f'{t[k]} {un}')
    r = t.get('ritmo') or {}
    auto = r.get('auto')
    s = ', '.join(partes) or '—'
    if t.get('comoRpm'):
        s += f" ({t['comoRpm']})"
    if auto:
        s += f" · auto {auto['rpm']} rpm [{'+'.join(auto['apoio'])}; {auto['confianca']}]"
    elif r.get('passagem'):
        p = r['passagem']
        s += f" · pico aos {p.get('picoEmS')} s, largura a −6 dB {p.get('larguraMenos6dBS')} s"
    elif r.get('envoltoria') and not auto and t.get('rpm') is None:
        e = r['envoltoria'][0]
        s += f" · envoltória {e[0]} Hz (+{e[1]} dB)"
    elif r.get('pente') and t.get('rpm') is None and 'envoltoria' in r and 'dobra' not in r:
        s += f" · pente {r['pente'][0][0]} Hz"
    ta = (t.get('medidas') or {}).get('tomAgudo')
    if ta:
        s += (f" · {ta['tipo']} em {ta['hzP50'] / 1000:.2f} kHz ({ta['hzP10'] / 1000:.1f}–{ta['hzP90'] / 1000:.1f}), "
              f"{ta['presencaPct']} % do trecho, {ta['nivelRelOrdensDb']:+.0f} dB rel. 150–400 Hz")
    return s


def escreve_destaques(L: list, indice: dict) -> None:
    dest = indice.get('destaques') or []
    if not dest:
        return
    idx = {(i['familia'], i['slug']): i for i in indice['itens']}
    L.append('## Trechos recomendados\n')
    L.append('Os melhores trechos para as famílias que vão primeiro para a etapa de som, uma linha por condição. '
             '"Rotação" é a anotada (como foi conferida) e, ao lado, a automática do `medir.py`.\n')
    grupo = None
    for d in dest:
        if d['grupo'] != grupo:
            grupo = d['grupo']
            L.append(f'\n### {grupo}\n')
            L.append('| Condição | Arquivo | Trecho (s) | Rotação | Por que este |')
            L.append('|---|---|---|---|---|')
        it = idx.get((d['familia'], d['slug']))
        t = None
        if it:
            t = next((x for x in it.get('trechos') or [] if abs(x['ini'] - d['ini']) < 0.01 and abs(x['fim'] - d['fim']) < 0.01), None)
        estado = '' if it else ' (**ainda não baixado**)'
        L.append(f"| {d['condicao']} | `{d['familia']}/{d['slug']}.wav`{estado} | {d['ini']:g}–{d['fim']:g} | {fmt_rpm(t) if t else '—'} | {d.get('porque', '')} |")
    L.append('')


def escreve_index_md(indice: dict, caminho: str) -> None:
    L = []
    itens = indice['itens']
    L.append('# Gravações de referência\n')
    L.append(f"Gerado em {indice['geradoEm']} por `tools/referencias/medir.py`. {len(itens)} arquivos, WAV mono 48 kHz 16 bits "
             'com até 240 s; os originais foram apagados. **Uso privado, como alvo de análise: nada daqui vai para o git '
             'nem para o site.** Os do YouTube não podem ser redistribuídos; os do Commons têm a licença indicada. '
             'Para rebaixar: `python3 -I tools/referencias/baixar.py`. O mesmo conteúdo, para programa, está em `index.json`.\n')
    L.append('**Critério de entrada (medido):** banda útil ≥ 15 kHz (falésia de −20 dB), clipping < 0,1 %, sem música nem fala '
             'nos trechos anotados, grave presente, rotação ou velocidade identificável. `baixaQualidade` = não cumpre, mas é a '
             'única fonte de algo essencial. As ressalvas dizem o que cada arquivo tem de errado fora dos trechos.\n')
    L.append('**Colunas das medidas por trecho:** nível em dBFS; bandas em dB relativas a 150–400 Hz '
             '(30–100 / 60–150 / 400–1k / 1–2,5k / 2,5–6k / 6–12k / 12–20k); centroide de 100 Hz a 8 kHz. Acima de ~8 kHz '
             'vale pouco (codec e microfone). Rotação: a anotada, como foi estimada, e a automática ao lado para conferir.\n')
    fams = []
    for it in itens:
        if it['familia'] not in fams:
            fams.append(it['familia'])
    L.append('| Família | Arquivos | Aprovados | Baixa qualidade |')
    L.append('|---|---|---|---|')
    for fam in fams:
        fi = [i for i in itens if i['familia'] == fam]
        L.append(f"| [{fam}](#{fam}) | {len(fi)} | {sum(1 for i in fi if i.get('aprovado'))} | {sum(1 for i in fi if i.get('baixaQualidade'))} |")
    L.append('')
    L.append('Os trechos foram delimitados pela linha do tempo de níveis e pelo espectrograma, **não de ouvido**. Onde o trecho diz '
             '"arquivo inteiro", ninguém separou as condições ainda: olhe o espectrograma (`medir.py --espectrograma`) antes de usar.\n')
    escreve_destaques(L, indice)
    for fam in fams:
        L.append(f'## {fam}\n')
        for it in [i for i in itens if i['familia'] == fam]:
            q = it.get('qualidade') or {}
            estado = 'aprovado' if it.get('aprovado') else ('**baixaQualidade**' if it.get('baixaQualidade') else '**reprovado**')
            L.append(f"### `{it.get('arquivo', it['slug'])}` — {it.get('motor') or it.get('oQue') or ''}\n")
            if it.get('oQue') and it.get('motor'):
                L.append(f"{it['oQue']}\n")
            L.append(f"- Fonte: [{it.get('titulo') or it['fonte']}]({it['fonte']}) — {it.get('autor') or '?'} — {it.get('licenca') or '?'}"
                     + (f" — nome antigo `{it['nomeAntigo']}`" if it.get('nomeAntigo') else ''))
            c = it.get('corteDoOriginal') or [0, 0]
            L.append(f"- Duração {q.get('duracao')} s (do original: {c[0]:.0f}–{c[1]:.0f} s"
                     + (f" de {it['duracaoOriginal']:.0f} s" if it.get('duracaoOriginal') else '') + f"); {q.get('codecOriginal') or ''}")
            s = q.get('silabica') or {}
            L.append(f"- Qualidade ({estado}): banda {((q.get('bandaHz') or 0) / 1000):.1f} kHz; clipping {q.get('clippingPct')} %; "
                     f"30–100 Hz {q.get('grave30a100Db'):+.1f} dB; nível {q.get('nivelDbfs')} dBFS (pico {q.get('picoDbfs')}); "
                     f"silábica {s.get('mediana')}/{s.get('p90')}; grave instável {q.get('desvioGraveDb')} dB; "
                     f"legenda automática: {'sim' if q.get('legendasAuto') else ('não' if q.get('legendasAuto') is False else 'n/d')}"
                     if q.get('grave30a100Db') is not None else f'- Qualidade ({estado})')
            for r in it.get('ressalvas') or []:
                L.append(f'- Ressalva: {r}')
            if it.get('trechos'):
                L.append('')
                L.append('| Trecho (s) | O que se ouve | Posição | Rotação / velocidade | Nível | 30–100 | 60–150 | 400–1k | 1–2,5k | 2,5–6k | 6–12k | 12–20k | Centroide |')
                L.append('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
                for t in it['trechos']:
                    m = t.get('medidas') or {}
                    b = m.get('bandas') or {}

                    def fb(k):
                        v = b.get(k)
                        return f'{v:+.1f}' if v is not None else '—'
                    L.append(f"| {t['ini']:g}–{t['fim']:g} | **{t.get('rotulo', '')}**: {t.get('oQue', '')} | {t.get('posicao', '')} | {fmt_rpm(t)} | "
                             f"{m.get('nivelDbfs')} | {fb('30-100')} | {fb('60-150')} | {fb('400-1k')} | {fb('1-2.5k')} | {fb('2.5-6k')} | "
                             f"{fb('6-12k')} | {fb('12-20k')} | {m.get('centroideHz')} |")
            L.append('')
    with open(caminho, 'w', encoding='utf-8') as g:
        g.write('\n'.join(L) + '\n')


def gera_indice(a) -> int:
    import multiprocessing
    ref = baixar.pasta_referencias(a.destino)
    lista = baixar.carrega_lista(a.lista)
    itens = lista['itens']
    alvo = [i for i in itens if (not a.familia or i['familia'] in a.familia) and (not a.slug or i['slug'] in a.slug)]
    with multiprocessing.Pool(min(12, os.cpu_count() or 4)) as pool:
        medidos = [m for m in pool.map(mede_item, [(i, ref) for i in alvo]) if m]
    caminho = os.path.join(ref, 'index.json')
    antigos = []
    if os.path.exists(caminho):
        try:
            with open(caminho, encoding='utf-8') as f:
                antigos = json.load(f).get('itens', [])
        except Exception:
            antigos = []
    novos = {(m['familia'], m['slug']): m for m in medidos}
    da_lista = {(i['familia'], i['slug']) for i in itens}
    familias_da_lista = {i['familia'] for i in itens}
    ordem = {(i['familia'], i['slug']): n for n, i in enumerate(itens)}
    final = []
    for o in antigos:   # o que é de outra ferramenta (ex.: gasolina) fica; o que saiu da lista sai
        ch = (o.get('familia'), o.get('slug'))
        if ch in novos:
            continue
        if ch in da_lista or o.get('familia') not in familias_da_lista:
            final.append(o)
    final.extend(novos.values())
    final.sort(key=lambda o: (0, ordem[(o['familia'], o['slug'])]) if (o.get('familia'), o.get('slug')) in ordem
               else (1, str(o.get('familia')), str(o.get('slug'))))
    indice = {'geradoEm': datetime.date.today().isoformat(), 'criterios': CRITERIOS,
              'bandas': [b[0] for b in BANDAS], 'destaques': lista.get('destaques') or [], 'itens': final}
    with open(caminho, 'w', encoding='utf-8') as g:
        json.dump(indice, g, ensure_ascii=False, indent=1)
    escreve_index_md(indice, os.path.join(ref, 'INDEX.md'))
    faltam = [i['slug'] for i in alvo if (i['familia'], i['slug']) not in novos]
    rep = [m for m in medidos if not m['aprovado']]
    print(f'{len(medidos)} medidos, {len(final)} no índice; {len(rep)} fora do critério; {len(faltam)} sem WAV')
    for m in rep:
        print(f"  {'BQ ' if m['baixaQualidade'] else 'REP'} {m['familia']}/{m['slug']}: " + '; '.join(m['ressalvas'][:3]))
    if faltam:
        print('  sem WAV: ' + ', '.join(faltam))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--lista', default=baixar.LISTA)
    ap.add_argument('--destino')
    ap.add_argument('--familia', action='append')
    ap.add_argument('--slug', action='append')
    ap.add_argument('--arquivo', nargs='+')
    ap.add_argument('--trecho', nargs=2, type=float, metavar=('INI', 'FIM'))
    ap.add_argument('--ritmo', default='motor', choices=['motor', 'chuff', 'rotor', 'tonal', 'passagem'])
    ap.add_argument('--ign-por-volta', type=float)
    ap.add_argument('--voltas-por-ciclo', type=float, default=2.0)
    ap.add_argument('--faixa-rpm', nargs=2, type=float)
    ap.add_argument('--linha-do-tempo')
    ap.add_argument('--janela', type=float, default=4.0)
    ap.add_argument('--sugerir', nargs='+')
    ap.add_argument('--tolerancia', type=float, default=3.0, help='dB de nível para fundir janelas no --sugerir')
    ap.add_argument('--espectrograma')
    ap.add_argument('--png')
    ap.add_argument('--json', action='store_true', help='saída do --arquivo em JSON')
    a = ap.parse_args()

    if a.linha_do_tempo:
        x = le_wav(a.linha_do_tempo)
        if a.trecho:
            x = recorta(x, *a.trecho)
        imprime_linha_do_tempo(x, a.janela)
        return 0
    if a.sugerir:
        un = 'rpm' if (a.ign_por_volta and a.faixa_rpm) else ('/s' if a.ritmo in ('chuff', 'rotor') else 'Hz')
        for c in a.sugerir:
            imprime_sugestao(os.path.basename(c), sugere(le_wav(c), a.janela if a.janela != 4.0 else 2.0, a.tolerancia,
                                                        a.ign_por_volta, a.voltas_por_ciclo, a.faixa_rpm, a.ritmo), un)
        return 0
    if a.espectrograma:
        x = le_wav(a.espectrograma)
        if a.trecho:
            x = recorta(x, *a.trecho)
        espectrograma_png(x, a.png or os.path.splitext(a.espectrograma)[0] + '.png', os.path.basename(a.espectrograma))
        return 0
    if a.arquivo:
        for c in a.arquivo:
            x = le_wav(c)
            mj = os.path.join(os.path.dirname(c), '_meta', os.path.splitext(os.path.basename(c))[0] + '.json')
            meta = json.load(open(mj, encoding='utf-8')) if os.path.exists(mj) else None
            if a.trecho:
                r = mede_trecho(recorta(x, *a.trecho), a.ritmo, a.ign_por_volta, a.voltas_por_ciclo, a.faixa_rpm)
                if a.json:
                    print(json.dumps(r, ensure_ascii=False))
                else:
                    m = r['medidas']
                    print(f"{os.path.basename(c)} {a.trecho[0]:g}–{a.trecho[1]:g}: {m['nivelDbfs']} dBFS, banda {m.get('bandaHz')}, cent {m['centroideHz']}, "
                          f"p90/p10 {m['p90p10Db1a4k']}\n   bandas {m['bandas']}\n   ritmo {json.dumps(r['ritmo'], ensure_ascii=False)}")
            else:
                q = qualidade(x, meta)
                ok, res = julga({}, q)
                if a.json:
                    print(json.dumps({'arquivo': c, 'qualidade': q, 'aprovado': ok, 'ressalvas': res}, ensure_ascii=False))
                else:
                    s = q['silabica']
                    print(f"{'OK ' if ok else 'REP'} {os.path.basename(c)[:44]:44s} {q['duracao']:6.1f}s banda {q['bandaHz'] / 1000:4.1f}k "
                          f"degrau {q['degrau']['quedaDb']}@{(q['degrau']['hz'] or 0) / 1000:.1f}k clip {q['clippingPct']:.3f} "
                          f"30-100 {q['grave30a100Db']:+5.1f} nível {q['nivelDbfs']:6.1f} sil {s['mediana']}/{s['p90']} "
                          f"vento {q['desvioGraveDb']} leg {q.get('legendasAuto')} | " + '; '.join(res))
        return 0
    return gera_indice(a)


if __name__ == '__main__':
    sys.exit(main())
