#!/usr/bin/env python3
"""rotativo-regua.py — a régua do kit ouvido para os Rotativos: renderiza cada preset na condição da gravação casada
(`tools/rotativo-fontes.ts`), compara com o trecho da gravação (`tools/ouvido/comparar.py`) e monta a tabela dos
critérios da rodada de som (docs/PLANO.md): `ar`, leito de ruído por banda contra o da gravação, HNR por banda, tom a
menos, pulso a menos, total e o nível das linhas em 400 Hz–2,5 kHz.

    python3 -I tools/rotativo-regua.py --saida PASTA [--casos tools/rotativo-regua.json] [--referencias PASTA]
                                       [--so id,id] [--orcamento] [-j 6] [--sem-painel] [--refazer]

Em PASTA: um diretório por caso (`sim.wav`, `sim.json`, `painel.png`, `medidas.json`, `resumo.txt`; com `--orcamento`,
`orc/` com o conjunto de fontes e o `*_orcamento.txt`), `tabela.md` e `tabela.json`. As gravações ficam fora do git, em
`referencias/rotativo/` do checkout principal (fonte, trechos e rotação no `INDEX.md` de lá). Rode com `python3 -I`.

No Wankel o ciclo que se repete é o da câmara: 3 voltas do eixo (1 080°e), f0 = rpm/180, 3·rotores explosões por ciclo
(a ignição é rotores·rpm/60). Um motor real com as câmaras quase iguais repete a cada ignição; dobrar em 3 voltas só
acrescenta o que difere de flanco para flanco.

Campos de um caso (`rotativo-regua.json`):
  id, titulo, nota
  real, trecho [a, b], rpm (do eixo, conferida com tools/ouvido/f0.py), folga (opcional), rotores
  voltas (opcional): voltas do eixo em que o som se repete, quando não são as 3 do ciclo da câmara (6 na lenta do "brap")
  render: argumentos do rotativo-fontes.ts depois do preset e do arquivo (ex.: ["--rpm", "4846", "--pedal", "1"])
  preset: id do preset
"""
import argparse
import json
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, os.path.join(AQUI, 'ouvido'))

BANDAS = ['30-60', '60-150', '150-400', '400-1k', '1-2,5k', '2,5-6k', '6-12k']
MOSTRA = [2, 3, 4, 5]          # 150–400, 400–1k, 1–2,5k, 2,5–6k
LIMITES = {'ar': 0.6, 'tom': 2.4, 'pulso': 1.3, 'total': 2.2}


def pasta_referencias():
    p = os.path.join(RAIZ, 'referencias', 'rotativo')
    if os.path.isdir(p):
        return p
    try:   # num worktree: o checkout principal é o pai do diretório git comum
        comum = subprocess.run(['git', '-C', RAIZ, 'rev-parse', '--path-format=absolute', '--git-common-dir'], capture_output=True, text=True, check=True).stdout.strip()
        return os.path.join(os.path.dirname(comum), 'referencias', 'rotativo')
    except (subprocess.CalledProcessError, OSError):
        return p


def rodar(cmd):
    r = subprocess.run(cmd, cwd=RAIZ, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f'falhou: {" ".join(cmd)}\n{r.stdout}\n{r.stderr}')
    return r.stdout


def render(caso, pasta, refazer):
    wav = os.path.join(pasta, 'sim.wav')
    if refazer or not os.path.exists(wav):
        rodar(['npx', 'tsx', os.path.join(AQUI, 'rotativo-fontes.ts'), caso['preset'], wav] + [json.dumps(a) if isinstance(a, dict) else str(a) for a in caso['render']])
    return wav


