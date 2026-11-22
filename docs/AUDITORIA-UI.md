# Auditoria visual e de interface (18/11/2026)

Todas as páginas foram olhadas juntas pela primeira vez: `index.html` (menu), `ronco.html`, `turbina.html`, `diesel.html`, `radial.html`, `rotativo.html`, `vapor.html`, `eletrico.html` e `passagem.html`. Este documento tem o método, o sistema visual que saiu da auditoria, a lista de defeitos por página (com a severidade e o que foi feito), a comparação antes × depois, a lista **funcional** (para quem cuida do DSP e dos dados) e o que ficou de fora.

## Método

1. **Capturas de tudo.** `tools/capturas.mjs` fala CDP direto com o Chromium headless (sem dependências, como os `tools/*-navegador.mjs`), serve o `dist/` em `/data/engine/` e percorre página × largura (1440, 1100, 768 e 400 px) × estados: parado, motor ligado em lenta, acelerando, o painel rolado de tela em tela, um preset de cada família, o foco do teclado e os estados próprios de cada página (picape, caminhão com freio-motor, gerador com carga, locomotiva em notches e bancada no Diesel; avião com manete, partida do DC-3 em fases, R-4360 e Sherman no Radial; Wankel, X-Engine e palhetas nos Rotativos; calibrando, andando, apito e cenário no Vapor; acelerando, regeneração, Taurus no do-re-mi, furadeira e drone no Elétrico; partida, decolagem, pós-combustão, reversor, mapa da passagem e a bordo na Turbina; trem no túnel, carro, avião de hélice, jato, helicóptero, locomotiva, drone, gimbal, ficha da fonte e as três câmeras na Passagem).

   ```sh
   npm run build
   node tools/capturas.mjs --saida .claude/capturas/depois            # tudo: ~800 PNG, ~35 min
   node tools/capturas.mjs --paginas diesel --larguras 1440,400 --estados "locomotiva|gerador"
   node tools/capturas.mjs --so-parado                                 # só o primeiro estado de cada página: ~5 min
   ```

   As capturas ficam fora do git (`.claude/capturas/antes/` e `.claude/capturas/depois/`). A primeira rodada, antes de qualquer correção, deu 809 capturas.
2. **Auditoria automática.** Em cada captura principal o script mede na página e grava em `relatorio.json`: rolagem horizontal, elementos para fora da janela, texto cortado, rolagem dupla, controles e canvas sem nome acessível, grupos de chips sem nome, contraste abaixo de AA (texto do DOM; o dos canvas não entra), ids repetidos, letras abaixo de 11 px e alvos de toque abaixo de 28 px.
3. **Olho.** As capturas foram lidas uma a uma (as páginas altas em folhas de colunas); a lista abaixo saiu daí.
4. **Correção**, do mais grave ao detalhe, **capturas depois** e os portões.

## Sistema visual

As páginas foram feitas uma depois da outra e cada uma tinha copiado e mudado um pouco a anterior. O que vale agora, para todas (tokens e regras no começo de `src/ui/estilo.css`):

