# Como os simuladores funcionam

Este documento explica a física e o processamento de áudio por trás dos simuladores: Ronco, Turbina, Diesel, Radial, Rotativos, Elétrico, Vapor e a página Passagem (cena e portadores). É para quem quer entender por que cada som sai do jeito que sai, ou mexer no código. Nada aqui é gravação nem amostra: todo o som é sintetizado amostra a amostra, a 48 kHz, a partir de modelos físicos simplificados.

- [Estrutura do projeto](#estrutura-do-projeto)
- [Build: Vite, TypeScript e React](#build-vite-typescript-e-react)
- [Caminho do áudio no navegador](#caminho-do-áudio-no-navegador)
- [Ronco: motor de pistão](#ronco-motor-de-pistão)
- [Turbina: motor a jato](#turbina-motor-a-jato)
- [Cena e portadores](#cena-e-portadores)
- [Página Passagem e modo de testes](#página-passagem-e-modo-de-testes)
- [Adaptadores de motor](#adaptadores-de-motor)
- [Diesel: ignição por compressão](#diesel-ignição-por-compressão)
- [Radial e aviação a pistão](#radial-e-aviação-a-pistão)
- [Rotativos](#rotativos)
- [Elétrico: síntese espectral](#elétrico-síntese-espectral)
- [Vapor](#vapor)
- [Validação](#validação)
- [Limitações conhecidas](#limitações-conhecidas)
- [Como adicionar um carro ou avião](#como-adicionar-um-carro-ou-avião)

Para revisar o som de um veículo contra uma gravação real, siga o método de [`REVISAO-DE-SOM.md`](REVISAO-DE-SOM.md) (ferramentas em `tools/analise-som/`). O que a auditoria de 18/11/2026 achou de incorreto e de incompleto, com o estado de cada item, está em [`AUDITORIA.md`](AUDITORIA.md).

---

## Estrutura do projeto

O site é compilado com Vite (TypeScript + React) e publicado como páginas estáticas. O código legado (`src/dsp.js`, `src/geometry.js`, `src/presets.js`, `src/app.js`, `src/jet-dsp.js`, `src/jet-presets.js`, `src/jet-app.js`, `jato.html`, `style.css`, `jet.css`) saiu da árvore de trabalho no fim da reestruturação. Ele continua sendo a referência do som do Ronco e da Turbina, lido do histórico do git no commit fixo `02c185f` (`REF_LEGADO` em `tools/legado.ts`), que é o último de `master` com esses arquivos.

| Arquivo ou pasta | O que faz |
|---|---|
| `index.html`, `src/pages/menu/` | Menu de tipos de motor (porta de entrada do site) |
| `ronco.html`, `src/pages/ronco/` | Página do Ronco em React: `PaginaRonco.tsx` (barra, presets, instrumentos, câmbio), `Painel.tsx` (todas as seções de controles), `controle.ts` (estado e ações, com as mesmas mensagens ao DSP de `app.js`), `mostradores.ts` (conta-giros, ciclo de ignição, onda e espectro, vista da via, desenhados no `requestAnimationFrame`, fora do React), `teclado.ts` |
| `src/engines/ronco/` | O motor a pistão em TypeScript: `dsp.ts` (`EngineDSP`, ex-`src/dsp.js`), `geometria.ts` (ex-`src/geometry.js`), `presets.ts` (os 68 carros e motos, tipo `PresetRonco`, ex-`src/presets.js`), `constantes.ts` (`T_MAN`, `T_BACK`, `T_WALL`, `T_EXREF`, `SCREW_H`, `ENV_LOOP`) e `config.ts` (configuração mandada ao DSP, com a sonda de calibração) |
| `turbina.html`, `src/pages/turbina/` | Página da Turbina, migrada de `jato.html` + `jet-app.js`: `controle.ts` (estado e mensagens para o DSP, fora do React), `Painel.tsx` (controles), `Turbina.tsx` (barra, presets, manete, instrumentos, laço de desenho), `desenho.ts` (EICAS, fan, osciloscópio, mapa e leituras em canvas) |
| `src/engines/turbina/` | DSP da Turbina em TypeScript: `dsp.ts` (`JetDSP`), `presets.ts` (os aviões, tipo `PresetTurbina`), `constantes.ts` (tabela de seno, diretividade, volta da passagem); o worklet é `src/worklet/processador-turbina.ts` (`turbina-engine`) |
| `tools/turbina-paridade.ts`, `tools/turbina-testa-navegador.mjs` | Prova de som idêntico ao legado (todos os aviões) e teste da página no Chromium e no Firefox headless |
| `src/pages/comum/` | `Aviacao.tsx`: os controles e as leituras de aviação (magnetos, mistura, partida, hélice, rotor) usados pelo Ronco, pelo Radial e pelos Rotativos. `Casca.tsx` e `ProvaDoWorklet.tsx` são a casca e a prova do worklet da etapa de base; nenhuma página os usa mais |
| `src/ui/` | Componentes React compartilhados (`Slider`, `ChipGroup`, `Field`, `Section`, `FamilyNav`, `PresetNav`, `Barra`, `BotaoIgnicao`, `Manete`) e os estilos (`estilo.css`, ex-`style.css`; `turbina.css`, ex-`jet.css`; `manete.css`) |
| `src/ui/audio/` | `AudioShell` (contexto React) e `CadeiaDeAudio`: AudioContext, carga do worklet e a cadeia compressor → EQ → seco/molhado → ambiente → analisador; ambientes e respostas ao impulso; perfis de Ronco e Turbina |
| `src/acoustics/` | Blocos de acústica compartilhados: `RNG`, `Biquad`/`BiquadComPiso`, guias de onda (`Line`, `Junction`, `TwoPort`, `Radiator`, `Cutout`, `ClosedEnd`), escoamento compressível, constantes físicas |
| `src/worklet/` | Pipeline do AudioWorklet: `registrar.ts` (envolve um DSP num `AudioWorkletProcessor`), `tipos.ts` (contrato do DSP), `processador-*.ts` (pontos de entrada) e o DSP de prova `tom.ts` |
| `tools/ronco-paridade.ts`, `tools/ronco-navegador.mjs` | Prova de que o Ronco migrado soa igual ao legado (dados, WAV e bundle do worklet) e teste da página no Chromium e no Firefox headless |
| `tools/legado.ts` | A referência do legado para as paridades: o commit fixo (`REF_LEGADO`), a leitura dos arquivos por `git show` e as correções de ficha declaradas (`CORRECOES_RONCO`, `CORRECOES_TURBINA`), aplicadas ao legado antes de comparar |
| `tools/render.ts`, `tools/compare-wav.ts`, `tools/acoustics-paridade.ts` | Renderização offline para WAV, comparação amostra a amostra e conferência bit a bit do `acoustics/` contra o legado |
| `tools/analise-som/` | Banco de testes em Node e análise em Python para comparar o som com gravações reais (ver `docs/REVISAO-DE-SOM.md`); o `harness.js` carrega o DSP em TypeScript |
| `diesel.html`, `src/pages/diesel/`, `src/engines/diesel/` | Diesel (`DieselDSP`, que estende o `EngineDSP`: injeção, atraso de ignição, queima, governadores, 2 tempos, turbo, freio-motor, `MotorDiesel`; ver [Diesel](#diesel-ignição-por-compressão)); worklet `src/worklet/processador-diesel.ts`; testes em `tools/diesel-*.ts` e `tools/diesel-navegador.mjs` |
| `src/scene/`, `src/carriers/`, `tools/cena/` | Camadas cena e portador (Passagem, trem e demais portadores) e a validação offline delas (ver [Cena e portadores](#cena-e-portadores)) |
| `radial.html`, `src/pages/radial/`, `src/engines/radial/`, `src/engines/ronco/aviacao.ts`, `src/pages/comum/Aviacao.tsx` | Radial (`RadialDSP`, geometria da biela-mestra, escape radial, partida de aviação, `MotorRadial`) e a família Aviação do Ronco (ver [Radial e aviação a pistão](#radial-e-aviação-a-pistão)); testes em `tools/radial-*.ts` e `tools/radial-navegador.mjs` |
| `rotativo.html`, `src/pages/rotativo/`, `src/engines/rotativo/` | Rotativos (`RotativoDSP` do Wankel e do X-Engine, `PalhetasDSP`, `RotativosDSP` da página, geometria trocoidal, janelas, pré-silencioso em `escape.ts`, `MotorRotativo`; ver [Rotativos](#rotativos)); worklet `src/worklet/processador-rotativo.ts`; testes em `tools/rotativo-*.ts` e `tools/rotativo-navegador.mjs` |
| `eletrico.html`, `src/pages/eletrico/`, `src/engines/eletrico/`, `src/carriers/carro-eletrico.ts`, `multirrotor.ts` | Elétrico (`EletricoDSP`: banco de linhas, máquina, inversor, mecânica, AVAS, `MotorEletrico`), o carro elétrico, o trem com motor, a bancada e o drone (ver [Elétrico](#elétrico-síntese-espectral)); testes em `tools/eletrico/` e `tools/eletrico-navegador.mjs` |
| `vapor.html`, `src/pages/vapor/`, `src/engines/vapor/`, `src/carriers/{locomotiva-vapor,trator,barco,carro-direto,portadores-vapor}.ts` | Vapor (`VaporDSP`, um DSP novo que implementa `Motor` direto: cilindros de dupla ação, rede bico → caixa de fumaça → chaminé, apito de guia de onda, sino, auxiliares, caldeira) e os portadores dele: a composição locomotiva + tênder + vagões, trator, barco de rodas de pás, `CarroDireto` do Stanley e o Corliss no `Gerador` (ver [Vapor](#vapor)); testes em `tools/vapor-*.ts` e `tools/vapor-navegador.mjs` |
| `passagem.html`, `src/pages/passagem/`, `public/3d/` | Página Passagem / modo de testes: ouvinte no gimbal, cena three.js, mostradores; texturas com `LICENSES.md` (ver [Página Passagem e modo de testes](#página-passagem-e-modo-de-testes)); teste em `tools/passagem-navegador.mjs` |
| `tools/wav.ts` | Leitura e gravação de WAV (float 32 e PCM 16) usada pelas ferramentas |
| `docs/` | Este documento, o plano (`PLANO.md`), os projetos de cada etapa (`CENA.md`, `DIESEL.md`, `RADIAL.md`, `ROTATIVO.md`, `VAPOR.md`, `ELETRICO.md`: são o que se pretendia; o que foi feito está aqui), o método de revisão de som (`REVISAO-DE-SOM.md`), os créditos (`CREDITOS.md`) e a auditoria (`AUDITORIA.md`) |

**De onde veio cada parte** (os nomes do legado aparecem nos comentários do código): `src/geometry.js` → `src/engines/ronco/geometria.ts`; `src/presets.js` → `src/engines/ronco/presets.ts`; `src/dsp.js` → `src/engines/ronco/dsp.ts` e `src/acoustics/`; `src/app.js` e `style.css` → `src/pages/ronco/` e `src/ui/`; `src/jet-presets.js` → `src/engines/turbina/presets.ts`; `src/jet-dsp.js` → `src/engines/turbina/dsp.ts`; `src/jet-app.js`, `jato.html` e `jet.css` → `src/pages/turbina/` e `src/ui/turbina.css`. Para ler um deles: `git show 02c185f:src/dsp.js`.

Os arquivos `*-dsp.js` legados ficavam dentro de uma função-fábrica (`EngineDSPFactory`, `JetDSPFactory`) para poderem ser convertidos em texto com `toString()` e injetados num AudioWorklet. No código atual o truque acabou: o DSP é um módulo TypeScript comum, compilado num bundle próprio para o worklet (abaixo), e a mesma classe roda no Node, o que permite testar o som sem navegador.

## Build: Vite, TypeScript e React

- `npm run dev` serve o projeto com recarga automática; `npm run build` confere os tipos (`tsc` com `tsconfig.json`, código do navegador, e `tsconfig.node.json`, ferramentas e DSP, sem tipos do DOM) e gera `dist/`; `npm run preview` serve o `dist/`.
- **Multi-página:** as entradas estão em `vite.config.mts` (`build.rolldownOptions.input`: `index.html`, `ronco.html`, `turbina.html`, `passagem.html`, `diesel.html`, `radial.html`, `rotativo.html`, `eletrico.html`, `vapor.html`). Uma página nova é um HTML na raiz com `<script type="module" src="./src/pages/<nome>/main.tsx">` e uma linha a mais nessa lista.
- **`base: './'`:** todos os caminhos do `dist/` são relativos, então o site funciona em `ezenere.com/data/engine/` (ou qualquer subpasta) sem reconfigurar. Foi testado servindo o `dist/` em `/data/engine/`. Abrir o HTML pelo `file://` não funciona (módulos ES exigem http).
- **Por que não `"type": "module"` no `package.json`:** as ferramentas em `tools/analise-som/` (`harness.js`, `render.js`, `regressao.js`) e os arquivos legados que as paridades extraem do git são CommonJS (`require`, `module.exports`) e deixariam de carregar. A configuração do Vite é `.mts` para ser ESM mesmo assim. O `tsx` roda os `.ts` de `tools/` como CommonJS; eles usam `createRequire(import.meta.url)` e `import.meta.url`, que funcionam nos dois modos.
- **TypeScript:** `strict: false`, e os campos das classes copiadas do legado são declarados com `declare` (não geram código; a classe compilada fica igual à original). TypeScript 7, React 19, Vite 8 (Rolldown).

### AudioWorklet em TypeScript

O processador é importado pela página com o sufixo `?worker&url` do Vite:

```ts
import urlTom from '../../worklet/processador-tom.ts?worker&url';
await ctx.audioWorklet.addModule(urlTom);
```

- **No build**, o Vite compila `processador-tom.ts` e tudo o que ele importa (DSP, `acoustics/`) num bundle separado, `dist/assets/processador-tom-<hash>.js`, formato ES (`worker.format: 'es'`), e a página recebe a URL como `new URL('processador-tom-<hash>.js', import.meta.url)`, relativa ao próprio chunk (por isso funciona em qualquer subpasta). O bundle do worklet **não é minificado** (`worker.rolldownOptions.output.minify: false`), para o código do DSP no navegador ser o mesmo, linha a linha, que roda no Node. (O Rolldown ainda dobra constantes, como `1 - 0.985` → `0.015000000000000013`, que dá o mesmo double.)
- **No dev**, a URL aponta para o próprio `.ts` (`/src/worklet/processador-tom.ts?worker_file&type=module`); o Vite o transforma em módulo ES e os `import` dele são carregados pelo worklet como módulos. O Vite injeta `import "/@vite/env"` no topo, que só mexe em `globalThis` e funciona no escopo do worklet.
- O plugin do React exclui `src/worklet/`, `src/acoustics/`, `src/engines/`, `src/scene/` e `src/carriers/`: o React Refresh injetaria código que usa `window`, que não existe no worklet.
- **three.js** (dependência `three`, tipos em `@types/three`) só entra na página Passagem, num chunk carregado sob demanda (`import('./cena3d')`, ~600 kB, 150 kB gzip; `chunkSizeWarningLimit` 700). Arquivos de `public/` (as texturas de `public/3d/`) vão para o `dist/` como estão e são lidos com `import.meta.env.BASE_URL`, relativo à página.
- **Regra do DSP:** não usa nada do navegador nem o `sampleRate` global; recebe a taxa no construtor. Só `src/worklet/registrar.ts` toca nos globais do worklet:

  ```ts
  // src/worklet/processador-ronco.ts
  registrarProcessador('ronco-engine', (fs) => new EngineDSP(fs));
  ```

  O contrato (`src/worklet/tipos.ts`) é o mesmo do `EngineDSP`/`JetDSP`: `process(L, R, n, envioL?, envioR?)`, `message(m)`, `post(m)`.
- **Reserva:** se o worklet não carregar, `CadeiaDeAudio` roda o mesmo DSP num `ScriptProcessorNode` na thread principal, se a página passar `criarDspLocal`.
- **Verificado** com Chromium e Firefox headless, em `npm run dev`, `npm run preview` e com o `dist/` servido em `/data/engine/`: o tom toca pelo worklet (modo `worklet`, não a reserva), a telemetria volta pela porta, troca de frequência e de ambiente funcionam, sem erros no console.

### Cadeia de áudio e `AudioShell`

`src/ui/audio/cadeia.ts` reproduz `initAudio()` e `applyListenerAcoustics()` dos apps legados. As diferenças entre Ronco e Turbina ficam num perfil (`PERFIL_RONCO`, `PERFIL_TURBINA` em `perfis.ts`): compressor, EQ de 3 bandas (só o Ronco), corte inicial do envio, ganho de saída, tamanho da FFT, ambientes e a regra de abafamento por posição do ouvinte. `AudioShell` é o contexto React que cria a cadeia no primeiro `iniciar()` (o navegador só libera o áudio depois de um gesto) e a entrega por `useAudioShell()`. A telemetria chega no callback `aoMensagem`, fora do estado do React: guarde num `ref` e desenhe no `requestAnimationFrame`. A Passagem usa o `PERFIL_PASSAGEM` (escala absoluta: sem ganho de saída, compressor só como limitador em −1 dBFS), a reverberação da Cena (`aplicarRespostaPorBanda`: RT60 por banda, `normalize = false`, molhado √`reverb.wet`) e a opção `medidor` (analisador na soma seco + molhado antes do compressor); Ronco e Turbina não mudam. Os parâmetros do DSP (`params`, `config`, `input`) continuam sendo mandados pela página com `audio.send(...)`, na mesma ordem do legado.

### Ferramentas de verificação

- `npx tsx tools/render.ts ronco <presets|all> <idle|cold|rev|wot|sweep> <pasta> [ouvinte]` e `npx tsx tools/render.ts turbina <presets|all> <start|takeoff|flyby> <pasta> [ouvinte]` renderizam para WAV float 32 (`--pcm16` para 16 bits) e JSON de telemetria, por padrão com o DSP, os presets e a geometria em TypeScript de `src/engines/`. `DSP=<arquivo>` troca o DSP: um legado CommonJS (ex.: `git show 02c185f:src/dsp.js > dsp.legado.js`) ou um módulo TS que exporte `EngineDSP`/`JetDSP`. `PRESETS=` e `GEOMETRY=` fazem o mesmo para presets e geometria. Os cenários e o laço (eventos no início de cada bloco de 128 amostras, telemetria depois do bloco) são os de `render.js`/`jetrender.js`; com `--pcm16` a saída é idêntica à desses harnesses (WAV conferido nos 68 carros em `rev`; WAV e JSON, byte a byte, em Mustang, Fusca e F1 V8 em `wot` e 737 e F-16 em `flyby`). Os acessórios padrão são o `STOCK` completo do `loadPreset()` de `app.js`.
- `npx tsx tools/compare-wav.ts <a> <b> [--limite -90]` compara dois WAVs (ou duas pastas, por nome): diz se são idênticos e dá o erro máximo e RMS em dBFS e onde está a primeira diferença. Sai com código 0 se idênticos (ou abaixo do limite).
- `npx tsx tools/acoustics-paridade.ts` (`npm run paridade:acoustics`) lê as fábricas legadas do git (`tools/legado.ts`), recompila-as com um `return` que expõe as classes internas e passa as mesmas entradas pelos blocos de `src/acoustics/` e pelos legados, comparando bit a bit (RNG, utilitários, Biquad de cada tipo, Ψ e vazão, rede de guias de onda com cada abafador).
- **Referência do legado e correções de ficha** (`tools/legado.ts`): as paridades leem o legado de `git show 02c185f:…` (`REF_LEGADO`; com o nome `master` a referência sumiria quando a reestruturação fosse mesclada). Os presets do Ronco e da Turbina têm de continuar iguais aos legados campo a campo; uma correção de ficha (nome, massa, relações…) só passa se estiver declarada em `CORRECOES_RONCO`/`CORRECOES_TURBINA`, e aí a paridade aplica a mesma correção ao preset legado antes de comparar e de renderizar: o som continua provado idêntico com a mesma ficha dos dois lados. Um preset **novo** no Ronco ou na Turbina (um `id` que não existe no legado) fica fora da paridade: o teste avisa quais são e compara só os 68 e os 34 que vieram do legado.
- **Paridade do Ronco:** `npx tsx tools/ronco-paridade.ts` (`npm run paridade:ronco`) compara os presets e a geometria em TypeScript com os legados, campo a campo, e renderiza com o DSP legado (o `src/dsp.js` do commit de referência, com a geometria e os presets de lá) e com o migrado: `idle`, `rev`, `wot` e `sweep` em 22 presets variados, `idle` e `rev` nos 68, `rev` com cada ouvinte e `cold` em alguns (200 cenários, ~1 min com 24 em paralelo). Tudo tem de sair idêntico, amostra a amostra e na telemetria. `--rapido` roda só 44 cenários, `--ref <commit>` troca a referência e `--dist` (depois de `npm run build`) confere também o `processador-ronco-*.js` do `dist/`, com a calibração feita como na página. Sai com código ≠ 0 se algo diferir. A página se testa com `node tools/ronco-navegador.mjs <url>/ronco.html [chromium|firefox]`: liga, acelera, troca marcha, carro, ambiente e ouvinte, mexe no painel e confere telemetria, som e console (`RESERVA=1` testa a reserva no `ScriptProcessorNode`). O roteiro exige a url; `npm run navegador:ronco` serve o `dist/` sozinho (`tools/servir-dist.mjs`) e a passa.
- **Tudo de uma vez:** `npm run verificar` roda, em ordem e com resumo, as paridades, os `teste:*` e `lenta:*` de cada família, `typecheck` e `build`; `npm run verificar:rapido` roda só a parte curta (paridades em amostra, as famílias rápidas e o build); `-- --navegador` acrescenta os roteiros de navegador e `-- --so <trecho>` escolhe passos (`tools/verificar.mjs`; um passo de cada vez, porque várias medidas são de tempo de CPU). `npm run auditoria:fichas` imprime, para todas as famílias, a velocidade em cada marcha no corte, a rotação a 100 km/h, a relação peso/potência e o que foge do plausível; `npm run teste:passagem` monta todos os presets da Passagem fora do navegador e mede nível, NaN e saturação; `npm run lenta:ronco` é o teste de lenta e de corte de giro dos 68 carros; `npm run auditoria:som` tabula, nas sete famílias, o nível de lenta e de carga de cada preset, o quanto o limitador de saída trabalha, o custo de CPU, os extremos de cada controle do painel, 44,1 e 96 kHz, a troca rápida de preset e a coleta de lixo (relatório, não portão).

### Paridade da Turbina

`npx tsx tools/turbina-paridade.ts [ids] [--legado <ref>] [--sem-render]` (`npm run paridade:turbina`; alguns minutos com os 34 aviões, 13 min medidos com a máquina ocupada: os renders são em série) tira `src/jet-dsp.js` e `src/jet-presets.js` de `git show 02c185f:` (o `REF_LEGADO` de `tools/legado.ts`, ou `<ref>`), aplica as correções de ficha declaradas, confere os presets objeto a objeto, roda `tools/render.ts` com `DSP=`/`PRESETS=` do legado e do migrado em `start`, `takeoff` e `flyby` e compara com `tools/compare-wav.ts` (e os JSON byte a byte), e depois põe os dois DSPs lado a lado em cenários extras: estrondo sônico, rasante supersônico, a bordo com reversor, solo com `tune` e corte, reconfiguração, 44,1 kHz e bloco de 1024, nos 4 canais e em cada mensagem de telemetria. Sai com código ≠ 0 se algo não for idêntico. A página é testada com `node tools/turbina-testa-navegador.mjs <url>/turbina.html [--firefox] [--reserva]` (partida, manete, pós-combustão, reversor, passagem com estrondo, troca de avião e de ambiente, mensagens para o worklet, console); `npm run navegador:turbina` serve o `dist/` e passa a url.

## Caminho do áudio no navegador

```
AudioWorklet (DSP, 4 canais)
  ├─ canais 0–1: som direto ─────────────┐
  └─ canais 2–3: envio para o ambiente ─→ ConvolverNode (resposta ao impulso sintética) → passa-baixa
                                         ↓
                              DynamicsCompressor → EQ de 3 bandas → ganho → Analyser → saída
```

- No legado, o DSP tentava carregar como AudioWorklet por URL `blob:` e depois `data:` (a segunda forma era necessária ao abrir pelo `file://`, onde a origem é nula); se nenhuma funcionar, cai para `ScriptProcessorNode` na thread principal. No código novo o worklet é um arquivo do build (ver [AudioWorklet em TypeScript](#audioworklet-em-typescript)), com a mesma reserva.
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

## Cena e portadores

Camadas novas da etapa 1 (projeto em `docs/CENA.md`): o **portador** carrega o motor (carga, geometria, fontes próprias) e a **cena** leva cada fonte até o ouvinte. A interface é a página Passagem / modo de testes ([abaixo](#página-passagem-e-modo-de-testes)); o núcleo roda no Node e no worklet (`src/worklet/processador-cena.ts` → `CenaDSP`, 4 canais). Os caminhos legados do Ronco e da Turbina não passam por aqui (decisão 1.1.4).

| Arquivo | O que faz |
|---|---|
| `src/scene/tipos.ts`, `src/carriers/tipos.ts` | Interfaces do CENA.md à letra (`FonteSonora`, `Carga`, `Motor`, `Portador`, `Corpo`, `Cinematica`, `Cena`, `Ambiente`, `Trajetoria`, `Ouvinte`, telemetrias). `Motor` mora em `carriers/tipos.ts` até existir `src/engines/motor.ts` |
| `src/scene/propagador.ts` | Um anel por fonte, tempo de emissão, atraso fracionário, convecção, 1/r, diretividade, ar, solo, sombra, ITD/ILD, envio |
| `src/scene/trajetoria.ts` | Via (reta ou oval) e histórico de `s(t)` do corpo, uma entrada por bloco de controle |
| `src/scene/ar.ts`, `solo.ts`, `sombra.ts`, `filtros.ts` | ISO 9613 em 2 polos, tabela de solos, Maekawa com shelf, biquad sem alocação, ponderação A |
| `src/scene/pressao.ts`, `fundo.ts`, `ambientes.ts` | Onda de nariz/cauda, onda de compressão e pistão no túnel, vento; som de fundo; ambientes da Passagem e resposta ao impulso com RT60 por banda |
| `src/scene/cena.ts`, `dsp-cena.ts`, `supersonico.ts` | `CenaPassagem` (implementa `Cena`); DSP do worklet; resolvedor fechado para M ≥ 0,9 e estrondo (cópias do jet-dsp) |
| `src/carriers/trem.ts`, `ruido.ts` | Trem de N vagões e os geradores de ruído calibrados em L_W dB(A) |
| `src/carriers/helice.ts`, `rotor.ts`, `gerador.ts`, `locomotiva.ts`, `carro.ts`, `aviao.ts`, `base.ts`, `compat.ts`, `teste.ts` | Demais portadores (tabelas, cargas, governadores, fontes), o carro e o avião dos motores adaptados, tabela motor × portador, portador e motor de bancada para os testes |
| `src/engines/ronco/motor.ts`, `diesel/motor.ts`, `turbina/motor.ts`, `src/scene/estrondo.ts` | Adaptadores `Motor` dos DSPs existentes e o estrondo da Cena (ver [Adaptadores de motor](#adaptadores-de-motor)) |
| `tools/cena/` | `render-passagem.ts` (WAV + telemetria), `analise.ts`, `medidas.ts`, `portadores.ts`, `motores.ts` (motores adaptados), `legado.ts` (referências do legado, commit `02c185f`), `cpu.ts`, `valida.ts` |

### Propagação

- **Tempo de emissão:** ponto fixo `τ ← |r(t − τ) − O|/c` a partir do τ do bloco anterior, 3 iterações (até 6 se `|Δτ|` > 1 amostra), lendo o histórico de `s(t)` com interpolação linear; `c` = 343 m/s. Cada fonte anda pela via na sua própria abscissa `s + x_i` com o deslocamento `y_i` na normal da via: numa reta é exatamente `P + R(ψ)·b_i`; numa curva os vagões seguem os trilhos (uma barra rígida de 250 m sairia 3,9 m da via numa curva de 2 km).
- **Atraso dentro do bloco de 64 amostras:** parábola com o atraso nos dois extremos e a derivada **analítica** no início, `dτ/dt = û·(v_s − v_O)/(c + û·v_s)` (carregar a derivada do fim da parábola anterior é marginalmente estável e oscila). Leitura Hermite de 4 pontos, a do `readProp`.
- **Anel:** `min(dist. máx., 400 m)/c + 0,1 s` por fonte (64k amostras, 256 kB). O excedente vira um deslocamento inteiro fixo; quando o trecho variável sai da janela (25–90% do anel) o deslocamento é reancorado com crossfade de potência constante de 50 ms. Um salto do atraso maior que o bloco (a fonte reapareceu do outro lado da reta) zera o ganho e sobe em 50 ms.
- **Ganho por caminho:** `conv·D(θ)·refDist/r`, conv = `|1 − M·cosθ_e|^−expConv` limitado a 4. Solo: segunda leitura com o ouvinte espelhado, ganho e passa-baixa da tabela 2.4; na ponte só onde o ponto de reflexão cai a menos de 3,7 m do eixo (tabuleiro).
- **Ar:** dois polos de 1ª ordem bilineares (polo e zero em Nyquist, com pré-distorção), cada um em `1,554·f_c(r)` para a cascata ter −3 dB em `f_c(r)` (dois polos em `f_c` dariam −6 dB); acima de 0,49·fs viram um fio. (Antes eram `y += k·(x − y)` com o corte limitado a 0,45·fs: a 3–7,5 m, com `f_c` no teto de 20 kHz, os polos ficavam em 21,6 kHz e tiravam ~1 dB em 10 kHz e ~2 dB em 16 kHz, mais que a ISO.)
- **Diretividade que depende da frequência** (`FonteSonora.agudo`, extensão dos adaptadores): um corte por ângulo, que entra como teto do corte do ar (o `shade` do escape do Ronco). **Resolvedor fechado** acima de Mach 0,9 numa reta e o estrondo: ver [Adaptadores de motor](#supersônico-e-estrondo).
- **Sombra:** fecho convexo da seção do segmento com a fonte e o ouvinte; as duas correntes (por cima e por baixo) desdobradas em 3D (`√(Δx² + P²) − √(Δx² + D²)`), vale a menor. Na zona iluminada perto da borda, Kurze–Anderson com o δ da seção 2D (o 3D encolhe com Δx e criaria uma sombra falsa de fontes na face vistas de longe). Corpo menor que 10 cm não faz sombra. Shelf de 1 polo em 400 Hz com `a` e `b` resolvidos para a **resposta** dar A(100) e A(1k) (com `a = A(100)`, `b = A(1k)` literais o shelf erra até 2,5 dB em 1 kHz).
- **Ouvinte fora:** panorâmica `−3 dB` com largura 0,5 (pan inteiro zera o ouvido oposto a 90°, e aí não existe ILD para medir), ITD `0,65 ms·(seno lateral)` num anel curto por fonte, ILD por shelf em 1,5 kHz com ganho resolvido para −6·|sin az| dB em 4 kHz, sombra da cabeça −3 dB acima de 3 kHz para |az| > 120° (rampa 110–130°).
- **Cabine:** lei da massa `TL = 20·log₁₀(f·m_s) − 47`, [5, 45] dB, como `0,562·(LP₁(398/m_s) + 0,01)` mais a ressonância em `fCabine`; os dois polos em `891/m_s` e `2,6×` de 3.3 caem 12 dB/oitava e erram 7 dB em 125 Hz e 17 dB em 2 kHz. Cofre e ponteira com as regras de 3.3 (as vias estruturais das fontes `dentro` esperam os motores).
- **Envio para a reverberação:** `conv·(refDist/5)·1,2/r^e` (o `roadS` do Ronco tem `e` = 0,5), sem diretividade (o campo reverberante recebe a potência em todas as direções), relativo ao ganho direto. No túnel `e` = 0,8 e `wet` = 4: com esses dois os alvos de 2.10 saem juntos (+8,5 dB no L_Aeq,tp e nariz a 100 m 11,4 dB abaixo do pico). A resposta ao impulso sai de `gerarRespostaPorBanda` com energia 1 por canal: na página, `ConvolverNode.normalize = false` e o ganho molhado é `reverb.wet`.
- **Escala:** a Cena trabalha em pascal; `0 dBFS ≙ 124 dB SPL`; `CenaDSP` aplica `master` e `tanh`.

**Sem alocação no laço.** Com ~50 campos numéricos por fonte, o V8 deixava a representação deles como `Any`: cada double escrito num campo virava um HeapNumber (≈ 430 coletas jovens em 10 s). Estado mutável por fonte, biquads (`Bq.c`), ponto da via e rascunhos ficam em `Float64Array`; as funções quentes recebem doubles por esses arrays (um double passado a uma função que não é embutida também é encaixotado) e os filtros de fundo, vento e medidor A rodam em bloco (`Bq.bloco`). Sobram 14 coletas em 10 s, de 0,06 ms, do encaixotamento por bloco de controle no `Cena.processar`.

### Campo próximo

- **Nariz/cauda (2.6):** `p = −A·x·e^(−x²/2)`, `x = 3ξ/L_nariz` (ξ = quanto o nariz já passou; só geometria), `A = Δp_pp/(2e^(−1/2))`, cauda com sinal trocado e 70%. Inteira na telemetria, no alto-falante só o resíduo do passa-alta de 2 polos em 20 Hz.
- **Túnel (2.10):** a frente da onda de Hara (0,75×) nasce quando o nariz cruza a boca, chega ao ouvinte em `(x_O − x_entrada)/c`, reflete invertida na outra boca e volta, com período `2L/c` e −20% por reflexão; subida de meio cosseno em `L_nariz/v`. Vento: `Δp/(ρc)` depois da frente, `u_a = v·β/(1−β)·0,75` durante o corpo e esteira de 3 s, somado em quadratura com o vento induzido de 2.8.
- **Vento no ouvinte:** `70 + 60·log₁₀(u/10)` dB, passa-baixa de 150 Hz e ombro de −12 dB em 1 kHz, ruído independente por ouvido, passa-alta de 20 Hz.
- **Ponte:** ronco de 31–125 Hz pelos truques sobre o tabuleiro perto do ouvinte (peso `1/(1 + (ξ/15 m)²)` por truque), `K_PONTE` = 26 calibrado para os +5 dB de 2.10 em 31–125 Hz na passagem de validação (medido +5,0 dB; o 0,042 de antes somava 0,0 dB).

### Portadores

- **Trem (4.6):** geometria por vagão (`L = N·L_c − vão` = 249,5 m), truques a 3,75 m das pontas, vãos na junção, pantógrafos nos vagões 3 e 8, nariz e cauda. Fontes calibradas em **potência** `L_W` dB(A): `L_p(refDist) = L_W − 20·log₁₀ refDist − 11` pela integral de |H(f)·A(f)|² da cadeia, e uma fonte com diretividade sobe no eixo pelo índice de diretividade (sem isso um dipolo irradiava 3–5 dB a menos que o L_W). Diretividades (o CENA não dá): rolamento dipolo lateral `[0, −1,2, −6, −20, −6, −1,2, 0]`, fontes aerodinâmicas dipolo de face `[0, −1, −4, −10, −4, −1, 0]`, ambos no eixo y. Espectro aerodinâmico: HP₁(f_p/5)·LP₁(f_p)·LP₁(2,5 kHz), o espectro em 1/3 de oitava descrito em 2.7 (o passa-banda Q 0,5 sugerido lá põe o pico de 1/3 de oitava em ~600 Hz). Rolamento: passa-banda Q 0,5 em 1,5 kHz·√(v/v_ref) + 1 polo em 2,5 kHz·√(v/v_ref) com ganho 1/√k (1/3 de oitava −16/−8/−2/0/−4/−11 dB de 250 Hz a 8 kHz; ver [Trem contra gravações reais](#trem-contra-gravações-reais)), dormentes a v/0,6 m com ±1 dB, achatamento opcional. Níveis `L_W` ajustados contra as gravações: rolamento 130, aero do truque 105, corpo 119, vãos 119, pantógrafo 115 carenado, nariz/cauda 116 dB(A). Vão: corcova de 50–400 Hz + Rossiter (Q 5, −6 dB por ordem). Pantógrafo: tons eólios 0,2·v/d da cabeça e dos braços + ruído largo. `ladoOuvinte` põe as fontes de face no lado certo; com `faces: 'duas'` (a página) há `corpo.k.d` e `corpo.k.e` no mesmo gerador e `definirLado()` passa de uma face à outra com crossfade de potência constante de 50 ms (a Cena dá o lado em `ladoDoOuvinte()`, com histerese de 0,2 m). `orcamentoTrem`/`maxVagoes`: o aero dos truques sai quando o trem não cabe nas 64 fontes.
- **Hélice (4.2):** carga `c_Q(β, J)·ρ·n²·D⁵/i`, governador PI de passo (0,02 rad/%, 0,01/s, 5°/s), fonte de passagem de pá e ruído largo de pá. Com um turboélice acoplado a hélice é a do JetDSP; sem ele, a `FonteHelice`, idêntica amostra a amostra ao tom da Turbina ([Hélice idêntica](#hélice-idêntica)).
- **Rotor (4.3):** potência induzida + perfil + cauda + acessórios (R44: 171 kW no pairado), Nr pelo governador PI (0,8/%, 0,4/s); fontes rotor principal (carga, espessura e tapa até o 40º harmônico, peso do tapa 2,5), cauda modulada pela BPF principal, caixa e downwash.
- **Gerador (4.4):** `Q = fração·P/(η·ω)` com rampa de 0,1 s, atraso de 0,3 s da bomba. Os ganhos do CENA (0,5 por % e 0,5/s, com o combustível em fração) fazem um ciclo-limite de ±10% com esse atraso; com 0,07 por % e 0,05/(%·s) o degrau de 50% num grupo de 500 kW com 80 kg·m² cai 5,9% e volta a ±2% em 1,6 s, como o parágrafo descreve. Fontes: alternador (2·f_rede e ímpares, ranhuras), ventilador.
- **Locomotiva (4.5):** tabelas de rpm por notch (EMD 710, GE 7FDL) e de potência, rampa de 100 rpm/s, atraso de 1,5 s na carga, governador PI; regulador de carga que corta a excitação se a rotação cai mais de 10% (uma carga de potência constante apagaria o motor). Fontes: turbo, ventiladores, sopradores, compressor de ar, grades do freio dinâmico, rodas, buzina (só os parciais).
- **Motor de bancada (`MotorTeste`):** eixo rígido com atraso de 1ª ordem, para testar cargas e governadores sem um motor de verdade (o turboeixo ainda não existe). As constantes dele (Tmax, J, atraso) são da bancada.
- **Carro (`CarroLegado`) e avião a jato (`Aviao`):** os portadores dos motores adaptados ([abaixo](#adaptadores-de-motor)). Com o diesel, gerador e locomotiva usam o governador do próprio motor (`rpmAlvo`).

### Validação (`npx tsx tools/cena/valida.ts`)

`npm run teste:cena` (= `npx tsx tools/cena/valida.ts`) roda 105 medidas, compara com os alvos do CENA.md (dois deles atualizados pelas gravações, com a justificativa em `medidas.ts`) e sai com código ≠ 0 se algum falhar sem desvio documentado. Resultado atual (18/11/2026): **93 ok, 12 desvios documentados, 0 falhas**: 8 desvios da Cena e do trem (ar a 1500 m, modulação e pulsos de vão no túnel, σ do nariz, os dois L_AFmax, lei de velocidade do aero, alocação no laço) e 4 dos grupos `motores` e `niveis-motores` (os motores adaptados: 2 do avião a 1500 m e 2 de nível absoluto, a EMD e o ATR; a lenta da Hilux voltou para dentro do alvo depois da 2ª passada do Diesel; ver [Adaptadores de motor](#adaptadores-de-motor)). As duas medidas de CPU e a de alocação dependem da carga da máquina: com outros testes rodando ao mesmo tempo a de CPU por bloco já passou de 50% e virou falha. O teste leva ~2 min. Antes do ajuste contra as gravações: 73 ok, 16 desvios. Medidas por ouvido (a soma mono de um sinal binaural cancela onde o ITD dá meia volta de fase: 770 Hz).

| Grandeza (trem 10×25 m, 350 km/h, 3 m) | Alvo | Medido |
|---|---|---|
| passagem nariz → cauda (cruzamentos da onda de pressão) | 2,57 ± 0,05 s | 2,566 s |
| Doppler 1 kHz no nariz; transição 45°–135° | 1395/779 ± 5 Hz; 62 ± 5 ms | 1395,6/778,8 Hz; 64 ms |
| carro a 6 m, 200 Hz a 30 m/s | 219/184 ± 1 Hz | 219,0/184,1 Hz |
| assimetria chegando/indo (monopolo, 30 m) | +10 ± 1 dB | +9,9 dB |
| 1/r em 5, 10, 50 m | ±0,2 dB | ≤ 0,01 dB de erro |
| nulos do solo (carro, roda, pantógrafo) | ±3% | −0,6%, −0,9%, −2,6% |
| ar, 4 kHz − 500 Hz a 30/300/1500 m | 0,9/9,3/46,6 dB | 1,7/9,9/**22,2** dB (desvio: 2 polos) |
| sombra da roda oposta 100 Hz / 1 kHz | 6,2/11,6 ± 2 dB | 6,2/11,4 dB |
| onda de nariz pp; σ; cauda | 150 ± 30 Pa; 51 ms; 0,7 | 152,8 Pa; **41 ms** (L_nariz 12 m); 0,70 |
| onda de compressão; antecedência | 2,0 kPa; 3,7 s | 2,00 kPa; 3,66 s |
| vento: céu aberto; túnel durante o corpo; esteira | 5,4 m/s; 15 m/s; e⁻¹ em 3 s | 5,41; 15,8 m/s; 0,37 |
| RT60 por banda dos 5 ambientes | ±15% | todos dentro |
| modulação 1–4 kHz: frequência; profundidade | 3,89 Hz; ≥ 3 dB (gravações: 2,4–5,6; o CENA dava ≥ 6) | céu 3,95 Hz, 4,0 dB; túnel 3,93 Hz, **2,0 dB** |
| padrão duplo dos truques | 82 ms | 79 ms (vale de 1,8 dB) |
| pulsos de vão 50–200 Hz ≥ 8 dB | 9 | **0** (as gravações também não têm) |
| pico − nariz a 100 m: céu; túnel | 23 ± 4; 10–12 dB | 22,6; 11,3 dB |
| túnel − céu no L_Aeq,tp | +7 ± 2 dB | +8,6 dB |
| L_Aeq,tp / L_AFmax céu; túnel | 108/113; 115/120 dB(A) | 105,4/**106,7**; 114,1/**114,9** |
| L_Aeq,tp a 7,5 m e 300 km/h | 100 ± 3 dB(A) | 100,6 dB(A); duas faces 100,5 |
| lei de velocidade 160 → 300: rolamento; aero | +8; +16 ± 1 dB | +9,0; **+17,7** dB |
| balanço espectral no pico (60–150 / 400–1k / 1–2,5k / 2,5–6k / 6–12k) | −3 (gravações; o CENA dava +4)/−1/+1/−2/−10 ± 4 | −4,0/+0,1/−1,2/−5,6/−13,5; centroide 999 Hz |
| ponte: ronco em 31–125 Hz | +5 ± 1 dB | +5,0 dB |
| crossfade das faces do trem | potência ±0,1 dB; 50 ms | 0,01 dB; 48 ms |
| CPU por bloco (trem no túnel, 63 fontes) | < 50% do quantum | 334 µs (12,5%), p99 436 µs |
| CPU 48 fontes, 10 s | < 25% do tempo real | 7,8% |
| agudo no pico, 300 km/h (6–12 kHz / 12–24 kHz rel. 150–400): 3 m; 7,5 m | ≈ −10 / ≈ −20 ± 4 dB | −12,2 / −20,3; −8,2 / −16,9 |

**Desvios e por quê.** (1) *Ar a 1500 m:* com dois polos a diferença entre 500 Hz e 4 kHz não passa de 36 dB em nenhum corte; a ISO pede 46,7. O critério "não pode piorar" do avião (≤ −20 dB) é atendido (−21,7). (2) *σ do nariz:* 51 ms sai de L_nariz = 15 m; o padrão de 4.6 é 12 m (41 ms). (3) *Modulação no túnel, pulsos de vão e crista:* com o orçamento ajustado contra as gravações ([abaixo](#trem-contra-gravações-reais)) o balanço e a modulação a céu aberto batem; no túnel o campo reverberante enche os vales (2,0 dB); os pulsos de vão em 50–200 Hz e a crista de 5 dB (L_AFmax − L_Aeq,tp) também não aparecem nas gravações (0,7–1,8 dB). (4) *Leis de velocidade:* a potência segue 30/60·log v à letra e a Cena soma a convecção de 2.1, +1 dB entre 160 e 300 km/h; as leis de 4.6 são de níveis medidos, que já incluem esse efeito. (5) *Alocação:* ver acima. (6) *Bandas do carro e do avião pela Cena:* medidas com os motores adaptados ([Adaptadores de motor](#não-pode-piorar-cena-211-pela-cena-com-o-motor-adaptado)).

**Referências do legado** (`tools/cena/referencias/legado.json`, do commit `02c185f` por `git show`; `npx tsx tools/cena/legado.ts gravar` regrava, `valida.ts legado` confere): carro a 6 m (Camaro SS, 3000 rpm travado, 30 m/s): Doppler 217,7/182,6 Hz (teoria 219,2/183,9), bandas abeam, curva nível × x a cada 0,25 s, 1/3 de oitava de 400 Hz a 2,5 kHz; 737 a 1500 m e 300 km/h: bandas no ponto mais próximo e 10 s antes, 4 kHz a −21,6 dB de 500 Hz; F-16 a Mach 1,5 e 200 m: cone em 3,373 s (teoria 3,373), Δp 2270 Pa, T 79 ms. O `supersonico.ts` reproduz o instante do cone (3,3733 s) e Δp/T.

**Pendente (TODO):** os da lista em [Adaptadores de motor](#pendente-todo). Feitos depois: ponte calibrada, crossfade do lado do ouvinte (duas faces), reverberação na página e cena 3D; resolvedor supersônico no propagador, hélice idêntica e vias estruturais das fontes `dentro` (com os adaptadores de motor); o agudo da passagem.

### Trem contra gravações reais

O orçamento de níveis de 4.6 foi refeito contra passagens reais perto da via, a 265–320 km/h. As gravações não são calibradas: valem as formas e as razões, medidas em mono.

**Gravações usadas:**

| Trem | Velocidade (km/h) | Onde |
|---|---|---|
| E5 Hayabusa | 320 | estação |
| ICE 3 | 320 | estação |
| Velaro E | 300 e 265 | — |
| Velaro | 300 | — |
| Tohoku Shinkansen | ~300 | — |

**Descartadas** (com o motivo):
- ETR 500 e TGV Groß-Gerau: lentos demais.
- ICE Bitterfeld: sem nariz e sem cauda.
- TGV Boulogne: vento no microfone.
- Gravações de túnel: servem só para a onda de pressão.
- Trechos com narração ou música.

**Ganho automático:** quatro gravações ficam a ±0,5 dB durante o corpo, sinal de controle automático de ganho na câmera. Isso não muda o balanço espectral, mas comprime a profundidade da modulação.

**O que cada coluna mede:**
- **Balanço:** 2 s em torno do máximo, sem ponderação, em dB relativos à banda de 150–400 Hz.
- **E:** L(1–4 kHz) − L(150–600 Hz) durante o corpo. Estima o peso do rolamento contra o aerodinâmico.
- **Modulação:** envoltória RMS de 20 ms em 1–4 kHz durante o corpo. A tabela dá o pico da FFT entre 2 e 6 Hz e a profundidade p90 − p10.

| Caso | v (km/h) | v/L_c (Hz) | 60–150 | 400–1k | 1–2,5k | 2,5–6k | 6–12k | Centroide (Hz) | E (dB) | Modulação 1–4 kHz |
|---|---|---|---|---|---|---|---|---|---|---|
| Real: E5 Hayabusa, estação | 320 | 3,56 | −2,3 | +4,1 | +3,8 | −2,0 | −5,9 | 1461 | +1,4 | 3,67 Hz / 2,6 dB |
| Real: ICE 3, estação (vento < 100 Hz) | 320 | 3,58 | (+5,5) | −2,1 | −1,1 | −4,5 | −9,8 | 689 | −0,7 | 3,40 Hz / 4,9 dB |
| Real: Velaro E | 300 | 3,44 | (+6,7) | +4,1 | +5,2 | +0,6 | −2,9 | 1138 | +3,0 | 3,41 Hz / 3,2 dB |
| Real: Velaro E | 265 | 3,04 | −4,4 | −3,0 | +1,7 | +1,4 | −4,3 | 2216 | +0,9 | 2,99 Hz / 2,8 dB |
| Real: Velaro | 300 | 3,44 | −2,1 | +6,0 | +9,1 | +3,7 | −5,8 | 1715 | +7,4 | 2,89 Hz / 2,4 dB |
| Real: Tohoku Shinkansen | ~300 | 3,33 | −2,0 | +0,5 | +1,5 | −3,7 | −11,6 | 1145 | −0,2 | 3,46 Hz / 5,6 dB |
| **Média real** (5 limpas) | | | **−2,7** | **+2,3** | **+4,3** | **0,0** | **−6,1** | **1535** | **+2,5** | **±4% de v/L_c; 2,4–5,6 dB** |
| Simulado antes, 7,5 m | 300 | 3,33 | −1,8 | −2,5 | −6,3 | −10,0 | −16,9 | 548 | −6,6 | 3,32 Hz / 2,3 dB |
| Simulado antes, 3 m | 300 | 3,33 | −2,1 | −2,2 | −5,7 | −11,5 | −19,1 | 514 | −6,1 | 3,33 Hz / 4,8 dB |
| **Simulado agora, 7,5 m** | 300 | 3,33 | −2,0 | +2,0 | +1,9 | −0,3 | −9,8 | 1356 | +1,1 | 3,36 Hz / 3,1 dB |
| **Simulado agora, 5 m** | 320 | 3,56 | −3,4 | +0,1 | +0,2 | −3,2 | −12,0 | 1183 | −0,2 | 3,54 Hz / 3,3 dB |
| **Simulado agora, 3 m** | 300 | 3,33 | −4,8 | +0,2 | −1,0 | −5,3 | −14,1 | 1003 | −1,6 | 3,34 Hz / 3,6 dB |

Entre parênteses: vento no microfone (fora da média).

**O que mudou.**

**Forma do rolamento.** O passa-banda em 2,2 kHz com o polo em 7 kHz punha o pico de 1/3 de oitava em 3,2 kHz. Agora é um passa-banda em 1,5 kHz·√(v/v_ref) com um polo em 2,5 kHz·√(v/v_ref):
- em 1/3 de oitava dá −16/−8/−2/0/−4/−11 dB, de 250 Hz a 8 kHz;
- fica a 0,7 dB rms do rolamento das gravações.

Um ganho de 1/√k tira da lei de velocidade os ~1,4 dB que vinham da largura de banda crescendo com √v. A lei do rolamento passou de +9,3 dB (desvio) para +9,0 dB, dentro do alvo de +8 ± 1.

**Níveis** (`LW_TREM`, em dB(A)):

| Fonte | Antes | Agora |
|---|---|---|
| Rolamento | 123 | 130 |
| Aero do truque | 119 | 105 |
| Corpo | 122 | 119 |
| Nariz e cauda | 119 | 116 |
| Vãos | 119 | 119 (igual) |
| Pantógrafos | 115 | 115 (igual) |

Por que o rolamento subiu tanto: com os L_W de 4.6, o rolamento chegava a 7,5 m com só 92 dB(A), por causa da sombra do piso, contra os 97 da tabela.

Resultado a 7,5 m e 300 km/h:

| Parcela | dB(A) |
|---|---|
| Só rolamento | 98,8 |
| Aero | 95,8 |
| Total | 100,6 |

O total continua dentro do alvo de 100 ± 3 dB(A).

**Alvos atualizados** (`tools/cena/medidas.ts`, com a justificativa no código):
- **Balanço 60–150 Hz:** +4 → −3 ± 4 dB. As quatro gravações sem vento dão de −2,0 a −4,4.
- **Profundidade da modulação dos vãos:** ≥ 6 → ≥ 3 dB. Nenhuma das seis passagens chega a 6; elas dão 2,4–5,6 dB, com o pico a ±4% de v/L_c.

**O que as gravações não confirmam:**
- **Pulsos de vão em 50–200 Hz:** nenhuma gravação tem pico em v/L_c.
- **Crista:** o L_AFmax − L_Aeq das gravações é de 0,7–1,8 dB. Os 5 dB implícitos em 2.11 não aparecem.

Esses dois desvios continuam documentados.

**Diferença que fica:** a 3 m o simulado sai mais escuro que as gravações. A sombra do piso tira 9,8 dB do rolamento em 1 kHz a 3 m, contra 5,8 dB a 7,5 m, e as gravações provavelmente foram feitas mais longe da via.

**Efeito colateral:** a forma nova vale também para o rolamento da locomotiva (mesma classe `FonteRolamento`). O grupo `portadores` continua todo ok.

**Agudo da passagem (depois de ouvir).** O trem soava "sem qualidade, como gravado por celular antigo": faltava agudo. Medido no pico (2 s em torno do máximo, direto + reverberação, céu aberto, 300 km/h), as bandas 6–12 kHz e 12–24 kHz rel. 150–400 davam −14,1 / −24,2 dB a 3 m e −9,7 / −20,9 a 7,5 m. Os culpados:
- **O rolamento e o aero cortavam em 12 dB/oitava (PSD) acima de 3 kHz:** passa-banda com polo em 2,5 kHz, e polo do aero em 2,5 kHz.
- **O ar em `y += k·(x − y)` com o corte limitado a 0,45·fs:** ~2 dB em 16 kHz a 3 m, mais que a ISO.

Regra nova: as gravações (áudio comprimido; o YouTube corta em ~16 kHz e atenua antes) só são alvo até 6 kHz; acima vale a física. Até 6 kHz nada mudou na forma ajustada. As mudanças:

| Fonte | Antes | Agora (`src/carriers/ruido.ts`, `src/scene/propagador.ts`) |
|---|---|---|
| Rolamento | passa-banda 1,5 kHz·√k + polo 2,5 kHz·√k (1/3 de oitava 8 kHz −11, 16 kHz −22 dB do pico) | o mesmo + 2º ramo, o chiado do contato roda-trilho: passa-alta de 1 polo em 6 kHz·√k e polo em 10 kHz·√k, `G_CHIADO` 0,05 (8 kHz −11, 16 kHz −17: ~−6 dB/oitava, a queda de −3 a −6 dB/oitava acima de 2–3 kHz do rolamento na literatura, Thompson, *Railway Noise and Vibration*) |
| Aero (corpo, truques, nariz, cauda) | polo em 2,5 kHz (4/8/16 kHz a −13/−21/−32 dB do pico) | polo em 5 kHz (`F_AERO_POLO`: −10/−16/−26; o CENA 2.7 pede −3 dB/oitava até 2 kHz e −6 acima) |
| Pantógrafo (ruído largo) | 200 Hz–3 kHz (2ª ordem) | 200 Hz–6 kHz |
| Ar | 2 polos `y += k(x − y)`, corte ≤ 0,45·fs | 2 polos bilineares, transparentes perto (acima de 0,49·fs) |

**Resultado** (6–12 kHz / 12–24 kHz):
- 3 m: −12,2 / −20,3 dB;
- 7,5 m: −8,2 / −16,9 dB;
- túnel a 3 m e 350 km/h: −13,3 / −21,6 dB.

O grupo `niveis` guarda os dois primeiros (alvo ≈ −10 / ≈ −20 ± 4). Os outros alvos do trem continuam passando:
- balanço 2,5–6k −4,7, 6–12k −11,8;
- L_Aeq,tp a 7,5 m de 100,7 dB(A).

As respostas ao impulso não eram o problema: `gerarRespostaPorBanda` usa a banda inteira (a de cima é um passa-alta de 4 kHz até Nyquist) e o convolver não filtra (o corte do molhado na Passagem é 20 kHz).

## Página Passagem e modo de testes

`passagem.html` e `src/pages/passagem/` formam a interface da Cena nova (CENA.md 3). Um portador passa pelo ouvinte: o trem de N vagões (sem motor ou com a tração elétrica), o helicóptero (pistão de aviação, radial, rotativo ou sem motor), o carro (Ronco, Diesel, radial, rotativo, elétrico ou o Stanley a vapor), o avião de hélice (turboélice, radial, pistão de aviação ou rotativo), o gerador (Diesel, X-Engine ou o Corliss), a locomotiva (Diesel ou a vapor), o avião a jato (Turbina), o trator e o barco a vapor e o drone, com os motores pelos [adaptadores](#adaptadores-de-motor). São 10 portadores e 29 presets de passagem (`PORTADORES` e `PRESETS_PASSAGEM` em `presets.ts`). O ouvinte fica parado junto à via ou num gimbal 3D em torno do corpo, e há uma cena three.js. O padrão é o das outras páginas: estado e mensagens fora do React, painel com os componentes de `src/ui/`, mostradores em canvas e um único `requestAnimationFrame`.

| Arquivo | O que faz |
|---|---|
| `controle.ts` | `ControlePassagem`. Guarda o estado e manda as mensagens ao worklet. Monta a sonda do portador na thread principal: geometria, lista de fontes e calibrações. Cuida de disparar e parar, dos atalhos do gimbal, do "voltar ao padrão" e da geometria do ouvinte no mundo |
| `presets.ts` | Portadores, motores com adaptador, ambientes, solos, os padrões do trem e os presets de passagem |
| `Painel.tsx`, `PaginaPassagem.tsx` | Painel, barra, presets, vista 3D, telemetria e gráficos |
| `cena3d.ts`, `cena3d-cores.ts` | Cena three.js, num chunk próprio carregado sob demanda |
| `mostradores.ts` | Nível no ouvido, telemetria em texto, HUD, onda de pressão, espectrograma e osciloscópio |
| `tools/passagem-navegador.mjs` | Teste da página no navegador |

**Áudio.**
- `AudioShell` usa o `PERFIL_PASSAGEM`, o processador `cena` (`CenaDSP`) e o medidor.
- **Escala absoluta:** o perfil não tem ganho de saída, e o compressor só limita a −1 dBFS (20:1), para o nível continuar o da física.
- **Calibração fora do worklet:** a página calcula as calibrações das ~55 fontes do trem (`Trem.calibracoes()`, ~30 ms) e as manda prontas em `config.calibracao`. Calibrar dentro do worklet cortaria o áudio.
- **Duas faces:** a página monta o trem com `faces: 'duas'`. A camada limite muda de face com o crossfade de 50 ms quando o ouvinte troca de lado, o que acontece no gimbal e na volta.
- **Reverberação:**
  - vem de `aplicarRespostaPorBanda`: resposta de `gerarRespostaPorBanda` com energia 1, `normalize = false`, molhado √`reverb.wet` e seco `reverb.dry`;
  - as respostas ficam guardadas por ambiente;
  - o "RT60 (× do lugar)" do modo de testes multiplica as quatro bandas.

**Mensagens para o worklet.**

| Mensagem | Conteúdo | Quando |
|---|---|---|
| `portador` | `trem`, `rotor`, `carro`, `helice`, `gerador`, `locomotiva`, `aviao`, `trator`, `barco` ou `drone`, com a configuração; com motor, `motor: { familia, cfg }` (calibrado na página) e o `comando` inicial | Mudança estrutural: N, passo, vão, nariz…, troca de motor ou de preset |
| `cena` | Ambiente, trajetória e ouvinte | A cada mudança; o worklet faz rampas de 20 ms |
| `comando` | Velocidade fixa, coletivo, pedal, marcha, notch, degrau de carga | Ao disparar, parar e mudar a velocidade ou o comando do motor |
| `params` | `master` e `posicao` | `posicao` chama `CenaPassagem.reposicionar` |
| `ar` | Umidade e temperatura | Ao mudar o ar |

Arrasto e sliders contínuos marcam a cena como pendente. `enviarPendentes()` manda no máximo uma mensagem por quadro.

**Passagem.**
- **Disparar:** põe o nariz a `x0` m antes do ouvinte (600 m no trem) e liga a velocidade fixa. `reposicionar` recomeça o histórico de poses e zera a onda do túnel.
- **"Uma vez":** depois de a cauda se afastar 800 m (no máximo meia via), o corpo para longe, inaudível.
- **"Repetindo":** o corpo segue. A reta "reaparece do outro lado" e o túnel dispara de novo, porque `CenaPassagem` reduz o nariz à via.
- **Teclas:** <kbd>Espaço</kbd> dispara ou para, <kbd>R</kbd> alterna repetir, <kbd>G</kbd> alterna o gimbal e <kbd>C</kbd> troca a câmera, com a cena em foco.

**Portadores e compatibilidade.**
- Os portadores aparecem pela tabela `COMPAT` (CENA 1.6, mais o `aviao`, o `trator`, o `barco` e o `drone`).
- Um portador fica habilitado quando alguma família de motor dele tem adaptador (`MOTORES_PRONTOS` = `ADAPTADORES` de `compat.ts`: nenhum, pistão, diesel, turboélice, turbina, radial, rotativo, elétrico e vapor) e foi usada nele de verdade (`USO_REAL`), e o `CenaDSP` sabe montá-lo (`PORTADORES_NO_DSP`: trem, rotor, carro, hélice, gerador, locomotiva, avião, trator, barco e drone). Hoje os dez estão habilitados.
- O rotor leva o pistão de aviação do Ronco (R22, R44, Bell 47, Schweizer 300), o radial do S-55 ou o AE50R do Camcopter, ou fica sem motor (Nr imposto). A Turbina não tem turboeixo.
- **Motor:** a seção "Motor" do painel escolhe o preset da família, sem duplicar os painéis completos (escape, admissão, mixagem ficam na página do motor):
  - os 68 do Ronco no carro, e os 10 de aviação na hélice e no rotor;
  - os diesel do uso (carro, gerador, locomotiva);
  - os radiais, os rotativos (menos o motor de palhetas), os a vapor e os elétricos, cada um nos portadores do campo `portadores` (ou `portador.tipo`) do preset;
  - os turboélices;
  - os jatos.

  Ela também dá o comando do portador: acelerador e marcha da passagem no carro, manete, notch, degrau de carga. No carro, a família (pistão ou diesel) se troca nos chips "Motor".
- **Calibração na thread principal:** `prepararMotorRonco`, `prepararMotorDiesel`, `prepararMotorRadial`, `prepararMotorRotativo`, `prepararMotorEletrico` e `prepararMotorVapor` (calibração e sonda do nível absoluto, ~1–2 s), guardada por preset. A página monta o mesmo portador que o worklet para ter a geometria e as fontes.
- **Mensagem:** `{ type: 'portador', tipo, config, motor: { familia, cfg }, comando }`.
- **Presets com motor:**
  - "Carro na rua a 6 m" (Camaro SS, 3ª, pé no fundo, 108 km/h);
  - "Picape diesel passando" (Hilux, 4ª, 80 km/h);
  - "Turboélice rasante" (ATR 72 em decolagem a 100 m);
  - "Locomotiva EMD em N8 passando" (40 km/h a 15 m);
  - "Gerador em bancada" (500 kVA, 50% de carga, 7,5 m);
  - "Jato a 1500 m" (737);
  - "Caça supersônico a 200 m" (F-16 a Mach 1,5, com o estrondo).

  Esses foram os da etapa dos adaptadores. Depois entraram: "Helicóptero R44 sobrevoando" com o O-540; Corsair, Yak-52, P-47, Sherman e Cessna 172 (radial e aviação); RX-7 na rua, 787B em Hunaudières e RQ-7 Shadow (rotativos); Pacific a 100 km/h, Big Boy arrancando e Maria Fumaça na estação (vapor); Tesla na rua, Taurus partindo, metrô chegando na estação, N700 no túnel e drone pairando (elétrico). Sem motor ficam quatro trens (trem-bala a céu aberto e no viaduto, convencional na estação, regional no corte).
- **Padrões por portador** (`PADROES`, CENA 3.1): carro em volta de 800 m com curvas de 60 m; locomotiva em volta de 2000 m e raio de 400 m; hélice, helicóptero e avião em reta de 6000 m a 150 m; trator em reta de 600 m a 6 km/h; barco a 20 m da margem; drone a 10 m de altura. Os presets de passagem andam numa reta.

**Ouvinte.**
- **Parado junto à via:** posição ao longo da via, altura do ouvido e distância à lateral.
- **No gimbal:** azimute, elevação e distância em torno do centro do corpo ou de uma fonte (`alvo`). Os limites são os de 3.2.
- **Atalhos** (3.2): resolvidos para as fontes do portador.

  | Atalho | Posição |
  |---|---|
  | Frente | 3 m à frente do nariz |
  | Lateral | 90°, 5 m |
  | Câmera atrás | atrás da cauda |
  | Cabine | ponto dentro do primeiro vagão; o local automático vira `cabine` |
  | Sobre o pantógrafo / sobre o rotor | 1 m acima, a 89° |
  | Escape, ponteira, cofre | desabilitados no trem sem motor (não tem escape nem fonte `dentro`) |

- **Filtro do local:** os de 3.3, aplicados pela Cena (`RegrasLocal`).
  - **Fora:** diretividade × sombra × propagação, mais ITD/ILD.
  - **Cabine:** lei da massa e ressonância do habitáculo.
  - **Cofre:** fontes de dentro diretas.
  - **Ponteira:** só a fonte alvo, as outras −20 dB.
  - **Automático:** a página mostra o local resolvido com a mesma regra da Cena.

**Modo de testes.** Todos os parâmetros da tabela 3.1 ficam livres:

| Grupo | Parâmetros |
|---|---|
| Trajetória | tipo, comprimento (200–20 000 m), raio, lateral, altitude, sentido |
| Passagem | velocidade, distância de partida |
| Ambiente | solo, RT60, seção, comprimento e boca do túnel |
| Ar | umidade (absorção ISO 9613) e temperatura (velocidade do som da propagação, 343 m/s a 20 °C; a absorção fica a de 20 °C) |
| Trem | vagões, passo, vão, posição do truque, nariz, c_p do nariz, largura, altura, pantógrafos, carenagem |

- **Vagões:** o limite vem do orçamento de 64 fontes da Cena (`maxVagoes`: 12 com duas faces e dois pantógrafos).
- **Aero do truque:** sai do orçamento quando não cabe. Fica 25 dB abaixo do rolamento, então não se ouve.
- **"Voltar ao padrão":** devolve os valores do CENA para o portador. No trem: reta de 3000 m, 3 m da lateral, 350 km/h, túnel, umidade de 60%, 20 °C, 10 vagões de 25 m.

**Cena 3D** (3.4).

*Carga.* A cena é carregada por `import('./cena3d')`, num chunk de 600 kB com o three.js. Ela nunca segura o áudio: se o WebGL faltar, a página segue com os mostradores e um aviso.

*Cenário.*
- Mundo em metros, com z para cima.
- Chão com grades de 10 m e 100 m, na cor ou textura do solo. As texturas são CC0 da Poly Haven (`public/3d/LICENSES.md`).
- Via com trilhos e dormentes a 0,6 m. No ar, a via vira uma linha tracejada na altitude.
- Ambientes: túnel semitransparente da seção do ambiente; estação com plataforma, cobertura a 7 m e pilares; corte com taludes a 45°; ponte com tabuleiro de 3,7 m, pilares e vale.

*Corpo.*
- Trem por segmento, com o vão entre eles. A geometria é parametrizada: seções de superelipse, nariz e cauda afilados em bico de pato, faixa e janelas.
- Truques, pantógrafo em "Z" com a carenagem, e o rotor com disco e pás.
- Fantasma translúcido na posição de emissão da fonte escolhida: `s − v·τ`.

*Fontes e ouvinte.*
- Esferas das fontes coloridas por tipo, com raio `0,15 + 0,25·clamp((g + 40)/40)`.
- Cabeça com nariz para o alvo, anel do azimute, arco da elevação e linha tracejada com a distância.
- Alças da lateral e da altitude, e o ponto mais próximo da via.
- HUD com v, distância de cada grupo de fontes, pressão, vento, dB(A) e Doppler.

*Câmera.* Três modos: no ouvinte (padrão), seguindo o corpo, e livre.

*Arrasto.* Por raycast, com passo de 5° e 0,5 m.

| Peça | O que muda |
|---|---|
| Cabeça | parado: x e lateral, e altura com Shift; gimbal: azimute e distância, e elevação com Shift |
| Anel | azimute |
| Arco | elevação |
| Linha | distância |
| Corpo | `s`, ao longo da via |
| Seta verde | lateral |
| Seta azul | altitude |

Um clique numa esfera faz da fonte o alvo do gimbal e mostra a ficha dela: tipo, posição, `refDist`, diretividade, ganho, distância e atraso.

*Desempenho.* Cerca de 30 fps, sem sombras dinâmicas. A posição do corpo é interpolada da telemetria, que chega a cada 1024 amostras.

**Mostradores.**
- **Nível no ouvido:** um analisador lê a soma seco + molhado antes do compressor, com FFT própria de 8192 pontos (Hann) e ponderação A analítica. Vai para dB SPL pela escala absoluta: 124 dB SPL − 20·log₁₀(master). Isso inclui o campo reverberante, que o `splDbA` da Cena (só o direto) não tem.
- **Telemetria:**
  - posição do nariz em relação ao ouvinte;
  - velocidade;
  - Doppler da fonte escolhida, ou da mais próxima: f′/f = 1/(1 − M·cos θ_e), com θ_e da telemetria;
  - pressão de nariz e cauda, e o pico do intervalo;
  - onda de compressão do túnel, em kPa;
  - vento;
  - local e face do trem.
- **Onda de pressão:** 11 s de histórico, com os extremos de cada telemetria (o pico de 41 ms do nariz não se perde) e as parcelas de nariz e cauda e do túnel.
- **Espectrograma, espectro e osciloscópio:** do analisador da saída.

**Teste** (`npm run navegador:passagem [-- url] [--firefox] [--reserva] [--foto arq.png]`). Sem url, o teste serve o `dist/` em `http://127.0.0.1:<porta>/data/engine/`. O roteiro confere:
1. **Estrutura:** presets, portadores pela compatibilidade, seções, os 22 sliders do modo de testes, atalhos e cena 3D desenhando.
2. **Passagem no túnel:** dispara o trem-bala a 350 km/h e confere:
   - o AudioWorklet e as mensagens (trem de 10 vagões com duas faces e calibrações, túnel com a boca a 500 m);
   - a reverberação por banda com `normalize = false`;
   - a onda de compressão de ~2 kPa (medido 1996 Pa), chegando 3,7 s antes do nariz;
   - a onda de nariz pico a pico (153 Pa);
   - o nível no ouvido (111–112 dB(A));
   - as leituras e o HUD.
3. **Gimbal:**
   - atalho lateral, com os sliders acompanhando;
   - elevação;
   - arrasto da cabeça na cena com o mouse de verdade (o worklet recebe);
   - atalho da cabine, que vira o local `cabine`;
   - ficha da fonte.
4. **Ambiente:** a troca manda a mensagem e gera uma resposta ao impulso nova.
5. **Parâmetros do modo de testes:** lateral e número de vagões (o trem é montado de novo).
6. **Céu aberto:** passagem repetindo.
7. **Câmeras e helicóptero.**
8. **Carro na rua:** o preset monta o carro com o Ronco calibrado na página (`kAbs`), a seção Motor lista os presets do Ronco, a passagem anda a 108 km/h em 3ª com o motor preso às rodas (3997 rpm) e o ouvido chega a 88,8 dB(A).
9. **Locomotiva:** o EMD 710 (uso locomotiva) sobe ao notch 8 (881 rpm) e o ouvido chega a 88,4 dB(A).
10. **"Voltar ao padrão".**
11. **Console sem erros.**

**Resultado:** passa em Chromium (worklet e reserva) e em Firefox.
## Adaptadores de motor

Os motores existentes entram na camada cena/portador por adaptadores `Motor` (CENA.md 1.3), sem mudar o som das páginas Ronco, Turbina e Diesel: os DSPs ganharam só um gancho de leitura, `this.tap` (null nas páginas), e os adaptadores leem os sinais que já existem antes da mistura do ouvinte. Portões: `npm run paridade:ronco` (200 cenários), `paridade:turbina` (34 aviões e os extras) e `paridade:acoustics` idênticos; `teste:diesel` sem falha nova.

| Arquivo | O que faz |
|---|---|
| `src/engines/ronco/dsp.ts` | Gancho `tap`: `ponteira(i, e, x)` e `jato(i, x)` no laço dos radiadores, `gravar(s, kEx, inP, inH, mech, vib, tur, sc, brk)` depois das escalas do ouvinte. Seis linhas, só leituras |
| `src/engines/turbina/dsp.ts` | Gancho `tap`: `helice(e, x)` (o tom da hélice de cada motor) e `gravar(i, bi)` (os barramentos antes da propagação). Cinco linhas |
| `src/engines/ronco/motor.ts` | `TapPistao`, `MotorPistaoBase`, `MotorRonco`, `fontesPistaoCarro`, `prepararMotorRonco`, `sondarNivelRonco` |
| `src/engines/diesel/motor.ts` | `MotorDiesel` (herda a base), `prepararMotorDiesel`, `sondarNivelDiesel`, fontes do gerador e da locomotiva |
| `src/engines/turbina/motor.ts` | `MotorTurbina`: os barramentos do `flyby` como fontes, a velocidade do portador como `vFly` |
| `src/carriers/carro.ts` | `CarroLegado`: o câmbio e o carro de dentro do DSP (decisão 1.1.5) |
| `src/carriers/aviao.ts` | `Aviao`: a fuselagem do jato em passagem |
| `src/scene/estrondo.ts` | O estrondo do JetDSP (`triggerBoom`/`boomSample`), copiado com a mesma aritmética |
| `tools/cena/motores.ts` | Grupos `motores` e `niveis-motores` do `teste:cena` |

### Canais e posições

**Ronco e Diesel no carro** (Pa a 5 m; posições no referencial do motor, que fica em `[1,6; 0; 0,7]` dianteiro, `[−0,5; 0; 0,6]` central e `[−1,8; 0; 0,6]` traseiro):

| Fonte | Sinal | Peso de fora | Diretividade | Vias (cabine; cofre) |
|---|---|---|---|---|
| `escape.k` (uma por radiador, inclusive o da válvula) | `x` do radiador sem o `radSh` | `exScale·P.exhaust` | `[0, −0,4, −1,7, −3,9, −6,9, −9,9, −11,3]` atrás → frente e passa-baixa por ângulo `900 + 15000·traseira²` | — (cabine pela casca do carro) |
| `admissao` (dentro) | `inP + inH` | 0,12·c | frente (dianteiro) ou trás | 0,35·lp 900; 1,0 |
| `bloco` (dentro) | `mech` | 0,1·c | idem | 0,2·lp 1200; 0,7 |
| `vibracao` (dentro) | `vib` | 0,1·c | idem | 1,2; 0,8 |
| `compressor` (dentro, só com compressor mecânico) | `sc` | 0,8·c | idem | 0,25; 0,8 |
| `turbo` (dentro, com turbo ou diesel) | `tur` | 0,2·0,73 | frente | 0,25; 0,8 |
| `coletor` (dentro, só com coletor que vaza) | `brk` | 0,7 | a do escape | 0,2·lp 900; 1,0 |

- **Pesos de fora:** os do `road()` legado, a passagem que a Cena substitui. O que sai do cofre de um motor dianteiro irradia para a frente com (0,5 + 0,3·cosθ), e o escape (com o cofre de um motor central ou traseiro) para trás com (0,3 + 0,8·traseira). Isso vira diretividade e o canal fica no nível do eixo, relativo ao escape: c = 0,8/1,1 na frente, 1 atrás.
- **Escape sem o `radSh`:** o reforço de +3 dB em 110 Hz dos microfones junto ao carro é a imagem no asfalto, e a Cena calcula a imagem (2.4). O `x` antes do `radSh` sai de uma cópia do passa-alta de 45 Hz do radiador; o chiado de jato é somado de volta pela diferença.
- **Tabela do escape:** a do CENA 1.3 está na convenção do `DIR` (0° = frente). Lida com o eixo para trás, o escape soprava para a frente, então ela vai invertida. A usada é a do `road()` (até 2,7 dB acima da do CENA na frente), para a curva nível × x ficar a ±1 dB do legado.
- **Passa-baixa por ângulo** (`FonteSonora.agudo`, extensão): o `shade` do `road()`, que nenhuma tabela de ganho reproduz. No propagador entra como um teto no corte do ar.
- **Ponteiras no eixo** (y = 0), como no `road()`, que soma as bancadas em mono. Com cada ponteira no seu lado (±0,55 m), a diferença de caminho de lado (~1,1 m) tira o cancelamento da 2ª ordem entre as bancadas de um V8 cruzado, e 60–150 Hz sobe 5,7 dB a 6 m. É mais físico, mas fica fora da tabela "não pode piorar": fica para quando houver gravação de passagem lateral para decidir.
- **Vias estruturais** (`FonteSonora.vias`, extensão; CENA 3.3): na cabine e no cofre, as fontes com vias não chegam pelo ar, só pela via, mono nos dois ouvidos e sem propagação, com os pesos do `int` e do `bay` divididos pelo peso de fora. A cabine do carro usa o filtro do Ronco (`Corpo.cabine`, extensão: lp 420 + lp 1100 + pico de 70 Hz +7 dB), com o ganho 0,6·2,2/5: o `int` leva 0,6 do escape a 5 m e a Cena propaga ~2,2 m da ponteira ao ponto da cabine.
- **Fora, a diretividade vale também para as fontes `dentro`** (3.3: "fora, aplicam-se sempre"). As dos portadores são omni, então nada mudou neles.

**Diesel fora do carro** (gerador, locomotiva): os mesmos canais, mas a ponteira vira a chaminé no teto, omni (a boca de 0,45 m do EMD é pequena perto dos 1,4 m de onda da ignição em 240 Hz). Ela fica a +1,4 m do motor no gerador e a +3,0 m na locomotiva, 0,5 m acima do teto da caixa: rente a ele, a borda fazia ~8 dB de sombra a 15 m. As fontes do cofre também são omni.

**Turbina** (Pa a 30 m, como o JetDSP calcula): no `flyby` legado cada fonte tem diretividade 1 e a do barramento inteiro é aplicada na propagação. O adaptador põe o JetDSP nesse modo, com altitude de 10 km para os atrasos dele não custarem, e lê os barramentos. Cada grupo de motores (lado esquerdo e direito) vira duas fontes:

| Fonte | Posição | Diretividade (0° = nariz) |
|---|---|---|
| `admissao.g`, ou `helice.g` no turboélice | `x + 1,5` | `DIR.inlet` (ou `DIR.prop`) |
| `jato.g` | `x − (3 + 4·Dj)` | `max(DIR.jetL, 0,55·DIR.jetF, 0,5·DIR.shock)` |

- **Convecção:** |1 − M·cosθ|^−1,4 nos dois, como no legado.
- **Por fonte:** a separação do CENA 1.3 (bypass, núcleo, crepitar, reversor, cada um com a sua diretividade) pede um gancho por fonte. Fica para quando o gimbal de perto de um jato precisar.
- **Velocidade:** a do portador vira o `vFly`, como no flyby: Mach na ponta do fan, jato relativo ao ar, hélice com o avanço.

### Carga e comando (CENA 1.6)

| Portador | Motor | Pedal | O que o motor recebe |
|---|---|---|---|
| carro (`CarroLegado`) | Ronco, Diesel | acelerador | `acelerador`; câmbio, embreagem, massa e arrasto de dentro do DSP |
| hélice | turboélice (JetDSP) | manete | `acelerador`; a hélice e o governador de `np` são os do JetDSP |
| gerador | Diesel (`gerador`) | degraus de carga | `rpmAlvo` da rede; carga `P/(η·ω)` do portador |
| locomotiva | Diesel (`locomotiva`) | notch | `rpmAlvo` do notch; carga do gerador de tração do portador |
| avião | Turbina | manete | `acelerador` |
| rotor | pistão de aviação (R22, R44, Bell 47, S300), radial (S-55) ou nenhum | coletivo | `combustivel` do governador do rotor vira o acelerador (Kp 0,12× o de bancada); sem motor, Nr imposto |
| hélice | radial ou pistão de aviação | manete (e `rpmAlvo`, a manete de passo) | `acelerador`; a carga da hélice no eixo, com o governador de passo do portador |

- **Velocidade imposta no carro:** com `velocidadeFixa` (a passagem disparada), o `CarroLegado` impõe a velocidade dentro do DSP a cada bloco. Com uma marcha engatada, o motor fica preso às rodas, como num dinamômetro de rolo: em 3ª e pé no fundo, o Camaro segura 3996 rpm a 108 km/h. Parado, a página manda ponto morto e lenta. A marcha escolhida trava o automático (`shiftCool`).
- **Governador do motor** (`Motor.governadorProprio` e `ComandoMotor.rpmAlvo`, extensões): o diesel em gerador e locomotiva usa o isócrono dele, acertado por motor (Kp = ω_c/P), e o portador manda só o alvo. O DSP fica no modo do uso, e a carga externa substitui a interna em `cargas()`. O PI do portador (CENA 4.4/4.5) foi acertado com o `MotorTeste` e, num diesel de verdade, fazia um ciclo-limite:
  - grupo de 500 kVA: ±2–3% em vazio;
  - EMD em N4: combustível entre 0,1 e 0,9 a 1 Hz.

  Com o isócrono do diesel:
  - degrau de 50% no QSX15: queda de 3% e volta em ~3 s;
  - EMD: sobe a N8 em ~7 s, 100 rpm/s;
  - em N8 o EMD fica em 883 rpm (−2,3%) com o combustível saturado: o regulador de carga do portador só corta abaixo de 90%.

  Para motores sem governador próprio, `ganhoRelativo` (carriers/base.ts) escala Kp e Ki pela planta, (T/J) da bancada sobre (T/J) do motor, e pela metade (atraso de combustão e turbo).
- **O disjuntor do gerador** só fecha com o grupo funcionando acima de 90% da rotação. Dar a partida com a carga ligada pede P/ω com ω ≈ 0: o motor de partida não saía do lugar.
- **O alternador entra com o campo** (50–90% da rotação).
- **Piso de −50 dB na ponderação A** em `calibrarSerieA`: com a rotação perto de zero, as séries pediam amplitudes enormes em poucos Hz (137 dB SPL de infrassom na partida do gerador).
- **Fonte do motor substitui a própria de mesmo id:** a fonte `turbo` do EMD (o turbo do DieselDSP) tira a `turbo` da locomotiva, e a `helice.g` do turboélice tira a `helice` do portador.
- **Carga no eixo (gancho 11 do RADIAL.md, etapa 3):** os motores de aviação do Ronco (`aviation`) e o radial recebem a carga do portador no virabrequim (`T_carga`, `J + inércia`); no carro ela continua sendo o câmbio de dentro, e `acoplar` só guarda a carga.

### Hélice idêntica

Com um turboélice acoplado, a hélice é a do próprio JetDSP (`helice.g`). Sem ele (ou com outro motor, na etapa 3), o portador usa a `FonteHelice`, com a mesma aritmética:
- `tabelaPassagemPa` é o `buildPropTab` com a mesma tabela de seno;
- o tique de controle a cada 64 amostras com as amplitudes de `sources()`;
- a tabela é refeita a cada 8 tiques;
- desbalanceamento de 1ª e 2ª ordem;
- ruído largo de pá normalizado pela banda.

**Prova** (`motores`): o tom da hélice do Caravan (1 motor, decolagem a 300 km/h, 6 s) tirado do JetDSP pelo gancho e a `FonteHelice` alimentada tique a tique com as mesmas entradas (np, potência, reverso, velocidade, diretividade) e a mesma fase inicial saem **idênticos nas 288 000 amostras**. O ruído largo tem o mesmo filtro e o mesmo nível, com outra semente.

### Supersônico e estrondo

Com M ≥ 0,9 numa reta, a Cena liga no propagador o resolvedor fechado (`trechoSuper`, com `raizesEmissao` de `supersonico.ts`). Ele trabalha por fonte e por caminho (direto e imagem):
- até duas raízes por caminho, com o slot de cada uma como no legado (a de maior atraso toca de trás para frente);
- atraso e ganho em rampa linear no trecho;
- convecção limitada a 4;
- diretividade pelo ângulo de emissão;
- ar pelo caminho mais curto;
- sem ITD/ILD (o flyby não tem).

O avião guarda o anel inteiro (`anelCompleto`): atrasos de vários segundos. Quando o cone de Mach da primeira fonte alcança o ouvinte (o critério do `geom()` legado), a Cena dispara o `Estrondo`, com o comprimento e o fator de forma do avião, e soma a onda em N na saída em unidades do alto-falante, como o legado.

### Nível absoluto

A sonda roda na thread principal, junto com a calibração (página: `prepararMotorRonco` / `prepararMotorDiesel`, guardados por preset):
- **Ronco:** a condição de referência do `calibrate()`: escape de referência, 55% da faixa vermelha, borboleta aberta, turbo a 40%, motor quente. `kAbs` leva a soma das ponteiras a **95 dB SPL a 5 m** em campo livre. O CENA fixou 100; com 100, o Camaro em carga a 6 m dava 94 dB(A). A lenta mantém o reforço da calibração (`mk`, 21 dB abaixo da carga).
- **Diesel no carro:** a mesma convenção, com a sonda `sonda0` do próprio DieselDSP (DIESEL.md 6.3).
- **Diesel em gerador e locomotiva:** `L_W` dB(A) do escape + bloco em plena carga na rotação de potência. Os valores são 118 no gerador e 128 na locomotiva, do limite de 87 dB(A) a 30 m da 40 CFR 201.
- **Turbina:** sem retoque. O JetDSP já é "Pa a 30 m", mas a página dele normaliza a saída e o absoluto nunca foi conferido (ver a tabela).

### Não pode piorar (CENA 2.11), pela Cena com o motor adaptado

| Caso | Alvo | Medido |
|---|---|---|
| carro a 6 m (Camaro SS, 3000 rpm travado, 30 m/s): Doppler da ignição | 219 ± 1 / 184 ± 1 Hz | 219,1 / 184,0 Hz |
| idem: bandas abeam (dB rel. 150–400) contra o legado | ±1,5 dB | Δ −1,3 / 0 / +1,2 / +0,6 / +0,1 / +0,1 |
| idem: curva nível × x (relativa ao pico) contra o legado sem o som de fundo | ±1 dB (rms) | 0,96 dB rms; chegando +1,4, indo −0,1 (a convecção de 2.1 a 30 m/s dá 1,5 dB entre os dois) |
| avião a 1500 m (737, 300 km/h): bandas 10 s antes | ±2 dB | Δ +2,1 / 0 / +0,3 / +1,1 / +0,6 / +1,4 (**desvio**) |
| idem, no ponto mais próximo | ±2 dB | Δ −0,9 / 0 / +1,5 / +1,9 / **+2,6 / +3,8** (**desvio**) |
| idem: 4 kHz rel. 500 Hz no ponto mais próximo | ≤ −20 dB | −20,5 dB (legado −21,6) |
| estrondo (F-16, M 1,5, 200 m): instante do cone, Δp e T | 3,373 s ± 1 ms; 2269,7 Pa; 0,079 s | 3,3733 s; 2269,708 Pa; 0,079 s |
| hélice idêntica (Caravan, 6 s) | amostra a amostra | idêntica (288 000 amostras) |

**Desvios do avião e por quê:**
- **Acima de 2,5 kHz a Cena fica mais clara no ponto mais próximo.** É o ar: dois polos no `f_c(r)` da ISO (2.3: 680 Hz a 1500 m) contra os dois polos em 900 Hz do flyby. Os 900 Hz são o piso da fórmula dele, e ele usa o mesmo corte a 1500 e a 1750 m.
- **Teste trocando só o corte pelo do legado** (sem solo): a diferença cai para ≤ 1,2 dB de 60 Hz a 2,5 kHz e 0,9 dB em 2,5–6 kHz.
- **Os 2,1 dB em 60–150 Hz 10 s antes** são o pente denso do solo (Δr ≈ 3 m) numa janela de 2 s.
- **2.3 manda registrar:** na etapa 1 o legado vale por definição. Os dois absorvem bem menos que a ISO, que pede −50 dB em 4 kHz a 1500 m.

**Escolhas do teste do avião:**
- ouvinte sem binaural (o flyby não tem ITD/ILD) a 1,7 m;
- solo de grama;
- c = 340 m/s (ar a 14,9 °C), a velocidade do som da Turbina.

**O estrondo:** com o mesmo c, a fonte na altura do flyby (z = 0 é a linha dos motores) e o tique de 128 amostras do legado, o instante, o Δp e o T saem iguais.

### Níveis absolutos (grupo `niveis-motores`; céu aberto, sem reverberação nem fundo)

| Caso | Alvo e fonte | Medido |
|---|---|---|
| carro a 6 m em carga: Camaro SS, 3ª, pé no fundo, 108 km/h (3996 rpm), L_AFmax | 85–90 dB(A) (alvo da validação) | 89,1 dB(A) |
| Hilux 2.8 em lenta (778 rpm), parada, a 1 m atrás da ponteira, L_Aeq | ~70 ± 3 dB(A) (alvo da validação) | 68,8 dB(A) (a 7,5 m da lateral: 46,8); era 66,7 (desvio) antes da 2ª passada do Diesel |
| EMD SD70ACe em N8 (883 rpm), parada, a 15 m, L_Aeq | ~95 dB(A): 40 CFR 201.12 (locomotivas paradas fabricadas depois de 1979, plena potência: 87 dB(A) a 30 m) mais 6 dB | 88,8 dB(A) (**desvio**) |
| ATR 72 em decolagem (manete 1, 60 m/s) a 100 m de altura, L_AFmax | ~85 dB(A): certificação de ruído do ATR 72 (ICAO Anexo 16, ~84 EPNdB no ponto lateral a 450 m) | 95,0 dB(A) (**desvio**) |

**Desvios dos níveis:**
- **Hilux (já não é desvio):** a picape segue a convenção do carro. Com a referência de 95 dB, que acerta o Camaro, a lenta dela ficava 3 dB abaixo do alvo (66,7); depois que o pulso do escape do diesel passou a `∝ √T` (2ª passada) ela mede 68,8, dentro dos ±3.
- **EMD:** o escape está no `L_W` de 128 dB(A), 103 dB(A) a 5 m (conferido canal a canal). A 15 m, a chaminé 0,5 m acima do teto fica rasante à borda da caixa, e a sombra (Maekawa) tira ~4 dB: sem ela, 92,6. O resto é a distância real da chaminé (17 m) e a brita, que reflete pouco acima de 800 Hz. A 40 CFR mede a 30 m, onde o ângulo sobre a borda é mais aberto.
- **ATR:** o nível é o do JetDSP. A hélice é 9·(M/0,75)⁴ Pa a 30 m, 113 dB por motor na decolagem, ~10 dB acima do que a certificação sugere. O 737 do mesmo modelo dá 112,5 dB a 30 m por barramento, também alto. Corrigir a escala da Turbina muda o mostrador de dB da página Turbina: fica para a revisão de níveis dela.

### Pendente (TODO)

- Fontes da Turbina separadas por fonte, com a diretividade de cada uma (o gimbal de perto de um jato).
- Turboeixo: não há preset com `arch: 'turboeixo'` na Turbina; o rotor só tem os motores a pistão, radial e rotativo (ou nenhum).
- Escala absoluta da Turbina (o ATR sai ~10 dB alto).
- Referência própria para o diesel leve no carro, com gravações calibradas (a lenta da Hilux hoje cai no alvo com a referência do Ronco: 68,8 contra ~70 dB(A)).
- Ponteiras nos lados reais, se gravações laterais confirmarem a 2ª ordem do V8.
- Pneus e aero do carro (4.1, desligados por padrão).
- Casca do gerador com carenagem: a lei da massa sobre as fontes `dentro` em `fora`, que a Cena ainda não aplica (o campo `carenagem` de `src/carriers/gerador.ts` existe e não é lido em lugar nenhum).

## Diesel: ignição por compressão

O projeto está em [`DIESEL.md`](DIESEL.md); aqui fica o que foi feito, como e o que se mediu. Página `diesel.html` (`src/pages/diesel/`), DSP em `src/engines/diesel/`, worklet `src/worklet/processador-diesel.ts` (`diesel-engine`).

### Como estende o Ronco

`DieselDSP extends EngineDSP`. O `EngineDSP` ganhou uma flag `this.cc` (falsa no Ronco), `this.tempos`/`this.ciclo`, o teto 24 no `clamp` da taxa de compressão com `cc` e ramos `if (this.cc) {…} else {linha original}` nos pontos da tabela 1.2 do DIESEL.md: injeção, cliques de válvula, Wiebe, perda de calor na parede, válvulas de escape e de admissão, atrito (mais a carga do portador como pressão média de freio), motor de partida, knock e turbo. Os ramos chamam métodos que a subclasse põe como propriedades da instância (`ccInjecao`, `ccQueima`…; o `EngineDSP` só os declara). `git diff --stat` do `dsp.ts` do Ronco: 30 linhas a mais, 10 trocadas. O `control()` do Ronco roda inteiro e a subclasse corrige depois (`ccDepois`): o controle de lenta por ar, o turbo do Ronco e a temperatura do escape rodam mas não mandam em nada. `npm run paridade:ronco` (200 cenários, WAV e JSON) e `--dist` saem idênticos; render de `v16 rev` e `muscle wot` com o mesmo tempo (2,2 s e 2,6 s).

`tune()` troca a geometria pela da ficha (diâmetro e curso reais, mesmo volume), abre o duto de admissão (8× a área), põe os eventos de válvula do diesel (4T) ou as janelas (2T, escape ×1,3, janelas ×1,6), o torque, a inércia e o combustível máximo por ciclo `mfMax = P·bsfc/(3600·injeções/s)`. `buildExhaust()` monta coletores por bancada → uma turbina (`TwoPort 'turbo'`) → DPF (`DoisPortasDiesel`) → abafador (original, de caminhão ou só a chaminé) → boca com o raio da chaminé; os comprimentos são escalados por `520/c` do gás (470, 500, 560 m/s).

### Combustão

- **Injeção** armada no curso de compressão; piloto 12° antes do principal (8% do combustível, mínimo 1,5 mg escalado), início pelo mapa do DIESEL.md 2.2 (common-rail, mecânica, IDI) ou fixo (EMD 10°, GE 14°). Combustível `fuelCmd·mfMax·mapa(rpm)`, limitado por `λ_min` quando a bomba tem limitador.
- **Atraso** de Hardenberg–Hase com `p` e `T` do cilindro na injeção, `kAtraso` 1,6, cetano do preset; o principal com piloto usa 0,6×.
- **Wiebe na pré-misturada + queima por mistura na difusão** (2ª passada, ver abaixo; pré-misturada `φ_p = clamp(τ/θ_inj)·k_pre`, 6–10°) com `dQ` limitado a 6 bar por amostra. `θ_inj` vem da vazão do injetor, escalada para a plena carga durar ~32° na rotação de potência (com a vazão fixa por mg do DIESEL.md o EMD injetava em 11° e queimava quase tudo pré-misturado).
- **Frio**: parede `430 + 0,9·(água − 90)` K; queima parcial quando `τ > 4 ms` ou a temperatura alcançada no atraso (a maior entre a da injeção e a estimada no PMS, mais o ponto quente da vela) passa abaixo de 620 K; queimas parciais `0,3·frio·e^(−t/40 s)`; σ de 2,5% a 8%.
- **Batida e mecânica** (reescritas na 4ª passada, abaixo): a estrutura do motor é um banco de 30 modos, de 150 Hz a 7 kHz, com um caminho por cilindro até quem ouve. A queima o excita pela taxa de subida de pressão que ela mesma produz, `(γ−1)·dQ/V` por unidade de tempo, com a aspereza de uma chama real; os injetores, as válvulas, a saia do pistão e a bomba, por impulsos. Nada disso é ruído branco filtrado. Os impactos são referidos ao pico da batida de lenta quente do próprio motor, medido na sonda de calibração só com a queima (`refKnock`); o nível absoluto é `K_MEC` vezes o `mecanica` do preset (dB). (Até a 3ª passada: `dp/dθ` → dois passa-altas de 700 Hz → 5 ressonadores → 70% determinístico + 30% ruído, e tiques e válvulas como rajadas de ruído.)

### Governadores, carga e partida

- **min-max** (eletrônico): pedal manda combustível, PI isócrono de lenta (integrador até 0,6), governador de máxima em rampa de 120 rpm; **todas-as-rotações** (mecânico): droop estático `1/droop` (0,15 na lenta) realizado com ganho rápido baixo e um atraso de 0,5 s; **isócrono** no gerador, na locomotiva e na bancada, alvo em rampa (100 rpm/s na locomotiva). Sobrevelocidade: corta acima de 112%, volta abaixo de 105%.
- **Ganhos normalizados por motor** (desvio do DIESEL.md): os do documento (Kp 6, Ki 1,5/s na lenta) davam caça de ±12% a 2,4 Hz na Hilux. Aqui `P = Kt/(J·ω)` é a aceleração relativa por unidade de combustível e `Kp = ω_c/P` (lenta 9 rad/s, gerador 2,7, locomotiva 2,5, bancada 8; no EMD em N8 isso dá Kp ≈ 6). A rotação medida é a média do ω no último intervalo de ignição.
- **Portadores internos ("bancada")**: carro (o câmbio do Ronco), gerador (P = degrau·kWe/η, rampa de 0,1 s, AVR com queda por subfrequência abaixo de 97%), locomotiva (tabela de notches; o regulador de carga segue a rotação já alcançada e alivia se o combustível satura), dinamômetro (torque em fração do nominal). A carga entra como pressão média de freio somada ao atrito. `acoplar(carga)` e `{ type: 'diesel', combustivel }` são o que o `MotorDiesel` (`src/engines/diesel/motor.ts`) usa para os portadores de `carriers/` (os comentários `TODO(integração carriers/)` que sobraram no `dsp.ts` são anteriores a ele).
- **Atrito diesel**: +0,57 bar sobre o do Ronco (o ×1,6 do DIESEL.md no polinômio inteiro dava 4,4 bar na rotação máxima). **Motor de partida** de redução (torque de travamento ~2,5× o atrito frio, gira a 150–250 rpm; o do Ronco girava um 15 L a 30–60 rpm). **Velas**: espera `(1 + 8·frio)·glowK` s antes de girar, com o relé estalando.
- **Turbo**: rotação pela energia do escape `√(rpm·combustível)`, τ do preset, mínimo 0,15 no VGT, engrenado do EMD `max(livre, rpm·18,3)`, wastegate com chiado; apito `z·N/60` com `z` = pás principais do compressor (2º harmônico, queda acima de 16 kHz), nível ∝ rotação³ e pressão; a banda larga (sopro do compressor, esteira da turbina) segue os pulsos do escape e ficou como tempero (4ª passada). **Freio-motor**: borboleta (3 bar, atenua a boca e o jato), VGT (2,5 bar, turbo acelera), Jake (janela de −8° a +40° em volta do PMS de compressão, 0,35·AexMax, cilindros 2/4/6; o sopro gira a turbina), VEB. (A janela 350–390° do DIESEL.md cai no PMS de troca de gases, onde não há ar comprimido: foi entendida como "em volta do PMS de compressão".)

### Ferramentas e portões

- `npm run teste:diesel` (`tools/diesel-valida.ts`): lenta, governadores, pressões (tabela 2.5), bandas por família (Apêndice A, tabela 4.4), fumaça, freio-motor, potência, veículo e NaN, em paralelo; sai ≠ 0 em falha nova; os desvios conhecidos (abaixo) aparecem como "desvio". Leva ~20 min (1190 s medidos em 18/11/2026; é de longe o teste mais demorado da suíte, e o grupo `nan` roda num processo só). `npm run troca:diesel` (`tools/diesel-troca.ts`): troca de preset com o motor ligado na ordem de mensagens da página, volta à lenta. `npm run lenta:diesel`: 16 presets × 20 °C e −5 °C, partida de verdade, aceleradas aos 8 s e 13 s (notch 4 na locomotiva, degrau de 50% no gerador), zero apagamentos, rotação final ±3% do alvo do governador (±8% nos mecânicos com a água fria). `npm run governador:diesel` (rodado sozinho sai com código 1: duas das medidas dele só contam como "desvio" dentro do `teste:diesel`, que tem a lista `DESVIOS`). `tools/diesel-bandas.ts` é a porta de `analyze2.py` (conferida nas gravações: Hilux 1GD, Cat C15 e EMD 710 dão os números do Apêndice A). `tools/diesel-render.ts <preset> <cenário> <pasta> [ouvinte] [--resumo]`, `tools/diesel-medir.ts`. `npm run navegador:diesel` serve o `dist/` em `/data/engine/` e testa a página no Chromium e no Firefox (`… dist firefox`).

### Segunda passada (som, combustão e câmbio)

Alvo principal: o conjunto **real3** (25 gravações com banda ≥ 15 kHz, grave presente e rotação conferida; tabela por classe em `RESUMO.md`). Ele ficava em `scratchpad/real3/diesel/`, uma pasta temporária fora do repositório que não existe mais: os números do real3 que os testes usam estão copiados em `tools/diesel-valida.ts` e não podem ser refeitos sem baixar as gravações de novo (o acervo novo fica em `referencias/`, ver `PLANO.md`). Só razões entre bandas (vários vídeos têm controle automático de ganho). As tabelas do DIESEL.md (Apêndice A, vídeos do YouTube, vários lo-fi) ficam como referência interna. `tools/diesel-bandas.ts` ganhou a banda 30–60 Hz e o **CV do knock** da mesma definição do RESUMO (altura da envoltória 1–4 kHz por intervalo de ignição, `std(Δa)/(√2·média)`, mediana de janelas de 3 s; conferido: Cat C15 lenta 0,15, Amarok 0,22, iguais ao RESUMO); `diesel-valida.ts` ganhou o grupo `real3` (9 classes × 6 bandas, centroide e CV, mais os tons de turbo), `cambio` e `troca`.

O que mudou, pela física:

- **Pulso do escape** `p' = c·ṁ/A ∝ √T` (gancho `ccDens` no `dsp.ts` do Ronco, paridade idêntica). O fator linear `T/1650 K` do gasolina punha o pulso do diesel (500–750 K em lenta) 6–10 dB abaixo de um pulso gasolina da mesma massa; a calibração subia o ganho geral e com ele o chiado, o turbo e a mecânica: o "peidinho com aspirador atrás".
- **Fontes contínuas que não existem no diesel**: sem borboleta não há o chiado do ar na fresta (`hiss` da admissão ×0,1); o chiado do turbo de 4,8 kHz virou o *whoosh* do compressor (0,25–1,5 kHz) ∝ vazão·U⁵, que some em lenta e aparece sob carga; o chiado do jato na válvula de escape (0,05 → 0,02: a pressão de abertura em lenta é maior que no gasolina e o Mach satura). Em compensação, o fundo mecânico subiu (0,02 → 0,1) e a parede do bloco corta o agudo da mecânica pelo diâmetro (7,5 kHz na picape, 5,4 no caminhão, 3,6 na locomotiva).
- **Apito do turbo**: pás com os *splitters* (12 nas picapes pequenas, 14 nos maiores), nível 20–36 dB abaixo nos pequenos (a passagem de pás em carga passa de 20 kHz); VGT com rotação mínima por preset (`turboLenta`: Cummins 6.7 a 0,24 → 7,3 kHz, Duramax 0,30 → 9,8 kHz, os tons fortes das gravações); EMD com 27 pás (8,1 kHz em N8, 2,2 em lenta). Turbina com ruído de banda larga ∝ Zr·ṁ·M³ de ponta injetado depois dela: nos caminhões o abafador o come, nas locomotivas sai pela chaminé (é o agudo do EMD em N8).
- **Irregularidade física**: atraso de ignição por evento (σ 16% nos leves, 11% nos pesados, +12% no frio), vazão de cada injetor (fixa ±2% no common-rail, ±3,5% injetor-bomba, ±6,5% bomba mecânica, mais um erro absoluto em mg, que pesa em lenta; a central equaliza 2/3 dele), tiro a tiro (1–2% × 2,5 em lenta), mistura por ciclo (σ 18% + 35%·carga). A fração pré-misturada e o dp/dθ seguem o atraso: cada batida sai diferente.
- **Queima difusiva por mistura**: o combustível já injetado e ainda não queimado queima com o tempo de mistura do jato, `τ = 0,5 ms·(B/0,1)·√(200 MPa/p_inj)` (pressão do trilho no common-rail; ∝ rpm² nas bombas acionadas pelo came, com o piso de 20 MPa da abertura do bico), com a chama crescendo durante a pré-misturada. Piloto de massa fixa (1,5 mg, metade em plena carga), início de injeção da central `2 + 2·combustível + 0,15 ms·0,006·rpm` graus (compensa um atraso em ms), EMD 8°, GE 19°, EVC do EMD 227°.
- **Câmbio automático do diesel** (`cambio()` na subclasse; o do Ronco fica desligado no diesel): pontos pela rotação de potência, caminhão sobe a 1400–1600 rpm com o pé no fundo e volta a ~1050, sai em 3ª e pula marchas; picape sobe de 2000 a 3000 conforme o pedal; sem acelerar segura a marcha; a central corta o torque durante a troca.
- **Outros**: temperatura do coletor pela média, ponderada pela massa, do gás que sai pela válvula; potência medida pela média do torque (a leitura de um instante errava até 15%); droop do mecânico sobre o curso acima do atrito; Duramax na ordem real (1-2-7-8-4-5-6-3 = 1-8-7-3-6-5-4-2 na numeração do Ronco, virabrequim do Ronco; Scania e Power Stroke reais já eram a ordem clássica); Hilux com o raio dinâmico do 265/65 R17 (0,375 m); troca de preset volta à lenta (`portadorAoTrocar`: o caminhão depois do gerador nascia isócrono a 1800 rpm).

Antes (`92de172`) × depois, simulado contra o real3 (ouvinte `ext`; caminhão em carga na cabine):

| Classe (presets) | Medida | real3 | antes | depois |
|---|---|---|---|---|
| picape lenta (hilux, ranger, ram67) | 1–2,5k / 2,5–6k / 6–12k | −5,0 / −9,4 / −15,8 | −9,3 / −9,7 / −19,3 | −3,1 / −12,5 / −22,7 |
| | centroide · CV | 630 Hz · 0,22 | 240 · 0,09 | 300 · 0,14 |
| | apito > 2 kHz (hilux, ranger) | < +8 dB (Ranger, Power Stroke) | +32 a +34 dB em 3,3 kHz | +3 a +5 dB |
| | apito do VGT do Cummins 6.7 | +17 a +24 dB em 7,2 kHz | +33 dB em 3,1 kHz | +20 dB em 7,3 kHz |
| caminhão lenta (C15, Volvo) | 60–150 / 400–1k / 2,5–6k | +5,0 / +2,4 / −8,5 | +11,1 / +2,9 / −6,4 | +11,1 / +4,4 / −4,9 |
| | centroide · CV | 761 · 0,19 | 677 · 0,28 | 949 · 0,28 |
| | harmônicos 0,3–2 kHz sobre a mediana | +4 a +15 dB | +22 a +25 dB | +12 a +15 dB |
| caminhão carga (Scania, cabine) | 60–150 / 1–2,5k / 6–12k | +5,5 / −10 / −27,8 | +11,5 / −18,5 / −19,9 | +7,2 / −4,8 / −24,7 |
| | centroide · CV | 426 · 0,26 | 212 · 0,08 | 600 · 0,16 |
| | apito | ≤ +11 dB | +9 | +2 |
| ônibus carga | 1–2,5k / 6–12k · centroide | −5,6 / −21,9 · 692 | −13,3 / −20,0 · 281 | −10,3 / −30,8 · 381 |
| EMD 710 notch 8 | 400–1k / 2,5–6k · centroide | −5,5…−0,4 / −5,8…+1,1 · 340–3547 | −4,2 / −16,7 · 499 | +0,4 / +0,2 · 1517 |
| | apito | +19,5 dB (3,6–17 kHz) | +43 dB | +25 dB em 8,1 kHz |
| GE 7FDL notch 8 | 60–150 / 1–2,5k / 6–12k | +5,4 / −4,5 / −21,2 | +8,6 / −6,2 / −31,2 | +9,2 / −3,1 / −22,2 |
| gerador com carga | 60–150 / 1–2,5k · centroide | +5,8 / −11,8 · 233 | +8,1 / −29,7 · 207 | +7,2 / −11,7 · 356 |

O grave: o real3 mostra que o simulado em lenta já tinha **mais** 30–150 Hz em relação a 150–400 do que as gravações (caminhão +11 contra +5); a falta de peso era a do pulso fraco contra o fundo largo (o fator de densidade) e do comb harmônico perfeito; em carga o caminhão agora tem 60–150 acima de 150–400 e o agudo 25 dB abaixo, como nas gravações.

Itens da segunda passada (alvo do DIESEL.md × 1ª passada × agora):

| Item | Alvo | antes | depois |
|---|---|---|---|
| hilux plena 3000 rpm: ângulo do pico / dp/dθ / gás no coletor | 10–14° / 5–8 bar/° / 550–700 °C | 9,3° / 10,0 / 539 | 14,0° / 6,6 / 699 |
| hilux lenta: dp/dθ / ângulo | 3–6 / 3–8° | 2,8 / 3,1 | 3,0 / 5,1 |
| catc15 plena 1900: ângulo / dp/dθ | 10–14° / 6–9 | 5,3° / 10,5 | 9,7° / 5,8 |
| EMD N8: dp/dθ / p_max · GE N8 p_max / gás | 4–7 / 115–135 · 125–145 / 480–560 | 7,1 / 119 · 123 / 585 | 5,9 / 118 · 126 / 516 |
| T na abertura do escape em lenta | 600–750 K | 478–525 | 478–521 (desvio: ver abaixo) |
| Jake 6: frenagem / nível vs plena | 70–90% / +2 ± 2 dB | 65% / −1,2 | 69% / +3,2 |
| freio de descarga: pulsos | −15 a −20 dB | −7,9 | −7,7 |
| OM617 droop / caça | 7–9% / ±1–2% | 3,7% / dentro | 8,6% / ±1,9% |
| Hilux a 100 km/h em 6ª · Volvo 0–85 km/h carregado | 1700 ± 100 rpm · 60–90 s | 1542 · 104 s | 1604 · 84 s |
| potência na rotação de potência (16 presets) | ficha ± 5% | até +15,6% | −0,4 a +2,2% |
| câmbio: subidas (Scania pé no fundo / meio pé; Hilux) | 1400–1600 / ~1300 / 2000–3000 | modo eco: 945 rpm | 1522–1595 / 1422–1460 / 2490–3092 |
| troca gerador → Scania | volta à lenta | 1800 rpm isócrono | 500 rpm |

### Desvios conhecidos

`npm run teste:diesel` lista cada um com o motivo (`DESVIOS` em `tools/diesel-valida.ts`). Da lista original da 1ª passada (54), 16 passaram (dp/dθ da lenta e ângulo, dp/dθ e gás de plena carga da picape, dp/dθ do EMD em N8, p_max e gás da GE, p90/p10 do cofre, potência dos 4 leves, Hilux a 100 km/h, Volvo 0–85, droop do OM617, nível do Jake) e as 11 bandas do EMD e da GE da tabela 4.4 foram trocadas pelas classes do real3; 7 saíram da janela com a queima por mistura e a mecânica mais alta (p_max da picape fria e do C15, gás do C15, agudo e curtose do cofre, 1–2,5 kHz do Cummins frio). São 34 linhas nos testes antigos e 31 nas classes novas do real3. Os grupos, com a física que falta:

- **Temperaturas de lenta e do frio** (T na abertura 480–520 K): zona única com o combustível de lenta realista; a parede fria tira só 40 K da temperatura na injeção (o DIESEL.md supõe 180 K), o atraso quase não sobe e a queima fria sai cedo (ângulo 5,6°, alvo 8–15°).
- **C15 a 1900 rpm com 2,7 bar**: λ 2,5 (real ≈ 1,8), porque o ar do coletor fica a 310 K fixos; pico de 140 bar, gás frio.
- **EMD**: lavagem de zona única (o ar que atravessa esfria o coletor: 136/361 °C) e, no som, faltam os ventiladores, sopradores e motores de tração que dão o 60–150 Hz (+16 dB) de N8 e o agudo de lenta das gravações.
- **Gerador**: ouvido pela câmera de veículo, sem a carenagem e o ventilador do grupo; precisa do portador gerador da Cena com o ouvinte ao lado.
- **Grave de lenta 6–8 dB acima do real3** em picapes e caminhões (o 1º harmônico da ignição de 30 Hz).
- **Fumaça preta** (aspirado com ar sobrando, locomotiva com a carga seguindo o giro), **Jake** sem o agudo e a 69% da frenagem, **freio de descarga** −7,7 dB, **Hilux** com a lenta carregada a ±2% por 5 s.

### Terceira passada (o "mar" do turbo e o ar da lenta)

Queixa, depois da 2ª passada: "o turbo está com som de mar, parece que tem vento"; "o som de ar fica bem alto em lenta".
Método do `REVISAO-DE-SOM.md`: medir por fonte, mudar uma por vez, duas condições (lenta e carga). Ferramentas novas:
`tools/diesel-fontes.ts` (renderiza o preset com cada fonte desligada, sem mudar a semente do ruído: a diferença é a
fonte; as que entram na rede de tubos, válvula e turbina, pela diferença de energia) e `envoltoriaBanda` em
`tools/diesel-bandas.ts` (p90/p10 da envoltória de uma banda, modulação na ignição e p10 relativo a 150–400 Hz; a mesma
conta do script Python usado nas gravações, conferida a ±0,3 dB). Gravações: as do real3, em janelas de 8 s.

**O que era o "mar".** Em carga, o sopro do compressor (`whoosh` 0,25–1,5 kHz ∝ vazão·U⁵, mais o chiado de 1,3 kHz) era
60–95% do som ponderado A (caminhão, ônibus, gerador, picape acelerando) e enchia o vão entre as explosões (no vão, −0,2 a
−2 dB do total): ruído largo que subia com o giro, modulado só ±15% pela vazão média. A envoltória de 2–6 kHz tinha
p90/p10 de 7,6–8,7 dB, quase a do ruído liso pela mesma cadeia (6,1 dB); as gravações em carga, 8–18 dB. A banda larga da
turbina (`K_TURBINA`) seguia a vazão média (`mExM`). Mudanças: (1) as duas seguem a **pressão instantânea na entrada da
turbina** (onda que chega + onda que volta no tubo antes dela, relativa à média de ~40 ms; `K_MOD_TURBO` = 1); (2) o sopro
fica **6 dB abaixo** (`K_SOPRO` 4,5 → 2,25). Na lenta e no apito, nada muda.

| Carga: p90/p10 de 2–6 kHz (dB) | gravações (real3) | antes | depois |
|---|---|---|---|
| picape acelerando (ram67) | 11,6 (Cummins 6.7), 13,4 (TDI) | 8,3 | 13,6 |
| caminhão em carga, cabine (scaniav8) | 10,1–18,3 (FH16, ERF, R620) | 8,7 | 10,4 |
| ônibus em carga (onibusisl) | 8,1–12,2 (Bedford, K360, OF-1519) | 8,1 | 11,6 |
| gerador com carga (gen500) | 8,3 (Cummins 2500 kW) | 7,6 | 8,8 |
| EMD notch 8 | 7,6 e 9,9 | 6,7 | 6,8 |
| GE 7FDL notch 8 | 9,7 (7FDL-12) | 6,8 | 6,8 (desvio) |

| Carga: sopro no som ponderado A · no vão (dB do total) · 2,5–6 kHz do teste (dB rel. 150–400) | antes | depois |
|---|---|---|
| catc15 (ext) | −1,9 · −0,4 · — | −4,2 · −1,0 · — |
| scaniav8 (cabine; real3 −22,6 a −6,4) | −0,6 · −0,4 · −12,5 | −2,0 · −1,3 · −18,0 |
| onibusisl (real3 −19,6 a −3,8) | −1,8 · −0,4 · −19,4 | −4,2 · −1,0 · −24,0 (desvio) |
| gen500 | −0,8 · −0,7 · −17,9 | −2,2 · −1,9 · −23,6 |
| hilux28 acelerando · em ponto morto | −1,7 · −13,3 | −3,8 · −18,9 |

O vão em carga (energia ponderada A abaixo do p30 da envoltória, relativa ao total) foi de −2,2…−4,7 para −4,0…−9,6 dB;
nas gravações, −3 a −8 dB. Não se atenuou mais porque o sopro é o único agudo do modelo em carga: com −10 dB, 2,5–6 kHz cai
7–10 dB abaixo das classes do real3 (caminhão, ônibus, gerador), e as gravações têm esse agudo, modulado. O controle
**Sopro do turbo** (`turboChiado`, dB) está no painel para o ouvido decidir.

**O ar da lenta.** Por fonte, no vão da lenta (amostras abaixo do p30 da envoltória ponderada A): de 1 a 4 kHz, o
**fundo mecânico** (ruído branco em 1,5 e 3,5 kHz, `K_FUNDO`) era 80–100% da energia (picape −0,8 dB, caminhão −0,1 dB
no teste novo); de 4 a 16 kHz e abaixo de 500 Hz, o som de fundo do ambiente da Cena. O fundo tinha subido 5× na 2ª
passada (0,02 → 0,1) para o p90/p10 do cofre bater com um vídeo lo-fi, cujo vão é o ruído da própria gravação. Mudança:
`K_FUNDO` 0,1 → **0,012** (−18 dB), o maior valor em que ele é no máximo metade do vão de 1–4 kHz também nos caminhões.

| Lenta | antes | depois |
|---|---|---|
| fundo liso no vão de 1–4 kHz (teste) hilux28 · catc15 | −0,8 · −0,1 dB | −11,2 · −3,4 dB |
| vão ponderado A: picapes (hilux, ram67, ranger, duramax) · caminhões (catc15, volvod13) | −8,6…−9,9 · −10,3…−10,7 dB | −10,2…−13,1 · −19,2…−20,4 dB |
| p10 por oitava (rel. RMS da banda) 1 kHz · 2 kHz: hilux28 · catc15 | −12,6 · −6,0 · −10,0 · −10,5 | −19,2 · −10,7 · −22,4 · −23,1 |
| bandas do real3 1–2,5k · 2,5–6k: picape · caminhão | −3,1 · −12,5 · −0,2 · −4,9 | −3,4 · −13,6 · −0,9 · −5,5 |

O que sobra no vão da lenta é o som de fundo do ambiente (vento do "Céu aberto"), no mesmo nível absoluto do Ronco (a
lenta do Mustang tem o mesmo nível ponderado A da Hilux); o botão **Som de fundo do ambiente** o desliga.

Medidas que contrariam a queixa, registradas para a próxima rodada: nas gravações de lenta o vão **não** é silêncio (p10 da
envoltória 5–8 dB abaixo do RMS da banda em todas as oitavas de 500 Hz a 4 kHz; vão ponderado A de −3 a −4,5 dB),
porque a textura mecânica real (engrenagens, bomba, válvulas, reverberação curta) é contínua e presa ao motor. No
simulado ela era ruído liso; agora o vão é mais fundo que o das gravações (p90/p10 de 2–6 kHz no caminhão em lenta 24,7
dB contra 9–10). Falta textura mecânica presa ao ciclo, não ruído liso.

Desvios novos (`DESVIOS`): p90/p10 do cofre da Hilux (referência lo-fi), 2,5–6 kHz, 6–12 kHz e CV do ônibus em carga
(o CV cai para 0,10 sem o ruído do sopro por cima: a queima do ISL9 é regular demais), envoltória da GE em N8 (no 7FDL-16
do preset os 8 pulsos por volta se fundem antes da turbina); o cofre fica em 32 dB (alvo lo-fi 15). `npm run teste:diesel`:
0 falhas, 66 desvios (antes 65), com o grupo novo `envoltoria` (6 casos de carga e 2 de lenta). Saíram dois desvios (CV do knock e 400–1 kHz do Scania em
carga voltaram para dentro da faixa).

### Quarta passada ("mais motor, menos ar")

Queixa do dono, depois da 3ª passada: "os caminhões faziam um som de ar ao invés do *nhe nhe nhe nhe* ou do *rom rom
rom*"; "alguns soavam como vento, parecia que era apenas ar"; "quando o turbo sobe, ele faz um som de mar; podia ser só
uma coisa mais sutil de turbo". E a regra que vale acima da gravação (PLANO.md, "viés do simulador"): mais motor e menos
som de ar do motor. Método: o kit `tools/ouvido/` e o orçamento de ruído por fonte com a mesma semente, em 8 presets
(Hilux, Ram 6.7, 300D aspirado, Cat C15, Scania V8, ônibus ISL9, gerador QSX15, EMD 710), cada um em lenta, carga
parcial e plena carga com o giro travado na rotação da gravação casada, mais um degrau de carga com o giro travado (o
turbo enche e o motor não muda de rotação). Ferramentas novas: `tools/diesel-ouvido-render.ts` (o render de condição
casada do Diesel: giro travado, combustível mandado de fora, uma fonte desligada por vez), `tools/diesel-ouvido.py` com
os casos em `tools/diesel-ouvido.json` (a régua: painel, HNR, leito, orçamento e transitório de todos os casos, em
`referencias/_sim/diesel/`), `tools/diesel-ouvido-acerto.py` (o nível da mecânica de cada preset) e o grupo `ar` do
`npm run teste:diesel`. O caso está contado no `REVISAO-DE-SOM.md` ("Diesel: motor, não ar").

**Quem fazia o ar e o mar** (antes; fração da potência com a fonte isolada pela mesma semente):

| Fonte | Onde | Total ponderado A | 400–1k / 1–2,5k / 2,5–6k Hz |
|---|---|---|---|
| sopro do compressor (`K_SOPRO`, chiado de 1,3 kHz) | caminhão em carga, cabine (Cat C15, Scania) | 46–48% (desligar: −2,7 a −2,9 dB) | 75–77% / 85–90% / 100% |
| | caminhão, ônibus, gerador e picape em carga, de fora | 14–23% | 30–72% / 76–90% / 73–98% |
| banda larga da turbina (`K_TURBINA`) | EMD 710 em notch intermediário e em notch 8 | 77% e 94% (−8,7 e −13 dB) | 71–84% / 86–98% / 97–100% |
| jato da boca do escape | 300D aspirado: lenta, carga parcial, plena | 76%, 88%, 87% (−6,2, −9,4, −8,8 dB) | 80–87% / 74–100% / 93–100% |
| | Hilux: carga parcial e plena | 18% e 15% | 29% / 35% / 61–96% |

No enchimento do turbo, com o giro parado, a banda larga do turbo subia o total ponderado A em 0,7 a 3,3 dB (EMD: 12,2)
e o que há acima de 1 kHz em 4,1 a 13 dB (EMD: 19,9): o degrau de chiado que o dono ouve como mar. O apito não existia:
com as pás contadas com as intermediárias (14), a passagem das pás em carga ficava em 13–18 kHz e o tom mais forte
entre 1,5 e 16 kHz tinha 3–5 dB sobre o fundo. Na lenta não havia fonte de ar (todas somadas: 0,0 dB), mas a mecânica
inteira era ruído branco filtrado com a envoltória de cada evento, com silêncio entre as explosões: p90/p10 de 1–6 kHz
de 25 a 38 dB nos motores turbo (gravações: 5–13), fração estocástica de até 52% do total ponderado A, os tiques de
injeção com 85–91% de 2,5–6 kHz nos pesados, e nenhuma linha do motor de 100 a 400 Hz no caminhão (o simulado era escalado +32 dB para casar
com a gravação nessa banda).

**O que mudou, pelo mecanismo** (tudo em `src/engines/diesel/`; o `dsp.ts` do Ronco não foi tocado):

- **A estrutura do motor é um banco de modos** (`estrutura()` e `mecanica()` em `dsp.ts`; `EST` em `constantes.ts`): 30
  ressonadores de 150 Hz a 7 kHz (num cilindro de 100 mm; o grave escala com √(100 mm/diâmetro)), fator de qualidade 9 a
  15, frequências com um desvio sorteado e fixo. Cada cilindro chega a quem ouve por um caminho próprio (ganho com σ de
  2 dB, mais 3 dB e um sinal por modo): cada um tem a sua voz, um domina, e aparecem as linhas de meia ordem que as
  gravações têm de 100 a 600 Hz. Controles: `mecanica` (nível), `ressonancia` (×Q), `desigualdade` (×dispersão).
- **A batida é a queima empurrando o bloco** (`queimar()`): a excitação é a taxa de subida de pressão que a liberação de
  calor produz, `(γ−1)·dQ/V` por unidade de tempo, em bar/ms (antes: `dp/dθ` depois de dois passa-altas de 700 Hz, o que
  dependia do ângulo, não do tempo, e incluía o degrau da compressão no instante da ignição). O peso por frequência é a
  atenuação estrutural de um motor (`EST_COMB`: ~10 dB por oitava até 1,5 kHz, plana até 3 kHz). Na lenta, quase tudo
  queima pré-misturado: um degrau de pressão de ~1 ms que toca o médio. Em carga, a subida é longa e empurra os modos
  graves. A subida é áspera (`K_ASPEREZA` 3, cortada em 2,5 kHz·(100 mm/diâmetro)): metade da aspereza é uma assinatura
  fixa de cada cilindro (repete-se igual em todo ciclo, então dá linhas) e metade é sorteada a cada queima (o que sobrou
  de "chocalho"; nos motores de pré-câmara, ×0,6).
- **Os impactos são impulsos no mesmo banco** (`impacto()`): a agulha de cada injetor e o balancim (`tique()`), cada
  válvula assentando (`valvulas()`), o êmbolo das bombas em linha e de alta, e a saia do pistão batendo na camisa 8°
  depois do PMS de queima (`SAIA`, nova: cresce com a pressão no cilindro e com a rotação). O instante varia 0,06 ms e a
  força 25% de uma vez para outra: com os impactos exatamente periódicos as linhas iam a 6 kHz e o motor zumbia; com a
  variação, o HNR cai com a frequência como nas gravações. A força dos tiques cresce com a pressão de injeção
  (`EXP_TIQUE`) e a das válvulas com a rotação. O injetor-bomba passou de +6 para 0 dB. O atraso de ignição varia menos
  no instante com o motor quente (10% nos leves, 8% nos pesados; a frio continua em 28% e 23%, como antes) e a preparação
  da mistura varia à parte (22% e 16%): a força da batida muda mais que a hora dela.
- **Chocalho das engrenagens da distribuição** (`engrenagens()`; `ENGRENAGENS`, `EST_ENG`): o virabrequim de um diesel
  acelera a cada explosão e freia a cada compressão; na lenta, sem carga que mantenha os dentes encostados, as
  engrenagens da frente do motor (virabrequim, intermediária, comando, bomba) atravessam a folga e batem várias vezes
  entre uma explosão e a seguinte. São 24 pancadas por ciclo (no mínimo 2 por explosão) no mesmo banco de modos, pelo
  caminho da tampa da distribuição, num padrão fixo por motor com o instante variando 12% do espaço entre elas; a força
  cai com a carga (1/(1 + 4·combustível)) e sobe 50% a frio. Enche o intervalo entre as batidas com som do próprio
  motor e não com ruído (achado 2 da auditoria, "lenta de perto é estalo solto sobre silêncio"): no cofre da Hilux a
  curtose de 1–4 kHz foi de 46 para 34 (gravação: 6–9), o p90/p10 de 28 para 20 dB (gravação: 15) e os picos por
  explosão de 1,9 para 3,6 (gravação: 2–4); na régua do kit, o p90/p10 de 1–6 kHz da lenta foi de 19–27 para 14–21 dB
  (gravações: 5–13). É de 1 a 10% do som ponderado A na lenta e 0% em carga. Não tem controle próprio: segue
  `mecanica`. O caminho das engrenagens e o padrão delas têm um sorteio à parte (`rE` em `estrutura()`): quando entraram
  no mesmo sorteio dos caminhos dos cilindros, a voz de todos os motores mudou (a mecânica do Cat C15 em lenta caiu 2 dB
  em 400–1000 Hz) sem ninguém ter mexido nela.
- **Reflexões do cofre** (`COFRE`): depois do banco, 4 atrasos realimentados (2,3 a 6,7 ms, T60 de 40 ms, −10 dB): o som
  do bloco bate no capô, no chão e na carroceria. É determinístico (devolve a própria batida). Controle `cofre`.
- **Jato da boca do escape** (`freio()`; `K_JATO`, `JATO_V0`, `JATO_V1`): o ganho segue a velocidade média do gás na boca
  ao quadrado; com a velocidade de cada pulso ao quadrado, que o Ronco já aplica, dá U⁴ na amplitude, a lei de um jato
  livre (U⁸ na potência). Satura acima de 1,5× a velocidade de referência. A boca virou um campo próprio (`ponteira`),
  e o painel a mantém quando se mexe no diâmetro do tubo. Controle `jato`.
- **Turbo** (`turboSom()`, `afinaApito()`): sopro do compressor −30 dB (`K_SOPRO` 2,25 → 0,07 e o chiado de 1,3 kHz
  junto), banda larga da turbina −22 dB (`K_TURBINA` 0,0045 → 0,00035), jato na válvula de escape −4 dB (−14 dB nos 2
  tempos). O apito conta as pás principais (`turboPas` 7 nos pesados e nas picapes grandes, 6 nas pequenas) e a
  rotação máxima do turbo dos pesados é 95 000 rpm: em carga o tom cai em 9,1–9,4 kHz (gravação do Cat C15: 7 a 9,4
  kHz). Nível ∝ rotação³·(0,25 + 0,75·pressão): some na lenta e com pouca carga. Só os presets com `turboLenta`
  (Cummins 6.7, Duramax) têm o assobio de lenta das palhetas fechadas. O tom oscila ±0,1% e tem uma saia de ruído
  estreita (dois passa-faixas de Q 30) que cresce com a vazão.
- **Fontes que deixaram de ser ruído**: os cliques de válvula herdados do Ronco (ficam só para o relé das velas) e o
  chiado da bomba de óleo do HEUI (agora pancadas a 7 por volta).
- **Nível da mecânica por preset** (`mecanica`): acertado na lenta, de fora, para a banda de 1–2,5 kHz ficar em −3 a +2
  dB relativa a 150–400 Hz (faixa das gravações de fora) e para o grave do escape não ficar mais de ~12 dB acima dessa
  banda. Hilux 5, Ranger 1, Ram 10, Duramax 10, Power Stroke 6, 300D 8, TDI 3, F-1000 10, Scania 17, Volvo 22, C15 15,
  ônibus 17, 6V92 38, gerador 24, EMD 26, GE 8.

**Antes × depois × gravação** (giro travado na rotação da gravação; ouvinte `ext`, ou `int` na cabine; em cada célula
gravação / antes / depois; nas três últimas colunas, antes / depois; os resultados completos, com painel, orçamento e
WAVs de cada caso, ficam em `referencias/_sim/diesel/antes/` e `depois/`, e cinco pares de painéis em
`docs/ouvido/diesel/`):

| Caso | HNR 400–1k (dB) | HNR 1–2,5k | HNR 2,5–6k | leito de 1–6 kHz | m na ignição (1–6 kHz) | p90/p10 (dB) | ar | pulso a menos | total |
|---|---|---|---|---|---|---|---|---|---|
| Cat C15, lenta 702 rpm, de fora | −6 / 3 / 4 | −15 / −4 / −2 | −25 / −25 / −8 | 84% / 0% / 3% | 0,09 / 1,52 / 1,03 | 10,4 / 32,3 / 20,6 | 0 / 0 | 0 / 0 | 5,1 / 3,4 |
| Cat C15, 1545 rpm, pouca carga, cabine | −6 / 5 / 5 | −8 / 4 / 0 | −18 / −25 / −5 | 81% / 3% / 4% | 0,02 / 1,20 / 0,81 | 7,0 / 22,4 / 16,7 | 0 / 0 | 0 / 0 | 3,6 / 3,1 |
| Cat C15, 1535 rpm, em carga, cabine | −1 / −6 / 4 | −11 / −14 / 0 | −15 / −25 / −3 | 80% / 18% / 7% | 0,06 / 0,48 / 0,80 | 6,3 / 10,4 / 15,9 | 0 / 0 | 0 / 0 | 1,6 / 2,7 |
| Scania V8, lenta 600 rpm, de fora | 4 / 3 / 4 | −1 / −9 / −2 | −25 / −25 / −9 | 31% / 0% / 3% | 0,42 / 1,29 / 0,91 | 9,2 / 32,3 / 20,3 | 0 / 0 | 0 / 0 | 4,0 / 2,5 |
| Scania V8, 1450 rpm, em carga, cabine | 2 / −6 / 5 | −14 / −10 / −1 | −25 / −25 / −5 | 14% / 42% / 7% | 0,65 / 0,35 / 0,61 | 19,7 / 8,6 / 15,7 | 2,74 / 0 | 2,59 / 1,13 | 1,9 / 1,6 |
| Ônibus ISL9, lenta 618 rpm, de fora | 3 / 3 / 5 | −3 / −6 / −1 | −25 / −25 / −11 | 56% / 1% / 5% | 0,17 / 1,30 / 0,90 | 5,4 / 24,9 / 17,1 | 0 / 0 | 0 / 0 | 4,3 / 3,1 |
| Ram 6.7, lenta 700 rpm, de fora | −1 / 4 / 5 | −7 / 0 / −2 | −22 / −17 / −8 | 85% / 0% / 8% | 0,03 / 1,50 / 0,89 | 5,3 / 31,1 / 15,7 | 0 / 0 | 0 / 0 | 5,1 / 3,4 |
| Hilux 2.8, lenta 769 rpm, de fora | −1 / 4 / 5 | −4 / −6 / −1 | −25 / −25 / −7 | 50% / 0% / 7% | 0,31 / 1,32 / 0,87 | 8,2 / 29,0 / 15,6 | 0 / 0 | 0 / 0 | 3,9 / 2,6 |
| Hilux 2.8, lenta 858 rpm, cofre aberto | −15 / 2 / 5 | −25 / 0 / 0 | −21 / −14 / −6 | 79% / 0% / 8% | 0,15 / 1,49 / 0,86 | 12,8 / 31,1 / 15,6 | 0 / 0 | 0 / 0 | 6,0 / 4,6 |
| 300D aspirado, lenta 677 rpm, de fora | 5 / −12 / 2 | −1 / −11 / 0 | −12 / −25 / −7 | 16% / 6% / 2% | 0,50 / 0,74 / 1,08 | 10,5 / 16,8 / 20,1 | 0 / 0 | 0 / 0 | 2,3 / 2,4 |
| Gerador QSX15, 1570 rpm sem carga | 0 / 4 / 6 | −3 / −2 / −1 | −25 / −22 / −6 | 78% / 0% / 9% | 0,02 / 1,34 / 0,76 | 5,3 / 29,4 / 14,4 | 0 / 0 | 0 / 0 | 4,6 / 3,0 |
| EMD 710, lenta 250 rpm | 4 / 2 / 0 | −6 / −7 / −7 | −6 / −18 / −10 | 96% / 59% / 37% | 0,01 / 0,26 / 0,28 | 5,0 / 7,8 / 9,1 | 0 / 0 | 0,09 / 0,06 | 2,2 / 1,9 |
| EMD 710, 680 rpm, notch intermediário | 7 / −9 / 4 | 3 / −25 / −4 | −17 / −25 / −15 | 66% / 98% / 46% | 0,01 / 0,01 / 0,20 | 7,8 / 5,8 / 8,3 | 3,66 / 0 | 0,77 / 0,17 | 2,3 / 2,1 |
| EMD 710, notch 8 | 9 / −8 / 10 | −7 / −20 / −2 | −23 / −23 / −15 | 83% / 96% / 49% | 0 / 0,01 / 0,20 | 9,3 / 5,7 / 7,1 | 1,32 / 0,42 | 0,78 / 0,62 | 2,3 / 2,1 |

| Orçamento (antes → depois) | fontes de ar contínuas no nível ponderado A | fração que muda com a semente (A) | quem mais pesa em 400–1k / 1–2,5k / 2,5–6k Hz, depois | engrenagens (A) |
|---|---|---|---|---|
| Cat C15, lenta | 0 → 0 dB | 52% → 46% | batida 82% / aspereza sorteada 34% / batida 33% | 1,8% |
| Cat C15, em carga, cabine | 2,7 → 0 dB | 49% → 6% | batida 49% / batida 45% / batida 34% | 0% |
| Scania V8, lenta | 0 → 0 dB | 51% → 54% | batida 81% / batida 45% / batida 26% | 2,0% |
| Scania V8, em carga, cabine | 2,9 → 0 dB | 51% → 10% | batida 63% / aspereza sorteada 47% / batida 37% | 0% |
| Ônibus ISL9, em carga, de fora | 1,2 → 0 dB | 31% → 18% | batida 43% / batida 47% / aspereza sorteada 34% | 0% |
| Ram 6.7, lenta | 0 → 0 dB | 23% → 29% | batida 66% / batida 37% / válvulas 22% | 3,5% |
| Ram 6.7, plena carga, de fora | 0,7 → 0 dB | 15% → 4% | (escape; batida 10%) / batida 51% / batida 54% | 0% |
| Hilux 2.8, lenta, de fora | 0,2 → 0 dB | 40% → 36% | batida 79% / batida 50% / batida 33% | 7,2% |
| Hilux 2.8, lenta, cofre aberto | 0 → 0 dB | 51% → 50% | batida 73% / batida 54% / batida 28% | 10,3% |
| Hilux 2.8, plena carga, de fora | 2,1 → 0 dB | 39% → 6% | (escape; variação da queima 6%) / batida 56% / batida 52% | 0% |
| 300D, lenta | 6,2 → 0 dB | 85% → 48% | batida 33% / tiques 46% / tiques 39% | 2,1% |
| 300D, 2500 rpm com 40% | 9,4 → 0 dB | 89% → 11% | batida 37% / batida 32% / válvulas 45% | 0,1% |
| 300D, plena carga | 8,8 → 0 dB | 87% → 8% | (escape; batida 16%) / aspereza sorteada 36% / aspereza sorteada 25% | 0% |
| Gerador, 90% de carga | 0,9 → 0 dB | 22% → 14% | batida 57% / batida 40% / batida 31% | 0% |
| EMD 710, lenta | 0,2 → 0 dB | 24% → 47% | aspereza sorteada 35% / aspereza sorteada 32% / tiques 44% | 4,8% |
| EMD 710, notch intermediário | 6,4 → 0,1 dB | 87% → 24% | batida 35% / aspereza sorteada 40% / apito 26% | 0% |
| EMD 710, notch 8 | 12,1 → 0,4 dB | 94% → 20% | (escape; batida 5%) / turbina (ar) 31% / turbina (ar) 77% | 0% |

(A "fração que muda com a semente" conta tudo o que sai diferente com outra semente do gerador aleatório: as fontes de
ruído e também o instante sorteado dos impactos, que não é ar. A última coluna é a parte do chocalho das engrenagens no
som ponderado A: 1 a 10% na lenta, 0% em carga.)

| Enchimento do turbo (antes → depois) | banda larga no total ponderado A | no que há acima de 1 kHz | o apito, depois: frequência, sobre o fundo local, relativo às ordens (150–400 Hz) |
|---|---|---|---|
| Cat C15, 1400 rpm, de fora | 1,3 → 0 dB | 6,5 → 0 dB | 9,4 kHz, 21 dB, −35 dB |
| Cat C15, 1400 rpm, cabine | 3,3 → 0 dB | 10,9 → 0,1 dB | 9,4 kHz, 21 dB, −29 dB |
| Scania V8, 1300 rpm | 1,6 → 0 dB | 4,9 → 0 dB | 9,1 kHz, 22 dB, −33 dB |
| Ônibus ISL9, 1500 rpm | 1,6 → 0 dB | 4,1 → 0 dB | 9,3 kHz, 22 dB, −36 dB |
| Ram 6.7, 2000 rpm | 0,7 → 0 dB | 13,0 → 0 dB | 12,5 kHz, 21 dB, −39 dB |
| Hilux 2.8, 2400 rpm | 1,4 → 0 dB | 5,2 → 0,1 dB | 14,7 kHz, 20 dB, −35 dB |
| Gerador QSX15, 1800 rpm | 1,0 → 0 dB | 7,6 → 0 dB | 10,7 kHz, 22 dB, −35 dB |
| EMD 710, da lenta ao notch 8 | 12,2 → 0,8 dB | 19,9 → 3,3 dB | 8,1 kHz, 24 dB, −21 dB |

Referências do apito (acervo): Cat C15 na cabine, em carga, 7 a 9,4 kHz, 14 dB sobre o fundo local e 20 dB abaixo das
ordens; com pouca carga, 36 dB abaixo. Na lenta de fora: Ram 6.7 com 7,28 kHz a −33 dB (gravação: 7,25 kHz a −20 dB),
Duramax 9,8 kHz a −35 dB (gravação: 9,66 kHz a −35 dB), Hilux sem tom (como a gravação).

"Papel rasgando" (o controle "Diâmetro do escape" no mínimo, 1,5"): antes, o jato passava a ser 99–99,9% do som
ponderado A no 300D (desligá-lo mudava o nível em 20 a 28 dB) e 83–99% na Hilux (8 a 19 dB); a boca seguia o tubo e o
jato crescia com 1/área². Agora mexer no tubo não mexe na boca: 0,0 a 0,3 dB. Com a boca também forçada a 1,5" pelo
controle novo, 0,0 a 3,9 dB (o jato satura).

**Critérios do viés, e onde não se cumprem:**

1. *HNR do simulado ≥ o da gravação até 6 kHz*: cumprido nos casos casados de picape, caminhão, ônibus e gerador, com
   uma falta de 0,7 dB (Scania em lenta, 1–2,5 kHz: −2,1 contra −1,4); fica abaixo no 300D em 400–1000 Hz (2 contra 5 dB:
   o atraso de ignição longo da pré-câmara espalha o instante da batida) e no EMD em lenta (400–1000 Hz, 0 contra 4,5;
   2,5–6 kHz, −10 contra −6) e no notch intermediário (400–1000 Hz, 4 contra 7; 1–2,5 kHz, −4 contra 3). As gravações da
   locomotiva têm linhas de auxiliares que o modelo não tem (uma linha de 65,9 Hz igual em lenta e em notch 8).
2. *Leito de ruído ≤ o da gravação e `ar` ≤ 0,6*: `ar` 0,00 em todos os casos de estrada e no gerador, e neles o leito do
   simulado fica abaixo do da gravação em toda banda até 6 kHz. No EMD em notch 8 o `ar` é 0,42: o leito de 2,5–6 kHz é
   90% da banda contra 82% na gravação (a banda larga da turbina, que mesmo 22 dB mais baixa ainda é o que mais pesa
   ali). Abaixo de 150 Hz o EMD em carga também tem mais leito que a gravação (30–60 Hz: 28% contra 1% no notch
   intermediário e 15% contra 4% no notch 8; 60–150 Hz: 4–7% contra 3–4%): é a variação de uma queima para a outra no
   grave do escape de 16 cilindros, não uma fonte de ar.
3. *Fontes de ar contínuas mudam o nível ponderado A em menos de 1,5 dB em lenta e carga parcial*: 0,00 a 0,02 dB em todos
   os presets de estrada e no gerador (também em plena carga); 0,10 dB no EMD em notch intermediário (0,44 em notch 8).
   Nenhuma fonte de ar é a que mais pesa em banda nenhuma até 6 kHz, fora a banda larga da turbina do EMD em notch 8
   acima de 1 kHz (31% de 1–2,5 kHz e 77% de 2,5–6 kHz).
4. *Turbo no enchimento*: banda larga ≤ 0,01 dB no total ponderado A (EMD 0,85 dB); o apito é um tom fino 20–24 dB acima
   do fundo local.
5. *Modulação na ignição ≥ a da gravação na lenta*: cumprido em todos (0,28–1,08 contra 0,01–0,50). Em carga: 0,60–0,81
   nos motores de estrada (gravações de cabine: 0,02–0,65; no Scania, 0,61 contra 0,65) e 0,20 no EMD.
6. *Três primeiras ordens de queima a ±3 dB*: **não foi objeto desta passada** (o escape não mudou). Medido, relativo ao
   total (gravação / simulado): Scania em carga −2 / −1, −9 / −7, −19 / −23 dB; Hilux em lenta, de fora, −26 / −20, −8 /
   −8, −4 / −4; Cat C15 em carga na cabine −7 / −1, −3 / −13, −15 / −12 (a 2ª ordem, 153 Hz, sai 10 dB baixa); Cat C15 em
   lenta −18 / −6, −2 / −3, −19 / −9 e 300D −4 / −14, −13 / −4, −23 / −5 (abaixo de ~100 Hz a gravação de celular não é
   confiável).

Na régua do kit (aprovados pelo ouvido: total ≤ 2,2), os casos de carga ficam em 1,6–3,2 e os de lenta em 1,9–4,6 (antes
da passada, a lenta: 2,2–6,0). O que passa de 2,2 vem das distâncias simétricas de envoltória e de modulação: o simulado
é mais pulsado que a gravação (p90/p10 de 14–21 dB na lenta dos motores de estrada e do gerador contra 5–13; leito de
2–9% contra 16–85%), de propósito. Os três defeitos de um lado só ficam dentro dos portões em todos os casos (`ar` ≤
0,42; tom a menos ≤ 1,70; pulso a menos ≤ 1,13).

**Pendente** (relatado, não resolvido aqui):

- **Faltam médios em carga.** Na cabine, 400 Hz–2,5 kHz fica 5–10 dB abaixo das gravações casadas (Cat C15: −17 / −22 dB
  relativos a 150–400 Hz contra −11 / −17; Scania: −14 / −18 contra −4 / −13), e as linhas do motor nessa faixa 4–8 dB
  abaixo. A mecânica cresce da lenta para a carga o que a física dela manda (11–17 dB em 400 Hz–6 kHz no C15) e o escape
  de 150–400 Hz cresce 34 dB. O que falta é conteúdo tonal do escape e da carcaça dele nessa faixa: é o mecanismo
  genérico do caminho compartilhado (`ronco/dsp.ts`), fora do ramo `cc`.
- **A lenta continua mais seca que as gravações.** Com o chocalho das engrenagens o p90/p10 de 1–6 kHz na lenta fica em
  14–21 dB (sem ele, 19–27; gravações, 5–13). O controle "Reflexos do cofre" enche mais o intervalo entre as explosões;
  o padrão (−10 dB) ficou baixo para a carga não perder os pulsos (com −7 dB o "pulso a menos" do Scania em carga passa
  de 1,3).
- **Locomotiva em notch 8** (achado 1 da auditoria, "chiado contínuo"): a banda larga da turbina caiu 22 dB (desligá-la
  mudava o nível ponderado A em 12,1 dB; agora, em 0,4), mas o agudo continua mais liso que o das gravações (p90/p10 de 1–6 kHz de 7,1 dB contra
  9,3; "pulso a menos" 0,62, dentro do portão) e a turbina ainda é o que mais pesa acima de 1 kHz (31% e 77%; `ar` 0,42).
  Com 16 cilindros a 904 rpm são 241 explosões por segundo: o que as gravações têm é uma flutuação mais lenta, que o
  modelo não tem. O EMD em lenta (achado 3, "escura e ribombante") segue com 400–1000 Hz 12 dB abaixo da gravação e
  60–150 Hz 8 dB acima, relativos a 150–400 Hz.
- **O grave da lenta sobra** (achado 5 da auditoria): relativo a 150–400 Hz, a banda de 60–150 Hz fica acima das
  gravações de fora em 4 dB no Cat C15 (+12 contra +9), 13 no Scania (+9 contra −4), 11 no ônibus (+7 contra −4), 20 na
  Ram (+20 contra 0), 13 na Hilux (+18 contra +5) e 10 no 300D (+11 contra +1). É o escape (caminho compartilhado, que
  esta passada não mexeu) somado à pouca energia do simulado em 150–400 Hz.
- **Gerador e locomotiva tocam na página sem ventilador, alternador nem sopradores** (achado 4 da auditoria): as fontes
  existem nos portadores (`Gerador` em `src/carriers/gerador.ts`: `alternador`, `ventilador`; `Locomotiva` em
  `locomotiva.ts`: `ventilador.k`, `soprador.tracao` e as outras), mas só a Cena os monta (`src/scene/dsp-cena.ts`). A
  página do Diesel roda o `DieselDSP` com a carga interna (governador e torque; os `TODO(integração carriers/)` em
  `src/engines/diesel/dsp.ts` e em `src/pages/diesel/Painel.tsx`). Ligar pede que o worklet da página monte o portador,
  acople o motor (`src/engines/diesel/motor.ts`) e some as fontes próprias dele na distância de referência (7,5 m), ou
  que a página rode pela Cena; os dois caminhos passam por `src/carriers/` e `src/scene/`. O ventilador do gerador tem
  uma parte de ruído largo: quem ligar confere o orçamento de ruído, pelo viés.
- **O ouvinte de fora ouve o motor perto demais em relação ao do cofre**: entre as duas posições a gravação da Hilux
  muda 11 dB em 400–1000 Hz e 19 dB em 1–2,5 kHz; o simulado, 1 e 2 dB (os pesos de posição são do caminho
  compartilhado).
- **O som de fundo do ambiente** pesa na lenta da Hilux (+0,4 dB no nível ponderado A; +2,5 dB em 150–400 Hz) mais que
  nos carros aprovados (Mustang +0,1 dB, Fusca 0,0): a lenta da picape é 5,5 dB mais baixa que a do Mustang em nível
  ponderado A. É o único "ar" que sobra na lenta; o botão "Som de fundo do ambiente" o desliga. (O ambiente é do
  caminho compartilhado.)
- **Desvios novos na validação** (`DESVIOS` em `tools/diesel-valida.ts`, cada um com o motivo): o agudo acima de 6 kHz da
  picape e do caminhão em lenta, o médio e o agudo do caminhão e do ônibus em carga na cabine, o agudo do EMD e da GE em
  notch 8 (era tudo ruído: tiques, sopro, turbina), o CV das alturas de pico da batida (0,57 nas picapes: cada batida é
  agora um clique de forma fixa por cilindro), a curtose do cofre da Hilux e o dp/dθ da lenta da Hilux (2,97 bar/° para
  3–6). São 17 medidas em desvio com motivo desta passada, de 70 (eram 66 de 255 medidas antes dela; hoje são 288
  medidas, com o grupo `ar`). O teste da envoltória em carga passou a ser de um lado só (não pode ser mais liso que a
  gravação) e o do apito do caminhão passou a medir o tom relativo à banda das ordens (≤ −20 dB).
- **Medidas que dependem da realização do sorteio** (T-DSL-02 da auditoria): o degrau de 100% do gerador passa com
  10,0% de queda (limite 10%) e o dp/dθ da lenta da Hilux fica em 3,0 bar/° (limite 3): qualquer retoque que consuma
  números do gerador aleatório pode virar as duas. A lenta do F-1000 a 20 °C depois das aceleradas do `lenta:diesel`
  foi conferida em 10 sementes: não apaga em nenhuma (mínimo de 504 a 558 rpm; antes da passada, de 450 a 563). Com a
  dispersão do atraso de ignição a frio reduzida (uma versão intermediária desta passada) apagava em 1 de 10, e por
  isso a dispersão a frio voltou ao valor de antes.

## Radial e aviação a pistão

O projeto está em [`RADIAL.md`](RADIAL.md); aqui fica o que foi feito, como e o que se mediu. Página `radial.html` (`src/pages/radial/`; nos aviões e no helicóptero o comando de potência é a manete da Turbina, `src/ui/Manete.tsx`, que fica onde foi deixada, com W/S, 1–4 e arrasto; no tanque, no carro e na moto, o pedal), DSP em `src/engines/radial/`, worklet `src/worklet/processador-radial.ts` (`radial-engine`); a família **Aviação** (motores planos de avião e de helicóptero leve) está na página do Ronco, também com a manete no lugar do pedal.

### Como estende o Ronco

`RadialDSP extends EngineDSP`, como o Diesel. O `EngineDSP` ganhou duas flags neutras (`av`, `radial`, falsas no Ronco), a carga do portador no eixo (`carga`, nula no Ronco) e ramos `if (this.av) …` / `if (this.radial) …` nos pontos da tabela 1.6 do RADIAL.md, com o lado gasolina textual:

| Gancho | Onde | O que faz |
|---|---|---|
| 1 | construtor | `av = false; radial = false; carga = null` |
| 2 | `setConfig` | curso das articuladas no ar e na energia de cada cilindro (`cylIn`, `cylQ` × `curso[c]`) |
| — | `setConfig`, `message`, `control`, `telemetry` | `instalarAviacao` (com `aviation` no preset), mensagens `{ type: 'av' }`, `avControle`, `avTelemetria` |
| 4–7, 15 | centelha, falhas, energia, estouros | um magneto (queima ×1,6), mistura, falhas da partida (encharque), estouros da partida sem coletor quente |
| 8 | antes da 1ª lei | ar comprimido de partida (M-14P) |
| 9 e 12 | `vib`, `mech` | vibração sem a 1ª ordem (o contrapeso a anula), 2ª ordem das articuladas, momento entre fileiras, oscilação do torque ×1,6; aletas expostas ×1,17 |
| 10 e 11 | `Tst`, integração | arranque de aviação; `T_carga = carga.torque(ω)` e `J + carga.inercia` (com `carga` nula: `x − 0` e `J + 0`, os mesmos doubles) |
| — | DFCO, lenta, arranque | o carburador não corta na desaceleração; a lenta de aviação sem a lenta acelerada da central (0,2 do `coldAdd`); arranque mais longo (`crankMax`) |
| — | mistura do ouvinte | o som da hélice da página (`avSomExtra`) |

`git diff --stat` do `dsp.ts` do Ronco contra a base da etapa: 35 linhas a mais, 8 trocadas. `npm run paridade:ronco` (200 cenários) e `--dist` idênticos; `v16 rev` e `muscle wot` com o mesmo tempo (1,9 s e 2,2 s, contra 2,0 s e 2,3 s antes). O único outro toque no Ronco é o `export` de `balance` com os eixos opcionais (`geometria.ts`).

As funções de aviação moram em `src/engines/ronco/aviacao.ts` (`instalarAviacao`): magnetos, mistura (`qMix`, queima pobre, falhas abaixo de 0,45), arranque elétrico direto (torque de partida 3,2× o atrito frio parado: a fórmula de 8·L + 60 N·m do RADIAL.md não vence o atrito do modelo acima de ~30 L), a carga de bancada da página (`CargaBancadaAv`: a `CargaHelice` com o governador de passo do portador, ou a `CargaRotor` com a embreagem e o governador no acelerador) e o som da hélice na página (a `FonteHelice` do portador, em Pa a 5 m do cubo, na escala do escape pelo `nivelEscape`). O `RadialDSP` troca falhas, arranque, ar de partida e som de partida pelos dele.

### Geometria (`src/engines/radial/geometria.ts`)

`buildRadial` devolve o `MotorMontado` do Ronco mais os campos radiais. Fileira única 3/5/7/9 com biela-mestra: o PMS real de cada articulada sai da cinemática (máximo numérico, passo 0,05° e refino parabólico) e o `schedule()` do Ronco, sem alteração, usa esses PMS; dupla fileira 14/18 com as ordens da P&W (moentes a 180°, dianteira deslocada meio passo); R-4360 com a ordem decorrente (`ordemDecorrente`: das combinações de PMS de ignição por fileira, a que dá os 28 disparos a 25,714°); o Monaco-Trossi (2 × 8) com a ordem decorrente mais uniforme possível em 4 tempos (aproximação). `tools/radial-geometria.ts` reproduz o Apêndice B (34 medidas: ΔPMS a ±0,05°, intervalos exatos, `fire[]`, ordem do R-4360, balanço).

### Escape, sondas e partida (`src/engines/radial/dsp.ts`)

- **Escape** (`buildExhaust` inteiro): anel coletor em laço com as saídas nas junções mais perto do ângulo de cada uma; estaques (um por cilindro, ou grupos de vizinhos de uma fileira); aranha; dois lados em cadeia (Sherman); um sistema por fileira; os dois anéis do P-47 num tubo longo até a turbina (`TwoPort 'turbo'`); as fileiras do R-4360 aos pares. O vazamento do anel de chapa e das juntas é o `breakout` do Ronco, com o acerto da instalação em dB (`vazamento` no preset), e vira a fonte `coletor` na Cena.
- **Sondas** (`calibrate`/`measurePower`): um `RadialDSP` com o escape de referência (anel de uma saída), 55% da rotação máxima, lenta 21 dB abaixo; a potência medida perto da rotação máxima (0,8/0,9/1,0), que é a da ficha dos motores de avião.
- **Partida**: inércia (energizar: o apito do volante sobe de 290 a 390 Hz em ~18 s; engatar: o estalo e o volante girando o motor a 80–95 rpm), elétrica direta e ar comprimido (M-14P: o distribuidor manda ar de 3° a 100° depois do PMS, um "tchuf" por cilindro). Os magnetos ficam desligados até a 9ª pá contada (no de inércia, até 4,5 s de giro). Encharque dos cilindros de baixo (`max(0, −cos φ)`, ×(1 + 0,3·primer)), falhas e estouros dos primeiros segundos, fumaça.
- **Estouros da partida** (`ESTOURO_PARTIDA` em `aviacao.ts`): uma falha estoura no escape com 1,5% + 6%·e^(−t/8 s) de chance (a constante do encharque) e o "coletor quente" dispensado cai junto; o estouro tem `k` 0,25. Com os 35%, τ 20 s e `k` 0,9 do RADIAL.md o R-1830 dava 21 estouros de 28–34 dB nos 3 s depois de pegar, 32 nos primeiros 20 s, e acelerar no primeiro minuto dava 2–7 por segundo (o "muito pipoco" da revisão de novembro de 2026); as gravações (DC-3, P-47, Corsair, T-28, R-2800 em banco, Rotec, Sh-14) têm 0–6 picos acima de 20 dB nos 20 s depois de pegar e 0–0,7 por segundo acima de 16 dB. A medida é `tools/radial-estouros.ts` (o detector do `pops.py` dos rotativos e a curtose de 2–6 kHz na saída da página, com os estouros e as centelhas sem queima contados por dentro), e o grupo `estouros` do `teste:radial` a confere.
- **Galope da lenta**: dispersão do Ronco ×1,8 (carburador de pressão) ou ×2,6 (boia), 2,5–4,5% de falhas de vela na lenta e um balanço lento da mistura (±20%, abaixo de ~0,4 Hz).

### Portadores e Cena

- **Hélice** (`carriers/helice.ts`): campos novos, todos com o padrão de antes (os turboélices e `teste:cena` não mudam): `nMin` e a manete de passo (`ComandoPortador.rpmAlvo`), `beta0` do passo fixo, `onLenta` (piso da fonte na lenta), `kapK` e `largoK` (decaimento dos harmônicos e ruído largo das pás; nas hélices a pistão 0,5 e ×10 entre M 0,5 e 0,85) e a contagem de pás abaixo de 10% da rotação; a tabela `HELICES_PISTAO`. O c_Q sai da potência da ficha (passo fixo: absorve a potência a 92% da rotação máxima; passo variável: o mínimo absorve 90% na máxima).
- **Rotor**: monta com motor; com um motor a pistão de verdade o Kp do governador é 0,12× o de bancada (com o original o Nr nem se mexia ao puxar o coletivo).
- **Adaptadores**: `MotorRadial` (`src/engines/radial/motor.ts`: bocas do escape na carenagem com a diretividade de lado, `coletor`, `admissao`, `bloco` exposto, `vibracao`, `compressor`; nível absoluto pelo `nivelEscape`, sem o reforço de lenta da página) e o `MotorRonco` de aviação (acopla a carga no eixo). Com um portador em voo o motor já começa na rotação dele.
- **Passagem**: `ADAPTADORES`, `COMPAT.carro` e `USO_REAL` com o radial e o pistão de aviação; o R44 da Passagem passa a ter o O-540; presets novos: Corsair rasante, Yak-52, P-47, Sherman, Cessna 172.

### Ferramentas e portões

`npm run teste:radial` (`tools/radial-valida.ts`, 24 grupos em paralelo, 2–6 min conforme a carga da máquina), `npm run cpu:radial` (`tools/radial-cpu.ts`), `npm run lenta:radial` (26 presets, os 16 radiais com lenta e os 10 de aviação; a Megola fica de fora; × 20 °C e −5 °C, partida de verdade, acelerada aos 12 s, rotação final aos 35–40 s: 52/52; a janela era 25–30 s e o Verner 5S, que pega aos 7 s, só passava porque os estouros exagerados freavam o motor pela contrapressão), `npx tsx tools/radial-estouros.ts [ids]` (estouros e falhas por regime), `npm run geometria:radial`, `npm run navegador:radial` (Chromium e Firefox, `dist/`). `tools/radial-bandas.ts` é a porta de `medir2.py` (conferida: Yak-52 e DC-3 dão os números do Apêndice A); `tools/radial-cena.ts` monta o preset no portador e ouve parado de lado pela Cena (propagação, solo, hélice). CPU (`cpu:radial`, tempo de CPU do processo, mediana de 3 passadas): R-4360 subindo de giro, 24% do tempo real em Node com a máquina livre e 44–53% com ela ocupada por outras suítes (62 tubos, 32 nós), contra o portão de 60%; a medida de relógio de antes ia de 26 a 45%.

**Desvios com teto e sementes** (desde 22/11/2026, `tools/desvios.ts`, comum às famílias). Uma medida fora do alvo só passa se estiver no retrato `tools/radial-desvios.json` (chave = nome exato da medida; `medido`, `folga`, `motivo`) e o valor de hoje ficar dentro da folga do gravado (±1 dB nas medidas em dB, ±5 % nas outras; alargada, com a razão em `nota_folga`, onde a mediana de 3 sementes muda mais que isso entre bases). Saiu da folga, para pior ou para melhor: falha até `--atualizar` (tudo o que mudou) ou `--atualizar=<nome>` (só a medida que a mudança explica). Medida do retrato que voltou a passar: aviso de desvio órfão. Medidas à beira (`beira: true`: passam por menos de 5 % da tolerância e caem fora com outras sementes) podem passar ou falhar dentro da folga. Contagens, transientes, vagar e CV são a mediana de 3 sementes do ruído (`semear` troca o estado dos RNG do DSP montado, depois da calibração, que fica com a semente de fábrica; `--semente N` muda a base, 0 é a de fábrica). Antes, o desvio era só um nome (a medida podia piorar à vontade) e o resultado valia para uma semente: com outras três, 19 medidas "ok" do Radial viravam falha (AUDITORIA T-RAD-01, T-RAD-02). O grupo `pagina` mede as lentas pelo `RadialDSP` da página (`radial.html`, ouvinte de fora a 5 m do cubo): 4 a 11 dB mais escura acima de 400 Hz que pela Cena, 10 desvios declarados (T-RAD-05). Os grupos `estalos-*` medem a lenta quente pela página em 21 presets, os motores pequenos, o Sherman e a aviação do Ronco incluídos (T-RAD-06): Rotec R2800 19 picos/s (16,6 acima de 16 dB), Verner 11–15/s, Sherman 15/s, M-14PF 10/s e os planos de 4 cilindros ~20/s, todos desvios declarados. A potência é a média de 2 s por ponto (o `tqMean` é uma média de 50 ms: lido no fim de 0,5 s ele variava ±8% com a semente).

### Alvo × medido (`npm run teste:radial`: 169 medidas; semente de fábrica 115 ok e 54 desvios com teto; retrato com 64 entradas, 15 à beira; 0 falhas com as sementes de base 0, 1000, 2000, 3000 e 4000)

Os números da tabela são da semente de fábrica, de antes das medianas; os de hoje, com o teto de cada desvio, estão no retrato e na saída do teste. Mudaram de estado com a mediana de 3 sementes: o CVciclo do R-1830 nos 3 s em que pega (0,62 → 0,50, desvio), o 3·f_ign do Rotec (desvio → à beira), a potência do Rotec R2800 (+4,9%, à beira).

| Medida | Alvo | Medido |
|---|---|---|
| ΔPMS das articuladas (1.2, B.1), intervalos 80 / 51,43 / 40 / 25,714°, ordem do R-4360, balanço | Apêndice B | 34/34 (ΔPMS a ±0,023°) |
| f_ign/BPF: Yak, T-6, DC-3, P-47, Corsair | 3,42 / 2,25 / 4,15 / 4,5 / 5,14 ± 1% | 3,419 / 2,250 / 4,148 / 4,500 / 5,143 |
| bandas lenta 14 cil. a 10 m (DC-3), rel. 150–400 | +5 / −7,5 / −11 / −12,5 | +0,9 / −7,2 / −11,4 / −12,7 (**desvio** no grave) |
| bandas lenta 18 cil. coletor único + turbina a 5 m (P-47) | +5 / −6,5 / −12 / −10 | +2,5 / −2,8 / −12,2 / −13,0 |
| bandas lenta 9 cil. a 12 m (Yak-52) | +4 / −6 / −15 / −14 | +9,7 / −8,8 / −12,8 / −13,7 (**desvio** no grave) |
| bandas lenta 9 cil. a 4 m (T-6G) | +12 / −1 / +2 / 0 | 0 / −0,7 / +2,9 / +2,5 (**desvio** no grave) |
| bandas lenta 18 cil. estaques a 8 m (Corsair) | −4 / −5 / −9 / −14,5 | +1,1 / −10,6 / −12,6 / −12,6 (**desvio**) |
| bandas lenta 7 cil. a 4 m (Rotec) | +3 / −8 / −4 / −6 | −1,3 / +1,0 / +3,3 / +1,8 (**desvio**; com o redutor 3:2 da ficha corrigida na auditoria: antes, com a hélice direta, o grave dava +10,2) |
| bandas decolagem Yak (75 m), T-6 (50 m), Corsair (150 m) | ver 4.1 | grave da BPF 3–11 dB acima, agudo 4–10 dB abaixo (**desvio**) |
| centroides (lenta DC-3, Yak, P-47, Corsair; decolagem T-6) | ±30% | 360 / 351 / 365 / 375 / 794 Hz |
| R-2800 estaques na lenta: 4,5ª contra a 9ª · P-47: 9ª contra a 4,5ª | ≥ −3 · ≥ 0 dB | +2,6 · +24,5 dB |
| Corsair decolagem: 4,5ª contra a 9ª | ≥ +8 dB | +20,8 dB |
| Yak decolagem: BPF contra a ignição · harmônicos 1–3 | ≥ +5 · dentro de 8 dB | +14,8 · 5,2 dB |
| T-6 decolagem: harmônicos 5–9 contra a ignição · entre si | ≥ +10 · dentro de 6 dB | +16,6 · 6,6 dB (**desvio**, 0,6 dB) |
| lenta a 12 m: harmônicos 2–5 da BPF contra a ignição (DC-3, Yak) | −10 ± 5 dB | −6,3 / −15,0 dB |
| lenta → plena a 55% (bocas a 5 m): R-1830, M-14P, R-1340, R-2800 | +18 a +25 dB | +18,7 / +22,2 / +13,8 / +17,5 (**desvio** nos dois últimos) |
| vagar da lenta (Yak, Corsair, P-47) | 2–4% (P-47 ≤ 7) | 3,6 / 2,3 / 0,6% |
| CVciclo da lenta (Yak, T-6G, DC-3) | 0,30–0,42 | 0,32 / 0,37 / 0,37 |
| R-1830: apito do arranque de inércia | 290 → 390 Hz em 15–20 s | 299 → 375 Hz em 16,0 s |
| R-1830: CVciclo nos 3 s em que pega (de 0,5 s antes a 2,5 s depois, a janela da gravação) · aos 20 s | 0,6–1,1 (A.3: P-47 0,62, DC-3 0,80, R-2800 1,06, SBD 1,11) · ≤ 0,45 | 0,62 · 0,36 (o 1,02 de antes vinha dos estouros) |
| R-1830 com primer 2: estouros nos 10 s depois de pegar | 3–8 | 4 |
| estouros nos 20 s depois de pegar, picos > 20 dB (R-1820, R-1830, R-2800, P-47) | ≤ 6 (gravações 0–6) | 5 / 5 / 3 / 4 (antes 22 / 32 / 28 / 32) |
| picos > 16 dB por segundo: 20 s depois de pegar · acelerando e desacelerando a frio | ≤ 0,75 · ≤ 0,5 | 0,20–0,30 · 0–0,18 (antes 1,2–2,1 · 0,2–3,8) |
| lenta quente: picos por segundo (R-1820, R-1830, R-2800, P-47; M-14P) | ≤ 3, nenhum > 16 dB | 0 / 0 / 0,09 / 0; 7,3 (**desvio**) |
| R-2800: uivo do superalimentador a 800 e 2 700 rpm | 1 621 e 5 472 Hz ± 2%; ≤ −25 dB do total | 1 620 e 5 476 Hz; −42,8 e −40,8 dB |
| mag check a 1 700 rpm (R-1340): queda esq/dir, diferença | 60 ± 30; ≤ 30 rpm | 74 / 83; 8 rpm |
| mistura 0,55: potência · escape | −3 a −7% · +40 a +80 °C | −5,0% · +60 °C |
| mecânica do radial contra o mesmo motor a água | 1,4× | 1,40× |
| R-2800: governador da hélice na decolagem | 1 225 rpm ± 2% | 1 226 rpm |
| potência (R-1820, R-1830, R-2800, R-4360, M-14P, R-1340; média de 2 s por ponto) | ficha ± 5% | −1,5 / −0,6 / +1,3 / −1,0 / −1,5 / +0,9% |
| Cessna 172: lenta quente a 20 e −5 °C · decolagem a 35 m/s | 650 ± 20 rpm · BPF ≈ 90 Hz, M 0,80, f_ign/BPF 1 | 646 / 646 · 88,5 Hz, 0,79, 1,001 |
| R44 (O-540 + rotor): Nr · droop (0,5 → 0,75 em 1 s) · recuperação | 408 ± 2% · 2–3% · ≤ 1,5 s | 408,0 · 0,6% (**desvio**) · 0,7 s |
| R-4360, 10 s subindo de giro em Node (`cpu:radial`) | ≤ 60% | 24% (tempo de CPU; 44–53% com a máquina ocupada) |
| bandas da lenta pela página (Yak, T-6G, DC-3, P-47, Corsair, Rotec) | os mesmos alvos | 2 a 11 dB abaixo acima de 400 Hz (Rotec 2–6 dB acima) (**desvios**, T-RAD-05) |
| lenta quente pela página: picos por segundo (Rotec R2800/R3600, Verner 3V/5S, M-14PF, Sherman; C172, O-360, O-200, Rotax 912, R22, 300C) | ≤ 3, ≤ 0,3/s acima de 16 dB | 19 / 9,7 / 11,6 / 15,4 / 10,3 / 15; 19–24 (**desvios**, T-RAD-06); IO-540, IO-550, Bell 47 e R44 passam |
| Sherman: velocidade no corte em cada marcha (conta da ficha) | 5ª 39 km/h ± 5% | 3,8 / 9,3 / 16,2 / 26,0 / 39,5 km/h |
| lenta de 16 radiais (sem a Megola) e dos 10 de aviação a 20 e −5 °C | zero apagamentos, ±3% | 52/52 |

### Desvios conhecidos

- **Grave da lenta perto e agudo dos estaques.** O T-6G a 4 m tem a 2·BPF da hélice direta (61 Hz) e a ignição fortes no grave; no modelo a hélice na lenta é ∝ M⁴ e o grave fica 12 dB abaixo. O Rotec (estaques de 38 mm sem nada depois) fica 7–9 dB mais brilhante: o `Radiator` do Ronco irradia a derivada da vazão e o chiado da boca estreita; falta um modelo de boca de estaque curto.
- **Decolagem.** A hélice de ponta quase sônica do T-6 e o escape dos estaques do Corsair têm na gravação mais agudo (1–6 kHz) do que a `FonteHelice` (a do JetDSP, sem ruído de choque) e o escape do modelo dão; a BPF fundamental deixa o grave 3–11 dB acima.
- **Galope com o PI de lenta.** A decisão 10 manteve o controle de lenta do Ronco: ele corrige o balanço lento, e o vagar do DC-3 (J 19 kg·m²) fica em 0,3%; o CVciclo bate.
- **Partida.** O EngineDSP só queima acima de 60 rpm no arranque: o volante de inércia gira o R-1830 a 80–95 rpm (9 pás em 3,2 s, contra 4–6) e o ar comprimido gira o M-14P a ~180 rpm (13,5 "tchufs"/s, contra 7–11).
- **R44.** A borboleta do Ronco responde em 30 ms: o droop é 0,7% (contra 2–3%), com a volta em 1,1 s.
- **M-14P na lenta.** 7,3 picos por segundo no agudo (0,64 acima de 16 dB, curtose 9) contra 2,5/s do Yak-52 (Commons, codec saturando), sem nenhum estouro injetado: são as explosões fortes do galope de boia (×2,6 sobre a dispersão do carburador do Ronco) saindo como estalos no chiado do jato das duas saídas curtas (∝ v²); sem o chiado, 2,3/s. A outra gravação de boia (T-6G a 4 m) tem 10/s e o R-1340 do modelo 0,7/s: com as duas em sentidos opostos, o galope não mudou (com menos dispersão o CVciclo do Yak e do T-6G cai abaixo de 0,30). Frio (CHT 15–35 °C, os primeiros minutos na página) ele chega a 16/s.
- **Faixa dos 13 aviões a 12 m.** O alvo de 12 dB não cabe nos `nivelEscape` do próprio RADIAL.md (Verner 124 e R-1820 145 dB de L_W): a faixa medida é 38 dB.
- **Desvios das fórmulas do RADIAL.md, anotados no código:** ordem do 3 cilindros `1-3-2` (a `1-2-3` da tabela 1.1 dispara a 120-120-480°); intervalos do 9 cilindros 80 ± 7,2° (os ΔPMS da própria tabela 1.2 somados; o texto diz ±5°); `qMix` com o fator pobre (a fórmula de 2.2 dava 1 com 0,55); um magneto ×1,6 na queima (com ×1,2 o mag check caía 18 rpm); ar de partida ×0,3 da vazão do texto e janela de 3–100° (com 5–60° o motor parado ficava num buraco sem cilindro recebendo ar); arranque direto 3,2× o atrito frio; passo mínimo absorvendo 90% da potência (com 25% o R-2800 subia em 1 s); `FAMILIES` do Ronco sem a Aviação (ela fica em `PRESETS_AVIACAO`/`FAMILIA_AVIACAO`, e a página usa `PRESETS_PAGINA`), porque a paridade confere os 68 e as 9 famílias contra o legado.
- **Aproximações declaradas:** Monaco-Trossi em 4 tempos (o ciclo de 360° do `EngineDSP` só existe com `cc`); Megola (a panorâmica dos estaques gira com a roda; a "lenta" é a roda empurrada); Sherman sem o ruído da esteira.
- **Fichas corrigidas em 22/11/2026** (AUDITORIA F-RAD-02 a F-RAD-04): Verner 5S com 3,39 L, 7,8 e 61 kW a 2 300 rpm, com o arranque elétrico direto vencendo também 1,3× o pico de compressão de um cilindro (≈ 0,11·p₀·V_cil·cr^1,3: com o arranque só pelo atrito o 5S balançava abaixo de 60 rpm e não pegava; o 3V passou a pegar em 2,9 s em vez de 4,9); S-55 com o rotor a 199 rpm (caixa 11,3155:1); Sherman com a redução final 2,84 × 3,53 = 10,03 (5ª a 39,5 km/h).

### Pendente (TODO)

- Boca de estaque curto (Rotec, M-14PF, Corsair) e ruído de choque da hélice de ponta sônica (T-6), para o agudo da lenta perto e da decolagem.
- Hélice na lenta com um termo de carga (o "canto" do DC-3 a 3 m).
- Ford Trimotor com 3 instâncias (opcional no RADIAL.md) e a passagem com altitude no ouvinte `road` da página.
- Som do rotor na página do Ronco (na Passagem o rotor é o do portador).
- Monaco-Trossi em 2 tempos a centelha, quando o ciclo de 360° existir sem `cc`.
- Estaques curtos e estreitos (Rotec, Verner, M-14PF) na lenta: o chiado do jato e a turbulência da válvula saem crus pela boca e viram um estalo por explosão (Rotec: 19 picos por segundo no agudo, 16 acima de 16 dB, curtose 97, contra 5,9/s, 0,17/s e 6 da gravação, com o espectro médio certo na página). É a mesma falta da boca de estaque curto (acima); atenuar o jato só tira o agudo do espectro, que já bate. O M-14P frio (acima) idem.

## Rotativos

O projeto está em [`ROTATIVO.md`](ROTATIVO.md); aqui fica o que foi feito, como e o que se mediu. Página `rotativo.html` (`src/pages/rotativo/`), DSP em `src/engines/rotativo/`, worklet `src/worklet/processador-rotativo.ts` (`rotativo-engine`: o `RotativosDSP`, que toca o Wankel/X-Engine ou o motor de palhetas conforme a configuração; e `palhetas-engine`).

### Como estende o Ronco

`RotativoDSP extends EngineDSP`, como o Diesel e o Radial. O `EngineDSP` ganhou a flag neutra `rot` (falsa no Ronco), o ciclo da câmara `cyc` (720 no pistão: os `720/360/540/180` do laço viraram `cyc`, `cyc/2`, `3·cyc/4`, `cyc/4`, os mesmos doubles) e ramos `if (this.rot) {…} else {linha original}` nos pontos da tabela 1.6 do ROTATIVO.md, todos comentados "rotativo":

| Gancho | Onde | O que faz |
|---|---|---|
| 1 | construtor | `rot = false; cyc = 720` |
| 2 | `setConfig` | `Vd` = `V_cam` de R/e/b e `bore` = ∛(4·V_cam/π) (13B: 94,1 mm) |
| 3 | `setConfig`, laço | o ângulo da câmara, a centelha (arma de `cyc/2` a `3·cyc/4`), a Wiebe e o `theta` em `cyc` |
| 4, 5 | `burn`, `hwr` | queima × `kBurn` (1,5·kVelas, mais o vácuo); perda de calor × 1,6 (câmara alongada) |
| 6, 7, 8 | centelha | falha por câmara (`falhaRot[c]`: a diluição pela sobreposição, ver a rodada de som), a fração fHC do calor guardada para o escape (`rotQueima`), estouro de uma falha (`prRot`) |
| 9 | válvulas | os tiques do ápice nas bordas das janelas e nas velas; o ar zera no IO (`rotJanelas`) |
| 11 | volume | `V = V_min + (V_cam/2)·(1 − cos(kVol·α))`, `kVol` 2/3 (Wankel) ou 1 (X-Engine) |
| 12, 14 | escape, admissão | janelas trapezoidais (`rotEscape`, `rotAdmissao`), admissão secundária/auxiliar pela rotação |
| — | densidade do pulso | `rotDens`: a referência do Ronco (1 650 K) com teto 1,8 (o 1,3 do Ronco achataria o gás do Wankel em plena carga) |
| 13 | primário | um tubo por rotor: zerado uma vez por amostra (`runRot`) e as 3 câmaras somam; mais a pós-queima presa ao evento (`posQueima`) |
| 15, 16 | `vib`, `mech` | só a ordem 1 residual (0,1); a engrenagem fixa (34 dentes), o chiado das vedações e o 2º turbo do sequencial (`mechRot`) |
| — | turbo | `rotApito`: o apito do Ronco atenuado por `kApito` (o ramo `rot` em volta da linha do apito) |
| 17, 19 | `tBurn`, telemetria | parede do coletor `min(1 050, 250 + 800·√(rpm/rpmMax)·(p/p₀)^0,6)`; câmara, janelas, velas, gás, fHC, estouros, secundário, traço p–α |

`git diff --stat` do `dsp.ts` do Ronco contra a base da etapa (`615dbce`): 41 linhas a mais, 18 trocadas (59 < 70). `npm run paridade:ronco` (200 cenários) e `--dist` idênticos; `v16 rev` e `muscle wot` sem perda de tempo (1,9 s e 2,2 s, contra 2,4 s e 3,3 s antes, máquina ocupada). Nenhum outro arquivo do Ronco mudou.

O resto é a subclasse: `tune` (janelas, velas, áreas em boreEq², CR com o teto 24, primário com o Ø da ficha, atrito com 2× a cilindrada nominal, borboleta maior, reator, sequencial), `control` (`super.control` + o avanço do rotativo, −5 + 30·rf °e, pelo caminho do atraso de aquecimento; janelas secundárias; falhas; turbo sequencial), `buildExhaust` inteiro (serie, megafone, 2em1, duplo, reator; `DoisPortasRotativo` em `escape.ts` para pré-silencioso, catalisador e reator), `buildFilters`, `calibrate`, `measurePower`, `volume`.

### Decisões e desvios do ROTATIVO.md tomados na implementação

- **Pós-queima só onde o gás está quente** (revista na rodada de som de 11/2026; antes eram três pontos, com 45% na boca). O fHC sai da câmara na abertura e volta como fonte de volume `ṁ = (γ−1)/γ·Q̇/(R·T)` com envoltória de 2/12 ms presa ao evento, × `kHC` = 0,85: metade no primário do rotor (`kPrim` 0,5), um quinto no ponto quente depois do downpipe (`kQuente` 0,2, com a envoltória espalhada por `hcEspalha` = 9 ms); o resto sai cru ou é oxidado sem ruído no catalisador. É a **expansão** do gás que queima: a parte lisa, igual em todo ciclo, reforça o pulso e é tom; só a flutuação turbulenta da chama (`hcTurb` 0,2 ≈ 10% rms) é ruído, e nasce dentro do tubo. Na boca não queima nada de fábrica (`kBoca` 0, controle "Chama na boca").
- **fHC pelo vácuo**, não pela distância à rotação de lenta: `0,08·leve·slowB/2,4 + 0,015`, `leve` = (0,85 − p/p₀)/0,55. A lenta (8%) e a plena carga (1,5%) ficam iguais; a carga leve em giro alto ganha a pós-queima (o HC do Wankel vem do apagamento da chama nas vedações, que piora com a carga leve).
- **Atrito com 2× a cilindrada nominal**: o Ronco faz T = pme·V/(4π) com V o volume varrido em 720°; o Wankel varre 2·rotores·V_cam em 720°. Sem isso a lenta pedia pouco ar e a câmara chegava à abertura a 1,1–1,4 bar (alvo 1,5–2,5).
- **Queima mais lenta no vácuo**: `kBurn × (1 + 1,65·vácuo)` (o gás queimado que passa de um ciclo para o outro pelo rebaixo do flanco); dá os 95–110°e de 10–90% na lenta.
- **Dispersão por flanco 2,5× a do Ronco e por rotor ±4%/±6% × 3**, mais a variação explosão a explosão ×3,5 (CVciclo 0,22 na lenta, como a gravação; com a do pistão saía 0,07). O 787B: flanco ×1, primários iguais (o 0,4% de diferença de comprimento entre os primários de um 4 em 1 punha a ordem 1 a +20 dB).
- **Lenta das janelas de competição pela diluição** (revista na rodada de som; antes um sorteio que crescia com o vácuo, a rotação caindo e a parede do coletor esfriando). O laço acompanha a fração de gás queimado em cada câmara, na região da janela de escape de cada rotor e no duto de admissão (com o plenum comum); a carga com mais de ~0,44–0,48 de gás queimado não acende. Com bridge e periférica cada câmara alterna queima e falha: o "brap" a rpm/360. Ver a rodada de som abaixo.
- **Calibração com o escape de fábrica do preset** (a doc pedia a série de referência; a sonda da lenta agora faz a média de 2 s, depois de 1,2 s: a janela de 0,4 s caía em pontos diferentes da oscilação do laço do ar de lenta e o reforço saía até 4 dB fora): com topologias tão diferentes (megafone sem abafador × dois silenciosos), a série de referência deixava a lenta 4–10 dB fora dos 21 dB abaixo da carga e 37 dB de faixa entre os carros. Agora a plena carga de fábrica de cada preset vai ao alvo e o reforço de lenta é medido com o mesmo escape; o que o usuário muda (tirar o pré-silencioso, trocar o abafador) muda o volume em relação à fábrica. Sem preset de fábrica, a série de referência. A potência é medida com o escape do próprio preset e com a média do torque em 0,3 s.
- **X-Engine**: IC 620 (80° depois do PMI; o documento traz ≈ 560 das patentes) para a expansão prolongada dar 1,3–1,6 bar na abertura; borboleta ×1,6 (o fechamento tardio devolve carga ao coletor). O XTS-210 é diesel no real: aqui centelha com CR 18 (teto 24), etiqueta "aproximação (ciclo SI)".
- **Aviação** pelos ganchos `av` do Ronco (`instalarAviacao`: magnetos, mistura, a carga de bancada da hélice ou do rotor e o som da hélice na página). Borboleta ×1,5 (×3 com hélice de passo fixo: o AR741 não segurava a lenta contra a hélice direta).
- **Palhetas**: `PalhetasDSP` (5.3) com o ar na entrada por um polo de 0,2 s, T₀ = 4·P/ω_livre, rotação livre corrigida pelo atrito, hospedeiro do arranque como carga com as compressões na frequência de ignição dele (Cat C15 simplificado: J 6 kg·m², 250 N·m de compressão).
- **Fichas**: o FD com a caixa do Type RS de 280 cv, 5ª de 0,762 e diferencial 4,3 (2 750 rpm a 100 km/h em 5ª, o alvo do teste; a 5ª de 0,761 com diferencial 4,1 que a ficha teve era a do FC Turbo II, e o alvo de 2 600 rpm vinha dela: `AUDITORIA.md`, F-ROT-06); o Ro 80 com a admissão lateral no lugar da periférica do KKM 612 (aproximação declarada; ver Pendente); o 787B com o mapa `burble` (o `popbang` dava 10–11 estouros/s, contra 3,5–7 medidos); os geradores do X-Engine com o alternador leve (0,002 e 0,08 kg·m²; com os 20 kg·m² do grupo de 500 kVA o motor de 70 cm³ não saía do arranque).
- **Apêndice B**: 3√3·15·105·80 mm³ = 654,7 cm³ (o apêndice escreve 654,3; 12A 572,9, 10A 491,0): dentro do ±0,5% do alvo.
- **Boca com ponteira** (`BocaRot` em `escape.ts`; revista na rodada de som). A ponteira (`escape.ponteira`, controle "Ponteira (jato)", de fábrica a boca do preset) segue separada do Ø da saída, mas deixou de só multiplicar o chiado: a saída mais fina que o resto do escape é um **orifício** (resistência `M₀·(1/σ² − 1)` pelo escoamento médio mais o termo do próprio pulso), que devolve o que não passa como contrapressão; o jato lê a velocidade na ponteira (área do tubo ÷ área da ponteira), satura na do som junto com o escoamento médio e tem teto contra o pulso irradiado. A irradiação é a de monopolo (ganho ∝ d, não d²).
- **`COMPAT`, `ADAPTADORES`, `USO_REAL`**: o rotativo entrou em rotor e gerador (as duas palavras que o documento pedia para relatar; a tarefa da etapa as incluiu) e nas listas de uso real (carro, hélice, rotor, gerador). `src/scene/dsp-cena.ts` monta o `MotorRotativo`; a Passagem ganhou o RX-7 na rua, o 787B em Hunaudières e o RQ-7 Shadow.

### Portadores e Cena

`MotorRotativo` (`src/engines/rotativo/motor.ts`) herda o `MotorPistaoBase` do Ronco: no carro, as fontes e posições do Ronco; na hélice e no rotor, a carga do portador vai ao eixo pelos ganchos de aviação e o motor começa na rotação dele; no gerador, a carga vai direto ao eixo (gancho 11) e o PI do portador manda o acelerador. Nível absoluto: carros e moto pela referência do Ronco (95 dB a 5 m), aviação, UAV e gerador pelo `nivelEscape`.

### Ferramentas e portões

`npm run teste:rotativo` (`tools/rotativo-valida.ts`, 16 grupos: 15 em paralelo e o de CPU sozinho no fim, ~110 s), `npm run lenta:rotativo` (16 presets × 20 °C e −5 °C, partida de verdade, acelerada aos 12 s), `npm run navegador:rotativo` (Chromium e Firefox, `dist/`). `tools/rotativo-bandas.ts` é a porta de `medir_w.py`/`pops.py` (FFT, Welch e mediana do radial; Hilbert, autocorrelação da envoltória, pente de 4 harmônicos, CVciclo, p90/p10, estalos): conferida nas gravações, dá os números do Apêndice A (RX-7 Commons 16–20 s: +1,6 / −0,9 / −10,9 / −10,5 / −16,5, 541 Hz, ign +18,8 / +17,2 / +23,9, CVc 0,23, p90/p10 6,8, 0,5 estalo/s; RX-8 a 5 000: vagar 11,6%, 787B a 7 700: 0,5%, 787B lenta: 15,1 estalos/s contra 15,8). `tools/rotativo-cena.ts` monta o preset no portador e ouve pela Cena. CPU: o R26B a 7 700 rpm em Node, 14% do tempo real (portão 45%).

Para a rodada de som (fora dos portões, usam o kit `tools/ouvido` e as gravações de `referencias/rotativo`, fora do git): `tools/rotativo-fontes.ts` (render na condição da gravação e o conjunto do orçamento por fonte com a mesma semente), `tools/rotativo-regua.py` + `rotativo-regua.json` (os casos casados e a tabela dos critérios), `tools/rotativo-varredura.sh` (Ø da saída e ponteira do mínimo ao máximo), `tools/rotativo-pulso.ts` (onde nascem e onde se perdem os harmônicos da ignição), `tools/rotativo-padrao.ts` (a sequência queimou/falhou da lenta), `tools/rotativo-periodico.ts` (a periodicidade com os ruídos desligados, lição da F1) e `tools/rotativo-espectro.py` (espectrogramas lado a lado de aceleradas).
### Alvo × medido (`npm run teste:rotativo`: 151 medidas: 135 ok, 16 desvios documentados, 0 falhas)

Desde a rodada de som de novembro de 2026 o agudo (1–2,5 kHz e 2,5–6 kHz) é conferido com a gravação como **teto** (o viés do dono: mais motor, menos ar; mais limpo que a gravação passa) e o grupo `ar` mede os critérios da rodada sem gravação.

| Grupo | Medida | Alvo | Medido |
|---|---|---|---|
| geometria | V_cam 13B = 3√3·e·R·b | 654,3 cm³ ± 0,5% | 654,7 cm³ (+0,06%) |
| geometria | V_cam 12A = 3√3·e·R·b | 572,5 cm³ ± 0,5% | 572,9 cm³ (+0,07%) |
| geometria | V_cam 10A = 3√3·e·R·b | 490,7 cm³ ± 0,5% | 491,0 cm³ (+0,07%) |
| geometria | V_cam KKM 612 = 3√3·e·R·b | 497,5 cm³ ± 0,5% | 497,6 cm³ (+0,02%) |
| geometria | V_cam Sachs/Norton = 3√3·e·R·b | 294 cm³ ± 0,5% | 294,1 cm³ (+0,03%) |
| geometria | V_cam AR741 = 3√3·e·R·b | 208 cm³ ± 0,5% | 207,9 cm³ (-0,03%) |
| geometria | V(0) = V_min, V(270°e) = V_min + V_cam, V(540°e) = V_min (13B, CR 9) | ±1e-9 | 0,000000000000 / 0,000000000000 / 0,000000000000 |
| geometria | V_min do 13B com CR 9,0 / 9,4 / 10,0 | 81,8 / 77,9 / 72,7 cm³ | 81,8 / 77,9 / 72,7 |
| geometria | dV/dα máximo do 13B (a 135°e) | 218 cm³/rad | 218,2 cm³/rad |
| geometria | ∮ p dV de um ciclo motorizado (sem queima) | 0 ± 1% | +0,0000% |
| geometria | fases de 1 rotor(es): intervalo de ignição | 360°e exatos | 360°e · fire 0 360 720 |
| geometria | fases de 2 rotor(es): intervalo de ignição | 180°e exatos | 180°e · fire 0 360 720 180 540 900 |
| geometria | fases de 3 rotor(es): intervalo de ignição | 120°e exatos | 120°e · fire 0 360 720 120 480 840 240 600 960 |
| geometria | fases de 4 rotor(es): intervalo de ignição | 90°e exatos | 90°e · fire 0 360 720 90 450 810 180 540 900 270 630 990 |
| geometria | f_ign no render, ae50r a 4000 rpm | 66,67 Hz ± 0,5% (1 por volta) | 66,64 Hz (-0,04%) |
| geometria | f_ign no render, rx8hp a 5000 rpm | 166,67 Hz ± 0,5% (2 por volta) | 166,96 Hz (+0,18%) |
| geometria | f_ign no render, cosmo20b a 4000 rpm | 200,00 Hz ± 0,5% (3 por volta) | 199,99 Hz (-0,01%) |
| geometria | f_ign no render, r26b a 6000 rpm | 400,00 Hz ± 0,5% (4 por volta) | 399,91 Hz (-0,02%) |
| geometria | f_ign no render, xmini a 12000 rpm | 300,00 Hz ± 0,5% (1,5 por volta) | 300,08 Hz (+0,03%) |
| ciclo | rx7fd lenta 750 rpm quente: pressão na abertura do escape | 1,5–2,5 bar | 2,04 bar |
| ciclo | rx7fd lenta: 10–90% da queima | ≈ 100°e (90–110) | 94°e |
| ciclo | rx7fd (turbo 0,7 bar) plena carga: pressão na abertura | aspirado a 55%: 3–5,5 bar (≈ 4 no projeto); nos outros > 3 bar | 9,42 bar · boost 0,70 bar |
| ciclo | rx7fd (turbo 0,7 bar) plena carga: Mach do jato no 1º terço da rampa | Mach 1 | 1,00 |
| ciclo | rx7fd (turbo 0,7 bar) plena carga: 10–90% da queima | 46–62°e (o projeto dá 50–60; a 55% a fórmula dá 48) | 48°e |
| ciclo | rx7fd (turbo 0,7 bar) plena carga: parede do coletor (tEscape) depois de 12 s | 880–1 050 °C (o projeto dá 900–1 000) | 1008 °C |
| ciclo | rx7fd (turbo 0,7 bar) plena carga: gás na abertura e o fator de densidade | fator < teto 1,8 (o 1,3 do Ronco achataria) | 1678 K · máx. 1,32 |
| ciclo | rx8hp (aspirado) plena carga: pressão na abertura | aspirado a 55%: 3–5,5 bar (≈ 4 no projeto); nos outros > 3 bar | 3,95 bar · boost 0,00 bar |
| ciclo | rx8hp (aspirado) plena carga: Mach do jato no 1º terço da rampa | Mach 1 | 1,00 |
| ciclo | rx8hp (aspirado) plena carga: 10–90% da queima | 46–62°e (o projeto dá 50–60; a 55% a fórmula dá 48) | 48°e |
| ciclo | rx8hp (aspirado) plena carga: gás na abertura e o fator de densidade | fator < teto 1,8 (o 1,3 do Ronco achataria) | 1340 K · máx. 1,04 |
| ciclo | rx8hp a 80% de rpmMax plena carga: pressão na abertura | aspirado a 55%: 3–5,5 bar (≈ 4 no projeto); nos outros > 3 bar | 3,87 bar · boost 0,00 bar |
| ciclo | rx8hp a 80% de rpmMax plena carga: Mach do jato no 1º terço da rampa | Mach 1 | 1,00 |
| ciclo | rx8hp a 80% de rpmMax plena carga: 10–90% da queima | 46–62°e (o projeto dá 50–60; a 55% a fórmula dá 48) | 54°e |
| ciclo | rx8hp a 80% de rpmMax plena carga: parede do coletor (tEscape) depois de 12 s | 880–1 050 °C (o projeto dá 900–1 000) | 936 °C |
| ciclo | rx8hp a 80% de rpmMax plena carga: gás na abertura e o fator de densidade | fator < teto 1,8 (o 1,3 do Ronco achataria) | 1302 K · máx. 0,99 |
| ciclo | rx7fd lenta: parede do coletor (tEscape) | 400–500 °C | 434 °C |
| bandas | bandas lenta 2 rotores de rua 750 rpm (rx7fc, ext) contra o FC3S casado | +8,9 / -17,2 ±7; agudo ≤ -35,2 / -41,0 +4 (teto) | +4,6 / -12,6 / -36,7 / -40,5 |
| bandas | rx7fd lenta: 1–2,5 kHz e 2,5–6 kHz (rel. 150–400) | ≤ −27 / ≤ −33 dB (teto do FC3S + 8) | -27,7 / -47,0 dB |
| bandas | rx7fd lenta, pré-silencioso retirado: 1–2,5 kHz e 2,5–6 kHz sobem (absoluto) | ≥ 6 dB | +6,5 / +10,3 dB |
| bandas | rx7fd lenta, pré-silencioso retirado: 2·ign sobe | ≥ 4 dB | -1,1 dB (linha sobre a mediana) (**desvio**) |
| bandas | rx7fd lenta: ruído de jato da ponta em 150 Hz–1 kHz (Ø de fábrica / Ø 25 mm com a ponteira de fábrica) | ≤ 10% / ≤ 10% | 0,0% / 0,0% |
| bandas | bandas 5 000 rpm sustentados, Renesis (rx8hp, ext) contra o RX-8 do Commons | -8,0 / -10,0 ±7; agudo ≤ -11,0 / -10,5 +4 (teto) | -13,7 / -10,2 / -29,1 / -35,6 |
| bandas | bandas 7 700 rpm em neutro, 4 rotores megafone (r26b) | -6,5 / +20,0 / +19,0 / +6,7 ±4 | -8,9 / +12,9 / +2,7 / -3,8 (6–12k -23,2: física) (**desvio**) |
| bandas | centroide 7 700 rpm em neutro, 4 rotores megafone (r26b) | 930–930 Hz ±30% | 627 Hz (**desvio**) |
| bandas | bandas lenta 4 rotores periférica (r26b) | +3,5 / -7,5 ±7; agudo ≤ -15,5 / -16,0 +4 (teto) | -4,3 / -7,6 / -14,9 / -16,3 (**desvio**) |
| bandas | bandas lenta 2 rotores moto 1 900 rpm (norton) | +9,5 / -2,5 ±7; agudo ≤ -4,5 / -12,5 +4 (teto) | -7,6 / -4,2 / -16,9 / -38,8 (**desvio**) |
| bandas | bandas lenta fria carburada 1 600 rpm (ro80) | -2,0 / -10,0 ±7; agudo ≤ -12,0 / -20,0 +4 (teto) | +1,5 / -7,0 / -22,0 / -31,4 |
| ar | rx7fc lenta: jato, chiado de admissão, vedações e chiado do turbo desligados juntos | muda o nível ponderado A em < 1,5 dB | +0,01 dB |
| ar | rx7fc 3 000 rpm em ponto morto: jato, chiado de admissão, vedações e chiado do turbo desligados juntos | muda o nível ponderado A em < 1,5 dB | +0,01 dB |
| ar | rx7fd lenta: jato, chiado de admissão, vedações e chiado do turbo desligados juntos | muda o nível ponderado A em < 1,5 dB | +0,00 dB |
| ar | rx7fd 3 000 rpm em ponto morto: jato, chiado de admissão, vedações e chiado do turbo desligados juntos | muda o nível ponderado A em < 1,5 dB | +0,00 dB |
| ar | rx8hp lenta: jato, chiado de admissão, vedações e chiado do turbo desligados juntos | muda o nível ponderado A em < 1,5 dB | +0,02 dB |
| ar | rx8hp 3 000 rpm em ponto morto: jato, chiado de admissão, vedações e chiado do turbo desligados juntos | muda o nível ponderado A em < 1,5 dB | +0,03 dB |
| ar | cosmo20b lenta: jato, chiado de admissão, vedações e chiado do turbo desligados juntos | muda o nível ponderado A em < 1,5 dB | +0,00 dB |
| ar | cosmo20b 3 000 rpm em ponto morto: jato, chiado de admissão, vedações e chiado do turbo desligados juntos | muda o nível ponderado A em < 1,5 dB | +0,00 dB |
| ar | r26b lenta: jato, chiado de admissão, vedações e chiado do turbo desligados juntos | muda o nível ponderado A em < 1,5 dB | +0,00 dB |
| ar | r26b 3 000 rpm em ponto morto: jato, chiado de admissão, vedações e chiado do turbo desligados juntos | muda o nível ponderado A em < 1,5 dB | +0,00 dB |
| ar | rx7fc lenta, ponteira 20 mm: chiado do jato no nível ponderado A | ≤ 35% (em posição nenhuma é a fonte dominante) | 2% |
| ar | rx7fc lenta, saída 20 mm: chiado do jato no nível ponderado A | ≤ 35% (em posição nenhuma é a fonte dominante) | 0% |
| ar | rx7fc lenta, saída e ponteira 20 mm: chiado do jato no nível ponderado A | ≤ 35% (em posição nenhuma é a fonte dominante) | 0% |
| ar | rx7fc 3 000 rpm em ponto morto, ponteira 20 mm: chiado do jato no nível ponderado A | ≤ 35% (em posição nenhuma é a fonte dominante) | 1% |
| ar | rx7fc 3 000 rpm em ponto morto, saída 20 mm: chiado do jato no nível ponderado A | ≤ 35% (em posição nenhuma é a fonte dominante) | 0% |
| ar | rx7fc 3 000 rpm em ponto morto, saída e ponteira 20 mm: chiado do jato no nível ponderado A | ≤ 35% (em posição nenhuma é a fonte dominante) | 0% |
| ar | rx7fc 5 000 rpm em plena carga, ponteira 20 mm: chiado do jato no nível ponderado A | ≤ 35% (em posição nenhuma é a fonte dominante) | 0% |
| ar | rx7fc 5 000 rpm em plena carga, saída 20 mm: chiado do jato no nível ponderado A | ≤ 35% (em posição nenhuma é a fonte dominante) | 0% |
| ar | rx7fc 5 000 rpm em plena carga, saída e ponteira 20 mm: chiado do jato no nível ponderado A | ≤ 35% (em posição nenhuma é a fonte dominante) | 0% |
| ar | rx7fc, ponteira no mínimo (20 mm num escape de 70): o pulso, sem o chiado, na lenta / em plena carga a 5 000 rpm | cai nos dois, e pelo menos 6 dB a mais em carga (a contrapressão amolece o pulso com o escoamento) | -7,7 / -18,1 dB |
| linhas | rx7fd lenta: harmônicos 1–3 da ignição | dentro de 6 dB (gravação +19 / +17 / +24) | +11,3 / +16,8 / +14,2 |
| linhas | rx7fd na rotação da lenta, eixo travado: banda lateral de meia-ordem (±rpm/120 em volta de 2·ign e 3·ign) | ≤ +3 dB sobre o piso, com a portadora ≥ 15 dB acima dele (o Wankel não tem o ciclo de 720°) | +1,1 dB (portadora +23,8 dB, 750 rpm) |
| linhas | rx7fd na rotação da lenta: a mesma medida no trecho modulado em 720° (controle: 30% a rpm/120) | ≥ +8 dB (a medida enxerga a meia-ordem quando ela existe) | +11,0 dB |
| linhas | rx8hp 5 000 rpm: ignição sobre a mediana | +27 ± 4 dB | +26,9 dB |
| linhas | rx8hp 5 000 rpm: ordem 1 contra a ignição | −15 ± 5 dB | -19,0 dB |
| linhas | rx8hp 5 000 rpm: ordens 2/3 e 5/3 contra a ignição | −16 ± 5 dB | -20,9 / -23,7 dB (**desvio**) |
| linhas | r26b 7 700 rpm: ignição sobre a mediana | ≥ +22 dB | +31,1 dB |
| linhas | r26b 7 700 rpm: ordem 1 contra a ignição | ≤ −10 dB (na gravação casada a banda de 60–150 Hz inteira fica 27 dB abaixo da ignição) | -20,3 dB |
| linhas | r26b 7 700 rpm: 2·ign contra a ignição | −6 dB (±4) | -8,2 dB |
| lenta | lenta original quente (rx7fd): vagar | ≤ 3% | 0,9% |
| lenta | lenta original quente (rx7fd): CVciclo | 0,20–0,30 | 0,22 |
| lenta | lenta original quente (rx7fd): estalos/s além das próprias explosões | ≤ 1,5 (o detector conta até um pico por ignição) | 0,0 (25,0 picos/s; ignição 25,0/s) |
| lenta | lenta original quente (rx7fd): p90/p10 de 1–6 kHz (o agudo preso ao pulso) | ≥ 7 dB (a gravação é piso de pulso) | 29,2 dB |
| lenta | lenta original quente (rx7fd): desvio/média da envoltória de 1–6 kHz (o agudo preso ao pulso) | ≥ 0,5 | 1,85 |
| lenta | lenta periférica (r26b): faixa da caça | 1 450–2 350 rpm, sem apagar (a gravação caça de 1 600 a 2 200) | 1689–2070 rpm |
| lenta | lenta periférica (r26b): vagar em 12 s (o método das gravações) | ≥ 20% | 3,7% (pela telemetria, janelas de 1 s: 3,5%) (**desvio**) |
| lenta | lenta periférica (r26b): CVciclo | ≥ 0,40 | 0,59 |
| lenta | lenta periférica (r26b): estalos/s | 5–16 (as rajadas do "brap" a ~5 Hz, com um a três picos cada) | 16,0 (estouros soltos criados: 0,2/s) |
| lenta | lenta periférica (r26b): fração das explosões que queimam | 35–70% (rajadas, não falhas soltas) | 53% |
| lenta | lenta periférica (r26b): ritmo do "brap" (autocorrelação da sequência queimou/falhou a 3 e a 6 voltas do eixo) | ≤ −0,5 a 3 voltas e ≥ +0,4 a 6 (rpm/360: 5,2 Hz na gravação) | -0,86 / +0,72 |
| lenta | street port (rx7fd, sobreposição 28°e): lenta estável | vagar ≤ 3% | 1,0% · 751 rpm |
| lenta | bridge port (rx7fc, sobreposição 98°e, lenta a 1 950): em rajadas, sem apagar | 40–75% das explosões queimam; 1 450–2 350 rpm | 60% · 1805–2090 rpm |
| lenta | janelas de fábrica (rx7fc): a mistura acende sempre | ≥ 99% das explosões | 99,0% |
| estouros | desaceleração rx8hp ('burble'): estouros/s | 4–6 | 2,0 criados · 18,5 detectados (altura 12,5 dB) a 4075 rpm (**desvio**) |
| estouros | desaceleração r26b ('burble', periférico): estouros/s (criados, média de 3 sorteios) | 3,5–7,5 | 5,3 criados (5,0 / 4,5 / 6,5) · 10,0 detectados (altura 29,4 dB) a 3721 rpm |
| turbo | rx7fd sweep: queda do boost na troca do turbo (4 500 ± 100 rpm) | 0,1–0,2 bar por 0,15–0,4 s | 0,17 bar · 0,24 s (em 4502 rpm) |
| turbo | rx7fd sweep: boost de 3 000 a 8 000 rpm (fora do soluço) | 0,60–0,78 bar (a ficha dá 0,7) | 0,67–0,70 bar |
| turbo | rx8hp: degraus das janelas secundária e auxiliar | 3 750 e 6 250 ± 50 rpm | 3800 e 6300 rpm (AinMax ×1,00 → ×1,68 → ×2,24) |
| mecanica | vibração na lenta: rx8hp contra ek9 (Ronco) | 10–15 dB abaixo | -6,9 dB (**desvio**) |
| mecanica | vibração na lenta: rx8hp contra mx5 (Ronco) | 10–15 dB abaixo | -7,3 dB (**desvio**) |
| mecanica | tiques das vedações em lenta (rx8hp no cofre, sem pós-queima): p90/p10 de 2–6 kHz | ≤ 12 dB (fundidos, sem cliques contáveis) | 6,6 dB |
| mecanica | rx8hp no cofre, eixo travado na rotação da lenta: banda lateral de meia-ordem (±rpm/120 em volta de 2·ign e 3·ign) | ≤ +3 dB sobre o piso, com a portadora ≥ 15 dB acima dele | -2,4 dB (portadora +20,2 dB) |
| portadores | ar741 em voo, plena (40 m/s): passagem de pá | ≈ 260 Hz (7 800 rpm) | 252,4 Hz (7574 rpm) |
| portadores | ar741: Mach na ponta | 0,88 (a 7 800 rpm) | 0,863 |
| portadores | ar741: f_ign/BPF (1 rotor, 2 pás, direto) | 0,5 | 0,500 |
| portadores | ae50r com o rotor (S-100): Nr no pairado | 1 070 ± 2% | 1070 rpm (no fim 1070) |
| portadores | ae50r: droop ao puxar o coletivo (0,45 → 0,6 em 1 s) | ≤ 3% | 0,25% |
| portadores | mistral: subida de 1 200 a ~7 500 rpm (manete em 4 s) | 4–6 s | 3,1 s (**desvio**) |
| portadores | mistral: governador da hélice | 2 930 ± 2% | 2872 rpm |
| portadores | xts210 no gerador (inversor, 6 000 rpm nominal), 50% de carga | ±3% da nominal | 6000 rpm · carga 0,50 |
| portadores | 787B passagem a 340 km/h (15 m): razão da ignição chegando/indo | 1,555 ± 5% (teoria 1,556 com M 0,275) | 1,549 (735 / 475 Hz; 8084 rpm) |
| xengine | xmini a 12 000 rpm: f_ign (1,5 por volta, 3 câmaras, ciclo de 720°) | 300 Hz ± 0,5% | 300,00 Hz · cyc 720 · 3 câmaras |
| xengine | xmini plena carga: pressão na abertura (expansão prolongada) | 1,3–1,6 bar | 1,52 bar |
| xengine | xmini: sem NaN | nenhum | nenhum |
| xengine | xts210 plena carga: pressão na abertura (expansão prolongada) | 1,3–1,6 bar | 1,42 bar · CR 18 |
| xengine | xts210: sem NaN | nenhum | nenhum |
| palhetas | palhetas livre (8 palhetas): tom em z·n/60 | 2675 Hz ± 1% (20063 rpm; 20 000 → 2 667 Hz) | 2675 Hz (-0,01%) |
| palhetas | palhetas: tom sobre a mediana | ≥ 15 dB | +19,9 dB |
| palhetas | palhetas: da parada à rotação livre (90%) | 0,3–0,6 s | 0,36 s |
| palhetas | palhetas com 100% de carga: a rotação cai ≥ 30% em ≤ 1 s | ≥ 30% em ≤ 1 s | 71% · 30% em 0,07 s |
| palhetas | palhetas: jato contra o tom em 2,5–6 kHz | jato ≥ tom | jato 48,9 · tom 48,7 dB |
| palhetas | palhetas, arranque a ar (Cat C15): o hospedeiro a 0,45·lenta | 1–2 s | 1,26 s (pega e solta o pinhão em 1,51 s) |
| potencia | potência rx7fd | 206 kW ± 5% | 200,7 kW a 100% de rpmMax |
| potencia | potência rx7fc | 147 kW ± 5% | 147,7 kW a 100% de rpmMax |
| potencia | potência rx3 | 81 kW ± 5% | 81,7 kW a 100% de rpmMax |
| potencia | potência rx8hp | 170 kW ± 5% | 170,6 kW a 100% de rpmMax |
| potencia | potência rx8std | 141 kW ± 5% | 143,9 kW a 100% de rpmMax |
| potencia | potência cosmo20b | 206 kW ± 5% | 209,6 kW a 100% de rpmMax |
| potencia | potência r26b | 522 kW ± 5% | 523,0 kW a 100% de rpmMax |
| potencia | potência ro80 | 85 kW ± 5% | 84,2 kW a 100% de rpmMax |
| potencia | potência norton | 70 kW ± 5% | 70,0 kW a 100% de rpmMax |
| potencia | potência cosmo110s | 81 kW ± 5% | 82,0 kW a 100% de rpmMax |
| potencia | potência mistral | 149 kW ± 5% | 150,9 kW a 100% de rpmMax |
| potencia | potência ae110 | 82 kW ± 5% | 85,4 kW a 100% de rpmMax |
| potencia | potência ae50r | 41 kW ± 5% | 38,8 kW a 100% de rpmMax (**desvio**) |
| potencia | potência ar741 | 28 kW ± 5% | 28,2 kW a 100% de rpmMax |
| potencia | potência xmini | 3 kW ± 5% | 3,1 kW a 100% de rpmMax |
| potencia | potência xts210 | 19 kW ± 5% | 19,1 kW a 100% de rpmMax |
| veiculo | rx7fd a 100 km/h em 5ª (caixa do Type RS: 5ª 0,762, diferencial 4,3) | 2 750 ± 100 rpm | 2750 rpm |
| veiculo | rx8hp a 100 km/h em 6ª (relações da ficha) | 2 750 ± 100 rpm | 3011 rpm (**desvio**) |
| veiculo | r26b em 5ª a 8 500 rpm | 340 ± 10 km/h | 339 km/h |
| veiculo | ro80 0–100 km/h | 12–15 s | 12,3 s |
| niveis | rx7fd: lenta → plena carga a 55% (página) | +18 a +25 dB | +20,0 dB |
| niveis | rx7fc: lenta → plena carga a 55% (página) | +18 a +25 dB | +22,3 dB |
| niveis | rx3: lenta → plena carga a 55% (página) | +18 a +25 dB | +18,7 dB |
| niveis | rx8hp: lenta → plena carga a 55% (página) | +18 a +25 dB | +20,0 dB |
| niveis | rx8std: lenta → plena carga a 55% (página) | +18 a +25 dB | +21,1 dB |
| niveis | cosmo20b: lenta → plena carga a 55% (página) | +18 a +25 dB | +17,9 dB (**desvio**) |
| niveis | r26b: lenta → plena carga a 55% (página) | +18 a +25 dB | +19,4 dB |
| niveis | ro80: lenta → plena carga a 55% (página) | +18 a +25 dB | +14,8 dB (**desvio**) |
| niveis | norton: lenta → plena carga a 55% (página) | +18 a +25 dB | +21,2 dB |
| niveis | cosmo110s: lenta → plena carga a 55% (página) | +18 a +25 dB | +19,0 dB |
| niveis | os carros e a moto na lenta: faixa de nível | ≤ 12 dB | 14,2 dB (rx7fd -48,5, rx7fc -45,8, rx3 -53,7, rx8hp -43,2, rx8std -44,5, cosmo20b -40,3, r26b -48,1, ro80 -39,5, norton -52,0, cosmo110s -47,5) (**desvio**) |
| cpu | r26b rev (12 câmaras, 4 primários, megafone), 10 s em Node | ≤ 45% do tempo real | 11,0% (10 tubos, 8 nós) |

### Desvios conhecidos (com o motivo físico; `DESVIOS` em `tools/rotativo-valida.ts`)

- **rx7fd lenta, pré-silencioso retirado: 2·ign sobe.** A 750 rpm a 2·ign está em 50 Hz, abaixo da câmara de Helmholtz do pré-silencioso (150–300 Hz, tabela 2.2): ele não toca nela. Vale a 5 000 rpm (2·ign 333 Hz). O agudo, que antes não se mexia (a pós-queima na boca não passava por ele), agora sobe +6,5 / +10,3 dB em 1–2,5k / 2,5–6k ao retirá-lo.
- **bandas 7 700 rpm em neutro, 4 rotores megafone (r26b).** Em carga leve o pulso é fraco (a câmara chega à abertura a ~1,6 bar) e os harmônicos 2 a 4 da ignição ficam 5–9 dB abaixo do vídeo (6VCl, a 5 m): 400–1k 7 dB e 1–2,5k 16 dB abaixo do alvo relativo a 150–400 (metade disso é o 150–400, ordens 2 e 3 do eixo, mais forte que na gravação). Em plena carga a janela de 33°e e o afiamento nos primários já dão o dente de serra (1–2,5k a −3 dB e 2,5–6k a −11 dB da banda da ignição; as passagens em Le Mans dão −2 a −3 e −7 a −14). O timbre tonal do kit ouvido neste caso é 0,8 tolerância; o que falta é médio de carga leve: ver "Pendente".
- **centroide 7 700 rpm em neutro, 4 rotores megafone (r26b).** Consequência dos harmônicos 2 a 4 da ignição fracos em carga leve (ver as bandas): 627 Hz, 4% abaixo do limite de 651 Hz. Sem o ruído que a pós-queima na boca punha em 2,5–12 kHz o centroide perdeu o que o segurava artificialmente (era 704 Hz).
- **bandas lenta 4 rotores periférica (r26b).** O agudo agora fica no teto da gravação (−14,9 / −16,3 contra −15,5 / −16,0) e o 400–1k bate (−7,6 contra −7,5); o grave da ignição (127 Hz, banda de 60–150) fica 7,8 dB abaixo, 0,8 dB além da tolerância: metade das explosões falha (o "brap") e a energia da ignição se espalha pelas linhas do padrão de 6 voltas.
- **bandas lenta 2 rotores moto 1 900 rpm (norton).** O grave fica 18 dB abaixo do vídeo (Fx7, ~2 m, celular): a gravação tem a ordem 1 e a ignição de 61,5 Hz fortíssimas (+9,5 dB rel. 150–400) que o 2 em 1 curto da moto no modelo não dá. O agudo passa pelo teto. Vídeo do YouTube com o microfone muito perto (alvo interno).
- **rx8hp 5 000 rpm: ordens 2/3 e 5/3 contra a ignição.** As ordens de flanco ficam até 3 dB além da tolerância (−21/−24 contra −16 ± 5) com a dispersão por flanco de 2,5× a do Ronco; mais que isso deixava a lenta irregular demais. Na gravação o operador oscila a rotação (vagar 11,6%), o que também alarga as linhas.
- **lenta periférica (r26b): vagar em 12 s (o método das gravações).** A lenta agora é o "brap": rajadas a rpm/360 (5,2 Hz), 1 690–2 070 rpm, sem apagar; a rotação média vagueia 3–4% em janelas de 1 s. Os 25–35% do vídeo vêm do método (a autocorrelação da envoltória salta de oitava numa lenta em rajadas) e de o trecho ir de 1 580 a 2 200 rpm em 12 s (±16%): uma deriva lenta que o controle de lenta do modelo não tem.
- **desaceleração rx8hp ('burble'): estouros/s.** O mecanismo do Ronco conta os eventos por segundo como um 4 tempos (N·rpm/120); com 3 câmaras por rotor e o ciclo de 1 080°e são N·rpm/180, então a taxa por segundo do mapa sai 2/3 da do pistão, e o sorteio de 2 s varia ±1,5/s: 1,5–3/s contra 4–6. Corrigir pede um termo no dsp.ts do Ronco (a taxa × cyc/720). (Os "detectados" contam também as próprias explosões, agora que o agudo é preso ao pulso.)
- **vibração na lenta: rx8hp contra ek9 (Ronco).** Sem a inércia alternativa sobra a oscilação do torque (`ripple`, que o documento manda deixar igual) na ordem 2: 7 dB abaixo do 4 cilindros, contra 10–15. As câmaras de 654 cm³ dão pulsos de torque grandes; o rotor sem massa alternativa só tira a parte da inércia.
- **vibração na lenta: rx8hp contra mx5 (Ronco).** Ver a vibração contra o ek9.
- **mistral: subida de 1 200 a ~7 500 rpm (manete em 4 s).** A hélice de passo variável fica no passo mínimo até 60% da rotação-alvo (a regra do portador Helice) e o 13B leve sobe junto com a manete: 3,1 s. O alvo de 4–6 s supõe a manete mais lenta ou o passo saindo antes do mínimo.
- **potência ae50r.** 0,4 dB fora (38,8 contra 41 kW ± 5%): a escala de torque usa o atrito médio da sonda; no monorrotor de 294 cm³ a 7 750 rpm o atrito pesa e a potência na rotação máxima sai 5,4% abaixo.
- **rx8hp a 100 km/h em 6ª (relações da ficha).** O alvo do documento não bate com a própria ficha: 3,760/…/0,843, diferencial 4,444 e pneu 225/45R18 (0,33 m) dão 3 011 rpm a 100 km/h (a conta: 100/3,6/(2π·0,33)·60·0,843·4,444). O RX-8 real gira ~3 000 em 6ª a 100 km/h.
- **cosmo20b: lenta → plena carga a 55% (página).** 0,1 dB fora: a lenta do 3 rotores sai, sem reforço nenhum da calibração (o reforço não atenua: fica em 1), 17,9 dB abaixo da plena carga a 55%, que o biturbo e o abafador original deixam baixa.
- **ro80: lenta → plena carga a 55% (página).** 3 dB fora (+14,8): pela mesma razão do Cosmo 20B, o reforço de lenta fica em 1 e a lenta do carburado com dois silenciosos sai só 15 dB abaixo da plena carga, que é baixa (85 kW).
- **os carros e a moto na lenta: faixa de nível.** A calibração equilibra a plena carga de fábrica de cada preset, e a lenta fica ~21 dB abaixo dela onde o reforço alcança. Ficam nas pontas o Ro80 e o Cosmo 20B (lenta natural alta, o reforço não atenua) e o RX-3 (reator térmico e dois silenciosos, reforço no teto ×8): 14 dB de faixa (eram 25 antes da rodada de som: o 787B, que na lenta era só estouros, saiu da ponta de cima). Sem os três, 5 dB.

### Revisão do "som de ar" (novembro de 2026)

*Primeira passada, mantida como história. O dono ouviu e reprovou ("apenas ar"): ela atenuou a pós-queima na boca em 3,8 dB e a prendeu ao evento, mas a fonte continuou lá, 20–38 dB acima das gravações casadas. A seção seguinte desfaz a causa.*

**Queixa:** "tem som de ar, a mesma coisa que acontecia no Fusca"; "com o Ø da saída no mínimo é só som de ar"; "o som de ar fica bem alto em lenta". **Método** (`REVISAO-DE-SOM.md`): cada fonte de ruído desligada de cada vez, na lenta quente e a 3 000 rpm sustentados em ponto morto (AR741 a 4 000, X Mini a 6 000), no Ø de fábrica, no mínimo (25 mm) e no máximo (130 mm), com a mesma configuração calibrada; o jato da ponta (que só soma na saída) medido pela diferença exata com ele desligado; bandas em dB rel. 150–400 Hz, p10 da envoltória por banda (relativo à média), índice de modulação da envoltória na ignição, p90/p10 e desvio/média de 1–6 kHz, contra a lenta do RX-7 (Commons 16–20 s) e o RX-8 a ~2 700 rpm (Commons 0–6 s).

**Causa, por fonte** (antes da revisão):

| Fonte | Lenta do FD (Ø 76) | 3 000 rpm do FD | Ø 25 mm (lenta / 3 000) | Outros presets |
|---|---|---|---|---|
| pós-queima na boca | 94% do 1–2,5k e 100% do 2,5–6k; envoltória quase lisa (p10 −6 dB, modulação 0,43, desvio/média 0,40) | 57% / 99%, lisa (100 eventos/s) | 54% / 78%; 14% / 29% | 98–100% do 1–6k na lenta e a 3 000 do RX-8 e do Cosmo (o abafador original tira o tom e não a boca: 1–2,5k −2,9 e −3,9 rel. 150–400) |
| jato da ponta | 0% | 0% | **86% do 150–400, 82% do 400–1k** / 89–96% abaixo de 2,5k: o jato ∝ 1/área² (limite 0,4) subia 39× e o tubo fino tirava ~30 dB do tom | AR741 64–99% de 400 Hz–6 kHz, AE50R 73–94% de 1–6 kHz, X Mini 98% do 2,5–6k (pulsados: p10 −7 a −28 dB); RX-8 e Norton no Ø mínimo, 81–100% |
| `turb` da janela | < 0,2 dB | < 0,2 dB | < 0,2 dB | só o AE50R na lenta (24% do 1–2,5k) |
| primário e ponto quente da pós-queima | 0 dB (o pré-silencioso e o abafador tiram) | 0 dB | 0 dB | audíveis só sem abafador (787B, Norton) |
| vedações, chiado da admissão e do turbo | −34 e −60 dB do total | idem | idem | — |
| 787B na lenta | — | — | — | o agudo são os estalos das falhas; a pós-queima só enche o vão (sem ela, p10 −27 dB) |

**Gravações:** o agudo da lenta do RX-7 é quase liso (p10 −5,3 / −3,9 dB, modulação na ignição 0,06 / 0,04, p90/p10 6,8 dB, 0,5 estalo/s): a envoltória lisa do modelo batia com ela, e o ouvido ainda assim ouviu "ar". O vídeo é Opus e não diz onde estava o microfone; o espectro fino do agudo da gravação tem estrutura (desvio de 1,9–3,7 dB do espectro em torno da mediana local, contra 0,5–0,8 do ruído do modelo).

**O que mudou** (atenuar, não trocar o modelo):

1. A envoltória de cada evento no ponto quente e na boca passava por um polo de 15 ms; agora `hcEspalha` = 9 ms (campo e controle): o menor que deixa o p90/p10 da lenta nos 7–13 dB medidos e já passa o desvio/média ≥ 0,5 do ROTATIVO 8.1. Com 0 ms (o evento puro) o p90/p10 vai a 21 dB e o detector conta 25 estalos/s, contra 6,8 dB e 0,5/s da gravação.
2. A parte que queima na boca cai de 0,7 para 0,45 (−3,8 dB), sem passar a diferença ao primário.
3. A ponteira do jato vira uma peça própria (`escape.ponteira`, de fábrica a boca do preset) com os limites do Ronco (0,5–1,6): o Ø da saída muda o tubo e a irradiação, a ponteira só o jato, como a `tipD` do Ronco depois da revisão do Fusca.

**Resultado** (antes → depois; gravação):

| Caso | 400–1k | 1–2,5k | 2,5–6k | jato % (150–400 / 400–1k) | p10 1–2,5k / 2,5–6k (dB) | modulação na ignição 1–2,5k / 2,5–6k | p90/p10 1–6 kHz | desvio/média 1–6 kHz |
|---|---|---|---|---|---|---|---|---|
| RX-7 Commons, lenta 880 rpm | −0,9 | −10,9 | −10,5 | — | −5,3 / −3,9 | 0,06 / 0,04 | 6,8 | 0,32 |
| FD lenta, Ø 76 | −5,4 → −5,5 | −13,9 → −17,0 | −10,4 → −13,9 | 0 / 0 | −6,3 / −5,7 → −8,5 / −7,7 | 0,43 / 0,41 → 0,65 / 0,60 | 9,4 → 12,3 | 0,40 → 0,51 |
| FD lenta, Ø 25 | +4,1 → +3,1 | +6,2 → +8,7 | +11,5 → +15,8 | 86 / 82 → 0 / 0 | −7,5 / −6,2 → −7,9 / −7,7 | 0,64 / 0,50 → 0,59 / 0,60 | | |
| FD lenta, Ø 130 | −6,7 → −6,8 | −25,3 → −27,0 | −24,6 → −28,1 | 0 / 0 | −7,6 / −5,7 → −10,4 / −7,7 | 0,61 / 0,41 → 0,91 / 0,60 | | |
| RX-8 Commons ~2 700 rpm (acelerando) | −3,6 | −10,5 | −9,2 | — | −10,2 / −9,8 | 0,08 / 0,06 | | |
| FD 3 000 rpm, Ø 76 | −2,2 → −2,2 | −17,2 → −18,9 | −15,8 → −19,6 | 0 / 0 | −6,4 / −4,5 → −7,5 / −4,6 | 0,41 / 0,07 → 0,63 / 0,08 | | |
| FD 3 000 rpm, Ø 25 | +3,3 → −1,0 | +3,3 → −0,6 | +6,3 → +6,3 | 89 / 96 → 0 / 0 | −10,7 / −7,3 → −5,4 / −4,5 | | | |
| RX-8 (rx8hp) lenta | −5,7 → −7,0 | −2,9 → −6,4 | +0,7 → −2,8 | 0 / 0 | −6,0 / −5,6 → −8,0 / −7,7 | 0,41 / 0,41 → 0,60 / 0,61 | | |
| RX-8 3 000 rpm | −6,9 → −7,3 | −9,0 → −12,7 | −5,4 → −9,2 | 0 / 1 | −7,6 / −7,0 → −8,1 / −7,6 | | | |
| RX-8 lenta, Ø 25 | +4,9 → +0,5 | +5,4 → +7,9 | +7,6 → +14,0 | 98 / 99 → 5 / 13 | | | | |
| Cosmo 20B lenta / 3 000 | −4,0 / −6,1 → −4,9 / −6,2 | −3,9 / −12,7 → −7,6 / −16,4 | −0,5 / −9,6 → −4,2 / −13,4 | 0 / 0 | −5,0 / −4,2 → −5,7 / −5,0 (lenta) | 0,22 → 0,35 (lenta) | | |
| 787B lenta / 3 000 | −2,9 / −7,3 → −3,0 / −7,4 | −6,0 / −11,4 → −6,1 / −12,3 | −5,8 / −10,5 → −6,0 / −12,2 | 0 / 0 | −14,7 / −11,9 → −17,6 / −15,0 (lenta) | | | |
| Norton lenta / 3 000 | −8,2 / −1,5 → −7,9 / −1,5 | −16,4 / −11,2 → −15,8 / −11,3 | −18,3 / −18,7 → −21,5 / −19,6 | 0 / 1 → 0 / 1 | | | | |
| Norton lenta, Ø 25 | +5,3 → −1,8 | +6,9 → −3,1 | +3,0 → −4,1 | 100 / 100 → 8 / 44 | | | | |
| AE50R lenta / 3 000 | −8,2 / −4,1 → −8,3 / −4,1 | −7,7 / −3,5 → −9,1 / −3,6 | −8,6 / −5,2 → −9,7 / −5,4 | 2 / 37 → 2 / 35; 6 / 45 | | | | |
| AR741 lenta / 4 000 | −1,1 / +3,8 (igual) | +2,4 / +6,1 (igual) | +1,3 / +4,9 (igual) | 23 / 89; 45 / 64 (igual) | −15 / −15; −25 / −27 | | | |
| X Mini lenta / 6 000 | −4,7 / −6,0 → −5,3 / −6,2 | −6,4 / −11,1 → −9,5 / −12,7 | −9,8 / −16,4 → −17,4 / −23,7 | 2 / 18 → 0 / 4 | | | | |

O X Mini (Ø 20 mm, abaixo do limite 0,5 do Ronco) é o único preset cujo jato mudou no Ø de fábrica: −7,7 dB.

### Rodada de som: motor, não ar (novembro de 2026)

**Queixa do dono:** "o diesel e o rotativo dos Mazda eram os piores: ele meio que deixava o som parecendo que era apenas ar"; "se deixa o Ø da saída no mínimo, é só som de ar"; e a regra de gosto, acima da fidelidade à gravação: "pro simulador ele tem que soar mais motor e menos som de ar do motor". **Método:** o kit `tools/ouvido` contra gravações casadas de `referencias/rotativo` (rotação conferida pela dobra em N períodos e pelo pente), o orçamento de ruído por fonte com a mesma semente (`tools/rotativo-fontes.ts`) e a varredura dos controles de Ø e ponteira (`tools/rotativo-varredura.sh`). Painéis em [`docs/ouvido/rotativo/`](ouvido/rotativo/); o caso está contado em `REVISAO-DE-SOM.md`.

**Diagnóstico (antes, `6805819`): fração do nível ponderado A por fonte.**

| Condição | pós-queima na boca | estouros das falhas | jato da ponteira | o que a régua via |
|---|---|---|---|---|
| RX-7 FC, lenta | **56%** (99–100% de 1 a 12 kHz) | · | · | 1–2,5k e 2,5–6k **21 e 31 dB acima** da gravação casada (FC3S, da traseira) |
| RX-8, lenta | **53%** (86–100% de 1 a 12 kHz) | · | · | 11 e 21 dB acima |
| 20B, lenta | **66%** | 4% | · | 26 e 38 dB acima |
| RX-7 FC, ~3 550 rpm em ponto morto | 22% (96–100% de 1 a 12 kHz) | · | · | 2,5–6k 16 dB acima |
| 13B bridgeport, lenta | 5% (pós-queima toda: 29%) | **78%** | · | `ar` 4,1; curtose de 1–6 kHz 169 contra 3,5 |
| 787B, lenta | · | **98%** | · | total 4,35; cada falha um estouro solto (15/s) |
| 787B, 7 700 rpm em ponto morto | 7% (70% de 2,5–6k, 98% de 6–12k) | · | · | névoa onde a gravação tem linhas |
| RX-7 FD, plena carga na cabine | · | · | · | apito do turbo, tom puro em 6,7 kHz, 46 dB sobre o piso; chiado do turbo 93% de 2,5–6k |

A pós-queima na boca era ruído puro (branco de 400 Hz a 3 kHz) injetado a 6 cm da ponta: não passava por turbo, catalisador, pré-silencioso nem abafador, e por isso o pré-silencioso "não fazia efeito". Ela existia para bater com a gravação do RX-7 do Commons (−1 / −11 / −10,5 dB em 400–1k / 1–2,5k / 2,5–6k rel. 150–400, microfone desconhecido); a gravação casada do FC3S, da traseira, dá −17 / −35 / −41, e a do 20B −18 / −35 / −44. O defeito `ar` do kit, que compara a **fração** de leito de cada banda, dava 1,3 na lenta do FC e 0,0–0,1 no RX-8 e no 20B com o piso de ruído 11–38 dB acima do da gravação: por isso a régua desta rodada confere também o **nível** do leito contra o da gravação (`tools/rotativo-regua.py`).

**Varredura de Ø da saída e ponteira (RX-7 FC; % do nível ponderado A; antes → depois).**

| | fábrica (70 / 70 mm) | saída 20 mm | ponteira 20 mm | as duas em 20 mm | as duas em 130 mm |
|---|---|---|---|---|---|
| lenta: jato | · → · | · → · | 15% → 2% | 41% → · | · → · |
| lenta: pós-queima na boca | 56% → · | **99%** → · | 47% → · | 60% → · | 3% → · |
| 3 000 rpm em ponto morto: jato | · → · | · → · | 16% → 1% | **70%** → · | · → · |
| 3 000 rpm: pós-queima na boca | 18% → · | **94%** → · | 15% → · | 33% → · | 1% → · |
| 5 000 rpm em plena carga: jato | 1% → 1% | 14% → · | **75%** → · | **99%** → · | · → · |
| 5 000 rpm: fração estocástica do som | 4% → 2% | 37% → 1% | 76% → 1% | 100% → 1% | 1% → 1% |

("·" = menos de 0,5%.) O chiado do jato crescia com 1/área² sem limite (+24 dB com a ponteira no mínimo): era o "papel rasgando". E com o Ø da saída no mínimo o tom caía 33 dB (irradiação ∝ d³) enquanto a pós-queima na boca, fonte de volume, subia.

**O que mudou, por mecanismo.**

1. **Pós-queima só onde o gás está quente** (`dsp.ts`: `tune`, `posQueimaRot`, `PosQueimaBoca`). Depois de 3–6 m de tubo o gás chega à boca a 200–300 °C: não queima nada lá (`kBoca` 0; controle "Chama na boca" para o escape curto e aberto). O HC queima logo depois da janela, no primário (`kPrim` 0,5) e no ponto quente (`kQuente` 0,2), como **expansão presa ao evento**: a parte lisa reforça o pulso (tom), e só a flutuação turbulenta (`hcTurb`, ~10% rms; controle "Chiado da pós-queima") é ruído, dentro do tubo. Com isso o pré-silencioso passou a fazer efeito: retirá-lo na lenta do FD sobe 1–2,5k em 6,5 dB e 2,5–6k em 10,3 dB (antes +1,4 / +0,1).
2. **Boca com ponteira** (`escape.ts`: `BocaRot`). A saída mais fina que a seção de referência (o downpipe) é um orifício: Δp = ½ρv²(1/σ² − 1). Para a onda isso é uma resistência `M₀·(1/σ² − 1)` (o escoamento médio, M₀ ≈ 0,004 na lenta e ≈ 0,14 em plena carga) mais o termo do próprio pulso; a vazão pulsante cai e o que não sai volta como contrapressão. A ponteira de 20 mm num escape de 70 tira 7,7 dB do pulso na lenta e 18,1 dB em plena carga a 5 000 rpm: ela **amolece** o pulso em vez de acelerá-lo sem limite. O chiado do jato lê a velocidade na ponteira (área do tubo ÷ área da ponteira; a ponteira mais larga é difusor), só a parte pulsante, saturada na velocidade do som junto com o escoamento médio, e com teto de 10% da envoltória do pulso irradiado pela mesma boca (`tetoJato`). A irradiação passou à de monopolo (ganho ∝ d: a mesma vazão irradia igual por tubo fino ou grosso; com d² o grave ia com d³).
3. **Janela periférica pela cinemática** (`constantes.ts`: `rampaPeriferica`). A janela fica aberta 360°e (a distância entre as vedações de ápice) mais a própria altura: 393 − 360 = 33°e no 13B (20 mm a 0,61 mm/°e). É esse o tempo de abertura e de fechamento; a tabela 1.3 trazia 47 e 59°e, que não fecham com a duração. E nos primários a onda afia com o coeficiente do gás, (γ+1)/(2γ) = 0,88·p/p₀ (era o 0,6 do Ronco em todo tubo). No 787B em plena carga a 8 160 rpm os harmônicos 2 a 6 da ignição na saída foram de −8 / −19 / −20 / −23 / −29 dB para −5 / −10 / −11 / −14 / −20 dB: 1–2,5 kHz a −3 dB e 2,5–6 kHz a −11 dB da banda da ignição (as três gravações de fora do 787B dão −1 a −3 e −7 a −14; um dente de serra daria −4 e −9). São linhas, não ruído (HNR +15 e +7 dB). A periodicidade com os ruídos desligados fica ≥ 0,993 em todos os presets (`tools/rotativo-periodico.ts`). A Sachs (eventos estimados, "a conferir") fica com a rampa da tabela.
4. **O "brap" pela diluição** (`dsp.ts`: `escapeRot`, `admissaoRot`, `janelasRot`, `control`). O laço acompanha a fração de gás queimado em cada câmara, na região da janela de escape de cada rotor e no duto de admissão (que troca com o plenum comum). No fechamento da admissão fica a fração presa na carga (`xRes`): 0,23 no Renesis, 0,33 no 13B de fábrica, 0,38 com street port, mais de 0,5 com bridge ou periférica depois de uma queima. Acima de 0,44–0,48 a mistura não acende (só com sobreposição de competição; o limiar sobe 0,10 até a rotação máxima, a tolerância à diluição cresce com a turbulência). A câmara que falha manda mistura crua ao escape; o que volta na vez seguinte é mistura, e ela acende: cada câmara alterna queima e falha com período de dois ciclos, **6 voltas do eixo**. É o ritmo medido nas gravações: 5,2 Hz no 787B a 1 890 rpm, 4,8 Hz no RX-7 preparado a 1 730, 5,5 Hz no bridgeport a 1 980 (rpm/360; a linha mais forte do bridgeport, 71,5 Hz, é a ignição de 66 Hz mais 5,5). No 787B a sequência queimou/falhou tem autocorrelação −0,85 a 3 voltas e +0,71 a 6; no bridge de plenum comum as câmaras entram no passo e saem rajadas inteiras (8 queimas, 6 falhas: 7 voltas, ~4,5 Hz). A carga crua de uma falha queima 1,5% ao entrar no tubo quente, como chama turbulenta (`kChama`: o ronco rouco da rajada), e 5% do que ficou no primário é aceso pela próxima queima (`kCru`); o estouro solto do Ronco ficou raro (0,2/s, eram 15/s). Saiu o sorteio de falhas (`falhaBase`, `kQueda`, `kCaca`); o ar de lenta de equilíbrio da calibração entra já na partida (`arDeLenta`).
5. **Turbo e fundo do lado baixo.** O apito e o sopro do turbo a 30% (`kApito`, controle "Som do turbo"; o tom de 6,7 kHz era 34–46 dB sobre o piso em plena carga) e o chiado contínuo das vedações à metade (`kVed`, controle "Chiado das vedações").
6. **Calibração da lenta.** A sonda media 0,4 s de um laço de ar de lenta que oscila em ~0,8 s (coletor de 0,33 a 0,54 bar, 4 dB de nível): o reforço da lenta dependia de onde a janela caía. Agora média de 2 s.

`src/engines/ronco/dsp.ts`: dois ramos `rot` (a falha passa a ser por câmara, `this.falhaRot[c]`; o apito do turbo, `if (this.rot) tur += this.rotApito(lvl); else` a linha original) e a declaração de `rotApito`. `paridade:ronco` idêntico.

**Resultado (gravação casada; antes → depois).** `ar`, tom a menos e pulso a menos são os defeitos de um lado só do kit (limites da régua dos aprovados: 0,6 / 2,4 / 1,3); total ≤ 2,2.

| caso | rpm real / sim | ar | tom a menos | pulso a menos | total | nível re âncora em 400–1k · 1–2,5k · 2,5–6k (dB): gravação / antes / depois |
|---|---|---|---|---|---|---|
| fc-lenta | 746 / 749 | 1,30 → 0,00 | 0,00 → 0,18 | 0,82 → 0,15 | 1,62 → 2,06 | -17,2 / -10,3 / -12,6 · -35,2 / -13,8 / -36,8 · -41,0 / -10,0 / -40,5 |
| fc-3550 | 3543 / 3545 | 0,38 → 0,00 | 0,00 → 0,00 | 1,17 → 0,62 | 2,66 → 3,38 | -8,5 / +1,5 / +2,5 · -12,3 / -12,3 / -19,2 · -24,2 / -8,6 / -30,7 |
| bridge-lenta | 1982 / 1884 | 4,11 → 0,59 | 2,58 → 1,32 | 0,64 → 0,12 | 3,62 → 2,76 | -9,9 / -0,2 / -2,8 · -16,9 / -5,8 / -19,6 · -20,2 / -8,6 / -30,1 |
| fd-carga-cabine | 4837 / 4846 | 3,66 → 3,58 | 1,97 → 1,80 | 1,91 → 1,92 | 2,65 → 2,67 | -1,2 / -8,8 / -7,4 · -11,3 / -28,4 / -30,1 · -23,7 / -41,6 / -48,1 |
| fd-carga-ext | 4837 / 4846 | 0,00 → 0,00 | 0,47 → 0,34 | 0,00 → 0,00 | 2,58 → 2,66 | -1,2 / +0,1 / +2,3 · -11,3 / -5,3 / -4,6 · -23,7 / -12,8 / -9,9 |
| rx8-lenta-esportivo | 923 / 917 | 0,00 → 0,00 | 1,40 → 0,03 | 0,15 → 0,00 | 1,67 → 4,17 | -9,8 / -3,0 / -3,0 · -21,3 / -10,1 / -19,0 · -27,9 / -7,1 / -39,1 |
| 20b-lenta | 878 / 879 | 0,13 → 0,00 | 0,00 → 0,00 | 0,62 → 0,00 | 2,26 → 2,22 | -17,6 / -5,4 / -8,0 · -34,9 / -8,6 / -33,7 · -43,7 / -5,4 / -42,6 |
| 787b-lenta | 1888 / 1901 | 0,00 → 0,00 | 1,18 → 0,25 | 0,54 → 0,94 | 4,35 → 1,59 | -10,5 / -3,1 / -7,8 · -20,0 / -6,1 / -16,8 · -14,1 / -6,0 / -18,4 |
| 787b-7700 | 7703 / 7708 | 0,20 → 0,00 | 0,20 → 0,02 | 1,26 → 0,58 | 1,70 → 2,17 | +0,0 / -0,0 / -0,0 · -1,2 / -7,7 / -10,1 · -13,6 / -15,0 / -20,6 |
| 787b-bordo | 8172 / 8160 | 0,00 → 0,00 | 0,75 → 1,10 | 0,28 → 0,35 | 2,37 → 2,53 | -0,2 / -0,0 / -0,0 · -8,3 / -18,3 / -14,2 · -8,9 / -55,2 / -49,3 |
| 787b-bordo-ext | 8172 / 8160 | 0,00 → 0,00 | 0,78 → 1,24 | 0,26 → 0,00 | 2,04 → 2,75 | -0,2 / +0,0 / +0,0 · -8,3 / -7,1 / -2,7 · -8,9 / -19,0 / -11,3 |
| norton-lenta | 1842 / 1805 | 1,36 → 0,00 | 2,25 → 0,77 | 0,35 → 0,22 | 3,20 → 3,66 | -2,3 / -4,8 / -4,1 · -2,8 / -15,6 / -16,8 · -12,7 / -21,9 / -38,7 |
| ro80-lenta | 1110 / 1067 | 0,00 → 0,00 | 0,00 → 0,00 | 0,98 → 0,44 | 2,45 → 2,51 | +5,9 / -9,2 / -8,4 · -0,7 / -14,8 / -18,8 · -14,2 / -17,8 / -24,7 |

| caso | leito de ruído re âncora em 400–1k · 1–2,5k · 2,5–6k (dB): gravação / antes / depois | HNR em 400–1k · 1–2,5k · 2,5–6k (dB): gravação / antes / depois | linhas re âncora em 400–1k · 1–2,5k (dB): gravação / antes / depois |
|---|---|---|---|
| fc-lenta | -26,0 / -21,8 / -41,5 · -40,8 / -18,0 / -49,3 · -44,6 / -14,0 / -49,8 | +1 / +2 / -0 · -18 / -25 / -19 · -25 / -25 / -25 | -19,6 / -12,6 / -15,8 · -51,8 / -38,7 / -52,4 |
| fc-3550 | -9,2 / -15,1 / -18,5 · -12,6 / -13,1 / -40,3 · -25,5 / -9,2 / -39,1 | -7 / +14 / +16 · -16 / -15 / +11 · -22 / -25 / -12 | -16,5 / +1,4 / +2,5 · -28,8 / -27,0 / -19,5 |
| bridge-lenta | -12,9 / -0,3 / -8,0 · -19,1 / -5,8 / -24,2 · -24,2 / -8,2 / -32,1 | -10 / -25 / -9 · -25 / -25 / -25 · -25 / -25 / -25 | -20,0 / -25,2 / -13,8 · -41,9 / -30,6 / -44,6 |
| fd-carga-cabine | -10,8 / -38,3 / -37,1 · -19,9 / -49,0 / -47,6 · -32,4 / -41,5 / -48,2 | +14 / +20 / +20 · +7 / +11 / +13 · +5 / -11 / -9 | -1,3 / -8,8 / -7,4 · -13,1 / -28,7 / -30,3 |
| fd-carga-ext | -10,8 / -29,4 / -27,1 · -19,9 / -32,7 / -31,0 · -32,4 / -30,4 / -42,1 | +14 / +18 / +18 · +7 / +10 / +15 · +5 / +4 / +9 | -1,3 / +0,0 / +2,2 · -13,1 / -5,7 / -4,7 |
| rx8-lenta-esportivo | -17,5 / -17,4 / -34,1 · -23,5 / -14,8 / -43,6 · -28,4 / -11,1 / -49,3 | +5 / +2 / +4 · -3 / -16 / -3 · -25 / -25 / -18 | -11,0 / -5,2 / -4,7 · -26,2 / -26,0 / -24,2 |
| 20b-lenta | -23,1 / -14,7 / -30,4 · -37,5 / -11,1 / -43,7 · -44,9 / -7,8 / -50,9 | -1 / +4 / +6 · -21 / -25 / -1 · -25 / -25 / -25 | -21,8 / -7,0 / -9,1 · -56,4 / -33,5 / -37,1 |
| 787b-lenta | -12,0 / -5,9 / -9,5 · -21,2 / -9,0 / -20,8 · -14,8 / -8,7 / -23,3 | -25 / -17 / -17 · -25 / -25 / -25 · -25 / -25 / -25 | -34,6 / -20,1 / -25,6 · -44,8 / -30,7 / -44,0 |
| 787b-7700 | -6,9 / -18,0 / -21,4 · -4,3 / -19,7 / -30,5 · -16,4 / -16,8 / -36,5 | +9 / +17 / +20 · +1 / +11 / +17 · -3 / -5 / +11 | -0,4 / -0,1 / -0,1 · -3,9 / -8,0 / -10,2 |
| 787b-bordo | -6,0 / -21,3 / -22,9 · -10,9 / -35,3 / -32,0 · -10,1 / -62,9 / -58,1 | +6 / +19 / +21 · +3 / +14 / +15 · -3 / +1 / +3 | -1,1 / -0,1 / -0,0 · -10,3 / -18,5 / -14,3 |
| 787b-bordo-ext | -6,0 / -20,2 / -18,7 · -10,9 / -26,0 / -25,5 · -10,1 / -25,8 / -29,9 | +6 / +19 / +17 · +3 / +15 / +15 · -3 / +3 / +7 | -1,1 / -0,0 / -0,1 · -10,3 / -7,3 / -2,8 |
| norton-lenta | -5,5 / -6,0 / -8,6 · -4,1 / -16,7 / -21,4 · -13,7 / -22,7 / -42,1 | +0 / -10 / -0 · -13 / -19 / -6 · -23 / -20 / -17 | -6,7 / -14,9 / -7,4 · -16,5 / -33,9 / -24,3 |
| ro80-lenta | +5,4 / -18,9 / -12,7 · -1,2 / -18,5 / -24,4 · -14,8 / -18,6 / -26,5 | -25 / -3 / -2 · -20 / -25 / -13 · -25 / -25 / -25 | -19,2 / -14,1 / -12,6 · -21,9 / -39,6 / -32,1 |

**Como ler.** Os defeitos de um lado só (o que o simulado tem de pior que a gravação) caem para dentro dos limites em todos os casos de fora do carro. O total simétrico **sobe** em vários (lenta do RX-8 1,67 → 4,17, FC a 3 550 rpm 2,66 → 3,38): ele pune o simulado por ser mais limpo e mais preso ao pulso que a gravação (no RX-8, 73% da faixa de 1–6 kHz da gravação é um leito liso, o ruído do microfone a −58 dBFS; a envoltória do simulado tem p90/p10 de 24 dB contra 4). É o desvio que o viés do dono manda aceitar: a gravação é teto de ruído, não alvo. Ficam fora por outro motivo:

- **RX-7 FD na cabine** (`ar` 3,6): a banda de 2,5–6 kHz do simulado está vazia (−48 dB rel. 150–400, a gravação tem −24 com linhas) e o pouco que há nela é o sopro do turbo; em nível, o leito fica 16 dB **abaixo** do da gravação. O que falta é tom: o filtro de cabine do Ronco (compartilhado) corta 17–24 dB acima de 1 kHz.
- **13B bridgeport** (leito de 400–1k 5 dB acima; total 2,76): o padrão de rajadas do simulado se repete a cada 7 voltas e não a cada 6, então parte dele conta como "não periódico"; e faltam 10 dB de 2,5–6 kHz dentro das rajadas.
- **Norton** (total 3,66): o agudo liso e forte da gravação a 2 m (−3 / −13 dB em 1–2,5k / 2,5–6k) não existe no modelo (−17 / −39): é a mecânica do motor refrigerado a ar, não o escape. Os defeitos de um lado só melhoraram (`ar` 1,36 → 0; tom a menos 2,25 → 0,77) com a variação entre explosões do preset em 1,5× (CV do grave 0,35; a gravação tem 0,18 e o preset dava 0,58).

**Médios: o que é do rotativo e o que falta de genérico.** Em plena carga as linhas de 400 Hz a 2,5 kHz já passam das gravações de bordo no ouvinte de fora (FD: +2,2 / −4,7 dB rel. 150–400 contra −1,3 / −13,1 na cabine; 787B: −2,8 contra −10,3). O que sobra:

- **Cabine** (compartilhado): FD a 4 850 rpm em carga, linhas 6 dB abaixo em 400–1k e 17 dB abaixo em 1–2,5k; 787B a bordo 4 dB abaixo em 1–2,5k e 40 dB em 2,5–6k.
- **Carga leve em giro alto** (do rotativo): o 787B segurado a 7 700 rpm tem os harmônicos 2 a 4 da ignição 6 dB abaixo da gravação (linhas de 1–2,5k a −10,2 contra −3,9) e 2,5–6k 7 dB abaixo; a câmara chega à abertura a 1,6 bar e o pulso é quase só o deslocamento. O megafone do modelo (três degraus de 0,17 m) também não tem os modos de um megafone de verdade, que a 7 700 rpm caem em cima dos harmônicos da ignição.
- **Lenta** (genérico): nas lentas de rua o simulado tem 5–10 dB **a mais** que as gravações em 400–1k (FC −12,6 contra −17,2; 20B −8,0 contra −17,6): aqui não faltam médios.

**Sem gravação casada** (medidos só pelo orçamento e pelos portões): X Mini e XTS-210, AE50R, AR741, MidWest, Mistral, RX-3, Cosmo 110S e RX-8 de 4 janelas (neles o jato da ponta passou a ler a razão de áreas ponteira/tubo no lugar da área absoluta: nos tubos finos, onde ele era 64–99% do agudo, cai 8–24 dB); e o motor de palhetas (outro sintetizador, que esta rodada não tocou; as duas gravações de retífica do acervo ficaram por comparar). O Eunos Cosmo em carga só tem gravação de cabine sem som periódico (fração periódica 0,07: vento e rolagem), que não serve de alvo.

### Pendente (TODO)

- Médios em carga leve e giro alto no megafone (787B a 7 700 rpm em ponto morto): pulso mais forte na abertura com pouca carga e os modos do megafone (um tubo cônico, que o DSP não tem).
- O "brap" do bridge de plenum comum se repete a cada 7 voltas (8 queimas, 6 falhas); as gravações dão 6. No 787B, de dutos individuais, o período já é de 6 voltas, mas a rajada é menos funda que a do vídeo (modulação a 5 Hz de −12 dB contra −5).
- Cabine: o filtro de cabine do Ronco tira o tom acima de 1 kHz (FD e 787B a bordo); é do motor-base.
- Irradiação: no Ronco o ganho da boca cresce com d² (d³ no grave); o rotativo passou a d (monopolo). Vale conferir no motor-base.
- Norton e os demais Sachs: eventos das janelas "a conferir" (a duração de admissão da tabela, 330°e, não fecha com uma janela periférica, que fica aberta pelo menos 360°e); o agudo mecânico do motor refrigerado a ar que a gravação mostra.
- RX-8 em giro alto, de fora (genérico, do abafador de série): sustentado a 5 000 rpm o simulado tem 1–2,5k / 2,5–6k a −29,1 / −35,6 dB rel. 150–400; as gravações de fora do acervo dão −7,4 / −11,4 (aceleradas paradas, escape original, trecho de 8–15 s) e −4,8 / −14,5 (passagem). Faltam 20 dB ou mais de 1 a 6 kHz, em linhas e não em chiado: o abafador `stock` do Ronco e o que a carroceria irradia. A lenta com o escape original do acervo é só ruído de gravação (−41 dBFS) e não serve de alvo.
- Ro 80: a admissão do KKM 612 é periférica e a ficha usa a lateral (aproximação declarada no preset). Tentada uma periférica de rua (eventos estimados: abre 60° antes do PMS, fecha 70° depois do PMI; dois estágios de 0,036 + 0,114·boreEq²): o modelo de diluição põe a lenta a queimar em 51% das explosões, com o ritmo de 6 voltas de um bridge port (autocorrelação −0,91 a 3 voltas e +0,81 a 6; coletor a 0,85 bar), e contra a gravação casada o total vai de 2,51 a 3,03, com 20 estalos/s contra 1,8. Faltam duas coisas: os tempos reais da janela (não achados; a fonte primária é Froede, SAE 680461) e, no modelo, o estrangulamento entre as duas janelas periféricas durante a sobreposição (o gás do escape só chega à admissão pela folga do flanco na cintura da carcaça e pelo rebaixo do rotor, poucos cm², e o modelo liga as duas janelas pela câmara inteira). Com ele os limiares de diluição do bridge e do 787B precisam ser calibrados de novo.
- CPU (10 s em Node, máquina carregada, relativo ao 787B = 1): `rx8hp` 0,8; `rx7fd` 1,8; `cosmo20b` 2,3. Os caros são os turbo (igual antes da rodada: 0,8 / 1,8 / 2,3 no código anterior), não o RX-8; o teste de CPU só mede o 787B.
- Estouros por segundo do mecanismo do Ronco com o ciclo de 1 080°e (a taxa por evento conta N·rpm/120; o Wankel tem N·rpm/180): um termo `× cyc/720` no `dsp.ts` do Ronco.
- Velocidade do som fixa (520 m/s) nos tubos: o gás do Wankel é mais quente (≈ 560 m/s), limitação conhecida do Ronco.
- Vibração: a oscilação do torque do Ronco (o documento manda deixar igual) deixa o Wankel 7 dB abaixo do 4 cilindros, contra 10–15.
- Motor de palhetas: comparar com as duas gravações de retífica pneumática do acervo e um hospedeiro de verdade no arranque (hoje uma carga com as compressões).
- X-Engine: sem gravação; o XTS-210 diesel espera a flag `cc` combinada com o rotativo.
- `CENA.md` 1.6: acrescentar as linhas do rotativo (rotor e gerador já estão em `COMPAT`).

## Elétrico: síntese espectral

O projeto está em [`ELETRICO.md`](ELETRICO.md); aqui fica o que foi feito, como e o que se mediu. Página `eletrico.html` (`src/pages/eletrico/`), DSP em `src/engines/eletrico/`, worklet `src/worklet/processador-eletrico.ts` (`eletrico-engine`). Ao contrário do Diesel e do Radial, não estende o Ronco: uma máquina elétrica não tem combustão nem pulso, o espectro é de linhas em múltiplos exatos de `f_rot`, `f_e` e `f_c`, e o `EletricoDSP` é um banco de senóides com ruídos com semente, que implementa o `Motor` do CENA direto (escreve os canais das fontes; sem `tap`).

| Arquivo | O que faz |
|---|---|
| `linhas.ts` | `BancoDeLinhas` (osciladores recursivos), `ListaLinhas`, `JitterEixo` |
| `maquina.ts` | Mapa de torque, corrente, M, Φ, escorregamento (`estadoEletrico`) e as forças magnéticas como gabarito (`ForcasMotor`) |
| `inversor.ts` | `Inversor` (Bessel, seis modos, perfil medido), `linhasAux` (conversor auxiliar) |
| `mecanica.ts` | `Reducao` (engrenamento, chocalho, clique de flanco, rolamentos), `Ventilador`, `Escovas`, `Helice`, `RuidoBanda` |
| `avas.ts` | `Avas`: tom composto, ruído, ritmo, ré |
| `dsp.ts` | `PresetEletrico`, `ComandoEletrico` (extensões), `EletricoDSP` (até 4 unidades) |
| `motor.ts`, `portador.ts`, `pagina.ts` | `MotorEletrico` e a sonda de nível (`sondarNivelEletrico`, `prepararMotorEletrico`); montagem do portador do preset; DSP da página (`CenaDSP` + portador) |
| `presets.ts`, `constantes.ts` | As 18 fichas (com `aprox` nos valores ≈) e as constantes (curva da carcaça, notas do Taurus, diretividades) |
| `src/carriers/carro-eletrico.ts`, `multirrotor.ts` | `CarroEletrico` (e o trólebus), `FontePneu`, `FonteTrole`; `Multirrotor` (tipo `drone`) |
| `src/carriers/trem.ts`, `teste.ts` | `TracaoTrem` (o motor por truque); `CargaBancada` e `PortadorBancada` |
| `tools/eletrico/` | `valida.ts`, `lenta.ts`, `comum.ts` (render e análise), `linhas.ts` (porte de `doremi.py`/`ridges.py`/`ordens.py`), `gc.ts`, `analise/*.py` (os scripts do projetista, `python3 -I` sobre as gravações) |

### Banco de linhas (decisão 1)

- **Oscilador:** rotação complexa `[c, s] ← [c·cos δ − s·sen δ, s·cos δ + c·sen δ]`. A frequência vai em rampa linear dentro do bloco de 64 amostras: o incremento δ varia `dδ` por amostra, e a rotação do incremento também é uma rotação (`w ← w·dw`, 2 multiplicações complexas por amostra; sem variação, uma). Fase e incremento renormalizados no fim do bloco. Amplitude em rampa linear.
- **Lista a cada bloco:** a fonte entrega `(chave, f, a)`. O banco tira o que fica acima de 0,45·fs (e põe a rampa de −12 dB entre 18 kHz e 0,45·fs), abaixo de 10 Hz (infrassom de `f_e` ≈ 0, com rampa até 20 Hz) e abaixo de −60 dB da maior; fica com as `L_max` mais fortes (seleção parcial); casa as chaves com os osciladores por uma tabela de espalhamento em `Int32Array`. A mesma chave segue no mesmo oscilador; chave nova entra e chave que some sai com envelope de 20 ms em seno/cosseno (potência constante: a troca de modo do inversor muda a "geração" das chaves e vira um crossfade de 20 ms).
- **Linhas de mesma frequência** (|Δf| < 0,1 Hz) somam em potência numa só. Com fases sorteadas, duas senoides de mesma frequência dariam qualquer nível entre a diferença e a soma; acontece numa PMSM com `Z_s/p` inteiro (Leaf: ranhuras `48·f_rot` = `12·f_e`, a ondulação de torque).
- **Jitter por eixo:** passeio de ±0,05% a 0,3 Hz em todas as linhas da unidade e tremor de amplitude de ±0,5 dB; no Mavic, ±0,4% a 2 Hz (o ESC segurando a rotação).
- **Sem alocação:** estado em `Float64Array`; as forças magnéticas são um gabarito montado uma vez por preset (`f = a·f_rot + b·f_e + c`, categoria de amplitude, peso, laterais) que o bloco só percorre. 200 linhas: 10 s sem nenhuma coleta e 1,8% do tempo real; o motor do N700 (4 unidades, 800 osciladores no máximo): 5 coletas jovens em 10 s e 2,9% do tempo real.

### Máquina, inversor e mecânica

- **Torque (1.4):** `T_max = min(T_n, P_max/ω)` até `ω_max` (rampa de 3%); acelerador → `a·T_max`, freio → `−b·T_regen` acima de `v_regen,min` com rampa de 0,3 s; creep de 3% abaixo de 5 km/h. O controle de torque tem 10 ms de atraso (sem degrau). Ferramentas: `T = T_st·(a − ω/ω₀)` com `T_st = T_n/(1 − ω_base/ω₀)` (o gatilho é tensão; furar a 60% de `T_n` derruba 30% da rotação); indução na rede: a reta do escorregamento, até 2,5·`T_n`. Atrito do eixo: 1% de `T_n` na base mais 0,2%.
- **Corrente:** `|T|/T_n` até a quina de potência `P_max/T_n`, `|P|/P_max` acima (contínua na quina). `M = min(1, ω/ω_base)`, `Φ = min(1, ω_base/ω)`. Indução: `f_e = p·f_rot + s_n·f_e,n·T/T_n`.
- **Forças (1.1):** `2f_e ∝ Φ` (+6 dB sobre as ranhuras); `6f_e` −20 dB de `2f_e` em vazio e +20·log(I/I_vazio) com a carga (até 0 dB), `12f_e` −8, `18f_e` −16; ranhuras `m·Z_s·f_rot ± 2k·f_e` com os pesos da tabela (`k` ±1 −6, ±2 −14, `m` 2 −10, `m` 3 −18) ∝ Φ·√I; barras da indução +3,5 dB, com a modulação de ±1,5 dB em `2·s·f_e`; excentricidade (±f_rot, ±2f_rot e as linhas em f_rot, 2f_rot); magnetostrição na rede; BLDC nas ordens de `f_e` do preset; curva da carcaça por família. Quando `f_e` → 0 as laterais `±2k·f_e` devolvem a potência ao centro (sem salto). `I_vazio` = 0,1 (ímã, magnetização) e 0,3 nas escovadas (atrito e ventilação).
- **Inversor (1.2):** `|J_n(mπM/2)|/m` da tabela de Bessel (tabelada em M, 6 ordens), mais `1/m` da corrente, × `I/I_n` × curva da carcaça; grupos `m` 1–3, laterais até `|n|` = 4. Modos: assíncrona; escada por limiares de `f_e` (`f₀` 0,25, Δ 0,40 Hz, histerese de 0,02 Hz), patamar até `f_c/f_e < N_max`; síncrona pelo maior `N` com `N·f_e ≤ f_c,max` (histerese de 1%; `N` = 1 vira onda quadrada: `6f_e`, `12f_e`, `5f_e`, `7f_e`); auto; aleatória (passa-banda Q = 1/(2δ) em `f_c` e `2f_c` com a energia das linhas); chopper `∝ D(1 − D)·I`, com o clique de 20 ms em D = 1; CSI (TGV): `6f_e`, `12f_e`, `18f_e` e o chopper de entrada. Desligado com torque e rotação ≈ 0.
- **Conversor auxiliar:** canal `aux` do motor, constante com a ignição, que o trem põe no carro do conversor: `f_c,aux` com ±`f_rede`, ±2`f_rede`, `2f_c,aux`, as linhas fixas medidas do preset e (`auxRuido`) o largo dos ventiladores.
- **Mecânica (1.3):** engrenamento `Z_p·f_j` com harmônicos 2–4 e laterais ±`f_j`, ±`f_{j+1}` a −10 dB, ∝ T·n; abaixo de 3% de `T_n` some (rampa até 6%) e entra o chocalho (impactos no bp de 2 kHz a cada volta do pinhão, curtose 12); clique de flanco de 45 ms no bp de 800 Hz quando T troca de sinal; perda da engrenagem (1 − η)·|T| contra o movimento (na regeneração ela também freia); rolamentos de 2–10 kHz; ventilação BPF + 3 harmônicos (κ 0,6) + bp 1 kHz, ∝ n^5,5, o forçado sobe em 1,5 s; escovas `Z_c·f_rot`, `2Z_c·f_rot` ∝ I e o faiscamento (2–10 kHz modulado em `Z_c·f_rot`, ∝ I^1,5); hélice com os harmônicos do Mavic normalizados em A por `calibrarSerieA` (carriers/base.ts) e o ruído largo de pá.
- **AVAS (2):** genérico, tom de 250 Hz com 1,62× e 2,41×, vibrato, ruído bp 1 kHz modulado, ritmo de um pulso por 2 m; o ruído sobe 3 dB por 10 km/h dentro do total `L_W = 74 + 0,6·v`; desliga em 2 s acima de 20 km/h (30 no `eua`); em ré, 200 Hz em "bip" de 1,5 Hz. Calibração analítica (ponderação A das parciais e do ruído, fator de potência da diretividade).
- **Nível absoluto (4.2):** `sondarNivelEletrico` renderiza 0,5 s na condição de referência (`T_n` na rotação de base; o ventilador forçado já na rotação; o chopper em D = 0,5) com `kAbs` = 1 e leva o RMS ponderado A de cada canal (unidade de detune mais perto de zero) ao `L_W` do preset a 7,5 m. Pior erro na re-sonda: 0,15 dB.

### Portadores e Cena

- **`CarroEletrico`:** `CORPO_CARRO` (ou o ônibus de 12 × 2,5 × 3,3 m com 6 pneus e o trole); pneus `pneu.k` (bp 1 kHz Q 0,8: −10 dB em 250 Hz e 4 kHz, 95 dB(A) por roda a 80 km/h, n 3,5; ônibus +3 dB) e `aero` (80 dB(A) a 80 km/h, n 6) ligados. O 1º motor integra o carro inteiro (resistência refletida menos o torque do 2º, inércia 1,06·m·r_w²/i²); o 2º anda preso a ele (ω imposta). Controle de tração a 0,75 g. Atrito (mudo) abaixo de `v_regen,min`. `marcha` −1 = ré (AVAS de ré).
- **Trem com motor (`TracaoTrem`):** `Carga` Davis + rampa por motor; até 4 unidades do motor replicadas ciclicamente nos truques motores, pelo orçamento de fontes que sobra (o trem sem motor não muda): por truque `motor.g` (motor + redução + escovas) e `inversor.g` (inversor + soprador); por carro `tracao.c`; ou carros agrupados. Sob o piso (10 cm abaixo dele). O `aux` vai no carro do conversor, `dentro` com vias (estrutura e dutos, lp 2,5 kHz) para a cabine. Pedal com rampa de 0,5/s (limitador de solavanco). `ConfigTrem` ganhou `truques` (bonde: um truque nos módulos 1, 3, 5) e `reservaFontes`; sem eles, o trem é o mesmo. O N700 na Passagem: trem-bala de 10 vagões, 8 carros motores, 63 fontes (por carro).
- **Bancada:** `PortadorBancada` (portador `nenhum`) com `CargaBancada` constante, quadrática ou degrau. **Drone:** `Multirrotor` (tipo `drone`, `COMPAT.drone = ['eletrico']`), carga `c_Q·ρ·n²·D⁵`, PI do ESC sobre a rotação (coletivo 0,5 = pairado), `motor.k`/`helice.k` nos rotores.
- **Passagem:** `ADAPTADORES`, `USO_REAL` (carro, trem, `nenhum`, drone) e `PORTADORES_NO_DSP` com o elétrico; o "Trem-bala no túnel" passa a ter o N700; presets novos: Tesla na rua, Taurus partindo do-re-mi (a velocidade vem do motor: `partida`), Metrô chegando na estação (freio elétrico), Trem-bala N700 no túnel, Drone pairando; seção Motor do trem com tração e freio elétrico. `src/scene/dsp-cena.ts` ganhou só o motor elétrico em `montarMotor`/`montarPortadorComMotor` e o trem com motor na mensagem `portador` (mudança mínima, relatada).
- **Página:** Cena nova (`DSPEletricoPagina` = `CenaDSP` + portador do preset), ouvinte sempre no gimbal preso ao corpo (fora a 7,5 m, cabine, cofre/sob o assoalho, livre), ambientes céu, rua e galpão (próprios da página), túnel e estação; mostradores de rpm, v, `f_e`, `f_c`/N ou o teclado do do-re-mi, corrente com sinal, potência, M e Φ, dB(A) no ouvido, espectro anotado pelas linhas da telemetria e espectrograma de 10 s.

### Ferramentas e portões

`npm run teste:eletrico` (`tools/eletrico/valida.ts`, 12 grupos em série, ~40 s), `npm run cpu:eletrico` (`tools/eletrico/cpu.ts`: banco de 200 linhas, motor do N700, N700 no túnel pela Cena e as coletas do `--trace-gc`, com o tempo de CPU e a mediana de 3), `npm run lenta:eletrico` (os 18 presets em quatro estados: 18/18), `npm run navegador:eletrico` (Chromium, Firefox e a reserva). Portões da etapa: `paridade:ronco`, `paridade:turbina` e `paridade:acoustics` idênticos; `teste:cena` com as mesmas 105 medidas e os mesmos estados de antes (93 ok, 12 desvios: só o CPU e as coletas do laço variam de rodada para rodada); `teste:diesel`, `teste:radial`, `lenta:diesel`, `lenta:radial`, `typecheck`, `build` e os `navegador:*` de todas as páginas no `dist/`.

**Desvios com teto e sementes** (desde 22/11/2026, `tools/desvios.ts`, comum às famílias). Uma medida fora do alvo só passa se estiver no retrato `tools/eletrico-desvios.json` (chave = nome exato da medida; `medido`, `folga`, `motivo`) e o valor de hoje ficar dentro da folga do gravado (±1 dB nas medidas em dB, ±5 % nas outras; alargada, com a razão em `nota_folga`, onde a mediana de 3 sementes muda mais que isso entre bases). Saiu da folga, para pior ou para melhor: falha até `--atualizar` (tudo o que mudou) ou `--atualizar=<nome>` (só a medida que a mudança explica). Medida do retrato que voltou a passar: aviso de desvio órfão. Medidas à beira (`beira: true`: passam por menos de 5 % da tolerância e caem fora com outras sementes) podem passar ou falhar dentro da folga. Contagens, transientes, vagar e CV são a mediana de 3 sementes do ruído (`semear` troca o estado dos RNG do DSP montado, depois da calibração, que fica com a semente de fábrica; `--semente N` muda a base, 0 é a de fábrica). Antes, o desvio era só um nome (a medida podia piorar à vontade) e o resultado valia para uma semente: com outras três, 8 medidas "ok" do Elétrico viravam falha (AUDITORIA T-ELE-03). O grupo que confere a tabela 3.7 chama-se `alvos-3.7` (era `gravacoes`: não abre gravação nenhuma). As bandas dos quatro casos conferem as cinco bandas da decisão 3, 20–60 e 60–150 Hz a ±6 dB; o vetor do Taurus e da CPTM estava deslocado uma casa e o grave ficava fora do critério: o Taurus fica 8,5 e 7,5 dB abaixo em 20–60 e 60–150, a CPTM 8,2 em 20–60 (desvios, T-ELE-05). AVAS e pneus são medidos no asfalto, a condição do alvo (T-ELE-04): AVAS 54,8 / 62,9 / 70,4 dB(A) a 0 / 10 / 20 km/h, pneus 75,7 dB(A) (desvios; em campo livre 55,0 / 61,8 / 68,3 e 70,7). O AVAS que saía de parado para 108 km/h estourava 50 dB acima do nível do limite na rampa de desligar (P-02): corrigido em 22/11 (`avas.ts`, as leis param na velocidade-limite), −2,6 dB.

### Alvo × medido (`npm run teste:eletrico`: 90 medidas; semente de fábrica 82 ok e 8 desvios com teto; retrato com 15 entradas, 7 à beira; 0 falhas com as sementes de base 0, 1000, 2000, 3000 e 4000)

Os números da tabela são da semente de fábrica e de antes das fichas de 22/11; os de hoje estão no retrato e na saída do teste. Depois das fichas (F-ELE-03, F-ELE-07 a F-ELE-09): o Metropolis com 24 × 180 kW faz o 0–80 em 26,4 s contra a conta do plano refeita, 22,9 ± 4 s (antes 16 × 150 kW: 38,0 s contra 30,5 de conta); o Leaf com os dentes reais tem a ordem de ranhura em 9 357 Hz a 85 km/h (desvio: 1,5 % abaixo dos 9,5 kHz de uma velocidade estimada) e a razão das famílias agudas em 1,41 (à beira: é o 4º harmônico do engrenamento, 96/68; com os dentes errados dava 96/64 = 1,50).

| Medida | Alvo | Medido |
|---|---|---|
| 200 linhas: frequência, nível, nada acima de 21,6 kHz; CPU (`cpu:eletrico`) | ±0,01%, ±0,1 dB, < −100 dB; < 3% | 0,0002%, 0,006 dB, −154 dB; 1,8% |
| troca de 100 linhas de uma vez (acima de 16 kHz); coletas em 10 s | < 0,05 FS; zero | 0,004 FS; zero (motor do N700: 5) |
| 0–100 km/h Model 3 · Leaf; 0–80 do metrô de 6 carros; regeneração 100 → 20 | 4,7 ± 0,5 · 8,0 ± 0,8; 36 ± 4; 9 ± 1 s | 4,59 · 8,19; 38,0; 9,76 s |
| Leaf a 5000 rpm: 666,7 / 2000 / 4000 / 4000 ± 666,7 Hz | ±0,5% | 0,000% |
| ranhuras k ±1 / ±2 / m 2 (Z_s 46); 6f_e contra 2f_e; barras com s; Φ entre 1× e 2× a base | −6 / −14 / −10 ± 1; −0,8 ± 1; ±0,5%; −6 ± 0,5 dB | −6,0 / −14,0 / −10,0; −0,8; 0,0%; −6,0 dB |
| Bessel `f_c ± 2f_e` e `2f_c ± f_e`, M 0,2 / 0,6 / 1,0 | −38 / −19,4 / −11,8; −16,3 / −10,5 / −16,7 ± 1 | −38,0 / −19,5 / −11,8; −16,3 / −10,5 / −16,7 |
| f_e → 0 sem salto | ≤ 0,5 dB | 0,000 dB |
| do-re-mi a 0,35 m/s²: 12 notas, durações, escala, patamar | 12 ±1%; 0,3–1,2 s; 6,2 ± 1 s; 598 ± 12 Hz | 12; 0,45–0,90 s; 6,45 s; 598,0 Hz |
| do-re-mi a 0,6 m/s² | 12; escala 3,6 ± 0,7 s | 12; 4,30 s (o esforço de partida de 300 kN não dá 0,6 m/s² com 486 t) |
| Taurus no patamar: 2f_c / 3f_c / 4f_c | −4..−9 / −5..−15 / −3..−10 dB | −6 / −9 / −9 |
| síncrona `f_c = N·f_e`; estalo nas trocas | ±0,1%; < 0,1 FS | 0,0000%; 0,0001 FS |
| aleatória δ 0,15: energia; pico em f_c | ±1 dB; ≥ 12 dB abaixo | −0,6; 21,8 dB |
| chopper: D 0,25 = 0,75; máximo em 0,5; D = 1 | ±0,5 dB; sim; < −60 dB | 0,00; +2,5 dB; mudo |
| Tesla a 7700 rpm: 3465 e 1062 Hz; laterais; ao dobrar T | ±0,5%; −10 ± 2; +6 ± 0,5 dB | 3465,0 e 1062,6; −10,0; +6,02 |
| \|T\| < 3%: engrenamento; chocalho (curtose) | < −40 dB; > 4 | −40,6; 11,8 |
| furadeira: 12× e 24× f_rot; envoltória do faiscamento | 2970 e 5940 ± 1%; Z_c·f_rot ±1% | 2967 e 5935; 2967 Hz |
| AVAS a 2 m, 0 / 10 / 20 km/h; deslocamento; 25 km/h; ré | 55 / 61 / 67 ± 1,5; 1,2 ± 0,1 %/km/h; < −40 dB; 1,5 Hz | 55,0 / 61,8 / 68,3; 1,200; mudo; 1,51 Hz |
| sonda (todos os presets); 4 estados × 2 s | ±1 dB; sem NaN, < −1 dBFS | −0,15 dB; nenhum |
| fontes: metrô de 8 carros; N700 de 10; drone: 4 BPF | ≤ 64; ≤ 64; ±0,5% | 62; 63; 0,19% |
| pneus a 80 km/h, 7,5 m, campo livre | 73 ± 2 dB(A) | 70,7 (**desvio**) |
| Taurus parado: 176, 527, 688 Hz contra o tom | −8..−12 dB | −9,5 / −9,5 / −10,3 |
| CPTM 9500: razão das famílias; SIV | 2,24 ± 0,05; 1333, 2666, ±60 Hz | 2,248; 1333,0, 2665,3, 60,0 |
| CPTM 9000: razões | 1 : 1,44 : 2,45 ± 0,05 | 1 : 1,440 : 2,434 |
| Leaf a 85 km/h: 96·f_rot; razão das famílias agudas | 9,5 kHz ±1%; 1,46 ± 0,05 | 9422 Hz; 1,500 |
| Tesla: portadora na cabine | ≈ 10 kHz, ≥ 40 dB abaixo do grave | 9785 Hz, −41,4 dB |
| bonde IGBT (Flexity) | f_c 2,0–2,5 kHz, 2f_c ≥ f_c | 2200 Hz, +2,0 dB |
| furadeira sem fio: f_rot; ×8, ×12, ×24; bandas 400–1k / 1–2,5k / 2,5–6k | 247,5 ± 1%; ≥ −3, ≥ −3, −10 ± 4; +4,9 / +17,0 / +16,7 ± 4 | 247,3; 0 / −2,4 / −10,9; +4,6 / +17,3 / +13,2 |
| furadeira de rede (variante): ×10, ×20; banda 2,5–6k | 3870, 7740 ± 1%; +22,7 ± 4 | 3874, 7747; +20,6 |
| Mavic: BPF; harmônicos 1–7; 63·f_rot; bandas | 209 ± 1%; tabela ±3; −13 ± 4; +0,8 / +0,7 / −2,3 ± 4 | 211,0 (os 4: 188, 205, 209, 211); 0 −6 −7 −6 −9 −8 −12; −11,8; −1,2 / −2,3 / −3,2 |
| drone 2 (variante): BPF; 6f_e | 382 Hz; 8,0–8,3 kHz | 381,8; 8034 Hz |
| MP 73 (Frota A sem chopper): corcova | ≈ 300 → 700 Hz | 270 → 896 Hz |
| Taurus no patamar (estação, 4 m): bandas; centroide | −11,5 / +3,2 / −2,0 / −12,4 ± 4; 622 ± 25% | −8,7 / −0,4 / −5,8 / −13,0; 588 Hz |
| CPTM 9500 parado, de dentro: bandas | +0,9 / −4,3 / −18,7 ± 4 | +1,8 / −0,3 / −17,2 |
| Taurus a 7,5 m arrancando: tom sobre o fundo da estação | 10 ± 3 dB | +12,4 dB |
| Tesla a 6 m e 30 km/h: L_AFmax; a 100 km/h, trem de força | 62 ± 3 dB(A); ≤ −8 dB do total | 61,9; −29,3 dB |
| os 5 presets elétricos da Passagem pela mensagem `portador` | montam e soam | todos |
| CPU: motor do N700 (4 unidades); N700 no túnel pela Cena (63 fontes) | ≈ 3%; < 40% do quantum | 2,9%; 17,2% (p99 21,6%) |
| N700 de 16 carros | ≤ 64 fontes | não cabe nem sem motor (**desvio**) |

### Desvios conhecidos e escolhas (com o motivo)

- **N700 de 16 carros:** o trem de 16 vagões passa das 64 fontes da Cena já sem motor (67 com uma face; `maxVagoes` 15). O orçamento é da Cena e do trem sem motor, fora desta etapa; o N700 entra no trem-bala de 10 vagões da Passagem.
- **Pneus a 7,5 m (70,7 contra 73 dB(A)):** com os 95 dB(A) por roda do CENA 4.1 à letra, os 73 contam as 4 rodas a 7,5 m; no corpo real o par do lado de lá fica 1,55 m mais longe e os eixos a ±1,4 m. No asfalto a imagem da fonte no chão soma +5 dB (75,7).
- **Níveis de 4.2 mudados (≈, contra as gravações):** inversor dos carros 62 dB(A) (72 no texto: o Leaf e o Plaid têm a portadora 45–51 dB abaixo do grave da cabine, e com 72 as laterais `f_c ± 2f_e` passavam a ordem de ranhura 96·f_rot); furadeira escovas 101 e ventilador 86 (94 e 90: ×12 a 0 dB e ×8 a −1 da gravação); Taurus inversor 96 e auxiliar 77 (98 e 85: o tom 10 dB acima do fundo da estação e as linhas fixas a −10 dB dele); Metropolis `P_max` 150 kW (os 190 da ficha dão 0–80 em 30 s contra 36 ± 4).
- **Perfil medido do GTO (Taurus) e do bonde:** a tabela de Bessel com M ≈ 0,1 dá 2f_c a −22 dB e nenhum 4f_c; as gravações têm −4..−9 e −3..−10. O preset leva `perfilGrupos` (acústico, relativo à linha f_c já com a carcaça; no Taurus até 8·f_c, a gravação D tem 2996 Hz a −22) e o bonde 2f_c a +2 dB (Citadis: 2f_c mais forte).
- **Leis das ranhuras medidas com Z_s 46:** com `Z_s/p` inteiro (o Leaf de 48) a linha m = 1, k = 0 cai em 12·f_e e soma em potência com a ondulação de torque; a frequência é conferida no Leaf de 48, as leis num Leaf de 46.
- **AVAS a 2 m:** medido em campo livre, 125 ms com o alto-falante no través (o mesmo ponto parado e andando). No asfalto a reflexão a 2 m cancela parte do tom de 250 Hz (Δ ≈ 0,56 m) e não o ruído de 1 kHz, e o nível passa a depender da mistura tom/ruído. O alto-falante foi 1 cm para fora da face do para-choque ([2,31; 0; 0,4]): em [2,2; 0; 0,4] ele fica dentro da caixa do corpo de 4,6 m e a Cena o sombreava.
- **Desbalanceamento das escovadas sem a curva da carcaça:** a 1ª e a 2ª ordem sacodem a ferramenta inteira; com o passa-alta de 1 kHz da carcaça "pequena" o ×1 da furadeira ficava 24 dB abaixo da gravação.
- **Fontes do trem agrupadas:** `motor.g` junta motor + redução + escovas e `inversor.g` junta inversor + soprador do truque (4.3 pede `motor.u`, `inversor.u`, `reducao.u`, `ventilador.u` separados); com eles separados o metrô de 8 carros não cabe nas 64 fontes. O `aux` é um canal do motor (4.1 o põe no inversor "quando parado", 4.3 numa fonte própria do portador): o trem o põe no carro do conversor.
- **Interior do trem:** o largo dos ventiladores do auxiliar (`auxRuido`, ar-condicionado) entra no canal `aux`, que chega à cabine pelas vias (estrutura e dutos, lp 2,5 kHz); sem ele a CPTM parada de dentro não tinha nada abaixo de 400 Hz.
- **ESC do Mavic:** passeio de ±0,4% (a gravação mostra a linha do motor oscilando ±1,5%, mas com o passeio desse tamanho as quatro BPF se misturam em 6 s); o PI do ESC tira o erro de regime.
- **Variantes só da validação:** MP 73 (a Frota A sem o chopper), a furadeira de rede e o drone 2 não são presets (as 18 fichas da seção 5 ficam como estão).
- **Página:** o espectro é o da saída (depois do ouvinte), não "antes do ouvinte" (6).

### Pendente (TODO)

- Trem de 16 vagões (N700 inteiro): orçamento da Cena ou fontes do trem agrupadas.
- Grave da cabine do carro elétrico (rumor de estrada e "boom" abaixo de 200 Hz), que faz a portadora do Plaid ficar 51 dB abaixo do grave na gravação.
- Chave 50/60 Hz do motor industrial na página; presets próprios para o MP 73, a furadeira de rede e drones menores.
- Revisão de ouvido (`REVISAO-DE-SOM.md`) de todos os presets.

## Vapor

O projeto está em [`VAPOR.md`](VAPOR.md); aqui fica o que foi feito, como e o que se mediu. Página `vapor.html` (`src/pages/vapor/`), DSP em `src/engines/vapor/`, worklet `src/worklet/processador-vapor.ts` (`vapor`, o `CenaDSP` com o portador do preset), portadores em `src/carriers/`.

### Um DSP novo

`VaporDSP` (`src/engines/vapor/dsp.ts`) implementa `Motor` direto, sem herdar do `EngineDSP` (decisão 1). Nada no Ronco, no Diesel, no Radial, na Turbina, em `acoustics/`, `scene/` ou `ui/` mudou; a exceção são os ganchos de montagem em `scene/dsp-cena.ts`, cinco linhas. Por amostra:

- **Cilindros de dupla ação.** Cada extremidade tem pressão, volume pela manivela (com a angularidade da biela, r/l = 1/8,5, e a haste do lado de trás) e os eventos da tabela 1.2 interpolados no corte:
  - admissão com 1ª ordem de 3 ms até a caixa de válvulas, e a perda das passagens só no sentido de entrada;
  - expansão e compressão politrópicas incrementais;
  - escape pelo pórtico abrindo em 20° de manivela, com `Ψ` e engasgo, resolvido de forma implícita contra a onda da passagem.

  O torque é `Σ (p − p₀)·dV/dθ`. A distribuição dos dois lados não é igual: ±2,5% de corte entre os lados, ±1% entre as pontas, ±1,3/0,4 dB de escape. É isso que põe a linha de 2/volta 6–11 dB abaixo da de 4/volta. Cada admissão varia ±5% (água arrastada), e o CV entre os picos sai em 2,3 dB.
- **O chuff é a rede** (`rede.ts`). O caminho:
  - uma `Line` por extremidade → `Junction` → tubo de descarga (`kNL` 0,3) → bico (orifício implícito) → caixa de fumaça (volume integrado de forma implícita) → chaminé → boca;
  - a boca é um `Radiator` com reflexão 0,97 no grave e corte em 0,9·f_ch: fecha o Helmholtz de 9–14 Hz e deixa a meia onda com Q 2,5–3;
  - o jato entra na base da chaminé como fonte de pressão `0,5·ṁ·U/A_ch` (passa-baixa de 2 polos no comprimento de mistura), com a turbulência de Lighthill por cima: é o "hoot" largo de cada chuff;
  - por cima ainda: ruído de mistura por Strouhal (`0,2·U/D`, Q 0,5, ∝ ṁ·M³, envoltória de 2 kHz), choque acima de `p_bp/p_cx` = 1,9 e sopro da tiragem ∝ (ṁ·M)² médio;
  - o canal tem passa-alta de 4 polos em 20 Hz; o Helmholtz fica só na `pCaixa` da telemetria.

  As linhas usam a `SOUND_SPEED` 520 do pacote. Os comprimentos entram escalados por 520/c (c_v 480, c_q 450) e encurtados pelo atraso de fase dos filtros da boca, para a meia onda cair em `c_q/(2L)`.
- **Caldeira com estado:** `dp/dt = (E − ṁ)·k_cal`, evaporação com 60 s de inércia térmica, foguista automático, segurança com histerese, injetor pelo nível de água. O regulador (1ª ordem de 0,4 s, lei de área de 1.1) alimenta o volume da caixa de válvulas; o reverser responde em 1,5 s. O compound (Y6b, barco) tem o receptor e a válvula de simplificação.
- **Patinagem pela troca de J** (1.7). Aderido, `J = J_motor + carga.inercia`. Com o esforço acima de `μ·W_ad` a roda desacopla e fica só com `J_motor`, e o atrito de escorregamento empurra o trem; readere quando volta à velocidade dele. Nos dois motores (Big Boy, Y6b), ω e patinagem são próprios de cada um, com deriva de fase ε sorteada (1%).
- **Apito como guia de onda realimentada** (`apito.ts`). Cada tubo é uma malha fechado-aberto: ida e volta 2L/c com inversão na boca, por isso só os harmônicos ímpares. O jato do anel entra como `g(p_s)·tanh`, com passa-baixa em 4·f. O limiar fica em p_s 0,1–0,15 (abaixo dele, o quilling). O aquecimento leva c_v de 0,90 a 1,0 (τ 13 s soprado), e o sopro fraco afina −60 cents.
  - A malha saturada não oscila na ressonância linear. Por isso cada tubo é afinado uma vez na construção: 0,3 s soprado, D corrigido pela nota medida.
  - Acordes reais: D51, C57, Big Boy com 6 tubos, 844 com o par de 407/420 Hz batendo a 13 Hz.
  - O sino é modal, com os parciais do Big Boy.
- **Auxiliares** (`auxiliares.ts`):
  - bomba Westinghouse (thump, psh, clique, ritmo ±5%);
  - injetor (afina ao pegar, gorgolejo);
  - segurança;
  - torneiras (sopros em fase com as admissões, água nas primeiras voltas);
  - vazamentos e pinga-pinga;
  - bielas (impacto de folga nas inversões de força, rolar 1/volta, dashpots do Corliss);
  - soprador, queimador do Stanley, engrenagens (Shay, trator) e correias.
- **Governador de esferas** (estacionária, trator parado): PI sobre o corte (5–60%), com integração condicional. Abaixo do corte mínimo ele fecha o regulador, como a borboleta de Watt.
- **Determinismo e CPU:** `RNG` com a semente do preset, render offline idêntico a cada execução. Por amostra, K4s e 844 custam 0,25 do Ronco; o Big Boy, 0,34 (desvio, ver abaixo).

**Fontes** (4.3), em Pa a 7,5 m: `chamine`, `cilindro.e/d`, `bielas.e/d`, `apito`, `seguranca`, `bomba.ar[.k]`, `injetor`, `sino`, `queimador`, `engrenagens`, `correias`.

**Nível absoluto** (`motor.ts` → `prepararMotorVapor`, ~2 s na thread principal, guardado por preset): cada componente é renderizado sozinho na condição de referência de 4.6 e levado ao `L_W` dB(A), corrigido pelo índice de diretividade. Fora da referência, tudo é física.

### Portadores e Passagem

| Portador | Classe | O que faz |
|---|---|---|
| locomotiva | `LocomotivaVapor` (`locomotiva-vapor.ts`) | Composição locomotiva + tênder + N vagões, por composição (sem herdar do `Trem`). Carga de Davis + rampa + freio; `velocidadeFixa` impõe ω |
| gerador | `Gerador` (extensões `rpmNominal`, `semFontes`, `corpo`) | Corliss a 75 rpm com o governador do próprio motor, numa casa de máquinas de 12 × 6 × 6 m |
| trator | `Trator` (`trator.ts`, `TipoPortador` novo) | Rodas de ferro, marchas 0/1/2 pela redução do motor, `c_rr` 0,05 |
| barco | `Barco` (`barco.ts`, `TipoPortador` novo) | Rodas de pás (tapas `N_pás × f_rev`, respingo e "tum"), água arrastada, casco com atrito e onda acima de Fr 0,3 |
| carro | `CarroDireto` (`carro-direto.ts`) | Stanley sem câmbio, relação fixa, pneus ligados |

Detalhes da composição:
- Truques e vãos saem de `xTruquesVagoes`/`xVaosVagoes`, extraídos de `trem.ts` com a mesma aritmética: o `Trem` continua idêntico e o `teste:cena` não muda.
- Rolamento: `FonteRolamento` por grupo de eixos, n 3, em dB(A) por eixo a 80 km/h: motrizes 103; guias, tênder e vagões 100.
- Os vãos só entram se couberem nas 64 fontes.

Tabela de compatibilidade: `COMPAT` ganhou `trator: ['vapor']` e `barco: ['vapor', 'diesel']`. `ADAPTADORES` e `USO_REAL` ganharam o vapor (locomotiva, gerador, carro, trator, barco).

Na Passagem:
- `PORTADORES_NO_DSP` inclui trator e barco, e `PADROES` tem os dois;
- presets novos: "Pacific passando a 100 km/h", "Big Boy arrancando" e "Maria Fumaça na estação";
- `configPortadorVapor` (`portadores-vapor.ts`) monta a configuração do portador pelo preset, a mesma para a página e para o worklet.

### Presets

As 14 fichas da seção 5: K4s, A4, D51, 844, Big Boy, Y6b, Shay, Maria Fumaça, pannier, King, Corliss, Aveling, Stanley e o vapor de rodas de pás.
- A **Maria Fumaça** é uma ficha por classe: Consolidation métrica Baldwin, 17" × 22", roda de 44", 180 psi (estimados). O campo `nota` do preset avisa que as dimensões têm de ser conferidas no acervo da ABPF antes de nomear uma máquina específica.
- A **pannier** ficou com `lwChuff` 118. A 4.6 a lista entre as médias (124), mas ela é a 0-6-0T pequena de 118.
- O **Corliss** escapa para o condensador (`lwChuff` 80, o chiado do condensador), com `potenciaGerador` de 550 kW.

### Ferramentas e portões

- `npm run gravacoes:vapor` (`tools/vapor-gravacoes.ts`, passo 1): a porta em TypeScript dos scripts do projetista (`tools/vapor-analise.ts`) contra o Apêndice A. O Butterworth/filtfilt bate com o scipy em 12 algarismos. Resultado na etapa: 135 ok e 6 desvios, que são notas do Apêndice que o próprio `apito.py` não acha com os parâmetros do texto. **Precisa das gravações**, que ficam fora do git: sem `-- --pasta <pasta dos WAV>` ele procura numa pasta temporária da etapa que não existe mais e termina com erro (`ENOENT`, código 1); por isso não entra no `verificar`.
- `npm run teste:vapor` (`tools/vapor-valida.ts`): 13 grupos em paralelo, 30–90 s. `npm run cpu:vapor` (`tools/vapor-cpu.ts`): CPU por amostra contra o Ronco, 3 passadas alternadas, tempo de CPU do processo (`process.cpuUsage()`), mediana: K4s 0,15, 844 0,15, Big Boy 0,21 (com o tempo de relógio e uma passada o Big Boy dava 0,34–0,40; a primeira passada ainda paga o JIT e sai perto de 0,3).
- **Desvios com teto e sementes** (desde 22/11/2026, `tools/desvios.ts`, comum às famílias). Uma medida fora do alvo só passa se estiver no retrato `tools/vapor-desvios.json` (chave = nome exato da medida; `medido`, `folga`, `motivo`) e o valor de hoje ficar dentro da folga do gravado (±1 dB nas medidas em dB, ±5 % nas outras; alargada, com a razão em `nota_folga`, onde a mediana de 3 sementes muda mais que isso entre bases). Saiu da folga, para pior ou para melhor: falha até `--atualizar` (tudo o que mudou) ou `--atualizar=<nome>` (só a medida que a mudança explica). Medida do retrato que voltou a passar: aviso de desvio órfão. Medidas à beira (`beira: true`: passam por menos de 5 % da tolerância e caem fora com outras sementes) podem passar ou falhar dentro da folga. Contagens, transientes, vagar e CV são a mediana de 3 sementes do ruído (`semear` troca o estado dos RNG do DSP montado, depois da calibração, que fica com a semente de fábrica; `--semente N` muda a base, 0 é a de fábrica). Antes, o desvio era só um nome (a medida podia piorar à vontade) e o resultado valia para uma semente: com outras três, 11 medidas "ok" do Vapor viravam falha (AUDITORIA T-VAP-01, T-VAP-03). O pórtico de escape é medido (a área que o laço entrega à rede, interceptada em `rede.injetar`, contra o ângulo da manivela do `tap`: 19,9°), no lugar do `ok` fixo; os rótulos mostram o critério de verdade.
- `npm run lenta:vapor` (`tools/vapor-lenta.ts`): os 14 presets no portador de uso real. Confere parado sem escape, arrancada no molhado com patinação, chuffs/s exatos em cruzeiro, drifting e ausência de NaN: 14/14.
- `npm run navegador:vapor`: Chromium e Firefox, servindo o `dist/`.

### Alvo × medido (`npm run teste:vapor`: 121 medidas; semente de fábrica 94 ok e 27 desvios com teto; retrato com 36 entradas, 12 à beira; 0 falhas com as sementes de base 0, 3000 e 4000 depois das fichas, e 0, 1000 e 2000 antes)

Os desvios estão em negrito. Os números da tabela são da semente de fábrica, de antes das medianas; os de hoje estão no retrato e na saída do teste. Com a mediana de 3 sementes o ataque a 9/s virou desvio (24 ms contra 37 ± 30 %: só passava com a semente do preset), o Shay e a CPU do Big Boy voltaram a passar, e doze medidas ficaram à beira (ataque a 4/s, decaimentos a 9 e 21,3/s, p/v a 21,3/s, massa por chuff, linha de 2/volta a 7/s, nível por chuff na arrancada, "pants" do Stanley, L_W do chuff, quilling, a 844 a 15 m). A volta do Corliss passou a ser o tempo de acomodação a ±1 % (a primeira passagem caía em 1 a 10 s ou em nunca conforme a semente): ele não se acomoda em 30 s, desvio estável. Depois das fichas de 22/11 (comprimentos reais das composições, F-VAP-04) a segurança a 10 m foi a 105,4 dB(A) e a 844 a 15 m a 89,9.

| Medida | Alvo | Medido |
|---|---|---|
| K4s a 1 volta/s, corte 50%: p_rel · massa por chuff · τ_bd | 6,8 ± 0,3 bar abs · 0,65 ± 0,05 kg · 30 ± 5 ms | 6,60 · 0,623 · 29,8 ms |
| torque × ω = ∮p·dV · TE a corte 80%, ω → 0 | ±5% · 198 ± 10 kN | 0,00% · 194,0 kN |
| taxa de chuffs (linha da envoltória) a 3/5/7/10 por s | ±2%, ≥ 15 dB | 3,003/5,005/7,007/9,985, 28–35 dB |
| linha de 2/volta contra a de 4/volta, 3/5/7/10 por s | −5 … −15 dB | −10,2/−9,7/−5,6/**−3,9** |
| chaminé do 844: meia onda · decaimento · Helmholtz · no canal | 132 Hz ± 5% · 15–25 ms · 9,7 ± 1 Hz · < −40 dB | 131,8 · 16,6 ms · 9,34 · −41,3 dB |
| forma a 4/s, corte 70% (ataque/largura/decaimento ms; p/v dB) | 47/70/68 ± 30%; 16,5 ± 3 | 34/68/69; 16,7 |
| forma a 9/s, corte 40% | 37/55/52; 12 ± 3 | 26/58/**70**; 10,2 |
| forma a 21,3/s (Big Boy a 52 km/h) | 15/16/17; 9 ± 3 | 17/18/22; **13,2** |
| p/v(150–400) − p/v(1,5–6k) · CV entre picos, 4/s | 3–7 (±2) · 1–3 dB | 2,8 · 2,3 dB |
| bandas no pico, de perto (60–150 / 400–1k / 1–2,5k / 2,5–6k / 6–12k) | −9,5±4,5 / +1±3 / −2±3 / −3±4 / −8±6 | −5,3 / +2,7 / **+1,7** / +0,1 / −10,2 |
| centroide no pico · vale/pico, de perto | 1 100–1 600 Hz · 1,05–1,35 | 1 446 · **0,77** |
| escurecimento do corte curto, Δ(2,5–6k) | −10 ± 4 dB | −9,4 dB |
| 844 a 25 m pela Cena (400–1k / 1–2,5k / 2,5–6k / 6–12k; centroide; p/v) | −1±4 / −3±4 / −6±5 / −15±6; 750–1 500; 7–8 ± 3 | **+6,2 / +3,3** / −1,7 / −14,3; 1 032; **13,3** |
| pico a 7,5 m (referência · arrancada) · acima de 16 kHz a 21/s · linha em fs/16 · salto a 45/s | < 25 Pa · < 60 Pa · < −60 dB · < 6 dB · < 0,1 FS | 13,1 · 15,0 Pa · −61,8 · 1,3 dB · 1,21 Pa |
| segurança abre / fecha / ciclo (K4s parada, fogo 1) | 14,43 / 13,73 bar / 1–3 min | 14,43 / 13,73 / 1,02 min |
| queda da caldeira: apito 20 s · arrancada com 300 t em 30 s | 0,6 ± 0,2 · 1–2 bar | **0,11 · 0,83** |
| bomba de ar · torneiras (sopros/volta, em fase) | 70 ± 4/min, ≥ 15 dB · 4, ≥ 90% | 70,3, 25 dB · 4,00, 100% |
| apito D51 (360/465/548 Hz) · 3º e 2º harmônicos · ataque | ±1,5% · −6 ± 4, < −15 · 100–300 ms | 360,4/464,4/547,9 · −5,3, −83 · 105 ms |
| apito frio (início / 30 s) · batimento do 844 · quilling · varredura | −10 ± 2% / −1% · 13 ± 2 Hz, ≥ 6 dB · sem linha · nota certa e nível monotônico | −8,6 / −0,93% · 13,0 Hz, 20 dB · nenhuma · ok |
| sino: parciais · batidas/s · T60 | ±3% · 2,0–2,3 · 3–5 s | 1 : 2,159 : 3,529 : 5,199 : 7,051 · 2,25 · 4,00 s |
| A4 · Y6b (composição, p_rel da BP, simplificação) · King | 6/volta · 4/volta, 2–4 bar, 8/volta · 4 batidas duplas | 5,98 · 4,00, 3,57 bar, 8,00 · 4,00 |
| Shay a 20 km/h · linha de 8/volta da King · linha de 8/volta do Big Boy em 60 s | 30 ± 0,6 · < −20 dB · varia ≥ 10 dB | **31,1 · −5,2 · 7,6 dB** (a de 4/volta de cada motor, 10,65 Hz, ok) |
| patinagem (molhado, 500 t): surto · ω roda/trem · chuffs/s · readere · com areia | ≥ 1 · 3–5× · 15–20 · ≤ 1,5 s · nenhum | aos 1,09 s · 3,3× · **13,8** · 0,44 s · nenhum |
| drifting a 60 km/h: chaminé · rolamento | −25 ± 3 · ≥ +10 dB | −25,7 · +16,2 dB |
| composição a 40 km/h, 15 m: vagões × locomotiva · centroide do rolamento | −13 ± 3 dB · 550–1 000 Hz | −15,2 · 846 Hz |
| a 100 km/h · L_Aeq da K4s a 15 m · Doppler do apito do 844 | 0 ± 4 · 90–100 dB(A) · 290,3/272,2 ± 1 Hz | **−9,7 · 85,8** · 290,2/272,2 |
| orçamento: Big Boy + 20 vagões · 30 vagões | ≤ 64 fontes · erro claro | 60 fontes · "até 23 vagões" |
| Corliss: 2/volta a 75 rpm · degrau de 50% · volta | 2,5 ± 0,05 · −3 ± 1% · 5–10 s | 2,515 · **−5,3% · 4,8 s** |
| Aveling em lenta (escapes/s, 400–1k) · Stanley a 40 km/h (pants/s, p/v, queimador) · barco a 40 rpm | 2,5 ± 0,3, +8 dB · 23 ± 0,5, ≤ 4 dB, ≥ +10 · 6,7 ± 0,2 | **3,38, −1,3** · 23,34, **6,7**, ok · 6,67 |
| L_W na referência (chuff, apito, segurança, torneiras, sino, bomba, injetor) | tabela 4.6 ± 1 dB | 124,3 / 145,0 / 140,0 / 123,2 / 113,1 / 104,2 / 94,0 |
| apito a 30 m · segurança a 10 m · 844 a 15 m · por chuff na arrancada / em cruzeiro | 105 ± 3 · 110 ± 3 · 95 ± 5 · +6 ± 3 / −4 ± 3 | **100,5 · 104,4 · 89,1** · +3,6 / **−7,8** |
| CPU por amostra / Ronco (K4s, 844, Big Boy), `cpu:vapor` | < 1/3 | 0,15 / 0,15 / 0,21 (tempo de CPU, mediana de 3) |

### Desvios conhecidos

O motivo de cada um está no `DESVIOS` de `tools/vapor-valida.ts`. Por grupo:

- **Contas do VAPOR.md que não fecham:**
  - Apito por 20 s: 0,3–0,6 kg/s com o `k_cal` de 1.1 derruba 0,16 bar, não 0,6.
  - Níveis a distância: 124 dB(A) de L_W dão 89,5 dB(A) a 15 m em campo livre. A Cena ainda mede a média dos dois ouvidos (−3 dB para um ouvinte de lado), e o apito aponta para a frente.
  - Composição a 100 km/h: a conta de 3.5 esquece o rolamento da própria locomotiva e do tênder.
- **Caldeira:** na arrancada a pressão cai 0,8 bar em 30 s. Com o regulador em 0,6 a área é 25% da máxima, e o consumo fica em ~1·E_max.
- **Forma e bandas:**
  - De perto, o vale é a tiragem, mais escura que o pico (vale/pico 0,77). Uma tiragem mais larga dava o vale mais claro das gravações, mas estragava o decaimento e o escurecimento do corte curto.
  - A 25 m o nulo do solo cai na banda de referência. A gravação do próprio 844 dá +4/+5 dB nessas bandas, como o modelo.
  - A 1,4 chuff/s o decaimento segue o M³ do jato, não o esvaziamento.
  - A 10 chuffs/s a linha de 2/volta fica a −3,9 dB da de 4/volta.
- **Geometrias:**
  - Shay: a 30 chuffs/s os escapes se fundem e a linha da envoltória sai em 31,1; a taxa na telemetria é exata.
  - King: a angularidade da biela separa as duas batidas de cada par. A própria 6024 tem a linha de 8/volta a −14 dB.
  - Big Boy: o bico comum alisa os pares, e a linha de 8/volta varia só 7,6 dB.
- **Patinagem:** o surto chega a 13,8 chuffs/s e a energia por chuff sobe em vez de cair. A caixa de válvulas não cai os 30–50% que 1.7 supõe.
- **Estacionárias:**
  - Corliss: queda de −5,3% no degrau, limitada pelo reabastecimento da caixa de válvulas.
  - Aveling em lenta: o governador desce devagar, e falta o ruído de mecanismo da gravação.
  - Stanley: p/v de 6,7 dB; falta o volume do abafador.
- **CPU do Big Boy:** com o tempo de CPU e a mediana de 3 passadas, 0,21 do Ronco: o 0,34 de antes era o tempo de relógio de uma passada (com o JIT frio e a máquina ocupada).
- **Fichas corrigidas em 22/11/2026** (AUDITORIA F-VAP-04 a F-VAP-08): comprimentos reais das composições (K4s 25,45 m, A4 21,65, 844 34,81, Big Boy 40,47, Y6b 35,01; divisão locomotiva/tênder ≈ onde a fonte só dá o total), apito de uma nota na Y6b, o de 3 notas da 844 no Big Boy, o de 3 notas da PRR na K4s, a A4 sem bomba de ar.

### Relatado, sem mudar (fora da etapa)

- **`acoustics/`:** o que faltava ficou em `src/engines/vapor/rede.ts`:
  - uma `Line` com velocidade do som por instância;
  - um volume acústico (a caixa de fumaça, dentro de `RedeEscape`);
  - o orifício implícito genérico (`orificioDeLinha`/`orificioParaLinha`, o `exhaustFlow` do Ronco sem o estado da classe);
  - a `vazaoV`, que é o `flow` com o √(R·T) do vapor.
- **`trem.ts`:** só a extração de `xTruquesVagoes`/`xVaosVagoes`, com a mesma aritmética (`teste:cena` igual).

### Pendente (TODO)

- Cena 3D da composição na página `vapor.html`. A Passagem já tem a cena 3D; a página do vapor não importa three.js.
- Ruído de mecanismo das máquinas paradas (Aveling), volume do abafador do Stanley, e uma tiragem com o espectro do vale das gravações sem alongar a cauda do chuff.
- Hélice no barco (`FonteHelice`, 2.4) e o diesel marítimo (o portador `barco` aceita o diesel, mas não há preset).
- Conferir a ficha da Maria Fumaça no acervo da ABPF.

## Validação

O que foi medido nas simulações offline (Node) durante o desenvolvimento do Ronco e da Turbina (as medidas das outras famílias estão na seção de cada uma). Os números abaixo saíram de harnesses da época que não entraram no repositório (o teste de lenta dos 68 veículos a 20 °C e −5 °C, o de corte de giro, a auditoria de câmbio); o que existe hoje para o Ronco é a paridade com o legado, `npm run lenta:ronco` (`tools/ronco-lenta.ts`, escrito na auditoria de 18/11/2026 no lugar dos harnesses perdidos: os 68 carros a 20 °C e a −5 °C, partida, lenta, acelerada, corte de giro em ponto morto e troca de carro com o motor rodando; ~3 min), `npm run auditoria:fichas` (câmbio de todas as famílias) e `node tools/analise-som/regressao.js` (todos os presets: partida a frio, lenta, acelerada, em marcha e arcade; acusa NaN, motor apagando, lenta fora do lugar e saturação):

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
- Esta lista é a do Ronco e da Turbina. As limitações das outras famílias estão nas seções "Desvios conhecidos" e "Pendente (TODO)" de cada uma, acima, e o que a auditoria achou de incorreto ou incompleto no conjunto está em [`AUDITORIA.md`](AUDITORIA.md).
- Os testes de cada família (`teste:*`) aceitam como "desvio documentado" medidas fora do alvo: zero falhas não quer dizer que o som bate com as gravações (das bandas medidas contra gravação no Radial e no Rotativo, quase todas estão na lista de desvios).

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

A ordem de ignição precisa ser válida para o virabrequim. Ela é verificada por `build(preset).valid` (`src/engines/ronco/geometria.ts`).

**Avião:** acrescente uma linha em `src/engines/turbina/presets.ts` usando as bases `FAN`, `GTF`, `JET`, `MIL`, `TP` ou `PT6` e o auxiliar `plane(...)`. O significado de cada campo está comentado no topo do arquivo.

**Ronco e Turbina têm a paridade no caminho.** `npm run paridade:ronco` e `paridade:turbina` comparam a lista de presets com a do legado (68 carros e motos, 34 aviões), campo a campo e na mesma ordem. Corrigir um campo de um preset que já existe pede uma linha em `CORRECOES_RONCO` ou `CORRECOES_TURBINA` (`tools/legado.ts`), com o motivo. Um preset novo (um `id` que não existe no legado) fica fora da paridade: ela avisa quais são e segue. Rode `npm run lenta:ronco <id>` no carro novo (partida a 20 °C e a −5 °C, lenta, corte de giro) e `npm run auditoria:fichas` para conferir o câmbio. A família **Aviação** do Ronco (`PRESETS_AVIACAO`, no mesmo arquivo, com os campos `aviation`, `helice` ou `rotor`, `portadores` e `nivelEscape`) fica fora da paridade, justamente por isso.

**Outras famílias.** Cada uma tem a lista em `src/engines/<família>/presets.ts`, um objeto por veículo, com o tipo e os campos comentados no topo do arquivo:

| Família | Lista | Tipo e padrões | Onde o veículo pode ser ouvido |
|---|---|---|---|
| Diesel | `PRESETS` | `PresetDiesel` (os campos do Ronco mais os do diesel), `PADRAO_DIESEL` | `portadores`: `'carro'`, `'gerador'`, `'locomotiva'`, `'nenhum'` (bancada) |
| Radial | `PRESETS_RADIAL` | `PresetRadial`, `PADRAO_RADIAL` | `portadores`: `'helice'`, `'rotor'`, `'carro'`, `'nenhum'` |
| Rotativos | `PRESETS_ROTATIVO` | `PresetRotativo`, `PADRAO_ROTATIVO` (o motor de palhetas tem `tipo: 'palhetas'`) | `portadores`: `'carro'`, `'helice'`, `'rotor'`, `'gerador'`, `'ferramenta'`, `'nenhum'` |
| Vapor | `PRESETS_VAPOR` | `PresetVapor` (medidas em unidades SI; `pol()`, `psi()` e `mm()` convertem) | `portadores`: `'locomotiva'`, `'gerador'`, `'carro'`, `'trator'`, `'barco'`, `'nenhum'` |
| Elétrico | `PRESETS_ELETRICO` | `PresetEletrico` (definido em `dsp.ts`); o que é estimado vai listado em `aprox` | `portador.tipo`: `'carro'`, `'trem'`, `'drone'`, `'bancada'` |

Depois de acrescentar, rode `npm run teste:<família>` e `npm run lenta:<família>`: a lenta e a partida percorrem todos os presets; as medidas de potência e de bandas usam listas de ids escritas no teste, então um preset novo só entra nelas se for acrescentado lá.

**Preset de passagem:** uma linha em `PRESETS_PASSAGEM` (`src/pages/passagem/presets.ts`, tipo `PresetPassagem`): portador, família e preset do motor, ambiente, velocidade, distância lateral, altitude e o comando (pedal, marcha, notch, degrau de carga, comando do vapor). A combinação motor × portador tem de estar em `COMPAT` e em `USO_REAL` (`src/carriers/compat.ts`), e o preset do motor tem de listar o portador.
