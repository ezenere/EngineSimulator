# Plano da reestruturação (branch `reestruturacao`)

Documento de coordenação. Quem trabalha numa etapa lê isto primeiro. Comentários de código, nomes de interface e documentação em português do Brasil. Nada de gravação: todo som é sintetizado.

## Visão

Três camadas independentes, combinadas por uma tabela de compatibilidade:

| Camada | O que é | Exemplos |
|---|---|---|
| **Motor** (fonte) | O DSP que gera o som do motor a partir da física | pistão a gasolina (Ronco), turbina/turboélice (Turbina), radial, rotativo (Wankel, X-Engine, palhetas), diesel 4T/2T, vapor, elétrico |
| **Portador** (carga) | O que carrega o motor e como o carrega: transmissão, carga, geometria do corpo em movimento | carro com câmbio e estrada, avião com hélice, helicóptero com rotor (Nr fixo, pedal = coletivo), gerador (rpm fixo, degraus de carga), locomotiva diesel-elétrica (8 notches), trem de N vagões, barco |
| **Cena** (ouvinte) | Ambiente, trajetória e posição do ouvinte | ambientes atuais (céu aberto, rua, túnel, garagem, autódromo, serra), **Passagem** universal (Doppler por fonte, reflexão do solo, absorção do ar, onda de pressão de nariz/cauda, vãos entre vagões, efeito pistão em túnel), **modo de testes** com parâmetros livres (comprimento da volta, altitude, distância) e ouvinte num gimbal 3D (azimute, elevação, distância; filtros de localização: escape, admissão, cabine fechada, cofre) com cena 3D simples |

Regra do produto: por enquanto só se ouve cada motor nos portadores onde ele foi usado de verdade (tabela motor × portador). A separação em camadas existe para que, no futuro, qualquer combinação seja só uma linha a mais na tabela.

## Stack (decidido)

- Vite + TypeScript + React. React só na interface; o áudio não passa por ele.
- Site continua estático: `npm run build` gera `dist/` que vai para `ezenere.com/data/engine/`. Caminhos relativos (`base: './'`).
- Páginas (multi-page do Vite): `index.html` = **menu** de tipos de motor; `ronco.html`, `turbina.html` e, nas etapas seguintes, `radial.html`, `rotativo.html`, `diesel.html`, `vapor.html`, `eletrico.html`. *(Hoje todas existem, mais `passagem.html`.)*
- DSP em TypeScript, em módulos ES, compilado pelo Vite num bundle próprio para o AudioWorklet (acaba o truque de `toString()`). O mesmo código roda em Node (via `tsx`) para renderizar WAV offline.
- `tsconfig` pode começar com `strict: false` e tipos frouxos no DSP migrado; o que importa é o som não mudar.
- Pacotes internos (pastas em `src/`): `acoustics/` (RNG, Biquad, tubos, junções, radiador, propagação), `engines/<familia>/` (DSP + presets + geometria), `carriers/`, `scene/`, `ui/` (componentes React compartilhados: slider, chips, campo, seção, navegação de famílias e presets, mostradores), `pages/`.

## Regras de verificação

