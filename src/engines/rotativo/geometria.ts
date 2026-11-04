// Geometria dos rotativos (ROTATIVO.md 1.1, 1.2, 4.1 e Apêndice B).
//
// Wankel: alojamento epitrocoide de 2 lobos (raio gerador R, excentricidade e), rotor de 3 flancos, largura b. O rotor
// gira a 1/3 do eixo excêntrico; cada flanco forma uma câmara cujo volume, com α em °e desde o PMS de ignição dela, é
//     V(α) = V_min + (V_cam/2)·(1 − cos(2α/3)),   V_cam = 3√3·e·R·b,   V_min = V_cam/(CR − 1).
// O ciclo de 4 tempos dura 1 080°e (cada curso 270°e). Câmara c: rotor ⌊c/3⌋, flanco c mod 3, fire = φ_rotor + 360·flanco.
//
// X-Engine (LiquidPiston, aproximação): rotor de 2 lobos num alojamento de 3, 3 câmaras fixas a 240°, ciclo de 720°,
// volume senoidal puro V(α) = V_min + (V_cam/2)·(1 − cos α).
import { FASES_ROTORES } from './constantes';

/** V_cam = 3√3·e·R·b em cm³ (R, e, b em mm) */
export const volumeCamara = (R: number, e: number, b: number) => (3 * Math.sqrt(3) * e * R * b) / 1000;

export type MotorRotativo = {
  tipo: 'wankel' | 'x';
  /** câmaras (3 por rotor no Wankel, 3 no X) */
  N: number; rotores: number;
  /** PMS de ignição de cada câmara (°e) e o rotor de cada uma (o "banco" do Ronco: o primário de escape) */
  fire: number[]; bank: number[]; banks: number;
  /** comprimento do primário de cada câmara (o de seu rotor) */
  runners: number[];
  axis: number[]; z: number[]; tdcRel: number[];
  /** cm³ */
  Vcam: number; Vmin: number;
  /** m */
  boreEq: number;
  /** ciclo da câmara (°e) e o fator do ângulo no cosseno do volume (2/3 no Wankel, 1 no X) */
  cyc: number; kVol: number;
  /** fases dos rotores e eventos de ignição por volta do eixo */
  fases: number[]; eventosPorVolta: number;
  /** intervalos entre ignições consecutivas (°e) */
  intervalos: number[];
};

/** V(α) e dV/dα (cm³ e cm³/rad) da câmara */
export function volumeAngulo(m: Pick<MotorRotativo, 'Vcam' | 'Vmin' | 'kVol'>, aGraus: number) {
  const th = (aGraus * Math.PI) / 180, k = m.kVol;
  return { V: m.Vmin + (m.Vcam / 2) * (1 - Math.cos(k * th)), dV: (m.Vcam / 2) * k * Math.sin(k * th) };
}

export function montarRotativo(spec: { tipo?: string; rotores?: number; geo?: { R: number; e: number; b: number }; Vcam?: number; cr: number; escape?: { Lp?: number } }): MotorRotativo {
  const x = spec.tipo === 'x';
  const Vcam = spec.geo ? volumeCamara(spec.geo.R, spec.geo.e, spec.geo.b) : spec.Vcam!;
  const Vmin = Vcam / (spec.cr - 1);
  const boreEq = Math.cbrt((4 * Vcam * 1e-6) / Math.PI);
  const Lp = spec.escape?.Lp ?? 0.3;
  if (x) {
    // X-Engine: 3 câmaras fixas no alojamento, 1,5 eventos por volta (um "3 cilindros de 4 tempos")
    const fire = [0, 240, 480];
    return {
      tipo: 'x', N: 3, rotores: 1, fire, bank: [0, 0, 0], banks: 1, runners: [Lp, Lp, Lp], axis: [0, 0, 0], z: [0, 0, 0], tdcRel: [...fire],
      Vcam, Vmin, boreEq, cyc: 720, kVol: 1, fases: [0], eventosPorVolta: 1.5, intervalos: [240, 240, 240],
    };
  }
  const rotores = Math.max(1, Math.min(4, Math.round(spec.rotores || 2)));
  const fases = FASES_ROTORES[rotores];
  const fire: number[] = [], bank: number[] = [], z: number[] = [];
  for (let r = 0; r < rotores; r++) for (let k = 0; k < 3; k++) { fire.push(fases[r] + 360 * k); bank.push(r); z.push(r * 0.1); }
  const ord = [...fire].sort((a, b) => a - b);
  const intervalos = ord.map((f, i) => ((i + 1 < ord.length ? ord[i + 1] : ord[0] + 1080) - f));
  return {
    tipo: 'wankel', N: 3 * rotores, rotores, fire, bank, banks: rotores, runners: fire.map(() => Lp), axis: fire.map(() => 0), z, tdcRel: [...fire],
    Vcam, Vmin, boreEq, cyc: 1080, kVol: 2 / 3, fases, eventosPorVolta: rotores, intervalos,
  };
}
