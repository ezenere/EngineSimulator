// Carros reais, um preset por carro, agrupados em famílias. Cada um preenche todos os
// parâmetros do simulador (o que aparece no painel é exatamente o que o preset definiu).
// Os acertos seguem a ficha técnica de cada motor; onde o simulador não tem a peça exata
// (W16, V4 com moentes a 70°, virabrequim de V10 com moentes defasados) vai a mais próxima.
//
// Dinâmica (não muda o som, só como o carro anda): `power` (kW, pico), `mass` (kg, com
// motorista), `ratios` (relações de cada marcha), `finalDrive` (diferencial; nas motos é
// primária × final), `wheelR` (raio da roda, m) e `drag` (½·ρ·Cd·A, N por (m/s)²).
// Os números vêm das fichas técnicas; onde o fabricante não publica, foram escolhidos para
// reproduzir a velocidade em cada marcha e a velocidade final do carro.
//
// Corte de giro: `limiterBand` é quanto o giro cai antes de a central voltar a queimar e
// `limiterHold` o tempo mínimo de cada corte. Faixa pequena com tempo de ~70 ms dá o batido
// rápido em neutro (~8 Hz) e também em marcha (~5 Hz), como nas centrais reais.
//
// Posição do motor: `engine` ('front' | 'mid' | 'rear'; motos 'mid' por padrão) muda o que a câmera de trás
  // ouve do cofre. Arrefecimento: `cooling: 'air'` (ventoinha nos carros, mecânica mais alta).
  // Estouros: `overrun` é o mapa da central na desaceleração ('cut' corta a injeção, 'lean' carburador
