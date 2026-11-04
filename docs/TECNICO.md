# Como o Ronco e a Turbina funcionam

Este documento explica a física e o processamento de áudio por trás dos dois simuladores. É para quem quer entender por que cada som sai do jeito que sai, ou mexer no código. Nada aqui é gravação nem amostra: todo o som é sintetizado amostra a amostra, a 48 kHz, a partir de modelos físicos simplificados.

- [Estrutura do projeto](#estrutura-do-projeto)
- [Build: Vite, TypeScript e React](#build-vite-typescript-e-react)
- [Caminho do áudio no navegador](#caminho-do-áudio-no-navegador)
- [Ronco: motor de pistão](#ronco-motor-de-pistão)
- [Turbina: motor a jato](#turbina-motor-a-jato)
- [Diesel: ignição por compressão](#diesel-ignição-por-compressão)
- [Validação](#validação)
- [Limitações conhecidas](#limitações-conhecidas)
- [Como adicionar um carro ou avião](#como-adicionar-um-carro-ou-avião)

Para revisar o som de um veículo contra uma gravação real, siga o método de [`REVISAO-DE-SOM.md`](REVISAO-DE-SOM.md) (ferramentas em `tools/analise-som/`).

---

## Estrutura do projeto

O site é compilado com Vite (TypeScript + React) e publicado como páginas estáticas. Durante a reestruturação (branch `reestruturacao`) o código legado continua no lugar e é a referência do som; as páginas novas vão recebendo o que for migrado.

| Arquivo ou pasta | O que faz |
|---|---|
| `index.html`, `src/pages/menu/` | Menu de tipos de motor (porta de entrada do site) |
| `ronco.html`, `src/pages/ronco/` | Página do Ronco em React: `PaginaRonco.tsx` (barra, presets, instrumentos, câmbio), `Painel.tsx` (todas as seções de controles), `controle.ts` (estado e ações, com as mesmas mensagens ao DSP de `app.js`), `mostradores.ts` (conta-giros, ciclo de ignição, onda e espectro, vista da via, desenhados no `requestAnimationFrame`, fora do React), `teclado.ts` |
| `src/engines/ronco/` | O motor a pistão em TypeScript: `dsp.ts` (`EngineDSP`, ex-`src/dsp.js`), `geometria.ts` (ex-`src/geometry.js`), `presets.ts` (os 68 carros e motos, tipo `PresetRonco`, ex-`src/presets.js`), `constantes.ts` (`T_MAN`, `T_BACK`, `T_WALL`, `T_EXREF`, `SCREW_H`, `ENV_LOOP`) e `config.ts` (configuração mandada ao DSP, com a sonda de calibração) |
| `turbina.html`, `src/pages/turbina/` | Página da Turbina, migrada de `jato.html` + `jet-app.js`: `controle.ts` (estado e mensagens para o DSP, fora do React), `Painel.tsx` (controles), `Turbina.tsx` (barra, presets, manete, instrumentos, laço de desenho), `desenho.ts` (EICAS, fan, osciloscópio, mapa e leituras em canvas) |
| `src/engines/turbina/` | DSP da Turbina em TypeScript: `dsp.ts` (`JetDSP`), `presets.ts` (os aviões, tipo `PresetTurbina`), `constantes.ts` (tabela de seno, diretividade, volta da passagem); o worklet é `src/worklet/processador-turbina.ts` (`turbina-engine`) |
| `tools/turbina-paridade.ts`, `tools/turbina-testa-navegador.mjs` | Prova de som idêntico ao legado (todos os aviões) e teste da página no Chromium e no Firefox headless |
| `src/pages/comum/` | Casca comum das páginas durante a migração |
| `src/ui/` | Componentes React compartilhados (`Slider`, `ChipGroup`, `Field`, `Section`, `FamilyNav`, `PresetNav`, `Barra`) e os estilos (`estilo.css`, ex-`style.css`; `turbina.css`, ex-`jet.css`) |
| `src/ui/audio/` | `AudioShell` (contexto React) e `CadeiaDeAudio`: AudioContext, carga do worklet e a cadeia compressor → EQ → seco/molhado → ambiente → analisador; ambientes e respostas ao impulso; perfis de Ronco e Turbina |
| `src/acoustics/` | Blocos de acústica compartilhados: `RNG`, `Biquad`/`BiquadComPiso`, guias de onda (`Line`, `Junction`, `TwoPort`, `Radiator`, `Cutout`, `ClosedEnd`), escoamento compressível, constantes físicas |
| `src/worklet/` | Pipeline do AudioWorklet: `registrar.ts` (envolve um DSP num `AudioWorkletProcessor`), `tipos.ts` (contrato do DSP), `processador-*.ts` (pontos de entrada) e o DSP de prova `tom.ts` |
| `tools/ronco-paridade.ts`, `tools/ronco-navegador.mjs` | Prova de que o Ronco migrado soa igual ao legado (dados, WAV e bundle do worklet) e teste da página no Chromium e no Firefox headless |
| `tools/render.ts`, `tools/compare-wav.ts`, `tools/acoustics-paridade.ts` | Renderização offline para WAV, comparação amostra a amostra e conferência bit a bit do `acoustics/` contra o legado |
| `tools/analise-som/` | Banco de testes em Node e análise em Python para comparar o som com gravações reais (ver `docs/REVISAO-DE-SOM.md`) |
| **Legado** (até a migração): | |
| `src/geometry.js` | Geometria do motor: virabrequins, ordem de ignição, intervalos, balanceamento (migrado para `src/engines/ronco/geometria.ts`) |
| `src/presets.js` | Os carros e motos (migrado para `src/engines/ronco/presets.ts`) |
| `src/dsp.js` | Toda a síntese do Ronco: termodinâmica, escapamento, câmbio, temperatura, ouvinte (migrado para `src/engines/ronco/dsp.ts`) |
| `src/app.js`, `style.css` | Interface do Ronco: painel, mostradores, teclado, acústica do ambiente (a página `index.html` que a carregava virou o menu; migrado para `src/pages/ronco/`) |
| `jato.html`, `jet.css` | Página da Turbina legada (abre no `npm run dev`, mas não entra no `dist/`; já migrada, fica como referência até o fim da etapa) |
| `src/jet-presets.js` | Os aviões (migrados para `src/engines/turbina/presets.ts`) |
| `src/jet-dsp.js` | Toda a síntese da Turbina (migrada para `src/engines/turbina/dsp.ts`) |
| `src/jet-app.js` | Interface da Turbina (migrada para `src/pages/turbina/`) |

Os arquivos `*-dsp.js` legados ficam dentro de uma função-fábrica (`EngineDSPFactory`, `JetDSPFactory`) para poderem ser convertidos em texto com `toString()` e injetados num AudioWorklet. A mesma classe roda no Node, o que permite testar o som sem navegador. No código novo o truque acaba: o DSP é um módulo TypeScript comum, compilado num bundle próprio para o worklet (abaixo).

## Build: Vite, TypeScript e React

- `npm run dev` serve o projeto com recarga automática; `npm run build` confere os tipos (`tsc` com `tsconfig.json`, código do navegador, e `tsconfig.node.json`, ferramentas e DSP, sem tipos do DOM) e gera `dist/`; `npm run preview` serve o `dist/`.
- **Multi-página:** as entradas estão em `vite.config.mts` (`build.rolldownOptions.input`: `index.html`, `ronco.html`, `turbina.html`). Uma página nova (`radial.html`…) é um HTML na raiz com `<script type="module" src="./src/pages/<nome>/main.tsx">` e uma linha a mais nessa lista.
- **`base: './'`:** todos os caminhos do `dist/` são relativos, então o site funciona em `ezenere.com/data/engine/` (ou qualquer subpasta) sem reconfigurar. Foi testado servindo o `dist/` em `/data/engine/`. Abrir o HTML pelo `file://` não funciona (módulos ES exigem http).
- **Por que não `"type": "module"` no `package.json`:** as ferramentas antigas em `tools/analise-som/` e os arquivos legados de `src/` são CommonJS (`require`, `module.exports`) e deixariam de carregar. A configuração do Vite é `.mts` para ser ESM mesmo assim. O `tsx` roda os `.ts` de `tools/` como CommonJS; eles usam `createRequire(import.meta.url)` e `import.meta.url`, que funcionam nos dois modos.
- **TypeScript:** `strict: false`, e os campos das classes copiadas do legado são declarados com `declare` (não geram código; a classe compilada fica igual à original). TypeScript 7, React 19, Vite 8 (Rolldown).

### AudioWorklet em TypeScript

O processador é importado pela página com o sufixo `?worker&url` do Vite:

```ts
import urlTom from '../../worklet/processador-tom.ts?worker&url';
await ctx.audioWorklet.addModule(urlTom);
```

- **No build**, o Vite compila `processador-tom.ts` e tudo o que ele importa (DSP, `acoustics/`) num bundle separado, `dist/assets/processador-tom-<hash>.js`, formato ES (`worker.format: 'es'`), e a página recebe a URL como `new URL('processador-tom-<hash>.js', import.meta.url)`, relativa ao próprio chunk (por isso funciona em qualquer subpasta). O bundle do worklet **não é minificado** (`worker.rolldownOptions.output.minify: false`), para o código do DSP no navegador ser o mesmo, linha a linha, que roda no Node. (O Rolldown ainda dobra constantes, como `1 - 0.985` → `0.015000000000000013`, que dá o mesmo double.)
- **No dev**, a URL aponta para o próprio `.ts` (`/src/worklet/processador-tom.ts?worker_file&type=module`); o Vite o transforma em módulo ES e os `import` dele são carregados pelo worklet como módulos. O Vite injeta `import "/@vite/env"` no topo, que só mexe em `globalThis` e funciona no escopo do worklet.
- O plugin do React exclui `src/worklet/`, `src/acoustics/` e `src/engines/`: o React Refresh injetaria código que usa `window`, que não existe no worklet.
- **Regra do DSP:** não usa nada do navegador nem o `sampleRate` global; recebe a taxa no construtor. Só `src/worklet/registrar.ts` toca nos globais do worklet:

  ```ts
  // src/worklet/processador-ronco.ts (na migração)
  registrarProcessador('ronco-engine', (fs) => new EngineDSP(fs));
  ```

  O contrato (`src/worklet/tipos.ts`) é o mesmo do `EngineDSP`/`JetDSP`: `process(L, R, n, envioL?, envioR?)`, `message(m)`, `post(m)`.
- **Reserva:** se o worklet não carregar, `CadeiaDeAudio` roda o mesmo DSP num `ScriptProcessorNode` na thread principal, se a página passar `criarDspLocal`.
- **Verificado** com Chromium e Firefox headless, em `npm run dev`, `npm run preview` e com o `dist/` servido em `/data/engine/`: o tom toca pelo worklet (modo `worklet`, não a reserva), a telemetria volta pela porta, troca de frequência e de ambiente funcionam, sem erros no console.

### Cadeia de áudio e `AudioShell`

`src/ui/audio/cadeia.ts` reproduz `initAudio()` e `applyListenerAcoustics()` dos apps legados. As diferenças entre Ronco e Turbina ficam num perfil (`PERFIL_RONCO`, `PERFIL_TURBINA` em `perfis.ts`): compressor, EQ de 3 bandas (só o Ronco), corte inicial do envio, ganho de saída, tamanho da FFT, ambientes e a regra de abafamento por posição do ouvinte. `AudioShell` é o contexto React que cria a cadeia no primeiro `iniciar()` (o navegador só libera o áudio depois de um gesto) e a entrega por `useAudioShell()`. A telemetria chega no callback `aoMensagem`, fora do estado do React: guarde num `ref` e desenhe no `requestAnimationFrame`. Os parâmetros do DSP (`params`, `config`, `input`) continuam sendo mandados pela página com `audio.send(...)`, na mesma ordem do legado.

### Ferramentas de verificação

- `npx tsx tools/render.ts ronco <presets|all> <idle|cold|rev|wot|sweep> <pasta> [ouvinte]` e `npx tsx tools/render.ts turbina <presets|all> <start|takeoff|flyby> <pasta> [ouvinte]` renderizam para WAV float 32 (`--pcm16` para 16 bits) e JSON de telemetria. `DSP=<arquivo>` troca o DSP: um legado CommonJS (ex.: `git show master:src/dsp.js > /tmp/dsp.master.js`) ou um módulo TS que exporte `EngineDSP`/`JetDSP`. `PRESETS=` e `GEOMETRY=` fazem o mesmo para presets e geometria. Os cenários e o laço (eventos no início de cada bloco de 128 amostras, telemetria depois do bloco) são os de `render.js`/`jetrender.js`; com `--pcm16` a saída é idêntica à desses harnesses (WAV conferido nos 68 carros em `rev`; WAV e JSON, byte a byte, em Mustang, Fusca e F1 V8 em `wot` e 737 e F-16 em `flyby`). Os acessórios padrão são o `STOCK` completo do `loadPreset()` de `app.js`.
- `npx tsx tools/compare-wav.ts <a> <b> [--limite -90]` compara dois WAVs (ou duas pastas, por nome): diz se são idênticos e dá o erro máximo e RMS em dBFS e onde está a primeira diferença. Sai com código 0 se idênticos (ou abaixo do limite).
- `npx tsx tools/acoustics-paridade.ts` recompila as fábricas legadas com um `return` que expõe as classes internas e passa as mesmas entradas pelos blocos de `src/acoustics/` e pelos legados, comparando bit a bit (RNG, utilitários, Biquad de cada tipo, Ψ e vazão, rede de guias de onda com cada abafador).
- **Paridade do Ronco:** `npx tsx tools/ronco-paridade.ts` compara os presets e a geometria em TypeScript com os de `master`, campo a campo, e renderiza com o DSP legado (o `src/dsp.js` de `master`, com a geometria e os presets de lá) e com o migrado: `idle`, `rev`, `wot` e `sweep` em 22 presets variados, `idle` e `rev` nos 68, `rev` com cada ouvinte e `cold` em alguns (200 cenários, ~1 min com 24 em paralelo). Tudo tem de sair idêntico, amostra a amostra e na telemetria. `--rapido` roda só 44 cenários, `--ref <commit>` troca a referência e `--dist` (depois de `npm run build`) confere também o `processador-ronco-*.js` do `dist/`, com a calibração feita como na página. Sai com código ≠ 0 se algo diferir. A página se testa com `node tools/ronco-navegador.mjs <url>/ronco.html [chromium|firefox]`: liga, acelera, troca marcha, carro, ambiente e ouvinte, mexe no painel e confere telemetria, som e console (`RESERVA=1` testa a reserva no `ScriptProcessorNode`).

### Paridade da Turbina

`npx tsx tools/turbina-paridade.ts [ids] [--legado <ref>] [--sem-render]` (alguns minutos com os 34 aviões) tira `src/jet-dsp.js` e `src/jet-presets.js` de `git show master:` (ou de `<ref>`), confere os presets objeto a objeto, roda `tools/render.ts` com `DSP=`/`PRESETS=` do legado e do migrado em `start`, `takeoff` e `flyby` e compara com `tools/compare-wav.ts` (e os JSON byte a byte), e depois põe os dois DSPs lado a lado em cenários extras: estrondo sônico, rasante supersônico, a bordo com reversor, solo com `tune` e corte, reconfiguração, 44,1 kHz e bloco de 1024, nos 4 canais e em cada mensagem de telemetria. Sai com código ≠ 0 se algo não for idêntico. A página é testada com `node tools/turbina-testa-navegador.mjs <url>/turbina.html [--firefox] [--reserva]` (partida, manete, pós-combustão, reversor, passagem com estrondo, troca de avião e de ambiente, mensagens para o worklet, console).

## Caminho do áudio no navegador

```
AudioWorklet (DSP, 4 canais)
  ├─ canais 0–1: som direto ─────────────┐
  └─ canais 2–3: envio para o ambiente ─→ ConvolverNode (resposta ao impulso sintética) → passa-baixa
                                         ↓
                              DynamicsCompressor → EQ de 3 bandas → ganho → Analyser → saída
```

- No legado, o DSP tenta carregar como AudioWorklet por URL `blob:` e depois `data:` (a segunda forma era necessária ao abrir pelo `file://`, onde a origem é nula); se nenhuma funcionar, cai para `ScriptProcessorNode` na thread principal. No código novo o worklet é um arquivo do build (ver [AudioWorklet em TypeScript](#audioworklet-em-typescript)), com a mesma reserva.
- Cada ambiente (céu aberto, túnel, hangar…) tem uma resposta ao impulso gerada na hora. Ela soma uma cauda difusa, com decaimento exponencial que escurece com o tempo, a ecos discretos com atraso, ganho e espalhamento próprios: prédios, arquibancada, paredões do vale. Um som de fundo fraco (vento, trânsito, ventilação, arquibancada) é gerado dentro do DSP. A ventilação do túnel e da garagem é ruído de banda estreita na passagem das pás (100 e 120 Hz, Q ≈ 7) e no dobro (Q ≈ 9), independente em cada ouvido; era um seno parado, que soava como tom de teste por baixo de tudo e ficava uns 8 dB mais alto. "Som de fundo do ambiente" desliga esse fundo e mantém a acústica do lugar.
- **Calibração de volume.** Ao montar um motor, a thread principal renderiza numa cópia do DSP, com escape e acessórios de referência e motor quente, 0,5 s em carga máxima a 55% da faixa vermelha e 1,2 s em marcha lenta. O ganho fixo é o que leva a carga ao alvo; a lenta ganha um **reforço próprio** (o que falta para ela ficar 21 dB abaixo da carga, como nos motores reais), aplicado por rotação: inteiro na lenta e sumindo até metade da faixa vermelha. Na sonda de lenta o giro é travado, então a válvula de ar é ajustada até o torque médio zerar, que é onde a lenta de verdade se equilibra (sem isso a sonda ficava 4 dB mais alta que a lenta real). O turbo é calibrado com 40% da pressão máxima. Abafador, válvula, diâmetro e temperatura continuam mudando o volume de verdade, porque ficam fora dessa normalização. Na mesma passada mede-se a potência que o modelo entrega (três pontos em carga total) para a escala de torque descrita na dinâmica.
- **Modo arcade** ("Volume do motor"): um nivelador cujo detector lê o escape na fonte, antes do ouvinte, para a distância na rua e a cabine continuarem valendo. RMS de ~50 ms; abaixo do nível de carga total da calibração ele sobe o ganho na razão 1:2, até +10 dB, e acima não mexe: a lenta sobe metade do que falta, sem igualar ao giro alto. O ganho desce em ~15 ms e sobe em ~300 ms, para não "bombear" no corte de giro, e um detector de pico (ataque na hora, soltura de ~140 ms) impede que o reforço leve um estouro além do teto. Diferença entre lenta e carga total: Camaro 18 → 10 dB, Fusca 13 → 7, F1 V8 23 → 13. (Uma primeira versão, 1:5 até +16 dB, deixava a lenta quase no nível do giro alto.)

---

## Ronco: motor de pistão

### Geometria e ordem de ignição

Cada combinação de arranjo e número de cilindros tem uma família de virabrequins. Cada virabrequim é a lista de ângulos dos moentes e das ordens de ignição conhecidas.

- O ponto morto superior de cada cilindro é `deslocamento_da_bancada − ângulo_do_moente`. O deslocamento é 0 na bancada A, `−ângulo do V` na bancada B e −180° no boxer.
- Os cilindros ímpares ficam na bancada A e os pares na bancada B.
- Uma ordem digitada é válida se for possível encaixar todos os disparos em 720° respeitando os pontos mortos de cada cilindro. Isso é verificado por um escalonamento guloso.
- O balanceamento de 1ª e 2ª ordem (forças e momentos) é calculado só para mostrar no painel. Ele também alimenta a vibração do bloco.

### Cilindro: modelo termodinâmico de zona única

Cada cilindro é um volume de controle aberto, integrado a cada amostra.

**Volume** (biela e manivela, curso igual ao diâmetro, `r/l = 0,3`):

$$V(\theta) = V_c + A_p\left[r(1-\cos\theta) + l - \sqrt{l^2 - r^2\sin^2\theta}\right]$$

`V_c = V_d/(CR − 1)`, com a taxa de compressão `CR` do preset (`compression`): 11:1 por padrão nos aspirados e 9,5:1 nos sobrealimentados; motor antigo para gasolina de baixa octanagem comprime menos (Fusca 7,5:1), expande menos e chega à abertura do escape com mais pressão.

**Pressão na abertura do escape em carga leve.** É ela que faz o estalo de cada cilindro na lenta e em meio pé: o gás sai pelo vão da válvula num jato tanto mais rápido quanto maior a razão entre a pressão no cilindro e a do tubo. No Mustang a 1250 rpm em neutro ela ficava em 0,73 bar com o motor quente e 1,05 bar a frio, no nível do tubo ou abaixo, e o motor simulado não tinha agudo nenhum acima de 4 kHz (20–50 dB abaixo de uma gravação real). Três correções, abaixo, levaram a 1,21 bar quente (lenta de 700 rpm) e 2,3 bar na lenta fria de 1190 rpm (estimativa para o motor real: 1,2–1,6 e 2–2,8 bar): a queima mais lenta no vácuo, a perda de calor que depende da pressão e a centelha que pode cair depois do ponto morto.

**Primeira lei para sistema aberto** (γ = 1,33, R = 287):

$$dp = \frac{(\gamma-1)\,dQ + \gamma R\,(T_{in}\,\dot m_{in} - T_{ex}\,\dot m_{ex})\,dt - \gamma\,p\,dV}{V}$$

- **Combustão:** a liberação de calor segue a curva de Wiebe, `x = 1 − exp(−5·u³)`. A duração vai de 42° a 68°, crescendo com o giro, e cresce até 2,4× com o coletor em vácuo, `1 + 1,4·limitado((0,6 − p_col/p₀)/0,4, 0, 1)`: o gás queimado que sobra no cilindro dilui a mistura e a chama anda devagar. Em lenta a fase de 10 a 90% da queima leva ~45–50° (num motor real, 40–60°); antes levava 21°, e o motor ficava eficiente demais em carga leve, pedia pouco ar e chegava à abertura do escape sem pressão. Acima de 0,6 bar no coletor nada muda.
- **Energia da queima:** 2,6 MJ por kg do ar fresco que entrou no ciclo.
- **Avanço de ignição:** `10° + 24°·(giro/faixa vermelha)`, mais as correções descritas abaixo:
  - controle de marcha lenta;
  - atraso de troca de marcha;
  - aquecimento do catalisador;
  - controle de largada.
- **Faísca:** é "armada" no curso de admissão e dispara uma única vez por ciclo. Isso evita faísca dupla ou perdida quando o avanço muda de repente. Com atraso maior que o avanço base ela cai depois do ponto morto superior, até 20° (antes parava no ponto morto, e todo atraso além do avanço base era ignorado sem aviso).
- **Corte de combustível na desaceleração:** com o pé fora do acelerador, entra acima de ~1,9× a lenta-alvo e sai abaixo de ~1,4× (histerese); o combustível volta em rampa de 0,4 s. Sem isso a combustão voltava de uma vez com o giro ainda despencando e o motor batia na lenta e quicava. Um termo derivativo na válvula de ar faz o "pouso" do giro ser suave.
- **Perda de calor** para as paredes, proporcional a `(T − 430 K)` e a `min(1, (p_col/p₀)^0,4)`: o gás rarefeito do vácuo troca menos calor com a parede, como na correlação de Woschni. Em lenta leva ~20–25% do calor da queima (antes 37%; num motor real, 25–35%) e em carga não mudou. **Vazamento pelos anéis** (blow-by), que pesa só em baixa rotação e na partida.
- **Válvulas:** são orifícios com escoamento compressível, inclusive sônico (blocado). A função Ψ da razão de pressões é tabelada, com 4096 pontos, e linearizada perto de 1 para não endurecer a integração.
- **Comando de válvulas:** os eventos de abertura e fechamento seguem o parâmetro "comando". Comando bravo significa mais cruzamento de válvulas.
- **Vazão de escape:** é resolvida de forma implícita contra a pressão que já está no tubo primário, por regula falsi (Illinois, 6 iterações). Assim uma onda refletida que chega na hora certa ajuda a esvaziar o cilindro, como num coletor dimensionado. O refluxo pela válvula usa coeficiente de descarga 0,15.

**Diferenças entre cilindros.** Em motor real nenhum cilindro é igual ao outro. Cada um recebe fatores fixos, sorteados por motor:

- ar: ±7%;
- área de escape: ±10%;
- energia: ±5%.

Isso cria as ordens que não são de ignição (meia-ordem, 1ª, 2ª…), que dão o caráter "mecânico". Com **carburador**, essa dispersão é multiplicada por 2,6 e a variação de ciclo a ciclo por 1,9: é o "galope" dos motores antigos. Em carga leve (coletor abaixo de ~0,8 bar, inteira a 0,3 bar) o carburador soma mais 4% de variação aleatória por explosão e muda o ritmo da queima de cada ciclo (±10%, em graus, sem crescer com a queima lenta do vácuo): com a borboleta quase fechada a mistura chega mal vaporizada e mal dividida. Como o pulso do escape em carga leve sai da pressão no fim da queima, uma variação pequena da mistura já pesa muito no som: com esses valores a força das explosões varia 16–17% a 1400–2000 rpm em neutro (gravação real de um Fusca: 16% a 1400 rpm estável, 33% a 2000 rpm instável) e 25% em lenta. Com o pé embaixo o fluxo homogeneíza e o motor assenta. Em lenta, ~1% das explosões falham (a "tossida" do motor velho). O carburador **não corta combustível na desaceleração**: o circuito de lenta segue mandando mistura, o motor continua queimando mal e, com o vácuo alto (coletor abaixo de 0,3 bar, inteiro a 0,15 bar), até ~15% das explosões falham. Cortar e religar a ~1200 rpm, como faz a injeção, fazia o som sumir na desaceleração e voltar de repente. Num Fusca solto em lenta o giro oscila entre ~790 e ~910 rpm.

### Admissão e marcha lenta

- **Coletor:** é um volume com borboleta física, de área `A·(1 − cos(acelerador·π/2))`, mais a válvula de marcha lenta (IAC). Borboletas individuais têm coletor menor e área maior.
- **Controle de marcha lenta**, como numa central eletrônica:
  - um PI lento na válvula de ar;
  - correção rápida pelo avanço;
  - "resgate" contra apagamento;
  - dashpot que decai com o tempo.
- Com o giro bem acima do alvo, o integrador fica congelado enquanto o giro está despencando de uma acelerada. Com o giro parado acima do alvo, ele integra para baixo **devagar** (15% da taxa normal). Isso é necessário quando o motor esquenta e a lenta acelerada acaba. Integrar rápido nesse caso fazia o controle exagerar e entrar num vai-e-vem que chegava a apagar o motor.
- **Troca de carro com o motor ligado** (ou mudança no número de cilindros): o motor novo dá a partida do zero. Ele não herda giro, marcha nem o controle de lenta "aprendido" no motor anterior. Mudar peças do mesmo carro (escape, admissão…) mantém o motor funcionando.
- **Som da admissão:** é a derivada da vazão total que entra nos cilindros (monopolo), filtrada pelo tipo de entrada:
  - caixa de ar corta acima de ~1 kHz;
  - filtro esportivo e borboletas, acima de ~1,3 a 1,7 kHz.
- Há também um chiado de escoamento proporcional ao quadrado da **vazão na borboleta**, normalizada pela vazão de um enchimento completo na faixa vermelha. Pisando com o coletor em vácuo, a borboleta engole ar em fluxo sônico até o coletor encher: é o "suspiro" curto da acelerada. Depois o chiado segue a vazão do motor, giro × carga. (Normalizado pela rotação do momento, ele virava eficiência volumétrica e ficava no máximo durante toda a acelerada, mesmo a 1000 rpm.)

### Escapamento: rede de guias de onda

O escape é uma rede de tubos acústicos unidimensionais.

**Tubos** (`Line`): cada tubo tem duas linhas de atraso, uma em cada sentido, com:

- velocidade do som de 520 m/s (gás quente);
- perda nas paredes `exp(−0,09·L)`;
- passa-baixa de perda.

Há também **propagação não linear**: a parte de alta pressão da onda anda mais rápido, `atraso efetivo = D·(1 − 0,6·p/p₀)`, e a frente do pulso vai se afiando quase até virar choque. Esse é o "rasgado" do escape em carga. O coeficiente teórico é `(γ+1)/2γ ≈ 0,88`; atrito e troca de calor nas paredes seguram a frente, e 0,6 bate com gravações de V8 acelerando. (Ele tinha descido a 0,28: com o chiado de jato antigo, alto em qualquer giro, 0,6 virava um muro de agudo com centroide em ~950 Hz, e 0,28 deixava o ronco abafado. Com o jato refeito, abaixo, 0,6 voltou.)

**Atrito turbulento na onda de volta dos primários.** A onda refletida na junção do coletor, subindo contra o fluxo, perde energia como `Δp ∝ ρu|u|`: a cada passagem ela perde `0,7·(L/0,78 m)/√Y·|p|/p₀` (35% para 0,5 bar num primário de 0,78 m, 2–4% na lenta). A onda de ida, com o afiamento, não é tocada. Sem isso, em giro muito alto a ressonância de 1/4 de onda do primário (F1: cada cilindro a ~150 Hz, contra ~167 Hz do tubo) crescia sem limite, e o afiamento da onda de ida virava subharmônicos de período de 3 ciclos e caos. O som "engasgava" e virava ruído acima de 2 kHz: na F1 a 17.500 rpm só 21–34% da energia de 2–8 kHz caía nos harmônicos do motor, contra 41–76% em gravações de bordo de 2002, 2007 e 2011. Agora fica em 85–97%, e numa varredura de 39 giros dos três F1 nenhum ponto falha (antes, 21). O mesmo caos aparecia em giros isolados de Valkyrie, AMG One, Jesko, McLaren, T50, Triumph, H2, CBR, M3 G80 e Supra; na varredura de 68 presets a 50/70/85/95% da faixa vermelha os pontos fora dos harmônicos caíram de 25 para 7, todos assobio de turbo ou vazamento do Fusca. Efeito nos carros de rua (média de 5 giros, plena carga): Mustang −3,5 dB em 2 kHz, Hellcat −2,9 dB em 250 Hz (uma ressonância de 206 Hz do escape, até −12 dB perto de 5000 rpm), os demais dentro de ±2 dB; a lenta quente não muda.

**Entrada do pulso no tubo primário:** a pressão injetada é `Z·ṁ·(T/1650 K)`: impedância vezes vazão **volumétrica**, não mássica. O fator é fixado na abertura da válvula de escape com a temperatura do ciclo: um ciclo queimado em carga (~1650 K) entra inteiro; a lenta (~950 K) entra 5 dB mais baixa (a calibração repõe); um ciclo com a ignição ou o combustível cortados, ou de freio-motor (~350 K, gás 4× mais denso) entra 13 dB mais baixo. Sem isso o corte de giro soava 8 a 10 dB **mais alto** que o motor queimando, porque o cilindro frio empurra a mesma massa com o dobro da vazão mássica no fim do curso de escape. A área efetiva da válvula de escape satura cedo (`min(1, 2,5·sen²)`), como nos perfis reais; com a válvula "pontuda" o gás frio ficava preso e saía num pulso curto e agudo na hora de fechar.

**Junções:** espalhamento por conservação de vazão entre tubos de admitâncias diferentes:

$$P = \frac{2\sum Y_i\,p_i^{+}}{\sum Y_i}, \qquad p_i^{-} = P - p_i^{+}$$

**Topologia:**
- tubos primários (iguais, desiguais ou curtos) que se juntam num coletor por bancada;
- traçado único, duplo, X-pipe ou H-pipe. No H e no X cada bancada tem a sua junção, e as duas se ligam por um tubo de cruzamento: no H, fino (0,28 m, admitância 0,35× a do coletor); no X, curto e largo (0,10 m, 0,8×), onde os pulsos se trocam em boa parte mas cada lado ainda leva o ritmo da sua bancada. O X era uma junção única de 4 portas, que deixava as duas ponteiras idênticas (correlação 0,99 entre os ouvidos) e apagava o ritmo de cada bancada do V8 cruzado. No Mustang a 4500 rpm em carga, a correlação caiu de 0,93 para 0,51 e as ordens baixas (0,5 a 2) subiram até 12 dB. Na lenta e em giro baixo o comprimento de onda é muito maior que o X, qualquer cruzamento iguala a pressão, e a correlação fica em ~0,95: como nos carros reais, o X soa mais rasgado e menos "galopado" que o H;
- abafador;
- ponteira.

**Abafadores** (`TwoPort`): transmitem uma versão filtrada e refletem parte da onda de volta.

| Tipo | Comportamento |
|---|---|
| Direto | Quase transparente |
| Esportivo | Tubo perfurado com lã: a lã absorve cada vez mais com a frequência, passa-baixa de 2ª ordem a partir de ~2,2 kHz mais um corte em 4,5 kHz; o grave passa livre |
| Original | Câmaras e ressonador: corta o médio (−7 dB perto de 350 Hz, −6 dB perto de 800 Hz) e o agudo cai uns 40 dB acima de 2 kHz (dois passa-baixas em 900 Hz e um em 2 kHz); o grave das explosões passa |
| Original antigo | Caixa de lata só com câmaras, sem lã (Fusca, anos 60/70): −7 dB perto de 300 Hz, uma leve ressonância da lata em 1,6 kHz (+1,5 dB) e corte só acima de ~3 kHz. Sem material absorvente o médio-agudo passa: é o som estridente, "de lata", que o Original moderno (com lã) deixava grosso. Depois dele a onda se afia de novo um pouco (0,15) |
| Turbina do turbo | Prateleira de −6 dB acima de ~1,3 kHz, corte em 3,5 kHz e leve reforço do grave do coletor |

Depois do abafador original a não linearidade do tubo é quase desligada. Com onda fraca o choque não se forma de novo, e mantê-lo refazia os agudos que o abafador tinha tirado.

**Ponteira** (`Radiator`): reflete invertido nas baixas frequências (−0,93, com filtro de 1,5 kHz) e irradia como um **monopolo**: a pressão que chega ao ouvinte é a *derivada* da vazão volumétrica que sai pela boca. Abaixo de `ka ≈ 1` (`f = c/2πa`, uns 2 kHz numa ponta de 2,5") a irradiação sobe 6 dB por oitava; acima, a boca irradia como um pistão. É um passa-alta de 1ª ordem aplicado à vazão, com o canto dependendo do diâmetro da ponta (a ponta larga irradia mais grave). Esse detalhe é o que faz o som de motor crescer uns 20 dB da lenta ao corte e ter o médio do "ronco" em vez de só o grave da ignição: uma versão anterior emitia a pressão incidente diretamente (resposta plana), e com isso o nível saturava em metade do giro e o espectro ficava quase todo abaixo de 400 Hz. O som irradiado cresce com a área da ponta.

**Acessórios do escape:**
- **Diâmetro** (1,5" a 4"): a área muda a admitância dos tubos (o que o coletor "enxerga") e a perda nas paredes. A ponta mais larga irradia mais grave; o tubo fino acelera o gás e chia mais.
- **Ressonador:** um tubo lateral fechado de ¼ de onda, afinado na frequência de ignição a ~2200 rpm (o "drone" de estrada).
- **Caixas de calefação** (coletor `'heater'`, Fusca): os tubos longos atravessam o trocador de calor da cabine, que come agudo (perda em 5 kHz, amortecimento maior); os curtos vão direto ao abafador. Na ordem de ignição eles se alternam, longo, curto, longo, curto, então o escape sopra diferente a cada volta.
- **Vedação do escape** (`breakout`: `'sealed'`, `'old'`, `'leaky'`): a rajada de cada abertura de válvula vaza pelas paredes finas e juntas deslizantes perto do motor, antes do abafador. É ruído largo (passa-alta em 700 Hz, um polo em 2,5 kHz, corte em 10 kHz) cuja envoltória segue o empurrão de cada cilindro (`Z·ṁ·T/T₀`): sobe em ~3 ms, cai em ~10 ms e tem um piso de metade da média de ~0,1 s (entre as rajadas o escape segue pressurizado e as juntas vazam um pouco). Os tubos das caixas de calefação vazam 0,35× e cada junta ±20%. Fica fora da calibração de volume. Medido contra a gravação de um Fusca 1600 a ~1974 e ~1407 rpm em neutro (terços de oitava rel. 150–400 Hz, 1/2/4/8 kHz): real −6/−9/−11/−18 e −8/−12/−13/−20, simulado −10/−11/−15/−21 e −6/−7/−10/−16; profundidade da envoltória do agudo 0,30 e 0,35 contra 0,35 e 0,26; variação entre explosões 18% e 17% contra 33% e 16%. Com o vedado o agudo do Fusca ficava 20–30 dB abaixo do real, e era isso o som "grosso". As duas rotações puxam para lados opostos (o real fica mais brilhante a 2000 rpm, o simulado a 1400), e o ganho do vazamento é o meio-termo; ele subiu 1,7 dB quando o pulso em carga leve ficou mais forte (queima lenta no vácuo).
- **Válvula de escape (cutout):** uma boca lateral de 20 cm antes do abafador. Fechada, é um toco tampado que vaza e absorve um pouco (reflete 0,7), para não virar um ressonador de ¼ de onda. Aberta, vira uma segunda ponteira, e o gás escolhe o caminho mais fácil. É comandada como um escape ativo: **Silencioso** (sempre fechada), **Normal** (abre com o pé acima de ~55% ou acima de ~62% da faixa vermelha, fecha abaixo de 30% e da metade da faixa), **Esportivo** (sempre aberta, menos rodando leve: marcha engatada, carro andando, entre 3% e 15% de pé abaixo de ~40% da faixa; parado ou em ponto morto fica aberta) e **Pista** (sempre aberta). O Mustang vem no Esportivo: segurando 2000 rpm em neutro, as bandas de 400 Hz–6 kHz ficam a poucos dB de uma gravação real do carro, contra 5 a 12 dB abaixo com a válvula fechada. A posição vem do controle (a cada 16 amostras, atuador com ~0,15 s) e é alisada amostra a amostra por um polo de 40 Hz (~4 ms de atraso). Em degraus, ela modulava a boca e fazia um zumbido quase quadrado em fs/16 e múltiplos (3, 6, 9, 12 kHz) por 0,3 a 0,5 s cada vez que a válvula automática abria ou fechava (Mustang entre ~3000 e 5000 rpm): linhas até 28 dB acima das vizinhas, que agora ficam no nível do ruído, sem mudar o espectro em regime.
- **Boxer:** o tubo de uma bancada cruza por baixo do motor e as ponteiras ficam assimétricas. Sem isso a meia-ordem de cada bancada, a 1,5ª num flat-6, se anula ao somar as duas. É ela que diferencia um boxer de um 6 em linha.

### Ruídos que não são o pulso

- **Turbulência na válvula de escape:** o jato que sai pelo vão da válvula no "estouro" da abertura. É ruído filtrado para os agudos, injetado no tubo junto com o pulso, com amplitude `0,05·vazão·M³`, onde `M = √(2/(γ−1)·(r^((γ−1)/γ) − 1))` é o Mach do escoamento isentrópico para a razão `r` entre a pressão no cilindro e a do tubo, limitado a 1 no engasgo. Como num jato, cresce sem limiar (potência ∝ U⁸) e some sozinho quando o cilindro esvazia; ligado o tempo todo, ele soava como vento. Com catalisador, ×0,8. Antes só ligava acima de 1,3× a pressão do tubo e crescia com a velocidade do pistão, então na lenta não existia. Na lenta fria do Mustang (1190 rpm, 2,3 bar na abertura) cada cilindro estala uma rajada presa ao ciclo, como na gravação do carro: fração periódica do agudo 0,73 (4–8 kHz) e 0,82 (8–16 kHz), contra 0,74 e 0,81 no real e zero antes. O agudo subiu 9 a 19 dB de 4 a 16 kHz, mas ainda fica 6–11 dB abaixo do real em 2,5–8 kHz e 14–22 dB acima de 10 kHz, e falta o cilindro dominante da gravação (um estalo 2,3× maior que o segundo). Em meio pé (2500 rpm, 30%) o agudo subiu até 2,2 dB e em plena carga ficou igual.
- **Jato na ponteira:** chiado em duas bandas (450 e 1400 Hz) com nível ∝ v², onde `v` é a velocidade instantânea do gás na ponteira (a onda que sai pela boca, sem a média). Ele segue cada pulso: é o "puf" de cada explosão saindo pela ponteira, com silêncio entre elas, e é o que dá o agudo vivo de todos os carros e o sopro do Fusca. A velocidade usa a área da **ponteira** (`tipD`, padrão o diâmetro do tubo): ponteira fina, o mesmo pulso sai mais rápido. Nível 5 dB abaixo da versão anterior (o ar dominava a acelerada); o controle "Ar" em ~180% volta ao nível antigo. Uma versão intermediária usava a velocidade *média* do gás (vazão ÷ área, com lei de Lighthill): parecia mais física, mas apagava os pufs em giro baixo e médio e deixava todos os carros abafados, como se o agudo fosse um fundo liso. Medindo só o espectro médio isso não aparece; o contraste da envoltória do agudo (p90/p10 em 1–6 kHz) mostra: no Fusca com pé leve, 17 dB na versão anterior, 8 dB com a velocidade média, ~12 dB agora.
- **Controle "Ar (jato, chiado)":** escala todos os ruídos de escoamento: jato, turbulência na válvula, chiado da admissão e do turbo.
- **Mecânica:** estalos do trem de válvulas a cada evento, batida de combustão e pistão, um tom de engrenagem e o motor de partida.
- **Refrigerado a ar** (`cooling: 'air'`): sem a camisa d'água, a mecânica soa mais alto (×1,2) e não há ventoinha elétrica de radiador. (A folga de válvula, o "clec clec", foi tentada duas vezes e retirada: ampliar os cliques de ruído soava pegajoso, "colando e descolando", e pancadas em ressonâncias estreitas viravam um bipe contínuo, como despertador. Fica para quando houver uma gravação de referência.) O sopro da ventoinha de correia do Fusca e do 911 antigo foi testado e retirado: ruído largo e contínuo que sobe com o giro soava como mar, enchia o silêncio entre os pufs e não aparece no som real.
- **Vibração do bloco:** forças de inércia de 1ª e 2ª ordem de cada cilindro mais a oscilação do torque. É o "peso" ouvido na cabine e no cofre.
- **Turbo:**
  - a turbina acelera com a vazão de gás, com subida em ~0,55 s e queda em ~1,2 s, e a pressão vem dessa rotação;
  - há assobio do compressor e chiado;
  - a válvula de alívio dispara quando a borboleta fecha com pressão (menos com o antilag ativo).
- **Compressor mecânico:** a pressão é proporcional ao giro, sem atraso. O uivo é a pulsação da descarga a cada passagem de lóbulo (ou de pá), em `giro × relação da polia × passagens por volta do rotor`. No Roots cada um dos dois rotores descarrega um bolsão por lóbulo (2 × lóbulos); no duplo parafuso, um por lóbulo do rotor tocado pela correia; no centrífugo, uma por pá. O Hellcat (IHI de duplo parafuso, 2,36:1, rotor de 5 lóbulos) uiva em 11,8× o giro, como na gravação do carro (~700 Hz e o dobro a ~3600 rpm). Antes todos uivavam em 14,4×, com três senoides paradas, e soava como apito. A pulsação não é senoidal: cada bolsão abre de uma vez para a descarga, e a onda tem harmônicos até ~20 kHz que caem como `k^−1,6` no Roots (o moderno, de lóbulos torcidos 160–170° como o Eaton TVS do GT500, abre cada bolsão aos poucos; com `k^−0,6`, como num Roots de lóbulos retos, o uivo agudo virava um guincho fino) e `k^−1,8` no centrífugo; no duplo parafuso o 2º harmônico é tão forte quanto o fundamental, como na gravação de um Hellcat desacelerando, e do 3º em diante caem de −10 a −26 dB. É o som cheio de sirene; quase só o fundamental soava como apito. Cada cilindro que aspira puxa a descarga: o uivo pulsa no ritmo das admissões (±35% no duplo parafuso, ±20% no Roots, ±10% no centrífugo), o que lhe dá o "nhiii" granulado. A correia e a carga variam a rotação dos rotores (~0,5%), e a linha fica larga. O vazamento pelas pontas dos rotores chia junto com cada bolsão, num chiado médio (passa-faixa em 2,5 kHz) abaixo do uivo. O volume do uivo (`scWhine`, em dB) é do preset: o do Hellcat é famoso por ser alto (0 dB), o do GT500 fica em −9 dB e o do H2 em −10 dB. Ele fica fora da calibração de volume. A passagem dos lóbulos pulsa a pressão de descarga numa fração grande da própria pressão, então o uivo tem mix próprio, separado do turbo, conforme onde ele fica: no Hellcat em carga perto do corte ele fica ~8 dB abaixo do total no cofre e ~15 dB na cabine, dominando a própria banda nos dois, e por trás do carro chega fraco (~−36 dB; na moto a câmera fica colada nele). Na rua, de frente, nada fica entre ele e o observador: entra com o peso do cofre e, com o carro vindo de 30 a 60 m, fica 11 a 13 dB abaixo do total. O nível segue a pressão que os rotores fazem: com o pé embaixo cada bolsão abre para a descarga pressurizada e o uivo é forte; tirando o pé, a válvula de alívio abre, os dois lados dos rotores ficam quase na mesma pressão e sobra um fundo de 6% (−24 dB) dos rotores girando em vazio. Na gravação do Hellcat o uivo só aparece forte nas aceleradas; preso só ao giro, ele soava igual acelerando e caindo. Antes ficava ~30 dB abaixo em todo lugar e não se ouvia.
- **Estalos (pops):** combustível que não queimou no cilindro e explode no escape. É uma injeção de pressão na junção do coletor: um pulso positivo de ~2,5 ms mais ruído que decai em ~6 ms (combustão no tubo, não um clique). Precisa de mistura crua e de escape quente. `overrun` é o mapa da central na desaceleração e `cat`, o catalisador. Cada fonte tem uma taxa típica (estouros por segundo, escape quente, sem catalisador):

  | Fonte | Taxa |
  |---|---|
  | Limitador por ignição / parcial | 25/s / 8/s |
  | Limitador por combustível ou borboleta | quase seco (só o filme de combustível do coletor) |
  | 2-step com corte | 20/s |
  | Troca rápida (a central corta a ignição) / troca manual tirando o pé | 40/s / 5/s |
  | Falha de ignição (válvulas flutuando, comando bravo) | 1,5% de cada falha (com metade dos ciclos falhando a 5000 rpm, ~1 por segundo) |
  | Desaceleração `'cut'` (corta a injeção) | nenhum |
  | Desaceleração `'lean'` (carburador: a mistura é rica e raramente acende; o pipoco frequente é vazamento no escape) | 1/s |
  | Desaceleração `'burble'` (crepitar de fábrica) | 16/s, sumindo em 1,8 s depois de tirar o pé |
  | Desaceleração `'popbang'` (remap) | 20/s por 4 s |
  | Desaceleração `'antilag'` (rali, só turbo) | 22/s |

  - **Sorteio:** a chance em cada ciclo sem queima é `taxa ÷ (N·rpm/120)` (no máximo 0,9), vezes o fator de escape quente, vezes 0,6 com catalisador. Só acima de 1,4× a lenta.
  - **Tamanho:** ∝ `(carga do cilindro)^0,7`, com um piso por mapa (os mapas de estouro abrem um pouco a borboleta e enriquecem: a carga não é a da lenta); ×0,7 com catalisador.
  - **Parede do escape** (`exhT`, mostrada no painel): segue a temperatura do gás, `180 + 720·√(rpm/faixa)·(p_col/p₀)^0,6` °C (lenta ~320 °C, carga total ~850 °C, no máximo 950), com a inércia do ferro: esquenta em ~4 s e esfria em ~20 s. Ciclo cortado só bombeia ar e esfria o escape, a não ser que leve combustível (aí conta meio ciclo queimado). A mistura crua (limitador, carburador, falha) só acende com a parede em brasa, `suavizado(280 °C, 520 °C)`; nos mapas `'burble'`, `'popbang'` e `'antilag'` a ignição atrasada manda a chama acesa para o escape, e a parede pesa pouco (fator de 0,7 a 1).
  - **Antilag:** arma só depois de o piloto pisar (a arrancada de giro da partida não conta). Com o pé fora e o giro acima de `max(2×lenta, 0,3×faixa vermelha)`, a turbina não cai abaixo de 0,85 e a válvula de alívio não abre.

### Dinâmica: virabrequim, embreagem, câmbio e carro

- **Virabrequim:** é integrado com o torque dos gases menos o atrito. O atrito é uma pressão média de atrito (FMEP) que cresce com o giro e aumenta 50% com o óleo frio. A inércia é `(0,05 + 0,045·cilindrada)·inertia`; nos automáticos com conversor de torque (troca acima de 0,2 s) somam-se `0,06 + 0,035·cilindrada` kg·m² do impulsor, que é aparafusado no volante, e do óleo que arrasta a turbina e o eixo de entrada. Em ponto morto esse motor sobe de giro bem mais devagar que um manual: no Hellcat, de pé no fundo, a nota varre da lenta até ~4800 rpm em ~0,3 s (antes ia de 1100 a 4800 rpm em 0,1 s e soava como um salto); a 60% de pedal sobe ~10.000 rpm/s, como nas aceleradas de uma gravação do carro (~9000 rpm/s). O de dupla embreagem abre as embreagens em ponto morto e gira solto.
- **Carro:** cada preset traz a ficha técnica: **massa** com motorista (`mass`), **potência** de pico (`power`, kW), **relações** de cada marcha e **diferencial** (`ratios`, `finalDrive`; nas motos o diferencial já inclui a redução primária e a coroa/pinhão), raio da roda (`wheelR`) e arrasto (`drag` = ½·ρ·Cd·A; rolagem 1,2% do peso, freio 0,9 g). Sem esses campos vale o chute antigo: massa pela cilindrada, progressão geométrica que fecha nas marchas altas e diferencial `3,55·(faixa vermelha/7000)`. Tudo editável no painel.
- **Escala de torque:** o modelo termodinâmico entrega o torque que a cilindrada e a respiração dão (uns 92 N·m/L aspirado), o que deixava um Fusca com 1,5× a potência real e um F1 com metade. Com `power` definido, a calibração mede a potência do modelo e o torque dos gases é multiplicado pelo fator que leva a potência de pico à da ficha (o atrito fica de fora). O fator só entra acima de ~1,5× a lenta (inteiro a partir de 3×), para o controle de marcha lenta continuar com o ganho com que foi acertado. O som não muda: a escala age na integração do virabrequim e no torque mostrado.
- **Embreagem automática:** é uma mola rígida (`220·patinação`) limitada por uma capacidade que depende da situação:

  | Situação | Capacidade |
  |---|---|
  | Travada | 2,6× o torque máximo |
  | Saindo do lugar | Limitada, patina segurando o giro de arrancada |
  | Depois de uma troca, com o carro andando | Embreagem normal (até 2,2×) pegando numa curva S |
  | Troca rápida | Começa já em 0,65× e aperta, para o giro descer numa curva contínua |
  | Embalado sem acelerar | Acopla para dar freio-motor |
  | 2-step segurando | Aberta (pedal pisado / dupla embreagem esperando) |

- **Tempo de troca:** é um parâmetro por carro, de 0,04 a 1 s. Metade é a marcha em transição e metade a embreagem voltando.
- **Trocas comandadas pela central** (automático, dupla embreagem, quickshifter, qualquer troca de até 0,2 s): a borboleta fica aberta e o turbo não despeja. Na subida de pé embaixo:
  - **até 0,2 s:** a central corta a ignição, e um atraso de ignição alisa a descida do giro enquanto a embreagem patina;
  - **automático com conversor** (`'auto'` com troca acima de 0,2 s): só atrasa a ignição em 26°, e o motor segue queimando durante a troca; a embreagem nova já começa em 0,75, para a troca durar o mesmo. Com o corte, o som caía 11 a 14 dB por ~140 ms (Mustang); agora cai 1 a 3 dB.
- **Troca manual comum:** fecha a borboleta, como o motorista tirando o pé. O turbo despeja pela válvula de alívio.
- **Automático:** tem cinco modos.

  | Modo | Sobe em | Reduz em |
  |---|---|---|
  | Pista | 97% da faixa vermelha | 70% |
  | Esportivo | 85% | 50% |
  | Normal | ~3,6× a lenta (entre 38% e 60% da faixa) | ~1,9× a lenta |
  | Econômico | ~2,6× a lenta (entre 25% e 45% da faixa) | ~1,4× a lenta |
  | Automático | entre ~2× a lenta e 94% da faixa, conforme o acelerador | conforme o acelerador (kickdown) |

  - **Modos fixos:** nos quatro primeiros o ponto de troca não depende do acelerador, e uma redução só acontece se o giro depois dela ficar abaixo do ponto de subida, para não ficar caçando marcha.
  - **Sem acelerar:** em todos os modos ele segura a marcha.
  - **Redução:** acontece ao desacelerar e no kickdown, e ao parar ele volta direto para a 1ª.
  - **Troca embreagem-a-embreagem:** a marcha nova já pega enquanto a outra solta, e o motor não dispara.
- **Corte de giro (limitador):** cada carro tem o tipo, a faixa e o tempo mínimo de corte. O padrão de central moderna é faixa de 70 rpm com 70 ms de corte: dá o batido rápido em neutro (~10 Hz) e também em marcha (~5 Hz), como nas centrais reais. Com a faixa de 160 rpm e sem tempo mínimo de antes, em marcha o giro levava 0,6 s para cair a faixa inteira e o corte virava um vai-e-vem lento (~1,5 Hz).

  | Tipo | Como funciona | Som |
  |---|---|---|
  | Ignição | Corta a faísca acima da faixa vermelha e volta abaixo de `faixa vermelha − faixa`, respeitando o tempo mínimo de cada corte | Batido com estouros no escape |
  | Combustível | Igual, mas corta a injeção | Batido seco |
  | Parcial | Corta uma fração das explosões em rodízio (um acumulador que dispara o corte quando passa de 1, com sorteio para não virar um padrão periódico, que soava como um zumbido parado). A fração cresce com o quanto o giro passou do início da faixa | Giro quase parado no limite (±100 rpm), picotado |
  | Borboleta | Controlador PI com amortecimento pela subida do giro, mirando 40 rpm abaixo da faixa vermelha, mais um atraso de ignição para tirar torque na hora. Os ganhos são altos porque em giro alto a borboleta só tira ar quando está quase fechada. Corte de combustível de segurança a +200 rpm | Liso |
  | Sem corte | Acima da faixa vermelha as válvulas flutuam: falhas e perda de energia crescentes até ~12% acima (o motor se equilibra uns 7 a 9% acima da faixa) | Motor falhando, sem batida |

  Faixa grande com tempo mínimo longo dá um batido lento e fundo; faixa pequena com tempo curto, um batido rápido.
- **2-step:**
  - **Corte:** é um limitador numa rotação escolhida, com estouros.
  - **Controle de largada:** é um PID que fecha a borboleta, com integrador, termo proporcional e amortecimento pela derivada do giro. Atrasa a ignição se a borboleta fechada não bastar. Não corta nada e não estoura.
  - **Quando segura:** só em ponto morto ou com o freio apertado.

### Temperatura do motor

A temperatura da água evolui de verdade, ou fica fixa num valor escolhido:

$$\frac{dT}{dt} = 0{,}135\sqrt{\frac{\text{rpm}\cdot p_{col}/p_0}{240}} - 0{,}0008\,(T - T_{amb}) - s(T)\cdot 0{,}06\,(T-80)\cdot(0{,}35 + v/25 + \text{ventoinha})$$

- `s(T)` é a abertura da válvula termostática, que vai de 86 °C a 95 °C.
- A ventoinha liga em 99 °C e desliga em 93 °C.
- Em marcha lenta o motor leva ~6 minutos para aquecer; andando forte, bem menos.

Com o motor frio (`frio = 1 − suavizado(15 °C, 80 °C)`):

- **Marcha lenta:** sobe até `min(0,8·lenta, 650 rpm)` logo depois de pegar (uns 1,7× num V8 de rua), com uma arrancada de 200 a 650 rpm nos primeiros segundos. A central vai baixando a lenta acelerada com o tempo de funcionamento (45% dela decai com constante de ~50 s), mesmo antes de a água esquentar; o resto segue a temperatura.
- **Ignição:** com catalisador (`cat`), atrasa até 25° no primeiro minuto para aquecê-lo (na lenta fria a centelha cai ~10° depois do ponto morto, como nas centrais reais). A queima termina tarde, o gás chega ao escape quente e com pressão, e cada abertura do escape estala: o ronco fica mais rasgado.
- **Bomba de ar secundário:** também só com catalisador, zumbido elétrico nos primeiros ~100 s abaixo de 45 °C.
- **Atrito:** até +50%.
- **Variação de combustão:** até +90%.
- **Ruído de tucho e pistão:** até 2,6×.

### Ouvinte

| Posição | Mistura |
|---|---|
| Ao lado do escape | Quase só a ponteira mais próxima |
| Câmera atrás | Escape, mais o que sai do cofre conforme a **posição do motor** (`engine`). Dianteiro: admissão (0,12), mecânica (0,1, sombreada pela carroceria) e compressor (0,07) chegam de longe. Central: chiado da admissão 0,12, mecânica 0,2 (meio sombreada), compressor 0,22. Traseiro: a câmera fica colada no cofre, chiado da admissão 0,12 (escapa pelas grelhas da tampa), pulso grave 0,15 (contido na caixa do filtro), mecânica 0,15 sem sombra, compressor 0,3. É por isso que o mesmo chiado é a alma do Fusca e soa postiço num Mustang. (Um reforço do pulso da admissão para o "bufar" do Mustang foi testado e desfeito: não era isso, e mudava a lenta do Fusca.) Cada ponteira chega a cada ouvido com uma diferença de tempo conforme o lado (até ~0,6 ms, atrasa o ouvido de lá): só com volume o som ficava "dentro da cabeça" no fone. Só nesta posição |
| Cabine | Escape pela carroceria (passa-baixa de 420 Hz e 1,1 kHz, ressonância de 70 Hz do habitáculo), admissão e mecânica pela parede corta-fogo, vibração do bloco |
| Cofre | Admissão, comando, bloco; o escape chega abafado por baixo |
| Parado na rua | Propagação até o observador (abaixo); as fontes da frente com o mesmo peso de admissão da câmera atrás |

Nos microfones junto ao carro a ponteira fica a ~35 cm do asfalto: abaixo de ~200 Hz a reflexão no chão chega em fase, um reforço de +3 dB em 110 Hz (era +5; acima disso a reflexão soma em potência, então o ganho relativo do grave é ~3 dB).

**Observador parado na rua.** O carro anda de verdade, na velocidade que sai do câmbio, e dá voltas num circuito do tamanho do ambiente. O som vai para um buffer e é lido com atraso fracionário (interpolação de Hermite cúbica), com o atraso igual a `distância/343 m/s`. Como o atraso varia continuamente, o **Doppler** sai sozinho. Também entram:

- atenuação `1/r` com referência em 5 m;
- reflexão no asfalto: fonte-imagem, escape a 0,35 m de altura e ouvido a 1,6 m, com passa-baixa de 4,5 kHz;
- absorção do ar: passa-baixa que fecha com a distância;
- diretividade: o escape aponta para trás e a carroceria abafa os agudos para quem está na frente;
- panorâmica estéreo;
- envio para o ambiente proporcional a `1/√r`.

---

## Turbina: motor a jato

Cada fonte de ruído de um motor a jato é sintetizada à parte, com a lei de escala, o espectro e a diretividade conhecidos de ensaios em banco de prova. As amplitudes são calculadas em pascal a 30 m. O nível mostrado no painel ("≈ 104 dB SPL") é estimado a partir delas.

### Rotação, partida e pós-combustão

- **Gerador de gás (N2):** `u = 0` na marcha lenta e `u = 1` em 100%. A aceleração é limitada como numa FADEC: lenta perto da marcha lenta, rápida no meio, calibrada para o tempo de aceleração do motor.
- **Fan (N1):** acompanha N2 por `N1 = N1_lenta + (1 − N1_lenta)·u^1,35`.
- **Partida**, comprimida para ~15 s (num avião real leva 40 a 60 s):
  1. O ar de sangria gira o motor de partida, que arrasta N2 até ~25%.
  2. Em 20% abrem o combustível e os ignitores, que estalam ~1 vez por segundo.
  3. A chama pega 1,5 a 3 s depois. A EGT e o ronco crescem em ~3 s, com um "vum" grave e curto.
  4. Motor de partida e turbina aceleram juntos até ~54%, quando o motor de partida desacopla e o assobio dele morre.
- **Pós-combustão:** libera a manete até 130%. Aumenta a velocidade do jato em 42% e a temperatura, acende com um "whump" e soma o ronco grave da câmara de reaquecimento. (Mais que isso saturava o limitador de saída: 5% das amostras no clip no Concorde.)
- **Vários motores:** cada um gira um pouco diferente (±0,3%), e os tons batem. O sincronizador iguala as rotações e acaba com o batimento.

### Fan e compressor

- **Tons de interação rotor-estator:** são o BPF (`pás × rotação`) e seus harmônicos. O harmônico `h` excita modos girantes `m = h·B − k·V`. Um modo só sai do duto se a velocidade de fase dele na ponta passar a do som (regra de Tyler-Sofrin):

  $$\zeta = \frac{h\,B}{|m|}\cdot\frac{U_{ponta}/c}{\sqrt{1 - M_{axial}^2}}$$

  Com `ζ < 1` o modo decai exponencialmente dentro do duto. Por isso, com palhetas ≥ 2× pás, o BPF fica "preso" enquanto a ponta for subsônica.
- **Buzz-saw:** com a ponta supersônica, cada pá carrega um choque. Para cada motor é sorteado um conjunto de pequenas diferenças de posição e força entre pás. A série de Fourier desse trem de choques irregular tem energia em **todas** as ordens do eixo, não só no BPF. São construídas duas tabelas de uma volta:
  - "perto da pá", com o BPF dominante;
  - "evoluída", com a energia escorrida para as ordens médias, como acontece na propagação não linear no duto.

  O som cruza de uma para a outra conforme o Mach na ponta, e a tabela é lida em fase com o eixo.
- **Turbulência ingerida:** modula lentamente os tons do fan, um efeito forte em ensaio no chão e fraco em voo.
- **Compressor de alta:** é o assobio do BPF dele, mais bandas laterais `± BPF do fan` (espalhamento pelo fan). Com 3 eixos há uma família a mais de tons. A turbina de baixa irradia para trás, e no turbofan com redutor ela gira mais rápido que o fan.
- **Revestimento acústico (liners):** reduz os tons do fan e do compressor.

### Jato

- **Ruído de mistura turbulenta:** pela analogia de Lighthill, a potência cresce com ~V⁸ e a amplitude com ~V⁴·D. A amplitude satura acima de ~600 m/s, onde a lei real fica mais suave:

  $$a \propto \frac{x^4}{1 + (x/2)^{2{,}5}}, \qquad x = V_{rel}/300$$

- **Dois espectros**, por número de Strouhal `St = f·D/V`:
  - **estruturas grandes:** pico em St ≈ 0,18, irradiando para trás (~30° do eixo do jato);
  - **estruturas pequenas:** largo, pico em St ≈ 0,65, para o lado.
- **Turbofan:** o jato do núcleo mistura com o do bypass. A velocidade relativa que conta é `V_núcleo − 0,55·V_bypass`, e o jato do bypass é somado à parte. O bypass é um jato **anular**: a camada de mistura tem a espessura do anel, `(D_bypass − D_núcleo)/2`, então o Strouhal usa `D_bypass − D_núcleo` para as estruturas grandes e a altura do anel para as pequenas (que vão para o lado). Com o diâmetro equivalente cheio o pico de um CFM56 caía em ~30 Hz, só tremor; o real fica em algumas centenas de Hz. Em voo, a velocidade do avião reduz a velocidade relativa.
- **Redutores:**
  - **chevrons:** −2,8 dB no grave, um pouco mais de agudo;
  - **hush kit:** −6 dB.
- **Jato supersônico:**
  - **Bocal convergente:** acima de Mach 1 de jato forma células de choque com espaçamento `L ≈ 1,1·D·√(M² − 1)`. Isso dá o ruído de choque, com pico em `0,7·V/L`, e o **screech**, um tom intermitente.
  - **Bocal convergente-divergente:** expande sem choques perto do ponto de projeto.
  - **Crackle:** com convecção supersônica (pós-combustão), pulsos de compressão íngremes e aleatórios deixam a onda assimétrica.
- **Combustão:** ronco do núcleo em ~420 Hz e ~110 Hz, proporcional ao fluxo de combustível.
- **Reversor:** joga o jato frio para a frente pelas cascatas. Corta o jato para trás e soma um rugido largo para a frente e para o lado.

### Hélice

- Uma passagem de pá é a soma de um pulso de **espessura** (proporcional a M²) e um dipolo de **carga** (potência).
- Os harmônicos caem como `exp(−(h − 1)·κ)`, com `κ = 0,1 + 2,6·(1 − M_ponta)^1,3`. Perto de Mach 1 na ponta, o pulso afina e o som enche de harmônicos. A tabela é refeita a cada ~20 ms.
- O governador mantém a rotação da hélice, e a potência muda o passo (a carga). No reverso o passo inverte e o ruído largo da pá sobe.

### Diretividade e propagação

- **Diretividade:** cada fonte tem uma curva em função do ângulo a partir do eixo da entrada de ar, de 0° a 180° em passos de 30°:
  - tons do fan pela entrada: pico em ~50°;
  - fan pelo bypass: ~120°;
  - jato grande: ~150°;
  - choque: ~60°;
  - hélice: ~100°.
- **Barramentos:** as fontes são somadas em barramentos "frente" e "trás" de cada lado da aeronave. Isso dá largura estéreo e o vai e vem frente/trás quando o ouvinte se move.
- **Cada barramento:** atraso de propagação, atenuação `30 m/r`, reflexão no chão (fonte-imagem), absorção do ar (dois passa-baixas que fecham com a distância) e panorâmica.
- **A bordo:** a fuselagem segue a lei da massa (passa-baixas de 380 Hz e 900 Hz, ressonância de painel em 110 Hz, −18 a −24 dB), e soma-se o ar-condicionado da cabine.

### Passagem e estrondo sônico

Na passagem, o tempo de emissão de cada som é calculado **exatamente**, não aproximado pela distância atual. Se o avião está agora na posição `A` ao longo da rota, o som que chega agora saiu `s` segundos atrás, com:

$$c\,s = \left|\,\text{fonte}(t - s) - \text{ouvinte}\,\right| \;\Rightarrow\; (c^2 - v^2)\,s^2 + 2Av\,s - (A^2 + Q) = 0$$

- **Abaixo de Mach 1:** há uma única raiz, e o Doppler sai sozinho do atraso variável.
- **Acima de Mach 1, antes de o cone de Mach chegar ao observador:** não há raiz positiva. É **silêncio**.
- **Quando o cone chega:** aparecem duas raízes iguais (uma cáustica), e é o instante do estrondo. Depois disso continuam as duas:
  - a do som emitido **indo embora**;
  - a do som emitido **chegando**. O atraso dela cresce mais rápido que o tempo, então esse som toca **de trás para frente**.
- **Amplitude e diretividade:** a amplitude de cada raiz inclui o fator de fonte em movimento `|1 − M·cos θ|^(−1,4)`, limitado na cáustica. A diretividade usa o ângulo de emissão de cada raiz.

**O estrondo** é uma onda em N (choque de proa, expansão linear, choque de cauda). Pico e duração seguem a regra de Carlson para o campo distante:

$$\Delta p \approx 1{,}9\,K_s\,p_0\,(M^2-1)^{1/8}\left(\frac{l}{h}\right)^{3/4}, \qquad T \approx 0{,}0042\,\frac{l\,M}{(M^2-1)^{3/8}}\left(\frac{h}{300}\right)^{1/4}$$

- `l` é o comprimento da aeronave e `K_s` o fator de forma (fino ou rombudo); 1,9 é a reflexão no chão.
- **Tempo de subida do choque:** cresce com a distância por absorção e relaxação molecular do ar, de ~1 ms a 300 m a ~4 ms a 1,5 km.
- **Turbulência perto do chão:** deixa cada choque mais pontudo ou mais redondo e acrescenta um estalo curto.
- **Trovão:** depois vem um ronco grave, mais longo de longe, das reflexões no terreno.
- **No alto-falante:** o estrondo é somado depois do ganho, perto do máximo do alto-falante. O nível físico de verdade, 150 a 165 dB, aparece só no mostrador.

---

## Diesel: ignição por compressão

O projeto está em [`DIESEL.md`](DIESEL.md); aqui fica o que foi feito, como e o que se mediu. Página `diesel.html` (`src/pages/diesel/`), DSP em `src/engines/diesel/`, worklet `src/worklet/processador-diesel.ts` (`diesel-engine`).

### Como estende o Ronco

`DieselDSP extends EngineDSP`. O `EngineDSP` ganhou uma flag `this.cc` (falsa no Ronco), `this.tempos`/`this.ciclo`, o teto 24 no `clamp` da taxa de compressão com `cc` e ramos `if (this.cc) {…} else {linha original}` nos pontos da tabela 1.2 do DIESEL.md: injeção, cliques de válvula, Wiebe, perda de calor na parede, válvulas de escape e de admissão, atrito (mais a carga do portador como pressão média de freio), motor de partida, knock e turbo. Os ramos chamam métodos que a subclasse põe como propriedades da instância (`ccInjecao`, `ccQueima`…; o `EngineDSP` só os declara). `git diff --stat` do `dsp.ts` do Ronco: 30 linhas a mais, 10 trocadas. O `control()` do Ronco roda inteiro e a subclasse corrige depois (`ccDepois`): o controle de lenta por ar, o turbo do Ronco e a temperatura do escape rodam mas não mandam em nada. `npm run paridade:ronco` (200 cenários, WAV e JSON) e `--dist` saem idênticos; render de `v16 rev` e `muscle wot` com o mesmo tempo (2,2 s e 2,6 s).

`tune()` troca a geometria pela da ficha (diâmetro e curso reais, mesmo volume), abre o duto de admissão (8× a área), põe os eventos de válvula do diesel (4T) ou as janelas (2T, escape ×1,3, janelas ×1,6), o torque, a inércia e o combustível máximo por ciclo `mfMax = P·bsfc/(3600·injeções/s)`. `buildExhaust()` monta coletores por bancada → uma turbina (`TwoPort 'turbo'`) → DPF (`DoisPortasDiesel`) → abafador (original, de caminhão ou só a chaminé) → boca com o raio da chaminé; os comprimentos são escalados por `520/c` do gás (470, 500, 560 m/s).

### Combustão

- **Injeção** armada no curso de compressão; piloto 12° antes do principal (8% do combustível, mínimo 1,5 mg escalado), início pelo mapa do DIESEL.md 2.2 (common-rail, mecânica, IDI) ou fixo (EMD 10°, GE 14°). Combustível `fuelCmd·mfMax·mapa(rpm)`, limitado por `λ_min` quando a bomba tem limitador.
- **Atraso** de Hardenberg–Hase com `p` e `T` do cilindro na injeção, `kAtraso` 1,6, cetano do preset; o principal com piloto usa 0,6×.
- **Wiebe dupla** (pré-misturada `φ_p = clamp(τ/θ_inj)·k_pre`, 6–10°; difusão 40–90°) com `dQ` limitado a 6 bar por amostra. `θ_inj` vem da vazão do injetor, escalada para a plena carga durar ~32° na rotação de potência (com a vazão fixa por mg do DIESEL.md o EMD injetava em 11° e queimava quase tudo pré-misturado).
- **Frio**: parede `430 + 0,9·(água − 90)` K; queima parcial quando `τ > 4 ms` ou a temperatura alcançada no atraso (a maior entre a da injeção e a estimada no PMS, mais o ponto quente da vela) passa abaixo de 620 K; queimas parciais `0,3·frio·e^(−t/40 s)`; σ de 2,5% a 8%.
- **Knock**: `dp/dθ` medido no cilindro em cada amostra de queima (±5% fixo por cilindro) → 2 passa-altas de 2ª ordem em `700·√(0,1/B)` Hz → banco de 5 ressonadores (bloco ×3 pelo diâmetro, tampa, câmara) → passa-baixa de 6 kHz → 70% determinístico + 30% ruído pela envoltória. Toda a mecânica (knock, tiques de injeção por tipo da tabela 2.7, trem de válvulas, bombas e um fundo mecânico contínuo) é referida ao pico do knock de lenta quente do próprio motor, medido na sonda de calibração (`refKnock`), e escalada por `K_MEC` e pelo `mecanica` do preset (dB).

### Governadores, carga e partida

- **min-max** (eletrônico): pedal manda combustível, PI isócrono de lenta (integrador até 0,6), governador de máxima em rampa de 120 rpm; **todas-as-rotações** (mecânico): droop estático `1/droop` (0,15 na lenta) realizado com ganho rápido baixo e um atraso de 0,5 s; **isócrono** no gerador, na locomotiva e na bancada, alvo em rampa (100 rpm/s na locomotiva). Sobrevelocidade: corta acima de 112%, volta abaixo de 105%.
- **Ganhos normalizados por motor** (desvio do DIESEL.md): os do documento (Kp 6, Ki 1,5/s na lenta) davam caça de ±12% a 2,4 Hz na Hilux. Aqui `P = Kt/(J·ω)` é a aceleração relativa por unidade de combustível e `Kp = ω_c/P` (lenta 9 rad/s, gerador 2,7, locomotiva 2,5, bancada 8; no EMD em N8 isso dá Kp ≈ 6). A rotação medida é a média do ω no último intervalo de ignição.
- **Portadores internos ("bancada")**: carro (o câmbio do Ronco), gerador (P = degrau·kWe/η, rampa de 0,1 s, AVR com queda por subfrequência abaixo de 97%), locomotiva (tabela de notches; o regulador de carga segue a rotação já alcançada e alivia se o combustível satura), dinamômetro (torque em fração do nominal). A carga entra como pressão média de freio somada ao atrito. `acoplar(carga)` e `{ type: 'diesel', combustivel }` estão prontos para os portadores de `carriers/` (marcados `TODO(integração carriers/)`).
- **Atrito diesel**: +0,57 bar sobre o do Ronco (o ×1,6 do DIESEL.md no polinômio inteiro dava 4,4 bar na rotação máxima). **Motor de partida** de redução (torque de travamento ~2,5× o atrito frio, gira a 150–250 rpm; o do Ronco girava um 15 L a 30–60 rpm). **Velas**: espera `(1 + 8·frio)·glowK` s antes de girar, com o relé estalando.
- **Turbo**: rotação pela energia do escape `√(rpm·combustível)`, τ do preset, mínimo 0,15 no VGT, engrenado do EMD `max(livre, rpm·18,3)`, wastegate com chiado; apito `z·N/60` (2º harmônico, queda acima de 16 kHz), chiado modulado pelos pulsos do escape. **Freio-motor**: borboleta (3 bar, atenua a boca e o jato), VGT (2,5 bar, turbo acelera), Jake (janela de −8° a +40° em volta do PMS de compressão, 0,35·AexMax, cilindros 2/4/6; o sopro gira a turbina), VEB. (A janela 350–390° do DIESEL.md cai no PMS de troca de gases, onde não há ar comprimido: foi entendida como "em volta do PMS de compressão".)

### Ferramentas e portões

- `npm run teste:diesel` (`tools/diesel-valida.ts`): lenta, governadores, pressões (tabela 2.5), bandas por família (Apêndice A, tabela 4.4), fumaça, freio-motor, potência, veículo e NaN, em paralelo; sai ≠ 0 em falha nova; os desvios conhecidos (abaixo) aparecem como "desvio". `npm run lenta:diesel`: 16 presets × 20 °C e −5 °C, partida de verdade, aceleradas aos 8 s e 13 s (notch 4 na locomotiva, degrau de 50% no gerador), zero apagamentos, rotação final ±3% do alvo do governador (±8% nos mecânicos com a água fria). `npm run governador:diesel`. `tools/diesel-bandas.ts` é a porta de `analyze2.py` (conferida nas gravações: Hilux 1GD, Cat C15 e EMD 710 dão os números do Apêndice A). `tools/diesel-render.ts <preset> <cenário> <pasta> [ouvinte] [--resumo]`, `tools/diesel-medir.ts`. `npm run navegador:diesel` serve o `dist/` em `/data/engine/` e testa a página no Chromium e no Firefox (`… dist firefox`).

### Desvios conhecidos

Os números medidos estão no relatório da etapa e em `npm run teste:diesel`. Ficaram fora do alvo: a temperatura na abertura do escape em lenta (480–540 K contra 600–750: zona única com a lenta pobre), o ângulo do pico (2–7° adiantado) e o `dp/dθ` de plena carga (10 bar/° contra 5–8); a fumaça preta no transiente (aspirado com ar sobrando, regulador de carga da locomotiva subindo junto com o giro); o EMD 710 mais escuro que a gravação (faltam fontes do 2 tempos: engrenagens, ventiladores, sopradores) e o GE agudo demais em lenta; o Jake e o freio de descarga sem o agudo e a atenuação pedidos; o droop do OM617 (3,6% contra 7–9%, pelo atrito em vazio); a caça do mecânico em lenta maior que ±2%; potência na rotação de potência até 15% acima da ficha nos leves aspirados e no Ranger; Hilux a 100 km/h em 6ª a 1542 rpm com as relações da ficha. O MAN B&W marítimo (opcional) não entrou.

## Validação

O que foi medido nas simulações offline (Node) durante o desenvolvimento:

- **Nível × rotação em carga total** (sem a compensação de loudness): cresce de forma monotônica uns 20 a 23 dB entre 15% e 95% da faixa vermelha (V8 cross-plane, V8 flat-plane, 4 em linha, boxer 6, turbos). Antes da irradiação de monopolo o nível saturava em ~40% do giro e caía perto do corte.
- **Balanço espectral contra gravações reais** (Wikimedia Commons; bandas em dB relativas à banda de 150–400 Hz, canal mono):

  | Trecho | 400–1k | 1–2,5k | 2,5–6k | 6–12k | centroide |
  |---|---|---|---|---|---|
  | Real: Maserati GranTurismo S (V8) acelerando em neutro | +2,7 | −5,7 | −14,4 | −19,5 | 610 Hz |
  | Simulado: Camaro SS acelerando em neutro (2 s de pé no fundo, com o corte) | −1,0 | −2,8 | −12,0 | −20,2 | ~725 Hz |
  | Real: Oldsmobile 442 (V8) acelerando | −2,0 | −1,7 | −11,8 | −16,7 | 461 Hz |
  | Real: Ferrari 488 acelerando | −1,4 | −9,5 | −18,1 | −33 | 454 Hz |
  | Simulado: S2000 acelerando em neutro | −5,2 | −10,7 | −22,7 | −31,7 | 462 Hz |
  | Real: Maserati em marcha lenta | −7,9 | −23,7 | −28,9 | −31,7 | 305 Hz |
  | Simulado: Camaro em marcha lenta | −11 | −17 | −18 | −23 | 266 Hz |

  O Camaro foi medido com o ruído de ar atual e o afiamento em 0,6: até 6 kHz fica entre as duas gravações de V8, de 6 a 12 kHz um pouco abaixo das duas, e o centroide sai mais alto que os delas. As linhas do S2000 e do Camaro em lenta são do modelo de ruído anterior. Em marcha lenta o simulado ainda tem um pouco mais de agudo que as gravações; esse agudo vem do som de fundo do ambiente e da mecânica, não do escape (o escape sozinho fica em −40 dB acima de 2,5 kHz).
- **Ruído de ar** (microfone atrás, pé no fundo; medido como quanto a banda cai quando o jato, a turbulência e o chiado são desligados): na acelerada saindo da lenta, a banda de 2,5–6 kHz caía 30 dB no Camaro e 31 no Golf GTI e agora cai 23 e 26 dB; o Fusca fica perto da versão anterior (24 contra 27), que soava como o carro. O agudo tonal subiu com o afiamento da onda (0,6), então o ar pesa menos no conjunto. Além do espectro médio, compare sempre a envoltória do agudo (os pufs): ela é o que mais muda a percepção e o espectro médio não a mostra.
- **Volume entre carros:** a marcha lenta dos 68 veículos fica numa faixa de ~11 dB (desvio de 2 dB; era 30 dB só com a calibração em carga e 16 dB com a média geométrica).
- **Corte de giro:** em neutro o corte por ignição/combustível bate a 8 a 14 Hz (média 10,5) com 65 a 80% do tempo cortado (em neutro só o atrito segura o giro, então a maior parte das explosões tem de ser cortada); em 3ª marcha, 2 a 10 Hz (média 5,4). Um ciclo cortado soa 3 a 9 dB abaixo de um ciclo queimado na mesma rotação, e segurar o giro no corte em neutro fica em média 5 dB abaixo da carga total a 90% da faixa (antes ficava 5 a 8 dB **acima**: o corte era uma parede de som mais alta que o motor em carga).
- **Potência:** com a escala de torque, a potência medida em carga total bate com a ficha técnica (Camaro SS 339 kW, GT3 RS 392, F2004 642, Fusca 41, R1 148, Hayabusa 138); os 68 veículos continuam segurando a lenta a 20 °C e a −5 °C.
- **Câmbio real:** com as relações da ficha, o Camaro SS gira 1400 rpm a 100 km/h em 6ª e o Fusca 3400 rpm em 4ª (134 km/h no corte); as motos de 1000 cc chegam a 155–170 km/h em 1ª.

- **Doppler da rua:** ignição de 200 Hz a 30 m/s → 216/183 Hz, contra 219/184 Hz na teoria.
- **Flat-6 contra gravações reais** de um 911 GT3 RS e de um 996 (Wikimedia Commons):
  - a ordem 3 domina;
  - a meia-ordem 1,5 fica 7 a 11 dB abaixo dela;
  - a ordem 6 fica bem mais fraca.

  O escape do boxer foi ajustado até reproduzir isso.
- **Tyler-Sofrin:** com 54 palhetas para 24 pás, o BPF fica 3 dB acima do ruído; com 30 palhetas, 40 dB acima.
- **Estrondo sônico:** o cone chegou em 3,37 s, contra 3,38 s na teoria (Mach 1,5, 200 m).
- **Marcha lenta:**
  - os 68 veículos seguram a lenta;
  - partindo a −10 °C e a 90 °C, com uma acelerada no meio, nenhum apaga.
- **Câmbio:**
  - depois de uma troca com o pé no fundo, a embreagem trava em ~0,3 s;
  - o automático reduz até a 1ª ao parar;
  - o tempo de troca medido bate com o configurado.
- **Turbina:** os 34 aviões dão partida e chegam à decolagem sem valores inválidos.

## Limitações conhecidas

- O escape usa uma velocidade do som fixa (gás quente). Na partida a frio, os tubos frios deveriam deixar as ressonâncias mais graves, e isso não está modelado (a temperatura da parede só decide os estalos).
- Alguns virabrequins não têm a geometria exata e usam o mais próximo:
  - W16 (como V16);
  - V4 com moentes a 70° (como 180°);
  - V10 a 90° com moentes defasados (como 72°).
- O ruído de jato é um modelo estatístico, não uma simulação de turbulência: na Turbina, bandas de Strouhal que andam com a velocidade do jato; na ponteira do Ronco, duas bandas fixas moduladas pela velocidade de cada pulso.
- Na Turbina, o avião não decola nem acelera na pista. A velocidade na passagem é escolhida pelo usuário.
- Onde a ficha técnica não é pública, usei um valor típico: número de palhetas do estator, pás da turbina, comprimento exato dos tubos.

## Como adicionar um carro ou avião

**Carro:** acrescente uma linha em `src/engines/ronco/presets.ts` usando uma das bases (`V8X`, `V8F`, `I6`, `B6`…) e o auxiliar `car(id, família, nome, descrição, base, campos)`. Os campos:

| Campo | Significado |
|---|---|
| `displacement`, `redline`, `idle` | Cilindrada (L), faixa vermelha e marcha lenta (rpm) |
| `compression` | Taxa de compressão (padrão 11 aspirado, 9,5 sobrealimentado; Fusca 7,5) |
| `cam`, `inertia` | Comando (0 manso … 1 bravo) e volante do motor |
| `fuel` | `'efi'` ou `'carb'` |
| `header` (`'equal'`, `'unequal'`, `'short'`, `'heater'`), `routing`, `muffler` (`'straight'`, `'sport'`, `'stock'`, `'classic'`), `pipeLen`, `breakout` (`'sealed'`, `'old'`, `'leaky'`) | Coletor, traçado, abafador, comprimento do escape (m) |
| `aspiration`, `boost`, `intake` | `'na'`, `'turbo'` ou `'super'`, pressão (bar), entrada de ar |
| `scType`, `scRatio`, `scLobes`, `scWhine` | Compressor mecânico: tipo (`'roots'`, `'screw'`, padrão, ou `'centrifugal'`), relação da polia (padrão 2,4), lóbulos ou pás (padrão 6) e volume do uivo em dB (padrão 0) |
| `overrun` | Mapa da central na desaceleração: `'cut'` (corta a injeção, padrão), `'lean'` (carburador sem corte), `'burble'` (crepitar de fábrica), `'popbang'` (remap), `'antilag'` (só turbo) |
| `cat` | Catalisador (`true`, padrão, ou `false`): menos estalos e mais fracos, um pouco menos de rasgado na válvula, aquecimento a frio e bomba de ar |
| `limiter`, `limiterBand`, `limiterHold` | Tipo de corte (`'ign'`, `'fuel'`, `'partial'`, `'throttle'`, `'none'`), faixa (rpm) e tempo mínimo de cada corte (s) |
| `gears`, `transmission`, `shiftTime`, `driveMode` | Marchas, câmbio, tempo de troca (s), modo do automático (`'track'`, `'sport'`, `'normal'`, `'eco'`, `'auto'`) |
| `ratios`, `finalDrive` | Relações de cada marcha e diferencial (nas motos, primária × coroa/pinhão) |
| `power`, `mass` | Potência de pico (kW) e massa com motorista (kg): só mudam como o carro anda |
| `wheelR`, `drag` | Raio da roda (m, padrão 0,33) e arrasto ½·ρ·Cd·A (padrão 0,42; motos ~0,3) |
| `valve`, `pipeD`, `reso`, `twoStep`, `launchRpm` | Acessórios (`valve`: `'none'`, `'closed'`, `'auto'`, `'sport'`, `'open'`) |
| `tipD` | Diâmetro da ponteira (pol.), só a saída: muda a velocidade do gás em cada pulso e o sopro do jato, não a acústica do escape (padrão: `pipeD`) |
| `engine`, `cooling` | Posição do motor (`'front'`, `'mid'`, `'rear'`; motos `'mid'` por padrão) e arrefecimento (`'water'`, `'air'`) |

A ordem de ignição precisa ser válida para o virabrequim. Ela é verificada por `EngineGeometry.build(preset).valid`.

**Avião:** acrescente uma linha em `src/engines/turbina/presets.ts` usando as bases `FAN`, `GTF`, `JET`, `MIL`, `TP` ou `PT6` e o auxiliar `plane(...)`. O significado de cada campo está comentado no topo do arquivo.
