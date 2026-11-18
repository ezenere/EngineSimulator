#!/usr/bin/env python3
"""Baixa e converte as gravações de referência a partir de `lista.json`.

Uso (sempre com -I: os arquivos baixados são dados não confiáveis):

  python3 -I tools/referencias/baixar.py                 # tudo o que falta
  python3 -I tools/referencias/baixar.py --familia diesel
  python3 -I tools/referencias/baixar.py --slug hilux-1gd-lenta-cofre --forcar
  python3 -I tools/referencias/baixar.py --avulso URL --saida PASTA [--corte 30 90]

Cada item vira `referencias/<familia>/<slug>.wav` (mono, 48 kHz, 16 bits, até 240 s) e
`referencias/_meta/<familia>/<slug>.json` (o que se soube da fonte: título, canal, licença,
codec, se o vídeo tem legenda automática, clipping por canal antes da mixagem para mono).
O original bruto é apagado depois da conversão. O que já existe é pulado.

A pasta `referencias/` fica na raiz do checkout principal (fora do git). Outro lugar:
`--destino PASTA` ou a variável `ENGINE_REFERENCIAS`.

Dependências: yt-dlp, ffmpeg, ffprobe e numpy. Nada do que é baixado é executado: o
bruto vai para uma pasta própria e vazia (`referencias/_bruto/<slug>/`), só é lido pelo
ffmpeg (protocolo `file`) e pelo `json` da biblioteca padrão.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
LISTA = os.path.join(AQUI, 'lista.json')
AGENTE = 'EngineReferencias/1.0 (acervo privado de analise de audio; python-urllib)'
DUR_MAX = 240.0
FS = 48000


def raiz_principal() -> str:
    """Raiz do checkout principal (o pai do diretório git comum), mesmo de dentro de um worktree."""
    try:
        comum = subprocess.run(['git', '-C', AQUI, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
                               capture_output=True, text=True, check=True).stdout.strip()
        if comum:
            return os.path.dirname(comum)
    except Exception:
        pass
    return os.path.dirname(os.path.dirname(AQUI))


def pasta_referencias(arg: str | None = None) -> str:
    return os.path.abspath(arg or os.environ.get('ENGINE_REFERENCIAS') or os.path.join(raiz_principal(), 'referencias'))


def carrega_lista(caminho: str = LISTA) -> dict:
    with open(caminho, encoding='utf-8') as f:
        return json.load(f)


def roda(cmd: list[str], limite: float = 900.0) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=limite)


def id_youtube(url: str) -> str | None:
    m = re.search(r'(?:v=|youtu\.be/|shorts/)([A-Za-z0-9_-]{11})', url)
    return m.group(1) if m else None


def titulo_commons(url: str) -> str | None:
    m = re.search(r'commons\.wikimedia\.org/wiki/(File(?::|%3A).+)$', url)
    if not m:
        return None
    return urllib.parse.unquote(m.group(1)).replace('_', ' ')


# ---------------------------------------------------------------------------------------------
# Download


def legendas_youtube(url: str, pasta: str, idioma: str | None, corte: tuple[float, float]) -> dict | None:
    """Tempos da legenda automática dentro do corte, em segundos do WAV. Serve para saber ONDE há fala
    (frases densas) ou música ("[Music]"); o reconhecedor também inventa palavras soltas em cima de motor."""
    if not idioma:
        return None
    sub = os.path.join(pasta, 'leg')
    os.makedirs(sub, exist_ok=True)
    roda(['yt-dlp', '--ignore-config', '--no-playlist', '--no-warnings', '--skip-download', '--write-auto-subs',
          '--sub-langs', idioma, '--sub-format', 'json3', '-o', os.path.join(sub, 'l'), url], limite=120.0)
    arqs = [f for f in os.listdir(sub) if f.endswith('.json3')]
    if not arqs:
        return {'idioma': idioma, 'erro': 'não foi possível baixar a legenda'}
    try:
        with open(os.path.join(sub, arqs[0]), encoding='utf-8') as f:
            eventos = json.load(f).get('events') or []
    except Exception:
        return {'idioma': idioma, 'erro': 'legenda ilegível'}
    trechos, palavras, musica = [], 0, 0.0
    for e in eventos:
        txt = ''.join(s.get('utf8', '') for s in e.get('segs') or []).strip()
        if not txt:
            continue
        t0 = e.get('tStartMs', 0) / 1000.0
        t1 = t0 + (e.get('dDurationMs') or 0) / 1000.0
        if t1 <= corte[0] or t0 >= corte[1]:
            continue
        marca = bool(re.fullmatch(r'[\[(].*[\])]', txt))
        if marca:
            musica += min(t1, corte[1]) - max(t0, corte[0]) if re.search(r'music|música|musik|musique|音楽', txt, re.I) else 0.0
        else:
            palavras += len(txt.split())
        trechos.append([round(max(0.0, t0 - corte[0]), 1), round(min(t1, corte[1]) - corte[0], 1), txt[:60]])
    dur = max(1.0, corte[1] - corte[0])
    shutil.rmtree(sub, ignore_errors=True)
    return {'idioma': idioma, 'palavras': palavras, 'palavrasPorMin': round(palavras * 60.0 / dur, 1),
            'segundosMarcadosMusica': round(musica, 1), 'trechos': trechos[:60]}


def baixa_youtube(url: str, pasta: str, corte: tuple[float, float]) -> tuple[str, dict, float]:
    """Baixa o melhor áudio sem DRC. Devolve (arquivo bruto, metadados, deslocamento do bruto em s).

    Vídeo longo (bruto > 40 MB) não é baixado inteiro: só a seção pedida, e então o bruto já
    começa em `corte[0]` (deslocamento = corte[0])."""
    fmt = 'bestaudio[format_id!*=drc]/bestaudio'
    base = ['yt-dlp', '--ignore-config', '--no-playlist', '--no-progress', '--no-warnings',
            '--retries', '5', '--fragment-retries', '5', '--socket-timeout', '30',
            '-f', fmt, '--write-info-json', '--no-write-comments', '--no-mtime',
            '-o', os.path.join(pasta, 'bruto.%(ext)s')]
    def brutos():
        return [f for f in os.listdir(pasta) if f.startswith('bruto.') and not f.endswith(('.json', '.part', '.ytdl'))]

    for tentativa in range(4):   # o YouTube devolve 403 de vez em quando; passa na tentativa seguinte
        r = roda(base + ['--max-filesize', '40M', url])
        if brutos() or '403' not in (r.stdout + r.stderr):
            break
        time.sleep(6 + 6 * tentativa)
    achou = brutos()
    desloc = 0.0
    if not achou:
        if r.returncode != 0 and 'max-filesize' not in (r.stdout + r.stderr):
            raise RuntimeError('yt-dlp: ' + (r.stderr or r.stdout).strip()[-400:])
        for f in os.listdir(pasta):
            if not f.endswith('.info.json'):
                os.remove(os.path.join(pasta, f))
        r = roda(base + ['--download-sections', f'*{corte[0]:.3f}-{corte[1]:.3f}', url], limite=1800.0)
        achou = [f for f in os.listdir(pasta) if f.startswith('bruto.') and not f.endswith(('.json', '.part', '.ytdl'))]
        if not achou:
            raise RuntimeError('yt-dlp (seção): ' + (r.stderr or r.stdout).strip()[-400:])
        desloc = corte[0]
    meta: dict = {}
    info = os.path.join(pasta, 'bruto.info.json')
    if os.path.exists(info):
        with open(info, encoding='utf-8') as f:
            j = json.load(f)
        auto = j.get('automatic_captions') or {}
        meta = {
            'id': j.get('id'),
            'titulo': j.get('title'),
            'autor': j.get('channel') or j.get('uploader'),
            'duracaoOriginal': j.get('duration'),
            'dataEnvio': j.get('upload_date'),
            'formato': {'id': j.get('format_id'), 'codec': j.get('acodec'), 'kbps': j.get('abr'), 'hz': j.get('asr')},
            # o YouTube só gera legenda automática quando acha que ouviu fala (ou música: "[Music]")
            'legendasAuto': bool(auto),
            'idiomaLegendaAuto': next((k for k in auto if k.endswith('-orig')), None) or (sorted(auto)[0] if auto else None),
            'legendasManuais': sorted((j.get('subtitles') or {}).keys())[:8],
            'legendas': legendas_youtube(url, pasta, next((k for k in auto if k.endswith('-orig')), None)
                                         or (sorted(auto)[0] if auto else None),
                                         (corte[0], min(corte[1], float(j.get('duration') or corte[1])))) if auto else None,
            'categorias': j.get('categories'),
            'musicaDeclarada': [j.get(k) for k in ('track', 'artist') if j.get(k)] or None,
            'descricao': (j.get('description') or '')[:600],
        }
    return os.path.join(pasta, achou[0]), meta, desloc


_trava_commons = threading.Lock()
_ultimo_commons = [0.0]


def pede_commons(url: str, destino: str | None = None, limite: float = 120.0):
    """Um pedido de cada vez ao Wikimedia, com pelo menos 1,5 s entre eles; no 429 espera o
    `Retry-After` e tenta de novo (o Commons corta quem pede em rajada)."""
    with _trava_commons:
        for tentativa in range(6):
            espera = 1.5 - (time.time() - _ultimo_commons[0])
            if espera > 0:
                time.sleep(espera)
            try:
                req = urllib.request.Request(url, headers={'User-Agent': AGENTE})
                with urllib.request.urlopen(req, timeout=limite) as resp:
                    if destino:
                        with open(destino, 'wb') as g:
                            shutil.copyfileobj(resp, g, 1 << 20)
                        return None
                    return json.load(resp)
            except urllib.error.HTTPError as e:
                if e.code not in (429, 503) or tentativa == 5:
                    raise
                try:
                    pausa = float(e.headers.get('Retry-After') or 0)
                except ValueError:
                    pausa = 0.0
                time.sleep(min(180.0, max(pausa, 10.0 * (tentativa + 1))))
            except (urllib.error.URLError, TimeoutError):
                if tentativa == 5:
                    raise
                time.sleep(5 + 5 * tentativa)
            finally:
                _ultimo_commons[0] = time.time()
    return None


def api_commons(titulo: str) -> dict:
    q = urllib.parse.urlencode({'action': 'query', 'format': 'json', 'prop': 'imageinfo',
                                'iiprop': 'url|size|mime|extmetadata', 'titles': titulo})
    j = pede_commons('https://commons.wikimedia.org/w/api.php?' + q, limite=60.0) or {}
    paginas = j.get('query', {}).get('pages', {})
    for p in paginas.values():
        ii = (p.get('imageinfo') or [None])[0]
        if ii:
            return {'titulo': p.get('title'), **ii}
    raise RuntimeError('Commons: arquivo não encontrado: ' + titulo)


def sem_html(s: str | None) -> str | None:
    if s is None:
        return None
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', s)).strip()


def baixa_commons(url: str, pasta: str) -> tuple[str, dict, float]:
    titulo = titulo_commons(url)
    if not titulo:
        raise RuntimeError('URL do Commons não reconhecida: ' + url)
    ii = api_commons(titulo)
    em = ii.get('extmetadata') or {}
    ext = os.path.splitext(urllib.parse.urlparse(ii['url']).path)[1].lower() or '.bin'
    if not re.fullmatch(r'\.[a-z0-9]{2,5}', ext):
        ext = '.bin'
    destino = os.path.join(pasta, 'bruto' + ext)
    pede_commons(ii['url'], destino, limite=300.0)
    meta = {
        'id': ii.get('titulo'),
        'titulo': ii.get('titulo'),
        'autor': sem_html((em.get('Artist') or {}).get('value')),
        'licenca': sem_html((em.get('LicenseShortName') or {}).get('value')),
        'creditoPedido': sem_html((em.get('Credit') or {}).get('value')),
        'descricao': (sem_html((em.get('ImageDescription') or {}).get('value')) or '')[:600],
        'mime': ii.get('mime'),
        'bytesOriginal': ii.get('size'),
        'legendasAuto': None,
    }
    return destino, meta, 0.0


# ---------------------------------------------------------------------------------------------
# Conversão


def sonda(caminho: str) -> dict:
    r = roda(['ffprobe', '-v', 'error', '-protocol_whitelist', 'file', '-select_streams', 'a:0',
              '-show_entries', 'stream=codec_name,sample_rate,channels,bit_rate:format=duration,bit_rate',
              '-of', 'json', caminho])
    try:
        j = json.loads(r.stdout or '{}')
    except Exception:
        j = {}
    st = (j.get('streams') or [{}])[0]
    fm = j.get('format') or {}

    def num(v):
        try:
            return float(v)
        except Exception:
            return None
    return {'codec': st.get('codec_name'), 'hz': num(st.get('sample_rate')), 'canais': st.get('channels'),
            'kbps': (num(st.get('bit_rate')) or num(fm.get('bit_rate')) or 0) / 1000 or None,
            'duracao': num(fm.get('duration'))}


def empilhado(a, limiar: float, fator: float = 2.5) -> float:
    """% de amostras acima do limiar, contadas só se estiverem EMPILHADAS ali: pelo menos `fator`
    vezes as da faixa de 1,5 % logo abaixo. Sinal sem clipping rareia perto do pico; uma senoide
    limpa tem 1,7 vez; teto cortado (mesmo depois do codec) passa de 3."""
    import numpy as np
    topo = float(np.mean(a >= limiar))
    viz = float(np.mean((a >= 0.985 * limiar) & (a < limiar)))
    return 100.0 * topo if topo > fator * viz else 0.0


def clipping_do_bruto(caminho: str, ini: float, dur: float) -> dict | None:
    """Clipping medido no bruto decodificado em ponto flutuante, canal a canal, antes da mixagem para
    mono (que o esconderia). O fundo de escala do original é 1,0: o decodificador de um original
    cortado passa disso (pico > 1). Devolve também o pico da mixagem mono, para o ganho da conversão."""
    try:
        import numpy as np
    except Exception:
        return None
    r = subprocess.run(['ffmpeg', '-v', 'error', '-protocol_whitelist', 'file', '-i', caminho, '-ss', f'{ini:.3f}',
                        '-t', f'{dur:.3f}', '-vn', '-ac', '2', '-f', 'f32le', '-'], capture_output=True, timeout=600)
    x = np.frombuffer(r.stdout, dtype='<f4')
    if x.size < 2000:
        return None
    x = x[: x.size // 2 * 2].reshape(-1, 2)
    saida = {'pico': [], 'pctFS': [], 'pctPico': []}
    for c in range(2):
        a = np.abs(x[:, c])
        pico = float(a.max())
        saida['pico'].append(round(pico, 4))
        # no fundo de escala do original (>= 0,99) e, para corte feito antes de uma atenuação, no pico
        saida['pctFS'].append(round(empilhado(a, 0.99), 4) if pico >= 0.99 else 0.0)
        saida['pctPico'].append(round(empilhado(a, 0.985 * pico, 3.0), 4) if 0 < pico < 0.99 else 0.0)
    dif = float(np.sqrt(np.mean((x[:, 0] - x[:, 1]) ** 2)))
    som = float(np.sqrt(np.mean((x[:, 0] + x[:, 1]) ** 2))) + 1e-12
    saida['difEstereo'] = round(dif / som, 3)   # 0 = mono duplicado; > 1 = canais quase em oposição
    saida['picoMono'] = round(float(np.abs(x.mean(axis=1)).max()), 5)
    return saida


def converte(bruto: str, wav: str, ini: float, dur: float, ganho_db: float = 0.0) -> None:
    filtro = ['-af', f'volume={ganho_db:.2f}dB'] if abs(ganho_db) > 0.01 else []
    cmd = ['ffmpeg', '-v', 'error', '-y', '-protocol_whitelist', 'file', '-i', bruto, '-ss', f'{ini:.3f}',
           '-t', f'{dur:.3f}', '-vn', '-ac', '1', '-ar', str(FS), *filtro, '-c:a', 'pcm_s16le', wav]
    r = roda(cmd)
    if r.returncode != 0 or not os.path.exists(wav) or os.path.getsize(wav) < 4096:
        raise RuntimeError('ffmpeg: ' + r.stderr.strip()[-300:])


def ganho_de_normalizacao(pico_mono: float | None) -> float:
    """Ganho (dB) que leva o pico da mixagem mono a -1 dBFS. Dois motivos: o original decodificado
    pode passar de 1,0 e seria cortado ao virar 16 bits; e gravação baixa perderia o agudo no piso
    dos 16 bits. O ganho fica anotado no índice (nível absoluto de vídeo não vale nada mesmo)."""
    if not pico_mono or pico_mono <= 1e-5:
        return 0.0
    import math
    return max(-20.0, min(40.0, -1.0 - 20.0 * math.log10(pico_mono)))


def processa(url: str, wav: str, meta_json: str | None, bruto_dir: str, corte=None, ganho_db: float | None = None) -> dict:
    """Baixa, corta, normaliza o pico a -1 dBFS (ou aplica `ganho_db`, se dado) e grava WAV + metadados."""
    corte = tuple(corte) if corte else (0.0, DUR_MAX)
    ini, fim = float(corte[0]), float(corte[1])
    if fim - ini > DUR_MAX:
        fim = ini + DUR_MAX
    if os.path.isdir(bruto_dir):
        shutil.rmtree(bruto_dir)
    os.makedirs(bruto_dir)
    try:
        if id_youtube(url) and 'wikimedia' not in url:
            bruto, meta, desloc = baixa_youtube(url, bruto_dir, (ini, fim))
            meta.setdefault('licenca', 'YouTube (referência privada)')
            meta['tipo'] = 'youtube'
        else:
            bruto, meta, desloc = baixa_commons(url, bruto_dir)
            meta['tipo'] = 'commons'
        s = sonda(bruto)
        meta['bruto'] = s
        ini_b = max(0.0, ini - desloc)
        cb = clipping_do_bruto(bruto, ini_b, fim - ini)
        meta['clippingBruto'] = cb
        if ganho_db is None:
            ganho_db = round(ganho_de_normalizacao((cb or {}).get('picoMono')), 2)
        os.makedirs(os.path.dirname(wav), exist_ok=True)
        tmp = wav + '.parcial.wav'
        converte(bruto, tmp, ini_b, fim - ini, ganho_db)
        os.replace(tmp, wav)
        meta['fonte'] = url
        meta['corte'] = [ini, fim]
        meta['ganhoDb'] = ganho_db
        meta['baixadoEm'] = time.strftime('%Y-%m-%d')
        if meta_json:
            os.makedirs(os.path.dirname(meta_json), exist_ok=True)
            with open(meta_json, 'w', encoding='utf-8') as g:
                json.dump(meta, g, ensure_ascii=False, indent=1)
        return meta
    finally:
        shutil.rmtree(bruto_dir, ignore_errors=True)


def um_item(item: dict, ref: str, forcar: bool) -> tuple[str, str]:
    fam, slug = item['familia'], item['slug']
    wav = os.path.join(ref, fam, slug + '.wav')
    meta = os.path.join(ref, '_meta', fam, slug + '.json')
    if os.path.exists(wav) and os.path.exists(meta) and not forcar:
        return slug, 'já existe'
    try:
        processa(item['fonte'], wav, meta, os.path.join(ref, '_bruto', f'{fam}__{slug}'), item.get('corte'),
                 float(item['ganhoDb']) if item.get('ganhoDb') is not None else None)
        return slug, 'ok'
    except Exception as e:  # noqa: BLE001
        return slug, 'FALHOU: ' + str(e).replace('\n', ' ')[:300]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--lista', default=LISTA)
    ap.add_argument('--destino', help='pasta das referências (padrão: <checkout principal>/referencias)')
    ap.add_argument('--familia', action='append')
    ap.add_argument('--slug', action='append')
    ap.add_argument('--forcar', action='store_true', help='baixa de novo mesmo que o WAV exista')
    ap.add_argument('--paralelo', type=int, default=3)
    ap.add_argument('--origem', choices=['youtube', 'commons'], help='baixa só o que vem dessa origem '
                    '(o Commons limita a taxa: se devolver 429, rode de novo mais tarde só com --origem commons)')
    ap.add_argument('--avulso', help='URL avulsa (triagem de candidatos), fora da lista')
    ap.add_argument('--saida', help='pasta de saída do --avulso')
    ap.add_argument('--nome', help='nome do WAV do --avulso (sem extensão)')
    ap.add_argument('--corte', nargs=2, type=float, metavar=('INI', 'FIM'))
    a = ap.parse_args()

    if a.avulso:
        if not a.saida:
            ap.error('--avulso pede --saida')
        nome = a.nome or id_youtube(a.avulso) or re.sub(r'[^A-Za-z0-9]+', '_', a.avulso)[-60:]
        saida = os.path.abspath(a.saida)
        try:
            m = processa(a.avulso, os.path.join(saida, nome + '.wav'), os.path.join(saida, '_meta', nome + '.json'),
                         os.path.join(saida, '_bruto', nome), a.corte)
            print(f"ok {nome}: {m.get('titulo')!r} [{m.get('autor')}] {m.get('bruto')}")
            return 0
        except Exception as e:  # noqa: BLE001
            print(f'FALHOU {nome}: {e}', file=sys.stderr)
            return 1

    ref = pasta_referencias(a.destino)
    itens = carrega_lista(a.lista)['itens']
    if a.familia:
        itens = [i for i in itens if i['familia'] in a.familia]
    if a.slug:
        itens = [i for i in itens if i['slug'] in a.slug]
    if a.origem:
        itens = [i for i in itens if ('wikimedia' in i['fonte']) == (a.origem == 'commons')]
    os.makedirs(ref, exist_ok=True)
    # a pasta inteira fica fora do git, mesmo que o .gitignore da raiz falhe
    gi = os.path.join(ref, '.gitignore')
    if not os.path.exists(gi):
        with open(gi, 'w') as g:
            g.write('# gravações de terceiros: uso privado de análise, nunca vão para o git\n*\n')
    falhas = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, a.paralelo)) as ex:
        for slug, estado in ex.map(lambda it: um_item(it, ref, a.forcar), itens):
            if estado != 'já existe':
                print(f'{slug}: {estado}', flush=True)
            falhas += estado.startswith('FALHOU')
    shutil.rmtree(os.path.join(ref, '_bruto'), ignore_errors=True)
    print(f'{len(itens)} itens, {falhas} falhas; acervo em {ref}')
    return 1 if falhas else 0


if __name__ == '__main__':
    sys.exit(main())
