# Ronco, Turbina, Diesel, Radial, Rotativos, Elétrico e Vapor

Simuladores de som de motor que rodam direto no navegador. O site começa num menu com os tipos de motor: https://ezenere.com/data/engine/

- **Ronco**, motores de carro e moto: https://ezenere.com/data/engine/ronco.html
- **Turbina**, motores de avião: https://ezenere.com/data/engine/turbina.html
- **Diesel**, picapes, caminhões, geradores e locomotivas: https://ezenere.com/data/engine/diesel.html
- **Radial**, motores em estrela de avião (Corsair, P-47, DC-3, T-6, Yak-52, R-4360), helicóptero S-55, Sherman, Monaco-Trossi e Megola: https://ezenere.com/data/engine/radial.html
- **Rotativos**, Wankel (RX-7, RX-8, Cosmo 20B, 787B de Le Mans, NSU Ro80, Norton, motores de avião e de drone), o X-Engine e o motor de palhetas: https://ezenere.com/data/engine/rotativo.html
- **Vapor**, locomotivas (K4s, A4 Mallard, D51, UP 844, Big Boy, Y6b, Shay, Maria Fumaça, pannier, King), máquina de moinho Corliss, trator Aveling, Stanley Steamer e vapor de rodas de pás: https://ezenere.com/data/engine/vapor.html
- **Elétrico**, carros elétricos, metrôs e trens (o do-re-mi do Taurus), trem-bala, bonde, trólebus, ferramentas e drone: https://ezenere.com/data/engine/eletrico.html
- **Passagem**, qualquer coisa passando por você (trem-bala, carro na rua, picape diesel, locomotiva, turboélice, jato, helicóptero R44, Corsair, Yak-52, Sherman) com o ouvinte livre em 3D: https://ezenere.com/data/engine/passagem.html

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

A manete de potência é a mesma da Turbina: fica onde você a deixa (arraste com o mouse ou use as teclas), com as posições de lenta, cruzeiro, subida e decolagem. No Sherman, no Monaco-Trossi e na Megola é o pedal, com câmbio. Na família Aviação do Ronco a manete também substitui o pedal.

**Teclas:** `I` partida (energizar, engatar, magnetos) · `W` e `S` mexem a manete · `1` a `4` posições da manete · `M` magnetos · `[` e `]` mistura · `,` e `.` manete de passo · `C` muda o microfone · no tanque, `W` acelera e `Q`/`E` trocam marcha.

## Rotativos (Wankel, X-Engine e palhetas)

O motor Wankel não tem pistão nem válvula: um rotor triangular gira dentro de uma carcaça em forma de 8 e forma três câmaras que queimam uma vez a cada três voltas do eixo. As janelas na carcaça abrem de uma vez quando a ponta do rotor passa por elas, e é isso, mais o combustível que ainda queima no escape, que faz o "brap-brap" do rotativo. Tem os Mazda de rua (RX-7 FD biturbo sequencial, RX-7 FC, RX-3, RX-8 Renesis), o Cosmo de 3 rotores, o 787B de 4 rotores que ganhou Le Mans (lenta caçando e estalando), o NSU Ro80, a moto Norton, o Cosmo 110S, motores de avião (Mistral, MidWest) e de drone (Austro AE50R no helicóptero Camcopter, UEL AR741 no RQ-7 Shadow), o X-Engine da LiquidPiston (aproximação) e o motor de ar comprimido de palhetas de uma retífica ou do arranque a ar de um diesel (aproximação). No painel dá para trocar o número de rotores, o tamanho da câmara, as janelas (lateral, bridge, periférica), as velas, tirar o pré-silencioso e ligar ou desligar o turbo sequencial.

**Teclas:** `I` liga · `W` acelera (nas palhetas, o gatilho) · `Q` e `E` câmbio · `S` freio · `C` muda o microfone · `B` válvula do escape · `M` magnetos (aviação) · `[` e `]` carga da ferramenta (palhetas).

## Vapor (locomotivas e outras máquinas)

Locomotivas, uma máquina de moinho Corliss, um trator a vapor, o carro Stanley e um vapor de rodas de pás. Não há partida: a caldeira já começa quente e com pressão. Você abre o regulador, escolhe o corte no reverser e a máquina sai andando com o trem atrás; cada "chuff" é o vapor de um cilindro saindo pela chaminé, então eles aceleram com a roda e mudam com o corte. Parada, a locomotiva continua viva: bomba de ar, injetor, válvula de segurança quando a pressão passa do ajuste, sino e apito. No trilho molhado, abrir demais faz as rodas patinarem (a areia resolve). Os cenários (arrancada, cruzeiro, subida da Lickey, passagem) programam os comandos sozinhos.

**Teclas:** `W` e `S` regulador · `X` fecha o regulador · `A` e `D` reverser · `H` apito (segure) · `B` sino · `E` areia (segure) · `T` torneiras dos cilindros · `Espaço` freio · `I` injetor.

## Elétrico (motores elétricos)

Carros (Tesla Model 3, Nissan Leaf, BYD Dolphin, Fórmula E), trens e metrôs (o Siemens Taurus que sobe a escala "do-re-mi" ao partir, Vectron, CPTM 9500 e 9000, Metrô de São Paulo, Shinkansen N700, TGV), bonde e trólebus, furadeira e liquidificador, o drone DJI Mavic e um motor industrial de 11 kW. O som sai das forças magnéticas na carcaça, do inversor (a portadora e as bandas laterais, as "marchas" do modo síncrono), da redução, dos ventiladores, das escovas e das hélices; nos carros, pneus e vento entram junto. Você acelera, regenera, troca o modo de modulação, liga o som de aviso (AVAS), põe carga, trava a velocidade num dinamômetro e escolhe onde ouvir (fora, na cabine, junto ao motor ou livre). O espectro mostra cada linha com o nome dela.

**Teclas:** `Espaço` liga e desliga · `↑` e `↓` acelerador · `R` regeneração (segure) · `M` modo de modulação.

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

Páginas: `index.html` (menu), `ronco.html`, `turbina.html`, `diesel.html`, `radial.html`, `rotativo.html`, `vapor.html`, `eletrico.html` e `passagem.html`, com o código em `src/pages/`. A estrutura das pastas está em [`docs/TECNICO.md`](docs/TECNICO.md).

## Quer saber como funciona por dentro?

O documento [Como o Ronco e a Turbina funcionam](docs/TECNICO.md) explica a física e o processamento de som de cada parte: cilindros, escapamento, câmbio, temperatura, turbinas, estrondo sônico, e também como adicionar novos carros e aviões.