- **Migração não muda o som.** O DSP tem RNG com semente, então a renderização offline é determinística: a versão migrada tem de produzir WAV **idêntico amostra a amostra** (ou, se alguma reordenação de ponto flutuante for inevitável, erro < −90 dBFS) ao do código legado em `git show master:src/dsp.js` para os cenários `idle`, `rev`, `wot` e `sweep` de pelo menos 6 presets de cada página, e `start`/`takeoff`/`flyby` nos jatos. Ferramentas de referência (harness Node, análise de bandas) estão em `/tmp/claude-1000/-home-ezenere-Documents-Projects-Engine/e31418c8-04d3-4470-8423-a94efb88e841/scratchpad/tools/` (`render.js`, `jetrender.js`, `analyze.py`, `limtest.js`, `idletest.js`); copie o que for útil para `tools/` no repositório, em TypeScript. *(Estado em 18/11/2026: a prova é `npm run paridade:ronco`, `paridade:turbina` e `paridade:acoustics`, e a referência passou do nome `master` para o commit fixo `02c185f`, `REF_LEGADO` em `tools/legado.ts`, porque o legado saiu da árvore de trabalho. A pasta do scratchpad não existe mais: `render.js` e `jetrender.js` viraram `tools/render.ts`; `limtest.js` e `idletest.js` não foram copiados.)*
- **Paridade de interface:** todo controle que existe hoje em `src/app.js` e `src/jet-app.js` continua existindo (lista explícita no relatório da etapa).
- Depois de qualquer mudança em motor, calibração ou lenta: rodar o teste de lenta (68 veículos, 20 °C e −5 °C, zero apagamentos) e o teste de corte de giro. *(Estado em 18/11/2026: cada família tem `npm run lenta:<família>`. Os dois harnesses antigos do Ronco nunca entraram no repositório; a auditoria escreveu `npm run lenta:ronco` no lugar deles: os 68 carros a 20 °C e a −5 °C, corte de giro e troca de carro. `npm run verificar` roda todos. Ver `docs/AUDITORIA.md`.)*
- Som novo (etapas 2 em diante) é validado contra gravações do Wikimedia Commons com tabelas de bandas (dB relativos à banda 150–400 Hz), como em `docs/TECNICO.md` → Validação.

## Etapas

1. **Base** *(feita; ver `TECNICO.md` → Estrutura, Build, Cena e portadores, Página Passagem)* — scaffold Vite/TS/React; `index.html` menu; README; migração do Ronco e da Turbina sem mudar o som; `acoustics/` e `ui/` compartilhados; camada de cena com Passagem universal, modo de testes, gimbal do ouvinte e cena 3D (three.js); camada de portador com carro/câmbio (existente), hélice (migrada da Turbina), rotor, gerador, locomotiva e trem de N vagões. Primeiro caso de validação da Passagem: trem-bala de 10 vagões a 350 km/h num túnel (vãos a 3,9 Hz, onda de pressão, reverberação do túnel), ainda sem motor próprio.
2. **Diesel** — 4T de picape a caminhão, 2T de locomotiva (EMD 710), geradores; ignição por compressão (atraso + queima pré-misturada), injeção, controle por combustível, ciclo de 2 tempos. *Feita: `diesel.html`, `src/engines/diesel/` e o adaptador `MotorDiesel`; três passadas de som; ver `TECNICO.md` → Diesel.*
3. **Radial** — geometria de fileiras ímpares, hélice; aviões, M4 Sherman, Monaco-Trossi, Megola, helicópteros antigos. *Feita: `radial.html` e a família Aviação no Ronco; ver `TECNICO.md` → Radial e aviação a pistão.*
4. **Rotativos** — Wankel (13B, Renesis, 20B, 787B, Ro80, Norton, Mistral), X-Engine e palhetas marcados como aproximação. *Feita: `rotativo.html`; ver `TECNICO.md` → Rotativos.*
5. **Vapor** — DSP novo: sopro do escape por volta de roda, regulador e corte, vazamentos, bomba de ar, bielas, apito; locomotivas, estacionários, Stanley, barco. *Feita: `vapor.html`, `VaporDSP` e os portadores locomotiva a vapor, trator, barco e `CarroDireto`; ver `TECNICO.md` → Vapor.*
6. **Elétrico** — DSP novo: ordens de ranhura e torque, PWM com bandas laterais, redução; carros, metrô, Taurus, trem-bala (ganha o motor), bonde, ferramentas, drones. *Feita: `eletrico.html`, `src/engines/eletrico/` (síntese espectral), `CarroEletrico`, trem com motor por truque, bancada e `Multirrotor`; ver `TECNICO.md` → Elétrico.*

