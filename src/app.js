(() => {
  const G = window.EngineGeometry;
  const PRESETS = window.ENGINE_PRESETS;
  const $ = (s) => document.querySelector(s);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();


  let spec = { ...PRESETS[0] };
  let presetId = PRESETS[0].id;
  let engine = G.build(spec);
  let environment = 'open';
  const params = { listener: 'ext', env: 'open', roadDist: 6, exhaust: 1, intake: 1, mech: 1, master: 0.8, fanSound: true, saSound: true };
  let tempMode = 'real';
  let observer = 'car', carMic = 'ext';

  let audio = null;
  let ignition = false;
  let tele = { rpm: 0, theta: 0, kmh: 0, gear: 0, boost: 0, thr: 0, limiter: false, state: 'off', torque: 0 };
  const input = { key: 0, half: false, pad: 0, brake: 0 };

  // ------------------------------------------------------------------ áudio
  const { EngineDSP: DSP, gearRatios, defaultFinal } = EngineDSPFactory();

  function engineConfig(sr) {
    const cfg = {
      ...spec, N: engine.N, fire: engine.fire, bank: engine.bank, banks: engine.banks,
      axis: engine.axis, z: engine.z, tdcRel: engine.tdcRel, runners: engine.runners,
    };
    if (cfg.banks === 1 && (cfg.routing === 'xpipe' || cfg.routing === 'hpipe')) cfg.routing = 'dual';
    // calibra o volume aqui para não travar a thread de áudio
    const probe = new DSP(sr);
    probe.setConfig(cfg);
    cfg.gain = probe.cfgGain;
    return cfg;
  }

  async function initAudio() {
    if (audio) return audio;
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    let node, send;
    const src = `const EngineDSP = (${EngineDSPFactory.toString()})().EngineDSP;
class RoncoProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.d = new EngineDSP(sampleRate); this.d.post = (m) => this.port.postMessage(m); this.port.onmessage = (e) => this.d.message(e.data); }
  process(inputs, outputs) { const o = outputs[0]; this.d.process(o[0], o[1], o[0].length, o[2], o[3]); return true; }
}
registerProcessor('ronco-engine', RoncoProcessor);`;
    try {
      // blob: funciona em http(s); em file:// a origem é nula e só data: carrega
      const urls = [URL.createObjectURL(new Blob([src], { type: 'application/javascript' })), `data:text/javascript;charset=utf-8,${encodeURIComponent(src)}`];
      let loaded = false;
      for (const url of urls) {
        try { await ctx.audioWorklet.addModule(url); loaded = true; break; } catch (e) { /* tenta o próximo */ }
      }
      if (!loaded) throw new Error('AudioWorklet indisponível');
      node = new AudioWorkletNode(ctx, 'ronco-engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [4] });
      node.port.onmessage = (e) => onTelemetry(e.data);
      send = (m) => node.port.postMessage(m);
    } catch (err) {
      // navegadores sem AudioWorklet (ou bloqueado): mesmo DSP na thread principal
      const d = new DSP(ctx.sampleRate);
      d.post = onTelemetry;
      node = ctx.createScriptProcessor(1024, 0, 4);
      node.onaudioprocess = (e) => { const b = e.outputBuffer; d.process(b.getChannelData(0), b.getChannelData(1), b.length, b.getChannelData(2), b.getChannelData(3)); };
      send = (m) => d.message(m);
    }
    // canais 0-1: som direto · canais 2-3: envio para a acústica do ambiente
    node.channelInterpretation = 'discrete';
    const split = ctx.createChannelSplitter(4);
    const toDry = ctx.createChannelMerger(2), toWet = ctx.createChannelMerger(2);
    node.connect(split);
    split.connect(toDry, 0, 0); split.connect(toDry, 1, 1);
    split.connect(toWet, 2, 0); split.connect(toWet, 3, 1);
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const conv = ctx.createConvolver();
    const wetLP = ctx.createBiquadFilter(); wetLP.type = 'lowpass'; wetLP.frequency.value = 18000;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 3.2; comp.attack.value = 0.004; comp.release.value = 0.22;
    const out = ctx.createGain(); out.gain.value = 1.35;
    const analyser = ctx.createAnalyser(); analyser.fftSize = 4096; analyser.smoothingTimeConstant = 0.6;
    toDry.connect(dry); toWet.connect(conv); conv.connect(wetLP); wetLP.connect(wet);
    dry.connect(comp); wet.connect(comp); comp.connect(out); out.connect(analyser); analyser.connect(ctx.destination);
    audio = { ctx, node, send, dry, wet, wetLP, conv, analyser };
    setEnvironment(environment);
    send({ type: 'config', cfg: engineConfig(ctx.sampleRate) });
    send({ type: 'params', params });
    send({ type: 'input', temp: { mode: tempMode } });
    return audio;
  }

  // Acústica de cada ambiente: cauda difusa + ecos discretos (prédios, arquibancada, paredões).
  const ENVS = {
    open: { name: 'Céu aberto', len: 0.6, tau: 0.08, diff: 0.35, wet: 0.1, echoes: [[0.006, 0.5, 0.001]] },
    street: { name: 'Rua com prédios', len: 1.5, tau: 0.32, diff: 0.5, wet: 0.32, dark: 0.5,
      echoes: [[0.047, 0.55, 0.004], [0.061, 0.45, 0.005], [0.094, 0.3, 0.008], [0.122, 0.22, 0.01], [0.141, 0.16, 0.012], [0.19, 0.1, 0.02]] },
    tunnel: { name: 'Túnel', len: 3.4, tau: 0.9, diff: 1, wet: 0.6, dark: 0.6, flutter: 0.041,
      echoes: [[0.018, 0.5, 0.002], [0.041, 0.45, 0.004], [0.083, 0.35, 0.008], [0.124, 0.25, 0.012]] },
    garage: { name: 'Garagem', len: 1.3, tau: 0.28, diff: 1, wet: 0.42, dark: 0.25,
      echoes: [[0.011, 0.5, 0.002], [0.019, 0.4, 0.003], [0.027, 0.3, 0.004]] },
    track: { name: 'Autódromo', len: 1.8, tau: 0.12, diff: 0.4, wet: 0.24, dark: 0.7,
      echoes: [[0.009, 0.4, 0.001], [0.16, 0.32, 0.04], [0.28, 0.2, 0.06], [0.45, 0.1, 0.09]] },
    canyon: { name: 'Serra', len: 2.6, tau: 0.25, diff: 0.25, wet: 0.38, dark: 0.8,
      echoes: [[0.38, 0.45, 0.03], [0.71, 0.3, 0.05], [1.05, 0.2, 0.07], [1.5, 0.12, 0.1], [2.1, 0.07, 0.14]] },
  };

  function makeIR(ctx, kind) {
    const E = ENVS[kind], sr = ctx.sampleRate;
    const n = Math.floor(sr * E.len);
    const buf = ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        let env = E.diff * Math.exp(-t / E.tau) * Math.min(1, t / 0.003);
        if (E.flutter) env *= 0.55 + 0.45 * Math.pow(Math.abs(Math.sin((Math.PI * t) / E.flutter)), 8);
        // a cauda escurece com o tempo (o ar e as superfícies absorvem os agudos)
        const k = 0.6 * Math.exp(-t / (0.5 - 0.35 * (E.dark || 0))) + 0.04;
        lp += k * (Math.random() * 2 - 1 - lp);
        d[i] = lp * env;
      }
      for (const [t0, g, smear] of E.echoes) {
        const start = Math.floor((t0 + ch * 0.0011 * (1 + t0 * 4)) * sr), len = Math.max(1, Math.floor(smear * sr));
        const amp = g * Math.sqrt(3 / len) * (1 - 0.15 * ch);
        let e = 0;
        const k = Math.max(0.08, 0.7 - t0 * 0.6);
        for (let j = 0; j < len * 3 && start + j < n; j++) {
          e += k * (Math.random() * 2 - 1 - e);
          d[start + j] += amp * e * Math.exp(-j / len) * 2;
        }
      }
    }
    return buf;
  }

  function setEnvironment(kind) {
    environment = kind;
    params.env = kind;
    audio?.send({ type: 'params', params });
    if (!audio) return;
    audio.conv.buffer = makeIR(audio.ctx, kind);
    applyListenerAcoustics();
  }

  // Dentro do carro o ambiente chega abafado pela carroceria.
  function applyListenerAcoustics() {
    if (!audio) return;
    const l = params.listener, t = audio.ctx.currentTime;
    const f = { int: 650, bay: 3500 }[l] || 18000;
    const k = { int: 0.5, pipe: 0.55, bay: 0.8 }[l] || 1;
    audio.wetLP.frequency.setTargetAtTime(f, t, 0.05);
    audio.wet.gain.setTargetAtTime(ENVS[environment].wet * k, t, 0.05);
  }

  let rebuildTimer = 0;
  function pushConfig(structural, fresh = false) {
    engine = G.build(spec);
    renderReadout();
    updatePlate();
    if (!audio) return;
    if (structural) {
      clearTimeout(rebuildTimer);
      // carro novo com o motor ligado: ele dá a partida do zero
      rebuildTimer = setTimeout(() => audio.send({ type: 'config', cfg: { ...engineConfig(audio.ctx.sampleRate), fresh } }), 60);
    } else {
      audio.send({ type: 'tune', cfg: { ...spec } });
    }
  }

  function sendInput() {
    if (!audio) return;
    const thr = Math.max(input.key * (input.half ? 0.4 : 1), input.pad);
    audio.send({ type: 'input', throttle: thr, brake: input.brake });
    $('#pedalFill').style.height = `${thr * 100}%`;
    $('#pedal').setAttribute('aria-valuenow', String(Math.round(thr * 100)));
  }

  async function setIgnition(on) {
    await initAudio();
    if (audio.ctx.state !== 'running') await audio.ctx.resume();
    ignition = on;
    audio.send({ type: 'input', ignition: on });
    const btn = $('#ignition');
    btn.setAttribute('aria-pressed', String(on));
    $('#ignLabel').textContent = on ? 'Desligar' : 'Ligar motor';
  }

  function shift(dir) {
    if (!audio) return;
    audio.send({ type: 'input', shift: dir });
  }

  function onTelemetry(m) {
    if (m.type !== 'telemetry') return;
    tele = m; tele.t = performance.now();
    if (ignition && m.state === 'off' && m.rpm < 50 && performance.now() - ignitionAt > 1500) {
      // motor morreu
      ignition = false;
      $('#ignition').setAttribute('aria-pressed', 'false');
      $('#ignLabel').textContent = 'Ligar motor';
    }
  }
  let ignitionAt = 0;

  // ------------------------------------------------------------ controles
  const controls = $('#controls');
  const el = (tag, attrs = {}, kids = []) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const k of [].concat(kids)) if (k) e.append(k);
    return e;
  };

  function chipGroup(id, options, current, onPick, cls = '') {
    const wrap = el('div', { class: 'chips', id, role: 'group' });
    for (const o of options) {
      const b = el('button', { type: 'button', class: `chip ${cls}`, 'aria-pressed': String(o.value === current), title: o.title || '' });
      if (o.sub) b.append(el('span', { text: o.label }), el('small', { text: o.sub }));
      else b.textContent = o.label;
      if (o.disabled) b.disabled = true;
      b.addEventListener('click', () => onPick(o.value));
      wrap.append(b);
    }
    return wrap;
  }

  function slider(id, label, min, max, step, value, fmt, onInput, onChange) {
    const out = el('output', { for: id, text: fmt(value) });
    const input = el('input', { type: 'range', id, min, max, step, value });
    const paint = () => input.style.setProperty('--p', `${((input.value - min) / (max - min)) * 100}%`);
    paint();
    input.addEventListener('input', () => { out.textContent = fmt(+input.value); paint(); onInput(+input.value); });
    if (onChange) input.addEventListener('change', () => onChange(+input.value));
    return el('div', { class: 'field' }, [el('label', { for: id }, [el('span', { text: label }), out]), input]);
  }

  const field = (label, body, extra) => el('div', { class: 'field' }, [el('div', { class: 'lab' }, [el('span', { text: label }), extra || null]), body]);

  function setSpec(patch, { structural = true, render = true } = {}) {
    Object.assign(spec, patch);
    presetId = null;
    markPreset();
    pushConfig(structural);
    if (render) renderControls();
  }

  // trocar entre fechada/automática/aberta é só comando; instalar ou tirar muda o escape
  function setValve(v) {
    const was = spec.valve || 'none';
    setSpec({ valve: v }, { structural: (was === 'none') !== (v === 'none') });
  }

  const DRIVE_MODES = [
    ['track', 'Pista', 'Sobe quase no corte e reduz cedo: o motor fica sempre cheio'],
    ['sport', 'Esportivo', 'Sobe alto e reduz em giro médio'],
    ['normal', 'Normal', 'Trocas em giro médio, como no dia a dia'],
    ['eco', 'Econômico', 'Sobe o mais cedo possível e reduz quase na lenta'],
    ['auto', 'Automático', 'Decide pelo quanto você pisa: pouco acelerador troca cedo, pé no fundo estica'],
  ];

  // relações atuais (as do preset/escalonamento padrão até o usuário mexer)
  function currentRatios() {
    return spec.ratios && spec.ratios.length === spec.gears ? spec.ratios.slice() : gearRatios(spec.gears).slice(1);
  }

  function familyFor(layout, n) { return G.CRANKS[`${layout}-${n}`]; }

  function pickCylinders(n) {
    let layout = spec.layout;
    if (!G.LAYOUTS[layout].counts.includes(n)) layout = G.LAYOUTS.v.counts.includes(n) ? 'v' : 'inline';
    applyFamily(layout, n);
  }

  function applyFamily(layout, n, crankId) {
    const fam = familyFor(layout, n);
    const crank = fam.find((k) => k.id === crankId) || fam[0];
    const patch = { layout, cylinders: n, crank: crank.id, order: crank.orders[0][0] };
    if (layout === 'v') patch.bankAngle = crank.bank;
    if (layout === 'inline' && (spec.routing === 'xpipe' || spec.routing === 'hpipe')) patch.routing = 'dual';
    setSpec(patch);
  }

  function renderControls() {
    const scrollTop = controls.scrollTop;
    controls.textContent = '';
    const fam = familyFor(spec.layout, spec.cylinders);
    const crank = fam.find((k) => k.id === spec.crank) || fam[0];

    // ---- Motor
    const motor = el('section', { class: 'group' }, [el('h2', { text: 'Motor' })]);
    const counts = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16];
    motor.append(field('Cilindros', chipGroup('cyl', counts.map((n) => ({ value: n, label: String(n) })), spec.cylinders, pickCylinders, 'num')));
    motor.append(field('Configuração', chipGroup('layout', Object.entries(G.LAYOUTS).map(([k, v]) => ({
      value: k, label: v.name, disabled: !v.counts.includes(spec.cylinders),
    })), spec.layout, (l) => applyFamily(l, spec.cylinders))));
    if (spec.layout === 'v') {
      motor.append(slider('bank', 'Ângulo entre bancadas', 15, 150, 1, spec.bankAngle, (v) => `${v}°`,
        (v) => { spec.bankAngle = v; engine = G.build(spec); renderReadout(); updatePlate(); },
        (v) => setSpec({ bankAngle: v }, { render: false })));
    }
    motor.append(field('Virabrequim', chipGroup('crank', fam.map((k) => ({ value: k.id, label: k.name })), crank.id, (id) => applyFamily(spec.layout, spec.cylinders, id))));

    const orderInput = el('input', { id: 'orderInput', type: 'text', value: spec.order, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Ordem de ignição personalizada' });
    const orderNote = el('p', { class: 'note', id: 'orderNote' });
    orderInput.addEventListener('keydown', (e) => e.stopPropagation());
    orderInput.addEventListener('input', () => {
      const ok = G.parseOrder(orderInput.value, spec.cylinders);
      orderInput.classList.toggle('bad', !ok);
      if (ok) setSpec({ order: ok.join('-') }, { render: false });
      updateOrderNote(orderNote, ok);
    });
    const rnd = el('button', { type: 'button', class: 'chip', text: 'Sortear', title: 'Gera outra ordem fisicamente possível para este virabrequim' });
    rnd.addEventListener('click', () => {
      const o = G.randomValidOrder(spec.layout, crank.pins, spec.bankAngle ?? crank.bank);
      if (o) setSpec({ order: o.join('-') });
    });
    motor.append(field('Ordem de ignição', el('div', { class: 'chips' }, [
      chipGroup('orders', crank.orders.map(([o, name]) => ({ value: o, label: name, sub: o })), spec.order, (o) => setSpec({ order: o }), 'order'),
    ])));
    motor.append(el('div', { class: 'order-edit' }, [orderInput, rnd]), orderNote);
    updateOrderNote(orderNote, G.parseOrder(spec.order, spec.cylinders));
    controls.append(motor);

    // ---- Características
    const car = el('section', { class: 'group' }, [el('h2', { text: 'Características' })]);
    car.append(slider('disp', 'Cilindrada', 0.25, 9, 0.05, spec.displacement, (v) => `${v.toFixed(2)} L`,
      (v) => { spec.displacement = v; pushConfig(false); }, (v) => setSpec({ displacement: v }, { render: false })));
    car.append(slider('redline', 'Faixa vermelha', 3000, 20000, 100, spec.redline, (v) => `${v.toLocaleString('pt-BR')} rpm`,
      (v) => setSpec({ redline: v, idle: Math.min(spec.idle, v * 0.45) }, { structural: false, render: false })));
    car.append(slider('idle', 'Marcha lenta', 500, 5000, 50, spec.idle, (v) => `${v.toLocaleString('pt-BR')} rpm`,
      (v) => setSpec({ idle: Math.min(v, spec.redline * 0.45) }, { structural: false, render: false })));
    car.append(slider('cam', 'Comando de válvulas', 0, 1, 0.01, spec.cam, (v) => (v < 0.3 ? 'manso' : v < 0.6 ? 'esportivo' : 'bravo'),
      (v) => setSpec({ cam: v }, { structural: false, render: false })));
    car.append(slider('inertia', 'Volante do motor', 0.2, 2, 0.05, spec.inertia, (v) => (v < 0.5 ? 'muito leve' : v < 0.85 ? 'leve' : v < 1.25 ? 'normal' : 'pesado'),
      (v) => setSpec({ inertia: v }, { structural: false, render: false })));
    controls.append(car);

    // ---- Temperatura do motor
    const te = el('section', { class: 'group' }, [el('h2', { text: 'Temperatura do motor' })]);
    te.append(field('Temperatura', chipGroup('tempMode', [
      { value: 'real', label: 'Esquentando de verdade', title: 'A água esquenta com o motor funcionando e esfria desligado' },
      { value: 'fixed', label: 'Fixa', title: 'Fica parada no valor escolhido' },
    ], tempMode, (v) => { tempMode = v; audio?.send({ type: 'input', temp: { mode: v, value: tele.coolant ?? 20 } }); renderControls(); })));
    te.append(slider('coolant', 'Água do motor', -10, 120, 1, Math.round(tele.coolant ?? 20), (v) => `${v} °C`,
      (v) => audio?.send({ type: 'input', temp: { value: v } })));
    te.append(el('div', { class: 'chips' }, [
      el('button', { type: 'button', class: 'chip', text: 'Partida a frio (20 °C)', onclick: () => { audio?.send({ type: 'input', temp: { value: 20 } }); } }),
      el('button', { type: 'button', class: 'chip', text: 'Motor quente (90 °C)', onclick: () => { audio?.send({ type: 'input', temp: { value: 90 } }); } }),
    ]));
    te.append(field('Som da ventoinha do radiador', chipGroup('fanSound', [
      { value: true, label: 'Ligado' }, { value: false, label: 'Desligado' },
    ], params.fanSound, (v) => { params.fanSound = v; audio?.send({ type: 'params', params }); renderControls(); })));
    te.append(field('Som da bomba de ar secundário', chipGroup('saSound', [
      { value: true, label: 'Ligado' }, { value: false, label: 'Desligado' },
    ], params.saSound, (v) => { params.saSound = v; audio?.send({ type: 'params', params }); renderControls(); })));
    te.append(el('p', { class: 'note', text: 'Frio: marcha lenta mais alta, ronco mais rasgado nos primeiros segundos (a central esquenta o catalisador), mais barulho de tucho e a bomba de ar zunindo. Perto de 90 °C a termostática abre; acima de ~99 °C liga a ventoinha.' }));
    controls.append(te);

    // ---- Transmissão
    const tr = el('section', { class: 'group' }, [el('h2', { text: 'Transmissão' })]);
    tr.append(field('Marchas', chipGroup('gears', [4, 5, 6, 7, 8, 9, 10].map((n) => ({ value: n, label: String(n) })),
      spec.gears, (v) => setSpec({ gears: v, ratios: undefined }, { structural: false }), 'num')));
    tr.append(field('Câmbio', chipGroup('trans', [
      { value: 'manual', label: 'Manual' }, { value: 'auto', label: 'Automático' },
    ], spec.transmission, (v) => setSpec({ transmission: v }, { structural: false }))));
    const st = spec.shiftTime || (spec.transmission === 'auto' ? 0.36 : 0.26);
    const stName = (v) => (v < 0.08 ? 'corrida / quickshifter' : v < 0.17 ? 'dupla embreagem' : v < 0.32 ? 'esportivo' : v < 0.5 ? 'comum' : 'antigo, sem pressa');
    tr.append(slider('shiftTime', 'Tempo de troca', 0.04, 1, 0.01, st, (v) => `${v.toFixed(2).replace('.', ',')} s · ${stName(v)}`,
      (v) => setSpec({ shiftTime: v }, { structural: false, render: false })));
    if (spec.transmission === 'auto') {
      tr.append(field('Modo do câmbio (M)', chipGroup('driveMode', DRIVE_MODES.map(([value, label, title]) => ({ value, label, title })),
        spec.driveMode || 'auto', (v) => setSpec({ driveMode: v }, { structural: false }))));
    }
    // relações: número maior = marcha mais curta (mais força, menos velocidade)
    const ratios = currentRatios();
    const fin = spec.finalDrive || defaultFinal(spec.redline);
    const vmax = (r) => Math.round(((spec.redline / 60) * 2 * Math.PI * 0.33 * 3.6) / (r * fin));
    ratios.forEach((r, i) => {
      tr.append(slider(`ratio${i + 1}`, `${i + 1}ª marcha`, 0.4, 5.5, 0.01, r, (v) => `${v.toFixed(2)} : 1 · ${vmax(v)} km/h`, (v) => {
        const next = currentRatios(); next[i] = v;
        setSpec({ ratios: next }, { structural: false, render: false });
      }));
    });
    tr.append(slider('final', 'Diferencial', 1.5, 12, 0.01, fin, (v) => `${v.toFixed(2)} : 1`, (v) => setSpec({ finalDrive: v }, { structural: false, render: false }), () => renderControls()));
    tr.append(el('div', { class: 'chips' }, [el('button', { type: 'button', class: 'chip', text: 'Escalonamento padrão', onclick: () => setSpec({ ratios: undefined, finalDrive: undefined }, { structural: false }) })]));
    tr.append(el('p', { class: 'note', text: spec.transmission === 'auto'
      ? 'E engata o D a partir do neutro. Q e E continuam funcionando como trocas manuais.'
      : 'E sobe e Q reduz. As reduções fazem punta-tacco automático.' }));
    controls.append(tr);

    // ---- Escapamento
    const ex = el('section', { class: 'group' }, [el('h2', { text: 'Escapamento' })]);
    ex.append(field('Coletor', chipGroup('header', [
      { value: 'equal', label: 'Tubos iguais' }, { value: 'unequal', label: 'Tubos desiguais' }, { value: 'short', label: 'Coletor curto' },
    ], spec.header, (v) => setSpec({ header: v }))));
    const inline = spec.layout === 'inline';
    ex.append(field('Traçado', chipGroup('routing', [
      { value: 'single', label: 'Único' }, { value: 'dual', label: 'Duplo' },
      { value: 'xpipe', label: 'X-pipe', disabled: inline, title: 'Cruza as bancadas no meio do escape' },
      { value: 'hpipe', label: 'H-pipe', disabled: inline, title: 'Tubo de equalização entre as bancadas' },
    ], spec.routing, (v) => setSpec({ routing: v }))));
    ex.append(field('Abafador', chipGroup('muffler', [
      { value: 'straight', label: 'Direto' }, { value: 'sport', label: 'Esportivo' }, { value: 'stock', label: 'Original' },
    ], spec.muffler, (v) => setSpec({ muffler: v }))));
    ex.append(slider('pipe', 'Comprimento do escape', 0.8, 5, 0.1, spec.pipeLen, (v) => `${v.toFixed(1)} m`,
      () => {}, (v) => setSpec({ pipeLen: v }, { render: false })));
    controls.append(ex);

    // ---- Acessórios
    const ac = el('section', { class: 'group' }, [el('h2', { text: 'Acessórios' })]);
    ac.append(field('Válvula no escape (cutout)', chipGroup('valve', [
      { value: 'none', label: 'Sem' }, { value: 'closed', label: 'Fechada' },
      { value: 'auto', label: 'Automática', title: 'Abre com o pé embaixo ou giro alto, fecha em cruzeiro' },
      { value: 'open', label: 'Aberta', title: 'O gás sai antes do abafador' },
    ], spec.valve || 'none', setValve)));
    ac.append(field('Diâmetro do escape', chipGroup('pipeD', [2, 2.5, 3, 3.5].map((d) => ({
      value: d, label: `${String(d).replace('.', ',')}"`,
    })), spec.pipeD || 2.5, (v) => setSpec({ pipeD: v }))));
    ac.append(field('Ressonador', chipGroup('reso', [
      { value: false, label: 'Sem' },
      { value: true, label: 'Com', title: 'Tubo lateral que cancela o ronco chato de cruzeiro (perto de 2200 rpm)' },
    ], !!spec.reso, (v) => setSpec({ reso: v }))));
    const ts = spec.twoStep === true ? 'cut' : spec.twoStep || 'off';
    ac.append(field('2-step (largada)', chipGroup('twoStep', [
      { value: 'off', label: 'Desligado' },
      { value: 'cut', label: 'Corte', title: 'Corta a ignição no limite: o giro bate e solta alguns estouros' },
      { value: 'soft', label: 'Controle de largada', title: 'Como nos Porsche: a eletrônica dosa o acelerador e o giro fica parado, sem corte e sem estouro' },
    ], ts, (v) => setSpec({ twoStep: v }, { structural: false }))));
    if (ts !== 'off') {
      const def = Math.round(Math.min(Math.max(spec.redline * 0.5, spec.idle * 2.2), spec.redline * 0.8) / 50) * 50;
      const lo = Math.ceil((spec.idle * 1.5) / 100) * 100, hi = Math.floor((spec.redline * 0.9) / 100) * 100;
      ac.append(slider('launchRpm', 'Rotação de largada', lo, hi, 50, clamp(spec.launchRpm || def, lo, hi), (v) => `${v.toLocaleString('pt-BR')} rpm`,
        (v) => setSpec({ launchRpm: v }, { structural: false, render: false })));
      ac.append(el('p', { class: 'note', text: ts === 'cut'
        ? 'Em ponto morto, ou engatado segurando o freio (S), pise fundo: o giro bate no corte e estoura no escape. Engate ou solte o freio para largar.'
        : 'Em ponto morto, ou engatado segurando o freio (S), pise fundo: o giro fica parado na rotação escolhida, liso. Engate ou solte o freio para largar.' }));
    }
    ac.append(slider('pops', 'Estalos no escape', 0, 1, 0.01, spec.pops, (v) => (v === 0 ? 'desligado' : `${Math.round(v * 100)}%`),
      (v) => setSpec({ pops: v }, { structural: false, render: false })));
    controls.append(ac);

    // ---- Admissão
    const ad = el('section', { class: 'group' }, [el('h2', { text: 'Admissão' })]);
    ad.append(field('Aspiração', chipGroup('asp', [
      { value: 'na', label: 'Aspirado' }, { value: 'turbo', label: 'Turbo' },
      { value: 'super', label: 'Compressor mecânico', title: 'Supercharger tocado por correia: pressão na hora, com o uivo dos rotores' },
    ], spec.aspiration, (v) => setSpec({ aspiration: v, boost: v !== 'na' && !spec.boost ? 0.8 : spec.boost }))));
    if (spec.aspiration !== 'na') {
      ad.append(slider('boost', 'Pressão máxima', 0.3, 2.5, 0.05, spec.boost || 1, (v) => `${v.toFixed(2)} bar`,
        (v) => setSpec({ boost: v }, { structural: false, render: false })));
    }
    ad.append(field('Alimentação', chipGroup('fuel', [
      { value: 'efi', label: 'Injeção' },
      { value: 'carb', label: 'Carburador', title: 'A mistura se divide mal pelo coletor: cada cilindro queima um pouco diferente e o motor "galopa"' },
    ], spec.fuel || 'efi', (v) => setSpec({ fuel: v }))));
    ad.append(field('Entrada de ar', chipGroup('intake', [
      { value: 'airbox', label: 'Caixa de ar' }, { value: 'sport', label: 'Filtro esportivo' }, { value: 'itb', label: 'Borboletas individuais' },
    ], spec.intake, (v) => setSpec({ intake: v }))));
    controls.append(ad);

    // ---- Escuta
    const li = el('section', { class: 'group' }, [el('h2', { text: 'Escuta' })]);
    li.append(field('Observador', chipGroup('observer', [
      { value: 'car', label: 'Junto com o carro' }, { value: 'road', label: 'Parado na via' },
    ], observer, setObserver)));
    if (observer === 'car') {
      li.append(field('Microfone', chipGroup('mic', [
        { value: 'pipe', label: 'Ao lado do escape' }, { value: 'ext', label: 'Câmera atrás' },
        { value: 'int', label: 'Cabine' }, { value: 'bay', label: 'Cofre' },
      ], carMic, (v) => { carMic = v; setListener(); })));
    } else {
      li.append(slider('roadDist', 'Distância até a via', 2, 40, 0.5, params.roadDist, (v) => `${v.toLocaleString('pt-BR')} m`,
        (v) => { params.roadDist = v; audio?.send({ type: 'params', params }); }));
      li.append(el('canvas', { id: 'passby', class: 'passby', 'aria-label': 'Posição do carro na via' }));
      li.append(el('p', { class: 'note', id: 'passNote', text: 'Engate e acelere: o carro anda pela via e passa por você a cada volta.' }));
    }
    li.append(field('Ambiente', chipGroup('env', Object.entries(ENVS).map(([k, v]) => ({ value: k, label: v.name })),
      environment, (v) => { setEnvironment(v); renderControls(); })));
    const mix = (id, label, key, max = 2) => slider(id, label, 0, max, 0.01, params[key], (v) => `${Math.round(v * 100)}%`,
      (v) => { params[key] = v; audio?.send({ type: 'params', params }); });
    li.append(mix('mxEx', 'Escape', 'exhaust'), mix('mxIn', 'Admissão', 'intake'), mix('mxMech', 'Mecânica', 'mech'), mix('mxVol', 'Volume', 'master', 1.5));
    controls.append(li);
    controls.scrollTop = scrollTop;
  }

  function setListener() {
    params.listener = observer === 'road' ? 'road' : carMic;
    audio?.send({ type: 'params', params });
    applyListenerAcoustics();
    renderControls();
  }

  function setObserver(v) {
    observer = v;
    setListener();
  }

  function updateOrderNote(note, parsed) {
    if (!parsed) {
      note.className = 'note warn';
      note.textContent = `Digite os ${spec.cylinders} cilindros, cada um uma vez (ex.: ${familyFor(spec.layout, spec.cylinders)[0].orders[0][0]}).`;
    } else if (!engine.valid) {
      note.className = 'note warn';
      note.textContent = 'Este virabrequim não permite essa sequência em 720°. Dois cilindros vão disparar quase juntos.';
    } else {
      const iv = engine.intervals.map(Math.round);
      const even = iv.every((x) => x === iv[0]);
      note.className = 'note';
      note.textContent = even ? `Ignição uniforme a cada ${iv[0]}°.` : 'Ignição irregular: o ritmo vai "galopar".';
    }
  }

  // ------------------------------------------------------------ presets
  // família em cima, carros dela embaixo
  let family = PRESETS[0].family;
  function renderPresets() {
    const nav = $('#presets');
    nav.textContent = '';
    const fams = el('div', { class: 'families', role: 'group', 'aria-label': 'Famílias' });
    for (const f of PRESETS.families) {
      const n = PRESETS.filter((p) => p.family === f.id).length;
      const b = el('button', { type: 'button', class: 'fam', 'aria-pressed': String(f.id === family) }, [el('span', { text: f.name }), el('small', { text: String(n) })]);
      b.addEventListener('click', () => { family = f.id; renderPresets(); });
      fams.append(b);
    }
    const cars = el('div', { class: 'cars' });
    for (const p of PRESETS.filter((x) => x.family === family)) {
      const b = el('button', { type: 'button', class: 'preset', 'data-id': p.id, 'aria-pressed': String(p.id === presetId) },
        [el('b', { text: p.name }), el('small', { text: p.tag })]);
      b.addEventListener('click', () => loadPreset(p));
      cars.append(b);
    }
    nav.append(fams, cars);
  }
  function markPreset() {
    document.querySelectorAll('.preset').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === presetId)));
  }
  // cada carro vem com o próprio escape: acessórios que ele não define voltam ao padrão
  const STOCK = { valve: 'none', pipeD: 2.5, reso: false, twoStep: 'off', launchRpm: undefined, fuel: 'efi', shiftTime: undefined, driveMode: 'auto' };
  function loadPreset(p) {
    spec = { ...STOCK, ...p };
    pushConfig(true, true);
    presetId = p.id;
    markPreset();
    renderControls();
  }

  // ------------------------------------------------------------ leituras
  function updatePlate() {
    const fam = familyFor(spec.layout, spec.cylinders);
    const crank = fam.find((k) => k.id === spec.crank) || fam[0];
    const lay = spec.layout === 'inline' ? `${spec.cylinders} em linha` : spec.layout === 'boxer' ? `Boxer ${spec.cylinders}` : `V${spec.cylinders} ${spec.bankAngle}°`;
    $('#plate').textContent = `${lay} · ${crank.name} · ${spec.displacement.toFixed(1)} L · ${spec.aspiration === 'na' ? 'aspirado' : `${spec.aspiration === 'turbo' ? 'turbo' : 'compressor'} ${spec.boost.toFixed(1)} bar`} · ${spec.order}`;
  }

  function renderReadout() {
    $('#roOrder').textContent = engine.order.join('-');
    $('#roIntervals').textContent = engine.intervals.map((x) => `${Math.round(x)}°`).join(' ');
    const twoBanks = engine.banks === 2;
    $('#roBankA').parentElement.hidden = !twoBanks;
    $('#roBankB').parentElement.hidden = !twoBanks;
    if (twoBanks) {
      $('#roBankA').textContent = engine.perBank[0].map((x) => `${Math.round(x)}°`).join(' ');
      $('#roBankB').textContent = engine.perBank[1].map((x) => `${Math.round(x)}°`).join(' ');
    }
    const b = engine.balance;
    const items = [['Força 1ª', b.f1], ['Força 2ª', b.f2], ['Momento 1ª', b.m1], ['Momento 2ª', b.m2]];
    const box = $('#balance');
    box.textContent = '';
    for (const [k, v] of items) {
      const w = clamp(v / Math.max(2, engine.N * 0.5), 0, 1) * 100;
      box.append(el('div', { class: 'bal', title: 'Desbalanceamento das massas alternativas, em múltiplos de um cilindro. Zero = cancelamento perfeito.' }, [
        el('span', { class: 'k', text: k }),
        el('div', { class: 'meter' }, [el('i', { class: v === 0 ? 'zero' : '', style: `width:${w}%` })]),
        el('span', { class: 'val', text: v === 0 ? 'zero' : v.toFixed(2) }),
      ]));
    }
  }

  // ------------------------------------------------------------ canvas
  function fit(canvas) {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return [ctx, r.width, r.height];
  }

  const C = {};
  function readColors() {
    for (const k of ['bg', 'panel', 'raise', 'line', 'ink', 'muted', 'faint', 'gold', 'blue', 'violet', 'hot']) C[k] = css(`--${k}`);
    C.display = css('--f-display'); C.mono = css('--f-mono');
  }

  let shownRpm = 0;
  function drawTach(now) {
    const [g, w, h] = fit($('#tach'));
    g.clearRect(0, 0, w, h);
    const age = tele.t ? (now - tele.t) / 1000 : 0;
    shownRpm += (tele.rpm - shownRpm) * 0.35;
    const red = spec.redline;
    const max = Math.ceil((red * 1.12) / 1000) * 1000;
    const cx = w / 2, cy = h * 0.54, R = Math.min(w * 0.46, h * 0.5);
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const ang = (rpm) => a0 + (a1 - a0) * clamp(rpm / max, 0, 1.02);

    // faixa vermelha
    g.lineCap = 'butt';
    g.lineWidth = R * 0.07;
    g.strokeStyle = C.raise;
    g.beginPath(); g.arc(cx, cy, R * 0.92, a0, a1); g.stroke();
    const grad = g.createLinearGradient(cx - R, 0, cx + R, 0);
    grad.addColorStop(0, C.violet); grad.addColorStop(1, C.hot);
    g.strokeStyle = grad;
    g.beginPath(); g.arc(cx, cy, R * 0.92, ang(red), a1); g.stroke();
    // arco de rotação atual
    g.strokeStyle = tele.limiter ? C.hot : C.gold;
    g.globalAlpha = 0.85;
    g.beginPath(); g.arc(cx, cy, R * 0.92, a0, ang(shownRpm)); g.stroke();
    g.globalAlpha = 1;

    // marcas
    const step = max > 12000 ? 2000 : 1000;
    g.fillStyle = C.muted; g.strokeStyle = C.muted;
    g.font = `600 ${Math.round(R * 0.11)}px ${C.display}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let r = 0; r <= max; r += step / 2) {
      const a = ang(r), major = r % step === 0;
      const r1 = R * (major ? 0.78 : 0.82), r2 = R * 0.86;
      g.lineWidth = major ? 2 : 1;
      g.strokeStyle = r >= red ? C.violet : major ? C.ink : C.faint;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); g.stroke();
      if (major) {
        g.fillStyle = r >= red ? C.violet : C.muted;
        g.fillText(String(r / 1000), cx + Math.cos(a) * R * 0.66, cy + Math.sin(a) * R * 0.66);
      }
    }
    g.font = `500 ${Math.round(R * 0.055)}px ${C.mono}`;
    g.fillStyle = C.faint;
    g.fillText('× 1000 rpm', cx, cy - R * 0.38);

    // turbo
    if (spec.aspiration === 'turbo') {
      const bmax = Math.max(0.5, spec.boost);
      const ba0 = Math.PI * 0.22, ba1 = Math.PI * 0.78;
      g.lineWidth = R * 0.03;
      g.strokeStyle = C.raise;
      g.beginPath(); g.arc(cx, cy, R * 0.58, ba1, ba0, true); g.stroke();
      g.strokeStyle = C.blue;
      g.beginPath(); g.arc(cx, cy, R * 0.58, ba1, ba1 - (ba1 - ba0) * clamp(tele.boost / bmax, 0, 1), true); g.stroke();
      g.font = `500 ${Math.round(R * 0.06)}px ${C.mono}`;
      g.fillStyle = C.blue;
      g.fillText(`+${(tele.boost || 0).toFixed(2)} bar`, cx, cy + R * 0.72);
    }

    // ponteiro
    const an = ang(shownRpm);
    g.strokeStyle = C.ink; g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx - Math.cos(an) * R * 0.08, cy - Math.sin(an) * R * 0.08); g.lineTo(cx + Math.cos(an) * R * 0.86, cy + Math.sin(an) * R * 0.86); g.stroke();
    g.fillStyle = C.ink; g.beginPath(); g.arc(cx, cy, R * 0.035, 0, Math.PI * 2); g.fill();

    // números
    g.fillStyle = tele.limiter ? C.hot : C.ink;
    g.font = `800 ${Math.round(R * 0.3)}px ${C.display}`;
    g.fillText(Math.round(shownRpm / 10) * 10 + '', cx, cy + R * 0.3);
    g.font = `500 ${Math.round(R * 0.06)}px ${C.mono}`;
    g.fillStyle = C.muted;
    const kmh = Math.round(tele.kmh || 0);
    g.fillText(`${kmh} km/h  ·  ${Math.round(tele.torque || 0)} N·m`, cx, cy + R * 0.5);
    const wt = tele.coolant ?? 20;
    g.fillStyle = wt < 60 ? C.blue : wt > 105 ? C.hot : C.muted;
    g.fillText(`água ${Math.round(wt)} °C${tele.fan ? '  ·  ventoinha' : ''}${tele.secAir ? '  ·  bomba de ar' : ''}`, cx, cy + R * 0.62);
    if (tele.limiter) {
      g.fillStyle = C.hot;
      g.font = `600 ${Math.round(R * 0.07)}px ${C.mono}`;
      g.fillText(tele.launch ? '2-STEP' : 'CORTE', cx, cy - R * 0.22);
    } else if (tele.launch) {
      g.fillStyle = C.gold;
      g.font = `600 ${Math.round(R * 0.07)}px ${C.mono}`;
      g.fillText('LARGADA', cx, cy - R * 0.22);
    } else if (tele.state === 'crank') {
      g.fillStyle = C.gold;
      g.font = `600 ${Math.round(R * 0.07)}px ${C.mono}`;
      g.fillText('PARTIDA', cx, cy - R * 0.22);
    }
    const gr = $('#gearRead');
    gr.textContent = tele.gear ? `${spec.transmission === 'auto' ? 'D' : ''}${tele.gear}` : 'N';
    gr.classList.toggle('deny', !!tele.denied);
    gr.title = tele.denied ? 'Redução recusada: o motor passaria da faixa vermelha' : '';
    const vt = $('#valveTag');
    vt.hidden = !(spec.valve && spec.valve !== 'none');
    vt.classList.toggle('on', (tele.valve || 0) > 0.5);
    vt.textContent = (tele.valve || 0) > 0.5 ? 'válvula aberta' : 'válvula fechada';
    void age;
  }

  // Ciclo de 720° no tempo real do virabrequim: o ângulo vem do motor e é extrapolado
  // entre as leituras. Em giro alto o ponteiro vira borrão, como numa foto com obturador.
  let ringPhase = 0, ringSweep = 0, lastNow = 0;
  const glow = new Float32Array(16);
  function drawRing(now, dt) {
    const [g, w, h] = fit($('#ring'));
    g.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, R = Math.min(w * 0.42, h * 0.37);
    const two = engine.banks === 2;
    const radius = (b) => (two ? (b === 0 ? R : R * 0.72) : R * 0.86);
    const running = tele.rpm > 60;
    if (running) {
      const age = Math.min(0.05, Math.max(0, (now - (tele.t || now)) / 1000));
      ringPhase = (((tele.theta || 0) + tele.rpm * 6 * age) % 720 + 720) % 720;
      ringSweep = Math.min(720, tele.rpm * 6 * dt);
    } else ringSweep = 0;
    const start = (ringPhase - ringSweep + 720) % 720;
    const glowTau = clamp(60 / Math.max(tele.rpm, 1), 0.03, 0.35);
    const toA = (deg) => (deg / 720) * Math.PI * 2 - Math.PI / 2;

    // trilhas
    for (let b = 0; b < engine.banks; b++) {
      g.strokeStyle = C.line; g.lineWidth = 1;
      g.beginPath(); g.arc(cx, cy, radius(b), 0, Math.PI * 2); g.stroke();
    }
    // graus
    g.font = `500 10px ${C.mono}`; g.fillStyle = C.faint; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let d = 0; d < 720; d += 90) {
      const a = toA(d);
      g.strokeStyle = C.line;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * R * 1.04, cy + Math.sin(a) * R * 1.04); g.lineTo(cx + Math.cos(a) * R * 1.1, cy + Math.sin(a) * R * 1.1); g.stroke();
      g.fillText(`${d}°`, cx + Math.cos(a) * R * 1.2, cy + Math.sin(a) * R * 1.2);
    }

    // arcos dos intervalos por bancada (onde os pulsos de cada coletor caem)
    for (let b = 0; b < engine.banks; b++) {
      const angs = engine.fire.map((f, c) => [f, c]).filter(([, c]) => engine.bank[c] === b).sort((x, y) => x[0] - y[0]);
      g.strokeStyle = b === 0 ? C.gold : C.blue;
      for (let i = 0; i < angs.length; i++) {
        const fa = angs[i][0], fb = i + 1 < angs.length ? angs[i + 1][0] : angs[0][0] + 720;
        const gap = fb - fa;
        g.globalAlpha = 0.18 + 0.5 * clamp(1 - gap / 720, 0, 1);
        g.lineWidth = 3;
        g.beginPath(); g.arc(cx, cy, radius(b), toA(fa) + 0.05, toA(fb) - 0.05); g.stroke();
      }
      g.globalAlpha = 1;
    }

    // cilindros
    for (let c = 0; c < engine.N; c++) {
      const f = engine.fire[c];
      if (running && ringSweep > 0) {
        const crossed = ringSweep >= 720 || (start <= ringPhase ? f > start && f <= ringPhase : f > start || f <= ringPhase);
        if (crossed) glow[c] = 1;
      }
      glow[c] *= Math.exp(-dt / glowTau);
      const b = engine.bank[c];
      const a = toA(f), r = radius(b);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      const col = b === 0 ? C.gold : C.blue;
      const size = Math.max(9, Math.min(14, R * 0.09));
      if (glow[c] > 0.02) {
        g.fillStyle = col; g.globalAlpha = glow[c] * 0.35;
        g.beginPath(); g.arc(x, y, size * (1.6 + glow[c]), 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1;
      }
      g.fillStyle = glow[c] > 0.5 ? col : C.panel;
      g.strokeStyle = col; g.lineWidth = 1.5;
      g.beginPath(); g.arc(x, y, size, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = glow[c] > 0.5 ? C.bg : C.ink;
      g.font = `500 ${Math.round(size * 0.95)}px ${C.mono}`;
      g.fillText(String(c + 1), x, y + 0.5);
    }

    // virabrequim
    const ha = toA(ringPhase);
    if (ringSweep > 6) {
      // rastro do quadro: o ângulo que o virabrequim percorreu desde o último desenho
      g.fillStyle = C.muted; g.globalAlpha = clamp(12 / ringSweep, 0.05, 0.3);
      g.beginPath(); g.moveTo(cx, cy);
      if (ringSweep >= 720) g.arc(cx, cy, R * 0.98, 0, Math.PI * 2);
      else g.arc(cx, cy, R * 0.98, toA(start), ha);
      g.closePath(); g.fill();
    }
    g.globalAlpha = clamp(40 / Math.max(ringSweep, 1), 0.25, 1);
    g.strokeStyle = C.muted; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(ha) * R * 0.98, cy + Math.sin(ha) * R * 0.98); g.stroke();
    g.globalAlpha = 1;
    g.fillStyle = C.ink;
    g.font = `800 ${Math.round(R * 0.22)}px ${C.display}`;
    g.fillText(`${engine.N}`, cx, cy - R * 0.06);
    g.font = `500 10px ${C.mono}`; g.fillStyle = C.muted;
    g.fillText(engine.N === 1 ? 'cilindro' : 'cilindros', cx, cy + R * 0.13);
    if (R > 110) {
      g.fillStyle = C.faint;
      g.fillText('ciclo de 720° · tempo real', cx, cy + R * 0.27);
    }
  }

  let tBuf = null, fBuf = null;
  function drawScope() {
    const [g, w, h] = fit($('#scope'));
    g.clearRect(0, 0, w, h);
    const mid = h * 0.32;
    g.strokeStyle = C.line; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, mid); g.lineTo(w, mid); g.stroke();
    g.font = `500 10px ${C.mono}`; g.fillStyle = C.faint; g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillText('pressão no ouvido do observador', 10, 8);
    if (!audio) { g.fillText('ligue o motor para ver a onda e o espectro', 10, h - 18); return; }
    const an = audio.analyser;
    if (!tBuf) { tBuf = new Float32Array(an.fftSize); fBuf = new Float32Array(an.frequencyBinCount); }
    an.getFloatTimeDomainData(tBuf);
    // janela de ~2 ciclos para a onda ficar parada em rotação constante
    const sr = audio.ctx.sampleRate;
    const span = Math.min(tBuf.length, Math.max(256, Math.round(tele.rpm > 100 ? (2 * 120 / tele.rpm) * sr : 2048)));
    g.strokeStyle = C.gold; g.lineWidth = 1.3;
    g.beginPath();
    for (let i = 0; i < span; i++) {
      const x = (i / (span - 1)) * w;
      const y = mid - tBuf[tBuf.length - span + i] * mid * 0.9;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
    // espectro (log)
    an.getFloatFrequencyData(fBuf);
    const top = h * 0.66, bot = h - 4, f0 = 20, f1 = 8000;
    const fx = (f) => (Math.log(f / f0) / Math.log(f1 / f0)) * w;
    g.beginPath(); g.moveTo(0, bot);
    for (let x = 0; x <= w; x += 2) {
      const f = f0 * Math.pow(f1 / f0, x / w);
      const bin = Math.round((f / (sr / 2)) * fBuf.length);
      const db = fBuf[Math.min(bin, fBuf.length - 1)];
      const y = bot - clamp((db + 110) / 90, 0, 1) * (bot - top + h * 0.28);
      g.lineTo(x, y);
    }
    g.lineTo(w, bot); g.closePath();
    g.fillStyle = C.blue; g.globalAlpha = 0.22; g.fill(); g.globalAlpha = 1;
    // frequência de ignição
    const ff = (tele.rpm / 60) * (engine.N / 2);
    $('#roFreq').textContent = tele.rpm > 60 ? `${ff.toFixed(0)} Hz · meia-ordem ${(tele.rpm / 120).toFixed(1)} Hz` : '—';
    if (ff > f0 && ff < f1) {
      const x = fx(ff);
      g.strokeStyle = C.gold; g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(x, top - h * 0.28); g.lineTo(x, bot); g.stroke(); g.setLineDash([]);
      g.fillStyle = C.gold; g.textAlign = x > w - 90 ? 'right' : 'left';
      g.fillText(`ignição ${ff.toFixed(0)} Hz`, x + (x > w - 90 ? -6 : 6), top - h * 0.26);
    }
    g.fillStyle = C.faint; g.textAlign = 'right';
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000]) g.fillText(f >= 1000 ? `${f / 1000}k` : String(f), fx(f) - 2, bot - 12);
  }

  // Vista de cima da via: observador embaixo, carro andando da esquerda para a direita.
  function drawPassby() {
    const cv = document.getElementById('passby');
    if (!cv) return;
    const [g, w, h] = fit(cv);
    g.clearRect(0, 0, w, h);
    const span = 120, sx = w / (2 * span);
    const roadY = h * 0.32, obsY = Math.min(h - 12, roadY + 6 + (params.roadDist || 6) * 1.6);
    g.strokeStyle = C.line; g.lineWidth = 10;
    g.beginPath(); g.moveTo(0, roadY); g.lineTo(w, roadY); g.stroke();
    g.strokeStyle = C.faint; g.lineWidth = 1; g.setLineDash([6, 8]);
    g.beginPath(); g.moveTo(0, roadY); g.lineTo(w, roadY); g.stroke(); g.setLineDash([]);
    const ox = w / 2;
    g.fillStyle = C.ink; g.beginPath(); g.arc(ox, obsY, 4, 0, Math.PI * 2); g.fill();
    g.font = `500 10px ${C.mono}`; g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillStyle = C.muted; g.fillText('você', ox, obsY + 6 > h - 12 ? obsY - 18 : obsY + 6);
    const x = tele.carX ?? -12;
    const vis = Math.abs(x) <= span;
    const cx = ox + Math.max(-span, Math.min(span, x)) * sx;
    g.fillStyle = C.gold;
    if (vis) { g.fillRect(cx - 8, roadY - 4, 16, 8); g.fillStyle = C.hot; g.fillRect(cx - 9, roadY - 2, 2, 4); }
    else { g.beginPath(); const dir = x > 0 ? 1 : -1, ex = dir > 0 ? w - 4 : 4; g.moveTo(ex, roadY); g.lineTo(ex - dir * 10, roadY - 6); g.lineTo(ex - dir * 10, roadY + 6); g.fill(); }
    const note = document.getElementById('passNote');
    if (note) {
      const dist = Math.round(tele.dist ?? 0);
      const moving = (tele.kmh || 0) > 2;
      const ratio = 343 / (343 + (tele.vRad || 0));
      const pct = (ratio - 1) * 100;
      note.textContent = moving
        ? `${dist} m · ${pct > 0 ? 'aproximando' : 'afastando'} · Doppler ${pct > 0 ? '+' : ''}${pct.toFixed(1)}% no tom · volta de ${tele.loop} m`
        : `${dist} m de você · carro parado. Engate e acelere para ele passar.`;
    }
  }

  function frame(now) {
    const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
    const cs = document.getElementById('coolant');
    if (cs && document.activeElement !== cs && tele.coolant !== undefined && Math.round(tele.coolant) !== +cs.value) {
      cs.value = Math.round(tele.coolant);
      cs.style.setProperty('--p', `${((cs.value - cs.min) / (cs.max - cs.min)) * 100}%`);
      cs.parentElement.querySelector('output').textContent = `${cs.value} °C`;
    }
    lastNow = now;
    drawTach(now);
    drawRing(now, dt);
    drawScope();
    drawPassby();
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ entrada
  const THROTTLE_KEYS = ['KeyW', 'ArrowUp', 'Space'];
  window.addEventListener('keydown', async (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type === 'text') return;
    if (THROTTLE_KEYS.includes(e.code)) {
      e.preventDefault();
      if (!ignition && !audio) return;
      input.key = 1; input.half = e.shiftKey; sendInput();
    } else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { input.half = true; sendInput(); }
    else if (e.code === 'KeyS' || e.code === 'ArrowDown') { e.preventDefault(); input.brake = 1; sendInput(); $('#brakeBtn').classList.add('on'); }
    else if (e.repeat) return;
    else if (e.code === 'KeyE' || e.code === 'PageUp') shift(1);
    else if (e.code === 'KeyQ' || e.code === 'PageDown') shift(-1);
    else if (e.code === 'KeyM' && spec.transmission === 'auto') {
      const i = DRIVE_MODES.findIndex(([v]) => v === (spec.driveMode || 'auto'));
      setSpec({ driveMode: DRIVE_MODES[(i + 1) % DRIVE_MODES.length][0] }, { structural: false });
    }
    else if (e.code === 'KeyB') setValve((spec.valve || 'none') === 'open' ? 'closed' : 'open');
    else if (e.code === 'KeyI') { ignitionAt = performance.now(); setIgnition(!ignition); }
    else if (e.code === 'KeyC') { const order = ['pipe', 'ext', 'int', 'bay']; observer = 'car'; carMic = order[(order.indexOf(carMic) + 1) % 4]; setListener(); }
    else if (e.code === 'KeyV') setObserver(observer === 'car' ? 'road' : 'car');
  });
  window.addEventListener('keyup', (e) => {
    if (THROTTLE_KEYS.includes(e.code)) { input.key = 0; sendInput(); }
    else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { input.half = false; sendInput(); }
    else if (e.code === 'KeyS' || e.code === 'ArrowDown') { input.brake = 0; sendInput(); $('#brakeBtn').classList.remove('on'); }
  });
  window.addEventListener('blur', () => { input.key = 0; input.pad = 0; input.brake = 0; sendInput(); });

  const pedal = $('#pedal');
  const padFrom = (e) => { const r = pedal.getBoundingClientRect(); return clamp(1 - (e.clientY - r.top) / r.height, 0, 1); };
  pedal.addEventListener('pointerdown', (e) => { pedal.setPointerCapture(e.pointerId); input.pad = padFrom(e); sendInput(); });
  pedal.addEventListener('pointermove', (e) => { if (pedal.hasPointerCapture(e.pointerId)) { input.pad = padFrom(e); sendInput(); } });
  const release = () => { input.pad = 0; sendInput(); };
  pedal.addEventListener('pointerup', release);
  pedal.addEventListener('pointercancel', release);

  $('#ignition').addEventListener('click', () => { ignitionAt = performance.now(); setIgnition(!ignition); });
  $('#gUp').addEventListener('click', () => shift(1));
  $('#gDown').addEventListener('click', () => shift(-1));
  $('#valveTag').addEventListener('click', () => setValve(spec.valve === 'open' ? 'closed' : 'open'));
  const brake = $('#brakeBtn');
  brake.addEventListener('pointerdown', () => { input.brake = 1; sendInput(); brake.classList.add('on'); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) brake.addEventListener(ev, () => { input.brake = 0; sendInput(); brake.classList.remove('on'); });

  // ------------------------------------------------------------ início
  readColors();
  renderPresets();
  renderControls();
  renderReadout();
  updatePlate();
  if (document.fonts) document.fonts.ready.then(readColors);
  requestAnimationFrame(frame);
})();
