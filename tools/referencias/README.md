# Gravações de referência

O acervo de gravações reais que serve de alvo para acertar o som fica em `referencias/`, na raiz do
checkout principal, **fora do git** (uso privado de análise: nada dali vai para o repositório nem para
o site; o que vem do YouTube não pode ser redistribuído). Aqui ficam só os links e as ferramentas, para
refazer o acervo se ele se perder.

| Arquivo | O que é |
|---|---|
| `lista.json` | Uma entrada por gravação: família, slug, URL, corte do original, motor, trechos anotados (tempos, o que se ouve, posição do microfone, rotação e como foi estimada). Também guarda as fontes já avaliadas e **descartadas**, com o motivo |
| `baixar.py` | Baixa (yt-dlp ou API do Commons), corta, mistura para mono, normaliza o pico a −1 dBFS e grava `referencias/<familia>/<slug>.wav` (48 kHz, 16 bits, até 240 s). Apaga o bruto. Pula o que já existe |
| `medir.py` | Mede a qualidade de cada arquivo e as bandas e o ritmo de cada trecho; gera `referencias/index.json` (para programa) e `referencias/INDEX.md` (para gente) |

```
python3 -I tools/referencias/baixar.py                 # rebaixa o que falta
python3 -I tools/referencias/baixar.py --origem commons  # só o Wikimedia Commons (ver abaixo)
python3 -I tools/referencias/medir.py                  # refaz index.json e INDEX.md (alguns minutos)
python3 -I tools/referencias/medir.py --familia diesel # só uma família (o resto do índice fica)
python3 -I tools/referencias/medir.py --sugerir X.wav  # resumo do arquivo em trechos estáveis
python3 -I tools/referencias/medir.py --arquivo X.wav --trecho 24 36 --ign-por-volta 2 --faixa-rpm 600 1100
python3 -I tools/referencias/medir.py --espectrograma X.wav --png /tmp/x.png
python3 -I tools/referencias/baixar.py --avulso URL --saida PASTA   # candidato novo, fora da lista
```

Dependências: `yt-dlp`, `ffmpeg`, Python com `numpy`, `scipy` (e `matplotlib` para o espectrograma).
Os arquivos baixados são dados não confiáveis: rode sempre com `python3 -I`, nunca de dentro de
`referencias/`, e não execute nada que venha de lá.

O que fica em `referencias/`: `<familia>/<slug>.wav`, `_meta/<familia>/<slug>.json` (o que se soube
da fonte: título, canal, licença, codec, legenda automática, clipping por canal, ganho aplicado),
`index.json`, `INDEX.md` e um `.gitignore` com `*` (proteção a mais contra `git add`).

**Wikimedia Commons.** O servidor de arquivos do Commons limita a taxa com rigor: bastam alguns
pedidos em paralelo para ele responder 429 por horas. O `baixar.py` faz um pedido de cada vez, com
1,5 s de intervalo, e respeita o `Retry-After`; se mesmo assim vier 429, as entradas do Commons ficam
na lista (o `medir.py` as mostra como "sem WAV") e basta rodar `--origem commons` mais tarde.

**Trechos recomendados.** `lista.json` → `destaques` aponta, condição por condição, os melhores
trechos das famílias que vão primeiro para a etapa de som (diesel com turbo, diesel aspirado para
contraste e os rotativos da Mazda); o `medir.py` os põe no topo do `INDEX.md`.

**O turbo.** Em todo trecho de motor o `medir.py` segue o tom estreito mais proeminente de 2 a 19 kHz
(`medidas.tomAgudo`): por onde anda (p10/p50/p90), em que fração do trecho aparece, quanto sobressai
do fundo local e o nível relativo à banda das ordens (150–400 Hz). Tom fixo em 15–17 kHz costuma ser
eletrônica da câmera.

## Critério de entrada (medido, não pelo título)

- **Banda útil ≥ 15 kHz**, medida nos trechos anotados (vale o melhor deles: um vídeo pode ter vinheta
  com música de banda cheia e o motor cortado em 6 kHz). `falesiaHz` é onde a média do último 1 kHz
  fica ≥ 20 dB acima do que vem logo depois e do percentil 90 de todo o resto (Opus do YouTube: 20 kHz;
  AAC: 15,5–16 kHz; vídeo antigo reamostrado: 4–11 kHz). O percentil, e não o máximo, porque um apito
  de eletrônica acima do corte esconderia o passa-baixa. Sem falésia, vale `conteudoAteHz` (onde o
  agudo some no piso, sem prova de filtro: gravação distante perde o agudo pelo ar).
- **Clipping < 0,1 %**, medido no original decodificado em ponto flutuante, canal a canal: amostras
  empilhadas no fundo de escala (≥ 0,99) ou no pico. Um original cortado decodifica com pico > 1.
- **Sem fala nem música nos trechos anotados.** A legenda automática do YouTube dá os tempos da fala
  (e marca `[Music]`); também se mede a modulação silábica (2,5–7 Hz) e se olha o espectrograma dos
  duvidosos. O reconhecedor inventa palavras soltas em cima de motor: conta a densidade (palavras/min).
- **Grave presente** (30–100 Hz relativo a 150–400 Hz) e **sem vento** (grave estável em janelas de 0,1 s).
- **Rotação ou velocidade identificável.** Para motor: pente das harmônicas da ignição dentro de uma
  faixa plausível dada à mão, conferido com a taxa de repetição da envoltória de 1–4 kHz e com o teste
  da dobra (ver `docs/REVISAO-DE-SOM.md` → Armadilhas). A rotação anotada vale; a automática fica ao
  lado, com o apoio que teve, para qualquer um conferir.

`baixaQualidade: true` = não cumpre o critério, mas é a única fonte de algo essencial; o motivo vai
junto. Tudo o mais que não passa sai da lista e entra em `descartados`.

## Como acrescentar uma gravação

1. `baixar.py --avulso URL --saida /algum/rascunho` e `medir.py --arquivo` no WAV: passa no critério?
2. `medir.py --sugerir` (com `--ign-por-volta` e `--faixa-rpm`) para achar os trechos estáveis;
   `--arquivo X.wav --trecho a b ...` para conferir a rotação de cada um.
3. Entrada nova em `lista.json` (slug curto e descritivo, trechos com `rotulo`, `oQue`, `posicao`,
   `rpm`/`ignHz`/`comoRpm`), depois `baixar.py` e `medir.py`.
