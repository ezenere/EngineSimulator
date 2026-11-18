#!/usr/bin/env python3
"""regua.py — roda a régua do kit ouvido: os carros do Ronco que o dono revisou de ouvido contra as suas gravações
(a faixa de "aprovado pelo ouvido"), e casos sabidamente ruins (para mostrar que o kit separa).

    python3 -I tools/ouvido/regua.py [--casos tools/ouvido/regua.json] [--saida PASTA] [--referencias PASTA] [--so id,id] [--dpi 100] [--sem-painel]

Para cada caso de `regua.json`: renderiza o preset na condição da gravação (`tools/ouvido/render.ts`), compara com o
trecho da gravação (`comparar.py`) e junta as distâncias numa tabela (`regua.md`, `regua.json` em PASTA; um painel por
caso em PASTA/<id>/). As gravações ficam fora do git, em `referencias/gasolina/` do checkout principal (ver o
`INDEX.md` de lá); `--referencias` aponta outra pasta.

Campos de um caso:
  id, grupo ("aprovado" | "ruim" | "extra"), titulo, nota
  real, trecho [a, b], rpm, ev (explosões por ciclo), canal (opcional), fmin/fmax (opcionais, para o rastreio)
  render: argumentos do render.ts depois do nome do arquivo (ex.: ["fusca", "--rpm", "1410"])
  fabricar (opcional): {"tipo": "alisar-ruido", "tonal": ["--sem", "ar,vazamento,mecanica"]}
      renderiza também sem as fontes de ruído; ruído = completo − sem; troca o ruído por um ruído LISO com o mesmo
      espectro de potência (fases embaralhadas) e soma de volta: as bandas médias não mudam, o pulso some
  sim (opcional): WAV já pronto em vez de `render` (ex.: um render de outro commit), com "f0_sim"/"fixo_sim"
"""
import argparse
import json
import os
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nucleo as nu  # noqa: E402
import sinteticos as si  # noqa: E402
import comparar as cp  # noqa: E402

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(os.path.dirname(AQUI))


def pasta_referencias():
    p = os.path.join(RAIZ, 'referencias', 'gasolina')
    if os.path.isdir(p):
        return p
    try:   # num worktree: o checkout principal é o pai do diretório git comum
        comum = subprocess.run(['git', '-C', RAIZ, 'rev-parse', '--path-format=absolute', '--git-common-dir'], capture_output=True, text=True, check=True).stdout.strip()
        return os.path.join(os.path.dirname(comum), 'referencias', 'gasolina')
    except (subprocess.CalledProcessError, OSError):
        return p