Cada etapa termina com: código, presets, tabela de compatibilidade, testes passando, `docs/TECNICO.md` atualizado (seção por camada e por família) e um relatório curto do que foi medido. Commits na branch `reestruturacao` com mensagens em pt-BR; o usuário decide quando mesclar em `master`.

## Convenções para quem executa

- Não mude o som dos motores existentes fora de uma etapa que peça isso. Se achar um defeito, anote no relatório.
- Arquivos de outra pessoa em paralelo não se tocam: a divisão de pastas por etapa está na tarefa. Precisou de mudança em `acoustics/` ou `ui/` que não é sua? Relate em vez de mudar.
- Presets continuam arquivos de dados simples (TypeScript), um objeto por veículo, fáceis de editar à mão.
- Relatórios: o que foi feito, o que foi medido (números), o que ficou de fora e por quê.

## Recursos 3D

Para a cena 3D (modo de testes e Passagem) podem ser usados modelos, malhas e texturas abertos, com licença CC0 ou equivalente (Poly Haven para texturas e HDRIs; Sketchfab/Blend Swap/Kenney só com CC0 ou CC-BY, com atribuição em `docs/CREDITOS.md`). Regras: guardar em `public/3d/` com um `LICENSES.md` ao lado (fonte, autor, licença, URL); orçamento de ~10 MB por página carregado sob demanda (glTF binário comprimido com Draco/meshopt, texturas de 1k em KTX2 ou JPEG); o que não existir em aberto (um vagão de trem-bala, um helicóptero específico) é feito em geometria simples parametrizada no three.js, com a mesma silhueta e dimensões reais. A cena nunca bloqueia o áudio: se o modelo não carregar, fica a caixa segmentada.

## Rodada de auditoria e som (a partir de 18/11/2026)

Todas as famílias estão na branch. O dono ouviu e o veredito é: **os sons novos estão ruins** (ar, mar, aspirador, pipoco, falta de peso; ver `docs/REVISAO-DE-SOM.md`, casos dos Rotativos, do Radial e as três passadas do Diesel no TECNICO). Esta rodada corrige o som, audita o projeto e arruma o que está incorreto, incompleto ou feio. Modelo dos agentes: Fable só onde o julgamento é difícil (acertar som contra gravação, diagnosticar por que um som está errado); Opus para o resto (fichas, documentação, limpeza, correções de interface a partir de lista pronta, ferramentas, mesclagens). Poucos agentes ao mesmo tempo, e nenhum agente abre subagentes por conta própria.

**Por que as passadas anteriores falharam.** Cada uma acertou números (bandas médias, taxas) e errou o ouvido. O padrão que se repetiu: fontes de **ruído largo contínuo** (chiado de admissão, sopro de turbo, pós-queima, jato da ponteira, fundo mecânico) acabam dominando, e o que é **tonal e impulsivo** (as ordens do motor, o pulso de cada explosão) fica fraco embaixo delas. A calibração de volume esconde isso: sobe tudo junto. Bandas médias não distinguem um chiado liso de um chiado colado ao pulso, nem um espectro de linhas de um espectro de ruído com a mesma energia.

**Prioridade do som (ouvido do dono, 18/11).** Os piores, nesta ordem: (1) **Diesel**: vários motores "soavam como vento", o som "parecia que era apenas ar", e o **turbo** é o pior de tudo ("nojento": apito agudo na primeira passada, som de mar na segunda, presente o tempo todo e alto na lenta). Sobre o turbo, ouvindo o teste do caminhão em 18/11: "quando o turbo sobe, ele faz um som de mar; não precisava disso. É uma exageração no som do turbo, que podia ser só uma coisa mais sutil de turbo". O turbo é um detalhe fino por cima do motor, não uma fonte que enche o som. Nas palavras dele: "os caminhões faziam um som de ar ao invés do *nhe nhe nhe nhe* ou do *rom rom rom rom*". O alvo é esse: o ritmo de cada explosão audível (a batida seca e ritmada da lenta, o *rom rom* grave e encorpado em carga), ou seja, envoltória funda na frequência de queima e no ciclo, ordens graves fortes e a batida da combustão colada a cada pulso; nada de sopro liso por cima; (2) **Rotativos da Mazda** (13B, Renesis, 20B, 787B, Cosmo): mesmo defeito, "apenas ar". Essas duas famílias vêm primeiro, com Fable. O resto (Radial, Vapor, Elétrico, Passagem) o dono ouviu nos testes de navegador e achou bom: nessas, medir com o kit antes de mexer e só tocar no que ficar fora da régua.

