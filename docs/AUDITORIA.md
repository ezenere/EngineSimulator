# Auditoria de correção e completude

Feita de 18 a 22/11/2026 sobre a branch `reestruturacao` (commit `1a2a73c`), depois que as sete famílias de motor, a camada de cena e a página Passagem ficaram prontas. Cada pedaço tinha sido validado por quem o fez; ninguém tinha olhado o conjunto. O pedido do dono: achar **o que está incorreto e o que está incompleto**, e consertar o que for objetivo. O som das famílias não foi afinado aqui: os defeitos de som estão listados, com a medida que os prova, para a etapa seguinte.

Como ler:

- Cada achado tem um número (`G-03`, `F-RON-12`, `T-DSL-04`…), uma **severidade** e um **estado**.
- Severidade: **erro** (está errado), **incompleto** (falta), **dívida** (funciona, mas custa caro manter ou engana), **sugestão**.
- Estado: **corrigido neste trabalho** (com o commit), **para a etapa de som**, **para o dono decidir**, **para a pessoa da interface** (o que mora em `src/ui/` e `src/pages/`, que esta auditoria não podia editar).
- A evidência é um arquivo e linha, um comando ou um número medido. As linhas citadas são as do commit `1a2a73c`, salvo quando o texto diz outra coisa.
- Onde um achado foi resolvido depois de escrito, há uma linha "Atualização (integração)".

Sete frentes foram auditadas: fichas dos presets, compatibilidade motor × portador e Passagem, testes, código morto e duplicação, robustez do áudio, coerência de volume e documentação. As frentes foram divididas entre auditores; os números de cada seção foram medidos por quem a escreveu. Os roteiros de apoio que as seções citam em `scratchpad/…` ficavam numa pasta temporária que não existe mais; tudo o que importa foi refeito com as ferramentas que entraram no repositório (lista no fim deste resumo).

Neste documento: o **resumo** (contagem, os 15 mais importantes, o que foi corrigido, as **pendências por prioridade** com arquivo e o que fazer, o que o dono decide, os portões e as ferramentas) e depois os **achados por área**: geral (`G`), fichas (`F`), compatibilidade e Passagem (`C`, `P`), testes (`T`), código (`K`), robustez e volume (`R`, `V`) e documentação (`D`).

## Resumo

### Quantos achados

| Área | Prefixo | erro | incompleto | dívida | sugestão | total |
|---|---|---|---|---|---|---|
| Geral: repositório, legado, portões | `G` | 6 | 4 | 3 | 0 | 13 |
| Fichas dos presets | `F` | 71 | 4 | 9 | 20 | 104 |
| Compatibilidade e Passagem | `C`, `P` | 11 | 3 | 11 | 1 | 26 |
| Testes que mentem | `T` | 32 | 7 | 29 | 6 | 74 |
| Código morto, duplicação, tipos | `K` | 5 | 4 | 24 | 4 | 37 |
| Robustez e volume | `R`, `V` | 2 | 0 | 8 | 2 | 12 |
| Documentação | `D` | 12 | 10 | 7 | 1 | 30 |
| **Total** | | **139** | **32** | **91** | **34** | **296** |

Das fichas, 45 achados foram corrigidos; os outros ficam para a etapa de som (mudam o timbre) ou para o dono (valores marcados "≈", aproximações declaradas, correções que exigem mexer num alvo de teste).

### Os 15 mais importantes

1. **Teste verde não quer dizer som certo.** As seis suítes aceitam 167 medidas fora do alvo como "desvio documentado" (Diesel 66, Radial 31, Rotativos 28, Vapor 28, Cena 12, Elétrico 2). Classificadas uma a uma, 71 são defeito de som de verdade que virou texto (Diesel 28, Rotativos 16, Radial 15, Vapor 10, Cena 2). E o desvio é só um nome: a medida pode piorar à vontade e continua verde (T-DSL-01, T-RAD-01, T-CEN-04, T-VAP-03). No Vapor, as 28 falhas viraram 28 desvios num commit só, sem mudança no DSP (T-VAP-02).
2. **O "0 falhas" só vale para a semente de fábrica.** Com outras três sementes do gerador de ruído: a Cena dá 6 a 7 falhas; no Radial e nos Rotativos 19 medidas "ok" viram falha; no Vapor, 11; no Elétrico, 8; no Diesel, 3 (T-CEN-03, T-RAD-02, T-VAP-01, T-ELE-03, T-DSL-02). Qualquer retoque de som muda a sequência aleatória e pode acender falhas que nada têm a ver com o retoque.
3. **Quase nenhuma comparação com gravação passa, e algumas saíram do teste.** No Radial e nos Rotativos, 1 de 15 comparações de bandas passa (a lenta do P-47, por 0,3 dB). No Diesel, 34 medidas do alvo do projeto foram retiradas do teste quando o som mudou (commit `3c0718a`; refeitas hoje, 20 falham) e o alvo "real3" das locomotivas contradiz o Apêndice A do `DIESEL.md` (T-DSL-03, T-DSL-04). No Elétrico, o grupo `gravacoes` não abre gravação nenhuma e cerca de 30 das 94 medidas comparam o sintetizador com as próprias fórmulas (T-ELE-01, T-ELE-02).
4. **Medidas que não medem.** Rotativos: as duas de meia-ordem devolvem −∞ (nenhum ponto do espectro cai na janela), uma tem `ok` fixo e quatro passam fora do alvo que mostram (T-ROT-01 a 03). Elétrico: o grave (20–150 Hz) nunca entra no critério e o vetor de alvos do Taurus e da CPTM está deslocado uma casa; medido, faltam de 7 a 9 dB de grave (T-ELE-05). Vapor: uma medida com `ok` fixo (T-VAP-04). Cena: duas linhas com `ok` fixo (corrigidas) e tautologias (T-CEN-01, T-CEN-02).
5. **As ferramentas de revisão de som do dono mediam o DSP antigo.** `tools/analise-som/` e o `tools/render.ts` carregavam `src/dsp.js`: uma mudança no DSP em TypeScript não apareceria em nenhuma medida. Corrigido, com a saída conferida byte a byte (G-05, G-06).
6. **O que a página toca não é o que o teste mede.** `radial.html` é 4 a 11 dB mais escura acima de 400 Hz do que o caminho validado pela Cena (T-RAD-05); nenhuma das 105 medidas da Cena passa pelo `CenaDSP` que a página usa (T-CEN-06, coberto agora pelo `teste:passagem`); o gerador e a locomotiva da página Diesel não têm ventilador, alternador nem sopradores, que existem no portador da Cena.
7. **Na Passagem a hélice dos aviões a pistão toca 10 a 25 dB alto demais.** O Cessna 172 dá 96,7 dB(A) a 100 m e empata com o ATR 72; a amplitude só depende do Mach da ponta e do diâmetro (P-03). O Corsair satura; o caça supersônico fica 21 dB abaixo do esperado e nenhum caça acende a pós-combustão (P-04, P-05).
8. **No modo de testes da Passagem os padrões do portador não acompanham o motor escolhido.** Carro a 108 km/h em 3ª: 13 motores acima do corte (um Scania a 11 773 rpm); trem a 350 km/h com metrô de 90; quatro dos seis helicópteros com motor não seguravam o rotor (C-03, C-04; o Bell 47 foi corrigido na ficha).
9. **O AVAS estoura.** Um carro elétrico que sai de parado para acima do limite de uma vez solta 101,6 dB(A) por 2 s (`src/engines/eletrico/avas.ts:59` não limita a lei de nível à velocidade-limite; P-02). Três metrôs parados saem em silêncio digital.
10. **Fichas com o motor errado, que mudam o som** (não corrigidas, listadas com o valor proposto): Huracán, R8, M5 E60 e F2004 estão como V10 de ignição uniforme a 72° e são a 90° com ignição irregular; Panigale V4 com o virabrequim e o corte errados; Camaro com a ordem de ignição do small-block antigo; C-130J e HondaJet com as rotações de outro motor; Cat C-15 com a cilindrada do ACERT; Ro 80 com admissão lateral (é periférica); Verner 5S com a ficha de outro motor (com a certa, não pega); rotor do S-55 na rotação-limite (seção "Fichas do Ronco → Para a etapa de som"; F-TUR-04, F-TUR-05, F-DSL-06, F-ROT-07, F-RAD-02, F-RAD-04).
11. **Fichas acertadas para o teste passar, e um teste nascido de um erro de ficha.** A potência do Metropolis foi baixada para 150 kW para o 0–80 caber no alvo (F-ELE-03, T-ELE-07); a 5ª do RX-7 FD foi trocada por uma relação que nenhum FD teve (F-ROT-06); o Sherman anda 3,5 vezes mais rápido que o real porque falta o diferencial, e o critério "0–30 km/h em 2ª" do projeto nasceu disso (F-RAD-03).
12. **Corrigidos 45 erros de ficha.** Câmbio de outro carro em sete fichas do Ronco (GT500, Corvette Z06, EK9, MX-5, M5, Century, 412 T2); Bell 47G com o motor de uma versão e o rotor e o peso de outra; Rotec sem o redutor, com a ponta da pá a Mach 0,97; tênder com rodas contadas como eixos (+3 dB de rolamento em sete locomotivas); Vectron com a roda do Taurus; Phenom com o empuxo dos dois motores num campo por motor; nomes e rótulos (CPTM 9000 é Alstom; "Mercedes-AMG C63" com o M156; "LS3" com os números do LT1).
13. **A paridade dependia do nome `master` e impedia acrescentar um carro; o `.gitignore` não ignorava as gravações.** Corrigidos, e o legado saiu da árvore (G-01 a G-04, G-10).
14. **Não havia como rodar tudo, e o Ronco não tinha teste de lenta.** Entraram `npm run verificar`, `verificar:rapido`, `lenta:ronco`, `teste:passagem`, `auditoria:fichas` e `auditoria:som`. Fica para decidir: as medidas de CPU moram dentro dos testes de som e falham com a máquina ocupada; `governador:diesel` sozinho sai com código 1; o `teste:diesel` leva de 9 a 20 min e a `paridade:turbina` de 13 a 23 (G-07, G-08, G-11, G-12, T-DSL-11).
15. **Duplicação que já divergiu.** As quatro páginas a pistão são cópias (915 linhas de `controle.ts`, 30 membros divergentes; o Elétrico sem o tratador de `blur`, então segurar `R` e trocar de janela deixa a regeneração presa); o helicóptero existe duas vezes com ganhos de governador diferentes; três leitores de WAV, dois lendo errado (corrigido); seis tabelas de bandas, a do Elétrico deslocada uma casa; o carro da Passagem não tem pneus nem vento; carregar um preset com motor trava a thread principal por 2 a 8 s (K-02 a K-06, K-12, K-15, K-16, P-07).

Da medição de robustez e de volume (seção própria, `R` e `V`): nenhum controle deslizante do painel, no mínimo ou no máximo, produz NaN nem trava o áudio (760 casos nas sete famílias); a 44,1 e a 96 kHz tudo toca, com até 2,8 dB de diferença de nível num preset; todos os DSPs alocam memória dentro do laço de áudio; e em potência de decolagem o limitador de saída satura em 10 dos 17 radiais e em 6 dos 10 aviões do Ronco (R-02).

### O que foi corrigido neste trabalho

| O quê | Commits |
|---|---|
| `.gitignore`: `.claude` e `referencias/` em linhas separadas | `5c3179c` |
| Paridades com o legado lido de um commit fixo; correções de ficha declaradas (`tools/legado.ts`); preset novo não quebra a paridade | `745e183`, `381c356` |
| Legado removido (10 arquivos, 5 420 linhas); `tools/analise-som/` e `tools/render.ts` no DSP em TypeScript | `73c2590` |
| Fichas do Ronco e da Aviação (15 carros, Bell 47G, R44, 300C, Cessna 172) | `1fd9230`, `f641664` |
| Fichas da Turbina e do Radial (rótulos, Phenom, Rotec com redutor, M-14PF) | `6f2b6a8`, `2d50413`, `dc6e435` |
| Fichas do Diesel e dos Rotativos (câmbios, rótulos, torque, taxa, rotor do Camcopter) | `51906a5`, `6892ac0`, `c9866c3`, `be931b5` |
| Fichas do Vapor e do Elétrico (eixos do tênder, massas, nomes, roda do Vectron) | `e71b626`, `33cbefe`, `1326347`, `7d83505` |
| Compatibilidade: bancada para todas as famílias; barco só a vapor | `35d6f02`, `b6c47a8` |
| Ferramentas novas: `auditoria:fichas`, `teste:passagem`, `lenta:ronco`, `auditoria:som`, `verificar`, `servir-dist` | `16aa079`, `9dc3172`, `b6c47a8` |
| Leitor de WAV único; `gravacoes:vapor` procura em `referencias/`; duas medidas da Cena com `ok` fixo; `lenta:vapor` com a massa da locomotiva | `b6c47a8`, `dedb829`, `875e705` |
| `VaporDSP`: reconfigurar com outro preset não lança mais exceção (uma linha, R-01) | `875e705` |
| README, TECNICO, PLANO e CREDITOS no estado atual; nota "o que mudou na implementação" no topo dos seis documentos de projeto | `e55e6f6`, `3900b7c`, `3ca79ad`, `ae1d386`, `e20658e`, `381c356` |
| O comum das quatro páginas a pistão em `src/pages/comum/` (F1, K-02 a K-05); o `fresh` de um preset não se perde mais com um controle mexido nos 60 ms seguintes; os esquecimentos entre as páginas (escuta do Radial e dos Rotativos, freio, manete na aviação dos Rotativos, pedal do Diesel) | `f089c79`, `8844868` |

### Pendências, por prioridade (prontas para executar)

Cada linha diz onde mexer e o que fazer; o achado citado traz a evidência e os números. A ordem é a de execução: primeiro o que torna os testes confiáveis, depois o som na ordem que o dono pediu no `PLANO.md` (Diesel, Rotativos, o resto), depois fichas, interface, código e documentação. "Dono" na última coluna quer dizer que falta uma decisão dele antes (lista mais abaixo).

**A. Testes: fazer antes de qualquer retoque de som**

| # | Onde | O que fazer | Achado | Falta |
|---|---|---|---|---|
| A1 | `tools/diesel-valida.ts` (lista `DESVIOS`, 21–56 e 413–415), `tools/radial-valida.ts:59`, `tools/rotativo-valida.ts:59`, `tools/vapor-valida.ts` (`DESVIOS`), `tools/cena/medidas.ts`, `tools/eletrico/valida.ts` | ~~Trocar "nome → texto" por um retrato do valor aceito: gravar `{ nome: medido }` por família (`tools/<família>-desvios.json`); falha se o medido de um desvio sair da folga (±1 dB, ±5 %) sem `--atualizar`; falha de "desvio órfão" se a medida voltar a passar. No Diesel, trocar as regex largas (`/real3 · gerador/` casa 16 medidas) por nomes exatos~~ Feito: Radial, Rotativos, Vapor, Elétrico e Cena em 22/11/2026; Diesel em 23/11/2026 (`3371887` e `a6803f8`: `tools/diesel-desvios.json`, nomes exatos, o valor aceito, a folga e o motivo de cada um; ver TECNICO, Diesel, "Ferramentas e portões" e "Desvios conhecidos") | T-DSL-01, T-RAD-01, T-VAP-03, T-CEN-04 | Dono (1) |
| A2 | os mesmos `*-valida.ts`; `tools/radial-valida.ts:398`, `tools/rotativo-valida.ts:427` (potência com 2 s por ponto) | ~~Medidas de contagem, transiente e CV pela mediana de 3 sementes; dar margem às que passam por menos de 5 % da tolerância~~ Feito nas mesmas famílias; Diesel em `3371887` e `a6803f8` (pressões, cofre, classes e tons do real3, envoltória, enchimento do turbo, fumaça, Jake, arrancada, câmbio, governadores e a lenta de fora dos pesados pela mediana de 3 sementes, uma por processo; as que passam ou falham por menos de 5 % da tolerância, ou mudam de estado com a semente, à beira no retrato; 0 falhas com as bases 0, 1000 e 2000) | T-RAD-02, T-DSL-02, T-DSL-09, T-VAP-01, T-ELE-03, T-CEN-03, T-CEN-08 | Dono (2) |
| A3 | `tools/rotativo-valida.ts` | Meia-ordem: `linha()` devolver `NaN` (falha) sem ponto na janela e medir a banda lateral a ±rpm/120 em volta de 2·ign e 3·ign; tirar o `ok` fixo; rótulo do alvo igual ao critério (quatro medidas viram desvio declarado) | T-ROT-01, T-ROT-02, T-ROT-03 | |
| A4 | `tools/eletrico/valida.ts` | Corrigir o vetor de alvos do Taurus e da CPTM (deslocado uma casa) e conferir as cinco bandas, inclusive 20–150 Hz; medir AVAS e pneus com asfalto (o alvo é nessa condição); renomear o grupo `gravacoes` para o que ele é (alvos da tabela 3.7) | T-ELE-02, T-ELE-04, T-ELE-05 | |
| A5 | `tools/vapor-valida.ts:141`; `tools/vapor-valida.ts:33` (texto do desvio cita "tênder de 8 eixos") | Tirar o `ok` fixo (medir o ângulo pelo `tap`); rótulos iguais aos critérios; atualizar o texto do desvio | T-VAP-04, T-VAP-06 | |
| A6 | `tools/diesel-valida.ts` | ~~Repor como desvios declarados as 34 medidas do alvo do projeto retiradas em `3c0718a`~~ Feito em `3371887` e `a6803f8` (grupo `projeto`: as 34 voltam; 22 não passam e são desvio declarado). Fica para o dono decidir a referência das locomotivas (o "real3" contradiz o Apêndice A do `DIESEL.md`): as gravações do acervo que dão cada alvo, e o que medir nelas, estão no TECNICO, Diesel, "Desvios conhecidos" | T-DSL-03, T-DSL-04, D-19 | Dono (4) |
| A7 | `tools/diesel-governador.ts`, `tools/diesel-valida.ts` | ~~`npm run governador:diesel` sozinho sai com código 1: consultar os mesmos desvios do `teste:diesel`; o teste de NaN ler todas as amostras e rodar em paralelo (é ele que faz o `teste:diesel` levar 9 a 20 min)~~ Feito em `3371887` e `a6803f8` (`governador:diesel` consulta o retrato e sai com 0; NaN em todas as amostras dos dois canais, um processo por preset; o `teste:diesel` foi de 12 min 22 s para 7 min 34 s, com a máquina mais ocupada) | T-DSL-11, T-DSL-12 | |
| A8 | `tools/cena/cpu.ts`, `tools/radial-valida.ts`, `tools/rotativo-valida.ts`, `tools/vapor-valida.ts`, `tools/eletrico/valida.ts`, `tools/eletrico/gc.ts` | ~~Tirar CPU e coleta de lixo dos `teste:*` para um `cpu:*` (ou mediana de 3) e medir com `process.cpuUsage()`~~ Feito nas famílias da linha em 22/11/2026; Diesel em `3371887` e `edc52fe` (`npm run cpu:diesel`, no `verificar -- --cpu`: EMD e GE em notch 8 e Duramax em plena carga passam do portão de 40 % do DIESEL.md e estão no retrato com teto sobre a razão ao Chiron do Ronco, a referência dele). Em 23/11/2026 o laço do `DieselDSP` ficou sem funções criadas a cada amostra (`valvulas()` criava três por cilindro; no Node com o tsx cada uma passava por um `Object.defineProperty` do nome, dois terços do tempo), com a saída idêntica amostra a amostra nos 125 cenários de `tools/diesel-identidade.ts`: a razão ao Chiron caiu de 3,5×, 3,4× e 2,0× para 1,6×, 1,6× e 1,0× (EMD, GE, Duramax; o tempo real, de 125, 120 e 61 % para 60, 55 e 37 % com a máquina ocupada, mediana de três rodadas alternadas). EMD e GE seguem acima do portão em Node, agora pelo JIT da própria ferramenta (o V16, vários presets e as sondas no mesmo processo deixam o laço comum megamórfico; a EMD sozinha num processo fica a ~1,2× e 17–20 %, como no worklet da página); a Duramax ficou à beira (`beira` no retrato). No pacote do navegador (sem os nomes) o ganho é ~10 % na EMD e nenhum na GE e na Duramax, e a alocação no laço cai à metade (EMD 336 → 157 MB/s); ver `docs/TECNICO.md` → Diesel → CPU do laço de amostra | G-11, T-CEN-05, T-RAD-03, T-VAP-12, T-ELE-10 | Dono (3) |
| A9 | `tools/radial-valida.ts`, `tools/radial-cena.ts` | Medir as bandas também pelo `RadialDSP` da página (hoje só pela Cena) e os estalos nos motores pequenos, no Sherman e na Aviação do Ronco | T-RAD-05, T-RAD-06 | |

**B. Som, por família (ordem do dono)**

| # | Onde | O que fazer | Achado |
|---|---|---|---|
| B1 | `src/engines/diesel/dsp.ts` (ruído da turbina, fundo mecânico) | Locomotivas em N8: prender o agudo ao pulso (contraste de 2–6 kHz de 6,8 dB para 7,6–9,9). Lenta de perto: som mecânico contínuo preso ao giro entre as batidas (a queda de 1–4 kHz é de 32 dB; gravações 15–16,5). Grave de lenta dos caminhões e picapes | Diesel, itens 1, 2 e 5 da lista de som |
| B2 | `src/pages/diesel/controle.ts`, `src/engines/diesel/dsp.ts`; fontes prontas em `src/carriers/gerador.ts` e `src/carriers/locomotiva.ts` | A página Diesel toca o gerador e a locomotiva sem ventilador, alternador, sopradores e compressor: levar as fontes do portador para a página (ou a página montar o portador da Cena) | Diesel, itens 3 e 4 |
| B3 | `src/engines/rotativo/dsp.ts`, `src/engines/rotativo/escape.ts` | 787B a 7 700 rpm: 10 a 17 dB faltando de 400 Hz a 6 kHz. Lenta: trocar ruído de pós-queima por conteúdo do pulso da janela. Ø de saída no mínimo: limitar o jato (é o "papel rasgando" do `PLANO.md`, no motor-base) | Rotativos, itens 1 a 4; T-ROT-04, T-ROT-05 |
| B4 | `src/engines/radial/config.ts` (calibração), `src/engines/radial/dsp.ts` | Decolagem satura o limitador de saída em 10 dos 17 presets (R-02); estalos na lenta dos estaques curtos (falta o modelo de boca de estaque); decolagem do Corsair e do T-6 sem meio nem agudo | R-02; Radial, itens 1 a 3 |
| B5 | `src/engines/vapor/dsp.ts`, `src/engines/vapor/rede.ts` | Vale entre chuffs (tiragem contínua no lugar de chiado preso ao evento); decaimento do chuff na arrancada; King com 8 batidas; patinagem | Vapor, itens 1 a 4 |
| B6 | `src/engines/eletrico/avas.ts:59`; `src/engines/eletrico/mecanica.ts`, `linhas.ts` | AVAS: `Math.min(kmh, this.limite())` nas três leis de nível (estouro de 101,6 dB(A)). Grave do Taurus e do metrô (7 a 9 dB). Metrôs parados em silêncio digital: auxiliares | P-02, T-ELE-05, T-ELE-14 |
| B7 | `src/carriers/helice.ts:139` | A amplitude da hélice depende só do Mach da ponta e do diâmetro: pôr a potência (ou a carga do disco) na conta; hoje o Cessna 172 toca como o ATR 72 | P-03 |
| B8 | `src/engines/turbina/motor.ts` (pedal → manete), `src/pages/passagem/presets.ts` | Caça na Passagem: o pedal vai até 1 e a pós-combustão pede 1,3; o preset supersônico fica 21 dB abaixo | P-05 |
| B9 | `src/carriers/rotor.ts` (ganhos do governador, `ROTOR_R44.massa` 1 090 → 1 134 kg), fichas `s55`, `ae50r`, `s300` | Helicópteros que não seguram o rotor com o coletivo em 0,75; unificar com o governador de `src/engines/ronco/aviacao.ts:94` (ganhos diferentes para o mesmo R44) | C-04, K-06, F-AVI-05 |
| B10 | `src/carriers/locomotiva.ts`, `src/engines/diesel/motor.ts:117–121`; `src/carriers/gerador.ts` | Locomotiva em N8 fica 3 % abaixo da rotação-alvo no portador (as tabelas de notch estão em duplicata); o Aveling "na polia" entra em ciclo-limite | P-08, F-DSL-14, C-05 |
| B11 | `src/carriers/helice.ts`, `src/engines/radial/motor.ts`, `src/engines/vapor/motor.ts` (níveis `lw*`) | Presets que estouram o fundo de escala da Passagem (Corsair +8,6 dBFS, Big Boy +2,3, P-47 +1,0) e os fora da faixa (787B 7 dB abaixo, ATR 5 acima) | P-04, P-05 |

**C. Fichas que mudam o som (valor pronto; rodar os testes da família depois)**

No Ronco e na Turbina, cada campo alterado precisa de uma linha em `CORRECOES_RONCO`/`CORRECOES_TURBINA` (`tools/legado.ts`), senão a paridade falha.

| # | Onde | O que fazer | Achado |
|---|---|---|---|
| C1 | `src/engines/ronco/presets.ts`: `huracan`, `r8`, `m5e60` | `crank: 'odd90', bankAngle: 90, order: '1-8-7-4-3-10-9-6-5-2'` (V10 a 90° com moente comum) | F-RON-16, F-RON-17 |
| C2 | idem: `v10f1` | `bankAngle: 90`; `crank: 'odd90'` só se confirmado o moente comum | F-RON-18 |
| C3 | idem: `panigale`, `cbr`, `mt07` | Panigale: `crank: '360', order: '1-2-3-4'` e corte a 14 500; CBR: `redline: 13000`; MT-07: `redline: 10500` | F-RON-21 a 23 |
| C4 | idem: `muscle` | `order: '1-8-7-2-6-5-4-3'`; é a referência de `tools/cena/referencias/legado.json`: conferir o `teste:cena` depois | F-RON-19 |
| C5 | `src/engines/turbina/presets.ts`: `c130`, `hondajet`, `bizjet` | C-130J: rotações do AE 2100 (15 404 rpm no gerador de gás); HondaJet: N1 19 055, N2 48 777; Phenom: comprimento | F-TUR-04 a 06 |
| C6 | `src/engines/diesel/presets.ts`: `catc15` | 14,6 L e curso de 165 mm (duas medidas mudam de estado: atualizar os desvios) | F-DSL-06 |
| C7 | `src/engines/rotativo/presets.ts`: `ro80`; `src/engines/rotativo/` (janelas) | Admissão periférica de rua (falta a opção; a `'periferica'` de hoje é a de corrida) | F-ROT-07 |
| C8 | `src/engines/radial/presets.ts`: `verner5`, `s55` | Verner 5S: 3,39 L, 83 hp a 2 300 rpm (com a cilindrada certa a partida falha: investigar em `src/engines/radial/dsp.ts`); S-55: `Nr: 199` | F-RAD-02, F-RAD-04 |
| C9 | `src/engines/vapor/presets.ts`: `k4s`, `a4`, `up844`, `bigboy`, `y6b` (`geometria.comprimento`, tênder); apitos; `bombaAr` das inglesas | Composições 17 a 41 % compridas demais (refazer as posições das fontes); apito de uma nota na Y6b, de três no Big Boy e no K4s; sem bomba Westinghouse na A4 | F-VAP-04 a 08 |
| C10 | `src/engines/eletrico/presets.ts`: `leaf`, `cptm9500`, `cptm9000`, `frotaa` | Leaf: dentes 17:32 e 17:74; CPTM: 270 e 275 kW por motor; Frota A: 24 motores de 110 kW | F-ELE-07, F-ELE-08, F-ELE-09 |
| C11 | `src/carriers/locomotiva.ts:21`; `src/carriers/helice.ts:61` | Buzina K5LA: 440 → 415 Hz; hélice "madeira" (Rotec) ainda com 1,75 m a 3 600 rpm sem redutor | F-DSL-12, F-RAD-01 |

**D. Três correções que mexem em alvo de teste ou em arquivo da interface**

| # | Onde | O que fazer | Achado |
|---|---|---|---|
| D1 | `src/engines/radial/presets.ts` (`r975`), `src/pages/passagem/presets.ts:154`, critério do passo 9 do `RADIAL.md` | `finalDrive: 10.03` (2,84 × 3,53) e `marcha: 3` no preset "Sherman passando" | F-RAD-03 |
| D2 | `src/engines/rotativo/presets.ts` (`rx7fd`), `tools/rotativo-valida.ts:434` | `ratios: [3.483, 2.015, 1.391, 1.0, 0.762], finalDrive: 4.3` e o alvo em 2 750 ± 100 rpm | F-ROT-06 |
| D3 | `src/engines/eletrico/presets.ts` (`metropolis`), alvo de 0–80 em `tools/eletrico/valida.ts` | 24 motores de 180 kW; o alvo de 36 s é conta do plano, não medida | F-ELE-03, T-ELE-07 |

**E. Interface (`src/pages/`, `src/ui/`, roteiros de navegador)**

| # | Onde | O que fazer | Achado |
|---|---|---|---|
| E1 | `src/pages/passagem/controle.ts:243–288` | Ao trocar portador, família ou preset no modo de testes, ajustar velocidade, marcha e coletivo ao motor (hoje 13 motores passam do corte e 9 trens passam da máxima da ficha) | C-03 |
| E2 | `src/pages/passagem/controle.ts` (montagem), `src/engines/*/motor.ts` (sondas) | Tirar as sondas de calibração da thread principal: 2 a 8 s de travamento ao carregar um preset com motor | P-07 |
| E3 | `src/pages/passagem/presets.ts` | Legendas: "a 7,5 m" com `lateral: 6`; "O-540" no R44 (é IO-540); "a 6 m" com `lateral: 5.1`; `trembala-tunel` a 350 km/h com o N700 de 300 | P-10, C-10, C-11 |
| E4 | `src/pages/eletrico/` (teclado) | ~~Falta o tratador de `blur`: segurar `R` e trocar de janela deixa a regeneração presa~~ Feito em `2e0d811` (`blur` em `src/pages/eletrico/controle.ts`, ligado em `PaginaEletrico.tsx`) | K-05 |
| E5 | `tools/*-navegador.mjs` | Esperar pela condição em vez de dormir 200–250 ms; `ronco` e `turbina` servirem o `dist/` sozinhos; `CHROMIUM=` no da Turbina; o da Passagem cobre 5 dos 29 presets | G-09, G-13, P-11, K-37 |
| E6 | `src/pages/comum/Casca.tsx`, `ProvaDoWorklet.tsx`, `casca.css`, `src/worklet/processador-tom.ts` | Remover (nada os importa); `tools/render.ts tom` usa `src/worklet/tom.ts` | K-29, D-07 |

**F. Código e documentação**

| # | Onde | O que fazer | Achado |
|---|---|---|---|
| F1 | `src/pages/{ronco,diesel,radial,rotativo}/controle.ts`, `Painel.tsx`, `mostradores.ts`, `teclado.ts` | ~~Extrair o comum (915 linhas de `controle.ts` copiadas, 30 membros já divergentes)~~ Feito em 22/11/2026 (`f089c79`): `src/pages/comum/`, ver TECNICO, "As quatro páginas a pistão" | K-02 a K-05 |
| F2 | `tools/*-bandas.ts`, `tools/*-comum.ts`, `tools/eletrico/comum.ts`, `tools/cena/analise.ts` | Uma FFT, um Welch e tabelas de bandas com nome (`tools/analise.ts`): hoje são 8 FFTs, 5 Welch e 6 tabelas, a do Elétrico deslocada uma casa | K-16, K-17 |
| F3 | `src/carriers/carro.ts:9` | Pneus e vento no `CarroLegado` (o Camaro passa só com motor); uma `FontePneu` só (hoje há duas, em `carro-direto.ts:19` e `carro-eletrico.ts:28`) | K-12, C-06 |
| F4 | `tsconfig.node.json` | `include`: `"src/engines/**/*.ts"` no lugar das entradas por família | K-33 |
| F5 | `src/engines/diesel/dsp.ts:20, 91, 104, 925`; `src/scene/supersonico.ts:10–12` | Comentários `TODO` obsoletos; o comentário diz ω_c 3,7 rad/s e o código usa 2,7 | K-08, K-19 |
| F6 | `docs/CREDITOS.md`; `docs/REVISAO-DE-SOM.md:78–79`; `docs/TECNICO.md` (tabela "Não pode piorar"); `docs/DIESEL.md` 6.2, `docs/ROTATIVO.md` 6.2, `docs/ELETRICO.md` 5, `docs/VAPOR.md:201, 499` | Autor e licença de cada gravação; exemplo de `git show HEAD:src/dsp.js` (usar `DSP=legado`); números de antes do filtro de ar; fichas antigas nos documentos de projeto | D-11, D-29, D-30 |

### Para a etapa de som, por família (resumo)

A tabela B acima diz onde mexer; aqui está o que se ouve. A lista completa de cada família, com preset, condição e a medida que prova, está no fim da seção de testes correspondente ("Para a etapa de som (…), por prioridade"). Vale para todas o que o `PLANO.md` já diz: o que falta é conteúdo tonal e impulsivo preso ao giro; o que sobra é ruído largo contínuo.

**Antes de mexer em qualquer família:** decidir o que fazer com os desvios sem teto e com a dependência de semente (itens 1 e 2 acima), senão o retoque não tem como ser medido.

- **Diesel** (14 itens). (1) Locomotivas em notch 8 soam a chiado contínuo: o agudo não acompanha as explosões (contraste de 6,8 dB em 2–6 kHz; ruído parado dá 6,1 e as gravações 7,6 a 9,9). (2) Lenta de perto é estalo solto sobre silêncio: entre batidas o 1–4 kHz cai 32 dB (gravações: 15 a 16,5); falta o som mecânico contínuo preso ao giro. (3) EMD em lenta escura e ribombante (centroide 235 Hz, alvo 700). (4) O gerador soa como escape de caminhão: na página faltam ventilador e alternador. (5) Grave de lenta exagerado nos caminhões e picapes, que come a margem de volume. Fichas: Cat C-15 com 15,2 L (é 14,6; F-DSL-06) e a buzina K5LA com uma nota errada (440 Hz onde é 415; F-DSL-12).
- **Rotativos** (9 itens). (1) 787B a 7 700 rpm sem o grito: 10 a 17 dB faltando de 400 Hz a 6 kHz. (2) Todo o agudo da lenta é ruído de pós-queima (RX-7: 87 % de 1–2,5 kHz e 100 % de 2,5–6 kHz), e ainda faltam 6 dB: falta o pulso da janela, não mais ruído. (3) Com o Ø de saída no mínimo continua "só ar". (4) Lenta do 787B brilhante, sem grave e só 6 dB abaixo da carga. Antes: consertar as medidas de meia-ordem (T-ROT-01). Ficha: Ro 80 com admissão periférica (F-ROT-07).
- **Radial** (9 itens). (1) Estalos na lenta dos motores de estaques curtos e do Sherman (Rotec 19 picos/s com curtose 97; gravações 0 a 6/s). (2) Decolagem do Corsair e do T-6 grave demais, sem meio nem agudo. (3) A página soa diferente da Passagem (4 a 11 dB mais escura). (4) Em decolagem, 10 dos 17 presets saturam o limitador de saída (R-02). Fichas: Verner 5S (F-RAD-02), rotor do S-55 (F-RAD-04), Sherman (F-RAD-03).
- **Vapor** (12 itens). (1) O vale entre os chuffs é um sopro grave e contínuo (centroide do vale 0,77 do pico; gravações 1,05–1,35). (2) Chuff seco na arrancada (decaimento de 45 ms contra 89). (3) King com 8 batidas por volta. (4) Patinagem ao contrário: o chuff do surto sai 6 dB mais forte. Fichas: composições 17 a 41 % compridas demais (F-VAP-04), apitos trocados (F-VAP-05 a 07).
- **Elétrico** (9 itens). (1) Falta grave no Taurus e no metrô (7 a 9 dB em 20–150 Hz), e nenhum teste olha essas bandas. (2) AVAS e pneus medidos sem chão; no asfalto ficam 2 a 3 dB altos; e o estouro do AVAS (P-02). (3) Metrôs parados mudos. (4) "Soa a sintetizador" não tem medida: usar o kit `ouvido` (razão harmônico/ruído, planura entre as linhas).
- **Ronco**. Os quatro V10, a Panigale V4, a CBR e a ordem do Camaro (lista com o valor proposto em "Fichas do Ronco → Para a etapa de som"). Na Passagem, o carro não tem pneus nem vento (K-12).
- **Turbina**. Rotações do C-130J e do HondaJet (F-TUR-04, F-TUR-05); o turboélice sai 10 dB alto em nível absoluto (T-CEN-10); os sete turboélices têm a ponta do compressor a Mach 1,9–2,0 (alerta da `auditoria:fichas`); na Passagem o caça não acende a pós-combustão (P-05).
- **Cena e Passagem**. Hélice dos aviões a pistão (P-03); a locomotiva em N8 fica 3 % abaixo da rotação-alvo no portador (P-08); o Aveling "na polia" entra em ciclo-limite (C-05).

### O que o dono precisa decidir

1. **Desvios com teto.** Autorizar a troca das listas `DESVIOS` (nome → texto) por um retrato do valor aceito com folga: piorou além da folga, falha; voltou a passar, avisa. Proposta detalhada em T-DSL-01 e T-RAD-01. Sem isso, a etapa de som não tem portão.
2. **Sementes.** Aceitar um critério estatístico (por exemplo, a mediana de 3 sementes) ou alargar as tolerâncias das medidas que passam por menos de 5 % (T-DSL-09, T-CEN-08).
3. **CPU fora dos testes de som** (G-11) e o que fazer com o `teste:diesel` de 20 min (G-12).
4. **Referência das locomotivas diesel**: o alvo "real3" contradiz o projeto e a fonte se perdeu (T-DSL-03, D-19); repor as 34 medidas retiradas (T-DSL-04)?
5. **Três correções de ficha que mexem em alvo de teste ou em arquivo da interface**: Sherman (`finalDrive: 10.03` e a marcha do preset da Passagem; F-RAD-03); RX-7 FD (caixa de verdade e o alvo de 2 600 rpm; F-ROT-06); Metropolis (potência real e o alvo de 36 s; F-ELE-03).
6. **Valores marcados "≈" e aproximações**: Maria Fumaça (F-VAP-10), apitos da Y6b, do Big Boy e do K4s (F-VAP-05 a 07), bomba de ar nas inglesas (F-VAP-08), Frota A (F-ELE-08), Fórmula E (F-ELE-10), Megola e Monaco-Trossi (F-RAD-06, F-RAD-07), Mistral, XTS-210 e X Mini (F-ROT-08 a 10), potência dos híbridos (F-RON-27), motor industrial em 50 Hz (F-ELE-12).
7. **Níveis absolutos**: o Vapor fica 4 a 6 dB abaixo das referências do projeto (convenção de medida ou `lwChuff`?; item 12 da lista do Vapor); o Tesla a 100 km/h tem o trem de força 29 dB abaixo do total (é para ouvir o motor?).
8. **Código**: unificar as quatro páginas a pistão e os dois helicópteros (K-02 a K-06); convenção de nomes português/inglês nas APIs e de unidades nas fichas (K-34, K-35); remover `Casca.tsx`, `ProvaDoWorklet.tsx` e o worklet `tom` (K-29, D-07); o carro da Passagem sem pneus nem vento (K-12).
9. **Documentação**: autor e licença de cada gravação do Commons no `CREDITOS.md` (D-29); o exemplo de `git show HEAD:src/dsp.js` no `REVISAO-DE-SOM.md` (D-30); a tabela "Não pode piorar" do avião com números antigos (D-11).
10. **Etiqueta do legado**: se a branch for achatada ao mesclar, criar antes `git tag legado 02c185f` (G-02).

### Portões

Rodados com `npm run verificar -- --navegador` em 19/11/2026, depois de mesclada a `reestruturacao` até `38ed1fb` (kit `tools/ouvido/`, `tools/referencias/`): **28 de 28 passos ok em 47 min 5 s**. Depois disso só entraram documentação e a ferramenta `auditoria:som` (que não é portão); `typecheck` e `build` foram refeitos no fim.

| Passo | Resultado | Tempo |
|---|---|---|
| `typecheck` | ok | < 1 s |
| `paridade:acoustics` | 23 verificações, tudo idêntico bit a bit | < 1 s |
| `paridade:ronco` | idêntico ao legado: 68/68 presets campo a campo (com as 17 correções de ficha declaradas), 200 cenários em WAV e JSON | 70 s |
| `paridade:turbina` | idêntico: 34 aviões, 3 cenários do `render.ts` + 7 extras (com 3 correções de ficha declaradas) | 22 min 45 s |
| os oito `navegador:*` (Chromium headless, com o `dist/` servido) | os oito passaram | 4 min 55 s |
| `teste:cena` | 105 medidas: 93 ok, 12 desvios, 0 falhas (linha de base: 92 ok e 1 falha de CPU com a máquina ocupada) | 71 s |
| `teste:passagem` (novo) | 29 presets: 16 ok, 13 com alerta de nível ou CPU, 0 falhas | 93 s |
| `teste:diesel` | ok, 66 desvios (igual à linha de base) | 9 min 22 s |
| `teste:radial` | 141 medidas: 110 ok, 31 desvios, 0 falhas (igual) | 90 s |
| `teste:rotativo` | 133 medidas: 105 ok, 28 desvios, 0 falhas (igual) | 37 s |
| `teste:eletrico` | 94 medidas: 92 ok, 2 desvios, 0 falhas (igual) | 22 s |
| `teste:vapor` | 125 medidas: 97 ok, 28 desvios, 0 falhas (igual) | 22 s |
| `lenta:ronco` (novo) | 136 casos e 68 trocas, 0 falhas | 73 s |
| `lenta:diesel` | 32 casos, zero apagamentos | 18 s |
| `lenta:radial` | 52/52 | 21 s |
| `lenta:rotativo` | 32/32 | 9 s |
| `lenta:eletrico` | 18/18 | 12 s |
| `lenta:vapor` | 14/14 (agora com a massa da locomotiva) | 4 s |
| `troca:diesel`, `geometria:radial` | ok; 34/34 | 58 s; < 1 s |
| `build` | ok | 1 s |

Nenhuma falha nova. Ficam fora do `verificar`, de propósito: `governador:diesel` (sozinho sai com código 1 por duas falhas que o `teste:diesel` trata como desvio; T-DSL-11; desde 23/11/2026 sai com 0 e continua fora porque o `teste:diesel` já roda os governadores) e `gravacoes:vapor` (precisa das gravações em `referencias/vapor/wav`, que não vão no git).

### Ferramentas que entraram

| Comando | O que faz |
|---|---|
| `npm run verificar` / `verificar:rapido` | todos os portões em ordem, um de cada vez, com resumo (`-- --navegador`, `-- --so <trecho>`, `-- --parar`) |
| `npm run lenta:ronco` | 68 carros a 20 °C e −5 °C: partida, lenta, corte de giro, troca de carro |
| `npm run teste:passagem` | monta os 29 presets da Passagem pelo caminho da página e mede nível, NaN, saturação e CPU (`-- --combinacoes`: as 197 combinações portador × motor) |
| `npm run auditoria:fichas` | velocidade por marcha no corte, rpm a 100 km/h, peso/potência, 0–100, Mach de ponta, rodeiros, elétricos; marca o que foge |
| `npm run auditoria:som` | nível de lenta e carga de todos os presets, limitador, CPU, extremos do painel, 44,1 e 96 kHz, troca rápida, coleta de lixo |
| `node tools/servir-dist.mjs [comando]` | serve o `dist/` como no site; é o que `navegador:ronco` e `navegador:turbina` usam |
| `tools/legado.ts` | referência fixa do legado (`02c185f`) e a tabela de correções de ficha da paridade |

---

# Achados por área

## Geral: repositório, legado, portões e ferramentas

**G-01 · erro · corrigido neste trabalho (`5c3179c`).** O `.gitignore` tinha as regras `.claude` e `referencias/` coladas numa linha só (`.claudereferencias/`), então nenhuma das duas valia.
- **Evidência:** `git show 1a2a73c -- .gitignore`. A regra 1 da rodada de som (`docs/PLANO.md`) diz que as gravações de referência nunca entram no git; com a linha colada, um `git add -A` as levaria junto.

**G-02 · erro (latente) · corrigido (`745e183`).** As provas de paridade usavam o nome `master` como referência do legado (`git show master:src/dsp.js`).
- **Evidência:** `tools/ronco-paridade.ts:37`, `tools/turbina-paridade.ts:29` e `tools/cena/legado.ts:39` em `1a2a73c`. No dia em que a reestruturação for mesclada, o `master` novo não tem mais `src/dsp.js` e as três provas param de funcionar. A referência agora é o commit fixo `02c185f` (`REF_LEGADO` em `tools/legado.ts`), o último de `master` com o legado. Vale enquanto esse commit estiver no histórico: uma mesclagem comum o preserva; se a branch for achatada (squash) e a antiga apagada, crie antes uma etiqueta (`git tag legado 02c185f`) e publique-a.

**G-03 · erro (latente) · corrigido (`745e183`).** `paridade:acoustics` lia `src/dsp.js` e `src/jet-dsp.js` da árvore de trabalho, não do histórico.
- **Evidência:** `tools/acoustics-paridade.ts:14` em `1a2a73c`. Remover o legado quebraria o portão; passou a ler do commit de referência.

**G-04 · incompleto · corrigido (`73c2590`).** O legado continuava na árvore "até o fim da etapa", e a etapa acabou.
Removidos: `src/app.js`, `src/dsp.js`, `src/jet-app.js`, `src/jet-dsp.js`, `src/jet-presets.js`, `src/geometry.js`, `src/presets.js`, `jato.html`, `style.css`, `jet.css` (5 420 linhas). Nada do site os importava (conferido em K-01). As três paridades passam lendo o legado do histórico.

**G-05 · erro · corrigido (`73c2590`).** As ferramentas de revisão de som do dono (`tools/analise-som/harness.js`, `render.js`, `regressao.js`) carregavam o DSP **legado**: uma mudança em `src/engines/ronco/dsp.ts` não apareceria em nenhuma medida feita com elas.
- **Evidência:** `tools/analise-som/harness.js:5–8` em `1a2a73c` (`require('../../src/dsp.js')`). Hoje o legado e o TypeScript são idênticos, então nada saiu errado ainda; a etapa de som mexeria no TypeScript e mediria o som antigo. O `harness.js` passou a carregar `src/engines/ronco/` pelo `tsx` (já é dependência do projeto), com a mesma interface (`config`, `render`, `bands`, `use`, `PRESETS`, `EngineDSP`). Conferido byte a byte contra a versão antiga: `render.js fusca 3000`, `mustang 4000 '{"valve":"open"}'` e `THR=1 … v10f1 9000` dão arquivos idênticos; `regressao.js` dá o mesmo resultado. `DSP=legado node render.js …` compara com o DSP de antes da reestruturação. O `STOCK` do banco, que tinha 17 das 28 chaves dos acessórios padrão da página, passou a ser o próprio `ACESSORIOS_PADRAO`.
Fica para o dono: `docs/REVISAO-DE-SOM.md:78–79` ainda ensina `git show HEAD:src/dsp.js > /tmp/dsp.head.js` (não editei esse documento). O equivalente hoje é `DSP=legado` ou, para comparar com uma versão anterior do TypeScript, uma segunda cópia de trabalho naquele commit e `DSP=<cópia>/src/engines/ronco/dsp.ts`.

**G-06 · erro · corrigido (`73c2590`).** `tools/render.ts` renderizava o DSP legado por padrão, inclusive no exemplo do README (`npx tsx tools/render.ts ronco mustang rev saida/`).
- **Evidência:** `tools/render.ts:162–165` em `1a2a73c`. O padrão agora é o DSP, os presets e a geometria em TypeScript.

**G-07 · incompleto · corrigido (`b6c47a8`).** Não havia como rodar tudo de uma vez nem saber quanto leva.
`npm run verificar` (`tools/verificar.mjs`) roda, um passo de cada vez, tipos, as três paridades, `teste:*` (cena, passagem, diesel, radial, rotativo, elétrico, vapor), `lenta:*` (ronco, diesel, radial, rotativo, elétrico, vapor), `troca:diesel`, `geometria:radial` e o build, e imprime uma tabela com o resultado e o tempo de cada um. `npm run verificar:rapido` roda a parte curta. `-- --navegador` acrescenta os oito roteiros de navegador; `-- --so <trecho>` escolhe passos. Os tempos medidos estão em "Portões", no resumo.

**G-08 · incompleto · corrigido (`b6c47a8`).** O Ronco não tinha teste de lenta nem de corte de giro no repositório, embora o PLANO os exija depois de qualquer mudança de motor.
- **Evidência:** `docs/PLANO.md:30` aponta para `idletest.js` e `limtest.js` numa pasta de `/tmp` que não existe mais; `package.json` não tinha `lenta:ronco`. Escrevi `tools/ronco-lenta.ts` (`npm run lenta:ronco`): os 68 carros a 20 °C e a −5 °C (partida em menos de 5 s, lenta a menos de 20 % do alvo do DSP, acelerada, corte de giro em ponto morto entre 90 % e 106 % da faixa vermelha, volta à lenta, sem NaN, pico ≤ 1) e a troca de carro com o motor rodando. Resultado: 136 casos ok, 68 trocas ok, 73 s (165 s com a máquina ocupada). Os sete carros sem corte de giro passam da faixa vermelha em ponto morto por 4 a 8 % (Chevelle 6 049/5 600, Fusca 4 948/4 600), como esperado de um motor sem limitador. Não coberto: o corte de giro em marcha (o harness antigo media em 3ª).

**G-09 · incompleto · corrigido (`b6c47a8`).** `npm run navegador:ronco` e `navegador:turbina` exigiam a URL e falhavam sem ela; os outros seis servem o `dist/` sozinhos.
Como os roteiros `tools/*-navegador.mjs` são também da pessoa da interface, não os editei: criei `tools/servir-dist.mjs`, que serve o `dist/` em `http://127.0.0.1:<porta livre>/data/engine/` e roda um comando contra ele, e os dois scripts do `package.json` passaram a ser `node tools/servir-dist.mjs node tools/ronco-navegador.mjs {url}/ronco.html` (idem Turbina). Argumentos extras continuam valendo (`npm run navegador:ronco -- firefox`). Para a pessoa da interface: os dois roteiros podem ganhar o mesmo "sem url, serve o `dist/`" dos outros seis, e o da Turbina tem o caminho do navegador fixo (`/usr/bin/chromium`, sem `CHROMIUM=`) e opções com outra sintaxe (`--firefox` em vez de `firefox`).

**G-10 · erro · corrigido (`381c356`).** Acrescentar um carro ou um avião, como o TECNICO ensina, quebrava o portão de paridade ("68 presets no legado, 69 no migrado").
A paridade agora compara os presets que vieram do legado e avisa quais são novos. Um campo alterado num preset antigo continua sendo falha, a não ser que esteja declarado em `CORRECOES_RONCO`/`CORRECOES_TURBINA` (`tools/legado.ts`), e nesse caso a mesma correção é aplicada ao preset legado antes de comparar e de renderizar: o DSP continua provado idêntico, com a mesma ficha dos dois lados. Hoje há 17 campos declarados em 15 carros e 3 em 3 aviões, nenhum de som.

**G-11 · dívida · para o dono decidir.** Os testes medem tempo de CPU dentro dos mesmos portões que medem som, e falham com a máquina ocupada.
- **Evidência:** na linha de base desta auditoria, com outras tarefas rodando (carga 40 a 100 em 32 núcleos), `teste:cena` falhou em "CPU por bloco no laço do worklet" (54,3 % contra < 50 %; sozinho dá 12,5 %); nas rodadas dos outros auditores falharam o R-4360 do Radial (90,6 % contra 60 %), a UP 844 do Vapor e três medidas do Elétrico. Nenhuma tem relação com o código. Proposta: tirar as medidas de CPU e de coleta de lixo dos `teste:*` para um `cpu:*` à parte (ou repetir 3 vezes e usar a mediana), para que um `teste:*` vermelho queira sempre dizer som ou física errados. O `tools/verificar.mjs` já roda um passo de cada vez por causa disso.

**G-12 · dívida · para o dono decidir.** A suíte completa leva 47 min (sem os roteiros de navegador, 42), e 32 deles são dois passos: `paridade:turbina` (22 min 45 s neste portão, 13 min na linha de base, conforme a carga da máquina: os 34 aviões são renderizados em série, três cenários cada, dos dois lados) e `teste:diesel` (9 min 22 s com a máquina livre e 20 min com ela ocupada; quase tudo no grupo `nan`, que roda num processo só; ver T-DSL-12). Paralelizar os renders da paridade da Turbina, como a do Ronco já faz (70 s para 200 cenários), tiraria uns 20 min. Os tempos de cada passo estão no resumo.

**G-13 · dívida · para a pessoa da interface.** Os roteiros de navegador falham de vez em quando com a máquina ocupada. `navegador:ronco` falhou uma vez em três execuções seguidas no dia 18/11 (uma conferência; não guardei qual), e o da Passagem falhou no Chromium nas três rodadas do auditor da Passagem, cada vez numa conferência diferente (P-11). No portão final, com a máquina mais livre, os oito passaram. Os roteiros usam esperas fixas de 200 a 250 ms depois de mexer num controle; com a máquina ocupada a página ainda não respondeu. Proposta: esperar pela condição (a telemetria mudou) com tempo limite, em vez de dormir um tempo fixo.

## Fichas do Ronco (68 carros e motos) e da Aviação do Ronco (10)

Conferidas uma a uma contra o veículo real: nome e rótulo, cilindrada, arranjo, virabrequim e ordem de ignição (traduzida para a numeração do simulador: ímpares numa bancada, pares na outra, par `(2k+1, 2k+2)` na mesma posição; `src/engines/ronco/geometria.ts:3-11`), lenta e corte, potência, massa, câmbio e diferencial, aspiração. Para o câmbio, um roteiro calculou a velocidade de cada marcha no corte e a rotação a 100 km/h na última, comparadas com a ficha do fabricante. As fichas de aviação foram conferidas também no portador (Nr, puxão de coletivo, NaN).

Regra aplicada: nos 68 carros só mudaram campos que não alteram o timbre (nome, rótulo, massa, relações, diferencial), cada um declarado em `CORRECOES_RONCO` (`tools/legado.ts`); a paridade completa continua idêntica (`npx tsx tools/ronco-paridade.ts --j 8`: 68/68 presets iguais com 17 campos corrigidos em 15 presets, 200 cenários idênticos em WAV e JSON). O que muda o som ficou listado com o valor proposto. Na aviação (fora da paridade) entraram também três correções de som inequívocas, com `teste:radial` (110 ok, 31 desvios, 0 falhas) e `lenta:radial` (52/52) sem mudança de estado.

Contagem: 32 achados (27 `F-RON`, 5 `F-AVI`): 25 erros, 1 dívida, 6 sugestões. Estado: 19 corrigidos neste trabalho, 11 para a etapa de som, 2 para o dono decidir.

### Corrigidos neste trabalho (commit `1fd9230`, Ronco; `f641664`, Aviação)

| Nº | Sev. | Preset (`presets.ts`) | Estava | Real (fonte) | Correção |
|---|---|---|---|---|---|
| F-RON-01 | erro | `muscle` Camaro SS (linha 103) | rótulo "LS3" com 339 kW, 2,66/1,78/1,30/1,00/0,74/0,50 e 3,73 | esses números são do SS de 6ª geração, com o LT1 (455 hp); o LS3 é o da 5ª: 426 hp, 3,01/2,07/1,43/1,00/0,84/0,57 e 3,45 ([GM Authority, Camaro 2016](https://gmauthority.com/blog/2015/05/and-now-the-preliminary-specifications-of-the-2016-chevy-camaro/); [Wikipedia, TR-6060](https://en.wikipedia.org/wiki/Tremec_TR-6060_transmission)) | rótulo `6.2 V8 LT1 · cross-plane` |
| F-RON-02 | erro | `mustang` (107) | 4ª 1,80 | 10R80: 1,769 ([Wikipedia, Ford–GM 10-speed](https://en.wikipedia.org/wiki/Ford%E2%80%93GM_10-speed_automatic_transmission)) | 4ª 1,77 |
| F-RON-03 | erro | `gt500` (111) | 3,75/2,44/1,68/1,26/1,00/0,85/0,78 (1ª a 70 km/h) | Tremec TR-9070: 3,14/2,05/1,43/1,10/0,86/0,68/0,56 com 3,73 ([suplemento do manual Ford, 03/2020](https://www.fordservicecontent.com/Ford_Content/Catalog/owner_information/2020-Ford-Mustang-Shelby-GT500-Supplement-version-2_su_EN-US_03_2020.pdf)) | relações reais (1ª a 83 km/h no corte) |
| F-RON-04 | erro | `corvette` Z06 C6 (123) | 2,97/2,07/1,43/1,00/0,71/0,57 (1ª a 91 km/h) | essas são do pacote Z51 do Corvette comum; o Z06 usa 2,66/1,78/1,30/1,00/0,74/0,50 com 3,42 ([corvsport.com, 2008](https://www.corvsport.com/2008-corvette-specifications/); [Wikipedia, TR-6060](https://en.wikipedia.org/wiki/Tremec_TR-6060_transmission)) | relações do Z06 (1ª a 102 km/h, como no carro) |
| F-RON-05 | erro | `v6odd` Buick Century 1976 (135) | automático de 4 marchas 2,74/1,57/1,00/0,67 (última a 381 km/h no corte) | essas são do 200-4R, que só existe a partir de 1981; em 1976 o automático era o THM 350, 2,52/1,52/1,00 ([Wikipedia, Turbo-Hydramatic](https://en.wikipedia.org/wiki/Turbo-Hydramatic); [Hagerty](https://www.hagerty.com/valuation-tools/Buick/Century/1976/1976-Buick-Century)) | `gears: 3`, 2,52/1,52/1,00 (o diferencial 2,73 ficou; não achei a ficha do eixo) |
| F-RON-06 | erro | `aventador` SVJ (157) | 1525 kg | 1525 kg é o peso seco; com fluidos, 1770 kg ([Wikipedia](https://en.wikipedia.org/wiki/Lamborghini_Aventador); [Motor1](https://www.motor1.com/news/263420/lamborghini-aventador-svj-supercar/)) | massa 1770 |
| F-RON-07 | erro | `i4` S2000 (201) | diferencial 4,10 (6ª a 100 km/h: 2842 rpm) | o câmbio do S2000 tem uma redução secundária de 1,160 antes do diferencial 4,100: total 4,756 ([Honda, ficha do câmbio](https://hondanews.com/en-US/releases/release-4a111fc377fd37d93a2f73004c34c870-honda-s2000-transmission)) | `finalDrive: 4.76` (6ª a 100 km/h: 3300 rpm; 2ª no corte: 108 km/h) |
| F-RON-08 | erro | `ek9` (205) | 4ª 1,03 e 5ª 0,79 | EK9: 3,230/2,105/1,458/1,107/0,848 com 4,400; 1,034/0,787 são do Integra Type R 98, com 4,785 ([ek9.org](https://www.ek9.org/index.php?threads/ek9-honda-civic-type-rx-specifications.1019/); [civictyper.org](https://www.civictyper.org/ek9civic.html)) | 3,23/2,11/1,46/1,11/0,85 |
| F-RON-09 | erro | `mx5` ND (229) | 4ª 1,46, 5ª 1,00, 6ª 0,72 (6ª a 100 km/h: 1768 rpm) | 5,087/2,991/2,035/1,594/1,286/1,000 com 2,866: a 6ª é direta ([Mazda USA, 2018](https://www.mazdausa.com/siteassets/pdf/features--specs/2018/mx5-st/2018_mazda_mx5_st_features_specs.pdf)) | 5,09/2,99/2,04/1,59/1,29/1,00 (2456 rpm a 100 km/h) |
| F-RON-10 | erro | `m5e60` (239) | 4,08/2,60/1,80/1,35/1,08/0,90/0,78 | SMG III: 3,985/2,652/1,806/1,392/1,159/1,000/0,833 com 3,62 ([ficha de imprensa BMW](https://www.press.bmwgroup.com/usa/article/attachment/T0018132EN_US/56945)) | relações reais |
| F-RON-11 | erro | `c63` (251) | nome "Mercedes-AMG C63" com o 6.2 M156 | o M156 é do C 63 AMG W204 (2008–2014), vendido como Mercedes-Benz; "Mercedes-AMG C 63" é o W205 em diante (4.0 biturbo) | nome `Mercedes-Benz C 63 AMG` |
| F-RON-12 | erro | `f1v12` Ferrari 412 T2 (277) | 7 marchas | câmbio transversal de 6 marchas ([f1technical.net](https://www.f1technical.net/f1db/cars/766/ferrari-412t2); [Wikipedia](https://en.wikipedia.org/wiki/Ferrari_412_T2)) | `gears: 6`, 3,60/2,79/2,16/1,67/1,29/1,00 (mesma 1ª e mesma última; as intermediárias são escolha, como já eram) |
| F-RON-13 | erro | `fusca` 1600 (329) | diferencial 4,375 | 4,375 é o do 1300; o 1600 usa 8 × 33 = 4,125 ([guia de câmbios VW](http://clubedofuscavaledoaco.blogspot.com/2011/08/como-identificar-os-cambios-vw.html); [ficha do Fusca 1600](http://carburadosecia.blogspot.com/2014/03/ficha-tecnica-vw-fusca-1600_3.html)) | `finalDrive: 4.125` (4ª a 100 km/h: 3246 rpm) |
| F-RON-14 | sugestão | `golgti` (333) | "VW Gol GTI" | o emblema do Gol 2.0 AP com injeção de 1989 é "GTi" | nome `VW Gol GTi` |
| F-RON-15 | erro | `single` KTM 450 SX-F (387) | "monocilíndrico de trilha" | a SX-F é de motocross; a de trilha (enduro) é a EXC-F | rótulo `monocilíndrico de motocross` |
| F-AVI-01 | erro | `c172` (403) | rótulo "160 hp" com 112 kW e taxa 7,0 | 112 kW e 7,0:1 são do O-320-E2D de 150 hp (172I a 172M); o de 160 hp tem 8,5 ou 9,0:1 ([Wikipedia, Lycoming O-320](https://en.wikipedia.org/wiki/Lycoming_O-320)) | rótulo `150 hp` |
| F-AVI-02 | erro | `bell47` (422) | 5,73 L, rotor R 5,66 m a 370 rpm, 1340 kg, redução 8,4 | 47G com o Franklin 6V4-200-C32: 335 pol³ (5,49 L), rotor de 35 ft 1,5 in (R 5,35 m), 2350 lb (1066 kg), redução de 9:1, ou 344 rpm de rotor a 3100 do motor; R 5,66 e 1340 kg são do 47G-3B, de motor Lycoming turbo ([Wikipedia, Franklin O-335](https://en.wikipedia.org/wiki/Franklin_6A4); [museu do Canadá](https://ingenium.ca/aviation/en/collection-highlight/bell-47g-htl-6/); [Heli Archive](https://www.heli-archive.ch/en/helicopters/in-depth-articles/bell-47g); [AOPA](https://www.aopa.org/news-and-media/all-news/2011/february/01/bell-47-helicopter-movie-and-tv-star)) | 5,49 L; `R: 5.35, Nr: 344, icx: 9.0, massa: 1066`; rotor de cauda mantido em 1650 rpm; rótulo `5,5 L` |
| F-AVI-03 | erro | `r44` (432) | "R44 (Lycoming O-540)", 245 hp, carburador | 245 hp de decolagem é o Raven II, com o IO-540-AE1A5 de injeção; o O-540-F1B5 de carburador (Raven I) dá 225 hp ([manual de manutenção Robinson, cap. 16, p. 16.1](https://robinsonstrapistorprod.blob.core.windows.net/uploads/assets/r44_mm_16_98b54d8fd7.pdf)) | nome `Robinson R44 Raven II (Lycoming IO-540)`, `fuel: 'efi'` |
| F-AVI-04 | erro | `s300` (435) | taxa 8,5 | HIO-360-D1A: 10:1 ([Wikipedia, variantes do O-360](https://en.wikipedia.org/wiki/List_of_Lycoming_O-360_variants)) | `compression: 10.0` |

**O que F-AVI-02 mudou no comportamento** (roteiro `scratchpad/aud/fr/helis.ts`: rotor no pairado com coletivo 0,5, puxão para 0,75 em 1 s; `ORIG=1` refaz com a ficha antiga):

| Bell 47G | Nr no pairado (coletivo 0,5) | Nr mínimo no puxão | Nr com coletivo 0,75 | Motor |
|---|---|---|---|---|
| ficha antiga (alvo 370) | 337 rpm (−9%) | 73 rpm | 168 rpm | 701 rpm, 29 kW: o motor afoga |
| ficha corrigida (alvo 344) | 344,0 rpm | 300 rpm | 310 rpm (−10%) | 2697 rpm, 109 kW |

Com a ficha antiga o Franklin não segurava o rotor do 47G-3B com 1340 kg: quem escolhesse o Bell 47 na Passagem e puxasse o coletivo ouvia o motor morrer. R22 e R44 seguram o Nr nos dois casos (530,0 e 408 rpm, mínimo 527,8 e 405,6); o 300C cai de 471 para 451 rpm (era 437) com coletivo 0,75. Sem NaN em nenhum dos quatro.

### Para a etapa de som (mudam o timbre; não foram alterados)

| Nº | Sev. | Preset | Na ficha | Real (fonte) | Valor proposto |
|---|---|---|---|---|---|
| F-RON-16 | erro | `huracan` (161), `r8` (255) | V10 a 72° de ignição uniforme (`crank: 'even72'`, `bankAngle: 72`) | o 5.2 FSI é um V10 a 90° com moente comum: intervalos alternados de 90° e 54° ([Audi](https://www.audi.com/en/the-audi-r8-until-2024-updated-dynamics-for-the-high-performance-sports-car-11734/engine-11738); [Evo](https://www.evo.co.uk/features/206394/the-anatomy-of-a-v10-audilamborghinis-final-naturally-aspirated-engine)) | `crank: 'odd90', bankAngle: 90, order: '1-8-7-4-3-10-9-6-5-2'` (o mesmo do `viper`) |
| F-RON-17 | erro | `m5e60` (239) | idem | S85: 90°, duas bielas por moente, 90°/54° ([Wikipedia, BMW S85](https://en.wikipedia.org/wiki/BMW_S85)) | idem |
| F-RON-18 | erro | `v10f1` F2004 (269) | idem | Tipo 053: V10 a 90° ([Wikipedia, Ferrari F2004](https://en.wikipedia.org/wiki/Ferrari_F2004)). Que a ignição fique 90°/54° é inferência minha (moente comum a 90°); não achei fonte que diga | `bankAngle: 90` e, se confirmado o moente comum, `crank: 'odd90'` |
| F-RON-19 | erro | `muscle` (103) | ordem do small-block antigo, 1-8-4-3-6-5-7-2 | LS e LT: 1-8-7-2-6-5-4-3 ([JEGS](https://www.jegs.com/tech-articles/engine-firing-order-explained/)) | `order: '1-8-7-2-6-5-4-3'` (já existe na lista do virabrequim). É o preset de referência de `tools/cena/referencias/legado.json`: trocar exige regravar a referência |
| F-RON-20 | sugestão | `mustang` (107) | ordem do LS, 1-8-7-2-6-5-4-3 | Coyote: 1-5-4-8-6-3-7-2 na numeração da Ford (1–4 numa bancada, 5–8 na outra), que na numeração do simulador dá 1-8-7-3-6-5-4-2 (tradução minha, conferida com `build()`: válida) | `order: '1-8-7-3-6-5-4-2'` |
| F-RON-21 | erro | `cbr` (351) | corte a 14.500 rpm com 141 kW | 141 kW é a CBR1000RR de 2017–19 (SC77), que corta a 13.000 rpm; 14.500 rpm é a rotação de potência máxima da CBR1000RR-R de 160 kW ([MCNews](https://www.mcnews.com.au/2017-honda-cbr1000rr-fireblade-review/); [Wikipedia](https://en.wikipedia.org/wiki/Honda_CBR1000RR)) | `redline: 13000` e o rótulo `13.000 rpm` |
| F-RON-22 | erro | `panigale` V4 (367) | `crank: '180'`, ordem 1-3-2-4 (intervalos 180/90/180/270) e corte a 16.000 rpm | Desmosedici Stradale 1103: "Twin Pulse", ignições a 0°, 90°, 290° e 380° (intervalos 90/200/90/340); limite de giro 14.000–14.500 rpm; 16.000 é o da V4 R de 998 cm³ ([Ducati](https://www.ducati.com/us/en/company/product-innovation/engines/desmosedici-stradale); [Cycle News](https://www.cyclenews.com/2018/02/article/2018-ducati-panigale-v4s-full-test/)) | `crank: '360', order: '1-2-3-4'` (270/90/270/90: os dois pares a 90°, como no real) e `redline: 14500` |
| F-RON-23 | sugestão | `mt07` (379) | corte a 9000 rpm | 9000 rpm é a rotação de potência máxima; o limitador entra a ~10.500 ([Ultimate Motorcycling](https://ultimatemotorcycling.com/2019/01/22/2018-yamaha-mt-07-test-long-term-sport-commuter-review/)) | `redline: 10500` |
| F-RON-24 | sugestão | `supra` (209) | turbo a 1,4 bar com os 240 kW de fábrica | de fábrica, 0,75–0,9 bar; 1,4 bar é o limite dos turbos originais ([Autoevolution](https://www.autoevolution.com/news/how-to-get-more-power-out-of-a-2jz-gte-stock-supra-engine-bpu-78455.html)) | `boost: 0.8`, ou assumir no rótulo que é um Supra preparado |
| F-RON-25 | sugestão | `viper` (131) | ordem 1-8-7-4-3-10-9-6-5-2 | real: 1-10-9-4-3-6-5-8-7-2 ([DodgeTalk, ficha do 8.0](https://www.dodgetalk.com/threads/viper-engine-bore-x-stroke.118387/)). Os intervalos (54°/90°) e a alternância de bancadas já são os reais; a ordem real pede outro arranjo de moentes | um virabrequim novo em `geometria.ts`: `pins: dbl([0, 72, 288, 144, 216])` com essa ordem (muda só quais cilindros disparam em sequência) |
| F-RON-26 | sugestão | `fusca` (329) | taxa 7,5 | 7,2:1 no 1600 de um carburador ([ficha do Fusca 1600](http://carburadosecia.blogspot.com/2014/03/ficha-tecnica-vw-fusca-1600_3.html)) | `compression: 7.2` (o Fusca foi revisado de ouvido: só com o dono) |

O que se ouve em F-RON-16 a 18: com escape de uma saída por bancada, cada bancada já dispara a cada 144° nos dois casos; a diferença está na soma. A 72° as duas bancadas se cancelam na ordem 2,5 e o motor soa como um tom limpo de ordem 5; a 54°/90° a ordem 2,5 e seus múltiplos ímpares voltam (a soma fica com 0,77 da amplitude de uma bancada), que é o uivo rouco do Huracán, do R8 e do M5. O Carrera GT (68°) e o LFA (72°) estão certos como estão.

### Para o dono decidir

- **F-RON-27 (dívida): potência dos híbridos.** `amgone` (linha 307) tem 560 kW, que não é o V6 (422 kW) nem o conjunto (782 kW) ([Wikipedia](https://en.wikipedia.org/wiki/Mercedes-AMG_One); [Motor1](https://www.motor1.com/news/589290/mercedes-amg-one-debut-f1-powered/)). `laferrari` (153) usa só o V12 (588 kW; o conjunto é 708 kW). O simulador não tem motor elétrico: escolher uma regra (só o motor a combustão, ou o conjunto para o carro andar como o real) e aplicar aos dois.
- **F-AVI-05 (erro, etapa de som ou dono): o Bell 47G ainda perde 10% de Nr com coletivo 0,75** (310 de 344 rpm, tabela acima) e o 300C perde 4%. Ou a potência exigida pelo rotor em `carriers/rotor.ts` está alta para esses dois, ou o coletivo 0,75 passa do que o helicóptero real sustenta; nenhum teste mede (o `teste:radial` só confere o R44).

### Fora do meu escopo (uma frase cada)

- `src/carriers/rotor.ts:36`: `ROTOR_R44.massa` é 1090 kg, o peso máximo do Raven I (2400 lb); o Raven II, que o preset agora nomeia, tem 2500 lb = 1134 kg (mesmo manual, p. 16.1). Não mexi: muda a potência do pairado e as medidas do R44 no `teste:radial`.
- `src/pages/passagem/presets.ts:146` e `tools/passagem-navegador.mjs:278` ainda dizem "O-540" para o R44.
- O comentário de `presets.ts` diz "massa com motorista", mas a maioria das fichas usa o peso em ordem de marcha sem motorista.

### As 78 fichas

"ok" quer dizer: os campos batem com o que sei da ficha do veículo e as velocidades por marcha são plausíveis. Só os achados numerados acima foram conferidos em fonte; num "ok" pode haver diferença de centésimos numa relação que não procurei.

| id | Veículo | Veredito | Nota |
|---|---|---|---|
| muscle | Chevrolet Camaro SS | corrigida + pendente | rótulo LT1 (F-RON-01); ordem de ignição do LS/LT pendente (F-RON-19) |
| mustang | Ford Mustang GT | corrigida + pendente | 4ª do 10R80 (F-RON-02); ordem do Coyote, sugestão (F-RON-20) |
| gt500 | Shelby GT500 | corrigida | relações do TR-9070 (F-RON-03); compressor, pressão e potência conferem |
| gt350 | Shelby GT350 | ok | Voodoo 5.2 flat-plane, 8250 rpm, TR-3160 e 3,73 conferem |
| hellcat | Dodge Challenger Hellcat | ok | 527 kW, 8HP90 (4,71…0,67), 2,62, compressor de parafuso: conferem |
| corvette | Corvette Z06 C6 | corrigida | relações do Z06 (F-RON-04) |
| chevelle | Chevelle SS 454 (1970) | ok | M22 2,20/1,64/1,28/1,00 e 3,31 conferem |
| viper | Dodge Viper | ok (sugestão) | 8.4 de 2008: 2,66/1,82/1,30/1,00/0,74/0,50 com 3,07 na [ficha da Chrysler](https://s3.amazonaws.com/chryslermedia.iconicweb.com/mediasite/specs/2008ViperSRT10ACRSpecs110107.pdf) (o preset tem 1,78 na 2ª); ordem real pede outro virabrequim (F-RON-25) |
| v6odd | Buick Century 3.8 (1976) | corrigida | câmbio de 3 marchas (F-RON-05); V6 odd-fire e ordem conferem |
| flatplane | Ferrari 458 Italia | ok | 419 kW, 9000 rpm, 3,08…0,69 com 4,44 conferem |
| f40 | Ferrari F40 | ok | 352 kW, 7750 rpm; velocidades por marcha 89/141/195/253/324 km/h batem |
| f812 | Ferrari 812 Superfast | ok | 588 kW, 8900 rpm, V12 a 65° |
| laferrari | LaFerrari | ok (dono) | só o V12 (588 kW); regra dos híbridos em F-RON-27 |
| aventador | Lamborghini Aventador SVJ | corrigida | massa com fluidos (F-RON-06); relações do ISR e 3,54 conferem |
| huracan | Lamborghini Huracán Performante | pendente | V10 é a 90° com ignição 90°/54° (F-RON-16) |
| mclaren | McLaren 720S | ok | 530 kW, 1420 kg; 7ª a 341 km/h perto de 8100 rpm |
| zonda | Pagani Zonda | ok | 443 kW é o Zonda F; 6 marchas, final 345 km/h |
| flat6 | Porsche 911 GT3 RS | ok | 991.2: 383 kW, 9000 rpm, PDK 3,75…0,84 com 4,19; ordem traduzida confere |
| turbos | Porsche 911 Turbo S | ok | 3745 cm³, 478 kW, 8 marchas |
| carrera32 | Porsche 911 Carrera 3.2 (1984) | ok | 170 kW, câmbio 915, 3,875 |
| carreragt | Porsche Carrera GT | ok | V10 a 68°, 450 kW, 8400 rpm; velocidades por marcha próximas das reais |
| boxer4 | Subaru WRX STI | ok | relações do STI 2004–07 (3,636/2,375/1,761/1,346/1,062/0,842) e 3,90 |
| brz | Toyota GR86 / Subaru BRZ | ok | FA24, 3,626…0,767 com 4,10 |
| i4 | Honda S2000 | corrigida | redução secundária (F-RON-07) |
| ek9 | Honda Civic Type R EK9 | corrigida | 4ª e 5ª (F-RON-08) |
| supra | Toyota Supra MK4 | ok (sugestão) | V160 e 3,27 conferem; pressão do turbo alta para o de fábrica (F-RON-24) |
| r34 | Nissan Skyline GT-R R34 | ok | Getrag V160, 3,545 |
| gtr | Nissan GT-R R35 | ok | GR6 4,056…0,796 com 3,70 |
| lfa | Lexus LFA | ok | V10 a 72°, 412 kW, 9000 rpm; 6ª no corte a 327 km/h |
| evo | Mitsubishi Lancer Evo IX | ok | 2,785/1,950/1,407/1,031/0,720 com 4,529 |
| mx5 | Mazda MX-5 ND | corrigida | 4ª, 5ª e 6ª (F-RON-09) |
| i6 | BMW M3 E46 | ok | S54, 4,227…0,828 com 3,62 |
| m5e60 | BMW M5 E60 | corrigida + pendente | relações do SMG III (F-RON-10); V10 a 90° pendente (F-RON-17) |
| i5 | Audi RS3 | ok | 294 kW, 1-2-4-5-3, 7 marchas |
| quattro | Audi Sport Quattro S1 | ok | 2,1 L, Grupo B |
| c63 | Mercedes-Benz C 63 AMG | corrigida | nome (F-RON-11); 7G-Tronic 4,38…0,73 com 2,82 e ordem conferem |
| r8 | Audi R8 V10 | pendente | V10 a 90° com ignição 90°/54° (F-RON-16) |
| m3g80 | BMW M3 G80 | ok | S58, 8HP 5,00…0,64 com 3,15 |
| golfgti | VW Golf GTI | ok | 180 kW, DSG de 7 |
| v10f1 | Ferrari F2004 (F1) | pendente | V10 é a 90° (F-RON-18); 7 marchas, 605 kg, 19.000 rpm conferem |
| f1v8 | Fórmula 1 V8 (2006–2013) | ok | 2,4 L a 90°, flat-plane, 18.000 rpm |
| f1v12 | Ferrari 412 T2 (F1 1995) | corrigida | 6 marchas (F-RON-12); V12 a 75°, 595 kg conferem |
| nascar | NASCAR Cup | ok | 5,86 L de varetas, 4 marchas, 1540 kg |
| c8r | Corvette C8.R (Le Mans) | ok | 5,5 L flat-plane, 6 marchas |
| v16 | Bugatti Chiron | ok | 1103 kW, 7ª a 419 km/h no corte |
| jesko | Koenigsegg Jesko | ok | 941 kW com gasolina, 9 marchas |
| valkyrie | Aston Martin Valkyrie | ok | V12 Cosworth de 746 kW, 11.100 rpm |
| t50 | GMA T.50 | ok | 3,9 L, 12.100 rpm, 488 kW, 6 marchas manual |
| amgone | Mercedes-AMG One | pendente (dono) | potência 560 kW não corresponde a nada (F-RON-27) |
| opala | Chevrolet Opala 4.1 original | ok | 250 de 6 em linha, 4 marchas |
| opala250s | Chevrolet Opala 250-S | ok | |
| maverick | Ford Maverick GT | ok | 302, 2,78/1,93/1,36/1,00 |
| charger | Dodge Charger R/T | ok | 318, 4 marchas |
| fusca | VW Fusca 1600 | corrigida (sugestão) | diferencial (F-RON-13); ordem 1-4-3-2 traduzida certo; taxa 7,2 (F-RON-26) |
| golgti | VW Gol GTi | corrigida | grafia do nome (F-RON-14) |
| unoturbo | Fiat Uno Turbo i.e. | ok | 1372 cm³, 87 kW, 0,8 bar |
| i3 | VW up! TSI | ok | 77 kW, 5 marchas |
| r1 | Yamaha R1 | ok | 2,600…1,250 e 4,19 (1,634 × 41/16) conferem |
| cbr | Honda CBR1000RR | pendente | corte da CBR1000RR-R (F-RON-21); relações conferem |
| zx10r | Kawasaki Ninja ZX-10R | ok | 149 kW, ordem 1-2-4-3, final 3,86 |
| h2 | Kawasaki Ninja H2 | ok | 3,188…1,348, 3,79, compressor centrífugo a 9,2× conferem |
| hayabusa | Suzuki Hayabusa | ok | 2,615…1,043 |
| panigale | Ducati Panigale V4 | pendente | virabrequim Twin Pulse e corte (F-RON-22) |
| monster | Ducati Monster 1200 | ok | relações 37/15…22/25 |
| vtwin | Harley-Davidson Big Twin | ok | Milwaukee-Eight, final 2,875 |
| mt07 | Yamaha MT-07 | ok (sugestão) | 2,846…0,964 e 5,17 conferem; corte (F-RON-23) |
| triumph | Triumph Speed Triple | ok | 1050 cm³, 103 kW |
| single | KTM 450 SX-F | corrigida | rótulo (F-RON-15) |
| c172 | Cessna 172 (Lycoming O-320) | corrigida | rótulo 150 hp (F-AVI-01); hélice de 1,93 m a 2700 rpm: Mach 0,80 na ponta |
| o360 | Piper Archer / RV-7 (O-360) | ok | 5,92 L, 180 hp, 8,5:1 |
| io540 | Piper Saratoga (IO-540) | ok | 8,87 L, 300 hp, hélice de 2,03 m |
| o200 | Cessna 150 (Continental O-200) | ok | 3,29 L, 100 hp a 2750 rpm, hélice de 1,75 m |
| io550 | Cirrus SR22 (IO-550) | ok | 9,05 L, 310 hp, hélice de 1,98 m |
| rotax912 | Rotax 912 ULS | ok | 1352 cm³, 100 hp a 5800 rpm, redutor 2,43 (hélice a 2387 rpm, Mach 0,62) |
| bell47 | Bell 47G (Franklin 6V4) | corrigida + pendente | motor, rotor, peso e redução (F-AVI-02); queda de Nr com coletivo alto (F-AVI-05) |
| r22 | Robinson R22 (O-360) | ok | Beta II: O-360-J2A a 2652 rpm (104%), rotor de 7,67 m a 530 rpm, 622 kg |
| r44 | Robinson R44 Raven II (IO-540) | corrigida | variante e injeção (F-AVI-03); rotor de 5,03 m a 408 rpm, cauda de 1,47 m conferem com o manual |
| s300 | Schweizer 300C (HIO-360) | corrigida | taxa 10:1 (F-AVI-04); rotor de 3 pás, R 4,09 m, 190 hp a 3200 rpm conferem |

## Fichas: Turbina (34) e Radial (17)

Conferidas uma a uma contra a aeronave ou o veículo real. Os números de linha são os do commit `745e183` (antes das correções). Onde havia dúvida, a fonte foi consultada e está citada; o resto bate com as fichas públicas dos fabricantes e não tem achado. Correções no branch `worktree-agent-a796fd5d0dc31c2a7`: `6f2b6a8` (Turbina), `2d50413` e `dc6e435` (Radial).

Portões depois das correções:

- `npx tsx tools/turbina-paridade.ts wide,b707b,bizjet`: **TUDO IDÊNTICO** (3 cenários do `render.ts` + 7 extras); `--sem-render` com os 34: presets idênticos com "3 campo(s) em 3 preset(s)" declarados em `CORRECOES_TURBINA`, e os 7 cenários extras idênticos em 34/34 ("TUDO IDÊNTICO"). A paridade completa com `render.ts` nos 34 não foi rodada.
- `npm run teste:radial`: 141 medidas, 110 ok, 31 desvios, 0 falhas com os Rotec corrigidos (naquela rodada estava junto a tentativa do Verner 5S); nenhuma medida mudou de estado em relação à linha de base. Na rodada final, com a máquina a carga 70 em 32 núcleos (as outras suítes rodando junto), a medida de CPU do R-4360 deu 90,6 % e falhou (portão 60 %); as outras 140 saíram iguais. Refeita sozinha (`npx tsx tools/radial-valida.ts cpu`): 48,5 %, ok. O R-4360 não foi tocado: é a dependência de carga já apontada na frente 3.
- `npm run lenta:radial`: 52/52. `npm run geometria:radial`: 34/34. `typecheck`: limpo.

### Turbina

**F-TUR-01 · erro · corrigido (`6f2b6a8`).** O Phenom 300 tinha o empuxo dos dois motores somados num campo que é "kN por motor".
- Evidência: `src/engines/turbina/presets.ts:156`, `thrust: 30`. O PW535E dá 3 360 lbf = 14,95 kN por motor (PW535E1 do 300E: 3 478 lbf = 15,47 kN). Fontes: [Wikipedia, Phenom 300](https://en.wikipedia.org/wiki/Embraer_Phenom_300) e o relatório de aceitação de tipo [TAR 13/21B/3 da CAA da Nova Zelândia](https://www.aviation.govt.nz/assets/aircraft/type-acceptance-reports/PW535-Series.pdf). Os outros três executivos estão por motor (Learjet 16, G650 75, HondaJet 9).
- Correção: `thrust: 15`. O campo só alimenta o mostrador de empuxo (`thrust100` em `dsp.ts:196` e `:794`, telemetria); o som não muda. Declarado em `CORRECOES_TURBINA`.

**F-TUR-02 · erro de rótulo · corrigido (`6f2b6a8`).** O 777-300ER dizia "o maior fan".
- Evidência: `presets.ts:80`. O GE9X do 777X tem fan de 134 pol (3,40 m) contra 128 pol (3,25 m) do GE90-115B, e foi certificado em 25/9/2020 ([Wikipedia, GE9X](https://en.wikipedia.org/wiki/General_Electric_GE9X)).
- Correção: `'2× GE90-115B · fan de 3,25 m, 22 pás'`.

**F-TUR-03 · erro de rótulo · corrigido (`6f2b6a8`).** O 707-320B dizia "primeiro turbofan".
- Evidência: `presets.ts:103`. O primeiro motor com derivação a entrar em serviço foi o Rolls-Royce Conway ([Wikipedia, Conway](https://en.wikipedia.org/wiki/Rolls-Royce_Conway)), no 707-420 e no DC-8-40; o JT3D veio depois.
- Correção: `'4× JT3D · um dos primeiros turbofans'`.

**F-TUR-04 · erro · para a etapa de som.** O C-130J usa a rotação do gerador de gás de outro motor: o apito do compressor sai cerca de uma oitava acima.
- Evidência: `presets.ts:144` herda de `TP` (`presets.ts:51`) `n1Max: 27000` e `n2Max: 31000`, os valores genéricos da base dos turboélices (os mesmos do ATR e do Q400). O AE 2100 tem gerador de gás de eixo único com compressor axial de 14 estágios e limite de 15 404 rpm em regime (turbina de potência 14 267 rpm, eixo da hélice 1 020,7 rpm, redução 13,98:1). Fonte: [TCDS EASA IM.E.040](https://www.easa.europa.eu/sites/default/files/dfu/EASA-TCDS-E.040_(IM)_Rolls--Royce_Corporation_AE_2100_series_engines-01-29082008.pdf), que cobre o AE 2100A, D2 e D2A; o D3 do C-130J é da mesma família (material de treinamento do C-130J dá 15 265 rpm a 100 %).
- Proposta: `n1Max` e `n2Max` em torno de 15 400. A hélice (6 pás, 4,11 m, 1 020 rpm) está certa.

**F-TUR-05 · erro · para a etapa de som.** O HondaJet tem as duas rotações abaixo da ficha.
- Evidência: `presets.ts:165`, `n1Max: 17000`, `n2Max: 40000`. O HF120 tem 100 % de N1 em 19 055 rpm e 100 % de N2 em 48 777 rpm (limite 49 200). Fontes: TCDS EASA IM.E.054 ([cópia da CAA do Reino Unido](https://www.caa.co.uk/Documents/Download/3939/984aa08e-5352-4da9-824b-309ec7cec37d/2940)) e [Wikipedia, HF120](https://en.wikipedia.org/wiki/GE_Honda_HF120).
- Proposta: `n1Max: 19055`, `n2Max: 48777`. O tom do fan sobe 12 % e o do compressor 22 %.

**F-TUR-06 · erro menor · para a etapa de som.** O comprimento do Phenom 300 é a envergadura.
- Evidência: `presets.ts:155`, `length: 15.9`. O avião tem 15,64 m de comprimento e 15,91 m de envergadura ([Wikipedia](https://en.wikipedia.org/wiki/Embraer_Phenom_300)).
- Proposta: `length: 15.64`. O campo só pesa no estrondo sônico e na geometria da passagem; ficou de fora por ser campo que o DSP lê.

**F-TUR-07 · sugestão · para o dono decidir.** Três rótulos que não estão errados, mas confundem:
- `presets.ts:126`, F-35: "o maior caça monomotor". É o mais pesado; o F-105 era mais comprido. "O motor de caça mais potente" (F135) não tem discussão.
- `presets.ts:106`, 727: "bypass 1". Em português, "derivação 1:1".
- `presets.ts:41`, família "Widebodies e jumbos". Em português, "Fuselagem larga e jumbos". O nome da família não passa pela tabela de correções (a paridade compara `families` à parte): mudar exige estender `tools/legado.ts`.

### Radial

**F-RAD-01 · erro · corrigido (`2d50413`).** Os dois Rotec estavam como acionamento direto, com a ponta da hélice a Mach 0,97 e 1,00.
- Evidência: `src/engines/radial/presets.ts:122` e `:126`, `reducao: 1`, `nMax: 3600`, hélices de 1,75 e 1,80 m. O fabricante dá 110 hp e 150 hp a **2 450 rpm da hélice**, por um redutor planetário 3:2, com hélice fixa de 76 pol (1,93 m) no R2800 e de 80–90 pol no R3600: [rotecaerosport.com/r2800](https://www.rotecaerosport.com/r2800) e [/r3600](https://www.rotecaerosport.com/r3600). O `RADIAL.md` (linhas 204, 239, 242, 378, 379) trata o motor como direto e encolhe a hélice para caber abaixo de Mach 1.
- Correção: `reducao: 0.6667`, `nMax: 2400`, `D: 1.93` (R2800) e `2.03` (R3600). Ponta a Mach 0,71 e 0,75.
- Medido: nenhuma medida do `teste:radial` mudou de estado. A banda de 60–150 Hz da lenta do Rotec foi de +10,2 para −1,3 dB (alvo da gravação +3 ± 4): o que sobrava ali era a passagem de pá da hélice rápida demais. Outros números que mudam na tabela do TECNICO: centroide 1 706 → 1 873 Hz, 3·f_ign −5,1 → −4,5 dB, nível da lenta a 12 m 65 → 59 dB (R2800) e 66 → 61 dB (R3600), faixa dos 13 aviões 38,1 → 39,3 dB. Em plena carga parado o R2800 fica em 3 291 rpm no motor e 2 194 na hélice.
- Sobra fora do meu escopo: `src/carriers/helice.ts:61` (`madeira`, "Madeira/compósito (Rotec)") continua com 1,75 m a 3 600 rpm e `i: 1`.

**F-RAD-02 · erro · para a etapa de som.** O Verner Scarlett 5S tem a ficha de outro motor, e com a ficha certa ele não pega.
- Evidência: `presets.ts:133–134`: 2,3 L, 77 kW (103 hp), 2 600 rpm, taxa 8,0. O fabricante dá 3 390 cm³ (92 × 102 mm), 83 hp (61 kW) a 2 300 rpm, taxa 7,8, acionamento direto, hélice de até 2,00 m: [vernermotor.com](https://vernermotor.com/page1.html). Os 103 hp são a potência contínua do 7U, de 7 cilindros. Com 2,3 L e 77 kW a 2 600 rpm a pressão média efetiva seria de 15,4 bar, impossível num aspirado refrigerado a ar.
- Tentativa: com `displacement: 3.39` (e o resto igual) o `lenta:radial` falha nos dois casos do `verner5` ("pegou em NaN s", 0 rpm). Não investiguei a causa; a suspeita é o arranque não vencer a compressão do motor maior. Revertido, como manda a regra.
- Proposta: `displacement: 3.39, cr: 7.8, rpmMax: 2300, power: 61, helice.nMax: 2300` e o rótulo "3,4 L · 83 hp", junto com o acerto do arranque.

**F-RAD-03 · erro · para o dono decidir (correção em dois arquivos).** O Sherman anda 3,5 vezes mais rápido que o real: falta o diferencial.
- Evidência: `presets.ts:142`, `finalDrive: 2.84`. O M4A1 tem o diferencial controlado de 3,53:1 **e** a redução final de 2,84:1 (total 10,03), com as cinco marchas que a ficha já traz. Fonte: fichas do M4A1 em [theshermantank.com](https://www.theshermantank.com/wp-content/uploads/M4A1-74d-mid.pdf), com velocidade máxima de 24 mph (39 km/h).
- Medido na ficha atual, a 2 400 rpm: 13,5 / 32,8 / 57,3 / 91,8 / **139,7 km/h** por marcha. Com 10,03: 3,8 / 9,3 / 16,2 / 26,0 / 39,6 km/h.
- Por que não corrigi: o preset "Sherman passando" da Passagem (`src/pages/passagem/presets.ts:154`) impõe 15 km/h em 2ª. Com a relação certa isso dá 3 880 rpm num motor de 2 400. A correção tem de ser feita junta:
  - `src/engines/radial/presets.ts`, `r975`: `finalDrive: 10.03`;
  - `src/pages/passagem/presets.ts:154`: `marcha: 3` e o subtítulo "3ª" (2 220 rpm; hoje 1 098 rpm em 2ª).
- O critério do `RADIAL.md` passo 9, "0–30 km/h em 12–18 s em 2ª", nasceu do mesmo erro: a 2ª real acaba em 9,3 km/h. Nenhuma medida do `teste:radial` usa o Sherman em marcha.

**F-RAD-04 · erro · para a etapa de som.** O rotor do S-55 gira na rotação-limite, não na de voo.
- Evidência: `presets.ts:164`, `Nr: 245`, `icx: 9.18`. A caixa principal reduz 11,3155:1 ([Sikorsky Archives](https://sikorskyarchives.com/home/sikorsky-product-history/helicopter-innovation-era/sikorsky-s-55/)), o que dá 199 rpm no rotor com o R-1340 a 2 250 rpm e 194 rpm a 2 200. Os 245 rpm são o topo da faixa segura de 170–245 rpm ([Heli Archive](https://www.heli-archive.ch/en/helicopters/in-depth-articles/sikorsky-s-55-h-19)), que o motor não alcança.
- Efeito: passagem de pá em 12,25 Hz em vez de 9,9 Hz e ponta a Mach 0,61 em vez de 0,49.
- Proposta: `Nr: 199`, `icx: 11.3155`, e refazer `ic` e `engrenagens`, que dependem do `Nr`. A rotação do rotor de cauda (1 440 rpm na ficha) não achei em fonte.
- O resto da ficha confere: R-1340-57 de 600 hp a 2 250 rpm, rotor de 3 pás e 16,15 m, cauda de 2 pás e 2,64 m, fuselagem 12,85 m.

**F-RAD-05 · erro de rótulo · corrigido (`dc6e435`).** O M-14PF dizia "Su-31 / Yak-55M · 400 hp · estaques acrobáticos".
- Evidência: `presets.ts:115`. O Yak-55M usa o M-14P de 360 hp ([Wikipedia, Yak-55](https://en.wikipedia.org/wiki/Yakovlev_Yak-55)); a ficha da aeronave no preset já é a do Su-31 (780 kg, 6,8 m, MTV-9 de 3 pás). "Estaques" é o apelido interno dos escapes individuais e não é português.
- Correção: `'Su-31 · 400 hp · escapes individuais curtos'`.

**F-RAD-06 · dívida · para o dono decidir (preset marcado como aproximação).** A Megola gira até 4 800 rpm; a fonte dá 3 600.
- Evidência: `presets.ts:153`, `rpmMax: 4800`. A [Wikipedia](https://en.wikipedia.org/wiki/Megola) dá 14 bhp (10 kW), os cilindros a no máximo 3 600 rpm com a roda a 600 rpm (6:1), 85 km/h no modelo de turismo. A ficha dá 99,5 km/h a 4 800 rpm. Cilindrada (5 × 52 × 60 mm = 640 cm³), potência, 6:1, sem embreagem nem câmbio: conferem.

**F-RAD-07 · dívida · para o dono decidir (valor "≈").** O Monaco-Trossi pesa 1 000 kg na ficha e 710 kg no museu.
- Evidência: `presets.ts:149`, `mass: 1000`. O carro tem cerca de 710 kg ([Old Machine Press](https://oldmachinepress.com/2012/09/01/1935-monaco-trossi/), [MAUTO](https://www.museoauto.com/en/collection/monaco-trossi/)); com piloto e combustível, uns 850. O resto confere: 16 cilindros a 2 tempos em 2 fileiras, 3 982 cm³, 250 hp a 6 000 rpm, dois Zoller, 4 marchas, tração dianteira. A 4ª a 6 000 rpm dá 239,5 km/h, igual aos 240 km/h do teste em Monza.

**F-RAD-08 · dívida de documentação.** O `RADIAL.md:45` dá a ordem `1-2-3` para o radial de 3 cilindros. A ficha usa `1-3-2`, que é a certa (intervalos de 240°; `1-2-3` daria 120°, 120°, 480°).

**F-RAD-09 · sugestão.** Duas fichas misturam variantes sem dizer:
- `presets.ts:94–98`, R-4360: a hélice é a do B-50 (4 pás, 5,08 m) e o corpo é o do C-124 (40 m × 53 m, 80 t). O rótulo cita os dois.
- `presets.ts:130`, Verner 3V: hélice de 1,70 m; a tabela do fabricante dá 160 como hélice máxima (a unidade não está escrita; centímetros). Taxa 8,0 na ficha, 8,2 no fabricante. O resto confere (1 635 cm³, 42 hp a 2 500 rpm).

### Mach na ponta da pá (parado, rotação máxima, c = 340,3 m/s)

| id | hélice | D (m) | rpm da hélice | ponta (m/s) | Mach | passagem de pá (Hz) |
|---|---|---|---|---|---|---|
| `regional` (ATR 72-600) | 6 pás | 3,93 | 1 200 | 246,9 | 0,73 | 120,0 |
| `q400` | 6 pás | 4,11 | 1 020 | 219,5 | 0,65 | 102,0 |
| `c130` | 6 pás | 4,11 | 1 020 | 219,5 | 0,65 | 102,0 |
| `kingair` | 4 pás | 2,67 | 1 700 | 237,7 | 0,70 | 113,3 |
| `single` (Caravan) | 3 pás | 2,69 | 1 900 | 267,6 | 0,79 | 95,0 |
| `pc12` | 4 pás | 2,67 | 1 700 | 237,7 | 0,70 | 113,3 |
| `stucano` | 5 pás | 2,38 | 2 000 | 249,2 | 0,73 | 166,7 |
| `r1820` (T-28B) | 3 pás | 3,05 | 1 520 | 242,7 | 0,71 | 76,0 |
| `r1830` (DC-3) | 3 pás | 3,50 | 1 520 | 278,6 | 0,82 | 76,0 |
| `r2800` (F4U-4) | 4 pás | 4,01 | 1 225 | 257,2 | 0,76 | 81,7 |
| `r2800turbo` (P-47D) | 4 pás | 3,96 | 1 350 | 279,9 | 0,82 | 90,0 |
| `r4360` | 4 pás | 5,08 | 1 012 | 269,2 | 0,79 | 67,5 |
| `r1340` (T-6) | 2 pás | 2,74 | 2 250 | 322,8 | **0,95** | 75,0 |
| `r985` (Trimotor) | 2 pás | 2,60 | 2 300 | 313,1 | 0,92 | 76,7 |
| `m14p` (Yak-52) | 2 pás | 2,40 | 1 908 | 239,8 | 0,70 | 63,6 |
| `m14pf` (Su-31) | 3 pás | 2,50 | 1 940 | 253,9 | 0,75 | 97,0 |
| `rotec2800` | 2 pás | 1,93 (era 1,75) | 2 400 (era 3 600) | 242,5 (era 329,9) | 0,71 (era **0,97**) | 80,0 |
| `rotec3600` | 3 pás | 2,03 (era 1,80) | 2 400 (era 3 600) | 255,1 (era 339,3) | 0,75 (era **1,00**) | 120,0 |
| `verner3` | 2 pás | 1,70 | 2 500 | 222,5 | 0,65 | 83,3 |
| `verner5` | 2 pás | 1,90 | 2 600 | 258,7 | 0,76 | 86,7 |
| `s55` (rotor) | 3 pás | 16,15 | 245 | 207,2 | 0,61 | 12,25 |

O T-6 a Mach 0,95 e o R-985 a 0,92 são reais: acionamento direto com hélice de 2,74 m a 2 250 rpm é o que dá o rasgado do T-6 na decolagem.

### As 51 fichas

| id | veículo | veredito | nota |
|---|---|---|---|
| `narrow` | Boeing 737-800, CFM56-7B | ok | 24 pás, 1,55 m, N1 5 380, 121 kN. Não tocado (referência da Cena). |
| `a320` | Airbus A320, CFM56-5B | ok | 36 pás, 1,73 m, 120 kN. |
| `geared` | A320neo, PW1100G | ok | 20 pás, 2,06 m, redutor 3,06, fan a 3 280 rpm. |
| `max8` | 737 MAX 8, LEAP-1B | ok | 18 pás, 1,76 m, 130 kN, chevrons. |
| `e2` | E195-E2, PW1900G | ok | 18 pás, 1,85 m, 100 kN, 41,5 m. |
| `wide` | 777-300ER, GE90-115B | corrigida | Rótulo "o maior fan" (F-TUR-02). Dados conferem: 22 pás, 3,25 m, N1 2 355, 513 kN. |
| `b787` | 787-9, GEnx-1B | ok | 18 pás, 2,82 m, N1 2 560. |
| `a350` | A350-900, Trent XWB | ok | 3 eixos, 22 pás, 3,00 m, 375 kN. |
| `a380` | A380, Trent 900 | ok | 3 eixos, 24 pás, 2,95 m, N1 2 900. |
| `b744` | 747-400, RB211-524 | ok | 3 eixos, 24 pás, 2,19 m, N1 3 900. |
| `jumbo` | 747-100, JT9D | ok | 46 pás, 2,34 m, 210 kN. |
| `turbojet` | 707-120, JT3C | ok | Turbojato de 2 eixos, 60 kN. |
| `b707b` | 707-320B, JT3D | corrigida | Rótulo "primeiro turbofan" (F-TUR-03). Dados conferem: 1,35 m, derivação 1,4, 80 kN. |
| `b727` | 727, JT8D | ok | 3 motores na cauda, derivação 1, N1 8 600, N2 12 250. "bypass" no rótulo (F-TUR-07). |
| `caravelle` | Caravelle, Avon | ok | Eixo único, 8 000 rpm, 50 kN. |
| `sst` | Concorde, Olympus 593 | ok | 2 eixos com reaquecimento, 140 kN a seco, 62 m. |
| `fighter` | F-16, F110 | ok | Não tocado (referência da Cena). |
| `twin` | F-15, F100 | ok | 79 kN a seco é o F100-PW-229. |
| `f22` | F-22, F119 | ok | 116 kN a seco, derivação 0,3. |
| `f35` | F-35, F135 | ok | 125 kN a seco, derivação 0,57, 1,17 m. Rótulo: F-TUR-07. |
| `fa18` | Super Hornet, F414 | ok | Derivação 0,25, 0,79 m, 18,3 m. |
| `su27` | Su-27, AL-31F | ok | 75 kN a seco, derivação 0,57. |
| `gripen` | Gripen, RM12 | ok | 54 kN a seco, 14,1 m. |
| `regional` | ATR 72-600, PW127 | ok | Hélice 568F: 6 pás, 3,93 m, 1 200 rpm. |
| `q400` | Dash 8 Q400, PW150 | ok | 6 pás, 4,11 m, 1 020 rpm. |
| `c130` | C-130J, AE 2100 | pendente | Hélice certa; gerador de gás com a rotação do PW150 (F-TUR-04). |
| `kingair` | King Air 350, PT6A-60A | ok | 4 pás, 2,67 m, 1 700 rpm; gerador de gás a 37 500 rpm. |
| `single` | Cessna Caravan, PT6A-114 | ok | 3 pás, 2,69 m, 1 900 rpm. |
| `pc12` | Pilatus PC-12, PT6A-67 | ok | 4 pás, 2,67 m, 1 700 rpm. |
| `stucano` | Super Tucano, PT6A-68 | ok | 5 pás, 2,38 m, 2 000 rpm. |
| `bizjet` | Phenom 300, PW535E | corrigida | Empuxo por motor (F-TUR-01). Pendente: comprimento (F-TUR-06). |
| `learjet` | Learjet 35, TFE731 | ok | Fan com redutor 1,8, 30 pás, 0,72 m, 16 kN. |
| `g650` | G650, BR725 | ok | 24 pás, 1,27 m, 75 kN. |
| `hondajet` | HondaJet, HF120 | pendente | N1 e N2 abaixo da ficha (F-TUR-05). Empuxo e derivação conferem. |
| `r1820` | Wright R-1820, T-28B | ok | 29,9 L, 1 425 hp a 2 700 rpm, redução 0,5625, 3 pás de 3,05 m. |
| `r1830` | P&W R-1830, DC-3 | ok | 30 L, 1 200 hp, 0,5625, 3 pás de 3,5 m, compressor 7,15:1, ordem de 14 cilindros certa. |
| `r2800` | R-2800-18W, F4U-4 | ok | 45,9 L, 2 100 hp a 2 800 rpm, 4 pás de 4,01 m. O `RADIAL.md:198` registra a razão ignição/pá de 5,13 medida na gravação, que dá a redução 0,4375 da ficha. |
| `r2800turbo` | R-2800-59, P-47D | ok | 2 000 hp a 2 700 rpm, 2:1, 4 pás de 3,96 m. |
| `r4360` | R-4360, B-50 / C-124 | ok | 71,5 L, 28 cilindros, 3 500 hp, 0,375, compressor 6,37:1. Mistura de variantes: F-RAD-09. |
| `r1340` | R-1340, T-6 | ok | 22 L, 600 hp a 2 250 rpm, direto, 2 pás de 2,74 m, compressor 10:1. |
| `r985` | R-985, Ford Trimotor | ok | 16,1 L, 450 hp a 2 300 rpm. Os Trimotor que voam hoje usam três R-985 ([EAA](https://www.eaa.org/eaa/about-eaa/eaa-media-room/eaa-ford-tri-motor-media-room/eaa-ford-tri-motor-specifications)); o 5-AT saiu de fábrica com o Wasp de 420 hp. |
| `m14p` | M-14P, Yak-52 | ok | 10,16 L, 360 cv a 2 900 rpm, redução 0,658, taxa 6,3, 2 pás de 2,4 m, partida a ar. |
| `m14pf` | M-14PF, Su-31 | corrigida | Rótulo (F-RAD-05). 400 cv a 2 950 rpm confere. |
| `rotec2800` | Rotec R2800 | corrigida | Redutor 3:2 e hélice de 76 pol (F-RAD-01). 7 cilindros, 2,8 L, 110 hp, taxa 8,5 conferem. |
| `rotec3600` | Rotec R3600 | corrigida | Redutor 3:2 e hélice de 80 pol (F-RAD-01). 9 cilindros, 3,6 L, 150 hp conferem. |
| `verner3` | Verner Scarlett 3V | ok | 1,6 L, 42 hp a 2 500 rpm, direto. Hélice e taxa: F-RAD-09. |
| `verner5` | Verner Scarlett 5S | pendente | Cilindrada, potência e rotação de outro motor; a ficha certa não pega (F-RAD-02). |
| `r975` | Continental R-975, M4A1 | pendente | Motor, marchas, massa e dimensões conferem; falta o diferencial de 3,53 (F-RAD-03). |
| `trossi` | Monaco-Trossi | pendente (dono) | Motor confere; massa 1 000 kg contra 710 (F-RAD-07). 2 tempos tocado como 4 tempos, já declarado. |
| `megola` | Megola | pendente (dono) | Rotação máxima 4 800 contra 3 600 (F-RAD-06). |
| `s55` | Sikorsky S-55, R-1340-57 | pendente | Rotor a 245 rpm; o real gira a 199 (F-RAD-04). |

## Fichas: Diesel e Rotativos

Conferidas as 16 fichas de `src/engines/diesel/presets.ts` e as 17 de `src/engines/rotativo/presets.ts` contra o veículo real, mais os dados de portador que elas usam em `src/carriers/locomotiva.ts` e `gerador.ts` (só lidos). As contas de marcha estão em `scratchpad/aud/fichas-dr/marchas.ts` (velocidade em cada marcha na rotação máxima, rpm a 100 km/h) e `coerencia.ts` (cilindrada × diâmetro × curso, torque na rotação de potência, Mach na ponta da hélice e do rotor). Onde havia dúvida real a ficha foi pesquisada; a fonte está em cada achado.

Como cada campo entra no som (lido no código antes de corrigir):

- **Diesel** (`src/engines/diesel/dsp.ts:185–200`): `power` e `rpmPotencia` definem o combustível máximo por injeção; `torque` vira `Tmax`, que normaliza a vibração do bloco e a sonda de lenta; `diametro` e `displacement` definem o cilindro; `cr` a compressão. Todos mudam o som. `mass`, `ratios`, `finalDrive`, `wheelR`, `drag`, `name` e `tag` não mudam.
- **Rotativos**: `power` só escala o torque da dinâmica, como no Ronco; `torque` é um piso de `Tmax` (`src/engines/rotativo/dsp.ts:131`); `rotor.B` só entra na passagem de pá do portador (`src/carriers/rotor.ts:154`). Câmbio, massa e rótulos não mudam o som.

Regra seguida: campo que não muda o som, erro objetivo corrigido; campo de som, corrigido só com fonte inequívoca e com os testes da família sem nenhuma medida mudando de estado (comparação linha a linha com a linha de base, `scratchpad/aud/fichas-dr/compara.py`).

### Diesel

**F-DSL-01 · erro · corrigido neste trabalho (`51906a5`).** Câmbio do Duramax (`duramax66`, `presets.ts:139`): a 5ª e a 6ª da Allison 10L1000 estavam 1,38 e 1,14; as reais são 1,48 e 1,26 (e 2ª 2,87, 9ª 0,69). Com as antigas a 5ª ia a 110 km/h a 3450 rpm; com as reais, 102. Fonte: tabela da 10L1000 em gearboxlist.com/gm/10l1000 e a folha com três casas (4,541 / 2,866 / 2,064 / 1,719 / 1,484 / 1,260 / 1,000) em duramaxforum.com/threads/2020-allison-10spd.996473.

**F-DSL-02 · erro · corrigido (`51906a5`).** Ano do rótulo da Hilux (`hilux28`, `presets.ts:103`): "2016" com 150 kW e 500 N·m. Esses números são os da reestilização de 2020; de 2015 a 2019 o 1GD-FTV dava 130 kW e 450 N·m. Rótulo passa a "2020". Fonte: paultan.org, 4/6/2020 ("2.8L turbodiesel now makes 204 PS, 500 Nm"); Wikipedia, "Toyota GD engine".

**F-DSL-03 · erro · corrigido (`51906a5`).** Ano do rótulo do 7.3 Power Stroke (`psd73`, `presets.ts:143`): "1999" com 186 kW (250 hp). Em 1999–2000 o motor dava 235 hp a 2700 rpm; 250 hp a 2600 rpm com o automático é a calibração de 2001–2003. Rótulo passa a "2001". Fica para a etapa de som um resto de 1%: com 250 hp a 2600 rpm o torque na rotação de potência é 683 N·m, acima do `torque: 678` da ficha (500 lb·ft, o de 1999); o de 2001 é 505 lb·ft = 685 N·m. Fonte: dieselhub.com/powerstroke/power-stroke-diesel-timeline.html; enginebuildermag.com/2018/01/7-3l-6-7l-ford-power-stroke.

**F-DSL-04 · erro · corrigido (`51906a5`).** Código do motor do Scania (`scaniav8`, `presets.ts:186`): o rótulo dizia "DC16.03". O V8 de 500 cv Euro 3 do R500 (368 kW a 1900 rpm, 2400 N·m) é o **DC16 04**; DC16 03 é o de 580 cv (426 kW, 2700 N·m). Fonte: lista de motores Scania em autowiki.fi ("Luettelo Scania-moottorityypeistä"); steinbauer.cc ("DC16 03 580 15.6 PDE EUR3").

**F-DSL-05 · erro · corrigido (`51906a5`).** Câmbio do MC-9 (`dd6v92`, `presets.ts:245`): 2ª 2,01 e 3ª 1,36; a Allison HT-740 tem 3,692 / 2,021 / 1,383 / 1,000. Fonte: folha da Allison HT 740/747 (dal-trans.com.au/files/HT-740_-HT-747-1.pdf).

**F-DSL-06 · erro · para a etapa de som (testado e revertido).** Cilindrada do Cat (`catc15`, `presets.ts:211`): o rótulo é "C15 6NZ · 2003", mas `displacement: 15.2` e `curso: 171` são do C15 ACERT (2004 em diante, dois turbos em série). O C-15 6NZ, de um turbo, tem 14,6 L (893 pol³), 137 × 165 mm. O resto da ficha (um turbo com wastegate, sem DPF, 550 hp a 2100 rpm, 1850 lb·ft a 1200) é do 6NZ, então o erro é a cilindrada: 15,2 → 14,6 L, curso 171 → 165,1 mm. Apliquei a correção e rodei o `teste:diesel`: duas das 255 medidas mudam de estado, então ela foi revertida, como manda a regra. `caminhão plena 1900 rpm (catc15): dp/dθ máx` sai de desvio para ok (5,8 → 6,2 bar/°, alvo 6–9) e `envoltória · catc15 lenta: fundo mecânico liso no vão de 1–4 kHz` sai de ok para falha por 0,1 dB (−3,4 → −2,9 dB, alvo ≤ −3). O Cat é a referência de "caminhão" em mais de 30 medidas (pressões, Jake, real3, envoltória); a cilindrada certa entra junto com a revisão de som do pesado. Saída completa em `scratchpad/aud/fichas-dr/dsl1-teste.log`. Fonte: folha da Caterpillar "C-15 435–550 hp @ 2100 rpm" (thompsonmachinery.com/content/uploads/2017/04/C-15-435hp-to-550hp@2100rpm.pdf); apresentação "C15 Machine ACERT" (14,6 → 15,2 L pelo curso de 165 → 171 mm).

**F-DSL-07 · erro · corrigido neste trabalho (`be931b5`).** Torque da Ram (`ram67`, `presets.ts:125`): `torque: 1152` (850 lb·ft) é o da Ram 3500 com a caixa Aisin (385 hp). A Ram 2500 de 2013 com a 68RFE da ficha (as relações são dela) tem 370 hp a 2800 rpm e 800 lb·ft a 1600 rpm: 1085 N·m. Fonte: folha de especificações da Chrysler, "2013 Ram 2500 & 3500 Heavy Duty Specifications (update)" (s3.amazonaws.com/chryslermedia.iconicweb.com/mediasite/specs/2013_Ram_HD_SpecsUPDATE.pdf).

**F-DSL-08 · erro · corrigido neste trabalho (`be931b5`).** Torque e potência do ônibus (`onibusisl`, `presets.ts:225`): `torque: 1017` (750 lb·ft) não é de nenhum ISL9 de 280 hp; todas as certificações (EPA 07, 2010, 2013) dão 900 lb·ft a 1300 rpm = 1220 N·m. `power: 206` é 280 **cv**; o motor é de 280 **hp** = 209 kW. Corrigidos os dois. Fica para a etapa de som: a rotação governada da Cummins é 2200 rpm, e a ficha tem `rpmPotencia: 2100` e `rpmMax: 2300`. Fonte: tabela de potências do ISL9 para ônibus urbano em cummins.com (ISL9 2013 e EPA 2010); Wikipedia, "Cummins L-series engine".

**F-DSL-09 · erro · corrigido neste trabalho (`be931b5`).** Taxa de compressão do Volvo (`volvod13`, `presets.ts:199`): `cr: 17.0`; a ficha da Volvo do D13A480 Euro 3 dá 18,1:1 (e confirma o resto: 131 × 158 mm, 353 kW de 1400 a 1800 rpm, 2400 N·m de 1050 a 1400, VEB+ de 375 kW). Fonte: "Fact Sheet Engine D13A480, EM-EC01", 7/8/2007 (stpi.it.volvo.com/STPIFiles/Volvo/FactSheet/D13A480, EM-EC01_Eng_02_1144695.pdf).

**F-DSL-10 · erro · corrigido neste trabalho (`be931b5`).** Diâmetro do Detroit (`dd6v92`, `presets.ts:237`): `diametro: 123.8`; a Série 92 tem 4,84 pol = 123 mm por 5 pol = 127 mm (552 pol³, 9,05 L). O DSP não lê o `curso` da ficha: tira-o da cilindrada e do diâmetro (`dsp.ts:165–169`), então com 123,8 o motor rodava com 125,3 mm de curso em vez de 127. Um efeito colateral que não é do diâmetro: o pico da acelerada de 0,6 s do `lenta:diesel` foi de 1932 para 1769 rpm (a coluna é informativa, não é critério). Variando o diâmetro de 122,6 a 124,2 mm o pico vai e volta sem ordem (1770, 1769, 1814, 1932, 1807 rpm a 20 °C; 1747, 1643, 1846, 1830, 1755 a −5 °C): a acelerada do 2 tempos tem uns ±5% de dispersão a qualquer perturbação da ficha, e é isso que a etapa de som vai encontrar ao mexer nele. Fonte: Wikipedia, "Detroit Diesel Series 92"; dieselpro.com/detroit-diesel-6v92.html.

**F-DSL-11 · dívida · para o dono decidir.** O campo `curso` de `PresetDiesel` não é lido por ninguém (`grep -n "curso" src/engines/diesel/*.ts`: o DSP calcula `this.curso = this.Vd / this.Ap`). É a terceira cópia da mesma informação (cilindrada, diâmetro, curso) e pode divergir sem aviso, como divergia no 6V92. Depois das correções as 16 fichas fecham em ±0,6% (`coerencia.ts`). Sugestão: ou o `lenta:diesel` confere `π/4·D²·curso·N` contra `displacement` (±1%), ou o campo sai.

**F-DSL-12 · erro · apontado, não editado (`src/carriers/`).** Buzina da locomotiva: `BUZINA_K5LA = [311, 370, 440, 494, 622]` (`src/carriers/locomotiva.ts:21`, comentário na linha 115). A Nathan K5LA toca Si maior com sexta: ré♯4, fá♯4, **sol♯4**, si4, ré♯5 = 311, 370, **415**, 494, 622 Hz. Com o lá (440) no lugar do sol♯ o acorde vira si com sétima, outro som. Correção: `440` → `415`. Hoje ninguém ouve: a buzina nasce desligada (`buzina: false`) e nenhuma página nem teste a liga (`grep -rn buzina src tools` só acha o próprio `locomotiva.ts`). Fonte: train-horn.com/glossary/k5la; tabela de sinos em hornblasters.com/pages/nathan-airchime-train-horns.

**F-DSL-13 · dívida · apontado, não editado (`src/carriers/`).** Rodeiro: a locomotiva usa roda de 1,02 m (40 pol) para os dois motores (`src/carriers/locomotiva.ts:107–110`). Está certo para a GE C30-7; a SD70ACe tem roda de 42 pol = 1,067 m. Sem efeito hoje: o diâmetro só entra no pulso por volta de roda, que só existe com `achatamento > 0`, e a locomotiva passa 0 (`src/carriers/ruido.ts:160–167`). O corpo também é um só (22 m: a SD70ACe tem 22,6 m; a C30-7 é mais curta, ≈ 20,5 m). Fonte: thedieselshop.us, "EMD SD70ACe Data Sheet" (roda 42", 408 000 lb, 904 rpm).

**F-DSL-14 · dívida · para o dono decidir.** As tabelas por notch existem em duplicata: rotação em `NOTCH_RPM` (`src/carriers/locomotiva.ts:16–19`) e em `locomotiva.notchRpm` de cada ficha (`presets.ts:275` e `289`); frações de potência em `NOTCH_POTENCIA` (`locomotiva.ts:20`) e em `NOTCH_POT` (`src/engines/diesel/constantes.ts:34`). Os valores são iguais hoje. Na Passagem as duas cópias da rotação trabalham em série: o portador escolhe a tabela pelo id (`src/pages/passagem/controle.ts:228`: `id === 'ge7fdl' ? 'ge7fdl' : 'emd710'`), manda a rotação-alvo, e o adaptador do motor procura o notch de rotação mais próxima na tabela da ficha (`src/engines/diesel/motor.ts:117–121`, com o comentário "as tabelas do CENA 4.5 e do preset são as mesmas"). Se uma das duas for editada, o motor cai em outro notch sem nenhum erro. Uma tabela só, importada pelos dois lados, resolve.

**F-DSL-15 · sugestão · para o dono decidir.** Potência das locomotivas em convenções diferentes: a EMD usa a potência bruta do motor (`power: 3356` = 4500 hp, pelo DIESEL.md; a ficha da SD70ACe dá 4300 hp para tração), a GE usa a potência para tração do C30-7 (`power: 2240` = 3000 hp). Escolher uma convenção para as duas.

**F-DSL-16 · sugestão · para o dono decidir.** Diferencial do MC-9 (`dd6v92`, `finalDrive: 4.11`): não achei fonte para a relação do eixo do MC-9 com a HT-740. Com 4,11 e roda de 0,50 m o ônibus rodoviário chega a 96 km/h a 2100 rpm em 4ª (direta); a conta está em `marchas.ts`. Fica marcado como não conferido.

**F-DSL-17 · sugestão · para o dono decidir.** Câmbio do Cat (`catc15`, `presets.ts:218`): as 10 marchas são tiradas das 18 da Eaton RTLO-18918B, misturando reduzidas e diretas: 14,40 / 8,56 / 6,05 / 4,38 / 3,20 e depois 1,95 / 1,38 / 1,00 / 0,86 / 0,73. Entre 3,20 e 1,95 a caixa real ainda tem 2,73 e 2,29; na ficha o salto é de 1,64× (36 → 59 km/h a 2100 rpm), contra 1,2–1,4× nas outras trocas. Ou a ficha leva as relações de uma caixa de 10 marchas de verdade, ou 12 das 18.

**F-DSL-18 · sugestão · para o dono decidir.** F-1000 (`f1000mwm`, `presets.ts:174–181`): sem ano no rótulo. Os números (66 kW, 274 N·m, taxa 17, cinco marchas) são próximos dos da versão dos anos 1990 (29 kgfm a 1600 rpm, taxa 17:1). A F-1000 de 1979 a 1989 tinha 83 cv a 3000 rpm, 25,3 kgfm a 1600, taxa 16,6 e quatro marchas. Pôr o ano no rótulo resolve. Fonte: fichacompleta.com.br (F-1000 3.9 CS 1985 e Super Cab 1994); carrosnaweb.com.br.

**F-DSL-19 · sugestão · documentação.** `docs/DIESEL.md` 6.2 chama a caixa do 300D de "722.1" com as relações 3,68 / 2,41 / 1,44 / 1,00, que são da 722.3 (1981 em diante); a 722.1 tinha 3,98 / 2,39 / 1,46 / 1,00. A ficha em `presets.ts:160` não nomeia a caixa e as relações são de uma caixa real do W123: nada a corrigir no preset.

**Conferido e certo no Diesel** (sem achado): cilindrada, diâmetro e curso de todos; ordens de ignição reais (`ordemReal`) do Duramax, do Power Stroke, do Scania e da EMD, e a tradução delas para a numeração do Ronco (o padrão de bancadas confere por rotação cíclica); relações e diferencial da Hilux (AC60F, 3,909), da Ranger (6R80, 3,73), da Ram (68RFE; 3,42 / 3,73 / 4,10 eram oferecidos), do F-250 (4R100), do Golf (02J, 3,389), do Scania (GRS905), do Volvo (I-Shift AT2612) e do ônibus (ZF EcoLife); rpm a 100 km/h na última: Hilux 1604, Ranger 1751, Ram 1558, Duramax 1429, F-250 1756, Golf 2278; caminhões a 80 km/h: Scania 1257, Volvo 1163, Cat 1058; gerador de 4 polos a 1800 rpm = 60 Hz, 500 kVA × 0,8 = 400 kWe; EMD 16-710: 2 tempos, 45°, 186 L, 904 rpm em N8 e 408 000 lb = 185 t (ficha da Diesel Shop), turbo engrenado; GE 7FDL-16: 4 tempos, 45°, 228,6 × 266,7 mm, 175 L, 12,7:1, 1050 rpm, bombas individuais. As rotações intermediárias por notch das duas e a lenta de 269 rpm da EMD são as tabelas usuais, sem fonte primária conferida (a ficha da Diesel Shop dá 318 rpm de mínima para a SD70ACe; a gravação medida no DIESEL.md dá ≈ 250). O raio de roda de 0,375 m da Hilux é o raio dinâmico certo do 265/65 R17 (≈ 680 voltas por milha).

### Rotativos

**F-ROT-01 · erro · corrigido (`6892ac0`).** Câmbio do RX-8 de 192 cv (`rx8std`, `presets.ts:128`): as relações 3,815 / 2,26 / 1,64 / 1,177 / 0,832 não são de nenhuma caixa do RX-8 (são um cruzamento das duas caixas de 6 marchas). A caixa de 5 do motor de 4 janelas é 3,483 / 2,015 / 1,484 / 1,000 / 0,762, diferencial 4,444. Torque 222 → 220 N·m, como na ficha. Fonte: Mazda UK, "Mazda RX-8 Vehicle specifications" (2005), tabela "Technical Data", coluna RX-8 (190). A mesma folha confirma o Hi-Power: 231 PS a 8200, 211 N·m a 5500, corte a 9000, 3,760 / 2,269 / 1,645 / 1,187 / 1,000 / 0,843.

**F-ROT-02 · erro · corrigido (`6892ac0`).** Câmbio do Ro 80 (`ro80`, `presets.ts:149`): 2,13 / 1,21 / 0,81 e diferencial 4,86; as reais são 2,056 / 1,208 / 0,788 e 4,857. O 0–100 km/h do teste foi de 12,2 para 12,4 s (alvo 12–15; o carro real fazia ≈ 13). Fonte: dewiki.de/Lexikon/NSU_Ro_80 (três casas); auto motor und sport, dados técnicos do Ro 80 (2,06 / 1,21 / 0,79; 4,86).

**F-ROT-03 · erro · corrigido (`6892ac0`).** Câmbio do Cosmo 110S (`cosmo110s`, `presets.ts:161`): estava com a caixa do RX-3 (3,683 / 2,263 / 1,397 / 1,00). A do L10A é 3,379 / 2,077 / 1,390 / 1,000, diferencial 4,111 (este estava certo). Fonte: uniquecarsandparts.com, "Mazda Cosmo Technical Specifications"; motor-car.net (mesmas quatro primeiras relações na caixa de 5 da série II).

**F-ROT-04 · erro · corrigido (`6892ac0`).** Rótulos: "280 ps" no RX-7 FD e "231 hp" no RX-8 Hi-Power são cavalos métricos (206 e 170 kW): passam a "280 cv" e "231 cv" (231 hp seriam 172 kW). A família "Europeus" tinha o Mazda Cosmo 110S: passa a "Europeus e clássicos". (Mover o Cosmo para "Mazda de rua" quebraria `tools/rotativo-navegador.mjs:121`, que conta 5 presets nessa família.)

**F-ROT-05 · erro · corrigido (`c9866c3`).** Rotor do Camcopter S-100 (`ae50r`, `presets.ts:184`): `B: 3`; o S-100 tem rotor principal de **2 pás** (diâmetro 3,4 m, cauda de 2 pás; estes estavam certos). A passagem de pá vai de 53,5 para 35,7 Hz. `docs/ROTATIVO.md:371` repete "rotor 3 pás". `teste:rotativo` sem mudança de estado (Nr no pairado 1070 rpm, droop 0,23%). Fonte: militaryfactory.com (aircraft_id=898); armyrecognition.com; ficha da BlueSkyRotor ("Blades number: 2").

**F-ROT-06 · erro · para o dono decidir (a correção exige mudar um alvo de teste).** Câmbio do RX-7 FD (`rx7fd`, `presets.ts:103`): 5ª de 0,761 com diferencial 4,1 não existe em nenhum FD. É, a menos de um milésimo, o conjunto do FC Turbo II (0,762 / 4,10). O FD teve dois conjuntos, com 1ª a 4ª iguais (3,483 / 2,015 / 1,391 / 1,000):

| Versão | 5ª | Diferencial | rpm a 100 km/h (roda da ficha, 0,316 m) |
|---|---|---|---|
| caixa de série (compilação de especificações do FD3S) | 0,719 | 4,100 | 2474 |
| Type RS (280 cv; catálogo Goo-net) | 0,762 | 4,300 | 2750 |
| ficha hoje | 0,761 | 4,100 | 2619 |

O `TECNICO.md:1309` conta a origem: a 5ª foi mudada de 0,806 para 0,761 para o teste dar os "2 600 rpm do próprio documento". O alvo `2 600 ± 100` de `tools/rotativo-valida.ts:434` (e `docs/ROTATIVO.md:437`) não corresponde a nenhum dos dois carros, e a 0,806 do ROTATIVO.md não é de FD. Como a ficha é a do carro de 280 cv, a correção proposta é `ratios: [3.483, 2.015, 1.391, 1.0, 0.762], finalDrive: 4.3` e o alvo do teste em `2 750 ± 100`; ou a caixa de série (0,719 / 4,1) com `2 470 ± 100`. Não mexi porque qualquer das duas tira a medida do alvo atual. Não muda o som. Fonte: compilação de especificações do FD3S em rx7club.com (thread 694523: 0,719 e 4,100); catálogo Goo-net do GF-FD3S Type RS (0,762, 4,300, 280 ps a 6500 rpm, 1280 kg, 235/45 e 255/40 ZR17).

**F-ROT-07 · erro · para a etapa de som.** Admissão do Ro 80 (`ro80`, `presets.ts:147`): `janelas.admissao: 'lateral4'`. O KKM 612 tem **admissão periférica**; é por causa dela (cruzamento em baixa rotação, trancos na desaceleração) que o carro ganhou o conversor de torque. O `docs/ROTATIVO.md:366` repete "lateral4". Não corrigi porque as opções do simulador não têm uma periférica de rua: `'periferica'` é a de corrida do R26B (abre a 460°e, 18 cm²) e a mais próxima é `'sachs'` (periférica pequena, abre a 540°e). Trocar muda a lenta e a desaceleração do preset, e os tempos de janela reais do KKM 612 precisam ser levantados. Fonte: dewiki.de/Lexikon/NSU_Ro_80 (Umfangseinlass e a razão do conversor).

**F-ROT-08 · incompleto · para o dono decidir (aproximação declarada).** Mistral G-200 (`mistral`, `presets.ts:164–170`): o rótulo diz "redutor 2,56:1" e a ficha se declara estimada. O redutor planetário do G-200 é público: 2,82:1 (2,8235). O motor trabalha a 6000–6500 rpm, com a hélice a 2100–2350 rpm. Com `rpmMax: 7500` e 1/2,56 a hélice da ficha gira a 2930 rpm e a ponta chega a Mach 0,86 (1,9 m); com os números reais ficaria em Mach 0,61–0,69 e a passagem de pá cairia de 146 para 105–117 Hz. Fonte: Wikipedia, "Mistral G-200"; Aero-News, "2004 Year In Review" (2,8235:1); SKF Evolution (hélice a 2100–2200 rpm com o motor acima de 6000).

**F-ROT-09 · incompleto · para o dono decidir (aproximação declarada).** LiquidPiston XTS-210 (`xts210`, `presets.ts:202–208`): o motor real é de **2 tempos**, sobrealimentado (até 1 bar), com 6 queimas por volta do rotor, 19–20 kW a 6500 rpm. A ficha roda o ciclo de 4 tempos do X Mini, aspirado, com `rpmMax: 7500`: a frequência de ignição sai a metade da real na mesma rotação. O texto de `aproximacao` fala só de "diesel feito a centelha" e não avisa disso. Fonte: liquidpiston.com/xts-210-engine-liquidpiston; Power Progress, abril de 2023.

**F-ROT-10 · sugestão · para o dono decidir (aproximação declarada).** LiquidPiston X Mini (`xmini`, `presets.ts:195`): o rótulo diz "3 kW" e a ficha tem `rpmMax: 15000`. O protótipo mediu 2,1 hp no freio (3,5 hp indicados) a 10 000 rpm; "mais de 5 hp a até 15 000 rpm" é a meta do motor maduro. Fonte: Green Car Congress, 19/11/2014; liquidpiston.com/xmini.

**F-ROT-11 · sugestão · para o dono decidir.** Hélice do RQ-7 Shadow (`ar741`, `presets.ts:192`): `D: 0.74` sem fonte. Os 74 cm são a hélice Sensenich do RQ-2 Pioneer (outro avião, outro motor); a única cifra pública que achei para o Shadow é de um modelo de simulação, 24 pol = 0,61 m. Com 0,74 m a ponta chega a Mach 0,89 a 7800 rpm (0,73 com 0,61 m). O motor confere: 208 cm³, 38 hp. Fonte: Wikipedia, "AAI RQ-2 Pioneer"; tensoraerospace.readthedocs.io (modelo do Shadow).

**F-ROT-12 · sugestão · para o dono decidir.** Norton F1 (`norton`, `presets.ts:155`): com `finalDrive: 5.0` a moto chega a 209 km/h no corte de 10 000 rpm em 5ª; a F1 real passava de 230 km/h (MCNews: 233). As relações internas são as da FZR1000, cuja caixa a Norton usou, mas a primária e a final da F1 não são públicas. Um `finalDrive` de 4,5 daria 233 km/h a 10 000 rpm. Fonte: mcnews.com.au, "Norton flew the rotary flag with their F1 JPS"; Bennetts, "Norton F1".

**F-ROT-13 · sugestão · para o dono decidir.** RX-3 (`rx3`, `presets.ts:116`): `finalDrive: 3.9`. As relações da caixa conferem (3,683 / 2,263 / 1,397 / 1,00, tabela da Mazdatrix). Uma tabela do RX7Club para o mercado americano dá 3,70 para o RX-3 de 1972–75 e 3,90 para o RX-2 e o RX-4, mas não consegui abrir a tabela para conferir as colunas, e a ficha é do Savanna japonês. Não conferido de forma conclusiva.

**Conferido e certo nos Rotativos** (sem achado): volume de câmara pela geometria em todos os Wankel (13B 105/15/80 → 654,7 cm³; 12A 572,9; 10A 491,0; KKM 612 497,6; Norton 294,1; AR741 207,9), número de rotores e cilindrada nominal; 13B-REW: 280 cv, 314 N·m, sequencial com troca a 4500 rpm, corte a 8000, janelas laterais com escape periférico; FC Turbo II S5: 200 hp, 9,0:1, 7000 rpm, caixa 3,483 / 2,015 / 1,391 / 1,000 / 0,762 e 4,10; Renesis: admissão e escape laterais, 6 e 4 janelas, 9000 e 7500 rpm; Eunos Cosmo 20B: 3 rotores, 280 cv, 403 N·m, automático 2,784 / 1,544 / 1,000 / 0,694 e 3,909 (a 2ª estava 1,545; corrigida junto, `6892ac0`); R26B: 4 × 654, 700 cv (a ficha usa 522 kW = 700 hp, 1,4% acima dos 515 kW publicados), 608 N·m, três velas, admissão periférica (as relações da caixa do 787B não são públicas: as da ficha foram escolhidas para dar 340 km/h a 8500 rpm); Ro 80: 2 × 497,5, 115 cv a 5500, 162 N·m; Norton: 588 cm³, 95 hp a 9500 rpm, 192 kg; MidWest AE110: 110 hp a 7800 rpm, redutor 2,95:1 (ponta da hélice a Mach 0,69); AE50R: 294 cm³, 41 kW a 7750 rpm; AR741: 208 cm³, 38 hp, hélice impulsora de 2 pás.

### Testes depois das correções

Comparação linha a linha com a linha de base da auditoria (`scratchpad/aud/base/*.log`), feita por `scratchpad/aud/fichas-dr/compara.py`:

| Comando | Resultado | Mudanças de estado |
|---|---|---|
| `teste:diesel` | VALIDAÇÃO DO DIESEL OK · 66 desvios documentados · 255 medidas | 0 |
| `lenta:diesel` | 32 casos, zero apagamentos | 0 |
| `troca:diesel` | o motor volta à lenta depois de cada troca | 0 |
| `teste:rotativo` | 133 medidas: 105 ok, 28 desvios, 0 falhas | 0 |
| `lenta:rotativo` | 32/32 | 0 |
| `typecheck` | sem erros | — |

Valores que se mexeram sem mudar de estado: no Diesel, as bandas de lenta do caminhão (`catc15` + `volvod13`) subiram 0,5–0,7 dB de 400 Hz a 12 kHz com a taxa de 18,1 do Volvo, e as do ônibus e da Ram mudaram 0,1–0,4 dB; nos Rotativos, só o 0–100 km/h do Ro 80 (12,2 → 12,4 s). As medidas de CPU oscilaram com a carga da máquina: o `r26b` do `teste:rotativo` deu 13,6% do tempo real na linha de base e 18,7% e 41,7% nas minhas duas rodadas, com outros testes em paralelo, contra um portão de 45%.

Para a frente de documentação: `docs/DIESEL.md` 6.2 e `docs/ROTATIVO.md` 6.2 ainda trazem os valores antigos das fichas corrigidas aqui (rótulos, câmbios, torque da Ram e do ISL9, taxa do Volvo, diâmetro do 6V92, "rotor 3 pás" do S-100, admissão "lateral4" do Ro 80, a 5ª "0,806" do FD).

### Tabela das 33 fichas

| id | Veículo | Veredito | Uma frase |
|---|---|---|---|
| `hilux28` | Toyota Hilux 2.8 1GD-FTV | corrigida | Rótulo 2016 → 2020 (150 kW e 500 N·m são da reestilização); motor e câmbio conferem. |
| `ranger32` | Ford Ranger 3.2 Duratorq | ok | 3198 cm³, 147 kW, 470 N·m, 6R80 e 3,73 conferem. |
| `ram67` | Ram 2500 6.7 Cummins | corrigida | Torque era o da 3500 com Aisin (1152); o da 2500 com 68RFE é 1085 N·m. |
| `duramax66` | Silverado 2500HD L5P | corrigida | 5ª e 6ª da Allison 10L1000 (1,48 e 1,26). |
| `psd73` | Ford F-250 7.3 Power Stroke | corrigida | Rótulo 1999 → 2001 (250 hp); torque 678 → 685 N·m fica para a etapa de som. |
| `om617` | Mercedes 300D W123 | ok | 3005 cm³, 59 kW, 21:1, pré-câmara; a caixa é a 722.3 (o DIESEL.md a chama de 722.1). |
| `tdi19` | VW Golf IV 1.9 TDI ALH | ok | 66 kW, 210 N·m, VP37, 02J com 3,389: tudo confere. |
| `f1000mwm` | Ford F-1000 MWM D229-4 | pendente | Sem ano: os números são da versão dos anos 1990 (a de 1979–89 tinha 83 cv e 4 marchas). |
| `scaniav8` | Scania R500 V8 | corrigida | Código do motor DC16.03 → DC16 04; GRS905 e 3,08 conferem. |
| `volvod13` | Volvo FH D13A 480 | corrigida | Taxa de compressão 17,0 → 18,1 (ficha da Volvo); I-Shift confere. |
| `catc15` | Cat C-15 6NZ | pendente | Cilindrada e curso são do C15 ACERT (15,2 L, 171 mm); o 6NZ tem 14,6 L e 165 mm: para a etapa de som. |
| `onibusisl` | Ônibus Cummins ISL9 280 | corrigida | Torque 1017 → 1220 N·m e 206 → 209 kW; rotação governada (2200) fica para a etapa de som. |
| `dd6v92` | Detroit 6V92TA (MCI MC-9) | corrigida | HT-740 (2,02 e 1,38) corrigida; diâmetro 123,8 → 123 mm; diferencial 4,11 sem fonte. |
| `gen500` | Gerador Cummins QSX15-G8 | ok | 15 L, 137 × 169, 1800 rpm, 4 polos, 60 Hz, 400 kWe. |
| `emd710` | EMD SD70ACe 16-710G3C-T2 | ok | 2 tempos, 45°, 186 L, 904 rpm, notches conferem; no portador a buzina tem uma nota errada e a roda é a da GE. |
| `ge7fdl` | GE C30-7 7FDL-16 | ok | 4 tempos, 45°, 175 L, 12,7:1, 1050 rpm; potência é a de tração (a da EMD é a bruta); rotações intermediárias por notch não conferidas. |
| `rx7fd` | Mazda RX-7 FD 13B-REW | pendente | Rótulo corrigido (cv); a 5ª de 0,761 com diferencial 4,1 é do FC, não de um FD (F-ROT-06). |
| `rx7fc` | Mazda RX-7 FC 13B-T S5 | ok | 200 hp, 7000 rpm, caixa e diferencial conferem. |
| `rx3` | Mazda RX-3 12A | ok | Caixa confere; diferencial 3,9 não conferido de forma conclusiva. |
| `rx8hp` | Mazda RX-8 Renesis 6 janelas | corrigida | Rótulo 231 hp → 231 cv; motor e caixa conferem com a ficha da Mazda. |
| `rx8std` | Mazda RX-8 Renesis 4 janelas | corrigida | Caixa de 5 marchas da ficha da Mazda; torque 220 N·m. |
| `cosmo20b` | Eunos Cosmo 20B-REW | corrigida | 2ª 1,545 → 1,544 (catálogo); o resto confere. |
| `r26b` | Mazda 787B R26B | ok | Motor confere; relações da caixa são escolhidas (não há ficha pública). |
| `ro80` | NSU Ro 80 KKM 612 | corrigida, pendente | Câmbio e diferencial corrigidos; a admissão periférica fica para a etapa de som. |
| `norton` | Norton F1 / Commander | ok | Motor confere; a relação final dá 209 km/h no corte, a moto real passava de 230. |
| `cosmo110s` | Mazda Cosmo 110S 10A | corrigida | Caixa do L10A; família renomeada. |
| `mistral` | Mistral G-200 | pendente | Aproximação declarada; o redutor real é 2,82:1 e a rotação 6000–6500 rpm. |
| `ae110` | MidWest AE110 | ok | 110 hp a 7800 rpm, 2,95:1. |
| `ae50r` | Austro AE50R (Camcopter S-100) | corrigida | Rotor principal de 2 pás. |
| `ar741` | UEL AR741 (RQ-7 Shadow) | ok | Motor confere; diâmetro da hélice sem fonte. |
| `xmini` | LiquidPiston X Mini | pendente | Aproximação declarada; potência e rotação da ficha são metas, não o medido. |
| `xts210` | LiquidPiston XTS-210 | pendente | Aproximação declarada; o motor real é de 2 tempos sobrealimentado. |
| `palhetas` | Motor pneumático de palhetas | ok | Aproximação declarada, sem ficha real a conferir; o hospedeiro do arranque (Cat C15, 3 eventos por volta, lenta 600) confere. |

## Fichas: Vapor e Elétrico

Conferidas as 14 fichas de `src/engines/vapor/presets.ts` e as 18 de `src/engines/eletrico/presets.ts` (mais o motor dianteiro do Model 3) contra as máquinas reais, e lidos os portadores que usam esses dados (`src/carriers/locomotiva-vapor.ts`, `portadores-vapor.ts`, `trator.ts`, `barco.ts`, `carro-direto.ts`, `carro-eletrico.ts`, `trem.ts`, `multirrotor.ts`; não editados). Correções em quatro commits no branch `worktree-agent-aa9a7308ac5c57328` (base `745e183`). Os campos marcados "≈" no `VAPOR.md`/`ELETRICO.md` ou listados em `aprox` não foram alterados: entram como "para o dono decidir" ou "para a etapa de som", já com o valor real quando o achei.

Portões depois das correções (máquina com carga média ~25): `teste:vapor` 125 medidas, 98 ok, 27 desvios, 0 falhas; `lenta:vapor` 14/14; `teste:eletrico` 94 medidas, 92 ok, 2 desvios, 0 falhas; `lenta:eletrico` 18/18; `typecheck` limpo. Nenhuma medida que não seja de CPU mudou de estado (comparação linha a linha com a saída de antes). Com a máquina ocupada (carga ~60) as medidas de CPU oscilam sozinhas, sem relação com as fichas: no Vapor a do Big Boy alterna entre "ok" e "desvio" (por isso 97/28 ou 98/27) e a da UP 844 chegou a falhar (0,35 contra < 1/3); no Elétrico falharam "CPU de 200 linhas" (4,1–7,4 % contra < 3 %), "motor do N700" (6,4 % contra ≤ 5 %) e "N700 no túnel" (52 % do quantum contra < 40 %).

### Vapor

**F-VAP-01 · erro · corrigido neste trabalho [`e71b626`].** `tender.eixos` trazia o número de **rodas** em sete fichas, mas o portador o lê como número de **eixos**: `src/carriers/locomotiva-vapor.ts:127` põe `eixos / 2` eixos em cada um dos dois truques do tênder e soma `10·log10` ao `L_W` do rolamento. UP 844 e Big Boy tinham 14 (o tênder "centipede" 4-10-0 tem 14 rodas, 7 eixos), Y6b 12 (6), K4s e A4 8 (4), King 6 (3), D51 6 (4: dois truques de 2 eixos). O rolamento do tênder saía 3 dB alto (D51 1,8 dB). Agora `src/engines/vapor/presets.ts:64, 73, 83, 92, 102, 116, 156` (e um comentário no tipo, linha 26). Efeito medido no `teste:vapor`: "drifting a 60 km/h: rolamento contra a chaminé" +16,2 → +15,1 dB (ok antes e depois); "vagões contra a locomotiva" −9,7 → −9,6 dB (desvio antes e depois). A Maria Fumaça (`eixos: 4`, coerente com dois truques de 2 eixos) não foi tocada. Fonte do tênder de 14 rodas: https://en.wikipedia.org/wiki/Union_Pacific_FEF_series

**F-VAP-02 · erro · corrigido neste trabalho [`33cbefe`].** Y6b com massa aderente igual à massa total (`massa: 275, massaAderente: 275`), como se a 2-8-8-2 não tivesse eixos guia e de arrasto. Ficha da N&W: 611 520 lb (277 t) em ordem de marcha, 548 500 lb (249 t) sobre as motrizes; tênder carregado 378 600 lb (172 t; a ficha tinha 160). Agora `presets.ts:116`. Só dinâmica (carga do trem e limite de patinagem, `src/engines/vapor/dsp.ts:265` e `:434`): no `lenta:vapor` a arrancada da Y6b em 20 s vai de 35,2 para 31,2 km/h. Fontes: https://www.steamlocomotive.com/locobase.php?country=USA&wheel=2-8-8-2&railroad=nw e https://en.wikipedia.org/wiki/Norfolk_and_Western_2156

**F-VAP-03 · erro · corrigido neste trabalho [`33cbefe`].** Stanley 735 com 1,2 t. O 735 de turismo com condensador pesa 3 650–3 900 lb (Stanley Register, carros de 1919) e 3 850 lb no exemplar de 1918 do museu de Auburn Heights: 1,75 t (aderente 1,0 t, na mesma proporção). Agora `presets.ts:185`. Só dinâmica (`src/carriers/carro-direto.ts:16`). Ficam com o valor antigo, fora do que eu podia editar: `docs/VAPOR.md:201` e `:499` e o comentário de `src/carriers/carro-direto.ts:3` ("Massa 1,2 t"). Fontes: http://www.stanleyregister.net/1919.html e https://auburnheights.org/automobile/1918-stanley-touring-model-735/

**F-VAP-04 · erro · para a etapa de som.** Composição comprida demais em cinco locomotivas. `geometria.comprimento` é a locomotiva sem o tênder (`docs/VAPOR.md:407`) e `tender.comprimento` soma por cima (`locomotiva-vapor.ts:92–94`). Comparado ao comprimento total real sobre os engates:

| Ficha | Loco + tênder na ficha | Real | Excesso | Observação |
|---|---|---|---|---|
| `a4` (`presets.ts:73, 77`) | 21,5 + 9 = 30,5 m | 21,65 m | +41 % | os 21,5 m da "locomotiva" são o total com o tênder |
| `k4s` (`:64, 67`) | 18,5 + 16 = 34,5 m | 25,45 m | +36 % | |
| `up844` (`:92, 96`) | 21 + 20 = 41 m | 34,81 m | +18 % | o que sobra é o tênder (~14,5 m real) |
| `bigboy` (`:102, 105`) | 26,5 + 21 = 47,5 m | 40,47 m (locomotiva 25,99 m) | +17 % | locomotiva certa; tênder real 14,5 m |
| `y6b` (`:116, 119`) | 25 + 16 = 41 m | 35,01 m | +17 % | |

D51 (19,8 contra 19,73 m) e King (21 contra 20,78 m) estão certas. Não corrigi porque é geometria da cena: encurtar o corpo muda a posição das fontes e a sombra, e na A4 `xCilindros: 8` e `xChamine: 7,4` ficam fora de um corpo de ~13 m e têm de ser refeitos juntos. O próprio texto do desvio em `tools/vapor-valida.ts:33` usa esses números ("o tênder de 8 eixos em 34 m"): os 34 m são o K4s esticado, e os 8 eixos eram as rodas de F-VAP-01 (o texto ficou desatualizado; a medida segue em desvio, −9,6 dB). Fontes: https://en.wikipedia.org/wiki/LNER_Class_A4 · https://en.wikipedia.org/wiki/Pennsylvania_Railroad_class_K4 · https://en.wikipedia.org/wiki/Union_Pacific_FEF_series · https://en.wikipedia.org/wiki/Union_Pacific_Big_Boy · https://en.wikipedia.org/wiki/Norfolk_and_Western_2156

**F-VAP-05 · erro · para o dono decidir (valor "≈").** Apito da Y6b: `apito: { tubos: [196, 233, 294], tipo: 'chime' }` (`presets.ts:118`), e o `VAPOR.md` o descreve como "3-chime N&W hooter". O "hooter" da N&W é de **uma nota só** (apito de sino longo de 12 polegadas, das classes de carga A, Y, K-1, M, S, Z); o de três notas (Hancock) era das de passageiros J e K-2. Não achei a frequência medida do hooter. Fontes (fóruns e gravação, sem documento primário): https://forum.trains.com/t/n-w-steam-locomotive-whistle-manufacturers/222734 · https://www.youtube.com/watch?v=yN-fqmFFZuM

**F-VAP-06 · erro · para o dono decidir (valor "≈").** Apito do Big Boy: seis tubos `[294, 349, 392, 440, 523, 587]` (`presets.ts:104`), descritos no `VAPOR.md` como "6-chime, acorde Nathan". A 4014 leva o mesmo apito da 844, um Hancock de sino longo de **três** notas ("steamboat"); o acorde da 844 já está medido no projeto (281 · 344 · 408/420 Hz, `presets.ts:94–95`). Fontes: https://en.wikipedia.org/wiki/Union_Pacific_Big_Boy · https://www.american-rails.com/844.html

**F-VAP-07 · erro · para o dono decidir (valor "≈").** Apito do K4s: uma nota "banshee" de 520 Hz (`presets.ts:66`). Na PRR o banshee de uma nota era das classes de carga (H, I1, L1, N); as de passageiros, o K4s entre elas, saíam de fábrica com o apito de três notas (acorde Mi–Sol–Si, tríade menor). Fontes (sociedade histórica e fóruns): https://www.tapatalk.com/groups/prrthsdiscussionweb30239/whistles-on-pennsy-heavy-steam-t2559.html · https://www.columbusrailroads.com/K4%20at%20Brielle.htm

**F-VAP-08 · erro · para a etapa de som.** Bomba de ar Westinghouse nas três inglesas: `bombaAr: BOMBA1` em `a4` (`presets.ts:76`), `pannier` (`:146`) e `king` (`:158`). A A4 tem freio a vácuo; só as 60007, 60009 e 60019 preservadas receberam freio a ar, a Mallard não (https://en.wikipedia.org/wiki/LNER_Class_A4). Parada, uma A4 não faz o "tum-psh" da bomba (`bomba.ar`, 70 cursos/min): o que soa é o ejetor de vácuo, que o `VaporDSP` não tem. Nas duas da GWR vale o mesmo motivo (a GWR freava a vácuo), mas não conferi em fonte se a 6024 preservada recebeu freio a ar para a linha principal. Tirar o campo é uma linha por ficha, mas deixa a máquina parada mais muda que a real enquanto não houver ejetor: por isso fica para a etapa de som.

**F-VAP-09 · sugestão · para o dono decidir.** O Big Boy se chama "UP 4014", que é da primeira série (4884-1: locomotiva 762 000 lb = 345,6 t, tênder 427 500 lb = 193,9 t), mas a ficha traz os números da segunda (350 t e 198 t, `presets.ts:102`). Diferença de 1–2 %, só dinâmica. Fonte: https://en.wikipedia.org/wiki/Union_Pacific_Big_Boy

**F-VAP-10 · incompleto · para o dono decidir.** Maria Fumaça (`presets.ts:132–140`): ficha inteira por classe, como a `nota` dela diz (17" × 22", roda de 44", 180 psi, 55/48/30 t, apito 480 Hz, sino 700 Hz: tudo "≈"). Um dado novo para a decisão: a `nota` cita a nº 505 da VFCJ, mas a galeria do acervo de Campinas a descreve como uma 2-8-2 Mikado da L. Schwartzkopff de 1927, e as Baldwin que aparecem lá são 4-6-0 (nº 215, de 1912, ex-E. F. Oeste de Minas; nº 604, de 1895). Pode não existir uma "Baldwin 2-8-0" na frota que o preset evoca. Fonte secundária (página de turismo, não o cadastro da ABPF): https://www.campinasvirtual.com.br/abpf.html

**F-VAP-11 · sugestão · para o dono decidir.** "Corliss de moinho (1 cil., ≈ 1 000 hp)" (`presets.ts:163`): "moinho" é tradução literal de *mill engine*, que é a máquina de uma fábrica (tecelagem), não de um moinho; e o nome anuncia ≈ 1 000 hp com `potenciaGerador: 550` kW (740 hp, `:165`). O termo aparece também no README e no `VAPOR.md`.

### Elétrico

**F-ELE-01 · erro · corrigido neste trabalho [`1326347`].** A CPTM Série 9000 estava como "CAF" (`tag` e `nome`). É da Alstom (família Metropolis, fábrica da Lapa, tração ONIX 233 XHP), e a gravação usada como alvo (`u3oip0ZNLeU`) chama-se "Sons do Série 9000 CPTM". Agora `src/engines/eletrico/presets.ts:158`. Continuam dizendo "CAF": `docs/ELETRICO.md:145` e a linha 9 da tabela da seção 5 (fora do que eu podia editar). Fontes: https://pt.wikipedia.org/wiki/TUE_S%C3%A9rie_9000_(CPTM) · https://en.wikipedia.org/wiki/CPTM_Series_9000

**F-ELE-02 · erro · corrigido neste trabalho [`1326347`]; o dono confirma a escolha.** "Alstom Metropolis (Frota I, Metrô SP)" juntava duas frotas. A Frota I é a Frota A de 1974 (Mafersa/Budd) modernizada pelo consórcio Modertren (Alstom e Siemens); o trem novo da Alstom sobre a plataforma Metropolis, com o mesmo ONIX 172 MP, é a Frota G. Troquei "Frota I" por "Frota G" no `tag` e no `nome` (`presets.ts:175`), que é a correção que mantém o `id` `metropolis`, o rótulo do teste (`tools/eletrico/valida.ts:134`) e o texto da Passagem ("Metropolis · freio elétrico"). A alternativa é chamar o preset de "Metrô SP Frota I (Frota A modernizada)". O `ELETRICO.md` (seção 5, linha 10) ainda diz Frota I. Fontes: https://pt.wikipedia.org/wiki/Frota_do_Metropolitano_de_S%C3%A3o_Paulo · https://pt.wikipedia.org/wiki/Frota_G_do_Metr%C3%B4_de_S%C3%A3o_Paulo · https://en.wikipedia.org/wiki/S%C3%A3o_Paulo_Metro_G_stock

**F-ELE-03 · erro · para a etapa de som (mexe em alvo de teste).** Potência e número de motores do Metropolis: a ficha tem 16 motores de 150 kW (`Pmax: 150000`, `carrosMotores: [1, 2, 5, 6]`, `presets.ts:176, 183`), e o próprio `aprox` (`:181`) registra que a potência foi baixada de 190 para 150 kW "para o 0–80 km/h sair em 36 ± 4 s". As Frotas G e I têm motores Alstom 4EXA 1828 A de **180 kW** em todos os seis carros (Bo′Bo′ cada um: **24 motores**, 4 320 kW). O alvo de 36 s não vem de medida: é a conta do plano (`docs/ELETRICO.md:333`: "1,0 m/s² até 40 km/h, depois potência constante"), que equivale a 2 670 kW no trem de 240 t. Com a potência real o 0–80 fica perto de 24 s (conta minha: 1,0 m/s² até 65 km/h, depois potência constante). A ficha foi dobrada para caber no alvo; o que está errado é o alvo. Fontes: as de F-ELE-02.

**F-ELE-04 · erro · corrigido neste trabalho [`7d83505`].** Vectron com a roda do Taurus (`rw: 0.575`, `diametroRoda: 1.15`). A roda nova do Vectron tem 1 250 mm (truque SF 4; 1 160 mm no limite de desgaste); a do Taurus tem 1 150 mm, conferida na folha de dados da ÖBB. Agora `rw: 0.625` e `diametroRoda: 1.25` (`presets.ts:122, 124`), com o torque refeito pela regra do cabeçalho do arquivo (300 kN de partida: `Tn` 12 000 → 13 050 N·m) e a rotação de base por `P/Tn` (1 280 → 1 170 rpm, `:115`). Muda o som de forma coerente: a 80 km/h o motor gira a 1 258 rpm em vez de 1 367 (`lenta:eletrico`), 8 % mais grave. A redução (3,7) continua "≈": não achei a relação real. Nenhum teste usa o Vectron além do `lenta`. Fontes: https://assets.new.siemens.com/siemens/assets/api/uuid:3cf0c090-d549-431f-bebb-254f012e3057/01-mobility-datasheet-bogies-sf4-de-mors-b10023-00-144_original.pdf · https://de.wikipedia.org/wiki/Siemens_Vectron · https://produktion.oebb.at/dam/jcr:47dbe927-74ea-47fd-abc2-253c45498ac1/1116.pdf

**F-ELE-05 · erro · corrigido neste trabalho [`7d83505`].** Fórmula E Gen3 com 854 kg; o mínimo com piloto é 840 kg (760 + 80). Agora `presets.ts:86`. Só dinâmica: arrancada do `lenta` em 62,4 km/h em vez de 61,4. O `ELETRICO.md` (seção 5, linha 4) ainda diz 854. Fontes: https://www.fiaformulae.com/en/news/2022/april/gen3-facts · https://en.wikipedia.org/wiki/Formula_E_Gen3

**F-ELE-06 · erro · corrigido neste trabalho [`7d83505`].** `vMaxKmh: 100` nas CPTM 9500 e 9000; as duas têm máxima de 90 km/h. Agora `presets.ts:149, 166`. O campo é informativo: limita o controle de velocidade da página (`src/pages/eletrico/controle.ts:117`) e o cruzeiro do `lenta:eletrico`, que passou de 60 para 54 km/h nesses dois. Fontes: https://pt.wikipedia.org/wiki/TUE_S%C3%A9rie_9500_(CPTM) · https://pt.wikipedia.org/wiki/TUE_S%C3%A9rie_9000_(CPTM)

**F-ELE-07 · erro · para a etapa de som.** Potência dos motores da CPTM: 9500 com `Pmax: 210000` (`presets.ts:143`) e 9000 com `Pmax: 200000` (`:159`). Reais: 9500, 4 320 kW em 16 motores Hyundai Rotem HRTM-IFS-270A (270 kW cada); 9000, 4 400 kW em 16 motores Alstom 4ECA2142B (275 kW cada). O `ELETRICO.md` marca os dois como "≈", mas nos presets `Pmax` não está em `aprox`. Não corrigi porque `rpmBase` é `P/Tn` e mexe na condição da calibração de nível (`src/engines/eletrico/motor.ts:22`) e no índice de modulação (`src/engines/eletrico/dsp.ts:305`), e os dois presets têm alvos de gravação no `teste:eletrico`. Fontes: as de F-ELE-06.

**F-ELE-08 · erro · para o dono decidir (valores "≈").** Frota A do Metrô de SP: a ficha tem quatro carros motores em seis e 130 kW por motor (`carrosMotores: [1, 3, 4, 6]`, `Pmax: 130000`, `presets.ts:129, 136`). Na Frota A original os seis carros são motores, com quatro motores de 110 kW nominais cada (24 motores), e a máxima é 100 km/h (ficha: 90). Fonte: https://pt.wikipedia.org/wiki/Frota_A_do_Metr%C3%B4_de_S%C3%A3o_Paulo (a potência total que a mesma página dá, 1 224 kW, não fecha com 24 × 110).

**F-ELE-09 · erro · para a etapa de som (valor em `aprox`).** Redução do Leaf: `[{ Zp: 16, Zc: 44 }, { Zp: 17, Zc: 51 }]` = 8,25 (`presets.ts:60`). A caixa RE1F61B tem 17:32 e 17:74 = 8,1938. Com os dentes reais o engrenamento do 1º estágio fica em 17·f_rot (não 16) e o do 2º em 9,03·f_rot (não 6,18): são as linhas do "uivo" da redução. Fontes (manual de serviço citado em fórum e wiki): https://mynissanleaf.com/threads/reduction-gear-ratio-swap.31022/ · https://www.electricvehiclewiki.com/drivetrain-d1/

**F-ELE-10 · dívida · para o dono decidir (valores em `aprox`).** Fórmula E: a redução de 4,0 e a rotação máxima de 20 000 rpm não fecham entre si (`presets.ts:78, 81, 84`). Com `i` 4,0 e `rw` 0,335 os 322 km/h dão 10 200 rpm; a 20 000 rpm o carro estaria a 631 km/h. Ou a redução é ~7,8 ou a rotação máxima é ~10 000. Não achei a relação real (a Wikipedia só dá 19 500 rpm para o motor dianteiro).

**F-ELE-11 · dívida · para a etapa de som.** Model 3: `rpmBase: 6000` nos dois motores (`presets.ts:36, 47`), mas `Pmax/Tn` dá 5 093 rpm no traseiro e 4 456 no dianteiro. Nas outras 16 fichas `rpmBase` é `Pmax/Tn` (conferi todas, ±1 %). O joelho de torque (`src/engines/eletrico/maquina.ts:51`) e a base da modulação e da calibração (`dsp.ts:305`, `motor.ts:22`) ficam em rotações diferentes só neste preset.

**F-ELE-12 · incompleto · para o dono decidir.** Motor industrial em 50 Hz (`fRede: 50`, `tag` "rede 50 Hz", `presets.ts:288–289`: 1 460 rpm, zumbido de 100 Hz). No Brasil a rede é de 60 Hz (4 polos a ~1 760 rpm, zumbido de 120 Hz). O `ELETRICO.md` (seção 5, linha 18) promete "50 Hz (chave 60 Hz)" e "1460/1760 rpm", mas a chave não existe: `fRede` só aparece no preset e no DSP (`maquina.ts:43, 72, 134`), não há controle na página.

**F-ELE-13 · sugestão · para a etapa de som.** Coeficiente de torque da hélice do Mavic: `cQ: 0.012` (`presets.ts:284`, usado em `src/carriers/multirrotor.ts:36`) dá 0,066 N·m e 43 W por rotor no pairado medido (6 270 rpm), 172 W nos quatro. A bateria de 43,6 Wh dura cerca de 24 min pairando: ~109 W elétricos no total (conta minha a partir da ficha da DJI, que cito de memória). O motor trabalha a 44 % de `Tn` no modelo quando deveria estar perto de 25 %. O resto da ficha fecha: 12N14P dá `p` 7; hélice de 8,3" = 0,21 m, 2 pás; 734 g; e a linha medida em 6 602 Hz é 63,2·f_rot = 9·f_e, como diz o texto da Passagem.

### Fora do meu escopo, vistos de passagem

- Há duas classes `FontePneu` com espectro e nível diferentes: `src/carriers/carro-direto.ts:19` (92 dB(A) por roda, passa-banda em 800 Hz·√v) e `src/carriers/carro-eletrico.ts:28` (95 dB(A), passa-banda fixo em 1 kHz).
- O README (linha 81) ainda lista "BYD Dolphin"; o preset passou a se chamar "BYD Dolphin Plus".

### Todas as 32 fichas

| `id` | Máquina | Veredito | Uma frase |
|---|---|---|---|
| `k4s` | PRR K4s, Pacific 4-6-2 | corrigida, com pendência | Cilindros, rodas, pressão e massas batem; eixos do tênder corrigidos; apito (F-VAP-07) e comprimento (F-VAP-04) pendentes. |
| `a4` | LNER A4 Mallard | corrigida, com pendência | 3 × 18,5" × 26", 80", 250 psi e 104,6 t batem; eixos corrigidos; comprimento (F-VAP-04) e bomba de ar (F-VAP-08) pendentes. |
| `d51` | JNR D51 498 | corrigida | 550 × 660 mm, 1 400 mm, 14 kgf/cm², 78 t e tênder de 47 t batem; apito medido; eixos do tênder corrigidos. |
| `up844` | UP 844 (FEF-3) | corrigida, com pendência | 25" × 32", 80", 300 psi e 220,6 t batem; eixos corrigidos; tênder 5,5 m comprido demais (F-VAP-04). |
| `bigboy` | UP 4014 Big Boy | corrigida, com pendência | 4 × 23,75" × 32", 68", 300 psi e 245 t aderentes batem; eixos corrigidos; apito (F-VAP-06), tênder (F-VAP-04) e massas da 2ª série (F-VAP-09) pendentes. |
| `y6b` | N&W Y6b, Mallet composta | corrigida, com pendência | AP 25", BP 39", curso 32", 58" e 300 psi batem; massas e eixos corrigidos; apito (F-VAP-05) e comprimento (F-VAP-04) pendentes. |
| `shay` | Shay classe C de 70 t (Lima) | ok | 3 × 12" × 15", rodas de 36", 200 psi e 64 t batem; a redução de 2,6 e o apito não têm fonte conferida. |
| `maria_fumaca` | Baldwin 2-8-0 métrica | pendente | Ficha por classe, toda "≈"; a nº 505 citada pode não ser Baldwin nem 2-8-0 (F-VAP-10). |
| `pannier` | GWR 57xx 0-6-0PT | ok, com pendência | 17,5" × 24" internos, 4' 7½", 200 psi e 50 t batem; bomba de ar pendente (F-VAP-08). |
| `king` | GWR King 6024 | corrigida, com pendência | 4 × 16,25" × 28", 6' 6", 250 psi e 91 t batem; eixos corrigidos; bomba de ar pendente (F-VAP-08). |
| `corliss` | Corliss de fábrica, 1 cilindro | pendente | Máquina genérica ("≈"); nome e potência anunciada não fecham com os 550 kW (F-VAP-11). |
| `aveling` | Aveling & Porter 8 nhp | pendente | Não achei fonte para o cilindro de 8" × 10" nem para a nº 11630; a lenta de 70–80 rpm é medida no projeto. |
| `stanley` | Stanley 735 (1920) | corrigida | 2 × 4" × 5", engrenagem 40:60, 600 psi e roda de 35" batem; massa corrigida para 1,75 t. |
| `vapor_pas` | Vapor de rodas de pás | ok | Genérico e coerente: 44 rpm nas rodas a 25 km/h com 25 % de escorregamento. |
| `model3` (+ dianteiro) | Tesla Model 3 LR AWD | ok, com pendência | 6 polos e 54 ranhuras atrás, indução 60/74 na frente, 9,06:1, 1 850 kg e 233 km/h batem; `rpmBase` pendente (F-ELE-11). |
| `leaf` | Nissan Leaf ZE1 | pendente | 8 polos, 48 ranhuras, 110 kW, 320 N·m e 10 500 rpm batem; dentes da redução errados (F-ELE-09). |
| `dolphin` | BYD Dolphin Plus | corrigida | 150 kW, 310 N·m, 160 km/h e 1 660 kg são do Dolphin Plus: nome corrigido; polos, ranhuras e redução seguem "≈". |
| `formulae` | Fórmula E Gen3 | corrigida, com pendência | 350 kW e 322 km/h batem; massa corrigida para 840 kg; redução e rotação máxima não fecham (F-ELE-10). |
| `taurus` | Siemens Taurus ES64U2 | ok | 4 × 1 600 kW, 300 kN, 230 km/h e roda de 1 150 mm batem; GTO em escada medido; redução e polos "≈". |
| `vectron` | Siemens Vectron AC | corrigida | 6 400 kW, 300 kN e 200 km/h batem; roda corrigida para 1 250 mm, com `Tn` e base refeitos. |
| `frotaa` | Metrô SP Frota A (chopper) | pendente | Chopper e roda de 0,86 m batem; a real tem 24 motores de 110 kW, a ficha 16 de 130 kW (F-ELE-08). |
| `cptm9500` | CPTM 9500 (Hyundai Rotem) | corrigida, com pendência | Fabricante e ordens medidas batem; máxima corrigida para 90 km/h; potência real 270 kW por motor (F-ELE-07). |
| `cptm9000` | CPTM 9000 (Alstom) | corrigida, com pendência | Fabricante corrigido (era CAF) e máxima para 90 km/h; potência real 275 kW por motor (F-ELE-07). |
| `metropolis` | Alstom Metropolis, Frota G | corrigida, com pendência | Rótulo corrigido (Frota I → G); a real tem 24 motores de 180 kW, a ficha 16 de 150 kW para caber no alvo (F-ELE-03). |
| `n700` | Shinkansen N700 | ok | 305 kW por motor, 81:29 = 2,79, roda de 860 mm e 300 km/h (5 170 rpm) batem; variante de 10 carros da Passagem declarada. |
| `tgv` | TGV Réseau | ok | 8 motores síncronos de 1 100 kW, 384 t e 320 km/h (4 240 rpm) batem; redução e polos "≈". |
| `flexity` | Bonde Bombardier Flexity | ok | Genérico de classe (4 × 120 kW, 5 módulos); portadora da classe medida em bondes Citadis e Urbos. |
| `trolebus` | Trólebus Eletra (CC) | ok | Coerente (18 t, 150 kW, 70 km/h); comutador, redução e chopper são "≈" e não achei fonte. |
| `furadeira` | Furadeira sem fio | ok | Comutador de 12 lâminas e 14 850 rpm medidos; `maquina: 'universal'` é só o modelo de comutador do DSP. |
| `liquidificador` | Liquidificador | ok | Motor universal, 800 W, 22 000 rpm em vazio: valores típicos. |
| `mavic` | DJI Mavic Pro | ok, com pendência | 12N14P, hélice de 0,21 m, 734 g e a linha de 9·f_e fecham; `cQ` alto (F-ELE-13). |
| `industrial` | Motor de indução 11 kW | pendente | 4 polos, 36/28 ranhuras, 1 460 rpm e 72 N·m fecham em 50 Hz; falta a chave de 60 Hz prometida (F-ELE-12). |

## Ferramenta de auditoria das fichas (`tools/auditoria-fichas.ts`)

Não havia ferramenta de câmbio no repositório (as de `tools/` são de som, lenta e paridade). Esta é nova: faz a conta mecânica de todos os 194 presets e marca o que foge de faixas plausíveis. É a parte mecânica da frente 1; a conferência contra o veículo real está nas seções de fichas acima.

### Como usar

```sh
npm run auditoria:fichas                          # todas as famílias, texto alinhado
npm run auditoria:fichas -- diesel                # uma família: ronco, diesel, radial, rotativo, vapor, eletrico, turbina
npm run auditoria:fichas -- --md                  # tabelas em Markdown
npm run auditoria:fichas -- --so-alertas          # só as linhas com alerta
```

Roda em ~2 s, não renderiza áudio e sai sempre com código 0: é relatório, não portão.

### O que ela calcula e de onde vêm as convenções

A conta usa as funções do próprio código, não uma convenção de manual:

- **Câmbio** (Ronco, Diesel rodoviário, Sherman/Monaco-Trossi/Megola, rotativos de rua): como em `EngineDSP.tune()` e `vehOmega()`. `ratios` só vale se tiver `gears` relações (senão o DSP usa `gearRatios(gears)`); `finalDrive` ausente vira `defaultFinal(redline)`; massa, raio e arrasto ausentes viram 850 + 160·L kg, 0,33 m e 0,42; rolagem 0,012·m·g. Conferido contra o `EngineDSP` de verdade em Mustang, Fusca, R1 e Buick: velocidade por marcha no corte e rpm a 100 km/h saem idênticas.
- **Hélices**: `configHelice()` (`src/engines/ronco/aviacao.ts`) e `machPonta()`. **Rotores**: `configRotor()` + `CargaRotor.potencias()` com o coletivo em 0,75.
- **Vapor**: `escapesPorVolta()`, `eixosRodeiro()` e o esforço de tração do `VaporDSP` (0,85·p·d²·curso/D por par de cilindros).
- **Elétrico**: redução Π Zc/Zp, T = min(Tn, Pmax/ω) por motor, aderência 0,75 e massa equivalente 1,06·m (`CarroEletrico`); número de motores, Davis e a₀ como em `TracaoTrem`.
- **Turbina**: a parte tangencial do `Mt` de `JetDSP.sources()` (π·D·N1/60/340) e o `Mh` da hélice.
- **Diesel, além do câmbio**: cilindrada pela geometria, PME, torque na rotação de potência, velocidade do pistão, rotação síncrona do gerador, rpm e kW por notch.

O que **não** vem do código fica em constantes nomeadas no topo do arquivo, cada uma com o motivo: a curva de potência das estimativas (polinômio empírico, pico a 90 % do corte; no Diesel, em `rpmPotencia`), a aderência por tipo de veículo, as velocidades de cruzeiro das aeronaves (os presets não têm velocidade) e as faixas de alerta. A final e o 0–100 são **estimativas** com essa curva, não a curva do DSP.

Três pontos em que a ferramenta sai do pedido, de propósito:

1. **Pá que avança no cruzeiro: limite 0,85, não 0,75.** O R44 de verdade (215 m/s de ponta + 200 km/h) dá Mach 0,79 e o R22 0,76; com 0,75 a ficha certa dava alerta.
2. **Piso de rpm a 100 km/h**: 1100 em vez de 1500 para carro de 5 L ou mais, ou de 8+ marchas (Camaro, Corvette e Mustang de 10 marchas rodam a 1200–1400 de fábrica); nas motos o piso cai a 40 % do corte.
3. **Velocidade periférica do motor elétrico**: a ficha não tem o diâmetro do rotor. No lugar vai a frequência de engrenamento; a ponta da hélice do drone e das facas do liquidificador está na tabela de bancada.

Fora do escopo dela, mas visto na conta: o DSP do Ronco não tem limite de aderência nem perda na transmissão. Refazendo a conta assim, 17 dos 94 veículos com câmbio fazem 0–100 em menos de 2,0 s (F1 V10 em 0,8 s); com aderência por tipo de pneu os mesmos dão 2,2–2,9 s.

### Alertas depois das correções de ficha deste trabalho

Saída de `npm run auditoria:fichas -- --so-alertas` no estado final (as tabelas completas saem com `--md`). Antes das correções eram 41 alertas de faixa em 34 presets; os que sobram são os que ficaram para a etapa de som ou para o dono (Sherman, Fórmula E, turboélices, helicópteros, trens).

```
== Resumo ==
Ronco       78 presets ·  8 com alerta de faixa · 13 só com nota (padrão, relações repetidas) · 26 alertas e notas
Diesel      16 presets ·  4 com alerta de faixa ·  0 só com nota (padrão, relações repetidas) · 5 alertas e notas
Radial      17 presets ·  3 com alerta de faixa ·  0 só com nota (padrão, relações repetidas) · 4 alertas e notas
Rotativos   17 presets ·  1 com alerta de faixa ·  7 só com nota (padrão, relações repetidas) · 8 alertas e notas
Vapor       14 presets ·  0 com alerta de faixa ·  0 só com nota (padrão, relações repetidas) · 0 alertas e notas
Elétrico    18 presets ·  4 com alerta de faixa ·  0 só com nota (padrão, relações repetidas) · 7 alertas e notas
Turbina     34 presets ·  7 com alerta de faixa ·  0 só com nota (padrão, relações repetidas) · 7 alertas e notas

== Alertas mais fortes (25 de 32) ==
  8,0  Radial · r975 (Continental R-975 (M4 Sherman)): última marcha longa: corta a 140 km/h, 2,71× a final pelo arrasto (51)
  6,2  Elétrico · formulae (Fórmula E Gen3): 0–100 em 8,2 s com 2,4 kg/kW (só pela potência seriam 1,0 s): falta torque na roda, a redução é longa
  3,0  Ronco · single (KTM 450 SX-F): rpm a 100 km/h na última 8367 (acima de 7000)
  2,5  Turbina · kingair (Beechcraft King Air 350): gerador de gás: ponta do compressor a 687 m/s, Mach 2,02 (acima de 1,75)
  2,5  Turbina · single (Cessna Caravan): gerador de gás: ponta do compressor a 687 m/s, Mach 2,02 (acima de 1,75)
  2,5  Turbina · pc12 (Pilatus PC-12): gerador de gás: ponta do compressor a 687 m/s, Mach 2,02 (acima de 1,75)
  2,5  Turbina · stucano (Embraer Super Tucano): gerador de gás: ponta do compressor a 687 m/s, Mach 2,02 (acima de 1,75)
  2,5  Elétrico · formulae (Fórmula E Gen3): a 322 km/h o motor está a 10199 rpm, só 51% de rpmMax
  2,4  Elétrico · tgv (TGV Réseau): em nível a potência só leva a 261 km/h, e a ficha diz 320
  2,2  Radial · r975 (Continental R-975 (M4 Sherman)): 1ª no corte 13 km/h (acima de 12)
  2,2  Elétrico · formulae (Fórmula E Gen3): a potência só leva a 256 km/h, e a ficha diz 322
  2,1  Radial · s55 (Sikorsky S-55 / H-19): o pairado pede 497 kW e o motor tem 447
  2,0  Ronco · s300 (Schweizer 300C (Lycoming HIO-360)): o pairado pede 156 kW e o motor tem 142
  2,0  Elétrico · cptm9000 (CPTM Série 9000): 44 ranhuras em 4 polos trifásicos dá q = 3,67 ranhuras por polo e fase (fracionário: incomum em motor de tração)
  1,8  Diesel · f1000mwm (Ford F-1000 MWM 229): 1ª no corte 23 km/h (abaixo de 25)
  1,8  Ronco · r22 (Robinson R22 (Lycoming O-360)): o pairado pede 99 kW e o motor tem 92
  1,7  Turbina · regional (ATR 72-600): gerador de gás: ponta do compressor a 636 m/s, Mach 1,87 (acima de 1,75)
  1,7  Turbina · q400 (Dash 8 Q400): gerador de gás: ponta do compressor a 636 m/s, Mach 1,87 (acima de 1,75)
  1,7  Turbina · c130 (Lockheed C-130J): gerador de gás: ponta do compressor a 636 m/s, Mach 1,87 (acima de 1,75)
  1,6  Ronco · amgone (Mercedes-AMG One): kW/L 350 (acima de 330)
  1,6  Diesel · dd6v92 (Detroit Diesel 6V92TA (MCI MC-9)): câmbio curto: última marcha corta a 96 km/h, 75% da final pelo arrasto (128)
  1,5  Ronco · single (KTM 450 SX-F): nenhuma marcha chega à final pelo arrasto: 137 km/h em 5ª contra 161
  1,5  Elétrico · n700 (Shinkansen N700): em nível a potência só leva a 271 km/h, e a ficha diz 300
  1,4  Diesel · dd6v92 (Detroit Diesel 6V92TA (MCI MC-9)): 1ª no corte 26 km/h (acima de 25)
  1,4  Rotativos · r26b (Mazda 787B R26B): nenhuma marcha chega à final pelo arrasto: 359 km/h em 5ª contra 414

(força = 1 + 10 × o quanto passou da faixa; 8 = erro de estrutura; campos ausentes preenchidos com padrão ficam só nas tabelas)
```

## Compatibilidade motor × portador e presets da Passagem (frente 2)

**Como foi conferido.** Um teste novo, `tools/passagem-presets.ts` (commit `9dc3172`), carrega no Node a classe `ControlePassagem` da própria página (`src/pages/passagem/controle.ts`) e entrega as mensagens dela a um `CenaDSP` (`src/scene/dsp-cena.ts`), o DSP que o worklet `cena` registra: quem monta cada preset é o código da página (`carregarPreset` e `disparar`), em blocos de 128 amostras a 48 kHz. Mede NaN, nível no ouvido (L_AFmax e L_Aeq ponderados A, com a reverberação do ambiente convoluída como o `ConvolverNode` faz), saturação, CPU e o tempo de montagem; confere a tabela de compatibilidade; roda uma sessão com trocas de preset; e, com `--combinacoes`, monta as 197 combinações portador × família × preset de motor que a página habilita, com os padrões do portador. Roteiros de apoio (isolamento de fontes, séries no tempo) em `scratchpad/aud/pass/` (`fontes.ts`, `combo.ts`, `assento.ts`, `enum.ts`, `portadores.ts`).

- `npx tsx tools/passagem-presets.ts` (29 presets e a sequência; ~2 min com 8 processos) · `npx tsx tools/passagem-presets.ts --combinacoes` (mais as 197 combinações; 6 a 10 min). Sai com código ≠ 0 se algo não montar, tiver NaN, ficar inaudível ou estiver fora da tabela de compatibilidade. **Falta acrescentar `"teste:passagem": "tsx tools/passagem-presets.ts"` ao `package.json`** (não editei).
- Resultado de hoje: **29 de 29 presets montam, tocam e não têm NaN; a sequência (29 em fila, 29 trocas no meio da passagem, 9 grupos de 3 trocas seguidas) passa; as 197 combinações montam sem exceção e sem NaN.** 0 falhas; 72 montagens com alerta (13 presets e 59 combinações; em 27 destas o alerta é só de CPU).
- **Escala.** A Passagem é absoluta: amostra 1,0 = 31,7 Pa de pico, 0 dBFS ≙ 124 dB SPL (`src/scene/constantes.ts:9`). O worklet escreve `tanh(pressão × master)` com master 0,8 (`src/scene/dsp-cena.ts:153`), e o compressor da página limita em −1 dBFS. Uma fonte que chegue ao ouvido acima de ~112 dB(A) já entra na curva do `tanh`.
- **Ressalva das medidas de CPU e de tempo.** A máquina esteve com carga média de 40 a 100 em 32 núcleos durante todas as rodadas (outras suítes em paralelo). A coluna de CPU média usa o tempo de CPU do processo, que sofre menos, mas ainda sobe com a disputa; o p99 é de relógio e não vale como referência. Os números servem para ordenar os presets, não como margem. Refazer com `--j 1` numa máquina parada.

### Achados: compatibilidade

**C-01 · erro · corrigido neste trabalho (`35d6f02`).** `USO_REAL.nenhum` listava só `'eletrico'`. O `CENA.md` 1.6 dá a coluna "nenhum (bancada)" como ✓ para todas as famílias, e 73 dos 74 presets de motor que têm o campo `portadores` declaram `'nenhum'` (é como a página de cada família toca o motor). A linha passou a listar todas as famílias com adaptador, com o comentário dizendo que ela não habilita nada na Passagem (que não lista esse portador: `IdPortadorPagina = Exclude<TipoPortador, 'nenhum'>`, `src/pages/passagem/presets.ts:21`). Sem efeito em tempo de execução: nada lê `USO_REAL.nenhum`. Evidência: `scratchpad/aud/pass/portadores.ts` (antes da correção, 73 linhas "fora do USO_REAL").

**C-02 · dívida · corrigido neste trabalho (`35d6f02`).** O comentário de `ADAPTADORES` dizia que o rotor leva "o pistão de aviação ou o radial do S-55", esquecendo o Wankel AE50R do Camcopter S-100, que `USO_REAL.rotor` habilita. Acrescentei também o que `USO_REAL` significa e que é subconjunto de `COMPAT` (o teste novo confere isso, e que todo `MOTOR_PADRAO` passa no filtro de `presetsDoMotor`).

**C-03 · erro · para a pessoa da interface (e o dono decidir a regra).** **Os padrões do portador não acompanham o motor escolhido.** Ao escolher portador, família e preset no modo de testes (`setPortador`, `setMotor`, `setMotorPreset`, `src/pages/passagem/controle.ts:243–288`), a velocidade, a marcha e o ambiente ficam nos de `PADROES` (`controle.ts:55–70`): carro a 108 km/h em 3ª com o pedal no fundo, trem a 350 km/h no túnel, locomotiva a 60 km/h. Com a velocidade imposta e a marcha engatada o motor fica preso às rodas (`src/carriers/carro.ts:58, 61`) e gira o que a conta der, sem corte de giro. Medido (`--combinacoes`):
- carro, 13 combinações acima do corte: Scania R500 a 11 773 rpm (corte 2 100), Volvo FH a 13 261 (2 100), Cat C15 a 11 632 (2 100), ônibus ISL9 a 4 553 (2 300), Detroit 6V92 a 3 185 (2 100), Duramax a 5 033 (3 450), F-1000 MWM a 4 534 (3 000), Ram a 3 756 (3 200), Ranger a 4 160 (4 000), Sherman a 4 492 (2 400), Megola a 5 208 (4 800), Fusca a 5 513 (4 600), moto monocilíndrica `single` a 13 057 (11 500). Os três caminhões passam a 100–103 dB(A), no nível do 787B e do V16;
- trem, 9 de 9 elétricos acima da `vMaxKmh` da própria ficha (`src/engines/eletrico/presets.ts`): Taurus 230, Vectron 200, Frota A 90, CPTM 100, Metropolis 90, N700 300, TGV 320, bonde Flexity 70, todos a 350 km/h. A Frota A dá 131,0 dB(A) (o inversor sozinho, 125,3) e 4,4% das amostras acima do fundo de escala; Taurus, Vectron, CPTM, Metropolis e Flexity saturam 0,8%;
- locomotiva a vapor: a Shay (`vMax: 25`, `src/engines/vapor/presets.ts:122`) a 60 km/h dá 129,7 dB(A) (a chaminé sozinha, 129,6) com 13,7% das amostras saturadas; a Maria Fumaça (`vMax: 50`) também passa do limite. Stanley (100) e trólebus (70) a 108 km/h.
Correção proposta: em `setMotor`/`setMotorPreset`, limitar `vKmh` à velocidade máxima da ficha (`vMax`, `vMaxKmh`) e, no carro, escolher a marcha mais alta que deixe o motor abaixo de ~70% do corte (ou baixar a velocidade); o trem com motor elétrico começar a céu aberto na velocidade de cruzeiro da ficha.

**C-04 · erro · para a etapa de som (portador Rotor) e para o dono.** **Quatro dos seis helicópteros com motor não seguram o rotor.** Com o coletivo padrão (0,75, `controle.ts:85`, que é o pairado com a massa da ficha: `tracao() = massa·g·(0,25 + c)`, `src/carriers/rotor.ts:56`), a potência pedida passa da que o motor entrega e a rotação cai até parar, sem ninguém tocar em nada (`scratchpad/aud/pass/combo.ts rotor:…`, parado):
- **Atualização (integração):** o Bell 47G foi corrigido na ficha (`f641664`: motor, rotor, peso e redução do 47G de verdade) e passou a segurar 344 rpm no pairado; ainda cai 10 % com o coletivo em 0,75 (F-AVI-05). S-55, Camcopter e S300 continuam como descrito.

| Helicóptero | Potência pedida no início | Rotor (rpm) | O que acontece |
|---|---|---|---|
| Bell 47G (Franklin) | 207 kW | 370 → 0 em 12 s | para |
| Sikorsky S-55 (R-1340) | 497 kW | 245 → 0 em 12 s | para |
| Camcopter S-100 (AE50R) | 40 kW | 1 069 → 0 em 14 s | para |
| Schweizer 300C | 156 kW | 471 → 318 em 22 s, caindo | vai parar |
| Robinson R44 | 171 kW | 408 ± 1 | segura |
| Robinson R22 | 99 kW | 530 ± 1 | segura |

Na passagem (10 s depois de montar) o Bell 47 está a 17% da rotação nominal, o S-55 a 55%, o AE50R a 78%, o S300 a 88%. Depois de parado, a telemetria ainda mostra potência (153 kW com Nr = 0) e um torque de carga de 18 233 N·m. Causas a separar na etapa de som: o modelo de potência do rotor (figura de mérito 0,72, `rotor.ts:60`) e as fichas (o Bell 47G com o Franklin de 200 hp tinha peso máximo de 2 350 lb ≈ 1 066 kg; a ficha dá 1 340 kg, que é o dos 47G-3B/G-4 de 260–280 hp; valores de memória, conferir). O preset `heli-rasante` usa o R44 e não é afetado.

**C-05 · erro · para a etapa de som (Vapor).** **O trator a vapor "na polia" (gerador × vapor × Aveling) entra em ciclo-limite.** Em 16 s parado a rotação oscila entre 67 e 112 rpm (alvo 75), a carga liga e desliga (`cargaFracao` 0,5 ↔ 0) e o regulador vai de 0 a 1; a chaminé dá estouros de 109,6 dB(A) a 7,5 m contra 91,7 em regime. O Corliss, no mesmo portador, segura 75–77 rpm a 70–74 dB(A). Configuração em `src/carriers/portadores-vapor.ts:37` (`potenciaGerador: 15`, `rpmGovernado: 75`, `J_alt: 50`), copiada também em `src/pages/vapor/controle.ts:141`. Evidência: `combo.ts gerador:vapor:aveling:16:isolar`.

**C-06 · incompleto · para o dono decidir.** **O portador "carro" tem um corpo só e não tem pneus, vento nem esteira.** `CarroLegado` usa sempre `CORPO_CARRO` (4,6 × 1,85 × 1,4 m, cabine do Ronco; `src/carriers/carro.ts:16–27`) para as 11 motos do Ronco, a Megola, a Norton, os caminhões de 40 t, o ônibus e o Sherman de 30 t; "Pneus e aero ficam desligados: TODO" (`carro.ts:9`). Só o `CarroEletrico` tem corpo de ônibus e pneus. Consequências: a picape a 80 km/h passa sem ruído de pneu; o Sherman passa sem a lagarta (o preset do motor avisa: `aproximacao: 'sem o ruído da esteira'`); o atalho "cabine" numa moto usa a cabine de um carro.

**C-07 · dívida · para o dono decidir.** **O portador "hélice" é sempre um avião de 27 m com um motor no nariz** (`src/carriers/helice.ts:186`; `controle.ts:223`: `posMotor [2,5; 0; 1,5]`, `posCubo [3,3; 0; 1,5]`). Vale para o Cessna 172 (8,3 m), o ultraleve com Verner e o RQ-7 Shadow (3,4 m), cuja legenda diz "hélice impulsora"; o DC-3 (R-1830) e o Trimotor tocam com um motor só. Os turboélices trazem o número de motores no preset da Turbina e não têm esse limite.

**C-08 · sugestão · para o dono decidir.** Combinações que existiram, com o motor já no acervo, e que a página não oferece (nenhuma é erro de tabela; faltam dados no preset):
- diesel × barco: está em `COMPAT.barco`, mas nenhum preset declara `'barco'` (o Detroit 6V92 e o EMD 710 também são motores marítimos);
- diesel × gerador para `dd6v92`, `emd710` e `ge7fdl` (grupos estacionários com esses motores são comuns); diesel × trator (o MWM 229 da F-1000 equipou tratores; `COMPAT.trator` só tem vapor);
- radial × rotor só tem o S-55; o R-1820 (Sikorsky S-58) e o R-985 (Sikorsky H-5) estão no acervo sem dados de rotor;
- **turboeixo: incompleto de verdade.** `COMPAT.rotor` tem `'turboeixo'` e o `CENA.md` 1.6 prometia "✓ etapa 1 (Esquilo/Arriel, UH-60/T700)", mas não há preset nem adaptador (`HELICOPTEROS` em `src/carriers/rotor.ts:41–48` já tem as geometrias do Esquilo, Bell 206, UH-60 e Mi-8). Os helicópteros mais comuns não existem no produto;
- as bancadas (furadeira, liquidificador, motor industrial, motor de palhetas) não entram na Passagem porque o portador `nenhum` não é listado: coerente (nada passa), fica o registro.

**C-09 · dívida (nomes) · só listar.** Três nomes para a bancada: `'nenhum'` (`TipoPortador`), `'bancada'` (`portador.tipo` dos presets elétricos) e `'ferramenta'` (`portadores` do motor de palhetas, `src/engines/rotativo/presets.ts`, que não é um `TipoPortador`: o teste novo avisa). A Megola é o único preset de motor sem `'nenhum'` (de propósito: o motor gira com a roda).

**C-10 · dívida · para a pessoa da interface.** Textos de `src/pages/passagem/presets.ts` desatualizados: linha 49, `'Diesel-elétrica de 8 notches'` (o portador hoje leva também as 10 locomotivas a vapor); linha 45, o helicóptero descrito só pelo R44 e pelo S-55 (há Bell 47, R22, S300 e Camcopter); linhas 37–40, `ESPERA_MOTOR` ainda fala em "etapa 2 (diesel)", "etapa 5", "etapa 6" (texto morto: todos os portadores estão habilitados).

**C-11 · dívida · para a pessoa da interface.** O estado inicial marca o preset "Trem-bala no túnel" (`presetId = 'trembala-tunel'`, `controle.ts:110`) sem carregá-lo: `motor = 'nenhum'` e `pedal = 1` (`controle.ts:83, 88`), quando o preset tem o motor do N700 com pedal 0,3. Quem aperta o botão sem clicar no preset ouve o trem sem motor; `voltarAoPadrao()` repete isso (`controle.ts:513`). O roteiro de navegador conta com esse estado ("sem motor: escape, ponteira e cofre desabilitados"). Correção: `carregarPreset(PRESETS_PASSAGEM[0])` no construtor e em `voltarAoPadrao()`.

### Matriz portador × família (presets de motor que a página habilita)

| Portador | pistão | diesel | radial | rotativo | vapor | elétrico | turboélice | turbina | turboeixo | sem motor |
|---|---|---|---|---|---|---|---|---|---|---|
| carro | 68 | 13 | 3 | 10 | 1 | 5 | · | · | · | · |
| hélice | 6 | · | 13 | 3 | · | · | 7 | · | · | · |
| rotor | 4 | · | 1 | 1 | · | · | · | · | 0 (sem adaptador) | ✓ |
| gerador | · | 5 | · | 2 | 2 | · | · | · | · | · |
| locomotiva | · | 2 | · | · | 10 | · | · | · | · | · |
| trem | · | · | · | · | · | 9 | · | · | · | ✓ |
| avião a jato | · | · | · | · | · | · | · | 27 | · | · |
| trator | · | · | · | · | 1 | · | · | · | · | · |
| barco | · | 0 (no `COMPAT`, sem preset) | · | · | 1 | · | · | · | · | · |
| drone | · | · | · | · | · | 1 | · | · | · | · |

Total: 195 combinações com motor e 2 sem (rotor e trem sozinhos) = 197. Todas existiram, com as ressalvas de C-06 (o corpo) e as aproximações já declaradas nos presets (X-Engine em gerador, 787B como "carro"). Detalhe por combinação: carro × pistão são os 68 do Ronco (inclusive 11 motos e os carros de pista); carro × diesel são 8 picapes e carros, 3 caminhões, 2 ônibus; carro × radial são Sherman, Monaco-Trossi e Megola; carro × rotativo são 9 carros e a moto Norton; hélice × rotativo são Mistral, MidWest AE110 e AR741 (Shadow); rotor × rotativo é o AE50R (Camcopter S-100); gerador × rotativo são os dois X-Engine da LiquidPiston; gerador × vapor são o Corliss e o Aveling na polia; gerador × diesel são o grupo de 500 kVA e os motores Scania V8, Volvo D13, Cat C15 e Cummins ISL (todos têm versão estacionária). Nenhum `MOTOR_PADRAO` aponta para fora do filtro e nenhum preset da Passagem usa combinação fora da tabela.

### Achados: Passagem

**P-01 · incompleto · corrigido neste trabalho (`9dc3172`).** Não havia teste que montasse os presets da Passagem: as 105 medidas do `teste:cena` usam `CenaPassagem` e portadores montados à mão, e o roteiro de navegador toca 5 dos 29 presets (P-11). O teste novo cobre os 29 pelo caminho da página.

**P-02 · erro (alta) · para a etapa de som (Elétrico).** **O AVAS dá um estouro de ~100 dB(A) quando o carro passa do limite de velocidade de uma vez.** Em `src/engines/eletrico/avas.ts:59` o nível segue `L_W = 74 + 0,6·v` (e o tom, `250·(1 + 0,012·v)`) sem teto, e o desligamento é uma rampa de 2 s (linha 50). Num salto de 0 a 108 km/h a lei pede 139 dB de potência durante os 2 s da rampa. Medido com Model 3, Leaf e Dolphin (`--combinacoes`; série em `assento.ts carro:eletrico:model3`): parado, o AVAS chega ao ouvinte a 29 dB(A); ao disparar, **101,6 dB(A) por 2 s com o carro ainda a 60 m**, contra 78,9 dB(A) dos pneus na passagem. A Fórmula E, sem AVAS, dá 79,0. Acontece em qualquer disparo com o carro parado e o áudio já ligado (do segundo disparo em diante) acima de 20 km/h (30 no modo `eua`), e na página Elétrico ao impor velocidade. O preset `tesla-rua` (30 km/h, modo `eua`) não é afetado. Correção exata: nas leis de nível, de tom e da fração de ruído, usar `Math.min(kmh, this.limite())` em vez de `kmh`.

**P-03 · erro (alta) · para a etapa de som (hélice dos motores a pistão).** **A hélice dos aviões a pistão toca 10 a 25 dB acima do real e acima dos turboélices.** A amplitude da fonte é `9·(M/0,75)⁴·carga·(D/3,9)` Pa a 30 m (`src/carriers/helice.ts:139`), a lei do ATR 72 escalada só pelo Mach da ponta e pelo diâmetro: não entra potência, tração nem número de pás. Medido:
- `cessna-passagem` (100 m): 96,7 dB(A); a hélice sozinha 96,5, o escape 78,8. Um Cessna 172 real a 100 m fica perto de 80.
- `shadow-passagem` (150 m, motor de 38 hp): 89,6 dB(A); hélice 89,4, escape 71,0. Faixa esperada 56–74.
- `corsair-rasante`: hélice 117,7, escape 110,9; `yak52-passagem`: hélice 90,3, escape 84,7.
- Na mesma passagem (150 m, 300 km/h, manete no máximo): Cessna 172 94,9 · Saratoga (IO-540) 98,9 · T-6 (R-1340) 105,5 · R-4360 104,8 · **ATR 72 95,1 · C-130 93,4 · King Air 86,4 · Caravan 79,5 · PC-12 77,1**. Um Cessna de 160 hp empata com o ATR e passa o C-130.

**P-04 · erro · para a etapa de som e para o dono.** **Três presets e várias combinações estouram o fundo de escala.** Pico da pressão × master contra 1,0: `corsair-rasante` 107 Pa (+8,6 dBFS; 0,29% das amostras acima de 1,0, concentradas na passagem), `bigboy-arrancando` 51,7 Pa (+2,3), `p47-passagem` 44,3 Pa (+1,0), `caca-supersonico` −0,3 (o estrondo, que é posto "em unidades do alto-falante", fora da escala absoluta: `src/scene/cena.ts:472`), `trembala-tunel` −1,3. Nas combinações: Concorde a 150 m 116,7 dB(A), +9,4 dBFS e 4,8% das amostras; Monaco-Trossi +6,4; Big Boy e Y6b a 5 m +2 a +4. O `tanh` segura, mas achata: o que passa de ~112 dB(A) no ouvido já sai comprimido. Decisão do dono: manter 124 dB como teto (e aceitar o achatamento dos veículos mais altos de perto) ou baixar a escala da página.

**P-05 · erro · para a etapa de som (níveis absolutos).** Presets fora da faixa esperada (tabela abaixo; as faixas e as fontes estão no cabeçalho de `tools/passagem-presets.ts`):
- `caca-supersonico`: **94,0 dB(A)**, 21 abaixo. Isolando as fontes, o que dá os 94 é o próprio estrondo; o jato fica abaixo de 93. Um F-16 a 200 m passa de 115. Além disso o pedal da Passagem vai de 0 a 1 e a pós-combustão da Turbina começa acima de 1 (`src/engines/turbina/motor.ts:91`): nenhum caça acende a pós-combustão na Passagem.
- `787b-hunaudieres`: 98,6 dB(A) a 15 m, 7 abaixo (só o escape toca: admissão 64, bloco 63).
- `aviao-rasante` (ATR 72): 97,0, 5 acima do alvo do próprio projeto (85 ± 3; desvio já documentado no `teste:cena`).
- `bigboy-arrancando`: 112,4, 4 acima (cilindros 110,1 com as torneiras abertas, chaminé 110,0).
- `locomotiva-patio`: 85,4 a 15 m, 3 abaixo da faixa e ~8 abaixo do que o limite americano de 90 dB(A) a 30 m sugere para N8; o escape dá 85,3 e todo o resto fica 20 dB abaixo (rolamento 64,9, ventiladores 63,5, turbo 53,2).
- `pacific-100`: 87,4, no limite de baixo.
Ficam dentro: os 5 trens sem motor, os 4 elétricos sobre trilho, R44, Camaro, Hilux, Sherman, RX-7, Yak-52, 737 a 1 500 m, Maria Fumaça, gerador, Tesla e drone.

**P-06 · dívida · para a etapa de som (Cena).** **A céu aberto, de longe, a "reverberação" pesa tanto quanto o som direto.** O envio cai com 1/√r (`expoenteEnvio`, `src/scene/ambientes.ts:57`) e o direto com 1/r; com `wet: 0,005` no céu aberto, a 1 500 m o campo reverberante iguala o direto: `jato-1500` dá 69,1 dB(A) no medidor "direto" da página e 72,1 com o ambiente (+3,0); `caca-supersonico`, +3,4. No túnel (+6,5 e +7,4) e na estação (+3,3) a soma é a prevista. A lei 1/√r veio do ouvinte de rua do Ronco, pensada para dezenas de metros.

**P-07 · erro · para a pessoa da interface.** **Carregar um preset com motor trava a página de 2 a 9 segundos.** As sondas de calibração rodam na thread principal dentro de `sondar()` (`controle.ts:159–191`, `cfgMotor` em 202–216). Tempo de CPU de `carregarPreset` (coluna "Montagem"): trens e elétricos 0,04–0,2 s; carro do Ronco 2,1 s; picape diesel 2,8 s; radiais 2,7–3,3 s; rotativos 2,2–3,1 s; vapor 2,9–3,8 s; gerador 4,8 s; **locomotiva EMD 8,7 s**. Nas combinações o pior é o Monaco-Trossi (10,7 s). Com a máquina livre os números caem para algo como a metade (primeira rodada: carro 0,7–1,1 s; locomotiva 5,0 s), ainda longe de instantâneo. O resultado fica em cache por preset e taxa de amostragem, então só a primeira vez paga. Correção: calibrar num Web Worker, ou guardar as calibrações no build.

**P-08 · erro · para a etapa de som (Diesel/portadores).** **Na Passagem a locomotiva em N8 estabiliza ~3% abaixo da rotação do notch:** EMD 710 em 880 rpm (alvo 904), GE 7FDL em 1 020 (alvo 1 050), parada e em regime por mais de 15 s (`combo.ts locomotiva:diesel:emd710:30`). O `governador:diesel` mede ±1% porque exercita o modelo de locomotiva de dentro do `DieselDSP` (`d.message({ type: 'diesel', notch })`, `tools/diesel-governador.ts:76–99`), não o portador `Locomotiva` de `src/carriers/locomotiva.ts`, que é o que a Passagem monta. O roteiro de navegador aceita 840–920 rpm e por isso não vê.

**P-09 · dívida · para refazer com a máquina parada (frente 5).** CPU média por bloco, em % do quantum de 2,67 ms (com a ressalva do início): `locomotiva-patio` **117%** (as duas locomotivas diesel deram 119–122% nas combinações), `gerador-bancada` 70%, `787b-hunaudieres` 66%, `corsair-rasante` 50%, `p47-passagem` 46%; todos os outros abaixo de 40%; trens 13–36%; jatos, turboélice, Tesla e drone abaixo de 10%. Nas combinações, o Monaco-Trossi (16 saídas de escape) deu 107% e os caminhões no gerador 53–70%. Mesmo descontando a carga da máquina, a locomotiva diesel custa cerca de 5 vezes um carro.

**P-10 · dívida · para a pessoa da interface.** Legendas dos presets contra os números (`src/pages/passagem/presets.ts`):

| Linha | Preset | O que a legenda diz | O que o preset faz | Correção |
|---|---|---|---|---|
| 138 | `trembala-tunel` | "N700 · 350 km/h" | o N700 tem `vMaxKmh: 300` na própria ficha (`src/engines/eletrico/presets.ts:193`) e 16 ou 8 carros, não 10 | `vKmh: 300`, ou tirar "N700" da legenda ("motor do N700") |
| 154 | `sherman` | "2ª · 15 km/h" | 1 162 rpm, quase na lenta (600), porque a ficha do R-975 está sem a relação do diferencial (ver P-14) | com a ficha corrigida: `marcha: 3` e "3ª" (2 220 rpm) |
| 148, 170, 171 | `carro-rua`, `tesla-rua`, `taurus-doremi` | "a 6 m", "6 m", "a 7,5 m" | `lateral` 5,1, 5,1 e 6: a legenda dá a distância ao eixo; `lateral` é a distância à lateral do corpo (`src/scene/tipos.ts:113`), que é o que o controle mostra | escolher uma convenção; nos demais a legenda dá a distância à lateral (ou a altura de voo) |
| 153 | `p47-passagem` | "R-2800 com turbina" | turbocompressor | "R-2800 com turbocompressor" |
| 158 | `shadow-passagem` | "hélice impulsora" | hélice montada no nariz (C-07) | tirar "impulsora" enquanto o portador não a puser atrás |
| 168 | `caca-supersonico` | "F-16 · Mach 1,5" a 200 m | o F-16 fica perto de Mach 1,2 ao nível do mar; sem pós-combustão (P-05) | "Mach 1,2", ou subir a altitude |
| 172 | `metro-estacao` | "chegando na estação · freio elétrico" | velocidade imposta de 35 km/h: freia sem desacelerar nem parar | dizer "passando com o freio elétrico", ou programar a parada |

Conferidos e certos: Camaro a 108 km/h em 3ª = 3 996 rpm (61% do corte); Hilux a 80 km/h em 4ª = 2 229 rpm; RX-7 a 100 km/h em 3ª = 4 800 rpm; 787B a 340 km/h em 5ª = 8 549 rpm (corte 9 000); K4s a 100 km/h = 261 rpm das rodas de 80 pol; Big Boy a 20 km/h = 61 rpm; Model 3 a 30 km/h = 2 158 rpm (redução 9:1); R44 com o rotor a 100%.

**P-11 · incompleto · para a pessoa da interface (roteiro não editado).** `npm run navegador:passagem` (com `npm run build` antes; Chromium e Firefox estão em `/usr/bin`):
- **Cobre:** estrutura da página (29 presets habilitados, 10 portadores, seções, sliders, atalhos, 4 canvas, WebGL); o `trembala-tunel` inteiro (worklet, reverberação, 350 km/h, onda do túnel ~2 kPa, onda de nariz, nível 105–125 dB(A), leituras); gimbal, atalhos e arrasto; troca de ambiente; edição do trem; câmeras; padrões do helicóptero; `carro-rua` (3ª, 3 500–4 500 rpm, 80–100 dB(A)); `rx7-rua`; `locomotiva-patio` (840–920 rpm, 75–110 dB(A)); "voltar ao padrão"; console sem erros.
- **Não cobre:** os outros 24 presets (só conta que existem), nenhum avião, helicóptero com motor, vapor, elétrico, gerador ou drone; as faixas de nível são largas (25–35 dB).
- **Instável com a máquina ocupada (Chromium).** Três rodadas seguidas, código 1 nas três, com falhas diferentes: "slider de elevação manda o ouvinte novo" e "arrastar a cabeça muda azimute/distância" (duas vezes), depois "slider da lateral manda a trajetória". São as conferências que esperam um tempo fixo (`espera(200)` ou `espera(250)`, `tools/passagem-navegador.mjs:222, 229, 236, 240, 254`) pela mensagem que a página só manda uma vez por quadro; com o WebGL por software e a CPU disputada o quadro demora mais que isso. No Firefox passou inteiro (50 conferências, 83 s). Mudança a fazer no roteiro: trocar a espera fixa por uma espera pela condição (repetir a leitura a cada 50 ms, até 3 s).

**P-12 · dívida · para a etapa de som (Elétrico).** A 108 km/h os quatro carros elétricos dão o mesmo nível com 0,1 dB de diferença (Model 3, Leaf, Dolphin 78,9; Fórmula E 79,0): os pneus (78,9) cobrem o motor (53,6), a redução (50,9) e o inversor (37,2) por mais de 25 dB. Para os de rua é plausível; para a Fórmula E, cujo som é o da redução, não.

**P-13 · dívida · para a etapa de som (Rotativo).** O XTS-210 no gerador sobe de 81 a 100 dB(A) a 7,5 m em 9 s e fica aí; a admissão sozinha dá 100,2, 17 dB acima do escape (83,1) e 17 acima do grupo diesel de 500 kVA no mesmo portador (83,1). O X-Mini dá 83,2.

**P-14 · erro de ficha · para a frente das fichas (Radial).** O R-975 do Sherman tem `finalDrive: 2.84` (`src/engines/radial/presets.ts:142`), que é só a redução final; falta o diferencial controlado de 3,53:1. Com a ficha atual a 5ª a 2 400 rpm dá 140 km/h; com 2,84 × 3,53 = 10,03 dá 39,6 km/h, a velocidade máxima real do M4A1. As relações da caixa (7,56 / 3,11 / 1,78 / 1,11 / 0,73) e o raio da roda motriz (0,32 m) estão certos. (Valores do manual do M4, de memória: conferir a fonte antes de mudar.)

**P-15 · dívida · para o dono (já conhecido no TECNICO como "nível absoluto").** Na escala absoluta, os carros do Ronco saem todos perto da mesma referência (95 dB a 5 m em carga, `src/engines/ronco/motor.ts:51`): a 108 km/h em 3ª, pé no fundo, um F1 V10 a 13 157 rpm passa a 93,0 dB(A), o Golf GTI a 87,7, o Camaro a 89,3, o Fusca a 78,6 e o V16 a 103,2. Um F1 de verdade passa de 120.

### Níveis por preset (`npx tsx tools/passagem-presets.ts`, 48 kHz, master 0,8)

L_AFmax e L_Aeq no ouvido do preset, com o ambiente; L_Aeq na janela de 10 dB abaixo do máximo. "Ambiente soma" é a diferença para o medidor "direto" da página. Pico = pressão × master, contra o fundo de escala. CPU: ver a ressalva.

| Preset | L_AFmax dB(A) | L_Aeq dB(A) | Ambiente soma (dB) | Pico (dBFS) | % > 1,0 | CPU média (% do quantum) | Montagem (s de CPU) | Motor na passagem | Faixa esperada | Veredito |
|---|---|---|---|---|---|---|---|---|---|---|
| `trembala-tunel` | 114,5 | 112,8 | +6,5 | −1,3 | 0,00 | 37 | 0,23 | 6031 rpm | 110–122 | alerta: passa a 350 km/h, acima da velocidade máxima da ficha (300 km/h) |
| `trembala-ceu` | 101,3 | 100,2 | +0,1 | −10,5 | 0,00 | 27 | 0,10 | — | 97–106 | ok |
| `trembala-ponte` | 105,6 | 104,0 | +0,4 | −3,5 | 0,00 | 29 | 0,12 | — | 100–112 | ok |
| `convencional-estacao` | 93,9 | 90,2 | +3,3 | −21,8 | 0,00 | 25 | 0,11 | — | 86–100 | ok |
| `regional-corte` | 93,2 | 90,9 | +1,0 | −20,4 | 0,00 | 14 | 0,07 | — | 90–102 | ok |
| `heli-rasante` | 82,7 | 78,7 | +0,1 | −23,6 | 0,00 | 21 | 2,0 | 2719 rpm, rotor 100% | 80–92 | ok |
| `carro-rua` | 89,2 | 85,6 | +0,1 | −19,0 | 0,00 | 26 | 2,3 | 3996 rpm, 3ª | 82–96 | ok |
| `picape-diesel` | 82,4 | 78,6 | +0,1 | −22,9 | 0,00 | 35 | 3,0 | 2229 rpm, 4ª | 70–84 | ok |
| `corsair-rasante` | 118,6 | 115,3 | +0,1 | +8,6 | 0,29 | 53 | 3,5 | 2828 rpm, ponta Mach 0,86 | 100–118 | alerta: nível acima da faixa (0,6 dB); satura: 0,29% das amostras acima de 1,0; CPU média 53% do quantum |
| `yak52-passagem` | 91,8 | 88,1 | +0,3 | −17,7 | 0,00 | 34 | 2,9 | 2915 rpm, ponta Mach 0,74 | 76–92 | ok |
| `p47-passagem` | 110,8 | 108,0 | +0,1 | +1,0 | 0,00 | 48 | 3,1 | 2716 rpm, ponta Mach 0,90 | 92–108 | alerta: nível acima da faixa (2,8 dB) |
| `sherman` | 91,3 | 86,7 | +0,1 | −9,4 | 0,00 | 28 | 3,1 | 1162 rpm, 2ª | 86–102 | ok |
| `rx7-rua` | 94,6 | 90,7 | +0,1 | −12,9 | 0,00 | 29 | 2,5 | 4800 rpm, 3ª | 80–96 | ok |
| `787b-hunaudieres` | 98,6 | 95,0 | +0,1 | −14,4 | 0,00 | 70 | 3,6 | 8549 rpm, 5ª | 106–124 | alerta: nível abaixo da faixa (-7,4 dB); CPU média 70% do quantum |
| `shadow-passagem` | 89,6 | 85,9 | +0,2 | −23,4 | 0,00 | 19 | 2,4 | 7454 rpm, ponta Mach 0,85 | 56–74 | alerta: nível acima da faixa (15,6 dB) |
| `cessna-passagem` | 96,7 | 93,2 | +0,1 | −14,2 | 0,00 | 23 | 2,9 | 2703 rpm, ponta Mach 0,81 | 72–88 | alerta: nível acima da faixa (8,7 dB) |
| `aviao-rasante` | 97,0 | 93,6 | +0,3 | −13,6 | 0,00 | 6 | 0,05 | 20398 rpm, ponta Mach 0,75 | 82–92 | alerta: nível acima da faixa (5,0 dB) |
| `locomotiva-patio` | 85,4 | 81,1 | +0,0 | −26,7 | 0,00 | 122 | 8,4 | 877 rpm | 88–100 | alerta: nível abaixo da faixa (-2,6 dB); CPU média 122% do quantum |
| `gerador-bancada` | 85,2 | 83,8 | −0,1 | −17,3 | 0,00 | 73 | 4,7 | 1814 rpm | 85–102 | alerta: CPU média 73% do quantum |
| `jato-1500` | 72,1 | 67,7 | +3,0 | −41,0 | 0,00 | 7 | 0,06 | — | 62–78 | alerta: a reverberação de "ceu" soma 3,0 dB ao som direto |
| `pacific-100` | 87,3 | 83,4 | +0,1 | −22,2 | 0,00 | 30 | 3,4 | 261 rpm | 88–102 | alerta: nível abaixo da faixa (-0,7 dB) |
| `bigboy-arrancando` | 112,4 | 107,9 | +0,0 | +2,3 | 0,00 | 35 | 3,9 | 61 rpm | 92–108 | alerta: nível acima da faixa (4,4 dB) |
| `maria-estacao` | 94,4 | 89,1 | +0,9 | −12,0 | 0,00 | 20 | 3,2 | 71 rpm | 84–100 | ok |
| `caca-supersonico` | 94,0 | 89,9 | +3,4 | −0,3 | 0,00 | 8 | 0,03 | — | 115–145 | alerta: nível abaixo da faixa (-21,0 dB); a reverberação de "ceu" soma 3,4 dB ao som direto |
| `tesla-rua` | 60,3 | 56,4 | +0,0 | −53,4 | 0,00 | 9 | 0,10 | 2158 rpm | 54–68 | ok |
| `taurus-doremi` | 72,1 | 68,0 | +3,3 | −41,4 | 0,00 | 35 | 0,19 | 199 rpm | 72–90 | ok |
| `metro-estacao` | 76,7 | 72,8 | +2,7 | −34,5 | 0,00 | 32 | 0,18 | 1468 rpm | 74–94 | ok |
| `n700-tunel` | 99,8 | 97,6 | +7,4 | −19,9 | 0,00 | 33 | 0,20 | 2585 rpm | 90–104 | ok |
| `drone-pairando` | 49,6 | 48,6 | +0,0 | −59,3 | 0,00 | 8 | 0,10 | 6270 rpm | 46–62 | ok |

### Combinações portador × motor (`--combinacoes`: 8 s parado, 5 s de passagem com os padrões do portador)

| Portador × família | Combinações | L_AFmax dB(A), menor–maior | Mais baixo · mais alto | Alertas (fora os de CPU) |
|---|---|---|---|---|
| trem × elétrico | 9 | 114,8–131,0 | `n700` · `frotaa` | `taurus`: satura 0,87% das amostras; passa a 350 km/h (máxima da ficha 230 km/h)<br>`vectron`: satura 0,87% das amostras; passa a 350 km/h (máxima da ficha 200 km/h)<br>`frotaa`: satura 4,44% das amostras; passa a 350 km/h (máxima da ficha 90 km/h)<br>`cptm9500`: satura 0,80% das amostras; passa a 350 km/h (máxima da ficha 90 km/h)<br>`cptm9000`: satura 0,80% das amostras; passa a 350 km/h (máxima da ficha 90 km/h)<br>`metropolis`: satura 0,81% das amostras; passa a 350 km/h (máxima da ficha 90 km/h)<br>`n700`: passa a 350 km/h (máxima da ficha 300 km/h)<br>`tgv`: passa a 350 km/h (máxima da ficha 320 km/h)<br>`flexity`: satura 0,81% das amostras; passa a 350 km/h (máxima da ficha 70 km/h) |
| trem × sem motor | 1 | 114,8–114,8 | — | — |
| rotor × pistão | 4 | 70,4–78,2 | `r44` · `s300` | `bell47`: rotor a 81% da rotação nominal na passagem<br>`s300`: rotor a 94% da rotação nominal na passagem |
| rotor × radial | 1 | 79,6–79,6 | — | `s55`: rotor a 55% da rotação nominal na passagem |
| rotor × rotativo | 1 | 70,3–70,3 | — | `ae50r`: rotor a 78% da rotação nominal na passagem |
| rotor × sem motor | 1 | 62,3–62,3 | — | — |
| carro × pistão | 68 | 79,0–103,2 | `v6odd` · `v16` | `fusca`: motor a 5199 rpm, acima do corte de 4600<br>`single`: motor a 13057 rpm, acima do corte de 11500 |
| carro × diesel | 13 | 73,3–103,0 | `ram67` · `catc15` | `ranger32`: motor a 4160 rpm, acima do corte de 4000<br>`ram67`: motor a 3756 rpm, acima do corte de 3200<br>`duramax66`: motor a 5033 rpm, acima do corte de 3450<br>`f1000mwm`: motor a 4534 rpm, acima do corte de 3000<br>`scaniav8`: motor a 11773 rpm, acima do corte de 2100<br>`volvod13`: motor a 13256 rpm, acima do corte de 2100<br>`catc15`: motor a 11632 rpm, acima do corte de 2100<br>`onibusisl`: motor a 4553 rpm, acima do corte de 2300<br>`dd6v92`: motor a 3232 rpm, acima do corte de 2100 |
| carro × radial | 3 | 83,5–116,7 | `megola` · `trossi` | `r975`: motor a 4492 rpm, acima do corte de 2400<br>`trossi`: satura 0,13% das amostras<br>`megola`: motor a 5208 rpm, acima do corte de 4800 |
| carro × rotativo | 10 | 75,7–103,8 | `ro80` · `r26b` | — |
| carro × vapor | 1 | 86,4–86,4 | — | `stanley`: passa a 108 km/h (máxima da ficha 100 km/h) |
| carro × elétrico | 5 | 79,0–101,6 | `formulae` · `model3` | `trolebus`: passa a 108 km/h (máxima da ficha 70 km/h) |
| hélice × pistão | 6 | 83,2–98,9 | `rotax912` · `io540` | — |
| hélice × turboélice | 7 | 77,1–95,1 | `pc12` · `regional` | — |
| hélice × radial | 13 | 83,4–105,5 | `verner3` · `r1340` | — |
| hélice × rotativo | 3 | 85,7–98,3 | `ae110` · `mistral` | — |
| gerador × diesel | 5 | 80,2–83,1 | `catc15` · `gen500` | — |
| gerador × rotativo | 2 | 83,2–100,1 | `xmini` · `xts210` | — |
| gerador × vapor | 2 | 72,5–101,2 | `corliss` · `aveling` | — |
| locomotiva × diesel | 2 | 87,2–88,4 | `emd710` · `ge7fdl` | — |
| locomotiva × vapor | 10 | 105,2–129,7 | `a4` · `shay` | `shay`: satura 13,74% das amostras; passa a 60 km/h (máxima da ficha 25 km/h)<br>`maria_fumaca`: passa a 60 km/h (máxima da ficha 50 km/h) |
| avião a jato × turbina | 27 | 90,5–116,7 | `hondajet` · `sst` | `sst`: satura 4,81% das amostras |
| trator × vapor | 1 | 84,9–84,9 | — | — |
| barco × vapor | 1 | 70,2–70,2 | — | — |
| drone × elétrico | 1 | 55,9–55,9 | — | — |

Notas: em carro × elétrico, os 101,6 dB(A) do Model 3 (iguais no Leaf e no Dolphin) são o estouro do AVAS de P-02, não a passagem (78,9). Em gerador × vapor, os 101,2 do Aveling são o ciclo-limite de C-05. Em locomotiva × diesel, a locomotiva passa a 5 m (o preset `locomotiva-patio` é a 15 m).

A tabela linha a linha das 197 combinações sai do próprio comando (`--md arquivo.md`); a desta rodada está em `scratchpad/aud/pass/final2.md` e `final2.json`.

## Testes que mentem: Diesel e Cena

Auditoria de `tools/diesel-valida.ts`, `diesel-lenta.ts`, `diesel-governador.ts`, `diesel-troca.ts`, `diesel-comum.ts`, `diesel-bandas.ts` e de `tools/cena/{valida,medidas,motores,portadores,legado,cpu,render-passagem}.ts`, no commit `1a2a73c`. Nada foi editado no repositório; os roteiros de apoio estão em `scratchpad/aud/desv-diesel/sem/` (pasta de rascunho da sessão) e as saídas em `scratchpad/aud/desv-diesel/`.

**O que rodou** (máquina de 32 núcleos com carga média de 40 a 84 durante as medidas, por causa de outras suítes em paralelo; os tempos são piso alto, não referência):

| Comando | Código de saída | Tempo | Resultado |
|---|---|---|---|
| `npm run teste:diesel` | 0 | 1206 s | 258 linhas: 192 ok, **66 desvios**, 0 falhas. Aos 19 min só restava o grupo `nan` (um processo só) |
| `npm run lenta:diesel` | 0 | 44 s | 32 casos ok |
| `npm run governador:diesel` | **1** | 282 s | 11 ok, **2 falhas** (ver T-DSL-11) |
| `npm run troca:diesel` | 0 | 155 s | 9 trocas ok |
| `npm run teste:cena` | 0 | 130 s e 117 s | 105 medidas: 93 ok, **12 desvios**, 0 falhas |

**Determinismo:** conferido. Os grupos do `teste:diesel` (201 medidas dos grupos `pressoes`, `bandas`, `real3`, `envoltoria`, `fumaca`, `jake`, `potencia`, `veiculo`, `cambio` e `governador`) saíram idênticos em duas execuções independentes; as tabelas de `lenta`, `governador` e `troca` também; o `teste:cena` saiu idêntico nas duas execuções, exceto as quatro linhas de CPU e de coleta de lixo. O problema não é o acaso entre execuções: é a **semente fixa** (T-DSL-02, T-CEN-03).

**Como troquei a semente sem tocar no repositório:** `sem/semente.cts` substitui `this.rng` do `EngineDSP`/`DieselDSP` no primeiro `setConfig` (`SEMENTE=777 GRUPO=real3 npx tsx …/sem/semente.cts`); `sem/cena-semente.cts` aplica um XOR a todas as sementes de `RNG` no primeiro `next()` (`DESLOCA=0x5a5a GRUPOS="trem niveis …" npx tsx …/sem/cena-semente.cts`). Sementes usadas: 777, 2024 e 31337 no Diesel; deslocamentos 0x5a5a, 0x1234 e 0xbeef na Cena.

Classes usadas nas tabelas de desvios: **(a)** defeito real de som (ou de execução) que o teste aceita; **(b)** alvo do projeto errado, contraditório ou irrealista; **(c)** limitação do modelo, aceitável; **(d)** medida mal definida.

Contagem dos desvios: Diesel 66 = 28 (a) + 4 (b) + 21 (c) + 13 (d); nos 28 (a): 9 de gravidade alta, 12 média, 7 baixa. Cena 12 = 2 (a) + 6 (b) + 4 (c).

---

### Diesel: achados

**T-DSL-01 · Os desvios não têm teto e as chaves são largas: o teste não vê piora.**
- **Severidade:** erro.
- **Evidência:** `tools/diesel-valida.ts:21–55` (lista de `[RegExp, motivo]`), `:56` e `:413–415`: qualquer medida fora do alvo cujo nome case com uma regex vira "desvio", com qualquer valor. A lista não guarda o valor medido quando o desvio foi aceito. Regexes que cobrem classes inteiras: `/real3 · gerador/` (`:38`) casa 16 medidas (13 falham hoje, 3 passam); `/real3 · locomotiva lenta/` (`:39`) casa 8 (5 falham); `/EMD 710.*(…)/` (`:27`) casa 6, na lenta e no notch 8; `/lenta.*T na abertura do escape/` (`:23`) casa 4 presets; `/pesado · escape · catc15/` (`:32`) casa 3. Dez medidas que hoje passam já estão desculpadas de antemão (se piorarem, viram "desvio" sem aviso): gerador com carga 60–150, 1–2,5k e centroide; locomotiva lenta 30–60, 1–2,5k e CV; EMD N8 T na abertura e CV; cofre 2,5–6 kHz; escape do C15 60–150 Hz. Exemplo de piora já engolida: a curtose do cofre da Hilux está em 15,3 e o motivo escrito ainda diz "curtose 11" (`:30`). Saída de `npx tsx …/sem/orfaos.cts …/sem 12345`.
- **Estado:** corrigível em `tools/**`. Trocar a lista por registros `{ nome exato, medido de referência, folga }`: a medida continua "desvio" só enquanto ficar a menos da folga do valor aceito (por exemplo ±1 dB, ±5 %); se piorar além disso, FALHA; se voltar a passar, FALHA de "desvio órfão" até a linha ser retirada. Mesma mudança no `tools/cena/medidas.ts` (T-CEN-04).

**T-DSL-02 · Três medidas verdes só passam com a semente 12345.**
- **Severidade:** erro.
- **Evidência:** com a semente do ruído trocada (`…/sem/sementes.txt`), saem do alvo sem estar em `DESVIOS`, ou seja, viram FALHA: `gen500 degrau de 100% (ISO 8528 G2)` (alvo queda ≤ 10 %; 9,8 % com 12345; **10,1 % com 777**); `picape lenta quente (hilux28): dp/dθ máx` (alvo 3–6 bar/°; 3,0 no limite; **fora com 777 e 2024**); `picape plena 3000 rpm (hilux28): gás no coletor` (alvo 550–700 °C; 699 °C; **700,x com 777**). Com 777 o teste teria 3 falhas, com 2024 teria 1, com 31337 nenhuma. Outras quatro medidas mudam de estado, mas caem em regexes largas e viram "desvio": `om617 caça em lenta` (±1,9 % → ±2,8 %), `real3 · gerador com carga: CV`, `real3 · locomotiva lenta: 1–2,5k` (−11,4 → −11,6; limite −11,5) e `real3 · EMD notch 8: CV` (0,16 → 0,15).
- **Consequência prática:** qualquer mudança no DSP que consuma um número aleatório a mais ou a menos (toda correção de som faz isso) troca a realização do ruído e pode acender essas falhas sem relação com a mudança.
- **Estado:** corrigível em `tools/**` (medir a média de 3 sementes nas medidas de transiente e de pressão, ou dar margem ao alvo); a escolha do critério é do dono.

**T-DSL-03 · O alvo "real3" das locomotivas contradiz o Apêndice A do DIESEL.md, e a fonte do real3 não existe mais.**
- **Severidade:** erro.
- **Evidência:** `tools/diesel-valida.ts:176–179` contra `docs/DIESEL.md` (tabela 4.4 e Apêndice A), mesma locomotiva e mesmo regime:

  | Banda 60–150 Hz (dB rel. 150–400) | DIESEL.md | real3 no teste | simulado hoje |
  |---|---|---|---|
  | EMD SD70ACe, notch 8 | **+2,7** | **+14,2 a +16,3** (±2) | −3,3 |
  | GE 7FDL-16, notch 8 | **+15,8** | **+5,4** (±5) | +9,3 |

  Os dois conjuntos dão balanços opostos (no documento a GE é a grave e a EMD a brilhante; no real3 do teste, o contrário no grave). O arquivo citado (`scratchpad/real3/diesel/RESUMO.md`, `diesel-valida.ts:34` e `:150`) não existe: `scratchpad/real3/diesel/` só tem as pastas `json/` e `wav/`, vazias; `referencias/` (raiz do repositório principal) só tem `gasolina/`. Não há como conferir de onde saíram os 9 × 8 números do grupo `real3` nem as faixas do grupo `envoltoria`. O motivo do desvio da EMD (`:40`: "ventiladores do radiador, motores de tração e o desequilíbrio entre bancadas a 15 Hz") explica um grave de +16 dB que o próprio projeto mediu em +2,7.
- **Estado:** para o dono decidir qual referência vale. Até lá, o grupo `real3` das locomotivas não serve de alvo para a etapa de som. As gravações têm de voltar para `referencias/` (regra 1 do PLANO) com o resumo junto.

**T-DSL-04 · Trinta e quatro medidas do alvo do projeto foram retiradas do teste quando o som mudou.**
- **Severidade:** erro (alvo afrouxado para passar).
- **Evidência:** commit `3c0718a` ("classes do real3 na validação…"): saíram de `tools/diesel-valida.ts` as 10 medidas `pesado · exterior · {catc15, onibusisl} lenta` (linha 3 da tabela 2.6 do DIESEL.md; no commit `0d28f6e` não havia desvio para elas, então ou passavam ou o teste estava vermelho: não rodei aquele commit) e as 24 medidas `EMD/GE · lenta/notch 8` contra a tabela 4.4 (±4 dB por banda, centroide ±30 %; estavam todas sob os desvios `/^EMD · /` e `/^GE · /`). No lugar entraram as classes do real3, mais largas (T-DSL-05), e a GE em lenta ficou sem nenhuma medida de banda. Refiz as 34 medidas hoje com os mesmos cenários (`npx tsx …/sem/retiradas.cts`, saída em `…/sem/retiradas.txt`): **20 das 34 estão fora do alvo.** Pesado exterior: 4 de 10 fora (C15: centroide 946 Hz contra 600–900, 1–4 kHz +0,4 contra −2 ± 2; ônibus: 1–2,5 kHz +1,9 contra −2,5 ± 2, 1–4 kHz +2,3). EMD em lenta: 6 de 6 fora (60–150 Hz +18,1 contra +8,4; 400–1k −10,3 contra +3,3; 2,5–6k −17,1 contra −5,8; 6–12k −29,0 contra −13,3; centroide 235 Hz contra 700). EMD em N8: 5 de 6 fora (1–2,5k +3,1 contra −4,2; centroide 1516 Hz contra 840). GE em lenta: 3 de 6. GE em N8: 2 de 6 (60–150 Hz +9,3 contra +15,8; 2,5–6k −7,1 contra −13,5).
- **Estado:** para a etapa de som (são defeitos de som medidos contra o documento do projeto); corrigível em `tools/**`: repor as medidas, como desvios com teto, depois de decidida a referência (T-DSL-03).

**T-DSL-05 · As faixas do real3 são largas demais para reprovar um som.**
- **Severidade:** dívida.
- **Evidência:** `tools/diesel-valida.ts:160–179`: tolerância = faixa entre as gravações da classe ±2 dB (ou ±5 dB com uma gravação só). Das 54 janelas de banda, 47 têm 10 dB ou mais de largura e 16 têm 15 dB ou mais: picape em lenta 30–60 Hz de −14,7 a +13,3 dB (28 dB); caminhão em carga 30–60 Hz de −25,6 a +11,1 (36,7 dB) e 6–12 kHz de −40,4 a −15,3 (25 dB); locomotiva em lenta 30–60 Hz 27 dB, 2,5–6 kHz 23 dB, 6–12 kHz 25 dB. Centroides: EMD N8 340–3547 Hz, locomotiva em lenta 481–2244 Hz, picape 214–1114 Hz. O simulado de cada classe é a **média** de 2 ou 3 presets (`:188–189`), o que esconde um preset fora da curva. Mesmo assim, 32 das 72 medidas de classe estão fora.
- **Estado:** para a etapa de som trocar pelo alvo casado (regra 3 do PLANO: preset contra gravação com a rotação confirmada); corrigível em `tools/**` medir cada preset, sem média.

**T-DSL-06 · O teste de lenta mede o governador contra o alvo dele mesmo, com a tolerância alargada, e num caso nem acelera o motor.**
- **Severidade:** erro.
- **Evidência:** (1) `tools/diesel-lenta.ts:39–42`: o alvo é `rpmAlvo` ou `idleTarget` do próprio DSP, não a lenta da ficha. Passam como "erro 0 %": Hilux a 20 °C em 1039 rpm (ficha 780) e EMD 710 em 361 rpm (ficha 269). A causa é `coldAdd = cold·min(0,35·idle, 300)` (`src/engines/diesel/dsp.ts:823`): a 20 °C os eletrônicos ficam 33 % acima da lenta da ficha, quase o mesmo que a −5 °C (1053 rpm). O teste não tem como reprovar isso. (2) `:43`: `tol = mecanico ? 0.08 : 0.03`. No commit `5650369` era `mecanico && T < 10 ? 0.08 : 0.03`; o `0d28f6e` estendeu os ±8 % aos 20 °C. Sem isso o `f1000mwm` a 20 °C falharia (779 rpm, +3,9 %; o DIESEL.md, passo 11, pede ±3 %). (3) `om617` a −5 °C: "pegou" aos 13,7 s (espera das velas); as duas aceleradas do teste são aos 8 s e aos 13 s, antes de o motor pegar ("pico acelerando 0" na tabela), e a rotação final é lida 4 s depois da partida. O caso passa sem ter testado a acelerada nem a volta à lenta.
- **Estado:** corrigível em `tools/**` (comparar com a lenta da ficha quente e com a lenta fria declarada no preset; alinhar as aceleradas ao instante em que o motor pega; voltar os ±3 % a 20 °C ou declarar o F-1000 como desvio com teto); a lenta fria de +33 % a 20 °C é para a etapa de som e para o dono (é o que se ouve ao ligar a página fria).

**T-DSL-07 · Rótulo de alvo diferente do critério aplicado.**
- **Severidade:** dívida.
- **Evidência:** `tools/diesel-valida.ts:268` alvo "≥ 1,25", critério `>= 1.24`; `:210` alvo "+17 a +24 dB em ~7 kHz", critério 14–27 dB e a frequência só é limitada pela janela de busca (5–9 kHz); `:211` alvo "+19,5 dB", critério 14–26 dB; `:298–299` alvos "≈ 60 %" e "≈ 30 %", critérios 45–75 % e 20–40 % (o Jake de 2 cilindros mede 37 %); `:123` "15 ± 3 dB" onde a tabela 2.6 do DIESEL.md dá 15–17; `:137–138` "≤ −18 dB" e "125–200 Hz" onde a tabela 2.6 dá −21 ± 2 e 125–140 (o próprio DIESEL.md se contradiz: os valores largos estão no plano, seção 8, passos 3 e 4); `tools/diesel-governador.ts:58` alvo "±1–2 % a 0,6–1,2 Hz", critério 0,5–2,5 % e **a frequência não é conferida** (medido: 2,00 Hz, fora de 0,6–1,2 Hz, e a linha sai "ok").
- **Estado:** corrigível em `tools/**` (o rótulo impresso tem de ser o critério; a frequência da caça entra no critério ou sai do rótulo).

**T-DSL-08 · Medidas circulares: passam por construção.**
- **Severidade:** dívida.
- **Evidência:** (1) grupo `potencia` (`diesel-valida.ts:314–319`): mede a potência na mesma sonda (`d.sonda = true`, rotação travada, turbo imposto) que `measurePower` usa para escalar o torque até a ficha (`src/engines/diesel/dsp.ts:1123–1131`, `config.ts:28`). Resultado: −0,4 % a +2,2 % nos 16 presets. Confere que a calibração fecha, não que o modelo entrega a potência nem que a ficha está certa. (2) `veiculo`, linhas `:324–327`: `rpm a 100 km/h` é conta sobre a ficha (relações, diferencial, raio), sem simular nada; a Hilux passa por 4 rpm (1604 contra o piso de 1600). (3) `hilux28 … λ mínimo ≥ 1,25`: o limitador de fumaça grampeia o combustível em λ 1,25; a medida lê 1,25 nas 4 sementes. (4) `potência por notch` (`diesel-governador.ts:89`): as frações do teste são as mesmas de `NOTCH_POT` (`src/engines/diesel/constantes.ts:34`), que o DSP usa para gerar a carga. (5) grupo `cambio` (`:352–356`): as faixas (por exemplo 1350–1700 rpm no Scania) foram escritas em volta do comportamento medido (1522–1592); o TECNICO dá "~1300" como alvo de meio pé; o medido hoje é 1352–1389 e a faixa do teste é 1250–1500.
- **Estado:** corrigível em `tools/**` (potência: medir em rampa livre, com o turbo e o governador de verdade, contra a ficha; o resto, renomear como "regressão" ou tirar da contagem de alvos).

**T-DSL-09 · Medidas verdes a menos de 5 % da tolerância (semente padrão).**
- **Severidade:** dívida.
- **Evidência** (`…/sem/sementes.txt`):

  | Medida | Alvo | Medido | Margem |
  |---|---|---|---|
  | hilux28 lenta: dp/dθ máx | 3–6 bar/° | 3,0 | no limite (T-DSL-02) |
  | hilux28 plena: ângulo do pico | 10–14° | 14,0 | no limite (13,9–14,0 nas 4 sementes) |
  | hilux28 plena: gás no coletor | 550–700 °C | 699 | 1 °C (T-DSL-02) |
  | GE 7FDL lenta: dp/dθ máx | 2–4 bar/° | 2,0 | no limite |
  | GE 7FDL notch 8: p_max | 125–145 bar | 125,5 | 0,5 bar |
  | gen500 degrau de 100 % | queda ≤ 10 % | 9,8 % | 0,2 ponto (T-DSL-02) |
  | hilux28 a 100 km/h em 6ª | 1700 ± 100 rpm | 1604 | 4 rpm |
  | real3 · caminhão carga: 400–1k | −9,2 a −0,5 dB | −9,1 | 0,1 dB |
  | real3 · picape lenta: CV | 0,135–0,32 | 0,14 | ≤ 0,01 |
  | real3 · gerador com carga: 1–2,5k | −16,8 a −6,8 dB | −16,5 | 0,3 dB |
  | envoltória · EMD notch 8 | 6,6–10,9 dB | 6,8 (6,6 a 6,8 nas sementes) | 0,2 dB; ruído liso pela mesma cadeia dá 6,1 |
  | envoltória · catc15 lenta: fundo no vão | ≤ −3 dB | −3,4 | 0,4 dB (`K_FUNDO` é "o maior valor" que passa, TECNICO) |
  | hilux28: lenta → plena carga | +18 a +25 dB | 24,6 | 0,4 dB |

- **Estado:** informativo para a etapa de som: essas medidas vão mudar de lado com qualquer retoque. A envoltória da EMD em N8 é o caso que importa: passa por 0,2 dB e é o mesmo defeito do desvio da GE (ver a lista de som, item 1).

**T-DSL-10 · Alvos do plano (DIESEL.md, seção 8) que nenhum teste mede.**
- **Severidade:** incompleto.
- **Evidência** (procurei em `tools/diesel-*.ts`): passo 2: `tauId` 0,5–0,8 ms e λ > 4 em lenta, `sweep` a 55 % (p_max 140–180 bar, λ 1,3–1,5); passo 6: `t_glow` de 7 s (2 s nos modernos), 1,5–3 s de partida a −10 °C, 20–30 % de queimas parciais nos primeiros 10 s; passo 7: VEB do Volvo; passo 8: intervalos de 22,5° do EMD, apito de 2,2 kHz em lenta e 8,1 kHz em N8 a ±5 % (hoje só a proeminência, entre 3,5 e 17,5 kHz), uivo do Roots do Detroit em 410 Hz ± 2 %, intervalos 56,5/63,5; tabela 2.6: linha "exterior, lenta fria" sem 2,5–6 kHz, curtose e p90/p10; tiques por evento nos pesados (2–3) e a forma do tique (subida 0,6–1,1 ms); tabela 2.5: temperatura do ar comprimido e do coletor no Jake. O `dd6v92` não entra em nenhuma medida de som (só lenta, potência e NaN); `duramax66`, `psd73`, `tdi19`, `om617` e `f1000mwm` só entram na "faixa de nível dos 8 leves"; `ranger32` e `volvod13` só aparecem dentro de uma média de classe.
- **Estado:** corrigível em `tools/**` (acrescentar); o que falhar vira lista para a etapa de som.

**T-DSL-11 · `npm run governador:diesel` sozinho sai com código 1.**
- **Severidade:** erro (de roteiro).
- **Evidência:** `tools/diesel-governador.ts:108–111` não conhece `DESVIOS`; as duas linhas que o `teste:diesel` mostra como "desvio" (`hilux28 degrau de 30%`, `emd710 potência por notch`) são FALHA no comando isolado ("2 falha(s)", código 1). Um `npm run verificar` que rode `governador:diesel` fica vermelho.
- **Estado:** corrigível em `tools/**`: `diesel-governador.ts` (e `diesel-lenta.ts`, `diesel-troca.ts`) importarem a mesma lista de desvios, ou o `verificar` chamar só `teste:diesel`, que já roda os três.

**T-DSL-12 · O teste de NaN lê 2 amostras por bloco e é o gargalo do tempo.**
- **Severidade:** dívida.
- **Evidência:** `tools/diesel-comum.ts:102`: confere `bl[0]`, `br[127]`, `rpmAvg` e `p[0]` a cada bloco de 128. Um NaN que entre nos filtros persiste e é pego; um Infinity ou um pico isolado, não; não há medida de pico nem de saturação em nenhum grupo do Diesel. O grupo `nan` (`diesel-valida.ts:361–370`) renderiza 16 presets × 4 cenários (até 80 s de áudio cada) num processo só: aos 19 min de execução era o único grupo ainda rodando.
- **Estado:** corrigível em `tools/**` (varrer as 256 amostras, registrar pico e fração acima de 0,7; partir o grupo por preset, como o `diesel-lenta.ts` já faz).

**T-DSL-13 · Desvios órfãos e textos desatualizados.**
- **Severidade:** dívida.
- **Evidência** (`…/sem/orfaos.cts`): três regexes não casam com nenhuma falha hoje: `/lenta → plena carga/` (`:33`; mede 24,6 dB, dentro), `/real3 · caminhão carga.*CV/` (`:41`; 0,19, dentro) e `/om617 (droop|caça)/` (`:54`; droop 8,6 % e caça ±1,9 %, dentro; o motivo escrito diz "droop 9,1 %" e "±2–3,6 %").
- **Estado:** corrigível em `tools/**` e em `docs/TECNICO.md` (some sozinho com o formato de T-DSL-01).

---

### Cena: achados

**T-CEN-01 · Duas linhas têm `ok: true` fixo.**
- **Severidade:** erro.
- **Evidência:** `tools/cena/portadores.ts:118–119` ("tabela de helicópteros: BPF B·Nr/60 e cauda"): imprime os valores e passa `true`; nada é comparado. `tools/cena/legado.ts:157` ("legado: carro a 6 m, Doppler…", alvo "registro"): `ok: true`. As duas entram na conta "93 ok".
- **Estado:** corrigível em `tools/**` (comparar com a tabela de 4.3 do CENA.md, como a linha das hélices em `portadores.ts:50–52` já faz; tirar a linha de registro da contagem).
- **Atualização (integração):** corrigido em `dedb829`: as duas linhas passaram a conferir de verdade (a tabela de helicópteros contra os valores do CENA 4.3; o Doppler do legado contra a teoria ± 2 Hz). As duas passam.

**T-CEN-02 · Tautologias: o teste compara o código com ele mesmo.**
- **Severidade:** erro.
- **Evidência:** (1) `tools/cena/medidas.ts:406` ("caminho por cima…"): `c.a100` é `maekawaDb(δ, 100)` (`src/scene/sombra.ts:112`) e o critério é `dentro(c.a100, maekawaDb(c.delta, 100), 0.01)`: f(x) contra f(x). (2) `tools/cena/portadores.ts:162–169` ("potência do gerador de tração por notch"): compara `loc.cargaL.P` com `NOTCH_POTENCIA[notch]·3200`, a mesma tabela e a mesma potência nominal que `src/carriers/locomotiva.ts:135` usa para gerar a carga; a saída é só "todas dentro". (3) `portadores.ts:159` e `:170` ("rampa de rotação 100 rpm/s"): mede a inclinação de `telemetria().rpmAlvo`, o alvo comandado, não a rotação do motor. (4) `tools/cena/legado.ts:159–161`: duas linhas conferem constantes lidas do `legado.json` contra critérios que o próprio JSON já satisfaz; a linha anterior já confere o JSON inteiro. (5) Alvos lidos do código, menos graves: sombra da roda oposta (`medidas.ts:391–403`, alvo = saída do `CalculoSombra`), RT60 (`:445`, alvo = `rt60Efetivo(amb)`), ar (`:359`, alvo = `atenuacaoIso`). Hoje esses três batem com o CENA.md (6,2/11,6 dB; tabela 2.10; 0,9/9,3/46,6 dB), mas um erro na tabela do código passaria junto.
- **Estado:** corrigível em `tools/**` (alvos numéricos escritos no teste, tirados do CENA.md; a rampa medida na rotação do eixo).

**T-CEN-03 · A Cena só está verde com as sementes de fábrica: com outras, 6 a 7 falhas.**
- **Severidade:** erro.
- **Evidência:** grupos `propagador sombra vento ambientes ouvinte trem niveis portadores motores niveis-motores` com todas as sementes deslocadas (logs `…/sem/cena.0x5a5a.log`, `cena.0x1234.log`, `cena.0xbeef.log`; comparação `python3 -I …/sem/cena-compara.py`): 6, 6 e 7 FALHAs.

  | Medida | Alvo | Semente de fábrica | Com outras sementes |
  |---|---|---|---|
  | modulação 1–4 kHz (túnel): frequência | 3,89 ± 0,1 Hz | 3,910 Hz | **1,945 e 1,847 Hz** em 2 de 3 (vira "desvio" pela desculpa embutida) |
  | modulação 1–4 kHz (céu): frequência | 3,89 ± 0,1 Hz | 3,966 Hz | 3,716 Hz em 1 de 3 (idem) |
  | padrão duplo dos truques | 82 ms (±10) | 79 ms | 64 e 71 ms: FALHA em 2 de 3 |
  | nulo do solo: pantógrafo | 63 Hz ± 3 % | 62 Hz (−2,6 %) | 67 Hz (+6,7 %): FALHA em 1 de 3 |
  | RT60 corte / RT60 ponte | ±15 % | 1,08 s / 0,43 s em 125 Hz | 1,23 s; 0,39–0,42 s: FALHA em 2 de 3 cada |
  | túnel − céu aberto no L_Aeq,tp | +7 ± 2 dB | 8,6 dB | 9,0 dB: FALHA em 1 de 3 |
  | lei de velocidade do rolamento | +8 ± 1 dB | 9,0 dB (no limite) | 9,0x: "desvio" em 2 de 3 |
  | carro a 6 m: bandas abeam contra o legado | ±1,5 dB | Δ −1,3 / +1,2 | Δ até −1,9 / +1,8: FALHA em 3 de 3 |
  | avião a 1500 m: 4 kHz rel. 500 Hz | ≤ −20 dB | −20,9 dB | −18,2, −17,4 e −18,6 dB: FALHA em 3 de 3 |
  | avião a 1500 m: bandas (ponto mais próximo; 10 s antes) | ±2 dB | Δ máx 2,2 e 2,1 ("desvio") | Δ até −3,0 e −4,4: FALHA |

  O caso que mais pesa é o primeiro: a modulação dos vãos a 3,9 Hz no túnel é o caso de validação da etapa 1 (PLANO, etapa 1) e só aparece como pico da envoltória com a semente de fábrica; com 2 das 3 outras o pico cai em ~1,9 Hz, e a profundidade é 1,9–2,2 dB em todas. O nulo do pantógrafo falha por resolução: a FFT de 16 384 pontos tem passo de 2,93 Hz e a tolerância é ±1,9 Hz (`medidas.ts:338–346`): só dois valores da grade passam. As comparações com o legado dependem também da realização dos motores (o deslocamento muda as sementes do Camaro e do 737): servem de retrato do que está publicado, não de critério robusto.
- **Estado:** corrigível em `tools/**` (resolução do nulo do pantógrafo; média de 3 sementes ou envoltória mais longa na modulação e no padrão duplo; margem nas comparações de banda). Informativo para a etapa de som: mexer em qualquer fonte do trem ou do carro muda a sequência aleatória e pode acender essas falhas.

**T-CEN-04 · Desculpas embutidas sem teto, inclusive para a alocação no laço de áudio.**
- **Severidade:** erro.
- **Evidência:** em `tools/cena/medidas.ts` e `motores.ts` o desvio é um texto anexado à linha (`ok ? undefined : '…'`): qualquer valor fora do alvo é aceito. Linhas com desculpa embutida: `medidas.ts:68–71`, `:125–126`, `:156–157`, `:204–207`, `:217–221`, `:252–253`, `:361–362`, `:378–379`; `motores.ts:231–232`, `:241–242`, `:254–255`. Só `motores.ts:124–126` tem teto (o desvio do avião vale até 4 dB no agudo e 2,2 dB no resto): é o formato certo. O caso sério é `:378–379` ("alocação no laço", alvo "sem alocação"): medi **15 coletas e 59 MB em 10 s** (pausa média 0,59 ms, máxima 2,41 ms) e, na segunda execução, 13 coletas e 51 MB (0,54 ms; 3,00 ms); o texto do desvio diz "poucos MB/s, coletas de ~0,06 ms" e aceitaria 1500 coletas do mesmo jeito. São 5 a 6 MB/s de lixo dentro do laço que roda no thread de áudio; as pausas medidas chegam a um quantum inteiro (2,67 ms), com a ressalva de que a máquina estava carregada. A desculpa da Hilux em lenta (`motores.ts:231–232`) está dormente: a medida hoje passa (68,8 dB(A)).
- **Estado:** corrigível em `tools/**` (teto por desvio, como em T-DSL-01; para a alocação, um teto em MB/s e em pausa máxima). A alocação em si é defeito de execução em `src/scene/` (`Cena.processar` e geradores de fundo, segundo o próprio texto do desvio; não localizei a linha): fica registrada para a frente de robustez.

**T-CEN-05 · As medidas de CPU dependem da carga da máquina e olham só a média.**
- **Severidade:** dívida.
- **Evidência:** `tools/cena/medidas.ts:377` (critério `la.fracao < 0.5`, a média) e `:380–381`; `tools/cena/cpu.ts:30–33` usa `performance.now()`.

  | Laço do worklet, trem no túnel (63 fontes) | média | p99 | máximo |
  |---|---|---|---|
  | TECNICO.md | 334 µs (12,5 %) | 436 µs | — |
  | execução A (carga ~60–75) | 690 µs (25,9 %) | 2141 µs (80 % do quantum) | 6869 µs |
  | execução B | 584 µs (21,9 %) | 994 µs | 6958 µs |

  "48 fontes, 10 s": 7,8 % no TECNICO, 17,3 % e 11,1 % aqui. Passou nas duas, mas o critério é a média: um p99 de 80 % do quantum e máximos de 2,6 quanta não reprovam.
- **Estado:** corrigível em `tools/**` (critério também no p99; medir com `process.cpuUsage()` além do relógio; repetir 3 vezes e ficar com o melhor).

**T-CEN-06 · O que a página toca não é o que o teste mede.**
- **Severidade:** incompleto.
- **Evidência:** (1) nenhuma das 105 medidas passa por `CenaDSP` (`src/scene/dsp-cena.ts`: montagem do preset, mensagens, `master`, `tanh`): `tools/cena/render-passagem.ts:8` chama `CenaPassagem.processar` direto, "sem tanh". `grep -rl "dsp-cena\|CenaDSP" tools` só acha `tools/eletrico/`. Nenhum preset da Passagem é montado offline por `tools/cena`. (2) Hélice, rotor, gerador e locomotiva são validados com o `MotorTeste` de bancada, com constantes escolhidas para o alvo: o droop de 2–3 % do R44 sai de um atraso de torque de 1,1 s (`portadores.ts:105`, ajustável por `TAU_ROTOR`); o gerador, de `Tmax 4500, J 60, tau 0,08` (`:125`); o cabeçalho (`:1–4`) ainda diz que diesel e turboélice "não foram migrados". As combinações de verdade (R44 + O-540 de `PRESETS_AVIACAO`, `gen500` + `Gerador`, `emd710` + `Locomotiva`, radial + hélice) não têm teste de governador nem de droop em `tools/cena`. (3) Critérios do plano do CENA.md (seção 5) sem medida: passo 9, carro na `cabine` a ±1 dB do `int` legado, `cofre` a ±1 dB do `bay`, `ponteira` a ±1 dB do `pipe`; passo 10, WAV idêntico ao legado nos presets turboélice em `takeoff` e `flyby` (o que existe, `motores.ts:158–182`, compara só o tom da hélice do Caravan com o ruído desligado); passo 11, "sem estalos" ao arrastar os controles (pico de diferença entre blocos < 0,1 FS). (4) `motores.ts:146–147` imprime "pico na saída 1,23 FS" no estrondo e não confere nada com ele.
- **Estado:** corrigível em `tools/**` (o teste de presets da Passagem pela `CenaDSP` cobre o item 1; acrescentar os casos com o motor de verdade); os critérios do passo 9 são para o dono decidir se ainda valem.

**T-CEN-07 · Alvos do CENA.md trocados no teste e rótulos mais estreitos que o critério.**
- **Severidade:** dívida.
- **Evidência:** commit `c1c4450`: profundidade da modulação de "≥ 6 dB" para "≥ 3 dB" (`medidas.ts:67`), balanço em 60–150 Hz de +4 para −3 dB (`:212`); os dois com a justificativa das gravações no código e no TECNICO, mas o `docs/CENA.md` 2.11 continua com os números antigos. "Curva nível × x ±1 dB" do CENA virou "±1 dB (rms)" (`motores.ts:108`): rms 0,94 dB, máximo 1,67 dB. Rótulos: "centroide ≈ 1,2 kHz" aceita 800–1800 Hz (`medidas.ts:220`); "dois picos a 82 ms" aceita 72–92 ms com vale ≥ 1 dB, e o "+ 180 ms" do CENA saiu (`:98–99`); "cauda/nariz 0,70" aceita ±0,05 (`:158`). EMD em N8 a 15 m: o alvo "~95 dB(A)" é descrito como "87 dB(A) a 30 m mais 6 dB", que dá 93 (`motores.ts:241`, TECNICO → Níveis absolutos).
- **Estado:** corrigível em `tools/**` e nos documentos (nota no topo do CENA.md com os dois alvos trocados; rótulo igual ao critério).

**T-CEN-08 · Medidas verdes a menos de 5 % da tolerância (sementes de fábrica).**
- **Severidade:** dívida.
- **Evidência:** lei de velocidade do rolamento 9,0 dB (limite 9,0); R44 harmônicos 10–30 dentro de 15 dB: 14,8; L_Aeq,tp a céu aberto 105,4 dB(A) (piso 105,0); túnel − céu 8,6 (teto 9,0); avião 4 kHz rel. 500 Hz −20,9 (teto −20); carro a 6 m bandas Δ −1,3/+1,2 (±1,5); RT60 da ponte em 125 Hz 0,43 s (piso 0,425); cabine do trem em 2 kHz 42,3 dB (piso 42,0); padrão duplo 79 ms (piso 72). Várias delas são as que caem com outra semente (T-CEN-03).
- **Estado:** informativo; some com a correção de T-CEN-03.

**T-CEN-09 · O TECNICO não bate mais com a saída do teste.**
- **Severidade:** dívida.
- **Evidência:** `docs/TECNICO.md` → Cena e portadores → Validação diz "92 ok, 13 desvios documentados"; a saída é 93 ok e 12 desvios (a Hilux em lenta passou a 68,8 dB(A); o TECNICO dá 66,7 e "45,0 a 7,5 m", hoje 46,8). Tabela "Não pode piorar": avião no ponto mais próximo Δ "+2,6 / +3,8" no agudo; hoje +2,2 / +1,2. CPU: ver T-CEN-05. Lista "Pendente (TODO)": ver abaixo.
- **Estado:** corrigível em `docs/TECNICO.md`.

**T-CEN-10 · Níveis absolutos: o turboélice sai 10 dB alto e passa como "desvio".**
- **Severidade:** erro (de calibração, aceito pelo teste).
- **Evidência:** `tools/cena/motores.ts:254–255`: ATR 72 em decolagem a 100 m, L_AFmax **95,0 dB(A)** contra 85 ± 3 (94,8 a 96,7 com outras sementes). Na linha "hélice idêntica" o tom do Caravan tem pico de 120,0 dB a 30 m. O motivo escrito: a Turbina nunca foi calibrada em absoluto. Na Passagem isso põe o preset `aviao-rasante` numa escala diferente da dos carros e dos trens; pelo texto do próprio desvio o 737 do mesmo modelo "também sai alto" (112,5 dB a 30 m por barramento), o que alcançaria `jato-1500` e `caca-supersonico` (não medi esses dois).
- **Estado:** para a etapa de som (calibração de nível da Turbina na Cena); a decisão de mexer no mostrador de dB da página Turbina é do dono.

---

### Tabela de todos os desvios do Diesel (66)

Medido com a semente padrão (`…/sem/*.12345.json`; tabela gerada por `…/sem/tabela.py`). Nos alvos das classes do real3 os números já incluem a folga de ±2 ou ±5 dB.

| # | Medida (chave) | Alvo | Medido | Classe | Gravidade | O que é |
|---|---|---|---|---|---|---|
| 1 | picape lenta quente (hilux28): T na abertura do escape | 600–750 K | 489 K | c | baixa | zona única com o combustível de lenta: gás 110–170 K mais frio na abertura; pulso do escape ≈ 1 dB mais fraco (∝ √T) |
| 2 | picape lenta fria −10 °C (hilux28): p_max | 40–55 bar | 57.3 bar | c | baixa | mesma causa: parede fria tira só 40 K da temperatura na injeção; o som frio passa no teste de banda (+7 dB em 1–4 kHz) |
| 3 | picape lenta fria −10 °C (hilux28): ângulo do pico | 8–15° | 5.6° | c | baixa | no frio o atraso de ignição quase não cresce (3 %): a batida fria sai no mesmo ponto da quente, só mais forte |
| 4 | picape lenta fria −10 °C (hilux28): dp/dθ máx | 5–9 bar/° | 4.6 bar/° | c | baixa | mesma causa: parede fria tira só 40 K da temperatura na injeção; o som frio passa no teste de banda (+7 dB em 1–4 kHz) |
| 5 | picape lenta fria −10 °C (hilux28): T na abertura do escape | 550–700 K | 521 K | c | baixa | mesma causa: parede fria tira só 40 K da temperatura na injeção; o som frio passa no teste de banda (+7 dB em 1–4 kHz) |
| 6 | picape lenta fria −10 °C (hilux28): gás no coletor | 100–180 °C | 182 °C | c | baixa | mesma causa: parede fria tira só 40 K da temperatura na injeção; o som frio passa no teste de banda (+7 dB em 1–4 kHz) |
| 7 | picape plena 3000 rpm, 2,4 bar (hilux28): T na abertura do escape | 1100–1300 K | 1321 K | c | baixa | 21 K (1,6 %) acima da janela; sem efeito audível |
| 8 | caminhão lenta 600 rpm (catc15): T na abertura do escape | 600–700 K | 478 K | c | baixa | zona única com o combustível de lenta: gás 110–170 K mais frio na abertura; pulso do escape ≈ 1 dB mais fraco (∝ √T) |
| 9 | caminhão plena 1900 rpm, 2,7 bar (catc15): p_max | 160–200 bar | 139.6 bar | c | média | o C15 em carga respira ar demais (λ 2,5 contra ≈ 1,8): pico 20 bar abaixo e gás 90–190 °C mais frio; o pulso de carga do caminhão sai fraco |
| 10 | caminhão plena 1900 rpm, 2,7 bar (catc15): ângulo do pico | 10–14° | 9.7° | c | média | o C15 em carga respira ar demais (λ 2,5 contra ≈ 1,8): pico 20 bar abaixo e gás 90–190 °C mais frio; o pulso de carga do caminhão sai fraco |
| 11 | caminhão plena 1900 rpm, 2,7 bar (catc15): dp/dθ máx | 6–9 bar/° | 5.8 bar/° | c | média | o C15 em carga respira ar demais (λ 2,5 contra ≈ 1,8): pico 20 bar abaixo e gás 90–190 °C mais frio; o pulso de carga do caminhão sai fraco |
| 12 | caminhão plena 1900 rpm, 2,7 bar (catc15): T na abertura do escape | 1150–1300 K | 956 K | c | média | o C15 em carga respira ar demais (λ 2,5 contra ≈ 1,8): pico 20 bar abaixo e gás 90–190 °C mais frio; o pulso de carga do caminhão sai fraco |
| 13 | caminhão plena 1900 rpm, 2,7 bar (catc15): gás no coletor | 550–650 °C | 463 °C | c | média | o C15 em carga respira ar demais (λ 2,5 contra ≈ 1,8): pico 20 bar abaixo e gás 90–190 °C mais frio; o pulso de carga do caminhão sai fraco |
| 14 | EMD 710 lenta 269 rpm: ângulo do pico | 5–10° | 1.8° | c | baixa | a lenta do 2T acende antes do PMS (pico a 1,8°) |
| 15 | EMD 710 lenta 269 rpm: T na abertura do escape | 650–750 K | 517 K | c | baixa | zona única com o combustível de lenta: gás 110–170 K mais frio na abertura; pulso do escape ≈ 1 dB mais fraco (∝ √T) |
| 16 | EMD 710 lenta 269 rpm: gás no coletor | 180–250 °C | 136 °C | c | baixa | lavagem de zona única: o ar que atravessa esfria o coletor (136 e 361 °C); o ruído da turbina e o pulso saem de um gás frio demais |
| 17 | EMD 710 notch 8: ângulo do pico | 10–14° | 8.7° | c | baixa | lavagem de zona única: o ar que atravessa esfria o coletor (136 e 361 °C); o ruído da turbina e o pulso saem de um gás frio demais |
| 18 | EMD 710 notch 8: gás no coletor | 480–560 °C | 361 °C | c | baixa | lavagem de zona única: o ar que atravessa esfria o coletor (136 e 361 °C); o ruído da turbina e o pulso saem de um gás frio demais |
| 19 | Jake a 1900 rpm (catc15): pressão no PMS | 35–50 bar | 67.6 bar | c | baixa | ar a 68 bar no PMS (alvo 35–50): o turbo girado pelo próprio Jake sobrecarrega o cilindro |
| 20 | leve · cofre · hilux28 lenta: curtose 1–4 kHz | 6–9 | 15,3 | a | alta | no cofre a lenta é uma fila de estalos isolados (curtose 15; gravações 6,7–9,2); o texto do desvio ainda diz 11 |
| 21 | leve · cofre · hilux28 lenta: p90/p10 | 15 ± 3 dB | 32,1 | a | alta | entre uma batida e outra o 1–4 kHz cai 32 dB (gravações 15–16,5): silêncio no lugar da textura mecânica contínua do motor de verdade |
| 22 | leve · exterior · ram67 lenta fria: 1–2,5 kHz | −8 ± 4 dB | -2,9 | a | média | Cummins frio por fora: grave do escape de mais (centroide 188 Hz) e batida 5 dB acima da referência; referência de um vídeo só, em conflito com o real3 |
| 23 | leve · exterior · ram67 lenta fria: centroide | 270–450 Hz | 186,7 | a | média | Cummins frio por fora: grave do escape de mais (centroide 188 Hz) e batida 5 dB acima da referência; referência de um vídeo só, em conflito com o real3 |
| 24 | leve · exterior · ram67 lenta fria: 1–4 kHz | −8 ± 4 dB | -2,8 | a | média | Cummins frio por fora: grave do escape de mais (centroide 188 Hz) e batida 5 dB acima da referência; referência de um vídeo só, em conflito com o real3 |
| 25 | pesado · escape · catc15 lenta: 1–2,5 kHz | ≤ −18 dB | -15,3 | a | baixa | atrás do escape do caminhão ouve-se mecânica demais (1–2,5 kHz 3–6 dB acima; centroide 322 Hz contra 125–140 da tabela 2.6) |
| 26 | pesado · escape · catc15 lenta: centroide | 125–200 Hz | 321,9 | a | baixa | atrás do escape do caminhão ouve-se mecânica demais (1–2,5 kHz 3–6 dB acima; centroide 322 Hz contra 125–140 da tabela 2.6) |
| 27 | real3 · picape lenta (hilux28, ranger32, ram67): 60–150 | -3.2 a 15.9 dB | 16,4 | a | média | lenta de picape com 60–150 Hz 16 dB acima de 150–400: mais grave que a gravação mais grave da classe, mesmo com a média de três presets |
| 28 | real3 · caminhão lenta (catc15, volvod13): 30–60 | -8.3 a 2.7 dB | 10,8 | a | média | subgrave de 30 Hz 8 dB acima do teto das gravações (11,0 contra ≤ 2,7): ronco que come a margem de volume e não soa como peso |
| 29 | real3 · caminhão lenta (catc15, volvod13): 60–150 | 1.2 a 10.0 dB | 11,0 | a | média | 1 dB acima do teto; mesma causa do 30–60 Hz |
| 30 | real3 · caminhão lenta (catc15, volvod13): CV do knock | 0.13–0.25 | 0,28 | a | baixa | batida de lenta do caminhão irregular demais (CV 0,28 a 0,31 conforme a semente; faixa do teste 0,125–0,25) |
| 31 | real3 · ônibus carga (onibusisl): 400–1k | -6.9 a 2.8 dB | -11,8 | a | média | ônibus em carga abafado: 400 Hz–1 kHz 5 dB abaixo do piso da classe e agudo 3–4,5 dB abaixo |
| 32 | real3 · ônibus carga (onibusisl): 2,5–6k | -19.6 a -3.8 dB | -24,3 | a | média | ônibus em carga abafado: 400 Hz–1 kHz 5 dB abaixo do piso da classe e agudo 3–4,5 dB abaixo |
| 33 | real3 · ônibus carga (onibusisl): 6–12k | -31.4 a -12.0 dB | -34,3 | a | média | ônibus em carga abafado: 400 Hz–1 kHz 5 dB abaixo do piso da classe e agudo 3–4,5 dB abaixo |
| 34 | real3 · ônibus carga (onibusisl): CV do knock | 0.14–0.27 | 0,09 | a | média | ônibus em carga regular demais (CV 0,10; faixa do teste 0,14–0,27): soa a máquina, não a motor |
| 35 | real3 · gerador sem carga (gen500): 30–60 | -19.6 a -9.6 dB | -25,3 | d | alta | a medida ouve o grupo gerador pela câmera de carro (4 m atrás do escape); as gravações são ao lado do grupo; uma gravação só por classe (±5 dB). Na página Diesel o gerador é só escape: sem ventilador nem alternador |
| 36 | real3 · gerador sem carga (gen500): 60–150 | -6.7 a 3.3 dB | 11,8 | d | alta | a medida ouve o grupo gerador pela câmera de carro (4 m atrás do escape); as gravações são ao lado do grupo; uma gravação só por classe (±5 dB). Na página Diesel o gerador é só escape: sem ventilador nem alternador |
| 37 | real3 · gerador sem carga (gen500): 400–1k | -6.6 a 3.4 dB | -16,5 | d | alta | a medida ouve o grupo gerador pela câmera de carro (4 m atrás do escape); as gravações são ao lado do grupo; uma gravação só por classe (±5 dB). Na página Diesel o gerador é só escape: sem ventilador nem alternador |
| 38 | real3 · gerador sem carga (gen500): 1–2,5k | -10.1 a -0.1 dB | -14,8 | d | alta | a medida ouve o grupo gerador pela câmera de carro (4 m atrás do escape); as gravações são ao lado do grupo; uma gravação só por classe (±5 dB). Na página Diesel o gerador é só escape: sem ventilador nem alternador |
| 39 | real3 · gerador sem carga (gen500): 2,5–6k | -14.9 a -4.9 dB | -18,6 | d | alta | a medida ouve o grupo gerador pela câmera de carro (4 m atrás do escape); as gravações são ao lado do grupo; uma gravação só por classe (±5 dB). Na página Diesel o gerador é só escape: sem ventilador nem alternador |
| 40 | real3 · gerador sem carga (gen500): 6–12k | -16.6 a -6.6 dB | -31,1 | d | alta | a medida ouve o grupo gerador pela câmera de carro (4 m atrás do escape); as gravações são ao lado do grupo; uma gravação só por classe (±5 dB). Na página Diesel o gerador é só escape: sem ventilador nem alternador |
| 41 | real3 · gerador sem carga (gen500): centroide | 500–1000 Hz | 294 Hz | d | alta | a medida ouve o grupo gerador pela câmera de carro (4 m atrás do escape); as gravações são ao lado do grupo; uma gravação só por classe (±5 dB). Na página Diesel o gerador é só escape: sem ventilador nem alternador |
| 42 | real3 · gerador sem carga (gen500): CV do knock | 0.16–0.22 | 0,23 | d | alta | a medida ouve o grupo gerador pela câmera de carro (4 m atrás do escape); as gravações são ao lado do grupo; uma gravação só por classe (±5 dB). Na página Diesel o gerador é só escape: sem ventilador nem alternador |
| 43 | real3 · gerador com carga (gen500): 30–60 | -16.7 a -6.7 dB | -26,0 | d | alta | a medida ouve o grupo gerador pela câmera de carro (4 m atrás do escape); as gravações são ao lado do grupo; uma gravação só por classe (±5 dB). Na página Diesel o gerador é só escape: sem ventilador nem alternador |
| 44 | real3 · gerador com carga (gen500): 400–1k | -8.5 a 1.5 dB | -16,1 | d | alta | a medida ouve o grupo gerador pela câmera de carro (4 m atrás do escape); as gravações são ao lado do grupo; uma gravação só por classe (±5 dB). Na página Diesel o gerador é só escape: sem ventilador nem alternador |
| 45 | real3 · gerador com carga (gen500): 2,5–6k | -20.7 a -10.7 dB | -23,6 | d | alta | a medida ouve o grupo gerador pela câmera de carro (4 m atrás do escape); as gravações são ao lado do grupo; uma gravação só por classe (±5 dB). Na página Diesel o gerador é só escape: sem ventilador nem alternador |
| 46 | real3 · gerador com carga (gen500): 6–12k | -27.5 a -17.5 dB | -35,8 | d | alta | a medida ouve o grupo gerador pela câmera de carro (4 m atrás do escape); as gravações são ao lado do grupo; uma gravação só por classe (±5 dB). Na página Diesel o gerador é só escape: sem ventilador nem alternador |
| 47 | real3 · gerador com carga (gen500): CV do knock | 0.19–0.25 | 0,19 | d | alta | a medida ouve o grupo gerador pela câmera de carro (4 m atrás do escape); as gravações são ao lado do grupo; uma gravação só por classe (±5 dB). Na página Diesel o gerador é só escape: sem ventilador nem alternador |
| 48 | real3 · locomotiva lenta (emd710): 60–150 | -4.5 a 6.4 dB | 18,1 | a | alta | EMD em lenta escura e ribombante (60–150 Hz 12 dB acima do teto; 400 Hz–1 kHz 7 dB e 6–12 kHz 9 dB abaixo do piso; centroide 235 Hz contra ≥ 481): faltam ventiladores, sopradores e compressor na página Diesel |
| 49 | real3 · locomotiva lenta (emd710): 400–1k | -2.9 a 3.8 dB | -10,3 | a | alta | EMD em lenta escura e ribombante (60–150 Hz 12 dB acima do teto; 400 Hz–1 kHz 7 dB e 6–12 kHz 9 dB abaixo do piso; centroide 235 Hz contra ≥ 481): faltam ventiladores, sopradores e compressor na página Diesel |
| 50 | real3 · locomotiva lenta (emd710): 2,5–6k | -16.5 a 6.6 dB | -17,1 | a | alta | EMD em lenta escura e ribombante (60–150 Hz 12 dB acima do teto; 400 Hz–1 kHz 7 dB e 6–12 kHz 9 dB abaixo do piso; centroide 235 Hz contra ≥ 481): faltam ventiladores, sopradores e compressor na página Diesel |
| 51 | real3 · locomotiva lenta (emd710): 6–12k | -19.8 a 5.5 dB | -29,1 | a | alta | EMD em lenta escura e ribombante (60–150 Hz 12 dB acima do teto; 400 Hz–1 kHz 7 dB e 6–12 kHz 9 dB abaixo do piso; centroide 235 Hz contra ≥ 481): faltam ventiladores, sopradores e compressor na página Diesel |
| 52 | real3 · locomotiva lenta (emd710): centroide | 481–2244 Hz | 235 Hz | a | alta | EMD em lenta escura e ribombante (60–150 Hz 12 dB acima do teto; 400 Hz–1 kHz 7 dB e 6–12 kHz 9 dB abaixo do piso; centroide 235 Hz contra ≥ 481): faltam ventiladores, sopradores e compressor na página Diesel |
| 53 | real3 · EMD notch 8 (emd710): 30–60 | -0.8 a 10.5 dB | -17,0 | b | — | alvo em conflito com o Apêndice A do DIESEL.md (60–150 Hz: +14 a +16 aqui, +2,7 lá) e a fonte (real3) não existe mais |
| 54 | real3 · EMD notch 8 (emd710): 60–150 | 12.2 a 18.3 dB | -3,3 | b | — | alvo em conflito com o Apêndice A do DIESEL.md (60–150 Hz: +14 a +16 aqui, +2,7 lá) e a fonte (real3) não existe mais |
| 55 | real3 · EMD notch 8 (emd710): 1–2,5k | -14.0 a 2.2 dB | 3,1 | a | alta | EMD em N8 com 1–2,5 kHz acima de 150–400 Hz (+3,1): é o ruído da turbina; contra o Apêndice A do DIESEL.md (−4,2) são 7 dB a mais |
| 56 | real3 · EMD notch 8 (emd710): 6–12k | -10.7 a 6.7 dB | -14,9 | b | — | alvo em conflito com o Apêndice A do DIESEL.md (60–150 Hz: +14 a +16 aqui, +2,7 lá) e a fonte (real3) não existe mais |
| 57 | real3 · GE 7FDL notch 8 (ge7fdl): centroide | 330–610 Hz | 304 Hz | b | — | uma gravação só; o Apêndice A dá 300 Hz para a GE em N8 e o simulado dá 304 |
| 58 | real3 · GE 7FDL notch 8 (ge7fdl): CV do knock | 0.24–0.30 | 0,15 | a | média | GE em carga regular demais (CV 0,15; gravação 0,27) |
| 59 | envoltória · GE 7FDL notch 8 (ge7fdl; U23B 9,7): p90/p10 de 2–6 kHz | 8.7–10.7 dB | 6.8 dB | a | alta | agudo da GE em N8 é ruído liso: p90/p10 de 6,8 dB, quase o do ruído estacionário pela mesma cadeia (6,1); é o "mar" |
| 60 | f1000mwm pé no fundo da lenta: λ < 1,3 | 0,5–1,5 s | 0.00 s (λ mín 1.69) | a | baixa | a fumaça preta do transiente não acontece (0 s): o aspirado não desce de λ 1,64 e a GE sobe de notch limpa; o "ronco rouco" da fumaçada não existe |
| 61 | ge7fdl subindo cada notch: λ < 1,3 | 2–4 s por notch | 0.00 s em média (0.0 0.0 0.0 0.0 0.0 0.0 0.0) | a | baixa | a fumaça preta do transiente não acontece (0 s): o aspirado não desce de λ 1,64 e a GE sobe de notch limpa; o "ronco rouco" da fumaçada não existe |
| 62 | catc15 Jake 6: 2,5–6 kHz vs plena carga | +6 ± 3 dB | -1.1 dB | a | média | o Jake não rasga: agudo 1 dB abaixo da plena carga, quando devia ficar 3–9 dB acima |
| 63 | catc15 Jake 6: potência de frenagem | 70–90% de 410 kW | 282 kW (69%) | c | baixa | 69 % contra 70 %; sem efeito audível |
| 64 | scaniav8 freio de descarga: pulsos vs sem freio | −15 a −20 dB | -7.7 dB | a | baixa | o freio de descarga abafa os pulsos 7,7 dB, não 15–20: o motor continua "falando" com a borboleta fechada |
| 65 | hilux28 degrau de 30% do torque em lenta | queda ≤ 8%, ±2% em < 2 s | queda 7.8%, recupera em 5.65 s | a | baixa | com carga na lenta o giro não assenta em ±2 % dentro dos 6 s medidos (o teste lê 5,65 s numa janela de 6 s) |
| 66 | emd710 potência por notch | ±3% | pior 3.2% | c | baixa | 3,2 % contra 3 % num notch; sem efeito audível |

### Tabela de todos os desvios da Cena (12)

| # | Medida (chave) | Alvo | Medido | Classe | Gravidade | O que é |
|---|---|---|---|---|---|---|
| 1 | ar a 1500 m: atenuação 4 kHz − 500 Hz | 46,6 ± 1,5 dB (ISO) | 22,7 dB | c | média | dois polos por fonte não chegam à ISO: um avião a mais de 1 km chega 24 dB mais claro em 4 kHz do que o ar real deixaria (o legado tinha o mesmo limite) |
| 2 | modulação 1–4 kHz (túnel): profundidade p90−p10 | ≥ 3 dB (o CENA pedia ≥ 6) | 2,0 dB | c | média | no túnel o "wu-wu-wu" dos vãos quase some sob a reverberação; o alvo já tinha sido baixado de 6 para 3 |
| 3 | pulsos de vão 50–200 Hz (túnel) ≥ 8 dB | 9 pulsos | 0 | b | — | o alvo do CENA não aparece em nenhuma das seis gravações |
| 4 | onda de nariz: σ | 51 ± 5 ms | 41,3 ms | b | — | o CENA usa nariz de 15 m em 2.6 e de 12 m em 4.6 |
| 5 | L_AFmax céu aberto | 113 ± 3 dB(A) | 106,7 dB(A) | b | — | a crista de 5 dB da tabela não existe nas gravações (0,7–1,8 dB); o L_Aeq,tp passa, a 0,4 dB do piso |
| 6 | L_AFmax túnel | 120 ± 3 dB(A) | 114,8 dB(A) | b | — | idem |
| 7 | lei de velocidade do aero 160 → 300 km/h | +16 ± 1 dB | 17,7 dB | b | baixa | a convecção da Cena soma ~1 dB à lei da fonte; a do rolamento tem a mesma causa e "passa" em 9,0 (limite 9,0) |
| 8 | alocação no laço (--trace-gc, 10 s) | sem alocação | 15 coletas, 59 MB; pausa média 0,59 ms, máx. 2,41 ms | a | média | o laço da Cena gera 5–6 MB/s de lixo: coletas no thread de áudio, risco de estalo; não é defeito de timbre |
| 9 | avião a 1500 m: bandas no ponto mais próximo | ±2 dB por banda | Δ máx. +2,2 dB (2,5–6 kHz) | c | baixa | 0,2 dB fora: o ar da Cena contra o do legado |
| 10 | avião a 1500 m: bandas 10 s antes | ±2 dB por banda | Δ +2,1 dB (60–150 Hz) | c | baixa | 0,1 dB fora: pente do solo na janela de 2 s |
| 11 | locomotiva EMD em N8, parada, a 15 m: L_Aeq | ~95 ± 3 dB(A) | 88,5 dB(A) | b | baixa | o alvo é o teto legal (87 dB(A) a 30 m) mais 6 dB, que dá 93 e não 95; uma locomotiva real fica abaixo do teto |
| 12 | ATR 72 em decolagem a 100 m: L_AFmax | ~85 ± 3 dB(A) | 95,0 dB(A) | a | alta | o turboélice sai 10 dB alto: a escala absoluta da Turbina nunca foi calibrada (T-CEN-10) |

---

### Pendências (TODO) conferidas no código

**Cena** (`docs/TECNICO.md` → Adaptadores de motor → Pendente):

| Item do TECNICO | Hoje | Evidência |
|---|---|---|
| Fontes da Turbina separadas por fonte | pendente | `src/engines/turbina/motor.ts:76–84`: duas fontes por grupo de motores (hélice ou admissão na frente, jato atrás) |
| Turboeixo: "o rotor fica sem motor" | pendente, texto desatualizado | nenhum preset com `turboeixo` em `src/engines/turbina/presets.ts`; o rotor hoje leva pistão, radial e rotativo (`src/carriers/compat.ts`, `USO_REAL.rotor`) |
| Escala absoluta da Turbina | pendente | T-CEN-10 |
| Referência própria para o diesel leve | medida hoje passa (68,8 dB(A)); decisão não tomada | `tools/cena/motores.ts:231`; a desculpa ficou dormente |
| Ponteiras nos lados reais | não conferi | — |
| Pneus e aero do carro | pendente | `src/carriers/carro.ts:9` (`TODO`) |
| Casca do gerador com carenagem | pendente; o campo existe e não faz nada | `src/carriers/gerador.ts:27` e `:41` (`carenagem: true`) não é lido em lugar nenhum; `dentro` só serve para pular a sombra (`src/scene/propagador.ts:286`) e para a rota da cabine (`src/scene/cena.ts:262`) |

Comentários `TODO` obsoletos (o trabalho foi feito, o comentário ficou): `src/scene/supersonico.ts:10–12` (o propagador já usa `raizesEmissao`: `propagador.ts:17`, `:239`, `:391`); `src/engines/diesel/dsp.ts:20–22`, `:91`, `:104` (`TODO(integração carriers/)`: `src/engines/diesel/motor.ts:129` já chama `dsp.acoplar(carga)`, e `:113–123` já mandam `rpmAlvo`; a interface `CargaExterna` duplica `Carga` de `src/scene/tipos.ts`). Ainda válido: `src/carriers/locomotiva.ts:116` (buzina: só os parciais).

**Diesel** (o TECNICO não tem seção "Pendente"; as pendências estão dentro de "Desvios conhecidos" e da 3ª passada):

| Pendência citada | Hoje |
|---|---|
| "falta o portador gerador da Cena com o ouvinte ao lado do grupo" (`diesel-valida.ts:38`) | o portador existe (`src/carriers/gerador.ts`, fontes `alternador` e `ventilador`; preset `gerador-bancada` da Passagem). Falta o teste medir por ele, e a página Diesel continua sem essas fontes: o `DieselDSP` só tem a inércia e a carga do alternador (`dsp.ts:237`, `:977`) |
| "faltam os ventiladores, o compressor de ar e os sopradores" da EMD (`:39–40`) | existem no portador da Cena (`src/carriers/locomotiva.ts`: `turbo`, `soprador.tracao`, `compressor.ar`, `grades.freio`, `buzina`), não no portador interno da página Diesel, que é o que o teste mede |
| "Falta textura mecânica presa ao ciclo, não ruído liso" (TECNICO, 3ª passada) | pendente; é o item 2 da lista de som |
| Fumaça preta no transiente | pendente (0 s nos dois casos) |
| Coletor de admissão a 310 K fixos (C15 com λ 2,5) | pendente |
| Lavagem de zona única no 2T | pendente (limitação aceita) |

---

### Para a etapa de som (Diesel), por prioridade

Antes de começar: decidir a referência das locomotivas (T-DSL-03) e lembrar que qualquer retoque muda a sequência aleatória e pode acender três falhas sem relação com o retoque (T-DSL-02).

1. **Locomotivas em notch 8 soam a chiado contínuo, o "mar"** (`emd710` e `ge7fdl`; página Diesel e o preset "Locomotiva EMD em N8" da Passagem). O agudo não acompanha as explosões: a envoltória de 2–6 kHz tem contraste de 6,8 dB nas duas, quando ruído parado pela mesma conta dá 6,1 e as gravações dão 7,6 a 9,9. A GE é desvio; a EMD passa por 0,2 dB. Na EMD em N8 a banda de 1–2,5 kHz fica 3,1 dB **acima** da de 150–400 Hz (DIESEL.md: −4,2) e o centroide vai a 1516 Hz (DIESEL.md: 840). Pelo texto do próprio desvio, a fonte é a banda larga da turbina.
2. **Lenta de perto é estalo solto sobre silêncio** (`hilux28` no cofre; vale para os leves). Entre uma batida e a próxima o 1–4 kHz cai 32 dB (gravações: 15 a 16,5) e a curtose é 15,3 (gravações: 6,7 a 9,2). O TECNICO mede o mesmo no caminhão: contraste de 24,7 dB em 2–6 kHz contra 9–10 das gravações. Falta o som mecânico contínuo e preso ao giro (engrenagens, bomba, válvulas); o desvio hoje põe a culpa na gravação.
3. **EMD em lenta é escura e ribombante** (`emd710`, página Diesel). Contra a tabela 4.4 do DIESEL.md: 60–150 Hz +18,1 (alvo +8,4), 400 Hz–1 kHz −10,3 (alvo +3,3), 2,5–6 kHz −17,1 (alvo −5,8), 6–12 kHz −29,0 (alvo −13,3), centroide 235 Hz (alvo 700). A GE em lenta tem o mesmo desenho, mais leve (400 Hz–1 kHz −9,5 contra −1,7; centroide 198 Hz contra 415) e hoje não tem medida nenhuma. Os sopradores e o compressor existem no portador da Cena e não na página Diesel.
4. **O gerador soa como escape de caminhão** (`gen500`, página Diesel). Sem carga: 60–150 Hz +11,8 (gravação −1,7), 400 Hz–1 kHz −16,5 (gravação −1,6), 6–12 kHz −31,1 (gravação −11,6), centroide 294 Hz (gravação 500–1000). Faltam o ventilador e o alternador na página; o teste precisa medir ao lado do grupo, pelo portador da Cena.
5. **Grave de lenta exagerado.** Caminhões (`catc15`, `volvod13`, câmera atrás): 30–60 Hz 11,0 dB acima de 150–400 Hz, quando as gravações ficam entre −6,3 e +0,7; 60–150 Hz +11,1 (gravações até +8,0). Picapes (`hilux28`, `ranger32`, `ram67`): 60–150 Hz +16,3 (gravações até +13,9). Esse subgrave ocupa a margem de volume: a calibração baixa o resto junto.
6. **Regular demais em carga, irregular demais na lenta do caminhão.** Variação da batida de um ciclo para o outro (CV do knock; entre parênteses a faixa que o teste aceita, que é a das gravações ±0,03): ônibus em carga 0,10 (0,14–0,27), GE em N8 0,15 (0,24–0,30), gerador com carga 0,18–0,20 (0,19–0,25), EMD em N8 0,15–0,16 (0,16–0,30); caminhão em lenta 0,28–0,31 (0,125–0,25).
7. **Ônibus em carga abafado** (`onibusisl`, câmera atrás): 400 Hz–1 kHz −11,9 (gravações de −4,9 para cima), 2,5–6 kHz −24,1 (de −17,6 para cima), 6–12 kHz −34,4 (de −29,4 para cima).
8. **O Jake não rasga e o freio de descarga não abafa.** `catc15`, Jake de 6 cilindros a 1900 rpm: 2,5–6 kHz fica 1,1 dB abaixo da plena carga; o alvo é 3 a 9 dB acima. `scaniav8`, freio de descarga: os pulsos caem 7,7 dB; o alvo é 15 a 20.
9. **Cummins frio** (`ram67` a −23 °C, câmera atrás): centroide 188 Hz (alvo 270–450) e 1–2,5 kHz −2,8 dB (alvo −8 ± 4): grave do escape e batida, com pouco no meio. A referência é um vídeo só.
10. **Atrás do escape do caminhão ouve-se o motor** (`catc15`, ouvinte `pipe`, lenta): 1–2,5 kHz −15,3 dB (tabela 2.6: −21 ± 2) e centroide 322 Hz (tabela 2.6: 125–140).
11. **Caminhão em plena carga com pulso fraco** (`catc15` a 1900 rpm): pico de 140 bar (alvo 160–200), gás no coletor a 463 °C (alvo 550–650), porque o modelo dá ar demais (λ 2,5 contra ≈ 1,8).
12. **Sem fumaçada.** `f1000mwm` com o pé no fundo e `ge7fdl` subindo notch: 0 s com λ abaixo de 1,3 (alvos: 0,5–1,5 s e 2–4 s por notch). O ronco rouco da fumaça preta não existe.
13. **Lenta com carga não assenta** (`hilux28`, degrau de 30 % do torque): fora de ±2 % até o fim dos 6 s medidos (alvo: menos de 2 s).
14. **Lenta fria alta mesmo a 20 °C** (todos os eletrônicos e as locomotivas): Hilux a 1039 rpm (ficha 780), EMD a 361 rpm (ficha 269). O teste de lenta aceita por definição (T-DSL-06); é o que se ouve ao ligar a página sem aquecer.

## Testes que mentem: Radial e Rotativo

Rodadas de 18/11/2026 no commit `1a2a73c`, com a máquina ocupada por outra suíte ao mesmo tempo. Saídas em `scratchpad/aud/desv-radrot/` (fora do repositório). O que está marcado "inferência" não foi medido.

| Comando | Resultado | Tempo |
|---|---|---|
| `npm run teste:radial` (2 vezes) | 141 medidas: 110 ok, 31 desvios, 0 falhas | 196 s e 159 s |
| `npm run lenta:radial` | 52/52 | 58 s |
| `npm run geometria:radial` | 34/34 | < 1 s |
| `npm run teste:rotativo` (2 vezes) | 133 medidas: 105 ok, 28 desvios, 0 falhas | 71 s e 77 s |
| `npm run lenta:rotativo` | 32/32 | 25 s |

As duas rodadas de cada `teste:*` saem idênticas linha a linha, menos a medida de CPU (R-4360: 40,3% e 44,8%; R26B: 13,0% e 20,7%). Não há desvio órfão: as 31 e as 28 chaves de `DESVIOS` correspondem a medidas que falham hoje.

**O resumo em três frases.** (1) Das 15 comparações de bandas contra gravações, uma passa (P-47 na lenta, com 0,3 dB de folga): 8 de 9 no Radial e 6 de 6 no Rotativo estão em `DESVIOS`. (2) O mecanismo de desvio aceita qualquer piora: a chave é o nome da medida, sem valor nem limite, e três textos já não batem com o que o teste mede. (3) Com outra semente no gerador aleatório do DSP, 19 medidas que hoje passam viram falha e 9 desvios "com motivo físico" passam: parte do que está escrito como física é ruído de medida.

### Achados comuns às duas famílias

**T-RAD-01 · dívida · Desvio sem limite: uma medida desviada pode piorar à vontade.**
- **Evidência:** `tools/radial-valida.ts:59` e `tools/rotativo-valida.ts:59`: `desvio: ok ? undefined : DESVIOS[n]`. A chave é só o nome; qualquer valor que falhe vira "desv". Já aconteceu: o texto do desvio `r26b: lenta → plena carga` diz 7,6 dB e o teste mede +6,2; `os carros e a moto na lenta: faixa de nível` diz 23 dB e mede 24,6; `lenta periférica (r26b): vagar` cita a caça em 1 690–2 140 rpm e a medida ao lado dá 1 454–2 161.
- **Estado:** corrigível em `tools/**`. As saídas são determinísticas, então basta um retrato: gravar `{ nome: medido }` dos desvios num JSON por família (`tools/<família>-desvios.json`), falhar quando o `medido` de um desvio mudar sem o retrato ser regravado (`--atualizar`), e avisar quando uma chave de `DESVIOS` passar ou não existir mais.

**T-RAD-02 · erro · 19 medidas "ok" passam por causa da semente; 9 desvios são ruído de medida.**
- **Evidência:** rodei cada grupo com o `d.rng` do DSP (e os RNG do galope, da pós-queima e da aviação) trocado para as sementes 1, 777 e 424242, sem mexer nas sondas de calibração (script `scratchpad/aud/desv-radrot/x/seed.ts`, que embrulha `setConfig` e importa o `*-valida.ts` com `--grupo`). De 106 medidas do Radial, 15 mudam de estado (11 de ok para falha, 4 de desvio para ok); de 128 do Rotativo, 13 (8 e 5). Em negrito, o que falharia.

| Medida (estado oficial) | Oficial | Outras sementes |
|---|---|---|
| Radial · r1830: picos > 20 dB nos 20 s depois de pegar (ok, ≤ 6) | 5 | 4 / 3 / **9** |
| Radial · r2800: idem (ok, ≤ 6) | 3 | 1 / **8** / 5 |
| Radial · r1830: picos > 16 dB/s acelerando a frio (ok, ≤ 0,5) | 0,18 / 0,00 | **0,67** / 0,50 / 0,50 |
| Radial · R-1830 com primer 2: estouros em 10 s (ok, 3–8) | 4 | **12** / 4 / **10** |
| Radial · R-1830: CVciclo nos 3 s em que pega (ok, 0,6–1,1) | 0,62 | **0,58** / **0,59** / 0,61 |
| Radial · m14p lenta a 12 m: harmônicos da BPF contra a ignição (ok, −10 ± 5) | −15,0 | **−15,5** / **−16,6** / **−15,7** |
| Radial · vagar e CVlento da lenta do Yak-52 (ok) | 3,56% · 0,18 | **4,58%** · **0,20–0,21** |
| Radial · mag check, magneto direito (ok, 60 ± 30) | 83 rpm | **93** / **107** / 81 |
| Radial · potência m14p (ok, 265 ± 5%) e r1340 (ok, 447 ± 5%) | 261 · 462 kW | **243–244** · **472–474** |
| Radial · potência rotec2800 (desvio, 82 ± 5%) | 89 kW | 79 / 85 / 86: passa com 2 de 3 |
| Radial · Rotec 3·f_ign (desvio), DC-3 "singing" (desvio), vagar do T-6G (desvio) | −5,1 · −5,2 dB · 1,69% | cada um passa com pelo menos uma semente |
| Rotativo · rx7fd lenta: vagar (ok, 1,5–3%) | 2,3% | **0,9%** / 1,7% / **1,0%** |
| Rotativo · lenta periférica (r26b): faixa da caça (ok) | 1 454–2 161 | 1 633–2 210 / **1 450–2 213** / 1 459–2 130 |
| Rotativo · desaceleração r26b: estouros/s detectados (ok, 3,5–7) | 5,0 | 6,0 / 3,5 / **3,0** |
| Rotativo · rx8hp: ordem 1 contra a ignição (ok, −15 ± 5) | −19,6 | −19,7 / −19,6 / **−20,6** |
| Rotativo · rx8hp: lenta → plena (ok, +18 a +25) | +18,4 | **+18,0** / +18,4 / +18,2 |
| Rotativo · rx7fd lenta: 10–90% da queima (ok, 95–110°e) | 96 | 95 / 95 / **94,x** |
| Rotativo · potência ro80 (ok) e xmini (ok) | 84,2 · 3,1 kW | **80,6** · **3,2** |
| Rotativo · potência ae50r (desvio, 41 ± 5%) | 38,8 kW | 39,8 / 39,8 / 39,6: passa com as três |
| Rotativo · rx8std e norton: lenta → plena (desvios de 0,1–0,2 dB) | +17,9 · +17,8 | passam com 2 e com 1 semente |
| Rotativo · rx7fd lenta: estalos/s (desvio, ≤ 1,5) | 2,4 | 1,8 / 1,5 / 2,0 |
| Rotativo · rx8hp 'burble': estouros criados/s (desvio, 4–6) | 3,0 | 5,5 / 3,5 / 2,5 |

Consequência: os motivos escritos para `potência ae50r` ("o atrito pesa"), `potência rotec2800`, `rx8std`, `norton` e `Rotec: 3·f_ign` não se sustentam: a diferença é menor que a variação entre sementes. A potência varia ±8% de semente para semente porque é medida em 0,5 s (Radial) ou 0,6 s (Rotativo) por ponto.
Inferência: na página o RNG avança o tempo todo, então a fase em que o usuário dá a partida é arbitrária e as outras sementes representam o que ele ouve (por exemplo 3 a 9 estalos fortes na partida do R-1830, e não "5").
- **Estado:** corrigível em `tools/**`: medir contagens, vagar e CV como mediana de 3 a 5 sementes; potência com 2 s por ponto (`tools/radial-valida.ts:398`, `tools/rotativo-valida.ts:427`). Os alvos não mudam.

**T-RAD-03 · dívida · A medida de CPU é tempo de relógio e muda com a carga da máquina.**
- **Evidência:** `tools/radial-valida.ts:381` e `tools/rotativo-valida.ts:472` usam `process.hrtime`. O R-4360 mediu 40,3% e 44,8% (o TECNICO registra 26–28%; portão 60%); o R26B, 13,0% e 20,7% (TECNICO 10%; portão 45%). O alvo do projeto no navegador (≤ 50% do quantum, p99; RADIAL.md 8 passo 10, ROTATIVO.md 8 passo 12) não é medido nestes testes (não conferi os `*-navegador.mjs`).
- **Estado:** corrigível em `tools/**`: trocar por `process.cpuUsage()` (tempo de CPU do processo).

**T-RAD-04 · dívida · As lentas só conferem a média contra o alvo do próprio controle.**
- **Evidência:** `tools/radial-lenta.ts:44` e `tools/rotativo-lenta.ts:31,37`: rotação média de 5 s a ±3% de `idleTarget`, que a 30–40 s ainda é a lenta acelerada do motor frio (rx7fd 1 208 rpm com ficha de 750; rotec2800 1 105 com ficha de 1 000). Nenhum teste confere a lenta quente contra a `idle` da ficha, nem o espalhamento. Medi (`x/lentaficha.ts`, 24 s quente, últimos 6 s) os 17 radiais e os 16 rotativos: 31 ficam a ±2,5% da ficha; fora, o r26b (+5,3%, caçando) e a Megola (para, como previsto). O espalhamento é que escapa: **Norton** com média 1 212 rpm e saltos de 869 a 1 877 rpm a cada 10–15 s (desvio 8,8%); rx3 e cosmo110s ±5%. O NaN é procurado em 1 amostra a cada 97 (`tools/radial-lenta.ts:41`).
- **Estado:** corrigível em `tools/**` (acrescentar mín–máx e a comparação quente com a ficha); o salto da Norton vai para a etapa de som.

### Radial

**T-RAD-05 · erro · As bandas do Radial não medem a página `radial.html`.**
- **Evidência:** os grupos `bandas`, `linhas` e `galope` passam pela Cena (`tools/radial-cena.ts`, `MotorRadial` + `Helice`), que é o caminho da Passagem. Medi a mesma lenta quente na página (`RadialDSP`, ouvinte `ext`) e pela Cena (`x/pagina.ts`):

| Preset | 400–1k / 1–2,5k / 2,5–6k, página | Idem, Cena | Centroide página / Cena |
|---|---|---|---|
| r1340 | −5,3 / −7,3 / −7,3 | +0,3 / +3,6 / +3,3 | 782 / 2 278 Hz |
| r2800 | −13,8 / −17,0 / −16,1 | −7,9 / −10,1 / −10,5 | 231 / 355 Hz |
| r2800turbo | −9,4 / −19,8 / −20,0 | −4,5 / −12,9 / −13,6 | 248 / 364 Hz |
| r1830 | −7,1 / −15,8 / −16,1 | −9,0 / −11,3 / −12,5 | 252 / 299 Hz |
| rotec2800 | −3,6 / −2,8 / −2,8 | +0,2 / +2,6 / +1,3 | 1 253 / 1 841 Hz |

As duas medidas são na rotação de lenta da ficha; a página ouve a 5 m do cubo e a Cena na distância de cada regime do teste (4 a 12 m), então a comparação é aproximada. Ainda assim a página é 4 a 11 dB mais escura acima de 400 Hz que o caminho validado (o r1830 é a exceção em 400–1k). O alvo do T-6G a 4 m é −1 / +2 / 0: a página fica 4 a 9 dB abaixo dele. O que o usuário ouve em `radial.html` não foi comparado com gravação nenhuma.
- **Estado:** para a etapa de som (decidir qual dos dois caminhos é a referência); em `tools/**`, acrescentar as bandas da página aos regimes de lenta.

**T-RAD-06 · erro · Os estalos da lenta só são medidos nos motores grandes; os pequenos, o Sherman e a aviação do Ronco ficam fora.**
- **Evidência:** `tools/radial-valida.ts:361–371` mede r1820, r1830, r2800, r2800turbo e m14p. Rodei o mesmo detector (`cenario` de `tools/radial-estouros.ts`, lenta quente, 3–14 s) nos 26 presets (`x/lentaq.ts`):

| Preset | picos/s | acima de 16 dB/s | curtose 2–6 kHz |
|---|---|---|---|
| rotec2800 | 19,0 | 15,8 | 96,7 |
| verner3 · verner5 | 11,3 · 15,3 | 7,3 · 5,9 | 64 · 31 |
| r975 (Sherman) | 15,0 | 3,3 | 23,6 |
| rotec3600 · m14pf | 10,7 · 10,3 | 2,7 · 2,8 | 15 · 14 |
| m14p (o único no teste, desvio) | 7,3 | 0,64 | 9,3 |
| c172 · o360 · o200 | 20,3 · 19,6 · 19,5 | 6,5 · 6,5 · 4,4 | 14 · 13 · 11 |
| rotax912 · r22 · s300 | 23,9 · 18,4 · 20,6 | 5,1 · 2,2 · 1,5 | 9 · 8 · 7 |
| r1820, r1830, r2800, r2800turbo, r1340, r985, s55, trossi, io540, io550, r44, bell47 | 0–2,2 | 0 | 3–5 |

O alvo do teste é ≤ 3 picos/s e nenhum acima de 16 dB; a gravação do Rotec tem 5,9/s, 0,17/s e curtose 6 (TECNICO → Radial → Pendente). O Sherman não aparece nos desvios nem nos pendentes do TECNICO → Radial. Nos 4 cilindros a 646 rpm a ignição é 21,5 Hz, então cerca de 20 picos/s é cada explosão contada: sem gravação de Lycoming em lenta não dá para dizer que é defeito, mas a curtose de 11–14 diz que cada explosão sai como estalo no agudo.
- **Estado:** para a etapa de som (prioridade alta); em `tools/**`, incluir rotec2800, rotec3600, verner3, verner5, m14pf e r975 no grupo `estouros`, que passam a ser desvios com número.

**T-RAD-07 · erro · `f_ign/BPF` é uma conta com a ficha, não uma medida do som.**
- **Evidência:** `tools/radial-valida.ts:104–105`: o critério usa `rt = c.fIgn / c.bpfTele`, as duas rotações da telemetria, ou seja N·i/(2B) com o `reducao` do preset. A razão dos picos do espectro é impressa ao lado e não entra no critério; no m14p ela dá 3,456 contra 3,42 (1,05%, fora do ±1%). O mesmo em `tools/rotativo-valida.ts:326` (`ar741: f_ign/BPF` = 0,500 por construção) e na linha do Cessna (`f_ign/BPF` 1,001).
- **Estado:** corrigível em `tools/**`: usar os picos com resolução suficiente (Welch de 131 072 ou interpolação parabólica), ou renomear para "razão da ficha".

**T-RAD-08 · erro · "Mecânica 1,4×" multiplica por 1,17 dentro do teste.**
- **Evidência:** `tools/radial-valida.ts:222`: `raz = 10 ** ((ar − agua) / 20) * 1.17`. Os dois renders são radiais; o ×1,17 das aletas (`src/engines/ronco/dsp.ts:1202`) vale nos dois e se cancela. O teste mede só o ×1,2 do ar (`dsp.ts:1201`) e passaria igual sem a linha 1202.
- **Estado:** corrigível em `tools/**`: a referência "a água" com `dsp.radial = false`, sem constante no teste.

**T-RAD-09 · dívida · A lenta "na rotação da gravação" não chega à rotação pedida.**
- **Evidência:** `tools/radial-valida.ts:80` troca a `idle` do preset pela rotação da gravação, mas com a hélice acoplada o motor não chega lá: Rotec pedido 1 200, medido 1 031; Yak-52 983 → 900; T-6G 916 → 891 (rpm impressos na saída). O desvio `Rotec: 3·f_ign` atribui a diferença a isso ("a rotação de lenta do modelo é 1 030 rpm"): o que falha é a condição do teste, não o preset.
- **Estado:** corrigível em `tools/**`: segurar a rotação com a manete por bisseção, como `tools/analise-som/render.js` faz.

**T-RAD-10 · dívida · Alvos trocados ou alargados (com o commit).**
- `ee6265d`: `R-1830: CVciclo nos 3 s depois de pegar ≥ 0,8` virou `0,6–1,1` com a janela adiantada 0,5 s para antes da primeira explosão (`tools/radial-valida.ts:250`). A janela passa a incluir a subida de 20 dB do nível enquanto o motor pega, que infla o CV: mede o degrau, não a variação explosão a explosão. Passa com 0,62 (0,58 e 0,59 com outras sementes).
- `0c071df`: `lenta:radial` media a rotação em 25–30 s; passou a 35–40 s porque o Verner 5S ficava 3–6% acima do alvo (cabeçalho de `tools/radial-lenta.ts`).
- `ee6265d`: o grupo `estouros` nasceu com o m14p já em `DESVIOS`.
- `tools/radial-valida.ts:370`: o rótulo diz "≤ 3 (0)" e o critério aceita 0,3 pico forte por segundo.
- `tools/radial-geometria.ts:99`: 80 ± 5° do RADIAL.md 1.2 virou ± 7,2° (justificado: é a soma dos ΔPMS da própria tabela 1.2). `:29`: ±0,05° é conferido como 0,055°.
- A banda 6–12 kHz saiu de todos os critérios de banda (cabeçalho do arquivo; coerente com a regra 3 do PLANO).
- **Estado:** para o dono decidir se aceita os alvos novos. O do CVciclo da partida eu não aceitaria: voltar à janela depois de pegar e declarar o desvio.

**T-RAD-11 · sugestão · Limites de um lado só escondem diferenças grandes.**
- **Evidência:** `P-47 coletor único, lenta: 9ª contra a 4,5ª ≥ 0 dB` mede +24,5 dB (`tools/radial-valida.ts:147`); na gravação a 9ª fica 2 a 7 dB acima da 4,5ª (RADIAL.md 4.2: +4 a +6 contra −1 a +2). `Yak-52 decolagem: BPF contra a ignição ≥ +5` mede +14,8 (gravação +3 a +10). `uivo do superalimentador ≤ −25 dB` mede −42,8 e −40,8: o teste não distingue "baixo" de "ausente".
- **Estado:** para a etapa de som (o P-47 na lenta é um zumbido de 9ª ordem sem a ordem de fileira que a gravação tem); em `tools/**`, trocar por faixas.

**T-RAD-12 · incompleto · Testes do projeto que não existem.**
- **Evidência (RADIAL.md 8 contra `tools/radial-valida.ts`):** o passo 9 inteiro (Sherman 0–30 km/h em 12–18 s e as linhas de 2,5ª e 2ª ordem; panorâmica da Megola; Trossi): nenhuma medida cita `r975`, `megola`, `trossi` ou `s55` fora da lenta. Faltam também as linhas de passagem e "afastando" da tabela 4.1, as bandas do DC-3 a 3 m da hélice, "fileira entre −5 e −12 dB da ignição" (4.2) e `CVciclo` 0,5–0,8 aquecendo (4.3). `R-1830 com primer 2` e `M-14P: tchufs` contam eventos internos (`:235`, `:258`), não o som.
- **Estado:** para a etapa de som escrever junto com as correções (cada correção de som traz a sua medida).

**T-RAD-13 · sugestão · `potência` confere a calibração, não a ficha.**
- **Evidência:** `tools/radial-valida.ts:392–398` mede nos mesmos três pontos (0,8 / 0,9 / 1,0 de `rpmMax`) em que a sonda de calibração ajusta a escala de torque para a `power` do preset. Vale como regressão da calibração; não detecta ficha errada. O mesmo no Rotativo (`:415–427`).
- **Estado:** nada a consertar além do tempo de medida (T-RAD-02); renomear para "potência calibrada" evita a leitura errada.

**Pendentes do TECNICO (Radial), conferidos no código:** todos continuam pendentes. Boca de estaque curto e ruído de choque da hélice (os desvios de banda do Rotec, do T-6 e do Corsair); hélice na lenta com termo de carga (DC-3 "singing"); Ford Trimotor com 3 motores (só existe o `r985` com a etiqueta); som do rotor na página do Ronco (`somExtraAv` em `src/engines/ronco/aviacao.ts:252` só trata hélice); Monaco-Trossi em 2 tempos (o ciclo de 360° só existe com `cc`, `src/engines/diesel/dsp.ts:172`); estalos dos estaques curtos (T-RAD-06).

#### Todos os desvios do Radial

Classe: (a) defeito real de som; (b) alvo errado ou irrealista; (c) limitação aceitável do modelo; (d) medida mal definida.

| # | Chave | Alvo | Medido | Classe | Gravidade | Em uma frase |
|---|---|---|---|---|---|---|
| 1 | bandas lenta 9 cil. grande, 12 m (Yak-52) | +4 / −6 / −15 / −14 ± 4 | +9,7 / −8,8 / −12,8 / −13,7 | b | baixa | Só o grave sobra 5,7 dB; a gravação é de celular (inferência do autor, plausível). |
| 2 | bandas lenta 9 cil. perto, 4 m (T-6G) | +12 / −1 / +2 / 0 | 0,0 / −0,7 / +2,9 / +2,5 | a | média | Faltam 12 dB de grave de perto: a lenta do T-6 não tem peso. |
| 3 | centroide lenta T-6G | 1 300 Hz ± 30% | 2 094 Hz | a | média | Consequência do 2. |
| 4 | bandas lenta 14 cil., 10 m (DC-3) | +5 / −7,5 / −11 / −12,5 | +0,9 / −7,2 / −11,4 / −12,7 | a | baixa | Grave 4,1 dB abaixo (0,1 dB fora). |
| 5 | bandas lenta 18 cil. estaques, 8 m (Corsair) | −4 / −5 / −9 / −14,5 | +1,1 / −10,6 / −12,6 / −12,6 | b | baixa | A gravação tem uma linha externa de 152 Hz na banda de referência. |
| 6 | bandas lenta 7 cil. pequeno, 4 m (Rotec) | +3 / −8 / −4 / −6 | +10,2 / +0,7 / +3,1 / +1,7 | a | alta | 7–9 dB brilhante demais; é o mesmo defeito dos estalos (T-RAD-06). |
| 7 | centroide lenta Rotec | 1 050 Hz ± 30% | 1 706 Hz | a | alta | Consequência do 6. |
| 8 | bandas decolagem Yak-52, 75 m | −2 / −13 / −10,5 / −10 | +0,9 / −9,8 / −14,8 / −14,3 | a | baixa | Agudo 4,3 dB abaixo (0,3 fora); a hélice domina. |
| 9 | centroide decolagem Yak-52 | 580 Hz ± 30% | 317 Hz | a | média | 45% abaixo: o som fica na BPF de 62 Hz. |
| 10 | bandas decolagem T-6, 50 m | −11 / −1 / 0 / −5 | −0,2 / −3,4 / −5,9 / −7,3 | a | alta | Grave 11 dB acima e 1–2,5k 6 dB abaixo: falta o rasgo da ponta quase sônica. |
| 11 | bandas decolagem Corsair, 150 m | −16 / −12 / −10 / −15 | −7,0 / −14,2 / −19,7 / −25,7 | a | alta | Grave 9 dB acima e 1–6 kHz 10 dB abaixo: abafado e grave. É o preset "Corsair rasante" da Passagem. |
| 12 | centroide decolagem Corsair | 456 Hz ± 30% | 232 Hz | a | alta | Consequência do 11. |
| 13 | Rotec: 3·f_ign contra a fundamental | 0 ± 4 dB | −5,1 dB | d | — | Condição errada (1 031 rpm em vez de 1 200) e ruído de semente (−3,2 e −1,8 passam). |
| 14 | T-6 decolagem: harmônicos 5–9 entre si | ≤ 6 dB | 6,6 dB | c | baixa | 0,6 dB fora; mesma falta do 10. |
| 15 | DC-3 a 3 m da hélice ("singing") | ≥ −2 dB | −5,2 dB | c | baixa | A hélice na lenta é fraca de perto; varia de −1,8 a −5,2 com a semente. |
| 16 | r1340: lenta → plena a 55% | +18 a +25 dB | +13,8 dB | a | média | A lenta do T-6 fica só 14 dB abaixo da carga: alta demais. |
| 17 | r2800: lenta → plena a 55% | +18 a +25 dB | +17,5 dB | c | baixa | 0,5 dB fora. |
| 18 | os 13 aviões na lenta a 12 m: faixa | ≤ 12 dB | 38,1 dB | b + a | média | O alvo não cabe nos `nivelEscape` do projeto (21 dB), mas o M-14PF fica 16 dB abaixo do M-14P com o mesmo `nivelEscape` 140: os presets de estaques individuais (`tubos`) saem baixos na lenta pela Cena. O texto "como deve ser" não vale para esse par. |
| 19 | vagar da lenta T-6G | 2–4% | 1,69% | c | baixa | Passa com a semente 1 (2,36%). |
| 20 | vagar da lenta DC-3 | 2–4% | 0,27% | a | baixa | A lenta do DC-3 fica parada demais (o controle de lenta do Ronco segura). |
| 21 | CVlento da lenta DC-3 | 0,05–0,20 | 0,03 | a | baixa | Mesma causa do 20. |
| 22 | CVciclo da lenta P-47 | 0,30–0,42 | 0,25 | c | baixa | Lenta lisa demais (ver T-RAD-11). |
| 23 | CVciclo da lenta Corsair | 0,30–0,42 | 0,46 | c | baixa | 0,04 acima. |
| 24 | R-1830: 9 pás depois do engate | 4–6 s | 3,2 s | c | média | O arranque gira o motor rápido demais porque o `EngineDSP` não queima abaixo de 60 rpm. |
| 25 | R-1830: pega depois dos magnetos | 1–3 s | 1,0 s | c | baixa | No limite. |
| 26 | M-14P: partida a ar, "tchufs"/s | 7–11 | 13,5 | c | baixa | Mesma limitação do 24. |
| 27 | R-2800: mistura em corte, 1 000 rpm a parar | 4–8 s | 3,8 s | c | baixa | 0,2 s fora. |
| 28 | R-2800: subida de giro (manete em 3 s) | 4–7 s | 2,9 s | d | — | O teste leva a manete ao fundo em 3 s e pede 4–7 s: o cenário não é o do alvo. |
| 29 | R44: droop ao puxar o coletivo | 2–3% | 0,68% | c | baixa | Governador do rotor rígido demais (o AE50R dá 0,23%). |
| 30 | m14p: lenta quente, picos/s | ≤ 3, nenhum > 16 dB | 7,27 (0,64 fortes; curtose 9,3) | a | alta | Pipoco na lenta do Yak-52; a gravação tem 2,5/s. |
| 31 | potência rotec2800 | 82 kW ± 5% | 89 kW | d | — | Ruído de medida: 79, 85 e 86 kW com outras sementes. |

Contagem: (a) 15, contando o 18, que é misto · (b) 2 · (c) 11 · (d) 3.

### Rotativo

**T-ROT-01 · erro · "Meia-ordem ≤ +3 dB" não olha para nenhum ponto do espectro.**
- **Evidência:** `tools/rotativo-valida.ts:195–196` e `:314–315` chamam `linha(rpm/120, 0,03)`. A 750 rpm isso é 6,25 Hz ± 3% (6,06–6,44 Hz); o Welch de 32 768 pontos tem pontos em 5,86 e 7,32 Hz. Nenhum cai na janela, `linha()` devolve `-Infinity` (`tools/rotativo-bandas.ts:135`) e a medida passa: a saída diz "medido -Infinity dB" nas duas.
- **Estado:** corrigível em `tools/**`: `linha()` devolve `NaN` (falha) sem ponto na janela; a medida certa é a banda lateral a ±rpm/120 em volta de 2·ign e 3·ign, como o ROTATIVO.md 3.2 descreve para o pistão.

**T-ROT-02 · erro · Uma medida com `ok` fixo em `true`.**
- **Evidência:** `tools/rotativo-valida.ts:231`: `add('lenta periférica (r26b): a caça vem da sobreposição', 'sem sobreposição a lenta para', '(ver lenta de street port)', true)`. A medida vizinha roda o rx7fd com janela street port, não o r26b sem sobreposição.
- **Estado:** corrigível em `tools/**`: rodar o r26b com as janelas de sobreposição pequena e conferir vagar ≤ 3%, ou tirar a linha.

**T-ROT-03 · erro · Rótulo do alvo diferente do critério: quatro medidas "ok" estão fora do alvo que mostram.**

| Medida (linha) | Rótulo | Critério no código | Medido |
|---|---|---|---|
| lenta periférica (r26b): faixa da caça (`:227`) | 1 600–2 200 rpm | 1 450–2 350 | 1 454–2 161 (4 rpm de folga) |
| rx7fd plena carga: parede do coletor (`:136`) | 900–1 000 °C | 880–1 050 | 1 008 °C |
| rx7fd e rx8hp plena carga: 10–90% da queima (`:135`) | 50–60°e | 46–62 | 48°e nos dois |
| rx7fd sweep: boost (`:273`) e duração da queda (`:271`) | 0,65–0,75 bar · 0,2–0,4 s | 0,60–0,78 · 0,15–0,4 | 0,67–0,70 · 0,24 s |
| plena carga: pressão na abertura (`:133`) | ≈ 4 bar | > 3 (3–5,5 só num caso) | 9,47 / 3,96 / 3,87 bar |
| Wankel contra pistão (`:188`) | +8…+12 / +15…+20 | 6–14 / 13–22 | +3,4 / +23,8 (desvio mesmo assim) |

O caso `rx8hp (aspirado)` a 55% é pulado na medida do coletor (`if (rotulo !== 'rx8hp (aspirado)')`, `:136`). O `lenta:rotativo` troca "1 600–2 200 e vagar ≥ 20%" do projeto por 0,75–1,2× o alvo do controle (`tools/rotativo-lenta.ts:37`): com o motor frio a faixa aceita é 1 767–2 827 rpm.
- **Estado:** corrigível em `tools/**`: o rótulo mostra o critério real, ou o critério volta ao do projeto e as quatro primeiras linhas viram desvios declarados.

**T-ROT-04 · erro · O teste exige que o agudo da lenta seja ruído, e o agudo da lenta é todo ruído.**
- **Evidência:** `tools/rotativo-valida.ts:147`: "sem a pós-queima, 1–2,5 kHz cai ≥ 6 dB" (ROTATIVO.md 8 passo 4); mede 8,8 dB. Medi a fração da potência de cada banda que some com as fontes estocásticas desligadas (`x/ruido.ts`: `kHC = 0`, `jetGain = 0`, mistura "Ar" 0), lenta quente:

| Caso | Bandas rel. 150–400 (400–1k / 1–2,5k / 2,5–6k) | Some sem a pós-queima (400–1k / 1–2,5k / 2,5–6k) | Centroide |
|---|---|---|---|
| rx7fd, Ø de fábrica | −5,6 / −17,0 / −13,9 | 0% / 87% / 100% | 299 Hz |
| rx8hp, Ø de fábrica | −7,0 / −6,4 / −2,8 | 20% / 99% / 100% | 691 Hz |
| cosmo20b, Ø de fábrica | −4,8 / −7,4 / −4,2 | 9% / 100% / 100% | 408 Hz |

Acima de 1 kHz a lenta dos três é uma fonte de ruído. Isso contraria a regra 4 da rodada (orçamento de ruído) e é a queixa do "som de ar".
- **Estado:** para a etapa de som; o dono decide se o critério do passo 4 é invertido (o tom tem de sustentar a banda).

**T-ROT-05 · erro · O teste do "som de ar no Ø mínimo" passa e o Ø mínimo continua sendo só ruído.**
- **Evidência:** `tools/rotativo-valida.ts:153–163` mede só o jato da ponta, só em 150 Hz–1 kHz, e com a ponteira presa na de fábrica: 0,0% / 0,1%. Mesma medida do T-ROT-04 no Ø 25 mm:

| Caso | Bandas rel. 150–400 (400–1k / 1–2,5k / 2,5–6k) | Ruído (150–400 / 400–1k / 1–2,5k / 2,5–6k) | 150–400 absoluto | Centroide |
|---|---|---|---|---|
| rx7fd, Ø 25, ponteira de fábrica (a condição do teste) | +3,0 / +8,8 / +15,9 | 3% / 63% / 99% / 100% | −13,5 dB (de fábrica: +19,8) | 3 902 Hz |
| rx7fd, Ø 25, ponteira 31,75 mm (mínimo do painel) | +3,3 / +6,7 / +12,9 | 56% / 84% / 99% / 100% | −10,0 dB | 3 654 Hz |
| rx8hp, Ø 25, ponteira 31,75 mm | +3,6 / +5,2 / +8,1 | 89% / 99% / 100% / 100% | +8,4 dB | 2 779 Hz |

O tom cai 33 dB e a pós-queima na boca não cai: o agudo fica 9 a 16 dB acima do grave. A tabela da revisão no TECNICO mostra o mesmo (FD lenta Ø 25: 2,5–6k de +11,5 para +15,8). Com a ponteira também no mínimo voltam o jato e 8,8 a 22,6 estalos/s.
- **Estado:** para a etapa de som; em `tools/**`, medir a fração estocástica total de 150 Hz a 6 kHz no Ø 25 com a ponteira de fábrica e no mínimo.

**T-ROT-06 · dívida · A revisão do "som de ar" piorou três medidas e elas entraram em `DESVIOS` no mesmo commit.**
- **Evidência:** `git show 90de2a2 -- tools/rotativo-valida.ts`: entraram `centroide lenta 2 rotores original` (299 Hz; o texto anterior dizia "o centroide bate"), `lenta original quente (rx7fd): estalos/s` (2,4; antes 0,6) e `rx8std: lenta → plena`. O texto de `bandas lenta rx7fd` passou de "só 400–1k 1,4 dB fora" para "400–1k 4,5 dB e 1–2,5k 6 dB abaixo"; o do RX-8 a 5 000, de "3–7 dB abaixo" para "8–10". As chaves de `DESVIOS` foram de 25 (commit `f521227`) para 28. O espalhamento de 9 ms foi escolhido na borda de dois critérios: `desvio/média ≥ 0,5` mede 0,51 e `p90/p10 7–13 dB` mede 12,3.
- **Estado:** para a etapa de som. Com o retrato do T-RAD-01 uma piora dessas passa a aparecer como mudança, e não como desvio novo já justificado.

**T-ROT-07 · dívida · Medidas que leem o contador interno ou a ficha em vez do som.**
- `desaceleração rx8hp ('burble')` (`:255`) usa os estouros **criados** (3,0/s); o detector acha 1,0/s. A do r26b, ao lado, usa os detectados. O defeito audível é maior que o desvio declara.
- `rx8hp: degraus das janelas` (`:277–283`): grade de 50 rpm e tolerância de ±50; mede 3 800 e 6 300, no limite exato. O critério "torque não cai mais que 3% na troca" do projeto (passo 6) não é conferido: `pts.tq` é coletado e nunca usado.
- Grupo `veiculo` (`:432–437`): aritmética com as relações do preset. A 5ª do FD foi mudada de 0,806 para 0,761 para dar os 2 600 rpm do alvo (TECNICO → Rotativos → Decisões, "Fichas"): a ficha foi ajustada ao teste. Conferir com a frente das fichas qual é a relação real.
- `∮ p dV = 0 ± 1%` (`:102–105`): a pressão é função só do volume, então a integral num ciclo fechado é zero por construção; confere que `volumeAngulo` é periódico e nada mais.
- `xmini: f_ign` inclui `cyc === 720` e `N === 3` no critério (`:360`).
- A lenta do rx7fd é medida a 750 rpm contra uma gravação a 880 rpm (ROTATIVO.md 3.1): condição não casada.
- **Estado:** corrigível em `tools/**` (estouros detectados no rx8hp; grade de 25 rpm e o critério de torque; lenta do rx7fd a 880 rpm). A 5ª do FD fica para a frente das fichas.

**T-ROT-08 · sugestão · Dois desvios são alvos errados e se corrigem no teste.**
- `rx8hp a 100 km/h em 6ª`: o alvo de 2 750 rpm do projeto não bate com a ficha (0,843 × 4,444, roda 0,33 m → 3 011 rpm), e o RX-8 real gira perto de 3 000. Correção: alvo 3 000 ± 100 em `tools/rotativo-valida.ts:435`, sem a chave em `DESVIOS`.
- `pré-silencioso retirado: 2·ign sobe`: a 750 rpm a 2·ign está em 50 Hz, abaixo da câmara de 150–300 Hz. Correção: medir a 5 000 rpm sustentados (2·ign em 333 Hz), como o próprio texto do desvio diz.

**T-ROT-09 · incompleto · Testes do projeto que não existem.**
- **Evidência (ROTATIVO.md 3 e 8 contra `tools/rotativo-valida.ts`):** "espectro de 400 Hz a 6 kHz dentro de 4 dB" do RX-8 a 5 000 (passo 5); janelas modificadas com `CVciclo` 0,40–0,50 e 6–12 estalos/s (3.3; o street port só confere vagar); bandas das passagens e de bordo (3.1); lenta do Ro80 no cofre; ordens do RX-7 modificado, do RX-8 de escape livre, da Norton e do Ro80 (3.2); CPU no navegador (passo 12). O cabeçalho do arquivo não lista o grupo `niveis`, que existe.
- **Estado:** para a etapa de som, junto com as correções; o cabeçalho é corrigível em `tools/**`.

**T-ROT-10 · sugestão · Passam com folga menor que 10% da faixa.**
`palhetas: jato ≥ tom` (48,9 contra 48,7 dB), `ro80 0–100 km/h` (12,2 s em 12–15), `mistral: governador` (2 876 rpm, piso 2 871), `rx7fd lenta → plena` (+18,6), `ar741: passagem de pá` (250 Hz a 7 506 rpm; o alvo fala em 260 Hz a 7 800 e a tolerância de 6% cobre).
- **Estado:** nada a consertar; a mediana de sementes do T-RAD-02 cobre as que dependem de ruído.

**Pendentes do TECNICO (Rotativos), conferidos no código:** continuam pendentes o pulso da janela periférica mais íngreme; a decisão sobre o pré-silencioso; o termo `× cyc/720` na taxa de estouros (`src/engines/ronco/dsp.ts` não tem); a velocidade do som fixa em 520 m/s (`src/acoustics/constantes.ts:8`); a vibração; a gravação do motor de palhetas; o XTS-210 diesel; a linha do rotativo na tabela 1.6 do `CENA.md` (linha 227 ainda traz "—" em rotor e gerador, e `COMPAT` tem os dois); os cinco itens do "som de ar" (T-ROT-04 e T-ROT-05 medem os itens a e b).

#### Todos os desvios do Rotativo

| # | Chave | Alvo | Medido | Classe | Gravidade | Em uma frase |
|---|---|---|---|---|---|---|
| 1 | bandas lenta 2 rotores original (rx7fd) | +2 / −1 / −11 / −10,5 ± 4 | +2,8 / −5,5 / −17,0 / −13,9 | a | alta | Faltam 4,5 dB em 400–1k e 6 dB em 1–2,5k, e o que há acima de 1 kHz é ruído (T-ROT-04). |
| 2 | centroide lenta rx7fd | 480–550 Hz ± 30% | 299 Hz | a | alta | Consequência do 1. |
| 3 | pré-silencioso retirado: 1–2,5k e 2,5–6k sobem | ≥ 6 dB | +1,4 / +0,1 dB | a | média | Tirar o pré-silencioso quase não muda o agudo: o controle não faz o que promete. |
| 4 | pré-silencioso retirado: 2·ign sobe | ≥ 4 dB | −0,6 dB | b | — | Alvo mal posto a 750 rpm (T-ROT-08). |
| 5 | bandas 5 000 rpm, Renesis (rx8hp) | −8 / −10 / −11 / −10,5 | −14,2 / −10,2 / −21,1 / −18,2 | a | alta | Faltam 8–10 dB acima de 1 kHz e 6 dB de grave: o RX-8 em giro soa abafado. |
| 6 | centroide 5 000 rpm rx8hp | 520 Hz ± 30% | 279 Hz | a | alta | Consequência do 5. |
| 7 | bandas 7 700 rpm, 4 rotores (r26b) | −6,5 / +20 / +19 / +6,7 | −9,2 / +10,3 / +1,6 / −2,9 | a | alta | Faltam 10 a 17 dB de 400 Hz a 6 kHz: o grito do 787B não está lá. |
| 8 | bandas lenta 4 rotores periférica (r26b) | +3,5 / −7,5 / −15,5 / −16 | −5,7 / −3,0 / −6,0 / −5,9 | a | alta | Lenta 9–10 dB brilhante demais e 9 dB sem grave. |
| 9 | centroide lenta r26b | 230–380 Hz ± 30% | 985 Hz | a | alta | Consequência do 8. |
| 10 | bandas lenta moto (norton) | +9,5 / −2,5 / −4,5 / −12,5 | −7,3 / −4,9 / −15,9 / −22,0 | a + b | média | Grave 17 dB e agudo 10 dB abaixo; o alvo é vídeo de celular com rotação ambígua (ROTATIVO.md 8.1). |
| 11 | bandas lenta fria carburada (ro80) | −2 / −10 / −12 / −20 | +2,5 / −8,6 / −10,0 / −5,5 | a | média | 2,5–6k 14,5 dB acima: a lenta fria do Ro80 chia. |
| 12 | centroide lenta fria ro80 | 320 Hz ± 30% | 718 Hz | a | média | Consequência do 11. |
| 13 | Wankel (rx7fd) contra pistão (ek9) | +8…+12 / +15…+20 | +3,4 / +23,8 | d | — | O pistão de referência do teste não é o da gravação. |
| 14 | rx7fd lenta: harmônicos 1–3 da ignição | dentro de 6 dB | +9,9 / +17,7 / +15,7 | a | baixa | A fundamental de 25 Hz fica 8 dB abaixo do 2º harmônico. |
| 15 | rx8hp 5 000: ordens 2/3 e 5/3 | −16 ± 5 dB | −21,7 / −24,5 | c | baixa | Ordens de flanco fracas: menos aspereza que a gravação. |
| 16 | lenta periférica (r26b): vagar em 12 s | ≥ 20% | 5,6% | b | baixa | O alvo vem em parte do método de medida no vídeo; a faixa mín–máx (1 454–2 161) bate com a do vídeo. |
| 17 | desaceleração rx8hp ('burble'): estouros/s | 4–6 | 3,0 criados, 1,0 detectado | a | média | O crepitar do RX-8 na desaceleração quase não se ouve (T-ROT-07). |
| 18 | vibração na lenta: rx8hp contra ek9 | 10–15 dB abaixo | −6,9 dB | c | baixa | Só na cabine. |
| 19 | vibração na lenta: rx8hp contra mx5 | 10–15 dB abaixo | −7,3 dB | c | baixa | Idem. |
| 20 | mistral: subida 1 200 → 7 500 rpm | 4–6 s | 3,1 s | d | — | O teste leva a manete ao fundo em 4 s; o cenário não é o do alvo. |
| 21 | potência ae50r | 41 kW ± 5% | 38,8 kW | d | — | Ruído de medida: 39,6–39,8 kW com as três outras sementes. |
| 22 | rx8hp a 100 km/h em 6ª | 2 750 ± 100 rpm | 3 011 rpm | b | — | Alvo errado (T-ROT-08). |
| 23 | r26b: lenta → plena a 55% | +18 a +25 dB | +6,2 dB | a | média | A lenta do 787B fica só 6 dB abaixo da carga e 9 a 25 dB acima da lenta dos outros carros. |
| 24 | ro80: lenta → plena | +18 a +25 dB | +16,8 dB | c | baixa | 1,2 dB fora. |
| 25 | norton: lenta → plena | +18 a +25 dB | +17,8 dB | d | — | Ruído de semente (0,2 dB). |
| 26 | rx8std: lenta → plena | +18 a +25 dB | +17,9 dB | d | — | Ruído de semente (0,1 dB). |
| 27 | lenta original quente (rx7fd): estalos/s | ≤ 1,5 | 2,4 | a | baixa | 1,5 a 2,4 conforme a semente; a gravação tem 0,5. |
| 28 | os carros e a moto na lenta: faixa de nível | ≤ 12 dB | 24,6 dB | a | média | rx3 −56,6 e r26b −32,0 dBFS: a calibração de lenta não nivela os presets. |

Contagem: (a) 16, contando o 10, que é misto · (b) 3 · (c) 4 · (d) 5.

### Para a etapa de som (Radial), por prioridade

1. **Estalos na lenta dos motores de estaques curtos e do Sherman.** Rotec R2800: 19 picos/s no agudo, 16 deles acima de 16 dB, curtose 97; Verner 11–15/s; Sherman 15/s; M-14PF e Rotec R3600 10/s; Yak-52 7,3/s. Gravações: 0 a 6/s. Preset na lenta quente, página, ouvinte de fora. Prova: tabela do T-RAD-06 e desvio 30.
2. **Decolagem do Corsair e do T-6: grave demais, sem meio e agudo.** Corsair a 150 m: grave +9 dB, 1–6 kHz −10 dB, centroide 232 Hz contra 456. T-6 a 50 m: grave +11 dB, 1–2,5k −6 dB. Vale para o "Corsair rasante" da Passagem. Prova: desvios 10, 11 e 12.
3. **A página soa diferente da Passagem.** O mesmo motor na lenta é 4 a 11 dB mais escuro acima de 400 Hz em `radial.html` do que no caminho validado; o T-6 na página fica 4 a 9 dB abaixo do alvo de perto. Prova: T-RAD-05.
4. **Lenta do Rotec 7–9 dB brilhante demais** (pela Cena, 4 m), junto com o item 1. Prova: desvios 6 e 7.
5. **Lenta do T-6 de perto sem grave (−12 dB) e alta demais em relação à carga (+13,8 dB em vez de +18 a +25).** Prova: desvios 2, 3 e 16.
6. **Presets de estaques individuais baixos demais na lenta pela Cena.** M-14PF 68 dB contra M-14P 84 dB a 12 m, com o mesmo `nivelEscape`. Prova: desvio 18.
7. **P-47 na lenta: zumbido de 9ª ordem sem a ordem de fileira** (+24,5 dB de diferença contra 2–7 na gravação; CVciclo 0,25 contra 0,30–0,42). Prova: T-RAD-11 e desvio 22.
8. **Partida gira rápido demais** (9 pás em 3,2 s contra 4–6; M-14P 13,5 "tchufs"/s contra 7–11) e o número de estalos fortes na partida varia de 1 a 9 conforme o instante. Prova: desvios 24 e 26, T-RAD-02.
9. Menores: DC-3 com lenta parada demais (vagar 0,27%); droop do R44 0,7% contra 2–3%; decolagem do Yak com centroide 45% abaixo.

### Para a etapa de som (Rotativo), por prioridade

1. **787B a 7 700 rpm sem o grito.** 400–1k +10,3 contra +20; 1–2,5k +1,6 contra +19; 2,5–6k −2,9 contra +6,7. Preset `r26b`, giro sustentado em neutro, ouvinte de fora. Prova: desvio 7.
2. **Todo o agudo da lenta é ruído de pós-queima.** RX-7: 87% de 1–2,5k e 100% de 2,5–6k; RX-8 e Cosmo: 99–100%. E ainda assim faltam 6 dB em 1–2,5k contra a gravação: falta conteúdo tonal e impulsivo (o pulso da janela), não mais ruído. Prova: T-ROT-04 e desvios 1 e 2.
3. **Ø da saída no mínimo continua "só ar".** RX-7 a 25 mm: agudo 9 a 16 dB acima do grave, 99–100% ruído, centroide 3 900 Hz; com a ponteira também no mínimo, 9 a 23 estalos/s. Prova: T-ROT-05.
4. **Lenta do 787B brilhante e sem grave, e alta.** 1–6 kHz 9–10 dB acima, grave 9 dB abaixo, centroide 985 Hz contra 230–380; só 6,2 dB abaixo da carga. Prova: desvios 8, 9 e 23.
5. **RX-8 a 5 000 rpm abafado.** 8–10 dB a menos acima de 1 kHz, centroide 279 Hz contra 520. Prova: desvios 5 e 6.
6. **Lenta fria do Ro80 chiando** (2,5–6k 14,5 dB acima). Prova: desvios 11 e 12.
7. **Crepitar do RX-8 na desaceleração quase inaudível** (1 estalo/s detectado contra 4–6). Prova: desvio 17.
8. **Pré-silencioso sem efeito no agudo** (+1,4 / +0,1 dB contra ≥ 6). Prova: desvio 3.
9. **Níveis de lenta desencontrados** (24,6 dB entre o RX-3 e o 787B) e **Norton com saltos de 869 a 1 877 rpm na lenta quente**. Prova: desvio 28 e T-RAD-04.

## Testes que mentem: Vapor e Elétrico

Medido em 18/11/2026 no commit `1a2a73c`, com a suíte do auditor rodando em paralelo na mesma máquina (32 núcleos). Saídas em `scratchpad/aud/desv-vapele/`.

| Comando | Resultado | Tempo | Duas rodadas iguais? |
|---|---|---|---|
| `npm run teste:vapor` | 125 medidas: 97 ok, 28 desvios, 0 falhas | 67 s e 45 s (o TECNICO diz ~25 s) | sim, menos as 4 linhas de CPU (Big Boy 0,34 → 0,40 do Ronco) |
| `npm run lenta:vapor` | 14/14 | 7 s | — |
| `npm run gravacoes:vapor` | **morre** com `ENOENT` (código 1), 0 medidas | 1 s | — |
| `npm run teste:eletrico` | 94 medidas: 92 ok, 2 desvios, 0 falhas | 37 s e 35 s (o TECNICO diz ~2 min) | sim, menos CPU e coletas (2,93 → 2,75 %; 5 → 4 coletas; p99 do bloco 37 → 55 %) |
| `npm run lenta:eletrico` | 18/18 | 21 s | — |

**Semente.** Os dois DSPs usam `RNG` com semente fixa, então a suíte é determinística, mas o resultado vale só para aquela semente. Troquei a semente de todos os `RNG` sem editar o repositório (um módulo carregado antes com `node --import tsx --import patch.mjs`, que faz `s ^= SEM_OFFSET` na primeira chamada de `next()` de cada instância; `scratchpad/aud/desv-vapele/sem/`) e rodei cada grupo com 3 sementes alternativas (11111, 222222, 3333333). Resultado nos achados T-VAP-01 e T-ELE-03.

**Histórico.** Os dois arquivos de validação têm dois commits cada e nasceram prontos; não há no git commit que alargue tolerância. O afrouxamento que existe está dentro do próprio arquivo (rótulo diferente do critério, condição trocada) e no modo como os desvios entraram (T-VAP-02).

### Vapor (`tools/vapor-valida.ts`, `vapor-lenta.ts`, `vapor-gravacoes.ts`)

**T-VAP-01 — O "0 falhas" do Vapor só vale para a semente que está nos presets.** Severidade: **erro**.
- **Evidência:** de 121 medidas (sem o grupo `cpu`), 90 mudam de valor com a semente e **15 mudam de estado**. Onze que hoje passam viram FALHA com pelo menos uma das 3 sementes:

| Medida (alvo) | semente do preset | 11111 | 222222 | 3333333 |
|---|---|---|---|---|
| ataque 10–90 %, 9/s (37 ms ± 30 %) | 26 ms ok | 24 FALHA | 22 FALHA | 23 FALHA |
| ataque 10–90 %, 4/s (47 ms ± 30 %) | 34 ok | 34 ok | 32 FALHA | 33 FALHA |
| ataque 10–90 %, 21,3/s Big Boy (15 ms ± 30 %) | 17 ok | 19 ok | 20 FALHA | 15 ok |
| banda 2,5–6k a 25 m, 844 pela Cena (−6 ± 5) | −1,7 ok | −0,6 FALHA | −2,6 ok | −0,9 FALHA |
| linha de 2/volta, 3/s (−5…−15 dB) | −10,2 ok | sem linha FALHA | −10,7 ok | −9,1 ok |
| linha de 2/volta, 7/s | −5,6 ok | −5,4 ok | −4,5 FALHA | −6,3 ok |
| p_rel K4s (6,8 ± 0,3 bar) | 6,60 ok | 6,61 ok | 6,79 ok | 6,49 FALHA |
| massa por chuff (0,65 ± 0,05 kg) | 0,623 ok | 0,585 FALHA | 0,632 ok | 0,629 ok |
| nível por chuff na arrancada (+6 ± 3) | +3,6 ok | +4,3 ok | +3,4 ok | +2,6 FALHA |
| apito: ataque (100–300 ms) | 105 ok | 105 ok | 105 ok | 98 FALHA |
| Stanley: "pants"/s (23 ± 0,5) | 23,34 ok | 23,34 ok | 24,80 FALHA | 23,19 ok |

E quatro desvios documentados passam com outra semente (Shay 30,1–30,5/s; Aveling 2,44/s com uma; decaimento a 9/s 65–67 ms com duas; p/v a 21,3/s 11,2–11,7 com as três). O ataque do chuff a 9/s só passa com a semente do preset: o valor verdadeiro está fora da faixa.
- **Estado:** **corrigível em `tools/**`** (medir sobre mais ciclos, hoje 6 s a 4 chuffs/s = 24 chuffs, ou tirar a mediana de 3 sementes; exigir margem mínima) e **para a etapa de som** (ataque curto, ver a lista no fim).

**T-VAP-02 — As 28 falhas viraram 28 "desvios documentados" de uma vez.** Severidade: **erro**.
- **Evidência:** em `d2541f3` o arquivo tinha `const DESVIOS = {}`; o commit seguinte, `9b7495e` ("Vapor: desvios documentados na validação"), só acrescenta as 28 entradas (37 linhas, nada de DSP). Classificação de cada uma na tabela abaixo: **10 são defeitos de som**, 8 são alvos do VAPOR.md que não fecham, 8 são limitações aceitáveis, 2 são medidas mal definidas.
- **Estado:** **para a etapa de som** (os 10) e **para o dono decidir** (os 8 alvos: corrigir o VAPOR.md ou o modelo).

**T-VAP-03 — Desvio não tem teto nem prazo.** Severidade: **dívida**.
- **Evidência:** `DESVIOS` é `nome → texto` (`vapor-valida.ts:24`, usado em `:112`); qualquer valor de uma medida listada sai como "desv". Se o "centroide vale/pico" for de 0,77 para 0,3 a suíte continua verde. Um desvio que passa a dar ok fica na lista sem aviso. Três chaves levam números no nome (`(21.3 Hz)` calculado do diâmetro da roda em `:509`, `lwChuff 128` em `:724`): mudar a ficha transforma o desvio em FALHA pelo motivo errado.
- **Estado:** **corrigível em `tools/**`**: `DESVIOS[nome] = { motivo, medido, tol }`, FALHA se `|medido_agora − medido| > tol`, aviso para desvio que não foi usado. Vale para as outras famílias (mesmo molde).

**T-VAP-04 — Uma medida com `ok` fixo.** Severidade: **erro**.
- **Evidência:** `vapor-valida.ts:141`: `add('pórtico de escape abrindo (graus de manivela)', '20 ± 2°', '20,0° (ABERTURA_PORTICO, ^1,5)', true)`. O "medido" é um texto; o passo 2 do VAPOR.md 7 pedia medir a abertura. (A linha "CPU … (informativo)" em `:175` também é `true`, mas se declara informativa.)
- **Estado:** **corrigível em `tools/**`**: medir o ângulo entre o início do escape e a área plena pelo `tap` (já usado no grupo), ou tirar a linha da contagem.

**T-VAP-05 — Medidas que comparam o código com ele mesmo.** Severidade: **dívida**.
- **Evidência:** (a) "torque médio × ω = ∮p·dV" (`:126–142`) integra o mesmo `p` e o mesmo `V` de onde o torque sai; dá +0,00 % por construção. O plano pedia a potência indicada contra `p_me·A·s·2·n·f_rev`. (b) "τ_bd do esvaziamento" (`:136–140`) é calculado da geometria do preset e de `CD_PORTICO`, sem rodar o laço. (c) "L_W … na referência" (`:695–710`) repete a condição da sonda de `prepararMotorVapor` e reencontra o ganho que ela pôs; cobre 7 das 9 linhas da tabela 4.6 (faltam `bielas` 103 e `queimador` 95).
- **Estado:** **corrigível em `tools/**`**; não afeta o som.

**T-VAP-06 — Rótulo mais estreito que o critério.** Severidade: **dívida**.
- **Evidência:** `:283` mostra "1–3 dB" e aceita até 3,5; `:539` mostra "3–5×" e aceita até 6; `:282` mostra "3–7 dB (±2)" e aceita 1–9 (medido 2,8, fora de 3–7).
- **Estado:** **corrigível em `tools/**`** (rótulo igual ao critério).

**T-VAP-07 — Medidas que leem o estado onde o nome fala de som, ou passam por nada.** Severidade: **dívida**.
- **Evidência:** "Aveling em lenta: escapes por segundo" (`:650–651`) usa `ma.eixo.omega`; a linha da envoltória do áudio é só impressa e discorda (3,38 pela rotação, 1,53–1,64 pela linha). "Stanley parado: queimador contra o escape ≥ +10 dB" mede **+116,7 dB**: o escape é silêncio digital, a comparação não diz nada. "apito: 2º harmônico < −15 dB" mede −83 dB (o modelo não tem harmônico par nenhum; a gravação do D51 tem o 6º a −16).
- **Estado:** **corrigível em `tools/**`**.

**T-VAP-08 — Medidas do plano que não existem ou foram trocadas.** Severidade: **incompleto**.
Evidência, contra VAPOR.md 7 e 3.4:
- passo 9, "cliques 2/volta" do Corliss: o comentário em `:618` cita, nenhuma medida confere;
- passo 10: `bielas` e `queimador` sem L_W conferido;
- passo 11: "mudar qualquer controle não estala (< 0,1 FS com rampa)" e a queda do apito ao soltar (150–250 ms) não têm medida;
- 3.4, apito do C57: `:426–428` renderiza o D51 de novo e descarta (`void xc`). Nenhum preset tem o acorde 356/429/546 (`presets.ts:65–194`), embora o `TECNICO.md:1689` diga "Acordes reais: D51, C57, …";
- passo 3, "21 chuffs/s, corte 20 %" na K4s virou o Big Boy a 21,3/s com corte 30 % (`:269`); passo 8, Doppler da linha da chaminé (132 Hz) virou Doppler do apito do 844 (`:594`). As duas trocas têm comentário, mas o alvo original não é mais conferido.
- **Estado:** **corrigível em `tools/**`** (as medidas) e **para o dono decidir** (acorde do C57: criar preset ou tirar do TECNICO).

**T-VAP-09 — `gravacoes:vapor` não roda.** Severidade: **erro**.
- **Evidência:** `vapor-gravacoes.ts:24` tem como padrão `/tmp/claude-1000/…/scratchpad/real2/vapor/wav`. A pasta existe vazia, o teste de `existsSync` (`:64`) passa e o script morre com a pilha do `ENOENT` em `Steam_engine_ogg.wav`. Os "135 ok e 6 desvios" do `TECNICO.md:1737` não são reproduzíveis hoje; `referencias/` só tem `gasolina/`. O comando não está em nenhum `teste:*`.
- **Estado:** **corrigível em `tools/**`**: padrão `referencias/vapor/` (regra 1 do PLANO), conferir arquivo por arquivo e sair com mensagem clara ("pulado: faltam N gravações") em vez da pilha. As gravações do Commons precisam ser baixadas de novo (pessoa do acervo).
- **Atualização (integração):** o caminho padrão passou a `referencias/vapor/wav` e a mensagem diz o que falta (`b6c47a8`). Continua precisando das gravações, que não vão no git.

**T-VAP-10 — `lenta:vapor` arranca sem o peso da locomotiva.** Severidade: **erro** (da ferramenta).
- **Evidência:** `vapor-lenta.ts:32`: `definirMassa(P.massa + (P.tender?.massa ?? 0) + 300 - P.massa)` = tênder + 300 t. O portador normal soma a locomotiva (`locomotiva-vapor.ts:106`). O Big Boy (350 t + 198 t de tênder) arranca com 498 t em vez de 848 t e chega a 32,4 km/h em 20 s; o Y6b a 35,2 km/h.
- **Estado:** **corrigível em `tools/**`**: `P.massa + (P.tender?.massa ?? 0) + 300`; conferir que as 10 locomotivas ainda passam do critério de 5 km/h ou patinam.
- **Atualização (integração):** corrigido em `875e705`: a arrancada usa locomotiva + tênder + 300 t. As 14 máquinas continuam passando (o Big Boy chega a 18,8 km/h em 20 s, não mais a 32,4).

**T-VAP-11 — Limiar de drifting da lenta alargado para o Y6b caber.** Severidade: **dívida**.
- **Evidência:** `vapor-lenta.ts:8–9` e `:98`: critério "≥ 12 dB", com a nota "o Y6b … fica em −14". O VAPOR.md 1.7 e o `teste:vapor` pedem −25 ± 3 (K4s: −25,7). Medido: Y6b −13,7 dB; as outras máquinas que escapam pela chaminé, de −26 a −43 (o barco, com condensador, dá −14,2 e é isento do critério).
- **Estado:** **para a etapa de som** (o bufo do Y6b em drifting, 11 dB acima do projeto); depois o limiar volta a −22.

**T-VAP-12 — A medida de CPU oscila com a carga.** Severidade: **dívida**.
- **Evidência:** Big Boy 0,34 e 0,40 do Ronco em duas rodadas seguidas; o texto do desvio diz 0,38, o TECNICO 0,34. A razão contra o Ronco no mesmo processo protege de máquina lenta, não de carga variável.
- **Estado:** **corrigível em `tools/**`** (mediana de 3 passadas alternadas Ronco/Vapor).

**T-VAP-13 — TECNICO com números velhos.** Severidade: **sugestão**.
- **Evidência:** "~25 s" (`TECNICO.md:1738`; medido 45–67 s com a máquina ocupada), CPU 0,25/0,25/0,34 (medido 0,24/0,23/0,34 e 0,25/0,22/0,40).
- **Estado:** corrigir junto com a frente 7.

#### Todos os desvios do Vapor

Classes: **a** defeito de som aceito pelo teste · **b** alvo do VAPOR.md errado ou que não fecha · **c** limitação aceitável · **d** medida mal definida.

| # | Medida (chave em `DESVIOS`) | Alvo | Medido | Classe | Gravidade | Em uma frase |
|---|---|---|---|---|---|---|
| 1 | centroide vale/pico, de perto | 1,05–1,35 | 0,77 | a | alta | Entre os chuffs fica um sopro grave e liso (a tiragem, 200–1500 Hz); nas gravações o vale é mais claro que o pico (chiado de vazamento e jato residual). |
| 2 | decaimento a −10 dB a 1,4 chuff/s (844) | 89 ms ± 30 % | 45 ms | a | média | Na arrancada lenta cada chuff morre na metade do tempo: seco, sem corpo. |
| 3 | King: linha de 8/volta contra a de 4/volta | < −20 dB | −5,2 dB | a | média | Ouvem-se quase 8 batidas por volta em vez de 4 duplas; a própria gravação da 6024 dá −14 dB, o modelo fica 9 dB além dela. |
| 4 | patinagem: energia por chuff no fim do surto | ≤ −6 dB | +6,1 dB | a | média | Ao patinar, cada chuff sai mais forte em vez de mais fraco: o surto soa como aceleração forte, não como roda solta. |
| 5 | Aveling em lenta: banda 400–1k | +8 ± 4 dB | −1,3 dB | a | média | O trator parado soa como chaminé de locomotiva pequena; falta o barulho de mecanismo. |
| 6 | pico/vale, 21,3/s de perto (Big Boy) | 9 ± 3 dB | 13,2 dB | a | média | A 52 km/h os chuffs ainda saem separados; devia fundir num rugido. Passa com as 3 outras sementes (11,2–11,7). |
| 7 | pico/vale a 25 m, 6,3/s | 7–8 ± 3 dB | 13,3 dB | d + a | média | O teste renderiza sem reverberação nem fundo, que são o que enche o vale na gravação; como a página toca com eles, a medida não diz como soa lá. |
| 8 | nível por chuff em cruzeiro (corte 25 %, 15/s) | −4 ± 3 dB | −7,8 dB | a | baixa | Em cruzeiro a locomotiva fica uns 4 dB mais fraca do que o projeto espera. |
| 9 | decaimento a −10 dB, 9/s | 52 ms ± 30 % | 70 ms | a | baixa | A cauda do chuff se alonga em velocidade média (a tiragem enche o vale). Passa com 2 das 3 outras sementes. |
| 10 | Stanley: pico/vale do escape | ≤ 4 dB | 6,7 dB | a | baixa | O Stanley pulsa demais; devia ser um ofegar quase contínuo (falta o volume do abafador). |
| 11 | Aveling em lenta: escapes por segundo | 2,5 ± 0,3 | 3,38 | a + d | baixa | A lenta do trator fica 35 % rápida; aos 20 s a máquina ainda está desacelerando e o teste não espera. Medida lida da rotação, não do som. |
| 12 | locomotiva trabalhando a 15 m (K4s) | 90–100 dB(A) | 85,8 | b + d | — | L_W 124 dá 89,5 dB(A) a 15 m em campo livre: o alvo não cabe na ficha. O teste ainda tira ~3 dB pela média dos dois ouvidos. |
| 13 | locomotiva trabalhando a 15 m (UP 844) | 95 ± 5 dB(A) | 89,1 | b + d | — | Idem (128 dá 93,5). |
| 14 | apito a 30 m (lateral) | 105 ± 3 dB(A) | 100,5 | b + d | — | O apito aponta para a frente (−6 dB de lado) e o alvo é no eixo. |
| 15 | segurança a 10 m | 110 ± 3 dB(A) | 104,4 | b + d | — | A válvula fica a 11,9 m do ouvinte; mais a média dos ouvidos. |
| 16 | composição a 100 km/h: vagões contra a locomotiva | 0 ± 4 dB | −9,7 dB | b | — | A conta de 3.5 esquece o rolamento da própria locomotiva e do tênder. É estimativa do projeto, não medida de gravação. |
| 17 | banda 400–1k no pico a 25 m (844, pela Cena) | −1 ± 4 dB | +6,2 | b | — | O alvo é a média de três máquinas; a gravação do próprio 844 dá +4,0. |
| 18 | banda 1–2,5k no pico a 25 m | −3 ± 4 dB | +3,3 | b | — | Idem; a gravação do 844 dá +4,9. |
| 19 | apito aberto 20 s derruba a caldeira | 0,6 ± 0,2 bar | 0,11 | b | — | Consumo e `k_cal` do próprio VAPOR.md dão 0,16 bar. Não se ouve. |
| 20 | arrancada (300 t): queda em 30 s | 1–2 bar | 0,83 | c | — | Lei de área do regulador; não se ouve. |
| 21 | Shay a 20 km/h: chuffs/s | 30 ± 0,6 | 31,10 | d | — | O detector pega uma banda lateral; a taxa da telemetria é exata. Passa com as 3 outras sementes. |
| 22 | Big Boy: linha de 8/volta ao longo de 60 s | varia ≥ 10 dB | 7,6 dB | c | baixa | A deriva de fase entre os dois motores aparece menos que na gravação. |
| 23 | linha de 2/volta relativa à de 4/volta, 10/s | −5…−15 dB | −3,9 | c | — | Os chuffs se sobrepõem a 10/s. |
| 24 | banda 1–2,5k no pico, de perto | −2 ± 3 dB | +1,7 | c | — | 0,7 dB fora. |
| 25 | patinagem: chuffs/s no surto | 15–20 | 13,8 | c | baixa | A roda sobe 3,3× (dentro de 3–5×). |
| 26 | Corliss: degrau de 50 % de carga | −3 ± 1 % | −5,3 % | c | — | Dinâmica do governador; quase inaudível. |
| 27 | Corliss: volta a ±1 % | 5–10 s | 4,8 s | c | — | 0,2 s fora. |
| 28 | CPU por amostra, Big Boy / Ronco | < 1/3 | 0,34–0,40 | c | — | 16 extremidades; oscila com a carga da máquina. |

Os quatro níveis absolutos (12–15) têm uma causa só: ou a convenção de medida dos testes da Cena (média das potências dos dois ouvidos) tira 3 dB de uma fonte de lado, ou os `lwChuff` do projeto estão ~4 dB baixos para os níveis de referência que ele mesmo cita. **Para o dono decidir.**

#### Pendente no TECNICO (Vapor), conferido no código

| Item (`TECNICO.md:1815–1820`) | Hoje |
|---|---|
| Cena 3D da composição em `vapor.html` | não feito (nenhum `three`/`cena3d` em `src/pages/vapor/`) |
| Ruído de mecanismo (Aveling), volume do abafador (Stanley), tiragem com o espectro do vale | não feito: são os desvios 1, 5, 10 e 11 |
| Hélice no barco; diesel marítimo | não feito (`barco.ts` não tem `FonteHelice`; `COMPAT.barco` aceita diesel, `USO_REAL.barco` não, e não há preset) |
| Conferir a Maria Fumaça na ABPF | não feito (para o dono) |
| "Relatado, sem mudar": `Line` com `c` por instância, volume acústico e orifício implícito em `vapor/rede.ts` | continuam lá; candidatos a subir para `acoustics/` (frente 4) |

### Elétrico (`tools/eletrico/valida.ts`, `lenta.ts`, `gc.ts`)

**T-ELE-01 — Há só 2 desvios porque boa parte das medidas confere o sintetizador contra a própria tabela.** Severidade: **erro** (de método).
- **Evidência:** o `EletricoDSP` é um banco de osciladores que recebe frequência e amplitude das fórmulas do ELETRICO.md 1; o teste mede a saída e compara com as mesmas fórmulas. Os erros saem zero: frequências 0,000 % e 0,0002 %; ranhuras −6,0 / −14,0 / −10,0 (alvo −6 / −14 / −10); Φ −6,0; Bessel igual à fórmula nas 6 linhas (o alvo impresso é a própria `dbTensao`, `valida.ts:220–222`); barras 3700,0 Hz (esperado 3700,0); escorregamento 0,847 (0,847); bandas laterais −10,0 / −10,0; +6,02 ao dobrar o torque; AVAS 1,200 %/km/h; síncrona 0,0000 % (as duas grandezas vêm da telemetria, `:294`). Os harmônicos do Mavic são comparados com `HARM_MAVIC`, importado de `src/engines/eletrico/mecanica.ts` (`:19`, `:619`). A "sonda: cada fonte no L_W" (`:420–461`) repete a calibração. São cerca de 30 das 94 medidas. Servem de regressão do código; nenhuma diz se o som parece com o de verdade.
- **Estado:** **para o dono decidir** (separar na saída "conformidade com o projeto" de "contra gravação"); o alvo de som passa a ser o do kit `ouvido`.

**T-ELE-02 — O grupo `gravacoes` não abre gravação nenhuma.** Severidade: **erro**.
- **Evidência:** `gGravacoes` (`:506–666`) compara renders com números copiados do ELETRICO.md 3.7. Três dos casos montam, dentro do teste, presets que não existem no produto: furadeira de rede (`:594`), drone 2 (`:625`) e MP 73 (`:636`); o `TECNICO.md:1653` confirma. Os presets reais correspondentes (`frotaa` com chopper, `mavic`, `furadeira`) não ganham esses alvos. Os scripts que mediam as gravações (`tools/eletrico/analise/*.py`) não são chamados por nenhum script do `package.json`.
- **Estado:** **corrigível em `tools/**`** (renomear o grupo para `alvos-3.7`; casos de variantes fora da contagem) e **para a etapa de som** (comparação casada com as gravações em `referencias/eletrico/`, que hoje não existe).

**T-ELE-03 — 8 medidas mudam de estado com a semente.** Severidade: **erro**.
Evidência (92 medidas sem o grupo `cpu`; 49 mudam de valor):

| Medida (alvo) | semente do preset | 11111 | 222222 | 3333333 |
|---|---|---|---|---|
| MP 73: centro da corcova (aceita 550–900) | 896 ok | 902 FALHA | 902 FALHA | 932 FALHA |
| AVAS a 2 m, 20 km/h (67 ± 1,5) | 68,3 ok | 68,4 ok | 68,5 FALHA | 68,6 FALHA |
| \|T\| < 3 %: engrenamento (< −40 dB) | −40,6 ok | −41,1 ok | −41,5 ok | −39,7 FALHA |
| Leaf a 85 km/h: 96·f_rot (9,5 kHz ± 1 %) | 9422 ok | 9416 ok | 9421 ok | 9215 FALHA (o detector pega outra linha) |
| Leaf: razão das famílias agudas (1,46 ± 0,05) | 1,500 ok | 1,500 ok | 1,500 ok | 1,305 FALHA |
| furadeira sem fio: banda 2,5–6k (+16,7 ± 4) | +13,2 ok | +12,8 ok | +13,0 ok | +12,7 FALHA |
| Taurus no patamar: banda 1–2,5k (−2,0 ± 4) | −5,8 ok | −5,9 ok | −6,2 FALHA | −5,8 ok |
| CPTM 9500 parado: banda 1–2,5k (−4,3 ± 4) | −0,3 ok | −0,3 ok | −0,0 FALHA | −0,4 ok |

Outras que passam na borda com a semente do preset: do-re-mi a 0,6 m/s² (4,30 s para 3,6 ± 0,7), Mavic BPF 211,0 Hz para 209 ± 1 % (0,96 %; mede o rotor de +1 %), CPU de 200 linhas 2,93 % para < 3 %.
- **Estado:** **corrigível em `tools/**`** (mediana de sementes, janela de busca do Leaf mais estreita) e **para a etapa de som** (as bandas do Taurus e da CPTM estão no limite, ver T-ELE-05).

**T-ELE-04 — AVAS e pneus são medidos sem chão; o projeto pede asfalto.** Severidade: **erro**.
- **Evidência:** o passo 7 do ELETRICO.md pede "a 2 m (Cena, céu aberto, solo asfalto)"; `valida.ts:386` usa `solo: { tipo: 'nenhum' }` (a troca está justificada num comentário e no `TECNICO.md:1648`). Refiz a medida com asfalto (`scratchpad/aud/desv-vapele/exp-eletrico.ts`): **54,8 / 62,6 / 70,0 dB(A)** a 0 / 10 / 20 km/h contra 55 / 61 / 67 ± 1,5: duas das três fora (+1,6 e +3,0). Os pneus a 80 km/h (`:499`, também sem chão): 70,7 dB(A) em campo livre (o desvio documentado) e **75,7 no asfalto** (`exp-pneus.ts`), 2,7 acima do alvo de 73 ± 2. Na página o carro anda no asfalto.
- **Estado:** **para a etapa de som** (calibrar AVAS e pneus na condição em que se ouve) e **corrigível em `tools/**`** (medir nas duas condições, o alvo vale na do projeto).

**T-ELE-05 — O grave nunca é conferido, e está baixo.** Severidade: **erro**.
- **Evidência:** a decisão de 3 é "bandas ±4 dB de 150 Hz a 6 kHz, ±6 dB em 20–150 Hz". Os quatro casos de bandas conferem só 400–1k, 1–2,5k e 2,5–6k (`:589`, `:624`, `:655`, `:664`). No Taurus e na CPTM o vetor de alvos está deslocado uma casa: `alvo = [NaN, -11.5, 0, …]` põe o valor de 20–60 Hz na posição de 60–150 e o rótulo mostra "60–150: −11,5" (o ELETRICO.md 3.1 dá −11,5 em 20–60 e −1,8 em 60–150). Medido com as sete bandas (`exp-eletrico.ts`):

| Caso | 20–60 | 60–150 | 400–1k | 1–2,5k | 2,5–6k | 6–12k |
|---|---|---|---|---|---|---|
| Taurus no patamar, medido | **−19,9** | **−8,7** | −0,4 | −5,8 | −13,0 | −24,9 |
| gravação A (3.1) | −11,5 | −1,8 | +3,2 | −2,0 | −12,4 | −17,5 |
| CPTM 9500 parado de dentro, medido | **−14,4** | −4,6 | +1,8 | −0,3 | −17,2 | −42,9 |
| gravação (3.2) | −5,5 | −1,3 | +0,9 | −4,3 | −18,7 | −18,7 |
| furadeira sem fio, medido | −26,7 | −17,7 | +4,6 | +17,3 | +13,2 | +8,5 |
| gravação (3.5) | −25,4 | −23,5 | +4,9 | +17,0 | +16,7 | +19,7 |

Com a tolerância do projeto, o Taurus falharia em 20–60 (8,4 dB) e em 60–150 (6,9 dB), e a CPTM em 20–60 (8,9 dB). O passo 10 pedia também as bandas do drone 2, que não são medidas.
- **Estado:** **para a etapa de som** (falta peso no Taurus e no metrô de dentro; é a queixa do dono) e **corrigível em `tools/**`** (conferir as 5 bandas, corrigir o vetor).

**T-ELE-06 — Tolerância alargada no código, não no rótulo.** Severidade: **dívida**.
- **Evidência:** `:273`, duração dos degraus do do-re-mi: rótulo "0,3–1,2 s", critério `≥ 0,3 − 0,051`; a 0,6 m/s² o rótulo "0,2–1,2 s" não vem do plano e o critério aceita 0,149. `:647`, MP 73: rótulo "≈ 300 → 700 Hz", critério 230–400 e 550–900 (medido 896, +28 %). `:567`, portadora do Tesla "≈ 10 kHz" aceita ±300 Hz (medido 9785).
- **Estado:** **corrigível em `tools/**`**.

**T-ELE-07 — A ficha do Metropolis foi mudada para o teste passar.** Severidade: **erro**.
- **Evidência:** `src/engines/eletrico/presets.ts:175` tem `Pmax: 150000` e `:180` explica: "150 kW: com os 190 da ficha o 0–80 km/h sai em 30 s, contra 36 ± 4 do passo 2". O alvo de 36 s é uma estimativa do plano ("1,0 m/s² até 40, depois potência constante"), não uma medida. O `TECNICO.md:1645` lista outros níveis ajustados do mesmo jeito (inversor dos carros 72 → 62 dB(A), Taurus 98 → 96 e 85 → 77, furadeira), e são esses ajustes que fazem passar "tom 10 dB acima do fundo" e "linhas fixas a −10 dB".
- **Estado:** **para o dono decidir**: voltar `Pmax` a 190 kW e trocar o alvo para 30 ± 4 s (ficha vence estimativa). Os níveis ajustados contra gravação ficam, marcados como calibração.

**T-ELE-08 — "do-re-mi a 0,6 m/s²" não acontece a 0,6 m/s².** Severidade: **dívida**.
- **Evidência:** `doremi()` limita o pedal a 1 (`:247`); o `TECNICO.md` admite "o esforço de partida de 300 kN não dá 0,6 m/s² com 486 t". A escala sai em 4,30 s, no limite de 3,6 ± 0,7.
- **Estado:** **corrigível em `tools/**`** (reduzir a massa rebocada do caso ou nomear a aceleração real).

**T-ELE-09 — O grupo `passagem` não testa os presets da página.** Severidade: **dívida**.
- **Evidência:** `:715–721` copia cinco presets à mão, todos a 4 m e em céu aberto (menos o N700). Os da página (`src/pages/passagem/presets.ts`) são: Taurus na estação a 6 m, metrô na estação a 2 m, Tesla a 5,1 m, drone com lateral 0. Critério: sem NaN, rpm > 0 e `nível > 20 dB`, só no canal esquerdo.
- **Estado:** **corrigível em `tools/**`**: coberto pelo teste novo que monta todos os presets da Passagem (frente 2); este grupo pode sair.

**T-ELE-10 — CPU e coletas a menos de 10 % do limite.** Severidade: **dívida**.
- **Evidência:** "CPU de 200 linhas < 3 %": 2,93 % e 2,75 % (o TECNICO registra 1,8 %); "motor do N700 ≤ 5 %": 4,48 % e 4,69 % (TECNICO: 2,9 %); "≤ 6 coletas": 5 e 4; p99 do bloco do N700 no túnel 37 % e 55 % do quantum (não conferido). Com outra coisa rodando na máquina estes três viram falha intermitente.
- **Estado:** **corrigível em `tools/**`**: o `verificar` roda os grupos de CPU sozinhos, no fim; mediana de 3.

**T-ELE-11 — "Sem alocação" virou "quase".** Severidade: **dívida**.
- **Evidência:** o passo 1 pede zero coletas em 10 s; o banco de linhas dá zero, mas a medida do motor (`:116`) aceita "≤ 6 coletas jovens" e mede 4–5: o laço do `MotorEletrico` do N700 aloca.
- **Estado:** listar na frente 5 (robustez); a correção é no DSP.

**T-ELE-12 — Critérios de um lado só ou satisfeitos por zero.** Severidade: **dívida**.
- **Evidência:** "Tesla a 100 km/h: trem de força ≤ −8 dB do total" mede **−29,3 dB**: passaria com o motor desligado. "chopper some em D = 1" −654,7 dB e "AVAS a 25 km/h" −600 dB são zeros exatos.
- **Estado:** **para o dono decidir** se o trem de força 29 dB abaixo dos pneus a 100 km/h é o que se quer; se não, o critério vira faixa (−8…−20).

**T-ELE-13 — Itens da tabela 3.7 e do plano sem medida.** Severidade: **incompleto**.
- **Evidência:** "MP73: sem linha fixa > −30 dB" (só o centro da corcova é medido); "Tesla: uivo só 5–10 dB sobre o largo na cabine" (3.3); bandas do drone 2 (passo 10); os presets de passagem "bonde a 5 m", "N700 na estação a 80 km/h" e "metrô 9500 chegando" do passo 11 não existem (há o Metropolis); o risco "soa a sintetizador" (7.1) não tem medida nenhuma.
- **Estado:** **para a etapa de som** (HNR e planura entre linhas pelo kit `ouvido`).

**T-ELE-14 — Trens parados em silêncio digital.** Severidade: **incompleto** (som).
- **Evidência:** `lenta:eletrico` imprime `parado: pico -Infinity dBFS` para `frotaa`, `cptm9000` e `metropolis` (e `formulae`, `furadeira`, `liquidificador`, onde é esperado). Taurus, Vectron, CPTM 9500, N700, TGV e Flexity têm auxiliares (−37 a −55 dBFS).
- **Estado:** **para a etapa de som**: um metrô parado na estação tem compressor, ventilação e conversor.

**T-ELE-15 — TECNICO com números velhos.** Severidade: **sugestão**.
- **Evidência:** "~2 min" (`TECNICO.md:1596`; medido 35–37 s); CPU 1,8 % / 2,9 % / 17,2 % (medido 2,8–2,9 / 4,5–4,7 / 27 % com a máquina ocupada).
- **Estado:** frente 7.

#### Todos os desvios do Elétrico

| # | Medida | Alvo | Medido | Classe | Gravidade | Em uma frase |
|---|---|---|---|---|---|---|
| 1 | pneus do carro a 80 km/h, a 7,5 m (campo livre) | 73 ± 2 dB(A) | 70,7 (75,7 no asfalto) | b + d | baixa | O alvo do CENA 4.1 soma as 4 rodas à mesma distância; a medida é feita sem chão, e com asfalto passa do alvo pelo outro lado (T-ELE-04). |
| 2 | N700 de 16 carros (14 motores) | ≤ 64 fontes | não monta (67 sem motor) | c | — | Limite de fontes da Cena; o N700 da página tem 10 carros. Fica como incompleto do produto. |

#### Pendente no TECNICO (Elétrico), conferido no código

| Item (`TECNICO.md:1656–1661`) | Hoje |
|---|---|
| Trem de 16 vagões (N700 inteiro) | não feito (desvio 2) |
| Grave da cabine do carro elétrico (rumor e "boom" abaixo de 200 Hz) | não feito (`carro-eletrico.ts` só tem `fCabine: 55` no corpo do ônibus; nenhuma fonte de rumor) |
| Chave 50/60 Hz do motor industrial; presets do MP 73, da furadeira de rede e de drones menores | não feito (`fRede: 50` fixo em `presets.ts:288`; 18 presets, nenhum dos três) |
| Revisão de ouvido de todos os presets | não feita |

### Para a etapa de som (Vapor), por prioridade

1. **O vale entre os chuffs é um sopro grave e contínuo.** K4s a 4 chuffs/s, corte 70 %, de perto: centroide do vale 0,77 do pico; as gravações dão 1,05–1,35. É o padrão que o PLANO descreve: ruído largo liso (a tiragem) no lugar do chiado preso ao evento.
2. **Chuff seco na arrancada.** 844 a 1,4 chuff/s: decaimento de 45 ms contra 89. O ataque também está curto (34 ms contra 47 a 4/s; 26 contra 37 a 9/s) e só passa com a semente do preset.
3. **King com 8 batidas.** Linha de 8/volta a −5,2 dB da de 4/volta; a gravação da 6024 tem −14.
4. **Patinagem ao contrário.** Cada chuff do surto sai 6 dB mais forte (devia cair 6 ou mais) e a taxa chega só a 13,8/s.
5. **Aveling parado sem mecanismo e com a lenta rápida.** 400–1k em −1,3 contra +8 dB; 3,4 escapes/s contra 2,5.
6. **Big Boy a 52 km/h pulsa demais.** p/v 13,2 dB contra 9 ± 3; a linha de 8/volta varia 7,6 dB (pede 10).
7. **A 25 m o vale some** (p/v 13,3 contra 7–8). Antes de mexer, medir como a página toca: com reverberação e fundo.
8. **Cruzeiro fraco.** −7,8 dB por chuff a 15/s, corte 25 % (alvo −4 ± 3).
9. **Y6b em drifting bufa alto.** −13,7 dB do cruzeiro; o projeto pede −25.
10. **Stanley pulsa.** p/v 6,7 dB contra ≤ 4.
11. **Cauda longa a 9/s.** 70 ms contra 52.
12. **Níveis absolutos 4–6 dB abaixo das referências do projeto** (K4s 85,8 e 844 89,1 dB(A) a 15 m; apito 100,5 a 30 m; segurança 104,4 a 10 m). Decisão do dono: convenção de medida ou `lwChuff`.

### Para a etapa de som (Elétrico), por prioridade

1. **Falta grave no Taurus e no metrô.** Taurus no patamar: 20–60 Hz em −19,9 (gravação −11,5) e 60–150 em −8,7 (−1,8). CPTM 9500 de dentro: 20–60 em −14,4 (−5,5). Nenhum teste olha essas bandas.
2. **O miolo do Taurus está no limite.** 400–1k em −0,4 contra +3,2 e 1–2,5k em −5,8 contra −2,0: passa por 0,2–0,4 dB e falha com outra semente.
3. **AVAS e pneus no asfalto.** AVAS a 20 km/h 70,0 dB(A) para 67 ± 1,5; pneus a 80 km/h 75,7 para 73 ± 2. Os testes medem sem chão.
4. **Metrôs parados mudos** (Frota A, CPTM 9000, Metropolis).
5. **Tesla a 100 km/h: trem de força 29 dB abaixo do total.** Decidir se é para ouvir o motor.
6. **Furadeira escura em cima.** 2,5–6k 3,5 dB abaixo; 6–12k 11 dB abaixo (acima de 6 kHz a gravação é só informativa).
7. **Mavic.** O pico medido é o rotor de +1 % (211 Hz), não o de 209.
8. **"Soa a sintetizador"** não tem medida: razão harmônico/ruído e planura entre as linhas contra as gravações, pelo kit `ouvido`.
9. **Metropolis com 150 kW** em vez dos 190 da ficha (decisão do dono, T-ELE-07).

## Código morto, duplicação, tipos frouxos e nomes (análise estática)

Levantado no commit `745e183` (branch do auditor), sem editar o repositório. Todo número abaixo saiu de script, não de estimativa. Os scripts estão em `scratchpad/aud/k/` (`dup.py` linhas idênticas por par, `metodos.py` e `cmpfn.py` corpo de função por hash, `exports2.py` exports por importação resolvida, `orfaos.py` alcance a partir das entradas do build, `props-nao-lidas.py` e `campos-sem-acesso.py` campos nunca lidos, `anys.py`); o build de conferência foi feito com `--outDir` no scratchpad.

Como ler "linhas idênticas": linhas com 12 caracteres ou mais, sem espaços repetidos, fora comentários e `import`; a porcentagem é sobre o arquivo menor do par.

**Contagem:** 37 achados: 5 erros, 4 incompletos, 24 dívidas, 4 sugestões.

### Legado

**K-01 · sugestão · O legado já não é importado por nada que entra no site.**
- **Evidência:** `grep` de `src/(dsp|geometry|presets|app|jet-dsp|jet-presets|jet-app).js`, `style.css`, `jet.css`, `jato.html` em `src/**/*.ts(x)`, nos 9 HTML do build, `vite.config.mts`, `tsconfig*.json` e `package.json`: só `jato.html:11–12, 69–71` (ele mesmo legado) carrega os `.js` e os dois `.css`. Em `src/**/*.ts(x)` sobram 38 linhas de **comentário** em 33 arquivos ("migrado de src/dsp.js", "renderControls() de app.js"). O alcance a partir das 9 entradas (`orfaos.py`) confirma: `src/app.js`, `dsp.js`, `geometry.js`, `presets.js`, `jet-app.js`, `jet-dsp.js`, `jet-presets.js` não são alcançados pelo build.
- **Estado:** livre para remover do lado de `src/` (a remoção e o porte de `tools/analise-som/` ficam com o auditor principal). Depois da remoção os 38 comentários apontam para arquivos que só existem no histórico; vale uma frase no TECNICO dizendo o commit (`02c185f`).
- **Atualização (integração):** legado removido em `73c2590`. Os comentários que citam `src/dsp.js` e os outros apontam para o histórico (commit `02c185f`, `tools/legado.ts`).

### Duplicação entre páginas

**K-02 · dívida · Os `controle.ts` das quatro páginas a pistão são o mesmo arquivo copiado quatro vezes.**
- **Evidência (`dup.py`, `metodos.py`):** Ronco 305 linhas, Diesel 226, Radial 199, Rotativo 185 (915 no total), sem classe-base.

| Par | Linhas idênticas | % do menor | Maior bloco contíguo |
|---|---|---|---|
| ronco × diesel | 92 | 56% | 8 |
| diesel × rotativo | 74 | 53% | 18 |
| ronco × radial | 79 | 52% | 9 |
| ronco × rotativo | 69 | 49% | 8 |
| radial × rotativo | 66 | 47% | 10 |
| diesel × radial | 60 | 40% | 12 |

Dos 73 membros de classe com o mesmo nome em pelo menos duas das quatro, 43 têm corpo idêntico (`assinar`, `obter`, `assinarLento`, `enviarParams`, `setCoolant`, `setIgnition`, `setEq`, `setTempMode`, `setEnvironment`…) e 30 já divergiram (`initAudio`, `pushConfig`, `setSpec`, `loadPreset`, `sendInput`, `aoTelemetria`, `shift`…). Divergências que são diferença de família e não defeito: o `tune` do Ronco manda `{...spec}` e o do Diesel/Rotativo manda `montarConfig(spec)`; a carência do "motor morreu" é 1500 ms no Ronco/Diesel e 3000 ms no Radial/Rotativo. Vapor, Elétrico, Turbina e Passagem têm controles próprios (3–19% em comum com os outros); o par mais parecido entre eles é Elétrico × Passagem, com 38 linhas idênticas (19%).
Também repetidos entre páginas: `VALVE_MODES` ×3, `DRIVE_MODES` ×2, `POSICOES_MANETE`/`MARCAS_MANETE` ×2, `LIGADO` ×3, `NOTA_CORTE` ×2, `THROTTLE_KEYS` ×2, `PEDAL` ×2, e `clamp` definido 14 vezes em `src/pages/` mais uma em `src/ui/Manete.tsx:26` (já existe em `src/acoustics/util.ts:4`).
- **Estado:** para a pessoa da interface (uma classe-base `ControlePistao` com o store, o áudio, a temperatura e o pedal; as páginas só sobrescrevem o que é da família).
- **Atualização (integração):** feito em `f089c79` (F1). `ControlePistao` (`src/pages/comum/controle.ts`) tem o store, a cadeia de áudio, a escuta, `setSpec`/`previewSpec`/`tuneSpec`, o envio da configuração, a válvula, as relações das marchas, a temperatura, o pedal e a manete, a ignição e a telemetria; cada página dá a geometria, as duas configurações, o que o DSP recebe de novo depois de cada configuração, o preset, o câmbio e a carência do "apagou" (ver TECNICO, "As quatro páginas a pistão"). Os `controle.ts` das páginas foram de 929 linhas (no `8e64338`) para 392, mais 297 do comum. As divergências de família ficaram na página (o `tune` de cada uma, as carências de 1,5 e 3 s, o que vai ao DSP com a cadeia); as de esquecimento corrigidas: o `fresh` de um preset que um controle mexido nos 60 ms seguintes desfazia (nas quatro), o Ronco que abria com o Camaro sem `ACESSORIOS_PADRAO` (o som legado até o primeiro clique num preset) e a manete do Radial que andava com as teclas mesmo fora do comando. `VALVE_MODES`, `LIGADO`, `POSICOES_MANETE`/`MARCAS_MANETE`, `THROTTLE_KEYS`/`PEDAL` e o `clamp` das quatro páginas têm uma definição só; `NOTA_CORTE` e `DRIVE_MODES` continuam um por página (os textos são da família). Conferido em Node contra o `8e64338` (painel renderizado e mensagens ao DSP, 1 448 casos: iguais, menos as correções) e nas capturas paradas a 1440 e 400 px (iguais, menos o painel do Ronco ao abrir).

**K-03 · dívida · `Painel.tsx`: a função `mix` é idêntica nas quatro páginas a pistão e as seções são forks.**
- **Evidência (`cmpfn.py`):** `mix` em `ronco/Painel.tsx:45`, `diesel/Painel.tsx:42`, `radial/Painel.tsx:38`, `rotativo/Painel.tsx:48` tem o mesmo hash. `br`, `virgula`, `pct` definidos 4 vezes; `nomeDaTroca` 2. Seções com o mesmo nome: `Escuta`, `Motor`, `Caracteristicas`, `Temperatura`, `Escapamento` nas 4; `Transmissao`, `Acessorios`, `Admissao` em 3; `CorteDeGiro`, `Estalos`, `AguaDoMotor` em 2. Ronco × Diesel: 106 linhas idênticas (38%); Ronco × Rotativo 72; Radial × Rotativo 40.
- **Estado:** para a pessoa da interface (`<Mixagem>`, `<EscutaEAmbiente>`, `<Temperatura>` em `src/ui/` ou `src/pages/comum/`).
- **Atualização (integração):** feito em `f089c79` (F1). `mix` virou `Mixagem`, e os outros pedaços que só ligam um controle a uma ação estão em `src/pages/comum/Painel.tsx` (`Observador`, `Microfone`, `NaVia`, `Ambiente`, `SomDeFundo`, `VolumeDoMotor`, `Equalizacao`, `AguaDoMotor`, `TemperaturasProntas`, `RelacoesDasMarchas`, `FAIXA_DO_CORTE` e `trocaDoCorte`), com `br` e `LIGADO`; `pct` foi para `src/ui/formato.ts` e `virgula` é o `dec` de lá. As seções ficaram em cada página: o que difere entre as cópias é conteúdo da família (rótulos, dicas, faixas, notas). O pedal, a manete e as posições, a navegação de presets e o balanceamento, repetidos nas `Pagina*.tsx`, estão em `src/pages/comum/Palco.tsx`. Diferenças entre as escutas que eram esquecimento, fechadas em `8844868` com as mesmas peças: o Radial ganhou o médio (900 Hz) e o "Zerar"; os Rotativos, o rótulo "Médio (900 Hz)", o "Zerar" e a via como a do Ronco (vista de cima, nota da passagem, 2–40 m em vez de 2–60 m com uma casa); Radial e Rotativos, as dicas de "Som de fundo" e "Volume do motor" e a nota do Arcade (o texto padrão de `src/pages/comum/Painel.tsx`). No mesmo commit: o botão do freio (`BotaoDoFreio`, `src/pages/comum/Palco.tsx`) e S / ↓ nos Rotativos (era só S, sem botão) e no tanque, no carro e na moto do Radial (não havia freio; o `RadialDSP` já freava pela mensagem `input`: o Sherman em 1ª cai de 4,0 para 0,2 km/h em 2 s com o freio, contra 1,7 sem); a manete de potência nos presets de aviação dos Rotativos, como na Aviação do Ronco (era o pedal; a mensagem ao DSP é a mesma); e o pedal da tela do Diesel, que ao ser solto soltava também o acelerador seguro no teclado.

**K-04 · dívida · `diesel/mostradores.ts` é cópia de `ronco/mostradores.ts` com acréscimos.**
- **Evidência:** 255 das 281 linhas significativas do arquivo do Ronco estão idênticas no do Diesel (91%; maior bloco 47 linhas; 299 linhas em blocos de 4 ou mais). Radial e Rotativo fizeram o certo e importam `Mostradores` do Ronco (`radial/PaginaRadial.tsx:12`, `rotativo/mostradores.ts:10`). Diferenças do Diesel: fundo de escala `1,15·rpmMax`, `tele.sobre` no lugar de `tele.limiter`, traço p–θ e leituras (linhas novas). Uma divergência latente: `glow = new Float32Array(32)` no Ronco (`:27`) e `16` no Diesel (`:26`); hoje não estoura porque o painel só oferece até 16 cilindros (`diesel/Painel.tsx:164`), mas a geometria define `'v-20'` (`diesel/geometria.ts:14`), que nenhum preset nem o painel alcança.
- **Estado:** para a pessoa da interface (herdar de `Mostradores` do Ronco, como o Rotativo).
- **Atualização (integração):** feito em `f089c79` (F1). `src/pages/ronco/mostradores.ts` virou `src/pages/comum/mostradores.ts`, com ganchos para o que muda (`escala`, `noLimite`, `pressao`, `segundaLinha`, `aviso`, `ciclo`, `frequenciaDeIgnicao`, `textoDaIgnicao`, `quadro`); o do Diesel a estende e guarda só o traço p–θ e as leituras dele (453 → 105 linhas). O vetor de brilho é um só, de 32 cilindros. O `rotuloTemp` que o Radial pendurava no controle saiu (o `cooling: 'air'` do `PADRAO_RADIAL` já dá "cabeça"), e o `rotuloEvento`, que nenhuma página definia, também.

**K-05 · erro · Teclado: a página do Elétrico não solta as teclas quando a janela perde o foco.**
- **Evidência:** cinco `teclado.ts` (Ronco 58 linhas, Diesel 51, Radial 43, Rotativo 35, Vapor 41) mais três tratadores dentro de `controle.ts` (Turbina, Elétrico, Passagem). Seis páginas têm tratador de `blur` que zera o que estava seguro (`ronco/teclado.ts:52`, `diesel:45`, `radial:39`, `rotativo:31`, `vapor:37`, `turbina/controle.ts:246`). O Elétrico não tem: `eletrico/controle.ts:272` liga a regeneração no `keydown` de `R` e só desliga no `keyup` (`:275`); `PaginaEletrico.tsx:41–42` registra só `keydown` e `keyup`. Segurar `R` e trocar de janela deixa o freio elétrico em 1 até apertar `R` de novo. (A Passagem não segura tecla nenhuma.)
Segunda divergência entre as cópias: o filtro de campo de digitação. Em seis páginas só `INPUT type=text` é poupado; no Elétrico e na Passagem, todo `INPUT` que não é `range`, `SELECT` e `TEXTAREA` (`eletrico/controle.ts:267`, `passagem/controle.ts:568`). Hoje os únicos campos são `ronco/Painel.tsx:143` (texto) e dois `select` da Passagem, então não há efeito; passa a haver no dia em que uma página a pistão ganhar um `select`.
- **Estado:** para a pessoa da interface (um `useTeclado` comum; no Elétrico, `window.addEventListener('blur', () => c.setFreio(0))`).
- **Atualização (integração):** feito nas páginas a pistão em `f089c79` (F1): `usarTeclado` em `src/pages/comum/teclado.ts` tem o filtro do campo de texto, a manete, o pedal, a tecla do freio, E/Q/I/C e um `blur` só, que solta pedal, freio e as teclas da manete; cada página dá as teclas do freio e as da família. No Radial com manete, Espaço passou a não fazer nada, como no Ronco de aviação (o Espaço ficava com o navegador: rolava a página ou apertava o botão em foco). O Elétrico já tinha o seu desde `2e0d811` (E4) e o filtro de campo de digitação continua com as duas versões.

### Duplicação no som e nos portadores

**K-06 · erro · O helicóptero existe duas vezes e os governadores já divergiram.**
- **Evidência:** a página do Ronco (família Aviação) usa `CargaBancadaAv` (`src/engines/ronco/aviacao.ts:81–131`): rotor com embreagem de 8 s e `GovernadorPI(0.8 * 0.05, 0.4 * 0.05, …)` (`:94`), ou seja K_p 0,040 e K_i 0,020. A Passagem usa o portador `Rotor` (`src/carriers/rotor.ts:94–160`): sem embreagem, e com motor a pistão `k = 0.12` (`:136–137`), K_p 0,096 e K_i 0,288. O mesmo preset `r44` responde ao coletivo com ganhos diferentes em `ronco.html` e em `passagem.html` (K_i 14 vezes maior na Passagem). A hélice também está nos dois lugares (`aviacao.ts:99, 112–121` e `carriers/helice.ts:191, 215–219`), aqui com os mesmos números (0,02 rad/%, 0,01, 5°/s, passo mínimo abaixo de 60% do alvo).
Inferência do código, não medida: `rotor.ts:136` só reduz os ganhos para `familia === 'pistao' || 'radial'`. O Camcopter (`ae50r`, família `rotativo`, que `USO_REAL.rotor` habilita) fica com os ganhos de bancada 0,8/0,4, que o comentário da linha 132 diz serem errados para motor real.
- **Estado:** para a etapa de som (uma implementação só do rotor e do governador; conferir o Camcopter no degrau de coletivo).

**K-07 · dívida · Locomotiva e gerador a diesel implementados duas vezes; tabelas de notch em três lugares.**
- **Evidência:** a página do Diesel usa o portador interno do `DieselDSP` (`src/engines/diesel/dsp.ts:877–997`: `portador` `'locomotiva' | 'gerador' | 'bancada'`, rampa de alvo, potência por notch, regulador de carga). A Passagem usa `src/carriers/locomotiva.ts` e `gerador.ts`, com `governadorProprio`. O próprio código registra a pendência (`src/pages/diesel/Painel.tsx:142`). As rotações por notch (269…904 e 440…1050) estão em `src/engines/diesel/constantes.ts:35–38` (`NOTCH_RPM`, que ninguém importa: morto), `src/carriers/locomotiva.ts:16–19` e `src/engines/diesel/presets.ts:275, 289`; a potência por notch em `constantes.ts:34` e `locomotiva.ts:20`. Os valores são iguais hoje.
- **Estado:** para a etapa de som (o portador interno do Diesel sair em favor de `carriers/`); o `NOTCH_RPM` morto entra em K-27.

**K-08 · erro · Comentário e código discordam na banda do governador do gerador diesel.**
- **Evidência:** `src/engines/diesel/dsp.ts:925` diz "gerador: ω_c 3,7 rad/s, o que dá o Kp 5 do DIESEL.md no QSX15"; a linha 926 usa `2.7`. Um dos dois está errado, e o "Kp 5 do DIESEL.md" do comentário só vale para 3,7.
- **Estado:** para a etapa de som (decidir qual vale; se for 2,7, corrigir o comentário e o que o TECNICO diz do Kp).

**K-09 · dívida · Governadores PI: uma classe usada 6 vezes e mais 5 escritos à mão.**

| Onde | Forma | Ganhos | Limite do integrador |
|---|---|---|---|
| `carriers/base.ts:87` `GovernadorPI` | classe (erro em %, taxa máxima) | por uso, abaixo | `[min, max]` da saída |
| `carriers/gerador.ts:85, 140` | classe | K_p 0,07, K_i 0,05, vezes `ganhoRelativo` | 0–1 |
| `carriers/locomotiva.ts:80, 151` | classe | 0,6 e 0,3, vezes `ganhoRelativo` | 0–1 |
| `carriers/rotor.ts:98, 137` | classe | 0,8·k e 0,4·min(1, 6k); k = 0,12 com pistão/radial | 0–1 |
| `carriers/helice.ts:191` | classe | 0,02 rad/% e 0,01; 5°/s | β mín–máx |
| `engines/ronco/aviacao.ts:94` | classe | 0,040 e 0,020 (rotor de bancada) | 0–1 |
| `engines/ronco/aviacao.ts:99` | classe | 0,02 e 0,01; 5°/s (hélice de bancada) | β mín–máx |
| `carriers/multirrotor.ts:64–67` | à mão | P 4, I 20 | ±0,5 |
| `engines/diesel/dsp.ts:926–929` | à mão (isócrono) | K_p = ω_c/P(ω), K_i = K_p·ω_c/4 (÷6 na EMD abaixo de 250 rpm); ω_c 2,5 / 2,7 / 8 | 0–1 |
| `engines/diesel/dsp.ts:934–936` | à mão (lenta min-max) | K_p = 9/P, K_i = K_p·9/2,5 | 0–0,6 |
| `engines/vapor/dsp.ts:419–426` | à mão (esferas) | 0,2 e 0,012 (`:41`); preset `aveling` 0,03 e 0,01 | −0,25–0,45, só com erro < 15% |
| `engines/ronco/dsp.ts:651–664` (e largada, `:697`) | à mão (ar de lenta) | KP 0,0015, KI 0,0035, KD 0,0012 (`:96`) | 0–0,05 |

- **Estado:** dívida aceita para o Ronco (não se mexe). Para Diesel, Vapor e multirrotor: para a etapa de som, se alguém mexer no governador (cada anti-windup foi resolvido de um jeito diferente).

**K-10 · dívida · Filtros e utilitários reimplementados.**
Evidência:
- Biquad: duas classes com as mesmas fórmulas. `Biquad` (`src/acoustics/biquad.ts:6`): 90 `new` em 16 arquivos (`ronco/dsp.ts` 28, `diesel/dsp.ts` 17, `turbina/dsp.ts` 10, Vapor 11 em 4 arquivos, Rotativo 8 em 3, Radial 4…), mais 1 `BiquadComPiso` (`carriers/helice.ts`). `Bq` (`src/scene/filtros.ts:12`): 41 `new` em 17 arquivos (Cena, portadores, Elétrico). O motivo está escrito (`filtros.ts:1–4`): `Biquad._w()` devolve um array a cada recálculo de coeficiente (`biquad.ts:10`), então aloca se chamado no laço de áudio. `Bq` não tem `hshelf`. O Vapor ficou dividido: `Biquad` no motor (`rede.ts`, `auxiliares.ts`, `dsp.ts`, `apito.ts`) e `Bq` nos portadores dele (`barco.ts`, `trator.ts`, `carro-direto.ts`).
- Um polo: `onePole` (`acoustics/util.ts:7`) e `k1` (`scene/filtros.ts:58`, "igual ao onePole do acoustics"); o padrão `1 - Math.exp(-…)` aparece 53 vezes em 14 arquivos de `src/`, 2 delas nessas definições e as outras por extenso (`diesel/dsp.ts` 15, `ronco/dsp.ts` 11, Vapor 8, `turbina/dsp.ts` 5…).
- Hermite de 4 pontos: 6 cópias (`ronco/dsp.ts:1400`; `scene/propagador.ts:429, 530, 535, 545` por extenso; `scene/filtros.ts:104`, exportada e nunca chamada).
- `TAU` definido 9 vezes (`acoustics/constantes.ts:4`, `eletrico/constantes.ts:4`, `carriers/ruido.ts:11`, `vapor/motor.ts:27`, `vapor/dsp.ts:33`, `scene/filtros.ts:6`, `scene/propagador.ts:19`, `pages/vapor/mostradores.ts:11`, `tools/vapor-comum.ts:8`).
- Sequência de sementes `sem + 0x9e3779b9` copiada em `carro-eletrico.ts:89`, `trem.ts:183`, `locomotiva-vapor.ts:111`.
- Limitador `tanh` de saída em 4 lugares (`ronco/dsp.ts:1346`, herdado por Diesel, Radial e Rotativo; `turbina/dsp.ts:716`; `rotativo/palhetas.ts:157`; `scene/dsp-cena.ts:153`, usado por Passagem, Vapor e Elétrico).
- O que **não** está duplicado: ponderação A (só `ganhoA` e `PonderacaoA` em `scene/filtros.ts:69, 76`) e o gerador aleatório do DSP (só `RNG` de `acoustics/rng.ts`; `Math.random` aparece só em `ui/audio/ambientes.ts:62, 71`, fora do DSP, e em `ronco/geometria.ts:148–149`, no sorteio de ordem de ignição do painel).
- **Estado:** `acoustics/` e `scene/` não se editam nesta rodada. Para a etapa de som: código novo usa `Bq`; se o orçamento de alocação do Ronco importar, `Biquad._w` sem array (a paridade bit a bit continua valendo, a aritmética é a mesma).

**K-11 · dívida · Três sistemas de ambiente, e o mesmo nome soa diferente em cada página.**
- **Evidência:** (1) `src/ui/audio/ambientes.ts`: 6 ambientes do Ronco e 6 da Turbina, resposta ao impulso com `Math.random`; usado por Ronco, Diesel, Radial, Rotativo e Turbina. (2) `src/scene/ambientes.ts`: 5 ambientes com RT60 por banda e semente; usado por Passagem e Vapor. (3) `src/pages/eletrico/ambientes.ts`: mais 2 próprios (rua, galpão) sobre os da Cena. "Túnel" é `tau 0,9 · wet 0,8` em (1) e `RT60 5–1 s · wet 4,0` em (2); "Rua" é `tau 0,32 · ecos 47–190 ms` em (1) e `tau 0,18 · ecos 26–71 ms` em (3); "Hangar" é `len 4,5 · tau 1,3` na Turbina e `len 3,0 · tau 0,5` (galpão) no Elétrico. O comentário de (1) promete "Na etapa da cena, isto vai para src/scene/" (`ui/audio/ambientes.ts:2`): não foi.
O tipo mente: `IdAmbiente` (`src/scene/tipos.ts:71`) declara 15 ambientes; `ambientePassagem(id: IdAmbiente)` (`scene/ambientes.ts:119–121`) lança erro em 10 deles (`rua`, `garagem`, `autodromo`, `serra`, `pista`, `patio`, `hangar`, `celula`, `vale`, `porta-avioes`).
- **Estado:** para o dono decidir (um túnel só para o site?) e para a pessoa da interface. Em código: estreitar o parâmetro de `ambientePassagem` para as 5 chaves de `AMBIENTES_PASSAGEM`.

**K-12 · incompleto · O carro a gasolina, diesel, radial ou rotativo passa sem pneus nem vento; os outros carros têm, com dois modelos diferentes.**
- **Evidência:** `src/carriers/carro.ts:9` ("Pneus e aero (4.1) ficam desligados por padrão… TODO") e nenhuma `FontePneu`/`FonteAero` no arquivo. `CarroEletrico` tem 4 ou 6 pneus e aero (`carro-eletrico.ts:96–99`). Há duas classes `FontePneu` com o mesmo nome: `carro-eletrico.ts:28` (L_W 95 dB(A) por roda, 98 no ônibus, passa-banda fixo em 1 kHz Q 0,8, modulação lenta) e `carro-direto.ts:19` (Stanley: L_W 92, passa-banda em 800·√(v/v_ref) Hz Q 0,6). No preset "Carro na rua a 6 m" (Camaro a 108 km/h) só o motor soa; no "Tesla na rua", pneus e vento entram.
- **Estado:** para a etapa de som (ligar pneus e aero no `CarroLegado` com um modelo só; decidir com o dono, porque muda o som da Passagem do Ronco).

**K-13 · dívida · A fórmula do estrondo sônico está em três lugares e o teste confere a cópia que o produto não usa.**
- **Evidência:** `turbina/dsp.ts` (`triggerBoom`, a da página Turbina), `src/scene/estrondo.ts:17–23` (`Estrondo.disparar`, a que toca na Passagem) e `src/scene/supersonico.ts:44–50` (`parametrosEstrondo`). A terceira só é importada por `tools/cena/` (`exports2.py`: 0 usos em `src/`).
- **Estado:** para a etapa de som (o `Estrondo` chamar `parametrosEstrondo`); o teste entra na lista de "testes que não testam" da Cena.

**K-14 · dívida · O worklet do Vapor é uma segunda cópia do da Passagem, e os três worklets da Cena carregam as sete famílias.**
- **Evidência:** `src/worklet/processador-vapor.ts` e `processador-cena.ts` registram o mesmo `CenaDSP`, mudando só o nome (`'vapor'` e `'cena'`). No build: `processador-cena-*.js` 645 722 bytes, `processador-vapor-*.js` 645 724, `processador-eletrico-*.js` 647 634 (`DSPEletricoPagina extends CenaDSP`). Os das páginas antigas: Turbina 41 687, Ronco 89 951, Radial 107 708, Diesel 141 096, Rotativo 142 736. Os bundles de worklet não são minificados por decisão (`vite.config.mts`).
Os nomes registrados também não seguem um padrão: `ronco-engine`, `diesel-engine`, `radial-engine`, `rotativo-engine`, `palhetas-engine`, `turbina-engine`, `eletrico-engine`, e depois `cena`, `vapor`, `prova-tom`.
- **Estado:** para a pessoa da interface (a página do Vapor importar `processador-cena.ts` com o nome `'cena'`); dividir o `CenaDSP` por família é trabalho maior, para o dono decidir.

### Duplicação nas ferramentas

**K-15 · erro · Três leitores de WAV; o do Radial (usado também pelo Rotativo) lê errado 24 bits e WAV "extensible".**
- **Evidência:** `tools/wav.ts:34` `lerWav` aceita float 32, PCM 16 e 24 e trata `WAVE_FORMAT_EXTENSIBLE` (`:42`). `tools/diesel-bandas.ts:212` `lerWavMono` aceita 24 bits mas não trata extensible. `tools/radial-bandas.ts:149` `lerWavMono` não tem o ramo de 24 bits (`:164`: tudo o que não é float nem 16 bits vai para `readInt32LE`) nem extensible; `tools/rotativo-bandas.ts:13` importa este. Medido com quatro WAVs de 8 amostras gerados no scratchpad (`scratchpad/aud/k/wavteste.ts`):
- **Atualização (integração):** corrigido em `b6c47a8`: `lerWavMono` passou para `tools/wav.ts` (PCM 16/24/32 e float 32, inclusive "extensible") e as duas cópias saíram.

| Arquivo | `wav.ts` `lerWav` | `diesel-bandas` `lerWavMono` | `radial-bandas` `lerWavMono` |
|---|---|---|---|
| PCM 24 bits | ok | ok | lança `ERR_OUT_OF_RANGE` |
| PCM 24 bits extensible | ok | ok | lança `ERR_OUT_OF_RANGE` |
| float 32 | ok | ok | ok |
| float 32 extensible (`0xFFFE`) | ok | **errado, sem erro** (desvio máx 0,29) | **errado, sem erro** (desvio máx 0,29) |

O caso grave é o último: a ferramenta devolve números e segue. `tools/vapor-analise.ts:25` `lerMono` usa `lerWav` e adivinha a escala (`if (mx > 1.5) x /= 32768`). São os leitores das gravações de referência.
- **Estado:** corrigível agora em `tools/**`: `lerWavMono` de `radial-bandas.ts` e de `diesel-bandas.ts` passarem a chamar `lerWav` de `tools/wav.ts` e fazer a média dos canais (mesma assinatura `{ x, sr }`).

**K-16 · dívida · Oito FFTs, cinco Welch e seis tabelas de bandas diferentes.**
- **Evidência (`cmpfn.py`):** a mesma FFT radix-2 de 22 linhas está byte a byte em `tools/cena/analise.ts:6`, `tools/diesel-bandas.ts:15` e `tools/radial-bandas.ts:16`; variantes em `tools/eletrico/comum.ts:103`, `tools/analise-som/harness.js:53`, e outra idêntica entre si em `src/pages/passagem/mostradores.ts:16` e `src/pages/eletrico/mostradores.ts:15`; mais a `dftPot` de `tools/vapor-analise.ts:250`. Rotativo e Vapor importam a do Radial. Welch: `diesel-bandas.ts:39` (8192), `radial-bandas.ts:40` (8192, encolhe em trecho curto), `eletrico/comum.ts:127` (16384), `vapor-analise.ts:262` (256), `harness.js:79` (4096).
As tabelas de bandas não são as mesmas:

| Arquivo | Bandas (Hz) |
|---|---|
| `tools/analise-som/harness.js:78` | **20**–150, 150–400, 400–1k, 1–2,5k, 2,5–6k, 6–12k |
| `tools/cena/analise.ts:84`, `radial-bandas.ts:14`, `vapor-analise.ts:20` | 60–150, 150–400, 400–1k, 1–2,5k, 2,5–6k, 6–12k |
| `tools/diesel-bandas.ts:12` | as seis acima **mais 30–60 no fim** |
| `tools/eletrico/comum.ts:147` | **20–60 na frente** e as seis acima |

No Elétrico o índice de cada banda fica uma casa à frente do das outras famílias; é a origem provável do vetor de alvos deslocado apontado no achado do Elétrico (frente dos testes). A primeira banda do banco do dono (20–150) não é a das famílias (60–150), então "60–150" em `REVISAO-DE-SOM.md` e nos testes não é a mesma medida.
- **Estado:** corrigível agora em `tools/**`: um `tools/analise.ts` com `fft`, `welch`, `bandas(x, sr, tabela)` e as tabelas com nome (`BANDAS_PROJETO`, `BANDAS_COM_SUB`); os `*-bandas.ts` reexportam. Não muda resultado se cada um continuar passando a tabela que usa hoje.

**K-17 · dívida · Doze arquivos de `tools/` têm o próprio laço de render; os oito roteiros de navegador repetem o mesmo cliente CDP.**
- **Evidência:** laço "eventos no início do bloco de 128, processa, copia" em `tools/render.ts:93`, `ronco-paridade.ts:184`, `turbina-paridade.ts:150`, `cena/legado.ts:56`, `cena/render-passagem.ts:91`, `cena/portadores.ts:25`, `diesel-comum.ts:93`, `radial-comum.ts:46`, `rotativo-comum.ts:46`, `vapor-comum.ts:32`, `eletrico/comum.ts:45, 65, 90`, `analise-som/harness.js:41`. `radial-comum.ts` × `rotativo-comum.ts`: 36 das 50 linhas significativas idênticas (72%); `renderizar` difere em uma declaração, `mono` é igual (hash). `radial-lenta.ts` × `rotativo-lenta.ts`: 72%. `media`, `desvio`, `trecho` definidos em 4 `*-comum.ts`; `acharPicos` em `diesel-bandas.ts:107` e `vapor-analise.ts:213`; `percentil` em `vapor-analise.ts:49` e `cena/analise.ts:146`.
Navegador: 8 arquivos, 2 149 linhas. Ronco × Radial 112 linhas idênticas (52%, bloco de 41); Diesel × Vapor 83 (65%, bloco de 64); Diesel × Radial 120 (56%). O servidor estático do `dist/` está copiado em 6 deles.
- **Estado:** corrigível em `tools/**` para os `-comum.ts` (um `tools/comum.ts` genérico no tipo do DSP); os `*-navegador.mjs` são da pessoa da interface (o `tools/servir-dist.mjs` novo já tira o servidor; o cliente CDP e o `confere()` cabem num `tools/navegador-comum.mjs`).

**K-18 · dívida · `STOCK` e `engineConfig` copiados em duas ferramentas; uma das cópias está defasada.**
- **Evidência (`stock.py`):** `tools/cena/legado.ts:46` tem as 28 chaves de `ACESSORIOS_PADRAO`, iguais. `tools/analise-som/harness.js:11` tem 17: faltam `overrun`, `cat`, `tipD`, `cooling`, `engine`, `breakout`, `compression`, `scType`, `scRatio`, `scLobes`, `scWhine`. Sem efeito hoje: os 68 presets definem `overrun` e `cat`, e `cooling`/`breakout` ausentes caem no padrão do DSP (`ronco/dsp.ts:287–306`). `engineConfig` está copiado em `cena/legado.ts:47` e em `harness.js:14` (`config`); `montarConfig`/`configCalibrada` existem 4 vezes, uma por família (`ronco`, `diesel`, `radial`, `rotativo` `/config.ts`), com o mesmo esqueleto.
- **Estado:** no porte do `harness.js` para o DSP em TypeScript, usar `ACESSORIOS_PADRAO` e `configCalibrada` de `src/engines/ronco/` (auditor principal). `cena/legado.ts` precisa da cópia (roda o legado).
- **Atualização (integração):** o `harness.js` do dono passou a usar `ACESSORIOS_PADRAO` (`73c2590`). A cópia de `tools/cena/legado.ts` fica: ela monta o legado de propósito.

### TODO, "por enquanto" e comentários de etapa

**K-19 · dívida · 21 marcas no código: 10 obsoletas (prometem o que já foi feito, ou descrevem um estado que acabou), 3 em código morto ou órfão, 1 meio obsoleta, 6 vivas, 1 dívida aceita.**
Busca: `TODO|FIXME|XXX|HACK|provisório|por enquanto|temporário|até a etapa|durante a migração|ainda não|enquanto … não existe|etapa N`, em `src/`, `tools/`, HTML e config, fora o legado. Não há `FIXME`, `XXX` nem `HACK`.

| Onde | Texto | Situação |
|---|---|---|
| `src/scene/supersonico.ts:10–12` | TODO (integração): o Propagador usa o ponto fixo; trocar para estas raízes quando M ≥ 0,9 | **obsoleto**: `propagador.ts:17, 391` já usa `raizesEmissao` |
| `src/engines/diesel/dsp.ts:20–21` | TODO: trocar `CargaExterna` por `Carga` de `scene/tipos` "quando a camada de portadores entrar na branch" | **vivo e trivial**: a camada entrou; `CargaExterna` (`:22`) é igual a `Carga` (`scene/tipos.ts:52–55`) |
| `src/engines/diesel/dsp.ts:91` | TODO: `ComandoMotor.combustivel` do governador do portador | **obsoleto**: a linha 92 já trata |
| `src/engines/diesel/dsp.ts:104` | TODO: o adaptador `motor.ts` chama isto com a `Carga` | **obsoleto**: `diesel/motor.ts:129` chama |
| `src/pages/diesel/Painel.tsx:142–143` | TODO: com os portadores de `carriers/`, carga e combustível vêm de lá | **vivo** (K-07) |
| `src/carriers/carro.ts:9` | Pneus e aero ficam desligados: TODO | **vivo** (K-12) |
| `src/carriers/locomotiva.ts:116` | TODO: sopro e o pico Q 40 por nota; aqui só os parciais (buzina K5LA) | **vivo** (a buzina é só soma de parciais) |
| `src/carriers/tipos.ts:3–5` | `Motor` mora aqui "enquanto `src/engines/motor.ts` não existe" | **vivo**: o arquivo nunca foi criado; dívida aceita se o comentário virar "mora aqui" |
| `src/engines/ronco/motor.ts:235–236` | "O Ronco ainda não tem o gancho de carga no virabrequim" | **obsoleto**: o gancho existe (`ronco/dsp.ts:1114`) e `motor.ts:268–272` o usa; o carro ignora a carga por decisão |
| `src/engines/ronco/motor.ts:2` | "o radial e a aviação da etapa 3 seguirão o mesmo molde" | **obsoleto**: seguiram |
| `src/carriers/gerador.ts:12–13` | "O motor (diesel, etapa 2; vapor, etapa 5) ainda não existe" | **obsoleto** |
| `src/carriers/locomotiva.ts:2` | "(GE 7FDL) é da etapa 2" | **obsoleto** |
| `src/carriers/trem.ts:1–2` | "etapa 1 sem motor próprio… o motor elétrico entra na etapa 6" | **obsoleto**: `TracaoTrem` (`trem.ts:337`) |
| `src/carriers/compat.ts:2–3` | "possível, sem preset na etapa 1" | **obsoleto** na redação (a regra vale; a etapa passou) |
| `src/pages/passagem/presets.ts:38–41` | `ESPERA_MOTOR`: "etapa 2 (diesel)", "etapa 5 (vapor)"… | **código morto** (K-31) |
| `src/pages/comum/Casca.tsx:1, 34`; `casca.css:1` | "durante a migração… Por enquanto ela tem só a navegação e a prova do áudio" | **arquivo órfão** (K-28) |
| `src/ui/audio/ambientes.ts:2` | "Na etapa da cena, isto vai para src/scene/" | **vivo, não cumprido** (K-11) |
| `tools/cena/portadores.ts:2–3` | `MotorTeste` "no lugar dos motores que ainda não foram migrados (diesel, turboeixo, turboélice)" | **meio obsoleto**: diesel e turboélice têm adaptador; turboeixo não existe |
| `tools/render.ts:13–17` | "depois da migração… Por padrão usa o DSP legado" | **obsoleto** (auditor principal troca o padrão) |
| `src/engines/diesel/dsp.ts:203` | recirculação "fica desligada, ver TECNICO.md" | dívida aceita, documentada |
| `src/pages/passagem/presets.ts:92` | "A Cena ainda não monta este portador" | mensagem de um ramo que não acontece mais (K-31) |

- **Estado:** os de `tools/` são corrigíveis agora (reescrever os dois cabeçalhos). Os de `src/carriers`, `src/scene` e dos `dsp.ts` são só comentário: quem mexer no arquivo na etapa de som apaga; os de `src/pages` são da pessoa da interface.

### `any` e tipos frouxos nas interfaces públicas

**K-20 · dívida · `Motor.configurar(preset: object)`: nenhum adaptador sabe o que recebe.**
- **Evidência:** `src/carriers/tipos.ts:20`. As implementações recebem `Record<string, any>` (`ronco/motor.ts:257`, `diesel/motor.ts:86`, `radial/motor.ts:91`, `rotativo/motor.ts:58`, `turbina/motor.ts:65`) ou `object` (`eletrico/motor.ts:69`, `eletrico/dsp.ts:181`); `rotativo/palhetas.ts:61` recebe `any`. Um campo de preset digitado errado (`pipeLenght`) passa pelo compilador e o DSP usa o padrão, calado. A Passagem monta os motores com `…find((x) => x.id === id)!` (6 vezes, mais um `presetVapor(id)!`, em `passagem/controle.ts:206–212`): se o id não for da família, espalha `undefined` e monta o motor só com os padrões.
- **Estado:** para a etapa de som ou uma etapa de tipos: `Motor<Cfg>` genérico, ou `configurar(preset: CfgRonco | CfgDiesel | …)`.

**K-21 · erro · A tabela de compatibilidade aceita barco × diesel, e o portador `Barco` quebra com qualquer motor que não seja o `VaporDSP`.**
- **Evidência:** `COMPAT.barco = ['vapor', 'diesel']` (`src/carriers/compat.ts:18`). `Barco` faz `this.motor as unknown as VaporDSP` (`barco.ts:96`) e chama `m.impor(…)` e `m.wTrem` (`:110–111`), que só o `VaporDSP` tem (`grep` em `diesel/motor.ts` e `ronco/motor.ts`: nada). `validarCompat('barco', motorDiesel)` passa; o primeiro bloco de áudio lança `m.impor is not a function`. Hoje não é alcançável pela página (`USO_REAL.barco = ['vapor']` e nenhum preset diesel lista `barco`). O mesmo cast está em `trator.ts:44`, `carro-direto.ts:49` e `locomotiva-vapor.ts:147`.
- **Estado:** corrigível agora em `src/carriers/compat.ts`: tirar `'diesel'` de `COMPAT.barco` (e o trecho do comentário da linha 17) até existir um barco a diesel; ou, se o dono quiser manter a promessa, fica registrado que a tabela mente.
- **Atualização (integração):** corrigido em `b6c47a8`: `COMPAT.barco` só aceita vapor, com o motivo no comentário.

**K-22 · dívida · Comandos do Vapor passam por fora de `ComandoPortador`, com listas de chaves copiadas e diferentes.**
- **Evidência:** `(c as any)[k]` sobre uma lista de nomes em `locomotiva-vapor.ts:157` (15 chaves), `trator.ts:58` (9), `barco.ts:102` (7) e `carro-direto.ts:57` (7), e `m.comandar(vc as any)` (`locomotiva-vapor.ts:159`). `ComandoPortador` (`carriers/tipos.ts:76–86`) não tem `regulador`, `cutoff`, `apito`, `sino`, `areia`… Uma chave errada na página (`cutOff`) é ignorada sem aviso, e uma chave nova tem de ser lembrada em quatro listas. `engines/vapor/motor.ts:37–58` repete `as any` 8 vezes para montar comandos.
- **Estado:** para a etapa de som (Vapor): `ComandoPortador & Partial<ComandoVapor>` já é o tipo do parâmetro em `barco.ts:97`; falta `ComandoMotor` aceitar a extensão e a lista de chaves sair de `keyof ComandoVapor`.

**K-23 · dívida · Portadores e motores se reconhecem por "duck typing" através das interfaces.**
- **Evidência:** `carriers/helice.ts:206` (`(m as unknown as { velocidade })`) e `:229` (`{ rpmHelice; dsp: { propB; propD } }`); `carriers/carro.ts:37` (`(m as any).dsp?.ratios`); `carriers/rotor.ts:136` (`'dsp' in (motor as object)`); `ronco/motor.ts:273`, `rotativo/motor.ts:80`, `radial/motor.ts:127` (`(carga as any)?.cfg`, o motor lendo a configuração da hélice por dentro da `Carga`, que só declara `torque` e `inercia`). `ganhoRelativo` lê `torqueMax` do mesmo jeito (`carriers/base.ts:79`).
- **Estado:** para a etapa de som: campos opcionais declarados em `Motor` (`torqueMax?`, `velocidade?`) e em `Carga` (`cfg?`).

**K-24 · dívida · Mensagens ao worklet sem tipo, com `type` e `tipo` no mesmo objeto.**
- **Evidência:** `DSPDeAudio.message(m: any)` e `post(m: any)` (`src/worklet/tipos.ts:7–8`). `src/scene/dsp-cena.ts:108–116` testa `m.type === 'portador'` e, no mesmo objeto, `m.tipo === 'trem'`. Tipos de mensagem em inglês e abreviados no legado (`config`, `tune`, `params`, `input`, `av`) e em português no novo (`portador`, `cena`, `comando`, `ar`, `eletrico`, `diesel`, `palhetas`, `preset`). `TelemetriaMotor` e `TelemetriaPortador` têm `[k: string]: unknown` (`carriers/tipos.ts:12, 102`); nas páginas a telemetria é `Record<string, any>`. `{ type: 'input', throtle: 1 }` não dá erro em lugar nenhum.
- **Estado:** para a pessoa da interface e a etapa de som: uma união discriminada por página (`MsgRonco`, `MsgCena`).

**K-25 · dívida · `PresetRonco` anula as próprias uniões com `| string`.**
- **Evidência:** `src/engines/ronco/presets.ts:9–35`: 17 campos enumerados terminam em `| string` (`layout`, `muffler`, `routing`, `limiter`, `overrun`, `valve`…), então `muffler: 'sporty'` compila. `rotor?: Record<string, any>` (`:34`). `PresetDiesel`, `PresetRadial` e `PresetRotativo` herdam (`Partial<PresetRonco> & {…}`). As quatro páginas a pistão ainda alargam: `type Spec = Preset… & Record<string, any>` (`ronco/controle.ts:15`, `diesel:12`, `radial:11`, `rotativo:13`).
- **Estado:** corrigível em `presets.ts` sem mudar valor nenhum (tirar os `| string`; a paridade compara dados, não tipos), mas o `tsc` vai apontar cada lugar que hoje passa texto livre: para uma etapa de tipos.

**K-26 · sugestão · Onde estão os `any`, e quanto falta para o `strict`.**
- **Evidência (`anys.py`):** 911 ocorrências de `any` em `src/` (fora o legado). 721 são campos `declare x: any` das classes migradas (Ronco 328, Diesel 185, Turbina 176, Radial 30, Rotativo 2): dívida aceita pelo PLANO. As outras 190: `Record<string, any>` 43, `as any` 50, `: any` 42, `as unknown as` 17. Por arquivo, fora os `declare`: `engines/ronco/aviacao.ts` 16, `engines/radial/motor.ts` 11, `pages/passagem/controle.ts` 10, `engines/vapor/motor.ts` 8, `engines/ronco/motor.ts` 7, `engines/rotativo/motor.ts` 7. `acoustics/`, `ui/` (fora `audio/cadeia.ts`, 4) e `pages/menu` têm zero.
`npx tsc --noEmit -p tsconfig.json --noImplicitAny`: 345 erros (Ronco 121, Diesel 116, `acoustics` 52, Turbina 30, Radial 14, Rotativo 9, páginas 3). Com `--strict` (o `noImplicitAny: false` do arquivo continua valendo): 77 erros (Ronco 27, Diesel 23, `ui/audio/cadeia.ts` 13, Passagem 4, Turbina 3, Radial 3, páginas 4). `src/scene`, `src/carriers`, `src/engines/eletrico` e `src/engines/vapor` passam nos dois sem erro.
- **Estado:** sugestão: ligar `strict` por pasta (um `tsconfig.strict.json` que inclua `scene`, `carriers`, `eletrico`, `vapor`) para o que já passa não regredir.

### Exports, arquivos órfãos, dependências e campos que ninguém lê

**K-27 · dívida · 780 exports em `src/`: 20 mortos, 182 que só o próprio arquivo usa, 24 que só os testes importam.**
Evidência (`exports2.py`, resolvendo cada `import`, barris e `import()`):
Mortos (ninguém importa e o próprio arquivo não usa): `carriers/gerador.ts:45` `DEGRAUS_CARGA`; `carriers/helice.ts:51` `HELICES_PISTAO` (11 hélices que repetem o `helice: {…}` de cada preset radial); `engines/diesel/constantes.ts:18` `C_GAS` e `:35` `NOTCH_RPM`; `engines/eletrico/presets.ts:297–298` `PADRAO_ELETRICO`, `presetEletrico`; `engines/radial/geometria.ts:20` `LAYOUTS_RADIAL`; `engines/ronco/aviacao.ts:29` `Magnetos`; `engines/ronco/motor.ts:33` `T_ESCAPE_CENA`; `engines/vapor/constantes.ts:18–19` `RHO_AR`, `RHO_AGUA`; `pages/comum/Casca.tsx:9` `Casca`; `pages/eletrico/controle.ts:278` `FAMILIAS`; `pages/passagem/cena3d.ts:30` `NOME_CAMERA`; `scene/ambientes.ts:14` `CORTES_RT`; `scene/ar.ts:11` `ISO_UR`; `scene/filtros.ts:104` `hermite`; `scene/propagador.ts:90` `S_ESTADO`; `scene/solo.ts:17` `primeiroNulo`; `scene/supersonico.ts:38` `convJato`.
Só internos (o `export` sobra): 182, por pasta: `carriers` 32, `engines/diesel` 17, `scene` 15 ou mais, `pages/passagem` 14, `engines/ronco` 13, `engines/radial` 10… (lista em `scratchpad/aud/k/exports2.txt`).
Os cinco `export default` de presets (`ronco`, `diesel`, `radial`, `rotativo`, `turbina` `/presets.ts`) só servem a `tools/render.ts` (`lista()` lê `m.default`); nenhum `import X from` os usa.
- **Estado:** para a etapa de som (apagar os 20 quando tocar no arquivo). Não vale um commit só para tirar `export` de 182 nomes.

**K-28 · incompleto · Tabelas e funções que só os testes leem: o teste confere o que o produto não usa.**
Evidência (classe "só testes" de `exports2.py`, com 0 usos no próprio arquivo):
- `carriers/helice.ts:41` `HELICES` (Cessna 172, Caravan, ATR 72, **Spitfire**, **Tu-95**) e `:68` `bpfHelice`: `tools/cena/portadores.ts:49–51` confere BPF e Mach de ponta desta tabela. Nenhum portador a lê (as hélices vêm do preset do motor ou de `HELICE_PADRAO`); Spitfire e Tu-95 não existem no produto.
- `carriers/rotor.ts:41` `HELICOPTEROS` (R44, R22, **AS350**, **Bell 206**, **UH-60**, **Mi-8**): só `tools/cena/portadores.ts:119`, numa linha com `ok` fixo em `true`. Quatro dos seis são turboeixo, família que não existe (K-31).
- `engines/rotativo/geometria.ts:37` `volumeAngulo`: só `tools/rotativo-valida.ts:92–104` (grupo `geometria`). O DSP calcula V(α) por conta própria (`engines/ronco/dsp.ts:981`).
- `scene/supersonico.ts:44` `parametrosEstrondo` (K-13); `scene/pressao.ts:30` `pressaoPP`; `engines/eletrico/inversor.ts:46` `dbTensao`.
- Legítimos como referência de teste: `scene/ar.ts:39` `atenuacaoIso` (a ISO exata contra a aproximação de 2 polos), `carriers/teste.ts` `MotorTeste`/`PortadorTeste`.
- **Estado:** os testes entram nas listas da frente "testes que mentem" (Cena, Rotativo). As tabelas: para o dono decidir se viram presets (Spitfire, Tu-95) ou saem.

**K-29 · dívida · Arquivos de `src/` que o build não alcança (fora o legado).**
- **Evidência (`orfaos.py`, a partir das 9 entradas de `vite.config.mts`: 186 arquivos em `src/`, 173 alcançados):** `src/pages/comum/Casca.tsx` (44 linhas), `ProvaDoWorklet.tsx` (69), `casca.css` (8, que nem a `Casca` importa), `src/worklet/processador-tom.ts` (5) e `src/worklet/tom.ts` (56; só `tools/render.ts tom` usa). É o andaime da etapa 1. O `docs/TECNICO.md:37, 76–81` ainda descreve `src/pages/comum/` como "casca comum das páginas durante a migração" e explica o worklet com `processador-tom.ts` e um `dist/assets/processador-tom-<hash>.js` que o build não gera mais. `src/worklet/globais.d.ts` não é órfão (declarações de ambiente).
`public/`: nada órfão (`3d/texturas/brita_1k.jpg` e `concreto_1k.jpg` são carregadas em `passagem/cena3d.ts:125–127`; `3d/LICENSES.md` vai para o site, o que serve de atribuição). `docs/*.png`: os quatro são usados no README.
`src/carriers/teste.ts` (168 linhas) mistura bancada de teste (`MotorTeste`, `PortadorTeste`, só `tools/`) com classes do produto (`PortadorBancada`, `CargaBancada`, usadas por `engines/eletrico/portador.ts:7, 44` na furadeira, no liquidificador e no motor industrial): o nome do arquivo engana.
- **Estado:** `Casca.tsx`, `ProvaDoWorklet.tsx`, `casca.css` são de `src/pages` (pessoa da interface: apagar). `processador-tom.ts` e `tom.ts`: para o dono decidir (o tom de 440 Hz ainda é útil como prova do pipeline em `render.ts tom`; se ficar, mover `tom.ts` para `tools/`). O trecho do TECNICO é da frente de documentação.

**K-30 · sugestão · Nenhuma dependência sem uso; há pré-requisitos que o `package.json` não declara.**
- **Evidência:** `npm ls --depth=0`: 11 pacotes. `react` importado em 41 arquivos, `react-dom` 9, `three` 1 (`passagem/cena3d.ts`), `vite` e `@vitejs/plugin-react` em `vite.config.mts`; `tsx`, `typescript` e os quatro `@types/*` são usados pela cadeia de ferramentas. Fora do `package.json`: os 8 roteiros `navegador:*` precisam de `/usr/bin/chromium` e `/usr/bin/firefox` (7 aceitam `CHROMIUM=`/`FIREFOX=`; `tools/turbina-testa-navegador.mjs:42, 73` tem o caminho fixo); 11 scripts Python (5 em `tools/analise-som/`, 6 em `tools/eletrico/analise/`) importam `numpy`, `scipy` e `matplotlib` sem `requirements.txt`.
- **Estado:** corrigível agora: um `tools/requirements.txt` (numpy, scipy, matplotlib) e uma linha no README ("os testes de navegador precisam de Chromium e Firefox"); o caminho fixo do roteiro da Turbina é da pessoa da interface.

**K-31 · incompleto · A família `turboeixo` está declarada em seis lugares e não existe; a Passagem guarda o código do tempo em que faltavam motores.**
- **Evidência:** `FamiliaMotor` (`carriers/tipos.ts:10`), `COMPAT.rotor` e `COMPAT.nenhum` (`compat.ts:11, 19`), `PortadorBancada.compat` (`carriers/teste.ts:140`), `NOME_MOTOR` e `ESPERA_MOTOR` (`passagem/presets.ts:33, 38`). Não há adaptador (`ADAPTADORES`, `compat.ts:29–32`), preset (`arch: 'turboeixo'` não aparece em `turbina/presets.ts`) nem DSP. Não há helicóptero a turbina no site (ver `HELICOPTEROS`, K-28).
Código morto na Passagem: os 10 portadores de `PORTADORES` estão em `PORTADORES_NO_DSP` e todos têm motor pronto, então `situacaoPortador` (`presets.ts:86–94`) sempre devolve `ok: true`; o ramo "Espera o motor…", `ESPERA_MOTOR` e a mensagem "A Cena ainda não monta este portador" não acontecem. `presets.ts:70`: `includes(p === 'carro' ? 'carro' : p)` é o mesmo que `includes(p)`.
- **Estado:** para o dono decidir (turboeixo entra no plano ou sai dos tipos); o código morto é da pessoa da interface.

**K-32 · incompleto · Campos de preset e de configuração que nenhum código lê.**
Evidência (`props-nao-lidas.py`, `campos-sem-acesso.py`: nenhum acesso `.campo`, `['campo']`, nome em string ou desestruturação em `src/` nem em `tools/`):

| Campo | Onde está preenchido | Observação |
|---|---|---|
| `aeronave` { massa, comprimento, envergadura, motores } | Radial: 13 dos 17 presets (`radial/presets.ts:28, 78–136`); Rotativo: 3 dos 17 (`rotativo/presets.ts:66`) | a massa e o tamanho do avião não chegam ao portador |
| `veiculo` { massa, comprimento, largura, altura } | Radial: `r975`, `trossi`, `megola`, `s55` (`radial/presets.ts:29, 143–167`) | repete `mass` (que é o lido): no Sherman, `mass: 30300` e `veiculo.massa: 30300`; as dimensões do tanque não chegam à Cena |
| `cilindradaCamara` | Rotativo: os 17 (`rotativo/presets.ts:48`) | só é **escrito** pelo painel (`rotativo/Painel.tsx:116`); quem vale é `geo`/`Vcam` |
| `vPassagem` | Rotativo: 1 preset (`rotativo/presets.ts:70`) | |
| `portador.bonde` | Elétrico: `flexity` (`eletrico/presets.ts:229`; tipo em `eletrico/dsp.ts:97`) | |
| `reducao.retos` | Elétrico: `formulae` (`eletrico/presets.ts:81`; tipo em `eletrico/dsp.ts:52`) | o comentário da linha 82 diz "+10 dB sobre a helicoidal (84 + 10)": o efeito está no número de `niveis`, não no campo |
| `ConfigTrem.eixosPorTruque`, `distEixos`, `vTransicao` | `carriers/trem.ts:47, 54, 81, 83` | os dois eixos do truque não são fontes separadas; `vTransicao` está marcado "informativo" |
| `MotorRadial.tdc` | `radial/geometria.ts:71, 247` | devolvido e nunca lido |

Correção a um achado anterior: `carenagem` do gerador **é** lida (`carriers/gerador.ts:79`: `massaSuperficial: c.carenagem ? 15 : 0`). O que falta é a Cena aplicar a casca às fontes `dentro` para quem ouve de fora (pendente em `TECNICO.md:1000`), então mudar `carenagem` não muda o som de fora.
- **Estado:** `aeronave` e `veiculo` para a etapa de som (ou o portador passa a usá-los para o corpo, ou saem); os demais, apagar quando tocar no arquivo. Em `presets.ts` isso é editável agora, mas tirar `cilindradaCamara` pede mexer no `Painel.tsx` junto.

**K-33 · dívida · `tsconfig.node.json` cobre o Radial, o Rotativo e o Vapor só por tabela.**
- **Evidência:** o `include` lista `acoustics`, `turbina`, `ronco`, `scene`, `carriers`, `diesel`, `eletrico` e `tools/**`; não lista `src/engines/radial`, `rotativo`, `vapor`. Eles entram porque `tools/` os importa (`tsc -p tsconfig.node.json --listFilesOnly`: 92 arquivos de `src/`). Fora do programa hoje: `src/engines/rotativo/rotativos.ts` (o DSP da página, `RotativosDSP`) e os `src/worklet/processador-*.ts` e `registrar.ts` (estes precisam dos globais do worklet, é esperado). Se uma ferramenta deixar de importar um arquivo, ele sai da verificação "roda sem DOM" sem aviso.
- **Estado:** corrigível agora: trocar as sete entradas de `src/engines/<família>/**/*.ts` por `"src/engines/**/*.ts"` no `include` (conferi que hoje só acrescenta `rotativos.ts`; rodar `npm run typecheck` depois).

### Nomes

**K-34 · sugestão · Português e inglês misturados nas APIs (só a lista).**
- Contrato do DSP em inglês (`process`, `message`, `post`: `worklet/tipos.ts`) e do motor em português (`configurar`, `comandar`, `acoplar`, `processar`, `telemetria`: `carriers/tipos.ts`). Classes: `EngineDSP`, `JetDSP` (inglês, legado) ao lado de `DieselDSP`, `RadialDSP`, `RotativoDSP`, `VaporDSP`, `EletricoDSP`, `CenaDSP`.
- Três jeitos de uma família virar `Motor`: adaptador sobre o DSP (`MotorRonco`, `MotorDiesel`, `MotorRadial`, `MotorRotativo` estendem `MotorPistaoBase`; `MotorTurbina`), o DSP implementando `Motor` direto (`VaporDSP`, `EletricoDSP`, com `MotorVapor`/`MotorEletrico` estendendo o DSP), e o DSP da página estendendo a Cena (`DSPEletricoPagina extends CenaDSP`).
- Presets: `PRESETS` (Ronco e Diesel) contra `PRESETS_RADIAL`, `PRESETS_ROTATIVO`, `PRESETS_TURBINA`, `PRESETS_ELETRICO`, `PRESETS_VAPOR`; `FAMILIES` (Ronco), `FAMILIAS` (Diesel), `FAMILIAS_<X>` (as outras); `ACESSORIOS_PADRAO` (Ronco) contra `PADRAO_<X>`; `export default` em 5 dos 7 arquivos.
- Campos: `name`/`family`/`tag` (Ronco, Diesel, Radial, Rotativo, Turbina); `nome`/`familia`/`tag` (Vapor); o Elétrico tem os dois pares no mesmo objeto, com conteúdos diferentes (`eletrico/presets.ts:46`: `name: 'Tesla Model 3 LR AWD'`, `nome: 'Tesla Model 3 Long Range AWD'`, `family: 'carros'`, `familia: 'eletrico'`).
- Rotação máxima: `redline` (Ronco), `rpmMax` (Diesel, Radial, Rotativo, Elétrico; as páginas copiam para `redline` em `specDe`), `vMax` (Vapor). Lenta: `idle`.
- `db` quer dizer dB → linear em `acoustics/util.ts:9` e linear → dB em `tools/vapor-comum.ts:54`, `diesel-bandas.ts:55`, `radial-bandas.ts:66`.
- Classes com o mesmo nome e conteúdo diferente: `FontePneu` (K-12); `Helice` (`carriers/helice.ts:176`, o portador, e `engines/eletrico/mecanica.ts:193`, a fonte do drone).
- Ferramentas: `tools/<família>-valida.ts` soltas, mas `tools/eletrico/valida.ts` e `tools/cena/valida.ts` em pasta; `turbina-testa-navegador.mjs` contra `<família>-navegador.mjs`.
Proposta de convenção (5 linhas):
1. Tudo o que é novo ou tocado: português, sem abreviação (`processar`, `mensagem`, `nome`, `familia`, `rpmMax`, `lenta`).
2. O legado migrado (`EngineDSP`, `JetDSP`, campos de `PresetRonco`, mensagens `config/tune/params/input`) fica como está enquanto a paridade com `02c185f` valer; não se renomeia campo de preset do Ronco nem da Turbina.
3. Presets: sempre `PRESETS_<FAMILIA>`, `FAMILIAS_<FAMILIA>`, `PADRAO_<FAMILIA>`, export nomeado, sem `default`; `PRESETS` do Ronco e do Diesel ganham o alias e o nome antigo sai depois.
4. Um preset tem `id`, `nome`, `tag`, `grupo` (o grupo da navegação) e `familia` (a `FamiliaMotor`); o Elétrico perde `name`/`family`.
5. Ferramentas: `tools/<família>/<verbo>.ts` (`valida`, `lenta`, `navegador.mjs`) e scripts `<verbo>:<família>`.

**K-35 · dívida · As fichas usam unidades diferentes para a mesma grandeza.**
- **Evidência:** potência em kW no Ronco, Diesel, Radial e Rotativo (`power: 339`), em W no Elétrico (`Pmax: 160000`), em kW com outro nome no Diesel de locomotiva (`locomotiva.kW: 3356`) e no gerador (`potenciaNominal: 500`). Massa em kg no Ronco, Diesel, Radial, Rotativo (`mass`) e no Elétrico (`massaTotal: 58000`), e em **toneladas** no Vapor (`massa: 141`, `vapor/presets.ts:25`; `carro-direto.ts:26` multiplica por 1000). Radial e Rotativo têm `mass` (lido) e `massa` (dentro de `aeronave`/`veiculo`/`rotor`, em kg) no mesmo preset.
- **Estado:** armadilha para a ferramenta de auditoria de fichas (converter por família antes de calcular peso/potência). Corrigir os nomes: junto com K-34.

### Scripts do `package.json`

**K-36 · dívida · 32 scripts; todos apontam para arquivo que existe; os nomes e a cobertura não são uniformes.**
- **Evidência (`orfaos.py`):** nenhum script quebrado. Por prefixo: `paridade` (ronco, turbina, acoustics), `navegador` (8), `teste` (cena, diesel, radial, rotativo, eletrico, vapor), `lenta` (diesel, radial, rotativo, eletrico, vapor), mais `governador:diesel`, `troca:diesel`, `geometria:radial`, `gravacoes:vapor`, `render`, `compare-wav`.
- Faltam `teste:ronco`, `lenta:ronco`, `teste:turbina` e um teste da Passagem fora do navegador. O teste de lenta e de corte de giro que o PLANO manda rodar no Ronco não tem script; o que existe é `tools/analise-som/regressao.js`, que roda o legado.
- Fora do padrão: `navegador:turbina` → `tools/turbina-testa-navegador.mjs`; `tools/eletrico/` e `tools/cena/` em pasta e as outras famílias soltas na raiz de `tools/`.
- 11 ferramentas de linha de comando sem script (só por `npx tsx`): `tools/cena/cpu.ts`, `cena/legado.ts` (`gravar`), `cena/motores.ts`, `cena/render-passagem.ts`, `diesel-bandas.ts`, `diesel-fontes.ts`, `diesel-medir.ts`, `diesel-render.ts`, `radial-bandas.ts`, `radial-estouros.ts`, `rotativo-bandas.ts`. Todas são citadas pelo menos uma vez em `docs/`; nenhuma é órfã de documentação. Sem menção em doc: `tools/diesel-comum.ts`, `radial-comum.ts`, `rotativo-comum.ts`, `vapor-comum.ts` (bibliotecas, não comandos).
- **Estado:** corrigível agora no `package.json`: `navegador:turbina` continua apontando para o arquivo atual (o arquivo é da pessoa da interface), e entram `lenta:ronco`/`teste:passagem` quando as ferramentas novas existirem (auditor principal).
- **Atualização (integração):** entraram `lenta:ronco`, `teste:passagem`, `verificar`, `verificar:rapido`, `auditoria:fichas` e `auditoria:som` (`b6c47a8`). `teste:turbina` continua sem existir: a paridade é o teste dela.

**K-37 · dívida · Os roteiros de navegador não têm a mesma interface.**
- **Evidência:** 6 servem o `dist/` sozinhos (`diesel`, `eletrico`, `passagem`, `radial`, `rotativo`, `vapor`); `tools/ronco-navegador.mjs:19` e `tools/turbina-testa-navegador.mjs:26` saem com "uso:" sem URL. O da Turbina usa opções (`--firefox`, `--reserva`, `--porta`) onde os outros usam posição (`[chromium|firefox] [porta]`) e `RESERVA=1`, e não aceita `CHROMIUM=`/`FIREFOX=`. Portas padrão repetidas: Diesel com Firefox usa 9470 (`diesel-navegador.mjs:22`) e Vapor com Chromium também (`vapor-navegador.mjs:23`); só colide se os dois rodarem ao mesmo tempo.
- **Estado:** descrito para a pessoa da interface (os `.mjs` não são do auditor); o `verificar` deve rodar os `navegador:*` em sequência, não em paralelo.
- **Atualização (integração):** `navegador:ronco` e `navegador:turbina` passaram a servir o `dist/` por `tools/servir-dist.mjs` (`b6c47a8`). Os roteiros em si não foram editados (G-09).

## Robustez do áudio e coerência de volume

Medido fora do navegador com `npm run auditoria:som` (`tools/auditoria-som.ts`, novo), que monta o DSP de cada página como o worklet o recebe, com o volume padrão (master 0,8) e o motor quente:

- **Ronco, Turbina, Diesel, Radial e Rotativos**: a saída normalizada do worklet (calibração + `tanh`). "Lenta" é a lenta; "carga" é pé no fundo em ponto morto (o carro bate no corte de giro), manete toda à frente nos aviões (com a pós-combustão, onde há), notch 8 na locomotiva e 100 % de carga no gerador.
- **Vapor e Elétrico**: as páginas tocam pela Cena, em pressão. Aqui é a soma das fontes do motor ou do portador a 7,5 m, sem a Cena, com 0 dBFS = 124 dB SPL e o mesmo `tanh`. "Lenta" é parado e ligado; "carga" é o regulador aberto a 4 sopros por segundo no vapor e a arrancada com o pedal todo no elétrico. Num trem a soma põe todos os motores no mesmo ponto, então o número serve para comparar e achar saturação, não é o nível que se ouve (esse está na tabela da Passagem, acima).
- O motor de palhetas (`PalhetasDSP`) ficou de fora: tem DSP e mensagens próprios.

Os níveis são determinísticos (o ruído tem semente). O custo de CPU foi medido à parte, uma família de cada vez.

### Achados

**R-01 · erro (latente) · corrigido neste trabalho (`875e705`).** Reconfigurar o mesmo `VaporDSP` com outro preset lançava exceção no laço de áudio.
- **Evidência:** `src/engines/vapor/dsp.ts:308` guardava os índices de canal de cada fonte em `this.ch` e nunca os zerava. Passando de um preset com duas bombas de ar (Y6b, Big Boy) para um com uma, `ch.bomba1` continuava valendo e `processar()` lia `this.bombas[1].amostra()` de uma bomba que não existe: `TypeError`, e daí em diante silêncio. O mesmo valia, sem exceção, para sino, queimador, engrenagens e correias (o som de uma fonte ia para o canal de outra). Achado pela troca rápida de preset desta ferramenta: 11 de 16 trocas falhavam.
- **Estado:** corrigido com uma linha (os índices voltam a −1 antes de montar as fontes); o som de um DSP recém-criado não muda e o `teste:vapor` deu o mesmo resultado. O site não chegava ao erro, porque a Cena cria um motor novo a cada troca (`src/scene/dsp-cena.ts:51`); qualquer código que chame `configurar()` duas vezes, como a interface `Motor` permite, chegava. Teste: `npm run auditoria:som -- vapor --trocas`.

**R-02 · erro · para a etapa de som (Radial, Aviação do Ronco, rotativos de aviação).** Em potência de decolagem o limitador de saída passa do ponto: a saída encosta em ±1 e o `tanh` achata o som.
- **Evidência:** fração das amostras com |saída| > 0,7 em carga (o critério pedido era 1 %):

  | Família | Presets acima de 1 % | Quais |
  |---|---|---|
  | Radial | 10 de 17 | R-4360 63 %, Verner 5S 38 %, Rotec R3600 32 %, M-14PF 25 %, Rotec R2800 19 %, R-1340 18 %, Verner 3 e R-1830 7 %, R-2800 3 %, Monaco-Trossi 2 %; pico 1,00 em seis deles |
  | Ronco, Aviação | 6 de 10 | Rotax 912 6 %, IO-540 4 %, O-360 4 %, Cessna 172 3 %, IO-550 2 %, O-200 1 % |
  | Ronco, carros e motos | 1 de 68 | Supra 1,2 % |
  | Rotativos | 2 de 16 | Mistral 10 %, AR741 1 % (os dois com hélice) |
  | Turbina | 1 de 34 | Concorde com pós-combustão 6,5 % |
  | Diesel | 0 de 16 | |
  | Elétrico | 0 de 18 | |
  | Vapor (pressão a 7,5 m) | 1 de 14 | Big Boy 1,7 % |

- **Estado:** para a etapa de som. O padrão é claro: satura quem tem hélice. A calibração de volume nivela o escape a 55 % da rotação máxima; a hélice e o resto entram por cima, e em rotação de decolagem a soma passa do teto (inferência: não isolei as fontes). O que fazer: calibrar esses presets na condição de decolagem com a hélice (`src/engines/radial/config.ts` e a sonda do `EngineDSP` para a família Aviação, campo `nivelEscape`), ou baixar o alvo de carga dos motores com hélice. Na Passagem o mesmo excesso aparece em pressão: o Corsair passa 8,6 dB do fundo de escala (P-04).

**R-03 · sugestão.** Nenhum controle do painel, no mínimo ou no máximo, produz NaN, exceção, pico absurdo ou travamento.
- **Evidência:** 760 casos: cada controle deslizante ligado a um campo do preset (lido de `src/pages/<família>/Painel.tsx`), no mínimo e no máximo, em quatro presets por família, com 1 s de lenta e 1 s de carga; 0 problemas. E 187 trocas de preset a cada 0,4 s com o motor em carga, todos os presets de cada família em sequência: 0 problemas (depois de R-01).

  | Família | Casos | Presets | Campos |
  |---|---|---|---|
  | Ronco | 144 | muscle, r34, charger, s300 | `bankAngle`, `displacement`, `redline`, `idle`, `compression`, `cam`, `inertia`, `limiterHold`, `mass`, `wheelR`, `drag`, `power`, `pipeLen`, `pipeD`, `tipD`, `boost`, `scRatio`, `scWhine` |
  | Diesel | 176 | hilux28, om617, catc15, ge7fdl | `bankAngle`, `idle`, `rpmMax`, `cr`, `cetano`, `cam`, `mecanica`, `inertia`, `power`, `torque`, `bsfc`, `droop`, `mass`, `wheelR`, `drag`, `limiteFumaca`, `boost`, `turboRpmMax`, `turboPas`, `turboApito`, `turboChiado`, `turboTau.0`, `soprador.relacao`, `soprador.uivo` |
  | Radial | 72 | r1820, r1340, verner3, s55 | `Lr`, `rkr`, `displacement`, `idle`, `rpmMax`, `cr`, `cam`, `J`, `power` |
  | Rotativos | 88 | rx7fd, cosmo20b, mistral, xts210 | `janelas.apv.0`, `janelas.apv.1`, `idle`, `rpmMax`, `J`, `power`, `limiterHold`, `shiftTime`, `mass`, `drag`, `fHCextra`, `hcEspalha` |
  | Turbina | 168 | narrow, turbojet, gripen, hondajet | `spoolTime`, `thrust`, `n2Idle`, `n1Idle`, `span`, `cockpitX`, `length`, `shape`, `propD`, `propRpm`, `fanB`, `vanes`, `fanD`, `n1Max`, `gear`, `hpcB`, `lptB`, `n2Max`, `bpr`, `jetV`, `nozD` |
  | Vapor | 56 | k4s, bigboy, king, vapor_pas | `regulador`, `reverser`, `apitoAbertura`, `freio`, `fogo`, `mixAr`, `mixMec` (comandos da máquina: o painel do Vapor não tem campos de ficha) |
  | Elétrico | 56 | model3, frotaa, flexity, industrial | `inversor.fc`, `inversor.delta`, `Zs`, `reducao.estagios.0.Zp`, `excentricidade`, `escovas.desgaste`, `detune` (modo avançado) |
- Não coberto: os controles de escolha (arranjo, virabrequim, tipo de turbo, janelas), os deslizantes de faixa que depende do preset (faixa do corte, rotação de largada, relação de cada marcha), os de mixagem, equalização e ouvinte, e o motor de palhetas.
- De passagem: o DSP não valida a configuração que recebe. Um `turboTau` que não seja o par `[sobe, desce]` ou um `soprador` que não seja o objeto esperado dão NaN em todas as amostras (`src/engines/diesel/dsp.ts:1037, 1026`). O painel não manda isso; um preset escrito à mão pode mandar. Vale uma conferência de tipos em `setConfig`, ou tirar os `| string` e os `any` dos tipos dos presets (K-26).

**R-04 · dívida · para a etapa de som.** A 44,1 e a 96 kHz não há NaN, mas três presets mudam de nível.
- **Evidência:** dois presets por família, lenta e carga, contra 48 kHz. Onze dos catorze ficam a menos de 1 dB. Fora disso: Norton a 44,1 kHz, +2,0 dB na lenta e +2,8 dB em carga; M-14PF a 96 kHz, −2,2 e −1,5 dB; RX-7 FD a 96 kHz, −1,6 dB na lenta. A 96 kHz o custo de CPU por amostra é o mesmo, então por bloco de tempo real dobra.
- **Estado:** listar. O site roda na taxa do dispositivo (44,1 ou 48 kHz na maioria); 2,8 dB de diferença na Norton sugere um filtro ou um atraso com constante em amostras, não em segundos (`src/engines/rotativo/`).

**R-05 · dívida · para o dono decidir.** Todos os DSPs alocam memória dentro do laço de áudio.
- **Evidência:** dez segundos de carga com `node --trace-gc`, depois de 4 s de aquecimento:

  | Família (preset) | Coletas em 10 s | Alocado | Pausa total | Maior pausa |
  |---|---|---|---|---|
  | Ronco (`v10f1`) | 749 | ≈ 12,0 GB | 99,5 ms | 2,74 ms |
  | Turbina (`twin`) | 35 | ≈ 280 MB | 2,9 ms | 0,12 ms |
  | Diesel (`scaniav8`) | 298 | ≈ 2,4 GB | 16,0 ms | 0,11 ms |
  | Radial (`m14pf`) | 70 | ≈ 559 MB | 5,0 ms | 0,14 ms |
  | Rotativos (`norton`) | 448 | ≈ 6,1 GB | 65,4 ms | 3,14 ms |
  | Vapor (`maria_fumaca`) | 27 | ≈ 216 MB | 2,3 ms | 0,19 ms |
  | Elétrico (`metropolis`) | 3 | ≈ 24 MB | 0,4 ms | 0,14 ms |
- O Ronco é o pior: o V10 de F1 batendo no corte aloca cerca de 1,2 GB por segundo de áudio (uma coleta de 16 MB a cada 13 ms de som). A pausa típica é de 0,05 a 0,2 ms, mas a maior passou do quantum de 2,67 ms no Ronco (2,7 ms) e nos Rotativos (3,1 ms). Não nasceu na migração: o `src/dsp.js` legado, no mesmo render (`THR=1 node --trace-gc tools/analise-som/render.js v10f1 17000 … 10`, saída idêntica byte a byte), faz 156 coletas; o TypeScript rodando pelo `tsx`, 227 (45 % a mais).
- **Estado:** para o dono decidir quando atacar; é trabalho para o autor do motor-base, porque Diesel, Radial e Rotativos herdam o `EngineDSP`. O sintoma seria um estalo raro com a máquina ocupada, difícil de ligar à causa. A Cena já tinha a alocação aceita como desvio, com 15 coletas e 59 MB em 10 s e pausa de até 2,4 ms (T-CEN-04); o Elétrico trocou "sem alocação" por "quase" (T-ELE-11). Achar onde é trabalho de perfil (`node --trace-gc` conta, `node --prof` mostra onde): pelo volume, o suspeito são números de ponto flutuante guardados em campos sem tipo fixo (cada escrita cria um objeto), mais do que vetores ou fechamentos (inferência: não tracei o perfil).

**R-06 · dívida · para a etapa de som (Diesel, Rotativos).** Custo de CPU por família: as locomotivas diesel e o RX-8 de seis janelas têm pouca folga.
- **Evidência:** bloco de 128 amostras a 48 kHz em carga, em % do quantum de 2,67 ms (tempo de relógio por bloco; todos os presets, uma família de cada vez):

  | Família | Mediana da família | Os três mais caros (mediana; p99) | Margem do pior (mediana; p99) |
  |---|---|---|---|
  | Ronco | 14,5 % | `v16` 25,0 %; 32,5 %, `aventador` 22,6 %; 42,6 %, `laferrari` 22,1 %; 45,2 % | 4,0×; 3,1× |
  | Turbina | 3,0 % | `sst` 4,1 %; 5,8 %, `b707b` 4,1 %; 6,6 %, `b744` 4,0 %; 7,3 % | 24,3×; 17,2× |
  | Diesel | 28,3 % | `ge7fdl` 59,1 %; 86,8 %, `emd710` 58,7 %; 90,7 %, `duramax66` 34,8 %; 54,7 % | 1,7×; 1,2× |
  | Radial | 18,4 % | `r4360` 40,2 %; 60,5 %, `trossi` 31,4 %; 35,4 %, `r2800turbo` 28,4 %; 31,6 % | 2,5×; 1,7× |
  | Rotativos | 16,4 % | `rx8hp` 49,6 %; 89,0 %, `r26b` 25,5 %; 43,6 %, `cosmo20b` 21,6 %; 26,3 % | 2,0×; 1,1× |
  | Vapor | 2,9 % | `bigboy` 4,1 %; 5,0 %, `king` 3,9 %; 5,8 %, `y6b` 3,7 %; 5,0 % | 24,2×; 19,9× |
  | Elétrico | 2,7 % | `n700` 8,0 %; 9,6 %, `cptm9500` 7,0 %; 9,5 %, `taurus` 7,0 %; 9,7 % | 12,5×; 10,4× |
- As duas locomotivas diesel são as mais caras: 59 % do quantum na mediana e 87 a 91 % no p99, com 1,2× de folga. Num computador com metade da velocidade deste, ou com a página da Passagem somando a Cena por cima (o auditor da Passagem mediu 117 a 122 % no preset da locomotiva com a máquina ocupada; P-09), o áudio falha. O RX-8 de seis janelas vem em seguida (50 %; p99 89 %), duas vezes mais caro que o 787B de quatro rotores, o que pede uma olhada. Ronco e Radial têm de 2,5× a 4× de folga; Turbina, Vapor e Elétrico, mais de 12×.
- **Estado:** para a etapa de som (Diesel: o custo da EMD e da GE; Rotativos: o `rx8hp`). As medidas de CPU que moram dentro dos `teste:*` falham com a máquina ocupada (G-11); esta roda uma família de cada vez e usa a mediana. Fora do áudio há um custo maior: carregar um preset com motor na Passagem trava a thread principal por 2 a 8 s, porque as sondas de calibração rodam nela (P-07).

**V-01 · dívida · para a etapa de som (Ronco).** Na mesma página, a família Aviação toca 11 a 15 dB acima dos carros, e a lenta de alguns presets destoa.
- **Evidência:** mediana dos 78 presets: lenta −60,2 dBFS(A), carga −27,3. Em carga, os seis aviões ficam de +11,0 a +15,2 dB acima (e são os que saturam, R-02); na lenta, os quatro helicópteros ficam de +9,7 a +18,2 dB acima (R22 +18,2, 300C +16,1, R44 +13,2) e os aviões de +8,8 a +12,1. Entre os carros, a lenta do Fusca está 13,0 dB acima da mediana e a da F1 V12 10,7 dB.
- **Estado:** para a etapa de som decidir o que é intenção (o Fusca foi revisado de ouvido pelo dono) e o que é calibração (os helicópteros na lenta já giram o rotor: o nível pode estar certo e a palavra "lenta" errada).
- Não é defeito: em carga, os carros com corte de giro por borboleta ficam 9 a 15 dB abaixo dos outros (McLaren −15,3, Chiron −13,3, up! TSI −12,0, Golf GTI −11,5, Jesko −10,6). A medida é pé no fundo em ponto morto, e nesses a central fecha a borboleta no corte; a calibração nivela a carga travada a 55 % do giro, onde todos empatam por construção.

**V-02 · dívida · para a etapa de som (Rotativos).** A lenta do 787B está 17,7 dB acima da mediana da família, e os de aviação ficam de 13 a 22 dB acima em carga.
- **Evidência:** lenta: mediana −52,6 dBFS(A), 787B −34,9, RX-3 −63,5 (28,6 dB entre os dois; o teste da família mede 24,6 e aceita como desvio). Carga: Mistral +22,5 dB (e satura, 10 %), AR741 +19,9, AE110 +13,1, X Mini e XTS-210 +10 a +11.
- **Estado:** para a etapa de som (item 9 da lista dos Rotativos).

**V-03 · dívida · para a etapa de som (Diesel).** O OM617 em carga está 10,5 dB acima da mediana e a EMD em notch 8, 11,6 dB.
- **Evidência:** carga: mediana −35,6 dBFS(A); OM617 −25,1, EMD 710 −23,9. A diferença entre lenta e carga vai de 12,5 a 35,1 dB conforme o preset (mediana 23,3). O gerador aparece 14 dB acima na "lenta" porque já gira a 1 800 rpm: esperado.

**V-04 · dívida · para a etapa de som (Turbina).** Na página, os sete turboélices em decolagem ficam de 10 a 15 dB abaixo dos jatos; pela Cena, em pressão, o turboélice sai 10 dB **alto** (T-CEN-10).
- **Evidência:** carga: mediana −15,3 dBFS(A); ATR −28,1, Q400 −30,5, C-130 −28,5, King Air −27,4, Caravan −28,7, PC-12 −28,5, Super Tucano −25,5. Os dois caminhos do mesmo motor discordam no sentido.
- **Estado:** para a etapa de som, junto com a hélice da Passagem (P-03).

**V-05 · dívida · para a etapa de som (Radial).** Fora os que saturam (R-02): a lenta do M-14P está 9,6 dB abaixo da mediana (e 4 dB abaixo da do M-14PF, o mesmo motor com outros estaques); o Sherman e o S-55 ficam 10 a 12 dB abaixo em carga, porque não têm hélice. A Megola não fica rodando neste banco (roda dianteira sem embreagem: precisa do portador), então não foi medida.

**V-06 · sugestão (Vapor e Elétrico).** Em pressão não há "fora da curva": uma Corliss de fábrica e um Big Boy não têm de tocar igual. O que a tabela mostra: as dez locomotivas a 4 sopros por segundo ficam entre −15,5 e −9,7 dBFS(A) (108 a 114 dB(A) a 7,5 m somando as fontes), 5,8 dB de faixa; três metrôs parados (Frota A, CPTM 9000, Metropolis) e a Fórmula E saem em silêncio digital, enquanto Taurus, Vectron, TGV e N700 parados têm os auxiliares (T-ELE-14).

### Tabelas por família

Saída de `npm run auditoria:som` no estado final. "> 0,7 em carga" é a fração das amostras em que o `tanh` já comprime; "observação" marca quem foge mais de 8 dB da mediana (só nas famílias de saída normalizada) e quem passa de 1 % no limitador.

#### Ronco (saída normalizada do worklet)

| preset | lenta dBFS(A) | pico | carga dBFS(A) | pico | carga − lenta | > 0,7 em carga | observação |
|---|---|---|---|---|---|---|---|
| muscle | -61.7 | 0.02 | -28.9 | 0.60 | 32.8 | 0.00% |  |
| mustang | -56.0 | 0.03 | -23.5 | 0.34 | 32.5 | 0.00% |  |
| gt500 | -61.1 | 0.02 | -31.7 | 0.12 | 29.4 | 0.00% |  |
| gt350 | -61.7 | 0.02 | -26.8 | 0.40 | 34.9 | 0.00% |  |
| hellcat | -60.5 | 0.03 | -32.5 | 0.17 | 28.1 | 0.00% |  |
| corvette | -61.4 | 0.02 | -26.6 | 0.61 | 34.8 | 0.00% |  |
| chevelle | -61.1 | 0.02 | -28.6 | 0.97 | 32.5 | 0.03% |  |
| viper | -62.5 | 0.02 | -30.6 | 0.45 | 31.9 | 0.00% |  |
| v6odd | -63.6 | 0.02 | -35.3 | 0.16 | 28.3 | 0.00% | carga -8.0 dB |
| flatplane | -64.5 | 0.01 | -30.0 | 0.44 | 34.5 | 0.00% |  |
| f40 | -59.1 | 0.03 | -30.5 | 0.68 | 28.6 | 0.00% |  |
| f812 | -65.1 | 0.01 | -24.8 | 0.59 | 40.3 | 0.00% |  |
| laferrari | -62.0 | 0.01 | -21.8 | 0.96 | 40.2 | 0.30% |  |
| aventador | -58.9 | 0.02 | -20.7 | 0.86 | 38.2 | 0.03% |  |
| huracan | -61.6 | 0.02 | -27.2 | 0.55 | 34.4 | 0.00% |  |
| mclaren | -61.5 | 0.01 | -42.6 | 0.03 | 18.9 | 0.00% | carga -15.3 dB |
| zonda | -63.3 | 0.01 | -26.7 | 0.50 | 36.6 | 0.00% |  |
| flat6 | -62.5 | 0.02 | -27.9 | 0.47 | 34.6 | 0.00% |  |
| turbos | -60.4 | 0.03 | -36.1 | 0.13 | 24.3 | 0.00% | carga -8.8 dB |
| carrera32 | -62.2 | 0.02 | -35.2 | 0.19 | 27.0 | 0.00% |  |
| carreragt | -57.7 | 0.03 | -25.1 | 0.74 | 32.5 | 0.02% |  |
| boxer4 | -59.8 | 0.03 | -30.2 | 0.53 | 29.6 | 0.00% |  |
| brz | -60.1 | 0.02 | -27.2 | 0.43 | 32.9 | 0.00% |  |
| i4 | -60.5 | 0.02 | -27.1 | 0.35 | 33.4 | 0.00% |  |
| ek9 | -61.0 | 0.03 | -28.3 | 0.40 | 32.6 | 0.00% |  |
| supra | -60.5 | 0.02 | -20.4 | 0.95 | 40.1 | 1.22% | limitador |
| r34 | -61.3 | 0.02 | -23.4 | 0.73 | 37.9 | 0.01% |  |
| gtr | -61.9 | 0.03 | -33.2 | 0.16 | 28.7 | 0.00% |  |
| lfa | -59.7 | 0.02 | -30.6 | 0.40 | 29.0 | 0.00% |  |
| evo | -58.2 | 0.03 | -30.2 | 0.80 | 28.0 | 0.04% |  |
| mx5 | -65.1 | 0.02 | -36.5 | 0.14 | 28.6 | 0.00% | carga -9.2 dB |
| i6 | -64.9 | 0.02 | -23.8 | 0.48 | 41.1 | 0.00% |  |
| m5e60 | -63.8 | 0.01 | -29.3 | 0.46 | 34.5 | 0.00% |  |
| i5 | -62.6 | 0.01 | -34.6 | 0.08 | 28.0 | 0.00% |  |
| quattro | -54.7 | 0.03 | -30.7 | 0.86 | 23.9 | 0.06% |  |
| c63 | -65.5 | 0.02 | -29.3 | 0.47 | 36.2 | 0.00% |  |
| r8 | -61.5 | 0.02 | -30.1 | 0.43 | 31.4 | 0.00% |  |
| m3g80 | -65.0 | 0.01 | -30.0 | 0.11 | 35.1 | 0.00% |  |
| golfgti | -65.7 | 0.02 | -38.8 | 0.07 | 26.9 | 0.00% | carga -11.5 dB |
| v10f1 | -56.3 | 0.02 | -23.2 | 0.63 | 33.0 | 0.00% |  |
| f1v8 | -54.0 | 0.02 | -24.2 | 0.52 | 29.8 | 0.00% |  |
| f1v12 | -49.6 | 0.03 | -22.1 | 0.74 | 27.5 | 0.00% | lenta +10.5 dB |
| nascar | -57.9 | 0.02 | -26.7 | 0.71 | 31.2 | 0.00% |  |
| c8r | -60.0 | 0.02 | -29.2 | 0.58 | 30.7 | 0.00% |  |
| v16 | -64.7 | 0.01 | -40.6 | 0.11 | 24.1 | 0.00% | carga -13.3 dB |
| jesko | -60.9 | 0.02 | -37.9 | 0.08 | 23.0 | 0.00% | carga -10.7 dB |
| valkyrie | -61.4 | 0.01 | -25.0 | 0.69 | 36.4 | 0.00% |  |
| t50 | -56.5 | 0.02 | -23.4 | 0.50 | 33.0 | 0.00% |  |
| amgone | -55.6 | 0.03 | -23.1 | 0.86 | 32.5 | 0.05% |  |
| opala | -64.5 | 0.02 | -35.9 | 0.29 | 28.7 | 0.00% | carga -8.6 dB |
| opala250s | -59.0 | 0.03 | -27.3 | 0.84 | 31.8 | 0.01% |  |
| maverick | -61.4 | 0.02 | -30.9 | 0.79 | 30.6 | 0.01% |  |
| charger | -60.8 | 0.03 | -30.5 | 0.82 | 30.2 | 0.00% |  |
| fusca | -47.2 | 0.04 | -31.4 | 0.46 | 15.8 | 0.00% | lenta +12.9 dB |
| golgti | -60.4 | 0.02 | -25.9 | 0.48 | 34.5 | 0.00% |  |
| unoturbo | -62.6 | 0.02 | -26.7 | 0.72 | 36.0 | 0.01% |  |
| i3 | -64.2 | 0.02 | -39.3 | 0.07 | 24.9 | 0.00% | carga -12.0 dB |
| r1 | -55.0 | 0.04 | -24.3 | 0.60 | 30.7 | 0.00% |  |
| cbr | -56.4 | 0.03 | -22.4 | 0.35 | 34.0 | 0.00% |  |
| zx10r | -56.3 | 0.03 | -23.5 | 0.56 | 32.8 | 0.00% |  |
| h2 | -57.3 | 0.03 | -25.3 | 0.60 | 32.0 | 0.00% |  |
| hayabusa | -57.1 | 0.03 | -24.2 | 0.43 | 32.9 | 0.00% |  |
| panigale | -52.7 | 0.05 | -20.4 | 0.85 | 32.3 | 0.23% |  |
| monster | -55.1 | 0.05 | -30.2 | 0.48 | 24.9 | 0.00% |  |
| vtwin | -58.0 | 0.06 | -30.9 | 0.87 | 27.1 | 0.19% |  |
| mt07 | -55.8 | 0.04 | -28.0 | 0.57 | 27.8 | 0.00% |  |
| triumph | -55.1 | 0.04 | -24.3 | 0.49 | 30.7 | 0.00% |  |
| single | -54.7 | 0.04 | -31.5 | 0.59 | 23.2 | 0.00% |  |
| c172 | -50.9 | 0.05 | -14.3 | 0.98 | 36.7 | 3.33% | lenta +9.2 dB, carga +13.0 dB, limitador |
| o360 | -50.1 | 0.06 | -13.8 | 0.98 | 36.4 | 3.74% | lenta +10.0 dB, carga +13.5 dB, limitador |
| io540 | -52.4 | 0.02 | -12.4 | 0.95 | 40.0 | 3.80% | carga +14.9 dB, limitador |
| o200 | -48.2 | 0.06 | -16.3 | 0.95 | 31.9 | 1.42% | lenta +12.0 dB, carga +11.0 dB, limitador |
| io550 | -51.4 | 0.02 | -13.2 | 0.92 | 38.2 | 2.26% | lenta +8.7 dB, carga +14.0 dB, limitador |
| rotax912 | -50.5 | 0.05 | -12.1 | 0.99 | 38.4 | 6.45% | lenta +9.6 dB, carga +15.2 dB, limitador |
| bell47 | -50.5 | 0.09 | -27.9 | 0.98 | 22.6 | 0.05% | lenta +9.6 dB |
| r22 | -42.0 | 0.15 | -21.2 | 0.84 | 20.9 | 0.04% | lenta +18.1 dB |
| r44 | -47.1 | 0.04 | -27.3 | 0.59 | 19.8 | 0.00% | lenta +13.0 dB |
| s300 | -44.1 | 0.06 | -19.7 | 0.96 | 24.4 | 0.03% | lenta +16.0 dB |

Mediana: lenta -60.1, carga -27.3 dBFS(A).
Limitador: 7 de 78 presets com mais de 1% das amostras acima de 0.7 em carga (supra 1.2%, c172 3.3%, o360 3.7%, io540 3.8%, o200 1.4%, io550 2.3%, rotax912 6.4%).

Extremos: 144 casos (18 campos × mínimo e máximo × muscle, r34, charger, s300; 0 combinações em que o preset não tem o campo): sem NaN, exceção, pico absurdo ou travamento.
Campos: bankAngle, displacement, redline, idle, compression, cam, inertia, limiterHold, mass, wheelR, drag, power, pipeLen, pipeD, tipD, boost, scRatio, scWhine.

| preset | 48 kHz lenta / carga | 44,1 kHz (diferença) | 96 kHz (diferença) | rpm em carga 48 / 44,1 / 96 | CPU a 96 kHz |
|---|---|---|---|---|---|
| muscle | -61.5 / -28.9 | -0.5 / 0.1 dB | 0.4 / -0.1 dB | 6532 / 6421 / 6561 | 35.6% |
| v10f1 | -56.2 / -23.3 | 0.3 / 0.0 dB | -0.1 / -0.1 dB | 19015 / 19061 / 19023 | 65.4% |

Troca rápida de preset: 80 trocas a cada 0,4 s com o motor em carga: sem NaN nem exceção.

#### Diesel (saída normalizada do worklet)

| preset | lenta dBFS(A) | pico | carga dBFS(A) | pico | carga − lenta | > 0,7 em carga | observação |
|---|---|---|---|---|---|---|---|
| hilux28 | -61.7 | 0.01 | -34.4 | 0.15 | 27.4 | 0.00% |  |
| ranger32 | -61.4 | 0.01 | -36.5 | 0.11 | 24.9 | 0.00% |  |
| ram67 | -61.3 | 0.02 | -41.6 | 0.08 | 19.7 | 0.00% |  |
| duramax66 | -60.9 | 0.02 | -37.9 | 0.08 | 23.0 | 0.00% |  |
| psd73 | -60.6 | 0.02 | -37.1 | 0.09 | 23.6 | 0.00% |  |
| om617 | -57.2 | 0.03 | -25.1 | 0.39 | 32.2 | 0.00% | carga +10.3 dB |
| tdi19 | -55.8 | 0.02 | -28.0 | 0.29 | 27.7 | 0.00% |  |
| f1000mwm | -54.3 | 0.07 | -35.4 | 0.16 | 18.9 | 0.00% |  |
| scaniav8 | -52.7 | 0.03 | -37.5 | 0.09 | 15.2 | 0.00% |  |
| volvod13 | -51.6 | 0.03 | -36.0 | 0.17 | 15.6 | 0.00% |  |
| catc15 | -53.5 | 0.03 | -35.8 | 0.17 | 17.7 | 0.00% |  |
| onibusisl | -49.8 | 0.03 | -31.5 | 0.25 | 18.3 | 0.00% |  |
| dd6v92 | -58.0 | 0.02 | -31.4 | 0.19 | 26.6 | 0.00% |  |
| gen500 | -43.6 | 0.10 | -31.1 | 0.41 | 12.5 | 0.00% | lenta +13.6 dB |
| emd710 | -59.0 | 0.03 | -23.9 | 0.47 | 35.1 | 0.00% | carga +11.4 dB |
| ge7fdl | -61.2 | 0.05 | -35.9 | 0.25 | 25.3 | 0.00% |  |

Mediana: lenta -57.2, carga -35.4 dBFS(A).
Limitador: 0 de 16 presets com mais de 1% das amostras acima de 0.7 em carga.

Extremos: 176 casos (24 campos × mínimo e máximo × hilux28, om617, catc15, ge7fdl; 16 combinações em que o preset não tem o campo): sem NaN, exceção, pico absurdo ou travamento.
Campos: bankAngle, idle, rpmMax, cr, cetano, cam, mecanica, inertia, power, torque, bsfc, droop, mass, wheelR, drag, limiteFumaca, boost, turboRpmMax, turboPas, turboApito, turboChiado, turboTau.0, soprador.relacao, soprador.uivo.

| preset | 48 kHz lenta / carga | 44,1 kHz (diferença) | 96 kHz (diferença) | rpm em carga 48 / 44,1 / 96 | CPU a 96 kHz |
|---|---|---|---|---|---|
| hilux28 | -61.7 / -34.4 | -0.2 / 0.0 dB | 0.8 / -0.5 dB | 4429 / 4429 / 4433 | 44.8% |
| scaniav8 | -52.6 / -37.4 | -0.3 / -0.1 dB | 0.2 / -0.0 dB | 2126 / 2126 / 2127 | 67.8% |

Troca rápida de preset: 18 trocas a cada 0,4 s com o motor em carga: sem NaN nem exceção.

#### Radial (saída normalizada do worklet)

| preset | lenta dBFS(A) | pico | carga dBFS(A) | pico | carga − lenta | > 0,7 em carga | observação |
|---|---|---|---|---|---|---|---|
| r1820 | -48.0 | 0.07 | -20.8 | 0.70 | 27.2 | 0.00% |  |
| r1830 | -47.9 | 0.04 | -14.9 | 0.95 | 33.0 | 6.77% | limitador |
| r2800 | -53.9 | 0.04 | -17.2 | 0.87 | 36.7 | 2.76% | limitador |
| r2800turbo | -55.1 | 0.02 | -16.5 | 0.72 | 38.6 | 0.01% |  |
| r4360 | -46.9 | 0.10 | -14.7 | 0.99 | 32.2 | 63.21% | limitador |
| r1340 | -46.3 | 0.07 | -9.2 | 1.00 | 37.1 | 17.99% | limitador |
| r985 | -48.7 | 0.05 | -16.9 | 0.81 | 31.8 | 0.08% |  |
| m14p | -57.5 | 0.03 | -20.8 | 0.85 | 36.7 | 0.08% | lenta -9.6 dB |
| m14pf | -53.3 | 0.04 | -10.0 | 1.00 | 43.3 | 24.80% | limitador |
| rotec2800 | -52.8 | 0.11 | -11.5 | 1.00 | 41.4 | 18.94% | limitador |
| rotec3600 | -47.9 | 0.09 | -9.6 | 1.00 | 38.3 | 32.34% | limitador |
| verner3 | -47.2 | 0.20 | -14.5 | 1.00 | 32.7 | 6.84% | limitador |
| verner5 | -43.4 | 0.26 | -10.6 | 1.00 | 32.8 | 38.09% | limitador |
| r975 | -43.0 | 0.53 | -27.0 | 0.98 | 16.1 | 0.02% | carga -12.0 dB |
| trossi | -47.3 | 0.03 | -16.7 | 0.99 | 30.7 | 1.70% | limitador |
| megola | -73.1 | 0.00 | -73.0 | 0.00 | 0.1 | 0.00% | não ficou rodando neste banco |
| s55 | -41.4 | 0.15 | -28.4 | 0.97 | 13.0 | 0.02% | carga -13.4 dB |

Mediana: lenta -47.9, carga -14.9 dBFS(A).
Limitador: 10 de 17 presets com mais de 1% das amostras acima de 0.7 em carga (r1830 6.8%, r2800 2.8%, r4360 63.2%, r1340 18.0%, m14pf 24.8%, rotec2800 18.9%, rotec3600 32.3%, verner3 6.8%, verner5 38.1%, trossi 1.7%).

Extremos: 72 casos (9 campos × mínimo e máximo × r1820, r1340, verner3, s55; 0 combinações em que o preset não tem o campo): sem NaN, exceção, pico absurdo ou travamento.
Campos: Lr, rkr, displacement, idle, rpmMax, cr, cam, J, power.

| preset | 48 kHz lenta / carga | 44,1 kHz (diferença) | 96 kHz (diferença) | rpm em carga 48 / 44,1 / 96 | CPU a 96 kHz |
|---|---|---|---|---|---|
| r1820 | -47.5 / -20.8 | -0.1 / 0.0 dB | -0.7 / -0.2 dB | 2697 / 2707 / 2700 | 51.4% |
| m14pf | -52.9 / -10.0 | -0.1 / 0.2 dB | -2.2 / -1.5 dB | 2946 / 2957 / 2955 | 50.9% |

Troca rápida de preset: 19 trocas a cada 0,4 s com o motor em carga: sem NaN nem exceção.

#### Rotativos (saída normalizada do worklet)

| preset | lenta dBFS(A) | pico | carga dBFS(A) | pico | carga − lenta | > 0,7 em carga | observação |
|---|---|---|---|---|---|---|---|
| rx7fd | -55.7 | 0.06 | -35.0 | 0.39 | 20.7 | 0.00% |  |
| rx7fc | -55.5 | 0.05 | -34.2 | 0.29 | 21.3 | 0.00% |  |
| rx3 | -63.5 | 0.04 | -35.4 | 0.47 | 28.1 | 0.00% | lenta -12.1 dB |
| rx8hp | -50.6 | 0.05 | -30.7 | 0.25 | 19.9 | 0.00% |  |
| rx8std | -50.2 | 0.06 | -32.7 | 0.23 | 17.5 | 0.00% |  |
| cosmo20b | -51.1 | 0.04 | -32.5 | 0.15 | 18.6 | 0.00% |  |
| r26b | -34.9 | 0.76 | -34.4 | 0.27 | 0.5 | 0.00% | lenta +16.6 dB |
| ro80 | -48.5 | 0.13 | -33.8 | 0.38 | 14.7 | 0.00% |  |
| norton | -58.0 | 0.03 | -36.1 | 0.31 | 21.9 | 0.00% |  |
| cosmo110s | -54.7 | 0.06 | -34.0 | 0.25 | 20.7 | 0.00% |  |
| mistral | -51.4 | 0.07 | -10.2 | 0.98 | 41.3 | 9.84% | carga +22.4 dB, limitador |
| ae110 | -55.9 | 0.03 | -19.6 | 0.78 | 36.3 | 0.03% | carga +13.0 dB |
| ae50r | -57.0 | 0.03 | -32.5 | 0.37 | 24.4 | 0.00% |  |
| ar741 | -53.8 | 0.08 | -12.7 | 0.88 | 41.1 | 1.09% | carga +19.8 dB, limitador |
| xmini | -39.2 | 0.66 | -21.7 | 0.46 | 17.5 | 0.00% | lenta +12.2 dB, carga +10.9 dB |
| xts210 | -44.9 | 0.05 | -22.5 | 0.49 | 22.4 | 0.00% | carga +10.0 dB |

Mediana: lenta -51.4, carga -32.5 dBFS(A).
Limitador: 2 de 16 presets com mais de 1% das amostras acima de 0.7 em carga (mistral 9.8%, ar741 1.1%).

Extremos: 88 casos (12 campos × mínimo e máximo × rx7fd, cosmo20b, mistral, xts210; 8 combinações em que o preset não tem o campo): sem NaN, exceção, pico absurdo ou travamento.
Campos: janelas.apv.0, janelas.apv.1, idle, rpmMax, J, power, limiterHold, shiftTime, mass, drag, fHCextra, hcEspalha.

| preset | 48 kHz lenta / carga | 44,1 kHz (diferença) | 96 kHz (diferença) | rpm em carga 48 / 44,1 / 96 | CPU a 96 kHz |
|---|---|---|---|---|---|
| rx7fd | -55.5 / -35.2 | 0.7 / 0.1 dB | -1.6 / 0.1 dB | 7960 / 8048 / 7995 | 38.0% |
| norton | -58.6 / -36.1 | 2.0 / 2.8 dB | -0.1 / 0.6 dB | 9816 / 9929 / 9731 | 35.5% |

Troca rápida de preset: 18 trocas a cada 0,4 s com o motor em carga: sem NaN nem exceção.

#### Turbina (saída normalizada do worklet)

| preset | lenta dBFS(A) | pico | carga dBFS(A) | pico | carga − lenta | > 0,7 em carga | observação |
|---|---|---|---|---|---|---|---|
| narrow | -36.5 | 0.08 | -17.7 | 0.76 | 18.8 | 0.02% |  |
| a320 | -38.7 | 0.06 | -16.6 | 0.71 | 22.1 | 0.00% |  |
| geared | -36.3 | 0.10 | -14.8 | 0.70 | 21.4 | 0.00% |  |
| max8 | -40.2 | 0.06 | -15.3 | 0.69 | 24.8 | 0.00% |  |
| e2 | -35.3 | 0.12 | -15.0 | 0.70 | 20.3 | 0.00% |  |
| wide | -35.8 | 0.08 | -18.7 | 0.79 | 17.0 | 0.05% |  |
| b787 | -32.0 | 0.10 | -18.2 | 0.78 | 13.8 | 0.03% |  |
| a350 | -34.4 | 0.08 | -18.1 | 0.72 | 16.2 | 0.00% |  |
| a380 | -36.6 | 0.07 | -17.4 | 0.77 | 19.2 | 0.01% |  |
| b744 | -35.0 | 0.07 | -16.0 | 0.80 | 19.1 | 0.08% |  |
| jumbo | -37.3 | 0.06 | -13.8 | 0.80 | 23.4 | 0.03% |  |
| turbojet | -34.5 | 0.09 | -16.4 | 0.74 | 18.1 | 0.01% |  |
| b707b | -36.8 | 0.08 | -13.2 | 0.77 | 23.5 | 0.01% |  |
| b727 | -34.9 | 0.08 | -13.5 | 0.80 | 21.4 | 0.02% |  |
| caravelle | -33.5 | 0.10 | -14.6 | 0.75 | 18.9 | 0.02% |  |
| sst | -39.3 | 0.12 | -13.6 | 0.96 | 25.8 | 6.55% | limitador |
| fighter | -29.9 | 0.16 | -14.8 | 0.84 | 15.2 | 0.27% |  |
| twin | -29.7 | 0.21 | -14.8 | 0.90 | 14.9 | 0.37% |  |
| f22 | -29.7 | 0.18 | -14.9 | 0.91 | 14.7 | 0.32% |  |
| f35 | -30.2 | 0.16 | -15.4 | 0.82 | 14.8 | 0.17% |  |
| fa18 | -30.3 | 0.17 | -14.7 | 0.84 | 15.6 | 0.25% |  |
| su27 | -30.4 | 0.15 | -15.2 | 0.90 | 15.2 | 0.32% |  |
| gripen | -30.5 | 0.16 | -14.7 | 0.87 | 15.8 | 0.20% |  |
| regional | -38.9 | 0.10 | -28.0 | 0.42 | 10.8 | 0.00% | carga -12.8 dB |
| q400 | -36.5 | 0.12 | -30.5 | 0.40 | 6.0 | 0.00% | carga -15.3 dB |
| c130 | -36.6 | 0.21 | -28.5 | 0.54 | 8.1 | 0.00% | carga -13.3 dB |
| kingair | -35.6 | 0.14 | -27.3 | 0.52 | 8.2 | 0.00% | carga -12.1 dB |
| single | -39.6 | 0.12 | -28.7 | 0.40 | 11.0 | 0.00% | carga -13.4 dB |
| pc12 | -36.6 | 0.12 | -28.5 | 0.38 | 8.1 | 0.00% | carga -13.3 dB |
| stucano | -35.8 | 0.13 | -25.4 | 0.38 | 10.3 | 0.00% | carga -10.2 dB |
| bizjet | -36.9 | 0.08 | -14.3 | 0.70 | 22.7 | 0.00% |  |
| learjet | -36.8 | 0.07 | -14.4 | 0.69 | 22.4 | 0.00% |  |
| g650 | -35.0 | 0.07 | -14.6 | 0.66 | 20.4 | 0.00% |  |
| hondajet | -39.0 | 0.07 | -14.7 | 0.71 | 24.4 | 0.00% |  |

Mediana: lenta -35.8, carga -15.2 dBFS(A).
Limitador: 1 de 34 presets com mais de 1% das amostras acima de 0.7 em carga (sst 6.5%).

Extremos: 168 casos (21 campos × mínimo e máximo × narrow, turbojet, gripen, hondajet; 0 combinações em que o preset não tem o campo): sem NaN, exceção, pico absurdo ou travamento.
Campos: spoolTime, thrust, n2Idle, n1Idle, span, cockpitX, length, shape, propD, propRpm, fanB, vanes, fanD, n1Max, gear, hpcB, lptB, n2Max, bpr, jetV, nozD.

| preset | 48 kHz lenta / carga | 44,1 kHz (diferença) | 96 kHz (diferença) | rpm em carga 48 / 44,1 / 96 | CPU a 96 kHz |
|---|---|---|---|---|---|
| narrow | -36.8 / -17.5 | 0.3 / 0.2 dB | 0.4 / 0.2 dB | — / — / — | 16.9% |
| twin | -30.0 / -14.8 | 0.2 / -0.0 dB | 0.1 / -0.0 dB | — / — / — | 17.7% |

Troca rápida de preset: 36 trocas a cada 0,4 s com o motor em carga: sem NaN nem exceção.

#### Vapor (pressão a 7,5 m, 0 dBFS = 124 dB SPL)

| preset | lenta dBFS(A) | pico | carga dBFS(A) | pico | carga − lenta | > 0,7 em carga | observação |
|---|---|---|---|---|---|---|---|
| k4s | -46.5 | 0.16 | -12.0 | 0.82 | 34.5 | 0.06% |  |
| a4 | -47.0 | 0.12 | -15.0 | 0.63 | 32.0 | 0.00% |  |
| d51 | -46.4 | 0.12 | -13.2 | 0.75 | 33.2 | 0.01% |  |
| up844 | -44.1 | 0.15 | -10.7 | 0.85 | 33.5 | 0.29% |  |
| bigboy | -45.1 | 0.15 | -9.7 | 0.96 | 35.4 | 1.73% | limitador |
| y6b | -44.2 | 0.14 | -11.3 | 0.93 | 32.9 | 0.57% |  |
| shay | -47.0 | 0.10 | -15.5 | 0.65 | 31.5 | 0.00% |  |
| maria_fumaca | -46.4 | 0.12 | -10.1 | 0.91 | 36.3 | 0.49% |  |
| pannier | -46.5 | 0.16 | -10.6 | 0.90 | 35.9 | 0.20% |  |
| king | -46.7 | 0.11 | -11.9 | 0.78 | 34.7 | 0.03% |  |
| corliss | -64.5 | 0.00 | -43.6 | 0.04 | 21.0 | 0.00% |  |
| aveling | -61.5 | 0.00 | -41.5 | 0.04 | 20.0 | 0.00% |  |
| stanley | -59.8 | 0.01 | -46.6 | 0.02 | 13.1 | 0.00% |  |
| vapor_pas | -56.6 | 0.01 | -40.5 | 0.04 | 16.1 | 0.00% |  |

Mediana: lenta -46.5, carga -12.0 dBFS(A).
Limitador: 1 de 14 presets com mais de 1% das amostras acima de 0.7 em carga (bigboy 1.7%).

Extremos: 56 casos (7 campos × mínimo e máximo × k4s, bigboy, king, vapor_pas; 0 combinações em que o preset não tem o campo): sem NaN, exceção, pico absurdo ou travamento.
Campos: regulador, reverser, apitoAbertura, freio, fogo, mixAr, mixMec.

| preset | 48 kHz lenta / carga | 44,1 kHz (diferença) | 96 kHz (diferença) | rpm em carga 48 / 44,1 / 96 | CPU a 96 kHz |
|---|---|---|---|---|---|
| k4s | -47.7 / -11.9 | 0.7 / 0.0 dB | 0.6 / -0.1 dB | — / — / — | 12.1% |
| maria_fumaca | -46.5 / -10.1 | -0.1 / -0.0 dB | 0.1 / 0.0 dB | — / — / — | 12.2% |

Troca rápida de preset: 16 trocas a cada 0,4 s com o motor em carga: sem NaN nem exceção.

#### Elétrico (pressão a 7,5 m, 0 dBFS = 124 dB SPL)

| preset | lenta dBFS(A) | pico | carga dBFS(A) | pico | carga − lenta | > 0,7 em carga | observação |
|---|---|---|---|---|---|---|---|
| model3 | -72.9 | 0.00 | -44.5 | 0.03 | 28.4 | 0.00% |  |
| leaf | -73.4 | 0.00 | -50.0 | 0.01 | 23.4 | 0.00% |  |
| dolphin | -73.2 | 0.00 | -48.0 | 0.02 | 25.2 | 0.00% |  |
| formulae | -240.0 | 0.00 | -51.1 | 0.01 | 188.9 | 0.00% |  |
| taurus | -55.9 | 0.01 | -46.0 | 0.03 | 9.8 | 0.00% |  |
| vectron | -55.9 | 0.01 | -48.9 | 0.02 | 7.1 | 0.00% |  |
| frotaa | -240.0 | 0.00 | -41.7 | 0.07 | 198.3 | 0.00% |  |
| cptm9500 | -67.3 | 0.00 | -40.8 | 0.07 | 26.4 | 0.00% |  |
| cptm9000 | -240.0 | 0.00 | -40.5 | 0.08 | 199.5 | 0.00% |  |
| metropolis | -240.0 | 0.00 | -41.5 | 0.06 | 198.5 | 0.00% |  |
| n700 | -42.7 | 0.03 | -38.7 | 0.07 | 4.0 | 0.00% |  |
| tgv | -49.9 | 0.01 | -47.1 | 0.03 | 2.8 | 0.00% |  |
| flexity | -70.5 | 0.00 | -47.3 | 0.03 | 23.3 | 0.00% |  |
| trolebus | -59.4 | 0.00 | -51.3 | 0.02 | 8.1 | 0.00% |  |
| furadeira | -240.0 | 0.00 | -49.2 | 0.01 | 190.8 | 0.00% |  |
| liquidificador | -240.0 | 0.00 | -48.1 | 0.01 | 191.9 | 0.00% |  |
| mavic | -87.1 | 0.00 | -60.7 | 0.00 | 26.4 | 0.00% |  |
| industrial | -97.8 | 0.00 | -59.7 | 0.01 | 38.1 | 0.00% |  |

Mediana: lenta -73.2, carga -47.3 dBFS(A).
Limitador: 0 de 18 presets com mais de 1% das amostras acima de 0.7 em carga.

Extremos: 56 casos (7 campos × mínimo e máximo × model3, frotaa, flexity, industrial; 0 combinações em que o preset não tem o campo): sem NaN, exceção, pico absurdo ou travamento.
Campos: inversor.fc, inversor.delta, Zs, reducao.estagios.0.Zp, excentricidade, escovas.desgaste, detune.

| preset | 48 kHz lenta / carga | 44,1 kHz (diferença) | 96 kHz (diferença) | rpm em carga 48 / 44,1 / 96 | CPU a 96 kHz |
|---|---|---|---|---|---|
| model3 | -73.0 / -45.4 | -0.0 / 0.0 dB | -0.0 / 0.1 dB | — / — / — | 6.7% |
| metropolis | -240.0 / -42.4 | 0.0 / 0.1 dB | 0.0 / -0.2 dB | — / — / — | 23.9% |

## Documentação (frente 7)

Conferidos contra o código no commit `745e183`: `README.md`, `docs/TECNICO.md` (inteiro), `docs/PLANO.md` e os seis documentos de projeto. As linhas citadas dos documentos são as de `745e183` (antes das correções). Correções no branch `worktree-agent-a5ddafa0e45075546`: `e55e6f6` (README), `3900b7c` (TECNICO), `3ca79ad` (PLANO), `ae1d386` (documentos de projeto), `e20658e` (CREDITOS).

Contagem: 28 achados. 12 erros, 9 incompletos, 6 dívidas, 1 sugestão. 22 corrigidos neste trabalho (alguns só no texto, com a causa ainda aberta), 6 para o dono decidir.

### README

**D-01 · incompleto · corrigido (`e55e6f6`).** O README não tinha seção nem teclas do **Diesel** nem da **Passagem**, embora as duas páginas estejam na lista do topo.
- **Evidência:** `README.md:18–83` (seções Ronco, Turbina, Radial, Rotativos, Vapor, Elétrico) × `src/pages/diesel/teclado.ts:1–4` (W/S, E/Q, M, B, I, C, V, J, 0–8 e +/− na locomotiva, 0–4 no gerador) e `src/pages/passagem/controle.ts:566–574`, `cena3d.ts:523` (Espaço, R, G, C).

**D-02 · erro · corrigido (`e55e6f6`).** A tecla `V` do Ronco estava descrita como "alterna entre dentro do carro e na rua". Ela alterna o observador entre junto ao carro (qualquer microfone) e parado na rua.
- **Evidência:** `README.md:39` × `src/pages/ronco/teclado.ts:42` (`setObserver(observer === 'car' ? 'road' : 'car')`).

**D-03 · incompleto · corrigido (`e55e6f6`).** A lista da Passagem no topo citava 10 exemplos da etapa 3; faltavam as locomotivas a vapor, os rotativos, os elétricos, o metrô e o drone. A seção "Desenvolvimento" não citava nenhum teste.
- **Evidência:** `README.md:12`, `README.md:104–112` × `src/pages/passagem/presets.ts:115–155` (29 presets) e `package.json:11–39`.

**D-04 · incompleto · corrigido (`e55e6f6`, `3900b7c`).** O link do README e o título do TECNICO diziam "Como o Ronco e a Turbina funcionam", e a introdução do TECNICO falava em "os dois simuladores". São sete famílias mais a Passagem.
- **Evidência:** `README.md:116`, `docs/TECNICO.md:1–3`.

**D-05 · erro · para o auditor confirmar (corrigido no texto, `e55e6f6`/`3900b7c`).** O comando que o README ensina, `npx tsx tools/render.ts ronco mustang rev saida/`, renderizava o DSP **legado** (`src/dsp.js`), não o TypeScript: uma mudança de som em `src/engines/ronco/dsp.ts` não aparecia no WAV.
- **Evidência:** `README.md:110` × `tools/render.ts:17,162` ("Por padrão usa o DSP legado em src/dsp.js"). O texto novo descreve o padrão em TypeScript, que depende da troca em `tools/render.ts`.
- **Atualização (integração):** confirmado e corrigido: `tools/render.ts` usa o DSP em TypeScript por padrão (`73c2590`).

### TECNICO

**D-06 · erro · corrigido (`3900b7c`).** A tabela "Estrutura do projeto" apresentava o legado como presente e como referência do som ("continua no lugar"), com oito linhas de arquivos legados; não tinha linha para o **Diesel** (`diesel.html`, `src/pages/diesel/`, `src/engines/diesel/`), nem para `tools/wav.ts`, nem para `docs/`; a lista de `src/ui/` não tinha a `Manete` nem o `BotaoIgnicao`.
- **Evidência:** `docs/TECNICO.md:27,29–59` × `vite.config.mts:27`, `src/ui/index.ts:7–9`. O texto novo tira o legado, explica o commit fixo `02c185f` e guarda um parágrafo "de onde veio cada parte".

**D-07 · dívida · para o dono decidir (texto corrigido, `3900b7c`).** `src/pages/comum/` era descrita como "casca comum das páginas durante a migração". `Casca.tsx`, `casca.css` e `ProvaDoWorklet.tsx` não são importados por nenhuma página; só `Aviacao.tsx` é usado (Ronco, Radial, Rotativos). `src/worklet/processador-tom.ts` só é referido pela `ProvaDoWorklet`.
- **Evidência:** `docs/TECNICO.md:37` × `grep -rn "Casca\|ProvaDoWorklet\|processador-tom" src` (só os próprios arquivos). Remover é da frente de código morto.

**D-08 · incompleto · corrigido (`3900b7c`).** O índice não tinha a seção "Adaptadores de motor".
- **Evidência:** `docs/TECNICO.md:5–19` × `docs/TECNICO.md:841`.

**D-09 · erro · corrigido (`3900b7c`).** A seção da Passagem descrevia o estado da etapa dos adaptadores: helicóptero "sem motor", rotor que "continua sem motor", `ADAPTADORES` com cinco famílias, `PORTADORES_NO_DSP` com sete portadores, sete presets com motor mais o R44 sem motor, duas funções `prepararMotor*`.
- **Evidência:** `docs/TECNICO.md:665,690,705–707,709–712,715,717–727` × `src/carriers/compat.ts:29–32` (nove famílias), `src/pages/passagem/presets.ts:27–30` (dez portadores), `:115–155` (29 presets; 25 com motor), `src/pages/passagem/controle.ts:23–38` (seis `prepararMotor*`).

**D-10 · erro · corrigido (`3900b7c`).** Contagem do `teste:cena`: o TECNICO dizia "92 ok, 13 desvios documentados" na seção da Cena e "93 ok, 12 desvios" na seção do Elétrico. Medido hoje: **105 medidas, 93 ok, 12 desvios, 0 falhas**. A diferença é a lenta da Hilux, que o texto ainda dava como desvio (66,7 dB(A)) e hoje mede 68,8, dentro de ~70 ± 3.
- **Evidência:** `docs/TECNICO.md:512,983,988,997,1596` × `npm run -s teste:cena` (linha `[níveis] Hilux 2.8 em lenta (778 rpm)…: medido 68.8 dB(A)`, estado `ok`).

**D-11 · dívida · para o dono decidir.** A tabela "Não pode piorar" do avião a 1500 m está com números de antes da mudança do filtro de ar (`7abf8aa`): no ponto mais próximo o texto dá Δ −0,9 / 0 / +1,5 / +1,9 / +2,6 / +3,8 e 4 kHz a −20,5 dB; o teste hoje dá Δ −0,9 / 0 / +1,5 / +1,8 / +2,2 / +1,2 e −20,9 dB; 10 s antes, +2,1 / 0 / +0,3 / +1,1 / +0,6 / +1,4 contra +2,1 / 0 / +0,3 / +1,1 / +0,3 / −0,7. Não foi corrigido (seção de resultados de som). Como as duas linhas estão na lista de desvios, sem teto, o teste não acusa quando esses números mudam.
- **Evidência:** `docs/TECNICO.md:959–961` × saída do `teste:cena`, linhas `avião a 1500 m pela Cena`.

**D-12 · dívida · corrigido (`3900b7c`).** Tempos e grupos dos testes fora da realidade: `teste:eletrico` "~2 min" (medido 35–37 s); `teste:vapor` "~25 s" (32 s sozinho, 45–67 s com a máquina ocupada); o `teste:diesel` não tinha tempo nenhum e leva ~20 min (1190 s e 1206 s medidos); "12 grupos em paralelo e o de CPU" no Radial (são 12 ao todo, 11 em paralelo); "14 grupos em paralelo" no Vapor e "15 grupos em paralelo" no Rotativo (o de CPU roda sozinho no fim).
- **Evidência:** `docs/TECNICO.md:1030,1208,1320,1596,1738` × `tools/radial-valida.ts:411,421–423`, `tools/vapor-valida.ts:742,756–759`, `tools/rotativo-valida.ts:484,495–497` e os tempos da linha de base.

**D-13 · erro · texto corrigido (`3900b7c`); a ferramenta fica para o dono decidir.** `npm run gravacoes:vapor` era descrito com o resultado "135 ok e 6 desvios". Hoje termina com `ENOENT` e código 1: o caminho padrão das gravações é uma pasta temporária da etapa (`/tmp/claude-1000/…/scratchpad/real2/vapor/wav`), que não existe.
- **Evidência:** `docs/TECNICO.md:1737` × `tools/vapor-gravacoes.ts:25`. Correção possível em `tools/**`: padrão em `referencias/vapor/` e, sem as gravações, sair com uma mensagem clara e código próprio.
- **Atualização (integração):** o caminho padrão passou a `referencias/vapor/wav` e a mensagem diz o que falta (`b6c47a8`).

**D-14 · dívida · texto corrigido (`3900b7c`).** `npm run governador:diesel` aparecia na lista de ferramentas sem aviso; rodado sozinho sai com código 1 (duas medidas que só viram "desvio" dentro do `teste:diesel`).
- **Evidência:** `docs/TECNICO.md:1030` × linha de base (`governador:diesel rc=1`, "2 falha(s)").

**D-15 · erro · corrigido (`3900b7c`).** "Como adicionar um carro" mandava conferir a ordem de ignição com `EngineGeometry.build(preset).valid`, o global do legado. No código é `build(preset).valid` de `src/engines/ronco/geometria.ts`.
- **Evidência:** `docs/TECNICO.md:1899` × `src/engines/ronco/geometria.ts:223`.

**D-16 · erro · para o dono decidir (documentado, `3900b7c`).** O procedimento que o TECNICO ensina para acrescentar um carro ou um avião ("acrescente uma linha em `presets.ts`") quebra o portão: `paridade:ronco` falha com "68 presets no legado, 69 no migrado" e compara por posição; `paridade:turbina` compara o `JSON.stringify` da lista inteira. A tabela de correções de `tools/legado.ts` só cobre presets que já existem. Hoje não há como acrescentar um veículo ao Ronco ou à Turbina sem falhar a paridade.
- **Evidência:** `docs/TECNICO.md:1877,1901` × `tools/ronco-paridade.ts:64–71`, `tools/turbina-paridade.ts:52–60`. Saída possível: a paridade comparar só os ids do legado e listar os novos à parte.
- **Atualização (integração):** corrigido em `381c356`: um preset novo fica fora da paridade, que avisa quais são (G-10).

**D-17 · incompleto · corrigido (`3900b7c`).** "Como adicionar" só cobria carro e avião. Faltavam a família Aviação do Ronco, Diesel, Radial, Rotativos, Vapor, Elétrico e os presets da Passagem.
- **Evidência:** `docs/TECNICO.md:1875–1901` × `src/engines/*/presets.ts`, `src/pages/passagem/presets.ts:99–113`.

**D-18 · erro · corrigido (`3900b7c`).** Pendências que já não valem: "o rotor fica sem motor" (leva pistão de aviação, radial ou rotativo); "referência própria para o diesel leve (Hilux 3 dB baixa)" (hoje no alvo); `acoplar(carga)` do Diesel "pronto para os portadores, marcado `TODO(integração carriers/)`" (o `MotorDiesel` já o usa).
- **Evidência:** `docs/TECNICO.md:995,997,1024` × `src/carriers/compat.ts:36`, `src/engines/diesel/motor.ts:95–122`. Os três comentários `TODO(integração carriers/)` continuam em `src/engines/diesel/dsp.ts:20,91,104` (não editados: lógica do DSP).

**D-19 · incompleto · para o dono decidir (anotado no texto, `3900b7c`).** O alvo principal dos testes do Diesel, o conjunto "real3", é citado como `scratchpad/real3/diesel/` com um `RESUMO.md`. A pasta não existe mais e não está no repositório: os números do real3 estão copiados em `tools/diesel-valida.ts` e não podem ser refeitos.
- **Evidência:** `docs/TECNICO.md:1034` × `ls …/scratchpad/real3/diesel/` (vazio); `grep -c real3 tools/diesel-valida.ts` = 25.

**D-20 · dívida · corrigido (`3900b7c`).** Radial: "lenta de todos os radiais e dos 10 de aviação: 52/52". São 16 radiais; a Megola fica de fora do `lenta:radial`.
- **Evidência:** `docs/TECNICO.md:1208,1247` × `tools/radial-lenta.ts:59`.

**D-21 · incompleto · corrigido (`3900b7c`).** "Limitações conhecidas" só listava o Ronco e a Turbina, e nada dizia que "0 falhas" nos testes convive com dezenas de medidas fora do alvo aceitas como desvio.
- **Evidência:** `docs/TECNICO.md:1864–1873`.

**D-22 · incompleto · para o dono decidir (anotado, `3900b7c`, `3ca79ad`).** A seção "Validação" cita medidas (lenta dos 68 veículos a 20 °C e −5 °C, corte de giro em neutro e em 3ª, auditoria de câmbio) feitas com harnesses que não entraram no repositório. O que existe para o Ronco é a paridade e `node tools/analise-som/regressao.js`.
- **Evidência:** `docs/TECNICO.md:1841–1844,1855–1857` × `package.json` (não há `teste:ronco` nem `lenta:ronco`).
- **Atualização (integração):** `npm run lenta:ronco` (`b6c47a8`) repõe a lenta a 20 °C e −5 °C, o corte de giro em ponto morto e a troca de carro; `npm run auditoria:fichas` repõe a auditoria de câmbio. O corte de giro em 3ª continua sem teste.

**D-23 · dívida · corrigido (`3900b7c`).** Referências ao legado que deixam de valer com a remoção: "`git show master:`" nas três paridades e em `tools/cena/legado.ts`; "os arquivos legados de `src/` são CommonJS" na explicação do `"type": "module"`; o comentário "(na migração)" no exemplo do worklet.
- **Evidência:** `docs/TECNICO.md:68,87,101,104,108,475,546`.

### PLANO

**D-24 · erro · corrigido (`3ca79ad`).** As etapas 1 (Base) e 2 (Diesel) não estavam marcadas como feitas; as de 3 a 6 estavam.
- **Evidência:** `docs/PLANO.md:35–36` × `:37–40`.

**D-25 · incompleto · para o dono decidir (anotado, `3ca79ad`).** A regra de verificação manda rodar "o teste de lenta (68 veículos, 20 °C e −5 °C) e o teste de corte de giro" e aponta as ferramentas para `/tmp/claude-1000/…/scratchpad/tools/` (`limtest.js`, `idletest.js`). A pasta não existe e esses dois testes nunca foram copiados para `tools/`: a regra não pode ser cumprida para o Ronco.
- **Evidência:** `docs/PLANO.md:28,30` × `ls …/scratchpad/tools` (não existe), `ls tools/`.
- **Atualização (integração):** `npm run lenta:ronco` existe (`b6c47a8`) e o PLANO aponta para ele (G-08).

**D-26 · dívida · corrigido (`3ca79ad`).** O PLANO fixa a referência do legado em `git show master:src/dsp.js`. Com a reestruturação mesclada, `master` deixa de ter o arquivo. Nota acrescentada com o commit fixo.
- **Evidência:** `docs/PLANO.md:28` × `tools/legado.ts` (`REF_LEGADO = '02c185f'`).

**D-27 · erro · para o auditor.** O portão 7 da rodada lista `navegador:*`. `npm run navegador:ronco` e `navegador:turbina` saem com código 2 sem a url (os outros seis servem o `dist/` sozinhos).
- **Evidência:** `docs/PLANO.md:69` × `package.json:14–15`, `tools/ronco-navegador.mjs:19`, `tools/turbina-testa-navegador.mjs:26`.

### Documentos de projeto

**D-28 · erro · corrigido com nota no topo (`ae1d386`).** `CENA.md` e `DIESEL.md` abrem dizendo "a implementação segue este texto à letra", e os outros quatro são lidos do mesmo jeito. Em todos a implementação diverge em pontos que mudam o entendimento. Cada um ganhou, logo depois do título, o bloco "O que mudou na implementação", com ponteiro para o TECNICO. Os que mais confundem:

| Documento | O texto diz | O código faz |
|---|---|---|
| `CENA.md` 1.3, 1.4 | `Motor` em `src/engines/motor.ts`, `Portador` em `src/carriers/portador.ts` | os dois em `src/carriers/tipos.ts`; aqueles arquivos não existem |
| `CENA.md` 1.6 | turboeixo no rotor; sete tipos de portador | não há turboeixo; `TipoPortador` tem onze; vale `COMPAT`/`USO_REAL` de `compat.ts` |
| `CENA.md` 1.3 | Ronco a 100 dB SPL a 5 m | 95 (`src/engines/ronco/motor.ts:51`) |
| `CENA.md` 4.4 | PI do gerador 0,5 por % e 0,5/s; carenagem com lei da massa | 0,07 e 0,05 (`src/carriers/gerador.ts:47`); `carenagem` não é lido em lugar nenhum |
| `CENA.md` 4.6, 2.11 | `L_W` do rolamento 123; balanço +4 dB; modulação ≥ 6 dB | 130 (`src/carriers/trem.ts:132`); alvos trocados para −3 ± 4 e ≥ 3 |
| `DIESEL.md` decisões 4 e 6 | Wiebe dupla; governador no portador para gerador e locomotiva, Kp 6 | difusão por mistura; o governador é o do motor, com ganho normalizado por motor |
| `DIESEL.md` 6.2 | 17 fichas (MAN B&W) | 16 |
| `RADIAL.md` 3.4 | estouros da partida com 35%, τ 20 s | 1,5% + 6%·e^(−t/8 s) |
| `ROTATIVO.md` 6.2 | 5ª do RX-7 FD 0,806; 787B `popbang` | 0,761; `burble` |
| `VAPOR.md` 4.6, decisão 11 | 124 dB(A) de `L_W` dão os níveis a 15 m; CPU < 1/3 do Ronco | a conta não fecha (89,5 dB(A)); Big Boy 0,34 |
| `ELETRICO.md` 4.2, 5 | inversor dos carros 72 dB(A); Metropolis 190 kW | 62; 150 kW (baixado para o teste de 0–80 passar) |

### Outros

**D-29 · incompleto · corrigido em parte (`e20658e`).** `docs/CREDITOS.md` só cita as gravações do trem e do Elétrico. Diesel, Radial, Rotativos e Vapor também usaram gravações do Commons e vídeos. Foi acrescentado o ponteiro para o Apêndice A de cada projeto; falta o autor e a licença de cada arquivo do Commons.

**D-30 · sugestão · para o dono decidir.** `docs/REVISAO-DE-SOM.md` (não editado) ensina `git show HEAD:src/dsp.js > /tmp/dsp.head.js` para comparar com a versão anterior do DSP. Sem o legado, `HEAD:src/dsp.js` não existe, e o `dsp.ts` extraído sozinho não carrega (importa `../../acoustics`). O exemplo também usa `/tmp`, que a regra 1 da rodada proíbe para referências.
- **Evidência:** `docs/REVISAO-DE-SOM.md:78–79,462,479–482`.
- **Atualização (integração):** o `harness.js` aceita `DSP=legado` e um `.ts` de outra cópia de trabalho (G-05). O texto do `REVISAO-DE-SOM.md` continua com o exemplo antigo.

### Pontos marcados `<!-- AUDITOR: confirmar -->`

Dependem de mudanças que não são desta frente (remoção do legado, `tools/render.ts`, `harness.js`, scripts novos).

| Onde | O que confirmar |
|---|---|
| `README.md:123` | `npm run verificar` e `verificar:rapido` existem e fazem o que o texto diz |
| `README.md:130` | `docs/AUDITORIA.md` existe |
| `docs/TECNICO.md:22`, `:55`, `:1875` | link para `AUDITORIA.md` |
| `docs/TECNICO.md:38` | `Casca.tsx` e `ProvaDoWorklet.tsx`: se forem removidos, tirar da tabela |
| `docs/TECNICO.md:46` | `tools/analise-som/harness.js` carrega o DSP em TypeScript |
| `docs/TECNICO.md:99` | `tools/render.ts` usa por padrão o DSP em TypeScript |
| `docs/TECNICO.md:102`, `:1906` | um preset novo no Ronco ou na Turbina falha a paridade pela contagem (ou a paridade passa a comparar só os ids do legado) |
| `docs/TECNICO.md:103`, `:108` | `npm run navegador:ronco` e `navegador:turbina` servem o `dist/` (`tools/servir-dist.mjs`) |
| `docs/TECNICO.md:104` | nomes e cobertura de `verificar`, `verificar:rapido`, `auditoria:fichas`, `teste:passagem` |
| `docs/TECNICO.md:1825`, `docs/PLANO.md:30` | se entrar um `lenta:ronco`, citar no lugar do `regressao.js` |
