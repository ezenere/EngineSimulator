// Boca de escape aberta para a atmosfera (docs/RADIAL.md 2.1; TECNICO → Radial → Rodada de som): o estaque curto de um
// cilindro, a saída de um anel coletor, a cauda depois da turbina. No radial não há abafador nem ponteira: o tubo
// acaba, e o que sai por ele é o próprio pulso do cilindro.
//
// É o `Radiator` de src/acoustics (reflexão invertida no grave, irradiação de monopolo com ka = 1 em c/2πa) com o que
// faltava para a boca de um tubo curto:
//
//  - **O sopro é turbulento, e a turbulência vai colada à vazão.** O gás que cruza a válvula e o tubo sai da boca com a
//    vazão flutuando alguns por cento (intensidade de turbulência de um escoamento pulsado em tubo: 4 a 10 %). Essa
//    flutuação irradia como o pulso, pelo mesmo monopolo: `u·(1 + kT·n)`. O ruído nasce e morre com o sopro de cada
//    cilindro (o estouro da abertura, o empurrão do pistão e o tubo ressoando), em vez de ser um chiado de jato somado
//    depois da boca. O espectro é o de um escoamento livre: banda larga com o joelho no Strouhal da boca
//    (f ≈ 0,3·v/D: ~300 Hz num estaque de 38 mm na lenta, alguns kHz em potência), então o sopro escurece na lenta e
//    rasga em carga sem nenhum filtro fixo.
//  - **A turbulência leva um tempo para nascer e outro para se desfazer.** A camada de mistura enrola em ~4 diâmetros
//    à velocidade da vazão (a envoltória não salta com o pico de 1–2 ms do estouro da válvula) e a nuvem de cada sopro
//    continua misturando por ~20 diâmetros depois que a vazão cai (dE/dt = −E²/(ρc·20D): meia-vida de 19 ms num
//    estaque de 38 mm a 40 m/s, mais curta em potência). É o "corpo" do pulso de um tubo aberto. Sem isso o agudo era
//    uma agulha de 2 ms por explosão com silêncio em volta (o "pipoco": 20 a 36 picos por segundo e curtose 50–90 nos
//    motores de estaques, contra 0–7 e 3–6 das gravações), e as explosões fortes do galope da lenta saíam como estalos
//    soltos 16 a 20 dB acima das vizinhas.
//  - **Sem bocal.** A velocidade na boca é a da onda no tubo, v = p/ρc (ρc ≈ 250 Pa·s/m no gás de escape): o estaque é
//    o próprio primário. O chiado de jato do Ronco dividia a velocidade pela área da ponteira relativa a um tubo de
//    2,5" (÷ 0,36 num estaque de 38 mm: +18 dB), como se o gás acelerasse num bocal que não existe, e o ruído (∝ v²)
//    virava 87–100 % do som acima de 400 Hz na lenta.
//
// Medido e deixado de fora (decolagem do Corsair contra a gravação a 150 m): a intensidade crescendo com M², como o
// ruído de mistura de um jato livre, punha 2,5–6 kHz 7 dB acima da gravação; caindo com o Mach (a válvula blocada flutua
// menos), o nível baixava mas o que sobrava era o chiado liso da hélice e do coletor, e o `ar` do kit ouvido subia de
// 0,57 para 1,35. Fica a intensidade constante: em potência o sopro já rasga, porque o joelho do espectro sobe com a
// velocidade. Tirar a vazão média (só o pulso chiaria) mudou menos de 0,5 dB na lenta e também não entrou.
//
// Ruído com semente própria por boca (a renderização segue determinística). O controle "Ar" da página (`params.air`)
// multiplica a turbulência, como multiplica o chiado da admissão.
import { Radiator, RNG, type Line } from '../../acoustics';

/** ρc do gás de escape (Pa·s/m): ~0,48 kg/m³ a 450 °C × 520 m/s */
const RHO_C = 250;
/** Strouhal do joelho do espectro da turbulência na boca; diâmetros que a camada de mistura leva para enrolar (a
 *  turbulência não nasce no instante em que a vazão sobe) e para se desfazer depois que o sopro passa */
export const BOCA = { ST: 0.3, ROLO_D: 4, MISTURA_D: 20 };

export type OpBoca = {
  /** diâmetro interno da boca (m) */
  D: number;
  /** intensidade da turbulência do sopro (fração RMS da vazão) */
  kT: number;
  /** objeto `params` do DSP (lê `air` a cada amostra) */
  params: { air: number };
  semente: number;
};

export class BocaEscape extends Radiator {
  D: number; kT: number; params: { air: number };
  /** envoltória da vazão turbulenta (Pa de onda) e o ruído filtrado */
  env = 0; nz = 0; rng: RNG;
  private dt: number; private kRolo: number; private kMist: number; private kSt: number;
  constructor(fs: number, line: Line, panL: number, panR: number, fc: number, gain: number, fRad: number, op: OpBoca) {
    super(fs, line, panL, panR, fc, gain, fRad);
    this.D = op.D; this.kT = op.kT; this.params = op.params; this.rng = new RNG(op.semente);
    this.dt = 1 / fs;
    this.kRolo = this.dt / (RHO_C * BOCA.ROLO_D * op.D);           // sobe em ROLO_D diâmetros à velocidade da vazão
    this.kMist = this.dt / (RHO_C * BOCA.MISTURA_D * op.D);        // dE/dt = −E²/(ρc·MISTURA_D·D)
    this.kSt = (2 * Math.PI * BOCA.ST * this.dt) / (RHO_C * op.D); // coeficiente do passa-baixa por Pa de envoltória
  }
  step() {
    const x = this.line.in1;
    this.s += this.k * (x - this.s);
    const refl = -this.R * this.s;
    this.line.out1 = refl;
    const u = x - refl, au = u < 0 ? -u : u;
    // envoltória: sobe com a vazão (no tempo de a camada de mistura enrolar) e desce com o tempo de mistura do próprio sopro
    let e = this.env;
    if (au > e) e += (au - e) * Math.min(1, au * this.kRolo); else e -= Math.min(e, e * e * this.kMist);
    this.env = e;
    // ruído de banda larga com o joelho no Strouhal da boca (um polo), normalizado para RMS 1 em qualquer joelho
    const k = Math.min(0.6, Math.max(0.004, e * this.kSt));
    // (o ganho entra antes do filtro: o estado já fica normalizado e não salta quando o joelho muda com o sopro)
    this.nz += k * (this.rng.bi() * Math.sqrt((3 * (2 - k)) / k) - this.nz);
    this.emit = this.radiate(u + this.kT * e * this.nz * this.params.air);
    this.u = u; // (a vazão sem a turbulência: é o que o laço do EngineDSP lê)
  }
}
