# Kit ouvido

Instrumento para comparar o som do simulador com uma gravação **do jeito que o ouvido compara**. Nasceu na rodada de
auditoria e som (`docs/PLANO.md`, regras 2, 4 e 5): sete famílias de motor tinham sido ajustadas contra tabelas de
bandas médias e saíram com "som de ar", "som de mar", "aspirador de pó", "pipoco", "sem peso". O defeito comum era
ruído largo e contínuo dominando, com o tonal e o impulsivo fracos embaixo, e as medidas usadas não enxergavam isso:
uma banda média não distingue um chiado liso de um chiado colado ao pulso, nem um espectro de linhas de um espectro
de ruído com a mesma energia.

O kit mede o que a tabela de bandas não mede: quanto de cada banda é **linha do motor** e quanto é **ruído entre as
linhas** (HNR), quanto desse ruído é um **leito contínuo** que enche o silêncio entre as explosões, como a
**envoltória** pulsa, que **ritmo** do motor a modula, o que há de **estalo** e de **irregularidade**, e se existe
algum **tom que não é ordem**. Entrega um painel lado a lado para olhar, números por banda, distâncias por componente
e cinco linhas dizendo o que o simulado tem a mais e a menos que o real.

Quem decide continua sendo o ouvido do dono. O kit diz onde olhar e se a mudança foi na direção certa.

