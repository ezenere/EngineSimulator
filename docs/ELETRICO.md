# Elétrico: projeto do DSP de máquinas elétricas (etapa 6)

Documento de projeto da etapa 6 (ver `PLANO.md`). Define um DSP **novo**, `EletricoDSP`: síntese espectral determinística (bancos de senóides recursivas + ruídos com semente), sem termodinâmica; o motor como `Motor` do `CENA.md` (eixo + fontes), os portadores novos (carro elétrico com redução fixa, trem/metrô motorizado, bonde, trólebus, bancada, multirrotor) e a página `eletrico.html`. Unidades do CENA (m, s, rad/s, N·m, Pa, kg; 48 kHz, blocos de 128, controle a cada 64 amostras). Tudo que está marcado **decisão** não se renegocia dentro da etapa sem anotar no relatório; o que está marcado **≈** é valor de catálogo aproximado ou hipótese de projeto, a confirmar se aparecer fonte melhor.

- [1. Física do som das máquinas elétricas](#1-física-do-som-das-máquinas-elétricas)
- [2. AVAS / VSP](#2-avas--vsp)
- [3. Alvos medidos nas gravações](#3-alvos-medidos-nas-gravações)
- [4. Interfaces: `EletricoDSP`, `MotorEletrico`, portadores](#4-interfaces)
- [5. Presets](#5-presets)
- [6. Página `eletrico.html`](#6-página-eletricohtml)
- [7. Plano de implementação e verificação](#7-plano-de-implementação-e-verificação)
- [8. Decisões a respeitar](#8-decisões-a-respeitar)

Notação: `f_rot` = rotação do rotor (Hz); `p` = pares de polos; `f_e = p·f_rot` (síncronas) ou `f_e = p·f_rot/(1 − s)` (indução, `s` = escorregamento); `f_c` = frequência de chaveamento/portadora do inversor; `N = f_c/f_e` = número de pulsos; `Z_s`, `Z_r` = ranhuras do estator/barras do rotor; `Z_c` = lâminas do comutador; `i` = redução (rpm do motor / rpm da roda); `r_w` = raio da roda; `M` = índice de modulação (0..1).

---

## 1. Física do som das máquinas elétricas

Uma máquina elétrica em regime não tem combustão nem pulso: tudo o que soa é (a) força eletromagnética periódica na carcaça, (b) o inversor pondo essas forças também nas frequências de chaveamento, (c) mecânica (engrenagens, rolamentos, ventilação, escovas, hélices) e (d) o resto do veículo (pneu, vento, rolamento). O espectro é **tonal**, feito de linhas cujas frequências são múltiplos exatos de poucas rotações (`f_rot`, `f_e`, `f_c`) e cujas amplitudes seguem corrente e torque. A síntese natural é um banco de linhas: cada fonte é uma lista `(frequência, amplitude)` recalculada a cada bloco de controle a partir de `ω`, `T`, `I`, `M` e do modo do inversor.

### 1.1 Forças eletromagnéticas

Densidade de força radial no entreferro `σ = B²/(2μ₀)`: produtos de harmônicos de campo. As frequências que chegam à carcaça (ordens, em Hz):

| Mecanismo | Frequências | Amplitude relativa (modelo) | Onde |
|---|---|---|---|
| Força fundamental (onda de 2p polos) | `2·f_e` | `A₂ ∝ (B₁)² ∝ (fluxo)²`, pouco depende do torque; +6 dB abaixo da base (fluxo cheio), cai 6 dB/oitava de `f_e` acima da base (enfraquecimento) | todas as máquinas CA; é o "zumbido" grave |
| Ondulação de torque (5º/7º harmônicos de FEM e corrente; comutação de 6 passos) | `6·f_e`, `12·f_e` (e `18·f_e` fraca) | PMSM senoidal: `6f_e` −20 dB rel. `2f_e` em vazio, sobe 10·log(I/I_n)·2 com a carga; BLDC/6 passos (drone, ESC): `6f_e` é a linha dominante do motor, 0 dB; `12f_e` −8 dB | PMSM, BLDC, TGV síncrono |
| Ranhuras do estator (permeância) | `m·Z_s·f_rot ± 2k·f_e`, `m` 1..3, `k` 0, 1, 2 | `m` = 1 forte (0 dB rel. ao grupo), `k` = ±1 a −6 dB, `k` = ±2 a −14 dB; `m` = 2 a −10 dB, `m` = 3 a −18 dB; cresce 20·log(I/I_n)·0,5 com a corrente | PMSM (Leaf, Tesla), indução |
| Barras do rotor (indução) | `m·Z_r·f_rot ± 2k·f_e` (com `f_rot = (1 − s)·f_e/p`) | como as ranhuras do estator, mas é o grupo **mais forte** na indução (Taurus, Vectron, metrôs, N700) | indução |
| Escorregamento (indução) | modulação lenta em `2·s·f_e` (0,5–4 Hz em carga) de todo o grupo de ranhuras, ±1,5 dB | — | indução |
| Excentricidade e desbalanceamento magnético | bandas laterais `± f_rot` e `± 2f_rot` em torno de cada linha acima, e linhas em `f_rot`, `2f_rot` | −20 dB (máquina boa) a −8 dB (gasta: `excentricidade` do preset 0..1) | todas |
| Magnetostrição e forças de 2·f da rede | `2·f_rede` (100/120 Hz) e harmônicos `4f`, `6f`, `8f`... a −6 dB por harmônico | alimentação direta da rede: +8 dB em plena carga (como o `alternador` do gerador, CENA 4.4) | motores industriais, transformadores de bordo (trem parado: linhas fixas), carregadores |

Modelo de radiação da carcaça (**decisão**): uma só curva `H_carc(f)` por família de carcaça (passa-alta de 2 polos em `f_carc` + platô + passa-baixa de 1 polo em 8 kHz): motor de carro `f_carc` 400 Hz; motor de tração de trem 250 Hz; motor de ferramenta/drone 1 kHz. As forças de baixa ordem espacial irradiam melhor: as linhas com `k` = 0 levam +3 dB sobre as de `k` = ±1 (já embutido na tabela).

### 1.2 Inversor PWM

A tensão de fase de um inversor com PWM senoidal (amostragem natural, Holmes & Lipo) tem grupos de portadora `m·f_c` com bandas laterais `n·f_e`:

$$V_{mn} = \frac{4V_{dc}}{m\pi}\,J_n\!\left(\frac{m\pi M}{2}\right)\sin\!\left(\frac{(m+n)\pi}{2}\right)$$

só com `m + n` ímpar: `m` ímpar → `n` par (`f_c`, `f_c ± 2f_e`, `f_c ± 4f_e`); `m` par → `n` ímpar (`2f_c ± f_e`, `2f_c ± 3f_e`). A corrente é a tensão sobre `2π f L`, e a força sonora é o produto da corrente de chaveamento pelo fluxo fundamental, então as linhas **acústicas** ficam nas mesmas frequências (mais `± f_e`, que fica dentro do mesmo grupo). Amplitudes em dB relativas à linha `f_c` com `M` = 0,2 (a tabela que o DSP usa; `M` = `V/V_max`, sobe linearmente com a velocidade até a base e fica em ≈ 1 acima):

| Linha | `M` 0,2 | `M` 0,6 | `M` 1,0 |
|---|---|---|---|
| `f_c` | 0 | −1,9 | −6,3 |
| `f_c ± 2f_e` | −38,0 | −19,4 | −11,8 |
| `f_c ± 4f_e` | < −70 | −54 | −36 |
| `2f_c ± f_e` | −16,3 | −10,5 | −16,7 |
| `2f_c ± 3f_e` | −52 | −24,8 | −15,3 |
| `3f_c` | −11,4 | −23,5 | −21 |
| `3f_c ± 2f_e` | −29 | −15,8 | −26 |

(valores `20·log₁₀[(|J_n(mπM/2)|/m) / J₀(0,1π)]`: a tensão, com o `1/m` da fórmula). Para a **corrente** o DSP aplica mais `1/m` (−6 dB no grupo `2f_c`, −9,5 dB no `3f_c`), depois `I/I_n` (a força é corrente × fluxo) e `H_carc(f)`. Em parado com torque (`f_e` ≈ 0) as bandas laterais caem em cima da portadora: tom puro em `f_c`, `2f_c`, `3f_c` — é exatamente o patamar de 600/1200/1800/2400 Hz do Taurus medido na seção 3.

**Modos de modulação** (o campo `modulacao` do comando; **decisão**: os cinco modos abaixo, mais `chopper`, e um `auto` por preset):

1. **Assíncrona fixa**: `f_c` constante (2–20 kHz nos carros, 0,5–2,5 kHz nos trens e bondes IGBT, 300–600 Hz nos GTO). As bandas laterais abrem com a velocidade (`± 2f_e` separa-se de `f_c`): é o "leque" que se vê nos espectrogramas dos metrôs.
2. **Assíncrona em escada (o do-re-mi)**: `f_c` muda por degraus fixos em função de `f_e`. O Siemens Taurus ES64U2 (inversor GTO) sobe a **escala de dó maior de G3 a D5** e fica em D5: medido nas quatro gravações (seção 3.1): 196 → 220 → 247 → 262 → 294 → 330 → 350 → 392 → 440 → 494 → 523 → 587 → patamar em **598 ± 5 Hz** (a nota real do patamar fica 1–3% acima de D5), com os harmônicos `2f_c` (−4 a −6 dB), `3f_c` (−5 a −9) e `4f_c` (−3 a −8) bem visíveis. Cada degrau dura 0,2–1,0 s e a escala inteira 3–6 s, dependendo da aceleração; o primeiro (196 Hz) é o mais longo. **Decisão**: os degraus são limiares de `f_e`, não de tempo: degrau `k` (0..11) vale para `f_e ∈ [f₀ + k·Δ, f₀ + (k+1)·Δ)`, com `f₀` = 0,25 Hz e `Δ` = 0,40 Hz (D5 começa em `f_e` = 4,65 Hz, que com `i` 3,69, `p` 2 e `r_w` 0,575 é 2,28 m/s ≈ 8 km/h), e o patamar de 598 Hz vale daí até a troca para síncrona. Com 0,35 m/s² de aceleração os 11 degraus levam 6,2 s; com 0,6 m/s², 3,6 s: as durações das gravações A (6,0 s) e D (3,0 s). O patamar foi medido ainda a ~30 km/h (Doppler da locomotiva se afastando: 603 → 587 Hz, −2,6%).
3. **Síncrona**: `f_c = N·f_e`, `N` numa lista decrescente (GTO: 15, 11, 9, 7, 5, 3, 1; IGBT de trem: 21, 15, 9, 5, 3, 1; **≈**, as listas exatas não são públicas). A troca acontece quando `N·f_e` ultrapassa `f_c,max` do semicondutor: o tom sobe com a velocidade dentro de cada modo e **cai** na troca (`600 → 440 → 600 → 491 → 600 → 467 → 600 → 429 → 600 → 360` Hz no modelo do Taurus com `f_c,max` 600 Hz). `N` = 1 é onda quadrada (bloco pleno): só `f_e` e os harmônicos ímpares `5f_e`, `7f_e` (−14 dB) e o `6f_e` resultante. Cada troca dura 20 ms com crossfade de potência constante entre os dois conjuntos de linhas.
4. **Troca assíncrona ↔ síncrona** (CPTM/Metrô SP, Alstom Onix): `auto` usa assíncrona até `f_c/f_e < N_max` e cai na lista síncrona; na frenagem o caminho é o inverso. É o som "de marchas" dos trens IGBT.
5. **Espalhamento espectral (random PWM)**: `f_c` sorteada a cada período uniformemente em `f_c·(1 ± δ)`, `δ` 0,1–0,2. Resultado acústico: as linhas viram bandas de largura `2δf_c` com o pico ≥ 12 dB abaixo do tom fixo de mesma energia. **Decisão**: sintetizar como ruído passa-banda (Q = 1/(2δ)) em `f_c` e `2f_c` com a mesma energia da tabela de Bessel, sem as bandas laterais (ficam sob o ruído). Carros modernos (Tesla, BYD, SiC a ≥ 10 kHz) usam `δ` 0,1 e a portadora fica inaudível de qualquer forma.
6. **Chopper de CC** (metrôs e trólebus antigos, motores CC série): tensão picada em `f_ch` fixa (300–1000 Hz, tiristores) com ciclo de trabalho `D` = `V/V_linha`. A ondulação de corrente é `ΔI ∝ V·D·(1 − D)/(L·f_ch)`: máxima em `D` = 0,5 (meia velocidade), zero em `D` = 1 (chopper em curto, "série plena"). Linhas em `f_ch`, `2f_ch`… `5f_ch` a −4 dB por harmônico, amplitude `∝ D(1 − D)·I`; ao chegar a `D` = 1 o tom some de vez (clique de 20 ms). Sem gravação de chopper no conjunto: alvo só de física.

**Conversores auxiliares** (trem parado): o inversor estático que alimenta ventiladores e ar-condicionado a 50/60 Hz dá linhas **fixas** em `f_c,aux` e `2f_c,aux` com bandas laterais a `± f_rede` e `± 2f_rede`. Medido no CPTM 9500: 1333 Hz com ±57 Hz (≈ 60 Hz) e 2666 Hz com ±57, −5 a −13 dB rel. ao grave; no Taurus parado: 176, 527 e 688 Hz; no Citadis de Lyon parado: 167 Hz (0 dB), 3879 Hz (−16). Esses conversores são uma fonte `aux` própria do portador trem/bonde, constante, independente da tração.

### 1.3 Mecânica

| Fonte | Frequências | Amplitude e lei | Notas |
|---|---|---|---|
| Engrenamento (redução) | `f_m,j = Z_j·f_j` por estágio (dentes do pinhão × rotação do pinhão); harmônicos 2–4 a −8, −14, −18 dB; bandas laterais `± f_j` (pinhão) e `± f_j/i_j` (coroa) a −10 dB | `L_W = L_ref + 20·log₁₀(T/T_ref) + 20·log₁₀(n/n_ref)` (6 dB por duplicação de torque, como a `caixa` do rotor); em torque ≈ 0 (`|T| < 3% T_n`) o engrenamento some e entra o **chocalho** (ruído largo 1–4 kHz, −15 dB, modulado em `f_j`) | Tesla `i` ≈ 9:1 em 2 estágios helicoidais; Fórmula E com dentes retos (+10 dB); metrôs 1 estágio `i` 6–7 |
| Mudança de flanco | clique de 30–60 ms (ruído `bp` 800 Hz, Q 1) quando `T` cruza zero (tração ↔ regeneração) | −10 dB rel. ao engrenamento em carga | regeneração ao soltar o pedal |
| Rolamentos | ruído largo 2–10 kHz, `∝ 20·log(n)`, com modulação fraca nas frequências de defeito (ignoradas) | −20 dB rel. ao engrenamento | todas |
| Ventilação forçada | BPF `B_v·f_v` + 3 harmônicos (κ 0,6) + ruído `bp` 1 kHz, como o `ventilador` do gerador | fixa (soprador 2 polos de 50/60 Hz: 2950/3550 rpm) nos trens e trólebus; `∝ n` (autoventilado: `f_v = f_rot`) nas ferramentas; `L_W` 95 dB(A) por soprador de tração, `n` 5,5 em rotação | Taurus, Vectron, metrôs, trólebus, N700 |
| Escovas e comutador (CC e universais) | `Z_c·f_rot` e `2·Z_c·f_rot` (tons de comutação; medido: ×8, ×12 e ×24 de `f_rot` na furadeira sem fio, ×10 e ×20 na furadeira de rede) + faiscamento: ruído largo 2–10 kHz **modulado** em `Z_c·f_rot` com profundidade 0,5 | tons `∝ I`; faiscamento `∝ I^1,5`, +6 dB nas escovas gastas | furadeira, liquidificador, trólebus CC, Frota A |
| Hélice de drone (BPF) | `f_B = 2·f_rot` (2 pás), harmônicos até o 12º: medido no Mavic `a_h` = 0, −6, −7, −6, −10, −8, −13, −19, −18, −18, −24 dB (κ ≈ 0,23 média), mais ruído largo de pá plano de 400 Hz a 12 kHz | `L_W ∝ 50·log(n)` (dipolo de carga); quatro rotores com rotações diferentes (medido 189, 205, 208, 211 Hz de BPF: −10% a +1%) batem a 2–20 Hz | o "zumbido" do drone é hélice + motor; o motor entra em `6f_e`, `8f_e`, `9f_e` (seção 1.1) e `Z_s·f_rot` |
| ESC de drone | 6 passos: `6·f_e = 6p·f_rot` (12N14P: 42·f_rot) + `12f_e`; medido: Mavic linha forte em **63·f_rot = 9·f_e** (6,6 kHz, −13 dB rel. BPF, oscilando ±1,5% com o controle de rotação); drone 2: `6f_e` em 8,0–8,3 kHz e `8f_e` em 10,7–11,1 kHz | — | PWM do ESC a 8–48 kHz: inaudível e acima de Nyquist: **não se sintetiza** |

### 1.4 Carga, velocidade e comando

Mapa de torque (**decisão**, um por preset): `T_max(ω) = T_n` para `ω ≤ ω_base`; `P_max/ω` acima; limite de tensão `ω_max`. Pedal `a` ∈ [0, 1] → torque pedido `T = a·T_max(ω)` (mais um *creep* de 3% de `T_n` abaixo de 5 km/h nos carros com `creep: true`). Corrente relativa `I/I_n = |T|/T_n` abaixo da base; acima, `I/I_n ≈ |P|/P_max` (enfraquecimento de campo: `I_d` negativa ocupa o que `I_q` libera, a corrente total fica perto da nominal em plena potência). Índice de modulação `M = min(1, ω/ω_base)`; em `M` = 1 muitos inversores vão a seis passos (`modo síncrono N = 1`). Fluxo `Φ/Φ_n = min(1, ω_base/ω)` (as linhas `2f_e` e de ranhura escalam com `Φ`).

Regeneração: o freio `b` ∈ [0, 1] pede `T = −b·T_regen` (`T_regen` 0,3–0,5 `T_n` nos carros, 1,0 nos trens com freio elétrico pleno) enquanto `v > v_regen,min` (5 km/h no carro, 10 km/h no trem; abaixo, o freio de atrito, mudo), com rampa de 0,3 s; o som é o mesmo conjunto de linhas, com `I/I_n = |T|/T_n`: a "subida" do uivo na frenagem é o torque indo de ≈ 0 (rolando) a `−T_regen`. A troca de flanco das engrenagens dá o clique de 1.3.

Indução: `f_e = p·f_rot + f_slip`, `f_slip = s_n·f_e,n·(T/T_n)` (escorregamento nominal 1–3%: `f_slip,n` 1–2 Hz de tração, 0,5 Hz nos de alta eficiência). Em regeneração `f_slip` < 0.

Dinâmica longitudinal (portador): `m·dv/dt = T·i·η/r_w − F_res`, `F_res = ½ρC_dA·v² + C_rr·m·g + m·g·sen θ` (carro, `C_rr` 0,010–0,012, `η` 0,95); trem: Davis `F = A + B·v + C·v²` por trem (metrô de 6 carros carregado: `A` 7 kN, `B` 0,12 kN/(m/s), `C` 0,012 kN/(m/s)²; N700 16 carros: `A` 10 kN, `B` 0,13, `C` 0,024), `η` 0,93, com `m_eq = 1,06·m` (massas girantes). Carga no eixo do motor pela interface `Carga` do CENA: `torque(ω) = (F_res·r_w)/(i·η·n_motores)` mais a inércia `m_eq·r_w²/(i²·n_motores)` refletida (o trem de 360 t com 16 motores, `i` 6,3, `r_w` 0,43: 1,06·360000·0,185/(39,7·16) = 111 kg·m² por motor: o eixo mal se mexe num bloco; a integração é a mesma dos outros motores, `J·dω/dt = T − T_carga`).

Velocidade imposta (`velocidadeFixa` da Passagem e do modo de testes): `ω = v·i/r_w` fixo e o torque vem do pedal: é o dinamômetro de rolo do `CarroLegado`.

### 1.5 Propagação: o que se ouve de um elétrico

As fontes são tonais e de alta frequência, e pequenas: motor e inversor viram monopolos (`expConv` 2, omni, com a tabela de diretividade só pela carcaça: `[0, 0, −1, −3, −5, −7, −8]` no eixo do motor, tampa traseira mais fraca). A engrenagem irradia pela carcaça da redução, mesma posição. Tudo `dentro: true` nos carros (sob o capô ou na traseira) com vias estruturais para a cabine (o uivo que se ouve de dentro de um Tesla é mais via estrutura que pelo ar: `vias.cabine = {ganho 0,6, fc 6000}`, `cofre {1,0, 0}`); nos trens, sob o assoalho (`hCorpo` 0,5: a Cena aplica a sombra do piso de 2.5, que tira 6–10 dB a 1 kHz a 3 m e é o que faz o metrô soar "abafado" de perto e "zunindo" de longe).

Ordem de grandeza a 7,5 m da lateral, 50 km/h, carro (`L_p = L_W − 28,5` dB a 7,5 m): pneus 65 dB(A) (CENA 4.1: 95 dB(A) por roda a 80 km/h, `n` 3,5: 101 de `L_W` a 80, 94 a 50), aero 39 (80 dB(A) a 80 km/h, `n` 6: o vento só conta de dentro e em alta velocidade), motor + redução em aceleração plena 58–62 (`L_W` 86 + 84), inversor 43 (`L_W` 72), AVAS 0 (acima de 20 km/h). **Logo**: o trem de força só se ouve de fora abaixo de ~30 km/h ou a pé no fundo; o AVAS existe por isso. Na cabine, com o pneu filtrado pela casca (lei da massa), o uivo tonal de 1–4 kHz é o que sobra. **Decisão**: o `CarroEletrico` liga as fontes `pneu.k` e `aero` do CENA 4.1 por padrão (elas estão desligadas no `CarroLegado` por decisão do Ronco, não por física), com os níveis e espectros de lá.

Comprimidos (YouTube) cortam em ~16 kHz e atenuam antes: as gravações valem até 6 kHz (regra já usada no trem); acima, vale a física e a regra de Nyquist da seção 7.

---

## 2. AVAS / VSP

Veículos elétricos e híbridos precisam de um som artificial a baixa velocidade: UE/UNECE **R138** (obrigatório desde 2021): de 0 a **20 km/h** e em ré, nível mínimo **50 dB(A) a 10 km/h** e **56 dB(A) a 20 km/h**, 47 dB(A) em ré, máximo 75 dB(A), medidos a 2 m da linha do veículo (ISO 10844), com pelo menos uma banda de 1/3 de oitava entre 160 e 5000 Hz acima do fundo e **deslocamento de frequência ≥ 0,8% por km/h** em pelo menos um componente (o som tem de "subir" com a velocidade); EUA **FMVSS 141**: até **30 km/h**, mínimos por bandas de 1/3 de oitava (315–5000 Hz) a 2 m, deslocamento de tom ≥ 1% por km/h, e mínimos por banda também com o veículo parado em "D". O Brasil não exige; os carros vendidos aqui trazem o da homologação de origem.

Síntese genérica (**decisão**: nada que imite uma marca):

- Três componentes: (1) um **tom composto** de 3 parciais inarmônicas (`f₁` = 250 Hz, `f₂` = 1,62·f₁, `f₃` = 2,41·f₁ a 0, −4, −8 dB) com `f₁ ∝ (1 + 0,012·v_kmh)` (1,2%/km/h, acima dos dois mínimos) e vibrato de 0,15 Hz ±0,5%; (2) **ruído** passa-banda 400–3000 Hz (`bp` 1 kHz, Q 0,6) modulado lentamente (0,8 Hz, ±2 dB), +3 dB por 10 km/h; (3) um **ritmo** opcional a `v/2 m` (um pulso por 2 m percorridos, 60 ms, −6 dB) para dar sensação de movimento.
- Nível no para-choque: `L_W = 74 + 0,6·v_kmh` dB(A) (2 m: 55 dB(A) a 0 km/h, 61 a 10, 67 a 20 — com margem de 6 dB sobre a R138, que mede com fundo), liga ao arrancar (`ignicao` e `v < 20`) e desliga com rampa de 2 s acima de 20 km/h (30 com `avas: 'eua'`); em ré, `f₁` = 200 Hz e um pulso a 1,5 Hz (o "bip" discreto).
- Fonte `avas` tipo `eletrica`, no para-choque dianteiro `[2,2; 0; 0,4]` (traseiro em ré), eixo `[1, 0, 0]`, tabela `[0, −1, −3, −6, −9, −12, −14]` (alto-falante numa cavidade do para-choque), `expConv` 2, `dentro: false`, `refDist` 7,5 m. Na cabine chega pela casca (lei da massa), como o pneu.
- Chave `avas` no painel (`desligado` / `ue` / `eua`): no preset vem do país de origem do carro.

---

## 3. Alvos medidos nas gravações

Gravações em `/tmp/claude-1000/-home-ezenere-Documents-Projects-Engine/e31418c8-04d3-4470-8423-a94efb88e841/scratchpad/real2/eletrico/wav/` (índice em `../INDEX.md`, seção `eletrico`; WAV mono 48 kHz; as do YouTube são referência privada, comprimidas, só até 6 kHz). Ferramentas usadas (Python `-I` + numpy/scipy) em `/tmp/claude-1000/-home-ezenere-Documents-Projects-Engine/e31418c8-04d3-4470-8423-a94efb88e841/scratchpad/eletrico-analise/` (`survey.py` bandas e picos por arquivo, `ridges.py` picos por meio segundo, `spec.py` espectrogramas PNG, `doremi.py` patamares do Taurus, `comb.py` bandas e linhas por trecho, `ordens.py` razões entre linhas; copiar o que servir para `tools/eletrico/` em TypeScript). Bandas em dB relativos a 150–400 Hz (sem ponderação), centroide até 6 kHz. **Tolerâncias** (**decisão**): linhas ±1% (±2% para o patamar do Taurus, que varia 595–605 entre gravações); bandas ±4 dB de 150 Hz a 6 kHz, ±6 dB em 20–150 Hz (vento e manuseio do microfone), 6–12 kHz só informativo; centroide ±25%; razões entre ordens ±0,05.

### 3.1 Siemens Taurus ES64U2: o do-re-mi (4 gravações)

Patamares medidos (`doremi.py`, pico de 150–800 Hz a cada 50 ms, janela de 170 ms; frequência mediana, duração, nível do tom relativo ao total de 100 Hz–6 kHz):

| Nota | Alvo (Hz) | A (`-SDYdHzT7Qw`) | D (`cfWXzTl8mT0`) | B (`_iLrXDU31Dg`) |
|---|---|---|---|---|
| G3 | 196 | 195,9 (1,05 s, −8 dB) | — (abaixo do ruído) | 196 (0,5 s) |
| A3 | 220 | 220,3 (0,2 s) | 220,1 (0,4 s, −4,5 dB) | — |
| B3 | 247 | 246,6 (0,4 s) | 246,8 (0,2 s) | 240 |
| C4 | 262 | 261,1 (0,5 s) | 261,8 (0,45 s) | 261,6 (0,5 s) |
| D4 | 294 | (293, curto) | 294,4 (0,25 s) | — |
| E4 | 330 | 328,8 (0,25 s) | 330,9 (0,3 s) | 340,8 |
| F4 | 349 | 355,6 (0,2 s) | (350, curto) | 349 |
| G4 | 392 | 390,3 (0,5 s) | 393,3 (0,4 s) | 392,4 |
| A4 | 440 | 437,0 (0,35 s) | 441,6 (0,3 s) | — |
| B4 | 494 | 492,7 (0,35 s, −4,4 dB) | (490, curto) | 495,9 |
| C5 | 523 | 530,8 (0,25 s) | (525, curto) | 519,1 |
| D5 (patamar) | 587 → **598 ± 5** | 587,6 → 597,3 (≥ 5 s até o corte) | 602,8 → 598 (hold 20–27 s; 591 a 28–35 s, Doppler) | 599,7 (15–30 s) |

Escala inteira: A 15,05 → 21,1 s (6,0 s, 11 degraus); D 17,2 → 20,15 s (3,0 s). Harmônicos no patamar (D, 21–26 s): 605 (0), 1203 (−4), 1806 (−9), 2380 (−8), 2111 (−12: banda lateral `2f_c + ...` do grupo par), 2996 (−22). Em A: 1192 (−11), 1790 (−15), 2382 (−22). Linhas fixas com a locomotiva parada (A, 3–12 s): 59 (0), 176 (−2), 526 (0), 467 (−8), 684 (−8), 1660 (−9): conversor auxiliar e ventilação (o DSP as põe na fonte `aux` do preset, a −10 dB do tom do inversor). Bandas: parado (A) −6,0 / −2,2 / 0 / +1,0 / −3,2 / −7,0 / −12,3, centroide 697 Hz; patamar (A) −11,5 / −1,8 / 0 / +3,2 / −2,0 / −12,4 / −17,5, centroide 622 Hz; patamar (D) −7,9 / −0,9 / 0 / +0,4 / +1,9 / −8,1 / −12,1, centroide 892 Hz. A gravação C (`mgcuAH807Yw`) tem cortes e vários trechos; serve só para conferir a presença das linhas fixas 525/1240/2450 Hz (locomotiva parada, 39–67 s) e de uma escada parcial 200 → 350 Hz em 128–134 s.

### 3.2 Metrôs e trens IGBT (dentro do carro)

**CPTM Série 9500 (Hyundai Rotem; `pKXWDOyY-Ow`)**: duas famílias de ordens que sobem juntas com a velocidade, na razão **2,24 ± 0,02** (medido em 37 s: 425 e 955 Hz; 150 s: 510 e 1131; 156 s: 571 e 1286); a família de baixo sobe 410 → 609 Hz entre 142 e 159 s (≈ 12 Hz/s em aceleração de serviço). O segundo harmônico da família de baixo é fraco (−30 dB). Interpretação para o preset: engrenamento `Z_p` = 16 dentes (família 1) e ranhuras do estator `Z_s` = 36 (família 2; 36/16 = 2,25). Conversor auxiliar com o trem parado (84–92 s): **1333 Hz** (−5 dB rel. ao grave) com bandas laterais 1276 e 1390 (±57 Hz ≈ ±60 Hz, −10/−13) e **2666** com ±57, ±114, ±171 (−33 a −37); linhas fixas 542 (0) e 656 (−12) (compressor/ventilação). Bandas acelerando (140–160 s): −7,1 / +0,8 / 0 / −0,3 / −12,8 / −14,8 / −13,4, centroide 301 Hz (de dentro, o grave do rolamento domina); parado (84–92): −5,5 / −1,3 / 0 / +0,9 / −4,3 / −18,7 / −18,7, centroide 424. Trecho com bina de porta em 8–10 s (harmônicos ímpares de 528 Hz) fora dos alvos.

**CPTM Série 9000 (CAF; `u3oip0ZNLeU`)**: três ordens na razão **1 : 1,44 : 2,45** (102 s: 396, 577, 973; 107 s: 363, 445?, 850/894; 45 s: 363, 521, 888); na frenagem regenerativa (96–111 s) a família cai de 1150 para 700 Hz em 12 s (≈ 38 Hz/s); duas linhas quase fixas em 2,0 e 2,3 kHz (38–44 s, variam < 3% enquanto as ordens variam 2:1: portadora ou auxiliar). Bandas (70–90 s): −18,2 / −6,5 / 0 / −0,1 / −16,5 / −22,0 / −33,8, centroide 435 Hz.

**Metrô de Paris MP 73 (reostático, controle JH, pneus; 2 gravações do Commons)**: **não é chopper**: não há portadora nem linha fixa de tração. O que há: a bina de fechamento de portas (pente de 520 Hz, 3,4 s, e de 305/337 Hz, 3,2–3,5 s: harmônicos até 5 kHz: fora dos alvos) e, em movimento, uma corcova larga de ruído (motor CC + redução + pneus) cujo centro sobe de ~300 Hz (14 s) a ~700 Hz (34 s) e volta (54 s) com a velocidade, com ordens fracas de 500–1100 Hz; bandas rolando (20–45 s): −8,6 / +1,2 / 0 / −4,1 / −7,5 / −11,9 / −26,1, centroide 373 Hz. É a referência da família **CC reostática** (sem inversor): corcova `bp` em `f_centro = 300 + 400·(v/v_max)` Hz, Q 0,7, mais escovas fracas.

### 3.3 Carros: Tesla e Leaf

**Tesla Model S Plaid, lançamento, de dentro (`HrcpKbpuEwY`)**: rolando devagar (7–9 s) uma linha **fixa em 10,0 kHz** (0 dB na banda 3–16 kHz, −51 dB rel. ao grave: candidata à portadora SiC) e outra em 11,9 kHz (5 s); no lançamento (12–16 s) uma crista larga de 100–300 Hz (pneu/assoalho) e famílias de ordens subindo de 300 para > 1000 Hz; no fim (17–20 s) um feixe denso em 500–1600 Hz (680, 758, 794, 876, 958, 1104, 1172, 1280–1342, 1500, 1559 Hz; razões ≈ 1,4 e 2 entre subfamílias). Bandas 12–17 s: −26,3 / −4,5 / 0 / −3,0 / −7,7 / −19,8 / −32,8, centroide 418; 17–20 s: −16,7 / +0,5 / 0 / +9,5 / +9,7 / −7,0 / −35,6, centroide 1024 Hz. Lição: na cabine em aceleração plena as linhas do trem de força ficam só 5–10 dB acima do largo.

**Tesla Roadster, de fora (7 s, Commons)**: vento no microfone (+12,5 dB em 20–60 Hz), linhas 486 (0), 1072 (−8), 1408 (−11), 2675 (−17): só informativo.

**Nissan Leaf 109 hp, aceleração, de dentro (`mzxV8KVhrpE`)**: a linha mais aguda sobe de ≈ 2,5 kHz (5 s) a **9,5 kHz (14 s)**, ~780 Hz/s em aceleração plena (0–100 em 11,5 s ⇒ ≈ 85 km/h a 14 s: compatível com `2·Z_s·f_rot` = 96·f_rot, `f_rot` ≈ 99 Hz = 5940 rpm); uma segunda família a **1/1,46** dela (6,5 kHz a 14 s) e famílias baixas (300 → 1300 Hz e 500 → 2200 Hz em 5–14 s). Em 5–7 kHz, grupos de 5–8 linhas espaçadas ≈ 300–440 Hz (bandas laterais `± 2f_e` da ordem de ranhura: `2f_e` = 8·f_rot). Linha fraca fixa em 9,6–10,0 kHz (−45..−51 dB rel. ao grave; candidata à portadora). A linha de ~390–400 Hz que não muda com a velocidade é do carro (não entra). Bandas 6–19 s: +3,4 / +6,7 / 0 / −4,6 / −14,3 / −14,7 / −16,9, centroide 147 Hz.

**Alvos derivados**: Leaf: razão entre as duas famílias agudas 1,46 ± 0,05; a mais aguda em 96·f_rot; ordem de ranhura visível com bandas laterais `± 2f_e`. Tesla: portadora ≈ 10 kHz, fraca (≥ 40 dB abaixo do grave de cabine); uivo de redução + motor em 0,5–3,5 kHz só 5–10 dB sobre o largo na cabine.

### 3.4 Bondes e Schwebebahn

**Citadis, Lyon (Commons)**: bonde chegando (10–14 s) e saindo (52–56 s) com linhas **fixas em 2,52 e 5,05 kHz** (`f_c` e `2f_c`, o `2f_c` mais forte: 0 dB contra −3..−10) com Doppler de ±1,3% (≈ ±2 m/s); parado (18–50 s): 167 Hz (0), 3879 (−16), 1942 (−22), 5473 (−24): auxiliares. Bandas parado: −25,3 / −7,6 / 0 / −8,0 / −14,0 / −15,8 / −18,8, centroide 340 Hz.

**Urbos 3, West Midlands (Commons)**: linha fixa em **2,09 kHz** nas acelerações (21–25 e 32–38 s), 1,89–1,91 kHz em outros trechos (outro carro/conversor); grave 103–144 Hz; bandas 18–40 s: −11,1 / +1,6 / 0 / −1,5 / −6,7 / −4,7 / −23,5, centroide 617 Hz. Alvo de classe para bondes IGBT: `f_c` 2,0–2,5 kHz fixa, `2f_c` audível.

**Schwebebahn de Wuppertal (WWS, Commons)**: andando: 311–313 Hz (0), 627 (−6), 798 (−9), fixas; partida: um soprador subindo de 300 a 780 Hz em 5 s e ficando (motor de ventilação), bipes a 2,7–2,8 kHz. Bandas andando (5–45 s): −27,7 / −9,0 / 0 / −0,8 / −4,7 / −11,9 / −16,0, centroide 664 Hz. Só informativo (ventilação fixa + motor CC).

### 3.5 Ferramentas

**Furadeira sem fio 2 (`X0ihOikLuQU`)**: `f_rot` = **247,5 Hz** (14 850 rpm) com ×1 (−3), ×2 (−6), ×3 (−2), ×5 (−6), ×6 (−3), **×8 (−1: 1976 Hz)**, **×12 (0: 2988 Hz)**, ×24 (−10: 5975 Hz): comutador de 12 lâminas (`Z_c` = 12: `Z_c·f_rot` e `2Z_c·f_rot`), com o ×8 de ranhura/escova; ao apertar o gatilho (27–33 s) a linha ×8 sobe de 1,0 a 2,0 kHz em 3 s. Bandas (30–34 s): −25,4 / −23,5 / 0 / +4,9 / +17,0 / +16,7 / +19,7, centroide 2793 Hz. **Furadeira sem fio 1 (`dzOO2IBtGxg`, trecho repetido a cada 26 s)**: aglomerado de linhas em 1,11–1,44 kHz (1113, 1179, 1214, 1304, 1342, 1438) + 258, 362, 486, 611, 798 Hz, sem fundamental limpa (redução planetária de 2 estágios com bandas laterais do porta-planetas); bandas −27,8 / −16,2 / 0 / +1,0 / +8,2 / −0,7 / −3,3, centroide 1422 Hz. **Furadeira de rede furando (`OMgXpoYbcKg`, 24–30 s)**: `f_rot` ≈ 387 Hz (23 200 rpm), linhas ×2 (773), ×4 (1553), **×10 (3926, 0 dB)**, **×20 (7857, −17)**: `Z_c` = 10; largo de 2,5–8 kHz muito forte (broca na madeira): bandas −41,3 / −20,5 / 0 / +4,9 / +14,7 / +22,7 / +19,7, centroide 3563 Hz.

### 3.6 Drones

**DJI Mavic Pro pairando (`Abyu0qtq_v4`)**: BPF **209 Hz** (2 pás ⇒ 6270 rpm) e harmônicos: 209 (0), 419 (−6), 627 (−7), 836 (−6), 1047 (−10), 1257 (−8), 1468 (−13), 1673 (−19), 1879 (−18), 2092 (−18), 2295 (−24); segundo grupo de rotores em 189 Hz (−8) (e 205/211 em outros instantes); `f_rot` 104,5 Hz (−18); linha do motor em **6602 Hz = 63·f_rot = 9·f_e** (−13 dB rel. BPF, oscilando ±100 Hz); nada entre 3 e 12 kHz além dela. Bandas (10–30 s): −28,7 / −16,6 / 0 / +0,8 / +0,7 / −2,3 / +0,8 / −9,3, centroide 1305 Hz (ruído largo de pá plano até 12 kHz). **Drone 2 (`DUTQkbuzxtk`)**: BPF 382 Hz (11 460 rpm, drone menor), `f_rot` 192 Hz (−20), harmônicos 757 (−12), 1154 (−6), 1525 (−11), 1910 (−15), 2292 (−16; = 12·f_rot, ranhuras); motor em 8,0–8,3 kHz (`6f_e`) e 10,7–11,1 kHz (`8f_e`), oscilando; bandas −41,0 / −36,9 / 0 / −3,2 / +0,1 / −2,4 / −5,6, centroide 1424 Hz.

### 3.7 Tabela-resumo dos alvos (o que `tools/eletrico/valida.ts` confere)

| Caso | Medida | Alvo |
|---|---|---|
| Taurus, escada | 12 patamares nas notas da tabela 3.1 | ±1% cada; ordem crescente; patamar final 598 ± 12 Hz; `2f_c`/`3f_c`/`4f_c` a −4..−9 / −5..−15 / −3..−10 dB |
| Taurus, patamar | bandas e centroide | A: −11,5 / −1,8 / 0 / +3,2 / −2,0 / −12,4; 622 Hz (±4 dB, ±25%) |
| Taurus, parado | linhas fixas | 176, 527, 688 Hz a −8..−12 dB do tom do inversor em escada |
| CPTM 9500 | razão entre as duas famílias; SIV | 2,24 ± 0,05; 1333 Hz ± 60 Hz, 2666 ± 60 |
| CPTM 9000 | razões | 1 : 1,44 : 2,45 (±0,05) |
| Leaf | razão das famílias agudas; linha máxima | 1,46 ± 0,05; 96·f_rot chega a 9,5 kHz a 85 km/h |
| Tesla | portadora | ≈ 10 kHz, ≥ 40 dB abaixo do grave na cabine |
| Bonde IGBT | `f_c` fixa | 2,0–2,5 kHz, `2f_c` ≥ `f_c` |
| Furadeira sem fio | linhas | `f_rot` 247,5 Hz; ×8, ×12 dentro de 3 dB do máximo; ×24 a −10 ± 4 |
| Furadeira de rede | linhas e bandas | ×10 e ×20 de 387 Hz; bandas 2,5–6 kHz +23 ± 4 dB |
| Mavic | BPF e harmônicos; motor | 209 Hz; `a_h` da tabela ±3 dB até o 7º; 63·f_rot a −13 ± 4 dB |
| Drone 2 | BPF; `6f_e` | 382 Hz; `6f_e` em 8,0–8,3 kHz |
| MP73 | corcova | centro 300 → 700 Hz com a velocidade; sem linha fixa > −30 dB |

---

## 4. Interfaces

### 4.1 `EletricoDSP` (`src/engines/eletrico/dsp.ts`)

Determinístico (RNG com semente por fonte). Estado: `omega` (rad/s do motor), `T` (N·m), `I/I_n`, `M`, `Φ`, `f_e`, `f_c`, `N`, modo, `v` do portador (para o AVAS e para o chocalho). Um objeto por motor **físico modelado**; para `n_unidades` motores iguais (trem, drone) o DSP guarda até 4 **unidades** com desvios próprios de rotação (`detune` ±0,3% a ±5%) e sementes próprias; cada unidade preenche os seus canais.

```ts
export interface PresetEletrico {
  nome: string; familia: 'eletrico';
  maquina: 'pmsm' | 'pmsrm' | 'inducao' | 'sincrona-excitada' | 'cc-serie' | 'universal' | 'bldc';
  p: number;              // pares de polos
  Zs: number; Zr?: number; Zc?: number;   // ranhuras do estator, barras do rotor (indução), lâminas (CC/universal)
  Tn: number; Pmax: number; rpmBase: number; rpmMax: number; J: number;   // mapa de torque e inércia do rotor
  escorregamentoNominal?: number;          // indução: s_n (0,01–0,03)
  inversor: null | {                       // null = rede direta (industrial) ou CC sem chopper (reostático)
    tipo: 'igbt' | 'gto' | 'sic' | 'chopper' | 'csi';
    fc: number;                            // Hz, portadora/chaveamento máximo
    modo: 'assincrona' | 'escada' | 'sincrona' | 'auto' | 'aleatoria' | 'chopper';
    escada?: { f0: number; delta: number; notas: number[] };   // Taurus: f0 0,25, delta 0,40, notas = 12 frequências
    sincrona?: number[];                   // lista de N decrescente
    delta?: number;                        // aleatória: ±δ
    fcAux?: number; fRede?: number;        // conversor auxiliar (trem parado)
  };
  reducao: { estagios: { Zp: number; Zc: number }[]; eta: number; retos?: boolean };   // i = Π Zc/Zp
  ventilacao: null | { forcada: boolean; B: number; rpm?: number };                    // soprador fixo ou autoventilado
  escovas?: { Zc: number; desgaste: number };
  helice?: { B: number; D: number; rotores: number; detune: number[] };               // drone
  carcaca: 'carro' | 'trem' | 'pequena';
  niveis: { motor: number; inversor: number; reducao: number; ventilador: number; escovas?: number; helice?: number; aux?: number };   // L_W dB(A) na condição de referência (4.3)
  avas?: 'ue' | 'eua' | null;
  creep?: boolean;
  nUnidades?: number; detune?: number;
  fontes: Record<string, { pos: Vec3; dentro: boolean }>;   // posições no referencial do motor
}
```

**Síntese (decisão)**: um `BancoDeLinhas` por fonte: até `L_max` linhas (motor 96, inversor 64, redução 32, escovas 8, hélice 16 por rotor, aux 12), cada uma um oscilador recursivo de 2ª ordem (rotação complexa `[c, s] ← [c·cosΔ − s·sinΔ, s·cosΔ + c·sinΔ]`, renormalizado a cada bloco de 64), frequência e amplitude com rampa linear no bloco. As listas `(f, a)` são recalculadas a cada bloco de controle pelas fórmulas da seção 1 e **ordenadas por amplitude**: entram só as `L_max` mais fortes acima de −60 dB da maior e abaixo de `0,45·fs`; uma linha que entra ou sai faz rampa de 20 ms (sem estalo). Ruídos: `FonteRuido`-like com semente (chocalho, faiscamento, rolamentos, ruído de pá, random PWM). Jitter de realismo: todas as linhas de um mesmo eixo recebem o mesmo desvio lento (passeio de ±0,05% a 0,3 Hz) e um tremor de amplitude ±0,5 dB; sem isso soa a sintetizador.

Canais (fontes do `Motor`, ordem fixa): `motor` (eletrica: 1.1), `inversor` (eletrica: 1.2 + aux quando parado), `reducao` (mecanica: engrenamento, chocalho, clique de flanco, rolamentos), `ventilador` (pa), opcionais `escovas` (mecanica), `helice.k` (pa, por rotor), `avas` (eletrica). Com `nUnidades > 1`, `motor.u`, `inversor.u`, `reducao.u`, `ventilador.u` por unidade.

Mensagens (`processador-eletrico.ts`): `{type:'input', acelerador, freio, ignicao}`, `{type:'eletrico', modulacao, avas, carga, velocidadeImposta}`, `{type:'params', master}`. Telemetria: `rpm, torque, potencia, corrente (I/In), fE, fC, N, modo, M, fluxo, v, nota (índice da escada), linhas: [{id, f, dB}]` (as 12 maiores, para o espectro anotado).

### 4.2 `MotorEletrico` (`src/engines/eletrico/motor.ts`), adaptador `Motor`

Segue o molde do `MotorDiesel`, sem `tap` (o DSP já escreve canais): `familia 'eletrico'`, `fontes` montadas de `preset.fontes` com `refDist` 7,5 m (motores novos: a convenção dos portadores, não a dos 5 m do Ronco), `eixo = {omega, torque, inercia: J}`, `estado` `desligado`/`funcionando` (sem partida: ligar é `ignicao`; `partida` ignorada), `governadorProprio` false (o controle de torque é instantâneo; o portador manda `acelerador` e `freio`). `comandar(c)`: `acelerador` → torque pedido; **extensões** (como `rpmAlvo` foi extensão): `c.freio` (regeneração 0..1), `c.modulacao`, `c.avas`, `c.v` (velocidade do portador em m/s, para AVAS e chocalho; o motor não conhece o portador), `c.omegaImposta` (dinamômetro: `null` = integra). `acoplar(carga)`: a `Carga` do CENA (torque resistente e inércia refletida), integrada em `J + carga.inercia`.

Nível absoluto (**decisão**): `niveis` do preset são `L_W` dB(A) **na condição de referência** = torque nominal na rotação de base (motor, inversor, redução), rotação nominal (ventilador, escovas, hélice em pairado); `kAbs` por fonte vem de uma sonda na thread principal (`sondarNivelEletrico`: 0,5 s na condição de referência, RMS ponderado A pelo `Acumulador` de `ronco/motor.ts`, `paDeLw(L_W, 7,5)`), como `sondarNivelDiesel`. Referências: carro (Tesla/Leaf) motor 86, inversor 72, redução 84, rolamentos dentro do motor; trem (por truque motor) motor 100, inversor 92 (GTO em escada: 98), soprador 95 (constante), redução 96, aux 85; bonde motor 95, inversor 90, redução 92, aux 82; trólebus motor 95 (CC: escovas 92), chopper 94, soprador 96, redução 93; furadeira motor 92, escovas 94, redução 96 (planetária), ventilador 90, total ≈ 100 dB(A) (≈ 90 dB(A) a 1 m); liquidificador motor 90, escovas 92, facas/jarra 98 (largo), total ≈ 100; drone (Mavic) hélice 80 por rotor (86 total), motor 70 por rotor (`9f_e`), total ≈ 87 dB(A) (≈ 76 dB(A) a 1 m); industrial 4 polos 11 kW: motor 78 (IEC 60034-9), ventilador 92. Tudo em dB(A) re 1 pW; tolerância ±2 dB na sonda.

### 4.3 Portadores (`src/carriers/`)

| Portador | Arquivo | Corpo | Carga no motor | Fontes próprias | Comando |
|---|---|---|---|---|---|
| **Carro elétrico** (`CarroEletrico`, novo; **não** reusa `CarroLegado`: aquele é o câmbio de dentro do `EngineDSP`) | `carro-eletrico.ts` | o `CORPO_CARRO` (4,6 × 1,85 × 1,4; `m_s` 12, `fCabine` 70, filtro de cabine do Ronco) com `massa`, `C_dA`, `C_rr`, `r_w`, `i`, `nMotores` (1 ou 2: traseiro + dianteiro com presets diferentes: Tesla), inclinação | `torque(ω) = F_res·r_w/(i·η·n)`, `inercia = 1,06·m·r_w²/(i²·n)`; integra `v` do `ω` do motor (`v = ω·r_w/i`) salvo `velocidadeFixa` | `pneu.k` ×4 e `aero` do CENA 4.1 **ligadas**; AVAS vem do motor | pedal → `acelerador`; `freio` → regeneração até `v_regen,min`, depois atrito (mudo); `marcha` ignorada (`'re'` inverte o sinal de `i` e liga o AVAS de ré); `modulacao`, `avas` passam |
| **Trem / metrô / trem-bala** (`Trem` existente ganha o motor) | `trem.ts` (acoplar deixa de lançar) | o de hoje (N vagões) + `carrosMotores: number[]`, `motoresPorTruque` 2, `i`, `r_w`, `massaTotal`, Davis | uma `Carga` para o conjunto: `torque = F_Davis·r_w/(i·η·n_motores)` | as de hoje; o motor entra com `nUnidades = min(4, truques motores)`, e o trem **replica** cada unidade nos truques motores (ciclicamente), somando `posMotor` por truque (`z` 0,5, `hCorpo` 0,5, `dentro: false`: sob o assoalho); `inversor.u` sob o assoalho do carro motor (`z` 0,6) com `ventilador.u` (sopradores); `aux` no carro com o conversor | `pedal` = tração 0..1 (notch contínuo), `freio` = freio elétrico, `velocidadeFixa` (Passagem) |
| **Bonde** | `trem.ts` com preset `bonde` (N 5, `Lc` 6,5, `vao` 0,3, largura 2,4, altura 3,4, `zPiso` 0,35, `lNariz` 1,5, truques nos módulos 1, 3, 5, sem pantógrafo carenado) | idem | idem (2 truques motores × 2 motores) | as do trem (rolamento `n` 3 com roda de 0,6 m) + `aux` | idem |
| **Trólebus** | `carro-eletrico.ts` com corpo de ônibus (12 × 2,5 × 3,3, `zPiso` 0,3, `m_s` 15, `fCabine` 55) | 1 motor, `i` 9,5, `r_w` 0,51, 18 t | pneus ×6 (`L_W` +3 dB sobre o carro), `aero`, `trole` (dois braços: tom eólico `0,2·v/d`, `d` 0,03 → 0 a 300 Hz, fraco) | idem; `modulacao: 'chopper'` nos CC |
| **Bancada** (ferramenta, liquidificador, industrial) | `teste.ts` (portador `nenhum`, já existe) com `CargaBancada`: constante, quadrática (ventilador: `T = k·ω²`), ou degrau (furar: +`T_furo` enquanto `carga > 0`) | — | `inercia` do mandril/jarra/hélice | nenhuma (o motor traz tudo) | `pedal` = gatilho, `cargaFracao` = degrau de carga |
| **Multirrotor (drone)** | `multirrotor.ts` (novo): `tipo 'drone'` (acrescentar a `TipoPortador` e `COMPAT.drone = ['eletrico']`, `USO_REAL.drone = ['eletrico']`: mudança em `tipos.ts`/`compat.ts`, a anotar no relatório) | corpo 0,3 × 0,3 × 0,1 m (`m_s` 1, sem cabine), `massa`, 4 rotores em `[±0,12, ±0,12, 0,05]` | `Q = c_Q·ρ·n²·D⁵` por rotor (`n` em rot/s, `c_Q` 0,012), inércia da hélice | nenhuma: `helice.k` e `motor.k` vêm do motor (4 unidades com `detune` [−0,10, −0,02, 0, +0,01] medido no Mavic) | `pedal` = coletivo (rotação-alvo: pairado em 0,5), `velocidadeFixa` para passagem |

**Não reusar `rotor.ts`** para o drone (**decisão**): o rotor do CENA 4.3 tem governador de Nr, cauda, BVI e caixa, nada disso existe num multirrotor; a série de pás usa `SerieHarmonica`/`calibrarSerieA` de `base.ts` (os mesmos geradores), com o κ medido e sem tapa.

Tabela motor × portador da etapa (atualiza `COMPAT`/`USO_REAL`):

| Motor \ Portador | carro | trem | bonde (trem) | trólebus (carro) | bancada (`nenhum`) | drone |
|---|---|---|---|---|---|---|
| elétrico PMSM/PMSRM | ✓ Tesla, Leaf, BYD, Fórmula E | — | — | — | ✓ | — |
| elétrico indução + IGBT/GTO | — | ✓ Taurus, Vectron, 9500, 9000, Metropolis, N700 | ✓ Flexity | ✓ trólebus AC | ✓ | — |
| elétrico síncrono CSI | — | ✓ TGV | — | — | — | — |
| elétrico CC chopper / reostático | — | ✓ Frota A, MP73 (reostático) | — | ✓ trólebus CC | — | — |
| universal/CC escovado | — | — | — | — | ✓ furadeira, liquidificador | — |
| BLDC + ESC | — | — | — | — | ✓ | ✓ Mavic |
| indução de rede | — | — | — | — | ✓ industrial | — |

Posições das fontes no referencial do motor (`preset.fontes`; `posMotor` do portador): carro motor traseiro `[−1,4; 0; 0,35]`, dianteiro `[1,3; 0; 0,35]`, inversor junto (`dentro: true`, vias cabine 0,6/6 kHz, cofre 1,0); redução no motor; AVAS para-choque `[2,2; 0; 0,4]` (ré: `[−2,3; 0; 0,4]`); trem: motor por truque (o portador manda a posição), inversor `[x_carro; 0; 0,6]`, sopradores idem, aux `[x_carro; 0; 0,6]`; bancada: tudo em `[0, 0, 1]` (mesa); drone: `helice.k` e `motor.k` na posição do rotor `k` (eixo `[0, 0, 1]`, tabela da hélice `[−6, −2, 0, 0, −2, −6, −10]`, `expConv` 3).

---

## 5. Presets

Ficha: máquina; `2p` polos; `Z_s`/`Z_r`/`Z_c`; redução `i` (estágios); inversor e `f_c`/modo; potência; massa; velocidade máxima; portador. Valores de catálogo quando conhecidos, **≈** quando estimados.

| # | Preset | Máquina, polos, ranhuras | Redução | Inversor / modo | Potência, torque | Massa, `r_w` | `v_max` | Portador e observações |
|---|---|---|---|---|---|---|---|---|
| 1 | **Tesla Model 3 LR AWD** | tras.: PMSRM 6 polos, `Z_s` 54; diant.: indução 4 polos, `Z_s` 60 ≈, `Z_r` 74 ≈ | 9,03 (27:75 → 23:75 ≈), helicoidal | SiC, `f_c` 10 kHz, aleatória δ 0,1 (portadora medida no Plaid: 10,0 kHz) | 258 kW (2 motores), 510 N·m, base 6000 rpm, máx 18 000 | 1850 kg, 0,334 m | 233 km/h | carro, 2 motores, AVAS `ue`; uivo = engrenamento 1 (27·f_rot: 3,5 kHz a 100 km/h) + ranhuras 54·f_rot ± 2f_e |
| 2 | **Nissan Leaf (ZE1, 40 kWh)** | PMSM EM57, 8 polos, `Z_s` 48 | 8,19 (2 estágios ≈ 2,75 × 2,98) | IGBT, `f_c` 10 kHz ≈ (linha fixa 9,6–10 kHz na gravação), assíncrona fixa | 110 kW, 320 N·m, base 3300, máx 10 500 rpm | 1580 kg, 0,316 m | 144 km/h | carro, AVAS `ue` (o Leaf tem VSP de fábrica); alvo: 96·f_rot a 9,5 kHz a 85 km/h, famílias 1 : 1,46 |
| 3 | **BYD Dolphin** | PMSM 8 polos ≈, `Z_s` 48 ≈ (fio chato) | 10,6 ≈ | SiC, `f_c` 10 kHz ≈, aleatória | 150 kW, 310 N·m, máx 16 000 rpm ≈ | 1660 kg, 0,32 m | 160 km/h | carro, AVAS `ue` |
| 4 | **Fórmula E Gen3** | PMSM 8 polos ≈, `Z_s` 48 ≈ | 4,0 ≈, 1 estágio de dentes **retos** (+10 dB) | SiC, `f_c` 24 kHz ≈ (inaudível; não sintetizar) | 350 kW, 20 000 rpm ≈ | 854 kg, 0,335 m | 322 km/h | carro (sem AVAS); o som é redução reta + `6f_e`/ranhuras |
| 5 | **Siemens Taurus ES64U2** | 4 × indução 4 polos, `Z_s` 48 ≈, `Z_r` 58 ≈ | 3,69 ≈ | **GTO**, `f_c,max` 600 Hz, modo **escada** (3.1) → assíncrona 598 Hz → síncrona 15, 11, 9, 7, 5, 3, 1 ≈; aux 176/527/688 Hz | 6400 kW, 300 kN de partida | 86 t (+ trem rebocado no preset: 400 t), 0,575 m | 230 km/h | trem (locomotiva = vagão 1 motorizado com 2 truques, mais N vagões) |
| 6 | **Siemens Vectron AC** | 4 × indução 4 polos, `Z_s` 48 ≈ | 3,7 ≈ | IGBT, `f_c` 1,0 kHz ≈ assíncrona → síncrona 21, 15, 9, 5, 3, 1 ≈ | 6400 kW | 90 t, 0,575 m | 200 km/h | trem; sem escada |
| 7 | **Metrô SP Frota A (original, chopper)** | motores CC série 4 polos, `Z_c` 139 ≈ | 6,2 ≈ | **chopper** de tiristores, `f_ch` 350 Hz ≈ (sem gravação) | 4 × 130 kW por carro motor ≈, 4 motores por carro | 6 carros, 240 t carregado, 0,43 m | 90 km/h | trem (carros motores 1, 3, 4, 6 ≈); escovas `Z_c·f_rot` ≈ 2–3 kHz |
| 8 | **CPTM Série 9500 (Hyundai Rotem)** | 16 × indução 4 polos, `Z_s` 36, `Z_p` 16 (razão medida 2,24) | 6,3 ≈ | IGBT, `f_c` 1,5 kHz ≈ `auto`; **SIV 1333 Hz** com ±60 Hz (medido) | 16 × 210 kW ≈ | 8 carros, 360 t, 0,43 m | 100 km/h | trem (4 carros motores) |
| 9 | **CPTM Série 9000 (CAF)** | 16 × indução 4 polos; ordens medidas 1 : 1,44 : 2,45 (modelo: `Z_p` 18 e `Z_s` 44, 44/18 = 2,44; a ordem 1,44 entra como linha extra do preset, medida e sem explicação física) | 6,5 ≈ | IGBT, `f_c` 2,3 kHz ≈ (linhas quase fixas 2,0/2,3 kHz), `auto` | 16 × 200 kW ≈ | 8 carros, 360 t, 0,43 m | 100 km/h | trem (4 carros motores) |
| 10 | **Alstom Metropolis (Frota I, Metrô SP)** | 16 × indução 4 polos, `Z_s` 48 ≈ | 6,8 ≈ | IGBT Onix, `f_c` 1,25 kHz ≈, `auto` com síncrona 15, 9, 5, 3, 1 (o "troca de marcha" Alstom) | 16 × 190 kW ≈ | 6 carros, 240 t, 0,43 m | 90 km/h | trem (4 carros motores) |
| 11 | **Shinkansen N700** | 56 × indução 4 polos (305 kW), `Z_s` 48 ≈ | 2,79 | IGBT 3 níveis, `f_c` 1,2 kHz ≈, `auto` | 17 080 kW | 16 carros (14 motores), 715 t, 0,43 m | 300 km/h | trem da Passagem (N 16, `Lc` 25): ganha o motor; a 300 km/h o motor fica 15–20 dB abaixo do aero/rolamento; na estação e abaixo de 80 km/h é o que se ouve |
| 12 | **TGV Réseau/Duplex (síncrono)** | 8 × síncrona autopilotada 4 polos ≈ (1100 kW) | 2,3 ≈ | **CSI** de tiristores: sem portadora; **`6f_e`** dominante (0 dB) + `12f_e` (−8), chopper de entrada 300 Hz ≈ em 1,5 kV CC | 8800 kW | 384 t (10 vagões), 0,46 m | 320 km/h | trem (motrizes nas pontas: vagões 1 e 10); é o "apito" do TGV, subindo contínuo com a velocidade |
| 13 | **Bonde Bombardier Flexity** | 4 × indução 4 polos (120 kW), `Z_s` 36 ≈ | 6,0 ≈ | IGBT, `f_c` 2,2 kHz ≈ fixa (classe medida: 2,09–2,52 kHz, `2f_c` forte) | 480 kW | 5 módulos, 42 t (vazio) / 58 t, 0,30 m | 70 km/h | bonde (trem) |
| 14 | **Trólebus Eletra/Marcopolo (SP)** | CC série 4 polos, `Z_c` 100 ≈ (versão CC) / indução 4 polos (versão AC) | 9,5 ≈ (diferencial) | chopper `f_ch` 500 Hz ≈ / IGBT 2 kHz ≈ | 150 kW | 18 t, 0,51 m | 70 km/h | trólebus (carro); soprador fixo 2 polos 60 Hz, 9 pás → BPF 525 Hz |
| 15 | **Furadeira** (sem fio, medida; variante de rede) | CC escovado 2 polos, `Z_c` 12 (rede: universal, `Z_c` 10) | 10 (planetária de 2 estágios, ≈) (rede: 7,4) | nenhum (PWM do gatilho a 20 kHz ≈, inaudível) | 650 W; vazio 14 850 rpm (`f_rot` 247,5 Hz); rede: 23 200 rpm | 1,5 kg; mandril `J` 2·10⁻⁵ | — | bancada; carga: furar = degrau de 60% com queda de 30% na rotação |
| 16 | **Liquidificador** | universal 2 polos, `Z_c` 16 ≈ | 1 | nenhum (triac) | 800 W; vazio 22 000 rpm (367 Hz), com carga 15 000 | 2,5 kg; facas 4 pás (BPF 4·f_rot) + jarra `bp` 1,2 kHz (largo, cavitação) | — | bancada; carga 0 (vazio) → 1 (gelo: +10 dB de largo, −30% rpm) |
| 17 | **Drone DJI Mavic Pro** | 4 × BLDC 12N14P (`p` 7, `Z_s` 12) | 1 | ESC 6 passos, PWM 24 kHz ≈ (não sintetizado); linhas `6f_e`, `9f_e` (medida: 63·f_rot a −13 dB) | 4 × 100 W; pairado 6270 rpm (BPF 209 Hz), máx 9000 | 0,734 kg; hélices 2 pás, 0,21 m | 65 km/h | drone; `detune` [−0,10, −0,02, 0, +0,01] |
| 18 | **Ventilador industrial / motor de indução 4 polos** | indução 4 polos, `Z_s` 36, `Z_r` 28, 50 Hz (chave 60 Hz) | 1 (direto) | **rede** (`2f_rede` 100/120 Hz, `s` 2,7%) | 11 kW, 1460/1760 rpm | 90 kg; ventilador 8 pás (BPF 195/235 Hz) | — | bancada; é o `alternador` do gerador visto do lado do motor: 100/120 Hz +8 dB em plena carga, barras 28·f_rot ± 2f_e = 681 ± 100 Hz |

Famílias do menu: **Carros** (1–4), **Trens e metrôs** (5–12), **Bondes e trólebus** (13–14), **Ferramentas** (15–16), **Drones** (17), **Industrial** (18).

---

## 6. Página `eletrico.html`

Mesmo padrão das outras páginas (`src/pages/eletrico/`: estado e mensagens fora do React, painel com `src/ui/`, mostradores em canvas, um `requestAnimationFrame`), `processador-eletrico.ts` no worklet. **Decisão**: a página usa a Cena nova (`CenaDSP` com o portador do preset e o ouvinte do modo de testes: `fora` 7,5 m, `cabine`, `cofre`, gimbal) em vez de um misturador legado: o DSP é novo e não tem modos de ouvinte a preservar.

Controles:

| Controle | Tipo | Faixa / opções | Vai para |
|---|---|---|---|
| Família e preset | `PresetNav` | seção 5 | `portador` + `motor` |
| Acelerador | slider | 0–100% (gatilho na bancada; coletivo no drone) | `acelerador` |
| Regeneração / freio | slider | 0–100% | `freio` |
| Modo de modulação | chips | auto, assíncrona, escada, síncrona, aleatória, chopper (só os que o preset permite) | `modulacao` |
| AVAS | chips | desligado, UE, EUA | `avas` |
| Carga | chips (carro/trem: plano, subida 3%, subida 6%, reboque/lotação; bancada: 0, 25, 50, 75, 100%) | — | `cargaFracao` / inclinação |
| Velocidade | slider + chave "impor" | 0–`v_max` (dinamômetro: trava `ω`) | `velocidadeFixa` |
| Ouvinte | chips | fora 7,5 m, cabine, cofre/sob o assoalho, gimbal | `cena.ouv` |
| Ambiente | chips | céu aberto, rua, túnel, estação, galpão | `cena.amb` |
| Avançado (seção dobrável) | sliders | `f_c`, δ, `Z_s`, `Z_p`, excentricidade, desgaste das escovas, `detune` | `preset` (edição ao vivo) |

Mostradores: rpm e `v` (km/h), `f_e`, `f_c` e `N` (ou a nota da escada: um teclado de 12 teclas com a atual acesa), corrente/torque (% do nominal, com sinal: regeneração em azul), potência (kW, negativa na regeneração), `M` e fluxo; **espectro** 20 Hz–12 kHz em dB (FFT de 8192 da saída mono antes do ouvinte) com as linhas da telemetria anotadas (`f_c`, `2f_c`, `Z_s·f_rot`, `Z_r·f_rot`, engrenamento 1/2, `2f_e`, `6f_e`, BPF, `Z_c·f_rot`, AVAS) e um espectrograma rolante de 10 s (é onde o do-re-mi e as "marchas" aparecem); nível dB(A) no ouvinte.

Paridade: não há controles legados nesta família. Teclas: Espaço liga/desliga, setas acelerador, `R` regeneração, `M` modo.

---

## 7. Plano de implementação e verificação

Pastas: `src/engines/eletrico/` (`dsp.ts`, `linhas.ts` = `BancoDeLinhas`, `inversor.ts`, `maquina.ts`, `mecanica.ts`, `avas.ts`, `presets.ts`, `motor.ts`), `src/carriers/carro-eletrico.ts`, `multirrotor.ts`, mudanças em `trem.ts` (motor), `teste.ts` (`CargaBancada`), `tipos.ts`/`compat.ts` (`'drone'`); `src/worklet/processador-eletrico.ts`; `src/pages/eletrico/`; `tools/eletrico/` (`render.ts`, `linhas.ts` medida de linhas, `valida.ts`, `navegador.mjs`); `npm run teste:eletrico`. Cada passo termina com o teste indicado passando num comando só, resultados no relatório.

| # | Passo | Entrega | Medida objetiva (render offline, 48 kHz) |
|---|---|---|---|
| 1 | `BancoDeLinhas` | osciladores recursivos com rampas, entrada/saída de linhas, limite `0,45·fs`, jitter | 200 linhas de 50 Hz a 20 kHz por 10 s: frequência medida (FFT 2²⁰, interpolação) a ±0,01%, nível ±0,1 dB, nenhuma componente acima de 21,6 kHz (> −100 dB); troca de 100 linhas de uma vez: pico de diferença entre blocos < 0,05 FS; sem alocação (`--trace-gc` zero coletas em 10 s); CPU < 3% do tempo real por 200 linhas |
| 2 | Eixo, mapa de torque, carga | `maquina.ts`: `T_max(ω)`, `I`, `M`, `Φ`, escorregamento, regeneração; integração com `Carga` | Model 3 LR AWD em `CarroEletrico`: 0–100 km/h em 4,7 ± 0,5 s (pé no fundo, plano, limitado a 0,75 g de aderência); Leaf 8,0 ± 0,8 s; metrô de 6 carros: 0–80 km/h em 36 ± 4 s (1,0 m/s² até 40, depois potência constante); regeneração 100 → 20 km/h a 0,3·T_n: 9 ± 1 s; `f_e` da indução = `p·f_rot + s·f_e` com `s_n` a ±5% |
| 3 | Fontes magnéticas | `2f_e`, `6f_e`, `12f_e`, ranhuras e barras `± 2kf_e`, excentricidade, magnetostrição | Leaf a 5000 rpm: linhas em 666,7 (`2f_e`), 2000 (`6f_e`), 4000 (`48·f_rot`), 4000 ± 666,7, a ±0,5%, níveis da tabela 1.1 a ±1 dB; indução a `s` 2%: barras em `(1 − s)·Z_r·f_e/p` ±0,5%; `Φ` cai 6 dB/oitava acima da base (medido em `2f_e` entre 1× e 2× a base: −6 ± 0,5 dB) |
| 4 | Inversor assíncrono | `inversor.ts`: tabela de Bessel, grupos `m` 1–3, `H_carc`, aux | `M` 0,2 / 0,6 / 1,0: `f_c ± 2f_e` a −38 / −19,4 / −11,8 dB (±1), `2f_c ± f_e` a −16,2 / −10,5 / −16,7 (±1); `f_e` → 0: tudo colapsa em `f_c`, `2f_c`, `3f_c` sem salto de nível (> 0,5 dB) |
| 5 | Modos: escada, síncrona, auto, aleatória, chopper | listas de `N`, limiares de `f_e`, crossfades | **Do-re-mi**: Taurus rebocando 400 t a 0,35 m/s²: 12 patamares nas frequências de 3.1 (±1%), em ordem, durações 0,3–1,2 s, escala completa em 6,2 ± 1 s, patamar 598 Hz mantido até a troca; a 0,6 m/s², 3,6 ± 0,7 s. Síncrona: `f_c = N·f_e` a ±0,1% e trocas sem estalo (< 0,1 FS). Aleatória δ 0,15: pico do espectro em `f_c` ≥ 12 dB abaixo do modo fixo com energia igual (±1 dB). Chopper: nível `∝ D(1 − D)` (D 0,25 e 0,75 iguais a ±0,5 dB; máximo em 0,5), some em `D` = 1 |
| 6 | Mecânica | engrenamento + bandas + chocalho + clique de flanco, rolamentos, ventilação, escovas | Tesla a 7700 rpm: 3465 Hz (27·128,3) e 1062 Hz (23·128,3/2,78, 2º estágio) ±0,5%, bandas laterais ±128,3 Hz a −10 ± 2 dB; +6 ± 0,5 dB ao dobrar `T`; `|T| < 3%`: engrenamento < −40 dB e chocalho presente (curtose do `bp` 1–4 kHz > 4); furadeira: 247,5 × 12 = 2970 e × 24 = 5940 Hz; envoltória do faiscamento (2–10 kHz) com pico de FFT em 2970 Hz ±1% |
| 7 | AVAS | `avas.ts` | a 2 m (Cena, céu aberto, solo asfalto): 55 ± 1,5 dB(A) parado, 61 ± 1,5 a 10 km/h, 67 ± 1,5 a 20 km/h; `f₁` sobe 1,2 ± 0,1%/km/h; a 25 km/h, < −40 dB (2 s depois); ré: pulso a 1,5 Hz |
| 8 | Adaptador e níveis | `motor.ts`, `sondarNivelEletrico`, presets 1–18 | sonda: cada fonte no `L_W` do preset a ±1 dB (Acumulador A); todos os presets configuram e rendem 2 s sem NaN e sem exceder −1 dBFS a 7,5 m |
| 9 | Portadores | `CarroEletrico` (pneu/aero ligados), `Trem` com motor e replicação por truque, `bonde`, trólebus, `CargaBancada`, `Multirrotor` | orçamento: metrô de 8 carros (4 motores) ≤ 64 fontes (contar), N700 de 16 carros com 14 motores: agrupar por carro (1 `motor.u` + 1 `inversor.u` por carro) ≤ 64; drone: 4 BPF distintas medidas a ±0,5% dos `detune`; pneu do carro a 80 km/h: 73 ± 2 dB(A) a 7,5 m só pneus (CENA 4.1) |
| 10 | Validação contra as gravações | `tools/eletrico/valida.ts` com a tabela 3.7 | todos os itens de 3.7 dentro da tolerância, ou desvio documentado; bandas dos casos: Taurus patamar, CPTM 9500 parado, Mavic pairado, furadeira sem fio, drone 2 (±4 dB em 150 Hz–6 kHz) |
| 11 | Passagem e Cena | presets de passagem: "Tesla a 6 m a 30 km/h (AVAS) e a 100", "metrô 9500 chegando à estação", "Taurus arrancando (do-re-mi) a 7,5 m", "bonde a 5 m", "N700 na estação a 80 km/h"; N700 a 300 km/h no túnel continua passando o `teste:cena` | `teste:cena` sem falha nova; Taurus a 7,5 m: tom do inversor 10 ± 3 dB acima do fundo do ambiente `estacao`; Tesla a 6 m e 30 km/h: AVAS + pneus 62 ± 3 dB(A) L_AFmax; a 100 km/h o trem de força ≤ −8 dB do total |
| 12 | Página `eletrico.html` | painel, mostradores, espectro anotado, espectrograma, teclado do do-re-mi | `tools/eletrico/navegador.mjs`: todos os controles da seção 6 presentes e mudando a telemetria; captura de tela; CPU do worklet < 40% do quantum no pior caso (N700, 64 fontes, 4 unidades × 200 linhas) |
| 13 | Documentação e relatório | `TECNICO.md` → seção "Elétrico", `README`, `PLANO` (etapa 6 feita), `CREDITOS` (gravações) | relatório com alvo × medido (tabela 3.7 e passos 1–12) |

### 7.1 Riscos e como limitar

| Risco | Medida |
|---|---|
| **Aliasing**: portadoras de 10–20 kHz com `2f_c`, `3f_c` e bandas laterais acima de 24 kHz; a 48 kHz nada acima de Nyquist pode entrar | **Decisão**: nenhuma linha acima de `0,45·fs` (21,6 kHz) é sintetizada (filtro na lista, não no sinal); entre 18 e 21,6 kHz entra com rampa de −12 dB; o random PWM é ruído filtrado (não alias); nenhuma não linearidade depois do banco (o `tanh` do `CenaDSP` fica como limitador); teste do passo 1 |
| **CPU de muitas senóides** | osciladores recursivos (6 flops por amostra por linha), listas ordenadas e truncadas (`L_max`), 4 unidades no máximo (trem), replicação por truque é cópia de canal (zero custo de síntese), bandas laterais só até `k` = 2 e `m` = 3; orçamento: pior caso 4 × 200 linhas = 800 osciladores = 38 Mflop/s ≈ 3% do tempo real; alternativa, se precisar: síntese por IFFT com sobreposição de 50% para as famílias densas (sem rampa por linha) |
| **Som de pneu e vento do carro** (sem eles, um carro elétrico a 50 km/h soa a motor puro, errado) | `CarroEletrico` liga `pneu.k` e `aero` do CENA 4.1 (implementação nova em `carro-eletrico.ts`, sem mexer no `CarroLegado`); validação pelo nível só-pneus do passo 9; o painel tem a chave para ouvir o trem de força sozinho |
| **Degraus do do-re-mi**: os limiares exatos de `f_e` não são públicos | modelo de limiares uniformes (`f₀` 0,25, `Δ` 0,40 Hz) calibrado pelas durações medidas em duas acelerações; nota e ordem são o alvo forte, duração ±30% |
| **Soa a sintetizador** (senóides puras) | jitter correlacionado por eixo, tremor de amplitude, rolamentos e chocalho de fundo, `H_carc`; conferir de ouvido (REVISAO-DE-SOM.md) depois dos testes numéricos |
| **Dados ≈ nos presets** (ranhuras, reduções, `f_c`) | ficam marcados no preset (`aprox: true`) e no painel avançado; a validação só exige o que foi medido (3.7); quando aparecer fonte melhor, troca-se o número sem mexer no código |
| **Trem com muitos motores** (N700: 56) | 4 unidades distintas replicadas; limite de 64 fontes resolvido pelo agrupamento por carro (passo 9); a Cena já agrupa fontes de um segmento a mais de 50 m |
| **Comando por `ComandoMotor`** sem campos para freio/modo/AVAS | extensões opcionais (`freio`, `modulacao`, `avas`, `v`, `omegaImposta`) no mesmo espírito de `rpmAlvo`; portadores existentes ignoram |
| **Gravações comprimidas** | alvos só até 6 kHz; acima vale a física; as linhas de 6,6/8/11 kHz dos drones e as de 9,5 kHz do Leaf são frequências (robustas), não níveis |

---

## 8. Decisões a respeitar

1. `EletricoDSP` é síntese espectral: bancos de linhas (osciladores recursivos) + ruídos com semente; listas recalculadas a cada 64 amostras; nada acima de `0,45·fs`.
2. As frequências vêm das fórmulas da seção 1 (ordens exatas de `f_rot`, `f_e`, `f_c`); as amplitudes seguem `I/I_n`, `Φ`, `M` e `T` pelas leis dadas; a tabela de Bessel é a do inversor.
3. Seis modos de modulação (`assincrona`, `escada`, `sincrona`, `auto`, `aleatoria`, `chopper`); o do-re-mi do Taurus é a escala de dó maior G3–D5 com patamar em 598 Hz, por limiares de `f_e`.
4. Fontes do motor: `motor`, `inversor`, `reducao`, `ventilador` (+ `escovas`, `helice.k`, `avas`), `refDist` 7,5 m, níveis `L_W` dB(A) por preset na condição de referência, sonda na thread principal.
5. `CarroEletrico` novo (redução fixa, regeneração, pneus e aero do CENA 4.1 ligados); `CarroLegado` intocado. `Trem` ganha o motor por truque com até 4 unidades distintas; bonde é o `Trem`; trólebus é o `CarroEletrico` com corpo de ônibus; ferramentas e industrial na bancada (`nenhum`); drone é o `Multirrotor` novo (`tipo 'drone'`, sem reusar `rotor.ts`).
6. AVAS genérico (tom composto + ruído + ritmo), R138/FMVSS 141, sem imitar marca.
7. A página `eletrico.html` usa a Cena nova; validação por `tools/eletrico/valida.ts` com as tolerâncias de 3.7; gravações valem até 6 kHz.
8. Presets com valores ≈ ficam marcados; só o medido é alvo de teste.
