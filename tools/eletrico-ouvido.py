#!/usr/bin/env python3
"""eletrico-ouvido.py — a régua do Elétrico: renderiza cada caso de `eletrico-ouvido.json` na condição da gravação
casada (tools/eletrico-fontes.ts), compara com o kit ouvido (painel, HNR, leito, defeitos) onde há um ciclo, e mede a
vida das linhas e o piso sem supor ciclo (tools/eletrico-vida.py).

    python3 -I tools/eletrico-ouvido.py [--casos tools/eletrico-ouvido.json] [--saida PASTA] [--so id,id]
                                        [--reusar] [--orcamento] [--rotulo "DEPOIS"]

Sai em PASTA/<id>/: `<id>.wav` e `.json` (o render), `cmp/` (painel.png, medidas.json, resumo.txt do kit, se o caso tem
`f0`), `vida/` (vida.png, vida.json) e, com `--orcamento`, `orc/` (o conjunto `_tudo` / `_so-<fonte>` / `_semente2` e o
orçamento por fonte); em PASTA, `resumo.md` e `resumo.json`. PASTA por padrão é `referencias/_sim/eletrico/atual/` do
checkout principal (fora do git). `--reusar` não renderiza o que já existe (para refazer só as medidas, ou para medir
WAVs de outra versão do código postos ali à mão: os de antes de uma mudança).

Campos de um caso: id, preset, titulo, render (opções do eletrico-fontes.ts), sim (id de outro caso cujo render serve),
real, trecho [a, b], f0 (Hz do "ciclo" da gravação para o kit; ausente = sem kit), f0sim (o ciclo exato do simulado; ausente
= a volta do eixo, do .json do render), fmin, fmax, folga, vida [fmin, fmax] (faixa em que
o eletrico-vida.py procura as linhas), casada (false = gravação de outro veículo ou condição: vale como faixa).

Leitura (docs/PLANO.md, viés "mais motor, menos ar"): o HNR do simulado fica igual ou acima do da gravação em toda banda
até 6 kHz; o que se procura na vida das linhas é o simulado DENTRO da faixa das gravações (AM, FM, largura, saia): linha
parada e perfeita sobre silêncio é o que soa a sintetizador.
"""
import argparse
import json
import os
import subprocess
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, os.path.join(AQUI, 'ouvido'))
sys.path.insert(0, AQUI)
import nucleo as nu  # noqa: E402
import comparar as cp  # noqa: E402

NOMES = ['20-60', '60-150', '150-400', '400-1k', '1-2,5k', '2,5-6k', '6-12k']


def principal():
    try:
        comum = subprocess.run(['git', '-C', RAIZ, 'rev-parse', '--path-format=absolute', '--git-common-dir'], capture_output=True, text=True, check=True).stdout.strip()
        return os.path.dirname(comum)
    except (subprocess.CalledProcessError, OSError):
        return RAIZ


