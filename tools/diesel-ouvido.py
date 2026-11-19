#!/usr/bin/env python3
"""diesel-ouvido.py — a régua do Diesel com o kit ouvido (tools/ouvido/): renderiza cada caso de `diesel-ouvido.json`
na condição da gravação casada, compara (painel, HNR, leito, modulação, defeitos), faz o orçamento de ruído por fonte
com a mesma semente e, nos casos de transitório, mede quanto o turbo sobe o nível enquanto enche.

    python3 -I tools/diesel-ouvido.py [--casos tools/diesel-ouvido.json] [--saida PASTA] [--so id,id] [--j 16]
                                      [--sem-orcamento] [--sem-painel] [--rotulo "ANTES"] [--campo JSON]

Sai em PASTA/<id>/: os WAVs (`<id>_tudo.wav`, `_so-<fonte>.wav`, `_sem-<fonte>.wav`, `_semente2.wav`), `cmp/painel.png`,
`cmp/resumo.txt`, `cmp/medidas.json`, `<id>_orcamento.{txt,json,png}`, `transitorio.{png,json}`; e em PASTA:
`resumo.md` e `resumo.json` (tabela de todos os casos). As gravações ficam em `referencias/diesel/` do checkout
principal (fora do git; `--referencias` aponta outra pasta) e PASTA por padrão é `referencias/_sim/diesel/atual/`.

Campos de um caso (`diesel-ouvido.json`):
  id, preset, titulo, ouvinte (ext|int|bay|pipe)
  rpm, comb (0–1; ausente = o que zera o torque líquido: lenta ou motor em vazio), dur
  degrau: [c0, c1, t]   transitório de enchimento do turbo com o giro travado (ver tools/diesel-ouvido-render.ts)
  cenario, de, ate      transitório de giro livre (locomotiva subindo de notch)
  real, trecho [a, b], rpmReal, ev, voltas, fmin, fmax, casada (false = a gravação é de outro motor ou de carga
                        desconhecida: vale como faixa, não como alvo linha a linha)
  criterios: false      tira o caso da conta dos critérios (gravação só indicativa)

Critérios (docs/PLANO.md, viés "mais motor, menos ar", e a régua do tools/ouvido/README.md), por caso casado:
  ar ≤ 0,6 · leito do simulado ≤ leito da gravação em toda banda de 400 Hz a 6 kHz · pulso a menos ≤ 1,3 ·
  tom a menos ≤ 2,4 · desligar as fontes de ar contínuas muda o nível ponderado A em < 1,5 dB (lenta e carga parcial) ·
  modulação na ignição (1–6 kHz) ≥ a da gravação na lenta · ordens baixas a ±3 dB · transitório: o turbo largo sobe o
  total ponderado A em ≤ 1 dB.
"""
import argparse
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import numpy as np

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, os.path.join(AQUI, 'ouvido'))
import nucleo as nu  # noqa: E402
import comparar as cp  # noqa: E402
import orcamento as orc  # noqa: E402

AR = ['jato', 'valvula', 'chiadoAdm', 'sopro', 'turbina', 'wastegate', 'fundo']
AR_CONTINUO = ['jato', 'chiadoAdm', 'sopro', 'turbina', 'wastegate', 'fundo']   # (o jato da válvula é rajada colada à abertura)
NA_REDE = ['valvula', 'turbina', 'variacao', 'ar', 'arContinuo', 'turbo', 'turboLargo']
FONTES = AR + ['apito', 'batida', 'chocalho', 'saia', 'tiques', 'valvulas', 'cliques', 'admissao', 'vib', 'variacao']
TURBO = ['sopro', 'turbina', 'wastegate', 'apito']
ESTOCASTICAS = AR + ['chocalho', 'tiques', 'valvulas', 'cliques']


def principal():
    try:
        comum = subprocess.run(['git', '-C', RAIZ, 'rev-parse', '--path-format=absolute', '--git-common-dir'], capture_output=True, text=True, check=True).stdout.strip()
        return os.path.dirname(comum)
    except (subprocess.CalledProcessError, OSError):
        return RAIZ