- [Uso rápido](#uso-rápido)
- [Os programas](#os-programas)
- [Como ler o painel](#como-ler-o-painel)
- [O que cada medida pega, e o que não pega](#o-que-cada-medida-pega-e-o-que-não-pega)
- [Distâncias e defeitos](#distâncias-e-defeitos)
- [A régua](#a-régua)
- [Orçamento de ruído](#orçamento-de-ruído)
- [Validação](#validação)
- [Limitações](#limitações)
- [Quando usar `tools/analise-som` e quando usar o kit](#quando-usar-toolsanalise-som-e-quando-usar-o-kit)

## Uso rápido

Python 3 com numpy, scipy e matplotlib; nenhuma outra dependência. Rode sempre com `python3 -I` (modo isolado: os
arquivos de áudio baixados são dados não confiáveis, e nenhum script roda de dentro da pasta deles).

```
# 1. achar na gravação os trechos estáveis e a rotação (varre o arquivo em blocos)
python3 -I tools/ouvido/f0.py referencias/gasolina/fusca-1300-1984_X0cGCi_pWLA.wav --linha-do-tempo

# 2. conferir o ciclo no trecho escolhido (tabela da dobra em N períodos)
python3 -I tools/ouvido/f0.py referencias/gasolina/fusca-1300-1984_X0cGCi_pWLA.wav --trecho 44-54

# 3. renderizar o preset na mesma condição (Ronco; as outras famílias usam o render delas)
npx tsx tools/ouvido/render.ts fusca /tmp/fusca.wav --rpm 1410

# 4. comparar: painel.png, medidas.json e resumo.txt na pasta de saída
python3 -I tools/ouvido/comparar.py referencias/gasolina/fusca-1300-1984_X0cGCi_pWLA.wav /tmp/fusca.wav \
        --trecho-real 44-54 --rpm-real 1410 --eventos-por-ciclo 4 --saida /tmp/fusca-1410/

# 5. de que fonte vem o ruído (mesma semente, uma fonte desligada por vez)
npx tsx tools/ouvido/render.ts fusca /tmp/orc/ --cada --rpm 1410
python3 -I tools/ouvido/orcamento.py /tmp/orc/

# conferir o próprio kit, e refazer a régua
npm run ouvido:teste
python3 -I tools/ouvido/regua.py
```

**Olhe o painel** (leia o PNG) antes e depois de mexer no som, e ponha-o no relatório. O resumo em texto aponta; o
painel mostra.

Regras de uso que evitam conclusão errada (as do `docs/REVISAO-DE-SOM.md`, que o kit não dispensa):

- **Condição casada.** Mesma rotação (±7%), mesma carga, mesma posição. O `comparar.py` avisa quando a rotação não bate.
- **Passe a rotação quando souber** (`--rpm-real`, `--f0-real`). Errar o ciclo por um fator inverte as conclusões.
  Sem ela o `f0.py` rastreia, com salvaguardas, e diz o que achou.
- **Duas condições, nunca uma.** Lenta e carga, ou duas rotações.
- **Compare o motor sozinho.** O `render.ts` desliga o som de ambiente por padrão (ele enche o agudo com ruído liso).
- **Acima de 6 kHz vale a física**, não a gravação comprimida: a banda de 6–12 kHz sai nas tabelas e não entra nas
  distâncias.

## Os programas

| Arquivo | O que faz |
|---|---|
| `comparar.py` | Compara REAL × SIM: painel, `medidas.json`, distâncias por componente, defeitos de um lado só e o resumo priorizado |
| `f0.py` | Rastreia a rotação (f0 do ciclo) com três estimadores que se conferem; `--linha-do-tempo` varre uma gravação longa |
| `orcamento.py` | Orçamento de ruído por fonte: fração da potência por banda, ponderada A e do vão; fração estocástica com duas sementes |
| `render.ts` | Renderiza um preset do **Ronco** em giro travado (quente ou frio), lenta livre ou partida a frio; `--cada` grava o conjunto do orçamento |
| `regua.py` + `regua.json` | Roda todos os casos da régua e monta a tabela |
| `autoteste.py` | 32 conferências com resposta plantada (`npm run ouvido:teste`) |
| `nucleo.py` | As medidas (funções puras): reamostragem síncrona, HNR, leito, envoltória, modulação, eventos, tons |
| `painel.py` | Desenha o painel; `python3 -I tools/ouvido/painel.py painel.png saida.png` faz a versão pequena para documentação |
| `sinteticos.py` | Sinais de resposta conhecida (série harmônica, ruído liso, ruído modulado no ciclo, fases embaralhadas) |

Cada um tem `--help` com todas as opções. O essencial:

**`comparar.py REAL.wav SIM.wav --saida pasta/`**
`--f0-real Hz --f0-sim Hz` ou `--rpm[-real|-sim] R` (com `--voltas-por-ciclo`, padrão 2: 4 tempos);
`--eventos-por-volta E` ou `--eventos-por-ciclo N` (V8 de 4 tempos: 4 por volta, 8 por ciclo);
`--trecho-real a-b --trecho-sim a-b`; `--fixo-sim` (o f0 dado é exato: render de giro travado);
`--canal-real media|e|d`; `--ancora lo-hi`; `--pesos p1,…,p7`; `--fmin/--fmax` (busca do ciclo: `--fmin 70 --fmax 170`
para Fórmula 1); `--zoom s`. Se ao lado do `SIM.wav` houver um `SIM.json` gravado pelo `render.ts`, a rotação e o
número de cilindros saem dele.

**Vocabulário.** `f0` é a frequência do **ciclo**: o menor período em que o som se repete (720° no 4 tempos, rpm/120;
360° no 2 tempos, rpm/60). Todas as linhas de um motor em regime são múltiplos de f0. Ignição = eventos por ciclo × f0.
Rotação = voltas por ciclo × f0.

**Normalização de nível.** Gravações têm ganho arbitrário. O simulado é escalado para ter a **mesma potência do real
na banda âncora**, e todos os níveis saem em dB relativos a ela. A âncora padrão é 150–400 Hz, a do projeto (microfone
de celular corta abaixo disso); quando a ignição passa de 320 Hz a âncora vai para a volta dela, e `--ancora` fixa
outra (a régua usa 400–2500 Hz na Fórmula 1). O critério usado fica escrito no painel e no JSON. As distâncias não
mudam se o simulado for gravado 20 dB mais alto (está no autoteste).

**Outras famílias.** O `render.ts` do kit só conhece o Ronco. Diesel, Radial, Rotativos, Vapor e Elétrico usam o
render de cada um (`tools/diesel-render.ts`, `tools/diesel-fontes.ts`…): o kit só precisa de WAVs. Para o orçamento,
siga a convenção de nomes abaixo.

## Como ler o painel

Real à esquerda (azul), simulado à direita (laranja), mesmas escalas e mesma faixa dinâmica em cada linha. Exemplos em
`docs/ouvido/`.

1. **Espectrograma log-mel de ~8 s.** O trecho é estável? Há faixas horizontais (linhas do motor) ou uma névoa
   uniforme? Névoa lisa em cima de poucas linhas é o retrato do "ar".
2. **Zoom de 0,5 s com janela curta.** Cada explosão é uma risca vertical. Olhe o que há **entre** as riscas: no real
   de escape perto do microfone há silêncio; névoa contínua entre elas é ruído que não pulsa. As réguas no canto
   mostram 1 ignição e 1 ciclo.
3. **Espectro fino no domínio das ordens.** O sinal é reamostrado no ângulo do motor, então as linhas ficam nítidas
   mesmo com o giro variando. Linha preta = piso entre as linhas. Altura das linhas sobre o piso = HNR. Até que
   frequência as linhas sobrevivem? No simulado elas costumam sumir no piso antes do real.
4. **Espectro em 1/6 de oitava** (total cheio, piso tracejado, os dois sobrepostos) e **HNR por banda**. Onde o
   tracejado encosta no cheio, a banda é só ruído. O piso do simulado acima do piso do real é ruído sobrando; o total
   abaixo é som faltando.
5. **Modulação da envoltória por banda** (0,5–200 Hz), com ciclo, rotação e ignição marcados. Picos nas marcas = o
   agudo pulsa com o motor. Curva chata = chiado contínuo. Um pico só no ciclo ou na rotação = um cilindro ou uma
   bancada dominam.
6. **Envoltória de 1–6 kHz dobrada no ciclo.** Cada ciclo (fino), o ciclo médio (grosso), a média dobrada na ignição
   (tracejado) e, em preto, o **ruído não periódico** ao longo do ciclo. A faixa cinza é onde ficaria um ruído liso.
   Curvas dentro da faixa cinza = "mar". O tracejado diferente do grosso = explosões desiguais. A linha preta
   acompanhando os pulsos = ruído colado ao motor; reta = leito contínuo.
7. **Rodapé:** distâncias, defeitos, as cinco linhas do resumo e a tabela por banda.

## O que cada medida pega, e o que não pega

Bandas: 30–60, 60–150, 150–400, 400–1k, 1–2,5k, 2,5–6k, 6–12k Hz. Tudo sai por banda no `medidas.json`.

| Medida | Como | Pega | Não pega |
|---|---|---|---|
| **Nível por banda** (`nivel_db`, relativo à âncora) | Welch, potência integrada | Equilíbrio de timbre | Nada de caráter: é a tabela que enganou |
| **HNR** (`hnr`, dB) | Reamostragem síncrona ao ciclo rastreado; Welch em segmentos de 16 ciclos; potência nas linhas ÷ piso entre elas (mediana, robusta a tons intrusos) | Tom × ruído por banda. HNR do simulado abaixo do real = ruído sobrando ou tom faltando (o resumo diz qual, pelo nível do piso e das linhas) | Ruído **pulsado** não é tom: um chiado colado à explosão dá HNR baixo. Abaixo de −15 dB leia "sem tom". Acima de ~150 harmônicos do ciclo as linhas só sobrevivem se o giro for muito firme |
| **Piso** (`piso_db`, `planura_piso`) | Nível do piso entre linhas; planura = média geométrica ÷ aritmética | Quanto ruído e se ele tem estrutura (ressonâncias) ou é liso | — |
| **Ruído não periódico e leito** (`residuo_frac`, `ruido_liso`) | Tira-se a média síncrona (o que se repete igual todo ciclo); do que sobra mede-se a potência ao longo do ciclo: `ruido_liso` = potência no quarto mais quieto ÷ média. **Leito** = `residuo_frac` × `ruido_liso` = fração da banda que é chiado contínuo | **O "som de ar".** Ruído estacionário dá liso ≈ 1; ruído colado ao pulso, perto de 0. É a única medida que separa "mesmo espectro, mesma energia, ruído alisado" | A variação de uma explosão para outra também é "não periódica" (cai nos pulsos, então baixa o liso). Ruído da gravação (sala, vento, microfone) entra no leito do real |
| **Envoltória** (`p90_p10`, `vao`, `crista`, `desvio_media`) | \|Hilbert\| da banda, alisada até 3× a ignição; vão = p10 relativo ao RMS. Sempre ao lado de `ref_ruido` (o mesmo cálculo para ruído estacionário) | Pulso × tapete. p90/p10 e vão iguais aos de `ref_ruido` = liso | Poucas linhas fortes também dão envoltória lisa sem ser ruído (por isso existe o leito). Só vale em bandas ≥ 400 Hz e ≥ 2× a ignição |
| **Modulação** (`m_ciclo`, `m_rot`, `m_ign`, `frac_ciclo`, `frac_ign`) | Série de Fourier da envoltória dobrada no ciclo (imune a vibrato); fração periódica sem viés (metades pares × ímpares) | Qual ritmo do motor pulsa a banda e quanto da envoltória é presa a ele | Não diz de qual fonte vem (use o orçamento) |
| **Estalos** (`picos_s`, `picos_irregulares_s`, `curtose`) | Picos 10 dB acima da mediana de 0,3 s; e 10 dB acima do **ciclo médio** naquele ângulo | "Pipoco": os irregulares contam só o que foge do padrão do ciclo (pulso regular, por mais seco, não conta) | Codec arredonda estalos: curtose de gravação comprimida é evidência fraca |
| **Irregularidade** (`cv_evento`, `cv_ciclo`, `desigualdade`) | Energia por explosão no ângulo: CV de todas, do mesmo cilindro ciclo a ciclo, e diferença fixa entre cilindros | "Sem a irregularidade do diesel", regular demais, um cilindro dominante | Precisa do número certo de explosões por ciclo |
| **Inclinação** (`inclinacao_db_oitava`) | Reta na densidade em terços, 150 Hz–6 kHz | Brilho geral | — |
| **Tons que não são ordens** (`tons`) | Picos estreitos fora das ordens em Hz (parados) e em ordens (presos ao giro com razão não inteira); proeminência, estabilidade, presença | Apitos: achou a ventoinha do Fusca (49,1× o giro) e o 2º harmônico da bomba de ar secundário do Mustang simulado (1520 Hz) | Tom em cima de uma ordem inteira (±1,5 Hz) vira "linha forte" |

## Distâncias e defeitos

**Distâncias por componente**, em "tolerâncias": cada diferença é dividida pela incerteza de uma gravação de celular
(nível ±3 dB até 1 kHz e ±5 dB acima, HNR 4 dB, p90/p10 e vão 3 dB, modulação 0,12, fração periódica 0,15, CV 0,08) e
soma-se em raiz da média dos quadrados, com peso por banda 0,25 / 0,5 / 1 / 1 / 1 / 1 / 0 (grave de celular vale pouco;
6–12 kHz não vale). 1 ≈ dentro da incerteza; 3 = claramente diferente.

| Componente | Entra |
|---|---|
| timbre tonal | nível das linhas por banda; perfil das ordens baixas |
| piso de ruído | HNR por banda; nível e planura do piso |
| envoltória | p90/p10, vão, crista, desvio/média (bandas ≥ 400 Hz e a faixa de 1–6 kHz) |
| modulação | profundidade no ciclo, na rotação e na ignição; fração presa ao ciclo |
| eventos | estalos por segundo, curtose, CV entre explosões, desigualdade |

As distâncias são **simétricas**: simulado mais limpo que a gravação conta tanto quanto mais sujo. Mas a gravação soma
ao motor o ruído do microfone e da sala. Por isso há três **defeitos de um lado só**, em que a gravação é **teto de
ruído e piso de pulso** e só conta o que o simulado tem de pior:

| Defeito | Conta | É a queixa |
|---|---|---|
| **ar** (leito a mais) | Fração de cada banda (≥ 400 Hz e 1–6 kHz) que é leito contínuo, acima da fração da gravação (tolerância 0,10) | "ar", "mar", "aspirador de pó" |
| **tom a menos** | HNR do simulado abaixo do da gravação (4 dB) | chiado no lugar do timbre |
| **pulso a menos** | Envoltória mais lisa que a da gravação (p90/p10, vão, modulação na ignição, fração presa ao ciclo) | "almofada nos ouvidos", sem os "pufs" |

**Resumo.** Cada diferença vira uma frase com gravidade (diferença ÷ tolerância × peso); saem as cinco maiores, em
português de ouvido: "A MAIS: chiado contínuo em 1–6 kHz: 80% da potência da banda é um leito de ruído liso, contra 26%
no real".

## A régua

Os carros do Ronco que o dono revisou de ouvido contra gravações (`docs/REVISAO-DE-SOM.md`: Fusca, Mustang, Fórmula 1,
Hellcat) definem a faixa de "aprovado pelo ouvido". As gravações dos casos estavam perdidas; foram reencontradas ou
substituídas por equivalentes e ficam em `referencias/gasolina/` no checkout principal, fora do git (o `INDEX.md` de lá
tem fonte, microfone, trechos e rotação). `python3 -I tools/ouvido/regua.py` renderiza cada preset na condição da
gravação, compara e monta a tabela; os casos estão em `regua.json`.

Medido em 18/11/2026, commit `1a2a73c`, ouvinte `ext`, som de ambiente desligado:

| caso | rpm | tonal | piso | envoltória | modulação | eventos | **total** | **ar** | tom a menos | pulso a menos | leito 1–6 kHz real / sim |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Aprovados pelo ouvido** | | | | | | | | | | | |
| Fusca, 1410 rpm estável | 1410 | 1,55 | 1,91 | 0,65 | 1,18 | 0,49 | 1,27 | 0,00 | 2,41 | 0,00 | 67% / 55% |
| Fusca, ~2000 rpm instável | 2003 | 2,39 | 1,62 | 0,22 | 1,28 | 0,98 | 1,48 | 0,08 | 0,00 | 0,12 | 70% / 62% |
| Mustang frio, modo Sport | 1251 | 2,90 | 2,44 | 1,37 | 1,52 | 1,94 | 2,11 | 0,44 | 0,85 | 1,15 | 26% / 32% |
| Mustang frio, modo Track | 1247 | 2,85 | 2,51 | 1,46 | 1,59 | 2,07 | 2,16 | 0,56 | 0,87 | 1,30 | 24% / 32% |
| F1 V8 2007 em carga | 17.800 | 3,77 | 2,14 | 1,43 | 1,58 | 1,34 | 2,24 | 0,00 | 1,56 | 0,94 | 42% / 3% |
| F1 V8 2011 em carga | 16.100 | 2,78 | 2,26 | 0,12 | 2,06 | 0,73 | 1,88 | 0,00 | 1,36 | 0,04 | 66% / 10% |
| F1 V10 2002 em carga | 18.200 | 2,06 | 1,25 | 0,76 | 0,62 | 1,02 | 1,25 | 0,00 | 1,62 | 0,64 | 21% / 3% |
| Hellcat, lenta quente | 755 | 1,09 | 2,88 | 0,90 | 1,76 | 1,60 | 1,79 | 0,00 | 0,00 | 0,00 | 43% / 16% |
| Hellcat frio | 992 | 1,02 | 1,28 | 1,08 | 1,43 | 0,64 | 1,12 | 0,00 | 0,12 | 0,18 | 80% / 30% |
| **faixa dos aprovados** | | 1,0–3,8 | 1,3–2,9 | 0,1–1,5 | 0,6–2,1 | 0,5–2,1 | **1,1–2,2** | **0–0,6** | 0–2,4 | 0–1,3 | |
| **Sem veredito** | | | | | | | | | | | |
| Mustang 2026, lenta quente | 753 | 1,41 | 1,09 | 0,75 | 2,67 | 2,18 | 1,77 | 0,00 | 0,42 | 0,31 | 78% / 15% |
| Diesel de hoje (300D, lenta) | 705 / 748 | 3,80 | 2,17 | 1,99 | 2,52 | 2,54 | 2,68 | 0,00 | 2,69 | 0,00 | 16% / 7% |
| **Sabidamente ruins** | | | | | | | | | | | |
| Fusca 1410 com o ruído alisado | 1410 | 1,56 | 1,89 | 0,23 | 1,13 | 0,41 | 1,22 | **2,92** | 2,39 | 1,12 | 67% / 98% |
| Mustang frio com o ruído alisado | 1251 | 2,90 | 2,43 | 1,55 | 1,59 | 2,19 | 2,19 | **2,18** | 0,84 | 1,55 | 26% / 52% |
| Mustang frio, chiado de admissão 300× | 1251 | 2,90 | 2,22 | 2,04 | 1,99 | 2,45 | 2,34 | **4,20** | 0,88 | 2,01 | 26% / 80% |
| Diesel da 1ª passada (300D, lenta) | 705 / 748 | **4,63** | 2,38 | 1,52 | 2,09 | **2,69** | **2,87** | 0,00 | 2,63 | 0,36 | 16% / 9% |

O que a régua diz:

- **"Aprovado pelo ouvido" não é "perto da gravação nas bandas".** Os aprovados ficam entre 1,1 e 2,2 no total, com o
  timbre tonal chegando a 3,8: o Mustang tem 15 a 22 dB a menos que a gravação entre 400 Hz e 2,5 kHz, a Fórmula 1
  tem 10 a 13 dB a menos em 400–1000 Hz (as pendências que o REVISAO-DE-SOM já lista). O ouvido aprovou o caráter.
- **O defeito "ar" separa com folga.** Nos nove aprovados o leito a mais fica entre 0 e 0,56. Nos três casos
  fabricados fica entre 2,2 e 4,2: quatro a oito vezes o pior aprovado. Em dois deles as bandas médias são as mesmas
  do aprovado e as distâncias simétricas quase não mexem (o Fusca alisado até "melhora" de 1,27 para 1,22, porque a
  gravação com a tampa do motor aberta tem a envoltória lisa): **só o leito enxerga**. É a armadilha que o caso dos
  Rotativos descreve.
- **O Diesel da primeira passada sai da faixa em outro eixo.** Não é leito (as rajadas dele são coladas à explosão): é
  timbre tonal 4,6 (teto dos aprovados 3,8), eventos 2,7 (teto 2,1) e total 2,9 (teto 2,2). O painel mostra por quê
  (`docs/ouvido/diesel-1a-passada-ruim.png`): meia dúzia de linhas graves e nenhuma acima de 400 Hz (HNR −25 dB onde a
  gravação tem +3), cinco rajadas de ruído idênticas por ciclo onde o motor real tem um cilindro que domina (CV entre
  explosões 0,14 contra 0,59), e 19 dB a menos de 1 a 2,5 kHz. É o "peidinho", o "sem peso" e o "sem a irregularidade
  do diesel". O Diesel de hoje ainda está fora (total 2,7).
- **"Tom a menos" não separa sozinho.** O Fusca aprovado tem 2,4: acima de 400 Hz o simulado é 100% rajada de ruído
  (HNR −8 a −25 dB) onde a gravação tem linhas (HNR +3 a −7 dB) e o tom da ventoinha. Batidas e impactos de um motor
  real repetem a mesma forma de onda a cada ciclo e por isso dão linhas até vários kHz; rajadas de ruído branco não.
  O dono aprovou assim, então é pista do que melhorar, não critério de reprovação.

**Estado novo do Ronco (22/11/2026, sem veredito do dono).** O motor-base ganhou mecanismos que mudam o som dos carros
de propósito (carcaça do escape, batida periódica da mecânica, jato sônico, bomba de ar: `docs/TECNICO.md` → Ronco →
Médios) e os presets saem com eles ligados. A régua acima continua sendo a do som aprovado em 18/11: os casos
`aprovado` e `ruim` de `regua.json` renderizam com os campos novos no valor legado (`--campo` com `null`), e refazê-la
dá os mesmos números, casa por casa. Ao lado dela entraram os casos `-novo` (grupo `extra`), as mesmas condições com o
preset como está (aprovado → novo; saída de `regua.py` em `referencias/_sim/ronco/regua-2026-11-19/`, fora do git):

| caso | tonal | piso | envoltória | modulação | eventos | **total** | **ar** | tom a menos | pulso a menos | leito 1–6 kHz real / sim |
|---|---|---|---|---|---|---|---|---|---|---|
| Fusca, 1410 rpm estável | 1,55 → 1,27 | 1,91 → 1,66 | 0,65 → 0,63 | 1,18 → 1,16 | 0,49 → 0,45 | **1,27 → 1,12** | 0,00 → 0,00 | 2,41 → 1,90 | 0,00 → 0,00 | 67% / 55% → 52% |
| Fusca, ~2000 rpm instável | 2,39 → 2,50 | 1,62 → 1,82 | 0,23 → 0,24 | 1,28 → 1,37 | 0,98 → 1,00 | **1,48 → 1,58** | 0,08 → 0,06 | 0,00 → 0,00 | 0,12 → 0,12 | 70% / 62% → 55% |
| Mustang frio, modo Sport | 2,90 → 2,84 | 2,44 → 2,49 | 1,37 → 1,38 | 1,52 → 1,41 | 1,94 → 2,04 | **2,11 → 2,11** | 0,44 → 0,17 | 0,85 → 0,74 | 1,15 → 0,96 | 26% / 32% → 28% |
| Mustang frio, modo Track | 2,85 → 2,80 | 2,51 → 2,54 | 1,46 → 1,44 | 1,59 → 1,44 | 2,07 → 1,97 | **2,16 → 2,11** | 0,56 → 0,21 | 0,87 → 0,78 | 1,30 → 1,08 | 24% / 32% → 28% |
| F1 V8 2007 em carga | 3,77 → 3,82 | 2,14 → 2,17 | 1,43 → 1,45 | 1,58 → 1,63 | 1,34 → 1,35 | **2,24 → 2,28** | 0,00 → 0,00 | 1,56 → 1,61 | 0,94 → 0,95 | 42% / 3% → 3% |
| F1 V8 2011 em carga | 2,78 → 2,79 | 2,26 → 2,28 | 0,12 → 0,16 | 2,06 → 2,13 | 0,73 → 0,76 | **1,88 → 1,90** | 0,00 → 0,00 | 1,36 → 1,37 | 0,04 → 0,03 | 66% / 10% → 10% |
| F1 V10 2002 em carga | 2,06 → 2,03 | 1,25 → 1,21 | 0,76 → 0,77 | 0,62 → 0,65 | 1,02 → 1,02 | **1,25 → 1,24** | 0,00 → 0,00 | 1,62 → 1,56 | 0,64 → 0,68 | 21% / 3% → 3% |
| Hellcat, lenta quente | 1,09 → 0,98 | 2,88 → 3,10 | 0,90 → 0,81 | 1,76 → 1,79 | 1,60 → 1,67 | **1,79 → 1,86** | 0,00 → 0,00 | 0,00 → 0,00 | 0,00 → 0,00 | 43% / 16% → 9% |
| Hellcat frio | 1,02 → 1,07 | 1,28 → 1,41 | 1,08 → 1,09 | 1,43 → 1,92 | 0,64 → 1,31 | **1,12 → 1,40** | 0,00 → 0,00 | 0,12 → 0,05 | 0,18 → 0,18 | 80% / 30% → 22% |
| Mustang 2026, lenta quente (sem veredito) | 1,41 → 1,56 | 1,09 → 1,18 | 0,75 → 0,80 | 2,67 → 2,75 | 2,18 → 2,26 | **1,77 → 1,85** | 0,00 → 0,00 | 0,42 → 0,44 | 0,31 → 0,41 | 78% / 15% → 12% |

Lido contra a faixa dos aprovados: `ar` cai onde existia (Mustang frio, 0,44–0,56 → 0,17–0,21) e segue zero no resto;
`tom a menos` cai no Fusca (2,41 → 1,90) e `pulso a menos` no Mustang frio; o total melhora no Fusca a 1410 rpm e no
Mustang frio em Track e piora de 0,02 a 0,28 nos outros. O que piora é simétrico: o simulado fica **mais tonal** que a
gravação em 1–6 kHz (piso de ruído do Hellcat em lenta 2,88 → 3,10; modulação e eventos do Hellcat frio 1,43 → 1,92 e
0,64 → 1,31), que é o lado que o viés do simulador pede (mais motor, menos ar) e que a distância simétrica conta como
diferença. Três números passam por pouco do teto dos aprovados: o piso do Hellcat em lenta (3,10 contra 2,88), a
modulação da F1 V8 2011 (2,13 contra 2,06) e o total da F1 V8 2007 (2,28 contra 2,24). Quem decide é o ouvido.

**Como usar a régua numa família nova.** Para cada preset revisado, em duas condições contra gravação casada:

1. `ar` ≤ 0,6. Passou disso, existe chiado contínuo que a gravação não comporta: ache a fonte com o orçamento.
2. `pulso a menos` ≤ 1,3 e `tom a menos` ≤ 2,4.
3. Distâncias dentro da faixa dos aprovados: tonal ≤ 3,8, piso ≤ 2,9, envoltória ≤ 1,5, modulação ≤ 2,1, eventos ≤ 2,1,
   total ≤ 2,2.
4. Leia o resumo e **olhe o painel**: um número dentro da faixa não prova o caráter.

A faixa vem de nove comparações de quatro carros. É uma régua, não uma lei: serve para reprovar o que está claramente
fora e para ordenar o que atacar primeiro.

## Orçamento de ruído

`orcamento.py PASTA` recebe o mesmo render com a **mesma semente**, um arquivo com tudo e um por fonte desligada:

```
<prefixo>_tudo.wav            tudo ligado
<prefixo>_sem-<fonte>.wav     tudo menos a <fonte> (ganho zerado SEM pular as chamadas do gerador de ruído)
<prefixo>_so-<fonte>.wav      só a contribuição da <fonte> (alternativa; é o que o tools/diesel-fontes.ts grava no modo "cada")
<prefixo>_semente2.wav        tudo ligado com outra semente (opcional)
```

Sai, por fonte: a fração da potência de cada banda e do total ponderado A, e quanto ela ocupa do **vão** (o quarto do
ciclo em que a envoltória média do render completo é mais baixa). Com `_semente2` sai a **fração estocástica exata**:
dois renders de sementes diferentes têm a mesma parte determinística e ruídos independentes, então a potência
estocástica é a de (a − b)/√2.

Exemplo, Fusca a 1410 rpm (`render.ts fusca pasta/ --cada --rpm 1410`):

```
fonte           30-60  60-150 150-400  400-1k  1-2,5k  2,5-6k   6-12k  |  pond. A |  vão 400-1k  1-2,5k  2,5-6k  1–6 kHz | p90/p10 próprio
vazamento          ·       ·       1%     54%     97%    100%    100%  |     90%  |         77%     96%    100%      98% |    6.6 dB
variacao    *      3%     15%     26%      2%      1%      ·       1%  |      2%  |         10%      ·       ·        1% |      --
ESTOCÁSTICO        1%      9%     32%     84%     99%     99%     99%  |     94%  |         94%     99%    100%      99% |  (duas sementes)
```

O Fusca aprovado é 94% estocástico em ponderação A e 90% é uma fonte só (a rajada que vaza pelo coletor). Não é a
fração de ruído que reprova um som: é o ruído ser **liso**. Aqui ele pulsa (p90/p10 próprio de 6,6 dB) e o leito do
simulado (55% da faixa) fica abaixo do da gravação (67%).

Cuidados:

- **Fonte que entra na rede de tubos** (`--na-rede`, padrão `valvula,variacao,turbina`): desligá-la muda a trajetória
  do laço não linear e a diferença deixa de ser a fonte. Vale o **efeito** de desligar na potência (linha de cima); a
  linha "o que muda" é a potência do sinal-diferença.
- **`variacao` no Ronco** muda quantas vezes o gerador de ruído é chamado (uma falha de queima pula sorteios): depois
  da primeira falha a sequência de ruído é outra. Para ela só o efeito vale.
- **Duas sementes só com giro travado.** Com o giro livre as duas trajetórias se afastam e tudo parece estocástico.
- A saída do Ronco passa por um `tanh` suave: a soma é exata em nível normal; o programa avisa quando a potência
  própria e o efeito divergem mais de 1 dB.

Fontes do `render.ts` (Ronco): `jato`, `vazamento`, `chiadoAdm`, `admissao`, `mecanica`, `compressor`, `chiadoTurbo`,
`valvula`, `variacao`, e o grupo `ar` (todo o ruído aerodinâmico). `--sem a,b` desliga, `--escala a=3` multiplica.

## Validação

`npm run ouvido:teste` (50 s): sinais sintéticos com a resposta plantada. Números de 18/11/2026:

| Teste | Resultado |
|---|---|
| **HNR**: série harmônica + ruído em relação conhecida por banda (limite ±1 dB) | giro fixo 0,35 dB; vibrato ±1,5% com deriva, fase rastreada, 0,50 dB; 4 cilindros a 2800 rpm rastreado 0,26 dB; ciclo de 150 Hz (F1) rastreado 0,81 dB. Vale para HNR entre −10 e +30 dB |
| **Liso × pulsado**: o mesmo ruído, liso e modulado no ciclo, com o mesmo espectro médio | bandas médias não separam (0,40 dB); p90/p10 de 1–6 kHz 15,3 × 4,5 dB; vão −10,2 × −2,6 dB; modulação na ignição 0,88 × 0,00; quanto do ruído é contínuo 0,00 × 1,00; `ar` 7,9 num sentido e 0 no outro; o HNR não confunde ruído pulsado com tom (0,9 dB) |
| **Tom espúrio** | 3137 Hz a −28 dB do total: achado em 3137,0 Hz, 23 dB sobre o piso; preso ao giro na ordem 47,2 com vibrato: achado em 47,19; sem tom plantado: nenhum |
| **Erro de oitava** | linha mais forte no 13º harmônico (o caso do Mustang): 10,402 Hz para 10,4 plantado; ignição 16 dB acima do resto: 10,399; 4 cilindros desiguais: 23,416 para 23,4; série regular não ganha sub-harmônico; rotação dada com o dobro: sai o aviso |
| **Fração periódica** | ruído +0,001; periódico 1,000; metade de cada 0,488 |
| **Ganho** | simulado 20 dB mais alto muda as distâncias em 1,5·10⁻¹³; um sinal contra ele mesmo dá zero |
| **Eventos** | CV entre explosões 0,264 para 0,270 plantado; 3 estalos/s plantados: 3,0/s fora do padrão; rajada regular em toda explosão não conta como estalo |
| **Orçamento** | fração por fonte: erro 0,00 dB; ruído liso com 17% da banda enche 78% do vão, ruído pulsado com 50% enche 0% |

Em gravações reais o rastreio reencontrou sozinho as rotações dos casos (Fusca 1410 e 2003 rpm, o documento diz 1407 e
~2000; Mustang frio 1247–1251 rpm, o documento diz 1248; F1 16.100 a 18.200 rpm) e a ordem certa da linha mais forte
(ordem 2 no V8 de F1, 2,5 no V10). Os painéis foram conferidos contra o que os números dizem: as quatro rajadas por
ciclo do Mustang real (o espaçamento de uma bancada do V8 cruzado) aparecem na linha 6, o cilindro dominante do diesel
real também, e a névoa lisa do caso "aspirador" está no zoom.

## Limitações

- **Só regime.** O kit compara trechos de rotação estável ou variando devagar (uns 10% por segundo, como uma marcha
  de F1 subindo). Acelerada em ponto morto, corte de giro, troca de marcha e partida não entram. O uivo do Hellcat, que é um caso de acelerada, não está
  na régua: só a lenta dele.
- **A régua tem nove pontos de quatro carros**, e a "aprovação" que ela resume é o que está escrito no
  REVISAO-DE-SOM, com as pendências de lá. As gravações são as dos casos (Fusca, F1), uma que bate com a descrição
  (Mustang) e equivalentes (Hellcat). Outro carro do mesmo modelo, outro microfone ou outra posição mudam as distâncias
  em ordem de 1.
- **O caso real de "ruim" é um só** (Diesel da primeira passada, um preset, lenta) e a queixa "aspirador de pó atrás"
  talvez fosse de outra condição (turbo em carga). Os outros três ruins são fabricados.
- **Ruído da gravação.** Sala, vento e microfone entram no piso e no leito do real. Os defeitos de um lado só tratam
  isso como teto, o que os deixa permissivos: gravação ruim aprova simulado ruim. Gravação em garagem não serve para o
  agudo (há um exemplo descartado no `INDEX.md`).
- **Posição.** O ouvinte `ext` do Ronco soma as bancadas; um celular junto de uma ponteira ouve uma. O kit não corrige.
- **HNR alto exige fase boa.** Com o giro caçando rápido e pouco som periódico (fração periódica < 0,3, o `f0.py`
  avisa) as linhas altas borram e o HNR do real sai baixo. Nos trechos de F1 (2,4 a 3,6 s, uma marcha) a medida é mais
  grossa.
- **Ciclo × padrão de 2 ciclos.** Quando a queima alterna de ciclo para ciclo (o Fusca no afogador), dobrar em dois
  ciclos explica mais que em um. O `f0.py` fica com o ciclo e avisa; a decisão é de quem conhece o motor.
- **Motor perfeitamente regular.** Se as explosões são idênticas, o som se repete a cada ignição e o "ciclo" medido é
  a ignição. Passe `--rpm`.
- **Tolerâncias e pesos são escolhas** (as incertezas do REVISAO-DE-SOM). Mudá-los muda as distâncias; a régua tem de
  ser refeita junto.
- **Não mede o navegador.** Reverberação, compressor e equalizador da página ficam fora, como em todo o banco de
  testes em Node.

## Quando usar `tools/analise-som` e quando usar o kit

`tools/analise-som/` continua valendo e não foi substituído. É o banco da revisão do Fusca e do Mustang: `harness.js`,
`render.js` e `regressao.js` rodam o DSP **legado** (`src/dsp.js`, o do `master`) e leem `.f32` cru; `auditoria.py` é
a ferramenta do auditor para 4 tempos de ignição regular.

| Para | Use |
|---|---|
| Comparar um preset com uma gravação e saber o que sobra e o que falta | **kit**: `comparar.py` |
| Achar a rotação de uma gravação sem cair na oitava errada; varrer uma gravação longa | **kit**: `f0.py` (o `auditoria.py timeline/lines` faz o mesmo à mão, para 4 cilindros) |
| Saber de que fonte vem o ruído e quem enche o vão | **kit**: `orcamento.py` (generaliza o `tools/diesel-fontes.ts`, de onde vem a convenção de nomes) |
| Médias alinhadas ao ciclo por banda, força por cilindro, rajadas uma a uma, coerência grave ↔ agudo | `analise-som/auditoria.py sync` (mais fundo que o kit nesse ponto) |
| Terços de oitava para uma tabela de metas | `analise-som/tercos.py` ou o `medidas.json` do kit |
| Regressão de todos os presets (apagou, NaN, saturou) | `analise-som/regressao.js` e os `teste:*` / `lenta:*` de cada família |
| Comparar com o DSP de outro commit | `render.ts` do kit roda o DSP atual em TypeScript; para o legado, `analise-som/render.js` com `DSP=` |

O kit lê os `.f32` do `analise-som` direto (estéreo intercalado a 48 kHz). O que ele reusa de lá: a fração periódica
sem viés (metades pares × ímpares), a reamostragem no ângulo, a referência de ruído estacionário pela mesma cadeia, o
detector de estalos do `radial-estouros.ts`, o giro travado com o integrador da lenta congelado do `render.js` e a
convenção `sem-<fonte>` / `so-<fonte>` do `diesel-fontes.ts`.
