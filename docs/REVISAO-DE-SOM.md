# Revisão de som de um veículo: método

Como revisar o som de um carro, moto ou avião do simulador contra a realidade, sem chutar. O processo foi montado na
revisão do Fusca (novembro de 2026), depois de várias tentativas que pioraram o som por falta de medida. Vale para
qualquer veículo, antigo ou novo.

- [Princípios](#princípios)
- [O que deu errado antes, e por quê](#o-que-deu-errado-antes-e-por-quê)
- [Passo a passo](#passo-a-passo)
- [O auditor independente](#o-auditor-independente)
- [Técnicas de análise](#técnicas-de-análise)
- [Armadilhas](#armadilhas)
- [Do achado ao modelo](#do-achado-ao-modelo)
- [Caso completo: o Fusca](#caso-completo-o-fusca)
- [Caso: o Mustang](#caso-o-mustang)
- [Ferramentas](#ferramentas)
- [O que olhar em cada tipo de veículo](#o-que-olhar-em-cada-tipo-de-veículo)

## Princípios

1. **Gravação de referência antes de mexer.** Sem uma gravação do carro real, qualquer ajuste é opinião. Com uma,
   o problema vira medida: na mesma rotação e carga, o que o real tem que o simulador não tem.
2. **Mecanismo físico, não ganho.** O que falta quase sempre é uma peça ou um fenômeno do carro real (abafador sem
   lã, caixas de calefação, taxa de compressão, motor atrás, escape vazando). Ele entra como campo do preset e
   controle no painel, com unidade e nome de coisa real. Porcentagem arbitrária não serve.
3. **Todo campo de preset tem controle visual.** Preset é ponto de partida, não base escondida. Se um preset usa um
   campo, o painel precisa conseguir mudar esse campo, e o valor precisa caber na faixa do controle.
4. **Atenuar é atenuar.** Quando o pedido é "menos disso", reduza o ganho do que existe. Trocar o modelo inteiro muda
   o caráter, e o caráter costuma ser justamente o que estava certo.
5. **Duas condições, nunca uma.** O modelo tem que bater em pelo menos duas rotações ou cargas da gravação. Ajustar
   num trecho só dá um som que acerta ali e erra no resto.
6. **Quem decide é o ouvido.** As medidas dizem onde olhar e se a mudança foi na direção certa. Quem diz se ficou bom
   é quem ouve, no navegador, com o fone ou o alto-falante de verdade.
7. **Algo que "some e volta" num certo giro é um liga/desliga.** Registre as variáveis de estado do modelo (corte de
   combustível, válvula do escape, mapas) e o nível por banda a cada 0,1–0,2 s numa acelerada seguida de
   desaceleração. Foi assim que apareceu o corte de combustível da injeção aplicado a carburador: o som do Fusca sumia
   na desaceleração e voltava de repente a ~1200 rpm, quando a queima religava.

## O que deu errado antes, e por quê

Estes erros aconteceram na sessão que gerou este método. Cada um virou uma regra.

| O que foi feito | O que se ouviu | Por que a medida não pegou | Regra |
|---|---|---|---|
| Trocar o ruído de jato (que seguia a velocidade de cada pulso) por um modelo de velocidade média do gás | "Almofada nos ouvidos" em todos os carros; o Fusca perdeu os "pufs" | Comparava só espectros médios. Um chiado colado a cada pulso e um chiado liso podem ter o mesmo espectro médio | Medir também a envoltória do agudo (contraste p90/p10, modulação). Atenuar em vez de trocar |
| Aumentar a reverberação do "Céu aberto" para tirar o som "de dentro da cabeça" | Todos os carros abafados | A reverberação fica no navegador (`app.js`), fora do banco de testes em Node | Não mexer na cadeia de áudio do navegador sem jeito de medir |
| Ventoinha do motor refrigerado a ar como ruído largo contínuo | "Som de mar" | O espectro médio parecia o do HEAD | Ruído contínuo que sobe com o giro e enche o silêncio entre as explosões soa como mar. Exigir modulação |
| Reforçar os estalos de válvula ampliando rajadas de ruído | "Algo colando e descolando" | Nenhuma medida de aspereza | Medir curtose e picos por segundo do agudo |
| Estalos de válvula como ressonâncias estreitas (Q 30–50) | "Despertador no fundo" | Ressonância estreita batida 240 vezes por segundo vira um tom | Não usar ressonância estreita para ruído de impacto |
| Diâmetro de escape menor no Fusca para soprar mais | O som tonal do motor mudou (−6 a −9 dB, outras ordens) | — | Mudar só a peça que o fenômeno envolve (a ponteira virou um campo próprio) |
| Hipótese do chiado do carburador para o agudo do Fusca | Não foi implementada: o auditor refutou | — | Auditoria independente antes de implementar |
| Comparar o Mustang a 2027 rpm tomando a linha mais forte do grave (135 Hz) pela ignição | Hipótese errada de "estouros aleatórios" e ordens do grave sem sentido | A linha mais forte era o 13º harmônico do ciclo; a lenta real era ~1250 rpm | Confirmar a rotação dobrando o sinal em N períodos da linha mais forte (ver Armadilhas) |

## Passo a passo

1. **Pegar a gravação.** Vídeo de celular serve. O ideal é um trecho estável (lenta ou rotação segurada), com o
   microfone sempre no mesmo lugar, e outro trecho em outra rotação. Anote onde estava o microfone (atrás, de lado,
   no cofre) para escolher o ouvinte correspondente no simulador.
2. **Extrair o áudio.** O arquivo fica fora do repositório (ex.: no rascunho), e scripts nunca rodam de dentro da pasta
   do arquivo baixado:
   ```
   ffmpeg -v error -i video.mkv -vn -ac 2 -ar 48000 -f f32le gravacao.f32
   ```
3. **Varrer a linha do tempo** (`auditoria.py timeline`): nível por banda ao longo do tempo e rotação por segundo.
   Procure trechos estáveis, trechos com o motor desligado (dão o piso do microfone e do ambiente), aceleradas e
   momentos em que todas as bandas caem juntas (é o celular se afastando, não o motor).
4. **Achar a rotação e confirmar o ciclo** (`auditoria.py lines`). Errar por um fator 2 (confundir volta com ciclo de
   720°) inverte todas as conclusões. Confirme dobrando o sinal no ângulo do virabrequim.
5. **Renderizar o simulador na mesma condição** (`render.js`): giro travado na rotação da gravação, acelerador no ponto
   em que o torque líquido zera (é o que segura o giro em neutro). Para comparar com a versão anterior, renderize
   também o HEAD:
   ```
   git show HEAD:src/dsp.js > /tmp/dsp.head.js
   DSP=/tmp/dsp.head.js node tools/analise-som/render.js fusca 1974 /tmp/head.f32
   ```
6. **Comparar** com a figura (`comparar.py`) e as tabelas (`tercos.py`, `modulacao.py`, `variacao.py`,
   `auditoria.py shape|sync|orders`). Olhe nível por banda, forma do espectro, envoltória do agudo, ritmo e variação
   entre explosões.
7. **Formular hipóteses físicas** e, antes de implementar, **pedir uma auditoria independente** (ver abaixo).
8. **Implementar como mecanismo**, com campo de preset, controle no painel e a documentação técnica (`TECNICO.md`)
   atualizada. Tudo que não deve mudar o volume calibrado fica fora da calibração (`calibrate()` usa uma configuração
   de referência).
9. **Conferir contra as metas** nas duas condições, com os mesmos scripts.
10. **Rodar a regressão** (`regressao.js`): todos os veículos seguram a lenta, não apagam, não geram NaN, não saturam.
11. **Ouvir.** Quem decide é o ouvido do usuário. Se ele descreve algo que a medida não mostra, falta medida, não ouvido.

## O auditor independente

Na revisão do Fusca, um segundo modelo (o Fable) auditou a análise antes da implementação. A minha hipótese era o
chiado do carburador. A auditoria provou que não era: a fonte era o escape vazando perto do motor, e a assimetria
vinha das caixas de calefação. Sem isso, eu teria implementado a coisa errada com muita convicção.

Como pedir a auditoria:

- Passe os arquivos (gravação e renderizações), o trecho e a rotação usados, os achados e a hipótese.
- Peça para **refutar**, não para concordar: validade da comparação, se o agudo é do motor ou do microfone, codec ou
  vento, caracterização da fonte e ranking de candidatos com evidência.
- Peça as recomendações como mecanismos com parâmetros de unidade física e **metas numéricas de aceitação**.
- Ao final, peça o relato do método e uma ferramenta reutilizável. Foi assim que nasceu `auditoria.py`.

O que o auditor fez, em ordem:

1. **Linha do tempo inteira** (RMS por banda a cada 0,25 s e rotação por segundo), para achar trechos estáveis, de motor
   desligado, de afastamento do celular e de entrada gradual (fade-in).
2. **Rotação da própria gravação**, verificando se o espaçamento das linhas é o ciclo, a volta ou a ignição. O ajuste por
   pente harmônico tende a escolher frequências altas demais; ele conferiu pela autocorrelação do espectro e dobrando
   no ângulo.
3. **Validade da comparação:** rotação e carga, estacionariedade, banda de normalização e banda do codec.
4. **O agudo é do motor?** Três testes independentes: os picos de modulação acompanham a rotação (nada fixo em
   25/30/50/60 Hz, que seriam quadro de vídeo, quadro de 20 ms do Opus ou rede elétrica); coerência entre o grave do
   motor e a envoltória do agudo (0,85 na volta, 0,96 na ignição); e o teste do controle automático de ganho, que
   abaixaria o agudo quando o grave sobe, enquanto no real o agudo de cada cilindro sobe junto com o grave dele.
5. **Caracterização:** forma do espectro, linhas estreitas no domínio da frequência e da ordem, médias alinhadas ao
   ciclo de 720° por banda, fração periódica da variância por banda, forma e decaimento das rajadas, estatísticas da
   envoltória.
6. **Ranking das fontes** pelos testes que cada uma passa ou não passa, e só então as mudanças no modelo, com metas.

## Técnicas de análise

| Técnica | Parâmetros | O que revela |
|---|---|---|
| Linha do tempo | RMS em 60–150 / 150–400 / 400–1k / 1–2k / 2–8k / 8–16k Hz a cada 0,25 s; ignição por segundo | Trechos estáveis, motor desligado, afastamento, fade |
| Rotação | Picos < 600 Hz de uma FFT longa, autocorrelação do log-espectro nos espaçamentos candidatos, confirmação dobrando no ângulo; fase da linha mais forte dividida por N = 2…32 e fração periódica do grave em cada N | Ciclo × volta × ignição; o N certo salta (0,95 contra ~0,35) |
| Fase da ignição | Passa-faixa ±10% na ignição, fase de Hilbert desenrolada, reamostragem em grade de ângulo (64 amostras por ignição), janelas de 2 s quando o giro varia | Base para tudo que é por cilindro |
| PSD e terços de oitava | Welch com 8192 pontos; nível médio por terço de oitava em dB relativo à média de 150–400 Hz; também os absolutos até 24 kHz | Forma do espectro e corte do codec |
| Modulação da envoltória | Passa-faixa → |Hilbert| → passa-baixa 600 Hz → Welch com 1 Hz de resolução; nível nas ordens 0,5 / 1 / 1,5 / ignição | Qual ritmo do motor pulsa o agudo |
| Coerência grave ↔ agudo | Coerência entre a onda de 40–300 Hz e a envoltória de 2–8 kHz | > 0,7 = o agudo vem do motor |
| Média alinhada ao ciclo e fração periódica | Envoltória no domínio do ângulo, dobrada por ignição, volta e ciclo; fração periódica sem viés = covariância entre as médias dos períodos pares e ímpares ÷ variância | Quanto do agudo é colado ao motor, banda por banda |
| Força por cilindro | RMS do grave e média do agudo em cada janela de 180°; variação total e ciclo a ciclo no mesmo cilindro | Desigualdade fixa entre cilindros × variação aleatória da queima |
| Ordens do grave | Welch com 2 s, máximo em ±10% de cada ordem, relativo à ignição | Assimetria de caminhos no escape (ex.: ordem 3) |
| Curtose do agudo | Blocos de 0,5 s, 2–8 kHz | Picos isolados × ruído. Evidência fraca em arquivo com codec |
| Espectro no domínio da ordem | Sinal reamostrado no ângulo (1024 pontos por ignição), mediana local subtraída | Linhas fora de ordens inteiras e meias: ventoinha, correia |
| Percentis da envoltória | Desvio/média, p5, p50, p95 relativos à média; sempre com a referência de ruído estacionário na mesma cadeia | Guarda contra "mar": desvio/média ≤ 0,25 ou fração periódica < 0,15 em 4–16 kHz é ruído contínuo |

Ruído estacionário passado pela mesma cadeia dá desvio/média ≈ 0,21 (2–8 kHz), 0,25 (4–8k), 0,18 (8–16k) e 0,45
(1–2k). O valor de referência depende da banda; calcule sempre.

## Armadilhas

- **Microfone de celular:** corta grave abaixo de ~100–150 Hz (a banda de 150–400 Hz serve de âncora) e costuma ter um
  reforço de +3 a +10 dB entre 3 e 10 kHz. Confiança por banda: ±3 dB até 1 kHz, ±5 dB de 1 a 8 kHz, ±6–8 dB acima.
  Não ajuste acima de 8 kHz dB a dB.
- **Codec (Opus, AAC):** preserva a energia por banda a cada 2,5–20 ms (modulação até ~100 Hz é confiável), mas não a
  estrutura fina. Estalos saem gaussianos, então a curtose engana.
- **Frequências fixas suspeitas:** quadro do Opus (50 Hz), vídeo (25/30 fps), rede (50/60 Hz). Picos de modulação
  verdadeiros acompanham a rotação.
- **Rotação variando:** borra as linhas no Welch (picos mais baixos que no simulador travado), mas não a energia por
  banda. Compare níveis por banda; para trabalho por ângulo, use janelas curtas.
- **Ritmo × mecanismo:** escreva a sequência de eventos por ciclo e calcule a DFT de 4 pontos antes de atribuir um
  ritmo a um mecanismo. Lados D E E D (período 720°) só geram as ordens 0,5 e 1,5; uma modulação por volta (ordem 1)
  precisa de um padrão que se repete a cada 360°, como longo, curto, longo, curto.
- **Uma fonte só não explica tudo:** se a fração periódica muda com a banda (5% em 1–2 kHz, 47% em 8–16 kHz), há pelo
  menos duas fontes.
- **O regime muda o ritmo:** no Fusca, a 2000 rpm instável dominava a volta e a 1407 rpm estável dominava a ignição.
- **"Quieto" não é "desligado"** enquanto o espectro mostrar linhas harmônicas.
- **Espectro médio esconde o caráter.** Meça também a envoltória e a aspereza.
- **A linha mais forte não é a ignição.** O escape pode reforçar qualquer harmônico do ciclo. No Mustang a linha de
  135 Hz era o 13º harmônico (ordem 6,5) e a comparação foi feita a 2027 rpm em vez de ~1250. O que denunciou: os
  estalos se repetiam a cada 13,00 períodos dessa linha mesmo com o giro variando. Antes de tudo, dobre o sinal em N
  períodos da linha mais forte (N = 2…32): só o N do ciclo verdadeiro (e múltiplos) dá fração periódica alta no grave.
  No pente harmônico, fique com o menor f0 que explica as linhas quase tão bem quanto o melhor.
- **Som de ambiente na renderização:** o ambiente enche o agudo com ruído liso e esconde a falta de agudo do motor (no
  Mustang a 1250 rpm, tudo acima de 4 kHz era o ambiente). Compare o motor sozinho: `PARAMS='{"ambSound":false}'`.
- **Celular junto de uma ponteira:** ouve uma bancada (no Mustang, só uma bancada acima de 4 kHz). O ouvinte externo
  do simulador fica entre as duas ponteiras e soma as bancadas; compare com um canal só.
- **Giro travado abaixo de 5% de pedal:** o controle de lenta continua agindo e, com o giro acima da lenta, vai
  fechando o ar (o coletor do Mustang caía de 0,26 para 0,11 bar em 12 s). O `render.js` congela o integrador.
- **O banco de testes não inclui o navegador.** Reverberação, compressor e equalizador do `app.js` ficam de fora.
- **Calibração:** o que deve mudar o volume de verdade (abafador, vazamento) fica fora de `calibrate()`. Senão o
  ganho do motor inteiro muda e a comparação engana.
- **Filtros numéricos:** passa-faixa de ordem alta com corte em dezenas de Hz a 48 kHz estoura na forma (b, a); use
  seções de segunda ordem (`sos`).

## Do achado ao modelo

1. Liste as fontes candidatas: pulso e vazamentos do escape, irradiação das paredes, trem de válvulas, pistão,
   ventoinha, admissão e borboleta, latas soltas, ambiente, vento.
2. Para cada uma, preveja o ritmo (DFT da sequência de eventos), como depende de rotação e carga, a banda e o caminho
   até o microfone.
3. Pontue contra os dados: coerência com o grave, fração periódica por banda, correlação por cilindro com o pulso,
   linhas no domínio da ordem, presença em trechos quietos e ordem de grandeza física. Exemplo: um orifício
   bloqueado irradia ∝ ṁ·c²·η, com η ≈ 10⁻⁴, ou seja, ~105 dB de potência a 7 g/s, e ainda perde 20–25 dB no filtro
   de ar.
4. Escreva a mudança como mecanismo com parâmetros de unidade (subida e queda da rajada em ms, peso por caminho,
   espalhamento entre cilindros, variação ciclo a ciclo, inclinação do espectro, caminho de irradiação), não como
   ganho.
5. Escreva as metas no formato abaixo e rode os mesmos scripts na renderização nova.

Formato das metas (exemplo do Fusca):

- Terços de oitava relativos a 150–400 Hz em 1/2/4/8/16 kHz: −6/−9/−10,5/−18/−25 dB (±3; ±5 acima de 1 kHz; ±6 acima de
  8 kHz), nas duas rotações de referência.
- Modulação da envoltória de 2–8 kHz: a 2000 rpm, volta 0 dB, ciclo a até 3 dB da volta, ignição ≤ −8 dB; a 1407 rpm,
  ignição 0, volta −4, ordem 1,5 −5, ciclo −8.
- Fração periódica: 0,3–0,5 em 4–16 kHz e ≤ 0,15 em 1–2 kHz.
- Envoltória (passa-baixa 600 Hz) de 2–8 kHz: desvio/média 0,30–0,40, p5 ≈ 0,55, p95 ≈ 1,7.
- Ordens do grave: ordem 3 de −4 a −8 dB da ignição, ordem 5 ≈ −8, ordem 1 ≈ −24.
- Variação: RMS do grave por explosão com variação de 0,16 (estável) a 0,33 (lenta acelerada instável); mesmo
  cilindro, ciclo a ciclo, de 0,1 a 0,3; giro oscilando ±3–6% na lenta acelerada.

## Caso completo: o Fusca

**Queixa:** "grosso" demais, falta o som estridente e o "clec clec".

**Gravação:** vídeo de celular de um Fusca 1600, 98 s, praticamente mono. Trechos: 3–21 s a ~2000 rpm (lenta
acelerada, instável) e 44–54 s a ~1407 rpm (estável).

**O que a medida mostrou:**

- O agudo de 1 a 10 kHz do real ficava 20–30 dB acima do simulado. Por isso o "grosso".
- Esse agudo é do motor: coerência alta com o grave e picos de modulação que acompanham a rotação.
- Ele não é feito de cliques: é ruído que pulsa por volta e por ciclo a 2000 rpm, e por ignição a 1400 rpm.
- A força do agudo de cada cilindro acompanha a força do pulso de escape dele: a fonte é o escape, não a admissão.
- O padrão por volta bate com a construção do escape do Fusca: os dois tubos que passam pelas caixas de calefação se
  alternam com os dois curtos na ordem de ignição.

**O que foi implementado:**

| Mudança | Campo / controle | Por quê |
|---|---|---|
| Abafador "Original antigo" | `muffler: 'classic'` | Caixa de lata só com câmaras, sem lã: o médio-agudo passa |
| Coletor com caixas de calefação | `header: 'heater'` | Tubos longos, que perdem agudo, alternando com os curtos |
| Vedação do escape | `breakout: 'sealed' / 'old' / 'leaky'` | A rajada de cada abertura vaza perto do motor, pelas paredes finas e juntas deslizantes |
| Irregularidade do carburador em carga leve | todos os `fuel: 'carb'` | Cada explosão sai diferente na lenta e no meio pé; com o pé embaixo o motor assenta |
| Carburador sem corte de combustível na desaceleração | todos os `fuel: 'carb'` | O motor segue queimando mal (até ~15% de falhas com o vácuo alto); o som não some e volta |
| Falhas ocasionais na lenta do carburado | todos os `fuel: 'carb'` | A "tossida" do motor velho (~1% das explosões) |
| Taxa de compressão | `compression` (Fusca 7,5:1) | Motor antigo comprime e expande pouco: pulso de escape mais forte |
| Motor traseiro e arrefecimento a ar | `engine: 'rear'`, `cooling: 'air'` | A câmera de trás fica colada no cofre; sem camisa d'água a mecânica soa mais |

**Resultado** (terços de oitava relativos a 150–400 Hz, 1/2/4/8 kHz):

| | ~2000 rpm | ~1400 rpm |
|---|---|---|
| Real | −6 / −9 / −11 / −18 | −8 / −12 / −13 / −20 |
| Antes | −17 / −26 / −29 / −34 | — |
| Agora | −9 / −10 / −14 / −20 | −9 / −11 / −14 / −20 |
| Depois do Mustang | −10 / −11 / −15 / −21 | −6 / −7 / −10 / −16 |

A profundidade da envoltória do agudo ficou em 0,35 contra 0,35 do real (a 2000 rpm). Na lenta, o motor solto agora
oscila ±46 rpm (antes ±15).

A revisão do Mustang (abaixo) mudou a pressão no fim da queima em carga leve, e o Fusca foi reajustado depois dela
(linha "Depois do Mustang"): vazamento do escape +1,7 dB e variação do carburador menor (4% na força e ±10% no ritmo
da queima, antes 18% e ±35%), porque o pulso agora amplifica a variação. A variação entre explosões ficou em 0,17 a
1400 rpm (real 0,16), 0,18 a 2000 rpm (real 0,33) e 0,25 na lenta solta (antes 0,13). As duas rotações puxam para
lados opostos: o real fica mais brilhante a 2000 rpm, o simulado a 1400.

**O que ficou em aberto:**

- **O agudo inchando uma vez por ciclo** (16 Hz a 2000 rpm). Ele vem da desigualdade entre cilindros e da queima
  irregular do motor real: variação de 0,33 entre explosões a 2000 rpm, contra 0,18 no simulado.
- **Acima de 12 kHz** o simulado fica 8–12 dB abaixo, justamente onde a medida do celular é menos confiável.

## Caso: o Mustang

**Queixa:** falta o "semi-estalo a cada ciclo" que vem do escape, atrás e embaixo; som abafado, pior em giro baixo.

**Gravação:** vídeo do YouTube (Opus) de um Mustang GT, celular atrás do carro, na altura do escape. 0–21 s são
aceleradas com cortes de cena. 21–52 s são uma lenta estável a ~1248 rpm (±0,9%), provavelmente a lenta acelerada da
partida a frio: um carro de lenta 700 rpm segurado 30 s nessa rotação, com o agudo subindo 4,5–5 dB em 20 s e o grave
parado. Ela só serve de referência para o estado frio; para o motor quente falta uma gravação.

**O erro de rotação:** a primeira comparação foi feita a 2027 rpm (ver Armadilhas). Tudo o que saiu dela caiu, inclusive
a hipótese de "pequenos estouros aleatórios no escape em carga leve".

**O que o real tem (21–52 s, 289 ciclos):**

- O agudo de 2–20 kHz é o escape de uma bancada só: 4 rajadas por ciclo com o espaçamento de uma bancada do V8 cruzado
  (90, 180, 270, 180°). Um cilindro domina (5,7× a média em 4–16 kHz; 2,3× o segundo).
- Cada rajada dura 3,5–4 ms, sobe em ~2 ms e chega ao pico 2,1–2,6 ms depois da frente do pulso grave do próprio
  cilindro. A força acompanha o pulso do cilindro (correlação +0,69; ±10% no grave dá ±36% no agudo) e varia pouco de
  ciclo a ciclo (0,28–0,36). É o "semi-estalo a cada ciclo": o jato da abertura do escape.
- Fração periódica no ciclo: 0,59 (4–8 kHz) e 0,69 (8–16 kHz). Curtose de 2–8 kHz: 12.
- Em 1–2 kHz há 8 picos por ciclo (as duas bancadas); acima de 4 kHz, só os 4 da bancada do lado do celular.
- Descartados: estouros aleatórios (o real é todo ciclo, preso à grade), bicos da injeção direta (8 por ciclo, iguais),
  bomba de alta pressão (espaçamento regular), trem de válvulas, codec, vento.
- Ordens do grave relativas à ignição: 2,5 +2, 3,5 −8, 5 +1, 6 +4. É o padrão de uma bancada vista de perto.

**O que o simulador tinha (1250 rpm, só o motor):** 20–50 dB a menos que o real acima de 4 kHz (8 kHz −82 contra −50;
16 kHz −110 contra −58, relativos a 150–400 Hz). O agudo que se ouvia ali era o som de ambiente. Em carga leve não
existia o estouro da abertura do escape: a pressão no cilindro na abertura ficava em 0,73 bar quente e 1,05 bar a frio,
contra ~1,2–1,6 e ~2–2,8 bar estimados para o motor real. Causas, em ordem de peso:

1. Queima rápida demais em lenta: 10–90% em 21°, contra 40–60° num motor real com os gases residuais da lenta. O motor
   simulado é eficiente demais, pede pouco ar e a pressão no fim da expansão fica baixa.
2. A centelha não cai depois do ponto morto superior: o atraso de aquecimento do catalisador além do avanço base é
   ignorado sem aviso, então o estado de partida a frio do carro real não é representável.
3. Perda de calor pelas paredes de 37% do calor da queima em lenta (real 25–35%) e de 11% em carga (real 15–25%): não
   depende da pressão.
4. O ruído do jato na válvula tem limiar (razão de pressões 1,3) e um fator de velocidade do pistão. Um jato não tem
   limiar, e a velocidade dele é dada pela razão de pressões, não pelo pistão.

**Teste do auditor numa cópia do DSP:** queima mais lenta abaixo de 0,6 bar no coletor, perda de calor ×0,6, centelha
depois do ponto morto com 25° de atraso a frio e ruído do jato ∝ Mach³.

- Na abertura do escape: 1,28 bar quente e 2,47 bar frio.
- Terços de oitava de 2,5–5 kHz a ±2,5 dB do real (antes, −12 a −20 dB), com as rajadas presas ao ciclo e a variação
  ciclo a ciclo certa.
- Falta: o domínio de um cilindro, a duração da rajada e o nível acima de 8 kHz (−6 a −18 dB) e em 0,5–2 kHz (−5 a −12 dB).
- Efeitos colaterais: +3,5 a +5,5 dB em 1,6–8 kHz a 2500 rpm com 30% de pedal; +2,4 a +3,4 dB em 1–3 kHz em plena carga.
  O Fusca regride (1–8 kHz, 3–5 dB abaixo das metas) e precisa de reajuste do vazamento do escape e da variação do
  carburador.

**Bancadas:** com o X do preset, o simulado tem a ordem 2,5 em −24 dB mesmo num canal só. Com H (acoplamento 0,2–0,35)
e o ouvinte numa ponteira, fica em −11 a −18 dB. Falta confirmar se o carro da gravação tem X ou H.

**Metas** (frio, 1200–1250 rpm, válvula aberta, só o motor, um canal):

- Terços de oitava relativos a 150–400 Hz: 1k −23,5 e 2k −30,6 (±3); 2,5k −42, 3,2k −44, 4k −47, 5k −49, 6,3k −47 e
  8k −50 (±5); 10–16k −52 a −58 (±6–8).
- Fração periódica no ciclo: 0,55–0,75 (4–8 kHz), 0,65–0,80 (8–16 kHz), 0,40–0,55 (1–2 kHz).
- Rajadas: 4 por ciclo, espaçadas (90, 180, 270, 180°) ±15°; a maior 4–6× a média, as outras 1,3–2,5×; largura a meia
  altura 2,5–4 ms; pico 1,5–3 ms depois da frente do pulso grave; variação ciclo a ciclo 0,25–0,40.
- Envoltória de 2–8 kHz: desvio/média 0,7–0,9, p95 2,4, curtose ≥ 10.
- Ordens do grave (um canal): 2,5 ≥ −6, 3,5 ≥ −12, 5 e 6 de 0 a +4 relativas à ignição.
- Quente a 1250 rpm: 1,2–1,5 bar na abertura do escape (metas de som pendentes de uma gravação com o motor quente).

**O que foi implementado** (`TECNICO.md`): a queima mais lenta no vácuo, a centelha depois do ponto morto com 25° de
atraso a frio e a lei do jato sem limiar, como no teste do auditor. Duas diferenças:

- A perda de calor não caiu por igual (×0,6): passou a depender da pressão, `(p_col/p₀)^0,4`. Por igual, ela caía
  também em carga, onde já estava abaixo do real, e a plena carga ganhava +3 a +3,7 dB em 1,6–2 kHz. Assim a lenta
  fica como no teste e a plena carga não muda.
- O ganho do jato desceu de 0,07 para 0,05, para que o meio pé (2500 rpm, 30%) não subisse mais de ~2 dB.

**Resultado** (lenta fria, 1190–1250 rpm, um canal contra um canal da gravação):

| | 2,5k | 4k | 6,3k | 8k | 16k | Fração periódica 4–8k / 8–16k | Curtose 2–8k |
|---|---|---|---|---|---|---|---|
| Real | −37 | −44 | −45 | −48 | −57 | 0,74 / 0,81 | 12,8 |
| Antes | −46 | −58 | −69 | −78 | −94 | 0,62 / 0,67 (cliques) | 4,2 |
| Agora | −45 | −49 | −55 | −59 | −78 | 0,73 / 0,82 | 5,8 |

Efeitos colaterais: 2500 rpm com 30% de pedal, até +2,2 dB em 3–5 kHz; plena carga a 4000 rpm, de −1,2 a +0,1 dB;
lenta quente, +5 a +8 dB acima de 8 kHz; calibração do Mustang igual (ganho 0,625). Na lenta quente a pressão na
abertura do escape ficou em 1,21 bar e a variação entre explosões em 0,17 (antes 0,11, com a de ciclo a ciclo igual).

**Pendente:**

- O agudo ainda fica 6–11 dB abaixo em 2,5–8 kHz e 14–22 dB acima de 10 kHz.
- Falta o cilindro dominante: no real um estalo é 2,3× o segundo; no simulado os 4 da bancada são parecidos.
- 0,5–2 kHz fica 5–12 dB abaixo (abafador esportivo e caminho da válvula, outro assunto).
- O padrão de bancada no grave (ordem 2,5) depende de X ou H. O carro é um GT 2025–26 (S650), e as fontes não confirmam
  qual dos dois vem de fábrica (um blog de loja diz X com ressonadores). O preset segue com X.
- Uma gravação com o motor quente, para as metas do estado quente.

Outro achado da primeira comparação continua valendo: o modo Esportivo fechava a válvula com o pedal em ~5% em ponto
morto. Agora ele só fecha rodando leve em marcha.

## Ferramentas

Ficam em `tools/analise-som/` (Node para o simulador, Python para a análise). Para o Python, crie um ambiente
fora do repositório:

```
python3 -m venv /tmp/venv-som && /tmp/venv-som/bin/pip install numpy scipy matplotlib
```

| Arquivo | O que faz |
|---|---|
| `harness.js` | Monta um preset como o `app.js` faz (geometria e calibração) e renderiza roteiros de pedal, marcha e ignição. `use(arquivo)` troca o `dsp.js` |
| `render.js` | Renderiza um preset segurando uma rotação em neutro e grava `.f32`. `DSP=` aponta outra versão do DSP; `PARAMS=` muda escuta e mixagem (ex.: sem ambiente) |
| `regressao.js` | Todos os presets: partida a frio, lenta, acelerada, desaceleração, em marcha e arcade. Só imprime falhas |
| `comparar.py` | Figura: PSD normalizada, espectrogramas, modulação do agudo e dois ciclos de forma de onda |
| `tercos.py` | Terços de oitava relativos a 150–400 Hz e profundidade da envoltória do agudo |
| `modulacao.py` | Força da modulação do agudo nas taxas de ciclo, volta, ordem 1,5 e ignição |
| `variacao.py` | Variação de explosão para explosão e força de cada cilindro, numa renderização com giro travado |
| `auditoria.py` | A ferramenta do auditor: `timeline`, `lines`, `shape`, `sync` e `orders` (detalhes no cabeçalho do arquivo). Supõe 4 tempos com ignições igualmente espaçadas (`--cyl`); motor de ignição irregular pede adaptar a lógica das janelas |

Exemplos:

```
node tools/analise-som/render.js fusca 1974 /tmp/sim.f32
python tools/analise-som/comparar.py --ciclo 16.45 --saida /tmp/cmp.png "real=/tmp/gravacao.f32:3:21" "sim=/tmp/sim.f32:1:10"
python tools/analise-som/tercos.py "real:/tmp/gravacao.f32:3:21" "sim:/tmp/sim.f32:1:10"
python tools/analise-som/auditoria.py --ffmin 55 --ffmax 80 sync --case real:/tmp/gravacao.f32:3:21 --case sim:/tmp/sim.f32:1:10:65.8 --png /tmp/ciclo.png
node tools/analise-som/regressao.js
```

## O que olhar em cada tipo de veículo

- **Antigos (carburador, anos 50–80):** taxa de compressão baixa, abafador sem lã, juntas e paredes que vazam,
  irregularidade de queima na lenta, mecânica mais exposta (refrigerado a ar, tucho sólido), escape sem catalisador.
- **Modernos:** catalisador (come agudo e estalos), abafador com lã e ressonador, escape ativo (válvula e modos),
  corte de injeção na desaceleração, mapas de estalo de fábrica, admissão com caixa ressonante, queima muito
  regular.
- **Sobrealimentados:** turbina (abafa o pulso), uivo do compressor de parafusos ou lóbulos e por onde ele chega ao
  ouvinte (posição do motor), válvula de alívio, antilag.
- **V8 de virabrequim cruzado:** padrão de ignição por bancada (as ordens 1,5 e 2,5 dão o "galope") e quanto o
  cruzamento do escape (X ou H) mistura as bancadas; compare as ordens da gravação com a DFT do padrão de uma bancada.
- **Motor central ou traseiro, e motos:** a câmera de trás ouve o cofre de perto (admissão, mecânica, compressor).
- **Qualquer um:** onde estava o microfone da gravação (a perspectiva muda tudo) e se há trechos com o motor desligado
  para medir o piso.
