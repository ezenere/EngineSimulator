#!/usr/bin/env python3
"""vapor-ouvido.py — a régua do Vapor com o kit ouvido (tools/ouvido/): renderiza cada caso de `vapor-ouvido.json` na
taxa de chuffs da gravação casada, compara (painel, leito, envoltória, defeitos), mede a forma do chuff com as funções
da validação (tools/vapor-forma.ts) nos dois lados e faz o orçamento de ruído por fonte com a mesma semente.

    python3 -I tools/vapor-ouvido.py [--casos tools/vapor-ouvido.json] [--saida PASTA] [--so id,id] [--j 12]
                                     [--sem-orcamento] [--sem-painel] [--rotulo "ANTES"] [--campo JSON]

Sai em PASTA/<id>/: `real.wav` (o trecho da gravação com a taxa de chuffs acertada, ver abaixo), os WAVs do render
(`<id>_tudo.wav`, `_so-<fonte>.wav`, `_sem-<fonte>.wav`, `_semente2.wav`), `cmp/painel.png`, `cmp/resumo.txt`,
`cmp/medidas.json`, `<id>_orcamento.{txt,json,png}`, `caso.json`; e em PASTA: `resumo.md` e `resumo.json`. As gravações
ficam em `referencias/vapor/` do checkout principal (fora do git) e PASTA por padrão é `referencias/_sim/vapor/atual/`.

A "rotação" do vapor é a taxa de chuffs, e o ciclo do kit é a volta de roda (4 chuffs numa máquina de 2 cilindros). Um
chuff é uma rajada de ruído: não tem linhas, e o rastreador do kit (pente harmônico) não acha o ciclo. Aqui a taxa sai
da ENVOLTÓRIA (150–3000 Hz, RMS de 10 ms): a linha mais forte na faixa `taxa` do caso, e a fase dessa linha (Hilbert da
envoltória filtrada em volta dela). Como as locomotivas das gravações estão acelerando, o trecho é reamostrado nessa
fase para a taxa ficar constante (a mudança de altura é a variação da taxa no trecho, 1 a 10%: o `caso.json` diz
quanto), e o kit recebe o ciclo exato dos dois lados (`--fixo-real`, `--fixo-sim`). O simulado é renderizado na taxa
média do trecho.

Campos de um caso (`vapor-ouvido.json`):
  id, preset, titulo, corte, reg, chuffs (ausente = a taxa medida na gravação), ev (escapes por volta; padrão 4),
  evLinha (quantas vezes por volta bate a linha achada na gravação; padrão ev)
  escuta: "perto" (a soma dos canais a 7,5 m) | {"cena": D} (ouvinte andando junto a D m, pela Cena) | {"passagem": D}
  real, trecho [a, b], taxa [fmin, fmax] (faixa em que procurar a linha dos chuffs), casada (false = outra máquina ou
  outra posição: vale como faixa), dur, vagoes, campo

Critérios (docs/PLANO.md, viés "mais motor, menos ar", e a régua do tools/ouvido/README.md), por caso casado:
  ar ≤ 0,6 · leito do simulado ≤ leito da gravação em toda banda de 400 Hz a 6 kHz · pulso a menos ≤ 1,3 ·
  tom a menos ≤ 2,4 · desligar as fontes contínuas (tiragem, vazamentos) muda o nível ponderado A em < 1,5 dB ·
  centroide do vale ÷ centroide do pico entre 1,05 e 1,35 de perto · ataque, decaimento e pico/vale na faixa da gravação.
"""
import argparse
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from scipy import signal

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, os.path.join(AQUI, 'ouvido'))
import nucleo as nu  # noqa: E402
import comparar as cp  # noqa: E402
import orcamento as orc  # noqa: E402

NA_REDE = ['hoot', 'variacao']
CONTINUAS = ['tiragem', 'vazamentos']
TSX = os.path.join(RAIZ, 'node_modules', '.bin', 'tsx')


def principal():
    try:
        comum = subprocess.run(['git', '-C', RAIZ, 'rev-parse', '--path-format=absolute', '--git-common-dir'], capture_output=True, text=True, check=True).stdout.strip()
        return os.path.dirname(comum)
    except (subprocess.CalledProcessError, OSError):
        return RAIZ


