// Carros reais, um preset por carro, agrupados em famílias. Cada um preenche todos os
// parâmetros do simulador (o que aparece no painel é exatamente o que o preset definiu).
// Os acertos seguem a ficha técnica de cada motor; onde o simulador não tem a peça exata
// (W16, V4 com moentes a 70°, virabrequim de V10 com moentes defasados) vai a mais próxima.
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

  const car = (id, family, name, tag, base, o) => ({ id, family, name, tag, ...base, ...o });

  const PRESETS = [
    // ---- Muscle americano
    car('muscle', 'muscle', 'Chevrolet Camaro SS', '6.2 V8 LS3 · cross-plane', V8X, {
      displacement: 6.2, redline: 6600, idle: 780, cam: 0.5, inertia: 1.2,
      header: 'unequal', routing: 'dual', muffler: 'sport', pipeLen: 3.0, ...NA, intake: 'sport', pops: 0.3, gears: 6, transmission: 'manual' }),
    car('mustang', 'muscle', 'Ford Mustang GT', '5.0 V8 Coyote · DOHC 7500 rpm', V8X, {
      order: '1-8-7-2-6-5-4-3', displacement: 5.0, redline: 7500, idle: 700, cam: 0.35, inertia: 0.95,
      header: 'unequal', routing: 'xpipe', muffler: 'sport', pipeLen: 3.0, ...NA, intake: 'sport', pops: 0.3, gears: 10, transmission: 'auto', shiftTime: 0.3, shiftPoint: 0.6,
      valve: 'auto', pipeD: 3 }),
    car('gt500', 'muscle', 'Shelby GT500', '5.2 V8 com compressor', V8X, {
      order: '1-8-7-2-6-5-4-3', displacement: 5.2, redline: 7500, idle: 750, cam: 0.45, inertia: 0.9,
      header: 'equal', routing: 'xpipe', muffler: 'sport', pipeLen: 3.0, ...blower(0.83), intake: 'sport', pops: 0.5, gears: 7, transmission: 'auto', shiftTime: 0.12, shiftPoint: 0.75,
      valve: 'auto', pipeD: 3 }),
    car('gt350', 'muscle', 'Shelby GT350', '5.2 V8 Voodoo · flat-plane 8250 rpm', V8F, {
      displacement: 5.2, redline: 8250, idle: 800, cam: 0.45, inertia: 0.75,
      header: 'equal', routing: 'hpipe', muffler: 'sport', pipeLen: 3.0, ...NA, intake: 'sport', pops: 0.4, gears: 6, transmission: 'manual',
      valve: 'auto', pipeD: 3 }),
    car('hellcat', 'muscle', 'Dodge Challenger Hellcat', '6.2 HEMI com compressor', V8X, {
      displacement: 6.2, redline: 6200, idle: 650, cam: 0.45, inertia: 1.25,
      header: 'unequal', routing: 'dual', muffler: 'sport', pipeLen: 3.2, ...blower(0.8), intake: 'sport', pops: 0.4, gears: 8, transmission: 'auto', shiftTime: 0.3, shiftPoint: 0.6,
      valve: 'auto', pipeD: 3 }),
    car('corvette', 'muscle', 'Corvette Z06 C6', '7.0 V8 LS7 · 7100 rpm', V8X, {
      order: '1-8-7-2-6-5-4-3', displacement: 7.0, redline: 7100, idle: 750, cam: 0.5, inertia: 0.95,
      header: 'equal', routing: 'xpipe', muffler: 'sport', pipeLen: 2.8, ...NA, intake: 'sport', pops: 0.3, gears: 6, transmission: 'manual',
      valve: 'auto', pipeD: 3 }),
    car('chevelle', 'muscle', 'Chevelle SS 454 (1970)', '7.4 big-block · comando bravo', V8X, {
      displacement: 7.4, redline: 5600, idle: 850, cam: 0.8, inertia: 1.5, fuel: 'carb',
      header: 'unequal', routing: 'dual', muffler: 'straight', pipeLen: 1.8, ...NA, intake: 'sport', pops: 0.3, gears: 4, transmission: 'manual', shiftTime: 0.45, shiftPoint: 0.5 }),
    car('viper', 'muscle', 'Dodge Viper', '8.4 V10 90° · ignição irregular', { layout: 'v', cylinders: 10, crank: 'odd90', bankAngle: 90, order: '1-8-7-4-3-10-9-6-5-2' }, {
      displacement: 8.4, redline: 6200, idle: 750, cam: 0.35, inertia: 1.2,
      header: 'unequal', routing: 'dual', muffler: 'sport', pipeLen: 2.2, ...NA, intake: 'sport', pops: 0.3, gears: 6, transmission: 'manual' }),
    car('v6odd', 'muscle', 'Buick Century 3.8 (1976)', 'V6 90° moente comum · odd-fire', { layout: 'v', cylinders: 6, crank: 'odd90', bankAngle: 90, order: '1-6-5-4-3-2' }, {
      displacement: 3.8, redline: 5600, idle: 700, cam: 0.3, inertia: 1.1, fuel: 'carb',
      header: 'short', routing: 'single', muffler: 'stock', pipeLen: 3.2, ...NA, intake: 'airbox', pops: 0, gears: 4, transmission: 'auto', shiftTime: 0.7, shiftPoint: 0.15 }),

    // ---- Supercarros europeus
    car('flatplane', 'super', 'Ferrari 458 Italia', '4.5 V8 flat-plane · 9000 rpm', V8F, {
      displacement: 4.5, redline: 9000, idle: 1000, cam: 0.2, inertia: 0.75,
      header: 'equal', routing: 'dual', muffler: 'sport', pipeLen: 2.4, ...NA, intake: 'sport', pops: 0.4, gears: 7, transmission: 'auto', shiftTime: 0.1, shiftPoint: 0.8,
      valve: 'auto' }),
    car('f40', 'super', 'Ferrari F40', '2.9 V8 biturbo · flat-plane', V8F, {
      displacement: 2.9, redline: 7750, idle: 1000, cam: 0.45, inertia: 0.7,
      header: 'equal', routing: 'dual', muffler: 'straight', pipeLen: 2.0, ...turbo(1.1), intake: 'sport', pops: 0.8, gears: 5, transmission: 'manual' }),
    car('f812', 'super', 'Ferrari 812 Superfast', '6.5 V12 65° · 8900 rpm', V12, {
      bankAngle: 65, displacement: 6.5, redline: 8900, idle: 950, cam: 0.3, inertia: 0.85,
      header: 'equal', routing: 'xpipe', muffler: 'sport', pipeLen: 2.8, ...NA, intake: 'itb', pops: 0.3, gears: 7, transmission: 'auto', shiftTime: 0.1, shiftPoint: 0.8,
      valve: 'auto' }),
    car('laferrari', 'super', 'LaFerrari', '6.3 V12 65° · 9250 rpm', V12, {
      bankAngle: 65, displacement: 6.3, redline: 9250, idle: 1000, cam: 0.35, inertia: 0.7,
      header: 'equal', routing: 'dual', muffler: 'straight', pipeLen: 2.4, ...NA, intake: 'itb', pops: 0.35, gears: 7, transmission: 'auto', shiftTime: 0.08, shiftPoint: 0.85 }),
    car('aventador', 'super', 'Lamborghini Aventador SVJ', '6.5 V12 60° · 8700 rpm', V12, {
      displacement: 6.5, redline: 8700, idle: 1000, cam: 0.4, inertia: 0.8,
      header: 'equal', routing: 'xpipe', muffler: 'sport', pipeLen: 2.2, ...NA, intake: 'sport', pops: 0.7, gears: 7, transmission: 'auto', shiftTime: 0.1, shiftPoint: 0.8,
      valve: 'auto', pipeD: 3 }),
    car('huracan', 'super', 'Lamborghini Huracán Performante', '5.2 V10 · 8500 rpm', V10, {
      displacement: 5.2, redline: 8500, idle: 950, cam: 0.4, inertia: 0.7,
      header: 'equal', routing: 'dual', muffler: 'sport', pipeLen: 2.2, ...NA, intake: 'itb', pops: 0.6, gears: 7, transmission: 'auto', shiftTime: 0.1, shiftPoint: 0.8,
      valve: 'auto' }),
    car('mclaren', 'super', 'McLaren 720S', '4.0 V8 biturbo · flat-plane', V8F, {
      displacement: 4.0, redline: 8500, idle: 900, cam: 0.3, inertia: 0.7,
      header: 'equal', routing: 'single', muffler: 'sport', pipeLen: 2.4, ...turbo(1.3), intake: 'sport', pops: 0.5, gears: 7, transmission: 'auto', shiftTime: 0.1, shiftPoint: 0.8 }),
    car('zonda', 'super', 'Pagani Zonda', '7.3 V12 AMG · 4 saídas centrais', V12, {
      displacement: 7.3, redline: 7500, idle: 850, cam: 0.4, inertia: 1.0,
      header: 'equal', routing: 'xpipe', muffler: 'straight', pipeLen: 2.6, ...NA, intake: 'sport', pops: 0.4, gears: 6, transmission: 'manual' }),

    // ---- Porsche e Subaru
    car('flat6', 'boxer', 'Porsche 911 GT3 RS', '4.0 boxer 6 · 9000 rpm', B6, {
      displacement: 4.0, redline: 9000, idle: 950, cam: 0.3, inertia: 0.7,
      header: 'short', routing: 'dual', muffler: 'sport', pipeLen: 3.0, ...NA, intake: 'itb', pops: 0.3, gears: 7, transmission: 'auto', shiftTime: 0.1, shiftPoint: 0.85,
      valve: 'auto' }),
    car('turbos', 'boxer', 'Porsche 911 Turbo S', '3.7 boxer 6 biturbo', B6, {
      displacement: 3.7, redline: 7200, idle: 900, cam: 0.25, inertia: 0.9,
      header: 'equal', routing: 'dual', muffler: 'sport', pipeLen: 2.6, ...turbo(1.2), intake: 'sport', pops: 0.3, gears: 8, transmission: 'auto', shiftTime: 0.1, shiftPoint: 0.7 }),
    car('carrera32', 'boxer', 'Porsche 911 Carrera 3.2 (1984)', 'boxer 6 refrigerado a ar', B6, {
      displacement: 3.2, redline: 6200, idle: 900, cam: 0.3, inertia: 1.1,
      header: 'unequal', routing: 'single', muffler: 'stock', pipeLen: 1.6, ...NA, intake: 'airbox', pops: 0.1, gears: 5, transmission: 'manual', shiftTime: 0.45, shiftPoint: 0.5 }),
    car('carreragt', 'boxer', 'Porsche Carrera GT', '5.7 V10 68° · 8400 rpm', V10, {
      bankAngle: 68, displacement: 5.7, redline: 8400, idle: 1000, cam: 0.45, inertia: 0.55,
      header: 'equal', routing: 'dual', muffler: 'straight', pipeLen: 2.0, ...NA, intake: 'itb', pops: 0.5, gears: 6, transmission: 'manual' }),
    car('boxer4', 'boxer', 'Subaru WRX STI', '2.5 boxer 4 turbo · tubos desiguais', B4, {
      displacement: 2.5, redline: 7200, idle: 850, cam: 0.35, inertia: 0.9,
      header: 'unequal', routing: 'single', muffler: 'sport', pipeLen: 2.8, ...turbo(1.2), intake: 'sport', pops: 0.8, gears: 6, transmission: 'manual', shiftTime: 0.24, shiftPoint: 0.5 }),
    car('brz', 'boxer', 'Toyota GR86 / Subaru BRZ', '2.4 boxer 4 aspirado', B4, {
      displacement: 2.4, redline: 7500, idle: 750, cam: 0.3, inertia: 0.85,
      header: 'equal', routing: 'single', muffler: 'sport', pipeLen: 2.6, ...NA, intake: 'sport', pops: 0.2, gears: 6, transmission: 'manual' }),

    // ---- Japoneses
    car('i4', 'jdm', 'Honda S2000', '2.0 F20C · 9000 rpm', I4, {
      displacement: 2.0, redline: 9000, idle: 850, cam: 0.35, inertia: 0.7,
      header: 'equal', routing: 'single', muffler: 'sport', pipeLen: 2.6, ...NA, intake: 'sport', pops: 0.3, gears: 6, transmission: 'manual' }),
    car('ek9', 'jdm', 'Honda Civic Type R EK9', '1.6 B16B · VTEC 8400 rpm', I4, {
      displacement: 1.6, redline: 8400, idle: 850, cam: 0.45, inertia: 0.65,
      header: 'equal', routing: 'single', muffler: 'sport', pipeLen: 2.4, ...NA, intake: 'sport', pops: 0.3, gears: 5, transmission: 'manual' }),
    car('supra', 'jdm', 'Toyota Supra MK4', '3.0 2JZ-GTE biturbo', I6, {
      displacement: 3.0, redline: 7200, idle: 800, cam: 0.35, inertia: 0.85,
      header: 'equal', routing: 'single', muffler: 'straight', pipeLen: 2.8, ...turbo(1.4), intake: 'sport', pops: 0.6, gears: 6, transmission: 'manual' }),
    car('r34', 'jdm', 'Nissan Skyline GT-R R34', '2.6 RB26 biturbo · borboletas', I6, {
      displacement: 2.6, redline: 8000, idle: 900, cam: 0.4, inertia: 0.8,
      header: 'equal', routing: 'single', muffler: 'sport', pipeLen: 2.8, ...turbo(1.0), intake: 'itb', pops: 0.6, gears: 6, transmission: 'manual' }),
    car('gtr', 'jdm', 'Nissan GT-R R35', '3.8 V6 60° biturbo', { layout: 'v', cylinders: 6, crank: 'split60', bankAngle: 60, order: '1-2-3-4-5-6' }, {
      displacement: 3.8, redline: 7100, idle: 750, cam: 0.3, inertia: 0.9,
      header: 'equal', routing: 'dual', muffler: 'sport', pipeLen: 2.8, ...turbo(1.1), intake: 'sport', pops: 0.5, gears: 6, transmission: 'auto', shiftTime: 0.12, shiftPoint: 0.7 }),
    car('lfa', 'jdm', 'Lexus LFA', '4.8 V10 72° · 9000 rpm', V10, {
      displacement: 4.8, redline: 9000, idle: 950, cam: 0.35, inertia: 0.55,
      header: 'equal', routing: 'dual', muffler: 'sport', pipeLen: 2.4, ...NA, intake: 'itb', pops: 0.3, gears: 6, transmission: 'auto', shiftTime: 0.15, shiftPoint: 0.85 }),
    car('evo', 'jdm', 'Mitsubishi Lancer Evo IX', '2.0 4G63 turbo · rali', I4, {
      displacement: 2.0, redline: 7000, idle: 850, cam: 0.35, inertia: 0.8,
      header: 'equal', routing: 'single', muffler: 'straight', pipeLen: 2.6, ...turbo(1.4), intake: 'sport', pops: 1, gears: 5, transmission: 'manual', shiftTime: 0.22, shiftPoint: 0.5,
      twoStep: 'cut' }),
    car('mx5', 'jdm', 'Mazda MX-5 ND', '2.0 Skyactiv aspirado', I4, {
      displacement: 2.0, redline: 7500, idle: 750, cam: 0.25, inertia: 0.8,
      header: 'equal', routing: 'single', muffler: 'stock', pipeLen: 2.6, ...NA, intake: 'airbox', pops: 0.1, gears: 6, transmission: 'manual' }),

    // ---- Alemães e esportivos
    car('i6', 'euro', 'BMW M3 E46', '3.2 S54 · borboletas · 8000 rpm', I6, {
      displacement: 3.2, redline: 8000, idle: 750, cam: 0.35, inertia: 0.85,
      header: 'equal', routing: 'dual', muffler: 'sport', pipeLen: 2.8, ...NA, intake: 'itb', pops: 0.2, gears: 6, transmission: 'manual' }),
    car('m5e60', 'euro', 'BMW M5 E60', '5.0 V10 S85 · 8250 rpm', V10, {
      displacement: 5.0, redline: 8250, idle: 800, cam: 0.35, inertia: 0.8,
      header: 'equal', routing: 'dual', muffler: 'sport', pipeLen: 3.0, ...NA, intake: 'itb', pops: 0.3, gears: 7, transmission: 'auto', shiftTime: 0.15, shiftPoint: 0.75 }),
    car('i5', 'euro', 'Audi RS3', '2.5 cinco cilindros turbo', I5, {
      displacement: 2.5, redline: 7000, idle: 850, cam: 0.35, inertia: 0.8,
      header: 'equal', routing: 'single', muffler: 'sport', pipeLen: 2.6, ...turbo(1.3), intake: 'sport', pops: 0.8, gears: 7, transmission: 'auto',
      valve: 'auto' }),
    car('quattro', 'euro', 'Audi Sport Quattro S1', '2.1 cinco cilindros · Grupo B', I5, {
      displacement: 2.1, redline: 8000, idle: 1100, cam: 0.6, inertia: 0.6,
      header: 'equal', routing: 'single', muffler: 'straight', pipeLen: 1.8, ...turbo(1.6), intake: 'sport', pops: 1, gears: 5, transmission: 'manual', shiftTime: 0.25, shiftPoint: 0.5,
      twoStep: 'cut' }),
    car('c63', 'euro', 'Mercedes-AMG C63', '6.2 V8 M156 aspirado', V8X, {
      displacement: 6.2, redline: 7200, idle: 650, cam: 0.35, inertia: 1.0,
      header: 'unequal', routing: 'dual', muffler: 'sport', pipeLen: 3.0, ...NA, intake: 'sport', pops: 0.6, gears: 7, transmission: 'auto', shiftTime: 0.25, shiftPoint: 0.65,
      valve: 'auto' }),
    car('r8', 'euro', 'Audi R8 V10', '5.2 V10 · 8700 rpm', V10, {
      displacement: 5.2, redline: 8700, idle: 1000, cam: 0.35, inertia: 0.7,
      header: 'equal', routing: 'dual', muffler: 'sport', pipeLen: 2.2, ...NA, intake: 'sport', pops: 0.4, gears: 7, transmission: 'auto', shiftTime: 0.12, shiftPoint: 0.75 }),
    car('m3g80', 'euro', 'BMW M3 G80', '3.0 S58 biturbo', I6, {
      displacement: 3.0, redline: 7200, idle: 750, cam: 0.3, inertia: 0.85,
      header: 'equal', routing: 'dual', muffler: 'sport', pipeLen: 3.0, ...turbo(1.7), intake: 'sport', pops: 0.5, gears: 8, transmission: 'auto', shiftTime: 0.22, shiftPoint: 0.7,
      valve: 'auto' }),
    car('golfgti', 'euro', 'VW Golf GTI', '2.0 TSI · câmbio DSG', I4, {
      displacement: 2.0, redline: 6800, idle: 750, cam: 0.25, inertia: 0.85,
      header: 'short', routing: 'single', muffler: 'stock', pipeLen: 2.8, ...turbo(1.2), intake: 'airbox', pops: 0.3, gears: 7, transmission: 'auto', shiftTime: 0.12, shiftPoint: 0.5 }),

    // ---- Pista
    car('v10f1', 'race', 'Ferrari F2004 (F1)', '3.0 V10 · 19.000 rpm', V10, {
      displacement: 3.0, redline: 19000, idle: 4200, cam: 0.5, inertia: 0.25,
      header: 'equal', routing: 'dual', muffler: 'straight', pipeLen: 1.4, ...NA, intake: 'itb', pops: 0.2, gears: 7, transmission: 'manual', shiftTime: 0.05, shiftPoint: 1 }),
    car('f1v8', 'race', 'Fórmula 1 V8 (2006–2013)', '2.4 V8 flat-plane · 18.000 rpm', V8F, {
      displacement: 2.4, redline: 18000, idle: 4000, cam: 0.5, inertia: 0.25,
      header: 'equal', routing: 'dual', muffler: 'straight', pipeLen: 1.4, ...NA, intake: 'itb', pops: 0.2, gears: 7, transmission: 'manual', shiftTime: 0.05, shiftPoint: 1 }),
    car('f1v12', 'race', 'Ferrari 412 T2 (F1 1995)', '3.0 V12 75° · 17.000 rpm', V12, {
      bankAngle: 75, displacement: 3.0, redline: 17000, idle: 4000, cam: 0.5, inertia: 0.25,
      header: 'equal', routing: 'dual', muffler: 'straight', pipeLen: 1.4, ...NA, intake: 'itb', pops: 0.2, gears: 7, transmission: 'manual', shiftTime: 0.05, shiftPoint: 1 }),
    car('nascar', 'race', 'NASCAR Cup', '5.86 V8 de varetas · 9500 rpm', V8X, {
      order: '1-8-7-2-6-5-4-3', displacement: 5.86, redline: 9500, idle: 1500, cam: 0.85, inertia: 0.7,
      header: 'equal', routing: 'dual', muffler: 'straight', pipeLen: 1.2, ...NA, intake: 'sport', pops: 0.3, gears: 4, transmission: 'manual', shiftTime: 0.2, shiftPoint: 0.5 }),
    car('c8r', 'race', 'Corvette C8.R (Le Mans)', '5.5 V8 flat-plane', V8F, {
      displacement: 5.5, redline: 8000, idle: 1200, cam: 0.6, inertia: 0.6,
      header: 'equal', routing: 'dual', muffler: 'straight', pipeLen: 1.6, ...NA, intake: 'sport', pops: 0.5, gears: 6, transmission: 'manual', shiftTime: 0.08, shiftPoint: 0.9 }),

    // ---- Hipercarros
    car('v16', 'hyper', 'Bugatti Chiron', '8.0 W16 quadriturbo (como V16)', { layout: 'v', cylinders: 16, crank: '90', bankAngle: 45, order: '1-8-7-4-3-6-5-2-15-10-9-14-13-12-11-16' }, {
      displacement: 8.0, redline: 6700, idle: 750, cam: 0.2, inertia: 1.2,
      header: 'equal', routing: 'dual', muffler: 'sport', pipeLen: 3.0, ...turbo(1.5), intake: 'airbox', pops: 0.1, gears: 7, transmission: 'auto', shiftTime: 0.12, shiftPoint: 0.6 }),
    car('jesko', 'hyper', 'Koenigsegg Jesko', '5.0 V8 biturbo · flat-plane', V8F, {
      displacement: 5.0, redline: 8500, idle: 900, cam: 0.4, inertia: 0.5,
      header: 'equal', routing: 'single', muffler: 'straight', pipeLen: 2.0, ...turbo(1.5), intake: 'sport', pops: 0.6, gears: 9, transmission: 'auto', shiftTime: 0.06, shiftPoint: 0.8 }),
    car('valkyrie', 'hyper', 'Aston Martin Valkyrie', '6.5 V12 Cosworth · 11.100 rpm', V12, {
      bankAngle: 65, displacement: 6.5, redline: 11100, idle: 1200, cam: 0.55, inertia: 0.45,
      header: 'equal', routing: 'dual', muffler: 'straight', pipeLen: 1.6, ...NA, intake: 'itb', pops: 0.3, gears: 7, transmission: 'manual', shiftTime: 0.06, shiftPoint: 0.9 }),
    car('t50', 'hyper', 'GMA T.50', '3.9 V12 · 12.100 rpm', V12, {
      bankAngle: 65, displacement: 3.9, redline: 12100, idle: 1300, cam: 0.55, inertia: 0.35,
      header: 'equal', routing: 'single', muffler: 'straight', pipeLen: 1.4, ...NA, intake: 'itb', pops: 0.3, gears: 6, transmission: 'manual', shiftTime: 0.15, shiftPoint: 0.8 }),
    car('amgone', 'hyper', 'Mercedes-AMG One', '1.6 V6 turbo de F1 · 11.000 rpm', { layout: 'v', cylinders: 6, crank: 'split90', bankAngle: 90, order: '1-6-5-4-3-2' }, {
      displacement: 1.6, redline: 11000, idle: 1200, cam: 0.6, inertia: 0.3,
      header: 'equal', routing: 'single', muffler: 'straight', pipeLen: 1.4, ...turbo(2.0), intake: 'itb', pops: 0.3, gears: 7, transmission: 'auto', shiftTime: 0.06, shiftPoint: 0.85 }),

    // ---- Clássicos brasileiros
    car('opala', 'br', 'Chevrolet Opala 4.1 original', '6 em linha 250 · carburador · coletor de ferro', I6, {
      displacement: 4.1, redline: 4800, idle: 650, cam: 0.35, inertia: 1.4, fuel: 'carb',
      header: 'unequal', routing: 'single', muffler: 'stock', pipeLen: 3.2, ...NA, intake: 'airbox', pops: 0.1, gears: 4, transmission: 'manual', shiftTime: 0.6, shiftPoint: 0.5 }),
    car('opala250s', 'br', 'Chevrolet Opala 250-S', '4.1 · comando 250-S · escape dimensionado 6×1', I6, {
      displacement: 4.1, redline: 5200, idle: 750, cam: 0.55, inertia: 1.25, fuel: 'carb',
      header: 'equal', routing: 'single', muffler: 'sport', pipeLen: 3.0, ...NA, intake: 'sport', pops: 0.35, gears: 4, transmission: 'manual', shiftTime: 0.45, shiftPoint: 0.5, pipeD: 3 }),
    car('maverick', 'br', 'Ford Maverick GT', '5.0 V8 302', V8X, {
      displacement: 5.0, redline: 5200, idle: 750, cam: 0.55, inertia: 1.3, fuel: 'carb',
      header: 'unequal', routing: 'dual', muffler: 'sport', pipeLen: 3.0, ...NA, intake: 'sport', pops: 0.2, gears: 4, transmission: 'manual', shiftTime: 0.55, shiftPoint: 0.5 }),
    car('charger', 'br', 'Dodge Charger R/T', '5.2 V8 318', V8X, {
      displacement: 5.2, redline: 5000, idle: 700, cam: 0.45, inertia: 1.35, fuel: 'carb',
      header: 'unequal', routing: 'dual', muffler: 'sport', pipeLen: 3.2, ...NA, intake: 'airbox', pops: 0.1, gears: 4, transmission: 'manual', shiftTime: 0.55, shiftPoint: 0.5 }),
    car('fusca', 'br', 'VW Fusca 1600', 'boxer 4 refrigerado a ar', B4, {
      order: '1-4-2-3', displacement: 1.6, redline: 4600, idle: 850, cam: 0.15, inertia: 1.4, fuel: 'carb',
      header: 'unequal', routing: 'single', muffler: 'stock', pipeLen: 1.4, ...NA, intake: 'airbox', pops: 0, gears: 4, transmission: 'manual', shiftTime: 0.55, shiftPoint: 0.5 }),
    car('golgti', 'br', 'VW Gol GTI', '2.0 AP · injeção', I4, {
      displacement: 2.0, redline: 6500, idle: 850, cam: 0.35, inertia: 0.9,
      header: 'equal', routing: 'single', muffler: 'sport', pipeLen: 2.8, ...NA, intake: 'sport', pops: 0.2, gears: 5, transmission: 'manual' }),
    car('unoturbo', 'br', 'Fiat Uno Turbo i.e.', '1.4 turbo', I4, {
      displacement: 1.4, redline: 6000, idle: 900, cam: 0.3, inertia: 0.8,
      header: 'short', routing: 'single', muffler: 'sport', pipeLen: 2.4, ...turbo(0.8), intake: 'sport', pops: 0.6, gears: 5, transmission: 'manual' }),
    car('i3', 'br', 'VW up! TSI', '1.0 três cilindros turbo', { layout: 'inline', cylinders: 3, crank: '120', order: '1-2-3' }, {
      displacement: 1.0, redline: 6200, idle: 800, cam: 0.2, inertia: 0.9,
      header: 'short', routing: 'single', muffler: 'stock', pipeLen: 2.6, ...turbo(0.9), intake: 'airbox', pops: 0, gears: 5, transmission: 'manual' }),

    // ---- Motos
    car('r1', 'moto', 'Yamaha R1', '1.0 4 em linha crossplane', { layout: 'inline', cylinders: 4, crank: 'cross', order: '1-3-2-4' }, {
      displacement: 1.0, redline: 14000, idle: 1300, cam: 0.4, inertia: 0.4,
      header: 'equal', routing: 'single', muffler: 'straight', pipeLen: 1.2, ...NA, intake: 'itb', pops: 0.5, gears: 6, transmission: 'manual', shiftTime: 0.07, shiftPoint: 0.5 }),
    car('cbr', 'moto', 'Honda CBR1000RR', '1.0 4 em linha plano · 14.500 rpm', I4, {
      displacement: 1.0, redline: 14500, idle: 1300, cam: 0.45, inertia: 0.35,
      header: 'equal', routing: 'single', muffler: 'sport', pipeLen: 1.2, ...NA, intake: 'itb', pops: 0.4, gears: 6, transmission: 'manual', shiftTime: 0.07, shiftPoint: 0.5 }),
    car('panigale', 'moto', 'Ducati Panigale V4', '1.1 V4 90°', { layout: 'v', cylinders: 4, crank: '180', bankAngle: 90, order: '1-3-2-4' }, {
      displacement: 1.1, redline: 16000, idle: 1300, cam: 0.5, inertia: 0.35,
      header: 'equal', routing: 'single', muffler: 'straight', pipeLen: 1.0, ...NA, intake: 'itb', pops: 0.5, gears: 6, transmission: 'manual', shiftTime: 0.07, shiftPoint: 0.5 }),
    car('monster', 'moto', 'Ducati Monster 1200', 'V2 90° (L-twin)', { layout: 'v', cylinders: 2, crank: 'shared', bankAngle: 90, order: '1-2' }, {
      displacement: 1.2, redline: 9500, idle: 1300, cam: 0.45, inertia: 0.6,
      header: 'equal', routing: 'single', muffler: 'sport', pipeLen: 1.0, ...NA, intake: 'itb', pops: 0.6, gears: 6, transmission: 'manual', shiftTime: 0.12, shiftPoint: 0.5 }),
    car('vtwin', 'moto', 'Harley-Davidson Big Twin', 'V2 45° · 1.8 L', { layout: 'v', cylinders: 2, crank: 'shared', bankAngle: 45, order: '1-2' }, {
      displacement: 1.8, redline: 5600, idle: 900, cam: 0.55, inertia: 1.3,
      header: 'unequal', routing: 'dual', muffler: 'straight', pipeLen: 1.0, ...NA, intake: 'airbox', pops: 0.6, gears: 6, transmission: 'manual', shiftTime: 0.35, shiftPoint: 0.5 }),
    car('mt07', 'moto', 'Yamaha MT-07', 'bicilíndrico 270°', { layout: 'inline', cylinders: 2, crank: '270', order: '1-2' }, {
      displacement: 0.69, redline: 9000, idle: 1250, cam: 0.35, inertia: 0.6,
      header: 'equal', routing: 'single', muffler: 'sport', pipeLen: 1.0, ...NA, intake: 'sport', pops: 0.4, gears: 6, transmission: 'manual', shiftTime: 0.15, shiftPoint: 0.5 }),
    car('triumph', 'moto', 'Triumph Speed Triple', '1.05 três cilindros', { layout: 'inline', cylinders: 3, crank: '120', order: '1-2-3' }, {
      displacement: 1.05, redline: 10500, idle: 1100, cam: 0.4, inertia: 0.55,
      header: 'equal', routing: 'single', muffler: 'sport', pipeLen: 1.0, ...NA, intake: 'itb', pops: 0.4, gears: 6, transmission: 'manual', shiftTime: 0.1, shiftPoint: 0.5 }),
    car('single', 'moto', 'KTM 450 SX-F', 'monocilíndrico de trilha', { layout: 'inline', cylinders: 1, crank: 'single', order: '1' }, {
      displacement: 0.45, redline: 11500, idle: 1700, cam: 0.5, inertia: 0.7,
      header: 'equal', routing: 'single', muffler: 'straight', pipeLen: 1.0, ...NA, intake: 'sport', pops: 0.5, gears: 5, transmission: 'manual', shiftTime: 0.15, shiftPoint: 0.5 }),
  ];
  PRESETS.families = FAMILIES;
  if (typeof module !== 'undefined' && module.exports) module.exports = PRESETS;
  else root.ENGINE_PRESETS = PRESETS;
})(typeof self !== 'undefined' ? self : this);
