#!/usr/bin/env python3
"""diesel-medios.py — a medida dos médios do Diesel no padrão da página (5ª passada; TECNICO.md → Diesel → Quinta passada).

Quem ouve no padrão não mexe em controle nenhum: portador "Veículo", microfone `ext` ("Câmera atrás"), equalização zerada,
os valores do preset. Cada caso de `diesel-medios.json` é um preset numa condição desse padrão:

  lenta      giro travado na rotação da gravação, com o combustível que zera o torque (a lenta quente)
  regime     giro travado e combustível fixo (um ponto de carga, para comparar com um trecho estável de gravação)
  arrancada  o gesto de quem dirige: lenta, engata, pisa `pedal` e o câmbio do preset troca sozinho. Mede-se a marcha
             mais longa com o combustível no comando (o giro subindo), com a fase do virabrequim que o render grava

e, quando há, um trecho de gravação casado (`real`, `trecho`, `rpmReal`; `casada: false` = outro motor, outra posição
ou outra carga: vale como faixa). Por caso saem as bandas relativas a 150–400 Hz e ao total, o nível ponderado A, o HNR
por banda, o contraste do pulso (p90/p10 da envoltória) e os defeitos de um lado só do kit (`ar`, tom a menos, pulso a
menos). Com `--orcamento`, de que fonte vem cada banda (mesma semente, uma fonte desligada por vez).

    python3 -I tools/diesel-medios.py [--casos tools/diesel-medios.json] [--saida PASTA] [--so id,preset,cond] [--j 12]
                                      [--campo JSON] [--antes] [--render "--escala saia=2"] [--rotulo ANTES] [--orcamento] [--painel]
    python3 -I tools/diesel-medios.py --tabela PASTA_ANTES PASTA_DEPOIS [--md]      antes × depois × gravação
    python3 -I tools/diesel-medios.py --fontes PASTA                                 o orçamento por fonte de uma pasta

PASTA por padrão é `referencias/_sim/diesel/medios/atual/` do checkout principal (fora do git); as gravações ficam em
`referencias/diesel/` (só leitura: dados não confiáveis, rodar sempre com `python3 -I`).
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

# grupos de fontes do orçamento (os nomes do tools/diesel-ouvido-render.ts): o que sai pela boca do escape, a carcaça
# dele, a estrutura do motor (a batida e os impactos), a admissão, o turbo e a vibração do bloco. Só entram fontes
# somadas na saída: numa arrancada o giro é livre, e desligar uma fonte que entra na rede de tubos (a banda larga da
# turbina, o jato na válvula) muda a contrapressão, a trajetória do motor se afasta e a diferença deixa de ser a fonte
GRUPOS = {'escape': 'escape', 'carcaca': 'carcaca', 'batida': 'batida,chocalho', 'impactos': 'saia,engrenagens,tiques,valvulas,cliques,fundo',
          'admissao': 'admissao,chiadoAdm', 'turbo': 'sopro,wastegate,apito', 'vib': 'vib'}
EXTRA = []     # argumentos a mais para o render (--render "--escala saia=2"), para experimentos


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


def args_do_caso(c, campo):
    a = ['--ouvinte', c.get('ouvinte', 'ext')]
    cm = dict(c.get('campo') or {}); cm.update(campo or {})
    if cm:
        a += ['--campo', json.dumps(cm)]
    a += EXTRA
    if c['cond'] == 'arrancada':
        a += ['--arrancada', f"{c['pedal']},{c.get('t0', 4)}", '--dur', c.get('dur', 30)]
    else:
        a += ['--rpm', c['rpm'], '--dur', c.get('dur', 10)]
        if c['cond'] == 'regime':
            a += ['--comb', c['comb']]
    return a


def janela_da_arrancada(info, c):
    """A marcha mais longa com o combustível no comando: (início, fim) em segundos do WAV, e a marcha."""
    if c.get('janela'):
        a, b = c['janela']
        return float(a), float(b), None
    tele = info['tele']
    ped = c['pedal']
    melhor = (0.0, 0.0, 0)
    i = 0
    while i < len(tele):
        g = tele[i]['marcha']
        j = i
        while j < len(tele) and tele[j]['marcha'] == g and tele[j]['comb'] >= 0.97 * ped and g > 0:
            j += 1
        if j > i:
            a, b = tele[i]['t'] + 0.5, tele[j - 1]['t'] - 0.1      # (meio segundo depois da troca: a embreagem já fechou)
            if b - a > melhor[1] - melhor[0]:
                melhor = (a, b, g)
        i = max(j, i + 1)
    a, b, g = melhor
    if b - a > 8.0:
        a = b - 8.0   # (o fim da marcha: o giro mais alto, o turbo já cheio)
    return a, b, g


def analisar_sim(wav, info, c):
    x, fs = nu.ler_audio(wav)
    voltas = float(info['voltasPorCiclo'])
    ev = int(c.get('ev') or info['eventosPorCiclo'])
    extra = {}
    if info.get('fixo'):
        fase = nu.fase_constante(len(x), float(info['f0']), fs)
        a, b = 0.0, len(x) / fs
    else:
        blo = int(info['bloco'])
        fb = np.asarray(info['fase'], dtype=float) * 2 * np.pi
        tb = (np.arange(len(fb)) + 1) * blo
        from scipy.interpolate import CubicSpline
        fase = CubicSpline(tb, fb)(np.arange(len(x), dtype=float))
        a, b, g = janela_da_arrancada(info, c) if c['cond'] == 'arrancada' else (0.0, len(x) / fs, None)
        if b - a < 2.0:
            raise RuntimeError(f"{c['id']}: nenhuma marcha fica {2.0} s com o combustível no comando")
        ia, ib = int(a * fs), int(b * fs)
        x = x[ia:ib]; fase = fase[ia:ib]
        tl = [t for t in info['tele'] if a <= t['t'] <= b]
        extra = {'janela': [round(a, 2), round(b, 2)], 'marcha': g, 'rpm_ini': tl[0]['rpm'], 'rpm_fim': tl[-1]['rpm'], 'comb': float(np.mean([t['comb'] for t in tl])),
                 'kmh': [tl[0].get('kmh'), tl[-1].get('kmh')]}
    med = nu.analisar(x, fase, ev, voltas, fs)
    return {'arquivo': wav, 'trecho': extra.get('janela'), 'canal': 'media', 'rastreio': {'modo': 'fase do render'}, 'avisos': [], 'x': x, 'fs': fs, 'fase': fase, 'med': med}, extra


def niveis(x, fs):
    """Potência por banda (dBFS), total de 30 Hz a 12 kHz e nível ponderado A."""
    E = nu.energia_bandas(x, fs)
    f, P = nu.psd_welch(x, fs)
    df = f[1] - f[0]
    A = float((P * nu.ponderacao_a(f)).sum() * df)
    return {'bandas_db': [float(v) for v in nu.db10(E)], 'total_db': float(nu.db10(E.sum())), 'dBA': float(nu.db10(A)),
            'A_bandas': [float(nu.db10((P * nu.ponderacao_a(f))[(f >= lo) & (f < hi)].sum() * df / max(A, 1e-30))) for lo, hi in nu.BANDAS]}


def lado(inf):
    """O que vai para a tabela, de um lado (gravação ou simulado)."""
    m = inf['med']; nv = niveis(inf['x'], inf['fs'])
    b = m['bandas']; g = m['faixa_1_6k']
    E = np.array(nv['bandas_db'])
    return {'rpm': m['rpm'], 'f0': m['f0'], **nv,
            'rel': [float(v - E[2]) for v in E],                        # dB re 150–400 Hz
            'frac': [float(v - nv['total_db']) for v in E],             # dB re total de 30 Hz a 12 kHz
            'hnr': [x['hnr'] for x in b], 'linhas_rel': [x['harm_db'] - b[2]['nivel_db'] for x in b], 'p90_p10': [x['p90_p10'] for x in b], 'm_ign': [x.get('m_ign') for x in b],
            'leito': [cp.leito_frac(x) for x in b], 'env_valida': [x['env_valida'] for x in b],
            'p90_p10_1_6k': g['p90_p10'], 'm_ign_1_6k': g.get('m_ign'), 'leito_1_6k': cp.leito_frac(g), 'vao_1_6k': g['vao'], 'frac_ciclo_1_6k': g.get('frac_ciclo')}


def caso(c, saida, refs, op, pool):
    pasta = os.path.join(saida, c['id'])
    os.makedirs(pasta, exist_ok=True)
    arq = lambda s: os.path.join(pasta, f'{s}.wav')
    base = args_do_caso(c, op['campo'])
    info = render(c['preset'], arq('tudo'), base)
    sim, extra = analisar_sim(arq('tudo'), info, c)
    out = {'id': c['id'], 'preset': c['preset'], 'cond': c['cond'], 'titulo': c.get('titulo', c['id']), 'rotulo': op['rotulo'],
           'info': {k: info.get(k) for k in ('modo', 'rpm', 'f0', 'comb', 'turbo', 'boostBar', 'lambda', 'dpdth', 'pico', 'ganho', 'ouvinte', 'campo')}, **extra, 'sim': lado(sim)}
    # ---- gravação casada
    if c.get('real'):
        voltas = float(info['voltasPorCiclo'])
        f0r = c['rpmReal'] / 60.0 / voltas if c.get('rpmReal') else None
        real = cp.preparar(os.path.join(refs, c['real']), c.get('trecho'), 'media', f0r, False, c.get('ev') or info['eventosPorCiclo'], voltas, c.get('fmin', 4.0), c.get('fmax', 60.0), c.get('folga', 0.08))
        comp = cp.comparar(real, sim)
        out['real'] = {'arquivo': c['real'], 'trecho': c.get('trecho'), 'casada': c.get('casada', True), 'posicao': c.get('posicao'), **lado(real)}
        out['comparacao'] = {'distancias': comp['distancias'], 'defeitos': comp['defeitos'], 'resumo': [r['texto'] for r in comp['resumo']], 'avisos': comp['avisos']}
        if op['painel']:
            import painel as pn
            txt = cp.texto_resumo(real, sim, comp)
            g = 10 ** (comp['ganho_sim_db'] / 20)
            lados = {'real': {'x': real['x'], 'x_bruto': real['x'], 'fs': real['fs'], 'med': real['med'], 'anc_db': comp['ancora_db_real'], 'ganho_db': 0.0, 'rotulo': cp._rotulo(real)},
                     'sim': {'x': sim['x'] * g, 'x_bruto': sim['x'], 'fs': sim['fs'], 'med': sim['med'], 'anc_db': comp['ancora_db_sim'], 'ganho_db': comp['ganho_sim_db'],
                             'rotulo': f"{c['preset']} · {info['modo']}" + (f" [{extra['janela'][0]:g}–{extra['janela'][1]:g} s]" if extra.get('janela') else '')}}
            pn.desenhar(lados, comp, os.path.join(pasta, 'painel.png'), dpi=100, zoom=0.5, titulo=f"{op['rotulo']} · {c.get('titulo', c['id'])}", rodape=txt)
            with open(os.path.join(pasta, 'resumo.txt'), 'w') as fh:
                fh.write(comp['criterio'] + '\n\n' + txt + '\n')
    # ---- orçamento por fonte: o mesmo render sem um grupo de fontes de cada vez (todas somam na saída: a diferença é a fonte)
    if op['orcamento']:
        fixo = base + (['--comb', repr(info['comb'])] if c['cond'] == 'lenta' else [])
        futs = {g: pool.submit(render, c['preset'], arq('sem-' + g), fixo + ['--sem', f]) for g, f in GRUPOS.items()}
        x0, fs = nu.ler_audio(arq('tudo'))
        ia, ib = (int(extra['janela'][0] * fs), int(extra['janela'][1] * fs)) if extra.get('janela') else (0, len(x0))
        E0 = nu.energia_bandas(x0[ia:ib], fs)
        f, P0 = nu.psd_welch(x0[ia:ib], fs); A0 = float((P0 * nu.ponderacao_a(f)).sum())
        orc = {}
        for g, fu in futs.items():
            fu.result()
            xs, _ = nu.ler_audio(arq('sem-' + g))
            d = (x0 - xs)[ia:ib]
            E = nu.energia_bandas(d, fs)
            _, Pd = nu.psd_welch(d, fs)
            orc[g] = {'frac': [float(v) for v in E / np.maximum(E0, 1e-30)], 'db': [float(v) for v in nu.db10(E)], 'A_frac': float((Pd * nu.ponderacao_a(f)).sum() / max(A0, 1e-30))}
            if op['guardar']:
                nu.gravar_wav(arq('so-' + g), x0 - xs)
            os.remove(arq('sem-' + g)); os.remove(arq('sem-' + g)[:-4] + '.json')
        out['orcamento'] = orc
    with open(os.path.join(pasta, 'caso.json'), 'w') as fh:
        json.dump(nu.limpar(out), fh, ensure_ascii=False, indent=1)
    return out


# ------------------------------------------------------------------------------------------------ tabelas
def f(v, p=1, s=False):
    if v is None or (isinstance(v, float) and not np.isfinite(v)):
        return '—'
    return f'{v:+.{p}f}' if s else f'{v:.{p}f}'


def linha_curta(r):
    s = r['sim']; R = r.get('real'); d = (r.get('comparacao') or {}).get('defeitos') or {}
    par = lambda k, i=None, p=1, sg=True: (f(R[k][i] if i is not None else R[k], p, sg) + ' / ' if R else '') + f(s[k][i] if i is not None else s[k], p, sg)
    return (f"{r['id']:26s} {r['info']['rpm']:6.0f} | 60–150 {par('rel', 1):>13s} | 400–1k {par('rel', 3):>13s} | 1–2,5k {par('rel', 4):>13s} | HNR {par('hnr', 3, 0):>9s} · {par('hnr', 4, 0):>9s} | "
            f"p90/p10 1–6k {par('p90_p10_1_6k', None, 1, False):>11s} | ar {f(d.get('ar'), 2)} tom {f(d.get('tom'), 2)} pulso {f(d.get('pulso'), 2)} | {s['dBA']:6.1f} dB(A)")


def carregar(pasta):
    with open(os.path.join(pasta, 'resumo.json')) as fh:
        return {r['id']: r for r in json.load(fh)}


def tabela(pa, pd, md):
    A, D = carregar(pa), carregar(pd)
    ids = [i for i in A if i in D]
    cab = ['caso', 'rpm', '400–1k re 150–400 (dB)', '1–2,5k re 150–400', 'HNR 400–1k (dB)', 'HNR 1–2,5k', 'p90/p10 400–1k (dB)', 'p90/p10 1–6k', 'ar', 'tom a menos', 'pulso a menos', 'nível dB(A)', '150–400 abs (dB)', '60–150 re 150–400']
    L = []
    for i in ids:
        a, d = A[i], D[i]; sa, sd = a['sim'], d['sim']; R = d.get('real') or a.get('real')
        da = (a.get('comparacao') or {}).get('defeitos') or {}; dd = (d.get('comparacao') or {}).get('defeitos') or {}
        tri = lambda k, j=None, p=1, sg=True: f(sa[k][j] if j is not None else sa[k], p, sg) + ' → ' + f(sd[k][j] if j is not None else sd[k], p, sg) + (' (' + f(R[k][j] if j is not None else R[k], p, sg) + ')' if R else '')
        dois = lambda x, y, p=2: f(x, p) + ' → ' + f(y, p)
        rpm = f"{d['info']['rpm']:.0f}" if not d.get('janela') else f"{d['rpm_ini']:.0f}–{d['rpm_fim']:.0f}"
        L.append([d['titulo'] + ('' if not R or R.get('casada', True) else ' *(faixa)*'), rpm, tri('rel', 3), tri('rel', 4), tri('hnr', 3, 1), tri('hnr', 4, 1), tri('p90_p10', 3, 1, False), tri('p90_p10_1_6k', None, 1, False),
                  dois(da.get('ar'), dd.get('ar')), dois(da.get('tom'), dd.get('tom')), dois(da.get('pulso'), dd.get('pulso')), dois(sa['dBA'], sd['dBA'], 1),
                  dois(sa['bandas_db'][2], sd['bandas_db'][2], 1), tri('rel', 1)])
    if md:
        print('| ' + ' | '.join(cab) + ' |'); print('|' + '---|' * len(cab))
        for l in L:
            print('| ' + ' | '.join(l).replace('.', ',').replace('-', '−') + ' |')
    else:
        w = [max(len(cab[k]), *(len(l[k]) for l in L)) for k in range(len(cab))]
        print('  '.join(cab[k].ljust(w[k]) for k in range(len(cab))))
        for l in L:
            print('  '.join(l[k].ljust(w[k]) for k in range(len(cab))))
    print('\n(antes → depois (gravação); níveis em dB relativos a 150–400 Hz; "faixa" = gravação de outro motor, outra posição ou outra carga)')


def fontes(pasta):
    R = carregar(pasta)
    gs = list(GRUPOS)
    print(f"{'caso':26s} banda    " + ' '.join(f'{g:>9s}' for g in gs) + '   (fração da potência da banda; em dB re o total da banda)')
    for i, r in R.items():
        o = r.get('orcamento')
        if not o:
            continue
        for b in (2, 3, 4, 5):
            print(f"{i if b == 2 else '':26s} {nu.NOMES[b]:8s} " + ' '.join(f"{nu.db10(max(o[g]['frac'][b], 1e-9)):9.1f}" for g in gs))
        print(f"{'':26s} {'pond. A':8s} " + ' '.join(f"{nu.db10(max(o[g]['A_frac'], 1e-9)):9.1f}" for g in gs))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--casos', default=os.path.join(AQUI, 'diesel-medios.json'))
    ap.add_argument('--saida'); ap.add_argument('--referencias'); ap.add_argument('--so'); ap.add_argument('--j', type=int, default=12)
    ap.add_argument('--campo', help='JSON com campos de preset a mudar em todos os casos'); ap.add_argument('--rotulo', default='atual')
    ap.add_argument('--antes', action='store_true', help='os presets com os valores de antes da 5ª passada (presets.ts → ANTES_DOS_MEDIOS)')
    ap.add_argument('--render', default='', help='argumentos a mais para o tools/diesel-ouvido-render.ts, entre aspas (experimentos: "--escala saia=2")')
    ap.add_argument('--orcamento', action='store_true'); ap.add_argument('--painel', action='store_true'); ap.add_argument('--guardar', action='store_true', help='guarda o WAV de cada fonte do orçamento')
    ap.add_argument('--tabela', nargs=2, metavar=('ANTES', 'DEPOIS')); ap.add_argument('--md', action='store_true'); ap.add_argument('--fontes', metavar='PASTA')
    a = ap.parse_args()
    EXTRA.extend(a.render.split())
    if a.antes:
        EXTRA.append('--antes')
    if a.tabela:
        return tabela(a.tabela[0], a.tabela[1], a.md)
    if a.fontes:
        return fontes(a.fontes)
    raiz = principal()
    refs = a.referencias or os.path.join(raiz, 'referencias', 'diesel')
    saida = a.saida or os.path.join(raiz, 'referencias', '_sim', 'diesel', 'medios', 'atual')
    os.makedirs(saida, exist_ok=True)
    with open(a.casos) as fh:
        todos = json.load(fh)['casos']
    casos = todos
    if a.so:
        so = a.so.split(',')
        casos = [c for c in todos if c['id'] in so or c['preset'] in so or c['cond'] in so]
    op = {'campo': json.loads(a.campo) if a.campo else None, 'rotulo': a.rotulo, 'orcamento': a.orcamento, 'painel': a.painel, 'guardar': a.guardar}
    res = {}
    with ThreadPoolExecutor(a.j) as pool, ThreadPoolExecutor(max(1, min(len(casos), a.j))) as externo:
        futs = [(c, externo.submit(caso, c, saida, refs, op, pool)) for c in casos]
        for c, fu in futs:
            try:
                r = fu.result(); res[c['id']] = r
                print(linha_curta(r), flush=True)
            except Exception as ex:  # (um caso que falha não derruba os outros)
                print(f"{c['id']:26s} FALHOU: {ex}", flush=True)
    # os casos que não rodaram agora entram no resumo com o que já está na pasta
    tudo = []
    for c in todos:
        if c['id'] in res:
            tudo.append(nu.limpar(res[c['id']]))
        else:
            try:
                with open(os.path.join(saida, c['id'], 'caso.json')) as fh:
                    tudo.append(json.load(fh))
            except (OSError, ValueError):
                pass
    with open(os.path.join(saida, 'resumo.json'), 'w') as fh:
        json.dump(tudo, fh, ensure_ascii=False, indent=1)
    print(f'\ngravado em {saida}: resumo.json e uma pasta por caso  (gravação / simulado; níveis em dB re 150–400 Hz)')


if __name__ == '__main__':
    main()