def vida_mod():
    import importlib.util
    spec = importlib.util.spec_from_file_location('eletrico_vida', os.path.join(AQUI, 'eletrico-vida.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def f(x, d=1):
    return '—' if x is None or x != x else f'{x:.{d}f}'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--casos', default=os.path.join(AQUI, 'eletrico-ouvido.json'))
    ap.add_argument('--saida'); ap.add_argument('--referencias'); ap.add_argument('--so')
    ap.add_argument('--reusar', action='store_true'); ap.add_argument('--orcamento', action='store_true'); ap.add_argument('--rotulo', default='')
    a = ap.parse_args()
    base = principal()
    refs = a.referencias or os.path.join(base, 'referencias', 'eletrico')
    saida = a.saida or os.path.join(base, 'referencias', '_sim', 'eletrico', 'atual')
    os.makedirs(saida, exist_ok=True)
    with open(a.casos) as fh:
        casos = json.load(fh)['casos']
    if a.so:
        quais = set(a.so.split(','))
        casos = [c for c in casos if c['id'] in quais]
    vm = vida_mod()
    linhas = []
    for c in casos:
        cid = c.get('sim', c['id'])
        pasta = os.path.join(saida, c['id'])
        os.makedirs(pasta, exist_ok=True)
        wav = os.path.join(saida, cid, cid + '.wav')
        if not (a.reusar and os.path.exists(wav)):
            if 'sim' in c and os.path.exists(wav):
                pass
            else:
                os.makedirs(os.path.dirname(wav), exist_ok=True)
                r = subprocess.run(['npx', 'tsx', os.path.join(AQUI, 'eletrico-fontes.ts'), c['preset'], wav] + c.get('render', []), cwd=RAIZ, capture_output=True, text=True)
                if r.returncode != 0:
                    print(r.stdout, r.stderr, file=sys.stderr)
                    raise SystemExit(f"render de {c['id']} falhou")
        if a.orcamento and 'render' in c:
            subprocess.run(['npx', 'tsx', os.path.join(AQUI, 'eletrico-fontes.ts'), c['preset'], os.path.join(pasta, 'orc') + os.sep, '--cada', '--rotulo', 'orc'] + c['render'], cwd=RAIZ, check=True, capture_output=True)
            subprocess.run([sys.executable, '-I', os.path.join(AQUI, 'ouvido', 'orcamento.py'), os.path.join(pasta, 'orc'), '--sem-figura'], cwd=RAIZ, check=False, capture_output=True)
        real = os.path.join(refs, c['real'])
        tr = tuple(c['trecho'])
        tit = c['titulo'] + (f" ({a.rotulo})" if a.rotulo else '')
        # ---- vida das linhas e piso, sem ciclo
        vf = c.get('vida', [100, 6000])
        mr = vm.medir(real, tr, 6, vf[0], vf[1]); ms = vm.medir(wav, None, 6, vf[0], vf[1])
        os.makedirs(os.path.join(pasta, 'vida'), exist_ok=True)
        vm.figura([mr, ms], ['REAL ' + mr['arquivo'], 'SIM ' + ms['arquivo'] + (' (SILÊNCIO DIGITAL)' if ms['mudo'] else '')], os.path.join(pasta, 'vida', 'vida.png'), tit)
        with open(os.path.join(pasta, 'vida', 'vida.json'), 'w') as fh:
            json.dump(nu.limpar({'titulo': tit, 'lados': [{k: v for k, v in m.items() if not k.startswith('_')} for m in (mr, ms)]}), fh, ensure_ascii=False, indent=1)
        lin = {'id': c['id'], 'titulo': c['titulo'], 'casada': c.get('casada', True), 'mudo': ms['mudo'],
               'nivel_real': [b['nivel'] for b in mr['bandas']], 'nivel_sim': [b['nivel'] for b in ms['bandas']],
               'hnr_real': [b['hnr'] for b in mr['bandas']], 'hnr_sim': [b['hnr'] for b in ms['bandas']],
               'hnr_curto_real': mr['hnr_curto'], 'hnr_curto_sim': ms['hnr_curto'],
               'piso_real': [b['piso'] for b in mr['bandas']], 'piso_sim': [b['piso'] for b in ms['bandas']],
               'planura_real': [b['planura'] for b in mr['bandas']], 'planura_sim': [b['planura'] for b in ms['bandas']],
               'vida_real': {k: vm.mediana_linhas(mr, k) for k in ('am_db', 'fm_cents', 'largura_hz', 'saia_db', 'sobre_db')},
               'vida_sim': {k: vm.mediana_linhas(ms, k) for k in ('am_db', 'fm_cents', 'largura_hz', 'saia_db', 'sobre_db')},
               'linhas10_real': mr['n_linhas_10db'], 'linhas10_sim': ms['n_linhas_10db']}
        # ---- kit ouvido (onde há um ciclo)
        if c.get('f0'):
            try:
                # o ciclo do simulado: o `f0sim` do caso (exato: render de velocidade imposta) ou, sem ele, a volta do eixo
                # que o render gravou no .json ao lado do WAV
                r = cp.executar(real, wav, os.path.join(pasta, 'cmp'), f0_real=c['f0'], f0_sim=c.get('f0sim'), fixo_sim='f0sim' in c, ev=1, voltas=1.0, trecho_real=tr,
                                fmin=c.get('fmin', 4.0), fmax=c.get('fmax', 60.0), folga=c.get('folga', 0.04), titulo=tit)
                comp = r['comp']
                R, S = r['real']['med'], r['sim']['med']
                lin.update({'total': comp['distancias']['total'], 'dist': comp['distancias'], 'ar': comp['defeitos']['ar'], 'tom_a_menos': comp['defeitos']['tom'],
                            'pulso_a_menos': comp['defeitos']['pulso'],
                            'kit_hnr_real': [b['hnr'] for b in R['bandas']], 'kit_hnr_sim': [b['hnr'] for b in S['bandas']],
                            'leito16_real': cp.leito_frac(R['faixa_1_6k']), 'leito16_sim': cp.leito_frac(S['faixa_1_6k'])})
            except Exception as e:  # (o kit é de regime: um trecho que ele não rastreia não derruba a régua)
                lin['erro_kit'] = str(e)[:200]
        linhas.append(lin)
        print(f"{c['id']}: HNR 400–1k {f(lin['hnr_real'][3])} / {f(lin['hnr_sim'][3])} · 1–2,5k {f(lin['hnr_real'][4])} / {f(lin['hnr_sim'][4])} · AM {f(lin['vida_real']['am_db'])} / {f(lin['vida_sim']['am_db'])} dB · "
              f"largura {f(lin['vida_real']['largura_hz'], 2)} / {f(lin['vida_sim']['largura_hz'], 2)} Hz" + (f" · ar {f(lin['ar'], 2)} · total {f(lin['total'], 2)}" if 'total' in lin else '') + '   (real / sim)', flush=True)
    with open(os.path.join(saida, 'resumo.json'), 'w') as fh:
        json.dump(nu.limpar({'rotulo': a.rotulo, 'casos': linhas, 'bandas': NOMES}), fh, ensure_ascii=False, indent=1)
    md = [f"# Régua do Elétrico{(' — ' + a.rotulo) if a.rotulo else ''}", '',
          'Gravação / simulado em cada célula. Nível e piso em dB relativos a 150–400 Hz; HNR = linhas ÷ piso (sem supor ciclo, tools/eletrico-vida.py) no espectro do trecho inteiro; HNR curto = o mesmo em quadros de ~170 ms (o que vale quando as linhas varrem: trem acelerando).', '']
    for l in linhas:
        md += [f"## {l['titulo']}" + ('' if l['casada'] else ' *(não casada: vale como faixa)*'), '']
        if l['mudo']:
            md += ['**O simulado é silêncio digital** (todas as amostras em zero): os números do lado dele abaixo não medem nada.', '']
        md += ['| banda | nível | HNR | HNR curto | piso | planura do piso |', '|---|---|---|---|---|---|']
        for i, n in enumerate(NOMES):
            md.append(f"| {n} | {f(l['nivel_real'][i])} / {f(l['nivel_sim'][i])} | {f(l['hnr_real'][i])} / {f(l['hnr_sim'][i])} | {f(l['hnr_curto_real'][i])} / {f(l['hnr_curto_sim'][i])} | {f(l['piso_real'][i])} / {f(l['piso_sim'][i])} | {f(l['planura_real'][i])} / {f(l['planura_sim'][i])} |")
        vr, vs = l['vida_real'], l['vida_sim']
        md += ['', f"Linhas (medianas das 6 mais fortes): AM {f(vr['am_db'])} / {f(vs['am_db'])} dB · FM {f(vr['fm_cents'])} / {f(vs['fm_cents'])} centésimos · largura {f(vr['largura_hz'], 2)} / {f(vs['largura_hz'], 2)} Hz · "
               f"saia {f(vr['saia_db'])} / {f(vs['saia_db'])} dB · sobre o piso {f(vr['sobre_db'])} / {f(vs['sobre_db'])} dB · linhas a mais de 10 dB do piso: {l['linhas10_real']} / {l['linhas10_sim']}"]
        if 'total' in l:
            d = l['dist']
            md += ['', f"Kit ouvido: total {f(l['total'], 2)} (tonal {f(d['tonal'], 2)}, piso {f(d['piso'], 2)}, envoltória {f(d['envoltoria'], 2)}, modulação {f(d['modulacao'], 2)}, eventos {f(d['eventos'], 2)}) · "
                   f"ar {f(l['ar'], 2)} · tom a menos {f(l['tom_a_menos'], 2)} · pulso a menos {f(l['pulso_a_menos'], 2)} · leito de 1–6 kHz {f(100 * l['leito16_real'], 0)}% / {f(100 * l['leito16_sim'], 0)}%"]
        if 'erro_kit' in l:
            md += ['', f"Kit ouvido: não rodou ({l['erro_kit']})"]
        md.append('')
    with open(os.path.join(saida, 'resumo.md'), 'w') as fh:
        fh.write('\n'.join(md))
    print(f"\ngravado: {os.path.join(saida, 'resumo.md')}")


if __name__ == '__main__':
    main()