def rodar(cmd):
    r = subprocess.run([str(c) for c in cmd], cwd=RAIZ, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f'falhou: {" ".join(str(c) for c in cmd)}\n{r.stdout}\n{r.stderr}')
    return r.stdout


def forma(arq, chuffs):
    return json.loads(rodar([TSX, os.path.join(AQUI, 'vapor-forma.ts'), arq, '--chuffs', f'{chuffs:.5f}', '--json']).strip().splitlines()[-1])


# ------------------------------------------------------------------------------------------------ taxa e fase dos chuffs
def envoltoria(x, fs, lo=150.0, hi=3000.0, jan=0.01, fe=400):
    sos = signal.butter(4, [lo, hi], btype='bandpass', fs=fs, output='sos')
    y = signal.sosfiltfilt(sos, x) ** 2
    n = max(1, int(jan * fs))
    e = np.sqrt(np.maximum(np.convolve(y, np.ones(n) / n, mode='same'), 0))
    passo = int(fs // fe)
    return e[::passo], fs / passo


def fase_chuffs(x, fs, fmin, fmax):
    """Taxa e fase dos chuffs pela envoltória. Devolve (f_med, fase por amostra de áudio em ciclos de chuff, variação %)."""
    e, fe = envoltoria(x, fs)
    lenta = np.convolve(e, np.ones(int(1.5 * fe)) / int(1.5 * fe), mode='same')
    d = (e - lenta) / (np.mean(lenta) + 1e-12)
    nf = 1 << int(np.ceil(np.log2(len(d) * 8)))
    E = np.abs(np.fft.rfft(d * np.hanning(len(d)), nf)) ** 2
    f = np.fft.rfftfreq(nf, 1 / fe)
    m = (f >= fmin) & (f <= fmax)
    f_nom = float(f[m][np.argmax(E[m])])
    # fase da linha: a envoltória filtrada em ±30% da linha, sinal analítico, fase desenrolada e alisada
    sos = signal.butter(2, [0.7 * f_nom, 1.3 * f_nom], btype='bandpass', fs=fe, output='sos')
    z = signal.hilbert(signal.sosfiltfilt(sos, d))
    ph = np.unwrap(np.angle(z)) / (2 * np.pi)
    t = np.arange(len(d)) / fe
    res = ph - f_nom * t
    sos2 = signal.butter(2, max(0.05, f_nom / 6), btype='lowpass', fs=fe, output='sos')
    ph = f_nom * t + signal.sosfiltfilt(sos2, res)
    ph = np.maximum.accumulate(ph)
    fi = np.gradient(ph, 1 / fe)
    b = int(1.0 * fe)
    f_med = (ph[-1] - ph[0]) / t[-1]
    var = 100 * (np.percentile(fi[b:-b], 95) - np.percentile(fi[b:-b], 5)) / f_med if len(fi) > 3 * b else 0.0
    return f_med, np.interp(np.arange(len(x)) / fs, t, ph), float(var), f_nom


def acertar_taxa(x, fs, fase, f_med):
    """Reamostra `x` na fase dos chuffs para a taxa ficar constante em `f_med` (interpolação linear sobre 2× a taxa)."""
    x2 = signal.resample_poly(x, 2, 1)
    t2 = np.arange(len(x2)) / (2 * fs)
    t = np.arange(len(x)) / fs
    n = int((fase[-1] - fase[0]) / f_med * fs)
    alvo = fase[0] + f_med * np.arange(n) / fs          # fase desejada em cada amostra de saída
    tt = np.interp(alvo, fase, t)                         # instante do original com essa fase
    return np.interp(tt, t2, x2)


def nivel_a(x, fs):
    f, P = signal.welch(x, fs, nperseg=8192)
    return float(nu.db10(np.sum(P * nu.ponderacao_a(f)) + 1e-30))


# ------------------------------------------------------------------------------------------------ um caso
def args_render(c, chuffs, campo):
    a = ['--chuffs', f'{chuffs:.5f}', '--corte', c.get('corte', 0.5), '--reg', c.get('reg', 1), '--dur', c.get('dur', 12)]
    esc = c.get('escuta', 'perto')
    if isinstance(esc, dict):
        if 'cena' in esc: a += ['--cena', esc['cena']]
        if 'passagem' in esc: a += ['--passagem', esc['passagem']]
        if esc.get('reverb'): a += ['--reverb']
        if esc.get('fundo'): a += ['--fundo']
        if esc.get('ambiente'): a += ['--ambiente', esc['ambiente']]
    if c.get('vagoes'): a += ['--vagoes', c['vagoes']]
    cm = dict(c.get('campo') or {}); cm.update(campo or {})
    if cm: a += ['--campo', json.dumps(cm)]
    return a


def caso(c, saida, refs, op):
    pasta = os.path.join(saida, c['id'])
    os.makedirs(pasta, exist_ok=True)
    ev = int(c.get('ev', 4))
    out = {'id': c['id'], 'preset': c['preset'], 'titulo': c.get('titulo', c['id']), 'ev': ev, 'casada': c.get('casada', True)}
    chuffs = c.get('chuffs')
    arq_real = None
    if c.get('real'):
        x, fs = nu.ler_audio(os.path.join(refs, c['real']), tuple(c['trecho']) if c.get('trecho') else None)
        fmin, fmax = c.get('taxa', [1.0, 30.0])
        f_med, fase, var, f_nom = fase_chuffs(x, fs, fmin, fmax)
        y = acertar_taxa(x, fs, fase, f_med)
        arq_real = os.path.join(pasta, 'real.wav')
        nu.gravar_wav(arq_real, y, fs)
        # (`evLinha`: quantas vezes por volta de roda a linha achada bate; numa articulada a linha forte é a de um motor, 4/volta)
        ev_l = int(c.get('evLinha', ev))
        out['real'] = {'arquivo': c['real'], 'trecho': c.get('trecho'), 'chuffs': f_med, 'f0': f_med / ev_l, 'linha': f_nom, 'variacao_pct': var, 'forma': forma(arq_real, f_med)}
        if chuffs is None:
            chuffs = f_med * ev / ev_l
    if chuffs is None:
        chuffs = 4.0
    out['chuffs'] = chuffs
    pref = c['id']
    arq = lambda s: os.path.join(pasta, f'{pref}_{s}.wav')
    base = [TSX, os.path.join(AQUI, 'vapor-fontes.ts'), c['preset'], pasta, '--cada', '--rotulo', '@'] + args_render(c, chuffs, op['campo'])
    # (o --cada grava <preset>_@-<cond>_*.wav; os nomes passam para <id>_*.wav)
    antigos = [f for f in os.listdir(pasta) if f.startswith(pref + '_') and (f.endswith('.wav') or f.endswith('.json'))]
    for f in antigos:
        os.remove(os.path.join(pasta, f))
    rodar(base + (['--fontes', 'tiragem'] if op['sem_orcamento'] else []))
    for f in sorted(os.listdir(pasta)):
        if f.startswith(c['preset'] + '_@-'):
            suf = f[f.rindex('_') + 1:]
            os.replace(os.path.join(pasta, f), os.path.join(pasta, f'{pref}_{suf}'))
    with open(arq('tudo')[:-4] + '.json') as fh:
        info = json.load(fh)
    out['info'] = {k: info.get(k) for k in ('chuffs', 'kmh', 'f0', 'corte', 'regulador', 'pRelBar', 'engasgado', 'rmsDbSpl', 'picoDbFs', 'escuta', 'distancia')}
    x0, fs = nu.ler_audio(arq('tudo'))
    out['sim'] = {'forma': forma(arq('tudo'), chuffs), 'dBA': nivel_a(x0, fs)}
    # ---- as fontes contínuas juntas: quanto muda o nível ponderado A
    g = arq('sem-' + '+'.join(CONTINUAS))
    if os.path.exists(g):
        xs = nu.ler_audio(g)[0]
        out['continuas_dBA'] = nivel_a(x0, fs) - nivel_a(xs, fs)
    # ---- orçamento
    if not op['sem_orcamento']:
        for f in sorted(os.listdir(pasta)):
            if f.startswith(pref + '_sem-') and f.endswith('.wav'):
                nome = f[len(pref) + 5:-4]
                if nome in NA_REDE or '+' in nome:
                    continue
                xs = nu.ler_audio(os.path.join(pasta, f))[0]
                n = min(len(x0), len(xs))
                nu.gravar_wav(arq('so-' + nome), x0[:n] - xs[:n], fs)
                os.remove(os.path.join(pasta, f)); os.remove(os.path.join(pasta, f[:-4] + '.json'))
        r = orc.orcamento(pasta, pref, info.get('f0'), ev, True, NA_REDE, 1.0)
        with open(os.path.join(pasta, pref + '_orcamento.txt'), 'w') as fh:
            fh.write(orc.texto(r) + '\n')
        with open(os.path.join(pasta, pref + '_orcamento.json'), 'w') as fh:
            json.dump(nu.limpar(r), fh, ensure_ascii=False, indent=1)
        if not op['sem_painel']:
            orc.figura(r, os.path.join(pasta, pref + '_orcamento.png'))
        fo = r['fontes']
        out['orcamento'] = {'A_frac': {k: fo[k]['A_frac'] for k in fo}, 'bandas_frac': {k: fo[k]['bandas_frac'] for k in fo}, 'vao_1_6k': {k: fo[k]['vao_1_6k'] for k in fo},
                            'vao': {k: fo[k].get('vao') for k in fo},
                            'estocastico_A': r.get('estocastico', {}).get('A_frac'), 'vao_1_6k_db': r['total']['vao_1_6k_db'], 'p90_p10_1_6k': r['total']['p90_p10_1_6k']}
    # ---- comparação com a gravação
    if arq_real:
        f0 = chuffs / ev
        tit = f"{op['rotulo']} · {c.get('titulo', c['id'])}"
        res = cp.executar(arq_real, arq('tudo'), os.path.join(pasta, 'cmp'), out['real']['f0'], f0, ev, 1.0, True, True, None, None,
                          'media', 'media', 'auto', cp.PESOS, 0.2, 60.0, 0.08, 1.0, 100, tit, not op['sem_painel'])
        R, S, comp = res['real']['med'], res['sim']['med'], res['comp']
        aR, aS = comp['ancora_db_real'], comp['ancora_db_sim']
        bandas = []
        for i, nome in enumerate(nu.NOMES):
            br, bs = R['bandas'][i], S['bandas'][i]
            bandas.append({'banda': nome, 'hnr': [br['hnr'], bs['hnr']], 'leito_frac': [cp.leito_frac(br), cp.leito_frac(bs)], 'leito_db': [br['leito_db'] - aR, bs['leito_db'] - aS],
                           'nivel': [comp['_relR'][i]['nivel'], comp['_relS'][i]['nivel']], 'm_ign': [br.get('m_ign'), bs.get('m_ign')], 'p90_p10': [br['p90_p10'], bs['p90_p10']], 'vao': [br.get('vao'), bs.get('vao')]})
        gq = lambda m, k: m['faixa_1_6k'].get(k)
        out['comparacao'] = {'avisos': comp['avisos'], 'distancias': comp['distancias'], 'defeitos': comp['defeitos'], 'resumo': [r_['texto'] for r_ in comp['resumo']], 'bandas': bandas,
                             'faixa_1_6k': {k: [gq(R, k), gq(S, k)] for k in ('m_ign', 'm_ciclo', 'frac_ciclo', 'p90_p10', 'vao', 'cv_evento')},
                             'leito_1_6k': [cp.leito_frac(R['faixa_1_6k']), cp.leito_frac(S['faixa_1_6k'])],
                             'leito_1_6k_db': [R['faixa_1_6k']['leito_db'] - aR, S['faixa_1_6k']['leito_db'] - aS]}
    with open(os.path.join(pasta, 'caso.json'), 'w') as fh:
        json.dump(nu.limpar(out), fh, ensure_ascii=False, indent=1)
    return out


# ------------------------------------------------------------------------------------------------ tabela
def f(v, p=1, s=False):
    if v is None or (isinstance(v, float) and not np.isfinite(v)):
        return '—'
    return (f'{v:+.{p}f}' if s else f'{v:.{p}f}').replace('.', ',').replace('-', '−')


def tabela(res, rotulo):
    L = [f'# Régua do Vapor ({rotulo})', '',
         'Gerado por `tools/vapor-ouvido.py`. Em cada célula "gravação / simulado". Forma do chuff pelas funções da validação (`tools/vapor-analise.ts`); leito = a parte de cada banda '
         'que é ruído contínuo, presente até no vale entre os chuffs (fração da banda e nível em dB relativo a 150–400 Hz).', '']
    L += ['## Forma do chuff', '',
          '| caso | chuffs/s | ataque (ms) | largura (ms) | decaimento (ms) | pico/vale (dB) | p/v 150–400 · 400–1,5k · 1,5–6k | centroide pico (Hz) | centroide vale ÷ pico | CV (dB) |', '|---|---|---|---|---|---|---|---|---|---|']
    for r in res:
        a = (r.get('real') or {}).get('forma'); b = r['sim']['forma']
        g = lambda k, p=0: f"{f(a[k], p) if a else '—'} / {f(b[k], p)}"
        pb = ' · '.join(f"{f(a['pvBanda'][i], 0) if a else '—'}/{f(b['pvBanda'][i], 0)}" for i in range(3))
        L.append(f"| {r['titulo']}{'' if r.get('casada', True) else ' *(faixa)*'} | {f(r['chuffs'], 2)} | {g('ataque')} | {g('largura')} | {g('decaimento')} | {g('pv', 1)} | {pb} | {g('centroidePico')} | {g('valePico', 2)} | {g('cv', 1)} |")
    reg = [r for r in res if 'comparacao' in r]
    if reg:
        L += ['', '## Distâncias e defeitos (régua dos aprovados: total ≤ 2,2 · ar ≤ 0,6 · tom a menos ≤ 2,4 · pulso a menos ≤ 1,3)', '',
              '| caso | tonal | piso | envoltória | modulação | eventos | **total** | **ar** | tom a menos | pulso a menos |', '|---|---|---|---|---|---|---|---|---|---|']
        for r in reg:
            d = r['comparacao']['distancias']; e = r['comparacao']['defeitos']
            L.append(f"| {r['titulo']} | {f(d['tonal'], 2)} | {f(d['piso'], 2)} | {f(d['envoltoria'], 2)} | {f(d['modulacao'], 2)} | {f(d['eventos'], 2)} | **{f(d['total'], 2)}** | **{f(e['ar'], 2)}** | {f(e['tom'], 2)} | {f(e['pulso'], 2)} |")
        L += ['', '## Leito de ruído contínuo e envoltória', '',
              '| caso | leito 400–1k (%) | 1–2,5k | 2,5–6k | 1–6 kHz | nível do leito re 150–400 (dB): 400–1k | 1–2,5k | 2,5–6k | 1–6 kHz | p90/p10 de 1–6 kHz (dB) | vão de 1–6 kHz (dB) | fração presa ao ciclo |', '|---|---|---|---|---|---|---|---|---|---|---|---|']
        pc = lambda v: '—' if v is None or not np.isfinite(v) else f'{100 * v:.0f}'
        for r in reg:
            c = r['comparacao']; b = c['bandas']; gq = c['faixa_1_6k']
            x = lambda i: (' ✗' if (b[i]['leito_db'][1] or -99) > (b[i]['leito_db'][0] or 99) + 0.5 else '')
            L.append(f"| {r['titulo']} | " + ' | '.join(f"{pc(b[i]['leito_frac'][0])} / {pc(b[i]['leito_frac'][1])}" for i in (3, 4, 5)) + f" | {pc(c['leito_1_6k'][0])} / {pc(c['leito_1_6k'][1])} | "
                     + ' | '.join(f"{f(b[i]['leito_db'][0], 1, True)} / {f(b[i]['leito_db'][1], 1, True)}{x(i)}" for i in (3, 4, 5)) + f" | {f(c['leito_1_6k_db'][0], 1, True)} / {f(c['leito_1_6k_db'][1], 1, True)} | "
                     f"{f(gq['p90_p10'][0])} / {f(gq['p90_p10'][1])} | {f(gq['vao'][0])} / {f(gq['vao'][1])} | {f(gq['frac_ciclo'][0], 2)} / {f(gq['frac_ciclo'][1], 2)} |")
        L += ['', '## Nível por banda (dB re 150–400 Hz, trecho inteiro)', '', '| caso | 60–150 | 400–1k | 1–2,5k | 2,5–6k | 6–12k |', '|---|---|---|---|---|---|']
        for r in reg:
            b = r['comparacao']['bandas']
            L.append(f"| {r['titulo']} | " + ' | '.join(f"{f(b[i]['nivel'][0], 1, True)} / {f(b[i]['nivel'][1], 1, True)}" for i in (1, 3, 4, 5, 6)) + ' |')
    orcs = [r for r in res if 'orcamento' in r]
    if orcs:
        fontes = sorted({k for r in orcs for k in r['orcamento']['A_frac'] if '+' not in k}, key=lambda k: -max(r['orcamento']['A_frac'].get(k, 0) for r in orcs))
        L += ['', '## Orçamento de ruído (mesma semente, uma fonte desligada por vez)', '',
              'Fração da potência ponderada A de cada fonte (%) e, entre parênteses, quanto do VALE de 1–6 kHz ela ocupa; o que desligar juntas as fontes contínuas (tiragem, vazamentos) muda no nível ponderado A; o nível absoluto do render.', '',
              '| caso | ' + ' | '.join(fontes) + ' | contínuas (dB A) | nível (dB(A) a 7,5 m) |', '|---|' + '---|' * (len(fontes) + 2)]
        for r in orcs:
            o = r['orcamento']
            cel = lambda k: '·' if k not in o['A_frac'] else f"{100 * o['A_frac'][k]:.0f} ({100 * (o['vao_1_6k'].get(k) or 0):.0f})"
            L.append(f"| {r['titulo']} | " + ' | '.join(cel(k) for k in fontes) + f" | {f(r.get('continuas_dBA'), 2)} | {f(r['sim']['dBA'] + 124, 1)} |")
    return '\n'.join(L) + '\n'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--casos', default=os.path.join(AQUI, 'vapor-ouvido.json'))
    ap.add_argument('--saida'); ap.add_argument('--referencias')
    ap.add_argument('--so'); ap.add_argument('--j', type=int, default=max(2, min(12, (os.cpu_count() or 4) - 4)))
    ap.add_argument('--sem-orcamento', action='store_true'); ap.add_argument('--sem-painel', action='store_true')
    ap.add_argument('--rotulo', default='atual'); ap.add_argument('--campo', help='JSON com campos de preset a mudar em todos os casos')
    a = ap.parse_args()
    raiz = principal()
    refs = a.referencias or os.path.join(raiz, 'referencias', 'vapor')
    saida = a.saida or os.path.join(raiz, 'referencias', '_sim', 'vapor', 'atual')
    os.makedirs(saida, exist_ok=True)
    with open(a.casos) as fh:
        casos = json.load(fh)['casos']
    todos = casos
    if a.so:
        so = a.so.split(',')
        casos = [c for c in casos if c['id'] in so or c['preset'] in so]
    op = {'sem_orcamento': a.sem_orcamento, 'sem_painel': a.sem_painel, 'rotulo': a.rotulo, 'campo': json.loads(a.campo) if a.campo else None}
    feitos = {}
    with ThreadPoolExecutor(a.j) as pool:
        futs = [(c, pool.submit(caso, c, saida, refs, op)) for c in casos]
        for c, fu in futs:
            try:
                r = fu.result()
                feitos[c['id']] = r
                s = r['sim']['forma']
                txt = f"{c['id']:22s} {r['chuffs']:5.2f}/s · ataque {s['ataque']:.0f} · decai {s['decaimento']:.0f} ms · p/v {s['pv']:.1f} dB · vale/pico {s['valePico']:.2f}"
                if 'comparacao' in r:
                    d = r['comparacao']['distancias']; e = r['comparacao']['defeitos']
                    txt += f" · total {d['total']:.2f} · ar {e['ar']:.2f} · tom {e['tom']:.2f} · pulso {e['pulso']:.2f}"
                if r.get('continuas_dBA') is not None:
                    txt += f" · contínuas {r['continuas_dBA']:.2f} dB"
                print(txt, flush=True)
            except Exception as ex:  # (um caso que falha não derruba os outros)
                print(f"{c['id']:22s} FALHOU: {ex}", flush=True)
    res = []
    for c in todos:
        if c['id'] in feitos:
            res.append(feitos[c['id']])
        else:
            try:
                with open(os.path.join(saida, c['id'], 'caso.json')) as fh:
                    res.append(json.load(fh))
            except (OSError, ValueError):
                pass
    with open(os.path.join(saida, 'resumo.json'), 'w') as fh:
        json.dump(nu.limpar(res), fh, ensure_ascii=False, indent=1)
    with open(os.path.join(saida, 'resumo.md'), 'w') as fh:
        fh.write(tabela(res, a.rotulo))
    print(f'\ngravado em {saida}: resumo.md, resumo.json e uma pasta por caso')


if __name__ == '__main__':
    main()