**Dois achados gerais do dono (18/11).**

1. **Faltam médios.** "No geral, os motores estão sem médios. Eles têm agudos e grave, mas pecam nos médios." O kit confirma com números: o Mustang aprovado tem 15–22 dB a menos que a gravação entre 400 Hz e 2,5 kHz; no Fusca, acima de 400 Hz há rajada de ruído onde a gravação tem linhas; o Diesel tem 19 dB a menos em 1–2,5 kHz; o 787B, 10–17 dB a menos em 400 Hz–2,5 kHz. O que falta é conteúdo **tonal** de médios (ordens altas da queima, corpo), não mais ruído.
2. **"Papel rasgando".** No Ronco, com "Diâmetro do escape" e "Ponteira (saída)" no mínimo, o som de ar toma conta: "parecia que tava rasgando papel… é um som feio". O ruído de jato da ponteira cresce com 1/área² (+24 dB com a ponteira em 1,25") e engole o motor.

Divisão do trabalho: o mecanismo de médios e o limite do jato no **motor-base** (o caminho da gasolina e o que é compartilhado em `src/engines/ronco/dsp.ts`) têm um autor só, o agente "base". Os agentes de família medem a falta de médios, corrigem dentro do seu ramo o que é próprio da família (a batida do diesel, a janela de escape do rotativo) e depois herdam o mecanismo-base numa passada curta. Ninguém conserta médios com equalização: é mecanismo, não ganho.

**Viés do simulador: mais motor, menos ar (decisão do dono, 18/11).** "Ele exagera um pouco no som da admissão e no ruído branco audível. No real é mais assim mesmo, mas pro simulador ele tem que soar mais motor e menos som de ar do motor." Isto vale acima da fidelidade à gravação: quando a gravação casada tem chiado de admissão e ruído largo, o simulado fica **abaixo** dela nesses componentes, nunca acima. Na prática: (a) o HNR do simulado é igual ou maior que o da gravação em toda banda até 6 kHz; (b) chiado de admissão, sopro de turbo, jato da ponteira e fundo mecânico entram como tempero, modulados pelo evento, e nenhum deles pode ser a fonte dominante em banda nenhuma na lenta nem em carga parcial; (c) o padrão dos controles dessas fontes fica no lado baixo, e quem quiser mais ar sobe no painel; (d) o que carrega o som são as ordens do motor e o pulso de cada explosão.

**Regras desta rodada (valem para todo agente de som):**

1. **Referências persistentes.** As gravações ficam em `referencias/` na raiz do repositório (fora do git: está no `.gitignore`), com `referencias/INDEX.md`. Nada em `/tmp` (o sistema apaga). São uso privado como alvo de análise; nunca entram no site nem no git.
2. **Kit "ouvido"** em `tools/ouvido/` (Python: numpy, scipy, matplotlib). Compara dois WAVs em condição casada (mesma rotação/carga/posição) e entrega: painel PNG lado a lado (espectrograma log-mel, zoom de 0,5 s, espectro fino com as ordens marcadas), razão harmônico/ruído (HNR) por banda, espectro de modulação, envoltória (p90/p10, crista, vão), planura espectral entre as linhas, e uma distância por componente. **Todo agente de som olha os painéis** (lê o PNG) antes e depois de mexer; o painel entra no relatório.
3. **O alvo é a gravação casada, não a tabela.** Para cada preset revisado: pelo menos duas condições (lenta e carga, ou duas rotações), cada uma contra um trecho de gravação com a rotação confirmada. Acima de 6 kHz vale a física, não a gravação comprimida.
4. **Orçamento de ruído.** Em cada condição, medir a fração da energia (ponderada A e por banda) que vem de fontes estocásticas contra a determinística, isolando fonte por fonte com a mesma semente. Se o HNR do simulado fica abaixo do da gravação numa banda, existe uma fonte de ruído sobrando ou uma fonte tonal faltando: achar qual. Ruído só entra modulado pelo evento físico que o gera.
5. **Régua do que é "bom".** Os carros do Ronco que o dono revisou de ouvido (Fusca, Mustang, F1, Hellcat) definem a distância aceitável: o kit mede a distância deles às suas gravações e as famílias novas têm de chegar à mesma faixa.
6. **Mecanismo físico, não ganho** (princípios do `REVISAO-DE-SOM.md`): cada correção nomeia a peça ou o fenômeno. Atenuar é atenuar. Todo campo de preset tem controle no painel.
7. **Portões intactos:** `paridade:ronco`, `paridade:turbina`, `paridade:acoustics` idênticos; `teste:*` e `lenta:*` da família sem falhas (alvos e desvios atualizados com justificativa); `typecheck`, `build`, `navegador:*`.
8. **Quem decide é o ouvido do dono.** O relatório de cada agente termina com "o que ouvir": preset, condição, o que deve ter mudado.

### Depois das auditorias (22/11/2026)

As duas auditorias estão mescladas: `docs/AUDITORIA-UI.md` (87 defeitos, 86 corrigidos) e `docs/AUDITORIA.md` (296 achados; a tabela "Pendências, por prioridade" tem os blocos A a F com arquivo e o que fazer). O portão único é `npm run verificar` (`verificar:rapido` para o dia a dia).

**Decisões do coordenador sobre a lista "o que o dono precisa decidir"** (reversíveis; o dono pode mudar qualquer uma):

1. Desvios com teto: **sim**. As listas `DESVIOS` viram um retrato do valor aceito com folga (piorou além da folga, falha; voltou a passar, avisa).
2. Sementes: **mediana de 3** nas medidas de contagem, transiente e CV.
3. CPU e coleta de lixo saem dos `teste:*` para `cpu:*`.
4. Referência das locomotivas diesel: refazer a partir do acervo novo (`referencias/diesel/`), depois que a passada de som do Diesel entrar.
5. Sherman, RX-7 FD e Metropolis: vale a ficha real; o alvo do teste é corrigido junto.
6. Valores "≈": ficam marcados como aproximação, sem inventar número.
7. A alocação no laço de áudio, a unificação das quatro páginas a pistão e a FFT única das ferramentas ficam para depois da etapa de som (mexem nos mesmos arquivos).

**Quem faz o quê** (um dono por pasta, para as mesclagens não conflitarem):

| Agente | Modelo | Território | Itens |
|---|---|---|---|
| Diesel | Fable | `src/engines/diesel/**`, ramos `cc` do `dsp.ts`, `tools/diesel-*` | som (B1), C6; depois, bloco A do Diesel com Opus |
| Rotativos | Fable | `src/engines/rotativo/**`, ramos `rot`, `tools/rotativo-*` | som (B3), C7, D2; depois, A3 com Opus |
| Base | Fable | caminho da gasolina e compartilhado de `src/engines/ronco/**` | médios, jato da ponteira; depois, C1 a C4 com Opus |
| Passagem e portadores | Opus | `src/scene/**`, `src/carriers/**`, `src/pages/passagem/**`, `src/engines/turbina/**`, `tools/cena/**` | B7 a B11, C5, C11, E1 a E3, F3, bloco A da Cena |
| Radial, Vapor e Elétrico | Opus | presets e `tools/` dessas três famílias, `avas.ts` | bloco A dessas famílias, A4, A5, A9, C8 a C10, D1, D3, estouro do AVAS, E4 |
| Interface e documentação | Opus | `src/pages/**` (fora da Passagem), `src/ui/**`, `tools/*-navegador.mjs`, `docs/` | pendências I1 a I10 da auditoria visual, E5, E6, F4, F6, onda e espectro no Vapor |

O retoque de som do Radial, do Vapor e do Elétrico (B4, B5, o grave do B6) vem depois, medido com o kit, quando os testes dessas famílias já tiverem teto.

### Estado depois da passada de som (22/11/2026, `de664f3`)

Todas as famílias tiveram a passada de som medida com o kit e estão mescladas na `reestruturacao`: Rotativos (duas passadas), motor-base (médios e jato da ponteira), Diesel, Radial, Vapor e Elétrico; mais os testes com teto (Radial, Vapor, Elétrico, Rotativos, Cena), as fichas (C1 a C6, C8 a C11, D1 a D3), a Passagem e os portadores, e a interface. O relatório de cada uma está no `TECNICO.md` (seção da família) e o caso no `REVISAO-DE-SOM.md`.

**Falta o ouvido do dono em tudo isso.** Nenhuma segunda passada de som começa antes do veredito dele sobre a primeira: a régua do kit diz o que mudou, não o que agrada.

**O que cada passada deixou aberto** (medido, com o motivo no relatório da família):

- **Diesel:** grave de lenta 4 a 20 dB alto em 60–150 Hz; médios da cabine baixos sob carga; agudo das locomotivas em N8 ainda liso; gerador e locomotiva da página sem ventilador nem alternador (B2); `ENGRENAGENS.nivel` sem controle; os testes ainda sem teto (A1, A2, A6, A7, A8).
- **Rotativos:** 787B a 7 700 rpm em ponto morto; filtro da cabine; Ro 80 (C7); palhetas e X-Engine sem medida.
- **Motor-base (Ronco):** 400 Hz–1 kHz quase não mudou; Mustang frio; abafador original acima de 2,5 kHz (`src/acoustics/guias.ts`); a Aviação a pistão (`av`) tem o mesmo defeito de estalos que o Radial tinha (O-200: 19,6 por segundo contra 4,3).
- **Radial:** Verners com 7 estalos por segundo; ruído de hélice liso na decolagem do T-6 (falta o choque da ponta e o termo de campo próximo).
- **Vapor:** a rede de escape perde 40 % da vazão (`AMORT_ESCAPE`; mexer pede rever o bico das 14 fichas); patinagem com regulador cheio; ataque do chuff curto.
- **Elétrico:** furadeira escura acima de 6 kHz; piso largo do ar-condicionado 3,5 a 7 dB alto na CPTM parada; Tesla de dentro com 13 dB a mais que a gravação em 2,5–6 kHz (lado pedido; o ouvido decide).
- **Cena:** a reflexão do chão por fonte-imagem tira 6 dB de 400 Hz–1 kHz a 4 m (vale em ~460 Hz) e 3 a 4 dB de 400 Hz–6 kHz a 7,5 m em chão duro: candidato ao "sem médios" na Passagem, não medido contra gravação. O N700 de 10 vagões está no teto de 64 fontes.
- **Kit:** o `ar` compara frações do leito, não nível absoluto; o total simétrico pune a simulação mais limpa; o `f0` pode parar num múltiplo.

**Feito depois (Opus, sem mexer no timbre; `c9bf0a4`, `5b6e750` e o merge do motor-base):** o comum das quatro páginas a pistão em `src/pages/comum/` (F1), com os esquecimentos entre as páginas fechados, e o estado que passa de uma configuração para a outra no motor-base (`guardarTroca`/`passarTroca` em `src/engines/ronco/dsp.ts`; portões `troca:ronco|diesel|radial|rotativo`). Fica aberto: as trocas que mudam a geometria das câmaras (cilindrada, taxa, ordem de ignição) ainda recomeçam o motor, e a hélice recomeça de fase se mudar de pás, diâmetro ou rotação.