| Peça | Regra |
|---|---|
| **Tokens** | Cores (`--bg`, `--panel`, `--raise`, `--line`, `--line-forte`; texto `--ink`, `--muted`, `--faint`; `--apagado` só para traços; acentos `--gold`, `--blue`, `--violet`, `--hot`), tipografia (`--t-micro` 10,5 · `--t-mini` 11 · `--t-nota` 12 · `--t-ctl` 12,5 · `--t-corpo` 14 · `--t-secao` 17 · `--t-logo` 30 px), espaçamento em passos de 4 px (`--e-1` a `--e-6`, mais `--e-chip` 6 px), raios (`--r-p` 4, `--r` 6, `--r-pilula`) e medidas (`--alt-ctl` 40, `--alt-chip` 30, `--larg-painel` 400, `--larg-chave`). Os CSS das páginas não têm mais valor solto de cor. |
| **Texto** | Três níveis, todos AA sobre os três fundos: `--ink` 15:1, `--muted` 7,3:1, `--faint` 5,6:1 (4,7:1 sobre `--raise`). O `--faint` antigo (3,05:1) era usado em texto. |
| **Barra** | `Barra` (`src/ui/Barra.tsx`), igual em todas, menu incluído: em cima a faixa do site (`‹ Motores` e as oito páginas, a atual em dourado, `aria-current`); embaixo o nome da página (`<h1>`), a placa com o resumo do que está montado e o botão principal (`BotaoIgnicao`, com a luz que pulsa enquanto carrega ou calibra e a borda vermelha no erro). |
| **Famílias e presets** | `FamilyNav` e `PresetNav` em todas (a Passagem ganhou famílias). Cada linha é uma `Faixa`: rola de lado, a ponta esmaece onde há mais, uma seta leva até lá, a roda do mouse rola a faixa e o escolhido é trazido à vista. |
| **Palco** | Mostradores redondos (conta-giros, ciclo, EICAS, fan, manômetro) soltos sobre o fundo, todos no mesmo desenho (trilho grosso, faixa vermelha em degradê, algarismos na fonte de mostrador, leitura grande no meio, letras miúdas nunca abaixo de 10 px). Gráficos e vistas (onda, espectro, traços de pressão, mapa, cena 3D) em quadro (`.quadro`) com legenda (`.legenda`). Listas de leituras (`.readout` / `.ro-row`) soltas, nome em caixa alta miúda à esquerda e valor em mono à direita; `.grande` para o número principal. |
| **Três colunas** | Diesel e Rotativos têm uma coluna própria (`.cluster-3` / `.extra`): o traço de pressão em cima e as leituras da combustão embaixo. Antes essas leituras disputavam a altura com o ciclo e com a onda. |
| **Painel** | `Section` com o mesmo título; a seção que abre e fecha (`recolhivel`) usa o título inteiro como botão. A seção de escuta chama **Escuta e ambiente** em todas e vem primeiro; onde o comando do motor fica no painel (Vapor, Elétrico) ela vem logo depois dele. Em tela estreita o painel vira colunas contínuas (sem os buracos da grade por linhas). |
| **Estados** | Escolhido = dourado (chips, posições da manete, degraus de carga, cenários). Momentâneo ou alerta = vermelho (freio apertado, reversor, corte). Desabilitado = 38% com cursor de proibido. Foco = contorno dourado de 2 px (no slider, no botão dele). |
| **Teclas** | `.key` é a tecla de uma letra (mono); `.key.wide` é o botão com texto (corpo 600). Havia três aparências. |
| **Números** | Vírgula decimal e ponto de milhar (`src/ui/formato.ts`). Listas de ângulos resumidas: `8 × 90°`, `(67,5° 22,5°) × 4`, `28 de 20,9° a 33,3°`, com a lista inteira na dica. |
| **Nomes** | O mesmo controle tem o mesmo nome em todas as páginas, e o nome acompanha o portador (um gerador não tem "câmera atrás" nem "cofre"). Sem ids crus na tela (`unitaria`, `lateral4 / periferico`, `tunel`, `pa`, `vao`). Símbolos de fórmula saem dos rótulos e vão para a dica. |
| **Acessibilidade** | Cada canvas tem `role="img"` e `aria-label`; os que se arrastam (mapa, cena 3D, pedal, manete) têm nome; cada grupo de chips herda o rótulo do campo como nome. |

## Defeitos

Severidade: **quebrado** (não dá para ler ou usar), **feio**, **inconsistente** (igual a outra página só que diferente), **detalhe**. Situação: ✔ corrigido · ◐ em parte · ✘ ficou de fora (motivo no fim).

### Comuns a todas as páginas

| # | Sev. | Defeito | |
|---|---|---|---|
| C1 | inconsistente | Não havia link visível de volta ao menu nem navegação entre as páginas: só o logotipo era link, sem nada que dissesse isso | ✔ faixa do site na barra |
| C2 | feio | Famílias e presets cortados na borda no meio da palavra ("Clássicos", "DODGE CHALLENGER HELL"), sem indicar que a linha rola; o preset escolhido podia ficar fora da vista | ✔ `Faixa` |
| C3 | inconsistente | A seção de escuta tinha quatro nomes ("Escuta e ambiente", "Escuta", "Ouvinte e ambiente", "Ouvinte e mixagem") e lugares diferentes (última na Turbina) | ✔ |
| C4 | inconsistente | Volume em % ("Volume"), em % com outro nome ("Master", Vapor) e em dB (Elétrico) | ✔ "Volume", % |
| C5 | inconsistente | O estado escolhido tinha duas cores: dourado nos chips e nas posições da manete, vermelho nos degraus do gerador | ✔ |
| C6 | inconsistente | `.key.wide` com três aparências (mono no Ronco, mono de 12 px na Turbina, corpo 600 no Vapor e na Passagem) | ✔ |
| C7 | inconsistente | Ponto e vírgula decimal na mesma tela (`6.20 L` e `11,0:1`; `2.66 : 1`; `+0.56 bar`; `0.36 ms`; `83.5°`) | ✔ Ronco, Diesel, Radial, Rotativos |
| C8 | detalhe | `--faint` (3,05:1) usado em texto: contagem das famílias (2,63:1 medido), "EXEMPLOS" do menu, legendas de todos os canvas | ✔ |
| C9 | detalhe | Nenhum grupo de chips tinha nome acessível (612 somando as capturas); os canvas não tinham `role` nem nome próprio; a cena 3D recebia foco sem nome | ✔ |
| C10 | feio | Painel em tela de até 1100 px: grade por linhas, cada linha com a altura da seção mais alta, deixando buracos de centenas de px | ✔ colunas |
| C11 | detalhe | Favicon vazio (`data:,`) em todas; descrição do menu ainda dizia "Ronco, Turbina e os próximos" | ✔ `public/favicon.svg`, `theme-color` |
| C12 | detalhe | Espaçamentos, raios e tamanhos de letra soltos em sete CSS; `.telemetria`, `.graficos` e `.key.wide` definidos duas e três vezes | ✔ tokens |
| C13 | inconsistente | Leituras em quadro em três páginas e soltas em cinco; mostrador redondo em quadro só no Vapor | ✔ |
| C14 | detalhe | Peso 600 do IBM Plex Mono usado e não carregado (negrito sintético) | ✔ |
| C15 | detalhe | As legendas dentro da onda ficavam debaixo do traço em giro alto | ✔ fundo atrás da legenda |
| C16 | detalhe | O botão principal não mostrava que estava carregando ou calibrando, nem o erro | ✔ |
| C17 | inconsistente | O mesmo controle com nomes diferentes (Rotativos: "Onde você está: No carro / Na rua", "Na ponteira / Atrás do carro"; Ronco: "Observador: Junto com o carro / Parado na via", "Ao lado do escape / Câmera atrás") e nomes de carro em gerador, locomotiva, avião e ferramenta | ✔ |
| C18 | detalhe | Estado vazio dos gráficos: texto encostado num canto, em três redações | ✔ centrado, mesma frase |
| C19 | quebrado | Tela larga e baixa (notebook de 1366 × 768): as leituras do ciclo passavam por cima da onda já no preset padrão (5 px no Ronco e no Radial, 55 px no Diesel; medido no build de antes) | ✔ a onda encolhe, as dicas somem; abaixo de 700 px de altura a página rola |

