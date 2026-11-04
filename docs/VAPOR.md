# Vapor: projeto do `VaporDSP`, dos portadores a vapor e da página `vapor.html` (etapa 5)

Documento de projeto da etapa 5 (ver `PLANO.md`). Define a física do som a vapor que o `VaporDSP` sintetiza (um DSP novo: não há combustão no cilindro, então ele **não** é subclasse do `EngineDSP`), as máquinas que ele cobre (locomotivas, estacionárias, trator, carro, barco), os alvos numéricos medidos em gravações, as interfaces com a Cena e os portadores (`CENA.md`), os presets, a página e o plano de implementação com testes. A implementação segue este texto; o que estiver marcado **decisão** não se renegocia dentro da etapa sem anotar no relatório. Unidades: metros, segundos, rad/s, N·m, pascal (pressões de caldeira em bar **manométrico** quando dito "bar"; nas fórmulas, absoluto), kg. Som: 48 kHz, blocos de 128 amostras, controle a cada 64. Referencial do corpo como no `CENA.md`: `x` para a frente, `y` para a esquerda, `z` para cima.

- [0. Decisões](#0-decisões)
- [1. Física do som a vapor](#1-física-do-som-a-vapor)
- [2. Máquinas estacionárias, trator, carro e barco](#2-máquinas-estacionárias-trator-carro-e-barco)
- [3. Alvos medidos nas gravações](#3-alvos-medidos-nas-gravações)
- [4. Interfaces: `VaporDSP`, comando, fontes e portadores](#4-interfaces-vapordsp-comando-fontes-e-portadores)
- [5. Presets](#5-presets)
- [6. Interface da página `vapor.html`](#6-interface-da-página-vaporhtml)
- [7. Plano de implementação e verificação](#7-plano-de-implementação-e-verificação)
- [Apêndice A. Medidas das gravações](#apêndice-a-medidas-das-gravações)
- [Apêndice B. Fórmulas e constantes](#apêndice-b-fórmulas-e-constantes)

---

## 0. Decisões

1. **DSP novo, não subclasse.** `VaporDSP` em `src/engines/vapor/dsp.ts` implementa `Motor` (`src/carriers/tipos.ts`) diretamente, sem herdar do `EngineDSP`: não há ciclo de combustão, ignição, lenta nem câmbio interno. O que ele reaproveita do projeto é o pacote `src/acoustics/` (`Line`, `Junction`, `Radiator`, `Biquad`, `RNG`, `flow`/`PSI`) para a rede caixa de fumaça → chaminé e para o apito, e `src/carriers/ruido.ts` (`FonteRolamento`, `FonteRuido`) para o rolamento. Nada em `src/acoustics/`, `src/scene/` ou nos outros motores muda; se precisar (ver 7.1), relata-se.
2. **O eixo do motor é a roda** (ou o eixo de manivelas, nas máquinas com redução). `EixoSaida.omega` é a rotação da roda motriz; `rpm = v/(π·D_roda)·60`. Quem integra ω é o `VaporDSP`, com `J = J_motor + carga.inercia` (a massa do trem refletida, `m·r²`, chega pela `Carga` do portador, como nos outros motores, CENA 1.1.5). Não há governador no portador locomotiva: o comando é regulador + reverser do usuário.
3. **Um chuff é um evento físico do cilindro, não uma amostra.** Cada extremidade de cada cilindro (dupla ação) tem estado próprio (pressão, massa, volume pela cinemática da manivela) e eventos de admissão, corte, expansão, escape e compressão que dependem do corte (`cutoff`). A vazão de escape pelo pórtico (área em função do ângulo de manivela, escoamento isentrópico com engasgo) entra no tubo de descarga (blast pipe). O som do chuff é o que a rede acústica (bico → caixa de fumaça → chaminé → boca) e o ruído de jato fazem com essa vazão. O envelope, o espectro e o "tamanho" do chuff saem da física; só os ganhos absolutos são calibrados (seção 4.6).
4. **Geometria de escapes por volta vem da máquina:** 2 cilindros a 90° → 4 chuffs por volta de roda; 3 cilindros (A4, Shay) → 6; 4 cilindros de articulada simples (Big Boy) → 8, com os dois motores **sem fase travada** (deriva de 0,5–2% entre as rotações e patinagem independente); compound Mallet (Y6) → 4 (só a baixa pressão escapa pela chaminé; 8 na partida com a válvula de simplificação); 4 cilindros com manivelas internas a 180° das externas (GWR King) → 4 batidas duplas; Shay → 6 por volta do eixo de manivelas, que gira `reducao` vezes mais que a roda.
5. **Apito como oscilador de guia de onda**, uma `Line` fechada por tubo (3–6 tubos num chime) com realimentação não linear acionada pela pressão do vapor; a frequência vem do comprimento do tubo e da velocidade do som no vapor, e sobe com a pressão e com o aquecimento do tubo (medido: +12% em 36 s no D51 498, Apêndice A). O "quilling" (apito segurado parcialmente) sai do ganho de realimentação abaixo do limiar. Sino como síntese modal (parciais medidos no Big Boy: 1 : 2,16 : 3,53 : 5,2 : 7,05).
6. **Parado não há chuff:** o som de uma locomotiva parada é vazamentos, bomba de ar Westinghouse (ciclo ~1 Hz com escape de ar e de vapor), injetor, válvula de segurança quando a pressão passa do ajuste, apito e sino. Cada um é uma fonte própria com posição no corpo (4.3). "Drifting" (regulador fechado em movimento) é só rolamento, bielas e um bufo fraco do ar bombeado pelos cilindros.
7. **Caldeira com estado:** pressão que cai com o consumo (cilindros, apito, injetor, bomba) e sobe com o fogo (taxa de evaporação `E_max` do preset × fogo do usuário), válvula de segurança com abertura e fechamento por histerese, injetor automático por nível. O manômetro é o mostrador principal da página.
8. **Níveis absolutos em `L_W` dB(A)** por fonte, como nos portadores (CENA 4.6), com `refDist` 7,5 m: chuff em condição de referência (regulador cheio, corte 50%, 4 chuffs/s, pressão nominal) com `lwChuff` do preset (118–130 dB(A) conforme o tamanho), apito 145, válvula de segurança 140, torneiras dos cilindros 123, sino 113, bomba de ar 104, bielas 103, injetor 94. Só a condição de referência é calibrada; a variação com corte, regulador e velocidade é a da física.
9. **Portadores:** `LocomotivaVapor` (locomotiva + tênder + N vagões: geometria e rolamento reusados de `trem.ts`/`locomotiva.ts`, composição e não herança), `gerador` para as estacionárias (Corliss com governador próprio: `governadorProprio = true`), `carro` para o Stanley (classe `CarroDireto`, sem câmbio), `trator` e `barco` como `TipoPortador` novos (extensão da 1.4, como foi `aviao`). Tabela em 4.5.
10. **Validação por gravações** (seção 3 e Apêndice A): taxa de chuffs por autocorrelação da envoltória, forma do chuff (ataque 10–90%, largura a −6 dB, decaimento a −10 dB, pico/vale por banda), bandas em dB relativas a 150–400 Hz no pico e no vale, linhas do apito e do sino, rolamento relativo. Os alvos públicos são os das gravações do Wikimedia Commons; os de vídeo privado valem como alvo interno (`tools/vapor-valida.ts`). Nenhum trecho foi ouvido: tudo veio das varreduras numéricas.
11. **Orçamento de CPU:** a rede acústica do vapor é pequena (4–8 pórticos curtos, 1 junção, 1 bico, 1 volume, 1 chaminé de ~160 amostras, 1 radiador) e o apito são até 6 linhas de 40–100 amostras: o `VaporDSP` tem de custar menos de 1/3 do Ronco por amostra (medido no passo 2 de 7).

---

## 1. Física do som a vapor

### 1.1 Caldeira e regulador

- **Pressão de trabalho** `p_cal`: 10–14 bar nas locomotivas pequenas e antigas (Baldwin métricas 12,4; GWR 57xx 13,8), 14–17 nas médias (D51 13,7; K4s 14,1; A4 17,2), 20,7 bar nas grandes americanas (844, Big Boy, Y6b: 300 psi), 8–10 nas estacionárias e tratores, 41 bar (600 psi) no Stanley. Vapor saturado a 14 bar: 198 °C; com superaquecedor, 300–400 °C.
- **Estado da caldeira** (decisão 7): `dp/dt = (E − ṁ_total)·k_cal`, com `E = fogo·E_max` (kg/s: evaporação máxima do preset, tabela 5), `ṁ_total` = cilindros + apito (0,3–0,6 kg/s aberto) + injetor (0,5–1,5 kg/s quando ligado) + bomba de ar (0,05–0,1 kg/s) + vazamentos (0,01–0,03), e `k_cal = 1 bar / (10·E_max kg)`: uma máquina que consome 1,5× a evaporação máxima perde 1 bar a cada 20 s, o que é a escala real de uma caldeira "caindo" numa subida. `fogo` é do usuário (6); o foguista automático (padrão) mantém `fogo = clamp(0,2 + (p_nom − p)/1 bar, 0, 1)`, e a pressão fica a ±0,5 bar da nominal em regime.
- **Válvula de segurança:** abre em `p_nom + 0,3` bar, fecha em `p_nom − 0,4` (blowdown); descarga 1–2 kg/s por válvula (2 válvulas nas grandes). Quando abre, a pressão cai ~0,7 bar em 5–30 s (depende de `k_cal` e do fogo) e ela fecha; com o fogo forte e a máquina parada o ciclo repete a cada 1–3 min. Som em 1.6.
- **Regulador** (`regulador` 0..1): válvula no domo com um estágio piloto. Área efetiva `A_reg(u) = A_max·(0,08·u/0,3)` para `u < 0,3` e `A_max·(0,08 + 0,92·((u − 0,3)/0,7)²)` acima. A pressão na caixa de válvulas (steam chest) é `p_chest = p_cal − Δp`, `Δp = (ṁ/(A_reg·Ψ_sub))²`-ish; na prática: `p_chest = p_cal·(1 − 0,15·(ṁ/ṁ_max)²/u_ef²)` limitado a `[0,05·p_cal, p_cal]`, onde `u_ef = A_reg/A_max`. Com o regulador cheio e a vazão máxima, `p_chest ≈ 0,85·p_cal`; com 20% de regulador e corte longo, `p_chest` cai a 30–40% e os chuffs ficam fracos e "molhados". **Atraso** do regulador: 1ª ordem de 0,4 s (o vapor enche a caixa de válvulas e os tubos de vapor, 0,3–0,5 m³).

### 1.2 Cilindro de dupla ação e distribuição

Cada cilindro tem duas extremidades (frente e trás) defasadas de 180°; os dois cilindros de uma máquina comum estão a 90°. A válvula (gaveta ou pistão) é movida pela distribuição (Stephenson, Walschaerts) e o **reverser** (`cutoff` −1..1) escolhe o sentido e o **corte** `c` = fração do curso em que a admissão fecha: `c = 0,15 + 0,70·|cutoff|` (15% a 85%; "full gear" 75–85%, cruzeiro 20–35%).

**Eventos por extremidade, em fração do curso** (válvula de pistão com Walschaerts; valores de catálogo, não se ajustam pelo som):

| corte `c` | avanço (lead, antes do PM) | admissão fecha | escape abre (release) `r` | escape fecha (compressão) `k` |
|---|---|---|---|---|
| 0,15 | 4° | 0,15 | 0,77 | 0,70 |
| 0,25 | 4° | 0,25 | 0,80 | 0,74 |
| 0,40 | 5° | 0,40 | 0,86 | 0,80 |
| 0,60 | 5° | 0,60 | 0,92 | 0,87 |
| 0,80 | 6° | 0,80 | 0,96 | 0,93 |

Entre linhas, interpolação linear em `c`. O volume de cada extremidade: `V(θ) = V_cl + A·(s/2)·(1 − cos θ)` (`V_cl` = 8–12% de `A·s`, o espaço nocivo), com a área da extremidade traseira reduzida pela haste (`A − π d_haste²/4`, 3–5%).

**Fases de uma extremidade por ciclo (uma volta):**
1. **Admissão** (do avanço até `c`): `p ≈ p_chest` (perda de 3–8% pelas passagens). Massa que entra por chuff: `m = ρ_chest·A·s·c`, `ρ = p_chest/(R_v·T)`, `R_v = 461 J/kg·K`, `T` 620 K superaquecido (470 K saturado). K4s a 14 bar e `c` 0,5: 0,65 kg; 844: 0,93; D51: 0,37; 0-6-0T: 0,23; Shay: 0,07 (tabela 5).
2. **Expansão** (de `c` a `r`): politrópica `p·V^n` constante, `n` 1,3 (superaquecido) / 1,13 (saturado). Pressão na abertura do escape: `p_rel = p_chest·(c/r)^n` (em absoluto). K4s, regulador cheio (15,1 bar abs na caixa): `c` 0,15 → 1,8 bar abs; 0,25 → 3,3; 0,5 → 6,8; 0,75 → 10,4. **É isto que decide o chuff:** acima de 1,83 bar abs (razão crítica para γ 1,3) o escape começa **engasgado** (sônico no pórtico), e a fração do chuff que fica sônica cresce com o corte.
3. **Escape** (de `r`, pelo ponto morto, até `k` do curso de volta): a área do pórtico abre com o deslocamento da válvula, `A_e(θ) = A_e,max·min(1, ((θ − θ_r)/Δθ_ab)^1,5)` com `Δθ_ab` = 20° de manivela (o pórtico abre em ~1/18 de volta), fecha simetricamente em `k`. Vazão: `ṁ_e = A_e·Ψ(p_cil/p_bp)·p_cil/√(R_v T)` com `Ψ` o fator isentrópico já existente em `acoustics/escoamento.ts` (`PSI`, limitado no engasgo), `p_bp` a pressão no tubo de descarga (rede 1.4). O cilindro esvazia com constante `τ_bd = V/(A_e,max·c_v·0,6)`: K4s `V` 0,26 m³, `A_e,max` 0,03 m², `c_v` 480 m/s → **30 ms**; 0-6-0T (0,08 m³, 0,012 m²) → 23 ms. Como o pórtico só está todo aberto por ~0,1 volta, a 1 volta/s o cilindro esvazia inteiro (chuff com pico e cauda); a 6 voltas/s (Big Boy a 110 km/h, 45 chuffs/s) o pórtico fecha antes do fim do esvaziamento: o chuff vira um rugido modulado (medido: pico/vale 9 dB a 21 chuffs/s, 6 dB a 11,5/s de longe; 15–18 dB a 3–5/s de perto, seção 3.2).
4. **Compressão** (de `k` ao avanço): o vapor residual é comprimido até ~`p_chest` (amortece o fim do curso; sem ela as bielas batem, 1.7).

**Pressão média efetiva e torque:** a forma fechada clássica `p_me ≈ p_chest·c·(1 + ln(1/c)) − p_back` (`p_back` 1,2–1,6 bar abs) serve para o esforço de tração; o torque instantâneo no eixo é `Σ_cil Σ_ext F_ext(θ)·r_manivela·sen(θ + φ)` com `F = (p_ext − p_outra_ext)·A`, e tem **4 pulsos por volta** (2 cilindros a 90°), passando por quase zero perto dos pontos mortos de cada cilindro (o que dá a patinagem rítmica e o "galope" das bielas). O esforço de tração nominal confere com a fórmula de catálogo `TE = 0,85·p_cal·d²·s/D` (2 cilindros): K4s 198 kN, 844 284, Big Boy 602, D51 ~170, 0-6-0T 100, Shay 68 kN no eixo × 2,6 de redução.

### 1.3 Quantos escapes por volta

| Máquina | Cilindros | Escapes por volta de roda | Padrão rítmico (o que a envoltória mostra) |
|---|---|---|---|
| comum (K4s, 844, D51, 0-6-0T, Baldwin) | 2 a 90° | **4** | 4 batidas; as duas extremidades de um cilindro diferem 1–2 dB (haste, avanço desigual), então há uma linha forte em 2/volta e outra em 1/volta ("o ritmo de 2 fortes 2 fracos"); medido: linhas a 1/volta, 2/volta e 4/volta (Apêndice A) |
| 3 cilindros (A4 com Gresley; Shay) | 3 a 120° | **6** (A4) / **6 por volta do eixo** (Shay: × redução 2–3,1) | 6 batidas mais parelhas; a 3 cil. há uma linha em 3/volta |
| 4 cil. GWR King (manivelas internas a 180° das externas) | 4 | **4** batidas duplas | soa como 2 cilindros, mais cheio; medido 6024: 9,5 chuffs/s a 2,4 voltas/s |
| articulada simples (Big Boy, Challenger, Allegheny) | 2 motores de 2 cil. | **8**, sem fase travada | dois padrões de 4 batidas que derivam um sobre o outro: a diferença de diâmetro de roda (0,5–2%) e a patinagem do motor dianteiro mudam a fase relativa em 10–60 s; a envoltória alterna entre "8 iguais" e "4 pares"; medido Big Boy: linhas a 4/volta de cada motor (7–9 Hz) e a 8/volta (21,5 Hz) só por trechos |
| compound Mallet (Y6b; a N&W classe A é articulada simples) | 2 AP + 2 BP | **4** (BP) em composição; **8** na partida com a válvula de simplificação (vapor vivo na BP, escape da AP direto) | em composição o chuff é da BP a 2–4 bar: mais grave, macio, "molhado"; na partida, 8 fortes |
| Garratt | 2 motores de 2 cil. | 8, sem fase travada | como a articulada simples |
| estacionária 1 cil. (Corliss, Watt) | 1 | **2** por volta do volante | ritmo 2/volta; a 60–100 rpm, 2–3,3/s |
| trator (Aveling 1 cil.; compound 2 cil.) | 1 (ou AP+BP) | 2 por volta de manivela (× redução 10–20 até a roda) | 2/volta; a 250–300 rpm de manivela, 8–10/s |
| Stanley | 2 a 90° | 4 por volta do motor (× 1,5 até o eixo) | abafado pelo condensador: um ronronar de 20–40/s a 40–60 km/h |

### 1.4 O chuff: bico, caixa de fumaça, chaminé e tiragem

**Rede acústica (reaproveita `src/acoustics/guias.ts`):**

```
ext. A1 ─ Line(0,4 m) ┐
ext. A2 ─ Line(0,4 m) ┤
ext. B1 ─ Line(0,4 m) ├─ Junction ─ Line(tubo de descarga, 0,6–1,0 m) ─ Bico ─ [Caixa de fumaça: volume V] ─ Line(chaminé, L_ch) ─ Radiator(D_ch)
ext. B2 ─ Line(0,4 m) ┘
```

- **Passagens de escape** (`Line`, 0,3–0,5 m, admitância pela área do pórtico) e **tubo de descarga** (0,6–1,0 m): comprimentos escalados por `520/c_v` como o diesel faz com o gás frio (`DIESEL.md` 0.8), com `c_v` = 480 m/s (vapor úmido a 120–150 °C na saída; a `SOUND_SPEED` de `acoustics/constantes.ts` é 520 e não muda). `kNL` (afiamento) ligado no tubo de descarga com 0,3: a frente do chuff em carga é um quase-choque, mas o vapor úmido amortece mais que o gás de escape de um V8.
- **Bico** (blast pipe nozzle): orifício de diâmetro `D_bico` 0,10 m (0-6-0T) a 0,18 m (Big Boy; 844: 0,16; D51: 0,13). Elemento não linear entre o tubo e a caixa: vazão `ṁ_j = A_bico·Ψ(p_bp/p_cx)·p_bp/√(R_v T)` (engasga em `p_bp/p_cx > 1,83`), pressão refletida para o tubo pela diferença entre a vazão que chega e a que passa (como o `Cutout` faz com a boca). **Velocidade do jato** `U_j = ṁ_j/(ρ_j·A_bico)`, limitada a `c_v` no engasgo (480 m/s); no chuff engasgado o jato sai subexpandido e faz ruído de choque (banda larga 2–6 kHz com "guincho" fraco); o chuff a corte curto sai subsônico (`U_j` 150–300 m/s) e só faz ruído de mistura.
- **Caixa de fumaça** (volume `V_cx` 1,5–8 m³, ver tabela 5): elemento de volume (capacitância acústica `C = V/(ρ c²)`), não uma linha: com a chaminé de área `A_ch` e comprimento efetivo `L_ch + 0,85·D_ch` forma um **Helmholtz a 9–14 Hz** (844: 9,7 Hz; 0-6-0T: 14 Hz). É o "soco" infrassônico de cada chuff, sentido mais que ouvido; vai ao alto-falante só acima de 20 Hz (passa-alta no canal, como a onda de pressão do CENA 2.6) e à telemetria inteiro.
- **Chaminé** (`Line` aberta nas duas pontas: a caixa é um volume grande, pressão quase livre na base): `L_ch` 1,2–1,8 m com o "petticoat" (saia interna), `D_ch` 0,33–0,60. Meia onda `f_ch = c_q/(2·L_ch)` com `c_q` 450 m/s (mistura de vapor e gás de combustão a 200–300 °C): **125–190 Hz** (844: 132; D51: 173; 0-6-0T: 188), harmônicos a 2× e 3×. Q baixo (2–3: boca larga e perdas) para o toque decair em 15–20 ms, o que a medida do ataque dos chuffs rápidos pede (11–15 ms a 21–30 chuffs/s). Esse tom é o "hoot" de cada chuff e é por isso que a banda de referência 150–400 Hz é a que domina de longe (centroide 450–770 Hz nas passagens a 15–50 m, Apêndice A).
- **Boca** (`Radiator` existente): monopolo, pressão = derivada da vazão; `fRad` pelo raio da boca, `c/(2πa)`: chaminé de 0,45 m → 243 Hz (a chaminé larga irradia o grave bem; a de 0,33 m, 330 Hz). A fonte `chamine` fica em `[x_ch, 0, z_topo + 0,3]`, omni (boca pequena perto de 2 m de onda) com eixo `[0,0,1]`.
- **Tiragem:** o jato arrasta o gás da caixa (`ṁ_tiragem ≈ 2–3·ṁ_j`) e aumenta a vazão média pela chaminé: entre chuffs há um sopro contínuo fraco (ruído de escoamento na chaminé, `∝ U_ch²`, 300–1500 Hz) que preenche o vale a −15…−20 dB do pico (medido vale/pico, 3.2). Com o regulador fechado só sobra o sopro do soprador (blower) se ligado.

**Ruído de jato do bico** (injetado na caixa, somado ao canal da chaminé depois da rede: é ruído de alta frequência que a chaminé pouco filtra):
- nível `∝ ṁ_j·M_j³` (como a turbulência da válvula do Ronco, `TECNICO.md` → Ruídos que não são o pulso), `M_j = U_j/c_v`, com o teto do engasgo; cresce sem limiar e some quando o cilindro esvazia: segue cada chuff;
- espectro de mistura por Strouhal `f_pico = 0,2·U_j/D_bico`: 844 engasgado 600 Hz, 0-6-0T 960 Hz, subsônico (200 m/s) 250–400 Hz; realizado por um passa-banda largo (Q 0,5) em `f_pico` que **desce dentro do chuff** conforme `U_j` cai (é o "pshhh" que escurece na cauda), mais um polo em 6 kHz;
- ruído de choque quando `p_bp/p_cx > 1,9`: banda 2–6 kHz (`bp` Q 1 em 3,5 kHz), peso `(p_bp/p_cx − 1,9)` limitado a 1, mais um guincho fraco (`peak` Q 8 em `0,2·c_v/D_bico`·1,5) 12 dB abaixo. Fica fora da calibração de volume, com o controle "Ar" da página.

**Envoltória do chuff** (o que a física acima tem de dar; alvos em 3.2): ataque 10–90% `≈ 0,15·T_chuff` com piso de 10 ms (pórtico abrindo em 20° de manivela + toque da chaminé), largura a −6 dB `≈ 0,25–0,30·T_chuff`, decaimento a −10 dB `≈ 0,25–0,35·T_chuff` ou `τ_bd` (o que for maior), pico/vale 15–18 dB a 3–5 chuffs/s de perto, caindo para 8–10 dB a 10–20/s e 6–8 dB acima de 20/s ou a mais de 30 m (o rolamento e a reverberação enchem o vale).

### 1.5 Rotação da roda e taxa de chuffs

`f_rev = v/(π·D_roda)`; `f_chuff = N_esc·f_rev` (coluna "escapes por volta" de 1.3, vezes a redução nas máquinas engrenadas).

| Máquina | `D_roda` (m) | 20 km/h | 60 km/h | 100 km/h | v máx |
|---|---|---|---|---|---|
| PRR K4s (4/volta) | 2,03 | 3,5 chuffs/s | 10,4 | 17,4 | 150 km/h → 26 |
| LNER A4 (6/volta) | 2,03 | 5,2 | 15,7 | 26,1 | 160 → 42 |
| D51 (4) | 1,40 | 5,1 | 15,2 | — | 85 → 21,5 |
| UP 844 (4) | 2,03 | 3,5 | 10,4 | 17,4 | 130 → 22,6 (medido saindo de Cheyenne: 6,3/s ≈ 36 km/h) |
| Big Boy (8, dois motores) | 1,73 | 8,2 | 24,6 | 41 | 110 → 45 (medido "at speed": 21,5/s ≈ 52 km/h; acelerando 7→10,5/s por motor = 25→36 km/h) |
| Y6b compound (4) | 1,47 | 4,8 | 14,4 | — | 80 → 19 |
| Shay (6 × 2,6) | 0,91 | 30 | — | — | 25 → 38 |
| Baldwin 2-8-0 métrica (4) | 1,12 | 6,3 | 19 | — | 50 → 16 |
| GWR 57xx 0-6-0PT (4) | 1,41 | 5,0 | 15,1 | — | 70 → 17,6 |
| GWR King 6024 (4 duplas) | 1,98 | 3,6 | 10,7 | 17,9 | medido na Lickey: 9,5/s ≈ 53 km/h |

O exemplo do enunciado, Pacific de 2,0 m a 100 km/h: 4,42 voltas/s × 4 = 17,7 chuffs/s.

### 1.6 Parado e em lenta: o que soa sem chuff

| Fonte (`id`) | Posição no corpo | Física e espectro | Nível `L_W` dB(A) e ritmo |
|---|---|---|---|
| `vazamentos` | caixa de válvulas e prensa-gaxetas, `[x_cil, ±1,2, 1,0]` | jatos finos de vapor por gaxetas e juntas: ruído largo 1–8 kHz (`hp` 800 + polo 5 kHz), nível `∝ p_cal`, mais o "pinga-pinga" da condensação (pulsos de 2 ms, 2–5/s, 2–4 kHz, fraco) | 85–95 (cresce com a idade `desgaste` do preset) |
| `bomba.ar` (Westinghouse 8½"/9½" cross-compound) | lateral do fumeiro, `[x_cx − 1, −1,4, 1,8]` (duas nas grandes) | ciclo de 50–90 cursos/min (0,8–1,5 Hz) enquanto carrega o encanamento (30–120 s depois de parar e após cada freada), depois intermitente (ciclo de 10–20 s a cada 1–3 min pelo governador da bomba). Por curso: **escape de vapor** pela chaminé ou pelo abafador da bomba (pulso de 60–120 ms, passa-baixa 600 Hz: o "thump"), **escape de ar** do 1º estágio (sopro de 40–80 ms, 1–4 kHz: o "psh") e **batida de inversão** (clique de 2 ms, 500–3000 Hz) | 104 (thump) / 98 (psh); o ritmo não é cravado: ±5% por curso |
| `injetor` | sob a cabine, `[x_cab, +1,3, 1,2]` | vapor e água se misturando num cone: chiado largo 2–6 kHz com um assobio (`peak` Q 6 em 3 kHz) que **afina ao pegar** (sobe 20% em 1 s) e um gorgolejo no transbordo (pulsos 5–10/s, 300–800 Hz) nos primeiros 2–3 s; liga 20–60 s a cada 2–5 min (nível de água) ou à mão | 94 |
| `seguranca` | topo da caldeira, `[x_dom − 1, 0, z_topo + 0,2]`, eixo `[0,0,1]` | jato anular engasgado (fenda 3–5 mm, 480 m/s) de 1–2 kg/s: rugido de banda larga enorme, 300 Hz–8 kHz plano até 2 kHz e −3 dB/oitava acima (choque + mistura; a fenda fina põe o Strouhal acima de 10 kHz, então o que se ouve é o jato já misturado e o abafador), com ataque de 50 ms ("pop") e corte seco | **140** (110 dB(A) a 10 m: no nível de um jato em marcha lenta; é a fonte mais alta depois do apito) |
| `apito` | domo, `[x_dom, 0, z_topo + 0,4]` | seção 1.8 | 145 (105 dB(A) a 30 m) |
| `sino` | topo da caldeira à frente, `[x_cx + 1, 0, z_topo + 0,3]` | seção 1.8 | 113 |
| `soprador` (blower) | chaminé | jato de vapor no bico com o regulador fechado, para tiragem: sopro contínuo 300–2000 Hz pela chaminé | 100, ligado à mão ou automático parado |
| `torneiras` (cylinder cocks) | cilindros, `[x_cil, ±1,3, 0,5]`, eixo `[0, ±1, 0]` | drenos abertos na arrancada (10–20 voltas): jatos de vapor + água nos cilindros, **4 sopros por volta** em fase com as admissões (cada extremidade sopra ao admitir), ruído 1–5 kHz com pulsos de água (300–800 Hz) nos primeiros | 123 (é o que faz a arrancada de perto ser um "chiado" alto e branco) |

Vazamentos, bomba e injetor continuam em movimento (somados aos chuffs); de longe somem no rolamento.

### 1.7 Mecânica: bielas, cruzetas, rodas e patinagem

- **Bielas e cruzetas** (`bielas`, `[x_cil + 1, ±1,3, 0,6]`): a cada inversão de força na biela (duas por volta por cilindro, perto dos pontos mortos, quando a compressão não segura o pistão) a folga dos mancais fecha com um **impacto** de 1–3 ms (banda 300–3000 Hz, `bp` Q 2 em 900 Hz + clique de ruído), amplitude `∝ folga·|ΔF|^0,5` onde `ΔF` é o salto de força (grande com regulador aberto e corte longo em baixa velocidade; pequeno em "drifting"). `folga` 0..1 do preset (`desgaste`): 0,2 numa máquina revisada (quase inaudível de fora), 0,8 numa cansada ("clank" audível por volta). Mais o **rolar das bielas de acoplamento**: um "whoosh" metálico 1/volta fraco (ruído 500–2000 Hz modulado pela posição da manivela, `(1 + 0,5·cos θ)`), nível 103 em regime, 95 em drifting.
- **Rodas e trilho:** reusa `FonteRolamento` (`carriers/ruido.ts`) por eixo, `L_W` 103 dB(A) a 80 km/h, `n` 3, roda `D_roda`, com os dormentes a `v/0,6` m; tênder (eixos de 20 t) 100; vagões 100 cada eixo (CENA 4.6 com `v_ref` 80 km/h em vez de 300). Medido (3.5): a composição passando a ~36 km/h fica **12–15 dB** abaixo da locomotiva trabalhando, no mesmo ponto; como o rolamento sobe 9 dB por dobro de velocidade e o chuff perde pico/vale, a 100 km/h os dois empatam e em drifting o rolamento manda.
- **Patinagem** (arrancada, trilho molhado, subida): adesão `F_ad = μ·W_ad` (`μ` 0,22 seco, 0,12 molhado, 0,30 com areia; `W_ad` = massa aderente × g). Quando o esforço de tração instantâneo (1.2, com os pulsos de torque) passa de `F_ad`, a roda **desacopla da massa do trem**: `J` cai de `J_motor + m·r²` para `J_motor` (rodeiro + bielas, 2–6 × 10³ kg·m²) e ω sobe 3–5× em 0,5–1 s. Os chuffs aceleram (4 → 15–20/s) e **perdem carga**: a caixa de válvulas não acompanha (`p_chest` cai 30–50% em 0,5 s pela limitação `A_reg`) e cada chuff sai mais fraco e curto; sem resposta, a roda chega a 30–40 km/h equivalentes com o trem parado. O maquinista (ou o usuário) fecha o regulador: a roda freia pela carga em 0,5–1,5 s, com 1–3 chuffs "engasgados" (compressão alta: batida de biela forte). Areia (`areia`) sobe `μ` em 0,3 s. Nada disso usa um "efeito de patinagem": é a inércia trocando de valor.
- **Drifting** (regulador fechado, trem andando): os cilindros bombeiam ar pelas válvulas de alívio (snifting) e drenos: um bufo fraco 4/volta (`−25 dB` em relação ao chuff de referência), bielas em `folga` com `ΔF` pequeno, rolamento, e a bomba de ar trabalhando (freio) — é o som da descida.

### 1.8 Apito e sino

**Apito** (`apito`): cada tubo (sino do apito) é um ressonador **fechado no topo**, soprado por um anel de vapor na borda da boca. Frequência fundamental `f = c_v/(4·(L + 0,3·D))` (fechado-aberto, correção de boca), `c_v` 470–500 m/s no vapor a 100–150 °C que chega ao apito depois de expandir: um tubo de 0,30 m soa a 380 Hz. **Harmônicos ímpares**: 3º a −6 ± 4 dB do fundamental, 5º a −14; 2º fraco (< −15 dB): medido D51 498 (360 / 1097 Hz: 3º a −6 dB; 2194 = 6º a −16). Chime: 3–6 tubos de comprimentos diferentes num só corpo, soprados pela mesma válvula:

| Apito | Notas medidas (Hz) e razões | Observação |
|---|---|---|
| JNR C57 180 (Commons) | 356 · 429 · 546 (1 : 1,20 : 1,53), 3 notas | tríade menor ("acorde triste" japonês); 576 e 695 secundárias |
| JNR D51 498 (Commons) | 360 · 465 · 548 (1 : 1,29 : 1,52), 3 notas | tríade maior; **afina +12% em 36 s** (338 → 381 Hz) ao aquecer |
| UP 844 em Kosse (Commons) | 281 · 344 · 408/420 (1 : 1,22 : 1,45/1,49) | dois tubos quase iguais em 407 e 420 Hz batendo a 13 Hz (o "tremor" dos chimes americanos) |
| UP 844 saindo de Cheyenne (vídeo) | 324 · 397 · 494 (1 : 1,23 : 1,52) + 524 · 646 · 795 | 15% acima da de Kosse: pressão/vapor diferente (não é Doppler) |
| Strasburg 475 (vídeo) | 290 · 327 · 364 · 415 · 477 · 593 (1 : 1,13 : 1,26 : 1,43 : 1,65 : 2,04) | 6 notas, acorde denso |
| Grand Canyon 4960 (Commons) | 278 · 313 · 346 · 386 · 448 (1 : 1,13 : 1,24 : 1,39 : 1,61) | 5 notas |

Comportamento dinâmico (decisão 5): a válvula do apito (`apito` 0..1, tecla segurável) dá a pressão de sopro `p_s = apito·p_cal`; o oscilador de cada tubo é uma `Line` fechada com realimentação `g(p_s)·tanh(·)`: abaixo do limiar (`apito` < 0,15) só chia (ruído do anel de vapor filtrado pelo tubo: o "quilling"), acima arranca em **100–300 ms** com a afinação subindo de −60 cents (vapor ainda frio no tubo e sopro fraco) até a nota, e o nível cresce com `p_s^1,5` até saturar; ao soltar, decai em 150–250 ms com a afinação caindo 30 cents. **Aquecimento**: `c_v` do tubo parte de 0,90× (tubo frio, vapor condensando) e vai a 1,0 com constante de 15 s enquanto soprado, voltando a 0,95 em 60 s parado (medido D51: +12%). Consome 0,3–0,6 kg/s (cai a pressão num apito longo). Nível `L_W` 145 dB(A), diretividade `[0, −1, −3, −6, −9, −12, −14]` com eixo `[1,0,0]` e expConv 2 (o apito aponta para a frente/cima).

**Sino** (`sino`): sino de bronze de 0,3–0,4 m, balançado por ar ou à mão: **2,0–2,3 batidas/s** (medido Big Boy: 2,24/s; UP 844 ~1 batida/s com sino a ar mais lento), batidas alternadas (lado a lado, ±2 dB). Parciais medidos (Big Boy, 606 Hz fundamental): 1 : 2,16 : 3,53 : 5,2 : 7,05, amplitudes 0 / −2 / −5 / −4 / −8 dB, decaimentos T60 4 s / 2,5 / 1,5 / 1 / 0,7. Preset escolhe `f_sino` (500–750 Hz). Síntese modal (5 osciladores amortecidos excitados por um impulso filtrado), `L_W` 113 dB(A).

### 1.9 Regimes (o que a página chama de cenários)

| Regime | Comando | O que soa |
|---|---|---|
| **parada, pressão** | regulador 0, fogo | vazamentos, bomba de ar carregando (1 Hz) por 1–2 min, injetor periódico, válvula de segurança quando o fogo passa (ciclo 1–3 min), sino ao se preparar, apito |
| **arrancada** | reverser 80%, regulador 0,2 → 0,6 em 5 s, torneiras abertas 15 voltas, areia se patinar | chuffs separados, fortes (release 8–10 bar, engasgados), chiado branco das torneiras, bielas batendo (ΔF grande), patinagem com 2–3 surtos de 15–20 chuffs/s decaindo; rolamento sobe |
| **aceleração** | reverser recua 80 → 35% conforme v sobe | chuffs aceleram 1 → 10/s e encurtam, pico/vale cai de 18 para 10 dB, o jato fica subsônico, a caldeira cai 1–2 bar (manômetro) e recupera |
| **cruzeiro** | reverser 20–30%, regulador 0,7–1 | 10–25 chuffs/s, rugido modulado 6–9 dB, rolamento quase no nível do escape; manômetro estável |
| **drifting** | regulador 0, reverser 40% | rolamento, bielas, bufo fraco 4/volta, bomba de ar nas freadas |
| **subida pesada** (Lickey) | reverser 50–60%, regulador 1 | chuffs longos e fortes a 8–10/s, segurança nunca abre, caldeira caindo 0,05 bar/s, patinagem ocasional com areia |

---

## 2. Máquinas estacionárias, trator, carro e barco

O mesmo `VaporDSP` com outra geometria (cilindros, redução, para onde vai o escape) e outro portador. O que muda de verdade em cada família:

### 2.1 Máquina de moinho (Corliss, Watt) a 60–100 rpm

- **Cilindro horizontal de dupla ação**, 1 ou 2 (tandem/cross-compound), volante de 5–8 m e 20–60 t, **2 escapes por volta** por cilindro: 2,0–3,3 chuffs/s a 60–100 rpm. O escape vai para um **condensador** (quase silencioso: só o bombear da bomba de ar do condensador) ou para a atmosfera por uma chaminé curta (chuffs macios, 2–4 bar de release: nunca engasga). Preset escolhe `escape: 'condensador' | 'atmosfera'`.
- **Distribuição Corliss:** quatro válvulas rotativas com engate de disparo (trip gear) e amortecedores (dashpots): a cada fechamento de admissão a válvula cai e o dashpot dá um **clique** seco (2–3 ms, 1–4 kHz), 2 por volta por cilindro; é o som característico de uma casa de máquinas Corliss, junto com o zumbido do volante e das correias. Medido (máquina de 2 cilindros a 57 rpm, Apêndice A): 3,7–3,9 pulsos/s (4/volta), centroide 1,6–2,4 kHz (cliques), pico/vale 10–13 dB, lento (1/volta) bem marcado.
- **Governador de esferas (Watt/Porter):** mantém a rotação alterando o **corte** (Corliss) ou a borboleta (Watt). `VaporDSP.governadorProprio = true` neste uso: o portador `gerador` manda `rpmAlvo` (ex.: 75 rpm) e degraus de carga (CENA 4.4), e o governador PI do motor (ganho 0,02 de corte por % de erro, 0,01/s, limite 10–60% de corte) responde com queda de 2–4% num degrau de 50% e volta em 5–10 s (volante grande: `J` 2–5 × 10⁴ kg·m²). O "hunting" de um governador mal ajustado (±3% a 0,1–0,2 Hz) é um parâmetro (`hunting`), desligado por padrão.
- **Correias e eixo de transmissão** (`correias`): ruído largo 200–2000 Hz com o "tapa" da emenda da correia 1/volta da polia (`f = f_rev·D_volante/D_polia`), nível `L_W` 95 dB(A), mais um zumbido de engrenagens se houver. Pode ser desligado (máquina em museu, sem carga).
- Portador: `gerador` (casa de máquinas, corpo 1 segmento 12 × 6 × 6 m, `dentro: true` para as fontes mecânicas, `massaSuperficial` 30 de alvenaria: de fora só se ouve o escape e um ronco abafado).

### 2.2 Trator a vapor (Aveling & Porter, Fowler, Burrell)

- Caldeira locomóvel horizontal, 1 cilindro (8 nhp: 8 × 10 in) ou compound (6,5 e 10 × 10 in), 150–180 psi, manivela a 150–300 rpm, **redução por engrenagens de dentes retos** (2 marchas, 10–20:1 até a roda de 1,5–1,7 m): a 8 km/h a manivela gira a ~320 rpm (5,3/s) e há 10–11 escapes/s, curtos e macios (release 2–4 bar); parado em "lenta", 60–90 rpm (2–3 escapes/s). O escape sai pela chaminé alta (1,4 m, 0,30 m): tubo meia-onda a ~160 Hz.
- **Engrenagens de dentes retos** (`engrenagens`): tom de passagem de dente `f = rpm_manivela/60 × z_pinhão` (z 12–16: 60–80 Hz a 300 rpm) com harmônicos até 1 kHz, nível `L_W` 100 dB(A) em movimento, ∝ torque; é o "uivo" grave do trator em marcha. Volante leve (1 t): o pulso de torque 2/volta vibra o conjunto.
- Medido (Aveling & Porter nº 11630 em dia aberto, Apêndice A): linhas de 1,16/1,38 Hz (manivela a ~70–80 rpm em lenta) com harmônicos, pulsos 2/volta, banda 400–1 kHz **+8 dB** sobre 150–400 (chaminé curta + engrenagens: espectro mais claro que o de uma locomotiva), centroide 735–760 Hz, pico/vale 8 dB.
- Portador `trator` (extensão de `TipoPortador`): corpo 1 segmento 6,5 × 2,4 × 3,5 m, massa 10–12 t, `cd` 1,0, rolamento de rodas de ferro em estrada (`FonteRuido` largo 100–800 Hz, `L_W` 95 a 8 km/h, `n` 3), sem câmbio automático: marcha 1/2 pelo usuário, parada = manivela em lenta com embreagem solta.

### 2.3 Carro a vapor (Stanley)

- Caldeira tubular vertical de 41 bar, **queimador** de querosene/gasolina vaporizado: um maçarico de 20–40 kW que **ruge** continuamente (`queimador`: ruído 100–600 Hz com corcova em 200 Hz, `L_W` 95 dB(A) com o fogo alto, 85 no piloto, `dentro: true` sob o capô; é o som mais contínuo do carro parado), mais um assobio do vaporizador (2–4 kHz, fraco).
- Motor de 2 cilindros a 90° (4 × 5 in, 20 hp) **montado no eixo traseiro** com engrenagem 1,5:1: 4 escapes por volta do motor = 6 por volta da roda (0,91 m): 23/s a 40 km/h, 58/s a 100. O escape passa pelo **condensador** (carros de 1915+) e por um abafador: o que sobra é um ronronar grave 20–60 Hz de modulação (quase sem chuff audível, pico/vale 2–4 dB) com um chiado de vapor; sem condensador (modelos antigos) um "pant" macio sob o carro. `escape: 'condensador'` por padrão.
- **Bombas** (água, óleo, combustível) acionadas pelo motor: cliques 1–2/volta fracos; **hiss** permanente das gaxetas (pressão alta) `L_W` 88.
- Partida: sem motor de arranque; aquecimento de 10–20 min (fora da página: começa quente). Não há câmbio nem embreagem: `CarroDireto` (decisão 9), massa 1,2 t, `cd` 0,6, relação fixa, rolamento de pneus do carro (`carro.ts` tem as fontes de pneu desligadas por padrão no Ronco; aqui ligadas).

### 2.4 Barco a vapor (rodas de pás e hélice)

- **Rodas de pás** (`paddle`): máquina de 2 cilindros compound diagonal (ou oscilante) a 30–50 rpm direto no eixo das rodas, escape para o condensador (silencioso) ou pela chaminé (vapor de lanchas pequenas, não condensante: 2–4 chuffs/s macios). O que domina é a **roda**: `N_pás` (8–12) × `f_rev` tapas na água (`pas`: 5–8 tapas/s a 40 rpm; cada tapa um pulso de 100–200 ms de ruído de respingo 200–2000 Hz com um "tum" de 60–120 Hz, `L_W` 105 dB(A)), mais o rangido do mecanismo 1/volta e o arrastar da água na caixa da roda (ruído contínuo 100–800 Hz ∝ v²). O cilindro de BP grande (0,9 × 1,2 m) a 2–4 bar dá um chuff grave e lento (chaminé de 8 m: 28 Hz, infrassônico; o que se ouve é o sopro).
- **Hélice** (`helice`): máquina alternativa de 2–3 cilindros (compound/tripla expansão) a 100–300 rpm, condensante: som de casa de máquinas (bielas, bombas, cliques) e a hélice como `FonteHelice` já existente (`carriers/helice.ts`) com `BPF = n_pás × rpm/60` e cavitação (ruído 1–10 kHz ∝ (rpm/rpm_cav)^4 acima de 70% da rotação).
- **Apito de navio:** 1 nota grave (150–300 Hz, tubo de 0,4–0,8 m, "cilíndrico") com ataque de 300–500 ms e sopro forte; `L_W` 150 (ouve-se a 3 km).
- Portador `barco` (extensão): corpo 1 segmento 20–60 × 6 × 6 m sobre `solo: 'agua'`, `cd` 0,5 na água (arrasto `∝ v²` com `R = 0,5·ρ_água·S_molhada·C_f·v²`, `C_f` 0,003), massa 100–500 t, sem rolamento.

---

## 3. Alvos medidos nas gravações

Método (como `TECNICO.md` → Validação, `DIESEL.md` Apêndice A e `RADIAL.md` 4): WAV mono 48 kHz, Welch 4096/8192, bandas em dB relativas a 150–400 Hz, centroide 100–8000 Hz. Acrescentado para o vapor: **envoltória** RMS de 10 ms da banda 200–2500 Hz, decimada a 200 Hz e sem a tendência (média móvel de 1,5 s); **linhas da envoltória** (FFT, 0,8–40 Hz, proeminência sobre a mediana); **período do chuff** = a linha mais alta cuja autocorrelação da envoltória no atraso `1/f` passa de 0,25 (as linhas em 1/volta e 2/volta são o ciclo, as em 4/volta o chuff); **forma do chuff** com picos à distância mínima `0,6/f_chuff` (envoltória 150–3000 Hz, janela `0,08/f_chuff` limitada a 4–12 ms): ataque 10–90% do vale ao pico, largura a −6 dB, decaimento a −10 dB, pico/vale no total e por banda (150–400, 400–1500, 1500–6000); **espectro no pico** (janelas de ±12% do período em torno dos picos) e **no vale**; **linhas tonais** (Welch 32768, pico sobre a mediana local de 301 pontos, > 18 dB) para apito e sino. Scripts em `/tmp/claude-1000/-home-ezenere-Documents-Projects-Engine/e31418c8-04d3-4470-8423-a94efb88e841/scratchpad/vapor-analise/` (`mapa.py`, `mapa2.py`, `chuff2.py`, `apito.py`, `bomba.py`, `bandas.py`), a portar para `tools/vapor-valida.ts` no passo 1 de 7. Arquivos em `…/scratchpad/real2/vapor/wav/` (índice `…/real2/INDEX.md`, metadados `meta.jsonl`). Nenhum trecho foi ouvido: os trechos vieram do mapa de 4–8 s (nível, linhas da envoltória, tonalidade) e as descrições do Commons dizem o que é cada máquina. A gravação `WWS_StationaryEngine.ogg` é de um **motor estacionário a gasolina** (descrição do Commons) e ficou fora.

### 3.1 Taxa de chuffs vs velocidade

| Trecho | Máquina | chuff/s medido | ciclo (volta) | → velocidade pela roda | Alvo do simulador |
|---|---|---|---|---|---|
| Commons `Steam_engine` 2–20 s / 24–44 s | 0-4-0 de bitola estreita subindo (Huntsville, ON), roda ~0,7 m | 3,3 → 4,3 (acelerando 0,03 chuff/s²) | 2/ciclo | ~0,8–1,1 volta/s ≈ 6–9 km/h | 4/volta a `v/(πD)` |
| vídeo 1225 (2-8-4, D 1,75 m) 0–14 / 14–30 s | Pere Marquette 1225 | 1,44 → 2,09 (ciclo = chuff: cada pulso forte 1/volta) | — | 0,36–0,52 volta/s ≈ 7–10 km/h… ou 4/volta se a linha for a volta: 28–40 km/h | ambíguo: fica como alvo de forma, não de taxa |
| vídeo Big Boy "at speed" 28–38 s | 4014, D 1,73, 8/volta | **21,5** (linhas em 7,5 e 12 também) | — | 2,7 volta/s ≈ **52 km/h** | 8/volta, dois motores sem fase |
| vídeo Big Boy acelerando 48–80 / 168–184 / 216–240 s | 4014 | 7,1 (acelerando 5 → 8,8) / 9,1 / 5,25 (+10,5) | — | por motor (4/volta): 1,8 → 2,2 volta/s ≈ 35–43 km/h | idem; a linha de 8/volta aparece só por trechos (fase relativa) |
| vídeo UP 844 saindo de Cheyenne 96–120 s | 844, D 2,03 | **6,3** (linhas 5,8/6,1/6,4: acelerando) | 1/volta em 1,6 | 1,6 volta/s ≈ **36 km/h** | 4/volta |
| vídeo "enchanting chuff" 24–48 / 100–140 s | locomotiva não identificada (2 cil.) | 3,2 (acelerando 2,5 → 3,9) / **5,54 ± 0,05** por 40 s | 2,78 (2/ciclo) | — | ritmo 2 fortes 2 fracos: linha em 2/volta a −10 dB da de 4/volta |
| Commons 6024 Lickey 40–72 / 128–160 s | GWR King (4 cil., 4 batidas duplas), D 1,98 | **9,5** / 8,7 (afastando, Doppler −8%) | 4,64 (2/ciclo) | 2,4 volta/s ≈ **53 km/h** | 4/volta |
| vídeo SP 4449 passando 32–48 s | GS-4, D 2,03 | 11,5 | — | 2,9 volta/s ≈ 66 km/h | 4/volta |
| vídeo Strasburg 475 40–80 s | 4-8-0, D 1,42 | 3,0 (linhas 1,8/3,0/5,0/10,5) | — | 0,75 volta/s ≈ 12 km/h | 4/volta |
| Commons Grand Canyon 4960 saindo 16–27 s | 2-8-2, D 1,63 | linhas 3,2/4,2/5,6 (pulsos rápidos a 30 Hz são o apito/sino) | — | ~1 volta/s ≈ 18 km/h | — |

**Alvo:** `f_chuff = N_esc·v/(π·D)` exato por construção; o teste mede a linha da envoltória de um render a velocidade fixa e exige `±2%` e a proeminência da linha de 4/volta ≥ 15 dB sobre a mediana a 3–10 chuffs/s. A linha de 2/volta (desigualdade das extremidades) tem de existir a −5…−15 dB da de 4/volta (medido: 1225 −4 dB, "enchanting" −10 dB, 6024 −3 dB).

### 3.2 Envoltória de um chuff

| Trecho (chuff/s, distância deduzida) | ataque 10–90% (ms; mediana [p10..p90]) | largura −6 dB | decaimento −10 dB | pico/vale total | p/v 150–400 | p/v 400–1500 | p/v 1500–6000 | CV entre picos |
|---|---|---|---|---|---|---|---|---|
| 0-4-0 Huntsville, 3,3/s, perto | 62 [31..122] | 77 | 75 [33..110] | **15,4** | 16,4 | 16,5 | 9,8 | 2,6 dB |
| idem, 4,3/s | 35 [23..67] | 65 | 60 [41..102] | **17,8** | 19,1 | 20,1 | 13,6 | 1,1 |
| 1225, 1,4/s (pulso forte 1/volta), perto | 220 | 57 | 89 [46..114] | 18,1 | 19,5 | 16,4 | 17,2 | 1,2 |
| "enchanting", 3,2/s, perto | 135 [47..249] | 61 | 74 [50..102] | 15,9 | 13,9 | 17,9 | 12,8 | 2,1 |
| "enchanting", 5,5/s | 38 [21..74] | 62 | 65 [45..90] | **14,3** | 15,3 | 15,5 | 13,3 | 0,8 |
| UP 844, 6,3/s, 20–30 m | 49 [20..86] | 115 | 91 [54..127] | 7,8 | 8,1 | 7,5 | 10,2 | 3,6 |
| Big Boy, 7,1/s, 30 m | 50 [22..88] | 99 | 72 [37..110] | 7,3 | 11,1 | 7,0 | 2,9 | 2,2 |
| Big Boy, 9,1/s | 43 [12..75] | 63 | 52 [25..85] | 8,1 | 11,5 | 6,8 | 4,0 | 4,3 |
| 6024 Lickey, 9,5/s, ~20 m | 33 [15..62] | 46 | 52 [21..79] | **10,6** | 13,6 | 9,4 | 6,4 | 3,6 |
| 6024 afastando, 8,7/s, > 100 m | 38 | 78 | 66 | 7,8 | 10,5 | 7,3 | 6,9 | 1,9 |
| SP 4449, 11,5/s, passagem | 27 [8..64] | 68 | 38 [10..74] | 6,2 | 8,5 | 6,7 | 4,8 | 2,4 |
| Big Boy, 21,5/s, perto | **15** [3..33] | 16 | 17 [6..33] | 9,4 | 13,0 | 9,1 | 5,5 | 2,5 |
| Grand Canyon 4960 (apito+sino por cima), pulsos a 30/s | 11 | 23 | 15 | 6,9 | 12,3 | 7,3 | 4,1 | 7,0 |

**Leitura e alvos:**
- Ataque 10–90% `= 0,15·T ± 0,05·T`, com piso de **10–15 ms** (medido 15 ms a 21,5/s, 11 ms a 30/s): a 3–4/s, 35–60 ms; a 9/s, 30–45; a 20/s, 12–18. Teste: render a 4, 9 e 21 chuffs/s, ataque mediano dentro de ±30% desses valores.
- Largura a −6 dB `= 0,25–0,30·T` (65–77 ms a 3,3–4,3/s; 46–63 a 9/s; 16 a 21,5/s): ±30%.
- Decaimento a −10 dB `= 0,25–0,35·T` (60–75 ms a 3,3–4,3/s; 52 a 9,5/s; 17 a 21,5/s): ±30%. A 1,4/s (1225) o decaimento não cresce com `T` (89 ms): é o esvaziamento do cilindro (`τ_bd`), não a cinemática, que manda em baixa velocidade: o modelo tem de dar `max(0,3·T, 2,5·τ_bd)`.
- Pico/vale: **15–18 dB** a 3–6 chuffs/s de perto (< 10 m); **10–11 dB** a 9–10/s a ~20 m; **7–8 dB** a 6–9/s a 30 m ou mais, e a 11–12/s; **9 dB** a 21/s de perto. Tolerância ±3 dB no cenário equivalente (distância e taxa). Na banda 150–400 o contraste é sempre o maior (o tom da chaminé é só do chuff) e em 1,5–6 kHz o menor (vazamentos, rolamento e jato enchem o vale): a diferença p/v(150–400) − p/v(1,5–6k) vale **3–7 dB** de perto a baixa velocidade e **5–8 dB** a mais de 20 m.
- Variação entre picos (desvio do nível de pico, "CV"): 1–3 dB em marcha regular; 4–8 dB quando o padrão de 4 desiguais ou dois motores (Big Boy 216–240 s: 8,3 dB) aparece. O simulador precisa de 1–2 dB de variação aleatória por chuff (pressão na caixa de válvulas, água arrastada) mais a desigualdade sistemática entre extremidades.

### 3.3 Espectro do chuff e do vale (dB rel. 150–400 Hz)

| Trecho | janela | 60–150 | 400–1k | 1–2,5k | 2,5–6k | 6–12k | centroide |
|---|---|---|---|---|---|---|---|
| 0-4-0 Huntsville 3,3/s (perto, subindo) | pico | −5,0 | +1,0 | −4,4 | −3,2 | −10,7 | 1189 |
| | vale | +2,7 | −1,9 | −3,5 | −2,1 | −7,7 | 1378 |
| idem 4,3/s | pico | −10,6 | +2,2 | −1,8 | −1,3 | −6,1 | 1563 |
| | vale | −3,5 | −2,1 | −2,6 | −0,8 | −4,3 | 2005 |
| 1225 (perto, grave muito presente) | pico | +4,8 | −5,0 | −11,8 | −16,5 | −22,2 | 337 |
| | vale | +8,5 | −6,1 | −12,5 | −18,3 | −23,1 | 284 |
| "enchanting" 5,5/s (perto) | pico | −14,3 | +3,7 | +1,3 | −6,6 | −10,8 | 1046 |
| | vale | −10,0 | +1,9 | +0,4 | −3,1 | −4,8 | 1400 |
| UP 844 saindo, 6,3/s (20–30 m) | pico | −11,2 | +4,0 | +4,9 | +1,2 | −12,1 | 1489 |
| | vale | −9,1 | +3,7 | +2,9 | −1,5 | −14,3 | 1242 |
| Big Boy 7,1/s (30 m) | pico | +0,4 | −5,5 | −4,2 | −4,1 | −11,5 | 1043 |
| | vale | +2,0 | −5,1 | −1,8 | −0,6 | −8,5 | 1443 |
| Big Boy 21,5/s (perto) | pico | −4,1 | −3,7 | −8,9 | −15,1 | −22,4 | 479 |
| | vale | −1,6 | −1,9 | −5,5 | −11,2 | −18,4 | 630 |
| 6024 Lickey 9,5/s (~20 m) | pico | −11,7 | −0,9 | −3,5 | −9,9 | −25,1 | 771 |
| | vale | −8,4 | −1,9 | −4,2 | −10,1 | −23,4 | 736 |
| 6024 afastando (> 100 m) | trecho | −5,1 | 0,0 | −2,1 | −21,9 | −32,7 | 629 |
| SP 4449 passagem 66 km/h | pico | −6,1 | +1,4 | −1,9 | −15,6 | −28,4 | 687 |
| Strasburg 475, 12 km/h (~15 m) | pico | −2,9 | −6,6 | −11,3 | −12,6 | −19,2 | 460 |
| | vale | +0,8 | −5,9 | −8,5 | −10,0 | −14,4 | 561 |

**Leitura e alvos (cenários do simulador ↔ microfone):**
- **Locomotiva trabalhando, de perto (5–10 m, 3–6 chuffs/s)**: 400–1k **+1 ± 3**, 1–2,5k **−2 ± 3**, 2,5–6k **−3 ± 4**, 6–12k **−8 ± 4**, centroide **1 100–1 600 Hz**: o jato engasgado do bico e as torneiras/vazamentos dão um chuff claro; o grave (60–150) fica −5…−14 (o Helmholtz da caixa está abaixo de 20 Hz e o tom da chaminé em 125–190 Hz cai dentro da banda de referência). O 1225 (+5 em 60–150, centroide 337) é um microfone colado na máquina com grave de vento: fica como limite inferior, não como alvo.
- **A 20–30 m, 6–10 chuffs/s** (844, Big Boy, 6024): 400–1k **−1 ± 4**, 1–2,5k **−3 ± 4**, 2,5–6k **−6 ± 5**, 6–12k **−15 ± 6**, centroide **750–1 500**: a absorção do ar e o solo já tiram o agudo; a Cena faz isso sozinha (CENA 2.3–2.4), então o alvo de perto é o que o `VaporDSP` tem de dar, e este é o teste de passagem.
- **Passagem a 50–70 km/h (4449, 6024 afastando)**: 2,5–6k **−16 … −22**, 6–12k **−28 … −33**, centroide 630–690: rugido grave; aqui a Cena a 30–100 m explica os −20 dB de agudo.
- **Vale entre chuffs:** sempre 2–4 dB **mais claro** que o pico em termos relativos (centroide 10–30% maior: o pico é dominado pelo tom da chaminé; o vale é vazamento, jato residual, rolamento). Teste: centroide(vale)/centroide(pico) entre 1,05 e 1,35 nos renders de perto.
- **Acima de 6 kHz** o modelo usa a física (jato de choque e vazamentos) sem alvo medido: os OGG/WebM do Commons e o AAC dos vídeos cortam ou comprimem acima de 10–12 kHz e os microfones de celular não são confiáveis. Tolerância em 6–12k só ±6 dB.
- **Rugido de alta velocidade** (Big Boy 21,5/s, perto: centroide 479, 2,5–6k −15): a 20+ chuffs/s o jato fica subsônico (corte curto) e o espectro escurece 8–12 dB em 2,5–6 kHz em relação a 4 chuffs/s em corte longo; o modelo dá isso pela queda de `p_rel` com o corte, e o teste compara os dois renders (corte 70% a 4/s vs 20% a 20/s): Δ(2,5–6k) = −10 ± 4 dB.

### 3.4 Apito e sino

Tabela das notas em 1.8. Alvos: cada tubo do preset com a frequência a ±1,5% do medido (D51 498, C57 180, UP 844 Kosse); 3º harmônico a −6 ± 4 dB e 2º abaixo de −15 dB; ataque 100–300 ms (10–90% do nível); afinação subindo 8–12% nos primeiros 30 s de uso com o tubo frio (D51) e ≤ 2% depois; dois tubos quase iguais batendo a 10–15 Hz no 844 (407/420 Hz: a modulação de 13 Hz da envoltória da banda 350–450 Hz tem de aparecer com profundidade ≥ 6 dB). Sino: 2,0–2,3 batidas/s, parciais 1 : 2,16 : 3,53 : 5,2 : 7,05 (±3%), T60 do fundamental 3–5 s.

### 3.5 Rolamento, composição e o que fica entre os chuffs

| Trecho | o que é | nível (dBFS) | 60–150 | 400–1k | 1–2,5k | 2,5–6k | 6–12k | centroide |
|---|---|---|---|---|---|---|---|---|
| UP 844 Cheyenne 96–120 s | locomotiva trabalhando, 36 km/h | −18,2 | −10,9 | +3,4 | +3,6 | −0,5 | −13,8 | 1362 |
| UP 844 Cheyenne 44–62 s | **os vagões passando** depois dela (mesma velocidade, mesmo microfone) | **−32,2** | −10,2 | −2,5 | −6,7 | −14,9 | −28,3 | 560 |
| Big Boy 48–80 s | locomotiva acelerando 35–43 km/h | −21,2 | +1,4 | −5,3 | −2,9 | −2,4 | −10,1 | 1216 |
| Big Boy 88–100 s | composição passando | **−34,0** | −11,2 | −4,9 | −7,2 | −8,2 | −9,8 | 961 |
| 6024 Lickey 0–16 s | chegando (> 200 m) | −42,5 | −3,0 | +1,0 | −1,2 | −13,9 | −21,1 | 727 |
| 6024 Lickey 40–72 s | passando trabalhando | −17,0 | −10,7 | −1,0 | −3,5 | −9,7 | −25,8 | 771 |

**Alvo:** no render de uma passagem a 36–43 km/h com 10–15 vagões, o `L_Aeq` dos vagões (rolamento a `L_W` 100 dB(A) por eixo a 80 km/h, `n` 3) fica **13 ± 3 dB** abaixo do da locomotiva trabalhando (regulador 1, corte 40%), no mesmo ponto a 7,5–20 m; o espectro do rolamento com centroide 550–1000 Hz. A 100 km/h a diferença cai para 0 ± 4 dB (lei `n` 3 do rolamento: +14 dB de 36 a 100 km/h; o chuff a corte curto sobe ~4 dB em potência média pela taxa mas perde contraste). Bomba de ar e sino no trecho parado: periodicidade de 0,6–1,1 Hz nas bandas 600–4000 Hz com proeminência ≥ 15 dB (UP 844 64–88 s: linhas 0,6/0,7/1,0 Hz a 21–24 dB), sino a 2,24 batidas/s com parciais tonais ≥ 25 dB sobre a mediana (Big Boy 16–40 s).

### 3.6 Tolerâncias (resumo do portão de validação)

| Medida | Tolerância |
|---|---|
| taxa de chuffs (linha da envoltória) | ±2% do `N_esc·v/(πD)`; linha de 4/volta ≥ 15 dB |
| linha de 2/volta relativa à de 4/volta | −5 … −15 dB |
| ataque, largura, decaimento | ±30% dos valores de 3.2 na taxa correspondente |
| pico/vale | ±3 dB no cenário (taxa e distância) correspondente |
| bandas no pico, de perto | ±3 dB (400–1k, 1–2,5k), ±4 (2,5–6k), ±4 (6–12k; ±6 acima de 6 kHz) |
| centroide no pico | ±25% |
| centroide vale/pico | 1,05–1,35 |
| escurecimento de corte curto (Δ 2,5–6k entre 70%/4 Hz e 20%/20 Hz) | −10 ± 4 dB |
| apito: notas | ±1,5%; 3º harmônico −6 ± 4; ataque 100–300 ms; batimento de 13 Hz no 844 ≥ 6 dB |
| sino | 2,0–2,3 batidas/s; parciais ±3%; T60 3–5 s |
| rolamento da composição vs locomotiva (36–43 km/h) | −13 ± 3 dB |
| níveis absolutos (4.6) | ±3 dB na condição de referência de cada fonte |

---

## 4. Interfaces: `VaporDSP`, comando, fontes e portadores

### 4.1 `VaporDSP implements Motor` (`src/engines/vapor/dsp.ts`)

```ts
export class VaporDSP implements Motor {
  readonly familia = 'vapor';
  readonly fontes: FonteSonora[];          // montadas em configurar() a partir do preset (4.3)
  readonly eixo: EixoSaida;                // omega da RODA (ou do eixo de manivelas × 1/redução, ver 4.4), torque líquido, J_motor
  readonly estado: EstadoMotor;            // 'desligado' = caldeira fria; 'partida' = levantando pressão; 'funcionando' = com pressão
  readonly governadorProprio: boolean;     // true só no uso 'estacionario' (governador de esferas sobre o corte)
  constructor(fs: number);
  configurar(preset: PresetVapor, fs: number): void;
  comandar(c: ComandoMotor & ComandoVapor): void;
  acoplar(carga: Carga | null): void;
  processar(saidas: Float32Array[], n: number): void;
  telemetria(): TelemetriaVapor;
  // além do contrato: o laço de amostra e os eventos de válvula são privados; `tap` (como no Ronco) expõe sinais para as sondas de calibração
}

/** extensão de ComandoMotor (campos opcionais; os outros motores os ignoram) */
export interface ComandoVapor {
  regulador: number;        // 0..1 (substitui `acelerador`; se só `acelerador` vier, regulador = acelerador)
  cutoff: number;           // −1..1: reverser; sinal = sentido, |c| → corte 15–85% (1.2)
  apito: number;            // 0..1 abertura da válvula do apito (tecla segurável: a página manda 0/1 ou o valor do slider)
  sino: boolean;            // sino balançando
  areia: boolean;           // areeiros abertos
  torneiras: boolean | 'auto';   // drenos dos cilindros (auto: abertos nas primeiras 15 voltas depois de parado)
  fogo: number | 'auto';    // 0..1 taxa de fogo; 'auto' = foguista (1.1)
  injetor: boolean | 'auto';
  bombaAr: boolean | 'auto';
  soprador: boolean | 'auto';
  freio: number;            // 0..1 (o portador também recebe; o motor usa para a bomba de ar e para o drifting)
  simplificacao?: boolean;  // compound: válvula de partida (vapor vivo na BP)
}

export interface TelemetriaVapor extends TelemetriaMotor {
  rpm: number;              // da roda
  pCaldeira: number;        // bar manométrico
  pChest: number;           // bar, caixa de válvulas
  pRelease: number;         // bar abs no último escape (média dos 4)
  corte: number;            // 0,15..0,85
  chuffsPorS: number;
  vapor: number;            // kg/s consumido
  evaporacao: number;       // kg/s
  esforco: number;          // N, esforço de tração médio na roda
  adesao: number;           // N, limite de adesão atual
  patinando: boolean;
  seguranca: boolean; injetor: boolean; bombaAr: boolean; torneiras: boolean;
  fApito: number[];         // Hz de cada tubo (0 quando mudo)
}
```

- **Laço de amostra:** a cinemática das manivelas avança com `ω` (`θ += ω·dt`); a cada amostra, para cada extremidade: volume, evento de válvula (tabela 1.2 interpolada no corte), pressão (admissão: aproxima `p_chest` com 1ª ordem de 3 ms; expansão/compressão: politrópica incremental `dp = −n·p·dV/V`; escape: `dp = −(ṁ_e·R_v·T/V)·dt`), vazão de escape `ṁ_e` por `A_e(θ)·Ψ·p/√(R_v T)` (o `flow`/`PSI` do pacote `acoustics`, com `GAM` 1,33, próxima o bastante de 1,3). A vazão vira pressão na `Line` da passagem (`Z·ṁ_e·(T/T_ref)`, a mesma convenção do Ronco), a rede 1.4 roda uma vez por amostra, e o `Radiator` da chaminé dá o canal `chamine`. O ruído de jato é calculado por amostra com `ṁ_j` e `M_j` do bico (atualizados por amostra: são estados da rede). Torque: `Σ F·r·sen` por extremidade, uma vez por amostra (é barato), integração `ω += (T_motor − T_carga − T_atrito)/J·dt` com `J = J_motor + carga.inercia` ou só `J_motor` patinando (1.7).
- **Controle a cada 64 amostras:** caldeira (1.1), regulador (1ª ordem 0,4 s), reverser (1ª ordem 1,5 s: o maquinista não bate o reverser), estado dos auxiliares (bomba, injetor, segurança, torneiras, soprador), governador (estacionário), adesão e patinagem, aquecimento do apito, telemetria.
- **Dois motores (articulada):** o preset traz `motores: 2`; o DSP instancia dois conjuntos de cilindros com `ω` próprios (`ω_1 = ω·(1 + ε)`, `ε` = `derivaFase` 0,5–2% sorteado por semente, e patinagem independente: o dianteiro perde adesão primeiro, com `W_ad` menor em 5–10%) alimentando a **mesma** caixa de fumaça e chaminé (os dois tubos de descarga juntam numa junção antes do bico, como no Big Boy; o Y6b compound tem o receptor entre AP e BP: uma `Line` de 2 m com volume, e as BP é que escapam).
- **Shay / engrenagens:** `eixo.omega` continua sendo a roda; o eixo de manivelas gira `redução×`; as fontes mecânicas e o chuff usam o eixo de manivelas.
- **Estacionário:** `governadorProprio = true`; `comandar({ rpmAlvo })` do portador `gerador` manda no corte (2.1); o regulador fica como o usuário deixar (normalmente 1).
- **Determinismo:** `RNG` com semente do preset para a variação por chuff, para o ritmo da bomba, as gotas e o sorteio da deriva de fase; render offline idêntico a cada execução (regra do `PLANO.md`).

### 4.2 Preset (`src/engines/vapor/presets.ts`, `PresetVapor`)

```ts
export interface PresetVapor {
  id: string; nome: string; familia: 'locomotiva' | 'estacionaria' | 'trator' | 'carro' | 'barco';
  rodeiro?: string;                      // '4-6-2', '2-8-8-4'…
  cilindros: { n: number; diametro: number; curso: number; angulo?: number[] };   // m; ângulos das manivelas (padrão 0/90, 0/120/240)
  motores?: 1 | 2;                       // articulada: 2
  compound?: { ap: { n: number; diametro: number }; bp: { n: number; diametro: number }; receptor: number /* m³ */ };
  reducao?: number;                      // Shay 2,6; Aveling 12; Stanley 1,5 (rev manivela / rev roda)
  dRoda: number;                         // m (0 = estacionária)
  pNominal: number;                      // bar manométrico
  superaquecido: boolean;                // n = 1,3 / 1,13; T do vapor
  evaporacaoMax: number;                 // kg/s
  kCaldeira?: number;                    // bar/kg (padrão 1/(10·evaporacaoMax))
  massa: number; massaAderente: number;  // t (locomotiva sem tênder; aderente = sobre as rodas motrizes)
  tender?: { massa: number; eixos: number; comprimento: number };
  vMax: number;                          // km/h
  escape: { dBico: number; lDescarga: number; vCaixa: number; lChamine: number; dChamine: number; kNL?: number; destino?: 'chamine' | 'condensador' | 'abafador' };
  apito: { tubos: number[] /* Hz a quente */; nivelDb?: number; tipo?: 'chime' | 'simples' | 'navio' };
  sino?: { f: number; batidasPorS: number };
  bombaAr?: { n: 1 | 2; cursosPorMin: number };
  folga: number;                         // 0..1 desgaste das bielas
  geometria: { comprimento: number; largura: number; altura: number; xCilindros: number; xChamine: number; xDomo: number; xCabine: number; zTopo: number };
  lwChuff: number;                       // dB(A) na condição de referência (4.6)
  semente: number;
  portadores: ('locomotiva' | 'gerador' | 'carro' | 'trator' | 'barco' | 'nenhum')[];
}
```

### 4.3 Fontes do `VaporDSP` (Pa a 7,5 m; posições no referencial do motor = da locomotiva, origem no centro do corpo ao nível do trilho)

| `id` | `tipo` | posição (locomotiva típica; da `geometria` do preset) | diretividade | `dentro` | o que leva |
|---|---|---|---|---|---|
| `chamine` | `escape` | `[xChamine, 0, zTopo + 0,3]` (no alto, à frente) | omni, eixo `[0,0,1]`, expConv 2 | não | chuffs (rede 1.4), jato do bico, sopro de tiragem, soprador, escape da bomba de ar (quando vai à chaminé) |
| `cilindro.e` / `cilindro.d` | `mecanica` | `[xCilindros, ±1,3, 0,6]`, eixo `[0, ±1, 0]` | `[0, −1, −3, −6, −9, −12, −14]`, expConv 2 | não | torneiras, vazamentos da caixa de válvulas e gaxetas do lado, bufo de drifting |
| `bielas.e` / `bielas.d` | `mecanica` | `[xCilindros + 1,5, ±1,2, 0,5]` | omni | não | impactos de folga, rolar das bielas |
| `apito` | `pa` | `[xDomo, 0, zTopo + 0,4]` | `[0, −1, −3, −6, −9, −12, −14]`, eixo `[1,0,0]` | não | apito |
| `seguranca` | `escape` | `[xDomo − 1, 0, zTopo + 0,2]` | omni, eixo `[0,0,1]` | não | válvula de segurança |
| `bomba.ar` (`bomba.ar.1`) | `compressor` | `[xChamine − 1, −1,4, 1,8]` (e `+1,4`) | omni | não | thump, psh, clique |
| `injetor` | `mecanica` | `[xCabine, +1,3, 1,2]` | omni | não | injetor |
| `sino` | `pa` | `[xChamine + 1, 0, zTopo + 0,3]` | omni | não | sino |
| `queimador` (Stanley) | `admissao` | sob o capô | omni | sim | rugido do queimador |
| `engrenagens` (Shay, trator) / `correias` (estacionária) | `mecanica` | lateral do motor | omni | estacionária: sim | tons de engrenagem / correias |

O rolamento, as pás e o aero não são do motor: são do portador (4.4). Vias estruturais (`vias`) só na estacionária (casa de máquinas) e no Stanley (cabine aberta: nenhuma); a locomotiva não tem cabine fechada modelada (o maquinista ouve de fora).

### 4.4 Portadores

| Portador (`TipoPortador`) | Classe | Geometria e fontes próprias | Carga sobre o motor |
|---|---|---|---|
| `locomotiva` | `LocomotivaVapor extends PortadorComMotor` (`src/carriers/locomotiva-vapor.ts`) | segmentos: locomotiva (`geometria` do preset) + tênder + N vagões (`vagoes` 0–20, `Lc` 20 m, altura 4,0, largura 3,0, `zPiso` 0,4), geometria de truques e vãos **calculada com as mesmas funções de `trem.ts`** (`montarCorpo`, `xTruques`: extraí-las como helpers exportados se não estiverem; não se herda de `Trem`, que recusa motor), rolamento por eixo (`FonteRolamento`, 1.7: motrizes `L_W` 103, tênder 100, vagões 100, `v_ref` 80 km/h, `n` 3), vãos `FonteVao` (119 a 300 km/h, `n` 6: inaudíveis abaixo de 100 km/h e ficam por coerência), sem pantógrafo nem aero (`v` < 160 km/h: aero 15 dB abaixo do rolamento); buzina/apito é do motor; `cpNariz` 0,30; `orcamentoTrem`: vagões limitados pelas 64 fontes (motor usa 12–14) | `Carga.torque(ω) = r·(R_davis(v) + m_total·g·rampa + F_freio)`, `R_davis = m·(6,4 + 0,13·v) + 0,0045·A·v²` N (Davis em kg e km/h convertido), `inercia = m_total·r²` (+ 2% de massas girantes); `comandar` passa `regulador`, `cutoff`, `apito`, `sino`, `areia`, `freio`, `torneiras`, `fogo` ao motor; `velocidadeFixa` (modo de testes) impõe ω à roda e deixa o resto rodar |
| `gerador` (estacionária) | `Gerador` existente, com `governadorProprio` do motor | corpo 12 × 6 × 6, alvenaria; o `Gerador` manda `rpmAlvo` (60–100 rpm) e `cargaFracao` em degraus; `correias` é fonte do motor | `P·fração/(η·ω)` como hoje; `J` do volante no preset |
| `carro` (Stanley) | `CarroDireto` (`src/carriers/carro-direto.ts`): corpo de carro, relação fixa `reducao`, massa, `cd`, pneus (as fontes de pneu de `carro.ts`, ligadas) | — | `torque = r/redução·(m·g·(c_rr + rampa) + ½ρ·cd·A·v²)`, `inercia = m·(r/redução)²` |
| `trator` (extensão) | `Trator` (`src/carriers/trator.ts`) | corpo 6,5 × 2,4 × 3,5, rodas de ferro (ruído largo), marcha 1/2 | `reducao` por marcha; carga de estrada `c_rr` 0,05 em terra + rampa |
| `barco` (extensão) | `Barco` (`src/carriers/barco.ts`) | corpo 20–60 m sobre água, `pas` (2.4) ou `helice` (`FonteHelice`), sem rolamento | `torque = ½ρ_água·S·C_f·v²·r_eq/ω` (resistência de atrito + onda `∝ v⁴` acima de `Fr` 0,3) |
| `nenhum` (bancada) | `PortadorTeste` existente | — | eixo livre ou carga de teste: a página usa para "parado" e para medir |

**Tabela motor × portador (linhas novas da 1.6 do `CENA.md`; a coluna "uso real" é o que a página oferece):**

| Motor | carro | gerador | locomotiva | trator | barco | nenhum |
|---|---|---|---|---|---|---|
| vapor, locomotivas (presets 1–10) | — | — | **✓** | — | — | ✓ |
| vapor, Corliss (11) | — | **✓** | — | — | — | ✓ |
| vapor, Aveling (12) | — | ✓ (acionando uma debulhadora: polia) | — | **✓** | — | ✓ |
| vapor, Stanley (13) | **✓** (`CarroDireto`) | — | — | — | — | ✓ |
| vapor, barco (14) | — | — | — | — | **✓** | ✓ |

`COMPAT` (`carriers/compat.ts`) ganha `trator: ['vapor']` e `barco: ['vapor', 'diesel']` (o diesel marítimo fica para depois, sem preset) e `USO_REAL` ganha `vapor` em `locomotiva`, `gerador`, `carro`, `trator`, `barco`. `TipoPortador` ganha `'trator' | 'barco'` (extensão anotada, como `'aviao'`).

### 4.5 Cena

Nada muda na Cena: as fontes do vapor são `FonteSonora` comuns. A locomotiva a vapor usa os ambientes de via (`ceu`, `corte`, `estacao`, `tunel`, `ponte`, `serra`) com solo `brita`; o barco, `agua`; a estacionária, `hangar` (casa de máquinas) e `patio`; o Stanley e o trator, `rua`. O infrassom do Helmholtz da caixa (9–14 Hz) vai só à telemetria (`pressaoPa`) e o canal `chamine` leva passa-alta de 20 Hz (como `pressao` do CENA 2.6).

### 4.6 Níveis absolutos e sondas

Como nos adaptadores (`TECNICO.md` → Nível absoluto), cada fonte é levada a um `L_W` dB(A) numa condição de referência por uma sonda na thread principal (`prepararMotorVapor(preset, fs)`), guardada por preset:

| Fonte | Condição de referência | `L_W` dB(A) |
|---|---|---|
| `chamine` (chuff) | regulador 1, corte 50%, `p_cal` nominal, **4 chuffs/s** (ω imposto), sem jato de choque no cômputo | `lwChuff` do preset: 118 (0-6-0T, Baldwin métrica, Shay), 124 (D51, K4s, A4, 57xx… médias), 128 (844, Y6b), 130 (Big Boy); estacionária à atmosfera 105, trator 108, Stanley (condensador) 85, barco 100 |
| `apito` | válvula toda aberta, tubos quentes | 145 (navio 150, estacionária 135) |
| `seguranca` | aberta | 140 |
| `cilindro.*` (torneiras) | abertas, 2 voltas/s | 123 |
| `sino` | batendo | 113 |
| `bomba.ar` | carregando | 104 |
| `bielas.*` | `folga` 0,5, regulador 1, corte 60%, 1 volta/s | 103 |
| `injetor` | ligado | 94 |
| `queimador` | fogo 1 | 95 |

Referências: locomotiva a vapor trabalhando, 90–100 dB(A) a 15 m (`lwChuff` 128 → 100 a 15 m com a diretividade omni e o solo de brita); apito de locomotiva 100–110 dB(A) a 30 m; válvula de segurança ~110 dB(A) a 10 m. Fora da referência, tudo vem da física (corte, regulador, taxa): o relatório da etapa anota o nível que o modelo dá na arrancada (corte 80%, 1,5/s) e em cruzeiro (corte 25%, 15/s) relativo à referência; a expectativa é **+6 ± 3 dB** na arrancada por chuff (release 10 bar engasgado) e **−4 ± 3 dB** por chuff em cruzeiro, com o nível médio em cruzeiro acima do da arrancada pela taxa (+10·log(15/1,5) = +10 dB em potência média menos a perda por chuff).

---

## 5. Presets

Fichas (valores de catálogo; "≈" marca estimativa por classe). `lwChuff` em 4.6. Diâmetros × cursos em polegadas quando a máquina é anglo-americana (convertidos no preset), em mm nas japonesas e métricas.

| # | `id` | Máquina | Rodeiro | Cilindros (n × Ø × curso) | `D_roda` | `p` | Massa (loco / aderente / tênder) | `v_max` | `E_max` | Apito (tubos, Hz) | Portador | Observações |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `k4s` | PRR K4s (1914–28) | 4-6-2 | 2 × 27" × 28" | 80" = 2,03 m | 205 psi = 14,1 bar, superaquecido | 141 t / 92 t / 95 t | 150 km/h | 6,0 kg/s | simples 1 nota ("banshee") 1 tubo ≈ 520 Hz | locomotiva | TE 198 kN; chaminé 0,50 × 1,6 m, caixa 5 m³, bico 0,15; sino 650 Hz; bomba 8½" ×1 |
| 2 | `a4` | LNER A4 Mallard (1938) | 4-6-2 | 3 × 18,5" × 26" (Gresley, 120°) | 80" = 2,03 | 250 psi = 17,2, superaq. | 103 t / 67 t / 64 t | 160 (recorde 203) | 5,5 | chime de 3 tubos (Crosby) ≈ 311 · 370 · 466 (1 : 1,19 : 1,5) | locomotiva | 6 chuffs/volta; TE 159 kN; chaminé dupla (Kylchap, 2 bicos de 0,12, 2 chaminés 0,45 × 1,5: o DSP junta num bico equivalente de 0,17 e uma chaminé): conferir o som da dupla no passo 6 |
| 3 | `d51` | JNR D51 (498) | 2-8-2 | 2 × 550 × 660 mm | 1 400 mm | 14 kgf/cm² = 13,7, superaq. | 78 t / 59 t / 47 t | 85 | 4,0 | **medido** 360 · 465 · 548 (3 tubos, tríade maior) | locomotiva | TE ≈ 170 kN; chaminé 0,40 × 1,3, caixa 3,5, bico 0,13; sino não (sirene japonesa não modelada); bomba ×1 |
| 4 | `up844` | UP FEF-3 844 (1944) | 4-8-4 | 2 × 25" × 32" | 80" = 2,03 | 300 psi = 20,7, superaq. | 220 t / 120 t / 196 t (tênder cheio) | 130 (projeto 180) | 7,0 | **medido** 281 · 344 · 408 · 420 (6-chime Nathan com pares) + 3º par ≈ 494 | locomotiva | TE 284 kN; chaminé 0,55 × 1,7, caixa 6, bico 0,16; sino ≈ 600 Hz a 1 batida/s; bombas 8½" ×2; variante `sp4449` (GS-4: 25,5" × 32", 300 psi, 6-chime) só muda apito e massa |
| 5 | `bigboy` | UP 4014 Big Boy (1941) | 4-8-8-4 | 2 motores × 2 × 23,75" × 32" | 68" = 1,73 | 300 psi, superaq. | 350 t / 245 t / 198 t | 110 | 12,0 | 6-chime ≈ 294 · 349 · 392 · 440 · 523 · 587 (acorde Nathan; medido só o sino) | locomotiva | **8 chuffs/volta, dois motores sem fase**, `derivaFase` 1%; TE 602 kN; chaminé 0,60 × 1,8, caixa 8, bico 0,18; **sino medido** 606 Hz, 2,24 batidas/s; bombas ×2 |
| 6 | `y6b` | N&W Y6b (1948) | 2-8-8-2 compound | AP 2 × 25" × 32", BP 2 × 39" × 32" | 58" = 1,47 | 300 psi, superaq. | 275 t / 275 t / 160 t | 80 | 9,0 | 3-chime N&W "hooter" grave ≈ 196 · 233 · 294 | locomotiva | 4 chuffs/volta em composição (BP a 2–4 bar: chuff grave e macio), 8 na partida (`simplificacao`), receptor 1,2 m³; TE 677 kN; chaminé 0,55 × 1,6, caixa 7 |
| 7 | `shay` | Shay classe C, 70 t (Lima) | 3 truques | 3 × 12" × 15" verticais, 120° | 36" = 0,91 | 200 psi = 13,8, saturado | 64 t / 64 t / — | 25 | 1,6 | 1 nota ≈ 440 (apito de madeireira) | locomotiva | `reducao` 2,6: **6 chuffs por volta do eixo = 15,6 por volta de roda** (30/s a 20 km/h); TE 68 kN × 2,6; chaminé 0,35 × 1,2, caixa 1,8, bico 0,10; engrenagens (`engrenagens`, z 14) |
| 8 | `maria_fumaca` | Baldwin 2-8-0 "Consolidation" de bitola métrica (tipo das preservadas pela ABPF/VFCJ, Campinas–Jaguariúna) | 2-8-0 | 2 × 17" × 22" (≈) | 44" = 1,12 (≈) | 180 psi = 12,4 (≈), saturado | 55 t / 48 t / 30 t (≈) | 50 | 1,8 | 1 nota ≈ 480 Hz (apito Baldwin simples) + sino 700 Hz | locomotiva | Ficha **por classe**: a Wikipédia da VFCJ só diz que são "autênticas locomotivas a vapor, oriundas de várias estradas de ferro brasileiras" e cita a nº 505; as dimensões acima são as das Consolidation métricas Baldwin dos anos 1910–40 e devem ser conferidas no acervo da ABPF antes de nomear uma máquina específica no preset; TE ≈ 100 kN; chaminé 0,33 × 1,2, caixa 1,6, bico 0,10; vagões de madeira (massa 15 t) |
| 9 | `pannier` | GWR 57xx 0-6-0PT (manobra) | 0-6-0T | 2 × 17,5" × 24" (internos) | 55,5" = 1,41 | 200 psi = 13,8, saturado | 50 t / 50 t / — (tanque) | 70 | 1,5 | 1 nota GWR ≈ 660 Hz (apito "bell") | locomotiva | cilindros internos: `cilindro.*` em `y` ±0,6 e menos chiado lateral; TE 100 kN; chaminé 0,33 × 1,2, caixa 1,5, bico 0,10; manobra: arrancadas e paradas frequentes, torneiras sempre |
| 10 | `king` | GWR King 6024 (gravação Commons) | 4-6-0 | 4 × 16,25" × 28" (internas a 180° das externas) | 78" = 1,98 | 250 psi = 17,2, superaq. | 91 t / 69 t / 47 t | 145 | 5,0 | 1 nota GWR ≈ 600 Hz | locomotiva | 4 batidas duplas/volta; é o preset do teste da Lickey (3.1–3.3) |
| 11 | `corliss` | Máquina de moinho Corliss 1 cil. (≈ 1 000 hp) | horizontal | 1 × 30" × 60" | volante 7 m, 40 t | 120 psi = 8,3, saturado | — / — / — | 75 rpm (governado) | 1,5 | apito de fábrica 1 nota ≈ 250 Hz | gerador | 2 escapes/volta (2,5/s), condensador (padrão) ou atmosfera; cliques dos dashpots 2/volta; correias; `J` 3 × 10⁴ kg·m² |
| 12 | `aveling` | Aveling & Porter 8 nhp (≈ nº 11630) | trator de estrada | 1 × 8" × 10" | manivela 150–320 rpm, roda 1,60 m, `reducao` 12 (1ª) / 6 (2ª) | 150 psi = 10,3, saturado | 10 t | 8 km/h | 0,3 | 1 nota ≈ 700 Hz | trator, gerador (polia) | **medido** lenta 70–80 rpm; chaminé 0,30 × 1,4; engrenagens z 12 |
| 13 | `stanley` | Stanley Steamer 20 hp (modelo 735, 1920) | carro | 2 × 4" × 5" no eixo, `reducao` 1,5 | roda 0,91 | 600 psi = 41, superaq. leve | 1,2 t | 100 | 0,12 | 1 nota ≈ 800 Hz (apito pequeno) | carro | condensador (`escape: 'condensador'`), queimador 95 dB(A); 6 "pants" por volta de roda abafados |
| 14 | `vapor_pas` | Vapor de rodas de pás (compound diagonal 2 cil.) | barco | AP 0,6 × 1,2 m, BP 0,9 × 1,2 m | roda de pás 4,0 m, 10 pás, 25–45 rpm | 150 psi = 10,3 | 400 t | 25 km/h (13 nós) | 2,0 | navio 1 nota ≈ 180 Hz | barco | condensador; tapas 4–7/s; apito `L_W` 150 |

Campos iguais para todos: `folga` 0,3 (0,6 na Maria Fumaça e no Aveling: máquinas preservadas e antigas; 0,2 na A4), `bombaAr` 1 × 70 cursos/min (2 × 60 nas americanas grandes), `semente` fixa por preset. Big Boy e Y6b trazem `motores: 2`; Shay, Aveling e Stanley trazem `reducao`.

---

## 6. Interface da página `vapor.html`

Página nova (`src/pages/vapor/main.tsx`, entrada em `vite.config.mts`, link no menu `index.html`), com os componentes de `src/ui/` (slider, chips, seção, navegação de famílias e presets, mostradores) e a cadeia de áudio da Passagem (`PERFIL_PASSAGEM`: escala absoluta, limitador em −1 dBFS, reverberação da Cena). O worklet é o `processador-cena.ts` com o portador escolhido pelo preset e o `VaporDSP` acoplado; a página roda a sonda de nível (4.6) na thread principal por preset.

**Famílias (chips):** Locomotivas · Estacionárias · Trator · Carro · Barco. Presets da família em chips.

**Controles (paridade: todos têm tecla e estado no painel):**

| Controle | Tipo | Tecla | Vai para |
|---|---|---|---|
| Regulador | slider 0–100% | W/S sobe/desce em 1 s; X fecha | `regulador` |
| Reverser (corte) | slider −100…+100% com marca de 0 e rótulo "corte 15–85%" | A/D | `cutoff` |
| Apito | **botão segurável** (mouse/toque) e tecla **H segurável**; slider opcional de abertura (quilling) | H | `apito` 0/1 ou valor |
| Sino | toggle | B | `sino` |
| Areia | segurável | E | `areia` |
| Torneiras dos cilindros | toggle + "auto" | T | `torneiras` |
| Freio | slider 0–100% | espaço | `freio` (portador e motor) |
| Fogo | slider 0–100% + "foguista automático" | — | `fogo` |
| Injetor | botão + "auto" | I | `injetor` |
| Bomba de ar | botão forçar + "auto" | — | `bombaAr` |
| Soprador | toggle + "auto" | — | `soprador` |
| Válvula de simplificação (compound) | toggle | — | `simplificacao` |
| Vagões | número 0–20 (locomotiva), massa por vagão | — | portador |
| Rampa | slider −3…+3% | — | portador |
| Trilho | chips seco / molhado | — | `μ` |
| Marcha (trator) / carga (estacionária: 0/25/50/75/100%) | chips | — | portador |
| Ambiente, trajetória, ouvinte (gimbal), velocidade fixa | os da Passagem | — | Cena |
| Ar (jato, chiado), Mecânica, Master | sliders de mistura (como o Ronco) | — | ganhos das famílias de ruído |

**Cenários** (botões que programam os comandos no tempo, como `idle/rev/wot` no Ronco; os mesmos do `tools/vapor-render.ts`): `parada` (pressão e auxiliares, 60 s), `arrancada` (1.9, 40 s, com patinagem se trilho molhado), `cruzeiro` (velocidade fixa a 60 e 100 km/h), `drifting`, `lickey` (subida 2,65% com 10 vagões), `apito` (toque longo-longo-curto-longo), `passagem` (a Passagem universal com a composição).

**Mostradores** (telemetria por `requestAnimationFrame`):
- **Manômetro** (mostrador redondo): `pCaldeira` em bar e psi, zona vermelha em `p_nom + 0,3`, ponteiro secundário `pChest`.
- **Velocímetro** km/h e **rotação da roda** (rpm e voltas/s).
- **Corte** (%) com o sentido, e **chuffs/s** (numérico + "fita" piscando a cada escape: 4 luzes por volta nos 2 cil., 6 no Shay/A4, 8 na articulada com as duas fileiras para mostrar a fase deslizando).
- **Pressão de abertura do escape** (bar abs) e indicador "engasgado/subsônico".
- **Esforço de tração** vs **adesão** (barra; vermelho ao patinar) e **patinando**.
- Estados: segurança aberta, injetor, bomba de ar (ritmo), torneiras, soprador, fogo e evaporação vs consumo (kg/s).
- Apito: nota de cada tubo (Hz) e afinação relativa ao quente (cents).
- dB(A) no ouvinte (`splDbA` da Cena) e medidor de pico.
- Modo de testes: os da Passagem (gimbal, cena 3D com a locomotiva em caixas segmentadas: caldeira cilíndrica, cabine, tênder, vagões; chaminé e domo como marcadores de fonte).

---

## 7. Plano de implementação e verificação

Pastas: `src/engines/vapor/` (`dsp.ts`, `cilindro.ts`, `caldeira.ts`, `rede.ts` (bico, caixa, chaminé), `apito.ts`, `sino.ts`, `auxiliares.ts` (bomba, injetor, segurança, torneiras, vazamentos), `presets.ts`, `motor.ts` (sonda de nível), `tipos.ts`), `src/carriers/locomotiva-vapor.ts`, `carro-direto.ts`, `trator.ts`, `barco.ts`, `src/pages/vapor/`, `tools/vapor-render.ts` (cenários → WAV + JSON), `tools/vapor-valida.ts` (as medidas de 3 sobre renders e sobre as gravações, com a tabela alvo × medido), `tools/vapor-cpu.ts`. Cada passo termina com o teste indicado passando num comando (`npm run teste:vapor -- <passo>`); os números vão para o relatório da etapa e para `TECNICO.md` → "Vapor".

| # | Passo | Entrega | Teste objetivo |
|---|---|---|---|
| 1 | Ferramentas de medida | `tools/vapor-valida.ts` portando `mapa2.py`/`chuff2.py`/`apito.py`/`bandas.py`; tabela do Apêndice A reproduzida | Sobre as 6 gravações do Commons: chuff/s, ataque, p/v, bandas e notas iguais aos do Apêndice A a ±2% (taxa), ±5% (tempos), ±0,5 dB (bandas) |
| 2 | Cilindro e eixo | `cilindro.ts`: cinemática, eventos de 1.2, pressões, vazão de escape; `dsp.ts` com ω imposto e torque | K4s a ω fixo (1 volta/s), corte 50%: `p_rel` 6,8 ± 0,3 bar abs; massa por chuff 0,65 ± 0,05 kg; 4 chuffs/volta com `A_e` abrindo em 20° ± 2°; esvaziamento `τ_bd` 30 ± 5 ms; torque médio × ω = potência indicada a ±5% de `p_me·A·s·2·n·f_rev`; TE a corte 80% e ω → 0 = 198 ± 10 kN; CPU por amostra < 1/3 do Ronco (`tools/vapor-cpu.ts`, 10 s em Node) |
| 3 | Rede acústica e jato | `rede.ts`: passagens, descarga, bico, caixa, chaminé, radiador, jato e choque | Impulso de vazão no bico: ressonância da chaminé a `c_q/(2L)` ± 5% (844: 132 Hz) com decaimento a −10 dB em 15–25 ms; Helmholtz 9,7 ± 1 Hz na telemetria e ausente (< −40 dB) no canal; render K4s a 4 chuffs/s corte 70% a 7,5 m: ataque 35–60 ms, largura 55–80, decaimento 50–90, p/v 15–18 dB, bandas de 3.3 "de perto" dentro das tolerâncias de 3.6; a 21 chuffs/s corte 20%: ataque 12–18 ms, p/v 7–11, Δ(2,5–6k) −10 ± 4 dB em relação ao caso anterior |
| 4 | Caldeira, regulador, auxiliares | `caldeira.ts`, `auxiliares.ts` | K4s parada, fogo 1: segurança abre em 14,4 bar, fecha em 13,7, ciclo 1–3 min; apito aberto 20 s derruba 0,6 ± 0,2 bar; arrancada (corte 80%, regulador 0,6, trem de 300 t) cai 1–2 bar em 30 s e recupera; bomba a 70 ± 4 cursos/min com periodicidade da envoltória 600–4000 Hz ≥ 15 dB; torneiras: 4 sopros/volta em fase com as admissões |
| 5 | Apito e sino | `apito.ts` (oscilador de guia de onda por tubo), `sino.ts` | D51: 360/465/548 ± 1,5% a quente, 3º harmônico −6 ± 4 dB, 2º < −15; ataque 100–300 ms; tubo frio parte 10 ± 2% abaixo e chega a −1% em 30 s; 844: batimento 13 ± 2 Hz entre 407 e 420 com profundidade ≥ 6 dB; quilling (`apito` 0,1): só ruído filtrado, linha < 10 dB; sino 606 Hz, 2,24 batidas/s, parciais ±3%, T60 3–5 s |
| 6 | Geometrias: 3 cil., articulada, compound, Shay, King | `presets.ts` completo; dois motores; receptor; redução | A4: 6 chuffs/volta; Big Boy a 52 km/h: linha de 21,5 Hz (8/volta) com proeminência que varia ≥ 10 dB ao longo de 60 s (deriva de fase) e linhas de 4/volta de cada motor; Y6b: 4/volta em composição com `p_rel` 2–4 bar e 8 na partida; Shay a 20 km/h: 30 ± 0,6 chuffs/s; King: 4/volta com batidas duplas (linha de 8/volta < −20 dB) |
| 7 | Patinagem e drifting | adesão, troca de `J`, areia, bufo | Arrancada no molhado (μ 0,12) com 500 t: ≥ 1 surto com ω subindo 3–5× em ≤ 1 s, chuffs a 15–20/s com nível por chuff caindo ≥ 6 dB, regulador fechado pelo cenário em 1 s → ω volta em ≤ 1,5 s; com areia (μ 0,30) nenhum surto; drifting a 60 km/h: chuff −25 ± 3 dB em relação ao cruzeiro, rolamento domina (≥ +10 dB) |
| 8 | Portador `LocomotivaVapor` e composição | `locomotiva-vapor.ts` reusando helpers de `trem.ts` | Passagem a 40 km/h com 12 vagões a 15 m: rolamento dos vagões −13 ± 3 dB em relação à locomotiva trabalhando (3.5); `L_Aeq,tp` da locomotiva a 15 m 90–100 dB(A) com `lwChuff` 124; Doppler da linha da chaminé (132 Hz) ± 1 Hz pela fórmula de CENA 2.1; orçamento ≤ 64 fontes com 20 vagões (ou erro claro) |
| 9 | Estacionária, trator, Stanley, barco | `carro-direto.ts`, `trator.ts`, `barco.ts`, governador do Corliss | Corliss a 75 rpm: 2,5 ± 0,05 pulsos/s, cliques 2/volta, degrau de 50% de carga: −3 ± 1% e volta em 5–10 s; Aveling em lenta: 2,5 ± 0,3 escapes/s, banda 400–1k +8 ± 4 dB; Stanley a 40 km/h: 23 ± 0,5 pants/s com p/v ≤ 4 dB e queimador ≥ 10 dB acima do escape parado; barco a 40 rpm: 6,7 ± 0,2 tapas/s |
| 10 | Níveis absolutos | `motor.ts` com `prepararMotorVapor` e sondas | Tabela 4.6 a ±1 dB na condição de referência, canal a canal; apito a 30 m: 105 ± 3 dB(A); segurança a 10 m: 110 ± 3; locomotiva trabalhando a 15 m: 95 ± 5 |
| 11 | Página `vapor.html` | `src/pages/vapor/`, cenários, mostradores, `vite.config.mts`, menu | Paridade da tabela de 6 (lista no relatório); tecla H segurável: apito sobe em 100–300 ms e cai ao soltar; mudar qualquer controle não estala (pico de diferença entre blocos < 0,1 FS num render com rampa); `node tools/vapor-navegador.mjs` (Chromium e Firefox) liga, acelera, apita, troca preset e ambiente sem erro no console |
| 12 | Validação e documentação | `npm run teste:vapor` completo; `TECNICO.md` → "Vapor" (alvo × medido, desvios); `README`; `PLANO.md` marcado | Zero falhas nos passos 1–11; desvios documentados com causa; `paridade:ronco`, `paridade:turbina`, `paridade:acoustics`, `teste:diesel`, `teste:radial` e `teste:cena` inalterados (nada fora de `src/engines/vapor/`, `src/carriers/{locomotiva-vapor,carro-direto,trator,barco}.ts`, `compat.ts`, `tipos.ts` (extensões), `src/pages/vapor/`, `tools/vapor-*`) |

### 7.1 Riscos e como limitar

| Risco | Medida |
|---|---|
| **Pulsos de baixa frequência saturando**: o chuff tem energia enorme abaixo de 50 Hz (Helmholtz 9–14 Hz, vazão quase DC do pórtico aberto) e no pico de um chuff de arrancada a 7,5 m a pressão pode passar de 20 Pa (120 dB) | o `Radiator` já deriva a vazão (passa-alta de 1ª ordem); passa-alta de 20 Hz (2 polos) no canal `chamine` e `seguranca`; o Helmholtz só na telemetria; medidor de pico na página; a escala absoluta (0 dBFS = 124 dB) mais o `tanh` seguram; teste do passo 3 mede o pico em Pa e exige < 25 Pa a 7,5 m no chuff de referência e < 60 Pa na arrancada |
| **Aliasing do jato**: o bico é não linear (`Ψ` com engasgo, `U_j` → `M_j³`) e multiplica ruído largo por envelopes rápidos; o afiamento `kNL` na descarga cria harmônicos acima de Nyquist | a não linearidade do bico opera sobre a pressão do tubo passada por um polo em 4 kHz (a parte lenta); o ruído de jato é gerado já filtrado (polo em 6 kHz) e **modulado** pela envoltória lenta de `ṁ_j·M_j³` (passa-baixa de 2 kHz), não multiplicado amostra a amostra pela pressão crua; `kNL` 0,3 (não 0,6) e o atrito da onda de volta do Ronco mantido; teste: render a 21 chuffs/s, energia acima de 16 kHz < −60 dB da total e nenhuma linha espúria em fs/16 |
| **CPU**: dois motores de 4 extremidades + rede + 6 tubos de apito + auxiliares + 12–14 fontes na Cena com 20 vagões | contas por extremidade são ~30 flops; apito ~20 por tubo; rede ~100: < 600 flops/amostra, abaixo do Ronco (que tem até 16 cilindros e 2–4 radiadores); sem alocação no laço (`Float64Array` de estado, como a Cena); `tools/vapor-cpu.ts` no passo 2 e no 11 com o navegador (`performance.now()` por bloco, meta < 40% do quantum com 20 vagões) |
| **Estabilidade do oscilador do apito** (realimentação não linear numa `Line`): pode travar num harmônico, não arrancar ou estourar | ganho de malha limitado por `tanh`, saturação em 1,3× o nível de regime, passa-baixa na malha (polo em 4·f) para favorecer o fundamental; teste do passo 5 varre `apito` 0→1 em 5 s para cada tubo e exige a nota certa (±1,5%) e nível monotônico |
| **Cutoff curto a alta rotação** (eventos de válvula a poucas amostras: a 45 chuffs/s cada chuff tem 1 067 amostras e o pórtico abre em 20° = 59 amostras) | fase integrada em double por amostra, eventos interpolados na amostra fracionária (como as válvulas do Ronco), `A_e` contínua; teste do passo 3 a 45 chuffs/s: nenhum salto > 0,1 FS |
| **Patinagem explodindo** (ω subindo sem limite ao trocar `J`) | `J_motor` nunca abaixo de 1 500 kg·m²; atrito viscoso das bielas `∝ ω`; limite físico: o vapor que entra por volta cai com `A_reg` (1.1) e o torque cai com ω; teste do passo 7 exige ω ≤ 6× o de antes do surto |
| **Dois motores derivando** parecendo um bug (ritmo "errado") | `derivaFase` do preset, mostrador de fase na página (6), e o teste 6 mede a variação da linha de 8/volta: é o comportamento real (3.1) |
| **Gravações de vídeo não são públicas** | alvos públicos só do Commons (Huntsville 0-4-0, Lickey 6024, Grand Canyon 4960, apitos D51/C57/844); os de vídeo valem como alvo interno e assim ficam marcados em `TECNICO.md` |
| **Mudança em `acoustics/`, `scene/`, `ui/`** | não se toca; o que faltar (ex.: `Line` com `c` por instância, volume acústico) é implementado em `src/engines/vapor/rede.ts` e relatado para subir ao pacote comum depois |

---

## Apêndice A. Medidas das gravações

Arquivos em `…/scratchpad/real2/vapor/wav/` (WAV mono 48 kHz, convertidos de OGG/WebM/AAC: acima de 10–12 kHz não vale). Linhas da envoltória: `f(prom, ac)` = frequência em Hz, proeminência em dB sobre a mediana de 0,8–40 Hz e autocorrelação da envoltória no atraso `1/f`. Os trechos de vídeo privado estão marcados (v).

### A.1 Identificação e trechos usados

| Arquivo | O que é (fonte da identificação) | Licença | Trechos (s) |
|---|---|---|---|
| `Steam_engine_ogg` | 0-4-0 de bitola estreita subindo uma rampa, Huntsville ON, 2008 (descrição do Commons; vídeo de mão) | domínio público | 2–20, 24–44 |
| `6024_Lickey_Bank_ogg` | GWR 6000 "King" 6024 subindo a Lickey Incline (categorias do Commons; coleção steamsounds, D. Bailey) | CC BY-SA 3.0 / GFDL | 0–16 (chegando), 40–72 (passando), 128–160 (afastando) |
| `Steam_Locomotive_Leaving_Depot_…webm` | Grand Canyon Railway 4960 (2-8-2) saindo de Grand Canyon Village, 2022 (NPS) | CC BY 2.0 | 0–12 (apito/sino), 16–27 |
| `C57180_kiteki_1_ogg` | apito da JNR C57 180, Nagaoka 2009 (Commons) | CC BY-SA 4.0 | 12–20 |
| `D51498_kiteki_2005_ogg` | apito da JNR D51 498, 2005–2006 (Commons) | CC BY-SA 4.0 | 0–36 |
| `2010_UP844_Whistle_ogg` | UP 844 passando por Kosse, TX, 2010 (Commons) | CC BY-SA 3.0 | 22–36 (apito); 8–20 tem uma linha de 1 435/2 476 Hz não identificada (excluída) |
| `WWS_StationaryEngine_ogg` | **motor estacionário a gasolina** de museu (Commons): excluído | CC BY 4.0 | — |
| (v) `yt_61yF8LC8SQ0` | UP 844 saindo de Cheyenne | — | 0–24 (apito), 44–62 (vagões), 64–88 (parada: bomba/sino), 96–120 (trabalhando) |
| (v) `yt_UYYzhjUzCOU` | UP 4014 Big Boy acelerando | — | 16–40 (sino), 48–80, 88–100 (composição), 168–184, 216–240 |
| (v) `yt_XoaNuUFWors` | Big Boy 4014 "at speed" | — | 14–28, 28–38 |
| (v) `yt_IdaT9XO-Wts` | "The enchanting sound of chuff" (locomotiva de 2 cil. não identificada) | — | 24–48, 100–140 |
| (v) `yt_klMHnNC0z6Y` | Pere Marquette 1225 | — | 0–14, 14–30 |
| (v) `yt_lC1D12eEyKo` | SP 4449 passando perto de Sprague, WA | — | 0–8, 32–48 |
| (v) `yt_OmT1xK1S0_0` | Strasburg 475 passando numa cancela | — | 10–22 (apito), 20–32 (sino), 40–80 |
| (v) `yt_tEW8vHGlkcQ` | máquina de moinho de 2 cilindros (StationRoadSteam) | — | 8–44 |
| (v) `yt_GBalt8dO24s` | Sinker Davis 1876, estacionária (muito baixa, −32 dBFS) | — | 2–30 |
| (v) `yt_VC5GosQ7iE8` | Aveling & Porter nº 11630, dia aberto | — | 0–16 |

### A.2 Chuffs: linhas, forma e espectros

| Trecho | nível dBFS | linhas da envoltória f(prom, ac) | chuff/s · ciclo | ataque / largura / decaimento (ms) | p/v total · 150–400 · 400–1,5k · 1,5–6k | pico: 60–150 / 400–1k / 1–2,5k / 2,5–6k / 6–12k · cen | vale: idem |
|---|---|---|---|---|---|---|---|
| Huntsville 2–20 | −16,1 | 3,32(30,+0,64) 6,58(22,−0,43) 9,77(16) 1,28(14) 2,05(13) | 3,32 · 3,32 | 62 / 77 / 75 | 15,4 · 16,4 · 16,5 · 9,8 | −5,0 / +1,0 / −4,4 / −3,2 / −10,7 · 1189 | +2,7 / −1,9 / −3,5 / −2,1 / −7,7 · 1378 |
| Huntsville 24–44 | −16,9 | 4,26(34,+0,75) 8,52(25) 2,14(18,+0,63) 12,78(16) | 4,26 · 2,14 | 35 / 65 / 60 | 17,8 · 19,1 · 20,1 · 13,6 | −10,6 / +2,2 / −1,8 / −1,3 / −6,1 · 1563 | −3,5 / −2,1 / −2,6 / −0,8 / −4,3 · 2005 |
| 1225 0–14 (v) | −22,4 | 1,44(27,+0,35) 2,93(23) 5,88(16) 8,70(15) 11,0(15) | 1,44 (pulso 1/volta) | 220 / 57 / 89 | 18,1 · 19,5 · 16,4 · 17,2 | +4,8 / −5,0 / −11,8 / −16,5 / −22,2 · 337 | +8,5 / −6,1 / −12,5 / −18,3 / −23,1 · 284 |
| 1225 14–30 (v) | −20,9 | 2,09(28,+0,45) 4,10(21) 5,76(15) 7,78(15) | 2,09 | 109 / 49 / 86 | 16,7 · 17,3 · 14,9 · 14,9 | +5,0 / −5,7 / −12,6 / −17,6 / −23,8 · 327 | +9,1 / −5,8 / −12,5 / −18,3 / −23,2 · 285 |
| Big Boy at speed 14–28 (v) | −12,8 | 1,14(18) 2,10(16) 2,97(16) 3,81(16) 4,30(15) (nada > 0,05 de ac: fases misturadas) | — | — | 7,8 · 10,5 · 5,9 · 5,1 | −15,6 / −5,9 / −4,0 / −10,2 / −11,1 · 986 | −15,9 / −5,1 / −4,0 / −9,3 / −10,6 · 1021 |
| Big Boy at speed 28–38 (v) | −13,9 | 21,48(14,+0,05) 7,54(14,+0,22) 12,06(14) 2,25(13) 3,03(12) | 21,5 | 15 / 16 / 17 | 9,4 · 13,0 · 9,1 · 5,5 | −4,1 / −3,7 / −8,9 / −15,1 / −22,4 · 479 | −1,6 / −1,9 / −5,5 / −11,2 / −18,4 · 630 |
| UP 844 Cheyenne 96–120 (v) | −18,2 | 6,39(24,+0,46) 6,12(20) 5,82(15) 12,67(14) 1,64(15) 0,90(14) | 6,3 (acelerando) | 49 / 115 / 91 | 7,8 · 8,1 · 7,5 · 10,2 | −11,2 / +4,0 / +4,9 / +1,2 / −12,1 · 1489 | −9,1 / +3,7 / +2,9 / −1,5 / −14,3 · 1242 |
| Big Boy acel. 48–80 (v) | −21,2 | 7,07(18) 6,45(16) 1,84(16) 3,67(15) 8,40(12) | 7,1 (5 → 8,8) | 50 / 99 / 72 | 7,3 · 11,1 · 7,0 · 2,9 | +0,4 / −5,5 / −4,2 / −4,1 / −11,5 · 1043 | +2,0 / −5,1 / −1,8 / −0,6 / −8,5 · 1443 |
| Big Boy acel. 168–184 (v) | −24,8 | 8,89(22,+0,29) 9,12(10) 4,44(10,+0,23) 7,01(12) | 9,1 | 43 / 63 / 52 | 8,1 · 11,5 · 6,8 · 4,0 | −6,2 / −5,4 / −5,9 / −6,4 / −10,3 · 1016 | −3,3 / −4,4 / −4,0 / −3,8 / −8,7 · 1258 |
| Big Boy acel. 216–240 (v) | −25,9 | 5,25(19,+0,31) 10,48(20,+0,20) 14,37(10) | 5,25 (+10,5) | 47 / 89 / 92 | 7,8 · 10,5 · 7,1 · 4,3 | −4,8 / −3,1 / −4,3 / −3,5 / −8,9 · 1318 | −2,5 / −3,0 / −3,9 / −2,5 / −8,2 · 1390 |
| enchanting 24–48 (v) | −16,6 | 2,73(27,+0,28) 3,22(20,+0,32) 5,51(21,−0,34) 8,22(19) | 3,2 (2,5 → 3,9) | 135 / 61 / 74 | 15,9 · 13,9 · 17,9 · 12,8 | −10,8 / +4,7 / +3,6 / −0,8 / −2,8 · 1536 | −6,3 / +0,2 / +2,3 / +0,4 / +0,4 · 2141 |
| enchanting 100–140 (v) | −16,5 | 5,54(37,+0,74) 2,78(25,+0,79) 11,07(27,−0,59) 16,58(22) 8,30(19) | 5,54 · 2,78 | 38 / 62 / 65 | 14,3 · 15,3 · 15,5 · 13,3 | −14,3 / +3,7 / +1,3 / −6,6 / −10,8 · 1046 | −10,0 / +1,9 / +0,4 / −3,1 / −4,8 · 1400 |
| 6024 Lickey 40–72 | −17,0 | 9,56(26,+0,54) 9,47(23) 4,64(13,+0,52) 3,20(12) 2,39(16) 19,04(12) | 9,5 · 4,64 | 33 / 46 / 52 | 10,6 · 13,6 · 9,4 · 6,4 | −11,7 / −0,9 / −3,5 / −9,9 / −25,1 · 771 | −8,4 / −1,9 / −4,2 / −10,1 / −23,4 · 736 |
| 6024 Lickey 128–160 | −34,8 | 8,51(28,+0,42) 8,63(21) 2,14(19,+0,42) 4,27(13) 17,0(15) | 8,7 (afastando) | 38 / 78 / 66 | 7,8 · 10,5 · 7,3 · 6,9 | −6,8 / −0,1 / −2,2 / −21,2 / −29,5 · 641 | −3,3 / +0,2 / −2,1 / −19,0 / −26,5 · 630 |
| SP 4449 32–48 (v) | −22,1 | 11,49(16,+0,48) 7,96(9,+0,38) 2,81(15) 1,07(18) | 11,5 | 27 / 68 / 38 | 6,2 · 8,5 · 6,7 · 4,8 | −6,1 / +1,4 / −1,9 / −15,6 / −28,4 · 687 | −4,9 / +1,8 / −1,1 / −14,4 / −26,0 · 718 |
| Strasburg 475 40–80 (v) | −20,0 | 3,01(21) 10,55(19) 4,96(18) 1,80(18) 5,55(18) (ac ≈ 0: velocidade variando) | ~3,0 | 79 / 29 / 41 | 15,6 · 18,8 · 14,3 · 9,9 | −2,9 / −6,6 / −11,3 / −12,6 / −19,2 · 460 | +0,8 / −5,9 / −8,5 / −10,0 / −14,4 · 561 |
| Grand Canyon 4960 16–27 | −19,9 | 30,42(10,+0,91) 5,59(9,+0,53) 4,24(12,+0,37) 3,23(15) | (30 Hz = tremor do apito/sino) | 11 / 23 / 15 | 6,9 · 12,3 · 7,3 · 4,1 | −12,2 / −5,6 / −11,5 / −11,6 / −15,9 · 675 | −7,4 / −0,9 / −7,0 / −6,4 / −10,5 · 1033 |
| moinho 2 cil. 8–44 (v) | −19,3 | 3,72(21) 3,87(18) 1,01(19) 2,78(16) 4,64(14) | 3,7 (4/volta a 56 rpm) | 53 / 36 / 54 | 12,9 · 12,5 · 10,3 · 4,6 | +4,1 / −6,9 / −1,0 / −0,8 / −0,7 · 2441 | +7,7 / −6,3 / −3,2 / −3,3 / −4,0 · 1626 |
| Sinker Davis 2–30 (v) | −32,5 | 1,31(22) 1,00(21) 1,97(20) 2,05(18) 3,92(18) | ~1,3 | 154 / 62 / 163 | 11,3 · 8,4 · 8,6 · 6,3 | +8,9 / −1,7 / +4,3 / +0,4 / +1,2 · 1752 | +10,0 / −4,1 / +1,8 / +0,1 / +0,3 · 1684 |
| Aveling 0–16 (v) | −18,9 | 1,16(25) 1,38(24) 2,19(20) 2,94(20) 5,32(17,+0,40) 6,01(14,+0,46) | 2,4–2,8 (2/volta a 70–80 rpm) | 68 / 96 / 60 | 8,3 · 8,2 · 7,6 · 5,5 | −0,7 / +8,3 / −0,3 / −6,7 / −15,1 · 734 | +0,6 / +8,6 / +1,4 / −6,3 / −12,4 · 762 |

### A.3 Apitos e sino (linhas: Hz, nível absoluto dB / proeminência dB)

| Trecho | Linhas |
|---|---|
| D51 498 0–2 s (frio) | 338(−40/33) 431(−48/22) 508(−45/23) 527(−47/21) 628(−49/20) |
| D51 498 6–8 s | 362(−37/33) 463(−31/33) 548(−35/25) 1096(−44/21) 2194(−53/21) |
| D51 498 34–36 s (quente, outro toque) | 378(−51/22) 482(−36/31) 606(−28/30) 620(−34/25) 699(−36/22) 710(−35/24) 1134(−40/22) |
| C57 180 12–20 s | 356(−36/31) 429(−29/36) 546(−33/28) 576(−40/23) 695(−45/21) 1071(−55/19) |
| UP 844 Kosse 28–34 s | 274(−43/18) 286(−43/19) 344(−39/21) 398(−40/20) 409(−30/29) 419(−38/21) 810(−36/20) |
| UP 844 Cheyenne 16–20 s (v) | 284(−43/21) 324(−33/31) 397(−26/31) 494(−27/31) 524(−27/32) 571(−37/22) 646(−34/26) 795(−31/32) |
| UP 844 Cheyenne 4–8 s (v) | 308(−37/33) 379(−37/30) 495(−33/35) 617(−26/40) 757(−20/46) 924(−32/35) 1137(−34/33) 1516(−36/34) 1895(−34/37) (toque com harmônicos de 379 Hz dominando) |
| Strasburg 475 6–8 s (v) | 290(−32/33) 327(−33/32) 364(−35/30) 415(−35/30) 477(−37/27) 593(−26/40) 980(−36/23) 1090(−37/21) |
| Grand Canyon 4960 8–10 s | 278(−32/25) 312(−30/27) 346(−34/22) 373(−34/23) 437(−33/23) 445(−33/23) 517(−38/21) 524(−37/24) |
| Big Boy sino 16–40 s (v) | batidas 2,24/s (envoltória 1–8 kHz, harmônicos 4,47/6,73); parciais 606(−39/32) 1160(−53/18) 1307(−41/31) 2140(−44/28) 3148(−43/31) 3505(−55/19) 4271(−43/28) 5480(−56/24) |
| Strasburg sino 20–32 s (v) | tom 609 Hz (−35/27); batidas 0,85/s (envoltória 3–8 kHz) |
| UP 844 parada 64–88 s (v) | periodicidades 0,6–1,1 Hz em 600–4000 Hz (prom. 21–24 dB: bomba de ar e/ou sino); tons 536/652/797/1005/1197 Hz |

## Apêndice B. Fórmulas e constantes

| Grandeza | Expressão / valor |
|---|---|
| rotação da roda | `f_rev = v/(π·D)`; chuffs `f_ch = N_esc·f_rev·(redução)` |
| corte | `c = 0,15 + 0,70·|cutoff|` |
| eventos (release `r`, compressão `k`) | tabela 1.2 interpolada em `c` |
| volume da extremidade | `V(θ) = V_cl + A·(s/2)·(1 − cos θ)`, `V_cl` 0,1·A·s |
| massa por chuff | `m = p_chest·A·s·c/(R_v·T)`, `R_v` 461, `T` 620 K (superaq.) / 470 K (sat.) |
| pressão de release | `p_rel = p_chest,abs·(c/r)^n`, `n` 1,3 / 1,13; engasgado se `p_rel/p_bp > 1,83` |
| vazão de escape | `ṁ_e = A_e(θ)·Ψ(p_cil/p_bp)·p_cil/√(R_v T)`; `A_e(θ) = A_e,max·min(1, ((θ−θ_r)/20°)^1,5)` |
| esvaziamento | `τ_bd = V/(A_e,max·c_v·0,6)` |
| pressão média efetiva | `p_me ≈ p_chest·c·(1 + ln(1/c)) − p_back` |
| esforço de tração | `TE = 0,85·p_cal·d²·s/D` (2 cil.; ×1,5 em 3 cil.; ×2 articulada; × redução engrenada) |
| adesão | `F_ad = μ·W_ad`, μ 0,22 / 0,12 / 0,30 (seco / molhado / areia) |
| caldeira | `dp/dt = (E − ṁ)·k_cal`, `k_cal = 1 bar/(10·E_max kg)`; segurança abre `p_nom + 0,3`, fecha `p_nom − 0,4` |
| regulador | `A_reg(u)` de 1.1; `p_chest = p_cal·(1 − 0,15·(ṁ/ṁ_max)²/u_ef²)` |
| bico | `ṁ_j = A_bico·Ψ·p_bp/√(R_v T)`; `U_j = ṁ_j/(ρ_j A_bico)` ≤ `c_v` 480 m/s |
| jato | nível `∝ ṁ_j·M_j³`; `f_pico = 0,2·U_j/D_bico`; choque se `p_bp/p_cx > 1,9` |
| caixa de fumaça | `f_H = c_q/(2π)·√(A_ch/(V_cx·(L_ch + 0,85·D_ch)))`, `c_q` 450 m/s |
| chaminé | `f_ch = c_q/(2·L_ch)`, Q 2–3; radiador `fRad = c/(2π·a)` |
| apito | `f = c_v/(4·(L + 0,3·D))`, `c_v` 480; harmônicos ímpares (3º −6 dB); aquecimento 0,90 → 1,0 em τ 15 s |
| sino | parciais 1 : 2,16 : 3,53 : 5,2 : 7,05; T60 4 / 2,5 / 1,5 / 1 / 0,7 s; 2,0–2,3 batidas/s |
| rolamento | `FonteRolamento`, `L_W` 103 (motriz) / 100 (tênder, vagões) dB(A) a 80 km/h, `n` 3 |
| Davis (resistência do trem) | `R = m·(6,4 + 0,13·v) + 0,0045·A·v²` N (m em t, v em km/h, A em m²) |
| escala | `0 dBFS ≙ 124 dB SPL`; `L_p(refDist) = L_W − 20·log₁₀ refDist − 11` |
