// Lei física do nível da hélice (docs/TECNICO.md → Cena e portadores → Portadores), funções puras, sem alocação.
// Serve à FonteHelice dos motores a pistão (src/carriers/helice.ts, `lei: 'carga'`) e ao turboélice do JetDSP quando
// ele toca na Cena (src/engines/turbina/dsp.ts com `leiCarga`); a página Turbina não a usa (o caminho dela fica o de
// sempre, e a prova da hélice idêntica confere as duas leis amostra a amostra).
//
// Tom (ruído de carga, Gutin 1936). Numa hélice que gira a Ω com torque Q e tração T, o harmônico m da passagem de
// pá (frequência m·B·Ω/2π) tem, no campo distante, a pressão RMS
//     p_m = m·B·Ω/(2√2·π·c·r) · |−T·cos θ + Q·c/(Ω·R_e²)| · J_mB(m·B·Ω·R_e·sen θ / c),   R_e = 0,8·R
// (a forma SI da fórmula de Gutin; Magliozzi, Hanson e Amiet, "Propeller and propfan noise", em Aeroacoustics of
// Flight Vehicles, NASA RP-1258, 1991, cap. 1). No plano da hélice (θ = 90°, onde a diretividade da fonte tem o
// máximo) o termo da tração some e fica
//     p_m = m·B·Q·J_mB(m·B·M_e) / (2√2·π·R_e²·r),   M_e = Ω·R_e/c.
// O nível sobe com o TORQUE ABSORVIDO (a potência na rotação dada) e cai com o diâmetro e com o número de pás (a
// função de Bessel de ordem m·B com argumento m·B·M_e < m·B é tanto menor quanto maior a ordem). É a conta que
// faltava: a lei do JetDSP, 9·(M/0,75)⁴·carga·(D/3,9) Pa a 30 m, só olha o Mach e o diâmetro e põe um Cessna 172 de
// 90 kW no nível de um ATR 72 de 2 MW (AUDITORIA.md P-03). Com a fórmula: Cessna 172 a 2 700 rpm e 90 kW, 96 dB a
// 30 m (a lei do JetDSP dava 109); ATR 72 em decolagem, 2 051 kW a 1 200 rpm, 105 dB por hélice (dava 113).
//
// O que a escala NÃO muda: a forma dos harmônicos (a tabela do JetDSP, com o `kapK` das hélices a pistão) e o
// equilíbrio entre o tom e o ruído largo de pá (com o `largoK`), que o teste:radial confere contra as gravações de
// decolagem do Yak-52, do T-6 e do Corsair. A escala multiplica os dois. (Conferido: a fórmula de vórtice de Schlegel,
// King e Mull dá ao ruído largo das hélices a pistão uns 20 dB menos que o ×10 do `largoK`; trocando por ela, o T-6 de
// ponta quase sônica perdia o agudo que a gravação tem e o centroide da decolagem caía de 794 para ~400 Hz. O agudo
// dessa hélice é o choque na ponta, que nenhuma das duas leis tem: fica no TODO do Radial.)

/** J_n(n·z), 0 < z < 1, pela forma assintótica de Debye: e^{n(√(1−z²) − arcsech z)}/√(2π·n·√(1−z²)). Para n ≥ 2 erra
 *  menos de 10% (J_2(1,27): +9%; J_6(3,46): +2%); z fica em [10⁻⁴, 0,98] (acima, a ponta transônica, a forma diverge) */
export function besselNz(n: number, z: number) {
  const zz = z < 1e-4 ? 1e-4 : z > 0.98 ? 0.98 : z;
  const s = Math.sqrt(1 - zz * zz);
  return Math.exp(n * (s - Math.log((1 + s) / zz))) / Math.sqrt(2 * Math.PI * n * s);
}

/** RMS (Pa) do tom de carga no plano da hélice a `r` m (Gutin), somando os harmônicos 1–16 da passagem de pá.
 *  B pás, D (m), Ω (rad/s) da hélice, Q (N·m) no eixo da hélice, c (m/s) */
export function tomCargaPa(B: number, D: number, omega: number, Q: number, c: number, r = 30) {
  if (!(omega > 0) || Q === 0) return 0;
  const Re = 0.4 * D, Me = (omega * Re) / c, k = (B * Math.abs(Q)) / (2 * Math.SQRT2 * Math.PI * Re * Re * r);
  let s = 0;
  for (let m = 1; m <= 16; m++) {
    const p = m * k * besselNz(m * B, Me);
    s += p * p;
    if (p < 1e-7) break;
  }
  return Math.sqrt(s);
}

/**
 * Escala da lei do JetDSP para a física: o tom de carga de Gutin (com a espessura da tabela, 0,35·M² em quadratura com a
 * carga `pload`) sobre o tom da lei 9·(M/0,75)⁴·pload·(D/3,9), os dois a 30 m. M é o Mach helicoidal da ponta (o da lei
 * e da tabela); Ω e Q, os do eixo da hélice. A FonteHelice e o JetDSP chamam a mesma função (a hélice idêntica confere).
 */
export function escalaCarga(B: number, D: number, omega: number, Q: number, c: number, Mh: number, pload: number) {
  const lei = 9 * Math.pow(Mh / 0.75, 4) * pload * (D / 3.9);
  if (!(lei > 1e-9)) return 0;
  const th = 0.35 * Mh * Mh;
  const g = (tomCargaPa(B, D, omega, Q, c) * (Math.sqrt(pload * pload + th * th) / pload)) / lei;
  // Acima de M_h ≈ 0,9 a teoria linear deixa de valer: o choque da ponta se solta da pá e irradia (deslocalização; Hanson
  // e Fink, "The importance of quadrupole sources in prediction of transonic tip speed propeller noise", J. Sound Vib.
  // 62, 1979), e o ruído cresce bem mais depressa que a carga. Daí até M_h = 1 a escala volta para a lei do JetDSP, que
  // cresce com M⁴ (g^(1 − s)): a hélice do T-6 na decolagem (M_h 0,95) fica a meio caminho, as que voam abaixo de 0,9
  // (Cessna, Yak, Corsair, P-47) ficam na de Gutin
  const s = Mh <= 0.9 ? 0 : Mh >= 1 ? 1 : ((Mh - 0.9) / 0.1) ** 2 * (3 - (2 * (Mh - 0.9)) / 0.1);
  return s > 0 && g > 0 ? Math.pow(g, 1 - s) : g;
}
