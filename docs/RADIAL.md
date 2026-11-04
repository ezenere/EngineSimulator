# Radial: projeto da etapa 3

Documento de projeto da etapa 3 (ver `PLANO.md`). Define a geometria do motor radial (fileira única com biela-mestra, dupla fileira, quatro fileiras helicoidais), o escape radial, a dinâmica (rotação baixa, redução da hélice, inércia alta, partida com "tosses"), a hélice e o rotor como portadores, os alvos medidos nas gravações, os presets com ficha, a família "aviação" do Ronco, a página `radial.html` e o plano de implementação com medidas. A implementação segue este texto à letra; o que estiver marcado **decisão** não se renegocia dentro da etapa sem anotar no relatório. Unidades: SI; ângulos em graus de virabrequim (°), ciclo de 720° (4 tempos). As linhas citadas (`dsp.ts:NNN`) são as de `src/engines/ronco/dsp.ts` no commit `b00325d`; as do `geometria.ts` idem.

- [0. Decisões](#0-decisões)
- [1. Geometria radial](#1-geometria-radial)
- [2. Escape radial e o que a `RadialDSP` sobrescreve](#2-escape-radial-e-o-que-a-radialdsp-sobrescreve)
- [3. Dinâmica: rotação, redução, inércia, partida, hélice](#3-dinâmica-rotação-redução-inércia-partida-hélice)
- [4. Alvos numéricos medidos nas gravações](#4-alvos-numéricos-medidos-nas-gravações)
- [5. Presets](#5-presets)
- [6. Família "aviação" no Ronco](#6-família-aviação-no-ronco)
- [7. Interface](#7-interface)
- [8. Plano de implementação e verificação](#8-plano-de-implementação-e-verificação)
- [Apêndice A. Medidas das gravações](#apêndice-a-medidas-das-gravações)
- [Apêndice B. Tabelas de geometria conferidas](#apêndice-b-tabelas-de-geometria-conferidas)

---

## 0. Decisões

1. **Subclasse, não cópia** (o padrão de `DIESEL.md` seção 1). `RadialDSP extends EngineDSP` em `src/engines/radial/dsp.ts`. O `EngineDSP` ganha duas flags neutras no construtor, `this.av = false` (motor de aviação: magnetos duplos, mistura manual, partida de aviação, carga no eixo) e `this.radial = false` (geometria radial: vibração), mais ramos `if (this.av)` / `if (this.radial)` nos pontos listados em 1.6. Com as flags em `false` nenhuma operação aritmética muda; a paridade dos 68 presets (`npm run paridade:ronco`, 200 cenários) é o portão de cada commit que toca `dsp.ts`. **Os ganchos do radial só entram em `dsp.ts` depois de o passo 1 do Diesel (`cc`, `tempos`) estar na branch**: um só arquivo-base, uma pessoa por vez.
2. **Geometria num módulo próprio.** `src/engines/radial/geometria.ts` exporta `LAYOUTS_RADIAL`, `CRANKS_RADIAL` e `buildRadial(spec)`, que devolve o mesmo `MotorMontado` do Ronco mais campos radiais. O `build()` do Ronco **não** aprende `'radial'`: a página radial chama `buildRadial`; o `LAYOUTS` e os chips da página do Ronco ficam como estão. Única mudança em `ronco/geometria.ts`: `export` em `balance` (hoje privada), para não duplicar a conta de balanceamento.
3. **PMS das bielas articuladas pela cinemática**, não por tabela: `L/r`, `r_k/r` e os ângulos dos pinos entram no preset (padrão `L/r` 3,8, `r_k/r` 1,0, pino no ângulo do cilindro) e `buildRadial` calcula o PMS real de cada cilindro (máximo numérico da posição do pistão, passo 0,05° e refino parabólico). Os valores de referência que a implementação tem de reproduzir estão no Apêndice B.
4. **Dupla fileira = dois moentes a 180°, fileira dianteira deslocada meio passo de cilindro**; a ordem de ignição real da P&W entra como texto e o `schedule()` do Ronco, sem alteração, devolve intervalos uniformes (40° no 18, 51,43° no 14), conferido no Apêndice B. **Quatro fileiras (R-4360)**: moentes em 0°, 90°, 180°, 270° na ordem das fileiras, eixos deslocados `r·360/28`, e a ordem **decorre dos PMS** (busca do PMS de cada fileira que dá intervalos uniformes de 25,714°, Apêndice B), como o montador 2T do Diesel.
5. **Vibração**: as forças alternativas de 1ª ordem de uma fileira radial somam um vetor girante constante que o contrapeso anula; a 2ª ordem se anula para `N ≥ 5` ímpar. O que sobra, e o que o canal `vib` leva no radial: a oscilação do torque (ordem `N/2`), o resíduo de 2ª ordem das articuladas e, na dupla fileira, o momento de balanço entre fileiras. O termo de 1ª ordem **não** entra.
6. **Escape montado pelo `buildExhaust` da subclasse**, inteiro (o método base não é tocado): `anel` (coletor anular com `k` saídas), `tubos` (estaques individuais, um radiador por cilindro), `aranha` (coletor único) e, na dupla fileira, um sistema por fileira (`dual`) ou os dois num só (`single`, P-47 com turbina). Decisão medida: no R-2800 com coletores separados por fileira a linha de 4,5ª ordem (ignição de uma fileira) é tão forte ou mais forte que a 9ª (ignição total); com coletor único (P-47) a 9ª domina. O modelo tem de dar as duas coisas, e dá se a topologia for a certa.
7. **Carga no eixo pelo portador** (`CENA.md` 1.1.5): o motor integra o virabrequim com `T_carga = carga.torque(ω)` e `J + carga.inercia`. Este gancho (`acoplar(carga)`) é o mesmo que o adaptador `Motor` do Ronco precisa e vale para as três famílias; a hélice e o rotor são os de `src/carriers/`.
8. **Fontes para a Cena**: `escape.k` (uma por saída de escape, posições reais na carenagem), `admissao` (carburador + superalimentador, `dentro: true`), `bloco` (cilindros expostos: `dentro: false`, eixo `[1,0,0]`, tabela `[0,−1,−3,−6,−8,−10,−12]`), `compressor` (uivo do superalimentador). Nível absoluto por preset (`nivelEscape`, dB re 1 pW em plena carga); a calibração relativa do Ronco vale só para a página sozinha.
9. **Hélice**: o portador `carriers/helice.ts` ganha a manete de passo (rpm-alvo do governador), o passo fixo com `c_Q` constante, o nível da fonte na lenta e a inércia real por preset, **sem** mudar o caminho dos presets turboélice (campos novos com os valores de hoje como padrão; `tools/cena/portadores.ts` continua passando).
10. **Rotação e inércia reais**: lenta 500–800 rpm, máxima 2250–2900, `J` total de 6 a 30 kg·m² (hélice refletida). O controle de lenta do Ronco (PI na válvula de ar) é mantido com os mesmos ganhos; a inércia alta só o torna mais lento, e isso é o que se quer.
11. **Partida de aviação** com três motores de arranque (`inercia`, `direta`, `ar`), contagem de pás, cilindros de baixo encharcados (falhas e estouros nos primeiros 10–20 s) e queda da mistura para parar (`idle cut-off`). Medido: nos 3 s depois de pegar a variação explosão a explosão é 2–3× a da lenta quente (4.3).
12. **Validação por gravações**: tabelas de bandas em dB relativas a 150–400 Hz (Apêndice A), linhas de ordem (BPF, fileira, ignição), vagar da lenta e variação por ciclo. Para a tabela pública de `TECNICO.md` valem só as gravações do Wikimedia Commons (Yak-52 ×2, Ford Trimotor, Corsair em Hahnweide, "Start-Sh-14"); as do YouTube são alvo interno.
13. **Aproximações declaradas** (como X-Engine no `PLANO.md`): Monaco-Trossi (2 tempos a centelha: depende do `tempos` do Diesel; sem ele sai como 4T marcado "aproximação"), Megola (motor que gira com a roda: modulação da panorâmica), M4 Sherman (sem o ruído da esteira), Ford Trimotor (3 instâncias do DSP, opcional).

---

## 1. Geometria radial

### 1.1 Fileira única (3, 5, 7, 9)

Cilindros `c = 1..N` igualmente espaçados, eixo do cilindro `φ_c = (c−1)·360/N` medido no sentido de rotação a partir do cilindro 1 (no topo). Um só moente; o cilindro 1 tem a **biela-mestra**, os demais **bielas articuladas** presas a pinos na cabeça da mestra. Convenção do Ronco (`geometria.ts:9–12`): o PMS de `c` é `shift(c) − pin(c)`; aqui `shift(c) = φ_c` e `pin = 0`, então o PMS **nominal** é `φ_c`. Em 4 tempos cada cilindro tem dois PMS a cada 720° (`φ_c` e `φ_c + 360`); o comando escolhe o de ignição, e a ordem real `1-3-5-7-9-2-4-6-8` (R-1820, R-1340, M-14P: ímpares no sentido de rotação, depois pares) dá intervalos de **80°** exatos pelo `schedule()` do Ronco (Apêndice B). Ordens por `N`:

| N | Ordem | Intervalo | Ordem de ignição (× rotação) |
|---|---|---|---|
| 3 (Verner 3V) | `1-2-3` | 240° | 1,5 |
| 5 (Verner 5S, Megola, Shvetsov M-11) | `1-3-5-2-4` | 144° | 2,5 |
| 7 (Rotec R2800, fileira do R-4360) | `1-3-5-7-2-4-6` | 102,857° | 3,5 |
| 9 (R-1820, R-1830/fileira, R-1340, R-985, M-14P, R-975, Rotec R3600) | `1-3-5-7-9-2-4-6-8` | 80° | 4,5 |

Uma fileira de `N` ímpar fecha os 720° sozinha; `N` par numa fileira não fecha (PMS coincidem a cada 360°) e por isso não existe radial 4T de fileira única par.

### 1.2 Biela-mestra e articuladas: PMS real e curso

Moente em `C = r·(sin θ, cos θ)`; mestra de comprimento `L` até o pistão 1 no eixo `φ = 0`, obliquidade `sin β = r·sin θ/L`; direção moente→pistão `u = (−sin β, cos β)`. O pino da articulada `k` fica na cabeça da mestra a `r_k` de `C`, no ângulo `δ_k` medido de `u` no sentido dos eixos (`K_k = C + r_k·R(δ_k)·u`); a articulada tem comprimento `l_k` e o pistão `k` anda no eixo `a_k = (sin φ_k, cos φ_k)`:

$$s_k(\theta) = K_k\cdot a_k + \sqrt{l_k^2 - \left|K_k - (K_k\cdot a_k)\,a_k\right|^2}$$

O **PMS real** é o `θ` que maximiza `s_k`; `l_k` é escolhido para que em `θ = φ_k` o pistão `k` esteja na mesma altura de topo que o pistão 1 (mesma folga de topo, como nos motores reais, que igualam a taxa de compressão). Com `δ_k = φ_k` (pinos nos ângulos dos cilindros, o arranjo normal) o PMS real **adianta** nos cilindros do lado que o moente alcança primeiro e **atrasa** no outro, antissimetricamente, e o curso cresce um pouco:

| 9 cilindros, `δ_k = φ_k` | φ 40° | 80° | 120° | 160° | 200° | 240° | 280° | 320° |
|---|---|---|---|---|---|---|---|---|
| ΔPMS, `L/r` 3,8, `r_k/r` 1,0 (**padrão**) | +0,60° | +3,45° | +4,95° | +2,20° | −2,20° | −4,95° | −3,45° | −0,60° |
| curso relativo ao cil. 1 | 1,0001 | 1,0029 | 1,0086 | 1,0030 | 1,0030 | 1,0086 | 1,0029 | 1,0001 |
| ΔPMS, `L/r` 3,6, `r_k/r` 1,2 | +0,90 | +5,05 | +6,80 | +2,95 | −2,95 | −6,80 | −5,05 | −0,90 |
| ΔPMS, `L/r` 3,4, `r_k/r` 1,3 | +1,20 | +6,50 | +8,30 | +3,50 | −3,50 | −8,30 | −6,50 | −1,20 |

Tabelas de 3, 5 e 7 no Apêndice B. Zerar o ΔPMS exigiria pinos deslocados 10–14° e cursos 5–15% maiores (também no Apêndice B): nenhum motor real faz isso; aceitam-se os poucos graus. **Decisão: `buildRadial` calcula ΔPMS e o curso relativo por cilindro e devolve `tdc[c] = φ_c + ΔPMS_c` e `curso[c]`.** A ordem de ignição usa esses PMS (os intervalos deixam de ser exatamente 80°: 80 ± 5°, e é essa a irregularidade de fase própria do radial, que o Ronco não tem); o volume do cilindro continua sendo o do Ronco (`volume(a)` com `r` e `l` globais, `dsp.ts:319`), e o curso relativo entra como fator determinístico de ar e energia por cilindro: `cylIn[c] *= curso[c]`, `cylQ[c] *= curso[c]` (±0,3–0,9%: pequeno, mas colado ao cilindro, não sorteado). Para a escala de vibração, `tdcRel[c]` usa o PMS real.

### 1.3 Dupla fileira (14 e 18)

Dois moentes a **180°** (fileira traseira `pin` 0°, dianteira 180°); cada fileira tem a sua mestra. A fileira dianteira fica **entre** os cilindros da traseira: eixos `φ_c = (c−1)·360/N` com `c` ímpar na traseira e par na dianteira (numeração P&W: cilindro 1 no topo da fileira traseira, depois no sentido horário visto de trás, alternando as fileiras). PMS nominal `φ_c − pin(fileira)`: traseira `φ_c`, dianteira `φ_c + 180`. Com as ordens reais o `schedule()` do Ronco dá intervalos uniformes e cada fileira dispara com o passo de fileira única, as duas defasadas de meio intervalo:

| Motor | Ordem (texto do preset) | Intervalo | Por fileira | 1º disparo da dianteira |
|---|---|---|---|---|
| R-1830 (14 = 2 × 7) | `1-10-5-14-9-4-13-8-3-12-7-2-11-6` | 51,43° | 102,86° | 51,43° |
| R-2800, R-3350 (18 = 2 × 9) | `1-12-5-16-9-2-13-6-17-10-3-14-7-18-11-4-15-8` | 40° | 80° | 40° |

A ordem sequencial `1-2-…-18` é **inválida** no `schedule()` (não fecha 720°), o que serve de teste. Ordens de ignição (× rotação): 14 → 7 (total) e 3,5 (fileira); 18 → 9 e 4,5. O PMS real de cada cilindro leva o ΔPMS de 1.2 da sua fileira (`δ_k` relativo à mestra da fileira).

### 1.4 Quatro fileiras (R-4360: 28 = 4 × 7, helicoidal)

Quatro moentes, fileira `r` (0 = traseira) com cilindros `7r+1..7r+7`, eixo do primeiro cilindro de cada fileira deslocado `r·360/28 = 12,857°·r` (o "espiga de milho": todos os 28 cilindros ficam em ângulos distintos, para o ar de refrigeração) e moentes `(0°, 90°, 180°, 270°)[r]`. Cada fileira dispara a cada 102,857° no padrão `1-3-5-7-2-4-6`; para os 28 disparos ficarem a **25,714°** cada fileira escolhe qual dos dois PMS do seu cilindro 1 é o de ignição. A busca (16 combinações) acha uma só solução, com a fileira 2 no segundo PMS, e a sequência de fileiras `0-3-2-1-0-3-2-1-…`:

`1-27-19-11-3-22-21-13-5-24-16-8-7-26-18-10-2-28-20-12-4-23-15-14-6-25-17-9`

**Decisão:** o preset do R-4360 não traz `order`; `buildRadial` gera a ordem acima pela busca (função `ordemDecorrente(tdc, fileiras)`) e o `schedule()` do Ronco confere que ela é válida com intervalos únicos de 25,714° (Apêndice B). Outros moentes testados (0/180/90/270; 0/270/180/90) não fecham: duas fileiras caem na mesma fase.

### 1.5 Eixos de vibração

`balance()` do Ronco (`geometria.ts:170–190`) com `axis = φ_c` e `tdcRel` = PMS real dá, para uma fileira ideal, `|F1| = N/2` (vetor girante de módulo constante: é exatamente o que o contrapeso do virabrequim anula) e `|F2| = 0` para `N ≥ 5` (3 cilindros: `|F2| = 1,5`, que sobra de verdade). Com os ΔPMS das articuladas (9 cilindros, `L/r` 3,6, `r_k/r` 1,2): `|F1|` 4,583 e `|F2|` 0,433 — um resíduo de 2ª ordem de ~10% de um cilindro, real. Na dupla fileira os dois vetores girantes são opostos (moentes a 180°) e deixam um **momento** de 1ª ordem entre as fileiras (`m1 > 0` pelo `z` das fileiras), anulado por contrapesos em cada moente. O que fica, e o que o painel mostra: `f1 − N/2` (resíduo das articuladas), `f2`, `m1`, `m2`, e a ordem de ignição. **O canal `vib`** (`dsp.ts:1014–1017`) no radial (`if (this.radial)`): sem o termo `cos(ph)` das forças (contrapeso), com `0,3·cos(2ph)` por cilindro, com o momento `0,35·dz[c]·(ux+uy)·cos(ph)` só na dupla fileira (`dz` = `z` da fileira) e com a oscilação do torque pesando 1,6× (`ripple·0,08` no lugar de `0,05` em `dsp.ts:1143`). O `z` das fileiras: fileira única `z = 0`; dupla `z ∈ {0, 0,22}` m; R-4360 `z ∈ {0, 0,2, 0,4, 0,6}`.

### 1.6 Formato do preset e ganchos no `EngineDSP`

`PresetRadial = PresetRonco & {…}` com `layout: 'radial'`, `cylinders: N`, `rows` (1, 2, 4), `cylPerRow` (`N/rows`, conferido), `crank` (`'mestra'`; no R-4360 `'mestra4'`), `order` (texto, ou ausente no R-4360), mais os campos de 5.1. Bases de preset como as do Ronco: `R9 = { layout: 'radial', cylinders: 9, rows: 1, cylPerRow: 9, crank: 'mestra', order: '1-3-5-7-9-2-4-6-8' }`, `R14`, `R18`, `R28`, `R7`, `R5`, `R3`. `montarConfig` da página radial chama `buildRadial` e manda ao DSP `N, fire, bank (= fileira), banks (= rows), axis (= φ_c), z, tdcRel, runners, curso, phi, grupo` (grupo de escape, 2.1).

**`buildRadial(spec)` devolve** `MotorMontado & { rows, phi: number[], dPMS: number[], curso: number[], grupo: number[], f1Residuo }`. `valid` é o do `schedule()`; `intervals` e `perBank` (por fileira) como no Ronco.

**Ganchos no `EngineDSP`** (depois do passo 1 do Diesel; tudo atrás de `this.av` ou `this.radial`, com o lado gasolina textual):

| # | Onde (`dsp.ts`) | Gasolina (fica) | Aviação / radial |
|---|---|---|---|
| 1 | construtor | — | `this.av = false; this.radial = false; this.carga = null; this.tap = null;` |
| 2 | `setConfig` 200–208 (dispersão por cilindro) | sorteio ±7/10/5% | depois do sorteio: `if (this.radial) { cylIn[c] *= cfg.curso[c]; cylQ[c] *= cfg.curso[c]; }` |
| 3 | `tune` | — | `super.tune` e campos da subclasse (nada no base) |
| 4 | 858–860 (centelha) | `aSp` do avanço | `if (this.av && this.magnetos !== 'ambos') this.burnK[c] *= 1.2;` logo após `this.burnK[c] = …` (890); `'desligado'` = ignição desligada |
| 5 | 878 (`misfire`) | `const misfire = …` | vira `let misfire = …; if (this.av) misfire = misfire \|\| rng.next() < this.falhaAv(c);` (encharque, mistura pobre, magneto só) |
| 6 | 887 (`Q[c]`) | energia da queima | `if (this.av) this.Q[c] *= this.qMix;` (mistura, 3.6) |
| 7 | 918 (`hot`) | `const hot = …` | `const hot0 = …; const hot = this.av ? Math.max(hot0, this.avHot) : hot0;` (estouros da partida sem coletor quente) |
| 8 | 939–941 (antes da 1ª lei) | — | `if (this.av && this.arPartida) { … }` partida a ar (3.4): injeta massa no cilindro em `a ∈ [5°, 60°]` |
| 9 | 1017 (`vib`) | `vib += (…)·acc` | `if (this.radial) vib += …; else vib += (…)·acc` (1.5) |
| 10 | 1027 (`Tst`) | motor de arranque até 330 rpm | `if (this.av) Tst = this.torquePartida(rpm);` (3.4) |
| 11 | 1053 (integração) | `(Tgas·tqS + Tst − Tfr − Tcl)/this.J` | `const Tld = this.carga ? this.carga.torque(omega) : 0, Jt = this.J + (this.carga ? this.carga.inercia : 0);` e `… − Tcl − Tld)/Jt` (com `carga = null`: `x − 0` e `J + 0`, mesmos doubles) |
| 12 | 1132 (`airCool`) | `mech *= 1.2` | nova linha depois: `if (this.radial) mech *= 1.17;` (cilindros expostos, aletas: 1,4× no total) |
| 13 | 1085–1096 (radiadores) e 1212 (mix) | — | `if (this.tap) { this.tap[i][s] = x·exScale; … }` só gravações (adaptador `Motor`, 3.7) |
| 14 | `telemetry()` | — | `super.telemetry()` + `magnetos, mistura, encharque, rpmHelice, bpf, machPonta, partida` |
| 15 | 902 (`pr` da falha com queima armada) | `pr = 0.015; k = 0.7;` | `if (this.av) { pr = this.prAv; k = 0.9; }` logo depois (3.4) |

Portão: `npm run paridade:ronco` (200 cenários) e `--dist` idênticos; `git diff --stat src/engines/ronco/dsp.ts` < 60 linhas; tempo de `v16 rev` e `muscle wot` ±3%.

---

## 2. Escape radial e o que a `RadialDSP` sobrescreve

### 2.1 Topologias (`escape.tipo`)

Todas usam `Line`, `Junction`, `TwoPort`, `Radiator`, `ClosedEnd` de `src/acoustics/` (nada novo lá). Comprimentos escalados por `520/c_gás` com `c_gás` 520 m/s (gasolina, como o Ronco). `grupo[c]` (de `buildRadial`) diz a que coletor/saída o cilindro vai: fileira única `anel` → grupo 0; `aranha` → 0; `tubos` → `c`; `lados` (Sherman) → `sin φ_c ≥ 0 ? 0 : 1`; dupla fileira → fileira.

| Tipo | Rede | Saídas (radiadores) | Quem |
|---|---|---|---|
| `anel` | `N` primários curtos (`L_p` 0,15–0,30 m, Ø porta) → `N` junções de 3 portas ligadas em **laço** por `N` segmentos de anel (`L_a = π·D_anel/N`, admitância `Y_a`); em `k` junções (as das saídas) uma 4ª porta leva a um tubo de saída `L_s` → ponteira | `k` = 1 ou 2 | R-1820, R-1830, R-1340, R-985, M-14P, R-975 (dois meio-anéis), S-55 |
| `tubos` | `N` primários (`L_t` 0,4–0,7 m) → junção de 2 portas (só para `inj` dos estouros) → tubo de 0,05 m → `Radiator` cada | `N` | Rotec, Verner, M-14PF acrobático, Megola, Monaco-Trossi, Corsair (3 por lado agrupados: `k` = 6) |
| `aranha` | `N` primários desiguais (cilindros de cima 0,9 m, de baixo 0,4 m: `L_c = 0,4 + 0,5·(1 + cos φ_c)/2`) → 1 junção → saída | 1 | motores de ultraleve com coletor "polvo" |
| dupla fileira `dual` | um `anel` (ou `tubos`) por fileira, cada um com as suas saídas | 2–6 | R-2800 Corsair, R-1830 com duas saídas |
| dupla fileira `single` | os dois anéis com uma saída cada → junção → tubo longo (`L_turbo`) → `TwoPort 'turbo'` existente → cauda | 1 | P-47 (turbina na fuselagem traseira) |
| R-4360 | 4 anéis; fileiras (0,1) e (2,3) aos pares numa saída cada (`dual`) | 2 | R-4360 |

Dimensões (modelo; medidas de catálogo onde públicas, "≈" estimadas pela classe):

| Motor | `D_anel` (m) | Ø anel (mm) | `L_p` (m) | saídas: `k` × `L_s` (m) × Ø (mm) | `breakout` |
|---|---|---|---|---|---|
| R-1820 (T-28) | 1,25 | 95 | 0,20 | 2 × 0,6 × 90 (uma de cada lado, embaixo) | `old` |
| R-1830 (DC-3) | 1,15 | 90 | 0,18 | 1 × 1,2 × 100 (sob a nacele) | `old` |
| R-1340 (T-6) | 1,10 | 76 | 0,18 | 1 × 1,0 × 76 (lado direito) | `leaky` (anel de chapa fina) |
| R-985 (Trimotor) | 1,00 | 70 | 0,15 | 1 × 0,8 × 70 | `old` |
| M-14P (Yak-52) | 0,90 | 60 | 0,15 | 2 × 0,4 × 60 | `old` |
| R-975 (Sherman) | dois meio-anéis 1,0 | 80 | 0,2 | 2 × 1,5 × 90 (traseira, sob defletores) | `sealed` |
| R-2800 (Corsair) | `tubos` por fileira: `L_t` 0,55–0,8 | — | — | 6 saídas (3 por lado) Ø 70, agrupadas em 2 radiadores (L/R) | `old` |
| R-2800 (P-47) | 2 × 1,30 | 100 | 0,2 | 1: anéis → 2 × 3,8 m Ø 90 → turbina → 1,0 m Ø 110 | `sealed` |
| R-4360 | 4 × 1,35 | 100 | 0,2 | 2 × 1,5 × 110 | `sealed` |
| Rotec R2800/R3600 | `tubos` | — | `L_t` 0,60, Ø 38 | 7 ou 9 | `leaky` |
| Verner 3V/5S | `tubos` | — | `L_t` 0,45, Ø 35 | 3 ou 5 | `leaky` |

Admitâncias: primário `Y = 1` (como `runner` do Ronco); anel `Y_a = 0,55·N^0,5·A2` (um anel de Ø 90–100 mm engole a vazão de 9 cilindros); saída `Y_s = Y_a`; `ds` do `pipeD` como hoje. Perdas: primários 12 000 Hz (como o Ronco), anel 9 000 Hz com `dw` do diâmetro. O laço do anel é uma rede com ciclo; `Junction` não supõe árvore e `Line` tem as duas direções: nada muda em `acoustics/`. Ressonâncias que têm de aparecer: anel de 3,9 m de perímetro → onda viajante a `c/perímetro` = 133 Hz (R-1820: a 1 780 rpm coincide com a ignição, 133 Hz: é o "ronco de cruzeiro" do Cyclone); estaque de 0,60 m → 1/4 de onda em 217 Hz (Rotec a 1 240 rpm: 3 × f_ign = 217 Hz, e a gravação mostra essa 3ª harmônica a 0 ± 4 dB da fundamental, 4.2).

Panorâmica e posição das saídas: cada radiador `k` recebe `panL/panR` pelo ângulo real da saída na carenagem (`cos/sin` do `φ` da saída, como `boxerPan` faz para o boxer) e a Cena recebe `escape.k` em `pos` = ponto da saída no corpo (avião: `x` = nariz − 1 m, `y` = ±0,5 m, `z` = altura do eixo − 0,4). Com `tubos` e `N` = 7–9 radiadores, as fontes `escape.k` da Cena ficam uma por estaque; com 18 (Corsair) agrupam-se 3 por radiador (6 fontes); o R-4360 e o Trossi têm 2 e 4.

### 2.2 Refrigeração a ar, magnetos, carburador, mistura, superalimentador

- **Ar** (`cooling: 'air'` sempre): o caminho do Ronco (sem ventoinha, `mech ×1,2`) mais `×1,17` no radial (gancho 12): cilindros e aletas expostos na boca da carenagem. A fonte `bloco` sai com `dentro: false` e a diretividade de 0.8; no Sherman e no Trossi fica `dentro: true` (compartimento). Flaps de capô: não modelados.
- **Magnetos** (`magnetos: 'ambos' | 'esq' | 'dir' | 'desligado'`): com um só magneto a queima é mais lenta (uma vela, frente de chama mais longa): `burnK ×1,2` (gancho 4) e a potência cai; a 1 700 rpm em bancada ("mag check") o giro cai 40–120 rpm (alvo 60 ± 30). `'desligado'` = `setIgnition(false)`.
- **Carburador**: todos os grandes radiais têm carburador de **pressão** (Stromberg PD/PR/PT, Bendix PR-100) depois do qual o superalimentador mistura e distribui: a dispersão entre cilindros é a do Ronco com `fuel: 'efi'` (×1) nos de pressão e `'carb'` (×2,6) nos de boia (M-14P AK-14P, R-1340 NA-Y9, R-975 NA-R9, Rotec Bing, Verner, Megola). Medido: variação por ciclo na lenta 0,27–0,41 nos de pressão e 0,34–0,45 nos de boia (4.3).
- **Mistura** (`mistura` 0..1: 0 corte de lenta, 0,55 pobre, 0,8 auto-rica, 1 rica): `qMix = suave(0, 0,25, mistura)·(1 − 0,08·limitado((mistura − 0,7)/0,3))` multiplica `Q` (gancho 6); mistura pobre queima devagar: `burnK ×(1 + 0,3·limitado((0,6 − mistura)/0,3))`; abaixo de 0,45 há falhas: `falhaAv += 0,3·(0,45 − mistura)/0,15`. Em `0` o motor para em 2–5 s com a hélice girando por inércia (é assim que se desliga um radial; "Corsair parada" em A.4).
- **Superalimentador** (todos menos Rotec, Verner, Megola): reusa `aspiration: 'super'`, `scType: 'centrifugal'`, `scRatio` (relação do impulsor), `scLobes` (pás do impulsor), `boost` (bar, no máximo), `scWhine` (dB). A pressão sobe com o giro e a manete (`dsp.ts:704`), o uivo é `giro × relação × pás`: R-2800 em baixa 7,6:1 × 16 pás a 800 rpm → 1,6 kHz; a 2 700 rpm → 5,5 kHz. Fora do avião ele quase não se ouve (`scWhine` −18 dB); na cabine sim. Duas velocidades (R-2800): chave `blower: 'baixa' | 'alta'` muda `scRatio` (7,6 → 9,5) e `boost`.
- **Admissão**: `intake: 'airbox'`; o som da admissão fica dentro da carenagem (`dentro: true`).

### 2.3 O que a `RadialDSP` sobrescreve

```
src/engines/radial/
  dsp.ts         RadialDSP extends EngineDSP: construtor (av = true, radial = true), tune (super + campos de 5.1),
                 buildExhaust (inteiro, 2.1), buildFilters (super + filtros do motor de arranque e do ar de partida),
                 calibrate / measurePower (RadialDSP com o escape de referência 'anel' de 1 saída, rotação travada em
                 55% da máxima, lenta 21 dB abaixo, como o Ronco), telemetry (super + campos), e os métodos chamados
                 pelos ganchos: falhaAv(c), torquePartida(rpm), partidaAr(c, a), qMix/avHot/magnetos como campos
  geometria.ts   LAYOUTS_RADIAL, CRANKS_RADIAL, buildRadial, ordemDecorrente, pmsArticulada (1.2–1.4); importa
                 schedule, intervals, parseOrder, balance de ../ronco/geometria
  presets.ts     PresetRadial, bases R3/R5/R7/R9/R14/R18/R28, os presets de 5.2, FAMILIAS_RADIAL
  config.ts      montarConfig/configCalibrada chamando buildRadial e RadialDSP
  constantes.ts  tabelas de arranque, hélices (B, D, J, i) e níveis
  motor.ts       MotorRadial: adaptador Motor (CENA 1.3) sobre RadialDSP, com `tap` (3.7)
src/worklet/processador-radial.ts   registrarProcessador('radial-engine', (fs) => new RadialDSP(fs))
src/pages/radial/ + radial.html    (seção 7)
tools/radial-*.ts                  render, lenta, partida, bandas (seção 8)
```

`setConfig` chama `tune`, `buildExhaust`, `buildFilters`, `calibrate` por despacho virtual (`dsp.ts:216–226`): a subclasse os troca sem editar `setConfig`. Os campos que `buildExhaust` tem de preencher, porque o laço os lê: `lines, nodes, runners, rads, radHP, radSh, itdB, itdM, itdW, itdD, jetF, jetEnv, tipA, pipeA, bankJ, brkW`. `bankJ[grupo]` é a junção onde os estouros (`pops`) são injetados: no `anel`, a junção da saída; nos `tubos`, a junção de 2 portas de cada estaque (`pops` de um cilindro vão para o estaque dele: `pp.bank = grupo[c]`, e no Ronco `pp.bank = cfg.bank[c]`: a subclasse passa `bank = grupo` ao DSP e `fileira` à parte, em `cfg.fileira`, para o `vib`).

---

## 3. Dinâmica: rotação, redução, inércia, partida, hélice

### 3.1 Rotações

| Motor | lenta (rpm) | medido nas gravações | máxima | redução `i` (motor/hélice) | f_ign lenta → máx (Hz) | BPF lenta → máx (Hz) | f_ign/BPF = `N·i/(2B)` |
|---|---|---|---|---|---|---|---|
| R-1820 (T-28, 3 pás) | 600 | 740–940 (aquecendo) | 2 700 | 1,778 (16:9) | 45 → 203 | 17 → 76 | 2,67 |
| R-1830 (DC-3, 3 pás) | 600 | 790–1 150 | 2 700 | 1,778 | 70 → 315 | 17 → 76 | 4,15 (medido 4,16) |
| R-2800-18W (Corsair, 4 pás) | 650 | 690–1 125 | 2 800 | 2,286 (0,4375:1) | 98 → 420 | 19 → 82 | 5,14 (medido 5,13) |
| R-2800-59 (P-47, 4 pás) | 650 | 590–800 | 2 700 | 2,0 | 98 → 405 | 22 → 90 | 4,5 (medido 4,49) |
| R-4360 (4 pás) | 700 | — | 2 700 | 2,667 (0,375:1) | 163 → 630 | 17,5 → 67,5 | 9,33 |
| M-14P (Yak-52, 2 pás) | 760 (26%) | 980–1 045; 2 850 na decolagem | 2 900 | 1,52 (0,658:1) | 57 → 218 | 17 → 64 | 3,42 (medido 3,44) |
| R-1340 (T-6, 2 pás) | 600 | 720–940 (frio) | 2 250 | 1 (direto) | 45 → 169 | 20 → 75 | 2,25 (medido 2,25) |
| R-985 (Trimotor, 2 pás) | 600 | 1 850–2 130 (passagem) | 2 300 | 1 | 45 → 172 | 20 → 77 | 2,25 |
| Rotec R2800 (2 pás) | 1 000 | 1 150–1 500 | 3 600 | 1 | 58 → 210 | 33 → 120 | 1,75 |
| R-975 (Sherman) | 600 | — | 2 400 | — (câmbio) | 45 → 180 | — | — |

A rotação mínima estável é limitada pelo controle de lenta do Ronco: com `J` grande e 9 cilindros a 600 rpm (45 Hz de ignição) o PI (`KP` 0,0015, `KI` 0,0035) continua estável; o teste de lenta (8.1, passo 7) é a prova. **Decisão:** não se mexe nos ganhos; se um preset apagar a −5 °C, sobe-se a `idle` dele (os radiais de verdade apagam frio).

### 3.2 Inércia e torque

`J` do Ronco é `(0,05 + 0,045·cilindrada)·inertia` (`dsp.ts:243`): para 46 L dá `2,1·inertia`. O radial tem o volante na hélice: `J_total = J_motor + J_hel/i²`, com `J_motor` (virabrequim, bielas, impulsor refletido) ≈ 0,06·cilindrada kg·m² e `J_hel` da tabela 3.3. **Decisão:** o preset radial traz `J` (kg·m², do motor sozinho) e `inertia` é derivado (`inertia = J/(0,05 + 0,045·cilindrada)`) por `tune` da subclasse, para não mudar a fórmula base; a hélice entra pela `Carga` (gancho 11), como manda o `CENA.md`. Sem portador (bancada), a página acopla uma `CargaHelice` do preset mesmo assim (um radial sem hélice não existe fora do banco de provas, e lá há um "club prop").

Torque: `Tmax = 95·cilindrada` (`dsp.ts:244`) dá 4 360 N·m para 45,9 L; o R-2800 entrega 2 100 hp a 2 800 rpm = 5 340 N·m. A escala `power` do Ronco (`tqScale`) leva ao da ficha; a potência é sempre a nominal ao nível do mar, sem altitude.

### 3.3 Hélice como carga e como fonte (`carriers/helice.ts`)

O que existe: `CargaHelice` (`c_Q(β, J_adv)·ρ·n_h²·D⁵/i`), governador PI do passo, `FonteHelice` (tabela de passagem de pá, ruído largo). O que falta para o radial (campos novos com padrão = comportamento de hoje):

| Falta | Campo / mudança | Regra |
|---|---|---|
| **Manete de passo** (rpm da hélice) | `ComandoPortador.rpmAlvo?: number` (0..1) → `nAlvo = nMin + (nMax − nMin)·rpmAlvo`; `cfg.nMin` (padrão `nHelice`: nada muda sem o campo) | o governador mira `nAlvo` em vez de `nHelice`; abaixo de 60% de `nAlvo` passo mínimo (como hoje) |
| **Passo fixo** | `passoFixo: true` já existe: `c_Q` fixo em `cQ0·(1 + 6·(β0 − βmin)/(βmax − βmin))` com `β0` do preset | Trimotor, Rotec, Verner, Megola; Yak e T-6 têm passo variável |
| **Mach de ponta das antigas** | nada novo: `M_t = √((πDn_h)² + v²)/c`; T-6 a 2 250 rpm, D 2,74 m: 323 m/s → `M_t` 0,95 parado, ≈ 1,0 a 60 m/s | `κ = 0,1 + 2,6·(1 − M_t)^1,3` = 0,153 → harmônico 9 a −5 dB: as gravações da decolagem do T-6 mostram os harmônicos 5–9 da BPF (366–660 Hz) dentro de 3 dB entre si (A.2); o modelo tem de dar harmônicos 5–9 dentro de 6 dB |
| **Hélice na lenta** | `on = min(1, max(0, (n_h/nHelice − 0,05)/0,25))` zera a fonte abaixo de 5% e a corta até 30%; com `nHelice` 1 350 (Corsair) a lenta da hélice (300 rpm) fica em 0,7 | trocar o piso por `onLenta` (padrão 0 = hoje): `on = max(onLenta, …)`, `onLenta` 0,35 nos radiais. Alvo: a 10–15 m de lado, na lenta, os harmônicos 2–5 da BPF ficam 10 ± 5 dB abaixo da linha de ignição; a 3 m da hélice (DC-3 "singing"), iguais ou acima (A.1) |
| **Inércia real** | `J_hel` por preset (tabela abaixo) | hoje 60 kg·m² fixo no padrão |
| **Partida** | abaixo de 10% de `nHelice` a hélice é só arrasto: `c_Q = cQ0` e a fonte é a contagem de pás: pulso de 20 ms de ruído `lp 300 Hz` por pá (BPF 1–3 Hz) | o painel conta as pás (3.4) |
| **Tabela de hélices** | acrescentar à `HELICES` | abaixo |

| Hélice | B | D (m) | `J_hel` (kg·m²) | passo | `n_h` máx (rpm) | `M_t` parado |
|---|---|---|---|---|---|---|
| Hamilton Standard 3 pás (T-28, DC-3) | 3 | 3,05 / 3,50 | 45 / 55 | variável (governador) | 1 520 | 0,71 / 0,81 |
| Hamilton 4 pás (Corsair F4U-4) | 4 | 4,01 | 120 | variável | 1 225 | 0,75 |
| Curtiss Electric 4 pás (P-47D) | 4 | 3,96 | 110 | variável | 1 350 | 0,82 |
| Hamilton 4 pás (B-50, R-4360) | 4 | 5,08 | 300 | variável | 1 012 | 0,78 |
| V530TA-D35 (Yak-52) | 2 | 2,40 | 7 | variável | 1 908 | 0,70 |
| MTV-9 (Su-31) | 3 | 2,50 | 5 | variável | 1 940 | 0,74 |
| Hamilton 12D40 (T-6) | 2 | 2,74 | 16 | 2 posições → tratado como variável, `nMin` 1 800 | 2 250 | 0,95 |
| Hamilton 2 pás (Trimotor) | 2 | 2,60 | 12 | fixo | 2 300 | 0,91 |
| madeira/compósito (Rotec, Verner) | 2 | 1,90 / 1,70 | 1,5 / 1,0 | fixo | 3 600 / 2 600 | 1,04 (!) / 0,67 |
| S-55: rotor | 3 | 16,15 | 2 400 | coletivo (rotor) | 245 | 0,61 |

(Rotec a 3 600 rpm com 1,9 m passa de Mach 1 na ponta: o motor é homologado para 2 900–3 300 contínuos com hélice menor; o preset limita a hélice a 1,75 m, `M_t` 0,96.)

Som na lenta × em cruzeiro, pelas gravações (A.1–A.2): na lenta a linha de ignição está 4–18 dB acima da mediana e os harmônicos da hélice 0–3 dB (longe) ou 11–13 dB (a 3 m da hélice); na decolagem a BPF e seus harmônicos estão 20–27 dB acima da mediana e a ignição 10–17 dB (Yak), ou os harmônicos 5–9 da BPF a 24–27 dB e a ignição a 10 dB (T-6). **O som é da hélice em cruzeiro e do escape na lenta**, e o modelo tem de reproduzir os dois regimes com a mesma calibração absoluta (3.7).

### 3.4 Partida: motores de arranque, contagem de pás, encharque e "tosses"

`partida` do preset: `'inercia'` (Eclipse: R-1820 do SBD/DC-3 antigos, R-1830, R-2800 de 1942–44), `'direta'` (elétrica: T-28, T-6G, P-47, Corsair tardio, R-4360, Sherman, Rotec, Verner), `'ar'` (M-14P/M-14PF: ar comprimido a 50 bar distribuído aos cilindros), `'manivela'` (Megola: empurrar). Sequência da página (botão de ignição vira um procedimento; tempos em segundos):

| Fase | `inercia` | `direta` | `ar` |
|---|---|---|---|
| 1. energizar | 12–20 s: volante do arranque acelera; **apito** subindo de 290 → 390 Hz em 18 s (DC-3, A.4; SBD termina em ~400 Hz), 30–40 dB acima da mediana, sem grave (60–150 Hz a −26 dB): tom + 2º harmônico −12 dB, `bp` Q 25, nível 0,02 Pa a 5 m; `mech` recebe | — | — |
| 2. engatar / girar | engate: estalo 50 ms + o apito cai em 2 s (`f ∝ e^(−t/1,5)`) enquanto o motor gira a 60–100 rpm por 2–4 s (energia do volante: `Tst = T0·(1 − t/3,5 s)`, `T0 = 6·cilindrada` N·m) | motor elétrico: `Tst = (8·cilindrada + 60)·max(0, 1 − rpm/220)` N·m; zumbido do redutor do arranque `rpm·11` (como hoje, `dsp.ts:1128`) ×2 de nível, mais ruído `bp 1,2 kHz` | distribuidor manda ar a cada cilindro em `a ∈ [5°, 60°]` após o PMS: gancho 8 injeta `ṁ = 0,02·(Vd/0,5 L)` kg/s a 20 bar no cilindro `c`; o pistão é empurrado e o ar sai pela válvula de escape: um "tchuf" por cilindro (4,5 por volta a 100–150 rpm: 7–11 Hz), 2–3 s |
| 3. contar pás | o painel conta as pás que passam (`n_h·B/60`: 3 pás a 50 rpm → 2,5 pás/s); 9–12 pás antes de ligar os magnetos (limpa o óleo dos cilindros de baixo); o usuário liga os magnetos quando quiser, o padrão automático liga na 9ª pá | idem | magnetos já ligados: pega na 2ª–3ª volta |
| 4. pegar | primeiras explosões irregulares: `falhaAv(c)` abaixo; o giro sobe para a lenta fria em 1–3 s | idem | idem |

**Encharque** (cilindros de baixo cheios de óleo com o motor parado): `encharque_c = max(0, −cos φ_c)` (1 no de baixo, 0 nos de cima; na dupla fileira idem por cilindro); `falhaAv(c) = 0,55·encharque_c·e^(−runT/8 s) + 0,12·e^(−runT/15 s) + termos de mistura e magneto`. Cada falha nos primeiros 20 s tem 35% de chance de **estourar no escape** (a mistura com óleo acende na chama do cilindro seguinte no coletor): `avHot = 0,8·e^(−runT/20 s)` no gancho 7, e a chance de estouro de uma falha com queima armada sobe de 0,015 (`dsp.ts:902`) para `prAv = 0,015 + 0,35·e^(−runT/20 s)`: a linha fica `if (combust) { pr = 0.015; k = 0.7; if (this.av) { pr = this.prAv; k = 0.9; } }` (o lado gasolina continua textual; este é o 15º gancho da tabela 1.6, na linha 902). **Na implementação** (TECNICO → Radial, medido com `tools/radial-estouros.ts` contra as gravações): com 35%, τ 20 s e o `k` 0,9 o R-1830 dava 21 estouros nos 3 s depois de pegar e 32 nos primeiros 20 s, 28–34 dB acima da envoltória de 1–6 kHz, e acelerar no primeiro minuto dava 2–7 estouros por segundo, o "pipoco" que o dono ouviu; as gravações têm 0–6 picos acima de 20 dB nos 20 s depois de pegar. Ficou `prAv = 0,015 + 0,06·e^(−runT/8 s)` (a constante do encharque), `avHot = 0,8·e^(−runT/8 s)` e `k` 0,25 (`ESTOURO_PARTIDA` em `aviacao.ts`): 3–5 picos acima de 20 dB em 20 s e 3–8 estouros nos primeiros 10 s com o primer 2. Fumaça: telemetria `fumaca = Σ falhas nos últimos 2 s / N`. Alvos (A.3): nos 3 s depois de pegar, `CVciclo` 0,8–1,1 e `CVlento` 0,5–0,9; aos 20 s, `CVciclo` ≤ 0,45 e `CVlento` ≤ 0,2; o espectro da partida é 3–6 dB mais brilhante que a lenta quente em 400 Hz–6 kHz (centroide 1,5–2×).

**Afogamento hidráulico** (óleo no cilindro trava o pistão): não modelado; a contagem de pás é só procedimento.

### 3.5 Parada

Mistura em corte: `Q = 0` em todos os cilindros, o motor bombeia ar e a hélice segue girando pela inércia: de 1 000 rpm a 0 em 4–8 s com `J` 30 kg·m² (Corsair) e 2–3 s com 7 (Yak). Som: pulsos de admissão/escape frios (`densC` baixo, `dsp.ts:982`), cliques do trem de válvulas e as pás passando cada vez mais devagar até parar com um "cloc" (a hélice para fora de posição e volta meia pá: `θ` final sorteado). Medido (A.4, Corsair): variação por ciclo 0,44 e giro caindo 982 → 0 em ~8 s.

### 3.6 Mistura e magnetos na dinâmica

Mistura pobre (0,55–0,65) em cruzeiro: `Q ×0,93`–`×0,97`, queima 10–20% mais lenta, escape mais quente (`exhT` +60 °C), som um pouco mais seco; auto-rica (0,8) é o ponto de potência; rica (1,0) perde 8% e esfria. "Mag check" a 1 700 rpm: queda de 60 ± 30 rpm em cada magneto; diferença entre eles ≤ 30 rpm (cada vela com `burnK` ×1,2; as falhas por magneto só com velas molhadas, `falhaAv += 0,02·encharque`).

### 3.7 Adaptador `Motor` e níveis absolutos

`src/engines/radial/motor.ts` implementa `Motor` (`CENA.md` 1.3) sobre `RadialDSP` (e serve de modelo para o do Ronco): `configurar` chama `setConfig` com a calibração feita fora; `comandar({acelerador, ignicao, partida, combustivel})` mapeia `acelerador → thrTarget` (`combustivel` definido manda em `thrTarget`: no motor a gasolina o governador do rotor mexe na borboleta), `partida` dispara a sequência de 3.4; `acoplar(carga)` → `this.carga` (gancho 11); `processar(saidas, n)` instala `this.tap = saidas` e chama `process(L, R, n)` (o estéreo legado é computado e descartado: custo pequeno). Canais (ordem fixa de `fontes`): `escape.k` (`x` de cada radiador antes da panorâmica, `×exScale·cfgGain·mk·g_abs`), `admissao` (`inS`), `bloco` (`mech + 3·vib`), `compressor` (`sc`), `partida` (motor de arranque e ar: `starterLP` e o canal do apito). **Escala**: `g_abs` leva a plena carga a 55% da rotação máxima ao `nivelEscape` do preset (`L_W` dB re 1 pW, convertido para Pa a 5 m por `L_p = L_W − 20·log₁₀ 5 − 11`): R-2800 148, R-4360 151, R-1820/R-1830 145, R-1340/R-985 142, M-14P 140, R-975 138, Rotec 130, Verner 124, Megola 118, Trossi 146. A hélice já é absoluta (Pa a 30 m); o equilíbrio entre as duas é o alvo de 3.3.

---

## 4. Alvos numéricos medidos nas gravações

Método (como `TECNICO.md` → Validação e `DIESEL.md` Apêndice A): WAV mono 48 kHz, Welch 8192, bandas em dB relativas a 150–400 Hz, centroide 100–8000 Hz. Acrescentado para o radial: frequência de ignição ancorada à mão e rastreada em janelas de 1 s (pente de 4 harmônicos a ±12%: `rpm` e `vagar` = desvio/média em %), níveis de linha (dB de pico sobre a mediana local, Welch 32768) nas ordens da hélice (`BPF`, `2·BPF`), da fileira (`N/2/fileiras`) e da ignição (`N/2`, `N`), `CVciclo` (desvio/média do RMS por janela de um período de ignição, banda 0,7–4·f_ign), `CVlento` (idem por 0,25 s) e fração periódica da banda 1–6 kHz. Scripts em `…/scratchpad/radialtools/` (`scan.py`, `linhas.py`, `medir2.py`, `geom3.py`), a portar para `tools/radial-bandas.ts`. Nenhum trecho foi ouvido; a escolha veio das varreduras (nível, centroide e linha dominante por janela de 2 s). Tabela completa no Apêndice A; aqui o que vira alvo.

### 4.1 Bandas (dB rel. 150–400 Hz) e centroide

| Regime (ouvinte do simulador ↔ microfone real) | 60–150 | 400–1k | 1–2,5k | 2,5–6k | 6–12k | centroide (Hz) | fonte |
|---|---|---|---|---|---|---|---|
| **lenta 9 cil. grande, 10–15 m de lado** (`ext` a 12 m) | +4 ± 4 | −6 ± 3 | −15 ± 4 | −14 ± 4 | −23 ± 5 | 370 ± 80 | Yak-52 Commons; T-28 (sem grave no microfone) |
| **lenta 9 cil., perto do motor, escape exposto** (`ext` a 4 m) | +12 ± 3 | −1 ± 2 | +2 ± 3 | 0 ± 3 | +2 ± 4 | 1 300 ± 200 | T-6G (OtN 14–34) |
| **lenta 14 cil., 10 m** | +5 ± 2 | −7,5 ± 1,5 | −11 ± 2 | −12,5 ± 2 | −18 ± 2 | 340 ± 40 | DC-3 (z6e) |
| **lenta 14 cil., 3 m da hélice** | −5 ± 2 | −6 ± 2 | −14 ± 3 | −22 ± 3 | −31 ± 4 | 345 ± 40 | DC-3 (ibg) |
| **lenta 18 cil. coletor único + turbina, 5 m** | +5 ± 2 | −6,5 ± 2 | −12 ± 3 | −10 ± 3 | −12 ± 4 | 330–650 | P-47 (LCx) |
| **lenta 18 cil. estaques por fileira, 8 m** | −4 ± 3 | −5 ± 2 | −9 ± 3 | −14,5 ± 3 | −27 ± 4 | 400 ± 60 | Corsair (TLv 68–82) |
| **lenta 18 cil. em banco, 1 000 rpm** | +4 | −3 | −7 | −8 | −9 | 850 | R-2800 (7yF) |
| **lenta 7 cil. pequeno, 3–5 m** | +3 ± 3 | −8 ± 1 | −4 ± 1 | −6 ± 2 | −9 ± 2 | 1 050 ± 150 | Rotec (pm3, PL6) |
| **decolagem 9 cil. (Yak-52, 2 850 rpm), 50–100 m** | −2 | −13 | −10,5 | −10 | −15,5 | 580 | OV77 7–12 |
| **decolagem 9 cil. direto (T-6, 2 200 rpm), 50 m** | −11 | −1 | 0 | −5 | −20 | 1 100 | LH9 12–20 |
| **decolagem 18 cil. (Corsair 2 300 rpm), 150 m** | −16 | −12 | −10 | −15 | −24 | 456 | jKa 60–65 |
| **passagem 18 cil. (P-47, 2 000 rpm)** | −4,5 | +2 ± 2 | −2 ± 2 | −12 ± 5 | −28 ± 8 | 700 ± 100 | JL3 |
| **passagem 18 cil. alta (Corsair airshow 2 380)** | −6 … −24 | +4 … −2 | +6 … −5 | +2 … −8 | −14 | 900–1 500 | Hahnweide |
| **afastando (T-6 1 800; Trimotor 2 100)** | −3 … −6 | −19 … −3 | −16 … −15 | −16 … −20 | −36 … −22 | 260–400 | LH9 24–34; Trimotor 18–30 |

Tolerância de aceitação: ±4 dB por banda, centroide ±30%, nos cenários correspondentes (`idle` a 12 m e a 4 m, `takeoff` a 50 m, `flyby`). Para contraste, o Ronco em lenta (`TECNICO.md`): Camaro −11/−17/−18/−23 (centroide 266 Hz): o radial na lenta, a poucos metros, é 5–20 dB mais brilhante que um carro (motor exposto, escape curto de chapa, sem capô).

### 4.2 Linhas de ordem

| Regime | linha dominante | outras | o que o modelo tem de dar |
|---|---|---|---|
| 9 cil. lenta (Yak, T-6, SBD, T-28) | ignição 4,5ª: +10 a +18 dB sobre a mediana | 2·BPF 0 a +3 (Yak), +10 (T-6: hélice direta, 2ª ordem); 9ª ordem +2 a +8 | ignição ≥ 10 dB acima da mediana; hélice ≤ ignição − 8 dB a 10 m |
| 14 cil. lenta (DC-3, 10 m) | ignição 7ª: +9 a +14 | fileira 3,5ª: 0 a +6; BPF e 2·BPF: 0 a +3 | fileira entre −5 e −12 dB da ignição total (coletor único) |
| 14 cil. a 3 m da hélice (DC-3 "singing") | 2·BPF e 3·BPF (64,5 e 96,7 Hz): +11 a +15 | ignição 7ª: +8 a +10; 5·BPF +7 | hélice ≥ ignição perto da hélice |
| 18 cil. lenta, coletor único + turbina (P-47) | ignição 9ª: +4 a +6 | fileira 4,5ª: −1 a +2 (+10 na lenta baixa de 590 rpm) | 9ª ≥ 4,5ª |
| 18 cil. lenta, estaques por fileira (Corsair, R-2800 em banco) | fileira 4,5ª: +6; 2·BPF (3,5ª ordem, 0,4375:1): +10 a +14 | ignição 9ª: 0 a +10 | 4,5ª ≥ 9ª − 3 dB |
| 18 cil. decolagem (Corsair) | fileira 4,5ª (170 Hz): +19 | ignição 9ª: +6,5; BPF +1 a +3 | 4,5ª ≥ 9ª + 8 dB |
| 9 cil. decolagem, redutor (Yak 2 850) | BPF 62,5 Hz: +20 a +27; 2·BPF +13 a +23; 3·BPF +9 a +21 | ignição 215 Hz: +17 | BPF ≥ ignição + 5 dB; harmônicos 1–3 da BPF dentro de 8 dB |
| 9 cil. decolagem, direto (T-6 2 200, `M_t` 0,95) | harmônicos 5–9 da BPF (366, 440, 513, 586, 660 Hz): +24 a +27 | ignição 4,5ª (165 Hz): +10; BPF +5 | harmônicos 5–9 dentro de 6 dB entre si e ≥ ignição + 10 dB |
| 7 cil. lenta (Rotec 1 200) | ignição 3,5ª (70 Hz): +10 a +15; **3·f_ign** (10,5ª, 210 Hz): +9 a +16 | 6·f_ign (440 Hz): +6 a +12; 4ª ordem (82 Hz) +15 em trechos | 3ª harmônica da ignição a 0 ± 4 dB da fundamental (estaque de 0,6 m) |

Razões `f_ign/BPF` medidas (Yak 3,44; DC-3 4,16; P-47 4,49; Corsair 5,13; T-6 2,25) batem com `N·i/(2B)` a ±1%: são a prova da redução de cada preset e o primeiro teste do passo 6.

### 4.3 Vagar da lenta e "galope"

| Regime | vagar da rotação (%, janelas de 1 s) | `CVciclo` | `CVlento` | fração periódica 1–6 kHz |
|---|---|---|---|---|
| lenta quente, carburador de pressão (DC-3, Corsair, P-47 baixo) | 2,6–3,6 (P-47 a 800 rpm: 6–7, com a turbina) | 0,27–0,41 | 0,05–0,19 | 0,07–0,10 |
| lenta, carburador de boia (T-6, Yak, Rotec) | 1,7–5,1 | 0,34–0,45 | 0,08–0,35 | 0,10–0,16 |
| aquecendo logo depois de pegar (SBD, T-28) | 4,6–8 | 0,76–0,85 | 0,43 | 0,12–0,16 |
| 3 s depois de pegar | 5–8 | 0,80–1,11 (Corsair 0,37: partida limpa) | 0,51–0,88 | — |
| decolagem / passagem | 1,3–6,5 (Doppler entra) | 0,35–0,58 | 0,11–0,27 | 0,02–0,05 |

Alvos: lenta quente `vagar` 2–4%, `CVciclo` 0,30–0,42, `CVlento` 0,05–0,20; aquecendo (primeiros 60 s) `CVciclo` 0,5–0,8; partida como em 3.4. No Ronco o "galope" do carburador é a dispersão ×2,6 e a variação ×1,9: nos radiais de carburador de pressão vale ×1 e nos de boia ×2,6; a inércia alta é o que segura o vagar em 2–4% apesar das falhas.

### 4.4 O que distingue um 9 de um 18 e de um 7 pequeno

- **9 cilindros**: ignição na 4,5ª ordem (45–75 Hz na lenta): pulsos que se contam, intervalos de 80° com os ±5° das articuladas (irregularidade de fase que um 6 em linha não tem); a hélice em 1,69ª (16:9) ou 1,32ª (0,658) ordem não é múltipla da ignição e os dois pentes se cruzam a cada 8 ou 25 voltas: o "balanço" lento da lenta de um radial (0,5–2 Hz) vem daí e das falhas. Centroide 350–450 Hz a 10 m, 1 300 a 4 m. Na decolagem a hélice domina (+5 a +15 dB sobre a ignição) e o espectro é a BPF com harmônicos até a 3ª (redutor, `M_t` 0,7) ou até a 9ª (direto, `M_t` 0,95).
- **18 cilindros**: ignição na 9ª ordem (90–130 Hz na lenta): um zumbido denso onde não se contam pulsos; mas com os coletores separados por fileira a 4,5ª ordem (cada fileira é um 9) fica igual ou acima da 9ª, e o som é "dois noves intercalados", um de cada lado da carenagem; com coletor único (P-47) a 9ª vence e o 18 soa como um só motor grande e liso, com o assobio da turbina por cima. Na decolagem (350–420 Hz de ignição) o escape vira um rugido contínuo e a 4,5ª da fileira (170–210 Hz) é a linha mais forte do Corsair; a hélice de 4 pás a 2:1 fica em 80–90 Hz com poucos harmônicos (`M_t` 0,75–0,82). Vagar maior na lenta (3–7%) por causa do coletor longo e da massa de ar do superalimentador.
- **7 cilindros pequeno (Rotec, 2,8 L)**: lenta alta (1 100–1 250 rpm) com ignição em 3,5ª ordem (65–73 Hz, igual à de um 9 grande a 800 rpm) e intervalos de 102,9°: há "buracos" entre os pulsos, cada estaque curto estala sozinho e ressoa em 1/4 de onda (217 Hz) de modo que a 3ª harmônica da ignição fica tão forte quanto a fundamental; sem superalimentador, cilindros pequenos e aletas finas: centroide 1 000–1 200 Hz a 3–5 m, bandas de 1–6 kHz só 4–7 dB abaixo da referência (um 9 grande a 10 m fica 11–15 dB abaixo); hélice direta a 1,75× a ignição.

---

## 5. Presets

### 5.1 Campos novos (`PresetRadial = PresetRonco & {…}`)

| Campo | Tipo / faixa | Significado |
|---|---|---|
| `layout: 'radial'`, `rows`, `cylPerRow` | 1 / 2 / 4; `N/rows` | fileiras |
| `crank: 'mestra' \| 'mestra4'`, `Lr`, `rkr`, `delta?` | 3,4–4,2; 0,9–1,3; graus por cilindro | biela-mestra (1.2); `delta` omitido = `φ_c` |
| `order?` | texto | ausente no R-4360 (ordem decorrente) |
| `J` | kg·m² | inércia do motor sozinho (3.2) |
| `rpmMax`, `power`, `torque?` | rpm, kW, N·m | ficha (`redline` recebe `rpmMax` para o tacômetro) |
| `reducao` | razão hélice/motor (0,375–1) | `i = 1/reducao` no portador |
| `helice` | `{ B, D, J, passoFixo, beta0?, nMin?, nMax }` | tabela 3.3; vai para `carriers/helice` |
| `partida` | `'inercia' \| 'direta' \| 'ar' \| 'manivela'` | 3.4 |
| `magnetosPadrao`, `misturaPadrao` | `'ambos'`; 0,8 | estado inicial dos controles |
| `superalimentador?` | `{ relacao, pas, boost, uivoDb, duasVelocidades? }` | mapeia em `aspiration 'super'`, `scType 'centrifugal'`, `scRatio`, `scLobes`, `boost`, `scWhine` |
| `carburador` | `'pressao' \| 'boia'` | dispersão ×1 ou ×2,6 (`fuel`) |
| `escape` | `{ tipo: 'anel' \| 'tubos' \| 'aranha', Danel?, Oanel?, Lp, saidas: {L, O, phi}[], agrupar?: number, turbina?: {Lantes, Ldepois} }` | 2.1 (por fileira: `escape` é um objeto ou uma lista com um por fileira) |
| `nivelEscape` | dB re 1 pW | 3.7 |
| `posFontes` | `{ escape: Vec3[], admissao: Vec3, bloco: Vec3 }` | fontes da Cena no referencial do motor |
| `portadores` | `('helice' \| 'rotor' \| 'carro' \| 'nenhum')[]` | compatibilidade |
| `aeronave? / veiculo?` | massa, `Corpo`, posição do motor | passados ao portador |
| `tempos?` | 2 (só Monaco-Trossi) | depende do Diesel |
| `rotativo?` | `{ i: 6 }` (só Megola) | motor gira com a roda: panorâmica dos estaques gira a `rpm/6` |

Campos do Ronco **sem efeito** no radial (o painel não mostra): `limiter*`, `twoStep`, `launchRpm`, `valve`, `reso`, `routing/header/muffler/pipeLen` (substituídos por `escape`), `gears/transmission` (exceto Sherman, Trossi, Megola), `overrun` (fixo `'lean'`: carburador não corta), `cat` (`false`).

### 5.2 Fichas

Valores de manual onde públicos; "≈" estimados pela classe. `lenta` é a rotação-alvo quente; "medido" é o que as gravações deram (Apêndice A).

| # | Preset (`id`) | Motor | Cil. × fileiras, Ø × curso (mm), L | CR | lenta / máx (rpm) | potência | `J` (kg·m²) | redução · hélice (B, D m, J) | carb., superalim. (razão, pás, bar) | partida | escape | portadores · veículo |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Wright R-1820-86 Cyclone (`r1820`) | T-28B Trojan (e DC-3 inicial, R-1820-G: 1 100 hp @ 2 350, 16:11) | 9 × 1, 155,6 × 174,6, 29,9 | 6,7 | 600 / 2 700 (medido 740–940 aquecendo) | 1 063 kW (1 425 hp) @ 2 700 | 2,2 | 16:9 (0,5625) · 3, 3,05, 45 | pressão Stromberg PR-48; 7,2:1, 12, 0,35 | direta (T-28) | `anel` Ø 1,25 m, 2 saídas 0,6 m Ø 90 | hélice · T-28B 3 850 kg, 10,2 × 12,2 m |
| 2 | P&W R-1830-92 Twin Wasp (`r1830`) | DC-3 / C-47 | 14 × 2, 139,7 × 139,7, 30,0 | 6,7 | 600 / 2 700 (medido 790–1 150) | 895 kW (1 200 hp) @ 2 700 | 2,3 | 16:9 · 3, 3,50, 55 | pressão Stromberg PD-12; 7,15:1, 12, 0,3 | inércia | `anel` Ø 1,15, 1 saída 1,2 m Ø 100 sob a nacele | hélice · C-47 11 800 kg, 19,4 × 29 m, 2 motores (±0,3% rpm, sem sincronizador) |
| 3 | P&W R-2800-18W Double Wasp (`r2800`) | F4U-4 Corsair | 18 × 2, 146 × 152, 45,9 | 6,75 | 650 / 2 800 (medido 690–1 125; decolagem 2 300–2 760) | 1 566 kW (2 100 hp) @ 2 800; 2 450 com água | 3,2 | 0,4375 · 4, 4,01, 120 | pressão Stromberg PT-13; 2 velocidades 7,6/9,5:1, 16, 0,5/0,7 | inércia elétrica | `tubos` por fileira, `L_t` 0,55–0,8, 6 saídas Ø 70 agrupadas em 2 | hélice · F4U-4 5 600 kg, 10,3 × 12,5 m |
| 4 | P&W R-2800-59 (`r2800turbo`) | P-47D Thunderbolt | idem | 6,65 | 650 / 2 700 (medido 590–800; passagem 2 000–2 100) | 1 490 kW (2 000 hp), 2 300 WEP | 3,2 | 2:1 · 4, 3,96, 110 | pressão; 7,6:1 + turbina GE C-23 | direta | 2 `anel` → `single`: 2 × 3,8 m Ø 90 → `TwoPort 'turbo'` → 1,0 m Ø 110 (cauda) | hélice · P-47D 6 600 kg, 11 × 12,4 m |
| 5 | P&W R-4360-20 Wasp Major (`r4360`) | B-50 / C-124 | 28 × 4, 146 × 152, 71,5 | 6,7 | 700 / 2 700 | 2 610 kW (3 500 hp) @ 2 700 | 5,5 | 0,375 · 4, 5,08, 300 | pressão Bendix PR-100; 6,37:1, 18, 0,6 | direta | 4 `anel` Ø 1,35 aos pares → 2 saídas 1,5 m Ø 110 | hélice · C-124 (por motor) 80 t, 40 × 53 m; **nenhum** (bancada) |
| 6 | Vedeneyev M-14P (`m14p`) | Yak-52 | 9 × 1, 105 × 130, 10,16 | 6,3 | 760 (26%) / 2 900 (medido 980–1 045 pós-partida; 2 850 decolagem) | 265 kW (360 hp) @ 2 900 | 0,7 | 0,658 · 2, 2,40, 7 | boia AK-14P; 8,26:1, 14, 0,25 | ar (50 bar) | `anel` Ø 0,90, 2 saídas 0,4 m Ø 60 | hélice · Yak-52 1 300 kg, 7,7 × 9,3 m |
| 7 | Vedeneyev M-14PF / "Sh-14" (`m14pf`) | Su-31, Yak-55M | idem | 6,3 | 700 / 2 950 (Commons "Start-Sh-14": ≈ 530 rpm logo após pegar, incerto) | 294 kW (400 hp) @ 2 950 | 0,7 | 0,658 · 3, 2,50, 5 (MTV-9) | boia; 8,26:1, 14, 0,3 | ar | `tubos`, 9 estaques 0,35 m Ø 45 (acrobático) | hélice · Su-31 780 kg |
| 8 | P&W R-1340-AN-1 Wasp (`r1340`) | T-6 Texan / Harvard | 9 × 1, 146 × 146, 22,0 | 6,0 | 600 / 2 250 (medido 720–940 frio; 2 200 decolagem) | 447 kW (600 hp) @ 2 250 | 1,6 | direto · 2, 2,74, 16 (2 posições: `nMin` 1 800) | boia NA-Y9 (updraft); 10:1, 12, 0,2 | direta (Eclipse E-80) | `anel` Ø 1,10 chapa fina, 1 saída 1,0 m Ø 76 à direita | hélice · T-6 2 550 kg, 8,8 × 12,8 m |
| 9 | P&W R-985 Wasp Junior (`r985`) | Ford Trimotor 5-AT (3 motores), Beech 18 | 9 × 1, 131,8 × 131,8, 16,1 | 6,0 | 600 / 2 300 (medido 1 850–2 130 em passagem) | 336 kW (450 hp) @ 2 300 | 1,1 | direto · 2, 2,60, 12, **passo fixo** | boia NA-R; 10:1, 12, 0,2 | inércia | `anel` Ø 1,00, 1 saída 0,8 m Ø 70 | hélice · Trimotor 6 100 kg, 15,3 × 23,7 m, 3 instâncias (opcional, 8.1 risco) |
| 10 | Rotec R2800 (`rotec2800`) | Kitfox, Pietenpol | 7 × 1, ≈ 90 × 64, 2,8 | 8,5 | 1 000 / 3 600 (medido 1 150–1 500) | 82 kW (110 hp) @ 3 600 | 0,15 | direto · 2, 1,75, 1,5, passo fixo | boia Bing 64 (ou TBI Rotec); — | direta | `tubos`, 7 × 0,60 m Ø 38 | hélice · Kitfox 550 kg, 6,1 × 9,8 m |
| 11 | Rotec R3600 (`rotec3600`) | Pietenpol, réplicas | 9 × 1, idem, 3,6 | 8,5 | 950 / 3 600 | 112 kW (150 hp) @ 3 600 | 0,2 | direto · 3, 1,80, 1,8, fixo | boia; — | direta | `tubos`, 9 × 0,60 Ø 38 (ou `anel` 0,75) | hélice · réplica 700 kg |
| 12 | Verner Scarlett 3V (`verner3`) | ultraleves (Zenith CH 701) | 3 × 1, ≈ 97 × 72, ≈ 1,6 | 8,0 | 700 / 2 500 | 31 kW (42 hp) @ 2 500 | 0,05 | direto · 2, 1,70, 1,0, fixo | boia; — | direta | `tubos`, 3 × 0,45 Ø 35 | hélice · 380 kg |
| 13 | Verner Scarlett 5S (`verner5`) | Savage, Kitfox | 5 × 1, ≈ 97 × 80, 2,3 | 8,0 | 650 / 2 600 | 77 kW (103 hp) @ 2 600 | 0,08 | direto · 2, 1,90, 1,2, fixo | boia; — | direta | `tubos`, 5 × 0,45 Ø 35 | hélice · 550 kg |
| 14 | Continental R-975-C4 (`r975`) | M4A1 Sherman | 9 × 1, 127 × 140, 15,9 | 5,7 | 600 / 2 400 | 298 kW (400 hp) @ 2 400 | 1,4 + volante 2,5 | — (embreagem, 5 marchas 7,56/3,11/1,78/1,11/0,73, final 2,84, roda motriz 0,32 m) | boia Stromberg NA-R9; 10:1, 12, 0,15 | direta | 2 meio-anéis (`lados`: 5 + 4 cil.) → 2 × 1,5 m Ø 90 na traseira | **carro** (`CarroLegado`: 30 300 kg, `drag` 4,5, rolagem 0,06·m·g pelas esteiras: `roll` do preset) · 5,9 × 2,6 × 2,7 m; sem o ruído da esteira (aproximação) |
| 15 | Monaco-Trossi (`trossi`) | carro de GP 1935 | 16 × 2 (2 anéis de 8), 65 × 75, 3,98, **2 tempos** | 6,5 | 1 200 / 6 000 | 186 kW (250 hp) @ 6 000 | 0,4 | — (4 marchas, tração dianteira) | 2 compressores Zoller (palhetas: `centrifugal`), 0,6 bar | direta | `tubos`, 16 × 0,30 Ø 40 | **carro** 1 000 kg · depende de `tempos: 2` (Diesel); senão 4T marcado "aproximação" |
| 16 | Megola (`megola`) | moto 1921, motor na roda dianteira | 5 × 1, 52 × 60, 0,64 | 5,0 | **sem lenta** (para com a roda) / 4 800 | 10 kW (14 hp) @ 4 800 | 0,02 | roda = `rpm/6` (planetário); sem embreagem nem câmbio (`ratios [6]`, `finalDrive` 1, roda 0,33 m) | boia; — | manivela (empurrar: `v` inicial 2 m/s) | `tubos`, 5 × 0,25 Ø 30, **girando com a roda** | **carro** (moto 200 kg) · aproximação |
| 17 | Sikorsky S-55 / H-19 (`s55`) | R-1340-57, 600 hp @ 2 250 | 9 × 1 (= #8) | 6,0 | 1 000 (rotor engatado) / 2 250 | 447 kW | 1,6 | caixa `i_cx` 9,18 (Nr 245) · rotor 3 pás D 16,15 m, `J_rot` 2 400; cauda 2 pás D 2,64 m, 1 440 rpm | boia; 10:1 | direta | `anel`, 2 saídas 0,5 m pelo nariz | **rotor** · 2 300 kg vazio, 3 400 máx; 12,9 × 2,4 × 4,1 m, `m_s` 6, `fCabine` 55 |

Diferenças fixas entre cilindros: as do Ronco (`setConfig`: ar ±7%, área ±10%, energia ±5%) com o `spread` do carburador (×2,6 nos de boia), mais o `curso[c]` determinístico de 1.2.

### 5.3 Tabela motor × portador (linhas novas da tabela 1.6 do `CENA.md`)

| Motor | hélice (avião) | rotor (helicóptero) | carro (tanque, carro, moto) | nenhum (bancada) |
|---|---|---|---|---|
| 1–13 (aviões) | ✓ | — | — | ✓ |
| 14 R-975 Sherman | — | — | ✓ tanque (`CarroLegado`, esteira não modelada) | ✓ |
| 15 Monaco-Trossi | — | — | ✓ carro | ✓ |
| 16 Megola | — | — | ✓ moto | — (sem lenta: não roda em bancada) |
| 17 S-55 | — | ✓ (`carriers/rotor.ts`, `HELICOPTEROS.s55`) | — | ✓ |

`COMPAT.carro` ganha `'radial'`; `COMPAT.helice` e `COMPAT.rotor` já têm.

---

## 6. Família "aviação" no Ronco

Motores planos refrigerados a ar e os helicópteros leves que os usam. Rodam no **`EngineDSP` sem subclasse**, com `aviation: true` no preset (→ `av` = true: ganchos 4–8, 10, 11, 13) e os campos `partida`, `helice`, `J`, `reducao`, `portadores`, `nivelEscape` de 5.1 (o `PresetRonco` ganha esses opcionais; os 68 carros não os têm e nada muda para eles). Família `aviacao` em `FAMILIES`, depois de `moto`.

| # | Preset (`id`) | Motor | Base do Ronco | L, CR | lenta / máx | potência | `J` + hélice | `fuel`, `cooling` | escape | portadores |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Cessna 172 (`c172`) | Lycoming O-320-E2D | `B4` (`boxer-4`, `1-3-2-4`) | 5,24, 7,0 | 650 / 2 700 | 112 kW | 0,3 + 2 pás 1,93 m, 5, fixo | `carb` (MA-4SPA updraft), `air` | `header 'short'`, `routing 'single'`, `muffler 'classic'`, `pipeLen` 0,8, `pipeD` 1,75, `breakout 'old'` | hélice (C172: 1 100 kg, 8,3 × 11 m) |
| 2 | Piper Archer / RV-7 (`o360`) | O-360-A4M | `B4` | 5,92, 8,5 | 650 / 2 700 | 134 kW | 0,35 + 2 pás 1,88 m, 5, fixo | `carb`, `air` | idem, `pipeLen` 0,7 | hélice (1 150 kg) |
| 3 | Piper Saratoga (`io540`) | IO-540-K | `B6` (`boxer-6`, `1-6-3-2-5-4`) | 8,87, 8,5 | 650 / 2 700 | 224 kW | 0,5 + 3 pás 2,03 m, 9, variável (`nMin` 2 000) | `efi` (Bendix RSA), `air` | `routing 'dual'` → 1 abafador, `pipeLen` 0,9, `pipeD` 2,0 | hélice (1 630 kg) |
| 4 | Cessna 150 (`o200`) | Continental O-200-A | `B4` | 3,29, 7,0 | 650 / 2 750 | 75 kW | 0,2 + 2 pás 1,75 m, 3, fixo | `carb` (MA-3SPA), `air` | `single`, `classic`, 0,7 | hélice (730 kg) |
| 5 | Cirrus SR22 (`io550`) | Continental IO-550-N | `B6` | 9,05, 8,5 | 700 / 2 700 | 231 kW | 0,5 + 3 pás 1,98 m, 9, variável | `efi`, `air` | `dual` → 1, 0,9, 2,0 | hélice (1 630 kg) |
| 6 | Rotax 912 ULS (`rotax912`) | 912 ULS | `B4` | 1,35, 10,8 | 1 400 / 5 800 | 73 kW | 0,08 + redutor 2,43:1, 3 pás 1,70 m, 1,2 | `carb` (2 × Bing 64), `water` (cabeçotes) | `single`, `sport`, 0,6, 1,5 | hélice (ultraleve 600 kg) |
| 7 | Bell 47G (`bell47`) | Franklin 6V4-200-C32 (200 hp @ 3 100) ou Lycoming VO-435 | `B6` | 5,73, 7,0 | 1 500 / 3 100 | 149 kW | 0,4; caixa `i_cx` 8,4 (Nr 370), rotor 2 pás D 11,32 m, `J_rot` 1 100, cauda 2 pás D 1,78 m | `carb`, `air` | `dual`, `straight`, 0,6 | **rotor** (1 340 kg; `fCabine` 60, bolha: `m_s` 3) |
| 8 | Robinson R22 (`r22`) | O-360-J2A (124 hp limitados) | `B4` | 5,92, 8,5 | 1 500 / 2 652 | 92 kW | 0,35; `i_cx` 5,0 (Nr 530), `HELICOPTEROS.r22` | `carb`, `air` | `single`, `stock`, 0,8 | **rotor** |
| 9 | Robinson R44 (`r44`) | O-540-F1B5 (245 hp @ 2 718) | `B6` | 8,87, 8,5 | 1 500 / 2 718 | 183 kW | 0,5; `ROTOR_R44` (`i_cx` 6,66, Nr 408) | `carb`, `air` | `dual` → 1, `stock`, 0,9 | **rotor** |
| 10 | Schweizer 300C (`s300`) | HIO-360-D1A (190 hp @ 3 200) | `B4` | 5,92, 8,5 | 1 500 / 3 200 | 142 kW | 0,35; `i_cx` 6,8 (Nr 471), rotor 3 pás D 8,18 m, `J_rot` 450 | `efi`, `air` | `single`, `straight`, 0,6 | **rotor** |

O que muda em relação a um carro do Ronco: rotação máxima 2 700 (o `cam` fica 0,1–0,2 e as válvulas abrem pouco: `evo/evc/ivo/ivc` do `cam`, `dsp.ts:300–301`, dão o cruzamento pequeno certo); `cooling 'air'`; escape curtíssimo de chapa (0,6–0,9 m) com abafador de lata (`'classic'`) e `breakout 'old'`; sem câmbio (ficam em ponto morto: `gear` 0, `Tcl` 0; a carga é a `Carga` do portador pelo gancho 11; a seção Transmissão some); redutor só no Rotax (`reducao` 1/2,43) e nos helicópteros (`i_cx` do rotor). A lenta de 650 rpm com `J` ≈ 6 kg·m² (hélice refletida) é mais lenta de resposta que a de qualquer carro; o teste de lenta cobre. Partida sempre `'direta'`; contagem de pás sem sentido (não há óleo embaixo): `encharque = 0`, `falhaAv` só da mistura.

**Rotor com motor a gasolina** (R22, R44, Bell 47, S300): o portador `Rotor` já manda `combustivel` do governador PI (0,8 por %, 0,4/s) ao motor; no `MotorRonco`, `combustivel` definido escreve `thrTarget` (o governador do R44 mexe de fato na borboleta). Alvo (`CENA.md` 5.10): Nr 408 ± 2% (R44), droop 2–3% ao puxar o coletivo em 1 s, recuperação em ~1 s; BPF 13,6 Hz medida; a caixa (`caixa` do rotor) e o escape do O-540 (ordem 3 a 1 500–2 718 rpm: 75–136 Hz) somam; na lenta do rotor desengatado (R44: 1 500 rpm sem rotor) só o motor. O S-55 (5.2 #17) usa o mesmo caminho com o `MotorRadial`.

Adaptador do portador hélice/rotor para esta família: `src/engines/ronco/motor.ts` (`MotorRonco`, 3.7), com `familia = 'pistao'`; posições das fontes no motor pelo `engine 'front'` do `CENA.md` 1.3, mais `posFontes` quando o preset traz.

---

## 7. Interface

### 7.1 Página `radial.html`

Mesma casca (`Barra`, `FamilyNav`, `PresetNav`, `AudioShell`, perfil de áudio `PERFIL_RONCO`), mostradores em canvas fora do React. Famílias: Clássicos americanos (1–5, 8, 9), Soviéticos (6, 7), Pequenos modernos (10–13), Terra (14–16), Helicóptero (17). Seções, em relação ao Ronco:

| Seção do Ronco | No radial |
|---|---|
| Escuta e ambiente | **igual** (`ext/int/bay/pipe/road`, ambientes, mixes, mestre, dinâmica, fundo); `road` com portador hélice vira a Passagem com altitude (`CENA.md` 3, avião: 150 m, 300 km/h) |
| Motor | fileiras (1/2/4) e cilindros por fileira (3/5/7/9), virabrequim (`mestra`, `L/r`, `r_k/r`), ordem (texto; no R-4360 só leitura: "decorrente"), cilindrada, lenta, `rpmMax`, taxa de compressão; **somem** `cam` como "bravo" (vira "cruzamento 0–0,3") e `fuel` (vira "carburador: pressão/boia") |
| Características | `J`, `power`, redução, hélice (B, D, J, passo fixo/variável) |
| Corte de giro | **substituída por "Magnetos e mistura"**: magnetos OFF/ESQ/DIR/AMBOS (tecla `M` cicla; mag check com leitura da queda de rpm), mistura 0–100% (teclas `[`/`]`; marcas: corte, pobre, auto-rica, rica), superalimentador baixa/alta (R-2800) |
| Temperatura do motor | **igual** mais CHT (temperatura de cabeça, °C, a mesma equação com constante 2×) no lugar da água, indicador de fumaça, `encharque` por cilindro (anel do ciclo com os de baixo em cinza até secarem) |
| Transmissão | **oculta** (aviões, helicóptero, bancada); igual para Sherman, Trossi (4 marchas) e Megola (sem marcha: só a roda) |
| Escapamento | **substituída**: tipo (`anel`/`tubos`/`aranha`), `D_anel`, Ø, número e comprimento das saídas, `breakout`; dupla fileira: `dual`/`single`; turbina (P-47) com `Lantes/Ldepois` |
| Acessórios / Estalos / Admissão | **somem** (válvula, ressonador, 2-step, mapas de estouro, borboletas); Admissão vira "Superalimentador" (razão, pás, pressão, uivo em dB) |
| **nova**: Partida | tipo (`inercia`/`direta`/`ar`), botão em duas fases (ENERGIZAR … ENGATAR; ou GIRAR), contador de pás (automático na 9ª ou manual: tecla `I` liga os magnetos), prime (0–3 bombadas: `encharque` ×(1 + 0,3·prime) nos de baixo e menos falhas nos de cima) |
| **nova**: Hélice (portador) | manete de potência (na implementação, a da Turbina, `src/ui/Manete.tsx`: fica onde foi deixada, W/S seguradas, 1–4 lenta/cruzeiro/subida/decolagem, arrasto; no Sherman, no Trossi e na Megola, o pedal), manete de passo = rpm-alvo da hélice (`nMin`–`nMax`; `nMax` na decolagem, 65–75% em cruzeiro), passo fixo (sem controle), leituras: rpm da hélice, BPF, `M_t`, torque de carga, `β` |
| **nova**: Rotor (S-55) | coletivo (pedal), Nr (%), BPF principal e de cauda, droop, torque; como `CENA.md` 1.6 |
| **nova**: Terra (Sherman/Trossi/Megola) | pedal, freio, marchas como no Ronco; Megola: "empurrar" (dá `v` 2 m/s e o motor pega) |

Mostradores: tacômetro com fundo de escala `1,15·rpmMax` (3 000 ou 4 000; Rotec 4 000; Trossi 7 000) **e** em % (soviéticos); anel do ciclo de ignição com as fileiras em cores e os PMS reais (ΔPMS visível como pequenos deslocamentos dos traços), pressão de admissão (inHg, do `pMan`), CHT, rpm da hélice e BPF, `M_t`, contador de pás na partida, onda e espectro como hoje, e a vista da pista (avião parado na cabeceira, decolagem como animação da Passagem). Telemetria a cada 1 024 amostras com os campos do gancho 14.

### 7.2 O que muda no Ronco para a família aviação

Com `aviation: true` no preset selecionado: a seção **Corte de giro** vira **Magnetos e mistura** (os mesmos controles de 7.1), **Transmissão** se oculta, **Partida** aparece (só `direta`, sem contador), **Hélice** aparece quando o portador é hélice (manete de passo só nos de passo variável) e **Rotor** quando é rotor (coletivo, Nr); os demais controles continuam com o mesmo nome e lugar (paridade de interface: nenhum controle existente some; a lista dos que mudam de seção é esta). O botão de ignição passa a "Magnetos + partida" nestes presets, e o pedal dá lugar à manete de potência da Turbina (`src/ui/Manete.tsx`, a mesma do Radial). Nos 68 carros nada muda (a condição é a flag do preset).

---

## 8. Plano de implementação e verificação

Ferramentas (`tools/`, TypeScript com `tsx`): `radial-render.ts` (cenários `idle`, `cold`, `start` (partida completa, 30 s), `runup` (lenta → `rpmMax` em 10 s com hélice), `takeoff`, `flyby`, `magcheck`, `shutdown`; WAV float e JSON com `rpm, rpmHelice, bpf, machPonta, thr, mistura, magnetos, encharque, fumaca, torqueCarga` a cada 1 024 amostras), `radial-lenta.ts` (todos os presets a 20 °C e −5 °C, 30 s, acelerada aos 12 s; zero apagamentos, rpm ±3%; NaN = falha), `radial-geometria.ts` (tabelas do Apêndice B), `radial-bandas.ts` (porta de `medir2.py`: bandas, linhas de ordem, vagar, `CVciclo`, `CVlento`, fração periódica) e `radial-cpu.ts`. Cada passo termina num comando só (`npm run teste:radial -- <passo>`); os números vão para o relatório.

| # | Passo | Entrega | Teste objetivo |
|---|---|---|---|
| 1 | Ganchos no `EngineDSP` (depois do passo 1 do Diesel) | tabela 1.6 com os ramos vazios; `RadialDSP` que só põe as flags | `npm run paridade:ronco` idêntico (200 cenários) e `--dist`; `v16 rev` e `muscle wot` ±3% de tempo; `git diff --stat src/engines/ronco/dsp.ts` < 60 linhas |
| 2 | Geometria radial | `radial/geometria.ts` | Apêndice B reproduzido: intervalos 80 / 51,43 / 40 / 25,714° exatos (±1e-6) com as ordens reais, ordem sequencial do 18 inválida, ordem decorrente do R-4360 igual à de 1.4, ΔPMS da tabela 1.2 a ±0,05°, `balance` com `f1 = N/2` e `f2 = 0` (`N` ≥ 5) sem ΔPMS e `f2` 0,43 ± 0,02 com (9 cil., 3,6/1,2) |
| 3 | Escape radial e calibração | `buildExhaust` (anel, tubos, aranha, dual, single+turbo), `calibrate`/`measurePower` | `r1340 idle` (`ext` a 4 m): bandas da linha "perto do motor" de 4.1 a ±4 dB, centroide 1 000–1 600; `r1830 idle` (12 m): −7,5/−11/−12,5/−18 ± 4, centroide 300–400; `rotec2800 idle` 1 200 rpm: 3·f_ign a 0 ± 4 dB da fundamental; `r2800 idle`: 4,5ª ≥ 9ª − 3 dB; `r2800turbo idle`: 9ª ≥ 4,5ª; lenta → plena carga a 55%: +18 a +25 dB |
| 4 | Partida, encharque, parada | 3.4–3.5 | `start` do `r1830`: apito 290 → 390 Hz em 15–20 s (pico do espectrograma ±5%), engate, 9 pás contadas em 4–6 s, pega em 1–3 s; `CVciclo` ≥ 0,8 nos 3 s seguintes e ≤ 0,45 aos 20 s; ≥ 3 estouros nos primeiros 10 s com `prime` 2; `m14p start`: 7–11 "tchufs"/s por 2–3 s; `shutdown` do `r2800`: 1 000 → 0 rpm em 4–8 s |
| 5 | Magnetos, mistura, superalimentador, ar | 2.2, 3.6 | `magcheck` a 1 700 rpm: queda 60 ± 30 rpm por magneto, diferença ≤ 30; mistura 0,55: `exhT` +40 a +80 °C e potência −3 a −7%; uivo do R-2800 em `f = rpm·7,6·16/60` ±2% (pico), `scWhine` −18 dB → ≤ −25 dB do total no `ext`; `mech` radial 1,4× o do mesmo motor com `cooling 'water'` |
| 6 | Adaptador `Motor`, portador hélice (manete de passo, passo fixo, lenta, inércia) | `radial/motor.ts`, `ronco/motor.ts`, `carriers/helice.ts` | `tools/cena/portadores.ts` e `valida.ts` continuam passando (turboélices intocados); razões `f_ign/BPF` medidas no render: Yak 3,42, T-6 2,25, DC-3 4,15, P-47 4,5, Corsair 5,14 (±1%); `takeoff` a 50 m: Yak BPF ≥ ignição + 5 dB e harmônicos 1–3 dentro de 8 dB; T-6 harmônicos 5–9 da BPF dentro de 6 dB e ≥ ignição + 10 dB; `idle` a 12 m de lado: harmônicos 2–5 da BPF a −10 ± 5 dB da ignição; a 3 m da hélice ≥ −2 dB; `runup` do `r2800`: 650 → 2 800 rpm em 4–7 s com passo mínimo e governador segurando 1 225 ± 2% da hélice |
| 7 | Presets completos | os 17 com fichas; tabela de compatibilidade | `radial-lenta.ts`: 17 × 2 temperaturas, zero apagamentos (Megola excluída), rpm ±3%; potência ±5% da ficha (`measurePower` + escala); vagar da lenta 2–4% (P-47 ≤ 7); `CVciclo` 0,30–0,42 quente; os 13 aviões dentro de uma faixa de 12 dB na lenta a 12 m |
| 8 | Família aviação no Ronco | 10 presets, `aviation`, ganchos `av` no Ronco | paridade dos 68 intacta; `c172 idle` 650 ± 20 rpm a 20 °C e −5 °C; `r44` com o portador rotor: Nr 408 ± 2%, droop 2–3% em 1 s, recuperação ≤ 1,5 s; `c172 takeoff`: BPF 90 Hz, `M_t` 0,80, f_ign/BPF = 1,0 (4 cil., 2 pás: a ignição **coincide** com a BPF: o som "liso" do Cessna) |
| 9 | Terra: Sherman, Trossi, Megola | `CarroLegado` com as fichas; `rotativo` | `r975`: 0–30 km/h em 12–18 s em 2ª, 2 saídas com 5 e 4 cilindros (linhas 2,5ª e 2ª ordem presentes); `megola`: panorâmica dos estaques girando a `rpm/6` (modulação medida na correlação L/R a `rpm/360` Hz); `trossi` só se `tempos: 2` estiver na branch (senão "aproximação" no painel) |
| 10 | CPU | `radial-cpu.ts` | `r4360 runup` 10 s em Node ≤ 60% do tempo real (referência: Chiron V16 do Ronco ≈ 35%); no navegador `AudioWorkletNode` ≤ 50% do quantum (p99); se passar: `solverIt` 4 nos cilindros com razão de pressão > 3 e os 4 anéis aos pares (2 redes) |
| 11 | Página e navegador | `radial.html`, `src/pages/radial/`, controles do Ronco (7.2), `tools/radial-navegador.mjs` | paridade de controles (lista de 7); headless: energiza, engata, conta pás, liga magnetos, acelera, mexe no passo, mag check, corta mistura, troca preset/portador/ambiente, sem erros no console, worklet (não a reserva) |
| 12 | Documentação | `TECNICO.md` → seção Radial e Validação (só Commons na tabela pública), `PLANO.md` marcado, `CENA.md` 1.6 e 4.2 atualizados, relatório | relatório com todos os números acima |

### 8.1 Riscos e como limitar

| Risco | Medida |
|---|---|
| **Quebrar a paridade do Ronco** com um `if` mal posto, uma expressão reordenada ou dois autores no `dsp.ts` (Diesel e Radial) | Passo 1 só depois do Diesel ter os seus ganchos na branch; só `if (this.av) {…} else { linha original }` ou linhas novas atrás de `if`; nunca ternários novos no caminho gasolina; o portão de 1.6 em todo commit |
| **CPU com 28 cilindros** (R-4360: 28 cilindros × resolvedor implícito + 4 anéis = ~45 `Line`, 40 junções) e com 3 instâncias (Trimotor) | Passo 10; o R-4360 nasce com 2 redes (pares de fileiras) se a medida pedir; o Trimotor é opcional e só na Passagem (não na página) |
| **Hélice idêntica à Turbina** (pendência `CENA.md` 5.10): os campos novos em `helice.ts` não podem mudar o caminho dos turboélices; e a migração idêntica continua pendente para quem faz a Turbina | Campos com padrão = hoje (`nMin = nHelice`, `onLenta = 0`, `rpmAlvo` indefinido → `nAlvo = nHelice`); `tools/cena/portadores.ts` e `valida.ts` no portão do passo 6; a paridade amostra a amostra com o `jet-dsp` não é desta etapa |
| **Controle de lenta com `J` 30 kg·m² e 9 cilindros a 600 rpm** (`KP/KI` acertados para carros) | Passo 7 (lenta a 20 e −5 °C em todos); se apagar, sobe-se `idle` do preset, não os ganhos; registrar no relatório |
| **Rede com ciclo (anel)** instável ou com energia presa | `Line` com perda e `kNL` 0,6 como hoje; teste de impulso em `tools/acoustics-paridade.ts` estendido (impulso no anel, energia decai ≥ 20 dB em 0,5 s); `kNL` 0 nos segmentos do anel se oscilar |
| **Estouros de partida virando metralhadora** | `pr` 0,35 só com `misfire` e `runT < 20 s`, `pops.length < 10` como hoje; alvo de 3–8 estouros nos primeiros 10 s. (Aconteceu: o alvo não era conferido e saíam 25–35; ver 3.4, "Na implementação") |
| **2 tempos a centelha (Trossi)** depende do Diesel | Entra por último; se `tempos` não existir, 4T com aviso "aproximação" |
| **Gravações privadas** (YouTube) e trechos não auditados | Tabela pública só com Commons (Yak-52 ×2, Trimotor, Corsair Hahnweide, Sh-14); antes de usar um trecho, varrer com `scan.py`/`linhas.py` e descartar vento, fala e linhas externas (TLv tem uma linha fixa em 152 Hz; SBD tem a banda 6–12 kHz contaminada) |
| **Rotação errada por fator 2** na leitura (fileira × total; BPF × ignição) | As linhas foram identificadas por razões inteiras entre si (Apêndice A); onde não fechou (Sh-14, R-2800 em banco) está marcado "incerto" |
| **Fontes do adaptador sem calibração absoluta** (o Ronco é relativo) | `nivelEscape` por preset (3.7) e o teste 6 compara hélice × escape no mesmo render |

---

## Apêndice A. Medidas das gravações

Arquivos em `…/scratchpad/real2/radial/wav/` (índice em `…/real2/INDEX.md`); scripts em `…/scratchpad/radialtools/`. Bandas em dB rel. 150–400 Hz; `cent` = centroide (Hz); linhas em dB de pico sobre a mediana local (Welch 32768): `BPF`, `2BPF`, `fil` (ordem `N/2/fileiras`), `ign` (`N/2`), `2ign`; `vagar` em %; `per` = fração periódica 1–6 kHz. `i` = rpm motor / rpm hélice usado para as linhas da hélice.

### A.1 Lenta e aquecimento

| Trecho (arquivo, s) | rpm (f_ign Hz) | vagar | 60–150 | 400–1k | 1–2,5k | 2,5–6k | 6–12k | cent | BPF | 2BPF | fil | ign | 2ign | CVcic | CVlen | per | microfone |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Yak-52 M-14P pós-partida (Commons `Yakovlev_Yak_52…`, 0,5–9) | 983 (73,7) | 1,9 | +4,1 | −5,6 | −15,1 | −14,3 | −23,0 | 373 | 1,4 | 1,9 | — | 18,0 | 1,7 | 0,67* | 0,65* | 0,12 | poucos metros (*codec saturando) |
| Sh-14 pós-partida (Commons `Start_Sh_14`, 12–17,5) | ≈ 530 (39,7) se 9 cil. — **incerto** | 7,9 | −1,9 | +1,6 | −10,3 | −5,9 | −16,4 | 866 | — | — | — | 5,8 | 3,4 | — | — | 0,22 | perto |
| T-28 R-1820 pós-partida (`yt_n3p45rzT48Q`, 34–46) | 834 (62,6) | 4,6 | −10,8 | +2,2 | −2,2 | −5,3 | −10,1 | 1 024 | 1,1 | −0,3 | — | 4,3 | 0,3 | — | — | 0,15 | perto, sem grave; linha de 550–600 Hz = 9ª harmônica da ignição (ressonância) |
| T-28 R-1820 lenta (idem, 60–80) | 842 (63,2) | 1,7 | −12,5 | +0,8 | −5,2 | −8,2 | −13,0 | 828 | −0,6 | −1,8 | — | 5,0 | 7,9 | — | — | 0,14 | idem |
| SBD R-1820 aquecendo (`yt_An9tCRHUVqQ`, 22–34) | 1 042 (78,2) | 6,2 | +9,5 | −4,9 | −0,1 | +2,3 | (+14, vento) | (4 819) | 1,2 | −0,5 | — | 8,7 | 2,1 | 0,85 | 0,43 | 0,12 | perto; 2·BPF (55–61 Hz) visível |
| SBD R-1820 aquecendo (idem, 34–46) | 1 202 (90,1) | 6,2 | +8,4 | −11,3 | −4,7 | −0,4 | (+11) | — | −0,3 | 0,5 | — | 4,7 | 1,2 | 0,76 | 0,44 | 0,10 | idem |
| T-6G R-1340 lenta fria (`yt_OtNiL7DDcpQ`, 14–26) | 724 (54,3) | 5,0 | +12,4 | −0,8 | +3,3 | +1,0 | +3,4 | 1 299 | 0,0 | 10,2 | — | 10,8 | 2,9 | — | — | 0,16 | ~4 m, escape exposto |
| T-6G R-1340 lenta (idem, 28–34) | 916 (68,7) | 2,8 | +13,5 | −1,9 | +1,7 | −0,6 | +1,9 | 1 385 | 1,6 | 10,0 | — | 16,7 | 6,9 | 0,34 | 0,08 | 0,13 | idem |
| DC-3 R-1830 pós-partida (`yt_z6e1yj-UlXs`, 28–34) | 909 (106,1) | 4,7 | +4,1 | −7,9 | −9,9 | −11,5 | −17,7 | 340 | 0,0 | 3,4 | 5,9 | 8,8 | 5,5 | 0,34 | 0,06 | 0,08 | ~10 m |
| DC-3 R-1830 lenta (idem, 36–48) | 876 (102,2) | 2,9 | +4,9 | −7,1 | −10,8 | −12,4 | −17,7 | 333 | 0,3 | 0,9 | 1,6 | 9,3 | 6,2 | 0,30 | 0,06 | 0,09 | idem |
| DC-3 R-1830 lenta baixa (idem, 50–56) | 796 (92,9) | 2,6 | +5,7 | −8,1 | −12,1 | −13,2 | −18,6 | 362 | −0,5 | 0,0 | 0,0 | 13,7 | 8,8 | 0,33 | 0,11 | 0,10 | idem |
| DC-3 R-1830 perto da hélice (`yt_ibgyJTlP9A4`, 20–40) | 1 147 (133,8) | 3,8 | −4,8 | −4,6 | −12,2 | −20,4 | −28,7 | 370 | 5,4 | 12,9 | 12,9 | 10,4 | 6,1 | 0,32 | 0,11 | 0,07 | ~3 m; linhas 64,5 / 96,7 / 164 Hz = 2·, 3·, 5·BPF (BPF 32,3 Hz) |
| idem (68–92) | 1 139 (132,8) | 1,9 | −5,5 | −6,8 | −15,8 | −23,5 | −32,9 | 323 | 8,5 | 10,9 | 10,9 | 8,4 | 4,8 | 0,30 | 0,05 | 0,07 | idem |
| R-2800 em banco (`yt_7yFKFQz-gyQ`, 38–58), `i` 16/7 | ≈ 1 000 (150) — **incerto**: linhas 61,5 (3,5ª) e 79 Hz (4,5ª) dominam | 6,7 | +4,2 | −2,7 | −6,6 | −8,0 | −9,4 | 850 | 0,0 | 9,9 | 6,0 | 0,3 | 3,7 | 0,34 | 0,09 | 0,06 | banco de provas |
| P-47 R-2800 lenta (`yt_LCxp34VVcCE`, 22–36), `i` 2 | 773 (115,9) | 6,7 | +4,4 | −8,3 | −10,1 | −7,9 | −9,5 | 651 | 0,0 | 1,2 | 2,1 | 4,1 | 3,3 | 0,41 | 0,19 | 0,08 | ~5 m |
| P-47 lenta (idem, 50–60) | 804 (120,6) | 6,2 | +5,3 | −5,3 | −14,6 | −11,6 | −15,4 | 328 | 0,0 | 7,7 | −0,8 | 4,7 | 2,6 | 0,36 | 0,13 | 0,07 | idem |
| P-47 lenta baixa (idem, 62–72) | 592 (88,9) | 3,6 | +7,6 | −6,7 | −10,7 | −10,9 | −16,1 | 333 | 0,5 | 2,1 | 9,7 | 6,3 | 2,2 | 0,38 | 0,10 | 0,10 | idem |
| Corsair aquecendo (`yt_jKama73KyO8`, 10–18), `i` 16/7 | 1 125 (168,8) | 8,3 | −6,8 | −1,3 | −3,9 | −6,7 | −14,2 | 885 | 0,3 | 13,8 | 3,3 | 9,5 | 3,3 | 0,34 | 0,09 | 0,05 | ~8 m; linhas 67,4/105,5/134,8 Hz = 2·, 3·, 4·BPF (BPF 33,7) |
| Corsair táxi (idem, 40–56) | 824 (123,6) | 4,0 | −6,8 | −17,5 | −18,2 | −28,2 | −52,6 | 237 | −1,3 | 0,8 | 6,1 | 13,6 | 15,3 | 0,50 | 0,32 | 0,07 | longe (só grave) |
| Corsair lenta (`yt_TLvqGkKKlx8`, 68–82) | 685 (102,7) | 3,3 | −4,2 | −5,1 | −9,4 | −14,5 | −27,6 | 401 | 0,4 | −0,7 | −1,6 | 18,3 | 9,7 | 0,27 | 0,17 | 0,09 | ~8 m; **linha externa fixa em 152,3 Hz (+25 dB)** |
| Rotec R2800 lenta (`yt_pm3WpZ7DF78`, 12–24) | 1 198 (69,9) | 4,2 | +5,2 | −7,6 | −4,0 | −4,5 | −7,8 | 1 196 | 0,0 | 8,2 | — | 9,8 | 3,0 | — | — | 0,13 | 3–5 m; 3·f_ign (208–220 Hz) +9 a +16 |
| Rotec lenta (idem, 26–36) | 1 230 (71,7) | 2,8 | +2,0 | −8,4 | −4,2 | −7,5 | −10,7 | 970 | 0,3 | 10,1 | — | 14,5 | 2,9 | — | — | 0,13 | idem |
| Rotec Kitfox lenta (`yt_PL6O7PZg_5c`, 10–30) | 1 147 (66,9) | 3,1 | −1,7 | −6,3 | −4,5 | −6,3 | −11,1 | 1 053 | 0,0 | 7,3 | — | 6,4 | 2,4 | — | — | 0,14 | 3·f_ign (196–208 Hz) é a linha mais forte (+13 a +18) |
| Rotec Kitfox 1 450 (idem, 32–44) | 1 494 (87,2) | 5,1 | +2,2 | −6,4 | −4,1 | −6,0 | −10,5 | 1 079 | 2,5 | 3,4 | — | 17,5 | 1,9 | 0,45 | 0,35 | 0,10 | idem |
| Rotec 1ª partida (`yt_kaRBXu2-BRA`, 168–176) | 970 (56,6) | 3,5 | −7,1 | +3,1 | +4,4 | −1,7 | −10,4 | 1 310 | 0,0 | 4,6 | — | 15,8 | 3,6 | — | — | 0,18 | garagem (reverberante) |

### A.2 Decolagem e passagem

| Trecho | rpm (f_ign) | vagar | 60–150 | 400–1k | 1–2,5k | 2,5–6k | 6–12k | cent | BPF | 2BPF | fil | ign | 2ign | CVcic | CVlen | per | notas |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Yak-52 decolagem (`yt__OV77vl75ds`, 7–12) | 2 850 (215; a âncora 190 do pente era 3·BPF) | 1,3 | −2,2 | −12,9 | −10,6 | −10,2 | −15,6 | 579 | — | — | — | — | — | 0,48 | 0,20 | 0,05 | linhas: BPF 61,5 Hz +20…27, 2·BPF 123–126 +13…23, 3·BPF 187–193 +9…21, ignição 211–217 +17 |
| Yak-52 aproximando (idem, 50–54) | ≈ 2 490 (187) | 6,3 | −0,6 | −3,7 | −7,4 | −9,4 | −19,6 | 578 | 12,9 | 3,4 | — | 4,9 | 0,8 | 0,66 | 0,50 | 0,05 | Doppler |
| T-6 decolagem (`yt_LH9i7ySY_i8`, 12–20) | 2 200 (165; pente 148) | 3,6 | −10,7 | −1,0 | −0,1 | −4,8 | −20,3 | 1 093 | 4,7 | 8,9 | — | 9,6 | 16,9 | 0,40 | 0,16 | 0,02 | harmônicos 5–9 da BPF (366, 437–440, 510–516, 583, 656–662 Hz) a +24…27 dB, dentro de 3 dB entre si |
| T-6 afastando (idem, 24–34) | 1 823 (136,7) | 4,6 | −3,4 | −19,0 | −16,1 | −16,3 | −36,3 | 261 | 12,1 | 11,3 | — | 14,8 | 8,5 | 0,56 | 0,41 | 0,07 | Doppler para baixo |
| Trimotor 3 × R-985 passagem (Commons `EAA_Ford_TriMotor`, 0–8) | 1 850 (138,6) | 3,8 | −0,6 | −0,3 | +2,6 | +3,8 | (+4,1) | (2 710) | 7,7 | 0,6 | — | 5,7 | 2,3 | 0,56 | 0,39 | 0,06 | 3 motores batendo; agudo contaminado (vento) |
| Trimotor afastando (idem, 18–30) | 2 126 (159,5) | 5,2 | −6,2 | −2,6 | −14,6 | −20,3 | −21,6 | 400 | 0,4 | 2,1 | — | 6,9 | 1,2 | 0,61 | 0,36 | 0,05 | |
| P-47 passagem (`yt_JL35aF_LKIc`, 2–10), `i` 2 | 2 085 (312,8) | 6,5 | −4,3 | +0,6 | −3,2 | −16,8 | −37,0 | 608 | 3,4 | 4,2 | 0,0 | 2,5 | 2,3 | 0,37 | 0,21 | 0,02 | f_ign/BPF 4,49 |
| P-47 passagem (idem, 40–50) | 1 979 (296,9) | 6,0 | −4,7 | +3,7 | −0,7 | −7,6 | −20,2 | 820 | 1,3 | 1,7 | 1,4 | 3,2 | 2,9 | 0,49 | 0,35 | 0,03 | |
| Corsair decolagem (`yt_jKama73KyO8`, 60–65), `i` 16/7 | 2 273 (341) | 5,5 | −16,4 | −12,4 | −10,2 | −14,6 | −23,7 | 456 | 1,2 | 0,2 | **19,3** | 6,5 | 3,6 | 0,47 | 0,26 | 0,03 | fileira (4,5ª, 170 Hz) domina |
| Corsair passagem (idem, 82–88) | 2 634 (395) | 5,1 | −5,3 | +2,3 | −2,8 | −13,8 | −39,9 | 646 | 0,0 | 7,0 | 2,6 | 2,5 | 3,1 | 0,53 | 0,27 | 0,02 | |
| Corsair airshow (Commons `Chance_Vought_F4U…`, 4–10) | 2 366 (355) | 5,2 | −6,3 | +4,4 | +6,2 | +2,2 | −14,1 | 1 512 | 7,5 | 3,9 | 2,8 | 3,8 | 3,6 | 0,35 | 0,11 | 0,03 | passagem rápida, brilhante |
| Corsair airshow (idem, 38–46) | 2 395 (359) | 6,4 | −23,7 | −2,0 | −5,5 | −8,3 | −13,6 | 918 | 1,0 | 4,0 | 4,3 | 4,4 | 4,1 | 0,58 | 0,21 | 0,03 | |
| Corsair passagem longe (`yt_TLvqGkKKlx8`, 124–136) | 2 317 (347) | 5,3 | −2,1 | −1,3 | −1,0 | +4,3 | −1,0 | (2 655) | — | — | — | — | — | 0,41 | 0,40 | 0,03 | vento no microfone: só a rotação serve |

### A.3 Partida (primeiros 3 s depois de pegar) e pré-partida

| Trecho | rpm (f_ign) | vagar | 60–150 | 400–1k | 1–2,5k | 2,5–6k | 6–12k | cent | ign | CVcic | CVlen | notas |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| T-28 pega (`n3p`, 31–34) | 796 (59,7) | 7,9 | −10,6 | +5,9 | +3,3 | +0,5 | −3,8 | 1 463 | 2,5 | — | — | +5 dB em 1–6 kHz em relação à lenta dele |
| SBD pega (`An9`, 10–13) | 956 (71,7) | 8,1 | +3,9 | −3,0 | −2,3 | −2,9 | (+6) | — | 6,8 | **1,11** | 0,88 | |
| DC-3 pega (`z6e`, 25–28) | 884 (103) | 6,1 | +2,1 | −3,7 | −5,5 | −8,1 | −11,6 | 671 | −0,7 | **0,80** | 0,69 | centroide 2× o da lenta |
| R-2800 banco pega (`7yF`, 16–19) | ≈ 970 (146) | 6,9 | +2,9 | +0,6 | −2,7 | −2,0 | −6,2 | 1 384 | 0,9 | **1,06** | 0,86 | |
| P-47 pega (`LCx`, 18–21) | 694 (104) | 0,5 | +3,6 | −6,6 | −7,9 | −6,9 | −9,0 | 823 | 4,3 | 0,62 | 0,51 | |
| Corsair pega (`jKa`, 8–11) | 1 077 (161) | 5,1 | −6,6 | −0,7 | −4,0 | −7,0 | −15,2 | 845 | 2,7 | 0,37 | 0,15 | partida limpa (motor quente) |
| Rotec pega (`pm3`, 0–3) | 1 200 (70) | 0,7 | +3,2 | −3,4 | −1,4 | −2,6 | −5,2 | 1 411 | 11,3 | — | — | |
| DC-3 motor de inércia energizando (`z6e`, 4–22) | apito 287 → 387 Hz em 18 s (+30…40 dB sobre a mediana) | — | −26,0 | −6,2 | −10,6 | −20,0 | −23,6 | 583 | — | — | — | quase sem grave; engate aos 24 s, pega aos 26 |
| SBD pré-partida (`An9`, 2–9) | apito ≈ 390–400 Hz (+9…20 dB) | — | −14,9 | +2,8 | −10,7 | −17,0 | −17,2 | 581 | — | — | — | motor de inércia |
| T-6G girando (`OtN`, 8–12) | — | — | +10,8 | +1,4 | +6,4 | +3,2 | +5,6 | 1 826 | — | — | — | arranque elétrico + pás |
| P-47 pré-partida (`LCx`, 0–16) | linha fixa 64–70 Hz (+15 dB), 60–150 a +15,6 | — | +15,6 | −7,7 | −13,2 | −17,4 | −27,6 | 161 | — | — | — | **fonte externa** (grupo de solo); não usar |

### A.4 Parada

| Trecho | rpm (f_ign) | 60–150 | 400–1k | 1–2,5k | 2,5–6k | 6–12k | cent | ign | CVcic | CVlen |
|---|---|---|---|---|---|---|---|---|---|---|
| Corsair parada (`yt_TLvqGkKKlx8`, 188–196) | 982 → 0 (147 caindo) | +2,3 | −5,3 | −10,3 | −10,1 | −19,6 | 485 | 6,3 | 0,44 | 0,26 |

## Apêndice B. Tabelas de geometria conferidas

Calculadas com `…/scratchpad/radialtools/geom.py` e `geom3.py` (a portar para `tools/radial-geometria.ts` e usar como teste do passo 2).

**B.1 ΔPMS (°) e curso relativo com `δ_k = φ_k`, `L/r` 3,6, `r_k/r` 1,2** (os valores com `L/r` 3,8 e `r_k/r` 1,0, padrão dos presets, estão em 1.2 para 9 cilindros):

| N | por cilindro (φ crescente) |
|---|---|
| 3 | 0; +6,78 (1,0192); −6,78 (1,0192) |
| 5 | 0; +4,12 (1,0040); +4,96 (1,0173); −4,96; −4,12 |
| 7 | 0; +1,83 (1,0008); +6,79 (1,0145); +3,71 (1,0126); −3,71; −6,79; −1,83 |
| 9 | 0; +0,91 (1,0002); +5,04 (1,0063); +6,78 (1,0192); +2,95 (1,0093); −2,95; −6,78; −5,04; −0,91 |

Zerar o ΔPMS pediria `δ_k − φ_k` de +5,5 a +14° e cursos até 1,149 (9 cil.): não é o que os motores fazem; fica o ΔPMS.

**B.2 Escalonamento** (`schedule()` do Ronco, `geometria.ts:96–110`):

| Caso | `fire[]` (° de ciclo, por cilindro) | intervalos |
|---|---|---|
| 9, `1-3-5-7-9-2-4-6-8` | 0, 400, 80, 480, 160, 560, 240, 640, 320 | 80 |
| 14, P&W | 0, 565,7, 411,4, 257,1, 102,9, 668,6, 514,3, 360, 205,7, 51,4, 617,1, 462,9, 308,6, 154,3 | 51,43; por fileira 102,86; dianteira começa em 51,43 |
| 18, P&W | 0, 200, 400, 600, 80, 280, 480, 680, 160, 360, 560, 40, 240, 440, 640, 120, 320, 520 | 40; por fileira 80; dianteira começa em 40 |
| 18, `1-2-…-18` | — | **inválida** |
| 28, ordem decorrente de 1.4 | 0, 411,43, 102,86, 514,29, 205,71, 617,14, 308,57, 282,86, 694,29, 385,71, 77,14, 488,57, 180, 591,43, 565,71, 257,14, 668,57, 360, 51,43, 462,86, 154,29, 128,57, 540, 231,43, 642,86, 334,29, 25,71, 437,14 | 25,714; por fileira 102,86; fileiras nos disparos `0-3-2-1-…` |

**B.3 Balanço** (`balance()`, `λ` 0,3): `|F1| = N/2` (1,5; 2,5; 3,5; 4,5) e `|F2| = 0` para 5, 7, 9 (3 cilindros: 1,5), geometria ideal; 9 cilindros com os ΔPMS de B.1: `|F1|` 4,583, `|F2|` 0,433.