### Menu

| # | Sev. | Defeito | |
|---|---|---|---|
| M1 | feio | Sem acabamento de porta de entrada: oito caixas de texto, metade da tela vazia, sem ícone | ✔ ícone de traço por tipo, chamada, dicas, rodapé |
| M2 | inconsistente | Descrições em jargão e de tamanhos desiguais ("Ranhuras, PWM e redução."; "Wankel (câmara trocoidal, janelas, 1 080° por câmara)"; "biela-mestra, fileiras ímpares") | ✔ o que é, o que se faz, exemplos |
| M3 | detalhe | Quebras ruins: "1 / 080°", "T- / 6" | ✔ exemplos em etiquetas |
| M4 | inconsistente | Ordem dos cartões diferente da do README; "Passagem e modo de testes" com o título em duas linhas | ✔ |
| M5 | detalhe | "EXEMPLOS" a 2,8:1 | ✔ |
| M6 | detalhe | Código do cartão "em construção" sobrando | ✔ removido |
| M7 | inconsistente | Barra própria, diferente da das páginas | ✔ |

### Ronco

| # | Sev. | Defeito | |
|---|---|---|---|
| R1 | feio | Ciclo de ignição: os graus colados nos cilindros quando o mostrador é pequeno (1100 e 400 px); o ponteiro riscando o número do centro | ✔ |
| R2 | feio | Presets turbo: o arco da pressão passava por cima de "km/h · N·m" | ✔ arco no vão de baixo |
| R3 | detalhe | Letras do conta-giros com 7 a 8 px em tela pequena | ✔ |
| R4 | detalhe | "Intervalos 90° 90° 90° 90° 90° 90° 90° 90°" | ✔ "8 × 90°" |
| R5 | quebrado | Aviação em 400 px: as marcas da manete saíam da tela (12 px de rolagem horizontal) | ✔ |
| R6 | detalhe | Aviação: "0 km/h" num avião; "água" em motor refrigerado a ar | ✔ rotação da hélice; "cabeça" |
| R7 | inconsistente | Posições da manete em fonte diferente das da Turbina | ✔ |

### Turbina

| # | Sev. | Defeito | |
|---|---|---|---|
| T1 | quebrado | 400 px: a linha das posições estourava a largura (44 px de rolagem horizontal, "reversor" cortado) | ✔ |
| T2 | feio | Marcas da manete invadindo a coluna do fan: lia-se "LENTA NO OUVIDO" | ✔ a manete tem a largura da marca mais comprida |
| T3 | feio | EICAS: "N1 · %" e "EGT · °C" debaixo do arco e do ponteiro | ✔ |
| T4 | feio | Legenda do fan por cima das palhetas do estator | ✔ |
| T5 | feio | Marcadores do espectro um sobre o outro ("choque 3.123BPF 5.070 Hz") e cortados na borda | ✔ filas sem colisão |
| T6 | feio | EICAS colado no alto, com um vazio embaixo | ✔ centrado |
| T7 | feio | Parecia erro: nota vermelha já no preset padrão ("A 100%: ponta a Mach 1,38…") e "Ponta da pá Mach 0,65" vermelho no turboélice (a classe sobrava do avião anterior) | ✔ |
| T8 | detalhe | Mapa: "150 m" debaixo do avião; rótulos dos anéis sobre os lóbulos | ✔ |
| T9 | inconsistente | "Escuta" por último | ✔ |

### Diesel

| # | Sev. | Defeito | |
|---|---|---|---|
| D1 | quebrado | Locomotiva (V16): ciclo ilegível, 16 cilindros amontoados com os graus por cima; leituras de nove linhas espremendo o mostrador | ✔ |
| D2 | quebrado | 400 px: o balanceamento ficava debaixo da onda; a ordem de ignição saía da tela | ✔ |
| D3 | feio | Faixa das leituras do diesel: valores quebrando em duas a quatro linhas desalinhadas ("notch 8 · / 2706 kW no / gerador de / tração") | ✔ coluna própria |
| D4 | feio | Arco do turbo por cima de "km/h · N·m" | ✔ |
| D5 | feio | Parecia defeito: o pedal "Acelerador" à vista no gerador e na locomotiva, onde ele não faz nada (o governador é isócrono) | ✔ só aparece no veículo e na bancada |
| D6 | inconsistente | Degrau de carga escolhido em vermelho | ✔ |
| D7 | detalhe | "0 km/h" no gerador, na locomotiva e na bancada | ✔ kW |
| D8 | detalhe | Placa com o id cru "unitaria" e ponto decimal | ✔ |
| D9 | inconsistente | "Junto com o veículo / Parado na via", "Câmera atrás" e "Cofre" num gerador | ✔ |
| D10 | detalhe | "meia-ordem" no 2 tempos; "Chaminé: Ligado / Desligado"; diâmetro da chaminé só em polegadas; "Dinamômetro 0%" solto, parecendo controle | ✔ |

