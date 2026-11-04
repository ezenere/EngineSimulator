# Rotativos: projeto da etapa 4

Documento de projeto da etapa 4 (ver `PLANO.md`). Define como o motor Wankel estende o `EngineDSP` do Ronco sem mudar o som a gasolina (câmara trocoidal em vez de cilindro, janelas em vez de válvulas, 3 câmaras por rotor, ciclo de 1 080° do eixo excêntrico), o escape dos rotativos (pré-silencioso, turbo sequencial, megafone do 787B, lateral × periférico), os alvos medidos nas gravações, o X-Engine da LiquidPiston e o motor de palhetas (ambos marcados **aproximação**), os presets com ficha, a página `rotativo.html` e o plano de implementação com medidas. A implementação segue este texto à letra; o que estiver marcado **decisão** não se renegocia dentro da etapa sem anotar no relatório. Unidades: SI; **ângulos em graus do eixo excêntrico** (°e), contados como no `dsp.ts` (0° = PMS de ignição da câmara; ciclo da câmara de 1 080°e no Wankel, 720° no X-Engine). As linhas citadas (`dsp.ts:NNN`) são as de `src/engines/ronco/dsp.ts` no commit `d313d2f`.

- [0. Decisões](#0-decisões)
- [1. Wankel como extensão do modelo de cilindro](#1-wankel-como-extensão-do-modelo-de-cilindro)
- [2. Escape Wankel](#2-escape-wankel)
- [3. Alvos numéricos medidos nas gravações](#3-alvos-numéricos-medidos-nas-gravações)
- [4. X-Engine (LiquidPiston), aproximação](#4-x-engine-liquidpiston-aproximação)
- [5. Palhetas rotativas](#5-palhetas-rotativas)
- [6. Presets](#6-presets)
- [7. Interface da página `rotativo.html`](#7-interface-da-página-rotativohtml)
- [8. Plano de implementação e verificação](#8-plano-de-implementação-e-verificação)
- [Apêndice A. Medidas das gravações](#apêndice-a-medidas-das-gravações)
- [Apêndice B. Geometria conferida](#apêndice-b-geometria-conferida)

---

## 0. Decisões

1. **Subclasse, não cópia** (o padrão de `DIESEL.md` seção 1 e `RADIAL.md` 1.6). `RotativoDSP extends EngineDSP` em `src/engines/rotativo/dsp.ts`. O `EngineDSP` ganha uma flag neutra `this.rot = false` no construtor e ramos `if (this.rot)` nos pontos da tabela 1.6; com `rot = false` nenhuma operação aritmética muda, e `npm run paridade:ronco` (200 cenários) é o portão de cada commit que toca `dsp.ts`. **Terceiro na fila do `dsp.ts`**: os ganchos do rotativo só entram depois de os do Diesel (`cc`, `tempos`, `cyc`) e os do Radial (`av`, `radial`, `carga`) estarem na branch. Um só arquivo-base, uma pessoa por vez. O rotativo **depende de `cyc`** (o ciclo da câmara em graus, que o Diesel introduz para o 2T com 360): aqui `cyc = 1080`.
2. **Câmara = "cilindro" do modelo.** Cada câmara do Wankel é um volume de controle do laço do Ronco: `N = 3·rotores` câmaras, cada uma com o próprio `fire[c]`, pressão, massa, Wiebe e janelas. O que muda é a função volume (1.1), o perfil de área das janelas (1.3), as fases (1.2) e o fato de as 3 câmaras de um rotor **compartilharem** a mesma janela e o mesmo tubo primário de escape (1.3).
3. **Geometria pela fórmula do Wankel**, não por cilindrada nominal: `V_cam = 3√3·e·R·b` (13B: 654,5 cm³), `V(α) = V_min + (V_cam/2)·(1 − cos(2α/3))`, `V_min = V_cam/(CR − 1)`. O `displacement` do preset continua sendo a cilindrada **nominal** da Mazda (1,308 L no 13B: uma câmara por rotor), usada só onde o Ronco usa cilindrada para escalar dinâmica e atrito; o volume termodinâmico vem de `(R, e, b)`.
4. **Janelas em vez de válvulas**: área em trapézio (rampa linear com a passagem do ápice, patamar, rampa), sem perfil senoidal, sem cliques de tucho; eventos em °e das tabelas de 1.3 por tipo de janela (lateral 4/6 janelas, "street", "bridge", periférica; escape periférico ou lateral). O escape periférico abre a 75°e antes do PMI com a câmara ainda a 3–5 bar: é o "brap".
5. **Combustão longa em °e**: duração da Wiebe `1,5·kVelas·(42 + 26·rf)·slowB` (1,5 porque um curso do Wankel dura 270°e, não 180°; `kVelas` 1,15 com duas velas, 1,35 com uma, 1,05 com três). A queima tardia e a câmara alongada dão o gás de escape a 900–1 000 °C em carga (a parede do coletor segue `tBurn` próprio, 1.4), e uma fração `fHC` do calor (4–8% em lenta, 1–2% em plena carga) **não** é liberada na câmara: vai para o escape como pós-queima distribuída e, na desaceleração, como estouros (1.4).
6. **Vibração**: rotor balanceado por contrapesos: o termo de inércia alternativa do `vib` **não** entra; sobra a ordem 1 residual (0,1 do termo do Ronco) e a oscilação do torque (ordem = número de rotores), que no monorrotor é o que se sente.
7. **Escape montado pelo `buildExhaust` da subclasse**, inteiro: topologias `serie` (coletor → turbo → catalisador → pré-silencioso → abafador → 1 ou 2 saídas), `megafone` (787B: primários individuais → coletor → megafone), `2em1` (Norton, aviação), `duplo` (Ro80, Cosmo 110S), `reator` (RX-3: reator térmico). O **pré-silencioso** é `DoisPortasRotativo extends TwoPort` em `src/engines/rotativo/escape.ts` (nada em `src/acoustics/`). Um tubo primário por **rotor**, não por câmara.
8. **Turbo sequencial do 13B-REW e 20B** feito no `control()` da subclasse (`super.control` + a troca do secundário em 4 500 rpm, com a queda de 0,1–0,2 bar por 0,2–0,4 s), sem gancho na base.
9. **Lenta irregular das janelas de competição** (bridge, periférica) não é ruído sorteado: vem da sobreposição de 90–140°e (gás de escape volta para a admissão e mistura fresca vai para o escape), com `misfire` e `fHC` crescendo com a sobreposição e com o vácuo. Alvo medido no 787B: 1 600–2 200 rpm com vagar de 25–35% e 3,5–16 estalos/s (3.3).
10. **X-Engine e palhetas são aproximações declaradas**: o X-Engine reusa a `RotativoDSP` com volume senoidal puro, `cyc = 720`, 3 câmaras fixas a 240° e as janelas da documentação pública (sem gravação de referência); o motor de palhetas **não** é o ciclo termodinâmico: é um sintetizador próprio (`PalhetasDSP`, passagem de palheta + jato de expansão, 5.3), com carga e rotação próprias. Os dois ficam na página Rotativos com a etiqueta "aproximação" no painel.
11. **Fontes para a Cena**: as do Ronco (`escape.k`, `admissao`, `bloco`, `compressor`, `alivio`); no `bloco` vão as vedações de ápice, a engrenagem fixa e a bomba de óleo. Nível absoluto (`nivelEscape`, dB re 1 pW) nos presets de aviação, UAV e gerador; a calibração relativa do Ronco (`calibrate()` sobrescrito, plena carga a 55% de `rpmMax`, lenta 21 dB abaixo) vale para os carros e a moto.
12. **Validação por gravações** (Apêndice A): bandas em dB relativas a 150–400 Hz, centroide, linhas de ordem **do eixo** (1/3, 2/3, 1, ignição, 2·ignição), vagar, `CVciclo`, contraste do agudo (p90/p10) e estalos/s. Tabela pública de `TECNICO.md` só com as duas gravações do Wikimedia Commons (RX-7 `4z0y1H2REvE`, RX-8 `u-Lc2Nt3OR8`); as do YouTube (787B, Ro80, Norton, RX-8 modificados) são alvo interno.
13. **Correções ao enunciado conferidas**: (a) o RotorWay RI 162 **não** é Wankel (é um 4 cilindros plano de 162 pol³): no lugar entram o Austro Engine AE50R (monorrotor, Camcopter S-100, portador rotor) e o UEL AR741 (monorrotor, RQ-7 Shadow, portador hélice), que são os Wankel de helicóptero/UAV em uso real; (b) a geometria publicada do X-Engine é a **inversa** da frase do enunciado: rotor de **2** lobos (epitrocoide, "amendoim") girando num alojamento de **3** lobos, com os selos de ápice fixos no alojamento (4.1); (c) a partida a ar dos radiais (`RADIAL.md` 3.4) injeta ar nos cilindros, não é motor de palhetas: o motor de palhetas entra como ferramenta pneumática e como motor de arranque a ar de diesel pesado e turbinas industriais (5.1).

---

## 1. Wankel como extensão do modelo de cilindro

### 1.1 Geometria: câmara trocoidal e volume por ângulo

Alojamento = epitrocoide de 2 lobos gerada pelo raio gerador `R` e pela excentricidade `e`; rotor = envoltória interna de 3 flancos; largura `b`. O rotor gira a **1/3** da rotação do eixo excêntrico (engrenagem fixa : coroa do rotor = 2 : 3). Cada flanco forma com o alojamento uma câmara cujo volume, em função do ângulo do eixo `α` (0 = PMS de ignição dessa câmara):

$$V(\alpha) = V_{min} + \frac{V_{cam}}{2}\left(1 - \cos\frac{2\alpha}{3}\right), \qquad V_{cam} = 3\sqrt{3}\,e\,R\,b, \qquad V_{min} = \frac{V_{cam}}{CR-1}$$

$$\frac{dV}{d\alpha} = \frac{V_{cam}}{3}\sin\frac{2\alpha}{3} \ \ (\text{por rad})$$

A forma é a clássica (Yamamoto): com a envoltória ideal o volume da câmara é exatamente cossenoidal em `2α/3`; o rebaixo do flanco (recess) e as vedações só somam uma constante a `V_min`, que o `CR` do preset absorve. Período de `cos(2α/3)`: 540°e (um PMS → PMI → PMS); o ciclo de 4 tempos de uma câmara dura **1 080°e** (cada curso 270°e). O torque no eixo é `(p − p₀)·dV/dα` (`dsp.ts:1012` com `Ap·dxdth = dV/dθ`).

| Motor | R (mm) | e (mm) | b (mm) | `V_cam` (cm³) | ficha | K = R/e |
|---|---|---|---|---|---|---|
| Mazda 10A (Cosmo 110S) | 105 | 15 | 60 | 490,7 | 491 | 7,0 |
| Mazda 12A (RX-3) | 105 | 15 | 70 | 572,5 | 573 | 7,0 |
| Mazda 13B (RX-7, REW), 13B-MSP (Renesis), 20B, R26B | 105 | 15 | 80 | 654,3 | 654 | 7,0 |
| NSU KKM 612 (Ro80) | 100 | 14 | ≈ 68,4 (ajustado) | 497,5 | 497,5 | 7,1 |
| Norton / MidWest / Austro AE50R (origem Sachs KM 914) | ≈ 70 | ≈ 10,5 | ≈ 77 (ajustado) | 294 | 294 | 6,7 |
| UEL AR741 | ≈ 62 | ≈ 9,3 | ≈ 70 (ajustado) | 208 | 208 | 6,7 |

"Ajustado" = `b` escolhido para fechar a cilindrada da ficha com `R` e `e` da classe; só `V_cam` e `CR` entram no som. Diâmetro equivalente para as fórmulas de área do Ronco (`Ar`, `hw`, `Aleak`, `AexMax`): `boreEq = ∛(4·V_cam/π)` (13B: 94 mm; um cilindro de 654 cm³ com curso = diâmetro), em vez de `∛(4·displacement/N/π)`.

Comparação com o cilindro do Ronco, mesma cilindrada nominal (1,3 L, 2 eventos por volta): o 13B tem **2 câmaras de 654 cm³ queimando por volta**; um 4 cilindros de 1,3 L tem 4 cilindros de 327 cm³, também 2 por volta. Cada evento do Wankel move o dobro de gás e dura 1,5× mais em graus (curso de 270°e): `dV/dα` máximo = `V_cam/3` = 218 cm³/rad contra ≈ 180 cm³/rad (327 cm³·0,55) do cilindro. É isto, mais a abertura brusca da janela, que faz o Wankel soar "maior" que a cilindrada.

### 1.2 Câmaras, rotores e fases

- `N = 3·rotores` câmaras; câmara `c` pertence ao rotor `r = ⌊c/3⌋` e ao flanco `k = c mod 3`.
- `fire[c] = φ_r + 360·k` (°e): as 3 câmaras de um rotor disparam a 360°e uma da outra (uma por volta do eixo). Fases dos rotores `φ_r`: 2 rotores 0/180; 3 rotores (20B) 0/120/240; 4 rotores (R26B) 0/90/180/270; 1 rotor (AE50R, AR741) só 0.
- **Eventos por volta = rotores**. Frequência de ignição `f_ign = rotores·rpm/60`: igual à de um 4T com `2·rotores` cilindros (13B ≙ 4 cilindros; R26B ≙ V8). O que o 4T não tem: a **ordem 1** do eixo (cada rotor queima uma vez por volta: rotores desiguais fazem a linha `rpm/60`), e as **ordens 1/3 e 2/3** (cada flanco queima uma vez a cada 3 voltas: flancos e vedações desiguais fazem linhas em `rpm/180` e `rpm/90` e as bandas laterais 4/3, 5/3…). O 4T tem a meia-ordem (`rpm/120`, cada cilindro a cada 2 voltas) e o Wankel **não** tem meia-ordem. Medido (3.2): no RX-8 a 5 000 rpm as linhas 2/3 e 5/3 estão a +10 e +11 dB sobre a mediana (a ignição a +27); no 787B a bordo a linha 1/3 (42,5 Hz) aparece a +7 dB.
- `theta` e `a = (theta − fire[c]) mod cyc` com `cyc = 1080`: todos os `720`/`360`/`540`/`180` do laço viram `cyc`, `cyc/2`, `cyc/2`, `cyc/4` (tabela 1.6, itens 3–4), como o Diesel já faz para o 2T.
- Dispersão por câmara: a do Ronco (`setConfig` 200–208: ar ±7%, área ±10%, energia ±5%) **vale por flanco**, e a subclasse acrescenta um fator por rotor (±4% em `cylQ`, ±6% em `cylEx`) para a ordem 1 sair 8–15 dB abaixo da ignição, como medido (3.2). O carburador (`fuel 'carb'`) multiplica por 2,6 como no Ronco.
- `tdcRel` não tem sentido físico aqui (não há massa alternativa); recebe `fire` e só a telemetria o usa.

### 1.3 Janelas em vez de válvulas

**O que muda de verdade.** Uma válvula de prato abre com velocidade zero (a rampa do came) e a área cresce como `sen²` até saturar; a janela periférica é descoberta pela vedação de ápice ao passar pela borda: a área cresce **linearmente desde o primeiro grau**, com inclinação `b_j·v_ap` (altura da janela × avanço do ápice por grau, ≈ 0,6 mm/°e no 13B: `R·π/180/3`), chega ao máximo em 40–70°e, fica no patamar enquanto a câmara está diante da janela e fecha pela mesma rampa. Na abertura do escape periférico (75°e antes do PMI, câmara a 3–5 bar em carga, 1,5–2,5 bar em lenta) o jato é sônico desde o início: o `turb` de `dsp.ts:969–979` (`M³·vazão`) dispara forte e curto a cada evento, e o pulso no primário tem frente íngreme. A janela lateral (admissão dos Mazda; escape do Renesis) é descoberta pela face lateral do rotor, com rampa mais longa (80–110°e) e sem o salto inicial: menos agudo, menos "brap".

**Perfil de área** (substitui `min(1, 2,5·sen²)` do escape e `min(1, 1,5·sen²)` da admissão, `dsp.ts:959` e `993`):

```
u = (a − abre)/(fecha − abre)          // 0..1 dentro da janela
A(a) = Amax · min(1, u/r_a, (1 − u)/r_f)   // trapézio: rampa de abertura r_a, de fechamento r_f (frações da duração)
```

| Janela | `r_a` | `r_f` | `Amax` por câmara (13B) | Observação |
|---|---|---|---|---|
| escape periférico | 0,12 (≈ 47°e) | 0,15 | 15 cm² (`0,17·boreEq²`) | a rampa de abertura corresponde a 40 mm de janela a 0,6 mm/°e; o `exhaustFlow` implícito e o `revCd` 0,15 ficam |
| escape lateral (Renesis, 2 janelas por rotor) | 0,25 (≈ 80°e) | 0,2 | 2 × 7 cm² | área total parecida, rampa 2× mais lenta |
| admissão lateral primária | 0,25 | 0,2 | 9 cm² (`0,10·boreEq²`) | sempre aberta |
| admissão lateral secundária / auxiliar | 0,25 | 0,2 | +6 cm² / +5 cm² | abre por borboleta no coletor (13B-REW e Renesis: secundária acima de 3 750 rpm; auxiliar do Renesis 6 janelas acima de 6 250): `AinMax(rpm)` em degrau alisado de 300 rpm |
| admissão "street" / "bridge" / periférica | 0,2 / 0,15 / 0,1 | 0,2 | 11 / 14 / 18 cm² | competição |

**Eventos** em °e após o PMS de ignição da câmara (PMI em 270, PMS de escape/admissão em 540, PMI de admissão em 810). Valores de catálogo onde públicos ("≈" estimados pela classe):

| Tipo (`janelas.admissao` / `janelas.escape`) | EO | EC | IO | IC | sobreposição EC − IO | lenta (rpm) | exemplo |
|---|---|---|---|---|---|---|---|
| lateral 4 janelas / periférico | 195 (75° BBDC) | 588 (48° ATDC) | 572 (32° ATDC) | 850 prim. (40° ABDC), 860 sec. | **16°e** | 750 | 10A, 12A, 13B, 13B-REW, 20B, Ro80, Cosmo 110S |
| lateral 6 janelas / **lateral** (Renesis) | ≈ 220 (50° BBDC) | ≈ 537 (3° BTDC) | ≈ 543 (3° ATDC) | 850 / 875 / ≈ 895 | **−6°e** (nenhuma) | 750 | 13B-MSP 6 e 4 janelas |
| "street port" / periférico | 195 | 588 | ≈ 560 | ≈ 870 | ≈ 28°e | 900–1 100 | RX-7 modificados |
| "bridge port" / periférico | 195 | 588 | ≈ 490 (50° BTDC) | ≈ 880 | ≈ 100°e | 1 500–2 000 | competição, drift |
| periférica / periférico | 195 | 588 | ≈ 460 (80° BTDC) | ≈ 890 | ≈ 130°e | 1 800–2 200 | R26B (787B), 13B PP de corrida |
| periférica (Sachs) / periférico | ≈ 200 | ≈ 580 | ≈ 540 | ≈ 870 | ≈ 40°e | 1 200 (ficha); medido 1 850–1 950 aquecendo | Norton, MidWest, AE50R, AR741 (**a conferir**) |

A janela de escape periférica de um rotor fica aberta **393°e por câmara** (195 → 588) e as câmaras se sucedem a 360°e: entre 555 e 588°e da câmara anterior a janela está aberta para **duas câmaras** ao mesmo tempo (o ápice passa sobre a janela). Consequências para o modelo:

- **Um tubo primário por rotor** (`runners[c] = run[rotor(c)]`): as 3 câmaras injetam no mesmo `Line`. Como `dsp.ts:985` **atribui** `run.out0`, com tubo compartilhado a segunda câmara apagaria a primeira; o ramo `rot` zera `run.out0 = 0,985·run.in0` uma vez por rotor antes do laço de câmaras e **acumula** `+= Zr·mEx·(dens + turb·hiN)` por câmara. A pressão de volta `pb = P0 + 2·run.in0` é a mesma para as duas (uma amostra de atraso no acoplamento entre elas: aceito).
- Não há `ivo` para zerar o ar (`dsp.ts:928`): o ar zera em `IO` da câmara; com sobreposição grande o refluxo de escape para a câmara entra como massa quente (a 1ª lei já faz isso: `mIn < 0` com `hIn = T`).
- Sem válvulas não há cliques de tucho (`dsp.ts:927`): o `clickEnv` recebe só a passagem do ápice pelas bordas das janelas (EO, EC, IO, IC, peso 0,3) e pelos furos das velas (`a` ≈ 0 ± 30°e, peso 0,15): é o tique leve das vedações, 3 por volta do rotor por borda = `rpm/60` por rotor por borda. Em lenta (750 rpm, 2 rotores) são 25 tiques/s de janela + 25 de vela, fundidos num chiado granulado, não em cliques contáveis.

### 1.4 Combustão, gás de escape e pós-queima

- **Velas**: Mazda: duas por rotor, *leading* (L, no lado que vai à frente) e *trailing* (T), com a T disparando 10–15°e depois; NSU e Norton/Sachs: uma; R26B: três. Avanço base em °e BTDC: `adv = −5 + 30·rf` (lenta: L ≈ 5°e **depois** do PMS e T ≈ 20°e depois, para aquecer escape e reator; plena carga L ≈ 25°e antes). No modelo a segunda vela só encurta a queima: `kVelas` = 1,35 (uma), 1,15 (duas), 1,05 (três); velas T desligadas (controle do painel) → 1,35 e `misfire` +2%.
- **Wiebe em °e**: `burn = 1,5·kVelas·(42 + 26·rf)·slowB` (`dsp.ts:834` × fator): 13B em plena carga ≈ 108°e (10–90% ≈ 54°e), em lenta com `slowB` 2,4 ≈ 200°e (10–90% ≈ 100°e, com a queima terminando perto da abertura do escape: é o que faz o Wankel em lenta soar "cru" e quente). A câmara alongada (relação superfície/volume ≈ 2× a de um cilindro) e a corrente de gás que impede a chama de voltar para o lado T são a razão física; o `hwr` (perda de calor) é multiplicado por 1,6 pela mesma razão.
- **Temperatura do gás**: sai do modelo (queima tardia, menos expansão útil, CR 9–10). Valores reais: 13B em plena carga 900–1 000 °C no coletor (pistão: 750–850), lenta 400–500 °C (pistão ≈ 320). A parede do coletor (`dsp.ts:582`, `tBurn`) passa a `min(1 050, 250 + 800·√(rpm/rpmMax)·(p_col/p₀)^0,6)`; o `hot = suavizado(280, 520, exhT)` dos estouros fica quase sempre em 1: o Wankel estoura com qualquer mistura crua. A referência de densidade `T_EXREF` (1 650 K) fica; o gás do Wankel entra a ≈ 1,0–1,1× (calibração repõe).
- **Pós-queima (`fHC`)**: o Wankel emite 3–5× mais HC que um pistão (apagamento da chama nas vedações e nos cantos; a Mazda pôs reatores térmicos no escape dos RX-3/RX-4). Uma fração `fHC = 0,08·idleness·slowB/2,4 + 0,015` do calor (lenta ≈ 8%, plena carga ≈ 1,5%; `×2` com sobreposição > 90°e; `×0,6` com catalisador/reator) é retirada de `Q[c]` (`dsp.ts:887`) e guardada em `hcQ[c]`; na abertura do escape ela entra no primário como fonte de pressão **distribuída**: `run.out0 += Zr·kHC·hcQ[c]·env(t)` com `env` subindo em 2 ms e caindo em 12 ms (não é um estalo: é o "chiado quente" de cada pulso, o que deixa o Wankel em lenta com 1–2,5 kHz 8–12 dB mais forte que um pistão, 3.1). `kHC` acertado na medida do passo 4 (8.1).
- **Estouros na desaceleração**: o mecanismo do Ronco (`pops`, `overrun`) com as taxas da tabela do `TECNICO.md`, mais um termo próprio: com `fHC` alto e janela de escape quente, cada ciclo sem queima tem `pr = 0,04·(1 + sobreposição/60°e)` de estourar (13B de rua com `'burble'`: 4–6/s; periférico 787B: 3,5–7/s medidos; RX-8 modificados: 4–13/s medidos, 3.3). O estouro vai à `bankJ[rotor]`. Na lenta dos periféricos, `misfire` base de 6% com `pr` 0,35 dá os 16 estalos/s medidos no 787B.
- **Consumo de óleo**: a bomba dosadora injeta óleo na admissão (0,3–1 L/1 000 km); não tem som. Fica como indicador no painel (fumaça azul na partida, 1.5 da interface) e como +1% em `fHC` nos primeiros 20 s.

### 1.5 Vedações, mecânica e vibração

- **Vedações de ápice**: tiques (1.3) e uma pequena perda de compressão por ápice gasto (`Aleak` × `desgaste`, 1–3×; o painel tem "vedações: novas / gastas"): com 3× a lenta fria falha mais (+3% `misfire`) e a partida demora mais (a compressão baixa do rotativo gasto é a falha clássica).
- **Engrenagem fixa / coroa do rotor** (relação 2:3; 13B: 34/51 dentes, **a conferir**): a frequência de engrenamento é `34·rpm/60` (7 000 rpm → 3 970 Hz), com carga pequena (só sincroniza o rotor): tom a −40 dB do `mech`, `k^−2` nos harmônicos, no lugar do tom de engrenagem do Ronco (`dsp.ts:1126`, `phW·23`).
- **Bomba de óleo dosadora e bomba d'água**: no `mech` genérico do Ronco; nada novo.
- **Vibração** (`dsp.ts:1015–1017`): `if (this.rot) vib += 0,1·cos(theta·DEG); else vib += (…)·acc`. O rotor é balanceado por contrapesos (força rotativa pura), o par de rotores a 180° se anula: o que sobra é a oscilação do torque (`ripple`, `dsp.ts:1142`, que fica igual) na ordem `rotores`: 2ª ordem no 13B, 1ª no monorrotor (AE50R, AR741: é o que faz o UAV "zumbir"), 4ª no R26B (quase lisa). Dentro do carro o Wankel é famoso pela ausência de vibração: `vib` 10–15 dB abaixo de um 4 cilindros na cabine.

### 1.6 `RotativoDSP extends EngineDSP`: forma e ganchos

```
src/engines/rotativo/
  dsp.ts         RotativoDSP extends EngineDSP: construtor (rot = true, cyc = 1080), tune (super + janelas, velas, kBurn,
                 fHC, AinMax(rpm), J, Tmax), control (super + turbo sequencial + válvulas das janelas), buildExhaust (inteiro, 2),
                 buildFilters (super + filtros do pré-silencioso e do chiado de pós-queima), calibrate / measurePower
                 (RotativoDSP com escape 'serie' de referência, 55% de rpmMax, lenta 21 dB abaixo), telemetry (super + campos),
                 e os métodos chamados pelos ganchos: areaJanela(a, j), mechRot(omega, rf)
  geometria.ts   volumeCamara(R, e, b), montarRotativo(spec) → { N, fire, bank (= rotor), banks (= rotores), runners (1 por rotor),
                 Vcam, Vmin, boreEq, cyc }, tabelas de janelas (1.3) e fases (1.2); X-Engine (4.2)
  escape.ts      DoisPortasRotativo extends TwoPort ('presilencioso', 'reator', 'megafone-boca'); nada em src/acoustics/
  palhetas.ts    PalhetasDSP implements DSPDeAudio (5.3)
  presets.ts     PresetRotativo = PresetRonco & campos de 6.1; 14 Wankel + 2 X + 1 palhetas; FAMILIAS_ROTATIVO
  config.ts      montarConfig/configCalibrada chamando montarRotativo e RotativoDSP (ou PalhetasDSP)
  constantes.ts  geometrias (tabela 1.1), janelas (1.3), reatores, turbos, níveis
  motor.ts       MotorRotativo: adaptador Motor (CENA.md 1.3) sobre RotativoDSP, familia 'rotativo'
src/worklet/processador-rotativo.ts   registrarProcessador('rotativo-engine', (fs) => new RotativoDSP(fs)) e 'palhetas-engine'
src/pages/rotativo/ + rotativo.html  (seção 7)
tools/rotativo-*.ts                  render, lenta, janelas, bandas, cpu (seção 8)
```

Mecanismos, em ordem de preferência, como em `DIESEL.md` 1.1: (1) métodos sobrescritos inteiros (`buildExhaust`, `buildFilters`, `calibrate`, `measurePower`) ou `super` + acréscimo (`tune`, `control`, `telemetry`); (2) ramos `if (this.rot) {…} else { linha original }`; (3) `const` → `let` numa linha original quando o ramo precisa reatribuir (sem mudar a expressão). **Nunca** um ternário novo no caminho gasolina.

**Ganchos no `EngineDSP`** (linhas de `d313d2f`; os números mudam depois dos passos 1 do Diesel e do Radial, o conteúdo não):

| # | Onde (`dsp.ts`) | Gasolina (fica) | Rotativo (`rot`) |
|---|---|---|---|
| 1 | construtor 72 | — | `this.rot = false;` (`cyc` já vem do Diesel: 720/360; a subclasse põe 1080) |
| 2 | `setConfig` 174–186 | `const Vd = (cfg.displacement / N) * 1e-3; const bore = ∛…` | `let Vd = …; let bore = …; if (this.rot) { Vd = cfg.Vcam * 1e-6; bore = Math.cbrt(4 * Vd / Math.PI); }` antes de `this.Vd = Vd`; `Ar`, `hw`, `Aleak`, `CR` (9–10 dentro do `clamp`), `Vc` seguem as linhas originais; `this.Vh = Vd / 2` na subclasse |
| 3 | 203 (`a` inicial), 829 (`aSp`), 852 (`a`), 857–858 (arma/dispara), 945–948 (Wiebe `d`), 1055 (`theta`) | `720`, `360`, `540`, `180` | **já são `cyc`, `cyc/2`, `3cyc/4`, `cyc/4` pelo passo 1 do Diesel**; o rotativo só usa `cyc = 1080`. Se o Diesel ainda não tiver feito a troca, o rotativo a faz do mesmo jeito (gasolina: `cyc = 720`, mesmos doubles) |
| 4 | 834 (`burn`) | `const burn = (42 + 26 * rf) * slowB;` | `let burn = …; if (this.rot) burn *= this.kBurn;` (`kBurn = 1,5·kVelas`) |
| 5 | 837 (`hwr`) | `const hwr = …` | `let hwr = …; if (this.rot) hwr *= 1.6;` |
| 6 | 878 (`misfire`) | `const misfire = …` | `let misfire = …; if (this.rot) misfire = misfire \|\| rng.next() < this.falhaRot;` (sobreposição, velas T desligadas, vedações gastas) |
| 7 | 887 (`Q[c]`) | energia da queima | logo depois: `if (this.rot) { this.hcQ[c] = this.Q[c] * this.fHC(idleness, slowB); this.Q[c] -= this.hcQ[c]; }` |
| 8 | 902 (`pr` da falha) e 909 (`dfco` → estouros) | `pr = 0.015; k = 0.7;` | `if (this.rot) { pr = this.prRot; k = 0.8; }` logo depois (1.4) |
| 9 | 927 (cliques) | 4 eventos de válvula | `if (this.rot) this.clickEnv += this.tiqueRot(a, ap); else { linha original }` |
| 10 | 928 (`air[c] = 0` em `ivo`) | — | igual (o `ivo` da subclasse é o IO da janela): sem gancho |
| 11 | 932–935 (volume) | `const V = Vc + Ap*(…); const dxdth = …` | `let V, dxdth; if (this.rot) { const c23 = Math.cos(th * 2 / 3); V = Vc + this.Vh * (1 - c23); dxdth = this.Vh * (2 / 3) * Math.sin(th * 2 / 3) / Ap; } else { V = Vc + Ap * (r * (1 - cs) + l - q); dxdth = r * sn * (1 + (r * cs) / q); }` (`th` em rad; `q` continua calculado antes, idêntico) |
| 12 | 957–960 (escape) | `sv = sin(…); A = AexMax·cylEx·min(1, 2,5·sv²)` | `if (this.rot) A = this.AexMax * this.cylEx[c] * this.areaJanela(a, 0); else { linhas originais }` |
| 13 | 985 (`run.out0 = …`) | atribuição | `if (this.rot) run.out0 += Zr * mEx * (dens + turb * hiN) + this.posQueima(c); else run.out0 = 0.985 * run.in0 + …`; **antes do laço de câmaras** (depois de `lines[i].read()`, 845): `if (this.rot) for (const run of this.runRot) run.out0 = 0.985 * run.in0;` |
| 14 | 991–993 (admissão) | perfil `min(1, 1,5·sv²)` | `if (this.rot) A = this.AinMaxRpm * this.cylIn[c] * this.areaJanela(a, 1); else { linhas originais }` |
| 15 | 1015–1017 (`vib`) | `vib += (…)·acc` | `if (this.rot) vib += 0.1 * Math.cos(ph); else vib += …` (`ph` calculado igual) |
| 16 | 1126 (tom de engrenagem) | `mech += (sin(phW·23)…)` | `if (this.rot) mech += this.mechRot(omega, rf); else mech += …` |
| 17 | `control` 582 (`tBurn`) | `const tBurn = min(950, 180 + 720·…)` | `let tBurn = …; if (this.rot) tBurn = Math.min(1050, 250 + 800 * …);` |
| 18 | 1161 (turbo `f`) | `500 + 6200·tw` | igual (os Hitachi do FD giram parecido); o sequencial é no `control` da subclasse: sem gancho |
| 19 | `telemetry()` | — | `super.telemetry()` + `rotores, camara (a, V, p da câmara 0), janelas, velas, tEscape, fHC, estouros, boostSec, apv` |

Fora do laço: `calibrate()` e `measurePower()` da subclasse instanciam `RotativoDSP` com escape `serie` de referência (pré-silencioso, abafador `sport`, Ø 2,5", sem turbo sequencial), rotação travada em 55% de `rpmMax` com `boost` parcial como no Ronco, lenta a `idle` do preset ajustando `iacI` até `tqMean = 0`.

**O que muda no `vib`, resumido**: nada de inércia alternativa; ordem 1 residual 0,1; `ripple` igual (ordem `rotores`). **Portão**: `npm run paridade:ronco` idêntico (200 cenários) e `--dist`; `git diff --stat src/engines/ronco/dsp.ts` < 70 linhas; `v16 rev` e `muscle wot` ±3% de tempo.

---

## 2. Escape Wankel

### 2.1 Topologias (`escape.tipo`)

| Tipo | Quem | Montagem (`Line`/`Junction`/`TwoPort`/`Radiator`) |
|---|---|---|
| `serie` | RX-7 FC/FD, RX-8, Cosmo 20B, RX-3 (com `reator`) | 1 primário por rotor (`Lp` 0,25–0,35 m, Ø 50–60, `kNL` 0,6) → `Junction` do coletor (`bankJ`) → [`TwoPort 'turbo'`] → downpipe 0,8–1,2 m Ø 70–85 → [`TwoPort 'cat'` = `'stock'` com `kNL` 0,05 e perda 2 kHz] → **`'presilencioso'`** (2.2) → tubo 1,0–1,5 m → abafador (`muffler` do preset) → 1 ou 2 `Radiator` (`saidas`) |
| `megafone` | 787B R26B, 13B PP de corrida | 4 primários individuais iguais (0,9 m, Ø 60) → `Junction` única → megafone: 3 segmentos de 0,17 m com admitância ×1,6 cada (horn em degraus: o DSP não tem `Line` cônica) → `Radiator` com `fRad` da boca (Ø 120: 1 060 Hz, irradia o médio com eficiência) e `'megafone-boca'` (reflexão −0,6 em vez de −0,93 abaixo de 300 Hz: boca larga perde grave). Saída lateral esquerda (`panL` 0,95) |
| `2em1` | Norton F1/Commander, Mistral, MidWest, AE50R | 2 primários 0,4–0,6 m Ø 38–45 → `Junction` → tubo 0,3 m → abafador (`'sport'` na Norton F1, `'stock'` na Commander e na aviação) → 1 `Radiator`; UAV: `'straight'` curto (o Shadow é famoso pelo barulho) |
| `duplo` | Ro80, Cosmo 110S | 1 primário por rotor (`routing 'dual'` do Ronco com 2 bancadas): dois downpipes 1,5 m Ø 50 → Y (`Junction`) → silencioso dianteiro (`'classic'`) → 1,5 m → silencioso traseiro (`'stock'`) → 1 ou 2 saídas |
| `reator` (modificador de `serie`) | RX-3 12A 1973+, RX-4, RX-5 (REAPS) | reator térmico no lugar do coletor: `TwoPort 'reator'` (câmara de 2 L a 900 °C: −4 dB acima de 800 Hz, reflexão 0,5, `kNL` 0,2 depois) + ar secundário (o `secAir` do Ronco, ligado sempre com motor frio); os estouros ×0,5 (queimam dentro) |

Comprimentos escalados pela velocidade do som do gás como no Ronco (520 m/s fixo; o gás do Wankel é mais quente, ≈ 560 m/s: fica para a limitação conhecida "velocidade do som fixa").

### 2.2 Pré-silencioso ("presilencer")

Os Mazda de rua têm, logo depois do catalisador, um silencioso intermediário grande (RX-7 FD: ~ 0,5 m, Ø 150; RX-8: ~ 0,6 m) cuja função é tirar a energia dos primeiros harmônicos da ignição, que num rotativo são muito fortes (3.2: 2·f_ign a +13–17 dB em lenta, no mesmo nível da fundamental). Sem ele o escape "brapa" (é o que os donos fazem: tiram o pré-silencioso e põem ponteira livre: o TJ Hunt da gravação é um deles). `DoisPortasRotativo('presilencioso')`: câmara de expansão com tubo perfurado e lã: −6 dB em 150–300 Hz (Helmholtz da câmara), −3 dB plano de 300 Hz a 1 kHz, −10 dB acima de 1,5 kHz, reflexão 0,3 (câmara grande: pouca onda de volta), `kNL` 0,1 depois. **Controle do painel**: pré-silencioso ligado/retirado. Alvo medido (3.1): RX-7 original em lenta a 880 rpm, 1–2,5 kHz −11 e 2,5–6 kHz −10,5 dB; o modificado (TJ, 1 730 rpm, mic afastado) −30/−37 com estalos 8–10/s: sem o pré-silencioso o pulso de cada câmara sai inteiro; a diferença entre os dois é o que o controle tem de fazer, medido no `ext` com o mesmo motor.

### 2.3 Turbo sequencial (13B-REW, 20B-REW)

Dois turbos: o primário trabalha sozinho até ≈ 4 500 rpm; o secundário é pré-girado e entra com uma transição de 0,2–0,4 s em que a pressão cai 0,1–0,2 bar (o "soluço" do FD). No `control()` da subclasse, depois de `super.control(dtc)`: `seq = suavizado(4 300, 4 700, rpm)`; `turboW` vale `max(turboW, 0,45)` acima de 2 000 rpm (o primário é pequeno e gira sempre); ao cruzar 4 500 para cima dispara `transT = 0,3 s` em que `boost` multiplica `1 − 0,25·sen(π·t/transT)`; o apito do turbo (`dsp.ts:1161`) ganha a segunda linha `f₂ = 0,8·f` quando `seq > 0,5` (os dois giram em rotações diferentes). Válvula de alívio como no Ronco. Teste: `sweep` do `rx7fd` com `boost(t)` mostrando a queda de 0,1–0,2 bar em 4 500 ± 100 rpm por 0,2–0,4 s.

### 2.4 Periférico × lateral: o que o som ganha e perde

| | 13B (admissão lateral, escape periférico) | Renesis 13B-MSP (lateral / lateral) | Bridge / periférico de competição |
|---|---|---|---|
| sobreposição | 16°e | nenhuma | 100–140°e |
| abertura do escape | 75° BBDC, rampa 47°e: blowdown violento | 50° BBDC, rampa 80°e, 2 janelas | 75° BBDC |
| lenta | 750 rpm estável (vagar 1,5–2,7%) | 750 rpm, mais estável ainda (HC não volta à admissão) | 1 500–2 200 rpm, vagar 25–35%, `misfire` 6%, estalos 3,5–16/s |
| som na lenta | "brap-brap" com 2·f_ign forte, 1–2,5 kHz −11 dB | mais redondo: 1–2,5 kHz esperado 3–5 dB abaixo do 13B (sem gravação de lenta do RX-8 em Commons: alvo interno) | crepitar, falhas, estouros |
| em giro alto | rasgado | mais tonal (RX-8 a 5 000: ignição +27 dB sobre a mediana, espectro plano −8 a −11 de 400 Hz a 6 kHz) | grito do 787B: ignição +25, 2·ign +17–19, 400–2 500 Hz +19–20 dB rel. 150–400 |
| modelo | janela `periferico` | janela `lateral` ×2 | `AinMax` 14–18 cm², IO adiantado, `fHC` ×2, `misfire` base 6% |

---

## 3. Alvos numéricos medidos nas gravações

Método (como `RADIAL.md` 4): WAV mono 48 kHz, Welch 8192, bandas em dB relativas a 150–400 Hz, centroide 100–8 000 Hz; frequência de ignição pela autocorrelação da envoltória (150–4 000 Hz, janelas de 1 s) refinada por pente de 4 harmônicos, **conferida contra a lista de picos tonais** (Welch 32768; onde discordaram está dito); linhas em dB de pico sobre a mediana local nas ordens do eixo 1/3, 2/3, 1 e na ignição (`rotores·rpm/60`), 2× e 3×; `CVciclo`/`CVlento` como no radial; `per` = fração periódica de 1–6 kHz; `p90/p10` da envoltória de 1–6 kHz (contraste do agudo); `pop/s` = transientes isolados > 10 dB sobre a mediana móvel. Scripts em `…/scratchpad/wankeltools/` (`scan.py`, `medir_w.py`, `passagem.py`, `picos.py`, `pops.py`), a portar para `tools/rotativo-bandas.ts`. Nenhum trecho foi ouvido. Tabela completa no Apêndice A.

### 3.1 Bandas (dB rel. 150–400 Hz) e centroide

| Regime (ouvinte ↔ microfone) | 60–150 | 400–1k | 1–2,5k | 2,5–6k | 6–12k | centroide (Hz) | fonte |
|---|---|---|---|---|---|---|---|
| **lenta 2 rotores original, 880 rpm, perto do carro** (`ext` a 3–4 m) | +2 ± 3 | −1 ± 3 | **−11 ± 3** | **−10,5 ± 4** | −16,5 ± 4 | 480–550 | RX-7 Commons 16–20 s |
| **lenta 2 rotores carburado, quente, 1 100 rpm, cofre** (`bay`) | −7,6 | +5,9 | −0,7 | −14 | −5 | 735 | Ro80 (dyYf 18–24) |
| **lenta fria carburada, 1 550–1 650 rpm** (`ext`) | −2 ± 2 | −10 ± 2 | −12 ± 2 | −20 ± 3 | (codec) | 320 ± 40 | Ro80 partida (1JOt 2–5) |
| **lenta 2 rotores modificado (sem pré-silencioso), 1 730 rpm, mic afastado** | −1 ± 2 | −9 ± 2 | −31 ± 2 | −37 ± 3 | −33 | 200–230 | RX-7 TJ Hunt |
| **lenta 2 rotores moto, 1 850–1 950 rpm, 2 m** | +7 … +12 | −2 … −3 | −3 … −6 | −12 … −13 | −24 … −26 | 250–480 | Norton Fx7 10–36 s |
| **lenta 4 rotores periférica, 1 900 rpm irregular, 5 m** | +2 … +5 | −5 … −10 | −11 … −20 | −14 … −18 | −11 … −15 (chiado da câmera) | 230–380 | 787B 6VCl (3 trechos) |
| **5 000 rpm sustentados, 2 rotores Renesis** (`ext`) | −8 | −10 | −11 | −10,5 | −20 | 520 | RX-8 Commons 20–24 s |
| **7 700 rpm em neutro, 4 rotores megafone, 5 m** | −6,5 | **+20** | **+19** | +6,7 | −8 | 930 | 787B 6VCl 89–92 s |
| **passagem a ≈ 340 km/h, 8 200 rpm** (pico) | −6 | +14 | +12 | +8 | +2,5 | 1 500 (pico 1 900) | 787B Hunaudières 29–30,5 s |
| **a bordo, 7 700–8 300 rpm** | −7 | +2 | −6 | −6,5 | −13 | 750 | 787B az39 106–116 s |
| **passagem de rua, 2 rotores Renesis ≈ 3 000 rpm, escape livre** | −3 | +1 | −7 | −13,5 | −27 | 560 | RX-8 nSmU 4–6,5 s |
| **passagem a ≈ 6 500 rpm, Renesis original, 10–15 m** | −21 | −3 | −5 | −14,5 | −26,5 | 630 | RX-8 75q 8–14 s |
| **desaceleração com estouros, Renesis modificado** | −8 | +2 | −10 | −13 | −27 | 500 | RX-8 HkV 60–64 s |
| *referência pistão:* 4 cilindros 1,4 L lenta 1 050 rpm, perto | −16 … −19 | −15 … −16 | **−19 … −20** | **−35 … −40** | −45 … −50 | 203 | Fiat Bravo Commons |
| *referência pistão:* V8 4,7 L lenta 740 rpm, perto | −19 … −22 | −4 … −8 | −21 … −25 | −29 … −30 | −34 | 305–360 | Maserati GranTurismo Commons |

Tolerância de aceitação: ±4 dB por banda, centroide ±30%, nos cenários correspondentes (`idle` a 4 m, `rev` sustentado, `flyby`). **O que separa o Wankel do pistão na lenta, a poucos metros**: 1–2,5 kHz 8–12 dB mais forte (−11 contra −20/−23) e 2,5–6 kHz 15–20 dB mais forte (−10,5 contra −30/−37); centroide 480–550 Hz contra 200–360. É a abertura brusca da janela periférica mais a pós-queima; o modelo tem de dar isso **sem** mexer no ruído de jato da ponteira (que é o mesmo do Ronco): se a diferença não sair do `turb` da janela e do `fHC`, o acerto está errado. Em giro alto o Wankel concentra a energia na própria linha de ignição (500–650 Hz no 787B) e nos dois primeiros harmônicos: 400–2 500 Hz +19–20 dB rel. 150–400, contra +2,7/−5,7 do V8 Maserati acelerando (`TECNICO.md`).

### 3.2 Linhas de ordem

| Regime | linha dominante | outras (dB sobre a mediana) | o que o modelo tem de dar |
|---|---|---|---|
| RX-7 original 880 rpm | ignição 29,3 Hz +19; **3·ign +24**, 2·ign +17 | ordem 1 (14,6 Hz): fora da faixa confiável | harmônicos 1–3 da ignição dentro de 6 dB; **nenhuma meia-ordem** |
| RX-7 modificado 1 730 rpm | 2·ign (115 Hz) +13; ign +10 | 4·, 5·, 7·ign +9 a +14; 3·, 6· fracos | pares acima dos ímpares (dois rotores iguais num coletor comum: ordem 2 = ignição, ordem 4 reforçada) |
| RX-8 5 000 rpm sustentados | ignição 167 Hz **+27** | ordem 1 (86 Hz) +12; **2/3 (57 Hz) +11; 5/3 (145) +10; 4/3 (111) +8**; 2·ign +6; 3·ign +12 | ordem 1 a −15 ± 5 dB da ignição; ordens 1/3·k a −16 a −20 dB (dispersão por flanco de 1.2) |
| RX-8 passagem ≈ 3 000, escape livre | ignição 93,8 Hz +41 | 2·, 3·, 4·, 5·ign +36/+28/+24/+25; **ordens 1,5, 2,5, 3,5, 4,5, 5,5 do eixo** (140, 234, 327, 423, 517 Hz) +13 a +16 | com dois rotores desiguais aparecem as bandas laterais ímpares a −25 dB da ignição |
| 787B 7 700 rpm em neutro | ignição 516 Hz **+25** | ordem 1 (129) +15; ordem 2 (258) +10–11; ordem 3 +8–9; 2·ign (1 032) +19; 2,2·ign +10 | ordem 1 a −10 dB da ignição; 2·ign a −6 |
| 787B a bordo 7 700–8 300 | ignição 530–555 Hz +14–19 | **ordem 1 +13–16, ordem 2 +16–17 (iguais à ignição)**; ordem 1/3 (42,5 Hz) +7; 2·ign +8–11; 3·ign +6–10 | a bordo (estrutura) as ordens 1 e 2 chegam ao nível da ignição |
| 787B passagem Hunaudières | ignição chegando 656 Hz → indo 422 Hz (razão 1,555) | | `M` ≈ 0,28 (≈ 340 km/h) com ≈ 8 200 rpm e θ ≈ 60°/150° nos extremos medidos; `flyby` do portador carro de corrida tem de reproduzir a razão ±5% |
| Norton 1 850–1 950 rpm | ignição 61–67 Hz +16–22 | ordem 1 (31–34 Hz) +9–12; ordem 3 (92–101) +12–16; 2·ign +17–18 | ordem 1 a −8 a −10 dB da ignição (leitura alternativa: ignição em 31 Hz e 925 rpm; descartada porque a ACF da envoltória dá 64,5 Hz no trecho 10–20 s) |
| Ro80 partida a frio 1 540–1 650 | ignição 51,3 Hz +26 | 2·ign +21, 3·ign +17; **ordens 1,5 (76 Hz) +7 e 5,5 (280 Hz) +16**; ordem 1 (25,6) ausente | rotores desiguais do KKM 612: bandas laterais ímpares a −10 a −19 dB |
| *pistão 4 cil. (Bravo)* | 5·ign (174 Hz) +26 | **bandas laterais a ±8,7 Hz** (meia-ordem) +5 a +7 | o que o Wankel não tem |

### 3.3 Estabilidade da lenta, variação e textura da desaceleração

| Regime | vagar da rotação (%, janelas de 1 s) | `CVciclo` | `CVlento` | p90/p10 1–6 kHz (dB) | estalos/s |
|---|---|---|---|---|---|
| lenta original quente (RX-7 880, RX-8) | 1,5–2,7 | 0,20–0,25 | 0,15–0,21 | 7–9 | 0,5–1,3 |
| lenta carburada (Ro80 frio e quente) | 2,2–5,7 | 0,20–0,36 | 0,15–0,20 | 12–13 | 1,3–3,2 |
| lenta de janelas modificadas (TJ 1 730) | 1,5–2,0 | 0,45 | 0,20 | 11–13 | **8–10** |
| lenta periférica de corrida (787B) | 2,7 no trecho mais estável de 10 s; **25–35** em trechos de 12–14 s (1 580–2 200 rpm) | 0,42–0,53 | 0,15–0,37 | 14–29 | **16** (trecho estável), 2–3,5 (caçando) |
| moto 2 rotores aquecendo (Norton) | 0,6 (steady) a 12 (subindo) | 0,20–0,32 | 0,05–0,13 | 9–12 | 0,4–0,8 |
| giro alto sustentado (787B 7 700; RX-8 5 000) | 0,5; 11 (operador) | 0,22; 0,51 | 0,14; 0,47 | 9–11 | 0,5–0,7 |
| desaceleração (787B 98–102 s; RX-8 modificado HkV) | — | 0,32; 0,70 | 0,27; 0,64 | 11; 16 | **3,5–7; 4–13** (altura mediana 11–15 dB) |
| *pistão (Bravo, Maserati) lenta* | 1–3 | 0,19–0,28 | 0,07–0,22 | 8–11 | 0,8–2,2 |

Alvos: lenta original `vagar` 1,5–3%, `CVciclo` 0,20–0,30, estalos ≤ 1,5/s; janelas modificadas `CVciclo` 0,40–0,50 e 6–12 estalos/s; periférica 1 600–2 200 rpm caçando com `vagar` ≥ 20% em 12 s, `CVciclo` ≥ 0,40, 10–16 estalos/s; desaceleração `'burble'` 4–6/s (RX-8 de rua), `'popbang'`/periférico 6–13/s com altura 11–15 dB sobre a mediana móvel. A largura do pulso em 0,5–4 kHz (fração do período acima de metade do pico) **não** separa Wankel de pistão na lenta (0,37–0,54 nos dois): o que separa é o conteúdo acima de 1 kHz (3.1) e as ordens (3.2); não usar a largura como alvo.

---

## 4. X-Engine (LiquidPiston), aproximação

### 4.1 Geometria inversa

No X-Engine o papel das peças se inverte em relação ao Wankel: o **rotor** é a epitrocoide de **2 lobos** ("amendoim") e o **alojamento** tem **3 lobos**, com as três câmaras de combustão fixas no alojamento (vela ou injetor fixos, um por câmara) e os **selos de ápice fixos no alojamento** (lubrificados e sem força centrífuga: é a vantagem anunciada). O enunciado desta etapa diz "rotor de 3 lobos em alojamento de 2": é o contrário do que a LiquidPiston publica; fica registrado. Cinemática: engrenagem 3:2 invertida, o rotor gira a **1/2** da rotação do eixo em sentido contrário; cada câmara fixa vê um lobo passar a cada volta do eixo (uma oscilação de volume por volta), e um ciclo de 4 tempos (admissão e escape pelos canais internos do rotor, que faz o papel de válvula) ocupa **2 voltas do eixo = 720°**: três câmaras a 240° uma da outra, **1,5 eventos por volta do eixo = 3 por volta do rotor**. Em contagem de eventos e fases é um **3 cilindros de 4 tempos**: `cyc = 720`, `N = 3`, `fire = [0, 240, 480]`, volume **senoidal puro** `V(α) = V_min + (V_cam/2)(1 − cos α)` (sem termo de biela), `dV/dα = (V_cam/2)·sen α`.

HEHC (High Efficiency Hybrid Cycle): compressão alta (diesel 18:1), combustão a volume quase constante numa câmara pequena e isolada do alojamento, e **expansão prolongada** (relação de expansão > compressão, pelo fechamento tardio da janela de escape: o gás sai quase à pressão atmosférica, pouco blowdown). No modelo: `CR` do preset (9 no X Mini a gasolina, 18 no XTS-210 diesel: precisa do teto 24 do Diesel, `DIESEL.md` 1.2 item 2), janela de escape abrindo tarde (EO ≈ 170°, só 10° antes do PMI) com rampa 0,2, admissão IO ≈ 350 / IC ≈ 560 (**valores da documentação de patentes, aproximação**). O XTS-210 é diesel: usa a `DieselDSP`? **Decisão**: não; o X diesel entra na `RotativoDSP` com `cc = true` só se a flag do Diesel já estiver na base; senão sai a centelha, com `CR` 18 e aviso "aproximação (ciclo SI)". Consequência sonora da expansão prolongada: pulso de escape fraco e "mastigado" (pressão na abertura ≈ 1,3–1,6 bar), som dominado pela admissão, pela mecânica e pelo gerador acoplado; sem o "brap" do Wankel.

### 4.2 Fichas e usos reais

| | X Mini (`xmini`) | XTS-210 (`xts210`) |
|---|---|---|
| ciclo / combustível | SI, gasolina, carburador | CI (HEHC), diesel / JP-8, injeção direta |
| cilindrada | 70 cm³ (ficha); `V_cam` ≈ 23 cm³ por câmara (3 câmaras) | 210 cm³; `V_cam` 70 cm³ |
| CR | ≈ 9 | 18 |
| potência / rotação | ≈ 2,5–3,7 kW (3,5–5 hp) a 10 000–15 000 rpm (meta de 5 hp) | 19 kW (25 hp) a ≈ 6 000–7 500 rpm (aproximação) |
| massa | ≈ 1,8 kg | ≈ 19 kg o motor; o enunciado traz ~40 kg, que corresponde ao grupo gerador |
| eventos | 1,5 por volta: `f_ign = 1,5·rpm/60` (12 000 rpm → 300 Hz) | idem (6 000 rpm → 150 Hz) |
| vibração | torque de ordem 1,5; rotor balanceado | idem |
| escape | tubo curto Ø 20 + silencioso pequeno (`'stock'`) | tubo 0,5 m Ø 35 + silencioso |
| portadores | bancada, gerador portátil (1–2 kW), ferramenta/kart (conceito) | **gerador** (grupo 10–15 kW com inversor, rotação livre 4 000–7 000 pelo governador isócrono), UAV (protótipos), veículo (protótipos para o exército dos EUA) |
| gravações | nenhuma utilizável; vídeos da LiquidPiston com ruído de bancada | idem |
| marca | **aproximação** | **aproximação** |

Usos reais: geradores portáteis e grupos auxiliares (contratos com o exército dos EUA, DARPA e a USAF para gerador leve a JP-8 e para UAV), protótipos em kart (X Mini), nenhum produto de série até a data deste texto.

---

## 5. Palhetas rotativas

### 5.1 O que existe de verdade

- **Motor pneumático de palhetas**: rotor com 4–8 palhetas deslizantes num estator excêntrico; ar a 6–7 bar expande nas câmaras entre palhetas. É o motor de retífica, parafusadeira de impacto, lixadeira, chave de roda, furadeira de hangar: 4–8 palhetas, **5 000–20 000 rpm livre** (retífica 20 000+, parafusadeira 7 000–10 000, furadeira 2 000–3 000 com redução), 0,2–3 kW. **Motor de arranque a ar de palhetas** (Ingersoll Rand série SS, TDI de palhetas, 6–8 palhetas, 3 000–6 000 rpm no motor, redução 6–12:1 para o pinhão, 5–10 bar): diesel pesado de mineração, marítimo, grupos, turbinas industriais e APUs; é o "uso real" de partida. Na aviação a pistão a partida a ar (M-14P, Sh-14) injeta ar nos cilindros (`RADIAL.md` 3.4) e **não** é motor de palhetas; a ficha "partida" desta página é um motor de palhetas acoplado a um motor hospedeiro (radial ou diesel) pelo pinhão, marcada "aproximação" quanto ao hospedeiro.
- **Motor de combustão de palhetas**: só conceitos e protótipos (patentes desde 1900, "rotary vane engine" de várias startups; nenhum em produção). Entra como um preset "conceito, 6 palhetas" marcado **protótipo**, com o mesmo sintetizador (5.3) e combustão como fonte de pressão por câmara, sem o ciclo termodinâmico do Ronco (não vale o custo de uma `VolumeDSP` para um motor que não existe).

### 5.2 O que se ouve

Tom de **passagem de palheta** `f_p = z·rpm/60` (8 palhetas: 667 Hz a 5 000 rpm, 2 667 Hz a 20 000) com harmônicos (cada câmara abre para a descarga de uma vez: `k^−1,2`, como o Roots de lóbulos retos do Ronco), **chiado do ar expandindo** (ruído largo 1,5–8 kHz, nível ∝ vazão × razão de pressões), ruído da descarga pelo silencioso da ferramenta (passa-baixa 3 kHz, a maior parte do nível a 1 m: 85–95 dB(A) numa retífica), e a dinâmica: solta, a ferramenta vai à rotação livre em 0,3–0,6 s (inércia pequena); sob carga a rotação cai até o torque de parada (`T ∝ (p_in − p_out)·(1 − n/n_livre)`), e o tom desce um terço de oitava ou mais. O motor de arranque: rotação subindo em 1–2 s, carga do motor hospedeiro (compressões: modulação na frequência de ignição do hospedeiro), engate do pinhão (clique) e a descarga ao soltar.

### 5.3 Modelo de síntese (`PalhetasDSP implements DSPDeAudio`)

```
estado: n (rpm), p_in (bar), carga (0..1), z, J (kg·m²), n_livre(p_in)
dinâmica (a cada bloco de controle): T = k_T·(p_in − 1)·(1 − n/n_livre) − T_carga;  dn/dt = T/J
passagem de palheta: fase φ += z·n/60·dt; onda por recorrência de Chebyshev (reuso do trecho do `blower`, dsp.ts:1189–1200)
                     com harmônicos k^−1,2 até 16 kHz; largura de linha ±0,5% (jitter do atrito das palhetas)
jato: ruído branco → bp 2,5 kHz Q 0,7 + bp 6 kHz Q 1,0; nível ∝ vazão·(p_in/p_out)^1,5, vazão ∝ n·(1 − 0,4·carga)
descarga: passa-baixa 3 kHz, modulada em f_p (±30%)
mecânica: atrito das palhetas (ruído 1–3 kHz ∝ n²) e, no arranque, engate (pulso de 20 ms) e a carga do hospedeiro
          modulando n em f_ign do hospedeiro (±3%)
saída: mono → ouvinte do Ronco (ext/int/bay) com a mesma `params`; fonte `bloco` para a Cena
```

Custo: ~ 40 operações por amostra. Fica em `src/engines/rotativo/palhetas.ts`, processador `'palhetas-engine'`, na família "Palhetas (pneumático)" da página Rotativos; tabela motor × portador em 6.3. Alvos (sem gravação de referência no acervo; medir numa retífica real ou em gravação Commons de ferramenta pneumática antes do passo 10): tom de palheta ≥ 15 dB sobre a mediana na rotação livre, descida de ≥ 1/3 de oitava sob carga nominal, nível do jato ≥ do tom em 2,5–6 kHz.

---

## 6. Presets

### 6.1 Campos novos (`PresetRotativo = PresetRonco & {…}`)

| Campo | Tipo / faixa | Significado |
|---|---|---|
| `tipo` | `'wankel' \| 'x' \| 'palhetas'` | motor |
| `rotores` | 1–4 | rotores (fases de 1.2) |
| `geo` | `{ R, e, b }` mm | geometria (1.1); `Vcam` calculado e conferido com `cilindradaCamara` |
| `cilindradaCamara` | cm³ | ficha, para conferir `geo` (erro > 1% → aviso) |
| `cr` | 8–11 (X diesel 18) | taxa de compressão (substitui `compression`) |
| `janelas` | `{ admissao: 'lateral4' \| 'lateral6' \| 'street' \| 'bridge' \| 'periferica' \| 'sachs', escape: 'periferico' \| 'lateral', apv?: number[] }` | 1.3; `apv` = rotações de abertura das janelas secundária/auxiliar |
| `velas` | 1–3, `trailingOn` | 1.4 |
| `rpmMax`, `power`, `torque?`, `J` | rpm, kW, N·m, kg·m² | ficha (`redline` recebe `rpmMax` para o tacômetro e o corte) |
| `turbo?` | `{ sequencial: boolean, boost, trocaRpm? }` | 2.3; `aspiration 'turbo'` e `boost` do Ronco continuam valendo |
| `escape` | `{ tipo: 'serie' \| 'megafone' \| '2em1' \| 'duplo', Lp, presilencioso: boolean, reator?: boolean, cat?: boolean, downpipe?: {L, D}, saidas: {L, D, phi}[] }` | 2.1 |
| `fHCextra?` | 0–0,1 | pós-queima além da fórmula (janelas de competição) |
| `vedacoes?` | `'novas' \| 'gastas'` | 1.5 |
| `nivelEscape?` | dB re 1 pW | aviação, UAV, gerador (decisão 11) |
| `reducao?`, `helice?`, `rotorHeli?` | como `PresetRadial` | portadores hélice e rotor (`carriers/helice.ts`, `rotor.ts`) |
| `portadores` | `('carro' \| 'helice' \| 'rotor' \| 'gerador' \| 'nenhum' \| 'ferramenta')[]` | compatibilidade (6.3) |
| `aproximacao?` | texto | etiqueta no painel ("X-Engine: sem gravação", "palhetas: protótipo") |
| palhetas: `z`, `pIn`, `nLivre`, `J`, `hospedeiro?` | 4–8; bar; rpm; kg·m²; preset radial/diesel | 5.3 |

Campos do Ronco **sem efeito** no rotativo (o painel não mostra): `layout`, `cylinders`, `crank`, `bankAngle`, `order` (decorrem de `rotores`), `cam` (vira o tipo de janela), `header`/`routing`/`pipeLen` (substituídos por `escape`), `valve`, `reso`, `twoStep`, `launchRpm` (exceto `rx7fd`, que tem 2-step em preparações; fica `twoStep 'cut'` opcional). `limiter`, `limiterBand`, `limiterHold`, `overrun`, `cat`, `fuel`, `gears`, `transmission`, `ratios`, `finalDrive`, `mass`, `wheelR`, `drag`, `engine`, `cooling`, `muffler`, `pipeD`, `tipD`, `breakout` continuam **iguais** ao Ronco.

### 6.2 Fichas

Valores de manual onde públicos; "≈" estimados pela classe. `lenta` é a rotação-alvo quente; "medido" o que as gravações deram (Apêndice A). Todos os Wankel com `cooling 'water'` (alojamentos) exceto onde dito; o rotor é arrefecido a óleo (Mazda, NSU) ou pela carga de admissão (Norton/Sachs: "charge-cooled").

| # | Preset (`id`) | Motor · veículo | rotores, `V_cam` (R/e/b) | CR | janelas (adm / esc), velas | lenta / `rpmMax` (rpm) | potência, torque | `J` | aspiração | escape | transmissão · massa · roda | `overrun`, `cat`, corte | portadores |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Mazda RX-7 FD 13B-REW (`rx7fd`) | 1992–2002 | 2 × 654 (105/15/80) | 9,0 | lateral4 / periférico, 2 (T −12°e) | 750 / 8 000 | 206 kW (280 ps) @ 6 500, 314 N·m @ 5 000 | 0,25 | turbo **sequencial** 0,7 bar, troca 4 500 | `serie`: `Lp` 0,30, turbo, cat, **pré-silencioso**, `sport`, Ø 76, 1 saída 3,4 m | 5 m: 3,483/2,015/1,391/1,000/0,806, final 4,100 · 1 300 kg · 0,316 (225/50R16), `drag` 0,37 | `burble`, cat, `fuel` 70/0,07 | carro, nenhum |
| 2 | Mazda RX-7 FC 13B-T (`rx7fc`) | S5 1989–91 | idem | 9,0 | lateral4 / periférico, 2 | 750 / 7 000 | 147 kW (200 hp) @ 6 500, 265 N·m @ 3 500 | 0,25 | turbo único HT-18, 0,5 bar | `serie`: turbo, cat, pré-silencioso, `stock`, Ø 70, 3,2 m | 5 m: 3,483/2,015/1,391/1,000/0,762, final 4,100 · 1 280 kg · 0,31 | `cut`, cat, `fuel` | carro, nenhum |
| 3 | Mazda RX-3 12A (`rx3`) | Savanna 1972–78 | 2 × 573 (105/15/70) | 9,4 | lateral4 / periférico, 2 | 850 / 7 000 | 81 kW (110 hp) @ 7 000 (EUA), 150 N·m @ 4 000 | 0,22 | carb Nikki 4 corpos (`carb`) | `serie` + **`reator`** (REAPS, 1973+) + ar secundário, `classic` + `stock`, Ø 50, 3,6 m | 4 m: 3,683/2,263/1,397/1,000, final 3,900 · 900 kg · 0,30 | `lean`, sem cat, `fuel` 120 a 7 500 (aproximação: o carro só tinha cigarra) | carro, nenhum |
| 4 | Mazda RX-8 Renesis 13B-MSP 6 janelas (`rx8hp`) | 2003–12 (Hi-Power) | 2 × 654 | 10,0 | **lateral6 / lateral** (2 por rotor), 2; `apv` [3 750, 6 250] | 750 / 9 000 | 170 kW (231 hp) @ 8 200, 211 N·m @ 5 500 | 0,22 | NA | `serie`: `Lp` 0,35, cat, pré-silencioso grande, `stock`, Ø 60, **2 saídas** 4,2 m | 6 m: 3,760/2,269/1,645/1,187/1,000/0,843, final 4,444 · 1 390 kg · 0,33 (225/45R18) | `burble`, cat, `fuel` 60/0,05 | carro, nenhum |
| 5 | Mazda RX-8 4 janelas (`rx8std`) | Standard Power | idem | 10,0 | lateral4 / lateral, 2; `apv` [3 750] | 750 / 7 500 | 141 kW (189 hp) @ 7 200, 222 N·m @ 5 000 | 0,22 | NA | idem | 5 m: 3,815/2,260/1,640/1,177/0,832, final 4,444 · 1 340 kg · 0,327 | idem | carro, nenhum |
| 6 | Eunos Cosmo 20B-REW (`cosmo20b`) | 1990–96 | **3** × 654 (fases 0/120/240) | 9,0 | lateral4 / periférico, 2 | 700 / 7 000 | 206 kW (280 ps) @ 6 500, 403 N·m @ 3 000 | 0,38 | turbo sequencial 0,6 bar, troca 4 200 | `serie` duplo (2 downpipes → 2 saídas), turbo, cat, pré-silencioso, `stock`, Ø 70, 3,8 m | auto 4 m (conversor, `shiftTime` 0,5): 2,784/1,545/1,000/0,694 ≈, final 3,909 ≈ · 1 640 kg · 0,32 | `cut`, cat, `throttle` | carro, nenhum |
| 7 | Mazda 787B R26B (`r26b`) | Le Mans 1991 | **4** × 654 (fases 0/90/180/270) | ≈ 10,0 | **periférica** (telescópica de 3 estágios) / periférico, **3** velas | 1 800–2 200 irregular (medido 1 580–2 200) / 9 000 | 522 kW (700 hp) @ 9 000, 608 N·m @ 6 500 | 0,30 | NA | **`megafone`**: 4 × 0,9 m Ø 60 → coletor → megafone 0,5 m, boca Ø 120, saída lateral esquerda | 5 m Porsche ≈ 2,80/1,96/1,53/1,24/1,04, final 3,0 ≈ (340 km/h a 8 500) · 830 kg + piloto · 0,33, `drag` 0,30 | `popbang` (3,5–7/s medidos), sem cat, `fuel` 60/0,05 | carro (de corrida), nenhum |
| 8 | NSU Ro80 KKM 612 (`ro80`) | 1967–77 | 2 × 497,5 (100/14/≈68) | 9,0 | lateral4 / periférico, **1** | 900 (medido 1 100 quente, 1 550–1 650 frio) / 6 500 | 85 kW (115 PS) @ 5 500, 162 N·m @ 4 500 | 0,20 | carb Solex 2 corpos (`carb`) | **`duplo`**: 2 × 1,5 m Ø 50 → Y → `classic` → 1,5 m → `stock`, 1 saída | semiauto 3 m (Saxomat: `auto`, `shiftTime` 0,6) ≈ 2,13/1,21/0,81, final 4,86 ≈ · 1 280 kg · 0,31, dianteiro | `lean`, sem cat, `fuel` 120 a 7 000 (aproximação) | carro, nenhum |
| 9 | Norton F1 / Commander (`norton`) | moto 1988–92 | 2 × 294 (≈70/10,5/77) | ≈ 9,0 | sachs (≈ periférica) / periférico, 1 | 1 200 (medido 1 850–1 950 aquecendo) / 10 000 | F1: 70 kW (95 hp) @ 9 500, 76 N·m; Commander 63 kW @ 9 000 | 0,04 | NA, 2 carb Mikuni 34 (`carb`) | **`2em1`**: 2 × 0,5 m Ø 42 → coletor → `sport` (F1) / `stock` (Commander), 1 saída | 5 m (Yamaha): `moto(70, 192+80, [2,846, 1,947, 1,545, 1,333, 1,153] ≈, 5,0 ≈)` | `lean`, sem cat, `fuel` 60/0,05 | carro (moto), nenhum |
| 10 | Mazda Cosmo 110S 10A (`cosmo110s`) | 1967–72 | 2 × 491 (105/15/60) | 9,4 | lateral4 / periférico, 2 | 900 / 7 000 | 81 kW (110 PS) @ 7 000 (128 PS na série II), 130 N·m @ 3 500 | 0,18 | carb Hitachi 4 corpos (`carb`) | `duplo` → 2 saídas, `classic`, Ø 45, 3,6 m | 4 m 3,683/2,263/1,397/1,000 ≈, final 4,111 ≈ · 940 kg · 0,30 | `lean`, sem cat, `fuel` 120 a 7 500 (aproximação) | carro, nenhum |
| 11 | Mistral G-200 / G-300 (`mistral`) | aviação leve (Suíça, 2000s; programa encerrado) | 2 × 654 ≈ (variante G-300: 3 × 654) | ≈ 9,0 | lateral4 / periférico, 2 | 1 200 / 7 500 ≈ | 149 kW (200 hp) @ 7 500 ≈; G-300 224 kW | 0,25 (+ hélice) | NA, injeção | `2em1` com silencioso 1,0 m Ø 50 | redutor **2,56:1** ≈ (hélice 2 930), hélice 3 pás D 1,90 m, `J_hel` 1,8 | `lean`, sem cat, `fuel` | hélice, nenhum (**aproximação**) |
| 12 | MidWest AE110 (`ae110`) | aviação leve (Reino Unido, anos 1990) | 2 × 294 (geometria Norton) | ≈ 9,0 | sachs / periférico, 1 | 1 400 / 7 800 | 82 kW (110 hp) @ 7 800 | 0,05 | NA | `2em1` curto 0,6 m + `stock` | redutor 2,95:1 (hélice 2 640), hélice 2 pás D 1,70 m, `J_hel` 1,0 | `lean`, sem cat, `fuel` | hélice, nenhum |
| 13 | Austro Engine AE50R (`ae50r`) | Schiebel Camcopter S-100 (UAV helicóptero) | **1** × 294 | ≈ 9,0 | sachs / periférico, 1 | 2 000 / 7 750 | 41 kW (55 hp) @ 7 750 | 0,03 | NA, injeção | `2em1` → 1 tubo com silencioso | redutor 2,95:1 → caixa do rotor; rotor 3 pás D 3,40 m, Nr ≈ 1 070 ≈, `J_rot` 15 ≈; cauda 2 pás | `cut`, sem cat, `fuel` | **rotor** (`HELICOPTEROS.s100`, 200 kg), nenhum |
| 14 | UEL AR741 (`ar741`) | AAI RQ-7 Shadow 200 (UAV asa fixa, hélice impulsora) | **1** × 208 | ≈ 9,0 | sachs / periférico, 1 | 2 500 / 7 800 | 28 kW (38 hp) @ 7 800 | 0,02 | NA, carb | `'straight'` curto 0,4 m Ø 35 (é barulhento) | **direto** (`reducao` 1): hélice 2 pás D 0,74 m, `M_t` 0,88 a 7 800, `J_hel` 0,05 | `lean`, sem cat, `fuel` | hélice (170 kg), nenhum |
| 15 | LiquidPiston X Mini (`xmini`) | protótipo | `tipo 'x'`, 3 câmaras × 23 cm³, `cyc` 720 | ≈ 9 | X (4.1) | 3 000 / 15 000 | 3 kW @ 12 000 | 0,002 | NA, carb | tubo curto + `stock` | — | `cut`, `fuel` | nenhum, gerador (1–2 kW) (**aproximação**) |
| 16 | LiquidPiston XTS-210 (`xts210`) | grupo gerador / protótipos militares | `tipo 'x'`, 3 × 70 cm³ | 18 | X, injeção direta (CI se `cc` existir) | 2 500 / 7 500 ≈ | 19 kW (25 hp) @ 6 500 ≈ | 0,01 | NA | tubo 0,5 m Ø 35 + silencioso | — | — | **gerador** (inversor, rotação livre), nenhum (**aproximação**) |
| 17 | Motor pneumático de palhetas (`palhetas`) | retífica/parafusadeira; motor de arranque a ar | `tipo 'palhetas'`, `z` 8 (ferramenta) / 7 (arranque) | — | — | livre 20 000 (ferramenta), 4 000 (arranque) | 0,7 kW / 8 kW | 1e-5 / 5e-4 | ar 6,3 bar / 8 bar | silencioso da ferramenta (passa-baixa 3 kHz) | arranque: redução 10:1, hospedeiro `r1340` (radial) ou `catc15` (diesel) | — | **ferramenta** (bancada), nenhum; arranque de hospedeiro (**aproximação**) |

Diferenças fixas entre câmaras: as do Ronco por flanco mais ±4% (`cylQ`) e ±6% (`cylEx`) por rotor (1.2); carburados ×2,6 como no Ronco.

### 6.3 Tabela motor × portador (linhas novas da tabela 1.6 do `CENA.md`)

| Motor | carro | moto (portador carro) | hélice (avião leve / UAV) | rotor (helicóptero / UAV) | gerador | nenhum (bancada) | ferramenta |
|---|---|---|---|---|---|---|---|
| 1–8, 10 (Mazda, NSU) | ✓ | — | — | — | — | ✓ | — |
| 7 787B | ✓ (carro de corrida: `CarroLegado` com as 5 marchas) | — | — | — | — | ✓ | — |
| 9 Norton | — | ✓ | — | — | — | ✓ | — |
| 11 Mistral, 12 AE110 | — | — | ✓ | — | — | ✓ | — |
| 13 AE50R | — | — | — | ✓ (`carriers/rotor.ts`, `HELICOPTEROS.s100`) | — | ✓ | — |
| 14 AR741 | — | — | ✓ (direto, pusher) | — | — | ✓ | — |
| 15 X Mini | — | — | — | — | ✓ (1–2 kW) | ✓ | — |
| 16 XTS-210 | — | — | — | — | ✓ | ✓ | — |
| 17 palhetas | — | — | — | — | — | ✓ | ✓ (ferramenta; arranque de hospedeiro) |

`COMPAT.carro` e `COMPAT.helice` já têm `'rotativo'`; **faltam** `'rotativo'` em `COMPAT.rotor` e `COMPAT.gerador` (`src/carriers/compat.ts`, arquivo da etapa 1): mudança de duas palavras, a combinar com quem cuida de `carriers/` (relatar, não mudar); até lá AE50R e XTS-210 rodam em `nenhum`. O portador `ferramenta` não existe: o motor de palhetas roda em `nenhum` com a carga interna (5.3); um portador próprio só se a etapa 6 (elétrico, ferramentas) o criar.

---

## 7. Interface da página `rotativo.html`

Mesma casca (`Barra`, `FamilyNav`, `PresetNav`, `BotaoIgnicao`, `AudioShell`, perfil `PERFIL_RONCO`), mostradores em canvas fora do React. Famílias: Mazda de rua (1–5), Mazda 3 e 4 rotores (6–7), Europeus (8–10), Aviação e UAV (11–14), X-Engine (15–16, etiqueta "aproximação"), Palhetas (17, etiqueta "protótipo/aproximação").

| Seção do Ronco | No rotativo |
|---|---|
| Escuta e ambiente | **igual** (ouvinte `ext/int/bay/pipe/road`, ambientes, distância, mixes de escape/admissão/mecânica/ar, mestre, dinâmica, som de fundo); nos portadores hélice/rotor/gerador o `road` vira a Passagem |
| Motor | **somem** arranjo, cilindros, virabrequim e **ordem de ignição** (não há o que editar: decorre dos rotores); **entram** `rotores` (1–4, com as fases mostradas), geometria `R/e/b` (campos numéricos com `V_cam` e `CR` calculados ao lado), `cr` 8–11, **janelas** (admissão: lateral 4 / lateral 6 / street / bridge / periférica / Sachs; escape: periférico / lateral; rotações de `apv`), **velas** (1/2/3; interruptor das *trailing*), lenta, `rpmMax`; `cam` some (é o tipo de janela); `fuel` carb/efi fica |
| Características | `inertia` igual (escala `J`); `power`/`torque` da ficha; **vedações** novas/gastas |
| Corte de giro | **igual** (tipo, faixa, tempo): o Renesis corta combustível a 9 000, o FD a 8 000; carburados antigos recebem o corte "aproximação" de 6.2 |
| Temperatura do motor | **igual**, mais indicador de **temperatura do gás de escape** (°C) e fumaça azul de óleo nos primeiros 20 s (só visual) |
| Transmissão | **igual** no portador carro/moto; oculta em hélice, rotor, gerador e bancada |
| Escapamento | `tipo` (série / megafone / 2 em 1 / duplo), **pré-silencioso** ligado/retirado, reator térmico (RX-3), abafador, diâmetro, ponteira, número de saídas; comprimento do downpipe |
| Acessórios | válvula de escape e ressonador do Ronco **ficam** (preparações usam); 2-step só no `rx7fd` |
| Estalos no escape | igual (`overrun`, catalisador) mais o cursor **pós-queima** (`fHCextra` 0–10%) |
| Admissão | caixa de ar / esportiva iguais; borboletas individuais somem; turbo: pressão, **sequencial** ligado/desligado e rotação da troca; sem compressor mecânico |
| **nova**: Carga (depende do portador) | carro/moto: pedal como hoje; hélice: manete e passo (`RADIAL.md` 3.3); rotor: coletivo; gerador: degraus; bancada: dinamômetro; palhetas: pressão do ar (3–8 bar) e carga da ferramenta (0–100%) |

Mostradores: conta-giros com fundo de escala `1,15·rpmMax` arredondado (10 000 no 787B e na Norton, 9 000 no RX-8, 20 000 nas palhetas); **anel do ciclo** com 1 080° e as 3 câmaras do rotor 1 (cores por flanco) e a posição dos rotores; traço p–α do último ciclo da câmara 0 (200 × 120); pressão de pico; temperatura do gás; `boost` com indicador do turbo secundário; `apv` abertas; estalos/s; nas palhetas, rotação e pressão. Telemetria a cada 1 024 amostras com os campos do item 19.

Paridade de interface (lista do relatório): todos os controles de "Escuta e ambiente", "Temperatura", "Transmissão", "Corte de giro" e "Acessórios" do Ronco continuam com o mesmo nome; a lista dos que somem ou mudam de seção é a tabela acima.

---

## 8. Plano de implementação e verificação

Ferramentas (`tools/`, TypeScript com `tsx`): `rotativo-render.ts` (cenários `idle`, `cold`, `rev` (sustentado em rpm dado), `wot`, `sweep`, `decel` (plena carga → pé fora, 6 s), `flyby`, `start`, `shutdown`; WAV float e JSON com `rpm, thr, boost, boostSec, tEscape, fHC, estouros, apv, pCam0, Vcam0` a cada 1 024 amostras), `rotativo-lenta.ts` (todos os presets a 20 °C e −5 °C, 30 s, acelerada aos 12 s; zero apagamentos, rpm ±3% (periféricos: 1 600–2 200 e `vagar` ≥ 20%); NaN = falha), `rotativo-geometria.ts` (Apêndice B), `rotativo-bandas.ts` (porta de `medir_w.py`/`picos.py`/`pops.py`: bandas, linhas nas ordens 1/3, 2/3, 1, ign, 2·ign, vagar, `CVciclo`, p90/p10, estalos/s) e `rotativo-cpu.ts`. Cada passo termina num comando (`npm run teste:rotativo -- <passo>`); os números vão para o relatório.

| # | Passo | Entrega | Teste objetivo |
|---|---|---|---|
| 1 | Ganchos no `EngineDSP` (depois do Diesel e do Radial) | tabela 1.6 com os ramos vazios; `RotativoDSP` que só põe `rot = true`, `cyc = 1080` | `npm run paridade:ronco` idêntico (200 cenários) e `--dist`; `v16 rev` e `muscle wot` ±3% de tempo; `git diff --stat src/engines/ronco/dsp.ts` < 70 linhas |
| 2 | Geometria e ciclo | `geometria.ts`: `volumeCamara`, `montarRotativo`, fases, janelas; volume e `dV/dα` no laço | Apêndice B reproduzido: `V_cam` 654,3 / 572,5 / 490,7 / 497,5 / 294 ±0,5%; `V(0) = V_min`, `V(270°e) = V_min + V_cam` ±1e-9; `∮ p dV` de um ciclo motorizado (sem queima) = 0 ± 1%; fases 0/180, 0/120/240, 0/90/180/270 com intervalos de ignição 180/120/90°e exatos no render (`rotativo-bandas` lê `f_ign = rotores·rpm/60` ±0,5%) |
| 3 | Janelas, tubo compartilhado, combustão | perfis trapezoidais, `runRot`, `kBurn`, `hwr`, `tBurn` | `rx7fd idle` 750 rpm quente: pressão na abertura do escape 1,5–2,5 bar (4 bar em plena carga a 55%); `turb` por evento com Mach 1 no primeiro 1/3 da rampa; `tEscape` lenta 400–500 °C, plena 900–1 000; `exhT` no painel idem; 10–90% da queima 95–110°e em lenta, 50–60°e em plena carga |
| 4 | Pós-queima e estouros | `fHC`, `posQueima`, `prRot` | `rx7fd idle` a 4 m (`ext`), pré-silencioso ligado: bandas da linha "lenta original" de 3.1 a ±4 dB (1–2,5k −11, 2,5–6k −10,5), centroide 480–550; desligando `fHC` a banda 1–2,5k cai ≥ 6 dB (prova de que é ela, não o jato); `decel` do `rx8hp` com `'burble'`: 4–6 estouros/s; `r26b decel`: 3,5–7/s; `r26b idle`: 10–16 estalos/s, `vagar` ≥ 20% em 12 s, `CVciclo` ≥ 0,40 |
| 5 | Escape e calibração | `buildExhaust` (serie, megafone, 2em1, duplo, reator), `presilencioso`, `calibrate`/`measurePower` | `rx7fd idle`: 2·ign e 3·ign dentro de 6 dB da ign; pré-silencioso retirado: 1–2,5k e 2,5–6k sobem ≥ 6 dB e 2·ign sobe ≥ 4 dB; `r26b rev` 7 700: bandas de 3.1 (+20/+19/+7) ±4, ign ≥ +22 dB sobre a mediana, ordem 1 a −10 ± 4 dB da ign; `rx8hp rev` 5 000: espectro 400 Hz–6 kHz dentro de 4 dB (plano), ign +27 ± 4, ordens 2/3 e 5/3 a −16 ± 5 dB da ign; lenta → plena carga a 55%: +18 a +25 dB; os 10 carros/moto dentro de 12 dB na lenta |
| 6 | Turbo sequencial e `apv` | `control` da subclasse | `rx7fd sweep`: queda de 0,1–0,2 bar em 4 500 ± 100 rpm por 0,2–0,4 s; `boost` 0,65–0,75 bar de 3 000 a 8 000; `rx8hp sweep`: degraus de `AinMax` em 3 750 e 6 250 ± 50 rpm, torque não cai mais que 3% na troca |
| 7 | Mecânica e vibração | tiques de ápice, engrenagem, `vib` | `int` do `rx8hp` em lenta: `vib` 10–15 dB abaixo do `civic`/`mx5` do Ronco na mesma posição; nenhuma linha de meia-ordem (`rpm/120`) acima de +3 dB; sem cliques contáveis (`clickEnv` eventos fundidos: p90/p10 de 2–6 kHz ≤ 12 dB em lenta) |
| 8 | Portadores hélice e rotor, adaptador `Motor` | `motor.ts`, presets 11–14 com `carriers/helice.ts` e `rotor.ts` | `tools/cena/portadores.ts` e `valida.ts` continuam passando; `ar741 takeoff`: BPF 260 Hz, `M_t` 0,88, f_ign/BPF = 0,5 (1 rotor, 2 pás, direto: a ignição é **metade** da BPF: o Shadow soa como hélice); `ae50r` com rotor: Nr 1 070 ± 2%, droop ≤ 3%; `mistral runup`: 1 200 → 7 500 em 4–6 s com o governador segurando 2 930 ± 2% na hélice |
| 9 | X-Engine | `tipo 'x'` em `geometria.ts`, janelas de 4.1 | `xmini rev` 12 000: `f_ign` 300 Hz ±0,5%, `cyc` 720, 3 câmaras; `xts210` com CR 18 (teto do Diesel) sem NaN; pressão na abertura do escape 1,3–1,6 bar (expansão prolongada); etiqueta "aproximação" no painel |
| 10 | Palhetas | `palhetas.ts`, `'palhetas-engine'` | tom de palheta `z·n/60` ±1% (8 × 20 000 → 2 667 Hz) ≥ 15 dB sobre a mediana; sob carga 100% a rotação cai ≥ 30% em ≤ 1 s; jato ≥ tom em 2,5–6 kHz; arranque: rotação do hospedeiro sobe a 0,45·`idle` em 1–2 s (encaixe com `RADIAL.md` 3.4 / `DIESEL.md` item 15) |
| 11 | Presets completos | os 17 com fichas; tabela de compatibilidade; `COMPAT` relatado | `rotativo-lenta.ts`: 17 × 2 temperaturas, zero apagamentos (periféricos com o critério próprio), rpm ±3%; potência ±5% da ficha; `rx7fd` a 100 km/h em 5ª: 2 600 ± 100 rpm; `rx8hp` em 6ª: 2 750 ± 100; `r26b` em 5ª a 8 500: 340 ± 10 km/h; `ro80` 0–100 km/h 12–15 s |
| 12 | CPU | `rotativo-cpu.ts` | `r26b rev` 10 s em Node ≤ 45% do tempo real (12 câmaras, 1 rede: referência Chiron V16 ≈ 35%); no navegador `AudioWorkletNode` ≤ 50% do quantum (p99); se passar: `solverIt` 4 nas câmaras com razão de pressão > 3 |
| 13 | Página e navegador | `rotativo.html`, `src/pages/rotativo/`, `tools/rotativo-navegador.mjs` | paridade de controles (lista de 7); headless: liga, acelera, troca janelas/velas/pré-silencioso/preset/portador/ambiente, sem erros no console, worklet (não a reserva) |
| 14 | Documentação | `TECNICO.md` → seção Rotativos e Validação (só Commons na tabela pública), `PLANO.md` marcado, `CENA.md` 1.6 atualizado, relatório | relatório com todos os números acima |

### 8.1 Riscos e como limitar

| Risco | Medida |
|---|---|
| **Quebrar a paridade do Ronco**: três autores no `dsp.ts` (Diesel, Radial, Rotativo), `cyc` introduzido duas vezes, `const` → `let` reordenando algo | Passo 1 só depois dos outros dois; só `if (this.rot) {…} else { linha original }` ou `let` sem mudar a expressão; nunca ternário novo; o portão de 1.6 em todo commit; `git diff` do `dsp.ts` revisado linha a linha no relatório |
| **Fases erradas por um fator 3** (rotor × eixo): usar 360° por câmara, ou `cyc` 720, dá 3× a frequência de ignição certa | Teste do passo 2 lê `f_ign` no render e compara com `rotores·rpm/60`; o anel do painel mostra 1 080° e as 3 câmaras |
| **Tubo compartilhado**: a atribuição de `run.out0` apaga uma câmara; ou a acumulação dobra a pressão quando duas câmaras estão abertas (555–588°e) | Zerar uma vez por rotor antes do laço; conferir que a soma das vazões das 3 câmaras de um rotor em um ciclo = massa admitida ±1%; limite `dp` por amostra como no Diesel |
| **Rigidez**: `dV/dα` senoidal com câmaras de 654 cm³ e janela abrindo brusca → `exhaustFlow` com razão de pressão 4 e área crescendo 36 mm²/°e | 6 iterações do regula falsi bastam (engasgado converge em 2); teste de NaN em todos os renders; `solverIt` 4 só se a CPU pedir |
| **Pós-queima virando chiado contínuo** ("mar", o erro clássico do `REVISAO-DE-SOM.md`) | `posQueima` tem envoltória presa ao evento (2 ms / 12 ms); critério: desvio/média da envoltória de 1–6 kHz em lenta ≥ 0,5 e p90/p10 7–13 dB como medido; se ligar o tempo todo, está errado |
| **Lenta periférica apagando** no `rotativo-lenta.ts` (6% de falhas + `fHC` ×2 + controle de lenta do Ronco acertado para carros) | `idle` 1 800–2 200 nos presets periféricos, `KP/KI` iguais; se apagar, sobe-se `idle`, não os ganhos; critério de aceitação próprio (caça entre 1 600 e 2 200) |
| **CPU**: 12 câmaras no R26B, cada uma com Wiebe e janelas ativas boa parte do ciclo (escape aberto 393°e de 1 080) | Passo 12; megafone com 3 segmentos só; `solverIt` 4 |
| **Gravações**: só duas do Commons; o 787B, Norton e Ro80 são YouTube com codec (o Ro80 `1JOt` não tem nada acima de 6 kHz; o 787B `6VCl` tem chiado de câmera em 6–12 kHz); rotação ambígua por um fator 2 (RX-7 Commons depois de 30 s: 58 Hz pode ser ignição a 1 750 ou 2º harmônico a 880; Norton: 61,5 Hz = 1 850 ou 31 Hz = 925) | Tabela pública só com Commons; onde a leitura é ambígua está marcado no Apêndice A, e os alvos usam o trecho de 16–20 s do RX-7 (série harmônica limpa em 29,3 Hz) e a ACF do Norton em 10–20 s; a banda 6–12 kHz do 787B não é alvo |
| **X-Engine sem referência** | Marcado aproximação; só os testes de contagem (`f_ign`, `cyc`, pressão na abertura) e nenhum alvo de banda |
| **Palhetas sem gravação no acervo** | Antes do passo 10, uma gravação Commons de ferramenta pneumática (retífica/parafusadeira) medida com `scan.py`/`picos.py`; sem ela, os alvos de 5.3 ficam como estão e o preset leva "aproximação" |
| **`COMPAT` e `HELICOPTEROS` são de outra etapa** | Relatar as duas linhas (`rotor`, `gerador` + `s100`) em vez de mudar; até lá os presets 13 e 16 rodam em `nenhum` |

---

## Apêndice A. Medidas das gravações

Arquivos em `…/scratchpad/real2/wankel/wav/` (índice em `…/real2/INDEX.md`); scripts em `…/scratchpad/wankeltools/`. Bandas em dB rel. 150–400 Hz; `1–4k` idem; `cent` = centroide (Hz); linhas em dB de pico sobre a mediana local (Welch 32768) nas ordens do eixo (`o1/3`, `o2/3`, `o1`) e na ignição (`ign` = `rotores·rpm/60`, `2ign`, `3ign`); `vagar` em %; `CVc`/`CVl`; `per` = fração periódica 1–6 kHz; `p90/10` em dB; `larg` = largura do pulso 0,5–4 kHz (fração do período); `pop/s`. "—" = não medido ou fora da faixa confiável (< 20 Hz: codec e `medfilt`). Rotação pela ACF da envoltória conferida com a lista de picos (`picos.py`); onde a ACF e os picos discordaram, prevaleceu a série harmônica dos picos e está dito.

### A.1 Lenta

| Trecho (arquivo, s) | rotores | rpm (f_ign Hz) | vagar | 60–150 | 400–1k | 1–2,5k | 2,5–6k | 6–12k | 1–4k | cent | o1/3 | o2/3 | o1 | ign | 2ign | 3ign | CVc | CVl | per | p90/10 | larg | pop/s | microfone / notas |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| RX-7 Commons `4z0y1H2REvE` 16–20 | 2 | **879 (29,3)** | 2,7 | +1,6 | −0,9 | −10,9 | −10,5 | −16,5 | −8,5 | 541 | — | — | — | 18,8 | 17,2 | **23,9** | 0,23 | 0,21 | 0,30 | 6,8 | 0,45 | 0,5 | perto do carro; série harmônica limpa 29,3 / 58,6 / 87,9 / 117 / 146,5 / 234 Hz |
| idem 100–110 | 2 | 1 750 (58 ± 6) **ou** 880 (2º harm.; fundamental ausente) — **incerto** | — | +2,5 | −4,3 | −10,5 | −11,3 | −21,8 | −8,4 | 480 | — | 1,0 | −4,2 | 10,0 | 10,7 | 1,4 | 0,60 | 0,25 | 0,14 | 8,6 | 0,50 | 0,7 | picos 48–70 Hz (linha caminhando) + 165–170 e 384–396 Hz (ressonâncias) |
| idem 164–172 | 2 | idem (66 ± 7) | — | +3,4 | −0,7 | −7,2 | −5,7 | −14,5 | −4,4 | 779 | — | 1,8 | −0,4 | 13,3 | 2,5 | −0,2 | 0,71 | 0,38 | 0,13 | 11,6 | 0,54 | 0,5 | idem |
| RX-7 TJ Hunt `8PKS_edzhf0` 60–70 (modificado) | 2 | **1 730 (57,7)** | 1,7 | −1,4 | −8,1 | −31,8 | −37,2 | −33,1 | −31,2 | 231 | — | −1,2 | −1,4 | 10,9 | 13,4 | 7,2 | 0,45 | 0,20 | 0,15 | 12,7 | 0,37 | **9,9** | mic afastado/abafado; harmônicos 2, 4, 5, 7 (111, 224–237, 285–290, 381–398 Hz) fortes, 3 e 6 fracos |
| idem 96–114 | 2 | 1 762 (58,7) | 1,5 | −0,1 | −10,7 | −30,5 | −37,5 | −33,4 | −30,1 | 197 | — | 0,3 | −0,8 | 9,8 | 10,9 | 10,3 | — | — | 0,11 | 11,2 | 0,37 | 7,9 | idem |
| Ro80 `1JOt5YezBbk` 2–5 (partida a frio) | 2 | **1 540–1 650 (51,3–55)** | 2,2 | −2,4 | −10,8 | −12,0 | −19,9 | (−82: codec) | −11,3 | 320 | 0,9 | 0,3 | 4,0 | 15,9 (pico 26) | 5,0 (pico 21) | 13,9 | 0,20 | 0,15 | 0,14 | 12,2 | 0,50 | 1,3 | ACF deu 25,6 Hz (envoltória alternada: rotores desiguais); picos: 51,3 / 102,5 / 153,8 / 203,6 / 254,9 / 304,7 + 76,2 (1,5·) e 279,8 (5,5·) |
| Ro80 `dyYf3kTn0vM` 18–24 (quente) | 2 | **≈ 1 100 (36,6)** pela série 73 / 110 / 149 / 185 Hz (7–11 dB) — fraco | — | −7,6 | +5,9 | −0,7 | −14,2 | −4,6 | −0,6 | 735 | — | — | — | — | — | — | 0,33 | 0,16 | 0,25 | 13,4 | 0,54 | 3,2 | cofre/capô aberto (mecânica, brilhante); ACF 51 Hz não bate com os picos |
| Norton `Fx7nCcXoN4M` 10–20 | 2 | **1 900–2 000 (63–67) subindo a 2 500 (83)** | 11,7 (sobe) | +12,3 | −3,2 | −5,5 | −12,0 | −25,9 | −4,7 | 249 | 1,2 | 0,0 | 5,7 | 4,2 | 2,3 | 2,0 | 0,32 | 0,13 | 0,11 | 12,2 | 0,51 | 0,8 | ~2 m; picos 33,7 (9) / 63–67 (16–17) / 95–101 (12) / 122–133 (14) |
| Norton idem 22–36 | 2 | **1 846 (61,5)**; leitura alternativa 923 (30,8 = ign) — ver 8.1 | 0,6 (ACF em 30,8) | +6,7 | −2,3 | −2,8 | −12,7 | −23,5 | −2,5 | 482 | −0,7 | 0,4 | 11,7 (30,8 Hz) | 18,3 (pico 22) | 16,7 | 8,5 | 0,20 | 0,05 | 0,15 | 8,8 | 0,53 | 0,4 | picos 30,8 (12) / 61,5 (22) / 92,3 (16) / 123 (18) / 153,8 / 247,6 (16) |
| 787B `6VClDdIhW70` 26–36 | 4 | **1 904 (126,9)** | 2,7 | +1,5 | −10,5 | −20,0 | −14,1 | −10,6 (chiado) | −17,3 | 383 | 2,1 | −0,3 | −2,1 | 11,5 | 2,5 | 3,3 | 0,47 | 0,15 | 0,07 | 18,4 | 0,49 | **15,8** | ~5 m; cluster 107–132 Hz (lenta caminhando 1 600–1 980) |
| idem 198–210 | 4 | 2 131 (142) **caçando** 105–147 Hz | **24,7** | +3,1 | −4,8 | −11,2 | −14,7 | −15,0 | −10,8 | 325 | 1,3 | −2,5 | 0,2 | 4,6 | 1,9 | 2,2 | 0,53 | 0,37 | 0,06 | 29,4 | 0,50 | 3,5 | 1 580–2 200 rpm em 12 s |
| idem 214–228 | 4 | 1 853 (124) caçando | **35,0** | +4,6 | −8,0 | −16,6 | −18,2 | −12,5 | −15,8 | 234 | 0,1 | −0,6 | 0,0 | 8,4 | 0,3 | 5,5 | 0,42 | 0,25 | 0,07 | 13,9 | 0,46 | 2,0 | idem |
| *Fiat Bravo 1.4 I4* Commons 48–56 | (2 ev./volta) | 1 050–1 075 (35) | — | −15,6 | −16,1 | −19,3 | −34,9 | −45,3 | −19,3 | 204 | — | — | — | — | — | — | 0,23 | 0,11 | 0,24 | 9,9 | 0,54 | 1,6 | 5·ign (174 Hz) +26 com bandas laterais a ±8,7 Hz (meia-ordem) |
| *Fiat Bravo* 16–22 | | 1 080 (36) | — | −19,0 | −15,3 | −20,2 | −39,7 | −49,6 | −20,2 | 203 | — | — | — | — | — | — | 0,28 | 0,22 | 0,25 | 10,6 | 0,52 | 1,8 | |
| *Maserati GranTurismo S V8* Commons 4–8 | (4 ev./volta) | 740 (49,3) | — | −21,9 | −7,8 | −24,6 | −30,4 | −34,3 | −24,0 | 306 | | | | 0,4 | 0,6 | 4,1 | 0,19 | 0,07 | 0,16 | 7,8 | 0,36 | 0,8 | |
| *Maserati* 14–18 | | ≈ 840 (28 lida como 2 ev.: ambígua) | — | −18,7 | −3,9 | −21,3 | −29,1 | −34,3 | −20,9 | 358 | | | | | | | 0,19 | 0,10 | 0,30 | 8,7 | 0,46 | 2,2 | |

### A.2 Giro alto, passagens e desaceleração

| Trecho | rotores | rpm (f_ign) | vagar | 60–150 | 400–1k | 1–2,5k | 2,5–6k | 6–12k | 1–4k | cent | o1/3 | o2/3 | o1 | ign | 2ign | 3ign | CVc | CVl | per | p90/10 | larg | pop/s | notas |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| RX-8 Commons `u-Lc2Nt3OR8` 20–24 (sustentado) | 2 | **5 010 (167)** | 11,6 (operador) | −8,1 | −9,9 | −11,1 | −10,5 | −19,9 | −8,3 | 523 | 0,6 | **10,0 (57 Hz)** | 12,4 (86) | **23,8 (pico 27–28)** | 6,0 | 11,6 | 0,51 | 0,47 | 0,05 | 9,1 | 0,53 | 0,5 | picos 57,1 (11) / 65,9 / 86,4 (12) / 111,3 (8) / 131,8 (9) / 147,9 (10) / 167 (28) / 172,9 |
| RX-8 Commons 0–6 (acelerando leve) | 2 | 2 670 (89) | 27,7 | +0,9 | −3,6 | −10,5 | −9,2 | −17,6 | −7,8 | 629 | 0,3 | −0,2 | 2,3 | 12,7 | 5,2 | 3,4 | 0,60 | 0,50 | 0,09 | 16,1 | 0,60 | 0,5 | não estacionário |
| RX-8 `75qYsZSEoMc` 8–14 (passagem, original) | 2 | ≈ 6 400–7 200 (240 Hz chegando → 187,5 indo; razão 1,28, `M` ≈ 0,12) | — | −21,0 | −2,9 | −4,8 | −14,5 | −26,5 | −4,4 | 627 | −1,7 | 0,4 | 1,9 | 18,2 (pico 27–30) | 8,4 | 6,8 | 0,96 | 0,87 | 0,03 | 18,4 | 0,54 | 0,5 | 10–15 m |
| RX-8 `nSmUXvjFuGI` 4–6,5 (passagem, escape livre, indo) | 2 | **2 800 (93,8)**; verdadeiro ≈ 3 000 (Doppler 111 → 94 Hz em 3 s) | 0,4 | −2,8 | +1,3 | −7,3 | −13,5 | −26,7 | −6,5 | 562 | −3,9 | 2,4 | 6,3 (46,9) | **40,6** | 33,5 | 28,3 | 0,28 | 0,26 | 0,14 | 11,7 | 0,34 | 1,6 | ordens 3, 5, 7, 9, 11 do eixo (140,6 / 234 / 327 / 423 / 517 Hz) +13 a +16 |
| RX-8 `HkVj9PQecxk` 60–64 (desaceleração com estouros) | 2 | ≈ 2 660 (89) | 18,9 | −7,8 | +2,3 | −9,6 | −13,3 | −26,6 | −8,2 | 498 | 2,4 | 3,5 | −2,3 | 4,9 | 1,6 | 4,9 | 0,70 | 0,64 | 0,09 | 16,4 | 0,31 | **13,0** | compilação: 17 janelas de 4 s com ≥ 4 estouros/s (4–11,8/s), altura mediana 11–15 dB |
| 787B `6VClDdIhW70` 89–92 (rev sustentado em neutro) | 4 | **7 739 (516)** | 0,5 | −6,5 | **+20,3** | **+19,0** | +6,7 | −7,8 | +19,2 | 933 | −1,0 | 2,7 | **15,0 (129)** | **24,6 (pico 25)** | 16,7 (1 032: pico 19) | 19,3 | 0,22 | 0,14 | 0,12 | 11,4 | 0,71 | 0,7 | ordem 2 (258 Hz) +10–11, ordem 3 (387–397) +8–9, 2,2·ign +10 |
| 787B idem 98–102 (desaceleração 7 000 → 2 000) | 4 | 2 850 (190, caindo) | 15 | −9,0 | −6,3 | −14,3 | −19,8 | −20,8 | −13,7 | 352 | 0,5 | 0,7 | −1,7 | 4,0 | 3,6 | 5,4 | 0,32 | 0,27 | 0,04 | 11,4 | 0,39 | **6,2** (3,5–7/s nas janelas de 2 s) | |
| 787B `sxXtpMngivM` 26–33 (Hunaudières, passagem) | 4 | ≈ 8 200 verdadeiro; linha 656 Hz chegando (29,5–30 s) → 421,9 indo (31–33,5 s), razão 1,555 | 11 (Doppler) | −5,4 | +13,9 | +11,3 | +6,4 | +0,5 | +12,1 | 1 344 | 0,3 | 1,1 | 1,7 | 16,7 | 12,5 | 6,0 | 0,46 | 0,41 | 0,03 | 19,4 | 0,73 | 0,7 | pico (29–30,5 s): −5,7 / +14,0 / +12,3 / +7,8 / +2,5, cent 1 494 (1 927 em 30 s); duas trocas de marcha antes (22 e 25,5 s) |
| 787B `V1T_bUuUjxQ` 30–34 (FoS, acelerando perto) | 4 | — | — | −0,4 | +10,1 | +12,4 | +10,2 | −5,5 | +14,0 | 1 839 | | | | | | | | | | | | | não estacionário |
| 787B `az39eqLIbyU` 106–116 (a bordo) | 4 | 7 700–8 300 (530–555) | — | −6,7 | +2,1 | −6,0 | −6,5 | −12,8 | −3,5 | 748 | **7 (42,5 Hz)** | — | **13–16 (129–138)** | 14–19 | 8–11 (1 090–1 115) | 6–10 (1 622–1 657) | | | | | | | ordem 2 (270–277) +16–17; ordem 5 (683–693) +6–7; ACF não acha pulsos (som estrutural) |
| 787B az39 10–20 (a bordo, giro baixo) | 4 | — | — | −6,9 | −4,8 | −14,4 | −16,2 | −23,5 | −12,5 | 401 | | | | | | | | | | | | | |
| Norton F1 `N8K032C9hMg` 24–32 (aquecendo) | 2 | ≈ 3 200–3 500 (105–117) | — | +6,6 | −5,9 | −6,2 | −10,8 | −8,0 | −5,5 | 435 | 0,0 | 0,8 | 0,8 | 3,3 | 0,9 | 2,3 | 0,49 | 0,16 | 0,10 | 11,8 | 0,46 | 2,9 | longe, reverberante; linhas fracas |
| Norton `uqLrAGqFA_c` 0–8 | 2 | ≈ 4 400 (146) | 11 | −0,4 | −4,2 | −11,0 | −12,0 | −15,7 | −9,5 | 427 | 1,4 | −0,2 | 1,7 | 6,5 | 3,4 | 3,1 | 0,55 | 0,37 | 0,07 | 10,3 | 0,51 | 3,2 | em movimento |

Estouros ao longo do tempo (`pops.py`, janelas de 4 s): RX-8 `HkV` 0–240 s: 17 janelas com ≥ 4/s (máx. 11,8/s aos 60 s, 9,5/s aos 16 s, 9,0/s aos 184 s), altura mediana 10,8–14,9 dB. 787B `6VCl` 84–110 s: 0–1/s durante o rev, 3,5/s e 7,0/s nas duas janelas de 2 s logo depois de tirar o pé (98–102 s), 0 depois de 104 s. RX-7 Commons 0–60 s: 3/s aos 8–12 s (partida), 2–2,5/s aos 24–32 s, ≤ 0,8/s no resto.

## Apêndice B. Geometria conferida

| Conferência | Fórmula | Valor | Ficha |
|---|---|---|---|
| 13B: `V_cam = 3√3·e·R·b` | 5,196·15·105·80 mm³ | 654,3 cm³ | 654 |
| 12A | 5,196·15·105·70 | 572,5 | 573 |
| 10A | 5,196·15·105·60 | 490,7 | 491 |
| 20B / R26B (3 e 4 × 13B) | | 1 962,9 / 2 617,2 | 1 962 / 2 616 |
| KKM 612: `b` para 497,5 cm³ com R 100, e 14 | 497 500 / (5,196·14·100) | 68,4 mm | (NSU publica 497,5 cm³ por câmara) |
| Sachs/Norton 294 cm³ com R 70, e 10,5 | 294 000 / (5,196·10,5·70) | 77,0 mm | 294 |
| AR741 208 cm³ com R 62, e 9,3 | 208 000 / (5,196·9,3·62) | 69,4 mm | 208 |
| 13B `V_min` com CR 9,0 / 9,4 / 10,0 | `V_cam/(CR − 1)` | 81,8 / 77,9 / 72,7 cm³ | |
| `boreEq` do 13B | `∛(4·654,3/π)` | 94,1 mm | (Ronco: um cilindro de 654 cm³ com curso = diâmetro) |
| `dV/dα` máximo do 13B | `V_cam/3` | 218 cm³/rad (a 135°e) | cilindro de 327 cm³: ≈ 180 cm³/rad |
| janela periférica aberta por câmara (13B) | 588 − 195 | 393°e (> 360: duas câmaras na janela entre 555 e 588°e) | |
| avanço do ápice por grau do eixo (13B) | `R·π/180/3` | 0,61 mm/°e → janela de 40 mm descoberta em ≈ 65°e (rampa 0,12–0,17 da duração) | |
| frequência de ignição | `rotores·rpm/60` | 13B 750 rpm: 25 Hz; RX-8 5 000: 167 Hz (medido 167); R26B 7 739: 516 Hz (medido 516); 9 000: 600 Hz | |
| ordens do eixo (RX-8 5 000 rpm) | `rpm/60·{1/3, 2/3, 1, 4/3, 5/3, 2}` | 27,8 / 55,6 / 83,3 / 111 / 139 / 167 Hz | medidos 57,1 / 86,4 / 111,3 / 147,9 / 167 (lenta subindo durante o trecho: +3%) |
| 787B Hunaudières: Doppler | `(1 + M cos θ₁)/(1 − M cos θ₂)` | razão 1,555 medida ↔ `M` ≈ 0,28 com θ ≈ 60°/150°; ≈ 340 km/h | |
| X-Engine: eventos | 3 câmaras, 1 ciclo de 720° cada | 1,5 por volta do eixo = 3 por volta do rotor (rotor a 1/2 do eixo) | |
