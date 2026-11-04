# Ronco, Turbina, Diesel e Radial

Simuladores de som de motor que rodam direto no navegador. O site começa num menu com os tipos de motor: https://ezenere.com/data/engine/

- **Ronco**, motores de carro e moto: https://ezenere.com/data/engine/ronco.html
- **Turbina**, motores de avião: https://ezenere.com/data/engine/turbina.html
- **Diesel**, picapes, caminhões, geradores e locomotivas: https://ezenere.com/data/engine/diesel.html
- **Radial**, motores em estrela de avião (Corsair, P-47, DC-3, T-6, Yak-52, R-4360), helicóptero S-55, Sherman, Monaco-Trossi e Megola: https://ezenere.com/data/engine/radial.html
- **Passagem**, qualquer coisa passando por você (trem-bala, carro na rua, picape diesel, locomotiva, turboélice, jato, helicóptero R44, Corsair, Yak-52, Sherman) com o ouvinte livre em 3D: https://ezenere.com/data/engine/passagem.html
- **Em construção:** rotativos (Wankel), vapor e elétrico.

![Ronco com uma Ferrari 458 no corte de giro](docs/ronco.png)

Nenhum som aqui é gravação. Tudo é criado na hora pelo computador, a partir de como o motor funciona de verdade: as explosões dentro dos cilindros, o ar passando pelo escapamento, as pás girando na turbina. Por isso o som muda sozinho quando você muda qualquer peça.

## Ronco (carros e motos)

Escolha um carro na lista de cima. Tem muscle car americano, Ferrari, Porsche, japoneses, clássicos brasileiros como Opala e Fusca, carros de corrida e motos. Depois é só ligar e acelerar.

Dá para mexer em quase tudo:

- quantos cilindros o motor tem e como eles são arrumados (em linha, em V, boxer);
- a ordem em que os cilindros explodem;
- onde fica o motor (na frente, no meio ou atrás) e se ele é refrigerado a água ou a ar (como o Fusca e o 911 antigo);
- o escapamento: coletor (inclusive as caixas de calefação do Fusca), vedação (escape antigo que vaza perto do motor), abafador, catalisador, escape ativo (silencioso, normal, esportivo, pista), diâmetro do tubo e da ponteira, ressonador;
- os estalos no escape: o que a central faz quando você tira o pé (corta a injeção, carburador, crepitar de fábrica, pop & bang ou antilag de rali). Os estouros só saem com o escape quente, e o catalisador abafa;
- turbo ou compressor;
- o corte de giro: ignição (com estouro), combustível (seco), parcial, borboleta ou sem corte, e o ritmo dele;
- câmbio: número de marchas, manual ou automático (com modos pista, esportivo, normal, econômico e automático), a relação de cada marcha e o tempo de troca;
- temperatura do motor: ele começa frio e o som muda enquanto esquenta;
- 2-step (corte ou controle de largada).

Você também escolhe de onde ouve: ao lado do escape, atrás do carro, dentro da cabine, no cofre do motor ou parado na rua vendo o carro passar. E escolhe o lugar: céu aberto, rua com prédios, túnel, garagem, autódromo ou serra. Isso fica no topo do painel, em "Escuta e ambiente". Ali também dá para escolher o volume do motor (Real, com a marcha lenta bem mais baixa que o giro alto, como num carro de verdade, ou Arcade, com o som parecido em qualquer rotação), desligar o som de fundo do lugar e dosar o chiado de ar.

![Mustang passando pela rua, com o mapa mostrando onde ele está](docs/ronco-rua.png)

**Teclas:** `I` liga · `W` acelera · `S` freia · `E` e `Q` trocam marcha · `C` muda o microfone · `V` alterna entre dentro do carro e na rua · `B` troca o modo do escape ativo (silencioso, normal, esportivo, pista) · `M` muda o modo do câmbio automático (pista, esportivo, normal, econômico, automático).

## Turbina (aviões)