### Radial

| # | Sev. | Defeito | |
|---|---|---|---|
| Ra1 | quebrado | R-4360: 28 cilindros numa trilha só, virando um borrão; leituras de doze linhas por cima da onda | ✔ uma trilha por fileira, leituras resumidas |
| Ra2 | feio | Marcas da manete sobre as leituras; em 400 px, fora da tela | ✔ |
| Ra3 | detalhe | "água" num radial refrigerado a ar; "0 km/h" num avião | ✔ |
| Ra4 | feio | As fases da partida (energizar, engatar, contar pás) só apareciam no painel, lá embaixo | ✔ aviso no conta-giros |
| Ra5 | detalhe | Rótulos de fórmula: "1ª − N/2", "ΔPMS das articuladas", "Biela-mestra (L/r)", "Pino das articuladas (r_k/r)", "Vedação do anel (breakout)", "Estaques" | ✔ |
| Ra6 | inconsistente | "5 m do cubo" e "Na carenagem" num tanque | ✔ |

### Rotativos

| # | Sev. | Defeito | |
|---|---|---|---|
| Ro1 | quebrado | O traço p–α ficava atrás da onda (30 px à vista); em 400 px, atrás do câmbio | ✔ |
| Ro2 | quebrado | Anel do ciclo minúsculo, com o texto do centro por cima das câmaras | ✔ |
| Ro3 | feio | Dez leituras com os nomes quebrando em duas linhas | ✔ |
| Ro4 | detalhe | Placa com ids crus: "lateral4 / periferico", "x / x" | ✔ |
| Ro5 | feio | Palhetas (ferramenta pneumática): "0 km/h", "água", "ignição 334 Hz", "Hospedeiro" | ✔ |
| Ro6 | inconsistente | Nomes da escuta diferentes dos do Ronco | ✔ |
| Ro7 | detalhe | "Raio gerador R", "Excentricidade e", "Largura b", "V_cam = 3√3·e·R·b", "16°e" | ✔ |

### Vapor

| # | Sev. | Defeito | |
|---|---|---|---|
| V1 | feio | Manômetro: traço fino, números de 9 px, dois ponteiros sem legenda, em quadro; desenho diferente de todos os outros mostradores | ✔ |
| V2 | feio | Fita dos escapes: quatro pontos num quadro grande, sem nome; barra de esforço sem nome | ✔ |
| V3 | detalhe | "Chuffs", "Release", "Estados: segurança — · injetor — · bomba sim…", "Reverser", "Drifting", "Lickey", "μ 0,22" | ✔ |
| V4 | inconsistente | Atalhos do teclado dentro dos rótulos ("Regulador (W/S, X fecha)") | ✔ ficam na linha das teclas e nos botões |
| V5 | detalhe | Cenários sem nome de grupo; linha de leitura sem nome | ✔ |
| V6 | inconsistente | Não tem onda nem espectro (as outras têm) | ✘ |

### Elétrico

| # | Sev. | Defeito | |
|---|---|---|---|
| E1 | feio | Espectro anotado: nomes empilhados ("engren." quatro vezes), por cima de "dB SPL" | ✔ um nome por tipo de linha, na mais forte |
| E2 | detalhe | "F_E", "F_C · N", "M · FLUXO" (o f_e virava F_E na caixa alta), "I_n", "Φ", "Z_s", "δ" | ✔ |
| E3 | feio | Teclado do do-re-mi: teclas estreitas com o nome na vertical, a 9,5 px | ✔ |
| E4 | detalhe | Placa: "SIC" (é SiC), "Z_s 54", "i 9,06" | ✔ |
| E5 | inconsistente | "Avançado ▸" como chip no lugar do título; botão "Ligar" | ✔ |
| E6 | feio | Quadro das leituras com metade vazia | ✔ |
| E7 | detalhe | "10k" cortado na borda do espectro | ✔ |

### Passagem

