# Diesel: projeto da etapa 2

Documento de projeto da etapa 2 (ver `PLANO.md`). Define como o motor diesel estende o `EngineDSP` do Ronco sem mudar o som a gasolina, o modelo de ignição por compressão, o governador, o ciclo de 2 tempos das locomotivas, o turbo, os presets com ficha técnica, a página `diesel.html` e o plano de implementação com medidas. A implementação segue este texto à letra; o que estiver marcado **decisão** não se renegocia dentro da etapa sem anotar no relatório. Unidades: SI (pascal, kelvin, kg, N·m, rad/s); pressões em **bar absolutos** quando ditas em bar; ângulos em graus de virabrequim (°) contados como no `dsp.ts` (0° = PMS de ignição do cilindro, ciclo de 720° no 4 tempos, 360° no 2 tempos). As linhas citadas (`dsp.ts:NNN`) são as do `src/engines/ronco/dsp.ts` no commit `b9b46c6`.

- [0. Decisões](#0-decisões)
- [1. Como estender o `EngineDSP` sem mudar o som a gasolina](#1-como-estender-o-enginedsp-sem-mudar-o-som-a-gasolina)
- [2. Ignição por compressão](#2-ignição-por-compressão)
- [3. Governador, sobrevelocidade, fumaça e freio-motor](#3-governador-sobrevelocidade-fumaça-e-freio-motor)
- [4. Ciclo de 2 tempos (EMD 567/645/710, Detroit)](#4-ciclo-de-2-tempos-emd-567645710-detroit)
- [5. Turbo diesel](#5-turbo-diesel)
- [6. Presets](#6-presets)
- [7. Interface da página `diesel.html`](#7-interface-da-página-dieselhtml)
- [8. Plano de implementação e verificação](#8-plano-de-implementação-e-verificação)
- [Apêndice A. Medidas das gravações](#apêndice-a-medidas-das-gravações)

---

## 0. Decisões

1. **Subclasse, não cópia.** `DieselDSP extends EngineDSP` em `src/engines/diesel/dsp.ts`. O `EngineDSP` ganha uma flag `this.cc = false` (ignição por compressão) e `this.tempos = 4`, uma mudança de um número (teto da taxa de compressão) e ramos `if (this.cc)` nos pontos listados em 1.2. Com `cc = false` nenhuma operação aritmética muda: a paridade dos 68 presets (`npm run paridade:ronco`, 200 cenários) é o portão de cada commit que toca `dsp.ts`.
2. **Carga por combustível.** Não há borboleta: a área de admissão fica aberta, o coletor segue a pressão do turbo, e a carga é a massa de combustível por ciclo, limitada pelo ar disponível (limite de fumaça por λ). O controle de marcha lenta por válvula de ar e avanço do Ronco é substituído pelo governador (seção 3).
3. **Atraso de ignição por Hardenberg–Hase**, calculado com a pressão e a temperatura que o cilindro do modelo tem no início da injeção, com número de cetano do preset e um fator de calibração único (`kAtraso` = 1,6) acertado nas janelas-alvo de 2.3.
4. **Wiebe dupla**: fração pré-misturada igual à fração do combustível injetada durante o atraso (limitada), queima rápida de 6–10°; o resto em difusão de 40–70°. O "knock" diesel é a excitação estrutural pela taxa de subida de pressão `dp/dθ` medida no próprio cilindro, não um ruído sorteado.
5. **Ruído de injeção por tipo** (`common-rail`, `rotativa`, `em-linha`, `unitaria`, `heui`, `pld`): tiques por evento, nível e espectro de 2.7.
6. **Governador no motor para o portador carro; no portador para gerador e locomotiva** (como `CENA.md` 1.1 e 1.6): `ComandoMotor.combustivel` definido manda direto no combustível; indefinido, o motor usa o governador do preset (`min-max`, `todas-as-rotacoes` ou `isocrono`). Nunca há corte de giro por ignição: o limite de rotação é o próprio governador (rampa de 120 rpm).
7. **2 tempos** = ciclo de 360° no mesmo cilindro: janelas de admissão como "válvula de admissão" de perfil quadrado, válvulas de escape no cabeçote, caixa de ar = coletor do modelo. Virabrequim próprio do EMD V16 (pares de moentes a 22,5°) em `src/engines/diesel/geometria.ts`; o soprador Roots reusa o caminho `blower` do Ronco; o turbo engrenado do EMD é `turboW = max(engrenagem, livre)`.
8. **Escape diesel montado pelo próprio `buildExhaust` da subclasse**: turbina (`TwoPort 'turbo'` existente), DPF/abafador diesel como `DoisPortasDiesel extends TwoPort` em `src/engines/diesel/escape.ts` (sem tocar em `src/acoustics/`), chaminé de caminhão e de locomotiva, comprimentos escalados pela velocidade do som do gás frio (`520/c`).
9. **Freio-motor**: `descarga` (contrapressão `pBack` no escoamento da válvula de escape) e `jake` (janela extra da válvula de escape perto do PMS, 2/4/6 cilindros). Nenhum deles existe no caminho a gasolina.
10. **Fontes para a Cena**: as do Ronco (`escape.k`, `admissao`, `bloco`, `compressor`), com `bloco` carregando knock, injeção e trem de válvulas. O apito do turbo é do motor (fonte `compressor`): com motor diesel acoplado, o portador locomotiva não gera a fonte `turbo` de `CENA.md` 4.5.
11. **Escala de nível**: calibração como no Ronco (`calibrate()` sobrescrito, plena carga a 55% da rotação máxima com 40% da pressão do turbo, lenta 21 dB abaixo) para o portador carro; gerador e locomotiva recebem níveis de potência sonora absolutos (6.3).
12. **Validação por gravações**: tabelas de bandas em dB relativas a 150–400 Hz (Apêndice A), com três posições de microfone (cofre, exterior, escape) e as tabelas por notch do EMD 710 e do GE 7FDL. O que foi medido em vídeo privado serve de alvo interno; para a tabela pública de `TECNICO.md` → Validação valem só as gravações do Wikimedia Commons.

---

## 1. Como estender o `EngineDSP` sem mudar o som a gasolina

### 1.1 Forma

```
src/engines/diesel/
  dsp.ts         DieselDSP extends EngineDSP: sobrescreve tune (super + campos), buildExhaust, buildFilters,
                 calibrate, measurePower, telemetry (super + campos) e implementa os ramos `cc` chamados pelo laço
  geometria.ts   reusa build()/tdcAngles()/schedule()/intervals() do Ronco; acrescenta virabrequins 2T e o montador
                 uniflow (fire = PMS mod 360; ordem de ignição decorre dos moentes)
  escape.ts      DoisPortasDiesel extends TwoPort ('dpf', 'abafador-caminhao', 'chamine'); nada em src/acoustics/
  presets.ts     PresetDiesel = PresetRonco & campos de 6.1; 16 presets + 1 extra
  config.ts      montarConfig/configCalibrada como no Ronco, chamando DieselDSP
  constantes.ts  LHV, cetano padrão, tabelas de injeção, turbos
  motor.ts       adaptador `Motor` (CENA.md 1.3) sobre DieselDSP, igual ao do Ronco mais `combustivel`
src/worklet/processador-diesel.ts   registrarProcessador('diesel-engine', (fs) => new DieselDSP(fs))
src/pages/diesel/  + diesel.html    (seção 7)
tools/diesel-*.ts                  render, lenta, governador, bandas (seção 8)
```

Três mecanismos de extensão, em ordem de preferência:

1. **Métodos sobrescritos** (sem tocar o corpo do método base): `buildExhaust`, `buildFilters`, `calibrate`, `measurePower` são substituídos inteiros; `tune` e `telemetry` chamam `super` e acrescentam. `setConfig` chama `this.tune`, `this.buildExhaust`, `this.buildFilters`, `this.calibrate` por despacho virtual, então a subclasse os troca sem editar `setConfig`.
2. **Ramos `if (this.cc)`** no laço de amostra e no `control()`, nos pontos de 1.2. No ramo falso o código antigo roda idêntico, operação por operação. Nunca se escreve `x = this.cc ? a : b` onde `b` seja uma expressão nova: o lado gasolina é a linha original, textualmente.
3. **Um número**: o teto do `clamp` da taxa de compressão (`dsp.ts:181`), `clamp(..., 6, 15)` → `clamp(..., 6, this.cc ? 24 : 15)`. Para gasolina o resultado é o mesmo double.

**Decisão: nada mais muda na classe base.** Em particular não se refatora o laço em métodos por cilindro (custo em CPU e risco de reordenar ponto flutuante), não se mexe em `src/acoustics/` e os parâmetros novos ficam todos na subclasse ou atrás de `this.cc`.

### 1.2 Pontos do ciclo que mudam

| # | Onde (`dsp.ts`) | Gasolina (fica) | Diesel (`cc`) |
|---|---|---|---|
| 1 | construtor (72–106) | — | `this.cc = false; this.tempos = 4;` (neutro). A subclasse põe `cc = true`, `tempos` do preset |
| 2 | `setConfig` 181 | `clamp(CR, 6, 15)` | teto 24; `Vc = Vd/(CR−1)` segue a mesma linha |
| 3 | `tune` 289–298 | `AexMax`, `AinMax`, `Athr`, `evo/evc/ivo/ivc` do `cam` | após `super.tune`: `Athr` = área de um duto aberto (8× o valor base: o coletor acompanha o turbo com queda < 1%); eventos de válvula da tabela 2.1 (4T) ou 4.1 (2T); `Tmax` = `cfg.torque`; `J` = `cfg.J` se houver; `limType = 'governor'` (cai no `else` dos limitadores e não dispara o `float` de `'none'`) |
| 4 | `process` 819–825 (DFCO, `cut`) | corte de injeção na desaceleração com histerese | `dfco = false`, `cut = false`: quem tira o combustível é o governador (`fuelCmd → 0`) |
| 5 | 826–834 (`adv`, `aSp`, `slowB`, `burn`) | avanço da centelha, queima lenta no vácuo | `aSOI = cyc − advInj(rpm, carga)`, duração da injeção `θ_inj`, parâmetros da Wiebe dupla (2.4); sem `slowB` (não há vácuo) |
| 6 | 841–843 (borboleta) | `thrA = Athr(1 − cos(thr·π/2) + iac + …)` | `thrA = Athr` (fixa) |
| 7 | 857–925 (centelha, Q, falhas, estouros) | arma a faísca, `Q = ar·2,6 MJ`, sorteio de falhas, `pops` | arma a **injeção** em `a ∈ [cyc/2, 3cyc/4)`, dispara em `aSOI`: calcula `τ_id` (2.3) → `spk[c] = aSOI + θ_id`; `Q = m_f·LHV·η(λ)` (2.2); `φ_p`, `Δθ_p`, `Δθ_d` (2.4); frio: queima parcial (2.8); **nenhum estouro** (`pops` nunca recebe nada) |
| 8 | 927 (cliques de válvula) | `clickEnv += …` nos 4 eventos | igual, ×1,5 (válvulas maiores), mais os eventos de **injeção** (2.7) |
| 9 | 928 (`air[c] = 0` em `ivo`) | zera o ar na abertura da admissão | 4T igual; 2T: zera em IPO e guarda `arPreso[c] = m[c]` em IPC (4.1) |
| 10 | 944–951 (Wiebe) | `x = 1 − exp(−5u³)` | Wiebe dupla; mede `dpdθ[c]` (2.5) e alimenta `knockSrc` (2.6) |
| 11 | 957–961 (válvula de escape) | janela `evo..evc` | 4T igual; **Jake**: segunda janela 350–390° com 0,35·`AexMax` quando ativo (3.4); `exhaustFlow(..., P0 + pBack + 2·run.in0, Zr)` com `pBack` do freio de descarga |
| 12 | 982 (`densC`) | `T/T_EXREF` | igual (a referência de 1650 K fica; o gás diesel entra mais fraco por ser mais frio, e a calibração repõe) |
| 13 | 991–999 (válvula de admissão) | perfil `min(1, 1,5·sen²)` | 4T igual; 2T: janelas com perfil `min(1, 2,5·sen²)` entre IPO e IPC (4.1) |
| 14 | 1024 (`fmep`) | `0,95e5 + …` | ×1,6 (motor diesel tem FMEP de 1,5–2,5 bar em lenta) |
| 15 | 1027 (motor de partida) | `Tst` até 330 rpm | `Tst` até `0,45·idle` (locomotiva parte a ~100 rpm; MAN B&W a ar: 15 rpm) |
| 16 | `control` 582 (`tBurn`) | parede do escape a gasolina | `tBurn = 120 + 480·fuel^0,8·(0,6 + 0,4·rpm/rpmMax)` °C (lenta ≈ 150, plena ≈ 600) |
| 17 | 616–642 (controle de lenta por ar e avanço) | PI na válvula de ar | pulado; o governador (3.1) calcula `fuelCmd` |
| 18 | 621 (`coldAdd`) | lenta fria até `min(0,8·idle, 650)` | eletrônico: `min(0,35·idle, 300)`; mecânico: 0 (2.8) |
| 19 | 691–707 (turbo, válvula de alívio) | `turboW` 0,55/1,2 s, BOV | τ do preset; `turboW = max(livre, engrenado)`; **sem BOV**; VGT (5) |
| 20 | 710–729 (limitador) | histerese, parcial, borboleta | nada: `limiter = false` sempre |
| 21 | 745–750 (partida/apagamento) | `rpm > min(0,7·idle, 550)` liga; `rpm < 150` apaga | liga em `rpm > 0,7·idle`; apaga em `rpm < 0,4·idle` (locomotiva em lenta baixa a 200 rpm não pode apagar; MAN B&W a 30 rpm idem) |
| 22 | 1114–1144 (mecânica) | `knockEnv·rng` com `(0,3 + 0,7·pMan/P0)` | `knockSrc` por `dp/dθ` → banco estrutural (2.6); tiques de injeção (2.7); bomba; sem bomba de ar secundário |
| 23 | 1157–1170 (turbo: apito, chiado, BOV) | `f = 500 + 6200·tw` | `f = z·N_turbo/60` (5), nível por pressão, sem BOV; soprador Roots reusa 1172–1205 |
| 24 | `telemetry()` | — | `super.telemetry()` + `pMax`, `dpdθMax`, `tauId`, `lambda`, `fumaca`, `fuel`, `pBack`, `jake`, `notch`, `kW` |

Fora do laço: `calibrate()` e `measurePower()` da subclasse instanciam `DieselDSP`, fixam `fuelCmd = 1` com o limite de fumaça (em vez de `thr = 1`), `turboW = 0,6`, `boost = 0,4·maxBoost`, rotação travada em 55% de `rpmMax`; na sonda de lenta ajustam `fuelCmd` até `tqMean = 0` (o análogo do `iacI` em `dsp.ts:357`).

### 1.3 Portão de paridade

Antes de qualquer código diesel: (a) aplicar só os itens 1, 2 e os `if (this.cc)` vazios; (b) `npm run paridade:ronco` completo (200 cenários, WAV e JSON idênticos) e `--dist` depois de `npm run build`; (c) tempo de renderização de `v16 rev` e `muscle wot` antes e depois, ±3% (os ramos falsos custam uma comparação por amostra). Esse portão se repete em todo commit que toque `src/engines/ronco/dsp.ts`, e o relatório da etapa registra o `git diff --stat` desse arquivo: deve ser pequeno (dezenas de linhas) e só com os pontos da tabela.

---

## 2. Ignição por compressão

### 2.1 Compressão, ar e bombeamento

Taxa de compressão `CR` do preset (campo `cr`): 15,5–17,5 nos modernos de injeção direta, 17–18,5 nos de injeção direta antigos, 19,5–22 nos de pré-câmara (IDI), 16 no EMD 710 (14,5 no 645), 12,7 no GE 7FDL. Compressão politrópica (o modelo integra; estes são os valores que ele tem de reproduzir, `n` ≈ 1,35 com a perda de calor da linha `dsp.ts:837` sem o fator de vácuo):

| CR | `p_PMS` com coletor a 1,0 bar | com 2,0 bar | com 2,5 bar | `T_PMS` (ar a 310 K) |
|---|---|---|---|---|
| 16,0 | 42 bar | 84 | 105 | 820 K |
| 17,5 | 48 | 95 | 119 | 845 K |
| 21,0 | 61 | 122 | 152 | 900 K |
| 12,7 (GE) | 31 | 62 | 78 | 760 K |

Eventos de válvula do 4 tempos (graus após o PMS de ignição, como `evo/evc/ivo/ivc`), com pouco cruzamento: `evo = 125 + 10·cam`, `evc = 372 + 8·cam`, `ivo = 350 − 8·cam`, `ivc = 575 + 15·cam`; `cam` 0–0,3 nos presets (o diesel não respira pelo cruzamento). Eficiência volumétrica resultante 0,88–0,93; o modelo mede.

**Ar por ciclo** (para λ): `m_ar = p_col·Vd·η_v/(R·T_col)`. Hilux 1GD (0,69 L/cil): lenta 0,70 g; plena carga a 2,4 bar e 330 K: 1,57 g. Sem borboleta o laço de bombeamento é pequeno: a pressão média de bombeamento em lenta fica em 0,1–0,2 bar (gasolina em lenta: 0,6–0,7 bar). É por isso que o diesel em lenta gasta ~1/3 do combustível de um gasolina do mesmo tamanho e tem o escape frio.

### 2.2 Injeção: quantidade, duração, λ e limite de fumaça

- **Poder calorífico** `LHV` = 42,5 MJ/kg; relação estequiométrica 14,5. `Q[c] = m_f·LHV·η_c(λ)`, `η_c = 0,98·min(1, λ)^1,5` (combustível além do estequiométrico não queima: vira fumaça preta, não calor).
- **Combustível máximo por ciclo** da ficha: `mfMax = P_nom·bsfc/(3600·N·rpm_nom/(60·tempos/2))`, `bsfc` 0,22 kg/kWh (leve), 0,195 (pesado), 0,215 (locomotiva), 0,17 (MAN B&W). Hilux 2.8: 81 mg; Cummins 6.7: 115 mg; Scania DC16: 157 mg; EMD 710: 830 mg; GE 7FDL: 955 mg; MAN 6S50MC: 35 g.
- **Comando**: `m_f = fuelCmd·mfMax·mapa(rpm)`, `mapa` = 1 abaixo de `rpm_nom`, caindo linearmente a 0,7 em `rpmMax` (bomba/injetor não acompanha). `fuelCmd` ∈ [0, 1] vem do governador (3.1) ou de `ComandoMotor.combustivel`.
- **Limite de fumaça** (`limiteFumaca` = λ mínimo): eletrônico 1,25 (a central corta o excesso: `m_f ≤ m_ar/(14,5·λ_min)`); bomba mecânica com aneroide (compensador de pressão do turbo) 1,10; bomba mecânica sem aneroide (aspirados e GE 7FDL) **1,0** (nada corta; o excesso vira fumaça, 3.3). `λ = m_ar/(14,5·m_f)`; `fumaca = clamp((1,3 − λ)/0,3, 0, 1)` vai à telemetria.
- **Duração da injeção** `θ_inj = (m_f/q_inj)·0,006·rpm` graus, com a vazão do injetor `q_inj` (mg/ms): common-rail `q_inj = q_max·√(p_rail/p_max)`, `p_rail = p_min + (p_max − p_min)·fuelCmd^0,5` (1GD: 30–220 MPa, `q_max` 40 mg/ms → lenta 3°, plena carga 36° a 3000 rpm); bombas mecânicas (em linha, rotativa, unitária): `q_inj = q_0·rpm/rpm_nom` (o êmbolo anda com o came: lenta lenta e longa, 6–8°). Pré-câmara (IDI): `q_inj` ×0,6 e `Δθ_p` ×1,6 (a chama passa pelo canal).
- **Início da injeção** `advInj` (graus antes do PMS): common-rail com piloto: 2 + 8·(rpm/rpmMax) + 4·fuel (a central atrasa em lenta por ruído); mecânica: 12 + 6·(rpm/rpmMax) (fixo do came, mais o avanço centrífugo); IDI: 10 + 4·(rpm/rpmMax); 2T EMD: 10; GE: 14; MAN B&W: 4. **Piloto** (`piloto: true`): 8% de `m_f` (mínimo 1,5 mg) injetados 12° antes do principal, com Wiebe própria curta (5°); ele aquece a câmara e o principal usa `kAtraso` ×0,6 e `φ_p` ×0,45.

### 2.3 Atraso de ignição (Hardenberg–Hase)

Com `p` (bar) e `T` (K) **no instante da injeção**, lidos do cilindro do modelo (`pc_[c]`, `T` da linha `dsp.ts:940`), velocidade média do pistão `S_p = 2·curso·rpm/60` (m/s) e número de cetano `CN` (campo `cetano`, padrão 48; S10 brasileiro ≥ 48, europeu ≥ 51):

$$\tau_{id}\,[^\circ] = k_{atraso}\,(0{,}36 + 0{,}22\,S_p)\,\exp\!\left[E_A\left(\frac{1}{\tilde R\,T} - \frac{1}{17190}\right)\left(\frac{21{,}2}{p - 12{,}4}\right)^{0{,}63}\right], \qquad E_A = \frac{618\,840}{CN + 25}\ \text{J/mol}, \quad \tilde R = 8{,}3143$$

O resultado é em graus de virabrequim; em tempo, `τ_id[ms] = τ_id[°]/(0,006·rpm)`. `p` é limitado por baixo a 15 bar (a correlação diverge em 12,4). A correlação foi ajustada em carga e subestima a lenta; `kAtraso` = 1,6 é o fator único que a põe nas janelas abaixo, e **não é por preset**. Números com CN 48 (`E_A` = 8477 J/mol):

| Condição (Hilux 2.8, curso 103,6 mm) | `S_p` | `p`, `T` na injeção | `τ_id` da correlação | com `kAtraso` 1,6 | janela-alvo |
|---|---|---|---|---|---|
| lenta quente, 800 rpm | 2,8 m/s | 44 bar, 880 K | 1,6° = 0,33 ms | **0,53 ms** (2,5°) | 0,5–0,8 ms |
| lenta fria (água a −10 °C), 800 rpm | 2,8 | 35 bar, 700 K | 2,4° = 0,50 ms | **0,80 ms** (3,8°) | 0,8–1,2 ms (sem velas) |
| partida a −10 °C, 150 rpm | 0,5 | 25 bar, 600 K | 2,5° = 2,8 ms | **4,5 ms** | 3–5 ms (limiar de falha: 4 ms) |
| plena carga, 3000 rpm, 2,4 bar no coletor | 10,4 | 77 bar, 950 K | 3,4° = 0,19 ms | **0,30 ms** (5,5°) | 0,3–0,4 ms |

O frio entra sozinho: a perda de calor para a parede (`dsp.ts:952`, `T_WALL` + a água fria) baixa `T` na injeção, e `τ_id` sobe. **Decisão:** `T_WALL` no diesel segue a água, `T_parede = 430 + 0,9·(água − 90)` K, para a lenta fria ter o atraso certo (no Ronco a parede é fixa em 430 K; isso fica).

### 2.4 Queima: Wiebe dupla

Fração queimada `x(θ)`, com `u = (θ − θ_ign)/Δθ`:

$$x = \varphi_p\left[1 - e^{-6{,}9\,u_p^{\,3}}\right] + (1-\varphi_p)\left[1 - e^{-6{,}9\,u_d^{\,1{,}9}}\right]$$

- **Fração pré-misturada** `φ_p = clamp(θ_id/θ_inj, 0,08, 0,90)·k_pre`, `k_pre` = 1,0 (injeção direta sem piloto), 0,45 (com piloto), 0,6 (pré-câmara). É o combustível que já estava na câmara quando acendeu. Lenta de common-rail sem piloto: `θ_id` 2,5°, `θ_inj` 3° → `φ_p` 0,83 (quase tudo pré-misturado: o "knock" alto da lenta); com piloto 0,37; plena carga 5,5°/36° → 0,15 (queima mansa, de difusão).
- **Duração pré-misturada** `Δθ_p = 5° + 3°·(θ_id/3°)` (6–10°); **difusiva** `Δθ_d = 40° + 25°·fuel + 0,006·rpm` (lenta 45°, plena a 3000 rpm 83°, limitada a 90°); 2T EMD a 904 rpm: 40 + 25 + 5 = 70°.
- O gasolina mantém `x = 1 − exp(−5u³)`, `burn = (42 + 26·rf)·slowB` (`dsp.ts:833–834, 948`), textualmente.

### 2.5 Pressões, taxa de subida e temperaturas

Alvos que o modelo tem de dar com os parâmetros acima (medidos na telemetria `pMax`, `dpdθMax` por ciclo, média de 2 s):

| Condição | `p_max` | ângulo do pico | `dp/dθ` máx | `T` na abertura do escape | gás no coletor de escape |
|---|---|---|---|---|---|
| picape, lenta quente 800 rpm | 45–60 bar | 3–8° | 3–6 bar/° | 600–750 K | 150–250 °C |
| picape, lenta fria (−10 °C) | 40–55 | 8–15° | 5–9 | 550–700 | 100–180 °C |
| picape, plena carga 3000 rpm, 2,4 bar | 140–180 | 10–14° | 5–8 | 1100–1300 | 550–700 °C antes da turbina |
| caminhão pesado, lenta 600 rpm | 50–65 | 3–8 | 3–5 | 600–700 | 150–200 |
| caminhão, plena 1900 rpm, 2,7 bar | 160–200 | 10–14 | 6–9 | 1150–1300 | 550–650 |
| EMD 710 lenta 269 rpm (2T) | 40–55 | 5–10 | 2–4 | 650–750 | 180–250 |
| EMD 710 notch 8, 2,4 bar | 115–135 | 10–14 | 4–7 | 1050–1200 | 480–560 |
| GE 7FDL lenta 440 / N8 1050 | 35–50 / 125–145 | — | 2–4 / 4–7 | — | 200 / 480–560 |
| Jake brake, 1900 rpm (sem combustível) | 35–50 no PMS | 0 | — | 750–850 (ar comprimido) | 150–250 |

Gasolina (Ronco, para contraste): lenta 15–25 bar, plena 60–90 bar, escape 950–1650 K. O diesel é 2–3× mais pressurizado e 300–500 K mais frio no escape, o que é a razão física do som: muito mais energia estrutural (knock, 1–4 kHz) e muito menos energia no pulso do escape, principalmente em lenta (pressão na abertura do escape 1,3–1,8 bar contra 2,3 no gasolina frio).

**Velocidade do som no escape**: `c = 20,05·√T`: 450 K → 425 m/s, 550 K → 470, 800 K → 567. A `Line` usa 520 m/s fixo; **decisão:** o `buildExhaust` do diesel multiplica cada comprimento por `520/c_preset`, com `c_preset` = 470 (picapes, carros), 500 (caminhões, ônibus, gerador), 560 (locomotivas, chaminé curta e quente). Fica como limitação conhecida, igual à do Ronco, que a temperatura não varia no tempo.

### 2.6 O "knock" diesel como fonte estrutural

**Excitação.** Em cada amostra de combustão (`xb[c] < 1`), `dpdθ = max(0, p − p_prev)/deg` (bar/°); `knockSrc += dpdθ·cylK[c]` com `cylK` o sorteio fixo por cilindro (±5%, o mesmo `sr` de `dsp.ts:202`). O máximo por ciclo vai à telemetria. A excitação é portanto **determinística e colada ao ciclo** (não um ruído sorteado como o `knockEnv` do Ronco): a variação de ciclo a ciclo vem da variação real da queima (σ de `Q`, 2,5% quente, até 8% frio) e da dispersão fixa entre cilindros.

**Estrutura.** `knockSrc` → `hp 300 Hz` (1 polo; tira o empuxo lento) → banco de 4 passa-faixas em paralelo (bloco, cárter, tampa de válvulas) + 1 ressonância da câmara:

| Ressonador | `f` (Hz) | Q | peso |
|---|---|---|---|
| bloco 1 | 1200·(0,10/B)^0,5 | 4 | 1,0 |
| bloco 2 | 1900·(0,10/B)^0,5 | 5 | 0,8 |
| bloco 3 | 2800·(0,10/B)^0,5 | 6 | 0,6 |
| tampa/cárter | 4200 | 6 | 0,3 |
| câmara (1º modo transversal) | `1,84·c_gás/(π·B)`, `c_gás` ≈ 830 m/s (92 mm → 5,3 kHz; 230 mm → 2,1 kHz) | 12 | 0,2 |

`B` = diâmetro do cilindro (m). Soma → `lp 6 kHz` (parede) → 70% determinístico + 30% ruído branco modulado pela mesma envoltória (o "chocalho") → canal `mech`. Com o frio: ×`(1 + 0,3·cold)` na transmissão (folgas), além do aumento físico de `dp/dθ` pelo atraso maior. Q ≤ 6 nos ressonadores de bloco por decisão: no Ronco, ressonâncias estreitas batidas 100 vezes por segundo viraram "despertador" (`REVISAO-DE-SOM.md`).

**Alvos** (medidos nas gravações, Apêndice A; bandas em dB rel. 150–400 Hz, banda 1–4 kHz com envoltória de Hilbert e passa-baixa de 500 Hz):

| Ouvinte do simulador ↔ microfone real | 1–2,5 kHz | 2,5–6 kHz | centroide | 1–4 kHz rel. 150–400 | curtose 1–4 kHz | p90/p10 (dB) |
|---|---|---|---|---|---|---|
| `cofre` ↔ capô aberto, lenta quente, common-rail com piloto (Hilux 1KD/1GD) | +4 ± 6 | −3 ± 3 | 1000–1500 Hz | +5 ± 6 | 6–9 | 15–17 |
| `ext` (câmera atrás, 4 m) ↔ exterior, lenta fria (Cummins 6.7 a −23 °C) | −8 ± 4 | −16 ± 4 | 270–450 | −8 ± 4 | 10–14 | 12–15 |
| `ext` ↔ pesado em lenta, de lado (C15, ônibus, locomotiva Bedia) | −2,5 ± 2 | −5 a −18 | 600–900 | −2 ± 2 | 4–8 | 9–16 |
| `pipe` ↔ atrás do escape (caminhão em lenta; Ranger de escape livre) | −21 ± 2 | −27 ± 2 | 125–140 | −20 ± 2 | 3,7 | 9,5 |

Forma de cada tique (banda 0,8–8 kHz, média alinhada ao pico): subida 0,6–1,1 ms, −3 dB em 0,3–0,4 ms, −6 dB em 0,5–1,0 ms; centroide do tique 1,4–2,3 kHz, com o contraste tique-fundo máximo (+4 a +6 dB) nos terços de 1000–1600 Hz. **Frio:** a −10 °C, à mesma rotação, a banda 1–4 kHz sobe 8 ± 3 dB em relação ao motor quente (o atraso dobra, `φ_p` → 0,9, `dp/dθ` 1,6×). Gasolina de referência (Camaro em lenta, `TECNICO.md`): 1–2,5 kHz a −17 dB, centroide 266 Hz; o diesel em lenta tem 10–20 dB mais energia em 1–4 kHz do que um gasolina na mesma posição.

### 2.7 Ruído de injeção

Cada evento de injeção gera um tique curto no canal `mech` (filtros dedicados em `buildFilters`), além do knock. Nível em dB relativo ao pico do knock de lenta quente do mesmo motor; decaimento em ms (envelope `exp(−t/τ)` excitando ruído filtrado); amplitude ∝ `(a + (1 − a)·fuel)`:

| `injecao` | Eventos por cilindro e ciclo | Nível | Espectro (bp) | `τ` | `a` | Outros |
|---|---|---|---|---|---|---|
| `common-rail` (1GD, Duratorq, 6.7 ISB, Duramax, ISL9, DC16 XPI) | 2 (piloto + principal) + fechamento do injetor (3 tiques; medido 3,1 por evento no 1GD) | −8 | 4,5 kHz Q 3 + 7 kHz Q 3 | 0,4 | 0,6 | bomba de alta (CP3/HP4): 3 lóbulos a `rpm/2` → pulsos fracos a `1,5·rpm/60` Hz, −20 dB; apito do VGT em lenta (5) |
| `rotativa` (VP37/VE: Golf 1.9 TDI ALH) | 1 + fechamento | −4 | 3 kHz Q 2 + 5 kHz Q 2 | 0,6 | 0,5 | zumbido do anel de roletes: harmônicos `k·N·rpm/120`, k = 8–12, −26 dB |
| `em-linha` (Bosch A/M/P7100: OM617, MWM 229, Cummins 12v; GE 7FDL por cilindro) | 1 + batida do êmbolo | +2 | 2,5 kHz Q 2 + carcaça da bomba 1,3 kHz Q 6 | 1,0 | 0,3 | a bomba "bate" ∝ `fuel·√(rpm/rpm_nom)`; é o "tec-tec-tec" do 12 válvulas |
| `unitaria` (PDE/EUI/MEUI/HPI: Scania PDE, Volvo D13A, Cat C15, QSX15; EMD EUI; Detroit) | 1 (balancim + êmbolo) + fechamento (medido 3 por evento no C15: 18 por ciclo) | +6 | 2,2 kHz Q 2 + 3,5 kHz Q 2 | 1,2 | 0,4 | o som "de máquina de costura" do Cat/Detroit em lenta |
| `heui` (7.3 Power Stroke) | 1 + descarga do óleo | +4 | 2 kHz Q 2 + 3 kHz Q 2 | 1,5 | 0,4 | bomba de óleo de alta: chiado 1–2 kHz, −18 dB, ∝ `fuel` |
| `pld` (bomba-tubo-bico: OM 926) | 1 + êmbolo | +3 | 2,5 kHz Q 2 | 1,0 | 0,35 | como `em-linha`, sem a carcaça única |

Tiques por ciclo medidos (detector: envoltória 1–4 kHz, distância mínima 4 ms, proeminência 25%): Hilux 1GD 12,4 (4 cil.), 1KD 11,5, Cummins 6.7 frio 13,0 (6 cil.), 12v 8,0, C15 18,2, ônibus 24, locomotiva Bedia 25, EMD 710 em lenta 33 (16 cil., 2T), GE 7FDL 39 (16 cil.). O simulador tem de dar 2–4 tiques por evento de combustão nos leves, 2–3 nos pesados, ±1, pelo mesmo detector (`tools/diesel-bandas.ts`).

### 2.8 Frio: velas, partida, falhas e fumaça branca

- **Velas de aquecimento** (`glow`): antes de girar o motor de partida, a página espera `t_glow = 1 s + 8 s·cold_amb` (ambiente a −10 °C → 7 s; moderno `×0,3`); durante isso só o clique do relé. Sem velas (`glow: false`, aspirados antigos a quente) nada muda.
- **Partida**: rotação de partida 150–250 rpm (`Tst` do item 15); a cada injeção, `τ_id` da 2.3; se `τ_id > 4 ms` **ou** `T` na injeção `< 620 K` a queima é **parcial**: `Q ×= clamp((T − 560)/120, 0, 1)·(0,2 + 0,8·rng)` com `Δθ_d` ×2 (combustível queima tarde, mal, e sai sem queimar: fumaça branca). O motor "pega" quando 3 ciclos seguidos passam de 60% de `Q`: 1,5–3 s de partida a −10 °C, 0,5–1 s a 20 °C.
- **Lenta fria**: eletrônico sobe a lenta (`coldAdd`, item 18: Cummins 6.7 medido a 1000 rpm a −23 °C); mecânico não sobe (o motorista puxa o acelerador manual, controle `aceleradorManual` 0–1 que soma ao alvo do governador). Fração de queimas parciais nos primeiros segundos: `pParcial = 0,3·cold·exp(−runT/40 s)`; `fumacaBranca = pParcial + 0,5·(1 − η_c)` na telemetria. Variação de `Q`: σ 2,5% quente → 8% frio (Ronco: 2,5% → 4,75%).
- **Som**: o knock sobe 8 ± 3 dB (2.6); o governador mecânico "caça" (3.1); `clickEnv` ×`(1 + 1,6·cold)` como no Ronco; o turbo não apita (sem fluxo).
- **Aquecimento**: a equação da água do Ronco (`dsp.ts:595–599`) vale; o diesel em lenta esquenta devagar (pouco combustível): o termo de carga usa `fuel` em vez de `pMan/P0`: `load = √(max(0,2, rpm·(0,3 + 2·fuel)/240))`. Em lenta a 20 °C leva ~12 min para 80 °C (Ronco ~6).

---

## 3. Governador, sobrevelocidade, fumaça e freio-motor

### 3.1 Tipos de governador

Rodam em `control()` (a cada 16 amostras, `dtc` = 0,33 ms) e escrevem `fuelCmd` (0–1), alisado pelo atuador `τ_a` (mecânico 0,15 s; eletrônico 0,02 s); o combustível só muda de fato na próxima injeção de cada cilindro (atraso natural de até um ciclo, que é o que faz a lenta de um 2T a 200 rpm pedir ganhos baixos).

| `governador` | Quem usa | Lei | Números |
|---|---|---|---|
| `todas-as-rotacoes` (all-speed, mecânico) | OM617, MWM 229, Cummins 12v, Detroit 6V92 mecânico, F-1000 | pedal escolhe a rotação-alvo: `rpmAlvo = idle + pedal·(rpmMax − idle)`; combustível só proporcional (contrapesos contra mola): `fuel = clamp((rpmAlvo − rpm)/(droop·rpmAlvo) + fuel0, 0, 1)`, `fuel0` = 0; a ligação contrapesos-mola-cremalheira é um 2ª ordem `ω_n = 2π·0,8` rad/s, `ζ` 0,25 | `droop` 0,06–0,10 (a 100% de carga o giro fica 6–10% abaixo do alvo); em lenta a mola é mais mole: `droop_lenta` 0,15; "caça" natural ±1–2% a 0,6–1,2 Hz (OM617, 12v) |
| `min-max` (eletrônico, "pedal manda torque") | Hilux, Ranger, 6.7, Duramax, 7.3, Golf TDI, DC16, D13, C15, ISL9 | `fuelRaw = pedal·mapa(rpm)`; governador de lenta PI isócrono: `fuelIdle = Kp·e + Ki∫e`, `e = (idleTarget − rpm)/idleTarget`, ativo quando `pedal < 0,05` ou `rpm < 1,05·idleTarget`; `fuel = max(fuelRaw, fuelIdle)`; governador de máxima: `fuel ×= clamp((rpmMax + 60 − rpm)/120, 0, 1)` | `Kp` 6 (por unidade de erro relativo; 0,6 por 10%), `Ki` 1,5/s, integrador em [0, 0,35], congelado quando `rpm > 1,3·idleTarget` (desacelerando) |
| `isocrono` | bancada (página sem portador) e, pelo portador, gerador e locomotiva | PI em rotação fixa (`rpmAlvo` do painel, do notch ou da rede) | `Kp` 5, `Ki` 0,5/s (gerador, `CENA.md` 4.4: degrau de 50% derruba 4–8% e recupera em < 3 s); locomotiva `Kp` 6, `Ki` 0,3/s, alvo em rampa de 100 rpm/s (`CENA.md` 4.5); 2T em lenta baixa: `Ki` 0,2/s |
| externo | portador gerador/locomotiva/rotor | `ComandoMotor.combustivel` definido: `fuelCmd = combustivel`, só o limite de fumaça e a proteção de sobrevelocidade do motor por cima | — |

Freio-motor em desaceleração: tirando o pé, `fuelRaw` → 0 e `fuelIdle` só entra abaixo de `1,05·idleTarget`: o motor bombeia ar sem queimar (o análogo do DFCO, mas sem borboleta: silêncio quase total do escape, admissão soprando, turbo descendo).

### 3.2 Sobrevelocidade

Não existe corte de ignição nem o "batido" do limitador. O governador de máxima (rampa de 120 rpm) segura o motor em `rpmMax + 20 ± 30` rpm em neutro com o pedal no fundo (Hilux 4200–4400; Scania 2100–2200; EMD 904 fixo); a oscilação medida tem de ficar `< 1%` pico a pico. Proteção: `rpm > 1,12·rpmMax` → `fuelCmd = 0` até `rpm < 1,05·rpmMax` (só acontece se o portador puxar o motor: descida com marcha curta). Os campos `limiter/limiterBand/limiterHold` dos presets não existem no diesel.

### 3.3 Fumaça no transiente (atraso do turbo com excesso de combustível)

Ao pisar (ou subir um notch) o governador pede combustível na hora, mas o ar vem com o turbo: `τ_turbo` do preset (5). Durante o atraso `λ` cai: com `limiteFumaca` 1,25 (eletrônico) o combustível é cortado ao limite e o motor **não acelera mais que o ar deixa** (a "demora" do diesel moderno, sem fumaça); com 1,0 (mecânico sem aneroide) o combustível vai inteiro, `η_c` cai, o escape esquenta e `fumaca` → 1 (GE 7FDL subindo notch: 2–4 s de fumaça preta; 12v Cummins sem limitador). Medida: `λ(t)` na telemetria; o preset mecânico dá `λ < 1,3` por 0,5–1,5 s nas picapes e 2–4 s na locomotiva GE a cada notch; o eletrônico nunca passa de 1,25. O som: com `η_c` saturado a energia da queima não cresce, mas `Δθ_d` cresce (queima tarde) e `T` na abertura do escape sobe 150–250 K: o "ronco mais rouco" da fumaçada.

### 3.4 Freio-motor

| `freioMotor` | Mecanismo no modelo | Som | Torque de frenagem (alvo) |
|---|---|---|---|
| `descarga` (borboleta no escape: Scania, Volvo, ônibus, picapes com "exhaust brake") | `pBack` sobe a 3 bar (gauge) em 0,3 s quando ativo com `fuelCmd = 0` e `rpm > 1,3·idle`; entra em `exhaustFlow(..., P0 + pBack + 2·run.in0, …)` (item 11): o cilindro esvazia menos e o trabalho de bombeamento freia; o turbo cai (`turboW` alvo ×0,3) | pulsos do escape −15 a −20 dB (quase nada sai), chiado da fresta da borboleta `bp 2 kHz Q 1` com nível ∝ `pBack`, admissão soprando | 30–40% do torque máximo a 2000 rpm |
| `vgt` (Cummins 6.7, ISL9: as palhetas fecham) | igual a `descarga` com `pBack` 2,5 bar e o turbo **acelerando** (`turboW` alvo 0,8: apito sobe) | o "uivo" do VGT em freio, pulsos abafados | 35–45% |
| `jake` (Cat C15, Cummins pesados; `jakeCilindros` [2, 4, 6]) | com `fuelCmd = 0`, abre a válvula de escape em `a ∈ [350, 390]` com 0,35·`AexMax` nos cilindros escolhidos (rodízio fixo: 2 = 1 e 6, 4 = 1-2-5-6); o ar a 35–50 bar sai engasgado (`Mj = 1`, `turb` no máximo) | o "metralhadora": pulsos curtos e rasgados à frequência de ignição; nível total = plena carga na mesma rotação +2 ± 2 dB; 2,5–6 kHz +6 ± 3 dB em relação à plena carga; p90/p10 da banda 1–4 kHz ≥ 15 dB; 2 cilindros −5 dB, 4 cilindros −2 dB em relação a 6 | 6 cil.: 70–90% da potência nominal em frenagem a 1900–2100 rpm; 4: 60%; 2: 30% |
| `veb` (Volvo D13: compressão + descarga) | `jake` em 6 cilindros com janela menor (0,2·`AexMax`) **mais** `pBack` 2 bar | mais surdo que o Jake (−6 dB em 2,5–6 kHz) | 80–100% da nominal |

Na locomotiva o freio dinâmico é elétrico (motores de tração geram, grades dissipam) e o motor fica em notch fixo sem carga: nada disto se aplica (`CENA.md` 4.5).

---

## 4. Ciclo de 2 tempos (EMD 567/645/710, Detroit)

### 4.1 Ciclo de 360° no cilindro

Com `tempos = 2`, no topo do laço por cilindro: `a = (theta − fire[c]) mod 360`; `cyc = 360`. Tudo o mais usa `a` e `cyc`: a injeção arma em `[180, 270)` e dispara em `aSOI = 360 − advInj`; a Wiebe testa `d > 180` em vez de `d > 360`; `tdcRel` já é mod 360. Eventos (graus após o PMS), uniflow (janelas de admissão na camisa, 4 válvulas de escape no cabeçote):

| Evento | EMD 710 | Detroit 6V92 / 6-71 | MAN B&W 6S50MC | Realização |
|---|---|---|---|---|
| EVO (escape abre) | 100 | 95 | 110 | janela `evo..evc` igual à do 4T, `AexMax` ×1,3 (4 válvulas) |
| IPO (janelas abrem) | 134 | 130 | 140 | "válvula de admissão" com perfil **quadrado** `min(1, 2,5·sen²)` (o pistão descobre a janela em ~15°) e área `AinMax` ×1,6 |
| IPC (janelas fecham) | 226 | 230 | 220 | fim da janela; `arPreso[c] = m[c]` (a massa no cilindro, misturada) |
| EVC (escape fecha) | 232 | 225 | 215 | — |

- **Caixa de ar** = `pMan` do modelo, alimentada pelo soprador/turbo (`pUp = P0·(1 + boost)`) por um duto aberto (`thrA` grande). Pressão: EMD lenta 1,15 bar, N8 2,4 bar; Detroit 6V92TA lenta 1,2, plena 2,2; MAN 3,6.
- **Lavagem**: zona única com mistura perfeita; com razão de entrega ~1,2 a pureza fica em ~70% (real, uniflow: 85–90%). **Decisão:** aceitar; corrigir o combustível pela massa presa `arPreso[c]·0,85` (fração fresca) no cálculo de λ. Se `p_max` em N8 sair fora de 115–135 bar, ajusta-se IPC/EVC em ±5°, não a CR.
- **Eventos por volta**: cada cilindro queima a cada volta: frequência de ignição `N·rpm/60` (EMD V16: 71,7 Hz em lenta, 241 Hz em N8; Detroit 6V92: 60 Hz a 600 rpm, 210 Hz a 2100). Em compensação cada pulso tem ~60% do combustível de um 4T do mesmo cilindro: o escape de 2T é um zumbido denso e médio, não o "chug" do 4T — confirmado pelas gravações (4.4).
- **Volante**: `J` próprio do preset (EMD 400 kg·m²; a inércia do alternador vem do portador, `CENA.md` 4.5). A rotação de partida do EMD é ~100 rpm (item 15).

### 4.2 Soprador Roots e turbo engrenado

- **Roots** (EMD 567/645 não turbo; Detroit): reusa `aspiration: 'super'`, `scType 'roots'`, `scRatio`, `scLobes` 3, `scWhine`: pressão ∝ giro sem atraso, uivo em `rpm/60·relação·2·lóbulos`. Detroit 6V92 (relação 1,95): 410 Hz a 2100 rpm, 117 Hz em lenta a 600; EMD 16-567 (2 sopradores, relação 1,9, 3 lóbulos): 171 Hz a 900 rpm. É o som que diferencia um Detroit de qualquer 4T.
- **Turbo engrenado com embreagem de roda livre** (EMD 645E3/710): `N_turbo = max(rpm·i_eng, N_livre)`, `i_eng` = 18,3 (lenta 269 → 4900 rpm; `N_livre` segue o `turboW` com `τ` 3 s / 5 s e máximo 18 000 rpm em N8). Apito: `z` = 27 pás → **2,2 kHz em lenta, 8,1 kHz em N8**, varrendo pelos notches: é o uivo crescente que a gravação do SD70ACe mostra (centroide 650 → 1150 Hz; a banda 2,5–6 kHz sobe de −6 a −1 dB). Nível ∝ `(N_turbo/N_max)²·(0,2 + 0,8·pMan/pUp)`, 60·log(N) como `CENA.md` 4.5. O soprador do 710 **não existe**; o 645E3 tem turbo engrenado e o 567/645E Roots.
- **Detroit 6V92TA**: Roots + turbo em série (turbo alimenta o soprador): `boost = roots(rpm) + turbo(fluxo)`, uivo do Roots dominante, turbo (90 000 rpm, 7 pás: 10 kHz) fraco.

### 4.3 Geometria

`src/engines/diesel/geometria.ts` reusa `CRANKS`, `tdcAngles`, `schedule`, `intervals`, `build` do Ronco para os 4T e acrescenta:

| Motor | Virabrequim | Moentes (`pins`, graus) | Bancada | Intervalos | Ordem |
|---|---|---|---|---|---|
| EMD 16-710 (2T V16) | `'emd16'` | pares a 22,5°: `[0,0, 90,90, 180,180, 270,270, 22.5,22.5, 112.5,112.5, 202.5,202.5, 292.5,292.5]` | 45° | **22,5° uniformes** (PMS da bancada A em `−pin`, da B em `−45 − pin`: a união cobre os 16 múltiplos de 22,5°) | decorre dos PMS; a da EMD é 1-8-9-16-3-6-11-14-4-5-12-13-2-7-10-15 (numeração EMD: 1–8 esquerda, 9–16 direita, `n` e `n+8` no mesmo moente). O montador 2T **não** usa `order`: `fire[c] = PMS[c] mod 360`, `valid = true` |
| EMD 12-710 / 20-645 | `'emd12'`, `'emd20'` | 6 moentes em pares a 30°; 10 em pares a 18° | 45° | 30°; 18° | idem |
| Detroit 6V92 (2T V6) | `'dd6v'` | `[0,0, 120,120, 240,240]` | 63,5° | **56,5° / 63,5° alternados** (bancada B a −63,5°): o "trote" do Detroit V6 | idem; **a conferir** contra gravação do 6V92 quente (a de referência é partida a frio) |
| Detroit 6-71 / 8V71 | `'dd6'` em linha | `[0, 240, 120, 300, 60, 180]` | — | 60° | idem |
| MAN B&W 6S50MC | `'inline-6'` 120° existente | — | — | 60° (6 cilindros em 360°) | idem |
| GE 7FDL-16 (4T V16) | `'v-16' '90'` existente | `dbl(I8)` | 45° | 45° uniformes | ordem `'1-8-7-4-3-6-5-2-15-10-9-14-13-12-11-16'` do Ronco; a ordem real da GE deve ser conferida no manual, mas não muda o som: o que importa é o intervalo uniforme e a alternância de bancadas |

Nos 2T, `tdcRel[c] = fire[c]`, o balanceamento usa o mesmo `balance()`, e `runners` (coletor) = `'short'` (os 2T de locomotiva têm coletores curtos por bancada).

### 4.4 Tabelas por notch

Rotação por notch (`CENA.md` 4.5) e potência bruta do motor (as frações são as do regulador de carga; kW = fração × nominal):

| Notch | 0 (lenta) | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|---|
| EMD 16-710G3 rpm | 269 (200 lenta baixa) | 269 | 343 | 490 | 568 | 651 | 729 | 820 | 904 |
| EMD 710 potência (3356 kW brutos, 4500 hp; SD70ACe) | 0 | 170 | 400 | 770 | 1170 | 1610 | 2150 | 2750 | 3356 |
| GE 7FDL-16 rpm (C30-7 / C36-7) | 440 | 440 | 511 | 585 | 672 | 764 | 846 | 950 | 1050 |
| GE 7FDL-16 potência (C30-7: 2240 kW; C36-7: 2690 kW) | 0 | 110 / 135 | 270 / 320 | 515 / 620 | 785 / 940 | 1075 / 1290 | 1435 / 1720 | 1835 / 2205 | 2240 / 2690 |
| frequência de ignição EMD (2T, Hz) | 71,7 | 71,7 | 91,5 | 130,7 | 151,5 | 173,6 | 194,4 | 218,7 | 241,1 |
| frequência de ignição GE (4T, Hz) | 58,7 | 58,7 | 68,1 | 78,0 | 89,6 | 101,9 | 112,8 | 126,7 | 140,0 |

Medido nas gravações (bandas rel. 150–400 Hz; detalhes no Apêndice A):

| Trecho | 60–150 | 400–1k | 1–2,5k | 2,5–6k | 6–12k | centroide |
|---|---|---|---|---|---|---|
| EMD SD70ACe, lenta (0–12 s; pente harmônico ≈ 250 rpm) | +8,4 | +3,3 | −6,6 | −5,8 | −13,3 | 650–750 Hz |
| EMD SD70ACe, notch médio (16–28 s; ≈ 370 rpm) | +1,1 | +2,3 | −3,1 | −5,6 | −9,4 | 900–1000 |
| EMD SD70ACe, notch 8 (60–68 s; 904–917 rpm medidos) | +2,7 | +2,5 | −4,2 | −4,0 | −10,5 | 560–1150 (≈ 840) |
| GE 7FDL-16, lenta (0–16 s; 437–478 rpm medidos) | +13,0 | −1,7 | −11,0 | −19,5 | −28 | 370–460 |
| GE 7FDL-16, notch 8 (20–32 s) | +15,8 | −0,7 | −7,6 | −13,5 | −23 | 270–335 |
| GE 7FDL-16, descendo notches (36–68 s) | +7 a +11 | −2 a −3 | −9,5 a −12,5 | −13 a −17 | −19 a −22 | 270–350 |

O contraste é o que o modelo tem de reproduzir: o **2T turbo (EMD) é brilhante** (centroide 650–1150 Hz, bandas acima de 1 kHz a −3…−7 dB, apito do turbo subindo com o notch), o **4T (GE) é grave** (centroide 270–460 Hz, +13 a +16 dB em 60–150 Hz, acima de 2,5 kHz a −13 dB ou menos, quase sem apito em lenta: o turbo livre da GE gira devagar). Tolerância de aceitação: ±4 dB por banda, centroide ±30%.

---

## 5. Turbo diesel

Pressões absolutas no coletor: picapes 2,2–2,9 bar; caminhões 2,6–3,0; locomotivas 2,4–2,7; gerador 2,6; MAN B&W 3,6. Sem borboleta não há válvula de alívio (BOV): tirando o pé o turbo só desce (`τ` de descida), e o único som é o apito caindo em frequência; o "flutter" de surge do compressor (`tchu-tchu`) fica como chave opcional desligada por padrão (ruído de 3–6 pulsos de 40 ms, `bp 1,5 kHz`, só com `τ` curto e corte brusco de fluxo).

| Motor | Turbo | `turboRpmMax` | `turboPas` z | BPF em lenta → carga | `turboTau` sobe/desce (s) | `turboTipo` |
|---|---|---|---|---|---|---|
| Hilux 2.8 1GD | Toyota/IHI VGT | 190 000 | 6 | 3,0 kHz (30 krpm, palhetas fechadas) → 19 kHz (inaudível; o apito audível é o do meio da subida, 8–12 kHz) | 0,8 / 1,5 | `vgt` |
| Ranger 3.2 | Garrett VGT | 180 000 | 6 | 2,8 → 18 kHz | 0,8 / 1,5 | `vgt` |
| Cummins 6.7 | Holset HE351VE | 130 000 | 7 | 2,9 kHz (25 krpm em lenta, palhetas fechadas: o apito de lenta do Cummins) → 15 kHz | 1,0 / 1,8 | `vgt` (e freio) |
| Duramax L5P | BorgWarner VGT | 140 000 | 7 | 2,5 → 16 kHz | 1,0 / 1,8 | `vgt` |
| 7.3 Power Stroke | Garrett GTP38 | 120 000 | 7 | 1,5 → 14 kHz | 1,2 / 2,0 | `wastegate` (abre a 1,3 bar gauge: chiado `bp 3 kHz` −20 dB) |
| Golf 1.9 TDI ALH | Garrett GT1749V | 200 000 | 6 | 2,5 → 20 kHz | 0,7 / 1,3 | `vgt` |
| Scania DC16 / Volvo D13 / Cat C15 / ISL9 / QSX15 | Holset HX55–HX82, BW S410 | 110 000 | 7 | 1,8 kHz → 12,8 kHz; em carga constante (gerador) 7–8 kHz contínuos | 1,5 / 2,5 | `wastegate` (DC16, D13, C15, QSX15), `vgt` (ISL9) |
| Detroit 6V92TA | Garrett T18A + Roots | 90 000 | 7 | 1 → 10 kHz (fraco; o Roots domina) | 1,5 / 2,5 | `fixo` |
| EMD 710 | EMD G turbo engrenado | 18 000 | 27 | **2,2 kHz (engrenado) → 8,1 kHz (N8)** | 3 / 5 (livre); engrenado sem atraso | `engrenado` |
| GE 7FDL | GE turbo livre | 15 500 | 20 | 1,0 kHz (3 krpm) → 5,2 kHz | 4 / 6 (o atraso da fumaçada) | `fixo` |
| MAN B&W 6S50MC | ABB TPL77 + sopradores auxiliares elétricos | 12 000 | 24 | 2,4 → 4,8 kHz; sopradores auxiliares abaixo de 40% de carga (zumbido 100 Hz + pás) | 8 / 12 | `fixo` |

Realização (item 23): `N_turbo = turboW·turboRpmMax` (ou `max` com o engrenado); apito `f = z·N_turbo/60` com 2º harmônico a −12 dB, Q equivalente 30 (jitter 0,3%), nível `turboApito` (dB do preset) × `(N/N_max)²·(0,2 + 0,8·pMan/pUp)`; se `f > 16 kHz` o nível cai 12 dB por oitava acima (fora do audível, sobra o chiado); chiado `bp 4,8 kHz` ∝ `turboW²·(0,3 + boost)` como hoje, modulado ±15% pela admissão (`scIn`) para não virar "mar" (`REVISAO-DE-SOM.md`). Wastegate: abre quando `boost > boostAlvo` → chiado curto. VGT: em lenta e freio as palhetas fecham, `turboW` mínimo 0,15 (o apito de lenta); em carga abrem. O 2º estágio (ACERT) não se modela.

**Escape depois da turbina.** A turbina é o `TwoPort 'turbo'` existente (−6 dB acima de 1,3 kHz, corte 3,5 kHz, `gT` 0,74). Depois dela: picapes e carros modernos têm DOC + DPF (`DoisPortasDiesel 'dpf'`: 2 × `lp 1200 Hz`, `gT` 0,85, `rA` 0,3, `rB` 0,15) e abafador `'stock'`; caminhões: abafador grande (`'abafador-caminhao'`: `lp 900` ×2, `peak 90 Hz +3`, `gT` 0,9) e chaminé vertical de 3–4 m e 5" (`ds` 2: `Y` ×4, `fRad` 1 kHz) ou saída horizontal; locomotivas: só a chaminé (0,6–1,0 m, Ø 0,45 m: `fRad` = 400/(2π·0,225) = 283 Hz, perda `exp(−0,09·L)` desprezível); gerador: silencioso residencial (`'stock'` + 2 m de tubo Ø 150 mm). **Sem catalisador quente**: `hasCat` não produz nada no diesel (`catNoise` = 1, nenhuma bomba de ar, nenhum atraso de aquecimento), a colmeia do DPF entra só como o filtro acima; a saída do escape em lenta fica a 120–200 °C e nenhum combustível acende no tubo. Antigos (OM617, MWM, 12v, 7.3, 6V92, EMD, GE): sem DPF.

---

## 6. Presets

### 6.1 Campos novos (`PresetDiesel = PresetRonco & {…}`)

| Campo | Tipo / faixa | Significado |
|---|---|---|
| `tempos` | 2 \| 4 | ciclo |
| `cr` | 12–23 | taxa de compressão (substitui `compression`) |
| `injecao` | `common-rail` \| `rotativa` \| `em-linha` \| `unitaria` \| `heui` \| `pld` | tipo (2.7) |
| `piloto`, `idi` | boolean | injeção piloto; pré-câmara |
| `cetano` | 40–55 | padrão 48 |
| `governador`, `droop` | 3.1; 0–0,12 | tipo e queda de rotação do mecânico |
| `rpmMax`, `rpmPotencia`, `torque`, `power`, `bsfc?` | rpm; rpm; N·m; kW; kg/kWh | ficha (`redline` do Ronco passa a ser `rpmMax` para o tacômetro) |
| `limiteFumaca` | 1,0–1,3 | λ mínimo (2.2) |
| `turboTipo`, `turboRpmMax`, `turboPas`, `turboApito`, `turboTau` | 5 | turbo; `boost` continua sendo a pressão manométrica máxima em bar |
| `soprador?` | `{ relacao, lobulos, uivo }` | Roots (2T); mapeia em `scType 'roots'`, `scRatio`, `scLobes`, `scWhine` |
| `freioMotor`, `jakeCilindros?` | 3.4 | freio-motor |
| `escape` | `{ turbina, dpf, abafador, comprimento, diametro, chamine, tempGas }` | topologia do `buildExhaust` diesel (`muffler/pipeLen/pipeD/tipD` do Ronco continuam valendo nos carros) |
| `janelas?` | `{ evo, ipo, ipc, evc }` | só 2T |
| `J?` | kg·m² | inércia do motor (sobrepõe a fórmula) |
| `glow` | boolean | velas de aquecimento |
| `portadores` | `('carro' \| 'gerador' \| 'locomotiva' \| 'nenhum')[]` | tabela de compatibilidade |
| `locomotiva?`, `gerador?` | tabelas de notch / dados do alternador | passados ao portador |

Campos do Ronco **sem efeito** no diesel (o painel não os mostra): `limiter*`, `overrun`, `cat`, `twoStep`, `launchRpm`, `fuel`, `valve` (exceto picapes com escape livre), `scWhine` direto (vem de `soprador`).

### 6.2 Fichas

Massa com motorista (carga: caminhões como conjunto carregado); relações de câmbio como no Ronco (`ratios`, `finalDrive`); `rpmMax` é a rotação governada sem carga. Valores de fabricante onde públicos; "≈" onde foram estimados pela classe.

| # | Preset (`id`) | Motor | Cil., L | `cr` | lenta / `rpmMax` | potência | torque | `injecao` | turbo (bar abs) | massa | câmbio / portadores |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Toyota Hilux 2.8 (`hilux28`) | 1GD-FTV | I4, 2,755 (92 × 103,6) | 15,6 | 780 / 4400 | 150 kW @ 3400 | 500 N·m @ 1600–2800 | `common-rail` piloto, VGT, `min-max` | 2,4 `vgt` | 2200 kg | 6AT (3,60 2,09 1,49 1,00 0,69 0,58; 3,909), roda 0,39 m; **carro** |
| 2 | Ford Ranger 3.2 (`ranger32`) | Duratorq TDCi I5 | I5 (144°), 3,198 (89,9 × 100,8) | 15,7 | 750 / 4000 | 147 kW @ 3000 | 470 @ 1750–2500 | `common-rail` piloto, `min-max` | 2,3 `vgt` | 2250 | 6AT 6R80 (4,17 2,34 1,52 1,14 0,87 0,69; 3,73); **carro** |
| 3 | Ram 2500 6.7 Cummins (`ram67`) | ISB 6.7 (2013) | I6, 6,69 (107 × 124) | 17,3 | 750 (1000 frio) / 3200 | 276 kW @ 2800 | 1152 @ 1600 | `common-rail` piloto, `min-max` | 2,9 `vgt`; freio `vgt` | 3500 | 6AT 68RFE (3,23 1,84 1,41 1,00 0,82 0,63; 3,73), roda 0,40; **carro** |
| 4 | Silverado 2500HD 6.6 Duramax (`duramax66`) | L5P | V8 90°, 6,6 (103 × 99), ordem 1-2-7-8-4-5-6-3 | 16,0 | 680 / 3450 | 332 kW @ 2800 | 1234 @ 1600 | `common-rail` piloto, `min-max` | 2,9 `vgt` | 3600 | 10AT Allison (4,54 2,86 2,06 1,72 1,38 1,14 1,00 0,85 0,68 0,63; 3,42); dois coletores → um turbo (`routing 'single'`); **carro** |
| 5 | Ford F-250 7.3 Power Stroke (`psd73`) | Navistar T444E 7.3 (1999) | V8 90°, 7,3 (104,4 × 106,2), ordem 1-2-7-3-4-5-6-8 | 17,5 | 680 / 3300 | 186 kW @ 2600 | 678 @ 1600 | `heui`, `min-max` (PCM) | 2,3 `wastegate` | 3400 | 4AT 4R100 (2,71 1,54 1,00 0,71; 3,73); **carro** |
| 6 | Mercedes 300D W123 (`om617`) | OM617.912 | I5, 3,005 (91 × 92,4) | 21,0 `idi` | 750 / 5100 | 59 kW @ 4000 | 172 @ 2400 | `em-linha` Bosch M, `todas-as-rotacoes` droop 0,08, `glow` 20 s | aspirado | 1700 | 4AT 722.1 (3,68 2,41 1,44 1,00; 3,46); **carro** |
| 7 | VW Golf IV 1.9 TDI (`tdi19`) | ALH | I4, 1,896 (79,5 × 95,5) | 19,5 | 900 / 4800 | 66 kW @ 3750 | 210 @ 1900 | `rotativa` VP37, `min-max` | 2,0 `vgt` | 1300 | 5MT (3,78 2,12 1,36 0,97 0,76; 3,39), roda 0,30; **carro** |
| 8 | Ford F-1000 MWM 229 (`f1000mwm`) | MWM D229-4 | I4, 3,92 (102 × 120) | 17,0 | 750 / 3000 | 66 kW @ 2800 | 274 @ 1800 | `em-linha` Bosch A, `todas-as-rotacoes` droop 0,08, `limiteFumaca` 1,0 | aspirado | 2200 | 5MT Clark (4,56 2,47 1,47 1,00 0,78; 4,10), roda 0,38; **carro** |
| 9 | Scania R500 V8 (`scaniav8`) | DC16.03 PDE (Euro 3) | V8 90°, 15,6 (127 × 154), ordem 1-5-4-2-6-3-7-8 | 17,0 | 500 / 2100 | 368 kW @ 1900 | 2400 @ 1100–1400 | `unitaria` PDE, `min-max` | 2,6 `wastegate`; freio `descarga` | 40 000 (conjunto) | Opticruise 12 (11,32 9,14 7,19 5,80 4,63 3,74 3,02 2,44 1,92 1,55 1,24 1,00; 3,08), roda 0,52; chaminé lateral; **carro, gerador** |
| 10 | Volvo FH D13 (`volvod13`) | D13A 480 | I6, 12,8 (131 × 158) | 17,0 | 600 / 2100 | 353 kW @ 1400–1800 | 2400 @ 1050–1450 | `unitaria` EUI, `min-max` | 2,7 `wastegate`; freio `veb` | 40 000 | I-Shift 12 (14,94 11,73 9,04 7,09 5,54 4,35 3,44 2,70 2,08 1,63 1,27 1,00; 2,85); **carro, gerador** |
| 11 | Cat C15 (`catc15`) | C15 6NZ (2003) | I6, 15,2 (137 × 171) | 17,0 | 600 / 2100 | 410 kW @ 2100 | 2510 @ 1200 | `unitaria` MEUI, `min-max` | 2,7 `wastegate`; freio `jake` [2, 4, 6] | 36 000 | Eaton 18 (principais 14,40 8,56 6,05 4,38 3,20 1,95 1,38 1,00 0,86 0,73; 3,55); chaminé dupla vertical; **carro, gerador** |
| 12 | Ônibus urbano Cummins ISL9 (`onibusisl`) | ISL9 280 | I6, 8,9 (114 × 144,5) | 16,6 | 650 / 2300 | 206 kW @ 2100 | 1017 @ 1300 | `common-rail`, `min-max` | 2,6 `vgt`; freio `vgt` | 18 000 | ZF Ecolife 6AT (3,36 1,91 1,42 1,00 0,72 0,62; 5,74), roda 0,51; escape traseiro longo (6 m); **carro, gerador** |
| 13 | Detroit Diesel 6V92TA, MCI MC-9 (`dd6v92`) | 6V92TA | **2T** V6 63,5°, 9,05 (123,8 × 127) | 17,0 | 550 / 2100 | 224 kW @ 2100 | 1180 @ 1200 | `unitaria` mecânica, `todas-as-rotacoes` droop 0,07, `limiteFumaca` 1,1 | Roots 1,95:1 (3 lóbulos, `uivo` 0 dB) + turbo, 2,2 total, `fixo` | 16 000 | Allison HT-740 4AT (3,69 2,01 1,36 1,00; 4,11); **carro** |
| 14 | Gerador Cummins 500 kVA (`gen500`) | QSX15-G8 | I6, 15,0 (137 × 169) | 17,0 | 1800 fixo (1200 na partida) / 1890 | 455 kW @ 1800 (400 kW elétricos ESP) | 2415 @ 1500 | `unitaria` HPI, `isocrono` (externo) | 2,6 `wastegate` | 5000 (conjunto) | **gerador** (60 Hz, 4 polos, alternador Stamford HCI544, `η` 0,95, `J_alt` 12 kg·m², ventilador 10 pás a 1800 rpm → 300 Hz), **nenhum** |
| 15 | Locomotiva EMD SD70ACe (`emd710`) | 16-710G3C-T2 | **2T** V16 45°, 186 (230,2 × 279,4), `'emd16'` | 16,0 | 269 (200) / 904 | 3356 kW @ 904 | 35 400 @ 904 | `unitaria` EUI, `isocrono` (externo), `limiteFumaca` 1,2 | 2,4 `engrenado` | 190 t | **locomotiva** (tabela 4.4), **nenhum**; `J` 400 |
| 16 | Locomotiva GE C30-7 (`ge7fdl`) | 7FDL-16 | V16 45°, 175 (228,6 × 266,7) | 12,7 | 440 / 1050 | 2240 kW @ 1050 (C36-7: 2690) | 20 400 @ 1050 | `em-linha` por cilindro, `isocrono` (externo), `limiteFumaca` **1,0** | 2,6 `fixo` (τ 4/6 s) | 180 t | **locomotiva**, **nenhum**; `J` 380 |
| 17 (extra) | MAN B&W 6S50MC-C (`manbw`) | 6S50MC-C | **2T** lento I6, 2250 (500 × 1910) | 17 geom. (13 efetiva por EVC) | 30 (dead slow) / 127 | 9480 kW @ 127 | 713 000 @ 127 | `em-linha` (bombas de êmbolo por cilindro), `isocrono` | 3,6 `fixo` + sopradores auxiliares | — | **nenhum** (bancada); partida a ar comprimido (chiado 3 s, sem motor de partida) |

Diferenças fixas entre cilindros: as do Ronco (ar ±7%, área ±10%, energia ±5%), ×1,3 nos `em-linha`/`unitaria` mecânicos (cada bomba é calibrada à mão), ×0,6 nos common-rail (a central iguala os cilindros). O 2T EMD recebe variação adicional de janelas por cilindro ±4% (carbonização).

### 6.3 Tabela motor × portador (linhas novas da tabela 1.6 de `CENA.md`)

| Motor | carro (picape / caminhão / ônibus) | gerador | locomotiva | nenhum (bancada) |
|---|---|---|---|---|
| 1–8 (picapes e carros) | ✓ (`CarroLegado` dentro do DSP, câmbio do preset) | — | — | ✓ |
| 9–12 (Scania, Volvo, Cat, ISL9) | ✓ caminhão/ônibus | ✓ (grupo gerador industrial: `isocrono` externo; alternador do portador) | — | ✓ |
| 13 Detroit 6V92 | ✓ ônibus | — | — | ✓ |
| 14 QSX15 | — | ✓ | — | ✓ |
| 15 EMD 710, 16 GE 7FDL | — | — | ✓ | ✓ |
| 17 MAN B&W | — | — | — | ✓ |

Níveis absolutos para gerador e locomotiva (fonte `escape.0` + `bloco`, campo livre, para o `refDist` 7,5 m do portador): grupo gerador aberto de 500 kVA a plena carga 108 ± 3 dB(A) a 1 m → `L_W` ≈ 118 dB(A) (carenado: −20 dB por `m_s` 15, `CENA.md` 4.4); locomotiva EMD/GE em N8 parada: 87 dB(A) a 30 m (limite 40 CFR 201 para locomotivas pós-1979) → `L_W` ≈ 128 dB(A); em lenta 70 dB(A) a 30 m → 111 dB(A). O adaptador `motor.ts` fixa o ganho para que a plena carga do preset dê esse `L_W`; para o portador carro vale a calibração relativa do Ronco (1.2).

---

## 7. Interface da página `diesel.html`

Mesma casca (`Barra`, `FamilyNav`, `PresetNav`, `BotaoIgnicao`, `AudioShell`, perfil de áudio igual ao `PERFIL_RONCO`), mostradores em canvas fora do React. Famílias: Picapes e carros (1–8), Caminhões e ônibus (9–13), Geradores (14), Locomotivas (15–16), Marítimo (17).

| Seção do Ronco | No diesel |
|---|---|
| Escuta e ambiente | **igual** (ouvinte `ext/int/bay/pipe/road`, ambientes, distância da rua, mixes de escape/admissão/mecânica/ar, mestre, dinâmica real/arcade, som de fundo). Em gerador e locomotiva o `road` vira a Passagem com o portador (`CENA.md` 3) |
| Motor | **igual** em arranjo, cilindros, virabrequim, ordem, cilindrada (escala logarítmica 0,5–3000 L), lenta; **novo**: `tempos` (2T só nos virabrequins 2T), `cr` 12–23, `rpmMax`, `injecao`, `piloto`, `idi`, `cetano`; **somem** comando `cam` como "bravo" (vira "cruzamento 0–0,3") e `fuel` carb/efi |
| Características | `inertia` igual; `power`/`torque` da ficha; `bsfc` |
| Corte de giro | **substituída por "Governador"**: tipo, `droop`, acelerador manual (mecânicos), rotação-alvo (isócrono em bancada), sobrevelocidade mostrada |
| Temperatura do motor | **igual** mais: `glow` (tempo de espera visível no botão de ignição), indicadores de fumaça branca/preta e λ |
| Transmissão | **igual** para portador carro (manual/automático, modos, tempo de troca, relações); **oculta** em gerador, locomotiva e bancada |
| Escapamento | igual (abafador, comprimento, diâmetro, ponteira, traçado nos V) mais `turbina` on/off, `dpf`, `chamine` (altura/diâmetro), `tempGas` |
| Acessórios | válvula de escape e ressonador só em picapes; 2-step **some**; **novo**: freio-motor (tipo e cilindros do Jake; tecla `J` para acionar) |
| Estalos no escape | **some** (não existe) → vira "Fumaça e frio": `limiteFumaca`, aneroide, pré-aquecimento |
| Admissão | caixa de ar/filtro esportivo iguais; sem borboletas individuais; **novo**: turbo (`turboTipo`, `boost`, `turboRpmMax`, `turboPas`, `turboApito`, `turboTau`) e soprador Roots (2T) |
| **nova**: Carga (depende do portador) | carro: pedal como hoje (teclas, barra, gamepad); locomotiva: notches 0–8 (teclas `0–8`, `+/−`), freio dinâmico; gerador: degraus 0/25/50/75/100% (teclas `0–4`) e frequência da rede; bancada: dinamômetro (torque de carga 0–100% do nominal e rpm-alvo) |

Mostradores: conta-giros com fundo de escala `1,15·rpmMax` arredondado (5000, 3000, 2500, 1200, 150); anel do ciclo de ignição com `cyc` 360 nos 2T; onda e espectro iguais; **novos**: pressão de pico no cilindro (bar) com `dp/dθ` (bar/°) e um traço p–θ do último ciclo do cilindro 1 (canvas de 200 × 120), λ e fumaça (opacímetro 0–100%), pressão do turbo e rotação do turbo, temperatura do gás de escape, notch/kW (locomotiva), kW/Hz (gerador), `τ_id` em ms. Telemetria a cada 1024 amostras como hoje, com os campos do item 24.

Paridade de interface (lista do relatório): todos os controles de "Escuta e ambiente", "Temperatura" e "Transmissão" do Ronco continuam existindo com o mesmo nome; a lista dos que mudam de seção ou somem é a tabela acima.

---

## 8. Plano de implementação e verificação

Ferramentas (`tools/`, TypeScript com `tsx`): `diesel-render.ts` (cenários `idle`, `cold`, `rev`, `wot`, `sweep`, `notches`, `degraus`, `jake`, `freio`; grava WAV float e JSON com `rpm, fuel, lambda, pMax, dpdθ, tauId, boost, fumaca` a cada 1024 amostras), `diesel-lenta.ts` (todos os presets a 20 °C e −5 °C, 20 s, acelerada aos 8 s; zero apagamentos, rpm final a ±3% do alvo, NaN = falha), `diesel-governador.ts` (degraus de carga e de alvo; mede queda, tempo de recuperação, sobrepasso, oscilação), `diesel-bandas.ts` (a tabela de bandas do projeto + banda 1–4 kHz, curtose, p90/p10, tiques por ciclo pelo detector de 2.7: porta em TypeScript de `scan.py`/`analyze2.py`/`ticks.py` que geraram o Apêndice A). Cada passo termina com o teste indicado num comando só (`npm run teste:diesel -- <passo>`); os números vão para o relatório.

| # | Passo | Entrega | Teste objetivo |
|---|---|---|---|
| 1 | Ganchos no `EngineDSP` | itens 1–2 da tabela 1.2 e os `if (this.cc)` vazios; `DieselDSP` que só põe `cc = true` | `npm run paridade:ronco` (200 cenários) idêntico; `--dist` idêntico; tempo de `v16 rev` e `muscle wot` ±3%; `git diff --stat src/engines/ronco/dsp.ts` < 80 linhas |
| 2 | Ciclo diesel 4T mínimo | CR, admissão aberta, injeção, Hardenberg–Hase, Wiebe dupla, governador `min-max` e `isocrono` interno; preset `hilux28` | `idle` 12 s a 90 °C: rpm 780 ± 2%, `pMax` 45–60 bar, `dpdθ` 3–6 bar/°, `tauId` 0,5–0,8 ms, λ > 4; `rev` em neutro: 4400 ± 50 rpm sustentados, oscilação < 1% pico a pico, sem batido; `sweep` a 55% com `fuel` 1: `pMax` 140–180 bar, λ 1,3–1,5; potência medida (`measurePower`) = 150 kW ±5% depois da escala; nenhum NaN |
| 3 | Knock e injeção | `knockSrc`, banco estrutural, tiques por tipo, `clickEnv` ×1,5 | `bay` do `hilux28` em lenta quente: 1–2,5 kHz +4 ± 6 dB, centroide 1000–1500 Hz, curtose 1–4 kHz 6–9, p90/p10 15 ± 3 dB, 2–4 tiques por evento; a −10 °C na mesma rpm: 1–4 kHz +8 ± 3 dB; `ext` do `ram67` frio a 1000 rpm: 1–2,5k −8 ± 4, centroide 270–450 |
| 4 | Escape diesel e calibração | `buildExhaust` diesel (turbina, DPF, abafadores, chaminés, `520/c`), `calibrate`/`measurePower` | `pipe` do `catc15` em lenta: 60–150 +11 ± 3, 1–2,5k ≤ −18, centroide 125–200; `ext` lenta → plena carga a 55%: +18 a +25 dB; os 8 leves dentro de uma faixa de 12 dB em lenta (Ronco: 11) |
| 5 | Governadores | `todas-as-rotacoes` com ligação de 2ª ordem; degraus de carga via `acoplar(Carga)` | `om617`: droop medido 7–9% entre pedal 1 em vazio e com carga de 100% do torque; caça ±1–2% a 0,6–1,2 Hz; `hilux28` degrau de carga de 30% do `torque` em lenta: queda ≤ 8%, recuperação a ±2% em < 2 s; `gen500` (interno): degrau 50% → queda 4–8%, recuperação < 3 s, sobrepasso ≤ 1% |
| 6 | Frio e fumaça | velas, partida, queima parcial, lenta fria, `fumaca` | partida a −10 °C: `t_glow` 7 s (moderno 2 s), gira 1,5–3 s até pegar; fração de queimas parciais 20–30% nos primeiros 10 s decaindo com τ 40 s; `f1000mwm` pé no fundo da lenta: λ < 1,3 por 0,5–1,5 s; `hilux28`: λ ≥ 1,25 sempre; `ge7fdl` subindo cada notch: λ < 1,3 por 2–4 s |
| 7 | Freio-motor | `pBack`, Jake, VEB | `catc15` Jake 6 a 1900 rpm: nível total = plena carga ±2 dB, 2,5–6 kHz +6 ± 3 dB, p90/p10 ≥ 15 dB, torque de frenagem 70–90% do nominal; 2 cil. −5 dB; `scaniav8` descarga: pulsos −15 a −20 dB, torque 30–40% |
| 8 | 2 tempos | `geometria.ts` 2T, ciclo de 360°, janelas, Roots, turbo engrenado; `emd710` e `dd6v92` em bancada | EMD: intervalos 22,5° exatos (16 linhas a `16·rpm/60` dominam o espectro < 1 kHz), lenta 269 ± 1%, N8 904 ± 1%, `pMax` 115–135 bar em N8, apito 2,2 kHz em lenta → 8,1 kHz em N8 (pico do espectrograma ±5%); bandas em lenta e N8 dentro de ±4 dB da tabela 4.4 e centroide ±30%; Detroit: uivo do Roots em 410 Hz ± 2% a 2100 rpm, intervalos 56,5/63,5 |
| 9 | GE 7FDL e portador locomotiva | `ge7fdl`; acoplamento ao portador (`combustivel` externo, tabela de notches) | rpm por notch ±1%, potência ±3%, rampa 100 rpm/s (CENA 5.10); bandas em lenta e N8 ±4 dB da tabela 4.4 (centroide 270–460 Hz); fumaça por notch como no passo 6 |
| 10 | Gerador | `gen500` com o portador gerador | ISO 8528 G2: degrau 100% queda ≤ 10% e recuperação ≤ 5 s; degrau 50% como no passo 5; 120 Hz do alternador +8 ± 2 dB em plena carga (portador) |
| 11 | Presets completos | os 16 (+1) com fichas; tabela de compatibilidade | `diesel-lenta.ts`: 17 presets × 2 temperaturas, zero apagamentos, rpm ±3%; potência ±5% da ficha; `hilux28` a 100 km/h em 6ª: 1700 ± 100 rpm; `scaniav8` a 85 km/h em 12ª: 1250 ± 100 rpm; `volvod13` 0–85 km/h carregado em 60–90 s |
| 12 | Página e navegador | `diesel.html`, `src/pages/diesel/`, `tools/diesel-navegador.mjs` | paridade de controles (lista da seção 7); teste headless: liga, acelera, troca portador/preset/ambiente, notches, degraus, Jake, sem erros no console, telemetria chegando; worklet (não a reserva) |
| 13 | Documentação | `TECNICO.md` → seção Diesel e Validação (só gravações do Commons na tabela pública), `PLANO.md` marcado, relatório | relatório com todos os números acima |

### 8.1 Riscos e como limitar

| Risco | Medida |
|---|---|
| **Quebrar a paridade a gasolina** por um `if` mal posto ou por reordenar uma expressão | Passo 1 isolado e o portão de 1.3 em todo commit que toque `ronco/dsp.ts`; só `if (this.cc) {…} else { linha original }`; nunca expressões ternárias novas no caminho gasolina |
| **CPU**: 16 cilindros 2T = 2× eventos de válvula e de queima; o resolvedor implícito do escape (6 iterações) roda em todas as válvulas abertas | Medir render de `emd710 notches` em Node: ≤ 40% do tempo real (o Chiron V16 do Ronco é a referência); se passar, baixar `solverIt` para 4 nos cilindros com razão de pressão > 3 (escoamento engasgado converge em 2) |
| **Rigidez numérica** com CR 21 e `dp/dθ` 10 bar/° (Euler explícito a 48 kHz: 0,1–0,5° por amostra; 6–10 amostras na queima pré-misturada) | Limitar `Δθ_p ≥ 5°` e `dp` por amostra a 6 bar; conferir `flow()` com `pc` até 220 bar e `pb` 1 bar (Ψ engasgado) na paridade de `acoustics`; teste de NaN em todos os renders |
| **Hardenberg–Hase diverge** em `p < 12,4 bar` (partida muito fria, blow-by) | `p ≥ 15 bar` no termo; `τ_id ≤ 8 ms` (acima disso é falha total) |
| **Governador instável** com o atraso de um ciclo (2T a 200 rpm: 0,3 s) ou com a escala de torque `tqS` entrando acima de 1,5× a lenta | Ganhos da tabela 3.1 com `Ki` baixo nos lentos; o `tqS` do Ronco (`dsp.ts:589`) é mantido e o governador é acertado com ele; teste de degraus do passo 5 em todos os presets |
| **Lavagem de zona única** no 2T dá `p_max` fora da janela | Ajuste de IPC/EVC em ±5° (4.1), nunca da CR nem do combustível |
| **Knock determinístico vira zumbido metálico** (ressonadores estreitos batidos 100–240 vezes por segundo) | Q ≤ 6 nos ressonadores de bloco, 30% de ruído modulado, dispersão ±5% por cilindro; medir curtose (6–14) e fração periódica da banda 1–4 kHz (0,5–0,8, não 1,0) |
| **Chiado do turbo contínuo vira "mar"** | Modulação pela admissão (±15%), nível ∝ pressão (some ao tirar o pé), apito só até 16 kHz; critério de `REVISAO-DE-SOM.md`: desvio/média da envoltória de 4–16 kHz > 0,25 |
| **Gravações de referência vindas de vídeo privado** (locomotivas, Cummins, Cat, gerador) | Servem para acertar; a tabela pública usa só Commons (Bedia, Detroit62, Gillig, Passat TDI, Class 802, Kiha E120). Antes de usar um trecho, varrer a linha do tempo (Apêndice A) e descartar trechos com fala, vento ou celular se afastando |
| **Rotação errada por um fator 2** ao ler gravações (volta × ciclo × ignição) | O pente harmônico foi restrito à faixa plausível de rpm de cada motor e conferido pela envoltória do knock; onde discordaram (gerador, Cat C15) a rotação ficou marcada como "não confirmada" |
| **Portador carro com 40 t e 12–18 marchas** no `CarroLegado` (embreagem automática, modos do automático acertados para carros) | Caminhões com `transmission 'auto'`, `shiftTime` 0,8–1,2 s e `driveMode 'eco'`; conferir arrancadas carregadas (passo 11); se a embreagem patinar demais, `Tmax` real (2400–2500 N·m) resolve, não o ganho |

---

## Apêndice A. Medidas das gravações

Método (como `TECNICO.md` → Validação): WAV mono 48 kHz, Welch com 8192 pontos, bandas em dB relativas a 150–400 Hz, centroide de 100–8000 Hz. Acrescentado para o diesel: banda 1–4 kHz relativa (knock), envoltória de Hilbert da banda 1–4 kHz com passa-baixa de 500 Hz (frequência dominante = taxa de ignição; p90/p10; tiques por ciclo pelo detector de 2.7), curtose da banda 1–4 kHz, rotação por pente harmônico (Welch de 32768 pontos branqueado pela mediana local, restrito à faixa plausível do motor). Scripts em `/tmp/claude-1000/-home-ezenere-Documents-Projects-Engine/e31418c8-04d3-4470-8423-a94efb88e841/scratchpad/dieseltools/` (`scan.py`, `analyze2.py`, `notches.py`, `ticks.py`), a portar para `tools/diesel-bandas.ts` no passo 3. Arquivos em `…/scratchpad/real2/diesel-picape/wav/` e `…/diesel-pesado/wav/` (índice em `…/real2/INDEX.md`). Nenhum trecho foi ouvido: a escolha veio da varredura em janelas de 4 s (nível estável, mesma taxa de ignição, sem silêncio). Posição do microfone deduzida do título e do espectro.

| Trecho (arquivo, s) | rpm (como) | f_ign (Hz) | 60–150 | 400–1k | 1–2,5k | 2,5–6k | 6–12k | centroide | 1–4k | curtose | p90/p10 | tiques/ciclo | microfone |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Hilux 3.0 1KD-FTV, lenta (`yt_ndjyyOz-GII`, 16–28) | 792 (envoltória 26,4 Hz) | 26,4 | +0,6 | −2,2 | −2,2 | −6,2 | −8,3 | 1029 | −1,5 | 9,2 | 16,5 | 11,5 | capô aberto |
| idem, logo após a partida (4–12) | 760 | 25,3 | +5,2 | −5,7 | −6,4 | −14,7 | −21,0 | 455 | −6,0 | 12,4 | 13,1 | 17 | mais longe |
| idem, aceleradas em neutro (28–44) | 950–2000 | — | +1,1 | −1,8 | −1,6 | −6,3 | −8,4 | 993 | −1,0 | 7,2 | 12,5 | — | capô aberto |
| Hilux 2.8 1GD-FTV 2016, lenta (`yt_o5qV3pZdTaI`, 24–36) | 858 (28,6 Hz) | 28,6 | +8,1 | +4,6 | **+10,9** | −0,1 | −6,4 | 1458 | +11,1 | 6,7 | 15,5 | 12,4 | capô aberto, perto do motor |
| Cummins 6.7 I6, lenta fria a −23 °C (`yt_PNtO2J6rlqg`, 64–84) | 1000 (50,0 Hz) | 50,0 | +9,5 | −7,1 | −8,1 | −16,2 | −22,0 | 270 | −7,9 | 13,9 | 13,4 | 13,0 | exterior, alguns metros |
| Cummins 5.9 12v P7100, lenta fria (`yt_BmIsBFKPjFo`, 52–64) | ≈ 700 (35,2 Hz) | 35,2 | −0,1 | −1,1 | −18,2 | −25,8 | −37,5 | 371 | −17,7 | 12,8 | 19,7 | 8,0 | perto, codec/celular saturando? |
| Ranger 3.2 I5, lenta (`yt_NDHB-iITOwo`, 0–28) | não confirmada (envoltória 7,8 Hz = ciclo?) | — | −5,1 | +0,2 | −9,0 | −14,8 | −20,2 | 549 | −8,3 | 36 | 19,9 | 7,5 | exterior |
| Ranger 3.2 escape livre, em carga (`yt_TAFrWYMds_U`, 0–8) | — | — | +10,6 | −10,1 | −21,0 | −27,5 | −35,7 | 140 | −20,2 | 3,7 | 9,5 | — | atrás do escape |
| Passat 1.9 TDI, lenta (Commons, 0–4) | ≈ 1070 (35,8 Hz) | 35,8 | +3,0 | −7,7 | −10,2 | −14,5 | −26,8 | 280 | −9,0 | 5,5 | 12,6 | 12,5 | lado do escape |
| Cat C15, lenta (`yt_yG9_W1Zg0ZA`, 4–44) | ≈ 660 (pente; não confirmada) | ≈ 33 | −0,2 | +0,6 | −2,6 | −17,8 | −25,2 | 617 | −2,5 | 7,5 | 15,9 | 18,2 | ao lado do motor |
| Caminhão pesado, lenta (`yt_hAmi9QxRIB4`, 8–28) | ≈ 590 (29,4 Hz) | 29,4 | +13,6 | −8,1 | −22,5 | −25,8 | −39,1 | 125 | −21,0 | 3,7 | 9,6 | 24 | atrás do escape |
| Ônibus urbano I6, lenta (`yt_Wumu8Dj4olg`, 8–52) | 620 (31,0 Hz) | 31,0 | −4,4 | +5,0 | −2,4 | −5,1 | −11,7 | 902 | −1,2 | 3,6 | 8,5 | 24 | exterior, de lado |
| Locomotiva em lenta, Bedia (Commons `WWS_Bediadiesellocomotiveidling`, 8–56) | 610 se I6 4T (30,5 Hz) | 30,5 | +1,6 | −0,8 | −3,3 | −9,8 | −15,2 | 718 | −2,8 | 4,1 | 10,0 | 25 | plataforma |
| Gerador Cummins 500 kVA (`yt_LqpQZd9XxJM`, 28–52) | 1500 ou 1800 (não confirmada) | 75–90 | −10,8 | −1,7 | −4,8 | −3,7 | −10,7 | 1317 | −2,0 | 7,8 | 14,4 | ≈ 7 | celular (grave cortado), ao lado |
| Detroit 6V92 2T, lenta fria (`yt_6NXqQdr9phE`, 44–64) | ≈ 480–600 | 48–60 | −2,3 | −10,4 | −9,4 | −18,1 | −28,0 | 431 | −8,9 | 8,8 | **34,9** | 10 | exterior; motor falhando (frio) |
| Detroit 6-71 2T (Commons `Detroit62`, 0–9,5) | não confirmada (81,8 Hz = 818 rpm?) | — | +4,1 | +0,8 | −0,4 | −21,6 | (codec) | 578 | −0,4 | 38 | 29,4 | — | perto; OGG com corte em ~6 kHz |
| EMD SD70ACe 710, lenta (`yt_iw1CU713ki4`, 0–12) | ≈ 250 (pente; nominal 269) | ≈ 67 | +8,2 | +3,1 | −6,8 | −6,0 | −13,5 | 671 | −4,0 | 3,8 | 6,9 | 33 | beira da via |
| idem, notch 8 (60–68) | 904–917 (pente) | 241 | +2,7 | +2,5 | −4,2 | −4,0 | −10,5 | 840 | −2,4 | 3,4 | 8,4 | 13 | idem |
| GE 7FDL-16, lenta (`yt_TtXb3GDLkjE`, 0–16) | 437–478 (pente; nominal 440) | 58–64 | +13,0 | −1,7 | −11,0 | −19,5 | −28 | 400 | −12,2 | 4,4 | 7,9 | 39 | beira da via |
| idem, notch 8 (20–32) | não confirmada (nominal 1050) | 140 | +15,8 | −0,7 | −7,6 | −13,5 | −23 | 300 | −6,4 | 3,1 | 7,4 | 17 | idem |

Forma dos tiques (banda 0,8–8 kHz, média alinhada ao pico, ±6 ms; contraste tique-fundo por terço de oitava de 800 Hz a 8 kHz):

| Trecho | tiques/s | subida | −3 dB | −6 dB | contraste máximo (terços) | centroide do tique |
|---|---|---|---|---|---|---|
| Hilux 2.8 1GD lenta | 76 | 1,1 ms | 0,4 ms | 1,0 ms | +4,4 dB em 1250–1600 Hz | 1644 Hz |
| Hilux 3.0 1KD lenta | 77 | — | — | — | +4,4 em 1250–1600 | 2296 |
| Cummins 6.7 lenta fria | 91 | 0,6 | 0,3 | 0,5 | +5,8 em 1000–1250 | 1659 |
| Cummins 12v lenta fria | 58 | — | — | — | +3,9 em 1000–1250 | 1499 |
| Cat C15 lenta | 77 | 0,6 | 0,4 | 0,6 | +4,0 em 1000–1250 | 1401 |
| Ônibus I6 lenta | 102 | — | — | — | +4,3 em 800–1250 | 1646 |
| Locomotiva Bedia lenta | 105 | — | — | — | +4,3 em 1000–1250 | 1695 |
| EMD 710 lenta | 114 | — | 0,2 | — | +3,3 em 800–1000 | 2366 |
| GE 7FDL16 lenta | 96 | 1,7 | 0,3 | 1,5 | +4,3 em 800–1000 | 1383 |
| Detroit 6V92 lenta fria | 69 | — | — | — | +4,4 em 1600–2000 | 1846 |

Leitura para o modelo: o tique diesel vive em 1–2,5 kHz (centroide 1,4–2,3 kHz), dura ~1 ms a −6 dB e repete-se 2–4 vezes por evento de combustão nos leves; nos pesados os eventos são tão densos (100–115 tiques/s) que a envoltória quase não cai entre eles (p90/p10 7–10 dB contra 13–17 nos leves): o pesado em lenta soa "liso e cheio", a picape "picotada". É isso que a tabela de alvos de 2.6 codifica.
