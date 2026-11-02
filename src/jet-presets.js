// Aviões reais, um preset por aeronave (e motor), agrupados em famílias.
//
// fanB/vanes: pás do fan e palhetas guia de saída (OGV). fanD em metros, n1Max em rpm
// do fan a 100%. hpcB/n2Max: 1º estágio do compressor de alta. jetV: velocidade do
// jato primário a 100% (m/s), nozD: diâmetro do bocal primário. span: distância do
// motor externo ao eixo da fuselagem. cockpitX: quanto o cockpit fica à frente dos motores.
// length/shape: comprimento da aeronave (m) e fator de forma do estrondo sônico (mais fino = menor).
// Onde a ficha técnica não é pública (número de palhetas, pás da turbina) vai um valor típico.
(function (root) {
  const FAMILIES = [
    { id: 'narrow', name: 'Comerciais de corredor único' },
    { id: 'wide', name: 'Widebodies e jumbos' },
    { id: 'classic', name: 'Clássicos' },
    { id: 'military', name: 'Militares' },
    { id: 'prop', name: 'Turboélices' },
    { id: 'biz', name: 'Executivos' },
  ];

  const ACC = { ab: false, nozzle: 'conv', suppressor: 'none', liners: true, sync: false };
  const FAN = { arch: 'turbofan', spools: 2, mount: 'wing', gear: 1, n1Idle: 0.21, n2Idle: 0.6, spoolTime: 6, ...ACC };
  const GTF = { ...FAN, arch: 'geared', gear: 3.06, n1Idle: 0.22 };
  const MIL = { ...FAN, mount: 'fuselage', vanes: 46, n1Idle: 0.42, n2Idle: 0.68, spoolTime: 4, ab: true, nozzle: 'cd', liners: false, shape: 0.085, cockpitX: 10 };
  const JET = { ...FAN, arch: 'turbojet', bpr: 0, n1Idle: 0.45, spoolTime: 9, liners: false };
  // turboélice: fan/hpc descrevem o gerador de gás; a hélice é quem domina o som
  const TP = { ...FAN, arch: 'turboprop', bpr: 0, fanB: 17, vanes: 30, fanD: 0.45, n1Max: 27000, hpcB: 17, n2Max: 31000, lptB: 50,
    jetV: 140, nozD: 0.4, n1Idle: 0.66, n2Idle: 0.66, spoolTime: 4, liners: false, shape: 0.13 };
  const PT6 = { ...TP, mount: 'nose', engines: 1, span: 0, cockpitX: -2.5, fanB: 14, vanes: 22, fanD: 0.35, n1Max: 37500, hpcB: 14, n2Max: 37500,
    lptB: 40, jetV: 110, nozD: 0.3, n1Idle: 0.55, n2Idle: 0.55, spoolTime: 3 };

  const plane = (id, family, name, tag, base, o) => ({ id, family, name, tag, ...base, ...o });

  const PRESETS = [
    // ---- Corredor único
    plane('narrow', 'narrow', 'Boeing 737-800', '2× CFM56-7B · 24 pás', FAN, {
      engines: 2, span: 4.9, cockpitX: 13, length: 39.5, shape: 0.12,
      fanB: 24, vanes: 54, fanD: 1.55, n1Max: 5380, bpr: 5.5, hpcB: 38, n2Max: 15200, lptB: 70, jetV: 420, nozD: 0.9, thrust: 121 }),
    plane('a320', 'narrow', 'Airbus A320', '2× CFM56-5B · 36 pás', FAN, {
      engines: 2, span: 5.75, cockpitX: 14, length: 37.6, shape: 0.12,
      fanB: 36, vanes: 80, fanD: 1.73, n1Max: 5200, bpr: 5.7, hpcB: 38, n2Max: 15200, lptB: 70, jetV: 430, nozD: 0.95, thrust: 120 }),
    plane('geared', 'narrow', 'Airbus A320neo', '2× PW1100G com redutor · 20 pás', GTF, {
      engines: 2, span: 5.9, cockpitX: 15, length: 37.6, shape: 0.12,
      fanB: 20, vanes: 46, fanD: 2.06, n1Max: 3280, bpr: 12, hpcB: 46, n2Max: 22300, lptB: 60, jetV: 340, nozD: 0.85, thrust: 120 }),
    plane('max8', 'narrow', 'Boeing 737 MAX 8', '2× LEAP-1B · 18 pás de carbono', FAN, {
      engines: 2, span: 4.9, cockpitX: 13, length: 39.5, shape: 0.12,
      fanB: 18, vanes: 42, fanD: 1.76, n1Max: 4560, bpr: 9, hpcB: 36, n2Max: 19400, lptB: 80, jetV: 380, nozD: 0.85, thrust: 130, suppressor: 'chevrons' }),
    plane('e2', 'narrow', 'Embraer E195-E2', '2× PW1900G com redutor', GTF, {
      engines: 2, span: 5.2, cockpitX: 12, length: 41.5, shape: 0.12,
      fanB: 18, vanes: 42, fanD: 1.85, n1Max: 3600, bpr: 12, hpcB: 46, n2Max: 22000, lptB: 60, jetV: 330, nozD: 0.75, thrust: 100 }),

    // ---- Widebodies e jumbos
    plane('wide', 'wide', 'Boeing 777-300ER', '2× GE90-115B · o maior fan', FAN, {
      engines: 2, span: 9.7, cockpitX: 28, length: 73.9, shape: 0.12, n1Idle: 0.2, n2Idle: 0.58, spoolTime: 8,
      fanB: 22, vanes: 52, fanD: 3.25, n1Max: 2355, bpr: 9, hpcB: 38, n2Max: 9330, lptB: 80, jetV: 410, nozD: 1.35, thrust: 513 }),
    plane('b787', 'wide', 'Boeing 787-9', '2× GEnx-1B · chevrons', FAN, {
      engines: 2, span: 9.7, cockpitX: 25, length: 62.8, shape: 0.12, spoolTime: 7,
      fanB: 18, vanes: 44, fanD: 2.82, n1Max: 2560, bpr: 9.3, hpcB: 38, n2Max: 11400, lptB: 76, jetV: 380, nozD: 1.2, thrust: 320, suppressor: 'chevrons' }),
    plane('a350', 'wide', 'Airbus A350-900', '2× Trent XWB · 3 eixos', FAN, {
      engines: 2, spools: 3, span: 9.5, cockpitX: 26, length: 66.8, shape: 0.12, spoolTime: 7,
      fanB: 22, vanes: 50, fanD: 3.0, n1Max: 2700, bpr: 9.3, hpcB: 32, n2Max: 12600, lptB: 70, jetV: 390, nozD: 1.25, thrust: 375 }),
    plane('a380', 'wide', 'Airbus A380', '4× Trent 900 · 3 eixos', FAN, {
      engines: 4, spools: 3, span: 25.7, cockpitX: 30, length: 72.7, shape: 0.13, spoolTime: 8,
      fanB: 24, vanes: 56, fanD: 2.95, n1Max: 2900, bpr: 8.5, hpcB: 32, n2Max: 12200, lptB: 70, jetV: 400, nozD: 1.2, thrust: 340 }),
    plane('b744', 'wide', 'Boeing 747-400', '4× RB211-524 · 3 eixos', FAN, {
      engines: 4, spools: 3, span: 21, cockpitX: 33, length: 70.6, shape: 0.13, spoolTime: 8,
      fanB: 24, vanes: 54, fanD: 2.19, n1Max: 3900, bpr: 4.3, hpcB: 32, n2Max: 10600, lptB: 60, jetV: 470, nozD: 1.0, thrust: 260 }),
    plane('jumbo', 'wide', 'Boeing 747-100', '4× JT9D · 46 pás · buzz-saw', FAN, {
      engines: 4, span: 21, cockpitX: 30, length: 70.6, shape: 0.13, n1Idle: 0.22, spoolTime: 8, liners: false,
      fanB: 46, vanes: 100, fanD: 2.34, n1Max: 3650, bpr: 5, hpcB: 50, n2Max: 8000, lptB: 110, jetV: 450, nozD: 1.0, thrust: 210 }),

    // ---- Clássicos
    plane('turbojet', 'classic', 'Boeing 707-120', '4× JT3C turbojato · anos 50', JET, {
      engines: 4, span: 17, cockpitX: 22, length: 44, shape: 0.11,
      fanB: 30, vanes: 40, fanD: 0.95, n1Max: 6500, hpcB: 44, n2Max: 9600, lptB: 60, jetV: 570, nozD: 0.62, thrust: 60 }),
    plane('b707b', 'classic', 'Boeing 707-320B', '4× JT3D · primeiro turbofan', FAN, {
      engines: 4, span: 17, cockpitX: 22, length: 46.6, shape: 0.11, n1Idle: 0.3, spoolTime: 8, liners: false,
      fanB: 35, vanes: 44, fanD: 1.35, n1Max: 6800, bpr: 1.4, hpcB: 40, n2Max: 9800, lptB: 60, jetV: 560, nozD: 0.7, thrust: 80 }),
    plane('b727', 'classic', 'Boeing 727', '3× JT8D na cauda · bypass 1', FAN, {
      engines: 3, mount: 'rear', span: 1.8, cockpitX: 30, length: 46.7, shape: 0.11, n1Idle: 0.3, spoolTime: 7, liners: false,
      fanB: 27, vanes: 34, fanD: 1.08, n1Max: 8600, bpr: 1.0, hpcB: 40, n2Max: 12250, lptB: 60, jetV: 600, nozD: 0.7, thrust: 64 }),
    plane('caravelle', 'classic', 'Sud Caravelle', '2× Avon turbojato · eixo único', JET, {
      engines: 2, spools: 1, mount: 'rear', span: 2.0, cockpitX: 22, length: 32, shape: 0.11,
      fanB: 17, vanes: 30, fanD: 0.95, n1Max: 8000, hpcB: 17, n2Max: 8000, lptB: 50, jetV: 580, nozD: 0.6, thrust: 50 }),
    plane('sst', 'classic', 'Concorde', '4× Olympus 593 com reaquecimento', JET, {
      engines: 4, span: 7.5, cockpitX: 36, length: 62, shape: 0.065, n1Idle: 0.48, n2Idle: 0.62, spoolTime: 7, ab: true, nozzle: 'cd',
      fanB: 32, vanes: 44, fanD: 1.2, n1Max: 6500, hpcB: 40, n2Max: 8900, lptB: 60, jetV: 780, nozD: 0.95, thrust: 140 }),

    // ---- Militares
    plane('fighter', 'military', 'F-16 Fighting Falcon', '1× F110 · pós-combustão', MIL, {
      engines: 1, span: 0, cockpitX: 9, length: 15, shape: 0.08,
      fanB: 30, fanD: 0.88, n1Max: 10400, bpr: 0.4, hpcB: 32, n2Max: 14000, lptB: 54, jetV: 660, nozD: 0.72, thrust: 79 }),
    plane('twin', 'military', 'F-15 Eagle', '2× F100 · pós-combustão', MIL, {
      engines: 2, span: 0.7, cockpitX: 11, length: 19.4,
      fanB: 30, fanD: 0.88, n1Max: 10400, bpr: 0.36, hpcB: 32, n2Max: 14000, lptB: 54, jetV: 680, nozD: 0.75, thrust: 79 }),
    plane('f22', 'military', 'F-22 Raptor', '2× F119 · bocal vetorado', MIL, {
      engines: 2, span: 0.8, cockpitX: 11, length: 18.9, shape: 0.075,
      fanB: 28, fanD: 1.0, n1Max: 9800, bpr: 0.3, hpcB: 30, n2Max: 13500, lptB: 50, jetV: 720, nozD: 0.8, thrust: 116 }),
    plane('f35', 'military', 'F-35 Lightning II', '1× F135 · o maior caça monomotor', MIL, {
      engines: 1, span: 0, cockpitX: 8, length: 15.7, shape: 0.09,
      fanB: 30, fanD: 1.17, n1Max: 8000, bpr: 0.57, hpcB: 32, n2Max: 13000, lptB: 54, jetV: 700, nozD: 0.95, thrust: 125 }),
    plane('fa18', 'military', 'F/A-18 Super Hornet', '2× F414', MIL, {
      engines: 2, span: 0.65, cockpitX: 10, length: 18.3,
      fanB: 28, fanD: 0.79, n1Max: 12000, bpr: 0.25, hpcB: 30, n2Max: 15000, lptB: 50, jetV: 650, nozD: 0.65, thrust: 62 }),
    plane('su27', 'military', 'Sukhoi Su-27', '2× AL-31F · motores afastados', MIL, {
      engines: 2, span: 1.4, cockpitX: 12, length: 21.9,
      fanB: 30, fanD: 0.9, n1Max: 9800, bpr: 0.57, hpcB: 32, n2Max: 13300, lptB: 54, jetV: 640, nozD: 0.8, thrust: 75 }),
    plane('gripen', 'military', 'Saab Gripen', '1× RM12', MIL, {
      engines: 1, span: 0, cockpitX: 8, length: 14.1,
      fanB: 28, fanD: 0.79, n1Max: 12000, bpr: 0.27, hpcB: 30, n2Max: 15000, lptB: 50, jetV: 640, nozD: 0.6, thrust: 54 }),

    // ---- Turboélices
    plane('regional', 'prop', 'ATR 72-600', '2× PW127 · hélice de 6 pás', TP, {
      engines: 2, span: 4.1, cockpitX: 9, length: 27.2, thrust: 28, propB: 6, propD: 3.93, propRpm: 1200 }),
    plane('q400', 'prop', 'Dash 8 Q400', '2× PW150 · 6 pás a 1020 rpm', TP, {
      engines: 2, span: 4.2, cockpitX: 11, length: 32.8, thrust: 37, propB: 6, propD: 4.11, propRpm: 1020 }),
    plane('c130', 'prop', 'Lockheed C-130J', '4× AE2100 · cimitarras de 6 pás', TP, {
      engines: 4, span: 10.2, cockpitX: 9, length: 29.8, thrust: 34, propB: 6, propD: 4.11, propRpm: 1020 }),
    plane('kingair', 'prop', 'Beechcraft King Air 350', '2× PT6A-60 · 4 pás', TP, {
      engines: 2, span: 2.6, cockpitX: 4, length: 14.2, thrust: 8, propB: 4, propD: 2.67, propRpm: 1700,
      fanB: 14, vanes: 22, fanD: 0.35, n1Max: 37500, hpcB: 14, n2Max: 37500, lptB: 40, jetV: 110, nozD: 0.3, n1Idle: 0.55, n2Idle: 0.55, spoolTime: 3 }),
    plane('single', 'prop', 'Cessna Caravan', '1× PT6A-114 · 3 pás', PT6, { length: 11.5, thrust: 7, propB: 3, propD: 2.69, propRpm: 1900 }),
    plane('pc12', 'prop', 'Pilatus PC-12', '1× PT6A-67 · 4 pás', PT6, { length: 14.4, thrust: 9, propB: 4, propD: 2.67, propRpm: 1700 }),
    plane('stucano', 'prop', 'Embraer Super Tucano', '1× PT6A-68 · 5 pás a 2000 rpm', PT6, { length: 11.4, thrust: 11, propB: 5, propD: 2.38, propRpm: 2000 }),

    // ---- Executivos
    plane('bizjet', 'biz', 'Embraer Phenom 300', '2× PW535 na cauda', FAN, {
      engines: 2, mount: 'rear', span: 1.7, cockpitX: 11, length: 15.9, shape: 0.1, n1Idle: 0.25, n2Idle: 0.55, spoolTime: 4,
      fanB: 22, vanes: 52, fanD: 0.8, n1Max: 10600, bpr: 4.2, hpcB: 30, n2Max: 29000, lptB: 64, jetV: 380, nozD: 0.45, thrust: 30 }),
    plane('learjet', 'biz', 'Learjet 35', '2× TFE731 com redutor · o "apito"', GTF, {
      engines: 2, mount: 'rear', span: 1.6, cockpitX: 10, length: 14.8, shape: 0.1, n1Idle: 0.25, n2Idle: 0.55, spoolTime: 4, gear: 1.8, liners: false,
      fanB: 30, vanes: 52, fanD: 0.72, n1Max: 10500, bpr: 2.7, hpcB: 32, n2Max: 30000, lptB: 64, jetV: 420, nozD: 0.45, thrust: 16 }),
    plane('g650', 'biz', 'Gulfstream G650', '2× BR725 na cauda', FAN, {
      engines: 2, mount: 'rear', span: 2.0, cockpitX: 20, length: 30.4, shape: 0.1, n1Idle: 0.23, spoolTime: 5, suppressor: 'chevrons',
      fanB: 24, vanes: 54, fanD: 1.27, n1Max: 7500, bpr: 4.4, hpcB: 32, n2Max: 16000, lptB: 64, jetV: 380, nozD: 0.6, thrust: 75 }),
    plane('hondajet', 'biz', 'HondaJet', '2× HF120 sobre a asa', FAN, {
      engines: 2, mount: 'wing', span: 2.3, cockpitX: 6, length: 13, shape: 0.1, n1Idle: 0.25, n2Idle: 0.55, spoolTime: 4,
      fanB: 20, vanes: 46, fanD: 0.54, n1Max: 17000, bpr: 2.9, hpcB: 28, n2Max: 40000, lptB: 60, jetV: 400, nozD: 0.35, thrust: 9 }),
  ];
  PRESETS.families = FAMILIES;
  if (typeof module !== 'undefined' && module.exports) module.exports = PRESETS;
  else root.JET_PRESETS = PRESETS;
})(typeof self !== 'undefined' ? self : this);