| # | Sev. | Defeito | |
|---|---|---|---|
| P1 | quebrado | Avião, jato, helicóptero e drone: a câmera padrão só mostrava o chão (verde saturado); o corpo passava fora do quadro | ✔ enquadramento, sombra, prumo, rótulo |
| P2 | quebrado | 400 px: o resumo sobre a cena virava uma coluna de uma palavra por linha tapando a cena | ✔ |
| P3 | feio | Céu preto, luz chapada, chão estourado; ouvinte de poucos pixels; nenhum rótulo | ✔ |
| P4 | feio | 29 presets numa linha só | ✔ cinco famílias |
| P5 | feio | Telemetria num quadro alto, metade vazio, tirando largura da cena | ✔ |
| P6 | detalhe | Ids sem acento no resumo ("admissao", "mecanica", "pa", "vao", "pantografo"), na placa ("tunel", "ceu") e nas listas; "abeam" | ✔ |
| P7 | detalhe | Linha de leitura sem nome; valores quebrando | ✔ |
| P8 | feio | Avião sem asa e carro sem roda (só a casca); "Segue o corpo" longe demais para um carro | ✔ silhueta aproximada |
| P9 | detalhe | "RT60", "Binaural (ITD + ILD)", "Azimute", "Elevação", "refDist" | ✔ |

### Contagem

| Página | quebrado | feio | inconsistente | detalhe | total | corrigidos |
|---|---|---|---|---|---|---|
| Comuns | 1 | 2 | 8 | 8 | 19 | 19 |
| Menu | 0 | 1 | 3 | 3 | 7 | 7 |
| Ronco | 1 | 2 | 1 | 3 | 7 | 7 |
| Turbina | 1 | 6 | 1 | 1 | 9 | 9 |
| Diesel | 2 | 3 | 2 | 3 | 10 | 10 |
| Radial | 1 | 2 | 1 | 2 | 6 | 6 |
| Rotativos | 2 | 2 | 1 | 2 | 7 | 7 |
| Vapor | 0 | 2 | 2 | 2 | 6 | 5 |
| Elétrico | 0 | 3 | 1 | 3 | 7 | 7 |
| Passagem | 2 | 4 | 0 | 3 | 9 | 9 |
| **Total** | **10** | **27** | **20** | **30** | **87** | **86** |

## Antes e depois

As imagens completas ficam fora do git; as de `docs/ui/` são as do "depois".

- **Menu.** Antes: oito caixas de texto no alto de uma tela vazia. Depois: a barra do site, a frase que diz o que é, três dicas, oito cartões com ícone, nome, o que é, o que se faz e exemplos em etiquetas, "Abrir →", estados de ponteiro, foco e clique.
- **Ronco.** O desenho de referência; mudou pouco: faixa do site, pontas esmaecidas e setas nos presets, os graus do ciclo fora dos cilindros, o ponteiro do ciclo sem riscar o número, "8 × 90°", vírgulas, o arco do turbo fora das leituras.
- **Turbina.** Antes: "LENTA NO OUVIDO", "N1" debaixo do arco, rótulos do espectro embolados, rolagem horizontal no celular. Depois: a manete com a largura das marcas, nome dos mostradores acima do número, EICAS centrado, rótulos do espectro em filas com fundo, posições quebrando em linhas, "Escuta e ambiente" primeiro.
- **Diesel.** Antes (locomotiva, a "completamente zoada"): um ciclo de 120 px com 16 cilindros uns sobre os outros, nove linhas de intervalos, a faixa de leituras quebrando em quatro linhas e, no celular, o balanceamento debaixo da onda. Depois: três colunas (conta-giros, ciclo com as duas bancadas legíveis e "16 × 22,5°", traço p–θ com eixos e as nove leituras numa linha cada), sem o pedal onde ele não manda, degraus de carga em dourado.
- **Radial.** Antes (R-4360): um borrão de 28 cilindros e doze linhas de leitura por cima da onda. Depois: quatro trilhas, uma por fileira, leituras resumidas, as fases da partida no conta-giros ("ENERGIZANDO · 320 Hz", "GIRANDO · 4 PÁS"), "cabeça" no lugar de "água", a rotação da hélice no lugar de "0 km/h".
- **Rotativos.** Antes: anel de 110 px, dez leituras de duas linhas e o traço p–α escondido atrás da onda. Depois: três colunas, o anel grande, o traço p–α inteiro com eixos em cima das sete leituras da câmara.
- **Vapor.** Antes: um manômetro de traço fino num quadro, quatro pontos sem nome, "Chuffs / Release / Estados". Depois: o manômetro no desenho do conta-giros com a caixa de vapor nomeada, leituras em português, a fita e a barra de tração com legenda, cenários com nome de grupo.
- **Elétrico.** Antes: "F_E", "F_C · N", "engren. engren. engren.". Depois: leituras por extenso, um nome por tipo de linha no espectro, numa faixa própria no alto, o teclado do do-re-mi com teclas legíveis, "Avançado" como seção que abre.
- **Passagem.** Antes: céu preto; nos aviões, uma tela verde. Depois: céu com horizonte, luz de lado, o ouvinte com rótulo e tamanho mínimo, o corpo no ar enquadrado com sombra, prumo e rótulo ("avião · 100 m"), asas, hélice e rodas, cinco famílias de presets, leituras soltas ao lado e os três gráficos empilhados.

## Auditoria automática: antes × depois

Totais das 36 capturas do estado "parado" (9 páginas × 4 larguras), medidos pelo `tools/capturas.mjs` (`--so-parado` refaz só esta parte em uns 5 minutos):

