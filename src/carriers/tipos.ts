// Tipos das camadas Motor e Portador (docs/CENA.md, seções 1.3 e 1.4), copiados à letra.
//
// O CENA.md põe a interface do Motor em `src/engines/motor.ts`. Essa pasta é de quem está migrando o
// Ronco e a Turbina; enquanto ela não existe, o contrato mora aqui e `src/engines/motor.ts` deve só
// reexportar daqui (ou o contrário, com este arquivo reexportando de lá) quando a migração chegar.
import type { FonteSonora, EixoSaida, Carga, ComandoMotor, Vec3 } from '../scene/tipos';

// ---------------------------------------------------------------- 1.3 Motor → Portador

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
  /** (extensão) o motor traz o governador de rotação (o diesel): o portador manda `rpmAlvo` em vez de `combustivel` */
  readonly governadorProprio?: boolean;
}

/** Adaptador do DSP atual: expõe as fontes já separadas, e o estéreo legado quando a cena está em modo legado. */
export interface MotorLegado extends Motor {
  processarLegado(outL: Float32Array, outR: Float32Array, sendL: Float32Array, sendR: Float32Array, n: number): void;
  params: Record<string, unknown>;           // os `params` de hoje (listener, env, roadDist…)
}

// ---------------------------------------------------------------- 1.4 Portador → Cena

/**
 * (`aviao`: extensão, o avião a jato em passagem da tabela de comando de 1.6)
 * (`trator` e `barco`: extensões do VAPOR.md 4.4)
 * (`drone`: extensão do Elétrico, ELETRICO.md 4.3: o multirrotor, carriers/multirrotor.ts)
 */
export type TipoPortador = 'carro' | 'helice' | 'rotor' | 'gerador' | 'locomotiva' | 'trem' | 'aviao' | 'trator' | 'barco' | 'nenhum'
  | 'drone';

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
  /**
   * (extensão) filtro próprio da cabine no lugar da lei da massa (3.3: "o carro mantém o filtro atual por decisão"):
   * passa-baixas `[f, Q]` em cascata, ressonância `[f, Q, dB]` e um ganho. Sem ele, a lei da massa com `massaSuperficial`.
   */
  cabine?: { lp: readonly (readonly [number, number])[]; pico: readonly [number, number, number]; ganho: number };
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
  rpmAlvo?: number;              // (extensão, RADIAL.md 3.3) manete de passo da hélice 0..1: alvo do governador entre nMin e nHelice
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

/** Montagem do motor no corpo (seção 1.4): `fontes()` soma `posMotor` e espelha o eixo se montado para trás. */
export interface MontagemMotor { posMotor: Vec3; rotMotor: 'frente' | 'tras' }