def render(preset, saida, args):
    cmd = [os.path.join(RAIZ, 'node_modules', '.bin', 'tsx'), os.path.join(AQUI, 'diesel-ouvido-render.ts'), preset, saida] + [str(a) for a in args]
    r = subprocess.run(cmd, cwd=RAIZ, capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(saida):
        raise RuntimeError(f'render falhou: {" ".join(cmd)}\n{r.stdout}\n{r.stderr}')
    with open(saida[:-4] + '.json') as fh:
        return json.load(fh)


def args_base(c, campo):
    a = ['--ouvinte', c.get('ouvinte', 'ext'), '--dur', c.get('dur', 10)]
    cm = dict(c.get('campo') or {}); cm.update(campo or {})
    if cm:
        a += ['--campo', json.dumps(cm)]
    if c.get('cenario'):
        a += ['--cenario', c['cenario']]
        if 'de' in c: a += ['--de', c['de']]
        if 'ate' in c: a += ['--ate', c['ate']]
    else:
        a += ['--rpm', c['rpm']]
        if c.get('agua') is not None: a += ['--agua', c['agua']]
        if c.get('degrau'): a += ['--degrau', ','.join(str(v) for v in c['degrau'])]
    return a


def pot_a_tempo(x, fs, jan=0.25, salto=0.125, fmin=0.0):
    """Nível ponderado A (e a potência acima de `fmin`) em janelas curtas. Devolve (t, dBA, dB_acima)."""
    n = int(jan * fs); h = int(salto * fs)
    w = np.hanning(n)
    f = np.fft.rfftfreq(n, 1 / fs)
    A = nu.ponderacao_a(f)
    t, la, lh = [], [], []
    for i in range(0, len(x) - n + 1, h):
        S = np.abs(np.fft.rfft(x[i:i + n] * w)) ** 2
        t.append((i + n / 2) / fs)
        la.append(float(nu.db10((S * A).sum() + 1e-30)))
        lh.append(float(nu.db10(S[f >= fmin].sum() + 1e-30)))
    return np.array(t), np.array(la), np.array(lh)


def transitorio(c, pasta, base, campo, pool, painel=True):
    """Transitório de enchimento do turbo: o mesmo render com o turbo inteiro, sem a banda larga do turbo (sopro,
    turbina, wastegate), sem o turbo todo e sem as fontes de ar; nível ponderado A e acima de 1 kHz ao longo do tempo."""
    arq = lambda s: os.path.join(pasta, f"{c['id']}_{s}.wav")
    conj = {'tudo': [], 'sem-turboLargo': ['--sem', 'turboLargo'], 'sem-turbo': ['--sem', 'turbo'], 'sem-ar': ['--sem', 'ar']}
    futs = {k: pool.submit(render, c['preset'], arq(k), base + v) for k, v in conj.items()}
    info = {k: f.result() for k, f in futs.items()}
    x = {k: nu.ler_audio(arq(k))[0] for k in conj}
    fs = nu.FS
    ser = {k: pot_a_tempo(x[k], fs, fmin=1000.0) for k in conj}
    t = ser['tudo'][0]
    tele = info['tudo']['tele']
    tt = np.array([e['t'] for e in tele]); tw = np.array([e['turbo'] for e in tele]); bo = np.array([e['boost'] for e in tele]); rp = np.array([e['rpm'] for e in tele])
    t0 = c['degrau'][2] if c.get('degrau') else 0.0
    dep = t >= t0
    dA_largo = ser['tudo'][1] - ser['sem-turboLargo'][1]
    dA_turbo = ser['tudo'][1] - ser['sem-turbo'][1]
    dH_largo = ser['tudo'][2] - ser['sem-turboLargo'][2]
    dA_ar = ser['tudo'][1] - ser['sem-ar'][1]
    # degrau de chiado: quanto o nível acima de 1 kHz sobe do começo do transitório ao turbo cheio, com e sem o turbo
    ini = (t >= t0 + 0.1) & (t < t0 + 0.6); fim = t >= t[-1] - 1.5
    sobe = lambda k, j: float(np.mean(ser[k][j][fim]) - np.mean(ser[k][j][ini])) if ini.any() else float('nan')
    # o apito como componente estreito: proeminência do tom sobre a mediana local no último 1,5 s
    f, P = nu.psd_welch(x['tudo'][-int(1.5 * fs):], fs, 8192)
    Ld = nu.db10(P)
    from scipy import ndimage
    med = ndimage.median_filter(Ld, size=81, mode='nearest')
    m = (f >= 1500) & (f <= 16000)
    j = int(np.argmax(np.where(m, Ld - med, -99)))
    # nível do tom relativo à banda das ordens (150–400 Hz), como no índice do acervo: potência em ±2% do pico ÷ potência da banda
    viz = (f >= 0.98 * f[j]) & (f <= 1.02 * f[j])
    tom_rel = float(nu.db10(P[viz].sum() / max(P[(f >= 150) & (f < 400)].sum(), 1e-30)))
    r = {'id': c['id'], 'preset': c['preset'], 'titulo': c.get('titulo', c['id']), 't0': t0,
         'turbo_ini': float(np.interp(t0, tt, tw)), 'turbo_fim': float(tw[-1]), 'boost_fim_bar': float(bo[-1]), 'rpm_ini': float(rp[0]), 'rpm_fim': float(rp[-1]),
         'dA_turboLargo_max': float(dA_largo[dep].max()), 'dA_turboLargo_fim': float(np.mean(dA_largo[fim])),
         'dA_turbo_max': float(dA_turbo[dep].max()), 'dA_turbo_fim': float(np.mean(dA_turbo[fim])),
         'd1k_turboLargo_max': float(dH_largo[dep].max()), 'd1k_turboLargo_fim': float(np.mean(dH_largo[fim])),
         'dA_ar_max': float(dA_ar[dep].max()), 'dA_ar_fim': float(np.mean(dA_ar[fim])),
         'sobe_A_com': sobe('tudo', 1), 'sobe_A_sem_turbo': sobe('sem-turbo', 1), 'sobe_1k_com': sobe('tudo', 2), 'sobe_1k_sem_turboLargo': sobe('sem-turboLargo', 2),
         'apito_hz': float(f[j]), 'apito_proeminencia_db': float((Ld - med)[j]), 'apito_rel_150_400_db': tom_rel}
    with open(os.path.join(pasta, 'transitorio.json'), 'w') as fh:
        json.dump(r, fh, ensure_ascii=False, indent=1)
    if painel:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        from scipy import signal
        fundo, tinta, cinza = '#fcfcfb', '#0b0b0b', '#8b8a84'
        fig, ax = plt.subplots(4, 1, figsize=(11, 12), facecolor=fundo, gridspec_kw={'height_ratios': [1.1, 1.1, 0.8, 2.2]})
        ref = np.max(ser['tudo'][1])
        ax[0].plot(t, ser['tudo'][1] - ref, color='#eb6834', lw=1.8, label='tudo')
        ax[0].plot(t, ser['sem-turboLargo'][1] - ref, color='#2a78d6', lw=1.3, label='sem a banda larga do turbo (sopro, turbina, wastegate)')
        ax[0].plot(t, ser['sem-turbo'][1] - ref, color=tinta, lw=1.0, ls='--', label='sem o turbo todo (também sem o apito)')
        ax[0].plot(t, ser['sem-ar'][1] - ref, color=cinza, lw=1.0, ls=':', label='sem as fontes de ar')
        ax[0].set_ylabel('nível ponderado A (dB re máx.)'); ax[0].legend(fontsize=8, loc='lower right', frameon=False)
        ref2 = np.max(ser['tudo'][2])
        ax[1].plot(t, ser['tudo'][2] - ref2, color='#eb6834', lw=1.8, label='tudo')
        ax[1].plot(t, ser['sem-turboLargo'][2] - ref2, color='#2a78d6', lw=1.3, label='sem a banda larga do turbo')
        ax[1].plot(t, ser['sem-ar'][2] - ref2, color=cinza, lw=1.0, ls=':', label='sem as fontes de ar')
        ax[1].set_ylabel('nível acima de 1 kHz (dB re máx.)'); ax[1].legend(fontsize=8, loc='lower right', frameon=False)
        ax[2].plot(tt, tw, color=tinta, lw=1.5, label='rotação do turbo (fração da máxima)')
        ax[2].plot(tt, bo / max(bo.max(), 1e-9), color='#2a78d6', lw=1.2, label=f'pressão do turbo (÷ {bo.max():.2f} bar)')
        ax[2].plot(tt, rp / max(rp.max(), 1e-9), color=cinza, lw=1.0, ls='--', label=f'rotação do motor (÷ {rp.max():.0f} rpm)')
        ax[2].set_ylim(0, 1.1); ax[2].legend(fontsize=8, loc='lower right', frameon=False)
        fq, tq, S = signal.spectrogram(x['tudo'], fs, nperseg=2048, noverlap=1536, window='hann')
        Sd = nu.db10(S + 1e-30); Sd -= Sd.max()
        ax[3].pcolormesh(tq, fq, Sd, vmin=-85, vmax=-15, cmap='Greys', shading='auto', rasterized=True)
        ax[3].set_ylim(0, 14000); ax[3].set_ylabel('Hz (espectrograma do render completo)'); ax[3].set_xlabel('s')
        for a in ax[:3]:
            a.axvline(t0, color=cinza, lw=0.8); a.grid(color='#dddcd6', lw=0.5); a.set_xlim(0, t[-1] + 0.125); a.set_facecolor(fundo)
        fig.suptitle(f"{r['titulo']}\nturbo {r['turbo_ini']:.2f} → {r['turbo_fim']:.2f} · a banda larga do turbo sobe o total ponderado A em até {r['dA_turboLargo_max']:.1f} dB "
                     f"(no fim {r['dA_turboLargo_fim']:.1f}) e o que há acima de 1 kHz em até {r['d1k_turboLargo_max']:.1f} dB · apito {r['apito_hz']:.0f} Hz, {r['apito_proeminencia_db']:.0f} dB sobre o piso, {r['apito_rel_150_400_db']:.0f} dB re 150–400 Hz",
                     fontsize=10, color=tinta, x=0.02, ha='left')
        fig.tight_layout(rect=(0, 0, 1, 0.96))
        fig.savefig(os.path.join(pasta, 'transitorio.png'), dpi=90, facecolor=fundo)
        plt.close(fig)
    return r


def caso(c, saida, refs, op, pool):
    pasta = os.path.join(saida, c['id'])
    os.makedirs(pasta, exist_ok=True)
    base = args_base(c, op['campo'])
    if c.get('degrau') or c.get('cenario'):
        out = {'id': c['id'], 'tipo': 'transitorio', 'transitorio': transitorio(c, pasta, base, op['campo'], pool, not op['sem_painel'])}
        with open(os.path.join(pasta, 'caso.json'), 'w') as fh:
            json.dump(nu.limpar(out), fh, ensure_ascii=False, indent=1)
        return out
    pref = c['id']
    arq = lambda s: os.path.join(pasta, f'{pref}_{s}.wav')
    extra = ['--comb', c['comb']] if c.get('comb') is not None else []
    info = render(c['preset'], arq('tudo'), base + extra)
    out = {'id': c['id'], 'tipo': 'regime', 'preset': c['preset'], 'titulo': c.get('titulo', c['id']), 'info': {k: info[k] for k in ('rpm', 'f0', 'comb', 'turbo', 'boostBar', 'lambda', 'dpdth', 'pMaxBar', 'pico', 'ouvinte', 'eventosPorCiclo', 'voltasPorCiclo')}}
    voltas = float(info['voltasPorCiclo'])
    # ---- orçamento de ruído: uma fonte desligada por vez, com o combustível do render completo e a mesma semente
    if not op['sem_orcamento'] and c.get('orcamento', True):
        fixo = base + ['--comb', repr(info['comb'])]
        turbo = info['turbo'] > 0
        lista = [f for f in FONTES if turbo or f not in TURBO] + ['ar'] + (['turbo', 'turboLargo'] if turbo else [])
        futs = {f: pool.submit(render, c['preset'], arq('sem-' + f), fixo + ['--sem', f]) for f in lista}
        futs['arContinuo'] = pool.submit(render, c['preset'], arq('sem-arContinuo'), fixo + ['--sem', ','.join(AR_CONTINUO)])
        futs['semente2'] = pool.submit(render, c['preset'], arq('semente2'), fixo + ['--semente', 987654321])
        for f in futs.values():
            f.result()
        x0 = nu.ler_audio(arq('tudo'))[0]
        for f in lista + ['arContinuo']:
            if f in NA_REDE:
                continue
            xs = nu.ler_audio(arq('sem-' + f))[0]
            n = min(len(x0), len(xs))
            nu.gravar_wav(arq('so-' + f), x0[:n] - xs[:n])
            os.remove(arq('sem-' + f)); os.remove(arq('sem-' + f)[:-4] + '.json')
        r = orc.orcamento(pasta, pref, None, None, None, NA_REDE, voltas)
        txt = orc.texto(r)
        with open(os.path.join(pasta, pref + '_orcamento.txt'), 'w') as fh:
            fh.write(txt + '\n')
        with open(os.path.join(pasta, pref + '_orcamento.json'), 'w') as fh:
            json.dump(nu.limpar(r), fh, ensure_ascii=False, indent=1)
        if not op['sem_painel']:
            orc.figura(r, os.path.join(pasta, pref + '_orcamento.png'))
        fo = r['fontes']
        queda = lambda k: float(-nu.db10(max(1 - fo[k]['efeito']['A_frac'], 1e-6))) if k in fo else 0.0
        dom = []
        for i, b in enumerate(nu.NOMES[:6]):
            k = max((f for f in fo if f in FONTES), key=lambda f: fo[f]['bandas_frac'][i])
            dom.append({'banda': b, 'fonte': k, 'frac': fo[k]['bandas_frac'][i], 'estocastica': k in ESTOCASTICAS, 'ar': k in AR})
        out['orcamento'] = {'A_frac': {k: fo[k]['A_frac'] for k in fo}, 'bandas_frac': {k: fo[k]['bandas_frac'] for k in fo}, 'vao_1_6k': {k: fo[k]['vao_1_6k'] for k in fo},
                            'queda_ar_dBA': queda('ar'), 'queda_arContinuo_dBA': queda('arContinuo'), 'queda_turbo_dBA': queda('turbo'), 'queda_turboLargo_dBA': queda('turboLargo'),
                            'estocastico_A': r.get('estocastico', {}).get('A_frac'), 'estocastico_bandas': r.get('estocastico', {}).get('bandas_frac'),
                            'dominante': dom, 'vao_1_6k_db': r['total']['vao_1_6k_db'], 'p90_p10_1_6k': r['total']['p90_p10_1_6k']}
    # ---- comparação com a gravação casada
    if c.get('real'):
        real = os.path.join(refs, c['real'])
        f0r = c['rpmReal'] / 60.0 / voltas if c.get('rpmReal') else None
        tit = f"{op['rotulo']} · {c.get('titulo', c['id'])}"
        res = cp.executar(real, arq('tudo'), os.path.join(pasta, 'cmp'), f0r, None, c.get('ev') or info['eventosPorCiclo'], voltas, False, True, c.get('trecho'), None,
                          'media', 'media', 'auto', cp.PESOS, c.get('fmin', 4.0), c.get('fmax', 60.0), c.get('folga', 0.08), 0.5, 100, tit, not op['sem_painel'])
        R, S, comp = res['real']['med'], res['sim']['med'], res['comp']
        ev = S['ev']
        def ordens(m):   # potência das três primeiras ordens de queima relativa ao total (dB)
            sep = m['_sep']; tot = max(float(sep['P'].sum()), 1e-30)
            return [float(nu.db10(max(sep['harm'][k * m['ev']], 1e-30) / tot)) if k * m['ev'] < len(sep['harm']) else None for k in (1, 2, 3)]
        bandas = []
        for i, nome in enumerate(nu.NOMES):
            br, bs = R['bandas'][i], S['bandas'][i]
            bandas.append({'banda': nome, 'hnr': [br['hnr'], bs['hnr']], 'leito': [cp.leito_frac(br), cp.leito_frac(bs)], 'nivel': [comp['_relR'][i]['nivel'], comp['_relS'][i]['nivel']],
                           'linhas': [comp['_relR'][i]['harm'], comp['_relS'][i]['harm']], 'm_ign': [br.get('m_ign'), bs.get('m_ign')], 'p90_p10': [br['p90_p10'], bs['p90_p10']]})
        g = lambda m, k: m['faixa_1_6k'].get(k)
        out['comparacao'] = {'real': c['real'], 'trecho': c.get('trecho'), 'casada': c.get('casada', True), 'rpm_real': R['rpm'], 'rpm_sim': S['rpm'], 'avisos': comp['avisos'],
                             'distancias': comp['distancias'], 'defeitos': comp['defeitos'], 'resumo': [r_['texto'] for r_ in comp['resumo']], 'bandas': bandas,
                             'faixa_1_6k': {k: [g(R, k), g(S, k)] for k in ('m_ign', 'm_ciclo', 'm_rot', 'frac_ciclo', 'p90_p10', 'vao', 'cv_evento', 'curtose_mediana')},
                             'leito_1_6k': [cp.leito_frac(R['faixa_1_6k']), cp.leito_frac(S['faixa_1_6k'])],
                             'grave_cv': [R['grave'].get('cv_evento'), S['grave'].get('cv_evento')], 'grave_desigualdade': [R['grave'].get('desigualdade'), S['grave'].get('desigualdade')],
                             'ordens_queima_db': [ordens(R), ordens(S)], 'fracao_harmonica': [R['fracao_harmonica'], S['fracao_harmonica']]}
    with open(os.path.join(pasta, 'caso.json'), 'w') as fh:
        json.dump(nu.limpar(out), fh, ensure_ascii=False, indent=1)
    return out


def f(v, p=1, s=False):
    if v is None or (isinstance(v, float) and not np.isfinite(v)):
        return '—'
    return (f'{v:+.{p}f}' if s else f'{v:.{p}f}').replace('.', ',').replace('-', '−')


def tabela(res, rotulo):
    L = [f'# Régua do Diesel ({rotulo})', '',
         'Gerado por `tools/diesel-ouvido.py`. Em cada célula "gravação / simulado". HNR em dB (linhas do motor ÷ ruído entre elas); leito = fração da banda que é chiado contínuo, presente até entre as explosões; '
         'm ign = profundidade da modulação da envoltória de 1–6 kHz na frequência de queima; ordens = potência das três primeiras ordens de queima relativa ao total.', '']
    reg = [r for r in res if r['tipo'] == 'regime' and 'comparacao' in r]
    L += ['## Distâncias e defeitos (régua dos aprovados: total ≤ 2,2 · ar ≤ 0,6 · tom a menos ≤ 2,4 · pulso a menos ≤ 1,3)', '',
          '| caso | rpm real / sim | tonal | piso | envoltória | modulação | eventos | **total** | **ar** | tom a menos | pulso a menos |', '|---|---|---|---|---|---|---|---|---|---|---|']
    for r in reg:
        c = r['comparacao']; d = c['distancias']; e = c['defeitos']
        L.append(f"| {r['titulo']}{'' if c['casada'] else ' *(faixa)*'} | {c['rpm_real']:.0f} / {c['rpm_sim']:.0f} | {f(d['tonal'], 2)} | {f(d['piso'], 2)} | {f(d['envoltoria'], 2)} | {f(d['modulacao'], 2)} | {f(d['eventos'], 2)} | **{f(d['total'], 2)}** | **{f(e['ar'], 2)}** | {f(e['tom'], 2)} | {f(e['pulso'], 2)} |")
    L += ['', '## HNR por banda (dB)', '', '| caso | 60–150 | 150–400 | 400–1k | 1–2,5k | 2,5–6k |', '|---|---|---|---|---|---|']
    for r in reg:
        b = r['comparacao']['bandas']
        L.append(f"| {r['titulo']} | " + ' | '.join(f"{f(b[i]['hnr'][0], 0)} / {f(b[i]['hnr'][1], 0)}" for i in (1, 2, 3, 4, 5)) + ' |')
    L += ['', '## Leito de ruído contínuo (% da banda), modulação e envoltória de 1–6 kHz', '',
          '| caso | leito 400–1k | 1–2,5k | 2,5–6k | 1–6 kHz | m ign | fração presa ao ciclo | p90/p10 (dB) | CV entre explosões (1–6 kHz) |', '|---|---|---|---|---|---|---|---|---|']
    for r in reg:
        c = r['comparacao']; b = c['bandas']; g = c['faixa_1_6k']
        pc = lambda v: '—' if v is None or not np.isfinite(v) else f'{100 * v:.0f}'
        L.append(f"| {r['titulo']} | " + ' | '.join(f"{pc(b[i]['leito'][0])} / {pc(b[i]['leito'][1])}" for i in (3, 4, 5)) + f" | {pc(c['leito_1_6k'][0])} / {pc(c['leito_1_6k'][1])} | {f(g['m_ign'][0], 2)} / {f(g['m_ign'][1], 2)} | "
                 f"{f(g['frac_ciclo'][0], 2)} / {f(g['frac_ciclo'][1], 2)} | {f(g['p90_p10'][0])} / {f(g['p90_p10'][1])} | {f(g['cv_evento'][0], 2)} / {f(g['cv_evento'][1], 2)} |")
    L += ['', '## Linhas do motor por banda (dB re 150–400 Hz) e as três primeiras ordens de queima (dB re total)', '',
          '| caso | linhas 60–150 | 400–1k | 1–2,5k | 2,5–6k | 1ª ordem | 2ª | 3ª | CV no grave |', '|---|---|---|---|---|---|---|---|---|']
    for r in reg:
        c = r['comparacao']; b = c['bandas']; o = c['ordens_queima_db']
        L.append(f"| {r['titulo']} | " + ' | '.join(f"{f(b[i]['linhas'][0], 0, True)} / {f(b[i]['linhas'][1], 0, True)}" for i in (1, 3, 4, 5)) + ' | '
                 + ' | '.join(f"{f(o[0][k], 0, True)} / {f(o[1][k], 0, True)}" for k in range(3)) + f" | {f(c['grave_cv'][0], 2)} / {f(c['grave_cv'][1], 2)} |")
    orcs = [r for r in res if r['tipo'] == 'regime' and 'orcamento' in r]
    if orcs:
        L += ['', '## Orçamento de ruído (mesma semente, uma fonte desligada por vez)', '',
              'Fração da potência ponderada A de cada fonte de ar (%), o que desligar todas muda no nível ponderado A, a fração estocástica (duas sementes) e a fonte que mais pesa em cada banda '
              '(**negrito** = fonte de ar; *itálico* = rajada de ruído colada ao evento).', '',
              '| caso | jato | válvula | chiado adm. | sopro | turbina | wastegate | fundo | desligar o ar (dB A) | só o ar contínuo | estocástico (A) | 150–400 | 400–1k | 1–2,5k | 2,5–6k |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|']
        for r in orcs:
            o = r['orcamento']; a = o['A_frac']
            pc = lambda k: '·' if a.get(k, 0) < 0.005 else f'{100 * a[k]:.0f}'
            dm = lambda d: (f"**{d['fonte']}**" if d['ar'] else f"*{d['fonte']}*" if d['estocastica'] else d['fonte']) + f" {100 * d['frac']:.0f}%"
            est = '—' if o['estocastico_A'] is None else f"{100 * o['estocastico_A']:.0f}%"
            L.append(f"| {r['titulo']} | " + ' | '.join(pc(k) for k in AR) + f" | {f(-o['queda_ar_dBA'], 2)} | {f(-o['queda_arContinuo_dBA'], 2)} | {est} | "
                     + ' | '.join(dm(o['dominante'][i]) for i in (2, 3, 4, 5)) + ' |')
    tr = [r['transitorio'] for r in res if r['tipo'] == 'transitorio']
    if tr:
        L += ['', '## Transitório de enchimento do turbo', '',
              'O mesmo render com o turbo inteiro, sem a banda larga do turbo (sopro do compressor, turbina, wastegate) e sem o turbo todo. "Sobe o total" = diferença do nível ponderado A entre os dois, a pior janela de 0,25 s depois do degrau.', '',
              '| caso | turbo (fração) | a banda larga do turbo sobe o total A (máx. / fim) | sobe o que há acima de 1 kHz (máx. / fim) | o turbo todo (com o apito) sobe o total A | degrau acima de 1 kHz com / sem a banda larga | apito |', '|---|---|---|---|---|---|---|']
        for t in tr:
            L.append(f"| {t['titulo']} | {f(t['turbo_ini'], 2)} → {f(t['turbo_fim'], 2)} | {f(t['dA_turboLargo_max'], 2)} / {f(t['dA_turboLargo_fim'], 2)} dB | {f(t['d1k_turboLargo_max'], 1)} / {f(t['d1k_turboLargo_fim'], 1)} dB | "
                     f"{f(t['dA_turbo_max'], 2)} / {f(t['dA_turbo_fim'], 2)} dB | {f(t['sobe_1k_com'], 1, True)} / {f(t['sobe_1k_sem_turboLargo'], 1, True)} dB | {t['apito_hz']:.0f} Hz, {f(t['apito_proeminencia_db'], 0)} dB sobre o piso, {f(t.get('apito_rel_150_400_db'), 0)} dB re 150–400 Hz |")
    return '\n'.join(L) + '\n'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--casos', default=os.path.join(AQUI, 'diesel-ouvido.json'))
    ap.add_argument('--saida'); ap.add_argument('--referencias')
    ap.add_argument('--so'); ap.add_argument('--j', type=int, default=max(2, (os.cpu_count() or 4) - 4))
    ap.add_argument('--sem-orcamento', action='store_true'); ap.add_argument('--sem-painel', action='store_true')
    ap.add_argument('--rotulo', default='atual'); ap.add_argument('--campo', help='JSON com campos de preset a mudar em todos os casos')
    a = ap.parse_args()
    raiz = principal()
    refs = a.referencias or os.path.join(raiz, 'referencias', 'diesel')
    saida = a.saida or os.path.join(raiz, 'referencias', '_sim', 'diesel', 'atual')
    os.makedirs(saida, exist_ok=True)
    with open(a.casos) as fh:
        casos = json.load(fh)['casos']
    todos = casos
    if a.so:
        so = a.so.split(',')
        casos = [c for c in casos if c['id'] in so or c['preset'] in so or any(c['id'].endswith('-' + x) for x in so)]
    op = {'sem_orcamento': a.sem_orcamento, 'sem_painel': a.sem_painel, 'rotulo': a.rotulo, 'campo': json.loads(a.campo) if a.campo else None}
    res = []
    with ThreadPoolExecutor(a.j) as pool, ThreadPoolExecutor(max(1, min(len(casos), 12))) as externo:
        futs = [(c, externo.submit(caso, c, saida, refs, op, pool)) for c in casos]
        for c, fu in futs:
            try:
                r = fu.result()
                res.append(r)
                if r['tipo'] == 'regime' and 'comparacao' in r:
                    d = r['comparacao']['distancias']; e = r['comparacao']['defeitos']
                    print(f"{c['id']:24s} total {d['total']:.2f} · ar {e['ar']:.2f} · tom a menos {e['tom']:.2f} · pulso a menos {e['pulso']:.2f}", flush=True)
                elif r['tipo'] == 'transitorio':
                    t = r['transitorio']
                    print(f"{c['id']:24s} turbo largo sobe o total A em até {t['dA_turboLargo_max']:.2f} dB (fim {t['dA_turboLargo_fim']:.2f}); acima de 1 kHz {t['d1k_turboLargo_max']:.1f} dB; apito {t['apito_hz']:.0f} Hz, {t['apito_proeminencia_db']:.0f} dB sobre o piso, {t['apito_rel_150_400_db']:.0f} dB re 150–400", flush=True)
                else:
                    print(f"{c['id']:24s} ok", flush=True)
            except Exception as ex:  # (um caso que falha não derruba os outros)
                print(f"{c['id']:24s} FALHOU: {ex}", flush=True)
    # os casos que não rodaram agora entram na tabela com o resultado que já está na pasta
    feitos = {r['id']: r for r in res}
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
    md = tabela(res, a.rotulo)
    with open(os.path.join(saida, 'resumo.md'), 'w') as fh:
        fh.write(md)
    print(f'\ngravado em {saida}: resumo.md, resumo.json e uma pasta por caso')


if __name__ == '__main__':
    main()