| Medida | Antes | Depois |
|---|---|---|
| Capturas com rolagem horizontal | 2 (Turbina e Radial em 400 px; o Ronco estourava na família Aviação) | 0 |
| Elementos para fora da janela | 3 | 0 |
| Rolagem dupla (página e painel rolando juntos) | 0 | 0 |
| Controles sem nome acessível | 0 | 0 |
| Grupos de chips sem nome acessível | 608 | 0 |
| Textos do DOM com contraste abaixo de AA | 32 (a contagem das famílias, 2,63:1, em todas) | 0 |
| Alvos de toque com menos de 28 px | 168 (as famílias) | 0 |
| Ids repetidos | 0 | 0 |
| Erros no console durante as capturas | 0 | 0 |

A rodada completa de depois deu 823 capturas (809 antes; entraram o estrondo sônico da Turbina e as páginas que passaram a rolar). Em nenhuma largura sobrou rolagem horizontal, em nenhum estado. O que a medida automática não vê (sobreposição dentro dos canvas, leituras por cima da onda, a cena 3D) está na lista de defeitos acima e foi conferido olhando as capturas de depois; a altura de 1366 × 768, que não está nas quatro larguras, foi medida à parte (antes: leituras 5 a 55 px por cima da onda; depois: 12 px de folga em Ronco, Turbina, Diesel, Radial e Rotativos).

## Funcional (para quem cuida do DSP e dos dados)

Coisas vistas na auditoria que não são de aparência. Nada disto foi mexido.

1. **Rotativos: pressão 100 vezes maior.** "Pico na câmara" e o traço p–α mostram 804 bar na lenta do RX-7 e 3.838 bar no X-Engine em carga. `src/engines/rotativo/dsp.ts` (linhas 556–557) divide Pa por 1000 e chama de bar (seria kPa: 8 bar e 38 bar).
2. **Rotativos: "Óleo: fumaça azul 77–91%"** em lenta. O número é a baforada da partida, que cai a zero em 20 s (`src/engines/rotativo/dsp.ts`, linha 323: `max(0, 1 − runT/20) × (0,5 + 0,5 × (1 − warm))`); a página (`src/pages/rotativo/mostradores.ts`, linha 167) mostra como porcentagem, e lê como medida de óleo queimado.
3. **Diesel: pedal sem função no gerador e na locomotiva.** O governador é isócrono (`alvoIsocrono()` ignora `thr` nesses portadores). A interface agora esconde o pedal ali; se o pedal devia agir (por exemplo como carga), é no DSP.
4. **Diesel: "Observador: Parado na via" fora do veículo.** O controle some no gerador, na locomotiva e na bancada, mas a tecla `V` ainda troca o observador; o DSP não tem via para esses portadores.
5. **Vapor: estacionárias sem leituras.** O portador gerador não repassa a telemetria do motor: no Corliss ficam vazias Corte, Escapes, No escape, Tração, Auxiliares, Caldeira e Apito, e o manômetro não se mexe.
6. **Radial: "Temperatura" fixa.** O slider da temperatura fixa nasce sempre em 90 °C (`valor={90}` em `src/pages/radial/Painel.tsx`): não acompanha o valor escolhido quando o painel é montado de novo, e a página não guarda esse valor no estado.
7. **Elétrico: os nomes das linhas vêm prontos do motor** (`NOME_MEC` em `src/engines/eletrico/constantes.ts`: "2f_e", "Z_s·f_rot", "engren."). A página traduz para "2× elétrica", "ranhuras", "engrenagem" numa tabela própria; um tipo novo de linha aparece com o nome cru até entrar nessa tabela.
8. **Passagem: ouvinte fora do túnel.** No preset "Trem-bala no túnel" o ouvinte fica a 3 m da lateral, e a parede do túnel de 64 m² fica a 4 m do eixo: o ouvinte está 0,7 m para fora da parede desenhada. É geometria da Cena, não da página.
9. **Passagem: o mesmo trem com e sem motor.** "Trem-bala no túnel" usa o motor elétrico do N700; "Trem-bala a céu aberto" e "Trem-bala no viaduto" (`src/pages/passagem/presets.ts`, linhas 139–140) são `motor: 'nenhum'`, e o chip mostra "Sem motor" para o mesmo trem.
10. **`.gitignore`**: a terceira linha é `.claudereferencias/` (faltou a quebra de linha): nem `.claude` nem `referencias/` estão ignorados por ele.
11. **`npm run navegador:ronco` e `navegador:turbina`** saem com "uso: …" porque os dois scripts exigem a URL (os outros seis servem o `dist/` sozinhos).
12. **Testes de navegador com espera fixa.** Ronco (3 s até a lenta), Radial (1,5 s até girar), Diesel (10 s na troca de portador) e Passagem (200 ms por mensagem, janelas de nível) falham com a máquina carregada; no Ronco e na Passagem isso foi medido também no build de antes (ver Portões). Trocar a espera fixa por esperar a condição até um limite, como os outros trechos dos mesmos testes já fazem, tira a dependência da carga sem afrouxar o que é conferido.

## Portões

No `dist/` do último commit desta rodada, Chromium headless, áudio pelo AudioWorklet:

| Portão | Resultado |
|---|---|
| `npm run typecheck` | passa |
| `npm run build` | passa |
| `navegador:ronco`, `:turbina`, `:diesel`, `:radial`, `:rotativo`, `:vapor`, `:eletrico`, `:passagem` | os oito TUDO OK numa rodada só, sem repetir (rodada final, carga de 4 a 60) |
| `paridade:ronco` | PARIDADE OK: tudo idêntico ao legado |
| `paridade:turbina` | TUDO IDÊNTICO (34 aviões, 3 cenários do `render.ts` + 7 extras) |
| `paridade:acoustics` | 23 verificações: tudo idêntico bit a bit |

As três paridades foram rodadas no último commit (`dc54275`). Nenhum arquivo de `src/engines/`, `src/scene/`, `src/carriers/`, `src/acoustics/` ou `src/worklet/` foi tocado (o `git diff` dessas pastas contra `1a2a73c` é vazio).

**Sobre a rodada anterior.** Na rodada de antes desta, com a máquina com carga de 12 a 105 (32 núcleos, outros trabalhos de som em paralelo), Turbina, Rotativos, Vapor e Elétrico passaram de primeira e Ronco, Radial, Diesel e Passagem só repetindo (até a segunda tentativa). Esses quatro têm esperas fixas: 3 s para o Ronco pegar e chegar à lenta, 1,5 s para o Radial estar girando, 200 ms para a mensagem de um slider da Passagem chegar ao worklet, janelas de tempo para o pico de nível. Com a máquina carregada eles falham também no build de antes desta rodada (`1a2a73c`), medido aqui: o do Ronco falhou na mesma verificação, e o da Passagem passou 1 vez em 3 (falhando em "slider de elevação", "slider da lateral" e "nível no ouvido na passagem do carro", as mesmas que falharam no build novo). O tempo do clique até a primeira telemetria no Radial deu 3,2 a 4,7 s no build novo e 3,3 a 4,9 s no de antes, com carga 105.

**Testes atualizados de propósito** (a verificação continua a mesma, com o texto ou a ordem novos): Ronco (placa com vírgula), Diesel (placa com vírgula; a leitura do gerador agora é "210 kW · 60,0 Hz" com o nome "Alternador"), Rotativos (placa com os nomes das janelas), Turbina (ordem das seções, dos sliders e dos chips, com "Escuta e ambiente" primeiro), Elétrico (placa por extenso, seção "Escuta e ambiente", chip "Livre" no lugar de "Gimbal"), Passagem (seção "Volume"). Radial e Vapor não mudaram.

## O que ficou de fora

- **V6, onda e espectro no Vapor.** Seria um instrumento novo; a tarefa era aparência, estrutura e texto.
- **Modelos 3D de verdade.** As silhuetas da cena (asa, empenagem, hélice, rodas) são caixas com medidas tiradas do comprimento do corpo, marcadas como aproximação no código. Locomotiva a vapor, trator e barco continuam como a casca genérica.
- **Juntar `ronco/mostradores.ts` e `diesel/mostradores.ts`.** O do Diesel é uma cópia do do Ronco; as correções foram feitas nos dois. Unificar mexeria em código que os testes de som usam.
- **Títulos das páginas.** Já eram consistentes ("Ronco", "Turbina"…) e os testes conferem o texto exato; ficaram como estavam.
- **Tema claro.** O site tem um tema só, escuro.
- **Contraste dentro dos canvas** não é medido pela auditoria automática (só o texto do DOM); foi conferido pelos tokens.
- **Casca da migração.** `src/pages/comum/Casca.tsx`, `ProvaDoWorklet.tsx` e `casca.css` ("Migração em andamento") não são usados por nenhuma página; ficaram no lugar para a auditoria de código decidir.
- **Atalhos nos rótulos da aviação.** "Magnetos (tecla M)" e "Mistura (teclas [ e ])" em `src/pages/comum/Aviacao.tsx` ainda trazem a tecla no rótulo (no Vapor ela saiu); o teste do Radial lê esses controles pelo id, então é só texto.
- **`docs/TECNICO.md`.** "Estrutura do projeto" ainda não lista o que entrou em `src/ui/` (`Faixa`, `paginas.ts`, `formato.ts`), `tools/capturas.mjs`, `docs/ui/` nem este documento; o arquivo não estava entre os que esta tarefa podia editar.

## Pendências, prontas para executar

O que sobrou das duas listas acima, com o arquivo e o que fazer. A primeira tabela é de interface (não muda o som); a segunda é de quem cuida do DSP, dos dados e dos testes. Depois de qualquer uma: `npm run typecheck`, `npm run build`, o `navegador:*` da página e `node tools/capturas.mjs --so-parado --paginas <página>` para olhar o resultado.

### Interface

