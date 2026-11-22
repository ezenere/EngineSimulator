#!/usr/bin/env python3
"""radial-regua.py — a régua do kit ouvido para o Radial: renderiza cada preset na condição da gravação casada
(`tools/radial-fontes.ts`, pela página e/ou pela Cena), compara com o trecho da gravação (`tools/ouvido/comparar.py`) e
monta a tabela dos critérios da rodada de som (docs/PLANO.md): estalos por segundo e curtose de 1–6 kHz, `ar`, leito de
ruído por banda contra o da gravação, tom a menos, pulso a menos, total, bandas e a margem do limitador de saída.

    python3 -I tools/radial-regua.py --saida PASTA [--casos tools/radial-regua.json] [--referencias PASTA]
                                     [--so id,id] [--caminho pagina|cena] [--orcamento] [-j 6] [--sem-painel] [--refazer]

Em PASTA: um diretório por caso e caminho (`<id>.<caminho>/`: `sim.wav`, `sim.json`, `painel.png`, `medidas.json`,
`resumo.txt`; com `--orcamento`, `orc/` com o conjunto de fontes e o `*_orcamento.txt`), `tabela.md` e `tabela.json`.
As gravações ficam fora do git, em `referencias/radial/` do checkout principal (fonte, trechos e rotação no `INDEX.md`
de lá). Rode com `python3 -I`.

Num radial de 4 tempos o ciclo é de 2 voltas: f0 = rpm/120 e a ignição é cilindros × rpm/120.

Campos de um caso (`radial-regua.json`):
  id, titulo, nota, preset
  real, trecho [a, b], rpm (conferida com tools/ouvido/f0.py), folga (opcional)
  render: argumentos do radial-fontes.ts depois do preset e do arquivo (ex.: ["--rpm", "1198"])
  caminhos: ["pagina"], ["cena"] ou os dois; `d`: distância do ouvinte da Cena (m), a do microfone da gravação
  renderCena (opcional): os argumentos do render pela Cena, quando diferem (a Cena não trava o giro)
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
LIMITES = {'ar': 0.6, 'tom': 2.4, 'pulso': 1.3, 'total': 2.2, 'picos': 6.0}


def pasta_referencias():
    p = os.path.join(RAIZ, 'referencias', 'radial')
    if os.path.isdir(p):
        return p
    try:   # num worktree: o checkout principal é o pai do diretório git comum
        comum = subprocess.run(['git', '-C', RAIZ, 'rev-parse', '--path-format=absolute', '--git-common-dir'], capture_output=True, text=True, check=True).stdout.strip()
        return os.path.join(os.path.dirname(comum), 'referencias', 'radial')
    except (subprocess.CalledProcessError, OSError):
        return p


def rodar(cmd):
    r = subprocess.run(cmd, cwd=RAIZ, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f'falhou: {" ".join(cmd)}\n{r.stdout}\n{r.stderr}')
    return r.stdout


def args_render(caso, caminho):
    ar = caso.get('renderCena', caso['render']) if caminho == 'cena' else caso['render']
    ar = [json.dumps(a) if isinstance(a, dict) else str(a) for a in ar]
    if caminho == 'cena':
        ar += ['--caminho', 'cena', '--d', str(caso.get('d', 5))]
    return ar


def render(caso, caminho, pasta, refazer):
    wav = os.path.join(pasta, 'sim.wav')
    if refazer or not os.path.exists(wav):
        rodar(['npx', 'tsx', os.path.join(AQUI, 'radial-fontes.ts'), caso['preset'], wav] + args_render(caso, caminho))
    return wav


def orcamento(caso, caminho, pasta, refazer):
    orc = os.path.join(pasta, 'orc')
    if refazer or not os.path.isdir(orc) or not any(f.endswith('_orcamento.txt') for f in os.listdir(orc)):
        rodar(['npx', 'tsx', os.path.join(AQUI, 'radial-fontes.ts'), caso['preset'], orc + '/', '--cada', '--dur', '8'] + args_render(caso, caminho))
        rodar([sys.executable, '-I', os.path.join(AQUI, 'ouvido', 'orcamento.py'), orc, '--na-rede', 'valvula,estouros,variacao', '--sem-figura'])
    for f in sorted(os.listdir(orc)):
        if f.endswith('_orcamento.txt'):
            with open(os.path.join(orc, f)) as fh:
                return fh.read()
    return ''


def um_caso(caso, caminho, a, refs):
    import numpy as np
    import comparar as cp
    pasta = os.path.join(a.saida, f"{caso['id']}.{caminho}")
    os.makedirs(pasta, exist_ok=True)
    real = caso['real'] if os.path.isabs(caso['real']) else os.path.join(refs, caso['real'])
    if not os.path.exists(real):
        return {'id': caso['id'], 'caminho': caminho, 'erro': f'falta a gravação {real}'}
    sim = render(caso, caminho, pasta, a.refazer)
    with open(sim[:-4] + '.json') as fh:
        info = json.load(fh)
    ev = int(info['eventosPorCiclo'])
    f0r = caso['rpm'] / 120.0
    r = cp.executar(real, sim, pasta, f0_real=f0r, f0_sim=info['f0'], ev=ev, voltas=2.0, fixo_sim=bool(info.get('fixo')),
                    trecho_real=tuple(caso['trecho']) if caso.get('trecho') else None, canal_real=caso.get('canal', 'media'),
                    fmin=caso.get('fmin', 0.6 * f0r), fmax=caso.get('fmax', 1.6 * f0r), folga=caso.get('folga', 0.08), dpi=a.dpi,
                    titulo=(a.rotulo + ' · ' if a.rotulo else '') + caso['titulo'] + (' · pela Cena a %g m' % caso.get('d', 5) if caminho == 'cena' else ' · página'),
                    painel=not a.sem_painel, ancora=caso.get('ancora', 'auto'), zoom=caso.get('zoom', 0.5))
    c = r['comp']
    R, S = r['real']['med'], r['sim']['med']
    aR, aS = c['ancora_db_real'], c['ancora_db_sim']
    fin = lambda x: None if x is None or not np.isfinite(x) else float(x)
    fx = lambda M, k: fin(M['faixa_1_6k'].get(k))
    linha = {'id': caso['id'], 'caminho': caminho, 'titulo': caso['titulo'], 'preset': caso['preset'], 'rpm_real': R['rpm'], 'rpm_sim': S['rpm'], 'ancora': c['ancora'],
             'distancias': c['distancias'], 'defeitos': c['defeitos'], 'resumo': [x['texto'] for x in c['resumo']], 'avisos': c['avisos'],
             'bandas': [{'banda': BANDAS[i],
                         'nivel': [fin(R['bandas'][i]['nivel_db'] - aR), fin(S['bandas'][i]['nivel_db'] - aS)],
                         'hnr': [fin(R['bandas'][i]['hnr']), fin(S['bandas'][i]['hnr'])],
                         'linhas': [fin(R['bandas'][i]['harm_db'] - aR), fin(S['bandas'][i]['harm_db'] - aS)],
                         'leito': [fin(R['bandas'][i]['leito_db'] - aR), fin(S['bandas'][i]['leito_db'] - aS)],
                         'leito_frac': [fin(cp.leito_frac(R['bandas'][i])), fin(cp.leito_frac(S['bandas'][i]))]} for i in range(len(BANDAS))],
             'faixa_1_6k': {k: [fx(R, k), fx(S, k)] for k in ('picos_s', 'picos_irregulares_s', 'curtose_mediana', 'p90_p10', 'vao', 'm_ign', 'cv_evento')},
             'leito_1_6k': [fin(R['faixa_1_6k']['leito_db'] - aR), fin(S['faixa_1_6k']['leito_db'] - aS)],
             'leito_frac_1_6k': [fin(cp.leito_frac(R['faixa_1_6k'])), fin(cp.leito_frac(S['faixa_1_6k']))],
             'sim': {k: info.get(k) for k in ('modo', 'rpm', 'pedal', 'coletorBar', 'pico', 'acima07', 'rmsDb', 'mkIdle', 'ganho', 'distancia')}}
    if a.orcamento:
        linha['orcamento'] = orcamento(caso, caminho, pasta, a.refazer)
    return linha


def f1(v, n=1, sinal=True):
    return '--' if v is None else (f'{v:+.{n}f}' if sinal else f'{v:.{n}f}')


def tabela(linhas):
    md = ['| caso | caminho | rpm real / sim | picos/s 1–6 kHz real → sim | fora do padrão/s | curtose | p90/p10 (dB) | ar | tom a menos | pulso a menos | total | leito re âncora, real → sim (dB): 400–1k · 1–2,5k · 2,5–6k | nível re âncora, real → sim (dB): 60–150 · 400–1k · 1–2,5k · 2,5–6k | linhas re âncora (dB): 400–1k · 1–2,5k | acima de 0,7 |',
          '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|']
    for L in linhas:
        if L.get('erro'):
            md.append(f"| {L['id']} | {L.get('caminho', '')} | {L['erro']} |")
            continue
        b = L['bandas']; d = L['defeitos']; F = L['faixa_1_6k']
        marca = lambda k, v: f'**{v:.2f}**' if v > LIMITES[k] else f'{v:.2f}'
        par = lambda k, n=1: f"{f1(F[k][0], n, False)} → {f1(F[k][1], n, False)}"
        pic = par('picos_s') + (' ✗' if (F['picos_s'][1] or 0) > LIMITES['picos'] else '')
        leito = ' · '.join(f"{f1(b[i]['leito'][0])} → {f1(b[i]['leito'][1])}" + (' ✗' if b[i]['leito'][0] is not None and b[i]['leito'][1] is not None and b[i]['leito'][1] > b[i]['leito'][0] + 0.5 else '') for i in (3, 4, 5))
        niv = ' · '.join(f"{f1(b[i]['nivel'][0])} → {f1(b[i]['nivel'][1])}" for i in (1, 3, 4, 5))
        lin = ' · '.join(f"{f1(b[i]['linhas'][0])} → {f1(b[i]['linhas'][1])}" for i in (3, 4))
        sat = L['sim'].get('acima07')
        sats = '--' if sat is None or L['caminho'] == 'cena' else (f'**{100 * sat:.1f} %**' if sat > 0.01 else f'{100 * sat:.2f} %')
        md.append(f"| {L['id']} | {L['caminho']} | {L['rpm_real']:.0f} / {L['rpm_sim']:.0f} | {pic} | {par('picos_irregulares_s')} | {par('curtose_mediana')} | {par('p90_p10')} | {marca('ar', d['ar'])} | {marca('tom', d['tom'])} | {marca('pulso', d['pulso'])} | {marca('total', L['distancias']['total'])} | {leito} | {niv} | {lin} | {sats} |")
    md.append('')
    md.append(f"Limites (faixa dos aprovados pelo ouvido, tools/ouvido/README.md): ar ≤ {LIMITES['ar']}, tom a menos ≤ {LIMITES['tom']}, pulso a menos ≤ {LIMITES['pulso']}, total ≤ {LIMITES['total']}; estalos ≤ {LIMITES['picos']:.0f} picos/s (gravações de radial: 0 a 7); em negrito ou com ✗ o que passa. "
              'Picos = picos da envoltória de 1–6 kHz mais de 10 dB sobre a mediana de 0,3 s; fora do padrão = os que fogem do ciclo médio. '
              'Leito = nível do chiado contínuo (resíduo não periódico × quanto dele é liso), em dB relativos à banda âncora de cada lado; ✗ = o do simulado passa do da gravação. '
              'Linhas = potência das linhas do motor na banda, relativa à âncora. Acima de 0,7 = fração das amostras da saída da página com |x| > 0,7 (o limitador de saída).')
    return '\n'.join(md)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--casos', default=os.path.join(AQUI, 'radial-regua.json'))
    ap.add_argument('--saida', required=True)
    ap.add_argument('--referencias')
    ap.add_argument('--so')
    ap.add_argument('--caminho', help='só este caminho (pagina ou cena)')
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
        cid, caminho = a.um.rsplit('.', 1)
        caso = next(c for c in casos if c['id'] == cid)
        try:
            L = um_caso(caso, caminho, a, refs)
        except Exception as e:   # noqa: BLE001
            L = {'id': caso['id'], 'caminho': caminho, 'erro': f'{type(e).__name__}: {e}'[:600]}
        with open(os.path.join(a.saida, a.um, 'linha.json'), 'w') as fh:
            json.dump(L, fh, ensure_ascii=False, indent=1)
        return
    so = set(a.so.split(',')) if a.so else None
    pares = [(c, cam) for c in casos if not so or c['id'] in so for cam in c.get('caminhos', ['pagina']) if not a.caminho or cam == a.caminho]
    os.makedirs(a.saida, exist_ok=True)

    def filho(par):
        c, cam = par
        chave = f"{c['id']}.{cam}"
        os.makedirs(os.path.join(a.saida, chave), exist_ok=True)
        cmd = [sys.executable, '-I', os.path.abspath(__file__), '--casos', a.casos, '--saida', a.saida, '--um', chave, '--dpi', str(a.dpi), '--rotulo', a.rotulo]
        cmd += (['--referencias', a.referencias] if a.referencias else []) + (['--orcamento'] if a.orcamento else []) + (['--refazer'] if a.refazer else []) + (['--sem-painel'] if a.sem_painel else [])
        r = subprocess.run(cmd, cwd=RAIZ, capture_output=True, text=True)
        arq = os.path.join(a.saida, chave, 'linha.json')
        if r.returncode != 0 or not os.path.exists(arq):
            return {'id': c['id'], 'caminho': cam, 'erro': (r.stderr or r.stdout)[-600:]}
        with open(arq) as fh:
            return json.load(fh)

    with ThreadPoolExecutor(max_workers=max(1, a.j)) as ex:
        linhas = list(ex.map(filho, pares))
    for L in linhas:
        if L.get('erro'):
            print(f"== {L['id']} ({L.get('caminho')}): ERRO {L['erro']}")
            continue
        d = L['distancias']; df = L['defeitos']
        print(f"== {L['id']} ({L['caminho']}): {L['titulo']}  [{L['rpm_real']:.0f} / {L['rpm_sim']:.0f} rpm]")
        print(f"   tonal {d['tonal']:.2f}  piso {d['piso']:.2f}  envoltória {d['envoltoria']:.2f}  modulação {d['modulacao']:.2f}  eventos {d['eventos']:.2f}  | total {d['total']:.2f}  ||  ar {df['ar']:.2f}  tom a menos {df['tom']:.2f}  pulso a menos {df['pulso']:.2f}")
        for x in L['resumo'][:5]:
            print('     · ' + x)
        if L.get('orcamento'):
            print('\n'.join('     ' + s for s in L['orcamento'].splitlines()))
    md = tabela(linhas)
    print('\n' + md)
    if so or a.caminho:
        print(f"\n(rodada parcial: tabela.md e tabela.json de {a.saida}/ não foram regravados)")
        return
    with open(os.path.join(a.saida, 'tabela.md'), 'w') as fh:
        fh.write(md + '\n')
    with open(os.path.join(a.saida, 'tabela.json'), 'w') as fh:
        json.dump({'casos': linhas, 'limites': LIMITES}, fh, ensure_ascii=False, indent=1)
    print(f"\ngravado em {a.saida}/: tabela.md, tabela.json e um diretório por caso e caminho")


if __name__ == '__main__':
    main()