def render(args, saida):
    cmd = ['npx', 'tsx', os.path.join(AQUI, 'render.ts'), args[0], saida] + list(args[1:])
    r = subprocess.run(cmd, cwd=RAIZ, capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(saida):
        raise RuntimeError(f'render falhou: {" ".join(cmd)}\n{r.stdout}\n{r.stderr}')
    return r.stdout.strip().splitlines()[-1]


def preparar_sim(caso, pasta):
    """Devolve o caminho do WAV do simulado do caso (renderizando ou fabricando, se ainda não existe)."""
    os.makedirs(pasta, exist_ok=True)
    if caso.get('sim'):
        return caso['sim']
    wav = os.path.join(pasta, 'sim.wav')
    if not os.path.exists(wav):
        print('   ' + render(caso['render'], wav))
    fab = caso.get('fabricar')
    if not fab:
        return wav
    out = os.path.join(pasta, 'sim-fabricado.wav')
    if not os.path.exists(out):
        if fab['tipo'] == 'alisar-ruido':
            # o pedal do render completo vale para o render sem ruído (a carga não pode mudar)
            with open(wav[:-4] + '.json') as fh:
                info = json.load(fh)
            extra = ['--pedal', str(info['pedal'])] if info.get('fixo') and '--pedal' not in caso['render'] else []
            ton = os.path.join(pasta, 'sim-tonal.wav')
            print('   ' + render(list(caso['render']) + extra + list(fab['tonal']), ton))
            x, fs = nu.ler_audio(wav); t, _ = nu.ler_audio(ton)
            n = min(len(x), len(t))
            ruido = x[:n] - t[:n]
            y = t[:n] + si.embaralhar_fases(ruido)
            nu.gravar_wav(out, y, fs)
            info['fabricado'] = fab
            with open(out[:-4] + '.json', 'w') as fh:
                json.dump(info, fh, indent=1)
            print(f"   ruído (completo − sem {fab['tonal'][-1]}) trocado por ruído liso de mesmo espectro: {nu.db10(np.mean(ruido ** 2) / np.mean(x[:n] ** 2)):.1f} dB do total")
        else:
            raise ValueError(f"fabricar: tipo desconhecido {fab['tipo']}")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--casos', default=os.path.join(AQUI, 'regua.json'))
    ap.add_argument('--saida', help='padrão: <referências>/_regua (fora do git)')
    ap.add_argument('--referencias')
    ap.add_argument('--so')
    ap.add_argument('--dpi', type=int, default=100)
    ap.add_argument('--sem-painel', action='store_true')
    a = ap.parse_args()
    with open(a.casos) as fh:
        cfg = json.load(fh)
    refs = a.referencias or pasta_referencias()
    a.saida = a.saida or os.path.join(refs, '_regua')
    so = set(a.so.split(',')) if a.so else None
    linhas = []
    for caso in cfg['casos']:
        if so and caso['id'] not in so:
            continue
        print(f"== {caso['id']}: {caso['titulo']}")
        pasta = os.path.join(a.saida, caso['id'])
        real = caso['real'] if os.path.isabs(caso['real']) else os.path.join(refs, caso['real'])
        if not os.path.exists(real):
            print(f'   FALTA a gravação {real} (ver INDEX.md das referências)'); continue
        if caso.get('sim') and not os.path.isabs(caso['sim']):
            caso['sim'] = os.path.join(refs, caso['sim'])
        sim = preparar_sim(caso, pasta)
        v = float(caso.get('voltas', 2.0))
        r = cp.executar(real, sim, pasta, f0_real=caso['rpm'] / 60.0 / v if caso.get('rpm') else None, f0_sim=caso.get('f0_sim'), ev=caso.get('ev'), voltas=v,
                        fixo_sim=bool(caso.get('fixo_sim')), trecho_real=tuple(caso['trecho']) if caso.get('trecho') else None,
                        trecho_sim=tuple(caso['trecho_sim']) if caso.get('trecho_sim') else None, canal_real=caso.get('canal', 'media'),
                        fmin=caso.get('fmin', 4.0), fmax=caso.get('fmax', 60.0), dpi=a.dpi, titulo=caso['titulo'], painel=not a.sem_painel,
                        ancora=caso.get('ancora', 'auto'), pesos=caso.get('pesos', cp.PESOS), zoom=caso.get('zoom', 0.5))
        d = r['comp']['distancias']
        df = r['comp']['defeitos']
        R, S = r['real']['med'], r['sim']['med']
        linhas.append({'id': caso['id'], 'grupo': caso.get('grupo', 'aprovado'), 'titulo': caso['titulo'], 'rpm_real': R['rpm'], 'rpm_sim': S['rpm'],
                       'distancias': {k: d[k] for k in cp.COMPONENTES + ['total']}, 'defeitos': df, 'resumo': [x['texto'] for x in r['comp']['resumo']],
                       'leito_1_6k': [cp.leito_frac(R['faixa_1_6k']), cp.leito_frac(S['faixa_1_6k'])],
                       'hnr_real': [b['hnr'] for b in R['bandas']], 'hnr_sim': [b['hnr'] for b in S['bandas']],
                       'env_1_6k': {'p90_p10': [R['faixa_1_6k']['p90_p10'], S['faixa_1_6k']['p90_p10']], 'vao': [R['faixa_1_6k']['vao'], S['faixa_1_6k']['vao']],
                                    'frac_ciclo': [R['faixa_1_6k'].get('frac_ciclo'), S['faixa_1_6k'].get('frac_ciclo')]},
                       'avisos': r['comp']['avisos'], 'nota': caso.get('nota', '')})
        print('   ' + '  '.join(f"{cp.NOME_COMP[k]} {d[k]:.2f}" for k in cp.COMPONENTES) + f"  | total {d['total']:.2f}  ||  ar {df['ar']:.2f}  tom a menos {df['tom']:.2f}  pulso a menos {df['pulso']:.2f}")
        for x in r['comp']['resumo'][:3]:
            print('     · ' + x['texto'])
    # ---- tabela
    f = lambda v: '  -- ' if v is None or not np.isfinite(v) else f'{v:5.2f}'
    DEF = ['ar', 'tom', 'pulso']
    md = ['| caso | grupo | rpm real / sim | timbre tonal | piso de ruído | envoltória | modulação | eventos | total | ar (leito a mais) | tom a menos | pulso a menos | leito 1–6 kHz real / sim |',
          '|---|---|---|---|---|---|---|---|---|---|---|---|---|']
    for g in ('aprovado', 'extra', 'ruim'):
        for L in [x for x in linhas if x['grupo'] == g]:
            d = L['distancias']
            md.append(f"| {L['id']} | {g} | {L['rpm_real']:.0f} / {L['rpm_sim']:.0f} | " + ' | '.join(f(d[k]) for k in cp.COMPONENTES) + f" | {f(d['total'])} | "
                      + ' | '.join(f(L['defeitos'][k]) for k in DEF) + f" | {100 * L['leito_1_6k'][0]:.0f}% / {100 * L['leito_1_6k'][1]:.0f}% |")
    ap_ = [x for x in linhas if x['grupo'] == 'aprovado']
    faixa = {}
    if ap_:
        md.append('| **faixa dos aprovados (mín–máx)** | | | ' + ' | '.join(
            f"{min(x['distancias'][k] for x in ap_):.2f}–{max(x['distancias'][k] for x in ap_):.2f}" for k in cp.COMPONENTES + ['total']) + ' | '
            + ' | '.join(f"{min(x['defeitos'][k] for x in ap_):.2f}–{max(x['defeitos'][k] for x in ap_):.2f}" for k in DEF) + ' | |')
        faixa = {k: [min(x['distancias'][k] for x in ap_), max(x['distancias'][k] for x in ap_)] for k in cp.COMPONENTES + ['total']}
        faixa.update({k: [min(x['defeitos'][k] for x in ap_), max(x['defeitos'][k] for x in ap_)] for k in DEF})
    os.makedirs(a.saida, exist_ok=True)
    with open(os.path.join(a.saida, 'regua.md'), 'w') as fh:
        fh.write('\n'.join(md) + '\n')
    with open(os.path.join(a.saida, 'regua.json'), 'w') as fh:
        json.dump(nu.limpar({'casos': linhas, 'faixa_aprovados': faixa}), fh, ensure_ascii=False, indent=1)
    print('\n' + '\n'.join(md))
    print(f"\ngravado em {a.saida}/: regua.md, regua.json e um painel por caso")


if __name__ == '__main__':
    main()