def orcamento(caso, pasta, refazer):
    orc = os.path.join(pasta, 'orc')
    if refazer or not os.path.isdir(orc) or not any(f.endswith('_orcamento.txt') for f in os.listdir(orc)):
        rodar(['npx', 'tsx', os.path.join(AQUI, 'rotativo-fontes.ts'), caso['preset'], orc + '/', '--cada'] + [json.dumps(a) if isinstance(a, dict) else str(a) for a in caso['render']])
        rodar([sys.executable, '-I', os.path.join(AQUI, 'ouvido', 'orcamento.py'), orc, '--voltas-por-ciclo', '3', '--na-rede', 'posBoca,posQuente,posPrim,posqueima,janela,estouros,variacao'])
    for f in sorted(os.listdir(orc)):
        if f.endswith('_orcamento.txt'):
            with open(os.path.join(orc, f)) as fh:
                return fh.read()
    return ''


def um_caso(caso, a, refs):
    import numpy as np
    import comparar as cp
    pasta = os.path.join(a.saida, caso['id'])
    os.makedirs(pasta, exist_ok=True)
    real = caso['real'] if os.path.isabs(caso['real']) else os.path.join(refs, caso['real'])
    if not os.path.exists(real):
        return {'id': caso['id'], 'erro': f'falta a gravação {real}'}
    sim = render(caso, pasta, a.refazer)
    with open(sim[:-4] + '.json') as fh:
        info = json.load(fh)
    v = float(info.get('voltasPorCiclo', 3))
    ev = int(info.get('eventosPorCiclo', 3 * caso.get('rotores', 2)))
    f0s = info['f0']
    if caso.get('voltas'):   # (lenta de janela de competição: o padrão queima/falha se repete a cada 2 ciclos da câmara, 6 voltas)
        k = float(caso['voltas']) / v
        v = float(caso['voltas']); ev = int(round(ev * k)); f0s = f0s / k
    f0r = caso['rpm'] / 60.0 / v
    r = cp.executar(real, sim, pasta, f0_real=f0r, f0_sim=f0s, ev=ev, voltas=v, fixo_sim=bool(info.get('fixo')),
                    trecho_real=tuple(caso['trecho']) if caso.get('trecho') else None, canal_real=caso.get('canal', 'media'),
                    fmin=caso.get('fmin', 0.6 * f0r), fmax=caso.get('fmax', 1.6 * f0r), folga=caso.get('folga', 0.08), dpi=a.dpi, titulo=(a.rotulo + ' · ' if a.rotulo else '') + caso['titulo'],
                    painel=not a.sem_painel, ancora=caso.get('ancora', 'auto'), zoom=caso.get('zoom', 0.5))
    c = r['comp']
    R, S = r['real']['med'], r['sim']['med']
    aR, aS = c['ancora_db_real'], c['ancora_db_sim']
    fin = lambda x: None if x is None or not np.isfinite(x) else float(x)
    linha = {'id': caso['id'], 'titulo': caso['titulo'], 'preset': caso['preset'], 'rpm_real': R['rpm'], 'rpm_sim': S['rpm'], 'ancora': c['ancora'],
             'distancias': c['distancias'], 'defeitos': c['defeitos'], 'resumo': [x['texto'] for x in c['resumo']], 'avisos': c['avisos'],
             'bandas': [{'banda': BANDAS[i],
                         'nivel': [fin(R['bandas'][i]['nivel_db'] - aR), fin(S['bandas'][i]['nivel_db'] - aS)],
                         'hnr': [fin(R['bandas'][i]['hnr']), fin(S['bandas'][i]['hnr'])],
                         'linhas': [fin(R['bandas'][i]['harm_db'] - aR), fin(S['bandas'][i]['harm_db'] - aS)],
                         'piso': [fin(R['bandas'][i]['piso_db'] - aR), fin(S['bandas'][i]['piso_db'] - aS)],
                         'leito': [fin(R['bandas'][i]['leito_db'] - aR), fin(S['bandas'][i]['leito_db'] - aS)],
                         'leito_frac': [fin(cp.leito_frac(R['bandas'][i])), fin(cp.leito_frac(S['bandas'][i]))]} for i in range(len(BANDAS))],
             'faixa_1_6k': {'leito': [fin(R['faixa_1_6k']['leito_db'] - aR), fin(S['faixa_1_6k']['leito_db'] - aS)],
                            'leito_frac': [fin(cp.leito_frac(R['faixa_1_6k'])), fin(cp.leito_frac(S['faixa_1_6k']))],
                            'p90_p10': [fin(R['faixa_1_6k']['p90_p10']), fin(S['faixa_1_6k']['p90_p10'])],
                            'm_ign': [fin(R['faixa_1_6k'].get('m_ign')), fin(S['faixa_1_6k'].get('m_ign'))]},
             'sim': {k: info.get(k) for k in ('modo', 'rpm', 'pedal', 'coletorBar', 'boostBar', 'pAberturaBar', 'fHC', 'falha', 'estourosS', 'ouvinte', 'pico')}}
    if a.orcamento:
        linha['orcamento'] = orcamento(caso, pasta, a.refazer)
    return linha


