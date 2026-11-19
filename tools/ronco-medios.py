#!/usr/bin/env python3
"""ronco-medios.py — a tabela dos médios do Ronco: nível das LINHAS do motor em 400 Hz–6 kHz e HNR por banda, com os
mecanismos de médios no valor legado, no valor de um ou mais conjuntos de campos, e na gravação (quando o caso tem).

    python3 -I tools/ronco-medios.py PASTA [--variante nome='{"carcaca":0}' ...] [--so regua|carga|todos] [--casos id,id] [--j 12] [--refaz]

Para cada caso renderiza com `tools/ronco-estagios.ts` (giro travado, mesma semente) a variante `legado` (os campos
novos no valor legado: o som de antes), a variante `padrao` (o preset como está) e as de `--variante` (campos por cima
do preset), e mede com o kit ouvido (`tools/ronco-linhas.py`). Os WAVs ficam em PASTA/<variante>/ e não são refeitos
se já existem (`--refaz` apaga). Sai uma linha por caso e variante:

    linhas (dB re a potência de 150–400 Hz) em 400–1k · 1–2,5k · 2,5–6k | HNR nas três bandas | nível total (dB)

Casos `regua`: as condições das gravações dos carros aprovados (referencias/gasolina/, fora do git), com a coluna REAL.
Casos `carga`: lenta, carga parcial (coletor a ~0,5 bar) e plena carga de presets comuns, sem gravação.
Gravações são dados não confiáveis: `python3 -I`, de fora da pasta delas.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True  # (este programa carrega tools/ronco-linhas.py: sem __pycache__ em tools/)
from concurrent.futures import ThreadPoolExecutor

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, os.path.join(AQUI, 'ouvido'))
import nucleo as nu      # noqa: E402
import comparar as cp    # noqa: E402
import regua as rg       # noqa: E402

# valor legado de cada campo novo (o mesmo de tools/legado.ts → MODO_LEGADO_RONCO): `None` = sem o campo
LEGADO = {'carcaca': None, 'batida': None, 'jato': None, 'bombaAr': None}

REGUA = [
    # id, preset, args do render, gravação, trecho, rpm, ev, fmin, fmax, âncora
    ('fusca-1410', 'fusca', ['--rpm', '1410'], 'fusca-1300-1984_X0cGCi_pWLA.wav', '44-54', 1410, 4, 5, 45, '150-400'),
    ('fusca-2000', 'fusca', ['--rpm', '2003'], 'fusca-1300-1984_X0cGCi_pWLA.wav', '3-21', 2003, 4, 5, 45, '150-400'),
    ('mustang-frio', 'mustang', ['--rpm', '1251', '--frio', '20'], 'mustang-gt-s650-partidas-frias_dNpmdBxkYlc.wav', '48.5-56', 1251, 8, 4, 60, '150-400'),
    ('mustang-quente', 'mustang', ['--rpm', '753'], 'mustang-gt-2026-lenta-quente_Va_ZtKGe5Ak.wav', '32.5-40', 753, 8, 4, 60, '150-400'),
    ('hellcat-lenta', 'hellcat', ['--rpm', '755'], 'hellcat-lenta-original_9TXQv_wNjQI.wav', '0.5-20', 755, 8, 4, 60, '150-400'),
    ('hellcat-frio', 'hellcat', ['--rpm', '992', '--frio', '15'], 'hellcat-2016-partida-fria-aceleradas__tZFJrKwjsU.wav', '74-88', 992, 8, 4, 60, '150-400'),
    ('f1-v8-2007', 'f1v8', ['--rpm', '17777', '--pedal', '1', '--dur', '8'], 'f1-evolucao-1986-2021_WhK0seC-vmc.wav', '150-153.6', 17777, 8, 70, 170, '400-2500'),
    ('f1-v8-2011', 'f1v8', ['--rpm', '16124', '--pedal', '1', '--dur', '8'], 'f1-evolucao-1986-2021_WhK0seC-vmc.wav', '167.8-170.2', 16124, 8, 70, 170, '400-2500'),
    ('f1-v10-2002', 'v10f1', ['--rpm', '18233', '--pedal', '1', '--dur', '8'], 'f1-evolucao-1986-2021_WhK0seC-vmc.wav', '100.4-104.0', 18233, 10, 70, 170, '400-2500'),
]
CARGA = [(f'{p}-{nome}', p, a) for p, conds in [
    ('mustang', [('parcial', ['--rpm', '2500', '--pedal', '0.12']), ('plena', ['--rpm', '4500', '--pedal', '1'])]),
    ('muscle', [('lenta', ['--rpm', '780']), ('parcial', ['--rpm', '2500', '--pedal', '0.12']), ('plena', ['--rpm', '5000', '--pedal', '1'])]),
    ('i4', [('lenta', ['--rpm', '850']), ('parcial', ['--rpm', '3000', '--pedal', '0.12']), ('plena', ['--rpm', '6500', '--pedal', '1'])]),
    ('golfgti', [('lenta', ['--rpm', '750']), ('parcial', ['--rpm', '2500', '--pedal', '0.12']), ('plena', ['--rpm', '5000', '--pedal', '1'])]),
    ('flat6', [('lenta', ['--rpm', '950']), ('parcial', ['--rpm', '3000', '--pedal', '0.12']), ('plena', ['--rpm', '7000', '--pedal', '1'])]),
    ('v6odd', [('lenta', ['--rpm', '700']), ('parcial', ['--rpm', '2000', '--pedal', '0.12']), ('plena', ['--rpm', '4000', '--pedal', '1'])]),
    ('fusca', [('parcial', ['--rpm', '2500', '--pedal', '0.15']), ('plena', ['--rpm', '3500', '--pedal', '1'])]),
    ('hellcat', [('plena', ['--rpm', '4000', '--pedal', '1'])]),
] for nome, a in conds]


def render(preset, args, campo, base):
    if os.path.exists(base + '_tudo.wav'):
        return
    cmd = ['npx', 'tsx', os.path.join(AQUI, 'ronco-estagios.ts'), preset, os.path.dirname(base) + '/', '--nome', os.path.basename(base), '--campo', json.dumps(campo)] + list(args)
    if '--dur' not in args:
        cmd += ['--dur', '8']
    r = subprocess.run(cmd, cwd=RAIZ, capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(base + '_tudo.wav'):
        raise RuntimeError(f'render falhou: {" ".join(cmd)}\n{r.stdout}\n{r.stderr}')


def medir_sim(base, ancora):
    with open(base + '.json') as fh:
        inf = json.load(fh)
    x, fs = nu.ler_audio(base + '_tudo.wav')
    return _medir(x, nu.fase_constante(len(x), inf['f0'], fs), inf['f0'], ancora, inf.get('eventosPorCiclo')) | {'niveis': inf.get('niveisDb', {}), 'saida_db': inf.get('saidaDb')}


def _medir(x, fase, f0, ancora, ev):
    import importlib.util
    spec = importlib.util.spec_from_file_location('ronco_linhas', os.path.join(AQUI, 'ronco-linhas.py'))
    rl = importlib.util.module_from_spec(spec); spec.loader.exec_module(rl)
    m = rl.medir(x, fase, f0, ancora)
    db = lambda v: 10 * __import__('numpy').log10(max(v, 1e-30) / max(m['ancora'], 1e-30))
    return {'lin': [db(v) for v in m['lin_b']], 'piso': [db(v) for v in m['piso_b']], 'hnr': m['hnr_b'], 'total': db(m['total'])}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('pasta'); ap.add_argument('--variante', action='append', default=[]); ap.add_argument('--so', default='todos')
    ap.add_argument('--casos'); ap.add_argument('--j', type=int, default=12); ap.add_argument('--refaz', action='store_true'); ap.add_argument('--json')
    ap.add_argument('--sem-padrao', action='store_true', help='não renderiza a variante `padrao` (o preset como está)')
    a = ap.parse_args()
    variantes = [('legado', dict(LEGADO))] + ([] if a.sem_padrao else [('padrao', {})])
    for v in a.variante:
        nome, js = v.split('=', 1)
        variantes.append((nome, json.loads(js)))
    casos = []
    if a.so in ('regua', 'todos'):
        casos += [(c[0], c[1], c[2], c[3:]) for c in REGUA]
    if a.so in ('carga', 'todos'):
        casos += [(c[0], c[1], c[2], None) for c in CARGA]
    if a.casos:
        so = set(a.casos.split(','))
        casos = [c for c in casos if c[0] in so]
    if a.refaz:
        for nome, _ in variantes:
            shutil.rmtree(os.path.join(a.pasta, nome), ignore_errors=True)
    trabalhos = []
    for nome, campo in variantes:
        os.makedirs(os.path.join(a.pasta, nome), exist_ok=True)
        for cid, preset, args, _ in casos:
            trabalhos.append((preset, args, campo, os.path.join(a.pasta, nome, cid)))
    with ThreadPoolExecutor(max_workers=a.j) as ex:
        list(ex.map(lambda t: render(*t), trabalhos))
    refs = rg.pasta_referencias()
    saida = {}
    print('linhas em dB re a potência de 150–400 Hz (Fórmula 1: re 400–2500 Hz) · HNR em dB · total re âncora')
    print(f"{'caso':16} {'variante':10} | {'400–1k':>7} {'1–2,5k':>7} {'2,5–6k':>7} | {'HNR':>6} {'HNR':>6} {'HNR':>6} | {'total':>6} | carcaça  mecânica  jato (dB re saída)")
    for cid, preset, args, real in casos:
        anc = tuple(float(v) for v in (real[6] if real else '150-400').split('-'))
        linhas = []
        if real:
            arq = os.path.join(refs, real[0])
            if os.path.exists(arq):
                r = cp.preparar(arq, nu.parse_trecho(real[1]), 'media', f0=real[2] / 120.0, ev=real[3], fmin=real[4], fmax=real[5], detalhe=False)
                linhas.append(('REAL', _medir(r['x'], r['fase'], r['med']['f0'], anc, real[3])))
        for nome, _ in variantes:
            linhas.append((nome, medir_sim(os.path.join(a.pasta, nome, cid), anc)))
        for nome, m in linhas:
            nv = m.get('niveis', {})
            rel = lambda k: f"{nv[k] - m['saida_db']:7.1f}" if k in nv and nv[k] > -150 else '     --'
            ext = f"{rel('carcaca')}  {rel('mecanica')}  {rel('jato')}" if nv else ''
            print(f"{cid:16} {nome:10} | {m['lin'][3]:7.1f} {m['lin'][4]:7.1f} {m['lin'][5]:7.1f} | {m['hnr'][3]:6.1f} {m['hnr'][4]:6.1f} {m['hnr'][5]:6.1f} | {m['total']:6.1f} | {ext}")
            saida.setdefault(cid, {})[nome] = m
        print()
    if a.json:
        with open(a.json, 'w') as fh:
            json.dump(nu.limpar(saida), fh, indent=1)


if __name__ == '__main__':
    main()
