# Cena e Portador: projeto das camadas de ouvinte e de carga

Documento de projeto da etapa 1 (ver `PLANO.md`). Define as interfaces entre Motor, Portador e Cena, a Passagem universal, o modo de testes com ouvinte em gimbal e cena 3D, os portadores da etapa 1 e o plano de implementação com testes. A implementação segue este texto à letra; o que estiver marcado **decisão** não se renegocia dentro da etapa sem anotar no relatório. Unidades: metros, segundos, rad/s, N·m, pascal, kg. Referencial do corpo: `x` para a frente, `y` para a esquerda, `z` para cima, origem no centro do corpo ao nível do solo. Som: 48 kHz, blocos de 128 amostras no worklet, controle a cada 64 amostras.

- [1. Interfaces entre camadas](#1-interfaces-entre-camadas)
- [2. Passagem universal](#2-passagem-universal)
- [3. Modo de testes, ouvinte em gimbal e cena 3D](#3-modo-de-testes-ouvinte-em-gimbal-e-cena-3d)
- [4. Portadores da etapa 1](#4-portadores-da-etapa-1)
- [5. Plano de implementação e verificação](#5-plano-de-implementação-e-verificação)
- [6. O que já existe e como se encaixa](#6-o-que-já-existe-e-como-se-encaixa)

---

## 1. Interfaces entre camadas

### 1.1 Princípios

1. **O Motor não sabe onde está o ouvinte.** Ele entrega canais mono, um por fonte sonora, em pascal a uma distância de referência em campo livre (`refDist`). Toda espacialização, propagação, cabine e ambiente são da Cena.
2. **O Portador é dono da geometria e da carga.** Ele posiciona as fontes do motor no corpo, acrescenta as fontes próprias (rodas, pás, ventiladores, vãos, pantógrafo, vento), integra a cinemática (posição ao longo da trajetória, velocidade) e devolve ao motor o torque de carga e a inércia refletida no eixo.
3. **A Cena é dona do tempo de propagação.** Ela guarda o histórico de poses do corpo, resolve o tempo de emissão de cada fonte, aplica distância, ar, solo, sombra, diretividade, filtros do ouvinte e entrega estéreo (direto) mais o envio para a reverberação do ambiente.
4. **Decisão: caminho legado intacto na etapa 1.** `EngineDSP` (Ronco) e `JetDSP` (Turbina) continuam produzindo o estéreo deles nos modos de ouvinte atuais (`ext/int/bay/pipe/road` e `ground/flyby/cockpit/cabin/wingcam`), amostra a amostra idênticos. A Cena nova é usada pelo **modo de testes** e pela **Passagem universal** com os portadores novos. A troca dos modos legados pela Cena nova é uma decisão de etapa posterior, tomada só quando as medidas da seção 5 mostrarem equivalência.
5. **Decisão: quem integra o virabrequim é o Motor.** O Portador fornece `Carga` (torque em função de ω e inércia refletida); motores governados (hélice, rotor, gerador, locomotiva) recebem do Portador o comando de combustível que o governador do Portador calcula. No carro, a dinâmica atual (embreagem, câmbio, massa, arrasto) fica dentro do `EngineDSP` como `CarroLegado`; extraí-la para `carriers/carro` é passo da etapa 2 ou posterior e tem de ser idêntico amostra a amostra.

### 1.2 Tipos comuns (`src/scene/tipos.ts`)

```ts
export type Vec3 = readonly [number, number, number];

/** Diretividade de uma fonte: ganho em dB a 0°, 30°, …, 180° do eixo da fonte (7 valores), como DIR em jet-dsp. */
export interface Diretividade {
  tabela: readonly [number, number, number, number, number, number, number];
  eixo: Vec3;        // direção do 0° no referencial do corpo (escape: [-1,0,0]; admissão/hélice: [1,0,0]; rotor: [0,0,1])
  expConv: number;   // expoente da amplificação convectiva |1 − M·cosθ|^(−expConv): 2 monopolo, 3 dipolo, 1,4 jato (legado)
}

export type TipoFonte =
  | 'escape' | 'admissao' | 'mecanica' | 'compressor'   // do motor
  | 'pa'                                                // hélice, rotor, fan, ventilador: tons de passagem de pá
  | 'rolamento' | 'aero' | 'vao' | 'pantografo'         // do portador
  | 'eletrica' | 'pressao' | 'vento';                   // zumbido elétrico, onda de pressão (infrassom), vento no ouvinte

export interface FonteSonora {
  id: string;                 // 'escape.0', 'admissao', 'bloco', 'helice', 'rotor.principal', 'truque.7', 'vao.3', 'pantografo.1'
  tipo: TipoFonte;
  pos: Vec3;                  // no referencial do corpo
  dir: Diretividade;
  refDist: number;            // m: o canal é p(t) em Pa, campo livre, a esta distância (Ronco 5 m; Turbina 30 m; portadores 7,5 m)
  dentro: boolean;            // true = está dentro de um compartimento (cofre, nacele, casa de máquinas): sofre a casca antes de sair
  hCorpo?: number;            // altura do ponto de emissão (usa pos[2] se omitido)
}

export interface EixoSaida { omega: number; torque: number; inercia: number }   // rad/s, N·m (líquido que o motor entrega), kg·m² (do motor)

export interface Carga {
  torque(omega: number): number;   // N·m resistente no eixo do motor (sinal positivo = freia)
  inercia: number;                 // kg·m² refletida no eixo do motor (ex.: hélice J·i², rotor J·i²)
}

export interface ComandoMotor {
  acelerador: number;      // 0..1 (pedal, manete, ou saída do governador do portador)
  ignicao: boolean;
  partida: boolean;
  combustivel?: number;    // 0..1, quando um governador externo manda no motor (rotor, gerador, locomotiva); se definido, substitui acelerador
}
```

### 1.3 Motor → Portador (`src/engines/motor.ts`)

```ts
export type FamiliaMotor = 'pistao' | 'turbina' | 'turboelice' | 'turboeixo' | 'radial' | 'rotativo' | 'diesel' | 'vapor' | 'eletrico' | 'nenhum';

export interface TelemetriaMotor { rpm: number; torque: number; potencia: number; estado: EstadoMotor; [k: string]: unknown }
export type EstadoMotor = 'desligado' | 'partida' | 'funcionando' | 'parando';

export interface Motor {
  readonly familia: FamiliaMotor;
  readonly fontes: readonly FonteSonora[];   // fixas após configurar(); posições no referencial do MOTOR (origem no centro do bloco)
  readonly eixo: EixoSaida;
  readonly estado: EstadoMotor;
  configurar(preset: object, fs: number): void;
  comandar(c: ComandoMotor): void;
  acoplar(carga: Carga | null): void;        // null = eixo livre (ponto morto)
  /** Preenche uma saída mono por fonte (mesma ordem de `fontes`), n amostras, Pa a refDist. */
  processar(saidas: Float32Array[], n: number): void;
  telemetria(): TelemetriaMotor;
}

/** Adaptador do DSP atual: expõe as fontes já separadas, e o estéreo legado quando a cena está em modo legado. */
export interface MotorLegado extends Motor {
  processarLegado(outL: Float32Array, outR: Float32Array, sendL: Float32Array, sendR: Float32Array, n: number): void;
  params: Record<string, unknown>;           // os `params` de hoje (listener, env, roadDist…)
}
```

Fontes que o adaptador do **Ronco** expõe (mono, Pa a 5 m; a calibração atual é relativa, então o adaptador fixa 100 dB SPL a 5 m atrás para "carga total a 55% da faixa vermelha com escape de referência", e a lenta cai os 21 dB da calibração): `escape.k` (uma por ponteira, `pos` = traseira do carro, `y` = lado da ponteira, `z` = 0,35; `dir.tabela` = `[-14,-12,-8,-4,-1,0,0]` com eixo `[-1,0,0]`, `expConv` 2), `admissao` (posição pelo campo `engine`: dianteiro `[+1.6,0,0.7]`, central `[-0.5,0,0.6]`, traseiro `[-1.8,0,0.6]`; `dentro: true`), `bloco` (mecânica, mesma posição do motor, `dentro: true`), `compressor` (turbo/supercharger, idem), `alivio` (válvula de alívio, idem). O que hoje é `exL/exR`, `inS/inP/inH`, `mech/mm`, `tur`, `sc`, `brk` mapeia uma a uma nesses canais.

Fontes da **Turbina** (Pa a 30 m, como hoje): por motor `e`: `admissao.e` (fan pela entrada + HPC + partida; `dir` = `DIR.inlet`, eixo `[1,0,0]`), `bypass.e` (`DIR.fanAft`), `jato.e` (`max(jetL, 0,55 jetF, 0,5 shock)`, eixo `[-1,0,0]`, `expConv` 1,4, posição `x − (3 + 4·Dj)`), `nucleo.e` (`DIR.core`), `crepitar.e`, `reversor.e`, e, nos turboélices, `helice.e` (`DIR.prop`, eixo `[1,0,0]`, `expConv` 3). Posições `ex/ey/ez` de hoje.

### 1.4 Portador → Cena (`src/carriers/portador.ts`)

```ts
export type TipoPortador = 'carro' | 'helice' | 'rotor' | 'gerador' | 'locomotiva' | 'trem' | 'nenhum';

export interface Segmento {           // um vagão, uma carroceria, uma fuselagem
  comprimento: number;                // m, do corpo (sem o vão)
  vao: number;                        // m, até o próximo segmento (0 no último)
  altura: number; largura: number;    // m
  zPiso: number;                      // m, folga sob o corpo (trem 0,3–0,5; carro 0,15)
}

export interface Corpo {
  segmentos: readonly Segmento[];
  comprimento: number;                // total, com vãos
  nariz: number; cauda: number;       // comprimento das partes afiladas (m): 0 num carro; 10–15 num trem-bala
  areaFrontal: number;                // m²
  cd: number;                         // coeficiente de arrasto
  cpNariz: number;                    // coeficiente de pressão pico a pico a 1 m da lateral (seção 2.6)
  massaSuperficial: number;           // kg/m² da casca, para a cabine fechada (carro 12; trem 25; avião 8; helicóptero 5; gerador com carenagem 15)
  fCabine: number;                    // Hz, ressonância do habitáculo (carro 70; trem 45; avião 110; helicóptero 60)
}

export interface Cinematica {
  s: number;        // m ao longo da trajetória (centro do corpo)
  v: number;        // m/s (positivo = para a frente)
  a: number;        // m/s²
  rumo: number;     // rad; 0 = +x do mundo (a Cena preenche a partir da trajetória)
}

export interface ComandoPortador {
  pedal: number;                 // 0..1: acelerador (carro), manete (hélice), coletivo (rotor); ignorado em gerador e locomotiva
  freio?: number;                // 0..1
  marcha?: 'sobe' | 'desce' | number;
  notch?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;   // locomotiva (0 = lenta)
  cargaFracao?: number;          // gerador: degrau de carga 0, 0,25, 0,5, 0,75, 1 (fração da potência nominal)
  freioDinamico?: number;        // locomotiva 0..1
  ignicao?: boolean; partida?: boolean;
  velocidadeFixa?: number | null;   // m/s; modo de testes: trava a cinemática independentemente do motor
}

export interface Portador {
  readonly tipo: TipoPortador;
  readonly corpo: Corpo;
  readonly cinematica: Cinematica;
  readonly compat: readonly FamiliaMotor[];
  acoplar(motor: Motor | null): void;        // valida pela tabela 1.6; lança erro fora dela
  comandar(c: ComandoPortador): void;
  /** Fontes próprias + fontes do motor transformadas para o referencial do corpo. Fixa após acoplar(). */
  fontes(): readonly FonteSonora[];
  /** Avança a física em n amostras e preenche um canal mono por fonte (ordem de fontes()). Chama motor.processar(). */
  processar(saidas: Float32Array[], n: number, dt: number): void;
  telemetria(): TelemetriaPortador;
}

export interface TelemetriaPortador { v: number; s: number; rpmEixo: number; torqueCarga: number; [k: string]: unknown }
```

A posição do motor no corpo é um campo do portador (`posMotor: Vec3`, `rotMotor: 'frente' | 'tras'`): `fontes()` soma `posMotor` à `pos` de cada fonte do motor e espelha o eixo da diretividade se o motor está montado para trás (motor traseiro do Fusca: escape continua apontando para trás; admissão aponta para trás).

### 1.5 Cena → ouvinte (`src/scene/cena.ts`)

```ts
export type IdAmbiente = 'ceu' | 'rua' | 'corte' | 'estacao' | 'tunel' | 'ponte' | 'garagem' | 'autodromo' | 'serra' | 'pista' | 'patio' | 'hangar' | 'celula' | 'vale' | 'porta-avioes';

export interface Solo { tipo: 'asfalto' | 'concreto' | 'brita' | 'grama' | 'agua' | 'nenhum'; }

export interface Tunel { area: number; comprimento: number; xEntrada: number; }   // m², m, posição da boca na trajetória (o ouvinte está dentro)

export interface Ambiente {
  id: IdAmbiente;
  solo: Solo;
  reverb: EspecReverb;         // o que o app.js de hoje chama ENVS (len, tau, diff, wet, dry, dark, flutter, echoes), mais rt60 por banda (seção 2.9)
  tunel?: Tunel;
  fundo: EspecFundo;           // vento, trânsito, ventilação (o que hoje é setAmbience)
}

export interface Trajetoria {
  tipo: 'reta' | 'volta';
  comprimento: number;         // m: da reta (o corpo reaparece do outro lado) ou perímetro da volta
  raioCurva: number;           // m, só na volta: oval com duas retas e dois semicírculos; o ouvinte fica junto de uma reta
  lateral: number;             // m, distância do ouvinte à LATERAL do corpo (não ao eixo); d da seção 2
  altitude: number;            // m, altura do piso do corpo sobre o solo (0 em veículos terrestres)
  sentido: 1 | -1;             // 1 = passa da esquerda para a direita do ouvinte
}

export type LocalOuvinte = 'fora' | 'cabine' | 'cofre' | 'ponteira';

export interface Ouvinte {
  modo: 'fixo' | 'gimbal';
  pos: Vec3;                   // modo fixo: no mundo, z = altura do ouvido (1,6 em pé; 1,2 sentado)
  gimbal: { az: number; el: number; r: number; alvo: 'corpo' | string };   // graus, graus, m; alvo = 'corpo' ou id de fonte
  local: LocalOuvinte | 'auto'; // 'auto': 'cabine' se o ponto cair dentro do corpo, senão 'fora'
  binaural: boolean;           // ITD + ILD (padrão true)
}

export interface TelemetriaCena {
  fontes: { id: string; posEmitida: Vec3; r: number; thetaEmissao: number; ganhoDb: number; atrasoMs: number }[];
  corpo: { s: number; v: number; pose: Vec3; rumo: number };
  ouvinte: Vec3;
  pressaoPa: number;           // onda de nariz/cauda + túnel, instantânea
  ventoMs: number;             // vento induzido no ouvinte
  splDbA: number; splDb: number;
  boom?: { dB: number; idade: number };
}

export interface Cena {
  configurar(amb: Ambiente, traj: Trajetoria, ouv: Ouvinte, fs: number): void;
  atualizar(parcial: Partial<{ amb: Ambiente; traj: Trajetoria; ouv: Ouvinte }>): void;   // sem estalos: rampas de 20 ms
  /** Lê os canais já preenchidos pelo portador e escreve direto (L/R) e envio para a reverberação (sendL/R). */
  processar(portador: Portador, canais: Float32Array[], outL: Float32Array, outR: Float32Array, sendL: Float32Array, sendR: Float32Array, n: number): void;
  telemetria(): TelemetriaCena;
}
```

**Saída.** O worklet continua com 4 canais: 0–1 direto binaural, 2–3 envio para o `ConvolverNode` do ambiente na thread principal (resposta ao impulso sintética, como hoje), seguido do compressor, EQ e ganho. **Decisão: escala absoluta.** Dentro da Cena o sinal é pressão em pascal; a conversão para a saída é fixa, `0 dBFS ≙ 124 dB SPL` (31,7 Pa), com o `tanh` já existente como limitador suave acima, e o `master` do usuário por cima. Uma passagem de trem a 115 dB(A) chega a ≈ −9 dBFS de pico; o estrondo sônico segue a regra atual (somado perto do máximo). O mostrador exibe `splDbA` real.

### 1.6 Tabela de compatibilidade motor × portador

| Motor \ Portador | carro | hélice | rotor | gerador | locomotiva | trem | nenhum (bancada) |
|---|---|---|---|---|---|---|---|
| pistão gasolina (Ronco) | **✓ etapa 1** (legado) | possível (Lycoming, Continental), sem preset na etapa 1 | possível (R44/R22: Lycoming O-540/O-360), sem preset na etapa 1 | — | — | — | ✓ |
| turbina / turboélice (Turbina) | — | **✓ etapa 1** (migra) | — | — | — | — | ✓ |
| turboeixo (Turbina com `arch: 'turboeixo'`, se a família oferecer) | — | — | **✓ etapa 1** (Esquilo/Arriel, UH-60/T700) | — | — | — | ✓ |
| diesel (etapa 2) | ✓ picape, caminhão | — | — | ✓ | ✓ | — | ✓ |
| radial (etapa 3) | — | ✓ | ✓ (antigos) | — | — | — | ✓ |
| rotativo (etapa 4) | ✓ | ✓ (Mistral) | — | — | — | — | ✓ |
| vapor (etapa 5) | ✓ (Stanley) | — | — | ✓ | ✓ (locomotiva a vapor: portador próprio) | — | ✓ |
| elétrico (etapa 6) | ✓ | — | — | — | — | ✓ | ✓ |
| nenhum | — | — | ✓ (pás e caixa sem motor, para teste) | — | — | **✓ etapa 1** (trem-bala) | — |

**Comando do usuário por portador** (o "pedal" do painel vira isto):

| Portador | Pedal/manete | O que o portador faz com ele | O que o motor recebe |
|---|---|---|---|
| carro | acelerador 0..1 | passa direto; câmbio e embreagem como hoje | `acelerador` |
| hélice | manete 0..1 | potência; o governador da hélice mantém `nHelice` mudando o passo (carga) | `acelerador` = manete; `Carga.torque` da hélice |
| rotor | coletivo 0..1 | tração do rotor; o governador do portador mantém Nr = 100% | `combustivel` do governador PI; `Carga.torque` do rotor |
| gerador | degraus 0/25/50/75/100% | torque elétrico; governador isócrono mantém rpm fixo | `combustivel` do governador; `Carga.torque` = P/(η·ω) |
| locomotiva | notch 0–8 | tabela rpm(notch) e potência(notch); regulador de carga | `combustivel` do governador (alvo rpm do notch); `Carga.torque` do gerador de tração |
| trem | velocidade fixa (teste) | só cinemática e fontes próprias | — |
| avião (Turbina legado) | manete | como hoje | `acelerador` |

---

## 2. Passagem universal

Corpo de comprimento `L` com `N` fontes `i` em posições `b_i = (x_i, y_i, z_i)` no corpo, passando por um ouvinte `O` a distância lateral `d` da lateral do corpo (então `d + largura/2` do eixo) e velocidade `v`. Tudo abaixo vale para qualquer portador; as fontes decidem o espectro e a Cena decide o caminho.

### 2.1 Tempo de emissão e Doppler por fonte

A Cena guarda o **histórico de poses do corpo** (posição do centro `P(t)` no mundo e rumo `ψ(t)`) a cada bloco de controle (64 amostras = 1,33 ms), num anel de `T_hist = maxDist/c + 0,1 s` (trem 400 m → 1,27 s; avião 3000 m → 8,8 s; só o corpo, não cada fonte). A posição de uma fonte no instante `t` é `r_i(t) = P(t) + R(ψ(t))·b_i`.

O som que chega em `t` saiu em `t − τ_i`, com

$$c\,\tau_i = \left|\,r_i(t-\tau_i) - O\,\right|$$

- **Decisão: dois resolvedores.** Para `M = v/c < 0,9`, iteração de ponto fixo `τ ← |r_i(t−τ) − O|/c` partindo do `τ` do bloco anterior, 3 iterações (converge porque `|dτ/dt| ≤ M`), lendo o histórico com interpolação linear. Vale para trajetória em volta. Para `M ≥ 0,9` (passagem da Turbina), a forma fechada de hoje em `jet-dsp.js` para a reta: `(c² − v²)τ² + 2Avτ − (A² + Q) = 0`, com as duas raízes depois do cone de Mach e o estrondo na cáustica. Não se mexe nela.
- O **atraso** `D_i = τ_i·fs` é aplicado por leitura com atraso fracionário (Hermite cúbica, `readProp` de hoje) no anel **da fonte**. Dentro do bloco de 64 amostras, `D_i` é interpolado por **parábola** (valores nos dois extremos do bloco e a derivada no início), não por reta: na passagem a 3 m e 350 km/h, `d²τ/dt² ≈ v²/(c·d) = 9,2 s⁻²`, e a reta erraria 1,6 amostras no meio do bloco no instante mais crítico. O Doppler sai sozinho: `f' = f/(1 − M cos θ_e)`, com `θ_e` o ângulo entre a velocidade e a direção fonte→ouvinte **no instante de emissão**.
- **Amplificação convectiva**: a amplitude leva `|1 − M cos θ_e|^(−expConv)`, limitada a 4 (12 dB) como hoje. `expConv` 2 para monopolos (escape, rolamento), 3 para dipolos (pás, aero), 1,4 para o jato (mantém o legado). A 350 km/h isto dá +5,8 dB chegando e −4,3 dB indo (monopolo): a assimetria real do trem, mais alto chegando.
- Números do caso de validação (v = 97,2 m/s, M = 0,283): fator Doppler 1,395 chegando, 0,779 indo; pico do rolamento 2 kHz → 2,79 kHz / 1,56 kHz; frequência de dormentes 162 Hz → 226 / 126 Hz; a varredura de 45° a 135° do ângulo acontece em ±3 m, ou seja em **62 ms**; de 170° a 10°, em 0,35 s; `df/dt` máximo = `f·v²/(c·d)` = 18,4 kHz/s para 2 kHz.
- Carro na rua a 6 m (não pode piorar): ignição de 200 Hz a 30 m/s → 216/183 Hz hoje (teoria 219/184). A Cena nova tem de dar 219 ± 1 / 184 ± 1 Hz medidos por pico do espectrograma.

### 2.2 Distância

Campo livre: `p(r) = p(refDist)·refDist/r`, com `r = c·τ_i` (distância de emissão), `r ≥ 0,5 m`. Para o nível: `L_p = L_W − 20·log₁₀ r − 11 dB` (fonte pontual). Nível sonoro de uma fonte que passa, para calibrar as fontes do portador pela medida de passagem:

$$\text{SEL} = L_W - 10\log_{10}(4\,v\,d_s), \qquad L_{Aeq,tp} = \text{SEL} - 10\log_{10} T_p$$

(`d_s` = distância fonte–ouvinte no ponto mais próximo, `T_p` = tempo de passagem do corpo). É daqui que saem os níveis de potência da seção 4.6.

### 2.3 Absorção do ar por banda

ISO 9613-1, 20 °C, 1 atm, umidade relativa `UR` (parâmetro, padrão 60%); valores em dB/km:

| f (Hz) | 125 | 250 | 500 | 1k | 2k | 4k | 8k |
|---|---|---|---|---|---|---|---|
| UR 30% | 0,4 | 1,2 | 2,4 | 4,7 | 12 | 42 | 140 |
| UR 60% | 0,4 | 1,0 | 1,9 | 3,7 | 9,7 | 33 | 117 |
| UR 80% | 0,3 | 1,1 | 2,8 | 5,0 | 9,0 | 23 | 77 |

Entre 1 e 8 kHz, `α(f) ≈ α₁ₖ·(f/1000)^1,6` dB/m. **Decisão: realização por fonte** = dois passa-baixas de 1 polo em cascata com corte `f_c(r)` tal que a absorção em `f_c` seja 3 dB:

$$f_c(r) = 1000\left(\frac{3}{\alpha_{1k}\, r}\right)^{1/1{,}6} \text{ Hz}, \quad \text{limitado a } [600,\ 20000]$$

Com UR 60%: `r` = 6 m → 20 kHz (nada); 30 m → 7,9 kHz; 100 m → 3,7 kHz; 300 m → 1,9 kHz; 1500 m → 680 Hz. O `flyby` legado usa `14000·(60/(r+60))^0,85` (1500 m → 900 Hz, limite inferior) e o `road` legado `20000·e^(−r/170)`: a Cena nova, aplicada ao avião a 1500 m, tem de ficar a ±3 dB por banda do legado (teste 5.4); se não ficar, o legado está certo por definição na etapa 1 e a diferença vai para o relatório.

### 2.4 Reflexão do solo (fonte-imagem)

Para cada fonte, segunda leitura no mesmo anel com atraso `r₂/c`, `r₂ = |r_i − O'|` onde `O'` é o ouvinte espelhado no solo (`z → −z`); altura da fonte `z_i` (ou `hCorpo`) e do ouvido `z_O`. Ganho `R(f)` do solo como um passa-baixa de 1 polo mais ganho:

| Solo | ganho | f_c (Hz) |
|---|---|---|
| asfalto | 0,95 | 4500 (o `road` de hoje: 0,6 de mistura e 4,5 kHz; o 0,6 incluía o espalhamento, aqui ele vai para a geometria) |
| concreto / laje | 0,97 | 8000 |
| brita (via ferroviária) | 0,55 | 800 |
| grama | 0,70 | 1500 |
| água | 0,99 | 12000 |
| nenhum (ponte, a bordo) | 0 | — |

Interferência pente: nulos em `f_n = (2n−1)·c/(2Δr)`, `Δr = r₂ − r₁`. Números: escape do carro (`z_i` 0,35, `z_O` 1,6, `d` 6) → `Δr` 0,18 m, primeiro nulo 950 Hz; roda do trem (`z_i` 0,3, `d` 3) → `Δr` 0,28 m, nulo em 612 Hz; pantógrafo (`z_i` 5,0, `d` 3) → `Δr` 2,5 m, nulos em 68, 205, 343 Hz… (pente denso: o pantógrafo soa "em fase" só abaixo de 50 Hz). Abaixo do primeiro nulo as duas chegam em fase (+6 dB na pressão com `R` = 1); o reforço de +3 dB em 110 Hz dos microfones junto ao carro (`radSh`) continua no legado e **não** é aplicado na Cena nova, porque aqui a imagem é calculada de verdade. Teste 5.2: ruído branco numa fonte, espectro na saída, nulo medido a ±3% de `c/(2Δr)`.

### 2.5 Sombra do próprio corpo

Fonte do lado oposto do corpo ao ouvinte (`sign(y_i) ≠ sign(y_O_corpo)` e `|y_O_corpo| > largura/2`), ou fonte sob o corpo vista de cima, é atenuada pela barreira (Maekawa): número de Fresnel `N = 2δ/λ`, `δ` = caminho sobre a borda menos o caminho direto, atenuação `A = 10·log₁₀(3 + 20N)` dB para `N > 0`, limitada a 24 dB. **Decisão: realização** = ganho `g_lo` abaixo de `f_s` e `g_hi` acima (1 shelf de 1 polo), com `g_lo = A(f = 100 Hz)`, `g_hi = A(1 kHz)` e `f_s = 400 Hz`, recalculados a cada bloco de controle; `δ` é computado com a borda do teto (`z = altura`) e com a borda do piso (`z = zPiso`, caminho por baixo) e vale o **menor** `A` dos dois (o som escolhe o caminho mais fácil; por baixo do trem o vão de 0,3–0,5 m até o trilho deixa passar bastante grave). Exemplo trem (largura 3,36, altura 3,6, roda oposta a `y` = −1,5, `z` 0,3; ouvinte `y` 4,68, `z` 1,6): por cima `δ` = 2,9 m → 15,7 dB a 100 Hz, 24 dB a 1 kHz; por baixo (borda em `z` 0,4, `y` 1,68) `δ` ≈ 0,09 m → 6 dB a 100 Hz, 11 dB a 1 kHz: vale o caminho por baixo, roda oposta chega 6–11 dB mais fraca. Pantógrafo (`z` 5): sem sombra. No carro, a sombra atual da carroceria para quem está na frente (`shade`: passa-baixa `900 + 15000·rear²`) fica como está na **diretividade** do escape do adaptador (tabela de 1.3), não na sombra geométrica.

### 2.6 Onda de pressão de nariz e cauda

Campo próximo aerodinâmico, não acústico: ao passar o nariz, o ouvinte sente um pulso positivo seguido de negativo (e o inverso na cauda), de duração `≈ L_nariz/v` e energia abaixo de 10 Hz.

$$p_n(t) = \Delta p \cdot \frac{t - t_n}{\sigma}\,\exp\!\left(-\frac{(t-t_n)^2}{2\sigma^2}\right), \quad \sigma = \frac{L_{nariz}}{3v}, \quad \Delta p_{pp} = c_p\,\tfrac{1}{2}\rho v^2\left(\frac{1\ \text{m}}{d}\right)^{1{,}5}$$

- `c_p = cpNariz` do corpo: trem-bala moderno 0,14 (ICE3/N700 medem 600 Pa pico a pico a 2,5 m do eixo, 300 km/h; o limite TSI é 795 Pa), trem convencional rombudo 0,30, carro 0,05, caminhão 0,12.
- Caso de validação: `q = ½·1,2·97,2² = 5,67 kPa`, `d` = 3 m → `Δp_pp ≈ 0,14·5670·(1/3)^1,5 = 153 Pa` (±76 Pa, 131,6 dB de pico; a energia está em `1/(2πσ)` ≈ 3 Hz com `σ` = 15/(3·97) = 51 ms). A cauda repete com sinal trocado e 70% da amplitude. No carro a 6 m: `Δp_pp` ≈ 1,6 Pa a 100 km/h: desprezível, não se liga.
- **Decisão: dois destinos.** (a) `pressaoPa` na telemetria e no mostrador (o "soco" que o espectador sente). (b) Para o alto-falante, só o resíduo acima de 20 Hz (passa-alta de 2 polos em 20 Hz) **mais** o vento induzido (2.8), que é o que de fato se ouve: um "whump" curto.
- Fonte `tipo: 'pressao'` posicionada no nariz e na cauda; não passa pelo anel de propagação (campo próximo, viaja com o corpo): o instante `t_n` é o de o nariz ficar abeam do ouvinte, e a amplitude usa a distância do instante.

### 2.7 Ruído aerodinâmico do corpo

Potência `∝ v⁶` (dipolo): +60·log₁₀(v₂/v₁) dB (200 → 350 km/h: +14,6 dB). Espectro largo com pico em 200–500 Hz, caindo 3 dB/oitava para cima até 2 kHz e 6 dB/oitava acima; abaixo de 100 Hz, 6 dB/oitava para baixo. Realizado por fonte com ruído com semente, um passa-banda largo (`bp` em 350 Hz, Q 0,5) mais um passa-baixa de 2,5 kHz, e modulação lenta de ±2 dB (0,3–3 Hz) para não soar liso. Fontes aero do portador: uma por segmento na face voltada para o ouvinte (`y = ±largura/2`, `z = 0,5·altura`), uma por truque/eixo (`z` 0,5, região sob o corpo: a Cena aplica a sombra do piso), uma por vão (2.9), uma por pantógrafo, nariz e cauda. Na etapa 1 só o trem e o carro em alta velocidade têm fontes aero; no carro ela fica **desligada por padrão** (o som do Ronco não pode mudar), com chave no painel.

### 2.8 Vento induzido no ouvinte

A camada limite e a esteira do corpo chegam ao ouvinte como vento nos ouvidos. Velocidade do ar no ouvinte:

$$u(t) = u_0\,\frac{v}{v_{ref}}\left(\frac{1\ \text{m}}{d}\right)^{0{,}7} w(t)$$

com `u₀` = 10 m/s a `v_ref` = 300 km/h e `w(t)` uma rampa que sobe em `L/v` (ao longo do corpo) até 1 e decai com constante 3 s depois da cauda (a esteira); em túnel soma-se o pistão (2.9). A 3 m e 350 km/h: pico ≈ 5,4 m/s a céu aberto. Nível no ouvido: `L_vento = 70 + 60·log₁₀(u/10)` dB (10 m/s → 70 dB; 20 m/s → 88 dB), espectro passa-baixa com corte 150 Hz mais um ombro a −12 dB em 1 kHz (turbulência nas orelhas), **independente por ouvido** (ruído com sementes diferentes), sem propagação (está no ouvinte). É o mesmo gerador do `vento` de fundo do ambiente, só que comandado pela passagem.

### 2.9 Vãos entre vagões: o "wu wu wu"

Três mecanismos, todos a `f_vão = v/L_c` (`L_c` = passo do vagão, incluindo o vão; 25 m → **3,89 Hz** a 350 km/h), e todos saem da geometria, não de um oscilador:

1. **Cavidade do vão**: fonte `tipo: 'vao'` no centro de cada vão (`x` = junção, `y` 0, `z` 0,5·altura), ruído com corcova em 50–400 Hz e picos de Rossiter

   $$f_m = \frac{v}{W}\,\frac{m - 0{,}25}{1/\kappa + M}, \quad \kappa = 0{,}57$$

   (`W` = 0,5 m → 71,6, 167 e 262 Hz a 350 km/h; `bp` com Q 5 em cada, −6 dB por ordem), potência `∝ v⁶`, nível 3 dB abaixo da fonte aero do segmento vizinho. Como a fonte tem 0,5 m e passa a 3 m, cada vão é um pulso de ≈ 60 ms: 9 pulsos em 2,3 s.
2. **Pares de truques**: cada vagão tem truques a `truqueExtremidade` (3,75 m) de cada ponta; através de um vão ficam dois truques a 8 m um do outro e 17,5 m até o par seguinte. O rolamento visto de 3 m pulsa portanto num padrão duplo: dois picos separados por 82 ms e depois 180 ms de intervalo. É o que dá o "wu-wu" rápido dentro do ritmo de 3,89 Hz.
3. **Profundidade**: a 3 m da lateral, o ouvinte "vê" só os ~6 m mais próximos do trem; quando o meio do vagão está abeam, os truques mais próximos estão a 10 m. Energia `(3,9/10)²·2` ≈ 0,3 → **−5 dB** no total e **−8 a −10 dB** na banda 1–4 kHz do rolamento, enquanto o aero do corpo (uniforme ao longo do vagão) preenche o fundo.

**Alvo de validação** (render de 12 s, 10 vagões, 350 km/h, 3 m, céu aberto e túnel): envoltória RMS de 20 ms na banda 1–4 kHz, FFT da envoltória durante a passagem do corpo → pico em `3,89 ± 0,1 Hz` com profundidade `p90 − p10 ≥ 6 dB`; na banda 50–200 Hz, 9 pulsos ≥ 8 dB sobre o nível de meio de vagão, cada um com 40–80 ms. Duração da passagem do corpo `L/v` = 250/97,2 = **2,57 s** (±0,05) entre o nariz e a cauda abeam.

### 2.10 Ambientes da passagem

A reverberação continua na thread principal (`ConvolverNode` com resposta sintética por ambiente, como `ENVS` hoje) e é alimentada pelos canais 2–3 com `1/√r` e sem panorâmica forte (como `roadS`). O que muda: cada ambiente ganha **RT60 por banda** (a resposta é gerada com decaimento por banda: ruído filtrado em 4 bandas, cada uma com a sua constante) e os efeitos **dentro do worklet** listados abaixo. Os ambientes atuais (céu aberto, rua, túnel, garagem, autódromo, serra; pista, pátio, hangar, célula, vale, porta-aviões) continuam com os parâmetros atuais nos modos legados.

| Ambiente | RT60 (s) 125 / 500 / 2k / 8k Hz | Reflexões iniciais | Solo | No worklet |
|---|---|---|---|---|
| céu aberto | 0,6 / 0,4 / 0,3 / 0,2 (o `open` de hoje) | só o solo | conforme a via | — |
| corte (trincheira, taludes a 8 m, 45°) | 1,0 / 0,9 / 0,7 / 0,5 | 2 laterais a 20–60 ms, ganho 0,45/0,3, flutter 0,05 | brita | — |
| estação (plataforma coberta, cobertura a 7 m) | 2,5 / 2,0 / 1,6 / 0,9 | teto 12 ms (0,5), 2 paredes 30–60 ms (0,35), piso | concreto | fundo: murmúrio, PA opcional |
| túnel (64 m², 2 km, concreto) | 5,0 / 4,0 / 2,8 / 1,0 | paredes a 2 m e teto a 5 m: pente denso 5–30 ms (0,5), flutter 0,041 | laje (concreto) ou brita (−50% no RT) | pistão, onda de compressão, fundo da ventilação (hoje `tunnel`) |
| ponte (viaduto, ouvinte na lateral do tabuleiro) | 0,5 / 0,4 / 0,3 / 0,2 | nenhuma além do tabuleiro | tabuleiro até 3 m do trilho, depois `nenhum` | ronco estrutural: fonte `mecanica` em 31–125 Hz, nível `∝` carga por eixo, +5 dB nas bandas 31–125 Hz durante a passagem |

**Túnel, efeito pistão.** Bloqueio `β = areaFrontal/area` (11,2/64 = 0,175). Onda de compressão ao entrar (Hara, baixo Mach):

$$\Delta p_e \approx \tfrac{1}{2}\rho v^2\,\frac{1 - (1-\beta)^2}{(1-\beta)^2}$$

= 2,6 kPa a 350 km/h, `β` 0,175 (medições com carenagem de entrada dão 20–30% menos: usar 0,75× → **≈ 2,0 kPa**); tempo de subida inicial `L_nariz/v` ≈ 0,15 s. A onda viaja a `c` na frente do trem e chega ao ouvinte (a `x_O − x_entrada` da boca) `(x_O − x_entrada)·(1/c − 1/v)` antes do trem: 500 m dentro → 3,7 s antes. Reflete na outra boca com sinal invertido (expansão) e volta; período `2·L_túnel/c` (2 km → 11,7 s), decaindo 20% por reflexão. Vai para `pressaoPa`, para o alto-falante só o resíduo acima de 20 Hz (um "thud" surdo) e para o vento. Vento do pistão no ouvinte: `u_a = v·β/(1−β)·0,75` (atrito) = 15 m/s durante a passagem do corpo, caindo para a esteira depois (2.8): isto é o que mais se ouve no túnel antes e depois do trem, ~85 dB de ruído grave. Nível do campo reverberante: alvo **+7 ± 2 dB** no `L_Aeq,tp` da passagem em relação ao céu aberto, e o nível com o nariz a 100 m fica só 10–12 dB abaixo do pico (a céu aberto fica 23 ± 4 dB abaixo).

### 2.11 Números-alvo

**Trem-bala, 10 vagões de 25 m, 350 km/h, túnel, ouvinte a 3 m da lateral, 1,6 m de altura** (motor `nenhum`):

| Grandeza | Alvo |
|---|---|
| passagem nariz→cauda abeam | 2,57 ± 0,05 s |
| modulação dos vãos (banda 1–4 kHz) | 3,89 ± 0,1 Hz, profundidade ≥ 6 dB; padrão duplo 82 ms + 180 ms visível na envoltória do rolamento |
| pulsos de vão (50–200 Hz) | 9, ≥ 8 dB sobre o meio do vagão |
| Doppler (tom de teste de 1 kHz numa fonte do nariz) | 1395 ± 5 Hz → 779 ± 5 Hz; transição 45°–135° em 62 ± 5 ms |
| assimetria chegando/indo (monopolo, mesma distância) | +10 ± 1 dB |
| onda de nariz | pico a pico 150 ± 30 Pa, `σ` 51 ms; cauda −70% |
| onda de compressão do túnel | 2,0 ± 0,4 kPa, chega 3,7 s antes do trem (ouvinte 500 m dentro) |
| vento no ouvinte | 15 m/s (pistão) durante o corpo, esteira decaindo 3 s |
| nível relativo: pico (L_AFmax) − (nariz a 100 m) | túnel 10–12 dB; céu aberto 23 ± 4 dB |
| túnel − céu aberto no L_Aeq,tp | +7 ± 2 dB |
| absoluto a céu aberto (para o mostrador) | L_Aeq,tp 108 ± 3 dB(A), L_AFmax 113 ± 3 dB(A); túnel 115 / 120 |
| balanço espectral do pico a céu aberto (dB rel. 150–400 Hz, mono, sem ponderação) | 60–150: +4; 400–1k: −1; 1–2,5k: +1; 2,5–6k: −2; 6–12k: −10; centroide ≈ 1,2 kHz (±4 dB; refinar contra gravações de Shinkansen/ICE do Wikimedia Commons, descartando trechos com vento no microfone) |

**Casos existentes (não podem piorar; medidos no legado antes de qualquer mudança e guardados em `tools/cena/referencia/`):**

| Caso | Medida | Referência (legado) |
|---|---|---|
| carro na rua a 6 m (`road`, Camaro SS, 3ª marcha, 30 m/s) | Doppler da ignição de 200 Hz | 216/183 Hz (teoria 219/184); a Cena nova: 219 ± 1 / 184 ± 1 |
| idem | bandas no instante abeam (dB rel. 150–400) e curva nível × `x` a cada 0,25 s | ±1,5 dB por banda; ±1 dB na curva |
| idem | nulo da reflexão do solo | 950 ± 30 Hz (hoje é um passa-baixa de 4,5 kHz + 0,6 de mistura, sem pente explícito: registrar o espectro atual e aceitar ±3 dB entre 500 Hz e 2 kHz) |
| avião a 1500 m (`flyby`, 737, 300 km/h) | bandas no ponto mais próximo e 10 s antes | ±2 dB por banda; absorção do ar: 4 kHz ≤ −20 dB em relação a 500 Hz |
| estrondo sônico (M 1,5, 200 m) | instante do cone | 3,37 s (teoria 3,38); Cena nova: idêntico ± 1 ms (usa o mesmo resolvedor) |
| idem | `Δp` e `T` de Carlson, forma em N | idênticos (mesmo código) |

---

## 3. Modo de testes, ouvinte em gimbal e cena 3D

### 3.1 Parâmetros livres

| Parâmetro | Faixa | Padrão por portador |
|---|---|---|
| `trajetoria.tipo` | reta / volta | reta (trem, avião); volta (carro, locomotiva) |
| `comprimento` | 200–20 000 m | carro 800; trem 3000; avião 6000 (o `PASS_LOOP` de hoje); locomotiva 2000 |
| `raioCurva` | 20–3000 m | carro 60; locomotiva 400; trem 2000 |
| `altitude` | 0–3000 m | 0; avião 150 (como hoje) |
| `lateral` (d) | 1–3000 m | carro 6; trem 3; avião 0 (passa por cima) |
| `velocidadeFixa` | 0–2500 km/h ou "do motor" | trem 350; avião 300; carro "do motor" |
| ambiente | tabela 2.10 | trem: túnel; carro: rua; avião: pista |
| `solo.tipo`, `UR` | tabela 2.4; 20–90% | pela via; 60% |
| trem: `N`, `L_c`, `vao`, `truqueExtremidade`, `L_nariz`, pantógrafos | 1–20; 15–27 m; 0,2–1 m; 2–5 m; 0–20 m; lista de vagões | 10; 25; 0,5; 3,75; 12; [3, 8] |

Parado (`v` = 0 ou portador sem trajetória), a passagem vira o caso "ao redor do motor" de hoje, com o gimbal.

### 3.2 Gimbal do ouvinte

Centro no `alvo` (centro do corpo ou uma fonte), `az` ∈ [−180°, 180°] (0 = frente do corpo, +90 = esquerda), `el` ∈ [−20°, 89°], `r` ∈ [0,3, 300] m, ouvido a `z ≥ 0,2` (não entra no chão). Atalhos do painel:

| Atalho | az, el, r | `local` | O que domina |
|---|---|---|---|
| atrás no escape | 180°, −10°, 1,5 m (alvo `escape.0`) | fora | ponteira mais próxima pela diretividade `[-14…0]`; outras ponteiras pela distância |
| ponteira | 180°, 0°, 0,3 m (alvo `escape.0`) | ponteira | só a ponteira do alvo; as outras fontes −20 dB (o `pipe` de hoje) |
| na frente | 0°, 0°, 3 m | fora | admissão, hélice, rotor (eixo `[1,0,0]`); escape pela sombra/diretividade |
| lateral | 90°, 0°, 5 m | fora | tudo, com ITD cheio entre fontes da frente e de trás |
| câmera atrás (hoje `ext`) | 180°, 5°, 4 m | fora | o que o `ext` dá hoje |
| cabine | ponto dentro do corpo (`[−0,3, 0,4, 1,1]` no carro) | cabine | lei da massa + habitáculo |
| cofre | ponto no compartimento do motor | cofre | admissão, comando, bloco; escape por baixo |
| em cima do pantógrafo / rotor | 0°, 89°, altura + 1 m | fora | pás e pantógrafo sem sombra |

### 3.3 Filtros de localização

Por fonte `i`, o ganho é o produto `D_i(θ_i)·S_i·G_r(r_i)·A_ar(r_i, f)·R_solo(f)` (seções 2.1–2.5) e depois o filtro do **local** do ouvinte; `θ_i` é o ângulo entre o eixo da fonte (no corpo, na pose do instante de emissão) e o vetor fonte→ouvinte. As tabelas de diretividade são as de 1.3 e 4.x e seguem a convenção de `DIR` (7 pontos, interpolação linear em dB).

- **fora** (`binaural: true`): panorâmica por `pan = sin(azimute relativo à cabeça)` com lei de −3 dB, mais **ITD** por fonte `Δt = 0,65 ms·sin(az)` (anel curto de 2 ms por fonte, como `itdB` hoje para as ponteiras), **ILD**: shelf de −6 dB acima de 1,5 kHz no ouvido oposto, escalado por `|sin(az)|`, e sombra da cabeça para trás: −3 dB acima de 3 kHz para `|az| > 120°`. A cabeça olha para o alvo do gimbal.
- **cabine fechada**: perda de transmissão pela lei da massa `TL(f) = 20·log₁₀(f·m_s) − 47 dB` com `m_s = massaSuperficial`, limitada a [5, 45] dB, realizada como 2 passa-baixas de 1 polo com cortes `f₁ = 891/m_s` Hz (onde a lei da massa dá TL = 12 dB) e `f₂ = 2,6·f₁` (para o carro, `m_s` 12 → 74 e 190 Hz; **mas** o carro mantém o filtro atual por decisão: `lp 420 + lp 1100 + peak 70 Hz Q 1,1 +7 dB` reproduz o que foi ajustado de ouvido, e a fórmula serve para trem, helicóptero e gerador com carenagem; para o avião vale o atual `380/900/110 Hz`). Soma-se a ressonância do habitáculo (`peak` em `fCabine`, Q 1,1, +7 dB), e as fontes `dentro: true` chegam também por via **estrutural** (vibração do bloco: `vib` de hoje, `+1,2`; mecânica por `lp 1200`; admissão por `lp 900`, pesos 0,35/0,2 como hoje). Vento e rolamento chegam pela casca como as demais. Reverberação do ambiente: 25% (como `cabin` hoje).
- **cofre**: fontes `dentro: true` diretas (pesos de hoje: admissão 1,0, mecânica 0,7, compressor 0,8, freio 1, bloco 0,8); fontes de fora pelo `lp 900` com 0,55 (o `bayEx`); sem propagação nem solo.
- **ponteira**: fonte-alvo a 0,3 m, outras −20 dB, sem solo.
- **auto**: cabine se o ponto do gimbal cai dentro de algum segmento (caixa `comprimento × largura × altura` acima de `zPiso`), senão fora.
- **Combinação com a diretividade**: dentro (cabine/cofre) a diretividade e a sombra **não** se aplicam (a casca domina); fora, aplicam-se sempre. Para a hélice/rotor de perto a diretividade `[−18,…]` da `DIR.prop` no eixo é o que faz "na frente" soar oco e "de lado" cheio.

### 3.4 Cena 3D (three.js, só na thread principal)

Desenhar, em unidades de metro, câmera perspectiva 50°:

1. **Chão**: plano com grade de 10 m (fina) e 100 m (grossa), cor do solo (asfalto cinza, brita bege, grama verde); no túnel, um tubo de seção retangular 8 × 8 m (ou da `area`) ao longo da trajetória, semitransparente por dentro; na estação, piso elevado e cobertura; no corte, dois taludes; na ponte, tabuleiro estreito sem chão.
2. **Via/pista**: fita de 3,5 m (estrada) ou dois trilhos com dormentes a 0,6 m (via) ao longo da trajetória; na volta, oval com os semicírculos; avião: linha tracejada no ar na `altitude`.
3. **Corpo**: um `BoxGeometry` por segmento, com o vão entre eles, nariz/cauda como cunhas; truques como caixas sob o piso; pantógrafo como "Z" fino sobre o teto; hélice/rotor como disco transparente girando na rotação real (telemetria); cor do portador.
4. **Fontes**: esfera de 0,2 m por fonte, cor por `tipo` (escape vermelho, admissão azul, mecânica laranja, pá ciano, rolamento amarelo, aero branco, vão magenta, pantógrafo verde, pressão roxo); raio escalado pelo `ganhoDb` instantâneo (telemetria) com `r = 0,15 + 0,25·clamp((g + 40)/40)`.
5. **Fantasma de emissão**: cópia translúcida do corpo na pose `posEmitida` (onde estava o que você ouve agora). É o que torna o Doppler visível.
6. **Ouvinte**: cabeça (esfera 0,25 m) com nariz (cone) na direção do alvo, a `z` do ouvido; arcos do gimbal (anel de azimute no plano do alvo, arco de elevação) e linha pontilhada até o alvo com o `r` escrito.
7. **Trajetória**: linha; marcador de "ponto mais próximo"; no avião supersônico, o cone de Mach (como no canvas atual).
8. **HUD** (texto): `v`, distância de cada grupo de fontes, `pressaoPa`, `ventoMs`, `splDbA`, Doppler estimado da fonte-alvo.

**Câmera**: três modos, tecla `C`. (a) **Orbital no ouvinte** (padrão): `OrbitControls` com alvo na cabeça; (b) **Segue o corpo**: alvo no centro do corpo, posição relativa fixa escolhida pelo arrasto; (c) **Livre**. A trajetória "reta" reaparece do outro lado: a câmera não segue o salto, o corpo some e reaparece.

**Arrasto** (raycast no plano do chão com `shift` para altura): a **cabeça** (muda `pos` no modo fixo ou `az/el/r` no gimbal, com snap a 5° e 0,5 m), as **alças do gimbal** (anel: azimute; arco: elevação; linha: distância), o **corpo** ao longo da via (muda `s`, para posicionar antes da passagem), a **lateral da via** (muda `trajetoria.lateral`), a **altura da linha de voo** (`altitude`). Clique numa fonte: vira alvo do gimbal e mostra a ficha (tipo, posição, `refDist`, diretividade, ganho). Tudo que o arrasto muda vai para o worklet com rampa de 20 ms, pelo `atualizar()`.

Desempenho: 30 fps, telemetria do worklet a cada 1024 amostras (21 ms) interpolada linearmente; sem sombras dinâmicas; um só `requestAnimationFrame` compartilhado com os mostradores.

---

## 4. Portadores da etapa 1

Cada portador: parâmetros (campos de preset editáveis no painel), carga sobre o motor, fontes próprias com espectro e nível de referência, e referências numéricas. Níveis de referência das fontes próprias são **níveis de potência sonora** `L_W` em dB(A) re 1 pW (seção 2.2 converte para pressão), com a lei de velocidade `L_W(v) = L_W(v_ref) + 10·n·log₁₀(v/v_ref)`.

### 4.1 Carro com câmbio (`CarroLegado`)

O que existe em `EngineDSP` (massa, potência, relações, diferencial, raio da roda, arrasto, embreagem, câmbio, modos do automático, corte de giro, 2-step) continua lá; o portador é um adaptador fino. `F = T·i_marcha·i_final/r_w − ½ρC_dA·v² − 0,012·m·g − freio·0,9·m·g`, `dv/dt = F/m` (como hoje). Corpo: 1 segmento (4,6 × 1,85 × 1,4 m, `zPiso` 0,15, `cpNariz` 0,05, `m_s` 12, `fCabine` 70). Fontes próprias (todas **desligadas por padrão** na etapa 1, chaves no painel):

| Fonte | Posição | Espectro | `L_W` (v_ref 80 km/h) e `n` |
|---|---|---|---|
| `pneu.k` (4) | contato, `z` 0 | pico em 800–1250 Hz, −10 dB em 250 Hz e 4 kHz; modulação pela textura (ruído lento) | 95 dB(A) por roda, `n` 3,5 (73 dB(A) a 7,5 m para o carro todo a 80 km/h) |
| `aero` | para-brisa/retrovisores `[0,8, ±0,9, 1,0]` | seção 2.7 | 80 dB(A) a 80 km/h, `n` 6 |

### 4.2 Hélice com redutor (migra da Turbina)

Parâmetros: `B` pás, `D` m, `i` (rpm motor / rpm hélice), `nHelice` rpm governada, `J_hel` kg·m², passo mín/máx, `cQ0` (torque adimensional em passo fino). Carga: a hélice gira a `Ω_h = ω/i`; torque refletido no motor

$$Q_{motor} = \frac{Q_h}{i}, \quad Q_h = c_Q(\beta, J)\,\rho\,n_h^2 D^5, \quad n_h = \Omega_h/2\pi, \quad J_{adv} = v/(n_h D)$$

com `c_Q(β) = cQ0·(1 + 6·(β − β_min)/(β_max − β_min))` (passo fino → grosso multiplica o torque por ~7) e `−0,3·J_adv·c_Q` de alívio com a velocidade de avanço; inércia refletida `J_hel/i²`. **Governador de rotação constante** (como hoje na Turbina): PI sobre `β` com `K_p` = 0,02 rad por % de erro de rpm e `K_i` = 0,01/s, limites de passo, taxa máxima 5°/s; abaixo de 60% da `nHelice` o passo fica no mínimo (hélice de passo fixo: `i` e `β` fixos, `c_Q` constante). Reverso: `β < 0`, ruído largo da pá ×2 (hoje `rev`).

Fontes (`refDist` 30 m, como hoje): `helice.e`, `pos` no cubo, eixo `[1,0,0]`, `dir` = `DIR.prop` `[−18,−8,−3,0,−1,−6,−18]`, `expConv` 3. Espectro: BPF `f_B = B·n_h` com harmônicos `a_h = exp(−(h−1)·κ)`, `κ = 0,1 + 2,6·(1 − M_t)^1,3`, pulso de espessura `∝ M_t²` e dipolo de carga `∝` potência, exatamente a `buildPropTab` de hoje; `M_t = √((πDn_h)² + v²)/c`. Ruído largo de pá (`pbb`): `bp` em `900 + 900·M_t` Hz. A migração para `carriers/helice` é **idêntica amostra a amostra** para os presets turboélice (`takeoff`, `flyby`), o que é verificado pelo teste 5.10.

| Aeronave | B | D (m) | n_h (rpm) | i | BPF (Hz) | M_t estático |
|---|---|---|---|---|---|---|
| Cessna 172 (O-320) | 2 | 1,93 | 2700 | 1 | 90 | 0,80 |
| Cessna 208 Caravan (PT6A-114) | 3 | 2,69 | 1900 | ≈ 15,6 (turbina livre 29 600) | 95 | 0,79 |
| ATR 72 (PW127) | 6 | 3,93 | 1200 | ≈ 17 | 120 | 0,72 |
| Spitfire (Merlin) | 4 | 3,27 | 1260 | 2,38 (0,42:1) | 84 | 0,63 |
| Tu-95 (NK-12, contrarrotativa) | 2 × 4 | 5,6 | 750 | ≈ 11 | 50 e 100 (interação) | 0,64 parado; ≈ 1,0 em cruzeiro |

### 4.3 Rotor de helicóptero

Parâmetros: rotor principal `B`, `R`, `Nr` rpm (fixo), `σ` solidez, `c_d0`, `J_rot`; rotor de cauda `B_c`, `R_c`, `i_c` (razão para o principal), posição `[−L_cauda, 0, z_c]` e inclinação; caixa `i_cx` (rpm motor / Nr), engrenagens `z_k` e rotações de cada estágio; `massa` (peso = tração em voo pairado), `m_s` 5, `fCabine` 60. Corpo: 1 segmento (cabine + cauda, ex.: R44 11,7 × 1,3 × 3,3 m).

**Comando**: coletivo `c ∈ [0, 1]` → tração `T = T_pairado·(0,25 + 1,0·c)` (`c` ≈ 0,75 paira; acima, sobe), `T_pairado = m·g`. Carga sobre o motor (Nr fixo pelo governador, então `Ω = Nr·2π/60` e `Q = P/Ω`):

$$P = \underbrace{\frac{T^{3/2}}{\sqrt{2\rho A}}\cdot\frac{1}{FM}}_{\text{induzida}} + \underbrace{\frac{\rho A \sigma c_{d0} (\Omega R)^3}{8}}_{\text{perfil}} + P_{cauda} + P_{acess}, \quad A = \pi R^2, \quad FM = 0{,}72, \quad P_{cauda} = 0{,}1\,P_{principal}, \quad P_{acess} = 5\ \text{kW}$$

R44 (m 1090 kg, R 5,03, Nr 408, σ 0,033): induzida 79 kW/0,72 = 110, perfil 40, cauda 15, acessórios 5 → **170 kW ≈ 228 hp** no coletivo de voo pairado, contra 245 hp disponíveis do O-540 (coerente). Torque refletido no motor `Q/i_cx`, inércia `J_rot/i_cx²` (R44: `J_rot` 700 kg·m², `i_cx` 6,66 → 15,8 kg·m² no eixo do motor, bem maior que o volante). **Governador**: mantém Nr em 100% ± 2%: PI sobre `combustivel` com `K_p` = 0,8 por % de erro, `K_i` = 0,4/s, limitado a [0, 1]; ao puxar o coletivo depressa, Nr cai 2–3% ("droop") e recupera em ~1 s — todas as frequências abaixo descem e sobem junto: é o som do helicóptero "pesando". Sem motor (`nenhum`): Nr é imposto.

Fontes (`refDist` 7,5 m; posições do R44: rotor `[0,2, 0, 3,3]`, cauda `[−5,8, 0, 1,8]`, caixa `[0,0,0,2,4]`):

| Fonte | Espectro | Diretividade | Nível e lei |
|---|---|---|---|
| `rotor.principal` (`pa`) | BPF `f = B·Nr/60`; harmônicos de carga `a_h = exp(−(h−1)·κ_L)`, `κ_L = 0,22 + 0,5·(1 − c)`; espessura `∝ M_t²` com `κ_T` 0,35; **tapa (BVI)**: trem de pulsos a BPF, cada pulso `exp(−t/τ_p)` com `τ_p` 2,5 ms e `sin` de 400–900 Hz, amplitude `∝ c^2` (cresce com o coletivo e com o ângulo de descida, se houver), `κ_BVI` 0,08 até o 40º harmônico | eixo `[0,0,1]`: tabela `[−8,−3,0,0,−2,−6,−10]` (carga irradia para baixo e no plano; espessura no plano) | `L_W` 118 dB(A) em pairado (R44), +10·log₁₀(T/T_pairado)·3 com o coletivo |
| `rotor.cauda` (`pa`) | BPF `B_c·Nr·i_c/60` com `κ` 0,3, zumbido 60–300 Hz; interação com o principal: modulação em `f_B,principal` | eixo transversal `[0,1,0]`: `[0,−1,−3,−8,−3,−1,0]` | `L_W` 110 dB(A), `∝` 10·log(P_cauda)·1 |
| `caixa` (`mecanica`) | tons de engrenamento `f_k = z_k·n_k/60` (R44: cônica espiral 1,2–1,5 kHz; UH-60: planetário ~ 700 Hz, cônicas 1–3,5 kHz) com bandas laterais ±Nr/60 e Q 20, mais ruído 1–4 kHz | omni; `dentro: true` | `L_W` 100 dB(A), +6 dB por duplicação do torque |
| `aero` | downwash: ruído largo `lp` 400 Hz modulado a BPF | omni | `L_W` 100 dB(A) `∝ c^3` |

| Helicóptero | B | D (m) | Nr (rpm) | BPF (Hz) | ponta (m/s) | cauda: B_c, rpm → BPF (Hz) |
|---|---|---|---|---|---|---|
| Robinson R44 | 2 | 10,06 | 408 | 13,6 | 215 | 2, ≈ 2800 → ≈ 93 (aprox.) |
| Robinson R22 | 2 | 7,67 | 530 | 17,7 | 213 | 2, 3330 → 111 |
| AS350 Esquilo | 3 | 10,69 | 390 | 19,5 | 218 | 2, 2086 → 69,5 |
| Bell 206 | 2 | 10,16 | 394 | 13,1 | 210 | 2, ≈ 2550 → ≈ 85 (aprox.) |
| UH-60 Black Hawk | 4 | 16,36 | 258 | 17,2 | 221 | 4, 1190 → 79,3 |
| Mi-8 | 5 | 21,29 | 192 | 16,0 | 214 | 3, 1124 → 56,2 |

Em voo pairado os harmônicos 1–10 da BPF ficam dentro de 20 dB ("wop"); em descida/aproximação o BVI leva os harmônicos 10–40 a dentro de 10 dB ("slap"). O rotor de cauda domina em 60–300 Hz de perto e de lado; a caixa domina dentro da cabine.

### 4.4 Gerador

Parâmetros: `polos` (2 ou 4), `fRede` (50/60 Hz) → `rpm = 120·fRede/polos` (1500, 1800, 3000, 3600), `potenciaNominal` kW, `η` 0,92, `J_alt`, ventilador (`B_v` pás, `rpm_v` = rpm, `D_v`), carenagem (sim/não, `m_s` 15), `droop` 0–4%, classe ISO 8528 (G2: queda ≤ 10% e recuperação ≤ 5 s num degrau de 100%; G3: ≤ 7%, ≤ 3 s). Corpo: 1 segmento (contêiner 3 × 1,2 × 1,8 m). Carga: `Q = cargaFracao·P_nominal/(η·ω)`, aplicada com rampa de 0,1 s (o alternador responde na hora); governador isócrono PI sobre `combustivel` (`K_p` 0,5 por %, `K_i` 0,5/s) com atraso de 0,3 s da bomba: um degrau de 50% derruba a rotação 5–6% e recupera em ~2 s com sobrepasso de +1% (alvo medido no teste 5.10: queda entre 4 e 8%, recuperação ±2% em < 3 s). Degraus do painel: 0 / 25 / 50 / 75 / 100%.

Fontes (`refDist` 7,5 m):

| Fonte | Espectro | Nível |
|---|---|---|
| `alternador` (`eletrica`) | `2·fRede` (100/120 Hz) e harmônicos ímpares dele (300/360, 500/600…), Q 30, + ranhuras `z_r·rpm/60` | `L_W` 85 dB(A) em vazio, +8 dB a 100% (magnetostrição e forças ∝ I) |
| `ventilador` (`pa`) | BPF `B_v·rpm/60` (8 pás a 1500 → 200 Hz) com 3 harmônicos, `κ` 0,6, + ruído largo `bp` 1 kHz | `L_W` 95 dB(A), `n` 5,5 em `rpm` (fixo, então só varia na partida/parada) |
| carenagem | não é fonte: todas as fontes `dentro: true` do motor e do gerador passam pela lei da massa (`m_s` 15: TL 17 dB em 100 Hz, 37 dB em 1 kHz) quando `carenagem` está ligada; o escape sai por fora | — |

### 4.5 Locomotiva diesel-elétrica

Parâmetros: tabela `rpm[notch]` e `potencia[notch]` (fração da nominal), `potenciaNominal` (SD70: 3200 kW), rampa de rotação 100 rpm/s, atraso de carga 1,5 s (o regulador de carga sobe a excitação depois do giro), `η_ger` 0,93, `J_ger`, ventiladores de radiador (`n_v`, `B_v`, `rpm_v`, dois estágios), sopradores dos motores de tração, compressor de ar (2 cilindros, ciclo liga/desliga), freio dinâmico (grades + soprador), buzina opcional (K5LA: 311, 370, 440, 494, 622 Hz). Corpo: 1 segmento 22 × 3,2 × 4,7 m, `zPiso` 0,5, 6 eixos, `cpNariz` 0,30. Tabelas:

| Notch | 0 (lenta) | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
|---|---|---|---|---|---|---|---|---|---|
| EMD 710 rpm | 269 (200 em lenta baixa) | 269 | 343 | 490 | 568 | 651 | 729 | 820 | 904 |
| GE 7FDL rpm | 440 | 440 | 511 | 585 | 672 | 764 | 846 | 950 | 1050 |
| potência (fração) | 0 | 0,05 | 0,12 | 0,23 | 0,35 | 0,48 | 0,64 | 0,82 | 1,00 |

Carga: `Q = potencia[notch]·P_nominal/(η·ω)` com os atrasos acima; o governador leva `combustivel` ao alvo `rpm[notch]` (PI, `K_p` 0,6 por %, `K_i` 0,3/s). Freio dinâmico: motor em notch fixo (EMD: 8 na rotação, carga do gerador zero), grades e sopradores ligados.

Fontes (`refDist` 7,5 m):

| Fonte | Espectro | Nível e lei |
|---|---|---|
| `turbo` (`pa`, `dentro`) | eixo 300–333 Hz (18–20 krpm) com `z` = 27 pás → 8–9 kHz; uivo `bp` Q 15 | `L_W` 95 dB(A) em N8, `∝` 60·log(rpm_turbo) |
| `ventilador.k` (3) | 48" / 12 pás a 1100 rpm → 220 Hz e harmônicos; ruído `bp` 500 Hz | `L_W` 100 dB(A) cada em alta, 92 em baixa; liga por temperatura (ciclo de 2–5 min) |
| `soprador.tracao` | largo 400 Hz–3 kHz | `L_W` 95 dB(A) × `(0,3 + 0,7·potencia)` |
| `compressor.ar` | pulsos a 20 Hz (2 cil. a 600 rpm) `lp` 300 Hz | `L_W` 90 dB(A), liga 20 s a cada 3 min |
| `grades.freio` | largo 1–4 kHz + soprador | `L_W` 100 dB(A) × freioDinamico |
| `rolamento.k` (6 eixos) | pico 1–2 kHz; `n` 3 (seção 4.6), roda 1,02 m | `L_W` 103 dB(A) por eixo a 80 km/h (carga por eixo 32 t) |
| `buzina` (opcional) | 5 notas, `peak` Q 40 cada + sopro | `L_W` 130 dB(A) |

### 4.6 Trem de N vagões (etapa 1: sem motor próprio)

Parâmetros (padrões = trem-bala tipo Shinkansen/ICE): `N` 10, `L_c` 25 (passo), `vao` 0,5, `largura` 3,36, `altura` 3,6, `zPiso` 0,4, `L_nariz` = `L_cauda` 12, `truqueExtremidade` 3,75 (→ 17,5 m entre truques, 8 m através do vão), `eixosPorTruque` 2 a 2,5 m, `diametroRoda` 0,86, `pantografos` [3, 8] (vagões, 0-based 2 e 7) com `carenagem` true (−10 dB), `dormente` 0,6 m, `achatamento` 0 (roda ovalizada: pulso por volta `v/(πD)` = 36 Hz a 350 km/h), `areaFrontal` 11,2, `cpNariz` 0,14, `m_s` 25, `fCabine` 45, `vTransicao` 300 km/h (onde aero = rolamento).

Fontes (`refDist` 7,5 m; `v_ref` = 300 km/h; `L_W` dB(A) re 1 pW):

| Fonte (× quantas) | Posição | Espectro | `L_W(v_ref)` | `n` |
|---|---|---|---|---|
| `truque.k` (`rolamento`, × 2N) | `x` do truque, `y` 0 (a Cena aplica sombra do piso; `hCorpo` 0,3) | 1/3 de oitava rel. ao pico (2 kHz a 300 km/h; o pico sobe com `v^0,5`): 250 Hz −15, 500 −8, 1k −3, 2k 0, 4k −2, 8k −10; modulação dos dormentes a `v/dormente` (162 Hz) com 2 dB; `achatamento` × pulso por volta | 123 | 3 |
| `truque.k.aero` (`aero`, × 2N) | idem, `z` 0,5 | seção 2.7 com pico em 160 Hz (cavidade do truque) | 119 | 6 |
| `corpo.k` (`aero`, × N) | face voltada ao ouvinte, `z` 1,8 | seção 2.7 | 122 | 6 |
| `vao.k` (`vao`, × N−1) | junção, `z` 1,8 | seção 2.9: corcova 50–400 Hz + Rossiter 72/167/262 Hz | 119 | 6 |
| `pantografo.k` (`pantografo`, × 2) | `x` do vagão, `z` 5,0 | tons de Esquilo-Aeólio `f = 0,2·v/d`: cabeça `d` 0,04 → 486 Hz (Q 4), braços `d` 0,12 → 162 Hz; ruído largo 200 Hz–3 kHz; `carenagem` −10 dB | 125 (115 com carenagem) | 6 |
| `nariz` / `cauda` (`aero` + `pressao`) | `x` = ±L/2, `z` 1,8 | aero 2.7 com pico em 300 Hz; pressão 2.6 | 119 | 6 |

Com esses valores a 300 km/h, pela fórmula de 2.2 (`d_s` 7,5 m, `T_p` 3 s): rolamento (20 truques: SEL 89 cada, +13 dB, −4,8 dB) **97 dB(A)**; aero (corpo 93,2 + truques 93,2 + vãos 89,7 + pantógrafos carenados 79 + nariz/cauda 83) **97,3 dB(A)**; soma **100 dB(A)** de `L_Aeq,tp` a 7,5 m da lateral (ICE3/N700 medem 89–93 dB(A) a 25 m, ou seja 99–103 a 7,5 m). A 350 km/h o rolamento sobe 2 dB e o aero 4 dB. Lei do rolamento: `n` = 3 (9 dB por duplicação de velocidade); aero 6; pantógrafo 6 (há medidas com 7). Só rolamento, a 7,5 m, trem de passageiros: 80 km/h → 80 dB(A); 160 → 89; 300 → 97 — a tabela acima reproduz isto a ±2 dB (teste 5.7).

---

## 5. Plano de implementação e verificação

Pastas: `src/scene/` (tipos, propagador, solo, ar, sombra, pressão, vento, ouvinte, ambientes, cena), `src/carriers/` (portador, carro-legado, hélice, rotor, gerador, locomotiva, trem), `tools/cena/` (render e medidas em TypeScript, rodando com `tsx` em Node). Cada passo termina com o teste indicado passando num comando só (`npm run teste:cena -- <passo>`), e os resultados numéricos vão para o relatório da etapa. Não se toca em `acoustics/` nem em `ui/` sem relatar.

| # | Passo | Entrega | Teste objetivo (render offline + medida) |
|---|---|---|---|
| 1 | Propagador de uma fonte em reta | `scene/propagador.ts`: anel por fonte, histórico de poses, resolvedor por ponto fixo, Hermite, parábola no bloco, `1/r`, amplificação convectiva | Tom de 1 kHz, `d` 3 m, 97,2 m/s: 1395 ± 5 → 779 ± 5 Hz (pico do espectrograma, janelas de 20 ms); 200 Hz a 30 m/s, 6 m: 219 ± 1 / 184 ± 1 Hz; nível `1/r` a ±0,2 dB em 5, 10, 50 m; assimetria chegando/indo +10 ± 1 dB para `expConv` 2 |
| 2 | Solo e ar | `solo.ts`, `ar.ts` | Ruído branco, nulo do pente a ±3% de `c/(2Δr)` para os três casos de 2.4; atenuação em 4 kHz vs 500 Hz a 30, 300 e 1500 m a ±1,5 dB da tabela ISO (UR 60%) |
| 3 | N fontes e orçamento de CPU | `MAX_FONTES` 64 (2 leituras cada), geometria a cada 64 amostras | Render de 10 s com 48 fontes em Node: tempo de CPU < 25% do tempo real (≤ 2,5 s) numa máquina de referência anotada; sem alocação no laço (verificar com `--trace-gc`) |
| 4 | Supersônico e legado do avião | Resolvedor fechado para `M ≥ 0,9` (cópia do `jet-dsp`), estrondo | 737 a 1500 m, 300 km/h, pela Cena nova: bandas a ±2 dB do `flyby` legado no ponto mais próximo e 10 s antes; F-16 M 1,5 a 200 m: cone em 3,37 s ± 1 ms, mesmo `Δp` e `T` |
| 5 | Corpo, segmentos, sombra | `sombra.ts`, `Corpo` | Tabela de atenuação da fonte oposta (trem) a ±2 dB de Maekawa em 100 Hz e 1 kHz, caminhos por cima e por baixo; sem descontinuidade (> 1 dB por bloco) quando o ouvinte cruza o plano `y` = 0 |
| 6 | Onda de pressão e vento | `pressao.ts`, `vento.ts` | Pico a pico 150 ± 30 Pa e `σ` 51 ± 5 ms a 3 m / 350 km/h; cauda −70%; resíduo > 20 Hz ≤ 20 Pa; vento 5,4 ± 1 m/s a céu aberto; nível do vento 70 dB a 10 m/s ± 2 |
| 7 | Portador trem | `carriers/trem.ts` com todas as fontes de 4.6 | Céu aberto, 3 m: tabela 2.11 (2,57 s; 3,89 Hz ≥ 6 dB; 9 pulsos ≥ 8 dB; padrão 82 + 180 ms); `L_Aeq,tp` a 7,5 m e 300 km/h = 100 ± 3 dB(A); lei de velocidade 160 → 300 km/h: rolamento +8 ± 1 dB, aero +16 ± 1 dB; balanço espectral a ±4 dB |
| 8 | Ambientes | `ambientes.ts` + IR por banda na thread principal, túnel com pistão | RT60 por banda da IR gerada a ±15% da tabela 2.10 (ajuste por regressão na cauda); túnel − céu aberto = +7 ± 2 dB no `L_Aeq,tp`; onda de compressão 2,0 ± 0,4 kPa chegando 3,7 ± 0,1 s antes; vento 15 ± 2 m/s |
| 9 | Ouvinte: gimbal e filtros | `ouvinte.ts` | ITD = 0,65·sin(az) ms ± 1 amostra; ILD −6 ± 1 dB em 4 kHz a 90°; TL da cabine do trem a ±3 dB da lei da massa em 125, 500, 2k Hz; carro em `cabine`: bandas a ±1 dB do `int` legado; `cofre` a ±1 dB do `bay`; `ponteira` a ±1 dB do `pipe` |
| 10 | Portadores hélice, rotor, gerador, locomotiva | `carriers/*.ts` | Hélice: WAV idêntico amostra a amostra ao legado nos presets turboélice (`takeoff`, `flyby`), ou erro < −90 dBFS. Rotor R44: BPF 13,6 ± 0,05 Hz e cauda ≈ 93 Hz medidos; harmônicos 1–10 dentro de 20 dB em pairado; com coletivo 1,0, harmônicos até o 30º dentro de 15 dB e curtose do sinal `bp` 300–1000 Hz > 6 (tapa); droop 2–3% em 1 s. Gerador: degrau 50%: queda 4–8%, recuperação ±2% em < 3 s; 100/120 Hz +8 ± 2 dB em plena carga. Locomotiva: rpm por notch a ±1%, potência a ±3%, rampa 100 rpm/s |
| 11 | Modo de testes, cena 3D, painel | `pages/testes`, three.js | Paridade de controles (lista); arrastar cada alça altera o parâmetro e o som sem estalos (pico de diferença entre blocos < 0,1 FS num render com rampa); captura de tela da cena com os 7 elementos de 3.4 |
| 12 | Referências guardadas | `tools/cena/referencia/*.json` com as medidas do legado da tabela 2.11 | Rodar `npm run teste:cena -- legado` reproduz os JSON (idênticos) |

**Ferramentas** (`tools/cena/`): `render-passagem.ts` (`--portador --preset --v --d --altitude --ambiente --dur --tom <Hz> --out`), `envelope.ts` (RMS de 20 ms por banda, FFT da envoltória, p90/p10, pulsos), `doppler.ts` (pico do espectrograma de um tom), `bandas.ts` (a tabela de bandas do projeto), `rt60.ts` (regressão na cauda da IR), `cpu.ts`.

### 5.1 Riscos e como limitar

| Risco | Medida |
|---|---|
| **CPU no worklet**: `N` fontes × 2 leituras (direta + solo) com Hermite (4 taps) + 2 polos de ar + 1 polo de solo + shelf de sombra + ITD ≈ 45 flops por leitura por amostra. 64 fontes → ~2900 flops/amostra ≈ 140 MFLOP/s, dentro do que um worklet em JS entrega (> 1 GFLOP/s), mas o orçamento do quantum é 2,67 ms | `MAX_FONTES` 64; geometria (raiz, atan, Maekawa) só a cada 64 amostras; parábola no bloco; sem alocação no laço (buffers pré-alocados, `Float64Array` para estados); medir no teste 3 e no navegador com `AudioWorkletNode` + `performance.now()` por bloco; se passar de 50% do quantum, agrupar as fontes de um mesmo segmento a mais de 50 m (as `aero`, `vao` e `truque.aero` do segmento viram uma só: perda inaudível a essa distância, e a transição é um crossfade de 200 ms) |
| **Memória**: um anel por fonte com `maxDist/c + 0,1 s`; avião a 3000 m → 8,8 s = 422 k amostras × 4 B = 1,7 MB por fonte | Anel dimensionado pela trajetória do portador (`maxDist` = `√((comprimento/2)² + lateral² + altitude²)`); trem 3000 m de reta → 4,5 s → 0,9 MB × 44 fontes = 40 MB: alto. **Decisão**: para `r > 300 m` o atraso não precisa ser exato amostra a amostra (não há Doppler audível abaixo de 1 Hz de variação): o anel é limitado a `min(maxDist, 400 m)/c + 0,1 s` e o excedente vira um atraso **fixo** `(r − 400)/c` partilhado por bloco (o Doppler fica correto porque vem da **variação** do atraso, que fica toda no trecho variável); o avião, com ≤ 8 fontes, mantém o anel completo (8 × 1,7 MB) |
| **Descontinuidades**: fonte que entra/sai do orçamento, ouvinte cruzando o corpo, mudança de `local`, salto da reta | Toda mudança de ganho/filtro em rampa de 20 ms; o salto da reta (`s > comprimento/2`) é tratado zerando o anel com crossfade de 50 ms de silêncio (como hoje o carro "reaparece") |
| **Instabilidade do ponto fixo** para `M` perto de 0,9 ou trajetória muito curva com fonte muito perto | Limite `M < 0,9` para o iterativo; `r ≥ 0,5 m`; raio da curva ≥ 20 m; se a iteração não convergir em 3 passos (`|Δτ| > 1 amostra`), usa 6 e registra na telemetria |
| **Soma de muitas fontes incoerentes clipando o `tanh`** | A escala absoluta (124 dB SPL = 0 dBFS) deixa margem; um medidor de pico avisa no painel; o compressor da thread principal continua |
| **Legado piorar sem perceber** | As referências do passo 12 são comparadas em CI local antes de cada commit da etapa (`teste:cena -- legado`) |
| **Infrassom no alto-falante** | Passa-alta de 20 Hz em `pressao` e no vento; a onda inteira só na telemetria |
| **Fontes do motor sem posição** (presets antigos) | Posições padrão por `engine` (1.3) e por `mount` (Turbina); o adaptador nunca falha, só avisa |

---

## 6. O que já existe e como se encaixa

| Hoje | Onde | Vira |
|---|---|---|
| `road()` + `readProp()` (atraso fracionário Hermite, `1/r` ref. 5 m, imagem no asfalto com `lp` 4,5 kHz e 0,6, absorção `20000·e^(−r/170)`, `shade`, pan, `roadS`) em `dsp.js` | ouvinte `road` | fica no legado; `readProp` e a estrutura do anel são o modelo do `Propagador`; a sombra vira diretividade do escape |
| `ENV_LOOP` (800/400/500/160/1400/1000 m) | `dsp.js` | `Trajetoria.comprimento` padrão por ambiente |
| `geom()` em `jet-dsp.js` (tempo de emissão exato, duas raízes, cáustica, `|1−M cosθ|^−1,4`, barramentos frente/trás, `R_REF` 30 m, absorção `14000·(60/(r+60))^0,85`, imagem 0,8) | ouvintes `ground`/`flyby` | fica no legado; o resolvedor fechado é copiado para `M ≥ 0,9`; `expConv` 1,4 do jato preservado |
| `triggerBoom`/`boomSample` (Carlson, N, subida, trovão, estalo) | `jet-dsp.js` | copiado sem alteração para `scene/estrondo.ts`, acionado pelo mesmo critério |
| `DIR` (7 pontos a 30°) e `dir()` | `jet-dsp.js` | `Diretividade.tabela`, mesma interpolação |
| `cab*` (420/1100/70 Hz), `bayEx` (900 Hz), `itdB/itdD` (0,6 ms) | `dsp.js` | filtros de `local` 'cabine' e 'cofre' do carro, ITD por fonte |
| `cab` do avião (380/900/110 Hz) | `jet-dsp.js` | 'cabine' do avião |
| `buildPropTab`, governador da hélice, `pbb`, reverso | `jet-dsp.js` | `carriers/helice.ts` (idêntico amostra a amostra) |
| `ENVS` + `buildImpulse` (cauda difusa + ecos) e `setAmbience` (fundo) | `app.js`, `jet-app.js` | `Ambiente.reverb` e `Ambiente.fundo`, com RT60 por banda a mais |
| 4 canais do worklet, convolver, compressor, EQ | `app.js` | mantidos |
| telemetria `carX, dist, vRad, loop` / `flyX, mach, boomDb, inCone` | ambos | `TelemetriaCena` |