def f1(v, n=1):
    return '--' if v is None else f'{v:+.{n}f}' if n else f'{v:.0f}'


def tabela(linhas):
    md = ['| caso | rpm real / sim | ar | tom a menos | pulso a menos | total | leito re âncora, real → sim (dB): 400–1k · 1–2,5k · 2,5–6k | HNR real → sim (dB): 150–400 · 400–1k · 1–2,5k · 2,5–6k | linhas re âncora, real → sim (dB): 400–1k · 1–2,5k | nível re âncora, real → sim (dB): 400–1k · 1–2,5k · 2,5–6k |',
          '|---|---|---|---|---|---|---|---|---|---|']
    for L in linhas:
        if L.get('erro'):
            md.append(f"| {L['id']} | {L['erro']} |"); continue
        b = L['bandas']; d = L['defeitos']
        marca = lambda k, v: f'**{v:.2f}**' if v > LIMITES[k] else f'{v:.2f}'
        leito = ' · '.join(f"{f1(b[i]['leito'][0])} → {f1(b[i]['leito'][1])}" + (' ✗' if b[i]['leito'][0] is not None and b[i]['leito'][1] is not None and b[i]['leito'][1] > b[i]['leito'][0] + 0.5 else '') for i in (3, 4, 5))
        hnr = ' · '.join(f"{f1(b[i]['hnr'][0], 0)} → {f1(b[i]['hnr'][1], 0)}" for i in MOSTRA)
        lin = ' · '.join(f"{f1(b[i]['linhas'][0])} → {f1(b[i]['linhas'][1])}" for i in (3, 4))
        niv = ' · '.join(f"{f1(b[i]['nivel'][0])} → {f1(b[i]['nivel'][1])}" for i in (3, 4, 5))
        md.append(f"| {L['id']} | {L['rpm_real']:.0f} / {L['rpm_sim']:.0f} | {marca('ar', d['ar'])} | {marca('tom', d['tom'])} | {marca('pulso', d['pulso'])} | {marca('total', L['distancias']['total'])} | {leito} | {hnr} | {lin} | {niv} |")
    md.append('')
    md.append(f"Limites (faixa dos aprovados pelo ouvido, tools/ouvido/README.md): ar ≤ {LIMITES['ar']}, tom a menos ≤ {LIMITES['tom']}, pulso a menos ≤ {LIMITES['pulso']}, total ≤ {LIMITES['total']}; em negrito o que passa do limite. "
              'Leito = nível do chiado contínuo (resíduo não periódico × quanto dele é liso), em dB relativos à banda âncora de cada lado; ✗ = o do simulado passa do da gravação. '
              'Linhas = potência das linhas do motor na banda, relativa à âncora. HNR abaixo de −15 dB: sem tom.')
    return '\n'.join(md)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--casos', default=os.path.join(AQUI, 'rotativo-regua.json'))
    ap.add_argument('--saida', required=True)
    ap.add_argument('--referencias')
    ap.add_argument('--so')
    ap.add_argument('--orcamento', action='store_true')
    ap.add_argument('--refazer', action='store_true', help='renderiza de novo mesmo que o sim.wav exista')
    ap.add_argument('--sem-painel', action='store_true')
    ap.add_argument('--rotulo', default='', help='prefixo do título dos painéis (ex.: ANTES)')
    ap.add_argument('--dpi', type=int, default=100)
    ap.add_argument('-j', type=int, default=6)
    ap.add_argument('--um', help=argparse.SUPPRESS)
    a = ap.parse_args()
    with open(a.casos) as fh:
        cfg = json.load(fh)
    refs = a.referencias or pasta_referencias()
    casos = cfg['casos']
    if a.um:   # (um caso por processo: o matplotlib e o numpy de cada um ficam isolados)
        caso = next(c for c in casos if c['id'] == a.um)
        try:
            L = um_caso(caso, a, refs)
        except Exception as e:   # noqa: BLE001
            L = {'id': caso['id'], 'erro': f'{type(e).__name__}: {e}'[:400]}
        with open(os.path.join(a.saida, caso['id'], 'linha.json'), 'w') as fh:
            json.dump(L, fh, ensure_ascii=False, indent=1)
        return
    so = set(a.so.split(',')) if a.so else None
    escolhidos = [c for c in casos if not so or c['id'] in so]
    os.makedirs(a.saida, exist_ok=True)

    def filho(c):
        os.makedirs(os.path.join(a.saida, c['id']), exist_ok=True)
        cmd = [sys.executable, '-I', os.path.abspath(__file__), '--casos', a.casos, '--saida', a.saida, '--um', c['id'], '--dpi', str(a.dpi), '--rotulo', a.rotulo]
        cmd += (['--referencias', a.referencias] if a.referencias else []) + (['--orcamento'] if a.orcamento else []) + (['--refazer'] if a.refazer else []) + (['--sem-painel'] if a.sem_painel else [])
        r = subprocess.run(cmd, cwd=RAIZ, capture_output=True, text=True)
        arq = os.path.join(a.saida, c['id'], 'linha.json')
        if r.returncode != 0 or not os.path.exists(arq):
            return {'id': c['id'], 'erro': (r.stderr or r.stdout)[-400:]}
        with open(arq) as fh:
            return json.load(fh)

    with ThreadPoolExecutor(max_workers=max(1, a.j)) as ex:
        linhas = list(ex.map(filho, escolhidos))
    for L in linhas:
        if L.get('erro'):
            print(f"== {L['id']}: ERRO {L['erro']}"); continue
        d = L['distancias']; df = L['defeitos']
        print(f"== {L['id']}: {L['titulo']}  [{L['rpm_real']:.0f} / {L['rpm_sim']:.0f} rpm]")
        print(f"   tonal {d['tonal']:.2f}  piso {d['piso']:.2f}  envoltória {d['envoltoria']:.2f}  modulação {d['modulacao']:.2f}  eventos {d['eventos']:.2f}  | total {d['total']:.2f}  ||  ar {df['ar']:.2f}  tom a menos {df['tom']:.2f}  pulso a menos {df['pulso']:.2f}")
        for x in L['resumo'][:5]:
            print('     · ' + x)
        if L.get('orcamento'):
            print('\n'.join('     ' + s for s in L['orcamento'].splitlines()))
    md = tabela(linhas)
    print('\n' + md)
    if so:
        print(f"\n(rodada parcial: tabela.md e tabela.json de {a.saida}/ não foram regravados)")
        return
    with open(os.path.join(a.saida, 'tabela.md'), 'w') as fh:
        fh.write(md + '\n')
    with open(os.path.join(a.saida, 'tabela.json'), 'w') as fh:
        json.dump({'casos': linhas, 'limites': LIMITES}, fh, ensure_ascii=False, indent=1)
    print(f"\ngravado em {a.saida}/: tabela.md, tabela.json e um diretório por caso")


if __name__ == '__main__':
    main()