Escolha um avião: Boeing 737, Airbus A320, 747, Concorde, caças como F-16 e F-22, turboélices como ATR e Super Tucano, jatos executivos.

![Boeing 737 em potência de decolagem](docs/turbina.png)

Você dá a partida, que leva uns 15 segundos como num avião de verdade. Depois empurra a manete e ouve o motor de vários lugares:

- em volta do motor, no chão (é só arrastar no mapa);
- dentro do avião, na cabine ou no cockpit;
- vendo o avião passar por cima. Acima da velocidade do som, você ouve o estrondo sônico.

![F-16 passando acima da velocidade do som: o cone de Mach chegou e veio o estrondo](docs/turbina-estrondo.png)

Também dá para pôr pós-combustão em qualquer jato, usar reversor e trocar peças do motor.

**Teclas:** `I` partida · `W` e `S` mexem a manete · `1` a `4` posições da manete · `R` reversor · `C` muda a posição · `V` alterna entre a bordo e no solo.

## Radial (aviões a pistão)

Motores em estrela: o R-2800 do Corsair e do P-47, o R-1830 do DC-3, o R-1820 do T-28, o R-1340 do T-6, o M-14P do Yak-52, o R-4360 de 28 cilindros, Rotec e Verner de ultraleve, o R-975 do tanque Sherman, o Monaco-Trossi, a moto Megola e o helicóptero S-55. A partida é como num avião: no DC-3 você energiza o volante do arranque (o apito sobe) e engata; nos outros o motor gira, você conta as pás e os magnetos ligam. Depois mexe na manete, na mistura, nos magnetos e no passo da hélice. Os motores planos de avião e de helicóptero (Cessna, Piper, Cirrus, Rotax, Robinson R22 e R44, Bell 47, Schweizer) ficam na família Aviação do Ronco.

**Teclas:** `I` partida (energizar, engatar, magnetos) · `W` manete · `M` magnetos · `[` e `]` mistura · `,` e `.` manete de passo · `C` muda o microfone.

## Dicas

- Use fone de ouvido: o som tem esquerda e direita, e com a câmera atrás do carro ele soa fora da cabeça, como se o carro estivesse ali.
- O volume pode ficar alto, principalmente nos caças e no estrondo sônico. Comece baixo.
- Funciona melhor no computador, mas também abre no celular.

## Rodar no seu computador

Precisa do [Node.js](https://nodejs.org/) (versão 22 ou mais nova). Na pasta do projeto:

```sh
npm install
npm run dev
```

e abra o endereço que aparecer (algo como `http://localhost:5173/`). Abrir os arquivos `.html` direto do disco não funciona mais: as páginas são compiladas.

## Desenvolvimento

O projeto usa [Vite](https://vite.dev/), TypeScript e React. O React fica só na interface; o som é gerado num AudioWorklet, fora dele.

- `npm install`: instala as dependências (uma vez).
- `npm run dev`: servidor local com recarga automática.
- `npm run build`: confere os tipos e gera o site estático em `dist/`. É o conteúdo de `dist/` que vai para `ezenere.com/data/engine/`; os caminhos são relativos, então ele funciona em qualquer pasta.
- `npm run preview`: serve o `dist/` gerado, para testar o build antes de publicar.
- `npx tsx tools/render.ts ronco mustang rev saida/`: renderiza um cenário para WAV sem navegador; `npx tsx tools/compare-wav.ts a.wav b.wav` compara dois WAVs amostra a amostra. Detalhes no começo de cada arquivo em `tools/`.

Páginas: `index.html` (menu), `ronco.html`, `turbina.html`, `diesel.html`, `radial.html` e `passagem.html`, com o código em `src/pages/`. A estrutura das pastas está em [`docs/TECNICO.md`](docs/TECNICO.md).

## Quer saber como funciona por dentro?

O documento [Como o Ronco e a Turbina funcionam](docs/TECNICO.md) explica a física e o processamento de som de cada parte: cilindros, escapamento, câmbio, temperatura, turbinas, estrondo sônico, e também como adicionar novos carros e aviões.
