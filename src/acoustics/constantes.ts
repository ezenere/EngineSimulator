// Constantes físicas compartilhadas pelos motores.
// Os valores são os mesmos de src/dsp.js e src/jet-dsp.js (não mude sem rodar a comparação de WAV).

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

// gás e escapamento (Ronco)
export const SOUND_SPEED = 520; // gás de escape quente (m/s)
export const P0 = 101325; // pressão ambiente (Pa)
export const RGAS = 287; // constante do ar (J/kg·K)
export const GAM = 1.33; // razão de calores específicos do gás queimado

// ar livre (Turbina)
export const C0 = 340; // som no ar (m/s)
export const PREF = 2e-5; // 0 dB SPL (Pa)
export const R_REF = 30; // distância em que as fontes da Turbina são definidas (m)
