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
- Páginas (multi-page do Vite): `index.html` = **menu** de tipos de motor; `ronco.html`, `turbina.html` e, nas etapas seguintes, `radial.html`, `rotativo.html`, `diesel.html`, `vapor.html`, `eletrico.html`.
- DSP em TypeScript, em módulos ES, compilado pelo Vite num bundle próprio para o AudioWorklet (acaba o truque de `toString()`). O mesmo código roda em Node (via `tsx`) para renderizar WAV offline.
- `tsconfig` pode começar com `strict: false` e tipos frouxos no DSP migrado; o que importa é o som não mudar.
- Pacotes internos (pastas em `src/`): `acoustics/` (RNG, Biquad, tubos, junções, radiador, propagação), `engines/<familia>/` (DSP + presets + geometria), `carriers/`, `scene/`, `ui/` (componentes React compartilhados: slider, chips, campo, seção, navegação de famílias e presets, mostradores), `pages/`.

## Regras de verificação

- **Migração não muda o som.** O DSP tem RNG com semente, então a renderização offline é determinística: a versão migrada tem de produzir WAV **idêntico amostra a amostra** (ou, se alguma reordenação de ponto flutuante for inevitável, erro < −90 dBFS) ao do código legado em `git show master:src/dsp.js` para os cenários `idle`, `rev`, `wot` e `sweep` de pelo menos 6 presets de cada página, e `start`/`takeoff`/`flyby` nos jatos. Ferramentas de referência (harness Node, análise de bandas) estão em `/tmp/claude-1000/-home-ezenere-Documents-Projects-Engine/e31418c8-04d3-4470-8423-a94efb88e841/scratchpad/tools/` (`render.js`, `jetrender.js`, `analyze.py`, `limtest.js`, `idletest.js`); copie o que for útil para `tools/` no repositório, em TypeScript.
- **Paridade de interface:** todo controle que existe hoje em `src/app.js` e `src/jet-app.js` continua existindo (lista explícita no relatório da etapa).
- Depois de qualquer mudança em motor, calibração ou lenta: rodar o teste de lenta (68 veículos, 20 °C e −5 °C, zero apagamentos) e o teste de corte de giro.
- Som novo (etapas 2 em diante) é validado contra gravações do Wikimedia Commons com tabelas de bandas (dB relativos à banda 150–400 Hz), como em `docs/TECNICO.md` → Validação.

## Etapas

1. **Base** — scaffold Vite/TS/React; `index.html` menu; README; migração do Ronco e da Turbina sem mudar o som; `acoustics/` e `ui/` compartilhados; camada de cena com Passagem universal, modo de testes, gimbal do ouvinte e cena 3D (three.js); camada de portador com carro/câmbio (existente), hélice (migrada da Turbina), rotor, gerador, locomotiva e trem de N vagões. Primeiro caso de validação da Passagem: trem-bala de 10 vagões a 350 km/h num túnel (vãos a 3,9 Hz, onda de pressão, reverberação do túnel), ainda sem motor próprio.
2. **Diesel** — 4T de picape a caminhão, 2T de locomotiva (EMD 710), geradores; ignição por compressão (atraso + queima pré-misturada), injeção, controle por combustível, ciclo de 2 tempos.
3. **Radial** — geometria de fileiras ímpares, hélice; aviões, M4 Sherman, Monaco-Trossi, Megola, helicópteros antigos. *Feita: `radial.html` e a família Aviação no Ronco; ver `TECNICO.md` → Radial e aviação a pistão.*
4. **Rotativos** — Wankel (13B, Renesis, 20B, 787B, Ro80, Norton, Mistral), X-Engine e palhetas marcados como aproximação.
5. **Vapor** — DSP novo: sopro do escape por volta de roda, regulador e corte, vazamentos, bomba de ar, bielas, apito; locomotivas, estacionários, Stanley, barco.
6. **Elétrico** — DSP novo: ordens de ranhura e torque, PWM com bandas laterais, redução; carros, metrô, Taurus, trem-bala (ganha o motor), bonde, ferramentas, drones.

Cada etapa termina com: código, presets, tabela de compatibilidade, testes passando, `docs/TECNICO.md` atualizado (seção por camada e por família) e um relatório curto do que foi medido. Commits na branch `reestruturacao` com mensagens em pt-BR; o usuário decide quando mesclar em `master`.

## Convenções para quem executa

- Não mude o som dos motores existentes fora de uma etapa que peça isso. Se achar um defeito, anote no relatório.
- Arquivos de outra pessoa em paralelo não se tocam: a divisão de pastas por etapa está na tarefa. Precisou de mudança em `acoustics/` ou `ui/` que não é sua? Relate em vez de mudar.
- Presets continuam arquivos de dados simples (TypeScript), um objeto por veículo, fáceis de editar à mão.
- Relatórios: o que foi feito, o que foi medido (números), o que ficou de fora e por quê.

## Recursos 3D

Para a cena 3D (modo de testes e Passagem) podem ser usados modelos, malhas e texturas abertos, com licença CC0 ou equivalente (Poly Haven para texturas e HDRIs; Sketchfab/Blend Swap/Kenney só com CC0 ou CC-BY, com atribuição em `docs/CREDITOS.md`). Regras: guardar em `public/3d/` com um `LICENSES.md` ao lado (fonte, autor, licença, URL); orçamento de ~10 MB por página carregado sob demanda (glTF binário comprimido com Draco/meshopt, texturas de 1k em KTX2 ou JPEG); o que não existir em aberto (um vagão de trem-bala, um helicóptero específico) é feito em geometria simples parametrizada no three.js, com a mesma silhueta e dimensões reais. A cena nunca bloqueia o áudio: se o modelo não carregar, fica a caixa segmentada.