// sem corte, 'burble' crepitar de fábrica, 'popbang' remap, 'antilag' só turbo) e `cat` o catalisador.
(function (root) {
  const FAMILIES = [
    { id: 'muscle', name: 'Muscle americano' },
    { id: 'super', name: 'Supercarros europeus' },
    { id: 'boxer', name: 'Porsche e Subaru' },
    { id: 'jdm', name: 'Japoneses' },
    { id: 'euro', name: 'Alemães e esportivos' },
    { id: 'race', name: 'Pista' },
    { id: 'hyper', name: 'Hipercarros' },
    { id: 'br', name: 'Clássicos brasileiros' },
    { id: 'moto', name: 'Motos' },
  ];

  // bases por arquitetura (o carro só sobrescreve o que muda)
  const V8X = { layout: 'v', cylinders: 8, crank: 'cross', bankAngle: 90, order: '1-8-4-3-6-5-7-2' };
  const V8F = { layout: 'v', cylinders: 8, crank: 'flat', bankAngle: 90, order: '1-6-5-8-7-4-3-2' };
  const V12 = { layout: 'v', cylinders: 12, crank: '120', bankAngle: 60, order: '1-10-9-8-7-12-11-4-3-6-5-2' };
  const V10 = { layout: 'v', cylinders: 10, crank: 'even72', bankAngle: 72, order: '1-10-9-8-7-6-5-4-3-2' };
  const I4 = { layout: 'inline', cylinders: 4, crank: 'flat', order: '1-3-4-2' };
  const I6 = { layout: 'inline', cylinders: 6, crank: '120', order: '1-5-3-6-2-4' };
  const I5 = { layout: 'inline', cylinders: 5, crank: '144', order: '1-2-4-5-3' };
  const B4 = { layout: 'boxer', cylinders: 4, crank: 'boxer', order: '1-3-2-4' };
  const B6 = { layout: 'boxer', cylinders: 6, crank: 'boxer', order: '1-6-3-2-5-4' };
  const NA = { aspiration: 'na', boost: 0 };
  const turbo = (b) => ({ aspiration: 'turbo', boost: b });
  const blower = (b) => ({ aspiration: 'super', boost: b });
  // cortes típicos: central moderna (batido rápido), injeção antiga (um pouco mais lento), corrida e moto
  const CUT = (type, band = 70, hold = 0.07) => ({ limiter: type, limiterBand: band, limiterHold: hold });
  const OLD = (type) => CUT(type, 90, 0.08);
  const RACE = (type) => CUT(type, 60, 0.05);
  const MOTO = (type) => CUT(type, 60, 0.05);
  const SOFT = (band) => ({ limiter: 'partial', limiterBand: band, limiterHold: 0 });
  const DBW = { limiter: 'throttle', limiterBand: 300, limiterHold: 0 };
  const NONE = { limiter: 'none' };
  // carro: potência (kW), massa com motorista (kg), relações, diferencial, raio da roda (m), arrasto
  const veh = (power, mass, ratios, finalDrive, wheelR = 0.33, drag = 0.42) => ({ power, mass, ratios, finalDrive, wheelR, drag });
  // moto: as relações da caixa; `finalDrive` já inclui a redução primária e a relação de coroa/pinhão
  const moto = (power, mass, ratios, finalDrive, wheelR = 0.32, drag = 0.3) => ({ power, mass, ratios, finalDrive, wheelR, drag });

  const car = (id, family, name, tag, base, o) => ({ id, family, name, tag, ...base, ...o });

  const PRESETS = [
    // ---- Muscle americano
    car('muscle', 'muscle', 'Chevrolet Camaro SS', '6.2 V8 LS3 · cross-plane', V8X, {
      displacement: 6.2, redline: 6600, idle: 780, cam: 0.5, inertia: 1.2,
      header: 'unequal', routing: 'dual', muffler: 'sport', pipeLen: 3.0, ...NA, intake: 'sport', overrun: 'cut', cat: true, ...CUT('ign'), gears: 6, transmission: 'manual',
      ...veh(339, 1690, [2.66, 1.78, 1.30, 1.00, 0.74, 0.50], 3.73, 0.35, 0.5) }),
    car('mustang', 'muscle', 'Ford Mustang GT', '5.0 V8 Coyote · DOHC 7500 rpm', V8X, {
      order: '1-8-7-2-6-5-4-3', displacement: 5.0, redline: 7500, idle: 700, cam: 0.35, inertia: 0.95,
      header: 'unequal', routing: 'xpipe', muffler: 'sport', pipeLen: 3.0, ...NA, intake: 'sport', overrun: 'cut', cat: true, ...DBW, gears: 10, transmission: 'auto', shiftTime: 0.3,
      valve: 'sport', pipeD: 3, ...veh(343, 1750, [4.70, 2.99, 2.15, 1.80, 1.52, 1.28, 1.00, 0.85, 0.69, 0.64], 3.55, 0.35) }),
    car('gt500', 'muscle', 'Shelby GT500', '5.2 V8 com compressor', V8X, {
      order: '1-8-7-2-6-5-4-3', displacement: 5.2, redline: 7500, idle: 750, cam: 0.45, inertia: 0.9,
      header: 'equal', routing: 'xpipe', muffler: 'sport', pipeLen: 3.0, ...blower(0.83), intake: 'sport', overrun: 'cut', cat: true, ...DBW, gears: 7, transmission: 'auto', shiftTime: 0.12,
      valve: 'auto', pipeD: 3, ...veh(567, 1900, [3.75, 2.44, 1.68, 1.26, 1.00, 0.85, 0.78], 3.73, 0.345) }),
    car('gt350', 'muscle', 'Shelby GT350', '5.2 V8 Voodoo · flat-plane 8250 rpm', V8F, {
      displacement: 5.2, redline: 8250, idle: 800, cam: 0.45, inertia: 0.75,
      header: 'equal', routing: 'hpipe', muffler: 'sport', pipeLen: 3.0, ...NA, intake: 'sport', overrun: 'burble', cat: true, ...CUT('fuel'), gears: 6, transmission: 'manual',
      valve: 'auto', pipeD: 3, ...veh(392, 1710, [3.24, 2.26, 1.63, 1.26, 1.00, 0.63], 3.73, 0.345, 0.5) }),
    car('hellcat', 'muscle', 'Dodge Challenger Hellcat', '6.2 HEMI com compressor', V8X, {
      displacement: 6.2, redline: 6200, idle: 650, cam: 0.45, inertia: 1.25,
      header: 'unequal', routing: 'dual', muffler: 'sport', pipeLen: 3.2, ...blower(0.8), intake: 'sport', overrun: 'cut', cat: true, ...DBW, gears: 8, transmission: 'auto', shiftTime: 0.3,
      valve: 'auto', pipeD: 3, ...veh(527, 2050, [4.71, 3.14, 2.10, 1.67, 1.29, 1.00, 0.84, 0.67], 2.62, 0.35, 0.55) }),
    car('corvette', 'muscle', 'Corvette Z06 C6', '7.0 V8 LS7 · 7100 rpm', V8X, {
      order: '1-8-7-2-6-5-4-3', displacement: 7.0, redline: 7100, idle: 750, cam: 0.5, inertia: 0.95,
      header: 'equal', routing: 'xpipe', muffler: 'sport', pipeLen: 2.8, ...NA, intake: 'sport', overrun: 'cut', cat: true, ...CUT('fuel'), gears: 6, transmission: 'manual',
      valve: 'auto', pipeD: 3, ...veh(377, 1440, [2.97, 2.07, 1.43, 1.00, 0.71, 0.57], 3.42, 0.345) }),
    car('chevelle', 'muscle', 'Chevelle SS 454 (1970)', '7.4 big-block · comando bravo', V8X, {
      displacement: 7.4, redline: 5600, idle: 850, cam: 0.8, inertia: 1.5, fuel: 'carb',
      header: 'unequal', routing: 'dual', muffler: 'straight', pipeLen: 1.8, ...NA, intake: 'sport', overrun: 'lean', cat: false, ...NONE, gears: 4, transmission: 'manual', shiftTime: 0.45,
      ...veh(300, 1800, [2.20, 1.64, 1.28, 1.00], 3.31, 0.34, 0.55) }),
    car('viper', 'muscle', 'Dodge Viper', '8.4 V10 90° · ignição irregular', { layout: 'v', cylinders: 10, crank: 'odd90', bankAngle: 90, order: '1-8-7-4-3-10-9-6-5-2' }, {
      displacement: 8.4, redline: 6200, idle: 750, cam: 0.35, inertia: 1.2,
      header: 'unequal', routing: 'dual', muffler: 'sport', pipeLen: 2.2, ...NA, intake: 'sport', overrun: 'cut', cat: true, ...CUT('fuel'), gears: 6, transmission: 'manual',
      ...veh(450, 1560, [2.66, 1.78, 1.30, 1.00, 0.74, 0.50], 3.07, 0.35) }),
    car('v6odd', 'muscle', 'Buick Century 3.8 (1976)', 'V6 90° moente comum · odd-fire', { layout: 'v', cylinders: 6, crank: 'odd90', bankAngle: 90, order: '1-6-5-4-3-2' }, {
      displacement: 3.8, redline: 5600, idle: 700, cam: 0.3, inertia: 1.1, fuel: 'carb',
      header: 'short', routing: 'single', muffler: 'stock', pipeLen: 3.2, ...NA, intake: 'airbox', overrun: 'lean', cat: true, ...NONE, gears: 4, transmission: 'auto', shiftTime: 0.7,
      ...veh(82, 1700, [2.74, 1.57, 1.00, 0.67], 2.73) }),

    // ---- Supercarros europeus
    car('flatplane', 'super', 'Ferrari 458 Italia', '4.5 V8 flat-plane · 9000 rpm', V8F, {
      engine: 'mid', displacement: 4.5, redline: 9000, idle: 1000, cam: 0.2, inertia: 0.75,
      header: 'equal', routing: 'dual', muffler: 'sport', pipeLen: 2.4, ...NA, intake: 'sport', overrun: 'burble', cat: true, ...SOFT(120), gears: 7, transmission: 'auto', shiftTime: 0.1,
      valve: 'auto', ...veh(419, 1485, [3.08, 2.19, 1.63, 1.29, 1.03, 0.84, 0.69], 4.44, 0.345, 0.4) }),
    car('f40', 'super', 'Ferrari F40', '2.9 V8 biturbo · flat-plane', V8F, {
      displacement: 2.9, redline: 7750, idle: 1000, cam: 0.45, inertia: 0.7,
      header: 'equal', routing: 'dual', muffler: 'straight', pipeLen: 2.0, ...turbo(1.1), intake: 'sport', overrun: 'lean', cat: false, ...OLD('fuel'), gears: 5, transmission: 'manual',
      ...veh(352, 1250, [2.77, 1.74, 1.26, 0.97, 0.76], 4.04, 0.34, 0.4) }),
    car('f812', 'super', 'Ferrari 812 Superfast', '6.5 V12 65° · 8900 rpm', V12, {
      bankAngle: 65, displacement: 6.5, redline: 8900, idle: 950, cam: 0.3, inertia: 0.85,
      header: 'equal', routing: 'xpipe', muffler: 'sport', pipeLen: 2.8, ...NA, intake: 'itb', overrun: 'burble', cat: true, ...SOFT(110), gears: 7, transmission: 'auto', shiftTime: 0.1,
      valve: 'auto', ...veh(588, 1630, [3.08, 2.19, 1.63, 1.29, 1.03, 0.86, 0.76], 4.44, 0.35, 0.4) }),
    car('laferrari', 'super', 'LaFerrari', '6.3 V12 65° · 9250 rpm', V12, {
      bankAngle: 65, engine: 'mid', displacement: 6.3, redline: 9250, idle: 1000, cam: 0.35, inertia: 0.7,
      header: 'equal', routing: 'dual', muffler: 'straight', pipeLen: 2.4, ...NA, intake: 'itb', overrun: 'burble', cat: true, ...SOFT(100), gears: 7, transmission: 'auto', shiftTime: 0.08,
      ...veh(588, 1585, [3.08, 2.19, 1.63, 1.29, 1.03, 0.86, 0.76], 4.44, 0.35, 0.4) }),
    car('aventador', 'super', 'Lamborghini Aventador SVJ', '6.5 V12 60° · 8700 rpm', V12, {
      engine: 'mid', displacement: 6.5, redline: 8700, idle: 1000, cam: 0.4, inertia: 0.8,
      header: 'equal', routing: 'xpipe', muffler: 'sport', pipeLen: 2.2, ...NA, intake: 'sport', overrun: 'burble', cat: true, ...CUT('ign'), gears: 7, transmission: 'auto', shiftTime: 0.1,
      valve: 'auto', pipeD: 3, ...veh(566, 1525, [3.91, 2.44, 1.81, 1.46, 1.19, 0.97, 0.84], 3.54, 0.36, 0.45) }),
    car('huracan', 'super', 'Lamborghini Huracán Performante', '5.2 V10 · 8500 rpm', V10, {
      engine: 'mid', displacement: 5.2, redline: 8500, idle: 950, cam: 0.4, inertia: 0.7,
      header: 'equal', routing: 'dual', muffler: 'sport', pipeLen: 2.2, ...NA, intake: 'itb', overrun: 'burble', cat: true, ...CUT('ign'), gears: 7, transmission: 'auto', shiftTime: 0.1,
      valve: 'auto', ...veh(470, 1500, [3.60, 2.52, 1.87, 1.47, 1.18, 0.96, 0.78], 4.20, 0.35, 0.42) }),
    car('mclaren', 'super', 'McLaren 720S', '4.0 V8 biturbo · flat-plane', V8F, {
      engine: 'mid', displacement: 4.0, redline: 8500, idle: 900, cam: 0.3, inertia: 0.7,
      header: 'equal', routing: 'single', muffler: 'sport', pipeLen: 2.4, ...turbo(1.3), intake: 'sport', overrun: 'burble', cat: true, ...DBW, gears: 7, transmission: 'auto', shiftTime: 0.1,
      ...veh(530, 1420, [3.98, 2.61, 1.90, 1.48, 1.16, 0.91, 0.69], 4.60, 0.355, 0.4) }),
    car('zonda', 'super', 'Pagani Zonda', '7.3 V12 AMG · 4 saídas centrais', V12, {
      engine: 'mid', displacement: 7.3, redline: 7500, idle: 850, cam: 0.4, inertia: 1.0,
      header: 'equal', routing: 'xpipe', muffler: 'straight', pipeLen: 2.6, ...NA, intake: 'sport', overrun: 'burble', cat: true, ...CUT('fuel'), gears: 6, transmission: 'manual',
      ...veh(443, 1250, [3.04, 1.95, 1.37, 1.04, 0.84, 0.71], 4.15, 0.36, 0.4) }),

    // ---- Porsche e Subaru
    car('flat6', 'boxer', 'Porsche 911 GT3 RS', '4.0 boxer 6 · 9000 rpm', B6, {
      engine: 'rear', displacement: 4.0, redline: 9000, idle: 950, cam: 0.3, inertia: 0.7,
      header: 'short', routing: 'dual', muffler: 'sport', pipeLen: 3.0, ...NA, intake: 'itb', overrun: 'burble', cat: true, ...CUT('fuel', 60, 0.06), gears: 7, transmission: 'auto', shiftTime: 0.1,
      valve: 'auto', ...veh(383, 1430, [3.75, 2.38, 1.72, 1.34, 1.11, 0.96, 0.84], 4.19, 0.36, 0.6) }),
    car('turbos', 'boxer', 'Porsche 911 Turbo S', '3.7 boxer 6 biturbo', B6, {
      engine: 'rear', displacement: 3.7, redline: 7200, idle: 900, cam: 0.25, inertia: 0.9,
      header: 'equal', routing: 'dual', muffler: 'sport', pipeLen: 2.6, ...turbo(1.2), intake: 'sport', overrun: 'cut', cat: true, ...DBW, gears: 8, transmission: 'auto', shiftTime: 0.1,
      ...veh(478, 1640, [5.49, 3.18, 2.16, 1.63, 1.27, 1.00, 0.83, 0.67], 3.33, 0.36, 0.4) }),
    car('carrera32', 'boxer', 'Porsche 911 Carrera 3.2 (1984)', 'boxer 6 refrigerado a ar', B6, {
      cooling: 'air', engine: 'rear', displacement: 3.2, redline: 6200, idle: 900, cam: 0.3, inertia: 1.1,
      header: 'unequal', routing: 'single', muffler: 'stock', pipeLen: 1.6, ...NA, intake: 'airbox', overrun: 'cut', cat: false, ...OLD('fuel'), gears: 5, transmission: 'manual', shiftTime: 0.45,
      ...veh(170, 1210, [3.18, 1.83, 1.26, 1.00, 0.79], 3.88, 0.31, 0.4) }),
    car('carreragt', 'boxer', 'Porsche Carrera GT', '5.7 V10 68° · 8400 rpm', V10, {
      bankAngle: 68, engine: 'mid', displacement: 5.7, redline: 8400, idle: 1000, cam: 0.45, inertia: 0.55,
      header: 'equal', routing: 'dual', muffler: 'straight', pipeLen: 2.0, ...NA, intake: 'itb', overrun: 'burble', cat: true, ...CUT('ign'), gears: 6, transmission: 'manual',
      ...veh(450, 1380, [3.33, 2.13, 1.52, 1.21, 1.00, 0.84], 3.92, 0.36, 0.4) }),
    car('boxer4', 'boxer', 'Subaru WRX STI', '2.5 boxer 4 turbo · tubos desiguais', B4, {
      displacement: 2.5, redline: 7200, idle: 850, cam: 0.35, inertia: 0.9,
      header: 'unequal', routing: 'single', muffler: 'sport', pipeLen: 2.8, ...turbo(1.2), intake: 'sport', overrun: 'cut', cat: true, ...OLD('fuel'), gears: 6, transmission: 'manual', shiftTime: 0.24,
      ...veh(221, 1535, [3.64, 2.38, 1.76, 1.35, 1.06, 0.84], 3.90) }),
    car('brz', 'boxer', 'Toyota GR86 / Subaru BRZ', '2.4 boxer 4 aspirado', B4, {
      displacement: 2.4, redline: 7500, idle: 750, cam: 0.3, inertia: 0.85,
      header: 'equal', routing: 'single', muffler: 'sport', pipeLen: 2.6, ...NA, intake: 'sport', overrun: 'cut', cat: true, ...CUT('fuel'), gears: 6, transmission: 'manual',
      ...veh(174, 1270, [3.63, 2.19, 1.54, 1.21, 1.00, 0.77], 4.10, 0.32) }),

    // ---- Japoneses
    car('i4', 'jdm', 'Honda S2000', '2.0 F20C · 9000 rpm', I4, {
      displacement: 2.0, redline: 9000, idle: 850, cam: 0.35, inertia: 0.7,
      header: 'equal', routing: 'single', muffler: 'sport', pipeLen: 2.6, ...NA, intake: 'sport', overrun: 'cut', cat: true, ...OLD('fuel'), gears: 6, transmission: 'manual',
      ...veh(177, 1260, [3.13, 2.05, 1.48, 1.16, 0.97, 0.81], 4.10, 0.31) }),
    car('ek9', 'jdm', 'Honda Civic Type R EK9', '1.6 B16B · VTEC 8400 rpm', I4, {
      displacement: 1.6, redline: 8400, idle: 850, cam: 0.45, inertia: 0.65,
      header: 'equal', routing: 'single', muffler: 'sport', pipeLen: 2.4, ...NA, intake: 'sport', overrun: 'cut', cat: true, ...OLD('fuel'), gears: 5, transmission: 'manual',
      ...veh(136, 1050, [3.23, 2.10, 1.46, 1.03, 0.79], 4.40, 0.30) }),
    car('supra', 'jdm', 'Toyota Supra MK4', '3.0 2JZ-GTE biturbo', I6, {
      displacement: 3.0, redline: 7200, idle: 800, cam: 0.35, inertia: 0.85,
      header: 'equal', routing: 'single', muffler: 'straight', pipeLen: 2.8, ...turbo(1.4), intake: 'sport', overrun: 'cut', cat: false, ...OLD('ign'), gears: 6, transmission: 'manual',
      ...veh(240, 1570, [3.83, 2.36, 1.69, 1.31, 1.00, 0.79], 3.27) }),
    car('r34', 'jdm', 'Nissan Skyline GT-R R34', '2.6 RB26 biturbo · borboletas', I6, {
      displacement: 2.6, redline: 8000, idle: 900, cam: 0.4, inertia: 0.8,
      header: 'equal', routing: 'single', muffler: 'sport', pipeLen: 2.8, ...turbo(1.0), intake: 'itb', overrun: 'cut', cat: true, ...OLD('ign'), gears: 6, transmission: 'manual',
      ...veh(235, 1560, [3.83, 2.36, 1.69, 1.31, 1.00, 0.79], 3.55) }),
    car('gtr', 'jdm', 'Nissan GT-R R35', '3.8 V6 60° biturbo', { layout: 'v', cylinders: 6, crank: 'split60', bankAngle: 60, order: '1-2-3-4-5-6' }, {
      displacement: 3.8, redline: 7100, idle: 750, cam: 0.3, inertia: 0.9,
      header: 'equal', routing: 'dual', muffler: 'sport', pipeLen: 2.8, ...turbo(1.1), intake: 'sport', overrun: 'cut', cat: true, ...DBW, gears: 6, transmission: 'auto', shiftTime: 0.12,
      ...veh(419, 1740, [4.06, 2.30, 1.60, 1.25, 1.00, 0.80], 3.70, 0.36) }),
    car('lfa', 'jdm', 'Lexus LFA', '4.8 V10 72° · 9000 rpm', V10, {
      displacement: 4.8, redline: 9000, idle: 950, cam: 0.35, inertia: 0.55,
      header: 'equal', routing: 'dual', muffler: 'sport', pipeLen: 2.4, ...NA, intake: 'itb', overrun: 'burble', cat: true, ...CUT('fuel', 60, 0.06), gears: 6, transmission: 'auto', shiftTime: 0.15,
      ...veh(412, 1580, [3.23, 2.19, 1.61, 1.24, 1.00, 0.80], 4.60, 0.355, 0.4) }),
    car('evo', 'jdm', 'Mitsubishi Lancer Evo IX', '2.0 4G63 turbo · rali', I4, {
      displacement: 2.0, redline: 7000, idle: 850, cam: 0.35, inertia: 0.8,
      header: 'equal', routing: 'single', muffler: 'straight', pipeLen: 2.6, ...turbo(1.4), intake: 'sport', overrun: 'antilag', cat: false, ...OLD('ign'), gears: 5, transmission: 'manual', shiftTime: 0.22,
      twoStep: 'cut', ...veh(215, 1400, [2.79, 1.95, 1.41, 1.03, 0.72], 4.53, 0.32) }),
    car('mx5', 'jdm', 'Mazda MX-5 ND', '2.0 Skyactiv aspirado', I4, {
      displacement: 2.0, redline: 7500, idle: 750, cam: 0.25, inertia: 0.8,
      header: 'equal', routing: 'single', muffler: 'stock', pipeLen: 2.6, ...NA, intake: 'airbox', overrun: 'cut', cat: true, ...CUT('fuel'), gears: 6, transmission: 'manual',
      ...veh(135, 1060, [5.09, 2.99, 2.04, 1.46, 1.00, 0.72], 2.87, 0.31) }),

    // ---- Alemães e esportivos
    car('i6', 'euro', 'BMW M3 E46', '3.2 S54 · borboletas · 8000 rpm', I6, {
      displacement: 3.2, redline: 8000, idle: 750, cam: 0.35, inertia: 0.85,
      header: 'equal', routing: 'dual', muffler: 'sport', pipeLen: 2.8, ...NA, intake: 'itb', overrun: 'cut', cat: true, ...OLD('fuel'), gears: 6, transmission: 'manual',
      ...veh(252, 1570, [4.23, 2.53, 1.67, 1.23, 1.00, 0.83], 3.62) }),
    car('m5e60', 'euro', 'BMW M5 E60', '5.0 V10 S85 · 8250 rpm', V10, {
      displacement: 5.0, redline: 8250, idle: 800, cam: 0.35, inertia: 0.8,
      header: 'equal', routing: 'dual', muffler: 'sport', pipeLen: 3.0, ...NA, intake: 'itb', overrun: 'cut', cat: true, ...CUT('fuel'), gears: 7, transmission: 'auto', shiftTime: 0.15,
      ...veh(373, 1830, [4.08, 2.60, 1.80, 1.35, 1.08, 0.90, 0.78], 3.62, 0.34) }),
    car('i5', 'euro', 'Audi RS3', '2.5 cinco cilindros turbo', I5, {
      displacement: 2.5, redline: 7000, idle: 850, cam: 0.35, inertia: 0.8,
      header: 'equal', routing: 'single', muffler: 'sport', pipeLen: 2.6, ...turbo(1.3), intake: 'sport', overrun: 'burble', cat: true, ...DBW, gears: 7, transmission: 'auto',
      valve: 'auto', ...veh(294, 1520, [3.56, 2.53, 1.84, 1.40, 1.14, 0.94, 0.80], 3.55) }),
    car('quattro', 'euro', 'Audi Sport Quattro S1', '2.1 cinco cilindros · Grupo B', I5, {
      displacement: 2.1, redline: 8000, idle: 1100, cam: 0.6, inertia: 0.6,
      header: 'equal', routing: 'single', muffler: 'straight', pipeLen: 1.8, ...turbo(1.6), intake: 'sport', overrun: 'antilag', cat: false, ...RACE('ign'), gears: 5, transmission: 'manual', shiftTime: 0.25,
      twoStep: 'cut', ...veh(350, 1090, [3.60, 2.13, 1.46, 1.07, 0.80], 4.10, 0.32, 0.5) }),
    car('c63', 'euro', 'Mercedes-AMG C63', '6.2 V8 M156 aspirado', V8X, {
      displacement: 6.2, redline: 7200, idle: 650, cam: 0.35, inertia: 1.0,
      header: 'unequal', routing: 'dual', muffler: 'sport', pipeLen: 3.0, ...NA, intake: 'sport', overrun: 'burble', cat: true, ...CUT('fuel'), gears: 7, transmission: 'auto', shiftTime: 0.25,
      valve: 'auto', ...veh(336, 1730, [4.38, 2.86, 1.92, 1.37, 1.00, 0.82, 0.73], 2.82, 0.34) }),
    car('r8', 'euro', 'Audi R8 V10', '5.2 V10 · 8700 rpm', V10, {
      engine: 'mid', displacement: 5.2, redline: 8700, idle: 1000, cam: 0.35, inertia: 0.7,
      header: 'equal', routing: 'dual', muffler: 'sport', pipeLen: 2.2, ...NA, intake: 'sport', overrun: 'burble', cat: true, ...CUT('fuel'), gears: 7, transmission: 'auto', shiftTime: 0.12,
      ...veh(456, 1595, [3.60, 2.52, 1.87, 1.47, 1.18, 0.96, 0.78], 4.44, 0.35, 0.4) }),
    car('m3g80', 'euro', 'BMW M3 G80', '3.0 S58 biturbo', I6, {
      displacement: 3.0, redline: 7200, idle: 750, cam: 0.3, inertia: 0.85,
      header: 'equal', routing: 'dual', muffler: 'sport', pipeLen: 3.0, ...turbo(1.7), intake: 'sport', overrun: 'burble', cat: true, ...DBW, gears: 8, transmission: 'auto', shiftTime: 0.22,
      valve: 'auto', ...veh(375, 1730, [5.00, 3.20, 2.14, 1.72, 1.31, 1.00, 0.82, 0.64], 3.15, 0.34) }),
    car('golfgti', 'euro', 'VW Golf GTI', '2.0 TSI · câmbio DSG', I4, {
      displacement: 2.0, redline: 6800, idle: 750, cam: 0.25, inertia: 0.85,
      header: 'short', routing: 'single', muffler: 'stock', pipeLen: 2.8, ...turbo(1.2), intake: 'airbox', overrun: 'cut', cat: true, ...DBW, gears: 7, transmission: 'auto', shiftTime: 0.12,
      ...veh(180, 1400, [3.40, 2.09, 1.40, 1.05, 0.82, 0.68, 0.57], 4.17, 0.32) }),

    // ---- Pista
    car('v10f1', 'race', 'Ferrari F2004 (F1)', '3.0 V10 · 19.000 rpm', V10, {
      engine: 'mid', displacement: 3.0, redline: 19000, idle: 4200, cam: 0.5, inertia: 0.25,
      header: 'equal', routing: 'dual', muffler: 'straight', pipeLen: 1.4, ...NA, intake: 'itb', overrun: 'cut', cat: false, ...SOFT(80), gears: 7, transmission: 'manual', shiftTime: 0.05,
      ...veh(640, 605, [3.60, 2.85, 2.30, 1.85, 1.50, 1.22, 1.00], 6.57, 0.33, 0.78) }),
    car('f1v8', 'race', 'Fórmula 1 V8 (2006–2013)', '2.4 V8 flat-plane · 18.000 rpm', V8F, {
      engine: 'mid', displacement: 2.4, redline: 18000, idle: 4000, cam: 0.5, inertia: 0.25,
      header: 'equal', routing: 'dual', muffler: 'straight', pipeLen: 1.4, ...NA, intake: 'itb', overrun: 'burble', cat: false, ...SOFT(80), gears: 7, transmission: 'manual', shiftTime: 0.05,
      ...veh(560, 640, [3.60, 2.85, 2.30, 1.85, 1.50, 1.22, 1.00], 6.22, 0.33, 0.78) }),
    car('f1v12', 'race', 'Ferrari 412 T2 (F1 1995)', '3.0 V12 75° · 17.000 rpm', V12, {
      bankAngle: 75, engine: 'mid', displacement: 3.0, redline: 17000, idle: 4000, cam: 0.5, inertia: 0.25,
      header: 'equal', routing: 'dual', muffler: 'straight', pipeLen: 1.4, ...NA, intake: 'itb', overrun: 'cut', cat: false, ...SOFT(80), gears: 7, transmission: 'manual', shiftTime: 0.05,
      ...veh(515, 595, [3.60, 2.85, 2.30, 1.85, 1.50, 1.22, 1.00], 5.87, 0.33, 0.8) }),
    car('nascar', 'race', 'NASCAR Cup', '5.86 V8 de varetas · 9500 rpm', V8X, {
      order: '1-8-7-2-6-5-4-3', displacement: 5.86, redline: 9500, idle: 1500, cam: 0.85, inertia: 0.7,
      header: 'equal', routing: 'dual', muffler: 'straight', pipeLen: 1.2, ...NA, intake: 'sport', overrun: 'lean', cat: false, ...RACE('ign'), gears: 4, transmission: 'manual', shiftTime: 0.2,
      ...veh(560, 1540, [2.66, 1.78, 1.30, 1.00], 3.89, 0.36, 0.5) }),
    car('c8r', 'race', 'Corvette C8.R (Le Mans)', '5.5 V8 flat-plane', V8F, {
      engine: 'mid', displacement: 5.5, redline: 8000, idle: 1200, cam: 0.6, inertia: 0.6,
      header: 'equal', routing: 'dual', muffler: 'straight', pipeLen: 1.6, ...NA, intake: 'sport', overrun: 'burble', cat: false, ...SOFT(100), gears: 6, transmission: 'manual', shiftTime: 0.08,
      ...veh(373, 1240, [2.85, 2.11, 1.66, 1.35, 1.14, 0.98], 3.60, 0.35, 0.6) }),

    // ---- Hipercarros
    car('v16', 'hyper', 'Bugatti Chiron', '8.0 W16 quadriturbo (como V16)', { layout: 'v', cylinders: 16, crank: '90', bankAngle: 45, order: '1-8-7-4-3-6-5-2-15-10-9-14-13-12-11-16' }, {
      engine: 'mid', displacement: 8.0, redline: 6700, idle: 750, cam: 0.2, inertia: 1.2,
      header: 'equal', routing: 'dual', muffler: 'sport', pipeLen: 3.0, ...turbo(1.5), intake: 'airbox', overrun: 'cut', cat: true, ...DBW, gears: 7, transmission: 'auto', shiftTime: 0.12,
      ...veh(1103, 1995, [3.33, 2.31, 1.63, 1.22, 0.95, 0.80, 0.73], 2.97, 0.36, 0.55) }),
    car('jesko', 'hyper', 'Koenigsegg Jesko', '5.0 V8 biturbo · flat-plane', V8F, {
      engine: 'mid', displacement: 5.0, redline: 8500, idle: 900, cam: 0.4, inertia: 0.5,
      header: 'equal', routing: 'single', muffler: 'straight', pipeLen: 2.0, ...turbo(1.5), intake: 'sport', overrun: 'cut', cat: true, ...DBW, gears: 9, transmission: 'auto', shiftTime: 0.06,
      ...veh(941, 1420, [4.10, 3.03, 2.37, 1.90, 1.56, 1.30, 1.11, 0.96, 0.83], 3.43, 0.355, 0.45) }),
    car('valkyrie', 'hyper', 'Aston Martin Valkyrie', '6.5 V12 Cosworth · 11.100 rpm', V12, {
      bankAngle: 65, engine: 'mid', displacement: 6.5, redline: 11100, idle: 1200, cam: 0.55, inertia: 0.45,
      header: 'equal', routing: 'dual', muffler: 'straight', pipeLen: 1.6, ...NA, intake: 'itb', overrun: 'cut', cat: true, ...SOFT(100), gears: 7, transmission: 'manual', shiftTime: 0.06,
      ...veh(746, 1270, [3.10, 2.30, 1.80, 1.47, 1.22, 1.04, 0.90], 4.65, 0.35, 0.7) }),
    car('t50', 'hyper', 'GMA T.50', '3.9 V12 · 12.100 rpm', V12, {
      bankAngle: 65, engine: 'mid', displacement: 3.9, redline: 12100, idle: 1300, cam: 0.55, inertia: 0.35,
      header: 'equal', routing: 'single', muffler: 'straight', pipeLen: 1.4, ...NA, intake: 'itb', overrun: 'cut', cat: true, ...SOFT(100), gears: 6, transmission: 'manual', shiftTime: 0.15,
      ...veh(488, 1000, [2.92, 1.87, 1.35, 1.08, 0.92, 0.79], 5.44, 0.33, 0.4) }),
    car('amgone', 'hyper', 'Mercedes-AMG One', '1.6 V6 turbo de F1 · 11.000 rpm', { layout: 'v', cylinders: 6, crank: 'split90', bankAngle: 90, order: '1-6-5-4-3-2' }, {
      engine: 'mid', displacement: 1.6, redline: 11000, idle: 1200, cam: 0.6, inertia: 0.3,
      header: 'equal', routing: 'single', muffler: 'straight', pipeLen: 1.4, ...turbo(2.0), intake: 'itb', overrun: 'cut', cat: true, ...SOFT(100), gears: 7, transmission: 'auto', shiftTime: 0.06,
      ...veh(560, 1695, [3.40, 2.45, 1.90, 1.52, 1.25, 1.05, 0.90], 4.58, 0.35, 0.6) }),

    // ---- Clássicos brasileiros
    car('opala', 'br', 'Chevrolet Opala 4.1 original', '6 em linha 250 · carburador · coletor de ferro', I6, {
      displacement: 4.1, redline: 4800, idle: 650, cam: 0.35, inertia: 1.4, fuel: 'carb',
      header: 'unequal', routing: 'single', muffler: 'stock', pipeLen: 3.2, ...NA, intake: 'airbox', overrun: 'lean', cat: false, ...NONE, gears: 4, transmission: 'manual', shiftTime: 0.6,
      ...veh(90, 1300, [2.77, 1.98, 1.37, 1.00], 3.08, 0.32) }),
    car('opala250s', 'br', 'Chevrolet Opala 250-S', '4.1 · comando 250-S · escape dimensionado 6×1', I6, {
      displacement: 4.1, redline: 5200, idle: 750, cam: 0.55, inertia: 1.25, fuel: 'carb',
      header: 'equal', routing: 'single', muffler: 'sport', pipeLen: 3.0, ...NA, intake: 'sport', overrun: 'lean', cat: false, ...NONE, gears: 4, transmission: 'manual', shiftTime: 0.45, pipeD: 3,
      ...veh(110, 1310, [2.77, 1.98, 1.37, 1.00], 3.08, 0.32) }),
    car('maverick', 'br', 'Ford Maverick GT', '5.0 V8 302', V8X, {
      displacement: 5.0, redline: 5200, idle: 750, cam: 0.55, inertia: 1.3, fuel: 'carb',
      header: 'unequal', routing: 'dual', muffler: 'sport', pipeLen: 3.0, ...NA, intake: 'sport', overrun: 'lean', cat: false, ...NONE, gears: 4, transmission: 'manual', shiftTime: 0.55,
      ...veh(140, 1360, [2.78, 1.93, 1.36, 1.00], 3.00) }),
    car('charger', 'br', 'Dodge Charger R/T', '5.2 V8 318', V8X, {
      displacement: 5.2, redline: 5000, idle: 700, cam: 0.45, inertia: 1.35, fuel: 'carb',
      header: 'unequal', routing: 'dual', muffler: 'sport', pipeLen: 3.2, ...NA, intake: 'airbox', overrun: 'lean', cat: false, ...NONE, gears: 4, transmission: 'manual', shiftTime: 0.55,
      ...veh(110, 1500, [2.65, 1.93, 1.39, 1.00], 3.23) }),
    car('fusca', 'br', 'VW Fusca 1600', 'boxer 4 refrigerado a ar', B4, {
      order: '1-4-2-3', engine: 'rear', displacement: 1.6, compression: 7.5, redline: 4600, idle: 850, cam: 0.15, inertia: 1.4, fuel: 'carb',
      header: 'heater', breakout: 'old', routing: 'single', muffler: 'classic', pipeLen: 1.4, cooling: 'air', ...NA, intake: 'airbox', overrun: 'lean', cat: false, ...NONE, gears: 4, transmission: 'manual', shiftTime: 0.55,
      ...veh(40, 820, [3.80, 2.06, 1.32, 0.89], 4.375, 0.30) }),
    car('golgti', 'br', 'VW Gol GTI', '2.0 AP · injeção', I4, {
      displacement: 2.0, redline: 6500, idle: 850, cam: 0.35, inertia: 0.9,
      header: 'equal', routing: 'single', muffler: 'sport', pipeLen: 2.8, ...NA, intake: 'sport', overrun: 'cut', cat: false, ...OLD('fuel'), gears: 5, transmission: 'manual',
      ...veh(90, 1020, [3.45, 2.12, 1.44, 1.13, 0.91], 3.67, 0.30) }),
    car('unoturbo', 'br', 'Fiat Uno Turbo i.e.', '1.4 turbo', I4, {
      displacement: 1.4, redline: 6000, idle: 900, cam: 0.3, inertia: 0.8,
      header: 'short', routing: 'single', muffler: 'sport', pipeLen: 2.4, ...turbo(0.8), intake: 'sport', overrun: 'cut', cat: true, ...OLD('fuel'), gears: 5, transmission: 'manual',
      ...veh(87, 900, [3.58, 2.24, 1.52, 1.16, 0.87], 3.35, 0.28) }),
    car('i3', 'br', 'VW up! TSI', '1.0 três cilindros turbo', { layout: 'inline', cylinders: 3, crank: '120', order: '1-2-3' }, {
      displacement: 1.0, redline: 6200, idle: 800, cam: 0.2, inertia: 0.9,
      header: 'short', routing: 'single', muffler: 'stock', pipeLen: 2.6, ...turbo(0.9), intake: 'airbox', overrun: 'cut', cat: true, ...DBW, gears: 5, transmission: 'manual',
      ...veh(77, 1000, [3.77, 1.96, 1.28, 0.97, 0.76], 3.65, 0.29) }),

    // ---- Motos (massa com piloto; o diferencial é primária × coroa/pinhão)
    car('r1', 'moto', 'Yamaha R1', '1.0 4 em linha crossplane', { layout: 'inline', cylinders: 4, crank: 'cross', order: '1-3-2-4' }, {
      displacement: 1.0, redline: 14000, idle: 1300, cam: 0.4, inertia: 0.4,
      header: 'equal', routing: 'single', muffler: 'straight', pipeLen: 1.2, ...NA, intake: 'itb', overrun: 'lean', cat: true, ...MOTO('ign'), gears: 6, transmission: 'manual', shiftTime: 0.07,
      ...moto(147, 275, [2.60, 2.18, 1.84, 1.58, 1.38, 1.25], 4.19) }),
    car('cbr', 'moto', 'Honda CBR1000RR', '1.0 4 em linha plano · 14.500 rpm', I4, {
      displacement: 1.0, redline: 14500, idle: 1300, cam: 0.45, inertia: 0.35,
      header: 'equal', routing: 'single', muffler: 'sport', pipeLen: 1.2, ...NA, intake: 'itb', overrun: 'lean', cat: true, ...MOTO('fuel'), gears: 6, transmission: 'manual', shiftTime: 0.07,
      ...moto(141, 270, [2.29, 1.78, 1.50, 1.33, 1.21, 1.14], 4.50) }),
    car('zx10r', 'moto', 'Kawasaki Ninja ZX-10R', '1.0 4 em linha · 14.000 rpm · ordem 1-2-4-3', { layout: 'inline', cylinders: 4, crank: 'flat', order: '1-2-4-3' }, {
      displacement: 1.0, redline: 14000, idle: 1250, cam: 0.45, inertia: 0.35,
      header: 'equal', routing: 'single', muffler: 'sport', pipeLen: 1.2, ...NA, intake: 'itb', overrun: 'lean', cat: true, ...MOTO('ign'), gears: 6, transmission: 'manual', shiftTime: 0.07,
      ...moto(149, 282, [2.60, 2.16, 1.79, 1.56, 1.39, 1.26], 3.86) }),
    car('h2', 'moto', 'Kawasaki Ninja H2', '1.0 4 em linha com compressor', { layout: 'inline', cylinders: 4, crank: 'flat', order: '1-2-4-3' }, {
      displacement: 1.0, redline: 14000, idle: 1200, cam: 0.4, inertia: 0.4,
      header: 'equal', routing: 'single', muffler: 'sport', pipeLen: 1.3, ...blower(1.0), intake: 'airbox', overrun: 'cut', cat: true, ...MOTO('ign'), gears: 6, transmission: 'manual', shiftTime: 0.07,
      ...moto(170, 313, [3.19, 2.53, 2.05, 1.73, 1.50, 1.35], 3.79, 0.32, 0.3) }),
    car('hayabusa', 'moto', 'Suzuki Hayabusa', '1.34 4 em linha · 11.000 rpm', { layout: 'inline', cylinders: 4, crank: 'flat', order: '1-2-4-3' }, {
      displacement: 1.34, redline: 11000, idle: 1100, cam: 0.35, inertia: 0.45,
      header: 'equal', routing: 'single', muffler: 'sport', pipeLen: 1.3, ...NA, intake: 'itb', overrun: 'lean', cat: true, ...CUT('fuel', 70, 0.06), gears: 6, transmission: 'manual', shiftTime: 0.08,
      ...moto(140, 339, [2.62, 1.94, 1.53, 1.29, 1.14, 1.04], 3.72, 0.32, 0.27) }),
    car('panigale', 'moto', 'Ducati Panigale V4', '1.1 V4 90°', { layout: 'v', cylinders: 4, crank: '180', bankAngle: 90, order: '1-3-2-4' }, {
      displacement: 1.1, redline: 16000, idle: 1300, cam: 0.5, inertia: 0.35,
      header: 'equal', routing: 'single', muffler: 'straight', pipeLen: 1.0, ...NA, intake: 'itb', overrun: 'burble', cat: true, ...MOTO('ign'), gears: 6, transmission: 'manual', shiftTime: 0.07,
      ...moto(158, 270, [2.67, 2.00, 1.62, 1.40, 1.27, 1.19], 4.60) }),
    car('monster', 'moto', 'Ducati Monster 1200', 'V2 90° (L-twin)', { layout: 'v', cylinders: 2, crank: 'shared', bankAngle: 90, order: '1-2' }, {
      displacement: 1.2, redline: 9500, idle: 1300, cam: 0.45, inertia: 0.6,
      header: 'equal', routing: 'single', muffler: 'sport', pipeLen: 1.0, ...NA, intake: 'itb', overrun: 'lean', cat: true, ...MOTO('ign'), gears: 6, transmission: 'manual', shiftTime: 0.12,
      ...moto(108, 288, [2.47, 1.77, 1.35, 1.09, 0.96, 0.88], 5.30, 0.32, 0.38) }),
    car('vtwin', 'moto', 'Harley-Davidson Big Twin', 'V2 45° · 1.8 L', { layout: 'v', cylinders: 2, crank: 'shared', bankAngle: 45, order: '1-2' }, {
      cooling: 'air', displacement: 1.8, redline: 5600, idle: 900, cam: 0.55, inertia: 1.3,
      header: 'unequal', routing: 'dual', muffler: 'straight', pipeLen: 1.0, ...NA, intake: 'airbox', overrun: 'lean', cat: false, ...CUT('fuel', 90, 0.08), gears: 6, transmission: 'manual', shiftTime: 0.35,
      ...moto(70, 410, [3.23, 2.31, 1.72, 1.39, 1.18, 1.00], 2.88, 0.33, 0.42) }),
    car('mt07', 'moto', 'Yamaha MT-07', 'bicilíndrico 270°', { layout: 'inline', cylinders: 2, crank: '270', order: '1-2' }, {
      displacement: 0.69, redline: 9000, idle: 1250, cam: 0.35, inertia: 0.6,
      header: 'equal', routing: 'single', muffler: 'sport', pipeLen: 1.0, ...NA, intake: 'sport', overrun: 'lean', cat: true, ...MOTO('fuel'), gears: 6, transmission: 'manual', shiftTime: 0.15,
      ...moto(55, 259, [2.85, 2.13, 1.63, 1.30, 1.09, 0.96], 5.18, 0.31, 0.35) }),
    car('triumph', 'moto', 'Triumph Speed Triple', '1.05 três cilindros', { layout: 'inline', cylinders: 3, crank: '120', order: '1-2-3' }, {
      displacement: 1.05, redline: 10500, idle: 1100, cam: 0.4, inertia: 0.55,
      header: 'equal', routing: 'single', muffler: 'sport', pipeLen: 1.0, ...NA, intake: 'itb', overrun: 'burble', cat: true, ...MOTO('ign'), gears: 6, transmission: 'manual', shiftTime: 0.1,
      ...moto(103, 289, [2.31, 1.86, 1.57, 1.35, 1.24, 1.14], 4.30, 0.32, 0.36) }),
    car('single', 'moto', 'KTM 450 SX-F', 'monocilíndrico de trilha', { layout: 'inline', cylinders: 1, crank: 'single', order: '1' }, {
      displacement: 0.45, redline: 11500, idle: 1700, cam: 0.5, inertia: 0.7,
      header: 'equal', routing: 'single', muffler: 'straight', pipeLen: 1.0, ...NA, intake: 'sport', overrun: 'lean', cat: false, ...CUT('ign', 120, 0.05), gears: 5, transmission: 'manual', shiftTime: 0.15,
      ...moto(46, 178, [2.00, 1.62, 1.33, 1.10, 0.92], 12.0, 0.35, 0.45) }),
  ];
  PRESETS.families = FAMILIES;
  if (typeof module !== 'undefined' && module.exports) module.exports = PRESETS;
  else root.ENGINE_PRESETS = PRESETS;
})(typeof self !== 'undefined' ? self : this);