| # | O quê | Onde | O que fazer |
|---|---|---|---|
| I1 | Tecla `V` do Diesel troca o observador mesmo com o controle escondido (gerador, locomotiva, bancada) | `src/pages/diesel/teclado.ts`, linha 30 | Só chamar `setObserver` na mesma condição que mostra o controle (`veiculo`, em `src/pages/diesel/Painel.tsx`, linha 52) |
| I2 | "Óleo: fumaça azul 77%" lê como medida | `src/pages/rotativo/mostradores.ts`, linha 167 | Mostrar "fumaça azul na partida" sem a porcentagem (o número é uma rampa de 20 s, ver Funcional 2); `tools/rotativo-navegador.mjs` não lê esse campo |
| I3 | Slider "Temperatura" do Radial nasce sempre em 90 °C | `src/pages/radial/Painel.tsx`, linha 120 | Fazer como "Água do motor" do Ronco (`src/pages/ronco/Painel.tsx`, linha 283): valor inicial tirado da telemetria em vez do `valor={90}` |
| I4 | Tecla dentro do rótulo: "Magnetos (tecla M)", "Mistura (teclas [ e ])" | `src/pages/comum/Aviacao.tsx`, linhas 22 e 26 | Tirar a tecla do rótulo e pôr nas dicas de teclado da página (`.hints`), como no Vapor; o teste do Radial lê os controles pelo id |
| I5 | Casca da migração sem uso | `src/pages/comum/Casca.tsx`, `ProvaDoWorklet.tsx`, `casca.css` | Apagar os três (nenhuma página importa; conferir com `grep -rn "comum/Casca\|ProvaDoWorklet" src`) |
| I6 | Mostradores do Diesel são cópia dos do Ronco | `src/pages/ronco/mostradores.ts`, `src/pages/diesel/mostradores.ts` | Levar o que é igual (conta-giros, anel do ciclo, onda) para um arquivo comum em `src/pages/comum/` e deixar no Diesel só o p–θ e as leituras dele; comparar as capturas de antes e depois das duas páginas |
| I7 | Túnel desenhado mais estreito que a posição do ouvinte | `src/pages/passagem/cena3d.ts`, linhas 219–221 | O tubo é um quadrado de lado √área centrado na via (parede a 4 m do eixo) e o ouvinte dos presets fica a 4,7 m do eixo. Decidir com quem cuida da Cena (`Tunel` em `src/scene/tipos.ts`) a largura e a posição da via no túnel, e desenhar com isso; não mexer na `lateral` dos presets, que muda o som |
| I8 | Locomotiva a vapor, trator e barco sem silhueta própria | `src/pages/passagem/cena3d.ts` | Desenhar como já foi feito para avião e carro (caixas com medidas tiradas do comprimento do corpo) |
| I9 | Vapor sem onda nem espectro (V6) | `src/pages/vapor/PaginaVapor.tsx`, `src/pages/vapor/mostradores.ts` | Instrumento novo: precisa do aval do dono. Se entrar, usar o `.scope-wrap` e o desenho de onda das outras páginas |
| I10 | `docs/TECNICO.md` desatualizado | `docs/TECNICO.md`, "Estrutura do projeto" (linha 25) | Listar `src/ui/paginas.ts`, `src/ui/formato.ts`, `Faixa` em `src/ui/PresetNav.tsx`, `public/favicon.svg`, `tools/capturas.mjs`, `docs/ui/` e este documento |

### DSP, dados e testes

| # | O quê | Onde | O que fazer |
|---|---|---|---|
| F1 | Pressão dos Rotativos 100 vezes maior | `src/engines/rotativo/dsp.ts`, linhas 556–557 | `Math.round(x / 100) / 10` dá kPa e o comentário diz bar; para bar é `Math.round(x / 1e4) / 10`. Conferir depois o eixo do p–α e "Pico na câmara" em `src/pages/rotativo/mostradores.ts` |
| F2 | Pedal do Diesel sem função no gerador e na locomotiva | `src/engines/diesel/dsp.ts`, `alvoIsocrono()` (linha 959) | Decidir se o pedal age (como carga, por exemplo) ou fica escondido como está agora |
| F3 | Estacionárias a vapor sem telemetria do motor | `src/carriers/gerador.ts` | Repassar a telemetria do motor como os outros portadores; a página já preenche as leituras quando ela chega |
| F4 | Nome das linhas do Elétrico vem pronto do motor | `src/engines/eletrico/constantes.ts` (`NOME_MEC`), `src/pages/eletrico/mostradores.ts` (`NOME_LINHA`, linha 25) | Deixar o nome por extenso num lugar só: ou o motor manda o nome final, ou manda só o id e a tabela da página é a única |
| F5 | Trem-bala com motor num preset e sem motor em dois | `src/pages/passagem/presets.ts`, linhas 139–140 | Decidir se "a céu aberto" e "no viaduto" ganham `motor: 'eletrico', motorPreset: 'n700'` (muda o som) |
| F6 | `.gitignore` com duas entradas coladas | `.gitignore`, linha 3 | Trocar `.claudereferencias/` por duas linhas: `.claude/` e `referencias/` |
| F7 | `navegador:ronco` e `navegador:turbina` saem com "uso: …" | `package.json`, linhas 16–17; `tools/ronco-navegador.mjs`, `tools/turbina-testa-navegador.mjs` | Servirem o `dist/` sozinhos quando não vier URL, como os outros seis |
| F8 | Testes de navegador com espera fixa falham com a máquina carregada | `tools/ronco-navegador.mjs`, `tools/radial-navegador.mjs`, `tools/diesel-navegador.mjs`, `tools/passagem-navegador.mjs` | Trocar cada espera fixa por esperar a condição até um limite (o que os outros trechos dos mesmos arquivos já fazem); a verificação fica a mesma |
